/**
 * Les dimensions des formats, écrites une fois pour toutes.
 *
 * « A4 » ne dit rien à qui achète une affiche pour un mur précis : la question
 * qu'on se pose devant un cadre vide, c'est « est-ce que ça rentre ». Le
 * panier donnait déjà la réponse, mais lui seul, et ses deux lignes étaient
 * recopiées dans un coin d'un fichier d'interface. Elles vivent désormais
 * auprès des formats eux-mêmes, et tout le monde y puise : la fiche produit,
 * le configurateur, le panier, la commande.
 *
 * Les millimètres sont ceux de la norme ISO 216. Ils sont écrits en
 * centimètres à l'écran, avec la virgule française : personne n'achète une
 * affiche de 297 millimètres.
 */
import { POSTER_FORMATS, type PosterFormat } from "./config.js";

/** Largeur et hauteur en millimètres, portrait. */
export const DIMENSIONS_FORMAT: Record<PosterFormat, { l: number; h: number }> = {
  A4: { l: 210, h: 297 },
  A3: { l: 297, h: 420 },
};

/**
 * Le séparateur décimal d'une langue : « , » en français, « . » en anglais.
 * Exporté pour `formaterPoids`, qui suit la même règle.
 */
export function separateurDecimal(locale: string): string {
  return (
    new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === "decimal")
      ?.value ?? ","
  );
}

/**
 * « 297 » → « 29,7 » (« 29.7 » en anglais). Les entiers restent entiers :
 * « 21 », pas « 21,0 ».
 */
function centimetres(mm: number, locale: string): string {
  const cm = mm / 10;
  return Number.isInteger(cm)
    ? String(cm)
    : cm.toFixed(1).replace(".", separateurDecimal(locale));
}

/**
 * Les dimensions seules : « 21 × 29,7 cm ».
 *
 * Rend une chaîne vide pour un format inconnu plutôt que d'inventer une
 * taille : mieux vaut ne rien dire que mentir sur ce qu'on livre.
 */
export function dimensionsFormat(format: string, locale = "fr-FR"): string {
  const d = (DIMENSIONS_FORMAT as Record<string, { l: number; h: number }>)[
    format
  ];
  return d ? `${centimetres(d.l, locale)} × ${centimetres(d.h, locale)} cm` : "";
}

/** Le nom et les dimensions : « A4 (21 × 29,7 cm) ». */
export function libelleFormat(format: string, locale = "fr-FR"): string {
  const d = dimensionsFormat(format, locale);
  return d ? `${format} (${d})` : format;
}

/** Les formats connus, avec de quoi les afficher. */
export function formatsAvecDimensions(): {
  format: PosterFormat;
  dimensions: string;
}[] {
  return POSTER_FORMATS.map((format) => ({
    format,
    dimensions: dimensionsFormat(format),
  }));
}
