/**
 * Seed de la bibliothèque personnages du configurateur (§18.1).
 *
 * Les assets sont déjà en base (import Files.csv) mais "en vrac" : sans
 * character_type, sans color_zones, sans catégorie. Ce script, IDEMPOTENT :
 *
 *  1. Extrait les ZONES DE COULEUR de chaque SVG (classes `.stN{fill:#…}`)
 *     → asset.color_zones = { st0: "#BA6821", st1: "#206FE2", … }  (§18.1 D)
 *     C'est ce qui rend les couleurs éditables sans coder, accessoires inclus.
 *
 *  2. Déduit des CATÉGORIES depuis les noms (Baby_* → Bébés, sinon Adultes)
 *     et crée des character_type rattachant des assets cohérents (§18.1 E).
 *     La cliente réorganise ensuite librement dans le back-office.
 *
 * Usage : pnpm --filter @memoryline/api run seed-characters
 */
import { isNull, eq } from "drizzle-orm";
// `sql` du client est utilisé seulement pour fermer la connexion (sql.end()).
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { sql, db, schema } from "../src/db/client.js";

const ASSETS_DIR = resolve(
  fileURLToPath(import.meta.url),
  "../../../../data/assets",
);

/** Lit un SVG et renvoie la map { classe -> couleur hex } de ses zones .stN. */
async function extractColorZones(
  svgUrl: string,
): Promise<Record<string, string>> {
  const file = svgUrl.replace(/^.*\/assets\//, "");
  const zones: Record<string, string> = {};
  try {
    const svg = await readFile(resolve(ASSETS_DIR, file), "utf8");
    // .st0{fill:#BA6821;}  (tolère espaces, casse, point-virgule optionnel)
    const re = /\.(st\d+)\s*\{\s*fill\s*:\s*(#[0-9a-fA-F]{3,8})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(svg)) !== null) {
      zones[m[1]!] = m[2]!.toUpperCase();
    }
  } catch {
    // SVG illisible → pas de zone (asset non recolorable, c'est OK)
  }
  return zones;
}

/** Catégorie + slug de type déduits du nom d'asset. */
function classify(name: string): { category: string; typeName: string } {
  const n = name.toLowerCase();
  if (/baby|bebe|bébé/.test(n)) return { category: "Bébés", typeName: "Bébé" };
  if (/kid|child|enfant/.test(n))
    return { category: "Enfants", typeName: "Enfant" };
  if (/dog|cat|animal|chien|chat|pet/.test(n))
    return { category: "Animaux", typeName: "Animal" };
  if (/male_/.test(n) || /^male/.test(n))
    return { category: "Adultes", typeName: "Homme" };
  return { category: "Adultes", typeName: "Adulte" };
}

async function upsertType(
  slug: string,
  name: string,
  category: string,
  position: number,
): Promise<number> {
  const existing = await db
    .select({ id: schema.characterTypes.id })
    .from(schema.characterTypes)
    .where(eq(schema.characterTypes.slug, slug));
  if (existing[0]) {
    await db
      .update(schema.characterTypes)
      .set({ name, category, position })
      .where(eq(schema.characterTypes.id, existing[0].id));
    return existing[0].id;
  }
  const [row] = await db
    .insert(schema.characterTypes)
    .values({ slug, name, category, position })
    .returning({ id: schema.characterTypes.id });
  return row!.id;
}

async function main() {
  const assets = await db.select().from(schema.assets);
  console.log(`→ ${assets.length} assets à traiter`);

  // 1. Color zones (toujours, même si déjà rattaché) ----------------------
  let zonesFilled = 0;
  for (const a of assets) {
    const zones = await extractColorZones(a.svgUrl);
    if (Object.keys(zones).length > 0) {
      await db
        .update(schema.assets)
        .set({ colorZones: zones })
        .where(eq(schema.assets.id, a.id));
      zonesFilled++;
    }
  }
  console.log(`✓ color_zones extraites pour ${zonesFilled}/${assets.length} assets`);

  // 2. Types + catégories --------------------------------------------------
  // Un type "Adulte" composable (cheveux/vêtements/pantalon/accessoire libres)
  // + types dédiés Bébé etc. Les assets génériques vont sur "Adulte".
  const typeSlugs = new Map<string, { name: string; category: string }>();
  for (const a of assets) {
    const { category, typeName } = classify(a.name ?? "");
    const slug = typeName.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");
    typeSlugs.set(slug, { name: typeName, category });
  }
  // Ordre stable : Adultes d'abord, puis le reste alphabétique.
  const order = ["adulte", "homme", "enfant", "bebe", "animal"];
  const slugsSorted = [...typeSlugs.keys()].sort(
    (a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99),
  );
  const typeIdBySlug = new Map<string, number>();
  let pos = 0;
  for (const slug of slugsSorted) {
    const t = typeSlugs.get(slug)!;
    const id = await upsertType(slug, t.name, t.category, pos++);
    typeIdBySlug.set(slug, id);
  }
  console.log(
    `✓ ${typeIdBySlug.size} types : ${[...typeSlugs.values()].map((t) => t.name).join(", ")}`,
  );

  // 3. Rattachement asset -> type (seulement ceux non encore rattachés) ----
  let linked = 0;
  for (const a of assets) {
    if (a.characterTypeId) continue;
    const { typeName } = classify(a.name ?? "");
    const slug = typeName.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");
    const typeId = typeIdBySlug.get(slug);
    if (typeId) {
      await db
        .update(schema.assets)
        .set({ characterTypeId: typeId, view: a.view ?? "front" })
        .where(eq(schema.assets.id, a.id));
      linked++;
    }
  }
  console.log(`✓ ${linked} assets rattachés à un type`);

  const orphans = await db
    .select({ id: schema.assets.id })
    .from(schema.assets)
    .where(isNull(schema.assets.characterTypeId));
  console.log(`ℹ ${orphans.length} assets encore sans type`);

  await sql.end();
}

main().catch(async (e) => {
  console.error("✗ Seed personnages échoué :", e);
  await sql.end();
  process.exit(1);
});
