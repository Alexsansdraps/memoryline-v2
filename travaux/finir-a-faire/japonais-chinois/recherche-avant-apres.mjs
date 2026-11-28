// Recherche du site en japonais et chinois (28/11, « finis le à faire sauf la
// partie personnages ») : relevé des réponses de GET /products?q= dans les
// 7 langues, pour comparer avant et après le changement.
//
//   node recherche-avant-apres.mjs releve avant.json   (avant le changement)
//   node recherche-avant-apres.mjs releve apres.json   (après)
//   node recherche-avant-apres.mjs comparer avant.json apres.json
//
// Les saisies viennent des noms des affiches eux-mêmes (chaque mot, avec et
// sans accents, en capitales, des bouts de mots) et de quelques saisies
// pièges (%, _, antislash, une lettre). Le français, l'anglais, l'allemand,
// l'italien et l'espagnol doivent répondre EXACTEMENT pareil avant et après.
import fs from "node:fs";

const API = process.env.API ?? "http://localhost:3000";
const LANGUES = ["fr", "en", "de", "it", "es", "ja", "zh"];

async function noms() {
  // Toutes les affiches en vente, dans chaque langue (le nom affiché).
  const parLangue = {};
  for (const l of LANGUES) {
    const r = await fetch(`${API}/products?limit=1000${l === "fr" ? "" : `&lang=${l}`}`);
    parLangue[l] = (await r.json()).map((p) => p.name);
  }
  return parLangue;
}

function saisiesDe(noms) {
  const s = new Set();
  for (const nom of noms) {
    const court = nom.replace(/\s*[-–]\s*Affiche.*$/i, "");
    for (const mot of court.split(/[\s'’(),:]+/u)) {
      if ([...mot].length < 2) continue;
      s.add(mot);
      s.add(mot.toLowerCase());
      s.add(mot.normalize("NFD").replace(/[̀-ͯ]/g, ""));
      const lettres = [...mot];
      if (lettres.length > 4) s.add(lettres.slice(1, 4).join(""));
    }
    s.add(court);
  }
  for (const piege of ["50%", "_", "\\", "a", "é", "ee", "  ", "%%", "PARIS", "paris", "cathedrale", "Cathédrale", "noël", "noel", "xyzxyz"]) s.add(piege);
  return [...s].filter((q) => q.trim());
}

async function releve(sortie) {
  const n = await noms();
  const resultat = {};
  for (const l of LANGUES) {
    const saisies = saisiesDe(n[l]).slice(0, 600);
    resultat[l] = {};
    for (const q of saisies) {
      const p = new URLSearchParams({ limit: "1000", q });
      if (l !== "fr") p.set("lang", l);
      const r = await fetch(`${API}/products?${p}`);
      const j = r.ok ? await r.json() : [];
      resultat[l][q] = { statut: r.status, total: r.headers.get("x-total-count"), ids: j.map((x) => x.id) };
    }
    console.log(l, saisies.length, "saisies");
  }
  fs.writeFileSync(sortie, JSON.stringify(resultat));
}

function comparer(a, b) {
  const A = JSON.parse(fs.readFileSync(a, "utf8"));
  const B = JSON.parse(fs.readFileSync(b, "utf8"));
  for (const l of LANGUES) {
    let pareil = 0, change = 0, absentes = 0;
    const exemples = [];
    for (const [q, ra] of Object.entries(A[l] ?? {})) {
      const rb = B[l]?.[q];
      if (!rb) { absentes++; continue; }
      if (JSON.stringify(ra) === JSON.stringify(rb)) pareil++;
      else {
        change++;
        if (exemples.length < 12) exemples.push(`${q} : ${ra.total} → ${rb.total}`);
      }
    }
    console.log(`${l} : ${pareil} identiques, ${change} différentes, ${absentes} non rejouées${exemples.length ? "\n   " + exemples.join("\n   ") : ""}`);
  }
}

const [, , action, x, y] = process.argv;
if (action === "releve") await releve(x);
else if (action === "comparer") comparer(x, y);
else console.log("releve <fichier> | comparer <avant> <apres>");
