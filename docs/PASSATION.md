# Passation — où en est Memory Line v2

> Écrit le 28/09/2026, au commit `6cd6f74`, branche `travaux-septembre`
> (dépôt privé `Alexsansdraps/memoryline-v2`, local et distant au même point).
> Les règles de travail sont dans `CLAUDE.md`, à la racine. Ce document-ci raconte
> **l'état**, pas les règles.

## 1. Ce que c'est

Trois usages d'un même produit, l'affiche personnalisée :

- **la boutique** (`apps/web`) — vitrine, configurateur, panier, paiement Stripe et PayPal ;
- **le stand** (même écran, `?stand=1`) — tablette en libre-service sur un salon : le
  visiteur compose son affiche, laisse son e-mail, ne paie pas sur place ;
- **le back-office** (`apps/admin`, servi sous `/bo`) — catalogue, personnages, commandes,
  impression, finances, statistiques, livraison.

Autour : `apps/api` (Hono + Drizzle + PostgreSQL, rendu des affiches avec sharp et pdf-lib),
`packages/configurator` (le configurateur, en SolidJS, partagé boutique/stand) et
`packages/types` (les règles communes : couleurs, polices, empilement des calques, fuseau).

## 2. Ce qui vient d'être fait (neuf derniers dépôts)

| Commit | Ce que ça change |
|---|---|
| `6cd6f74` | Les images téléversées (PNG/JPG/WEBP) livrent enfin leurs couleurs, et les messages d'erreur disent la vérité |
| `b55733d` | Le back-office passe à l'heure de Paris (il affichait deux heures de moins) |
| `0dce0bd` | Le bandeau du compte SendCloud cesse de se contredire |
| `0b36537` | Bordereaux transporteur : joindre une étiquette, la réimprimer, porter le suivi |
| `3e6e62e` | La vidéo explicative à l'étape 1 de la personnalisation, avec son placeholder |
| `4777a6d` | Le dernier choix coupé en deux, pour qu'on voie qu'on peut faire défiler |
| `a440db8` | Livraison : la liste de ce qu'il reste à faire par mode, et pas de lettre suivie |
| `4e6bc85` | Les modes de livraison préparés d'avance, éteints et sans prix |
| `10e5f72` | Les scripts qui vident des tables demandent confirmation |

**Rien de tout cela n'est en ligne** : le VPS de test tourne encore sur une version
antérieure. Voir §6.

## 3. Le chantier « bordereau transporteur »

La conception complète est dans `docs/conception/bordereau.json` (dix-sept étapes).
**Les étapes 1 à 12 sont construites**, les suivantes non.

Ce qui existe :

- un bloc **« Bordereau transporteur »** sur la fiche d'une commande : un bouton copie
  l'adresse complète à coller chez SendCloud, puis on dépose le PDF de l'étiquette achetée
  chez eux, son transporteur et son numéro de suivi ; l'étiquette reste attachée à la
  commande, se réimprime, et « Retirer » ne supprime rien (une date, le fichier reste) ;
- l'écran **Livraison** avec deux champs de clés SendCloud et un bouton « Vérifier le
  compte » : les clés sont écrites par l'API dans un **fichier privé** (`data/prive/secrets/`),
  jamais en base, jamais réaffichées — l'écran ne montre que les quatre derniers caractères
  de la clé publique ;
- un **faux serveur SendCloud** (`apps/api/scripts/faux-sendcloud.ts`, profil compose
  `essais`) contre lequel tout est prouvé, plus `pnpm verifier:bordereaux`
  (126 vérifications au dernier passage) ;
- la migration `0056_bordereaux_transporteur` et le dossier `data/prive`.

Ce qui n'existe pas encore, volontairement : **acheter** l'étiquette depuis la commande,
voir les tarifs avant d'acheter, l'impression automatique, l'annulation chez le
transporteur, et le webhook qui ferait passer une commande en « livrée » toute seule.

À savoir : chez SendCloud, l'ancienne API v2 (celle de tous les tutoriels) est fermée aux
nouveaux comptes ; en v3, **annoncer un colis l'achète**. Il n'existe pas de brouillon
gratuit. D'où le faux serveur, et le « mode essai » prévu côté boutique.

Le compte SendCloud de la boutique donne accès à Mondial Relay **aux tarifs SendCloud**
(pas de contrat Mondial Relay en direct) ; une intégration Shopify y est encore connectée,
celle de l'ancienne boutique, à ne pas débrancher avant la bascule.

## 4. Ce qui est conçu mais pas construit

**La relance de panier abandonné** — `docs/conception/relance-panier.json`.
Le mécanisme existe déjà (elle part toute seule, avec lien de récupération et
désabonnement), mais le **texte du courrier est écrit en dur** et l'**horaire se limite à
un palier parmi quatre**. La conception prévoit : cinq champs modifiables au back-office
(objet, salutation, message, bouton, phrase de fin), un aperçu, un essai sur sa propre
adresse, un retour au texte d'origine, un délai libre, jusqu'à trois rappels, et une plage
horaire de silence. Dix étapes, migration `0057` à prendre (la `0056` est prise).

Deux choix ont été arrêtés et attendent seulement d'être construits : la plage « pas
d'envoi entre 21 h et 8 h » livrée **active**, et des textes de départ plus courts pour les
rappels 2 et 3, livrés **éteints**.

## 5. Les cartes du tableau de la cliente

L'audit carte par carte, avec les preuves, est dans `docs/conception/audit-cartes.json`.
En résumé :

**Fait** — ordre des calques, PDF en 2 s au lieu de 2 min, tri manuel de l'ordre
d'affichage, les trois cartes « cadres » (prix par format, masquage sur le site, aucun prix
au stand), Retour/Valider, les dates dans le sous-titre, le personnage par défaut retiré,
le filigrane (validé tel quel par Alexandra le 27/09).

**Construit mais jamais rempli** — c'est le piège de ce tableau. Trois cartes ont l'air
faites et ne le sont pas *pour le client* :

- les **couleurs des animaux** : sur 21 animaux, aucun n'est qualifié, donc les
  animaux-photo ne proposent aucune couleur et les animaux dessinés proposent la palette de
  **peau** (un chien peut être peint en couleur chair) ;
- les **détails à ne pas colorer** (le ruban du chapeau) : l'outil existe, aucune des 164
  pièces n'a de zone masquée ;
- les **couleurs de cheveux manquantes** : rien à développer, il manque les deux teintes
  exactes de Margaux.

Ce n'est pas du développement, c'est de la saisie au back-office.

**Reste à faire** — les barres de défilement des zones intérieures, le libellé « ajouter un
personnage », le cadre et sa simulation sur l'affiche IA, le consentement marketing au
stand, et, seul gros morceau, les **espaces entre personnages** (le calcul raisonne sur le
cadre du dessin et non sur sa largeur réelle).

**En attente de Margaux** — ce qui la gêne exactement dans les espaces entre personnages ;
ce que veut dire « cartes de couleurs plus visibles » ; si les affiches importées par CSV
sont personnalisables ou prêtes à imprimer (**à trancher avant le premier gros import**, ce
n'est pas réversible) ; et si elle veut vraiment un logo signature **imprimé** sur l'affiche
payée, alors qu'on promet au client que le filigrane disparaît après paiement.

## 6. Déployer

Le serveur de test est chez OVH (Debian, base PostgreSQL auto-hébergée sur la machine).
**C'est Alexandra qui lance les commandes** : aucune session Claude n'a d'accès SSH.

L'ordre compte :

1. **sauvegarder d'abord** (`apps/api/scripts/sauvegarder.sh`) ;
2. envoyer l'archive (`git archive HEAD`, plus les deux polices AnotherShabby qui sont hors
   Git) et la décompresser ;
3. `docker compose -f docker-compose.prod.yml build` ;
4. **appliquer la migration** avant de démarrer :
   `docker compose -f docker-compose.prod.yml run --rm api pnpm --filter @memoryline/api db:migrate` ;
5. `docker compose -f docker-compose.prod.yml up -d`.

Trois points d'attention pour le prochain déploiement :

- le **`.env` ne voyage jamais** dans l'archive : il est écrit à la main sur chaque machine ;
- il faut **créer `data/prive`** sur le serveur (il est monté par `docker-compose.prod.yml`)
  et l'**ajouter aux sauvegardes** : il contient les étiquettes PDF et les clés SendCloud —
  le sous-dossier `secrets/` est volontairement exclu du rsync ;
- le passage à l'heure de Paris **déplace toutes les heures affichées de deux heures** et
  fait changer de jour les commandes de nuit : un export refait sur les mêmes dates ne
  donnera pas le même total qu'avant. C'est la correction, pas une panne.

## 7. Les pièges déjà rencontrés

- **`node_modules` cassés côté Windows** : tout tourne dans les conteneurs.
- **Docker limité à ~3,7 Go** : ne jamais installer les dépendances de deux apps à la fois.
- **Noms d'images Docker** : les images de développement portent des noms distincts
  (`memoryline-dev-*`) depuis qu'une image de production a écrasé celle de dev, ce qui avait
  fait tourner l'API sans `.env` et supprimé le logo des courriers sans prévenir.
- **Le back-office sert sur le port 4322** avec son propre proxy `/api` : c'est ce qui a
  réglé les « No cached compile metadata found » ; ne pas le remettre derrière la boutique.
- **`APP_SECRET`** signe les vignettes des courriers et retombe silencieusement sur
  `DATABASE_URL` : changer de base casse les images des courriers déjà envoyés, sans erreur.
- **Un script `tsx` ne se termine jamais tout seul** : le pool de base garde le processus en
  vie. Toujours finir par `process.exit(0)`.
- **La base de développement est distante et partagée** avec le contenu d'essai d'Alexandra.

## 8. Ce qui est fragile, honnêtement

- **Aucun écran du back-office n'a été ouvert** par les sessions récentes : la consigne
  interdit de s'y connecter. Tout est prouvé au niveau des fonctions et compile sans erreur,
  mais la mise en page, la longueur des messages et le rendu sur téléphone restent à
  vérifier de visu — en particulier l'écran Livraison et le bloc bordereau.
- **Le défilement au doigt** (« dernier item coupé en deux ») n'a pas pu être testé sur un
  vrai téléphone ; sur trois catégories de personnages, la coupe tombe au quart plutôt qu'à
  la moitié.
- **Les dates saisies avant le passage à l'heure de Paris** (bandeaux, promotions, validité
  des cartes cadeaux) peuvent s'afficher avec une heure ou deux de décalage : il suffit de
  les rouvrir et de les réenregistrer une fois.
- **Les clés SendCloud** de la boutique ont circulé dans une conversation. Alexandra a
  choisi de les garder pour l'instant, en connaissance de cause ; elles devront être
  régénérées avant le premier achat réel d'étiquette.
- **La clé secrète PayPal** a circulé elle aussi et doit être régénérée sur
  developer.paypal.com.
