// Relevé du 27/11 (lecture seule) : planches de contrôle des dessins de dos.
// Lancé par stdin dans le conteneur de l'API ; écrit dans /tmp/releve-*.jpg.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire("/app/apps/api/package.json");
const sharp = require("sharp");
const A = "/app/data/assets/";
const jobs = JSON.parse(process.env.JOBS);

async function planche(nom, fichiers, cols, cw, ch) {
  const rows = Math.ceil(fichiers.length / cols);
  const W = cols * cw, H = rows * (ch + 18);
  const comps = [];
  for (let i = 0; i < fichiers.length; i++) {
    const [label, f] = fichiers[i];
    const x = (i % cols) * cw, y = Math.floor(i / cols) * (ch + 18);
    let buf;
    try {
      buf = await sharp(readFileSync(A + f), { density: 72, unlimited: true })
        .resize(cw, ch, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png().toBuffer();
    } catch (e) { buf = null; }
    // repères : lignes tous les 10 % de la hauteur du cadre, plus fortes à 50 %
    let lignes = "";
    for (let k = 1; k < 10; k++) {
      const yy = (k / 10) * ch;
      lignes += `<line x1="0" x2="${cw}" y1="${yy}" y2="${yy}" stroke="${k === 5 ? "#c00" : "#bbb"}" stroke-width="${k === 5 ? 1 : 0.5}"/>`;
    }
    lignes += `<line y1="0" y2="${ch}" x1="${cw / 2}" x2="${cw / 2}" stroke="#bbb" stroke-width="0.5"/>`;
    const fond = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch + 18}"><rect width="${cw}" height="${ch}" fill="#fafaf5" stroke="#999"/>${lignes}<text x="4" y="${ch + 13}" font-size="11" font-family="sans-serif">${label}</text></svg>`);
    comps.push({ input: fond, left: x, top: y });
    if (buf) comps.push({ input: buf, left: x, top: y });
  }
  await sharp({ create: { width: W, height: H, channels: 3, background: "#ffffff" } })
    .composite(comps).jpeg({ quality: 80 }).toFile(`/tmp/releve-${nom}.jpg`);
  console.log(nom, W, H);
}
for (const j of jobs) await planche(j.nom, j.fichiers, j.cols, j.cw, j.ch);
