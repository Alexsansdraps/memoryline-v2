/**
 * Allège les fonds d'affiche — et répare la génération de PDF.
 *
 * Les fonds ne sont pas des dessins vectoriels : ce sont des photos PNG
 * encodées en base64 DANS un SVG, avec 25 % de surcoût d'encodage. D'où des
 * fichiers de 10 à 19 Mo, avec deux conséquences :
 *
 *  1. sharp (librsvg) REFUSE de lire les fichiers au-delà d'environ 9,7 Mo
 *     (limite du parseur XML sur un noeud texte). 29 fonds sur 421 étaient
 *     donc impossibles à rasteriser : aucun PDF d'impression pour les
 *     affiches concernées, et l'erreur était avalée par un catch.
 *  2. Le navigateur télécharge le fond entier dans le configurateur.
 *
 * On ré-encode chaque image embarquée en WebP, À RÉSOLUTION NATIVE (aucune
 * perte de définition pour l'impression), en gardant la structure du SVG
 * intacte : mêmes noms de fichiers, mêmes URLs, rien à changer en base.
 *
 * Idempotent : un fichier sans image PNG/JPEG embarquée est laissé tel quel.
 * Les originaux restent disponibles dans data/memoryline-archive/svg/.
 *
 *   pnpm --filter @memoryline/api run optimize-backgrounds
 */
import { readFile, writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { db, sql, schema } from "../src/db/client.js";

const ASSETS_DIR = resolve(fileURLToPath(import.meta.url), "../../../../data/assets");
const QUALITY = 90; // qualité impression : on ne redimensionne pas

const DATA_URI = /data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\s]+)/g;

async function optimize(file: string) {
  const path = resolve(ASSETS_DIR, file);
  const before = (await stat(path)).size;
  const svg = await readFile(path, "utf8");

  let out = svg;
  let images = 0;
  DATA_URI.lastIndex = 0;
  for (const m of svg.matchAll(DATA_URI)) {
    const raw = Buffer.from(m[2]!.replace(/\s/g, ""), "base64");
    // Résolution native conservée : seul l'encodage change.
    const webp = await sharp(raw).webp({ quality: QUALITY }).toBuffer();
    out = out.replace(m[0], `data:image/webp;base64,${webp.toString("base64")}`);
    images++;
  }
  if (!images) return { file, skipped: true as const };

  await writeFile(path, out);
  const after = (await stat(path)).size;

  // Filet : on vérifie que le fichier écrit est bien rasterisable — c'est
  // exactement ce que fera le générateur de PDF.
  let raster = "ok";
  try {
    await sharp(await readFile(path), { density: 300 }).metadata();
  } catch (e) {
    raster = `ECHEC (${String((e as Error).message).slice(0, 50)})`;
  }
  return { file, images, before, after, raster };
}

async function main() {
  // Liste faisant autorité : uniquement les FONDS. Les SVG de personnages
  // sont recolorés couche par couche et ne doivent surtout pas être touchés.
  const rows = await db
    .select({ url: schema.backgrounds.url })
    .from(schema.backgrounds);
  const files = [...new Set(rows.map((r) => r.url.replace(/^\/assets\//, "")))]
    .filter((f) => f.toLowerCase().endsWith(".svg"));

  console.log(`${files.length} fonds à traiter\n`);
  let totalBefore = 0;
  let totalAfter = 0;
  let converted = 0;
  const failures: string[] = [];

  for (const file of files) {
    try {
      const r = await optimize(file);
      if ("skipped" in r) continue;
      totalBefore += r.before;
      totalAfter += r.after;
      converted++;
      if (r.raster !== "ok") failures.push(`${r.file} : ${r.raster}`);
      const mb = (n: number) => (n / 1048576).toFixed(2);
      console.log(
        `${r.file.slice(0, 46).padEnd(48)} ${mb(r.before).padStart(6)} -> ${mb(r.after).padStart(6)} Mo  (${r.images} img)`,
      );
    } catch (e) {
      failures.push(`${file} : ${String((e as Error).message).slice(0, 60)}`);
    }
  }

  const mb = (n: number) => (n / 1048576).toFixed(0);
  console.log(`\n${converted} fichiers convertis`);
  console.log(`Total : ${mb(totalBefore)} Mo -> ${mb(totalAfter)} Mo`);
  if (totalAfter) console.log(`Gain  : ${(totalBefore / totalAfter).toFixed(0)}x plus léger`);
  if (failures.length) {
    console.log(`\n${failures.length} problème(s) :`);
    for (const f of failures) console.log("  -", f);
  } else {
    console.log("\nTous les fonds convertis sont rasterisables : PDF réparés.");
  }
  await sql.end();
}

main().catch(async (e) => {
  console.error("✗", e);
  await sql.end();
  process.exit(1);
});
