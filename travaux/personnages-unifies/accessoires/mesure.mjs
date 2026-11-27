// Accessoires sur gabarits (27/11) : mesure des corps de chaque famille, ligne par ligne,
// pour dessiner des pièces qui tombent juste sans calage (Alexandra : « et pas de calage sur les nouveaux »).
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const require = createRequire("/app/apps/api/package.json");
const sharp = require("sharp");
const A = "/app/data/assets/";
const familles = {
  femme: { corps: ["gabarit-dos-femme-fine.svg", "gabarit-dos-femme-ronde.svg", "gabarit-dos-femme-agee.svg"], ref: "Female_2.svg" },
  homme: { corps: ["gabarit-dos-homme-mince.svg", "gabarit-dos-homme-rond.svg", "gabarit-dos-homme-age.svg"], ref: "Male_2.svg" },
  enfant: { corps: ["gabarit-dos-enfant-fin.svg", "gabarit-dos-enfant-rond.svg"], ref: "Boys_2.svg" },
  ado: { corps: ["gabarit-dos-ado-fin.svg"], ref: "Teenage_Boys_1.svg" },
  cheval: { corps: ["gabarit-dos-cheval.svg"] },
  lapin: { corps: ["gabarit-dos-lapin.svg"] },
};
async function masque(svg) {
  const { data, info } = await sharp(Buffer.from(svg), { density: 72 })
    .resize(500, 1000, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const L = [];
  for (let y = 0; y < 1000; y++) {
    let g = -1, d = -1;
    for (let x = 0; x < 500; x++) if (data[(y * 500 + x) * 4 + 3] > 128) { if (g < 0) g = x; d = x + 1; }
    L.push(g < 0 ? null : [g, d]);
  }
  return L;
}
const seul = (svg, re) => svg.replace(/<g\b([^>]*?)\sid="([^"]*)"([^>]*)>/g, (mm, a, id, b) => (re.test(id) ? mm : `<g${a} id="${id}"${b} display="none">`));
const out = {};
for (const [f, def] of Object.entries(familles)) {
  const corps = {};
  for (const c of def.corps) corps[c] = await masque(readFileSync(A + c, "utf8"));
  let ref = null, cheveux = null;
  if (def.ref) {
    const src = readFileSync(A + def.ref, "utf8");
    ref = await masque(src);
    cheveux = await masque(seul(src, /Hair/));
  }
  out[f] = { corps, ref, cheveux };
  console.log("== " + f);
  for (let y = 100; y < 1000; y += 10) {
    const cols = Object.values(corps).map((m) => m[y] ? m[y].join("-") : "  .  ");
    const all = [...Object.values(corps), ...(ref ? [ref] : [])].map((m) => m[y]).filter(Boolean);
    if (!all.length) continue;
    const inter = [Math.max(...all.map((r) => r[0])), Math.min(...all.map((r) => r[1]))];
    console.log(y, "|", cols.join(" "), "| ref", ref && ref[y] ? ref[y].join("-") : ".", "| chev", cheveux && cheveux[y] ? cheveux[y].join("-") : ".", "| inter", inter.join("-"));
  }
}
writeFileSync("/tmp/acc-mesures.json", JSON.stringify(out));
