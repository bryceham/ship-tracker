import { pgTable, serial, varchar, timestamp, jsonb, index, integer, boolean, doublePrecision } from 'drizzle-orm/pg-core';

export const vesselMovements = pgTable('vessel_movements', {
  id: serial('id').primaryKey(),
  vesselName: varchar('vessel_name', { length: 255 }).notNull(),
  movementType: varchar('movement_type', { length: 50 }).notNull(), // 'Arrival', 'Departure'
  scheduledTime: timestamp('scheduled_time').notNull(),
  origin: varchar('origin', { length: 255 }),
  destination: varchar('destination', { length: 255 }),
  vesselType: varchar('vessel_type', { length: 100 }),
  vesselAgent: varchar('vessel_agent', { length: 100 }),
  etaBradleys: varchar('eta_bradleys', { length: 50 }),

  status: varchar('status', { length: 100 }),
  changeType: varchar('change_type', { length: 20 }).notNull(), // 'NEW', 'UPDATE', 'UNCHANGED'
  previousValue: jsonb('previous_value'), // Stores the old values if updated
  scrapedAt: timestamp('scraped_at').defaultNow().notNull(),
  hash: varchar('hash', { length: 64 }).notNull(), // Unique hash for deduping
}, (table) => {
  return {
    vesselNameIdx: index('vessel_name_idx').on(table.vesselName),
    scrapedAtIdx: index('scraped_at_idx').on(table.scrapedAt),
    hashIdx: index('hash_idx').on(table.hash),
  };
});

export const vessels = pgTable('vessels', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  mmsi: integer('mmsi').unique(),
  imo: integer('imo'),
  callsign: varchar('callsign', { length: 50 }),
  vesselType: varchar('vessel_type', { length: 100 }),
  length: integer('length'),
  width: integer('width'),
  lastSeenAt: timestamp('last_seen_at'),
  lastEnteredHarbourAt: timestamp('last_entered_harbour_at'),
  lastLeftHarbourAt: timestamp('last_left_harbour_at'),
  isInsideHarbour: boolean('is_inside_harbour').default(false),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  heading: doublePrecision('heading'),
  cog: doublePrecision('cog'),
  rot: doublePrecision('rot'),
  speed: doublePrecision('speed'),
  draught: doublePrecision('draught'),
  navStatus: integer('nav_status'),
});

export const vesselTrips = pgTable('vessel_trips', {
  id: serial('id').primaryKey(),
  vesselId: integer('vessel_id').references(() => vessels.id),
  scheduledArrival: timestamp('scheduled_arrival'),
  scheduledDeparture: timestamp('scheduled_departure'),
  actualArrivalHeads: timestamp('actual_arrival_heads'),
  actualBerthed: timestamp('actual_berthed'),
  actualDepartedBerth: timestamp('actual_departed_berth'),
  actualDepartureHeads: timestamp('actual_departure_heads'),
  status: varchar('status', { length: 50 }), // 'INBOUND', 'ALONGSIDE', 'OUTBOUND', 'COMPLETED'
});

export const anchorageEvents = pgTable('anchorage_events', {
  id: serial('id').primaryKey(),
  vesselId: integer('vessel_id').references(() => vessels.id),
  arrivalTime: timestamp('arrival_time').notNull(),
  departureTime: timestamp('departure_time'),
  durationMinutes: integer('duration_minutes'),
  status: varchar('status', { length: 50 }), // 'ANCHORED', 'COMPLETED'
});

export const vesselPositions = pgTable('vessel_positions', {
  id: serial('id').primaryKey(),
  vesselId: integer('vessel_id').references(() => vessels.id),
  latitude: doublePrecision('latitude').notNull(),
  longitude: doublePrecision('longitude').notNull(),
  speed: doublePrecision('speed'),
  heading: doublePrecision('heading'),
  cog: doublePrecision('cog'),
  rot: doublePrecision('rot'),
  navStatus: integer('nav_status'),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
}, (table) => {
  return {
    vesselIdIdx: index('vessel_id_idx').on(table.vesselId),
    timestampIdx: index('timestamp_idx').on(table.timestamp),
  };
});
