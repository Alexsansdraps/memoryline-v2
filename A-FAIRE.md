# À faire — état au 19 octobre, 17 h

Fichier de reprise : à supprimer quand tout est fait.

## En ligne sur le VPS depuis le 19/10 à 16 h 53 (commit 4080cde, `main`)

Tout ce qui était fait est en prod : la migration **0067** est passée, la base est sauvegardée juste avant (`sauvegardes/base/2026-10-19.sql.gz`).

- **Cartes BO du Trello** : ordre des couleurs d'un nuancier (poignée, flèches), tri des affiches page par page (Produits › Ordre d'affichage), courriel du panier abandonné modifiable et programmable, modification groupée avec « appliquer à tout », aperçu des affiches sur la fiche commande, nuancier « peau » possible pour un animal.
- **Réponses de Margaux** : vendeurs limités à leurs stands (BO › Comptes, « Stands confiés »), lieux de retrait gérés dans BO › Livraison › Lieux de retrait, adresse et SIRET sur les factures (BO › Contenu), offre 3+1 toutes tailles, A4 offerte sans cadre, réglable dans Promotions, bandeau détaché des promos avec plusieurs messages qui défilent.
- **Autres cartes** : stand sur tablette sans défilement, écran photo de l'IA allégé (« Votre photo doit être nette et lumineuse »), indice discret pour descendre dans l'éditeur de personnage, textes du module traduits, « Suit la couleur de… » retiré des réglages avancés, textes « mode essai » visibles seulement en essai.

**Deux changements de comportement à connaître**
- Un compte **vendeur** ne voit plus aucune vente tant qu'on ne lui a pas confié son stand dans BO › Comptes.
- Le **retrait sur place** n'apparaît plus à la caisse tant qu'aucun lieu de retrait n'est créé dans BO › Livraison › Lieux de retrait (le stand ouvert ne sert plus de lieu).

## En cours sur le PC du bureau (pas encore commité)

- **Refonte de BO › Personnages** (demande d'Alexandra : « il faut que ça soit logique ») : la page mélangeait les personnages et les 164 pièces avec leurs couleurs dépliées (35 000 px de haut). Nouvelle organisation : Personnages d'un côté, une page Pièces de l'autre, couleurs ouvertes à la demande, noms de pièces renommables sur place. À vérifier dans le BO connecté avant de mettre en ligne.
- Les corrections de fin des deux chantiers Trello (essais et relecture), s'il en sort.

## À faire par Alexandra (données, sur le BO du serveur)

- Confier son stand au compte vendeur (BO › Comptes) ; créer les lieux de retrait (BO › Livraison › Lieux de retrait) ; saisir l'adresse et le SIRET des factures (BO › Contenu) ; relire la promotion 3+1 (BO › Promotions) et les messages du bandeau.
- Importer `Documents\perso\memoryline-seo-shopify.csv` et `memoryline-seo-shopify-collections.csv` dans BO › Produits › Importer ; coller `memoryline-page-affiches-personnalisables.html` dans une page `affiches-personnalisables`.
- Exporter les redirections de l'admin Shopify avant sa fermeture, puis les saisir dans BO › Redirections.
- Renommer la promotion « Livraison offerte dès 60 € » (caractères abîmés).
- Faire valider par Margaux : les 18 redirections des fiches disparues (`apps/web/src/lib/anciennes-adresses.ts`), les seuils de composition des personnages (`packages/types/src/composition-personnages.ts`), les pièces à renommer (noms anglais de l'import).

## En attente d'une décision

- **Abril Fatface** : accord pour télécharger `AbrilFatface-Regular.ttf` (licence OFL, dépôt officiel `github.com/google/fonts`, dossier `ofl/abrilfatface`). Étapes en commentaire dans `packages/types/src/fonts.ts`.
- Les traductions des fiches, des catégories et des cadres : données à saisir au BO (bouton « Proposer les traductions manquantes »).

## Bon à savoir
- Compte d'essai du BO **local** : `essai-module@example.test` ; le remettre sur un autre PC avec `pnpm --filter @memoryline/api run create-admin <email> <mdp> owner`.
- Depuis le PC du bureau, Claude met en ligne sur demande (clé SSH dédiée). Le cache de construction Docker du VPS a été nettoyé le 19/10 (20 Go libérés) ; à refaire quand le disque se remplit : `docker builder prune -f --keep-storage 3GB`.
