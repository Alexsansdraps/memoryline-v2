// Planche de contrôle : toutes les ombres chinoises existantes du ciel étoilé, avec leur id,
// pour comparer les nouvelles planches d'Alexandra (28/11) et ne prendre que ce qui manque.
// Lancer depuis apps/api :  DATABASE_URL=postgres://e:e@127.0.0.1:1/e npx tsx ../../travaux/ombres/planche-existantes.mts
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const racine = resolve(process.cwd(), "..", "..");
const { OMBRES_2 } = await import(pathToFileURL(resolve(racine, "apps/api/src/ciel-ombres-2.ts")).href);
const { OMBRES } = await import(pathToFileURL(resolve(racine, "apps/api/src/ciel-ombres.ts")).href);
const { createRequire } = await import("node:module");
const sharp = createRequire(resolve(racine, "apps/api/package.json"))("sharp");
const toutes = [
  ...OMBRES_2.map((o: any) => ({ ...o, lot: o.groupe })),
  ...OMBRES.map((o: any) => ({ ...o, lot: "ancienne (plus proposée)" })),
];
const COL = 6, CW = 300, CH = 300, LEG = 46;
const lignes = Math.ceil(toutes.length / COL);
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${COL * CW}" height="${lignes * (CH + LEG)}"><rect width="100%" height="100%" fill="#fff"/>`;
toutes.forEach((o: any, i: number) => {
  const x = (i % COL) * CW, y = Math.floor(i / COL) * (CH + LEG);
  const larg = o.droite - o.gauche, haut = -o.haut;
  const s = Math.min((CW - 30) / larg, (CH - 30) / haut);
  const tx = x + CW / 2 - ((o.gauche + o.droite) / 2) * s;
  const ty = y + CH - 12;
  svg += `<rect x="${x + 2}" y="${y + 2}" width="${CW - 4}" height="${CH + LEG - 4}" fill="none" stroke="#ddd"/>`;
  svg += `<path transform="translate(${tx.toFixed(1)} ${ty.toFixed(1)}) scale(${s.toFixed(4)})" d="${o.d}" fill="#1d1d1d"/>`;
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  svg += `<text x="${x + 8}" y="${y + CH + 16}" font-family="Arial" font-size="15" font-weight="bold">${esc(o.id)}</text>`;
  svg += `<text x="${x + 8}" y="${y + CH + 36}" font-family="Arial" font-size="13" fill="#555">${esc(o.nom)} · ${esc(o.lot)}</text>`;
});
svg += "</svg>";
await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toFile(resolve(racine, "travaux/ombres/planche-ombres-existantes.jpg"));
writeFileSync(resolve(racine, "travaux/ombres/ombres-existantes.json"), JSON.stringify(toutes.map((o: any) => ({ id: o.id, nom: o.nom, lot: o.lot, largeurCm: Math.round(o.droite - o.gauche), hauteurCm: Math.round(-o.haut) })), null, 2));
console.log(toutes.length, "ombres");
process.exit(0);
