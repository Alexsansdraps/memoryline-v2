/**
 * G7 — le fichier d'impression d'une ligne de panier, rendu en local par le
 * moteur de la boutique (pdf.ts, renderPosterPng), SANS RIEN ÉCRIRE en base.
 *
 * docker exec -w /app/apps/api memoryline-api npx tsx /app/travaux/affiche-stand-mulhouse/rendu-impression.ts <config.json> <sortie.png> [A4|A3] [--sans-signature]
 *
 * --sans-signature : pour les visuels de la fiche (étape H), sans le logo que
 * seul le papier porte.
 *
 * La configuration est celle d'une ligne de panier, lue en psql (lecture
 * seule). N'importe que des fichiers de ../../apps/api/src.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { renderPosterPng } from "../../apps/api/src/pdf.js";
import { donneesDImpression } from "../../apps/api/src/fichiers-impression.js";

const args = process.argv.slice(2);
const sansSignature = args.includes("--sans-signature");
const [entree, sortie, format] = args.filter((a) => !a.startsWith("--"));
if (!entree || !sortie) {
  console.error("usage : rendu-impression.ts <config.json> <sortie.png> [A4|A3]");
  process.exit(1);
}
// Le fichier vient de psql : on retire un éventuel BOM et les blancs autour.
const config = JSON.parse(readFileSync(entree, "utf8").replace(/^﻿/, "").trim());
const debut = Date.now();
const data = await donneesDImpression();
const png = await renderPosterPng(config, {
  data: sansSignature ? { ...data, signature: null } : data,
  ...(format === "A4" || format === "A3" ? { format } : {}),
});
writeFileSync(sortie, png);
console.log(`${sortie} : ${png.length} octets en ${Date.now() - debut} ms`);
process.exit(0);
