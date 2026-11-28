# Relance le générateur des accessoires dans le conteneur local memoryline-api, vérifie avec les
# fonctions du moteur (verif.ts) et rapatrie les sorties. Usage : sh run.sh [--publier]
set -e
H="$(cd "$(dirname "$0")" && pwd -W)"
C=memoryline-api; T=/tmp/gr-accessoires
MSYS_NO_PATHCONV=1 docker exec $C sh -c "mkdir -p $T/ref"
for f in gen.mjs geo.mjs pieces.mjs verif.ts; do MSYS_NO_PATHCONV=1 docker cp "$H/$f" $C:$T/$f; done
MSYS_NO_PATHCONV=1 docker cp "$H/../commun/mes.json" $C:$T/mes.json
for f in "$H"/../commun/ref/*.svg; do MSYS_NO_PATHCONV=1 docker cp "$f" $C:$T/ref/; done
MSYS_NO_PATHCONV=1 docker exec $C sh -c "cd $T && node gen.mjs $*"
MSYS_NO_PATHCONV=1 docker exec -w /app/packages/types $C /app/apps/api/node_modules/.bin/tsx $T/verif.ts
rm -rf "$H/svg"; MSYS_NO_PATHCONV=1 docker cp $C:$T/svg "$H/svg"
for f in index.json planche.jpg planche-femme.jpg planche-homme.jpg planche-enfant.jpg planche-ado.jpg planche-chat.jpg planche-lapin.jpg planche-cheval.jpg; do MSYS_NO_PATHCONV=1 docker cp $C:$T/$f "$H/$f"; done
