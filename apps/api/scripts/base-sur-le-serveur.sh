#!/usr/bin/env bash
#
# Copie la base distante vers la base locale du serveur, et VÉRIFIE.
#
# À lancer sur le serveur, depuis ~/memoryline. Ce script ne bascule rien :
# il remplit la base locale et compare les deux, table par table. Tant que la
# comparaison n'est pas parfaite, on ne change pas une ligne de configuration,
# et la boutique continue de tourner sur la base distante sans rien savoir de
# tout ceci.
#
# AUCUNE ADRESSE DE CONNEXION NE PASSE PAR LA LIGNE DE COMMANDE. Elle contient
# le mot de passe de la base ; écrite en argument, elle s'inscrirait dans
# l'historique du terminal et dans la liste des processus. Le conteneur de la
# base lit lui-même le fichier .env (`env_file` dans docker-compose.prod.yml),
# et tout se passe à l'intérieur.
#
#   SOURCE : $DATABASE_URL, telle qu'elle est dans .env — la base distante.
#   CIBLE  : la base locale, atteinte par sa prise locale, sans réseau ni
#            mot de passe. Elle ne PEUT donc pas désigner la source.
#
# Relançable autant de fois qu'on veut : la cible est vidée puis refaite à
# chaque passage. Une copie interrompue ne laisse jamais de demi-base.
set -euo pipefail

COMPOSE="docker compose -f docker-compose.prod.yml"

if [ ! -f docker-compose.prod.yml ]; then
  echo "À lancer depuis ~/memoryline (docker-compose.prod.yml introuvable)." >&2
  exit 1
fi

echo "→ 1/4  La base locale est-elle prête ?"
$COMPOSE up -d db
# `up -d` rend la main dès que le conteneur démarre, pas quand la base répond.
# Au tout premier démarrage, PostgreSQL passe une minute à s'initialiser.
for i in $(seq 1 60); do
  if $COMPOSE exec -T db pg_isready -U memoryline -d memoryline >/dev/null 2>&1; then
    echo "   prête."
    break
  fi
  if [ "$i" = 60 ]; then
    echo "   La base locale ne répond toujours pas après une minute." >&2
    echo "   Regardez ce qu'elle raconte :  $COMPOSE logs db" >&2
    exit 1
  fi
  sleep 1
done

# GARDE-FOU, et ce n'est pas une précaution de principe.
#
# Une fois la bascule faite, $DATABASE_URL ne désigne plus la base distante
# mais la base LOCALE. Relancer ce script tel quel viderait donc la cible —
# étape 2 — puis la recopierait depuis elle-même, désormais vide. Toutes les
# commandes, toutes les clientes, perdues en une commande qui a l'air inoffensive.
#
# On refuse net. Le jour où la source est la cible, il n'y a rien à copier.
if $COMPOSE exec -T db sh -c 'case "$DATABASE_URL" in *@db:*|*@localhost*|*@127.0.0.1*) exit 0 ;; *) exit 1 ;; esac'; then
  echo >&2
  echo "✗ La base de départ EST la base locale." >&2
  echo >&2
  echo "  Autrement dit : la bascule a déjà eu lieu. Ce script vide la base" >&2
  echo "  d'arrivée avant de la remplir — le laisser continuer effacerait" >&2
  echo "  votre boutique pour la recopier depuis le vide." >&2
  echo >&2
  echo "  Rien n'a été touché. Si vous vouliez repartir de la base distante," >&2
  echo "  remettez son adresse dans .env (elle est dans .env.avant-bascule)." >&2
  exit 1
fi

echo "→ 2/4  On vide la base locale avant de la remplir."
echo "   (elle est neuve ; et si ce script a déjà tourné, on repart propre —"
echo "    une copie par-dessus une autre laisserait des lignes en double)"
$COMPOSE exec -T db psql -v ON_ERROR_STOP=1 -U memoryline -d memoryline -q <<'SQL'
drop schema if exists public cascade;
create schema public;
SQL

echo "→ 3/4  Copie depuis la base distante. Quelques minutes, sans bruit."
# --no-owner / --no-privileges : les rôles de l'hébergeur d'en face n'existent
#   pas ici, et les conserver ferait échouer la restauration.
# --no-comments : le commentaire porté par la base elle-même ne nous appartient
#   pas et refuse d'être recréé.
# ON_ERROR_STOP : sans lui, psql continue après une erreur et annonce une
#   réussite en laissant une base à moitié remplie.
$COMPOSE exec -T db sh -c '
  pg_dump --no-owner --no-privileges --no-comments "$DATABASE_URL" \
  | psql -v ON_ERROR_STOP=1 -U memoryline -d memoryline -q
'

echo "→ 4/4  Comparaison, table par table."
# Le nombre de lignes de chaque table, en UNE requête : `query_to_xml` exécute
# un `count(*)` par table et rend le tout d'un bloc. Compter table par table
# depuis le terminal prendrait quarante-neuf allers-retours vers l'Ohio.
COMPTAGE="select table_name || ' ' ||
  (xpath('/row/c/text()',
         query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name),
                      false, true, '')))[1]::text
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE'
order by table_name"

$COMPOSE exec -T db sh -c "psql -At -d \"\$DATABASE_URL\" -c \"$COMPTAGE\"" > /tmp/ml-avant.txt
$COMPOSE exec -T db psql -At -U memoryline -d memoryline -c "$COMPTAGE" > /tmp/ml-apres.txt

AVANT=$(wc -l < /tmp/ml-avant.txt)
APRES=$(wc -l < /tmp/ml-apres.txt)
echo "   distante : $AVANT tables    locale : $APRES tables"

if diff -u /tmp/ml-avant.txt /tmp/ml-apres.txt > /tmp/ml-ecarts.txt; then
  LIGNES=$(awk '{s += $2} END {print s+0}' /tmp/ml-apres.txt)
  echo
  echo "✓ Les deux bases contiennent EXACTEMENT les mêmes lignes."
  echo "  $APRES tables, $LIGNES lignes."
  echo
  echo "  La boutique tourne toujours sur la base distante : rien n'a changé"
  echo "  pour personne. La bascule est une étape à part."
  rm -f /tmp/ml-ecarts.txt
else
  echo
  echo "✗ Les deux bases DIFFÈRENT. Ne basculez pas." >&2
  echo "  Ce qui ne colle pas (« - » distante, « + » locale) :" >&2
  sed -n '4,40p' /tmp/ml-ecarts.txt >&2
  echo >&2
  echo "  Le plus souvent, c'est que la boutique a enregistré une commande" >&2
  echo "  pendant la copie. Relancez ce script : il repart d'une base vide." >&2
  exit 1
fi
