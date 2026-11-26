-- Le ciel étoilé devient un produit à part (26/11, Alexandra : « c'est 2
-- produits différents !!! affiche à partir de photo et l'autre produit c'est
-- le ciel » ; « pas accessibles par les autres gens » ; « pas de param en
-- url »).
--
-- 1. `sky_enabled` : la fiche de cette affiche remplace la photo par une date,
--    une heure et un lieu (apps/api/src/ciel.ts). Faux partout par défaut :
--    aucune affiche existante ne change.
-- 2. Le produit « Ciel étoilé » lui-même (Alexandra : « mets le visible on
--    s'en fiche créé le produit ciel ») : une copie de l'affiche « à partir de
--    votre photo » — mêmes formats et prix, mêmes rayons —, en vente, à
--    l'adresse /affiches/ciel-etoile. Rien n'est fait si cette adresse existe
--    déjà ou si l'affiche photo n'existe pas (base de développement).
-- 3. Le statut « masque » (« Caché » au BO) n'a pas besoin de colonne : la
--    colonne `status` est un texte libre. Une affiche cachée s'ouvre et
--    s'achète par son adresse, mais toutes les listes du site ne retiennent
--    que « active » : catalogue, recherche, plan du site, rayons, liens entre
--    fiches.
ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "sky_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint

INSERT INTO "product" (
  "slug", "name", "description", "kind", "category_id", "ai_enabled", "sky_enabled",
  "ordre_affichage", "ordre_catalogue", "weight_grams", "base_price_cents", "status",
  "default_view", "foreground_url", "vendor", "product_type", "tags"
)
SELECT
  'ciel-etoile',
  'Ciel étoilé',
  'Le ciel exactement tel qu''il était au-dessus de vous un soir qui compte : une naissance, une rencontre, un mariage. Choisissez la date, l''heure et le lieu, ajoutez vos textes et vos personnages.',
  p."kind", p."category_id", true, true,
  p."ordre_affichage", p."ordre_catalogue", p."weight_grams", p."base_price_cents", 'active',
  p."default_view", p."foreground_url", p."vendor", p."product_type", p."tags"
FROM "product" p
WHERE p."slug" = 'affiche-a-partir-de-votre-photo'
  AND NOT EXISTS (SELECT 1 FROM "product" WHERE "slug" = 'ciel-etoile');--> statement-breakpoint

INSERT INTO "variant" (
  "product_id", "format", "price_cents", "width_mm", "height_mm", "weight_grams",
  "compare_at_cents", "cost_cents", "stock_qty", "stock_policy"
)
SELECT c."id", v."format", v."price_cents", v."width_mm", v."height_mm", v."weight_grams",
  v."compare_at_cents", v."cost_cents", v."stock_qty", v."stock_policy"
FROM "variant" v
JOIN "product" p ON p."id" = v."product_id" AND p."slug" = 'affiche-a-partir-de-votre-photo'
JOIN "product" c ON c."slug" = 'ciel-etoile'
WHERE NOT EXISTS (SELECT 1 FROM "variant" WHERE "product_id" = c."id");--> statement-breakpoint

INSERT INTO "product_collection" ("product_id", "collection_id", "position")
SELECT c."id", pc."collection_id", pc."position"
FROM "product_collection" pc
JOIN "product" p ON p."id" = pc."product_id" AND p."slug" = 'affiche-a-partir-de-votre-photo'
JOIN "product" c ON c."slug" = 'ciel-etoile'
WHERE NOT EXISTS (SELECT 1 FROM "product_collection" WHERE "product_id" = c."id");--> statement-breakpoint

-- Le visuel d'exemple (« Naissance de Mathis »), servi par le site
-- (apps/web/public/ciel). À remplacer au BO par un visuel de la boutique.
INSERT INTO "product_image" ("product_id", "url", "alt", "position")
SELECT c."id", 'https://memoryline.fr/ciel/ciel-etoile-exemple.jpg', 'Affiche ciel étoilé : Naissance de Mathis, le ciel de Mulhouse le 14 juin 2025', 0
FROM "product" c
WHERE c."slug" = 'ciel-etoile'
  AND NOT EXISTS (SELECT 1 FROM "product_image" WHERE "product_id" = c."id");
