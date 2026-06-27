# Spécification de rendu du configurateur memoryline.fr (capturé avant suppression)

## Composition d'un personnage (preview)
Chaque personnage = pile de couches SVG superposées en absolu, MÊME viewBox 500×1000 :
  <span class="absolute inset-0 aspect-square">
    <svg viewBox="0 0 500 1000" width="50%" preserveAspectRatio="xMidYMax meet">…</svg>
  </span>
Ordre d'empilement (bas → haut) : Base → Bottoms (bas) → Clothes (haut) → Hair → Accessories.
`preserveAspectRatio="xMidYMax meet"` = centré horizontalement, aligné EN BAS.

## Classes de couleur suffixées par un hash unique
Les classes `.st0`, `.st1`… sont renommées `.st0-<hash8>` par instance pour éviter
les collisions entre SVG inline sur la même page. Recoloration = changer `fill` de `.stN-<hash>`.

## Vignettes de slot = viewBox ZOOMÉ sur la zone
- Vêtements : viewBox="-50 275 600 1000"
- Pantalon  : viewBox="50 575 400 350"
- Coupe     : viewBox="50 50 400 400"
- Accessoire : viewBox="50 0 400 400"
- Personnage entier : viewBox="0 0 500 1000"

## Sections de l'éditeur (ordre)
1. Choix du personnage (galerie ~35 persos : Male_1-4, Female_1-4, Boys_1-2, Girl_1,
   Teenage_*, Baby_Boy/Girl, animaux Dog/Cat) + nuancier PEAU
2. Vêtements + nuancier
3. Pantalon + nuancier
4. Coupes de cheveux (1ère vignette = "réinitialiser"/aucun) + nuancier
5. Accessoires (1ère vignette = aucun) 

## Nuanciers exacts (RGB)
- Peau : 255,238,224 / 255,226,192 / 246,210,169 / 225,180,128 / 184,138,108 / 139,91,56
- Vêtements : 250,250,250 / 255,150,191 / 158,223,191 / 200,228,214 / 189,18,18 / 0,86,175 / 184,85,29 / 0,0,0
- Pantalon : 237,215,198 / 184,85,29 / 94,154,191 / 22,81,118 / 84,84,84 / 0,0,0
- Cheveux : 232,232,232 / 241,203,158 / 231,176,51 / 184,85,29 / 214,182,149 / 191,129,88 / 107,62,30 / 84,21,7 / 36,34,44

## Layout popup
Gauche 35% = Prévisualisation (le perso en cours). Droite = sections scrollables.
Barre "Retour" bleue sticky en haut. Titre section 4xl + flèches gauche/droite (carrousel keen-slider).
