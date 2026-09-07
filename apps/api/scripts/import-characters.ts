/**
 * Reconstruction IDEMPOTENTE de la bibliothèque personnages du configurateur
 * à partir de l'archive memoryline.fr (la VRAIE structure).
 *
 * Deux sources :
 *  1. data/memoryline-archive/characters/*.svg — 33 SVG complets pré-composés
 *     (un par personnage : Male_2, Small_Dog…). Chacun devient un
 *     `character_type` (slug, nom FR, catégorie, position, baseSvgUrl,
 *     baseColorZones).
 *  2. docs/memoryline-archive/customizer-config.json — les calques
 *     interchangeables GÉNÉRIQUES (partagés entre personnages). Top-level
 *     "front"/"back" ; chaque vue = { clothes, pants, hair, head } où
 *     head = ACCESSOIRES. Chaque entrée devient un `asset` générique
 *     (characterTypeId NULL).
 *
 * Les fichiers sont servis par l'API à /assets/<basename>. On stocke donc
 * svgUrl/baseSvgUrl = "/assets/<basename>" et on n'importe un calque que si
 * son fichier existe dans data/assets/ (sinon on le compte comme manquant).
 *
 * Idempotent :
 *  - character_type : upsert par slug.
 *  - assets génériques : on supprime d'abord tous les assets sans type
 *    (character_type_id IS NULL) puis on réinsère. Les assets liés à un type
 *    (character_type_id NON NULL) sont laissés intacts.
 *
 * Usage : pnpm --filter @memoryline/api run import-characters
 */
import { eq, isNull } from "drizzle-orm";
import { resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { sql, db, schema } from "../src/db/client.js";

const HERE = fileURLToPath(import.meta.url);
const CHARACTERS_DIR = resolve(HERE, "../../../../data/memoryline-archive/characters");
const ASSETS_DIR = resolve(HERE, "../../../../data/assets");
const CONFIG_PATH = resolve(HERE, "../../../../docs/memoryline-archive/customizer-config.json");

/** Lit un SVG et renvoie la map { classe -> couleur hex } de ses zones .stN. */
function extractColorZones(filePath: string): Record<string, string> {
  const zones: Record<string, string> = {};
  try {
    const svg = readFileSync(filePath, "utf8");
    const re = /\.(st\d+)\s*\{\s*fill\s*:\s*(#[0-9a-fA-F]{3,8})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(svg)) !== null) {
      zones[m[1]!] = m[2]!.toUpperCase();
    }
  } catch {
    // SVG illisible -> pas de zone (asset non recolorable, c'est OK)
  }
  return zones;
}

// --- 1. Mapping nom de fichier personnage -> libellé FR + catégorie --------

const CATEGORY_ORDER = [
  "Hommes",
  "Femmes",
  "Garçons",
  "Filles",
  "Ados",
  "Bébés",
  "Animaux",
] as const;
type Category = (typeof CATEGORY_ORDER)[number];

interface CharLabel {
  name: string;
  category: Category;
}

/**
 * Persos de l'ancien site dont le nom de fichier ne suit pas les patterns
 * génériques ci-dessous (uuid Shopify, noms libres…). Libellés dérivés du
 * champ `name` de characters-config.json, ramenés aux conventions v2
 * (« Homme N », pas de « dos » : l'orientation est portée par la vue).
 */
const KNOWN_CHARACTERS: Record<string, CharLabel> = {
  // Humains — variantes re-uploadées avec suffixe uuid
  female_1_1f3dbbab: { name: "Femme 1", category: "Femmes" }, // #24 dos
  female_1_6007b8b7: { name: "Femme fauteuil roulant", category: "Femmes" }, // #61
  female_2_de64ddc7: { name: "Femme 2", category: "Femmes" }, // #15 face
  female_2_9ea54a3e: { name: "Femme 2 (manches longues)", category: "Femmes" }, // #48
  female_3_24f00ce2: { name: "Femme marin", category: "Femmes" }, // #66
  female_4_afe4c383: { name: "Femme 4", category: "Femmes" }, // #59 dos (curvy)
  male_1_6574ee92: { name: "Homme 1", category: "Hommes" }, // #41 dos
  male_2_e6babd1b: { name: "Homme 2", category: "Hommes" }, // #18 face
  male_2_dc713bc7: { name: "Homme 2 (manches longues)", category: "Hommes" }, // #56
  male_3_ceb7dd5e: { name: "Homme 3", category: "Hommes" }, // #26 dos
  old_lady_1: { name: "Femme âgée", category: "Femmes" }, // #27
  old_man_1: { name: "Homme âgé", category: "Hommes" }, // #34
  teenage_girl_2_f60c741f: { name: "Ado fille 2", category: "Ados" }, // #23 face
  teenage_girl_2_4803dcfa: { name: "Ado fille 2 (manches longues)", category: "Ados" }, // #50
  boys_2_f87884c7: { name: "Garçon 2 (manches longues)", category: "Garçons" }, // #47
  girl_1_4291bb7f: { name: "Fille 1 (manches longues)", category: "Filles" }, // #57
  little_boy_1: { name: "Garçon 1", category: "Garçons" }, // #7 face
  little_girl_1: { name: "Fille 1", category: "Filles" }, // #8 face
  little_girl_1_d422e835: { name: "Fille 2", category: "Filles" }, // #35 face
  baby_boy_1: { name: "Bébé garçon 1", category: "Bébés" }, // #9 face
  baby_girl_1: { name: "Bébé fille 1", category: "Bébés" }, // #58 face
  // Animaux — noms libres
  "3": { name: "Chat noir (face)", category: "Animaux" }, // #43
  "4": { name: "Chat roux (face)", category: "Animaux" }, // #44
  chats_gris_dos_7f7e834c: { name: "Chat gris", category: "Animaux" }, // #45 dos
  chien_berger_allemand: { name: "Berger allemand", category: "Animaux" }, // #67
  chien_berger_australien: { name: "Berger australien", category: "Animaux" }, // #68
  "chien_york-chuihuahua": { name: "Chien york", category: "Animaux" }, // #70
  chien_chihuahua: { name: "Chihuahua", category: "Animaux" }, // #73
  chien_saint_bernard: { name: "Saint-bernard", category: "Animaux" }, // #74
  "chien_saint-bernard": { name: "Saint-bernard", category: "Animaux" }, // #74
};

/** Déduit libellé FR + catégorie depuis le nom de fichier (sans .svg). */
function classifyCharacter(base: string): CharLabel {
  const n = base.toLowerCase();

  // Persos connus de l'ancien site : match exact, puis sans le suffixe uuid
  // complet (on garde les 8 premiers hex, suffisants pour discriminer).
  const known =
    KNOWN_CHARACTERS[n] ??
    KNOWN_CHARACTERS[
      n.replace(
        /_([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        "_$1",
      )
    ];
  if (known) return known;

  let m: RegExpMatchArray | null;

  // Hommes : Male_N
  if ((m = n.match(/^male_(\d+)$/))) {
    return { name: `Homme ${m[1]}`, category: "Hommes" };
  }
  // Femmes : Female_N
  if ((m = n.match(/^female_(\d+)$/))) {
    return { name: `Femme ${m[1]}`, category: "Femmes" };
  }
  // Bébés
  if (n === "baby_boy") return { name: "Bébé garçon", category: "Bébés" };
  if (n === "baby_girl") return { name: "Bébé fille", category: "Bébés" };

  // Ados (avant Garçons/Filles génériques) : Teenage(s)_Boy(s)_N / Teenage(s)_Girl(s)_N
  if ((m = n.match(/^teenages?_boys?_(\d+)$/))) {
    return { name: `Ado garçon ${m[1]}`, category: "Ados" };
  }
  if ((m = n.match(/^teenages?_girls?_(\d+)$/))) {
    return { name: `Ado fille ${m[1]}`, category: "Ados" };
  }

  // Garçons : Boys_N
  if ((m = n.match(/^boys?_(\d+)$/))) {
    return { name: `Garçon ${m[1]}`, category: "Garçons" };
  }
  // Filles : Girl(s)_N
  if ((m = n.match(/^girls?_(\d+)$/))) {
    return { name: `Fille ${m[1]}`, category: "Filles" };
  }

  // Animaux ----------------------------------------------------------------
  if (n === "small_dog") return { name: "Petit chien", category: "Animaux" };
  if (n === "big_dog") return { name: "Grand chien", category: "Animaux" };
  if (n === "big_dog_blanc")
    return { name: "Grand chien (blanc)", category: "Animaux" };
  if (n === "big_dog_gris")
    return { name: "Grand chien (gris)", category: "Animaux" };
  if (n === "big_dog_noir")
    return { name: "Grand chien (noir)", category: "Animaux" };
  if ((m = n.match(/^dog_(\d+)$/))) {
    return { name: `Chien ${m[1]}`, category: "Animaux" };
  }
  if ((m = n.match(/^cat_(\d+)$/))) {
    return { name: `Chat ${m[1]}`, category: "Animaux" };
  }
  if (n === "chat_dos_2") return { name: "Chat (dos)", category: "Animaux" };
  if (n === "chats_2") return { name: "Chat 2", category: "Animaux" };
  if ((m = n.match(/^horse_(\d+)$/))) {
    return m[1] === "1"
      ? { name: "Cheval", category: "Animaux" }
      : { name: `Cheval ${m[1]}`, category: "Animaux" };
  }
  if ((m = n.match(/^pony_(\d+)$/))) {
    return m[1] === "1"
      ? { name: "Poney", category: "Animaux" }
      : { name: `Poney ${m[1]}`, category: "Animaux" };
  }

  // Repli : nom brut, catégorie Animaux (le moins gênant) -------------------
  return { name: base, category: "Animaux" };
}

async function upsertCharacterType(args: {
  slug: string;
  name: string;
  category: string;
  position: number;
  baseSvgUrl: string;
  baseColorZones: Record<string, string>;
}): Promise<void> {
  const existing = await db
    .select({ id: schema.characterTypes.id })
    .from(schema.characterTypes)
    .where(eq(schema.characterTypes.slug, args.slug));
  const values = {
    name: args.name,
    category: args.category,
    position: args.position,
    baseSvgUrl: args.baseSvgUrl,
    baseColorZones: args.baseColorZones,
    archivedAt: null,
  };
  if (existing[0]) {
    await db
      .update(schema.characterTypes)
      .set(values)
      .where(eq(schema.characterTypes.id, existing[0].id));
  } else {
    await db
      .insert(schema.characterTypes)
      .values({ slug: args.slug, ...values });
  }
}

// --- 2. Config calques génériques ------------------------------------------

interface ConfigEntry {
  id: number;
  src: string;
  offset: number | string;
}
type SlotConfig = Record<string, ConfigEntry[]>;
type CustomizerConfig = Record<string, SlotConfig>;

const VIEWS = ["front", "back"] as const;
const CONFIG_SLOTS = ["clothes", "pants", "hair", "head"] as const;
/** head = accessoires (cf. note du brief). */
const SLOT_MAP: Record<(typeof CONFIG_SLOTS)[number], string> = {
  clothes: "clothes",
  pants: "pants",
  hair: "hair",
  head: "accessory",
};

/** "Clothes_1_<uuid>.svg" -> "Clothes 1" (nom de modèle sans uuid ni ext). */
function labelFromFilename(file: string): string {
  let base = file.replace(/\.svg$/i, "");
  // retire un éventuel suffixe uuid v4
  base = base.replace(
    /_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "",
  );
  return base.replace(/_/g, " ").trim();
}

async function main(): Promise<void> {
  // ====================================================================
  // 1. CHARACTER TYPES (un par SVG complet)
  // ====================================================================
  const charFiles = readdirSync(CHARACTERS_DIR)
    .filter((f) => f.toLowerCase().endsWith(".svg"))
    .sort();

  interface PreparedType {
    slug: string;
    name: string;
    category: Category;
    baseSvgUrl: string;
    baseColorZones: Record<string, string>;
  }
  const prepared: PreparedType[] = charFiles.map((file) => {
    const base = file.replace(/\.svg$/i, "");
    const { name, category } = classifyCharacter(base);
    return {
      slug: base.toLowerCase(),
      name,
      category,
      baseSvgUrl: `/assets/${file}`,
      baseColorZones: extractColorZones(resolve(CHARACTERS_DIR, file)),
    };
  });

  // Tri stable : catégorie (ordre fixe) puis nom (locale FR).
  prepared.sort((a, b) => {
    const ca = CATEGORY_ORDER.indexOf(a.category);
    const cb = CATEGORY_ORDER.indexOf(b.category);
    if (ca !== cb) return ca - cb;
    return a.name.localeCompare(b.name, "fr", { numeric: true });
  });

  const byCategory = new Map<string, number>();
  let position = 0;
  for (const p of prepared) {
    await upsertCharacterType({
      slug: p.slug,
      name: p.name,
      category: p.category,
      position: position++,
      baseSvgUrl: p.baseSvgUrl,
      baseColorZones: p.baseColorZones,
    });
    byCategory.set(p.category, (byCategory.get(p.category) ?? 0) + 1);
  }

  // ====================================================================
  // 2. ASSETS GÉNÉRIQUES (calques interchangeables, character_type_id NULL)
  // ====================================================================
  // Idempotence : on repart d'une table propre côté génériques.
  await db.delete(schema.assets).where(isNull(schema.assets.characterTypeId));

  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as CustomizerConfig;

  let imported = 0;
  let skippedMissing = 0;
  let skippedEmpty = 0;
  let skippedDup = 0;
  const perViewSlot = new Map<string, number>();
  const seen = new Set<string>(); // dédup (svgUrl|view|slot) sur ce run

  for (const view of VIEWS) {
    const viewConfig = config[view];
    if (!viewConfig) continue;
    for (const cfgSlot of CONFIG_SLOTS) {
      const entries = viewConfig[cfgSlot];
      if (!entries) continue;
      const slot = SLOT_MAP[cfgSlot];
      for (const entry of entries) {
        const src = entry.src;
        if (!src || src.trim() === "") {
          skippedEmpty++;
          continue;
        }
        const file = basename(src.split("?")[0] ?? src);
        if (!existsSync(resolve(ASSETS_DIR, file))) {
          skippedMissing++;
          continue;
        }
        const svgUrl = `/assets/${file}`;
        const dedupKey = `${svgUrl}|${view}|${slot}`;
        if (seen.has(dedupKey)) {
          skippedDup++;
          continue;
        }
        seen.add(dedupKey);

        await db.insert(schema.assets).values({
          characterTypeId: null,
          slot,
          name: labelFromFilename(file),
          svgUrl,
          view,
          colorZones: extractColorZones(resolve(ASSETS_DIR, file)),
          position: entry.id,
        });
        imported++;
        const k = `${view}/${slot}`;
        perViewSlot.set(k, (perViewSlot.get(k) ?? 0) + 1);
      }
    }
  }

  // ====================================================================
  // 3. RÉCAP
  // ====================================================================
  console.log("\n=== Personnages (character_type) ===");
  console.log(`  total : ${prepared.length}`);
  for (const cat of CATEGORY_ORDER) {
    const n = byCategory.get(cat);
    if (n) console.log(`  ${cat.padEnd(10)} : ${n}`);
  }

  console.log("\n=== Calques génériques (assets, character_type_id NULL) ===");
  console.log(`  total importés : ${imported}`);
  const keys = [...perViewSlot.keys()].sort();
  for (const k of keys) {
    console.log(`  ${k.padEnd(16)} : ${perViewSlot.get(k)}`);
  }

  console.log("\n=== Entrées config ignorées ===");
  console.log(`  fichier manquant sur disque : ${skippedMissing}`);
  console.log(`  src vide                    : ${skippedEmpty}`);
  console.log(`  doublon (svgUrl/view/slot)  : ${skippedDup}`);

  await sql.end();
}

main().catch(async (e) => {
  console.error("✗ Import personnages échoué :", e);
  await sql.end();
  process.exit(1);
});
