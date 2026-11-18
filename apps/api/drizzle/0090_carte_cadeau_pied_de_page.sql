-- La carte cadeau dans le pied de page (18/11, Alexandra : « il faudrait
-- intégrer ce produit quelque part ») : un lien « Carte cadeau » à la fin de
-- la colonne « La boutique » (ou de la première colonne, si Margaux l'a
-- renommée), traduit. Rien si la boutique mène déjà à la carte depuis l'un
-- de ses menus, archivés compris : Margaux reste maîtresse de ses liens (BO ›
-- Menu du site), elle le déplace ou le retire comme les autres.
INSERT INTO "menu_item" ("emplacement", "parent_id", "label", "href", "position", "visible", "translations")
SELECT
  'pied',
  colonne."id",
  'Carte cadeau',
  '/carte-cadeau',
  coalesce((SELECT max(e."position") + 1 FROM "menu_item" e WHERE e."parent_id" = colonne."id"), 0),
  true,
  '{"en": {"label": "Gift card"}, "de": {"label": "Geschenkgutschein"}, "it": {"label": "Carta regalo"}, "es": {"label": "Tarjeta regalo"}}'::jsonb
FROM (
  SELECT "id" FROM "menu_item"
  WHERE "emplacement" = 'pied' AND "parent_id" IS NULL AND "archived_at" IS NULL
  ORDER BY ("label" = 'La boutique') DESC, "position" ASC, "id" ASC
  LIMIT 1
) AS colonne
WHERE NOT EXISTS (SELECT 1 FROM "menu_item" WHERE "href" LIKE '/carte-cadeau%');
