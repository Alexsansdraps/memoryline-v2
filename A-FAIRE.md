# À faire — état au 7 octobre au soir

Fichier de reprise : à supprimer quand tout est fait.

## En ligne sur le VPS depuis le 7/10 (commit 0c2b2d9, `main`)

Tout ce qui précède est en ligne : bulle « Vidéo tuto », couleurs du BO refaites, sommaire retiré, plus ce qui suit.

- **Recherche du BO** : elle trouve tout, par nom, numéro ou bout de texte n'importe où, et emmène à l'endroit exact, surligné. Elle tolère les fautes de frappe. Le champ prend toute la largeur. Une page « Voir tous les résultats » existe. La liste des écrans se construit toute seule depuis le code du BO.
- **SEO** :
  - plan du site rendu à la demande ;
  - langues non traduites en noindex ;
  - toutes les anciennes adresses Shopify en 301 ;
  - vrais 404 / 410 / 503, adresses normalisées ;
  - maillage entre fiches, image de partage, favicon, cache des fichiers fixes, HTTP/3 ;
  - `DOMAINE_WWW` prêt pour la bascule.
- **Module** :
  - pastilles d'étapes sur une ligne ;
  - ligne 1 en DM Serif Display seule, en majuscules, sans les mentions retirées ;
  - signature seulement sur le PDF, en noir, au coin ;
  - filigrane plus discret, logo plus grand (aussi sur les aperçus IA) ;
  - ordre des calques base → jean → t-shirt → cheveux → accessoires ;
  - placement de plusieurs personnages revu ;
  - **les textes s'impriment enfin comme à l'écran** : plus de faux gras en ligne 1, et l'espacement, la position et la taille de la ligne 3 alignés sur le module.
  - « Retour » sur un personnage tout juste ajouté annule l'ajout.

## À faire par Alexandra (données, sur le BO du serveur)

- Importer `Documents\perso\memoryline-seo-shopify.csv` (titres et descriptions SEO de Shopify) dans BO › Produits › Importer des affiches. Importer de même `memoryline-seo-shopify-collections.csv`.
- Coller `Documents\perso\memoryline-page-affiches-personnalisables.html` dans une page du BO dont l'adresse est `affiches-personnalisables`.
- Exporter les redirections de l'admin Shopify avant sa fermeture, puis les saisir dans BO › Redirections.
- Renommer la promotion « Livraison offerte dès 60 € » : son nom contient des caractères abîmés (« d�s 60 � »).
- Valider avec Margaux les redirections des 18 fiches que Shopify vend encore mais qui n'existent pas ici. La liste est dans `apps/web/src/lib/anciennes-adresses.ts`.

## En attente d'une décision

- **Abril Fatface** (carte « POLICE ») : la police n'est pas sur le PC. Il faut l'accord pour télécharger `AbrilFatface-Regular.ttf`, en licence OFL, depuis le dépôt officiel `github.com/google/fonts`, dossier `ofl/abrilfatface`. Les étapes sont en commentaire dans `packages/types/src/fonts.ts`.
- Composition des personnages : faire valider par Margaux les seuils (cheval et poney classés « petits », échelle mini 0,5, recul de la 2e rangée). Ce sont les constantes en tête de `packages/types/src/composition-personnages.ts`.
- Carte « On voit pas assez bien qu'on peut descendre » (❌) : le sommaire qui servait à ça a été retiré à sa demande. Il faut un autre indice, plus discret.

## Pas encore fait (code)

**BO, cartes Trello du 7/10**
- Couleurs : pouvoir changer l'ordre des couleurs (aujourd'hui on ne peut que supprimer).
- Pages/Collections : trier l'ordre des affiches page par page, pas seulement sur l'accueil.
- Panier abandonné : pouvoir modifier le courriel (et le programmer).
- Modification groupée des produits : un « appliquer à tout ». Champs voulus : nom, identifiant, prix, collections, poids, catégories, descriptions, statut, type d'affiche.
- Fiche commande : aperçu des affiches, dans le style du panier.

**Réponses de Margaux (carte « Questions »)**
- Comptes vendeur limités à leur stand : **oui**. Lié à la carte « Plusieurs comptes si je fais plusieurs marchés de Noël ».
- Retrait sur place :
  - pas de créneau, mais une description libre où l'on peut passer à la ligne ;
  - pouvoir gérer les « chalets » (lieux de retrait) : les ajouter, les modifier, les supprimer.
- Factures : écran adresse + SIRET. SIRET donné : 877 919 852 00047. L'adresse manque toujours.
- Offre 3+1 : 3 affiches achetées, **quelle que soit la taille**, donnent 1 A4 offerte **sans cadre**. Elle veut moduler ses promos librement, « comme Shopify ».
- Bandeau : détaché des promos, juste un texte et un bouton, **plusieurs qui défilent**.
- Animaux : nuancier « peau » pour le berger allemand, à revoir avec le nouvel écran des couleurs.
- À lui réexpliquer, sans code : l'import des clients et les « commandes déjà imprimées ».

**Section 7 de `MISE-EN-PROD.md`**
- Aide du BO « mode essai ».
- Message « .env » visible à la caisse.

## Bon à savoir
- Compte d'essai du BO **local** : `essai-module@example.test`. Le remettre sur un autre PC avec `pnpm --filter @memoryline/api run create-admin <email> <mdp> owner`.
- Une commande en brouillon d'essai (n° 149) a été créée par erreur dans la base **locale** du bureau pendant une recette. Le script de vidage l'enlèverait.
- Archive et mise en ligne : voir `MISE-EN-PROD.md`, étape 1. Depuis le PC du bureau, Claude peut mettre en ligne sur demande (clé SSH dédiée).
