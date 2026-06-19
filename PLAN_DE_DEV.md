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
| Catalogue / panier | **Sur mesure.** |
| Paiement (web) | **Stripe + PayPal, intégrés au site** (comme aujourd'hui : checkout sur le domaine, **pas de redirection** vers une page externe). Stripe **Payment Element** → reproduit le set Shopify (CB Visa/Mastercard/Amex, Apple Pay, Google Pay) ; + PayPal. |
| Mode salon | **Kiosque libre-service** sur tablette, à une **URL dédiée**. **Aucun paiement** : en fin de parcours, écran « nom + email » (les deux obligatoires) → envoi au back-office. (cf. §11 & §12) |
| Back-office | **Maison**, mais ergonomie inspirée de l'admin Shopify (familiarité cliente). La cliente **imprime le PDF** des commandes salon directement depuis le back-office. |
| Configurateur | Reconstruit sur mesure (composition SVG par couches, comme l'existant mais propre). |
| Données initiales | **Remplies depuis des exports fournis par la cliente** (Shopify : produits, commandes, clients ; + bibliothèque personnages/assets). Script d'import dédié. |

### Hors périmètre v1 (à acter plus tard)
- Comptes clients / espace "mes commandes" côté acheteur (guest checkout en v1).
- Multi-langue (FR uniquement en v1).
- Gestion de stock / inventaire (produit imprimé à la demande → pas de stock).
- App mobile native (le mode salon est une **web app responsive/PWA** sur tablette).

---

## 3. Stack technique proposée

Choix orientés : un seul écosystème JS/TS, déploiement simple, et réutilisation du savoir-faire SolidJS
déjà présent dans le configurateur existant. **Stack verrouillée** (décidée avec la cliente/dev) :

| Couche | Techno | Pourquoi |
|---|---|---|
| **Web public** (`apps/web`) | **Astro 5** + îlots **SolidJS** + Tailwind v4 | SEO/perf pour la vitrine, interactivité ciblée pour le configurateur. |
| **Configurateur** (`packages/configurator`) | **SolidJS** (extrait en package réutilisable) | Réutilisé par le web public ET le mode salon. Logique SVG par couches. |
| **Back-office + mode salon** (`apps/admin`) | **SolidStart** (SPA) + Tailwind | App authentifiée, riche en interactions. Le mode salon est une route plein écran de l'admin. |
| **API** (`apps/api`) | **Hono** + TypeScript | API typée bout-en-bout (RPC `hono/client`), légère, déployable seule. |
| **Base de données / ORM** | **PostgreSQL** + **Drizzle** | SQL-first, migrations limpides, runtime léger. |
| **Paiement (web)** | **Stripe** (Payment Element) **+ PayPal** | Stripe couvre CB/Apple Pay/Google Pay (= set Shopify) ; PayPal en complément. Webhooks pour confirmer. |
| **Paiement (salon)** | **Marqué manuellement** ("payé en salon") | Aucun matériel ; encaissement hors plateforme, commande taguée payée. |
| **Stockage fichiers** | **Cloudflare R2** (S3-compatible) | SVG personnages, images de fond, exports PDF d'affiches. Pas d'egress. |
| **Auth admin** | **Lucia** (session cookie httpOnly) | Une poignée d'utilisateurs (la cliente + éventuels collègues). |
| **Emails** | **Resend** | Confirmations de commande. |
| **Monorepo** | **pnpm workspaces + Turborepo** | Partage `packages/types`, `packages/ui`, `packages/configurator` ; cache de build. |

> Hébergement cible : web → Vercel/Netlify · api + DB → Railway/Fly.io · fichiers → Cloudflare R2.

---

## 4. Architecture (monorepo)

```
memoryline-custom/
├── apps/
│   ├── web/          # Site public : vitrine, catalogue, configurateur, panier, checkout Stripe + PayPal
│   ├── admin/        # Back-office cliente + MODE SALON (prise de commande sur place)
│   └── api/          # API REST : catalogue, commandes, configurateur data, webhooks Stripe + PayPal, import exports
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
| Draft Order Admin API (mode POS) | `POST /api/orders` (canal `salon`, sans paiement → §11) |
| Paiement Shopify **intégré au site** | **Stripe Payment Element + PayPal, intégrés au site** (checkout sur le domaine, pas de redirection) + webhooks de confirmation |
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
Order          (n° commande PRÉFIXÉ PAR CANAL [WEB-/SAL-], channel: web|salon [non null, immuable],
                statut, total, infos client, date) — cf. §11 séparation stricte salon/web
OrderItem      (snapshot complet de l'affiche personnalisée : fond, textes, personnages, format)
Customer       (nom, email — minimal, guest)
Payment        (web uniquement — fournisseur: stripe|paypal, référence externe, statut, montant)
PrintFile      (PDF d'impression : URL R2, nom de fichier [= nom client], format A4|A3, lié à OrderItem)
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
4. **Panier** → **Checkout (Stripe ou PayPal)** → confirmation + email.

### 6.2 Visiteur en salon — kiosque libre-service (tablette, URL dédiée)
1. La tablette est posée **ouverte sur une URL dédiée** (ex. `salon.memoryline.fr` ou `/salon`), en
   plein écran / mode kiosque. Le **visiteur se sert seul**.
2. Il configure son affiche dans le **même configurateur** (fond + texte / personnages / format).
3. **Pas de "Ajouter au panier"** : l'écran final demande **nom ET email** (les deux **obligatoires**).
4. Validation → **envoi au back-office** (création d'une commande `salon`). **Aucun paiement** sur la
   tablette.
5. La tablette **se réinitialise** pour le visiteur suivant (écran de remerciement → retour à l'accueil).
6. Côté cliente : la commande arrive dans **« Ventes salon »** avec un **PDF** (nom du fichier = nom du
   visiteur, cf. §12) qu'elle **imprime directement depuis le back-office**.

### 6.3 Cliente — gestion (back-office)
- **Commandes** : **deux espaces séparés** « Commandes en ligne » et « Ventes salon » (jamais mélangés,
  cf. §11), chacun avec listes filtrables (statut, date), fiche détaillée + aperçu de l'affiche, totaux.
- **Produits & collections** : CRUD, prix, images.
- **Personnages & assets** : gérer la bibliothèque SVG du configurateur (remplace les metafields Shopify).
- **Impression salon** : ouvrir une commande « Ventes salon » → **télécharger / imprimer le PDF**
  (nommé d'après le visiteur, cf. §12) directement depuis la fiche.

---

## 7. Phases de développement

### Phase 0 — Fondations (squelette)
- [ ] Init monorepo pnpm + Turborepo, TypeScript, Tailwind preset partagé, lint/format.
- [ ] `packages/types` : types de base. `packages/ui` : tokens + 5–6 composants.
- [ ] `apps/api` : Hono + Drizzle + schéma DB initial + migration. Healthcheck.

### Phase 1 — Configurateur (le cœur)
- [ ] Extraire/reconstruire le configurateur SVG par couches dans `packages/configurator`.
- [ ] 3 étapes : fond+texte / personnages / format. Stores SolidJS.
- [ ] Rendu fidèle (couleurs, polices : Inter, DM Serif Display, Another Shabby).
- [ ] **Génération du PDF** de l'affiche (html2canvas + jspdf), **nom de fichier = nom du client** (cf. §12).

### Phase 2 — Web public (vitrine + e-commerce)
- [ ] Home (hero, promo, best-sellers), pages catalogue & collections, fiche produit.
- [ ] Intégration du configurateur dans la fiche produit.
- [ ] Panier + **Checkout Stripe (Payment Element) + PayPal, intégrés au site** (pas de redirection)
      + webhooks + email de confirmation.

### Phase 3 — Back-office (familiarité Shopify)
- [ ] Auth admin. Layout type admin (nav latérale : **Commandes en ligne**, **Ventes salon**, Produits, Personnages…).
- [ ] CRUD Produits / Collections / Backgrounds.
- [ ] CRUD Personnages / Assets (gestion bibliothèque du configurateur).
- [ ] **Deux vues de commandes séparées** (web vs salon, cf. §11) : listes filtrables, fiche détaillée
      avec aperçu d'affiche. **Téléchargement / impression du PDF** depuis la fiche (cf. §12).

### Phase 4 — Mode salon (kiosque libre-service)
- [ ] **URL dédiée** + mode kiosque plein écran réutilisant le configurateur.
- [ ] Écran final **nom + email obligatoires** (pas de "ajouter au panier", **pas de paiement**)
      → `POST /api/orders` canal `salon` + génération du PDF.
- [ ] **Auto-reset** de la tablette pour le visiteur suivant.
- [ ] Mode hors-ligne léger (PWA) à évaluer pour la connectivité salon.

### Phase 5 — Mise en prod & migration
- [ ] **Import des exports cliente** dans la BDD (cf. §10) : produits, collections, clients,
      commandes historiques, bibliothèque personnages/assets.
- [ ] Déploiement (web, admin, api, DB, R2, Stripe + PayPal en prod).
- [ ] Redirections SEO depuis les anciennes URLs, recette, bascule DNS.

---

## 8. Risques & points à trancher

| Risque / question | Note |
|---|---|
| **Quitter Shopify = tout réimplémenter** (paiement, commandes, fiscalité, emails) | Acté. Bien border Stripe/PayPal + emails + TVA/factures. |
| Encaissement en salon | **Acté : marqué manuellement** ("payé en salon"). |
| **Séparation salon / web** | **Acté : commandes salon et web jamais mélangées** (cf. §11). Canal = dimension structurante, pas un simple tag. |
| Migration des données | Exports fournis par la cliente → script d'import (cf. §10). |
| Familiarité cliente | Investir dans l'UX du back-office (vocabulaire/flux Shopify) pour éviter le rejet. |
| SEO | memoryline.fr est référencé ; prévoir redirections 301 sur les URLs produits. |
| Fonts / assets de marque | Récupérer logo, "Another Shabby", Wall.svg, fonds — droits & sources. |

---

## 9. Prochaine étape immédiate

1. ✅ Stack validée (§3) · ✅ paiement Stripe + PayPal · ✅ encaissement salon manuel · ✅ séparation salon/web.
2. **Réception des exports cliente** (cf. §10) → on cale le mapping vers le schéma.
3. Lancer la **Phase 0** (squelette monorepo + schéma DB Drizzle).

---

## 10. Exports cliente → remplissage de la BDD

La cliente va **fournir des exports** (probablement Shopify) à reprendre dans la nouvelle base.
Tout export reçu est déposé dans **`data/exports/`** (gitignored — données réelles/PII), avec un
échantillon anonymisé dans `data/samples/` pour les tests.

**Sources attendues** (à confirmer au reçu) :
- `products_export.csv` (Shopify) → `Product`, `Variant`, `Collection`, `Background`
- `customers_export.csv` → `Customer`
- `orders_export.csv` → `Order` + `OrderItem` (commandes historiques)
- Bibliothèque **personnages / assets** (JSON metafields ou SVG) → `CharacterType`, `Asset`

**Pipeline d'import** (`apps/api/scripts/import/`) :
1. Parser le fichier source (CSV/JSON), valider via un schéma (Zod).
2. Mapper vers les entités Drizzle (cf. §5), dédupliquer (par slug/email/n° commande).
3. Uploader les fichiers binaires (SVG, images) vers R2, réécrire les URLs.
4. Insérer en transaction, journaliser un rapport d'import (créés / ignorés / erreurs).
5. Idempotent : rejouable sans créer de doublons.

> ⚠️ Les commandes historiques importées **conservent leur canal d'origine** (web vs salon) — cf. §11.
> Tant que les exports ne sont pas reçus, on développe sur `data/samples/` + données de seed.

---

## 11. Séparation stricte des commandes salon / web

**Règle (actée) : les commandes des ventes sur place (salon) et les commandes web ne sont JAMAIS
mélangées.** Le canal est une **dimension structurante** du système, pas un simple libellé.

Mise en œuvre :

- **Donnée** : `Order.channel` est un enum **non nullable** `('web' | 'salon')`, posé à la création et
  **immuable** ensuite. Indexé pour des requêtes/filtres rapides.
- **Numérotation séparée** : deux séquences distinctes, ex. `WEB-1042` vs `SAL-0087` → impossible de
  confondre une commande, y compris sur les exports/factures/bons d'impression.
- **Back-office** : deux entrées de navigation distinctes — **« Commandes en ligne »** et
  **« Ventes salon »** — chacune avec ses propres listes, filtres, totaux et stats. Pas de vue
  fourre-tout par défaut. (Une vue "Tout" reste possible mais explicitement opt-in.)
- **Création** : le canal web vient du **checkout public payé** (Stripe/PayPal) ; le canal salon vient
  **uniquement** du **kiosque libre-service** (URL dédiée, nom+email, **sans paiement**). Aucun chemin
  ne permet d'en changer après coup.
- **Paiement** : web = Stripe/PayPal, **intégré au site** (statut piloté par webhook). Salon = **aucun
  paiement** ; la commande arrive directement « à imprimer ». Les deux mondes ne se croisent pas.
- **Reporting** : volumes et exports sont **ventilés par canal** par défaut (le CA ne concerne que le web).

---

## 12. PDF d'affiche & impression depuis le back-office

Chaque commande (web ET salon) produit un **PDF imprimable** de l'affiche personnalisée.

- **Génération** : à la validation de la commande, on rend l'affiche (html2canvas → image → jspdf) au
  **bon format** (A4 / A3 selon le choix) et bonne résolution d'impression, puis on stocke le PDF sur R2.
- **Nom de fichier = nom du client.** Exigence cliente : retrouver l'affiche par le nom de la personne.
  Format proposé : `{NomClient}_{NumeroCommande}.pdf`, ex. `Marie-Dupont_SAL-0087.pdf`.
  Le nom est **slugifié** (accents/espaces/caractères spéciaux → sûrs pour un nom de fichier) tout en
  restant lisible. Le n° de commande suffixé évite toute collision entre deux clients homonymes.
- **Impression côté cliente** : depuis la fiche commande du back-office, bouton **« Imprimer / Télécharger
  le PDF »**. Pour le salon, c'est le geste principal — la cliente imprime directement, sans repasser
  par le configurateur.
- **Contenu du PDF** : l'affiche finale + (optionnel, à confirmer) un encart non imprimé avec n° de
  commande, nom client, format, date — utile pour l'atelier. À trancher : page de garde séparée ou non.
