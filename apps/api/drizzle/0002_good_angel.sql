ALTER TABLE "character_type" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "character_type" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "character_type" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "character_type_category_idx" ON "character_type" USING btree ("category","position");