ALTER TABLE "background" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "collection" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "menu_item" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "page" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "poster_view" ADD COLUMN "archived_at" timestamp with time zone;