/**
 * Les couleurs d'un dessin, sans rien d'autre.
 *
 * Le back-office importe « @memoryline/types/couleurs » plutôt que le paquet
 * entier : ses écrans de couleurs tournent dans le navigateur, et n'ont que
 * faire des tarifs de livraison ou des schémas zod du reste du paquet.
 *
 * Deux sortes de dessins, deux modules, une seule porte :
 *   - couleurs-groupes : les dessins VECTORIELS, recolorés par zones `.stN`
 *     réunies en groupes ;
 *   - couleurs-image : les dessins en PIXELS (photo ou illustration
 *     enregistrée en SVG), recolorés par familles de teintes.
 */
export * from "./couleurs-groupes.js";
export * from "./couleurs-image.js";
