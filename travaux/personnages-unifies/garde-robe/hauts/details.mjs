// Détails des hauts (27/11) : ombres, col, côtes, rayures, capuche, poches…
// Chaque fonction renvoie une liste de polygones [[x, y], …] posés DANS la pièce.
import { bandeY, bandeX, catmull, ellipse } from "./formes.mjs";

const lerp = (a, b, t) => a + (b - a) * t;
const sinus = (t) => Math.sin(Math.PI * Math.max(0, Math.min(1, t)));

/** Grande ombre du dos (st1) : tout ce qui est à droite de la courbe en S du corps standard. */
export function ombreDos(P, decale = 0) {
  const r = bandeX(P.contour, decale, null, (y) => P.F.S(y));
  return r ? [r] : [];
}

/** Ombres du pli des bras, côté torse (et côté manche si la manche descend). */
export function ombresPli(P, { larg = 11 } = {}) {
  const F = P.F, out = [];
  for (const s of [-1, 1]) {
    const nom = s < 0 ? "g" : "d";
    const C = s < 0 ? P.G : P.D;
    const y0 = F.aisselle + 4;
    const y1 = Math.min(F.poignet[nom] - 8, P.hs - 14, F.taille);
    const pts = [], ret = [];
    const yManche = C.ys ?? y0; // la partie côté bras n'existe que sous la manche
    for (let y = y0; y <= y1; y += 2) {
      const t = (y - y0) / (y1 - y0);
      const x = C.torse(y);
      const w = larg * Math.pow(sinus(t), 0.8);
      const w2 = y <= yManche - 2 ? 0.5 * larg * sinus((y - y0) / Math.max(1, yManche - y0)) : 0;
      pts.push([x + s * w2, y]);
      ret.push([x - s * w, y]);
    }
    if (pts.length > 3) out.push([...pts, ...ret.reverse()]);
  }
  return out;
}

/** Croissant sous l'encolure (intérieur du col, en nuance). */
export function croissantCol(P, prof = 7) {
  const out = [...P.neck];
  const xg = P.neck[0][0], xd = P.neck[P.neck.length - 1][0], cx = (xg + xd) / 2;
  for (let k = P.neck.length - 1; k >= 0; k--) {
    const [x, y] = P.neck[k];
    const t = (x - cx) / ((xd - xg) / 2);
    out.push([x, y + prof * Math.max(0, 1 - t * t)]);
  }
  return [out];
}

/** Bande de l'encolure (côte du col) d'épaisseur h, sur toute la largeur du col. */
export function bandeCol(P, h = 7, ecart = 0) {
  let r = bandeY(P.contour, ecart, h + ecart, P.neckY);
  if (r) r = bandeX(r, P.xg, P.xd); // la côte s'arrête au bord du col, sans filer sur l'épaule
  return r ? [r] : [];
}

/** Côte de l'ourlet (bande de hauteur h au-dessus du bas). */
export function coteOurlet(P, h = 14) {
  let r = bandeY(P.contour, -h, null, (x) => P.hemY(Math.max(P.hg, Math.min(P.hd, x))));
  if (r) r = bandeX(r, P.hg - 0.5, P.hd + 0.5);
  return r ? [r] : [];
}

/** Poignets : bande de hauteur h au bout de chaque manche (manche longue ou 3/4). */
export function poignets(P, h = 13) {
  const out = [];
  for (const C of [P.G, P.D]) {
    if (C.ys == null) continue;
    const s = C === P.G ? -1 : 1;
    const xa = C.ext(C.yb), xb = C.inner(C.ys);
    const ligne = (x) => lerp(C.yb, C.ys, Math.max(0, Math.min(1, (x - xa) / (xb - xa))));
    let r = bandeY(P.contour, -h, null, ligne);
    if (!r) continue;
    const bordInt = (y) => C.inner(Math.min(y, C.ys));
    r = s < 0 ? bandeX(r, null, 0, bordInt) : bandeX(r, 0, null, bordInt);
    if (r) r = bandeY(r, null, C.ys + 0.5);
    if (r) out.push(r);
  }
  return out;
}

/** Bordure intérieure d'une emmanchure de débardeur (largeur w). */
export function bordEmmanchure(P, w = 7) {
  const out = [];
  for (const C of [P.G, P.D]) {
    if (!C.AH) continue;
    const s = C === P.G ? -1 : 1;
    const ext = [], int = [];
    const yFin = C.yAH + 14;
    for (const [x, y] of C.pts) {
      if (y > yFin) break;
      if (y < P.ns + 1) continue;
      // la bordure s'affine sous l'aisselle
      const ww = y <= C.yAH ? w : w * Math.max(0, (yFin - y) / (yFin - C.yAH));
      ext.push([x, y]); int.push([x - s * ww, y]);
    }
    // on referme en biseau vers le bas
    if (ext.length > 4) out.push([...ext, ...int.reverse()]);
  }
  return out;
}

/** Rayures horizontales sur toute la pièce. */
export function rayures(P, { y0, y1, periode, epais }) {
  const out = [];
  for (let y = y0; y + epais <= y1; y += periode) {
    const r = bandeY(P.contour, y, y + epais);
    if (r) out.push(r);
  }
  return out;
}

/** Bandes verticales (carreaux), x0 = première bande. */
export function bandesVerticales(P, { x0, x1, periode, epais, y0 = 0, y1 = 1000 }) {
  const out = [];
  for (let x = x0; x + epais <= x1; x += periode) {
    let r = bandeX(P.contour, x, x + epais);
    if (r) r = bandeY(r, y0, y1);
    if (r) out.push(r);
  }
  return out;
}

/** Hauteur du coude, au milieu de la manche. */
export function coude(P, C, dy = 0) {
  const F = P.F, s = C === P.G ? -1 : 1, nom = s < 0 ? "g" : "d";
  const y = Math.round((F.aisselle + F.poignet[nom]) / 2) + dy;
  const x = (C.ext(y) + C.inner(y)) / 2;
  return [x, y];
}

/** Coudières (ellipses). */
export function coudieres(P, rx = 12, ry = 22) {
  return [P.G, P.D].map((C) => { const [x, y] = coude(P, C, 10); return ellipse(x, y, rx, ry); });
}

/** Petite ombre de coude sur une manche longue. */
export function ombresCoude(P) {
  return [P.G, P.D].map((C) => {
    const s = C === P.G ? -1 : 1;
    const [x, y] = coude(P, C, -8);
    const xe = C.ext(y);
    const xi = lerp(xe, x, 0.85);
    return catmull([[xe - s * 0.5, y - 26], [xi, y - 6], [xi - s * 2, y + 2], [xe - s * 0.5, y + 16]], 6).concat([[xe - s * 0.5, y - 26]]);
  });
}

/** Capuche posée à plat sur le haut du dos, sous la nuque. */
export function capuche(P, { demiCou, demi, haut }) {
  const F = P.F, cx = P.o.cxCol ?? F.cx, ns = P.ns;
  const y0 = ns + 24;
  const U = (th, dh = 0, dw = 0) => [cx - (demi + dw) * Math.cos(th), y0 + (haut + dh) * Math.sin(th)];
  const tour = [];
  tour.push([cx - demiCou, ns - 1]);
  tour.push(...catmull([[cx - demiCou, ns - 1], [cx - demi + 10, ns + 4], [cx - demi, y0]], 6).slice(1, -1));
  for (let k = 0; k <= 30; k++) tour.push(U(Math.PI * k / 30));
  tour.push(...catmull([[cx + demi, y0], [cx + demi - 10, ns + 4], [cx + demiCou, ns - 1]], 6).slice(1));
  // bord supérieur : l'encolure
  const haut2 = [];
  for (let x = cx + demiCou; x >= cx - demiCou; x -= 2) haut2.push([x, Math.min(P.neckY(x), ns + 6) - 1]);
  const forme = [...tour, ...haut2.slice(1, -1)];
  // ouverture (doublure vue de dos) : croissant sous l'encolure
  const ouv = [];
  for (let x = cx - demiCou + 3; x <= cx + demiCou - 3; x += 2) ouv.push([x, Math.min(P.neckY(x), ns + 6)]);
  for (let x = cx + demiCou - 3; x >= cx - demiCou + 3; x -= 2) { const t = (x - cx) / (demiCou - 3); ouv.push([x, ns + 6 + 22 * Math.max(0, 1 - t * t)]); }
  // ombre portée sous la capuche
  const ombre = [];
  for (let k = 3; k <= 27; k++) ombre.push(U(Math.PI * k / 30, 0, 0));
  for (let k = 27; k >= 3; k--) { const th = Math.PI * k / 30; ombre.push(U(th, 9 * Math.sin(th), 2 * Math.sin(th))); }
  // pli au milieu de la capuche (petite ombre)
  const pli = catmull([[cx - 4, ns + 34], [cx - 2, ns + 60], [cx, y0 + haut - 4], [cx + 6, ns + 60], [cx + 5, ns + 34]], 6);
  return { forme: [forme], ouverture: [ouv], ombre: [ombre], pli: [pli] };
}

/** Col montant (chemise, doudoune) : bande entre l'encolure et h px au-dessus, qui suit le cou. */
export function colMontant(P, h, { marge = 2.5 } = {}) {
  const F = P.F;
  const g = (y) => F.envG(y) - marge, d = (y) => F.envD(y) + marge;
  const pts = P.neck.map(([x, y]) => [x, y + 1.5]);
  const yd = P.neck[P.neck.length - 1][1], yg = P.neck[0][1];
  for (let y = yd; y >= yd - h; y -= 1) pts.push([d(y), y]);
  const xd = d(yd - h), xg = g(yg - h);
  for (let x = xd - 2; x >= xg + 2; x -= 2) pts.push([x, P.neckY(Math.max(P.xg, Math.min(P.xd, x))) - h - 1]);
  for (let y = yg - h; y <= yg; y += 1) pts.push([g(y), y]);
  return [pts];
}

/** Col Claudine : deux pans arrondis posés sous l'encolure. */
export function colClaudine(P, prof = 26) {
  const xg = P.neck[0][0], xd = P.neck[P.neck.length - 1][0], cx = (xg + xd) / 2;
  const pts = P.neck.map(([x, y]) => [x, y - 1]);
  for (let k = P.neck.length - 1; k >= 0; k--) {
    const [x, y] = P.neck[k];
    const t = Math.abs(x - cx) / ((xd - xg) / 2);
    // un lobe par côté, avec une encoche au milieu
    const lobe = Math.pow(Math.sin(Math.PI * Math.min(1, (t + 0.06) / 1.06)), 0.55);
    const enc = t < 0.08 ? (t / 0.08) : 1;
    pts.push([x - Math.sign(x - cx) * 6 * (1 - t), y + prof * lobe * enc + 2]);
  }
  return [pts];
}

/** Ombre sous un col posé (décalée de quelques pixels). */
export function ombreSousCol(poly, dy = 5) {
  return poly.map((p) => p.map(([x, y]) => [x, y + dy]));
}

/** Empiècement brodé (tunique) : bande large autour de l'encolure, bord festonné, découpée dans la pièce. */
export function empiecement(P, prof = 30, festons = 9) {
  const xg = P.neck[0][0], xd = P.neck[P.neck.length - 1][0], cx = (xg + xd) / 2;
  const L = (xd - xg) / 2 + 30;
  const bord = (x) => {
    const t = (x - cx) / L;
    if (Math.abs(t) >= 1) return -2000; // hors de l'empiècement : rien
    const f = Math.abs(Math.sin(Math.PI * festons * (t + 1) / 2));
    return P.neckY(Math.max(xg, Math.min(xd, x))) + 4 + (prof - 6 * (1 - f)) * Math.sqrt(1 - t * t);
  };
  const r = bandeY(P.contour, null, 0, bord);
  return r ? [r] : [];
}

/** Bande horizontale le long d'une courbe (ceinture, martingale). */
export function ceinture(P, y, h, { x0 = -1, x1 = 999 } = {}) {
  let r = bandeY(P.contour, y, y + h);
  if (r && (x0 > 0 || x1 < 999)) r = bandeX(r, x0, x1);
  return r ? [r] : [];
}

export { lerp, sinus };
