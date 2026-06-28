/**
 * Importe les configs par produit récupérées de l'ancien memoryline.fr
 * (scrape du metafield {backgrounds, title, subtitle, view} de chaque fiche).
 *
 * Pour chaque produit (matché par slug) :
 *  - default_title / default_subtitle / default_view (position des personnages),
 *  - rattache le(s) fond(s) `backgrounds` au produit (background.product_id),
 *    en créant le background s'il n'existe pas déjà (par nom de fichier).
 *
 * Source : data/memoryline-archive/product-configs.json
 *   { "<slug>": { backgrounds:[url…], title, subtitle, view }, … }
 *
 * Idempotent. Usage : pnpm --filter @memoryline/api run import-product-configs
 */
import { eq } from "drizzle-orm";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { sql, db, schema } from "../src/db/client.js";

interface ProductCfg {
  backgrounds?: string[];
  title?: string;
  subtitle?: string;
  view?: string;
}

const CONFIGS_PATH = resolve(
  fileURLToPath(import.meta.url),
  "../../../../data/memoryline-archive/product-configs.json",
);

/** "https://cdn…/files/NAME.svg?v=…" -> "NAME.svg" (nom de fichier servi /assets). */
function fileName(url: string): string {
  return decodeURIComponent(url.split("/").pop()?.split("?")[0] ?? "");
}

async function main() {
  const raw = await readFile(CONFIGS_PATH, "utf8");
  const configs = JSON.parse(raw) as Record<string, ProductCfg>;
  const slugs = Object.keys(configs);
  console.log(`→ ${slugs.length} configs produit à importer`);

  let updated = 0,
    bgLinked = 0,
    bgCreated = 0,
    notFound = 0;

  for (const slug of slugs) {
    const cfg = configs[slug]!;
    const [product] = await db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(eq(schema.products.slug, slug));
    if (!product) {
      notFound++;
      continue;
    }

    // 1) Réglages par défaut.
    await db
      .update(schema.products)
      .set({
        defaultTitle: cfg.title?.trim() || null,
        defaultSubtitle: cfg.subtitle?.trim() || null,
        defaultView: cfg.view === "front" ? "front" : cfg.view === "back" ? "back" : null,
      })
      .where(eq(schema.products.id, product.id));
    updated++;

    // 2) Rattachement des fonds.
    let pos = 0;
    for (const url of cfg.backgrounds ?? []) {
      const file = fileName(url);
      if (!file) continue;
      const assetUrl = `/assets/${file}`;
      // existe déjà (par url) ?
      const [existing] = await db
        .select({ id: schema.backgrounds.id })
        .from(schema.backgrounds)
        .where(eq(schema.backgrounds.url, assetUrl));
      if (existing) {
        await db
          .update(schema.backgrounds)
          .set({ productId: product.id, position: pos })
          .where(eq(schema.backgrounds.id, existing.id));
        bgLinked++;
      } else {
        await db.insert(schema.backgrounds).values({
          productId: product.id,
          url: assetUrl,
          name: file.replace(/\.svg$/i, ""),
          position: pos,
        });
        bgCreated++;
      }
      pos++;
    }
  }

  console.log(
    `✓ ${updated} produits mis à jour (titre/sous-titre/position par défaut)`,
  );
  console.log(`✓ fonds : ${bgLinked} rattachés, ${bgCreated} créés`);
  if (notFound) console.log(`ℹ ${notFound} slugs sans produit correspondant en base`);
  await sql.end();
}

main().catch(async (e) => {
  console.error("✗ Import configs produit échoué :", e);
  await sql.end();
  process.exit(1);
});
