ALTER TYPE "public"."payment_provider" ADD VALUE 'manuel';--> statement-breakpoint
CREATE TABLE "facture_compteur" (
	"annee" integer PRIMARY KEY NOT NULL,
	"dernier_numero" integer DEFAULT 0 NOT NULL,
	"maj_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "invoice_number" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "invoiced_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "order_invoice_number_uniq" ON "order" USING btree ("invoice_number");