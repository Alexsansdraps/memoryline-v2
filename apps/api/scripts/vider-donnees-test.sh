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
#     stands sont FERMÉS : leur code a circulé pendant les essais, et un stand
#     ouvert enregistre des ventes sans paiement. Le vrai stand se ROUVRE à la
#     main (BO › Ventes stand : « Nouveau code », puis « Ouvrir »), et la
#     tablette prend la nouvelle adresse « /?stand=1&code=… » ;
#   - les caches recalculables : aperçus des commandes, PDF d'impression.
#
# CE QUI RESTE :
#   - les commandes payées POUR DE VRAI (paiement « live » encaissé), et leur
#     cliente : la boutique encaisse en réel depuis le 16/11 au soir, et une
#     vente réelle est une pièce comptable qu'il faut pouvoir rembourser depuis
#     sa fiche (WEB-0016, l'essai d'Alexandra). La première vraie commande
#     prendra donc le numéro suivant (WEB-0017), pas WEB-0001 ;
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

# Posé à la fin d'un vidage réussi : ce script ne se lance qu'UNE fois. Comme
# aucune commande ne vient de Shopify, « legacy_id IS NULL » désigne aussi
# TOUTES les vraies commandes à venir : relancé après l'ouverture, il
# viderait la vraie boutique.
MARQUE="sauvegardes/VIDAGE-FAIT"

# Quoi qu'il arrive après l'arrêt de l'API (étape 2), elle redémarre et la
# page de maintenance s'en va : sans cela, une erreur à l'étape 3 ou 4
# laissait la boutique en panne (set -e arrête le script avant l'étape 5).
API_ARRETEE=0
remettre_en_route() {
  if [ "$API_ARRETEE" = 1 ]; then
    echo "→ Le script s'est arrêté en route : redémarrage de l'API…" >&2
    $COMPOSE up -d api ||
      echo "✗ L'API n'a PAS redémarré. À la main : $COMPOSE up -d api" >&2
    rm -f maintenance/ACTIVE
  fi
}
trap remettre_en_route EXIT

echo "=== Ce que la base contient aujourd'hui ==="
psql_base -P footer=off <<'SQL'
SELECT 'Commandes et paniers à supprimer' AS quoi, count(*) AS nombre FROM "order" o WHERE o.legacy_id IS NULL AND NOT EXISTS (SELECT 1 FROM payment p WHERE p.order_id = o.id AND p.mode = 'live' AND p.status = 'succeeded')
UNION ALL SELECT '  dont payées ou réglées (en essai)', count(*) FROM "order" o WHERE o.legacy_id IS NULL AND o.status <> 'draft' AND NOT EXISTS (SELECT 1 FROM payment p WHERE p.order_id = o.id AND p.mode = 'live' AND p.status = 'succeeded')
UNION ALL SELECT 'Ventes RÉELLES gardées (paiement live)', count(*) FROM "order" o WHERE o.legacy_id IS NULL AND EXISTS (SELECT 1 FROM payment p WHERE p.order_id = o.id AND p.mode = 'live' AND p.status = 'succeeded')
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
SELECT 'Promotion' AS quoi, name AS nom, type, coalesce(code, '(automatique)') AS code,
       CASE WHEN archived_at IS NOT NULL THEN 'archivée' WHEN active THEN 'ACTIVE' ELSE 'éteinte' END AS etat
  FROM promo_rule ORDER BY id;
SELECT 'Page' AS quoi, slug, title AS titre, status AS etat, affichage
  FROM page WHERE archived_at IS NULL ORDER BY id;
SELECT 'Lieu de retrait' AS quoi, nom, CASE WHEN active THEN 'proposé à la caisse' ELSE 'éteint' END AS etat
  FROM pickup_point WHERE archived_at IS NULL ORDER BY position, id;
SELECT 'Bandeau' AS quoi, left(message, 60) AS message, CASE WHEN active THEN 'ACTIF' ELSE 'éteint' END AS etat
  FROM announcement_banner WHERE archived_at IS NULL ORDER BY id;
SELECT 'Réglage' AS quoi, key AS cle, left(value::text, 70) AS valeur
  FROM setting
 WHERE key LIKE 'relance.%' OR key LIKE 'configurateur.video.%' ORDER BY key;
SQL

echo
echo "=== Ce qui part : les commandes passées (hors paniers), par canal et par mode de paiement ==="
psql_base -P footer=off <<'SQL'
SELECT o.channel AS canal, o.status AS etat, coalesce(p.mode, '(sans paiement en ligne)') AS paiement,
       count(*) AS nombre, to_char(max(o.created_at), 'DD/MM HH24:MI') AS derniere
  FROM "order" o
  LEFT JOIN LATERAL (
    SELECT coalesce(mode, '.env') AS mode FROM payment
     WHERE order_id = o.id AND status = 'succeeded' ORDER BY id DESC LIMIT 1
  ) p ON true
 WHERE o.legacy_id IS NULL AND o.status <> 'draft' AND NOT EXISTS (SELECT 1 FROM payment p WHERE p.order_id = o.id AND p.mode = 'live' AND p.status = 'succeeded')
 GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
SQL

echo
echo "=== Ce qui RESTE : les ventes payées pour de vrai (paiement live) ==="
psql_base -P footer=off <<'SQL'
SELECT o.number AS commande, o.status AS etat, round(o.total_cents / 100.0, 2) AS total_euros,
       to_char(o.created_at AT TIME ZONE 'Europe/Paris', 'DD/MM HH24:MI') AS le
  FROM "order" o
 WHERE o.legacy_id IS NULL AND EXISTS (SELECT 1 FROM payment p WHERE p.order_id = o.id AND p.mode = 'live' AND p.status = 'succeeded')
 ORDER BY o.id;
SQL

echo
echo "=== Bordereaux SendCloud encore ouverts : à ANNULER depuis la fiche de la commande AVANT de vider ==="
echo "    (après, la boutique ne connaît plus leur numéro d'envoi : il faudrait les annuler chez SendCloud)"
psql_base -P footer=off <<'SQL'
SELECT o.number AS commande, b.statut, CASE WHEN b.essai THEN 'essai (gratuit)' ELSE 'RÉEL (facturé)' END AS nature,
       coalesce(b.shipment_id, '') AS envoi_sendcloud, coalesce(b.tracking_number, '') AS suivi
  FROM bordereau b JOIN "order" o ON o.id = b.order_id
 WHERE b.statut IN ('en_cours', 'achete') ORDER BY b.id;
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

if [ -e "$MARQUE" ]; then
  echo "REFUS : le vidage a déjà été fait ($(cat "$MARQUE"))." >&2
  echo "Ce qui est en base depuis est la VRAIE boutique. Rien n'a été modifié." >&2
  exit 1
fi

# Un nom À PART : sauvegarder.sh nomme sa copie d'après le jour, et la mise
# en ligne qui suit le vidage (même jour) l'écraserait avec la base vidée.
AVANT="$(date +%Y-%m-%d)-avant-vidage"
if [ -e "sauvegardes/base/$AVANT.sql.gz" ]; then
  echo "REFUS : sauvegardes/base/$AVANT.sql.gz existe déjà (un vidage a commencé aujourd'hui ?)." >&2
  echo "Elle ne sera pas écrasée. Rien n'a été modifié." >&2
  exit 1
fi
echo "1/5 · Sauvegarde de la base et des fichiers (sauvegardes/base/$AVANT.sql.gz)…"
bash apps/api/scripts/sauvegarder.sh "$AVANT"

echo "2/5 · Arrêt de l'API pendant le vidage (page de maintenance affichée)…"
mkdir -p maintenance
touch maintenance/ACTIVE
API_ARRETEE=1
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
-- SAUF les ventes payées pour de vrai (paiement live) : voir « CE QUI RESTE ».
DELETE FROM "order" o
 WHERE o.legacy_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM payment p WHERE p.order_id = o.id AND p.mode = 'live' AND p.status = 'succeeded');

-- Clientes (adresses, sessions et jetons suivent en cascade).
-- Sauf celles d'une vente gardée.
DELETE FROM customer c
 WHERE c.legacy_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM "order" o WHERE o.customer_id = c.id);

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

-- Stands : tous fermés (le vrai se rouvre au BO, avec un code neuf), ceux
-- d'essai supprimés s'ils n'ont plus de vente.
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
# La base est vidée : la marque se pose TOUT DE SUITE (une panne à l'étape 4
# ne doit pas permettre un second lancement, qui viderait la vraie boutique).
date '+le %d/%m/%Y à %H:%M' > "$MARQUE"

echo "4/5 · Fichiers des essais (photos IA, aperçus, PDF d'impression)…"
# Par le conteneur : ces fichiers ont été écrits par l'API, et n'appartiennent
# pas forcément à l'utilisateur du serveur.
$COMPOSE run --rm --no-deps --entrypoint sh api -c \
  'for d in /app/data/assets/ia /app/data/assets/apercus /app/data/assets/cache/impressions; do [ -d "$d" ] && find "$d" -mindepth 1 -delete; done; true'

echo "5/5 · Redémarrage de l'API…"
$COMPOSE up -d api
API_ARRETEE=0
# La page de maintenance reste jusqu'à ce que l'API réponde (une minute et
# demie au plus), comme dans mettre-en-ligne.sh.
for _ in $(seq 1 45); do
  if $COMPOSE exec -T api node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))" </dev/null 2>/dev/null; then
    break
  fi
  sleep 2
done
rm -f maintenance/ACTIVE

echo
echo "=== Après le vidage ==="
psql_base -P footer=off <<'SQL'
SELECT 'Commandes d''essai restantes (attendu 0)' AS quoi, count(*) AS nombre FROM "order" o WHERE o.legacy_id IS NULL AND NOT EXISTS (SELECT 1 FROM payment p WHERE p.order_id = o.id AND p.mode = 'live' AND p.status = 'succeeded')
UNION ALL SELECT 'Ventes réelles gardées', count(*) FROM "order" o WHERE o.legacy_id IS NULL AND EXISTS (SELECT 1 FROM payment p WHERE p.order_id = o.id AND p.mode = 'live' AND p.status = 'succeeded')
UNION ALL SELECT 'Clientes (celles des ventes gardées)', count(*) FROM customer WHERE legacy_id IS NULL
UNION ALL SELECT 'Générations IA', count(*) FROM ai_generation
UNION ALL SELECT 'Stands ouverts', count(*) FROM stand WHERE ouvert
UNION ALL SELECT 'Compteur de factures', count(*) FROM facture_compteur;
SQL
RESTE=$(psql_base -At <<'SQL'
SELECT count(*) FROM "order" o WHERE o.legacy_id IS NULL AND NOT EXISTS (SELECT 1 FROM payment p WHERE p.order_id = o.id AND p.mode = 'live' AND p.status = 'succeeded');
SQL
)
if [ "$RESTE" != "0" ]; then
  echo "✗ Il reste $RESTE commande(s) d'essai : ne pas basculer le domaine, regarder pourquoi." >&2
  exit 1
fi
echo
echo "Terminé. La sauvegarde d'avant le vidage : sauvegardes/base/$AVANT.sql.gz"
echo "À emporter tout de suite, depuis l'ordinateur :"
echo "    scp debian@51.255.34.187:~/memoryline/sauvegardes/base/$AVANT.sql.gz ."
echo "Reste à faire à la main : rouvrir le stand (BO › Ventes stand, code neuf),"
echo "et trier ce que la liste « À trier à la main » a montré."
