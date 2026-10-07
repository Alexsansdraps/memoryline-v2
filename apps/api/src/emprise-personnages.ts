/**
 * Où se trouve VRAIMENT le dessin d'un personnage dans son cadre.
 *
 * Chaque personnage est dessiné dans un cadre 500 × 1000, mais n'en occupe
 * qu'une partie : un adulte de face presque toute la hauteur, un enfant les
 * trois quarts, un chat un quart, au milieu. La composition de l'affiche
 * (packages/types, composition-personnages.ts) a besoin de cette emprise pour
 * deux choses :
 *  - serrer la rangée sur la largeur RÉELLE des dessins, et non sur celle de
 *    leurs cadres — sans quoi elle rapetissait tout le monde dès six
 *    personnages, avec encore un tiers de l'affiche libre ;
 *  - reconnaître les petits (enfants, bébés, animaux) à leur taille, pour les
 *    mettre devant sur une affiche de face.
 *
 * La mesure se fait ici, à la lecture, comme celle des visuels
 * (dimensions-visuels.ts) : rien ne s'écrit en base, et les personnages déjà
 * en place n'ont jamais été mesurés. Rasteriser un dessin prend de quelques
 * dizaines de millisecondes à une demi-seconde (ceux qui contiennent une
 * image en pixels) : elle se fait donc en arrière-plan, une à la fois, et se
 * range dans data/assets/cache — un redémarrage de l'API ne la refait pas.
 * Un dessin remplacé sous le même nom (autre taille, autre date) se remesure.
 *
 * Tant qu'un dessin n'est pas mesuré, la boutique reçoit `null`, et la
 * composition fait comme l'ancienne rangée pour ce personnage-là. Une mesure
 * ratée ne coûte jamais une page. Et rien de tout cela ne touche une affiche
 * déjà composée : ses places sont enregistrées, et c'est elles que le panier,
 * la commande et le fichier d'impression relisent.
 */

import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { EmpriseDessin } from "@memoryline/types";

const ASSETS_DIR = resolve(fileURLToPath(import.meta.url), "../../../../data/assets");
const FICHIER_CACHE = resolve(ASSETS_DIR, "cache", "emprises-personnages.json");

/**
 * Taille de la mesure : le cadre 1:2, à 160 × 320 points. Un point fait
 * 0,6 % de la largeur du cadre — moins d'un millimètre sur l'affiche.
 */
const LARGEUR_MESURE = 160;
const HAUTEUR_MESURE = 320;
/** En dessous de cette opacité (sur 255), un point ne compte pas : les bords adoucis ne font pas le dessin. */
const OPACITE_MINI = 24;

/** Une mesure, et la version du fichier qu'elle décrit (taille et date). */
interface Mesure {
  version: string;
  emprise: EmpriseDessin | null;
}

const mesures = new Map<string, Mesure>();
let lectureDuCache: Promise<void> | null = null;
const enAttente: string[] = [];
let mesureEnCours = false;
let ecritureProgrammee: ReturnType<typeof setTimeout> | null = null;

/** « /assets/Male_2.svg » -> « Male_2.svg » ; rien pour une adresse d'ailleurs. */
function nomDuFichier(adresse: string | null | undefined): string | null {
  const propre = String(adresse ?? "").split(/[?#]/)[0] ?? "";
  const m = /^\/assets\/([^/]+)$/.exec(propre);
  // basename() : un nom venu de la base ne doit pas pouvoir sortir du dossier.
  return m ? basename(m[1]!) : null;
}

async function versionDu(nom: string): Promise<string | null> {
  try {
    const s = await stat(resolve(ASSETS_DIR, nom));
    return `${s.size}-${Math.round(s.mtimeMs)}`;
  } catch {
    return null;
  }
}

function lireLeCache(): Promise<void> {
  lectureDuCache ??= (async () => {
    try {
      const brut = JSON.parse(await readFile(FICHIER_CACHE, "utf8")) as Record<string, Mesure>;
      for (const [nom, m] of Object.entries(brut))
        if (m && typeof m.version === "string") mesures.set(nom, m);
    } catch {
      // Pas encore de cache, ou illisible : tout se remesurera.
    }
  })();
  return lectureDuCache;
}

/**
 * Le rectangle des points visibles du dessin, dans le cadre 1:2 où la
 * boutique le pose : centré et sans déformation, comme le navigateur (et
 * sharp pour l'impression) dessine un SVG qui n'a pas les proportions du
 * cadre — les chiens, dessinés en 2:3.
 */
async function mesurer(nom: string): Promise<EmpriseDessin | null> {
  const { data, info } = await sharp(resolve(ASSETS_DIR, nom), {
    density: 48,
    unlimited: true,
  })
    .resize(LARGEUR_MESURE, HAUTEUR_MESURE, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let gauche = info.width;
  let droite = -1;
  let haut = info.height;
  let bas = -1;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels + 3]! <= OPACITE_MINI) continue;
      if (x < gauche) gauche = x;
      if (x > droite) droite = x;
      if (y < haut) haut = y;
      if (y > bas) bas = y;
    }
  if (droite < 0) return null;
  const arrondi = (v: number) => Number(v.toFixed(4));
  return {
    gauche: arrondi(gauche / info.width),
    droite: arrondi((droite + 1) / info.width),
    haut: arrondi(haut / info.height),
    bas: arrondi((bas + 1) / info.height),
  };
}

function ecrireBientot(): void {
  if (ecritureProgrammee) return;
  ecritureProgrammee = setTimeout(async () => {
    ecritureProgrammee = null;
    try {
      await mkdir(dirname(FICHIER_CACHE), { recursive: true });
      // Écrit à côté puis renommé : un arrêt au milieu ne laisse jamais un
      // cache à moitié écrit.
      const provisoire = `${FICHIER_CACHE}.${process.pid}.tmp`;
      await writeFile(provisoire, JSON.stringify(Object.fromEntries(mesures)));
      await rename(provisoire, FICHIER_CACHE);
    } catch {
      // Le cache disque n'est qu'un raccourci : la mesure reste en mémoire.
    }
  }, 2000);
  ecritureProgrammee.unref?.();
}

/** Mesure, une à la fois, les dessins en attente. */
async function traiterLaFile(): Promise<void> {
  if (mesureEnCours) return;
  mesureEnCours = true;
  try {
    while (enAttente.length > 0) {
      const nom = enAttente.shift()!;
      const version = await versionDu(nom);
      if (!version || mesures.get(nom)?.version === version) continue;
      let emprise: EmpriseDessin | null = null;
      try {
        emprise = await mesurer(nom);
      } catch {
        // Dessin illisible : on retient « pas d'emprise » pour cette version,
        // plutôt que de le rasteriser à nouveau à chaque visite.
      }
      mesures.set(nom, { version, emprise });
      ecrireBientot();
    }
  } finally {
    mesureEnCours = false;
  }
}

function mettreEnFile(nom: string): void {
  if (!enAttente.includes(nom)) enAttente.push(nom);
  void traiterLaFile();
}

/**
 * L'emprise du dessin de base d'un personnage, si elle est déjà mesurée ;
 * sinon `null`, et sa mesure part en arrière-plan pour les visites suivantes.
 */
export async function empriseDuPersonnage(
  adresse: string | null | undefined,
): Promise<EmpriseDessin | null> {
  const nom = nomDuFichier(adresse);
  if (!nom) return null;
  await lireLeCache();
  const version = await versionDu(nom);
  if (!version) return null;
  const connue = mesures.get(nom);
  if (connue?.version === version) return connue.emprise;
  mettreEnFile(nom);
  return null;
}

/**
 * Fait mesurer d'avance les dessins donnés : appelé au démarrage, pour que
 * la première visite après une mise en ligne trouve déjà les mesures.
 */
export async function preparerLesEmprises(
  adresses: readonly (string | null | undefined)[],
): Promise<void> {
  await Promise.all(adresses.map((a) => empriseDuPersonnage(a)));
}
