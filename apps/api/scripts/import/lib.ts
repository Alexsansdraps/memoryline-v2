import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import type { PosterConfig } from "@memoryline/types";

// racine du repo = apps/api/scripts/import/lib.ts -> remonter 4 niveaux
const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../../../../..");

const RAW_IMPORT_DIR =
  process.env.IMPORT_DIR ?? "./data/exports/shopify-2026-06-19";

/** Répertoire d'import résolu en absolu depuis la racine du repo. */
export const IMPORT_DIR = isAbsolute(RAW_IMPORT_DIR)
  ? RAW_IMPORT_DIR
  : resolve(REPO_ROOT, RAW_IMPORT_DIR);

/** Lit un CSV Shopify en tableau d'objets (clé = en-tête). */
export function readCsv(filename: string): Record<string, string>[] {
  const path = join(IMPORT_DIR, filename);
  const raw = readFileSync(path, "utf8");
  return parse(raw, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  });
}

/** Regroupe les lignes d'un export Shopify par enregistrement (Top Row). */
export function groupByTopRow(
  rows: Record<string, string>[],
): Record<string, string>[][] {
  const groups: Record<string, string>[][] = [];
  for (const row of rows) {
    const isTop = (row["Top Row"] ?? "").trim() === "true";
    if (isTop || groups.length === 0) groups.push([]);
    groups[groups.length - 1]!.push(row);
  }
  return groups;
}

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "23.00" -> 2300 (centimes). Vide/invalide -> 0. */
export function toCents(price: string | undefined): number {
  if (!price) return 0;
  const n = Number.parseFloat(price.trim());
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function toInt(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number.parseInt(v.trim(), 10);
  return Number.isFinite(n) ? n : null;
}

/** "A4 (21 x 29.7 cm)" -> { format:'A4', w:210, h:297 }. */
export function parseFormat(option: string): {
  format: string;
  widthMm: number | null;
  heightMm: number | null;
} {
  const up = option.toUpperCase();
  const format = up.includes("A3") ? "A3" : "A4";
  const dims = format === "A3" ? [297, 420] : [210, 297];
  return { format, widthMm: dims[0]!, heightMm: dims[1]! };
}

/**
 * Transforme les `Line: Properties` Shopify (legacy) en PosterConfig (§14.3).
 *
 * Le champ contient des lignes du type :
 *   product: {"text":{...},"background":"https://...","view":"back"}
 *   character_1: {"typeId":1,"id":1,"position":1,"assets":{...},"colors":{...}}
 *   character_2: {...}
 *
 * Les `:` JSON sont échappés en `\:` dans l'export → on dés-échappe avant parse.
 */
export function legacyPropertiesToConfig(
  properties: string,
): PosterConfig | null {
  if (!properties || !properties.trim()) return null;

  const unescape = (s: string) => s.replace(/\\:/g, ":").replace(/\\,/g, ",");
  const lines = properties.split(/\r?\n/);

  let product: any = null;
  const characters: any[] = [];

  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const rawVal = line.slice(idx + 1).trim();
    if (!rawVal.startsWith("{")) continue;
    let obj: any;
    try {
      obj = JSON.parse(unescape(rawVal));
    } catch {
      continue; // ligne non-JSON ou tronquée -> on ignore (best effort)
    }
    if (key === "product") {
      product = obj;
    } else if (/^character_\d+$/.test(key)) {
      characters.push(obj);
    }
  }

  if (!product && characters.length === 0) return null;

  const text = product?.text ?? {};
  const view = (product?.view ?? text?.view ?? "front") === "back" ? "back" : "front";

  return {
    schemaVersion: 1,
    backgroundUrl: product?.background ?? undefined,
    view,
    texts: {
      title: text?.title
        ? { value: String(text.title), color: text.color }
        : undefined,
      subtitle: text?.subtitle
        ? { value: String(text.subtitle), color: text.color }
        : undefined,
    },
    characters: characters.map((c, i) => ({
      typeId: c.typeId ?? c.id ?? i,
      position: typeof c.position === "number" ? c.position : i,
      assets: c.assets ?? {},
      colors: c.colors ?? undefined,
    })),
  };
}

export interface ImportReport {
  [entity: string]: { created: number; skipped: number; errors: number };
}

export function bump(
  report: ImportReport,
  entity: string,
  field: "created" | "skipped" | "errors",
  n = 1,
) {
  report[entity] ??= { created: 0, skipped: 0, errors: 0 };
  report[entity][field] += n;
}
