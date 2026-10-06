# À faire — reprise du 6 octobre au soir

Fichier de reprise : à supprimer quand tout est fait.

## En ligne (archive du commit 75dcade)
Bulle « Vidéo tuto », check-list `MISE-EN-PROD.md`, script `apps/api/scripts/vider-donnees-test.sh`.

## Pas encore fait

1. **Retirer les boutons « Personnaliser : Peau · Vêtements · Pantalon · Cheveux · Accessoires »** sous l'aperçu du personnage (demande d'Alexandra, photo du 6/10). C'est le « sommaire des réglages » : `SommaireReglages` dans `packages/configurator/src/components/CharacterEditor.tsx` (vers les l. 620-775 et 1251).
   Retirer aussi ce qui ne sert qu'à lui : `parties`, `ancres`, `suivi`/`createPartieALEcran`, `toutTient`, `allerA` ; les clés `sommaire*` de `packages/configurator/src/messages.ts` et de `ui.ts` ; les règles `.ml-cfg-sommaire*` de `apps/web/src/styles/global.css`.
   Vérifier ensuite la mise en page de l'aperçu sur téléphone : c'est un bandeau collé, et le sommaire occupait sa droite.
2. **BO › Personnages : l'écran des couleurs est incompréhensible** (retour de Margaux). Il faut le repenser : `apps/admin/src/components/GroupesCouleurs.astro` (1 200 lignes), la section « Couleurs que le client peut changer » de `apps/admin/src/pages/personnages/[id].astro`, et le réglage par catégorie dans `categories-pieces.astro`. Garder toutes les possibilités actuelles, mais avec des mots et des étapes qu'une non-technicienne comprend.
3. **Recherche du BO « méga puissante »** : elle doit tout trouver (noms, numéros, un bout de texte n'importe où, écrans et libellés du BO) et emmener à l'endroit exact, surligné. « bandeau » ne trouvait pas « Bandeaux visuels », parce que la liste `ECRANS` de `apps/api/src/recherche.ts` est écrite à la main et en retard. Un chantier tourne sur le PC du bureau : il sera poussé sur la branche **`chantier-recherche-seo`**, à relire puis fusionner.
4. **SEO** : l'audit complet est fait, le site n'est pas prêt à remplacer Shopify. Les corrections tournent sur le PC du bureau et iront sur la même branche `chantier-recherche-seo`. Elles couvrent :
   - le plan du site vide en prod ;
   - 708 pages en/de/it/es en français annoncées comme traduites ;
   - les anciennes adresses Shopify en 404 ;
   - les titres des fiches sans « Affiche personnalisée » ;
   - les descriptions SEO Shopify non reprises (un CSV à importer sera dans `Documents\perso\memoryline-seo-shopify.csv`) ;
   - la ligne « Phrase SEO : … » visible sur 44 fiches ;
   - l'image de partage et le favicon absents, le titre principal de l'accueil, les vrais 404.

   Reste pour Margaux : 61 fiches sans texte, les traductions des fiches. Reste pour le jour de la bascule : `PUBLIC_NOINDEX=false` et faire servir www.memoryline.fr (voir `MISE-EN-PROD.md`).
5. Corrections de code de la section 7 de `MISE-EN-PROD.md` : écran adresse/SIRET des factures, aide du BO « mode essai », message « .env » visible à la caisse.

## Bon à savoir
- Compte d'essai du BO **local** : `essai-module@example.test`. Son mot de passe a été changé le 6/10 sur le PC du bureau ; le remettre avec `pnpm --filter @memoryline/api run create-admin <email> <mdp> owner`.
- Archive et mise en ligne : voir `MISE-EN-PROD.md`, étape 1.
