// Hauts sur gabarit (27/11) : mesure, pour chaque famille, de chaque corps ligne à ligne
// (bords gauche/droit) et de la ligne d'épaules (plus haut pixel de corps par colonne, sous le cou).
// Alexandra : « et pas de calage sur les nouveaux » : la pièce doit couvrir TOUS les corps de sa famille.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const require = createRequire("/app/apps/api/package.json");
const sharp = require("sharp");
const A = "/app/data/assets/", R = "/tmp/hauts/ref/";
export const FAMILLES = {
  femme: { corps: ["gabarit-dos-femme-fine", "gabarit-dos-femme-ronde", "gabarit-dos-femme-agee", "gabarit-dos-femme-standard"], couY: 330 },
  homme: { corps: ["gabarit-dos-homme-mince", "gabarit-dos-homme-rond", "gabarit-dos-homme-age", "gabarit-dos-homme-standard"], couY: 315 },
  enfant: { corps: ["gabarit-dos-enfant-fin", "gabarit-dos-enfant-rond", "gabarit-dos-enfant-standard"], couY: 420 },
  ado: { corps: ["gabarit-dos-ado-fin", "gabarit-dos-ado-standard"], couY: 335 },
};
const lire = (f) => readFileSync(existsSync(A + f + ".svg") ? A + f + ".svg" : R + f + ".svg", "utf8");
async function masque(svg) {
  const { data } = await sharp(Buffer.from(svg), { density: 72 }).resize(500, 1000, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return (x, y) => data[(y * 500 + x) * 4 + 3] > 128;
}
const out = {};
for (const [k, f] of Object.entries(FAMILLES)) {
  const corps = {};
  for (const c of f.corps) {
    const m = await masque(lire(c));
    const lignes = [];
    for (let y = 0; y < 1000; y++) {
      let g = -1, d = -1;
      for (let x = 0; x < 500; x++) if (m(x, y)) { if (g < 0) g = x; d = x + 1; }
      lignes.push(g < 0 ? null : [g, d]);
    }
    const epaules = [];
    for (let x = 0; x < 500; x++) {
      let t = null;
      for (let y = f.couY; y < 1000; y++) if (m(x, y)) { t = y; break; }
      epaules.push(t);
    }
    corps[c] = { lignes, epaules };
  }
  out[k] = corps;
}
writeFileSync("/tmp/hauts/fam.json", JSON.stringify(out));
console.log("ok");
