/**
 * Les nuanciers des personnages : peau, cheveux / pelage, vêtements, pantalon.
 *
 * Ils vivaient en dur dans le code du configurateur (packages/configurator,
 * store.ts), invisibles au back-office : « il n'existe pas dans Catégories de
 * pièces alors qu'il est bien côté client » (Margaux, à propos du nuancier
 * de peau). Ils se règlent maintenant dans Personnages › Catégories de
 * pièces, section « Nuanciers des personnages », et se rangent comme les
 * autres.
 *
 * Ce module est la SEULE source de leurs valeurs d'origine : l'API les
 * fusionne avec le réglage de la boutique (`nuanciers.base`), le configurateur
 * s'en sert de repli quand l'API ne dit rien, le back-office les remet d'un
 * clic. Les couleurs d'origine sont celles de memoryline.fr, à l'identique.
 *
 * Aucune dépendance : le back-office l'importe dans le navigateur (export
 * « @memoryline/types/couleurs »).
 */
import {
  NUANCIERS_BASE,
  PREFIXE_NUANCIER_CATEGORIE,
  estNuancierBase,
  type Nuancier,
  type NuancierBase,
} from "./couleurs-groupes.js";

function rgb(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Les nuanciers d'origine, tels que le configurateur les avait en dur. */
export const NUANCIERS_PAR_DEFAUT: Readonly<Record<NuancierBase, readonly string[]>> = {
  peau: [
    rgb(255, 238, 224),
    rgb(255, 226, 192),
    rgb(246, 210, 169),
    rgb(225, 180, 128),
    rgb(184, 138, 108),
    rgb(139, 91, 56),
  ],
  cheveux: [
    rgb(232, 232, 232),
    rgb(241, 203, 158),
    rgb(231, 176, 51),
    rgb(184, 85, 29),
    rgb(214, 182, 149),
    rgb(191, 129, 88),
    rgb(107, 62, 30),
    rgb(84, 21, 7),
    rgb(36, 34, 44),
  ],
  vetements: [
    rgb(250, 250, 250),
    rgb(255, 150, 191),
    rgb(158, 223, 191),
    rgb(200, 228, 214),
    rgb(189, 18, 18),
    rgb(0, 86, 175),
    rgb(184, 85, 29),
    rgb(0, 0, 0),
  ],
  pantalon: [
    rgb(237, 215, 198),
    rgb(184, 85, 29),
    rgb(94, 154, 191),
    rgb(22, 81, 118),
    rgb(84, 84, 84),
    rgb(0, 0, 0),
  ],
};

/** Comment la boutique les nomme. */
export const LIBELLES_NUANCIERS_BASE: Readonly<Record<NuancierBase, string>> = {
  peau: "Peau",
  cheveux: "Cheveux / pelage",
  vetements: "Vêtements",
  pantalon: "Pantalon",
};

/** Au-delà, une rangée de pastilles ne tient plus sur un téléphone. */
export const NUANCIER_MAX_COULEURS = 24;

/** Les quatre nuanciers, l'un après l'autre. */
export type NuanciersBase = Record<NuancierBase, string[]>;

/**
 * Un nuancier saisi, vérifié : de 1 à 24 couleurs « #RRGGBB », sans doublon,
 * dans l'ordre reçu (c'est l'ordre que la cliente verra). Rend la raison du
 * refus, en mots de la boutique, sinon les couleurs normalisées.
 */
export function verifierNuancier(
  brut: unknown,
): { ok: true; couleurs: string[] } | { ok: false; raison: string } {
  if (!Array.isArray(brut))
    return { ok: false, raison: "Le nuancier n'a pas pu être lu. Rechargez la page." };
  const couleurs: string[] = [];
  for (const v of brut) {
    const c = String(v ?? "").trim().toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(c))
      return { ok: false, raison: `« ${String(v)} » n'est pas une couleur (format #RRGGBB).` };
    if (couleurs.includes(c))
      return { ok: false, raison: `La couleur ${c} apparaît deux fois.` };
    couleurs.push(c);
  }
  if (couleurs.length === 0)
    return { ok: false, raison: "Un nuancier doit garder au moins une couleur." };
  if (couleurs.length > NUANCIER_MAX_COULEURS)
    return {
      ok: false,
      raison: `Un nuancier tient ${NUANCIER_MAX_COULEURS} couleurs au plus.`,
    };
  return { ok: true, couleurs };
}

/**
 * Les quatre nuanciers à servir : ceux de la boutique quand ils sont lisibles,
 * ceux d'origine sinon, nuancier par nuancier. Un réglage abîmé ne prive
 * jamais le client de pastilles.
 */
export function normaliserNuanciers(brut: unknown): NuanciersBase {
  const lu =
    brut && typeof brut === "object" && !Array.isArray(brut)
      ? (brut as Record<string, unknown>)
      : {};
  const sortie = {} as NuanciersBase;
  for (const n of NUANCIERS_BASE) {
    const v = verifierNuancier(lu[n]);
    sortie[n] = v.ok ? v.couleurs : [...NUANCIERS_PAR_DEFAUT[n]];
  }
  return sortie;
}

/**
 * Les pastilles d'un nuancier, pour une couleur du dessin d'un personnage.
 *
 * `repli` : le nuancier du groupe quand rien d'autre ne répond — la peau pour
 * la première couleur d'un humain, les vêtements pour les autres, le pelage
 * (cheveux) pour une famille d'un dessin en pixels. Une catégorie de pièces
 * absente (archivée, décochée : l'API ne l'envoie pas) ou sans couleur y
 * retombe aussi.
 */
export function couleursDuNuancier(
  nuancier: Nuancier | undefined,
  repli: NuancierBase,
  base?: Partial<Record<NuancierBase, readonly string[]>> | null,
  categories?: readonly { slug: string; colors: readonly string[] }[] | null,
): readonly string[] {
  const deBase = (n: NuancierBase) => {
    const reglees = base?.[n];
    return reglees && reglees.length ? reglees : NUANCIERS_PAR_DEFAUT[n];
  };
  if (!nuancier) return deBase(repli);
  if (estNuancierBase(nuancier)) return deBase(nuancier);
  const slug = nuancier.slice(PREFIXE_NUANCIER_CATEGORIE.length);
  const categorie = categories?.find((c) => c.slug === slug);
  return categorie && categorie.colors.length ? categorie.colors : deBase(repli);
}
