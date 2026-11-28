// Inventaire 27/11 : mesures détaillées des gabarits de dos (lecture seule).
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const require = createRequire("/app/apps/api/package.json");
const sharp = require("sharp");
const A = "/app/data/assets/", R = "/tmp/gab-ref/";
const corps = {
  femme: [R+"gabarit-dos-femme-standard.svg", A+"gabarit-dos-femme-fine.svg", A+"gabarit-dos-femme-ronde.svg", A+"gabarit-dos-femme-agee.svg"],
  homme: [R+"gabarit-dos-homme-standard.svg", A+"gabarit-dos-homme-mince.svg", A+"gabarit-dos-homme-rond.svg", A+"gabarit-dos-homme-age.svg"],
  enfant: [R+"gabarit-dos-enfant-standard.svg", A+"gabarit-dos-enfant-fin.svg", A+"gabarit-dos-enfant-rond.svg"],
  ado: [R+"gabarit-dos-ado-standard.svg", A+"gabarit-dos-ado-fin.svg"],
};
async function masque(svg) {
  const { data } = await sharp(Buffer.from(svg), { density: 72 }).resize(500, 1000, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const L = []; const runs = [];
  for (let y = 0; y < 1000; y++) { let g = -1, d = -1; const r = []; let deb = -1;
    for (let x = 0; x < 500; x++) { const on = data[(y*500+x)*4+3] > 128; if (on) { if (g < 0) g = x; d = x + 1; if (deb < 0) deb = x; } else if (deb >= 0) { r.push([deb, x]); deb = -1; } }
    if (deb >= 0) r.push([deb, 500]);
    L.push(g < 0 ? null : [g, d]); runs.push(r); }
  L.runs = runs;
  return L;
}
const tete = (svg) => svg.match(/^[\s\S]*?<g[^>]*>/)[0];
const out = {};
for (const [fam, fs] of Object.entries(corps)) {
  out[fam] = {};
  for (const f of fs) {
    const svg = readFileSync(f, "utf8");
    const L = await masque(svg);
    const w = (y) => L[y] ? L[y][1] - L[y][0] : 0;
    let haut = L.findIndex(Boolean); let bas = 999; while (!L[bas]) bas--; bas++;
    // ombres st1 individuelles
    const ombres = [];
    const head = tete(svg);
    for (const m of svg.matchAll(/<path class="st1" d="([^"]*)"\/>/g)) {
      const Lm = await masque(head + `<path class="st0" d="${m[1]}"/></g></svg>`);
      const ys = Lm.map((r, y) => r ? y : -1).filter((y) => y >= 0);
      if (!ys.length) continue;
      const xs = ys.flatMap((y) => Lm[y]);
      const rr = {}; for (let y = ys[0]; y <= ys[ys.length-1]; y += 10) rr[y] = Lm.runs[y]; ombres.push({ y: [ys[0], ys[ys.length-1]+1], x: [Math.min(...xs), Math.max(...xs)], runs: rr });
    }
    const lignes = {}; for (let y = 0; y < 1000; y += 10) if (L[y]) lignes[y] = L[y];
    out[fam][f.split("/").pop()] = { haut, bas, lignes, ombres, larg: L.map((r) => r), runs: L.runs };
  }
}
writeFileSync("/tmp/inventaire-garde-robe/mes.json", JSON.stringify(out));
console.log("ok");
