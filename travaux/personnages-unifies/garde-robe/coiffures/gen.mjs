// Garde-robe sur gabarits : les COIFFURES (slot hair), 27/11.
// Copie adaptée de coiffures/gen-coiffures.mjs (l'original n'est pas modifié).
//
// Alexandra, 27/11 au soir : « on doit pouvoir changer la peau, les fringues, accessoires etc ».
// Tous assis, de dos, dans le style des dessins actuels, et AUCUN calage sur les nouveaux.
//
// Principe : dans une famille (femme, homme, enfant, ado), le crâne est identique au pixel près sur
// tous les gabarits. Chaque coupe est décrite une fois dans un repère tête (u, v), puis posée par
// X = cx + u·s, Y = top + v·s, écrite en dur dans le chemin (aucun transform).
//
// Lancement, dans le conteneur memoryline-api :
//   cd /tmp/gr-coiffures && node gen.mjs            -> svg/, index.json, planches, contrôles
//   cd /tmp/gr-coiffures && node gen.mjs --publier  -> idem, puis copie LOCALE dans /app/data/assets
// Le dossier doit contenir ref/ (copie de garde-robe/commun/ref) et mes.json (commun/mes.json).
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const sharp = createRequire("/app/apps/api/package.json")("sharp");
const ICI = import.meta.dirname;
const SORTIE = `${ICI}/svg`;
const REF = `${ICI}/ref`;
const ASSETS = "/app/data/assets";
const PUBLIER = process.argv.includes("--publier");
const MARQUE = "Garde-robe sur gabarits";
mkdirSync(SORTIE, { recursive: true });

// ---------------------------------------------------------------------------------------------
// Familles : repère de la tête, gabarits (nom dans l'index -> fichier de contrôle dans ref/)
// sh = naissance des épaules en v ; aisselle = début du pli des bras (mes.json, ombres).
// ---------------------------------------------------------------------------------------------
const FAMILLES = {
  femme: {
    cx: 250, top: 178.4, s: 1, sh: 207.6, prefixe: "Female", aisselle: 478,
    gabarits: [["gabarit-dos-femme-standard-v2.svg", "gabarit-dos-femme-standard.svg"], ["gabarit-dos-femme-fine.svg"], ["gabarit-dos-femme-ronde.svg"], ["gabarit-dos-femme-agee.svg"]],
  },
  homme: {
    cx: 250.1, top: 161, s: 0.983, sh: 209.6, prefixe: "Male", aisselle: 502,
    gabarits: [["gabarit-dos-homme-standard-v2.svg", "gabarit-dos-homme-standard.svg"], ["gabarit-dos-homme-mince.svg"], ["gabarit-dos-homme-rond.svg"], ["gabarit-dos-homme-age.svg"]],
  },
  enfant: {
    cx: 250, top: 256.9, s: 1, sh: 191, enfant: true, prefixe: "Boy", aisselle: 524,
    gabarits: [["gabarit-dos-enfant-standard-v2.svg", "gabarit-dos-enfant-standard.svg"], ["gabarit-dos-enfant-fin.svg"], ["gabarit-dos-enfant-rond.svg"]],
  },
  ado: {
    cx: 275.7, top: 189.6, s: 0.883, sh: 210, prefixe: "Teenage_Boy", aisselle: 496,
    gabarits: [["gabarit-dos-ado-standard-v2.svg", "gabarit-dos-ado-standard.svg"], ["gabarit-dos-ado-fin.svg"]],
  },
};
for (const F of Object.values(FAMILLES)) F.gabarits = F.gabarits.map(([nom, ref]) => ({ nom, ref: ref ?? nom }));

// ---------------------------------------------------------------------------------------------
// Géométrie (reprise telle quelle de gen-coiffures.mjs, sauf le contrat de volume dans forme())
// ---------------------------------------------------------------------------------------------
const P = (u, v, c = false) => ({ u, v, c });
const r1 = (x) => (Math.round(x * 10) / 10).toString();

function alea(graine) {
  let s = graine >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function sym(droite, { jitter = 0, graine = 1 } = {}) {
  const r = alea(graine);
  const d = droite.map((p) => ({ ...p }));
  const g = droite.slice().reverse().filter((p) => Math.abs(p.u) > 1e-6).map((p) => ({ ...p, u: -p.u }));
  const tout = [...d, ...g.filter((p, i) => !(i === 0 && Math.abs(droite[droite.length - 1].u) < 1e-6))];
  const res = tout.filter((p, i) => i === 0 || !(Math.abs(p.u - tout[0].u) < 1e-6 && Math.abs(p.v - tout[0].v) < 1e-6));
  if (jitter) for (const p of res) if (!p.fixe) { p.u += (r() - 0.5) * jitter; p.v += (r() - 0.5) * jitter; }
  return res;
}

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

// Contrat de volume (conventions §5) : au-dessus de v 63, une coupe normale reste dans
// |u| ≤ demi(v) + 20 et v ≥ −28. MARGE = null pour une coupe volumineuse (pas de contrainte).
// Sur le dessus du crâne, on redescend le point (on garde sa largeur), sur les côtés on le rentre.
const DEMI = [[0, 0], [13, 46], [26, 59], [46, 68], [63, 70]];
function demi(v) {
  if (v <= 0) return 0;
  if (v >= 63) return 70;
  for (let i = 1; i < DEMI.length; i++) if (v <= DEMI[i][0]) { const [v0, d0] = DEMI[i - 1], [v1, d1] = DEMI[i]; return d0 + ((v - v0) / (v1 - v0)) * (d1 - d0); }
  return 70;
}
function demiInv(d) {
  if (d <= 0) return 0;
  for (let i = 1; i < DEMI.length; i++) if (d <= DEMI[i][1]) { const [v0, d0] = DEMI[i - 1], [v1, d1] = DEMI[i]; return v0 + ((d - d0) / (d1 - d0)) * (v1 - v0); }
  return 63;
}
let MARGE = null;
const SOMMET = -7; // le dessus d'une coupe normale ne monte pas plus haut (pas de pointe au milieu)
function contraindre(pts) {
  if (MARGE === null) return pts;
  const L = 20 - MARGE;
  return pts.map((p) => {
    if (p.v >= 63) return p;
    let { u, v } = p;
    const a = Math.abs(u);
    if (a > demi(v) + L) {
      if (v < 26 && a - L <= 59) v = Math.max(v, demiInv(a - L));
      else u = Math.sign(u) * (demi(v) + L);
    }
    if (v < SOMMET + MARGE / 2) v = SOMMET + MARGE / 2;
    if (u === p.u && v === p.v) return p;
    return { ...p, u, v, c: false };
  });
}
function forme(pts, tension = 1) { const q = contraindre(pts); return { pts: q, segs: segments(q, true, tension) }; }

function bezAt(s, t) {
  const a = (1 - t) ** 3, b = 3 * t * (1 - t) ** 2, c = 3 * t * t * (1 - t), d = t ** 3;
  return { u: a * s.p0.u + b * s.c1.u + c * s.c2.u + d * s.p3.u, v: a * s.p0.v + b * s.c1.v + c * s.c2.v + d * s.p3.v };
}
function echantillons(segs, k = 24) {
  const out = [];
  for (const s of segs) if (s) for (let i = 0; i < k; i++) out.push(bezAt(s, i / k));
  return out;
}
function aire(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.u * q.v - q.u * p.v; } return a / 2; }

function festons(base, n, haut, creux = 0.35, { garder } = {}) {
  const dense = echantillons(forme(base).segs, 40);
  const L = [0];
  for (let i = 1; i <= dense.length; i++) { const p = dense[i - 1], q = dense[i % dense.length]; L.push(L[i - 1] + Math.hypot(q.u - p.u, q.v - p.v)); }
  const tot = L[L.length - 1];
  const sens = aire(dense) > 0 ? 1 : -1;
  const at = (d) => {
    d = ((d % tot) + tot) % tot;
    let i = 1; while (L[i] < d) i++;
    const p = dense[i - 1], q = dense[i % dense.length], t = (d - L[i - 1]) / (L[i] - L[i - 1] || 1);
    const tu = q.u - p.u, tv = q.v - p.v, nn = Math.hypot(tu, tv) || 1;
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

function ombre(f, A, B, interieur) {
  const n = f.pts.length;
  const proche = (q) => { let bi = 0, bd = 1e9; f.pts.forEach((p, i) => { const d = Math.hypot(p.u - q[0], p.v - q[1]); if (d < bd) { bd = d; bi = i; } }); return bi; };
  const i = proche(A), j = proche(B);
  const arc = [];
  for (let k = i; k !== j; k = (k + 1) % n) arc.push(f.segs[k]);
  const ret = segments([f.pts[j], ...interieur.map(([u, v, c]) => P(u, v, c)), f.pts[i]].map((p, k, a) => (k === 0 || k === a.length - 1 ? { ...p, c: false } : p)), false);
  return [...arc, ...ret];
}
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
  return forme([...g, ...d.slice(1, -1).reverse()]).segs;
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
/** Cordon d'épaisseur constante, bout arrondi (locs). */
function corde(ligne, ep) {
  const pts = ligne.map(([u, v]) => P(u, v));
  const g = [], d = [];
  for (let k = 0; k < pts.length; k++) {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
    const tu = b.u - a.u, tv = b.v - a.v, nn = Math.hypot(tu, tv) || 1;
    const e = ep * (1 - 0.15 * (k / (pts.length - 1)));
    g.push(P(pts[k].u - (tv / nn) * e, pts[k].v + (tu / nn) * e, k === 0));
    d.push(P(pts[k].u + (tv / nn) * e, pts[k].v - (tu / nn) * e, k === 0));
  }
  const z = pts[pts.length - 1], y = pts[pts.length - 2], n = Math.hypot(z.u - y.u, z.v - y.v) || 1;
  const bout = P(z.u + ((z.u - y.u) / n) * ep * 0.85, z.v + ((z.v - y.v) / n) * ep * 0.85);
  return forme([...g, bout, ...d.reverse()]).segs;
}
function inverse(segs) { return segs.slice().reverse().map((s) => ({ p0: s.p3, c1: s.c2, c2: s.c1, p3: s.p0 })); }

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

// Calotte courte, ajustée par `vol` (volume au-dessus du crâne) et `bas` (nuque).
function calotte({ vol = 6, larg = 73, bas = 170, nuque = 42, oreille = 66 } = {}) {
  return [P(0, -vol), P(28, -vol + 2.5), P(50, -vol * 0.5 + 9), P(64, 24), P(larg, 46), P(larg - 0.5, 70), P(oreille, 96), P(60, 120), P(nuque + 8, 146), P(nuque, 160), P(22, bas - 2), P(0, bas)];
}
function ombreCalotte(f, bas = 168, decal = 0) {
  return ombre(f, [28, -4], [0, bas], [[40 + decal, 22], [36 + decal, 52], [26 + decal, 88], [18 + decal, 122], [16 + decal, bas - 18]]);
}
const capAttache = (graine, bas = 148) => forme(sym([P(0, -5), P(28, -2), P(50, 7), P(64, 24), P(72, 46), P(71, 70), P(66, 94), P(58, 118), P(48, bas - 12), P(26, bas - 2), P(0, bas)], { jitter: 1, graine }));

// ---------------------------------------------------------------------------------------------
// Couleurs
// ---------------------------------------------------------------------------------------------
const C = {
  brun: "#593314", chatain: "#8C5834", noir: "#281B13", blond: "#E7B033", blondFonce: "#CC9245",
  roux: "#CE6000", auburn: "#A05325", gris: "#A7A39C", blanc: "#DEDAD2", poivreSel: "#8E8A84", brunClair: "#97642F",
};
const ELASTIQUE = { jaune: "#EAAA0A", rose: "#FF96BF", bleu: "#0056AF" };

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbHex = (r, g, b) => "#" + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("").toUpperCase();
function tsl([r, g, b]) {
  const R = r / 255, G = g / 255, B = b / 255, max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h; if (max === R) h = (G - B) / d + (G < B ? 6 : 0); else if (max === G) h = (B - R) / d + 2; else h = (R - G) / d + 4;
  return [h * 60, s, l];
}
function rgb(h, s, l) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const k = (t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  const hn = (((h % 360) + 360) % 360) / 360;
  return [k(hn + 1 / 3) * 255, k(hn) * 255, k(hn - 1 / 3) * 255];
}
const vive = ([r, g, b]) => (Math.max(r, g, b) - Math.min(r, g, b)) / 255 >= 0.08;
/** Nuance de dessous : même teinte, même saturation, plus sombre de `dl` en clarté. */
function nuanceDe(hex, dl = 0.14) {
  const c = hexRgb(hex);
  if (!vive(c)) return rgbHex(...c.map((x) => x - dl * 255)); // un gris reste un gris (même écart entre canaux)
  const [h, s, l] = tsl(c);
  return rgbHex(...rgb(h, s, Math.max(0, l - dl)));
}
/** memeFamilleDeTeinte du moteur (couleurs-groupes.ts), recopiée pour le contrôle. */
function memeFamille(a, b) {
  const x = hexRgb(a), y = hexRgb(b), vx = vive(x), vy = vive(y);
  if (vx !== vy) return false;
  const tx = tsl(x), ty = tsl(y);
  if (!vx) return Math.abs(tx[2] - ty[2]) <= 0.35;
  const e = Math.abs(tx[0] - ty[0]) % 360;
  return Math.min(e, 360 - e) <= 12;
}
/** nuanceSuivante du moteur, recopiée pour la planche (dernière colonne). */
function nuanceSuivante(nuance, reference, choisie) {
  if (reference === choisie) return nuance;
  const n = hexRgb(nuance), r = hexRgb(reference), c = hexRgb(choisie);
  const [hr, sr, lr] = tsl(r), [hc, sc, lc] = tsl(c), [hn, sn, ln] = tsl(n);
  const refVive = vive(r);
  let l = ln <= lr ? (lr > 0 ? lc - (lr - ln) * Math.min(lc / lr, 2) : lc) : (lr < 1 ? lc + (ln - lr) * Math.min((1 - lc) / (1 - lr), 2) : lc);
  const s = refVive && sr > 0 ? Math.min(1, Math.max(0, sc * Math.min(2.5, Math.max(0.4, sn / sr)))) : sc;
  let h = hc; if (refVive && vive(n) && sc >= 0.05) h = hc + (((hn - hr + 540) % 360) - 180);
  return rgbHex(...rgb(h, s, Math.max(0, Math.min(1, l))));
}

// ---------------------------------------------------------------------------------------------
// Les coupes. Chaque constructeur rend [{ cls, segs }] dans le repère tête. st0 = cheveux,
// st3 = nuance des cheveux (mèches de dessous), st2 = élastique ou barbe, st1 = ombre.
// ---------------------------------------------------------------------------------------------
const K = {};

K.courtClassique = (F) => {
  const bas = F.enfant ? 158 : 170;
  const f = forme(sym(calotte({ bas }), { jitter: 1.5, graine: 11 }));
  return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombreCalotte(f, bas - 2) }];
};

K.epis = (F) => {
  const bas = F.enfant ? 158 : 166;
  const droite = [P(0, -16, true), P(10, -6), P(20, -19, true), P(30, -5), P(42, -14, true), P(50, 2), P(62, -2, true), P(64, 14), P(76, 18, true), P(72, 34), P(80, 44, true), P(73, 56), P(76, 70, true), P(68, 82), P(66, 98), P(60, 120), P(52, 144), P(44, 158), P(34, bas - 2, true), P(24, bas - 8), P(12, bas + 2, true), P(0, bas - 6)];
  const f = forme(sym(droite, { jitter: 2, graine: 12 }));
  return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombre(f, [30, -5], [24, bas - 8], [[42, 24], [36, 60], [26, 96], [20, 130]]) },
    { cls: "st1", segs: meche([[-30, 14], [-36, 44], [-34, 74]], 5) }];
};

K.brosse = () => {
  const droite = [P(0, -14), P(22, -14), P(44, -10, true), P(58, 2), P(68, 22), P(72, 46), P(71, 70), P(66, 94), P(60, 120), P(50, 146), P(40, 160), P(20, 166), P(0, 167)];
  const f = forme(sym(droite, { jitter: 1, graine: 13 }));
  return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombre(f, [22, -14], [0, 167], [[34, 18], [32, 56], [24, 96], [16, 140]]) }];
};

// Tondu : aplat opaque collé au crâne (les conventions interdisent l'opacité d'une zone).
K.tondu = () => {
  const droite = [P(0, -2.5), P(25, 1.5), P(47, 10.5), P(61, 24), P(70.5, 45), P(72.5, 63), P(70.5, 83), P(65, 103), P(57, 124), P(48, 140), P(26, 148), P(0, 150)];
  const f = forme(sym(droite));
  return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombreCalotte(f, 148, -6) }];
};

// Dégradé : dessus plein, côtés et nuque dans la nuance (plus courts, plus sombres).
K.degrade = (F) => {
  const bas = 168;
  const f = forme(sym(calotte({ vol: 8, bas }), { jitter: 1, graine: 61 }));
  const cote = forme(sym([P(0, 100), P(34, 94), P(58, 80), P(70.5, 60, true), P(71, 72), P(65, 96), P(59, 120), P(49, 146), P(41, 159), P(22, 166), P(0, 168)]));
  return [{ cls: "st0", segs: f.segs }, { cls: "st3", segs: cote.segs }, { cls: "st1", segs: ombreCalotte(f, bas - 2) },
    { cls: "st1", segs: meche([[-40, 6], [-36, 34], [-24, 60]], 3) }];
};

K.bol = () => {
  const droite = [P(0, -12), P(30, -9), P(54, 2), P(70, 20), P(80, 46), P(82, 72), P(80, 96), P(78, 112, true), P(62, 112), P(56, 128), P(48, 142), P(30, 150), P(0, 152)];
  const f = forme(sym(droite, { jitter: 1, graine: 15 }));
  return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombre(f, [30, -9], [0, 152], [[44, 22], [40, 60], [32, 96], [20, 130]]) },
    { cls: "st1", segs: meche([[-50, 30], [-60, 60], [-62, 100]], 4) }];
};

K.boucles = () => {
  const base = sym([P(0, -14), P(36, -10), P(62, 6), P(78, 34), P(80, 64), P(72, 94), P(62, 124), P(50, 148), P(26, 160), P(0, 162)]);
  const f = forme(festons(base, 22, 5, 0.4));
  const cercles = [];
  const r = alea(17);
  for (let k = 0; k < 14; k++) { const u = (r() - 0.5) * 110, v = 14 + r() * 126; if (Math.abs(u) < 56 - Math.max(0, v - 100) * 0.4) cercles.push(meche([[u - 6, v], [u, v - 4], [u + 6, v]], 1.8)); }
  return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombre(f, [36, -10], [0, 162], [[46, 26], [40, 66], [30, 110], [18, 146]]) }, ...cercles.map((s) => ({ cls: "st1", segs: s }))];
};

K.afro = () => {
  const base = sym([P(0, -40), P(48, -34), P(86, -8), P(104, 34), P(106, 80), P(96, 120), P(78, 150), P(50, 168), P(0, 176)]);
  const f = forme(festons(base, 30, 6, 0.45));
  const traits = [];
  const r = alea(18);
  for (let k = 0; k < 18; k++) { const u = (r() - 0.5) * 160, v = -20 + r() * 170; if (Math.hypot(u / 92, (v - 66) / 96) < 0.9) traits.push(meche([[u - 7, v], [u, v - 4], [u + 7, v]], 2)); }
  return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombre(f, [48, -34], [0, 176], [[60, 10], [54, 60], [40, 110], [22, 150]]) }, ...traits.map((s) => ({ cls: "st1", segs: s }))];
};

K.calvitie = () => {
  const droite = [P(0, 66), P(26, 62), P(48, 52), P(62, 40, true), P(70, 42), P(74.5, 60), P(73, 80), P(67, 98), P(62, 120), P(52, 144), P(42, 158), P(22, 166), P(0, 168)];
  const f = forme(sym(droite, { jitter: 2, graine: 19 }));
  return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombre(f, [48, 52], [0, 168], [[42, 76], [30, 112], [18, 150]]) },
    { cls: "st1", segs: meche([[-60, 58], [-44, 72], [-24, 78]], 2.5) }];
};

// Dégarni : la calotte percée sur le dessus ; le trou laisse voir la peau du gabarit.
K.degarni = () => {
  const f = forme(sym(calotte({ vol: 5 }), { jitter: 1.5, graine: 20 }));
  const trou = ellipse(2, 34, 34, 26, 12);
  const trouSegs = aire(echantillons(trou.segs)) * aire(echantillons(f.segs)) > 0 ? inverse(trou.segs) : trou.segs;
  return [{ cls: "st0", segs: [...f.segs, null, ...trouSegs] }, { cls: "st1", segs: ombre(f, [50, 6.5], [0, 170], [[52, 40], [40, 80], [26, 120], [18, 152]]) }];
};

K.blancsRaie = () => {
  const droite = [P(0, -7), P(20, -9), P(44, -2), P(62, 14), P(72, 38), P(73, 62), P(68, 90), P(62, 118), P(52, 144), P(42, 158), P(22, 166), P(0, 168)];
  const f = forme(sym(droite, { jitter: 1, graine: 21 }));
  return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombre(f, [44, -2], [0, 168], [[48, 30], [40, 70], [28, 112], [16, 150]]) },
    { cls: "st1", segs: meche([[-24, 6], [-14, 30], [-6, 70]], 2.5) }, { cls: "st1", segs: meche([[-50, 14], [-40, 40], [-34, 90]], 3) }];
};

K.poivreSel = () => {
  const f = forme(sym(calotte({ vol: 7 }), { jitter: 1.5, graine: 63 }));
  return [{ cls: "st0", segs: f.segs },
    { cls: "st3", segs: meche([[-44, 26], [-50, 64], [-46, 104]], 4.5) }, { cls: "st3", segs: meche([[-12, 14], [-16, 66], [-10, 120]], 4) },
    { cls: "st3", segs: meche([[22, 40], [28, 90], [22, 140]], 4) },
    { cls: "st1", segs: ombreCalotte(f, 168) }];
};

K.miLongsHomme = (F, { b = F.sh - 14 } = {}) => {
  const droite = [P(0, -10), P(30, -7), P(54, 4), P(72, 26), P(80, 56), P(82, 90), P(80, 124), P(76, b - 40), P(80, b - 8, true), P(64, b - 18), P(52, b, true), P(38, b - 14), P(24, b + 2, true), P(12, b - 10), P(0, b - 2, true)];
  const f = forme(sym(droite, { jitter: 2, graine: 22 }));
  return [{ cls: "st0", segs: f.segs }, { cls: "st3", segs: meche([[-46, 44], [-54, 100], [-50, b - 20]], 4.5) },
    { cls: "st1", segs: ombre(f, [30, -7], [12, b - 10], [[44, 26], [40, 70], [30, 120], [22, 170]]) },
    { cls: "st1", segs: meche([[-14, 60], [-18, 120], [-12, b - 20]], 3) }];
};

K.chignonHomme = () => {
  const cap = forme(sym([P(0, -4), P(28, -1), P(50, 8), P(64, 24), P(72, 46), P(71, 70), P(66, 94), P(58, 118), P(48, 140), P(28, 150), P(0, 152)], { jitter: 1, graine: 23 }));
  const bun = forme(festons(ellipse(0, 40, 26, 22, 10).pts, 7, 2, 0.3));
  return [{ cls: "st0", segs: cap.segs }, { cls: "st3", segs: bun.segs },
    { cls: "st1", segs: ombreCalotte(cap, 150, -4) },
    { cls: "st1", segs: meche([[-60, 30], [-30, 40], [-12, 44]], 2.5) }, { cls: "st1", segs: meche([[-56, 110], [-30, 80], [-12, 60]], 2.5) },
    { cls: "st1", segs: ombre(bun, [0, 18], [0, 62], [[14, 34], [10, 52]]) }, { cls: "st1", segs: meche([[-22, 62], [0, 70], [22, 62]], 3.5) }, { cls: "st1", segs: meche([[-12, 32], [0, 28], [12, 32]], 2) }];
};

K.queueBasseHomme = (F) => {
  const cap = capAttache(24);
  const t = 132, b = F.sh + 45;
  const queue = forme([P(-10, t, true), P(10, t, true), P(17, t + 30), P(15, b - 40), P(6, b, true), P(-6, b - 30), P(-15, t + 40)]);
  return [{ cls: "st0", segs: cap.segs }, { cls: "st0", segs: queue.segs }, { cls: "st2", segs: ellipse(0, t + 2, 12, 5, 8).segs },
    { cls: "st1", segs: ombreCalotte(cap, 146) },
    { cls: "st1", segs: meche([[-56, 40], [-30, 90], [-10, 126]], 2.5) }, { cls: "st1", segs: meche([[50, 30], [28, 90], [10, 126]], 2.5) },
    { cls: "st1", segs: ombre(queue, [10, t], [6, b], [[4, t + 40], [4, b - 30]]) }];
};

K.queueBasseFemme = (F) => {
  const cap = capAttache(64);
  const t = 128, b = F.sh + 75;
  const queue = forme([P(-12, t, true), P(12, t, true), P(22, t + 34), P(22, t + (b - t) * 0.6), P(10, b - 10), P(4, b, true), P(-8, b - 24), P(-20, t + (b - t) * 0.5), P(-20, t + 30)]);
  return [{ cls: "st0", segs: cap.segs }, { cls: "st0", segs: queue.segs },
    { cls: "st3", segs: meche([[-8, t + 22], [-12, t + (b - t) * 0.5], [-4, b - 26]], 3.5) },
    { cls: "st2", segs: ellipse(0, t + 2, 14, 6, 8).segs },
    { cls: "st1", segs: ombreCalotte(cap, 146) },
    { cls: "st1", segs: meche([[-58, 44], [-32, 96], [-10, 124]], 2.5) }, { cls: "st1", segs: meche([[50, 30], [28, 90], [10, 124]], 2.5) },
    { cls: "st1", segs: ombre(queue, [12, t], [4, b], [[8, t + 40], [8, b - 40]]) }];
};

K.locs = (F) => {
  const cap = forme(sym([P(0, -10), P(30, -7), P(54, 4), P(70, 24), P(78, 50), P(78, 80), P(70, 106), P(56, 126), P(30, 136), P(0, 138)], { jitter: 1.5, graine: 25 }));
  const fonds = [], ombres = [];
  const b = F.sh + 20;
  const r = alea(26);
  for (const x of [-70, -57, -44, -31, -18, -4, 10, 23, 36, 49, 61, 71]) {
    const v0 = Math.abs(x) > 60 ? 80 : 110;
    const len = b - v0 - r() * 30;
    const ox = x * 1.03 + (r() - 0.5) * 4;
    const ligne = [[x, v0], [ox + (r() - 0.5) * 6, v0 + len * 0.5], [ox + (x > 0 ? 3 : -3), v0 + len]];
    fonds.push({ cls: "st0", segs: corde(ligne, 6.5) });
    ombres.push({ cls: "st1", segs: meche([[ligne[0][0] + 2, ligne[0][1] + 10], [ligne[1][0] + 3, ligne[1][1]], [ligne[2][0] + 2, ligne[2][1] - 8]], 2.5) });
  }
  return [{ cls: "st0", segs: cap.segs }, ...fonds, { cls: "st1", segs: ombreCalotte(cap, 136, 4) }, ...ombres];
};

// --- longs ---
// Les longs se resserrent le long du cou (v 150 à 180, |u| ≤ 84) puis s'élargissent sur le dos :
// sinon ils flottent à plus de 40 px de la silhouette, entre la mâchoire et l'épaule.
const longs = (b, { larg = 88, vagues = 0, graine = 30, raie = true } = {}) => {
  const droite = [P(0, -14, raie), P(34, -10), P(60, 4), P(78, 28), P(86, 58), P(larg - 2, 96), P(Math.min(larg - 4, 82), 160)];
  const nb = Math.max(2, Math.round((b - 200) / 45));
  for (let k = 1; k <= nb; k++) droite.push(P(larg + 2 + (k % 2 ? vagues : -vagues), 160 + ((b - 170) * k) / nb));
  droite.push(P(larg - 2, b - 4, true), P(78, b - 16), P(66, b + 2, true), P(54, b - 12), P(40, b + 4, true), P(28, b - 10), P(14, b + 2, true), P(0, b - 8));
  return sym(droite, { jitter: 2, graine });
};
const ombreLongs = (f, b) => ombre(f, [34, -10], [14, b + 2], [[44, 20], [40, 60], [30, 110], [34, 170], [26, b - 60], [22, b - 20]]);

K.longsRaides = (F) => {
  const b = F.sh + (F.enfant ? 70 : 110);
  const f = forme(longs(b, { graine: 31 }));
  return [{ cls: "st0", segs: f.segs }, { cls: "st3", segs: meche([[-44, 44], [-60, 140], [-58, b - 30]], 5.5) },
    { cls: "st1", segs: ombreLongs(f, b) }, { cls: "st1", segs: meche([[-10, 30], [-16, 120], [-12, b - 40]], 3.5) }];
};

K.longsOndules = (F) => {
  const b = F.sh + 100;
  const f = forme(longs(b, { larg: 92, vagues: 8, graine: 32 }));
  return [{ cls: "st0", segs: f.segs },
    { cls: "st3", segs: meche([[-40, 34], [-60, 90], [-50, 150], [-64, 210], [-56, b - 20]], 5.5) },
    { cls: "st1", segs: ombreLongs(f, b) },
    { cls: "st1", segs: meche([[-12, 40], [-24, 110], [-8, 170], [-20, b - 30]], 4) },
    { cls: "st1", segs: meche([[56, 60], [70, 130], [58, 200]], 4) }];
};

// Longs à grandes boucles : le haut lisse, des anglaises festonnées sous l'oreille.
K.longsBoucles = (F) => {
  const b = F.sh + 95;
  const base = longs(b, { larg: 86, vagues: 6, graine: 62 });
  const f = forme(festons(base, 40, 7, 0.55, { garder: (q) => q.v > 112 }));
  const boucles = [];
  for (const [u, v] of [[-62, 150], [-40, 205], [-66, 250], [-20, 270], [56, 170], [30, 230], [64, 262], [-6, 160]]) {
    if (v > b - 24) continue;
    boucles.push({ cls: "st3", segs: meche([[u + 7, v - 2], [u - 6, v + 6], [u - 5, v + 17], [u + 7, v + 24]], 4) });
  }
  return [{ cls: "st0", segs: f.segs }, ...boucles, { cls: "st1", segs: ombreLongs(f, b) },
    { cls: "st1", segs: meche([[-12, 34], [-20, 90], [-10, 130]], 3.5) }];
};

K.frisesLongs = (F) => {
  const b = F.sh + 80;
  const base = sym([P(0, -20), P(44, -16), P(76, 4), P(92, 40), P(94, 90), P(80, 162), P(96, 215), P(98, b - 40), P(86, b), P(50, b + 8), P(0, b + 4)]);
  const f = forme(festons(base, 34, 6, 0.45));
  const r = alea(51);
  const boucles = [];
  for (let k = 0; k < 26; k++) { const u = (r() - 0.5) * 170, v = 20 + r() * (b - 30); if (Math.abs(u) < 80) boucles.push(meche([[u - 7, v + 1], [u, v - 4], [u + 7, v + 1]], 2)); }
  return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombre(f, [44, -16], [0, b + 4], [[54, 20], [46, 80], [40, 150], [28, b - 30]]) }, ...boucles.map((s) => ({ cls: "st1", segs: s }))];
};

K.carre = (F, { b = F.enfant ? 150 : 158, nuance = false, graine = 33 } = {}) => {
  const droite = [P(0, -12, true), P(34, -9), P(60, 4), P(78, 28), P(86, 58), P(88, 96), P(88, Math.min(130, b - 20)), P(86, b - 4, true), P(60, b + 2), P(30, b + 4), P(0, b + 4)];
  const f = forme(sym(droite, { jitter: 1, graine }));
  const m = meche([[-40, 34], [-56, 90], [-56, b - 10]], nuance ? 5 : 4);
  return [{ cls: "st0", segs: f.segs }, ...(nuance ? [{ cls: "st3", segs: m }] : []),
    { cls: "st1", segs: ombre(f, [34, -9], [30, b + 4], [[44, 24], [38, 70], [30, Math.min(120, b - 20)]]) },
    ...(nuance ? [{ cls: "st1", segs: meche([[-10, 30], [-14, 80], [-10, b - 16]], 3) }] : [{ cls: "st1", segs: m }])];
};

K.carrePlongeant = (F) => {
  const b = F.sh - 2;
  const droite = [P(0, -12, true), P(34, -9), P(60, 4), P(78, 28), P(86, 58), P(88, 96), P(86, 140), P(82, 168), P(90, b - 10, true), P(78, b - 18), P(70, b, true), P(52, b - 14), P(40, b - 30, true), P(20, b - 44), P(0, b - 48)];
  const f = forme(sym(droite, { jitter: 1.5, graine: 34 }));
  return [{ cls: "st0", segs: f.segs }, { cls: "st3", segs: meche([[-44, 34], [-62, 100], [-74, b - 12]], 5) },
    { cls: "st1", segs: ombre(f, [34, -9], [20, b - 44], [[44, 24], [38, 70], [30, 110]]) }];
};

K.pixie = () => {
  const droite = [P(0, -10), P(24, -12), P(46, -4), P(64, 12), P(74, 36), P(75, 60), P(70, 86), P(64, 108), P(56, 130), P(48, 146, true), P(36, 140), P(26, 154, true), P(14, 146), P(0, 156, true)];
  const f = forme(sym(droite, { jitter: 1.5, graine: 35 }));
  return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombre(f, [24, -12], [14, 146], [[40, 16], [36, 56], [26, 100]]) },
    { cls: "st1", segs: meche([[-46, 14], [-36, 44], [-28, 80]], 3) }];
};

K.courteBlanche = () => {
  const droite = [P(0, -10), P(30, -8), P(54, 4), P(70, 24), P(78, 48), P(77, 74), P(71, 100), P(63, 124), P(54, 140, true), P(42, 134), P(30, 150, true), P(16, 140), P(0, 152, true)];
  const f = forme(sym(droite, { jitter: 1.5, graine: 65 }));
  return [{ cls: "st0", segs: f.segs },
    { cls: "st3", segs: meche([[-50, 30], [-58, 80], [-50, 124]], 4.5) }, { cls: "st3", segs: meche([[-8, 20], [-14, 80], [-6, 136]], 3.5) },
    { cls: "st1", segs: ombre(f, [30, -8], [16, 140], [[42, 20], [38, 60], [28, 104]]) }];
};

K.courtBoucle = () => {
  const base = sym([P(0, -12), P(36, -8), P(60, 6), P(76, 30), P(81, 60), P(78, 92), P(70, 118), P(56, 138), P(28, 148), P(0, 150)]);
  const f = forme(festons(base, 24, 4.5, 0.4));
  const r = alea(66);
  const boucles = [];
  for (let k = 0; k < 16; k++) { const u = (r() - 0.5) * 120, v = 16 + r() * 118; if (Math.hypot(u / 62, (v - 72) / 64) < 0.9) boucles.push(meche([[u - 6, v + 1], [u, v - 4], [u + 6, v + 1]], 1.8)); }
  return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombre(f, [36, -8], [0, 150], [[46, 22], [42, 68], [30, 116]]) }, ...boucles.map((s) => ({ cls: "st1", segs: s }))];
};

K.miLongsFemme = (F) => {
  const b = F.sh + 14;
  const droite = [P(0, -13, true), P(34, -10), P(60, 4), P(78, 28), P(86, 58), P(88, 96), P(86, 135), P(82, 166), P(92, b - 26), P(102, b - 8, true), P(86, b - 6), P(70, b + 2, true), P(54, b - 8), P(36, b + 2, true), P(18, b - 6), P(0, b + 2)];
  const f = forme(sym(droite, { jitter: 2, graine: 36 }));
  return [{ cls: "st0", segs: f.segs }, { cls: "st3", segs: meche([[-46, 44], [-60, 110], [-74, b - 14]], 5) },
    { cls: "st1", segs: ombre(f, [34, -10], [18, b - 6], [[44, 24], [38, 70], [30, 120], [26, 170]]) },
    { cls: "st1", segs: meche([[-12, 50], [-18, 120], [-14, b - 16]], 3) }];
};

// Frange longue (ado) : dessus long, mèches qui retombent sur un côté, nuque dégradée.
K.frangeLongue = () => {
  const b = 166;
  const droite = [P(0, -16, true), P(30, -11), P(56, 2), P(74, 24), P(82, 54), P(84, 88), P(80, 120), P(74, b - 22), P(68, b - 4, true), P(56, b - 16), P(44, b + 2, true), P(32, b - 12), P(18, b + 2, true), P(6, b - 10), P(0, b - 4)];
  const f = forme(sym(droite, { jitter: 1.5, graine: 67 }));
  return [{ cls: "st0", segs: f.segs },
    { cls: "st3", segs: meche([[-22, -6], [10, 30], [44, 70], [62, 112]], 6) },
    { cls: "st3", segs: meche([[-50, 30], [-60, 80], [-56, 130]], 4.5) },
    { cls: "st1", segs: ombre(f, [30, -11], [18, b + 2], [[44, 26], [40, 70], [30, 120]]) }];
};

const ponytail = (F, { t, b, w = 28, graine = 40 }) => {
  const cap = capAttache(graine);
  const q = forme([P(-12, t, true), P(12, t, true), P(w, t + 30), P(w - 2, t + (b - t) * 0.55), P(10, b - 16), P(4, b, true), P(-6, b - 22), P(-w + 6, t + (b - t) * 0.5), P(-w + 2, t + 26)]);
  const chou = forme(festons(ellipse(0, t, 15, 8, 10).pts, 6, 1.6, 0.4));
  return [{ cls: "st0", segs: cap.segs }, { cls: "st0", segs: q.segs },
    { cls: "st3", segs: meche([[-8, t + 20], [-14, t + (b - t) * 0.5], [-4, b - 30]], 3.5) },
    { cls: "st2", segs: chou.segs },
    { cls: "st1", segs: ombreCalotte(cap, 146) },
    { cls: "st1", segs: meche([[-60, 50], [-32, t - 10], [-14, t - 4]], 2.5) }, { cls: "st1", segs: meche([[-50, 120], [-26, t + 2], [-14, t + 6]], 2) },
    { cls: "st1", segs: ombre(q, [12, t], [4, b], [[10, t + 40], [8, b - 40]]) },
    { cls: "st1", segs: ombre(chou, [0, t - 8], [0, t + 8], [[6, t]]) }];
};
K.queueDeCheval = (F) => ponytail(F, { t: 110, b: F.sh + (F.enfant ? 40 : 90), graine: 41 });
K.queueHaute = (F) => ponytail(F, { t: 36, b: F.sh + (F.enfant ? 10 : 50), w: 30, graine: 42 });

const bunF = (cv, r) => forme(festons(ellipse(0, cv, r, r * 0.88, 10).pts, 8, 2.4, 0.3));
K.chignonHaut = () => {
  const cap = capAttache(43);
  const b = bunF(-24, 32);
  return [{ cls: "st0", segs: b.segs }, { cls: "st0", segs: cap.segs },
    { cls: "st1", segs: ombre(b, [0, -52], [0, 4], [[14, -30], [10, -10]]) },
    { cls: "st1", segs: meche([[-20, -36], [0, -44], [18, -34]], 2.5) },
    { cls: "st1", segs: ombreCalotte(cap, 146) },
    { cls: "st1", segs: meche([[-60, 60], [-36, 20], [-12, 4]], 2.5) }, { cls: "st1", segs: meche([[-30, 130], [-20, 60], [-6, 8]], 2) },
    { cls: "st1", segs: meche([[-20, 2], [0, 6], [20, 2]], 2.5) }];
};

K.chignonBas = () => {
  const cap = capAttache(45);
  const b = bunF(132, 34);
  return [{ cls: "st0", segs: cap.segs }, { cls: "st3", segs: b.segs },
    { cls: "st1", segs: ombreCalotte(cap, 146) },
    { cls: "st1", segs: meche([[-60, 50], [-30, 90], [-14, 98]], 2.5) }, { cls: "st1", segs: meche([[50, 30], [28, 80], [14, 96]], 2.5) },
    { cls: "st1", segs: ombre(b, [0, 102], [0, 162], [[16, 124], [12, 148]]) },
    { cls: "st1", segs: meche([[-22, 124], [0, 114], [20, 126]], 2.5) }, { cls: "st1", segs: meche([[-18, 144], [0, 136], [18, 146]], 2.2) }];
};

K.chignonGrandMere = () => {
  const droite = [P(0, -10), P(30, -8), P(54, 4), P(70, 24), P(78, 48), P(76, 72), P(68, 96), P(58, 118), P(46, 134), P(24, 142), P(0, 144)];
  const cap = forme(sym(droite, { jitter: 1.5, graine: 47 }));
  const b = forme(festons(ellipse(0, 74, 31, 26, 10).pts, 9, 2, 0.3));
  return [{ cls: "st0", segs: cap.segs }, { cls: "st0", segs: b.segs },
    { cls: "st3", segs: meche([[-20, 62], [-4, 54], [14, 60], [18, 76], [6, 88]], 3) }, { cls: "st3", segs: meche([[-22, 86], [-8, 96], [10, 94]], 2.5) },
    { cls: "st1", segs: ombreCalotte(cap, 142, 4) },
    { cls: "st1", segs: meche([[-66, 40], [-44, 62], [-28, 70]], 3) }, { cls: "st1", segs: meche([[-60, 110], [-40, 96], [-26, 88]], 3) },
    { cls: "st1", segs: meche([[-26, 10], [-20, 30], [-10, 46]], 2.5) },
    { cls: "st1", segs: ombre(b, [0, 47], [0, 101], [[14, 66], [10, 88]]) },
    { cls: "st1", segs: meche([[-26, 100], [0, 106], [26, 100]], 3) }];
};

K.permanente = () => {
  const base = sym([P(0, -18), P(40, -14), P(66, 2), P(84, 28), P(88, 62), P(84, 96), P(74, 122), P(58, 142), P(30, 150), P(0, 152)]);
  const f = forme(festons(base, 26, 5, 0.4));
  const r = alea(48);
  const boucles = [];
  for (let k = 0; k < 18; k++) { const u = (r() - 0.5) * 140, v = 10 + r() * 130; if (Math.hypot(u / 72, (v - 70) / 74) < 0.92) boucles.push(meche([[u - 6, v + 1], [u, v - 4], [u + 6, v + 1]], 1.8)); }
  return [{ cls: "st0", segs: f.segs }, { cls: "st1", segs: ombre(f, [40, -14], [0, 152], [[48, 20], [42, 70], [30, 120]]) }, ...boucles.map((s) => ({ cls: "st1", segs: s }))];
};

K.natte = (F) => {
  const cap = capAttache(49, 146);
  const t = 126, b = F.sh + (F.enfant ? 60 : 110);
  const n = natte(0, t, 4, b - 18, F.enfant ? 34 : 40, Math.round((b - t) / 24), 4);
  const pointe = forme([P(-6, b - 22, true), P(8, b - 22, true), P(12, b - 4), P(4, b + 12, true), P(-8, b - 2)]);
  return [{ cls: "st0", segs: cap.segs }, ...n.corps.map((s) => ({ cls: "st0", segs: s })), { cls: "st0", segs: pointe.segs },
    { cls: "st2", segs: ellipse(3, b - 22, 11, 5, 8).segs },
    { cls: "st1", segs: ombreCalotte(cap, 144) },
    { cls: "st1", segs: meche([[-60, 40], [-30, 100], [-10, 128]], 2.5) }, { cls: "st1", segs: meche([[50, 30], [28, 90], [10, 128]], 2.5) },
    ...n.ombres.map((s) => ({ cls: "st1", segs: s })), { cls: "st1", segs: ombre(pointe, [8, b - 18], [4, b + 12], [[4, b - 4]]) }];
};

K.deuxNattes = (F) => {
  const cap = forme(sym([P(0, -5), P(28, -2), P(50, 7), P(64, 24), P(72, 46), P(73, 70), P(70, 94), P(62, 118), P(50, 136), P(26, 144), P(0, 146)], { jitter: 1, graine: 50 }));
  const t = 112, b = F.sh + (F.enfant ? 40 : 80);
  const fonds = [], elast = [], ombres = [];
  for (const cote of [-1, 1]) {
    const n = natte(cote * 46, t, cote * 54, b - 16, 28, Math.round((b - t) / 22), cote * 4);
    fonds.push(...n.corps.map((s) => ({ cls: "st0", segs: s })));
    ombres.push(...n.ombres.map((s) => ({ cls: "st1", segs: s })));
    const p = forme([P(cote * 54 - 6, b - 20, true), P(cote * 54 + 6, b - 20, true), P(cote * 54 + 9, b - 4), P(cote * 54 + 2, b + 10, true), P(cote * 54 - 8, b - 2)]);
    fonds.push({ cls: "st0", segs: p.segs });
    elast.push({ cls: "st2", segs: ellipse(cote * 54, b - 20, 10, 4.5, 8).segs });
  }
  return [{ cls: "st0", segs: cap.segs }, ...fonds, ...elast,
    { cls: "st1", segs: ombre(cap, [0, -5], [0, 146], [[4, 40], [2, 100]]) }, { cls: "st1", segs: meche([[-1, 2], [0, 60], [-1, 140]], 1.6) }, ...ombres];
};

// Couettes : attachées sous le contrat de volume (v ≥ 63 pour la partie large).
K.couettes = () => {
  const cap = forme(sym([P(0, -5), P(28, -2), P(50, 7), P(64, 24), P(72, 46), P(73, 70), P(70, 94), P(62, 118), P(50, 136), P(26, 144), P(0, 146)], { jitter: 1, graine: 54 }));
  const out = [{ cls: "st0", segs: cap.segs }], el = [], om = [];
  const d = 16;
  for (const c of [-1, 1]) {
    const q = forme([P(c * 66, 54 + d, true), P(c * 76, 46 + d), P(c * 100, 60 + d), P(c * 112, 96 + d), P(c * 108, 140 + d), P(c * 100, 164 + d, true), P(c * 94, 130 + d), P(c * 84, 96 + d), P(c * 72, 76 + d)]);
    out.push({ cls: "st0", segs: q.segs });
    if (c > 0) om.push({ cls: "st1", segs: ombre(q, [100, 60 + d], [100, 164 + d], [[100, 96 + d], [100, 130 + d]]) });
    else om.push({ cls: "st1", segs: meche([[-82, 64 + d], [-98, 100 + d], [-100, 150 + d]], 4) });
    el.push({ cls: "st2", segs: ellipse(c * 72, 56 + d, 9, 9, 8).segs });
  }
  return [...out, ...el, { cls: "st1", segs: ombre(cap, [0, -5], [0, 146], [[4, 40], [2, 100]]) }, { cls: "st1", segs: meche([[-1, 2], [0, 60], [-1, 140]], 1.6) }, ...om];
};

K.macarons = () => {
  const cap = forme(sym([P(0, -5), P(28, -2), P(50, 7), P(64, 24), P(72, 46), P(73, 70), P(70, 94), P(62, 118), P(50, 136), P(26, 144), P(0, 146)], { jitter: 1, graine: 55 }));
  const out = [], om = [];
  for (const c of [-1, 1]) {
    const b = forme(festons(ellipse(c * 48, -12, 24, 22, 10).pts, 9, 2.4, 0.4));
    out.push({ cls: "st0", segs: b.segs });
    om.push({ cls: "st1", segs: ombre(b, [c * 48, -36], [c * 48, 10], [[c * 48 + 10, -14]]) });
  }
  out.push({ cls: "st0", segs: cap.segs });
  for (const c of [-1, 1]) out.push({ cls: "st2", segs: ellipse(c * 40, 8, 15, 5.5, 8, c * -0.55).segs });
  return [...out, { cls: "st1", segs: ombre(cap, [0, -5], [0, 146], [[4, 40], [2, 100]]) }, { cls: "st1", segs: meche([[-1, 2], [0, 60], [-1, 140]], 1.6) }, ...om];
};

// --- barbes (dans la coiffure, zone st2 « Barbe ») ---
// De dos, deux pans sous l'oreille, de part et d'autre du cou, jamais devant (bord intérieur u ±47).
const BARBES = {
  courte: { pts: [[70, 118, true], [77, 122], [76, 134], [68, 146], [58, 154], [48, 156, true], [47.5, 147], [54, 141], [62, 135], [69, 127]], om: [[77, 122], [48, 156], [[66, 142], [56, 150]]] },
  troisJours: { pts: [[69, 120, true], [74.5, 124], [73, 134], [66, 143], [56, 149], [48, 151, true], [47.5, 145], [54, 139], [62, 133], [68, 127]], om: [[74.5, 124], [48, 151], [[64, 140]]] },
  fournie: { pts: [[72, 112, true], [80, 118], [86, 134], [84, 152], [74, 170], [60, 182], [48, 186, true], [47.5, 160], [47.5, 147], [54, 141], [62, 135], [70, 124]], om: [[86, 134], [48, 186], [[74, 150], [62, 172]]] },
  longue: { pts: [[72, 110, true], [82, 116], [88, 134], [87, 156], [81, 176], [71, 192], [60, 204, true], [52, 192], [47.5, 172], [47.5, 147], [54, 141], [62, 135], [70, 122]], om: [[88, 134], [60, 204], [[76, 156], [68, 184]]] },
  // dépasse de part et d'autre des cheveux mi-longs (bord intérieur sur le bord des cheveux)
  // sous l'ourlet des mi-longs raccourcis (b = 176), de part et d'autre du cou
sousMiLongs: { pts: [[76, 158, true], [83, 168], [82, 184], [74, 198], [60, 208], [48, 210, true], [47.5, 192], [47.5, 172], [56, 168], [66, 164]], om: [[83, 168], [48, 210], [[70, 186], [58, 200]]] },
};
function barbe(nom) {
  const B = BARBES[nom];
  const d = forme(B.pts.map(([u, v, c]) => P(u, v, c)));
  const g = forme(B.pts.slice().reverse().map(([u, v, c]) => P(-u, v, c)));
  return { fond: { cls: "st2", segs: [...d.segs, null, ...g.segs] }, ombre: { cls: "st1", segs: ombre(d, B.om[0], B.om[1], B.om[2]) } };
}
const avecBarbe = (coupe, nom) => (F) => {
  const c = coupe(F), b = barbe(nom);
  return [...c.filter((x) => x.cls !== "st1"), b.fond, ...c.filter((x) => x.cls === "st1"), b.ombre];
};

// ---------------------------------------------------------------------------------------------
// Le catalogue, famille par famille (ordre = numéros 1000, 1001…)
// options : st2 = { groupe, couleur } ; vol = volumineuse ; pend = dépasse en pendant (nattes,
// couettes) ; nu = calvitie/dégarni/tondu (dispensé de la zone à couvrir).
// ---------------------------------------------------------------------------------------------
const el = (couleur) => ({ groupe: "Élastique", couleur });
const barbeZ = (couleur) => ({ groupe: "Barbe", couleur });
const CATALOGUE = {
  femme: [
    ["longs-raides", "Longs raides", K.longsRaides, C.brun],
    ["longs-ondules", "Longs ondulés", K.longsOndules, C.chatain],
    ["longs-boucles", "Longs à grandes boucles", K.longsBoucles, C.roux],
    ["frises-longs", "Longs frisés", K.frisesLongs, C.noir],
    ["mi-longs", "Mi-longs aux épaules", K.miLongsFemme, C.blondFonce],
    ["carre", "Carré", K.carre, C.noir],
    ["carre-plongeant", "Carré plongeant", K.carrePlongeant, C.auburn],
    ["carre-court-gris", "Carré court gris", (F) => K.carre(F, { b: 140, nuance: true, graine: 68 }), C.gris],
    ["pixie", "Coupe garçonne", K.pixie, C.blond],
    ["court-boucle", "Court bouclé", K.courtBoucle, C.brun],
    ["queue-de-cheval", "Queue de cheval", K.queueDeCheval, C.brun, { st2: el(ELASTIQUE.rose) }],
    ["queue-basse", "Queue de cheval basse", K.queueBasseFemme, C.chatain, { st2: el(ELASTIQUE.bleu) }],
    ["queue-haute", "Queue de cheval haute", K.queueHaute, C.blond, { st2: el(ELASTIQUE.rose), vol: true }],
    ["chignon-haut", "Chignon haut", K.chignonHaut, C.chatain, { vol: true }],
    ["chignon-bas", "Chignon bas", K.chignonBas, C.auburn],
    ["natte", "Natte", K.natte, C.blondFonce, { st2: el(ELASTIQUE.bleu), pend: true }],
    ["deux-nattes", "Deux nattes", K.deuxNattes, C.roux, { st2: el(ELASTIQUE.rose), pend: true }],
    ["afro", "Afro", K.afro, C.noir, { vol: true }],
    ["permanente-courte-grise", "Permanente courte grise", K.permanente, C.gris],
    ["chignon-grand-mere", "Chignon de grand-mère", K.chignonGrandMere, C.blanc],
    ["courte-blanche", "Courte blanche", K.courteBlanche, C.blanc],
  ],
  homme: [
    ["court-classique", "Court classique", K.courtClassique, C.brun],
    ["court-epis", "Court en épis", K.epis, C.chatain],
    ["court-brosse", "Brosse courte", K.brosse, C.noir],
    ["tondu", "Tondu ras", K.tondu, "#6B3E1E", { nu: true }],
    ["degrade", "Dégradé", K.degrade, C.chatain],
    ["boucles-courtes", "Boucles courtes", K.boucles, C.noir],
    ["afro", "Afro", K.afro, C.noir, { vol: true }],
    ["mi-longs", "Mi-longs dans le cou", K.miLongsHomme, C.blondFonce],
    ["chignon-homme", "Chignon", K.chignonHomme, C.chatain],
    ["queue-basse", "Queue de cheval basse", K.queueBasseHomme, C.auburn, { st2: el(ELASTIQUE.jaune) }],
    ["locs", "Dreadlocks", K.locs, C.noir],
    ["poivre-sel-court", "Court poivre et sel", K.poivreSel, C.poivreSel],
    ["blancs-raie", "Blancs, raie sur le côté", K.blancsRaie, C.blanc],
    ["degarni-tonsure", "Dégarni sur le dessus", K.degarni, C.poivreSel, { nu: true }],
    ["calvitie-couronne", "Calvitie, couronne de cheveux", K.calvitie, C.gris, { nu: true }],
    ["court-classique-barbe", "Court classique et barbe", avecBarbe(K.courtClassique, "courte"), C.brun, { st2: barbeZ(C.poivreSel) }],
    ["tondu-barbe-3-jours", "Tondu et barbe de trois jours", avecBarbe(K.tondu, "troisJours"), C.chatain, { st2: barbeZ("#24222C"), nu: true }],
    ["mi-longs-barbe", "Mi-longs et barbe", avecBarbe((F) => K.miLongsHomme(F, { b: 176 }), "sousMiLongs"), C.blond, { st2: barbeZ("#6B3E1E") }],
    ["degarni-barbe-grise", "Dégarni et barbe grise", avecBarbe(K.degarni, "fournie"), C.blanc, { st2: barbeZ(C.poivreSel), nu: true }],
    ["calvitie-barbe-blanche", "Calvitie et barbe blanche", avecBarbe(K.calvitie, "longue"), C.gris, { st2: barbeZ("#F4F3F2"), nu: true }],
  ],
  enfant: [
    ["court-garcon", "Court de garçon", K.courtClassique, C.brun],
    ["bol", "Coupe au bol", K.bol, C.blondFonce],
    ["epis", "Épis", K.epis, C.chatain],
    ["boucles-courtes", "Boucles courtes", K.boucles, C.noir],
    ["afro", "Afro", K.afro, C.noir, { vol: true }],
    ["carre", "Carré", (F) => K.carre(F, { nuance: true }), C.auburn],
    ["mi-longs", "Mi-longs aux épaules", K.miLongsFemme, C.blond],
    ["longs-raides", "Longs raides", K.longsRaides, C.roux],
    ["queue-de-cheval", "Queue de cheval", K.queueDeCheval, C.brun, { st2: el(ELASTIQUE.rose) }],
    ["couettes", "Couettes", K.couettes, C.chatain, { st2: el(ELASTIQUE.rose), pend: true }],
    ["deux-nattes", "Deux nattes", K.deuxNattes, C.roux, { st2: el(ELASTIQUE.bleu), pend: true }],
    ["macarons", "Deux petits chignons", K.macarons, C.noir, { st2: el(ELASTIQUE.jaune), vol: true }],
  ],
  ado: [
    ["court-classique", "Court classique", K.courtClassique, C.brun],
    ["degrade", "Dégradé", K.degrade, C.chatain],
    ["epis", "Épis", K.epis, C.blondFonce],
    ["boucles", "Boucles", K.boucles, C.noir],
    ["mi-longs", "Mi-longs dans le cou", K.miLongsHomme, C.auburn],
    ["frange-longue", "Frange longue", K.frangeLongue, C.blond],
    ["longs-raides", "Longs raides", K.longsRaides, C.brun],
    ["queue-de-cheval", "Queue de cheval", K.queueDeCheval, C.chatain, { st2: el(ELASTIQUE.bleu) }],
    ["chignon-haut", "Chignon haut", K.chignonHaut, C.noir, { vol: true }],
  ],
};

// ---------------------------------------------------------------------------------------------
// Construction : contrat de volume, ordre de peinture, chemins
// ---------------------------------------------------------------------------------------------
const RANG = (cls) => (cls === "st1" ? 1e6 : Number(cls.slice(2)));
function violation(couches) {
  let max = -Infinity;
  for (const c of couches) {
    if (c.cls === "st1") continue;
    for (const p of echantillons(c.segs, 24)) {
      if (p.v < 63) max = Math.max(max, Math.abs(p.u) - (demi(p.v) + 20));
      max = Math.max(max, -28 - p.v);
    }
  }
  return max;
}
function construire(build, F, vol) {
  let dernier;
  for (const m of [2, 4, 6, 8, 10, 13, 16]) {
    MARGE = vol ? null : m;
    const couches = build(F);
    MARGE = null;
    const v = violation(couches);
    dernier = { couches, marge: m, viol: v };
    if (vol || v <= 0.3) return dernier;
  }
  return dernier;
}
function chemin(segs, F) {
  const X = (p) => r1(F.cx + p.u * F.s), Y = (p) => r1(F.top + p.v * F.s);
  let d = "", debut = true;
  for (const s of segs) {
    if (s === null) { d += "Z"; debut = true; continue; }
    if (debut) { d += `M${X(s.p0)},${Y(s.p0)}`; debut = false; }
    d += `C${X(s.c1)},${Y(s.c1)} ${X(s.c2)},${Y(s.c2)} ${X(s.p3)},${Y(s.p3)}`;
  }
  return d + "Z";
}
const snake = (s) => s.split("-").map((m) => m.charAt(0).toUpperCase() + m.slice(1)).join("_");
const sansAccent = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

function svgDe({ fichier, nomLisible, idSvg, idGroupe, couleurs, couches, F }) {
  const classes = [...new Set(couches.map((c) => c.cls))].sort((a, b) => RANG(a) - RANG(b));
  const regles = [...classes.filter((k) => k !== "st1").sort((a, b) => RANG(a) - RANG(b)).map((k) => `\t.${k}{fill:${couleurs[k]};}`)];
  // st0, st1, st2… dans l'ordre des numéros, comme les originaux
  const style = [...classes].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2))).map((k) => (k === "st1" ? "\t.st1{opacity:0.15;}" : regles.find((r) => r.startsWith(`\t.${k}{`)))).join("\n");
  const ordre = couches.map((c, i) => ({ c, i })).sort((a, b) => RANG(a.c.cls) - RANG(b.c.cls) || a.i - b.i).map((x) => x.c);
  return `<!-- ${MARQUE}, generee par garde-robe/coiffures/gen.mjs : ${sansAccent(nomLisible)} -->
<svg version="1.1" id="${idSvg}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" width="500px" height="1000px" viewBox="0 0 500 1000" style="enable-background:new 0 0 500 1000;" xml:space="preserve">
<style type="text/css">
${style}
</style>
<g id="${idGroupe}">
${ordre.map((c) => `\t<path class="${c.cls}" d="${chemin(c.segs, F)}"/>`).join("\n")}
</g>
</svg>
`;
}

// ---------------------------------------------------------------------------------------------
// Rendu et contrôles (sharp)
// ---------------------------------------------------------------------------------------------
const W = 500, H = 1000;
async function raster(svg) {
  const { data } = await sharp(Buffer.from(svg), { density: 72 }).resize(W, H, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return data;
}
const alpha = (data, seuil = 128) => { const m = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) m[i] = data[i * 4 + 3] >= seuil ? 1 : 0; return m; };
/** Variante d'un SVG de pièce où seules certaines classes sont peintes, en noir opaque. */
function masqueSvg(svg, garder) {
  const corps = [...svg.matchAll(/<path class="(st\d+)" d="([^"]*)"\/>/g)].filter((m) => garder(m[1])).map((m) => `<path fill="#000" d="${m[2]}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="1000" viewBox="0 0 500 1000">${corps}</svg>`;
}
/** Distance (chanfrein 3-4, en px) de chaque pixel au masque. */
function distance(masque) {
  const INF = 1e9, d = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) d[i] = masque[i] ? 0 : INF;
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
  for (let i = 0; i < W * H; i++) d[i] /= 3;
  return d;
}

const corpsCache = new Map();
async function corps(ref) {
  if (corpsCache.has(ref)) return corpsCache.get(ref);
  const svg = readFileSync(`${REF}/${ref}`, "utf8");
  const png = await sharp(Buffer.from(svg), { density: 72 }).resize(W, H, { fit: "fill" }).png().toBuffer();
  const m = alpha(await raster(svg));
  const lignes = [];
  for (let y = 0; y < H; y++) { let g = -1, d = -1; for (let x = 0; x < W; x++) if (m[y * W + x]) { if (g < 0) g = x; d = x; } lignes.push(g < 0 ? null : [g, d]); }
  const c = { svg, png, m, dist: distance(m), lignes };
  corpsCache.set(ref, c);
  return c;
}

async function controler(svg, F, piece) {
  const sol = alpha(await raster(masqueSvg(svg, (k) => k !== "st1")), 128);
  const solLarge = alpha(await raster(masqueSvg(svg, (k) => k !== "st1")), 8);
  const omb = alpha(await raster(masqueSvg(svg, (k) => k === "st1")), 128);
  let ombreHors = 0;
  for (let i = 0; i < W * H; i++) if (omb[i] && !solLarge[i]) ombreHors++;
  // emprise de la pièce
  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (solLarge[y * W + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const res = {};
  const yCrane = Math.floor(F.top), yBas = Math.ceil(F.top + 26 * F.s);
  for (const g of F.gabarits) {
    const B = await corps(g.ref);
    let peau = 0, debord = 0, mains = 0, ou = null;
    if (!piece.nu) for (let y = yCrane; y <= yBas; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (B.m[i] && !sol[i]) peau++; }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!sol[i]) continue;
      if (!B.m[i] && B.dist[i] > debord) { debord = B.dist[i]; ou = [x, y]; }
      if (y >= F.aisselle && B.lignes[y]) { const [xl, xr] = B.lignes[y]; if (B.m[i] && (x < xl + 55 || x > xr - 55)) mains++; }
    }
    res[g.nom] = { peau_visible_px: peau, debord_max_px: Math.round(debord), mains_couvertes_px: mains };
    Object.defineProperty(res[g.nom], "ou", { value: ou, enumerable: false });
  }
  // part de chaque zone (pour la vérification des rangées)
  const parts = {};
  const classes = [...new Set([...svg.matchAll(/<path class="(st\d+)"/g)].map((m) => m[1]))].filter((k) => k !== "st1");
  let tot = 0;
  for (const k of classes) { const m = alpha(await raster(masqueSvg(svg, (c) => c === k)), 128); let n = 0; for (let i = 0; i < W * H; i++) n += m[i]; parts[k] = n; tot += n; }
  for (const k of classes) parts[k] = Math.round((parts[k] / tot) * 1000) / 1000;
  return { res, ombreHors, emprise: { x: [x0, x1 + 1], y: [y0, y1 + 1] }, parts };
}

// ---------------------------------------------------------------------------------------------
// Génération
// ---------------------------------------------------------------------------------------------
const pieces = [];
const problemes = [];
let position = 1000;
for (const [fam, liste] of Object.entries(CATALOGUE)) {
  const F = FAMILLES[fam];
  for (const [id, nom, build, st0, opt = {}] of liste) {
    const { couches, marge, viol } = construire(build, F, opt.vol);
    const classes = new Set(couches.map((c) => c.cls));
    const couleurs = { st0 };
    const zones = { st0: { couleur: st0, groupe: "Cheveux", role: "principale" } };
    if (classes.has("st2")) {
      if (!opt.st2) throw new Error(`${fam}/${id} : st2 sans couleur`);
      couleurs.st2 = opt.st2.couleur;
      zones.st2 = { couleur: opt.st2.couleur, groupe: opt.st2.groupe, role: "partie" };
    }
    if (classes.has("st3")) {
      couleurs.st3 = nuanceDe(st0, 0.14);
      zones.st3 = { couleur: couleurs.st3, groupe: "Cheveux", role: "nuance", de: "st0" };
    }
    // cohérence des rôles avec la lecture du moteur (familles de teinte)
    const L = (h) => tsl(hexRgb(h))[2];
    if (zones.st3) {
      const ok = memeFamille(couleurs.st3, st0) && L(st0) - L(couleurs.st3) >= 0.099 && L(st0) - L(couleurs.st3) <= 0.201;
      if (!ok) problemes.push(`${fam}/${id} : la nuance ${couleurs.st3} ne suivrait pas ${st0}`);
    }
    if (zones.st2 && memeFamille(couleurs.st2, st0) && Math.abs(L(couleurs.st2) - L(st0)) <= 0.22) problemes.push(`${fam}/${id} : ${zones.st2.groupe} ${couleurs.st2} serait lue comme une ombre des cheveux ${st0}`);

    const volumineuse = !!opt.vol;
    if (!volumineuse && viol > 0.3) problemes.push(`${fam}/${id} : sort du contrat de volume de ${viol.toFixed(1)} (non marquée volumineuse)`);
    const fichier = `gabarit-piece-coiffures-${fam}-${id}.svg`;
    const idGroupe = `${F.prefixe}_Hair_${position}`;
    const svg = svgDe({ fichier, nomLisible: nom, idSvg: `Gabarit_Piece_Coiffures_${snake(fam)}_${snake(id)}`, idGroupe, couleurs, couches, F });
    writeFileSync(`${SORTIE}/${fichier}`, svg);
    pieces.push({ fam, id, nom, F, opt, svg, fichier, idGroupe, position, couleurs, zones, volumineuse, marge, viol });
    position++;
  }
}

// format (§3, §4) : contrôle textuel
function formatOk(svg, zones) {
  const err = [];
  const lignes = svg.split("\n");
  if (!lignes[0].startsWith(`<!-- ${MARQUE}`)) err.push("marque absente");
  if ((svg.match(/<style/g) || []).length !== 1) err.push("plusieurs <style>");
  if (/\sfill=|stroke|transform|<defs|Gradient|clipPath|<mask|<use|<image|<text|\sstyle="(?!enable-background)|\sopacity=/.test(svg.replace(/<path fill="#000"/g, ""))) err.push("attribut interdit");
  const style = svg.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
  const regles = style.trim().split("\n").map((l) => l.trim());
  for (const r of regles) if (!/^\.st1\{opacity:0\.15;\}$/.test(r) && !/^\.st\d+\{fill:#[0-9A-F]{6};\}$/.test(r)) err.push(`règle ${r}`);
  const declarees = new Set(regles.map((r) => r.match(/^\.(st\d+)/)[1]));
  const utilisees = new Set([...svg.matchAll(/class="(st\d+)"/g)].map((m) => m[1]));
  for (const k of declarees) if (!utilisees.has(k)) err.push(`${k} déclarée non utilisée`);
  for (const k of utilisees) if (!declarees.has(k)) err.push(`${k} utilisée non déclarée`);
  if (!utilisees.has("st1")) err.push("pas d'ombre st1");
  const extraites = {};
  for (const m of svg.matchAll(/\.(st\d+)\s*\{\s*fill\s*:\s*(#[0-9a-fA-F]{3,8})/g)) extraites[m[1]] = m[2].toUpperCase();
  if (JSON.stringify(Object.keys(extraites).sort()) !== JSON.stringify(Object.keys(zones).sort())) err.push(`zones ${Object.keys(extraites)} ≠ index`);
  if (Object.keys(zones).length > 4) err.push("plus de 4 zones");
  const classesG = [...svg.matchAll(/<path class="(st\d+)"/g)].map((m) => m[1]);
  const premierOmbre = classesG.indexOf("st1");
  if (classesG.slice(premierOmbre).some((k) => k !== "st1")) err.push("ombres pas en dernier");
  return err;
}

const index = [];
const partsDesPieces = {};
for (const p of pieces) {
  const { res, ombreHors, emprise, parts } = await controler(p.svg, p.F, p.opt);
  partsDesPieces[p.fichier] = parts;
  const err = formatOk(p.svg, p.zones);
  for (const e of err) problemes.push(`${p.fam}/${p.id} : format, ${e}`);
  if (ombreHors > 30) problemes.push(`${p.fam}/${p.id} : ${ombreHors} px d'ombre hors des cheveux`);
  const echecs = [];
  for (const [g, r] of Object.entries(res)) {
    if (r.peau_visible_px > 30) echecs.push(`${g} peau ${r.peau_visible_px}`);
    if (!p.opt.vol && !p.opt.pend && r.debord_max_px > 40) echecs.push(`${g} débord ${r.debord_max_px} en ${r.ou}`);
    if (r.mains_couvertes_px > 0) echecs.push(`${g} bras ${r.mains_couvertes_px}`);
  }
  if (echecs.length) problemes.push(`${p.fam}/${p.id} : ${echecs.join(", ")}`);
  p.ok = !err.length && !echecs.length && ombreHors <= 30;
  const notes = [];
  if (p.opt.nu) notes.push("crâne nu = peau du gabarit, dispensée de la zone à couvrir");
  if (p.opt.pend) notes.push("pend hors silhouette, débord non limité");
  if (!p.volumineuse && p.marge > 2) notes.push(`dessus resserré pour le contrat de volume (marge ${p.marge})`);
  if (p.volumineuse) notes.push("sort du volume des couvre-chefs : à ne pas proposer sous un chapeau");
  index.push({
    fichier: p.fichier,
    url: `/assets/${p.fichier}`,
    familles: [p.fam],
    gabarits: p.F.gabarits.map((g) => g.nom),
    slot: "hair",
    view: "back",
    nom: p.nom,
    id_groupe: p.idGroupe,
    position_proposee: p.position,
    nuancier: "cheveux",
    zones: p.zones,
    ombre: "st1",
    emprise,
    controle: res,
    volumineuse: p.volumineuse,
    notes: notes.join(" ; "),
  });
}
writeFileSync(`${ICI}/index.json`, JSON.stringify({ categorie: "coiffures", date: "2026-11-27", generateur: "garde-robe/coiffures/gen.mjs", pieces: index }, null, 1));
writeFileSync(`${ICI}/parts.json`, JSON.stringify(partsDesPieces, null, 1));

// ---------------------------------------------------------------------------------------------
// Planches
// ---------------------------------------------------------------------------------------------
const FOND = { r: 247, g: 246, b: 241, alpha: 1 };
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
async function png(svg) { return sharp(Buffer.from(svg), { density: 72 }).resize(W, H, { fit: "fill" }).png().toBuffer(); }
function recolore(svg, zones, st0) {
  let out = svg.replace(/\.st0\{fill:#[0-9A-F]{6};\}/, `.st0{fill:${st0};}`);
  if (zones.st3) out = out.replace(/\.st3\{fill:#[0-9A-F]{6};\}/, `.st3{fill:${nuanceSuivante(zones.st3.couleur, zones.st0.couleur, st0)};}`);
  return out;
}
function deuxTeintes(st0) {
  const cand = [C.blond, C.noir, C.roux, C.gris, C.chatain, C.blanc];
  const l0 = tsl(hexRgb(st0))[2];
  return cand.filter((c) => c !== st0 && Math.abs(tsl(hexRgb(c))[2] - l0) > 0.12).slice(0, 2);
}
async function cellule(fondPng, piecePng, F, ech = 0.5) {
  const x = Math.round(F.cx - 170), y = Math.round(F.top - 60);
  const base = sharp({ create: { width: W, height: H, channels: 4, background: FOND } });
  const calques = [];
  if (fondPng) calques.push({ input: fondPng });
  if (piecePng) calques.push({ input: piecePng });
  const plein = await base.composite(calques).png().toBuffer();
  return sharp(plein).extract({ left: x, top: y, width: 340, height: 420 }).resize(Math.round(340 * ech), Math.round(420 * ech)).png().toBuffer();
}
function texte(t, w, h, taille = 13) {
  const lignes = t.split("\n");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${lignes.map((l, i) => `<text x="6" y="${16 + i * (taille + 3)}" font-family="League Spartan" font-size="${taille}" fill="#333">${esc(l)}</text>`).join("")}</svg>`);
}
const CW = 170, CH = 210, LW = 170, HH = 26;
for (const [fam, F] of Object.entries(FAMILLES)) {
  const ps = pieces.filter((p) => p.fam === fam);
  const cols = [...F.gabarits.map((g) => g.nom.replace("gabarit-dos-", "").replace(".svg", "")), "pièce seule", "teinte 2", "teinte 3"];
  const largeur = LW + cols.length * CW, hauteur = HH + ps.length * CH;
  const calques = [];
  cols.forEach((c, i) => calques.push({ input: texte(c, CW, HH), left: LW + i * CW, top: 0 }));
  for (const [r, p] of ps.entries()) {
    const y = HH + r * CH;
    calques.push({ input: texte(`${p.position}\n${p.id}${p.volumineuse ? "\n(volumineuse)" : ""}${p.ok ? "" : "\nA REVOIR"}`, LW, CH), left: 0, top: y });
    const piecePng = await png(p.svg);
    for (const [i, g] of F.gabarits.entries()) calques.push({ input: await cellule((await corps(g.ref)).png, piecePng, F), left: LW + i * CW, top: y });
    calques.push({ input: await cellule(null, piecePng, F), left: LW + F.gabarits.length * CW, top: y });
    const std = (await corps(F.gabarits[0].ref)).png;
    for (const [k, t] of deuxTeintes(p.zones.st0.couleur).entries()) calques.push({ input: await cellule(std, await png(recolore(p.svg, p.zones, t)), F), left: LW + (F.gabarits.length + 1 + k) * CW, top: y });
  }
  await sharp({ create: { width: largeur, height: hauteur, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).composite(calques).flatten({ background: "#ffffff" }).jpeg({ quality: 82 }).toFile(`${ICI}/planche-${fam}.jpg`);
}
// vue d'ensemble : chaque coupe sur le corps standard de sa famille
{
  const NC = 10, cw = 136, ch = 186;
  const calques = [];
  for (const [k, p] of pieces.entries()) {
    const x = (k % NC) * cw, y = Math.floor(k / NC) * (ch + 18);
    calques.push({ input: await cellule((await corps(p.F.gabarits[0].ref)).png, await png(p.svg), p.F, 0.4), left: x, top: y });
    calques.push({ input: texte(`${p.fam} ${p.id}`, cw, 18, 10), left: x, top: y + ch - 18 + 18 - 14 });
  }
  const lignes = Math.ceil(pieces.length / NC);
  await sharp({ create: { width: NC * cw, height: lignes * (ch + 18), channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).composite(calques).flatten({ background: "#ffffff" }).jpeg({ quality: 82 }).toFile(`${ICI}/planche.jpg`);
}

// ---------------------------------------------------------------------------------------------
// Publication LOCALE (copie dans /app/data/assets), pièce par pièce, seulement si elle passe
// ---------------------------------------------------------------------------------------------
if (PUBLIER) {
  let n = 0;
  for (const p of pieces) {
    if (!p.ok) { problemes.push(`${p.fichier} : non publiée (contrôle en échec)`); continue; }
    const cible = `${ASSETS}/${p.fichier}`;
    if (existsSync(cible) && !readFileSync(cible, "utf8").split("\n")[0].includes(MARQUE)) { console.error(`ARRÊT : ${cible} existe sans la marque`); process.exit(2); }
    writeFileSync(cible, p.svg);
    n++;
  }
  console.log(`${n} fichiers copiés dans ${ASSETS}`);
}

const parFamille = Object.fromEntries(Object.keys(CATALOGUE).map((f) => [f, pieces.filter((p) => p.fam === f).length]));
console.log(`${pieces.length} coiffures`, JSON.stringify(parFamille));
console.log(problemes.length ? `PROBLÈMES (${problemes.length}) :\n- ${problemes.join("\n- ")}` : "aucun problème");
