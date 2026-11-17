# Recette et bascule de memoryline.fr — 17/11

Ce fichier remplace le « Jour J » de `MISE-EN-PROD.md`, écrit quand la boutique était encore en essai. Elle encaisse pour de vrai depuis le 16/11 à 22 h 29 : l'interrupteur, les clés live et APP_SECRET sont faits. Il reste à vider les essais et à brancher le domaine.

Ce plan vient d'une relecture adverse faite la nuit du 16 au 17/11 : 6 agents, chaque constat contre-vérifié. Ils ont lu le code, essayé Caddy, Compose et les scripts, et relu la zone DNS chez OVH. **Personne n'a touché au serveur.**

---

## 1. Ce qui a été corrigé (en ligne le 17/11)

**`apps/api/scripts/vider-donnees-test.sh`**. Tel qu'il était, il aurait supprimé **la vraie commande WEB-0016** (PayPal live), avec la référence qui permet de la rembourser. Le script corrigé :

- **garde les ventes payées pour de vrai** (paiement `live` encaissé) et leur cliente. WEB-0016 reste remboursable depuis sa fiche, même après le vidage. Conséquence : la première vraie commande sera **WEB-0017**, pas WEB-0001.
- **ne se lance qu'une fois**. Après un vidage réussi, il pose la marque `sauvegardes/VIDAGE-FAIT` dès la fin de la transaction, puis refuse tout second lancement : relancé plus tard, il viderait la vraie boutique.
- **range sa sauvegarde à part**, dans `sauvegardes/base/<jour>-avant-vidage.sql.gz`. Il refuse de l'écraser. L'ancien nom était celui du jour, et la mise en ligne du même jour l'aurait remplacée par la base vidée.
- **remet toujours l'API en route**, même en cas de panne au milieu. Il affiche la page de maintenance pendant le vidage.
- **montre aussi**, en mode « montrer » : les ventes réelles gardées, les bordereaux SendCloud encore ouverts, les promotions, les pages, les bandeaux, et les réglages de relance et de vidéo.

Testé sur une copie du schéma 0079 avec un jeu d'essai : une commande live et une d'essai, une vente de stand, un bordereau, un compteur de factures. Le vidage passe. WEB-0016 reste avec son paiement et sa cliente, tout le reste part, le stand est fermé.

### Recette complète du 16-17/11

Elle a été jouée sur la pile locale avec Chrome en tablette et en téléphone simulés, et chaque bug a été contre-vérifié. Ce qui a été **corrigé et mis en ligne le 17/11** (`a7840b6`, `9de3957`) :

- **Bouton ou geste « précédent » pendant la personnalisation** : avant, il quittait la fiche et l'affiche composée était perdue. Maintenant il ferme seulement la fenêtre, comme la croix, et l'affiche reste là. Vérifié dans le navigateur.
- **BO › Pages › « Où elle se montre »** : ce réglage n'existait pas dans l'éditeur, alors que l'API le connaissait. On peut maintenant choisir « Sur le site », « Sur la tablette du stand seulement » ou « Les deux ». Vérifié au BO local.
- **Stand** : le nom et l'e-mail du client étaient perdus après « Revenir à ma commande » puis « Modifier » une affiche. Ils restent maintenant tant que c'est le même panier.
- **Symboles au PDF** : ★ ♡ ♪ → ✓, le grec, le cyrillique et l'arabe sortaient en petites cases à code hexadécimal. Une police de secours (DejaVu) est installée dans l'image de l'API. 16 rendus de commandes existantes ont été comparés avant et après : identiques au pixel près. Le chinois, le japonais et le coréen restent non imprimables.
- **Remboursement en « % du reste »** : le navigateur refusait 50 % et 100 %. Corrigé.
- **Commande annulée** : si la cliente revalidait sa caisse, la commande repassait « en attente de paiement ». Elle reste maintenant close, et le site repart d'un panier neuf.
- **Bouton « Marquer comme remis »** (vente du stand) : la fiche dit maintenant qu'il envoie au client le courriel « Votre affiche est prête ».
- Courriel de contact reçu par la boutique : la phrase sur le bouton « Répondre » est remise d'accord avec le Reply-To.

Ce qui **marche** (vu) :
- **La tablette** : mode stand, aucun prix affiché, code du stand, stand fermé pendant la saisie, vente sans double envoi, « Revenir à ma commande », « Client suivant ». Les PDF des affiches personnalisées sortent nets à 300 ppp, emojis en couleur.
- **Le compte vendeur.**
- **Le module** en 360, 390, 768 et 1024 px : la rotation ne perd rien, la croix garde l'affiche, la vidéo s'affiche.
- **Les emojis** : 75 rendus, identiques à l'écran à 0,6 mm près.

**BLOQUANT pour jeudi : les 15 affiches « prêtes à imprimer ».** Leur PDF d'impression est **refusé**, en A4 comme en A3, en prod comme en dev. Elles n'ont que la photo de mise en scène (1020 × 1400 px : l'affiche dans un cadre, devant une plante). Pourtant, la tablette les vend sans prévenir. Il faut choisir l'une de ces options :
- **Margaux ajoute le visuel HD de chacune** : BO › Produits › la fiche › bloc « Images ». Il faut au moins 1754 × 2480 px pour l'A3, idéalement 2480 × 3508. La photo de mise en scène peut rester en premier, l'impression prend la plus grande image. Contrôle : la mention rouge sous « PDF » disparaît dans Ventes stand.
- **Ou bien on les retire de la vente** jusque-là : BO › Produits › filtrer « prêtes à imprimer » › tout cocher › statut « Brouillon ».
- **Ou bien elles sont déjà imprimées en stock** : dans ce cas, rien à faire.

Petits défauts vus, **non corrigés** (pas gênants pour jeudi) :
- sur un téléphone de 360 px avec un cadre choisi, la barre du bas déborde (les cadres sont éteints sur le site) ;
- une bulle « Plus bas » couvre deux vignettes de personnages sur petit téléphone, jusqu'au premier défilement ;
- la poignée ⠿ fait 19 px (l'appui long sur la ligne marche) ;
- le champ d'une ligne longue ne s'agrandit pas ;
- les emojis plus récents que Twemoji 15.0 (🫩 🐦‍🔥 🍋‍🟩) disparaissent du papier sans avertissement ;
- ♥ ☀ ❄ tapés sans sélecteur sont en noir à l'écran mais en couleur sur le papier ;
- la caisse accepte un code postal ou un téléphone fantaisiste ;
- la pastille du panier ne suit pas un changement de quantité ;
- l'ordre des lignes du panier change quand on modifie une quantité ;
- la facture PDF retire les emojis ;
- le prénom des courriels est coupé au premier espace ;
- « Encaissé : Stripe · pi_… » s'affiche sur une commande jamais payée ;
- le message d'encaissement annonce des PDF prêts alors qu'ils sont encore en fabrication ;
- la vignette d'aperçu reste sur le disque après qu'on retire l'article du panier.

**Consignes au stand** :
- pas d'écriture chinoise, japonaise ni coréenne sur une affiche ;
- **rouvrir le lien de la tablette chaque matin** ;
- **ne valider aucune vente d'essai** : elle serait réelle.

---

## 2. À faire AVANT la bascule (mardi ou mercredi matin)

1. **TTL du DNS : à faire en premier.** Il est encore à 3600 s (relevé le 17/11).
   - Chez OVH : Noms de domaine › memoryline.fr › Zone DNS. **Modifie** les deux lignes A existantes, `memoryline.fr` et `www`. Garde la cible `23.227.38.65` et mets un TTL personnalisé de **300**.
   - Contrôle depuis PowerShell : `nslookup -debug -type=A memoryline.fr. dns200.anycast.me` doit afficher `ttl = 300`. Les lignes REFUSED du début ne comptent pas.
   - **Attends au moins une heure** avant la bascule.
2. **Bordereaux SendCloud d'essai encore ouverts** : le mode « montrer » du script les liste (§ 3, étape 1). Annule chacun depuis la fiche de sa commande, « Annuler le bordereau ». Après le vidage, ils ne seraient plus annulables que sur le site de SendCloud.
3. **Au BO, ce que les clientes verraient** :
   - **Page du stand** (BO › Pages › mulhouse, id 10). Aujourd'hui elle s'appelle « TEST TOUT VOIR », elle est publique et elle est dans le plan du site et dans llms.txt.
     - Donne-lui un vrai titre.
     - Règle **« Où elle se montre »** (nouveau champ du 17/11) sur « Sur la tablette du stand seulement ».
     - Fais viser à son bloc la collection `marche-de-noel-mulhouse-2026`.
   - **Collection du marché** : elle n'apparaît pas dans `/api/collections` du VPS. Vérifie au BO › Collections qu'elle est **active**, non archivée, et que ses affiches sont en vente. Sinon, le bloc de la page reste VIDE, même sur la tablette. Une fois active, elle devient aussi un rayon public.
   - **Vidéo Tuto** : c'est encore la vidéo de test, Big Buck Bunny, sur toutes les fiches. BO › Contenu du site › « Personnalisation — vidéo explicative » : éteins le bouton tant que Margaux n'a pas la sienne.
   - **Pages légales** : 9 « À COMPLÉTER » sont visibles des clientes.
     - CGV : date, téléphone/RCS, médiateur. Le médiateur est **obligatoire** : à demander à Margaux.
     - Confidentialité (4), cookies (1), mentions (1).
     - Retire au moins les notes internes.
   - **Collection « Cuisine »** : elle ne contient qu'une affiche, Neuschwanstein, et l'ancienne adresse Shopify `/collections/cuisine` y mène. Désactive-la, ou retire l'affiche.
   - **Relance de panier** : regarde sa base légale. Éteins-la si Margaux n'a pas validé délai et texte.
   - Relis les promotions et les bandeaux. Archive le compte d'essai `vendeur@memoryline.fr`.
4. **Redirections Shopify** (10 min) : admin Shopify › Contenu › Menus › Redirections d'URL › **Exporter**. Puis BO › Boutique en ligne › Redirections › « Importer les redirections de Shopify ». Relis l'aperçu, puis Appliquer.
5. **Search Console** : ouvre search.google.com/search-console avec le compte de la boutique.
   - S'il n'y a pas de propriété : crée une propriété « Domaine » memoryline.fr et ajoute le TXT donné dans la zone OVH. C'est un TXT **de plus** : ne modifie pas le SPF.
6. **WEB-0016** : à rembourser quand le PayPal de Margaux aura une banque liée ou quelques euros de plus (voir A-FAIRE § 1). Ce n'est plus un préalable au vidage : le script la garde.
7. **Ne plus passer de commande d'essai sur le VPS.** C'est de l'argent réel.
8. **Les 15 affiches « prêtes à imprimer »** : soit Margaux ajoute leurs visuels HD, soit tu les passes en brouillon. Voir § 1, « BLOQUANT ».
9. **Sur la tablette du stand** : fais un essai à la main du geste « retour » pendant une personnalisation, sans valider de vente. Attendu : la fenêtre se ferme, et l'affiche est toujours là quand on rouvre.

---

## 3. La bascule, d'une seule traite (compter 1 h)

**Règle d'or** : entre l'édition du `.env` (étape 3) et le `up -d` (étape 7), ne lance **aucun** `mettre-en-ligne.sh`, **aucun** `docker compose up`, **aucun** vidage. Sinon le site et le BO de l'ancien nom cassent : connexions et formulaires sont refusés.

Toutes les commandes serveur se lancent dans `ssh debian@51.255.34.187`, puis `cd ~/memoryline`. Raccourci : `C="docker compose -f docker-compose.prod.yml"`.

**0. Dernière mise en ligne normale**, avec l'ancien `.env`. Elle a été faite le 17/11 par Claude (`9de3957`), avec le script corrigé. Refais-la seulement si de nouveaux commits sont arrivés depuis, avec la méthode habituelle (archive + `mettre-en-ligne.sh`).

**1. Vider les essais.**
```
ssh -t debian@51.255.34.187 "cd ~/memoryline && bash apps/api/scripts/vider-donnees-test.sh"
```
Lis le résultat :
- « Ventes RÉELLES gardées » doit afficher 1 (WEB-0016).
- Aucun bordereau ne doit rester ouvert (sinon, fais d'abord § 2, point 2).
- Les comptes, promotions et pages doivent être ceux que tu attends.

Puis :
```
ssh -t debian@51.255.34.187 "cd ~/memoryline && bash apps/api/scripts/vider-donnees-test.sh --vider"
```
Tape `VIDER`. Attendu :
- « Commandes d'essai restantes (attendu 0) » à 0 ;
- « Ventes réelles gardées » à 1 ;
- « Stands ouverts » à 0 ;
- puis « Terminé ».

Ensuite, **emporte la sauvegarde tout de suite**, depuis PowerShell sur le PC (le script affiche la commande exacte) :
```
scp debian@51.255.34.187:~/memoryline/sauvegardes/base/<jour>-avant-vidage.sql.gz .
```

**2. Préparer le retour arrière** (sur le serveur) :
```
cd ~/memoryline && cp -p .env .env.avant-domaine
C="docker compose -f docker-compose.prod.yml"; for s in api web admin; do docker tag "$($C images -q $s | head -1)" secours-$s:avant-domaine; done
df -h / ; ls maintenance/
```
Il faut quelques Go libres, et pas de fichier `ACTIVE` dans `maintenance/`. N'efface `.env.avant-domaine` qu'à J+7 : il contient les secrets.

**3. Éditer le `.env`** (`nano .env`). Quatre lignes, sans guillemets :
```
DOMAINE=memoryline.fr
DOMAINE_WWW=www.memoryline.fr vps-5c917e9d.vps.ovh.net
PUBLIC_ORIGIN=https://memoryline.fr
PUBLIC_NOINDEX=false
```
- `DOMAINE_WWW` contient deux noms séparés par un espace. Caddy garde ainsi l'ancien nom, et le renvoie en 301 vers memoryline.fr : favoris, liens des courriels déjà partis, lien de la tablette.
- `PUBLIC_NOINDEX=false` doit être **écrit**. Une ligne absente vaut `true`, et le site entier resterait en « Disallow » pour Google.

Contrôle :
```
grep -E '^(DOMAINE|DOMAINE_WWW|PUBLIC_ORIGIN|PUBLIC_NOINDEX)=' .env
```

**4. Construire sans rien remplacer.** Les conteneurs en service continuent de tourner pendant la construction :
```
docker compose -f docker-compose.prod.yml build
```
Si la construction échoue, rien n'est cassé : `cp -p .env.avant-domaine .env`, puis regarde l'erreur.

**5. DNS chez OVH.** Fais d'abord une copie d'écran de la zone. **Modifie** la cible des deux lignes A, `memoryline.fr` et `www` : remplace `23.227.38.65` par `51.255.34.187`.
- Ne supprime rien et n'ajoute rien : **pas de AAAA**, pas de CNAME pour www, pas de redirection OVH.
- Ne touche à aucune autre ligne : NS, MX ×3, les deux TXT, `send`, `rsend`, `resend._domainkey`, `_dmarc`.

**6. Attendre que le DNS réponde le nouveau serveur**, depuis PowerShell :
```
nslookup memoryline.fr. dns200.anycast.me
```
```
nslookup www.memoryline.fr. ns200.anycast.me
```
Les deux doivent répondre `51.255.34.187`, et seulement celle-là.

**7. Remplacer les conteneurs** (sur le serveur) :
```
cd ~/memoryline && docker compose -f docker-compose.prod.yml up -d && docker compose -f docker-compose.prod.yml ps
```
La base PostgreSQL redémarre aussi quelques secondes, car elle lit le `.env`. C'est normal, les données sont dans le volume. **Ne jamais faire `down -v`.**

Ensuite, vérifie : `ls maintenance/` ne doit pas montrer `ACTIVE`.

**8. Certificats** :
```
docker compose -f docker-compose.prod.yml logs --since 5m proxy | grep -iE 'certificate obtained|challenge failed|could not get certificate'
```
Tu dois voir « certificate obtained » pour memoryline.fr et pour www. Si Caddy est parti avant le DNS : `docker compose -f docker-compose.prod.yml restart proxy`. **Ne jamais supprimer le volume `caddy_data`.**

**9. Webhook Stripe : tout de suite.** Les clientes paient déjà en réel.
- Stripe (mode Live) › Développeurs › Webhooks › ouvre le point de terminaison existant › modifie l'URL en `https://memoryline.fr/api/payments/stripe/webhook`. Le secret `whsec_` ne change pas : rien à ressaisir.
- Puis BO (sur `https://memoryline.fr/bo/`) › Réglages › Paiements › « Vérifier » Stripe Production. Attendu : « Webhook trouvé ».
- Si l'URL ne se modifie pas : crée un nouveau point, événement `payment_intent.succeeded`, colle son `whsec_` au BO, puis supprime l'ancien.
- Plus tard dans Stripe : vérifie que les avis en échec pendant la bascule ont été rejoués.

**10. Vérifications** (PowerShell ou navigateur) :
- `https://memoryline.fr/robots.txt` affiche `Allow: /` et `Sitemap: https://memoryline.fr/sitemap.xml` ;
- une fiche affiche `index, follow` dans le code source ;
- `https://www.memoryline.fr/` et `https://vps-5c917e9d.vps.ovh.net/` renvoient en 301 vers `https://memoryline.fr/` ;
- `https://memoryline.fr/api/shipping` répond, et `https://memoryline.fr/bo/` s'ouvre ;
- `https://memoryline.fr/pages/mulhouse` répond 404 hors stand ;
- les anciennes adresses : `node apps/web/scripts/verifier-anciennes-adresses.mjs https://memoryline.fr` (depuis le dépôt, sur le PC). Attendu : « Aucun problème ».

**11. Le stand, pour jeudi.** Le vidage l'a fermé, et l'ancien lien de tablette ne marche plus.
1. Connecte-toi au BO sur **https://memoryline.fr/bo/**. Toutes les sessions sont effacées, et les mots de passe enregistrés le sont pour l'ancien nom.
2. BO › Ventes stand › « Marché de Noël Mulhouse » › **« Nouveau code »** › **« Ouvrir le stand »**.
3. Sur la tablette :
   - ferme tous les onglets de l'ancien nom ;
   - ouvre l'adresse affichée par le BO, `https://memoryline.fr/?stand=1&code=…` ;
   - **garde ce lien complet hors du navigateur** (note, message). La page retire `code=` de la barre d'adresse : un favori posé ensuite ne marche pas.
4. **Rouvre ce lien chaque matin de marché** : le mode stand ne dure que 24 h.
5. Contrôle sans vente : mène une affiche jusqu'à l'étape nom et courriel, **sans valider**. Une vente validée serait réelle (SAL-0001 et un vrai courriel).

**12. Google** : Search Console › Sitemaps › `https://memoryline.fr/sitemap.xml`, puis Paramètres › robots.txt › « Demander une nouvelle exploration ».

**Après** :
- dans Stripe (Live) › Payment method domains, déclare `memoryline.fr` : sans cela, pas de bouton Apple Pay ni Google Pay, mais la carte marche ;
- remets le TTL à 3600 à J+7 ;
- **ne détache pas** le domaine dans Shopify avant J+7, puis active le mot de passe de la boutique Shopify (Boutique en ligne › Préférences), pour qu'elle ne fasse pas doublon ;
- **ne relance jamais** `vider-donnees-test.sh` : il refuse de toute façon, grâce à la marque.

### Retour arrière (si le site ne marche pas sur memoryline.fr)

Il ne défait ni le vidage ni les vraies commandes prises entre-temps. Passé la première vraie commande sur memoryline.fr, on répare en avant.
1. Chez OVH, les deux A reviennent à `23.227.38.65`, donc à Shopify.
2. Sur le serveur :
   ```
   cd ~/memoryline && cp -p .env.avant-domaine .env && docker compose -f docker-compose.prod.yml build && docker compose -f docker-compose.prod.yml up -d
   ```
3. Dans Stripe, remets l'URL du webhook sur `https://vps-5c917e9d.vps.ovh.net/api/payments/stripe/webhook`.
4. La tablette repasse par le lien affiché par le BO.

L'interrupteur « La boutique encaisse » n'a pas à bouger. **Ne le repasse pas en essai** : le retour en réel exige une vérification du webhook à l'adresse du moment.

---

## 4. Bon à savoir (relevé le 17/11)

- **Zone DNS** : les seules lignes Shopify sont les deux A, `23.227.38.65` en TTL 3600. Les autres lignes (MX OVH, SPF, Resend, `_dmarc`) ne bougent pas. Il n'y a ni AAAA, ni CAA, ni DNSSEC gênant.
- **Les courriels réels partent depuis le 16/11** à 22 h 29. Des relances de panier ont pu partir vers des adresses d'essai qui avaient coché la case marketing. Pour voir ce qui est parti : `docker compose -f docker-compose.prod.yml logs api --since 2026-11-16T21:00:00 | grep '\[relance\]'`, ou Resend › Emails.
- **Les anciennes adresses Shopify** (216 relevées le 17/11, 224 essayées) sont toutes redirigées, sans erreur. Les liens `/discount/<CODE>` de Shopify mènent à l'accueil sans appliquer le code.
- `MISE-EN-PROD.md` § 6 a raison : **ne pas importer** les fichiers SEO de Shopify. La ligne « La veille » du Jour J disait le contraire ; elle est corrigée.
- Un `~/.env` parasite traîne dans `/home/debian`, avec une ligne MAIL_FROM : `rm ~/.env`. Ce n'est pas celui de `~/memoryline`.
