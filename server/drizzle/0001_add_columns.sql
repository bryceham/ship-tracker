-- Re-aligns the old schema (from Phase 1)
ALTER TABLE "vessel_movements" RENAME COLUMN "berth" TO "origin";
ALTER TABLE "vessel_movements" ADD COLUMN "destination" varchar(255);
-- Adds the new analytics columns (from Phase 2)
ALTER TABLE "vessel_movements" ADD COLUMN "expected_time" timestamp;
ALTER TABLE "vessel_movements" ADD COLUMN "vessel_type" varchar(100);
ALTER TABLE "vessel_movements" ADD COLUMN "agent" varchar(100);