#!/usr/bin/env bash
#
# Déplace la base Memory Line d'un serveur PostgreSQL à un autre.
#
# Écrit pour passer de Neon Ohio à Neon Francfort, mais ne suppose rien de
# l'un ni de l'autre : ce sont deux adresses de connexion, c'est tout.
#
# LES DEUX ADRESSES SE LISENT DANS DES FICHIERS, jamais sur la ligne de
# commande. Une adresse de connexion contient le mot de passe de la base ;
# passée en argument, elle s'inscrirait dans l'historique du terminal et dans
# la liste des processus, visible de quiconque partage la machine.
#
#   ANCIENNE : lue dans .env, variable DATABASE_URL
#   NOUVELLE : lue dans le fichier passé en argument (une seule ligne)
#
# Usage, depuis la racine du dépôt :
#   bash apps/api/scripts/deplacer-base.sh nouvelle-url.txt
#
# Le script ne SUPPRIME rien et ne modifie pas l'ancienne base : il la lit.
# En cas de doute, on relance — on ne perd rien.
set -euo pipefail

FICHIER="${1:-}"
if [ -z "$FICHIER" ] || [ ! -f "$FICHIER" ]; then
  echo "Il manque le fichier contenant l'adresse de la NOUVELLE base." >&2
  echo "Usage : bash apps/api/scripts/deplacer-base.sh nouvelle-url.txt" >&2
  exit 1
fi
if [ ! -f .env ]; then
  echo "Fichier .env introuvable. Lancez ce script depuis la racine du dépôt." >&2
  exit 1
fi

ANCIENNE=$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2- | sed 's/^"//; s/"$//')
NOUVELLE=$(head -n1 "$FICHIER" | tr -d '\r\n' | sed 's/^"//; s/"$//')

if [ -z "$ANCIENNE" ] || [ -z "$NOUVELLE" ]; then
  echo "Une des deux adresses est vide." >&2
  exit 1
fi
if [ "$ANCIENNE" = "$NOUVELLE" ]; then
  echo "Les deux adresses sont identiques : il n'y a rien à déplacer." >&2
  exit 1
fi

echo "→ Copie de la structure et des données."
echo "  L'ancienne base est seulement LUE : rien n'y est supprimé."

# --no-owner / --no-privileges : les rôles diffèrent d'un hébergeur à l'autre,
#   et la base n'a qu'un utilisateur. Les conserver ferait échouer la
#   restauration sur un rôle qui n'existe pas en face.
# --no-comments : Neon refuse le commentaire porté par la base elle-même, qui
#   ne lui appartient pas. C'est la seule ligne qui échouerait.
# ON_ERROR_STOP : sans lui, psql continue après une erreur et laisse une base
#   à moitié remplie en annonçant une réussite.
docker run --rm \
  -e ANCIENNE="$ANCIENNE" -e NOUVELLE="$NOUVELLE" \
  postgres:18-alpine \
  sh -c 'pg_dump --no-owner --no-privileges --no-comments "$ANCIENNE" \
         | psql --quiet --set ON_ERROR_STOP=on "$NOUVELLE"'

echo
echo "✓ Copie terminée. L'ancienne base est intacte."
echo
echo "Étape suivante — vérifier que les deux bases disent la même chose :"
echo "  node apps/api/scripts/comparer-bases.mjs $FICHIER"
