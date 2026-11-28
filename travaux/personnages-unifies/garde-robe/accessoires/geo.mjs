// Outils de forme des accessoires (27/11). Repris de coiffures/gen-coiffures.mjs (sym, Catmull-Rom
// vers Bézier, festons, ombre, mèche, ellipse) et de bas/geom.mjs (bandeAutour), copiés ici sans
// toucher aux originaux. Les points sont des { u, v } : dans le repère tête pour les pièces de tête,
// directement en pixels du cadre 500 × 1000 pour les autres (u = x, v = y).

export const P = (u, v, c = false) => ({ u, v, c });

// graine fixe : mêmes fichiers à chaque génération
export function alea(graine) {
  let s = graine >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Moitié droite (du sommet au bas, u ≥ 0) → contour fermé symétrique. */
export function sym(droite) {
  const d = droite.map((p) => ({ ...p }));
  const g = droite.slice().reverse().filter((p) => Math.abs(p.u) > 1e-6).map((p) => ({ ...p, u: -p.u }));
  const tout = [...d, ...g.filter((p, i) => !(i === 0 && Math.abs(droite[droite.length - 1].u) < 1e-6))];
  return tout.filter((p, i) => i === 0 || !(Math.abs(p.u - tout[0].u) < 1e-6 && Math.abs(p.v - tout[0].v) < 1e-6));
}

/** Courbe lisse (Catmull-Rom → Bézier) ; `c` = point anguleux. */
export function segments(pts, ferme = true, tension = 1) {
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

export function forme(pts, tension = 1) { return { pts, segs: segments(pts, true, tension) }; }
/** Polygone à côtés droits (tous les points anguleux). */
export function poly(pts) { return forme(pts.map(([u, v]) => P(u, v, true))); }

export function bezAt(s, t) {
  const a = (1 - t) ** 3, b = 3 * t * (1 - t) ** 2, c = 3 * t * t * (1 - t), d = t ** 3;
  return { u: a * s.p0.u + b * s.c1.u + c * s.c2.u + d * s.p3.u, v: a * s.p0.v + b * s.c1.v + c * s.c2.v + d * s.p3.v };
}
export function echantillons(segs, k = 24) {
  const out = [];
  for (const s of segs) if (s) for (let i = 0; i < k; i++) out.push(bezAt(s, i / k));
  return out;
}
export function aire(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.u * q.v - q.u * p.v; } return a / 2; }

/** Contour festonné : N bosses régulières le long d'un contour de base (franges, fleurs, pompons). */
export function festons(base, n, haut, creux = 0.35) {
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
    const o = bosse ? haut : -haut * creux;
    pts.push(P(q.u + q.nu * o, q.v + q.nv * o, !bosse));
  }
  return pts;
}

/** Ombre : l'arc du contour entre les ancres les plus proches de A et B, refermé par une courbe intérieure. */
export function ombre(f, A, B, interieur) {
  const n = f.pts.length;
  const proche = (q) => { let bi = 0, bd = 1e9; f.pts.forEach((p, i) => { const d = Math.hypot(p.u - q[0], p.v - q[1]); if (d < bd) { bd = d; bi = i; } }); return bi; };
  const i = proche(A), j = proche(B);
  const arc = [];
  for (let k = i; k !== j; k = (k + 1) % n) arc.push(f.segs[k]);
  const ret = segments([f.pts[j], ...interieur.map(([u, v, c]) => P(u, v, c)), f.pts[i]].map((p, k, a) => (k === 0 || k === a.length - 1 ? { ...p, c: false } : p)), false);
  return [...arc, ...ret];
}

/** Fuseau pointu aux deux bouts (mèche, pli, ruban), par une ligne médiane et une épaisseur. */
export function meche(ligne, ep) {
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

export function ellipse(cu, cv, ru, rv, n = 12, rot = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * ru, y = Math.sin(a) * rv;
    pts.push(P(cu + x * Math.cos(rot) - y * Math.sin(rot), cv + x * Math.sin(rot) + y * Math.cos(rot)));
  }
  return forme(pts);
}
export function inverse(segs) { return segs.slice().reverse().map((s) => ({ p0: s.p3, c1: s.c2, c2: s.c1, p3: s.p0 })); }

/** Bande d'épaisseur w autour d'une ligne (sangles, rubans, branches, cordons), bouts arrondis si `rond`. */
export function bande(ligne, w, { rond = true } = {}) {
  // ligne lissée d'abord (Catmull-Rom), puis épaissie
  const pts = ligne.map(([u, v]) => P(u, v));
  const dense = [];
  const segs = segments(pts, false);
  for (const s of segs) for (let i = 0; i < 10; i++) dense.push(bezAt(s, i / 10));
  dense.push(pts[pts.length - 1]);
  const g = [], d = [];
  for (let k = 0; k < dense.length; k++) {
    const a = dense[Math.max(0, k - 1)], b = dense[Math.min(dense.length - 1, k + 1)];
    let nu = -(b.v - a.v), nv = b.u - a.u; const l = Math.hypot(nu, nv) || 1; nu /= l; nv /= l;
    g.push(P(dense[k].u + nu * w / 2, dense[k].v + nv * w / 2, true));
    d.push(P(dense[k].u - nu * w / 2, dense[k].v - nv * w / 2, true));
  }
  // demi-cercle de p à q autour du centre, du côté de `dehors` (direction de la ligne au bout)
  const bout = (p, centre, dehors) => {
    if (!rond) return [];
    const a0 = Math.atan2(p.v - centre.v, p.u - centre.u);
    const mid = (s) => a0 + (s * Math.PI) / 2;
    const s = Math.cos(mid(1)) * dehors.u + Math.sin(mid(1)) * dehors.v > 0 ? 1 : -1;
    const out = [];
    for (let k = 1; k < 6; k++) { const a = a0 + (s * Math.PI * k) / 6; out.push(P(centre.u + Math.cos(a) * w / 2, centre.v + Math.sin(a) * w / 2, true)); }
    return out;
  };
  const n = dense.length;
  const fin = dense[n - 1], deb = dense[0];
  const dFin = { u: fin.u - dense[n - 2].u, v: fin.v - dense[n - 2].v }, dDeb = { u: deb.u - dense[1].u, v: deb.v - dense[1].v };
  const capFin = bout(g[n - 1], fin, dFin), capDeb = bout(d[0], deb, dDeb);
  const contour = [...g, ...capFin, ...d.slice().reverse(), ...capDeb];
  return forme(contour);
}

/** Croissant d'ombre en bas à droite d'un disque (perles, grelots, pompons). */
export function croissant(cu, cv, r) {
  const f = ellipse(cu, cv, r, r, 12);
  return ombre(f, [cu + r * 0.75, cv - r * 0.66], [cu - r * 0.75, cv + r * 0.66], [[cu + r * 0.2, cv + r * 0.2]]);
}

/** Translation + mise à l'échelle uniforme d'une liste de segments (repère tête → cadre). */
export function transforme(segs, fn) {
  const m = (p) => { const [u, v] = fn(p.u, p.v); return { u, v }; };
  return segs.map((s) => (s === null ? null : { p0: m(s.p0), c1: m(s.c1), c2: m(s.c2), p3: m(s.p3) }));
}

// ---------------------------------------------------------------------------------------------
// Couleurs : nuance = même teinte, plus sombre en clarté TSL
// ---------------------------------------------------------------------------------------------
export function hexVersTsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}
export function tslVersHex({ h, s, l }) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return "#" + [f(0), f(8), f(4)].map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}
// Une couleur « vive » pour le moteur : écart entre canaux d'au moins 8 % (couleurVive de couleurs-groupes.ts).
// Une nuance sombre d'une couleur peu saturée peut perdre ce statut et ne plus suivre sa référence :
// on remonte alors la saturation (même teinte, même clarté) jusqu'à le retrouver.
export function vive(hex, seuil = 0.08) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255 >= seuil;
}
export function nuance(hex, dl = 0.14) {
  const t = hexVersTsl(hex), l = Math.max(0, t.l - dl);
  let s = t.s, out = tslVersHex({ h: t.h, s, l });
  if (vive(hex)) while (!vive(out, 0.085) && s < 1) { s = Math.min(1, s + 0.02); out = tslVersHex({ h: t.h, s, l }); }
  return out;
}
