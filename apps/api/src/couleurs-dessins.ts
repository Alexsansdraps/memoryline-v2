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
 */
import type { Hono } from "hono";
import { resolve, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import {
  normaliserCouleursSvg,
  recolorSvg,
  type CouleursImage,
  type GroupeCouleur,
} from "@memoryline/types";
import { detecterCouleursImage } from "./couleurs-image-fichier.js";

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
   * la boutique. Null = dessin vectoriel, ou image illisible.
   */
  couleursImage: CouleursImage | null;
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
  let texte: string;
  try {
    texte = (await readFile(chemin)).toString("utf8");
  } catch {
    return null;
  }
  const urlOrigine = `/assets/${nom}`;
  // Une image PNG ou JPG n'a pas de zones : la boutique le dira.
  if (extname(nom).toLowerCase() !== ".svg")
    return {
      url: urlOrigine,
      urlOrigine,
      colorZones: {},
      groupesCouleurs: [],
      zonesCreees: 0,
      images: 1,
      couleursImage: null,
    };

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
    const couleursImage = await detecterCouleursImage(texte).catch(() => null);
    if (couleursImage)
      return {
        url: urlOrigine,
        urlOrigine,
        colorZones: {},
        groupesCouleurs: [],
        zonesCreees: 0,
        images: 1,
        couleursImage,
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
    const racine = basename(nom, extname(nom)).slice(0, 80);
    const nouveau = `${racine}-couleurs-${randomBytes(3).toString("hex")}.svg`;
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
