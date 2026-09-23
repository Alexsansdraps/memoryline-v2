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

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, utimes, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import type { OverlayOptions, Sharp } from "sharp";
import {
  PDFDocument,
  PDFRawStream,
  StandardFonts,
  concatTransformationMatrix,
  degrees,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  rgb,
} from "pdf-lib";
import type { PDFFont, PDFPage } from "pdf-lib";

import {
  ORDRE_CALQUES,
  appliquerCalage,
  calagePour,
  couleursDeLaBase,
  couleursDeLaPiece,
  empilerPersonnage,
  recolorSvg,
  type CouleursImage,
  type GroupeCouleur,
} from "@memoryline/types";
import { dessinRecolore } from "./couleurs-image-fichier.js";
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
export const FORMAT_PX: Record<PosterFormat, { width: number; height: number }> = {
  A4: { width: 2480, height: 3508 },
  A3: { width: 3508, height: 4960 },
};

/** Dimensions en points PDF (1 pt = 1/72"), aux dimensions exactes du format. */
const FORMAT_PT: Record<PosterFormat, { width: number; height: number }> = {
  A4: { width: 595.28, height: 841.89 },
  A3: { width: 841.89, height: 1190.55 },
};

/**
 * Ordre d'empilement des slots sur un personnage, du bas vers le haut.
 *
 * Repris du paquet partagé : cette liste disait autrefois le contraire de
 * celle de l'aperçu sur le pantalon et le vêtement, si bien que le papier ne
 * montrait pas ce que la cliente avait validé à l'écran.
 */
const SLOT_Z_ORDER = ORDRE_CALQUES;

/** Répertoire des assets sur disque : data/assets/<fichier> (cf. index.ts). */
const ASSETS_DIR = resolve(fileURLToPath(import.meta.url), "../../../../data/assets");

/** Le dossier de marque de l'API : apps/api/marque/ (cf. cartes-cadeaux.ts). */
const DOSSIER_MARQUE = resolve(fileURLToPath(import.meta.url), "../../marque");

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
  /** Zones non proposées au client : elles s'impriment dans leur couleur par défaut. */
  zonesMasquees?: string[] | null;
  /** Groupes de couleurs : un groupe masqué garde le défaut de TOUTES ses nuances. */
  groupesCouleurs?: GroupeCouleur[] | null;
  /** Familles de couleurs, quand le dessin de la pièce est une image en pixels. */
  couleursImage?: CouleursImage | null;
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
  /**
   * Familles de couleurs, quand le dessin de base est une IMAGE EN PIXELS
   * (photo ou illustration enregistrée en SVG). Voir couleurs-image.ts.
   */
  baseCouleursImage?: CouleursImage | null;
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
 * Pour chaque personnage (trié par `position`), on empile sa base, découpée en
 * tranches, et ses pièces choisies dans l'ordre {@link SLOT_Z_ORDER} (cf.
 * empilerPersonnage), chacune recolorée via `character.colors` (surcharge les
 * zones par défaut de l'asset). Le placement (x/y/scale) du personnage
 * s'applique à toutes ses couches.
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
    // x/y viennent de la configuration telle qu'elle a été validée : la rangée
    // automatique, ou la place que le client a donnée au personnage en le
    // glissant sur l'aperçu. Les deux se lisent pareil, et c'est voulu — le
    // configurateur enregistre le placement FINAL, jamais une consigne à
    // rejouer ici. Recalculer quoi que ce soit ferait sortir de l'imprimante
    // une affiche différente de celle qui a été commandée.
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

    // Pièces choisies (celles qu'on sait retrouver) et emplacements mis à
    // « aucun » ("none" : sans casquette, sans coupe…). Les deux effacent de
    // la base le groupe d'origine ; seules les premières le remplacent.
    const entrees = Object.entries(character.assets);
    const pieces = entrees
      .filter(([, id]) => id !== "none" && data.assets.get(String(id)))
      .map(([slot]) => slot);
    const retires = entrees
      .filter(([, id]) => id === "none")
      .map(([slot]) => slot);

    // Couleurs namespacées "scope:zone" : la base ne reçoit que son scope
    // (les zones stN sont réutilisées par les pièces — une map plate ferait
    // déteindre les couleurs d'une pièce sur la base). Même fonction que
    // l'aperçu de la boutique : défauts du back-office, puis la configuration.
    const couleursBase = couleursDeLaBase(character.colors, base);

    let brute: string | null = null;
    if (base?.baseSvgUrl) {
      try {
        brute = (await readSource(base.baseSvgUrl)).toString("utf8");
      } catch {
        // base illisible : on continue avec les pièces seules
      }
      // Personnage dessiné en PIXELS (un chien photographié, par exemple) :
      // son image est remplacée par la version recolorée — LE MÊME FICHIER
      // que la boutique a montré au client, lu dans le même cache. Recoloré
      // avant le découpage en tranches, pour que la suite ne voie qu'un
      // dessin ordinaire.
      //
      // VOLONTAIREMENT HORS du rattrapage ci-dessus, et sans le sien : une
      // recoloration qui échoue en silence enverrait à l'imprimeur un animal
      // dans ses couleurs d'usine, alors que le client en a choisi d'autres
      // et les a vues à l'écran — personne ne s'en apercevrait avant le colis.
      // Les pièces, plus bas, laissent déjà remonter l'erreur ; la base fait
      // pareil. Mieux vaut une erreur bruyante qu'un chien de la mauvaise
      // couleur glissé dans un colis (cf. fichiers-impression.ts).
      if (brute)
        brute = await dessinRecolore(
          brute,
          base.baseSvgUrl,
          base.baseCouleursImage,
          couleursBase,
        );
    }

    // 1) et 2) La base en tranches, les pièces choisies intercalées à leur
    //    place : corps → pantalon → haut → cheveux → accessoires. Même
    //    découpe que le configurateur (empilerPersonnage) — sans elle, un
    //    t-shirt choisi s'imprimait par-dessus les cheveux d'origine.
    const etages = brute
      ? empilerPersonnage(brute, pieces, retires)
      : [...pieces].sort((a, b) => slotZ(a) - slotZ(b)).map((piece) => ({ piece }));

    for (const etage of etages) {
      if ("base" in etage) {
        layers.push({
          svgString: recolorSvg(etage.base, couleursBase),
          x,
          y,
          scale,
        });
        continue;
      }
      const slot = etage.piece;
      const asset = data.assets.get(String(character.assets[slot]));
      if (!asset) continue; // asset manquant : on saute (best-effort)

      // Couleurs : zones par défaut de l'asset surchargées par celles du perso
      // POUR CE SLOT uniquement (clés "slot:zone" — le slot vient de la config,
      // même clé que celle écrite par le configurateur). Les groupes que le
      // client ne peut pas changer gardent leur défaut : même règle que
      // l'aperçu de la boutique (couleursDeLaPiece).
      const overrides = couleursDeLaPiece(character.colors, slot, asset);
      // Une pièce dessinée en pixels se recolore comme un personnage : c'est
      // le même cache, donc la même image qu'à l'écran.
      const raw = await dessinRecolore(
        (await readSource(asset.svgUrl)).toString("utf8"),
        asset.svgUrl,
        asset.couleursImage,
        overrides,
      );
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
    // En pixels bruts, pas en PNG : un PNG serait compressé ici pour être
    // aussitôt décompressé par l'assemblage final, et ce, pour chaque calque.
    const { data: pixels, info } = await sharp(Buffer.from(layer.svgString), {
      density: 300,
    })
      .resize({ width: targetW })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // (x*W, y*H) = centre de la couche -> coin haut-gauche.
    const left = Math.round(layer.x * W - info.width / 2);
    const top = Math.round(layer.y * H - info.height / 2);

    const place = await placerCouche(pixels, info.width, info.height, left, top, W, H);
    if (place) composites.push(place);
  }

  // 3) Textes (les trois lignes). Le SVG a déjà des dimensions en px = W×H ;
  // on le rasterise sans densité (sinon sharp multiplie par density/96) puis on
  // épingle la taille exacte du canevas pour garantir un overlay W×H plein cadre.
  const textSvg = await buildTextSvg(config, W, H);
  if (textSvg) {
    const { data: texte, info } = await sharp(Buffer.from(textSvg))
      .resize({ width: W, height: H, fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    composites.push({
      input: texte,
      raw: { width: info.width, height: info.height, channels: 4 },
      left: 0,
      top: 0,
    });
  }

  const { data: affiche, info } = await base
    .composite(composites)
    .raw()
    .toBuffer({ resolveWithObject: true });
  // Sur du blanc, comme le papier : l'affiche est opaque, et un PNG sans
  // couche de transparence s'insère dans le PDF tel quel (cf. renderPosterPdf)
  // au lieu d'y être décompressé puis recompressé. En deux temps : dans un
  // même enchaînement, sharp aplatit AVANT d'assembler les calques, et
  // l'assemblage rajoute la transparence qu'on venait d'ôter.
  return sharp(affiche, { raw: info })
    .flatten({ background: "#ffffff" })
    .png({ compressionLevel: 6 })
    .toBuffer();
}

/**
 * Prépare une couche rasterisée (lw×lh, pixels bruts RGBA) pour l'assemblage :
 * recadrée à ce qui tombe sur l'affiche, et posée à sa place. `null` si elle
 * tombe entièrement hors champ.
 *
 * sharp refuse un calque qui déborde de l'image ou commence en négatif : un
 * personnage poussé contre le bord doit donc perdre ce qui dépasse.
 *
 * On ne pose PLUS chaque couche sur une toile transparente de la taille de
 * l'affiche. C'est ce que faisait cette fonction, et c'était l'essentiel du
 * temps d'impression : une toile A3 fait 17 millions de pixels, et elle était
 * compressée en PNG pour CHAQUE calque — vingt-quatre fois pour une famille
 * de six. Une affiche A3 prenait près de deux minutes.
 */
async function placerCouche(
  pixels: Buffer,
  lw: number,
  lh: number,
  left: number,
  top: number,
  W: number,
  H: number,
): Promise<OverlayOptions | null> {
  // Intersection [left, left+lw) × [top, top+lh) avec [0, W) × [0, H).
  const sx = Math.max(0, -left); // décalage source en x si débord à gauche
  const sy = Math.max(0, -top);
  const dx = Math.max(0, left); // position destination
  const dy = Math.max(0, top);
  const cw = Math.min(lw - sx, W - dx); // largeur visible
  const ch = Math.min(lh - sy, H - dy);
  if (cw <= 0 || ch <= 0) return null;

  const brut = { width: lw, height: lh, channels: 4 as const };
  if (sx === 0 && sy === 0 && cw === lw && ch === lh)
    return { input: pixels, raw: brut, left: dx, top: dy };

  const recadre = await sharp(pixels, { raw: brut })
    .extract({ left: sx, top: sy, width: cw, height: ch })
    .raw()
    .toBuffer();
  return {
    input: recadre,
    raw: { width: cw, height: ch, channels: 4 },
    left: dx,
    top: dy,
  };
}

/**
 * Le plus petit raster déjà rangé d'un fond qui soit au moins aussi large que
 * `W`, ou `null`. Les fichiers s'appellent `<empreinte>-<largeur>x<hauteur>`.
 */
async function fondDejaRasterise(empreinte: string, W: number): Promise<Buffer | null> {
  let noms: string[];
  try {
    noms = await readdir(DOSSIER_FONDS);
  } catch {
    return null;
  }
  const candidats = noms
    .map((nom) => /^([0-9a-f]+)-(\d+)x(\d+)\.png$/.exec(nom))
    .filter((m): m is RegExpExecArray => !!m && m[1] === empreinte && Number(m[2]) > W)
    .sort((a, b) => Number(a[2]) - Number(b[2]));
  for (const m of candidats) {
    try {
      return await readFile(resolve(DOSSIER_FONDS, m[0]));
    } catch {
      // effacé entre-temps par le ménage : on essaie le suivant
    }
  }
  return null;
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
    if (isSvg) return sharp(await fondSvgRasterise(buf, W, H));
    const pixels = await sharp(buf)
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

/**
 * Les fonds SVG déjà rasterisés, à la taille d'un format.
 *
 * Un fond n'est pas un dessin : c'est une photo emballée dans un SVG, et la
 * rasteriser prend de quatre à VINGT secondes — pour un résultat identique à
 * chaque fois, puisque toutes les affiches d'un même produit partagent leur
 * fond. On la fait donc une fois, et on relit le résultat (un dixième de
 * seconde) : aperçus de commande, fichier préparé au paiement, téléchargements.
 *
 * La clé est l'EMPREINTE du fichier, pas son nom : un fond remplacé sous le
 * même nom produit une autre clé, et jamais l'ancienne image.
 *
 * PNG, sans perte : c'est ce qui part à l'impression. Rangé dans
 * data/assets/cache/, qu'on peut vider sans rien perdre et que la sauvegarde
 * ignore (scripts/sauvegarder.sh).
 */
const DOSSIER_FONDS = resolve(ASSETS_DIR, "cache", "fonds");

/** Les rasterisations en cours : deux rendus du même fond n'en lancent qu'une. */
const fondsEnCours = new Map<string, Promise<Buffer>>();

async function fondSvgRasterise(svg: Buffer, W: number, H: number): Promise<Buffer> {
  const cle = `${createHash("sha1").update(svg).digest("hex")}-${W}x${H}`;
  const chemin = resolve(DOSSIER_FONDS, `${cle}.png`);
  try {
    const deja = await readFile(chemin);
    // La date du fichier dit quand il a servi pour la dernière fois : c'est
    // sur elle que se fait le ménage (voir fichiers-impression.ts).
    const maintenant = new Date();
    await utimes(chemin, maintenant, maintenant).catch(() => {});
    return deja;
  } catch {
    // Pas encore rasterisé.
  }

  let travail = fondsEnCours.get(chemin);
  if (!travail) {
    travail = (async () => {
      // Le même fond, déjà rasterisé pour un format PLUS GRAND (l'A3 d'une
      // commande, quand on demande l'A4 de sa vignette) : on le réduit, en
      // une demi-seconde, au lieu de repartir du SVG. A4 et A3 ont les mêmes
      // proportions, la réduction ne coupe rien.
      const plusGrand = await fondDejaRasterise(cle.split("-")[0]!, W);
      // unlimited:true → autorise les gros SVG de villes (sinon sharp lève
      // "Buffer size limit exceeded"). density réduite à 150 (suffisant en cover).
      const pixels = await sharp(
        plusGrand ?? svg,
        plusGrand ? undefined : { density: 150, unlimited: true },
      )
        .resize({ width: W, height: H, fit: "cover", position: "centre" })
        .png()
        .toBuffer();
      try {
        await mkdir(DOSSIER_FONDS, { recursive: true });
        // Écrit à côté puis renommé : un rendu qui lirait le fichier pendant
        // l'écriture trouverait une image tronquée.
        const provisoire = `${chemin}.${process.pid}.tmp`;
        await writeFile(provisoire, pixels);
        await rename(provisoire, chemin);
      } catch (e) {
        // Un disque plein ne doit pas empêcher d'imprimer : le fond est là,
        // en mémoire, simplement pas rangé pour la prochaine fois.
        console.warn("[impression] fond non mis en cache :", String(e));
      }
      return pixels;
    })().finally(() => fondsEnCours.delete(chemin));
    fondsEnCours.set(chemin, travail);
  }
  return travail;
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
  return pdfPleinePage(await renderPosterPng(config, opts), format);
}

/**
 * Le PDF d'une affiche PRÊTE À IMPRIMER : son visuel, et rien d'autre.
 *
 * Elle n'a ni fond, ni personnage, ni texte à composer : passée par
 * `renderPosterPdf`, elle sortait en page BLANCHE. Son visuel est posé à la
 * taille du format commandé, en entier : s'il n'a pas tout à fait les
 * proportions A4/A3, le reste de la feuille est blanc plutôt que d'y couper
 * un bout du dessin vendu. Quelques millimètres de blanc disparaissent sous
 * la feuillure d'un cadre ; un titre rogné, non.
 *
 * Même assemblage que les affiches composées : PNG sur blanc, inséré tel quel
 * dans une page aux dimensions exactes du format. Aucun filigrane.
 */
export async function renderImagePdf(
  image: Buffer,
  format: PosterFormat,
): Promise<Buffer> {
  const { width: W, height: H } = FORMAT_PX[format];
  const meta = await sharp(image).metadata();
  // Un SVG n'a pas de pixels : lu à la densité par défaut (72), il sortirait
  // flou. On le rasterise directement à la taille de la feuille.
  const source =
    meta.format === "svg" && meta.width && meta.height
      ? sharp(image, {
          density: Math.ceil(72 * Math.max(W / meta.width, H / meta.height)),
          unlimited: true,
        })
      : sharp(image);
  const png = await source
    // La photo d'un appareil porte son sens dans ses métadonnées : sans ce
    // redressement, une image prise en hauteur s'imprimerait couchée.
    .rotate()
    .resize({ width: W, height: H, fit: "contain", background: "#ffffff" })
    // Sur du blanc, en RVB 8 bits : c'est ce que l'insertion sans
    // recompression sait prendre (voir insererPngTelQuel).
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .png({ compressionLevel: 6 })
    .toBuffer();
  return pdfPleinePage(png, format);
}

/** Une page aux dimensions exactes du format, le PNG posé plein cadre. */
async function pdfPleinePage(pngBytes: Buffer, format: PosterFormat): Promise<Buffer> {
  const { width: pw, height: ph } = FORMAT_PT[format];

  const doc = await PDFDocument.create();
  const page = doc.addPage([pw, ph]);
  if (!insererPngTelQuel(doc, page, pngBytes, pw, ph)) {
    const img = await doc.embedPng(pngBytes);
    page.drawImage(img, { x: 0, y: 0, width: pw, height: ph });
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

/**
 * Pose un PNG pleine page SANS le décompresser.
 *
 * `embedPng` de pdf-lib décode l'image entière puis la recompresse, en
 * JavaScript, sur le fil principal de l'API : deux secondes pour un A4, près
 * de cinq pour un A3, pendant lesquelles le serveur ne répond plus à personne
 * — ni au site, ni au back-office.
 *
 * Or un PNG et un PDF compressent les pixels de la même façon (zlib, avec
 * les mêmes prédicteurs par ligne) : les données du PNG deviennent celles de
 * l'image du PDF, octet pour octet, sans rien recalculer. Même image, même
 * poids, et quelques millisecondes.
 *
 * Seul le cas le plus simple est pris — RVB 8 bits, non entrelacé, ce que
 * renderPosterPng produit. Pour tout autre PNG, on rend `false` et
 * l'appelant repasse par pdf-lib.
 */
function insererPngTelQuel(
  doc: PDFDocument,
  page: ReturnType<PDFDocument["addPage"]>,
  png: Buffer,
  pw: number,
  ph: number,
): boolean {
  const SIGNATURE = "89504e470d0a1a0a";
  if (png.length < 33 || png.subarray(0, 8).toString("hex") !== SIGNATURE) return false;

  let largeur = 0;
  let hauteur = 0;
  const donnees: Buffer[] = [];
  for (let i = 8; i + 8 <= png.length; ) {
    const longueur = png.readUInt32BE(i);
    const type = png.toString("latin1", i + 4, i + 8);
    const debut = i + 8;
    if (debut + longueur > png.length) return false;
    if (type === "IHDR") {
      largeur = png.readUInt32BE(debut);
      hauteur = png.readUInt32BE(debut + 4);
      const profondeur = png[debut + 8];
      const couleur = png[debut + 9];
      const entrelace = png[debut + 12];
      // 2 = RVB, sans palette ni transparence.
      if (profondeur !== 8 || couleur !== 2 || entrelace !== 0) return false;
    } else if (type === "IDAT") {
      donnees.push(png.subarray(debut, debut + longueur));
    } else if (type === "IEND") {
      break;
    }
    i = debut + longueur + 4; // + CRC
  }
  if (!largeur || !hauteur || !donnees.length) return false;

  const image = PDFRawStream.of(
    doc.context.obj({
      Type: "XObject",
      Subtype: "Image",
      Width: largeur,
      Height: hauteur,
      ColorSpace: "DeviceRGB",
      BitsPerComponent: 8,
      Filter: "FlateDecode",
      DecodeParms: {
        Predictor: 15,
        Colors: 3,
        BitsPerComponent: 8,
        Columns: largeur,
      },
    }),
    Buffer.concat(donnees),
  );
  const nom = page.node.newXObject("Affiche", doc.context.register(image));
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(pw, 0, 0, ph, 0, 0),
    drawObject(nom),
    popGraphicsState(),
  );
  return true;
}

// --- La facture --------------------------------------------------------------

/*
 * Rien de ce qui suit ne touche à l'affiche. C'est un document administratif :
 * du texte sur du blanc, en A4, écrit avec les polices standard du PDF plutôt
 * qu'avec sharp. Une facture se lit, se cherche et se copie — la passer par
 * une image, comme on le fait de l'affiche, en ferait une photo de facture.
 */

/** A4 portrait, en points PDF. */
const FACTURE_LARGEUR = 595.28;
const FACTURE_HAUTEUR = 841.89;
/** Marge de page : 18 mm, ce qu'une imprimante de bureau sait tenir. */
const FACTURE_MARGE = 51;

const ENCRE_FACTURE = rgb(0.09, 0.09, 0.09);
const ENCRE_FACTURE_PALE = rgb(0.42, 0.42, 0.42);
const FILET_FACTURE = rgb(0.78, 0.78, 0.78);

/**
 * Ramène un texte à ce que les polices standard du PDF savent dessiner.
 *
 * Elles écrivent en WinAnsi, qui couvre le français en entier — accents,
 * cédille, œ, guillemets, euro. Ce qu'il ne couvre pas, pdf-lib refuse de
 * l'écrire, et il refuse en LEVANT : un émoji dans le titre d'une affiche, ou
 * la fine insécable que `toLocaleString` glisse dans les nombres, suffirait à
 * faire échouer la facture entière. On remplace donc plutôt que d'échouer —
 * une facture avec un caractère en moins vaut mieux qu'une erreur 500.
 */
function pourPolicePdf(v: unknown): string {
  return (
    String(v ?? "")
      // Toutes les espaces exotiques deviennent l'espace ordinaire — dont
      // la fine insécable (U+202F) que le formatage français des nombres
      // glisse devant le symbole monétaire, et qui à elle seule suffirait à
      // faire échouer la page entière. Ces caractères sont échappés plutôt
      // qu'écrits en clair : invisibles à l'œil, un éditeur mal réglé les
      // perdrait sans qu'on le voie, et le garde-fou ne garderait plus rien.
      .replace(/[\u00a0\u2007\u2009\u200a\u202f\u2060]/g, " ")
      .replace(/[\u2018\u2019\u201b]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/\u2026/g, "...")
      // Le reste : Latin-1, plus les quelques signes que WinAnsi ajoute et
      // dont le français se sert : œ, Œ, Ÿ et l'euro.
      .replace(/[^\x20-\x7E\u00a1-\u00ff\u0152\u0153\u0178\u20ac]/g, "")
  );
}

/** Montant en centimes → « 49,00 € ». */
function euros(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",") + " €";
}

/** « 10 septembre 2026 ». */
function jourFrancais(quand: Date): string {
  return pourPolicePdf(
    quand.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
  );
}

/** Une ligne de la facture, telle qu'elle s'imprime. */
export interface LigneFacture {
  designation: string;
  /** Format, cadre, nombre de personnages… tout ce qui précise l'article. */
  precision?: string | null;
  /** Le texte imprimé sur l'affiche, ce qui distingue deux lignes identiques. */
  lignesAffiche?: string[];
  quantite: number;
  unitPriceCents: number;
}

/** Tout ce que la facture montre. Aucune lecture de base ici, comme partout dans ce fichier. */
export interface DonneesFacture {
  /** Le numéro de FACTURE, jamais celui de la commande. */
  numeroFacture: string;
  dateFacture: Date;
  numeroCommande: string;
  dateCommande: Date;
  /** À qui elle est adressée, une ligne par ligne d'adresse. */
  clientNom: string;
  clientEmail?: string | null;
  clientAdresse: string[];
  lignes: LigneFacture[];
  remiseCents: number;
  codePromo?: string | null;
  portCents: number;
  modeLivraison?: string | null;
  totalCents: number;
  /** Ce qui a déjà été rendu sur cette commande. Zéro le plus souvent. */
  rembourseCents: number;
  /** « Réglée par Stripe le 8 septembre 2026 », ou ce qui en tient lieu. */
  mentionReglement: string;
  /** L'identité légale de la boutique, quand elle a été renseignée. */
  adresseBoutique?: string[] | null;
  siret?: string | null;
  /** Portée en travers quand la commande a été annulée après sa facturation. */
  filigrane?: string | null;
}

/**
 * La facture d'une commande, en PDF A4.
 *
 * Elle porte les mentions d'une vente en franchise de TVA : le numéro de
 * facture, sa date, l'identité des deux parties, le détail des articles et
 * « TVA non applicable, article 293 B du CGI ». Le montant est celui qui a été
 * facturé — on ne recalcule rien, l'appelant a déjà lu la commande.
 */
export async function renderInvoicePdf(d: DonneesFacture): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Facture ${d.numeroFacture} - Memory Line`);
  doc.setSubject(`Commande ${d.numeroCommande}`);
  const page = doc.addPage([FACTURE_LARGEUR, FACTURE_HAUTEUR]);
  const normale = await doc.embedFont(StandardFonts.Helvetica);
  const grasse = await doc.embedFont(StandardFonts.HelveticaBold);

  const gauche = FACTURE_MARGE;
  const droite = FACTURE_LARGEUR - FACTURE_MARGE;

  /** Écrit un texte et rend l'ordonnée de la ligne suivante. */
  const ecrire = (
    texte: string,
    x: number,
    y: number,
    o?: { taille?: number; gras?: boolean; pale?: boolean; aDroite?: boolean },
  ): number => {
    const taille = o?.taille ?? 9.5;
    const police = o?.gras ? grasse : normale;
    const propre = pourPolicePdf(texte);
    const abscisse = o?.aDroite
      ? x - police.widthOfTextAtSize(propre, taille)
      : x;
    page.drawText(propre, {
      x: abscisse,
      y,
      size: taille,
      font: police,
      color: o?.pale ? ENCRE_FACTURE_PALE : ENCRE_FACTURE,
    });
    return y - taille * 1.45;
  };

  /* --- En-tête : le logo à gauche, la facture à droite -------------------- */

  let hautGauche = FACTURE_HAUTEUR - FACTURE_MARGE;
  const HAUTEUR_LOGO = 38;
  try {
    // Le même logo que les courriers, pris sur le disque de l'API. S'il
    // manque, le nom de la boutique le remplace : une facture sans logo reste
    // une facture, une erreur 500 n'en est pas une.
    const octets = await readFile(resolve(DOSSIER_MARQUE, "logo-memory-line.png"));
    const logo = await doc.embedPng(octets);
    const largeur = (logo.width / logo.height) * HAUTEUR_LOGO;
    page.drawImage(logo, {
      x: gauche,
      y: hautGauche - HAUTEUR_LOGO,
      width: largeur,
      height: HAUTEUR_LOGO,
    });
    hautGauche -= HAUTEUR_LOGO + 14;
  } catch {
    hautGauche = ecrire("MEMORY LINE", gauche, hautGauche - 14, {
      taille: 16,
      gras: true,
    });
  }

  let hautDroite = FACTURE_HAUTEUR - FACTURE_MARGE - 14;
  hautDroite = ecrire("FACTURE", droite, hautDroite, {
    taille: 20,
    gras: true,
    aDroite: true,
  });
  hautDroite -= 4;
  hautDroite = ecrire(`N° ${d.numeroFacture}`, droite, hautDroite, {
    taille: 11,
    gras: true,
    aDroite: true,
  });
  hautDroite = ecrire(
    `Émise le ${jourFrancais(d.dateFacture)}`,
    droite,
    hautDroite,
    { pale: true, aDroite: true },
  );

  /* --- Les deux parties --------------------------------------------------- */

  let y = Math.min(hautGauche, hautDroite) - 18;
  const colonneClient = FACTURE_LARGEUR / 2 + 10;
  const hautDesParties = y;

  y = ecrire("ÉMETTEUR", gauche, y, { taille: 8, gras: true, pale: true });
  y = ecrire("Memory Line", gauche, y - 2, { gras: true });
  y = ecrire("Affiches personnalisées", gauche, y, { pale: true });
  for (const ligne of d.adresseBoutique ?? [])
    if (ligne) y = ecrire(ligne, gauche, y, { pale: true });
  if (d.siret) y = ecrire(`SIRET ${d.siret}`, gauche, y, { pale: true });

  let yClient = ecrire("FACTURÉ À", colonneClient, hautDesParties, {
    taille: 8,
    gras: true,
    pale: true,
  });
  yClient = ecrire(d.clientNom || "Client", colonneClient, yClient - 2, {
    gras: true,
  });
  for (const ligne of d.clientAdresse)
    if (ligne) yClient = ecrire(ligne, colonneClient, yClient, { pale: true });
  if (d.clientEmail)
    yClient = ecrire(d.clientEmail, colonneClient, yClient, { pale: true });

  y = Math.min(y, yClient) - 16;

  /* --- Ce que cette facture couvre ---------------------------------------- */

  y = ecrire(
    `Commande ${d.numeroCommande} du ${jourFrancais(d.dateCommande)}`,
    gauche,
    y,
    { taille: 10, gras: true },
  );
  y = ecrire(d.mentionReglement, gauche, y, { pale: true });
  y -= 12;

  /* --- Le détail ---------------------------------------------------------- */

  const COL_QTE = droite - 190;
  const COL_UNITE = droite - 105;

  const filet = (ordonnee: number, epaisseur = 0.6) =>
    page.drawRectangle({
      x: gauche,
      y: ordonnee,
      width: droite - gauche,
      height: epaisseur,
      color: FILET_FACTURE,
    });

  ecrire("DÉSIGNATION", gauche, y, { taille: 8, gras: true, pale: true });
  ecrire("QTÉ", COL_QTE, y, { taille: 8, gras: true, pale: true, aDroite: true });
  ecrire("PRIX UNIT.", COL_UNITE, y, {
    taille: 8,
    gras: true,
    pale: true,
    aDroite: true,
  });
  ecrire("TOTAL", droite, y, { taille: 8, gras: true, pale: true, aDroite: true });
  y -= 7;
  filet(y);
  y -= 15;

  for (const l of d.lignes) {
    const hautDeLaLigne = y;
    y = ecrire(l.designation || "Affiche personnalisée", gauche, y, {
      taille: 9.5,
    });
    if (l.precision) y = ecrire(l.precision, gauche, y, { taille: 8.5, pale: true });
    // Le texte de l'affiche : c'est lui, et lui seul, qui distingue deux
    // lignes de même titre et de même prix sur une facture retrouvée un an
    // après. Il tient entre guillemets, comme partout dans la boutique.
    for (const ligne of l.lignesAffiche ?? [])
      if (ligne) y = ecrire(`« ${ligne} »`, gauche + 8, y, { taille: 8.5, pale: true });

    ecrire(String(l.quantite), COL_QTE, hautDeLaLigne, { aDroite: true });
    ecrire(euros(l.unitPriceCents), COL_UNITE, hautDeLaLigne, { aDroite: true });
    ecrire(euros(l.unitPriceCents * l.quantite), droite, hautDeLaLigne, {
      aDroite: true,
    });
    y -= 5;
    filet(y, 0.4);
    y -= 15;
  }

  /* --- Les totaux --------------------------------------------------------- */

  const sousTotal = d.lignes.reduce(
    (s, l) => s + l.unitPriceCents * l.quantite,
    0,
  );
  const totalLibelle = droite - 105;
  y -= 4;

  const totalLigne = (
    libelle: string,
    montant: string,
    o?: { gras?: boolean; pale?: boolean },
  ) => {
    ecrire(libelle, totalLibelle, y, { aDroite: true, ...o });
    y = ecrire(montant, droite, y, { aDroite: true, ...o });
  };

  totalLigne("Sous-total", euros(sousTotal), { pale: true });
  if (d.remiseCents > 0)
    totalLigne(
      `Réduction${d.codePromo ? ` (${d.codePromo})` : ""}`,
      `- ${euros(d.remiseCents)}`,
      { pale: true },
    );
  totalLigne(
    `Livraison${d.modeLivraison ? ` (${d.modeLivraison})` : ""}`,
    euros(d.portCents),
    { pale: true },
  );
  y -= 3;
  page.drawRectangle({
    x: totalLibelle - 120,
    y,
    width: droite - (totalLibelle - 120),
    height: 0.6,
    color: FILET_FACTURE,
  });
  y -= 15;
  totalLigne("TOTAL À PAYER", euros(d.totalCents), { gras: true });
  if (d.rembourseCents > 0) {
    y -= 2;
    totalLigne("Dont remboursé", `- ${euros(d.rembourseCents)}`, { pale: true });
    totalLigne("Net encaissé", euros(d.totalCents - d.rembourseCents), {
      pale: true,
    });
  }

  /* --- Le pied ------------------------------------------------------------ */

  let pied = FACTURE_MARGE + 46;
  filet(pied + 14);
  pied = ecrire(
    "TVA non applicable, article 293 B du CGI.",
    gauche,
    pied,
    { taille: 8.5, gras: true, pale: true },
  );
  pied = ecrire(
    "Memory Line, affiches personnalisées. Une question sur cette facture ? Répondez au courrier qui vous l'a apportée.",
    gauche,
    pied,
    { taille: 8, pale: true },
  );

  // Le filigrane, quand la commande a été annulée APRÈS avoir été facturée :
  // le numéro reste pris, la facture reste éditable, et le papier dit
  // lui-même qu'elle ne vaut plus. Effacer la facture aurait fait le trou que
  // toute cette mécanique existe pour éviter.
  if (d.filigrane) dessinerFiligrane(page, grasse, d.filigrane);

  return Buffer.from(await doc.save());
}

/** Écrit un mot en travers de la page, en gris très clair. */
function dessinerFiligrane(page: PDFPage, police: PDFFont, mot: string): void {
  const propre = pourPolicePdf(mot).toUpperCase();
  const TAILLE = 66;
  const largeur = police.widthOfTextAtSize(propre, TAILLE);
  page.drawText(propre, {
    x: (FACTURE_LARGEUR - largeur * 0.72) / 2,
    y: FACTURE_HAUTEUR / 2 - largeur * 0.36,
    size: TAILLE,
    font: police,
    color: rgb(0.88, 0.85, 0.85),
    rotate: degrees(45),
  });
}
