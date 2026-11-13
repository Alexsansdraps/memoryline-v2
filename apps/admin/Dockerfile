# Dockerfile PRODUCTION du back-office.
# Contexte de build = racine du monorepo (pnpm workspace).
#
# Deux étages, et c'est ce qui fait la différence de taille : le premier
# installe TOUT (y compris les outils de build, ~1 Go) et compile ; le second
# ne reçoit que le résultat et les dépendances d'exécution. L'image finale
# tient dans quelques centaines de méga-octets au lieu de plus d'un giga —
# ce qui compte sur un serveur à 4 Go de mémoire.

# --- Étage 1 : compilation -------------------------------------------------
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app

# `tsconfig.base.json` et `turbo.json` sont référencés depuis les paquets :
# sans eux, Astro s'arrête sur « Cannot find module '../../tsconfig.base.json' ».
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json turbo.json ./
COPY apps/admin/package.json apps/admin/package.json
COPY packages/types/package.json packages/types/package.json
RUN pnpm install --frozen-lockfile

COPY packages/types packages/types
COPY apps/admin apps/admin

# Le préfixe de chemin est figé AU BUILD : Astro l'écrit dans les adresses
# des fichiers statiques. Le changer après coup ne changerait rien.
# Le domaine que le back-office accepte de se reconnaître derrière le
# proxy (cf. security.allowedDomains dans astro.config.mjs). Lu AU BUILD.
ARG ALLOWED_HOSTS
ENV ALLOWED_HOSTS=$ALLOWED_HOSTS
# L'adresse de l'API vue DEPUIS le serveur (réseau interne de Docker), pour
# les appels faits au rendu des pages : connexion, listes, formulaires.
# `import.meta.env` est figé AU BUILD par Vite : passée seulement au
# démarrage, la variable n'est jamais lue, l'application retombe sur « /api »
# — une adresse relative que le serveur ne sait pas joindre — et chaque
# page qui appelle l'API répond 500 (« Failed to parse URL from /api/… »).
ARG API_URL_INTERNAL=http://api:3000
ENV API_URL_INTERNAL=$API_URL_INTERNAL
ARG ADMIN_BASE=/bo
ARG PUBLIC_API_URL=/api
ENV ADMIN_BASE=$ADMIN_BASE
ENV PUBLIC_API_URL=$PUBLIC_API_URL
# L'adresse publique du SITE, pour les liens « Voir la page », « Voir sur le
# site »… du back-office. Figée au build comme les autres : sans elle, ces
# liens retombaient sur « http://localhost:8080 » (Alexandra, 13/11).
ARG PUBLIC_ORIGIN
ENV PUBLIC_ORIGIN=$PUBLIC_ORIGIN
ENV PUBLIC_SITE_URL=$PUBLIC_ORIGIN
RUN pnpm --filter @memoryline/admin run build

# --- Étage 2 : exécution ---------------------------------------------------
FROM node:24-alpine
RUN corepack enable
WORKDIR /app

# `tsconfig.base.json` et `turbo.json` sont référencés depuis les paquets :
# sans eux, Astro s'arrête sur « Cannot find module '../../tsconfig.base.json' ».
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json turbo.json ./
COPY apps/admin/package.json apps/admin/package.json
COPY packages/types/package.json packages/types/package.json
# Seules les dépendances d'exécution : le compilateur Astro, Tailwind et Vite
# ont fait leur travail à l'étage précédent.
RUN pnpm install --frozen-lockfile --prod

COPY packages/types packages/types
COPY --from=build /app/apps/admin/dist apps/admin/dist

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4322
EXPOSE 4322

CMD ["node", "apps/admin/dist/server/entry.mjs"]
