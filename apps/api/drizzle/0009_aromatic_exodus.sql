CREATE TABLE "character_category" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "character_type" ADD COLUMN "category_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "character_category_slug_uniq" ON "character_category" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "character_type" ADD CONSTRAINT "character_type_category_id_character_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."character_category"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Reprise des catégories existantes (texte libre) vers la nouvelle table :
-- une ligne par valeur distincte, ordonnées alphabétiquement.
INSERT INTO "character_category" ("slug", "name", "position")
SELECT
  lower(regexp_replace(src.category, '[^a-zA-Z0-9]+', '-', 'g')),
  src.category,
  (row_number() OVER (ORDER BY src.category))::int - 1
FROM (
  SELECT DISTINCT "category" AS category
  FROM "character_type"
  WHERE "category" IS NOT NULL AND "category" <> ''
) AS src
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
-- Rattachement de chaque personnage à sa catégorie.
UPDATE "character_type" ct
SET "category_id" = cc."id"
FROM "character_category" cc
WHERE ct."category" = cc."name" AND ct."category_id" IS NULL;

