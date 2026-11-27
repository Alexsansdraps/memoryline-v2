// Coiffures et barbes dessinées SUR les gabarits de dos (27/11).
// Alexandra, 27/11 : « tu saurais faire un chantier où on réécrit tous les personnages avec leurs
// accessoires et plus besoin d'avoir à les caler du coup parce qu'ils sont tous unifiés ? »,
// « il faudrait que les personnages aient tous le même style du coup, et proche de l'actuel »,
// « et pas de calage sur les nouveaux », « faut des vieux aussi ! ».
//
// Principe : dans une famille (femme, homme, enfant, ado), la tête est IDENTIQUE au pixel près sur
// tous les corps. Chaque coiffure est donc décrite une fois dans un repère « tête » (u : écart au
// centre, v : distance sous le sommet du crâne, à l'échelle de la tête de femme), puis posée sur
// la tête de la famille par une simple translation + mise à l'échelle uniforme, calculée ici et
// écrite EN DUR dans le chemin (aucun transform dans le fichier, comme les dessins actuels).
//
// Style : aplats, une couleur de cheveux .st0, ombre noire à 15 % .st1 (côté droit, comme les
// coupes actuelles), zones d'accessoires de coiffure .st2 / .st3 (chouchou, ruban, mèches).
// Usage : node gen-coiffures.mjs <dossier de sortie des SVG> <fichier pieces.json>
import { writeFileSync, mkdirSync } from "node:fs";

const [, , SORTIE = "/app/data/assets", PIECES = "/tmp/pieces.json"] = process.argv;
mkdirSync(SORTIE, { recursive: true });

// ---------------------------------------------------------------------------------------------
// Familles : repère de la tête (mesuré sur les gabarits : sommet du crâne, début des oreilles).
// sh = naissance des épaules, en v local.
// ---------------------------------------------------------------------------------------------
const FAMILLES = {
  femme: { cx: 250, top: 178.4, s: 1, sh: 207.6, prefixe: "Female", gabarits: ["gabarit-dos-femme-fine.svg", "gabarit-dos-femme-ronde.svg", "gabarit-dos-femme-agee.svg"], reference: ["Female_2.svg"] },
  homme: { cx: 250.1, top: 161, s: 0.983, sh: 209.6, prefixe: "Male", gabarits: ["gabarit-dos-homme-mince.svg", "gabarit-dos-homme-rond.svg", "gabarit-dos-homme-age.svg"], reference: ["Male_2.svg"] },
  enfant: { cx: 250, top: 256.9, s: 1, sh: 191, enfant: true, prefixe: "Kid", gabarits: ["gabarit-dos-enfant-fin.svg", "gabarit-dos-enfant-rond.svg"], reference: ["Boys_2.svg"] },
  ado: { cx: 275.7, top: 189.6, s: 0.883, sh: 210, prefixe: "Teenage", gabarits: ["gabarit-dos-ado-fin.svg"], reference: ["Teenage_Boys_1.svg"] },
};

// ---------------------------------------------------------------------------------------------
// Géométrie
// ---------------------------------------------------------------------------------------------
const P = (u, v, c = false) => ({ u, v, c });
const r1 = (x) => (Math.round(x * 10) / 10).toString();

// graine fixe : mêmes fichiers à chaque génération
function alea(graine) {
  let s = graine >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Moitié droite (du sommet au bas, u ≥ 0) → contour fermé symétrique, dans le sens horaire. */
function sym(droite, { jitter = 0, graine = 1 } = {}) {
  const r = alea(graine);
  const d = droite.map((p) => ({ ...p }));
  const g = droite.slice().reverse().filter((p) => Math.abs(p.u) > 1e-6).map((p) => ({ ...p, u: -p.u }));
  // le premier et le dernier point de la moitié droite sont sur l'axe : on ne les double pas
  const tout = [...d, ...g.filter((p, i) => !(i === 0 && Math.abs(droite[droite.length - 1].u) < 1e-6))];
  // retire un doublon éventuel du sommet
  const res = tout.filter((p, i) => i === 0 || !(Math.abs(p.u - tout[0].u) < 1e-6 && Math.abs(p.v - tout[0].v) < 1e-6));
  if (jitter) for (const p of res) if (!p.fixe) { p.u += (r() - 0.5) * jitter; p.v += (r() - 0.5) * jitter; }
  return res;
}

/** Courbe lisse (Catmull-Rom → Bézier) par des points ; `c` = point anguleux. */
function segments(pts, ferme = true, tension = 1) {
  const n = pts.length;
  const T = pts.map((p, i) => {
    if (p.c) return { u: 0, v: 0 };
    let a = pts[i - 1], b = pts[i + 1];
    if (ferme) { a = pts[(i - 1 + n) % n]; b = pts[(i + 1) % n]; }
    if (!a) return { u: (b.u - p.u) / 3 * 0.6 * tension, v: (b.v - p.v) / 3 * 0.6 * tension };
    if (!b) return { u: (p.u - a.u) / 3 * 0.6 * tension, v: (p.v - a.v) / 3 * 0.6 * tension };
    return { u: (b.u - a.u) / 6 * tension, v: (b.v - a.v) / 6 * tension };
  });
  const segs = [];
  const m = ferme ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % n;
    segs.push({ p0: pts[i], c1: { u: pts[i].u + T[i].u, v: pts[i].v + T[i].v }, c2: { u: pts[j].u - T[j].u, v: pts[j].v - T[j].v }, p3: pts[j] });
  }
  return segs;
}

function forme(pts, tension = 1) { return { pts, segs: segments(pts, true, tension) }; }

function bezAt(s, t) {
  const a = (1 - t) ** 3, b = 3 * t * (1 - t) ** 2, c = 3 * t * t * (1 - t), d = t ** 3;
  return { u: a * s.p0.u + b * s.c1.u + c * s.c2.u + d * s.p3.u, v: a * s.p0.v + b * s.c1.v + c * s.c2.v + d * s.p3.v };
}
function echantillons(segs, k = 24) {
  const out = [];
  for (const s of segs) for (let i = 0; i < k; i++) out.push(bezAt(s, i / k));
  return out;
}
function aire(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.u * q.v - q.u * p.v; } return a / 2; }

/** Contour festonné (boucles, frisés) : N bosses régulières le long d'un contour de base. */
function festons(base, n, haut, creux = 0.35, { garder } = {}) {
  const dense = echantillons(forme(base).segs, 40);
  const L = [0];
  for (let i = 1; i <= dense.length; i++) { const p = dense[i - 1], q = dense[i % dense.length]; L.push(L[i - 1] + Math.hypot(q.u - p.u, q.v - p.v)); }
  const tot = L[L.length - 1];
  const sens = aire(dense) > 0 ? 1 : -1; // repère y vers le bas
  const at = (d) => {
    d = ((d % tot) + tot) % tot;
    let i = 1; while (L[i] < d) i++;
    const p = dense[i - 1], q = dense[i % dense.length], t = (d - L[i - 1]) / (L[i] - L[i - 1] || 1);
    const tu = q.u - p.u, tv = q.v - p.v, nn = Math.hypot(tu, tv) || 1;
    // normale extérieure
    return { u: p.u + tu * t, v: p.v + tv * t, nu: (tv / nn) * sens, nv: (-tu / nn) * sens };
  };
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const q = at((i / (n * 2)) * tot);
    const bosse = i % 2 === 0;
    if (garder && !garder(q)) { pts.push(P(q.u, q.v)); continue; }
    const o = bosse ? haut : -haut * creux;
    pts.push(P(q.u + q.nu * o, q.v + q.nv * o, !bosse));
  }
  return pts;
}

/** Ombre : l'arc du contour entre deux ancres (les plus proches de A et B), refermé par une courbe intérieure. */
function ombre(f, A, B, interieur) {
  const n = f.pts.length;
  const proche = (q) => { let bi = 0, bd = 1e9; f.pts.forEach((p, i) => { const d = Math.hypot(p.u - q[0], p.v - q[1]); if (d < bd) { bd = d; bi = i; } }); return bi; };
  const i = proche(A), j = proche(B);
  const arc = [];
  for (let k = i; k !== j; k = (k + 1) % n) arc.push(f.segs[k]);
  const ret = segments([f.pts[j], ...interieur.map(([u, v, c]) => P(u, v, c)), f.pts[i]].map((p, k, a) => (k === 0 || k === a.length - 1 ? { ...p, c: false } : p)), false);
  return [...arc, ...ret];
}
/** Mèche (fuseau) : un fuseau pointu aux deux bouts, par une ligne médiane et une épaisseur. */
function meche(ligne, ep) {
  const pts = ligne.map(([u, v]) => P(u, v));
  const g = [], d = [];
  for (let k = 0; k < pts.length; k++) {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
    const tu = b.u - a.u, tv = b.v - a.v, nn = Math.hypot(tu, tv) || 1;
    const e = ep * Math.sin((Math.PI * k) / (pts.length - 1));
    g.push(P(pts[k].u - (tv / nn) * e, pts[k].v + (tu / nn) * e, k === 0 || k === pts.length - 1));
    d.push(P(pts[k].u + (tv / nn) * e, pts[k].v - (tu / nn) * e));
  }
  const tout = [...g, ...d.slice(1, -1).reverse()];
  return forme(tout).segs;
}
function ellipse(cu, cv, ru, rv, n = 10, rot = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * ru, y = Math.sin(a) * rv;
    pts.push(P(cu + x * Math.cos(rot) - y * Math.sin(rot), cv + x * Math.sin(rot) + y * Math.cos(rot)));
  }
  return forme(pts);
}
function inverse(segs) { return segs.slice().reverse().map((s) => ({ p0: s.p3, c1: s.c2, c2: s.c1, p3: s.p0 })); }

/** Natte : maillons alternés le long d'une ligne, de largeur w. Renvoie { corps, ombres }. */
function natte(u0, v0, u1, v1, w, n, courbe = 0) {
  const corps = [], ombres = [];
  for (let k = 0; k < n; k++) {
    const t0 = k / n, t1 = (k + 1.15) / n;
    const pt = (t) => ({ u: u0 + (u1 - u0) * t + Math.sin(t * Math.PI) * courbe, v: v0 + (v1 - v0) * t });
    const a = pt(t0), b = pt(Math.min(t1, 1)), m = pt((t0 + Math.min(t1, 1)) / 2);
    const ww = w * (1 - 0.35 * t0);
    const cote = k % 2 === 0 ? 1 : -1;
    const maillon = forme([P(a.u - ww * 0.15 * cote, a.v, true), P(m.u + ww * 0.5, m.v - (b.v - a.v) * 0.12 * cote), P(b.u + ww * 0.12 * cote, b.v, true), P(m.u - ww * 0.5, m.v + (b.v - a.v) * 0.12 * cote)]);
    corps.push(maillon.segs);
    ombres.push(meche([[a.u - ww * 0.15 * cote, a.v + 1], [m.u + ww * 0.12 * cote, m.v], [b.u + ww * 0.1 * cote, b.v - 1]], ww * 0.18));
  }
  return { corps, ombres };
}

// ---------------------------------------------------------------------------------------------
// Repères de la tête (repère local, tête de femme) — voir gabarits.json
// crâne : sommet (0,0), (±46,13), (±59,26), (±68,46), (±70,63), oreille (±68,84)→(±80,101)→(±75,117),
// mâchoire (±55,142), cou ±47 dès v 146.
// ---------------------------------------------------------------------------------------------

// Calotte courte (homme classique), ajustée par `vol` (volume au-dessus du crâne) et `bas` (nuque).
function calotte({ vol = 6, larg = 73, bas = 170, nuque = 42, oreille = 66 } = {}) {
  return [P(0, -vol), P(28, -vol + 2.5), P(50, -vol * 0.5 + 9), P(64, 24), P(larg, 46), P(larg - 0.5, 70), P(oreille, 96), P(60, 120), P(nuque + 8, 146), P(nuque, 160), P(22, bas - 2), P(0, bas)];
}

// ---------------------------------------------------------------------------------------------
// Les coiffures. build(F) → [{ cls, segs }] dans le repère local ; F = famille.
// ---------------------------------------------------------------------------------------------
const C = {
  brun: "#593314", chatain: "#8C5834", noir: "#281B13", blond: "#E7B033", blondFonce: "#CC9245",
  roux: "#CE6000", auburn: "#A05325", brunClair: "#97642F", gris: "#A7A39C", blanc: "#DEDAD2", poivreSel: "#8E8A84",
  rouge: "#C8413B", rose: "#E07A9A", bleu: "#2F6DB5", jaune: "#EDB52C", vert: "#3E8E5A", violet: "#7A4FB0", or: "#D9A630",
};

// Ombre « standard » côté droit pour une calotte.
function ombreCalotte(f, bas = 168, decal = 0) {
  return ombre(f, [28, -4], [0, bas], [[40 + decal, 22], [36 + decal, 52], [26 + decal, 88], [18 + decal, 122], [16 + decal, bas - 18]]);
}

function piecesCommunes() {
  const L = [];
  const add = (familles, id, nom, couleurs, build, extra = {}) => L.push({ familles, id, nom, couleurs, build, emplacement: extra.emplacement ?? "hair", opacite: extra.opacite, note: extra.note });

  // ======================= COURTS ===========================================================
  add(["homme", "ado", "enfant"], "court-classique", "Court classique", { st0: C.brun }, (F) => {
    const f = forme(sym(calotte({ bas: F.enfant ? 158 : 170 }), { jitter: 1.5, graine: 11 }));
    return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombreCalotte(f, F.enfant ? 156 : 168) }];
  });

  add(["homme", "ado", "enfant"], "court-epis", "Court en épis", { st0: C.chatain }, (F) => {
    const bas = F.enfant ? 158 : 166;
    const droite = [P(0, -16, true), P(10, -6), P(20, -19, true), P(30, -5), P(42, -14, true), P(50, 2), P(62, -2, true), P(64, 14), P(76, 18, true), P(72, 34), P(80, 44, true), P(73, 56), P(76, 70, true), P(68, 82), P(66, 98), P(60, 120), P(52, 144), P(44, 158), P(34, bas - 2, true), P(24, bas - 8), P(12, bas + 2, true), P(0, bas - 6)];
    const f = forme(sym(droite, { jitter: 2, graine: 12 }));
    return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombre(f, [30, -5], [24, bas - 8], [[42, 24], [36, 60], [26, 96], [20, 130]]) },
      { cls: "st1", segs: meche([[-30, 10], [-36, 40], [-34, 70]], 5) }];
  });

  add(["homme", "ado"], "court-brosse", "Brosse courte", { st0: C.noir }, (F) => {
    const droite = [P(0, -14), P(22, -14), P(44, -10, true), P(58, 2), P(68, 22), P(72, 46), P(71, 70), P(66, 94), P(60, 120), P(50, 146), P(40, 160), P(20, 166), P(0, 167)];
    const f = forme(sym(droite, { jitter: 1, graine: 13 }));
    return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombre(f, [22, -14], [0, 167], [[34, 18], [32, 56], [24, 96], [16, 140]]) }];
  });

  add(["homme", "ado", "enfant", "femme"], "tondu", "Tondu ras", { st0: "#3A2B22" }, (F) => {
    const droite = [P(0, -2.5), P(25, 0.8), P(47, 10.5), P(61, 24), P(70.5, 45), P(72.5, 63), P(70.5, 83), P(65, 103), P(57, 124), P(48, 140), P(26, 148), P(0, 150)];
    const f = forme(sym(droite));
    return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombreCalotte(f, 148, -6) }];
  }, { opacite: { st0: 0.5 }, note: "aplat à 50 % : la peau, quelle que soit sa couleur, se voit au travers, comme un crâne tondu" });

  add(["homme", "ado"], "undercut", "Côtés rasés, dessus long", { st0: C.brun, st2: "#3A2B22" }, (F) => {
    const cotes = forme(sym([P(0, 40), P(40, 36), P(66, 40), P(72.5, 63), P(70.5, 83), P(65, 103), P(57, 124), P(48, 140), P(26, 148), P(0, 150)]));
    const dessus = forme(sym([P(0, -18), P(26, -16), P(48, -6), P(62, 10), P(68, 28), P(64, 46, true), P(52, 52), P(30, 60), P(10, 76, true), P(0, 70)], { jitter: 1.5, graine: 14 }));
    return [{ cls: "st2", segs: cotes.segs }, { cls: "st1", segs: ombre(cotes, [66, 40], [0, 150], [[40, 60], [26, 100], [16, 140]]) },
      { cls: "st0", segs: dessus.segs }, { cls: "st1", segs: ombre(dessus, [26, -16], [10, 76], [[36, 10], [30, 36], [20, 58]]) },
      { cls: "st1", segs: meche([[-40, 2], [-30, 30], [-14, 60]], 4) }];
  }, { opacite: { st2: 0.5 }, note: "côtés rasés .st2 en aplat à 50 % (peau visible au travers)" });

  add(["homme", "ado", "enfant"], "bol", "Coupe au bol", { st0: C.blondFonce }, (F) => {
    const droite = [P(0, -12), P(30, -9), P(54, 2), P(70, 20), P(80, 46), P(82, 72), P(80, 96), P(78, 112, true), P(62, 112), P(56, 128), P(48, 142), P(30, 150), P(0, 152)];
    const f = forme(sym(droite, { jitter: 1, graine: 15 }));
    return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombre(f, [30, -9], [0, 152], [[44, 22], [40, 60], [32, 96], [20, 130]]) },
      { cls: "st1", segs: meche([[-50, 30], [-60, 60], [-62, 100]], 4) }];
  });

  add(["homme", "ado"], "mulet", "Mulet (court dessus, long derrière)", { st0: C.auburn }, (F) => {
    const b = F.sh - 6;
    const droite = [P(0, -8), P(28, -5), P(50, 5), P(64, 22), P(73, 46), P(72, 70), P(66, 96), P(62, 120), P(60, 146), P(64, b - 30), P(58, b - 6, true), P(46, b - 12), P(36, b, true), P(24, b - 10), P(12, b + 2, true), P(0, b - 8)];
    const f = forme(sym(droite, { jitter: 1.5, graine: 16 }));
    return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombre(f, [28, -5], [24, b - 10], [[40, 26], [34, 66], [26, 110], [28, 160]]) },
      { cls: "st1", segs: meche([[-40, 140], [-46, 170], [-44, b - 20]], 4) }];
  });

  add(["homme", "ado", "enfant"], "frises-courts", "Frisés courts", { st0: C.noir }, (F) => {
    const base = sym([P(0, -14), P(36, -10), P(62, 6), P(78, 34), P(80, 64), P(72, 94), P(62, 124), P(50, 148), P(26, 160), P(0, 162)]);
    const f = forme(festons(base, 22, 5, 0.4));
    const cercles = [];
    const r = alea(17);
    for (let k = 0; k < 14; k++) { const u = (r() - 0.5) * 110, v = 10 + r() * 130; if (Math.abs(u) < 60 - Math.max(0, v - 100) * 0.4) cercles.push(meche([[u - 6, v], [u, v - 4], [u + 6, v]], 1.8)); }
    return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombre(f, [36, -10], [0, 162], [[46, 26], [40, 66], [30, 110], [18, 146]]) }, ...cercles.map((s) => ({ cls: "st1", segs: s }))];
  });

  add(["homme", "ado", "enfant", "femme"], "afro", "Afro", { st0: C.noir }, (F) => {
    const base = sym([P(0, -40), P(48, -34), P(86, -8), P(104, 34), P(106, 80), P(96, 120), P(78, 150), P(50, 168), P(0, 176)]);
    const f = forme(festons(base, 30, 6, 0.45));
    const traits = [];
    const r = alea(18);
    for (let k = 0; k < 18; k++) { const u = (r() - 0.5) * 160, v = -20 + r() * 170; if (Math.hypot(u / 92, (v - 66) / 96) < 0.9) traits.push(meche([[u - 7, v], [u, v - 4], [u + 7, v]], 2)); }
    return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombre(f, [48, -34], [0, 176], [[60, 10], [54, 60], [40, 110], [22, 150]]) }, ...traits.map((s) => ({ cls: "st1", segs: s }))];
  });

  // ======================= CALVITIES (adultes) ==============================================
  add(["homme"], "calvitie-couronne", "Calvitie, couronne de cheveux", { st0: C.gris }, (F) => {
    const droite = [P(0, 50), P(24, 47), P(48, 44), P(64, 40, true), P(70, 42), P(74.5, 60), P(73, 80), P(67, 98), P(62, 120), P(52, 144), P(42, 158), P(22, 166), P(0, 168)];
    const f = forme(sym(droite, { jitter: 2, graine: 19 }));
    return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombre(f, [48, 44], [0, 168], [[42, 70], [30, 110], [18, 150]]) },
      { cls: "st1", segs: meche([[-56, 58], [-40, 66], [-20, 64]], 2.5) }];
  });

  add(["homme"], "degarni-tonsure", "Dégarni sur le dessus", { st0: C.poivreSel }, (F) => {
    const f = forme(sym(calotte({ vol: 5 }), { jitter: 1.5, graine: 20 }));
    const trou = ellipse(2, 34, 34, 26, 12);
    const trouSegs = aire(echantillons(trou.segs)) * aire(echantillons(f.segs)) > 0 ? inverse(trou.segs) : trou.segs;
    return [{ cls: "st0", segs: [...f.segs, null, ...trouSegs] }, { cls: "st1", segs: ombre(f, [50, 6.5], [0, 170], [[52, 40], [40, 80], [26, 120], [18, 152]]) }];
  });

  add(["homme"], "blancs-raie", "Cheveux blancs, raie sur le côté", { st0: C.blanc }, (F) => {
    const droite = [P(0, -7), P(20, -9), P(44, -2), P(62, 14), P(72, 38), P(73, 62), P(68, 90), P(62, 118), P(52, 144), P(42, 158), P(22, 166), P(0, 168)];
    const f = forme(sym(droite, { jitter: 1, graine: 21 }));
    return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombre(f, [44, -2], [0, 168], [[48, 30], [40, 70], [28, 112], [16, 150]]) },
      { cls: "st1", segs: meche([[-30, -6], [-14, 30], [-6, 70]], 2.5) }, { cls: "st1", segs: meche([[-52, 6], [-40, 40], [-34, 90]], 3) }];
  });

  // ======================= MI-LONGS / LONGS =================================================
  add(["homme", "ado"], "mi-longs", "Mi-longs dans le cou", { st0: C.brunClair }, (F) => {
    const b = F.sh - 14;
    const droite = [P(0, -10), P(30, -7), P(54, 4), P(72, 26), P(80, 56), P(82, 90), P(80, 124), P(76, b - 40), P(80, b - 8, true), P(64, b - 18), P(52, b, true), P(38, b - 14), P(24, b + 2, true), P(12, b - 10), P(0, b - 2, true)];
    const f = forme(sym(droite, { jitter: 2, graine: 22 }));
    return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombre(f, [30, -7], [12, b - 10], [[44, 26], [40, 70], [30, 120], [22, 170]]) },
      { cls: "st1", segs: meche([[-46, 40], [-54, 100], [-50, b - 20]], 4) }, { cls: "st1", segs: meche([[-14, 60], [-18, 120], [-12, b - 20]], 3) }];
  });

  add(["homme", "ado"], "chignon-homme", "Cheveux attachés en chignon", { st0: C.noir, st2: "#1E1712" }, (F) => {
    const cap = forme(sym([P(0, -4), P(28, -1), P(50, 8), P(64, 24), P(72, 46), P(71, 70), P(66, 94), P(58, 118), P(48, 140), P(28, 150), P(0, 152)], { jitter: 1, graine: 23 }));
    const bun = ellipse(0, 40, 26, 22, 10);
    const bunF = forme(festons(bun.pts, 7, 2, 0.3));
    return [{ cls: "st0", segs: cap.segs }, { cls: "st1", segs: ombreCalotte(cap, 150, -4) },
      { cls: "st1", segs: meche([[-60, 30], [-30, 40], [-10, 46]], 2.5) }, { cls: "st1", segs: meche([[-56, 110], [-30, 80], [-10, 58]], 2.5) },
      { cls: "st0", segs: bunF.segs }, { cls: "st1", segs: ombre(bunF, [0, 18], [0, 62], [[14, 34], [10, 52]]) },
      { cls: "st2", segs: ellipse(0, 60, 14, 5, 8).segs }];
  });

  add(["homme", "ado"], "queue-basse-homme", "Queue de cheval basse", { st0: C.brun, st2: "#1E1712" }, (F) => {
    const cap = forme(sym([P(0, -4), P(28, -1), P(50, 8), P(64, 24), P(72, 46), P(71, 70), P(66, 94), P(58, 118), P(46, 138), P(24, 146), P(0, 148)], { jitter: 1, graine: 24 }));
    const t = 132, b = F.sh + 20;
    const queue = forme([P(-10, t, true), P(10, t, true), P(16, t + 30), P(14, b - 40), P(6, b, true), P(-6, b - 30), P(-14, t + 40)]);
    return [{ cls: "st0", segs: cap.segs }, { cls: "st1", segs: ombreCalotte(cap, 146) },
      { cls: "st1", segs: meche([[-56, 40], [-30, 90], [-8, 128]], 2.5) }, { cls: "st1", segs: meche([[50, 30], [28, 90], [8, 128]], 2.5) },
      { cls: "st0", segs: queue.segs }, { cls: "st1", segs: ombre(queue, [10, t], [6, b], [[4, t + 40], [4, b - 30]]) },
      { cls: "st2", segs: ellipse(0, t + 2, 12, 5, 8).segs }];
  });

  add(["homme", "ado", "femme"], "locs", "Dreadlocks", { st0: C.noir }, (F) => {
    const cap = forme(sym([P(0, -10), P(30, -7), P(54, 4), P(70, 24), P(78, 50), P(78, 80), P(70, 106), P(56, 126), P(30, 136), P(0, 138)], { jitter: 1.5, graine: 25 }));
    const out = [{ cls: "st0", segs: cap.segs }, { cls: "st1", segs: ombreCalotte(cap, 136, 4) }];
    const b = F.sh + (F === FAMILLES.femme ? 60 : 20);
    const r = alea(26);
    const xs = [-74, -60, -46, -32, -18, -4, 10, 24, 38, 52, 66, 78];
    for (const x of xs) {
      const v0 = 60 + (Math.abs(x) > 60 ? 20 : 50 + Math.random() * 0);
      const len = b - v0 - r() * 30;
      const ox = x * 1.06 + (r() - 0.5) * 4;
      const ligne = [[x, v0], [ox + (r() - 0.5) * 6, v0 + len * 0.5], [ox + (x > 0 ? 3 : -3), v0 + len]];
      out.push({ cls: "st0", segs: meche(ligne, 7.5) });
      out.push({ cls: "st1", segs: meche([[ligne[0][0] + 2, ligne[0][1] + 10], [ligne[1][0] + 3, ligne[1][1]], [ligne[2][0] + 2, ligne[2][1] - 8]], 2.5) });
    }
    return out;
  });

  // ======================= FEMMES ==========================================================
  const longs = (b, { larg = 90, vagues = 0, graine = 30, raie = true } = {}) => {
    const droite = [P(0, -14, raie), P(34, -10), P(60, 4), P(78, 28), P(86, 58), P(larg - 2, 96), P(larg + 2, 140)];
    const nb = Math.max(2, Math.round((b - 150) / 50));
    for (let k = 1; k <= nb; k++) droite.push(P(larg + 4 + (k % 2 ? vagues : -vagues), 140 + ((b - 160) * k) / nb));
    droite.push(P(larg - 2, b - 4, true), P(78, b - 16), P(66, b + 2, true), P(54, b - 12), P(40, b + 4, true), P(28, b - 10), P(14, b + 2, true), P(0, b - 8));
    return sym(droite, { jitter: 2, graine });
  };
  const ombreLongs = (f, b) => ombre(f, [34, -10], [14, b + 2], [[44, 20], [40, 60], [30, 110], [34, 170], [26, b - 60], [22, b - 20]]);

  add(["femme", "ado", "enfant"], "longs-raides", "Longs raides", { st0: C.brun }, (F) => {
    const b = F.sh + (F.enfant ? 70 : 110);
    const f = forme(longs(b, { graine: 31 }));
    return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombreLongs(f, b) },
      { cls: "st1", segs: meche([[-44, 40], [-60, 140], [-58, b - 30]], 5) }, { cls: "st1", segs: meche([[-10, 30], [-16, 120], [-12, b - 40]], 3.5) }];
  });

  add(["femme", "ado"], "longs-ondules", "Longs ondulés", { st0: C.chatain }, (F) => {
    const b = F.sh + 100;
    const f = forme(longs(b, { larg: 96, vagues: 9, graine: 32 }));
    return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombreLongs(f, b) },
      { cls: "st1", segs: meche([[-40, 30], [-60, 90], [-50, 150], [-64, 210], [-56, b - 20]], 5) },
      { cls: "st1", segs: meche([[-12, 40], [-24, 110], [-8, 170], [-20, b - 30]], 4) },
      { cls: "st1", segs: meche([[56, 60], [70, 130], [58, 200]], 4) }];
  });

  add(["femme", "ado", "enfant"], "carre", "Carré", { st0: C.noir }, (F) => {
    const b = F.enfant ? 150 : 158;
    const droite = [P(0, -12, true), P(34, -9), P(60, 4), P(78, 28), P(86, 58), P(88, 96), P(88, 130), P(86, b - 4, true), P(60, b + 2), P(30, b + 4), P(0, b + 4)];
    const f = forme(sym(droite, { jitter: 1, graine: 33 }));
    return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombre(f, [34, -9], [30, b + 4], [[44, 24], [38, 70], [30, 120]]) },
      { cls: "st1", segs: meche([[-40, 30], [-56, 90], [-56, b - 10]], 4) }];
  });

  add(["femme", "ado"], "carre-plongeant", "Carré plongeant dégradé", { st0: C.auburn }, (F) => {
    const b = F.sh - 2;
    const droite = [P(0, -12, true), P(34, -9), P(60, 4), P(78, 28), P(86, 58), P(88, 96), P(90, 140), P(92, b - 10, true), P(78, b - 18), P(70, b, true), P(52, b - 14), P(40, b - 30, true), P(20, b - 44), P(0, b - 48)];
    const f = forme(sym(droite, { jitter: 1.5, graine: 34 }));
    return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombre(f, [34, -9], [20, b - 44], [[44, 24], [38, 70], [30, 110]]) },
      { cls: "st1", segs: meche([[-44, 30], [-62, 100], [-74, b - 10]], 4) }];
  });

  add(["femme", "ado"], "pixie", "Coupe garçonne", { st0: C.blond }, (F) => {
    const droite = [P(0, -10), P(24, -12), P(46, -4), P(64, 12), P(74, 36), P(75, 60), P(70, 86), P(64, 108), P(56, 130), P(48, 146, true), P(36, 140), P(26, 154, true), P(14, 146), P(0, 156, true)];
    const f = forme(sym(droite, { jitter: 1.5, graine: 35 }));
    return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombre(f, [24, -12], [14, 146], [[40, 16], [36, 56], [26, 100]]) },
      { cls: "st1", segs: meche([[-50, 4], [-36, 40], [-28, 80]], 3) }];
  });

  add(["femme", "ado"], "mi-longs-femme", "Mi-longs aux épaules", { st0: C.blondFonce }, (F) => {
    const b = F.sh + 14;
    const droite = [P(0, -13, true), P(34, -10), P(60, 4), P(78, 28), P(86, 58), P(88, 96), P(88, 140), P(92, b - 30), P(104, b - 8, true), P(86, b - 6), P(70, b + 2, true), P(54, b - 8), P(36, b + 2, true), P(18, b - 6), P(0, b + 2)];
    const f = forme(sym(droite, { jitter: 2, graine: 36 }));
    return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombre(f, [34, -10], [18, b - 6], [[44, 24], [38, 70], [30, 120], [26, 170]]) },
      { cls: "st1", segs: meche([[-46, 40], [-60, 110], [-74, b - 14]], 4) }, { cls: "st1", segs: meche([[-12, 50], [-18, 120], [-14, b - 16]], 3) }];
  });

  const ponytail = (F, { t, b, w = 28, graine = 40, chou = true }) => {
    const cap = forme(sym([P(0, -5), P(28, -2), P(50, 7), P(64, 24), P(72, 46), P(71, 70), P(66, 94), P(58, 118), P(48, 136), P(26, 146), P(0, 148)], { jitter: 1, graine }));
    const q = forme([P(-12, t, true), P(12, t, true), P(w, t + 30), P(w - 2, t + (b - t) * 0.55), P(10, b - 16), P(4, b, true), P(-6, b - 22), P(-w + 6, t + (b - t) * 0.5), P(-w + 2, t + 26)]);
    const out = [{ cls: "st0", segs: cap.segs }, { cls: "st1", segs: ombreCalotte(cap, 146) },
      { cls: "st1", segs: meche([[-60, 50], [-32, t - 10], [-10, t - 2]], 2.5) }, { cls: "st1", segs: meche([[-50, 120], [-26, t + 2], [-8, t + 4]], 2) },
      { cls: "st0", segs: q.segs }, { cls: "st1", segs: ombre(q, [12, t], [4, b], [[10, t + 40], [8, b - 40]]) },
      { cls: "st1", segs: meche([[-8, t + 20], [-14, t + (b - t) * 0.5], [-4, b - 30]], 3) }];
    if (chou) out.push({ cls: "st2", segs: forme(festons(ellipse(0, t, 15, 8, 10).pts, 6, 1.6, 0.4)).segs }, { cls: "st1", segs: ombre(forme(festons(ellipse(0, t, 15, 8, 10).pts, 6, 1.6, 0.4)), [0, t - 8], [0, t + 8], [[6, t]]) });
    return out;
  };
  add(["femme", "ado", "enfant"], "queue-de-cheval", "Queue de cheval", { st0: C.brun, st2: C.rouge }, (F) => ponytail(F, { t: 110, b: F.sh + (F.enfant ? 40 : 90), graine: 41 }));
  add(["femme", "ado", "enfant"], "queue-haute", "Queue de cheval haute", { st0: C.blond, st2: C.rose }, (F) => {
    const out = ponytail(F, { t: 36, b: F.sh + (F.enfant ? 10 : 50), w: 30, graine: 42 });
    return out;
  });

  const bun = (cv, r, graine) => forme(festons(ellipse(0, cv, r, r * 0.88, 10).pts, 8, 2.4, 0.3));
  add(["femme", "ado", "enfant"], "chignon-haut", "Chignon haut", { st0: C.chatain, st2: C.bleu }, (F) => {
    const cap = forme(sym([P(0, -4), P(28, -1), P(50, 8), P(64, 24), P(72, 46), P(71, 70), P(66, 94), P(58, 118), P(48, 136), P(26, 146), P(0, 148)], { jitter: 1, graine: 43 }));
    const b = bun(-24, 32, 44);
    return [{ cls: "st0", segs: b.segs }, { cls: "st1", segs: ombre(b, [0, -52], [0, 4], [[14, -30], [10, -10]]) },
      { cls: "st1", segs: meche([[-20, -36], [0, -44], [18, -34]], 2.5) },
      { cls: "st0", segs: cap.segs }, { cls: "st1", segs: ombreCalotte(cap, 146) },
      { cls: "st1", segs: meche([[-60, 60], [-36, 20], [-12, 2]], 2.5) }, { cls: "st1", segs: meche([[-30, 130], [-20, 60], [-6, 6]], 2) },
      { cls: "st2", segs: ellipse(0, 0, 22, 6, 10).segs }];
  });

  add(["femme", "ado"], "chignon-bas", "Chignon bas", { st0: C.noir, st2: C.or }, (F) => {
    const cap = forme(sym([P(0, -5), P(28, -2), P(50, 7), P(64, 24), P(72, 46), P(71, 70), P(66, 94), P(58, 118), P(48, 136), P(26, 146), P(0, 148)], { jitter: 1, graine: 45 }));
    const b = bun(124, 34, 46);
    return [{ cls: "st0", segs: cap.segs }, { cls: "st1", segs: ombreCalotte(cap, 146) },
      { cls: "st1", segs: meche([[-60, 50], [-30, 90], [-12, 100]], 2.5) }, { cls: "st1", segs: meche([[50, 30], [28, 80], [12, 98]], 2.5) },
      { cls: "st0", segs: b.segs }, { cls: "st1", segs: ombre(b, [0, 94], [0, 154], [[16, 116], [12, 140]]) },
      { cls: "st1", segs: meche([[-22, 116], [0, 106], [20, 118]], 2.5) },
      { cls: "st2", segs: meche([[-26, 106], [-4, 100], [20, 98]], 2.2) }];
  });

  add(["femme"], "chignon-grand-mere", "Chignon de grand-mère", { st0: C.blanc, st2: "#8D8A84" }, (F) => {
    const droite = [P(0, -10), P(30, -8), P(54, 4), P(70, 24), P(78, 48), P(76, 72), P(68, 96), P(58, 118), P(46, 134), P(24, 142), P(0, 144)];
    const cap = forme(sym(droite, { jitter: 1.5, graine: 47 }));
    const b = forme(festons(ellipse(0, 72, 26, 22, 10).pts, 9, 2, 0.3));
    return [{ cls: "st0", segs: cap.segs }, { cls: "st1", segs: ombreCalotte(cap, 142, 4) },
      { cls: "st1", segs: meche([[-66, 40], [-44, 66], [-22, 74]], 3) }, { cls: "st1", segs: meche([[-60, 110], [-40, 96], [-22, 86]], 3) },
      { cls: "st1", segs: meche([[-30, 4], [-20, 30], [-10, 50]], 2.5) },
      { cls: "st0", segs: b.segs }, { cls: "st1", segs: ombre(b, [0, 50], [0, 94], [[12, 66], [8, 84]]) },
      { cls: "st1", segs: meche([[-16, 62], [0, 56], [16, 64]], 2) }, { cls: "st1", segs: meche([[-14, 80], [2, 74], [16, 82]], 2) },
      { cls: "st2", segs: meche([[10, 52], [22, 60], [36, 64]], 1.6) }, { cls: "st2", segs: meche([[-34, 82], [-22, 84], [-10, 90]], 1.6) }];
  });

  add(["femme"], "permanente", "Courte permanentée", { st0: C.gris }, (F) => {
    const base = sym([P(0, -18), P(40, -14), P(66, 2), P(84, 28), P(88, 62), P(84, 96), P(74, 122), P(58, 142), P(30, 150), P(0, 152)]);
    const f = forme(festons(base, 26, 5, 0.4));
    const r = alea(48);
    const boucles = [];
    for (let k = 0; k < 18; k++) { const u = (r() - 0.5) * 140, v = -4 + r() * 140; if (Math.hypot(u / 76, (v - 66) / 78) < 0.92) boucles.push(meche([[u - 6, v + 1], [u, v - 4], [u + 6, v + 1]], 1.8)); }
    return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombre(f, [40, -14], [0, 152], [[48, 20], [42, 70], [30, 120]]) }, ...boucles.map((s) => ({ cls: "st1", segs: s }))];
  });

  add(["femme", "ado", "enfant"], "natte", "Natte", { st0: C.blondFonce, st2: C.vert }, (F) => {
    const cap = forme(sym([P(0, -5), P(28, -2), P(50, 7), P(64, 24), P(72, 46), P(71, 70), P(66, 94), P(58, 118), P(46, 134), P(24, 144), P(0, 146)], { jitter: 1, graine: 49 }));
    const t = 126, b = F.sh + (F.enfant ? 60 : 110);
    const n = natte(0, t, 4, b - 18, 34, Math.round((b - t) / 24), 4);
    const pointe = forme([P(-6, b - 22, true), P(8, b - 22, true), P(12, b - 4), P(4, b + 12, true), P(-8, b - 2)]);
    return [{ cls: "st0", segs: cap.segs }, { cls: "st1", segs: ombreCalotte(cap, 144) },
      { cls: "st1", segs: meche([[-60, 40], [-30, 100], [-8, 130]], 2.5) }, { cls: "st1", segs: meche([[50, 30], [28, 90], [8, 130]], 2.5) },
      ...n.corps.map((s) => ({ cls: "st0", segs: s })), ...n.ombres.map((s) => ({ cls: "st1", segs: s })),
      { cls: "st0", segs: pointe.segs }, { cls: "st1", segs: ombre(pointe, [8, b - 22], [4, b + 12], [[4, b - 6]]) },
      { cls: "st2", segs: ellipse(3, b - 22, 11, 5, 8).segs }];
  });

  add(["femme", "ado", "enfant"], "deux-nattes", "Deux nattes", { st0: C.roux, st2: C.jaune }, (F) => {
    const cap = forme(sym([P(0, -5), P(28, -2), P(50, 7), P(64, 24), P(72, 46), P(73, 70), P(70, 94), P(62, 118), P(50, 136), P(26, 144), P(0, 146)], { jitter: 1, graine: 50 }));
    const t = 112, b = F.sh + (F.enfant ? 40 : 80);
    const out = [{ cls: "st0", segs: cap.segs }, { cls: "st1", segs: ombre(cap, [0, -5], [0, 146], [[4, 40], [2, 100]]) },
      { cls: "st1", segs: meche([[-1, -4], [0, 60], [-1, 140]], 1.6) }];
    for (const cote of [-1, 1]) {
      const n = natte(cote * 46, t, cote * 54, b - 16, 28, Math.round((b - t) / 22), cote * 4);
      out.push(...n.corps.map((s) => ({ cls: "st0", segs: s })), ...n.ombres.map((s) => ({ cls: "st1", segs: s })));
      const p = forme([P(cote * 54 - 6, b - 20, true), P(cote * 54 + 6, b - 20, true), P(cote * 54 + 9, b - 4), P(cote * 54 + 2, b + 10, true), P(cote * 54 - 8, b - 2)]);
      out.push({ cls: "st0", segs: p.segs }, { cls: "st2", segs: ellipse(cote * 54, b - 20, 10, 4.5, 8).segs });
    }
    return out;
  });

  add(["femme", "ado"], "frises-longs", "Longs bouclés", { st0: C.brun }, (F) => {
    const b = F.sh + 80;
    const base = sym([P(0, -20), P(44, -16), P(76, 4), P(96, 40), P(104, 90), P(108, 150), P(104, b - 40), P(86, b), P(50, b + 8), P(0, b + 4)]);
    const f = forme(festons(base, 34, 6, 0.45));
    const r = alea(51);
    const boucles = [];
    for (let k = 0; k < 26; k++) { const u = (r() - 0.5) * 180, v = 0 + r() * (b - 10); if (Math.abs(u) < 86 && !(v > 150 && Math.abs(u) > 90)) boucles.push(meche([[u - 7, v + 1], [u, v - 4], [u + 7, v + 1]], 2)); }
    return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombre(f, [44, -16], [0, b + 4], [[54, 20], [46, 80], [40, 150], [28, b - 30]]) }, ...boucles.map((s) => ({ cls: "st1", segs: s }))];
  });

  add(["femme", "ado", "enfant"], "bandeau", "Longs avec bandeau", { st0: C.noir, st2: C.rouge }, (F) => {
    const b = F.sh + (F.enfant ? 50 : 80);
    const f = forme(longs(b, { larg: 88, graine: 52 }));
    const bande = forme(sym([P(0, 6), P(36, 10), P(64, 22), P(80, 40, true), P(78, 52), P(62, 38), P(36, 26), P(0, 22)]));
    return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombreLongs(f, b) },
      { cls: "st1", segs: meche([[-40, 60], [-58, 140], [-56, b - 30]], 5) },
      { cls: "st2", segs: bande.segs }, { cls: "st1", segs: ombre(bande, [36, 10], [36, 26], [[30, 18]]) }];
  });

  add(["femme", "ado"], "meches-colorees", "Longs à pointes colorées", { st0: C.brun, st2: C.violet }, (F) => {
    const b = F.sh + 90;
    const f = forme(longs(b, { larg: 90, graine: 53 }));
    // pointes : la même silhouette coupée sous la ligne v = b - 70 (contour des pointes repris à l'identique)
    const pts = f.pts.filter((p) => p.v > b - 66);
    const gauche = pts.filter((p) => p.u < 0), droite = pts.filter((p) => p.u >= 0);
    const yL = b - 70;
    const pointes = forme([P(-91, yL, true), P(-40, yL + 6), P(0, yL - 2), P(40, yL + 6), P(92, yL, true), ...droite.map((p) => ({ ...p })).sort((a, c) => c.u - a.u), ...gauche.map((p) => ({ ...p })).sort((a, c) => c.u - a.u)]);
    return [{ cls: "st0", segs: f.segs }, { cls: "st2", segs: pointes.segs }, { cls: "st1", segs: ombreLongs(f, b) },
      { cls: "st1", segs: meche([[-44, 40], [-60, 140], [-58, b - 30]], 5) }];
  });

  add(["enfant", "femme", "ado"], "couettes", "Couettes", { st0: C.chatain, st2: C.rose }, (F) => {
    const cap = forme(sym([P(0, -5), P(28, -2), P(50, 7), P(64, 24), P(72, 46), P(73, 70), P(70, 94), P(62, 118), P(50, 136), P(26, 144), P(0, 146)], { jitter: 1, graine: 54 }));
    const out = [{ cls: "st0", segs: cap.segs }, { cls: "st1", segs: ombre(cap, [0, -5], [0, 146], [[4, 40], [2, 100]]) }, { cls: "st1", segs: meche([[-1, -4], [0, 60], [-1, 140]], 1.6) }];
    for (const c of [-1, 1]) {
      const q = forme([P(c * 66, 54, true), P(c * 76, 46), P(c * 100, 60), P(c * 112, 96), P(c * 108, 140), P(c * 100, 164, true), P(c * 94, 130), P(c * 84, 96), P(c * 72, 76)]);
      out.push({ cls: "st0", segs: q.segs });
      if (c > 0) out.push({ cls: "st1", segs: ombre(q, [100, 60], [100, 164], [[100, 96], [100, 130]]) });
      else out.push({ cls: "st1", segs: meche([[-80, 62], [-98, 100], [-100, 150]], 4) });
      out.push({ cls: "st2", segs: ellipse(c * 72, 56, 9, 9, 8).segs });
    }
    return out;
  });

  add(["enfant", "femme", "ado"], "macarons", "Deux petits chignons", { st0: C.noir, st2: C.jaune }, (F) => {
    const cap = forme(sym([P(0, -5), P(28, -2), P(50, 7), P(64, 24), P(72, 46), P(73, 70), P(70, 94), P(62, 118), P(50, 136), P(26, 144), P(0, 146)], { jitter: 1, graine: 55 }));
    const out = [];
    for (const c of [-1, 1]) {
      const b = forme(festons(ellipse(c * 46, -4, 24, 22, 10).pts, 9, 2.4, 0.4));
      out.push({ cls: "st0", segs: b.segs }, { cls: "st1", segs: ombre(b, [c * 46, -28], [c * 46, 20], [[c * 46 + 10, -8]]) });
    }
    out.push({ cls: "st0", segs: cap.segs }, { cls: "st1", segs: ombre(cap, [0, -5], [0, 146], [[4, 40], [2, 100]]) }, { cls: "st1", segs: meche([[-1, -4], [0, 60], [-1, 140]], 1.6) });
    for (const c of [-1, 1]) out.push({ cls: "st2", segs: ellipse(c * 40, 14, 14, 5, 8, c * -0.5).segs });
    return out;
  });

  add(["enfant", "femme"], "noeud", "Cheveux mi-longs et gros nœud", { st0: C.blondFonce, st2: C.rouge }, (F) => {
    const b = F.sh + (F.enfant ? 20 : 30);
    const f = forme(longs(b, { larg: 86, graine: 56 }));
    const g = forme([P(0, 70, true), P(-16, 54), P(-36, 48), P(-42, 66), P(-38, 86), P(-18, 84)]);
    const d = forme([P(0, 70, true), P(18, 84), P(38, 86), P(42, 66), P(36, 48), P(16, 54)]);
    const r1_ = forme([P(-6, 76, true), P(-14, 100), P(-22, 120, true), P(-10, 116), P(-2, 84)]);
    const r2_ = forme([P(6, 76, true), P(2, 84), P(12, 116), P(24, 122, true), P(14, 100)]);
    return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombreLongs(f, b) }, { cls: "st1", segs: meche([[-40, 40], [-58, 120], [-58, b - 20]], 5) },
      { cls: "st2", segs: r1_.segs }, { cls: "st2", segs: r2_.segs }, { cls: "st2", segs: g.segs }, { cls: "st2", segs: d.segs },
      { cls: "st1", segs: ombre(d, [0, 70], [42, 66], [[24, 66], [36, 64]]) }, { cls: "st1", segs: meche([[-34, 56], [-20, 66], [-6, 70]], 2) },
      { cls: "st2", segs: ellipse(0, 70, 8, 9, 8).segs }, { cls: "st1", segs: ellipse(2, 72, 5, 6, 8).segs }];
  });

  // ======================= BARBES (homme) ===================================================
  // De dos, une barbe ne se voit que de part et d'autre de la mâchoire et du cou : on dessine
  // deux pans, sous l'oreille, qui ne passent JAMAIS devant le cou (bord intérieur = cou, u ±47).
  const pans = (droite) => {
    const d = forme(droite.map(([u, v, c]) => P(u, v, c)));
    const g = forme(droite.slice().reverse().map(([u, v, c]) => P(-u, v, c)));
    return { d, g };
  };
  const barbe = (id, nom, couleurs, droite, inter, extra) => add(["homme"], id, nom, couleurs, (F) => {
    const { d, g } = pans(droite);
    return [{ cls: "st0", segs: [...d.segs, null, ...g.segs] }, { cls: "st1", segs: ombre(d, inter[0], inter[1], inter[2]) }];
  }, { emplacement: "accessory", ...extra });
  barbe("barbe-courte", "Barbe courte", { st0: C.brun },
    [[70, 118, true], [77, 122], [76, 134], [68, 146], [58, 154], [48, 156, true], [47.5, 147], [54, 141], [62, 135], [69, 127]],
    [[77, 122], [48, 156], [[66, 142], [56, 150]]]);
  barbe("barbe-fournie", "Barbe fournie", { st0: C.noir },
    [[72, 112, true], [80, 118], [86, 134], [84, 152], [74, 170], [60, 182], [48, 186, true], [47.5, 160], [47.5, 147], [54, 141], [62, 135], [70, 124]],
    [[86, 134], [48, 186], [[74, 150], [62, 172]]]);
  barbe("barbe-longue-blanche", "Grande barbe blanche", { st0: C.blanc },
    [[72, 110, true], [82, 116], [90, 134], [92, 158], [86, 180], [74, 196], [60, 206, true], [52, 194], [47.5, 172], [47.5, 147], [54, 141], [62, 135], [70, 122]],
    [[90, 134], [60, 206], [[78, 156], [70, 186]]]);
  barbe("collier", "Collier de barbe", { st0: C.noir },
    [[71, 120, true], [75, 126], [70, 138], [60, 147], [48, 151, true], [47.5, 147], [54, 141], [62, 135], [68, 128]],
    [[75, 126], [48, 151], [[64, 140]]]);
  barbe("barbe-3-jours", "Barbe de trois jours", { st0: "#3A2B22" },
    [[70, 118, true], [77, 122], [76, 134], [68, 146], [58, 154], [48, 156, true], [47.5, 147], [54, 141], [62, 135], [69, 127]],
    [[77, 122], [48, 156], [[66, 142], [56, 150]]], { opacite: { st0: 0.45 }, note: "aplat à 45 % : la peau se voit au travers" });

  return L;
}

// ---------------------------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------------------------
function chemin(segs, F) {
  const X = (p) => r1(F.cx + p.u * F.s), Y = (p) => r1(F.top + p.v * F.s);
  let d = "", debut = true;
  for (const s of segs) {
    if (s === null) { d += "z"; debut = true; continue; }
    if (debut) { d += `M${X(s.p0)},${Y(s.p0)}`; debut = false; }
    d += `C${X(s.c1)},${Y(s.c1)} ${X(s.c2)},${Y(s.c2)} ${X(s.p3)},${Y(s.p3)}`;
  }
  return d + "z";
}

const NOMS_FAMILLE = { femme: "femme", homme: "homme", enfant: "enfant", ado: "ado" };
const liste = [];
const sorties = [];
for (const piece of piecesCommunes()) {
  for (const fam of piece.familles) {
    const F = FAMILLES[fam];
    const couches = piece.build(F);
    const classes = [...new Set(couches.map((c) => c.cls))].sort();
    const zones = Object.fromEntries(Object.entries(piece.couleurs).filter(([k]) => classes.includes(k)));
    const style = classes.map((k) => {
      if (k === "st1") return "\t.st1{opacity:0.15;}";
      const op = piece.opacite?.[k];
      return `\t.${k}{fill:${piece.couleurs[k]};${op ? `opacity:${op};` : ""}}`;
    }).join("\n");
    const fichier = `gab-coiffures-${fam}-${piece.id}.svg`;
    const mot = piece.emplacement === "hair" ? "Hair" : "Accessories";
    const idG = `${F.prefixe}_${mot}_Gab_${piece.id.replace(/[^a-z0-9]+/gi, "_")}`;
    const svg = `<!-- Gabarit de dos, famille ${fam} : ${piece.nom}. Dessinée sur le gabarit le 27/11, sans calage (Alexandra : « et pas de calage sur les nouveaux ») -->
<svg version="1.1" id="Gab_${fam}_${piece.id.replace(/[^a-z0-9]+/gi, "_")}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" width="500px" height="1000px" viewBox="0 0 500 1000" style="enable-background:new 0 0 500 1000;" xml:space="preserve">
<style type="text/css">
${style}
</style>
<g id="${idG}">
${couches.map((c) => `\t<path class="${c.cls}" d="${chemin(c.segs, F)}"/>`).join("\n")}
</g>
</svg>
`;
    writeFileSync(`${SORTIE}/${fichier}`, svg);
    sorties.push({ fichier, famille: fam, couches, F });
    liste.push({
      fichier, famille_gabarit: fam, gabarits: F.gabarits, corps_de_reference: F.reference,
      emplacement: piece.emplacement, vue: "back", nom: piece.nom, cle: piece.id,
      zones_de_couleur: zones, ...(piece.opacite ? { opacite: piece.opacite } : {}), ...(piece.note ? { note: piece.note } : {}),
      taille_octets: Buffer.byteLength(svg),
    });
  }
}
writeFileSync(PIECES, JSON.stringify({ date: "2026-11-27", regle: "Pièce plein cadre 500×1000 dessinée sur la tête commune de sa famille : aucun calage (slot_adjust vide, facteur_taille 1, decalage_x 0). À proposer seulement aux personnages de cette famille de gabarits.", pieces: liste }, null, 1));
// variantes « contrôle » : st0/st2 seuls, et st1 seul, pour vérifier que les ombres restent dans la coiffure
mkdirSync("/tmp/coif-ctrl", { recursive: true });
for (const s of sorties) {
  const ent = (cls) => `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="1000" viewBox="0 0 500 1000">${s.couches.filter((c) => cls(c.cls)).map((c) => `<path fill="#000" d="${chemin(c.segs, s.F)}"/>`).join("")}</svg>`;
  writeFileSync(`/tmp/coif-ctrl/${s.fichier}.plein.svg`, ent((k) => k !== "st1"));
  writeFileSync(`/tmp/coif-ctrl/${s.fichier}.ombre.svg`, ent((k) => k === "st1"));
}
console.log(`${liste.length} pièces écrites`);
