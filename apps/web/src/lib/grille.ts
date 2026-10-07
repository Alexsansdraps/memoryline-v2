/**
 * Combien d'affiches par ligne, réglé au back-office (« Contenu du site ›
 * Affichage des produits ») et appliqué à TOUTES les grilles du site :
 * catalogue, rayons et collections, accueil, recherche, pages du site.
 *
 * Un réglage général, et — si la boutique le veut — un réglage par genre de
 * page qui prend le pas sur lui (les clés : @memoryline/types, grille.ts) :
 *   affichage.colonnes        sur ordinateur (2 à 6, 3 par défaut)
 *   affichage.colonnesMobile  sur téléphone  (1 ou 2, 2 par défaut)
 *   affichage.colonnes.accueil, affichage.colonnesMobile.accueil… vides
 *   tant que la page suit le réglage général.
 * La tablette en découle : une colonne de moins que l'ordinateur, trois au
 * plus — avec trois sur ordinateur, elle garde les deux d'avant ce réglage.
 *
 * Les colonnes passent par des variables CSS (.ml-grille-produits, dans
 * global.css) : Tailwind ne fabrique que les classes écrites en toutes
 * lettres dans le code, pas « grid-cols-{réglage} ».
 */
import {
  COLONNES_ORDINATEUR,
  COLONNES_TELEPHONE,
  cleColonnes,
  cleColonnesTelephone,
  colonnesLues,
  type PageGrille,
} from "@memoryline/types";
import { setting } from "./api.ts";

export type { PageGrille };

export interface Grille {
  mobile: number;
  tablette: number;
  ordinateur: number;
}

/**
 * La grille d'un genre de page : son propre réglage s'il en a un, le réglage
 * général sinon. Sans genre, le réglage général seul.
 *
 * Les quatre lectures ne coûtent qu'un aller-retour : `setting()` lit la
 * table des réglages une fois par page (cache de deux secondes, api.ts).
 */
export async function grilleProduits(page?: PageGrille): Promise<Grille> {
  const [ordi, mobile, ordiPage, mobilePage] = await Promise.all([
    setting(cleColonnes(), String(COLONNES_ORDINATEUR.defaut)),
    setting(cleColonnesTelephone(), String(COLONNES_TELEPHONE.defaut)),
    page ? setting(cleColonnes(page), "") : Promise.resolve(""),
    page ? setting(cleColonnesTelephone(page), "") : Promise.resolve(""),
  ]);
  const ordinateurGeneral = colonnesLues(
    ordi,
    COLONNES_ORDINATEUR,
    COLONNES_ORDINATEUR.defaut,
  );
  const telephoneGeneral = colonnesLues(
    mobile,
    COLONNES_TELEPHONE,
    COLONNES_TELEPHONE.defaut,
  );
  const ordinateur = colonnesLues(ordiPage, COLONNES_ORDINATEUR, ordinateurGeneral);
  const telephone = colonnesLues(mobilePage, COLONNES_TELEPHONE, telephoneGeneral);
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
 *
 * `pleineLargeur` : une grille SANS cadre ne plafonne pas à 1600 px. C'est
 * la vitrine de l'accueil, posée bord à bord : mesuré sur un écran de
 * 1920 px, ses vignettes font 598 px de large quand l'ancienne valeur en
 * annonçait 507, et sur un écran de 2560 px, 810 — servies en 600, donc
 * floues. Au-delà de 1600 px, la largeur se calcule donc sur l'écran : 96 px
 * de marges, 8 px par gouttière, et 16 px pour la barre de défilement, que
 * « 100vw » compte et la page non. Ces 16 px ne sont pas un détail : sans
 * eux, l'écran de 1920 px — le plus courant — annonçait 603 px et recevait
 * la version de 900 au lieu de celle de 600, 28 Ko de plus par vignette.
 */
export function sizesGrille(g: Grille, { pleineLargeur = false } = {}): string {
  return [
    pleineLargeur
      ? `(min-width: 1600px) calc((100vw - ${112 + 8 * (g.ordinateur - 1)}px) / ${g.ordinateur})`
      : `(min-width: 1600px) ${Math.round(1520 / g.ordinateur)}px`,
    `(min-width: 1024px) calc((100vw - 96px) / ${g.ordinateur})`,
    `(min-width: 768px) calc((100vw - 56px) / ${g.tablette})`,
    `calc((100vw - 20px) / ${g.mobile})`,
  ].join(", ");
}

/**
 * La même largeur, pour une grille posée dans une colonne de lecture — les
 * blocs de produits des pages du site : un cadre de 1000 px au plus, 24 px de
 * marge de chaque côté, 48 dès 1024 px (il reste alors 904 px).
 */
export function sizesGrilleColonne(g: Grille): string {
  return [
    `(min-width: 1024px) ${Math.round(904 / g.ordinateur)}px`,
    `(min-width: 768px) calc((100vw - 48px) / ${g.tablette})`,
    `calc((100vw - 48px) / ${g.mobile})`,
  ].join(", ");
}
