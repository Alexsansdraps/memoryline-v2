-- Le produit « Ciel étoilé » repasse en « Désactivé » pour l'instant (26/11,
-- Alexandra : « met le produit en hidden pour l'instant, genre desactiver »).
-- Il se réactive d'un clic au BO (fiche produit › Statut). Seule cette
-- affiche est touchée, et seulement si elle est encore en vente.
UPDATE "product" SET "status" = 'draft', "updated_at" = now()
WHERE "slug" = 'ciel-etoile' AND "status" = 'active';
