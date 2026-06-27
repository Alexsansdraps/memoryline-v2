import { sql } from "../../src/db/client.js";
import { db, schema } from "../../src/db/client.js";
import { readCsv, IMPORT_DIR, bump, type ImportReport } from "./lib.js";
import { importCatalogue } from "./catalogue.js";
import { importCustomersAndOrders } from "./orders.js";
import { importAssets } from "./assets.js";

async function importRedirects(report: ImportReport) {
  await db.delete(schema.redirects);
  for (const r of readCsv("Redirects.csv")) {
    const from = (r["Path"] ?? "").trim();
    const to = (r["Target"] ?? "").trim();
    if (!from || !to) {
      bump(report, "redirect", "skipped");
      continue;
    }
    await db
      .insert(schema.redirects)
      .values({ fromPath: from, toPath: to, code: 301 })
      .onConflictDoNothing();
    bump(report, "redirect", "created");
  }
}

async function main() {
  const report: ImportReport = {};
  console.log(`▶ Import depuis ${IMPORT_DIR}\n`);

  console.log("• Catalogue (collections, produits, variantes, images)…");
  await importCatalogue(report);

  console.log("• Bibliothèque assets + fonds (Files.csv)…");
  await importAssets(report);

  console.log("• Clients + commandes (web + salon, snapshots perso)…");
  await importCustomersAndOrders(report);

  console.log("• Redirections 301…");
  await importRedirects(report);

  console.log("\n=== Rapport d'import ===");
  const entities = Object.keys(report).sort();
  for (const e of entities) {
    const r = report[e]!;
    console.log(
      `  ${e.padEnd(26)} créés=${String(r.created).padStart(5)}  ignorés=${String(r.skipped).padStart(4)}  erreurs=${r.errors}`,
    );
  }
  console.log("\n✓ Import terminé.");
  await sql.end();
}

main().catch(async (err) => {
  console.error("✗ Import échoué :", err);
  await sql.end();
  process.exit(1);
});
