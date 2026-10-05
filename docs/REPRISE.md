# Reprise du chantier — 5 octobre 2026

À lire en premier par la session qui reprend. Ce fichier se supprime une fois tout terminé et mis en ligne.

## Le contexte

Memory Line est une boutique d'affiches illustrées personnalisables. Alexandra la développe pour sa cliente, Margaux (boutique « Donuts Corner »). Les messages destinés à Margaux s'écrivent en **tutoiement**.

Les demandes arrivent sous forme de cartes Trello, que l'utilisatrice colle en captures. ❌ veut dire « pas bon / à faire ».

- `main` fait foi. Tout le travail ci-dessous y est poussé.
- Le serveur de test (OVH) se met à jour avec une archive : voir « Mise en ligne » plus bas.

## Fait, vérifié et poussé

- **Styles d'affiche IA** : « Personnes / Animaux », « Paysage » et « Maison / Bâtiment » (migration 0063). Le client en choisit un avant sa photo. Les titres se traduisent dans Affiches IA › Styles proposés — **mais la saisie n'est pas faite** : « Portrait », « Couple » et « Paysage » sortent encore en français dans les quatre autres langues (mesuré sur /api/ia/prompts?lang=). Le mécanisme marche, les mots manquent.
- **Affiche IA**
  - Choisir une photo ne lance plus jamais la création toute seule : c'est toujours le bouton « Créer mon affiche ».
  - Le sens (portrait ou paysage) se déduit de la photo tant que le client ne l'a pas choisi lui-même.
  - Toutes les créations de la séance restent en vignettes : on peut en revoir une et en ajouter plusieurs au panier, pour le stand. Elles sont gardées par panier dans le sessionStorage.
- **Mode stand, page panier sur tablette**
  - Liste et formulaire côte à côte à partir de 768 px.
  - Retirés : « Stand : … — Changer de code », « Nous vous écrivons… » et « Aucun paiement en ligne ».
- **Sommaire des réglages du personnage** (étape 2) : pastilles Peau, Vêtements…, qui mènent chacune à sa section.
- **Bandeaux visuels personnalisables** : écran /bo/bandeaux-visuels, réglage `bandeaux.visuels`. Ils remplacent l'encart d'accueil, qui est repris automatiquement.
- **PDF d'impression fiables**
  - Une file d'attente pour les rendus.
  - Les fichiers des commandes à expédier sont préparés à l'avance.
  - Les états s'affichent au BO.
  - La liste des commandes a des boutons PDF, plus « Tout » en .zip.
- **Fonds SVG contenant des images WebP** : 12 fonds s'imprimaient presque BLANCS. C'est corrigé dans `pdf.ts` (`sansWebp`, plus une nouvelle clé de cache pour ces fonds).
  - ⚠️ Commandes déjà imprimées avec ces fonds (Ault, Baie de Somme, Berck, Côte d'Opale, Fort-Mahon, Le Crotoy, Le Tréport, Soissons, Thourotte, Vieux-Moulin, Villers-Cotterêts) : à vérifier avec la cliente.
- **Cartes BO**
  - Cadres : case « afficher le supplément ».
  - Ordre des pages et des collections : migration 0064, le menu suit.
  - Écran Pages : liste des pages de la boutique et des rayons, menu.
  - Clients façon Shopify : abonnement, emplacement, cases à cocher, pagination par 50, **import CSV**.
  - Statistiques : période libre, séparation site / stands / salon, par sorte d'affiche.
  - FAQ du BO à jour.
- **Script de mise en ligne en une commande** : `apps/api/scripts/mettre-en-ligne.sh`.

## Commencé mais INTERROMPU : à vérifier et à finir

Les agents ont été arrêtés avant leur dernière vérification. Tout compile (voir « Vérifications »), mais rien n'a été contrôlé à l'écran.

### 1. Cartes « MODULE »

Fichiers : `packages/configurator/**`, `apps/web/src/styles/global.css`, `apps/admin/src/pages/categories-pieces.astro`, `personnages/piece.astro`, `apps/api/src/couleur-principale.ts`, migration 0065.

- **« Ne pas proposer de modifier la couleur de détails (ex : ruban du chapeau) »** : un réglage par catégorie de pièces (« Couleurs proposées : toutes / seulement la principale »), avec une exception possible par pièce.
  - Vérifier le BO, le module, et que l'impression garde la couleur d'origine des zones non proposées.
- **« SCROLLE horizontal et vertical, boutons et barres trop discrets, penser aux vieux »**, sur le site et dans le module (`Defilement.tsx`, `global.css`).
  - Vérifier à 320, 375, 768 et 1280 px, et sur tablette.
- **« Augmenter un peu la taille des étapes »** : les onglets « 1. Fond & texte / 2. Personnages / 3. Format » (`index.tsx`).
- **Mode stand** : l'étape « 3. Format » doit tenir sur la tablette sans défiler, en 768×1024 et 1024×768 (`StepFormat.tsx`).
- **Coupé en plein travail** : l'agent ajoutait des libellés dans `MessagesConfigurateur`. Il faut les faire passer par `tr("cfg.…")` dans `apps/web/src/islands/ConfiguratorIsland.tsx`, avec leurs 5 langues dans `apps/web/src/i18n/ui.ts`. Sinon, ces textes restent en français partout.

### 2. Cartes « SITE »

- **Police des produits « un peu plus gras, plus petit, comme le site actuel »**. Mesures prises sur memoryline.fr :
  - description de la fiche produit : Inter 16 px, graisse 600, espacement 0,6 px, interligne 1,8 ;
  - les titres des vignettes étaient déjà en 14 px, graisse 600.
- **Boutons pleins noirs « pas assez visible quand on a cliqué »** :
  - état `:active` bien visible ;
  - état sélectionné (`aria-pressed`, `aria-checked`) distinct du survol, avec une coche ou un anneau terracotta.
- **« Nombre de produits par ligne sur TOUTES LES PAGES »** : `packages/types/src/grille.ts`, `apps/web/src/lib/grille.ts`, `VignetteAffiche.astro`.
  - Vérifier toutes les listes : boutique, rayons, accueil, recherche, pages libres, produits liés.
  - Vérifier aussi le réglage du BO.

### 3. Signature des créations (« logo signature en bas à droite sur chaque création »)

- **Fait, impression** : `pdf.ts` → `signaturePosee` (dernière couche) ; `fichiers-impression.ts` → `signatureDesCreations` (lu dans les réglages et inclus dans l'empreinte des fichiers).
  - Réglage : BO › Contenu du site › « Signature des créations » (image, largeur, marge, opacité, interrupteur).
  - Par défaut : allumée, avec le logo `logo-memory-line.png`, 12 % du petit côté, marge de 3 %.
- **À faire, aperçus à l'écran** : `apps/web/src/lib/signature.ts` (`signatureDesCreations()`) est prêt.
  - Il faut le lire dans les pages (`affiches/[slug].astro`, panier, commande) et passer une prop `signature` à `ConfiguratorIsland` → `Configurator` → `PosterPreview`, ainsi qu'à `AfficheIA`, `CartIsland` et `CheckoutIsland`.
  - L'afficher en bas à droite, à la même taille que le PDF : un calque `position:absolute; inset:0; container-type:size`, avec une image de largeur `calc(largeur × 100cqmin)` et des marges `marge × 100cqmin`.
- **À demander à Margaux** : son vrai fichier de signature (PNG transparent).

### 4. Facultatif

Le prix des cadres est aujourd'hui masqué par une règle CSS (`.ml-sans-prix-cadres`). On pourrait la remplacer par une prop `sansPrixCadres` dans `StepFormat.tsx`, transmise par `ConfiguratorIsland`.

## Questions en attente de la cliente

- Le fichier de son logo signature.
- La fin de la phrase de la carte « Stats : … séparer les différents… ». On a supposé : site / stands / salons, plus par sorte d'affiche.
- L'import des clients : la date de consentement est celle de l'import ; le statut Shopify « pending » est compté comme non abonné. Est-ce correct ?
- Les 15 affiches « prêtes à imprimer » n'ont que des photos de mise en scène en 1020×1400. Leur PDF est refusé comme trop flou : il faut les visuels d'origine en haute définition.
- Les couleurs de cheveux « brun clair » et « châtain clair » (codes couleur), et les « espaces chelou entre personnages » (capture).
- Traduire ou non les textes pré-remplis imprimés sur les affiches (« et ses plages »).

## Vérifications (pile Docker locale, mais base DISTANTE)

> ⚠️ Le conteneur `memoryline-api` parle à une base PostgreSQL **hébergée chez Neon**, pas au conteneur `memoryline-db` — qui ne sert à rien. Donc : `db:migrate` écrit chez un tiers, les jeux d'essai des agents y restent, et `docker compose down -v` ne remet rien à zéro. À trancher par Alexandra : monter une vraie base locale pour le développement.

`docker compose up -d`, puis sous Git Bash (mettre `MSYS_NO_PATHCONV=1` devant chaque `docker exec -w`) :

```bash
MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api pnpm db:migrate
MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsc --noEmit -p .
MSYS_NO_PATHCONV=1 docker exec -w /app/packages/configurator memoryline-web npx tsc --noEmit
MSYS_NO_PATHCONV=1 docker exec -w /app/apps/admin memoryline-admin npx astro check
MSYS_NO_PATHCONV=1 docker exec -w /app/apps/web memoryline-web npx tsc --noEmit -p .
```

- Le site doit afficher seulement 3 erreurs, anciennes, dans `src/islands/StandSalon.tsx`. Toutes les autres vérifications doivent sortir sans erreur.
- ⚠️ **La dernière ligne n'est pas `astro check`, et ce n'est pas un oubli.** `@astrojs/check` n'est une dépendance que d'`apps/admin`, les conteneurs ne partagent pas leurs `node_modules`, et `memoryline-web` tourne avec `CI=true` : `npx` refuse donc de l'installer et la commande s'arrête net. Trois sessions l'ont constaté. `tsc --noEmit -p .` couvre tous les `.ts` / `.tsx` du site — îlots compris — mais **pas les fichiers `.astro`** : une page `.astro` se prouve autrement (elle répond, et ses propriétés sortent bien sérialisées dans le HTML servi).
  - À trancher par Alexandra : ajouter `@astrojs/check` à `apps/web/package.json` — ce serait une dépendance nouvelle — et rétablir alors `astro check` ici.
- Si Vite répond 504 « Outdated Optimize Dep » : `docker restart memoryline-web`.
- Site : http://localhost:8080. BO : http://localhost:4322/bo. Mailpit : http://localhost:8025.

## Mise en ligne (serveur de test)

1. Construire l'archive depuis le dernier commit, sans fins de ligne Windows :

```bash
git -c core.autocrlf=false archive --format=tar -o memoryline-deploiement.tar HEAD -- . ':(exclude)data/memoryline-archive'
tar --force-local --append -f memoryline-deploiement.tar apps/api/fonts/AnotherShabby-Regular.ttf apps/web/public/fonts/AnotherShabby-Regular.ttf
gzip -9 memoryline-deploiement.tar
```

Les deux polices AnotherShabby ne sont **pas** dans git : leur licence est non commerciale. Si elles manquent sur la machine, on saute la ligne `tar --append`, car le serveur les a déjà.

2. Puis une seule ligne, depuis PowerShell. Elle fait la sauvegarde, sort le code, construit, passe les migrations jusqu'à 0065 et redémarre :

```bash
scp memoryline-deploiement.tar.gz debian@51.255.34.187:~/ ; ssh debian@51.255.34.187 "tar -xzf ~/memoryline-deploiement.tar.gz -C ~/memoryline apps/api/scripts/mettre-en-ligne.sh && bash ~/memoryline/apps/api/scripts/mettre-en-ligne.sh"
```

- Rien à ajouter au `.env` du serveur. La clé OpenAI y est déjà.
- `SENDCLOUD_ACHATS_REELS` n'y est pas posé : les bordereaux restent en mode essai, et il ne faut pas l'activer sans l'accord explicite d'Alexandra.

## Règles du dépôt

- Ne jamais commiter `.env`, `data/`, `sauvegardes/` ni les polices AnotherShabby. Le dépôt est **privé** (vérifié auprès de GitHub le 05/10/2026 : `Alexsansdraps/memoryline-v2`, visibilité PRIVATE). La consigne ne change pas pour autant — un secret commité reste un secret à régénérer.
- Ne jamais se connecter aux comptes de la cliente (La Poste, SendCloud…) ni saisir de mot de passe. Demander des clés d'API.
- Commentaires en français qui expliquent le pourquoi, dans le ton des fichiers voisins. Pas de dépendance nouvelle. Le site est en 5 langues : tout nouveau texte va dans `ui.ts`, en fr, en (britannique), de (« Sie »), it et es (tutoiement).
