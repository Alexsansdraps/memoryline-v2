# À faire — état au 12 novembre (écrit pour une reprise dans un autre contexte)

Fichier de reprise : à lire en premier. `main` fait foi ; la prod (VPS) est toujours une mise en ligne de `main`. Le détail de chaque travail passé est dans `git log` (messages de commit) et dans les commentaires du code : ce fichier ne garde que ce qui RESTE.

## 1. Ce qui est en prod (VPS)

Tout `main`, migrations jusqu'à **0075** (12/11). Vérifié le 11/11 : site, API, `/llms.txt` 200, BO 302 vers la connexion. Derniers ajouts (8–11/11) : page de maintenance pendant les mises en ligne, suppression définitive des éléments archivés (`apps/api/src/suppression.ts`), fenêtre de personnalisation qui ne se ferme plus au clic à côté et garde l'affiche en cours, pilule « Tuto » (et sa vidéo corrigée pour Safari), « C'est une ombre » sur les pièces en pixels, reflets des tissus presque blancs corrigés, un seul interrupteur essai / pour de vrai (paiements, courriels, étiquettes), signature réglable en « Taille », Reply-To des courriels, SIRET 00047 et délai de préparation dans les pages légales.

## 2. Reste à faire dans le code (Claude)

- **Pas essayé au navigateur, BO connecté** : la suppression définitive sur les écrans atelier, catalogue et contenu (seuls les écrans « ventes » l'ont été).
- **Vidéo du Tuto sur un vrai iPhone/iPad** : corrigée pour Safari le 11/11 (`dd72e8b`) mais vérifiée seulement en Chrome simulé. À faire retester par Margaux. Depuis le 12/11 (`330e4c5`), elle s'affiche aussi en mode stand (vérifié sur le VPS avec ?stand=1) : sur la tablette du stand, elle ne la voyait pas car elle y était masquée exprès.
- **Retour de Stripe après un paiement à redirection** : codé et testé (`tests/retour-stripe.test.ts`), jamais essayé avec un vrai paiement d'essai.
- Petits restes sans gravité : une vente du stand passée par le site garde sa note « Stand : … » ; les commentaires d'en-tête de `apps/api/src/db/schema.ts` disent encore « numérotation sans trou ni doublon » / canal « immuable » ; au retour de Stripe, un paiement réussi d'un montant différent (`MontantEncaisseDifferent`) affiche « en cours de validation » au lieu de dire qu'on revient vers la cliente.

## 3. À faire sur le BO ou le serveur (vérifié sur le VPS le 11/11, réponses d'Alexandra du 11/11)

**Pour Margaux (à lui transmettre) :**
- **Tenues par défaut des personnages de face** : aucune aujourd'hui (c'est à elle de voir). Sans elles, les couleurs de face ne se voient qu'après avoir touché un vêtement. BO › Personnages › fiche › Calage des pièces › « Le personnage porte cette pièce par défaut ».
- **Calages à refaire** (depuis le 27/10) : sur les femmes de dos, recaler séparément « Cheveux longs raides femme 6 », « Hair raides longs », « Hair bouclés courts » ; sur Femme 6, caler « TEST ».
- **Visuels HD des 15 affiches « prêtes à imprimer »** : vérifié le 11/11, elles n'ont toujours que des images de 1 020 × 1 400 px (les visuels HD ne sont pas sur le site). Sans eux, leur PDF d'impression est refusé (il faut ≥ 1 240 × 1 754 en A4, 1 754 × 2 480 en A3). Elle peut les déposer elle-même : fiche de l'affiche › bloc « Images ».
- **Vidéo du Tuto** : elle ne l'a pas encore ; c'est la vidéo de TEST qui reste en attendant. Fichier .mp4 à téléverser (BO › Contenu du site › Personnalisation — vidéo explicative).

**Pour plus tard :**
- **Compte du BO de Margaux** (agence.glowup@gmail.com) : on le fera plus tard. **Un seul compte, rôle « Propriétaire »** : ce rôle fait déjà tout, y compris vendre au stand (Ventes stand › « Ouvrir ») — pas besoin d'un compte vendeur en plus. Le compte vendeur@memoryline.fr n'est qu'un compte d'essai (à archiver un jour).
- **Courriels réels — l'expéditeur (`MAIL_FROM`)** : Alexandra voulait l'adresse de Memory Line (memoryline.contact@gmail.com). Resend refuse d'envoyer « au nom » d'une adresse gmail : il faut une adresse sur le domaine **memoryline.fr**, une fois ce domaine vérifié chez Resend (des lignes DNS à ajouter chez l'hébergeur du domaine). Par ex. `Memory Line <commandes@memoryline.fr>`, les réponses partant déjà vers la boîte de la boutique (Reply-To = `CONTACT_TO`). À faire au moment de l'ouverture (MISE-EN-PROD § 3).
- **Interrupteur « Garder en essai / Pour de vrai »** (BO › Réglages › Paiements) : rien à faire maintenant (sans clic, la boutique reste en essai). Le jour de l'ouverture : « Pour de vrai ».
- **Lieux de retrait** : aucun pour l'instant ; la cliente choisira son lieu à la caisse parmi ceux créés (BO › Livraison › Lieux de retrait). À créer quand ils seront connus ; sans lieu, le retrait sur place n'apparaît pas.
- **Redirections de Shopify** (avant de fermer la boutique Shopify) : sur l'ancien site, des adresses ont pu être renvoyées vers d'autres à la main (ex. une ancienne fiche « strasbourg » vers « colmar »). La liste s'exporte de l'admin Shopify (Contenu › Menus › Redirections d'URL › Exporter) et s'importe dans BO › Boutique en ligne › Redirections. Les adresses des fiches et collections Shopify, elles, sont déjà redirigées automatiquement par le nouveau site.
- **Page « affiches-personnalisables »** : l'ancienne adresse `/pages/affiches-personnalisables` mène déjà au rayon « Affiches personnalisables » (vérifié). Facultatif : y reprendre le long texte de l'ancienne page Shopify (fichier `memoryline-page-affiches-personnalisables.html`, PC du bureau) en créant une page de ce nom.
- Relire la promotion 3+1 (BO › Promotions) et les messages du bandeau.

**Fait le 12/11** : bouton « Supprimer définitivement » sur la page globale Archives (essayé en local sur une pièce d'essai) ; adresse de la boutique dans les factures, les mentions légales, les CGV et la confidentialité (0075).

**Fait et vérifié le 11/11** (sorti de la liste) : les trois « Femme test » archivées ; signature réglée (9) ; ombres cochées sur les pièces 517, 520, 521, 523 ; une vraie commande payée sur le site depuis la correction du 500 (WEB-0015, 29/10) ; `CONTACT_TO` et `MAIL_BOUTIQUE` renseignées ; SIRET 00047 et délai dans les pages légales.

## 4. En attente d'une décision ou de Margaux

- **Pages légales** : il manque un téléphone, son nom complet (entrepreneur et directeur de la publication), l'immatriculation (RCS ou répertoire des métiers) s'il y en a une, et le **médiateur de la consommation (obligatoire)**. L'adresse (7 chemin du Jeu d'Arc, 60170 Saint-Crépin-aux-Bois) et « Entrepreneur individuel » sont posées depuis le 12/11 (migration 0075), comme l'adresse des factures.
- **Textes des fiches** (23/10) : document « Textes des fiches à valider », https://claude.ai/artifact/XKJoTgX1W2JJatZ6H3UJDm — colonne « Décision » à remplir (Margaux a demandé ce que c'est : lui expliquer). Ensuite, import des descriptions par BO › Produits › Importer.
- **Rayon « Accessoires »** : 25 affiches de villes sous un texte qui parle de porte-clés et de chaussettes. Le cacher, ou lui donner un texte juste ? (Margaux n'a pas compris la question : la lui reformuler.)
- Faire valider par Margaux : les 18 redirections des fiches disparues (`apps/web/src/lib/anciennes-adresses.ts`) et les seuils de composition des personnages (`packages/types/src/composition-personnages.ts`).
- Traductions des fiches, catégories et cadres : au BO (« Proposer les traductions manquantes »).
- Carte Trello « Bordereau La Poste » : en attente côté Alexandra.
- Fonds WebP des commandes : question à reposer à Margaux.

## 5. Bon à savoir

- **Mise en ligne** : `MISE-EN-PROD.md`, étape 1 (archive depuis `main` + polices AnotherShabby hors git, puis `mettre-en-ligne.sh` sur le serveur : sauvegarde, construction, migrations, redémarrage). Depuis le PC du **bureau** et, depuis le 22/10, celui de la **maison**, Claude peut mettre en ligne sans mot de passe (clé SSH `~/.ssh/memoryline_deploiement` sur chacun) : `scp -i ~/.ssh/memoryline_deploiement …` puis `ssh -i ~/.ssh/memoryline_deploiement …` avec la commande de `MISE-EN-PROD.md`. L'archive se construit avec `git -c core.autocrlf=false archive --format=tar -o memoryline-deploiement.tar HEAD -- . ':(exclude)data/memoryline-archive'`, plus les deux polices AnotherShabby (`tar --force-local -rf`), puis `gzip -9` (≈ 4,4 Mo ; sans l'exclusion, 1 Go). Journal de l'API : `docker compose -f docker-compose.prod.yml logs api` dans `~/memoryline`. Depuis l'autre PC : la commande en une ligne de `MISE-EN-PROD.md`, avec le mot de passe.
- **Page de maintenance** : posée et retirée par `mettre-en-ligne.sh` (fichier `maintenance/ACTIVE`, servi par Caddy en 503 ; l'API et le BO n'y passent pas). À la main sur le serveur : `touch ~/memoryline/maintenance/ACTIVE` / `rm`.
- **Mailpit du serveur** (pré-prod en essai : tous les courriels y vont) : `ssh -i ~/.ssh/memoryline_deploiement -L 8026:127.0.0.1:8025 debian@51.255.34.187`, puis http://localhost:8026.
- Compte d'essai du BO **local** : `essai-module@example.test` ; le remettre sur un PC avec `pnpm --filter @memoryline/api run create-admin <email> <mdp> owner`.
- Le cache de construction Docker du VPS a été nettoyé le 19/10 (20 Go libérés, disque à 36 %) ; quand il se remplit : `docker builder prune -f --keep-storage 3GB` sur le serveur.
- Tests à l'écran sans prendre la main : Chrome headless piloté par script (voir `tests-sans-prendre-l-ecran` dans la mémoire du PC du bureau), jamais de computer-use.
- Règles : `main` fait foi ; ne jamais commiter `.env`, `data/`, `sauvegardes/` ni les polices AnotherShabby ; ne jamais lire `.env` ; on archive d'abord ; la suppression DÉFINITIVE (depuis le 8/11) n'existe que pour un élément déjà archivé, via `apps/api/src/suppression.ts` (refus 409 si quelque chose s'en sert encore) — commandes payées/facturées jamais supprimées ; messages pour Margaux en tutoiement, BO en vouvoiement ; textes du site dans `ui.ts` en 5 langues.
