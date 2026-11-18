-- « TOUT VOIR » en double dans le menu du haut (18/11, Alexandra : « sur le
-- menu tout voir est en double ») : l'entrée de premier niveau répétait celle
-- du menu déroulant « Affiches personnalisables », vers la même page. Elle est
-- masquée, pas supprimée : elle se rallume d'un clic dans BO › Menu du site.
UPDATE "menu_item"
SET "visible" = false
WHERE "id" = 17
  AND "label" = 'TOUT VOIR'
  AND "parent_id" IS NULL
  AND "href" = '/affiches?collection=collection-tout-voir';
