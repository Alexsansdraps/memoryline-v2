/**
 * Les personnages du ciel étoilé : des ombres chinoises vues de dos, la tête
 * levée vers les étoiles (27/11, Alexandra : « il faudrait pouvoir créer des
 * personnages qui regardent la constellation, ils sont de dos et regarde vers
 * le haut vers la constellation », puis, devant quatre styles : « je les
 * trouve bien en ombre chinoise mais pas assez réaliste »).
 *
 * Chaque silhouette est dessinée en CENTIMÈTRES réels, pieds sur la ligne
 * y = 0, le haut vers les y négatifs, l'axe du corps sur x = 0 : un adulte
 * fait 165 à 180 cm, un enfant de sept ans 122, un chien assis une
 * soixantaine — posées à la même échelle, les tailles se répondent d'elles-
 * mêmes. Proportions vraies (tête d'environ 1/7,5 de la hauteur chez
 * l'adulte, 1/6 chez l'enfant), vêtements qui se devinent au contour.
 *
 * Le dessin se fait par contours de points reliés en courbes douces
 * (Catmull-Rom changé en Bézier cubiques) : un point suivi de « 1 » fait un
 * angle vif (ourlet, talon, entrejambe). Les membres se tracent par leur axe
 * et leur demi-épaisseur. Tous les contours sont remis dans le même sens,
 * si bien qu'un seul <path> (règle « nonzero ») en fait l'union, sans trou.
 * Une seule couleur pleine, sans contour.
 *
 * Deuxième passe (27/11, Alexandra : « les silhouettes sont top ») : même
 * dessin, mais chaque tête est vraiment levée (teteLevee, profil perdu), le
 * manteau d'homme ne fait plus short, la capuche de l'enfant ne fait plus
 * carré, le bébé et le chien se lisent, et les figures sont un peu plus grandes.
 *
 * Branché le 27/11 : ciel.ts les pose (POST /ia/ciel, champ `silhouettes`,
 * GET /ia/ciel/silhouettes pour les vignettes), l'étape Personnages de la
 * fenêtre du ciel les propose (apps/web/src/islands/AfficheIA.tsx).
 */

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
function ferme(points: readonly P[]): string {
  const p = aire(points) < 0 ? [...points].reverse() : points;
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
 * La tête levée vers le ciel (27/11, Alexandra : « ils sont de dos et regarde
 * vers le haut vers la constellation »). Vue de dos, une tête ronde a l'air de
 * regarder droit devant : on la tourne donc d'un rien (le « profil perdu » des
 * peintres) pour que le front, le bout du nez, les lèvres et le menton
 * dépassent d'un côté, puis on la bascule en arrière de `bascule` degrés —
 * le nez pointe vers les étoiles. `sens` = 1 : le visage dépasse à droite.
 * Les cheveux, bonnets, chignons qui suivent la tête se tournent avec
 * `tourne(…, cx, cy, angleTete(sens, bascule))`.
 */
function teteLevee(cx: number, cy: number, rx: number, ry: number, sens: 1 | -1 = 1, bascule = 32): P[] {
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
const angleTete = (sens: 1 | -1, bascule = 32) => -bascule * sens;

/**
 * Les cheveux qui couvrent le crâne d'une tête levée : un peu plus larges que
 * lui derrière et dessus, mais arrêtés derrière l'oreille du côté du visage,
 * pour que le profil reste visible. Ils basculent avec la tête.
 */
function calotte(cx: number, cy: number, rx: number, ry: number, sens: 1 | -1, bascule = 32): P[] {
  const pts: P[] = [
    [0, -ry - 1.3],
    [rx * 0.7, -ry - 0.5],
    [rx * 0.98 + 0.4, -ry * 0.55],
    [rx * 0.72, -ry * 0.12], // la ligne des cheveux, à la tempe
    [rx * 0.5, ry * 0.42], // derrière l'oreille
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

/**
 * Une chevelure longue qui tombe dans le dos, de la nuque jusqu'à `bas`, demi-
 * largeur `large`, pointes irrégulières ; elle part de derrière la mâchoire du
 * côté du visage (la tête levée, les cheveux glissent en arrière).
 */
function chevelure(cx: number, cy: number, sens: 1 | -1, large: number, bas: number): P[] {
  const h = bas - cy; // longueur, positive
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

export interface Silhouette {
  id: string;
  /** Nom court, pour le BO et les essais (les libellés du site sont dans ui.ts). */
  nom: string;
  /** Le tracé, en centimètres, pieds sur y = 0. */
  d: string;
  /** Emprise : bords gauche et droit, haut (négatif), en centimètres. */
  gauche: number;
  droite: number;
  haut: number;
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
 * Bras qui pend le long du corps (côté droit ; `miroirAxe` pour le gauche) :
 * épaule, coude un peu écarté, poignet, main aux doigts serrés. `manche`
 * épaissit le tout (manteau, doudoune).
 */
function brasPendant(epX: number, epY: number, longueur: number, manche = 0): A[] {
  const L = longueur; // de l'épaule au bout des doigts, environ 0,44 de la taille
  return [
    [epX - 1.2, epY + 3.2, 4.4 + manche],
    [epX + 1.8, epY + L * 0.14, 4.3 + manche],
    [epX + 3.0, epY + L * 0.3, 3.8 + manche * 0.9],
    [epX + 3.3, epY + L * 0.42, 3.5 + manche * 0.8], // coude
    [epX + 3.6, epY + L * 0.6, 3.1 + manche * 0.7],
    [epX + 3.6, epY + L * 0.74, 2.5 + manche * 0.6], // poignet
    [epX + 3.4, epY + L * 0.78, 2.4],
    [epX + 3.3, epY + L * 0.86, 3.0], // paume
    [epX + 2.9, epY + L * 0.95, 2.3],
    [epX + 2.4, epY + L, 1.2],
  ];
}

/** Bas du corps en pantalon : de la hanche (x, y) aux pieds, moitié droite. */
function jambesPantalon(hancheX: number, hancheY: number, entrejambe: number, ample = 0): P[] {
  const h = -hancheY; // hauteur de la hanche
  const e = entrejambe; // hauteur de l'entrejambe
  return [
    [hancheX, hancheY],
    [hancheX - 0.4 + ample, -h * 0.86],
    [hancheX - 1.8 + ample, -h * 0.72],
    [hancheX - 4.2 + ample, -h * 0.52], // genou
    [hancheX - 4.5 + ample, -h * 0.4], // mollet
    [hancheX - 5.6 + ample, -h * 0.26],
    [hancheX - 7.6 + ample * 0.6, -h * 0.1], // cheville
    [hancheX - 7.8 + ample * 0.6, -h * 0.06],
    [hancheX - 6.6, -2.4], // talon de la chaussure
    [hancheX - 6.8, 0, 1],
    [3.9, 0, 1],
    [3.7, -h * 0.06],
    [3.8, -h * 0.14],
    [3.5, -h * 0.3],
    [3.0, -h * 0.44],
    [2.7, -h * 0.56],
    [2.2, -e * 0.85],
    [0, -e, 1],
  ];
}

/* ------------------------------------------------------------------ */
/* Les silhouettes                                                      */
/* ------------------------------------------------------------------ */

/** Femme aux cheveux longs détachés, veste courte, jean. 166 cm. */
function femmeCheveuxLongs(): Silhouette {
  const corps = symetrique([
    [0, -143],
    [5.5, -143.4],
    [10.5, -141.6],
    [15, -139.2],
    [17.4, -135.6],
    [17.3, -130],
    [15.2, -122],
    [13.4, -112],
    [12.3, -104], // taille
    [13.2, -99],
    [14.8, -94, 1], // bas de la veste
    [16.2, -92.5],
    ...jambesPantalon(17.2, -86, 78),
  ]);
  // La tête levée, le visage qui dépasse à droite.
  const tete = teteLevee(0, -154.8, 7.6, 9.2, 1);
  const cheveux = [calotte(0, -154.8, 7.6, 9.2, 1), chevelure(0, -154.8, 1, 11.6, -120)];
  const bras = brasPendant(15.4, -137, 72);
  return forme("femme-cheveux-longs", "Femme, cheveux longs", corps, tete, ...cheveux, membre(bras), membre(miroirAxe(bras)));
}

/** Femme au chignon, manteau long ceinturé, écharpe, mains dans les poches. 168 cm. */
function femmeChignon(): Silhouette {
  const manteau = symetrique([
    [0, -142],
    [6, -142.4],
    [11.2, -141],
    [15.6, -138.6],
    [18, -135],
    [18, -129],
    [15.8, -121],
    [14.2, -110],
    [13.4, -103.5], // ceinture
    [14.8, -97],
    [16.6, -86],
    [18.2, -70],
    [19.8, -54],
    [21.2, -41, 1], // ourlet, mi-mollet
    [16, -40.2],
    [11.6, -39.6, 1],
    [11.4, -34], // mollet sous le manteau
    [9.6, -20],
    [8.2, -9], // bottine
    [9, -2.6],
    [8.8, 0, 1],
    [3.9, 0, 1],
    [3.7, -8],
    [3.8, -22],
    [3.4, -36, 1],
    [1.6, -39.4],
    [0, -39.6, 1],
  ]);
  // Tête levée, le visage qui dépasse à gauche ; chignon et cheveux tirés basculent avec elle.
  const tete = teteLevee(0, -156.6, 7.4, 9.2, -1);
  const cheveux = calotte(0, -156.6, 7.4, 9.2, -1);
  const chignon = tourne(ovale(0.4, -166.6, 5.2, 4.2, -8, 14, 0.04), 0, -156.6, angleTete(-1));
  // L'écharpe fait un col épais, un pan tombe sur l'épaule gauche.
  const echarpe = symetrique([
    [0, -149.6],
    [5.4, -149.2],
    [8.6, -146.6],
    [9.6, -143],
    [8, -140.4],
    [0, -139.8],
  ]);
  const pan = membre([
    [-7.6, -143, 3.2],
    [-10.6, -136, 3.4],
    [-11.6, -126, 3.2],
    [-11.4, -118, 3.0],
  ]);
  // Bras : le coude s'écarte, l'avant-bras plonge dans la poche.
  const bras: A[] = [
    [14.8, -134.6, 5.0],
    [18.2, -128, 4.9],
    [19.8, -116, 4.4],
    [20.2, -110, 4.2], // coude
    [19.4, -102, 3.9],
    [17.6, -95, 3.6],
    [15.8, -90.6, 3.0],
  ];
  return forme(
    "femme-chignon",
    "Femme, chignon et manteau",
    manteau,
    tete,
    cheveux,
    chignon,
    echarpe,
    pan,
    membre(bras),
    membre(miroirAxe(bras)),
  );
}

/**
 * Le manteau d'homme, droit, col relevé, et ses jambes (moitié droite). Ourlet
 * sous le genou, un peu évasé et sans fente : avec la fente qui montait
 * jusqu'à l'entrejambe, il se lisait comme un short (27/11).
 */
const MANTEAU_HOMME: readonly P[] = [
  [0, -153.8],
  [6.8, -154.6], // col relevé
  [8.4, -152],
  [13.4, -150.6],
  [18.8, -148.4],
  [21.6, -144.6],
  [21.8, -138],
  [19.6, -128],
  [18.2, -114],
  [17.8, -100],
  [18.6, -86],
  [19.8, -70],
  [21.2, -47, 1], // ourlet, sous le genou
  [16, -46.2],
  [12.6, -46, 1],
  [12.2, -36], // jambes
  [10.8, -20],
  [9.6, -9],
  [9.8, -5.6],
  [10.9, -2.6],
  [10.6, 0, 1],
  [4.2, 0, 1],
  [3.9, -7],
  [3.8, -20],
  [3.6, -36],
  [3.3, -45.4, 1],
  [0, -45.8, 1],
];

/** Homme en manteau droit, col relevé. 180 cm. */
function hommeManteau(): Silhouette {
  const manteau = symetrique(MANTEAU_HOMME);
  const tete = teteLevee(0, -166.4, 7.9, 9.8, 1);
  // L'oreille qui se voit, du côté de la nuque ; elle bascule avec la tête.
  const oreille = tourne(ovale(-7.7, -165.2, 1.6, 2.9, 12, 10), 0, -166.4, angleTete(1));
  const cou = ovale(0, -155.6, 5.9, 4.6);
  const bras = brasPendant(18.6, -146, 79, 1.3);
  return forme("homme-manteau", "Homme en manteau", manteau, tete, oreille, cou, membre(bras), membre(miroirAxe(bras)));
}

/** Homme au bonnet à pompon, doudoune, jean. 176 cm. */
function hommeBonnet(): Silhouette {
  const corps = symetrique([
    [0, -152],
    [6.6, -152.4],
    [12, -150.4],
    [17.6, -147.6],
    [21.2, -143],
    [21.8, -136],
    [20, -128],
    [20.8, -120], // les boudins de la doudoune
    [19.6, -112],
    [20.4, -104],
    [19.2, -96],
    [19.8, -90],
    [18.8, -87.4, 1],
    [17, -87],
    ...jambesPantalon(16.8, -80, 77),
  ]);
  // Tête levée, le visage à gauche ; le bonnet, remonté sur le front pour
  // laisser dépasser le nez, bascule avec elle.
  const tete = teteLevee(0, -163.2, 7.8, 9.4, -1);
  const bonnet = tourne(
    symetrique([
      [0, -177.4],
      [3.8, -176.8],
      [7, -174.4],
      [8.8, -170.2],
      [9.5, -166.4],
      [9.8, -165.2],
      [9.9, -163.4],
      [9.1, -162.2], // revers, plus large que la tête
      [0, -162.8],
    ]),
    0,
    -163.2,
    angleTete(-1),
  );
  const pompon = tourne(ovale(0.6, -180.8, 5.4, 4.9, 0, 30, 0.07), 0, -163.2, angleTete(-1));
  // Le cou, sans quoi la tête levée flottait au-dessus du col de la doudoune.
  const cou = ovale(0, -152.6, 6, 5.4);
  const bras = brasPendant(18.6, -145, 77, 1.9);
  return forme("homme-bonnet", "Homme au bonnet", corps, cou, tete, bonnet, pompon, membre(bras), membre(miroirAxe(bras)));
}

/** Enfant de six à huit ans, capuche relevée, parka, bottes. 122 cm. */
function enfant(): Silhouette {
  const corps = symetrique([
    [0, -98],
    [6, -98.4],
    [10.2, -97.2],
    [13, -94.6],
    [13.8, -90],
    [13.2, -84],
    [12.4, -76],
    [12.6, -68],
    [13, -64.6, 1], // bas de la parka
    [11.4, -64],
    [11.2, -58],
    [10.8, -50],
    [9.4, -36], // genou
    [9.2, -28],
    [8.4, -14],
    [8.2, -7], // botte
    [9, -2.6],
    [8.8, 0, 1],
    [3.4, 0, 1],
    [3.2, -7],
    [3, -16],
    [2.6, -28],
    [2.2, -38],
    [1.6, -50],
    [0, -55, 1],
  ]);
  // Capuche relevée, la tête levée : le visage (nez, menton) sort à gauche du
  // bord de la capuche, qui bascule avec la tête et retombe sur les épaules —
  // droite et ronde, elle se lisait comme une coupe au carré (27/11).
  const tete = teteLevee(0, -110.4, 7.2, 8.6, -1, 34);
  const capuche = tourne(
    [
      [-5.2, -121], // bord avant, au-dessus du front
      [0, -122.4],
      [5.6, -121.2],
      [9.4, -117],
      [10.6, -110],
      [10.2, -103.6],
      [8.4, -99.6],
      [0, -98.6],
      [-5.6, -100.4],
      [-6, -104], // bord avant, sous la joue
      [-6.6, -110],
      [-7.2, -116.4],
    ],
    0,
    -110.4,
    angleTete(-1, 34),
  );
  // Le bas de la capuche, qui retombe en col sur les épaules.
  const col = symetrique([
    [0, -101.6],
    [6.8, -101],
    [10.8, -98.4],
    [11.8, -95.6],
    [0, -95],
  ]);
  const bras: A[] = [
    [12.2, -94, 4.2],
    [13.6, -86, 3.9],
    [14.6, -77, 3.5], // coude
    [15, -68, 3.1],
    [14.9, -62, 2.8], // poignet élastique
    [14.8, -59, 2.9],
    [14.6, -55, 2.8], // moufle
    [14.2, -51.6, 1.6],
  ];
  return forme("enfant", "Enfant", corps, col, tete, capuche, membre(bras), membre(miroirAxe(bras)));
}

/** Un adulte qui porte un enfant sur les épaules ; l'enfant montre le ciel. */
function enfantSurEpaules(): Silhouette {
  // Le porteur : pull, jean ; bras levés, coudes en dehors, mains sur les genoux de l'enfant.
  const porteur = symetrique([
    [0, -155],
    [7, -155.4],
    [13, -153.4],
    [18.4, -150.4],
    [20.6, -146.4],
    [20, -138],
    [18.4, -126],
    [17.4, -112],
    [17, -100],
    [17.8, -90, 1],
    [17, -88.4],
    ...jambesPantalon(16.9, -82, 79),
  ]);
  const tete = ovale(0, -166.6, 7.9, 9.6, 0, 16);
  const cou = ovale(0, -156, 6, 4.6);
  const brasLeve: A[] = [
    [17.6, -147, 5.4],
    [22.4, -141, 5.0],
    [26.6, -135, 4.4], // coude, en dehors
    [27.4, -139.6, 4.0],
    [24.4, -148, 3.4],
    [20.6, -154, 3.2], // poignet
    [18.4, -157.6, 3.4], // main sur le genou
    [16.6, -159.4, 2.2],
  ];
  // L'enfant (5 ans) assis sur la nuque : dos, cuisses qui passent sur les épaules.
  const dos = symetrique([
    [0, -199],
    [5, -199.4],
    [8.8, -198],
    [11, -195],
    [11.2, -190],
    [10, -183],
    [9.2, -175],
    [9.8, -168],
    [12, -161.6],
    [16.4, -161],
    [20.2, -158.6], // genou
    [21.2, -154],
    [19.6, -150.2, 1],
    [0, -157],
  ]);
  // Elle lève la tête vers ce qu'elle montre (visage à droite) ; ses couettes suivent.
  const teteEnfant = teteLevee(0, -208, 6.6, 8, 1, 36);
  const couettes = [ovale(-7.4, -204, 2.7, 3.6, 30, 12), ovale(5.6, -211.6, 2.6, 3.4, -50, 12)].map((c) =>
    tourne(c, 0, -208, angleTete(1, 36)),
  );
  const brasMontre: A[] = [
    [9.6, -195.6, 3.0],
    [13.6, -203, 2.7],
    [17.2, -210.6, 2.4], // coude
    [20.4, -218.6, 2.0],
    [21.8, -222.4, 2.2], // poing
    [23.6, -227, 0.9], // index
  ];
  const brasTient: A[] = [
    [-9.6, -195, 3.0],
    [-13.4, -188.4, 2.7],
    [-14.4, -181, 2.4], // coude
    [-11.6, -175.4, 2.1],
    [-9, -172.2, 2.2], // main dans les cheveux du porteur
  ];
  return forme(
    "enfant-sur-epaules",
    "Enfant sur les épaules",
    porteur,
    cou,
    tete,
    membre(brasLeve),
    membre(miroirAxe(brasLeve)),
    dos,
    teteEnfant,
    ...couettes,
    membre(brasMontre),
    membre(brasTient),
  );
}

/** Une femme qui tient un bébé contre son épaule ; la tête du bébé dépasse. 166 cm. */
function adulteBebe(): Silhouette {
  const corps = symetrique([
    [0, -143],
    [5.6, -143.4],
    [10.6, -141.6],
    [15.2, -139.2],
    [17.4, -135.6],
    [17.2, -130],
    [15.4, -122],
    [14, -112],
    [13.6, -104],
    [14.6, -97],
    [16.4, -90, 1], // bas du pull
    [16.8, -88],
    ...jambesPantalon(17, -84, 77),
  ]);
  // Elle lève la tête (visage à droite, du côté opposé au bébé).
  const tete = teteLevee(0, -154.6, 7.6, 9.2, 1);
  const cou = ovale(0, -144, 5, 4.6);
  // Cheveux au carré : la calotte bascule avec la tête, la nuque arrêtée net
  // à la hauteur du menton, dégagée du côté du visage.
  const calotteCarre = calotte(0, -154.6, 7.6, 9.2, 1);
  const carre: P[] = [
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
  ];
  // Le bébé, contre sa poitrine, regarde par-dessus son épaule gauche : une
  // tête ronde, une mèche sur le dessus, une menotte posée sur l'épaule —
  // tendue vers le haut, elle faisait une oreille de chat (27/11).
  // Une jambe potelée dépasse sous le coude, côté hanche : on comprend qu'elle
  // le porte (la mèche du dessus faisait une queue de pomme).
  const bebe = ovale(-11.6, -148.4, 6.8, 7.1, -10, 16);
  const jambeBebe = membre([
    [-16.4, -110.6, 3.4],
    [-20, -107, 3.0],
    [-22.4, -102.6, 2.5],
    [-23, -99.4, 2.3], // cheville
    [-22.2, -96.8, 1.8], // petit pied
  ]);
  const menotte: A[] = [
    [-16.4, -143.4, 1.6],
    [-19.2, -141.4, 1.5],
    [-20.8, -140.2, 1.8],
    [-22, -139.2, 1.1],
  ];
  // Les deux bras sont pliés en avant : de dos on ne voit que le bras et le coude.
  const bras: A[] = [
    [15.6, -137, 4.6],
    [17.6, -128, 4.3],
    [18.8, -118, 3.9],
    [18.8, -110, 3.7], // coude
    [17, -104.6, 3.3],
  ];
  return forme(
    "adulte-bebe",
    "Adulte et bébé",
    corps,
    cou,
    tete,
    calotteCarre,
    carre,
    bebe,
    jambeBebe,
    membre(menotte),
    membre(bras),
    membre(miroirAxe(bras)),
  );
}

/** Jeune femme à queue de cheval, jupe et bottes, qui montre le ciel. 164 cm. */
function montreLeCiel(): Silhouette {
  const corps = symetrique([
    [0, -141.6],
    [5.4, -142],
    [10.4, -140.2],
    [14.8, -137.6],
    [17, -134],
    [16.8, -128.6],
    [15, -121],
    [13.4, -110],
    [12.2, -102.4], // taille
    [14, -97.6],
    [17, -88],
    [19.2, -70],
    [21, -53, 1], // ourlet au genou
    [16.6, -51.6],
    [11.8, -51, 1],
    [11, -44], // collant, mollet
    [10.6, -36],
    [9.4, -24],
    [8, -12], // botte
    [7.8, -7],
    [8.8, -2.4],
    [8.6, 0, 1],
    [3.8, 0, 1],
    [3.6, -8],
    [3.6, -24],
    [3, -38],
    [2.6, -48, 1],
    [0, -50.4],
  ]);
  // Elle suit son bras des yeux : tête levée plus franchement, visage à droite.
  const tete = teteLevee(0.4, -153.2, 7.4, 9.2, 1, 40);
  const cheveux = calotte(0.4, -153.2, 7.4, 9.2, 1, 40);
  const cou = ovale(0, -143, 4.8, 4.6);
  const queue: A[] = [
    [-2, -158, 2.6],
    [-6, -152, 3.2],
    [-9.4, -146, 3.0],
    [-11, -139, 2.4],
    [-10.8, -132, 1.4],
    [-9.6, -128, 0.5],
  ];
  const brasPend = miroirAxe(brasPendant(15.2, -136, 71));
  // Le bras tendu vers le ciel, l'index pointé.
  const brasLeve: A[] = [
    [14.4, -137, 4.6],
    [19.4, -143, 4.2],
    [25.6, -150, 3.7],
    [31.2, -156.6, 3.4], // coude
    [37.6, -164, 3.0],
    [43.6, -171.4, 2.5], // poignet
    [46.2, -174.6, 2.9], // poing
    [48.4, -177.4, 2.4],
    [50, -179.6, 1.0], // index
    [53.4, -184.2, 0.85],
  ];
  const pouce = membre([
    [45.4, -176, 1.0],
    [46.2, -178.6, 0.85],
  ]);
  return forme("montre-le-ciel", "Qui montre le ciel", corps, cou, tete, cheveux, membre(queue), membre(brasPend), membre(brasLeve), pouce);
}

/** Un chien assis, de dos, museau levé, oreilles droites, queue couchée. */
function chien(): Silhouette {
  const corps: P[] = [
    [-12, 0, 1],
    [-15.6, -3],
    [-16.8, -9.4], // cuisse arrière
    [-15.8, -17.6],
    [-13, -25.6],
    [-10.4, -33.4],
    [-9, -41],
    [-10.4, -47], // épaules, plus larges que chez un chat
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
  // Un labrador : cou épais, crâne large, oreilles tombantes, et le museau,
  // long, levé vers le ciel et tourné d'un rien à droite — avec des oreilles
  // droites et un museau caché il passait pour un chat ou un lapin (27/11).
  const cou = ovale(0, -53.4, 8.4, 6);
  const tete = ovale(-0.4, -60.4, 8, 7, 0, 16);
  // Museau court et épais, à 50° : tout droit et long, il faisait un goulot.
  const museau = membre([
    [3, -61.4, 4.2],
    [6.6, -65.2, 3.4],
    [9.6, -68.6, 3.0],
    [10.8, -70, 2.9],
  ]);
  // Les oreilles tombent en dehors du crâne, sinon elles ne se voient pas.
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

/** Un couple, main dans la main : lui en manteau, elle au chignon, têtes rapprochées. */
function couple(): Silhouette {
  const H = -30; // lui, à gauche
  const F = 22; // elle, à droite
  const lui = decale(symetrique(MANTEAU_HOMME), H);
  // Les deux têtes levées, les visages tournés l'un vers l'autre.
  const teteLui = teteLevee(H + 0.8, -166.2, 7.9, 9.8, 1);
  const oreilleLui = tourne(ovale(H - 6.9, -165, 1.6, 2.9, 12, 10), H + 0.8, -166.2, angleTete(1));
  const cou = ovale(H, -155.6, 5.9, 4.6);
  const brasLuiDehors = miroirAxe(brasPendant(18.6, -146, 79, 1.3)).map(([x, y, w]): A => [x + H, y, w]);
  // Son bras droit descend vers elle ; leurs mains se rejoignent entre eux.
  const brasLuiDedans: A[] = [
    [H + 17.4, -142.8, 5.7],
    [H + 21, -134, 5.4],
    [H + 22.6, -122, 4.8],
    [H + 23.8, -112, 4.4], // coude
    [H + 25.4, -100, 3.8],
    [H + 26.6, -92, 3.2], // poignet
    [H + 27.6, -88, 3.4],
    [H + 28.6, -84, 2.6],
  ];
  const elle = decale(
    symetrique([
      [0, -142],
      [6, -142.4],
      [11.2, -141],
      [15.6, -138.6],
      [18, -135],
      [18, -129],
      [15.8, -121],
      [14.2, -110],
      [13.4, -103.5],
      [14.8, -97],
      [16.6, -86],
      [18.2, -70],
      [19.8, -54],
      [21.2, -41, 1],
      [16, -40.2],
      [11.6, -39.6, 1],
      [11.4, -34],
      [9.6, -20],
      [8.2, -9],
      [9, -2.6],
      [8.8, 0, 1],
      [3.9, 0, 1],
      [3.7, -8],
      [3.8, -22],
      [3.4, -36, 1],
      [1.6, -39.4],
      [0, -39.6, 1],
    ]),
    F,
  );
  // Elle, cheveux longs : calotte qui bascule avec la tête, mèches dans le dos.
  const teteElle = teteLevee(F - 1, -156.4, 7.4, 9.2, -1);
  const cheveuxElle = [calotte(F - 1, -156.4, 7.4, 9.2, -1), chevelure(F - 1, -156.4, -1, 10.6, -130)];
  const brasElleDehors = brasPendant(16, -137.6, 72, 1.1).map(([x, y, w]): A => [x + F, y, w]);
  const brasElleDedans: A[] = [
    [F - 14.8, -134.4, 5.3],
    [F - 18.4, -127, 5.0],
    [F - 19.8, -116, 4.4],
    [F - 20.8, -108, 4.0], // coude
    [F - 22.4, -98, 3.5],
    [F - 23.8, -91, 2.9], // poignet
    [F - 24.8, -88, 3.0],
    [F - 25.6, -85, 2.0],
  ];
  return forme(
    "couple",
    "Couple main dans la main",
    lui,
    teteLui,
    oreilleLui,
    cou,
    membre(brasLuiDehors),
    membre(brasLuiDedans),
    elle,
    teteElle,
    ...cheveuxElle,
    membre(brasElleDehors),
    membre(brasElleDedans),
  );
}

/** Toutes les silhouettes, dans l'ordre où la fiche les proposera. */
export const SILHOUETTES: readonly Silhouette[] = [
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

export const SILHOUETTES_PAR_ID: ReadonlyMap<string, Silhouette> = new Map(SILHOUETTES.map((s) => [s.id, s]));

/* ------------------------------------------------------------------ */
/* Pose sur les collines                                                */
/* ------------------------------------------------------------------ */

/**
 * La hauteur (y) de la colline du premier plan à l'abscisse x — mêmes
 * courbes que svgDuCiel (ciel.ts) : si elles changent là-bas, les changer ici.
 */
export function hauteurColline(x: number, W: number, H: number): number {
  const seg = [
    [[0, 0.925], [0.22, 0.9], [0.45, 0.917], [0.62, 0.912]],
    [[0.62, 0.912], [0.79, 0.907], [0.88, 0.895], [1, 0.908]],
  ] as const;
  let prec: [number, number] | null = null;
  for (const [a, b, c, d] of seg) {
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const u = 1 - t;
      const px = (u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0]) * W;
      const py = (u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1]) * H;
      if (prec && px >= x) {
        const f = px === prec[0] ? 0 : (x - prec[0]) / (px - prec[0]);
        return prec[1] + (py - prec[1]) * f;
      }
      prec = [px, py];
    }
  }
  return 0.908 * H;
}

export interface PoseSilhouettes {
  /** Couleur pleine des silhouettes (par défaut, celle de la colline du premier plan). */
  couleur: string;
  /** Taille de l'image (celle du fond du ciel). */
  largeur: number;
  hauteur: number;
  /** Hauteur, en pixels, d'une personne de 175 cm. Par défaut 0,145 de l'image. */
  taillePx?: number;
  /** Milieu du groupe, en fraction de la largeur. Par défaut 0,5. */
  centre?: number;
  /** Écart entre deux silhouettes, en centimètres. */
  ecart?: number;
  /**
   * Une ligne que les têtes ne passent pas (y en pixels) : une silhouette qui
   * se tient entre `x0` et `x1` (toute la largeur s'ils manquent) garde son
   * sommet sous `y`, et tout le groupe rapetisse d'autant, à la même échelle
   * (27/11, relecture : « les têtes du couple passent sur 2 NOVEMBRE 1990 »,
   * « les silhouettes coupent Passion • Détermination • Magnétisme »).
   */
  plafond?: { y: number; x0?: number; x1?: number };
  /**
   * Le catalogue où chercher les ids (27/11, Alexandra : « je les veux assis les
   * personnages !!! qui regardent bien ») : SILHOUETTES_ASSISES_PAR_ID pour le
   * ciel. Par défaut, les silhouettes debout. Un id absent est ignoré.
   */
  catalogue?: ReadonlyMap<string, Silhouette>;
  /** Ce qui se dessine autour du groupe (detailsAutour), rendu avant lui. */
  autour?: (g: { gauche: number; droite: number; echelle: number }) => string;
}

/**
 * Pose les silhouettes choisies (ids de SILHOUETTES, dans l'ordre, de gauche
 * à droite) sur la colline du premier plan : toutes à la même échelle,
 * espacées, chacune les pieds sur la pente à l'endroit où elle se tient.
 * Rend un <g> à glisser à la fin du SVG du ciel ; "" si rien n'est choisi.
 */
export function poserSilhouettes(choix: readonly string[], o: PoseSilhouettes): string {
  // « id:m » = le personnage retourné en miroir (27/11, Alexandra : « pouvoir
  // inverser le sens des personnages ») : ses bords s'échangent, et il se
  // dessine avec scale(-s, s).
  const liste = choix
    .map((choisi) => {
      const [id, sens] = choisi.split(":");
      const x = (o.catalogue ?? SILHOUETTES_PAR_ID).get(id ?? "");
      if (!x) return null;
      return sens === "m" ? { ...x, gauche: -x.droite, droite: -x.gauche, miroir: true } : { ...x, miroir: false };
    })
    .filter((x): x is Silhouette & { miroir: boolean } => !!x);
  if (!liste.length) return "";
  // 0,145 de la hauteur (au lieu de 0,125) : un peu plus grandes, les
  // silhouettes se lisent mieux sur le tirage (27/11).
  const ecart = o.ecart ?? 14;
  const total = liste.reduce((t, x) => t + (x.droite - x.gauche), 0) + ecart * (liste.length - 1);
  // Chaque silhouette : où elle se tient, à l'échelle s.
  const places = (s: number) => {
    let curseur = (o.centre ?? 0.5) * o.largeur - (total * s) / 2;
    return liste.map((x) => {
      const tx = curseur - x.gauche * s;
      // Les pieds s'enfoncent de 3 cm dans l'herbe : posés pile sur la courbe,
      // ils sembleraient flotter là où la pente descend.
      const sol = hauteurColline(tx, o.largeur, o.hauteur);
      curseur += (x.droite - x.gauche + ecart) * s;
      return { x, tx, sol };
    });
  };
  let s = (o.taillePx ?? o.hauteur * 0.145) / 175;
  // Sous un plafond (27/11) : on rapetisse jusqu'à ce que plus aucune tête
  // concernée ne le passe. Un groupe plus petit est plus étroit, et peut
  // sortir de la bande : quelques tours suffisent, l'échelle ne fait que
  // descendre.
  const p = o.plafond;
  if (p) {
    for (let tour = 0; tour < 12; tour++) {
      let permise = s;
      for (const { x, tx, sol } of places(s)) {
        const g = tx + x.gauche * s;
        const d = tx + x.droite * s;
        if (d < (p.x0 ?? -Infinity) || g > (p.x1 ?? Infinity)) continue;
        // Sommet : sol + 3 s + haut s (haut < 0), à garder sous p.y.
        permise = Math.min(permise, Math.max(0.05, (sol - p.y) / -(x.haut + 3)));
      }
      if (permise >= s - 1e-6) break;
      s = permise;
    }
  }
  const posees = places(s);
  const chemins = posees.map(({ x, tx, sol }) => {
    const ty = sol + 3 * s;
    return `<path transform="translate(${tx.toFixed(1)} ${ty.toFixed(1)}) scale(${x.miroir ? `-${s.toFixed(4)} ${s.toFixed(4)}` : s.toFixed(4)})" d="${x.d}"/>`;
  });
  // Les détails autour (27/11), du bord gauche du premier au bord droit du dernier.
  const premier = posees[0]!;
  const dernier = posees[posees.length - 1]!;
  const autour = o.autour
    ? o.autour({ gauche: premier.tx + premier.x.gauche * s, droite: dernier.tx + dernier.x.droite * s, echelle: s })
    : "";
  return `${autour}<g fill="${o.couleur}" data-silhouettes="1">${chemins.join("")}</g>`;
}
