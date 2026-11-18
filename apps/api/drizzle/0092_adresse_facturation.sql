-- L'adresse de facturation d'une commande (18/11, Alexandra : « avoir par
-- défaut son adresse en facturation », « l'adresse par défaut qu'il choisit
-- reste l'adresse de facturation »). Figée à la caisse depuis l'adresse par
-- défaut du carnet de la cliente ; vide pour les commandes d'avant, dont la
-- facture garde l'adresse de livraison.
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "billing_name" text;
--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "billing_line1" text;
--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "billing_line2" text;
--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "billing_postal_code" text;
--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "billing_city" text;
--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "billing_country" text;
--> statement-breakpoint
-- Une seule adresse PAR DÉFAUT par cliente, qui vaut pour la facturation et
-- se propose d'abord pour la livraison : les deux drapeaux du carnet se
-- rejoignent. Celle « facturation par défaut » l'emporte, puis celle
-- « livraison par défaut », puis la plus ancienne.
WITH choix AS (
  SELECT DISTINCT ON ("customer_id") "id", "customer_id"
  FROM "customer_address"
  ORDER BY "customer_id", "is_default_billing" DESC, "is_default_shipping" DESC, "id" ASC
)
UPDATE "customer_address" a
SET "is_default_billing" = (a."id" = choix."id"),
    "is_default_shipping" = (a."id" = choix."id")
FROM choix
WHERE a."customer_id" = choix."customer_id";
