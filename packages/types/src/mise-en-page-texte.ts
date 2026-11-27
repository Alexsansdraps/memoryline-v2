/**
 * La mise en page des lignes de texte d'une affiche : où commence le bloc,
 * quelle place il a en largeur, la taille de chaque ligne, son interligne,
 * l'espace qui la précède et l'espacement de ses lettres.
 *
 * Ces nombres décrivent CE QUE LA CLIENTE VOIT dans le module. L'aperçu les
 * écrit tels quels en CSS (packages/configurator/src/components/
 * PosterPreview.tsx, et apps/web/src/islands/AfficheIA.tsx pour une affiche
 * tirée d'une photo) ; le fichier d'impression (apps/api/src/pdf.ts,
 * buildTextSvg) refait le calcul du navigateur, avec boiteDeLigne plus bas,
 * pour poser chaque ligne de base au même endroit.
 *
 * Ils ont longtemps vécu en deux exemplaires, qui avaient divergé : relevé le
 * 7 octobre 2026, la première ligne s'imprimait en faux gras, la deuxième
 * 2 % de la largeur plus bas qu'à l'écran (4,6 mm sur un A4), la troisième un
 * quart plus grande, et un nom trop long — SAINT-VALERY-SUR-SOMME — passait
 * sur deux lignes à l'écran quand le papier le gardait sur une seule. Un
 * nombre changé ici change désormais l'écran ET le papier.
 *
 * PAS DE GRAS. Aucune des polices d'affiche n'a de graisse grasse : un gras
 * serait fabriqué de toutes pièces, par le navigateur d'un côté et par le
 * moteur d'impression de l'autre, et pas de la même épaisseur. Ce qui
 * distingue la ligne de tête, c'est sa taille et l'air entre ses capitales.
 */
import type { PoliceAffiche } from "./fonts.js";

/** Haut du bloc de texte, en fraction de la HAUTEUR de l'affiche. */
export const HAUT_DU_TEXTE = 0.05;

/**
 * Marge laissée de chaque côté du bloc, en fraction de la LARGEUR de
 * l'affiche : la feuillure d'un cadre en mange près d'un centimètre.
 */
export const MARGE_DU_TEXTE = 0.06;

/**
 * Largeur offerte au texte, en fraction de la largeur de l'affiche. Une ligne
 * qui n'y tient pas est RÉDUITE jusqu'à y tenir, jamais repliée : replié, un
 * nom de lieu se coupe où le navigateur veut (« SAINT-VALERY-SUR- » /
 * « SOMME »), et le bloc descend dans le dessin. Pour couper ailleurs, la
 * cliente tape Entrée là où elle le veut (sousLignes).
 */
export const LARGEUR_DU_TEXTE = 1 - 2 * MARGE_DU_TEXTE;

/**
 * Taille de chaque ligne, en centièmes de la largeur du bloc (l'unité `cqw`
 * de l'aperçu), par rang parmi les lignes REMPLIES — et non par numéro de
 * ligne : une ligne 1 laissée vide ne doit pas condamner le reste du texte à
 * la petite taille. La première domine, les suivantes se font discrètes ; les
 * trois réunies occupent moins de 15 % de la hauteur, loin au-dessus des
 * personnages.
 */
const TAILLES_CQW = [8, 5.5, 4.6] as const;

/** Taille d'une ligne en `cqw` (centièmes de la largeur du bloc de texte). */
export function tailleDeLigneCqw(rang: number): number {
  return TAILLES_CQW[rang] ?? TAILLES_CQW[TAILLES_CQW.length - 1]!;
}

/**
 * Taille d'une ligne en fraction du PETIT côté de l'affiche : sa largeur en
 * portrait, sa hauteur en paysage — sinon le texte d'une affiche couchée
 * grossirait de 41 %. Le format A se lisant sur le rapport √2, c'est la même
 * taille que l'aperçu en paysage, qui multiplie ses `cqw` par 1/√2.
 */
export function tailleDeLigne(rang: number): number {
  return (tailleDeLigneCqw(rang) / 100) * LARGEUR_DU_TEXTE;
}

/**
 * Multiplicateur de la taille choisie sur une ligne (27/11, Alexandra : « 3
 * tailles de texte à chaque fois sur chaque ligne »). Moyen ou absent = 1
 * exactement : rien ne bouge pour une ligne d'avant. L'aperçu et le PDF
 * lisent tous deux cette fonction.
 */
export function facteurTailleLigne(taille: string | null | undefined): number {
  return taille === "s" ? 0.8 : taille === "l" ? 1.25 : 1;
}

/** Interligne (`line-height`) : serré sur la ligne de tête, plus aéré ensuite. */
export function interligneDeLigne(rang: number): number {
  return rang === 0 ? 1.05 : 1.15;
}

/** Espace laissé au-dessus d'une ligne, en multiples de sa taille (`margin-top`). */
export function espaceAvantLigne(rang: number): number {
  return rang === 0 ? 0 : 0.1;
}

/**
 * Espacement des lettres, en multiples de la taille (`letter-spacing`) : la
 * ligne de tête, écrite en capitales, respire un peu.
 */
export function espacementDeLigne(rang: number): number {
  return rang === 0 ? 0.04 : 0;
}

/**
 * Interligne d'une ligne déplacée à la main (affiche tirée d'une photo) : le
 * bloc posé n'a pas de voisine, il garde un interligne unique.
 */
export const INTERLIGNE_LIGNE_POSEE = 1.1;

/**
 * La boîte d'une ligne de texte, telle que le navigateur la construit (CSS
 * 2.1, § 10.8), en multiples de la taille de la ligne.
 *
 * Chaque police présente sur la ligne — celle de la ligne elle-même, et celle
 * de chacun de ses morceaux (les chiffres de la manuscrite s'écrivent en
 * Caveat, cf. morceauxDeTexte) — y pose une boîte haute d'un interligne,
 * centrée sur son propre contenu (ascendante + descendante) et alignée sur la
 * ligne de base commune. La ligne fait la hauteur de leur réunion, et sa
 * ligne de base tombe à `base` sous son bord haut.
 *
 * C'est ce calcul qui place la ligne de base au même endroit à l'écran et
 * sur le papier : le PDF ne connaît que des lignes de base, le navigateur
 * que des boîtes.
 */
export function boiteDeLigne(
  polices: readonly Pick<PoliceAffiche, "ascendante" | "descendante">[],
  interligne: number,
): { base: number; hauteur: number } {
  let dessus = 0;
  let dessous = 0;
  for (const p of polices) {
    const demiInterlignage = (interligne - p.ascendante - p.descendante) / 2;
    dessus = Math.max(dessus, p.ascendante + demiInterlignage);
    dessous = Math.max(dessous, p.descendante + demiInterlignage);
  }
  return { base: dessus, hauteur: dessus + dessous };
}
