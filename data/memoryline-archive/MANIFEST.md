# Archive memoryline.fr — capturée le 2026-06-28 (avant suppression du site)

## Contenu (data/memoryline-archive/)
- svg/ : 245 SVG (86 Mo) — personnages complets + couches + animaux + quelques fonds
- characters/ : 33 personnages complets pré-composés (Male_1-4, Female_1-4, Boys, Girl,
  Teenage, Baby, Small/Big Dog, Cat, Horse, Pony, variantes couleur chiens)
- customizer-config.json : structure front/back × slots (clothes/pants/hair/head) avec variantes
- customizer-source.js : bundle JS du customizer (223 Ko)
- RENDU-SPEC.md : spec de rendu (empilement calques, viewBox, recoloration, nuanciers)
- svg-urls.txt / network-svg-urls.txt : toutes les URLs CDN relevées

## Structure d'un personnage
Chaque perso (ex. Male_2.svg) = 1 SVG complet viewBox 500×1000 avec sous-groupes :
  {Nom}_Base, {Nom}_Bottoms, {Nom}_Clothes, {Nom}_Hair, {Nom}_Accessories
Couches interchangeables (Clothes_1..4, Hair_*, Bottoms_*, Accessories_*) + recoloration .stN.

## Fonds de villes
138 fonds dans data/assets/ (import initial) + quelques-uns ici. Couverture villes via les 2 sources.
