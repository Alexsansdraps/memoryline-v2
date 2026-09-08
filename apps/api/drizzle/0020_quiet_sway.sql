ALTER TABLE "shipping_method" ADD COLUMN "pickup_location" text;--> statement-breakpoint
UPDATE "shipping_method"
SET "pickup_location" = 'À convenir — indiquez votre créneau en commentaire.'
WHERE "kind" = 'pickup' AND "pickup_location" IS NULL;
