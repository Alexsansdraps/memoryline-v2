/**
 * Mesure le BAS réel du contenu de chaque personnage (character_type.baseSvgUrl)
 * dans son viewBox, et stocke le ratio dans character_type.bottom_pct (0..1).
 *
 * Pourquoi : les SVG animaux/bébés ont du vide SOUS le dessin (chat ~0.59), donc
 * avec un simple ancrage bas du cadre ils « flottent ». Ce ratio permet au rendu
 * d'aligner les pieds de TOUS les persos au sol.
 *
 * Usage : pnpm --filter @memoryline/api run measure-anchors
 */
import { eq } from "drizzle-orm";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { sql, db, schema } from "../src/db/client.js";

const ASSETS_DIR = resolve(
  fileURLToPath(import.meta.url),
  "../../../../data/assets",
);

/** Renvoie la position 0..1 du bas du contenu (1 = pixel le plus bas occupé). */
async function bottomRatio(svgUrl: string): Promise<number> {
  const file = svgUrl.replace(/^.*\/assets\//, "").split("?")[0]!;
  const buf = await readFile(resolve(ASSETS_DIR, file));
  const H = 400;
  const { data, info } = await sharp(buf, { density: 120, unlimited: true })
    .resize(200, H, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, channels } = info;
  let bottom = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + 3]! > 20) {
        if (y > bottom) bottom = y;
        break;
      }
    }
  }
  return Math.min(1, Math.max(0, bottom / H));
}

async function main() {
  const types = await db
    .select({ id: schema.characterTypes.id, base: schema.characterTypes.baseSvgUrl })
    .from(schema.characterTypes);
  let done = 0;
  for (const t of types) {
    if (!t.base) continue;
    try {
      const ratio = await bottomRatio(t.base);
      await db
        .update(schema.characterTypes)
        .set({ bottomPct: Number(ratio.toFixed(4)) })
        .where(eq(schema.characterTypes.id, t.id));
      done++;
    } catch (e) {
      console.warn("  ✗", t.base, String(e).slice(0, 60));
    }
  }
  console.log(`✓ bottom_pct mesuré pour ${done}/${types.length} personnages`);
  // Récap.
  const rows = await db
    .select({
      name: schema.characterTypes.name,
      bp: schema.characterTypes.bottomPct,
    })
    .from(schema.characterTypes)
    .orderBy(schema.characterTypes.bottomPct);
  for (const r of rows.slice(0, 8))
    console.log(`  ${r.name}: ${Math.round((r.bp ?? 1) * 100)}%`);
  await sql.end();
}

main().catch(async (e) => {
  console.error("✗ Mesure échouée :", e);
  await sql.end();
  process.exit(1);
});
