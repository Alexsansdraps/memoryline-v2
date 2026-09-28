CREATE TABLE "fulfillment_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"fulfillment_id" integer NOT NULL,
	"order_item_id" integer NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fulfillment" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"carrier" text,
	"tracking_number" text,
	"tracking_url" text,
	"status" text DEFAULT 'success' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "order_transaction" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'success' NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"gateway" text,
	"external_ref" text,
	"parent_id" integer,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refund_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"refund_id" integer NOT NULL,
	"order_item_id" integer NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refund" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"shipping_cents" integer DEFAULT 0 NOT NULL,
	"reason" text,
	"note" text,
	"restock" boolean DEFAULT false NOT NULL,
	"gateway" text,
	"external_ref" text,
	"author" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "tags" jsonb;--> statement-breakpoint
ALTER TABLE "variant" ADD COLUMN "sku" text;--> statement-breakpoint
ALTER TABLE "variant" ADD COLUMN "barcode" text;--> statement-breakpoint
ALTER TABLE "variant" ADD COLUMN "compare_at_cents" integer;--> statement-breakpoint
ALTER TABLE "variant" ADD COLUMN "cost_cents" integer;--> statement-breakpoint
ALTER TABLE "variant" ADD COLUMN "stock_qty" integer;--> statement-breakpoint
ALTER TABLE "variant" ADD COLUMN "stock_policy" text DEFAULT 'deny' NOT NULL;--> statement-breakpoint
ALTER TABLE "fulfillment_item" ADD CONSTRAINT "fulfillment_item_fulfillment_id_fulfillment_id_fk" FOREIGN KEY ("fulfillment_id") REFERENCES "public"."fulfillment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_item" ADD CONSTRAINT "fulfillment_item_order_item_id_order_item_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment" ADD CONSTRAINT "fulfillment_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_transaction" ADD CONSTRAINT "order_transaction_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_item" ADD CONSTRAINT "refund_item_refund_id_refund_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refund"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_item" ADD CONSTRAINT "refund_item_order_item_id_order_item_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fulfillment_item_ful_idx" ON "fulfillment_item" USING btree ("fulfillment_id");--> statement-breakpoint
CREATE INDEX "fulfillment_order_idx" ON "fulfillment" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_transaction_order_idx" ON "order_transaction" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "refund_item_refund_idx" ON "refund_item" USING btree ("refund_id");--> statement-breakpoint
CREATE INDEX "refund_order_idx" ON "refund" USING btree ("order_id");