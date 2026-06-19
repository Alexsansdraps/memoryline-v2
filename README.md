# Memory Line — refonte sur mesure

Refonte complète de [memoryline.fr](https://memoryline.fr) — plateforme d'**affiches personnalisées**,
reconstruite **100% sur mesure, sans Shopify**.

Trois usages :
- 🛒 **Site web public** — vitrine, configurateur d'affiche, panier, paiement Stripe.
- 🎪 **Mode salon** — prise de commande rapide par la cliente sur tablette (sur place).
- ⚙️ **Back-office** — gestion catalogue, personnages, assets et commandes (ergonomie familière façon Shopify).

👉 **Voir le [plan de développement](./PLAN_DE_DEV.md)** pour l'architecture, la stack, le modèle de
données et les phases.

## Structure (monorepo)

```
apps/web      → site public (Astro + îlots SolidJS)
apps/admin    → back-office + mode salon (SolidJS)
apps/api      → API REST (Node/Hono + Prisma + Postgres) + Stripe
packages/configurator → le configurateur d'affiche (SolidJS, partagé)
packages/ui   → composants UI + design tokens partagés
packages/types → types TypeScript partagés
docs/         → specs & schémas
```

## État

🚧 **Phase 0 — fondations.** Squelette en place, stack à valider (voir §8–9 du plan de dev).
