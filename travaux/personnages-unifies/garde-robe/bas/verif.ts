// Contrôle des zones de couleur avec les fonctions pures du moteur (aucune écriture).
import { readFileSync, readdirSync } from "node:fs";
import { extractColorZones, normaliserCouleursSvg, famillesDeLaPiece } from "/app/packages/types/src/index.ts";
const D = new URL(".", import.meta.url).pathname;
const index = JSON.parse(readFileSync(D + "index.json", "utf8"));
const parts = JSON.parse(readFileSync(D + "parts.json", "utf8"));
let erreurs = 0;
for (const p of index.pieces) {
  const svg = readFileSync(D + "svg/" + p.fichier, "utf8");
  const z = extractColorZones(svg);
  const attendues = Object.keys(p.zones).sort().join(",");
  const lues = Object.keys(z).sort().join(",");
  const n = normaliserCouleursSvg(svg);
  const declarees = [...svg.matchAll(/\.(st\d+)\{/g)].map((m) => m[1]).sort();
  const utilisees = [...new Set([...svg.matchAll(/class="(st\d+)"/g)].map((m) => m[1]))].sort();
  const pb: string[] = [];
  if (attendues !== lues) pb.push(`zones ${lues} au lieu de ${attendues}`);
  if (z.st1) pb.push("st1 est une zone");
  if (n.zonesCreees.length) pb.push("zones créées " + n.zonesCreees.join(","));
  if (declarees.join() !== utilisees.join()) pb.push(`classes déclarées ${declarees} / utilisées ${utilisees}`);
  for (const k of Object.keys(p.zones)) if (z[k] !== p.zones[k].couleur) pb.push(`${k} ${z[k]} au lieu de ${p.zones[k].couleur}`);
  if (/\sfill=|stroke|transform|<defs|<use|<image|<text|opacity=/.test(svg.replace(/<style[\s\S]*?<\/style>/, ""))) pb.push("attribut interdit");
  // familles de teinte telles que le client les formera : chaque nuance doit suivre sa référence
  const fam = famillesDeLaPiece({ colorZones: z, partsDesZones: parts[p.fichier] } as any);
  const grp = fam.map((g: any) => [g.zone, ...(g.nuances || [])].join("+")).join(" | ");
  for (const [k, info] of Object.entries<any>(p.zones)) {
    if (info.role === "nuance" && !fam.some((g: any) => g.zone === info.de && (g.nuances || []).includes(k))) pb.push(`${k} ne suit pas ${info.de}`);
    if (info.role === "partie" && !fam.some((g: any) => g.zone === k)) pb.push(`partie ${k} absorbée`);
  }
  const rangees = fam.length;
  if (rangees > 3) pb.push(rangees + " rangées");
  if (pb.length) erreurs++;
  console.log(p.fichier.padEnd(48), pb.length ? "ECHEC " + pb.join(" ; ") : "ok", " rangées:", grp, JSON.stringify(parts[p.fichier]));
}
console.log(erreurs ? erreurs + " en échec" : "tout est conforme");
