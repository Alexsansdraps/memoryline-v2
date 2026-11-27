// Gros plan de contrôle (27/11) : quelques gabarits à grande taille.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire("/app/apps/api/package.json");
const sharp = require("sharp");
const A = "/app/data/assets/";
const f = JSON.parse(process.env.F);
const comps = [];
for (let i = 0; i < f.length; i++) {
  const buf = await sharp(readFileSync(A + f[i]), { density: 72 }).resize(300, 600).png().toBuffer();
  comps.push({ input: buf, left: i * 300, top: 0 });
}
await sharp({ create: { width: f.length * 300, height: 600, channels: 3, background: "#fafaf5" } }).composite(comps).jpeg({ quality: 85 }).toFile("/tmp/zoom.jpg");
