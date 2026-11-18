-- La carte cadeau dans le menu du haut (18/11, Alexandra : « c'est un lien
-- vers le produit carte cadeau », dans le menu). Une entrée de premier niveau,
-- en dernier, traduite. Rien si le menu du haut y mène déjà (archivé
-- compris). Margaux la déplace, la renomme ou la retire comme les autres
-- (BO › Menu du site, où « Carte cadeau » se choisit désormais dans la liste).
INSERT INTO "menu_item" ("emplacement", "parent_id", "label", "href", "position", "visible", "translations")
SELECT
  'haut',
  NULL,
  'Carte cadeau',
  '/carte-cadeau',
  coalesce(
    (SELECT max(e."position") + 1 FROM "menu_item" e WHERE e."emplacement" = 'haut' AND e."parent_id" IS NULL),
    0
  ),
  true,
  '{"en": {"label": "Gift card"}, "de": {"label": "Geschenkgutschein"}, "it": {"label": "Carta regalo"}, "es": {"label": "Tarjeta regalo"}}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM "menu_item" WHERE "emplacement" = 'haut' AND "href" LIKE '/carte-cadeau%'
);
