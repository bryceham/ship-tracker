import { pgTable, serial, varchar, timestamp, jsonb, index } from 'drizzle-orm/pg-core';

export const vesselMovements = pgTable('vessel_movements', {
  id: serial('id').primaryKey(),
  vesselName: varchar('vessel_name', { length: 255 }).notNull(),
  movementType: varchar('movement_type', { length: 50 }).notNull(), // 'Arrival', 'Departure'
  scheduledTime: timestamp('scheduled_time').notNull(),
  origin: varchar('origin', { length: 255 }),
  destination: varchar('destination', { length: 255 }),
  expectedTime: timestamp('expected_time'),
  vesselType: varchar('vessel_type', { length: 100 }),
  agent: varchar('agent', { length: 100 }),

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
