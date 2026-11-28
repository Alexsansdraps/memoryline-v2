// Hauts sur gabarits (27/11) : mesures de chaque famille, lues dans commun/mes.json.
// Tout est calculé rang par rang : enveloppe (union des corps), bord du torse entre
// les bras (bandes du pli), ligne des mains. Un haut se dessine sur ces lignes, une
// seule fois par famille, et tombe sur tous les gabarits sans calage.

export const FAMILLES = {
  femme: {
    prefixe: "Female", cx: 250, enc: 377, taille: 732,
    poignet: { g: 690, d: 690 }, // début de la main, mains le long des hanches
    mancheCourte: 556, encSide: 369,
    gabs: [
      ["gabarit-dos-femme-standard.svg", "gabarit-dos-femme-standard-v2.svg"],
      ["gabarit-dos-femme-fine.svg", "gabarit-dos-femme-fine.svg"],
      ["gabarit-dos-femme-ronde.svg", "gabarit-dos-femme-ronde.svg"],
      ["gabarit-dos-femme-agee.svg", "gabarit-dos-femme-agee.svg"],
    ],
    finMains: "creux", // les mains finissent au creux de la hanche
    assise: 875, rasAssise: 860,
  },
  homme: {
    prefixe: "Male", cx: 250.1, enc: 361, taille: 703,
    poignet: { g: 800, d: 800 }, // mains à plat sur l'assise
    mancheCourte: 578, encSide: 351,
    gabs: [
      ["gabarit-dos-homme-standard.svg", "gabarit-dos-homme-standard-v2.svg"],
      ["gabarit-dos-homme-mince.svg", "gabarit-dos-homme-mince.svg"],
      ["gabarit-dos-homme-rond.svg", "gabarit-dos-homme-rond.svg"],
      ["gabarit-dos-homme-age.svg", "gabarit-dos-homme-age.svg"],
    ],
    finMains: "jamais",
    assise: 865, rasAssise: 850,
  },
  enfant: {
    prefixe: "Boy", cx: 250, enc: 448, taille: 672,
    poignet: { g: 652, d: 652 },
    mancheCourte: 560, encSide: 441,
    gabs: [
      ["gabarit-dos-enfant-standard.svg", "gabarit-dos-enfant-standard-v2.svg"],
      ["gabarit-dos-enfant-fin.svg", "gabarit-dos-enfant-fin.svg"],
      ["gabarit-dos-enfant-rond.svg", "gabarit-dos-enfant-rond.svg"],
    ],
    finMains: "fixe", finMainsY: { g: 694, d: 694 },
    assise: 778, rasAssise: 767,
  },
  ado: {
    prefixe: "Teenage_Boy", cx: 275.7, enc: 375, taille: 677,
    // bras gauche tendu vers l'assise, bras droit le long du corps
    poignet: { g: 768, d: 650 },
    mancheCourte: 560, encSide: 367,
    gabs: [
      ["gabarit-dos-ado-standard.svg", "gabarit-dos-ado-standard-v2.svg"],
      ["gabarit-dos-ado-fin.svg", "gabarit-dos-ado-fin.svg"],
    ],
    finMains: "fixe", finMainsY: { g: 999, d: 697 },
    assise: 821, rasAssise: 805,
  },
};

const lerp = (a, b, t) => a + (b - a) * t;

/** Échantillons tous les 10 px → fonction continue (interpolation linéaire, constante au-delà). */
function fonction(points) {
  const ks = Object.keys(points).map(Number).sort((a, b) => a - b);
  if (!ks.length) return null;
  const f = (y) => {
    if (y <= ks[0]) return points[ks[0]];
    if (y >= ks[ks.length - 1]) return points[ks[ks.length - 1]];
    let i = 0; while (ks[i + 1] < y) i++;
    const t = (y - ks[i]) / (ks[i + 1] - ks[i]);
    return lerp(points[ks[i]], points[ks[i + 1]], t);
  };
  f.y0 = ks[0]; f.y1 = ks[ks.length - 1];
  return f;
}

/** Lissage d'un tableau par moyenne glissante sur ±r rangs (les null restent null). */
function lisser(arr, r) {
  return arr.map((v, i) => {
    if (v == null) return null;
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const w = arr[i + k]; if (w != null) { s += w; n++; } }
    return s / n;
  });
}

export function preparer(nom, mes) {
  const F = { nom, ...FAMILLES[nom] };
  const M = mes[nom];
  F.hemReq = F.taille + 30;
  F.g = F.gabs.map(([fichier, index]) => {
    const m = M[fichier];
    const g = { fichier, index, larg: m.larg, runs: m.runs };
    // pli des bras : l'ombre qui commence vers l'aisselle
    const pli = m.ombres.find((o) => o.y[0] > 450 && o.y[0] < 540);
    const grand = m.ombres.find((o) => o.y[0] < 300);
    const sg = {}, eg = {}, sd = {}, ed = {};
    for (const [ys, runs] of Object.entries(pli.runs)) {
      const y = +ys;
      for (const [a, b] of runs) {
        if (b - a < 1) continue;
        const c = (a + b) / 2;
        if (c < F.cx) { if (y < F.poignet.g + 40 && (sg[y] == null || a < sg[y])) { sg[y] = a; eg[y] = b; } }
        else if (y < F.poignet.d + 40 && (sd[y] == null || b > ed[y])) { sd[y] = a; ed[y] = b; }
      }
    }
    // bande gauche : [début = côté bras, fin = côté torse] ; bande droite : [début = côté torse, fin = côté bras]
    g.pliG = { bras: fonction(sg), torse: fonction(eg) };
    g.pliD = { torse: fonction(sd), bras: fonction(ed) };
    g.aisselle = Math.min(g.pliG.torse.y0, g.pliD.torse.y0);
    const S = {};
    for (const [ys, runs] of Object.entries(grand.runs)) if (runs.length) S[+ys] = runs[0][0];
    g.S = fonction(S);
    // fin des mains
    if (F.finMains === "creux") {
      let best = 735, bx = -1;
      for (let y = 735; y <= 765; y++) if (m.larg[y][0] > bx) { bx = m.larg[y][0]; best = y; }
      g.finMain = { g: best, d: best };
    } else if (F.finMains === "fixe") g.finMain = { ...F.finMainsY };
    else g.finMain = { g: 999, d: 999 };
    // frontière bras / torse (centre du pli), prolongée jusqu'au bout de la main
    const fr = (cote) => {
      const p = cote === "g" ? g.pliG : g.pliD;
      const yEnd = p.torse.y1;
      const xEnd = (p.torse(yEnd) + p.bras(yEnd)) / 2;
      const yM = g.finMain[cote];
      const xM = yM < 990 ? m.larg[Math.min(999, yM)][cote === "g" ? 0 : 1] : xEnd;
      return (y) => {
        if (y <= yEnd) return (p.torse(y) + p.bras(y)) / 2;
        if (yM >= 990 || yM <= yEnd) return xEnd;
        return lerp(xEnd, xM, Math.min(1, (y - yEnd) / (yM - yEnd)));
      };
    };
    g.frontG = fr("g"); g.frontD = fr("d");
    return g;
  });
  F.aisselle = Math.min(...F.g.map((g) => g.aisselle));
  F.aisselleMax = Math.max(...F.g.map((g) => g.aisselle));
  F.finMainMax = { g: Math.max(...F.g.map((g) => g.finMain.g)), d: Math.max(...F.g.map((g) => g.finMain.d)) };

  // enveloppe : union des corps, lissée puis élargie d'un pixel pour être sûr de couvrir
  const eg = [], ed = [];
  for (let y = 0; y < 1000; y++) {
    let a = null, b = null;
    for (const g of F.g) { const L = g.larg[y]; if (!L) continue; a = a == null ? L[0] : Math.min(a, L[0]); b = b == null ? L[1] : Math.max(b, L[1]); }
    eg.push(a); ed.push(b);
  }
  // minimum glissant puis moyenne, pour ne jamais passer à l'intérieur d'un corps
  const minG = eg.map((v, i) => v == null ? null : Math.min(...[-1, 0, 1].map((k) => eg[i + k] ?? v)));
  const maxD = ed.map((v, i) => v == null ? null : Math.max(...[-1, 0, 1].map((k) => ed[i + k] ?? v)));
  const lg = lisser(minG, 2), ld = lisser(maxD, 2);
  // l'épaule suit la voûte des âgés (la plus haute) : le col passe dessus, et sur
  // les autres corps l'épaule du haut flotte de quelques pixels, sans marche
  const iy = (y) => Math.max(0, Math.min(999, Math.round(y)));
  F.envG = (y) => lg[iy(y)] - 0.8;
  F.envD = (y) => ld[iy(y)] + 0.8;

  // bord du torse : au-dessus du poignet, le plus à l'extérieur des débuts de torse
  // (aucune peau de torse visible) ; entre poignet et bout des mains, la ligne des mains
  // la plus intérieure (aucune main couverte) ; plus bas, l'enveloppe (hanches).
  const yA = F.aisselleMax;
  F.torseG = (y, m = 1.5) => {
    const yy = Math.max(y, yA);
    if (y < F.poignet.g) return Math.min(...F.g.map((g) => g.pliG.torse(yy))) - 1;
    if (y <= F.finMainMax.g) return Math.max(...F.g.map((g) => g.frontG(y))) + 1.5;
    return F.envG(y) - m;
  };
  F.torseD = (y, m = 1.5) => {
    const yy = Math.max(y, yA);
    if (y < F.poignet.d) return Math.max(...F.g.map((g) => g.pliD.torse(yy))) + 1;
    if (y <= F.finMainMax.d) return Math.min(...F.g.map((g) => g.frontD(y))) - 1.5;
    return F.envD(y) + m;
  };
  // bord intérieur d'une manche qui descend plus bas que l'ourlet : elle couvre le bras
  // de TOUS les corps (jusqu'au début du torse le plus rentré) et frôle la hanche des autres
  F.brasG = (y) => Math.max(...F.g.map((g) => g.pliG.torse(Math.max(y, yA)))) + 1;
  F.brasD = (y) => Math.min(...F.g.map((g) => g.pliD.torse(Math.max(y, yA)))) - 1;
  F.S = F.g[0].S; // grande ombre du dos du corps standard
  // cou : bords du cou du standard
  F.couG = (y) => F.g[0].larg[Math.round(y)][0];
  F.couD = (y) => F.g[0].larg[Math.round(y)][1];
  return F;
}
