import { db, schema } from "../../src/db/client.js";
import {
  readCsv,
  groupByTopRow,
  slugify,
  toCents,
  toInt,
  parseFormat,
  bump,
  type ImportReport,
} from "./lib.js";

/**
 * Importe le catalogue : collections, produits, variantes (A4/A3), images,
 * fonds (backgrounds), et les liens produit<->collection.
 * Idempotent : on vide les tables catalogue avant réinsertion.
 */
export async function importCatalogue(report: ImportReport) {
  // --- Reset catalogue (idempotence) -------------------------------------
  await db.delete(schema.productCollections);
  await db.delete(schema.backgrounds);
  await db.delete(schema.productImages);
  await db.delete(schema.variants);
  await db.delete(schema.products);
  await db.delete(schema.collections);

  // --- Collections -------------------------------------------------------
  const collGroups = groupByTopRow(readCsv("Custom Collections.csv"));
  // slug collection -> id
  const collectionIdBySlug = new Map<string, number>();

  for (const group of collGroups) {
    const head = group[0]!;
    const slug = (head["Handle"] ?? "").trim();
    const name = (head["Title"] ?? "").trim();
    if (!slug || !name) {
      bump(report, "collection", "skipped");
      continue;
    }
    const [row] = await db
      .insert(schema.collections)
      .values({
        slug,
        name,
        description: (head["Body HTML"] ?? "").trim() || null,
        legacyId: toInt(head["ID"]) ?? undefined,
      })
      .returning({ id: schema.collections.id });
    collectionIdBySlug.set(slug, row!.id);
    bump(report, "collection", "created");
  }

  // mémorise, par produit (handle), les collections auxquelles il appartient
  const productCollectionSlugs = new Map<string, string[]>();
  for (const group of collGroups) {
    const collSlug = (group[0]!["Handle"] ?? "").trim();
    for (const row of group) {
      const ph = (row["Product: Handle"] ?? "").trim();
      if (!ph) continue;
      if (!productCollectionSlugs.has(ph)) productCollectionSlugs.set(ph, []);
      productCollectionSlugs.get(ph)!.push(collSlug);
    }
  }

  // --- Produits + variantes + images + backgrounds -----------------------
  const productGroups = groupByTopRow(readCsv("Products.csv"));

  for (const group of productGroups) {
    const head = group[0]!;
    const slug = (head["Handle"] ?? "").trim();
    const name = (head["Title"] ?? "").trim();
    if (!slug || !name) {
      bump(report, "product", "skipped");
      continue;
    }

    // Variantes (lignes avec un Variant ID + Option1 Value)
    const variantRows = group.filter(
      (r) => (r["Variant ID"] ?? "").trim() && (r["Option1 Value"] ?? "").trim(),
    );
    const prices = variantRows
      .map((r) => toCents(r["Variant Price"]))
      .filter((c) => c > 0);
    const basePrice = prices.length ? Math.min(...prices) : 0;
    // kind : base 23 € (perso) vs 15 € (prête). Seuil à 20 € (cf. audit).
    const kind = basePrice >= 2000 ? "personnalisable" : "prete_a_imprimer";

    const status = (head["Status"] ?? "active").trim().toLowerCase();

    const [product] = await db
      .insert(schema.products)
      .values({
        slug,
        name,
        description: (head["Body HTML"] ?? "").trim() || null,
        kind,
        basePriceCents: basePrice,
        status: status || "active",
        legacyId: toInt(head["ID"]) ?? undefined,
        legacySlug: slug,
      })
      .returning({ id: schema.products.id });
    const productId = product!.id;
    bump(report, "product", "created");

    // Variantes
    for (const vr of variantRows) {
      const { format, widthMm, heightMm } = parseFormat(vr["Option1 Value"]!);
      await db.insert(schema.variants).values({
        productId,
        format,
        priceCents: toCents(vr["Variant Price"]),
        widthMm,
        heightMm,
        legacyId: toInt(vr["Variant ID"]) ?? undefined,
      });
      bump(report, "variant", "created");
    }

    // Images (toutes les lignes du groupe avec une Image Src)
    let imgPos = 0;
    const seenImg = new Set<string>();
    for (const r of group) {
      const src = (r["Image Src"] ?? "").trim();
      if (!src || seenImg.has(src)) continue;
      seenImg.add(src);
      await db.insert(schema.productImages).values({
        productId,
        url: src,
        alt: (r["Image Alt Text"] ?? "").trim() || null,
        position: imgPos++,
      });
      bump(report, "product_image", "created");
    }

    // Lien produit <-> collections
    const collSlugs = new Set(productCollectionSlugs.get(slug) ?? []);
    let cpos = 0;
    for (const cs of collSlugs) {
      const cid = collectionIdBySlug.get(cs);
      if (!cid) continue;
      await db
        .insert(schema.productCollections)
        .values({ productId, collectionId: cid, position: cpos++ })
        .onConflictDoNothing();
      bump(report, "product_collection", "created");
    }
  }
}
