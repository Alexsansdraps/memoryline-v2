// Vérification avec les fonctions pures du moteur (lecture seule) : zones extraites, normalisation sans
// zone créée, et familles de teinte telles que le configurateur les proposera au client.
import { readFileSync } from "node:fs";
import { extractColorZones, normaliserCouleursSvg, famillesDeLaPiece } from "/app/packages/types/src/index.ts";

const D = "/tmp/gr-accessoires/";
const index = JSON.parse(readFileSync(D + "index.json", "utf8"));
const surfaces = JSON.parse(readFileSync(D + "surfaces.json", "utf8"));
let ko = 0;
for (const p of index.pieces) {
  const svg = readFileSync(D + "svg/" + p.fichier, "utf8");
  const z = extractColorZones(svg);
  const attendu: Record<string, string> = {};
  for (const [k, v] of Object.entries<any>(p.zones)) attendu[k] = v.couleur;
  const erreurs: string[] = [];
  if (JSON.stringify(Object.entries(z).sort()) !== JSON.stringify(Object.entries(attendu).sort())) erreurs.push(`zones ${JSON.stringify(z)} ≠ ${JSON.stringify(attendu)}`);
  if ("st1" in z) erreurs.push("st1 est une zone");
  const n = normaliserCouleursSvg(svg);
  if (n.zonesCreees.length) erreurs.push(`zones créées ${n.zonesCreees}`);
  if (n.modifie) erreurs.push("la normalisation réécrit le SVG");
  // familles : chaque zone non nuance commence une rangée, ses nuances la suivent
  const s = surfaces[p.fichier];
  const tot = Object.values<number>(s).reduce((a, b) => a + b, 0);
  const parts = Object.fromEntries(Object.entries<number>(s).map(([k, v]) => [k, v / tot]));
  const familles = famillesDeLaPiece({ colorZones: z, partsDesZones: parts });
  const obtenu = familles.map((g) => [g.zone, ...(g.nuances ?? [])].sort().join("+")).sort();
  const voulu = Object.entries<any>(p.zones).filter(([, v]) => v.role !== "nuance")
    .map(([k]) => [k, ...Object.entries<any>(p.zones).filter(([, v]) => v.de === k).map(([kk]) => kk)].sort().join("+")).sort();
  if (JSON.stringify(obtenu) !== JSON.stringify(voulu)) erreurs.push(`familles ${obtenu.join(" | ")} ≠ attendu ${voulu.join(" | ")}`);
  if (familles[0]?.zone !== "st0") erreurs.push(`rangée principale ${familles[0]?.zone}`);
  if (erreurs.length) { ko++; console.log(p.fichier, "\n   " + erreurs.join("\n   ")); }
}
console.log(`${index.pieces.length - ko}/${index.pieces.length} pièces conformes au moteur`);
