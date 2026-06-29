import dotenv from 'dotenv';
import path from 'path';

// Load from root .env which is two directories up from server/src
dotenv.config({ path: path.join(__dirname, '../../.env') });

// If PGHOST is actually a full connection string, use that as the database connection string
let connectionString = process.env.DATABASE_URL;
if (process.env.PGHOST && (process.env.PGHOST.startsWith('postgres://') || process.env.PGHOST.startsWith('postgresql://'))) {
    connectionString = process.env.PGHOST;
    // Delete pg override env vars so pg doesn't get confused
    delete process.env.PGHOST;
    delete process.env.PGUSER;
    delete process.env.PGPASSWORD;
    delete process.env.PGPORT;
    delete process.env.PGDATABASE;
}

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../src/db/schema';

const pool = new Pool({
    connectionString,
});
const db = drizzle(pool, { schema });

async function main() {
    console.log('Connecting to:', connectionString ? connectionString.replace(/:[^:@]+@/, ':***@') : 'undefined');
    const records = await db.query.vesselMovements.findMany();
    console.log(`Fetched ${records.length} records.`);

    // Group by berth
    const berthMovements: Record<string, any[]> = {};
    records.forEach((record) => {
        const isArrival = record.movementType === 'Arrival';
        const berth = isArrival ? record.destination : record.origin;
        if (!berth) return;

        if (!berthMovements[berth]) {
            berthMovements[berth] = [];
        }
        berthMovements[berth].push(record);
    });

    console.log('\nBerths found:', Object.keys(berthMovements));

    Object.entries(berthMovements).forEach(([berth, items]) => {
        // Sort by scheduled time
        items.sort((a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime());
        
        const turnarounds: number[] = []; // in minutes
        for (let i = 0; i < items.length - 1; i++) {
            const current = items[i];
            const next = items[i + 1];
            
            // Turnaround is the time between one vessel's departure and the next vessel's arrival
            const isDepToArr = current.movementType === 'Departure' && next.movementType === 'Arrival';
            const diffMs = new Date(next.scheduledTime).getTime() - new Date(current.scheduledTime).getTime();
            
            if (isDepToArr && diffMs > 0) {
                turnarounds.push(diffMs / (60 * 1000)); // minutes
            }
        }

        if (turnarounds.length > 0) {
            turnarounds.sort((a, b) => a - b);
            const min = turnarounds[0];
            const max = turnarounds[turnarounds.length - 1];
            const avg = turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length;
            const p10 = turnarounds[Math.floor(turnarounds.length * 0.1)];
            console.log(`Berth [${berth}]:`);
            console.log(`  Count of Depart -> Arrive sequences: ${turnarounds.length}`);
            console.log(`  Min turnaround: ${min.toFixed(1)} mins (${(min / 60).toFixed(1)}h)`);
            console.log(`  10th percentile: ${p10.toFixed(1)} mins (${(p10 / 60).toFixed(1)}h)`);
            console.log(`  Avg turnaround: ${avg.toFixed(1)} mins (${(avg / 60).toFixed(1)}h)`);
        } else {
            console.log(`Berth [${berth}]: No consecutive Departure -> Arrival sequences found.`);
        }
    });

    await pool.end();
}

main().catch(console.error);
