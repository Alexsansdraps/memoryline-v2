// Garde-robe sur gabarits : les BAS (slot pants), un fichier par famille et par type,
// posé sans calage sur tous les gabarits de la famille.
// Alexandra, 27/11 : « on doit pouvoir changer la peau, les fringues, accessoires etc ».
//
// Lancement (Git Bash) :
//   MSYS_NO_PATHCONV=1 docker cp garde-robe/bas/. memoryline-api:/tmp/gr-bas/
//   MSYS_NO_PATHCONV=1 docker exec memoryline-api sh -c 'cd /tmp/gr-bas && node gen.mjs'
// Le dossier /tmp/gr-bas doit contenir ref/ (copie de garde-robe/commun/ref) et orig/ (Female_2.svg,
// Male_2.svg, Boys_2.svg, Teenage_Boys_1.svg, lus dans data/assets, en lecture seule).
// Sortie : /tmp/gr-bas/svg/*.svg, index.json, planche*.jpg. Option --assets : copie les SVG validés
// dans /app/data/assets (copie LOCALE), seulement s'ils sont neufs ou portent la marque.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { mesurerFamille, FAMILLES } from "./mesure.mjs";
import { silPantalon, silJupe, dessiner, nuance } from "./pieces.mjs";
import { versD } from "./formes.mjs";
const sharp = createRequire("/app/apps/api/package.json")("sharp");

const D = new URL(".", import.meta.url).pathname, REF = D + "ref/", SORTIE = D + "svg/";
mkdirSync(SORTIE, { recursive: true });
const MARQUE = "Garde-robe sur gabarits";

// ---------- catalogue ----------
// s : étalement des jupes sur l'assise (px au-delà du ras de l'assise).
// couleurs : st0 principale (st2 en est la nuance, calculée), st3 partie, st4 détail.
const P = (famille, nom, libelle, type, couleurs, groupes, extra = {}) => ({ famille, nom, libelle, type, couleurs, groupes, ...extra });
const JEAN = { st3: "#DE9A2B", st4: "#B8551D" }, G_JEAN = { st0: "Tissu", st3: "Surpiqûres", st4: "Rivets" };
const CATALOGUE = [
  P("femme", "jean", "Jean", "jean", { st0: "#165176", ...JEAN }, G_JEAN),
  P("femme", "pantalon-toile", "Pantalon de toile", "toile", { st0: "#F4D9AE", st3: "#24222C" }, { st0: "Tissu", st3: "Ceinture" }),
  P("femme", "pantalon-pinces", "Pantalon à pinces", "pinces", { st0: "#545454", st4: "#E4AF73" }, { st0: "Tissu", st4: "Boutons" }),
  P("femme", "jupe-droite", "Jupe droite", "jupeDroite", { st0: "#BD1212" }, { st0: "Tissu" }, { s: 8 }),
  P("femme", "jupe-plissee", "Jupe plissée", "jupePlissee", { st0: "#2A5E21" }, { st0: "Tissu" }, { s: 12 }),
  P("femme", "jupe-longue-etalee", "Jupe longue étalée", "jupeLongue", { st0: "#0056AF", st3: "#F4D9AE" }, { st0: "Tissu", st3: "Galon" }, { s: 20 }),
  P("femme", "short", "Short", "short", { st0: "#5E9ABF", st3: "#EDD7C6" }, { st0: "Tissu", st3: "Revers" }),
  P("femme", "legging", "Legging", "legging", { st0: "#273252" }, { st0: "Tissu" }),
  P("femme", "jogging", "Jogging", "jogging", { st0: "#13266D", st3: "#FAFAFA" }, { st0: "Tissu", st3: "Bandes" }),
  P("femme", "robe-bas", "Bas de robe", "robeBas", { st0: "#FF96BF" }, { st0: "Tissu" }, { s: 20 }),
  P("homme", "jean", "Jean", "jean", { st0: "#165176", ...JEAN }, G_JEAN),
  P("homme", "pantalon-toile", "Pantalon de toile", "toile", { st0: "#F4D9AE", st3: "#431A00" }, { st0: "Tissu", st3: "Ceinture" }),
  P("homme", "pantalon-costume", "Pantalon de costume", "costume", { st0: "#273252", st3: "#000000", st4: "#E4AF73" }, { st0: "Tissu", st3: "Ceinture", st4: "Boutons" }),
  P("homme", "short", "Short", "short", { st0: "#5E4A19", st3: "#F4D9AE" }, { st0: "Tissu", st3: "Revers" }),
  P("homme", "jogging", "Jogging", "jogging", { st0: "#13266D", st3: "#FAFAFA" }, { st0: "Tissu", st3: "Bandes" }),
  P("homme", "bermuda-carreaux", "Bermuda à carreaux", "bermudaCarreaux", { st0: "#2A5E21", st3: "#F4D9AE" }, { st0: "Tissu", st3: "Filets" }),
  P("enfant", "jean", "Jean", "jean", { st0: "#5E9ABF", ...JEAN }, G_JEAN),
  P("enfant", "pantalon", "Pantalon", "toile", { st0: "#B8551D", st3: "#431A00" }, { st0: "Tissu", st3: "Ceinture" }),
  P("enfant", "short", "Short", "short", { st0: "#13266D", st3: "#5E9ABF" }, { st0: "Tissu", st3: "Revers" }),
  P("enfant", "jupe", "Jupe plissée", "jupeEnfant", { st0: "#FF96BF", st3: "#FAFAFA" }, { st0: "Tissu", st3: "Ceinture" }, { s: 10 }),
  P("enfant", "legging", "Legging", "legging", { st0: "#BD1212" }, { st0: "Tissu" }),
  P("enfant", "robe-bas", "Bas de robe", "robeBas", { st0: "#0056AF", st3: "#FAFAFA" }, { st0: "Tissu", st3: "Ourlet" }, { s: 14, option: true }),
  P("ado", "jean", "Jean", "jean", { st0: "#165176", ...JEAN }, G_JEAN),
  P("ado", "jogging", "Jogging", "jogging", { st0: "#545454", st3: "#FAFAFA" }, { st0: "Tissu", st3: "Bandes" }),
  P("ado", "short", "Short", "short", { st0: "#DE9A2B", st3: "#F4D9AE" }, { st0: "Tissu", st3: "Revers" }),
  P("ado", "pantalon-cargo", "Pantalon cargo", "cargo", { st0: "#5E4A19", st4: "#DE9A2B" }, { st0: "Tissu", st4: "Boutons" }),
];
// Couleurs d'essai pour la colonne recolorée de la planche.
const ESSAI = ["#BD1212", "#0056AF", "#DE9A2B", "#2A5E21", "#FF96BF", "#5E9ABF", "#B8551D", "#9EDFBF"];

const snake = (s) => s.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join("_");
const sansAccent = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

// ---------- mesure des familles ----------
const MES = {};
for (const f of Object.keys(FAMILLES)) MES[f] = mesurerFamille(f, REF);

// ---------- SVG ----------
function ecrireSvg(p, formes, zones, pos) {
  const F = FAMILLES[p.famille];
  const ordre = ["st0", "st2", "st3", "st4", "st1"].filter((k) => formes[k].length);
  const regles = ["st0", "st1", "st2", "st3", "st4"].filter((k) => formes[k].length)
    .map((k) => k === "st1" ? "\t.st1{opacity:0.15;}" : `\t.${k}{fill:${zones[k]};}`);
  const chemins = ordre.flatMap((k) => formes[k].map((poly) => versD([poly])).filter(Boolean).map((d) => `\t<path class="${k}" d="${d}"/>`));
  const fam = p.famille[0].toUpperCase() + p.famille.slice(1);
  return `<!-- ${MARQUE}, generee par garde-robe/bas/gen.mjs : ${sansAccent(p.libelle)} ${p.famille} -->
<svg version="1.1" id="Gabarit_Piece_Bas_${fam}_${snake(p.nom)}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" width="500px" height="1000px" viewBox="0 0 500 1000" style="enable-background:new 0 0 500 1000;" xml:space="preserve">
<style type="text/css">
${regles.join("\n")}
</style>
<g id="${F.prefixe}_Bottoms_${pos}">
${chemins.join("\n")}
</g>
</svg>
`;
}

/** Contenu d'un SVG à classes, réécrit en attributs (pour composer plusieurs dessins dans une case). */
function enLigne(svg, recolor = {}) {
  const st = {};
  for (const m of svg.matchAll(/\.(st\d+)\{([^}]*)\}/g)) st[m[1]] = m[2];
  const corps = svg.replace(/^[\s\S]*?<\/style>/, "").replace(/<\/svg>\s*$/, "");
  return corps.replace(/class="(st\d+)"/g, (_, k) => {
    const r = st[k] || "";
    if (/opacity/.test(r)) return 'fill="#000" fill-opacity="0.15"';
    const col = recolor[k] || (r.match(/fill:(#[0-9A-Fa-f]+)/) || [])[1] || "#000";
    return `fill="${col}"`;
  });
}

// ---------- contrôle ----------
async function alpha(svg) {
  const { data } = await sharp(Buffer.from(svg), { density: 72 }).resize(500, 1000, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const a = new Uint8Array(500 * 1000);
  for (let i = 0; i < a.length; i++) a[i] = data[i * 4 + 3];
  return a;
}
const cacheCorps = {};
async function controle(p, svgPiece, M, jupe) {
  const F = M.F, A = await alpha(svgPiece), res = {};
  const n = M.parCorps[0].rangs.length;
  const AG = Array.from({ length: n }, (_, i) => Math.max(...M.parCorps.map((b) => b.rangs[i].aG)));
  const AD = Array.from({ length: n }, (_, i) => Math.min(...M.parCorps.map((b) => b.rangs[i].aD)));
  const aMaxG = (i) => AG[i], aMinD = (i) => AD[i];
  for (const b of M.parCorps) {
    const B = cacheCorps[b.ref] ||= await alpha(b.svg);
    let peau = 0, sousMain = 0, mains = 0, debord = 0;
    for (const r of b.rangs) {
      const y = r.y, i = y - F.haut;
      for (let x = 0; x < 500; x++) {
        const k = y * 500 + x, xc = x + 0.5, corps = B[k] > 128, piece = A[k] > 128;
        if (corps && !piece && r.cG !== null && xc >= r.cG && xc <= r.cD) {
          if (xc < aMaxG(i) + 0.5 || xc > aMinD(i) - 0.5) sousMain++; else peau++;
        }
        if (corps && piece && (xc < r.aG - 0.5 || xc > r.aD + 0.5)) mains++;
      }
    }
    // débord : distance d'un pixel de la pièce hors du corps au corps le plus proche
    const yMax = jupe ? F.assise - 25 : 1000;
    for (let y = F.haut - 2; y < Math.min(yMax, F.assise + 3); y++) for (let x = 0; x < 500; x++) {
      const k = y * 500 + x;
      if (A[k] <= 128 || B[k] > 128) continue;
      let d = 0;
      for (let rr = 1; rr <= 60 && !d; rr++) {
        for (let dy = -rr; dy <= rr && !d; dy++) for (const dx of (Math.abs(dy) === rr ? range(-rr, rr) : [-rr, rr])) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && xx < 500 && yy >= 0 && yy < 1000 && B[yy * 500 + xx] > 128) { d = rr; break; }
        }
      }
      debord = Math.max(debord, d || 61);
    }
    res[b.nom] = { peau_visible_px: peau, peau_sous_main_px: sousMain, mains_couvertes_px: mains, debord_max_px: debord };
  }
  return res;
}
function range(a, b) { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; }

// ---------- génération ----------
const index = { categorie: "bas", date: "2026-11-27", generateur: "garde-robe/bas/gen.mjs", pieces: [] };
const rendus = [], parts = {};
let pos = 1000;
for (const p of CATALOGUE) {
  const M = MES[p.famille], F = M.F;
  const jupe = p.s !== undefined;
  const sil = jupe ? silJupe(M, p.s) : silPantalon(M);
  const formes = dessiner(p.type, sil, p.option);
  const zones = { st0: p.couleurs.st0 };
  if (formes.st2.length) zones.st2 = nuance(p.couleurs.st0);
  if (formes.st3.length) zones.st3 = p.couleurs.st3;
  if (formes.st4.length) zones.st4 = p.couleurs.st4;
  for (const k of Object.keys(zones)) if (!zones[k]) throw new Error(`${p.famille}/${p.nom} : couleur manquante pour ${k}`);
  const fichier = `gabarit-piece-bas-${p.famille}-${p.nom}.svg`;
  const svg = ecrireSvg(p, formes, zones, pos);
  writeFileSync(SORTIE + fichier, svg);
  const ctl = await controle(p, svg, M, jupe);
  // part de chaque zone dans le dessin rendu (ombre exclue), pour le contrôle des familles de teinte
  {
    const cols = { st0: "#FF0000", st2: "#00FF00", st3: "#0000FF", st4: "#FFFF00" };
    const plat = svg.replace(/<path class="st1"[^>]*>/g, "").replace(/\.(st[0234])\{fill:#[0-9A-F]{6};\}/g, (_, k) => `.${k}{fill:${cols[k]};}`);
    const { data } = await sharp(Buffer.from(plat), { density: 72 }).resize(500, 1000, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const n = { st0: 0, st2: 0, st3: 0, st4: 0 }; let tot = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 250) continue; tot++;
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      if (r > 250 && g < 5 && b < 5) n.st0++; else if (g > 250 && r < 5 && b < 5) n.st2++; else if (b > 250 && r < 5 && g < 5) n.st3++; else if (r > 250 && g > 250 && b < 5) n.st4++;
    }
    parts[fichier] = Object.fromEntries(Object.entries(n).filter(([k]) => zones[k]).map(([k, v]) => [k, Math.round(v / tot * 1000) / 1000]));
  }
  // emprise
  const pts = Object.values(formes).flat(3);
  const xs = pts.filter((_, k) => k % 2 === 0), ys = pts.filter((_, k) => k % 2 === 1);
  const zInfo = {};
  zInfo.st0 = { couleur: zones.st0, groupe: p.groupes.st0, role: "principale" };
  if (zones.st2) zInfo.st2 = { couleur: zones.st2, groupe: p.groupes.st0, role: "nuance", de: "st0" };
  if (zones.st3) zInfo.st3 = { couleur: zones.st3, groupe: p.groupes.st3, role: "partie" };
  if (zones.st4) zInfo.st4 = { couleur: zones.st4, groupe: p.groupes.st4, role: "detail" };
  const sm = Math.max(...Object.values(ctl).map((c) => c.peau_sous_main_px));
  const db = Math.max(...Object.values(ctl).map((c) => c.debord_max_px));
  const notes = [];
  if (sm > 30) notes.push("Peau laissée sous la main des corps larges (peau_sous_main_px) : la main du corps le plus fin passe à cet endroit, on ne la couvre pas.");
  if (db > 6) notes.push(`Débord jusqu'à ${db} px sur le corps le plus fin : le bas couvre les hanches du corps le plus large, un seul fichier ne peut pas faire les deux.`);
  if (jupe) notes.push(`Jupe : le tissu s'étale sur l'assise jusqu'à ${p.s} px au-delà du ras de l'assise, sous y = ${F.assise - 25} (débord non compté).`);
  if (p.nom === "robe-bas") notes.push("Taille sans ceinture, faite pour être cachée par l'ourlet du haut.");
  index.pieces.push({
    fichier, url: "/assets/" + fichier, familles: [p.famille],
    gabarits: F.corps.map(([n]) => n), slot: "pants", view: "back", nom: p.libelle,
    id_groupe: `${F.prefixe}_Bottoms_${pos}`, position_proposee: pos, nuancier: "pantalon",
    zones: zInfo, ombre: "st1",
    emprise: { x: [Math.floor(Math.min(...xs)), Math.ceil(Math.max(...xs))], y: [Math.floor(Math.min(...ys)), Math.ceil(Math.max(...ys))] },
    controle: ctl, volumineuse: false, notes: notes.join(" "),
  });
  rendus.push({ p, svg, fichier, M, zones });
  console.log(pos, fichier, JSON.stringify(Object.fromEntries(Object.entries(ctl).map(([k, v]) => [k.replace("gabarit-dos-", "").replace(".svg", ""), Object.values(v).join("/")]))));
  pos++;
}
writeFileSync(D + "index.json", JSON.stringify(index, null, 1) + "\n");
// parts des zones dans le dessin : lues par verif.ts pour former les familles de teinte comme le client
writeFileSync(D + "parts.json", JSON.stringify(parts, null, 1) + "\n");

// ---------- planches ----------
const habitsOrig = {};
for (const f of Object.keys(FAMILLES)) {
  const F = FAMILLES[f], s = readFileSync(D + "orig/" + F.source + ".svg", "utf8");
  const style = s.match(/<style[\s\S]*?<\/style>/)[0];
  const g = s.match(new RegExp(`<g id="${F.habits}">[\\s\\S]*?</g>`))[0];
  habitsOrig[f] = enLigne(`<svg>${style}${g}</svg>`);
}
async function caseImg(f, corpsSvg, pieceSvg, recolor, titre, avecHaut = true) {
  const F = FAMILLES[f], y0 = F.haut - 95, y1 = F.assise + 20, x0 = 15, x1 = 485;
  const sc = 0.8, W = Math.round((x1 - x0) * sc), H = Math.round((y1 - y0) * sc);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}">
<rect x="0" y="0" width="500" height="1000" fill="#F6F4EE"/>
<line x1="0" y1="${F.assise}" x2="500" y2="${F.assise}" stroke="#C9B9A0" stroke-width="1"/>
${corpsSvg ? enLigne(corpsSvg) : ""}${enLigne(pieceSvg, recolor)}
${avecHaut ? `<g fill-opacity="0.12" stroke="#1A1A1A" stroke-width="1.6" stroke-dasharray="5 3" stroke-opacity="0.8">${habitsOrig[f].replace(/fill="#000" fill-opacity="0.15"/g, 'fill="none" stroke="none"')}</g>` : ""}
<text x="${x0 + 4}" y="${y0 + 12}" font-family="sans-serif" font-size="11" fill="#333">${titre}</text></svg>`;
  return { buf: await sharp(Buffer.from(svg)).png().toBuffer(), W, H };
}
for (const f of Object.keys(FAMILLES)) {
  const M = MES[f], liste = rendus.filter((r) => r.p.famille === f);
  const tiles = []; let W = 0, H = 0;
  for (const [ri, r] of liste.entries()) {
    const cols = [];
    for (const b of M.parCorps) cols.push(await caseImg(f, b.svg, r.svg, {}, `${r.p.nom} / ${b.nom.replace("gabarit-dos-", "").replace(".svg", "")}`));
    const rc = ESSAI[(ri * 3) % ESSAI.length], recolor = { st0: rc, st2: nuance(rc) };
    if (r.zones.st3) recolor.st3 = ESSAI[(ri * 3 + 5) % ESSAI.length];
    cols.push(await caseImg(f, M.parCorps[0].svg, r.svg, recolor, "recoloree"));
    cols.push(await caseImg(f, null, r.svg, {}, "piece seule", false));
    cols.forEach((c, ci) => { tiles.push({ input: c.buf, left: ci * (c.W + 4), top: ri * (c.H + 4) }); W = Math.max(W, (ci + 1) * (c.W + 4)); H = Math.max(H, (ri + 1) * (c.H + 4)); });
  }
  await sharp({ create: { width: W, height: H, channels: 3, background: "#FFFFFF" } }).composite(tiles).jpeg({ quality: 82 }).toFile(D + `planche-${f}.jpg`);
}
// vue d'ensemble : chaque pièce sur le corps standard de sa famille, en entier
{
  const tiles = [], cw = 200, ch = 400, nc = 9;
  for (const [i, r] of rendus.entries()) {
    const b = r.M.parCorps[(i % r.M.parCorps.length)];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}" viewBox="0 100 500 1000"><rect x="0" y="0" width="500" height="1100" fill="#F6F4EE"/>${enLigne(b.svg)}${enLigne(r.svg)}<text x="10" y="1085" font-family="sans-serif" font-size="30" fill="#333">${r.p.famille} ${r.p.nom}</text></svg>`;
    tiles.push({ input: await sharp(Buffer.from(svg)).png().toBuffer(), left: (i % nc) * cw, top: Math.floor(i / nc) * ch });
  }
  await sharp({ create: { width: nc * cw, height: Math.ceil(rendus.length / nc) * ch, channels: 3, background: "#FFFFFF" } }).composite(tiles).jpeg({ quality: 82 }).toFile(D + "planche.jpg");
}

// ---------- copie locale dans data/assets ----------
if (process.argv.includes("--assets")) {
  for (const r of rendus) {
    const cible = "/app/data/assets/" + r.fichier;
    if (existsSync(cible) && !readFileSync(cible, "utf8").includes(MARQUE)) throw new Error("existe déjà sans la marque, on s'arrête : " + cible);
    writeFileSync(cible, r.svg);
  }
  console.log("copie dans /app/data/assets :", rendus.length);
}
console.log("fini :", rendus.length, "pièces");
