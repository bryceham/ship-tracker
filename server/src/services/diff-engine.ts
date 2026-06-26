import { db } from '../db';
import { vesselMovements } from '../db/schema';
import { eq, desc, and, gt } from 'drizzle-orm';
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

    // 1. Fetch recent records from the database to find active movements
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const recentRecords = await db.query.vesselMovements.findMany({
        where: gt(vesselMovements.scrapedAt, fourteenDaysAgo),
        orderBy: [desc(vesselMovements.scrapedAt)],
    });

    interface ActiveMovement {
        id: number;
        vesselName: string;
        movementType: string;
        scheduledTime: Date;
        origin: string | null;
        destination: string | null;
        status: string | null;
        hash: string;
        matched: boolean;
    }

    const activeMovements: ActiveMovement[] = [];
    const processedGroups: { vesselName: string; movementType: string; scheduledTime: Date }[] = [];

    for (const record of recentRecords) {
        // Group together DB entries that refer to the same physical movement
        // (same vessel, type, and scheduled time within 36 hours of each other)
        const isSameGroup = processedGroups.some(g =>
            g.vesselName === record.vesselName &&
            g.movementType === record.movementType &&
            Math.abs(g.scheduledTime.getTime() - record.scheduledTime.getTime()) < 36 * 60 * 60 * 1000
        );

        if (!isSameGroup) {
            processedGroups.push({
                vesselName: record.vesselName,
                movementType: record.movementType,
                scheduledTime: record.scheduledTime
            });

            // If the latest state of this movement is active, add it to our tracking array
            if (record.changeType !== 'REMOVED' && record.changeType !== 'COMPLETED') {
                activeMovements.push({
                    id: record.id,
                    vesselName: record.vesselName,
                    movementType: record.movementType,
                    scheduledTime: record.scheduledTime,
                    origin: record.origin,
                    destination: record.destination,
                    status: record.status,
                    hash: record.hash,
                    matched: false
                });
            }
        }
    }

    // 2. Process Scraped Vessels (New & Updates)
    for (const vessel of scrapedVessels) {
        const currentHash = generateHash(vessel);

        // Find matching active movement in the database by vessel name, type, and proximity in time
        const matchedActive = activeMovements.find(am =>
            am.vesselName === vessel.vesselName &&
            am.movementType === vessel.movementType &&
            Math.abs(am.scheduledTime.getTime() - vessel.scheduledTime.getTime()) < 36 * 60 * 60 * 1000
        );

        if (!matchedActive) {
            // New vessel movement (or reappearing after being marked completed/removed)
            console.log(`[NEW] ${vessel.vesselName} (${vessel.movementType}) scheduled at ${vessel.scheduledTime}`);
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
            matchedActive.matched = true;

            if (matchedActive.hash !== currentHash) {
                // Changed
                console.log(`[UPDATE] ${vessel.vesselName} (${vessel.movementType})`);

                // Calculate diff
                const previousValue: Record<string, any> = {};
                if (matchedActive.scheduledTime.getTime() !== vessel.scheduledTime.getTime()) {
                    previousValue.scheduledTime = matchedActive.scheduledTime;
                }
                if (matchedActive.origin !== vessel.origin) {
                    previousValue.origin = matchedActive.origin;
                }
                if (matchedActive.destination !== vessel.destination) {
                    previousValue.destination = matchedActive.destination;
                }
                if (matchedActive.status !== vessel.status) {
                    previousValue.status = matchedActive.status;
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

                // Update in-memory reference in case we inspect it again
                matchedActive.scheduledTime = vessel.scheduledTime;
                matchedActive.origin = vessel.origin;
                matchedActive.destination = vessel.destination;
                matchedActive.status = vessel.status;
                matchedActive.hash = currentHash;
            }
        }
    }

    // 3. Process Unmatched Active Movements (Completed or Removed)
    for (const record of activeMovements) {
        if (!record.matched) {
            const now = new Date();
            // If the scheduled time has passed, it completed naturally. Otherwise, it was removed (cancelled).
            const isCompleted = now.getTime() >= record.scheduledTime.getTime();
            const finalChangeType = isCompleted ? 'COMPLETED' : 'REMOVED';

            console.log(`[${finalChangeType}] ${record.vesselName} (${record.movementType})`);

            const newHash = crypto.createHash('sha256').update(record.hash + `|${finalChangeType}`).digest('hex');

            await db.insert(vesselMovements).values({
                vesselName: record.vesselName,
                movementType: record.movementType,
                scheduledTime: record.scheduledTime,
                origin: record.origin,
                destination: record.destination,
                status: record.status,
                changeType: finalChangeType,
                hash: newHash,
            });
        }
    }
}
