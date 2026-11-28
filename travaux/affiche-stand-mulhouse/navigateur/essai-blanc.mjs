// Essai : à quoi ressemble un motif « en blanc » sur un fond sombre, selon la
// façon de le recolorer (même recolorSvg que le module et pdf.ts : une
// expression régulière sur .stN{fill:#…}). Rendu par le sharp de l'API.
// docker exec memoryline-api node /app/travaux/affiche-stand-mulhouse/navigateur/essai-blanc.mjs
import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";

const require = createRequire("/app/apps/api/package.json");
const sharp = require("sharp");

const T = "/app/travaux/affiche-stand-mulhouse";
const recolor = (svg, o) => {
  let out = svg;
  for (const [z, c] of Object.entries(o)) {
    if (!/^#[0-9a-fA-F]{3,8}$/.test(c)) continue;
    out = out.replace(new RegExp(`(\\.${z}\\s*\\{[^}]*?fill\\s*:\\s*)#[0-9a-fA-F]{3,8}`, "g"), `$1${c}`);
  }
  return out;
};
const index = JSON.parse(readFileSync(`${T}/motifs/index.json`, "utf8"));
const motifs = ["hotel-de-ville", "sapin", "maisons-alsaciennes", "bretzel", "couronne-avent"];
const fonds = ["uni-bleu-nuit", "uni-vert-sapin", "uni-rouge-noel"];
const modes = {
  defaut: () => ({}),
  w1: () => ({ st0: "#FFFFFF" }),
  w2: (e) => {
    const o = { st0: "#FFFFFF" };
    for (const [z, c] of Object.entries(e.zones)) if (z !== "st0" && c.toUpperCase() === "#FFF8EC") o[z] = "#FFF8EC00";
    return o;
  },
};
mkdirSync("/tmp/stand-mulhouse-essai", { recursive: true });
const tuiles = [];
const C = 220;
for (const f of fonds) {
  for (const id of motifs) {
    const e = index.find((x) => x.id === id);
    const brut = readFileSync(`${T}/motifs/${e.fichier}`, "utf8");
    for (const [nom, mode] of Object.entries(modes)) {
      const svg = recolor(brut, mode(e));
      const png = await sharp(Buffer.from(svg), { density: 150 }).resize({ width: 190, height: 190, fit: "inside" }).png().toBuffer();
      const fond = await sharp(readFileSync(`${T}/fonds/fond-noel-${f}-v1.svg`), { density: 72 })
        .resize({ width: C, height: C, fit: "cover" })
        .composite([{ input: png, gravity: "centre" }])
        .png()
        .toBuffer();
      tuiles.push(fond);
    }
  }
}
const cols = motifs.length * 3;
const rows = fonds.length;
const planche = sharp({ create: { width: cols * C, height: rows * C, channels: 3, background: "#ffffff" } }).composite(
  tuiles.map((input, i) => ({ input, left: (i % cols) * C, top: Math.floor(i / cols) * C })),
);
await planche.png().toFile(`${T}/captures/_essai-motif-blanc.png`);
console.log("ok");
