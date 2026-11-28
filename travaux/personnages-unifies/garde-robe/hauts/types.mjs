// Catalogue des hauts sur gabarits (27/11). L'ordre de cette liste donne les numéros
// proposés (1000, 1001, …) : on ajoute à la fin, on ne renumérote jamais.
import { patron } from "./patron.mjs";
import * as D from "./details.mjs";
import { bandeY, bandeX, ellipse, rectArrondi, catmull } from "./formes.mjs";

// ourlet par famille : [bord, milieu]
const OURLET = { femme: [792, 822], homme: [750, 774], enfant: [708, 722], ado: [716, 738] };
const OURLET_LONG = { femme: [876, 880], enfant: [775, 779] };

// ---------- briques communes ----------

function base(F, o) {
  const [hs, hc] = OURLET[F.nom];
  return patron(F, { hs, hc, ...o });
}

/** Ombres habituelles : grand S du dos, plis des bras, coudes si manche longue. */
function ombres(P, { coudes = false, pli = true } = {}) {
  const r = [...D.ombreDos(P)];
  if (pli) r.push(...D.ombresPli(P));
  void coudes; // les pièces d'origine n'ont pas d'ombre de coude
  return r;
}

function couture(points, w = 3) {
  // fine ombre le long d'une ligne (couture d'empiècement, fente)
  const a = [], b = [];
  for (let k = 0; k < points.length; k++) {
    const p = points[Math.max(0, k - 1)], q = points[Math.min(points.length - 1, k + 1)];
    let nx = -(q[1] - p[1]), ny = q[0] - p[0]; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    a.push([points[k][0] + nx * w / 2, points[k][1] + ny * w / 2]);
    b.push([points[k][0] - nx * w / 2, points[k][1] - ny * w / 2]);
  }
  return [...a, ...b.reverse()];
}

/** Coutures horizontales et gonflant d'une doudoune. */
function doudoune(F, o = {}) {
  const pasC = { femme: 46, homme: 46, enfant: 38, ado: 44 }[F.nom];
  const y0 = F.enc + 30;
  const bombe = (y) => (y < y0 ? 0 : 5 * Math.sin(Math.PI * (((y - y0) % pasC) / pasC)));
  const [hs, hc] = { femme: [790, 806], homme: [752, 768], enfant: [708, 720], ado: [720, 736] }[F.nom];
  const P = patron(F, { manche: "longue", marge: 3.5, bombe, hs, hc, colHaut: F.encSide - (F.nom === "enfant" ? 12 : 16), margeCou: 4, ...o });
  const coutures = [];
  for (let y = y0; y < hs - 12; y += pasC) { const r = bandeY(P.contour, y - 3, y + 3); if (r) coutures.push(r); }
  return { P, coutures, bombe };
}

const nuance = "nuance";

// ---------- le catalogue ----------

export const CATALOGUE = [
  // ===================== FEMME =====================
  { famille: "femme", nom: "t-shirt", titre: "T-shirt", fabrique(F) {
    const P = base(F, { manche: "courte" });
    return { P, st0: [P.contour], st2: D.croissantCol(P), st1: ombres(P),
      zones: { st0: ["#CD6122", "Tissu", "principale"], st2: [nuance, "Tissu"] } };
  } },
  { famille: "femme", nom: "t-shirt-raye", titre: "T-shirt rayé", fabrique(F) {
    const P = base(F, { manche: "courte" });
    return { P, st0: [P.contour], st2: D.croissantCol(P), st3: D.rayures(P, { y0: 404, y1: 800, periode: 30, epais: 11 }), st1: ombres(P),
      zones: { st0: ["#FAFAFA", "Tissu", "principale"], st2: [nuance, "Tissu"], st3: ["#0056AF", "Rayures", "partie"] } };
  } },
  { famille: "femme", nom: "debardeur", titre: "Débardeur", fabrique(F) {
    const P = base(F, { manche: "aucune", bretelle: 62, hs: 790, hc: 816 });
    return { P, st0: [P.contour], st2: [...D.bordEmmanchure(P, 7), ...D.bandeCol(P, 7)], st1: ombres(P),
      zones: { st0: ["#FF96BF", "Tissu", "principale"], st2: [nuance, "Tissu"] } };
  } },
  { famille: "femme", nom: "chemisier", titre: "Chemisier col Claudine", fabrique(F) {
    const P = base(F, { manche: "longue" });
    const col = D.colClaudine(P, 34);
    return { P, st0: [P.contour], st2: D.poignets(P, 14), st3: col, st1: [...ombres(P, { coudes: true }), ...D.ombreSousCol(col, 0).map((p) => bandeY(p, P.nc + 10, null, P.neckY)).filter(Boolean)],
      zones: { st0: ["#82C3F4", "Tissu", "principale"], st2: [nuance, "Tissu"], st3: ["#FAFAFA", "Col", "partie"] } };
  } },
  { famille: "femme", nom: "pull-col-rond", titre: "Pull col rond", fabrique(F) {
    const P = base(F, { manche: "longue" });
    return { P, st0: [P.contour], st2: [...D.bandeCol(P, 8), ...D.coteOurlet(P, 16), ...D.poignets(P, 16)], st1: ombres(P, { coudes: true }),
      zones: { st0: ["#2A5E21", "Tricot", "principale"], st2: [nuance, "Tricot"] } };
  } },
  { famille: "femme", nom: "pull-col-roule", titre: "Pull col roulé", fabrique(F) {
    const P = base(F, { manche: "longue", colHaut: 342, margeCou: 4 });
    const roule = bandeY(P.contour, null, F.encSide + 8);
    const pli = bandeY(P.contour, 352, 356);
    return { P, st0: [P.contour], st2: [roule, ...D.coteOurlet(P, 16), ...D.poignets(P, 16)].filter(Boolean), st1: [...ombres(P, { coudes: true }), pli].filter(Boolean),
      zones: { st0: ["#E8B71C", "Tricot", "principale"], st2: [nuance, "Tricot"] } };
  } },
  { famille: "femme", nom: "sweat-capuche", titre: "Sweat à capuche", fabrique(F) {
    const P = base(F, { manche: "longue" });
    const C = D.capuche(P, { demiCou: 44, demi: 74, haut: 82 });
    return { P, st0: [P.contour, ...C.forme], st2: [...D.coteOurlet(P, 16), ...D.poignets(P, 16)], st3: C.ouverture, st1: [...ombres(P, { coudes: true }), ...C.ombre, ...C.pli],
      zones: { st0: ["#6D7090", "Tissu", "principale"], st2: [nuance, "Tissu"], st3: ["#FFC7D0", "Doublure", "partie"] } };
  } },
  { famille: "femme", nom: "gilet-boutonne", titre: "Gilet boutonné", fabrique(F) {
    const P = base(F, { manche: "longue" });
    return { P, st0: [P.contour], st2: [...D.bandeCol(P, 9), ...D.coteOurlet(P, 18), ...D.poignets(P, 18)], st4: D.coudieres(P), st1: ombres(P, { coudes: true }),
      zones: { st0: ["#E4AF73", "Tricot", "principale"], st2: [nuance, "Tricot"], st4: ["#194F6D", "Coudières", "detail"] },
      notes: "De dos, les boutons ne se voient pas : le gilet se reconnaît à ses côtes et à ses coudières." };
  } },
  { famille: "femme", nom: "robe-longue", titre: "Robe longue", debord: 13, fabrique(F) {
    const [hs, hc] = OURLET_LONG.femme;
    const P = patron(F, { manche: "courte", robe: true, limRobe: 867, hs, hc, evase: (y) => (y > 860 ? (y - 860) * 0.5 : 0) });
    return { P, st0: [P.contour], st2: D.croissantCol(P), st3: D.ceinture(P, 716, 15), st1: ombres(P),
      zones: { st0: ["#BD1212", "Tissu", "principale"], st2: [nuance, "Tissu"], st3: ["#273252", "Ceinture", "partie"] },
      notes: "Descend jusqu'à l'assise et cache le bas, c'est voulu. Le bas de la jupe s'étale sur l'assise : jusqu'à 13 px hors de l'enveloppe des corps." };
  } },
  { famille: "femme", nom: "tunique", titre: "Tunique brodée", debord: 13, fabrique(F) {
    const [hs, hc] = OURLET_LONG.femme;
    const P = patron(F, { manche: "34", ys34: 640, robe: true, limRobe: 866, hs: hs - 3, hc: hc - 3, evase: (y) => (y > 860 ? (y - 860) * 0.4 : 0) });
    return { P, st0: [P.contour], st2: D.poignets(P, 12), st3: D.empiecement(P, 32, 9), st1: ombres(P),
      zones: { st0: ["#9EDFBF", "Tissu", "principale"], st2: [nuance, "Tissu"], st3: ["#194F6D", "Broderie", "partie"] },
      notes: "Manches trois-quarts : l'avant-bras reste nu. Descend jusqu'à l'assise et s'étale un peu dessus (jusqu'à 13 px hors de l'enveloppe)." };
  } },
  { famille: "femme", nom: "doudoune", titre: "Doudoune", debord: 25, fabrique(F) {
    const { P, coutures } = doudoune(F);
    return { P, st0: [P.contour], st2: [...coutures, ...D.poignets(P, 10)], st1: ombres(P, { coudes: true }),
      zones: { st0: ["#194F6D", "Tissu", "principale"], st2: [nuance, "Tissu"] } };
  } },
  { famille: "femme", nom: "manteau", titre: "Manteau", debord: 25, fabrique(F) {
    const P = base(F, { manche: "longue", marge: 4.5, hs: 842, hc: 852, colHaut: F.encSide - 14, margeCou: 4 });
    const col = bandeY(P.contour, null, F.encSide + 12);
    const mart = D.ceinture(P, 722, 16, { x0: 190, x1: 310 });
    const boutons = [ellipse(198, 730, 5, 5, 16), ellipse(302, 730, 5, 5, 16)];
    const fente = [[249, 800], [251, 800], [256, 850], [244, 850]];
    return { P, st0: [P.contour], st2: D.poignets(P, 15), st3: [col, ...mart].filter(Boolean), st4: boutons, st1: [...ombres(P, { coudes: true }), fente, ...D.ombreSousCol([col].filter(Boolean), 6).map((p) => bandeY(p, F.encSide + 12, null)).filter(Boolean)],
      zones: { st0: ["#B8551D", "Tissu", "principale"], st2: [nuance, "Tissu"], st3: ["#273252", "Col et martingale", "partie"], st4: ["#F6D994", "Boutons", "detail"] } };
  } },

  // ===================== HOMME =====================
  { famille: "homme", nom: "t-shirt", titre: "T-shirt", fabrique(F) {
    const P = base(F, { manche: "courte" });
    return { P, st0: [P.contour], st2: D.croissantCol(P), st1: ombres(P),
      zones: { st0: ["#194F6D", "Tissu", "principale"], st2: [nuance, "Tissu"] } };
  } },
  { famille: "homme", nom: "t-shirt-raye", titre: "T-shirt rayé", fabrique(F) {
    const P = base(F, { manche: "courte" });
    return { P, st0: [P.contour], st2: D.croissantCol(P), st3: D.rayures(P, { y0: 392, y1: 760, periode: 36, epais: 14 }), st1: ombres(P),
      zones: { st0: ["#273252", "Tissu", "principale"], st2: [nuance, "Tissu"], st3: ["#F6D994", "Rayures", "partie"] } };
  } },
  { famille: "homme", nom: "debardeur", titre: "Débardeur", fabrique(F) {
    const P = base(F, { manche: "aucune", bretelle: 58 });
    return { P, st0: [P.contour], st2: [...D.bordEmmanchure(P, 7), ...D.bandeCol(P, 7)], st1: ombres(P),
      zones: { st0: ["#FAFAFA", "Tissu", "principale"], st2: [nuance, "Tissu"] } };
  } },
  { famille: "homme", nom: "chemise", titre: "Chemise", fabrique(F) {
    const P = base(F, { manche: "longue" });
    const col = D.colMontant(P, 13);
    const yoke = catmull([[P.G.ext(430) + 4, 432], [180, 440], [250, 444], [320, 440], [P.D.ext(430) - 4, 432]], 10);
    const pli = [[246, 446], [254, 446], [258, 500], [242, 500]];
    return { P, st0: [P.contour], st3: [...col, ...D.poignets(P, 15)], st1: [...ombres(P, { coudes: true }), couture(yoke, 3), pli],
      zones: { st0: ["#82C3F4", "Tissu", "principale"], st3: ["#FAFAFA", "Col et poignets", "partie"] } };
  } },
  { famille: "homme", nom: "chemise-carreaux", titre: "Chemise à carreaux", fabrique(F) {
    const P = base(F, { manche: "courte" });
    const col = D.colMontant(P, 12);
    const c = [...D.rayures(P, { y0: 384, y1: 770, periode: 34, epais: 9 }), ...D.bandesVerticales(P, { x0: 31, x1: 470, periode: 34, epais: 9, y0: P.nc + 2 })];
    return { P, st0: [P.contour], st2: col, st3: c, st1: ombres(P),
      zones: { st0: ["#BD1212", "Tissu", "principale"], st2: [nuance, "Tissu"], st3: ["#273252", "Carreaux", "partie"] } };
  } },
  { famille: "homme", nom: "pull-col-rond", titre: "Pull col rond", fabrique(F) {
    const P = base(F, { manche: "longue" });
    return { P, st0: [P.contour], st2: [...D.bandeCol(P, 9), ...D.coteOurlet(P, 18), ...D.poignets(P, 16)], st1: ombres(P, { coudes: true }),
      zones: { st0: ["#6D7090", "Tricot", "principale"], st2: [nuance, "Tricot"] } };
  } },
  { famille: "homme", nom: "pull-col-v", titre: "Pull col V", fabrique(F) {
    const P = base(F, { manche: "longue" });
    return { P, st0: [P.contour], st2: [...D.coteOurlet(P, 18), ...D.poignets(P, 16)], st3: [...D.bandeCol(P, 6), ...D.bandeCol(P, 4, 9)], st1: ombres(P, { coudes: true }),
      zones: { st0: ["#2A5E21", "Tricot", "principale"], st2: [nuance, "Tricot"], st3: ["#FAFAFA", "Liseré du col", "partie"] },
      notes: "De dos, le V ne se voit pas : on le signale par le double liseré du col." };
  } },
  { famille: "homme", nom: "sweat-capuche", titre: "Sweat à capuche", fabrique(F) {
    const P = base(F, { manche: "longue" });
    const C = D.capuche(P, { demiCou: 46, demi: 80, haut: 90 });
    return { P, st0: [P.contour, ...C.forme], st2: [...D.coteOurlet(P, 18), ...D.poignets(P, 16), ...C.ouverture], st1: [...ombres(P, { coudes: true }), ...C.ombre, ...C.pli],
      zones: { st0: ["#E8B71C", "Tissu", "principale"], st2: [nuance, "Tissu"] } };
  } },
  { famille: "homme", nom: "gilet-boutonne", titre: "Gilet boutonné", fabrique(F) {
    const P = base(F, { manche: "longue" });
    return { P, st0: [P.contour], st2: [...D.bandeCol(P, 9), ...D.coteOurlet(P, 18), ...D.poignets(P, 18)], st4: D.coudieres(P, 13, 24), st1: ombres(P, { coudes: true }),
      zones: { st0: ["#C8E4D6", "Tricot", "principale"], st2: [nuance, "Tricot"], st4: ["#273252", "Coudières", "detail"] },
      notes: "De dos, les boutons ne se voient pas : le gilet se reconnaît à ses côtes et à ses coudières." };
  } },
  { famille: "homme", nom: "doudoune", titre: "Doudoune", debord: 25, fabrique(F) {
    const { P, coutures } = doudoune(F);
    return { P, st0: [P.contour], st2: [...coutures, ...D.poignets(P, 10)], st1: ombres(P, { coudes: true }),
      zones: { st0: ["#BD1212", "Tissu", "principale"], st2: [nuance, "Tissu"] } };
  } },
  { famille: "homme", nom: "manteau", titre: "Manteau", debord: 25, fabrique(F) {
    const P = base(F, { manche: "longue", marge: 4.5, hs: 796, hc: 812, colHaut: F.encSide - 14, margeCou: 4 });
    const col = bandeY(P.contour, null, F.encSide + 12);
    const mart = D.ceinture(P, 694, 16, { x0: 188, x1: 312 });
    const boutons = [ellipse(196, 702, 5, 5, 16), ellipse(304, 702, 5, 5, 16)];
    const fente = [[249, 752], [251, 752], [256, 808], [244, 808]];
    return { P, st0: [P.contour], st2: D.poignets(P, 15), st3: [col, ...mart].filter(Boolean), st4: boutons, st1: [...ombres(P, { coudes: true }), fente],
      zones: { st0: ["#273252", "Tissu", "principale"], st2: [nuance, "Tissu"], st3: ["#545454", "Col et martingale", "partie"], st4: ["#E4AF73", "Boutons", "detail"] } };
  } },
  { famille: "homme", nom: "veste", titre: "Veste", fabrique(F) {
    const P = base(F, { manche: "longue", marge: 2.5, hs: 766, hc: 784, colHaut: F.encSide - 10, margeCou: 3.5 });
    const col = bandeY(P.contour, null, F.encSide + 8);
    const fente = [[249, 730], [251, 730], [255, 780], [245, 780]];
    return { P, st0: [P.contour], st2: [col, ...D.poignets(P, 12)].filter(Boolean), st4: D.coudieres(P, 12, 22), st1: [...ombres(P, { coudes: true }), fente],
      zones: { st0: ["#B8551D", "Tissu", "principale"], st2: [nuance, "Tissu"], st4: ["#273252", "Coudières", "detail"] } };
  } },

  // ===================== ENFANT =====================
  { famille: "enfant", nom: "t-shirt", titre: "T-shirt raglan", fabrique(F) {
    const P = base(F, { manche: "courte" });
    return { P, st0: [P.contour], st2: D.croissantCol(P, 6), st3: raglan(P), st1: ombres(P),
      zones: { st0: ["#F2D08D", "Tissu", "principale"], st2: [nuance, "Tissu"], st3: ["#004946", "Manches", "partie"] } };
  } },
  { famille: "enfant", nom: "t-shirt-raye", titre: "T-shirt rayé", fabrique(F) {
    const P = base(F, { manche: "courte" });
    return { P, st0: [P.contour], st2: D.croissantCol(P, 6), st3: D.rayures(P, { y0: 470, y1: 720, periode: 26, epais: 10 }), st1: ombres(P),
      zones: { st0: ["#FFC7D0", "Tissu", "principale"], st2: [nuance, "Tissu"], st3: ["#BD1212", "Rayures", "partie"] } };
  } },
  { famille: "enfant", nom: "pull", titre: "Pull à empiècement", fabrique(F) {
    const P = base(F, { manche: "longue" });
    const emp = bandeY(P.contour, null, 30, (x) => P.neckY(Math.max(P.xg, Math.min(P.xd, x))) + 44 - 0.0 * x);
    return { P, st0: [P.contour], st2: [...D.bandeCol(P, 7), ...D.coteOurlet(P, 13), ...D.poignets(P, 12)], st3: [emp].filter(Boolean), st1: ombres(P, { coudes: true }),
      zones: { st0: ["#0056AF", "Tricot", "principale"], st2: [nuance, "Tricot"], st3: ["#FAFAFA", "Empiècement", "partie"] } };
  } },
  { famille: "enfant", nom: "sweat-capuche", titre: "Sweat à capuche", fabrique(F) {
    const P = base(F, { manche: "longue" });
    const C = D.capuche(P, { demiCou: 38, demi: 62, haut: 66 });
    return { P, st0: [P.contour, ...C.forme], st2: [...D.coteOurlet(P, 13), ...D.poignets(P, 12)], st3: C.ouverture, st1: [...ombres(P, { coudes: true }), ...C.ombre, ...C.pli],
      zones: { st0: ["#9EDFBF", "Tissu", "principale"], st2: [nuance, "Tissu"], st3: ["#E8B71C", "Doublure", "partie"] } };
  } },
  { famille: "enfant", nom: "robe", titre: "Robe", debord: 13, fabrique(F) {
    const [hs, hc] = OURLET_LONG.enfant;
    const P = patron(F, { manche: "courte", ys: 548, robe: true, limRobe: 770, hs, hc, evase: (y) => (y > 766 ? (y - 766) * 0.5 : 0) });
    return { P, st0: [P.contour], st2: D.croissantCol(P, 6), st3: D.ceinture(P, 656, 13), st1: ombres(P),
      zones: { st0: ["#FF96BF", "Tissu", "principale"], st2: [nuance, "Tissu"], st3: ["#FAFAFA", "Ceinture", "partie"] },
      notes: "Descend jusqu'à l'assise et cache le bas, c'est voulu. Le bas de la jupe s'étale sur l'assise : jusqu'à 13 px hors de l'enveloppe des corps." };
  } },
  { famille: "enfant", nom: "salopette-haut", titre: "Salopette (haut) et t-shirt", fabrique(F) {
    const P = base(F, { manche: "courte" });
    const yb = 600;
    const bavette = bandeX(bandeY(P.contour, yb, null, (x) => -0.0 * x) ?? [], P.G.torse(650) + 10 - 0, P.D.torse(650) - 10);
    const bret = [[-1, 1], [1, -1]].map(([s, t]) => {
      const a = [F.cx + s * 44, yb + 4], b = [F.cx + t * 52, F.enc + 6];
      return couture(catmull([a, [(a[0] + b[0]) / 2 + s * 6, (a[1] + b[1]) / 2], b], 8), 15);
    });
    const boutons = [ellipse(F.cx - 44, yb + 10, 6, 6, 16), ellipse(F.cx + 44, yb + 10, 6, 6, 16)];
    return { P, st0: [P.contour], st2: D.croissantCol(P, 6), st3: [bavette, ...bret].filter((p) => p && p.length), st4: boutons, st1: [...ombres(P), ...bret.map((p) => p.map(([x, y]) => [x + 3, y + 3]))].filter(Boolean),
      zones: { st0: ["#FAFAFA", "T-shirt", "principale"], st2: [nuance, "T-shirt"], st3: ["#5E9ABF", "Salopette", "partie"], st4: ["#E8B71C", "Boutons", "detail"] },
      notes: "Le t-shirt dessous est compris dans la pièce, pour qu'il n'y ait jamais de peau entre les bretelles." };
  } },
  { famille: "enfant", nom: "doudoune", titre: "Doudoune", debord: 25, fabrique(F) {
    const { P, coutures } = doudoune(F);
    return { P, st0: [P.contour], st2: [...coutures, ...D.poignets(P, 9)], st1: ombres(P, { coudes: true }),
      zones: { st0: ["#E8B71C", "Tissu", "principale"], st2: [nuance, "Tissu"] } };
  } },
  { famille: "enfant", nom: "mariniere", titre: "Marinière", fabrique(F) {
    const P = base(F, { manche: "longue", nc: F.enc - 2 });
    return { P, st0: [P.contour], st2: D.croissantCol(P, 5), st3: D.rayures(P, { y0: 474, y1: 712, periode: 22, epais: 9 }), st1: ombres(P, { coudes: true }),
      zones: { st0: ["#FAFAFA", "Tissu", "principale"], st2: [nuance, "Tissu"], st3: ["#194F6D", "Rayures", "partie"] } };
  } },

  // ===================== ADO =====================
  { famille: "ado", nom: "t-shirt", titre: "T-shirt", fabrique(F) {
    const P = base(F, { manche: "courte", cxCol: F.cx });
    return { P, st0: [P.contour], st2: D.croissantCol(P), st1: ombres(P),
      zones: { st0: ["#2A5E21", "Tissu", "principale"], st2: [nuance, "Tissu"] } };
  } },
  { famille: "ado", nom: "sweat-capuche", titre: "Sweat à capuche", fabrique(F) {
    const P = base(F, { manche: "longue", cxCol: F.cx });
    const C = D.capuche(P, { demiCou: 40, demi: 70, haut: 80 });
    const bandes = [P.G, P.D].flatMap((Cc) => {
      const r = Cc === P.G ? bandeX(P.contour, null, 0, (y) => Cc.torse(y) - 14) : bandeX(P.contour, 0, null, (y) => Cc.torse(y) + 14);
      if (!r) return [];
      return [bandeY(r, 540, 552), bandeY(r, 560, 572)].filter(Boolean);
    });
    return { P, st0: [P.contour, ...C.forme], st2: [...D.coteOurlet(P, 15), ...D.poignets(P, 14), ...C.ouverture], st3: bandes, st1: [...ombres(P, { coudes: true }), ...C.ombre, ...C.pli],
      zones: { st0: ["#273252", "Tissu", "principale"], st2: [nuance, "Tissu"], st3: ["#FAFAFA", "Bandes", "partie"] } };
  } },
  { famille: "ado", nom: "chemise", titre: "Chemisette", fabrique(F) {
    const P = base(F, { manche: "courte", cxCol: F.cx });
    const col = D.colMontant(P, 12);
    const yoke = catmull([[P.G.ext(440) + 4, 442], [200, 450], [276, 454], [352, 450], [P.D.ext(440) - 4, 442]], 10);
    return { P, st0: [P.contour], st3: col, st1: [...ombres(P), couture(yoke, 3)],
      zones: { st0: ["#E4AF73", "Tissu", "principale"], st3: ["#194F6D", "Col", "partie"] } };
  } },
  { famille: "ado", nom: "debardeur", titre: "Débardeur de sport", fabrique(F) {
    const P = base(F, { manche: "aucune", bretelle: 56, cxCol: F.cx });
    return { P, st0: [P.contour], st3: [...D.bordEmmanchure(P, 8), ...D.bandeCol(P, 8)], st1: ombres(P),
      zones: { st0: ["#0056AF", "Tissu", "principale"], st3: ["#FAFAFA", "Bordures", "partie"] } };
  } },
  { famille: "ado", nom: "doudoune", titre: "Doudoune", debord: 25, fabrique(F) {
    const { P, coutures } = doudoune(F, { cxCol: F.cx });
    return { P, st0: [P.contour], st2: [...coutures, ...D.poignets(P, 10)], st1: ombres(P, { coudes: true }),
      zones: { st0: ["#82C3F4", "Tissu", "principale"], st2: [nuance, "Tissu"] } };
  } },
  { famille: "ado", nom: "maillot-sport", titre: "Maillot de sport", fabrique(F) {
    const P = base(F, { manche: "courte", cxCol: F.cx });
    const cx = F.cx, y0 = 486, h = 74;
    const un = rectArrondi(cx - 40, y0, cx - 24, y0 + h, 4);
    const ext = rectArrondi(cx - 12, y0, cx + 40, y0 + h, 14);
    const int = rectArrondi(cx + 3, y0 + 15, cx + 25, y0 + h - 15, 6).reverse();
    return { P, st0: [P.contour], st2: D.croissantCol(P), st3: [...raglan(P), ...D.bandeCol(P, 7)], st4: [un, [...ext, ext[0], ...int, int[0]]], st1: ombres(P),
      zones: { st0: ["#FAFAFA", "Tissu", "principale"], st2: [nuance, "Tissu"], st3: ["#BD1212", "Manches", "partie"], st4: ["#273252", "Numéro", "partie"] } };
  } },
  { famille: "ado", nom: "pull", titre: "Pull à bande", fabrique(F) {
    const P = base(F, { manche: "longue", cxCol: F.cx });
    return { P, st0: [P.contour], st2: [...D.bandeCol(P, 8), ...D.coteOurlet(P, 15), ...D.poignets(P, 14)], st3: D.rayures(P, { y0: 476, y1: 520, periode: 40, epais: 22 }), st1: ombres(P, { coudes: true }),
      zones: { st0: ["#BD1212", "Tricot", "principale"], st2: [nuance, "Tricot"], st3: ["#FAFAFA", "Bande", "partie"] } };
  } },
];

/** Manches raglan : de l'encolure jusqu'à l'aisselle, en biais. */
function raglan(P) {
  const F = P.F, out = [];
  for (const C of [P.G, P.D]) {
    const s = C === P.G ? -1 : 1;
    const xn = s < 0 ? P.xg + 16 : P.xd - 16;
    const ya = F.aisselle + 6, xa = C.torse(ya);
    const h = (y) => (y <= P.ns ? xn : y >= ya ? C.torse(y) : xn + (xa - xn) * Math.pow((y - P.ns) / (ya - P.ns), 0.8));
    let r = s < 0 ? bandeX(P.contour, null, 0, h) : bandeX(P.contour, 0, null, h);
    if (r) r = bandeY(r, null, C.ys + 0.5);
    if (r) out.push(r);
  }
  return out;
}
