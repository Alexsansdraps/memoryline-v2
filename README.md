# Memory Line — refonte sur mesure

Refonte complète de [memoryline.fr](https://memoryline.fr) — plateforme d'**affiches personnalisées**,
reconstruite **100% sur mesure, sans Shopify**.

Trois usages :
- 🛒 **Site web public** — vitrine, configurateur d'affiche, panier, **paiement Stripe + PayPal intégrés au site**.
- 🎪 **Kiosque salon** — tablette **libre-service** sur URL dédiée : le visiteur configure son affiche,
  laisse **nom + email** (pas de paiement) → la commande part au back-office.
- ⚙️ **Back-office** — gestion catalogue, personnages, assets et commandes (ergonomie familière façon
  Shopify). **Commandes web et salon séparées.** La cliente **imprime le PDF** (nommé d'après le client) direct.

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

## Rien ne se supprime

Chez Memory Line, **supprimer n'existe pas : on archive**. Une chose archivée quitte la boutique et
les listes ordinaires, garde tout ce qu'elle contenait, reste visible dans le back-office sous
**Réglages → Archives**, et se restaure d'un clic. Les commandes déjà passées continuent de
s'imprimer à l'identique. Trois exceptions seulement, listées dans cet écran : les photos de
visiteurs et leur purge, les fichiers de cache, et ce qu'un client fait sur ses propres données.

`pnpm --filter @memoryline/api verifier:archivage` relit toute l'API et **échoue** sur toute
suppression réelle (`db.delete` / `tx.delete`) qui n'est pas nommément justifiée dans
`apps/api/scripts/verifier-archivage.mjs`.

## État

🚧 **Phase 0 — fondations.** Squelette en place, stack à valider (voir §8–9 du plan de dev).
