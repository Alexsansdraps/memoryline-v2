# À faire — Memory Line (remis au propre le 27/11 au soir)

Fichier de reprise, à lire en premier. **`main` fait foi** : la prod est toujours une mise en ligne de `main`. L'historique des mises en ligne et le détail de chaque travail sont dans `git log` et dans les commentaires du code (l'ancienne version longue de ce fichier : `git show 108d185:A-FAIRE.md`). Ce que Margaux doit faire de son côté, elle le sait : ce n'est pas suivi ici.

## 0. État

- **Tout `main` est EN LIGNE** (dernière mise en ligne de code : `3c9f0be`, 27/11 vers 22 h 25).
- Marché de Noël de Mulhouse : du 20/11 au 27/12, 11 h – 20 h (le calendrier du stand ferme à 21 h ; le stand se ferme seul 1 h après la fin du dernier créneau).
- Réglés par Alexandra le 27/11 à 22 h 30, à ne plus proposer : le message rouge « crédit » ; les lectures de contrôle des ventes du stand du 26/11.

## 0.1 Ce qui RESTE

Faits le 27/11 au soir et EN LIGNE (`e4bb63c`) : couleur des ombres par thème (BO › Ciel étoilé, « Couleur propre ») ; ménage des anciennes silhouettes (rendu identique à l'octet près) ; l'aperçu remesure une ligne quand sa taille change, et un essai automatique garde l'empreinte d'une ligne sans taille. Essayé en local : couple en paysage avec 8 scènes jusqu'au fichier d'impression (3508 × 2480) : les 8 tiennent dans la largeur.

1. **Personnages unifiés des affiches classiques** (voir 0.4) : planche du 27/11 au soir refaite (`travaux/personnages-unifies/gabarits-final/planche-gabarits.jpg`, copie dans `Documents/memory-line/planche-personnages-27-11-soir.jpg`) : âgés au dos rond et aux épaules tombantes, ado aux épaules souples, cheval DEBOUT de dos (lui donner un facteur de taille d'environ 2 à la création), chat dont la queue s'enroule au sol. **Attend l'avis d'Alexandra sur la planche**, puis : garde-robe (hauts, bas, coiffures, accessoires) dessinée SUR les gabarits, NAC, puis les lots du plan (`travaux/personnages-unifies/plan.md`). Relancer la planche : `bash travaux/personnages-unifies/gabarits-final/run.sh` (conteneur `memoryline-api` local).

## 0.1 ter Nuit du 27 au 28/11 : TOUT EST EN LIGNE (dernière mise en ligne 05 h 24, `49694b1`)

- **Affiche éphémère du stand de Mulhouse** (`49694b1`, migrations 0121 + 0122 passées en prod) : produit `mulhouse-marche-de-noel-affiche-personnalisee` (id 265 en prod) rattaché au stand 1 (`product.stand_id`, `apps/api/src/affiches-de-stand.ts`, `enVente()`) : il disparaît seul (fiche 404, collection, recherche, page du stand, plan du site) quand le stand est désactivé, archivé ou clôturé ; collection éphémère « Marché de Noël de Mulhouse » ; 47 motifs (personnages du type d'affiche `motifs-alsace`) en 7 onglets, nom du motif en ligne 1 ; 10 couleurs de motif réglables au BO (BO › Personnages › Couleurs des motifs, réglage `motifs.couleurs`) ; 19 fonds (unis, dégradés, motifs) ; texte en haut ou en bas ; personnages de dos sur le muret ; fenêtre plein écran en 4 étapes ; image de la fiche = le sapin sur fond rouge étoilé d'Alexandra. Bilans : `travaux/affiche-stand-mulhouse/PLAN.md`, `BILAN-REGLAGES.md`.
  - Les fichiers des motifs, fonds et images (`travaux/affiche-stand-mulhouse/assets-prod/`, 71 fichiers) ont été copiés dans `~/memoryline/data/assets` AVANT la mise en ligne : `data/` ne voyage pas dans l'archive. Ils sont servis sous `/api/assets/…`.
  - Reste à décider avec Alexandra : (1) brancher le contrôle serveur de la couleur du motif dans POST/PUT `/cart/:cartId/items` (`couleurDuMotifRefusee`, motifs-couleurs.ts, prêt et testé, PAS branché : « touche pas aux commandes ») ; (2) le résumé du panier compte le motif comme « 1 personnage » (code du panier, non touché) ; (3) la fenêtre s'ouvre sur l'hôtel de ville sur rouge uni, la photo montre le sapin étoilé ; (4) le texte blanc par défaut se lit mal sur les fonds clairs ; (5) la ligne 2 par défaut reste en français dans toutes les langues ; (6) plein écran et « 2. Texte » seulement pour cette affiche : à étendre aux autres si elle le veut.
  - Pendant le marché, masquer un motif (Activé/Désactivé) plutôt que l'archiver (une ligne déjà au panier le reprendrait pour un personnage).
- **Ombres de familles** (`15571ac`, 3 h 47) : 21 scènes nouvelles (une par composition), onglets Maman et enfants / Papa et enfants / Parents et enfants ; tri et contrôles dans `travaux/ombres/` (TRI.md). À décider : « Papa, trois enfants et un chat » (la tête du chat se fond dans le bras du papa : retirer ou retoucher) ; renommer l'ancienne « Papa et bébé » en « Papa et sa petite fille ».
- **Aussi en ligne cette nuit** : écart texte/cercle du ciel égal en haut et en bas ; scènes d'ombres à 6 cm ; plus d'onglet « Animaux » ; « Voir sur un mur » : plus de « Mon mur », plante de l'entrée décalée, titre de la fenêtre « Voir sur un mur », titres longs réduits, personnages à leur place.
- **STAND-BY jusqu'en début de semaine prochaine** (Alexandra, 28/11 vers 1 h 55 : « on mettra pas en prod les nouveaux personnages des affiches classiques pour l'instant, ça sera début de semaine pro ») : garde-robe des personnages classiques (`travaux/personnages-unifies/garde-robe/`, non commité : peau, coiffures 62, bas 26 faits ; hauts et accessoires à reprendre).

## 0.1 quater Pixel Meta — EN LIGNE le 28/11 à 13 h 15 (`dd2c0ef`, demande de Margaux, « et met prod » d'Alexandra)

- `apps/web/src/layouts/Base.astro` (code de base, prod + memoryline.fr seulement, jamais à la tablette du stand, seulement après « Accepter » du bandeau cookies, pas de <noscript>, autoConfig coupé, script de Meta retenu tant que l'adresse porte un jeton ou un secret de paiement) ; `apps/web/src/lib/meta-pixel.ts` (AddToCart via `ajouterAuPanier`, InitiateCheckout à l'ouverture de la caisse, Purchase sur « Merci » avec `totalCents`, une fois par commande, retour de banque compris). Essais : `travaux/pixel-meta/` (29 tests, 59 vérifications au navigateur sans rien envoyer à Meta, et `verif-prod-sans-accord.mjs` : en prod, rien sans accord).
- **À dire à Margaux** : dans Events Manager, DÉSACTIVER la « Correspondance avancée automatique » (sinon Meta hache et envoie e-mail, nom et téléphone saisis à la caisse) ; ne PAS ajouter aussi le pixel dans GTM (double comptage).
- Limites : un paiement confirmé plus tard (webhook) ou un onglet fermé avant « Merci » ne donne pas de Purchase (il faudrait l'API Conversions, eventID `achat-<numéro>` déjà prêt) ; une commande réglée par carte cadeau compte son total entier.
- Déjà là avant, à décider : aucun lien « Gérer les cookies » pour revenir sur son choix (exigence CNIL, vaut aussi pour Google) ; GA4 reçoit les adresses à jeton dans page_location (à masquer dans les réglages de GA4).

## 0.2 Règles

- **Mise en ligne** : hors ouverture du marché (avant 11 h, après 20 h), Claude met en ligne directement en mode « hotfix ». Pendant l'ouverture : seulement sur un « met en prod » d'Alexandra pour CE changement, après avoir vérifié qu'il n'y a aucune activité (`docker compose -f docker-compose.prod.yml logs --since 15m api | grep -ciE 'cart|checkout|commande'`). Recette : § 5.
- **« Touche pas aux commandes »** (21/11) : ni données, ni logique (stand, caisse, factures, paiement, panier) sans demande explicite. On note, on ne corrige pas.
- **Empreinte d'impression** : toucher `packages/types/src/*`, `pdf.ts`, `fichiers-impression.ts` ou `couleurs-image-fichier.ts` régénère tous les fichiers d'impression. À éviter.
- Aucun essai de commande ni aucun ciel créé en prod : c'est de l'argent réel, c'est Alexandra qui essaie.
- Pas de « Co-Authored-By » ni de « Generated with Claude Code » dans les commits.
- Pas de look « gabarit IA » (surtitres à filet, capitales espacées…).

## 0.3 Environnement local

- La pile Docker locale tourne sur une **copie de la prod** : service `db18` (postgres:18, conteneur `memoryline-db18`, port 5436) dans `docker-compose.override.yml` (exclu de git), base restaurée depuis un dump de prod puis neutralisée (clés de paiement effacées, relances coupées, e-mails en `@exemple.invalid`), images de prod copiées dans `data/assets`. Pour la recharger : `Documents/memory-line/copie-prod/LISEZMOI.txt`.
- Site `http://localhost:8080`, BO `http://localhost:4322/bo`.
- L'ancien conteneur `memoryline-db` (9 migrations, juillet) et la base Neon hébergée ne servent plus.
- Recette des tests sur une base JETABLE (Git Bash, racine du dépôt), à adapter si besoin au conteneur `memoryline-db18` :
  ```
  URL=$(grep -oE 'postgres://memoryline:[^@"]+@db:5432/memoryline' docker-compose.yml)_essais
  docker exec memoryline-db createdb -U memoryline memoryline_essais
  docker exec -e DATABASE_URL="$URL" memoryline-api sh -c 'case "$DATABASE_URL" in *@db:5432/memoryline_essais) echo LOCALE;; *) echo AUTRE;; esac'
  MSYS_NO_PATHCONV=1 docker exec -e DATABASE_URL="$URL" -w /app/apps/api memoryline-api sh -c 'npx tsx src/db/migrate.ts'
  MSYS_NO_PATHCONV=1 docker exec -e DATABASE_URL="$URL" -w /app/apps/api memoryline-api sh -c 'npx tsx --test tests/fonds-ia-base.test.ts tests/factures-zip.test.ts tests/cartes-cadeaux-caisse.test.ts tests/ia-composition.test.ts'
  docker exec memoryline-db dropdb -U memoryline memoryline_essais
  ```
  - La troisième commande doit répondre LOCALE avant d'aller plus loin. La garde des tests (`@db:5432/` et NODE_ENV) ne les laisse jamais tourner ailleurs.
- Ciel étoilé : les ombres sont vectorisées depuis les planches de `Documents/memory-line/protos/ombres*.png` (masque < 110, marching squares, RDP 0,8 px, Catmull-Rom, 90 cm par adulte assis) ; `apps/api/src/ciel-ombres-2.ts` est GÉNÉRÉ (scripts hors dépôt) ; l'URL `/ia/ciel/silhouettes?v=…` doit changer de version quand les ombres changent (cache du navigateur).

## 0.4 Personnages unifiés des affiches classiques (en dernier)
Travail en cours copié dans `travaux/personnages-unifies/` (gabarits SVG, gabarits.json, relevé, plan, planches). Décisions d'Alexandra : tous ASSIS et DE DOS (plus jamais debout), même style que les actuels, très variés (plusieurs femmes, hommes, enfants, des PERSONNES ÂGÉES, et animaux : chiens, chats, chevaux, et TOUS les NAC — lapin, cochon d'Inde, hamster, oiseau, tortue, furet…), accessoires très variés, AUCUN calage sur les nouveaux. Ajouter sans supprimer ; quand un nouveau remplace un ancien équivalent, ARCHIVER l'ancien (jamais de suppression), et retirer l'écran de calage du BO (garder les données). Bascule préparée en local, en prod seulement sur son OK.
À reprendre sur la planche du 27/11 :
- corps âgés pas assez différents (dos plus voûté, épaules tombantes) ; épaules de l'ado trop raides ;
- le CHEVAL fait peur (« il fait peur là ») : à redessiner, DEBOUT (pas assis) et DE DOS (« le cheval il faut le faire debout pas assis et de dos ») — seule exception à la règle « tous assis » ;
- la queue du chat (dos) pend sous la ligne d'assise : tous les personnages doivent être posés sur la même ligne, rien ne dépasse dessous (« je parle des personnages pas alignés », « regarde la queue ») — la queue s'enroule sur le côté, au niveau de l'assise ;
- puis la garde-robe (hauts, bas, coiffures, accessoires) et les NAC.

## 0.5 Idées de Noël en réserve (seulement si Alexandra les demande)
- **Le calendrier 2027 de la famille** : une affiche avec le titre en haut, les 12 mois, les personnages en bas, les anniversaires marqués d'un cœur ; même mécanique que le ciel (fond calculé, thèmes, aucun appel à OpenAI). Environ une journée.
- **« Nous au marché de Noël »** : une affiche personnalisable classique, les personnages en bonnet devant un marché de Noël alsacien. Rien à coder : Margaux dessine les fonds et un bonnet, et crée le produit au BO.
- **Un prénom sous chaque personnage** (« Les petits-enfants de Mamie Jo ») : touche au moteur d'impression, donc après le marché.

## 0.6 Décidé, et encore à décider
- **Décidé le 21/11** (Alexandra : « touche pas aux commandes ») : **on ne touche à aucune commande**, ni à leurs données, ni à leur logique, ni à la caisse.
  - **SAL-0006** : validée à 11 h 32 (29 €), rouverte à 11 h 37, jamais revalidée, puis revalidée à 20 h 03 pour un autre client (35 €). La vente du matin reste hors des comptes, et une vente rouverte NE se referme PAS d'elle-même.
  - Écartées pour la même raison : garder une trace de chaque suppression de vente ; n'autoriser la suppression d'une vente payée que si elle est annulée ou en test.
- **Encore à décider** (interface, pas les commandes) :
  - pas de bandeau cookies sur la tablette ;
  - en-tête compact sous 1280 px.

## 0.7 À faire avec Margaux
- **Premier vrai essai de « Créer des fonds » avec Margaux** (le faux dessinateur est ignoré en production) :
  - vérifier que le modèle accepte plusieurs images et le format 1024 × 1536 ;
  - juger le rendu avec son style « bâtiment / paysage » ;
  - recaler le coût par image (estimé à 0,25 €, `ia.fondCoutParVersionCents`).
- **Nettoyer les personnages de test en prod, avant un lot de démo** (BO) :
  - la coiffure « TEST » de « Femme 2 » ;
  - le second fauteuil de « Femme fauteuil roulant » ;
  - archiver « Femme test », « emond » et « ddd » ;
  - rattacher leur décor aux 6 affiches grisées ;
  - imprimer une A4 d'essai en « Taille réelle ».

## 0.8 Restés ouverts
- **Chiffres dans le PDF** : « ça met erreur, uniquement au téléchargement du PDF, pas avec toutes les polices ».
  - Pas reproduit en local : 100 rendus (10 polices × 5 formes de lignes), en aperçu et en PDF.
  - Les journaux de l'API de prod se perdent à chaque mise en ligne. Il faut refaire le téléchargement qui échoue, PUIS lire les journaux (accord d'Alexandra donné) avec le numéro de la commande.
- **Ventes du stand disparues** : SAL-0001, 0002, 0003, 0004 et 0007 ont été SUPPRIMÉES définitivement entre 10 h 50 et 15 h 16, sans trace de qui.
  - SAL-0001 était la vente d'essai, supprimée à la demande d'Alexandra.
  - Pour les autres, à voir avec Margaux. Si c'étaient de vraies ventes : SAL-0002 et 0003 se restaurent (sauvegarde « avant-restauration » de 10 h) ; SAL-0004 et 0007 sont perdues.

## 2. Dans le code (Claude)

- **Affiches de démonstration (BO › Atelier, 20/11) : pas encore de « Reprendre les affiches de la page d'un stand »** (décision d'Alexandra pour la première version). À ajouter si Margaux le demande : `api.stands()` donne la page de chaque stand, `api.page(id)` son bloc `produits` de source `affiches`, dont les `references` sont les identifiants des affiches à préremplir dans le formulaire (`ex-<id>`).
- **Page /mulhouse de la tablette** (fin du 18/11) : elle montre une collection entière de 80 affiches, pas seulement l'Alsace (Neuschwanstein y est). Elle avait déjà sa grille, donc la 0101 n'y a pas mis les 64 affiches d'Alsace. À décider par Alexandra : soit Margaux remplace la grille dans BO › Pages › mulhouse, soit une migration le fait (la liste de 64 est dans 0101_page_mulhouse.sql).
- **Bouton « tout traduire » des pages du site** : l'éditeur de page propose encore la traduction langue par langue ; il manque un bouton « dans toutes les langues », comme sur la fiche produit (6 langues) et sur les écrans de traduction communs.
- **Japonais et chinois, encore à faire** :
  - les 4 pages légales : l'anglais s'affiche à leur place ;
  - la recherche dans ces langues ;
  - les noms des pièces du module (texte des vignettes en attendant l'image), qui n'ont pas de traduction au BO ;
  - un texte japonais ou chinois tapé sur l'affiche : les polices d'impression n'ont pas ces caractères.
- **Chargements** : il reste une passe « 4G lente » sur tout le site. L'écran d'accueil peut coûter quelques points de performance à PageSpeed (indice de vitesse), sans toucher au SEO.
- **PageSpeed** : à relancer après le changement d'image de l'accueil. Alexandra remplace elle-même cette image : ne pas y toucher. Au 17/11 : SEO, accessibilité et bonnes pratiques à 100 ; performance à 78, avec du CSS bloquant et 4 animations non composées.
- **Import Shopify** : dès qu'Alexandra dépose les deux CSV (procédure plus bas).
- **« Continuer avec Google » (après le marché)** : Margaux crée l'identifiant client Google (marche à suivre : https://claude.ai/artifact/Nvgds4ofJy18vtSGZhVLZ8). Les adresses lui sont déjà données, il faut les respecter :
  - origine `https://memoryline.fr` ;
  - URI de redirection `https://memoryline.fr/api/compte/google/retour`.
  L'ID client arrive par message ; le code secret, Alexandra le pose elle-même sur le serveur.
  - Le code est prêt mais rangé (voir plus haut, `git revert 4748977`) : routes OAuth avec PKCE, bouton sur la connexion et l'inscription, tests.
  - Pour l'allumer, une fois le code remis : poser `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` dans `~/memoryline/.env`, puis `docker compose -f docker-compose.prod.yml up -d --force-recreate api`.
  - Margaux ajoute la phrase sur Google à la page Confidentialité (elle est dans son document).
- **Petits défauts de la recette du 16-17/11**, non corrigés :
  - sur 360 px avec un cadre choisi, la barre du bas déborde (les cadres sont éteints sur le site) ;
  - la bulle « Plus bas » couvre deux vignettes de personnages sur petit téléphone, jusqu'au premier défilement ;
  - la poignée ⠿ fait 19 px ;
  - le champ d'une ligne longue ne s'agrandit pas ;
  - le chinois, le japonais et le coréen ne s'impriment pas ;
  - les emojis plus récents que Twemoji 15.0 disparaissent du papier sans avertissement ;
  - ♥ ☀ ❄ sont en noir à l'écran, en couleur sur le papier ;
  - la facture PDF retire les emojis ;
  - la vignette d'aperçu reste sur le disque après qu'on retire l'article.
- Les essais en attente (BO connecté, Stripe, tablette, iPad) ont tous été faits par Alexandra le 18/11 : tout marche.

## 3. Pour Alexandra

- **Créer des fonds (BO › Atelier, 20/11), premier vrai essai avec Margaux** : en ligne depuis le 20/11 à 22 h 35 (migration `0111_fonds_ia`). Testé en local seulement avec le faux dessinateur (réglage `ia.fondBouchon` = 1, ignoré en production) : aucun vrai appel à OpenAI n'a encore été fait. Au premier essai : vérifier que la clé OpenAI de la prod accepte plusieurs images en entrée (photo + 2 décors d'exemple, ou version + photo en discussion) et la taille 1024 × 1536, juger le rendu avec le style « bâtiment / paysage » et, au besoin, retoucher la consigne propre aux fonds (écran, « Réglages des fonds »), puis caler le coût estimé par image (0,25 € par défaut) sur la facture OpenAI.
- **Affiches de démonstration (20/11), avant de tirer le lot du marché** : l'outil est en ligne depuis le 20/11 (migration `0110_affiches_demo`, vérifié le 21/11). Dans le BO de la prod (constats faits sur les données locales, la prod peut différer) :
  - **Personnages** : la coiffure position 503 « TEST », calée pour Femme 6 seulement, est aussi liée à Femme 2 (dos), sans calage : la retirer de Femme 2 ou lui donner un calage « hair:503 », puis renommer la pièce. « Femme fauteuil roulant » a l'accessoire 17 « Wheel Chair 1 », un second fauteuil par-dessus le sien : le lui retirer. Archiver les personnages d'essai : les trois « Femme test », « emond » et « ddd » (deux captures d'écran PNG que l'impression ne sait pas dessiner). Le tirage les écarte déjà (nom contenant « test » ou « essai », dessin qui n'est pas un SVG, tenue du BO gardée pour un « Fauteuil roulant »), mais le site les propose encore aux clients.
  - **Décors** : une affiche sans décor rattaché, dont plusieurs décors de sa ville sont à égalité en tête de liste, reste grisée dans l'outil. En local : COMPIÈGNE Beaux-monts, Beaux-monts sunset et Hotel de ville, CÔTE D'OPALE Plage #2, MONTAGNE Neige, PARIS Tour Eiffel sunset #1. Rattacher son décor sur sa fiche : aujourd'hui, le site leur présélectionne le décor d'une autre affiche de la ville.
  - **Impression** : une A4 d'essai sur l'imprimante de Margaux, en « Taille réelle », puis regarder les vignettes du lot avant d'imprimer le reste (« Refaire au hasard » pour une affiche ratée).
- **Webhook Stripe live** : passer son URL à `https://memoryline.fr/api/payments/stripe/webhook` (Stripe ne suit pas les redirections), puis BO › Réglages › Paiements › « Vérifier ».
- **Search Console** : propriété « Domaine » memoryline.fr (un TXT de plus dans la zone OVH, sans toucher au SPF) et plan du site. Ensuite, rejouer `node apps/web/scripts/verifier-anciennes-adresses.mjs https://memoryline.fr` et suivre les 404 (chaque ancienne adresse en 404 va dans BO › Redirections).
- **Redirections Shopify** : admin Shopify › Contenu › Menus › Redirections d'URL › Exporter, puis BO › Boutique en ligne › Redirections › Importer.
- **Stripe › Payment method domains** : ajouter memoryline.fr.
- **À J+7 (24/11)** : ne pas détacher le domaine de Shopify avant. Ensuite, mettre le mot de passe sur la boutique Shopify ; sur le serveur, effacer `.env.avant-domaine` et les images `secours-{api,web,admin}:avant-domaine`.
- **Sur le serveur** :
  - `rm ~/.env` : un fichier parasite dans `/home/debian`, avec une ligne MAIL_FROM. Ce n'est pas celui de `~/memoryline` ;
  - les vieilles copies du `.env`, avec d'anciens secrets : `.env.avant-20260929-135415`, `.env.avant-20260929-142119`, `.env.avant-bascule`, `.env.avant-jeu-essai`, `.env.avant-prod` (Claude ne touche pas aux `.env`) ;
  - copier les sauvegardes hors du serveur au moins une fois par semaine (la dernière ligne de `sauvegarder.sh` donne la commande). `restaurer.sh` n'existe pas. Ne jamais restaurer une sauvegarde d'avant le vidage du 17/11 à 08 h 38.

## 4. Import de l'historique Shopify

L'import est prêt et sûr sur la base en service (`apps/api/scripts/import-historique.ts`).
- Il lit l'export natif, ou Matrixify.
- Il ne supprime rien. Il fusionne les clientes par e-mail en complétant les fiches, sans rien écraser. Il n'abonne jamais une adresse désabonnée.
- Les numéros sont `SHOP-1001…`. Les commandes reprises restent hors des listes de travail ; l'API leur refuse facture, courriels, étiquette, encaissement et remboursement.
- Une cliente reprise choisit son mot de passe par « mot de passe oublié ».

**Procédure :**
1. Les CSV (Clients › Exporter › Tous les clients ; Commandes › Exporter › Toutes les commandes) vont dans `data/exports/shopify/`.
2. `scp -r data/exports/shopify debian@…:~/import-shopify`.
3. Sur le serveur : `docker compose -f docker-compose.prod.yml cp ~/import-shopify api:/tmp/import-shopify`.
4. Aperçu : `docker compose -f docker-compose.prod.yml exec -w /app/apps/api -e IMPORT_DIR=/tmp/import-shopify api npx tsx scripts/import-historique.ts`.
5. `bash apps/api/scripts/sauvegarder.sh`.
6. La même commande que l'aperçu, avec `--pour-de-bon`.
7. Effacer `~/import-shopify` et `/tmp/import-shopify` (données personnelles).

**À trancher en lisant l'aperçu** :
- les commandes pending ou authorized de Shopify sont reprises hors ventes ;
- les payées non expédiées sont marquées traitées (à envoyer depuis Shopify) ;
- le taux de transformation sera gonflé sur les périodes Shopify.

## 5. Bon à savoir

**Mettre en ligne** (Git Bash, à la racine du dépôt ; seul ce qui est commité part) :
```
rm -f ../memoryline-deploiement.tar ../memoryline-deploiement.tar.gz
git -c core.autocrlf=false archive --format=tar -o ../memoryline-deploiement.tar HEAD -- . ':(exclude)data/memoryline-archive'
tar --force-local -rf ../memoryline-deploiement.tar apps/api/fonts/AnotherShabby-Regular.ttf apps/web/public/fonts/AnotherShabby-Regular.ttf
gzip -9 ../memoryline-deploiement.tar
ssh -n -i ~/.ssh/memoryline_deploiement debian@51.255.34.187 "uptime; free -m"
scp -i ~/.ssh/memoryline_deploiement ../memoryline-deploiement.tar.gz debian@51.255.34.187:~/memoryline-deploiement.tar.gz
ssh -n -i ~/.ssh/memoryline_deploiement debian@51.255.34.187 "tar -xzf ~/memoryline-deploiement.tar.gz -C ~/memoryline apps/api/scripts/mettre-en-ligne.sh && bash ~/memoryline/apps/api/scripts/mettre-en-ligne.sh"
```
- `mettre-en-ligne.sh` fait la sauvegarde, la construction, les migrations et le redémarrage. Il efface aussi du serveur les fichiers retirés du dépôt.
- Une page de maintenance s'affiche pendant environ 2 minutes. Ne pas lancer PageSpeed à ce moment-là : le 17/11, un SEO à 42 venait de là.
- La clé `~/.ssh/memoryline_deploiement` est sur le PC du bureau. Sans elle (PC de la maison), on retire `-i …` et Alexandra tape elle-même le mot de passe.

**Vérifier avant de commiter** (conteneurs Docker locaux `memoryline-*`) :
- API : `npx tsc --noEmit -p .` puis `npx tsx --test tests/*.test.ts` dans `apps/api` ; 353 tests ou plus doivent passer.
- BO : `npx astro check` dans `apps/admin`.
- Site : `npx tsc --noEmit -p .` dans `apps/web` (3 erreurs anciennes de StandSalon, tolérées).
- Configurateur : `tsc` dans `packages/configurator`.
- Migrations locales : `npm run db:migrate` dans `apps/api`.
- Migration écrite à la main : son `when` dans `drizzle/meta/_journal.json` doit dépasser le plus grand `when` du journal, et son entrée va en dernier. drizzle 0.38 n'applique que les migrations dont le `when` dépasse celui de la dernière appliquée, et saute les autres sans rien dire (« ✓ Migrations appliquées » quand même) : le 20/11, une entrée glissée au milieu avec un `when` trop grand a dû être renommée et remise en fin de liste (`0110_affiches_demo`). Une autre session peut écrire une migration en même temps : relire la fin du journal juste avant.
- Essais à l'écran : Chrome sans écran piloté par script (CDP), jamais en prenant la main sur l'écran.
- Compte d'essai du BO local : le recréer avec `pnpm --filter @memoryline/api run create-admin <email> <mdp> owner`.

**Serveur**
- Il n'a que 3,8 Go de mémoire. **Ne jamais lancer de préparation en masse pendant une mise en ligne** : le 17/11 au soir, le VPS est resté une heure sans répondre.
- Le VPS n'est pas dans le compte OVH du domaine.
- Après trop de connexions SSH ratées, OpenSSH bloque l'adresse pendant environ 10 minutes : ne pas insister, réessayer une fois plus tard.
- Cache Docker : le crontab de debian lance `apps/api/scripts/vider-cache-docker.sh` chaque nuit à 1 h (heure de Paris). Il garde 3 Go. Journal : `sauvegardes/journal-cache.txt` (18/11 à 1 h : 2 Go libérés).
- Sauvegarde : chaque nuit à 3 h 30 (`sauvegarder.sh`) ; 14 jours pour la base, 7 pour les fichiers (copies liées, environ 3 Go en tout).
- Place sur le disque au 18/11 : 15 Go pris sur 40. Les visuels (`data/assets`) font 3,4 Go. Leur cache se vide tout seul de ce qui n'a pas servi depuis 60 jours ; le 18/11, 530 Mo de fonds devenus inutiles le 16/11 ont été effacés à la main. Les journaux des conteneurs sont limités à 3 × 10 Mo chacun.
- Journal de l'API : `docker compose -f docker-compose.prod.yml logs api`, dans `~/memoryline`.
- Page de maintenance à la main : `touch ~/memoryline/maintenance/ACTIVE`, puis `rm`.
- Lister les variables du `.env` sans les secrets : `grep -oE '^[A-Za-z_]+=' ~/memoryline/.env`.
- **Piège** : un copier-coller depuis une conversation change `www.memoryline.fr` en lien Markdown, jusque dans le `.env`. Contrôler avec `grep '^DOMAINE_WWW=' .env | tr '.' ' '`.

**Règles**
- Ne jamais lire ni afficher un `.env`. Les clés de prod, Alexandra les saisit elle-même.
- Ne jamais commiter `.env`, `data/`, `sauvegardes/`, les polices AnotherShabby, `.claude/launch.json` ni `docker-compose.override.yml`.
- Ne plus jamais lancer `vider-donnees-test.sh`.
- Pas de branche de travail : tout va dans `main`, et ce qui reste à faire va dans ce fichier.
- On archive d'abord. La suppression définitive ne vaut que pour un élément déjà archivé (`apps/api/src/suppression.ts`). Une commande payée ou facturée n'est jamais supprimée.
- Textes pour Margaux au tutoiement, BO au vouvoiement, textes du site dans `apps/web/src/i18n/ui.ts` en 7 langues (fr, en, de, it, es, ja, zh).
- Sous Windows, les antislashs sont mangés dans `node -e '…'` et dans certains heredocs : écrire le code dans un fichier.
- Des commentaires du code citent `AUDIT-SEO.md` (repères CNT-3, VIT-2…) ou `MISE-EN-PROD.md`. Ces fichiers ont été supprimés le 18/11 ; on les relit dans l'historique : `git show 1fdff55:AUDIT-SEO.md`.
