-- Lecture seule, base LOCALE (memoryline-db18) : codes promo et cartes cadeaux utilisables pour une commande gratuite d'essai.
BEGIN READ ONLY;
SELECT id, name, type, config::text, code, active, starts_at, ends_at, archived_at IS NOT NULL AS archivee
FROM promo_rule
WHERE code IS NOT NULL AND active AND archived_at IS NULL
ORDER BY id;
SELECT id, left(code, 3) || '…' AS code_debut, initial_amount_cents, balance_cents, status, expires_at, order_id IS NOT NULL AS vendue_en_ligne, note
FROM gift_card
WHERE status = 'active' AND balance_cents > 0 AND (expires_at IS NULL OR expires_at > now())
ORDER BY balance_cents DESC
LIMIT 10;
SELECT current_database(), inet_server_addr(), version();
ROLLBACK;
