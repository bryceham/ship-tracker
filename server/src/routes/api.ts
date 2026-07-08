import { Hono } from 'hono';
import { db } from '../db';
import { vesselMovements } from '../db/schema';
import { desc, eq, inArray, sql, gt, and, ne, lt, lte } from 'drizzle-orm';

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
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const records = await db.query.vesselMovements.findMany({
        where: gt(vesselMovements.scrapedAt, fourteenDaysAgo),
        orderBy: [desc(vesselMovements.scrapedAt)],
    });

    // Deduplicate physical movements (getting only the latest scraped update/completed/new state of each)
    const uniqueMovements: typeof records = [];
    const processedGroups: {
        vesselName: string;
        movementType: string;
        agent: string | null;
        scrapedAtTimes: Set<number>;
        scheduledTimeHistory: Set<number>;
    }[] = [];

    for (const record of records) {
        const matchingGroup = processedGroups.find(g => {
            if (g.vesselName !== record.vesselName || g.movementType !== record.movementType || g.agent !== record.agent) {
                return false;
            }
            const fromSameScrape = Array.from(g.scrapedAtTimes).some(t => Math.abs(t - record.scrapedAt.getTime()) < 60 * 1000);
            if (fromSameScrape) {
                return false;
            }
            return g.scheduledTimeHistory.has(record.scheduledTime.getTime()) ||
                   Array.from(g.scheduledTimeHistory).some(t => Math.abs(t - record.scheduledTime.getTime()) < 36 * 60 * 60 * 1000);
        });

        if (matchingGroup) {
            matchingGroup.scrapedAtTimes.add(record.scrapedAt.getTime());
            matchingGroup.scheduledTimeHistory.add(record.scheduledTime.getTime());
            const prevVal = record.previousValue as Record<string, any> | null;
            if (prevVal && prevVal.scheduledTime) {
                matchingGroup.scheduledTimeHistory.add(new Date(prevVal.scheduledTime).getTime());
            }
        } else {
            uniqueMovements.push(record);

            const scheduledTimeHistory = new Set<number>([record.scheduledTime.getTime()]);
            const prevVal = record.previousValue as Record<string, any> | null;
            if (prevVal && prevVal.scheduledTime) {
                scheduledTimeHistory.add(new Date(prevVal.scheduledTime).getTime());
            }

            processedGroups.push({
                vesselName: record.vesselName,
                movementType: record.movementType,
                agent: record.agent,
                scrapedAtTimes: new Set<number>([record.scrapedAt.getTime()]),
                scheduledTimeHistory
            });
        }
    }

    // A schedule item is active if it's not REMOVED or COMPLETED.
    // However, if a vessel has an active Departure, we also want to keep its corresponding Arrival (even if COMPLETED)
    // so that the frontend can compute the correct dwell/stay time.
    const activeVesselDepartures = new Set(
        uniqueMovements
            .filter(item => item.movementType === 'Departure' && item.changeType !== 'REMOVED' && item.changeType !== 'COMPLETED')
            .map(item => item.vesselName)
    );

    const activeSchedule = uniqueMovements.filter(item => {
        if (item.changeType === 'REMOVED') return false;
        if (item.changeType === 'COMPLETED') {
            // Keep completed Arrival or Shift if the vessel still has an active/upcoming Departure
            return (item.movementType === 'Arrival' || item.movementType === 'Shift') && activeVesselDepartures.has(item.vesselName);
        }
        return true;
    });

    return c.json(activeSchedule);
});

// GET /api/schedule/historical
api.get('/schedule/historical', async (c) => {
    const timestampQuery = c.req.query('timestamp');
    if (!timestampQuery) {
        return c.text('Missing timestamp query parameter', 400);
    }

    let targetTime: Date;
    if (/^\d+$/.test(timestampQuery)) {
        targetTime = new Date(parseInt(timestampQuery));
    } else {
        targetTime = new Date(timestampQuery);
    }

    if (isNaN(targetTime.getTime())) {
        return c.text('Invalid timestamp format', 400);
    }

    // Load records scraped in the 14 days preceding the target time
    const fourteenDaysBeforeTarget = new Date(targetTime.getTime() - 14 * 24 * 60 * 60 * 1000);

    const records = await db.query.vesselMovements.findMany({
        where: and(
            lte(vesselMovements.scrapedAt, targetTime),
            gt(vesselMovements.scrapedAt, fourteenDaysBeforeTarget)
        ),
        orderBy: [desc(vesselMovements.scrapedAt)],
    });

    // Deduplicate physical movements (getting only the latest scraped update/completed/new state of each as of targetTime)
    const uniqueMovements: typeof records = [];
    const processedGroups: {
        vesselName: string;
        movementType: string;
        agent: string | null;
        scrapedAtTimes: Set<number>;
        scheduledTimeHistory: Set<number>;
    }[] = [];

    for (const record of records) {
        const matchingGroup = processedGroups.find(g => {
            if (g.vesselName !== record.vesselName || g.movementType !== record.movementType || g.agent !== record.agent) {
                return false;
            }
            const fromSameScrape = Array.from(g.scrapedAtTimes).some(t => Math.abs(t - record.scrapedAt.getTime()) < 60 * 1000);
            if (fromSameScrape) {
                return false;
            }
            return g.scheduledTimeHistory.has(record.scheduledTime.getTime()) ||
                   Array.from(g.scheduledTimeHistory).some(t => Math.abs(t - record.scheduledTime.getTime()) < 36 * 60 * 60 * 1000);
        });

        if (matchingGroup) {
            matchingGroup.scrapedAtTimes.add(record.scrapedAt.getTime());
            matchingGroup.scheduledTimeHistory.add(record.scheduledTime.getTime());
            const prevVal = record.previousValue as Record<string, any> | null;
            if (prevVal && prevVal.scheduledTime) {
                matchingGroup.scheduledTimeHistory.add(new Date(prevVal.scheduledTime).getTime());
            }
        } else {
            uniqueMovements.push(record);

            const scheduledTimeHistory = new Set<number>([record.scheduledTime.getTime()]);
            const prevVal = record.previousValue as Record<string, any> | null;
            if (prevVal && prevVal.scheduledTime) {
                scheduledTimeHistory.add(new Date(prevVal.scheduledTime).getTime());
            }

            processedGroups.push({
                vesselName: record.vesselName,
                movementType: record.movementType,
                agent: record.agent,
                scrapedAtTimes: new Set<number>([record.scrapedAt.getTime()]),
                scheduledTimeHistory
            });
        }
    }

    // A schedule item is active if it's not REMOVED or COMPLETED as of targetTime.
    // However, if a vessel has an active Departure, we also want to keep its corresponding Arrival (even if COMPLETED)
    // so that the frontend can compute the correct dwell/stay time.
    const activeVesselDepartures = new Set(
        uniqueMovements
            .filter(item => item.movementType === 'Departure' && item.changeType !== 'REMOVED' && item.changeType !== 'COMPLETED')
            .map(item => item.vesselName)
    );

    const activeSchedule = uniqueMovements.filter(item => {
        if (item.changeType === 'REMOVED') return false;
        if (item.changeType === 'COMPLETED') {
            return (item.movementType === 'Arrival' || item.movementType === 'Shift') && activeVesselDepartures.has(item.vesselName);
        }
        return true;
    });

    const cleanedSchedule = activeSchedule.map(item => ({
        id: item.id,
        vesselName: item.vesselName,
        movementType: item.movementType,
        scheduledTime: item.scheduledTime,
        origin: item.origin,
        destination: item.destination,
        expectedTime: item.expectedTime,
        vesselType: item.vesselType,
        agent: item.agent,
        status: item.status
    }));

    return c.json(cleanedSchedule);
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
    // Fetch all completed movements where agent is not null
    const completedMovements = await db.query.vesselMovements.findMany({
        where: and(
            eq(vesselMovements.changeType, 'COMPLETED'),
            sql`${vesselMovements.agent} IS NOT NULL`
        ),
        orderBy: [desc(vesselMovements.scrapedAt)],
    });

    const agentStats: Record<string, {
        total: number;
        delayed: number;
        arrivalDelayed: number;
        arrivalDelayMinutes: number;
        departureDelayed: number;
        departureDelayMinutes: number;
    }> = {};

    for (const completed of completedMovements) {
        const agent = completed.agent!;
        if (!agentStats[agent]) {
            agentStats[agent] = {
                total: 0,
                delayed: 0,
                arrivalDelayed: 0,
                arrivalDelayMinutes: 0,
                departureDelayed: 0,
                departureDelayMinutes: 0
            };
        }

        const stats = agentStats[agent];
        stats.total++;

        // Fetch all history for this vessel and movement type to trace the original scheduled time
        const history = await db.query.vesselMovements.findMany({
            where: and(
                eq(vesselMovements.vesselName, completed.vesselName),
                eq(vesselMovements.movementType, completed.movementType),
                eq(vesselMovements.agent, completed.agent as string)
            ),
            orderBy: [vesselMovements.scrapedAt],
        });

        let matchingRecords = [completed];
        let currentRecord = completed;

        // Scan history backwards to trace the voyage
        const historyReverse = [...history].reverse();
        for (const record of historyReverse) {
            if (record.id === completed.id) continue;
            
            const currentPrevVal = currentRecord.previousValue as Record<string, any> | null;
            let isPrevious = false;
            
            if (currentPrevVal && currentPrevVal.scheduledTime) {
                const prevTime = new Date(currentPrevVal.scheduledTime).getTime();
                if (new Date(record.scheduledTime).getTime() === prevTime) {
                    isPrevious = true;
                }
            } else {
                // Fallback: if no previousValue.scheduledTime, use a 36-hour window
                const timeDiff = Math.abs(new Date(record.scheduledTime).getTime() - new Date(currentRecord.scheduledTime).getTime());
                if (timeDiff < 36 * 60 * 60 * 1000) {
                    isPrevious = true;
                }
            }
            
            if (isPrevious) {
                matchingRecords.push(record);
                currentRecord = record; // step backward
            }
        }

        // Find the oldest record in this matched chain
        if (matchingRecords.length > 0) {
            const originalRecord = matchingRecords[matchingRecords.length - 1];
            
            const originalTime = new Date(originalRecord.scheduledTime).getTime();
            const completedTime = new Date(completed.scheduledTime).getTime();
            const totalDriftMinutes = Math.round((completedTime - originalTime) / (1000 * 60));

            if (totalDriftMinutes > 0) {
                stats.delayed++;
                if (completed.movementType === 'Arrival') {
                    stats.arrivalDelayed++;
                    stats.arrivalDelayMinutes += totalDriftMinutes;
                } else if (completed.movementType === 'Departure') {
                    stats.departureDelayed++;
                    stats.departureDelayMinutes += totalDriftMinutes;
                }
            }
        }
    }

    const result = Object.entries(agentStats).map(([name, stats]) => {
        const onTime = stats.total > 0 ? ((stats.total - stats.delayed) / stats.total) * 100 : 100;
        const avgArrivalDelay = stats.arrivalDelayed > 0 ? stats.arrivalDelayMinutes / stats.arrivalDelayed : 0;
        const avgDepartureDelay = stats.departureDelayed > 0 ? stats.departureDelayMinutes / stats.departureDelayed : 0;
        return {
            agent: name,
            totalPortCalls: stats.total,
            delayedPortCalls: stats.delayed,
            onTimePercentage: parseFloat(onTime.toFixed(1)),
            avgArrivalDelayMinutes: parseFloat(avgArrivalDelay.toFixed(1)),
            avgDepartureDelayMinutes: parseFloat(avgDepartureDelay.toFixed(1)),
        };
    }).sort((a, b) => b.onTimePercentage - a.onTimePercentage || b.totalPortCalls - a.totalPortCalls);

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
        
        // Count only completed movements towards total movements
        if (record.changeType === 'COMPLETED') {
            stats.total++;
        }

        // Calculate delays based on updates
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

    const arrivals = records.filter(r => r.movementType === 'Arrival' && r.changeType === 'COMPLETED');
    const departures = records.filter(r => r.movementType === 'Departure' && r.changeType === 'COMPLETED');

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

    // Group only completed movements by berth for turnaround analysis
    const berthMovements: Record<string, typeof records> = {};
    records.forEach((record) => {
        if (record.changeType !== 'COMPLETED') return;
        const isArrival = record.movementType === 'Arrival';
        const berth = isArrival ? record.destination : record.origin;
        if (!berth) return;

        if (!berthMovements[berth]) {
            berthMovements[berth] = [];
        }
        berthMovements[berth].push(record);
    });

    const berthTurnaroundStats: Record<string, { typicalMinTurnaroundMinutes: number; avgTurnaroundMinutes: number }> = {};
    Object.entries(berthMovements).forEach(([berth, items]) => {
        items.sort((a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime());
        
        const turnarounds: number[] = [];
        for (let i = 0; i < items.length - 1; i++) {
            const current = items[i];
            const next = items[i + 1];
            
            if (current.movementType === 'Departure' && next.movementType === 'Arrival') {
                const diffMs = new Date(next.scheduledTime).getTime() - new Date(current.scheduledTime).getTime();
                if (diffMs > 0) {
                    turnarounds.push(diffMs / (60 * 1000));
                }
            }
        }

        if (turnarounds.length >= 3) {
            turnarounds.sort((a, b) => a - b);
            const avg = turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length;
            const p10 = turnarounds[Math.floor(turnarounds.length * 0.1)];
            berthTurnaroundStats[berth] = {
                typicalMinTurnaroundMinutes: Math.max(15, Math.round(p10)),
                avgTurnaroundMinutes: Math.round(avg),
            };
        } else {
            const avg = turnarounds.length > 0 
                ? turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length 
                : 180;
            berthTurnaroundStats[berth] = {
                typicalMinTurnaroundMinutes: 180, // Default to 3 hours
                avgTurnaroundMinutes: Math.round(avg),
            };
        }
    });

    const result = Object.entries(berthStats)
        .filter(([_, stats]) => stats.stays.length > 0)
        .map(([name, stats]) => {
            const avgDwell = stats.stays.reduce((a, b) => a + b, 0) / stats.stays.length;
            const avgDelay = stats.delayedCount > 0 ? stats.totalDelayMinutes / stats.delayedCount : 0;
            const tStats = berthTurnaroundStats[name] || { typicalMinTurnaroundMinutes: 180, avgTurnaroundMinutes: 180 };

            return {
                berth: name,
                totalMovements: stats.total,
                avgDwellHours: parseFloat(avgDwell.toFixed(1)),
                avgDelayMinutes: parseFloat(avgDelay.toFixed(1)),
                typicalMinTurnaroundMinutes: tStats.typicalMinTurnaroundMinutes,
                avgTurnaroundMinutes: tStats.avgTurnaroundMinutes,
            };
        }).sort((a, b) => b.totalMovements - a.totalMovements);

    return c.json(result);
});

// GET /api/stats/drift
api.get('/stats/drift', async (c) => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Fetch all completed movements in the last 30 days
    const completedMovements = await db.query.vesselMovements.findMany({
        where: and(
            eq(vesselMovements.changeType, 'COMPLETED'),
            gt(vesselMovements.scrapedAt, thirtyDaysAgo)
        ),
        orderBy: [desc(vesselMovements.scrapedAt)],
    });

    const driftByVessel: Record<string, { totalDrift: number; count: number }> = {};
    const driftByAgent: Record<string, {
        arrivalTotalDrift: number;
        arrivalCount: number;
        departureTotalDrift: number;
        departureCount: number;
        totalCount: number;
    }> = {};
    let totalDrift = 0;
    let portCallCount = 0;
    let maxDrift = 0;

    const completedPortCalls: { vesselName: string; movementType: string; driftHours: number; completedAt: string }[] = [];
    const completedTimesOnBerth: {
        vesselName: string;
        actualStayHours: number;
        plannedStayHours: number;
        driftHours: number;
        completedAt: string;
    }[] = [];

    const getOriginalTime = async (movementRecord: any) => {
        const history = await db.query.vesselMovements.findMany({
            where: and(
                eq(vesselMovements.vesselName, movementRecord.vesselName),
                eq(vesselMovements.movementType, movementRecord.movementType),
                eq(vesselMovements.agent, movementRecord.agent as string)
            ),
            orderBy: [vesselMovements.scrapedAt],
        });

        let matchingRecords = [movementRecord];
        let currentRecord = movementRecord;

        const historyReverse = [...history].reverse();
        for (const record of historyReverse) {
            if (record.id === movementRecord.id) continue;
            
            const currentPrevVal = currentRecord.previousValue as Record<string, any> | null;
            let isPrevious = false;
            
            if (currentPrevVal && currentPrevVal.scheduledTime) {
                const prevTime = new Date(currentPrevVal.scheduledTime).getTime();
                if (new Date(record.scheduledTime).getTime() === prevTime) {
                    isPrevious = true;
                }
            } else {
                const timeDiff = Math.abs(new Date(record.scheduledTime).getTime() - new Date(currentRecord.scheduledTime).getTime());
                if (timeDiff < 36 * 60 * 60 * 1000) {
                    isPrevious = true;
                }
            }
            
            if (isPrevious) {
                matchingRecords.push(record);
                currentRecord = record;
            }
        }
        return new Date(matchingRecords[matchingRecords.length - 1].scheduledTime).getTime();
    };

    for (const completed of completedMovements) {
        const originalTime = await getOriginalTime(completed);
        const completedTime = new Date(completed.scheduledTime).getTime();
        const totalDriftMinutes = Math.round((completedTime - originalTime) / (1000 * 60));

        totalDrift += totalDriftMinutes;
        portCallCount++;

        completedPortCalls.push({
            vesselName: completed.vesselName,
            movementType: completed.movementType,
            driftHours: parseFloat((totalDriftMinutes / 60).toFixed(1)),
            completedAt: completed.scrapedAt.toISOString(),
        });

        // Compute Port Stay Duration if it is a completed Departure
        if (completed.movementType === 'Departure') {
            const completedArrival = await db.query.vesselMovements.findFirst({
                where: and(
                    eq(vesselMovements.vesselName, completed.vesselName),
                    eq(vesselMovements.movementType, 'Arrival'),
                    eq(vesselMovements.changeType, 'COMPLETED'),
                    lt(vesselMovements.scheduledTime, completed.scheduledTime)
                ),
                orderBy: [desc(vesselMovements.scheduledTime)],
            });

            if (completedArrival) {
                const originalArrival = await getOriginalTime(completedArrival);
                const actualArrival = new Date(completedArrival.scheduledTime).getTime();
                
                const actualStayHours = parseFloat(((completedTime - actualArrival) / (1000 * 60 * 60)).toFixed(1));
                const plannedStayHours = parseFloat(((originalTime - originalArrival) / (1000 * 60 * 60)).toFixed(1));
                const driftHours = parseFloat((actualStayHours - plannedStayHours).toFixed(1));

                if (actualStayHours > 0 && actualStayHours < 14 * 24) {
                    completedTimesOnBerth.push({
                        vesselName: completed.vesselName,
                        actualStayHours,
                        plannedStayHours,
                        driftHours,
                        completedAt: completed.scrapedAt.toISOString(),
                    });
                }
            }
        }

        if (Math.abs(totalDriftMinutes) > Math.abs(maxDrift)) {
            maxDrift = totalDriftMinutes;
        }

        if (completed.vesselName) {
            if (!driftByVessel[completed.vesselName]) {
                driftByVessel[completed.vesselName] = { totalDrift: 0, count: 0 };
            }
            driftByVessel[completed.vesselName].totalDrift += totalDriftMinutes;
            driftByVessel[completed.vesselName].count++;
        }

        if (completed.agent) {
            if (!driftByAgent[completed.agent]) {
                driftByAgent[completed.agent] = {
                    arrivalTotalDrift: 0,
                    arrivalCount: 0,
                    departureTotalDrift: 0,
                    departureCount: 0,
                    totalCount: 0
                };
            }
            const stats = driftByAgent[completed.agent];
            stats.totalCount++;
            if (completed.movementType === 'Arrival') {
                stats.arrivalTotalDrift += totalDriftMinutes;
                stats.arrivalCount++;
            } else if (completed.movementType === 'Departure') {
                stats.departureTotalDrift += totalDriftMinutes;
                stats.departureCount++;
            }
        }
    }

    const vesselResult = Object.entries(driftByVessel).map(([name, stats]) => ({
        vesselName: name,
        avgDriftMinutes: parseFloat((stats.totalDrift / stats.count).toFixed(1)),
        totalDriftMinutes: stats.totalDrift,
        reschedules: stats.count,
    })).sort((a, b) => b.totalDriftMinutes - a.totalDriftMinutes);

    const agentResult = Object.entries(driftByAgent).map(([name, stats]) => ({
        agent: name,
        reschedules: stats.totalCount,
        avgArrivalDriftMinutes: stats.arrivalCount > 0 ? parseFloat((stats.arrivalTotalDrift / stats.arrivalCount).toFixed(1)) : 0,
        avgDepartureDriftMinutes: stats.departureCount > 0 ? parseFloat((stats.departureTotalDrift / stats.departureCount).toFixed(1)) : 0,
    })).sort((a, b) => b.reschedules - a.reschedules);

    return c.json({
        averageDriftMinutes: portCallCount > 0 ? parseFloat((totalDrift / portCallCount).toFixed(1)) : 0,
        maxDriftMinutes: maxDrift,
        totalRescheduledMovements: portCallCount,
        driftByVessel: vesselResult.slice(0, 10),
        driftByAgent: agentResult.slice(0, 10),
        completedPortCalls: completedPortCalls.reverse(),
        completedTimesOnBerth: completedTimesOnBerth.reverse(),
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
        orderBy: [desc(vesselMovements.scrapedAt)],
    });

    // Deduplicate physical movements (getting only the latest scraped update/completed/new state of each)
    const uniqueMovements: typeof records = [];
    const processedGroups: {
        vesselName: string;
        movementType: string;
        agent: string | null;
        scrapedAtTimes: Set<number>;
        scheduledTimeHistory: Set<number>;
    }[] = [];

    for (const record of records) {
        const matchingGroup = processedGroups.find(g => {
            if (g.vesselName !== record.vesselName || g.movementType !== record.movementType || g.agent !== record.agent) {
                return false;
            }
            const fromSameScrape = Array.from(g.scrapedAtTimes).some(t => Math.abs(t - record.scrapedAt.getTime()) < 60 * 1000);
            if (fromSameScrape) {
                return false;
            }
            return g.scheduledTimeHistory.has(record.scheduledTime.getTime()) ||
                   Array.from(g.scheduledTimeHistory).some(t => Math.abs(t - record.scheduledTime.getTime()) < 36 * 60 * 60 * 1000);
        });

        if (matchingGroup) {
            matchingGroup.scrapedAtTimes.add(record.scrapedAt.getTime());
            matchingGroup.scheduledTimeHistory.add(record.scheduledTime.getTime());
            const prevVal = record.previousValue as Record<string, any> | null;
            if (prevVal && prevVal.scheduledTime) {
                matchingGroup.scheduledTimeHistory.add(new Date(prevVal.scheduledTime).getTime());
            }
        } else {
            uniqueMovements.push(record);

            const scheduledTimeHistory = new Set<number>([record.scheduledTime.getTime()]);
            const prevVal = record.previousValue as Record<string, any> | null;
            if (prevVal && prevVal.scheduledTime) {
                scheduledTimeHistory.add(new Date(prevVal.scheduledTime).getTime());
            }

            processedGroups.push({
                vesselName: record.vesselName,
                movementType: record.movementType,
                agent: record.agent,
                scrapedAtTimes: new Set<number>([record.scrapedAt.getTime()]),
                scheduledTimeHistory
            });
        }
    }

    // Reconstruct stays grouped by berth
    const berthStays: Record<string, { arrival: Date; departure: Date; vesselName: string }[]> = {};

    // First group unique movements by vessel
    const movementsByVessel: Record<string, typeof records> = {};
    uniqueMovements.forEach((record) => {
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
        // Collect overlap intervals
        const intervals: { start: number; end: number }[] = [];

        stays.forEach((stay) => {
            const startMs = stay.arrival.getTime();
            const endMs = stay.departure.getTime();

            const overlapStart = Math.max(startMs, windowStart.getTime());
            const overlapEnd = Math.min(endMs, windowEnd.getTime());

            if (overlapEnd > overlapStart) {
                intervals.push({ start: overlapStart, end: overlapEnd });
            }
        });

        // Merge overlapping intervals to find union of occupied times
        let occupiedMs = 0;
        if (intervals.length > 0) {
            intervals.sort((a, b) => a.start - b.start);
            const merged: { start: number; end: number }[] = [];
            let current = intervals[0];
            for (let i = 1; i < intervals.length; i++) {
                const next = intervals[i];
                if (next.start <= current.end) {
                    current.end = Math.max(current.end, next.end);
                } else {
                    merged.push(current);
                    current = next;
                }
            }
            merged.push(current);
            occupiedMs = merged.reduce((sum, interval) => sum + (interval.end - interval.start), 0);
        }

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
