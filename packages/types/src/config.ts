import { z } from "zod";

/**
 * Snapshot sérialisable de la personnalisation d'une affiche.
 * = `order_item.config` (§14.3 / §16 du PLAN_DE_DEV).
 *
 * Ce schéma est la cible "propre". L'historique Shopify (Line: Properties)
 * utilise une forme proche mais différente (clés `character_1`, `typeId`,
 * `assets.{clothes,pants,hair,head}`, couleurs en `colors.{skin,hair,...}`) ;
 * le script d'import transforme l'ancien format vers celui-ci.
 */

export const POSTER_FORMATS = ["A4", "A3"] as const;
export type PosterFormat = (typeof POSTER_FORMATS)[number];

/** Vue de l'affiche : personnages de face ou de dos (cf. collections du site). */
export const POSTER_VIEWS = ["front", "back"] as const;
export type PosterView = (typeof POSTER_VIEWS)[number];

/** Slots d'assets empilables sur un personnage (ouvert, pas figé). */
export const ASSET_SLOTS = [
  "head",
  "hair",
  "clothes",
  "pants",
  "shoes",
  "accessory",
] as const;
export type AssetSlot = (typeof ASSET_SLOTS)[number];

/**
 * Cadrage des VIGNETTES de pièces, exprimé dans le repère du personnage
 * (viewBox 500×1000). Une coupe de cheveux ou un accessoire n'occupe qu'une
 * petite zone de ce cadre : affichée en entier, la pièce apparaît minuscule
 * dans un coin. On recadre donc sur sa zone utile.
 *
 * Défini ici, dans les types partagés, pour que le configurateur ET le
 * back-office cadrent les vignettes de la même façon.
 */
export const SLOT_THUMB_VIEWBOX: Record<AssetSlot, string> = {
  head: "50 0 400 400",
  hair: "50 50 400 400",
  clothes: "-50 275 600 1000",
  pants: "50 575 400 350",
  shoes: "50 800 400 200",
  accessory: "50 0 400 400",
};

export const textBlockSchema = z.object({
  value: z.string(),
  font: z.string().optional(),
  color: z.string().optional(),
  /** Facteur de taille relatif (1 = défaut). Partagé titre/sous-titre. */
  size: z.number().optional(),
});
export type TextBlock = z.infer<typeof textBlockSchema>;

export const characterSchema = z.object({
  /** Type de personnage (couple/enfant/animal…) — référence ouverte. */
  typeId: z.union([z.string(), z.number()]),
  /** Ordre d'empilement / position dans la scène. */
  position: z.number().int().nonnegative().default(0),
  /** Positions normalisées 0..1 (indépendantes du format), optionnelles. */
  x: z.number().optional(),
  y: z.number().optional(),
  scale: z.number().optional(),
  /** Asset choisi par slot : slot -> assetId. */
  assets: z.record(z.string(), z.union([z.string(), z.number()])),
  /** Couleurs personnalisées : zone -> couleur hex. */
  colors: z.record(z.string(), z.string()).optional(),
});
export type Character = z.infer<typeof characterSchema>;

export const posterConfigSchema = z.object({
  schemaVersion: z.literal(1),
  productId: z.union([z.string(), z.number()]).optional(),
  backgroundId: z.union([z.string(), z.number()]).optional(),
  /** URL du fond (legacy: référence directe au SVG Shopify). */
  backgroundUrl: z.string().optional(),
  /** URL du décor d'avant-plan (muret/banc…), rendu au 1er plan. */
  foregroundUrl: z.string().optional(),
  format: z.enum(POSTER_FORMATS).optional(),
  view: z.enum(POSTER_VIEWS).default("front"),
  texts: z.object({
    title: textBlockSchema.optional(),
    subtitle: textBlockSchema.optional(),
  }),
  characters: z.array(characterSchema).default([]),
});
export type PosterConfig = z.infer<typeof posterConfigSchema>;

export const CURRENT_CONFIG_VERSION = 1 as const;
