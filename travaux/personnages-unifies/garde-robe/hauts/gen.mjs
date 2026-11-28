// Garde-robe sur gabarits : les HAUTS (slot clothes), 27/11.
// Alexandra : « on doit pouvoir changer la peau, les fringues, accessoires etc ».
// Un fichier par famille et par type, dessiné sur l'enveloppe des corps de la famille :
// il tombe sans calage sur tous les gabarits (slot_adjust vide, facteur 1, décalage 0).
//
// Mise en place (Git Bash, depuis garde-robe/) :
//   MSYS_NO_PATHCONV=1 docker exec memoryline-api mkdir -p /tmp/gr-hauts/ref
//   for f in commun/ref/*.svg; do MSYS_NO_PATHCONV=1 docker cp "$f" memoryline-api:/tmp/gr-hauts/ref/; done
//   MSYS_NO_PATHCONV=1 docker cp commun/mes.json memoryline-api:/tmp/gr-hauts/mes.json
//   for f in hauts/*.mjs hauts/verif.ts; do MSYS_NO_PATHCONV=1 docker cp "$f" memoryline-api:/tmp/gr-hauts/; done
// Lancement (dans le conteneur, dossier /tmp/gr-hauts) :
//   node gen.mjs            → SVG dans out/svg, contrôles, planches, index.json
//   node gen.mjs --publier  → copie en plus les SVG validés dans /app/data/assets (copie LOCALE)
// Puis la vérification avec les fonctions du moteur :
//   docker exec -w /app/packages/types memoryline-api /app/apps/api/node_modules/.bin/tsx /tmp/gr-hauts/verif.ts
//
// Modules : fam.mjs (mesures par famille), patron.mjs (contour), details.mjs (col,
// côtes, capuche…), formes.mjs (découpes), types.mjs (le catalogue, dans l'ordre des
// numéros). Les découpes reprennent l'idée de bas/geom.mjs (Sutherland–Hodgman).
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { preparer } from "./fam.mjs";
import { CATALOGUE } from "./types.mjs";
import { versD } from "./formes.mjs";

const sharp = createRequire("/app/apps/api/package.json")("sharp");
// dossier du script (/tmp/gr-hauts/ ou une copie de relecture) : ref/, mes.json et out/ y sont
const ICI = dirname(fileURLToPath(import.meta.url)) + "/";
const REF = ICI + "ref/", OUT = ICI + "out/", SVGD = OUT + "svg/";
const ASSETS = "/app/data/assets/";
const MARQUE = "Garde-robe sur gabarits";
mkdirSync(SVGD, { recursive: true });

const mes = JSON.parse(readFileSync(ICI + "mes.json", "utf8"));
const FAM = Object.fromEntries(["femme", "homme", "enfant", "ado"].map((f) => [f, preparer(f, mes)]));

// ---------- couleurs ----------
const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
function rgb2hsl([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hsl2hex([h, s, l]) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return "#" + [0, 8, 4].map((n) => Math.round(f(n) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}
// « vive » au sens du moteur (couleurVive : écart max-min ≥ 0,08) : une nuance doit
// le rester avec sa référence, sinon le moteur ne la range pas dans sa famille.
const vive = (hex) => { const c = hex2rgb(hex); return Math.max(...c) - Math.min(...c) >= 0.08; };
const ecartTeinteBrut = (a, b) => { const h1 = rgb2hsl(hex2rgb(a))[0], h2 = rgb2hsl(hex2rgb(b))[0]; const d = Math.abs(h1 - h2) % 360; return Math.min(d, 360 - d); };
/**
 * Nuance plus sombre, dans la règle (0,10 à 0,20 de clarté en moins) : 0,15 pour une
 * couleur claire ou moyenne, 0,12 puis 0,10 pour une couleur foncée, qui virerait
 * sinon au noir ; moins encore si la nuance cessait d'être « vive » pour le moteur.
 */
function nuanceDe(hex) {
  const [h, s, l] = rgb2hsl(hex2rgb(hex));
  const depart = l < 0.3 ? 0.10 : l < 0.45 ? 0.12 : 0.15;
  for (let dl = depart; dl >= 0.0999; dl -= 0.01) {
    for (const k of [1, 1.15, 1.3]) {
      const n = hsl2hex([h, Math.min(1, s * k), Math.max(0.03, l - dl)]);
      if (vive(n) === vive(hex) && (!vive(hex) || ecartTeinteBrut(n, hex) <= 8)) return n;
    }
  }
  throw new Error("pas de nuance possible pour " + hex);
}
const ecartTeinte = (a, b) => { const [h1, s1] = rgb2hsl(hex2rgb(a)), [h2, s2] = rgb2hsl(hex2rgb(b)); if (s1 < 0.05 || s2 < 0.05) return 0; const d = Math.abs(h1 - h2) % 360; return Math.min(d, 360 - d); };

// recoloration de contrôle (2e teinte sur la planche)
const ALT = ["#0056AF", "#BD1212", "#2A5E21", "#E8B71C", "#FF96BF", "#6D7090", "#9EDFBF"];

// ---------- sérialisation ----------
const snake = (s) => s.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join("_");
const majuscule = (s) => s[0].toUpperCase() + s.slice(1);

function serialiser(piece, couleurs) {
  const { famille, nom, titre, position } = piece;
  const F = FAM[famille];
  const ordre = ["st0", "st2", "st3", "st4"].filter((c) => piece.calques[c]?.length);
  let s = `<!-- ${MARQUE}, generee par garde-robe/hauts/gen.mjs : ${titre} (${famille}) -->\n`;
  s += `<svg version="1.1" id="Gabarit_Piece_Hauts_${majuscule(famille)}_${snake(nom)}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" width="500px" height="1000px" viewBox="0 0 500 1000" style="enable-background:new 0 0 500 1000;" xml:space="preserve">\n`;
  s += `<style type="text/css">\n`;
  s += `\t.st0{fill:${couleurs.st0};}\n\t.st1{opacity:0.15;}\n`;
  for (const c of ordre.slice(1)) s += `\t.${c}{fill:${couleurs[c]};}\n`;
  s += `</style>\n<g id="${F.prefixe}_Clothes_${position}">\n`;
  for (const c of [...ordre, "st1"]) for (const poly of piece.calques[c] ?? []) {
    const d = versD(Array.isArray(poly[0][0]) ? poly : [poly]);
    if (d) s += `\t<path class="${c}" d="${d}"/>\n`;
  }
  s += `</g>\n</svg>\n`;
  return s;
}

// ---------- contrôle du format (§3, §4) ----------
function controleFormat(svg, zones) {
  const err = [];
  const lignes = svg.split("\n");
  if (!lignes[0].startsWith("<!-- " + MARQUE)) err.push("marque absente");
  if ((svg.match(/<style/g) || []).length !== 1) err.push("plusieurs <style>");
  if (/\sfill=|stroke|\sstyle="(?!enable)|opacity=|transform|<defs|Gradient|clipPath|<mask|<use|<image|<text/.test(svg.replace(/^.*\n.*\n/, ""))) err.push("attribut interdit");
  const decl = [...svg.matchAll(/\.(st\d+)\{([^}]*)\}/g)];
  for (const [, c, r] of decl) {
    if (c === "st1") { if (r !== "opacity:0.15;") err.push("st1 mal déclarée"); }
    else if (!/^fill:#[0-9A-F]{6};$/.test(r)) err.push("règle " + c + " : " + r);
  }
  const declarees = new Set(decl.map((d) => d[1]));
  const utilisees = new Set([...svg.matchAll(/class="(st\d+)"/g)].map((m) => m[1]));
  for (const c of declarees) if (!utilisees.has(c)) err.push("classe déclarée non utilisée " + c);
  for (const c of utilisees) if (!declarees.has(c)) err.push("classe utilisée non déclarée " + c);
  // même regex que extractColorZones
  const z = [...svg.matchAll(/\.(st\d+)\s*\{\s*fill\s*:\s*(#[0-9a-fA-F]{3,8})/g)].map((m) => m[1]).sort();
  const attendu = Object.keys(zones).sort();
  if (z.join() !== attendu.join()) err.push("zones " + z.join() + " ≠ " + attendu.join());
  if ((svg.match(/<g /g) || []).length !== 1) err.push("groupes imbriqués");
  if (!/^<\/g>\n<\/svg>\n$/.test(svg.slice(svg.lastIndexOf("</g>")))) err.push("fin de fichier");
  // ordre : aplats puis ombres
  const cls = [...svg.matchAll(/<path class="(st\d+)"/g)].map((m) => m[1]);
  const premiereOmbre = cls.indexOf("st1");
  if (premiereOmbre >= 0 && cls.slice(premiereOmbre).some((c) => c !== "st1")) err.push("ombre avant un aplat");
  if (cls[0] !== "st0") err.push("st0 pas en premier");
  return err;
}

// ---------- rendu et mesures ----------
async function alpha(svg) {
  const { data } = await sharp(Buffer.from(svg), { density: 72 }).resize(500, 1000, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const a = new Uint8Array(500 * 1000);
  for (let i = 0; i < a.length; i++) a[i] = data[i * 4 + 3];
  return a;
}
/** Distance de chanfrein (3-4) au masque, en pixels. */
function distance(masque) {
  const W = 500, H = 1000, INF = 1e9, d = new Float64Array(W * H);
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

const cacheCorps = {};
async function corps(F, g) {
  if (cacheCorps[g.fichier]) return cacheCorps[g.fichier];
  const svg = readFileSync(REF + g.fichier, "utf8");
  const a = await alpha(svg);
  const m = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) m[i] = a[i] > 128 ? 1 : 0;
  const c = { svg, masque: m, dist: distance(m) };
  cacheCorps[g.fichier] = c;
  return c;
}

/** Zones de contrôle d'un gabarit pour une pièce (voir la consigne hauts). */
function zones(F, g, piece) {
  const W = 500;
  const aCouvrir = new Uint8Array(W * 1000), mains = new Uint8Array(W * 1000), bras = new Uint8Array(W * 1000);
  const P = piece.P;
  const yReq = F.hemReq;
  const ligneMainG = (y) => Math.max(...F.g.map((h) => h.frontG(y)));
  const ligneMainD = (y) => Math.min(...F.g.map((h) => h.frontD(y)));
  const sansManche = piece.P.o.manche === "aucune";
  for (let y = 0; y < 1000; y++) {
    const L = g.larg[y]; if (!L) continue;
    for (let x = L[0]; x < L[1]; x++) {
      if (!cacheCorps[g.fichier].masque[y * W + x]) continue;
      const i = y * W + x;
      const xc = x + 0.5;
      for (const [s, nom] of [[-1, "g"], [1, "d"]]) {
        const pli = s < 0 ? g.pliG : g.pliD;
        const front = s < 0 ? g.frontG : g.frontD;
        const cotePix = s < 0 ? xc < F.cx : xc >= F.cx;
        if (!cotePix) continue;
        // main : sous le poignet, côté bras de la frontière
        if (y >= F.poignet[nom] && y <= g.finMain[nom] && s * (xc - front(y)) > 0) mains[i] = 1;
        // bras nu (manches courtes, 3/4, débardeur) : côté bras du pli
        const C = s < 0 ? P.G : P.D;
        const yNu = C.ys == null ? g.aisselle + 6 : C.ys + 4;
        if (piece.P.o.manche !== "longue" && y >= yNu && y < F.poignet[nom] && s * (xc - pli.bras(Math.max(y, pli.bras.y0))) > 0) bras[i] = 1;
      }
      // zone à couvrir : de l'encolure à l'ourlet minimal, torse entre les bras ;
      // sous une manche, le bras entier (jusqu'au poignet pour une manche longue)
      const yBasManche = Math.max(P.G.yb ?? 0, P.D.yb ?? 0) - 2;
      if (y < F.enc || y > Math.max(yReq, yBasManche)) continue;
      if (y > yReq) {
        // plus bas que l'ourlet minimal : seulement le bras, sous sa manche
        const s = xc < F.cx ? -1 : 1, Cm = s < 0 ? P.G : P.D, pli = s < 0 ? g.pliG : g.pliD;
        if (Cm.ys == null || y >= Cm.yb - 1 || s * (xc - pli.torse(Math.min(y, pli.torse.y1))) < 0) continue;
        aCouvrir[i] = 1; continue;
      }
      let dedans = true;
      for (const s of [-1, 1]) {
        const nom = s < 0 ? "g" : "d";
        const pli = s < 0 ? g.pliG : g.pliD;
        const ligneMain = s < 0 ? ligneMainG : ligneMainD;
        let bord = null;
        const Cm = s < 0 ? P.G : P.D;
        if (Cm.ys != null && y < Cm.yb - 1) {
          // sous la manche (au-dessus de son bord en biais) : tout le bras doit être couvert
        } else if (y >= g.aisselle) {
          if (y < F.poignet[nom]) bord = pli.torse(y);
          // couloir des mains : rien n'est exigé à moins de 2 px de la main la plus rentrée
          else if (y <= F.finMainMax[nom]) bord = s < 0 ? Math.max(pli.torse(Math.min(y, pli.torse.y1)), ligneMain(y) + 2) : Math.min(pli.torse(Math.min(y, pli.torse.y1)), ligneMain(y) - 2);
          if (sansManche) { const C = s < 0 ? P.G : P.D; if (y < C.yAH) bord = s < 0 ? Math.max(bord, C.AH(y)) : Math.min(bord, C.AH(y)); }
        } else if (sansManche) {
          const C = s < 0 ? P.G : P.D;
          bord = C.AH(y);
        }
        if (bord != null && s * (xc - bord) > 0) dedans = false;
      }
      if (dedans) aCouvrir[i] = 1;
    }
  }
  return { aCouvrir, mains, bras };
}

const cacheEnv = {};
async function enveloppe(F) {
  if (cacheEnv[F.nom]) return cacheEnv[F.nom];
  const m = new Uint8Array(500 * 1000);
  for (const g of F.g) { const C = await corps(F, g); for (let i = 0; i < m.length; i++) if (C.masque[i]) m[i] = 1; }
  return (cacheEnv[F.nom] = distance(m));
}

async function mesurer(F, piece, svg) {
  const a = await alpha(svg);
  const res = {};
  const dEnv = await enveloppe(F);
  let debEnv = 0, debEnvXY = null;
  for (let i = 0; i < a.length; i++) if (a[i] > 128 && dEnv[i] > debEnv) { debEnv = dEnv[i]; debEnvXY = [i % 500, Math.floor(i / 500)]; }
  res._enveloppe = { debord_max_px: Math.round(debEnv * 10) / 10, debord_ou: debEnvXY };
  for (const g of F.g) {
    const C = await corps(F, g);
    const Z = zones(F, g, piece);
    let peau = 0, mains = 0, bras = 0, deb = 0, debXY = null, peauBox = null;
    for (let i = 0; i < a.length; i++) {
      const couvert = a[i] > 128;
      if (Z.aCouvrir[i] && !couvert) { peau++; const x = i % 500, y = Math.floor(i / 500); peauBox = peauBox ? [Math.min(peauBox[0], x), Math.min(peauBox[1], y), Math.max(peauBox[2], x), Math.max(peauBox[3], y)] : [x, y, x, y]; }
      if (Z.mains[i] && couvert) mains++;
      if (Z.bras[i] && couvert) bras++;
      if (a[i] > 128 && C.dist[i] > deb) { deb = C.dist[i]; debXY = [i % 500, Math.floor(i / 500)]; }
    }
    res[g.index] = { peau_visible_px: peau, mains_couvertes_px: mains, bras_nus_couverts_px: bras, debord_max_px: Math.round(deb * 10) / 10, debord_ou: debXY, peau_ou: peauBox };
  }
  return res;
}

// ---------- fabrication ----------
const pieces = [];
let position = 1000;
for (const def of CATALOGUE) {
  const F = FAM[def.famille];
  const r = def.fabrique(F);
  const couleurs = {}, zonesIdx = {};
  for (const [c, [coul, groupe, role]] of Object.entries(r.zones)) {
    if (coul === "nuance") continue;
    couleurs[c] = coul;
    zonesIdx[c] = { couleur: coul, groupe, role };
  }
  for (const [c, [coul, groupe]] of Object.entries(r.zones)) {
    if (coul !== "nuance") continue;
    const ref = Object.entries(r.zones).find(([, z]) => z[1] === groupe && z[0] !== "nuance")[0];
    couleurs[c] = nuanceDe(couleurs[ref]);
    zonesIdx[c] = { couleur: couleurs[c], groupe, role: "nuance", de: ref };
  }
  const calques = { st0: r.st0, st2: r.st2, st3: r.st3, st4: r.st4, st1: r.st1 };
  for (const k of Object.keys(calques)) calques[k] = (calques[k] ?? []).filter((p) => p && p.length > 2);
  const piece = { ...def, P: r.P, calques, position: position++, couleurs, zonesIdx, notes: r.notes ?? "" };
  piece.fichier = `gabarit-piece-hauts-${def.famille}-${def.nom}.svg`;
  piece.svg = serialiser(piece, couleurs);
  pieces.push(piece);
}

// ---------- contrôles ----------
const bilan = [];
for (const p of pieces) {
  const F = FAM[p.famille];
  p.erreursFormat = controleFormat(p.svg, p.zonesIdx);
  for (const [c, z] of Object.entries(p.zonesIdx)) if (z.role === "nuance") {
    const ref = p.zonesIdx[z.de].couleur;
    const dl = rgb2hsl(hex2rgb(ref))[2] - rgb2hsl(hex2rgb(z.couleur))[2];
    if (ecartTeinte(ref, z.couleur) > 12 || dl < 0.0995 || dl > 0.2 || vive(ref) !== vive(z.couleur)) p.erreursFormat.push(`nuance ${c} hors règle (Δl ${dl.toFixed(3)})`);
  }
  p.controle = await mesurer(F, p, p.svg);
  // emprise
  const xs = [], ys = [];
  for (const m of p.svg.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)) { xs.push(+m[1]); ys.push(+m[2]); }
  p.emprise = { x: [Math.floor(Math.min(...xs)), Math.ceil(Math.max(...xs))], y: [Math.floor(Math.min(...ys)), Math.ceil(Math.max(...ys))] };
  const lim = p.debord ?? 8;
  const env = p.controle._enveloppe; delete p.controle._enveloppe; p.debordEnveloppe = env;
  const ko = Object.entries(p.controle).filter(([, c]) => c.peau_visible_px > 30 || c.mains_couvertes_px > 0);
  if (env.debord_max_px > lim) ko.push(["enveloppe", env]);
  p.ok = !p.erreursFormat.length && !ko.length;
  bilan.push(`${p.ok ? "ok " : "KO "} ${p.fichier.padEnd(48)} env ${env.debord_max_px}@${env.debord_ou} | ${Object.values(p.controle).map((c) => `p${c.peau_visible_px}${c.peau_ou ? "[" + c.peau_ou + "]" : ""}/m${c.mains_couvertes_px}/b${c.bras_nus_couverts_px}/d${c.debord_max_px}@${c.debord_ou}`).join("  ")} ${p.erreursFormat.join("; ")}`);
  writeFileSync(SVGD + p.fichier, p.svg);
}
console.log(bilan.join("\n"));

// ---------- planches ----------
function recolorer(svg, i) {
  // on saute les teintes déjà portées par la pièce, pour que la recoloration se voie
  const deja = new Set([...svg.matchAll(/fill:(#[0-9A-F]{6})/g)].map((m) => m[1]));
  const libres = ALT.filter((c) => !deja.has(c));
  const alt = libres[i % libres.length], alt2 = libres[(i + 3) % libres.length], alt3 = libres[(i + 5) % libres.length];
  return svg.replace(/\.st0\{fill:#[0-9A-F]{6};\}/, `.st0{fill:${alt};}`)
    .replace(/\.st2\{fill:#[0-9A-F]{6};\}/, `.st2{fill:${nuanceDe(alt)};}`)
    .replace(/\.st3\{fill:#[0-9A-F]{6};\}/, `.st3{fill:${alt2};}`)
    .replace(/\.st4\{fill:#[0-9A-F]{6};\}/, `.st4{fill:${alt3};}`);
}
const contenu = (svg) => svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const styleScope = (svg, k) => contenu(svg).replace(/\.st(\d+)/g, `.k${k}st$1`).replace(/class="st(\d+)"/g, `class="k${k}st$1"`);

async function planche(fam, liste, fichier) {
  const F = FAM[fam];
  const cadres = { femme: [330, 900], homme: [310, 880], enfant: [400, 800], ado: [320, 840] }[fam];
  const [y0, y1] = cadres, h = y1 - y0, w = 500, ech = 0.5;
  const cols = F.g.length + 3;
  const cw = w * ech, ch = h * ech, entete = 22, marge = 120;
  const W = marge + cols * cw, H = entete + liste.length * ch;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>`;
  s += `<style>text{font-family:sans-serif;font-size:12px;fill:#333}</style>`;
  F.g.forEach((g, j) => { s += `<text x="${marge + j * cw + 6}" y="15">${g.index.replace("gabarit-dos-", "").replace(".svg", "")}</text>`; });
  s += `<text x="${marge + F.g.length * cw + 6}" y="15">pièce seule</text><text x="${marge + (F.g.length + 1) * cw + 6}" y="15">recolorée (1)</text><text x="${marge + (F.g.length + 2) * cw + 6}" y="15">recolorée (2)</text>`;
  let k = 0;
  liste.forEach((p, r) => {
    const yy = entete + r * ch;
    s += `<rect x="0" y="${yy}" width="${W}" height="${ch}" fill="${r % 2 ? "#fafaf6" : "#f2f2ec"}"/>`;
    s += `<text x="6" y="${yy + 18}">${p.position}</text><text x="6" y="${yy + 34}">${p.nom}</text><text x="6" y="${yy + 50}" style="fill:${p.ok ? "#2a2" : "#c22"}">${p.ok ? "ok" : "KO"}</text>`;
    const cell = (j, inner) => `<svg x="${marge + j * cw}" y="${yy}" width="${cw}" height="${ch}" viewBox="0 ${y0} ${w} ${h}">${inner}</svg>`;
    F.g.forEach((g, j) => { k++; const c = cacheCorps[g.fichier].svg; s += cell(j, styleScope(c, k) + (k++, styleScope(p.svg, k))); });
    k++; s += cell(F.g.length, styleScope(p.svg, k));
    k++; s += cell(F.g.length + 1, styleScope(cacheCorps[F.g[0].fichier].svg, k) + (k++, styleScope(recolorer(p.svg, r), k)));
    // deuxième teinte sur un autre corps de la famille
    const g2 = F.g[F.g.length - 1];
    k++; s += cell(F.g.length + 2, styleScope(cacheCorps[g2.fichier].svg, k) + (k++, styleScope(recolorer(p.svg, r + 2), k)));
  });
  s += `</svg>`;
  await sharp(Buffer.from(s), { density: 72 }).flatten({ background: "#fff" }).jpeg({ quality: 82 }).toFile(OUT + fichier);
}
for (const fam of Object.keys(FAM)) await planche(fam, pieces.filter((p) => p.famille === fam), `planche-${fam}.jpg`);

// vue d'ensemble : chaque pièce sur le corps standard de sa famille
{
  const cw = 170, ch = 300, n = 8, W = n * cw, H = Math.ceil(pieces.length / n) * ch;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/><style>text{font-family:sans-serif;font-size:11px;fill:#333}</style>`;
  let k = 0;
  pieces.forEach((p, i) => {
    const F = FAM[p.famille], x = (i % n) * cw, y = Math.floor(i / n) * ch;
    s += `<svg x="${x}" y="${y}" width="${cw}" height="${ch - 16}" viewBox="0 150 500 780">${styleScope(cacheCorps[F.g[0].fichier].svg, ++k)}${styleScope(p.svg, ++k)}</svg>`;
    s += `<text x="${x + 6}" y="${y + ch - 4}">${p.position} ${p.famille} ${p.nom}</text>`;
  });
  s += `</svg>`;
  await sharp(Buffer.from(s), { density: 72 }).flatten({ background: "#fff" }).jpeg({ quality: 82 }).toFile(OUT + "planche.jpg");
}

// ---------- index ----------
/** Notes : celles du catalogue, plus les compromis mesurés. */
function notesAuto(p) {
  const n = p.notes ? [p.notes] : [];
  const bras = Object.entries(p.controle).filter(([, c]) => c.bras_nus_couverts_px > 30);
  if (bras.length) n.push("Compromis : le bord du torse doit couvrir le torse du corps le plus large, il mord donc un peu sur le bras nu des corps minces (" + bras.map(([g, c]) => g.replace("gabarit-dos-", "").replace(".svg", "") + " " + c.bras_nus_couverts_px + " px").join(", ") + ").");
  const lim = p.debord ?? 8;
  const deb = Object.entries(p.controle).filter(([, c]) => c.debord_max_px > lim);
  if (deb.length) n.push("Dessiné sur l'enveloppe de la famille (écart max à l'enveloppe " + p.debordEnveloppe.debord_max_px + " px) : sur les corps plus minces, manches et hanches paraissent plus amples (" + deb.map(([g, c]) => g.replace("gabarit-dos-", "").replace(".svg", "") + " " + c.debord_max_px + " px").join(", ") + ").");
  return n.join(" ");
}

const index = {
  categorie: "hauts", date: "2026-11-27", generateur: "garde-robe/hauts/gen.mjs",
  pieces: pieces.map((p) => {
    const F = FAM[p.famille];
    return {
      fichier: p.fichier, url: "/assets/" + p.fichier, familles: [p.famille],
      gabarits: F.g.map((g) => g.index), slot: "clothes", view: "back", nom: p.titre,
      id_groupe: `${F.prefixe}_Clothes_${p.position}`, position_proposee: p.position, nuancier: "vetements",
      zones: p.zonesIdx, ombre: "st1", emprise: p.emprise,
      controle: Object.fromEntries(Object.entries(p.controle).map(([g, c]) => [g, { peau_visible_px: c.peau_visible_px, debord_max_px: c.debord_max_px, mains_couvertes_px: c.mains_couvertes_px, bras_nus_couverts_px: c.bras_nus_couverts_px }])),
      debord_enveloppe_px: p.debordEnveloppe.debord_max_px,
      volumineuse: false, notes: notesAuto(p),
    };
  }),
};
writeFileSync(OUT + "index.json", JSON.stringify(index, null, 1) + "\n");

// ---------- publication locale ----------
if (process.argv.includes("--publier")) {
  for (const p of pieces) {
    if (!p.ok) { console.log("non publié (contrôle) :", p.fichier); continue; }
    const cible = ASSETS + p.fichier;
    if (existsSync(cible) && !readFileSync(cible, "utf8").split("\n")[0].includes(MARQUE)) throw new Error("fichier étranger, arrêt : " + cible);
    copyFileSync(SVGD + p.fichier, cible);
  }
  console.log("publié dans", ASSETS);
}
