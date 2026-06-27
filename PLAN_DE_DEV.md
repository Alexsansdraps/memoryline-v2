# Memory Line — Plan de développement (refonte sur mesure)

> Version 2 — 2026-06-27 (ajout du lot d'améliorations cliente, cf. §18)
> Refonte complète de [memoryline.fr](https://memoryline.fr), **sans dépendance Shopify** (données reprises), plateforme 100% sur mesure.

---

## 1. Vision & objectifs

Memory Line vend des **affiches personnalisées** (villes françaises, paysages, thèmes). Le cœur du produit
est un **configurateur d'affiche** : le client choisit un fond, personnalise un titre/sous-titre, ajoute et
habille des personnages illustrés, choisit un format (A4 / A3), puis commande.

> **Constats audit memoryline.fr (2026-06-19)** — repris dans les sections concernées :
> - **~174 produits** au total, dont **~144 dans "Villes"** → volume d'import non trivial (§10).
> - **Deux gammes de prix** : affiches **personnalisables dès 23 €**, affiches **prêtes à imprimer dès 15 €**.
> - **4 étapes annoncées** : « Choisissez votre fond · Personnalisez votre texte · Choisissez vos personnages ·
>   Votre affiche prête en 2 minutes ! » (cohérent avec le configurateur 3 étapes du §6).
> - **Personnages** présentés comme : **couple, enfants, amis, grands-parents, animaux de compagnie** (plus
>   large que "Homme/Femme/Bébé" → élargir `CharacterType`, cf. §5).
> - **Formats** : **A4 (21 × 29,7 cm)** et **A3 (29,7 × 42 cm)**.
> - **Paiement affiché** : Visa, Mastercard, Amex, Apple Pay, Google Pay (= set Stripe Payment Element, §3).
> - **CTA fiche produit = « PERSONNALISER »** (ouvre le configurateur), pas un "Ajouter au panier" direct.
> - **Structure d'URL produit** : `/products/{ville-description}-affiche-personnalisee` → clé pour les 301 (§13).
> - **Newsletter** (capture email) présente en pied de page → à prévoir (§ hors périmètre v1 ou Resend).
> - **Pages légales** existantes : Mentions légales, CGV, Confidentialité, Expédition, Remboursement,
>   Gestion des cookies, Contact → à reprendre/réécrire (§13).

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
| Shopify | **Supprimé en tant que plateforme/dépendance technique** (ni thème, ni Admin API, ni metafields). ⚠️ « Supprimé » = on ne *dépend* plus de Shopify ; **les données existantes (produits, commandes, clients, assets) sont bien récupérées** via les exports (§10) et réimportées dans la nouvelle base. On ne perd rien. |
| Catalogue / panier | **Sur mesure.** |
| Paiement (web) | **Stripe + PayPal, intégrés au site** (comme aujourd'hui : checkout sur le domaine, **pas de redirection** vers une page externe). Stripe **Payment Element** → reproduit le set Shopify (CB Visa/Mastercard/Amex, Apple Pay, Google Pay) ; + PayPal. |
| Mode salon | **Kiosque libre-service** sur tablette, à une **URL dédiée**. **Aucun paiement** : en fin de parcours, écran « nom + email » (les deux obligatoires) → envoi au back-office. (cf. §11 & §12) |
| Back-office | **Maison**, mais ergonomie inspirée de l'admin Shopify (familiarité cliente). La cliente **imprime le PDF** des commandes salon directement depuis le back-office. |
| Configurateur | Reconstruit sur mesure (composition SVG par couches, comme l'existant mais propre). |
| Données initiales | **Remplies depuis des exports fournis par la cliente** (Shopify : produits, commandes, clients ; + bibliothèque personnages/assets). Script d'import dédié. **Récupérer aussi TOUTES les images (SVG, PNG, JPG…) ET leurs usages actuels** dans l'application (quel asset/fond sur quel produit, dans quel slot, etc.) — pas seulement les fichiers, mais le mapping fichier → utilisation. |

### Hors périmètre v1 (à acter plus tard)
- Comptes clients / espace "mes commandes" côté acheteur (guest checkout en v1).
- Multi-langue (FR uniquement en v1).
- Gestion de stock / inventaire (produit imprimé à la demande → pas de stock).
- App mobile native (le mode salon est une **web app responsive/PWA**). ⚠️ Le **responsive est exigé sur TOUS les supports** : tablette (salon) **ET téléphone mobile** — pas seulement tablette. Le site public comme le mode salon doivent être pleinement utilisables sur smartphone.

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
Product        (affiche vendue : nom, slug, description, prix de base, images, collection,
                kind: 'personnalisable' | 'prete_a_imprimer' [audit: 23 € vs 15 € de base])
Variant        (format A4 [21×29,7] / A3 [29,7×42] → prix, dimensions d'impression)
Collection     (Villes, Thèmes & paysages, Prêtes à imprimer)
Background     (image de fond sélectionnable dans le configurateur, liée à un Product)
CharacterType  (audit memoryline.fr : couple, enfants, amis, grands-parents, animaux de compagnie…
                SVG de base + slots d'assets ; prévoir un enum/lib ouvert, pas figé à 3 types ;
                + category + position [regroupement/ordre back-office, §18.1 E] + archived_at [soft-delete §18.1 A])
Asset          (cheveux, vêtements, pantalon, accessoires : SVG + zones de couleur éditables via UI [accessoires
                inclus, §18.1 D], vue back/front)
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
- [ ] **Navigation « Retour » / « Valider mon personnage »** dans l'étape personnages (§18.2 F).
- [ ] **Glisser-déposer des personnages sur l'aperçu** (position + taille + ordre), pris en compte au rendu (§18.2 G).
- [ ] **Titre/sous-titre acceptant symboles ET chiffres** (pas de filtre bloquant) (§18.2 H).
- [ ] Rendu fidèle (couleurs, polices : Inter, DM Serif Display, Another Shabby).
- [ ] **Génération du PDF** de l'affiche, **très haute qualité + couleurs d'origine conservées**, **sans bleed
      ni page de garde**, **nom de fichier = nom du client** (cf. §12, §15).

### Phase 2 — Web public (vitrine + e-commerce)
- [ ] Home (hero, promo, best-sellers), pages catalogue & collections, fiche produit.
- [ ] Intégration du configurateur dans la fiche produit.
- [ ] Panier + **Checkout Stripe (Payment Element) + PayPal, intégrés au site** (pas de redirection)
      + webhooks + email de confirmation.
- [ ] **Modifier une affiche déjà au panier** : rouvrir le configurateur sur la ligne, ré-éditer, mettre à
      jour le snapshot de la ligne (§18.3 I).
- [ ] **Responsive téléphone mobile** (pas seulement desktop/tablette) (§2).

### Phase 3 — Back-office (familiarité Shopify)
- [ ] Auth admin. Layout type admin (nav latérale : **Commandes en ligne**, **Ventes salon**, Produits, Personnages…).
- [ ] CRUD Produits / Collections / Backgrounds. **+ barre de recherche** et **pagination affichée en haut**
      sur la liste Produits (§18.1 B, C).
- [ ] CRUD Personnages / Assets (gestion bibliothèque du configurateur), avec : **suppression/archivage de
      personnage** (§18.1 A), **éditeur de couleurs UI** des personnalisations **et des accessoires** sans coder
      (§18.1 D), **catégories + réordonnancement manuel** des personnages (§18.1 E).
- [ ] **Deux vues de commandes séparées** (web vs salon, cf. §11) : listes filtrables, fiche détaillée
      avec aperçu d'affiche. **Téléchargement / impression du PDF** depuis la fiche (cf. §12).

### Phase 4 — Mode salon (kiosque libre-service)
- [ ] **URL dédiée** + mode kiosque plein écran réutilisant le configurateur.
- [ ] Écran final **nom + email obligatoires** (pas de "ajouter au panier", **pas de paiement**)
      → `POST /api/orders` canal `salon` + génération du PDF.
- [ ] **Envoi fiable « zéro perte »** : file locale (IndexedDB) + retry auto + idempotence (`clientOrderId`)
      + PDF généré sur place en secours (**détaillé en §17**).
- [ ] **Badge « nouvelles ventes salon »** dans le back-office à chaque commande reçue (§17.3).
- [ ] **Auto-reset** de la tablette pour le visiteur suivant.
- [ ] Mode hors-ligne (PWA / service worker) pour la connectivité salon (§17.2).

### Phase 5 — Mise en prod & migration
- [ ] **Import des exports cliente** dans la BDD (cf. §10) : produits, collections, clients,
      commandes historiques, bibliothèque personnages/assets.
- [ ] Déploiement (web, admin, api, DB, R2, Stripe + PayPal en prod).
- [ ] Redirections SEO depuis les anciennes URLs, recette, bascule DNS (**détaillé en §13**).
- [ ] Reprise des **pages légales** et de la **newsletter** (cf. §13.3).

---

## 8. Risques & points à trancher

| Risque / question | Note |
|---|---|
| **Quitter Shopify = tout réimplémenter** (paiement, commandes, fiscalité, emails) | Acté. Bien border Stripe/PayPal + emails + TVA/factures. |
| Encaissement en salon | **Acté : marqué manuellement** ("payé en salon"). |
| **Séparation salon / web** | **Acté : commandes salon et web jamais mélangées** (cf. §11). Canal = dimension structurante, pas un simple tag. |
| Migration des données | Exports fournis par la cliente → script d'import (cf. §10). |
| Familiarité cliente | Investir dans l'UX du back-office (vocabulaire/flux Shopify) pour éviter le rejet. |
| SEO | memoryline.fr est référencé (~174 produits indexés) ; redirections 301 + reprise contenu/légal → **cf. §13**. |
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

**Volumétrie constatée (audit memoryline.fr, 2026-06-19)** — à confirmer à réception des exports :
- **~174 produits** au total (dont **~144 en "Villes"**) → l'import doit gérer plusieurs centaines de
  lignes produits + variantes (A4/A3) ; prévoir un import par lots et un rapport détaillé.
- **Deux gammes** : personnalisables (base 23 €) et prêtes à imprimer (base 15 €) → mapper `Product.kind`.
- Slugs produits du type `compiegne-beaux-monts-sunset-affiche-personnalisee` → conserver le slug d'origine
  pour les **redirections 301** (cf. §13).

**Sources attendues** (à confirmer au reçu) :
- `products_export.csv` (Shopify) → `Product` (+ `kind`), `Variant` (A4/A3), `Collection`, `Background`
- `customers_export.csv` → `Customer`
- `orders_export.csv` → `Order` + `OrderItem` (commandes historiques)
- Bibliothèque **personnages / assets** (JSON metafields ou SVG) → `CharacterType`, `Asset`
- **Anciens slugs/URLs produits** (extraits du `products_export.csv`) → table de redirections (§13).

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
- **Impression = geste de la cliente (moi), PAS du client final.** Depuis la fiche commande du back-office,
  bouton **« Imprimer / Télécharger le PDF »**. Pour le salon comme pour le web, **c'est moi (la cliente
  Memory Line) qui vais chercher l'affiche dans mon back-office / mon application et qui l'imprime** —
  le client final n'imprime jamais. Le PDF doit donc être **téléchargeable par moi à tout moment**, depuis
  le back-office **et** depuis l'application salon.
- **Récupération à tout moment** (acté) : pouvoir **retrouver et télécharger le fichier affiche d'un client
  n'importe quand, même sur une ancienne commande**, que ce soit une commande **en ligne** ou **salon**.
  → le PDF (ou sa régénération depuis le snapshot, §15.3) reste accessible indéfiniment depuis la fiche commande.
- **Contenu du PDF** : **l'affiche finale uniquement.** ❌ **PAS** d'encart/page de garde avec n° de commande,
  nom, format ou date (option écartée, acté). Le fichier ne contient que l'affiche imprimable.

---

## 13. Migration SEO & reprise de contenu (audit memoryline.fr)

memoryline.fr est **référencé** : la bascule ne doit perdre **ni trafic ni positions**. Cette section
cadre la reprise d'URL et de contenu à partir du site existant.

### 13.1 Cartographie des URLs (constatée à l'audit)

| Type | Pattern actuel | Cible refonte | Action |
|---|---|---|---|
| Home | `/` | `/` | conserver |
| Collection "tout" | `/collections/all` | `/affiches` (ou `/collections/all`) | **301** si l'URL change |
| Collection Villes | `/collections/villes` | `/collections/villes` | conserver le slug |
| Collection Thèmes & paysages | `/collections/themes-paysages` (à confirmer) | idem | conserver le slug |
| Prêtes à imprimer | `/collections/...pretes-a-imprimer` (404 testé → **slug à confirmer**) | idem | vérifier au reçu de l'export |
| Fiche produit | `/products/{ville-description}-affiche-personnalisee` | `/products/{même-slug}` | **conserver le slug** d'origine |
| Pages légales | `/pages/{mentions-legales, cgv, confidentialite, expedition, remboursement, contact…}` | idem | conserver + réécrire le contenu |

> ⚠️ Le slug "prêtes à imprimer" testé renvoie **404** depuis l'extérieur → récupérer le **vrai** slug
> via l'export Shopify (`products_export.csv` / collections) plutôt que de le deviner.

### 13.2 Stratégie de redirections
- Générer une **table de redirections 301** (`from_path` → `to_path`) à partir des slugs d'origine
  présents dans les exports (cf. §10). Une ligne par produit + une par page/collection dont l'URL change.
- Si tous les slugs produits sont conservés à l'identique (recommandé), **aucune 301 produit** n'est
  nécessaire — seulement pour les pages/collections renommées.
- Implémenter les 301 côté `apps/web` (Astro) + au niveau hébergeur (Vercel/Netlify `_redirects`).
- **Conserver `/sitemap.xml` et `/robots.txt`** ; régénérer un sitemap à jour à la mise en prod.

### 13.3 Contenu à reprendre / réécrire
- **Pages légales** (obligatoires e-commerce FR) : Mentions légales, **CGV**, Confidentialité (RGPD),
  Politique d'expédition, Politique de remboursement, Gestion des cookies, **Contact**. → routes statiques
  dans `apps/web`, contenu repris de l'existant (faire valider juridiquement à la cliente).
- **Métadonnées SEO** par produit/collection : titre, meta description, **balises Open Graph** (image
  d'affiche) — à régénérer depuis les données importées.
- **Newsletter** (capture email présente en pied de page) : prévoir un champ d'inscription → Resend /
  liste d'emails. (Acté hors périmètre fonctionnel v1 si besoin, mais **ne pas casser** la capture.)
- **Marqueurs de marque** : promo "3 achetées = 1 A4 offerte", baseline "votre affiche prête en 2 minutes",
  logo, polices (Inter, DM Serif Display, Another Shabby — cf. §8 droits/sources).

### 13.4 Recette SEO avant bascule DNS
- [ ] Toutes les anciennes URLs indexées répondent en **200** ou **301** (aucune **404**).
- [ ] Sitemap soumis, `robots.txt` correct, balises canoniques en place.
- [ ] Vérifier rendu Open Graph (partage réseaux sociaux) sur quelques fiches.
- [ ] Google Search Console : surveiller les 404 et la couverture les jours suivant la bascule.

---

## 14. Configurateur — spécification détaillée (`packages/configurator`)

Le configurateur est le **cœur produit** (cf. §1, Phase 1). C'est un composant SolidJS réutilisé par
`apps/web` (fiche produit) **et** `apps/admin` (mode salon). Il rend l'affiche par **composition SVG en
couches** et expose un **état sérialisable** qui devient le snapshot d'`OrderItem` (§5).

### 14.1 Modèle de couches (z-order, du fond vers l'avant)

| # | Couche | Source | Personnalisable |
|---|---|---|---|
| 0 | **Fond** (`Background`) | image/SVG du `Product` | choix parmi les fonds liés au produit |
| 1 | **Décor fixe** (cadre, sol "Wall.svg") | asset de marque | non |
| 2 | **Personnages** (0..N) | `CharacterType` + `Asset` empilés | ajout/retrait, ordre, position, tenues, couleurs |
| 3 | **Texte titre** | saisie libre | contenu, police, couleur |
| 4 | **Texte sous-titre** | saisie libre | contenu, police, couleur |

> Chaque **personnage** est lui-même une pile d'assets (corps → bas → haut → cheveux → accessoires),
> chaque asset ayant des **zones de couleur** modifiables (cf. `Asset` §5, vue front/back).

### 14.2 Étapes (UI) — alignées sur les 4 promesses du site

1. **Fond + texte** : sélection du fond, saisie titre + sous-titre, choix police & couleur de texte.
2. **Personnages** : ajouter un personnage (choix du `CharacterType`), puis pour chacun : tenue,
   couleurs (cheveux/vêtements), réordonnancement, suppression. (Le site annonce couple/enfants/amis/
   grands-parents/animaux → l'UI doit gérer **plusieurs personnages**.)
3. **Format** : A4 / A3 → prix recalculé → **« Ajouter au panier »** (web) ou **écran nom+email** (salon).

### 14.3 État sérialisable (= snapshot `OrderItem.config`)

```jsonc
{
  "schemaVersion": 1,
  "productId": "…", "backgroundId": "…",
  "format": "A4" | "A3",
  "texts": {
    "title":    { "value": "…", "font": "DM Serif Display", "color": "#1a1a1a" },
    "subtitle": { "value": "…", "font": "Inter",            "color": "#1a1a1a" }
  },
  "characters": [
    {
      "type": "femme" | "homme" | "enfant" | "bebe" | "animal" | "…",
      "x": 0.42, "y": 0.78, "scale": 1.0, "z": 0,          // positions normalisées 0..1
      "assets": [
        { "slot": "cheveux",   "assetId": "…", "colors": { "principal": "#5b3a29" } },
        { "slot": "haut",      "assetId": "…", "colors": { "principal": "#c0392b" } },
        { "slot": "bas",       "assetId": "…", "colors": { "principal": "#2c3e50" } }
      ]
    }
  ]
}
```

- **`schemaVersion`** : versionner le snapshot dès le départ (les commandes historiques importées et les
  évolutions du configurateur doivent rester lisibles → migration de snapshot possible).
- **Positions normalisées** (0..1) : indépendantes du format A4/A3 et de la résolution → un seul snapshot
  rend identiquement à l'écran et en PDF haute résolution (cf. §15).
- Stores SolidJS dédiés (un store par couche) ; un sélecteur dérivé produit ce JSON à la demande.

### 14.4 Polices & assets de marque (à sourcer, cf. §8)
- **Inter**, **DM Serif Display** (Google Fonts, licences OK) ; **Another Shabby** (police de marque →
  vérifier droits/source auprès de la cliente). Embarquer les `.woff2` et **les mêmes fontes côté rendu PDF**.
- Assets de marque connus : `Wall.svg` (sol/décor), logo, fonds. → déposés sur **R2** (§3), référencés par URL.

### 14.5 Contrat d'intégration
- Le package expose `<Configurator product={…} initialConfig={…} onChange={cfg => …} onSubmit={cfg => …} />`.
- `onSubmit` → web : ajoute au panier ; salon : déclenche l'écran nom+email puis `POST /api/orders`.
- **Aucune dépendance réseau interne** au package : il reçoit produit + assets en props (chargés par l'app
  hôte via l'API). → testable et réutilisable tel quel.

---

## 15. PDF d'impression — spécification technique (complète le §12)

Le §12 fixe le **quoi** (un PDF par commande, nom = nom client, impression depuis le back-office). Cette
section fixe le **comment**.

### 15.1 Dimensions & résolution cible

| Format | Dimensions | Pixels @ 300 DPI (impression) |
|---|---|---|
| **A4** | 210 × 297 mm | **2480 × 3508 px** |
| **A3** | 297 × 420 mm | **3508 × 4960 px** |

- Rendu à **300 DPI minimum** (qualité impression). **Exigence cliente : les fichiers imprimés doivent être
  de très grande qualité.** → privilégier une sortie **vectorielle nette** (le SVG est vectoriel, cf. §15.2)
  ou, si rasterisation, rendre aux pixels cibles ci-dessus sans compression destructrice.
- ❌ **PAS de fonds perdus / bleed, PAS de traits de coupe** (option écartée, acté). Le PDF fait exactement
  les dimensions du format (A4/A3), sans débord ni repère de coupe.
- **Conservation stricte des couleurs d'origine** (exigence cliente) : les couleurs de l'affiche à l'écran
  doivent être **fidèlement conservées** dans le fichier imprimé — aucune dérive/altération. Embarquer le
  **profil colorimétrique** dans le PDF et **ne pas dégrader** les couleurs des fonds/personnages/textes.
  Espace par défaut = sRGB ; si l'atelier exige du CMJN, gérer la conversion **sans perte de fidélité visible**.

### 15.2 Pipeline de génération
- **Source de vérité = le snapshot SVG** (§14.3), pas une capture d'écran basse résolution.
- Approche recommandée : **rendre le SVG composé à la taille cible** (le SVG est vectoriel → net à toute
  résolution) puis l'exporter en PDF. `html2canvas + jspdf` (cité Phase 1) fonctionne mais rasterise →
  s'assurer de **rendre à 2480/3508 px**, pas à la taille écran, sinon flou à l'impression.
- **Alternative à évaluer** : génération **côté serveur** (worker headless) au moment de la validation de
  commande → garantit la même sortie quel que soit le navigateur (utile pour le salon/tablette). À trancher
  en §8 : génération **client** (simple) vs **serveur** (fiable, recommandé pour le PDF officiel d'atelier).
- Fontes **embarquées** dans le PDF (mêmes `.woff2`/équivalents que le configurateur) → pas de substitution.

### 15.3 Nommage & stockage (rappel §12)
- `{NomClient-slugifié}_{NumeroCommande}.pdf` → ex. `Marie-Dupont_SAL-0087.pdf`.
- Stocké sur **R2**, lié à `PrintFile` (§5) ; bouton « Imprimer / Télécharger » sur la fiche commande.
- Régénérable à la demande depuis le snapshot (idempotent) si besoin de réimprimer.

---

## 16. Schéma de données détaillé (pseudo-SQL / Drizzle) — affine le §5

Premier jet de schéma relationnel (PostgreSQL via Drizzle). Indicatif — à figer en Phase 0.

```sql
-- Catalogue ---------------------------------------------------------------
collection   (id pk, slug uniq, name, position int)
product      (id pk, slug uniq, name, description, kind text,        -- 'personnalisable'|'prete_a_imprimer'
              base_price_cents int, collection_id fk, legacy_slug,   -- legacy_slug → redirections 301 (§13)
              created_at, updated_at)
product_image(id pk, product_id fk, url, alt, position int)
variant      (id pk, product_id fk, format text,                     -- 'A4'|'A3'
              price_cents int, width_mm int, height_mm int)
background   (id pk, product_id fk, url, name, position int)

-- Bibliothèque configurateur ---------------------------------------------
character_type(id pk, slug uniq, name,                               -- couple/enfant/bebe/animal/… (ouvert)
               category text, position int default 0,                -- §18.1 E : regroupement + ordre manuel
               archived_at timestamptz)                              -- §18.1 A : soft-delete (null = visible)
asset         (id pk, character_type_id fk, slot text,               -- 'cheveux'|'haut'|'bas'|'accessoire'
               svg_url, view text, color_zones jsonb, position int)  -- view: 'front'|'back'
                                                                     -- color_zones éditable via UI, accessoire inclus (§18.1 D)

-- Clients & commandes -----------------------------------------------------
customer      (id pk, name, email, created_at)                       -- guest, minimal
order         (id pk, channel text not null,                         -- 'web'|'salon' — IMMUABLE (§11)
               number text uniq not null,                            -- 'WEB-1042' / 'SAL-0087' (séq. séparées)
               client_order_id uuid uniq,                            -- idempotence envoi salon (§17.2)
               status text, total_cents int, customer_id fk,
               seen_at timestamptz,                                  -- null = non vue → badge "ventes salon" (§17.3)
               created_at, check (channel in ('web','salon')))
order_item    (id pk, order_id fk, product_id fk, variant_id fk,
               config jsonb not null,                                -- snapshot §14.3 (schemaVersion!)
               unit_price_cents int, quantity int)
payment       (id pk, order_id fk, provider text,                    -- 'stripe'|'paypal' — WEB UNIQUEMENT
               external_ref, status, amount_cents int, created_at)
print_file    (id pk, order_item_id fk, url, filename,               -- {NomClient}_{Num}.pdf (§15.3)
               format text, created_at)

-- Admin & SEO -------------------------------------------------------------
admin_user    (id pk, email uniq, password_hash, role, created_at)   -- auth Lucia (§3)
session       (id pk, admin_user_id fk, expires_at)                  -- session cookie httpOnly
redirect      (id pk, from_path uniq, to_path, code int)             -- 301 (§13.2), alimenté à l'import
newsletter_sub(id pk, email uniq, created_at)                        -- capture pied de page (§13.3)
```

**Index clés** : `order(channel, created_at)` (listes séparées §11), `order(number)`, `product(slug)`,
`product(collection_id)`, `redirect(from_path)`, `customer(email)`.

**Contraintes structurantes** :
- `order.channel` **non null + immuable** (jamais d'`UPDATE` du canal) → garant de la séparation §11.
- **Deux séquences** de numérotation distinctes (web / salon) → `number` jamais ambigu.
- `payment` n'existe **que** pour `channel='web'` (à garantir applicativement ; le salon n'a pas de paiement).
- `order_item.config` validé par **Zod** (miroir du schéma §14.3) avant insertion, `schemaVersion` obligatoire.

---

## 17. Commandes salon → envoi au back-office (fiabilité « zéro perte »)

Le stand fonctionne souvent sur un **réseau instable** (wifi salon, partage de connexion). Règle actée :
**aucune commande salon ne doit être perdue**, même si le réseau lâche au moment de valider. La cliente
est prévenue par un **badge** « nouvelles ventes salon » dans le back-office (pas d'email en v1).

### 17.1 Parcours d'envoi (du kiosque au back-office)

1. Le visiteur valide l'écran **nom + email** (les deux obligatoires, cf. §6.2).
2. La tablette **génère le PDF localement** (snapshot §14.3) → la commande est complète **sans réseau**.
3. La commande est **écrite dans une file d'attente locale** (voir §17.2) avec un statut `pending`.
4. Un **envoyeur en arrière-plan** tente `POST /api/orders` (canal `salon`) :
   - **Succès** → la commande passe `synced`, le back-office la reçoit dans « Ventes salon » + **badge +1**.
   - **Échec réseau** → reste `pending`, **retry automatique** (backoff) dès que la connexion revient.
5. La tablette **se réinitialise** immédiatement pour le visiteur suivant (l'envoi continue en tâche de fond).

> Conséquence : le visiteur n'attend **jamais** le réseau, et une commande non encore envoyée reste **stockée
> sur la tablette** jusqu'à confirmation serveur.

### 17.2 Résilience (« qu'on perde pas tout »)

- **File locale persistante** : commandes en attente stockées sur la tablette (**IndexedDB**), survivant à
  un rechargement de page, une mise en veille ou un redémarrage de l'app.
- **Idempotence** : chaque commande porte un **`clientOrderId`** (UUID généré sur la tablette). L'API
  déduplique sur cette clé → un retry après un succès non confirmé **ne crée pas de doublon**.
- **Retry automatique** : renvoi en backoff tant que `pending` ; reprise auto au retour du réseau
  (événement `online` / ping de l'API).
- **PWA / service worker** (Phase 4) : l'app salon reste utilisable hors-ligne (assets + configurateur en
  cache) ; le PDF de secours est déjà généré localement.
- **Filet visuel sur la tablette** : un petit indicateur « N commande(s) en attente d'envoi » pour la
  cliente, afin qu'elle ne ferme pas la tablette tant qu'il reste des `pending`.
- **Garde-fou** : tant qu'au moins une commande est `pending`, l'app **avertit avant fermeture** et tente
  un dernier envoi.

### 17.3 Côté back-office

- Nouvelle commande salon `synced` → apparaît dans **« Ventes salon »** + incrémente un **badge de nouveautés**
  (compteur de commandes salon non encore consultées).
- Le badge se **réinitialise** quand la cliente ouvre l'espace « Ventes salon » (ou marque comme vu).
- Depuis la fiche : **PDF déjà disponible** (généré sur la tablette, ou régénéré serveur depuis le snapshot)
  → bouton « Imprimer / Télécharger » (cf. §12 / §15).

### 17.4 Contrat API (rappel / précisions)

- `POST /api/orders` accepte un payload salon : `{ clientOrderId, channel:'salon', customer:{name,email},
  items:[{ productId, variantId, config }] }` → réponse `{ orderId, number:'SAL-XXXX', status }`.
- **`channel` forcé à `salon`** côté serveur pour toute requête venant du kiosque (jamais dérivé du client
  de confiance) — cohérent avec l'immuabilité du canal (§11).
- **Aucun champ paiement** dans ce flux (salon = sans paiement, §11).

---

## 18. Améliorations demandées (retour cliente 2026-06-27)

> Lot d'améliorations à intégrer **en plus** de l'existant. Aucune de ces fonctions n'est encore codée
> (le projet est en Phase 0 : schéma DB + squelette back-office/web). Ce sont donc des **spécifications**
> à réaliser dans les phases concernées. Regroupées par espace : back-office (cliente), configurateur
> (client final), panier en ligne.

### 18.1 Back-office (utilisé par la cliente) → Phase 3

| # | Amélioration | Détail | Touche |
|---|---|---|---|
| A | **Supprimer un personnage** | Pouvoir retirer un `CharacterType` quand besoin. **Mode = archivage (soft-delete)** : le perso disparaît du configurateur mais **reste en base** pour ne pas casser l'aperçu des anciennes commandes qui l'utilisaient. Réversible (réactivable). | `character_type` + UI |
| B | **Recherche produits** | Sur la page « Produits » du back-office, ajouter une **barre de recherche** (par nom/slug) pour trouver une fiche rapidement. | `produits.astro` |
| C | **Pagination produits visible en haut** | Afficher la **pagination des pages aussi en haut** de la liste (pas seulement en bas), pour les ~174 produits. | `produits.astro` |
| D | **Couleurs des personnalisations sans coder** | La cliente doit pouvoir **choisir/éditer les couleurs des personnalisations des personnages via l'UI**, sans toucher au code. Inclut **les couleurs des accessoires** (actuellement non modifiables → à corriger). | `asset.color_zones` + UI éditeur de couleurs |
| E | **Réorganiser l'affichage des personnages** | Pouvoir **changer le sens/l'ordre d'affichage** des personnages dans le module **ET les regrouper par catégories de personnes** (couple, enfants, amis, grands-parents, animaux…), car d'autres personnages seront ajoutés à terme. **Décision : catégories + ordre manuel** (glisser-déposer dans chaque catégorie). | `character_type` (ajouter `category` + `position`) + UI |

**Impacts schéma (§5 / §16) :**
- `character_type` : ajouter `archived_at timestamptz` (soft-delete, item A), `category text` (item E),
  `position int` (item E, ordre manuel). Le configurateur ne liste que les persos `archived_at IS NULL`,
  triés par `category` puis `position`.
- `asset.color_zones` (jsonb) : déjà présent → l'exposer dans un **éditeur de couleurs UI** (items D),
  **y compris pour le slot `accessoire`** (lever la limitation actuelle).

**Impacts API :**
- Endpoints CRUD personnages/assets (création, édition, **archivage**, réordonnancement, édition couleurs)
  — aujourd'hui les personnages ne sont remplis que par script d'import, **aucun CRUD** n'existe.
- `GET /characters` (n'existe pas encore) pour alimenter back-office **et** configurateur, renvoyant
  catégorie + ordre + zones de couleur.

### 18.2 Configurateur (utilisé par le client final) → Phases 1 & 2

| # | Amélioration | Détail |
|---|---|---|
| F | **Navigation « Retour > Valider mon personnage »** | Ajouter un flux clair avec bouton **« Retour »** et bouton **« Valider mon personnage »** dans l'étape personnages. |
| G | **Glisser-déposer des personnages sur l'aperçu** | Le client doit pouvoir **faire glisser ses personnages pour les placer où il veut directement sur l'aperçu de l'affiche**, et **ce placement doit être pris en compte** dans le rendu final / le PDF. **Décision : position + taille + ordre de superposition** ajustables (déplacer, redimensionner, réordonner). |
| H | **Symboles et chiffres dans titre/sous-titre** | Les champs **titre et sous-titre doivent accepter les symboles et les chiffres** (pas seulement des lettres). Aucune validation ne doit les bloquer. |

**Impacts technique (§14) :**
- Le snapshot `posterConfig` (`packages/types/src/config.ts`) prévoit déjà `x`, `y`, `scale`, `position`
  par personnage (normalisés 0..1) → **item G s'appuie dessus** ; à implémenter côté UI (pointer events
  drag + poignée de redimensionnement + gestion du z-order), et **honoré par le rendu PDF** (§15).
- `textBlock.value` est un `z.string()` libre → **item H déjà compatible** ; veiller à **ne pas ajouter**
  de filtre qui retirerait symboles/chiffres, et à ce que les **polices embarquées** rendent bien ces
  glyphes (chiffres + ponctuation courante) à l'impression.
- Item F : ajouter les contrôles de navigation dans l'UI du configurateur (`packages/configurator`).

### 18.3 Panier « en ligne » → Phase 2

| # | Amélioration | Détail |
|---|---|---|
| I | **Modifier une affiche déjà au panier** | Pouvoir **modifier l'affiche même après l'avoir ajoutée au panier** : depuis le panier, rouvrir le configurateur sur cette ligne, ré-éditer, et **mettre à jour la ligne** (sans recréer un article). |

**Impacts technique :**
- La ligne de panier conserve le **snapshot `config`** (§14.3). « Modifier » = rouvrir le configurateur
  avec `initialConfig = config` de la ligne, puis **remplacer** le snapshot de cette ligne au lieu d'ajouter
  un nouvel article. À prévoir dès la conception du panier (les commandes finalisées, elles, restent figées).

### 18.4 Rappels transverses (déjà reportés dans les §)

- **Responsive mobile téléphone** en plus de la tablette (cf. §2 hors-périmètre, corrigé).
- **PDF : très grande qualité + couleurs d'origine conservées**, **sans bleed ni page de garde** (cf. §12, §15.1).
- **C'est la cliente (moi) qui imprime/télécharge** depuis le back-office ET l'app salon, **à tout moment**,
  y compris sur d'anciennes commandes web ou salon (cf. §12).
- **Import : récupérer toutes les images + leur mapping d'usage actuel** (cf. §10 / périmètre §2).
