-- Les ventes du stand déjà faites repassent « À imprimer » (26/11).
--
-- Depuis le 26/11, une vente validée à la tablette n'est plus « Terminée »
-- d'office : elle naît payée et « À imprimer », et Margaux la marque terminée
-- elle-même, dans Ventes stand ou sur sa fiche (salon.ts,
-- etape-vente-stand.ts ; Alexandra : « il faut que quand la personne créé
-- une affiche, qu'elle ne soit pas directement terminée mais qu'on doive le
-- faire soit dans la commande soit sur la liste avec case à cocher »). Pour
-- celles d'avant : « toutes les commandes déjà faite, tu les mets pas au
-- dernier statut car elle aimerait les modifier pour qu'elles collent mieux
-- à son CA » ; « bien sur les tests et annulés restent dans leur case ».
--
-- Elles sont donc rendues « À imprimer » : leurs remises réussies (celle de
-- la validation du 19 au 26/11, celle de la migration 0105 du 20/11, ou une
-- « Terminée » cliquée avant, transporteur saisi ou non — « Remise en main
-- propre ») sont annulées comme le fait la réouverture d'une vente à la
-- tablette (salon.ts : statut « cancelled » et date d'annulation, la ligne
-- reste lisible), leur date de fin est vidée, et leur journal reçoit une
-- ligne qui le dit. Leur montant, leur encaissement au grand livre et leur
-- facture ne bougent pas.
--
-- Ce qui est touché : les ventes du stand (canal « salon ») numérotées SAL-…,
-- payées, sans l'étiquette « test », qui ont une remise réussie ou une date
-- de fin. Ce qui ne l'est pas :
--   - les annulées, ventes de test comprises (statut « cancelled » ou
--     « voided ») et les paniers, ventes rouvertes comprises (« draft ») ;
--   - les reprises de Shopify (SHOP-…, `legacy_id`), traitées là-bas ;
--   - les commandes du site (canal « web ») ;
--   - une vente qui a VOYAGÉ : une expédition avec un numéro de suivi, ou un
--     vrai bordereau SendCloud (acheté ou en cours, hors essai). Celle-là
--     n'a pas été remise sur place, elle est partie, et la frise du BO ne
--     revient pas non plus avant « parti » sur un colis qui a son étiquette ;
--   - une vente validée sous la NOUVELLE règle (son journal dit « … : à
--     imprimer, puis à marquer terminée au back-office. », salon.ts) : si
--     elle est « Terminée », c'est que Margaux l'a marquée.
--
-- Rejouable sans effet, à tout moment : une vente rendue porte la ligne du
-- journal ci-dessous et n'est plus jamais une cible — même marquée terminée
-- ensuite par Margaux —, et une vente validée depuis n'en est pas une.
WITH cibles AS (
  SELECT o."id"
  FROM "order" o
  WHERE o."channel" = 'salon'
    AND o."number" ~ '^SAL-[0-9]+$'
    AND o."status" = 'paid'
    AND o."legacy_id" IS NULL
    AND NOT coalesce(lower(o."tags"::text)::jsonb @> '["test"]'::jsonb, false)
    AND NOT EXISTS (
      SELECT 1 FROM "fulfillment" f
      WHERE f."order_id" = o."id" AND f."status" = 'success'
        AND coalesce(f."tracking_number", '') <> '')
    AND NOT EXISTS (
      SELECT 1 FROM "bordereau" b
      WHERE b."order_id" = o."id" AND b."statut" IN ('achete', 'en_cours') AND b."essai" = false)
    AND NOT EXISTS (
      SELECT 1 FROM "order_event" e
      WHERE e."order_id" = o."id"
        AND (e."message" LIKE 'Vente remise « À imprimer » le 26/11,%'
          OR e."message" LIKE 'Commande prise au stand%, réglée sur place : à imprimer, puis à marquer terminée au back-office.'))
    AND (
      o."fulfilled_at" IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM "fulfillment" f
        WHERE f."order_id" = o."id" AND f."status" = 'success'))
),
remises AS (
  UPDATE "fulfillment" f
  SET "status" = 'cancelled', "cancelled_at" = now()
  WHERE f."order_id" IN (SELECT "id" FROM cibles) AND f."status" = 'success'
  RETURNING f."id"
),
ventes AS (
  UPDATE "order" o
  SET "fulfilled_at" = NULL
  WHERE o."id" IN (SELECT "id" FROM cibles)
  RETURNING o."id"
)
INSERT INTO "order_event" ("order_id", "kind", "message")
SELECT "id", 'event',
  'Vente remise « À imprimer » le 26/11, comme toutes les ventes du stand déjà faites : une vente ne passe plus « Terminée » d''elle-même, on la marque terminée dans Ventes stand ou sur sa fiche. Sa remise enregistrée est annulée ; son montant, son encaissement et sa facture ne changent pas.'
FROM cibles;
