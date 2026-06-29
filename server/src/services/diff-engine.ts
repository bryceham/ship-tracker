import { db } from '../db';
import { vesselMovements } from '../db/schema';
import { eq, desc, and, gt, inArray } from 'drizzle-orm';
import crypto from 'crypto';

export interface ScrapedVessel {
    vesselName: string;
    movementType: 'Arrival' | 'Departure' | 'Shift';
    scheduledTime: Date;
    origin: string;
    destination: string;
    status: string;
    expectedTime?: Date | null;
    vesselType?: string | null;
    agent?: string | null;
}

function generateHash(vessel: ScrapedVessel): string {
    const expectedTimeStr = vessel.expectedTime ? vessel.expectedTime.toISOString() : 'N/A';
    const data = `${vessel.vesselName}|${vessel.movementType}|${vessel.scheduledTime.toISOString()}|${vessel.origin}|${vessel.destination}|${vessel.status}|${expectedTimeStr}|${vessel.vesselType || ''}|${vessel.agent || ''}`;
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
        expectedTime: Date | null;
        vesselType: string | null;
        agent: string | null;
        hash: string;
        matched: boolean;
    }

    const activeMovements: ActiveMovement[] = [];
    const processedGroups: { vesselName: string; movementType: string; scheduledTimeHistory: Set<number> }[] = [];

    for (const record of recentRecords) {
        // Group together DB entries that refer to the same physical movement
        // We look for all records that belong to the same update chain or fall within a 36-hour fallback window
        const matchingGroup = processedGroups.find(g =>
            g.vesselName === record.vesselName &&
            g.movementType === record.movementType &&
            (g.scheduledTimeHistory.has(record.scheduledTime.getTime()) ||
             Array.from(g.scheduledTimeHistory).some(t => Math.abs(t - record.scheduledTime.getTime()) < 36 * 60 * 60 * 1000))
        );

        if (matchingGroup) {
            matchingGroup.scheduledTimeHistory.add(record.scheduledTime.getTime());
            const prevVal = record.previousValue as Record<string, any> | null;
            if (prevVal && prevVal.scheduledTime) {
                matchingGroup.scheduledTimeHistory.add(new Date(prevVal.scheduledTime).getTime());
            }
        } else {
            const scheduledTimeHistory = new Set<number>([record.scheduledTime.getTime()]);
            const prevVal = record.previousValue as Record<string, any> | null;
            if (prevVal && prevVal.scheduledTime) {
                scheduledTimeHistory.add(new Date(prevVal.scheduledTime).getTime());
            }

            processedGroups.push({
                vesselName: record.vesselName,
                movementType: record.movementType,
                scheduledTimeHistory
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
                    expectedTime: record.expectedTime,
                    vesselType: record.vesselType,
                    agent: record.agent,
                    hash: record.hash,
                    matched: false
                });
            }
        }
    }

    // 2. Process Scraped Vessels (New & Updates)
    for (const vessel of scrapedVessels) {
        const currentHash = generateHash(vessel);

        // Find matching active movement in the database by vessel name, type, and proximity in time.
        // We find all candidate active movements within 120 hours (5 days).
        const candidateMovements = activeMovements.filter(am =>
            !am.matched &&
            am.vesselName === vessel.vesselName &&
            am.movementType === vessel.movementType &&
            Math.abs(am.scheduledTime.getTime() - vessel.scheduledTime.getTime()) < 120 * 60 * 60 * 1000
        );

        let matchedActive: ActiveMovement | undefined = undefined;
        if (candidateMovements.length > 0) {
            // Sort by a combination of stable field matches (agent, vesselType, origin/destination) and proximity
            candidateMovements.sort((a, b) => {
                const diffA = Math.abs(a.scheduledTime.getTime() - vessel.scheduledTime.getTime());
                const diffB = Math.abs(b.scheduledTime.getTime() - vessel.scheduledTime.getTime());

                // Calculate tie-breaker score (lower score = better match)
                let scoreA = 0;
                let scoreB = 0;

                if (a.vesselType !== vessel.vesselType) scoreA += 1;
                if (b.vesselType !== vessel.vesselType) scoreB += 1;

                if (a.agent !== vessel.agent) scoreA += 1;
                if (b.agent !== vessel.agent) scoreB += 1;

                const isArrival = vessel.movementType === 'Arrival';
                const locationField = isArrival ? 'destination' : 'origin';
                if (a[locationField] !== vessel[locationField]) scoreA += 1;
                if (b[locationField] !== vessel[locationField]) scoreB += 1;

                // Primary sort by score (stable fields match), secondary sort by proximity
                if (scoreA !== scoreB) {
                    return scoreA - scoreB;
                }
                return diffA - diffB;
            });
            matchedActive = candidateMovements[0];
        }

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
                expectedTime: vessel.expectedTime,
                vesselType: vessel.vesselType,
                agent: vessel.agent,
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
                if (matchedActive.expectedTime?.getTime() !== vessel.expectedTime?.getTime()) {
                    previousValue.expectedTime = matchedActive.expectedTime;
                }
                if (matchedActive.vesselType !== vessel.vesselType) {
                    previousValue.vesselType = matchedActive.vesselType;
                }
                if (matchedActive.agent !== vessel.agent) {
                    previousValue.agent = matchedActive.agent;
                }

                await db.insert(vesselMovements).values({
                    vesselName: vessel.vesselName,
                    movementType: vessel.movementType,
                    scheduledTime: vessel.scheduledTime,
                    origin: vessel.origin,
                    destination: vessel.destination,
                    status: vessel.status,
                    expectedTime: vessel.expectedTime,
                    vesselType: vessel.vesselType,
                    agent: vessel.agent,
                    changeType: 'UPDATE',
                    previousValue: previousValue,
                    hash: currentHash,
                });

                // Update in-memory reference in case we inspect it again
                matchedActive.scheduledTime = vessel.scheduledTime;
                matchedActive.origin = vessel.origin;
                matchedActive.destination = vessel.destination;
                matchedActive.status = vessel.status;
                matchedActive.expectedTime = vessel.expectedTime ?? null;
                matchedActive.vesselType = vessel.vesselType ?? null;
                matchedActive.agent = vessel.agent ?? null;
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
                expectedTime: record.expectedTime,
                vesselType: record.vesselType,
                agent: record.agent,
                changeType: finalChangeType,
                hash: newHash,
            });
        }
    }
}

export async function cleanupPingPongRecords() {
    console.log('Running database cleanup for ping-pong updates...');
    const allMovements = await db.query.vesselMovements.findMany({
        orderBy: [desc(vesselMovements.scrapedAt)],
    });

    const idsToDelete: number[] = [];

    // Group by vesselName and movementType
    const groups = new Map<string, typeof allMovements>();
    for (const m of allMovements) {
        const key = `${m.vesselName}|${m.movementType}`;
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key)!.push(m);
    }

    for (const [key, list] of groups.entries()) {
        // Since list is ordered by scrapedAt DESC, we reverse it to process chronologically
        const chronologicalList = [...list].reverse();
        let i = 0;
        while (i < chronologicalList.length - 1) {
            const current = chronologicalList[i];
            const next = chronologicalList[i + 1];

            if (current.changeType === 'UPDATE' && next.changeType === 'UPDATE') {
                const currentPrev = current.previousValue as Record<string, any> | null;
                const nextPrev = next.previousValue as Record<string, any> | null;

                if (currentPrev && nextPrev) {
                    const currentPrevTime = currentPrev.scheduledTime ? new Date(currentPrev.scheduledTime).getTime() : null;
                    const currentNewTime = current.scheduledTime.getTime();
                    const nextPrevTime = nextPrev.scheduledTime ? new Date(nextPrev.scheduledTime).getTime() : null;
                    const nextNewTime = next.scheduledTime.getTime();

                    const timeDiff = Math.abs(next.scrapedAt.getTime() - current.scrapedAt.getTime());

                    if (currentPrevTime === nextNewTime && currentNewTime === nextPrevTime && timeDiff < 30 * 60 * 1000) {
                        console.log(`Identified ping-pong update pair for ${key}: IDs ${current.id} and ${next.id}`);
                        idsToDelete.push(current.id);
                        idsToDelete.push(next.id);
                        i += 2;
                        continue;
                    }
                }
            }
            i++;
        }
    }

    if (idsToDelete.length > 0) {
        console.log(`Deleting ${idsToDelete.length} ping-pong update records...`);
        for (let i = 0; i < idsToDelete.length; i += 100) {
            const chunk = idsToDelete.slice(i, i + 100);
            await db.delete(vesselMovements).where(inArray(vesselMovements.id, chunk));
        }
        console.log('Cleanup completed successfully.');
    } else {
        console.log('No ping-pong records found to clean up.');
    }
}
