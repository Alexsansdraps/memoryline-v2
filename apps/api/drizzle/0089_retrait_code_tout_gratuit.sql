-- Le code de test « tout gratuit » d'Alexandra (V7X9-KQ4M-Z8WP-3N6R : 100 %,
-- livraison offerte, réutilisable), posé par la migration 0087, est retiré
-- (18/11 : « supp le code promo tout gratuit »). Supprimé, pas archivé : un
-- code qui offre tout ne doit pas pouvoir être restauré par erreur.
--
-- Rien ne se perd : les commandes gardent leur remise écrite en toutes
-- lettres, sans lien vers la promotion ; seul un ancien lien de bandeau
-- (colonne historique, plus lue) pouvait la viser, et il se vide de lui-même
-- (ON DELETE SET NULL). Casse et tirets ignorés, comme à la caisse.
DELETE FROM "promo_rule"
WHERE upper(replace(coalesce("code", ''), '-', '')) = 'V7X9KQ4MZ8WP3N6R';
