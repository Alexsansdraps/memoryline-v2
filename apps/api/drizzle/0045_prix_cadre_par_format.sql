ALTER TABLE "frame" ADD COLUMN "price_a4_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "frame" ADD COLUMN "price_a3_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Un prix par format : le prix unique de chaque cadre est recopié dans les
-- deux, pour que les cadres existants gardent exactement leur prix. La
-- boutique ajuste ensuite le prix A3 au back-office.
UPDATE "frame" SET "price_a4_cents" = "price_cents", "price_a3_cents" = "price_cents";
--> statement-breakpoint
ALTER TABLE "frame" DROP COLUMN "price_cents";
