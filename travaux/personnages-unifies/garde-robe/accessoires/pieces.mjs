// Accessoires de dos sur gabarits (27/11). Alexandra : « on doit pouvoir changer la peau, les
// fringues, accessoires etc ». Chaque accessoire est dessiné UNE fois par famille et tombe juste sur
// tous les gabarits de la famille : la tête et le cou y sont identiques au pixel près, et pour le dos
// (sacs, bretelles, châle) on reste dans l'intersection des corps de la famille.
//
// Pièces de tête : dessinées dans le repère tête (u, v) de la femme, posées par X = cx + u·s, Y = top + v·s.
// Autres pièces : directement en pixels du cadre 500 × 1000.
import { P, sym, forme, poly, ellipse, festons, ombre, meche, bande, croissant, transforme, nuance } from "./geo.mjs";

// ---------------------------------------------------------------------------------------------
// Familles
// ---------------------------------------------------------------------------------------------
export const FAMILLES = {
  femme: { cx: 250, top: 178.4, s: 1, prefixe: "Female", origine: "Female_2.svg", cheveux: "Female_Hair_2",
    gabarits: ["gabarit-dos-femme-standard-v2.svg", "gabarit-dos-femme-fine.svg", "gabarit-dos-femme-ronde.svg", "gabarit-dos-femme-agee.svg"],
    // bras et mains : pixels du corps hors du couloir du dos, sous l'aisselle
    bras: { y: [590, 765], x: [152, 348] }, assise: 875 },
  homme: { cx: 250.1, top: 161, s: 0.983, prefixe: "Male", origine: "Male_2.svg", cheveux: "Male_Hair_2",
    gabarits: ["gabarit-dos-homme-standard-v2.svg", "gabarit-dos-homme-mince.svg", "gabarit-dos-homme-rond.svg", "gabarit-dos-homme-age.svg"],
    bras: { y: [600, 856], x: [145, 355] }, assise: 865 },
  enfant: { cx: 250, top: 256.9, s: 1, prefixe: "Boy", origine: "Boys_2.svg", cheveux: "Boy_Hair_2",
    gabarits: ["gabarit-dos-enfant-standard-v2.svg", "gabarit-dos-enfant-fin.svg", "gabarit-dos-enfant-rond.svg"],
    bras: { y: [560, 705], x: [160, 340] }, assise: 778 },
  ado: { cx: 275.7, top: 189.6, s: 0.883, prefixe: "Teenage_Boy", origine: "Teenage_Boys_1.svg", cheveux: "Teenage_Boy_Hair_1",
    gabarits: ["gabarit-dos-ado-standard-v2.svg", "gabarit-dos-ado-fin.svg"],
    bras: { y: [560, 805], x: [178, 372] }, assise: 821 },
  cheval: { prefixe: "Horse", gabarits: ["gabarit-dos-cheval-debout.svg"], animal: true, assise: 874 },
  chat: { prefixe: "Cat", gabarits: ["gabarit-dos-chat.svg"], animal: true, assise: 624 },
  lapin: { prefixe: "Rabbit", gabarits: ["gabarit-dos-lapin.svg"], animal: true, assise: 625 },
};
for (const F of Object.values(FAMILLES)) if (!F.animal) F.t = (u, v) => [F.cx + u * F.s, F.top + v * F.s];

/** Demi-largeur du contour de tête de référence (contrat coiffures / couvre-chefs). */
export function demi(v) {
  const L = [[0, 0], [13, 46], [26, 59], [46, 68], [63, 70]];
  if (v <= 0) return 0;
  if (v >= 63) return 70;
  for (let k = 1; k < L.length; k++) if (v <= L[k][0]) { const [v0, d0] = L[k - 1], [v1, d1] = L[k]; return d0 + ((v - v0) / (v1 - v0)) * (d1 - d0); }
  return 70;
}

// ---------------------------------------------------------------------------------------------
// Couleurs par défaut (accessoires actuels pour les classiques, nouveautés de la consigne)
// ---------------------------------------------------------------------------------------------
const K = {
  bob: "#3C584F", casque: "#107CDD", casquette: "#194F6D", foulard: "#E03270", serreTete: "#E2C447", bonnet: "#1D4912",
  paille: "#CE9D21", rubanRouge: "#D81919", chapeauBord: "#B27A38", beretMarin: "#192E37", canne: "#6B3E1E", perles: "#F4F3F2",
  lunettes: "#24222C", grelot: "#E7B033", blanc: "#FAFAFA", rouge: "#BD1212", bleu: "#0056AF", rose: "#FF96BF", menthe: "#9EDFBF",
  rouille: "#B8551D", orange: "#CD6122", vert: "#2A5E21", petrole: "#194F6D", sable: "#E4AF73", ardoise: "#6D7090", creme: "#F6D994",
  ciel: "#82C3F4", poudre: "#FFC7D0", moutarde: "#E8B71C", marine: "#273252", noir: "#000000", gris: "#A7A39C",
};

// zones : z(principale) puis parties ; la nuance est calculée (même teinte, plus sombre)
const Z = {
  p: (couleur, groupe) => ({ couleur, groupe, role: "principale" }),
  n: (de, ref, dl = 0.14) => ({ couleur: nuance(ref.couleur, dl), groupe: ref.groupe, role: "nuance", de }),
  part: (couleur, groupe) => ({ couleur, groupe, role: "partie" }),
  det: (couleur, groupe) => ({ couleur, groupe, role: "detail" }),
};
function zones(st0, autres = {}) {
  const z = { st0 };
  for (const [k, v] of Object.entries(autres)) z[k] = typeof v === "function" ? v(st0) : v;
  return z;
}
const nuanceDe = (de = "st0", dl = 0.14) => (ref) => Z.n(de, ref, dl);

// ---------------------------------------------------------------------------------------------
// Outils de pose
// ---------------------------------------------------------------------------------------------
const tete = (F, segs) => transforme(segs, F.t);
const C = (cls, segs, extra = {}) => ({ cls, segs, ...extra });
const symF = (droite) => forme(sym(droite));
// ombre douce du côté droit d'un contour symétrique (arc de A à B, retour par l'intérieur, de B vers A)
const ombreD = (f, A, B, retour) => ombre(f, A, B, retour);

// arc inférieur d'une ellipse, en croissant (épaisseur du bord vue de dos)
function croissantBas(cv, ru, rv, ep, n = 14) {
  const ext = [], int = [];
  for (let k = 0; k <= n; k++) { const a = (k / n) * Math.PI; ext.push(P(ru * Math.cos(a), cv + rv * Math.sin(a), k === 0 || k === n)); }
  for (let k = n - 1; k >= 1; k--) { const a = (k / n) * Math.PI; int.push(P((ru - ep * 0.9) * Math.cos(a), cv + ep * 0.3 + (rv - ep) * Math.sin(a))); }
  return forme([...ext, ...int]);
}
// ombre portée d'une calotte sur le bord du chapeau : croissant sous la ligne de la calotte
function ombrePortee(u0, v0, vmilieu, ep) {
  return forme([P(-u0, v0, true), P(-u0 * 0.55, v0 + 6), P(0, vmilieu), P(u0 * 0.55, v0 + 6), P(u0, v0, true), P(u0 * 0.75, v0 + ep * 0.7), P(0, vmilieu + ep), P(-u0 * 0.75, v0 + ep * 0.7)]);
}
// ombre du côté droit d'une ellipse (bord de chapeau)
function ombreBordDroit(cv, ru, rv) {
  const f = ellipse(0, cv, ru, rv, 16);
  return ombre(f, [ru * 0.7, cv - rv * 0.7], [ru * 0.7, cv + rv * 0.7], [[ru * 0.62, cv + rv * 0.3], [ru * 0.6, cv - rv * 0.2]]);
}

// ---------------------------------------------------------------------------------------------
// COUVRE-CHEFS (repère tête). bord = bas de la calotte contractuelle couverte.
// ---------------------------------------------------------------------------------------------
function chapeauPaille({ ru = 132, rv = 30, cv = 46 } = {}) {
  return (F) => {
    const bord = ellipse(0, cv, ru, rv, 18);
    const dessous = croissantBas(cv, ru, rv, 9);
    const cal = symF([P(0, -40), P(40, -38), P(66, -26), P(80, -4), P(86, 22), P(88, 42, true), P(50, 48), P(0, 50)]);
    const ruban = symF([P(0, 24), P(45, 23), P(85.5, 18, true), P(87.8, 37, true), P(45, 40), P(0, 41)]);
    return [
      C("st0", tete(F, bord.segs)), C("st0", tete(F, cal.segs)),
      C("st2", tete(F, dessous.segs)), C("st3", tete(F, ruban.segs)),
      C("st1", tete(F, ombrePortee(88, 44, 52, 9).segs)),
      C("st1", tete(F, ombreD(cal, [40, -38], [50, 48], [[56, 22], [54, -6], [44, -32]]))),
      C("st1", tete(F, ombreBordDroit(cv, ru, rv))),
      C("st1", tete(F, meche([[-34, -30], [-40, -8], [-38, 14]], 3))),
    ];
  };
}

function capeline(F) {
  const cv = 48, ru = 150, rv = 36;
  const bord = forme(festons(ellipse(0, cv, ru, rv, 20).pts, 9, 3.5, 0.6));
  const dessous = croissantBas(cv + 2, ru - 2, rv - 1, 10, 18);
  const cal = symF([P(0, -36), P(40, -34), P(64, -22), P(80, 0), P(86, 24), P(88, 44, true), P(50, 50), P(0, 52)]);
  const ruban = symF([P(0, 22), P(45, 21), P(85, 15, true), P(88, 40, true), P(45, 44), P(0, 45)]);
  // nœud du ruban, sur le côté droit, avec deux pans qui tombent sur le bord
  const boucleH = forme([P(64, 28, true), P(84, 12), P(106, 14), P(108, 30), P(88, 38)]);
  const boucleB = forme([P(64, 32, true), P(86, 34), P(104, 46), P(96, 56), P(78, 46)]);
  const pan1 = forme([P(70, 34, true), P(80, 52), P(90, 76, true), P(80, 74), P(66, 40)]);
  const noeud = ellipse(68, 31, 8, 8, 10);
  return [
    C("st0", tete(F, bord.segs)), C("st0", tete(F, cal.segs)),
    C("st2", tete(F, dessous.segs)),
    C("st3", tete(F, ruban.segs)), C("st3", tete(F, pan1.segs)), C("st3", tete(F, boucleB.segs)), C("st3", tete(F, boucleH.segs)), C("st3", tete(F, noeud.segs)),
    C("st1", tete(F, ombrePortee(88, 46, 54, 10).segs)),
    C("st1", tete(F, ombreD(cal, [40, -34], [50, 50], [[54, 24], [52, -4], [44, -28]]))),
    C("st1", tete(F, ombreBordDroit(cv, ru, rv))),
    C("st1", tete(F, meche([[70, 36], [84, 44], [98, 50]], 3))),
  ];
}

function bob(F) {
  const bordF = symF([P(0, 40), P(60, 38), P(88, 33, true), P(106, 50), P(120, 70, true), P(84, 81), P(42, 85), P(0, 86)]);
  const cal = symF([P(0, -36), P(38, -34), P(64, -24), P(78, -2), P(84, 24), P(88, 42, true), P(50, 46), P(0, 47)]);
  const couture = symF([P(0, 37), P(50, 36), P(87, 32, true), P(88.5, 42, true), P(50, 46), P(0, 47)]);
  const piqure = forme([...Array.from({ length: 13 }, (_, k) => { const a = Math.PI * (k / 12); return P(104 * Math.cos(a), 62 + 14 * Math.sin(a), k === 0 || k === 12); }),
    ...Array.from({ length: 11 }, (_, k) => { const a = Math.PI * ((11 - k) / 12); return P(98 * Math.cos(a), 63 + 10 * Math.sin(a)); })]);
  return [
    C("st0", tete(F, bordF.segs)), C("st0", tete(F, cal.segs)),
    C("st2", tete(F, couture.segs)), C("st2", tete(F, piqure.segs)),
    C("st1", tete(F, ombreD(cal, [38, -34], [50, 46], [[54, 22], [52, -4], [44, -28]]))),
    C("st1", tete(F, ombreD(bordF, [88, 33], [42, 85], [[60, 70], [82, 54]]))),
    C("st1", tete(F, meche([[-36, -28], [-44, -4], [-44, 20]], 3))),
  ];
}

function bonnetBase() {
  const dome = symF([P(0, -36), P(34, -33), P(62, -20), P(82, 2), P(92, 28), P(94, 50), P(94, 58, true), P(70, 66), P(36, 70), P(0, 71)]);
  const revers = symF([P(0, 38), P(36, 37), P(70, 33), P(94, 30, true), P(94, 58, true), P(70, 66), P(36, 70), P(0, 71)]);
  return { dome, revers };
}
function bonnet({ pompon = false, oreilles = false } = {}) {
  return (F) => {
    const { dome, revers } = bonnetBase();
    const out = [C("st0", tete(F, dome.segs)), C("st2", tete(F, revers.segs))];
    const ombres = [
      C("st1", tete(F, ombreD(dome, [34, -33], [94, 30], [[66, 28], [58, 0], [44, -26]]))),
      C("st1", tete(F, ombreD(revers, [94, 30], [36, 70], [[62, 56], [80, 40]]))),
      C("st1", tete(F, meche([[-30, -26], [-40, 0], [-42, 30]], 3))),
      C("st1", tete(F, meche([[10, -30], [12, 0], [12, 30]], 2.5))),
    ];
    // côtes du revers : bandes de 7 px
    for (const u of [-60, -32, -4, 24]) ombres.push(C("st1", tete(F, poly([[u, 42], [u + 7, 42], [u + 7, 64], [u, 64]]).segs)));
    if (oreilles) {
      for (const c of [-1, 1]) {
        const rabat = forme([P(c * 62, 56, true), P(c * 92, 54, true), P(c * 92, 92), P(c * 82, 124), P(c * 70, 130, true), P(c * 62, 110), P(c * 60, 80)]);
        out.unshift(C("st0", tete(F, rabat.segs)));
        out.push(C("st3", tete(F, bande([[c * 74, 126], [c * 76, 150], [c * 72, 176]], 6).segs)));
        out.push(C("st3", tete(F, ellipse(c * 72, 182, 8, 8, 10).segs)));
        if (c > 0) ombres.push(C("st1", tete(F, ombre(rabat, [92, 54], [70, 130], [[76, 110], [80, 70]]))));
      }
    }
    if (pompon || oreilles) {
      const pf = forme(festons(ellipse(0, -42, 22, 20, 12).pts, 9, 2.6, 0.4));
      out.push(C("st3", tete(F, pf.segs)));
      ombres.push(C("st1", tete(F, croissant(0, -42, 19))));
    }
    return [...out, ...ombres];
  };
}

function beret(F) {
  const disque = ellipse(8, 0, 106, 44, 18, -0.1);
  const bandeau = symF([P(0, 22), P(60, 20), P(86, 16, true), P(93, 47, true), P(60, 50), P(0, 51)]);
  const tige = poly([[0, -54], [7, -55], [8, -41], [-1, -40]]);
  // ombre portée de la galette sur le bandeau : croissant sous le bord de la galette
  const sous = forme([P(-85.5, 19, true), P(-60, 34), P(0, 47), P(60, 40), P(85.5, 19, true), P(89.5, 34), P(60, 49.5), P(0, 50.5), P(-60, 46), P(-89.5, 34)]);
  return [
    C("st0", tete(F, bandeau.segs)), C("st0", tete(F, disque.segs)), C("st0", tete(F, tige.segs)),
    C("st1", tete(F, sous.segs)),
    C("st1", tete(F, ombre(disque, [80, -34], [50, 40], [[60, 24], [84, 4], [96, -18]]))),
    C("st1", tete(F, meche([[-80, 8], [-30, 18], [30, 14]], 3))),
  ];
}

function casquette({ envers = false } = {}) {
  return (F) => {
    const droite = [P(0, -36), P(36, -34), P(62, -22), P(80, 0), P(90, 26), P(92, 48, true), P(56, 52)];
    const cal = envers ? symF([...droite, P(30, 54), P(0, 55)]) : symF([...droite, P(30, 54, true), P(27, 40), P(18, 28), P(0, 25)]);
    const couture = poly([[-3, -35], [3, -35], [3, envers ? 46 : 25], [-3, envers ? 46 : 25]]);
    const bouton = ellipse(0, -36, 7, 4.5, 10);
    const out = [C("st0", tete(F, cal.segs)), C("st2", tete(F, couture.segs)), C("st2", tete(F, bouton.segs))];
    const ombres = [C("st1", tete(F, ombreD(cal, [36, -34], [56, 52], [[60, 24], [56, -4], [44, -28]]))), C("st1", tete(F, meche([[-40, -26], [-52, 0], [-54, 30]], 3)))];
    if (envers) {
      const visiere = symF([P(0, 44), P(48, 42), P(72, 42, true), P(80, 56), P(66, 74), P(36, 82), P(0, 84)]);
      out.push(C("st3", tete(F, visiere.segs)));
      ombres.push(C("st1", tete(F, ombreD(visiere, [72, 42], [36, 82], [[48, 66], [62, 54]]))), C("st1", tete(F, poly([[-70, 42], [70, 42], [56, 49], [-56, 49]]).segs)));
    } else {
      const patte = forme([P(-32, 42, true), P(32, 42, true), P(33, 51, true), P(-33, 51, true)]);
      const boucle = poly([[8, 41], [17, 41], [17, 52], [8, 52]]);
      out.push(C("st3", tete(F, patte.segs)), C("st3", tete(F, boucle.segs)));
      ombres.push(C("st1", tete(F, poly([[-27, 34], [27, 34], [31, 42], [-31, 42]]).segs)));
    }
    return [...out, ...ombres];
  };
}

function casquettePlate(F) {
  const cal = symF([P(0, -32), P(40, -32), P(70, -26), P(88, -10), P(95, 14), P(95, 46, true), P(60, 50), P(0, 51)]);
  const bandeau = symF([P(0, 34), P(60, 32), P(95, 29, true), P(95, 46, true), P(60, 50), P(0, 51)]);
  const pli = meche([[-86, -6], [-40, -14], [20, -14], [80, -6]], 3);
  return [
    C("st0", tete(F, cal.segs)), C("st2", tete(F, bandeau.segs)),
    C("st1", tete(F, pli)),
    C("st1", tete(F, ombreD(cal, [40, -32], [95, 25], [[70, 18], [62, -10], [48, -28]]))),
    C("st1", tete(F, ombreD(bandeau, [95, 29], [60, 50], [[72, 40]]))),
  ];
}

function feutre({ panama = false } = {}) {
  return (F) => {
    const ru = panama ? 112 : 122, rv = panama ? 20 : 23, cv = 44;
    const bordF = ellipse(0, cv, ru, rv, 18);
    const rebord = croissantBas(cv, ru, rv, 7, 16);
    const cal = panama
      ? symF([P(0, -32), P(40, -33), P(66, -24), P(78, -2), P(84, 22), P(86, 40, true), P(50, 44), P(0, 45)])
      : symF([P(0, -32), P(18, -38), P(44, -40), P(66, -28), P(78, -4), P(84, 22), P(86, 40, true), P(50, 44), P(0, 45)]);
    const ruban = symF([P(0, 22), P(45, 21), P(83.5, 17, true), P(86, 38, true), P(45, 42), P(0, 43)]);
    const out = [C("st0", tete(F, bordF.segs)), C("st0", tete(F, cal.segs)), C("st2", tete(F, rebord.segs)), C("st3", tete(F, ruban.segs))];
    const ombres = [
      C("st1", tete(F, ombrePortee(86, 42, 48, 8).segs)),
      C("st1", tete(F, ombreD(cal, panama ? [40, -33] : [44, -40], [50, 44], [[56, 20], [54, -6], [46, -30]]))),
      C("st1", tete(F, ombreBordDroit(cv, ru, rv))),
    ];
    if (!panama) ombres.push(C("st1", tete(F, meche([[0, -32], [3, -16], [2, 2]], 4))));
    else ombres.push(C("st1", tete(F, meche([[-40, -28], [0, -24], [40, -28]], 2.5))));
    return [...out, ...ombres];
  };
}

function couronne(F) {
  // bonnet de velours (st0, la plus grande surface) qui bombe au-dessus d'un cercle d'or (st3) à pointes ;
  // l'or est peint après le velours, les plis du velours sont une nuance (st2)
  const velours = symF([P(0, -56), P(30, -54), P(56, -44), P(76, -24), P(88, 4), P(92, 30), P(92, 44, true), P(0, 46)]);
  const plis = [-55, -18, 18, 55].map((u) => meche([[u * 0.7, -42], [u * 0.95, -10], [u, 24]], 5));
  const bandeauOr = symF([P(0, 28), P(50, 29), P(91, 25, true), P(93, 46, true), P(50, 48), P(0, 49)]);
  const pointes = [];
  for (const u of [-74, -37, 0, 37, 74]) {
    const h = u === 0 ? -14 : Math.abs(u) < 50 ? -6 : 6;
    pointes.push(poly([[u - 11, 30], [u, h], [u + 11, 30]]));
    pointes.push(ellipse(u, h - 3, 5.5, 5.5, 10));
  }
  const pierres = [ellipse(-46, 38, 5.5, 5.5, 10), ellipse(0, 38.5, 6.5, 6.5, 10), ellipse(46, 38, 5.5, 5.5, 10)];
  return [
    C("st0", tete(F, velours.segs)),
    ...plis.map((sg) => C("st2", tete(F, sg))),
    C("st3", tete(F, bandeauOr.segs)), ...pointes.map((f) => C("st3", tete(F, f.segs))),
    ...pierres.map((f) => C("st4", tete(F, f.segs))),
    C("st1", tete(F, ombreD(velours, [30, -54], [92, 30], [[72, 10], [62, -16], [44, -44]]))),
    C("st1", tete(F, ombreD(bandeauOr, [91, 25], [50, 48], [[64, 42], [72, 30]]))),
    C("st1", tete(F, poly([[-92, 44], [92, 44], [93, 49], [0, 51], [-93, 49]]).segs)),
  ];
}

function foulardTete(F) {
  const tissu = symF([P(0, -32), P(38, -30), P(64, -18), P(84, 6), P(94, 34), P(95, 66), P(88, 94), P(72, 114), P(42, 128), P(16, 134), P(0, 135)]);
  const pointe = forme([P(-40, 122, true), P(0, 128), P(40, 122, true), P(14, 160), P(0, 172, true), P(-14, 160)]);
  const pan1 = forme([P(-4, 138, true), P(-16, 160), P(-34, 196, true), P(-24, 194), P(-6, 162), P(4, 142, true)]);
  const pan2 = forme([P(2, 140, true), P(14, 158), P(30, 186, true), P(20, 186), P(6, 160), P(-4, 144, true)]);
  const noeud = ellipse(0, 133, 15, 12, 12);
  const pois = [];
  const places = [[-50, -6], [-14, -18], [22, -12], [56, 6], [-70, 26], [-34, 16], [4, 14], [40, 30], [74, 40], [-56, 56], [-20, 46], [18, 58], [58, 70], [-76, 82], [-38, 86], [0, 92], [40, 100], [-12, 118], [26, 122]];
  for (const [u, v] of places) pois.push(ellipse(u, v, 5.5, 5.5, 10));
  return [
    C("st0", tete(F, tissu.segs)),
    C("st2", tete(F, pointe.segs)), C("st2", tete(F, pan1.segs)), C("st2", tete(F, pan2.segs)), C("st2", tete(F, noeud.segs)),
    ...pois.map((f) => C("st3", tete(F, f.segs))),
    C("st1", tete(F, ombreD(tissu, [38, -30], [42, 128], [[50, 104], [60, 60], [56, 16], [46, -22]]))),
    C("st1", tete(F, meche([[-60, 30], [-30, 70], [-10, 118]], 4))), C("st1", tete(F, meche([[50, 40], [26, 90], [10, 120]], 3.5))),
    C("st1", tete(F, croissant(0, 133, 14))),
  ];
}

// ---------------------------------------------------------------------------------------------
// PETITES PIÈCES DE TÊTE
// ---------------------------------------------------------------------------------------------
function serreTete(F) {
  const b = bande([[-77, 62], [-82, 30], [-70, 2], [-42, -15], [0, -21], [42, -15], [70, 2], [82, 30], [77, 62]], 10);
  const o = bande([[44, -11], [70, 6], [80, 30], [76, 58]], 4);
  return [C("st0", tete(F, b.segs)), C("st1", tete(F, o.segs))];
}

function noeudCheveux(F) {
  const g = forme([P(0, 72, true), P(-16, 56), P(-36, 48), P(-46, 64), P(-40, 88), P(-18, 86)]);
  const d = forme([P(0, 72, true), P(18, 86), P(40, 88), P(46, 64), P(36, 48), P(16, 56)]);
  const t1 = forme([P(-6, 78, true), P(-14, 102), P(-24, 124, true), P(-12, 120), P(-2, 86)]);
  const t2 = forme([P(6, 78, true), P(2, 86), P(12, 120), P(26, 126, true), P(16, 102)]);
  const k = ellipse(0, 72, 9, 10, 10);
  return [
    C("st0", tete(F, g.segs)), C("st0", tete(F, d.segs)),
    C("st2", tete(F, t1.segs)), C("st2", tete(F, t2.segs)), C("st2", tete(F, k.segs)),
    C("st1", tete(F, ombre(d, [0, 72], [46, 64], [[30, 70], [40, 66]]))),
    C("st1", tete(F, meche([[-36, 56], [-22, 66], [-6, 70]], 2.5))),
    C("st1", tete(F, meche([[4, 82], [10, 100], [18, 120]], 2.5))),
  ];
}

function barrettes(F) {
  const pinces = [[-52, 30, -1.05], [-62, 54, -1.25], [56, 40, 1.15]];
  const out = [], det = [], omb = [];
  for (const [u, v, rot] of pinces) {
    const f = ellipse(u, v, 19, 6.5, 14, rot);
    out.push(C("st0", tete(F, f.segs)));
    det.push(C("st3", tete(F, ellipse(u, v, 4.5, 4.5, 8).segs)));
    omb.push(C("st1", tete(F, ombre(f, [u + Math.cos(rot) * 19, v + Math.sin(rot) * 19], [u - Math.cos(rot) * 19, v - Math.sin(rot) * 19], [[u - Math.sin(rot) * 2, v + Math.cos(rot) * 2]]))));
  }
  return [...out, ...det, ...omb];
}

function branches(F, cls = "st0") {
  const out = [];
  for (const c of [-1, 1]) out.push(C(cls, tete(F, bande([[c * 69, 61], [c * 75, 73], [c * 78.5, 85], [c * 75, 95], [c * 70, 100]], 5).segs)));
  return out;
}
function lunettes(F) {
  return [...branches(F), C("st1", tete(F, bande([[75.5, 88], [74, 95], [70, 99]], 3).segs))];
}
function lunettesCordon(F, vBas) {
  const cordon = bande([[-71, 99], [-60, 126], [-50, 154], [-44, 182], [-30, vBas - 10], [0, vBas], [30, vBas - 10], [44, 182], [50, 154], [60, 126], [71, 99]], 4);
  return [C("st0", tete(F, cordon.segs)), ...branches(F, "st3"), C("st1", tete(F, bande([[75.5, 88], [74, 95], [70, 99]], 3).segs)),
    C("st1", tete(F, bande([[46, 160], [44, 182], [32, vBas - 12]], 2).segs))];
}

function casqueAudio(F) {
  const arceau = bande([[-80, 86], [-86, 44], [-72, 4], [-42, -20], [0, -28], [42, -20], [72, 4], [86, 44], [80, 86]], 11);
  const out = [C("st0", tete(F, arceau.segs))], coussins = [], omb = [];
  for (const c of [-1, 1]) {
    const coque = ellipse(c * 82, 101, 15, 27, 14);
    out.push(C("st0", tete(F, coque.segs)));
    coussins.push(C("st3", tete(F, forme([P(c * 68, 80, true), P(c * 74, 78), P(c * 72, 102), P(c * 74, 124), P(c * 68, 122, true), P(c * 66, 101)]).segs)));
    if (c > 0) omb.push(C("st1", tete(F, ombre(coque, [94, 86], [86, 127], [[88, 112], [90, 96]]))));
    omb.push(C("st2", tete(F, ellipse(c * 82, 101, 7, 13, 10).segs)));
  }
  omb.push(C("st1", tete(F, bande([[44, -16], [72, 8], [84, 44], [80, 80]], 4).segs)));
  // st2 (cercle de la coque) passe avant les ombres
  return [...out, ...omb.filter((c) => c.cls === "st2"), ...coussins, ...omb.filter((c) => c.cls === "st1")];
}

// ---------------------------------------------------------------------------------------------
// COU ET ÉPAULES (pixels du cadre)
// ---------------------------------------------------------------------------------------------
const COU = {
  // cx, haut et bas du boudin, demi-largeurs ; pan = longueur du pan dans le dos
  femme: { cx: 250, h: 344, b: 402, dh: 50, db: 64, pan: 130, cordon: 398 },
  homme: { cx: 250.1, h: 324, b: 382, dh: 52, db: 69, pan: 140, cordon: 384 },
  enfant: { cx: 250, h: 402, b: 459, dh: 44, db: 61, pan: 90, cordon: 466 },
  ado: { cx: 275.6, h: 345, b: 397, dh: 46, db: 63, pan: 112, cordon: 392 },
};
function boudin(k, haut = 0) {
  const { cx, h, b, dh, db } = k;
  const H = h - haut, m = (H + b) / 2;
  return forme([P(cx, H), P(cx + dh * 0.6, H + 1), P(cx + dh, H + 7), P(cx + db - 2, m - 6), P(cx + db, m + 6), P(cx + db - 4, b - 9), P(cx + db * 0.62, b - 1), P(cx, b + 1),
    P(cx - db * 0.62, b - 1), P(cx - db + 4, b - 9), P(cx - db, m + 6), P(cx - db + 2, m - 6), P(cx - dh, H + 7), P(cx - dh * 0.6, H + 1)]);
}
function echarpe(F, fam) {
  const k = COU[fam];
  const { cx, h, b, db, pan } = k;
  const bd = boudin(k);
  // pan qui tombe dans le dos, un peu à gauche, frangé
  const x0 = cx - 34, x1 = cx + 4, y0 = b - 14, y1 = b + pan;
  const xg = (y) => x0 - ((y - y0) / (y1 - y0)) * 6, xd = (y) => x1 - ((y - y0) / (y1 - y0)) * 2;
  const panF = forme([P(x0, y0, true), P(x1, y0, true), P(xd(y1), y1, true), P(xg(y1), y1, true)]);
  const franges = [];
  for (let x = xg(y1) + 1; x + 6 <= xd(y1) - 0.5; x += 8.5) franges.push(poly([[x, y1 - 1], [x + 6, y1 - 1], [x + 6, y1 + 12], [x, y1 + 12]]));
  const raies = [];
  for (const yy of [y1 - 46, y1 - 26]) raies.push(poly([[xg(yy) - 0.2, yy], [xd(yy) + 0.2, yy], [xd(yy + 10) + 0.2, yy + 10], [xg(yy + 10) - 0.2, yy + 10]]));
  // tours de laine (nuance) en biais sur le boudin
  const tours = [];
  for (const dx of [-36, -6, 24]) tours.push(meche([[cx + dx - 6, h + 6], [cx + dx + 4, (h + b) / 2], [cx + dx + 12, b - 4]], 5));
  return [
    C("st0", panF.segs), ...franges.map((f) => C("st0", f.segs)), C("st0", bd.segs),
    ...tours.map((s) => C("st2", s)),
    ...raies.map((f) => C("st3", f.segs)),
    C("st1", ombre(bd, [cx + db * 0.7, h + 4], [cx + db * 0.62, b - 1], [[cx + db - 18, b - 12], [cx + db - 16, (h + b) / 2]])),
    C("st1", poly([[x0, b], [x1, b], [x1 - 0.4, b + 10], [x0 - 0.4, b + 10]]).segs),
    C("st1", poly([[x1 - 10, y0 + 12], [x1 - 0.2, y0 + 12], [xd(y1) - 0.2, y1], [xd(y1) - 10, y1]]).segs),
  ];
}

function foulardCou(F) {
  const cx = 250;
  const bd = forme([P(cx, 351), P(cx + 30, 352), P(cx + 47, 356), P(cx + 57, 368), P(cx + 59, 384), P(cx + 54, 395), P(cx + 36, 399), P(cx, 400),
    P(cx - 36, 399), P(cx - 54, 395), P(cx - 59, 384), P(cx - 57, 368), P(cx - 47, 356), P(cx - 30, 352)]);
  const pointe = forme([P(cx - 40, 394, true), P(cx, 400), P(cx + 40, 394, true), P(cx + 10, 432), P(cx + 2, 446, true), P(cx - 8, 432)]);
  const noeud = ellipse(cx - 50, 388, 12, 10, 12);
  const bout1 = forme([P(cx - 56, 394, true), P(cx - 66, 410), P(cx - 82, 426, true), P(cx - 70, 400)]);
  const bout2 = forme([P(cx - 46, 396, true), P(cx - 48, 414), P(cx - 56, 436, true), P(cx - 40, 412)]);
  return [
    C("st0", pointe.segs), C("st0", bd.segs),
    C("st2", bout1.segs), C("st2", bout2.segs), C("st2", noeud.segs),
    C("st1", ombre(bd, [cx + 47, 356], [cx + 36, 399], [[cx + 40, 388], [cx + 42, 368]])),
    C("st1", ombre(pointe, [cx + 40, 394], [cx + 2, 446], [[cx + 4, 418], [cx + 14, 402]])),
    C("st1", meche([[cx - 30, 356], [cx - 22, 376], [cx - 10, 396]], 3)),
    C("st1", croissant(cx - 50, 388, 11)),
  ];
}

function chale(F, M) {
  const cx = 250;
  // bords latéraux : dans l'intersection des corps de la famille, 4 px en retrait
  const cote = [];
  for (let y = 392; y <= 482; y += 9) {
    let d = 1e9;
    for (const g of Object.values(M)) { const r = g.larg[y]; if (r) d = Math.min(d, r[1] - cx, cx - r[0]); }
    cote.push([d - 4, y]);
  }
  const droite = [P(cx, 390), P(cx + 26, 386), P(cx + 44, 382), P(cx + 56, 386), ...cote.map(([u, y]) => P(cx + u, y)), P(cx + cote[cote.length - 1][0] - 2, 486, true)];
  const pointe = [P(cx + 90, 526), P(cx, 566, true)];
  const gauche = [...droite.slice(1).reverse().map((p) => P(2 * cx - p.u, p.v, p.c))];
  const pg = [P(cx - 90, 526)];
  // ordre : haut au centre, côté droit en descendant, pointe, côté gauche en remontant
  const tissu = forme([...droite, ...pointe, ...pg, ...gauche]);
  const xd = cx + cote[cote.length - 1][0] - 2;
  // bordure (nuance) le long des deux bords inférieurs
  const bordure = forme([P(xd, 486, true), P(cx + 90, 526), P(cx, 566, true), P(cx - 90, 526), P(2 * cx - xd, 486, true), P(2 * cx - xd + 10, 482, true), P(cx - 86, 514), P(cx, 552, true), P(cx + 86, 514), P(xd - 10, 482, true)]);
  // franges : petits rectangles le long des bords inférieurs
  const franges = [];
  for (const sgn of [-1, 1]) {
    const ax = cx + sgn * (xd - cx), ay = 486, bx = cx, by = 566;
    const L = Math.hypot(bx - ax, by - ay), tx = (bx - ax) / L, ty = (by - ay) / L;
    // normale vers l'extérieur du châle : celle qui descend
    let ox = -ty, oy = tx; if (oy < 0) { ox = -ox; oy = -oy; }
    for (let s = 10; s < L - 8; s += 11) {
      const px = ax + tx * s - ox * 2, py = ay + ty * s - oy * 2;
      franges.push(poly([[px - tx * 3, py - ty * 3], [px + tx * 3, py + ty * 3], [px + tx * 3 + ox * 12, py + ty * 3 + oy * 12], [px - tx * 3 + ox * 12, py - ty * 3 + oy * 12]]));
    }
  }
  return [
    C("st0", tissu.segs), C("st2", bordure.segs),
    ...franges.map((f) => C("st3", f.segs)),
    C("st1", meche([[cx + 50, 392], [cx + 70, 440], [cx + 60, 500], [cx + 30, 540]], 9)),
    C("st1", meche([[cx - 20, 396], [cx - 30, 450], [cx - 20, 520]], 4)),
    C("st1", forme([P(cx - 44, 384, true), P(cx, 391), P(cx + 44, 384, true), P(cx, 398)]).segs),
  ];
}

function collierPerles(F) {
  const out = [], omb = [];
  const pts = [];
  // arc sur la nuque : des côtés du cou (y 360) jusqu'au creux (y 386)
  for (let k = 0; k <= 10; k++) {
    const t = k / 10, a = Math.PI * t;
    pts.push([250 - 38 * Math.cos(a), 362 + 23 * Math.sin(a)]);
  }
  for (const [x, y] of pts) { if (Math.abs(x - 250) < 4) continue; out.push(C("st0", ellipse(x, y, 6, 6, 10).segs)); omb.push(C("st1", croissant(x, y, 6))); }
  const fermoir = poly([[244, 380], [256, 380], [256, 390], [244, 390]]);
  return [...out, C("st3", fermoir.segs), ...omb, C("st1", poly([[250, 380], [256, 380], [256, 390], [250, 390]]).segs)];
}

// ---------------------------------------------------------------------------------------------
// SACS, BRETELLES, CANNE (pixels du cadre)
// ---------------------------------------------------------------------------------------------
function rectArrondi(x0, y0, x1, y1, r = 12) {
  const pts = [];
  const coin = (cx, cy, a0) => { for (let k = 0; k <= 3; k++) { const a = a0 + (k / 3) * (Math.PI / 2); pts.push(P(cx + Math.cos(a) * r, cy + Math.sin(a) * r, true)); } };
  coin(x1 - r, y0 + r, -Math.PI / 2); coin(x1 - r, y1 - r, 0); coin(x0 + r, y1 - r, Math.PI / 2); coin(x0 + r, y0 + r, Math.PI);
  return forme(pts);
}

const SACS = {
  bandouliere: {
    femme: { epaule: [[200, 393], [214, 432]], sac: [258, 676, 340, 764] },
    homme: { epaule: [[198, 373], [212, 412]], sac: [270, 700, 350, 790] },
  },
  dos: {
    femme: { cx: 250, x: [168, 332], y: [452, 636], epaule: 384 },
    homme: { cx: 250, x: [162, 338], y: [418, 640], epaule: 361 },
    enfant: { cx: 250, x: [172, 328], y: [478, 640], epaule: 444 },
    ado: { cx: 274, x: [192, 356], y: [404, 596], epaule: 370 },
  },
};

function sacBandouliere(F, fam) {
  const k = SACS.bandouliere[fam];
  const [x0, y0, x1, y1] = k.sac;
  const sangle = bande([k.epaule[0], k.epaule[1], [x0 + 26, y0 - 2]], 11, { rond: false });
  const corps = rectArrondi(x0, y0, x1, y1, 12);
  const rabat = forme([P(x0, y0 + 10, true), P(x0 + 8, y0, true), P(x1 - 8, y0, true), P(x1, y0 + 10, true), P(x1, y0 + 34), P((x0 + x1) / 2, y0 + 48), P(x0, y0 + 34)]);
  const fermoir = rectArrondi((x0 + x1) / 2 - 6, y0 + 38, (x0 + x1) / 2 + 6, y0 + 50, 3);
  const attache = poly([[x0 + 18, y0 - 6], [x0 + 32, y0 - 6], [x0 + 32, y0 + 4], [x0 + 18, y0 + 4]]);
  return [
    C("st0", sangle.segs), C("st0", corps.segs),
    C("st2", rabat.segs), C("st2", attache.segs),
    C("st4", fermoir.segs),
    C("st1", ombre(corps, [x1, y0 + 14], [x0 + 20, y1], [[x1 - 26, y1 - 12], [x1 - 14, y0 + 50]])),
    C("st1", poly([[x0 + 2, y0 + 36], [(x0 + x1) / 2, y0 + 50], [x1 - 2, y0 + 36], [x1 - 2, y0 + 44], [(x0 + x1) / 2, y0 + 58], [x0 + 2, y0 + 44]]).segs),
    C("st1", bande([[k.epaule[1][0] + 3.5, k.epaule[1][1]], [x0 + 29.5, y0 - 2]], 4, { rond: false }).segs),
  ];
}

function sacADos(F, fam) {
  const k = SACS.dos[fam];
  const [x0, x1] = k.x, [y0, y1] = k.y, cx = k.cx, w = x1 - x0, h = y1 - y0;
  const corps = rectArrondi(x0, y0, x1, y1, 22);
  const rabat = forme([P(x0 + 6, y0 + 22), P(x0 + 22, y0 + 2), P(cx, y0 - 2), P(x1 - 22, y0 + 2), P(x1 - 6, y0 + 22), P(x1 - 10, y0 + h * 0.32, true), P(cx, y0 + h * 0.38), P(x0 + 10, y0 + h * 0.32, true)]);
  const poche = rectArrondi(x0 + w * 0.16, y0 + h * 0.56, x1 - w * 0.16, y1 - 12, 14);
  const poignee = bande([[cx - 14, y0 + 2], [cx - 10, y0 - 12], [cx + 10, y0 - 12], [cx + 14, y0 + 2]], 6);
  const sangles = [];
  for (const c of [-1, 1]) sangles.push(bande([[cx + c * (w / 2 - 18), y0 + 16], [cx + c * (w / 2 - 26), (y0 + k.epaule) / 2 + 4], [cx + c * 36, k.epaule + 1]], 15, { rond: false }));
  const boucles = [-1, 1].map((c) => rectArrondi(cx + c * (w * 0.2) - 6, y0 + h * 0.3, cx + c * (w * 0.2) + 6, y0 + h * 0.3 + 14, 3));
  return [
    C("st0", corps.segs), C("st0", rabat.segs),
    C("st2", poignee.segs), ...sangles.map((s) => C("st2", s.segs)), ...boucles.map((f) => C("st2", f.segs)),
    C("st3", poche.segs),
    C("st1", ombre(corps, [x1 - 6, y0 + 10], [cx + 10, y1], [[x1 - 34, y1 - 20], [x1 - 26, y0 + 40]])),
    C("st1", forme([P(x0 + 10, y0 + h * 0.32, true), P(cx, y0 + h * 0.38), P(x1 - 10, y0 + h * 0.32, true), P(x1 - 10, y0 + h * 0.32 + 9), P(cx, y0 + h * 0.38 + 10), P(x0 + 10, y0 + h * 0.32 + 9)]).segs),
    C("st1", ombre(rabat, [x1 - 22, y0 + 2], [cx, y0 + h * 0.38], [[cx + w * 0.2, y0 + h * 0.3], [x1 - 30, y0 + 20]])),
    C("st1", poly([[x0 + w * 0.16 + 6, y0 + h * 0.56 + 4], [x1 - w * 0.16 - 6, y0 + h * 0.56 + 4], [x1 - w * 0.16 - 6, y0 + h * 0.56 + 12], [x0 + w * 0.16 + 6, y0 + h * 0.56 + 12]]).segs),
  ];
}

function bretelles(F) {
  const h = 362, b = 752, cx = 250;
  const s1 = bande([[cx - 40, h + 1], [cx - 14, 500], [cx + 16, 640], [cx + 46, b]], 15, { rond: false });
  const s2 = bande([[cx + 40, h + 1], [cx + 14, 500], [cx - 16, 640], [cx - 46, b]], 15, { rond: false });
  const croix = forme([P(cx, 548, true), P(cx + 16, 566, true), P(cx, 584, true), P(cx - 16, 566, true)]);
  const pinces = [cx + 46, cx - 46].map((x) => rectArrondi(x - 10, b - 16, x + 10, b + 2, 3));
  return [
    C("st0", s2.segs), C("st0", s1.segs),
    C("st2", croix.segs),
    ...pinces.map((f) => C("st3", f.segs)),
    C("st1", bande([[cx - 12, 552], [cx + 4, 600], [cx + 14, 636]], 6, { rond: false }).segs),
    C("st1", poly([[cx + 36, b - 22], [cx + 58, b - 22], [cx + 58, b - 16], [cx + 36, b - 16]]).segs),
    C("st1", poly([[cx - 56, b - 22], [cx - 36, b - 22], [cx - 36, b - 16], [cx - 56, b - 16]]).segs),
  ];
}

function canne(F, fam, mesures) {
  // femme : la canne entière, debout à droite de l'assise ; homme : elle passe derrière la main
  const x = fam === "femme" ? 468 : 466, w = 9, haut = fam === "femme" ? 622 : 642, R = 8;
  const bas = F.assise;
  const crosse = bande([[x, haut + 16], [x, haut + 2], [x + 3, haut - R + 2], [x + R, haut - R - 1], [x + 2 * R - 3, haut - R + 2], [x + 2 * R, haut + 4], [x + 2 * R, haut + 10]], w);
  const out = [C("st0", crosse.segs)];
  const omb = [C("st1", bande([[x + 2, haut + 12], [x + 2, haut]], 3, { rond: false }).segs)];
  if (fam === "femme") {
    out.push(C("st0", poly([[x - w / 2, haut + 10], [x + w / 2, haut + 10], [x + w / 2, bas - 12], [x - w / 2, bas - 12]]).segs));
    out.push(C("st3", rectArrondi(x - w / 2 - 0.5, bas - 14, x + w / 2 + 0.5, bas, 3).segs));
    omb.push(C("st1", poly([[x + 0.5, haut + 12], [x + w / 2, haut + 12], [x + w / 2, bas - 12], [x + 0.5, bas - 12]]).segs));
  } else {
    // haut et bas de la main, colonne par colonne, sur tous les gabarits de la famille (commun/mes.json)
    const x0 = x - w / 2, x1 = x + w / 2;
    const colonnes = [];
    let basMain = 0;
    for (let xx = Math.floor(x0); xx <= Math.ceil(x1); xx++) {
      let yh = 880;
      for (const g of Object.values(mesures)) {
        for (let y = 800; y < 870; y++) if (g.runs[y].some(([a, b]) => xx >= a && xx < b)) { yh = Math.min(yh, y); break; }
        for (let y = 869; y >= 800; y--) if (g.runs[y].some(([a, b]) => xx >= a && xx < b)) { basMain = Math.max(basMain, y); break; }
      }
      colonnes.push([xx, yh]);
    }
    // escalier : chaque colonne de pixels s'arrête juste au-dessus du premier pixel de main (le plus haut des gabarits)
    const marches = [];
    for (const [xx, yh] of colonnes) {
      const a = Math.max(xx, x0), b = Math.min(xx + 1, x1);
      if (b <= a) continue;
      marches.push([a, yh - 0.6], [b, yh - 0.6]);
    }
    const fut = [[x0, haut + 10], [x1, haut + 10], ...marches.reverse()];
    out.push(C("st0", poly(fut).segs));
    out.push(C("st3", rectArrondi(x0 - 0.5, basMain + 3, x1 + 0.5, bas + 1, 3).segs));
    const finOmbre = Math.min(...colonnes.map(([, y]) => y)) - 1;
    omb.push(C("st1", poly([[x + 0.5, haut + 12], [x1, haut + 12], [x1, finOmbre], [x + 0.5, finOmbre]]).segs));
  }
  return [...out, ...omb];
}

// ---------------------------------------------------------------------------------------------
// ANIMAUX (pixels du cadre)
// ---------------------------------------------------------------------------------------------
function noeudPapillon(cx, cy, l, h, rot = 0) {
  const R = (u, v) => [cx + u * Math.cos(rot) - v * Math.sin(rot), cy + u * Math.sin(rot) + v * Math.cos(rot)];
  const pt = (u, v, c) => { const [x, y] = R(u, v); return P(x, y, c); };
  const g = forme([pt(0, 0, true), pt(-l * 0.4, -h * 0.55), pt(-l, -h * 0.5), pt(-l * 1.05, h * 0.2), pt(-l * 0.8, h * 0.6), pt(-l * 0.35, h * 0.45)]);
  const d = forme([pt(0, 0, true), pt(l * 0.35, h * 0.45), pt(l * 0.8, h * 0.6), pt(l * 1.05, h * 0.2), pt(l, -h * 0.5), pt(l * 0.4, -h * 0.55)]);
  const [kx, ky] = R(0, 0);
  const k = ellipse(kx, ky, l * 0.22, h * 0.36, 10, rot);
  return { g, d, k, R };
}

function chatColierGrelot(F) {
  const col = bande([[214, 527], [232, 536], [250, 539], [268, 536], [286, 527]], 9);
  return [C("st0", col.segs), C("st3", ellipse(250, 551, 7.5, 7.5, 12).segs, { libre: true }), C("st3", poly([[246, 541], [254, 541], [254, 546], [246, 546]]).segs, { libre: true }),
    C("st1", bande([[262, 538], [274, 534], [285, 528]], 4).segs), C("st1", croissant(250, 551, 7.5), { libre: true }), C("st1", poly([[246, 551], [254, 551], [254, 554], [246, 554]]).segs, { libre: true })];
}
function chatNoeudCou(F) {
  const col = bande([[216, 528], [234, 536], [250, 538], [266, 536], [284, 528]], 6);
  const n = noeudPapillon(250, 540, 22, 20);
  return [C("st0", col.segs), C("st0", n.g.segs, { libre: true }), C("st0", n.d.segs, { libre: true }), C("st2", n.k.segs, { libre: true }),
    C("st1", ombre(n.d, [250, 540], [272, 538], [[262, 542]]), { libre: true })];
}
function chatNoeudTete(F) {
  const n = noeudPapillon(229, 476, 15, 15, -0.35);
  return [C("st0", n.g.segs, { libre: true }), C("st0", n.d.segs, { libre: true }), C("st2", n.k.segs, { libre: true }),
    C("st1", ombre(n.d, [229, 476], [244, 469], [[238, 476]]), { libre: true })];
}
function lapinNoeudCou(F) {
  const col = bande([[214, 512], [232, 522], [250, 525], [268, 522], [286, 512]], 6);
  const n = noeudPapillon(250, 527, 22, 20);
  return [C("st0", col.segs), C("st0", n.g.segs, { libre: true }), C("st0", n.d.segs, { libre: true }), C("st2", n.k.segs, { libre: true }),
    C("st1", ombre(n.d, [250, 527], [272, 525], [[262, 529]]), { libre: true })];
}
function lapinCollier(F) {
  const col = bande([[213, 513], [232, 523], [250, 526], [268, 523], [287, 513]], 9);
  const medaille = ellipse(250, 538, 7, 7, 12);
  return [C("st0", col.segs), C("st3", medaille.segs, { libre: true }), C("st3", poly([[247, 527], [253, 527], [253, 532], [247, 532]]).segs, { libre: true }),
    C("st1", bande([[264, 524], [276, 519], [286, 513]], 4).segs), C("st1", croissant(250, 538, 7), { libre: true })];
}
function lapinNoeudOreille(F) {
  const n = noeudPapillon(234, 462, 15, 15, -0.2);
  return [C("st0", n.g.segs, { libre: true }), C("st0", n.d.segs, { libre: true }), C("st2", n.k.segs, { libre: true }),
    C("st1", ombre(n.d, [234, 462], [249, 459], [[242, 463]]), { libre: true })];
}

function chevalLicol(F) {
  const tetiere = bande([[212, 227], [226, 217], [250, 214], [274, 217], [288, 227]], 9);
  const mg = bande([[212, 224], [208.5, 252], [212, 282]], 9, { rond: false });
  const md = bande([[288, 224], [291.5, 252], [288, 282]], 9, { rond: false });
  const anneaux = [ellipse(213, 286, 6, 6, 10), ellipse(287, 286, 6, 6, 10)];
  return [C("st0", tetiere.segs), C("st0", mg.segs), C("st0", md.segs), ...anneaux.map((f) => C("st3", f.segs)),
    C("st1", bande([[274, 220], [287, 229]], 3).segs), C("st1", bande([[290, 232], [292.5, 252], [290, 280]], 3, { rond: false }).segs)];
}
function chevalNoeudCriniere(F) {
  const n = noeudPapillon(238, 318, 22, 20, -0.15);
  const p1 = forme([P(234, 322, true), P(228, 340), P(222, 360, true), P(232, 356), P(238, 326)]);
  const p2 = forme([P(240, 324, true), P(244, 344), P(250, 362, true), P(256, 356), P(244, 322)]);
  return [C("st0", p1.segs), C("st0", p2.segs), C("st0", n.g.segs, { libre: true }), C("st0", n.d.segs, { libre: true }), C("st2", n.k.segs, { libre: true }),
    C("st1", ombre(n.d, [238, 318], [260, 312], [[250, 320]]), { libre: true }), C("st1", meche([[244, 326], [248, 342], [252, 358]], 2))];
}
function chevalCouronneFleurs(F) {
  const fleurs = [], coeurs = [], feuilles = [];
  const pos = [[220, 212], [233, 205], [246, 201], [259, 201], [272, 205], [282, 212]];
  pos.forEach(([x, y], i) => {
    if (i < pos.length - 1) { const [x2, y2] = pos[i + 1]; feuilles.push(meche([[x + 2, y + 8], [(x + x2) / 2, (y + y2) / 2 + 9], [x2 - 2, y2 + 8]], 4)); }
    fleurs.push(forme(festons(ellipse(x, y, 7, 7, 10).pts, 5, 2.2, 0.5)));
    coeurs.push(ellipse(x, y, 3.2, 3.2, 8));
  });
  return [...fleurs.map((f) => C("st0", f.segs)), ...coeurs.map((f) => C("st2", f.segs)), ...feuilles.map((s) => C("st3", s)), ...coeurs.map((f) => C("st2", f.segs)),
    C("st1", croissant(282, 212, 7.5)), C("st1", croissant(272, 205, 7.5))];
}

// ---------------------------------------------------------------------------------------------
// CATALOGUE (ordre = ordre des numéros proposés, à ne jamais réordonner)
// ---------------------------------------------------------------------------------------------
// type de contrôle : chapeau (calotte couverte), tete (petite pièce sur la tête, débord ≤ 24 px),
// cou (peau du cou couverte sous l'écharpe), epaules, dos (couloir du dos), canne, animal.
export function catalogue(M) {
  const L = [];
  const add = (famille, id, nom, type, zonesDef, build, extra = {}) => L.push({ famille, id, nom, type, zones: zonesDef, build, ...extra });
  const zPaille = zones(Z.p(K.paille, "Paille"), { st2: nuanceDe(), st3: Z.part(K.rubanRouge, "Ruban") });

  // ---------------- FEMME ----------------
  add("femme", "chapeau-paille", "Chapeau de paille", "chapeau", zPaille, chapeauPaille(), { bord: 46 });
  add("femme", "capeline", "Capeline", "chapeau", zones(Z.p(K.sable, "Paille"), { st2: nuanceDe(), st3: Z.part(K.marine, "Ruban") }), capeline, { bord: 46,
    notes: "Bord très large (jusqu'à |u| 150) : il passe au-dessus des épaules. Incompatible avec les coiffures volumineuses (chignon haut, queue haute, macarons, afro)." });
  add("femme", "bob", "Bob", "chapeau", zones(Z.p(K.bob, "Toile"), { st2: nuanceDe("st0", 0.1) }), bob, { bord: 44 });
  add("femme", "bonnet", "Bonnet à revers", "chapeau", zones(Z.p(K.bonnet, "Laine"), { st2: nuanceDe("st0", 0.1) }), bonnet(), { bord: 58 });
  add("femme", "bonnet-pompon", "Bonnet à pompon", "chapeau", zones(Z.p(K.rose, "Laine"), { st2: nuanceDe("st0", 0.12), st3: Z.part(K.blanc, "Pompon") }), bonnet({ pompon: true }), { bord: 58 });
  add("femme", "beret", "Béret", "chapeau", zones(Z.p(K.rouge, "Laine")), beret, { bord: 44, notes: "Posé penché vers la droite ; il couvre toute la calotte contractuelle." });
  add("femme", "casquette", "Casquette", "chapeau", zones(Z.p(K.casquette, "Tissu"), { st2: nuanceDe("st0", 0.12), st3: Z.part(K.blanc, "Patte") }), casquette(), { bord: 50, ouverture: true,
    notes: "Ouverture de réglage au-dessus de la patte (|u| < 30, v 24 à 50) : la coiffure ou le crâne s'y voient, comme sur la casquette actuelle de Male_2. Zone exclue du contrôle de calotte." });
  add("femme", "lunettes", "Lunettes", "tete", zones(Z.p(K.lunettes, "Monture")), lunettes);
  add("femme", "lunettes-cordon", "Lunettes à cordon", "tete", zones(Z.p(K.grelot, "Cordon"), { st3: Z.part(K.lunettes, "Monture") }), (F) => lunettesCordon(F, (398 - 178.4) / 1), { debordMax: 24 });
  add("femme", "serre-tete", "Serre-tête", "tete", zones(Z.p(K.serreTete, "Serre-tête")), serreTete, { debordMax: 34, notes: "Posé sur les cheveux (contrat coiffures : volume jusqu'à demi(v) + 20, sommet v -28) : il flotte de quelques pixels au-dessus d'un crâne tondu." });
  add("femme", "noeud-cheveux", "Nœud dans les cheveux", "tete", zones(Z.p(K.rubanRouge, "Ruban"), { st2: nuanceDe("st0", 0.12) }), noeudCheveux);
  add("femme", "barrettes", "Barrettes", "tete", zones(Z.p(K.rose, "Barrettes"), { st3: Z.part(K.blanc, "Strass") }), barrettes);
  add("femme", "foulard-tete", "Foulard sur la tête", "chapeau", zones(Z.p(K.foulard, "Tissu"), { st2: nuanceDe("st0", 0.12), st3: Z.part(K.blanc, "Pois") }), foulardTete, { bord: 66,
    notes: "Noué sur la nuque, pans jusqu'à v 196 : passe par-dessus les cheveux longs." });
  add("femme", "echarpe", "Écharpe", "cou", zones(Z.p(K.rouge, "Laine"), { st2: nuanceDe("st0", 0.12), st3: Z.part(K.blanc, "Rayures") }), (F) => echarpe(F, "femme"), { debordMax: 24 });
  add("femme", "foulard-cou", "Foulard noué au cou", "cou", zones(Z.p(K.ciel, "Soie"), { st2: nuanceDe("st0", 0.14) }), foulardCou, { debordMax: 24 });
  add("femme", "chale", "Châle", "epaules", zones(Z.p(K.rouille, "Laine"), { st2: nuanceDe("st0", 0.12), st3: Z.part(K.sable, "Franges") }), (F) => chale(F, M.femme), { debordMax: 6 });
  add("femme", "sac-bandouliere", "Sac en bandoulière", "dos", zones(Z.p(K.orange, "Cuir"), { st2: nuanceDe("st0", 0.14), st4: Z.det(K.grelot, "Fermoir") }), (F) => sacBandouliere(F, "femme"));
  add("femme", "sac-a-dos", "Sac à dos", "dos", zones(Z.p(K.petrole, "Toile"), { st2: nuanceDe("st0", 0.1), st3: Z.part(K.moutarde, "Poche") }), (F) => sacADos(F, "femme"));
  add("femme", "canne", "Canne", "canne", zones(Z.p(K.canne, "Bois"), { st3: Z.part(K.lunettes, "Embout") }), (F) => canne(F, "femme"), {
    notes: "Posée debout à droite de l'assise (x 464 à 488), crosse vers y 614 tournée vers l'extérieur : elle ne touche ni le bras ni la main, même sur la femme ronde." });
  add("femme", "collier-perles", "Collier de perles", "tete", zones(Z.p(K.perles, "Perles"), { st3: Z.part(K.grelot, "Fermoir") }), collierPerles, { debordMax: 6,
    notes: "Rang de perles sur la nuque, fermoir au milieu ; par-dessus les cheveux longs (calque accessoire)." });

  // ---------------- HOMME ----------------
  add("homme", "casquette", "Casquette", "chapeau", zones(Z.p(K.casquette, "Tissu"), { st2: nuanceDe("st0", 0.12), st3: Z.part(K.blanc, "Patte") }), casquette(), { bord: 50, ouverture: true,
    notes: "Ouverture de réglage au-dessus de la patte, comme sur la casquette actuelle de Male_2 : zone exclue du contrôle de calotte." });
  add("homme", "casquette-plate", "Casquette plate", "chapeau", zones(Z.p(K.ardoise, "Tweed"), { st2: nuanceDe("st0", 0.12) }), casquettePlate, { bord: 44 });
  add("homme", "chapeau-feutre", "Chapeau de feutre", "chapeau", zones(Z.p("#5A4636", "Feutre"), { st2: nuanceDe("st0", 0.1), st3: Z.part(K.lunettes, "Ruban") }), feutre(), { bord: 44 });
  add("homme", "panama", "Panama", "chapeau", zones(Z.p(K.creme, "Paille"), { st2: nuanceDe("st0", 0.14), st3: Z.part(K.lunettes, "Ruban") }), feutre({ panama: true }), { bord: 44 });
  add("homme", "bob", "Bob", "chapeau", zones(Z.p(K.sable, "Toile"), { st2: nuanceDe("st0", 0.12) }), bob, { bord: 44 });
  add("homme", "bonnet", "Bonnet à revers", "chapeau", zones(Z.p(K.marine, "Laine"), { st2: nuanceDe("st0", 0.1) }), bonnet(), { bord: 58 });
  add("homme", "beret", "Béret", "chapeau", zones(Z.p(K.beretMarin, "Laine")), beret, { bord: 44 });
  add("homme", "lunettes", "Lunettes", "tete", zones(Z.p(K.lunettes, "Monture")), lunettes);
  add("homme", "lunettes-cordon", "Lunettes à cordon", "tete", zones(Z.p(K.gris, "Cordon"), { st3: Z.part(K.lunettes, "Monture") }), (F) => lunettesCordon(F, (384 - 161) / 0.983), { debordMax: 24 });
  add("homme", "echarpe", "Écharpe", "cou", zones(Z.p(K.vert, "Laine"), { st2: nuanceDe("st0", 0.1), st3: Z.part(K.moutarde, "Rayures") }), (F) => echarpe(F, "homme"), { debordMax: 24 });
  add("homme", "sac-bandouliere", "Sacoche en bandoulière", "dos", zones(Z.p("#5E4A19", "Toile"), { st2: nuanceDe("st0", 0.1), st4: Z.det(K.gris, "Boucle") }), (F) => sacBandouliere(F, "homme"));
  add("homme", "sac-a-dos", "Sac à dos", "dos", zones(Z.p(K.rouge, "Toile"), { st2: nuanceDe("st0", 0.12), st3: Z.part(K.marine, "Poche") }), (F) => sacADos(F, "homme"));
  add("homme", "bretelles", "Bretelles", "dos", zones(Z.p(K.rouge, "Élastique"), { st2: nuanceDe("st0", 0.14), st3: Z.part(K.gris, "Pinces") }), bretelles, {
    notes: "Croisées en X dans le dos, de la naissance des épaules (y 362) à la ceinture (y 752)." });
  add("homme", "casque-audio", "Casque audio", "tete", zones(Z.p(K.casque, "Coques"), { st2: nuanceDe("st0", 0.12), st3: Z.part(K.lunettes, "Coussinets") }), casqueAudio, { debordMax: 36, notes: "Arceau au-dessus de v -10 pour passer par-dessus les coiffures, écouteurs sur les oreilles (u ±82, v 74 à 128)." });
  add("homme", "canne", "Canne", "canne", zones(Z.p(K.canne, "Bois"), { st3: Z.part(K.lunettes, "Embout") }), (F) => canne(F, "homme", M.homme), {
    notes: "Aucune place à droite de la main du gabarit rond (main jusqu'à x 487, cadre limité à x 490) ni entre la main et la hanche (3 px communs aux 4 gabarits) : la canne passe DERRIÈRE la main. Le fût (x 461 à 471) s'arrête sur le contour de la main la plus haute (celle du rond), l'embout reparaît sous la main jusqu'à l'assise. Sur les mains standard, mince et âgé, il reste un jour de 8 à 14 px entre le bas du fût et le bout des doigts." });

  // ---------------- ENFANT ----------------
  add("enfant", "casquette", "Casquette", "chapeau", zones(Z.p(K.bleu, "Tissu"), { st2: nuanceDe("st0", 0.12), st3: Z.part(K.rubanRouge, "Patte") }), casquette(), { bord: 50, ouverture: true,
    notes: "Ouverture de réglage au-dessus de la patte : zone exclue du contrôle de calotte." });
  add("enfant", "bob", "Bob", "chapeau", zones(Z.p(K.moutarde, "Toile"), { st2: nuanceDe("st0", 0.14) }), bob, { bord: 44 });
  add("enfant", "bonnet-pompon", "Bonnet à pompon", "chapeau", zones(Z.p(K.rubanRouge, "Laine"), { st2: nuanceDe("st0", 0.12), st3: Z.part(K.blanc, "Pompon") }), bonnet({ pompon: true }), { bord: 58 });
  add("enfant", "bonnet-oreilles", "Bonnet à oreillettes", "chapeau", zones(Z.p(K.ciel, "Laine"), { st2: nuanceDe("st0", 0.14), st3: Z.part(K.blanc, "Pompon") }), bonnet({ oreilles: true }), { bord: 58,
    notes: "Oreillettes jusqu'à v 130 et cordons à pompons jusqu'à v 190 : ils passent par-dessus les cheveux mi-longs." });
  add("enfant", "chapeau-paille", "Chapeau de paille", "chapeau", zPaille, chapeauPaille({ ru: 114, rv: 26 }), { bord: 46 });
  add("enfant", "serre-tete", "Serre-tête", "tete", zones(Z.p(K.rose, "Serre-tête")), serreTete, { debordMax: 34, notes: "Posé sur les cheveux : il flotte de quelques pixels au-dessus d'un crâne tondu." });
  add("enfant", "noeud-cheveux", "Nœud dans les cheveux", "tete", zones(Z.p(K.bleu, "Ruban"), { st2: nuanceDe("st0", 0.12) }), noeudCheveux);
  add("enfant", "barrettes", "Barrettes", "tete", zones(Z.p(K.moutarde, "Barrettes"), { st3: Z.part(K.rubanRouge, "Strass") }), barrettes);
  add("enfant", "couronne", "Couronne", "chapeau", zones(Z.p(K.rubanRouge, "Velours"), { st2: nuanceDe("st0", 0.12), st3: Z.part(K.moutarde, "Or"), st4: Z.det(K.ciel, "Pierres") }), couronne, { bord: 46,
    notes: "Couronne de roi sur un bonnet de velours qui bombe jusqu'à v -56 : le velours couvre la calotte, le cercle d'or descend jusqu'à v 49." });
  add("enfant", "echarpe", "Écharpe", "cou", zones(Z.p(K.moutarde, "Laine"), { st2: nuanceDe("st0", 0.12), st3: Z.part(K.bleu, "Rayures") }), (F) => echarpe(F, "enfant"), { debordMax: 24 });
  add("enfant", "sac-a-dos", "Cartable", "dos", zones(Z.p(K.rose, "Toile"), { st2: nuanceDe("st0", 0.14), st3: Z.part(K.ciel, "Poche") }), (F) => sacADos(F, "enfant"));
  add("enfant", "lunettes", "Lunettes", "tete", zones(Z.p(K.bleu, "Monture")), lunettes);

  // ---------------- ADO ----------------
  add("ado", "casquette", "Casquette", "chapeau", zones(Z.p("#3A3F4B", "Tissu"), { st2: nuanceDe("st0", 0.12), st3: Z.part(K.blanc, "Patte") }), casquette(), { bord: 50, ouverture: true,
    notes: "Ouverture de réglage au-dessus de la patte : zone exclue du contrôle de calotte." });
  add("ado", "casquette-envers", "Casquette à l'envers", "chapeau", zones(Z.p(K.rubanRouge, "Tissu"), { st2: nuanceDe("st0", 0.12), st3: Z.part(K.marine, "Visière") }), casquette({ envers: true }), { bord: 50,
    notes: "Visière tournée vers l'arrière, jusqu'à v 84." });
  add("ado", "bonnet", "Bonnet à revers", "chapeau", zones(Z.p(K.moutarde, "Laine"), { st2: nuanceDe("st0", 0.1) }), bonnet(), { bord: 58 });
  add("ado", "bob", "Bob", "chapeau", zones(Z.p(K.vert, "Toile"), { st2: nuanceDe("st0", 0.1) }), bob, { bord: 44 });
  add("ado", "casque-audio", "Casque audio", "tete", zones(Z.p(K.blanc, "Coques"), { st2: nuanceDe("st0", 0.14), st3: Z.part(K.lunettes, "Coussinets") }), casqueAudio, { debordMax: 36, notes: "Arceau au-dessus de v -10 pour passer par-dessus les coiffures, écouteurs sur les oreilles (u ±82, v 74 à 128)." });
  add("ado", "lunettes", "Lunettes", "tete", zones(Z.p(K.lunettes, "Monture")), lunettes);
  add("ado", "sac-a-dos", "Sac à dos", "dos", zones(Z.p("#3A3F4B", "Toile"), { st2: nuanceDe("st0", 0.12), st3: Z.part(K.rubanRouge, "Poche") }), (F) => sacADos(F, "ado"));
  add("ado", "echarpe", "Écharpe", "cou", zones(Z.p(K.marine, "Laine"), { st2: nuanceDe("st0", 0.1), st3: Z.part(K.menthe, "Rayures") }), (F) => echarpe(F, "ado"), { debordMax: 24 });

  // ---------------- ANIMAUX ----------------
  add("chat", "collier-grelot", "Collier à grelot", "animal", zones(Z.p(K.rubanRouge, "Collier"), { st3: Z.part(K.grelot, "Grelot") }), chatColierGrelot);
  add("chat", "noeud-cou", "Nœud papillon", "animal", zones(Z.p(K.rose, "Ruban"), { st2: nuanceDe("st0", 0.14) }), chatNoeudCou);
  add("chat", "noeud-tete", "Nœud sur la tête", "animal", zones(Z.p(K.rouge, "Ruban"), { st2: nuanceDe("st0", 0.12) }), chatNoeudTete);
  add("lapin", "noeud-cou", "Nœud papillon", "animal", zones(Z.p(K.bleu, "Ruban"), { st2: nuanceDe("st0", 0.12) }), lapinNoeudCou);
  add("lapin", "collier", "Collier à médaille", "animal", zones(Z.p(K.rouge, "Collier"), { st3: Z.part(K.grelot, "Médaille") }), lapinCollier);
  add("lapin", "noeud-oreille", "Nœud à l'oreille", "animal", zones(Z.p(K.rose, "Ruban"), { st2: nuanceDe("st0", 0.14) }), lapinNoeudOreille);
  add("cheval", "licol", "Licol", "animal", zones(Z.p(K.rouge, "Sangle"), { st3: Z.part(K.gris, "Anneaux") }), chevalLicol, {
    notes: "Têtière derrière les oreilles (y 209 à 230), montants des deux côtés de la tête jusqu'aux anneaux (y 292)." });
  add("cheval", "noeud-criniere", "Nœud dans la crinière", "animal", zones(Z.p(K.ciel, "Ruban"), { st2: nuanceDe("st0", 0.14) }), chevalNoeudCriniere);
  add("cheval", "couronne-fleurs", "Couronne de fleurs", "animal", zones(Z.p(K.rose, "Fleurs"), { st2: nuanceDe("st0", 0.2), st3: Z.part("#5E9A3A", "Feuilles") }), chevalCouronneFleurs);
  return L;
}
