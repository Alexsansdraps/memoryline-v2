// Coup d'oeil : chaque gabarit nu, recadré sur le bassin, avec le bas d'origine posé tel quel.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const sharp = createRequire("/app/apps/api/package.json")("sharp");
const D = new URL(".", import.meta.url).pathname;
const FAM = {
  femme: { src: "Female_2", bas: "Female_Bottoms_2", g: ["standard", "fine", "ronde", "agee"], y: [640, 890] },
  homme: { src: "Male_2", bas: "Male_Bottoms_2", g: ["standard", "mince", "rond", "age"], y: [620, 880] },
  enfant: { src: "Boys_2", bas: "Boy_Bottoms_2", g: ["standard", "fin", "rond"], y: [600, 790] },
  ado: { src: "Teenage_Boys_1", bas: "Teenage_Boy_Bottoms_1", g: ["standard", "fin"], y: [620, 830] },
};
const fam = process.argv[2];
const F = FAM[fam];
const orig = readFileSync(D + "orig/" + F.src + ".svg", "utf8");
const style = orig.match(/<style[\s\S]*?<\/style>/)[0];
const grp = orig.match(new RegExp(`<g id="${F.bas}">[\\s\\S]*?</g>`))[0];
const S = 2, [y0, y1] = F.y, H = (y1 - y0) * S;
const tiles = [];
for (const [i, g] of F.g.entries()) {
  const body = readFileSync(D + "ref/gabarit-dos-" + fam + "-" + g + ".svg", "utf8");
  const corps = body.match(/<g[\s\S]*<\/g>/)[0].replace(/class="st0"/g, 'fill="#E08A50"').replace(/class="st1"/g, 'opacity="0.15"');
  const bas = process.argv[3] === "nu" ? "" : grp.replace(/class="st1"/g, 'opacity="0.15"').replace(/class="st2"/g, 'fill="#13266D" opacity="0.75"').replace(/class="st3"/g, 'fill="#0C1B4C" opacity="0.75"');
  let grille = "";
  for (let x = 0; x <= 500; x += 10) grille += `<line x1="${x}" y1="0" x2="${x}" y2="1000" stroke="${x % 50 ? "#ddd" : "#88f"}" stroke-width="0.4"/>`;
  for (let y = 0; y <= 1000; y += 10) grille += `<line x1="0" y1="${y}" x2="500" y2="${y}" stroke="${y % 50 ? "#ddd" : "#88f"}" stroke-width="0.4"/>`;
  let txt = "";
  for (let y = Math.ceil(y0 / 50) * 50; y < y1; y += 50) txt += `<text x="2" y="${y - 1}" font-size="7" fill="#00a">${y}</text>`;
  for (let x = 50; x < 500; x += 50) txt += `<text x="${x + 1}" y="${y0 + 8}" font-size="7" fill="#00a">${x}</text>`;
  txt += `<text x="380" y="${y1 - 4}" font-size="10">${g}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${500 * S}" height="${H}" viewBox="0 ${y0} 500 ${y1 - y0}"><rect x="0" y="0" width="500" height="1000" fill="#fff"/>${grille}${corps}${bas}${txt}</svg>`;
  tiles.push({ input: await sharp(Buffer.from(svg)).png().toBuffer(), left: 0, top: i * H });
}
await sharp({ create: { width: 500 * S, height: H * F.g.length, channels: 3, background: "#fff" } }).composite(tiles).jpeg({ quality: 80 }).toFile(D + "out/vue-" + fam + ".jpg");
console.log("ok");
