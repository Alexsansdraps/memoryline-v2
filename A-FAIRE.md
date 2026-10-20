# À faire — état au 20 octobre, 11 h 55 (écrit pour une reprise dans un autre contexte)

Fichier de reprise : à lire en premier, à supprimer quand tout est fait. `main` fait foi ; la prod (VPS) est toujours une mise en ligne de `main`.

## 1. Ce qui est en prod (VPS, 19/10 à 17 h 23, commit `d427a11` de `main`)

Tout ce qui était fini est en ligne. Migration **0067** passée, base sauvegardée avant (`sauvegardes/base/2026-10-19.sql.gz` sur le serveur). Le chantier « cartes restantes » (stand sur tablette, écran photo IA, indice pour descendre, langues) est entièrement terminé, vérifié et en ligne, y compris sa dernière correction (confirmation du stand rechargée sur un panier neuf).

- **Cartes BO du Trello** : ordre des couleurs d'un nuancier (poignée, flèches), tri des affiches page par page (Produits › Ordre d'affichage), courriel du panier abandonné modifiable et programmable, modification groupée avec « appliquer à tout », aperçu des affiches sur la fiche commande, nuancier « peau » possible pour un animal.
- **Réponses de Margaux** : vendeurs limités à leurs stands (BO › Comptes, « Stands confiés »), lieux de retrait gérés dans BO › Livraison › Lieux de retrait, adresse et SIRET sur les factures (BO › Réglages › Factures), offre 3+1 toutes tailles, A4 offerte sans cadre, réglable dans Promotions, bandeau détaché des promos avec plusieurs messages qui défilent.
- **Autres cartes** : stand sur tablette sans défilement, écran photo de l'IA allégé, indice discret pour descendre dans l'éditeur de personnage, textes du module traduits, « Suit la couleur de… » retiré des réglages avancés, textes « mode essai » visibles seulement en essai.
- Avant : recherche du BO, SEO, bulle vidéo, refonte des couleurs du BO, cartes du module (7/10).

**Deux changements de comportement en prod**
- Un compte **vendeur** ne voit plus aucune vente tant qu'on ne lui a pas confié son stand (BO › Comptes).
- Le **retrait sur place** n'apparaît plus à la caisse tant qu'aucun lieu n'est créé (BO › Livraison › Lieux de retrait).

## 2. En cours sur le PC du BUREAU, PAS commité sur `main`

**État au 20/10, 11 h 55** : a) et b) ci-dessous sont TERMINÉS et vérifiés par leurs chantiers (types, tests, BO connecté, module, PDF), mais pas encore commités sur `main` ni en prod. Deux chantiers tournent encore : d) les accessoires et c) la fin du lot BO. Consigne d'Alexandra : **mettre tout sur le VPS quand tout est fini**, d'un coup (avec la migration 0068, et 0069 si le lot BO en crée une). L'instantané le plus récent est sur la branche **`wip-bureau-19oct`** (commit fcc7bab) : à regarder, pas à fusionner tel quel.

Les chantiers (workflows de Claude) **s'arrêtent si le PC se met en veille (réglé sur 1 h) ou si l'appli est fermée**, et ils ne peuvent pas être repris depuis un autre PC.

d) **Couleurs des accessoires** — échange du 20/10 avec Margaux : « c'est moi qui dois les changer, en ajouter et en supprimer si je veux. Pas de sélecteur pour les gens ». Cible : dans le BO, pour chaque partie personnalisable d'un accessoire, une liste de couleurs propre (autant que voulu, ajouter / retirer / ranger avec la poignée et les flèches ; sans liste propre, le nuancier de la catégorie) ; côté site, jamais de saisie libre (pastille arc-en-ciel) sur un accessoire, même sans catégorie ; PDF identique ; validation dans l'API ; aide du BO à jour. Aujourd'hui, la catégorie « Accessoires » a un nuancier de 6 couleurs partagé par toutes les parties.

a) **Refonte de BO › Personnages** — demande d'Alexandra : « il faut que ça soit logique ». Constat : la page (`apps/admin/src/pages/personnages.astro`) mélange les personnages et les 164 pièces avec leurs panneaux de couleurs dépliés ; 35 000 px de haut ; pièces nommées « Clothes 1 » en double. Cible : une page Personnages (catégories, recherche, personnages par catégorie, déplacement, archivage, traductions, « + Nouveau personnage ») ; une page **Pièces** à part dans le menu Atelier (filtres catégorie / face-dos, nom renommable sur place, couleurs ouvertes à la demande, une pièce à la fois) ; un seul accès par chose dans le menu (Atelier › Personnages / Pièces / Catégories de pièces / Pièces par personnage) ; les anciens liens et ancres gardés (recherche du BO : liens vers les pièces fabriqués dans `apps/api/src/recherche-corpus.ts`). Composant des couleurs `GroupesCouleurs.astro` réutilisé tel quel.

b) **Toutes les couleurs pour les clients du site + remise à zéro** — demande d'Alexandra : « le client peut changer toutes les couleurs en fait, il peut mettre à zéro s'il veut » (le client = la personne qui compose son affiche dans le module). Aujourd'hui : la règle par défaut est « seulement la couleur principale » (migration 0066, `piece_category.couleurs_proposees`), et sous « toutes », chaque ombre est une ligne à part qui ne suit pas la couleur choisie (`groupesProposesDeLaPiece` dans `packages/types/src/couleurs-groupes.ts`). Cible : (1) défaut « toutes » + migration **0068** qui repasse les catégories sur « toutes » ; (2) sous « toutes », une ligne par famille de teinte (`memeFamilleDeTeinte`), les ombres suivent (comme `principaleDeLaPiece` le fait pour la principale) ; (3) dans l'éditeur de personnage (`packages/configurator/src/components/CharacterEditor.tsx`, `store.ts`), un bouton « Remettre les couleurs d'origine » par pièce et pour le personnage, visible après un changement, traduit en 5 langues (`messages.ts` + `apps/web/src/i18n/ui.ts`) ; (4) le PDF (`apps/api/src/pdf.ts`, `couleursDeLaPiece`) reste identique au module, et les anciennes commandes ne changent pas ; (5) textes du BO cohérents (`categories-pieces.astro`, `GroupesCouleurs.astro`, `aide.astro`).

c) **Corrections de fin du lot BO** (essais et relecture du chantier Trello BO) : s'il en sort, elles touchent les écrans du BO du lot (categories-pieces, comptes, livraison, promotions, paniers). Le chantier « cartes restantes », lui, est fini et en prod.

**Pour reprendre depuis un autre contexte** : `git fetch`, regarder `origin/wip-bureau-19oct` (diff avec `main`), reprendre a) et b) depuis `main` ou depuis l'instantané selon son état ; vérifier avant toute fusion : `astro check` (BO), `tsc` (API, web, configurator), tests `apps/api/tests/recherche.test.ts` et `apps/admin/tests/recherche.test.mjs`, et le BO connecté. Ne jamais mettre en prod du travail non vérifié : **la migration 0068 n'existe pas encore en prod**.

## 3. À faire par Alexandra (données, sur le BO du serveur)

- Confier son stand au compte vendeur (BO › Comptes) ; créer les lieux de retrait (BO › Livraison › Lieux de retrait) ; saisir l'adresse et le SIRET des factures (BO › Réglages › Factures ; SIRET donné par Margaux : 877 919 852 00047) ; relire la promotion 3+1 (BO › Promotions) et les messages du bandeau.
- Importer `Documents\perso\memoryline-seo-shopify.csv` et `memoryline-seo-shopify-collections.csv` dans BO › Produits › Importer ; coller `memoryline-page-affiches-personnalisables.html` dans une page `affiches-personnalisables` (ces fichiers sont sur le PC du bureau).
- Exporter les redirections de l'admin Shopify avant sa fermeture, puis les saisir dans BO › Redirections.
- Renommer la promotion « Livraison offerte dès 60 € » (caractères abîmés).
- Faire valider par Margaux : les 18 redirections des fiches disparues (`apps/web/src/lib/anciennes-adresses.ts`), les seuils de composition des personnages (`packages/types/src/composition-personnages.ts`), les pièces à renommer (noms anglais de l'import).

## 4. En attente d'une décision

- **Abril Fatface** (carte POLICE) : accord pour télécharger `AbrilFatface-Regular.ttf` (licence OFL, dépôt officiel `github.com/google/fonts`, dossier `ofl/abrilfatface`). Étapes en commentaire dans `packages/types/src/fonts.ts`.
- Les traductions des fiches, des catégories et des cadres : données à saisir au BO (bouton « Proposer les traductions manquantes »).
- Carte Trello « Bordereau La Poste » : en attente côté Alexandra.

## 5. Bon à savoir

- **Mise en ligne** : `MISE-EN-PROD.md`, étape 1 (archive depuis `main` + polices AnotherShabby hors git, puis `mettre-en-ligne.sh` sur le serveur : sauvegarde, construction, migrations, redémarrage). Depuis le PC du **bureau** seulement, Claude peut mettre en ligne sans mot de passe (clé SSH `~/.ssh/memoryline_deploiement`). Depuis l'autre PC : la commande en une ligne de `MISE-EN-PROD.md`, avec le mot de passe.
- Compte d'essai du BO **local** : `essai-module@example.test` ; le remettre sur un PC avec `pnpm --filter @memoryline/api run create-admin <email> <mdp> owner`.
- Le cache de construction Docker du VPS a été nettoyé le 19/10 (20 Go libérés, disque à 36 %) ; quand il se remplit : `docker builder prune -f --keep-storage 3GB` sur le serveur.
- Tests à l'écran sans prendre la main : Chrome headless piloté par script (voir `tests-sans-prendre-l-ecran` dans la mémoire du PC du bureau), jamais de computer-use.
- Règles : `main` fait foi ; ne jamais commiter `.env`, `data/`, `sauvegardes/` ni les polices AnotherShabby ; ne jamais lire `.env` ; rien ne se supprime, on archive ; messages pour Margaux en tutoiement, BO en vouvoiement ; textes du site dans `ui.ts` en 5 langues.
