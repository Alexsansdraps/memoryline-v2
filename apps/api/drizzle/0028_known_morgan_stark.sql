CREATE TABLE "ai_generation" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"product_id" integer,
	"cart_id" text,
	"order_item_id" integer,
	"customer_id" integer,
	"source_path" text,
	"prompt" text,
	"model" text,
	"size" text,
	"status" text DEFAULT 'en_cours' NOT NULL,
	"preview_path" text,
	"full_path" text,
	"erreur" text,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "ai_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "ai_style_prompt" text;--> statement-breakpoint
ALTER TABLE "ai_generation" ADD CONSTRAINT "ai_generation_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generation" ADD CONSTRAINT "ai_generation_order_item_id_order_item_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generation" ADD CONSTRAINT "ai_generation_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_generation_public_id_uniq" ON "ai_generation" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "ai_generation_cart_idx" ON "ai_generation" USING btree ("cart_id");--> statement-breakpoint
CREATE INDEX "ai_generation_created_idx" ON "ai_generation" USING btree ("created_at");