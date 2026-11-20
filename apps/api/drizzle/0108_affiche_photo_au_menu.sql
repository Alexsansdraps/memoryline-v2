-- L'affiche à partir d'une photo, dans le menu et sans « IA » dans son
-- adresse (20/11, Alexandra : « mets dans le menu (site et stand) un lien […]
-- faut que le lien mène direct à la page. Et dans l'url enlève IA »).
--
-- 1. L'adresse : /affiches/affiche-ia-a-partir-de-votre-photo devient
--    /affiches/affiche-a-partir-de-votre-photo. L'ancienne mène à la nouvelle
--    en 301, selon les règles de poserRedirection (redirections.ts) : un seul
--    saut (les redirections qui visaient l'ancienne visent la nouvelle), et
--    aucune redirection vivante ne part de la nouvelle.
-- 2. Les liens qu'on connaît vont droit à la nouvelle adresse, sans passer
--    par la redirection : le menu, le bouton de l'accueil (home.ia.link), les
--    bandeaux visuels et les pages.
-- 3. L'entrée « Votre photo en affiche » dans le menu du haut, juste après
--    « Affiches personnalisables » : c'est le menu du site ET de la tablette
--    du stand. Libellés dans les sept langues ; se renomme ou se masque dans
--    BO › Menu du site.
-- Rien ne bouge si l'affiche n'a plus cette adresse, ou si l'entrée existe.

UPDATE "product"
SET "slug" = 'affiche-a-partir-de-votre-photo'
WHERE "slug" = 'affiche-ia-a-partir-de-votre-photo'
  AND NOT EXISTS (SELECT 1 FROM "product" WHERE "slug" = 'affiche-a-partir-de-votre-photo');
--> statement-breakpoint
UPDATE "redirect"
SET "to_path" = '/affiches/affiche-a-partir-de-votre-photo'
WHERE "archived_at" IS NULL
  AND "to_path" = '/affiches/affiche-ia-a-partir-de-votre-photo'
  AND EXISTS (SELECT 1 FROM "product" WHERE "slug" = 'affiche-a-partir-de-votre-photo');
--> statement-breakpoint
UPDATE "redirect"
SET "archived_at" = now()
WHERE "archived_at" IS NULL
  AND "from_path" = '/affiches/affiche-a-partir-de-votre-photo'
  AND EXISTS (SELECT 1 FROM "product" WHERE "slug" = 'affiche-a-partir-de-votre-photo');
--> statement-breakpoint
INSERT INTO "redirect" ("from_path", "to_path", "code")
SELECT '/affiches/affiche-ia-a-partir-de-votre-photo', '/affiches/affiche-a-partir-de-votre-photo', 301
WHERE EXISTS (SELECT 1 FROM "product" WHERE "slug" = 'affiche-a-partir-de-votre-photo')
  AND NOT EXISTS (SELECT 1 FROM "product" WHERE "slug" = 'affiche-ia-a-partir-de-votre-photo')
  AND NOT EXISTS (
    SELECT 1 FROM "redirect"
    WHERE "archived_at" IS NULL AND "from_path" = '/affiches/affiche-ia-a-partir-de-votre-photo'
  );
--> statement-breakpoint
UPDATE "menu_item"
SET "href" = replace("href", '/affiches/affiche-ia-a-partir-de-votre-photo', '/affiches/affiche-a-partir-de-votre-photo')
WHERE "href" LIKE '%/affiches/affiche-ia-a-partir-de-votre-photo%'
  AND EXISTS (SELECT 1 FROM "product" WHERE "slug" = 'affiche-a-partir-de-votre-photo');
--> statement-breakpoint
UPDATE "setting"
SET "value" = replace("value"::text, '/affiches/affiche-ia-a-partir-de-votre-photo', '/affiches/affiche-a-partir-de-votre-photo')::jsonb
WHERE "value"::text LIKE '%/affiches/affiche-ia-a-partir-de-votre-photo%'
  AND EXISTS (SELECT 1 FROM "product" WHERE "slug" = 'affiche-a-partir-de-votre-photo');
--> statement-breakpoint
UPDATE "page"
SET "blocks" = replace("blocks"::text, '/affiches/affiche-ia-a-partir-de-votre-photo', '/affiches/affiche-a-partir-de-votre-photo')::jsonb
WHERE "blocks"::text LIKE '%/affiches/affiche-ia-a-partir-de-votre-photo%'
  AND EXISTS (SELECT 1 FROM "product" WHERE "slug" = 'affiche-a-partir-de-votre-photo');
--> statement-breakpoint
UPDATE "page"
SET "translations" = replace("translations"::text, '/affiches/affiche-ia-a-partir-de-votre-photo', '/affiches/affiche-a-partir-de-votre-photo')::jsonb
WHERE "translations"::text LIKE '%/affiches/affiche-ia-a-partir-de-votre-photo%'
  AND EXISTS (SELECT 1 FROM "product" WHERE "slug" = 'affiche-a-partir-de-votre-photo');
--> statement-breakpoint
UPDATE "menu_item"
SET "position" = "position" + 1
WHERE "emplacement" = 'haut'
  AND "parent_id" IS NULL
  AND "position" > coalesce(
    (SELECT m."position" FROM "menu_item" m WHERE m."id" = 8 AND m."parent_id" IS NULL AND m."emplacement" = 'haut'),
    (SELECT max(m."position") FROM "menu_item" m WHERE m."parent_id" IS NULL AND m."emplacement" = 'haut')
  )
  AND EXISTS (SELECT 1 FROM "product" WHERE "slug" = 'affiche-a-partir-de-votre-photo')
  AND NOT EXISTS (SELECT 1 FROM "menu_item" WHERE "href" = '/affiches/affiche-a-partir-de-votre-photo');
--> statement-breakpoint
INSERT INTO "menu_item" ("emplacement", "parent_id", "label", "href", "position", "visible", "translations")
SELECT 'haut', NULL, 'Votre photo en affiche', '/affiches/affiche-a-partir-de-votre-photo',
  coalesce(
    (SELECT m."position" FROM "menu_item" m WHERE m."id" = 8 AND m."parent_id" IS NULL AND m."emplacement" = 'haut'),
    (SELECT max(m."position") FROM "menu_item" m WHERE m."parent_id" IS NULL AND m."emplacement" = 'haut'),
    0
  ) + 1,
  true,
  '{"en":{"label":"Your photo as a poster"},"de":{"label":"Ihr Foto als Poster"},"it":{"label":"La tua foto in un poster"},"es":{"label":"Tu foto en un póster"},"ja":{"label":"写真でつくるポスター"},"zh":{"label":"用照片定制海报"}}'::jsonb
WHERE EXISTS (SELECT 1 FROM "product" WHERE "slug" = 'affiche-a-partir-de-votre-photo')
  AND NOT EXISTS (SELECT 1 FROM "menu_item" WHERE "href" = '/affiches/affiche-a-partir-de-votre-photo');
