import { Hono } from 'hono';
import { db } from '../db';
import { vesselMovements, vessels, anchorageEvents, vesselTrips } from '../db/schema';
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
            lastSeenAt: true,
            isInsideHarbour: true,
            // This field doesn't exist on vessels table, it's on vesselMovements or inferred. 
            // Actually schema says vessels has no status field. 
            // But we might want to return if it's anchored or alongside based on other tables?
            // For now let's just return what's on the vessel table.
        }
    });

    // We might want to enrich this with status from trips or anchorage events?
    // For simplicity, let's just return the raw vessel data first.
    // The frontend can infer status or we can add it later.

    return c.json(liveVessels);
});

export default api;
