-- Custom SQL migration file, put your code below! --
ALTER TABLE "vessel_movements" ADD COLUMN "expected_time" timestamp;
ALTER TABLE "vessel_movements" ADD COLUMN "vessel_type" varchar(100);
ALTER TABLE "vessel_movements" ADD COLUMN "agent" varchar(100);