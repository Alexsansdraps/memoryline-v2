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
 *
 * 27/11, 17 h (Alexandra : « tiens pour les svg c'est ça qu'il faut pour les
 * ombres, supprime celles que tu as fait tu prends ça ») : les personnages
 * décrits plus haut sont supprimés, remplacés par les ombres vectorisées de
 * son image (ciel-ombres.ts), mêmes ids. Restent ici le catalogue et
 * detailsAutour() (plus appelé) avec ses petites fonctions de dessin.
 */

import type { Silhouette } from "./ciel-silhouettes.js";
import { OMBRES } from "./ciel-ombres.js";
import { OMBRES_2 } from "./ciel-ombres-2.js";

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

/**
 * Toutes les silhouettes assises : les ombres vectorisées depuis l'image
 * d'Alexandra (ciel-ombres.ts), sous les ids d'avant (27/11, Alexandra :
 * « tiens pour les svg c'est ça qu'il faut pour les ombres, supprime celles
 * que tu as fait tu prends ça »). Les personnages dessinés à la main sont
 * supprimés ; « montre-le-ciel », sans équivalent dans l'image, disparaît
 * (un ancien réglage qui le cite est ignoré par lireReglagesCiel).
 */
export const SILHOUETTES_ASSISES: readonly Silhouette[] = [
  ...OMBRES,
  // La 2e planche (27/11 au soir), rangée par groupes (ciel-ombres-2.ts) :
  // c'est elle que la fiche propose ; les dix d'avant restent connues pour
  // redessiner les ciels déjà créés.
  ...OMBRES_2,
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
  )}${pose(o.droite + 4 * e, pique())}${pose(o.droite + 104 * e, lunette(), 0.5)}</g>`;
}
