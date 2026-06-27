CREATE TABLE "announcement_banner" (
	"id" serial PRIMARY KEY NOT NULL,
	"message" text NOT NULL,
	"link_url" text,
	"link_label" text,
	"bg_color" text DEFAULT '#20211f',
	"text_color" text DEFAULT '#f7f3ec',
	"active" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"promo_rule_id" integer,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_rule" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"config" jsonb NOT NULL,
	"code" text,
	"active" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"stackable" boolean DEFAULT false NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"label" text,
	"group" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "announcement_banner" ADD CONSTRAINT "announcement_banner_promo_rule_id_promo_rule_id_fk" FOREIGN KEY ("promo_rule_id") REFERENCES "public"."promo_rule"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "banner_active_idx" ON "announcement_banner" USING btree ("active");--> statement-breakpoint
CREATE INDEX "promo_active_idx" ON "promo_rule" USING btree ("active");