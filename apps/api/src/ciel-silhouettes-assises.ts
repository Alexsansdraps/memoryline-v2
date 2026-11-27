/**
 * Les personnages du ciel étoilé, ASSIS dans l'herbe (27/11, Alexandra,
 * devant les silhouettes debout : « je les veux assis les personnages !!!
 * qui regardent bien, tu pourrais mettre des petits détails en ombre aussi
 * pour eux »).
 *
 * Mêmes ids, même ordre, même dessin que ciel-silhouettes.ts (ombres
 * chinoises en centimètres réels, contours en courbes douces, membres tracés
 * par leur axe, un seul <path> sans contour), mais chacun est assis par
 * terre, vu de dos ou de trois quarts dos, la tête bien levée vers les
 * étoiles : la base (fesses, jambes, mains posées) est sur y = 0. Une
 * personne assise mesure environ 90 cm du sol au sommet du crâne, un enfant
 * une soixantaine, le chien assis une soixantaine aussi.
 *
 * Les poses : jambes repliées et bras autour des genoux, appuyée en arrière
 * sur les mains, en tailleur les mains croisées derrière la nuque, un genou levé et
 * l'avant-bras posé dessus, un bras qui montre le ciel ; l'enfant sur les
 * genoux d'un adulte (au lieu des épaules), le bébé dans les bras, le couple
 * épaule contre épaule, sa tête à elle penchée vers lui.
 *
 * detailsAutour() dessine, dans la même couleur pleine, les petits détails
 * de la scène autour du groupe : un plaid, des touffes d'herbe, une lanterne, un panier
 * de pique-nique (baguette, thermos, mug fumant), une petite lunette sur trépied. Toujours les
 * mêmes, sans réglage pour la cliente.
 *
 * Les petites fonctions de dessin sont recopiées de ciel-silhouettes.ts
 * (qui ne les exporte pas) : si l'une change là-bas, la changer ici.
 *
 * Pas encore branché : la fiche et l'API viendront ensuite.
 */

import type { Silhouette } from "./ciel-silhouettes.js";

/** Un point du dessin ; le troisième chiffre (1) en fait un angle vif. */
type P = readonly [number, number] | readonly [number, number, 1];
/** Un point de l'axe d'un membre et sa demi-épaisseur. */
type A = readonly [number, number, number];

function aire(p: readonly P[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % p.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

const r2 = (v: number) => String(Math.round(v * 100) / 100);

/** Un contour fermé en courbes douces, toujours dans le même sens. */
const ferme = (points: readonly P[]): string => fermeBrut(aire(points) < 0 ? [...points].reverse() : points);

/** Le même contour dans l'autre sens : avec la règle « nonzero », il fait un trou. */
const trou = (points: readonly P[]): string => fermeBrut(aire(points) < 0 ? points : [...points].reverse());

/** Un contour fermé en courbes douces, tel qu'il est donné. */
function fermeBrut(p: readonly P[]): string {
  const n = p.length;
  const k = 1 / 6;
  let d = `M${r2(p[0]![0])} ${r2(p[0]![1])}`;
  for (let i = 0; i < n; i++) {
    const a = p[(i - 1 + n) % n]!;
    const b = p[i]!;
    const c = p[(i + 1) % n]!;
    const e = p[(i + 2) % n]!;
    const c1 = b[2] ? b : [b[0] + (c[0] - a[0]) * k, b[1] + (c[1] - a[1]) * k];
    const c2 = c[2] ? c : [c[0] - (e[0] - b[0]) * k, c[1] - (e[1] - b[1]) * k];
    d += `C${r2(c1[0]!)} ${r2(c1[1]!)} ${r2(c2[0]!)} ${r2(c2[1]!)} ${r2(c[0])} ${r2(c[1])}`;
  }
  return `${d}Z`;
}

/** Un ovale (tête, chignon…), penché de `deg` degrés ; `bosse` le rend ébouriffé. */
function ovale(cx: number, cy: number, rx: number, ry: number, deg = 0, n = 14, bosse = 0): P[] {
  const t = (deg * Math.PI) / 180;
  const out: P[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const f = 1 + bosse * Math.sin(a * 7 + 0.6) + bosse * 0.6 * Math.sin(a * 11);
    const x = Math.cos(a) * rx * f;
    const y = Math.sin(a) * ry * f;
    out.push([cx + x * Math.cos(t) - y * Math.sin(t), cy + x * Math.sin(t) + y * Math.cos(t)]);
  }
  return out;
}

/** Un membre tracé par son axe : bras, jambe, queue de cheval, queue du chien. */
function membre(axe: readonly A[]): P[] {
  const n = axe.length;
  const dir = (i: number) => {
    const a = axe[Math.max(0, i - 1)]!;
    const b = axe[Math.min(n - 1, i + 1)]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l] as const;
  };
  const g: P[] = [];
  const d: P[] = [];
  axe.forEach(([x, y, w], i) => {
    const [ux, uy] = dir(i);
    g.push([x - uy * w, y + ux * w]);
    d.push([x + uy * w, y - ux * w]);
  });
  const [ux0, uy0] = dir(0);
  const [ux1, uy1] = dir(n - 1);
  const a0 = axe[0]!;
  const a1 = axe[n - 1]!;
  return [[a0[0] - ux0 * a0[2] * 0.85, a0[1] - uy0 * a0[2] * 0.85], ...g, [a1[0] + ux1 * a1[2] * 0.85, a1[1] + uy1 * a1[2] * 0.85], ...d.reverse()];
}

/** Un corps entier à partir de sa moitié droite (du haut, x = 0, au bas, x = 0). */
function symetrique(demi: readonly P[]): P[] {
  const autre = demi
    .slice(1, -1)
    .reverse()
    .map((p): P => (p[2] ? [-p[0], p[1], 1] : [-p[0], p[1]]));
  return [...demi, ...autre];
}

const miroir = (pts: readonly P[]): P[] => pts.map((p): P => (p[2] ? [-p[0], p[1], 1] : [-p[0], p[1]]));
const miroirAxe = (axe: readonly A[]): A[] => axe.map(([x, y, w]): A => [-x, y, w]);
const decale = (pts: readonly P[], dx: number, dy = 0): P[] =>
  pts.map((p): P => (p[2] ? [p[0] + dx, p[1] + dy, 1] : [p[0] + dx, p[1] + dy]));

/** Fait tourner des points de `deg` degrés autour de (cx, cy) (sens horaire à l'écran). */
function tourne(pts: readonly P[], cx: number, cy: number, deg: number): P[] {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return pts.map((p): P => {
    const x = p[0] - cx;
    const y = p[1] - cy;
    const q: [number, number] = [cx + x * c - y * s, cy + x * s + y * c];
    return p[2] ? [q[0], q[1], 1] : q;
  });
}

/**
 * La tête levée vers le ciel, en profil perdu (voir ciel-silhouettes.ts).
 * Assis, on lève la tête plus franchement que debout : 38° par défaut au lieu
 * de 32, le nez pointe vers les étoiles et la nuque se dégage.
 */
function teteLevee(cx: number, cy: number, rx: number, ry: number, sens: 1 | -1 = 1, bascule = 38): P[] {
  const profil: P[] = [
    [0, -ry],
    [rx * 0.6, -ry * 0.88],
    [rx * 0.93, -ry * 0.52], // front
    [rx * 1.03, -ry * 0.18], // arcade
    [rx + 2.3, ry * 0.12, 1], // bout du nez
    [rx + 0.9, ry * 0.36],
    [rx + 1.2, ry * 0.6], // menton
    [rx * 0.72, ry * 0.88], // dessous du menton
    [rx * 0.3, ry * 1.02],
    [-rx * 0.35, ry * 1.0],
    [-rx * 0.82, ry * 0.68],
    [-rx * 1.02, ry * 0.12],
    [-rx * 0.92, -ry * 0.48],
    [-rx * 0.55, -ry * 0.88],
  ];
  return tourne(
    profil.map((p): P => (p[2] ? [cx + p[0] * sens, cy + p[1], 1] : [cx + p[0] * sens, cy + p[1]])),
    cx,
    cy,
    angleTete(sens, bascule),
  );
}
const angleTete = (sens: 1 | -1, bascule = 38) => -bascule * sens;

/** Les cheveux qui couvrent le crâne d'une tête levée (voir ciel-silhouettes.ts). */
function calotte(cx: number, cy: number, rx: number, ry: number, sens: 1 | -1, bascule = 38): P[] {
  const pts: P[] = [
    [0, -ry - 1.3],
    [rx * 0.7, -ry - 0.5],
    [rx * 0.98 + 0.4, -ry * 0.55],
    [rx * 0.72, -ry * 0.12],
    [rx * 0.5, ry * 0.42],
    [rx * 0.35, ry * 0.98],
    [-rx * 0.5, ry * 1.08],
    [-rx - 1.3, ry * 0.3],
    [-rx - 1.2, -ry * 0.42],
    [-rx * 0.62, -ry - 0.6],
  ];
  return tourne(
    pts.map((p): P => [cx + p[0] * sens, cy + p[1]]),
    cx,
    cy,
    angleTete(sens, bascule),
  );
}

/** Une chevelure longue qui tombe dans le dos, de la nuque jusqu'à `bas`. */
function chevelure(cx: number, cy: number, sens: 1 | -1, large: number, bas: number): P[] {
  const h = bas - cy;
  const pts: P[] = [
    [4.4, cy + 3.2],
    [7.4, cy + 7],
    [large - 1.6, cy + h * 0.3],
    [large - 0.6, cy + h * 0.6],
    [large, cy + h * 0.86],
    [large - 1.2, bas + 0.6, 1],
    [large - 3, bas - 1.4],
    [large * 0.55, bas + 1.2, 1],
    [large * 0.38, bas - 1.2],
    [large * 0.18, bas + 1.6, 1],
    [-large * 0.05, bas - 0.6],
    [-large * 0.26, bas + 1.4, 1],
    [-large * 0.45, bas - 1.0],
    [-large * 0.68, bas + 1.0, 1],
    [-large * 0.86, bas - 1.4],
    [-large - 0.2, bas + 0.4, 1],
    [-large - 0.3, cy + h * 0.8],
    [-large + 0.6, cy + h * 0.45],
    [-large + 1.4, cy + h * 0.15],
    [-9.4, cy - 1],
    [-6.4, cy - 5.6],
    [-1, cy - 4.6],
  ];
  return pts.map((p): P => (p[2] ? [cx + p[0] * sens, p[1], 1] : [cx + p[0] * sens, p[1]]));
}

function forme(id: string, nom: string, ...contours: P[][]): Silhouette {
  let gauche = Infinity;
  let droite = -Infinity;
  let haut = Infinity;
  for (const c of contours)
    for (const p of c) {
      gauche = Math.min(gauche, p[0]);
      droite = Math.max(droite, p[0]);
      haut = Math.min(haut, p[1]);
    }
  return { id, nom, d: contours.map(ferme).join(""), gauche, droite, haut };
}

/* ------------------------------------------------------------------ */
/* Pièces communes                                                      */
/* ------------------------------------------------------------------ */

/**
 * Le buste d'un adulte assis, vu de dos (moitié droite) : nuque à `haut`
 * (environ −60), épaules, taille, et les hanches qui s'étalent sur l'herbe.
 * `epaule` : demi-largeur aux épaules ; `assise` : demi-largeur au sol.
 */
function busteAssis(haut: number, epaule: number, taille: number, assise: number): P[] {
  const h = -haut;
  return [
    [0, haut],
    [epaule * 0.32, haut - 0.4],
    [epaule * 0.6, haut + 1.4],
    [epaule * 0.86, haut + 3.8],
    [epaule, haut + 7.4],
    [epaule - 0.1, haut + 13],
    [(epaule + taille) / 2, h * -0.62],
    [taille, h * -0.46], // taille
    [taille + (assise - taille) * 0.45, h * -0.3],
    [assise - 1, h * -0.14],
    [assise, -2.6],
    [assise - 1.2, 0, 1],
    [0, 0],
  ];
}

/**
 * Une jambe repliée, genou levé, vue de trois quarts : de la hanche au genou,
 * du genou à la cheville, et la chaussure. `sens` = 1 : la jambe part à droite.
 */
function jambeRepliee(hx: number, kx: number, ky: number, ax: number, epais = 1, sens: 1 | -1 = 1): [P[], P[]] {
  const s = sens;
  const e = epais;
  const jambe = membre([
    [hx * s, -9, 9 * e],
    [(hx + (kx - hx) * 0.45) * s, -9 + (ky + 9) * 0.45, 8 * e],
    [(kx - 1.6) * s, ky + 1.6, 6.6 * e], // genou
    [kx * s, ky + 0.4, 6.2 * e],
    [(kx + (ax - kx) * 0.35) * s, ky * 0.66, 5.4 * e],
    [(kx + (ax - kx) * 0.75) * s, ky * 0.33, 4.6 * e], // mollet
    [ax * s, -8, 4 * e], // cheville
  ]);
  const chaussure: P[] = [
    [(ax - 4.2) * s, -9],
    [(ax + 1.4) * s, -9.4],
    [(ax + 6.4) * s, -5.2],
    [(ax + 8) * s, -1.6],
    [(ax + 7.4) * s, 0, 1],
    [(ax - 4.6) * s, 0, 1],
    [(ax - 5) * s, -4],
  ];
  return [jambe, chaussure];
}

/** Un bras tendu en arrière, la main à plat sur l'herbe (appuyé sur les mains). */
function brasAppui(epX: number, epY: number, mainX: number, manche = 0): A[] {
  const dx = mainX - epX;
  const dy = -epY;
  return [
    [epX - 1, epY + 3, 4.6 + manche],
    [epX + dx * 0.2, epY + dy * 0.2, 4.4 + manche],
    [epX + dx * 0.45, epY + dy * 0.45, 3.9 + manche * 0.9], // coude, presque tendu
    [epX + dx * 0.7, epY + dy * 0.7, 3.4 + manche * 0.7],
    [epX + dx * 0.88, epY + dy * 0.86, 2.7 + manche * 0.5], // poignet
    [epX + dx * 0.94, -2.6, 3.2], // paume
    [mainX + 2.4 * Math.sign(dx || 1), -0.8, 2.2], // doigts
  ];
}

/* ------------------------------------------------------------------ */
/* Les silhouettes assises                                              */
/* ------------------------------------------------------------------ */

/** Femme aux cheveux longs, veste, jean : genoux repliés, bras autour des genoux. */
function femmeCheveuxLongs(): Silhouette {
  const corps = symetrique(busteAssis(-61, 17.2, 13.2, 19.4));
  const [jambe, chaussure] = jambeRepliee(9, 31, -41, 41);
  // L'autre jambe, un rien en retrait : son genou fait une seconde bosse.
  const [jambe2, chaussure2] = jambeRepliee(4, 26.5, -38.6, 35.4);
  const cou = ovale(0, -63, 4.8, 4.6);
  const tete = teteLevee(0.6, -74.6, 7.6, 9.2, 1, 40);
  const cheveux = [calotte(0.6, -74.6, 7.6, 9.2, 1, 40), chevelure(0.6, -74.6, 1, 11.6, -38)];
  // Le bras droit entoure les genoux ; la main dépasse devant le tibia.
  const bras: A[] = [
    [14.6, -55, 4.5],
    [19.2, -49, 4.2],
    [23.4, -42.6, 3.8], // coude
    [27.6, -36.6, 3.4],
    [32.6, -32.2, 3.0], // poignet
    [36.2, -30.6, 3.2], // main
    [39.4, -31, 2.0],
  ];
  // Le bras gauche part en avant : de dos, seul le haut se voit.
  const brasG: A[] = [
    [-14.6, -55, 4.5],
    [-17.4, -48, 4.2],
    [-17.6, -42, 3.6],
  ];
  return forme(
    "femme-cheveux-longs",
    "Femme, cheveux longs",
    corps,
    jambe2,
    chaussure2,
    jambe,
    chaussure,
    cou,
    tete,
    ...cheveux,
    membre(bras),
    membre(brasG),
  );
}

/** Femme au chignon, manteau long, écharpe : appuyée en arrière sur les mains, un genou levé. */
function femmeChignon(): Silhouette {
  // Le manteau s'étale sur l'herbe autour d'elle.
  const manteau = symetrique([
    [0, -60],
    [6, -60.4],
    [11.2, -59],
    [15.6, -56.6],
    [18, -53],
    [18, -47],
    [16, -39],
    [14.4, -30], // ceinture
    [16, -22],
    [19.4, -12],
    [22.6, -4],
    [24.6, 0, 1],
    [0, 0],
  ]);
  // Le genou gauche levé, la bottine posée devant ; l'autre jambe allongée, cachée.
  const jambe = membre([
    [-14, -8, 8.6],
    [-22, -18, 7.4],
    [-29.4, -27.6, 6.4], // genou, sous le pan du manteau
    [-31.2, -28.2, 6.0],
    [-35.4, -20, 5.0],
    [-39, -11, 4.2], // cheville
  ]);
  const bottine: P[] = [
    [-34.6, -14],
    [-40.6, -15.6],
    [-44.6, -8],
    [-47.8, -2.6],
    [-47, 0, 1],
    [-35.6, 0, 1],
    [-35.2, -6],
  ];
  // Le pan du manteau qui tombe de la cuisse.
  const pan: P[] = [
    [-15, -20],
    [-24.4, -29.4],
    [-29.6, -31.6],
    [-30.6, -26, 1],
    [-27.4, -14],
    [-24, -4],
    [-19, -2, 1],
  ];
  const tete = teteLevee(0, -75, 7.4, 9.2, -1, 40);
  const cheveux = calotte(0, -75, 7.4, 9.2, -1, 40);
  const chignon = tourne(ovale(0.4, -85, 5.2, 4.2, -8, 14, 0.04), 0, -75, angleTete(-1, 40));
  const echarpe = symetrique([
    [0, -67.6],
    [5.4, -67.2],
    [8.6, -64.6],
    [9.6, -61],
    [8, -58.4],
    [0, -57.8],
  ]);
  const panEcharpe = membre([
    [7.6, -61, 3.2],
    [10.6, -54, 3.4],
    [11.4, -46, 3.1],
    [11, -40, 2.8],
  ]);
  const brasD = brasAppui(16.2, -53, 33.6, 1.1); // mains bien en arrière et écartées : de dos, des bras d'appui se lisaient comme des bras ballants
  const brasG = miroirAxe(brasD);
  return forme(
    "femme-chignon",
    "Femme, chignon et manteau",
    manteau,
    jambe,
    bottine,
    pan,
    tete,
    cheveux,
    chignon,
    echarpe,
    panEcharpe,
    membre(brasD),
    membre(brasG),
  );
}

/** Homme en manteau, col relevé : assis en tailleur, les mains croisées derrière la nuque. */
function hommeManteau(): Silhouette {
  // Le manteau, et les genoux qui débordent de chaque côté, posés dans l'herbe.
  const manteau = symetrique([
    [0, -63.6],
    [6.8, -64.4], // col relevé
    [8.4, -61.8],
    [13.4, -60.4],
    [18.8, -58.2],
    [21.6, -54.4],
    [21.8, -48],
    [19.8, -38],
    [18.8, -28],
    [19.8, -19],
    [24, -14.6], // la cuisse
    [31, -14.2],
    [37.6, -13.6], // genou
    [41.6, -10.6],
    [42.2, -5.4],
    [39.6, -1.6],
    [33, 0, 1],
    [0, 0],
  ]);
  const tete = teteLevee(0, -76.2, 7.9, 9.8, 1, 40);
  const oreille = tourne(ovale(-7.7, -75, 1.6, 2.9, 12, 10), 0, -76.2, angleTete(1, 40));
  const cou = ovale(0, -65.2, 5.9, 4.6);
  // Les mains croisées derrière la nuque, les coudes ouverts en ailes : la
  // pose de celui qui s'installe pour regarder longtemps (en tailleur, les
  // mains sur les genoux, il avait l'air de méditer).
  const bras: A[] = [
    [17.6, -56.4, 5.8],
    [22.6, -61, 5.5],
    [27.4, -66.4, 5.0],
    [29.6, -69.6, 4.6], // coude, en l'air
    [26.4, -72.6, 4.2],
    [19.6, -75, 3.8],
    [12.6, -76.4, 3.4], // poignet, derrière la tête
    [6, -77, 3.6], // les doigts croisés sur la nuque
  ];
  return forme("homme-manteau", "Homme en manteau", manteau, tete, oreille, cou, membre(bras), membre(miroirAxe(bras)));
}

/** Homme au bonnet, doudoune, jean : un genou levé, l'avant-bras posé dessus, appuyé sur l'autre main. */
function hommeBonnet(): Silhouette {
  const corps = symetrique([
    [0, -62],
    [6.6, -62.4],
    [12, -60.4],
    [17.6, -57.6],
    [21.2, -53],
    [21.8, -46],
    [20, -38],
    [20.8, -30], // les boudins de la doudoune
    [19.6, -22],
    [20.6, -15],
    [21.4, -8],
    [22.4, -2.4],
    [21.4, 0, 1],
    [0, 0],
  ]);
  const [jambe, chaussure] = jambeRepliee(11, 33, -46, 44, 1.05);
  const tete = teteLevee(0, -73.4, 7.8, 9.4, 1, 40);
  const bonnet = tourne(
    symetrique([
      [0, -87.6],
      [3.8, -87],
      [7, -84.6],
      [8.8, -80.4],
      [9.5, -76.6],
      [9.8, -75.4],
      [9.9, -73.6],
      [9.1, -72.4],
      [0, -73],
    ]),
    0,
    -73.4,
    angleTete(1, 40),
  );
  const pompon = tourne(ovale(0.6, -91, 5.4, 4.9, 0, 30, 0.07), 0, -73.4, angleTete(1, 40));
  const cou = ovale(0, -62.6, 6, 5.4);
  // Le bras droit, coude sur le genou, la main qui pend au-delà.
  const brasD: A[] = [
    [18, -55, 6.6],
    [23, -53.6, 6.2],
    [29, -53.2, 5.6], // coude, posé sur le genou
    [35, -53.4, 4.6],
    [41.4, -52.4, 3.8], // poignet, au-delà du genou
    [45, -49.6, 3.6], // main, qui pend
    [46.6, -45.6, 2.8],
    [47, -42.6, 1.8],
  ];
  // Le bras gauche tendu en arrière, la main dans l'herbe.
  const brasG = miroirAxe(brasAppui(18, -54, 30, 1.9));
  return forme(
    "homme-bonnet",
    "Homme au bonnet",
    corps,
    jambe,
    chaussure,
    cou,
    tete,
    bonnet,
    pompon,
    membre(brasD),
    membre(brasG),
  );
}

/** Enfant de six à huit ans, capuche, parka, bottes : jambes allongées, mains dans l'herbe. */
function enfant(): Silhouette {
  const corps = symetrique([
    [0, -40.6],
    [5.6, -41],
    [9.6, -39.8],
    [12.2, -37.2],
    [13, -32.6],
    [12.4, -26],
    [12, -18],
    [12.8, -10],
    [13.6, -3, 1], // bas de la parka
    [12.6, 0, 1],
    [0, 0],
  ]);
  // Les jambes allongées devant, vers la gauche ; les bottes pointent vers le ciel.
  // Le genou un peu levé : de loin, une jambe allongée à plat se confondait
  // avec l'herbe ; ainsi pliée, elle se lit.
  const jambes = membre([
    [-8, -7.4, 7],
    [-13.6, -11.6, 6.0],
    [-19.4, -15.4, 5.4], // genou
    [-25, -12.6, 4.8],
    [-30.6, -8.4, 4.2],
    [-34, -6.6, 3.8], // cheville
  ]);
  // La grosse botte de pluie, la semelle tournée vers nous, la pointe en l'air.
  const bottes: P[] = [
    [-31.4, -10.6],
    [-35.2, -11.6],
    [-37.8, -14.8],
    [-40.6, -16.4],
    [-42.6, -14.6],
    [-42.8, -8.6],
    [-41.8, -2.8],
    [-40, 0, 1],
    [-31, 0, 1],
    [-30.2, -5],
  ];
  const tete = teteLevee(0, -52.4, 7.2, 8.6, -1, 42);
  const capuche = tourne(
    [
      [-5.2, -63],
      [0, -64.4],
      [5.6, -63.2],
      [9.4, -59],
      [10.6, -52],
      [10.2, -45.6],
      [8.4, -41.6],
      [0, -40.6],
      [-5.6, -42.4],
      [-6, -46],
      [-6.6, -52],
      [-7.2, -58.4],
    ],
    0,
    -52.4,
    angleTete(-1, 42),
  );
  // Le pompon au bout de la capuche.
  const pompon = tourne(ovale(-0.6, -66.4, 3.4, 3.1, 0, 26, 0.08), 0, -52.4, angleTete(-1, 42));
  const col = symetrique([
    [0, -43.6],
    [6.8, -43],
    [10.8, -40.4],
    [11.8, -37.6],
    [0, -37],
  ]);
  // Les bras tendus en arrière, les moufles posées dans l'herbe.
  const bras: A[] = [
    [11.6, -36, 4.0],
    [14, -28, 3.7],
    [15.8, -20, 3.3], // coude
    [17, -12, 3.0],
    [17.6, -6.6, 2.8], // poignet
    [18, -3, 3.2], // moufle
    [19.4, -1, 2.0],
  ];
  return forme("enfant", "Enfant", corps, jambes, bottes, col, tete, capuche, pompon, membre(bras), membre(miroirAxe(bras)));
}

/** Un adulte assis, l'enfant sur ses genoux ; l'enfant montre le ciel. */
function enfantSurEpaules(): Silhouette {
  // Le porteur : pull, jean, assis à moitié en tailleur.
  const porteur = symetrique(busteAssis(-62, 18.4, 15.4, 20));
  const tete = teteLevee(0, -75.6, 7.9, 9.6, 1, 36);
  const cheveux = calotte(0, -75.6, 7.9, 9.6, 1, 36);
  const cou = ovale(0, -64, 6, 4.6);
  // Sa jambe gauche repliée à plat ; sa cuisse droite sous l'enfant.
  const jambeG = membre([
    [-12, -8, 8.6],
    [-24, -9.4, 7.6],
    [-35, -9, 6.4], // genou
    [-38.4, -5, 5.2],
    [-34, -3.2, 4.4],
  ]);
  const jambeD = membre([
    [10, -9, 9],
    [22, -13, 8.2],
    [34, -15.6, 7.0],
    [41, -15.4, 6.4], // genou
    [45, -9, 5.2],
    [46, -4.2, 4.8],
  ]);
  const pied = ovale(47.6, -2.6, 6.4, 2.8, 0, 12);
  // L'enfant (5 ans), assise sur la cuisse, le dos contre le bras de l'adulte.
  const X = 32;
  const S = -17; // son assise
  const dos = decale(
    symetrique([
      [0, -27.4],
      [5, -27.8],
      [8.8, -26.4],
      [10.6, -23.4],
      [10.6, -18],
      [9.6, -11],
      [9.4, -4],
      [10, -1.4],
      [9, 0, 1],
      [0, 0],
    ]),
    X,
    S,
  );
  const teteEnfant = teteLevee(X, S - 36.4, 6.6, 8, 1, 44);
  const couettes = [ovale(X - 7.4, S - 32.4, 2.7, 3.6, 30, 12), ovale(X + 5.6, S - 40, 2.6, 3.4, -50, 12)].map((c) =>
    tourne(c, X, S - 36.4, angleTete(1, 44)),
  );
  const cuEnfant = ovale(X, S - 28, 4.2, 3.6);
  // Ses jambes pendent par-dessus le genou de l'adulte.
  const jambeEnfant = membre([
    [X + 6, S - 2, 4.6],
    [X + 12, S - 1, 4.0],
    [X + 16.4, S + 3.4, 3.4],
    [X + 18, S + 8, 3.0],
  ]);
  const chaussureEnfant = ovale(X + 19.6, S + 10.4, 3.8, 2.4, 20, 10);
  const brasMontre: A[] = [
    [X + 8.6, S - 24.6, 3.0],
    [X + 12.6, S - 32, 2.7],
    [X + 16.2, S - 39.6, 2.4], // coude
    [X + 19.4, S - 47.6, 2.0],
    [X + 20.8, S - 51.4, 2.2], // poing
    [X + 22.6, S - 56, 0.9], // index
  ];
  // Le bras droit de l'adulte la tient par la taille.
  const brasTient: A[] = [
    [16.6, -55, 5.2],
    [20.6, -48, 4.8],
    [22.6, -40, 4.3], // coude
    [26, -31.6, 3.8],
    [31, -27.6, 3.3], // poignet
    [36.6, -26.6, 3.4], // main sur sa hanche
    [40.6, -27.4, 2.2],
  ];
  // Le bras gauche de l'adulte posé sur son genou.
  const brasGenou: A[] = [
    [-16.6, -55, 5.2],
    [-20.4, -46, 4.9],
    [-22.6, -37, 4.4], // coude
    [-25.6, -27, 3.8],
    [-29.6, -17.4, 3.2], // poignet
    [-32, -14.6, 3.4],
    [-34.4, -13, 2.2],
  ];
  return forme(
    "enfant-sur-epaules",
    "Enfant sur les genoux",
    porteur,
    jambeG,
    jambeD,
    pied,
    cou,
    tete,
    cheveux,
    membre(brasGenou),
    dos,
    cuEnfant,
    teteEnfant,
    ...couettes,
    jambeEnfant,
    chaussureEnfant,
    membre(brasMontre),
    membre(brasTient),
  );
}

/** Une femme assise les jambes repliées sur le côté, un bébé dans les bras, contre son épaule. */
function adulteBebe(): Silhouette {
  const corps = symetrique(busteAssis(-61, 17.4, 14, 19.6));
  // Les jambes repliées sur le côté gauche, les pieds ramenés.
  const jambes = membre([
    [-12, -8.6, 8.8],
    [-24, -10.4, 7.6],
    [-33.6, -10.4, 6.6], // genou
    [-38, -6.4, 5.6],
    [-35.6, -3.6, 4.6],
    [-28, -3.2, 3.8], // cheville, ramenée vers elle
  ]);
  const pied = ovale(-25.6, -2.6, 5, 2.4, 0, 12);
  const tete = teteLevee(0, -73.2, 7.6, 9.2, 1, 38);
  const cou = ovale(0, -62.6, 5, 4.6);
  const calotteCarre = calotte(0, -73.2, 7.6, 9.2, 1, 38);
  const carre: P[] = decale(
    [
      [-1, -159.6],
      [3.6, -156],
      [6.2, -151],
      [7.6, -146.4],
      [7.2, -144, 1],
      [0, -144.8],
      [-7.4, -144.2, 1],
      [-10.6, -146.2],
      [-10.4, -152],
      [-8.4, -158.4],
    ],
    0,
    81.4,
  );
  // Le bébé contre son épaule gauche, la tête qui dépasse, une menotte sur
  // l'épaule et une jambe potelée sous le coude.
  // La tête du bébé, plus petite et posée plus bas et plus au bord que la
  // sienne (elles se confondaient en une seconde tête), coiffée d'un bonnet
  // à pompon : c'est le pompon qui dit « bébé » de loin.
  const bebe = ovale(-15.4, -64.4, 6.0, 6.3, -10, 16);
  const nuqueBebe = ovale(-15, -58.4, 4.4, 3.4);
  const bonnetBebe: P[] = [
    [-21.2, -65.6],
    [-20.6, -69.8],
    [-17.6, -72.4],
    [-14.4, -73],
    [-11.2, -71.6],
    [-9.4, -68.6],
    [-9.2, -66],
  ];
  const pomponBebe = ovale(-18.8, -74.4, 2.7, 2.5, 0, 24, 0.09);
  const jambeBebe = membre([
    [-16.4, -31, 3.4],
    [-20, -27.4, 3.0],
    [-22.4, -23, 2.5],
    [-23, -19.8, 2.3],
    [-22.2, -17.2, 1.8],
  ]);
  const menotte: A[] = [
    [-19.4, -60.4, 1.7],
    [-22.4, -58.4, 1.6],
    [-24, -56.6, 1.9],
    [-25, -55, 1.2],
  ];
  const bras: A[] = [
    [15.6, -55, 4.6],
    [17.6, -46, 4.3],
    [18.8, -37, 3.9],
    [18.8, -30, 3.7], // coude
    [17, -25, 3.3],
  ];
  return forme(
    "adulte-bebe",
    "Adulte et bébé",
    corps,
    jambes,
    pied,
    cou,
    tete,
    calotteCarre,
    carre,
    nuqueBebe,
    bebe,
    bonnetBebe,
    pomponBebe,
    jambeBebe,
    membre(menotte),
    membre(bras),
    membre(miroirAxe(bras)),
  );
}

/** Jeune femme à queue de cheval, jupe, bottes : appuyée sur une main, elle montre le ciel. */
function montreLeCiel(): Silhouette {
  const corps = symetrique([
    [0, -60.6],
    [5.4, -61],
    [10.4, -59.2],
    [14.8, -56.6],
    [17, -53],
    [16.8, -47.6],
    [15, -40],
    [13.4, -31],
    [12.6, -24.4], // taille
    [15.6, -18],
    [19.4, -9],
    [21.8, -2.6],
    [21, 0, 1],
    [0, 0],
  ]);
  // Les genoux levés, à droite ; la jupe s'arrête au genou, collants et bottes.
  const [jambe, botte] = jambeRepliee(9, 31.6, -38, 41.6, 0.86);
  const [jambe2, botte2] = jambeRepliee(4, 27, -35.4, 36, 0.86);
  const jupe: P[] = [
    [8, -26],
    [18, -33],
    [27.4, -40.6],
    [33, -42.2, 1],
    [30.4, -35],
    [22, -24],
    [17, -12],
  ];
  const tete = teteLevee(0.4, -72.2, 7.4, 9.2, 1, 46);
  const cheveux = calotte(0.4, -72.2, 7.4, 9.2, 1, 46);
  const cou = ovale(0, -62, 4.8, 4.6);
  const queue: A[] = [
    [-2, -77, 2.6],
    [-6.4, -71.4, 3.2],
    [-9.8, -65.2, 3.0],
    [-11.2, -58.4, 2.4],
    [-10.8, -51.6, 1.4],
    [-9.4, -47.6, 0.5],
  ];
  // Appuyée sur la main gauche.
  const brasPose = miroirAxe(brasAppui(15.2, -54, 27));
  // Le bras droit tendu vers le ciel, l'index pointé.
  const brasLeve: A[] = [
    [14.4, -56, 4.6],
    [19.4, -62, 4.2],
    [25, -69.4, 3.7],
    [30, -76.6, 3.4], // coude
    [35.4, -84.8, 3.0],
    [40.4, -93, 2.5], // poignet
    [42.6, -96.6, 2.9], // poing
    [44.4, -99.6, 2.4],
    [45.8, -102, 1.0], // index
    [48.6, -107, 0.85],
  ];
  const pouce = membre([
    [41.8, -98, 1.0],
    [42.4, -100.8, 0.85],
  ]);
  return forme(
    "montre-le-ciel",
    "Qui montre le ciel",
    corps,
    jambe2,
    botte2,
    jambe,
    botte,
    jupe,
    cou,
    tete,
    cheveux,
    membre(queue),
    membre(brasPose),
    membre(brasLeve),
    pouce,
  );
}

/** Le chien assis, de dos, museau levé (le même que debout : il était déjà assis). */
function chien(): Silhouette {
  const corps: P[] = [
    [-12, 0, 1],
    [-15.6, -3],
    [-16.8, -9.4],
    [-15.8, -17.6],
    [-13, -25.6],
    [-10.4, -33.4],
    [-9, -41],
    [-10.4, -47],
    [-9.2, -53],
    [9.2, -53],
    [10.4, -47],
    [9, -41],
    [10.4, -33.4],
    [13, -25.6],
    [15.8, -17.6],
    [16.8, -9.4],
    [15.6, -3],
    [12, 0, 1],
  ];
  const pattes = [ovale(-14.4, -1.8, 5, 2, 0, 12), ovale(14.4, -1.8, 5, 2, 0, 12)];
  const cou = ovale(0, -53.4, 8.4, 6);
  const tete = ovale(-0.4, -60.4, 8, 7, 0, 16);
  // Le museau un peu plus levé que debout : il regarde les étoiles avec eux.
  const museau = membre([
    [2.6, -62, 4.2],
    [5.4, -66.4, 3.4],
    [7.8, -70.4, 3.0],
    [8.8, -72.2, 2.9],
  ]);
  const oreilleD = ovale(9.2, -56.8, 3.2, 6, -24, 12);
  const queue: A[] = [
    [10, -3, 3.0],
    [16, -2.2, 2.6],
    [22, -3, 2.1],
    [26, -5.6, 1.5],
    [27.6, -8.8, 0.8],
  ];
  return forme("chien", "Chien assis", corps, ...pattes, cou, tete, museau, oreilleD, miroir(oreilleD), membre(queue));
}

/** Un couple assis épaule contre épaule ; elle penche la tête vers lui, il passe un bras autour d'elle. */
function couple(): Silhouette {
  const H = -20; // lui, à gauche
  const F = 18.6; // elle, à droite
  // Lui, en manteau, assis en tailleur : son genou gauche déborde.
  const lui = decale(
    symetrique([
      [0, -63.6],
      [6.8, -64.4],
      [8.4, -61.8],
      [13.4, -60.4],
      [18.8, -58.2],
      [21.4, -54.4],
      [21.4, -48],
      [19.6, -38],
      [18.8, -28],
      [19.8, -16],
      [21.4, -6],
      [21.6, -1.6],
      [20, 0, 1],
      [0, 0],
    ]),
    H,
  );
  const genouLui = membre([
    [H - 14, -9, 9],
    [H - 26, -12.4, 7.8],
    [H - 36.4, -12.6, 6.6], // genou
    [H - 40, -7.4, 5.4],
    [H - 37, -3.4, 4.6],
  ]);
  const teteLui = teteLevee(H + 0.8, -76.2, 7.9, 9.8, 1, 38);
  const oreilleLui = tourne(ovale(H - 6.9, -75, 1.6, 2.9, 12, 10), H + 0.8, -76.2, angleTete(1, 38));
  const couLui = ovale(H, -65.2, 5.9, 4.6);
  const brasLuiDehors: A[] = [
    [H - 18.4, -56, 5.8],
    [H - 22.4, -47, 5.5],
    [H - 24.6, -38, 5.0], // coude
    [H - 28, -28.4, 4.4],
    [H - 32.4, -19.6, 3.8], // poignet
    [H - 34.8, -16, 3.9], // main sur le genou
    [H - 37.4, -14, 2.4],
  ];
  // Son bras droit passe derrière elle : sa main se pose sur son épaule droite.
  // Seuls les doigts dépassent, posés sur l'arrondi de l'épaule.
  const mainSurEpaule: A[] = [
    [F + 9, -59.6, 2.2],
    [F + 13, -58.6, 2.4],
    [F + 16, -55.8, 2.1],
    [F + 17.4, -52.4, 1.4],
  ];
  // Elle, pull et jupe longue, les jambes repliées sur le côté droit.
  const elle = decale(symetrique(busteAssis(-59.6, 16.6, 13, 19.4)), F);
  const jambesElle = membre([
    [F + 12, -8.4, 8.4],
    [F + 23, -10, 7.4],
    [F + 32.4, -10.2, 6.4], // genou
    [F + 36.6, -6.4, 5.4],
    [F + 34, -3.2, 4.4],
    [F + 27, -2.8, 3.6],
  ]);
  // Sa tête penchée vers lui, le haut du crâne contre son épaule à lui, le
  // visage levé vers le ciel de l'autre côté (profil perdu à droite) : la
  // bascule en arrière et l'abandon vers lui ne font qu'un même geste.
  const cxE = F - 6.4;
  const cyE = -69.6;
  const inclinaison = 44;
  const teteElle = teteLevee(cxE, cyE, 7.4, 9.2, 1, inclinaison);
  const cheveuxElle = [calotte(cxE, cyE, 7.4, 9.2, 1, inclinaison), chevelure(cxE + 2, cyE + 1, 1, 10.6, -34)];
  const couElle = tourne(ovale(F - 2, -61.6, 4.8, 4.8), F, -60, -18);
  const brasElle: A[] = [
    [F + 14.4, -54, 4.4],
    [F + 17, -46, 4.1],
    [F + 18.2, -37, 3.7], // coude
    [F + 20.4, -28, 3.3],
    [F + 24.4, -20.6, 2.9], // poignet
    [F + 27, -17.6, 3.0], // main posée sur ses genoux
    [F + 29.4, -16.4, 1.9],
  ];
  return forme(
    "couple",
    "Couple épaule contre épaule",
    lui,
    genouLui,
    couLui,
    teteLui,
    oreilleLui,
    membre(brasLuiDehors),
    elle,
    jambesElle,
    couElle,
    ...cheveuxElle,
    teteElle,
    membre(brasElle),
    membre(mainSurEpaule),
  );
}

/** Toutes les silhouettes assises, mêmes ids et même ordre que SILHOUETTES. */
export const SILHOUETTES_ASSISES: readonly Silhouette[] = [
  femmeCheveuxLongs(),
  femmeChignon(),
  hommeManteau(),
  hommeBonnet(),
  enfant(),
  enfantSurEpaules(),
  adulteBebe(),
  montreLeCiel(),
  chien(),
  couple(),
];

export const SILHOUETTES_ASSISES_PAR_ID: ReadonlyMap<string, Silhouette> = new Map(SILHOUETTES_ASSISES.map((s) => [s.id, s]));

/* ------------------------------------------------------------------ */
/* Les petits détails autour du groupe                                  */
/* ------------------------------------------------------------------ */

/** Une touffe d'herbe, brins effilés et un peu courbés, base en (0, 0). */
function touffe(hauteur: number, graine: number): string {
  const brins: string[] = [];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) - 0.5; // de −0,5 à 0,5
    const h = hauteur * (0.62 + 0.38 * Math.abs(Math.sin(graine * 3.1 + i * 1.7)));
    const pente = t * 1.1 + 0.18 * Math.sin(graine + i * 2.3);
    const bx = t * 3.6;
    const tx = bx + pente * h * 0.55;
    const mx = bx + pente * h * 0.2;
    const w = 0.9;
    brins.push(
      `M${r2(bx - w)} 1Q${r2(mx - w * 0.5)} ${r2(-h * 0.5)} ${r2(tx)} ${r2(-h)}Q${r2(mx + w * 0.6)} ${r2(-h * 0.5)} ${r2(bx + w)} 1Z`,
    );
  }
  return brins.join("");
}

/**
 * La lanterne : socle, cage aux vitres ajourées (le fond se voit au
 * travers), toit en cône, anneau. 34 cm, base en (0, 0).
 */
function lanterne(): string {
  const corps = ferme([
    [-7.4, 0, 1],
    [7.4, 0, 1],
    [7.4, -2.6, 1],
    [6, -3.4, 1],
    [6, -20.4, 1],
    [7.6, -21.2, 1],
    [4.4, -26.6],
    [1.6, -28.2],
    [-1.6, -28.2],
    [-4.4, -26.6],
    [-7.6, -21.2, 1],
    [-6, -20.4, 1],
    [-6, -3.4, 1],
    [-7.4, -2.6, 1],
  ]);
  // Deux vitres, séparées par un montant ; la bougie se devine au milieu.
  const vitre = (x0: number, x1: number): P[] => [
    [x0, -5, 1],
    [x1, -5, 1],
    [x1, -19, 1],
    [x0, -19, 1],
  ];
  const bougie = ferme([
    [-1.6, -5, 1],
    [1.6, -5, 1],
    [1.6, -10.6, 1],
    [0.4, -11.2],
    [0, -13.6, 1],
    [-0.4, -11.2],
    [-1.6, -10.6, 1],
  ]);
  const anneau = ferme(ovale(0, -31.6, 3.4, 3.4, 0, 14));
  const anneauTrou = trou(ovale(0, -31.6, 2.1, 2.1, 0, 14));
  return (
    corps +
    trou(vitre(-4.6, -0.8)) +
    trou(vitre(0.8, 4.6)) +
    bougie +
    anneau +
    anneauTrou
  );
}

/**
 * Le pique-nique, posé sur le plaid : un panier d'osier à anse d'où dépasse
 * une baguette, le coin du torchon qui retombe sur le bord ; à côté, le
 * thermos (bouchon-tasse) et un mug. Base en (0, 0), de x = 0 à x ≈ 66.
 * (Le thermos et les deux petites tasses seuls ne se lisaient pas : le thermos
 * passait pour une bouteille, les tasses disparaissaient.)
 */
function pique(): string {
  const panier = ferme([
    [2.4, 0, 1],
    [37.6, 0, 1],
    [40.2, -17.6],
    [41, -20.6, 1],
    [-1, -20.6, 1],
    [-0.2, -17.6],
  ]);
  // L'anse, un arceau évidé.
  const arc: A[] = [];
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * (1 - i / 10);
    arc.push([20 + Math.cos(a) * 14, -20 - Math.sin(a) * 15.6, 1.4]);
  }
  const baguette = membre([
    [14, -16, 2.8],
    [9.4, -26, 3.0],
    [5.2, -35, 2.9],
    [2.6, -40.6, 2.4],
    [1.6, -43, 1.4],
  ]);
  const torchon: P[] = [
    [33, -20.6],
    [39.6, -22.4],
    [42.6, -20],
    [43.4, -14.6, 1],
    [41.6, -15.8],
    [40.2, -12.4, 1],
    [38.6, -17],
  ];
  const thermos = ferme(
    decale(
      [
        [-4.6, 0, 1],
        [4.6, 0, 1],
        [4.8, -22, 1],
        [3.6, -24.4],
        [3.8, -25.4, 1],
        [5.2, -25.8, 1], // le bouchon-tasse, plus large
        [5.4, -32.6, 1],
        [-5.4, -32.6, 1],
        [-5.2, -25.8, 1],
        [-3.8, -25.4, 1],
        [-3.6, -24.4],
        [-4.8, -22, 1],
      ],
      50,
    ),
  );
  const x = 61.6;
  const mug = ferme([
    [x - 4.2, 0, 1],
    [x + 4.2, 0, 1],
    [x + 4.6, -10.4, 1],
    [x - 4.6, -10.4, 1],
  ]);
  const anse = ferme(ovale(x + 5.6, -5.4, 3.2, 3.4, 0, 14)) + trou(ovale(x + 5.6, -5.4, 1.7, 2.0, 0, 14));
  // Un filet de vapeur au-dessus du mug.
  const vapeur = membre([
    [x - 0.6, -12.4, 0.6],
    [x + 1.2, -15.6, 0.7],
    [x - 0.8, -19.4, 0.6],
    [x + 1, -23, 0.45],
  ]);
  return ferme(membre(arc)) + panier + ferme(baguette) + ferme(torchon) + thermos + mug + anse + ferme(vapeur);
}

/**
 * La petite lunette astronomique : trépied, monture, tube pointé vers le
 * haut à gauche (vers le ciel de l'affiche), pare-buée, chercheur,
 * oculaire. Dessinée à 1,40 m, posée réduite à 0,6 (une petite lunette
 * d'amateur de 85 cm, qui ne vole pas la vedette au groupe). Base en (0, 0).
 */
function lunette(): string {
  const tete: [number, number] = [0, -104];
  const pied = (x: number, w: number) =>
    ferme([
      [tete[0] - w, tete[1] + 2],
      [tete[0] + w, tete[1] + 2],
      [x + w * 0.8, 0, 1],
      [x - w * 0.8, 0, 1],
    ]);
  // Des pieds assez épais pour tenir à la taille du tirage.
  const trepied = pied(-30, 2.1) + pied(28, 2.1) + pied(4, 1.8);
  // La tablette d'accessoires, à mi-hauteur.
  const tablette = ferme([
    [-12, -45, 1],
    [12, -45, 1],
    [11, -41.4, 1],
    [-11, -41.4, 1],
  ]);
  const monture = ferme([
    [-5, -100, 1],
    [5, -100, 1],
    [5.4, -110, 1],
    [-5.4, -110, 1],
  ]);
  const angle = -50; // vers le haut à gauche
  const axe = (pts: readonly (readonly [number, number])[]): P[] =>
    tourne(
      pts.map(([x, y]): P => [x + tete[0], y + tete[1] - 10, 1]),
      tete[0],
      tete[1] - 10,
      180 + angle,
    );
  const tube = axe([
    [-34, -4.8],
    [26, -4.8],
    [26, -6.4],
    [46, -6.4], // pare-buée
    [46, 6.4],
    [26, 6.4],
    [26, 4.8],
    [-34, 4.8],
    [-34, 2.2],
    [-40, 2.2], // porte-oculaire
    [-40, -2.2],
    [-34, -2.2],
  ]);
  const coude = axe([
    [-44, -2.2],
    [-40, -2.2],
    [-40, 2.2],
    [-47, 7.2],
    [-50, 4.2],
  ]);
  const chercheur = axe([
    [-6, -7.4],
    [10, -7.4],
    [10, -11],
    [-6, -11],
  ]);
  return trepied + tablette + monture + ferme(tube) + ferme(coude) + ferme(chercheur);
}

export interface DetailsAutour {
  /** Bords gauche et droit du groupe, en pixels de l'image. */
  gauche: number;
  droite: number;
  /** La hauteur du sol (y, en pixels) à l'abscisse x : hauteurColline(x, W, H). */
  sol: (x: number) => number;
  /** Pixels par centimètre (celle des silhouettes). */
  echelle: number;
  /** La couleur pleine des silhouettes. */
  couleur: string;
}

/**
 * Les petits détails en ombre chinoise autour du groupe assis, toujours les
 * mêmes : un plaid étalé sous lui (son bout gauche se soulève sur une touffe
 * et ses franges pendent dans le vide : c'est ce qui le fait lire comme un
 * tissu), quelques touffes d'herbe, une lanterne à gauche, le pique-nique
 * (panier, baguette, thermos, mug fumant) sur le plaid à droite, une petite
 * lunette sur trépied au bout. Prévoir environ 75 cm libres à gauche du
 * groupe et 1,3 m à droite. Rend un <g> à glisser à la fin du SVG du ciel,
 * avant ou après les silhouettes (même couleur, l'ordre ne se voit pas).
 */
export function detailsAutour(o: DetailsAutour): string {
  const e = o.echelle;
  const f = (v: number) => v.toFixed(1);
  // Un objet posé sur le sol à x (pixels), enfoncé de 1,5 cm dans l'herbe.
  const pose = (x: number, d: string, taille = 1) =>
    `<path transform="translate(${f(x)} ${f(o.sol(x) + 1.5 * e)}) scale(${(e * taille).toFixed(4)})" d="${d}"/>`;

  // Le plaid : 26 cm au-delà du groupe à gauche, 72 cm à droite (le
  // pique-nique est dessus), 3,5 cm d'épaisseur. Son bout gauche passe sur
  // une motte d'herbe (8 cm) et retombe : le coin pend dans le vide, avec
  // ses franges — c'est ce qui le fait lire comme un tissu.
  const x0 = o.gauche - 26 * e;
  const x1 = o.droite + 72 * e;
  const n = 80;
  const leve = (u: number) => 8 * e * Math.max(0, Math.sin(Math.PI * Math.min(1, (u + 4) / 34)));
  const dessus: string[] = [];
  const dessous: string[] = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const u = (x - x0) / e; // en centimètres depuis le bout gauche
    const y = o.sol(x);
    const pli = 0.5 * Math.sin(u * 0.21) * e;
    const haut = y - 3.5 * e + pli - leve(u);
    // Sous le coin qui pend, le vide ; ailleurs, le plaid touche l'herbe.
    const bas = u < 6 ? Math.min(y + 3 * e, haut + 3.5 * e + (y + 3 * e - haut - 3.5 * e) * (u / 6) ** 2) : y + 3 * e;
    dessus.push(`${f(x)} ${f(haut)}`);
    dessous.unshift(`${f(x)} ${f(bas)}`);
  }
  const plaid = `<path d="M${dessus.join("L")}L${dessous.join("L")}Z"/>`;
  // Les franges : de fins brins qui pendent du bord, dans le vide à gauche.
  const franges = (x: number, sens: 1 | -1, bas: number, long: number) => {
    let d = "";
    for (let i = 0; i < 5; i++) {
      const fx = x + sens * i * 1.5 * e;
      const fy = bas - 0.6 * e;
      const l = long * (0.85 + 0.15 * Math.sin(i * 2.1));
      d += `M${f(fx - 0.38 * e)} ${f(fy)}L${f(fx + 0.38 * e)} ${f(fy)}L${f(fx + 0.2 * e + sens * 0.6 * e)} ${f(fy + l * e)}L${f(fx - 0.2 * e + sens * 0.6 * e)} ${f(fy + l * e)}Z`;
    }
    return `<path d="${d}"/>`;
  };
  const basGauche = o.sol(x0) - leve(0);
  const frangesG = franges(x0 + 0.2 * e, 1, basGauche, 4.2);
  const frangesD = franges(x1 + 0.8 * e, -1, o.sol(x1) - 1 * e, 3);
  // La motte d'herbe sous le bout soulevé, qui dépasse un peu devant.
  const motte = pose(x0 + 10 * e, touffe(11, 7));

  const herbes = [
    [o.gauche - 74 * e, 16, 1],
    [o.gauche - 60 * e, 9, 2],
    [o.gauche - 38 * e, 12, 3],
    [o.droite + 86 * e, 13, 4],
    [o.droite + 118 * e, 18, 5],
    [o.droite + 130 * e, 10, 6],
  ].map(([x, h, g]) => pose(x!, touffe(h!, g!)));

  return `<g fill="${o.couleur}">${plaid}${frangesG}${frangesD}${motte}${herbes.join("")}${pose(
    o.gauche - 50 * e,
    lanterne(),
  )}${pose(o.droite + 4 * e, pique())}${pose(o.droite + 104 * e, lunette(), 0.6)}</g>`;
}
