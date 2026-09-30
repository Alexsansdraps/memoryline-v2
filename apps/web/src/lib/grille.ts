/**
 * Combien d'affiches par ligne, réglé au back-office (« Accueil et pied de
 * page › Affichage des produits ») et appliqué à TOUTES les grilles du site :
 * catalogue, rayons et collections, accueil, recherche, pages du site.
 *
 * Deux réglages seulement, parce que ce sont les deux que l'on regarde :
 *   affichage.colonnes        sur ordinateur (2 à 6, 3 par défaut)
 *   affichage.colonnesMobile  sur téléphone  (1 ou 2, 2 par défaut)
 * La tablette en découle : une colonne de moins que l'ordinateur, trois au
 * plus — avec trois sur ordinateur, elle garde les deux d'avant ce réglage.
 *
 * Les colonnes passent par des variables CSS (.ml-grille-produits, dans
 * global.css) : Tailwind ne fabrique que les classes écrites en toutes
 * lettres dans le code, pas « grid-cols-{réglage} ».
 */
import { setting } from "./api.ts";

export interface Grille {
  mobile: number;
  tablette: number;
  ordinateur: number;
}

const borne = (v: string, min: number, max: number, defaut: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : defaut;
};

export async function grilleProduits(): Promise<Grille> {
  const [ordi, mobile] = await Promise.all([
    setting("affichage.colonnes", "3"),
    setting("affichage.colonnesMobile", "2"),
  ]);
  const ordinateur = borne(ordi, 2, 6, 3);
  const telephone = borne(mobile, 1, 2, 2);
  return {
    mobile: telephone,
    tablette: Math.max(telephone, Math.min(ordinateur - 1, 3)),
    ordinateur,
  };
}

/** Les variables que lit `.ml-grille-produits`. */
export function styleGrille(g: Grille): string {
  return `--ml-col-mobile:${g.mobile};--ml-col-tablette:${g.tablette};--ml-col-ordi:${g.ordinateur}`;
}

/**
 * La largeur réelle d'une vignette, pour `sizes` : le navigateur choisit
 * l'image d'après elle. Fausse, l'affiche serait floue (trop petite) ou lente
 * (trop grande). Mêmes marges que la grille : cadre de 1600 px, 8 px de marge
 * sur téléphone, 24 puis 40 au-delà.
 */
export function sizesGrille(g: Grille): string {
  return [
    `(min-width: 1600px) ${Math.round(1520 / g.ordinateur)}px`,
    `(min-width: 1024px) calc((100vw - 96px) / ${g.ordinateur})`,
    `(min-width: 768px) calc((100vw - 56px) / ${g.tablette})`,
    `calc((100vw - 20px) / ${g.mobile})`,
  ].join(", ");
}
