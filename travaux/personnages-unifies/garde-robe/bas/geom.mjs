// Outils de géométrie pour les bas sur gabarit (27/11).
// Alexandra : « plus besoin d'avoir à les caler du coup parce qu'ils sont tous unifiés ».

/** Aplatit un attribut d SVG en sous-chemins de points [x, y]. */
export function aplatir(d, pas = 14) {
  const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  let i = 0, cmd = null, x = 0, y = 0, sx = 0, sy = 0, lcx = null, lcy = null, lqx = null, lqy = null;
  const subs = []; let cur = null;
  const num = () => parseFloat(toks[i++]);
  const isNum = () => i < toks.length && !/^[a-zA-Z]$/.test(toks[i]);
  const ligne = (nx, ny) => { cur.push([nx, ny]); x = nx; y = ny; };
  const cubique = (x1, y1, x2, y2, x3, y3) => {
    const x0 = x, y0 = y;
    for (let k = 1; k <= pas; k++) {
      const t = k / pas, m = 1 - t;
      cur.push([m*m*m*x0 + 3*m*m*t*x1 + 3*m*t*t*x2 + t*t*t*x3, m*m*m*y0 + 3*m*m*t*y1 + 3*m*t*t*y2 + t*t*t*y3]);
    }
    x = x3; y = y3; lcx = x2; lcy = y2;
  };
  const quad = (x1, y1, x2, y2) => {
    const x0 = x, y0 = y;
    for (let k = 1; k <= pas; k++) { const t = k / pas, m = 1 - t;
      cur.push([m*m*x0 + 2*m*t*x1 + t*t*x2, m*m*y0 + 2*m*t*y1 + t*t*y2]); }
    x = x2; y = y2; lqx = x1; lqy = y1;
  };
  while (i < toks.length) {
    if (!isNum()) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase(); const C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C !== "C" && C !== "S") { lcx = lcy = null; }
    if (C !== "Q" && C !== "T") { lqx = lqy = null; }
    switch (C) {
      case "M": { const nx = num() + ox, ny = num() + oy; cur = [[nx, ny]]; subs.push(cur); x = sx = nx; y = sy = ny; cmd = rel ? "l" : "L"; break; }
      case "L": ligne(num() + ox, num() + oy); break;
      case "H": ligne(num() + ox, y); break;
      case "V": ligne(x, num() + oy); break;
      case "C": { const a = num() + ox, b = num() + oy, c = num() + ox, e = num() + oy, f = num() + ox, g = num() + oy; cubique(a, b, c, e, f, g); break; }
      case "S": { const rx = lcx === null ? x : 2 * x - lcx, ry = lcy === null ? y : 2 * y - lcy;
        const c = num() + ox, e = num() + oy, f = num() + ox, g = num() + oy; cubique(rx, ry, c, e, f, g); break; }
      case "Q": { const a = num() + ox, b = num() + oy, f = num() + ox, g = num() + oy; quad(a, b, f, g); break; }
      case "T": { const rx = lqx === null ? x : 2 * x - lqx, ry = lqy === null ? y : 2 * y - lqy; quad(rx, ry, num() + ox, num() + oy); break; }
      case "A": { num(); num(); num(); num(); num(); ligne(num() + ox, num() + oy); break; }
      case "Z": { if (cur) cur.push([sx, sy]); x = sx; y = sy; break; }
      default: throw new Error("commande inconnue " + cmd);
    }
  }
  return subs.filter((s) => s.length > 2);
}

/** Intersections (paires d'intervalles, pair-impair) des polygones avec la ligne y. */
export function intervallesY(polys, y) {
  const res = [];
  for (const p of polys) {
    const xs = [];
    for (let k = 0; k < p.length; k++) {
      const [x1, y1] = p[k], [x2, y2] = p[(k + 1) % p.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) res.push([xs[k], xs[k + 1]]);
  }
  return fusion(res);
}
export function intervallesX(polys, x) {
  const t = polys.map((p) => p.map(([a, b]) => [b, a]));
  return intervallesY(t, x);
}
function fusion(iv) {
  iv.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const v of iv) {
    if (out.length && v[0] <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], v[1]);
    else out.push([...v]);
  }
  return out;
}

/** Découpe Sutherland–Hodgman d'un polygone uv par le carré [0,1]². */
export function decoupeCarre(poly) {
  const plans = [
    (p) => p[0] >= 0, (p) => p[0] <= 1, (p) => p[1] >= 0, (p) => p[1] <= 1,
  ];
  const inter = [
    (a, b) => { const t = (0 - a[0]) / (b[0] - a[0]); return [0, a[1] + t * (b[1] - a[1])]; },
    (a, b) => { const t = (1 - a[0]) / (b[0] - a[0]); return [1, a[1] + t * (b[1] - a[1])]; },
    (a, b) => { const t = (0 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), 0]; },
    (a, b) => { const t = (1 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), 1]; },
  ];
  let out = poly;
  for (let k = 0; k < 4; k++) {
    const inp = out; out = [];
    if (!inp.length) break;
    for (let j = 0; j < inp.length; j++) {
      const a = inp[j], b = inp[(j + 1) % inp.length];
      const ia = plans[k](a), ib = plans[k](b);
      if (ia && ib) out.push(b);
      else if (ia && !ib) out.push(inter[k](a, b));
      else if (!ia && ib) { out.push(inter[k](a, b)); out.push(b); }
    }
  }
  return out;
}

/** Densifie un polygone (fermé) pour que chaque côté fasse au plus `pas` en uv. */
export function densifier(poly, pas = 0.01, ferme = true) {
  const out = [];
  const n = ferme ? poly.length : poly.length - 1;
  for (let j = 0; j < n; j++) {
    const a = poly[j], b = poly[(j + 1) % poly.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.ceil(l / pas));
    for (let s = 0; s < k; s++) out.push([a[0] + (b[0] - a[0]) * s / k, a[1] + (b[1] - a[1]) * s / k]);
  }
  if (!ferme) out.push(poly[poly.length - 1]);
  return out;
}

const f1 = (v) => (Math.round(v * 10) / 10).toString();

/** Simplifie une suite de points : garde un point dès qu'on s'écarte de `tol`. */
function simplifier(pts, tol = 0.35) {
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

/** Écrit un polygone xy en attribut d (lignes, points simplifiés). */
export function versD(pts, ferme = true) {
  const p = simplifier(ferme ? [...pts, pts[0]] : pts);
  let d = "M" + f1(p[0][0]) + "," + f1(p[0][1]);
  for (let k = 1; k < p.length - (ferme ? 1 : 0); k++) d += "L" + f1(p[k][0]) + "," + f1(p[k][1]);
  return d + (ferme ? "z" : "");
}

/** Bande d'épaisseur w autour d'une ligne de points xy (pour coutures, rayures). */
export function bandeAutour(pts, w) {
  const g = [], dr = [];
  for (let k = 0; k < pts.length; k++) {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
    let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    g.push([pts[k][0] + nx * w / 2, pts[k][1] + ny * w / 2]);
    dr.push([pts[k][0] - nx * w / 2, pts[k][1] - ny * w / 2]);
  }
  return [...g, ...dr.reverse()];
}

export const lisse = (a, b, t) => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
