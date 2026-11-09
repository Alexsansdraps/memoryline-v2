-- Le SIRET et le délai de préparation, confirmés par Margaux le 9 novembre 2026.
--
-- SIRET : 877 919 852 00047, le siège actif depuis le 1er août 2022 (registre
-- SIRENE). Les mentions légales, les conditions de vente et la politique de
-- confidentialité portaient 00021, repris de l'ancienne boutique Shopify :
-- c'est un ancien établissement, fermé. Le réglage des factures
-- (« facture.siret ») le reçoit aussi, sauf s'il porte déjà un autre numéro
-- saisi au back-office.
--
-- Délai : « 2 à 3 jours ouvrés », comme l'annonçait l'ancienne boutique
-- (« Impression à la demande : 2 à 3 jours ouvrés »), à la place du
-- « À COMPLÉTER » de l'article 6 des conditions de vente.
--
-- Seuls ces morceaux de texte changent ; une page qui ne les contient pas
-- n'est pas touchée. Rejouable : une seconde fois, il n'y a plus rien à
-- remplacer.
UPDATE "page"
SET "blocks" = regexp_replace(
      "blocks"::text,
      '877[^0-9]{0,6}919[^0-9]{0,6}852[^0-9]{0,6}00021',
      '877 919 852 00047',
      'g'
    )::jsonb
WHERE "blocks"::text ~ '877[^0-9]{0,6}919[^0-9]{0,6}852[^0-9]{0,6}00021';
--> statement-breakpoint
UPDATE "page"
SET "translations" = regexp_replace(
      "translations"::text,
      '877[^0-9]{0,6}919[^0-9]{0,6}852[^0-9]{0,6}00021',
      '877 919 852 00047',
      'g'
    )::jsonb
WHERE "translations" IS NOT NULL
  AND "translations"::text ~ '877[^0-9]{0,6}919[^0-9]{0,6}852[^0-9]{0,6}00021';
--> statement-breakpoint
UPDATE "page"
SET "blocks" = regexp_replace(
      "blocks"::text,
      '<strong>À COMPL[ÉE]TER[^<]*délai réel de préparation[^<]*</strong>',
      '<strong>2 à 3 jours ouvrés</strong>.',
      'g'
    )::jsonb
WHERE "slug" = 'conditions-de-vente'
  AND "blocks"::text ~ '<strong>À COMPL[ÉE]TER[^<]*délai réel de préparation[^<]*</strong>';
--> statement-breakpoint
INSERT INTO "setting" ("key", "value", "label", "group", "updated_at")
VALUES ('facture.siret', '"87791985200047"'::jsonb, 'SIRET (factures)', 'facture', now())
ON CONFLICT ("key") DO UPDATE
SET "value" = EXCLUDED."value", "updated_at" = now()
WHERE "setting"."value" #>> '{}' IN ('', '87791985200021');
