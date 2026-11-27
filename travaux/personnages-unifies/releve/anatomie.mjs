// Relevé du 27/11 (lecture seule) : mesure de l'anatomie des corps de dos.
// On ne garde visible que le groupe *_Base_* (le corps), on rend en 500x1000
// et on relève, ligne par ligne, la largeur occupée.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire("/app/apps/api/package.json");
const sharp = require("sharp");
const A = "/app/data/assets/";
const fichiers = JSON.parse(process.env.FICHIERS);

for (const [nom, f] of fichiers) {
  let svg = readFileSync(A + f, "utf8");
  // cacher tous les groupes non-corps
  svg = svg.replace(/<g\b([^>]*?)\sid="([^"]*)"([^>]*)>/g, (m, a, id, b) =>
    /(^|_)(Bottoms?|Clothes|Hair|Accessor)/i.test(id) ? `<g${a} id="${id}"${b} display="none">` : m);
  const { data, info } = await sharp(Buffer.from(svg), { density: 72 })
    .resize(500, 1000, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const larg = [];
  let haut = -1, bas = -1;
  for (let y = 0; y < H; y++) {
    let g = -1, d = -1;
    for (let x = 0; x < W; x++) if (data[(y * W + x) * 4 + 3] > 128) { if (g < 0) g = x; d = x; }
    larg.push(g < 0 ? null : [g, d]);
    if (g >= 0) { if (haut < 0) haut = y; bas = y; }
  }
  // tête : largeur max entre haut et haut+150 ; cou : largeur min sous la tête ; épaules : largeur max du tronc
  const w = (y) => (larg[y] ? larg[y][1] - larg[y][0] + 1 : 0);
  let teteY = haut, teteW = 0;
  for (let y = haut; y < haut + 160 && y < H; y++) if (w(y) > teteW) { teteW = w(y); teteY = y; }
  let couY = teteY, couW = 9999;
  for (let y = teteY; y < teteY + 140 && y < H; y++) if (w(y) > 0 && w(y) < couW) { couW = w(y); couY = y; }
  const mid = Math.round((haut + bas) / 2);
  const lignes = [couY + 40, couY + 80, mid, Math.round(bas - (bas - mid) / 2), bas - 5].map((y) => `${y}:${larg[y] ? larg[y].join("-") : "-"}`);
  console.log(`${nom} | haut ${haut} | bas ${bas} | tete y${teteY} w${teteW} [${larg[teteY]?.join("-")}] | cou y${couY} w${couW} | ${lignes.join(" ")}`);
}
