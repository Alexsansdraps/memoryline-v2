#!/bin/sh
# Copie le générateur et les références dans /tmp/gr-coiffures du conteneur, lance, rapatrie.
# Usage depuis Git Bash : sh travaux/personnages-unifies/garde-robe/coiffures/run.sh [--publier]
set -e
D=$(cd "$(dirname "$0")" && pwd)
command -v cygpath >/dev/null 2>&1 && D=$(cygpath -m "$D")
export MSYS_NO_PATHCONV=1
docker exec memoryline-api sh -c 'rm -rf /tmp/gr-coiffures/svg && mkdir -p /tmp/gr-coiffures/ref'
docker cp "$D/gen.mjs" memoryline-api:/tmp/gr-coiffures/gen.mjs
docker cp "$D/../commun/mes.json" memoryline-api:/tmp/gr-coiffures/mes.json
for f in "$D"/../commun/ref/*.svg; do docker cp "$f" memoryline-api:/tmp/gr-coiffures/ref/; done
docker exec memoryline-api sh -c "cd /tmp/gr-coiffures && node gen.mjs $*"
rm -rf "$D/svg"; mkdir -p "$D/svg"
docker cp memoryline-api:/tmp/gr-coiffures/svg/. "$D/svg/"
for f in index.json planche.jpg planche-femme.jpg planche-homme.jpg planche-enfant.jpg planche-ado.jpg; do docker cp memoryline-api:/tmp/gr-coiffures/$f "$D/$f"; done
