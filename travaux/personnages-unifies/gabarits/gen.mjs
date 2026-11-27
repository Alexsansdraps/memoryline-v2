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
const compose = (...ws) => (x, y) => ws.reduce((p, w) => w(p[0], p[1]), [x, y]);

// ---------- écriture ----------
function ecrire(nom, idSvg, idGroupe, couleurs, paths, warp, entete) {
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
  const f = ASSETS + "/" + nom;
  if (existsSync(f) && !readFileSync(f, "utf8").includes(MARQUE)) throw new Error("fichier existant non généré par ce script : " + nom);
  writeFileSync(f, svg);
  return { fichier: nom, zones: Object.fromEntries(Object.entries(classes).filter(([k]) => k !== "ombre").map(([k, v]) => [v, remap(k)])) };
}

// ---------- dessins neufs : cheval couché de dos, lapin assis de dos ----------
// Chemins écrits à la main, en absolu, dans le style des animaux existants.
const P = (d, style) => ({ d, style });
const CHEVAL = [
  // encolure épaisse qui monte de derrière la croupe (dessinée d'abord : la croupe passe devant)
  P("M170,600C174,520 184,430 194,362C214,350 286,350 306,362C316,430 326,520 330,600Z", "fill:#C57745;"),
  P("M306,362C316,430 326,520 330,600L298,600C300,520 296,430 286,370Z", "opacity:0.15;"),
  // crinière qui tombe sur le côté gauche de l'encolure
  P("M234,258C246,252 258,252 266,258C262,300 248,340 232,380C222,420 212,470 206,520C204,550 204,580 206,600L174,600C176,540 184,470 196,420C208,370 226,310 234,258Z", "fill:#472E23;"),
  // arrière de la tête (nuque et ganaches), vue de dos
  P("M250,246C282,246 302,256 306,280C310,306 316,334 316,352C316,372 296,382 250,382C204,382 184,372 184,352C184,334 190,306 194,280C198,256 218,246 250,246Z", "fill:#C57745;"),
  P("M290,252C302,262 306,280 306,280C310,306 316,334 316,352C316,372 296,382 270,382C292,366 298,320 290,252Z", "opacity:0.15;"),
  P("M196,374C220,386 280,386 304,374L306,394C280,402 220,402 194,394Z", "opacity:0.15;"),
  // oreilles
  P("M208,268C202,240 203,214 214,194C226,212 236,234 238,256Z", "fill:#C57745;"),
  P("M292,268C298,240 297,214 286,194C274,212 264,234 262,256Z", "fill:#C57745;"),
  P("M292,268C298,240 297,214 286,194C290,220 288,244 280,262Z", "opacity:0.15;"),
  // toupet de crinière entre les oreilles
  P("M236,262C238,248 244,240 250,238C256,240 262,248 264,262C256,258 244,258 236,262Z", "fill:#472E23;"),
  // croupe : deux lobes et le sillon au milieu ; couché, pattes repliées dessous
  P("M250,568C232,552 208,540 180,540C130,540 98,580 88,634C80,678 78,722 82,762C86,804 108,822 152,822L348,822C392,822 414,804 418,762C422,722 420,678 412,634C402,580 370,540 320,540C292,540 268,552 250,568Z", "fill:#C57745;"),
  // jambe arrière repliée qui dépasse à droite, sabot sombre
  P("M380,770C404,772 432,780 448,792C460,800 460,816 448,822L376,822Z", "fill:#C57745;"),
  P("M440,790C454,794 464,804 464,812C464,820 456,822 446,822L432,822C438,812 440,800 440,790Z", "fill:#472E23;"),
  // ombres : côté droit de la croupe, creux du sillon
  P("M320,540C370,540 402,580 412,634C420,678 422,722 418,762C414,804 392,822 348,822L298,822C346,800 376,762 380,710C384,646 366,584 320,540Z", "opacity:0.15;"),
  P("M250,568C240,580 236,602 240,632C244,612 248,592 250,580C252,592 256,612 260,632C264,602 260,580 250,568Z", "opacity:0.15;"),
  // queue qui tombe dans le sillon
  P("M240,572C232,620 226,690 230,756C233,800 244,818 252,818C262,818 270,800 272,758C276,692 268,620 260,572C256,564 244,564 240,572Z", "fill:#472E23;"),
  P("M252,572C262,620 268,692 266,758C264,800 258,816 252,818C262,818 270,800 272,758C276,692 268,620 260,572Z", "opacity:0.15;"),
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
  const r = ecrire(o.fichier, o.idSvg, o.idGroupe, o.couleurs, paths, o.warp || ident, o.entete);
  defs.push({ ...o, paths: undefined, warp: undefined, ...r });
}

// Femmes : corps de Female_2 (crâne 178, cou ≈ 365, assise 874)
const F = { source: "Female_2.svg", groupeSource: "Female_Base_2", famille: "femme" };
gab({ ...F, nom: "Femme", morpho: "standard", fichier: "gabarit-dos-femme-standard.svg", idSvg: "Gabarit_Dos_Femme_Standard", idGroupe: "Female_Base_1001", entete: "femme, corps de Female_2 tel quel" });
gab({ ...F, nom: "Femme fine", morpho: "fine", fichier: "gabarit-dos-femme-fine.svg", idSvg: "Gabarit_Dos_Femme_Fine", idGroupe: "Female_Base_1002", couleurs: { "#F8AA4C": "#E38242" },
  warp: largeur([[-0.11, 610, 190], [-0.06, 790, 80]]), entete: "femme fine : taille et hanches resserrees, tete, cou et assise inchanges" });
gab({ ...F, nom: "Femme ronde", morpho: "ronde", fichier: "gabarit-dos-femme-ronde.svg", idSvg: "Gabarit_Dos_Femme_Ronde", idGroupe: "Female_Base_1003", couleurs: { "#F8AA4C": "#C87446" },
  warp: largeur([[0.17, 650, 230], [0.09, 800, 74]]), entete: "femme ronde : dos, bras et hanches elargis, tete, cou et assise inchanges" });
gab({ ...F, nom: "Femme âgée", morpho: "agee", fichier: "gabarit-dos-femme-agee.svg", idSvg: "Gabarit_Dos_Femme_Agee", idGroupe: "Female_Base_1004", couleurs: { "#F8AA4C": "#E7965A" },
  warp: compose(voute(30, 318, 384, 560, 70, 175), largeur([[0.05, 470, 90], [-0.03, 660, 120]])), entete: "femme agee : dos un peu voute, cou rentre, epaules tombantes" });

// Hommes : corps de Male_2 (crâne 161, cou ≈ 321, assise 864)
const H = { source: "Male_2.svg", groupeSource: "Male_Base_2", famille: "homme" };
gab({ ...H, nom: "Homme", morpho: "standard", fichier: "gabarit-dos-homme-standard.svg", idSvg: "Gabarit_Dos_Homme_Standard", idGroupe: "Male_Base_1001", entete: "homme, corps de Male_2 tel quel" });
gab({ ...H, nom: "Homme mince", morpho: "mince", fichier: "gabarit-dos-homme-mince.svg", idSvg: "Gabarit_Dos_Homme_Mince", idGroupe: "Male_Base_1002", couleurs: { "#F8AA4C": "#C87446" },
  warp: largeur([[-0.10, 620, 200]]), entete: "homme mince : taille resserree, tete, cou et assise inchanges" });
gab({ ...H, nom: "Homme rond", morpho: "rond", fichier: "gabarit-dos-homme-rond.svg", idSvg: "Gabarit_Dos_Homme_Rond", idGroupe: "Male_Base_1003", couleurs: { "#F8AA4C": "#E38242" },
  warp: largeur([[0.18, 660, 220]]), entete: "homme rond : ventre et bras elargis, tete, cou et assise inchanges" });
gab({ ...H, nom: "Homme âgé", morpho: "age", fichier: "gabarit-dos-homme-age.svg", idSvg: "Gabarit_Dos_Homme_Age", idGroupe: "Male_Base_1004", couleurs: { "#F8AA4C": "#E7965A" },
  warp: compose(voute(30, 296, 356, 540, 70, 175), largeur([[0.045, 450, 90], [0.04, 680, 140]])), entete: "homme age : dos un peu voute, cou rentre, epaules tombantes, petit ventre" });

// Enfants : corps de Boys_2 (crâne 257, assise 777) ; ado : Teenage_Boys_1 ; bébé : Baby_Boy
const E = { source: "Boys_2.svg", groupeSource: "Boy_Base_2", famille: "enfant" };
gab({ ...E, nom: "Enfant", morpho: "standard", fichier: "gabarit-dos-enfant-standard.svg", idSvg: "Gabarit_Dos_Enfant_Standard", idGroupe: "Boy_Base_1001", couleurs: { "#F09A2C": "#F2A346" }, entete: "enfant (6-9 ans), corps de Boys_2 tel quel" });
gab({ ...E, nom: "Enfant fin", morpho: "fin", fichier: "gabarit-dos-enfant-fin.svg", idSvg: "Gabarit_Dos_Enfant_Fin", idGroupe: "Boy_Base_1002", couleurs: { "#F09A2C": "#C87446" },
  warp: largeur([[-0.09, 590, 150]]), entete: "enfant fin : taille resserree" });
gab({ ...E, nom: "Enfant rond", morpho: "rond", fichier: "gabarit-dos-enfant-rond.svg", idSvg: "Gabarit_Dos_Enfant_Rond", idGroupe: "Boy_Base_1003", couleurs: { "#F09A2C": "#EF9F56" },
  warp: largeur([[0.15, 610, 160]]), entete: "enfant rond : ventre et bras elargis" });
const A = { source: "Teenage_Boys_1.svg", groupeSource: "Teenage_Boy_Base_1", famille: "ado" };
gab({ ...A, nom: "Ado", morpho: "standard", fichier: "gabarit-dos-ado-standard.svg", idSvg: "Gabarit_Dos_Ado_Standard", idGroupe: "Teenage_Boy_Base_1001", entete: "ado (12-16 ans), corps de Teenage_Boys_1 tel quel" });
gab({ ...A, nom: "Ado fin", morpho: "fin", fichier: "gabarit-dos-ado-fin.svg", idSvg: "Gabarit_Dos_Ado_Fin", idGroupe: "Teenage_Boy_Base_1002", couleurs: { "#F8AA4C": "#E38242" },
  warp: largeur([[-0.07, 590, 170]]), entete: "ado fin : taille resserree" });
gab({ source: "Baby_Boy.svg", cheminSeul: "Base", famille: "bebe", nom: "Bébé", morpho: "standard", fichier: "gabarit-dos-bebe.svg", idSvg: "Gabarit_Dos_Bebe", idGroupe: "Baby_Base_1001", entete: "bebe (1-2 ans), corps de Baby_Boy tel quel" });

// Animaux
gab({ source: "Big_Dog.svg", groupeSource: "Base", famille: "grand-chien", nom: "Grand chien", morpho: "standard", fichier: "gabarit-dos-grand-chien.svg", idSvg: "Gabarit_Dos_Grand_Chien", idGroupe: "Dog_Base_1001", entete: "grand chien, corps de Big_Dog sans collier" });
gab({ source: "Small_Dog.svg", cheminSeul: "Base", famille: "petit-chien", nom: "Petit chien", morpho: "standard", fichier: "gabarit-dos-petit-chien.svg", idSvg: "Gabarit_Dos_Petit_Chien", idGroupe: "Dog_Base_1002", entete: "petit chien, corps de Small_Dog sans collier" });
gab({ source: "Cat_1.svg", groupeSource: "Cat_Base_1", famille: "chat", nom: "Chat", morpho: "standard", fichier: "gabarit-dos-chat.svg", idSvg: "Gabarit_Dos_Chat", idGroupe: "Cat_Base_1001", entete: "chat, corps de Cat_1 sans collier" });
gab({ paths: CHEVAL, famille: "cheval", nom: "Cheval couché", morpho: "couche", fichier: "gabarit-dos-cheval.svg", idSvg: "Gabarit_Dos_Cheval", idGroupe: "Horse_Base_1001", entete: "cheval couche de dos, pattes repliees (un cheval ne s'assoit pas)" });
gab({ paths: LAPIN, famille: "lapin", nom: "Lapin", morpho: "standard", fichier: "gabarit-dos-lapin.svg", idSvg: "Gabarit_Dos_Lapin", idGroupe: "Rabbit_Base_1001", entete: "lapin assis de dos, a l'echelle du chat" });

writeFileSync(OUT_DEF, JSON.stringify(defs, null, 2));
console.log(defs.map((d) => d.fichier).join("\n"));
