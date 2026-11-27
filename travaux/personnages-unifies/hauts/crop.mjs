// Hauts (27/11) : gros plan d'une zone de chaque corps d'une famille, avec grille de 10 px.
// usage : node crop.mjs famille x0 y0 w h echelle sortie [piece.svg]
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
const require = createRequire("/app/apps/api/package.json");
const sharp = require("sharp");
const A = "/app/data/assets/", R = "/tmp/hauts/ref/";
const FAM = {
  femme: ["gabarit-dos-femme-fine", "gabarit-dos-femme-ronde", "gabarit-dos-femme-agee", "gabarit-dos-femme-standard"],
  homme: ["gabarit-dos-homme-mince", "gabarit-dos-homme-rond", "gabarit-dos-homme-age", "gabarit-dos-homme-standard"],
  enfant: ["gabarit-dos-enfant-fin", "gabarit-dos-enfant-rond", "gabarit-dos-enfant-standard"],
  ado: ["gabarit-dos-ado-fin", "gabarit-dos-ado-standard"],
};
const [fam, x0, y0, w, h, k, sortie, piece] = process.argv.slice(2);
const X0 = +x0, Y0 = +y0, W = +w, H = +h, K = +k;
const lire = (f) => readFileSync(existsSync(A + f + ".svg") ? A + f + ".svg" : R + f + ".svg", "utf8");
const comps = [];
const corps = FAM[fam];
for (let i = 0; i < corps.length; i++) {
  const couches = [lire(corps[i])];
  if (piece) couches.push(readFileSync(piece, "utf8"));
  let grille = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * K}" height="${H * K}" viewBox="${X0} ${Y0} ${W} ${H}">`;
  for (let y = Math.ceil(Y0 / 10) * 10; y < Y0 + H; y += 10) grille += `<line x1="${X0}" x2="${X0 + W}" y1="${y}" y2="${y}" stroke="${y % 50 ? "#0003" : "#00f8"}" stroke-width="${0.6 / K * 2}"/>` + (y % 50 ? "" : `<text x="${X0 + 1}" y="${y - 1}" font-size="${12 / K}" fill="#00f">${y}</text>`);
  for (let x = Math.ceil(X0 / 10) * 10; x < X0 + W; x += 10) grille += `<line y1="${Y0}" y2="${Y0 + H}" x1="${x}" x2="${x}" stroke="${x % 50 ? "#0003" : "#00f8"}" stroke-width="${0.6 / K * 2}"/>` + (x % 50 ? "" : `<text y="${Y0 + 12 / K}" x="${x + 1}" font-size="${12 / K}" fill="#00f">${x}</text>`);
  grille += `<text x="${X0 + 2}" y="${Y0 + H - 3}" font-size="${14 / K}">${corps[i].replace("gabarit-dos-", "")}</text></svg>`;
  comps.push({ input: await sharp({ create: { width: W * K, height: H * K, channels: 4, background: "#fafaf5" } }).png().toBuffer(), left: i * W * K, top: 0 });
  for (const s of couches) {
    const crop = s.replace(/viewBox="[^"]*"/, `viewBox="${X0} ${Y0} ${W} ${H}"`).replace(/width="[^"]*px"/, `width="${W * K}px"`).replace(/height="[^"]*px"/, `height="${H * K}px"`);
    comps.push({ input: await sharp(Buffer.from(crop)).resize(W * K, H * K, { fit: "fill" }).png().toBuffer(), left: i * W * K, top: 0 });
  }
  comps.push({ input: Buffer.from(grille), left: i * W * K, top: 0 });
}
await sharp({ create: { width: corps.length * W * K, height: H * K, channels: 3, background: "#fff" } }).composite(comps).jpeg({ quality: 82 }).toFile(sortie);
console.log("ok");
