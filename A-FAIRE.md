# À faire — Memory Line (à jour le 18/11)

Fichier de reprise, à lire en premier. **`main` fait foi** : la prod est toujours une mise en ligne de `main`. Le détail de chaque travail passé est dans `git log` et dans les commentaires du code. Ce fichier ne garde que l'état utile et ce qui RESTE.

## 1. Où on en est

- **memoryline.fr est servi par le VPS** (OVH, `debian@51.255.34.187`) depuis la bascule du 17/11. www, http et l'ancien nom `vps-5c917e9d.vps.ovh.net` redirigent vers https://memoryline.fr.
- **La boutique encaisse pour de vrai depuis le 16/11 à 22 h 29.** Stripe live (compte « Vestiairesauvage »), PayPal live, vrais courriels par Resend (`commandes@memoryline.fr`), bordereaux SendCloud facturés. **Aucune commande d'essai sur le VPS : c'est de l'argent réel.**
- **Marché de Noël de Mulhouse : du vendredi 20/11 au 27/12** (11:00–12:30 / 13:00–20:00). Tout ce qui touche au stand doit être prêt le 19 au soir.
- 18/11 : tous les écrans clients contrôlés en ligne sur tablette (768 × 1024 et 1024 × 768, 16 pages) : rien ne déborde, aucune image cassée.

## 2. Avant le marché (19/11 au soir)

- **Les 15 affiches « prêtes à imprimer »** : leur PDF d'impression est refusé (photo de mise en scène 1020 × 1400 seulement). Soit Margaux dépose le visuel HD de chacune (BO › Produits › la fiche › Images, au moins 1754 × 2480, idéalement 2480 × 3508), soit on les passe en brouillon, soit elles sont déjà imprimées en stock.
- **BO › Ventes stand** : saisir l'« Emplacement exact » du stand de Mulhouse ; supprimer le « stand de test » (16–18/11).
- **Webhook Stripe live** : passer son URL à `https://memoryline.fr/api/payments/stripe/webhook` (Stripe ne suit pas les redirections), puis BO › Réglages › Paiements › « Vérifier ». Alexandra s'en charge (clés de prod).
- **Sur la tablette** (lien complet avec `?stand=1`) : essai à la main du geste « retour » pendant une personnalisation, sans valider de vente. Attendu : la fenêtre se ferme et l'affiche est toujours là.
- **Consignes au stand** : pas d'écriture chinoise, japonaise ni coréenne sur une affiche ; ne valider aucune vente d'essai.

## 3. Dans le code (Claude)

- **Chargements** (demandé le 18/11) : écran d'accueil, places réservées pendant le chargement des images, îlots sans état de chargement. Passe « 4G lente » sur tout le site.
- **Essai Stripe en mode TEST, en local seulement** : une carte cadeau de 10 € sur une commande de 15 € + port. L'intention Stripe doit s'ouvrir pour le total moins 10 € (montant dans la table `payment`).
- **PageSpeed** : à relancer après le changement d'image de l'accueil. Alexandra remplace elle-même cette image : ne pas y toucher. Au 17/11 : SEO, accessibilité et bonnes pratiques à 100 ; performance à 78, avec du CSS bloquant et 4 animations non composées.
- **Import Shopify** : dès qu'Alexandra dépose les deux CSV (procédure au § 5).
- **Petits défauts de la recette du 16-17/11**, non corrigés :
  - sur 360 px avec un cadre choisi, la barre du bas déborde (les cadres sont éteints sur le site) ;
  - la bulle « Plus bas » couvre deux vignettes de personnages sur petit téléphone, jusqu'au premier défilement ;
  - la poignée ⠿ fait 19 px ;
  - le champ d'une ligne longue ne s'agrandit pas ;
  - les emojis plus récents que Twemoji 15.0 disparaissent du papier sans avertissement ;
  - ♥ ☀ ❄ sont en noir à l'écran, en couleur sur le papier ;
  - la facture PDF retire les emojis ;
  - la vignette d'aperçu reste sur le disque après qu'on retire l'article.
- **Jamais essayé au navigateur avec le BO connecté** :
  - la suppression définitive sur les écrans atelier, catalogue et contenu ;
  - le remboursement à montant libre ;
  - le retour de Stripe après un paiement à redirection (codé et testé, `tests/retour-stripe.test.ts`) ;
  - la vidéo du Tuto sur un vrai iPhone ou iPad.

## 4. Pour Alexandra et Margaux (BO, comptes, décisions)

**Légal**
- **Pages légales** (BO › Réglages › Textes légaux) : 3 « À COMPLÉTER ». Le **médiateur de la consommation** (CGV, obligatoire) et deux durées d'inactivité (confidentialité).
- **Page Cookies** : elle doit citer la mesure d'audience. Google Tag Manager (`GTM-PJ2BFXCB`) est en ligne, avec le Consent Mode sur le bandeau.
- Dans GTM, **toute balise d'un autre éditeur que Google doit attendre le consentement**.
- **Licence commerciale de la police « Another Shabby »** : la version en service est une licence d'essai, non commerciale. L'acheter, puis remplacer `apps/api/fonts/AnotherShabby-Regular.ttf` et `apps/web/public/fonts/AnotherShabby-Regular.ttf` (hors git).

**Argent**
- **WEB-0016** (PayPal live, 16/11) : à rembourser. PayPal a refusé, faute de solde : un remboursement complet rend tout ce que la cliente a payé, alors que PayPal garde ses frais. Margaux lie une banque ou ajoute quelques euros, puis BO › la commande › « Rembourser », montant plein, « Annuler aussi la commande ». Ne pas acheter de bordereau pour elle.

**Référencement et ancien site**
- **Search Console** : propriété « Domaine » memoryline.fr (un TXT de plus dans la zone OVH, sans toucher au SPF) et plan du site.
- **Redirections Shopify** : admin Shopify › Contenu › Menus › Redirections d'URL › Exporter, puis BO › Boutique en ligne › Redirections › Importer.
- **Stripe › Payment method domains** : ajouter memoryline.fr.
- Rejouer `node apps/web/scripts/verifier-anciennes-adresses.mjs https://memoryline.fr`, puis suivre les 404 dans la Search Console (chaque ancienne adresse en 404 va dans BO › Redirections).
- **À J+7 (24/11)** : ne pas détacher le domaine de Shopify avant. Ensuite, mettre le mot de passe sur la boutique Shopify ; sur le serveur, effacer `.env.avant-domaine` et les images `secours-{api,web,admin}:avant-domaine`.

**Serveur**
- `rm ~/.env` : un fichier parasite dans `/home/debian`, avec une ligne MAIL_FROM. Ce n'est pas celui de `~/memoryline`.
- **Sauvegardes** : les copier hors du serveur au moins une fois par semaine (la dernière ligne de `sauvegarder.sh` donne la commande). `restaurer.sh` n'existe pas. Ne jamais restaurer une sauvegarde d'avant le vidage du 17/11 à 08 h 38.
- **Le VPS n'est pas dans le compte OVH du domaine.** Noter ici son identifiant client OVH quand on l'a.

**Au BO**
- Vidéo du Tuto : c'est toujours celle d'essai, le bouton reste éteint jusqu'à la vraie.
- Collection « Cuisine » (une seule affiche).
- Relance de panier : base légale, délai et texte à valider par Margaux, sinon l'éteindre.
- Relire les promotions et les bandeaux.
- Archiver le compte d'essai `vendeur@memoryline.fr`.
- **Compte BO de Margaux** : un seul compte, rôle « Propriétaire », créé avec `create-admin` SUR le VPS, jamais depuis le PC. Mot de passe de 10 caractères au moins, jamais collé dans une conversation.

**Margaux**
- **Tenues par défaut** des personnages de face : BO › Personnages › fiche › Calage des pièces.
- **Calages à refaire** :
  - femmes de dos : « Cheveux longs raides femme 6 », « Hair raides longs », « Hair bouclés courts » ;
  - Femme 6 : « TEST ».
- **Textes des fiches à valider** : https://claude.ai/artifact/XKJoTgX1W2JJatZ6H3UJDm. Elle remplit la colonne « Décision », puis on importe par BO › Produits › Importer.
- **Rayon « Accessoires »** : 25 affiches de villes sous un texte de porte-clés et de chaussettes. Le cacher, ou lui donner un texte juste. La question est à lui reformuler.
- Valider les 18 redirections des fiches disparues (`apps/web/src/lib/anciennes-adresses.ts`) et les seuils de composition des personnages (`packages/types/src/composition-personnages.ts`).
- Traductions des fiches, catégories et cadres : au BO, « Proposer les traductions manquantes ».
- Facultatif : une page « affiches-personnalisables » avec le texte de l'ancienne page Shopify (`memoryline-page-affiches-personnalisables.html`, PC du bureau).
- En attente : la carte Trello « Bordereau La Poste » (Alexandra) ; la question des fonds WebP des commandes, à reposer.

## 5. Import de l'historique Shopify

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

## 6. Bon à savoir

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
- `mettre-en-ligne.sh` fait la sauvegarde, la construction, les migrations et le redémarrage.
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
- Après trop de connexions SSH ratées, OpenSSH bloque l'adresse pendant environ 10 minutes : ne pas insister, réessayer une fois plus tard.
- Cache Docker : le crontab de debian lance `apps/api/scripts/vider-cache-docker.sh` chaque nuit à 1 h (heure de Paris). Il garde 3 Go. Journal : `sauvegardes/journal-cache.txt`.
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
