-- Ventes du stand : deux lectures de contrôle après la règle du 26/11
-- (ventes nées « À imprimer », migration 0114). LECTURE SEULE : la
-- transaction est en lecture seule, puis annulée.
--
-- Pourquoi (relecture finale du 26/11) : la mise en ligne de 14 h 31 a
-- laissé l'API rejouer 0114 à CHAQUE démarrage. Ce rejeu est retiré du code
-- depuis, mais tant que cette correction n'est pas en ligne, tout
-- redémarrage de l'API de prod (mise en ligne, plantage, redémarrage du
-- serveur) le relance.
--
-- Usage, depuis le dépôt (lecture de la base de prod : seulement avec
-- l'accord d'Alexandra) :
--   ssh -i ~/.ssh/memoryline_deploiement debian@<serveur> \
--     "docker exec -i memoryline-db-1 sh -c 'psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -A -F \" | \" -q'" \
--     < apps/api/scripts/verifier-ventes-stand-26-11.sql

BEGIN TRANSACTION READ ONLY;

-- 1. Les ventes validées par l'ANCIENNE API après que 0114 les a rendues
--    « À imprimer » (rouvertes puis revalidées pendant la mise en ligne de
--    14 h 31) : nées « Terminée » après coup, et le rejeu ne les voyait
--    pas. À remettre « À imprimer » à la main si elles n'ont pas été
--    imprimées.
SELECT o.number, o.fulfilled_at
FROM "order" o
WHERE o.channel = 'salon' AND o.status = 'paid'
  AND EXISTS (
    SELECT 1 FROM order_event v
    WHERE v.order_id = o.id
      AND v.message LIKE 'Commande prise au stand%, réglée sur place et remise : terminée.'
      AND v.created_at > (
        SELECT max(r.created_at) FROM order_event r
        WHERE r.order_id = o.id AND r.message LIKE 'Vente remise « À imprimer » le 26/11,%'));

-- 2. Les ventes que le rejeu de 0114 remettrait « À imprimer » à un
--    redémarrage de l'API, si Margaux les a marquées terminées : ni la ligne
--    de 0114, ni celle de la nouvelle validation (une vente « à encaisser »
--    du 17-19/11 encaissée depuis, ou une vente remise « À imprimer » dans
--    l'ancien BO avant 14 h 31). Vide, ou toutes encore « À imprimer » :
--    rien à craindre.
SELECT o.number, o.status, (o.fulfilled_at IS NOT NULL) AS terminee
FROM "order" o
WHERE o.channel = 'salon' AND o.number ~ '^SAL-[0-9]+$' AND o.legacy_id IS NULL
  AND o.status IN ('paid', 'pending')
  AND NOT coalesce(lower(o.tags::text)::jsonb @> '["test"]'::jsonb, false)
  AND NOT EXISTS (SELECT 1 FROM fulfillment f WHERE f.order_id = o.id AND f.status = 'success' AND coalesce(f.tracking_number, '') <> '')
  AND NOT EXISTS (SELECT 1 FROM bordereau b WHERE b.order_id = o.id AND b.statut IN ('achete', 'en_cours') AND b.essai = false)
  AND NOT EXISTS (
    SELECT 1 FROM order_event e
    WHERE e.order_id = o.id
      AND (e.message LIKE 'Vente remise « À imprimer » le 26/11,%'
        OR e.message LIKE 'Commande prise au stand%, réglée sur place : à imprimer, puis à marquer terminée au back-office.'));

ROLLBACK;
