-- La page de la tablette du marché de Noël de Mulhouse (18/11, Alexandra :
-- « sur le stand Mulhouse marché de Noël, il faudrait mettre en avant tout ce
-- qui concerne l'Alsace », « quand je vais sur memoryline.fr/?stand=1, je
-- dois avoir que la page /mulhouse »).
--
-- 1. La page « mulhouse » (tablette du stand seulement) et ses affiches :
--    créée si elle n'existe pas (titre « Mulhouse » dans les 7 langues) ;
--    si elle existe déjà SANS affiches, les affiches s'ajoutent à la fin de
--    ses blocs, et rien d'autre ne change (titre, textes, traductions).
--    Les affiches : celles de l'Alsace qui sont en vente, visées une à une
--    par leur adresse (relevé du site en ligne le 18/11), Mulhouse d'abord
--    (la place de la Réunion, le temple Saint-Étienne et les vues d'hiver en
--    tête), puis Noël alsacien, l'Écomusée, Colmar, Strasbourg, la route des
--    vins et ses villages, la montagne et le Sundgau. Laissées dehors, à
--    l'Alsace près : Bâle, Fribourg-en-Brisgau, La Bresse-Hohneck, Les Vosges.
--    Une affiche absente ou retirée de la vente est simplement sautée.
WITH choix AS (
  SELECT coalesce(jsonb_agg(p."id"::text ORDER BY v."rang"), '[]'::jsonb) AS "refs",
         count(p."id")::int AS "n"
  FROM unnest(ARRAY[
    'mulhouse-place-de-la-reunion-neige-affiche-personnalisee',
    'mulhouse-place-de-la-reunion-affiche-personnalisee',
    'mulhouse-temple-saint-etienne-manege-neige-affiche-personnalisee',
    'mulhouse-temple-saint-etienne-manege-nuit-affiche-personnalisee',
    'mulhouse-temple-saint-etienne-manege-affiche-personnalisee',
    'mulhouse-temple-saint-etienne-affiche-personnalisee',
    'mulhouse-hotel-de-ville-neige-affiche-personnalisee',
    'mulhouse-hotel-de-ville-affiche-personnalisee',
    'mulhouse-maison-mieg-noel-affiche-personnalisee',
    'mulhouse-maison-mieg-affiche-personnalisee',
    'mulhouse-manege-neige-affiche-personnalisee',
    'mulhouse-tour-du-bollwerk-affiche-personnalisee',
    'mulhouse-tour-bollwerk-europe-affiche-personnalisee',
    'mulhouse-vieux-mulhouse-tour-d-europe-affiche-personnalisee',
    'mulhouse-cite-du-train-1-affiche-personnalisee',
    'mulhouse-cite-du-train-2-affiche-personnalisee',
    'mulhouse-cite-de-l-automobile-1-affiche-personnalisee',
    'mulhouse-cite-de-l-automobile-2-affiche-personnalisee',
    'noel-alsacien-affiche-personnalisee',
    'alsace-tradition-affiche-personnalisee',
    'alsace-ecomusee-1-affiche-personnalisee',
    'alsace-ecomusee-2-affiche-personnalisee',
    'colmar-noel-affiche-personnalisee',
    'colmar-noel-2-affiche-personnalisee',
    'colmar-neige-2-affiche-personnalisee',
    'colmar-1-affiche-personnalisee',
    'colmar-2-affiche-personnalisee',
    'colmar-3-affiche-personnalisee',
    'colmar-4-affiche-personnalisee',
    'colmar-affiche-personnalisee',
    'strasbourg-neige-affiche-personnalisee',
    'strasbourg-neige-2-affiche-personnalisee',
    'strasbourg-maison-glycines-neige-affiche-personnalisee',
    'strasbourg-maison-glycines-neige-sunset-affiche-personnalisee',
    'strasbourg-cathedrale-affiche-personnalisee',
    'strasbourg-maison-kammerzell-affiche-personnalisee',
    'strasbourg-ponts-couverts-affiche-personnalisee',
    'strasbourg-ponts-couverts-sunset-affiche-personnalisee',
    'strasbourg-maison-glycines-affiche-personnalisee',
    'strasbourg-3-affiche-personnalisee',
    'strasbourg-4-affiche-personnalisee',
    'alsace-route-des-vins-affiche-personnalisee',
    'alsace-route-des-vins-2-affiche-personnalisee',
    'alsace-route-des-vins-neige-2-affiche-personnalisee',
    'kaysersberg-neige-affiche-personnalisee',
    'kaysersberg-affiche-personnalisee',
    'kaysersberg-1-affiche-personnalisee',
    'kaysersberg-3-affiche-personnalisee',
    'kaysersberg-sunset-affiche-personnalisee',
    'riquewihr-1-affiche-personnalisee',
    'riquewihr-3-2-affiche-personnalisee',
    'riquewihr-3-affiche-personnalisee',
    'riquewihr-tour-dolder-2-affiche-personnalisee',
    'ribeauville-affiche-personnalisee',
    'ribeauville-ruines-affiche-personnalisee',
    'eguisheim-1-affiche-personnalisee',
    'turckheim-affiche-personnalisee',
    'bergheim-affiche-personnalisee',
    'obernai-affiche-personnalisee',
    'munster-affiche-personnalisee',
    'murbach-affiche-personnalisee',
    'le-grand-ballon-montage-neige-affiche-personnalisee',
    'merkstein-montage-neige-affiche-personnalisee',
    'ferrette-chateau-ruines-affiche-personnalisee'
  ]::text[]) WITH ORDINALITY AS v("slug", "rang")
  JOIN "product" p ON p."slug" = v."slug" AND p."status" = 'active'
),
rangee AS (
  SELECT CASE WHEN "n" > 0 THEN jsonb_build_object(
           'type', 'produits', 'source', 'affiches',
           'reference', "refs" ->> 0, 'references', "refs", 'limite', "n")
         END AS "bloc"
  FROM choix
),
creee AS (
  INSERT INTO "page" ("slug", "title", "status", "affichage", "blocks", "translations")
  SELECT 'mulhouse', 'Mulhouse', 'active', 'stand',
         CASE WHEN r."bloc" IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(r."bloc") END,
         '{"en":{"title":"Mulhouse"},"de":{"title":"Mülhausen"},"it":{"title":"Mulhouse"},"es":{"title":"Mulhouse"},"ja":{"title":"ミュルーズ"},"zh":{"title":"米卢斯"}}'::jsonb
  FROM rangee r
  WHERE NOT EXISTS (SELECT 1 FROM "page" WHERE "slug" = 'mulhouse')
  RETURNING "id"
)
UPDATE "page" pg
SET "blocks" = pg."blocks" || jsonb_build_array(r."bloc"),
    "updated_at" = now()
FROM rangee r
WHERE pg."slug" = 'mulhouse'
  AND r."bloc" IS NOT NULL
  AND jsonb_typeof(pg."blocks") = 'array'
  AND NOT (pg."blocks" @> '[{"type": "produits"}]'::jsonb);
--> statement-breakpoint
-- 2. Le stand du marché de Noël de Mulhouse affiche cette page. Garde-fou :
--    un seul stand non archivé dont le nom contient « Mulhouse », sinon rien
--    n'est réglé (la page se choisit alors dans BO › Ventes stand).
UPDATE "stand" s
SET "page_id" = pg."id"
FROM "page" pg
WHERE pg."slug" = 'mulhouse'
  AND s."archived_at" IS NULL
  AND s."page_id" IS NULL
  AND s."nom" ILIKE '%mulhouse%'
  AND (SELECT count(*) FROM "stand" x WHERE x."archived_at" IS NULL AND x."nom" ILIKE '%mulhouse%') = 1;
