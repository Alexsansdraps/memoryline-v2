/**
 * Génération PDF haute qualité côté serveur pour Memory Line (§12 / §15).
 *
 * Décisions ACTÉES :
 *  - Haute qualité, 300 DPI. A4 = 2480×3508 px, A3 = 3508×4960 px.
 *  - Couleurs fidèles (sRGB, aucun strip ICC, aucune conversion).
 *  - PAS de fond perdu, PAS de traits de coupe, PAS de page de garde / encart :
 *    le PDF EST uniquement l'affiche finale, aux dimensions exactes du format.
 *  - Nom de fichier ({ClientNameSlug}_{OrderNumber}.pdf) géré par l'appelant.
 *
 * Pipeline : sharp composite l'affiche (fond + personnages recolorés + textes)
 * en PNG à la résolution cible, puis pdf-lib assemble une page unique aux
 * dimensions exactes du format (en points) et y dessine le PNG plein cadre.
 *
 * Aucune dépendance navigateur (pas de puppeteer). Les SVG sont lus sur disque
 * (rapide + fiable) avec repli HTTP si un fichier manque localement.
 */

import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import type { OverlayOptions, Sharp } from "sharp";
import { PDFDocument } from "pdf-lib";

import { recolorSvg } from "@memoryline/types";
import type { PosterConfig, PosterFormat } from "@memoryline/types";

// --- Constantes format --------------------------------------------------------

/** Dimensions en pixels @300 DPI (rasterisation). */
const FORMAT_PX: Record<PosterFormat, { width: number; height: number }> = {
  A4: { width: 2480, height: 3508 },
  A3: { width: 3508, height: 4960 },
};

/** Dimensions en points PDF (1 pt = 1/72"), aux dimensions exactes du format. */
const FORMAT_PT: Record<PosterFormat, { width: number; height: number }> = {
  A4: { width: 595.28, height: 841.89 },
  A3: { width: 841.89, height: 1190.55 },
};

/** Ordre d'empilement des slots sur un personnage (bas → haut). */
const SLOT_Z_ORDER = ["clothes", "pants", "shoes", "hair", "head", "accessory"] as const;

/** Répertoire des assets sur disque : data/assets/<fichier> (cf. index.ts). */
const ASSETS_DIR = resolve(fileURLToPath(import.meta.url), "../../../../data/assets");

// --- Types d'entrée -----------------------------------------------------------

/**
 * Métadonnées d'un asset nécessaires au rendu, telles que chargées en base
 * (table `asset`) ou construites par l'appelant. On reste découplé de la DB :
 * l'appelant fournit ce qu'il a déjà résolu.
 */
export interface ResolvedAsset {
  id: number | string;
  slot: string;
  /** URL servie par l'API (ex. "/assets/abc-Hair_1.svg") ou URL absolue. */
  svgUrl: string;
  /** Couleurs par défaut du SVG : { st0: "#BA6821", … }. */
  colorZones?: Record<string, string> | null;
  position?: number | null;
}

/** Métadonnées d'un fond (table `background`). */
export interface ResolvedBackground {
  id: number | string;
  /** URL servie par l'API ou absolue. SVG, PNG, JPG… */
  url: string;
}

/**
 * Métadonnées d'un PERSONNAGE (table `character_type`) : son SVG complet de
 * base (Male_2.svg…) pré-composé, sur lequel s'empilent les variantes de slots.
 */
export interface ResolvedCharacter {
  id: number | string;
  baseSvgUrl: string | null;
  baseColorZones?: Record<string, string> | null;
}

/**
 * Données pré-résolues passées à {@link resolveConfig} / {@link renderPosterPng}.
 * L'appelant charge la DB lui-même puis remplit ces maps (clés = id en string).
 */
export interface ResolveData {
  /** assetId (string) -> ResolvedAsset (variantes de slots). */
  assets: Map<string, ResolvedAsset>;
  /** characterTypeId (string) -> ResolvedCharacter (SVG de base). */
  characters?: Map<string, ResolvedCharacter>;
  /** backgroundId (string) -> ResolvedBackground. */
  backgrounds?: Map<string, ResolvedBackground>;
}

/** Options de rendu. */
export interface RenderOptions {
  /** Données pré-résolues (assets/fonds). */
  data: ResolveData;
  /** Force un format ; sinon config.format, sinon "A4". */
  format?: PosterFormat;
  /**
   * Chemin d'un fichier fonts.conf (fontconfig) pour embarquer DM Serif Display
   * / Inter au rendu du texte. Si absent, sharp utilise les polices système.
   */
  fontconfigPath?: string;
}

/** Une couche prête à compositer (SVG recoloré + placement normalisé). */
export interface ResolvedLayer {
  /** SVG sérialisé (déjà recoloré). */
  svgString: string;
  /** Position normalisée 0..1 du centre de la couche (défaut 0.5/0.5). */
  x: number;
  y: number;
  /** Échelle relative à la largeur de l'affiche (défaut 1 = pleine largeur). */
  scale: number;
}

// --- Lecture des fichiers source ---------------------------------------------

/** "/assets/abc.svg" | "https://…/abc.svg" -> "abc.svg". */
function fileNameFromUrl(url: string): string {
  const clean = url.split("?")[0] ?? url;
  return basename(clean);
}

/**
 * Lit un asset/fond depuis le disque (data/assets/<fichier>) avec repli HTTP
 * si l'URL est absolue et le fichier absent localement.
 */
async function readSource(url: string): Promise<Buffer> {
  const file = basename(fileNameFromUrl(url));
  const path = resolve(ASSETS_DIR, file);
  try {
    return await readFile(path);
  } catch {
    if (/^https?:\/\//i.test(url)) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }
    throw new Error(`Source introuvable: ${url} (cherché: ${path})`);
  }
}

// --- Résolution de la config en couches --------------------------------------

/**
 * Transforme une {@link PosterConfig} + les données pré-chargées en une liste
 * ORDONNÉE de couches {svgString, x, y, scale} prêtes à compositer.
 *
 * Pour chaque personnage (trié par `position`), on empile ses assets dans
 * l'ordre {@link SLOT_Z_ORDER}, chacun recoloré via `character.colors`
 * (surcharge les zones par défaut de l'asset). Le placement (x/y/scale) du
 * personnage s'applique à toutes ses couches.
 *
 * Le fond N'EST PAS inclus ici (il est rendu pleine taille séparément).
 *
 * @returns couches dans l'ordre de dessin (première = la plus en arrière).
 */
export async function resolveConfig(
  config: PosterConfig,
  data: ResolveData,
): Promise<ResolvedLayer[]> {
  const layers: ResolvedLayer[] = [];

  const characters = [...config.characters].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  );

  for (const character of characters) {
    const x = character.x ?? 0.5;
    const y = character.y ?? 0.5;
    const scale = character.scale ?? 1;

    // 1) SVG de BASE du personnage (Male_2.svg…) — la couche de fond du perso,
    //    pré-composée. Recolorée avec les couleurs choisies (peau/tenue par défaut).
    const base = data.characters?.get(String(character.typeId));
    if (base?.baseSvgUrl) {
      try {
        const raw = (await readSource(base.baseSvgUrl)).toString("utf8");
        const overrides: Record<string, string> = {
          ...(base.baseColorZones ?? {}),
          ...(character.colors ?? {}),
        };
        layers.push({ svgString: recolorSvg(raw, overrides), x, y, scale });
      } catch {
        // base illisible : on continue avec les variantes seules
      }
    }

    // 2) Variantes de slots choisies, empilées par-dessus la base dans l'ordre.
    const slotEntries = Object.entries(character.assets);
    slotEntries.sort((a, b) => slotZ(a[0]) - slotZ(b[0]));

    for (const [, assetId] of slotEntries) {
      const asset = data.assets.get(String(assetId));
      if (!asset) continue; // asset manquant : on saute (best-effort)

      const raw = (await readSource(asset.svgUrl)).toString("utf8");

      // Couleurs : zones par défaut de l'asset surchargées par celles du perso.
      const overrides: Record<string, string> = {
        ...(asset.colorZones ?? {}),
        ...(character.colors ?? {}),
      };
      layers.push({ svgString: recolorSvg(raw, overrides), x, y, scale });
    }
  }

  return layers;
}

function slotZ(slot: string): number {
  const i = (SLOT_Z_ORDER as readonly string[]).indexOf(slot);
  return i === -1 ? SLOT_Z_ORDER.length : i;
}

// --- Rendu texte (SVG) -------------------------------------------------------

/** Échappe le texte pour insertion dans du XML/SVG. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Construit un SVG plein cadre contenant le titre et le sous-titre, ou `null`
 * s'il n'y a aucun texte. Le titre est rendu en bas de l'affiche (zone classique
 * Memory Line), centré. Les familles de police sont citées explicitement ;
 * si elles ne sont pas installées, sharp retombe sur la police par défaut.
 */
function buildTextSvg(
  config: PosterConfig,
  width: number,
  height: number,
): string | null {
  const title = config.texts.title?.value?.trim();
  const subtitle = config.texts.subtitle?.value?.trim();
  if (!title && !subtitle) return null;

  const titleFont = config.texts.title?.font ?? "DM Serif Display";
  const subtitleFont = config.texts.subtitle?.font ?? "Inter";
  const titleColor = config.texts.title?.color ?? "#1A1A1A";
  const subtitleColor = config.texts.subtitle?.color ?? "#333333";

  // Tailles proportionnelles à la largeur (px @300 DPI).
  const titleSize = Math.round(width * 0.06);
  const subtitleSize = Math.round(width * 0.032);
  const titleY = Math.round(height * 0.9);
  const subtitleY = Math.round(titleY + titleSize * 0.95);

  const parts: string[] = [];
  if (title) {
    parts.push(
      `<text x="${width / 2}" y="${titleY}" text-anchor="middle" ` +
        `font-family="${escapeXml(titleFont)}, serif" font-size="${titleSize}" ` +
        `fill="${escapeXml(titleColor)}">${escapeXml(title)}</text>`,
    );
  }
  if (subtitle) {
    parts.push(
      `<text x="${width / 2}" y="${subtitleY}" text-anchor="middle" ` +
        `font-family="${escapeXml(subtitleFont)}, sans-serif" font-size="${subtitleSize}" ` +
        `fill="${escapeXml(subtitleColor)}">${escapeXml(subtitle)}</text>`,
    );
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`
  );
}

// --- Composition PNG ---------------------------------------------------------

/**
 * Composite l'affiche complète (fond + personnages recolorés + textes) en PNG
 * à la résolution cible du format (A4/A3, 300 DPI).
 *
 * - Le fond est rasterisé en plein cadre (cover) en premier.
 * - Chaque couche personnage est rasterisée à `scale * W` de large puis
 *   compositée centrée sur (x*W, y*H).
 * - Le texte est composité par-dessus.
 *
 * Couleurs conservées en sRGB ; aucun strip d'ICC.
 */
export async function renderPosterPng(
  config: PosterConfig,
  opts: RenderOptions,
): Promise<Buffer> {
  const format: PosterFormat = opts.format ?? config.format ?? "A4";
  const { width: W, height: H } = FORMAT_PX[format];

  // 1) Fond plein cadre.
  const base = await renderBackground(config, opts.data, W, H);

  const composites: OverlayOptions[] = [];

  // 2) Personnages (couches ordonnées).
  // Largeur d'un perso = CHAR_BASE_WIDTH × scale × W (identique au rendu écran
  // du configurateur, pour que le PDF corresponde exactement à l'aperçu).
  const CHAR_BASE_WIDTH = 0.28;
  const layers = await resolveConfig(config, opts.data);
  for (const layer of layers) {
    // Largeur cible bornée au canevas. density:300 = qualité de rasterisation ;
    // c'est .resize qui fixe la taille finale (indépendante de la densité).
    const targetW = Math.min(
      W,
      Math.max(1, Math.round(CHAR_BASE_WIDTH * layer.scale * W)),
    );
    const png = await sharp(Buffer.from(layer.svgString), {
      density: 300,
    })
      .resize({ width: targetW })
      .png()
      .toBuffer();

    const meta = await sharp(png).metadata();
    const lw = meta.width ?? targetW;
    const lh = meta.height ?? targetW;

    // (x*W, y*H) = centre de la couche -> coin haut-gauche.
    const left = Math.round(layer.x * W - lw / 2);
    const top = Math.round(layer.y * H - lh / 2);

    // sharp refuse les overlays plus grands que la base ou en débord négatif :
    // on place la couche sur un canevas transparent W×H puis on composite à 0,0.
    const framed = await frameLayer(png, lw, lh, left, top, W, H);
    if (framed) composites.push({ input: framed, left: 0, top: 0 });
  }

  // 2b) Décor d'avant-plan (muret/banc…) — par-dessus les personnages, ancré
  // en bas (contain). UNIQUEMENT en vue de DOS (assis) : de face, pas de rebord.
  if (config.foregroundUrl && config.view === "back") {
    try {
      const fgRaw = await readSource(config.foregroundUrl);
      const fgPng = await sharp(fgRaw, { density: 300 })
        .resize({ width: W, height: H, fit: "contain", position: "bottom",
          background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      composites.push({ input: fgPng, left: 0, top: 0 });
    } catch {
      // décor manquant : on l'ignore (best-effort)
    }
  }

  // 3) Textes (titre + sous-titre). Le SVG a déjà des dimensions en px = W×H ;
  // on le rasterise sans densité (sinon sharp multiplie par density/96) puis on
  // épingle la taille exacte du canevas pour garantir un overlay W×H plein cadre.
  const textSvg = buildTextSvg(config, W, H);
  if (textSvg) {
    const textPng = await sharp(Buffer.from(textSvg))
      .resize({ width: W, height: H, fit: "fill" })
      .png()
      .toBuffer();
    composites.push({ input: textPng, left: 0, top: 0 });
  }

  return base
    .composite(composites)
    .png({ compressionLevel: 6 })
    .toBuffer();
}

/**
 * Place une couche déjà rasterisée (lw×lh) à la position (left, top) sur un
 * canevas transparent W×H, en recadrant ce qui dépasse. Retourne un PNG W×H, ou
 * `null` si la couche est entièrement hors champ. Garantit des overlays de même
 * taille que la base (sharp refuse autrement débords et overlays trop grands).
 */
async function frameLayer(
  png: Buffer,
  lw: number,
  lh: number,
  left: number,
  top: number,
  W: number,
  H: number,
): Promise<Buffer | null> {
  // Intersection [left, left+lw) × [top, top+lh) avec [0, W) × [0, H).
  const sx = Math.max(0, -left); // décalage source en x si débord à gauche
  const sy = Math.max(0, -top);
  const dx = Math.max(0, left); // position destination
  const dy = Math.max(0, top);
  const cw = Math.min(lw - sx, W - dx); // largeur visible
  const ch = Math.min(lh - sy, H - dy);
  if (cw <= 0 || ch <= 0) return null;

  let src = sharp(png);
  if (sx > 0 || sy > 0 || cw < lw || ch < lh) {
    src = src.extract({ left: sx, top: sy, width: cw, height: ch });
  }
  const cropped = await src.png().toBuffer();

  return sharp({
    create: {
      width: W,
      height: H,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: cropped, left: dx, top: dy }])
    .png()
    .toBuffer();
}

/**
 * Rasterise le fond en plein cadre. SVG → density 300 ; raster (PNG/JPG) →
 * resize cover. Si aucun fond n'est résolu, fond blanc (best-effort).
 */
async function renderBackground(
  config: PosterConfig,
  data: ResolveData,
  W: number,
  H: number,
): Promise<Sharp> {
  const url = resolveBackgroundUrl(config, data);

  if (url) {
    const buf = await readSource(url);
    const isSvg = extname(fileNameFromUrl(url)).toLowerCase() === ".svg";
    const pixels = await sharp(buf, isSvg ? { density: 300 } : undefined)
      .resize({ width: W, height: H, fit: "cover", position: "centre" })
      .png()
      .toBuffer();
    return sharp(pixels);
  }

  // Fond blanc par défaut.
  return sharp({
    create: {
      width: W,
      height: H,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  }).png();
}

function resolveBackgroundUrl(
  config: PosterConfig,
  data: ResolveData,
): string | null {
  if (config.backgroundUrl) return config.backgroundUrl;
  if (config.backgroundId != null && data.backgrounds) {
    const bg = data.backgrounds.get(String(config.backgroundId));
    if (bg) return bg.url;
  }
  return null;
}

// --- Assemblage PDF ----------------------------------------------------------

/**
 * Rend l'affiche en PNG puis crée un PDF d'UNE page aux dimensions EXACTES du
 * format (en points), avec le PNG dessiné plein cadre (aucune marge, aucun
 * trait de coupe, aucun fond perdu).
 *
 * @returns octets du PDF.
 */
export async function renderPosterPdf(
  config: PosterConfig,
  opts: RenderOptions,
): Promise<Buffer> {
  const format: PosterFormat = opts.format ?? config.format ?? "A4";
  const { width: pw, height: ph } = FORMAT_PT[format];

  const pngBytes = await renderPosterPng(config, opts);

  const doc = await PDFDocument.create();
  const page = doc.addPage([pw, ph]);
  const img = await doc.embedPng(pngBytes);
  page.drawImage(img, { x: 0, y: 0, width: pw, height: ph });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
