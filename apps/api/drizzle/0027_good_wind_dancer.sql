CREATE TABLE "product_category" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"default_weight_grams" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "shipping_rate_uniq";--> statement-breakpoint
ALTER TABLE "frame" ADD COLUMN "weight_grams" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "weight_grams" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "category_id" integer;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "weight_grams" integer;--> statement-breakpoint
ALTER TABLE "shipping_rate" ADD COLUMN "min_weight_grams" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shipping_rate" ADD COLUMN "max_weight_grams" integer;--> statement-breakpoint
ALTER TABLE "variant" ADD COLUMN "weight_grams" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "product_category_slug_uniq" ON "product_category" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_category_id_product_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."product_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shipping_rate_uniq" ON "shipping_rate" USING btree ("method_id","zone_id","min_weight_grams");