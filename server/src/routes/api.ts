import { Hono } from 'hono';
import { db } from '../db';
import { vesselMovements, vessels, anchorageEvents, vesselTrips, vesselPositions } from '../db/schema';
import { eq, desc, and, gt, sql, inArray, ne, lt } from 'drizzle-orm';

const api = new Hono();

// GET /api/changes
api.get('/changes', async (c) => {
    const changes = await db.query.vesselMovements.findMany({
        where: and(
            inArray(vesselMovements.changeType, ['NEW', 'UPDATE', 'REMOVED']),
            gt(vesselMovements.scrapedAt, new Date('2025-11-26T03:12:00')),
            ne(vesselMovements.movementType, 'Shift'),
            lt(vesselMovements.scheduledTime, new Date('2025-12-02T00:00:00'))
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
        .where(ne(vesselMovements.movementType, 'Shift'))
        .orderBy(vesselMovements.vesselName, vesselMovements.movementType, desc(vesselMovements.scrapedAt));

    // Filter out any records that are marked as REMOVED
    const activeSchedule = schedule.filter(item => item.changeType !== 'REMOVED');

    return c.json(activeSchedule);
});

// GET /api/removed
api.get('/removed', async (c) => {
    const removed = await db.query.vesselMovements.findMany({
        where: eq(vesselMovements.changeType, 'REMOVED'),
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
            eq(vesselMovements.changeType, 'REMOVED'),
            gt(vesselMovements.scrapedAt, sql`now() - interval '28 days'`)
        ))
        .groupBy(sql`to_char(${vesselMovements.scrapedAt} AT TIME ZONE 'UTC' AT TIME ZONE 'Australia/Sydney', 'YYYY-MM-DD')`)
        .orderBy(sql`to_char(${vesselMovements.scrapedAt} AT TIME ZONE 'UTC' AT TIME ZONE 'Australia/Sydney', 'YYYY-MM-DD')`);

    return c.json(dailyStats);
});

// GET /api/stats/anchorage-wait-times
api.get('/stats/anchorage-wait-times', async (c) => {
    const stats = await db
        .select({
            date: sql<string>`to_char(${anchorageEvents.departureTime} AT TIME ZONE 'UTC' AT TIME ZONE 'Australia/Sydney', 'YYYY-MM-DD')`,
            avgDuration: sql<number>`avg(${anchorageEvents.durationMinutes})::int`,
            count: sql<number>`count(*)::int`
        })
        .from(anchorageEvents)
        .where(and(
            eq(anchorageEvents.status, 'COMPLETED'),
            gt(anchorageEvents.departureTime, sql`now() - interval '30 days'`)
        ))
        .groupBy(sql`to_char(${anchorageEvents.departureTime} AT TIME ZONE 'UTC' AT TIME ZONE 'Australia/Sydney', 'YYYY-MM-DD')`)
        .orderBy(sql`to_char(${anchorageEvents.departureTime} AT TIME ZONE 'UTC' AT TIME ZONE 'Australia/Sydney', 'YYYY-MM-DD')`);

    return c.json(stats);
});

// GET /api/trips
api.get('/trips', async (c) => {
    const trips = await db
        .select({
            id: vesselTrips.id,
            vesselName: vessels.name,
            status: vesselTrips.status,
            scheduledArrival: vesselTrips.scheduledArrival,
            actualArrivalHeads: vesselTrips.actualArrivalHeads,
            actualBerthed: vesselTrips.actualBerthed,
            actualDepartedBerth: vesselTrips.actualDepartedBerth,
            actualDepartureHeads: vesselTrips.actualDepartureHeads,
        })
        .from(vesselTrips)
        .leftJoin(vessels, eq(vesselTrips.vesselId, vessels.id))
        .orderBy(desc(vesselTrips.scheduledArrival))
        .limit(100);

    return c.json(trips);
});

// GET /api/live-map
api.get('/live-map', async (c) => {
    // Get all vessels seen in the last hour
    const liveVessels = await db.query.vessels.findMany({
        where: gt(vessels.lastSeenAt, sql`now() - interval '1 hour'`),
        columns: {
            id: true,
            name: true,
            vesselType: true,
            latitude: true,
            longitude: true,
            heading: true,
            cog: true,
            rot: true,
            length: true,
            width: true,
            lastSeenAt: true,
            isInsideHarbour: true,
            speed: true,
        },
        with: {
            // We need to define the relation in schema.ts first, or just query separately.
            // Since we haven't defined the relation in schema.ts yet (we only added the table),
            // let's query trails separately for now to avoid schema complexity in this step.
        }
    });

    // Fetch trails for these vessels
    const vesselIds = liveVessels.map(v => v.id);
    let trails: Record<number, { latitude: number; longitude: number }[]> = {};

    if (vesselIds.length > 0) {
        // This is a bit inefficient (N+1ish or big query), but for < 50 vessels it's fine.
        // Better approach: Window function to get last 20 positions for each vesselId in the list.

        // For simplicity, let's just fetch recent positions for these vessels and group them in JS.
        // Limit to last 1 hour of positions.
        const positions = await db.query.vesselPositions.findMany({
            where: and(
                inArray(vesselPositions.vesselId, vesselIds),
                gt(vesselPositions.timestamp, sql`now() - interval '1 hour'`)
            ),
            orderBy: [desc(vesselPositions.timestamp)],
            // We can't easily limit per group in simple drizzle query without raw SQL.
            // So we fetch all (within 1 hour) and slice in JS.
        });

        // Group by vesselId
        for (const pos of positions) {
            if (pos.vesselId) {
                if (!trails[pos.vesselId]) {
                    trails[pos.vesselId] = [];
                }
                // Limit to 20 points per vessel
                if (trails[pos.vesselId].length < 20) {
                    trails[pos.vesselId].push({ latitude: pos.latitude, longitude: pos.longitude });
                }
            }
        }
    }

    const result = liveVessels.map(v => ({
        ...v,
        trail: trails[v.id] || []
    }));

    return c.json(result);
});

// GET /api/live-map/history
api.get('/live-map/history', async (c) => {
    // 1. Get positions for the last 24 hours
    const positions = await db
        .select({
            vesselId: vesselPositions.vesselId,
            latitude: vesselPositions.latitude,
            longitude: vesselPositions.longitude,
            heading: vesselPositions.heading,
            speed: vesselPositions.speed,
            timestamp: vesselPositions.timestamp,
        })
        .from(vesselPositions)
        .where(gt(vesselPositions.timestamp, sql`now() - interval '24 hours'`))
        .orderBy(vesselPositions.timestamp);

    // 2. Get unique vessel IDs
    const uniqueVesselIds = [...new Set(positions.map(p => p.vesselId).filter(id => id !== null))] as number[];

    if (uniqueVesselIds.length === 0) {
        return c.json({ positions: [], vessels: {} });
    }

    // 3. Get vessel details
    const vesselDetails = await db
        .select({
            id: vessels.id,
            name: vessels.name,
            vesselType: vessels.vesselType,
            length: vessels.length,
            width: vessels.width,
        })
        .from(vessels)
        .where(inArray(vessels.id, uniqueVesselIds));

    // Convert vessel details to a map for easier lookup
    const vesselsMap = vesselDetails.reduce((acc, v) => {
        acc[v.id] = v;
        return acc;
    }, {} as Record<number, typeof vesselDetails[0]>);

    return c.json({
        positions,
        vessels: vesselsMap
    });
});

export default api;
