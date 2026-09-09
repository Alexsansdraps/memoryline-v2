ALTER TABLE "collection" ADD COLUMN "default_weight_grams" integer;--> statement-breakpoint
ALTER TABLE "collection" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "page" ADD COLUMN "affichage" text DEFAULT 'site' NOT NULL;