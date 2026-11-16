/**
 * Les emojis des lignes de texte de l'affiche.
 *
 * Les clientes en tapent : « Joyeux Noël 🎄❤️ », « Famille 👨‍👩‍👧 ». À l'écran,
 * le navigateur les dessine en couleur avec la police emoji du téléphone ou
 * de l'ordinateur. Le fichier d'impression, lui, écrit son texte avec les
 * polices installées sur le serveur, et aucune ne sait dessiner un emoji en
 * couleur : ils disparaissaient du PDF, sans un mot.
 *
 * Ils sont donc posés à l'impression comme des IMAGES (le jeu Twemoji, cf.
 * apps/api/src/pdf.ts), chacune à la place que le navigateur lui donne. Ce
 * fichier ne dessine rien : il dit OÙ sont les emojis d'une ligne, sous quel
 * nom chercher leur image, et quelle place ils prennent.
 */

/** Un bout de ligne : du texte, ou un emoji entier (une seule « grappe »). */
export type SegmentDeLigne =
  | { type: "texte"; texte: string }
  | { type: "emoji"; emoji: string };

/*
 * La place d'un emoji, en multiples du corps de la ligne. Relevée dans le
 * navigateur (Chrome sous Windows, police Segoe UI Emoji) sur un carré plein
 * « 🟥 », qui remplit tout son dessin — comme le carré du jeu Twemoji, qui
 * remplit toute son image : le dessin fait 1,016 corps de côté, monte à
 * 0,875 corps au-dessus de la ligne de base, et occupe une avance de
 * 1,373 corps (un peu d'air de chaque côté). Les téléphones ont leur propre
 * police emoji, aux mesures voisines sans être identiques : l'écart reste de
 * l'ordre d'un dixième de corps par emoji.
 */
/** L'avance d'un emoji, espacement des lettres non compris. */
export const AVANCE_EMOJI = 1.373;
/** Le côté de son image. */
export const COTE_EMOJI = 1.016;
/** La hauteur du haut de son image au-dessus de la ligne de base. */
export const HAUT_EMOJI = 0.875;

/** Le découpage en grappes, comme le navigateur compte les « lettres ». */
const grappes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/*
 * Ce qui fait d'une grappe un emoji. Le pictogramme seul ne suffit pas :
 * « © », « ™ » ou « ↔ » sont des pictogrammes que les polices d'affiche
 * savent écrire en texte, et que le navigateur y écrit.
 */
const PICTOGRAMME = /\p{Extended_Pictographic}/u;
const DRAPEAU = /\p{Regional_Indicator}/u;
const EN_COULEUR = /^\p{Emoji_Presentation}/u;
const TEINTE_DE_PEAU = /\p{Emoji_Modifier}/u;
/** « 1️⃣ », « #️⃣ » : le caractère qui encadre. */
const TOUCHE = "⃣";
/** Demande expresse de la forme emoji (VS16), ou de la forme texte (VS15). */
const FORME_EMOJI = "️";
const FORME_TEXTE = "︎";
const LIAISON = "‍";

/**
 * Cette grappe est-elle un emoji ?
 *
 * Oui pour un drapeau, une touche, une grappe liée (famille, métier…), une
 * teinte de peau, un caractère suivi de VS16, un caractère que la norme
 * montre en couleur par défaut (🎄, ⭐, ✨). Oui encore pour les symboles
 * nus des blocs « divers » et au-delà (U+2600 et plus : ❤, ☀, ❄ sans VS16) :
 * aucune police d'affiche ne les a, et l'écran les montre en emoji. Non si
 * la grappe demande expressément la forme texte (VS15).
 */
export function estEmoji(grappe: string): boolean {
  if (!grappe || grappe.includes(FORME_TEXTE)) return false;
  if (DRAPEAU.test(grappe)) return true;
  if (grappe.includes(TOUCHE)) return true;
  if (!PICTOGRAMME.test(grappe)) return false;
  if (
    grappe.includes(FORME_EMOJI) ||
    grappe.includes(LIAISON) ||
    TEINTE_DE_PEAU.test(grappe) ||
    EN_COULEUR.test(grappe)
  )
    return true;
  return (grappe.codePointAt(0) ?? 0) >= 0x2600;
}

/** La ligne contient-elle au moins un emoji ? (Le cas rare : on teste vite.) */
export function contientEmoji(texte: string): boolean {
  if (!/[\p{Extended_Pictographic}\p{Regional_Indicator}⃣]/u.test(texte))
    return false;
  return segmentsDeLigne(texte).some((s) => s.type === "emoji");
}

/**
 * Découpe une ligne en texte et en emojis, dans l'ordre. Le texte autour
 * reste d'un seul tenant entre deux emojis, espaces comprises.
 */
export function segmentsDeLigne(texte: string): SegmentDeLigne[] {
  const segments: SegmentDeLigne[] = [];
  for (const { segment } of grappes.segment(texte ?? "")) {
    if (estEmoji(segment)) {
      segments.push({ type: "emoji", emoji: segment });
      continue;
    }
    const dernier = segments[segments.length - 1];
    if (dernier?.type === "texte") dernier.texte += segment;
    else segments.push({ type: "texte", texte: segment });
  }
  return segments;
}

/**
 * Le nom d'un emoji dans un jeu d'images : ses points de code en hexadécimal
 * minuscule, liés par des tirets, SANS les VS16. Le jeu Twemoji les garde
 * dans certains noms et pas dans d'autres (« 2764.svg » pour ❤️, mais
 * « 1f3f3-fe0f-200d-1f308.svg » pour 🏳️‍🌈) : on compare donc des deux côtés
 * sans eux.
 */
export function codeEmoji(grappe: string): string {
  return [...grappe]
    .map((c) => c.codePointAt(0)!)
    .filter((cp) => cp !== 0xfe0f)
    .map((cp) => cp.toString(16))
    .join("-");
}

/**
 * Les noms à essayer pour un emoji, du plus exact au plus approché : tel
 * quel, puis sans teinte de peau — un jeu un peu ancien a souvent le
 * personnage sans avoir toutes ses teintes.
 */
export function codesAEssayer(grappe: string): string[] {
  const exact = codeEmoji(grappe);
  const sansTeinte = codeEmoji(grappe.replace(/\p{Emoji_Modifier}/gu, ""));
  return sansTeinte && sansTeinte !== exact ? [exact, sansTeinte] : [exact];
}

/**
 * Le départ de chaque bout d'une ligne centrée sur `centre`, connaissant
 * leurs largeurs (dans la même unité). C'est le centrage du navigateur :
 * la ligne entière, espacement après la dernière lettre compris, a son
 * milieu au centre ; chaque bout commence où le précédent finit.
 */
export function departsDesSegments(largeurs: readonly number[], centre: number): number[] {
  const total = largeurs.reduce((s, l) => s + l, 0);
  const departs: number[] = [];
  let x = centre - total / 2;
  for (const l of largeurs) {
    departs.push(x);
    x += l;
  }
  return departs;
}

/** La largeur d'un emoji dans une ligne, en multiples du corps. */
export function largeurEmoji(espacement: number): number {
  // Le navigateur ajoute l'espacement des lettres après chaque grappe :
  // une famille liée n'en reçoit qu'un, comme une lettre.
  return AVANCE_EMOJI + espacement;
}

/**
 * L'image d'un emoji qui commence en `depart`, sur la ligne de base `base`,
 * au corps `taille` (en pixels) : centrée dans son avance, le haut à
 * HAUT_EMOJI corps au-dessus de la ligne de base.
 */
export function boiteEmoji(
  depart: number,
  base: number,
  taille: number,
): { x: number; y: number; cote: number } {
  return {
    x: depart + ((AVANCE_EMOJI - COTE_EMOJI) / 2) * taille,
    y: base - HAUT_EMOJI * taille,
    cote: COTE_EMOJI * taille,
  };
}
