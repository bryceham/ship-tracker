import { Hono } from 'hono';
import { db } from '../db';
import { vesselMovements } from '../db/schema';
import { desc, eq, inArray, sql, gt, and } from 'drizzle-orm';

const api = new Hono();

// GET /api/changes
api.get('/changes', async (c) => {
    const changes = await db.query.vesselMovements.findMany({
        where: and(
            inArray(vesselMovements.changeType, ['NEW', 'UPDATE', 'REMOVED']),
            gt(vesselMovements.scrapedAt, new Date('2025-11-26T03:12:00'))
        ),
        orderBy: [desc(vesselMovements.scrapedAt)],
        limit: 50,
    });
    return c.json(changes);
});

// GET /api/schedule
api.get('/schedule', async (c) => {
    const schedule = await db
        .selectDistinctOn([vesselMovements.vesselName, vesselMovements.movementType])
        .from(vesselMovements)
        .orderBy(vesselMovements.vesselName, vesselMovements.movementType, desc(vesselMovements.scrapedAt));

    return c.json(schedule);
});

export default api;
