import { db } from '../db';
import { vesselMovements } from '../db/schema';
import { eq, desc, and } from 'drizzle-orm';
import crypto from 'crypto';

export interface ScrapedVessel {
    vesselName: string;
    movementType: 'Arrival' | 'Departure' | 'Shift';
    scheduledTime: Date;
    origin: string;
    destination: string;

    status: string;
}

function generateHash(vessel: ScrapedVessel): string {
    const data = `${vessel.vesselName}|${vessel.movementType}|${vessel.scheduledTime.toISOString()}|${vessel.origin}|${vessel.destination}|${vessel.status}`;
    return crypto.createHash('sha256').update(data).digest('hex');
}

export async function processScrapedData(scrapedVessels: ScrapedVessel[]) {
    console.log(`Processing ${scrapedVessels.length} scraped vessels...`);

    // Safety check: If scrape returns 0 vessels, don't mark everything as removed.
    if (scrapedVessels.length === 0) {
        console.warn('Scrape returned 0 vessels. Skipping processing to avoid mass deletion.');
        return;
    }

    // Create a set of unique keys for the current scrape: "VesselName|MovementType"
    const scrapedKeys = new Set(scrapedVessels.map(v => `${v.vesselName}|${v.movementType}`));

    // 1. Process Scraped Vessels (New & Updates)
    for (const vessel of scrapedVessels) {
        const currentHash = generateHash(vessel);

        // Find the latest record for this vessel AND movement type
        const latestRecord = await db.query.vesselMovements.findFirst({
            where: and(
                eq(vesselMovements.vesselName, vessel.vesselName),
                eq(vesselMovements.movementType, vessel.movementType)
            ),
            orderBy: [desc(vesselMovements.scrapedAt)],
        });

        if (vessel.vesselName === 'African Condor' || vessel.vesselName === 'Foxton') continue

        if (!latestRecord || latestRecord.changeType === 'REMOVED') {
            // New vessel movement (or reappearing after being removed)
            console.log(`[NEW] ${vessel.vesselName} (${vessel.movementType})`);
            await db.insert(vesselMovements).values({
                vesselName: vessel.vesselName,
                movementType: vessel.movementType,
                scheduledTime: vessel.scheduledTime,
                origin: vessel.origin,
                destination: vessel.destination,

                status: vessel.status,
                changeType: 'NEW',
                hash: currentHash,
            });
        } else {
            if (latestRecord.hash === currentHash) {
                // Identical, do nothing
                continue;
            } else {
                // Changed
                console.log(`[UPDATE] ${vessel.vesselName} (${vessel.movementType})`);

                // Calculate diff
                const previousValue: Record<string, any> = {};
                if (latestRecord.scheduledTime.getTime() !== vessel.scheduledTime.getTime()) {
                    previousValue.scheduledTime = latestRecord.scheduledTime;
                }

                if (latestRecord.origin !== vessel.origin) {
                    previousValue.origin = latestRecord.origin;
                }
                if (latestRecord.destination !== vessel.destination) {
                    previousValue.destination = latestRecord.destination;
                }
                if (latestRecord.status !== vessel.status) {
                    previousValue.status = latestRecord.status;
                }

                await db.insert(vesselMovements).values({
                    vesselName: vessel.vesselName,
                    movementType: vessel.movementType,
                    scheduledTime: vessel.scheduledTime,
                    origin: vessel.origin,
                    destination: vessel.destination,

                    status: vessel.status,
                    changeType: 'UPDATE',
                    previousValue: previousValue,
                    hash: currentHash,
                });
            }
        }
    }

    // 2. Process Removed Vessels
    // Find all vessel movements that are in the DB (latest record is NOT 'REMOVED') 
    // but are NOT in the scrapedKeys set.

    // Get all distinct vessel movements (Name + Type) from DB
    const allMovements = await db.selectDistinctOn([vesselMovements.vesselName, vesselMovements.movementType])
        .from(vesselMovements)
        .orderBy(vesselMovements.vesselName, vesselMovements.movementType, desc(vesselMovements.scrapedAt));

    for (const record of allMovements) {
        const key = `${record.vesselName}|${record.movementType}`;
        if (!scrapedKeys.has(key)) {
            // This movement is missing from the scrape.
            // Check if it was already marked as removed.
            if (record.changeType !== 'REMOVED') {
                console.log(`[REMOVED] ${record.vesselName} (${record.movementType})`);

                const removedHash = crypto.createHash('sha256').update(record.hash + '|REMOVED').digest('hex');

                await db.insert(vesselMovements).values({
                    vesselName: record.vesselName,
                    movementType: record.movementType,
                    scheduledTime: record.scheduledTime,
                    origin: record.origin,
                    destination: record.destination,

                    status: record.status,
                    changeType: 'REMOVED',
                    hash: removedHash,
                });
            }
        }
    }
}
