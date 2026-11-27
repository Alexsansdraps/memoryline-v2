# Relevé avant les personnages unifiés (27/11, lecture seule)

Rien n'a été modifié : ni le dépôt, ni la base locale, ni la prod.

## 0. À lire d'abord : la PROD n'a PAS été lue

La lecture de la prod par SSH a été **refusée par le contrôle des permissions** (« Unauthorized Access »). Je n'ai pas cherché à le contourner.
Tous les chiffres ci-dessous viennent de la **base LOCALE**. La requête de prod est prête, en lecture seule (`BEGIN TRANSACTION READ ONLY … ROLLBACK`) :
`C:/Users/Porhansl/AppData/Local/Temp/claude/328308a43fb284eb/2aa6b87f-bbbf-4c2c-8555-2fac26f738cb/scratchpad/personnages-unifies/releve/releve.sql`
Il faut la lancer une fois, après accord d'Alexandra ou de l'agent principal, avec la commande ssh du brief. La sortie locale de la même requête se trouve à côté, dans `local.txt`, pour comparer.
**Tant que la prod n'est pas relue, les numéros « libres » ci-dessous sont une proposition. Ils ne sont pas vérifiés.** C'est pour cela que je propose une plage très haute (§4).

Au sujet du message d'Alexandra (« si la plupart ressemblent déjà à ceux qui sont présents, tu peux supprimer : le calage et ceux qui sont déjà présents ! (les nouveaux persos) ») : aucun nouveau personnage n'existe encore en local. Il n'y a ni `character_type` au-delà de l'id 74, ni `asset` au-delà de l'id 93006. Il n'y a donc encore rien à supprimer ni à dédoublonner. À la création, il faudra éviter de produire des personnages presque identiques aux existants (voir §5, « ce qui manque »).

## 1. Chiffres (base locale)

- **68 personnages** : 41 de dos, 27 de face. 0 archivé, tous `active = true`.
- **Par catégorie, de dos** : Femmes 5, Hommes 5, Ados 5, Filles 2, Garçons 3, Bébés 2, Animaux 15, sans catégorie 4 (essais 71 à 74).
- **Catégories de personnages** : femmes(4), hommes(7), ados(1), filles(5), gar-ons(6), b-b-s(3), animaux(2), fauteuil-roulant(10). Il n'y a pas de catégorie « Seniors » : les âgés de face (46 et 41) sont rangés dans Femmes et Hommes.
- **Pièces de dos, non archivées** : coupes 31, hauts 23, bas 21, accessoires 15. Pièces de dos archivées : coupes 28, 29 et 500.
- **Aucun doublon** (même emplacement, même vue, même numéro).
- **Plus grands id** : `asset.id` 93006, `character_type.id` 74, `character_category.id` 10, `piece_category.id` 4.

### Numéros déjà pris (vue de dos, archives comprises)

| emplacement | numéros pris |
|---|---|
| hair | 0 à 29, 500, 501, 502, 503 |
| clothes | 0 à 22 |
| pants | 0 à 20 |
| accessory | 1 à 15 |

En face : hair 1 à 22 et 24 à 27, clothes 1 à 15 et 17 à 20, pants 1 à 18, accessory 1 à 17.

### Calages existants (`slot_adjust`)

5 personnages, 28 entrées. Aucun ne concerne un dessin « propre » de la famille 500×1000 d'origine, sauf 42 et 45.

- **42 Femme 1** : hair, accessory:14.
- **45 Femme 4** : hair:0, hair:501, hair:502.
- **70 ddd** (face, PNG d'essai) : clothes:1.
- **73 femme-test-3** : clothes:2.
- **74 Femme 6** (essai, pixels 1024×1536) : 21 entrées.

### Personnages de dos et leur cadre

Tous sont en viewBox `0 0 500 1000`, sauf :
- chat 21 / 60 et grands chiens 29, 30, 31 : 375×750 ;
- chats_2 (24) : 375×750 avec image en pixels ;
- les 5 chiens peints 58, 59, 63, 64, 65 : 768×1152, en pixels, 350 à 800 Ko ;
- Femme 6 (74) : 1024×1536, en pixels.

Les `bottom_pct`, `facteur_taille` et `decalage_x` sont dans `local.txt` (§8). Valeurs neutres partout (`facteur_taille` 1, `decalage_x` 0), sauf 58 (`facteur` 1,43, `bottom` 1), 59 (`facteur` 1,01) et 74 (`facteur` 1,25).

### Deux pièges à connaître pour l'ajout

1. **`slot_variants` NULL = TOUTES les pièces sont proposées.** C'est le cas de 69 et 70 (face), et de **71 et 72, de dos, `active = true`, sans catégorie**. Une nouvelle pièce de dos apparaîtrait donc aussitôt sur 71 et 72. Il faut vérifier en prod si ces deux essais existent et s'ils se voient. Les nouvelles pièces ne sont « invisibles » que si aucun personnage visible ne les propose.
2. **Masquer un personnage** : le BO règle `character_type.active = false` (bouton « Visible » / « Masqué », `POST /admin/characters/:id/visible`). Le personnage garde ses réglages. C'est le bon état de départ pour les nouveaux. `archived_at`, lui, signifie « retiré ». Les pièces n'ont ni `active` ni gabarit : elles ne se voient que par le `slot_variants` d'un personnage.

## 2. Le style exact (dessins de dos actuels)

Dessins ouverts en image et en source :
- bases : Male_2, Male_4, Male_1_6574…, Male_3_ceb7…, Female_2, Female_2_9ea5…, Female_1_1f3d…, Boys_1, Girl_1, Teenage_Girl_2, Baby_Boy, Big_Dog, Cat_1, Cat_2 ;
- pièces : Center_Baige_Tshirt, Short_Blonde_Hair, Center_Teal_Pants, Accessories_2_3ec4…

Planches :
- `releve/releve-bases-dos.jpg`
- `releve/releve-hair-dos.jpg`
- `releve/releve-clothes-dos.jpg`
- `releve/releve-pants-dos.jpg`
- `releve/releve-accessory-dos.jpg`
- `releve/releve-vieux-face-et-animaux-face.jpg`

### Le cadre

- En-tête Illustrator, identique partout : `<svg version="1.1" id="Male_2_1_" x="0px" y="0px" width="500px" height="1000px" viewBox="0 0 500 1000" style="enable-background:new 0 0 500 1000;" xml:space="preserve">`.
- Ni `transform`, ni `stroke`, ni dégradé, ni image, ni filtre. Uniquement des `<path d=…>` (souvent avec `class`) en coordonnées absolues du cadre.
- Fichiers légers : base de 3 à 11 Ko (13 à 31 paths), pièce de 1 à 3 Ko (1 à 6 paths).
- **Le dessin est CENTRÉ verticalement dans le cadre**, et pas posé en bas. La boîte englobante est symétrique, haut + bas = 1000 (Homme 2 : 134 à 866 ; Femme 2 : 124 à 876 ; Garçon 1 : 226 à 774 ; bébé : 320 à 680).
- **`bottom_pct` = bas du dessin / 1000**, c'est-à-dire la ligne d'assise. Le site descend le cadre de `(1 - bottom_pct)` pour poser l'assise sur le muret (PosterPreview.tsx l. 582, store.ts `bornerPlacement`).
- Pour un nouveau gabarit, `bottom_pct` se calcule donc une fois : `bas / 1000`. Ce n'est pas un calage.

### L'échelle réelle (commune à tous, sans `facteur_taille`)

Mesures sur le corps seul (groupe `*_Base_*`, autres groupes cachés), en px du cadre 500×1000. Script : `releve/anatomie.mjs`.

| gabarit | haut (crâne) | assise (bas) | hauteur | largeur de tête (oreilles comprises) | cou | carrure (mi-dos) | bottom_pct actuel |
|---|---|---|---|---|---|---|---|
| Homme (Male_2, 2/39) | 161 | 864 | 703 | 158 (x 171–328) | 88 (y≈321) | 341 (79–420) | 0,865 |
| Homme (Male_4) | 161 | 863 | 702 | 158 | 90 | 369 | 0,8625 |
| Femme (Female_2, 6/44/45/48) | 178 | 874 | 696 | 160 (x 170–329) | 80 (y≈365) | 365 (67–432) | 0,8725 |
| Ado fille (14/55) | 201 | 822 | 621 | 137 | 69 | 329 | 0,8225 |
| Ado garçon (16) | 190 | 820 | 630 | 141 | 79 | 306 | 0,82 |
| Enfant (Garçon 2, 10/50) | 257 | 777 | 520 | 160 | 77 | 271 | 0,7775 |
| Enfant (Fille 1, 11/52) | 251 | 772 | 521 | 150 | 68 | 270 | 0,77 |
| Bébé (Baby_Boy, 20) | 323 | 676 | 353 | 156 | 66 | 172 | 0,675 |
| Grand chien (Big_Dog, 28) | 255 | 743 | 488 | — | — | 159 (mi-hauteur) | 0,7425 |
| Petit chien (Small_Dog, 32) | 386 | 613 | 227 | — | — | 64 | 0,6125 |
| Chat (Cat_1 / Cat_2) | 380–407 | 592–619 | 185–239 | — | — | 64–77 | 0,59–0,62 |

**Rapports de hauteur à reproduire** (adulte = 1) : ado 0,89, enfant 0,74, bébé 0,50, grand chien 0,69, petit chien 0,32, chat 0,26 à 0,34.

**Proportions de l'adulte assis de dos** :
- tête ≈ 160 px de large, du crâne au cou ≈ 160 px, soit environ 23 % de la hauteur ;
- cou étroit (80 à 90 px) ;
- épaules qui tombent en pente douce jusqu'aux bras, collés au corps ;
- mains posées de part et d'autre sur le muret (Homme 2 : jusqu'à x 52 et 474) ;
- bassin large et plat en bas, assise = bord bas droit et arrondi aux coins (y ≈ 864 à 874) ;
- axe vertical à x = 250 ; le corps est symétrique, sauf variantes tournées (Homme 3, Fille 1, Garçon 1 : jambe ou bras sur le côté).

### Les aplats et les deux tons

- **Le ton 1** est l'aplat de la zone (`.st0{fill:#F8AA4C;}` pour la peau, etc.).
- **Le ton 2, l'ombre, prend deux formes, toujours sans contour.**
  1. **Un calque d'ombre noir à 15 %** : une classe `.stN{opacity:0.15;}` **sans `fill`**, donc noir à 15 % par-dessus. C'est l'ombre « standard » sur la peau (creux des bras, du dos) et sur la plupart des vêtements : une forme en croissant sur un côté (droit le plus souvent), qui suit le pli du dos et des manches. Opacité **toujours 0,15**, dans tous les fichiers vus. Cette classe n'est pas une zone de couleur : la recoloration ne la touche pas, et l'ombre suit donc toute couleur choisie.
  2. **Un second aplat plus sombre, nommé**, quand l'ombre doit avoir sa propre teinte, par exemple pantalon `#003636` + `#012120`, veste `#0A5299` + `#003C84`, t-shirt `#F4F3F2` + `#E0E0E0`. C'est la même teinte assombrie d'environ 30 à 60 % de luminosité. Ce ton est une zone de couleur (recolorable à part).
- Pas de visage (on est de dos), pas de trait d'oreille : la tête est un aplat peau, avec les oreilles en bosses latérales. Cheveux et chapeau la couvrent par-dessus.

### Palette par défaut constatée (de dos)

- **Peau** :
  - adulte `#F8AA4C` (Homme 2, Homme 4, Femme 2, Ado fille 2) ;
  - variantes `#F2A346` (Garçon 1), `#EF9F56` (Fille 1), `#F19645` (bébé), `#E38242` (Femme 1, plus mate) ;
  - de face, âgés : `#C87446` et `#E7965A`.
- **Cheveux** : `#E7B033` (blond), `#593314` / `#5B3214` (châtain), `#3D2711` (brun), `#99622B` / `#A86D28` (roux-brun), `#A05325`.
- **Cheveux blancs ou gris (âgés, de face)** : `#CDD3D3`, `#E0E0E0`, `#CDCECE`, `#E8ECEB`. Ce sont les teintes à reprendre pour les âgés de dos.
- **Vêtements** : bleus `#0A5299` / `#1662D3` / `#003C84` / `#002F5E`, vert `#235919` / `#194715`, orange `#CD6122` / `#993E11`, blancs `#F4F3F2` / `#E0E0E0`, lavande `#6D7090` / `#B6B9D3`, beige `#F6D994` / `#A88A4E`, rose `#FC9DD2`.
- **Âgés de face** : gilet `#BD947C` / `#936E5C` / `#875B48`, pull bordeaux `#7E211B` / `#6B1E16`, pantalon `#154357`, `#5E381D`.
- **Bas** : sarcelle `#003636` / `#012120`, marine `#13266D` / `#0C1B4C`, `#1D3339`.
- **Animaux** :
  - grand chien `#DA9730` + collier `#DB1226` ;
  - petit chien `#B3521F` + collier `#105EDD` ;
  - chat gris `#606F79` / `#59656F` ;
  - chat roux `#EAC185`… + collier `#47BA17` ;
  - cheval `#C57745` / `#472E23` ;
  - poney `#CA9958` / `#4D3F31`.
- **Couleurs proposées par catégorie de pièce** (piece_category.colors) :
  - Vêtements : FFFFFF F1CB9E E7B033 9EDFBF C8E4D6 BD1212 0056AF B8551D 000000 ;
  - Pantalons : EDD7C6 B8551D 5E9ABF 165176 545454 000000 ;
  - Coupes : E8E8E8 F1CB9E E7B033 B8551D D6B695 BF8158 6B3E1E 541507 24222C ;
  - Accessoires : FFFFFF E7B033 BD1212 0056AF B8551D 000000.

### Structure des groupes et des classes

Le fichier de base est **habillé**. Les groupes sont dans cet ordre d'écriture, et l'ordre compte (empilement-personnage.ts lit les positions) :
```
<style> .st0{fill:#F8AA4C;} .st1{opacity:0.15;} .st2{fill:…} … </style>
<g id="Male_Base_2">        corps nu en peau (.st0) + ombres (.st1)
<g id="Male_Bottoms_2">     pantalon/short (2 tons)
<g id="Male_Clothes_2">     haut (aplat + ombre .st1 ou 2e ton)
<g id="Male_Hair_2">        coiffure
<g id="Male_Accessories_2"> chapeau, casquette, casque, lunettes…
```
- **Préfixes vus** : `Male_`, `Female_`, `Boy_`, `Girl_`, `Teenage_Girl_`, `Teenage_Boy_`, `Cat_Base_1` / `Cat_Collar_1`. Suffixes Illustrator `_1_`, `_2_1_` tolérés.
- **Reconnaissance** (packages/types/src/empilement-personnage.ts) :
  - `(^|_)Bottoms?` → pants ;
  - `(^|_)Clothes` → clothes ;
  - `(^|_)Hair` → hair ;
  - `(^|_)Accessor` → accessory.
  - Le mot doit commencer un segment (« Wheel_Chair » n'est pas « Hair »).
  - Tout le reste est du corps : un collier de chien doit donc s'appeler `…_Accessories_…` s'il doit pouvoir s'ôter, sinon il fait partie du corps.
- **Classes** : `.st0`, `.st1`… numérotées DANS chaque fichier. Le moteur ne connaît que `\.(st\d+)\s*\{\s*fill:#hex` (svg-color.ts `extractColorZones`) et range les couleurs par couche (`base:st2`, `clothes:st0`). La même classe n'a donc pas le même sens d'un fichier à l'autre. La peau est `st0` dans toutes les bases vues ; l'ombre à 15 % est `st1` dans les bases et le plus souvent la dernière classe dans les pièces.
- Les métadonnées en base (`base_color_zones`, `asset.color_zones`) sont simplement les `stN → #hex` du fichier. `parts_des_zones` et `groupes_couleurs` sont calculés par l'import du BO.

### Comment une pièce masque la base

- Une pièce est un **fichier SVG plein cadre 500×1000, aux coordonnées du corps de SON personnage**. Elle a son propre `<style>` (st0…), un seul `<g id=…>` et ses paths. C'est le groupe correspondant de la base, extrait tel quel (Center_Teal_Pants = Male_Bottoms_2 décalé de +1 px en y ; Accessories_2_3ec4… = Male_Accessories_2 à l'identique).
- Quand une pièce est choisie, le groupe d'origine de la base est caché (`visibility`), puis la base est découpée en tranches intercalées dans l'ordre corps → pants → clothes → hair → accessory. Le corps nu en peau est entier sous les vêtements : un haut plus court laisse voir la peau, il ne laisse pas de trou.
- **Conséquence pour les nouveaux** :
  - dessiner un **corps nu complet** (groupe `*_Base_*` en peau, ombres `.st1`) ;
  - poser chaque pièce par-dessus, **à ses coordonnées exactes** ;
  - un haut doit couvrir épaules, dos et haut des bras jusqu'au bassin, assez large pour recouvrir le haut du bas d'origine ;
  - une coiffure couvre le crâne de la base sans le dépasser vers le bas plus que voulu ;
  - un chapeau se pose sur la coiffure : il n'est jamais dessiné « avec cheveux ».

## 3. Le meilleur point de départ par gabarit

| gabarit | point de départ | pourquoi | réserves |
|---|---|---|---|
| **Homme** | **Male_2.svg** (id 2, même corps que 39 ; 4 en est une variante) | symétrique, 5 groupes propres, déjà le gabarit pressenti dans plan.md, 4 coupes partagées (1, 13, 14, 15) | mains posées loin (x 52–474) : garder |
| **Femme** | **Female_2.svg** (id 6 ; même corps que 44, 45 et 48 : crâne 178, assise 874) | le corps le plus partagé (4 personnages), symétrique, cheveux longs sur le dos | Femme 1 (42) a un corps différent, à ne pas prendre |
| **Ado** | Teenage_Boys_1 (16) pour le garçon, Teenage_Girl_2 (14/55) pour la fille | symétriques | l'ado fille s'appuie d'un bras (main jusqu'à x≈460) |
| **Enfant** | **Boys_2.svg** (id 10, même corps que 50) | symétrique, mains le long du corps | Garçon 1 et Fille 1 sont tournés (bras ou jambe de côté) |
| **Bébé** | Baby_Boy.svg (20) | symétrique, simple (5 paths) | sans groupes nommés (`Base`/`Pants`/`Clothes` en ids de path) : à renommer dans les nouveaux |
| **Âgés (femme, homme)** | **Rien de dos.** Partir de Female_2 et Male_2 (même échelle, même assise), dos voûté, épaules plus tombantes, tête un peu avancée, donc plus basse de 15 à 25 px | — | palette et coiffures (chignon, cheveux blancs, gilet) à prendre sur Old_Lady_1 (46) et Old_Man_1 (41), qui sont **de face et debout** : style et couleurs uniquement |
| **Chien** | **Big_Dog.svg** (28) pour le grand, Small_Dog.svg (32) pour le petit | vectoriel 500×1000, aplat + collier, assis de dos | 29, 30 et 31 sont des copies 375×750 ; les 5 chiens peints (58…65) sont hors style, à ne pas prendre |
| **Chat** | **Cat_1.svg** (22) | vectoriel 500×1000, groupes `Cat_Base_1` + `Cat_Collar_1`, 10 zones | Cat_2 (23) en version simple 2 tons ; 21 et 60 en 375×750 |
| **Cheval** | **Rien de dos.** Horse_1 (25) et Pony_1 (33) sont **de face, debout, de profil** : couleurs et style seulement | — | un cheval ne s'assoit pas : décider « couché de dos » ou « debout de dos » (exception à la règle « tous assis ») |
| **Lapin / NAC** | **Rien.** À dessiner, à l'échelle du chat (hauteur ≈ 180 à 240, assise ≈ 0,60) | — | — |

## 4. Numéros et identifiants libres à utiliser

- **Numéros de pièce** (`asset.position`, vue `back`) : je propose une **plage réservée qui commence à 1000** pour chaque emplacement. Par exemple hair 1000 et suivants, clothes 1000…, pants 1000…, accessory 1000…
  - En local, le plus haut numéro pris est 503 (hair). La plage 1000 et plus est donc libre partout en local.
  - La prod peut avoir des 5xx ajoutés par Margaux : il faut **refaire la requête §6 de releve.sql en prod** et vérifier que `max(position)` reste sous 1000 pour chaque emplacement.
  - Rappel : on ne réutilise jamais un numéro, même archivé (hair 28, 29 et 500 sont archivés mais pris).
- **`character_type.id` et `asset.id`** : laisser la séquence les attribuer (local : max 74 et 93006). Ne pas forcer d'id.
- **slug** (unique) : préfixe neuf, par exemple `dos-femme-…`, `dos-homme-…`, `dos-agee-…`, `dos-chien-…`. En local, seuls `old_man_1` et `old_lady_1` sont proches. Aucun slug ne contient gabarit, senior, vieux ni unifi.
- **Fichiers** : nouveaux noms dans data/assets (638 fichiers aujourd'hui). Ne jamais réécrire un fichier existant.
- **Catégories** : réutiliser 4, 7, 1, 5, 6, 3 et 2. Il n'y a pas besoin d'une catégorie « âgés » (46 et 41 sont déjà dans Femmes et Hommes).

## 5. Cahier des charges chiffré pour les nouveaux

1. **Cadre** : SVG Illustrator-like, `viewBox="0 0 500 1000"` et `width="500px" height="1000px"`. Ni transform, ni stroke, ni dégradé, ni image.
2. **Centrage** : dessin centré verticalement (haut + bas = 1000), axe x = 250.
3. **Assise et hauteur par gabarit** (reprendre les corps de départ) :

| gabarit | assise | hauteur |
|---|---|---|
| adulte homme | y 864 | ≈ 703 |
| adulte femme | y 874 | ≈ 696 |
| âgés | même assise que l'adulte ; dos voûté, tête 15 à 25 px plus bas | ≈ 680 |
| ado | y 822 | ≈ 625 |
| enfant | y 775 | ≈ 520 |
| bébé | y 677 | ≈ 355 |
| grand chien | y 744 | ≈ 490 |
| petit chien / chat / NAC | y 600 à 620 | 180 à 240 |

4. **Réglages** : `bottom_pct` = assise / 1000 (une valeur par gabarit), `facteur_taille` = 1, `decalage_x` = 0, `slot_adjust` = `{}` (ou NULL).
5. **Tête adulte** : 158 à 160 px de large ; cou 80 à 90 ; carrure à mi-dos 340 à 370.
6. **Couleurs** :
   - aplats uniquement, dans des classes `.stN{fill:#HEX;}` d'un `<style>` en tête ;
   - ombre = `.stN{opacity:0.15;}` sans fill (une seule classe d'ombre par fichier) ;
   - 2e ton nommé seulement pour pantalons et vêtements foncés ;
   - peau par défaut `#F8AA4C` (adulte) ; variantes `#F2A346`, `#EF9F56`, `#E38242`, `#C87446`.
7. **Groupes** : `<Préfixe>_Base_N`, `_Bottoms_N`, `_Clothes_N`, `_Hair_N`, `_Accessories_N`, **dans cet ordre d'écriture**. Animaux : `<Animal>_Base_N` (+ `<Animal>_Accessories_N` pour un collier ou un nœud amovible).
8. **Pièces** : un fichier par pièce, plein cadre 500×1000, aux coordonnées du gabarit, un seul `<g id="<Préfixe>_<Famille>_N">`, de 1 à 3 Ko. Elles ne sont proposées (slot_variants) qu'aux personnages de leur gabarit.
9. **Invisibles au départ** :
   - personnage `active = false`, avec ses pièces seulement dans SON slot_variants ;
   - vérifier qu'aucun personnage visible à `slot_variants` NULL (71 et 72 en local) ne les ramasse.
10. **Ce qui manque aujourd'hui, à dessiner en priorité**, pour éviter de refaire l'existant (ce qui rejoint le message d'Alexandra : pas de doublons des actuels) :
    - âgés de dos ;
    - cheval de dos ;
    - lapin et autres NAC ;
    - accessoires d'âgés : châle, gilet, béret, casquette plate, canne posée, tricot, lunettes, chignon blanc, calvitie.

    Aujourd'hui, les chapeaux de dos sont des bobs, des casquettes, des chapeaux de paille et un béret marin. Les coupes sont surtout longues brunes et courtes.

## Fichiers de ce relevé

- `C:/Users/Porhansl/AppData/Local/Temp/claude/328308a43fb284eb/2aa6b87f-bbbf-4c2c-8555-2fac26f738cb/scratchpad/personnages-unifies/releve.md` (ce fichier)
- `…/personnages-unifies/releve/releve.sql` : requête lecture seule, à passer en prod
- `…/personnages-unifies/releve/local.txt` : sa sortie en local
- `…/personnages-unifies/releve/anatomie.mjs` : mesure du corps
- `…/personnages-unifies/releve/planche.mjs` et `releve-*.jpg` : planches
