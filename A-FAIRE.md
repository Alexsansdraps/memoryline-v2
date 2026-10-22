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

- Rien en cours : tout est en prod au 22/10.
- **Audit SEO du 22/10** : bilan dans `AUDIT-SEO.md` (aucun bloquant, 6 points importants ; rien corrigé, à décider avec Alexandra). Contre-vérification finie pour 1 angle sur 5 seulement (PC éteint) : reproduire un constat avant de le corriger. Avant d'importer `memoryline-seo-shopify.csv`, corriger ses doublons (voir AUDIT-SEO.md, point 3).
- La branche `wip-bureau-19oct` (instantanés) et `lot-bo-trello-en-cours` ne servent plus : tout est dans `main`.

## 3. À faire par Alexandra (données, sur le BO du serveur)

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
