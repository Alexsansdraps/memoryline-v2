CREATE TABLE "relance_refus" (
	"jeton" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"refuse_le" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "last_activity_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "recovery_token" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "recovered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "recovery_declined_reason" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "recovery_declined_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "relance_refus_email_uniq" ON "relance_refus" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "order_recovery_token_uniq" ON "order" USING btree ("recovery_token");