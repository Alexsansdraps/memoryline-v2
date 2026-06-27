/**
 * Mapping PROPRE des personnages pour un affichage clean côté client.
 *
 * Problème : l'import a créé des dizaines de DOUBLONS (Clothes_1 en 22
 * exemplaires, Hair_1 en 22…) → 43 vêtements pour 6 modèles réels, 69 cheveux
 * pour 15. Le configurateur affichait donc 22 fois le même t-shirt. De plus
 * tout était empilé dans un seul type "Adulte", bébé mélangé aux adultes, et
 * le "Wheel_Chair" rangé dans les cheveux.
 *
 * Ce script (idempotent) remet de l'ordre :
 *  1. DÉDUPLIQUE : un seul asset par "modèle" (nom de base sans suffixe UUID).
 *     Les doublons sont supprimés ; on garde l'exemplaire au plus petit id.
 *  2. CATÉGORISE en types cohérents (Adulte / Bébé), chaque type ne recevant
 *     QUE ses propres éléments.
 *  3. RECLASSE les slots aberrants (Wheel_Chair: hair -> accessory).
 *  4. Renomme proprement (labels FR lisibles) + ordonne (position).
 *
 * Usage : pnpm --filter @memoryline/api run map-characters
 */
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../src/db/client.js";

/** Nom de base = nom sans le suffixe UUID d'import. */
function baseName(name: string | null): string {
  return (name ?? "").replace(/_[0-9a-f]{8}-.*$/i, "").trim();
}

/** Détermine type + slot + libellé FR + ordre d'un modèle. */
function classify(base: string, slot: string): {
  type: "adulte" | "bebe";
  slot: string;
  label: string;
  order: number;
} | null {
  const b = base.toLowerCase();

  // Bébé : ensemble dédié.
  if (b.startsWith("baby")) {
    const isBoy = b.includes("boy");
    const label = isBoy ? "Bébé garçon" : "Bébé fille";
    return { type: "bebe", slot, label, order: isBoy ? 0 : 1 };
  }

  // Wheel_Chair : ce n'est pas une coupe de cheveux -> accessoire.
  if (b.startsWith("wheel")) {
    return { type: "adulte", slot: "accessory", label: "Fauteuil roulant", order: 90 };
  }

  // Adulte (cas général).
  if (slot === "clothes") {
    const n = base.match(/(\d+)/)?.[1] ?? "";
    return { type: "adulte", slot, label: `Vêtement ${n || ""}`.trim(), order: Number(n) || 50 };
  }
  if (slot === "pants") {
    return { type: "adulte", slot, label: "Pantalon", order: 0 };
  }
  if (slot === "accessory") {
    const n = base.match(/(\d+)/)?.[1] ?? "";
    return { type: "adulte", slot, label: `Accessoire ${n || ""}`.trim(), order: Number(n) || 50 };
  }
  if (slot === "hair") {
    if (b.includes("facial"))
      return { type: "adulte", slot, label: "Barbe", order: 80 };
    const male = b.includes("male");
    const n = base.match(/(\d+)/)?.[1] ?? "";
    return {
      type: "adulte",
      slot,
      label: male ? `Coupe homme ${n}`.trim() : `Coupe ${n || base}`.trim(),
      order: Number(n) || 40,
    };
  }
  return { type: "adulte", slot, label: base, order: 50 };
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
      .set({ name, category, position, archivedAt: null })
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
  const all = await db.select().from(schema.assets);
  console.log(`→ ${all.length} assets en base`);

  // 1. Dédup : garder le plus petit id par (base, slot d'origine).
  const seen = new Map<string, number>(); // key -> kept id
  const dupeIds: number[] = [];
  // tri par id croissant pour garder le plus ancien
  for (const a of [...all].sort((x, y) => x.id - y.id)) {
    const key = `${a.slot}::${baseName(a.name)}`;
    if (seen.has(key)) dupeIds.push(a.id);
    else seen.set(key, a.id);
  }
  if (dupeIds.length) {
    // Détache d'abord (au cas où) puis supprime les doublons.
    for (let i = 0; i < dupeIds.length; i += 100) {
      await db
        .delete(schema.assets)
        .where(inArray(schema.assets.id, dupeIds.slice(i, i + 100)));
    }
  }
  console.log(`✓ ${dupeIds.length} doublons supprimés, ${seen.size} modèles uniques conservés`);

  // 2. Types cibles.
  const adulteId = await upsertType("adulte", "Adulte", "Personnes", 0);
  const bebeId = await upsertType("bebe", "Bébé", "Personnes", 1);
  const typeId = { adulte: adulteId, bebe: bebeId };

  // Archive les anciens types parasites (ex. "Homme") devenus inutiles.
  await db
    .update(schema.characterTypes)
    .set({ archivedAt: new Date() })
    .where(
      inArray(schema.characterTypes.slug, ["homme"]),
    );

  // 3. Reclasse chaque modèle unique conservé.
  const kept = await db
    .select()
    .from(schema.assets)
    .where(inArray(schema.assets.id, [...seen.values()]));
  let mapped = 0;
  for (const a of kept) {
    const c = classify(baseName(a.name), a.slot);
    if (!c) continue;
    await db
      .update(schema.assets)
      .set({
        characterTypeId: typeId[c.type],
        slot: c.slot,
        name: c.label,
        position: c.order,
        view: a.view ?? "back",
      })
      .where(eq(schema.assets.id, a.id));
    mapped++;
  }
  console.log(`✓ ${mapped} modèles mappés (type + slot + libellé + ordre)`);

  // 4. Récap lisible (comptage en JS pour éviter un bug d'agrégat Drizzle).
  const finalAssets = await db
    .select({
      typeId: schema.assets.characterTypeId,
      slot: schema.assets.slot,
    })
    .from(schema.assets);
  const types = await db.select().from(schema.characterTypes);
  const nameById = new Map(types.map((t) => [t.id, t.name]));
  const counts = new Map<string, number>();
  for (const a of finalAssets) {
    const key = `${nameById.get(a.typeId ?? -1) ?? "?"} / ${a.slot}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  console.log("\nRécap (clean) :");
  for (const [k, n] of [...counts].sort()) console.log(`  ${k}: ${n}`);

  process.exit(0);
}

main().catch((e) => {
  console.error("✗ Mapping échoué :", e);
  process.exit(1);
});
