/**
 * Où se posent les personnages sur l'affiche, tant que personne ne les a
 * placés à la main : la composition automatique.
 *
 * DEUX COMPOSITIONS, selon le type d'affiche (retour de la boutique, 7 octobre
 * 2026) :
 *
 *  - « rangée », pour les affiches DE DOS : tout le monde côte à côte, assis
 *    ou debout le long du muret. La boutique : « à partir de 5/6 personnages
 *    ils remontent (deuxième rangée) alors qu'il y a encore de la place de
 *    chaque côté, la ligne n'est pas pleine ». Deux défauts de l'ancienne
 *    rangée, corrigés ici :
 *      1. elle comptait la largeur des CADRES (500 × 1000), pas celle des
 *         dessins — un adulte de dos n'occupe que les quatre cinquièmes du
 *         sien, un chat le cinquième —, et rétrécissait tout le monde dès six
 *         personnages, avec un tiers de la largeur encore libre ;
 *      2. en rétrécissant, chacun gardait le CENTRE de son cadre à la même
 *         hauteur : les pieds remontaient, et la rangée flottait au-dessus du
 *         muret, comme posée derrière lui. Désormais ce sont les pieds qui
 *         restent sur la ligne du sol, quelle que soit la taille.
 *    Une deuxième rangée ne s'ouvre plus que lorsque la première, serrée sur
 *    la largeur réelle des dessins, ne tient plus qu'en descendant sous
 *    l'échelle 0,5 (0,7 pour un personnage seul) : vers onze adultes de dos.
 *    Et la première reste alors pleine : ne passent derrière que ceux qui
 *    n'y tiennent plus (voir enDeuxRangees).
 *
 *  - « groupe », pour les affiches DE FACE (et les types créés au
 *    back-office) : « c'est beaucoup plus sympa si, par défaut, pour plusieurs
 *    personnages, on harmonise avec les enfants et les chiens devant ». Les
 *    grands (adultes, ados) forment une rangée un peu en retrait ; les petits
 *    (enfants, bébés, animaux) se glissent devant eux, entre deux grands ou
 *    sur les côtés du groupe, plutôt que pile devant un buste (voir
 *    enGroupe). À deux personnages, chacun reste à côté de l'autre.
 *
 * QUI EST PETIT. On le lit sur le DESSIN, et non dans une catégorie : les
 * catégories sont libres au back-office (« Bébés », « Animaux »…), et un
 * personnage ajouté demain doit trouver sa place sans que personne ait à le
 * déclarer. Est petit celui dont le dessin fait moins de 81 % de l'ÉTALON :
 * le plus grand personnage proposé pour ce type d'affiche — et non le plus
 * grand de l'affiche, sans quoi des petits-enfants posés avec leurs
 * grands-parents, dessinés un peu moins grands que les autres adultes,
 * n'auraient jamais été mis devant. Mesuré sur les dessins de la boutique,
 * en part de l'étalon : de face, adultes 90 à 100 %, ados 83 à 86 %, enfants
 * 77 à 78 % (la femme en fauteuil, assise, aussi), bébés 28 à 29 %, animaux
 * 23 à 63 % ; de dos, adultes 93 à 100 %, ados 86 à 88 %, enfants 73 à 75 %,
 * bébés 47 à 48 %, chiens et chats 25 à 65 % — sauf le berger allemand,
 * agrandi au back-office (85 %). Le seuil passe entre les enfants et les
 * ados.
 *
 * LE CHOIX DE LA CLIENTE. L'ordre de la liste « Vos personnages », qu'elle
 * change en faisant glisser les lignes, reste l'ordre de gauche à droite
 * dans chaque rangée, et décide de qui passe devant qui entre voisins. Un
 * personnage qu'elle a posé elle-même sur l'affiche (configurations d'avant
 * le retrait du glisser-déposer) garde sa place : voir placementsAffiche,
 * dans le configurateur.
 *
 * CE QUE CETTE COMPOSITION NE DÉCIDE PAS : ce qui s'imprime. Le configurateur
 * enregistre, dans la configuration, la place qu'elle a donnée à chacun (x,
 * y, échelle, et l'ordre de dessin dans `position`). Le fichier d'impression
 * relit ces chiffres sans rien recalculer, et le panier et la commande les
 * dessinent tels quels. Changer ces règles ne déplace donc aucune affiche
 * déjà au panier ou déjà commandée : seules les affiches composées, ou
 * rouvertes dans le module, après le changement les suivent.
 *
 * UNE AFFICHE SEULE NE BOUGE PAS : un personnage seul se pose exactement là
 * où l'écran de calage du back-office le montre (centre de l'affiche, échelle
 * 0,7, ligne Y_SOL_PERSONNAGES) — c'est là-bas que la boutique règle comment
 * chacun se tient sur le muret.
 */
import { Y_SOL_PERSONNAGES } from "./sol-personnages.js";

/**
 * Largeur du cadre d'un personnage à l'échelle 1, en fraction de la largeur de
 * l'affiche. Le cadre fait deux fois sa largeur en hauteur (dessins 500 ×
 * 1000). L'aperçu du module et le fichier d'impression dessinent tous deux
 * avec cette valeur : la changer d'un seul côté décalerait le papier.
 */
export const LARGEUR_CADRE_PERSONNAGE = 0.22;

/**
 * Échelle d'un personnage seul sur l'affiche : celle de l'écran de calage du
 * back-office, et la plus grande que la composition donne.
 */
export const ECHELLE_PERSONNAGE_SEUL = 0.7;

/**
 * Où le dessin d'un personnage se trouve vraiment dans son cadre, en
 * fractions du cadre (0 = bord gauche ou haut, 1 = bord droit ou bas).
 * Mesurée par l'API sur le dessin de base (apps/api/src/emprise-personnages.ts).
 */
export interface EmpriseDessin {
  gauche: number;
  droite: number;
  haut: number;
  bas: number;
}

/** Ce que la composition doit savoir d'un personnage, lu dans la bibliothèque. */
export interface PersonnageAComposer {
  /** Taille propre au personnage (« facteurTaille » du back-office), 1 par défaut. */
  facteur?: number | null;
  /** Décalage de côté réglé au back-office, en fraction de la largeur de l'affiche. */
  decalage?: number | null;
  /**
   * L'emprise de son dessin. Absente (dessin pas encore mesuré), on suppose
   * un dessin large des quatre cinquièmes de son cadre, l'écart que laissait
   * l'ancienne rangée, et on le range parmi les grands : faute de savoir, on
   * ne met personne devant un autre.
   */
  emprise?: EmpriseDessin | null;
}

/** La place d'un personnage : le centre de son cadre, son échelle, son plan. */
export interface PlaceComposee {
  /** Centre du cadre, en fraction de la largeur de l'affiche. */
  x: number;
  /**
   * Centre du cadre AVANT la descente qui pose les pieds au sol (bottomPct),
   * en fraction de la hauteur — la même convention que l'aperçu et le PDF.
   */
  y: number;
  /** Échelle rendue, facteur de taille compris. */
  scale: number;
  /**
   * Rang dans l'ordre de dessin : 0 est dessiné en premier, donc derrière
   * tous les autres. C'est lui que la configuration enregistre dans
   * `position`, et que le fichier d'impression suit pour empiler.
   */
  plan: number;
}

export type CompositionPersonnages = "rangee" | "groupe";

/**
 * La composition d'un type d'affiche : la rangée pour « de dos » (le muret),
 * le groupe pour « de face » et pour les types créés au back-office, où les
 * personnages regardent le public.
 */
export function compositionDeLaVue(
  vue: string | null | undefined,
): CompositionPersonnages {
  return vue === "back" ? "rangee" : "groupe";
}

/**
 * Marge laissée vide de chaque côté de l'affiche, en fraction de sa largeur :
 * la feuillure d'un cadre en mange près d'un centimètre, et un dessin collé
 * au bord paraît coupé.
 */
const MARGE_COTE = 0.04;
const LARGEUR_UTILE = 1 - 2 * MARGE_COTE;

/**
 * Chevauchement de deux voisins, en fraction du plus étroit des deux
 * dessins : épaule contre épaule, sans jour entre eux — c'est ce que
 * montrait la rangée de dos d'avant, avec ses adultes.
 */
const RECOUVREMENT = 0.06;

/**
 * Chevauchement d'un petit et du grand derrière lui, en fraction du plus
 * étroit : le petit se glisse à moitié devant le grand. Glissé entre deux
 * grands, il les laisse ainsi épaule contre épaule, sans les écarter.
 */
const RECOUVREMENT_PLANS = 0.5;

/**
 * En dessous de cette échelle, une rangée est « pleine » : plutôt que de
 * rapetisser encore tout le monde, une deuxième rangée s'ouvre derrière.
 * Environ 70 % de la taille d'un personnage seul (0,7).
 */
const ECHELLE_MINI_RANGEE = 0.5;

/**
 * De combien le plan de derrière (les grands d'un groupe, la deuxième
 * rangée) se pose plus haut que celui de devant, en fraction de la hauteur de
 * l'affiche (environ 9 mm sur un A4) : assez pour qu'on le lise en retrait,
 * pas assez pour qu'il flotte.
 */
const RECUL_RANG = 0.03;

/** Plus bas que cette part de l'étalon, on est « petit » (voir en tête). */
const SEUIL_PETIT = 0.81;

/**
 * À deux, chacun à côté de l'autre : il n'y a pas de groupe à composer, et un
 * enfant à moitié devant le seul adulte de l'affiche le cacherait pour rien.
 * Le groupe commence à trois.
 */
const GROUPE_MINI = 3;

/** Emprise supposée d'un dessin pas encore mesuré (voir PersonnageAComposer). */
const EMPRISE_INCONNUE: EmpriseDessin = { gauche: 0.1, droite: 0.9, haut: 0, bas: 1 };

/**
 * Demi-hauteur du cadre à l'échelle 1, en fraction de la hauteur de
 * l'affiche : la largeur × 2 (cadre 1:2) ÷ √2 (affiche 1:√2), divisée par 2.
 */
const DEMI_HAUTEUR_CADRE = (LARGEUR_CADRE_PERSONNAGE * Math.SQRT2) / 2;

function borne(valeur: number, mini: number, maxi: number): number {
  return Math.min(maxi, Math.max(mini, valeur));
}

function empriseValide(e: EmpriseDessin | null | undefined): e is EmpriseDessin {
  return (
    !!e &&
    [e.gauche, e.droite, e.haut, e.bas].every((v) => Number.isFinite(v)) &&
    e.droite > e.gauche &&
    e.bas > e.haut
  );
}

/** Un personnage tel que la composition le voit, à l'échelle 1. */
interface Mesure {
  facteur: number;
  decalage: number;
  /** Bords du dessin depuis le centre de son cadre, en fraction de la largeur de l'affiche. */
  gauche: number;
  droite: number;
  largeur: number;
  /** Hauteur du dessin, pour comparer les personnages entre eux ; null : inconnue. */
  hauteur: number | null;
}

/** Le facteur de taille, borné comme en base : un réglage aberrant ne doit pas faire disparaître la rangée entière. */
function facteurDe(p: PersonnageAComposer): number {
  return borne(Number.isFinite(p.facteur) ? Number(p.facteur) : 1, 0.3, 2);
}

/**
 * La hauteur du dessin d'un personnage, facteur de taille compris, en
 * hauteurs de cadre ; `null` tant que son dessin n'est pas mesuré.
 *
 * Elle sert aussi à l'appelant pour calculer l'étalon de composerPersonnages
 * (le plus grand personnage proposé pour le type d'affiche) : la même mesure
 * des deux côtés, sinon un adulte pourrait se croire plus petit que lui-même.
 */
export function hauteurDuDessin(p: PersonnageAComposer): number | null {
  return empriseValide(p.emprise) ? (p.emprise.bas - p.emprise.haut) * facteurDe(p) : null;
}

function mesurer(p: PersonnageAComposer): Mesure {
  const facteur = facteurDe(p);
  const decalage = borne(Number.isFinite(p.decalage) ? Number(p.decalage) : 0, -0.4, 0.4);
  const e = empriseValide(p.emprise) ? p.emprise : EMPRISE_INCONNUE;
  const cadre = LARGEUR_CADRE_PERSONNAGE * facteur;
  return {
    facteur,
    decalage,
    gauche: (e.gauche - 0.5) * cadre,
    droite: (e.droite - 0.5) * cadre,
    largeur: (e.droite - e.gauche) * cadre,
    hauteur: hauteurDuDessin(p),
  };
}

/**
 * La place d'un personnage dans la composition, à l'échelle 1 : le centre de
 * son cadre, mesuré depuis l'axe du groupe, et de combien il se pose plus
 * haut que le premier plan.
 */
interface Pose {
  i: number;
  centre: number;
  recul: number;
}

/**
 * Pose une suite de personnages de gauche à droite, chacun contre son voisin,
 * sur leurs largeurs RÉELLES — un chat ne réclame pas la place d'un adulte.
 * Deux voisins du même plan se touchent épaule contre épaule ; un petit
 * devant un grand se glisse à moitié devant lui. L'axe passe à mi-chemin du
 * premier et du dernier cadre : un personnage seul reste ainsi au centre
 * exact, comme au calage.
 */
function aLaSuite(
  suite: readonly { i: number; recul: number }[],
  m: readonly Mesure[],
): Pose[] {
  const poses: Pose[] = [];
  suite.forEach((p, k) => {
    if (k === 0) {
      poses.push({ ...p, centre: 0 });
      return;
    }
    const avant = suite[k - 1]!;
    const gauche = m[avant.i]!;
    const droite = m[p.i]!;
    const part = avant.recul === p.recul ? RECOUVREMENT : RECOUVREMENT_PLANS;
    poses.push({
      ...p,
      centre:
        poses[k - 1]!.centre +
        gauche.droite -
        droite.gauche -
        part * Math.min(gauche.largeur, droite.largeur),
    });
  });
  const milieu = (poses[0]!.centre + poses[poses.length - 1]!.centre) / 2;
  return poses.map((p) => ({ ...p, centre: p.centre - milieu }));
}

/**
 * Une rangée étalée sur l'intervalle [de, a] — la largeur de la rangée de
 * devant —, chacun au milieu de sa part : en quinconce, chacun se montre
 * entre deux dos. Jamais plus serrée qu'une rangée serrée : faute de place,
 * on la reprend telle quelle.
 */
function etalee(
  membres: readonly number[],
  recul: number,
  m: readonly Mesure[],
  de: number,
  a: number,
): Pose[] {
  const serree = aLaSuite(membres.map((i) => ({ i, recul })), m);
  const part = (a - de) / membres.length;
  const etalee = membres.map((i, j) => ({ i, recul, centre: de + (j + 0.5) * part }));
  for (let j = 1; j < membres.length; j++)
    if (etalee[j]!.centre - etalee[j - 1]!.centre < serree[j]!.centre - serree[j - 1]!.centre)
      return serree;
  return etalee;
}

/** Les bords des dessins les plus à gauche et à droite, à l'échelle 1. */
function etendue(poses: readonly Pose[], m: readonly Mesure[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const p of poses) {
    min = Math.min(min, p.centre + m[p.i]!.gauche);
    max = Math.max(max, p.centre + m[p.i]!.droite);
  }
  return { min, max };
}

/** La plus grande échelle à laquelle la composition tient entre les marges. */
function echelleDe(poses: readonly Pose[], m: readonly Mesure[]): number {
  const { min, max } = etendue(poses, m);
  const large = max - min;
  return large > 0
    ? Math.min(ECHELLE_PERSONNAGE_SEUL, LARGEUR_UTILE / large)
    : ECHELLE_PERSONNAGE_SEUL;
}

/**
 * Le groupe d'une affiche de face : les grands en retrait, dans l'ordre de la
 * liste, et les petits glissés devant eux, dans les intervalles et sur les
 * côtés — plutôt que pile devant un buste.
 *
 * Les places possibles d'un petit sont les k + 1 « fentes » d'un rang de k
 * grands : à gauche du premier, entre deux grands, à droite du dernier.
 * Elles se remplissent à parts égales, le surplus depuis le milieu et par
 * paires symétriques, pour que le groupe reste équilibré :
 *   - deux parents et un enfant : l'enfant entre eux ;
 *   - deux parents, un enfant et un chien : l'un à gauche, l'autre à droite ;
 *   - un parent et deux enfants : un de chaque côté ;
 *   - trois adultes et deux enfants : un dans chaque intervalle.
 * Les petits prennent les fentes dans l'ordre de la liste, de gauche à droite.
 */
function enGroupe(
  grands: readonly number[],
  petits: readonly number[],
): { i: number; recul: number }[] {
  const fentes = grands.length + 1;
  const parFente = new Array<number>(fentes).fill(Math.floor(petits.length / fentes));
  const reste = petits.length % fentes;
  const milieu = (fentes - 1) / 2;
  // Les fentes du centre vers les bords ; à égalité, la droite d'abord.
  let ordre = Array.from({ length: fentes }, (_, f) => f).sort(
    (a, b) => Math.abs(a - milieu) - Math.abs(b - milieu) || b - a,
  );
  // Un surplus pair se pose par paires symétriques, sans la fente du milieu.
  if (reste % 2 === 0 && Number.isInteger(milieu)) ordre = ordre.filter((f) => f !== milieu);
  for (let j = 0; j < reste; j++) parFente[ordre[j]!]!++;

  const suite: { i: number; recul: number }[] = [];
  let p = 0;
  for (let f = 0; f < fentes; f++) {
    for (let n = 0; n < parFente[f]!; n++) suite.push({ i: petits[p++]!, recul: 0 });
    if (f < grands.length) suite.push({ i: grands[f]!, recul: RECUL_RANG });
  }
  return suite;
}

/**
 * Deux rangées quand une seule ne tient plus.
 *
 * La rangée de devant reste PLEINE : on ne passe derrière que le nombre de
 * personnages qu'il faut pour qu'elle retienne sur toute la largeur à
 * l'échelle mini (ECHELLE_MINI_RANGEE), un, puis deux, puis trois… Elle en
 * garde au moins un de plus que celle de derrière ; au-delà, les deux
 * rangées rapetissent ensemble.
 *
 * Elle se partageait jusqu'ici en deux moitiés : onze adultes de dos
 * donnaient six devant, cinq derrière, et la rangée de devant, revenue à la
 * taille d'un personnage seul, laissait de la place de chaque côté — ce que
 * la boutique reprochait à l'ancienne rangée, à onze personnages au lieu de
 * six. La taille faisait en plus un bond d'un tiers entre dix personnages
 * (une rangée) et onze (deux). Désormais, onze adultes : dix devant, à la
 * taille qu'avaient les dix, et un derrière.
 *
 * Chacun de derrière se montre dans un intervalle de devant, en quinconce,
 * au lieu d'être caché derrière un dos. Ne vont derrière que des grands,
 * pris au milieu de parts égales de la liste — un seul : celui du milieu —
 * pour que l'ordre de gauche à droite reste à peu près celui de la cliente.
 */
function enDeuxRangees(
  tous: readonly number[],
  m: readonly Mesure[],
  petit: (i: number) => boolean,
): Pose[] | null {
  const grands = tous.filter((i) => !petit(i));
  const auPlus = Math.min(grands.length, Math.floor((tous.length - 1) / 2));
  if (auPlus < 1) return null;
  let poses: Pose[] = [];
  for (let nombreDerriere = 1; nombreDerriere <= auPlus; nombreDerriere++) {
    const derriere = new Set<number>();
    for (let j = 0; j < nombreDerriere; j++)
      derriere.add(grands[Math.floor(((j + 0.5) * grands.length) / nombreDerriere)]!);
    const avant = aLaSuite(
      tous.filter((i) => !derriere.has(i)).map((i) => ({ i, recul: 0 })),
      m,
    );
    const fond = etalee(
      tous.filter((i) => derriere.has(i)),
      RECUL_RANG,
      m,
      avant[0]!.centre,
      avant[avant.length - 1]!.centre,
    );
    poses = [...fond, ...avant];
    if (echelleDe(avant, m) >= ECHELLE_MINI_RANGEE) break;
  }
  return poses;
}

/**
 * La place de chaque personnage, dans l'ordre reçu (celui de la liste).
 *
 * @param etalon la hauteur (hauteurDuDessin) du plus grand personnage proposé
 *   pour ce type d'affiche. Absente, on prend le plus grand de l'affiche.
 */
export function composerPersonnages(
  personnages: readonly PersonnageAComposer[],
  composition: CompositionPersonnages,
  etalon?: number | null,
): PlaceComposee[] {
  const n = personnages.length;
  if (n === 0) return [];
  const m = personnages.map(mesurer);
  const tous = m.map((_, i) => i);

  // Un dessin pas encore mesuré n'entre pas dans la comparaison et compte
  // parmi les grands : faute de savoir, on ne le met devant personne.
  const hauteurs = m.map((x) => x.hauteur).filter((h): h is number => h !== null);
  const plusGrand = Math.max(Number.isFinite(etalon) ? Number(etalon) : 0, ...hauteurs);
  const petit = (i: number) => {
    const h = m[i]!.hauteur;
    return h !== null && h < SEUIL_PETIT * plusGrand;
  };

  let poses = aLaSuite(tous.map((i) => ({ i, recul: 0 })), m);
  if (composition === "groupe" && n >= GROUPE_MINI) {
    const grands = tous.filter((i) => !petit(i));
    const petits = tous.filter(petit);
    if (grands.length > 0 && petits.length > 0)
      poses = aLaSuite(enGroupe(grands, petits), m);
  }
  // Pleine : une rangée de plus, si elle laisse chacun plus grand.
  if (echelleDe(poses, m) < ECHELLE_MINI_RANGEE) {
    const deux = enDeuxRangees(tous, m, petit);
    if (deux && echelleDe(deux, m) > echelleDe(poses, m)) poses = deux;
  }
  const s = echelleDe(poses, m);

  // L'axe du groupe au milieu de l'affiche. Un dessin décentré dans son cadre
  // pourrait mordre sur la marge : tout le groupe glisse alors d'autant.
  const { min, max } = etendue(poses, m);
  let axe = 0.5;
  if (axe + s * min < MARGE_COTE) axe = MARGE_COTE - s * min;
  else if (axe + s * max > 1 - MARGE_COTE) axe = 1 - MARGE_COTE - s * max;

  const places: PlaceComposee[] = new Array(n);
  // Du fond vers l'avant ; dans un même plan, dans l'ordre de la liste — le
  // suivant passe devant son voisin, comme avant.
  [...poses]
    .sort((a, b) => b.recul - a.recul || a.i - b.i)
    .forEach((pose, plan) => {
      const p = m[pose.i]!;
      const scale = s * p.facteur;
      // Le décalage réglé au back-office, ramené dans l'affiche : un écart
      // vers la droite sur le dernier de la rangée ne doit pas le faire sortir.
      const demiCadre = (LARGEUR_CADRE_PERSONNAGE * scale) / 2;
      const x = borne(axe + s * pose.centre + p.decalage, demiCadre, 1 - demiCadre);
      // Les PIEDS sur la ligne du sol, et non le centre du cadre : un
      // personnage rapetissé descend d'autant que son cadre a raccourci, et
      // ses pieds restent là où le calage du back-office les a posés. Une
      // ligne plate, sans pente : celle qu'avait l'ancienne rangée, réglée
      // pour un seul muret incliné, mettait en escalier les personnages des
      // fonds à sol plat, et l'écran de calage, lui, pose les pieds à plat.
      const y =
        Y_SOL_PERSONNAGES +
        DEMI_HAUTEUR_CADRE * p.facteur * (ECHELLE_PERSONNAGE_SEUL - s) -
        pose.recul;
      places[pose.i] = { x, y, scale, plan };
    });
  return places;
}
