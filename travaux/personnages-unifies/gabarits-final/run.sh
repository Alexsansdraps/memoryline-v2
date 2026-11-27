set -e
H="C:/Users/Porhansl/AppData/Local/Temp/claude/328308a43fb284eb/2aa6b87f-bbbf-4c2c-8555-2fac26f738cb/scratchpad/personnages-unifies/gabarits-final"
for f in gen.mjs zoom2.mjs mesure-planche.mjs json.mjs; do MSYS_NO_PATHCONV=1 docker cp "$H/$f" memoryline-api:/tmp/$f; done
MSYS_NO_PATHCONV=1 docker exec memoryline-api sh -c 'mkdir -p /tmp/gab-ref && node /tmp/gen.mjs /app/data/assets /tmp/gab-defs.json /tmp/gab-ref'
MSYS_NO_PATHCONV=1 docker exec memoryline-api sh -c 'cd /tmp && node /tmp/mesure-planche.mjs && node /tmp/json.mjs /tmp/gab-mesures.json /tmp/gabarits.json'
for f in planche-gabarits.jpg zoom-adultes.jpg gabarits.json gab-mesures.json gab-defs.json; do MSYS_NO_PATHCONV=1 docker cp memoryline-api:/tmp/$f "$H/$f"; done
