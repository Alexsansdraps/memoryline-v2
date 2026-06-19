# Memory Line — Plan de développement (refonte sur mesure)

> Version 1 — 2026-06-19
> Refonte complète de [memoryline.fr](https://memoryline.fr), **sans Shopify**, plateforme 100% sur mesure.

---

## 1. Vision & objectifs

Memory Line vend des **affiches personnalisées** (villes françaises, paysages, thèmes). Le cœur du produit
est un **configurateur d'affiche** : le client choisit un fond, personnalise un titre/sous-titre, ajoute et
habille des personnages illustrés, choisit un format (A4 / A3), puis commande.

Le site actuel repose sur Shopify (thème + app embarquée). **Objectif de la refonte : tout reconstruire sur
mesure, sans Shopify**, avec :

1. **Un site web public** (vitrine + configurateur + panier + paiement) — pour les commandes en ligne.
2. **Un mode "salon"** — outil rapide de prise de commande **par la cliente elle-même** sur tablette
   (config affiche + saisie client + encaissement sur place).
3. **Un back-office maison** où la cliente gère catalogue, personnages, assets et commandes.

### Contrainte produit clé : familiarité Shopify

La cliente **a l'habitude de Shopify**. Même si on quitte Shopify, le back-office doit lui être **familier** :
vocabulaire (Produits, Variantes, Commandes, Clients, Statut de la commande), listes filtrables, fiche
commande détaillée. On reprend les **patterns d'admin Shopify**, pas son code.

---

## 2. Périmètre (décidé)

| Sujet | Décision |
|---|---|
| Shopify | **Supprimé.** Aucune dépendance Shopify (ni thème, ni Admin API, ni metafields). |
| Catalogue / panier / paiement | **Sur mesure.** Paiement via **Stripe**. |
| Back-office | **Maison**, mais ergonomie inspirée de l'admin Shopify (familiarité cliente). |
| Mode salon | **Prise de commande assistée par la cliente** sur tablette (pas de kiosque libre-service). |
| Configurateur | Reconstruit sur mesure (composition SVG par couches, comme l'existant mais propre). |

### Hors périmètre v1 (à acter plus tard)
- Comptes clients / espace "mes commandes" côté acheteur (guest checkout en v1).
- Multi-langue (FR uniquement en v1).
- Gestion de stock / inventaire (produit imprimé à la demande → pas de stock).
- App mobile native (le mode salon est une **web app responsive/PWA** sur tablette).

---

## 3. Stack technique proposée

Choix orientés : un seul écosystème JS/TS, déploiement simple, et réutilisation du savoir-faire SolidJS
déjà présent dans le configurateur existant.

| Couche | Techno | Pourquoi |
|---|---|---|
| **Web public** (`apps/web`) | **Astro** + îlots **SolidJS** + Tailwind v4 | SEO/perf pour la vitrine, interactivité ciblée pour le configurateur. |
| **Configurateur** (`packages/configurator`) | **SolidJS** (extrait en package réutilisable) | Réutilisé par le web public ET le mode salon. Logique SVG par couches. |
| **Back-office + mode salon** (`apps/admin`) | **SolidJS** SPA (ou Astro+Solid) + Tailwind | App authentifiée, riche en interactions. Le mode salon est une vue de l'admin. |
| **API** (`apps/api`) | **Node + Hono** (ou Fastify) + TypeScript | API REST/JSON typée, légère, déployable seule. |
| **Base de données** | **PostgreSQL** + **Prisma** (ORM) | Relations claires (produits, variantes, commandes, personnages, assets). |
| **Paiement** | **Stripe** (Checkout + webhooks) | Standard, robuste, gère 3DS/Apple Pay/Google Pay. |
| **Stockage fichiers** | S3-compatible (ex. Cloudflare R2) | SVG personnages, images de fond, exports PDF d'affiches. |
| **Auth admin** | Session + cookie httpOnly (Lucia / maison) | Une poignée d'utilisateurs (la cliente + éventuels collègues). |
| **Monorepo** | pnpm workspaces | Partage `packages/types`, `packages/ui`, `packages/configurator`. |

> Alternative à discuter : tout-en-un **Astro** (web + API routes) si on veut réduire le nombre de services
> déployés. Recommandation : API séparée car partagée entre web public et admin/salon.

---

## 4. Architecture (monorepo)

```
memoryline-custom/
├── apps/
│   ├── web/          # Site public : vitrine, catalogue, configurateur, panier, checkout Stripe
│   ├── admin/        # Back-office cliente + MODE SALON (prise de commande sur place)
│   └── api/          # API REST : catalogue, commandes, configurateur data, Stripe webhooks
├── packages/
│   ├── configurator/ # Le configurateur d'affiche (SolidJS) — réutilisé par web + admin
│   ├── ui/           # Composants UI partagés + design tokens (Tailwind preset)
│   └── types/        # Types TS partagés (Poster, Character, Asset, Order, Product…)
├── docs/             # Specs, schéma de données, parcours utilisateurs
└── PLAN_DE_DEV.md
```

### Flux de données (vs l'ancien Shopify)

| Avant (Shopify) | Maintenant (sur mesure) |
|---|---|
| Données injectées via Liquid + metafields | API `GET /products`, `/characters`, `/assets` |
| `POST /cart/add.js` (cart Shopify) | `POST /api/cart` → panier en base/session |
| Draft Order Admin API (mode POS) | `POST /api/orders` (mode salon) |
| Paiement Shopify Checkout | **Stripe Checkout** + webhook `checkout.session.completed` |
| Commandes dans l'admin Shopify | Commandes dans le **back-office maison** |

---

## 5. Modèle de données (premier jet)

```
Product        (affiche vendue : nom, slug, description, prix de base, images, collection)
Variant        (format A4 / A3 → prix, dimensions d'impression)
Collection     (Villes, Thèmes & paysages, Prêtes à imprimer)
Background     (image de fond sélectionnable dans le configurateur, liée à un Product)
CharacterType  (Homme, Femme, Bébé… : SVG de base + slots d'assets)
Asset          (cheveux, vêtements, pantalon, accessoires : SVG + zones de couleur, vue back/front)
Order          (n° commande, canal: web|salon, statut, total, infos client, date)
OrderItem      (snapshot complet de l'affiche personnalisée : fond, textes, personnages, format)
Customer       (nom, email — minimal, guest)
Payment        (référence Stripe, statut, montant)
AdminUser      (la cliente + collègues : email, hash, rôle)
```

`OrderItem` stocke un **snapshot JSON figé** de la personnalisation (comme les `customAttributes`
Shopify aujourd'hui) → l'atelier d'impression a tout pour produire l'affiche.

---

## 6. Parcours utilisateurs

### 6.1 Client en ligne (web public)
1. Arrive sur la **home** (hero, promo "3 achetées = 1 offerte", best-sellers).
2. Navigue le **catalogue** (Villes / Thèmes / Prêtes à imprimer).
3. Ouvre une affiche → **configurateur** :
   - Étape 1 : fond + titre + sous-titre + couleur de texte.
   - Étape 2 : personnages (ajout, réordonnancement, customisation tenues/couleurs).
   - Étape 3 : format (A4/A3) → **Ajouter au panier**.
4. **Panier** → **Checkout Stripe** → confirmation + email.

### 6.2 Cliente en salon (mode salon, sur tablette)
1. Connexion au back-office, bouton **« Mode salon »** (plein écran, gros boutons, tactile).
2. Configure l'affiche **avec/pour le client** (même configurateur).
3. Saisit **nom + email** du client, choisit le format.
4. **Encaisse sur place** (Stripe Terminal ou paiement manuel marqué "payé en salon").
5. La commande apparaît dans le back-office, **taguée `salon`**, prête pour l'impression.

### 6.3 Cliente — gestion (back-office)
- **Commandes** : liste filtrable (canal, statut, date), fiche détaillée avec aperçu de l'affiche.
- **Produits & collections** : CRUD, prix, images.
- **Personnages & assets** : gérer la bibliothèque SVG du configurateur (remplace les metafields Shopify).

---

## 7. Phases de développement

### Phase 0 — Fondations (squelette)
- [ ] Init monorepo pnpm, TypeScript, Tailwind preset partagé, lint/format.
- [ ] `packages/types` : types de base. `packages/ui` : tokens + 5–6 composants.
- [ ] `apps/api` : Hono + Prisma + schéma DB initial + migration. Healthcheck.
- [ ] Décision finale stack/hébergement (cf. §3 alternative).

### Phase 1 — Configurateur (le cœur)
- [ ] Extraire/reconstruire le configurateur SVG par couches dans `packages/configurator`.
- [ ] 3 étapes : fond+texte / personnages / format. Stores SolidJS.
- [ ] Rendu fidèle (couleurs, polices : Inter, DM Serif Display, Another Shabby).
- [ ] Export PDF de l'affiche (html2canvas + jspdf) côté commande.

### Phase 2 — Web public (vitrine + e-commerce)
- [ ] Home (hero, promo, best-sellers), pages catalogue & collections, fiche produit.
- [ ] Intégration du configurateur dans la fiche produit.
- [ ] Panier + **Checkout Stripe** + webhook + email de confirmation.

### Phase 3 — Back-office (familiarité Shopify)
- [ ] Auth admin. Layout type admin (nav latérale : Commandes, Produits, Personnages…).
- [ ] CRUD Produits / Collections / Backgrounds.
- [ ] CRUD Personnages / Assets (gestion bibliothèque du configurateur).
- [ ] Liste + fiche **Commandes** avec aperçu d'affiche et export impression.

### Phase 4 — Mode salon
- [ ] Vue tactile plein écran réutilisant le configurateur.
- [ ] Prise de commande rapide + encaissement sur place + tag `salon`.
- [ ] Mode hors-ligne léger (PWA) à évaluer pour la connectivité salon.

### Phase 5 — Mise en prod & migration
- [ ] Reprise des produits/personnages/assets existants (export depuis Shopify → import).
- [ ] Déploiement (web, admin, api, DB, R2, Stripe en prod).
- [ ] Redirections SEO depuis les anciennes URLs, recette, bascule DNS.

---

## 8. Risques & points à trancher

| Risque / question | Note |
|---|---|
| **Quitter Shopify = tout réimplémenter** (paiement, commandes, fiscalité, emails) | Acté. Bien border Stripe + emails + TVA/factures. |
| Encaissement en salon | Stripe Terminal (lecteur physique) vs marquer "payé" manuellement → **à décider**. |
| Migration des données Shopify | Exporter produits + bibliothèque personnages/assets actuelle (metafields). |
| Familiarité cliente | Investir dans l'UX du back-office (vocabulaire/flux Shopify) pour éviter le rejet. |
| SEO | memoryline.fr est référencé ; prévoir redirections 301 sur les URLs produits. |
| Fonts / assets de marque | Récupérer logo, "Another Shabby", Wall.svg, fonds — droits & sources. |

---

## 9. Prochaine étape immédiate

1. **Valider la stack** (§3) et trancher l'alternative Astro tout-en-un vs API séparée.
2. **Valider l'encaissement salon** (Stripe Terminal vs manuel).
3. Lancer la **Phase 0** (squelette monorepo + schéma DB) une fois la stack validée.
