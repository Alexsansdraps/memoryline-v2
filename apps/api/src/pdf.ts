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

import {
  appliquerCalage,
  calagePour,
  BASE_COLOR_SCOPE,
  colorsForScope,
  hideSlotGroups,
  recolorSvg,
} from "@memoryline/types";
import {
  familleCss,
  policeParId,
  POLICE_TITRE_DEFAUT,
  POLICE_SOUSTITRE_DEFAUT,
} from "@memoryline/types";
import {
  COULEUR_TEXTE_DEFAUT,
  lignesRemplies,
  styleDesLignes,
} from "@memoryline/types";
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
  /** Bas réel du contenu (0..1) pour aligner les pieds au sol. */
  bottomPct?: number;
  /** Calage des pièces sur ce personnage, par emplacement. */
  slotAdjust?: Partial<
    Record<string, { dx: number; dy: number; scale: number }>
  > | null;
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
  // `fileNameFromUrl` ne rend que le nom de fichier : il faut le chemin ENTIER
  // pour retrouver ce qui vit dans un sous-dossier (« ia/… »).
  const relatif = (url.split("?")[0] ?? url).replace(/^\/+/, "");
  const file = basename(relatif);
  const path = resolve(ASSETS_DIR, file);
  try {
    return await readFile(path);
  } catch {
    // Les images rangées dans un sous-dossier (« ia/… ») ne se trouvent pas à
    // plat : on retente le chemin tel qu'il a été donné, en vérifiant qu'il ne
    // sort pas du dossier des ressources — un « ../ » y mènerait n'importe où.
    const dansSousDossier = resolve(ASSETS_DIR, relatif);
    if (dansSousDossier.startsWith(ASSETS_DIR)) {
      try {
        return await readFile(dansSousDossier);
      } catch {
        /* on continue vers le repli réseau ci-dessous */
      }
    }
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
    const scale = character.scale ?? 1;

    // 1) SVG de BASE du personnage (Male_2.svg…) — la couche de fond du perso,
    //    pré-composée. Recolorée avec les couleurs choisies (peau/tenue par défaut).
    const base = data.characters?.get(String(character.typeId));

    // Alignement des pieds : descendre le perso de TOUT le vide sous son
    // contenu, pour que le bas du contenu tombe à y + h/2 quel que soit
    // bottomPct (même formule que PosterPreview côté front).
    const bp = base?.bottomPct ?? 1;
    const PDF_CHAR_BASE_WIDTH = 0.22;
    // hauteur du cadre (aspect 1:2 -> 2 × largeur, en fraction de W), puis en
    // fraction de H : ÷ √2 (page portrait W:H = 1:√2).
    const frameHfrac = (PDF_CHAR_BASE_WIDTH * scale * 2) / Math.SQRT2;
    const dropFrac = (1 - bp) * frameHfrac;
    const y = (character.y ?? 0.5) + dropFrac;
    if (base?.baseSvgUrl) {
      try {
        const raw = (await readSource(base.baseSvgUrl)).toString("utf8");
        // Couleurs namespacées "scope:zone" : la base ne reçoit que son scope
        // (les zones stN sont réutilisées par les variantes de slots — une map
        // plate ferait déteindre les couleurs d'un slot sur la base).
        const overrides: Record<string, string> = {
          ...(base.baseColorZones ?? {}),
          ...colorsForScope(character.colors, BASE_COLOR_SCOPE),
        };
        // Masque dans la base les groupes des slots remplacés par une variante
        // (même logique que le configurateur : sinon la tenue d'origine du
        // perso apparaît sous la variante sur le PDF imprimé) et de ceux mis
        // explicitement à « aucun » ("none" : sans casquette, sans coupe…).
        const replacedSlots = Object.entries(character.assets)
          .filter(
            ([, assetId]) =>
              assetId === "none" || data.assets.get(String(assetId)),
          )
          .map(([slot]) => slot);
        layers.push({
          svgString: recolorSvg(hideSlotGroups(raw, replacedSlots), overrides),
          x,
          y,
          scale,
        });
      } catch {
        // base illisible : on continue avec les variantes seules
      }
    }

    // 2) Variantes de slots choisies, empilées par-dessus la base dans l'ordre.
    const slotEntries = Object.entries(character.assets);
    slotEntries.sort((a, b) => slotZ(a[0]) - slotZ(b[0]));

    for (const [slot, assetId] of slotEntries) {
      const asset = data.assets.get(String(assetId));
      if (!asset) continue; // asset manquant : on saute (best-effort)

      const raw = (await readSource(asset.svgUrl)).toString("utf8");

      // Couleurs : zones par défaut de l'asset surchargées par celles du perso
      // POUR CE SLOT uniquement (clés "slot:zone" — le slot vient de la config,
      // même clé que celle écrite par le configurateur).
      const overrides: Record<string, string> = {
        ...(asset.colorZones ?? {}),
        ...colorsForScope(character.colors, slot),
      };
      // Calage de la pièce sur CE personnage : même fonction qu'à l'écran,
      // donc impossible que l'impression tombe ailleurs que l'aperçu validé.
      layers.push({
        svgString: appliquerCalage(
          recolorSvg(raw, overrides),
          calagePour(base?.slotAdjust, slot, asset.position),
        ),
        x,
        y,
        scale,
      });
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
 * Taille de chaque ligne, en fraction de la LARGEUR de l'affiche : la première
 * porte le lieu et se lit de loin, les suivantes restent discrètes.
 *
 * Fractions de la largeur, et non de la hauteur, pour qu'un A3 rende
 * exactement le même dessin qu'un A4 — les deux formats ont le même rapport.
 */
const TAILLE_LIGNE = [0.07, 0.05, 0.05] as const;

/**
 * Police retenue quand la ligne n'en porte pas.
 *
 * Une commande passée avant les trois lignes n'a de police que sur son titre :
 * son sous-titre doit retomber sur la même valeur qu'à l'époque, sinon sa
 * réimpression sortirait en serif là où le client avait vu une anglaise.
 */
const POLICE_LIGNE_DEFAUT = [
  POLICE_TITRE_DEFAUT,
  POLICE_SOUSTITRE_DEFAUT,
  POLICE_SOUSTITRE_DEFAUT,
] as const;

/** Ligne de base de la première ligne, en fraction de la hauteur. */
const HAUTEUR_PREMIERE_LIGNE = 0.1;

/**
 * Écart minimal entre deux lignes de base, en multiples de la taille de la
 * ligne du DESSOUS. Deux lignes de même taille se chevaucheraient sinon : les
 * polices anglaises descendent bien plus bas que leur corps.
 */
const INTERLIGNE_MINIMAL = 1.25;

/**
 * Facteur de taille du bloc de texte, ramené à une plage sûre.
 *
 * Le bloc s'écrit en haut de l'affiche et les personnages occupent le milieu :
 * un facteur libre laisserait le texte descendre dans le dessin.
 */
function facteurTaille(valeur: number | undefined): number {
  const f = Number(valeur);
  if (!Number.isFinite(f) || f <= 0) return 1;
  return Math.min(1.6, Math.max(0.6, f));
}

/** Part de la largeur de l'affiche offerte au texte (marges de l'aperçu). */
const LARGEUR_UTILE = 0.88;

/** Corps auquel on mesure une ligne avant de la ramener à sa vraie taille. */
const CORPS_MESURE = 96;

/**
 * Largeur d'une ligne, en multiples de son corps.
 *
 * Le texte est centré : une ligne trop longue ne déborde pas, elle est ROGNÉE
 * des deux côtés, et « SAINT-VALERY-SUR-SOMME » occupe déjà 84 % de la
 * largeur — un nom à peine plus long partait à l'impression amputé de sa
 * première et de sa dernière syllabe. On ne peut pas connaître l'avance des
 * glyphes autrement qu'en les dessinant : on rasterise donc la ligne à petit
 * corps (la largeur est proportionnelle au corps, à 0,2 % près) et on en
 * déduit ce qu'elle occupera en vrai.
 *
 * `null` si la mesure échoue : mieux vaut le rendu d'avant que pas de texte.
 */
async function largeurParCorps(
  texte: string,
  famille: string,
  gras: boolean,
): Promise<number | null> {
  const w = Math.ceil(CORPS_MESURE * (texte.length + 4) * 1.6);
  const h = CORPS_MESURE * 3;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<text x="${CORPS_MESURE}" y="${CORPS_MESURE * 2}" font-family="${escapeXml(famille)}"` +
    `${gras ? ' font-weight="700"' : ""} font-size="${CORPS_MESURE}" fill="#000000">` +
    `${escapeXml(texte)}</text></svg>`;
  try {
    const { info } = await sharp(Buffer.from(svg))
      .trim({ threshold: 0 })
      .png()
      .toBuffer({ resolveWithObject: true });
    return info.width / CORPS_MESURE;
  } catch {
    return null;
  }
}

/**
 * Construit un SVG plein cadre contenant les TROIS LIGNES de l'affiche, ou
 * `null` s'il n'y en a aucune de remplie. Le bloc est centré en haut (zone
 * classique Memory Line). Les familles de police sont citées explicitement ;
 * elles sont installées dans l'image de production (cf. apps/api/Dockerfile).
 *
 * Les lignes se suivent sans trou : une affiche dont seule la deuxième ligne
 * est remplie l'imprime en haut, pas au milieu d'un vide. C'est
 * `lignesRemplies()` qui le garantit, et c'est aussi elle qui sait relire le
 * titre et le sous-titre des commandes déjà passées.
 */
async function buildTextSvg(
  config: PosterConfig,
  width: number,
  height: number,
): Promise<string | null> {
  const lignes = lignesRemplies(config.texts);
  if (!lignes.length) return null;

  // Couleur et taille sont COMMUNES à l'affiche (une seule encre, charte) ;
  // seule la POLICE est choisie ligne par ligne. On résout ici le même nom de
  // famille que l'aperçu écran, et l'image de l'API installe les fichiers
  // correspondants — sans quoi le PDF sortirait dans une autre police que
  // celle validée par le client.
  const style = styleDesLignes(config.texts);
  const couleur = style?.color ?? COULEUR_TEXTE_DEFAUT;
  const facteur = facteurTaille(style?.size);

  const rendus = await Promise.all(
    lignes.map(async (ligne, i) => {
      const texte = ligne.value.trim();
      const famille = familleCss(
        policeParId(ligne.font, POLICE_LIGNE_DEFAUT[i] ?? POLICE_SOUSTITRE_DEFAUT),
      );
      // Gras sur la première ligne seulement : c'est ainsi que le titre était
      // imprimé, et une réimpression doit ressembler à l'affiche d'origine.
      const gras = i === 0;
      const taille = Math.round(
        width *
          (TAILLE_LIGNE[i] ?? TAILLE_LIGNE[TAILLE_LIGNE.length - 1]!) *
          facteur,
      );
      // On ne rétrécit QUE ce qui dépasserait : une ligne qui tenait déjà
      // s'imprime exactement comme avant.
      const parCorps = await largeurParCorps(texte, famille, gras);
      const occupee = parCorps === null ? 0 : parCorps * taille;
      const utile = width * LARGEUR_UTILE;
      return {
        texte,
        famille,
        gras,
        taille:
          occupee > utile ? Math.max(1, Math.floor((taille * utile) / occupee)) : taille,
      };
    }),
  );

  const parts: string[] = [];
  let y = Math.round(height * HAUTEUR_PREMIERE_LIGNE);
  let precedente: (typeof rendus)[number] | null = null;
  for (const [i, r] of rendus.entries()) {
    const ligne = lignes[i]!;
    // Une ligne déplacée à la main s'imprime là où le client l'a posée : le
    // centre de la ligne vaut (x·largeur, y·hauteur), exactement comme dans
    // l'aperçu. Elle sort de l'empilement, qui continue sans elle.
    if (typeof ligne.x === "number" && typeof ligne.y === "number") {
      parts.push(
        `<text x="${Math.round(ligne.x * width)}" y="${Math.round(ligne.y * height)}" ` +
          `text-anchor="middle" dominant-baseline="central" ` +
          `font-family="${escapeXml(r.famille)}"${r.gras ? ' font-weight="700"' : ""} ` +
          `font-size="${r.taille}" fill="${escapeXml(couleur)}">${escapeXml(r.texte)}</text>`,
      );
      continue;
    }
    if (precedente) {
      y += Math.round(Math.max(precedente.taille, r.taille * INTERLIGNE_MINIMAL));
    }
    parts.push(
      `<text x="${width / 2}" y="${y}" text-anchor="middle" ` +
        `font-family="${escapeXml(r.famille)}"${r.gras ? ' font-weight="700"' : ""} ` +
        `font-size="${r.taille}" fill="${escapeXml(couleur)}">${escapeXml(r.texte)}</text>`,
    );
    precedente = r;
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

  // 1b) Décor — DERRIÈRE les personnages (composité AVANT eux), mais devant le
  // fond, et UNIQUEMENT s'il y a au moins un personnage — même règle que
  // l'aperçu écran (PosterPreview), sinon l'impression ne correspondrait pas
  // à ce que le client a validé.
  //
  // Le décor vient de la configuration, où il a été figé à l'ajout au panier
  // (décor du produit, sinon décor de son type d'affiche). Les commandes
  // passées AVANT que le décor devienne une donnée n'en ont pas : pour
  // elles, la vue de dos vaut toujours muret, sinon leur réimpression
  // perdrait le muret.
  const fgSource =
    config.foregroundUrl ||
    (config.view === "back" ? "/assets/muret_officiel.svg" : "");
  if (fgSource && (config.characters?.length ?? 0) > 0) {
    try {
      const fgRaw = await readSource(fgSource);
      const fgPng = await sharp(fgRaw, { density: 300 })
        .resize({ width: W })
        .png()
        .toBuffer();
      const meta = await sharp(fgPng).metadata();
      const fgH = meta.height ?? 0;
      composites.push({ input: fgPng, left: 0, top: Math.max(0, H - fgH) });
    } catch {
      // décor manquant : on l'ignore (best-effort)
    }
  }

  // 2) Personnages (couches ordonnées) — composités APRÈS le muret (devant lui).
  // Largeur d'un perso = CHAR_BASE_WIDTH × scale × W (identique au rendu écran
  // du configurateur, pour que le PDF corresponde exactement à l'aperçu).
  const CHAR_BASE_WIDTH = 0.22; // synchronisé avec le configurateur (store.ts)
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

  // 3) Textes (les trois lignes). Le SVG a déjà des dimensions en px = W×H ;
  // on le rasterise sans densité (sinon sharp multiplie par density/96) puis on
  // épingle la taille exacte du canevas pour garantir un overlay W×H plein cadre.
  const textSvg = await buildTextSvg(config, W, H);
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
    // unlimited:true → autorise les gros SVG de villes (sinon sharp lève
    // "Buffer size limit exceeded"). density réduite à 150 (suffisant en cover).
    const pixels = await sharp(
      buf,
      isSvg ? { density: 150, unlimited: true } : undefined,
    )
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
