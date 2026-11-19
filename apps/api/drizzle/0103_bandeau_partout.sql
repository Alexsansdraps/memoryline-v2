-- Le bandeau de l'accueil sur toutes les pages (19/11, Alexandra : « la
-- bannière doit être affichée sur chaque page »).
--
-- Les bandeaux visuels (BO › Bandeaux visuels) gagnent la case « Toutes les
-- pages du site » (clé « partout », @memoryline/types, bandeaux-visuels.ts).
-- Elle est cochée ici sur ceux qui s'affichent déjà sur l'accueil — en prod
-- le 19/11, un seul : « Pour Noël, offrez un cadeau unique ». Leurs autres
-- pages et tout le reste de leur réglage ne bougent pas ; un bandeau qui ne
-- vise pas l'accueil n'est pas touché. Se décoche au BO.
UPDATE "setting" s
SET "value" = (
  SELECT coalesce(
    jsonb_agg(
      CASE
        WHEN jsonb_typeof(e."b" -> 'pages') = 'array'
             AND (e."b" -> 'pages') @> '["accueil"]'::jsonb
             AND NOT ((e."b" -> 'pages') @> '["partout"]'::jsonb)
          THEN jsonb_set(e."b", '{pages}', (e."b" -> 'pages') || '["partout"]'::jsonb)
        ELSE e."b"
      END
      ORDER BY e."rang"
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(s."value") WITH ORDINALITY AS e("b", "rang")
)
WHERE s."key" = 'bandeaux.visuels' AND jsonb_typeof(s."value") = 'array';
