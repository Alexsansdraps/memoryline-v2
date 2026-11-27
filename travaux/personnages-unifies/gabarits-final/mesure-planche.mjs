// Gabarits de dos (27/11) : mesure des points d'accroche et planche de contrôle.
// Alexandra : « et pas de calage sur les nouveaux ». Lancé par stdin dans le conteneur de l'API.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const require = createRequire("/app/apps/api/package.json");
const sharp = require("sharp");
const A = "/app/data/assets/";
const defs = JSON.parse(readFileSync("/tmp/gab-defs.json", "utf8"));
// 27/11 : les corps « standard » (doublons des actuels, retirés de data/assets) sont lus dans /tmp/gab-ref.
const chemin = (d) => (d.reference ? "/tmp/gab-ref/" : A) + d.fichier;
const neufs = defs.filter((d) => !d.reference);

async function masque(svg) {
  const { data, info } = await sharp(Buffer.from(svg), { density: 72 })
    .resize(500, 1000, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, larg = [];
  let haut = -1, bas = -1;
  for (let y = 0; y < H; y++) {
    let g = -1, d = -1;
    for (let x = 0; x < W; x++) if (data[(y * W + x) * 4 + 3] > 128) { if (g < 0) g = x; d = x + 1; }
    larg.push(g < 0 ? null : [g, d]);
    if (g >= 0) { if (haut < 0) haut = y; bas = y + 1; }
  }
  return { larg, haut, bas };
}
const w = (m, y) => (m.larg[y] ? m.larg[y][1] - m.larg[y][0] : 0);
function groupeBbox(m) { return m.haut < 0 ? null : { haut: m.haut, bas: m.bas }; }

const res = [];
for (const d of defs) {
  const m = await masque(readFileSync(chemin(d), "utf8"));
  let teteY = m.haut, teteW = 0;
  for (let y = m.haut; y < m.haut + 170; y++) if (w(m, y) > teteW) { teteW = w(m, y); teteY = y; }
  let couY = teteY, couW = 9999;
  for (let y = teteY; y < teteY + 150; y++) if (w(m, y) > 0 && w(m, y) < couW) { couW = w(m, y); couY = y; }
  // naissance des épaules : première ligne sous le cou plus large que 1,6 × le cou
  let epY = couY;
  while (epY < m.bas && w(m, epY) < couW * 1.6) epY++;
  const lignes = {};
  for (let y = 0; y < 1000; y += 10) if (m.larg[y]) lignes[y] = m.larg[y];
  // pièces de la source (si dessin habillé) : leurs bornes verticales
  let pieces = null;
  if (d.source && d.groupeSource && /Base/.test(d.groupeSource) && d.groupeSource !== "Base" && !/Cat|Dog/.test(d.groupeSource)) {
    pieces = {};
    const src = readFileSync(A + d.source, "utf8");
    for (const [k, re] of [["coiffure", /Hair/], ["haut", /Clothes/], ["bas", /Bottoms?/], ["accessoire", /Accessor/]]) {
      const svg = src.replace(/<g\b([^>]*?)\sid="([^"]*)"([^>]*)>/g, (mm, a, id, b) => (re.test(id) ? mm : `<g${a} id="${id}"${b} display="none">`));
      const pm = await masque(svg);
      pieces[k] = groupeBbox(pm);
    }
  }
  res.push({ d, m: { haut: m.haut, bas: m.bas, teteY, teteW, tete: m.larg[teteY], couY, couW, cou: m.larg[couY], epY, ep: m.larg[epY], lignes }, pieces });
  console.log(`${d.fichier} | haut ${m.haut} bas ${m.bas} (somme ${m.haut + m.bas}) | tete y${teteY} ${m.larg[teteY]} | cou y${couY} ${m.larg[couY]} | epaules y${epY} ${m.larg[epY]} | mi ${m.larg[Math.round((m.haut + m.bas) / 2)]}`);
}
writeFileSync("/tmp/gab-mesures.json", JSON.stringify(res));

// ---------- planche ----------
// Ligne 1 : quatre personnages actuels (habillés) ; puis tous les gabarits nus ;
// dernière ligne : chaque gabarit standard / varié habillé des pièces de son dessin source,
// pour voir ce qu'une pièce dessinée sur la famille couvre.
const actuels = [["actuel 2 Homme 2", "Male_2.svg"], ["actuel 6 Femme 2", "Female_2.svg"], ["actuel 10 Garcon 2", "Boys_2.svg"], ["actuel 16 Ado garcon 1", "Teenage_Boys_1.svg"], ["actuel 28 Grand chien", "Big_Dog.svg"], ["actuel 22 Chat 1", "Cat_1.svg"], ["actuel 21 Chat (dos)", "chat_dos_2.svg"], ["actuel 32 Petit chien", "Small_Dog.svg"]];
const cw = 150, ch = 300, cols = 8;
const cases = [...actuels.map(([l, f]) => [l, readFileSync(A + f, "utf8")]), ...neufs.map((d) => [d.fichier.replace("gabarit-dos-", "").replace(".svg", ""), readFileSync(A + d.fichier, "utf8")])];
// essayage : groupes Hair/Clothes/Bottoms de la source posés sur chaque gabarit humain
for (const d of neufs) {
  if (!d.groupeSource || !/Male_|Female_|Boy_/.test(d.groupeSource)) continue;
  const src = readFileSync(A + d.source, "utf8");
  // pièces dans un SVG à part, posé par-dessus (classes de la source)
  const pieceSvg = src.replace(/<g\b([^>]*?)\sid="([^"]*)"([^>]*)>/g, (mm, a, id, b) => (/Base|Accessor/.test(id) ? `<g${a} id="${id}"${b} display="none">` : mm));
  cases.push(["essai " + d.fichier.replace("gabarit-dos-", "").replace(".svg", ""), readFileSync(A + d.fichier, "utf8"), pieceSvg]);
}
const rows = Math.ceil(cases.length / cols);
const comps = [];
for (let i = 0; i < cases.length; i++) {
  const [label, svg, dessus] = cases[i];
  const x = (i % cols) * cw, y = Math.floor(i / cols) * (ch + 18);
  let lignes = "";
  for (let k = 1; k < 10; k++) { const yy = (k / 10) * ch; lignes += `<line x1="0" x2="${cw}" y1="${yy}" y2="${yy}" stroke="${k === 5 ? "#c00" : "#ccc"}" stroke-width="${k === 5 ? 1 : 0.5}"/>`; }
  lignes += `<line y1="0" y2="${ch}" x1="${cw / 2}" x2="${cw / 2}" stroke="#ccc" stroke-width="0.5"/>`;
  comps.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch + 18}"><rect width="${cw}" height="${ch}" fill="#fafaf5" stroke="#999"/>${lignes}<text x="3" y="${ch + 13}" font-size="10" font-family="sans-serif">${label}</text></svg>`), left: x, top: y });
  for (const s of [svg, dessus].filter(Boolean)) {
    const buf = await sharp(Buffer.from(s), { density: 72 }).resize(cw, ch, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    comps.push({ input: buf, left: x, top: y });
  }
}
await sharp({ create: { width: cols * cw, height: rows * (ch + 18), channels: 3, background: "#ffffff" } }).composite(comps).jpeg({ quality: 82 }).toFile("/tmp/planche-gabarits.jpg");
// gros plans des têtes et épaules (cou, voûte) des adultes
const zoomCases = neufs.filter((d) => /femme|homme/.test(d.famille));
const zc = [];
for (let i = 0; i < zoomCases.length; i++) {
  const buf = await sharp(readFileSync(A + zoomCases[i].fichier), { density: 144 }).extract({ left: 0, top: 200, width: 1000, height: 1000 }).resize(300, 300).png().toBuffer();
  zc.push({ input: buf, left: (i % 4) * 300, top: Math.floor(i / 4) * 300 });
}
await sharp({ create: { width: 1200, height: 600, channels: 3, background: "#fafaf5" } }).composite(zc).jpeg({ quality: 82 }).toFile("/tmp/zoom-adultes.jpg");
console.log("ok");
