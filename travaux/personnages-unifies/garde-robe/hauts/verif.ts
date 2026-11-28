// Vérification des hauts avec les fonctions pures du moteur (lecture seule, rien n'est écrit).
// Lancement : docker exec -w /app/packages/types memoryline-api /app/apps/api/node_modules/.bin/tsx /tmp/gr-hauts/verif.ts
//  - extractColorZones : exactement les zones de l'index, sans st1 ;
//  - normaliserCouleursSvg : aucune zone créée (pas de fill hors du <style>) ;
//  - famillesDeLaPiece (avec les parts mesurées comme le fait l'API, témoins de
//    couleur et rendu net) : chaque nuance suit sa référence, chaque partie ou
//    détail a sa rangée, la principale est la plus étendue, 3 rangées au plus.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { extractColorZones, normaliserCouleursSvg, recolorSvg, famillesDeLaPiece } from "/app/packages/types/src/index.ts";

const sharp = createRequire("/app/apps/api/package.json")("sharp");

/** Même mesure que pixelsParZone (apps/api/src/couleurs-dessins.ts), recopiée ici. */
async function parts(svg: string, zones: Record<string, string>) {
  const ids = Object.keys(zones);
  const temoins: Record<string, string> = {};
  const zoneDuTemoin = new Map<number, string>();
  ids.forEach((z, i) => {
    const code = 0x10_20_30 + (i + 1) * 0x01_07_0b;
    temoins[z] = `#${(code & 0xffffff).toString(16).padStart(6, "0")}`;
    zoneDuTemoin.set(code & 0xffffff, z);
  });
  const temoin = recolorSvg(svg, temoins).replace(/<svg\b/i, '<svg shape-rendering="crispEdges"');
  const { data, info } = await sharp(Buffer.from(temoin), { density: 36 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = new Map<string, number>();
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] < 250) continue;
    const z = zoneDuTemoin.get((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    if (z) n.set(z, (n.get(z) ?? 0) + 1);
  }
  const total = [...n.values()].reduce((s, v) => s + v, 0);
  return Object.fromEntries(ids.map((z) => [z, total ? Math.round(((n.get(z) ?? 0) / total) * 1000) / 1000 : 0]));
}

async function verifier() {
const index = JSON.parse(readFileSync("/tmp/gr-hauts/out/index.json", "utf8"));
let ko = 0;
for (const p of index.pieces) {
  const svg = readFileSync("/tmp/gr-hauts/out/svg/" + p.fichier, "utf8");
  const z = extractColorZones(svg);
  const pb: string[] = [];
  if (Object.keys(z).sort().join() !== Object.keys(p.zones).sort().join()) pb.push(`zones ${Object.keys(z)} ≠ ${Object.keys(p.zones)}`);
  if ("st1" in z) pb.push("st1 vue comme une zone");
  for (const [c, d] of Object.entries<any>(p.zones)) if (z[c] !== d.couleur) pb.push(`${c} ${z[c]} ≠ ${d.couleur}`);
  const n = normaliserCouleursSvg(svg);
  if (n.zonesCreees.length) pb.push("zones créées " + n.zonesCreees.join());
  const pz = await parts(svg, z);
  const fam = famillesDeLaPiece({ colorZones: z, partsDesZones: pz });
  const familleDe = (c: string) => fam.find((f) => f.zone === c || (f.nuances ?? []).includes(c));
  for (const [c, d] of Object.entries<any>(p.zones)) {
    const f = familleDe(c);
    if (d.role === "nuance") { if (!f || f.zone !== d.de) pb.push(`nuance ${c} ne suit pas ${d.de}`); }
    else if (!f || f.zone !== c) pb.push(`${d.role} ${c} n'a pas sa rangée (suit ${f?.zone})`);
  }
  if (fam[0]?.zone !== "st0") pb.push("la principale n'est pas st0 : " + fam[0]?.zone);
  if (fam.length > 3) pb.push(fam.length + " rangées");
  if (pb.length) ko++;
  console.log((pb.length ? "KO " : "ok ") + p.fichier.padEnd(48) + " rangées " + fam.map((f) => f.zone + (f.nuances?.length ? "+" + f.nuances.join("+") : "")).join(" | ") + "  parts " + JSON.stringify(pz) + (pb.length ? "  → " + pb.join("; ") : ""));
}
console.log(ko ? ko + " pièce(s) en défaut" : "tout est conforme");
}
verifier();
