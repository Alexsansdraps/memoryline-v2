-- Cartes cadeaux en ligne, commandes à 0 € et codes « tout gratuit » (17/11).
--
-- 1. La carte cadeau retenue à la caisse. La part qu'elle paie existait déjà
--    (order.gift_card_cents) ; il manquait QUELLE carte la paie. Elle n'est
--    débitée qu'au paiement, dans son journal (markOrderPaid).
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "gift_card_id" integer;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "order" ADD CONSTRAINT "order_gift_card_id_gift_card_id_fk"
    FOREIGN KEY ("gift_card_id") REFERENCES "public"."gift_card"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- 2. Une ligne de panier peut être une carte cadeau achetée sur le site :
--    son montant et son destinataire. Null pour une affiche.
ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "gift_card" jsonb;
--> statement-breakpoint
-- 3. La carte vendue en ligne garde sa commande, sa ligne, son destinataire,
--    le petit mot et la date d'envoi du courriel.
ALTER TABLE "gift_card" ADD COLUMN IF NOT EXISTS "order_id" integer;
--> statement-breakpoint
ALTER TABLE "gift_card" ADD COLUMN IF NOT EXISTS "order_item_id" integer;
--> statement-breakpoint
ALTER TABLE "gift_card" ADD COLUMN IF NOT EXISTS "recipient_email" text;
--> statement-breakpoint
ALTER TABLE "gift_card" ADD COLUMN IF NOT EXISTS "recipient_name" text;
--> statement-breakpoint
ALTER TABLE "gift_card" ADD COLUMN IF NOT EXISTS "message" text;
--> statement-breakpoint
ALTER TABLE "gift_card" ADD COLUMN IF NOT EXISTS "sent_at" timestamp with time zone;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "gift_card" ADD CONSTRAINT "gift_card_order_id_order_id_fk"
    FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "gift_card" ADD CONSTRAINT "gift_card_order_item_id_order_item_id_fk"
    FOREIGN KEY ("order_item_id") REFERENCES "public"."order_item"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Une ligne donne une carte, jamais deux, même si le paiement est confirmé
-- deux fois (webhook et navigateur).
CREATE UNIQUE INDEX IF NOT EXISTS "gift_card_order_item_uniq" ON "gift_card" USING btree ("order_item_id") WHERE "order_item_id" is not null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gift_card_order_idx" ON "gift_card" USING btree ("order_id");
--> statement-breakpoint
-- La saisie se compare sans tirets : deux codes ne doivent pas se confondre
-- une fois leurs tirets retirés. Les codes d'aujourd'hui ont tous la même
-- forme (XXXX-XXXX-XXXX) : aucun doublon possible.
CREATE UNIQUE INDEX IF NOT EXISTS "gift_card_cle_uniq" ON "gift_card" USING btree (replace("code", '-', ''));
--> statement-breakpoint
-- 4. Le code de test d'Alexandra : tout gratuit, livraison comprise.
--    Pourcentage 100 %, livraison offerte, réutilisable, sans date de fin.
--    Priorité 999 et non cumulable : il passe avant toute autre promotion et
--    remise tout le panier d'affiches, quel que soit le mode de livraison.
--    Les cartes cadeaux achetées restent payantes : les promotions ne les
--    touchent pas.
--    Rien de nouveau si une promotion porte déjà ce code (casse et tirets
--    ignorés), archivée comprise.
INSERT INTO "promo_rule" ("name", "type", "config", "code", "active", "priority", "stackable")
SELECT
  'Tests Alexandra : tout gratuit',
  'percent',
  '{"percent": 100, "livraisonOfferte": true, "usageUnique": false, "conditions": {"minCents": null, "minQuantite": null}, "cumulable": false}'::jsonb,
  'V7X9-KQ4M-Z8WP-3N6R',
  true,
  999,
  false
WHERE NOT EXISTS (
  SELECT 1 FROM "promo_rule"
  WHERE upper(replace(coalesce("code", ''), '-', '')) = 'V7X9KQ4MZ8WP3N6R'
);
