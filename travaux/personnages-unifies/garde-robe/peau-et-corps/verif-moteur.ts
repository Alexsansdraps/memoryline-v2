import fs from "node:fs";
import { extractColorZones, normaliserCouleursSvg, groupesProposesDeLaBase, couleursDuGroupe } from "/app/packages/types/src/index.ts";
// Lancer après gen.mjs, depuis /tmp/gr-peau-et-corps (ou la copie de relecture) :
// docker exec -w /app/packages/types memoryline-api /app/apps/api/node_modules/.bin/tsx <dossier>/verif-moteur.ts
const D = process.env.DOSSIER ?? "/tmp/gr-peau-et-corps";
const index = JSON.parse(fs.readFileSync(`${D}/out/index.json`, "utf8"));
let echecs = 0;
for (const g of index.gabarits) {
  const chemin = fs.existsSync(`${D}/out/svg/${g.fichier}`) ? `${D}/out/svg/${g.fichier}` : `${D}/ref/${g.fichier}`;
  const svg = fs.readFileSync(chemin, "utf8");
  const zones = extractColorZones(svg);
  const n = normaliserCouleursSvg(svg) as any;
  const memes = JSON.stringify(zones) === JSON.stringify(g.base_color_zones);
  const groupes = groupesProposesDeLaBase({ baseColorZones: zones, baseGroupesCouleurs: g.base_groupes_couleurs_conseilles ?? null, baseZonesProposees: g.base_zones_proposees_conseillees ?? null });
  const essais = ["#FFEEE0", "#8B5B38", "#C87446"].map((c) => groupes.map((gr) => couleursDuGroupe(gr, zones, gr.couleurs?.[1] ?? c)));
  const ok = memes && (n.zonesCreees ?? []).length === 0 && !("st1" in zones) && groupes.length >= 1 && groupes[0].zone === "st0";
  if (!ok) echecs++;
  console.log(g.fichier.padEnd(36), Object.keys(zones).join(","), "créées", (n.zonesCreees ?? []).length, "proposées", groupes.map((x) => `${x.zone}${x.nuances ? "+" + x.nuances : ""}${x.nom ? " " + x.nom : ""}`).join(" | "), ok ? "ok" : "ECHEC", g.famille === "cheval" ? JSON.stringify(essais[0]) : "");
}
process.exit(echecs ? 1 : 0);
