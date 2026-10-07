# Dockerfile PRODUCTION du site public.
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
COPY apps/web/package.json apps/web/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/configurator/package.json packages/configurator/package.json
RUN pnpm install --frozen-lockfile

COPY packages/types packages/types
COPY packages/configurator packages/configurator
COPY apps/web apps/web

# Aucune page n'interroge l'API au build : le catalogue, les fiches et le plan
# du site (/sitemap.xml) sont rendus à la demande. SITE_URL, lui, est figé
# ici : il fait les adresses canoniques, les hreflang et le plan du site.
ARG SITE_URL
ARG PUBLIC_API_URL=/api
ARG API_URL_INTERNAL
# « true » = robots.txt interdit tout. Lu AU BUILD par Astro : le changer
# après coup ne changerait rien, il faut reconstruire l'image.
# Le domaine que le site accepte de se reconnaître derrière le proxy
# (cf. security.allowedDomains dans astro.config.mjs). Lu AU BUILD.
ARG ALLOWED_HOSTS
ENV ALLOWED_HOSTS=$ALLOWED_HOSTS
ARG PUBLIC_NOINDEX=false
ARG PUBLIC_JEU_ESSAI=0
ENV PUBLIC_NOINDEX=$PUBLIC_NOINDEX
ENV PUBLIC_JEU_ESSAI=$PUBLIC_JEU_ESSAI
ENV SITE_URL=$SITE_URL
ENV PUBLIC_API_URL=$PUBLIC_API_URL
ENV API_URL_INTERNAL=$API_URL_INTERNAL
RUN pnpm --filter @memoryline/web run build

# --- Étage 2 : exécution ---------------------------------------------------
FROM node:24-alpine
RUN corepack enable
WORKDIR /app

# `tsconfig.base.json` et `turbo.json` sont référencés depuis les paquets :
# sans eux, Astro s'arrête sur « Cannot find module '../../tsconfig.base.json' ».
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json turbo.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/configurator/package.json packages/configurator/package.json
# Seules les dépendances d'exécution : le compilateur Astro, Tailwind et Vite
# ont fait leur travail à l'étage précédent.
RUN pnpm install --frozen-lockfile --prod

COPY packages/types packages/types
COPY packages/configurator packages/configurator
COPY --from=build /app/apps/web/dist apps/web/dist

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321
EXPOSE 4321

CMD ["node", "apps/web/dist/server/entry.mjs"]
