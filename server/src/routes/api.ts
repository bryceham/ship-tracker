import { Hono } from 'hono';
import { db } from '../db';
import { vesselMovements } from '../db/schema';
import { desc, eq, inArray, sql } from 'drizzle-orm';

const api = new Hono();

// GET /api/changes
api.get('/changes', async (c) => {
    const changes = await db.query.vesselMovements.findMany({
        where: inArray(vesselMovements.changeType, ['NEW', 'UPDATE']),
        orderBy: [desc(vesselMovements.scrapedAt)],
        limit: 50,
    });
    return c.json(changes);
});

// GET /api/schedule
api.get('/schedule', async (c) => {
    const schedule = await db
        .selectDistinctOn([vesselMovements.vesselName])
        .from(vesselMovements)
        .orderBy(vesselMovements.vesselName, desc(vesselMovements.scrapedAt));

    return c.json(schedule);
});

export default api;
