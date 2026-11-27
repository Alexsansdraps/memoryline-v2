-- Le produit « Ciel étoilé » remis en vente (27/11, Alexandra : « le produit
-- tu le met en ligne »), après sa désactivation de la veille (0117). Seule
-- cette affiche est touchée, et seulement si elle est désactivée.
UPDATE "product" SET "status" = 'active', "updated_at" = now()
WHERE "slug" = 'ciel-etoile' AND "status" = 'draft';
