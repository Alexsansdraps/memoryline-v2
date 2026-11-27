// Gros plan de contrôle (27/11) : fichiers (chemins absolus du conteneur) recadrés.
// ENV F = JSON [chemin...], R = JSON [x, y, l, h] dans le cadre 500×1000, S = échelle, O = sortie
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire("/app/apps/api/package.json");
const sharp = require("sharp");
const f = JSON.parse(process.env.F);
const [rx, ry, rl, rh] = JSON.parse(process.env.R || "[0,0,500,1000]");
const s = +(process.env.S || 1);
const comps = [];
const W = Math.round(rl * s), H = Math.round(rh * s);
for (let i = 0; i < f.length; i++) {
  const couches = f[i].split("+");
  for (const c of couches) {
    const buf = await sharp(readFileSync(c), { density: 72 * s }).resize(Math.round(500 * s), Math.round(1000 * s), { fit: "fill" })
      .extract({ left: Math.round(rx * s), top: Math.round(ry * s), width: W, height: H }).png().toBuffer();
    comps.push({ input: buf, left: i * W, top: 0 });
  }
}
await sharp({ create: { width: f.length * W, height: H, channels: 3, background: "#fafaf5" } }).composite(comps).jpeg({ quality: 85 }).toFile(process.env.O || "/tmp/zoom2.jpg");
console.log("ok");
