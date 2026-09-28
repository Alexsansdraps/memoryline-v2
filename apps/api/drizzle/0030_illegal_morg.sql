ALTER TABLE "product" ADD COLUMN "vendor" text;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "product_type" text;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "tags" jsonb;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "seo_title" text;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "seo_description" text;