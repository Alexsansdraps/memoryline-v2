-- La bannière de Margaux sur toutes les pages (20/11, Alexandra : « elle doit
-- être cochée pour toutes les pages »).
--
-- La bannière en ligne (« Pour Noël, offrez un cadeau unique », le texte est
-- dans l'image, bv-724c4b738c) n'était cochée que pour l'accueil : la case
-- « Toutes les pages du site » du 19/11 (0103) avait été posée sur l'ancienne,
-- pas sur celle-ci. Elle la reçoit ici ; ses autres pages, ses langues et tout
-- le reste de son réglage ne bougent pas. Elle reste la bannière par défaut :
-- une bannière réservée à une langue, ou qui vise une page précise, la
-- remplace là seulement (bandeauxDeLaPage). Rien ne bouge si elle n'existe
-- plus, ou si la case est déjà cochée ; se décoche au BO.
UPDATE "setting" s
SET "value" = (
  SELECT coalesce(
    jsonb_agg(
      CASE
        WHEN e."b" ->> 'id' = 'bv-724c4b738c'
             AND jsonb_typeof(e."b" -> 'pages') = 'array'
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
WHERE s."key" = 'bandeaux.visuels'
  AND jsonb_typeof(s."value") = 'array'
  AND s."value" @> '[{"id": "bv-724c4b738c"}]'::jsonb;
