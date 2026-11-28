// Vérification par les fonctions pures du moteur (aucune écriture).
// MSYS_NO_PATHCONV=1 docker exec -w /app/packages/types memoryline-api /app/apps/api/node_modules/.bin/tsx /tmp/gr-peau-et-corps/verif.ts
import fs from "node:fs";
import { extractColorZones, normaliserCouleursSvg } from "/app/packages/types/src/index.ts";

const attendu: Record<string, string> = {
  "gabarit-dos-cheval-debout.svg": "st0,st2,st3",
  "gabarit-dos-lapin.svg": "st0,st2",
};
const fichiers = [
  ...fs.readdirSync("/tmp/gr-peau-et-corps/ref").filter((f) => f !== "gabarit-dos-cheval.svg" && !f.includes("-standard.")).map((f) => `/tmp/gr-peau-et-corps/ref/${f}`),
  ...fs.readdirSync("/tmp/gr-peau-et-corps/out/svg").map((f) => `/tmp/gr-peau-et-corps/out/svg/${f}`),
];
let echecs = 0;
for (const chemin of fichiers) {
  const nom = chemin.split("/").pop()!;
  const svg = fs.readFileSync(chemin, "utf8");
  const zones = Object.keys(extractColorZones(svg)).sort().join(",");
  const n = normaliserCouleursSvg(svg) as unknown as { zonesCreees?: unknown[] };
  const ok = zones === (attendu[nom] ?? "st0") && (n.zonesCreees ?? []).length === 0;
  if (!ok) echecs++;
  console.log(nom.padEnd(36), zones.padEnd(12), "zonesCreees", (n.zonesCreees ?? []).length, ok ? "ok" : "ECHEC");
}
process.exit(echecs ? 1 : 0);
