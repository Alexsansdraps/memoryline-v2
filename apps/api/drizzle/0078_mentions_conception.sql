-- Mentions légales : qui a conçu et réalisé le site, avec le lien vers son
-- site (Alexandra, 13 novembre 2026 : « tu mets aussi dans les mentions
-- légales »). Le même lien est dans le pied de page de toutes les pages.
--
-- Un titre et un paragraphe, rangés juste après le bloc de l'hébergeur ; à
-- défaut de ce bloc (texte réécrit au BO), à la fin de la page. Rejouable :
-- une page qui contient déjà le lien n'est plus touchée.
WITH "cible" AS (
  SELECT p."id",
    COALESCE(
      (SELECT t."ord" - 1
         FROM jsonb_array_elements(p."blocks") WITH ORDINALITY AS t("bloc", "ord")
        WHERE t."bloc"->>'html' LIKE '%Hébergeur du site%'
        ORDER BY t."ord"
        LIMIT 1),
      jsonb_array_length(p."blocks") - 1
    ) AS "pos"
  FROM "page" p
  WHERE p."slug" = 'mentions-legales'
    AND jsonb_typeof(p."blocks") = 'array'
    AND jsonb_array_length(p."blocks") > 0
    AND p."blocks"::text NOT LIKE '%alexandraporhansl.com%'
)
UPDATE "page" p
SET "blocks" = jsonb_insert(
      jsonb_insert(
        p."blocks",
        ARRAY[c."pos"::text],
        '{"type": "texte", "html": "<p>Site conçu et réalisé par <a href=\"https://alexandraporhansl.com\">Alexandra Porhansl</a>.</p>"}'::jsonb,
        true
      ),
      ARRAY[c."pos"::text],
      '{"type": "titre", "texte": "Conception et réalisation", "niveau": 2}'::jsonb,
      true
    )
FROM "cible" c
WHERE p."id" = c."id";
