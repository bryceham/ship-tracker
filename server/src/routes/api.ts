import { Hono } from 'hono';
import { db } from '../db';
import { vesselMovements } from '../db/schema';
import { desc, eq, inArray, sql, gt, and, ne, lt } from 'drizzle-orm';

const api = new Hono();

// GET /api/changes
api.get('/changes', async (c) => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const threeDaysHence = new Date();
    threeDaysHence.setDate(threeDaysHence.getDate() + 3);

    const changes = await db.query.vesselMovements.findMany({
        where: and(
            inArray(vesselMovements.changeType, ['NEW', 'UPDATE', 'REMOVED', 'COMPLETED']),
            gt(vesselMovements.scrapedAt, sevenDaysAgo),
            lt(vesselMovements.scheduledTime, threeDaysHence)
        ),
        orderBy: [desc(vesselMovements.scrapedAt)],
        limit: 100,
    });
    return c.json(changes);
});

// GET /api/schedule
api.get('/schedule', async (c) => {
    const schedule = await db
        .selectDistinctOn([vesselMovements.vesselName, vesselMovements.movementType])
        .from(vesselMovements)
        .orderBy(vesselMovements.vesselName, vesselMovements.movementType, desc(vesselMovements.scrapedAt));

    // Filter out any records that are marked as REMOVED or COMPLETED
    const activeSchedule = schedule.filter(item => item.changeType !== 'REMOVED' && item.changeType !== 'COMPLETED');

    return c.json(activeSchedule);
});

// GET /api/removed
api.get('/removed', async (c) => {
    const removed = await db.query.vesselMovements.findMany({
        where: inArray(vesselMovements.changeType, ['REMOVED', 'COMPLETED']),
        orderBy: [desc(vesselMovements.scrapedAt)],
        limit: 20,
    });
    return c.json(removed);
});

// GET /api/stats/daily-movements
api.get('/stats/daily-movements', async (c) => {
    const dailyStats = await db
        .select({
            date: sql<string>`to_char(${vesselMovements.scrapedAt} AT TIME ZONE 'UTC' AT TIME ZONE 'Australia/Sydney', 'YYYY-MM-DD')`,
            count: sql<number>`count(*)::int`,
        })
        .from(vesselMovements)
        .where(and(
            inArray(vesselMovements.changeType, ['REMOVED', 'COMPLETED']),
            gt(vesselMovements.scrapedAt, sql`now() - interval '28 days'`)
        ))
        .groupBy(sql`to_char(${vesselMovements.scrapedAt} AT TIME ZONE 'UTC' AT TIME ZONE 'Australia/Sydney', 'YYYY-MM-DD')`)
        .orderBy(sql`to_char(${vesselMovements.scrapedAt} AT TIME ZONE 'UTC' AT TIME ZONE 'Australia/Sydney', 'YYYY-MM-DD')`);

    return c.json(dailyStats);
});

// GET /api/stats/agents
api.get('/stats/agents', async (c) => {
    const records = await db.query.vesselMovements.findMany({
        where: sql`${vesselMovements.agent} IS NOT NULL`,
    });

    const agentStats: Record<string, { total: number; delayed: number; totalDelayMinutes: number }> = {};

    records.forEach((record) => {
        const agent = record.agent!;
        if (!agentStats[agent]) {
            agentStats[agent] = { total: 0, delayed: 0, totalDelayMinutes: 0 };
        }

        const stats = agentStats[agent];
        stats.total++;

        // If it was updated and had a scheduledTime change, calculate the delay
        if (record.changeType === 'UPDATE' && record.previousValue) {
            const prev = record.previousValue as Record<string, any>;
            if (prev.scheduledTime && record.scheduledTime) {
                const prevTime = new Date(prev.scheduledTime).getTime();
                const newTime = new Date(record.scheduledTime).getTime();
                const delayMs = newTime - prevTime;
                if (delayMs > 0) {
                    stats.delayed++;
                    stats.totalDelayMinutes += Math.round(delayMs / (1000 * 60));
                }
            }
        }
    });

    const result = Object.entries(agentStats).map(([name, stats]) => {
        const onTime = stats.total > 0 ? ((stats.total - stats.delayed) / stats.total) * 100 : 100;
        const avgDelay = stats.delayed > 0 ? stats.totalDelayMinutes / stats.delayed : 0;
        return {
            agent: name,
            totalVoyages: stats.total,
            delayedVoyages: stats.delayed,
            onTimePercentage: parseFloat(onTime.toFixed(1)),
            avgDelayMinutes: parseFloat(avgDelay.toFixed(1)),
        };
    }).sort((a, b) => b.onTimePercentage - a.onTimePercentage || b.totalVoyages - a.totalVoyages);

    return c.json(result);
});

// GET /api/stats/berths
api.get('/stats/berths', async (c) => {
    const records = await db.query.vesselMovements.findMany();

    const berthStats: Record<string, { total: number; totalDelayMinutes: number; delayedCount: number; stays: number[]; }> = {};

    records.forEach((record) => {
        const isArrival = record.movementType === 'Arrival';
        const berth = isArrival ? record.destination : record.origin;
        if (!berth) return;

        if (!berthStats[berth]) {
            berthStats[berth] = { total: 0, totalDelayMinutes: 0, delayedCount: 0, stays: [] };
        }

        const stats = berthStats[berth];
        stats.total++;

        // Calculate delays
        if (record.changeType === 'UPDATE' && record.previousValue) {
            const prev = record.previousValue as Record<string, any>;
            if (prev.scheduledTime) {
                const prevTime = new Date(prev.scheduledTime).getTime();
                const newTime = new Date(record.scheduledTime).getTime();
                const diff = newTime - prevTime;
                if (diff > 0) {
                    stats.delayedCount++;
                    stats.totalDelayMinutes += Math.round(diff / (1000 * 60));
                }
            }
        }
    });

    const arrivals = records.filter(r => r.movementType === 'Arrival' && r.changeType !== 'REMOVED');
    const departures = records.filter(r => r.movementType === 'Departure' && r.changeType !== 'REMOVED');

    arrivals.forEach((arr) => {
        const dep = departures.find(d => d.vesselName === arr.vesselName && new Date(d.scheduledTime) > new Date(arr.scheduledTime));
        if (dep) {
            const berth = arr.destination;
            if (berth && berthStats[berth]) {
                const dwellMs = new Date(dep.scheduledTime).getTime() - new Date(arr.scheduledTime).getTime();
                berthStats[berth].stays.push(dwellMs / (1000 * 60 * 60));
            }
        }
    });

    const result = Object.entries(berthStats).map(([name, stats]) => {
        const avgDwell = stats.stays.length > 0 ? stats.stays.reduce((a, b) => a + b, 0) / stats.stays.length : 0;
        const avgDelay = stats.delayedCount > 0 ? stats.totalDelayMinutes / stats.delayedCount : 0;

        return {
            berth: name,
            totalMovements: stats.total,
            avgDwellHours: parseFloat(avgDwell.toFixed(1)),
            avgDelayMinutes: parseFloat(avgDelay.toFixed(1)),
        };
    }).sort((a, b) => b.totalMovements - a.totalMovements);

    return c.json(result);
});

export default api;
