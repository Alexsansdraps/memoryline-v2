CREATE TABLE "stand" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"nom" text NOT NULL,
	"ouvert" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "stand_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "stand_code_uniq" ON "stand" USING btree ("code");--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_stand_id_stand_id_fk" FOREIGN KEY ("stand_id") REFERENCES "public"."stand"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Le stand qui vivait dans les réglages devient une ligne, et les ventes déjà
-- prises lui sont rattachées : sans cela, l'historique du seul stand jamais
-- tenu se retrouverait orphelin le jour où l'écran demande « quel stand ? ».
-- Gardé par « aucun stand n'existe encore », donc rejouable sans dégât.
WITH reglages AS (
  SELECT
    max(CASE WHEN key = 'salon.code' THEN value #>> '{}' END) AS code,
    max(CASE WHEN key = 'salon.evenement' THEN value #>> '{}' END) AS nom,
    max(CASE WHEN key = 'salon.ouvert' THEN value #>> '{}' END) AS ouvert
  FROM setting
  WHERE key IN ('salon.code', 'salon.evenement', 'salon.ouvert')
), cree AS (
  INSERT INTO stand (code, nom, ouvert)
  SELECT r.code, coalesce(nullif(r.nom, ''), 'Stand'), r.ouvert = '1'
  FROM reglages r
  WHERE coalesce(r.code, '') <> ''
    AND NOT EXISTS (SELECT 1 FROM stand)
  RETURNING id
)
UPDATE "order"
SET stand_id = (SELECT id FROM cree)
WHERE channel = 'salon'
  AND stand_id IS NULL
  AND EXISTS (SELECT 1 FROM cree);
