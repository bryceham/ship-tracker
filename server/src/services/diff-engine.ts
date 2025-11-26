import { db } from '../db';
import { vesselMovements } from '../db/schema';
import { eq, desc, and } from 'drizzle-orm';
import crypto from 'crypto';

export interface ScrapedVessel {
    vesselName: string;
    movementType: 'Arrival' | 'Departure';
    scheduledTime: Date;
    berth: string;
    status: string;
}

function generateHash(vessel: ScrapedVessel): string {
    const data = `${vessel.vesselName}|${vessel.movementType}|${vessel.scheduledTime.toISOString()}|${vessel.berth}|${vessel.status}`;
    return crypto.createHash('sha256').update(data).digest('hex');
}

export async function processScrapedData(scrapedVessels: ScrapedVessel[]) {
    console.log(`Processing ${scrapedVessels.length} scraped vessels...`);

    // Safety check: If scrape returns 0 vessels, don't mark everything as removed.
    if (scrapedVessels.length === 0) {
        console.warn('Scrape returned 0 vessels. Skipping processing to avoid mass deletion.');
        return;
    }

    const scrapedVesselNames = new Set(scrapedVessels.map(v => v.vesselName));

    // 1. Process Scraped Vessels (New & Updates)
    for (const vessel of scrapedVessels) {
        const currentHash = generateHash(vessel);

        // Find the latest record for this vessel
        const latestRecord = await db.query.vesselMovements.findFirst({
            where: eq(vesselMovements.vesselName, vessel.vesselName),
            orderBy: [desc(vesselMovements.scrapedAt)],
        });

        if (!latestRecord) {
            // New vessel
            console.log(`[NEW] ${vessel.vesselName}`);
            await db.insert(vesselMovements).values({
                vesselName: vessel.vesselName,
                movementType: vessel.movementType,
                scheduledTime: vessel.scheduledTime,
                berth: vessel.berth,
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
                console.log(`[UPDATE] ${vessel.vesselName}`);

                // Calculate diff
                const previousValue: Record<string, any> = {};
                if (latestRecord.scheduledTime.getTime() !== vessel.scheduledTime.getTime()) {
                    previousValue.scheduledTime = latestRecord.scheduledTime;
                }
                if (latestRecord.berth !== vessel.berth) {
                    previousValue.berth = latestRecord.berth;
                }
                if (latestRecord.status !== vessel.status) {
                    previousValue.status = latestRecord.status;
                }
                // If it was previously removed, we don't really have a "diff" in the same way, 
                // but we are re-adding it. The previousValue might just be empty or we could note it was removed.

                await db.insert(vesselMovements).values({
                    vesselName: vessel.vesselName,
                    movementType: vessel.movementType,
                    scheduledTime: vessel.scheduledTime,
                    berth: vessel.berth,
                    status: vessel.status,
                    changeType: 'UPDATE',
                    previousValue: previousValue,
                    hash: currentHash,
                });
            }
        }
    }

    // 2. Process Removed Vessels
    // Find all vessels that are in the DB (latest record is NOT 'REMOVED') 
    // but are NOT in the scrapedVesselNames set.

    // Get all distinct vessel names from DB
    const allVessels = await db.selectDistinctOn([vesselMovements.vesselName])
        .from(vesselMovements)
        .orderBy(vesselMovements.vesselName, desc(vesselMovements.scrapedAt));

    for (const record of allVessels) {
        if (!scrapedVesselNames.has(record.vesselName)) {
            // This vessel is missing from the scrape.
            // Check if it was already marked as removed.
            if (record.changeType !== 'REMOVED') {
                console.log(`[REMOVED] ${record.vesselName}`);

                // Insert a REMOVED record.
                // We keep the last known values but mark it as REMOVED.
                // Hash should probably be updated or just use a random one/null to ensure it's a new event?
                // Actually, if we use the SAME hash, it might look "unchanged" if it reappears exactly the same?
                // No, if it reappears, it will be in the scrape, and we'll compare against this REMOVED record.
                // If the scraped vessel has the same hash as the REMOVED record, it means it's back with same details.
                // But wait, if we insert a REMOVED record, what values do we use?
                // We should probably use the values from the `record` (latest state) but changeType = REMOVED.
                // And maybe update the hash to something indicating removal? 
                // Or just keep the hash same? If we keep hash same, then if it reappears with same details, 
                // the diff engine (step 1) will see latestRecord.hash === currentHash.
                // If latestRecord is REMOVED, we probably want to treat it as NEW or UPDATE (Restored).
                // So we should ensure the hash for a REMOVED record is distinct or handled.
                // Let's just use the same values but changeType='REMOVED'.
                // The hash logic in Step 1 checks `latestRecord.hash === currentHash`.
                // If we re-scrape the same vessel, `currentHash` will be calculated from scraped data.
                // If we store the same hash for REMOVED, then `latestRecord.hash === currentHash` would be true.
                // So we'd skip it. That's WRONG. We want to record it as "Back in port" or "Update".
                // So for REMOVED records, we should perhaps NOT store the vessel hash, or store a special hash.
                // Let's append "|REMOVED" to the hash for the removed record.

                const removedHash = crypto.createHash('sha256').update(record.hash + '|REMOVED').digest('hex');

                await db.insert(vesselMovements).values({
                    vesselName: record.vesselName,
                    movementType: record.movementType,
                    scheduledTime: record.scheduledTime,
                    berth: record.berth,
                    status: record.status,
                    changeType: 'REMOVED',
                    hash: removedHash,
                });
            }
        }
    }
}
