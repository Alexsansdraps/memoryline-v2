# À faire — reprise du 7 octobre

Fichier de reprise : à supprimer quand tout est fait.

## En ligne (archive du commit 75dcade)
Bulle « Vidéo tuto », check-list `MISE-EN-PROD.md`, script `apps/api/scripts/vider-donnees-test.sh`.

## Fait le 6 au soir, poussé sur `main` — PAS encore en ligne

- **Sommaire « Personnaliser : Peau · Vêtements… » retiré** de l'éditeur de personnage : composant, outils de défilement qui ne servaient qu'à lui (`Defilement.tsx`), textes des 5 langues, CSS. Vérifié à 375 px : l'aperçu est centré dans son bandeau, rien ne déborde.
- **Module : les couleurs « au hasard »** (retour d'Alexandra). Elles passaient d'une pièce à l'autre par numéro de zone, alors que `st0` est le corps d'un t-shirt ici et son col là : un t-shirt vert s'affichait rose parce qu'on avait regardé un rose avant lui, galerie comprise.
  - Désormais, chaque pièce arrive avec les couleurs de son dessin.
  - Seule une couleur vraiment choisie par le client passe sur la couleur principale de la pièce suivante, ombres de même teinte comprises. On garde ainsi sa couleur de cheveux en changeant de coupe.
  - Les vignettes de la galerie montrent ce qu'on obtient en les touchant.
  - Code : `couleursAuChangementDePiece`, dans `packages/configurator/src/store.ts`. Vérifié dans le module.
- **BO : l'écran des couleurs est refait** (`GroupesCouleurs.astro`, `ApercusZones.astro`).
  - Une phrase d'abord : « Le client pourra changer : … ».
  - Puis une ligne par couleur : la pastille, une vignette dans la VRAIE couleur cernée d'un trait (plus de rouge, qui faisait passer une marinière bleu nuit pour un t-shirt rouge), le nom lu par le client, la case « Le client peut la changer ». Pour un personnage, s'y ajoutent ses « Pastilles ».
  - Le reste est replié sous « Réglages avancés » : couleur de départ, teintes réunies, « Suit la couleur de… » (l'ancien « Rattacher à… »), « Relire le dessin » (l'ancien « Détecter les couleurs ») et un nouveau bouton « Remettre les couleurs du dessin ».
  - L'aide du BO et les textes des pages sont à jour. « (9 couleurs) » a disparu des menus de catégorie : ce 9 était la taille du nuancier, pas le nombre de couleurs du dessin.
- Deux lignes parasites `</content>` `</invoke>` retirées à la fin de `apps/admin/src/pages/personnages.astro`.

## À regarder après ça
- **Pièce n° 329** (« Clothes 1 », la marinière) : dans la base de dev, ses rayures sont noires au lieu du bleu nuit du dessin (#123546). C'est la suite d'essais dans l'ancien écran. Pour réparer : bouton « Remettre les couleurs du dessin », dans ses réglages avancés.
- **Base de dev** : les 4 catégories de pièces sont sur « toutes les couleurs », alors que la migration 0066 les avait passées sur « seulement la principale ». Quelqu'un les a remises depuis le BO. Sous « toutes », chaque ombre est une rangée à part et ne suit pas la couleur choisie : on obtient un t-shirt jaune à ombres vert foncé. À trancher dans BO › Catégories de pièces.
- Montrer le nouvel écran des couleurs à Margaux.

## Pas encore fait

1. **Recherche du BO « méga puissante »** : elle doit tout trouver (noms, numéros, un bout de texte n'importe où, écrans et libellés du BO) et emmener à l'endroit exact, surligné. « bandeau » ne trouvait pas « Bandeaux visuels », parce que la liste `ECRANS` de `apps/api/src/recherche.ts` est écrite à la main et en retard. Un chantier tourne sur le PC du bureau : il sera poussé sur la branche **`chantier-recherche-seo`**, à relire puis fusionner. Au 7/10, cette branche n'est pas encore sur GitHub.
2. **SEO** : l'audit complet est fait, le site n'est pas prêt à remplacer Shopify. Les corrections tournent sur le PC du bureau et iront sur la même branche `chantier-recherche-seo`. Elles couvrent :
   - le plan du site vide en prod ;
   - 708 pages en/de/it/es en français annoncées comme traduites ;
   - les anciennes adresses Shopify en 404 ;
   - les titres des fiches sans « Affiche personnalisée » ;
   - les descriptions SEO Shopify non reprises (un CSV à importer sera dans `Documents\perso\memoryline-seo-shopify.csv`) ;
   - la ligne « Phrase SEO : … » visible sur 44 fiches ;
   - l'image de partage et le favicon absents, le titre principal de l'accueil, les vrais 404.

   Reste pour Margaux : 61 fiches sans texte, les traductions des fiches. Reste pour le jour de la bascule : `PUBLIC_NOINDEX=false` et faire servir www.memoryline.fr (voir `MISE-EN-PROD.md`).
3. Corrections de code de la section 7 de `MISE-EN-PROD.md` : écran adresse/SIRET des factures, aide du BO « mode essai », message « .env » visible à la caisse.

## Trello relu le 7/10 (matin)

**Module : en cours sur la branche `chantier-recherche-seo`**
- Pastilles d'étapes : une seule ligne, en plus petit.
- Étape 1 : plus de police bâton en ligne 1. La ligne 1 est en majuscules, en DM Serif Display ou Abril Fatface. La ligne 2 est en Another Shabby. La ligne 3 est en DM Serif Display, Abril Fatface ou Another Shabby. Plus de « (symboles et chiffres autorisés) » ni de « Touche Entrée… ».
- Signature : seulement sur le PDF, en noir, au ras du coin en bas à droite (capture de Margaux dans la carte « Questions »).
- Filigrane : cercle plus discret, logo plus grand.
- Ordre des calques : base → jean → t-shirt → cheveux → accessoires.
- Placement :
  - de dos, pas de 2e rangée tant que la 1re n'est pas pleine ;
  - de face, enfants et chiens devant par défaut.

**BO : à faire après la recherche, qui touche les mêmes écrans**
- Couleurs : pouvoir changer l'ordre des couleurs (aujourd'hui on ne peut que supprimer).
- Pages/Collections : trier l'ordre des affiches page par page, pas seulement sur l'accueil.
- Panier abandonné : pouvoir modifier le courriel (et le programmer).
- Modification groupée des produits : un « appliquer à tout ». Champs voulus : nom, identifiant, prix, collections, poids, catégories, descriptions, statut, type d'affiche.
- Fiche commande : aperçu des affiches, dans le style du panier.

**Réponses de Margaux (carte « Questions »)**
- Comptes vendeur limités à leur stand : **oui**. Lié à la carte « Plusieurs comptes si je fais plusieurs marchés de Noël ».
- Retrait sur place :
  - pas de créneau, mais une description libre où l'on peut passer à la ligne ;
  - le « chalet » proposé dessous (un stand ouvert) ne peut être ni modifié, ni supprimé, ni complété par d'autres chalets : il faut pouvoir les gérer.
- SIRET pour les factures : 877 919 852 00047. L'adresse manque toujours.
- Offre 3+1 : 3 affiches achetées, **quelle que soit la taille**, donnent 1 A4 offerte **sans cadre** (aujourd'hui les A3 ne comptent pas et le cadre est offert). Elle veut moduler ses promos librement, « comme Shopify ».
- Bandeau : il ne doit plus être lié aux promos. C'est juste un texte et un bouton, et il faut pouvoir en mettre **plusieurs qui défilent**.
- Animaux : pour le berger allemand, elle voulait le nuancier « peau », mais il n'existe pas dans Personnages › Catégories de pièces. À revoir avec le nouvel écran des couleurs.
- À lui réexpliquer, sans code : l'import des clients (« rien compris ») et les « commandes déjà imprimées » (« c'est-à-dire ? »).
- Carte « On voit pas assez bien qu'on peut descendre » (❌) : le sommaire qui servait à ça vient d'être retiré à sa demande. Il faudra un autre indice, plus discret.

## Bon à savoir
- Compte d'essai du BO **local** : `essai-module@example.test`. Il n'existait plus dans la base Neon ; il a été recréé le 6/10 au soir depuis le PC de la maison, et son mot de passe est en commentaire à la fin du `.env` de ce PC-là. Sur un autre PC, le remettre avec `pnpm --filter @memoryline/api run create-admin <email> <mdp> owner`.
- Archive et mise en ligne : voir `MISE-EN-PROD.md`, étape 1.
