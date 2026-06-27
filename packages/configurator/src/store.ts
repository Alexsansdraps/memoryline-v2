/// <reference lib="dom" />
import { createStore, produce, type SetStoreFunction } from "solid-js/store";
import { createSignal, type Accessor, type Setter } from "solid-js";
import type {
  PosterConfig,
  Character,
  PosterFormat,
  AssetDTO,
  CharacterTypeDTO,
} from "@memoryline/types";
import { recolorSvg } from "@memoryline/types";

/** Étapes du flow configurateur (§18.2 F). */
export const STEPS = ["background", "characters", "format"] as const;
export type Step = (typeof STEPS)[number];

/** Personnage de travail : on garantit x/y/scale/position définis pour l'UI. */
export interface WorkingCharacter {
  typeId: string | number;
  position: number;
  x: number;
  y: number;
  scale: number;
  /** slot -> assetId */
  assets: Record<string, string | number>;
  /** zone -> hex */
  colors: Record<string, string>;
}

export interface ConfiguratorState {
  step: Step;
  backgroundId: string | number | undefined;
  backgroundUrl: string | undefined;
  format: PosterFormat;
  title: { value: string; font: string; color: string };
  subtitle: { value: string; font: string; color: string };
  characters: WorkingCharacter[];
  /** index du personnage en cours d'édition, sinon null. */
  editingIndex: number | null;
}

const DEFAULT_TEXT_COLOR = "#222222";
const DEFAULT_FONT = "sans-serif";

function emptyState(): ConfiguratorState {
  return {
    step: "background",
    backgroundId: undefined,
    backgroundUrl: undefined,
    format: "A4",
    title: { value: "", font: DEFAULT_FONT, color: DEFAULT_TEXT_COLOR },
    subtitle: { value: "", font: DEFAULT_FONT, color: DEFAULT_TEXT_COLOR },
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
  if (cfg.texts.title) {
    base.title = {
      value: cfg.texts.title.value,
      font: cfg.texts.title.font ?? DEFAULT_FONT,
      color: cfg.texts.title.color ?? DEFAULT_TEXT_COLOR,
    };
  }
  if (cfg.texts.subtitle) {
    base.subtitle = {
      value: cfg.texts.subtitle.value,
      font: cfg.texts.subtitle.font ?? DEFAULT_FONT,
      color: cfg.texts.subtitle.color ?? DEFAULT_TEXT_COLOR,
    };
  }
  base.characters = cfg.characters.map((c, i) => ({
    typeId: c.typeId,
    position: c.position ?? i,
    x: c.x ?? 0.5,
    y: c.y ?? 0.5,
    scale: c.scale ?? 1,
    assets: { ...c.assets },
    colors: { ...(c.colors ?? {}) },
  }));
  return base;
}

/**
 * Placement automatique des personnages (le client ne positionne plus à la
 * main §18.2 F). Les persos sont centrés, côte à côte, le long du bas-milieu
 * de l'affiche. x réparti uniformément, y et scale fixes et déterministes.
 * On respecte l'ordre du tableau (= z-order géré par la liste).
 */
export function autoPlace(
  characters: WorkingCharacter[],
): { x: number; y: number; scale: number }[] {
  const n = characters.length;
  const Y = 0.62;
  const SCALE = 1;
  if (n === 0) return [];
  // Réparti uniformément sur la largeur : centres aux fractions (i+1)/(n+1).
  return characters.map((_, i) => ({
    x: (i + 1) / (n + 1),
    y: Y,
    scale: SCALE,
  }));
}

/** Sérialise l'état de travail vers un PosterConfig propre (schemaVersion 1). */
export function configFromState(
  state: ConfiguratorState,
  productId: string | number | undefined,
): PosterConfig {
  const placement = autoPlace(state.characters);
  const characters: Character[] = state.characters.map((c, i) => {
    const p = placement[i] ?? { x: c.x, y: c.y, scale: c.scale };
    return {
      typeId: c.typeId,
      position: c.position,
      x: p.x,
      y: p.y,
      scale: p.scale,
      assets: { ...c.assets },
      colors: { ...c.colors },
    };
  });
  return {
    schemaVersion: 1,
    productId,
    backgroundId: state.backgroundId,
    backgroundUrl: state.backgroundUrl,
    format: state.format,
    view: "front",
    texts: {
      title: state.title.value
        ? {
            value: state.title.value,
            font: state.title.font,
            color: state.title.color,
          }
        : undefined,
      subtitle: state.subtitle.value
        ? {
            value: state.subtitle.value,
            font: state.subtitle.font,
            color: state.subtitle.color,
          }
        : undefined,
    },
    characters,
  };
}

/** Slots dans l'ordre d'empilement bas -> haut (z-order interne au perso). */
export const SLOT_ZORDER = [
  "clothes",
  "pants",
  "shoes",
  "hair",
  "head",
  "accessory",
] as const;

/** Trouve un asset par id dans un type de personnage. */
export function findAsset(
  type: CharacterTypeDTO,
  slot: string,
  assetId: string | number | undefined,
): AssetDTO | undefined {
  if (assetId === undefined) return undefined;
  const list = type.assetsBySlot[slot];
  if (!list) return undefined;
  return list.find((a) => String(a.id) === String(assetId));
}

/** Crée un personnage par défaut pour un type (1er asset de chaque slot). */
export function defaultCharacterForType(
  type: CharacterTypeDTO,
  position: number,
): WorkingCharacter {
  const assets: Record<string, string | number> = {};
  const colors: Record<string, string> = {};
  for (const slot of SLOT_ZORDER) {
    const list = type.assetsBySlot[slot];
    const first = list && list[0];
    if (first) {
      assets[slot] = first.id;
      for (const [zone, hex] of Object.entries(first.colorZones ?? {})) {
        colors[zone] = hex;
      }
    }
  }
  return {
    typeId: type.id,
    position,
    x: 0.5,
    y: 0.55,
    scale: 1,
    assets,
    colors,
  };
}

/* -------------------------------------------------------------------------- */
/*  Cache de SVG bruts + cache de SVG recoloriés                              */
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
/*  Palettes de couleurs prédéfinies (miroir des maquettes client)            */
/* -------------------------------------------------------------------------- */

/** Teintes de peau (zone visage/peau). */
export const SKIN_TONES = [
  "#F8D9B5",
  "#F0C49A",
  "#E0AC7E",
  "#C68A5E",
  "#8D5A3C",
  "#5C3A24",
] as const;

/** Palette générale (vêtements / pantalon / accessoire). */
export const GENERAL_PALETTE = [
  "#FFFFFF",
  "#E9446A",
  "#9BD3AE",
  "#BFE3C8",
  "#C0392B",
  "#2453B8",
  "#B5703C",
  "#111111",
] as const;

/** Teintes de cheveux. */
export const HAIR_TONES = [
  "#E8E2D5",
  "#E8CE8B",
  "#D8A93C",
  "#A8602F",
  "#C9A07A",
  "#6B4226",
  "#3A2418",
  "#15110D",
] as const;

/** Palette de presets pour un slot donné. */
export function presetPaletteForSlot(slot: string): readonly string[] {
  if (slot === "hair") return HAIR_TONES;
  if (slot === "head") return SKIN_TONES;
  return GENERAL_PALETTE;
}

/** Recolorie un SVG brut avec les couleurs d'un perso (sous-ensemble des zones). */
export function recolorForCharacter(
  rawSvg: string,
  colors: Record<string, string>,
): string {
  if (!rawSvg) return rawSvg;
  return recolorSvg(rawSvg, colors);
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
  const mutate = (fn: (s: ConfiguratorState) => void) =>
    setState(produce(fn));
  return { state, setState, mutate };
}

export { emptyState };
