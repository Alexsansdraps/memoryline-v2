# Memory Line

Boutique d'affiches personnalisées [memoryline.fr](https://memoryline.fr), faite sur mesure (sans Shopify depuis le 17/11/2026).

- **Site public** : vitrine, module de personnalisation, caisse (Stripe et PayPal), cartes cadeaux, compte client, en 5 langues.
- **Tablette du stand** (`?stand=1`) : le visiteur compose son affiche et laisse ses coordonnées ; la vente part au back-office « à encaisser ».
- **Back-office** (`/bo`) : catalogue, personnages, commandes du site et du stand, impression des PDF, réglages.

## Structure

```
apps/web               site public (Astro + îlots SolidJS)
apps/admin             back-office (Astro + SolidJS)
apps/api               API (Hono + Drizzle + PostgreSQL)
packages/configurator  module de personnalisation (SolidJS, partagé)
packages/types         types et règles partagés
```

En local : `docker compose up -d` (site sur le port 4321, BO sur 4322, API sur 3000, Mailpit sur 8025).

**Ce qui reste à faire, la mise en ligne et les règles du projet : [`A-FAIRE.md`](./A-FAIRE.md).**
