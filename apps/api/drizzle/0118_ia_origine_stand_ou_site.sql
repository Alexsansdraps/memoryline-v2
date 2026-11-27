-- D'où vient chaque affiche « à partir de votre photo » : la tablette d'un
-- stand, ou le site (27/11, Alexandra : « faut qu'on puisse identifier si la
-- photo vient du stand ou site et si possible quel stand... sur
-- https://memoryline.fr/bo/ia »).
--
-- 1. `origine` (« stand » ou « site ») et `stand_id` : écrits désormais à la
--    création (apps/api/src/ia.ts, POST /ia/generer). Null = inconnue.
-- 2. Les affiches d'avant : ce qu'en disent leur panier ou leur commande. Une
--    vente validée au stand (canal « salon ») ou un panier rempli sur la
--    tablette (`panier_du_stand`) → « stand », avec le stand de la vente
--    quand il est connu ; un autre panier ou une commande du site → « site ».
--    Une affiche jamais mise au panier reste sans origine : rien ne la dit.
--    Ne touche que les lignes encore sans origine : rejouable sans effet.
ALTER TABLE "ai_generation" ADD COLUMN IF NOT EXISTS "origine" text;--> statement-breakpoint
ALTER TABLE "ai_generation" ADD COLUMN IF NOT EXISTS "stand_id" integer;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ai_generation" ADD CONSTRAINT "ai_generation_stand_id_stand_id_fk"
    FOREIGN KEY ("stand_id") REFERENCES "public"."stand"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

UPDATE "ai_generation" g
SET "origine" = CASE WHEN o."channel" = 'salon' OR o."panier_du_stand" THEN 'stand' ELSE 'site' END,
    "stand_id" = o."stand_id"
FROM "order" o
WHERE g."origine" IS NULL
  AND g."fond_id" IS NULL
  AND g."cart_id" IS NOT NULL
  AND o."client_order_id" = g."cart_id";--> statement-breakpoint

UPDATE "ai_generation" g
SET "origine" = CASE WHEN o."channel" = 'salon' THEN 'stand' ELSE 'site' END,
    "stand_id" = o."stand_id"
FROM "order_item" oi
JOIN "order" o ON o."id" = oi."order_id"
WHERE g."origine" IS NULL
  AND g."fond_id" IS NULL
  AND g."order_item_id" = oi."id";
