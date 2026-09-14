/**
 * Cadres — partagé entre la boutique, le configurateur, l'API et le
 * back-office.
 *
 * Deux règles vivent ici, et chacune doit se lire pareil partout.
 *
 * 1. LE PRIX SUIT LE FORMAT. Un cadre A3 est plus grand, donc plus cher, qu'un
 *    cadre A4 : un supplément unique facturait l'un au prix de l'autre. Le
 *    configurateur l'affiche et le serveur le facture avec la même fonction —
 *    sinon la cliente découvre au panier un supplément qu'elle n'a pas vu.
 *
 * 2. PROPOSER LES CADRES SUR LE SITE est un réglage à part du stand. Tant que
 *    la boutique ne sait pas expédier un cadre, le site les cache ; le stand,
 *    où l'affiche repart sous le bras, continue de les proposer.
 */

/** Les deux suppléments d'un cadre, en centimes, tels que le catalogue les porte. */
export interface PrixDuCadre {
  priceA4Cents: number;
  priceA3Cents: number;
}

/**
 * Le supplément d'un cadre pour le format de l'affiche, en centimes.
 *
 * Seuls l'A4 et l'A3 existent (POSTER_FORMATS). Tout ce qui n'est pas « A3 »
 * paie donc le prix A4 : un format absent vaut A4 partout ailleurs dans la
 * boutique (`format ?? "A4"`), et un format inconnu — ligne reprise de
 * l'ancienne boutique, format ajouté un jour sans prix de cadre — retombe sur
 * le format de base plutôt que de facturer un cadre à zéro ou de faire
 * échouer l'ajout au panier.
 */
export function prixDuCadreCents(
  cadre: PrixDuCadre,
  format: string | null | undefined,
): number {
  return format === "A3" ? cadre.priceA3Cents : cadre.priceA4Cents;
}

/** La clé du réglage « Proposer les cadres sur le site » (table `setting`). */
export const REGLAGE_CADRES_SITE = "cadres.site";

/**
 * Le réglage lu en base dit-il que le site propose les cadres ?
 *
 * Absent, il vaut OUI : c'est ce que faisait la boutique avant que le réglage
 * existe, et une boutique qui n'y a jamais touché ne doit rien voir changer.
 * Seul un « non » explicite les cache. Le back-office l'écrit en booléen ; une
 * valeur passée par un écran de textes arriverait en chaîne, on la lit aussi.
 */
export function cadresProposesSurLeSite(valeur: unknown): boolean {
  if (valeur === false || valeur === 0) return false;
  if (typeof valeur === "string")
    return !["false", "0", "off", "non", "no"].includes(
      valeur.trim().toLowerCase(),
    );
  return true;
}
