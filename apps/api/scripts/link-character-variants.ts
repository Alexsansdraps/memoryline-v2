/**
 * Lie chaque personnage à SES variantes de slots (vêtements/pantalon/cheveux/
 * accessoires) d'après l'ancien site, et corrige son orientation native.
 *
 * Source : data/memoryline-archive/characters-config.json = metafield
 * `custom.characters` de l'ancien memoryline.fr (74 entrées). Chaque entrée :
 *   { id, view: 'front'|'back', name, preview, src,
 *     assets: { clothes: [ids], pants: [ids], hair: [ids], head: [ids] } }
 * où les ids référencent les listes de customizer-config.json (par vue) —
 * les mêmes ids que `asset.position` posés par import-characters sur les
 * assets génériques. On stocke donc ces ids TELS QUELS dans
 * `character_type.slot_variants` (stables d'un ré-import à l'autre),
 * avec head -> accessory.
 *
 * Correspondance ancien perso -> character_type : par basename du SVG
 * (old.preview == character_type.base_svg_url). En cas de doublons côté
 * ancien site (même preview réutilisé), le plus petit id gagne.
 *
 * Idempotent : de simples UPDATE, relançable à volonté.
 *
 * Usage : pnpm --filter @memoryline/api run link-character-variants
 */
import { eq } from "drizzle-orm";
import { resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { db, schema, sql } from "../src/db/client.js";

const HERE = fileURLToPath(import.meta.url);
const CHARACTERS_CONFIG = resolve(
  HERE,
  "../../../../data/memoryline-archive/characters-config.json",
);

interface OldCharacter {
  id: number;
  view: "front" | "back";
  name: string;
  preview: string;
  src: string;
  assets?: Partial<Record<"clothes" | "pants" | "hair" | "head", number[]>>;
  isBaby?: boolean;
}

type SlotVariants = Partial<
  Record<"clothes" | "pants" | "hair" | "accessory", number[]>
>;

/** "https://cdn…/files/Male_2.svg?v=123" -> "Male_2.svg" */
function fileOf(url: string | null | undefined): string {
  if (!url) return "";
  return basename((url.split("?")[0] ?? url).trim());
}

async function main(): Promise<void> {
  const oldChars = (
    JSON.parse(readFileSync(CHARACTERS_CONFIG, "utf8")) as OldCharacter[]
  ).sort((a, b) => a.id - b.id);

  // 1er ancien perso par basename de preview (les doublons suivants ignorés).
  const byPreview = new Map<string, OldCharacter>();
  for (const oc of oldChars) {
    const key = fileOf(oc.preview);
    if (key && !byPreview.has(key)) byPreview.set(key, oc);
  }

  const types = await db.select().from(schema.characterTypes);

  let linked = 0;
  const unmatched: string[] = [];
  for (const t of types) {
    const old = byPreview.get(fileOf(t.baseSvgUrl));
    if (!old) {
      unmatched.push(`${t.slug} (${fileOf(t.baseSvgUrl)})`);
      continue;
    }
    const a = old.assets ?? {};
    const slotVariants: SlotVariants = {
      clothes: a.clothes ?? [],
      pants: a.pants ?? [],
      hair: a.hair ?? [],
      accessory: a.head ?? [], // head = accessoires (cf. import-characters)
    };
    await db
      .update(schema.characterTypes)
      .set({
        orientation: old.view,
        legacyTypeId: old.id,
        slotVariants,
      })
      .where(eq(schema.characterTypes.id, t.id));
    linked++;
    console.log(
      `  ${t.slug.padEnd(16)} <- #${old.id} "${old.name}" (${old.view})` +
        ` clothes:${slotVariants.clothes!.length}` +
        ` pants:${slotVariants.pants!.length}` +
        ` hair:${slotVariants.hair!.length}` +
        ` accessory:${slotVariants.accessory!.length}`,
    );
  }

  console.log(`\n=== Liaison variantes par personnage ===`);
  console.log(`  liés      : ${linked}/${types.length}`);
  if (unmatched.length > 0) {
    console.log(`  sans correspondance : ${unmatched.join(", ")}`);
  }
  const missing = oldChars.filter(
    (oc) => byPreview.get(fileOf(oc.preview)) === oc &&
      !types.some((t) => fileOf(t.baseSvgUrl) === fileOf(oc.preview)),
  );
  console.log(
    `  persos de l'ancien site ABSENTS de v2 (uniques) : ${missing.length}` +
      (missing.length ? ` -> ${missing.map((m) => `#${m.id} ${m.name}`).join(", ")}` : ""),
  );

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
