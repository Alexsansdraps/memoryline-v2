// Gabarits de dos, assis (27/11). Alexandra : « tu saurais faire un chantier où on
// réécrit tous les personnages avec leurs accessoires et plus besoin d'avoir à les caler
// du coup parce qu'ils sont tous unifiés ? » — « il faudrait que les personnages aient
// tous le même style du coup, et proche de l'actuel, pas que ça choque margaux ».
//
// Principe : chaque famille de garde-robe part d'UN corps existant de dos (Male_2,
// Female_2, Boys_2, Teenage_Boys_1, Baby_Boy), recopié tel quel (mêmes courbes, même
// peau, mêmes ombres noires à 15 %). Les morphologies (fine, ronde, âgée) sont obtenues
// par une déformation douce qui vaut EXACTEMENT zéro au crâne, à la tête et à la ligne
// d'assise : une coiffure ou un chapeau dessinés sur un gabarit tombent juste sur tous
// les gabarits de sa famille, sans calage. Les animaux nouveaux (cheval, lapin) sont
// dessinés à la main dans le même style (aplats, ombre noire à 15 %, sans contour).
//
// AJOUT PUR : on n'écrit que des fichiers neufs « gabarit-dos-*.svg » ; si un fichier
// de ce nom existe déjà et n'a pas été produit par ce script, on s'arrête.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const ASSETS = process.argv[2];
// 27/11, Alexandra : « si la plupart ressemblent déjà à ceux qui sont présents, tu peux
// supprimer : le calage et ceux qui sont déjà présents ! (les nouveaux persos) ».
// Les corps « standard » (Female_2, Male_2, Boys_2, Teenage_Boys_1) sont les personnages
// actuels, nus : on ne les écrit plus dans data/assets (doublons), seulement dans REF, pour
// mesurer l'enveloppe de la famille (une pièce neuve doit aussi les couvrir). Bébé, chiens
// et chat n'avaient que leur corps actuel : retirés.
const REF = process.argv[4];
const OUT_DEF = process.argv[3];
const MARQUE = "Gabarit de dos genere le 27/11";

// ---------- lecture des chemins SVG ----------
function tokens(d) {
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  const out = [];
  let m;
  while ((m = re.exec(d))) out.push(m[1] ? m[1] : parseFloat(m[2]));
  return out;
}
// Renvoie une liste de segments absolus : ["M",x,y] ["L",x,y] ["C",x1,y1,x2,y2,x,y] ["Z"]
function absolu(d) {
  const t = tokens(d);
  const segs = [];
  let i = 0, cmd = null, cx = 0, cy = 0, sx = 0, sy = 0, lc = null;
  const num = () => t[i++];
  while (i < t.length) {
    if (typeof t[i] === "string") cmd = t[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === "Z") { segs.push(["Z"]); cx = sx; cy = sy; lc = null; continue; }
    if (C === "M") {
      let x = num(), y = num(); if (rel) { x += cx; y += cy; }
      segs.push(["M", x, y]); cx = sx = x; cy = sy = y; lc = null;
      cmd = rel ? "l" : "L"; continue;
    }
    if (C === "L") { let x = num(), y = num(); if (rel) { x += cx; y += cy; } segs.push(["L", x, y]); cx = x; cy = y; lc = null; continue; }
    if (C === "H") { let x = num(); if (rel) x += cx; segs.push(["L", x, cy]); cx = x; lc = null; continue; }
    if (C === "V") { let y = num(); if (rel) y += cy; segs.push(["L", cx, y]); cy = y; lc = null; continue; }
    if (C === "C" || C === "S") {
      let x1, y1;
      if (C === "C") { x1 = num(); y1 = num(); if (rel) { x1 += cx; y1 += cy; } }
      else { x1 = lc ? 2 * cx - lc[0] : cx; y1 = lc ? 2 * cy - lc[1] : cy; }
      let x2 = num(), y2 = num(), x = num(), y = num();
      if (rel) { x2 += cx; y2 += cy; x += cx; y += cy; }
      segs.push(["C", x1, y1, x2, y2, x, y]); lc = [x2, y2]; cx = x; cy = y; continue;
    }
    if (C === "Q" || C === "T") throw new Error("Q/T non prévu");
    if (C === "A") throw new Error("A non prévu");
    throw new Error("commande inconnue " + cmd);
  }
  return segs;
}
const f1 = (v) => {
  const r = Math.round(v * 10) / 10;
  return (Object.is(r, -0) ? 0 : r).toString();
};
function serialise(segs, warp) {
  let s = "";
  for (const g of segs) {
    if (g[0] === "Z") { s += "z"; continue; }
    const pts = [];
    for (let k = 1; k < g.length; k += 2) { const [x, y] = warp(g[k], g[k + 1]); pts.push(f1(x) + "," + f1(y)); }
    s += g[0] + pts.join(" ");
  }
  return s;
}

// ---------- extraction du corps d'un dessin existant ----------
function styles(svg) {
  const m = {};
  for (const x of svg.matchAll(/\.(st\d+)\s*\{([^}]*)\}/g)) m[x[1]] = x[2];
  return m;
}
function groupe(svg, idRe) {
  const m = svg.match(new RegExp(`<g[^>]*id="(${idRe})"[^>]*>([\\s\\S]*?)</g>`));
  return m ? m[2] : null;
}
function chemins(fragment) {
  const out = [];
  for (const p of fragment.matchAll(/<path\b([^>]*)>/g)) {
    const a = p[1];
    const d = (a.match(/\sd="([^"]*)"/) || [])[1];
    const cl = (a.match(/class="([^"]*)"/) || [])[1];
    if (d) out.push({ d: d.replace(/\s+/g, " "), cl });
  }
  return out;
}
function corps(fichier, idRe, cheminSeulId) {
  const svg = readFileSync(ASSETS + "/" + fichier, "utf8");
  const st = styles(svg);
  let frag;
  if (cheminSeulId) {
    const m = svg.match(new RegExp(`<path[^>]*id="${cheminSeulId}"[^>]*>`));
    frag = m[0];
  } else frag = groupe(svg, idRe);
  if (!frag) throw new Error("pas de corps dans " + fichier);
  return chemins(frag).map((p) => ({ segs: absolu(p.d), style: st[p.cl] || "" }));
}

// ---------- déformations ----------
const ident = (x, y) => [x, y];
const lisse = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
// bosse en cloche, nulle hors de [c-w, c+w] (exactement nulle : les repères ne bougent pas)
const cloche = (y, c, w) => { const u = Math.abs(y - c) / w; return u >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * u); };
// largeur : x' = 250 + (x-250)*(1 + Σ a·cloche(y))
function largeur(bosses) {
  return (x, y) => {
    let k = 1;
    for (const [a, c, w] of bosses) k += a * cloche(y, c, w);
    return [250 + (x - 250) * k, y];
  };
}
// dos voûté : le haut du dos et la naissance du cou remontent de h px (la tête ne bouge pas),
// les épaules restent à leur place au bout du bras : la pente devient plus forte, le cou
// rentre dans les épaules.
function voute(h, yTeteBas, yCou, yFin, demiPlat, demiLarg) {
  return (x, y) => {
    let fy;
    if (y <= yTeteBas || y >= yFin) fy = 0;
    else if (y <= yCou) fy = lisse((y - yTeteBas) / (yCou - yTeteBas));
    else fy = 1 - lisse((y - yCou) / (yFin - yCou));
    const ax = Math.abs(x - 250);
    const fx = ax <= demiPlat ? 1 : ax >= demiLarg ? 0 : 1 - lisse((ax - demiPlat) / (demiLarg - demiPlat));
    return [x, y - h * fx * fy];
  };
}
// 27/11, relecture : la première voûte (haut du dos remonté de 30 px en plateau) faisait un
// cou de taureau et une pente d'épaule droite : un costaud, pas une personne âgée. Ici : un
// dos rond (bosse en cloche sur l'axe, en dôme) qui remonte moins, et des épaules qui
// TOMBENT (le bout de l'épaule descend et rentre). Tête et crâne inchangés, assise inchangée.
function vieillir({ h, yTeteBas, yCou, yFin, rx, chute, yEp, wEp, rentre }) {
  return (x, y) => {
    let fy;
    if (y <= yTeteBas || y >= yFin) fy = 0;
    else if (y <= yCou) fy = lisse((y - yTeteBas) / (yCou - yTeteBas));
    else fy = 1 - lisse((y - yCou) / (yFin - yCou));
    const ax = Math.abs(x - 250);
    const dome = cloche(ax, 0, rx);
    const bout = lisse((ax - 50) / 90) * cloche(y, yEp, wEp);
    const sx = Math.sign(x - 250);
    return [x - sx * rentre * bout, y - h * dome * fy + chute * bout];
  };
}
const compose = (...ws) => (x, y) => ws.reduce((p, w) => w(p[0], p[1]), [x, y]);

// ---------- écriture ----------
function ecrire(dir, nom, idSvg, idGroupe, couleurs, paths, warp, entete) {
  // classes : st0 = peau/robe principale, st1 = ombre noire à 15 %, puis les autres aplats
  const ordre = [];
  const cle = (s) => {
    const fill = (s.match(/fill:\s*(#[0-9A-Fa-f]{3,6})/) || [])[1];
    if (/opacity:\s*0?\.15/.test(s) && !fill) return "ombre";
    return fill ? fill.toUpperCase() : "ombre";
  };
  for (const p of paths) { const k = cle(p.style); if (!ordre.includes(k)) ordre.push(k); }
  const fills = ordre.filter((k) => k !== "ombre");
  const classes = {};
  classes[fills[0]] = "st0";
  classes["ombre"] = "st1";
  fills.slice(1).forEach((k, i) => (classes[k] = "st" + (i + 2)));
  const remap = (k) => (couleurs && couleurs[k]) || k;
  let style = `\t.st0{fill:${remap(fills[0])};}\n\t.st1{opacity:0.15;}\n`;
  fills.slice(1).forEach((k, i) => (style += `\t.st${i + 2}{fill:${remap(k)};}\n`));
  let corpsSvg = "";
  for (const p of paths) {
    const d = p.d ? p.d : serialise(p.segs, warp);
    corpsSvg += `\t<path class="${classes[cle(p.style)]}" d="${d}"/>\n`;
  }
  const svg = `<!-- ${MARQUE} : ${entete} -->
<svg version="1.1" id="${idSvg}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" width="500px" height="1000px" viewBox="0 0 500 1000" style="enable-background:new 0 0 500 1000;" xml:space="preserve">
<style type="text/css">
${style}</style>
<g id="${idGroupe}">
${corpsSvg}</g>
</svg>
`;
  const f = dir + "/" + nom;
  if (existsSync(f) && !readFileSync(f, "utf8").includes(MARQUE)) throw new Error("fichier existant non généré par ce script : " + nom);
  writeFileSync(f, svg);
  return { fichier: nom, zones: Object.fromEntries(Object.entries(classes).filter(([k]) => k !== "ombre").map(([k, v]) => [v, remap(k)])) };
}

// ---------- dessins neufs : cheval couché de dos, lapin assis de dos ----------
// Chemins écrits à la main, en absolu, dans le style des animaux existants.
const P = (d, style) => ({ d, style });
// 27/11, relecture : le premier cheval se lisait mal (encolure droite comme un goulot, queue
// en trait sombre). Ici : encolure qui s'affine vers la nuque, crinière en mèches sur le
// côté, ventre qui déborde à gauche (couché, pattes repliées à droite), queue en crins qui
// s'évase et se pose au sol. Teintes de Horse_1 : robe #C57745, crins #865F4A, queue #5B392E.
const CHEVAL = [
  // ventre et flanc gauche, couché (au fond : ombré en entier)
  P("M42,822C34,770 52,716 104,690C150,668 214,664 260,676L260,822Z", "fill:#C57745;"),
  P("M42,822C34,770 52,716 104,690C150,668 214,664 260,676L260,822Z", "opacity:0.15;"),
  // encolure : large au garrot, fine à la nuque
  P("M176,612C180,530 194,452 208,378C228,366 272,366 292,378C306,452 320,530 324,612Z", "fill:#C57745;"),
  P("M292,378C306,452 320,530 324,612L294,612C296,532 292,456 280,384Z", "opacity:0.15;"),
  // crinière : mèches qui tombent sur le côté gauche de l'encolure
  P("M234,262C246,254 258,254 266,262C260,298 246,334 230,370C222,392 216,416 212,440C206,468 200,500 196,530C192,560 188,588 186,612L168,612C172,596 166,584 172,570C176,552 172,540 178,524C184,506 180,494 188,476C194,458 192,444 198,428C204,406 206,388 214,366C222,334 228,298 234,262Z", "fill:#865F4A;"),
  // arrière de la tête (nuque et ganaches), vue de dos
  P("M250,252C278,252 296,262 300,284C304,308 310,334 310,352C310,372 292,382 250,382C208,382 190,372 190,352C190,334 196,308 200,284C204,262 222,252 250,252Z", "fill:#C57745;"),
  P("M286,258C296,266 300,284 300,284C304,308 310,334 310,352C310,372 292,382 268,382C288,366 294,320 286,258Z", "opacity:0.15;"),
  P("M210,378C230,388 270,388 290,378L292,398C272,406 228,406 208,398Z", "opacity:0.15;"),
  // oreilles
  P("M212,274C206,246 207,218 218,198C230,216 240,238 242,260Z", "fill:#C57745;"),
  P("M288,274C294,246 293,218 282,198C270,216 260,238 258,260Z", "fill:#C57745;"),
  P("M288,274C294,246 293,218 282,198C286,224 284,248 276,266Z", "opacity:0.15;"),
  // toupet de crinière entre les oreilles
  P("M236,266C238,252 244,244 250,242C256,244 262,252 264,266C256,262 244,262 236,266Z", "fill:#865F4A;"),
  // croupe : deux lobes et le sillon au milieu
  P("M250,570C232,552 208,542 180,542C130,542 98,582 90,636C82,680 82,724 86,764C90,806 110,822 152,822L348,822C390,822 410,806 414,764C418,724 418,680 410,636C402,582 370,542 320,542C292,542 268,552 250,570Z", "fill:#C57745;"),
  // jambe arrière repliée qui dépasse à droite, sabot sombre
  P("M378,768C404,770 432,778 448,790C460,798 460,816 448,822L374,822Z", "fill:#C57745;"),
  P("M440,788C454,792 464,802 464,810C464,820 456,822 446,822L432,822C438,812 440,800 440,788Z", "fill:#865F4A;"),
  // ombres : côté droit de la croupe, creux du sillon
  P("M320,542C370,542 402,582 410,636C418,680 418,724 414,764C410,806 390,822 348,822L298,822C346,800 376,762 380,710C384,646 366,584 320,542Z", "opacity:0.15;"),
  P("M250,570C240,582 236,604 240,634C244,614 248,594 250,582C252,594 256,614 260,634C264,604 260,582 250,570Z", "opacity:0.15;"),
  // queue : crins qui partent du haut du sillon, s'évasent et se posent au sol
  P("M238,566C230,604 226,654 226,704C226,752 218,792 204,820C226,822 266,822 296,820C284,792 276,752 276,704C276,654 270,604 262,566C256,558 244,558 238,566Z", "fill:#5B392E;"),
  P("M256,566C266,604 270,654 270,704C270,752 278,792 296,820C284,792 276,752 276,704C276,654 270,604 262,566Z", "opacity:0.15;"),
  P("M246,640C244,690 240,750 228,814L236,814C246,754 250,694 250,642Z", "opacity:0.15;"),
];
// 27/11 au soir, Alexandra : « le cheval il faut le faire debout pas assis et de dos »
// (le couché « fait peur »). Vu de dos, debout : la croupe ronde en deux lobes, la queue
// qui tombe au milieu, les deux postérieurs jusqu'au sol (sabots sombres, même ligne de
// sol que les personnages assis : 874), et au-dessus de la croupe le dos, l'encolure et
// l'arrière de la tête, plus petits (ils sont plus loin). Mêmes teintes que le couché.
// Le seul personnage DEBOUT (exception voulue par Alexandra) : à la création au BO, lui
// donner un facteur de taille d'environ 2 pour qu'il soit à l'échelle des humains assis.
const CHEVAL_DEBOUT = [
  // postérieurs (sous la croupe) : cuisse, jarret, canon, sabot
  P("M158.2,628C162.7,682 176,720 190.8,752C196.7,770 198.2,800 196.7,840L195.2,852L226.3,852L224.8,840C223.4,800 224.8,774 229.3,754C236.7,720 239.6,682 239.6,646Z", "fill:#C57745;"),
  P("M341.8,628C337.3,682 324,720 309.2,752C303.3,770 301.8,800 303.3,840L304.8,852L273.7,852L275.2,840C276.6,800 275.2,774 270.7,754C263.3,720 260.4,682 260.4,646Z", "fill:#C57745;"),
  P("M309.2,752C303.3,770 301.8,800 303.3,840L304.8,852L292.9,852C291.4,800 291.4,772 295.9,752C304.8,720 313.6,691 319.6,655C325.5,691 319.6,726 309.2,752Z", "opacity:0.15;"),
  P("M229.3,754C224.8,774 223.4,800 224.8,840L226.3,852L216,852C214.5,800 216,772 218.9,752C224.8,724 230.8,694.6 235.2,664C239.6,694.6 236.7,728 229.3,754Z", "opacity:0.15;"),
  P("M192.3,850L229.3,850L232.2,874L189.3,874Z", "fill:#5B392E;"),
  P("M270.7,850L307.7,850L310.7,874L267.8,874Z", "fill:#5B392E;"),
  // encolure, plus loin, au-dessus de la croupe
  P("M200,420C204,370 212,320 220,272C234,264 266,264 280,272C288,320 296,370 300,420Z", "fill:#C57745;"),
  P("M280,272C288,320 296,370 300,420L280,420C282,370 280,320 272,276Z", "opacity:0.15;"),
  // crinière sur le côté gauche de l'encolure
  P("M236,206C246,200 256,200 262,206C256,232 246,256 236,280C228,300 222,322 218,344C214,368 208,394 204,420L188,420C192,404 186,394 192,380C196,364 192,352 198,338C204,320 204,306 212,288C220,262 228,236 236,206Z", "fill:#865F4A;"),
  // arrière de la tête, oreilles, toupet
  P("M250,196C272,196 286,204 290,222C293,242 298,262 298,276C298,292 284,300 250,300C216,300 202,292 202,276C202,262 207,242 210,222C214,204 228,196 250,196Z", "fill:#C57745;"),
  P("M278,202C288,210 290,222 290,222C293,242 298,262 298,276C298,292 284,300 264,300C280,286 284,252 278,202Z", "opacity:0.15;"),
  P("M216,214C211,192 212,170 221,154C231,168 239,186 241,204Z", "fill:#C57745;"),
  P("M284,214C289,192 288,170 279,154C269,168 261,186 259,204Z", "fill:#C57745;"),
  P("M284,214C289,192 288,170 279,154C282,176 281,194 274,208Z", "opacity:0.15;"),
  P("M238,208C240,196 245,189 250,187C255,189 260,196 262,208C255,205 245,205 238,208Z", "fill:#865F4A;"),
  // croupe : deux lobes et le sillon (27/11 au soir, Alexandra : « le cheval a un gros cul » : resserrée de 26 %)
  P("M250,448C236.7,433.6 220.4,426.4 201.2,426.4C164.2,426.4 139,462.4 136,511C133.1,556 137.5,610 150.8,646C164.2,682 189.3,700 217.4,700L282.6,700C310.7,700 335.8,682 349.2,646C362.5,610 366.9,556 364,511C361,462.4 335.8,426.4 298.8,426.4C279.6,426.4 263.3,433.6 250,448Z", "fill:#C57745;"),
  P("M298.8,426.4C335.8,426.4 361,462.4 364,511C366.9,556 362.5,610 349.2,646C335.8,682 310.7,700 282.6,700C315.1,678.4 334.4,628 334.4,574C334.4,509.2 324,457 298.8,426.4Z", "opacity:0.15;"),
  P("M250,448C242.6,460.6 239.6,482.2 242.6,511C245.6,491.2 248.5,473.2 250,462.4C251.5,473.2 254.4,491.2 257.4,511C260.4,482.2 257.4,460.6 250,448Z", "opacity:0.15;"),
  // queue : crins qui partent du haut du sillon et tombent entre les jarrets
  P("M241.1,444.4C235.2,480.4 232.2,529 232.2,579.4C232.2,628 227.8,673 220.4,716C233.7,722 266.3,722 279.6,716C272.2,673 267.8,628 267.8,579.4C267.8,529 264.8,480.4 258.9,444.4C254.4,437.2 245.6,437.2 241.1,444.4Z", "fill:#5B392E;"),
  P("M254.4,444.4C261.8,480.4 264.8,529 264.8,579.4C264.8,628 269.2,673 279.6,716C272.2,673 267.8,628 267.8,579.4C267.8,529 264.8,480.4 258.9,444.4Z", "opacity:0.15;"),
  P("M247,511C245.6,574 242.6,646 232.2,708L238.2,708C247,647.8 250,575.8 250,512.8Z", "opacity:0.15;"),
];
// 27/11 au soir, Alexandra (planche du chat de dos) : « regarde la queue », « tous les
// personnages doivent être posés sur la même ligne, rien ne dépasse dessous ». Ici la
// queue part du bas du dos et s'enroule SUR LE SOL, sur le côté droit, sans descendre
// sous l'assise (625, celle du lapin). Chat noir, comme le chat de dos actuel.
const CHAT = [
  // oreilles
  P("M214,488C210,466 212,446 220,432C232,442 242,458 246,474Z", "fill:#2F2A2B;"),
  P("M286,488C290,466 288,446 280,432C268,442 258,458 254,474Z", "fill:#2F2A2B;"),
  P("M286,488C290,466 288,446 280,432C282,452 280,468 272,480Z", "opacity:0.15;"),
  // tête
  P("M250,462C278,462 294,480 294,502C294,524 276,538 250,538C224,538 206,524 206,502C206,480 222,462 250,462Z", "fill:#2F2A2B;"),
  // corps en poire, assis
  P("M250,520C286,520 306,546 312,578C316,600 312,618 296,624L204,624C188,618 184,600 188,578C194,546 214,520 250,520Z", "fill:#2F2A2B;"),
  // queue : du bas du dos, posée au sol, enroulée vers la droite, le bout relevé
  P("M268,612C292,618 320,620 344,614C362,608 372,596 370,584C368,574 358,572 352,580C348,592 338,600 322,604C302,608 284,606 268,604Z", "fill:#2F2A2B;"),
  // ombres
  P("M250,520C286,520 306,546 312,578C316,600 312,618 296,624L282,624C300,600 300,562 288,542C280,530 266,522 250,520Z", "opacity:0.15;"),
  P("M272,468C286,476 294,488 294,502C294,524 276,538 250,538C268,528 280,508 272,468Z", "opacity:0.15;"),
  P("M268,604C284,606 302,608 322,604C338,600 348,592 352,580C356,598 344,614 322,618C302,622 284,622 268,620Z", "opacity:0.15;"),
];
const LAPIN = [
  // oreilles (derrière la tête)
  P("M231,470C222,440 214,404 218,384C221,372 232,372 238,384C246,404 248,440 246,470Z", "fill:#C9B39A;"),
  P("M254,470C254,440 258,404 268,386C274,374 285,376 286,388C288,410 278,444 268,472Z", "fill:#C9B39A;"),
  P("M268,386C274,374 285,376 286,388C288,410 278,444 268,472L262,470C270,444 278,410 268,386Z", "opacity:0.15;"),
  // corps en poire, cuisses arrondies en bas
  P("M250,508C292,508 318,540 324,576C328,600 322,618 300,624L200,624C178,618 172,600 176,576C182,540 208,508 250,508Z", "fill:#C9B39A;"),
  P("M176,590C170,606 176,622 196,625L226,625C222,612 210,596 196,588C188,584 180,584 176,590Z", "fill:#C9B39A;"),
  P("M324,590C330,606 324,622 304,625L274,625C278,612 290,596 304,588C312,584 320,584 324,590Z", "fill:#C9B39A;"),
  // tête ronde
  P("M250,452C276,452 292,470 292,490C292,512 274,526 250,526C226,526 208,512 208,490C208,470 224,452 250,452Z", "fill:#C9B39A;"),
  // ombres : côté droit du corps et de la tête, dessous de la tête
  P("M250,508C292,508 318,540 324,576C328,600 322,618 300,624L284,624C304,600 306,560 290,536C280,522 266,512 250,508Z", "opacity:0.15;"),
  P("M272,458C286,466 292,478 292,490C292,512 274,526 250,526C268,516 280,498 272,458Z", "opacity:0.15;"),
  P("M212,512C222,522 236,528 250,528C264,528 278,522 288,512C284,524 268,534 250,534C232,534 216,524 212,512Z", "opacity:0.15;"),
  // queue en pompon
  P("M250,588C262,588 270,596 270,606C270,616 262,622 250,622C238,622 230,616 230,606C230,596 238,588 250,588Z", "fill:#F4F3F2;"),
];

// ---------- les gabarits ----------
const defs = [];
function gab(o) {
  const paths = o.paths || corps(o.source, o.groupeSource, o.cheminSeul);
  const r = ecrire(o.reference ? REF : ASSETS, o.fichier, o.idSvg, o.idGroupe, o.couleurs, paths, o.warp || ident, o.entete);
  defs.push({ ...o, paths: undefined, warp: undefined, ...r });
}

// 27/11, relecture : ronde et rond élargis en une seule cloche large et basse (la première
// version gonflait les bras au coude, en ailes).
// Femmes : corps de Female_2 (crâne 178, cou ≈ 365, assise 874)
const F = { source: "Female_2.svg", groupeSource: "Female_Base_2", famille: "femme" };
gab({ ...F, reference: true, nom: "Femme", morpho: "standard", fichier: "gabarit-dos-femme-standard.svg", idSvg: "Gabarit_Dos_Femme_Standard", idGroupe: "Female_Base_1001", entete: "femme, corps de Female_2 tel quel" });
gab({ ...F, nom: "Femme fine", morpho: "fine", fichier: "gabarit-dos-femme-fine.svg", idSvg: "Gabarit_Dos_Femme_Fine", idGroupe: "Female_Base_1002", couleurs: { "#F8AA4C": "#E38242" },
  warp: largeur([[-0.11, 610, 190], [-0.06, 790, 80]]), entete: "femme fine : taille et hanches resserrees, tete, cou et assise inchanges" });
gab({ ...F, nom: "Femme ronde", morpho: "ronde", fichier: "gabarit-dos-femme-ronde.svg", idSvg: "Gabarit_Dos_Femme_Ronde", idGroupe: "Female_Base_1003", couleurs: { "#F8AA4C": "#C87446" },
  warp: largeur([[0.13, 690, 320], [0.04, 810, 70]]), entete: "femme ronde : dos, bras et hanches elargis, tete, cou et assise inchanges" });
gab({ ...F, nom: "Femme âgée", morpho: "agee", fichier: "gabarit-dos-femme-agee.svg", idSvg: "Gabarit_Dos_Femme_Agee", idGroupe: "Female_Base_1004", couleurs: { "#F8AA4C": "#E7965A" },
  // 27/11 au soir, Alexandra : « corps âgés pas assez différents (dos plus voûté, épaules
  // tombantes) » : bosse du dos ×2, épaules qui tombent ×2 et rentrent, dos rond.
  warp: compose(vieillir({ h: 22, yTeteBas: 318, yCou: 388, yFin: 590, rx: 165, chute: 28, yEp: 432, wEp: 90, rentre: 12 }), largeur([[0.07, 485, 100], [0.03, 680, 140]])), entete: "femme agee : dos voute, cou rentre, epaules tombantes" });

// Hommes : corps de Male_2 (crâne 161, cou ≈ 321, assise 864)
const H = { source: "Male_2.svg", groupeSource: "Male_Base_2", famille: "homme" };
gab({ ...H, reference: true, nom: "Homme", morpho: "standard", fichier: "gabarit-dos-homme-standard.svg", idSvg: "Gabarit_Dos_Homme_Standard", idGroupe: "Male_Base_1001", entete: "homme, corps de Male_2 tel quel" });
gab({ ...H, nom: "Homme mince", morpho: "mince", fichier: "gabarit-dos-homme-mince.svg", idSvg: "Gabarit_Dos_Homme_Mince", idGroupe: "Male_Base_1002", couleurs: { "#F8AA4C": "#C87446" },
  warp: largeur([[-0.10, 620, 200]]), entete: "homme mince : taille resserree, tete, cou et assise inchanges" });
gab({ ...H, nom: "Homme rond", morpho: "rond", fichier: "gabarit-dos-homme-rond.svg", idSvg: "Gabarit_Dos_Homme_Rond", idGroupe: "Male_Base_1003", couleurs: { "#F8AA4C": "#E38242" },
  warp: largeur([[0.13, 700, 300]]), entete: "homme rond : ventre et bras elargis, tete, cou et assise inchanges" });
gab({ ...H, nom: "Homme âgé", morpho: "age", fichier: "gabarit-dos-homme-age.svg", idSvg: "Gabarit_Dos_Homme_Age", idGroupe: "Male_Base_1004", couleurs: { "#F8AA4C": "#E7965A" },
  // 27/11 au soir : même reprise que la femme âgée, plus un petit ventre.
  warp: compose(vieillir({ h: 22, yTeteBas: 296, yCou: 360, yFin: 570, rx: 165, chute: 28, yEp: 412, wEp: 90, rentre: 12 }), largeur([[0.06, 465, 100], [0.07, 690, 150]])), entete: "homme age : dos voute, cou rentre, epaules tombantes, petit ventre" });

// Enfants : corps de Boys_2 (crâne 257, assise 777) ; ado : Teenage_Boys_1 ; bébé : Baby_Boy
const E = { source: "Boys_2.svg", groupeSource: "Boy_Base_2", famille: "enfant" };
gab({ ...E, reference: true, nom: "Enfant", morpho: "standard", fichier: "gabarit-dos-enfant-standard.svg", idSvg: "Gabarit_Dos_Enfant_Standard", idGroupe: "Boy_Base_1001", couleurs: { "#F09A2C": "#F2A346" }, entete: "enfant (6-9 ans), corps de Boys_2 tel quel" });
gab({ ...E, nom: "Enfant fin", morpho: "fin", fichier: "gabarit-dos-enfant-fin.svg", idSvg: "Gabarit_Dos_Enfant_Fin", idGroupe: "Boy_Base_1002", couleurs: { "#F09A2C": "#C87446" },
  warp: largeur([[-0.09, 590, 150]]), entete: "enfant fin : taille resserree" });
gab({ ...E, nom: "Enfant rond", morpho: "rond", fichier: "gabarit-dos-enfant-rond.svg", idSvg: "Gabarit_Dos_Enfant_Rond", idGroupe: "Boy_Base_1003", couleurs: { "#F09A2C": "#EF9F56" },
  warp: largeur([[0.15, 610, 160]]), entete: "enfant rond : ventre et bras elargis" });
const A = { source: "Teenage_Boys_1.svg", groupeSource: "Teenage_Boy_Base_1", famille: "ado" };
// 27/11 au soir, Alexandra : « épaules de l'ado trop raides » : une légère chute des
// épaules (sans voûte), sur l'ado fin ; le standard reste le dessin actuel.
const epaulesSouples = vieillir({ h: 0, yTeteBas: 300, yCou: 370, yFin: 560, rx: 150, chute: 16, yEp: 420, wEp: 80, rentre: 6 });
gab({ ...A, reference: true, nom: "Ado", morpho: "standard", fichier: "gabarit-dos-ado-standard.svg", idSvg: "Gabarit_Dos_Ado_Standard", idGroupe: "Teenage_Boy_Base_1001", entete: "ado (12-16 ans), corps de Teenage_Boys_1 tel quel" });
gab({ ...A, nom: "Ado fin", morpho: "fin", fichier: "gabarit-dos-ado-fin.svg", idSvg: "Gabarit_Dos_Ado_Fin", idGroupe: "Teenage_Boy_Base_1002", couleurs: { "#F8AA4C": "#E38242" },
  warp: compose(epaulesSouples, largeur([[-0.07, 590, 170]])), entete: "ado fin : taille resserree, epaules souples" });

// Animaux
gab({ paths: CHEVAL_DEBOUT, famille: "cheval", nom: "Cheval debout", morpho: "debout", fichier: "gabarit-dos-cheval-debout.svg", idSvg: "Gabarit_Dos_Cheval_Debout", idGroupe: "Horse_Base_1002", entete: "cheval debout de dos (la seule exception a la regle tous assis)" });
gab({ paths: CHAT, famille: "chat", nom: "Chat", morpho: "standard", fichier: "gabarit-dos-chat.svg", idSvg: "Gabarit_Dos_Chat", idGroupe: "Cat_Base_1001", entete: "chat assis de dos, la queue enroulee au sol sur le cote, rien sous l'assise" });
// Le couché (« il fait peur ») : gardé pour la planche, à ne pas proposer.
gab({ paths: CHEVAL, famille: "cheval", nom: "Cheval couché", morpho: "couche", fichier: "gabarit-dos-cheval.svg", idSvg: "Gabarit_Dos_Cheval", idGroupe: "Horse_Base_1001", entete: "cheval couche de dos, pattes repliees (un cheval ne s'assoit pas)" });
gab({ paths: LAPIN, famille: "lapin", nom: "Lapin", morpho: "standard", fichier: "gabarit-dos-lapin.svg", idSvg: "Gabarit_Dos_Lapin", idGroupe: "Rabbit_Base_1001", entete: "lapin assis de dos, a l'echelle du chat" });

writeFileSync(OUT_DEF, JSON.stringify(defs, null, 2));
console.log(defs.map((d) => d.fichier).join("\n"));
