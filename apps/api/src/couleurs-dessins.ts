/**
 * Les couleurs d'un dessin téléversé au back-office, quel que soit l'outil
 * qui l'a produit (Illustrator, Canva, vectorisation d'une image générée par
 * IA).
 *
 * La normalisation elle-même vit dans @memoryline/types (svg-normalisation) :
 * ici, on lit le fichier, on MESURE la surface que chaque couleur peint
 * vraiment — c'est elle qui décide quelle couleur est « la » couleur d'un
 * groupe, et laquelle vient en premier —, et on range le résultat.
 *
 * LE FICHIER D'ORIGINE N'EST JAMAIS RÉÉCRIT. La version normalisée part dans
 * un nouveau fichier, et c'est l'enregistrement du personnage ou de la pièce
 * qui pointe dessus. Un dessin qui n'a rien à changer (Illustrator, ou déjà
 * normalisé) garde son adresse.
 *
 * CERTAINS DESSINS N'EN SONT PAS. Sept animaux téléversés sont des photos ou
 * des illustrations simplement enregistrées en SVG : pas un tracé, une image
 * en pixels. Ils passent par la même porte et par le même bouton, mais leurs
 * couleurs se lisent dans leurs pixels — voir couleurs-image-fichier.ts.
 *
 * ET CERTAINS N'EN ONT MÊME PAS L'AIR : un PNG, un JPEG, un WEBP, c'est-à-dire
 * l'export par défaut de Canva. Le téléversement les accepte depuis toujours,
 * mais ce fichier-ci s'arrêtait net dès que l'extension n'était pas « .svg » :
 * aucune zone, aucune famille, et le back-office annonçait une image
 * « illisible » alors qu'elle était parfaitement bonne. Ils sont désormais
 * EMBALLÉS dans un dessin (voir `emballerLImage`) et suivent exactement le
 * chemin des sept animaux — mêmes familles, mêmes pastilles, même PDF.
 *
 * QUAND RIEN NE SORT, ON DIT LEQUEL DES QUATRE CAS C'EST (`motif`, `phrase`) :
 * un format qu'on ne sait pas encore lire, une image réellement vide, une
 * image trop grande, ou un fichier qu'on n'a pas pu ouvrir. Les quatre ne
 * tenaient qu'en une seule phrase, qui accusait le fichier dans les trois
 * premiers cas — et la boutique refaisait des exports parfaitement bons.
 * Aucun message ne met en cause un fichier sans l'avoir vérifié.
 */
import type { Hono } from "hono";
import { resolve, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import {
  normaliserCouleursSvg,
  phraseSansCouleur,
  recolorSvg,
  type CouleursImage,
  type GroupeCouleur,
  type MotifSansCouleur,
} from "@memoryline/types";
import { lireCouleursImage } from "./couleurs-image-fichier.js";

const ASSETS_DIR = resolve(fileURLToPath(import.meta.url), "../../../../data/assets");

/** Ce que le back-office reçoit après lecture des couleurs d'un dessin. */
export interface CouleursDuDessin {
  /** Adresse du dessin à enregistrer : la version normalisée si elle existe. */
  url: string;
  /** Adresse du fichier téléversé, intact. */
  urlOrigine: string;
  colorZones: Record<string, string>;
  groupesCouleurs: GroupeCouleur[];
  /** Nombre de couleurs que la normalisation a transformées en zones. */
  zonesCreees: number;
  /** Images en pixels dans le dessin (hors masques). */
  images: number;
  /**
   * Familles de couleurs, quand le dessin est une IMAGE EN PIXELS et non un
   * vrai dessin vectoriel. Le même bouton « Détecter les couleurs » sert aux
   * deux sortes de dessins : c'est le fichier qui décide ce qu'on y lit, pas
   * la boutique. Null = dessin vectoriel, ou image dont rien n'est sorti.
   */
  couleursImage: CouleursImage | null;
  /**
   * POURQUOI rien n'est sorti d'une image, quand rien n'en est sorti.
   *
   * Le back-office n'a ainsi plus à deviner — il devinait mal, et accusait un
   * fichier parfaitement bon d'être « illisible ». Absent dès que la lecture a
   * donné quelque chose, et toujours absent pour un dessin vectoriel.
   */
  motif?: MotifSansCouleur;
  /**
   * Ce qu'il y a à dire à la boutique, tout prêt.
   *
   * LA PHRASE EST FABRIQUÉE ICI, et non dans les écrans, parce que l'écran de
   * création d'un personnage tourne en script « is:inline » : il ne peut rien
   * importer, et recopierait donc les quatre phrases pour son compte. Elles
   * divergeraient — c'est précisément ce qui est arrivé au message d'avant.
   * Le texte lui-même vit dans @memoryline/types (phraseSansCouleur).
   */
  phrase?: string;
}

/**
 * La surface que peint chaque couleur du dessin, en pixels d'un petit rendu.
 *
 * Chaque zone reçoit une couleur-témoin unique, le dessin est rendu sans
 * lissage (`crispEdges` : un bord lissé mélangerait deux témoins en une
 * teinte qui n'appartient à personne), et on compte. Ce qui est caché par une
 * autre forme ne compte pas : c'est la surface VUE, celle qui fait qu'un
 * pelage est « roux ».
 */
async function surfacesDesCouleurs(
  svg: string,
  zones: Record<string, string>,
): Promise<Record<string, number>> {
  const ids = Object.keys(zones);
  const temoins: Record<string, string> = {};
  const zoneDuTemoin = new Map<number, string>();
  ids.forEach((z, i) => {
    // Des témoins bien écartés les uns des autres, peu probables dans un dessin.
    const code = 0x10_20_30 + (i + 1) * 0x01_07_0b;
    const hex = `#${(code & 0xffffff).toString(16).padStart(6, "0")}`;
    temoins[z] = hex;
    zoneDuTemoin.set(code & 0xffffff, z);
  });
  const temoin = recolorSvg(svg, temoins).replace(
    /<svg\b/i,
    '<svg shape-rendering="crispEdges"',
  );
  const { data, info } = await sharp(Buffer.from(temoin), {
    density: 36,
    unlimited: true,
  })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const parZone = new Map<string, number>();
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3]! < 250) continue;
    const z = zoneDuTemoin.get((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
    if (z) parZone.set(z, (parZone.get(z) ?? 0) + 1);
  }
  const parCouleur: Record<string, number> = {};
  for (const [z, n] of parZone) {
    const hex = zones[z]!.toUpperCase();
    parCouleur[hex] = (parCouleur[hex] ?? 0) + n;
  }
  return parCouleur;
}

/** Les formats d'image en pixels qu'on sait emballer dans un dessin. */
const IMAGES_EN_PIXELS: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/**
 * Ce qu'on accepte de lire, en pixels et en octets.
 *
 * MESURÉ, pas supposé, sur ce conteneur (27/09/2026), en emballant une image
 * bruitée puis en lisant ses familles :
 *   1,1 Mpx / 3,8 Mo d'emballage  →   0,3 s
 *   8,7 Mpx / 30 Mo               →   2,2 s   (une page A4 à 300 ppp)
 *    12 Mpx / 42 Mo               →   2,8 s
 *    25 Mpx / 88 Mo               →   8,4 s
 *    36 Mpx / 138 Mo              →    35 s
 *    81 Mpx                       →   le processus meurt
 *
 * Les deux plafonds ne retiennent donc pas la même chose : le nombre de pixels
 * décide du coût du RENDU, le poids du fichier décide du coût du DÉCODAGE, et
 * une image peut être énorme dans une dimension sans l'être dans l'autre (un
 * aplat de 9 000 × 9 000 ne pèse que quelques dizaines de kilo-octets).
 *
 * Les valeurs sont larges à dessein : un personnage exporté de Canva en pleine
 * page A3 à 300 ppp fait 17 Mpx et quelques méga-octets. On ne refuse que
 * l'absurde — et on le DIT, au lieu de laisser la lecture traîner une minute
 * ou emporter l'API avec elle.
 */
const PIXELS_MAX = 30_000_000;
const OCTETS_IMAGE_MAX = 32 * 1024 * 1024;

/** Ce qu'a donné l'emballage d'une vraie image dans un dessin. */
type Emballage =
  | { ok: true; nomDessin: string; svg: string }
  | { ok: false; motif: MotifSansCouleur; precision?: string };

/**
 * Un nom de fichier libre, dans le dossier des assets, dérivé d'un autre.
 *
 * Le hasard à la fin évite d'écraser une version préparée plus tôt : chaque
 * détection laisse la sienne, et l'ancienne reste servie aux personnages qui
 * la citent encore.
 */
function nomVoisin(nom: string, suffixe: string, extension: string): string {
  const racine = basename(nom, extname(nom)).slice(0, 80);
  return `${racine}-${suffixe}-${randomBytes(3).toString("hex")}${extension}`;
}

/**
 * Une VRAIE image (PNG, JPG, WEBP) emballée dans un dessin, pour qu'elle
 * suive exactement le chemin des sept animaux photographiés.
 *
 * POURQUOI EMBALLER PLUTÔT QUE TRAITER L'IMAGE À PART. Toute la chaîne de
 * recoloration — la lecture des familles ici, les pastilles de la boutique,
 * le fichier d'impression — travaille sur un dessin qui porte UNE balise
 * <image> (voir couleurs-image-fichier.ts et @memoryline/types). Un PNG nu
 * n'en a pas : il tombait donc dans le trou, et le back-office annonçait une
 * image « illisible » alors qu'elle était parfaitement bonne. L'emballer, au
 * lieu d'ouvrir un second chemin, fait qu'un export Canva et un chien
 * photographié se comportent pareil, de l'écran jusqu'au PDF.
 *
 * LES OCTETS D'ORIGINE SONT GARDÉS TELS QUELS pour un PNG ou un JPEG : les
 * réencoder ferait grossir le fichier (un JPEG de photo repassé en PNG triple
 * de poids) sans rien apporter, puisque l'impression lit ces octets-là. Seuls
 * un WEBP — que la bibliothèque de rendu ne sait pas toujours lire à
 * l'intérieur d'un SVG — et une photo portant une consigne de rotation EXIF
 * sont réencodés en PNG, droits.
 *
 * Le fichier d'origine n'est jamais touché : l'emballage part dans un nouveau
 * fichier, comme la version normalisée d'un dessin vectoriel.
 */
async function emballerLImage(
  nom: string,
  octets: Buffer,
  typeMime: string,
): Promise<Emballage> {
  let contenu = octets;
  let mime = typeMime;
  let info: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    info = await sharp(octets).metadata();
  } catch {
    // L'en-tête lui-même n'est pas lisible : fichier tronqué ou abîmé.
    return { ok: false, motif: "echec-lecture" };
  }
  if (!info.width || !info.height) return { ok: false, motif: "echec-lecture" };

  // Trop grande : on refuse AVANT de décoder, sinon la lecture part pour
  // trente secondes — ou emporte l'API. Les dimensions sont dites à la
  // boutique, c'est ce qui lui permet de réexporter à la bonne taille.
  const dimensions = `${info.width} × ${info.height} pixels`;
  if (info.width * info.height > PIXELS_MAX)
    return { ok: false, motif: "image-trop-grande", precision: dimensions };
  if (octets.length > OCTETS_IMAGE_MAX)
    return {
      ok: false,
      motif: "image-trop-grande",
      precision: `${Math.round(octets.length / (1024 * 1024))} Mo`,
    };

  try {
    // `rotate()` sans angle applique la consigne EXIF de l'appareil photo :
    // sans elle, une photo prise en portrait s'emballerait couchée.
    if (mime === "image/webp" || (info.orientation ?? 1) > 1) {
      contenu = await sharp(octets).rotate().png({ compressionLevel: 9 }).toBuffer();
      mime = "image/png";
      info = await sharp(contenu).metadata();
    }
  } catch {
    return { ok: false, motif: "echec-lecture" };
  }
  const largeur = info.width;
  const hauteur = info.height;
  if (!largeur || !hauteur) return { ok: false, motif: "echec-lecture" };

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"` +
    ` width="${largeur}" height="${hauteur}" viewBox="0 0 ${largeur} ${hauteur}">` +
    `<image x="0" y="0" width="${largeur}" height="${hauteur}"` +
    ` xlink:href="data:${mime};base64,${contenu.toString("base64")}"/>` +
    `</svg>`;
  const nomDessin = nomVoisin(nom, "dessin", ".svg");
  await writeFile(resolve(ASSETS_DIR, nomDessin), svg, "utf8");
  return { ok: true, nomDessin, svg };
}

/**
 * Lit les couleurs d'un dessin du dossier des assets et, s'il le faut, en
 * enregistre la version normalisée à côté de l'original.
 */
export async function couleursDuDessin(url: string): Promise<CouleursDuDessin | null> {
  // On ne lit que dans le dossier des assets : une adresse bricolée ne doit
  // pas pouvoir faire lire un fichier quelconque du serveur.
  const nom = basename(url.split("?")[0] ?? "");
  if (!nom) return null;
  const chemin = resolve(ASSETS_DIR, nom);
  if (!chemin.startsWith(resolve(ASSETS_DIR))) return null;
  let octets: Buffer;
  try {
    octets = await readFile(chemin);
  } catch {
    return null;
  }
  const urlOrigine = `/assets/${nom}`;
  const extension = extname(nom).toLowerCase();

  // UNE VRAIE IMAGE (l'export par défaut de Canva). On l'emballe dans un
  // dessin, puis on lit ses couleurs dans ses PIXELS — le même traitement que
  // les animaux photographiés. C'est la fiche du personnage qui pointera sur
  // l'emballage ; l'original reste sur le disque, intact.
  if (extension !== ".svg") {
    // Le fichier EST une image : `images` vaut 1 même quand on ne sait pas la
    // lire. Ce qui explique l'échec, c'est `motif`, pas ce compteur.
    const rien = (motif: MotifSansCouleur, precision?: string): CouleursDuDessin => ({
      url: urlOrigine,
      urlOrigine,
      colorZones: {},
      groupesCouleurs: [],
      zonesCreees: 0,
      images: 1,
      couleursImage: null,
      motif,
      phrase: phraseSansCouleur(motif, precision),
    });

    const typeMime = IMAGES_EN_PIXELS[extension];
    // Un format qu'on ne sait pas encore lire. Le fichier n'y est pour rien :
    // c'est la seule chose que l'ancien message n'a jamais su dire.
    if (!typeMime) return rien("format-non-traite", extension || "sans extension");

    const emballe = await emballerLImage(nom, octets, typeMime).catch(
      (): Emballage => ({ ok: false, motif: "echec-lecture" }),
    );
    if (!emballe.ok) return rien(emballe.motif, emballe.precision);

    const lecture = await lireCouleursImage(emballe.svg).catch(
      () => ({ couleurs: null, motif: "echec-lecture" as MotifSansCouleur }),
    );
    // Rien à proposer : l'emballage n'apporte plus rien, on rend le fichier
    // d'origine plutôt que de laisser un dessin de plus sur le disque.
    if (!lecture.couleurs) {
      await rm(resolve(ASSETS_DIR, emballe.nomDessin)).catch(() => {});
      return rien(lecture.motif ?? "echec-lecture");
    }
    return {
      url: `/assets/${emballe.nomDessin}`,
      urlOrigine,
      colorZones: {},
      groupesCouleurs: [],
      zonesCreees: 0,
      images: 1,
      couleursImage: lecture.couleurs,
    };
  }

  const texte = octets.toString("utf8");

  // Premier passage pour connaître les zones, puis la surface réelle de
  // chacune, puis le passage définitif : il numérote les nouvelles zones de
  // la plus étendue à la plus petite et choisit les références des groupes.
  const essai = normaliserCouleursSvg(texte);

  // Une image en pixels enregistrée en SVG n'a aucun tracé à normaliser : ses
  // couleurs se lisent dans ses PIXELS, rangés en familles. C'est le MÊME
  // bouton du back-office qui mène ici, et c'est voulu — la boutique n'a pas à
  // savoir d'avance de quelle sorte est son fichier.
  //
  // ON NE LIT LES PIXELS QUE FAUTE DE TRACÉS. Un dessin vectoriel peut très
  // bien porter une image quelque part (un logo, une texture) : ses zones de
  // couleur restent alors la bonne façon de le recolorer, et les familles
  // lui feraient perdre ce qu'il savait déjà faire.
  if (Object.keys(essai.zones).length === 0) {
    const lecture = await lireCouleursImage(texte).catch(
      () => ({ couleurs: null, motif: "echec-lecture" as MotifSansCouleur }),
    );
    if (lecture.couleurs)
      return {
        url: urlOrigine,
        urlOrigine,
        colorZones: {},
        groupesCouleurs: [],
        zonesCreees: 0,
        images: 1,
        couleursImage: lecture.couleurs,
      };
    // Un SVG qui porte bien une image, mais dont rien n'est sorti : le motif
    // vaut pour lui comme pour un PNG. « format-non-traite » veut seulement
    // dire ici qu'il n'y avait pas d'image du tout — c'est donc un vrai dessin
    // vectoriel, sans zone : la suite le dira mieux que ce motif.
    if (lecture.motif && lecture.motif !== "format-non-traite")
      return {
        url: urlOrigine,
        urlOrigine,
        colorZones: {},
        groupesCouleurs: [],
        zonesCreees: 0,
        images: 1,
        couleursImage: null,
        motif: lecture.motif,
        phrase: phraseSansCouleur(lecture.motif),
      };
  }

  let surfaces: Record<string, number> | undefined;
  if (Object.keys(essai.zones).length > 1) {
    try {
      surfaces = await surfacesDesCouleurs(essai.svg, essai.zones);
    } catch {
      // Rendu impossible : l'estimation d'après les tracés suffit.
    }
  }
  const r = surfaces ? normaliserCouleursSvg(texte, { surfaces }) : essai;

  let urlFinale = urlOrigine;
  if (r.modifie) {
    const nouveau = nomVoisin(nom, "couleurs", ".svg");
    await writeFile(resolve(ASSETS_DIR, nouveau), r.svg, "utf8");
    urlFinale = `/assets/${nouveau}`;
  }
  return {
    url: urlFinale,
    urlOrigine,
    colorZones: r.zones,
    groupesCouleurs: r.groupes,
    zonesCreees: r.zonesCreees.length,
    images: r.images,
    couleursImage: null,
  };
}

export function mountCouleursDessins(app: Hono): void {
  /**
   * Couleurs d'un dessin : ses zones, ses nuances regroupées, et l'adresse à
   * enregistrer. Appelé au téléversement d'un personnage ou d'une pièce, et
   * par le bouton « Détecter les couleurs » des dessins existants. Ne touche
   * à aucun enregistrement : c'est le back-office qui décide d'enregistrer.
   */
  app.post("/admin/svg/couleurs", async (c) => {
    const b = await c.req.json().catch(() => ({}));
    const url = String(b.url ?? "").trim();
    if (!url) return c.json({ error: "url requise" }, 400);
    const r = await couleursDuDessin(url);
    if (!r) return c.json({ error: "fichier introuvable" }, 404);
    return c.json(r);
  });
}
