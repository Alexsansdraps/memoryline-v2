#!/usr/bin/env bash
#
# Vide la base des données de TEST, le jour où le serveur devient la vraie
# boutique. À lancer UNE fois, sur le serveur, depuis ~/memoryline.
#
#   bash apps/api/scripts/vider-donnees-test.sh           → MONTRE seulement
#   bash apps/api/scripts/vider-donnees-test.sh --vider   → sauvegarde, puis vide
#
# Depuis l'ordinateur, en une ligne (le « -t » permet de répondre à la
# question de confirmation) :
#
#   ssh -t debian@51.255.34.187 "cd ~/memoryline && bash apps/api/scripts/vider-donnees-test.sh --vider"
#
# CE QUI PART — tout ce que les essais ont fabriqué :
#   - les commandes, paniers et ventes de stand de la nouvelle boutique, avec
#     leurs paiements, journaux, expéditions, bordereaux et fichiers
#     d'impression ;
#   - les clientes créées sur la nouvelle boutique, leurs adresses et sessions ;
#   - les générations IA et leurs fichiers (photos de clientes comprises),
#     les photos du relais téléphone ;
#   - les inscrites à la lettre, les lettres, les refus de relance ;
#   - les sessions du back-office (tout le monde se reconnecte) ;
#   - le compteur des factures, pour que la première vraie soit F2026-0001 ;
#   - les stands d'essai (nom contenant « essai » ou « test »), et tous les
#     stands sont FERMÉS : un stand ouvert serait proposé au retrait sur place ;
#   - les caches recalculables : aperçus des commandes, PDF d'impression.
#
# CE QUI RESTE :
#   - le catalogue (affiches, fonds, personnages, pièces, cadres, collections),
#     les réglages, les pages, les menus, la livraison, les promotions ;
#   - tout ce qui vient de Shopify (colonne legacy_id) : historique des
#     commandes et clientes importées ;
#   - les comptes du back-office et les cartes cadeaux : la liste en est
#     AFFICHÉE, pour les trier à la main dans le back-office (une carte
#     cadeau peut être une vraie dette de la boutique, un compte peut être
#     celui de Margaux).
#
# Les essais du catalogue (« Femme test », « Mariés (essai) ») sont ARCHIVÉS,
# pas supprimés : c'est la règle du projet, et des commandes de test ont pu
# les citer.
#
# Pourquoi pas de TRUNCATE … RESTART IDENTITY : les vignettes des courriels
# sont rangées sous le numéro de la ligne de commande. Remettre les numéros à
# 1 ferait qu'un vieux courriel d'essai montrerait l'affiche d'une vraie
# cliente. Les numéros continuent donc ; aucune cliente ne les voit. Les
# numéros de commande (WEB-0001, SAL-0001), eux, repartent d'eux-mêmes : ils
# se calculent sur la plus grande commande restante.
set -euo pipefail

COMPOSE="docker compose -f docker-compose.prod.yml"

if [ ! -f docker-compose.prod.yml ]; then
  echo "À lancer depuis ~/memoryline (docker-compose.prod.yml introuvable)." >&2
  exit 1
fi

psql_base() {
  $COMPOSE exec -T db psql -v ON_ERROR_STOP=1 -U memoryline -d memoryline "$@"
}

echo "=== Ce que la base contient aujourd'hui ==="
psql_base -P footer=off <<'SQL'
SELECT 'Commandes et paniers à supprimer' AS quoi, count(*) AS nombre FROM "order" WHERE legacy_id IS NULL
UNION ALL SELECT '  dont payées ou réglées', count(*) FROM "order" WHERE legacy_id IS NULL AND status <> 'draft'
UNION ALL SELECT 'Commandes Shopify gardées', count(*) FROM "order" WHERE legacy_id IS NOT NULL
UNION ALL SELECT 'Clientes à supprimer', count(*) FROM customer WHERE legacy_id IS NULL
UNION ALL SELECT 'Clientes Shopify gardées', count(*) FROM customer WHERE legacy_id IS NOT NULL
UNION ALL SELECT 'Générations IA', count(*) FROM ai_generation
UNION ALL SELECT 'Inscrites à la lettre', count(*) FROM newsletter_subscriber
UNION ALL SELECT 'Lettres d''information', count(*) FROM lettre
UNION ALL SELECT 'Factures déjà numérotées', count(*) FROM "order" WHERE invoice_number IS NOT NULL
UNION ALL SELECT 'Stands ouverts (seront fermés)', count(*) FROM stand WHERE ouvert
UNION ALL SELECT 'Stands d''essai à supprimer', count(*) FROM stand WHERE nom ILIKE '%essai%' OR nom ILIKE '%test%'
UNION ALL SELECT 'Sessions du back-office', count(*) FROM session;
SQL

echo
echo "=== À trier à la main dans le back-office (rien n'est supprimé ici) ==="
psql_base -P footer=off <<'SQL'
SELECT 'Compte BO' AS quoi,
       regexp_replace(email, '^(.).*@(.).*$', '\1***@\2***') AS qui,
       role,
       CASE WHEN archived_at IS NULL THEN 'actif' ELSE 'archivé' END AS etat
  FROM admin_user ORDER BY archived_at NULLS FIRST, id;
SELECT 'Carte cadeau' AS quoi, status, balance_cents / 100.0 AS solde_euros, coalesce(note, '') AS note
  FROM gift_card ORDER BY id;
SELECT 'Stand gardé' AS quoi, nom, CASE WHEN archived_at IS NULL THEN 'actif' ELSE 'archivé' END AS etat
  FROM stand WHERE NOT (nom ILIKE '%essai%' OR nom ILIKE '%test%') ORDER BY id;
SQL

echo
echo "=== Fichiers ==="
du -sh data/assets/ia data/assets/apercus data/assets/cache/impressions 2>/dev/null || true

if [ "${1:-}" != "--vider" ]; then
  echo
  echo "Rien n'a été modifié. Pour vider : bash apps/api/scripts/vider-donnees-test.sh --vider"
  exit 0
fi

if [ ! -t 0 ]; then
  echo "Il faut répondre à la confirmation : relancez avec « ssh -t »." >&2
  exit 1
fi
echo
echo "ATTENTION : la suppression est définitive (une sauvegarde est faite juste avant)."
read -r -p "Tapez VIDER pour continuer : " reponse
if [ "$reponse" != "VIDER" ]; then
  echo "Abandon. Rien n'a été modifié."
  exit 1
fi

echo "1/5 · Sauvegarde de la base et des fichiers…"
bash apps/api/scripts/sauvegarder.sh

echo "2/5 · Arrêt de l'API pendant le vidage…"
$COMPOSE stop api

echo "3/5 · Vidage de la base (une seule transaction : tout ou rien)…"
psql_base -1 <<'SQL'
-- Les générations IA d'abord : leurs clés sont en « SET NULL », elles
-- survivraient sinon aux commandes et aux clientes, chemins de photos compris.
DELETE FROM ai_generation;
DELETE FROM ia_relais_photo;

-- Commandes, paniers et ventes de stand. Le reste suit en cascade : lignes,
-- journal, paiements, encaissements, expéditions, bordereaux, remboursements,
-- fichiers d'impression.
DELETE FROM "order" WHERE legacy_id IS NULL;

-- Clientes (adresses, sessions et jetons suivent en cascade).
DELETE FROM customer WHERE legacy_id IS NULL;

-- Lettre d'information, relances, sessions du back-office.
DELETE FROM lettre;
DELETE FROM lettre_envoi;
DELETE FROM lettre_jeton;
DELETE FROM newsletter_subscriber;
DELETE FROM newsletter_sub;
DELETE FROM relance_refus;
DELETE FROM session;

-- La première vraie facture sera F2026-0001. Garde-fou : si une facture
-- numérotée reste en base (elle viendrait alors d'ailleurs que des essais),
-- le compteur n'est pas touché — la loi interdit trous et doublons.
DELETE FROM facture_compteur
 WHERE NOT EXISTS (SELECT 1 FROM "order" WHERE invoice_number IS NOT NULL);

-- Stands : tous fermés, ceux d'essai supprimés s'ils n'ont plus de vente.
UPDATE stand SET ouvert = false, closed_at = now() WHERE ouvert;
DELETE FROM stand
 WHERE (nom ILIKE '%essai%' OR nom ILIKE '%test%')
   AND NOT EXISTS (SELECT 1 FROM "order" o WHERE o.stand_id = stand.id);

-- Essais du catalogue : archivés, comme le veut la règle du projet.
UPDATE character_type SET archived_at = now()
 WHERE archived_at IS NULL AND slug LIKE 'femme-test%';
UPDATE product SET status = 'archived'
 WHERE status <> 'archived' AND slug = 'maries-essai-recette-produit-de-test';
UPDATE poster_view SET archived_at = now()
 WHERE archived_at IS NULL AND slug = 'maries-essai';

-- Réglages d'avant la table des stands : plus lus, et l'un porte un ancien code.
DELETE FROM setting WHERE key IN ('salon.code', 'salon.evenement', 'salon.ouvert');
SQL

echo "4/5 · Fichiers des essais (photos IA, aperçus, PDF d'impression)…"
# Par le conteneur : ces fichiers ont été écrits par l'API, et n'appartiennent
# pas forcément à l'utilisateur du serveur.
$COMPOSE run --rm --no-deps --entrypoint sh api -c \
  'for d in /app/data/assets/ia /app/data/assets/apercus /app/data/assets/cache/impressions; do [ -d "$d" ] && find "$d" -mindepth 1 -delete; done; true'

echo "5/5 · Redémarrage de l'API…"
$COMPOSE up -d api

echo
echo "=== Après le vidage ==="
psql_base -P footer=off <<'SQL'
SELECT 'Commandes' AS quoi, count(*) AS nombre FROM "order"
UNION ALL SELECT 'Clientes', count(*) FROM customer
UNION ALL SELECT 'Générations IA', count(*) FROM ai_generation
UNION ALL SELECT 'Stands ouverts', count(*) FROM stand WHERE ouvert
UNION ALL SELECT 'Compteur de factures', count(*) FROM facture_compteur;
SQL
echo
echo "Terminé. La sauvegarde d'avant le vidage est dans sauvegardes/."
