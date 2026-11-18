# À faire — Memory Line (à jour le 18/11)

Fichier de reprise, à lire en premier. **`main` fait foi** : la prod est toujours une mise en ligne de `main`. Le détail de chaque travail passé est dans `git log` et dans les commentaires du code. Ce fichier ne garde que l'état utile et ce qui RESTE. Ce que Margaux doit faire de son côté, elle le sait : ce n'est pas suivi ici.

## 1. Où on en est

- **memoryline.fr est servi par le VPS** (OVH, `debian@51.255.34.187`) depuis la bascule du 17/11. www, http et l'ancien nom `vps-5c917e9d.vps.ovh.net` redirigent vers https://memoryline.fr.
- **La boutique encaisse pour de vrai depuis le 16/11 à 22 h 29.** Stripe live (compte « Vestiairesauvage »), PayPal live, vrais courriels par Resend (`commandes@memoryline.fr`), bordereaux SendCloud facturés. **Aucune commande d'essai sur le VPS : c'est de l'argent réel.**
- **Marché de Noël de Mulhouse : du vendredi 20/11 au 27/12** (11:00–12:30 / 13:00–20:00).
- 18/11 : tous les écrans clients contrôlés en ligne sur tablette (768 × 1024 et 1024 × 768, 16 pages) : rien ne déborde, aucune image cassée.
- **Mise en ligne seulement sur le feu vert d'Alexandra** (18/11 : « je veux pas perturber Margaux »).
- **18/11 vers 11 h 45, la prod est le commit `42be3b5`** (commande sans compte), PAS `main`. Alexandra : « go prod tout sauf le truc google ». Le commit Google `15256b4` et ce qui suit attendent. La prochaine mise en ligne de `main` emportera le code Google ; il reste en sommeil tant que les clés ne sont pas posées, mais le dire à Alexandra avant.
- En ligne le 18/11 au matin : écran d'accueil (logo et barre, au premier affichage de la visite, de 0,5 à 2,5 s) ; barre de chargement quand on change de page ; reflet d'attente sur les images ; polices des affiches en `font-display: block`, celles de départ chargées avec le module ; nettoyage de la mise en ligne et journaux Docker limités.
- **18/11, vers 9 h : Inter servie par le site** (« ML Inter », `apps/web/public/fonts/Inter-*.woff2`, préchargée, `font-display: block`). Avant, le site nommait Inter sans la fournir : dans le Chrome d'Alexandra, Inter arrivait 0,6 s après le reste et le texte passait de Segoe UI à Inter en se remettant en page (vidéo du 18/11 ; Firefox n'avait pas le défaut). Le module de personnalisation suit aussi la police du site.
- **18/11, vers 10 h 15** :
  - l'écran d'accueil attend la police du site (6 s au plus) au lieu des images : jamais de Segoe UI, même en 4G lente ;
  - le code de test « tout gratuit » V7X9-KQ4M-Z8WP-3N6R est SUPPRIMÉ (migration 0089) ;
  - **carte cadeau** :
    - montant libre de 5 € au moins, sans plafond annoncé (garde-fou invisible à 10 000 €), et plus de phrase « de 10 à 300 € » ;
    - l'image « Gift Card » d'Alexandra sur la page (déclinée dans `apps/web/public/carte-cadeau/`, partage compris) ;
    - une vignette « CARTE CADEAU, dès 5 € » en dernière place de la première page de chaque rayon, sauf au stand et avec un lieu choisi (`VignetteCarteCadeau.astro`) ;
    - un lien « Carte cadeau » dans le pied de page (migration 0090).
  - Les images d'origine (`Memory Line Gift Card.png`, `Memory Line Carte Cadeau.png`) sont à la racine du dépôt, hors git.
- **18/11, vers 10 h 45** :
  - « Carte cadeau » en dernière entrée du menu du haut (migration 0091) ;
  - BO › Menu du site, **liens directs**. La liste « Page » propose aussi :
    - la carte cadeau et « Mon compte » ;
    - chaque affiche en vente (« Une affiche (sa fiche) ») ;
    - « Lien vers un autre site… », qui ouvre le champ Adresse (`https://…` ou `mailto:`).
    Les pages du site, elles, se choisissent toujours.
  - Avec 4 entrées, l'en-tête tient en 1024 px pour une visiteuse ; pour une administratrice connectée, le bouton « Back-office » le fait déborder à cette largeur.
  - En local, le BO s'essaie sur `http://localhost:4322/bo` : par le proxy du port 8080, ses scripts de développement (`/src/…`) partent vers le site et répondent 500.
- **18/11, vers 11 h 15, carte cadeau** :
  - au récapitulatif de la caisse : l'image de la carte, plus de « Envoyée par e-mail… », et le montant se change dans la ligne (PUT `carteCadeau`, revérifié par le serveur ; message sous le champ s'il ne va pas) ;
  - BO › Contenu du site › **Carte cadeau** : montants proposés (`carte_cadeau.montants`, celui du milieu choisi d'avance), nom dans les rayons, titre, introduction, les 3 points et la description Google, en 5 langues (vide = texte de la boutique).
- **18/11, vers 12 h 15, carnet d'adresses et facturation** (`apps/api/src/adresses-client.ts`, migration 0092) :
  - **Compte › Mes adresses** : une seule case « adresse par défaut ». C'est l'adresse de facturation, proposée d'abord pour la livraison. La première adresse l'est d'office ; si on la supprime, une autre la remplace. La migration a fondu les deux anciens drapeaux.
  - **Caisse** :
    - un bloc « Adresse de facturation » avec l'adresse par défaut et « La changer dans mon compte » ;
    - la livraison se fait à cette adresse (premier choix, marqué), à une autre du carnet ou à une nouvelle ;
    - une nouvelle adresse a la case « Garder cette adresse dans mon compte », cochée d'avance ; avec un carnet vide, elle y entre d'office et devient l'adresse de facturation.
  - **Serveur** : il relit lui-même l'adresse par défaut et la fige sur la commande (`billing_*`). La facture la met dans « Facturé à » ; les commandes d'avant gardent la livraison. Le BO la montre dans le bloc Client de la fiche commande.
- **18/11, commande SANS COMPTE (en invitée)** :
  - la caisse montre le formulaire à toutes, avec un bandeau « Pas besoin de compte pour commander… Me connecter » ;
  - le serveur rattache la commande à la fiche qui porte l'e-mail, ou en crée une : jamais une fiche par achat ;
  - une invitée n'a pas de carnet : sa facturation est l'adresse saisie ;
  - une commande à 0 € se valide avec la preuve du panier (`cartId`) ;
  - l'ancien rangement systématique de l'adresse dans le carnet, après la caisse, est retiré : il ignorait la case « Garder… » et rangeait l'adresse d'une invitée chez la fiche du même e-mail.
- **18/11, vers 12 h 45, suppressions au BO** :
  - **Commandes et ventes du stand, onglet « Archivées »** : « Supprimer définitivement » par sélection. Les règles sont celles de la fiche (`motifCommandeAGarder`) : ce qui a été payé, facturé, remboursé, encaissé, expédié ou réglé en carte cadeau reste archivé, et le message dit pourquoi.
  - **Clients** : « Supprimer définitivement » par sélection (`POST /admin/customers/supprimer`). Une fiche qui a une commande payée ou facturée est gardée et nommée. Les autres partent avec leurs adresses, sessions et jetons ; leurs paniers et commandes jamais payées restent, détachés d'elles.

## 2. Dans le code (Claude)

- **Chargements** : il reste une passe « 4G lente » sur tout le site. L'écran d'accueil peut coûter quelques points de performance à PageSpeed (indice de vitesse), sans toucher au SEO.
- **PageSpeed** : à relancer après le changement d'image de l'accueil. Alexandra remplace elle-même cette image : ne pas y toucher. Au 17/11 : SEO, accessibilité et bonnes pratiques à 100 ; performance à 78, avec du CSS bloquant et 4 animations non composées.
- **Import Shopify** : dès qu'Alexandra dépose les deux CSV (procédure plus bas).
- **« Continuer avec Google » : le CODE EST PRÊT, EN SOMMEIL** (18/11).
  - Code : `apps/api/src/google-oauth.ts`, les routes dans `comptes.ts` (`/compte/google`, `/compte/google/retour`, `/compte/google/etat`), `BoutonGoogle.astro` sur la connexion et l'inscription, et les tests `tests/google-oauth.test.ts`.
  - Le parcours : code d'autorisation avec PKCE et `state`, e-mail vérifié par Google. La session s'ouvre sur la fiche du même e-mail (celle qui a un mot de passe d'abord) ; sinon une fiche est créée.
  - **Pour l'allumer** :
    1. Margaux crée l'identifiant client (marche à suivre : https://claude.ai/artifact/Nvgds4ofJy18vtSGZhVLZ8), avec l'origine `https://memoryline.fr` et l'URI de redirection `https://memoryline.fr/api/compte/google/retour`.
    2. Margaux ajoute la phrase sur Google à la page Confidentialité (elle est dans le même document).
    3. Alexandra met `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` dans `~/memoryline/.env`, puis lance `docker compose -f docker-compose.prod.yml up -d --force-recreate api`.
    4. Le bouton apparaît tout seul. Faire un essai avec un compte Google.
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
- Ne jamais commiter `.env`, `data/`, `sauvegardes/`, les polices AnotherShabby, ni `.claude/launch.json`.
- Ne plus jamais lancer `vider-donnees-test.sh`.
- Pas de branche de travail : tout va dans `main`, et ce qui reste à faire va dans ce fichier.
- On archive d'abord. La suppression définitive ne vaut que pour un élément déjà archivé (`apps/api/src/suppression.ts`). Une commande payée ou facturée n'est jamais supprimée.
- Textes pour Margaux au tutoiement, BO au vouvoiement, textes du site dans `apps/web/src/i18n/ui.ts` en 5 langues.
- Sous Windows, les antislashs sont mangés dans `node -e '…'` et dans certains heredocs : écrire le code dans un fichier.
- Des commentaires du code citent `AUDIT-SEO.md` (repères CNT-3, VIT-2…) ou `MISE-EN-PROD.md`. Ces fichiers ont été supprimés le 18/11 ; on les relit dans l'historique : `git show 1fdff55:AUDIT-SEO.md`.
