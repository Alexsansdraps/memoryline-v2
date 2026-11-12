-- L'adresse de la boutique, donnée par Alexandra le 12 novembre 2026 :
-- 7 chemin du Jeu d'Arc, 60170 Saint-Crépin-aux-Bois (la commune du siège au
-- registre SIRENE).
--
--   - Factures : le réglage « facture.adresse » la reçoit s'il est vide. Avec
--     le SIRET (0074), l'émetteur est complet et se fige sur les factures.
--   - Mentions légales et conditions de vente : « Entrepreneur individuel »
--     (forme juridique au registre, code 1000) et l'adresse, sous le nom de la
--     boutique ; leur « À COMPLÉTER » ne garde que ce qui manque encore
--     (téléphone, immatriculation, nom de l'entrepreneur).
--   - Politique de confidentialité : l'adresse postale du responsable du
--     traitement, à la place de son « À COMPLÉTER ».
--
-- Seuls ces morceaux de texte changent ; une page qui ne les contient pas
-- n'est pas touchée. Rejouable : une seconde fois, il n'y a plus rien à
-- remplacer.
INSERT INTO "setting" ("key", "value", "label", "group", "updated_at")
VALUES (
  'facture.adresse',
  '"7 chemin du Jeu d''Arc\n60170 Saint-Crépin-aux-Bois"'::jsonb,
  'Adresse de la boutique (factures)',
  'facture',
  now()
)
ON CONFLICT ("key") DO UPDATE
SET "value" = EXCLUDED."value", "updated_at" = now()
WHERE "setting"."value" #>> '{}' = '';
--> statement-breakpoint
UPDATE "page"
SET "blocks" = regexp_replace(
      "blocks"::text,
      '<strong>Memory Line</strong><br />SIRET',
      '<strong>Memory Line</strong><br />Entrepreneur individuel<br />7 chemin du Jeu d''Arc, 60170 Saint-Crépin-aux-Bois<br />SIRET'
    )::jsonb
WHERE "slug" IN ('mentions-legales', 'conditions-de-vente')
  AND "blocks"::text LIKE '%<strong>Memory Line</strong><br />SIRET%'
  AND "blocks"::text NOT LIKE '%Saint-Crépin-aux-Bois%';
--> statement-breakpoint
UPDATE "page"
SET "blocks" = regexp_replace(
      "blocks"::text,
      '<p><strong>À COMPL[ÉE]TER[^<]*forme juridique et[^<]*</strong>[^<]*</p>',
      '<p><strong>À COMPLÉTER : numéro d''inscription au RCS ou au répertoire des métiers, s''il y en a un ; numéro de téléphone ; nom de l''entrepreneur, qui est aussi le directeur de la publication.</strong></p>'
    )::jsonb
WHERE "slug" = 'mentions-legales'
  AND "blocks"::text ~ '<p><strong>À COMPL[ÉE]TER[^<]*forme juridique et[^<]*</strong>[^<]*</p>';
--> statement-breakpoint
UPDATE "page"
SET "blocks" = regexp_replace(
      "blocks"::text,
      '<p><strong>À COMPL[ÉE]TER[^<]*forme juridique, adresse du siège[^<]*</strong>[^<]*</p>',
      '<p><strong>À COMPLÉTER : numéro de téléphone, et le cas échéant numéro d''inscription au RCS ou au répertoire des métiers.</strong></p>'
    )::jsonb
WHERE "slug" = 'conditions-de-vente'
  AND "blocks"::text ~ '<p><strong>À COMPL[ÉE]TER[^<]*forme juridique, adresse du siège[^<]*</strong>[^<]*</p>';
--> statement-breakpoint
UPDATE "page"
SET "blocks" = regexp_replace(
      "blocks"::text,
      'memoryline\.contact@gmail\.com\.</p><p><strong>À COMPL[ÉE]TER[^<]*adresse postale du responsable du traitement[^<]*</strong>[^<]*</p>',
      'memoryline.contact@gmail.com, et par courrier au 7 chemin du Jeu d''Arc, 60170 Saint-Crépin-aux-Bois.</p>'
    )::jsonb
WHERE "slug" = 'confidentialite'
  AND "blocks"::text ~ 'memoryline\.contact@gmail\.com\.</p><p><strong>À COMPL[ÉE]TER[^<]*adresse postale du responsable du traitement';
