# Reprise du chantier — 6 octobre 2026

À lire en premier par la session qui reprend. Ce fichier se supprime une fois tout terminé et mis en ligne.

## Le contexte

Memory Line est une boutique d'affiches illustrées personnalisables. Alexandra la développe pour sa cliente, Margaux (boutique « Donuts Corner »). Les messages destinés à Margaux s'écrivent en **tutoiement**.

Les demandes arrivent sous forme de cartes Trello (tableau « ✅ Tâches Memory Line »). ❌ veut dire « pas bon / à faire ».

- `main` fait foi. Tout le travail ci-dessous y est poussé.
- Le serveur de test (OVH) se met à jour avec une archive : voir « Mise en ligne » plus bas. Il n'a encore reçu ni 0063, ni 0064, ni 0065, ni 0066 : la prochaine mise en ligne les passe.

## Où on en est

Le 6 octobre, **toutes les cartes non cochées du Trello ont été testées à l'écran**, plus les parcours complets (site en français et en anglais jusqu'au paiement d'essai et au fichier d'impression, mode stand sur tablette, affiche IA sans génération). Le détail carte par carte, ce qui a été corrigé et ce qui reste : **`docs/RECETTE.md`**.

Corrigé pendant la recette, entre autres :
- couleur des détails (ruban du chapeau) : migration **0066**, toutes les catégories de pièces sur « couleur principale », les ombres de même teinte suivant la couleur choisie ;
- BO : accueil (chiffres faux, périodes sans effet), tableau des cadres, décors sans image, colonne « Vient de » des clients, paniers mêlés aux commandes, pluriels détachés ;
- stand : nom du fichier d'impression après correction d'une vente, boutons « Revenir » / « Client suivant », nom et e-mail gardés au retour, panier en portrait ;
- caisse : ce qui manque est dit sous le bouton grisé ; pastille du panier après paiement ;
- types d'affiche tout neufs (« Mariés ») : « Ajouter un personnage » ne faisait rien.

Avant cela, les 5 et 6 octobre : styles d'affiche IA (0063), ordre des pages et collections (0064), couleurs proposées par catégorie (0065), bandeaux visuels, PDF d'impression fiables (file d'attente, préparation à l'avance, fonds WebP qui sortaient blancs), signature des créations à l'écran et à l'impression, défilement visible, format au stand.

## Questions en attente de la cliente

- **Son fichier de signature** (PNG transparent) : le logo Memory Line sert en attendant.
- **Couleurs des animaux téléversés** : chacun doit être réglé une fois (BO › Personnages › le personnage › « Détecter les couleurs », cocher « Proposée au client », « Enregistrer le dessin »). Aujourd'hui Berger allemand, Berger australien, Chien york et Chat gris ne proposent aucune couleur.
- **Catalogue à revoir** (rien n'a été touché) :
  - « Forêt Animaux » propose des fonds de Paris et de Compiègne, et les 3 affiches Compiègne n'ont aucun fond à elles ; même cas pour Côte d'Opale Plage #2, Montagne Neige et Paris Tour Eiffel sunset #1 ;
  - Vieux Moulin propose aussi un fond « VERACRUZ » ;
  - 2 fonds sans image (signalés en rouge dans BO › Décors des affiches) ;
  - personnages d'essai visibles : 3 « Femme test », « emond » et « ddd » (Fauteuil roulant).
- **Coupes de cheveux pour ados et enfants** : presque tous n'en ont qu'une ; des coupes à téléverser puis à cocher sur chaque personnage.
- **Codes couleur « brun clair » et « châtain clair »** : le nuancier des coupes a 9 couleurs sans nom.
- **Prix des cadres en A3** : les trois cadres valent 14 € en A4 comme en A3. Voulu ?
- **Accès par stand** : chaque stand a son code, mais un compte Vendeur voit toutes les ventes. Faut-il un accès limité à son stand ?
- **Retrait sur place** : le texte demande d'indiquer son créneau « en commentaire », et la caisse n'a pas de champ commentaire.
- **Traductions à saisir au BO** : bandeau, onglets de personnages, cadres, modes de livraison, produits (1 sur 177), titres et images d'exemple des 3 styles IA. Chaque écran a « Proposer les traductions manquantes ».
- L'import des clients : la date de consentement est celle de l'import ; le statut Shopify « pending » compte comme non abonné. Correct ?
- Les 15 affiches « prêtes à imprimer » n'ont que des photos de mise en scène en 1020 × 1400 : il faut les visuels d'origine en haute définition.
- Les « espaces chelou entre personnages » (capture) et traduire ou non les textes pré-remplis imprimés sur les affiches (« et ses plages »).
- Commandes déjà imprimées avec un fond WebP (Ault, Baie de Somme, Berck, Côte d'Opale, Fort-Mahon, Le Crotoy, Le Tréport, Soissons, Thourotte, Vieux-Moulin, Villers-Cotterêts) : à vérifier, elles ont pu sortir presque blanches.

## Vérifications (pile Docker locale)

> ⚠️ Sur la machine **de la maison**, le `.env` fait parler le conteneur `memoryline-api` à la base hébergée chez Neon (l'ancienne), pas au conteneur `memoryline-db` : `db:migrate` y écrit chez un tiers. Au bureau, l'API parle bien à `memoryline-db`.

`docker compose up -d`, puis sous Git Bash (mettre `MSYS_NO_PATHCONV=1` devant chaque `docker exec -w`) :

```bash
MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api pnpm db:migrate
MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsc --noEmit -p .
MSYS_NO_PATHCONV=1 docker exec -w /app/packages/configurator memoryline-web npx tsc --noEmit
MSYS_NO_PATHCONV=1 docker exec -w /app/apps/admin memoryline-admin npx astro check
MSYS_NO_PATHCONV=1 docker exec -w /app/apps/web memoryline-web npx tsc --noEmit -p .
```

- Le site doit afficher seulement 3 erreurs, anciennes, dans `src/islands/StandSalon.tsx`. Toutes les autres vérifications doivent sortir sans erreur.
- La dernière ligne n'est pas `astro check`, et ce n'est pas un oubli : `@astrojs/check` n'est une dépendance que d'`apps/admin`, et `memoryline-web` tourne avec `CI=true`, donc `npx` refuse de l'installer. `tsc` couvre tous les `.ts` / `.tsx` du site, pas les fichiers `.astro`.
- Si Vite répond 504 « Outdated Optimize Dep » : `docker restart memoryline-web`.
- Site : http://localhost:8080. BO : http://localhost:4322/bo (en développement, ses scripts ne marchent que sur ce port). Mailpit : http://localhost:8025.
- Pour tester à l'écran sans gêner l'utilisatrice : un Chrome sans fenêtre piloté par script (voir `docs/RECETTE.md`, ligne « Tests »), jamais en prenant la main sur son écran.

## Mise en ligne (serveur de test)

1. Construire l'archive depuis le dernier commit, sans fins de ligne Windows :

```bash
git -c core.autocrlf=false archive --format=tar -o memoryline-deploiement.tar HEAD -- . ':(exclude)data/memoryline-archive'
tar --force-local --append -f memoryline-deploiement.tar apps/api/fonts/AnotherShabby-Regular.ttf apps/web/public/fonts/AnotherShabby-Regular.ttf
gzip -9 memoryline-deploiement.tar
```

Les deux polices AnotherShabby ne sont **pas** dans git : leur licence est non commerciale. Si elles manquent sur la machine, on saute la ligne `tar --append`, car le serveur les a déjà.

2. Puis une seule ligne, depuis PowerShell. Elle fait la sauvegarde, sort le code, construit, passe les migrations jusqu'à 0066 et redémarre :

```bash
scp memoryline-deploiement.tar.gz debian@51.255.34.187:~/ ; ssh debian@51.255.34.187 "tar -xzf ~/memoryline-deploiement.tar.gz -C ~/memoryline apps/api/scripts/mettre-en-ligne.sh && bash ~/memoryline/apps/api/scripts/mettre-en-ligne.sh"
```

- Rien à ajouter au `.env` du serveur. La clé OpenAI y est déjà.
- `SENDCLOUD_ACHATS_REELS` n'y est pas posé : les bordereaux restent en mode essai, et il ne faut pas l'activer sans l'accord explicite d'Alexandra.
- Après la mise en ligne, ne pas laisser de stand d'essai ouvert : un stand ouvert est proposé au retrait sur place dans la caisse du site.

## Règles du dépôt

- Ne jamais commiter `.env`, `data/`, `sauvegardes/` ni les polices AnotherShabby. Le dépôt est **privé** (`Alexsansdraps/memoryline-v2`). La consigne ne change pas pour autant — un secret commité reste un secret à régénérer.
- Ne jamais se connecter aux comptes de la cliente (La Poste, SendCloud…) ni saisir de mot de passe. Demander des clés d'API.
- Commentaires en français qui expliquent le pourquoi, dans le ton des fichiers voisins. Pas de dépendance nouvelle. Le site est en 5 langues : tout nouveau texte va dans `ui.ts`, en fr, en (britannique), de (« Sie »), it et es (tutoiement).
