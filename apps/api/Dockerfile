# Dockerfile PRODUCTION pour l'API (Render).
# Contexte de build = racine du monorepo (pnpm workspace).
#
# Différences avec Dockerfile.dev :
#  - les POLICES de la charte sont installées dans l'image ;
#  - le code est copié dans l'image (pas de volume monté) ;
#  - pas de watcher : on démarre directement le serveur.
FROM node:24-alpine

RUN corepack enable

# --- Polices ---------------------------------------------------------------
# sharp rasterise le titre et le sous-titre de l'affiche via des <text> SVG :
# il utilise les polices INSTALLÉES DANS LE SYSTÈME. Sans elles, le PDF envoyé
# à l'impression sortait dans une police de repli (voire sans texte) — l'image
# de base alpine n'embarque aucune police.
#   - DM Serif Display : titre (charte Memory Line)
#   - Caveat           : sous-titre, en remplacement de « Another Shabby »
#                        (propriétaire, non fournie) — c'est déjà le repli
#                        utilisé côté web, les deux rendus concordent donc.
RUN apk add --no-cache fontconfig
COPY apps/api/fonts/ /usr/share/fonts/memoryline/
RUN fc-cache -f && fc-list | grep -Ei "dm serif|caveat"

WORKDIR /app

# 1) Manifests d'abord (cache de couches Docker).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/types/package.json packages/types/package.json

RUN pnpm install --frozen-lockfile

# 2) Code source.
COPY packages/types packages/types
COPY apps/api apps/api

# Render fournit le port via $PORT ; l'API lit API_PORT (cf. src/index.ts).
ENV NODE_ENV=production
EXPOSE 3000

CMD ["pnpm", "--filter", "@memoryline/api", "run", "start"]
