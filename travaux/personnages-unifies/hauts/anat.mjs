// Hauts sur gabarit (27/11) : regarder l'anatomie de chaque famille (corps superposés, grille).
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
const require = createRequire("/app/apps/api/package.json");
const sharp = require("sharp");
const A = "/app/data/assets/", R = "/tmp/hauts/ref/";
const fam = {
  femme: ["gabarit-dos-femme-fine", "gabarit-dos-femme-ronde", "gabarit-dos-femme-agee", "gabarit-dos-femme-standard"],
  homme: ["gabarit-dos-homme-mince", "gabarit-dos-homme-rond", "gabarit-dos-homme-age", "gabarit-dos-homme-standard"],
  enfant: ["gabarit-dos-enfant-fin", "gabarit-dos-enfant-rond", "gabarit-dos-enfant-standard"],
  ado: ["gabarit-dos-ado-fin", "gabarit-dos-ado-standard"],
};
const lire = (f) => readFileSync(existsSync(A + f + ".svg") ? A + f + ".svg" : R + f + ".svg", "utf8");
const cols = ["#e33", "#33e", "#2a2", "#d90"];
const out = [];
let i = 0;
for (const [k, fs] of Object.entries(fam)) {
  // contour de chaque corps : on extrait le premier path (silhouette) et on le trace en couleur
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 1000" width="1000" height="2000"><rect width="500" height="1000" fill="#fff"/>`;
  for (let y = 0; y <= 1000; y += 25) svg += `<line x1="0" x2="500" y1="${y}" y2="${y}" stroke="${y % 100 ? "#eee" : "#bbb"}" stroke-width="0.6"/>${y % 100 ? "" : `<text x="2" y="${y - 2}" font-size="9">${y}</text>`}`;
  for (let x = 0; x <= 500; x += 25) svg += `<line y1="0" y2="1000" x1="${x}" x2="${x}" stroke="${x % 100 ? "#eee" : "#bbb"}" stroke-width="0.6"/>${x % 100 ? "" : `<text y="10" x="${x + 2}" font-size="9">${x}</text>`}`;
  fs.forEach((f, j) => {
    const s = lire(f);
    const ps = [...s.matchAll(/<path class="(st\d)" d="([^"]*)"/g)];
    for (const [, c, d] of ps) svg += `<path d="${d}" fill="${c === "st0" ? "none" : cols[j]}" fill-opacity="${c === "st0" ? 0 : 0.06}" stroke="${cols[j]}" stroke-width="${c === "st0" ? 1.2 : 0.4}"/>`;
  });
  svg += `<text x="300" y="990" font-size="14">${k}: ${fs.map((f, j) => cols[j] + " " + f.replace("gabarit-dos-", "")).join(" / ")}</text></svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toFile(`/tmp/hauts/anat-${k}.jpg`);
  i++;
}
console.log("ok");
