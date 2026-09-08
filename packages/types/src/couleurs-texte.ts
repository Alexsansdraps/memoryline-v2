/**
 * Couleurs proposées pour le titre et le sous-titre d'une affiche.
 *
 * Deux, et deux seulement. Le configurateur offrait jusqu'ici un nuancier
 * complet, ce qui laissait choisir un jaune sur un ciel clair, ou un texte
 * illisible sur la moitié des fonds. Une affiche ratée ne se voit qu'une fois
 * imprimée — et c'est la boutique qui la réimprime.
 *
 * Liste PARTAGÉE, comme les polices : l'aperçu à l'écran et le PDF d'impression
 * doivent nommer exactement la même couleur, sinon l'affiche livrée n'est pas
 * celle que le client a validée.
 */

export interface CouleurTexteAffiche {
  /** Identifiant stocké dans la configuration — jamais traduit. */
  id: string;
  /** Nom montré au client. */
  libelle: string;
  /** Valeur réellement peinte, à l'écran comme à l'impression. */
  hex: string;
}

export const COULEURS_TEXTE_AFFICHE: readonly CouleurTexteAffiche[] = [
  { id: "blanc", libelle: "Blanc", hex: "#FFFFFF" },
  // Gris anthracite : franchement sombre sans être noir, il reste lisible sur
  // les fonds clairs sans écraser l'illustration comme le ferait un vrai noir.
  { id: "anthracite", libelle: "Gris anthracite", hex: "#2F3436" },
];

/** Couleur par défaut : le blanc, comme la charte des affiches. */
export const COULEUR_TEXTE_DEFAUT = COULEURS_TEXTE_AFFICHE[0]!.hex;

/**
 * Ramène une valeur enregistrée à l'une des couleurs proposées.
 *
 * Les commandes passées avant ce réglage portent des couleurs libres : on ne
 * les réécrit pas, on cherche seulement la plus proche pour l'affichage des
 * boutons. Une couleur inconnue renvoie `undefined`, à l'appelant de décider.
 */
export function couleurTexteParValeur(
  valeur: string | null | undefined,
): CouleurTexteAffiche | undefined {
  const v = String(valeur ?? "").trim().toUpperCase();
  return COULEURS_TEXTE_AFFICHE.find((c) => c.hex.toUpperCase() === v);
}
