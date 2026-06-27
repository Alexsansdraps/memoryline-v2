/**
 * Génère le fichier `_redirects` (format Netlify/Cloudflare Pages) à partir
 * de la table `redirect` (§13.2). À lancer avant le déploiement du front.
 * Sortie : apps/web/public/_redirects
 *
 * Inclut :
 *  - le changement de préfixe /products/* -> /affiches/* (301)
 *  - les redirections importées de Shopify (ex. strasbourg -> colmar),
 *    réécrites elles aussi vers /affiches.
 */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql, db, schema } from "../src/db/client.js";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../../../..");
const OUT = resolve(REPO_ROOT, "apps/web/public/_redirects");

async function main() {
  const lines: string[] = [
    "# Généré par gen-redirects.ts — ne pas éditer à la main",
    "# Changement de préfixe Shopify -> nouveau site (§13)",
    "/products/* /affiches/:splat 301",
    "",
    "# Redirections spécifiques (table redirect)",
  ];

  for (const r of await db.select().from(schema.redirects)) {
    // Réécrit /products/x -> /affiches/x pour rester cohérent avec le préfixe.
    const to = r.toPath.replace(/^\/products\//, "/affiches/");
    const from = r.fromPath;
    // évite de dupliquer la règle générique
    if (/^\/products\/[^/]+$/.test(from)) {
      lines.push(`${from} ${to} ${r.code}`);
    } else {
      lines.push(`${from} ${to} ${r.code}`);
    }
  }

  await writeFile(OUT, lines.join("\n") + "\n", "utf8");
  console.log(`✓ ${OUT} généré (${lines.length} lignes).`);
  await sql.end();
}

main().catch(async (e) => {
  console.error("✗", e);
  await sql.end();
  process.exit(1);
});
