// Vérification des SVG de coiffures avec les fonctions PURES du moteur (aucune écriture, aucune route).
// Lancement : MSYS_NO_PATHCONV=1 docker exec -w /app/packages/types memoryline-api /app/apps/api/node_modules/.bin/tsx /tmp/gr-coiffures/verif.ts
import { readFileSync } from "node:fs";
import { extractColorZones, normaliserCouleursSvg, famillesDeLaPiece } from "/app/packages/types/src/index.ts";

const D = "/tmp/gr-coiffures";
const index = JSON.parse(readFileSync(`${D}/index.json`, "utf8"));
const parts = JSON.parse(readFileSync(`${D}/parts.json`, "utf8"));
const erreurs: string[] = [];
const positions = new Set<number>();
for (const p of index.pieces) {
  const svg = readFileSync(`${D}/svg/${p.fichier}`, "utf8");
  const z = extractColorZones(svg);
  const attendues = Object.fromEntries(Object.entries(p.zones as Record<string, { couleur: string }>).map(([k, v]) => [k, v.couleur]));
  if (JSON.stringify(Object.entries(z).sort()) !== JSON.stringify(Object.entries(attendues).sort())) erreurs.push(`${p.fichier} : zones ${JSON.stringify(z)}`);
  if ("st1" in z) erreurs.push(`${p.fichier} : st1 lue comme zone`);
  const n = normaliserCouleursSvg(svg);
  if (n.zonesCreees.length) erreurs.push(`${p.fichier} : zones créées ${n.zonesCreees}`);
  if (n.modifie) erreurs.push(`${p.fichier} : la normalisation réécrit le SVG`);
  // rangées vues par le client : la nuance suit les cheveux, la partie est à part
  const rangees = famillesDeLaPiece({ colorZones: z, partsDesZones: parts[p.fichier] });
  const cheveux = rangees.find((r) => r.zone === "st0" || r.nuances?.includes("st0"));
  if (!cheveux || cheveux.zone !== "st0") erreurs.push(`${p.fichier} : st0 n'est pas la tête de sa rangée`);
  for (const [k, v] of Object.entries(p.zones as Record<string, { role: string }>)) {
    const r = rangees.find((x) => x.zone === k || x.nuances?.includes(k));
    if (v.role === "nuance" && r !== cheveux) erreurs.push(`${p.fichier} : ${k} ne suit pas st0`);
    if (v.role === "partie" && r?.zone !== k) erreurs.push(`${p.fichier} : ${k} n'a pas sa rangée`);
  }
  if (rangees.length > 3) erreurs.push(`${p.fichier} : ${rangees.length} rangées`);
  if (positions.has(p.position_proposee)) erreurs.push(`${p.fichier} : position en double`);
  positions.add(p.position_proposee);
}
console.log(`${index.pieces.length} pièces vérifiées`);
console.log(erreurs.length ? erreurs.join("\n") : "tout est conforme");
