// Silhouettes des bas par famille de gabarits (27/11).
// Alexandra : « il faudrait que les personnages aient tous le même style du coup,
// et proche de l'actuel, pas que ça choque margaux » ; « et pas de calage sur les nouveaux ».
//
// Principe : la forme d'un bas est celle du bas DESSINÉ AUJOURD'HUI sur le corps de
// référence de la famille (Female_2, Male_2, Boys_2, Teenage_Boys_1), donc la même
// ligne de taille, la même assise et la même rondeur que l'existant. On la décrit
// par un « patch de Coons » : tout motif (poche, couture, rayure) se dessine dans un
// carré u,v ∈ [0,1]² et retombe dans la silhouette. Pour chaque gabarit, la silhouette
// est élargie ou resserrée rang par rang (facteur k(y)) d'après la largeur des hanches
// du gabarit, mesurée sur son dessin.
import { readFileSync } from "node:fs";
import { aplatir, intervallesY, intervallesX } from "./geom.mjs";

export function groupe(svg, motifId) {
  const re = new RegExp(`<g[^>]*id="${motifId}"[^>]*>([\\s\\S]*?)</g>`);
  const m = re.exec(svg);
  if (!m) throw new Error("groupe introuvable " + motifId);
  return [...m[1].matchAll(/<path[^>]*>/g)].map((p) => ({
    d: /\sd="([^"]*)"/.exec(p[0])[1],
    cls: /class="([^"]*)"/.exec(p[0])?.[1],
  }));
}

/** Demi-largeur du corps (premier tracé du groupe de base) au rang y. */
export function demiLargeurs(svg, idBase, c, y0, y1) {
  const corps = aplatir(groupe(svg, idBase)[0].d);
  const out = {};
  for (let y = y0; y <= y1; y++) {
    const iv = intervallesY(corps, y + 0.5);
    if (!iv.length) continue;
    out[y] = Math.max(c - iv[0][0], iv[iv.length - 1][1] - c);
  }
  return out;
}

/** Construit la silhouette de référence (patch de Coons) à partir du tracé principal du bas. */
export function silhouetteRef(dPrincipal, c) {
  const polys = aplatir(dPrincipal, 24);
  const pts = polys.flat();
  const yTop = Math.min(...pts.map((p) => p[1]));
  const yBot = Math.max(...pts.map((p) => p[1]));
  const gauche = pts.filter((p) => p[0] < c), droite = pts.filter((p) => p[0] > c);
  const coin = (arr, sens) => arr.reduce((a, b) => (b[1] < a[1] - 0.05 || (Math.abs(b[1] - a[1]) <= 0.05 && sens * b[0] > sens * a[0]) ? b : a));
  const TL = coin(gauche, -1), TR = coin(droite, 1);
  const yTc = Math.max(TL[1], TR[1]) + 0.2;
  const yBc = yBot - 0.1 * (yBot - yTop);
  const N = 400;
  const echant = (f) => Array.from({ length: N + 1 }, (_, k) => f(k / N));
  const xL = (y) => intervallesY(polys, y)[0][0];
  const xR = (y) => { const iv = intervallesY(polys, y); return iv[iv.length - 1][1]; };
  const L = echant((v) => { const y = yTc + v * (yBc - yTc); return [xL(y), y]; });
  const R = echant((v) => { const y = yTc + v * (yBc - yTc); return [xR(y), y]; });
  const xTL = L[0][0], xTR = R[0][0];
  const T = echant((u) => { const x = xTL + 0.3 + u * (xTR - xTL - 0.6); const iv = intervallesX(polys, x); return [x, iv[0][0]]; });
  const xBL = L[N][0], xBR = R[N][0];
  const B = echant((u) => { const x = xBL + 0.3 + u * (xBR - xBL - 0.6); const iv = intervallesX(polys, x); return [x, iv[iv.length - 1][1]]; });
  const lit = (arr, t) => { const f = Math.min(N, Math.max(0, t * N)); const k = Math.min(N - 1, Math.floor(f)); const r = f - k; return [arr[k][0] + (arr[k + 1][0] - arr[k][0]) * r, arr[k][1] + (arr[k + 1][1] - arr[k][1]) * r]; };
  const P00 = T[0], P10 = T[N], P01 = B[0], P11 = B[N];
  const M = (u, v) => {
    const t = lit(T, u), b = lit(B, u), l = lit(L, v), r = lit(R, v);
    const x = (1 - v) * t[0] + v * b[0] + (1 - u) * l[0] + u * r[0] - ((1 - u) * (1 - v) * P00[0] + u * (1 - v) * P10[0] + (1 - u) * v * P01[0] + u * v * P11[0]);
    const y = (1 - v) * t[1] + v * b[1] + (1 - u) * l[1] + u * r[1] - ((1 - u) * (1 - v) * P00[1] + u * (1 - v) * P10[1] + (1 - u) * v * P01[1] + u * v * P11[1]);
    return [x, y];
  };
  return { M, c, yTop, yBot, yTc, yBc, polys };
}

/** Applique le facteur de largeur k(y) d'un gabarit (marge d'un demi-pixel contre le liseré de peau). */
export function deformer(sil, k) {
  const { c } = sil;
  const w = ([x, y]) => { const s = Math.sign(x - c); return [c + (x - c) * k(y) + s * 0.5, y]; };
  return { ...sil, M: (u, v) => w(sil.M(u, v)), deform: w };
}
