// Rend des SVG en PNG avec le sharp de l'API (même moteur, librsvg, que
// l'aperçu ?l= et que le fichier d'impression), pour les regarder AVANT de
// les ranger dans data/assets (servi « immutable »).
// Dans le conteneur :
//   docker exec memoryline-api node /app/travaux/affiche-stand-mulhouse/navigateur/rendu-svg.mjs <largeur> <sortie> <svg...>
import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";

const require = createRequire("/app/apps/api/package.json");
const sharp = require("sharp");

const [largeur, sortie, ...fichiers] = process.argv.slice(2);
mkdirSync(sortie, { recursive: true });
for (const f of fichiers) {
  const svg = readFileSync(f);
  const m = await sharp(svg).metadata();
  const densite = m.width ? Math.min(600, Math.max(36, Math.ceil((72 * Number(largeur)) / m.width) + 1)) : 150;
  await sharp(svg, { density: densite })
    .resize({ width: Number(largeur) })
    .png()
    .toFile(join(sortie, basename(f).replace(/\.svg$/, ".png")));
}
console.log(`${fichiers.length} rendus dans ${sortie}`);
