-- Mentions légales : le crédit des emojis imprimés sur les affiches. Depuis
-- le 16/11, un emoji tapé dans une ligne de texte s'imprime en couleur, avec
-- les dessins Twemoji (apps/api/src/pdf.ts) ; leur licence, CC-BY 4.0, demande
-- de citer leurs auteurs.
--
-- Un paragraphe, rangé juste après « Site conçu et réalisé par… » ; à défaut
-- (texte réécrit au BO), à la fin de la page. Rejouable : une page qui cite
-- déjà Twemoji n'est plus touchée.
WITH "cible" AS (
  SELECT p."id",
    COALESCE(
      (SELECT t."ord" - 1
         FROM jsonb_array_elements(p."blocks") WITH ORDINALITY AS t("bloc", "ord")
        WHERE t."bloc"->>'html' LIKE '%alexandraporhansl.com%'
        ORDER BY t."ord"
        LIMIT 1),
      jsonb_array_length(p."blocks") - 1
    ) AS "pos"
  FROM "page" p
  WHERE p."slug" = 'mentions-legales'
    AND jsonb_typeof(p."blocks") = 'array'
    AND jsonb_array_length(p."blocks") > 0
    AND p."blocks"::text NOT LIKE '%Twemoji%'
)
UPDATE "page" p
SET "blocks" = jsonb_insert(
      p."blocks",
      ARRAY[c."pos"::text],
      '{"type": "texte", "html": "<p>Emojis imprimés sur les affiches : graphismes <a href=\"https://github.com/jdecked/twemoji\">Twemoji</a>, © 2019 Twitter, Inc. et autres contributeurs, sous licence <a href=\"https://creativecommons.org/licenses/by/4.0/deed.fr\">CC-BY 4.0</a>.</p>"}'::jsonb,
      true
    )
FROM "cible" c
WHERE p."id" = c."id";
