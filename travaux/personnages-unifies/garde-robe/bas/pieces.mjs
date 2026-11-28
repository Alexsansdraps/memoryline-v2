// Les types de bas. Chaque type se dessine UNE fois dans le repère u,v de la silhouette de sa famille,
// donc tombe juste sur tous les gabarits de la famille sans calage.
// Style des bas d'origine : un aplat, une bande de ceinture plus sombre (nuance), une grande ombre
// noire à 15 % sur le côté droit, et peu de détails francs (6 px au moins).
import { courbe, courbeFermee, reperes, versPx, bandeH, bord, bordDecale, trait, gaucheDe, miroir, rect, fonctionDeV } from "./formes.mjs";
import { cadre } from "./mesure.mjs";

// ---------- couleurs ----------
function versTsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60;
  }
  return [h, s, l];
}
function deTsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return "#" + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}
/** Nuance d'ombre : même teinte, 0,12 plus sombre en clarté TSL. */
export function nuance(hex, d = 0.12) {
  const [h, s, l] = versTsl(hex);
  if (l - d < 0.02) throw new Error("couleur trop sombre pour une nuance : " + hex);
  return deTsl(h, s, l - d);
}
export { versTsl };

// ---------- silhouettes ----------
/** Silhouette de pantalon : bords mesurés de la famille. */
export function silPantalon(M) {
  const { Lf, Rf } = cadre(M.L, M.R);
  return { haut: M.F.haut, bas: M.F.assise, L: M.L, R: M.R, Lf, Rf, F: M.F };
}
/**
 * Silhouette de jupe : sous le point le plus large des hanches, le tissu ne suit plus les fesses vers
 * l'assise, il descend en s'évasant doucement de `s` px et se pose sur l'assise, coins arrondis
 * (rayon `r`). Avant le 27/11 au soir, il tombait droit sous y = assise - 25 en partant d'un cran
 * vers l'extérieur : un socle carré sous la jupe.
 */
export function silJupe(M, s, r = 12) {
  const F = M.F, n = M.L.length, L = [...M.L], R = [...M.R];
  // Rang le plus large de chaque côté, dans la moitié basse (sous les mains).
  let iG = Math.floor(n / 2), iD = iG;
  for (let i = Math.floor(n / 2); i < n; i++) { if (M.L[i] < M.L[iG]) iG = i; if (M.R[i] > M.R[iD]) iD = i; }
  const doux = (t) => t * t * (3 - 2 * t);
  for (let i = iG; i < n; i++) L[i] = Math.min(M.L[i], M.L[iG] - s * doux((i - iG) / (n - 1 - iG)));
  for (let i = iD; i < n; i++) R[i] = Math.max(M.R[i], M.R[iD] + s * doux((i - iD) / (n - 1 - iD)));
  // Coins posés sur l'assise : quart de cercle sur les r derniers rangs.
  for (let i = n - r; i < n; i++) {
    const d = i + 0.5 - (n - r), k = r - Math.sqrt(Math.max(0, r * r - d * d));
    L[i] += k; R[i] -= k;
  }
  const { Lf, Rf } = cadre(L, R);
  return { haut: F.haut, bas: F.assise, L, R, Lf, Rf, F, evase: F.haut + Math.min(iG, iD) };
}
function contour(sil) {
  const g = [[sil.L[0], sil.haut]], d = [[sil.R[0], sil.haut]];
  sil.L.forEach((x, i) => g.push([x, sil.haut + i + 0.5]));
  sil.R.forEach((x, i) => d.push([x, sil.haut + i + 0.5]));
  g.push([sil.L[sil.L.length - 1], sil.bas]); d.push([sil.R[sil.R.length - 1], sil.bas]);
  return [...g, ...d.reverse()];
}

// ---------- éléments communs ----------
const COURBE_OMBRE = [[0.66, 0], [0.69, 0.2], [0.79, 0.45], [0.8, 0.62], [0.72, 0.82], [0.58, 1]];

function contexte(sil) {
  const R = reperes(sil);
  const s = fonctionDeV(COURBE_OMBRE);
  const xs = (y) => R.Mf(s(R.vDeY(y)), R.vDeY(y))[0];
  const du = (px, v) => { const a = R.Mf(0, v), b = R.Mf(1, v); return px / Math.max(1, b[0] - a[0]); };
  const formes = { st0: [contour(sil)], st2: [], st3: [], st4: [], st1: [] };
  return { sil, R, s, xs, du, formes };
}
const ajoute = (c, cls, ...polys) => { for (const p of polys) if (p && p.length > 2) c.formes[cls].push(p); };
const aGauche = (c, p) => gaucheDe(p, (y) => c.xs(y) - 1);

function ombreDroite(c) { ajoute(c, "st1", bord(c.R, "d", 0, 1, c.s)); }
function ombreSous(c, v, px = 5, bombe = 0) { ajoute(c, "st1", aGauche(c, bandeH(c.R, v, v + c.R.vpx(px), bombe))); }
function cercle(cx, cy, r, n = 18) { return Array.from({ length: n }, (_, k) => [cx + r * Math.cos(2 * Math.PI * k / n), cy + r * Math.sin(2 * Math.PI * k / n)]); }
/** Ceinture : couture (ou bande) foncée en bas de la ceinture. */
function ceinture(c, h, couture = 4, bombe = 3) {
  const R = c.R, v = R.vpx(h), b = R.vpx(bombe);
  ajoute(c, "st2", bandeH(R, v, v + R.vpx(couture), b));
  return { v: v + R.vpx(couture), b };
}
/** Passants : petites bandes verticales sur la ceinture. */
function passants(c, us, hauteur, cls = "st2", larg = 7, bombe = 3) {
  const R = c.R;
  for (const u of us) {
    const v1 = R.vpx(hauteur) + R.vpx(bombe) * 4 * u * (1 - u);
    const d = c.du(larg, v1 / 2) / 2;
    ajoute(c, cls, versPx(rect(u - d, R.vpx(1), u + d, v1), R.Mf));
  }
}
/** Ceinture en cuir passée dans les passants (segments entre les passants). */
function ceintureCuir(c, v0px, v1px, us, cls = "st3", bombe = 3) {
  const R = c.R, b = R.vpx(bombe), bornes = [0];
  for (const u of us) { const d = c.du(5, R.vpx(v0px)); bornes.push(u - d, u + d); }
  bornes.push(1);
  for (let k = 0; k + 1 < bornes.length; k += 2) ajoute(c, cls, bandeH(R, R.vpx(v0px), R.vpx(v1px), b, bornes[k], bornes[k + 1]));
}
/** Poche passepoilée (fente horizontale) côté gauche et son miroir, bouton éventuel. */
function pochesPassepoil(c, v, u0 = 0.17, u1 = 0.4, bouton = false) {
  const R = c.R, h = R.vpx(6);
  for (const p of [rect(u0, v, u1, v + h), miroir(rect(u0, v, u1, v + h))]) ajoute(c, "st2", versPx(p, R.Mf));
  ajoute(c, "st1", aGauche(c, versPx(rect(u0, v + h, u1, v + h + R.vpx(4)), R.Mf)));
  if (bouton) for (const u of [(u0 + u1) / 2, 1 - (u0 + u1) / 2]) { const [x, y] = R.Mf(u, v + h + R.vpx(9)); ajoute(c, "st4", cercle(x, y, 3.5)); }
}
/** Pinces : fuseaux sombres qui partent de la ceinture. */
function pinces(c, v0, long, us, larg = 6) {
  const R = c.R;
  for (const u of us) {
    const d = c.du(larg, v0) / 2;
    const p = courbe([[u - d, v0], [u - d * 0.5, v0 + long * 0.5], [u, v0 + long]], 8);
    const q = courbe([[u, v0 + long], [u + d * 0.5, v0 + long * 0.5], [u + d, v0]], 8);
    ajoute(c, "st2", versPx([...p, ...q.slice(1)], R.Mf));
  }
}
/** Poches plaquées (jean, short) : forme pentagonale, gauche et miroir. */
function pochePlaquee(v0, v1, u0 = 0.13, u1 = 0.42) {
  const um = (u0 + u1) / 2;
  return [[u0, v0 + 0.01], [u1, v0 - 0.01], [u1 - 0.01, v1 - 0.05], [um + 0.01, v1], [u0 + 0.02, v1 - 0.05]];
}
/** Revers sur les côtés, au ras de l'assise (short, bermuda) : bande collée au bord. */
function revers(c, cls) {
  const R = c.R, [v0, v1] = c.sil.F.revers, largPx = c.sil.F.taille > 700 ? 14 : 11;
  for (const cote of ["g", "d"]) {
    ajoute(c, cls, bordDecale(R, cote, v0, v1, () => largPx));
    if (cote === "g") ajoute(c, "st1", bordDecale(R, cote, v0 - R.vpx(4), v0, () => largPx));
  }
}
/** Bandes sur les côtés, du bas de la ceinture vers l'assise (jogging). */
function bandesCotes(c, cls, v0, largPx = 9, retraitPx = 5) {
  for (const cote of ["g", "d"]) ajoute(c, cls, bordDecale(c.R, cote, Math.max(v0, 0.2), c.sil.F.finCotes, () => largPx, () => retraitPx));
}
/** Plis (jupe plissée, fronces) : fuseaux de nuance de v0 à v1, de largeur w0 à w1 px. */
function plis(c, us, v0, v1, w0, w1, cls = "st2", courbure = 0) {
  const R = c.R;
  for (const u of us) {
    const g = [], d = [];
    for (let k = 0; k <= 20; k++) {
      const v = v0 + (v1 - v0) * k / 20, t = k / 20;
      const uc = u + courbure * Math.sin(Math.PI * t) + (u - 0.5) * 0.06 * t;
      const w = c.du(w0 + (w1 - w0) * t, v) / 2;
      g.push([uc - w, v]); d.push([uc + w, v]);
    }
    ajoute(c, cls, versPx([...g, ...d.reverse()], R.Mf, 0.02));
  }
}

// ---------- les types ----------
export const TYPES = {
  jean(c) {
    const R = c.R;
    const wb = ceinture(c, 14, 4);
    passants(c, [0.1, 0.3, 0.5, 0.7, 0.9], 18);
    // empiècement en V et couture du milieu
    const vE = wb.v + R.vpx(14), vC = vE + R.vpx(12);
    // poches arrière
    const p = pochePlaquee(Math.max(0.35, vC + R.vpx(8)), Math.max(0.35, vC + R.vpx(8)) + 0.29);
    for (const q of [p, miroir(p)]) ajoute(c, "st2", versPx(q, R.Mf));
    for (const q of [p, p.map(([u, v]) => [1 - u, v])]) {
      const [a, b, cc, d, e] = q;
      const k = q === p ? 1 : -1, du = c.du(5, a[1]), dv = R.vpx(5);
      const U = [[a[0] + k * du, a[1] + dv], [e[0] + k * du, e[1]], [d[0], d[1] - dv * 1.4], [cc[0] - k * du, cc[1]], [b[0] - k * du, b[1] + dv]];
      ajoute(c, "st3", trait(R, U, 3.5));
      ajoute(c, "st3", trait(R, courbe([[a[0] + k * du * 2.5, (a[1] + d[1]) / 2 + 0.03], [(a[0] + b[0]) / 2, (a[1] + d[1]) / 2 - 0.03], [b[0] - k * du * 2.5, (a[1] + d[1]) / 2 + 0.03]], 8), 3.5));
      for (const pt of [a, b]) { const [x, y] = R.Mf(pt[0] + k * (pt === a ? 1 : -1) * du * 0.6, pt[1] + dv * 0.6); ajoute(c, "st4", cercle(x, y, 3.2)); }
    }
    ajoute(c, "st3", trait(R, courbe([[0, vE], [0.25, vE + (vC - vE) * 0.55], [0.5, vC], [0.75, vE + (vC - vE) * 0.55], [1, vE]], 10), 3.5, R.Mt));
    ajoute(c, "st3", trait(R, [[0.5, vC], [0.5, 0.93]], 3.5));
    ombreSous(c, wb.v, 5, wb.b);
    ombreDroite(c);
  },
  toile(c) {
    const R = c.R, us = [0.1, 0.32, 0.5, 0.68, 0.9];
    const wb = ceinture(c, 14, 3);
    ceintureCuir(c, 3, 13, us);
    pinces(c, wb.v, 0.17, [0.3, 0.7]);
    pochesPassepoil(c, 0.33);
    ombreSous(c, wb.v, 4, wb.b);
    ombreDroite(c);
  },
  pinces(c) {
    const R = c.R;
    const wb = ceinture(c, 20, 4);
    passants(c, [0.12, 0.88], 24);
    pinces(c, wb.v, 0.24, [0.26, 0.34, 0.66, 0.74], 7);
    pochesPassepoil(c, 0.34, 0.14, 0.38, true);
    ombreSous(c, wb.v, 5, wb.b);
    ombreDroite(c);
  },
  costume(c) {
    const R = c.R, us = [0.12, 0.34, 0.5, 0.66, 0.88];
    const wb = ceinture(c, 13, 3);
    ceintureCuir(c, 3, 11, us);
    pinces(c, wb.v, 0.2, [0.31, 0.69]);
    pochesPassepoil(c, 0.34, 0.16, 0.39, true);
    ajoute(c, "st2", trait(R, [[0.5, wb.v + R.vpx(4)], [0.5, 0.9]], 4));
    ombreSous(c, wb.v, 4, wb.b);
    ombreDroite(c);
  },
  short(c) {
    const R = c.R;
    const wb = ceinture(c, 14, 4);
    passants(c, [0.1, 0.3, 0.5, 0.7, 0.9], 18);
    const p = pochePlaquee(0.34, 0.6, 0.15, 0.41);
    for (const q of [p, miroir(p)]) ajoute(c, "st2", versPx(q, R.Mf));
    revers(c, "st3");
    ombreSous(c, wb.v, 5, wb.b);
    ombreDroite(c);
  },
  bermudaCarreaux(c) {
    const R = c.R;
    const wb = ceinture(c, 14, 4);
    // carreaux : bandes de nuance de 10 px, filets clairs de 8 px un sur deux
    const pasV = [0.08, 0.27, 0.46, 0.65, 0.84];
    for (const u of pasV) ajoute(c, "st2", versPx(rect(u, wb.v, u + c.du(10, 0.5), 1), R.Mf, 0.02));
    for (let y = R.yv(wb.v) + 22; y < c.sil.bas - 6; y += 46) ajoute(c, "st2", bandeH(R, R.vDeY(y), R.vDeY(y + 10)));
    for (const u of [0.175, 0.555, 0.935]) ajoute(c, "st3", versPx(rect(u, wb.v, u + c.du(8, 0.5), 1), R.Mf, 0.02));
    for (let y = R.yv(wb.v) + 45; y < c.sil.bas - 6; y += 92) ajoute(c, "st3", bandeH(R, R.vDeY(y), R.vDeY(y + 8)));
    passants(c, [0.1, 0.3, 0.5, 0.7, 0.9], 18);
    revers(c, "st3");
    ombreSous(c, wb.v, 5, wb.b);
    ombreDroite(c);
  },
  legging(c) {
    const R = c.R;
    ajoute(c, "st2", bandeH(R, 0, R.vpx(9), R.vpx(3)));
    ajoute(c, "st1", versPx([[0.5, 0.55], [0.506, 0.78], [0.516, 0.98], [0.484, 0.98], [0.494, 0.78]], R.Mf, 0.02));
    ombreDroite(c);
  },
  jogging(c) {
    const R = c.R, h = 18;
    // ceinture élastique froncée : segments sombres séparés par des fronces claires
    const N = 26;
    for (let k = 0; k < N; k++) {
      const u0 = k / N, u1 = (k + 0.62) / N;
      ajoute(c, "st2", bandeH(R, 0, R.vpx(h), R.vpx(3), u0, u1));
    }
    ajoute(c, "st2", bandeH(R, R.vpx(h), R.vpx(h + 4), R.vpx(3)));
    // bouts du cordon, noués devant et ramenés sur les hanches
    for (const u of [0.07, 0.93]) {
      const s = u < 0.5 ? 1 : -1;
      ajoute(c, "st3", trait(R, courbe([[u, R.vpx(6)], [u + s * 0.006, R.vpx(22)], [u + s * 0.016, R.vpx(38)]], 8), 5));
      const [x, y] = R.Mf(u + s * 0.016, R.vpx(40)); ajoute(c, "st3", cercle(x, y, 4));
    }
    bandesCotes(c, "st3", R.vpx(h + 4));
    ombreSous(c, R.vpx(h + 4), 5, R.vpx(3));
    ombreDroite(c);
  },
  cargo(c) {
    const R = c.R;
    const wb = ceinture(c, 14, 4);
    passants(c, [0.1, 0.3, 0.5, 0.7, 0.9], 18);
    // poches arrière à rabat
    const v0 = 0.3;
    for (const m of [false, true]) {
      const rab = rect(0.15, v0, 0.4, v0 + R.vpx(13));
      const poc = [[0.16, v0 + R.vpx(13)], [0.39, v0 + R.vpx(13)], [0.385, v0 + 0.25], [0.165, v0 + 0.25]];
      ajoute(c, "st2", versPx(m ? miroir(trait0(poc)) : trait0(poc), R.Mf));
      ajoute(c, "st2", versPx(m ? miroir(rab) : rab, R.Mf));
      const [x, y] = R.Mf(m ? 0.725 : 0.275, v0 + R.vpx(8)); ajoute(c, "st4", cercle(x, y, 3.5));
    }
    ajoute(c, "st1", aGauche(c, versPx(rect(0.16, v0 + R.vpx(13), 0.39, v0 + R.vpx(17)), R.Mf)));
    // poches latérales sur les cuisses, visibles sur les côtés
    for (const cote of ["g", "d"]) {
      const f = c.sil.F.finCotes, h = 0.3;
      ajoute(c, "st2", bordDecale(R, cote, f - h + 0.05, f, () => 20, () => 1));
      ajoute(c, "st2", bordDecale(R, cote, f - h, f - h + 0.07, () => 23));
      if (cote === "g") ajoute(c, "st1", bordDecale(R, cote, f - h + 0.07, f - h + 0.1, () => 21, () => 1));
      const [x, y] = R.Mt(cote === "g" ? 0 : 1, f - h + 0.035); ajoute(c, "st4", cercle(x + (cote === "g" ? 12 : -12), y, 3.5));
    }
    ombreSous(c, wb.v, 5, wb.b);
    ombreDroite(c);
  },
  jupeDroite(c) {
    const R = c.R;
    const wb = ceinture(c, 12, 4);
    ajoute(c, "st2", trait(R, [[0.5, wb.v], [0.5, 0.8]], 4));
    // fente du milieu
    ajoute(c, "st2", versPx([[0.497, 0.78], [0.503, 0.78], [0.52, 1], [0.48, 1]], R.Mf, 0.02));
    ombreSous(c, wb.v, 5, wb.b);
    ombreDroite(c);
  },
  jupePlissee(c) {
    const R = c.R;
    const wb = ceinture(c, 12, 4);
    const N = 8, us = Array.from({ length: N }, (_, k) => (k + 0.5) / N);
    plis(c, us, wb.v + R.vpx(4), 1, 6, 12);
    ombreSous(c, wb.v, 5, wb.b);
    ombreDroite(c);
  },
  jupeLongue(c) {
    const R = c.R;
    const wb = ceinture(c, 10, 3);
    plis(c, [0.2, 0.42], 0.42, 1, 1, 14, "st2", -0.02);
    plis(c, [0.62], 0.5, 1, 1, 12, "st2", 0.02);
    ajoute(c, "st3", bandeH(R, 1 - R.vpx(10), 1));
    ombreSous(c, wb.v, 4, wb.b);
    ombreDroite(c);
  },
  robeBas(c, ourlet = false) {
    const R = c.R;
    // fronces sous la taille (cachée par l'ourlet du haut), puis plis souples jusqu'à l'assise
    plis(c, [0.1, 0.22, 0.34, 0.46, 0.58, 0.7, 0.82], 0.02, 0.32, 6, 1);
    plis(c, [0.18, 0.4], 0.38, 1, 1, 13, "st2", -0.015);
    plis(c, [0.6], 0.45, 1, 1, 11, "st2", 0.015);
    if (ourlet) ajoute(c, "st3", bandeH(R, 1 - R.vpx(9), 1));
    ombreSous(c, 0, 5, R.vpx(3));
    ombreDroite(c);
  },
  jupeEnfant(c) {
    const R = c.R;
    ajoute(c, "st3", bandeH(R, 0, R.vpx(11), R.vpx(3)));
    const N = 7, us = Array.from({ length: N }, (_, k) => (k + 0.5) / N);
    plis(c, us, R.vpx(15), 1, 6, 11);
    ombreSous(c, R.vpx(11), 4, R.vpx(3));
    ombreDroite(c);
  },
};
function trait0(p) { return p; }

export function dessiner(type, sil, option) {
  const c = contexte(sil);
  TYPES[type](c, option);
  return c.formes;
}
