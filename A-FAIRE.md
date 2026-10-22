# À faire — état au 22 octobre (écrit pour une reprise dans un autre contexte)

Fichier de reprise : à lire en premier, à supprimer quand tout est fait. `main` fait foi ; la prod (VPS) est toujours une mise en ligne de `main`.

## 1. Ce qui est en prod (VPS, 22/10, commit `b2cb4ea` de `main`)

Migrations **0067 à 0070** passées (0067-0069 à 13 h 40, 0070 vers 16 h 50 ; base sauvegardée avant chaque fois : `sauvegardes/base/2026-10-20.sql.gz` sur le serveur). Vérifié avant : types des quatre parties, 89 tests API + 44 tests BO, règle d'archivage, BO connecté et module en local ; après : site, fiches, plan du site, redirections, BO, API et module sur le VPS.

- **BO › Personnages et BO › Pièces** séparés (Atelier › Personnages / Pièces par personnage / Pièces / Catégories de pièces) : filtres, compteurs, noms de pièces renommables sur place, couleurs ouvertes à la demande. La page Personnages est passée de 35 000 px à 2 400 px.
- **Toutes les couleurs pour les clients du site** : chaque famille de teinte d'une pièce a sa rangée, les ombres suivent ; bouton « Remettre les couleurs d'origine » ; catégories de pièces sur « toutes » par défaut (0068).
- **BO › Pièces lisible** (commit `65d7656`, 20/10 vers 19 h 15) : plus de case « Le client peut la changer » (le client change toujours toutes les couleurs ; les anciennes `zones_masquees` restent en base mais ne sont plus lues : en prod, 330, 339 et 421 deviennent recolorables) ; une ligne par **partie** (« Partie 1 » = la principale, ou le nom donné), ses ombres en retrait dessous, avec une case **« C'est une ombre »** enregistrée aussitôt (plus de « Séparer » ni de « Teintes réunies ») ; le message dit aussi les autres couleurs qui ont bougé, et un envoi qui échoue remet l'écran en état avec un message rouge en bas à droite ; bandeau quand 2 parties ou plus n'ont pas de nom. **« Couleurs proposées au client »** pour chaque partie de **toutes** les pièces, **10 au plus** à l'ajout (les listes plus anciennes se lisent sans rien perdre ; aucune en prod n'en a plus de 10) ; sans liste, les couleurs de la catégorie ; jamais de saisie libre sur un accessoire. Le menu « Le client peut recolorer » de Catégories de pièces est retiré (rien supprimé en base). Nouvelle pièce : surfaces mesurées comme à l'enregistrement (route `GET /admin/assets/parts`, lecture seule). Vérifié : types, 188 tests API + 45 BO, 3 relectures indépendantes (code et données avec les réglages de prod, écran de Margaux en clair et sombre, site et impression : 0 différence sur les anciennes commandes) ; en prod, 0 commande en attente touchée.
- **BO › Boutique en ligne › Redirections** : ajout, import du fichier Redirects.csv de Shopify avec aperçu, archivage, restauration ; le site applique une saisie en 2 secondes.
- **Lot BO du Trello** : offre 3+1 passée au nouveau réglage en base (0069 : toutes tailles, A4 offerte sans cadre), nom de la promo « dès 60 € » réparé, factures relues tant que l'émetteur est incomplet, ordre d'affichage sans pages fantômes, prix A3/A4 dans la modification groupée, nom de l'offre à la caisse.
- **Police Abril Fatface** (carte POLICE) : proposée en ligne 1 (« Affirmée », toujours en majuscules) et en ligne 3, en plus de « Classique » ; police officielle Google Fonts, licence OFL jointe dans `apps/api/fonts/` ; écran et PDF identiques. Les pastilles de police passent à la ligne au lieu de défiler.
- **BO › Réglages › Paiements** (commit `1b45d1a`) : clés Stripe et PayPal saisies au BO (écriture seule, chiffrées, migration **0070**), bouton « Vérifier », interrupteur « en essai / pour de vrai » (le réel est refusé tant que les clés live ne sont pas vérifiées, plus une case de confirmation), interrupteur des vraies étiquettes SendCloud, journal ; le `.env` reste le repli. À chaque bascule : un message juste sous l'interrupteur, un **courriel à la boutique** (MAIL_BOUTIQUE, sinon CONTACT_TO, MAIL_BCC, MAIL_FROM), et un **badge permanent** en haut de chaque page du BO (« 🧪 Mode essai » ou « ✅ Paiements réels », cliquable). Commandes payées en essai marquées « Payée en ESSAI » et écartées des finances. Aide « Passer la boutique en vrai », `MISE-EN-PROD.md` § « Jour J, dans l'ordre ». Essayé en local avec des valeurs factices seulement. Reste à Alexandra : « Vérifier » sur les clés de test du `.env`, et le bouton « Copier » de l'adresse du webhook dans un vrai Chrome.
- Menu d'apparence du BO : « Clair », « Sombre », « Système ».
- BO › Produits (22/10, `b2cb4ea`) : la photo d'un produit s'affiche en grand (240 px) au survol de sa vignette et se referme quand la souris s'en va, comme les affiches de la liste des commandes (composant partagé `ApercuFlottant.astro`).
- « Suit la couleur de… » retiré des réglages avancés ; une suppression technique autorisée par écrit (noms des fichiers d'impression d'une vente rouverte au stand).
- Avant (19/10) : cartes BO du Trello, réponses de Margaux, stand sur tablette, écran photo IA, indice pour descendre, langues ; (7/10) recherche du BO, SEO, module.

**Changements de comportement à connaître**
- Un compte **vendeur** ne voit aucune vente tant qu'on ne lui a pas confié son stand (BO › Comptes).
- Le **retrait sur place** n'apparaît à la caisse que si un lieu existe (BO › Livraison › Lieux de retrait).
- Les clients du site peuvent maintenant changer **toutes** les couleurs des vêtements, pantalons et coupes (pas seulement la principale).

## 2. En cours

- **Audit SEO du 22/10** : bilan dans `AUDIT-SEO.md`, aucun bloquant. Le 22 au soir (PC de la maison), les points de code sont corrigés, mais **pas encore en ligne** : vitesse des rayons, ordre du jour J dans `MISE-EN-PROD.md`, script de relevé des anciennes adresses, titres de plus de 60 caractères, robots.txt, image de partage, formats des prix, données structurées de l'accueil. Le détail et ce qui reste à décider sont dans la section « Suivi » en haut de `AUDIT-SEO.md`. Avant d'importer `memoryline-seo-shopify.csv`, corriger ses doublons (MISE-EN-PROD § 6).
- **Relance de panier abandonné** (carte Trello, commentaire de Margaux du 22/10 : « il faut aussi la simulation des affiches dans le mail »). Le courriel partait avec le visuel de la fiche ; il montre maintenant l'aperçu réel de chaque affiche (son texte, ses personnages), fabriqué avant l'envoi par le moteur des fichiers d'impression, en 110 px au lieu de 64. Si l'aperçu ne peut pas se faire, c'est le visuel de la fiche qui s'affiche. Vérifié de bout en bout sur la boîte d'essai locale. **Pas encore en ligne.**
- **Cartes Trello du 22/10 (site)**, faites en local, **pas encore en ligne** :
  - Boutons noirs : l'effet au clic manquait sur le bouton photo de l'écran IA (un `label`) ; le reste était déjà en ligne.
  - Rond « TUTO ▶ » (dessin de Margaux) à la place de la bulle « Vidéo tuto », en 5 langues. Sur la pré-prod, rien ne s'affiche parce qu'**aucune vidéo n'est réglée** (§ 3).
  - Signature : 7 % par défaut au lieu de 12 % (fichiers d'impression + aide du BO). La pré-prod a **12 enregistré en base** : le remettre à 7 au BO (§ 3).
  - Étape 2 : sections dans l'ordre peau › cheveux › accessoires › t-shirt › pantalon (l'ordre de superposition à l'image ne change pas).
  - Fiche produit : l'image ne prend plus toute la hauteur sur grand écran (largeur bornée par la hauteur de l'écran ; vérifié en 1440, 1024, 768 et mobile).
  - « Je ne peux pas passer de commande test sur le site » : un navigateur ouvert une fois comme tablette de stand restait 24 h en mode stand, et la page Commande renvoyait au panier sans rien dire. Elle explique maintenant et propose « Quitter le mode stand et commander » (`?stand=0`) ; aide du BO complétée.
  - « On ne peut pas télécharger le PDF » : corrigé depuis `840e2c0` (5/10), jamais revérifié sur la pré-prod. Les 15 affiches « prêtes à imprimer » n'ont qu'une image de 1 020 × 1 400 px : leur PDF est **toujours refusé** tant que Margaux n'a pas déposé un visuel HD (≥ 1 240 × 1 754 en A4, 1 754 × 2 480 en A3).
  - Personnage déshabillé après défilement : ce sont des données, trois « Femme test » (ids 71, 72, 73, corps nu) en tête des Femmes de dos (§ 3).
  - **« BUG ? » POST /orders → 500** (mobile, point Mondial Relay « LOCKER ECO LAVERIE », Lyon 3e, 66 €) : **cause pas trouvée**. Exception non rattrapée côté API (réponse sans détail) ; le contrôle du point SendCloud n'y est pour rien (il ne lève jamais). Pas reproductible en local (pas de Mondial Relay dans la base de dev). Il faut le journal de l'API du VPS :
    `ssh debian@51.255.34.187 "cd ~/memoryline && docker compose -f docker-compose.prod.yml logs --no-color --since 2026-10-22T13:00:00 api 2>&1 | grep -n -B2 -A20 -E 'Error|error|500' | tail -150"`
  - Noté sans corriger : la caisse Stripe (`automatic_payment_methods`) ne traite pas le retour des moyens de paiement à redirection ; à voir si un tel moyen est activé chez Stripe.
- Base de dev (locale) : migrations 0067 à 0070 passées le 22/10 au soir. Sans elles, l'API locale répondait 500 (colonne `ordre_catalogue` absente).
- La branche `wip-bureau-19oct` (instantanés) et `lot-bo-trello-en-cours` ne servent plus : tout est dans `main`.

## 3. À faire par Alexandra (données, sur le BO du serveur)

- **Après la mise en ligne des cartes du 22/10** : archiver les trois « Femme test » (Atelier › Personnages, ids 71, 72, 73 › Archiver) ; mettre la largeur de la signature à **7** (Contenu du site › Signature des créations) ; régler la vidéo (Contenu du site › Personnalisation — vidéo explicative), sans quoi le rond « TUTO » ne s'affiche pas ; retester le téléchargement d'un PDF de commande ; commandes test dans une **fenêtre privée** (ou `?stand=0`).
- Demander à Margaux les visuels HD des 15 affiches « prêtes à imprimer », et lui reposer la question des fonds WebP des commandes.

- Confier son stand au compte vendeur (BO › Comptes) ; créer les lieux de retrait (BO › Livraison › Lieux de retrait) ; saisir l'adresse et le SIRET des factures (BO › Réglages › Factures ; SIRET donné par Margaux : 877 919 852 00047) ; relire la promotion 3+1 (BO › Promotions) et les messages du bandeau.
- Importer `Documents\perso\memoryline-seo-shopify.csv` et `memoryline-seo-shopify-collections.csv` dans BO › Produits › Importer ; coller `memoryline-page-affiches-personnalisables.html` dans une page `affiches-personnalisables` (ces fichiers sont sur le PC du bureau).
- Exporter les redirections de l'admin Shopify avant sa fermeture (Contenu › Menus › Redirections d'URL › Exporter), puis importer le fichier dans BO › Boutique en ligne › Redirections (aperçu, puis « Appliquer »).
- Faire valider par Margaux : les 18 redirections des fiches disparues (`apps/web/src/lib/anciennes-adresses.ts`), les seuils de composition des personnages (`packages/types/src/composition-personnages.ts`), les pièces à renommer (noms anglais de l'import, « Clothes 1 »… : se renomment sur place dans BO › Pièces, Entrée pour enregistrer) ; les couleurs proposées partie par partie (BO › Pièces › une pièce › Couleurs › « Couleurs proposées au client », 10 au plus) et le nom de chaque partie (bandeau ambre tant que 2 parties ou plus n'en ont pas). Pièce 421 en prod : ses manches vertes sont réunies au corps par un ancien réglage (note orange au BO) ; décocher « C'est une ombre » sur les manches pour leur rendre leur rangée.

## 4. En attente d'une décision

- Les traductions des fiches, des catégories et des cadres : données à saisir au BO (bouton « Proposer les traductions manquantes »).
- Carte Trello « Bordereau La Poste » : en attente côté Alexandra.

## 5. Bon à savoir

- **Mise en ligne** : `MISE-EN-PROD.md`, étape 1 (archive depuis `main` + polices AnotherShabby hors git, puis `mettre-en-ligne.sh` sur le serveur : sauvegarde, construction, migrations, redémarrage). Depuis le PC du **bureau** seulement, Claude peut mettre en ligne sans mot de passe (clé SSH `~/.ssh/memoryline_deploiement`). Depuis l'autre PC : la commande en une ligne de `MISE-EN-PROD.md`, avec le mot de passe.
- Compte d'essai du BO **local** : `essai-module@example.test` ; le remettre sur un PC avec `pnpm --filter @memoryline/api run create-admin <email> <mdp> owner`.
- Le cache de construction Docker du VPS a été nettoyé le 19/10 (20 Go libérés, disque à 36 %) ; quand il se remplit : `docker builder prune -f --keep-storage 3GB` sur le serveur.
- Tests à l'écran sans prendre la main : Chrome headless piloté par script (voir `tests-sans-prendre-l-ecran` dans la mémoire du PC du bureau), jamais de computer-use.
- Règles : `main` fait foi ; ne jamais commiter `.env`, `data/`, `sauvegardes/` ni les polices AnotherShabby ; ne jamais lire `.env` ; rien ne se supprime, on archive ; messages pour Margaux en tutoiement, BO en vouvoiement ; textes du site dans `ui.ts` en 5 langues.
