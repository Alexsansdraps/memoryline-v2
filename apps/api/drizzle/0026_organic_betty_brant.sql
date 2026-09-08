CREATE TABLE "customer_address" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"label" text,
	"name" text,
	"line1" text,
	"line2" text,
	"postal_code" text,
	"city" text,
	"country" text,
	"phone" text,
	"is_default_shipping" boolean DEFAULT false NOT NULL,
	"is_default_billing" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_session" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_token" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"kind" text DEFAULT 'reset' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "accepts_marketing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "marketing_opt_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "tags" jsonb;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_address" ADD CONSTRAINT "customer_address_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_session" ADD CONSTRAINT "customer_session_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_token" ADD CONSTRAINT "customer_token_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_address_customer_idx" ON "customer_address" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_session_customer_idx" ON "customer_session" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_token_customer_idx" ON "customer_token" USING btree ("customer_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_account_email_uniq" ON "customer" USING btree (lower("email")) WHERE "customer"."password_hash" is not null;