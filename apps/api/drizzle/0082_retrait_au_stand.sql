-- Retrait au stand (Alexandra, 17/11 : « j'ai ouvert le stand de Mulhouse,
-- ça doit proposer de récupérer sa commande sur tous les stands ouverts, pour
-- 0 €, avec l'emplacement exact ; pour le stand, un endroit exact en champ
-- libre »).
--
-- 1. L'emplacement du stand, en texte libre.
ALTER TABLE "stand" ADD COLUMN IF NOT EXISTS "emplacement" text;
--> statement-breakpoint
-- 2. Le lieu de retrait d'un stand : une ligne de pickup_point qui le désigne.
ALTER TABLE "pickup_point" ADD COLUMN IF NOT EXISTS "stand_id" integer;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "pickup_point" ADD CONSTRAINT "pickup_point_stand_id_stand_id_fk"
    FOREIGN KEY ("stand_id") REFERENCES "public"."stand"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pickup_point_stand_id_unique"
  ON "pickup_point" ("stand_id") WHERE "stand_id" IS NOT NULL;
--> statement-breakpoint
-- 3. Le mode « Retrait au stand », gratuit dans toutes les zones. Seulement
--    s'il n'existe pas encore : rejouable, et sans écraser ce que la boutique
--    en aurait fait au BO.
INSERT INTO "shipping_method" ("slug", "name", "description", "kind", "carrier", "active", "position")
SELECT 'retrait-au-stand', 'Retrait au stand',
       'Gratuit : venez chercher votre affiche à notre stand.',
       'pickup', NULL, true,
       COALESCE((SELECT max("position") + 1 FROM "shipping_method"), 0)
WHERE NOT EXISTS (SELECT 1 FROM "shipping_method" WHERE "slug" = 'retrait-au-stand');
--> statement-breakpoint
INSERT INTO "shipping_rate" ("method_id", "zone_id", "price_cents", "min_weight_grams", "active")
SELECT m."id", z."id", 0, 0, true
  FROM "shipping_method" m CROSS JOIN "shipping_zone" z
 WHERE m."slug" = 'retrait-au-stand'
   AND NOT EXISTS (
     SELECT 1 FROM "shipping_rate" r WHERE r."method_id" = m."id" AND r."zone_id" = z."id"
   );
--> statement-breakpoint
-- 4. Un lieu pour chaque stand déjà là (actif s'il est ouvert).
INSERT INTO "pickup_point" ("nom", "adresse", "active", "position", "stand_id", "archived_at")
SELECT s."nom", s."emplacement", s."ouvert" AND s."archived_at" IS NULL, 0, s."id", s."archived_at"
  FROM "stand" s
 WHERE NOT EXISTS (SELECT 1 FROM "pickup_point" p WHERE p."stand_id" = s."id");
