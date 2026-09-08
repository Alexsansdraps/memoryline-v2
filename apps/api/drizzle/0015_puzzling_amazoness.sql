CREATE TABLE "piece_category" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"slot" text NOT NULL,
	"colors" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "piece_category_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "piece_category_slug_uniq" ON "piece_category" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_piece_category_id_piece_category_id_fk" FOREIGN KEY ("piece_category_id") REFERENCES "public"."piece_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Les nuanciers qui vivaient en dur dans le configurateur deviennent des
-- catégories par défaut, une par emplacement : rien ne change à l'écran, mais
-- les couleurs sont désormais modifiables au back-office.
INSERT INTO "piece_category" ("slug", "name", "slot", "colors", "position") VALUES
  ('vetements', 'Vêtements', 'clothes',
   '["#FFFFFF","#F1CB9E","#E7B033","#9EDFBF","#C8E4D6","#BD1212","#0056AF","#B8551D","#000000"]'::jsonb, 0),
  ('pantalons', 'Pantalons', 'pants',
   '["#EDD7C6","#B8551D","#5E9ABF","#165176","#545454","#000000"]'::jsonb, 1),
  ('coupes', 'Coupes', 'hair',
   '["#E8E8E8","#F1CB9E","#E7B033","#B8551D","#D6B695","#BF8158","#6B3E1E","#541507","#24222C"]'::jsonb, 2),
  ('accessoires', 'Accessoires', 'accessory',
   '["#FFFFFF","#E7B033","#BD1212","#0056AF","#B8551D","#000000"]'::jsonb, 3)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Chaque pièce rejoint la catégorie de son emplacement : le classement fin
-- se fera au back-office, mais personne ne se retrouve sans nuancier.
UPDATE "asset" SET "piece_category_id" = c."id"
FROM "piece_category" c
WHERE c."slot" = "asset"."slot" AND "asset"."piece_category_id" IS NULL;
