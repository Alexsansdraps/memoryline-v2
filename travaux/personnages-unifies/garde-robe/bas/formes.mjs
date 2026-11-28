// Outils de dessin des bas : courbes, repère u,v dans la silhouette, découpes, écriture des tracés.
import { bandeAutour } from "./geom.mjs";

/** Catmull-Rom (centripète simple) échantillonnée : renvoie une polyligne passant par les points. */
export function courbe(pts, n = 12) {
  if (pts.length < 3) return densifierLigne(pts, n);
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  const out = [];
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
function densifierLigne(pts, n) {
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) for (let k = 0; k < n; k++) out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k / n, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k / n]);
  out.push(pts[pts.length - 1]);
  return out;
}
/** Courbe fermée (Catmull-Rom bouclée). */
export function courbeFermee(pts, n = 12) {
  const N = pts.length, out = [];
  for (let i = 0; i < N; i++) {
    const [p0, p1, p2, p3] = [pts[(i - 1 + N) % N], pts[i], pts[(i + 1) % N], pts[(i + 2) % N]];
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  return out;
}

/** Fonction v → u lue sur une courbe donnée par points (u,v) à v croissant. */
export function fonctionDeV(pts) {
  const c = courbe(pts, 16);
  return (v) => {
    if (v <= c[0][1]) return c[0][0];
    for (let i = 0; i + 1 < c.length; i++) if (v <= c[i + 1][1]) { const t = (v - c[i][1]) / (c[i + 1][1] - c[i][1] || 1); return c[i][0] + t * (c[i + 1][0] - c[i][0]); }
    return c[c.length - 1][0];
  };
}

/**
 * Repères d'une silhouette de bas. sil = { haut, bas, L[], R[], Lf[], Rf[] }, un rang par pixel (y + 0,5).
 * Mt : u entre les bords VRAIS. Mf : u dans le cadre lissé, toujours à l'intérieur.
 */
export function reperes(sil) {
  const H = sil.bas - sil.haut;
  const lire = (arr, y) => {
    const f = Math.min(arr.length - 1, Math.max(0, y - sil.haut - 0.5));
    const k = Math.min(arr.length - 2, Math.floor(f)), r = f - k;
    return arr[k] + (arr[k + 1] - arr[k]) * r;
  };
  const yv = (v) => sil.haut + v * H;
  const Mt = (u, v) => { const y = yv(v); const l = lire(sil.L, y), r = lire(sil.R, y); return [l + u * (r - l), y]; };
  const Mf = (u, v) => { const y = yv(v); const l = lire(sil.Lf, y), r = lire(sil.Rf, y); return [l + u * (r - l), y]; };
  const vpx = (px) => px / H;
  const vDeY = (y) => (y - sil.haut) / H;
  return { Mt, Mf, vpx, vDeY, yv, H, lire };
}

/** Polygone uv → pixels (densifié pour suivre les bords courbes). */
export function versPx(uv, M, pas = 0.01) {
  const out = [];
  for (let i = 0; i < uv.length; i++) {
    const a = uv[i], b = uv[(i + 1) % uv.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / pas));
    for (let k = 0; k < n; k++) out.push(M(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n));
  }
  return out;
}

/** Bande d'un bord à l'autre (Mt) entre v0 et v1 ; bombe > 0 : le milieu descend. */
export function bandeH(R, v0, v1, bombe = 0, u0 = 0, u1 = 1) {
  const N = 80, haut = [], bas = [];
  for (let k = 0; k <= N; k++) {
    const u = u0 + (u1 - u0) * k / N, b = bombe * 4 * u * (1 - u);
    haut.push(R.Mt(u, v0 + b)); bas.push(R.Mt(u, v1 + b));
  }
  // côtés échantillonnés au pixel : le bord vrai n'est pas droit (haut de la main des hommes)
  const nc = Math.max(1, Math.ceil((v1 - v0) * R.H * 2)), cd = [], cg = [];
  for (let k = 1; k < nc; k++) { const v = v0 + (v1 - v0) * k / nc; cd.push(R.Mt(u1, v)); cg.push(R.Mt(u0, v)); }
  return [...haut, ...cd, ...bas.reverse(), ...cg.reverse()];
}

/** Zone comprise entre le bord vrai (gauche ou droit) et une courbe intérieure u = f(v) du cadre. */
export function bord(R, cote, v0, v1, f) {
  const N = Math.max(8, Math.ceil((v1 - v0) * R.H * 1.5)), int = [], ext = [];
  for (let k = 0; k <= N; k++) {
    const v = v0 + (v1 - v0) * k / N;
    int.push(R.Mf(f(v), v)); ext.push(R.Mt(cote === "g" ? 0 : 1, v));
  }
  return [...int, ...ext.reverse()];
}

/** Bande collée au bord vrai, de largeur w(v) px mesurée à l'horizontale (revers, bandes, poches de côté). */
export function bordDecale(R, cote, v0, v1, w, retrait = () => 0) {
  const N = Math.max(8, Math.ceil((v1 - v0) * R.H * 1.5)), int = [], ext = [];
  const sg = cote === "g" ? 1 : -1;
  for (let k = 0; k <= N; k++) {
    const v = v0 + (v1 - v0) * k / N, [x, y] = R.Mt(cote === "g" ? 0 : 1, v);
    ext.push([x + sg * retrait(v), y]); int.push([x + sg * (retrait(v) + w(v)), y]);
  }
  return [...int, ...ext.reverse()];
}

/** Trait d'épaisseur w (px) le long d'une polyligne uv. */
export function trait(R, uv, w, M = R.Mf) {
  return bandeAutour(uv.map(([u, v]) => M(u, v)), w);
}

/** Ne garde que la partie d'un polygone située à gauche de la courbe x = xs(y) (Sutherland-Hodgman cisaillé). */
export function gaucheDe(poly, xs) {
  const t = poly.map(([x, y]) => [x - xs(y), y]);
  const out = [];
  for (let j = 0; j < t.length; j++) {
    const a = t[j], b = t[(j + 1) % t.length];
    const ia = a[0] <= 0, ib = b[0] <= 0;
    const inter = () => { const s = a[0] / (a[0] - b[0]); return [0, a[1] + s * (b[1] - a[1])]; };
    if (ia && ib) out.push(b);
    else if (ia && !ib) out.push(inter());
    else if (!ia && ib) { out.push(inter()); out.push(b); }
  }
  return out.length > 2 ? out.map(([x, y]) => [x + xs(y), y]) : null;
}

/** Miroir u → 1 - u d'un polygone uv. */
export const miroir = (uv) => uv.map(([u, v]) => [1 - u, v]).reverse();

/** Rectangle uv. */
export const rect = (u0, v0, u1, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];

const f1 = (v) => { const r = Math.round(v * 10) / 10; return (Object.is(r, -0) ? 0 : r).toString(); };
function simplifier(pts, tol) {
  if (pts.length < 3) return pts;
  const garde = new Array(pts.length).fill(false);
  garde[0] = garde[pts.length - 1] = true;
  const pile = [[0, pts.length - 1]];
  while (pile.length) {
    const [a, b] = pile.pop();
    let dmax = 0, idx = -1;
    const [x1, y1] = pts[a], [x2, y2] = pts[b];
    const L = Math.hypot(x2 - x1, y2 - y1) || 1e-9;
    for (let k = a + 1; k < b; k++) {
      const d = Math.abs((x2 - x1) * (y1 - pts[k][1]) - (x1 - pts[k][0]) * (y2 - y1)) / L;
      if (d > dmax) { dmax = d; idx = k; }
    }
    if (dmax > tol) { garde[idx] = true; pile.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, k) => garde[k]);
}
/** Écrit des polygones fermés en attribut d (M L Z, absolu, 1 décimale). */
export function versD(polys, tol = 0.25) {
  let d = "";
  for (const pts of polys) {
    if (!pts || pts.length < 3) continue;
    // contour fermé : on simplifie les deux moitiés séparément (extrémités confondues sinon)
    const m = Math.floor(pts.length / 2);
    const p = [...simplifier(pts.slice(0, m + 1), tol).slice(0, -1), ...simplifier([...pts.slice(m), pts[0]], tol)];
    const q = [];
    for (const [x, y] of p.slice(0, -1)) { const s = f1(x) + "," + f1(y); if (!q.length || q[q.length - 1] !== s) q.push(s); }
    if (q.length < 3) continue;
    d += "M" + q[0] + q.slice(1).map((s) => "L" + s).join("") + "Z";
  }
  return d;
}
