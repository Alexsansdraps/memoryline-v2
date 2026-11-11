# À faire — état au 11 novembre (écrit pour une reprise dans un autre contexte)

Fichier de reprise : à lire en premier. `main` fait foi ; la prod (VPS) est toujours une mise en ligne de `main`. Le détail de chaque travail passé est dans `git log` (messages de commit) et dans les commentaires du code : ce fichier ne garde que ce qui RESTE.

## 1. Ce qui est en prod (VPS)

Tout `main` jusqu'au code de `dd72e8b` (11/11), migrations jusqu'à **0074**. Vérifié le 11/11 : site, API, `/llms.txt` 200, BO 302 vers la connexion. Derniers ajouts (8–11/11) : page de maintenance pendant les mises en ligne, suppression définitive des éléments archivés (`apps/api/src/suppression.ts`), fenêtre de personnalisation qui ne se ferme plus au clic à côté et garde l'affiche en cours, pilule « Tuto » (et sa vidéo corrigée pour Safari), « C'est une ombre » sur les pièces en pixels, reflets des tissus presque blancs corrigés, un seul interrupteur essai / pour de vrai (paiements, courriels, étiquettes), signature réglable en « Taille », Reply-To des courriels, SIRET 00047 et délai de préparation dans les pages légales.

## 2. Reste à faire dans le code (Claude)

- **Page globale « Archives »** (`apps/admin/src/pages/archives.astro`) : pas de bouton « Supprimer définitivement » (les écrans de chaque rubrique l'ont ; les fonctions `supprimer…` de `lib/api.ts` sont prêtes).
- **Pas essayé au navigateur, BO connecté** : la suppression définitive sur les écrans atelier, catalogue et contenu (seuls les écrans « ventes » l'ont été).
- **Vidéo du Tuto sur un vrai iPhone/iPad** : corrigée pour Safari le 11/11 (`dd72e8b`) mais vérifiée seulement en Chrome simulé. À faire retester par Margaux, en fenêtre privée (au stand, la vidéo est masquée exprès).
- **Retour de Stripe après un paiement à redirection** : codé et testé (`tests/retour-stripe.test.ts`), jamais essayé avec un vrai paiement d'essai.
- Petits restes sans gravité : une vente du stand passée par le site garde sa note « Stand : … » ; les commentaires d'en-tête de `apps/api/src/db/schema.ts` disent encore « numérotation sans trou ni doublon » / canal « immuable » ; au retour de Stripe, un paiement réussi d'un montant différent (`MontantEncaisseDifferent`) affiche « en cours de validation » au lieu de dire qu'on revient vers la cliente.

## 3. À faire sur le BO ou le serveur (vérifié sur le VPS le 11/11 : pas encore fait)

- **Interrupteur essai / pour de vrai** (BO › Réglages › Paiements) : jamais touché en prod. Le régler une fois sur « Garder en essai » pour que paiements, courriels et étiquettes le suivent.
- **Courriels réels** : `RESEND_API_KEY` est renseignée, mais **`MAIL_FROM` est vide** sur le serveur (expéditeur, sur le domaine vérifié chez Resend — pas une adresse gmail). `CONTACT_TO` et `MAIL_BOUTIQUE` sont renseignées : les réponses aux courriels vont donc déjà à la boîte de la boutique (`MAIL_REPONSE` facultatif). Clé Resend de Margaux : à saisir avec Alexandra, pas par courriel (ou la régénérer ensuite).
- **Compte du BO de Margaux** (agence.glowup@gmail.com, rôle Propriétaire) : n'existe pas. Comptes actifs : a.porhansl@icloud.com, votre@email.fr (propriétaires), vendeur@memoryline.fr (vendeur, **aucun stand confié**). Claude ne le crée pas (mot de passe).
- **Vidéo du Tuto** : toujours celle de TEST (Big Buck Bunny). Margaux dépose la sienne (fichier .mp4 téléversé, préféré pour les connexions faibles) : BO › Contenu du site › Personnalisation — vidéo explicative.
- **Lieux de retrait** : aucun (BO › Livraison › Lieux de retrait) ; sans lieu, le retrait sur place n'apparaît pas à la caisse.
- **Adresse des factures** : seul le SIRET est saisi (BO › Réglages › Factures).
- **Page « affiches-personnalisables »** : n'existe pas. Y coller `memoryline-page-affiches-personnalisables.html` (PC du bureau, `Documents\perso`) : elle reprend l'adresse de Shopify.
- **Redirections de Shopify** : aucune importée (0 en base). Avant la fermeture de Shopify : admin Shopify › Contenu › Menus › Redirections d'URL › Exporter, puis BO › Boutique en ligne › Redirections › Importer (aperçu, puis « Appliquer »).
- **Tenues par défaut des personnages de face** : aucune (Margaux, 9/11 : « normal », elle le fera) ; sans elles, les couleurs de face ne se voient qu'après avoir touché un vêtement.
- **Calages à refaire par Margaux** (depuis le 27/10) : sur les femmes de dos, recaler séparément « Cheveux longs raides femme 6 », « Hair raides longs », « Hair bouclés courts » ; sur Femme 6, caler « TEST ».
- **Visuels HD des 15 affiches « prêtes à imprimer »** : sans eux (1 020 × 1 400 px aujourd'hui), leur PDF d'impression est refusé (il faut ≥ 1 240 × 1 754 en A4, 1 754 × 2 480 en A3). Margaux peut les déposer elle-même par « Ajouter un visuel » sur chaque fiche — à lui répondre (sa question du 9/11).
- Relire la promotion 3+1 (BO › Promotions) et les messages du bandeau.

**Fait et vérifié le 11/11** (sorti de la liste) : les trois « Femme test » archivées ; signature réglée (9) ; ombres cochées sur les pièces 517, 520, 521, 523 ; une vraie commande payée sur le site depuis la correction du 500 (WEB-0015, 29/10) ; `CONTACT_TO` et `MAIL_BOUTIQUE` renseignées ; SIRET 00047 et délai dans les pages légales.

## 4. En attente d'une décision ou de Margaux

- **Pages légales** : il manque l'adresse postale à publier, un téléphone, son nom complet (entrepreneur et directeur de la publication), l'immatriculation (RCS ou répertoire des métiers) s'il y en a une, et le **médiateur de la consommation (obligatoire)**. Forme : entrepreneur individuel, TVA non applicable (art. 293 B).
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
