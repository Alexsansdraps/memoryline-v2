/**
 * La mise en page d'une affiche À MOTIF (28/11, affiche éphémère du stand de
 * Mulhouse) : le texte en haut OU en bas, le motif choisi par le client, et
 * ses personnages, sans que l'un cache l'autre.
 *
 * Alexandra, le 27/11 : « texte en bas ou en haut », « mettre les personnages
 * comme d'hab ». Le 28/11 : « on utilise plus les perso de face c'est perso
 * sur le muret tout le temps ». Les personnages restent donc TOUJOURS assis
 * sur le muret, en bas, à la place que leur donne la rangée de dos ; le reste
 * s'arrange au-dessus d'eux :
 *   - texte en haut : le texte, puis le motif, puis les personnages ;
 *   - texte en bas : le motif, puis le texte, juste au-dessus des têtes —
 *     jamais sur une tête ; sans personnage, le texte descend au bas de
 *     l'affiche.
 * Le motif prend toute la place qui reste entre les deux, centré.
 *
 * Fonctions PURES, dans les unités de l'impression : fractions de la HAUTEUR
 * de l'affiche (portrait, H = √2·W), sauf mention. Elles ne décident que des
 * nombres ENREGISTRÉS dans la configuration (x/y des lignes, x/y/échelle du
 * motif) : le panier et le fichier d'impression (pdf.ts) relisent ces
 * nombres sans rien recalculer. Aucune affiche existante ne passe par ici :
 * sans motif, rien ne change.
 *
 * Les hauteurs de ligne sont celles de pdf.ts (buildTextSvg) : taille par rang
 * parmi les lignes REMPLIES, × la taille choisie sur la ligne, et la boîte de
 * chaque morceau telle que le navigateur la construit (boiteDeLigne).
 */
import {
  boiteDeLigne,
  espaceAvantLigne,
  facteurTailleLigne,
  HAUT_DU_TEXTE,
  interligneDeLigne,
  INTERLIGNE_LIGNE_POSEE,
  LARGEUR_CADRE_PERSONNAGE,
  morceauxDeTexte,
  policeParId,
  POLICE_SOUSTITRE_DEFAUT,
  POLICE_TITRE_DEFAUT,
  sousLignes,
  tailleDeLigne,
} from "@memoryline/types";
import type { LigneTexte } from "./store";

/** L'air entre le texte, le motif et les personnages (~7 mm sur un A4). */
export const ECART_BLOCS = 0.025;
/** La plus grande largeur d'un motif, en fraction de la LARGEUR de l'affiche. */
export const LARGEUR_MAX_MOTIF = 0.8;
/**
 * La place en dessous de laquelle on ne rapetisse plus le motif. Elle n'est
 * jamais atteinte avec les tailles de texte proposées (trois lignes en
 * « grand » au-dessus d'une famille assise laissent encore 0,4 de la
 * hauteur) : c'est un garde-fou, pas une règle de mise en page.
 */
const PLACE_MINI = 0.12;

/** Ce qu'on lit d'une ligne : son texte, sa police, sa taille. */
type Ligne = Pick<LigneTexte, "value" | "font" | "taille">;

const arrondi = (v: number): number => Math.round(v * 10000) / 10000;

/** La taille d'une ligne en fraction de la HAUTEUR (portrait : la largeur ÷ √2). */
function taille(ligne: Ligne, rang: number): number {
  return (tailleDeLigne(rang) * facteurTailleLigne(ligne.taille)) / Math.SQRT2;
}

/** La hauteur d'une ligne (tous ses morceaux coupés à la main) pour un interligne. */
function hauteurDeLigne(ligne: Ligne, rang: number, interligne: number): number {
  const police = policeParId(ligne.font, rang === 0 ? POLICE_TITRE_DEFAUT : POLICE_SOUSTITRE_DEFAUT);
  const t = taille(ligne, rang);
  return sousLignes(ligne.value).reduce(
    (somme, morceau) =>
      somme +
      boiteDeLigne([police, ...morceauxDeTexte(morceau, police).map((m) => m.police)], interligne)
        .hauteur *
        t,
    0,
  );
}

/**
 * La hauteur du texte EN HAUT : l'empilement de pdf.ts (espace avant chaque
 * ligne, puis la ligne à son interligne). `lignes` : les lignes REMPLIES.
 */
export function hauteurTexteEnHaut(lignes: readonly Ligne[]): number {
  return lignes.reduce(
    (somme, l, rang) =>
      somme + espaceAvantLigne(rang) * taille(l, rang) + hauteurDeLigne(l, rang, interligneDeLigne(rang)),
    0,
  );
}

/** Les hauteurs et les écarts du bloc posé en bas, ligne par ligne. */
function blocEnBas(lignes: readonly Ligne[]): { hauteurs: number[]; ecarts: number[]; total: number } {
  const hauteurs = lignes.map((l, rang) => hauteurDeLigne(l, rang, INTERLIGNE_LIGNE_POSEE));
  const ecarts = lignes.map((l, rang) => (rang === 0 ? 0 : espaceAvantLigne(rang) * taille(l, rang)));
  const total = hauteurs.reduce((s, h) => s + h, 0) + ecarts.reduce((s, e) => s + e, 0);
  return { hauteurs, ecarts, total };
}

/** La hauteur du texte EN BAS (bloc de lignes posées). `lignes` : les REMPLIES. */
export function hauteurTexteEnBas(lignes: readonly Ligne[]): number {
  return lignes.length ? blocEnBas(lignes).total : 0;
}

/**
 * Où s'arrête, en bas, le texte EN BAS : juste au-dessus de la plus haute des
 * têtes (`hautsPersonnages`, le haut du dessin de chacun), un écart d'air
 * entre les deux — ou, sans personne, à la même distance du bord bas que le
 * texte en haut l'est du bord haut (HAUT_DU_TEXTE).
 */
export function basDuTexteEnBas(hautsPersonnages: readonly number[]): number {
  return hautsPersonnages.length
    ? Math.min(...hautsPersonnages) - ECART_BLOCS
    : 1 - HAUT_DU_TEXTE;
}

/**
 * Les places des lignes quand le texte est EN BAS : chaque ligne posée (x/y =
 * son centre, comme une ligne déplacée à la main, que pdf.ts sait déjà
 * imprimer), dans l'ordre, le bas du bloc en `bas` (basDuTexteEnBas).
 * `lignes` : les REMPLIES ; le résultat est dans le même ordre.
 */
export function placesTexteEnBas(
  lignes: readonly Ligne[],
  bas: number = 1 - HAUT_DU_TEXTE,
): { x: number; y: number }[] {
  if (!lignes.length) return [];
  const { hauteurs, ecarts, total } = blocEnBas(lignes);
  let y = bas - total;
  return lignes.map((_, rang) => {
    y += ecarts[rang]!;
    const centre = y + hauteurs[rang]! / 2;
    y += hauteurs[rang]!;
    // Bornée à l'affiche : le schéma de la configuration refuse un centre
    // hors de [0 ; 1] (il n'arrive qu'avec une affiche absurde, des dizaines
    // de personnages géants).
    return { x: 0.5, y: arrondi(Math.min(1, Math.max(0, centre))) };
  });
}

/** La proportion d'un SVG, hauteur ÷ largeur, lue dans son viewBox (à défaut, width/height). */
export function proportionDuSvg(svg: string | undefined): number | null {
  if (!svg) return null;
  const racine = /<svg\b[^>]*>/.exec(svg)?.[0];
  if (!racine) return null;
  const vb = /\sviewBox\s*=\s*"([^"]*)"/.exec(racine)?.[1]?.trim().split(/[\s,]+/).map(Number);
  if (vb && vb.length === 4 && vb.every(Number.isFinite) && vb[2]! > 0 && vb[3]! > 0)
    return vb[3]! / vb[2]!;
  const l = Number(/\swidth\s*=\s*"([\d.]+)/.exec(racine)?.[1]);
  const h = Number(/\sheight\s*=\s*"([\d.]+)/.exec(racine)?.[1]);
  return l > 0 && h > 0 ? h / l : null;
}

/**
 * La place du motif : centré en largeur, au milieu de la place que laissent
 * le texte et les têtes des personnages assis sur le muret, aussi grand
 * qu'elle le permet (au plus LARGEUR_MAX_MOTIF de la largeur).
 *
 *   - texte en haut : de sous le texte jusqu'au-dessus des têtes (sans
 *     personne : jusqu'à la marge du bas) ;
 *   - texte en bas : de la marge du haut jusqu'au-dessus du texte, lui-même
 *     posé au-dessus des têtes (basDuTexteEnBas).
 *
 * Le résultat se lit comme la place d'un personnage (centre du cadre, échelle
 * relative à LARGEUR_CADRE_PERSONNAGE) : pdf.ts pose la couche à la largeur
 * 0,22 × échelle × W, à hauteur proportionnelle au SVG, centrée en (x·W, y·H) ;
 * l'aperçu pose la même largeur au même centre. Les deux disent la même chose
 * tant que le motif n'est pas plus de deux fois plus haut que large.
 */
export function placementDuMotif(o: {
  /** Les lignes REMPLIES. */
  lignes: readonly Ligne[];
  enBas: boolean;
  /** Le haut du DESSIN de chaque personnage (vide : aucun personnage). */
  hautsPersonnages: readonly number[];
  /** Hauteur ÷ largeur du motif (1 tant que son SVG n'est pas arrivé). */
  proportion: number;
  /** Le facteur de taille du BO, borné à [0,3 ; 1] : il ne peut que réduire. */
  facteur?: number | null;
}): { x: number; y: number; scale: number } {
  const texte = o.lignes.length > 0;
  const personnages = o.hautsPersonnages.length > 0;
  const haut = !o.enBas && texte ? HAUT_DU_TEXTE + hauteurTexteEnHaut(o.lignes) + ECART_BLOCS : HAUT_DU_TEXTE;
  const bas =
    o.enBas && texte
      ? basDuTexteEnBas(o.hautsPersonnages) - hauteurTexteEnBas(o.lignes) - ECART_BLOCS
      : personnages
        ? Math.min(...o.hautsPersonnages) - ECART_BLOCS
        : 1 - HAUT_DU_TEXTE;
  const place = Math.max(PLACE_MINI, bas - haut);
  const proportion = Number.isFinite(o.proportion) && o.proportion > 0 ? o.proportion : 1;
  const facteur = Math.min(1, Math.max(0.3, Number.isFinite(o.facteur) ? Number(o.facteur) : 1));
  const largeur = Math.min(LARGEUR_MAX_MOTIF, (place * Math.SQRT2) / proportion) * facteur;
  return {
    x: 0.5,
    y: arrondi(haut + place / 2),
    scale: arrondi(largeur / LARGEUR_CADRE_PERSONNAGE),
  };
}
