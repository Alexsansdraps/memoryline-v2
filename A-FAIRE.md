# À faire — Memory Line (à jour le 21/11)

Fichier de reprise, à lire en premier. **`main` fait foi** : la prod est toujours une mise en ligne de `main`. Le détail de chaque travail passé est dans `git log` et dans les commentaires du code. Ce fichier ne garde que l'état utile et ce qui RESTE. Ce que Margaux doit faire de son côté, elle le sait : ce n'est pas suivi ici.

## 0. État au 21/11, 6 h : tout `main` est en ligne

### 0.1 En ligne
- **Tout `main` jusqu'à `4b6889d`**, mis en ligne le 21/11 à 5 h 54, marché fermé (aucune commande, création IA ni panier en cours depuis la veille au soir). Pas de migration : la prod reste à 0112.
  - `4b6889d` : les restes du matin (voir 0.2), demandés par Alexandra (« finis tout », « met en prod »).
  - Vérifié après : pages du site et du stand 200, pages du BO qui renvoient vers la connexion, `/api/health` répond, base comprise. Le code servi porte le correctif de la fenêtre, et les journaux de l'API, du site et du BO n'ont aucune erreur. Le BO a été reconstruit cette fois.
- **Mise en ligne de 3 h 16** : tout `main` jusqu'à `0819969`, marché fermé, depuis la dernière vente du stand (SAL-0012, 20/11 à 20 h 25).
- **Ce qu'elle a ajouté** :
  - `0819969` : **personnages et muret sur l'affiche « à partir de votre photo »**, au site et sur la tablette. Le détail est dans le message du commit et dans `docs/plan-personnages-affiches-photo.md`.
    - **Choix faits par défaut, gardés tels quels** (21/11 : Alexandra n'a rien demandé de changer, « finis tout ») :
      - pas de supplément de prix ;
      - un seul muret, celui du type d'affiche « De dos » (à défaut `muret_officiel.svg`) ;
      - deux boutons : « Assis sur le muret » (vus de dos) d'abord, puis « Debout, de face » (sans muret) ;
      - portrait seulement, placement automatique ;
      - les personnages suivent « Générer une autre version ».
    - Sans personnage, la ligne de panier est celle d'avant, au caractère près (vérifié contre HEAD).
    - Le serveur contrôle les lignes avec personnages (`ia-composition.ts`) et ne touche à aucune autre. L'empreinte d'impression n'a pas bougé : aucune réimpression.
    - Aussi : `GET /backgrounds` ne propose plus le décor d'une fiche en BROUILLON. Même règle à l'écran « Décors des affiches » et pour les affiches de démo.
    - Aussi : `mettre-en-ligne.sh` échoue (code 1, fin du journal du service, dernière ligne « le site est EN PANNE ») quand le site ou l'API ne répondent toujours pas après une minute et demie.
  - `8afd173` : la facture d'une fiche commande ne se NUMÉROTE plus depuis un lien venu d'ailleurs (garde `Sec-Fetch-Site`, comme pour le ZIP). Une facture déjà numérotée se rouvre d'où que ce soit.
- **Vérifié avant la mise en ligne de 3 h 16** :
  - tsc de l'API, du module et du site (seulement les 3 erreurs anciennes de StandSalon) ;
  - tests de l'API : 504 réussis, 0 échec ;
  - construction de production du site ;
  - bancs navigateur : module classique identique à HEAD, parcours avec personnages au site et au stand ;
  - relecture indépendante en 5 angles : aucun constat bloquant ni important ; les 2 mineurs sont corrigés.
- **Vérifié après la mise en ligne de 3 h 16** :
  - le script a fini par « Mise en ligne terminée » (code 0), avec la sauvegarde faite avant, et son nouveau contrôle a vu le site et l'API répondre ;
  - pages : l'accueil, `/affiches`, l'affiche photo (site et `?stand=1`), une affiche classique et `/commande` répondent 200 ; `/panier` renvoie vers `/commande` (302), comme avant ;
  - API : `/health` répond, base comprise. `/views` donne le muret du type « De dos » (`/assets/muret_officiel.svg`). `/backgrounds` rend 250 décors comme avant (aucune fiche en brouillon n'en a), et 1 pour l'affiche n° 1 ;
  - le morceau PersonnagesIA est servi (200), et AfficheIA pèse 46,8 Ko, comme la construction locale ;
  - sans session, l'admin et `facture.pdf` répondent 401 ; les `frame-ancestors` n'ont pas changé ;
  - les journaux de l'API et du site depuis le redémarrage ne montrent aucune erreur ;
  - **pas fait** : un ajout au panier avec personnages en prod. Le contrôle de sécurité de Claude a refusé l'appel, alors même qu'il devait être refusé par le serveur sans rien écrire. C'est le premier essai sur la tablette qui le fera.
- **À vérifier par Alexandra avant l'ouverture du marché** (Claude n'a pas de session au BO) :
  - **BO** : Créer des fonds s'ouvre ; les deux boutons d'Affiches IA ; « Factures » dans Ventes stand ; « Éditer la facture » sur une fiche commande (le bouton doit toujours marcher) ;
  - **sur la tablette** : une affiche à partir d'une photo avec « Assis sur le muret » et 1 ou 2 personnages, jusqu'au panier du stand, sans valider la vente ; regarder la vignette. Toucher aussi la zone de dépôt de la photo : la fenêtre ne doit plus sauter ;
  - **première vraie commande avec personnages** : ouvrir son PDF au BO, et vérifier le muret et les personnages.

### 0.1 bis Mise en ligne précédente
- **Tout `main` jusqu'à `4eaf9d2`**, mis en ligne le 20/11 à 22 h 35, marché fermé.
  - Migrations 0111 et 0112 passées.
  - Proxy relancé pour le nouveau `Caddyfile.prod` : `frame-ancestors 'none'` partout, `'self'` sur `/atelier-affiche` (vérifié).
- **Ce que ça a ajouté** :
  - `91e47bd` : dans Ventes stand, les boutons « Factures » (ZIP) et « Ces commandes sont des tests ».
  - `0024f71` : sur les affiches de démo, la peau va au groupe « Peau ».
  - `1ad2c31` : BO › Atelier › **Créer des fonds** (nommé « Créer un fond » jusqu'au 20/11 au soir), et dans BO › Affiches IA, « Créer une fiche produit » et « Créer une affiche ».
  - `4eaf9d2` : les corrections de la relecture.
    - La date d'une vente du stand est celle de sa DERNIÈRE validation. La migration 0112 corrige les ventes déjà faites ; SAL-0006 avait déjà été corrigée à la main.
    - Factures en ZIP, numéros :
      - seules les ventes payées reçoivent un numéro ;
      - la règle est relue sur la commande verrouillée au moment de numéroter ;
      - les autres ventes sont citées dans `factures-non-faites.txt`.
    - Factures en ZIP, téléchargement :
      - une facture en japonais ou en chinois sort en anglais, sans erreur 500 ni mention vide ;
      - le GET n'est accepté qu'avec `Sec-Fetch-Site: same-origin` (le bouton du BO télécharge par fetch) ;
      - une vente facturée ne se rouvre plus à la tablette.
    - Créer des fonds :
      - les fonds ont leur propre plafond (`ia.fondPlafondMensuelCents` ; vide, il vaut la moitié de celui des affiches) : un lot ne coupe jamais les affiches des clients ;
      - le coût d'une version est réservé dès son lancement ;
      - le fil rappelé au modèle se limite à la lignée de la version de départ.
- **Vérifié** : le site, l'API, les tables des fonds, 0 erreur dans les journaux de l'API.
- **Pas vérifié au BO**, faute de session dans le navigateur de Claude :
  - Créer des fonds s'ouvre ;
  - les deux boutons d'Affiches IA s'affichent ;
  - « Factures » apparaît dans Ventes stand.

### 0.2 Restes
**Faits le 21/11 au matin** (commit et mise en ligne : voir 0.1) :
- **Fenêtre de l'affiche photo** : elle ne défile plus, et la croix reste visible.
  - Le champ fichier masqué se rangeait par rapport au fond grisé : jusqu'à plus de 800 px de défilement sur téléphone, et environ 60 px sur la tablette du stand en touchant la zone de dépôt, dès quatre styles.
  - Vérifié à 390, 768 et 1280 px, au site et au stand : rien d'autre ne bouge, et le corps du POST est identique.
- **Types du BO** : `plafondFonds` (catalogue des fonds) et `fonds` (stats IA) sont dans `apps/admin/src/lib/api.ts`, et les pages ne les retypent plus (`astro check` du BO : 0 erreur).
- **Numéros de ligne** à jour dans les commentaires d'`affiches-demo-tirage.ts`.
- **Tests sur base** : ils tournent pour de vrai, sur une base JETABLE (recette ci-dessous).
  - Nouveau `apps/api/tests/fonds-ia-base.test.ts` : séparation des dépenses affiches / fonds, coût réservé dès le lancement et sous le verrou, deux lancements simultanés dont un seul passe, plafond des fonds vide = moitié. La route des lots, qui recopie le verrou, n'y est pas couverte.
  - Les 4 fichiers protégés ensemble : 52 tests sur 52 ; aucune ligne de test restante.
- **Banc de recette des personnages** (`apps/web/.harnais-persos/`, exclu de git) : son lanceur sait de nouveau monter la version commitée.
  - On le lance par l'entrée « harnais-persos » de `memory-line/.claude/launch.json`, ou par `node apps/web/.harnais-persos/demarrer.mjs` (port 5199).

**Laissés exprès** (« touche pas aux commandes ») :
- à la caisse, la phrase d'un refus s'affiche dans la zone d'erreur générale, loin de la ligne, comme les autres erreurs de ligne ;
- une génération ajoutée depuis un AUTRE panier (nouvel essai « panier_clos ») ne reçoit pas `paidAt` au paiement. C'était déjà le cas avant : le corriger toucherait au paiement.

**À juger, pas du code** :
- « Debout, de face » : les personnages peuvent sembler flotter sur certaines photos ;
- avec des personnages, le grand aperçu recadre l'image (environ 6 % de la hauteur), comme l'impression ;
- pas encore testés : Safari et la vraie tablette ;
- clé OpenAI partagée par les fonds et les affiches des clients : lancer les gros lots de fonds hors des heures du marché.

**Environnement local** (pas la prod) :
- La pile Docker locale travaille sur une base Neon HÉBERGÉE (`DATABASE_URL` du `.env`), pas sur le conteneur `memoryline-db`.
  - Cette base a des migrations de retard (au moins 0092 et 0100) : sur `localhost:8080`, la lecture d'un panier répond 500, et la tâche des stands échoue chaque minute.
  - À décider par Alexandra : la mettre à jour, ou faire pointer la pile locale sur `memoryline-db`.
- `memoryline-db` est resté à 9 migrations (juillet) : n'y rien lire.
- Recette des tests sur base, sans toucher ni au `.env` ni à la pile (Git Bash, racine du dépôt) :
  ```
  URL=$(grep -oE 'postgres://memoryline:[^@"]+@db:5432/memoryline' docker-compose.yml)_essais
  docker exec memoryline-db createdb -U memoryline memoryline_essais
  docker exec -e DATABASE_URL="$URL" memoryline-api sh -c 'case "$DATABASE_URL" in *@db:5432/memoryline_essais) echo LOCALE;; *) echo AUTRE;; esac'
  MSYS_NO_PATHCONV=1 docker exec -e DATABASE_URL="$URL" -w /app/apps/api memoryline-api sh -c 'npx tsx src/db/migrate.ts'
  MSYS_NO_PATHCONV=1 docker exec -e DATABASE_URL="$URL" -w /app/apps/api memoryline-api sh -c 'npx tsx --test tests/fonds-ia-base.test.ts tests/factures-zip.test.ts tests/cartes-cadeaux-caisse.test.ts tests/ia-composition.test.ts'
  docker exec memoryline-db dropdb -U memoryline memoryline_essais
  ```
  - La troisième commande doit répondre LOCALE avant d'aller plus loin. La garde des tests (`@db:5432/` et NODE_ENV) ne les laisse jamais tourner sur Neon ni en production.

### 0.3 Décidé, et encore à décider
- **Décidé le 21/11** (Alexandra : « touche pas aux commandes ») : **on ne touche à aucune commande**, ni à leurs données, ni à leur logique, ni à la caisse.
  - **SAL-0006** : validée à 11 h 32 (29 €), rouverte à 11 h 37, jamais revalidée, puis revalidée à 20 h 03 pour un autre client (35 €). La vente du matin reste hors des comptes, et une vente rouverte NE se referme PAS d'elle-même.
  - Écartées pour la même raison : garder une trace de chaque suppression de vente ; n'autoriser la suppression d'une vente payée que si elle est annulée ou en test.
- **Encore à décider** (interface, pas les commandes) :
  - pas de bandeau cookies sur la tablette ;
  - en-tête compact sous 1280 px.

### 0.4 Personnages sur l'affiche photo : FAIT et en ligne (21/11)
Voir 0.1 : les choix faits par défaut (prix, muret, boutons) sont gardés. Pour les changer plus tard :
- Changer les boutons ne touche que le site (AfficheIA, PersonnagesIA).
- Un autre muret doit être celui d'un type d'affiche ou de la fiche, sinon le serveur le retire (`ia-composition.ts`, décors permis).
- Un supplément de prix demanderait aussi le serveur, qui calcule le prix de la ligne (`resolvePrixLigne`).

### 0.5 Après la mise en ligne
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

### 0.6 Restés ouverts
- **Chiffres dans le PDF** : « ça met erreur, uniquement au téléchargement du PDF, pas avec toutes les polices ».
  - Pas reproduit en local : 100 rendus (10 polices × 5 formes de lignes), en aperçu et en PDF.
  - Les journaux de l'API de prod se perdent à chaque mise en ligne. Il faut refaire le téléchargement qui échoue, PUIS lire les journaux (accord d'Alexandra donné) avec le numéro de la commande.
- **Ventes du stand disparues** : SAL-0001, 0002, 0003, 0004 et 0007 ont été SUPPRIMÉES définitivement entre 10 h 50 et 15 h 16, sans trace de qui.
  - SAL-0001 était la vente d'essai, supprimée à la demande d'Alexandra.
  - Pour les autres, à voir avec Margaux. Si c'étaient de vraies ventes : SAL-0002 et 0003 se restaurent (sauvegarde « avant-restauration » de 10 h) ; SAL-0004 et 0007 sont perdues.

## 1. Où on en est

- **19/11, vers 19 h : ventes du stand payées et terminées dès la validation à la tablette** (`3ec85e6`, `5f2730b`, en ligne).
  - **À la tablette** : écriture « stand » au grand livre, plus une remise complète. Le PDF se télécharge tout de suite et il n'y a plus de « Marquer payée ».
  - **Annulation** : depuis la fiche ou la ligne de Ventes stand, avec un motif. Pas de courriel ; l'encaissement passe « annule », puis une écriture « void ».
  - **Suppression définitive sans archiver** : une vente de la tablette part même payée. Elle reste gardée si elle a une facture ou une étiquette SendCloud active.
  - **Restent toujours gardées** : les reprises Shopify `SHOP-` et les commandes du site payées, ainsi que celles dont le paiement en ligne est ouvert depuis moins de 48 h.
  - **Onglets du stand** : « Toutes » et « Annulées ».
  - **« Revenir à ma commande »** : 15 minutes, stand ouvert, avec confirmation sur la flèche retour. Retiré puis remis le 20/11 (Margaux le garde) ; le bouton « Client suivant » s'appelle désormais « Terminé ».
  - **Relecture adverse faite**, ses constats corrigés.
- **19/11, vers 18 h 15 : la tablette des stands est le site entier** (`745eb10`, en ligne). Elle affiche le menu complet avec la page du stand en tête, la recherche, le pied de page, la bannière d'annonce et les bandeaux visuels. **Seules différences : pas de prix, la caisse du stand, et les cadres toujours proposés.** L'accueil de la tablette (`/?stand=1`) mène à la page du stand : c'est là que revient l'application de Margaux, qui recharge la page toutes les 10 minutes. Sur tablette, il y a 4 affiches par ligne dans toutes les grilles. Le compte client et la vente de cartes cadeaux restent absents au stand (ils dépendent de la caisse du site). Remplace le verrou « la tablette n'affiche que sa page » du 18/11. Vers 18 h 20 (`eaac392`) : plus de bande « ● Mode stand » en haut de la tablette ; « Stand fermé » reste, seulement quand le stand est fermé. La carte cadeau reste au menu du stand (Alexandra : « non enlève pas »).
- **memoryline.fr est servi par le VPS** (OVH, `debian@51.255.34.187`) depuis la bascule du 17/11. www, http et l'ancien nom `vps-5c917e9d.vps.ovh.net` redirigent vers https://memoryline.fr.
- **La boutique encaisse pour de vrai depuis le 16/11 à 22 h 29.** Stripe live (compte « Vestiairesauvage »), PayPal live, vrais courriels par Resend (`commandes@memoryline.fr`), bordereaux SendCloud facturés. **Aucune commande d'essai sur le VPS : c'est de l'argent réel.**
- **Marché de Noël de Mulhouse : du vendredi 20/11 au 27/12** (11:00–12:30 / 13:00–20:00).
- 18/11 : tous les écrans clients contrôlés en ligne sur tablette (768 × 1024 et 1024 × 768, 16 pages) : rien ne déborde, aucune image cassée.
- **Mise en ligne seulement sur le feu vert d'Alexandra** (18/11 : « je veux pas perturber Margaux »).
- **Le code « Continuer avec Google » est RANGÉ hors de `main`** (18/11, Alexandra : « go prod tout sauf le truc google »). Il a été écrit dans le commit `15256b4`, puis retiré par le revert `4748977`. `main` reste donc égal à la prod. Pour le remettre le jour venu : `git revert 4748977`.
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
  - la caisse montre le formulaire à toutes ; en haut, « Me connecter ou continuer en tant qu'invité » (mot pour mot, demandé par Alexandra ; seul « Me connecter » est un lien) ;
  - le serveur rattache la commande à la fiche qui porte l'e-mail, ou en crée une : jamais une fiche par achat ;
  - une invitée n'a pas de carnet : sa facturation est l'adresse saisie ;
  - une commande à 0 € se valide avec la preuve du panier (`cartId`) ;
  - l'ancien rangement systématique de l'adresse dans le carnet, après la caisse, est retiré : il ignorait la case « Garder… » et rangeait l'adresse d'une invitée chez la fiche du même e-mail.
- **18/11, vers 12 h 45, suppressions au BO** :
  - **Commandes et ventes du stand, onglet « Archivées »** : « Supprimer définitivement » par sélection. Les règles sont celles de la fiche (`motifCommandeAGarder`) : ce qui a été payé, facturé, remboursé, encaissé, expédié ou réglé en carte cadeau reste archivé, et le message dit pourquoi.
  - **Clients** : « Supprimer définitivement » par sélection (`POST /admin/customers/supprimer`). Une fiche qui a une commande payée ou facturée est gardée et nommée. Les autres partent avec leurs adresses, sessions et jetons ; leurs paniers et commandes jamais payées restent, détachés d'elles.
- **18/11, après-midi** :
  - **Les clients au masculin** : plus de « clientes » ni de « la cliente » dans le BO, les messages de l'API qu'il affiche, le motif d'annulation (« Demande du client ») et l'export (`clients.csv`).
  - **Catalogue traduit en anglais, allemand, italien et espagnol** (migration 0094, faite à partir du site en ligne le 18/11) : les 8 catégories de personnages, les 70 personnages, les 3 cadres et les 257 fiches actives (nom court, description, et titre et description Google quand la fiche en a). Les titres des affiches prêtes à imprimer restent en français : c'est le texte imprimé sur l'affiche. Rien n'est écrasé : ce que Margaux avait déjà traduit reste. Une ligne dont le nom ou la description française a changé avant la mise en ligne est laissée telle quelle. Margaux relit dans le BO ; les fiches créées après le 18/11 se traduisent à la main.
  - Fautes repérées dans le français, à corriger par Margaux : « Segrada familia » (écrit « Sagrada Família » dans les traductions), « Montage neige » (pour « Montagne »), « Aslace », « Epagnol ».
  - **Clients suisses** : hors de l'Union européenne (Suisse, Royaume-Uni…), la caisse ne propose plus de point relais, puisqu'aucun réseau n'y livre (0 point trouvé à Bâle). Il reste l'envoi à domicile (douane déclarée sur l'étiquette SendCloud) et le retrait au stand (`passeLaDouane`, packages/types).
  - **Restes de français dans les 4 langues** (migration 0095, relevé page par page du site en ligne) : les 10 rayons (« Thèmes & paysages »…), les 4 modes de livraison, le lieu du marché de Noël, la promotion « 3 achetées = 1 A4 offerte », « TOUT VOIR » dans le menu, et les 4 pages légales. Chaque page légale traduite commence par un avertissement : la version française fait foi.
  - ⚠ Les pages légales contiennent encore des « À COMPLÉTER » (médiateur, durées de conservation), traduits tels quels. Le jour où Margaux les complète en français, il faut aussi mettre à jour les traductions.
- **18/11, fin d'après-midi, japonais et chinois simplifié** (touristes du marché de Noël ; Alexandra a choisi « l'interface d'abord ») :
  - **Fait** :
    - les 639 textes du site, les 175 textes des e-mails, la page contact, les horaires du stand et la page de désinscription des relances ;
    - sélecteur à 7 langues ; le Japon et la Chine dans la liste des pays, avec leur code postal ;
    - libellés de la base (migration 0096) : menu, rayons, catégories et personnages du module, cadres, livraison, promotion, bandeau ;
    - la traduction automatique du BO couvre aussi ja et zh.
  - **Repli** : un texte qui manque en japonais ou en chinois s'affiche en anglais, puis en français (`LANGUE_REPLI` dans ui.ts, `traductionDe` dans traductions.ts, `tc` pour les e-mails).
  - **Factures** : celle d'un client japonais ou chinois sort en anglais, car les polices standard du PDF n'ont pas les caractères.
  - **Reste à faire** :
    - les 257 fiches et les 4 pages légales en japonais et en chinois (même méthode que la 0094) ;
    - la recherche dans ces langues ;
    - un texte japonais ou chinois tapé SUR une affiche : les polices d'impression n'ont pas ces caractères.
- **18/11** : « TOUT VOIR » en double dans le menu du haut : l'entrée de premier niveau est masquée (migration 0097), celle du menu déroulant reste.
- **18/11, soir** :
  - les 257 fiches existent maintenant en japonais et en chinois (migration 0099) ;
  - les pages légales sont traduites bloc pour bloc avec le français (migration 0098, correctif de la 0095).
- **18/11, soir, une page par stand** (migrations 0100 et 0101, packages/types/src/tablette-stand.ts) :
  - **Réglage dans BO › Ventes stand** : chaque stand a UNE page, choisie dans « Page de la tablette » (`stand.page_id`), avec un lien pour choisir ses affiches. Un avertissement apparaît si le stand n'a pas de page, ou si sa page n'est pas en ligne.
  - **Adresse de la tablette** : `?stand=` porte maintenant le NUMÉRO du stand ; le 1 est le marché de Noël de Mulhouse. L'aperçu depuis le BO utilise `?stand=apercu`.
  - **Ce que montre la tablette** : seulement sa page. L'accueil, le catalogue, la recherche, le compte, la carte cadeau, le contact et les pages légales y ramènent. Restent ouverts : la fiche d'une affiche de la page, le panier et la vente. Sur la page, le client cherche par nom ou lieu, et filtre par lieu ou par collection.
  - **BO › Pages › [page]** :
    - un tableau de toutes les affiches, avec recherche et filtres (collection, genre, dans la page ou non) ;
    - on coche une affiche, tout ce qui est filtré, ou une collection entière ;
    - l'ordre se règle par glisser-déposer (flèches sur écran tactile), avec des tris rapides ;
    - un mode « groupées par collection » ;
    - un plafond de 200 affiches.
  - **Page /mulhouse** : 64 affiches d'Alsace, Mulhouse en tête, posées par la 0101 si la page n'avait pas encore de grille. Laissées dehors : Bâle, Fribourg, La Bresse-Hohneck, les Vosges, Metz, Nancy.
  - **Correctif au passage** : enregistrer une traduction de page dans le BO effaçait sa grille d'affiches. Ce n'est plus le cas.

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
- **Affiches de démonstration (20/11), avant de tirer le lot du marché** : l'outil n'est pas encore en ligne (migration `0110_affiches_demo`, mise en ligne sur le feu vert d'Alexandra). Puis, dans le BO de la prod (constats faits sur les données locales, la prod peut différer) :
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
- Ne jamais commiter `.env`, `data/`, `sauvegardes/`, les polices AnotherShabby, ni `.claude/launch.json`.
- Ne plus jamais lancer `vider-donnees-test.sh`.
- Pas de branche de travail : tout va dans `main`, et ce qui reste à faire va dans ce fichier.
- On archive d'abord. La suppression définitive ne vaut que pour un élément déjà archivé (`apps/api/src/suppression.ts`). Une commande payée ou facturée n'est jamais supprimée.
- Textes pour Margaux au tutoiement, BO au vouvoiement, textes du site dans `apps/web/src/i18n/ui.ts` en 5 langues.
- Sous Windows, les antislashs sont mangés dans `node -e '…'` et dans certains heredocs : écrire le code dans un fichier.
- Des commentaires du code citent `AUDIT-SEO.md` (repères CNT-3, VIT-2…) ou `MISE-EN-PROD.md`. Ces fichiers ont été supprimés le 18/11 ; on les relit dans l'historique : `git show 1fdff55:AUDIT-SEO.md`.
