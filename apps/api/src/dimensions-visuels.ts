/**
 * La largeur et la hauteur RÉELLES d'un visuel de data/assets.
 *
 * Le site les écrivait en dur — 1020 × 1400, « le rapport des visuels de la
 * boutique » — et annonçait au navigateur une version de 1400 px de large qui
 * n'existe pas : l'API n'agrandit jamais une image (`withoutEnlargement`), et
 * 173 visuels sur 178 font 1020 px. Mesuré sur la fiche, à 1024 px d'écran en
 * haute définition : le navigateur prenait la « 1400 », recevait 1020 px, en
 * déduisait une image plus petite qu'annoncé et l'affichait à 463 px dans une
 * colonne qui en offrait 594. Les cinq autres visuels n'ont pas tous le même
 * rapport non plus (1055 × 1491 pour l'affiche tirée d'une photo).
 *
 * La mesure se fait ici, à la lecture, plutôt qu'à l'envoi comme pour les
 * bandeaux visuels : les 178 visuels déjà en place n'ont jamais été mesurés,
 * et ce sont eux qu'on sert. Lire l'en-tête d'un fichier coûte une à deux
 * millisecondes ; la réponse est gardée en mémoire, et elle ne périme pas —
 * un visuel envoyé reçoit un nom neuf (préfixe unique), jamais l'ancien.
 *
 * Une adresse extérieure (https://…) n'est pas mesurée, et un fichier
 * illisible non plus : la réponse est alors `null`, et le site garde ses
 * valeurs par défaut. Une mesure ratée ne doit jamais coûter une page.
 */

import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ASSETS_DIR = resolve(fileURLToPath(import.meta.url), "../../../../data/assets");

export interface Dimensions {
  largeur: number;
  hauteur: number;
}

/** Les visuels déjà mesurés, par nom de fichier. */
const mesures = new Map<string, Dimensions>();

/**
 * Les dimensions d'un visuel désigné par son adresse publique
 * (« /assets/abc-lyon.jpg »), ou `null` si on ne peut pas les lire.
 *
 * Ce sont celles du fichier tel qu'il est enregistré, sans tenir compte d'une
 * éventuelle rotation EXIF : les tailles calculées par l'API (`?l=`) ne la
 * tiennent pas davantage, et ce sont elles que le navigateur affiche.
 */
export async function dimensionsDuVisuel(
  adresse: string | null | undefined,
): Promise<Dimensions | null> {
  const m = /^\/assets\/([^/?#]+)$/.exec(String(adresse ?? ""));
  if (!m) return null;
  // basename() : un nom venu de la base ne doit pas pouvoir sortir du dossier.
  const fichier = basename(m[1]!);
  const deja = mesures.get(fichier);
  if (deja) return deja;
  try {
    const { width, height } = await sharp(resolve(ASSETS_DIR, fichier)).metadata();
    if (!width || !height) return null;
    const d = { largeur: width, hauteur: height };
    mesures.set(fichier, d);
    return d;
  } catch {
    // Fichier absent ou format inconnu : pas de mesure, et pas de mémoire
    // non plus — le fichier peut arriver plus tard (copie en cours).
    return null;
  }
}
