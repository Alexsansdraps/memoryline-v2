/**
 * Rattache chaque fond (background) à SON produit, par correspondance de ville.
 *
 * Problème : l'import Shopify a chargé les 138 fonds sans `product_id` (lien
 * perdu). Conséquence : le configurateur d'une fiche produit ne savait pas
 * quel(s) fond(s) proposer et affichait toute la bibliothèque — inutile.
 *
 * Heuristique : le nom du fond commence par la VILLE (ex. `AMIENS_...`), le nom
 * du produit aussi (ex. `AMIENS Cathédrale - Affiche personnalisée`). On
 * normalise (majuscules, sans accents/séparateurs) et on rattache les fonds
 * dont la clé commence par un token significatif du nom produit.
 *
 * Idempotent : recalcule et réécrit `background.product_id` à chaque exécution.
 * Les fonds non rattachables restent à NULL (le configurateur retombe alors sur
 * la bibliothèque complète — jamais vide).
 *
 * Usage : pnpm --filter @memoryline/api run link-backgrounds
 */
import { eq } from "drizzle-orm";
import { sql, db, schema } from "../src/db/client.js";

const norm = (s: string | null) =>
  (s ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[^A-Z0-9]/g, "");

/** Tokens significatifs du nom produit (avant " - ", longueur ≥ 3). */
function productTokens(name: string): string[] {
  const head = name.split(/[-–]/)[0]!.trim(); // partie avant le tiret
  return head
    .split(/\s+/)
    .map(norm)
    .filter((t) => t.length >= 3);
}

async function main() {
  const products = await db
    .select({ id: schema.products.id, name: schema.products.name })
    .from(schema.products);
  const backgrounds = await db
    .select({ id: schema.backgrounds.id, name: schema.backgrounds.name })
    .from(schema.backgrounds);

  const bgKeys = backgrounds.map((b) => ({
    id: b.id,
    key: norm(b.name).replace(/AFFICHEPERSONNALISEE.*$/, ""),
  }));

  // `background.product_id` ne référence qu'UN produit. On veut surtout que
  // CHAQUE produit personnalisable propose le(s) fond(s) de SA ville. On attribue
  // donc chaque fond au produit dont la VILLE (1er token) matche ; en cas
  // d'ambiguïté (plusieurs produits d'une même ville, ex. plusieurs vues
  // d'Amiens), on prend le produit au nom le plus COURT = la fiche "ville"
  // générique, qui regroupe le mieux les fonds de la ville.
  const assignment = new Map<number, { productId: number; nameLen: number }>();

  for (const p of products) {
    const tokens = productTokens(p.name);
    const city = tokens[0]; // 1er token = ville
    if (!city) continue;
    const hits = bgKeys.filter((b) => b.key.startsWith(city));
    for (const h of hits) {
      const cur = assignment.get(h.id);
      // produit au nom le plus court gagne (fiche ville générique)
      if (!cur || p.name.length < cur.nameLen) {
        assignment.set(h.id, { productId: p.id, nameLen: p.name.length });
      }
    }
  }

  // Réinitialise puis applique (idempotent).
  await db.update(schema.backgrounds).set({ productId: null });
  let linked = 0;
  for (const [bgId, { productId }] of assignment) {
    await db
      .update(schema.backgrounds)
      .set({ productId })
      .where(eq(schema.backgrounds.id, bgId));
    linked++;
  }

  const productsWithBg = new Set([...assignment.values()].map((a) => a.productId))
    .size;
  console.log(
    `✓ ${linked}/${backgrounds.length} fonds rattachés à ${productsWithBg}/${products.length} produits`,
  );
  console.log(
    `ℹ ${backgrounds.length - linked} fonds non rattachés (restent disponibles via le fallback bibliothèque)`,
  );
  await sql.end();
}

main().catch(async (e) => {
  console.error("✗ Liaison échouée :", e);
  await sql.end();
  process.exit(1);
});
