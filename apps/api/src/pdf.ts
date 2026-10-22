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
  LARGEUR_CADRE_PERSONNAGE,
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
  morceauxDeTexte,
  type MorceauDeTexte,
  type PoliceAffiche,
  policeParId,
  POLICE_TITRE_DEFAUT,
  POLICE_SOUSTITRE_DEFAUT,
} from "@memoryline/types";
import {
  COULEUR_TEXTE_DEFAUT,
  lignesRemplies,
  sousLignes,
  styleDesLignes,
} from "@memoryline/types";
import {
  boiteDeLigne,
  espaceAvantLigne,
  espacementDeLigne,
  HAUT_DU_TEXTE,
  interligneDeLigne,
  INTERLIGNE_LIGNE_POSEE,
  LARGEUR_DU_TEXTE,
  tailleDeLigne,
} from "@memoryline/types";
import type { PosterConfig, PosterFormat } from "@memoryline/types";
import {
  dateLongue,
  mentionTva,
  prixDans,
  tc,
  type Langue,
} from "./courriels/index.js";

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
 * Les dimensions d'un format dans le sens voulu. Les tables ci-dessus sont en
 * portrait ; en paysage, largeur et hauteur s'échangent — même feuille, posée
 * de l'autre côté.
 */
function dansLeSens(
  table: Record<PosterFormat, { width: number; height: number }>,
  format: PosterFormat,
  orientation: PosterConfig["orientation"],
): { width: number; height: number } {
  const d = table[format];
  return orientation === "paysage" ? { width: d.height, height: d.width } : d;
}

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
  /**
   * Les anciennes cases « Le client peut la changer » : plus lues depuis le
   * 20 octobre 2026, une pièce s'imprime zone par zone (cf. couleursDeLaPiece).
   */
  zonesMasquees?: string[] | null;
  /** Groupes de couleurs : ils ne changent rien à l'impression, qui va zone par zone. */
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
  /** La signature à poser en bas à droite, ou rien (réglage éteint). */
  signature?: SignatureAffiche | null;
}

/**
 * La signature de la boutique, posée en bas à droite de CHAQUE création —
 * affiches personnalisées comme affiches tirées d'une photo.
 *
 * Réglée au back-office (Contenu du site › Signature des créations) : son
 * image, sa taille et sa marge. Les tailles sont des fractions du PETIT côté
 * de l'affiche, comme le texte : la signature d'une affiche en paysage n'est
 * pas plus grosse que celle d'un portrait, ni celle d'un A3 que celle d'un A4
 * sur la feuille, à l'échelle près.
 *
 * Elle n'existe QUE sur le fichier d'impression : aucun aperçu montré au
 * client ne la porte (voir fichiers-impression.ts, signatureDesCreations).
 */
export interface SignatureAffiche {
  /** L'image (PNG transparent conseillé, ou SVG), déjà lue. */
  image: Buffer;
  /**
   * Largeur de l'IMAGE, marges transparentes comprises, en fraction du petit
   * côté (0,07 = 7 %) : une image envoyée au back-office garde la taille
   * qu'elle avait sur le papier.
   */
  largeur: number;
  /**
   * Marge entre le DESSIN et les bords droit et bas, même unité. Les marges
   * transparentes de l'image n'en font pas partie (voir signaturePosee).
   */
  marge: number;
  /** Opacité, de 0 à 1. */
  opacite: number;
  /** Ce qui l'identifie dans l'empreinte des fichiers d'impression. */
  empreinte: string;
}

/**
 * L'image privée de ses marges TRANSPARENTES, et d'elles seules.
 *
 * Le logo de la boutique porte, autour de l'écriture, des marges vides : 13 %
 * de sa largeur à droite, 10 % de sa hauteur en bas. Posée à « 3 % du bord »,
 * l'écriture se retrouvait à 4,6 % du bord droit et 3,5 % du bas — la
 * signature flottait au-dessus du coin au lieu de s'y loger, et la boutique
 * l'a redemandée « au ras du coin ». La marge du back-office se mesure donc
 * désormais depuis le dessin, ce que l'on voit, quelle que soit la façon dont
 * l'image a été détourée.
 *
 * On ne rogne que la transparence (la couche alpha), jamais une couleur : le
 * fond blanc d'un PNG opaque fait partie de ce qui s'imprime, il reste.
 */
async function sansMargesTransparentes(png: Buffer): Promise<Buffer> {
  try {
    // En DEUX passes : sharp range lui-même les opérations d'une chaîne, et
    // le rognage y passe AVANT l'extraction de la couche, quel que soit
    // l'ordre d'écriture. Écrit en une seule chaîne, il ne rognait rien.
    const alpha = await sharp(png).extractChannel(3).png().toBuffer();
    const { info } = await sharp(alpha)
      .trim({ background: "#000000", threshold: 8 })
      .toBuffer({ resolveWithObject: true });
    return await sharp(png)
      .extract({
        left: -(info.trimOffsetLeft ?? 0),
        top: -(info.trimOffsetTop ?? 0),
        width: info.width,
        height: info.height,
      })
      .png()
      .toBuffer();
  } catch {
    // Rien à rogner, ou rien de visible : l'image reste telle qu'elle est.
    return png;
  }
}

/**
 * La signature prête à poser sur une affiche de W × H, ou null.
 *
 * L'image est d'abord mise à sa LARGEUR, marges comprises, puis rognée : la
 * taille de la signature sur le papier ne change pas, seule sa place change.
 */
async function signaturePosee(
  s: SignatureAffiche | null | undefined,
  W: number,
  H: number,
): Promise<OverlayOptions | null> {
  if (!s) return null;
  const petitCote = Math.min(W, H);
  const largeur = Math.max(1, Math.round(petitCote * s.largeur));
  const marge = Math.round(petitCote * s.marge);
  try {
    // density haute : un logo vectoriel reste net une fois agrandi à 300 dpi.
    const miseALaTaille = await sharp(s.image, { density: 300 })
      .resize({ width: largeur })
      .ensureAlpha()
      .png()
      .toBuffer();
    let image = sharp(await sansMargesTransparentes(miseALaTaille));
    if (s.opacite < 1)
      // L'opacité multiplie la couche de transparence de l'image : le blanc
      // d'un PNG opaque, lui, reste visible — d'où le PNG transparent conseillé.
      image = sharp(await image.png().toBuffer()).composite([
        {
          input: Buffer.from([255, 255, 255, Math.round(255 * s.opacite)]),
          raw: { width: 1, height: 1, channels: 4 },
          tile: true,
          blend: "dest-in",
        },
      ]);
    const { data, info } = await image.png().toBuffer({ resolveWithObject: true });
    return {
      input: data,
      left: Math.max(0, W - marge - info.width),
      top: Math.max(0, H - marge - info.height),
    };
  } catch (e) {
    // Une image illisible ne doit pas empêcher d'imprimer : l'affiche part
    // sans signature, et la raison reste dans le journal.
    console.warn("[impression] signature illisible :", String(e));
    return null;
  }
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
    // hauteur du cadre (aspect 1:2 -> 2 × largeur, en fraction de W), puis en
    // fraction de H : ÷ √2 (page portrait W:H = 1:√2). La largeur du cadre
    // est celle du paquet partagé, que l'aperçu lit aussi.
    const frameHfrac = (LARGEUR_CADRE_PERSONNAGE * scale * 2) / Math.SQRT2;
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
      // même clé que celle écrite par le configurateur). Même règle que
      // l'aperçu de la boutique (couleursDeLaPiece) : rien n'est forcé.
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

/** Corps auquel on mesure une ligne avant de la ramener à sa vraie taille. */
const CORPS_MESURE = 96;

/**
 * Le contenu d'une ligne, chaque morceau dans sa police.
 *
 * Un seul morceau — le cas courant — sort exactement comme avant : du texte
 * nu, sans balise en plus. Le découpage ne sert qu'aux caractères qu'une
 * police ne sait pas écrire (cf. morceauxDeTexte), et chaque morceau porte
 * alors sa propre famille.
 *
 * Les espaces se resserrent ici, une seule entre deux mots, comme le
 * navigateur le fait à l'écran : le texte part ensuite avec
 * `xml:space="preserve"` (ATTRIBUT_ESPACES). Sans lui, le moteur du SVG
 * avalait l'espace qui touche une balise — « été 2019 à la mer » s'imprimait
 * « été2019à la mer », les chiffres de la manuscrite étant dans la leur.
 */
function contenuDeLigne(morceaux: MorceauDeTexte[]): string {
  const texte = (m: MorceauDeTexte | undefined) =>
    escapeXml((m?.texte ?? "").replace(/\s+/g, " "));
  if (morceaux.length <= 1) return texte(morceaux[0]);
  return morceaux
    .map(
      (m) =>
        `<tspan font-family="${escapeXml(familleCss(m.police))}">` +
        `${texte(m)}</tspan>`,
    )
    .join("");
}

/** Garde les espaces que contenuDeLigne a laissées, à côté des balises comprises. */
const ATTRIBUT_ESPACES = 'xml:space="preserve"';

/**
 * Largeur de l'encre d'un contenu de ligne écrit au corps de mesure, en
 * pixels. Le contenu est encadré de deux barres « | » : voir largeurParCorps.
 */
async function encreEntreBarres(
  contenu: string,
  nbCaracteres: number,
  famille: string,
  espacement: number,
): Promise<number> {
  const w = Math.ceil(CORPS_MESURE * (nbCaracteres + 6) * 1.6);
  const h = CORPS_MESURE * 3;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<text ${ATTRIBUT_ESPACES} x="${CORPS_MESURE}" y="${CORPS_MESURE * 2}" font-family="${escapeXml(famille)}" ` +
    `font-size="${CORPS_MESURE}" letter-spacing="${espacement * CORPS_MESURE}" fill="#000000">` +
    `|${contenu}|</text></svg>`;
  const { info } = await sharp(Buffer.from(svg))
    .trim({ threshold: 0 })
    .png()
    .toBuffer({ resolveWithObject: true });
  return info.width;
}

/** Les deux barres seules, par police et espacement : elles ne changent jamais. */
const barresSeules = new Map<string, Promise<number>>();

/**
 * Largeur d'une ligne, en multiples de son corps : son AVANCE, espacement des
 * lettres compris — la largeur que le navigateur lui donne à l'écran, et
 * celle qu'il compare à la place du bloc pour décider de la réduire
 * (LARGEUR_DU_TEXTE).
 *
 * Le texte est centré : une ligne trop longue ne déborde pas, elle est ROGNÉE
 * des deux côtés — un nom à peine plus long que « SAINT-VALERY-SUR-SOMME »
 * partait à l'impression amputé de sa première et de sa dernière syllabe. On
 * ne peut pas connaître l'avance des glyphes autrement qu'en les dessinant :
 * on rasterise donc la ligne à petit corps (la largeur est proportionnelle au
 * corps, à 0,2 % près), ENTRE DEUX BARRES « | », puis les deux barres
 * seules ; l'écart des deux encres est l'avance du texte, approches de la
 * première et de la dernière lettre comprises. L'encre seule, qu'on mesurait
 * jusqu'ici, les oubliait — et mesurait dans la police par défaut du serveur,
 * faute de nommer celle de la ligne.
 *
 * `null` si la mesure échoue : mieux vaut le rendu d'avant que pas de texte.
 */
async function largeurParCorps(
  morceaux: MorceauDeTexte[],
  police: PoliceAffiche,
  espacement: number,
): Promise<number | null> {
  const famille = familleCss(police);
  const nb = [...morceaux.map((m) => m.texte).join("")].length;
  try {
    const cle = `${famille}|${espacement}`;
    let barres = barresSeules.get(cle);
    if (!barres) {
      barres = encreEntreBarres("", 0, famille, espacement);
      barresSeules.set(cle, barres);
      // Une mesure ratée ne doit pas rester en mémoire pour toujours.
      barres.catch(() => barresSeules.delete(cle));
    }
    const avec = await encreEntreBarres(contenuDeLigne(morceaux), nb, famille, espacement);
    return (avec - (await barres)) / CORPS_MESURE;
  } catch {
    return null;
  }
}

/** Un nombre de pixels écrit dans le SVG : au centième, sans zéros inutiles. */
function px(valeur: number): string {
  return String(Math.round(valeur * 100) / 100);
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
 *
 * LA MISE EN PAGE EST CELLE DE L'APERÇU, ligne de base par ligne de base :
 * mêmes tailles, même place en largeur, même interligne, même espace avant
 * chaque ligne, même espacement des lettres sur la ligne de tête — tous lus
 * dans packages/types (mise-en-page-texte.ts) — et, faute de boîtes CSS dans
 * un SVG, le même calcul que le navigateur pour placer la ligne de base dans
 * sa boîte (boiteDeLigne). Aucune ligne n'est en gras : aucune police
 * d'affiche n'en a, et le serveur fabriquait sur la première ligne un faux
 * gras (moitié d'encre en plus) que l'écran ne montrait pas.
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
  const utile = width * LARGEUR_DU_TEXTE;

  const rendus = await Promise.all(
    lignes.map(async (ligne, i) => {
      const police = policeParId(
        ligne.font,
        POLICE_LIGNE_DEFAUT[i] ?? POLICE_SOUSTITRE_DEFAUT,
      );
      // Une ligne coupée à la main par le client (touche Entrée) s'imprime en
      // autant de lignes, coupées au même endroit que dans l'aperçu.
      // Les caractères que la police ne sait pas écrire passent dans une
      // autre — les chiffres de la manuscrite, notamment (cf. morceauxDeTexte).
      const decoupe = sousLignes(ligne.value).map((s) => morceauxDeTexte(s, police));
      const espacement = espacementDeLigne(i);
      // Rapportée au PETIT côté : c'est la largeur en portrait, la hauteur en
      // paysage — sinon le titre d'une affiche couchée grossirait de 41 %.
      const voulue = Math.min(width, height) * tailleDeLigne(i) * facteur;
      // On ne réduit QUE ce qui dépasserait la place du bloc, et d'autant
      // qu'il dépasse : l'aperçu fait la même chose (reductionDesLignes).
      // Les morceaux d'une ligne coupée gardent la même taille entre eux :
      // c'est le plus long qui décide.
      const largeurs = await Promise.all(
        decoupe.map((m) => largeurParCorps(m, police, espacement)),
      );
      const occupee = Math.max(0, ...largeurs.map((l) => (l === null ? 0 : l * voulue)));
      return {
        police,
        decoupe,
        espacement,
        taille: occupee > utile ? (voulue * utile) / occupee : voulue,
      };
    }),
  );

  /** Les boîtes des morceaux d'une ligne, en multiples de sa taille. */
  const boites = (r: (typeof rendus)[number], interligne: number) =>
    r.decoupe.map((morceaux) =>
      // La police de la ligne compte toujours (l'« étai » de la boîte CSS),
      // celles de ses morceaux s'y ajoutent.
      boiteDeLigne([r.police, ...morceaux.map((m) => m.police)], interligne),
    );

  const parts: string[] = [];
  // Le haut du bloc, puis le bas de la dernière ligne empilée, en pixels.
  let haut = height * HAUT_DU_TEXTE;
  for (const [i, r] of rendus.entries()) {
    const ligne = lignes[i]!;
    const attributs =
      `font-family="${escapeXml(familleCss(r.police))}" font-size="${px(r.taille)}"` +
      (r.espacement ? ` letter-spacing="${px(r.espacement * r.taille)}"` : "") +
      ` fill="${escapeXml(couleur)}" ${ATTRIBUT_ESPACES}`;
    // Le navigateur ajoute l'espacement des lettres APRÈS chaque lettre, la
    // dernière comprise, et centre le tout : l'encre y glisse d'un
    // demi-espacement vers la gauche (0,3 mm sur un A4). Le moteur du SVG
    // ne compte pas ce dernier espace : on le décale d'autant.
    const decalage = (r.espacement * r.taille) / 2;
    // Une ligne déplacée à la main s'imprime là où le client l'a posée : le
    // centre de la ligne vaut (x·largeur, y·hauteur), exactement comme dans
    // l'aperçu. Elle sort de l'empilement, qui continue sans elle. Coupée en
    // plusieurs morceaux, c'est le centre du bloc qui tombe sur ce point.
    if (typeof ligne.x === "number" && typeof ligne.y === "number") {
      const b = boites(r, INTERLIGNE_LIGNE_POSEE);
      let y = ligne.y * height - (b.reduce((s, x) => s + x.hauteur, 0) * r.taille) / 2;
      for (const [j, morceaux] of r.decoupe.entries()) {
        parts.push(
          `<text x="${px(ligne.x * width - decalage)}" y="${px(y + b[j]!.base * r.taille)}" ` +
            `text-anchor="middle" ${attributs}>${contenuDeLigne(morceaux)}</text>`,
        );
        y += b[j]!.hauteur * r.taille;
      }
      continue;
    }
    const b = boites(r, interligneDeLigne(i));
    haut += espaceAvantLigne(i) * r.taille;
    for (const [j, morceaux] of r.decoupe.entries()) {
      parts.push(
        `<text x="${px(width / 2 - decalage)}" y="${px(haut + b[j]!.base * r.taille)}" ` +
          `text-anchor="middle" ${attributs}>${contenuDeLigne(morceaux)}</text>`,
      );
      haut += b[j]!.hauteur * r.taille;
    }
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
  const { width: W, height: H } = dansLeSens(FORMAT_PX, format, config.orientation);

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
  // Largeur d'un perso = LARGEUR_CADRE_PERSONNAGE × scale × W : la même
  // valeur partagée que l'aperçu du configurateur, pour que le PDF
  // corresponde exactement à l'écran.
  const CHAR_BASE_WIDTH = LARGEUR_CADRE_PERSONNAGE;
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

  // 4) La signature de la boutique, en bas à droite, par-dessus tout le reste.
  const signature = await signaturePosee(opts.data.signature, W, H);
  if (signature) composites.push(signature);

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

/**
 * Les images WebP collées DANS un fond SVG (« data:image/webp;base64,… »),
 * converties en PNG.
 *
 * Le moteur qui dessine les SVG (librsvg, dans sharp) ne sait pas lire le
 * WebP : il laisse l'image de côté, SANS erreur. Le navigateur, lui, l'affiche.
 * Le client validait donc à l'écran une affiche complète, et l'atelier
 * recevait une feuille presque blanche, avec un titre blanc invisible —
 * douze fonds étaient dans ce cas (Ault, Berck, Soissons, Vieux-Moulin…).
 * sharp, en revanche, sait décoder le WebP : on convertit chaque image avant
 * de confier le SVG au moteur de dessin.
 */
async function sansWebp(svg: Buffer): Promise<Buffer> {
  if (!svg.includes("data:image/webp")) return svg;
  const texte = svg.toString("utf8");
  const morceaux: string[] = [];
  let reprise = 0;
  for (const m of texte.matchAll(/data:image\/webp;base64,([A-Za-z0-9+/=\s]+)/g)) {
    const png = await sharp(Buffer.from(m[1]!.replace(/\s+/g, ""), "base64"), {
      unlimited: true,
    })
      .png()
      .toBuffer();
    morceaux.push(texte.slice(reprise, m.index), `data:image/png;base64,${png.toString("base64")}`);
    reprise = m.index! + m[0].length;
  }
  morceaux.push(texte.slice(reprise));
  return Buffer.from(morceaux.join(""), "utf8");
}

async function fondSvgRasterise(svg: Buffer, W: number, H: number): Promise<Buffer> {
  // Un fond qui contenait du WebP a pu être rangé BLANC dans le cache avant
  // la conversion : sa clé change, pour qu'il soit redessiné une fois. Les
  // autres fonds gardent la leur, et leur image déjà calculée.
  const contientWebp = svg.includes("data:image/webp");
  const cle = `${createHash("sha1")
    .update(svg)
    .update(contientWebp ? "webp→png" : "")
    .digest("hex")}-${W}x${H}`;
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
        plusGrand ?? (await sansWebp(svg)),
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
  return pdfPleinePage(await renderPosterPng(config, opts), format, config.orientation);
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
async function pdfPleinePage(
  pngBytes: Buffer,
  format: PosterFormat,
  orientation?: PosterConfig["orientation"],
): Promise<Buffer> {
  const { width: pw, height: ph } = dansLeSens(FORMAT_PT, format, orientation);

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

/** Montant en centimes → « 49,00 € », ou sa forme dans la langue de la facture. */
function euros(cents: number, langue: Langue = "fr"): string {
  return prixDans(langue, cents);
}

/** « 10 septembre 2026 », « 10 September 2026 »… */
function jourEnToutesLettres(quand: Date, langue: Langue = "fr"): string {
  return pourPolicePdf(dateLongue(langue, quand));
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
  /** Déjà mis en forme par l'appelant (« 123 456 789 00012 », voir facturation.ts). */
  siret?: string | null;
  /** Une ligne libre sous le SIRET : « EI », « RCS Mulhouse … ». */
  mention?: string | null;
  /**
   * Le lieu de retrait, pour une commande retirée sur place : imprimé sous
   * la commande, à côté du mode, et plus dans « Facturé à » — un chalet de
   * marché de Noël n'est pas l'adresse de la cliente.
   */
  retrait?: string | null;
  /** Portée en travers quand la commande a été annulée après sa facturation. */
  filigrane?: string | null;
  /**
   * La langue de la facture : celle de la cliente. Les intitulés, les
   * montants et les dates la suivent ; la mention de TVA reste en français,
   * avec sa traduction dessous. Absente : le français.
   */
  langue?: Langue;
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
  const langue = d.langue ?? "fr";
  const t = tc(langue);
  const doc = await PDFDocument.create();
  doc.setTitle(t("facturePdf.titreDocument", { facture: d.numeroFacture }));
  doc.setSubject(t("facturePdf.sujetDocument", { numero: d.numeroCommande }));
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
  hautDroite = ecrire(t("facturePdf.titre"), droite, hautDroite, {
    taille: 20,
    gras: true,
    aDroite: true,
  });
  hautDroite -= 4;
  hautDroite = ecrire(t("facturePdf.numero", { facture: d.numeroFacture }), droite, hautDroite, {
    taille: 11,
    gras: true,
    aDroite: true,
  });
  hautDroite = ecrire(
    t("facturePdf.emiseLe", { date: jourEnToutesLettres(d.dateFacture, langue) }),
    droite,
    hautDroite,
    { pale: true, aDroite: true },
  );

  /* --- Les deux parties --------------------------------------------------- */

  let y = Math.min(hautGauche, hautDroite) - 18;
  const colonneClient = FACTURE_LARGEUR / 2 + 10;
  const hautDesParties = y;

  // La colonne de l'émetteur s'arrête avant celle du client. L'écran des
  // factures limite déjà l'adresse à 50 caractères par ligne ; on coupe
  // quand même ici, par sécurité : une adresse posée avant cet écran, ou une
  // mention longue, ne doit pas déborder sur « Facturé à ».
  const largeurEmetteur = colonneClient - gauche - 12;
  const coupee = (texte: string, taille = 9.5): string[] => {
    const mots = pourPolicePdf(texte).split(/\s+/).filter(Boolean);
    const lignes: string[] = [];
    let courante = "";
    for (const mot of mots) {
      const essai = courante ? `${courante} ${mot}` : mot;
      if (courante && normale.widthOfTextAtSize(essai, taille) > largeurEmetteur) {
        lignes.push(courante);
        courante = mot;
      } else courante = essai;
    }
    if (courante) lignes.push(courante);
    return lignes;
  };

  y = ecrire(t("facturePdf.emetteur"), gauche, y, { taille: 8, gras: true, pale: true });
  y = ecrire("Memory Line", gauche, y - 2, { gras: true });
  y = ecrire(t("facturePdf.activite"), gauche, y, { pale: true });
  for (const ligne of d.adresseBoutique ?? [])
    for (const morceau of ligne ? coupee(ligne) : [])
      y = ecrire(morceau, gauche, y, { pale: true });
  // Le SIRET est un identifiant français, qui ne se traduit pas.
  if (d.siret) y = ecrire(`SIRET ${d.siret}`, gauche, y, { pale: true });
  for (const morceau of d.mention ? coupee(d.mention) : [])
    y = ecrire(morceau, gauche, y, { pale: true });

  let yClient = ecrire(t("facturePdf.factureA"), colonneClient, hautDesParties, {
    taille: 8,
    gras: true,
    pale: true,
  });
  yClient = ecrire(d.clientNom || t("facturePdf.clientParDefaut"), colonneClient, yClient - 2, {
    gras: true,
  });
  for (const ligne of d.clientAdresse)
    if (ligne) yClient = ecrire(ligne, colonneClient, yClient, { pale: true });
  if (d.clientEmail)
    yClient = ecrire(d.clientEmail, colonneClient, yClient, { pale: true });

  y = Math.min(y, yClient) - 16;

  /* --- Ce que cette facture couvre ---------------------------------------- */

  y = ecrire(
    t("facturePdf.commandeDu", {
      numero: d.numeroCommande,
      date: jourEnToutesLettres(d.dateCommande, langue),
    }),
    gauche,
    y,
    { taille: 10, gras: true },
  );
  y = ecrire(d.mentionReglement, gauche, y, { pale: true });
  // Le lieu de retrait, en toutes lettres : c'est là qu'elle a été remise.
  if (d.retrait) y = ecrire(d.retrait, gauche, y, { pale: true });
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

  ecrire(t("facturePdf.designation"), gauche, y, { taille: 8, gras: true, pale: true });
  ecrire(t("facturePdf.quantite"), COL_QTE, y, { taille: 8, gras: true, pale: true, aDroite: true });
  ecrire(t("facturePdf.prixUnitaire"), COL_UNITE, y, {
    taille: 8,
    gras: true,
    pale: true,
    aDroite: true,
  });
  ecrire(t("facturePdf.totalColonne"), droite, y, { taille: 8, gras: true, pale: true, aDroite: true });
  y -= 7;
  filet(y);
  y -= 15;

  for (const l of d.lignes) {
    const hautDeLaLigne = y;
    y = ecrire(l.designation || t("lignes.titreParDefaut"), gauche, y, {
      taille: 9.5,
    });
    if (l.precision) y = ecrire(l.precision, gauche, y, { taille: 8.5, pale: true });
    // Le texte de l'affiche : c'est lui, et lui seul, qui distingue deux
    // lignes de même titre et de même prix sur une facture retrouvée un an
    // après. Il tient entre guillemets, comme partout dans la boutique.
    for (const ligne of l.lignesAffiche ?? [])
      if (ligne)
        y = ecrire(t("facturePdf.texteAffiche", { texte: ligne }), gauche + 8, y, {
          taille: 8.5,
          pale: true,
        });

    ecrire(String(l.quantite), COL_QTE, hautDeLaLigne, { aDroite: true });
    ecrire(euros(l.unitPriceCents, langue), COL_UNITE, hautDeLaLigne, { aDroite: true });
    ecrire(euros(l.unitPriceCents * l.quantite, langue), droite, hautDeLaLigne, {
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

  totalLigne(t("facturePdf.sousTotal"), euros(sousTotal, langue), { pale: true });
  if (d.remiseCents > 0)
    totalLigne(
      `${t("facturePdf.reduction")}${d.codePromo ? ` (${d.codePromo})` : ""}`,
      `- ${euros(d.remiseCents, langue)}`,
      { pale: true },
    );
  totalLigne(
    `${t("facturePdf.livraison")}${d.modeLivraison ? ` (${d.modeLivraison})` : ""}`,
    euros(d.portCents, langue),
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
  totalLigne(t("facturePdf.totalAPayer"), euros(d.totalCents, langue), { gras: true });
  if (d.rembourseCents > 0) {
    y -= 2;
    totalLigne(t("facturePdf.dontRembourse"), `- ${euros(d.rembourseCents, langue)}`, {
      pale: true,
    });
    totalLigne(t("facturePdf.netEncaisse"), euros(d.totalCents - d.rembourseCents, langue), {
      pale: true,
    });
  }

  /* --- Le pied ------------------------------------------------------------ */

  // La mention de TVA est une mention légale française : elle s'imprime en
  // français dans toutes les langues, et sa traduction vient dessous, pour
  // que la cliente sache ce qu'elle lit. Le pied a la place d'une ligne de
  // plus avant la marge.
  const tva = mentionTva(langue);
  let pied = FACTURE_MARGE + 46;
  filet(pied + 14);
  pied = ecrire(tva.francaise, gauche, pied, { taille: 8.5, gras: true, pale: true });
  if (tva.traduction)
    pied = ecrire(tva.traduction, gauche, pied, { taille: 8.5, pale: true });
  pied = ecrire(t("facturePdf.pied"), gauche, pied, { taille: 8, pale: true });

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
