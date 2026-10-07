/**
 * Le dessin du filigrane : un cercle fin au centre de l'aperçu, et le logo de
 * la boutique à l'intérieur, en blanc presque transparent.
 *
 * Il est dessiné à DEUX endroits : par le navigateur, en calque SVG posé sur
 * l'aperçu du module (packages/configurator/src/components/Filigrane.tsx),
 * et par le serveur, cuit dans les pixels des aperçus d'affiche tirée d'une
 * photo (apps/api/src/ia.ts, calquesFiligrane). Les deux lisaient chacun leurs
 * propres nombres, recopiés à la main : un réglage fait d'un côté seulement
 * aurait donné deux filigranes différents sur le même panier. Ils lisent
 * désormais ceux-ci.
 *
 * Les tailles sont des fractions du PETIT côté de l'image — la largeur d'une
 * affiche en portrait, comme dans le module. Mesuré sur la largeur, le cercle
 * d'un aperçu en paysage aurait débordé en haut et en bas de l'image.
 *
 * RÉGLÉ LE 7 OCTOBRE 2026 À LA DEMANDE DE LA BOUTIQUE : « cercle trop visible
 * et logo trop petit ». Le cercle passe d'un trait de 2 px à 50 % d'opacité à
 * un trait d'1 px à 20 % : on le devine plus qu'on ne le voit. Le logo passe
 * de 42 % à 74 % du petit côté — l'écriture elle-même, une fois retirées les
 * marges transparentes du fichier, de 31 à 55 % : c'est lui, désormais, qui
 * gâche une capture d'écran, et non plus le cercle. Son opacité ne bouge pas
 * (40 %) : plus grand, il couvre déjà bien plus de l'affiche. Le cercle grandit
 * avec lui pour que l'écriture tienne dedans, coins compris.
 */
export const FILIGRANE = {
  /** Rayon du cercle, en fraction du petit côté (0,35 : 70 % de diamètre). */
  rayonCercle: 0.35,
  /**
   * Épaisseur du trait du cercle, en pixels VUS sur un aperçu d'environ
   * 600 px de large. Le module la garde telle quelle à toutes les tailles
   * d'écran (`vector-effect: non-scaling-stroke`) ; le serveur la convertit
   * à la taille de son image.
   */
  traitCercle: 1,
  /** Opacité du trait du cercle, de 0 à 1. */
  opaciteCercle: 0.2,
  /**
   * Largeur du fichier du logo (logo-filigrane.png, 500 × 222, marges
   * transparentes comprises), en fraction du petit côté.
   */
  largeurLogo: 0.74,
  /** Opacité du logo, de 0 à 1. */
  opaciteLogo: 0.4,
} as const;
