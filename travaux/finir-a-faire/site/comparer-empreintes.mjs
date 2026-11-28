// Avant / après, à partir de 1280 px : la boîte de chaque élément de la
// rangée de l'en-tête doit être la même, au dixième de pixel (« sans rien
// changer au-dessus de 1280 px »). Seule différence attendue : le mot
// « Back-office » vit désormais dans un <span> (pour être masqué sous
// 1280 px) ; ce <span> nouveau doit prendre exactement la place du texte.
//
//   node comparer-empreintes.mjs [avant] [apres]
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ici = dirname(fileURLToPath(import.meta.url));
const [a = "avant", b = "apres"] = process.argv.slice(2);
const avant = JSON.parse(readFileSync(resolve(ici, `mesures-${a}.json`), "utf8"));
const apres = JSON.parse(readFileSync(resolve(ici, `mesures-${b}.json`), "utf8"));
const cle = (m) => `${m.langue}|${m.stand}|${m.avecBo}|${m.largeur}`;
const index = new Map(avant.map((m) => [cle(m), m]));
let comparees = 0;
let differentes = 0;
for (const m of apres) {
  if (m.largeur < 1280) continue;
  const v = index.get(cle(m));
  if (!v) continue;
  comparees++;
  // Le <span> nouveau du bouton : retiré avant de comparer, après avoir
  // vérifié qu'il n'apparaît que dans le cas « avec le bouton ».
  const nouveaux = m.empreinte.filter((x) => !v.empreinte.includes(x));
  const disparus = v.empreinte.filter((x) => !m.empreinte.includes(x));
  const seulSpan = nouveaux.length === 1 && nouveaux[0].startsWith("SPAN:") && m.avecBo && disparus.length === 0;
  if (nouveaux.length === 0 && disparus.length === 0 && m.empreinte.length === v.empreinte.length) continue;
  if (seulSpan) {
    console.log(`= ${cle(m)} : identique, plus le <span> du mot « Back-office » (${nouveaux[0]})`);
    continue;
  }
  differentes++;
  console.log(`≠ ${cle(m)}\n  disparus : ${disparus.join(" ")}\n  nouveaux : ${nouveaux.join(" ")}`);
}
console.log(`\n${comparees} mesures comparées à 1280 px et plus, ${differentes} différente(s).`);
if (differentes) process.exitCode = 1;
