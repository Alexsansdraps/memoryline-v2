import { db, schema } from "../../src/db/client.js";
import { readCsv, bump, type ImportReport } from "./lib.js";

/**
 * Importe la bibliothèque d'assets du configurateur depuis Files.csv.
 *
 * Heuristique de classement par nom de fichier :
 *   *_affiche_person*.svg            -> fond d'affiche (background, non rattaché ici)
 *   Hair*, *_Hair*                   -> slot 'hair'
 *   Clothes*, *_Clothes*             -> slot 'clothes'
 *   Pants*, *_Pants*                 -> slot 'pants'
 *   Head*, Shoes*, Accessor*, Glass* -> slots correspondants
 *
 * ⚠️ Le mapping ID numérique (properties: "hair":13) -> fichier SVG précis
 * n'est PAS déductible de façon fiable depuis l'export seul (suffixes UUID,
 * pas de table d'index). On importe donc l'inventaire brut des assets ; le
 * rattachement fin ID->SVG sera fait quand la cliente fournira l'index du
 * configurateur (ou par rétro-ingénierie de l'app Shopify). Voir rapport.
 */
const SLOT_RULES: { test: RegExp; slot: string }[] = [
  { test: /hair/i, slot: "hair" },
  { test: /clothes/i, slot: "clothes" },
  { test: /pants/i, slot: "pants" },
  { test: /shoes/i, slot: "shoes" },
  { test: /glass/i, slot: "accessory" },
  { test: /accessor/i, slot: "accessory" },
  { test: /head|face/i, slot: "head" },
];

export async function importAssets(report: ImportReport) {
  await db.delete(schema.assets);
  // backgrounds liés produits : importés ici depuis les SVG de fond
  // (on ne touche pas à ceux éventuellement créés ailleurs)

  const rows = readCsv("Files.csv");
  let bgPos = 0;
  for (const r of rows) {
    const filename = (r["File Name"] ?? "").trim();
    const link = (r["Link"] ?? "").trim();
    const url = link || filename;
    if (!url) {
      bump(report, "asset", "skipped");
      continue;
    }
    const low = filename.toLowerCase();
    const isSvg = low.endsWith(".svg");

    // Fonds d'affiche : "<ville>_affiche_person*.svg"
    if (isSvg && /affiche[_-]?person/i.test(low)) {
      await db.insert(schema.backgrounds).values({
        productId: null,
        url,
        name: filename.replace(/\.svg$/i, ""),
        position: bgPos++,
      });
      bump(report, "background", "created");
      continue;
    }

    // Assets de personnage (slots)
    const rule = SLOT_RULES.find((s) => s.test.test(low));
    if (isSvg && rule) {
      await db.insert(schema.assets).values({
        characterTypeId: null,
        slot: rule.slot,
        name: filename.replace(/\.svg$/i, ""),
        svgUrl: url,
        view: null,
        position: 0,
      });
      bump(report, "asset", "created");
      continue;
    }

    bump(report, "asset", "skipped");
  }
}
