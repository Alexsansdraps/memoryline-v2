// Garde-robe sur gabarits : ACCESSOIRES (slot accessory, numéros proposés 1000 à 1199), 27/11.
// Alexandra : « on doit pouvoir changer la peau, les fringues, accessoires etc ».
//
// Générateur unique, relançable, déterministe. Dans le conteneur memoryline-api :
//   cd /tmp/gr-accessoires && node gen.mjs            → svg/, index.json, planches, contrôles
//   cd /tmp/gr-accessoires && node gen.mjs --publier  → recopie en plus les SVG validés dans /app/data/assets
//                                                       (copie LOCALE, noms gabarit-piece-accessoires-* seulement)
// Entrées (copiées à côté du script) : ref/ (gabarits nus de garde-robe/commun/ref), mes.json (commun/mes.json).
// Lecture seule de /app/data/assets/{Female_2,Male_2,Boys_2,Teenage_Boys_1}.svg pour l'essai sous chapeau des planches.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from "node:fs";
import { catalogue, FAMILLES, demi } from "./pieces.mjs";
import { hexVersTsl, nuance } from "./geo.mjs";

const sharp = createRequire("/app/apps/api/package.json")("sharp");
const ICI = new URL(".", import.meta.url).pathname;
const REF = ICI + "ref/", SORTIE = ICI + "svg/", ASSETS = "/app/data/assets/";
const PUBLIER = process.argv.includes("--publier");
const MARQUE = "Garde-robe sur gabarits";
const POSITION0 = 1000;
const W = 500, H = 1000;

const M = JSON.parse(readFileSync(ICI + "mes.json", "utf8"));
rmSync(SORTIE, { recursive: true, force: true });
mkdirSync(SORTIE, { recursive: true });

// nom de gabarit dans l'index → fichier de géométrie (les standard -v2 sont identiques aux standard de ref/)
const fichierRef = (g) => REF + g.replace("-standard-v2.svg", "-standard.svg");
const SEGMENT = "Accessories";
const majuscule = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const snake = (id) => id.split("-").map(majuscule).join("_");

// ---------------------------------------------------------------------------------------------
// Écriture SVG (format commun §3)
// ---------------------------------------------------------------------------------------------
const f1 = (v) => { const r = Math.round(v * 10) / 10; return (Object.is(r, -0) ? 0 : r).toString(); };
function chemin(segs) {
  let d = "", debut = true;
  for (const s of segs) {
    if (s === null) { d += "Z"; debut = true; continue; }
    if (debut) { d += `M${f1(s.p0.u)},${f1(s.p0.v)}`; debut = false; }
    d += `C${f1(s.c1.u)},${f1(s.c1.v)} ${f1(s.c2.u)},${f1(s.c2.v)} ${f1(s.p3.u)},${f1(s.p3.v)}`;
  }
  return d + "Z";
}
const rang = (cls) => (cls === "st1" ? 99 : Number(cls.slice(2)));
function svgPiece(p, couches) {
  const classes = [...new Set(couches.map((c) => c.cls))].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
  const regles = classes.map((k) => (k === "st1" ? "\t.st1{opacity:0.15;}" : `\t.${k}{fill:${p.zones[k].couleur};}`));
  const tri = couches.map((c, i) => ({ ...c, i })).sort((a, b) => rang(a.cls) - rang(b.cls) || a.i - b.i);
  return [
    `<!-- ${MARQUE}, generee par garde-robe/accessoires/gen.mjs : ${p.nom} (${p.famille}) -->`,
    `<svg version="1.1" id="Gabarit_Piece_Accessoires_${majuscule(p.famille)}_${snake(p.id)}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" width="500px" height="1000px" viewBox="0 0 500 1000" style="enable-background:new 0 0 500 1000;" xml:space="preserve">`,
    `<style type="text/css">`, ...regles, `</style>`,
    `<g id="${p.id_groupe}">`,
    ...tri.map((c) => `\t<path class="${c.cls}" d="${chemin(c.segs)}"/>`),
    `</g>`, `</svg>`, "",
  ].join("\n");
}
async function surfacesVisibles(couches, classes) {
  const code = Object.fromEntries(classes.map((k, i) => [k, [40 + 50 * i, 255 - 40 * i, 20 * i]]));
  const tri = couches.map((c, i) => ({ ...c, i })).filter((c) => c.cls !== "st1").sort((a, b) => rang(a.cls) - rang(b.cls) || a.i - b.i);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="1000" viewBox="0 0 500 1000">${tri.map((c) => `<path fill="rgb(${code[c.cls].join(",")})" d="${chemin(c.segs)}"/>`).join("")}</svg>`;
  const { data } = await sharp(Buffer.from(svg), { density: 72 }).resize(W, H, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = Object.fromEntries(classes.map((k) => [k, 0]));
  for (let i = 0; i < W * H; i++) {
    if (data[i * 4 + 3] < 250) continue;
    let best = null, bd = 1e9;
    for (const k of classes) { const [r, g, b] = code[k]; const d = Math.abs(data[i * 4] - r) + Math.abs(data[i * 4 + 1] - g) + Math.abs(data[i * 4 + 2] - b); if (d < bd) { bd = d; best = k; } }
    if (bd < 12) n[best]++;
  }
  return n;
}
// variante sans style de classe, une seule couleur, pour les masques
const svgMasque = (couches) => `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="1000" viewBox="0 0 500 1000">${couches.map((c) => `<path fill="#000" d="${chemin(c.segs)}"/>`).join("")}</svg>`;

// ---------------------------------------------------------------------------------------------
// Rastérisation et mesures
// ---------------------------------------------------------------------------------------------
async function png(svg) { return sharp(Buffer.from(svg), { density: 72 }).resize(W, H, { fit: "fill" }).ensureAlpha().png().toBuffer(); }
async function alpha(svg) {
  const { data } = await sharp(Buffer.from(svg), { density: 72 }).resize(W, H, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const a = new Uint8Array(W * H);
  for (let i = 0; i < a.length; i++) a[i] = data[i * 4 + 3] > 128 ? 1 : 0;
  return a;
}
/** Distance (chanfrein 3-4, ~px) de chaque pixel au masque. */
function distance(masque) {
  const INF = 1e9, d = new Float64Array(W * H);
  for (let i = 0; i < d.length; i++) d[i] = masque[i] ? 0 : INF;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + 3);
    if (y > 0) { v = Math.min(v, d[i - W] + 3); if (x > 0) v = Math.min(v, d[i - W - 1] + 4); if (x < W - 1) v = Math.min(v, d[i - W + 1] + 4); }
    d[i] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x; let v = d[i];
    if (x < W - 1) v = Math.min(v, d[i + 1] + 3);
    if (y < H - 1) { v = Math.min(v, d[i + W] + 3); if (x < W - 1) v = Math.min(v, d[i + W + 1] + 4); if (x > 0) v = Math.min(v, d[i + W - 1] + 4); }
    d[i] = v;
  }
  for (let i = 0; i < d.length; i++) d[i] /= 3;
  return d;
}
function debordMax(piece, dist) { let m = 0; for (let i = 0; i < piece.length; i++) if (piece[i] && dist[i] > m) m = dist[i]; return Math.round(m); }
const largeur = (a, y) => { let g = -1, d = -1; for (let x = 0; x < W; x++) if (a[y * W + x]) { if (g < 0) g = x; d = x; } return g < 0 ? 0 : d - g + 1; };
function baseDuCou(a, fam) {
  const y0 = { femme: 330, homme: 300, enfant: 395, ado: 320 }[fam];
  let ymin = y0, wmin = 999;
  for (let y = y0; y < y0 + 60; y++) { const w = largeur(a, y); if (w && w < wmin) { wmin = w; ymin = y; } }
  let b = ymin; while (largeur(a, b) < wmin + 24) b++;
  return b;
}

// couloir du dos : entre les bandes de pli des bras de TOUS les gabarits de la famille (commun/mes.json)
function couloir(fam) {
  const F = FAMILLES[fam];
  const cx = F.cx;
  const lignes = new Map(); // y → [gauche, droite]
  for (const g of Object.values(M[fam])) {
    for (const o of g.ombres) {
      if (o.x[0] > cx - 40) continue; // l'ombre du côté droit du dos n'est pas une bande de bras
      for (const [y, runs] of Object.entries(o.runs)) {
        const L = runs.filter((r) => r[0] < cx).map((r) => r[1]), R = runs.filter((r) => r[0] >= cx).map((r) => r[0]);
        const cur = lignes.get(+y) ?? [-1, W];
        if (L.length) cur[0] = Math.max(cur[0], ...L);
        if (R.length) cur[1] = Math.min(cur[1], ...R);
        lignes.set(+y, cur);
      }
    }
  }
  const ys = [...lignes.keys()].sort((a, b) => a - b);
  // échantillons tous les 10 px, décalés selon les gabarits : on prend le plus strict des voisins
  const res = new Map();
  for (let y = ys[0]; y <= ys[ys.length - 1]; y++) {
    let g = -1, d = W;
    for (const yy of ys) if (Math.abs(yy - y) <= 11) { const [a, b] = lignes.get(yy); g = Math.max(g, a); d = Math.min(d, b); }
    res.set(y, [g + 1, d - 1]);
  }
  return res;
}

// ---------------------------------------------------------------------------------------------
// Génération
// ---------------------------------------------------------------------------------------------
const pieces = catalogue(M);
const corps = new Map(); // gabarit → { a, svg, png, dist, base }
for (const [fam, F] of Object.entries(FAMILLES)) for (const g of F.gabarits) {
  const svg = readFileSync(fichierRef(g), "utf8");
  const a = await alpha(svg);
  corps.set(g, { svg, a, png: await png(svg), dist: distance(a), base: F.animal ? null : baseDuCou(a, fam) });
}
const COULOIRS = Object.fromEntries(["femme", "homme", "enfant", "ado"].map((f) => [f, couloir(f)]));

const index = { categorie: "accessoires", date: "2026-11-27", generateur: "garde-robe/accessoires/gen.mjs", pieces: [] };
const problemes = [];
const rendus = []; // pour les planches
const toutesSurfaces = {}; // pour verif.ts (parts des zones, comme celles que mesure l'API)
let position = POSITION0;

for (const p of pieces) {
  const F = FAMILLES[p.famille];
  p.position = position++;
  p.id_groupe = `${F.prefixe}_${SEGMENT}_${p.position}`;
  p.fichier = `gabarit-piece-accessoires-${p.famille}-${p.id}.svg`;
  const couches = p.build(F);
  const svg = svgPiece(p, couches);
  writeFileSync(SORTIE + p.fichier, svg);

  // --- zones (§4) : extraction comme extractColorZones, classes déclarées = utilisées
  const zonesSvg = {};
  for (const m of svg.matchAll(/\.(st\d+)\s*\{\s*fill\s*:\s*(#[0-9a-fA-F]{3,8})/g)) zonesSvg[m[1]] = m[2].toUpperCase();
  const declarees = Object.keys(p.zones).sort();
  const utilisees = [...new Set(couches.map((c) => c.cls))].filter((c) => c !== "st1").sort();
  if (JSON.stringify(Object.keys(zonesSvg).sort()) !== JSON.stringify(declarees)) problemes.push(`${p.fichier} : zones du SVG ${Object.keys(zonesSvg)} ≠ index ${declarees}`);
  if (JSON.stringify(utilisees) !== JSON.stringify(declarees)) problemes.push(`${p.fichier} : classes utilisées ${utilisees} ≠ déclarées ${declarees}`);
  if (!couches.some((c) => c.cls === "st1")) problemes.push(`${p.fichier} : pas d'ombre st1`);
  if (/\sfill=|stroke|transform|<defs|<use|<image|<text|opacity=/.test(svg.split("</style>")[1])) problemes.push(`${p.fichier} : attribut interdit`);
  // surfaces VISIBLES par zone : chaque classe dans une couleur pure, ombres retirées, dans l'ordre de peinture
  const surfaces = await surfacesVisibles(couches, declarees);
  const totalCouleur = Object.values(surfaces).reduce((s, v) => s + v, 0);
  toutesSurfaces[p.fichier] = surfaces;
  for (const [k, z] of Object.entries(p.zones)) {
    if (z.role === "nuance") {
      const a = hexVersTsl(p.zones[z.de].couleur), b = hexVersTsl(z.couleur);
      const dh = Math.min(Math.abs(a.h - b.h), 360 - Math.abs(a.h - b.h)), dl = a.l - b.l;
      if ((a.s > 0.05 && dh > 12) || dl < 0.0999 || dl > 0.2001) problemes.push(`${p.fichier} : nuance ${k} hors règle (Δteinte ${dh.toFixed(1)}, Δclarté ${dl.toFixed(3)})`);
      // le moteur ne prend pour ombre qu'une zone de moins des 2/3 de sa référence (PART_MAX_OMBRE)
      if (surfaces[k] > (2 / 3) * surfaces[z.de]) problemes.push(`${p.fichier} : nuance ${k} trop étendue (${surfaces[k]} px pour ${surfaces[z.de]} px à ${z.de})`);
    }
    if (z.role === "detail" && surfaces[k] / totalCouleur >= 0.05) problemes.push(`${p.fichier} : détail ${k} = ${(100 * surfaces[k] / totalCouleur).toFixed(1)} % (≥ 5 %)`);
  }
  const plusGrande = Object.entries(surfaces).sort((a, b) => b[1] - a[1])[0][0];
  if (plusGrande !== "st0") problemes.push(`${p.fichier} : st0 n'est pas la plus grande surface (${plusGrande} : ${JSON.stringify(surfaces)})`);
  const rangees = Object.values(p.zones).filter((z) => z.role !== "nuance").length;
  if (rangees > 3) problemes.push(`${p.fichier} : ${rangees} rangées proposées (> 3)`);

  // --- contrôle §8
  const aP = await alpha(svg);
  const aContrainte = p.type === "animal" ? await alpha(svgMasque(couches.filter((c) => !c.libre && c.cls !== "st1"))) : null;
  let xmin = W, xmax = -1, ymin = H, ymax = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (aP[y * W + x]) { if (x < xmin) xmin = x; if (x > xmax) xmax = x; if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
  const controle = {};
  for (const g of F.gabarits) {
    const B = corps.get(g);
    const c = {};
    // zone à couvrir
    let peau = 0, nonCouvert = 0;
    if (p.type === "chapeau") {
      for (let y = 0; y < H; y++) {
        const v = (y + 0.5 - F.top) / F.s;
        if (v < -30 || v > p.bord) continue;
        for (let x = 0; x < W; x++) {
          const u = (x + 0.5 - F.cx) / F.s;
          if (Math.abs(u) > demi(v) + 22) continue;
          if (p.ouverture && Math.abs(u) < 31 && v >= 24) continue;
          const i = y * W + x;
          if (!aP[i]) { nonCouvert++; if (B.a[i]) peau++; }
        }
      }
      c.calotte_non_couverte_px = nonCouvert;
    } else if (p.type === "cou") {
      for (let y = B.base - 12; y <= B.base; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (B.a[i] && !aP[i]) peau++; }
      c.base_du_cou_y = B.base;
    }
    c.peau_visible_px = peau;
    // débordement
    let dist = B.dist;
    if (p.type === "dos") {
      const cl = COULOIRS[p.famille];
      const permis = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) { const r = cl.get(y); for (let x = 0; x < W; x++) { const i = y * W + x; permis[i] = B.a[i] && (!r || (x >= r[0] && x <= r[1])) ? 1 : 0; } }
      dist = distance(permis);
    }
    c.debord_max_px = debordMax(aContrainte ?? aP, dist);
    // mains et avant-bras
    if (!F.animal) {
      let mains = 0;
      const { y: [ya, yb], x: [xa, xb] } = F.bras;
      for (let y = ya; y <= yb; y++) for (let x = 0; x < W; x++) { if (x > xa && x < xb) continue; const i = y * W + x; if (B.a[i] && aP[i]) mains++; }
      c.mains_couvertes_px = mains;
    }
    controle[g] = c;
    // critères
    const nom = `${p.fichier} sur ${g}`;
    if (c.peau_visible_px > 30) problemes.push(`${nom} : peau visible ${c.peau_visible_px} px`);
    if (p.type === "chapeau" && c.calotte_non_couverte_px > 30) problemes.push(`${nom} : calotte non couverte ${c.calotte_non_couverte_px} px`);
    if ((c.mains_couvertes_px ?? 0) > 0) problemes.push(`${nom} : ${c.mains_couvertes_px} px de main ou d'avant-bras couverts`);
    const lim = p.type === "dos" ? 2 : p.type === "animal" ? 6 : p.type === "chapeau" || p.type === "canne" ? Infinity : (p.debordMax ?? 24);
    if (c.debord_max_px > lim) problemes.push(`${nom} : débord ${c.debord_max_px} px (> ${lim})`);
  }
  if (xmax > 490 || xmin < 10) problemes.push(`${p.fichier} : sort du cadre utile (x ${xmin}-${xmax})`);

  index.pieces.push({
    fichier: p.fichier, url: `/assets/${p.fichier}`, familles: [p.famille], gabarits: F.gabarits,
    slot: "accessory", view: "back", nom: p.nom, id_groupe: p.id_groupe, position_proposee: p.position, nuancier: "vetements",
    zones: p.zones, ombre: "st1", emprise: { x: [xmin, xmax], y: [ymin, ymax] }, controle, volumineuse: false,
    notes: [p.type === "chapeau" ? `Couvre-chef : calotte contractuelle couverte de v -30 à v ${p.bord} ; les coiffures « volumineuses » (chignon haut, queue haute, macarons, afro…) en sortent.` : "", p.notes ?? ""].filter(Boolean).join(" "),
  });
  rendus.push({ p, svg, emprise: [xmin, ymin, xmax, ymax] });
  process.stdout.write(".");
}
console.log(`\n${index.pieces.length} pièces écrites`);
writeFileSync(ICI + "index.json", JSON.stringify(index, null, 1) + "\n");
writeFileSync(ICI + "surfaces.json", JSON.stringify(toutesSurfaces));

// ---------------------------------------------------------------------------------------------
// Planches
// ---------------------------------------------------------------------------------------------
const FOND = { r: 247, g: 245, b: 239, alpha: 1 };
const echap = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const texte = (w, h, t, taille = 13, gras = false) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><text x="4" y="${h - 5}" font-size="${taille}" font-family="DejaVu Sans, sans-serif"${gras ? ' font-weight="bold"' : ""} fill="#222">${echap(t)}</text></svg>`);
const cheveux = {};
for (const [fam, F] of Object.entries(FAMILLES)) {
  if (F.animal) continue;
  const src = readFileSync(ASSETS + F.origine, "utf8");
  const tete = src.slice(0, src.indexOf("<g id="));
  let grp = src.slice(src.indexOf(`<g id="${F.cheveux}"`)); grp = grp.slice(0, grp.indexOf("</g>") + 4);
  cheveux[fam] = await png(tete + grp + "</svg>");
}
// recoloration d'essai : une autre teinte par rôle, les nuances suivent leur référence
const ESSAI = ["#9EDFBF", "#FF96BF", "#0056AF", "#E8B71C", "#BD1212"];
function recolore(p, svg) {
  const nouvelles = {};
  let k = 0;
  for (const [cls, z] of Object.entries(p.zones)) if (z.role !== "nuance") { let c = ESSAI[k++ % ESSAI.length]; if (c === z.couleur) c = ESSAI[k++ % ESSAI.length]; nouvelles[cls] = c; }
  for (const [cls, z] of Object.entries(p.zones)) if (z.role === "nuance") nouvelles[cls] = nuance(nouvelles[z.de], hexVersTsl(p.zones[z.de].couleur).l - hexVersTsl(z.couleur).l);
  let out = svg;
  for (const [cls, c] of Object.entries(nouvelles)) out = out.replace(new RegExp(`(\\.${cls}\\{fill:)#[0-9A-F]{6}`), `$1${c}`);
  return out;
}
function cadrage(p, emp) {
  const F = FAMILLES[p.famille];
  let [x0, y0, x1, y1] = emp;
  if (!F.animal && ["chapeau", "tete"].includes(p.type)) { y1 = Math.max(y1, F.top + 175 * F.s); x0 = Math.min(x0, F.cx - 90); x1 = Math.max(x1, F.cx + 90); y0 = Math.min(y0, F.top - 40); }
  const m = 22;
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(W - 1, x1 + m); y1 = Math.min(H - 1, y1 + m);
  // cadre au moins carré
  let w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (w < h * 0.8) { const c = (x0 + x1) / 2, nw = Math.min(W, Math.round(h * 0.8)); x0 = Math.max(0, Math.round(c - nw / 2)); x0 = Math.min(x0, W - nw); w = nw; }
  if (h < w) { const c = (y0 + y1) / 2, nh = Math.min(H, w); y0 = Math.max(0, Math.round(c - nh / 2)); y0 = Math.min(y0, H - nh); h = nh; }
  return { left: Math.round(x0), top: Math.round(y0), width: Math.round(w), height: Math.round(h) };
}
async function cas(couches, crop, cw, ch) {
  const img = await sharp({ create: { width: W, height: H, channels: 4, background: FOND } }).composite(couches.map((input) => ({ input }))).png().toBuffer();
  return sharp(img).extract(crop).resize(cw, ch, { fit: "contain", background: FOND }).png().toBuffer();
}
const CW = 210, CH = 230, LAB = 20, ENT = 26, MARGE = 6;
const planchesFaites = [];
for (const fam of Object.keys(FAMILLES)) {
  const F = FAMILLES[fam];
  const lignes = rendus.filter((r) => r.p.famille === fam);
  if (!lignes.length) continue;
  const cols = [...F.gabarits.map((g) => g.replace("gabarit-dos-", "").replace(".svg", "")), ...(F.animal ? [] : ["avec coiffure d'origine"]), "recolorée", "pièce seule"];
  const largeurP = MARGE + cols.length * (CW + MARGE), hauteurP = ENT + lignes.length * (CH + LAB + MARGE) + MARGE;
  const comps = [];
  cols.forEach((t, k) => comps.push({ input: texte(CW, ENT, t, 13, true), left: MARGE + k * (CW + MARGE), top: 0 }));
  let y = ENT;
  for (const r of lignes) {
    const crop = cadrage(r.p, r.emprise);
    const pPng = await png(r.svg), pRec = await png(recolore(r.p, r.svg));
    const cases = F.gabarits.map((g) => [corps.get(g).png, pPng]);
    if (!F.animal) cases.push([corps.get(F.gabarits[0]).png, cheveux[fam], pPng]);
    cases.push([corps.get(F.gabarits[0]).png, ...(F.animal ? [] : [cheveux[fam]]), pRec]);
    cases.push([pPng]);
    comps.push({ input: texte(largeurP, LAB, `${r.p.position}  ${r.p.nom}  (${r.p.fichier})`, 12), left: MARGE, top: y });
    for (let k = 0; k < cases.length; k++) comps.push({ input: await cas(cases[k], crop, CW, CH), left: MARGE + k * (CW + MARGE), top: y + LAB });
    y += CH + LAB + MARGE;
  }
  const f = ICI + `planche-${fam}.jpg`;
  await sharp({ create: { width: largeurP, height: hauteurP, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).composite(comps).flatten({ background: "#ffffff" }).jpeg({ quality: 86 }).toFile(f);
  planchesFaites.push(f);
}
// vue d'ensemble : chaque pièce sur le gabarit standard de sa famille (avec la coiffure d'origine pour les humains)
{
  const N = 9, cw = 170, ch = 190, lab = 30;
  const comps = [];
  for (let k = 0; k < rendus.length; k++) {
    const r = rendus[k], F = FAMILLES[r.p.famille];
    const x = MARGE + (k % N) * (cw + MARGE), y = MARGE + Math.floor(k / N) * (ch + lab + MARGE);
    const couches = [corps.get(F.gabarits[0]).png, ...(F.animal || !["chapeau", "tete"].includes(r.p.type) ? [] : [cheveux[r.p.famille]]), await png(r.svg)];
    comps.push({ input: await cas(couches, cadrage(r.p, r.emprise), cw, ch), left: x, top: y });
    comps.push({ input: texte(cw, 15, `${r.p.position} ${r.p.famille}`, 11, true), left: x, top: y + ch });
    comps.push({ input: texte(cw, 15, r.p.nom, 11), left: x, top: y + ch + 14 });
  }
  const lignesN = Math.ceil(rendus.length / N);
  await sharp({ create: { width: MARGE + N * (cw + MARGE), height: MARGE + lignesN * (ch + lab + MARGE), channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .composite(comps).flatten({ background: "#ffffff" }).jpeg({ quality: 86 }).toFile(ICI + "planche.jpg");
  planchesFaites.push(ICI + "planche.jpg");
}

// ---------------------------------------------------------------------------------------------
// Bilan, publication locale
// ---------------------------------------------------------------------------------------------
const parFamille = {};
for (const p of index.pieces) parFamille[p.familles[0]] = (parFamille[p.familles[0]] ?? 0) + 1;
console.log("par famille :", JSON.stringify(parFamille));
console.log("planches :", planchesFaites.join(", "));
if (problemes.length) { console.log(`\n${problemes.length} problème(s) :`); for (const l of problemes) console.log(" - " + l); }
else console.log("aucun problème");

if (PUBLIER) {
  if (problemes.length) { console.log("publication refusée : il reste des problèmes"); process.exit(1); }
  let n = 0;
  for (const p of index.pieces) {
    const dest = ASSETS + p.fichier;
    if (!/^gabarit-piece-accessoires-[a-z]+-[a-z0-9-]+\.svg$/.test(p.fichier)) throw new Error("nom inattendu " + p.fichier);
    if (existsSync(dest) && !readFileSync(dest, "utf8").split("\n")[0].includes(MARQUE)) { console.log(`ARRÊT : ${dest} existe et ne porte pas la marque`); process.exit(1); }
    writeFileSync(dest, readFileSync(SORTIE + p.fichier));
    n++;
  }
  console.log(`${n} SVG recopiés dans ${ASSETS}`);
}
