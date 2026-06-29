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

// GET /api/stats/drift
api.get('/stats/drift', async (c) => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const updates = await db.query.vesselMovements.findMany({
        where: and(
            eq(vesselMovements.changeType, 'UPDATE'),
            gt(vesselMovements.scrapedAt, thirtyDaysAgo)
        ),
    });

    const driftByVessel: Record<string, { totalDrift: number; count: number }> = {};
    const driftByAgent: Record<string, { totalDrift: number; count: number }> = {};
    let totalDrift = 0;
    let driftCount = 0;
    let maxDrift = 0;

    updates.forEach((up) => {
        const prev = up.previousValue as Record<string, any> | null;
        if (prev && prev.scheduledTime && up.scheduledTime) {
            const prevTime = new Date(prev.scheduledTime).getTime();
            const newTime = new Date(up.scheduledTime).getTime();
            const diffMinutes = Math.round((newTime - prevTime) / (1000 * 60));

            // Track any change, but particularly delays (positive values)
            totalDrift += diffMinutes;
            driftCount++;
            if (Math.abs(diffMinutes) > Math.abs(maxDrift)) {
                maxDrift = diffMinutes;
            }

            if (up.vesselName) {
                if (!driftByVessel[up.vesselName]) {
                    driftByVessel[up.vesselName] = { totalDrift: 0, count: 0 };
                }
                driftByVessel[up.vesselName].totalDrift += diffMinutes;
                driftByVessel[up.vesselName].count++;
            }

            if (up.agent) {
                if (!driftByAgent[up.agent]) {
                    driftByAgent[up.agent] = { totalDrift: 0, count: 0 };
                }
                driftByAgent[up.agent].totalDrift += diffMinutes;
                driftByAgent[up.agent].count++;
            }
        }
    });

    const vesselResult = Object.entries(driftByVessel).map(([name, stats]) => ({
        vesselName: name,
        avgDriftMinutes: parseFloat((stats.totalDrift / stats.count).toFixed(1)),
        totalDriftMinutes: stats.totalDrift,
        reschedules: stats.count,
    })).sort((a, b) => b.totalDriftMinutes - a.totalDriftMinutes);

    const agentResult = Object.entries(driftByAgent).map(([name, stats]) => ({
        agent: name,
        avgDriftMinutes: parseFloat((stats.totalDrift / stats.count).toFixed(1)),
        totalDriftMinutes: stats.totalDrift,
        reschedules: stats.count,
    })).sort((a, b) => b.totalDriftMinutes - a.totalDriftMinutes);

    return c.json({
        averageDriftMinutes: driftCount > 0 ? parseFloat((totalDrift / driftCount).toFixed(1)) : 0,
        maxDriftMinutes: maxDrift,
        totalRescheduledMovements: driftCount,
        driftByVessel: vesselResult.slice(0, 10),
        driftByAgent: agentResult.slice(0, 10),
    });
});

// GET /api/stats/berth-utilization
api.get('/stats/berth-utilization', async (c) => {
    // We compute utilization for a 7-day window
    const now = new Date();
    const windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const windowEnd = now;
    const totalWindowMs = 7 * 24 * 60 * 60 * 1000;

    // Fetch movements that are active or completed in the last 14 days to capture ongoing/past stays
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const records = await db.query.vesselMovements.findMany({
        where: and(
            ne(vesselMovements.changeType, 'REMOVED'),
            gt(vesselMovements.scheduledTime, fourteenDaysAgo)
        ),
        orderBy: [vesselMovements.vesselName, vesselMovements.scheduledTime],
    });

    // Reconstruct stays grouped by berth
    const berthStays: Record<string, { arrival: Date; departure: Date; vesselName: string }[]> = {};

    // First group records by vessel
    const movementsByVessel: Record<string, typeof records> = {};
    records.forEach((record) => {
        if (!movementsByVessel[record.vesselName]) {
            movementsByVessel[record.vesselName] = [];
        }
        movementsByVessel[record.vesselName].push(record);
    });

    // Match arrivals & departures
    Object.entries(movementsByVessel).forEach(([vesselName, mvmtList]) => {
        // Sort chronologically
        mvmtList.sort((a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime());

        for (let i = 0; i < mvmtList.length; i++) {
            const mvmt = mvmtList[i];
            if (mvmt.movementType === 'Arrival') {
                const berth = mvmt.destination;
                if (!berth) continue;

                // Find subsequent departure
                const dep = mvmtList.find((d, idx) => idx > i && d.movementType === 'Departure');
                const arrivalTime = new Date(mvmt.scheduledTime);
                const departureTime = dep ? new Date(dep.scheduledTime) : new Date(arrivalTime.getTime() + 18 * 60 * 60 * 1000); // default 18h stay if not left

                if (!berthStays[berth]) {
                    berthStays[berth] = [];
                }
                berthStays[berth].push({
                    arrival: arrivalTime,
                    departure: departureTime,
                    vesselName,
                });
            } else if (mvmt.movementType === 'Departure') {
                // If we have a departure but no preceding arrival was found in this window (e.g. vessel arrived >14 days ago)
                const berth = mvmt.origin;
                if (!berth) continue;

                const hasPrecedingArrival = mvmtList.some((a, idx) => idx < mvmtList.indexOf(mvmt) && a.movementType === 'Arrival');
                if (!hasPrecedingArrival) {
                    const departureTime = new Date(mvmt.scheduledTime);
                    const arrivalTime = new Date(departureTime.getTime() - 18 * 60 * 60 * 1000); // assume arrived 18h ago

                    if (!berthStays[berth]) {
                        berthStays[berth] = [];
                    }
                    berthStays[berth].push({
                        arrival: arrivalTime,
                        departure: departureTime,
                        vesselName,
                    });
                }
            }
        }
    });

    // Calculate occupancy per berth within the 7-day window
    const result = Object.entries(berthStays).map(([berth, stays]) => {
        let occupiedMs = 0;

        stays.forEach((stay) => {
            const startMs = stay.arrival.getTime();
            const endMs = stay.departure.getTime();

            const overlapStart = Math.max(startMs, windowStart.getTime());
            const overlapEnd = Math.min(endMs, windowEnd.getTime());

            if (overlapEnd > overlapStart) {
                occupiedMs += (overlapEnd - overlapStart);
            }
        });

        const utilizationPercentage = (occupiedMs / totalWindowMs) * 100;

        return {
            berth,
            utilizationPercentage: parseFloat(Math.min(100, utilizationPercentage).toFixed(1)),
            occupiedHours: parseFloat((occupiedMs / (1000 * 60 * 60)).toFixed(1)),
            totalMovements: stays.length,
        };
    }).sort((a, b) => b.utilizationPercentage - a.utilizationPercentage);

    return c.json(result);
});


// GET /api/vessel/:vesselName/history
api.get('/vessel/:vesselName/history', async (c) => {
    const vesselName = c.req.param('vesselName');
    const history = await db.query.vesselMovements.findMany({
        where: eq(vesselMovements.vesselName, vesselName),
        orderBy: [desc(vesselMovements.scrapedAt)],
    });
    return c.json(history);
});

export default api;
