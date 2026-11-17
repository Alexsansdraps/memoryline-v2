-- La page du stand de Mulhouse montre TOUTE la collection du marché : 80
-- affiches, dans l'ordre de la collection (l'Alsace en tête), au lieu des 48
-- premières (Alexandra, 17/11 : « mettre en avant l'Alsace pour ce stand »).
-- Le plafond d'une grille passe à 200 (cms.ts). Seulement si la grille est
-- encore celle posée par 0080.
UPDATE "page"
SET "blocks" = jsonb_set("blocks", '{0,limite}', '200'::jsonb)
WHERE "slug" = 'mulhouse'
  AND jsonb_typeof("blocks") = 'array'
  AND "blocks"->0->>'type' = 'produits'
  AND "blocks"->0->>'reference' = 'marche-de-noel-mulhouse-2026'
  AND ("blocks"->0->>'limite')::int = 48;
