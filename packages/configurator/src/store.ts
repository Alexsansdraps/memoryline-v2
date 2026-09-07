/// <reference lib="dom" />
import { createStore, produce, type SetStoreFunction } from "solid-js/store";
import { createSignal, type Accessor, type Setter } from "solid-js";
import type {
  PosterConfig,
  Character,
  PosterFormat,
  PosterView,
} from "@memoryline/types";
import {
  recolorSvg,
  POLICE_TITRE_DEFAUT,
  POLICE_SOUSTITRE_DEFAUT,
} from "@memoryline/types";

/** Étapes du flow configurateur (§18.2 F). */
export const STEPS = ["background", "characters", "format"] as const;
export type Step = (typeof STEPS)[number];

/* -------------------------------------------------------------------------- */
/*  Nouveau contrat API (GET /characters)                                      */
/* -------------------------------------------------------------------------- */

/** Slots de variantes génériques, partagés par tous les personnages humains. */
export const SLOTS = ["clothes", "pants", "hair", "accessory"] as const;
export type Slot = (typeof SLOTS)[number];

/**
 * Valeur sentinelle d'un slot : « aucun » EXPLICITE. À distinguer de
 * `undefined` (= on garde la couche pré-composée dans le SVG de base) :
 * "none" MASQUE aussi la couche de la base (perso sans casquette, sans
 * coupe…). Sérialisée telle quelle dans PosterConfig.assets, comprise par le
 * rendu front (CharacterStack) ET serveur (pdf.ts).
 */
export const NONE_ASSET = "none" as const;

/**
 * Une variante de slot (vêtement, pantalon, coupe, accessoire). SVG déjà
 * positionné dans le cadre 500×1000 — il se superpose tel quel à la base.
 */
export interface VariantDTO {
  id: number | string;
  slot: Slot | string;
  name: string | null;
  /** URL absolue ou /assets/… servie par l'API. */
  svgUrl: string;
  view: PosterView | string | null;
  /** Zones de couleur par défaut : { st0: "#hex", … } ou null. */
  colorZones: Record<string, string> | null;
  position: number;
}

/** Un personnage = SVG de base pré-composé + ses zones de couleur par défaut. */
export interface CharacterDTO {
  id: number | string;
  slug: string;
  name: string;
  category: string | null;
  position: number;
  archived: boolean;
  /** SVG complet pré-composé (viewBox 0 0 500 1000). */
  baseSvgUrl: string;
  /** Zones de couleur par défaut de la base : { stN: "#hex" }. */
  baseColorZones: Record<string, string> | null;
  /** Orientation native du perso : 'front' (face) ou 'back' (dos). */
  orientation?: "front" | "back";
  /** Bas réel du contenu dans le viewBox (0..1) pour aligner les pieds au sol. */
  bottomPct?: number;
  /**
   * Variantes AUTORISÉES pour ce perso, par slot, dans l'ordre d'affichage.
   * Les nombres = `position` des VariantDTO (ids d'ancienne config), pas
   * leurs ids. null/absent = pas encore lié -> proposer toutes les variantes.
   */
  slotVariants?: Partial<Record<Slot, number[]>> | null;
}

/**
 * Restreint un jeu de variantes à celles AUTORISÉES pour un perso (matching
 * par `position`, dans l'ordre du perso). Sans liste (donnée non liée), on
 * retombe sur le jeu complet ; une liste VIDE = slot sans variante (animaux).
 */
export function slotsForCharacter(
  all: SlotVariants,
  base: CharacterDTO | undefined,
): SlotVariants {
  const allowed = base?.slotVariants;
  if (!allowed) return all;
  const pick = (slot: Slot): VariantDTO[] => {
    const ids = allowed[slot];
    if (!ids) return [];
    return ids
      .map((pos) => all[slot].find((v) => v.position === pos))
      .filter((v): v is VariantDTO => v !== undefined);
  };
  return {
    clothes: pick("clothes"),
    pants: pick("pants"),
    hair: pick("hair"),
    accessory: pick("accessory"),
  };
}

/** Variantes par slot, pour une vue donnée. */
export interface SlotVariants {
  clothes: VariantDTO[];
  pants: VariantDTO[];
  hair: VariantDTO[];
  accessory: VariantDTO[];
}

/** Bibliothèque de variantes : un jeu par vue (front / back). */
export interface SlotsDTO {
  front: SlotVariants;
  back: SlotVariants;
}

/* -------------------------------------------------------------------------- */
/*  État de travail                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Personnage de travail.
 * - `characterId` = type de personnage choisi (sa base + ses baseColorZones).
 * - `assets` = variantes choisies par slot (id), optionnelles : absent = la
 *   couche intégrée à la base est conservée ; NONE_ASSET ("none") = « aucun »
 *   explicite, la couche de la base est MASQUÉE (sans casquette, sans coupe…).
 * - `colors` = clé namespacée "scope:zone" -> hex (override des couleurs par
 *   défaut). Le scope = "base" (SVG de base) ou le slot ("clothes:st0"…) : les
 *   zones stN étant réutilisées d'une couche à l'autre, le namespacing évite
 *   qu'une couleur choisie pour un slot déteigne sur les autres (cf.
 *   colorsForScope). Les clés plates "stN" (anciens paniers) restent acceptées
 *   et s'appliquent à toutes les couches.
 * - x/y/scale/position = placement automatique sur l'affiche.
 */
export interface WorkingCharacter {
  characterId: string | number;
  position: number;
  x: number;
  y: number;
  scale: number;
  /** slot -> variantId (optionnel). */
  assets: Partial<Record<Slot, string | number>>;
  /** "scope:zone" -> hex (scope = "base" | slot ; clés plates legacy tolérées). */
  colors: Record<string, string>;
}

export interface ConfiguratorState {
  step: Step;
  backgroundId: string | number | undefined;
  backgroundUrl: string | undefined;
  format: PosterFormat;
  view: PosterView;
  /** Texte ET police, choisis séparément pour le titre et le sous-titre. */
  title: { value: string; font: string };
  subtitle: { value: string; font: string };
  /** Style PARTAGÉ : la couleur et la taille valent pour les deux. */
  textStyle: { font: string; color: string; size: number };
  characters: WorkingCharacter[];
  /** index du personnage en cours d'édition, sinon null. */
  editingIndex: number | null;
}

const DEFAULT_TEXT_COLOR = "#FFFFFF"; // blanc par défaut (charte affiches)
const DEFAULT_FONT = "sans-serif";
/** Polices par défaut de la charte : titre en serif, sous-titre manuscrit. */
const DEFAUT_POLICE_TITRE = POLICE_TITRE_DEFAUT;
const DEFAUT_POLICE_SOUSTITRE = POLICE_SOUSTITRE_DEFAUT;
/** Taille de texte = facteur relatif (1 = défaut). Appliqué au titre et sous-titre. */
const DEFAULT_TEXT_SIZE = 1;

function emptyState(): ConfiguratorState {
  return {
    step: "background",
    backgroundId: undefined,
    backgroundUrl: undefined,
    format: "A4",
    view: "front",
    title: { value: "", font: DEFAUT_POLICE_TITRE },
    subtitle: { value: "", font: DEFAUT_POLICE_SOUSTITRE },
    textStyle: {
      font: DEFAULT_FONT,
      color: DEFAULT_TEXT_COLOR,
      size: DEFAULT_TEXT_SIZE,
    },
    characters: [],
    editingIndex: null,
  };
}

/** Construit l'état de travail depuis un PosterConfig (réouverture panier §18.3). */
export function stateFromConfig(cfg: PosterConfig): ConfiguratorState {
  const base = emptyState();
  base.backgroundId = cfg.backgroundId;
  base.backgroundUrl = cfg.backgroundUrl;
  base.format = cfg.format ?? "A4";
  base.view = cfg.view ?? "front";
  if (cfg.texts.title)
    base.title = {
      value: cfg.texts.title.value,
      font: cfg.texts.title.font ?? DEFAUT_POLICE_TITRE,
    };
  if (cfg.texts.subtitle)
    base.subtitle = {
      value: cfg.texts.subtitle.value,
      font: cfg.texts.subtitle.font ?? DEFAUT_POLICE_SOUSTITRE,
    };
  // Style partagé : repris du titre en priorité, sinon du sous-titre.
  const src = cfg.texts.title ?? cfg.texts.subtitle;
  base.textStyle = {
    font: src?.font ?? DEFAULT_FONT,
    color: src?.color ?? DEFAULT_TEXT_COLOR,
    size: (src as { size?: number })?.size ?? DEFAULT_TEXT_SIZE,
  };
  base.characters = cfg.characters.map((c, i) => {
    const assets: Partial<Record<Slot, string | number>> = {};
    for (const slot of SLOTS) {
      const v = c.assets[slot];
      if (v !== undefined) assets[slot] = v;
    }
    return {
      characterId: c.typeId,
      position: c.position ?? i,
      x: c.x ?? 0.5,
      y: c.y ?? 0.5,
      scale: c.scale ?? 1,
      assets,
      colors: { ...(c.colors ?? {}) },
    };
  });
  return base;
}

/**
 * Largeur de référence d'un personnage (à scale=1) en fraction de la largeur
 * de l'affiche. Utilisée par autoPlace ET par le rendu (PosterPreview/PDF).
 */
export const CHAR_BASE_WIDTH = 0.22;

/**
 * Placement automatique des personnages : une seule RANGÉE, alignée vers le
 * BAS de l'affiche, centrée en groupe et recentrée à chaque ajout.
 * Les persos rétrécissent quand ils sont nombreux pour tenir côte à côte sans
 * déborder, et sont espacés régulièrement autour du centre (x=0.5).
 * Le client ne positionne plus à la main (§18.2 F).
 */
export function autoPlace(
  characters: WorkingCharacter[],
): { x: number; y: number; scale: number }[] {
  const n = characters.length;
  if (n === 0) return [];

  // NB : ce calage suppose bottom_pct MESURÉ en base (pnpm run measure-anchors) —
  // sans ça les persos flottent (vide sous les pieds non compensé).
  // 0.825 = calage visuel Alexandra 2026-07-07 ; -0.009 le 2026-07-11 pour
  // compenser la correction du drop (facteur √2 oublié) sans bouger les
  // humains (bp≈0.86) déjà calés — seuls les persos à fort vide (animaux)
  // descendent maintenant jusqu'au muret.
  const Y = 0.816; // posés sur le muret
  // Échelle : persos plus petits ; rétrécit avec le nombre pour tenir côte à
  // côte sans déborder (rangée dans ~90% de la largeur).
  const usable = 0.9;
  const scale = Math.min(0.7, usable / (n * CHAR_BASE_WIDTH));
  const slotW = CHAR_BASE_WIDTH * scale; // largeur effective d'un perso
  // Resserrement : distance entre centres < largeur d'un perso (les cadres se
  // chevauchent légèrement, les dessins ont de la marge). 1 = côte à côte.
  const GAP = 0.8;
  const stepW = slotW * GAP; // distance entre centres de persos voisins
  const rowW = slotW + stepW * (n - 1); // largeur totale de la rangée
  const start = 0.5 - rowW / 2; // bord gauche pour centrer le groupe

  // PENTE DU MURET : il descend de gauche à droite (~+9% de bas en haut sur
  // toute la largeur). Chaque perso suit cette pente -> y augmente avec x pour
  // que les pieds restent sur le bord incliné (gauche plus haut, droite plus bas).
  const SLOPE = 0.09; // dénivelé total sur la largeur de l'affiche

  return characters.map((_, i) => {
    const x = start + slotW / 2 + stepW * i; // centre du i-ème perso (0..1)
    // décalage selon la position : centré sur 0.5 -> +/- la moitié de la pente.
    const slopeY = (x - 0.5) * SLOPE;
    return { x, y: Y + slopeY, scale };
  });
}

/** Sérialise l'état de travail vers un PosterConfig propre (schemaVersion 1). */
export function configFromState(
  state: ConfiguratorState,
  productId: string | number | undefined,
): PosterConfig {
  const placement = autoPlace(state.characters);
  const characters: Character[] = state.characters.map((c, i) => {
    const p = placement[i] ?? { x: c.x, y: c.y, scale: c.scale };
    // assets : slot -> variantId, sans les slots vides.
    const assets: Record<string, string | number> = {};
    for (const slot of SLOTS) {
      const v = c.assets[slot];
      if (v !== undefined) assets[slot] = v;
    }
    return {
      typeId: c.characterId,
      position: c.position,
      x: p.x,
      y: p.y,
      scale: p.scale,
      assets,
      colors: { ...c.colors },
    };
  });
  return {
    schemaVersion: 1,
    productId,
    backgroundId: state.backgroundId,
    backgroundUrl: state.backgroundUrl,
    format: state.format,
    view: state.view,
    texts: {
      // La POLICE est propre à chaque bloc ; couleur et taille restent
      // communes (charte : un seul coloris de texte sur l'affiche).
      title: state.title.value
        ? {
            value: state.title.value,
            font: state.title.font,
            color: state.textStyle.color,
            size: state.textStyle.size,
          }
        : undefined,
      subtitle: state.subtitle.value
        ? {
            value: state.subtitle.value,
            font: state.subtitle.font,
            color: state.textStyle.color,
            size: state.textStyle.size,
          }
        : undefined,
    },
    characters,
  };
}

/** Slots dans l'ordre d'empilement bas -> haut (par-dessus la base). */
export const SLOT_ZORDER = ["pants", "clothes", "hair", "accessory"] as const;

/** Trouve une variante par id dans la liste d'un slot. */
export function findVariant(
  variants: VariantDTO[] | undefined,
  variantId: string | number | undefined,
): VariantDTO | undefined {
  if (variantId === undefined || !variants) return undefined;
  return variants.find((v) => String(v.id) === String(variantId));
}

/**
 * Crée un personnage par défaut pour une base. `colors` reste VIDE : le SVG de
 * base a déjà ses bonnes couleurs intégrées (peau, tenue). On ne ré-applique pas
 * baseColorZones — sinon les zones .stN, qui n'ont pas la même sémantique entre
 * la base et les variantes de slots, se mélangent (peau qui devient bleue, etc.).
 * Les couleurs ne sont surchargées que si le client en change explicitement.
 */
export function defaultCharacter(
  character: CharacterDTO,
  position: number,
): WorkingCharacter {
  return {
    characterId: character.id,
    position,
    x: 0.5,
    y: 0.55,
    scale: 1,
    assets: {},
    colors: {},
  };
}

/* -------------------------------------------------------------------------- */
/*  Cache de SVG bruts                                                         */
/* -------------------------------------------------------------------------- */

export interface SvgCache {
  raw: Record<string, string | undefined>;
  setRaw: SetStoreFunction<Record<string, string | undefined>>;
  loading: Accessor<Set<string>>;
  setLoading: Setter<Set<string>>;
}

export function createSvgCache(assetBaseUrl: string): {
  cache: SvgCache;
  /** Récupère (et met en cache) le SVG brut d'un asset. */
  fetchSvg: (svgUrl: string) => Promise<void>;
} {
  const [raw, setRaw] = createStore<Record<string, string | undefined>>({});
  const [loading, setLoading] = createSignal<Set<string>>(new Set());

  async function fetchSvg(svgUrl: string): Promise<void> {
    if (raw[svgUrl] !== undefined) return;
    if (loading().has(svgUrl)) return;
    setLoading((s) => new Set(s).add(svgUrl));
    try {
      const url = svgUrl.startsWith("http")
        ? svgUrl
        : assetBaseUrl.replace(/\/$/, "") + svgUrl;
      const res = await fetch(url);
      const text = await res.text();
      setRaw(svgUrl, text);
    } catch {
      setRaw(svgUrl, "");
    } finally {
      setLoading((s) => {
        const n = new Set(s);
        n.delete(svgUrl);
        return n;
      });
    }
  }

  return { cache: { raw, setRaw, loading, setLoading }, fetchSvg };
}

/* -------------------------------------------------------------------------- */
/*  Palettes de couleurs prédéfinies (miroir des nuanciers memoryline.fr)      */
/* -------------------------------------------------------------------------- */

function rgb(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Teintes de peau (base / personnage). */
export const SKIN_TONES = [
  rgb(255, 238, 224),
  rgb(255, 226, 192),
  rgb(246, 210, 169),
  rgb(225, 180, 128),
  rgb(184, 138, 108),
  rgb(139, 91, 56),
] as const;

/** Nuancier vêtements. */
export const CLOTHES_TONES = [
  rgb(250, 250, 250),
  rgb(255, 150, 191),
  rgb(158, 223, 191),
  rgb(200, 228, 214),
  rgb(189, 18, 18),
  rgb(0, 86, 175),
  rgb(184, 85, 29),
  rgb(0, 0, 0),
] as const;

/** Nuancier pantalon. */
export const PANTS_TONES = [
  rgb(237, 215, 198),
  rgb(184, 85, 29),
  rgb(94, 154, 191),
  rgb(22, 81, 118),
  rgb(84, 84, 84),
  rgb(0, 0, 0),
] as const;

/** Nuancier cheveux. */
export const HAIR_TONES = [
  rgb(232, 232, 232),
  rgb(241, 203, 158),
  rgb(231, 176, 51),
  rgb(184, 85, 29),
  rgb(214, 182, 149),
  rgb(191, 129, 88),
  rgb(107, 62, 30),
  rgb(84, 21, 7),
  rgb(36, 34, 44),
] as const;

/** Palette de presets pour un slot donné. */
export function presetPaletteForSlot(slot: Slot | string): readonly string[] {
  if (slot === "hair") return HAIR_TONES;
  if (slot === "pants") return PANTS_TONES;
  return CLOTHES_TONES;
}

/**
 * ViewBox zoomé pour les vignettes de slot (cadrage sur la partie).
 * Défini dans @memoryline/types et ré-exporté ici : le back-office s'en sert
 * aussi, les deux cadrages doivent rester identiques.
 */
export { SLOT_THUMB_VIEWBOX } from "@memoryline/types";

/** Recolorie un SVG brut avec les couleurs d'un perso (sous-ensemble des zones). */
export function recolorForCharacter(
  rawSvg: string,
  colors: Record<string, string>,
): string {
  if (!rawSvg) return rawSvg;
  return recolorSvg(rawSvg, colors);
}

/**
 * Réécrit/injecte l'attribut viewBox sur la balise <svg> racine d'un SVG brut.
 * Sert au cadrage zoomé des vignettes de slot.
 */
export function withViewBox(rawSvg: string, viewBox: string): string {
  if (!rawSvg) return rawSvg;
  // <svg ... viewBox="..."> -> remplace
  if (/<svg[^>]*\sviewBox\s*=/.test(rawSvg)) {
    return rawSvg.replace(
      /(<svg[^>]*?\sviewBox\s*=\s*")[^"]*(")/,
      `$1${viewBox}$2`,
    );
  }
  // sinon, injecte juste après <svg
  return rawSvg.replace(/<svg\b/, `<svg viewBox="${viewBox}"`);
}

/* -------------------------------------------------------------------------- */
/*  Store principal                                                           */
/* -------------------------------------------------------------------------- */

export function createConfiguratorStore(initial: ConfiguratorState): {
  state: ConfiguratorState;
  setState: SetStoreFunction<ConfiguratorState>;
  mutate: (fn: (s: ConfiguratorState) => void) => void;
} {
  const [state, setState] = createStore<ConfiguratorState>(initial);
  const mutate = (fn: (s: ConfiguratorState) => void) => setState(produce(fn));
  return { state, setState, mutate };
}

export { emptyState };
