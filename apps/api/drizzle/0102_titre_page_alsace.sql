-- Le titre de la page du stand, traduit (19/11, Alexandra : « affiches
-- personnalisée alsace n'est pas traduit, fais stp »).
--
-- La page « mulhouse » (tablette du marché de Noël) s'appelle désormais
-- « Affiche personnalisée ALSACE », en français seulement : sous /en, /de…
-- le titre, l'onglet et l'entrée du menu restaient en français.
--
-- Le titre est ajouté dans chaque langue où il MANQUE, avec les mots du site
-- (« Personalised poster », « Personalisiertes Poster », « Poster
-- personalizzato », « Lámina personalizada », パーソナライズポスター, 个性化海报 :
-- ui.ts, « seo.nature.personnalisable ») et le nom de l'Alsace dans la langue.
-- Un titre déjà traduit au BO reste tel quel ; le reste de la traduction (la
-- grille d'affiches, le référencement) n'est pas touché : sans blocs
-- traduits, la page garde sa grille française (cms.ts, fusionnerBlocs).
-- Rien ne se passe si la page n'existe pas, ou ne parle plus de l'Alsace.
UPDATE "page" p
SET "translations" = coalesce(p."translations", '{}'::jsonb) || coalesce((
  SELECT jsonb_object_agg(
    t."langue",
    coalesce(p."translations" -> t."langue", '{}'::jsonb) || jsonb_build_object('title', t."titre")
  )
  FROM (VALUES
    ('en', 'Personalised poster ALSACE'),
    ('de', 'Personalisiertes Poster ELSASS'),
    ('it', 'Poster personalizzato ALSAZIA'),
    ('es', 'Lámina personalizada ALSACIA'),
    ('ja', 'パーソナライズポスター アルザス'),
    ('zh', '个性化海报 阿尔萨斯')
  ) AS t("langue", "titre")
  WHERE coalesce(trim(p."translations" -> t."langue" ->> 'title'), '') = ''
), '{}'::jsonb)
WHERE p."slug" = 'mulhouse' AND p."title" ILIKE '%alsace%';
