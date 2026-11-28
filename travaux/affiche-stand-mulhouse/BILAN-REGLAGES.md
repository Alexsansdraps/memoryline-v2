# Affiche du stand de Mulhouse — réglages du 28/11 (bilan)

Tout est en LOCAL (rien de commité, rien en prod). Demandes d'Alexandra du 28/11 vers 1 h 50, faites dans l'ordre 1, 2, 3, 4, 6, 7, puis 5 (les visuels) en dernier.

## Ce qui a changé

### 1. « Faut faire un 2. texte » — quatre étapes
- L'affiche à motifs a 4 étapes : « 1. Motif et fond » (motif, couleur du motif, fond), « 2. Texte » (en haut / en bas, lignes, polices, tailles, couleur), « 3. Personnages », « 4. Format ». Les autres affiches gardent leurs 3 étapes.
- `store.ts` : `ETAPES_AFFICHE_A_MOTIF`, le type `Step` gagne « texte ». `index.tsx` choisit les étapes selon `vueMotifs`. `StepBackgroundText` reçoit `partie` (« fond », « texte », « tout » par défaut = l'écran de toujours).
- Textes : `etapeMotifFond` / `etapeTexte` (messages.ts), clés `cfg.etape.motif_fond` et `cfg.etape.texte` dans les 7 langues (ui.ts, ajoutées à l'outil Edit, clés `cfg.*` seulement).
- Téléphone (≤ 480 px) : quatre noms entiers ne tiennent pas sur une rangée (ils finissaient en « … ») ; l'étape en cours garde son nom, les autres ne montrent que leur numéro (le nom reste lu par le lecteur d'écran). Une seule rangée, rien de coupé, dans les 7 langues.

### 2. « mettre en plein écran la popup »
- `ProductConfigurator.tsx` pose `ml-modal-plein-ecran` sur la fenêtre d'une affiche à motifs ; `global.css` : fenêtre 100 % × 100 %, sans arrondi, sur le site comme à la tablette. Au-delà de 768 px : aperçu et étapes côte à côte (colonne des étapes 360-520 px), l'aperçu aussi haut que l'écran le permet, « Voir sur un mur » à la largeur de l'affiche. En dessous : l'un sous l'autre (règles existantes). L'éditeur de personnage garde sa colonne unique.
- Contrôlé à 1440 × 900, 390 × 844 et à la tablette (?stand=1, 1024 × 768) : croix visible, aucun défilement de côté (page et fenêtre).

### 3. « c'est perso sur le muret tout le temps »
- Migration `0122` : `default_view = 'back'` pour ce produit seul. `foreground_url` reste vide : c'est le muret du type « De dos » (l'API le résout ; à défaut le module, le panier et pdf.ts prennent `muret_officiel.svg`). Seuls des personnages de dos sont proposés.
- Mise en page (`mise-en-page-motif.ts`, réécrit) : les personnages ne bougent plus (le décalage vers le haut quand le texte était en bas est retiré, `placementsAffiche` revient à sa version d'avant le chantier). Texte en haut : texte, motif, personnages. Texte en bas : motif, texte juste au-dessus de la plus haute tête (`basDuTexteEnBas`), personnages ; sans personnage, le texte descend à la marge du bas. Le motif prend toute la place entre les deux (0,8 de la largeur au plus).
- Sans personnage, pas de muret (comme les autres affiches de dos). Le panier et pdf.ts posent le décor dès qu'il y a un « personnage » — le motif en est un pour eux — et retombent sur le muret en vue de dos : la configuration d'une affiche à motifs SANS personnage part donc avec `foregroundUrl: ""` et `view: "front"` (`configFromState`), et `ConfiguratorIsland` n'écrase plus un décor déjà écrit par le module. Rouverte, elle reprend la vue de la fiche (`defaults.view`) : personnages de dos, muret dès le premier ajouté.
- Contrôlé avec 0, 1, 3 et 12 personnages (deux rangées), texte en haut et en bas : aucun chevauchement (`captures/reglages-mep-planche.png`).

### 4. Les 47 motifs
- Déjà dans 0121 et en base locale : 8 Mulhouse, 7 Textile et musées, 5 Strasbourg et Colmar, 4 Maisons d'Alsace, 11 Noël, 7 Gourmandises, 5 Alsace. `motifs-3/index.json` : 19 entrées complètes. Les 47 SVG sont dans `data/assets` ET `assets-prod/`, servis (200, vignettes ?l=200). Pas de migration de plus.

### 6. « titre croppé à droite »
- Cause : dans « Voir sur un mur », l'affiche est dessinée à 480 px puis réduite par `transform: scale()`. La réduction des lignes (`ReductionTexte.ts`) comparait une largeur de mise en page à une mesure d'écran (transformée) : les lignes semblaient trois fois plus courtes et n'étaient jamais réduites. Corrigé : la mesure est ramenée à l'échelle du calque (sans transformation, rien ne change), et `ApercuAuMur` ne pose l'affiche qu'une fois son échelle connue. Le défaut existait AUSSI sur les affiches classiques (« SAINT-VALERY-SUR-SOMME » touchait les bords) : corrigé pour toutes.
- Dans le même aperçu au mur, les personnages étaient dessinés aux places de départ de l'état (au milieu, échelle 1, un géant flottant devant le décor) sur TOUTES les affiches : le second aperçu compose maintenant comme le premier (`recomposer`, `etalon`). Une ligne, `index.tsx`.
- Contrôlé : les 47 noms en ligne 1, taille « Grand », texte en haut puis en bas (94 mesures, toutes dans les marges de 6 %) ; le plus long dans l'aperçu, au mur, au panier et à l'impression (`captures/reglages-d-comparaison.png`) ; une affiche classique à long titre au mur, avant/après (`reglages-avant-mur-classique-mur-x4.png` / `reglages-apres-mur-classique-mur-x4.png`).

### 7. Palette des couleurs du motif, modifiable au BO
- Réglage `motifs.couleurs` (`apps/api/src/motifs-couleurs.ts`) : { id, nom, hex, actif, noms } ; absent = 10 couleurs de base : Anthracite #2B2B2B, Crème #F4ECDD, Rouge Noël #A4161A, Vert sapin #1F4D3A, Bleu nuit #1B2A4A, Or #D4A73B, Bordeaux #6B1F2A, Ocre #C27A2C, Bleu ciel #9CC3D5, Rose poudré #E3A6A0, noms dans les 7 langues. Vérifiées sur les 19 fonds avec trois motifs (`captures/reglages-palette-fonds-{hotel,maisons,sapin}.jpg`) : chaque fond en a au moins cinq qui se lisent.
- La fiche (`GET /products/:slug`) sert `couleursMotif` (activées, nom dans la langue) pour une affiche à motifs seulement. Le choix « Couleur du motif » montre la palette (rangée qui passe à la ligne).
- Peinture (`couleursDuMotif`, store.ts) : la silhouette (.st0) prend la couleur ; les zones crème restent crème si elles se lisent mieux que le trait sombre sur cette couleur (contraste WCAG), sinon passent au trait sombre #2B2B2B ; les façades des maisons gardent leurs couleurs. Écrit dans la configuration : aperçu, panier et impression identiques (contrôlé).
- Serveur : `couleurDuMotifRefusee` (ajout ET modification d'une ligne de panier) n'accepte pour un motif que la palette (activée ou non), le trait du dessin et le blanc d'avant la palette ; pour les détails, leur couleur, transparente (ancien « blanc ») ou le trait sombre ; aucune pièce sur un motif. Une ligne sans motif passe sans lecture de plus (liste des motifs gardée une minute en mémoire) ; une erreur de lecture laisse passer la ligne. Contrôlé : une couleur forgée → 400 `couleur_motif`, aucun panier créé.
- BO : nouvel écran « Couleurs des motifs » (`/bo/motifs-couleurs`, menu Atelier › Personnages ; lien depuis la fiche produit, section « Affiche éphémère d'un stand ») : nom, couleur, traductions du nom, Activé/Désactivé, ↑ ↓ pour l'ordre, Supprimer, Ajouter, « Remettre les dix couleurs de base » ; aperçu d'un motif peint comme le configurateur le peint ; au moins une couleur activée.

### 5. Les visuels de la fiche (faits en dernier)
- Composés dans le vrai configurateur (lignes de panier locales 280, 283, 286), rendus par `renderPosterPng` en A4 (2480 × 3508) sans signature (`rendu-impression.ts --sans-signature`), puis JPEG 1600 px, qualité 88 :
  1. `mulhouse-marche-de-noel-exemple-1-v2.jpg` (principale) : la composition d'Alexandra — sapin en grand, fond « Étoiles dorées » (rouge aux petites étoiles), texte en haut « SAPIN DE NOËL » (police de titre, blanc) et « Marché de Noël de Mulhouse » (manuscrite, blanc), aucun personnage, ni muret, ni filigrane ;
  2. `-2-v2.jpg` : l'hôtel de ville en or sur le dégradé « Nuit d'hiver », texte en bas, une famille et son chien de dos sur le muret ;
  3. `-3-v2.jpg` : les maisons alsaciennes en bordeaux (façades colorées) sur le dégradé « Aube rosée », texte gris anthracite en haut, un couple sur le muret.
- Copiés dans `data/assets` et `assets-prod/` ; rattachés par 0122 (les deux anciennes adresses v1 remplacées, la troisième ajoutée, rangs et textes alternatifs). Vérifiés sur la fiche, la collection et la page du stand à la tablette.

## Fichiers
- Configurateur : `packages/configurator/src/{mise-en-page-motif.ts, store.ts, index.tsx, messages.ts}`, `components/{StepBackgroundText.tsx, ChoixMotif.tsx, PosterPreview.tsx, ReductionTexte.ts, ApercuAuMur.tsx}`.
- Site : `apps/web/src/islands/{ProductConfigurator.tsx, ConfiguratorIsland.tsx}`, `pages/[...lang]/affiches/[slug].astro`, `lib/{api.ts, messages-configurateur.ts}`, `i18n/ui.ts` (clés `cfg.*`), `styles/global.css`.
- API : `apps/api/src/motifs-couleurs.ts` (neuf), `index.ts` (fiche), `configurator-routes.ts` (contrôle à l'ajout et à la modification d'une ligne : un import et deux fois deux lignes, avec leur commentaire), `drizzle/0122_affiche_stand_mulhouse_reglages.sql`, `drizzle/meta/_journal.json`, tests `motifs-couleurs.test.ts`, `motifs-couleurs-base.test.ts`, `mise-en-page-motif.test.ts`.
- BO : `apps/admin/src/pages/motifs-couleurs.astro` (neuf), `lib/menu.ts`, `pages/produits/[id].astro` (un lien).
- Fichiers : `data/assets/mulhouse-marche-de-noel-exemple-{1,2,3}-v2.jpg`, copiés dans `assets-prod/`.
- Scripts de vérification : `navigateur/{pilote.mjs, parcours-*.mjs, planche_palette.py}`.

## Migration
`0122_affiche_stand_mulhouse_reglages` (idx 122, when 1795320000000, en dernier dans le journal ; relu juste avant : la dernière était 0121). Appliquée en local ; rejouée dans une transaction annulée : `UPDATE 0`, `UPDATE 0`, `UPDATE 0`, `INSERT 0 0`, puis la remise des rangs et textes (mêmes valeurs). Ne vise que ce produit. En prod, 0121 puis 0122 passent ensemble ; copier `assets-prod/*` dans `data/assets` AVANT (dont les 3 visuels v2 ; les v1 restent utiles si 0122 ne passait pas).

## Vérifications
- tsc : configurateur 0 erreur, API 0, site 3 (les anciennes de StandSalon.tsx) ; `astro check` du BO : 0 erreur.
- Tests : `motifs-couleurs` 4/4, `motifs-couleurs-base` 1/1 (base locale, lecture seule), `mise-en-page-motif` 4/4 (sur le poste : le module du configurateur ne se résout pas depuis le conteneur), et sans changement `tailles-texte` 3/3, `page-de-la-tablette` 10/10, `ia-composition` 19/19.
- Écran (Chrome sans écran) : plein écran et 4 étapes à 1440, 390 et tablette ?stand=1 ; un motif de chaque onglet (maisons en couleurs) ; fonds uni, dégradé, répété ; palette ; texte en haut et en bas ; 0, 1, 3, 12 personnages ; au panier sans payer (site → /commande, tablette → /panier) ; « Modifier » depuis le panier (même motif, fond, couleur, place du texte, ligne 1) ; anglais, allemand, japonais.
- Aperçu = « Voir sur un mur » = vignette du panier = fichier d'impression, sur 4 lignes (`captures/reglages-a-apercu-vs-impression.png`, `reglages-bc-comparaison.png`, `reglages-d-comparaison.png`).
- Affiches classiques inchangées : « Hôtel de ville » (de dos, muret) et « Un Noël en Alsace » (de face), textes puis un personnage, comparées pixel à pixel aux captures « avant » du chantier (écart maximal 18/255 sur 54 pixels d'anticrénelage, aucune différence visible) ; 3 étapes, pas de « Motif », pas de plein écran.

## Limites et points à décider
- Le résumé du panier compte le motif comme un personnage (« 1 personnage » pour le sapin seul). Corriger toucherait l'affichage du panier : laissé (« touche pas aux commandes »), déjà noté au plan.
- Le contrôle de la couleur du motif est branché sur l'ajout et la modification d'une ligne de panier (un import et deux fois deux lignes dans `configurator-routes.ts`, toute la logique dans `motifs-couleurs.ts`, refus avant toute écriture). C'est la demande 7 (« le serveur n'accepte qu'une couleur de la liste »), mais c'est le chemin du panier : à valider par l'agent principal ; le retirer = retirer ces lignes.
- Deux corrections touchent toutes les affiches, dans « Voir sur un mur » seulement : la réduction des titres longs, et les personnages à leur place. L'aperçu principal, le panier et l'impression ne changent pas.
- Une ligne d'affiche à motifs sans personnage est enregistrée en vue « front », décor vide : c'est ce qui garde le panier et l'impression sans muret, sans toucher à pdf.ts ni au panier.
- L'écran BO « Couleurs des motifs » n'a pas pu être vu à l'écran (pas de compte BO) : `astro check` passe, la route répond (redirection vers la connexion), le format du réglage est celui que l'API lit (testé).
- En passant de l'étape 1 à l'étape 2 par « Continuer » après avoir fait défiler l'étape 1, la fenêtre garde sa position (comme entre les autres étapes, toutes affiches).
