CREATE TABLE "vessel_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"vessel_name" varchar(255) NOT NULL,
	"movement_type" varchar(50) NOT NULL,
	"scheduled_time" timestamp NOT NULL,
	"berth" varchar(255),
	"status" varchar(100),
	"change_type" varchar(20) NOT NULL,
	"previous_value" jsonb,
	"scraped_at" timestamp DEFAULT now() NOT NULL,
	"hash" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE INDEX "vessel_name_idx" ON "vessel_movements" USING btree ("vessel_name");--> statement-breakpoint
CREATE INDEX "scraped_at_idx" ON "vessel_movements" USING btree ("scraped_at");--> statement-breakpoint
CREATE INDEX "hash_idx" ON "vessel_movements" USING btree ("hash");