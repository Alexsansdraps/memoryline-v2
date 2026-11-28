// Planche des onglets de la fenêtre du ciel (28/11) : chaque onglet avec ses vignettes, dans
// l'ordre et au format où la cliente les voit (AfficheIA.tsx, blocSilhouettes : grille de 4
// colonnes sur ordinateur, vignette de 104 x 56 px, viewBox = emprise + 4 cm de marge,
// tracé en encre à 80 %, libellé fr de 11 px dessous), dessinée ici deux fois plus grande.
// Les onglets et leur ordre sont relus dans GROUPES_SILHOUETTES, les libellés dans ui.ts (fr),
// les tracés dans le catalogue de l'API : la planche montre ce que le code propose.
// Lancer depuis apps/api :  npx tsx ../../travaux/ombres/planche-onglets.mts
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const racine = resolve(process.cwd(), "..", "..");
const { SILHOUETTES_ASSISES_PAR_ID } = await import(pathToFileURL(resolve(racine, "apps/api/src/ciel-silhouettes-assises.ts")).href);
const sharp = createRequire(resolve(racine, "apps/api/package.json"))("sharp");

// Les onglets de la fiche, dans l'ordre (GROUPES_SILHOUETTES).
const source = readFileSync(resolve(racine, "apps/web/src/islands/AfficheIA.tsx"), "utf8");
const debut = source.indexOf("const GROUPES_SILHOUETTES = {");
const bloc = source.slice(debut, source.indexOf("} as const;", debut));
const onglets = [...bloc.matchAll(/^ {4}([a-z]+): \[([\s\S]*?)\]/gm)].map((m) => ({
  id: m[1]!,
  scenes: [...m[2]!.matchAll(/"([a-z-]+)"/g)].map((s) => s[1]!),
}));
// Les libellés fr (le bloc fr de ui.ts, jusqu'au bloc en).
const ui = readFileSync(resolve(racine, "apps/web/src/i18n/ui.ts"), "utf8");
const fr = ui.slice(ui.indexOf("\n  fr: {"), ui.indexOf("\n  en: {"));
const libelle = (cle: string) => {
  const m = fr.match(new RegExp(`\\n\\s+"${cle.replace(/[.-]/g, (c) => `\\${c}`)}": "((?:[^"\\\\]|\\\\.)*)",`));
  if (!m) throw new Error(`libellé fr manquant : ${cle}`);
  return JSON.parse(`"${m[1]}"`) as string;
};
const nouvelles = new Set(
  (JSON.parse(readFileSync(resolve(racine, "travaux/ombres/ombres-familles.json"), "utf8")) as { id: string }[]).map((o) => o.id),
);

const K = 2; // agrandissement de la planche
const COLS = 4; // sm:grid-cols-4
const VW = 104; // largeur de la vignette (w-full dans la carte)
const VH = 56; // h-14
const CARTE = VW + 2 * 4 + 2; // px-1 et la bordure
const ECART = 8; // gap-2
const POLICE = 11; // text-[11px]
const INTERLIGNE = POLICE * 1.25; // leading-tight
const LARGEUR_ONGLET = COLS * CARTE + (COLS - 1) * ECART;
const ENCRE = "#121212";
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");

// Largeur approchée d'un texte en Arial (em), pour couper les libellés comme le navigateur.
const largeurTexte = (t: string, taille: number) =>
  [...t].reduce((w, c) => {
    if (" ,.;:'·".includes(c)) return w + 0.28;
    if ("ilj".includes(c)) return w + 0.24;
    if ("frt".includes(c)) return w + 0.33;
    if ("mw".includes(c)) return w + 0.83;
    if (c >= "A" && c <= "Z") return w + 0.67;
    return w + 0.556;
  }, 0) * taille;
const couper = (t: string, largeur: number, taille: number) => {
  const lignes: string[] = [];
  let ligne = "";
  for (const mot of t.split(" ")) {
    const essai = ligne ? `${ligne} ${mot}` : mot;
    if (ligne && largeurTexte(essai, taille) > largeur) {
      lignes.push(ligne);
      ligne = mot;
    } else ligne = essai;
  }
  if (ligne) lignes.push(ligne);
  return lignes;
};

// Un onglet : la rangée des six boutons (le sien en noir), puis la grille des scènes.
function dessinerOnglet(rang: number): { svg: string; hauteur: number } {
  const o = onglets[rang]!;
  let svg = "";
  let y = 0;
  svg += `<text x="0" y="${y + 16}" font-family="Arial" font-size="15" font-weight="bold" fill="${ENCRE}">${rang + 1}. ${esc(libelle(`ciel.groupe.${o.id}`))} — ${o.scenes.length} scènes (${o.scenes.filter((s) => nouvelles.has(s)).length} nouvelles)</text>`;
  y += 28;
  // La rangée des onglets (flex-wrap gap-2, px-3 py-1.5, text-sm).
  let x = 0;
  for (const autre of onglets) {
    const t = libelle(`ciel.groupe.${autre.id}`);
    const w = largeurTexte(t, 14) + 24;
    if (x + w > LARGEUR_ONGLET) {
      x = 0;
      y += 31 + 8;
    }
    const actif = autre.id === o.id;
    svg += `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w}" height="31" fill="${actif ? ENCRE : "#fff"}" stroke="${actif ? ENCRE : "rgba(18,18,18,0.2)"}"/>`;
    svg += `<text x="${x + 12}" y="${y + 20}" font-family="Arial" font-size="14" fill="${actif ? "#fff" : ENCRE}">${esc(t)}</text>`;
    x += w + 8;
  }
  y += 31 + 12; // mt-3
  // La grille : chaque rangée prend la hauteur de sa carte la plus haute.
  for (let debutRangee = 0; debutRangee < o.scenes.length; debutRangee += COLS) {
    const rangee = o.scenes.slice(debutRangee, debutRangee + COLS);
    const lignes = rangee.map((id) => couper(libelle(`ciel.silh.${id}`), VW, POLICE));
    const hauteur = 1 + 8 + VH + 4 + Math.max(...lignes.map((l) => l.length)) * INTERLIGNE + 6 + 1;
    rangee.forEach((id, i) => {
      const s = SILHOUETTES_ASSISES_PAR_ID.get(id);
      if (!s) throw new Error(`scène absente du catalogue : ${id}`);
      const cx = i * (CARTE + ECART);
      svg += `<rect x="${cx + 0.5}" y="${y + 0.5}" width="${CARTE - 1}" height="${hauteur - 1}" fill="#fff" stroke="rgba(18,18,18,0.15)"/>`;
      // La vignette : même viewBox que dessinSilhouette (xMidYMid meet par défaut).
      svg += `<svg x="${cx + 5}" y="${y + 9}" width="${VW}" height="${VH}" viewBox="${s.gauche - 4} ${s.haut - 4} ${s.droite - s.gauche + 8} ${-s.haut + 8}"><path d="${s.d}" fill="${ENCRE}" fill-opacity="0.8"/></svg>`;
      lignes[i]!.forEach((l, k) => {
        svg += `<text x="${cx + CARTE / 2}" y="${y + 9 + VH + 4 + (k + 0.8) * INTERLIGNE}" font-family="Arial" font-size="${POLICE}" text-anchor="middle" fill="${ENCRE}">${esc(l)}</text>`;
      });
      if (nouvelles.has(id)) svg += `<circle cx="${cx + 7}" cy="${y + 7}" r="3" fill="#2a7de1"/>`;
    });
    y += hauteur + ECART;
  }
  return { svg, hauteur: y };
}

// Deux onglets par rangée, dans l'ordre de lecture.
const MARGE = 24;
const ENTRE = 40;
let y = 70;
let corps = "";
for (let r = 0; r < onglets.length; r += 2) {
  const a = dessinerOnglet(r);
  const b = r + 1 < onglets.length ? dessinerOnglet(r + 1) : { svg: "", hauteur: 0 };
  corps += `<g transform="translate(${MARGE} ${y})">${a.svg}</g>`;
  corps += `<g transform="translate(${MARGE + LARGEUR_ONGLET + ENTRE} ${y})">${b.svg}</g>`;
  y += Math.ceil(Math.max(a.hauteur, b.hauteur)) + 30;
}
const largeur = 2 * MARGE + 2 * LARGEUR_ONGLET + ENTRE;
const total = onglets.reduce((t, o) => t + o.scenes.length, 0);
const entete =
  `<text x="${MARGE}" y="30" font-family="Arial" font-size="20" font-weight="bold" fill="${ENCRE}">Ciel étoilé : les onglets des personnages, tels que la fiche les montre (${onglets.length} onglets, ${total} scènes)</text>` +
  `<text x="${MARGE}" y="52" font-family="Arial" font-size="12" fill="#555">Vignettes de 104 x 56 px (ici x 2), libellés fr de ui.ts, ordre de GROUPES_SILHOUETTES (AfficheIA.tsx). ` +
  `Point bleu : scène nouvelle du 28/11 (absent de la fiche).</text>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${largeur * K}" height="${y * K}" viewBox="0 0 ${largeur} ${y}"><rect width="100%" height="100%" fill="#fff"/>${entete}${corps}</svg>`;
await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toFile(resolve(racine, "travaux/ombres/planche-onglets.jpg"));
console.log(onglets.map((o) => `${o.id} ${o.scenes.length}`).join(", "), "->", resolve(racine, "travaux/ombres/planche-onglets.jpg"), `${largeur * K} x ${y * K}`);
process.exit(0);
