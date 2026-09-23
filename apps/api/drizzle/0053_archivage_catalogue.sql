ALTER TABLE "ia_prompt" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "character_category" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "piece_category" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "product_category" ADD COLUMN "archived_at" timestamp with time zone;