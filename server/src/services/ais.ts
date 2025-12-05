import WebSocket from 'ws';
import { db } from '../db';
import { vessels, vesselTrips, anchorageEvents, vesselPositions } from '../db/schema';
import { eq, and, desc, isNull, not } from 'drizzle-orm';
import * as geolib from 'geolib';

const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';
const NEWCASTLE_BBOX = [[-33.00, 151.70], [-32.85, 151.95]]; // South-West, North-East

// Approximate polygon for the harbour entrance (The Heads)
const HARBOUR_ENTRANCE_POLYGON = [
    { latitude: -32.913, longitude: 151.796 }, // North West
    { latitude: -32.913, longitude: 151.805 }, // North East
    { latitude: -32.918, longitude: 151.805 }, // South East
    { latitude: -32.918, longitude: 151.796 }, // South West
];

// Approximate polygon for the inner harbour (to detect berthing)
// This is a very rough approximation of the main channel and berths
const INNER_HARBOUR_POLYGON = [
    { latitude: -32.918, longitude: 151.796 }, // Entrance
    { latitude: -32.925, longitude: 151.750 }, // Up river
    { latitude: -32.900, longitude: 151.750 }, // Up river
    { latitude: -32.913, longitude: 151.796 }, // Entrance
];

export function connectAISStream() {
    const apiKey = process.env.AISSTREAM_API_KEY;
    if (!apiKey) {
        console.warn('AISSTREAM_API_KEY not found. AIS service disabled.');
        return;
    }

    const socket = new WebSocket(AISSTREAM_URL);

    socket.on('open', () => {
        console.log('Connected to AIS Stream');
        const subscriptionMessage = {
            APIKey: apiKey,
            BoundingBoxes: [NEWCASTLE_BBOX],
            FiltersShipMMSI: [],
            FilterMessageTypes: ["PositionReport", "ShipStaticData"],
        };
        socket.send(JSON.stringify(subscriptionMessage));
    });

    socket.on('message', async (data: WebSocket.Data) => {
        try {
            const message = JSON.parse(data.toString());
            if (message.MessageType === 'PositionReport') {
                await handlePositionReport(message);
            } else if (message.MessageType === 'ShipStaticData') {
                await handleStaticData(message);
            }
        } catch (error) {
            console.error('Error processing AIS message:', error);
        }
    });

    socket.on('error', (error) => {
        console.error('AIS WebSocket Error:', error);
    });

    socket.on('close', () => {
        console.log('AIS Stream closed. Reconnecting in 5 seconds...');
        setTimeout(connectAISStream, 5000);
    });
}

async function handlePositionReport(message: any) {
    const report = message.Message.PositionReport;
    const mmsi = report.UserID;
    const latitude = report.Latitude;
    const longitude = report.Longitude;
    const speed = report.Sog; // Speed over ground
    const navStatus = report.NavigationalStatus; // 1 = At Anchor
    const cog = report.Cog; // Course over ground
    const rot = report.Rot; // Rate of turn
    const heading = report.TrueHeading; // True heading

    // 1. Update Vessel Last Seen
    // We try to find the vessel by MMSI. If not found, we can't do much until we get StaticData or link it via name.
    // But we might have linked it via name from the scraper already.
    const existingVessel = await db.query.vessels.findFirst({
        where: eq(vessels.mmsi, mmsi),
    });

    if (!existingVessel) {
        // If we don't know this MMSI, we can't track trips yet.
        // We could create a placeholder, but better to wait for StaticData or Scraper link.
        return;
    }

    const now = new Date();
    const isInsideHarbour = geolib.isPointInPolygon(
        { latitude, longitude },
        HARBOUR_ENTRANCE_POLYGON
    ) || geolib.isPointInPolygon(
        { latitude, longitude },
        INNER_HARBOUR_POLYGON
    );

    // Update vessel status
    await db.update(vessels)
        .set({
            lastSeenAt: now,
            isInsideHarbour: isInsideHarbour,
            // Update entry/exit times if state changed
            lastEnteredHarbourAt: !existingVessel.isInsideHarbour && isInsideHarbour ? now : undefined,
            lastLeftHarbourAt: existingVessel.isInsideHarbour && !isInsideHarbour ? now : undefined,
            latitude,
            longitude,
            heading,
            cog,
            rot,
            speed,
            navStatus,
        })
        .where(eq(vessels.id, existingVessel.id));

    // Insert into vessel_positions history
    await db.insert(vesselPositions).values({
        vesselId: existingVessel.id,
        latitude,
        longitude,
        speed,
        heading,
        cog,
        rot,
        navStatus,
        timestamp: now,
    });

    // 2. Trip Management
    if (!existingVessel.isInsideHarbour && isInsideHarbour) {
        // ENTERED HARBOUR
        console.log(`Vessel ${existingVessel.name} entered harbour.`);
        await handleHarbourEntry(existingVessel.id, now);
    } else if (existingVessel.isInsideHarbour && !isInsideHarbour) {
        // LEFT HARBOUR
        console.log(`Vessel ${existingVessel.name} left harbour.`);
        await handleHarbourExit(existingVessel.id, now);
    }

    // 3. Berthing Detection
    // If inside harbour and speed is very low (< 0.5 knots)
    if (isInsideHarbour && speed < 0.5) {
        await handleBerthing(existingVessel.id, now);
    } else if (isInsideHarbour && speed > 0.5) {
        await handleDepartureFromBerth(existingVessel.id, now);
    }

    // 4. Anchorage Detection
    // Status 1 = At Anchor. Must be OUTSIDE harbour.
    if (!isInsideHarbour) {
        if (navStatus === 1) {
            await handleAnchorageStart(existingVessel.id, now);
        } else {
            // If status is NOT 1 (e.g. 0 = Underway), check if we need to close an anchorage event
            await handleAnchorageEnd(existingVessel.id, now);
        }
    } else {
        // If inside harbour, definitely end any anchorage
        await handleAnchorageEnd(existingVessel.id, now);
    }
}

async function handleStaticData(message: any) {
    const report = message.Message.ShipStaticData;
    const mmsi = report.UserID;
    const name = report.Name.trim();
    const callsign = report.CallSign;
    const type = report.Type;
    const length = report.Dimension.A + report.Dimension.B;
    const width = report.Dimension.C + report.Dimension.D;
    const imo = report.ImoNumber;

    // Upsert Vessel
    // Try to find by MMSI first
    let vessel = await db.query.vessels.findFirst({
        where: eq(vessels.mmsi, mmsi),
    });

    if (!vessel) {
        // Try to find by Name (from scraper)
        vessel = await db.query.vessels.findFirst({
            where: eq(vessels.name, name),
        });
    }

    if (vessel) {
        // Update existing
        await db.update(vessels).set({
            mmsi,
            imo,
            callsign,
            vesselType: type.toString(),
            length,
            width,
            lastSeenAt: new Date(),
        }).where(eq(vessels.id, vessel.id));
    } else {
        // Create new
        try {
            await db.insert(vessels).values({
                name,
                mmsi,
                imo,
                callsign,
                vesselType: type.toString(),
                length,
                width,
                lastSeenAt: new Date(),
            });
        } catch (e) {
            // Ignore duplicate name errors if race condition
            console.error('Error inserting vessel:', e);
        }
    }
}

async function handleHarbourEntry(vesselId: number, time: Date) {
    // Check if there is an active trip (INBOUND)
    const activeTrip = await db.query.vesselTrips.findFirst({
        where: and(
            eq(vesselTrips.vesselId, vesselId),
            isNull(vesselTrips.actualDepartureHeads) // Not completed
        ),
        orderBy: desc(vesselTrips.id),
    });

    if (activeTrip) {
        // Update existing trip
        if (!activeTrip.actualArrivalHeads) {
            await db.update(vesselTrips)
                .set({ actualArrivalHeads: time, status: 'INBOUND' })
                .where(eq(vesselTrips.id, activeTrip.id));
        }
    } else {
        // Create new trip
        await db.insert(vesselTrips).values({
            vesselId,
            actualArrivalHeads: time,
            status: 'INBOUND',
        });
    }
}

async function handleHarbourExit(vesselId: number, time: Date) {
    const activeTrip = await db.query.vesselTrips.findFirst({
        where: and(
            eq(vesselTrips.vesselId, vesselId),
            isNull(vesselTrips.actualDepartureHeads)
        ),
        orderBy: desc(vesselTrips.id),
    });

    if (activeTrip) {
        await db.update(vesselTrips)
            .set({ actualDepartureHeads: time, status: 'COMPLETED' })
            .where(eq(vesselTrips.id, activeTrip.id));
    }
}

async function handleBerthing(vesselId: number, time: Date) {
    const activeTrip = await db.query.vesselTrips.findFirst({
        where: and(
            eq(vesselTrips.vesselId, vesselId),
            isNull(vesselTrips.actualDepartureHeads)
        ),
        orderBy: desc(vesselTrips.id),
    });

    if (activeTrip && !activeTrip.actualBerthed) {
        await db.update(vesselTrips)
            .set({ actualBerthed: time, status: 'ALONGSIDE' })
            .where(eq(vesselTrips.id, activeTrip.id));
    }
}

async function handleDepartureFromBerth(vesselId: number, time: Date) {
    const activeTrip = await db.query.vesselTrips.findFirst({
        where: and(
            eq(vesselTrips.vesselId, vesselId),
            eq(vesselTrips.status, 'ALONGSIDE')
        ),
        orderBy: desc(vesselTrips.id),
    });

    if (activeTrip && !activeTrip.actualDepartedBerth) {
        await db.update(vesselTrips)
            .set({ actualDepartedBerth: time, status: 'OUTBOUND' })
            .where(eq(vesselTrips.id, activeTrip.id));
    }
}

async function handleAnchorageStart(vesselId: number, time: Date) {
    // Check if already anchored
    const activeEvent = await db.query.anchorageEvents.findFirst({
        where: and(
            eq(anchorageEvents.vesselId, vesselId),
            eq(anchorageEvents.status, 'ANCHORED')
        )
    });

    if (!activeEvent) {
        console.log(`Vessel ${vesselId} started anchoring.`);
        await db.insert(anchorageEvents).values({
            vesselId,
            arrivalTime: time,
            status: 'ANCHORED'
        });
    }
}

async function handleAnchorageEnd(vesselId: number, time: Date) {
    const activeEvent = await db.query.anchorageEvents.findFirst({
        where: and(
            eq(anchorageEvents.vesselId, vesselId),
            eq(anchorageEvents.status, 'ANCHORED')
        )
    });

    if (activeEvent) {
        console.log(`Vessel ${vesselId} stopped anchoring.`);
        const durationMs = time.getTime() - activeEvent.arrivalTime.getTime();
        const durationMinutes = Math.round(durationMs / (1000 * 60));

        await db.update(anchorageEvents)
            .set({
                departureTime: time,
                durationMinutes,
                status: 'COMPLETED'
            })
            .where(eq(anchorageEvents.id, activeEvent.id));
    }
}
