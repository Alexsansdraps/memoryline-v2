/**
 * Types de la bibliothèque configurateur exposés par l'API et consommés par
 * le configurateur (SolidJS), le web, le back-office et le worker PDF.
 * Source de vérité unique du contrat (§18.1 / §14).
 */
import type { AssetSlot, PosterView } from "./config.js";

/** Un asset recolorable (cheveux, vêtement, accessoire…). */
export interface AssetDTO {
  id: number;
  slot: AssetSlot | string;
  name: string | null;
  /** URL absolue ou /assets/… servie par l'API. */
  svgUrl: string;
  view: PosterView | string | null;
  /** Zones de couleur par défaut : { st0: "#BA6821", … } (§18.1 D). */
  colorZones: Record<string, string> | null;
  position: number;
}

/** Un type de personnage (couple/enfant/animal…) + ses assets groupés par slot. */
export interface CharacterTypeDTO {
  id: number;
  slug: string;
  name: string;
  category: string | null;
  position: number;
  archived: boolean;
  /** Assets disponibles, regroupés par slot pour l'UI. */
  assetsBySlot: Partial<Record<string, AssetDTO[]>>;
}

/** Fond sélectionnable dans le configurateur. */
export interface BackgroundDTO {
  id: number;
  url: string;
  name: string | null;
  position: number;
}

/** Payload de création/maj d'un type de personnage (BO). */
export interface CharacterTypeInput {
  id?: number;
  slug?: string;
  name: string;
  category?: string | null;
  position?: number;
}

/** Payload de maj des couleurs d'un asset (BO, §18.1 D). */
export interface AssetColorsInput {
  assetId: number;
  /** zone -> couleur hex. Remplace color_zones. */
  colorZones: Record<string, string>;
}
