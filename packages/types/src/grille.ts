/**
 * Combien d'affiches par ligne — les clés des réglages, partagées entre le
 * site (lib/grille.ts) et le back-office (« Contenu du site › Affichage des
 * produits »). Deux listes écrites à part finiraient par diverger : le
 * back-office enregistrerait une clé que le site ne lit pas, et le réglage
 * n'aurait aucun effet, sans que personne ne sache pourquoi.
 *
 * UN RÉGLAGE GÉNÉRAL, pour toutes les grilles du site :
 *   affichage.colonnes        sur ordinateur (2 à 6, 3 par défaut)
 *   affichage.colonnesMobile  sur téléphone  (1 ou 2, 2 par défaut)
 *
 * ET, SI LA BOUTIQUE LE VEUT, UN RÉGLAGE PAR GENRE DE PAGE — l'accueil à
 * quatre quand la boutique reste à trois, par exemple :
 *   affichage.colonnes.accueil, affichage.colonnesMobile.accueil, etc.
 * Vide, il vaut « comme le réglage général » : c'est son état d'usine, et
 * c'est ce qui garde l'écran simple pour qui ne veut qu'un seul chiffre.
 *
 * Aucun préfixe privé (« salon. », « ia. », « relance. ») : la route
 * publique des réglages les retire, et le site ne verrait jamais la valeur.
 */

/** Les genres de pages qui montrent une grille d'affiches. */
export const PAGES_GRILLE = [
  { page: "accueil", libelle: "Accueil (la vitrine)" },
  { page: "boutique", libelle: "Boutique : rayons et collections" },
  { page: "recherche", libelle: "Résultats de recherche" },
  { page: "pages", libelle: "Pages du site (blocs de produits)" },
] as const;

export type PageGrille = (typeof PAGES_GRILLE)[number]["page"];

/** Bornes et valeur d'usine, sur ordinateur puis sur téléphone. */
export const COLONNES_ORDINATEUR = { min: 2, max: 6, defaut: 3 } as const;
export const COLONNES_TELEPHONE = { min: 1, max: 2, defaut: 2 } as const;

/** La clé du nombre de colonnes sur ordinateur — générale, ou d'une page. */
export function cleColonnes(page?: PageGrille): string {
  return page ? `affichage.colonnes.${page}` : "affichage.colonnes";
}

/** La clé du nombre de colonnes sur téléphone — générale, ou d'une page. */
export function cleColonnesTelephone(page?: PageGrille): string {
  return page ? `affichage.colonnesMobile.${page}` : "affichage.colonnesMobile";
}

/**
 * Un nombre de colonnes lu en base, ramené dans ses bornes.
 *
 * Tout ce qui n'est pas un entier permis — vide, « 7 », du texte — rend le
 * repli : pour une page, le réglage général ; pour le réglage général, la
 * valeur d'usine. Une faute de frappe ne peut donc jamais casser une grille.
 */
export function colonnesLues(
  brut: unknown,
  bornes: { min: number; max: number },
  repli: number,
): number {
  const n =
    typeof brut === "number"
      ? Math.round(brut)
      : typeof brut === "string" && brut.trim()
        ? Math.round(Number(brut))
        : NaN;
  return Number.isFinite(n) && n >= bornes.min && n <= bornes.max ? n : repli;
}
