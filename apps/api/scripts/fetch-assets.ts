/**
 * Rapatrie les images/SVG depuis le CDN Shopify vers le stockage local
 * (data/assets/) afin de couper toute dépendance à Shopify, puis réécrit
 * les URLs en base vers /assets/<fichier> (servi par l'API).
 *
 * - Idempotent : un fichier déjà téléchargé n'est pas re-téléchargé.
 * - Nom de fichier local = <hash8>-<nom-original> (évite les collisions).
 * - Ne réécrit en base que les URLs effectivement rapatriées.
 *
 * Usage : pnpm --filter @memoryline/api run fetch-assets
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile, access } from "node:fs/promises";
import { resolve, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { sql, db, schema } from "../src/db/client.js";
import { eq } from "drizzle-orm";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../../../..");
const ASSETS_DIR = resolve(REPO_ROOT, "data/assets");
const CONCURRENCY = 8;

/** /assets est servi par l'API (cf. src/index.ts). */
const PUBLIC_PREFIX = "/assets";

function localName(url: string): string {
  const clean = url.split("?")[0] ?? url;
  const base = basename(clean) || "file";
  const ext = extname(base) || "";
  const stem = base.slice(0, base.length - ext.length).slice(0, 60);
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 8);
  // slug sûr pour un nom de fichier
  const safe = stem.normalize("NFD").replace(/[^a-zA-Z0-9._-]+/g, "-");
  return `${hash}-${safe}${ext}`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

interface Job {
  url: string;
  table: "product_image" | "background" | "asset";
}

async function collectJobs(): Promise<Job[]> {
  const jobs: Job[] = [];
  for (const r of await db
    .select({ url: schema.productImages.url })
    .from(schema.productImages))
    if (isRemote(r.url)) jobs.push({ url: r.url, table: "product_image" });
  for (const r of await db
    .select({ url: schema.backgrounds.url })
    .from(schema.backgrounds))
    if (isRemote(r.url)) jobs.push({ url: r.url, table: "background" });
  for (const r of await db
    .select({ url: schema.assets.svgUrl })
    .from(schema.assets))
    if (isRemote(r.url)) jobs.push({ url: r.url, table: "asset" });
  // dédup par URL (on garde la 1re occurrence ; la réécriture se fait par URL)
  const seen = new Set<string>();
  return jobs.filter((j) => (seen.has(j.url) ? false : seen.add(j.url)));
}

function isRemote(u: string): boolean {
  return /^https?:\/\//.test(u);
}

async function main() {
  await mkdir(ASSETS_DIR, { recursive: true });
  const jobs = await collectJobs();
  console.log(`▶ ${jobs.length} fichiers distants à rapatrier vers ${ASSETS_DIR}\n`);

  // url distante -> url locale publique
  const remap = new Map<string, string>();
  let downloaded = 0,
    cached = 0,
    failed = 0;

  // pool de concurrence
  let idx = 0;
  async function worker() {
    while (idx < jobs.length) {
      const job = jobs[idx++]!;
      const name = localName(job.url);
      const dest = resolve(ASSETS_DIR, name);
      const publicUrl = `${PUBLIC_PREFIX}/${name}`;
      try {
        if (await exists(dest)) {
          cached++;
        } else {
          const res = await fetch(job.url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = Buffer.from(await res.arrayBuffer());
          await writeFile(dest, buf);
          downloaded++;
        }
        remap.set(job.url, publicUrl);
      } catch (e) {
        failed++;
        console.warn(`  ✗ ${job.url.slice(0, 70)} — ${String(e)}`);
      }
      if ((downloaded + cached) % 50 === 0) {
        console.log(`  …${downloaded + cached}/${jobs.length}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // --- Réécriture des URLs en base ---------------------------------------
  console.log(`\n• Réécriture des URLs en base (${remap.size} fichiers)…`);
  let rewritten = 0;
  for (const [remoteUrl, publicUrl] of remap) {
    const a = await db
      .update(schema.productImages)
      .set({ url: publicUrl })
      .where(eq(schema.productImages.url, remoteUrl));
    const b = await db
      .update(schema.backgrounds)
      .set({ url: publicUrl })
      .where(eq(schema.backgrounds.url, remoteUrl));
    const c = await db
      .update(schema.assets)
      .set({ svgUrl: publicUrl })
      .where(eq(schema.assets.svgUrl, remoteUrl));
    rewritten +=
      (a.count ?? 0) + (b.count ?? 0) + (c.count ?? 0) > 0 ? 1 : 0;
  }

  console.log(
    `\n=== Rapatriement terminé ===\n  téléchargés=${downloaded}  en cache=${cached}  échecs=${failed}\n  URLs réécrites (distinctes)=${rewritten}`,
  );
  await sql.end();
}

main().catch(async (e) => {
  console.error("✗ Échec :", e);
  await sql.end();
  process.exit(1);
});
