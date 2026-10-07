/**
 * La recherche du back-office, ce que tout le monde doit comprendre DE LA MÊME
 * FAÇON : l'API qui cherche dans les données, le back-office qui cherche dans
 * ses propres écrans, et le petit script qui, à l'arrivée sur un écran,
 * retrouve le passage et le surligne.
 *
 * Une seule implémentation, ici, et pas trois copies qui finiraient par
 * diverger : le jour où l'API aplatirait « L'Apéro » en « lapero » et le
 * script d'arrivée en « l apero », le lien mènerait au bon écran… et le
 * passage resterait introuvable, sans que personne comprenne pourquoi.
 *
 * Le fichier est PUR, et il doit le rester :
 *   - aucun import ;
 *   - ni type du navigateur ni type de Node (la bibliothèque est ES2023) : il
 *     est chargé par l'API, par le serveur du back-office ET par le
 *     navigateur ;
 *   - une syntaxe que Node sait effacer seul (ni enum, ni namespace), pour que
 *     `node --test` le charge sans outil.
 */

/* ------------------------------------------------------------------------ */
/* Les bornes                                                               */
/* ------------------------------------------------------------------------ */

/** Caractères, après trim. En dessous, tout correspond : rien ne part. */
export const RECHERCHE_MINIMUM = 2;
/** Au-delà, la saisie est coupée : personne ne tape un paragraphe pour chercher. */
export const RECHERCHE_LONGUEUR_MAX = 200;
/** Les mots suivants sont ignorés : chacun coûte un passage sur chaque texte. */
export const RECHERCHE_JETONS_MAX = 8;
export const RECHERCHE_LIMITE_PANNEAU = 5;
export const RECHERCHE_LIMITE_PAGE = 20;
export const RECHERCHE_LIMITE_MAX = 200;

export type LangueRecherche = "fr" | "en" | "de" | "it" | "es";
export const LANGUES_ETRANGERES_RECHERCHE = ["en", "de", "it", "es"] as const;
export const NOMS_LANGUES: Record<LangueRecherche, string> = {
  fr: "français",
  en: "anglais",
  de: "allemand",
  it: "italien",
  es: "espagnol",
};

/* ------------------------------------------------------------------------ */
/* Ce que la recherche rend                                                 */
/* ------------------------------------------------------------------------ */

export type GroupeId =
  | "affiches"
  | "commandes"
  | "paniers"
  | "clients"
  | "cartes"
  | "stands"
  | "collections"
  | "atelier"
  | "boutique"
  | "reglages"
  | "aide"
  | "ecrans";

/**
 * L'ordre fixe des groupes dans le panneau. Un classement global qui change à
 * chaque frappe se lit mal : on cherche des yeux au même endroit.
 */
export const ORDRE_GROUPES: readonly GroupeId[] = [
  "affiches",
  "commandes",
  "paniers",
  "clients",
  "cartes",
  "stands",
  "collections",
  "atelier",
  "boutique",
  "reglages",
  "aide",
  "ecrans",
];

/** Les groupes que l'API calcule ; « aide » et « ecrans » viennent du back-office. */
export const GROUPES_API: readonly GroupeId[] = [
  "affiches",
  "commandes",
  "paniers",
  "clients",
  "cartes",
  "stands",
  "collections",
  "atelier",
  "boutique",
  "reglages",
];

export const TITRES_GROUPES: Record<GroupeId, string> = {
  affiches: "Affiches",
  commandes: "Commandes",
  paniers: "Paniers abandonnés",
  clients: "Clients",
  cartes: "Cartes cadeaux",
  stands: "Stands",
  collections: "Collections",
  atelier: "Atelier et cadres",
  boutique: "Boutique en ligne",
  reglages: "Réglages",
  aide: "Aide",
  ecrans: "Écrans",
};

/** 0 exact · 1 début de mot · 2 contient · 3 approché. */
export type Rang = 0 | 1 | 2 | 3;

/** [debut, fin[, en unités UTF-16 du texte qui le porte. */
export interface Passage {
  debut: number;
  fin: number;
}

/** Texte brut, jamais de HTML ; « … » au bord quand il est coupé. */
export interface Extrait {
  texte: string;
  passages: Passage[];
}

export interface ResultatRecherche {
  /** Unique dans la réponse : « produit:12 », « ecran:/livraison§2 », « aide:bordereau ». */
  id: string;
  /** « Affiche », « Commande », « Écran »… */
  nature: string;
  /** Nom, numéro, code. */
  titre: string;
  /** Passages surlignés DANS titre ; [] si aucun. */
  titrePassages: Passage[];
  /** L'endroit DANS l'objet : « Description (anglais) », « Journal » ; null = le titre lui-même. */
  ou: string | null;
  /** Seconde ligne métier (statut · date · montant…), jamais un extrait. */
  detail: string | null;
  /** null quand le passage est dans le titre. */
  extrait: Extrait | null;
  /** Lien interne SANS la base /bo, toujours fabriqué par lienRecherche(). */
  href: string;
  /** Vignette d'affiche « /assets/… » servie par l'API ; null ailleurs. */
  image: string | null;
  rang: Rang;
}

export interface GroupeRecherche {
  id: GroupeId;
  titre: string;
  /** Toutes les correspondances du groupe, avant la limite. */
  total: number;
  /** Une source a atteint son plafond de candidats : le panneau affiche « 200+ ». */
  plafonne: boolean;
  resultats: ResultatRecherche[];
}

export interface Correction {
  tape: string;
  propose: string;
}

export interface ReponseRecherche {
  q: string;
  /** Seulement les non vides, dans l'ordre de ORDRE_GROUPES (le back-office peut mettre Écrans en tête). */
  groupes: GroupeRecherche[];
  corrections: Correction[];
  /** Une source, ou l'API entière, n'a pas répondu. */
  partiel: boolean;
}

/* ------------------------------------------------------------------------ */
/* Couper sans casser                                                       */
/* ------------------------------------------------------------------------ */

/**
 * Les `max` premières unités UTF-16, sans couper un émoji en deux : une
 * moitié de paire de substitution fait lever `encodeURIComponent`, et le lien
 * entier ne se fabriquerait plus.
 */
function couperTexte(texte: string, max: number): string {
  if (texte.length <= max) return texte;
  const code = texte.charCodeAt(max - 1);
  return texte.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

/** Remplace les moitiés de paires isolées, que `encodeURIComponent` refuse. */
function bienForme(texte: string): string {
  return texte.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    "�",
  );
}

/* ------------------------------------------------------------------------ */
/* Aplatir                                                                  */
/* ------------------------------------------------------------------------ */

/** Les lettres qui valent deux lettres : on tape « coeur », pas « cœur ». */
const LIGATURES: Readonly<Record<string, string>> = {
  "œ": "oe",
  "æ": "ae",
  "ß": "ss",
  "ﬁ": "fi",
  "ﬂ": "fl",
  // L'apostrophe-lettre (U+02BC) : Unicode la range parmi les LETTRES, et
  // « lʼété » resterait collé en « lʼete » alors que « l'été » s'écrit
  // « l ete ». Elle devient une espace, comme toutes les apostrophes.
  "ʼ": " ",
};

/**
 * Ce qui reste un caractère : lettres, chiffres, et trois signes qu'on tape
 * pour de bon (« 50% », « 30€ », une adresse e-mail). TOUT le reste — blancs,
 * tirets, apostrophes, ponctuation, émojis — devient une espace : « L'Apéro »
 * se tape « l apero », « SAINT-VALERY » se tape « saint valery », et le
 * « _ » des noms de fichiers de décor ne colle plus les mots entre eux.
 */
const GARDE = /^[\p{L}\p{N}@%€]$/u;

/**
 * Ce que devient UN caractère d'origine. Mémorisé : un texte ne contient
 * qu'une poignée de caractères différents, et `normalize` coûte cher.
 */
const MEMOIRE_CARACTERES = new Map<string, string>();

function caracterePlat(car: string): string {
  const connu = MEMOIRE_CARACTERES.get(car);
  if (connu !== undefined) return connu;
  // Dans cet ordre : décomposer, retirer les accents, PUIS minuscules. « İ »
  // décomposé donne « I » et un point suscrit ; dans l'autre ordre, le point
  // survivrait à la minuscule.
  const base = car
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  let sortie = "";
  for (const c of base) {
    const ligature = LIGATURES[c];
    if (ligature) sortie += ligature;
    else sortie += GARDE.test(c) ? c : " ";
  }
  if (MEMOIRE_CARACTERES.size < 4096) MEMOIRE_CARACTERES.set(car, sortie);
  return sortie;
}

/**
 * L'ASCII, tranché d'avance : c'est l'immense majorité des caractères d'un
 * texte français, et lui éviter `normalize` divise le temps par dix. La table
 * dit exactement ce que `caracterePlat` dirait (un test le vérifie).
 */
const ASCII_PLAT: readonly string[] = Array.from({ length: 128 }, (_, code) => {
  const c = String.fromCharCode(code);
  return /[A-Za-z0-9@%]/.test(c) ? c.toLowerCase() : " ";
});

/**
 * Le seul aplatissement de la recherche. Il travaille caractère d'origine par
 * caractère d'origine, ce qui lui permet de tenir, à la demande, la carte qui
 * ramène chaque lettre aplatie au caractère qui l'a produite.
 *
 * Caractère par caractère plutôt que sur le texte entier : c'est ce qui
 * garantit `aplatir(t) === aplatirAvecCarte(t).plat`. Une minuscule calculée
 * sur la phrase entière dépend de ses voisines (le sigma final grec), et la
 * carte mentirait d'une lettre.
 */
function aplatirInterne(texte: string, carte: number[] | null): string {
  let plat = "";
  // L'espace en attente : on ne l'écrit qu'au caractère suivant, ce qui
  // regroupe les blancs et retire ceux de la fin sans revenir en arrière.
  let espace = -1;
  let i = 0;
  while (i < texte.length) {
    const code = texte.charCodeAt(i);
    let largeur = 1;
    let morceau: string;
    if (code < 128) morceau = ASCII_PLAT[code]!;
    else {
      // Une paire de substitution (un émoji, une lettre mathématique) est UN
      // caractère : elle se traite d'un bloc.
      const point = texte.codePointAt(i)!;
      if (point > 0xffff) largeur = 2;
      morceau = caracterePlat(largeur === 2 ? texte.slice(i, i + 2) : texte[i]!);
    }
    for (let k = 0; k < morceau.length; k++) {
      const c = morceau[k]!;
      if (c === " ") {
        if (plat.length > 0 && espace < 0) espace = i;
        continue;
      }
      if (espace >= 0) {
        plat += " ";
        if (carte) carte.push(espace);
        espace = -1;
      }
      plat += c;
      if (carte) carte.push(i);
    }
    i += largeur;
  }
  if (carte) carte.push(texte.length);
  return plat;
}

/**
 * Minuscules, sans accents ni ligatures, ponctuation changée en espaces,
 * blancs regroupés. « L'Apéro-Œuvre_2 » → « l apero oeuvre 2 ».
 */
export function aplatir(texte: string): string {
  return aplatirInterne(texte, null);
}

/**
 * Le même aplatissement, avec la carte : carte[i] est l'indice, dans le texte
 * d'origine, du caractère qui a produit plat[i] (les deux lettres de « oe »
 * pointent sur « œ »). carte.length = plat.length + 1 : la dernière case est
 * la fin du texte.
 */
export function aplatirAvecCarte(texte: string): { plat: string; carte: number[] } {
  const carte: number[] = [];
  const plat = aplatirInterne(texte, carte);
  return { plat, carte };
}

/**
 * [debut, fin[ dans le texte aplati → le passage correspondant dans le texte
 * d'origine. Les accents écrits en deux caractères (« e » suivi d'un accent
 * combinant) restent avec leur lettre : le surlignage ne coupe pas un « é ».
 */
export function intervalleOrigine(
  texte: string,
  carte: readonly number[],
  debut: number,
  fin: number,
): Passage {
  const dernierPlat = Math.max(0, carte.length - 1);
  const d = Math.min(Math.max(0, debut), dernierPlat);
  const f = Math.min(Math.max(d, fin), dernierPlat);
  const origineDebut = carte[d] ?? texte.length;
  if (f <= d) return { debut: origineDebut, fin: origineDebut };
  const dernier = carte[f - 1] ?? origineDebut;
  const point = texte.codePointAt(dernier) ?? 0;
  let origineFin = dernier + (point > 0xffff ? 2 : 1);
  while (origineFin < texte.length) {
    const code = texte.charCodeAt(origineFin);
    if (code >= 0x300 && code <= 0x36f) origineFin++;
    else break;
  }
  return { debut: origineDebut, fin: Math.max(origineFin, origineDebut) };
}

/* ------------------------------------------------------------------------ */
/* Découper la saisie                                                       */
/* ------------------------------------------------------------------------ */

/**
 * Les mots de la saisie, aplatis et dédoublonnés.
 *
 * Une lettre isolée part : « l'apero » se lit « apero », et le « l » ne vient
 * pas exiger qu'un mot commence par l. Même SEULES, les lettres isolées ne
 * cherchent rien : « a_b » devenait « a » et « b », deux débuts de mots
 * qu'on trouve partout, et ramenait les deux tiers du catalogue pour une
 * saisie qui ne voulait rien dire. Un CHIFFRE isolé reste, lui : « 3
 * affiches », « SAL-1 » en ont besoin.
 */
export function jetons(saisie: string): string[] {
  const plat = aplatir(couperTexte(saisie.trim(), RECHERCHE_LONGUEUR_MAX));
  return [...new Set(plat.split(" ").filter(Boolean))]
    .filter((m) => m.length >= 2 || /^\d$/.test(m))
    .slice(0, RECHERCHE_JETONS_MAX);
}

/**
 * Un numéro ou un code tel qu'on le recopie : majuscules, sans espaces ni
 * . - _ / ( ) #. « web 0013 », « WEB-0013 » et « web.0013 » donnent la même
 * chose.
 */
export function compacter(saisie: string): string {
  return saisie.toUpperCase().replace(/[\s.\-_/()#]/g, "");
}

/**
 * Les chiffres d'un téléphone, l'indicatif français ramené à 0 : « +33 6 12 »
 * et « 06 12 » se retrouvent. La même règle est écrite en SQL (recherche-sql)
 * — elles doivent rester identiques, sinon la base écarterait ce que le
 * navigateur aurait gardé.
 */
export function chiffresTelephone(texte: string): string {
  return texte
    .trim()
    .replace(/^(\+33|0033)/, "0")
    .replace(/\D/g, "");
}

/* ------------------------------------------------------------------------ */
/* HTML → texte                                                             */
/* ------------------------------------------------------------------------ */

const ENTITES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  agrave: "à",
  acirc: "â",
  ccedil: "ç",
  ocirc: "ô",
  ucirc: "û",
  ugrave: "ù",
  icirc: "î",
  iuml: "ï",
  euml: "ë",
  oelig: "œ",
  laquo: "«",
  raquo: "»",
  rsquo: "’",
  lsquo: "‘",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  euro: "€",
  deg: "°",
};

function entite(brut: string, nom: string): string {
  if (nom.startsWith("#")) {
    const n =
      nom[1] === "x" || nom[1] === "X"
        ? Number.parseInt(nom.slice(2), 16)
        : Number.parseInt(nom.slice(1), 10);
    if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff))
      return brut;
    return String.fromCodePoint(n);
  }
  return ENTITES[nom.toLowerCase()] ?? brut;
}

/**
 * Le texte que lit quelqu'un devant ce HTML, sans aucune balise.
 *
 * Les fins de bloc deviennent une espace, sinon « …de mer.</p><p>Une idée »
 * collerait « mer.Une ». Les entités sont décodées APRÈS le retrait des
 * balises : « &lt;img&gt; » écrit dans un texte reste du texte, il ne devient
 * jamais une balise qu'on retirerait.
 */
export function texteDeHtml(html: string): string {
  if (!html) return "";
  const sansBalises = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|li|h[1-6]|div|tr|td|th|blockquote|ul|ol)\s*>/gi, " ")
    .replace(/<[^>]*>/g, "");
  return sansBalises
    .replace(/&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z]{2,8});/g, (brut, nom: string) =>
      entite(brut, nom),
    )
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------------ */
/* Vocabulaire et fautes de frappe                                          */
/* ------------------------------------------------------------------------ */

/**
 * Les mots d'un texte qui peuvent servir de correction : aplatis, de quatre
 * lettres au moins, sans chiffre. Une adresse e-mail est coupée à l'arobase
 * — « dupont@example » n'est pas un mot, « dupont » en est un.
 */
export function motsDe(texte: string): string[] {
  const vus = new Set<string>();
  for (const mot of aplatir(texte).split(" "))
    for (const morceau of mot.split(/[@%€]/))
      if (morceau.length >= 4 && !/\d/.test(morceau)) vus.add(morceau);
  return [...vus];
}

/**
 * Distance de Damerau-Levenshtein restreinte (une inversion de deux lettres
 * voisines compte pour une faute, comme une lettre en trop ou en moins).
 * Bornée : dès qu'une ligne entière dépasse `max`, la réponse est `max + 1`
 * — on ne cherche pas à savoir de combien deux mots diffèrent, seulement
 * s'ils sont assez proches.
 */
export function distance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (la === 0) return lb <= max ? lb : max + 1;
  if (lb === 0) return la <= max ? la : max + 1;
  let avant: number[] = new Array<number>(lb + 1).fill(0);
  let precedente: number[] = Array.from({ length: lb + 1 }, (_, j) => j);
  let courante: number[] = new Array<number>(lb + 1).fill(0);
  for (let i = 1; i <= la; i++) {
    courante[0] = i;
    let minimum = i;
    for (let j = 1; j <= lb; j++) {
      const cout = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(
        precedente[j]! + 1,
        courante[j - 1]! + 1,
        precedente[j - 1]! + cout,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        v = Math.min(v, avant[j - 2]! + 1);
      courante[j] = v;
      if (v < minimum) minimum = v;
    }
    if (minimum > max) return max + 1;
    const recycle = avant;
    avant = precedente;
    precedente = courante;
    courante = recycle;
  }
  const d = precedente[lb]!;
  return d <= max ? d : max + 1;
}

export interface JetonRequete {
  mot: string;
  /** Le singulier léger : « bandeaux » → « bandeau ». */
  variantes: string[];
  /** Les mots connus les plus proches d'un mot inconnu (fautes de frappe). */
  corrections: string[];
  /**
   * Le mot figure tel quel dans le vocabulaire (ou dans les `connus` reçus).
   * Le back-office s'en sert pour dire à l'API quels mots ses écrans
   * connaissent, et qu'elle n'a donc pas à corriger.
   */
  connu?: boolean;
}

export interface Requete {
  saisie: string;
  plat: string;
  jetons: JetonRequete[];
  /** La première proposition de chaque mot corrigé (voir Evaluation.approches pour celles qui ont servi). */
  corrections: Correction[];
}

/**
 * Les mots connus, et, quand on les a, le nombre de textes où chacun figure :
 * entre deux corrections aussi proches, la plus courante l'emporte (« your »
 * devient « pour », que mille textes écrivent, plutôt que « cour »).
 */
export type Vocabulaire = ReadonlySet<string> | ReadonlyMap<string, number>;

export interface OptionsRequete {
  /**
   * Des mots à ne JAMAIS corriger. La recherche a deux moitiés, chacune avec
   * son vocabulaire : l'API (les données) et le back-office (ses écrans).
   * Sans cela, chacune « corrigeait » les mots que seule l'autre connaissait
   * — « vidéo » devenait « vider » côté données alors que l'écran Accueil et
   * pied de page en parle, « montagne » devenait « montant » côté écrans alors
   * que huit affiches s'appellent ainsi.
   */
  connus?: ReadonlySet<string>;
  /**
   * Le REPLI, quand une première passe n'a rien trouvé du tout : corriger
   * aussi les mots de cinq lettres ou plus que le vocabulaire connaît déjà.
   * Une faute peut exister quelque part dans la boutique — le décor
   * « MADRID_Affiche_personalisee_1 » rend « personalisee » connu — et elle
   * ne doit pas empêcher de trouver les cent affiches « personnalisées ».
   */
  forcer?: boolean;
}

const LETTRES_SEULES = /^\p{L}+$/u;

function frequence(vocabulaire: Vocabulaire, mot: string): number {
  return vocabulaire instanceof Map ? ((vocabulaire as ReadonlyMap<string, number>).get(mot) ?? 0) : 0;
}

/** Un mot du vocabulaire contient-il l'une de ces formes ? (« amien » est dans « amiens ».) */
function estConnu(vocabulaire: Vocabulaire, formes: readonly string[]): boolean {
  for (const w of vocabulaire.keys()) if (formes.some((f) => w.includes(f))) return true;
  return false;
}

/**
 * Les mots du vocabulaire les plus proches de `mot` : le mot entier à une
 * faute près (deux au-delà de sept lettres), ou, à défaut — et à partir de
 * cinq lettres —, un mot plus long qui COMMENCE presque comme lui : c'est ce
 * qui trouve « biarritz » pendant qu'on tape encore « biari ». Un début de
 * mot ne sert qu'en dernier recours : « coeur » a son voisin entier
 * (« soeur »), il n'a pas à devenir « courriers » parce que « cour… »
 * commence presque pareil. Entre candidats aussi proches, le plus courant.
 *
 * Un mot de quatre lettres n'a droit qu'à une proposition : à une lettre
 * près, il en a des dizaines (« your » : jour, pour, four, tour…), et trois à
 * la fois ramenaient la moitié du catalogue.
 */
function proches(mot: string, vocabulaire: Vocabulaire, dejaConnu: boolean): string[] {
  const tolerance = mot.length <= 7 ? 1 : 2;
  const combien = mot.length <= 4 ? 1 : 3;
  const entiers: { w: string; d: number; f: number }[] = [];
  const debuts: { w: string; d: number; f: number }[] = [];
  for (const w of vocabulaire.keys()) {
    // Au repli, un mot qui CONTIENT la saisie la trouve déjà tel quel.
    if (dejaConnu && w.includes(mot)) continue;
    if (Math.abs(w.length - mot.length) <= tolerance) {
      const d = distance(mot, w, tolerance);
      if (d > 0 && d <= tolerance) {
        entiers.push({ w, d, f: frequence(vocabulaire, w) });
        continue;
      }
    }
    // Le début d'un mot plus long, de la longueur tapée ou d'une lettre de
    // plus (une lettre oubliée : « biarit » est presque « biarrit… »).
    if (mot.length >= 5 && w.length > mot.length) {
      const d = Math.min(
        distance(mot, w.slice(0, mot.length), tolerance),
        distance(mot, w.slice(0, mot.length + 1), tolerance),
      );
      if (d > 0 && d <= tolerance) debuts.push({ w, d, f: frequence(vocabulaire, w) });
    }
  }
  const candidats = entiers.length ? entiers : debuts;
  candidats.sort(
    (x, y) =>
      x.d - y.d ||
      y.f - x.f ||
      Math.abs(x.w.length - mot.length) - Math.abs(y.w.length - mot.length) ||
      (x.w < y.w ? -1 : x.w > y.w ? 1 : 0),
  );
  return candidats.slice(0, combien).map((c) => c.w);
}

/**
 * Un mot de trois lettres : seulement deux lettres voisines inversées
 * (« mre » → « mer »), et seulement si un mot connu commence ainsi. À une
 * lettre près, un mot si court ressemble à tout ; l'inversion, elle, est la
 * faute de frappe la plus courante et la moins ambiguë.
 */
function transpositions(mot: string, vocabulaire: Vocabulaire): string[] {
  const sortie: string[] = [];
  for (let i = 0; i + 1 < mot.length; i++) {
    const t = mot.slice(0, i) + mot[i + 1] + mot[i] + mot.slice(i + 2);
    if (t === mot || sortie.includes(t)) continue;
    for (const w of vocabulaire.keys())
      if (w.startsWith(t)) {
        sortie.push(t);
        break;
      }
  }
  return sortie;
}

/**
 * La saisie préparée une fois pour toutes les sources.
 *
 * On ne corrige QUE les mots que personne n'a jamais écrits : « port »
 * existe, il ne sera donc jamais « approché » vers « porte » ou « fort ».
 * « amien » n'est pas corrigé non plus : il commence « amiens », il trouve
 * déjà tout seul. C'est ce qui garde les approximations pour les vraies
 * fautes — « biaritz », « berjer », « biari » en pleine frappe, « mre ».
 * Deux exceptions, voir OptionsRequete : les mots que l'autre moitié de la
 * recherche connaît, et le repli quand rien n'a été trouvé.
 */
export function preparerRequete(
  saisie: string,
  vocabulaire?: Vocabulaire,
  options: OptionsRequete = {},
): Requete {
  const s = couperTexte(saisie.trim(), RECHERCHE_LONGUEUR_MAX);
  const plat = aplatir(s);
  const liste: JetonRequete[] = [];
  const corrections: Correction[] = [];
  const avecVocabulaire = !!vocabulaire && vocabulaire.size > 0;
  for (const mot of jetons(s)) {
    const variantes =
      mot.length >= 4 && /[sx]$/.test(mot) && !/\d/.test(mot) ? [mot.slice(0, -1)] : [];
    let proposes: string[] = [];
    let connu = false;
    if (options.connus?.has(mot)) connu = true;
    else if (vocabulaire && avecVocabulaire && mot.length >= 3 && LETTRES_SEULES.test(mot)) {
      connu = estConnu(vocabulaire, [mot, ...variantes]);
      if (mot.length === 3) {
        if (!connu) proposes = transpositions(mot, vocabulaire);
      } else if (!connu) proposes = proches(mot, vocabulaire, false);
      else if (options.forcer && mot.length >= 5) proposes = proches(mot, vocabulaire, true);
      if (proposes[0]) corrections.push({ tape: mot, propose: proposes[0] });
    }
    liste.push({ mot, variantes, corrections: proposes, connu });
  }
  return { saisie: s, plat, jetons: liste, corrections };
}

/* ------------------------------------------------------------------------ */
/* Évaluer un objet                                                         */
/* ------------------------------------------------------------------------ */

export interface ChampEvalue {
  texte: string;
  /** aplatir(texte), quand il est déjà calculé. DOIT lui être égal. */
  plat?: string;
  poids: number;
  /**
   * Longueur minimale d'un mot pour qu'il soit cherché dans ce champ (e-mail :
   * 3), sauf quand la saisie entière — deux mots au moins — y est recopiée
   * telle quelle (voir evaluer).
   */
  minimum?: number;
  /**
   * Un champ NEUTRE : ce que l'objet EST (« stand », « page », « cliente »),
   * ou le nom de l'écran d'une section. Un mot peut s'y trouver — « stand
   * mulhouse » trouve le stand de Mulhouse —, mais il ne fait jamais répondre
   * l'objet à lui seul, il n'est jamais « exact », et il ne porte jamais
   * l'extrait ni le lien.
   */
  neutre?: boolean;
  /**
   * Un NOM qu'on abrège : un mot de trois à cinq lettres peut y désigner les
   * initiales de mots qui se suivent, mots vides sautés — « cgv » trouve
   * « Conditions générales de vente » (rang « contient »). Réservé aux noms
   * des fiches gardées en mémoire et des écrans : un préfiltre en base ne
   * saurait pas lire des initiales, et écarterait ce que le JavaScript
   * trouverait.
   */
  sigles?: boolean;
}

export interface Evaluation {
  rang: Rang;
  motsEntiers: number;
  /** L'indice du champ qui porte le mieux la correspondance (jamais un champ neutre). */
  meilleur: number;
  /** Le poids de ce champ. */
  poids: number;
  /** passages[i] : les occurrences retenues dans le champ i, ramenées au texte d'origine. */
  passages: Passage[][];
  /**
   * Les corrections qui ont RÉELLEMENT servi : un mot trouvé seulement
   * approximativement, et le mot qui l'a remplacé. C'est ce que le panneau
   * annonce (« Résultats approchés pour … ») — et non la première proposition
   * de la liste, qui n'est pas forcément celle qui a trouvé.
   */
  approches?: Correction[];
}

/** Pas plus d'occurrences par mot et par champ : au-delà on ne lit plus. */
const OCCURRENCES_MAX = 50;
/** Pas plus de passages surlignés par champ. */
const PASSAGES_MAX = 20;

interface Trouve {
  rang: 1 | 2 | 3;
  entier: boolean;
  occurrences: [number, number][];
  /** Rang 3 : la correction qui a trouvé. */
  correction?: string;
}

const ESPACE = 32;

function toutes(texte: string, forme: string, debutDeMot: boolean): number[] {
  const positions: number[] = [];
  if (!forme) return positions;
  let p = texte.indexOf(forme);
  while (p !== -1 && positions.length < OCCURRENCES_MAX) {
    if (!debutDeMot || p === 0 || texte.charCodeAt(p - 1) === ESPACE) positions.push(p);
    p = texte.indexOf(forme, p + 1);
  }
  return positions;
}

function finDeMot(texte: string, fin: number): boolean {
  return fin >= texte.length || texte.charCodeAt(fin) === ESPACE;
}

/**
 * Le sigle `mot` (trois à cinq lettres) dans un texte aplati : les initiales
 * de mots qui se suivent, mots vides sautés (« cgv » : Conditions Générales
 * de Vente). Rend [début du premier mot, fin du dernier], ou null.
 */
function initiales(texte: string, mot: string): [number, number] | null {
  if (mot.length < 3 || mot.length > 5 || !LETTRES_SEULES.test(mot)) return null;
  const mots: { d: number; f: number }[] = [];
  let d = 0;
  for (let i = 0; i <= texte.length; i++) {
    if (i < texte.length && texte.charCodeAt(i) !== ESPACE) continue;
    if (i > d && !MOTS_VIDES.has(texte.slice(d, i))) mots.push({ d, f: i });
    d = i + 1;
  }
  for (let k = 0; k + mot.length <= mots.length; k++) {
    let ok = true;
    for (let j = 0; j < mot.length && ok; j++) ok = texte[mots[k + j]!.d] === mot[j];
    if (ok) return [mots[k]!.d, mots[k + mot.length - 1]!.f];
  }
  return null;
}

/**
 * Ce qu'un mot de la saisie trouve dans un texte aplati, au meilleur rang.
 *
 * « Contient » n'est permis qu'à partir de trois caractères, ou pour un
 * nombre : « co » ne doit pas remonter toutes les adresses en « .com », mais
 * « 13 » doit trouver WEB-0113.
 *
 * Le singulier (« bandeaux » → « bandeau ») ne compte que comme MOT ENTIER :
 * sinon « bois » donnerait « boi », et « boîte aux lettres » répondrait à
 * « cadre bois ». Le mot tapé, lui, reste cherché en début de mot.
 */
function chercherJeton(texte: string, jeton: JetonRequete, sigles = false): Trouve | null {
  const debut: [number, number][] = [];
  let entier = false;
  for (const p of toutes(texte, jeton.mot, true)) {
    debut.push([p, p + jeton.mot.length]);
    if (finDeMot(texte, p + jeton.mot.length)) entier = true;
  }
  for (const forme of jeton.variantes)
    for (const p of toutes(texte, forme, true))
      if (finDeMot(texte, p + forme.length)) {
        debut.push([p, p + forme.length]);
        entier = true;
      }
  if (debut.length) return { rang: 1, entier, occurrences: debut };

  if (jeton.mot.length >= 3 || /^\d+$/.test(jeton.mot)) {
    const dedans = toutes(texte, jeton.mot, false).map(
      (p): [number, number] => [p, p + jeton.mot.length],
    );
    if (dedans.length) return { rang: 2, entier: false, occurrences: dedans };
  }

  if (sigles) {
    const s = initiales(texte, jeton.mot);
    if (s) return { rang: 2, entier: false, occurrences: [s] };
  }

  const approche: [number, number][] = [];
  let laquelle: string | undefined;
  for (const correction of jeton.corrections)
    for (const p of toutes(texte, correction, true))
      if (finDeMot(texte, p + correction.length)) {
        approche.push([p, p + correction.length]);
        laquelle ??= correction;
      }
  if (approche.length) return { rang: 3, entier: false, occurrences: approche, correction: laquelle };
  return null;
}

/**
 * Les cartes déjà calculées, par texte : taper « biarritz » lettre par lettre
 * repasse sur les mêmes descriptions, inutile de refaire leur carte à chaque
 * frappe. Vidée d'un coup quand elle grossit : c'est un raccourci, pas un
 * stock.
 */
const CARTES = new Map<string, { plat: string; carte: number[] }>();

function carteDe(texte: string): { plat: string; carte: number[] } {
  const connue = CARTES.get(texte);
  if (connue) return connue;
  if (CARTES.size > 2000) CARTES.clear();
  const calculee = aplatirAvecCarte(texte);
  CARTES.set(texte, calculee);
  return calculee;
}

/** Trie et fusionne les passages qui se touchent ou se chevauchent. */
function fusionner(passages: Passage[]): Passage[] {
  const tries = passages
    .filter((p) => p.fin > p.debut)
    .sort((a, b) => a.debut - b.debut || a.fin - b.fin);
  const sortie: Passage[] = [];
  for (const p of tries) {
    const dernier = sortie[sortie.length - 1];
    if (dernier && p.debut <= dernier.fin) dernier.fin = Math.max(dernier.fin, p.fin);
    else sortie.push({ debut: p.debut, fin: p.fin });
  }
  return sortie;
}

/** La largeur d'un passage à retrouver : celle que `passageACibler` accepte. */
const FENETRE = 60;

/**
 * Les occurrences à montrer dans un champ, en commençant par l'endroit où les
 * mots tapés sont le plus RASSEMBLÉS.
 *
 * Sans cela, « frais de port » surlignait d'abord le premier « de » du
 * texte : un mot aussi courant remplissait à lui seul les vingt passages, et
 * l'extrait comme le lien partaient du mauvais endroit. On cherche donc, parmi
 * les fenêtres de soixante caractères qui commencent sur une occurrence,
 * celle qui contient le plus de mots DIFFÉRENTS ; à égalité, celle dont ces
 * mots sont les plus LONGS — quand aucun couple ne tient dans la fenêtre,
 * « mot de passe » partait du premier « de » du texte, le plus court, et le
 * lien emmenait chercher « de » ; puis la plus RAMASSÉE — celle où il faut le
 * moins de texte pour les couvrir tous (« frais de port » plutôt que « de
 * tout le reste… les frais de port ») ; puis la première. On garde ce qui
 * commence à partir d'elle : la fenêtre vient en premier, l'extrait se centre
 * sur elle, et le lien la retrouve.
 */
function retenues(parJeton: readonly [number, number][][]): [number, number][] {
  const toutes: { d: number; f: number; k: number }[] = [];
  parJeton.forEach((liste, k) => {
    for (const [d, f] of liste) toutes.push({ d, f, k });
  });
  toutes.sort((a, b) => a.d - b.d || a.f - b.f);
  if (parJeton.length < 2 || toutes.length < 2) return toutes.map((o) => [o.d, o.f]);

  const vus = new Array<boolean>(parJeton.length);
  let meilleur = { debut: toutes[0]!.d, differents: -1, couvert: -1, etendue: Infinity };
  for (let gauche = 0; gauche < toutes.length; gauche++) {
    const debut = toutes[gauche]!.d;
    // Les mots différents de la fenêtre, leur longueur, et ce qu'il faut de
    // texte pour en couvrir chacun une fois (la fin la plus lointaine au
    // moment où le dernier mot nouveau apparaît).
    vus.fill(false);
    let differents = 0;
    let couvert = 0;
    let etendue = 0;
    let finMax = debut;
    for (let i = gauche; i < toutes.length; i++) {
      const o = toutes[i]!;
      if (i > gauche && o.f - debut > FENETRE) break;
      finMax = Math.max(finMax, o.f);
      if (!vus[o.k]) {
        vus[o.k] = true;
        differents++;
        couvert += o.f - o.d;
        etendue = finMax - debut;
      }
    }
    if (
      differents > meilleur.differents ||
      (differents === meilleur.differents &&
        (couvert > meilleur.couvert ||
          (couvert === meilleur.couvert && etendue < meilleur.etendue)))
    )
      meilleur = { debut, differents, couvert, etendue };
  }
  return toutes.filter((o) => o.d >= meilleur.debut).map((o) => [o.d, o.f]);
}

/**
 * Est-ce que cet objet répond à la saisie, et à quel point ?
 *
 * TOUS les mots doivent se retrouver, chacun dans au moins un champ — pas
 * forcément le même : « dupont nantes » trouve la cliente dont le nom est
 * Dupont et la ville Nantes. Un seul mot absent, et l'objet ne répond pas.
 *
 * Le rang de l'objet est celui de son mot le MOINS bien trouvé : un objet où
 * un mot n'est trouvé qu'approximativement n'est pas une correspondance
 * exacte, même si les autres mots le sont.
 *
 * Le minimum d'un champ (l'e-mail : trois caractères) tombe quand la saisie
 * entière, de deux mots au moins, y figure telle quelle. Sans cela,
 * « prenom.nom@orange.fr » ne trouvait pas la cliente : le « fr » final, deux
 * lettres, n'était cherché nulle part — et l'adresse collée depuis un
 * courriel est la façon la plus courante de chercher une cliente. Un « co »
 * tapé seul reste, lui, sans effet sur les adresses en « .com ».
 */
export function evaluer(champs: readonly ChampEvalue[], requete: Requete): Evaluation | null {
  const n = champs.length;
  const nbJetons = requete.jetons.length;
  if (!n || !nbJetons) return null;
  const plats = champs.map((c) => c.plat ?? aplatir(c.texte));
  const recopiee =
    nbJetons >= 2 && requete.plat ? plats.map((p) => p.includes(requete.plat)) : null;

  // trouves[k][i] : ce que le mot k trouve dans le champ i.
  const trouves: (Trouve | null)[][] = [];
  const meilleurRang: number[] = [];
  let motsEntiers = 0;
  for (const jeton of requete.jetons) {
    const ligne: (Trouve | null)[] = new Array<Trouve | null>(n).fill(null);
    let rang = 4;
    let entier = false;
    for (let i = 0; i < n; i++) {
      const champ = champs[i]!;
      const plat = plats[i]!;
      if (!plat) continue;
      if (champ.minimum !== undefined && jeton.mot.length < champ.minimum && !recopiee?.[i])
        continue;
      const t = chercherJeton(plat, jeton, champ.sigles);
      if (!t) continue;
      // Dans un champ neutre, seulement un mot entier ou un vrai début de mot
      // (quatre lettres) : « promo » y trouve « promotion », mais le « sal »
      // de « SAL-1 » ne doit pas faire de chaque vente de stand un « salon ».
      if (champ.neutre && (t.rang !== 1 || (!t.entier && jeton.mot.length < 4))) continue;
      ligne[i] = t;
      if (t.rang < rang) rang = t.rang;
      if (t.entier) entier = true;
    }
    if (rang === 4) return null;
    trouves.push(ligne);
    meilleurRang.push(rang);
    if (entier) motsEntiers++;
  }

  // Un objet ne répond pas par ses seuls champs neutres : « stand » tapé
  // seul ne ramène pas tous les stands, ni « page » toutes les pages.
  let parUnVraiChamp = false;
  for (let i = 0; i < n && !parUnVraiChamp; i++)
    if (!champs[i]!.neutre) for (const ligne of trouves) if (ligne[i]) parUnVraiChamp = true;
  if (!parUnVraiChamp) return null;

  // Exact : la saisie entière EST le texte d'un champ entier (« Paysage »,
  // « Bandeau et offre »). Parmi plusieurs, le plus lourd.
  const exacts = new Set<number>();
  if (requete.plat)
    for (let i = 0; i < n; i++) {
      const { minimum, neutre } = champs[i]!;
      if (neutre) continue;
      if (plats[i] === requete.plat && (minimum === undefined || requete.plat.length >= minimum))
        exacts.add(i);
    }
  const rang = (exacts.size ? 0 : Math.max(...meilleurRang)) as Rang;

  // Les corrections qui ont servi : celle du premier champ où le mot n'a été
  // trouvé qu'approximativement.
  const approches: Correction[] = [];
  requete.jetons.forEach((jeton, k) => {
    if (meilleurRang[k] !== 3) return;
    const t = trouves[k]!.find((x) => x?.rang === 3 && x.correction);
    if (t?.correction) approches.push({ tape: jeton.mot, propose: t.correction });
  });

  // Le champ qui porte le mieux la correspondance : celui qui contient le
  // plus de mots, puis le mieux classé, puis le plus lourd, puis le premier.
  // Les mots qu'un champ neutre explique (« page » dans « page cgv ») passent
  // après les autres : ils disent ce qu'on cherche, pas où le trouver — le
  // « page » d'une phrase du contenu ne doit pas l'emporter sur le titre que
  // « cgv » désigne.
  const parLaNature = trouves.map((ligne) => ligne.some((t, i) => !!t && !!champs[i]!.neutre));
  let meilleur = -1;
  let meilleurPropres = -1;
  let meilleurNombre = -1;
  let meilleurRangChamp = 5;
  let meilleurPoids = -Infinity;
  for (let i = 0; i < n; i++) {
    if (champs[i]!.neutre) continue;
    let nombre = 0;
    let propres = 0;
    let rangChamp = 0;
    for (let k = 0; k < nbJetons; k++) {
      const t = trouves[k]![i];
      if (!t) continue;
      nombre++;
      if (!parLaNature[k]) propres++;
      if (t.rang > rangChamp) rangChamp = t.rang;
    }
    if (!nombre) continue;
    if (exacts.has(i)) rangChamp = 0;
    const poids = champs[i]!.poids;
    if (
      propres > meilleurPropres ||
      (propres === meilleurPropres &&
        (nombre > meilleurNombre ||
          (nombre === meilleurNombre &&
            (rangChamp < meilleurRangChamp ||
              (rangChamp === meilleurRangChamp && poids > meilleurPoids)))))
    ) {
      meilleur = i;
      meilleurPropres = propres;
      meilleurNombre = nombre;
      meilleurRangChamp = rangChamp;
      meilleurPoids = poids;
    }
  }
  if (meilleur < 0) return null;

  const passages: Passage[][] = champs.map((champ, i) => {
    const plat = plats[i]!;
    let occurrences: [number, number][];
    if (exacts.has(i)) occurrences = [[0, plat.length]];
    else {
      const parJeton: [number, number][][] = [];
      for (let k = 0; k < nbJetons; k++) {
        const t = trouves[k]![i];
        if (t) parJeton.push(t.occurrences);
      }
      occurrences = retenues(parJeton);
    }
    if (!occurrences.length) return [];
    const { carte } = carteDe(champ.texte);
    return fusionner(
      occurrences.map(([d, f]) => intervalleOrigine(champ.texte, carte, d, f)),
    ).slice(0, PASSAGES_MAX);
  });

  return { rang, motsEntiers, meilleur, poids: champs[meilleur]!.poids, passages, approches };
}

/**
 * Ce que « Résultats approchés pour … » annonce, à partir des corrections qui
 * ont servi à chaque résultat (Evaluation.approches) : une par mot tapé — le
 * contrat —, et quand plusieurs ont servi, celle qui a trouvé le plus.
 * « viles » trouve la collection, le menu et quatre décors « Villes », et une
 * seule affiche « GOOD VIBES » : c'est « villes » qu'on annonce, pas
 * « vibes », première de la liste des propositions.
 */
export function correctionsServies(parResultat: readonly (readonly Correction[])[]): Correction[] {
  const comptes = new Map<string, Map<string, number>>();
  for (const approches of parResultat)
    for (const c of approches) {
      const parMot = comptes.get(c.tape) ?? new Map<string, number>();
      parMot.set(c.propose, (parMot.get(c.propose) ?? 0) + 1);
      comptes.set(c.tape, parMot);
    }
  const sortie: Correction[] = [];
  for (const [tape, parMot] of comptes) {
    let propose = "";
    let n = 0;
    for (const [mot, k] of parMot)
      if (k > n) {
        propose = mot;
        n = k;
      }
    sortie.push({ tape, propose });
  }
  return sortie;
}

export interface Classement {
  rang: Rang;
  poids: number;
  motsEntiers: number;
  ordre: number;
}

/**
 * Exact, puis début de mot, puis contient, puis approché ; à rang égal, le
 * champ le plus lourd (un nom passe devant une description), puis le plus de
 * mots entiers, puis l'ordre de la source.
 */
export function comparer(a: Classement, b: Classement): number {
  return (
    a.rang - b.rang ||
    b.poids - a.poids ||
    b.motsEntiers - a.motsEntiers ||
    a.ordre - b.ordre
  );
}

/* ------------------------------------------------------------------------ */
/* Montrer le passage                                                       */
/* ------------------------------------------------------------------------ */

const BLANC = /\s/;

function estBlanc(texte: string, i: number): boolean {
  return BLANC.test(texte[i] ?? " ");
}

/**
 * Une fenêtre d'environ deux fois `largeur` caractères autour du premier
 * passage, élargie jusqu'aux mots entiers, avec « … » là où le texte est
 * coupé.
 *
 * Les blancs (retours à la ligne, espaces insécables) deviennent des espaces
 * UN pour UN : les positions ne bougent pas, et les passages se recalent par
 * une simple soustraction.
 */
export function couperExtrait(
  texte: string,
  passages: readonly Passage[],
  largeur = 70,
): Extrait {
  const longueur = texte.length;
  if (!longueur) return { texte: "", passages: [] };
  const tries = [...passages].sort((a, b) => a.debut - b.debut);
  const premier = tries[0];
  let debut: number;
  let fin: number;
  if (!premier) {
    debut = 0;
    fin = Math.min(longueur, 2 * largeur);
  } else {
    debut = premier.debut - largeur;
    fin = Math.min(Math.max(premier.fin, premier.debut + largeur), premier.debut + 3 * largeur);
    if (debut < 0) {
      fin -= debut;
      debut = 0;
    }
    if (fin > longueur) {
      debut = Math.max(0, debut - (fin - longueur));
      fin = longueur;
    }
  }
  // Élargir aux mots entiers, sur vingt caractères au plus : au-delà, c'est
  // une adresse ou un mot interminable, on coupe dedans.
  let d = debut;
  for (let pas = 0; d > 0 && !estBlanc(texte, d - 1) && pas < 20; pas++) d--;
  if (d === 0 || estBlanc(texte, d - 1)) debut = d;
  let f = fin;
  for (let pas = 0; f < longueur && !estBlanc(texte, f) && pas < 20; pas++) f++;
  if (f === longueur || estBlanc(texte, f)) fin = f;
  // Ne jamais couper un émoji en deux.
  if (debut > 0 && debut < longueur) {
    const code = texte.charCodeAt(debut);
    if (code >= 0xdc00 && code <= 0xdfff) debut--;
  }
  if (fin < longueur) {
    const code = texte.charCodeAt(fin - 1);
    if (code >= 0xd800 && code <= 0xdbff) fin++;
  }
  while (debut < fin && estBlanc(texte, debut)) debut++;
  while (fin > debut && estBlanc(texte, fin - 1)) fin--;

  const avant = debut > 0 ? "… " : "";
  const apres = fin < longueur ? " …" : "";
  const corps = texte.slice(debut, fin).replace(/\s/g, " ");
  const recales: Passage[] = [];
  for (const p of tries) {
    const pd = Math.max(p.debut, debut);
    const pf = Math.min(p.fin, fin);
    if (pf > pd)
      recales.push({ debut: pd - debut + avant.length, fin: pf - debut + avant.length });
  }
  return { texte: avant + corps + apres, passages: recales };
}

/**
 * Le texte à retrouver sur l'écran d'arrivée : celui RÉELLEMENT écrit, tiré du
 * texte d'origine — « Biarritz », jamais la saisie « biaritz », que l'écran
 * ne contient pas.
 *
 * Du premier passage au dernier s'ils tiennent en soixante caractères
 * (« SAINT-VALERY ») ; sinon, du premier aussi loin que les suivants tiennent
 * dans ces soixante caractères (« confiance dans l'économie numérique »,
 * même si « dans » revient plus loin), et au pire le premier seul.
 *
 * On s'arrête aussi dès qu'un mot DÉJÀ couvert revient : « frais de port
 * sont offerts dès » n'apporterait rien de plus que « frais de port », et
 * « 3 AFFICHES ACHETÉES = 1 AFFICHE » rien de plus que « 3 AFFICHES
 * ACHETÉES ». Plus le texte cherché est court, plus il a de chances d'être
 * retrouvé tel quel à l'écran.
 */
export function passageACibler(texte: string, passages: readonly Passage[]): string {
  if (!passages.length) return "";
  const tries = [...passages].sort((a, b) => a.debut - b.debut);
  const premier = tries[0]!;
  const couverts = [aplatir(texte.slice(premier.debut, premier.fin))];
  let fin = premier.fin;
  for (const p of tries.slice(1)) {
    if (p.fin - premier.debut > FENETRE) break;
    const mot = aplatir(texte.slice(p.debut, p.fin));
    if (couverts.some((c) => c.startsWith(mot) || mot.startsWith(c))) break;
    couverts.push(mot);
    fin = Math.max(fin, p.fin);
  }
  return couperTexte(texte.slice(premier.debut, fin).trim(), RECHERCHE_LONGUEUR_MAX).trim();
}

/**
 * Les passages qui disent quelque chose : ceux de trois caractères au moins,
 * s'il y en a. « frais de port » trouve aussi le « de » de chaque phrase ;
 * centrer l'extrait sur lui, le surligner partout, ou l'emmener chercher sur
 * l'écran ne montrerait rien d'utile. Sans rien de plus long, on garde tout.
 */
export function passagesUtiles(passages: readonly Passage[]): Passage[] {
  const longs = passages.filter((p) => p.fin - p.debut >= 3);
  return longs.length ? longs : [...passages];
}

/** Les mots qui ne désignent aucun endroit : les chercher sur un écran surlignerait toute la page. */
const MOTS_VIDES = new Set([
  "a", "au", "aux", "avec", "ce", "ces", "cet", "cette", "dans", "de", "des", "du", "elle", "en",
  "est", "et", "il", "ils", "la", "le", "les", "leur", "leurs", "lui", "ma", "mais", "me", "mes",
  "mon", "ne", "ni", "nos", "notre", "nous", "on", "ou", "par", "pas", "pour", "qu", "que", "qui",
  "sa", "se", "ses", "si", "son", "sont", "sur", "ta", "te", "tes", "ton", "tu", "un", "une", "vos",
  "votre", "vous", "y", "the", "and", "of", "to", "for", "in", "with", "der", "die", "das", "und",
  "el", "los", "las", "di", "del", "della", "e",
]);

/**
 * Le texte à transporter vers l'écran (passageACibler sur les passages
 * utiles), ou "" quand il ne désignerait rien : un mot vide (« du »,
 * « dans ») ou une syllabe. Mieux vaut alors ouvrir l'écran sur son ancre,
 * sans rien chercher, que de surligner les cinquante « de » de la page.
 */
export function texteACibler(texte: string, passages: readonly Passage[]): string {
  const p = passageACibler(texte, passagesUtiles(passages));
  const mots = aplatir(p).split(" ").filter(Boolean);
  return mots.some((m) => !MOTS_VIDES.has(m) && (m.length >= 3 || /\d/.test(m))) ? p : "";
}

/**
 * Le texte en morceaux, surlignés ou non, à afficher SANS aucun HTML : le
 * panneau crée ses <mark> lui-même, la page complète passe par les gabarits
 * d'Astro. Rien venu de la base n'est jamais interprété.
 */
export function decouper(
  texte: string,
  passages: readonly Passage[],
): { texte: string; marque: boolean }[] {
  const morceaux: { texte: string; marque: boolean }[] = [];
  let position = 0;
  const tries = [...passages].sort((a, b) => a.debut - b.debut);
  for (const p of tries) {
    const d = Math.min(Math.max(p.debut, position), texte.length);
    const f = Math.min(Math.max(p.fin, d), texte.length);
    if (f <= d) continue;
    if (d > position) morceaux.push({ texte: texte.slice(position, d), marque: false });
    morceaux.push({ texte: texte.slice(d, f), marque: true });
    position = f;
  }
  if (position < texte.length) morceaux.push({ texte: texte.slice(position), marque: false });
  return morceaux;
}

/* ------------------------------------------------------------------------ */
/* Le lien et le texte qu'il transporte                                     */
/* ------------------------------------------------------------------------ */

export interface CibleRecherche {
  /** Le passage à retrouver, tel qu'il est écrit sur l'écran. */
  trouver?: string;
  /** L'id d'un élément de la page : la recherche s'y limite. */
  ancre?: string;
  /** L'attribut name d'un champ du formulaire. */
  champ?: string;
}

const encoder = (texte: string): string => encodeURIComponent(bienForme(texte));

/**
 * Le lien d'un résultat : chemin[?paramètres de l'écran]#trouver=…&ancre=…&champ=….
 *
 * Le texte cherché voyage dans le FRAGMENT, jamais dans la query : celle-ci
 * part au serveur, et `q` y filtre déjà plusieurs listes (produits, clients,
 * commandes) qui se videraient alors à l'arrivée. Le fragment, lui, n'atteint
 * ni le serveur ni le proxy, et le script d'arrivée l'efface de l'adresse.
 */
export function lienRecherche(
  chemin: string,
  cible?: CibleRecherche,
  parametres?: Record<string, string | number>,
): string {
  let lien = chemin;
  if (parametres) {
    const morceaux = Object.entries(parametres)
      .filter(([, v]) => v !== "" && v !== undefined && v !== null)
      .map(([k, v]) => `${encoder(k)}=${encoder(String(v))}`);
    if (morceaux.length) lien += (lien.includes("?") ? "&" : "?") + morceaux.join("&");
  }
  const fragment: string[] = [];
  const trouver = cible?.trouver
    ? couperTexte(cible.trouver.trim(), RECHERCHE_LONGUEUR_MAX).trim()
    : "";
  if (trouver) fragment.push(`trouver=${encoder(trouver)}`);
  const ancre = cible?.ancre?.trim();
  if (ancre) fragment.push(`ancre=${encoder(ancre)}`);
  const champ = cible?.champ?.trim();
  if (champ) fragment.push(`champ=${encoder(champ)}`);
  if (fragment.length) lien += `#${fragment.join("&")}`;
  return lien;
}

/**
 * Ce que transporte le fragment, ou null quand ce n'est pas un lien de la
 * recherche : un « #bordereau » ordinaire garde alors son comportement natif.
 *
 * Une valeur mal encodée est ignorée plutôt que de faire tomber le reste : le
 * fragment vient de l'adresse, n'importe qui peut y écrire n'importe quoi.
 */
export function lireCible(hash: string): CibleRecherche | null {
  const brut = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!/^(trouver|ancre|champ)=/.test(brut)) return null;
  const cible: CibleRecherche = {};
  for (const morceau of brut.split("&")) {
    const egal = morceau.indexOf("=");
    if (egal < 0) continue;
    const cle = morceau.slice(0, egal);
    if (cle !== "trouver" && cle !== "ancre" && cle !== "champ") continue;
    if (cible[cle] !== undefined) continue;
    let valeur: string;
    try {
      valeur = decodeURIComponent(morceau.slice(egal + 1));
    } catch {
      continue;
    }
    valeur = valeur.trim();
    if (cle === "trouver") valeur = couperTexte(valeur, RECHERCHE_LONGUEUR_MAX).trim();
    if (valeur) cible[cle] = valeur;
  }
  return cible.trouver || cible.ancre || cible.champ ? cible : null;
}

/** « Affiche BIARRITZ › Description (anglais) » : l'infobulle d'un résultat. */
export function emplacementComplet(
  r: Pick<ResultatRecherche, "nature" | "titre" | "ou">,
): string {
  return `${r.nature} ${r.titre}` + (r.ou ? ` › ${r.ou}` : "");
}
