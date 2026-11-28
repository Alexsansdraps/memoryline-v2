// Découpes et tracés pour les hauts sur gabarits (27/11).
// Une découpe se fait par un demi-plan après changement de repère : y' = y − g(x)
// (bande qui suit une courbe : ourlet, col, rayure) ou x' = x − h(y) (côté d'une
// courbe verticale : grande ombre du dos, bord de manche). Le polygone est d'abord
// densifié pour que le changement de repère reste fidèle.

const f1 = (v) => {
  const r = Math.round(v * 10) / 10;
  return (Object.is(r, -0) ? 0 : r).toString();
};

/** Densifie un polygone fermé (pas en pixels). */
export function densifier(poly, pas = 1.5) {
  const out = [];
  for (let j = 0; j < poly.length; j++) {
    const a = poly[j], b = poly[(j + 1) % poly.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.ceil(l / pas));
    for (let s = 0; s < k; s++) out.push([a[0] + (b[0] - a[0]) * s / k, a[1] + (b[1] - a[1]) * s / k]);
  }
  return out;
}

/** Sutherland–Hodgman sur un demi-plan « garde(p) » avec point d'intersection « coupe(a,b) ». */
function demiPlan(poly, garde, coupe) {
  const out = [];
  for (let j = 0; j < poly.length; j++) {
    const a = poly[j], b = poly[(j + 1) % poly.length];
    const ia = garde(a), ib = garde(b);
    if (ia && ib) out.push(b);
    else if (ia && !ib) out.push(coupe(a, b));
    else if (!ia && ib) { out.push(coupe(a, b)); out.push(b); }
  }
  return out;
}

const coupeY = (v) => (a, b) => { const t = (v - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), v]; };
const coupeX = (v) => (a, b) => { const t = (v - a[0]) / (b[0] - a[0]); return [v, a[1] + t * (b[1] - a[1])]; };

/** Garde la partie du polygone où a ≤ y − g(x) ≤ b. */
export function bandeY(poly, a, b, g = () => 0) {
  let p = densifier(poly).map(([x, y]) => [x, y - g(x)]);
  if (a != null) p = demiPlan(p, (q) => q[1] >= a, coupeY(a));
  if (b != null && p.length) p = demiPlan(p, (q) => q[1] <= b, coupeY(b));
  // on redensifie avant de revenir au repère d'origine : les bords de découpe épousent la courbe
  return p.length > 2 ? densifier(p).map(([x, y]) => [x, y + g(x)]) : null;
}

/** Garde la partie du polygone où a ≤ x − h(y) ≤ b. */
export function bandeX(poly, a, b, h = () => 0) {
  let p = densifier(poly).map(([x, y]) => [x - h(y), y]);
  if (a != null) p = demiPlan(p, (q) => q[0] >= a, coupeX(a));
  if (b != null && p.length) p = demiPlan(p, (q) => q[0] <= b, coupeX(b));
  return p.length > 2 ? densifier(p).map(([x, y]) => [x + h(y), y]) : null;
}

/** Simplification de Douglas–Peucker. */
function simplifier(pts, tol) {
  if (pts.length < 3) return pts;
  const garde = new Array(pts.length).fill(false);
  garde[0] = garde[pts.length - 1] = true;
  const pile = [[0, pts.length - 1]];
  while (pile.length) {
    const [a, b] = pile.pop();
    let dmax = 0, idx = -1;
    const [x1, y1] = pts[a], [x2, y2] = pts[b];
    const L = Math.hypot(x2 - x1, y2 - y1);
    for (let k = a + 1; k < b; k++) {
      // extrémités confondues (polygone fermé) : distance au point
      const d = L < 1e-6 ? Math.hypot(pts[k][0] - x1, pts[k][1] - y1) : Math.abs((x2 - x1) * (y1 - pts[k][1]) - (x1 - pts[k][0]) * (y2 - y1)) / L;
      if (d > dmax) { dmax = d; idx = k; }
    }
    if (dmax > tol) { garde[idx] = true; pile.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, k) => garde[k]);
}

/** Aire signée (pour retourner un trou). */
export const aire = (p) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;

/** Polygones → attribut d (M L Z, une décimale). Les sous-chemins nuls sont ignorés. */
export function versD(polys, tol = 0.3) {
  let d = "";
  for (const poly of polys) {
    if (!poly || poly.length < 3 || Math.abs(aire(poly)) < 0.5) continue;
    const p = simplifier([...poly, poly[0]], tol);
    p.pop();
    if (p.length < 3) continue;
    d += "M" + f1(p[0][0]) + "," + f1(p[0][1]);
    for (let k = 1; k < p.length; k++) d += "L" + f1(p[k][0]) + "," + f1(p[k][1]);
    d += "Z";
  }
  return d;
}

/** Courbe de Catmull-Rom échantillonnée (passe par les points). */
export function catmull(pts, n = 8, ferme = false) {
  const out = [];
  const N = pts.length;
  const P = (i) => ferme ? pts[(i + N) % N] : pts[Math.max(0, Math.min(N - 1, i))];
  const fin = ferme ? N : N - 1;
  for (let i = 0; i < fin; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((c) => 0.5 * ((2 * p1[c]) + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3)));
    }
  }
  if (!ferme) out.push(pts[N - 1]);
  return out;
}

/** Ellipse en polygone. */
export function ellipse(cx, cy, rx, ry, n = 28, rot = 0) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return Array.from({ length: n }, (_, k) => { const a = 2 * Math.PI * k / n; const x = rx * Math.cos(a), y = ry * Math.sin(a); return [cx + x * c - y * s, cy + x * s + y * c]; });
}

/** Rectangle arrondi (pour les chiffres du maillot). */
export function rectArrondi(x0, y0, x1, y1, r, n = 5) {
  const pts = [];
  const coin = (cx, cy, a0) => { for (let k = 0; k <= n; k++) { const a = a0 + (Math.PI / 2) * k / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } };
  coin(x1 - r, y0 + r, -Math.PI / 2); coin(x1 - r, y1 - r, 0); coin(x0 + r, y1 - r, Math.PI / 2); coin(x0 + r, y0 + r, Math.PI);
  return pts;
}
