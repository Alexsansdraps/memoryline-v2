-- « Votre photo en affiche » rejoint le menu déroulant « Affiches
-- personnalisables », en tête (20/11, Alexandra : « réorganise en urgence le
-- menu y'en a trop et y'a plus la barre de recherche »).
--
-- Posée au premier niveau le matin même (0108), elle faisait une entrée de
-- trop sur la tablette du stand, qui ajoute en tête la page du stand : la
-- barre de recherche, qui prend la place restante, sortait de l'écran. Au
-- premier niveau, on retrouve donc exactement les entrées d'avant. Rien ne
-- bouge si l'entrée n'est plus au premier niveau, ou si « Affiches
-- personnalisables » (n° 8) n'y est plus.
UPDATE "menu_item"
SET "position" = "position" + 1
WHERE "parent_id" = 8
  AND EXISTS (
    SELECT 1 FROM "menu_item" m
    WHERE m."href" = '/affiches/affiche-a-partir-de-votre-photo' AND m."parent_id" IS NULL AND m."emplacement" = 'haut'
  )
  AND EXISTS (SELECT 1 FROM "menu_item" p WHERE p."id" = 8 AND p."parent_id" IS NULL AND p."emplacement" = 'haut');
--> statement-breakpoint
UPDATE "menu_item"
SET "parent_id" = 8,
  "position" = coalesce((SELECT min(e."position") FROM "menu_item" e WHERE e."parent_id" = 8), 1) - 1
WHERE "href" = '/affiches/affiche-a-partir-de-votre-photo'
  AND "parent_id" IS NULL
  AND "emplacement" = 'haut'
  AND EXISTS (SELECT 1 FROM "menu_item" p WHERE p."id" = 8 AND p."parent_id" IS NULL AND p."emplacement" = 'haut');
