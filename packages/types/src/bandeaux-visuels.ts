/**
 * Les bandeaux visuels — partagés entre la boutique, le back-office et l'API.
 *
 * Une « bannière avec image », comme celle de l'ancienne boutique Shopify :
 * une image bord à bord sous l'en-tête, un texte posé dessus, un bouton ou
 * l'image entière vers un lien, sur les pages choisies, entre deux dates. Le
 * bandeau de Noël s'allume le 1er décembre et s'éteint tout seul le 26.
 *
 * Trois règles vivent ici, et chacune doit se lire pareil partout.
 *
 * 1. UNE SEULE CLÉ, ET UN TABLEAU. Tous les bandeaux tiennent dans le réglage
 *    `bandeaux.visuels` de la table `setting` : ni table ni migration. Un
 *    TABLEAU, surtout pas un objet : `valeurDansLaLangue` (côté API) prend
 *    tout objet non-tableau pour un dictionnaire de langues et le viderait
 *    sans un mot (voir video.ts). Un tableau traverse la route publique
 *    intact, traductions comprises — c'est le site qui choisit la langue.
 *
 * 2. LA FORME NE SE TRADUIT PAS. L'image, le lien, la position, les pages et
 *    les dates valent pour les cinq langues ; seuls le titre, le texte, le
 *    bouton et la description de l'image se traduisent, dans `translations`,
 *    sur le modèle des tables (langue → champ → texte). Le français est la
 *    référence et le repli : un français vide reste vide partout.
 *
 * 3. ON NE LIT QUE CE QU'ON SAIT LIRE. Une valeur inconnue (position, style,
 *    hauteur…) retombe sur sa valeur d'usine plutôt que de casser la page, et
 *    un lien qui n'est ni une adresse du site ni une adresse https n'est pas
 *    rendu : le site et le back-office n'ont pas toujours la même version, et
 *    un « javascript: » n'a rien à faire sous une image cliquable.
 *
 * Fonctions PURES : ni DOM ni fetch. Elles servent au rendu des pages du
 * site, à la route publique des réglages, et au back-office — jusque dans
 * son aperçu, qui calcule les mêmes classes que la boutique.
 */

/** La clé du réglage (table `setting`) : un TABLEAU de bandeaux, dans l'ordre. */
export const REGLAGE_BANDEAUX_VISUELS = "bandeaux.visuels";

/**
 * Deux mises en page.
 *
 * « banniere » est la bannière avec image demandée : bord à bord, le texte
 * posé dessus. « cote-a-cote » est l'ancien encart de l'accueil — l'image à
 * gauche, le texte à droite, dans la largeur de lecture. On la garde parce
 * que c'est la forme qui convient à un vrai paragraphe, et parce que l'encart
 * repris (voir bandeauDepuisEncart) doit s'afficher exactement comme avant.
 */
export const MISES_EN_PAGE_BANDEAU = ["banniere", "cote-a-cote"] as const;
export type MiseEnPageBandeau = (typeof MISES_EN_PAGE_BANDEAU)[number];

/** Où se pose le texte sur l'image : les neuf cases d'une grille 3 × 3. */
export const POSITIONS_TEXTE_BANDEAU = [
  "haut-gauche",
  "haut-centre",
  "haut-droite",
  "milieu-gauche",
  "milieu-centre",
  "milieu-droite",
  "bas-gauche",
  "bas-centre",
  "bas-droite",
] as const;
export type PositionTexteBandeau = (typeof POSITIONS_TEXTE_BANDEAU)[number];

/**
 * Comment le texte reste lisible sur une image qu'on ne connaît pas
 * d'avance : sur une étiquette noire (celle du bandeau de Noël), dans un
 * encadré blanc, ou en blanc ombré — ce dernier assombrit le côté de l'image
 * où il se pose, sans quoi un ciel clair l'effacerait.
 */
export const STYLES_TEXTE_BANDEAU = ["etiquette", "encadre", "ombre"] as const;
export type StyleTexteBandeau = (typeof STYLES_TEXTE_BANDEAU)[number];

/**
 * La hauteur de la bannière. Les trois premières sont fixes (l'image est
 * recadrée autour de son point de cadrage) ; « image » suit les proportions
 * de l'image, qui se montre alors entière. Les valeurs en pixels sont dans
 * bandeaux-visuels.css.
 */
export const HAUTEURS_BANDEAU = ["petite", "moyenne", "grande", "image"] as const;
export type HauteurBandeau = (typeof HAUTEURS_BANDEAU)[number];

/** Les textes qui se traduisent. Tout le reste vaut pour les cinq langues. */
export const CHAMPS_TRADUITS_BANDEAU = ["titre", "texte", "bouton", "alt"] as const;
export type ChampTraduitBandeau = (typeof CHAMPS_TRADUITS_BANDEAU)[number];

/** Langue → champ → texte, comme les colonnes `translations` des tables. */
export type TraductionsBandeau = Partial<
  Record<string, Partial<Record<ChampTraduitBandeau, string>>>
>;

/**
 * Le point de l'image qui reste à l'écran quand elle est recadrée, en
 * pourcentage de sa largeur et de sa hauteur (50/50 : le centre).
 */
export interface CadrageBandeau {
  x: number;
  y: number;
}

export interface BandeauVisuel {
  /** Lettres, chiffres, « - » et « _ » : il sert de nom de case aux traductions. */
  id: string;
  /** Pour s'y retrouver dans la liste du back-office ; jamais affiché sur le site. */
  nom: string;
  /** La case « Afficher ». */
  actif: boolean;
  /** Rangé : hors du site et de la liste ordinaire, restaurable. */
  archive: boolean;
  miseEnPage: MiseEnPageBandeau;
  /** « /assets/… » écrit par l'envoi, ou une adresse https. */
  image: string;
  /** Les dimensions de l'image, relevées à l'envoi : la hauteur se réserve. */
  imageLargeur: number | null;
  imageHauteur: number | null;
  cadrage: CadrageBandeau;
  /** Facultative : sans elle, le téléphone montre l'image ci-dessus, recadrée. */
  imageMobile: string;
  imageMobileLargeur: number | null;
  imageMobileHauteur: number | null;
  cadrageMobile: CadrageBandeau;
  /** Description de l'image, lue par les lecteurs d'écran. */
  alt: string;
  titre: string;
  /** Le texte sous le titre — ou, seul, l'étiquette « POUR NOËL, OFFREZ… ». */
  texte: string;
  /** Le libellé du bouton. Vide : pas de bouton. */
  bouton: string;
  /** « /affiches?collection=noel » ou « https://… ». */
  lien: string;
  /** Toute l'image mène au lien, et pas seulement le bouton. */
  imageCliquable: boolean;
  position: PositionTexteBandeau;
  style: StyleTexteBandeau;
  hauteur: HauteurBandeau;
  /** Les clés des pages où il s'affiche (voir PAGE_ACCUEIL et la suite). */
  pages: string[];
  /** Dates ISO. Nulles : pas de limite de ce côté-là. */
  debut: string | null;
  fin: string | null;
  translations: TraductionsBandeau | null;
}

/* ------------------------------------------------------------------------ */
/* Les pages                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Les pages où un bandeau peut s'afficher, désignées par une clé :
 *
 *   accueil                    la page d'accueil
 *   boutique                   « Toutes les affiches » (/affiches, sans filtre)
 *   genre:personnalisable      les affiches personnalisables
 *   genre:prete_a_imprimer     les affiches prêtes à imprimer
 *   rayons                     TOUS les rayons, y compris ceux créés plus tard
 *   rayon:<adresse>            un rayon (une collection) précis
 *   page:<adresse>             une page libre (/pages/<adresse>)
 *
 * Une clé plutôt qu'un numéro : l'adresse d'un rayon est ce que la page
 * connaît, et c'est elle qu'on lit dans l'URL.
 */
export const PAGE_ACCUEIL = "accueil";
export const PAGE_BOUTIQUE = "boutique";
export const PAGE_TOUS_LES_RAYONS = "rayons";
export const pageGenre = (genre: string) => `genre:${genre}`;
export const pageRayon = (adresse: string) => `rayon:${adresse}`;
export const pageLibre = (adresse: string) => `page:${adresse}`;

/**
 * Les clés de la page « /affiches », selon ce qu'elle montre.
 *
 * Un rayon reste un rayon même dans une gamme (« ?genre=…&collection=… ») :
 * c'est le rayon qu'on a choisi d'habiller. Le filtre par ville, le tri et la
 * page ne changent rien — on regarde le même rayon autrement.
 */
export function clesPageAffiches(genre: string, collection: string): string[] {
  if (collection) return [pageRayon(collection), PAGE_TOUS_LES_RAYONS];
  if (genre) return [pageGenre(genre)];
  return [PAGE_BOUTIQUE];
}

/* ------------------------------------------------------------------------ */
/* Lecture tolérante                                                        */
/* ------------------------------------------------------------------------ */

/** Longueurs maximales : celles des champs du back-office. */
const LONGUEUR = {
  nom: 80,
  titre: 160,
  texte: 400,
  bouton: 60,
  alt: 250,
  lien: 500,
  image: 500,
} as const;

const ID_VALIDE = /^[A-Za-z0-9_-]{1,40}$/;

const chaine = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

const dimension = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 20000 ? n : null;
};

const pourcent = (v: unknown): number => {
  // Number(null) et Number("") valent 0 : sans cette garde, un cadrage
  // absent collerait l'image en haut à gauche au lieu de la centrer.
  if (v === null || v === undefined || v === "") return 50;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 50;
};

function parmi<T extends string>(v: unknown, liste: readonly T[], defaut: T): T {
  return typeof v === "string" && (liste as readonly string[]).includes(v)
    ? (v as T)
    : defaut;
}

const dateIso = (v: unknown): string | null => {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

function cadrage(v: unknown): CadrageBandeau {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return { x: pourcent(o.x), y: pourcent(o.y) };
}

function traductions(v: unknown): TraductionsBandeau | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const sortie: TraductionsBandeau = {};
  for (const [langue, champs] of Object.entries(v as Record<string, unknown>)) {
    if (langue === "fr" || !/^[a-z]{2}$/.test(langue)) continue;
    if (!champs || typeof champs !== "object" || Array.isArray(champs)) continue;
    const entree: Partial<Record<ChampTraduitBandeau, string>> = {};
    for (const champ of CHAMPS_TRADUITS_BANDEAU) {
      const t = chaine((champs as Record<string, unknown>)[champ], LONGUEUR[champ]);
      if (t) entree[champ] = t;
    }
    if (Object.keys(entree).length) sortie[langue] = entree;
  }
  return Object.keys(sortie).length ? sortie : null;
}

/** Un bandeau neuf, aux réglages d'usine : ceux du bandeau de Noël. */
export function nouveauBandeau(id: string): BandeauVisuel {
  return {
    id,
    nom: "",
    actif: true,
    archive: false,
    miseEnPage: "banniere",
    image: "",
    imageLargeur: null,
    imageHauteur: null,
    cadrage: { x: 50, y: 50 },
    imageMobile: "",
    imageMobileLargeur: null,
    imageMobileHauteur: null,
    cadrageMobile: { x: 50, y: 50 },
    alt: "",
    titre: "",
    texte: "",
    bouton: "",
    lien: "",
    imageCliquable: true,
    position: "bas-centre",
    style: "etiquette",
    hauteur: "moyenne",
    pages: [PAGE_ACCUEIL],
    debut: null,
    fin: null,
    translations: null,
  };
}

/**
 * Un bandeau tel qu'on sait le lire, ou null quand il n'a pas d'identifiant
 * utilisable. Sert à la lecture de la base ET au formulaire du back-office :
 * il n'y a qu'une définition de « bandeau valide ».
 */
export function normaliserBandeau(brut: unknown): BandeauVisuel | null {
  if (!brut || typeof brut !== "object" || Array.isArray(brut)) return null;
  const o = brut as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  if (!ID_VALIDE.test(id)) return null;
  const d = nouveauBandeau(id);
  const pages = Array.isArray(o.pages)
    ? [
        ...new Set(
          o.pages
            .filter((p): p is string => typeof p === "string")
            .map((p) => p.trim().slice(0, 140))
            .filter(Boolean),
        ),
      ]
    : d.pages;
  return {
    id,
    nom: chaine(o.nom, LONGUEUR.nom),
    // Seul un « non » explicite éteint : un bandeau écrit par une version
    // qui ne connaissait pas la case reste allumé, comme il l'était.
    actif: o.actif !== false,
    archive: o.archive === true,
    miseEnPage: parmi(o.miseEnPage, MISES_EN_PAGE_BANDEAU, d.miseEnPage),
    image: chaine(o.image, LONGUEUR.image),
    imageLargeur: dimension(o.imageLargeur),
    imageHauteur: dimension(o.imageHauteur),
    cadrage: cadrage(o.cadrage),
    imageMobile: chaine(o.imageMobile, LONGUEUR.image),
    imageMobileLargeur: dimension(o.imageMobileLargeur),
    imageMobileHauteur: dimension(o.imageMobileHauteur),
    cadrageMobile: cadrage(o.cadrageMobile),
    alt: chaine(o.alt, LONGUEUR.alt),
    titre: chaine(o.titre, LONGUEUR.titre),
    texte: chaine(o.texte, LONGUEUR.texte),
    bouton: chaine(o.bouton, LONGUEUR.bouton),
    lien: chaine(o.lien, LONGUEUR.lien),
    imageCliquable: o.imageCliquable !== false,
    position: parmi(o.position, POSITIONS_TEXTE_BANDEAU, d.position),
    style: parmi(o.style, STYLES_TEXTE_BANDEAU, d.style),
    hauteur: parmi(o.hauteur, HAUTEURS_BANDEAU, d.hauteur),
    pages,
    debut: dateIso(o.debut),
    fin: dateIso(o.fin),
    translations: traductions(o.translations),
  };
}

/**
 * La liste enregistrée, ou NULL quand rien n'a jamais été enregistré.
 *
 * La différence compte : une liste vide est un choix (la cliente a tout
 * archivé), son absence veut dire que l'ancien encart d'accueil fait encore
 * foi (voir bandeauDepuisEncart). Un identifiant en double ne garde que sa
 * première occurrence — c'est elle que le back-office modifierait.
 */
export function lireBandeauxVisuels(brut: unknown): BandeauVisuel[] | null {
  if (!Array.isArray(brut)) return null;
  const vus = new Set<string>();
  const liste: BandeauVisuel[] = [];
  for (const entree of brut) {
    const b = normaliserBandeau(entree);
    if (!b || vus.has(b.id)) continue;
    vus.add(b.id);
    liste.push(b);
  }
  return liste;
}

/* ------------------------------------------------------------------------ */
/* Le lien                                                                  */
/* ------------------------------------------------------------------------ */

/**
 * Le lien tel qu'on accepte de le rendre : une adresse du site (« /… ») ou
 * une adresse http(s). Tout le reste rend "" — le bandeau s'affiche alors
 * sans lien plutôt qu'avec un lien dangereux ou cassé.
 */
export function lienBandeau(brut: string): string {
  const l = brut.trim();
  if (!l || /\s/.test(l)) return "";
  if (/^https?:\/\/[^/]/i.test(l)) return l;
  if (l.startsWith("/") && !l.startsWith("//")) return l;
  return "";
}

/**
 * Le lien saisi, remis d'aplomb : « affiches?collection=noel » devient
 * « /affiches?collection=noel », « www.exemple.fr » devient
 * « https://www.exemple.fr ». Ce qui reste illisible est rendu tel quel, pour
 * que le back-office puisse le refuser en le montrant.
 */
export function normaliserLienSaisi(brut: string): string {
  const l = brut.trim();
  if (!l) return "";
  if (/^https?:\/\//i.test(l) || l.startsWith("/")) return l;
  if (/^www\./i.test(l)) return `https://${l}`;
  // Pas de « : » : c'est un chemin du site écrit sans sa barre de tête.
  if (!l.includes(":")) return `/${l}`;
  return l;
}

/* ------------------------------------------------------------------------ */
/* Ce qui s'affiche                                                         */
/* ------------------------------------------------------------------------ */

/** L'état d'un bandeau, tel que le back-office le dit et que le site l'applique. */
export type EtatBandeau =
  | "en-ligne"
  | "programme"
  | "termine"
  | "eteint"
  | "sans-image"
  | "sans-page"
  | "archive";

export function etatBandeau(
  b: BandeauVisuel,
  maintenant: Date = new Date(),
): EtatBandeau {
  if (b.archive) return "archive";
  if (!b.actif) return "eteint";
  if (!b.image) return "sans-image";
  if (!b.pages.length) return "sans-page";
  const t = maintenant.getTime();
  if (b.debut && new Date(b.debut).getTime() > t) return "programme";
  // La fin est exclue : un bandeau qui finit le 26 décembre à 0 h n'est plus
  // là à minuit pile.
  if (b.fin && new Date(b.fin).getTime() <= t) return "termine";
  return "en-ligne";
}

/**
 * Les bandeaux d'une page, dans l'ordre de la liste : ceux qui sont en ligne
 * maintenant ET qui désignent l'une des clés de la page.
 */
export function bandeauxDeLaPage(
  liste: readonly BandeauVisuel[],
  cles: readonly string[],
  maintenant: Date = new Date(),
): BandeauVisuel[] {
  const voulues = new Set(cles);
  return liste.filter(
    (b) =>
      etatBandeau(b, maintenant) === "en-ligne" &&
      b.pages.some((p) => voulues.has(p)),
  );
}

/**
 * Ce que la route PUBLIQUE des réglages sert de la liste : les seuls bandeaux
 * en ligne à cet instant.
 *
 * Un bandeau éteint, archivé ou programmé n'a pas à être lisible par tout le
 * monde avant l'heure — l'offre de Noël préparée en novembre resterait sinon
 * à un clic de n'importe quel curieux. Le site refiltre de toute façon par
 * page et par date : ce tri-ci ne fait qu'en retirer davantage.
 */
export function bandeauxPublics(
  brut: unknown,
  maintenant: Date = new Date(),
): unknown {
  const liste = lireBandeauxVisuels(brut);
  if (liste === null) return brut;
  return liste.filter((b) => etatBandeau(b, maintenant) === "en-ligne");
}

/**
 * Un texte du bandeau dans une langue : sa traduction quand elle existe, le
 * français sinon. Un français VIDE reste vide dans toutes les langues — c'est
 * le français qui décide de ce qui s'affiche, comme partout sur le site
 * (texteDansLaLangue, côté API).
 */
export function texteBandeau(
  b: BandeauVisuel,
  champ: ChampTraduitBandeau,
  langue: string,
): string {
  const francais = b[champ].trim();
  if (!francais || langue === "fr") return francais;
  const traduit = b.translations?.[langue]?.[champ];
  return typeof traduit === "string" && traduit.trim() ? traduit.trim() : francais;
}

/* ------------------------------------------------------------------------ */
/* L'ancien encart de l'accueil                                             */
/* ------------------------------------------------------------------------ */

/** L'identifiant du bandeau qui reprend l'encart. */
export const ID_ENCART_ACCUEIL = "encart-accueil";

/** Les réglages de l'encart d'accueil, tels que « Contenu du site » les écrivait. */
export const CLES_ENCART_ACCUEIL = {
  visible: "home.encart.visible",
  image: "home.encart.image",
  alt: "home.encart.alt",
  titre: "home.encart.title",
  texte: "home.encart.text",
  bouton: "home.encart.cta",
  lien: "home.encart.link",
} as const;

/** Un interrupteur de « Contenu du site » : seul un « non » explicite éteint. */
const interrupteur = (v: string) =>
  !["off", "non", "no", "0", "false"].includes(v.trim().toLowerCase());

/**
 * L'encart d'accueil, devenu le premier bandeau de l'accueil.
 *
 * Tant que la liste des bandeaux n'a jamais été enregistrée, c'est l'encart
 * qui fait foi : le site le montre en mise en page « côte à côte », exactement
 * comme avant, et le back-office le présente en tête de liste. Dès la première
 * modification, il est écrit dans la liste et l'ancien réglage n'est plus lu.
 *
 * Rien n'est perdu : textes, traductions, lien, et même un encart sans image
 * (invisible sur le site, comme avant) dont les textes restent à reprendre.
 * Aucun réglage du tout : null, et le site reste tel qu'il était.
 *
 * `lire(cle, langue)` rend la valeur d'un réglage dans une langue, "" si elle
 * n'y est pas. Le site, qui lit déjà les réglages dans la langue de la page,
 * passe ses valeurs en guise de français et aucune autre langue.
 */
export function bandeauDepuisEncart(
  lire: (cle: string, langue: string) => string,
  autresLangues: readonly string[] = [],
): BandeauVisuel | null {
  const fr = (cle: string) => (lire(cle, "fr") ?? "").trim();
  const image = fr(CLES_ENCART_ACCUEIL.image);
  const lien = fr(CLES_ENCART_ACCUEIL.lien);
  const textes: Record<ChampTraduitBandeau, string> = {
    titre: fr(CLES_ENCART_ACCUEIL.titre),
    texte: fr(CLES_ENCART_ACCUEIL.texte),
    bouton: fr(CLES_ENCART_ACCUEIL.bouton),
    alt: fr(CLES_ENCART_ACCUEIL.alt),
  };
  if (!image && !lien && !Object.values(textes).some(Boolean)) return null;

  const translations: TraductionsBandeau = {};
  for (const langue of autresLangues) {
    if (langue === "fr") continue;
    const entree: Partial<Record<ChampTraduitBandeau, string>> = {};
    for (const champ of CHAMPS_TRADUITS_BANDEAU) {
      const t = (lire(CLES_ENCART_ACCUEIL[champ], langue) ?? "").trim();
      if (t) entree[champ] = t;
    }
    if (Object.keys(entree).length) translations[langue] = entree;
  }

  return normaliserBandeau({
    ...nouveauBandeau(ID_ENCART_ACCUEIL),
    nom: "Encart d'accueil (repris)",
    actif: interrupteur(fr(CLES_ENCART_ACCUEIL.visible)),
    miseEnPage: "cote-a-cote",
    image,
    ...textes,
    lien: normaliserLienSaisi(lien),
    // L'encart ne rendait cliquable que son bouton.
    imageCliquable: false,
    pages: [PAGE_ACCUEIL],
    translations,
  });
}

/* ------------------------------------------------------------------------ */
/* Le rendu de la bannière (site et aperçu du back-office)                   */
/* ------------------------------------------------------------------------ */

/**
 * Les classes de la bannière, lues par bandeaux-visuels.css. Le site et
 * l'aperçu du back-office les calculent ici tous les deux : l'aperçu ne peut
 * pas montrer autre chose que ce que la boutique affichera.
 */
export function classesBanniere(
  b: Pick<BandeauVisuel, "hauteur" | "position" | "style">,
): string {
  const [vertical, horizontal] = b.position.split("-");
  return [
    "ml-bv",
    `ml-bv--${b.hauteur}`,
    `ml-bv--v-${vertical ?? "bas"}`,
    `ml-bv--h-${horizontal ?? "centre"}`,
    `ml-bv--${b.style}`,
  ].join(" ");
}

/**
 * Les variables CSS de la bannière : les proportions de ses images (pour la
 * hauteur « image » et pour réserver la place avant leur arrivée) et leurs
 * points de cadrage. Sans image propre au téléphone, le téléphone recadre
 * l'image de l'ordinateur autour du même point.
 */
export function styleBanniere(
  b: Pick<
    BandeauVisuel,
    | "imageLargeur"
    | "imageHauteur"
    | "cadrage"
    | "imageMobile"
    | "imageMobileLargeur"
    | "imageMobileHauteur"
    | "cadrageMobile"
  >,
): string {
  const ratio = (l: number | null, h: number | null) => (l && h ? `${l} / ${h}` : null);
  const ordinateur = ratio(b.imageLargeur, b.imageHauteur);
  const telephone = b.imageMobile
    ? ratio(b.imageMobileLargeur, b.imageMobileHauteur)
    : ordinateur;
  const point = (c: CadrageBandeau) => `${c.x}% ${c.y}%`;
  const variables = [
    ordinateur && `--ml-bv-ratio:${ordinateur}`,
    telephone && `--ml-bv-ratio-mobile:${telephone}`,
    `--ml-bv-cadrage:${point(b.cadrage)}`,
    `--ml-bv-cadrage-mobile:${point(b.imageMobile ? b.cadrageMobile : b.cadrage)}`,
  ];
  return variables.filter(Boolean).join(";");
}

/**
 * Les largeurs servies pour une bannière bord à bord.
 *
 * Elles vont jusqu'à 2560 : une image pleine largeur sur un écran de 1920 px,
 * ou de 1440 px en haute définition, réclame bien plus que les 1400 px qui
 * suffisent à une fiche. L'API connaît ces largeurs (LARGEURS_SERVIES) ; une
 * image plus petite n'est jamais agrandie.
 */
export const LARGEURS_BANDEAU = [600, 900, 1400, 1920, 2560] as const;
