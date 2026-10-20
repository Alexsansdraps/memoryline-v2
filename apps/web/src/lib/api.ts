import { apiInterne } from "./api-interne.ts";
import type {
  ProductKind,
  BackgroundDTO,
  CatalogueLivraison,
  CharacterTypeDTO,
  PosterConfig,
} from "@memoryline/types";
import {
  REGLAGE_CADRES_SITE,
  REGLAGE_PRIX_CADRES_SITE,
  cadresProposesSurLeSite,
  prixDesCadresAffiches,
  encartVideoAffiche,
  REGLAGE_VIDEO_POSTER,
  REGLAGE_VIDEO_TEXTE,
  REGLAGE_VIDEO_TITRE,
  REGLAGE_VIDEO_URL,
  REGLAGE_VIDEO_VISIBLE,
  REGLAGE_BANDEAUX_VISUELS,
  bandeauDepuisEncart,
  bandeauxDeLaPage,
  lireBandeauxVisuels,
  type BandeauVisuel,
} from "@memoryline/types";
import type {
  CadreDTO,
  CharacterDTO,
  PieceCategoryDTO,
  SlotsDTO,
} from "@memoryline/configurator";

/**
 * URL de base de l'API.
 * - En dev local : http://localhost:3000
 * - Dans Docker (SSR côté serveur) : http://api:3000 (réseau interne).
 * Surchargée par PUBLIC_API_URL / API_URL_INTERNAL si défini.
 */
const API_URL =
  apiInterne();

/*
 * L'adresse de l'API vue du NAVIGATEUR et l'identifiant du panier vivent
 * dans api-navigateur.ts, un module sans aucune dépendance : la pastille du
 * panier, présente sur toutes les pages, les importe de là sans traîner le
 * reste de ce fichier (voir l'en-tête de api-navigateur.ts). Ils sont
 * réexportés ici : les autres îlots les trouvent toujours au même endroit.
 */
import {
  PUBLIC_API_URL,
  getCartId,
  lirePanier,
  oublierCartId,
} from "./api-navigateur.ts";
export {
  PUBLIC_API_URL,
  getCartId,
  nouveauCartId,
  reprendreCartId,
} from "./api-navigateur.ts";

/** Transforme un chemin /assets/... en URL absolue chargeable par le navigateur. */
/**
 * L'adresse d'une image, éventuellement redimensionnée.
 *
 * Sans largeur, l'original : c'est lui qu'on imprime. Avec, l'API calcule
 * une fois la taille demandée et la garde — une vignette de rayon pèse alors
 * neuf kilo-octets au lieu d'un mégaoctet et demi.
 *
 * Les largeurs que l'API sait servir sont 200, 400, 600, 900 et 1400, plus
 * 1920 et 2560 pour les bandeaux visuels, bord à bord. Une autre valeur lui
 * fait rendre l'original : rien ne casse, mais rien n'allège non plus.
 */
export function assetUrl(
  path: string | null | undefined,
  largeur?: number,
): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${PUBLIC_API_URL}${path}${largeur ? `?l=${largeur}` : ""}`;
}

/**
 * Le même visuel en plusieurs largeurs, pour que le navigateur choisisse.
 *
 * Sans cela, un téléphone télécharge l'image calibrée pour un grand écran.
 * Une adresse extérieure n'est pas redimensionnable : on ne propose alors
 * aucun choix plutôt qu'un choix qui n'existe pas.
 *
 * `largeurReelle`, quand on la connaît (l'API la donne pour les visuels des
 * fiches et les images des pages), rend le jeu honnête. L'API n'agrandit
 * jamais : demander « ?l=1400 » d'un visuel de 1020 px rend 1020 px. Annoncé
 * « 1400w », il trompait le navigateur, qui en déduisait une image plus
 * petite que prévu — et sur la fiche, où l'image prend sa largeur naturelle,
 * l'affichait plus petite que sa colonne. On garde donc les largeurs
 * inférieures à la vraie, puis la première qui l'atteint, annoncée à sa
 * vraie valeur (« 1020w ») ; les suivantes rendraient le même fichier.
 */
export function assetSrcset(
  path: string | null | undefined,
  largeurs: readonly number[],
  largeurReelle?: number | null,
): string | undefined {
  if (!path || /^https?:\/\//.test(path)) return undefined;
  if (!largeurReelle || largeurReelle <= 0)
    return largeurs.map((l) => `${assetUrl(path, l)} ${l}w`).join(", ");
  const jeu: string[] = [];
  for (const l of largeurs) {
    if (l < largeurReelle) {
      jeu.push(`${assetUrl(path, l)} ${l}w`);
      continue;
    }
    jeu.push(`${assetUrl(path, l)} ${largeurReelle}w`);
    break;
  }
  return jeu.join(", ");
}

export interface ProductVariant {
  productId: number;
  format: string;
  priceCents: number;
  /**
   * Prix barré réglé au back-office. Absent, nul, ou inférieur au prix
   * courant : il n'y a pas de promotion, et la boutique n'en invente pas.
   */
  compareAtCents?: number | null;
}

export interface Product {
  id: number;
  slug: string;
  name: string;
  kind: ProductKind;
  basePriceCents: number;
  image: string | null;
  variants: ProductVariant[];
}

/** Compteurs publics (catalogue seul) — cf. GET /stats côté API. */
export interface Stats {
  products: number;
  variants: number;
  collections: number;
}

/**
 * Une réponse de l'API qui n'est pas un succès, avec son code.
 *
 * Toutes les erreurs se ressemblaient (« API … -> 404 ») : la fiche ne pouvait
 * pas distinguer une affiche qui n'existe pas d'une API en panne, et répondait
 * aux deux par une redirection vers le catalogue — ce que Google lit comme
 * une page vide (soft 404), et ce qui, pendant une panne, lui montrait toutes
 * les fiches comme disparues. Le code permet de répondre juste : 404 ou 410
 * pour l'absente, 503 pour la panne. Une API injoignable lève l'erreur réseau
 * de fetch, qui n'a pas de code : c'est aussi une panne.
 *
 * Elle reste une `Error` au même message : les appelants qui attrapaient
 * n'importe quelle erreur continuent de le faire sans changement.
 */
export class ErreurApi extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ErreurApi";
  }
}

/** Le code d'une erreur levée par un appel à l'API, ou 0 pour une panne réseau. */
export function codeErreurApi(e: unknown): number {
  return e instanceof ErreurApi ? e.status : 0;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) throw new ErreurApi(`API ${path} -> ${res.status}`, res.status);
  return res.json() as Promise<T>;
}

/**
 * Une page de catalogue : les affiches demandées, ET combien il y en a en tout.
 *
 * Le total voyage dans l'en-tête `X-Total-Count` et non dans le corps, qui
 * reste un tableau nu pour le panier, le plan de site et l'accueil. En-tête
 * illisible — un proxy qui la mange, une API d'une version antérieure — on
 * retombe sur le nombre d'affiches reçues : la grille s'affiche, elle ne
 * propose simplement pas de page suivante.
 */
async function getPagine<T>(path: string): Promise<{ items: T[]; total: number }> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) throw new ErreurApi(`API ${path} -> ${res.status}`, res.status);
  const items = (await res.json()) as T[];
  const annonce = Number(res.headers.get("X-Total-Count"));
  return {
    items,
    total: Number.isFinite(annonce) && annonce >= 0 ? annonce : items.length,
  };
}

export interface Banner {
  id: number;
  message: string;
  linkUrl: string | null;
  linkLabel: string | null;
  bgColor: string | null;
  textColor: string | null;
}

/**
 * Le bandeau d'annonce : ses réglages (couleurs, secondes par message) et les
 * messages en ligne à cet instant, dans l'ordre du défilement, déjà traduits.
 */
export interface Bandeau {
  reglages: { fond: string; texte: string; dureeSecondes: number };
  messages: { id: number; message: string; linkUrl: string | null; linkLabel: string | null }[];
}

export interface ProductDetail {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  /**
   * Ce que la boutique veut voir dans Google. Vides, la page retombe sur le
   * nom du produit et sur les premiers mots de la description.
   */
  seoTitle: string | null;
  seoDescription: string | null;
  kind: ProductKind;
  basePriceCents: number;
  images: string[];
  /**
   * La largeur et la hauteur réelles de chaque visuel, dans l'ordre de
   * `images` ; null pour un visuel que l'API n'a pas pu mesurer. Absent
   * d'une API plus ancienne : la fiche garde alors ses valeurs par défaut.
   */
  dimensionsImages?: ({ largeur: number; hauteur: number } | null)[];
  /**
   * Textes pré-remplis des trois lignes de l'affiche. Les colonnes gardent
   * leurs anciens noms : `defaultTitle` et `defaultSubtitle` sont les lignes 1
   * et 2, remplies pour 161 affiches — les renommer n'aurait rien apporté.
   */
  defaultTitle?: string | null;
  defaultSubtitle?: string | null;
  defaultLine3?: string | null;
  defaultView?: string | null;
  foregroundUrl?: string | null;
  /**
   * Affiche générée par IA à partir d'une photo du client. Ce n'est pas un
   * autre genre de produit : c'est une affiche ordinaire dont la fiche propose
   * un parcours différent (envoi de photo) au lieu du configurateur.
   */
  aiEnabled?: boolean;
  /**
   * Les langues où la fiche est vraiment écrite — le français toujours, une
   * autre quand son nom et sa description y sont traduits. Ailleurs, la fiche
   * s'affiche en français : visitable, mais pas présentée comme traduite.
   * Absent d'une API plus ancienne : toutes les langues, comme avant.
   */
  languesTraduites?: string[];
  variants: {
    format: string;
    priceCents: number;
    /** Prix barré de CE format. Vide : ce format n'est pas en promotion. */
    compareAtCents?: number | null;
    widthMm: number | null;
    heightMm: number | null;
    /** La référence de ce format, quand la boutique en a une (données structurées). */
    sku?: string | null;
  }[];
  /**
   * Le rayon du menu sous lequel la fiche se range (« Villes »), nommé dans
   * la langue de la page ; null quand aucun rayon du menu ne la contient —
   * elle se range alors sous la page de son genre. Absent d'une API plus
   * ancienne : même chose.
   */
  rayonPrincipal?: {
    slug: string;
    name: string;
    genre: ProductKind | null;
  } | null;
  /**
   * Des affiches voisines (huit au plus), à montrer sous la fiche : le même
   * lieu d'abord, puis celles qui l'entourent dans son rayon. Même forme
   * qu'une affiche du catalogue, sans le numéro d'affiche répété dans chaque
   * format.
   */
  voisines?: (Omit<Product, "variants"> & { variants: Omit<ProductVariant, "productId">[] })[];
  /** D'où viennent les voisines : du rayon principal, ou de la page du genre. */
  voisinesDe?: "rayon" | "genre";
}

/**
 * Une entrée du menu du haut, telle que le back-office l'a rangée.
 *
 * Le libellé arrive DÉJÀ traduit : c'est l'API qui applique la langue et le
 * repli sur le français, pour que la boutique n'ait pas à connaître la forme
 * du dictionnaire.
 */
/** Un bloc d'une page écrite au back-office, déjà résolu par l'API. */
export interface BlocPagePublic {
  type: string;
  [cle: string]: unknown;
}

/** Une page libre du site, telle que la boutique l'a composée. */
export interface PageCms {
  id: number;
  slug: string;
  title: string;
  seoTitle: string | null;
  seoDescription: string | null;
  blocks: BlocPagePublic[];
  /** Les langues où la page est vraiment écrite (titre et blocs traduits). */
  languesTraduites?: string[];
}

export interface EntreeMenuPublique {
  id: number;
  label: string;
  href: string;
  enfants: { id: number; label: string; href: string }[];
}

/** Une collection du catalogue, telle que le menu la propose. */
/** Un point relais tel que l'API le renvoie au tunnel de commande. */
export interface PointRelais {
  id: string;
  nom: string;
  adresse: string;
  codePostal: string;
  ville: string;
  /** Le numéro du point chez le transporteur (« 063210 » chez Mondial Relay). */
  code?: string;
  distanceMetres?: number;
  /** Un jour ouvert par ligne : « Lun 09:00 - 19:00 ». */
  horairesSemaine?: string[];
  horaires?: string;
  latitude?: string;
  longitude?: string;
}

/** Une adresse proposée pendant la frappe. */
export interface SuggestionAdresse {
  label: string;
  codePostal: string;
  ville: string;
  latitude: number;
  longitude: number;
}

export interface Collection {
  id: number;
  slug: string;
  /** Dans la langue demandée, le français à défaut. */
  name: string;
  /**
   * Le texte de présentation du rayon (HTML saisi au back-office), dans la
   * langue demandée, le français à défaut ; null quand le français est vide.
   */
  description?: string | null;
  produits: number;
  /**
   * Le genre de toutes ses affiches, ou null quand il en mêle deux. C'est lui
   * que porte la seule adresse du rayon : celle du menu,
   * /affiches?genre=personnalisable&collection=villes.
   */
  genre?: "personnalisable" | "prete_a_imprimer" | null;
  /** Les langues où le rayon est vraiment écrit (nom, et texte s'il en a un). */
  languesTraduites?: string[];
}

/**
 * Ce que le plan du site liste, tel que GET /plan-du-site le rend : fiches en
 * vente, rayons ouverts et non vides, pages publiées — chacun avec les langues
 * où il est vraiment écrit.
 */
export interface PlanDuSite {
  produits: {
    slug: string;
    genre: ProductKind;
    maj: string;
    langues: string[];
    /**
     * Les adresses de ses visuels (« /assets/… »), dans l'ordre. Absent d'une
     * API plus ancienne : les anciennes images de Shopify ne redirigent pas.
     */
    images?: string[];
  }[];
  genres: { personnalisable: number; prete_a_imprimer: number };
  rayons: {
    slug: string;
    genre: "personnalisable" | "prete_a_imprimer" | null;
    produits: number;
    langues: string[];
  }[];
  pages: { slug: string; maj: string; langues: string[] }[];
}

/** Ce qu'on demande au catalogue. Tout est facultatif. */
export interface OptionsCatalogue {
  langue?: string;
  /** « personnalisable » ou « prete_a_imprimer ». */
  genre?: string;
  /** Adresse d'une collection : le rayon respecte alors l'ordre du back-office. */
  collection?: string;
  /** Ce que la visiteuse a tapé. Cherché dans le nom et l'adresse de l'affiche. */
  q?: string;
  /** « manuel », « nouveautes », « prix_asc », « prix_desc » ou « alpha ». */
  tri?: string;
  /** La ville, lue dans le nom de l'affiche (« PARIS », « BAIE DE SOMME »). */
  ville?: string;
  /** Combien d'affiches par page. */
  limite?: number;
  /** Combien d'affiches sauter — c'est la pagination. */
  offset?: number;
}

export const api = {
  stats: () => get<Stats>("/stats"),
  /**
   * `langue` sélectionne les traductions saisies au back-office (repli fr).
   * `genre` et `collection` servent les rayons du menu : affiches à composer
   * ou prêtes à imprimer, et « Villes » ou « Thèmes & paysages ».
   */
  products: (
    limit = 60,
    langue?: string,
    filtres?: { genre?: string; collection?: string },
  ) => {
    const p = new URLSearchParams({ limit: String(limit) });
    if (langue && langue !== "fr") p.set("lang", langue);
    if (filtres?.genre) p.set("genre", filtres.genre);
    if (filtres?.collection) p.set("collection", filtres.collection);
    return get<Product[]>(`/products?${p.toString()}`);
  },
  /**
   * Une PAGE du catalogue : filtrée, cherchée, rangée, et son total.
   *
   * Tout est facultatif et tout passe par l'adresse : c'est ce qui rend un
   * rayon trié partageable et indexable, là où un tri gardé en mémoire du
   * navigateur ne se recopie pas dans un message.
   */
  catalogue: (o: OptionsCatalogue = {}) => {
    const p = new URLSearchParams({ limit: String(o.limite ?? 60) });
    if (o.langue && o.langue !== "fr") p.set("lang", o.langue);
    if (o.genre) p.set("genre", o.genre);
    if (o.collection) p.set("collection", o.collection);
    if (o.q) p.set("q", o.q);
    if (o.tri) p.set("sort", o.tri);
    if (o.ville) p.set("ville", o.ville);
    if (o.offset) p.set("offset", String(o.offset));
    return getPagine<Product>(`/products?${p.toString()}`);
  },
  /**
   * Les rayons du catalogue, nom et description dans la langue de la page
   * (repli français, champ par champ, fait par l'API). Le `slug` ne se
   * traduit pas : c'est l'adresse du rayon dans toutes les langues.
   */
  collections: (langue?: string) =>
    get<Collection[]>(
      `/collections${langue && langue !== "fr" ? `?lang=${langue}` : ""}`,
    ),
  /**
   * Les villes du catalogue, avec le nombre d'affiches de chacune.
   *
   * La ville n'est pas une colonne : elle se lit dans le nom de l'affiche,
   * en capitales et en tête. C'est l'API qui l'extrait, une fois, pour que
   * la liste proposée et le filtre appliqué ne puissent pas se contredire.
   */
  villes: (genre?: string, collection?: string) => {
    const p = new URLSearchParams();
    if (genre) p.set("genre", genre);
    if (collection) p.set("collection", collection);
    const requete = p.toString();
    return get<{ nom: string; nombre: number }[]>(
      `/villes${requete ? `?${requete}` : ""}`,
    );
  },
  /** Une page écrite au back-office. Lève si elle n'existe pas ou est en brouillon. */
  page: (slug: string, langue?: string) =>
    get<PageCms>(
      `/pages/${encodeURIComponent(slug)}${langue && langue !== "fr" ? `?lang=${langue}` : ""}`,
    ),
  /** Le menu du haut, dans la langue du visiteur. */
  menu: (langue?: string) =>
    get<{ entrees: EntreeMenuPublique[] }>(
      `/menu${langue && langue !== "fr" ? `?lang=${langue}` : ""}`,
    ),
  product: (slug: string, langue?: string) =>
    get<ProductDetail>(
      `/products/${slug}${langue && langue !== "fr" ? `?lang=${langue}` : ""}`,
    ),
  /**
   * Le bandeau d'annonce, message et texte du lien dans la langue de la page
   * (repli français). L'adresse du lien ne se traduit pas : le bandeau y
   * ajoute lui-même le préfixe de langue.
   */
  banner: (langue?: string) =>
    get<Banner | null>(
      `/banner${langue && langue !== "fr" ? `?lang=${langue}` : ""}`,
    ),
  /**
   * Tous les messages du bandeau d'annonce qui défilent, dans la langue de la
   * page (repli français, champ par champ), et ses réglages.
   */
  banners: (langue?: string) =>
    get<Bandeau>(`/banners${langue && langue !== "fr" ? `?lang=${langue}` : ""}`),
  /**
   * Les redirections d'anciennes adresses, posées au back-office, et la
   * version de la table qu'elles forment (en-tête X-Redirections-Version,
   * null pour une API d'avant ce repère).
   *
   * Lues par le middleware, qui redirige : c'est le site qui voit passer
   * « /products/… », pas l'API.
   */
  redirects: async () => {
    const res = await fetch(`${API_URL}/redirects`);
    if (!res.ok) throw new ErreurApi(`API /redirects -> ${res.status}`, res.status);
    return {
      lignes: (await res.json()) as { fromPath: string; toPath: string; code: number }[],
      version: res.headers.get("X-Redirections-Version"),
    };
  },
  /** La version seule : le middleware ne relit la table que si elle a changé. */
  versionDesRedirections: () => get<{ version: string }>("/redirects/version"),
  /**
   * Tout ce que le plan du site doit lister, en un seul appel. Ne pas
   * l'appeler directement : passer par `planDuSite()` (lib/plan-du-site.ts),
   * qui le garde quelques minutes.
   */
  planDuSite: () => get<PlanDuSite>("/plan-du-site"),
  settings: (group?: string, langue?: string) =>
    get<Record<string, unknown>>(
      `/settings?${new URLSearchParams({
        ...(group ? { group } : {}),
        ...(langue ? { lang: langue } : {}),
      })}`,
    ),
  /**
   * Le panier que désigne un jeton de relance.
   *
   * Ne lève PAS quand le jeton est refusé : la page de récupération doit
   * répondre une phrase lisible (« ce lien a expiré », « cette commande est
   * déjà réglée ») et non une erreur technique. C'est justement le cas le
   * plus fréquent — un lien de courrier vieux de trois semaines.
   */
  panierARecuperer: async (
    jeton: string,
  ): Promise<PanierRecupere | { erreur: MotifRecuperation }> => {
    try {
      const res = await fetch(
        `${API_URL}/panier/recuperation/${encodeURIComponent(jeton)}`,
      );
      if (res.ok) return (await res.json()) as PanierRecupere;
      const corps = (await res.json().catch(() => ({}))) as { error?: string };
      const connus: MotifRecuperation[] = [
        "jeton_inconnu",
        "deja_payee",
        "panier_clos",
        "trop_ancien",
      ];
      const motif = connus.find((m) => m === corps.error);
      return { erreur: motif ?? "indisponible" };
    } catch {
      // API injoignable : on ne sait pas si le lien est bon, on le dit ainsi.
      return { erreur: "indisponible" };
    }
  },
};

/** Pourquoi un lien de récupération n'ouvre rien. */
export type MotifRecuperation =
  | "jeton_inconnu"
  | "deja_payee"
  | "panier_clos"
  | "trop_ancien"
  | "indisponible";

/** Le panier qu'un lien de relance remet en place. */
export interface PanierRecupere {
  /** L'identifiant de panier à réinstaller dans le navigateur. */
  cartId: string;
  /** Le code de réduction déjà saisi, à reprendre tel quel. */
  promoCode: string | null;
  nom: string | null;
  email: string | null;
  totalCents: number;
  articles: {
    titre: string;
    format: string | null;
    quantite: number;
    unitPriceCents: number;
    imageUrl: string | null;
    indisponible: boolean;
  }[];
}

/**
 * Le tableau des réglages, lu UNE fois par langue et gardé deux secondes.
 *
 * Sans cela, chaque appel à `setting()` relisait toute la table : la page
 * d'accueil en lit douze, soit douze allers-retours pour la même réponse. À
 * 107 ms l'aller-retour, cela faisait 1,3 seconde avant le premier octet, et
 * chaque texte ajouté au back-office en aurait coûté 107 de plus.
 *
 * Deux secondes, et pas davantage : le temps de rendre une page, pas celui
 * de faire attendre une modification. Une valeur changée au back-office se
 * voit au rafraîchissement suivant — c'est ce qu'on attend d'un CMS.
 */
const CACHE_REGLAGES_MS = 2000;
const cacheReglages = new Map<
  string,
  { a: number; valeurs: Promise<Record<string, unknown>> }
>();

function reglagesDeLaLangue(langue: string): Promise<Record<string, unknown>> {
  const maintenant = Date.now();
  const garde = cacheReglages.get(langue);
  if (garde && maintenant - garde.a < CACHE_REGLAGES_MS) return garde.valeurs;
  const valeurs = api.settings(undefined, langue).catch(() => ({}));
  cacheReglages.set(langue, { a: maintenant, valeurs });
  return valeurs;
}

/**
 * Un réglage, dans la langue demandée, avec sa valeur d'usine en repli.
 *
 * Le repli descend d'un cran à la fois : la langue demandée, puis le français
 * (l'API s'en charge), puis le texte passé ici. Une case laissée blanche au
 * back-office ne peut donc jamais produire un titre vide — au pire la
 * visiteuse allemande lit le français, au pire du pire le texte d'usine.
 */
export async function setting(
  key: string,
  fallback: string,
  langue = "fr",
): Promise<string> {
  try {
    const all = await reglagesDeLaLangue(langue);
    const v = all[key];
    // Un réglage chiffré (« affichage.colonnes ») peut revenir en nombre.
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    if (typeof v !== "string") return fallback;
    // Une valeur blanche n'est pas une valeur : elle vaut « rien saisi ».
    return v.trim() ? v : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Le site propose-t-il les cadres ? Réglage de la page Cadres du back-office.
 *
 * Ne dit rien du stand, qui les propose toujours : c'est à la page de
 * combiner les deux. Réglages injoignables : oui, comme avant que le réglage
 * existe — l'API retire de toute façon le cadre d'un panier du site quand la
 * boutique n'en propose pas.
 */
export async function cadresSurLeSite(): Promise<boolean> {
  try {
    const all = await reglagesDeLaLangue("fr");
    return cadresProposesSurLeSite(all[REGLAGE_CADRES_SITE]);
  } catch {
    return true;
  }
}

/**
 * Le site affiche-t-il le supplément de chaque cadre (« + 15 € » sous sa
 * vignette) ? Réglage de la page Cadres du back-office. Il ne touche qu'à ce
 * détail : le prix du cadre reste dans le total. Réglages injoignables : oui,
 * comme avant que le réglage existe.
 */
export async function prixDesCadresSurLeSite(): Promise<boolean> {
  try {
    const all = await reglagesDeLaLangue("fr");
    return prixDesCadresAffiches(all[REGLAGE_PRIX_CADRES_SITE]);
  } catch {
    return true;
  }
}

/** L'encart vidéo du configurateur, tel que la fiche produit le descend. */
export interface EncartVideoDTO {
  /** Adresse brute telle que la marchande l'a saisie. Le tri se fait au rendu. */
  url: string;
  /** Façade téléversée, ou "" : la boutique a sa propre illustration. */
  poster: string;
  /** Titre et texte de la marchande, ou "" : l'île met alors les siens. */
  titre: string;
  texte: string;
}

/**
 * L'encart vidéo du configurateur, dans la langue de la page.
 *
 * `null` quand la marchande l'a éteint : la fiche produit ne descend alors
 * aucune prop, et rien n'est monté du tout.
 *
 * Aucune requête de plus : les réglages sont déjà lus une fois par page
 * (cache de 2 s, CACHE_REGLAGES_MS) — on ne fait que piocher dedans.
 *
 * Réglages injoignables : on rend l'encart avec tout à vide, c'est-à-dire le
 * visuel d'attente. Une panne de l'API ne doit pas faire disparaître la fente.
 */
export async function encartVideoDuSite(
  langue = "fr",
): Promise<EncartVideoDTO | null> {
  const chaine = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  try {
    const all = await reglagesDeLaLangue(langue);
    if (!encartVideoAffiche(all[REGLAGE_VIDEO_VISIBLE])) return null;
    return {
      url: chaine(all[REGLAGE_VIDEO_URL]),
      poster: chaine(all[REGLAGE_VIDEO_POSTER]),
      titre: chaine(all[REGLAGE_VIDEO_TITRE]),
      texte: chaine(all[REGLAGE_VIDEO_TEXTE]),
    };
  } catch {
    return { url: "", poster: "", titre: "", texte: "" };
  }
}

/**
 * Les bandeaux visuels d'une page, en ligne maintenant, dans l'ordre réglé au
 * back-office (« Bandeaux visuels »).
 *
 * `pages` : les clés de la page — « accueil », « rayon:villes »… (voir
 * clesPageAffiches). Les textes restent dans le bandeau avec leurs
 * traductions : c'est au rendu de choisir la langue (texteBandeau).
 *
 * Aucune requête de plus : la liste voyage avec les réglages, déjà lus une
 * fois par page (cache de 2 s). On la prend dans ceux du français, que les
 * grilles d'affiches ont déjà demandés — elle est identique dans toutes les
 * langues.
 *
 * Tant que la liste n'a jamais été enregistrée, l'ancien encart de l'accueil
 * fait foi, lu dans la langue de la page comme il l'était (voir
 * bandeauDepuisEncart) : le site ne change pas tant que la boutique n'a rien
 * réglé. API muette : aucun bandeau — un ornement ne fait pas tomber la page.
 */
export async function bandeauxVisuels(
  pages: readonly string[],
  langue = "fr",
): Promise<BandeauVisuel[]> {
  const chaine = (v: unknown) => (typeof v === "string" ? v : "");
  try {
    const francais = await reglagesDeLaLangue("fr");
    let liste = lireBandeauxVisuels(francais[REGLAGE_BANDEAUX_VISUELS]);
    if (liste === null) {
      const dansLaLangue =
        langue === "fr" ? francais : await reglagesDeLaLangue(langue);
      const encart = bandeauDepuisEncart((cle) => chaine(dansLaLangue[cle]));
      liste = encart ? [encart] : [];
    }
    return bandeauxDeLaPage(liste, pages, new Date());
  } catch {
    return [];
  }
}

/* ---------------------------------------------------------------------------
 * Configurateur / panier / commande — appels effectués DEPUIS LE NAVIGATEUR
 * (islands SolidJS). On parle donc à PUBLIC_API_URL, pas à l'URL interne SSR.
 * ------------------------------------------------------------------------- */

/** Une ligne de panier telle que renvoyée par l'API (/cart, POST/PUT items). */
export interface OrderItem {
  id: number;
  orderId: number;
  productId: number | null;
  variantId: number | null;
  config: PosterConfig;
  title: string | null;
  unitPriceCents: number;
  quantity: number;
  /**
   * La part du prix unitaire due au cadre, en centimes, dite par le SERVEUR.
   * Le moteur de remises en a besoin pour une affiche offerte « cadre non
   * compris ». Absente d'une vieille réponse : 0, le calcul d'avant.
   */
  cadreCents?: number;
  /**
   * Vrai quand l'API a écrit la ligne SANS le cadre demandé : le site ne
   * propose plus les cadres (page ouverte avant que la boutique ne les
   * retire). Seules les réponses d'ajout et de modification le portent.
   */
  cadreRetire?: boolean;
}

export interface Cart {
  cartId: string;
  orderId?: number;
  status?: string;
  items: OrderItem[];
  /**
   * Poids total du colis, en grammes, calculé PAR LE SERVEUR.
   *
   * Le navigateur ne le recalcule pas : il ne connaît ni le poids des
   * variantes ni celui des cadres, et un poids deviné ici finirait par
   * afficher une tranche d'affranchissement que la facture dément.
   * Absent tant que l'API ne le renvoie pas — on lit alors 0, soit le
   * comportement d'avant les tranches de poids.
   */
  poidsGrammes?: number;
  /**
   * Lignes qui portent un cadre que le site ne propose plus — toujours 0 au
   * stand. Le panier et la caisse les retirent alors (retirerCadres) et le
   * disent à la cliente ; la lecture, elle, ne change rien.
   */
  cadresHorsSite?: number;
}

async function browserGet<T>(path: string): Promise<T> {
  const res = await fetch(`${PUBLIC_API_URL}${path}`);
  if (!res.ok) throw new Error(`API ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

async function browserSend<T>(
  method: "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${PUBLIC_API_URL}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = JSON.stringify(await res.json());
    } catch {
      /* ignore */
    }
    throw new Error(`API ${method} ${path} -> ${res.status} ${detail}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Bibliothèque configurateur : personnages + variantes de slots (front/back).
 *
 * Typée avec les DTO du paquet configurateur : le panier réutilise le même
 * aperçu que le configurateur, il lui faut donc exactement la même forme de
 * données — `unknown[]` ne s'y prêtait pas.
 */
export interface CharacterLibrary {
  characters: CharacterDTO[];
  slots: SlotsDTO;
  /** Catégories de pièces et leurs nuanciers, définis au back-office. */
  pieceCategories?: PieceCategoryDTO[];
  /**
   * Les nuanciers des personnages (peau, cheveux / pelage, vêtements,
   * pantalon), réglés au back-office ; absents d'une API plus ancienne, le
   * configurateur reprend leurs couleurs d'origine.
   */
  nuanciersBase?: Partial<Record<"peau" | "cheveux" | "vetements" | "pantalon", string[]>>;
}

/** Client API navigateur (configurateur, panier, commande). */
export const browserApi = {
  /** La bibliothèque de personnages ; les noms de catégories dans la langue du visiteur. */
  characters: (langue?: string) =>
    browserGet<CharacterLibrary>(
      `/characters${langue && langue !== "fr" ? `?lang=${langue}` : ""}`,
    ),
  /** Les cadres proposés ; leur nom (leur couleur) dans la langue du visiteur. */
  frames: (langue?: string) =>
    browserGet<CadreDTO[]>(`/frames${langue && langue !== "fr" ? `?lang=${langue}` : ""}`),
  /**
   * Zones, modes et tarifs de livraison ; le nom, la description et le lieu
   * de retrait des modes dans la langue de la caisse (repli français). La
   * commande, elle, garde le nom français : c'est celui que lit la boutique.
   */
  shipping: (langue?: string) =>
    browserGet<CatalogueLivraison>(
      `/shipping${langue && langue !== "fr" ? `?lang=${langue}` : ""}`,
    ),
  /** Points relais autour d'un code postal. */
  pointsRelais: (
    postalCode: string,
    country: string,
    carrier: string,
    city?: string,
    coordonnees?: { latitude: number; longitude: number },
  ) => {
    const p = new URLSearchParams({ postalCode, country, carrier });
    if (city) p.set("city", city);
    if (coordonnees) {
      p.set("lat", String(coordonnees.latitude));
      p.set("lng", String(coordonnees.longitude));
    }
    return browserGet<PointRelais[]>(`/shipping/relay-points?${p.toString()}`);
  },
  /** Adresses françaises qui commencent comme la saisie (Base Adresse Nationale). */
  suggestionsAdresse: (q: string) =>
    browserGet<SuggestionAdresse[]>(
      `/shipping/adresses?q=${encodeURIComponent(q)}`,
    ),
  /** L'adresse d'une position (« Me localiser ») ; null hors de France. */
  adresseDuLieu: (latitude: number, longitude: number) =>
    browserGet<SuggestionAdresse | null>(
      `/shipping/adresses/position?lat=${latitude}&lng=${longitude}`,
    ),
  /**
   * Vérifie un code promo ; rejette si le code est inconnu ou expiré.
   *
   * Le nom de la règle revient dans la langue de la page (repli français) :
   * c'est lui qui s'écrit sur la ligne de remise. La langue passe dans
   * l'adresse, comme pour les lectures ; le code, lui, ne se traduit jamais.
   */
  verifierCode: (code: string, langue?: string) =>
    browserSend<{
      /**
       * Départage deux règles de même priorité, comme le fait le serveur.
       * Facultatif : une API d'avant ce champ ne le rend pas (repli à 0).
       */
      id?: number;
      code: string;
      name: string;
      type: string;
      config: unknown;
      priority: number;
    }>(
      "POST",
      `/promos/verifier${langue && langue !== "fr" ? `?lang=${langue}` : ""}`,
      { code },
    ),
  /**
   * Les promotions automatiques en cours, leur nom dans la langue de la page
   * (repli français). Typées par l'appelant : le panier et la caisse ne lisent
   * pas les mêmes champs de la règle, et chacun a déjà son type.
   */
  promos: <T>(langue?: string) =>
    browserGet<T[]>(`/promos${langue && langue !== "fr" ? `?lang=${langue}` : ""}`),
  backgrounds: (productId: number | string) =>
    browserGet<BackgroundDTO[]>(`/backgrounds?productId=${productId}`),

  /**
   * Le panier, ou un panier neuf si celui-ci est déjà payé.
   *
   * L'identifiant vit dans le navigateur : quand le paiement se conclut sans
   * repasser par la page (webhook, onglet fermé), il reste pointé sur une
   * commande encaissée. Toute action dessus échouait alors en « commande déjà
   * payée ». On l'oublie ici, une fois pour toutes les pages.
   */
  cart: async (cartId: string): Promise<Cart> =>
    (await lirePanier<Cart>(cartId)) ?? { cartId: getCartId(), items: [], poidsGrammes: 0 },

  /**
   * `langue` : celle de la page. Le panier la garde, pour écrire à la cliente
   * dans sa langue (relance, confirmation) quand son compte n'en a pas choisi.
   */
  addCartItem: (
    cartId: string,
    body: {
      productId: number | string;
      variantId?: number | string;
      unitPriceCents: number;
      quantity?: number;
      title?: string;
      config: PosterConfig;
      langue?: string;
    },
  ) =>
    browserSend<OrderItem>("POST", `/cart/${cartId}/items`, body).catch(
      async (e: unknown) => {
        // Panier clos (déjà payé) : on repart d'un panier neuf et on
        // réessaie une fois, sans rien demander au client.
        if (!String(e).includes("panier_clos")) throw e;
        oublierCartId();
        return browserSend<OrderItem>("POST", `/cart/${getCartId()}/items`, body);
      },
    ),

  updateCartItem: (
    cartId: string,
    itemId: number,
    body: {
      config: PosterConfig;
      variantId?: number | string;
      unitPriceCents?: number;
      quantity?: number;
      /** La langue de la page, comme à l'ajout. */
      langue?: string;
    },
  ) => browserSend<OrderItem>("PUT", `/cart/${cartId}/items/${itemId}`, body),

  deleteCartItem: (cartId: string, itemId: number) =>
    browserSend<{ ok: boolean }>("DELETE", `/cart/${cartId}/items/${itemId}`),

  /**
   * Retire du panier les cadres que le site ne propose plus, prix recalculés
   * par le serveur. Rend le nombre de lignes touchées.
   */
  retirerCadres: (cartId: string) =>
    browserSend<{ retires: number }>("POST", `/cart/${cartId}/retirer-cadres`),

  createOrder: (
    cartId: string,
    customer: { name: string; email: string },
    promoCode?: string,
    shipping?: {
      method: string;
      name?: string;
      line1?: string;
      line2?: string;
      postalCode?: string;
      city?: string;
      country?: string;
      phone?: string;
      relayPointId?: string;
      relayPointLabel?: string;
      /**
       * Pour un retrait sur place : le lieu choisi (catalogue.lieuxRetrait).
       * Le serveur le relit et en garde une copie sur la commande.
       */
      pickupPointId?: number;
    },
    /**
     * La langue de la page de caisse : la commande la garde. Elle ne change
     * PAS celle du compte, qui reste le premier choix pour les e-mails.
     */
    langue?: string,
  ) =>
    browserSend<{
      orderId: number;
      number: string;
      status: string;
      totalCents: number;
      shippingCents: number;
    }>("POST", "/orders", {
      cartId,
      customer,
      promoCode,
      shipping,
      ...(langue ? { langue } : {}),
    }),

  /* --- Paiement (Stripe & PayPal) --------------------------------------- */

  /** Moyens de paiement actifs + clés publiques (source de vérité = API). */
  paymentsConfig: () =>
    browserGet<{
      stripe: { publicKey: string } | null;
      paypal: { clientId: string } | null;
      /** Vrai quand la boutique encaisse en mode ESSAI : rien n'est débité. */
      essai?: boolean;
    }>("/payments/config"),

  /** Crée un PaymentIntent Stripe pour la commande, renvoie le clientSecret. */
  stripeIntent: (orderId: number) =>
    browserSend<{ clientSecret: string }>("POST", "/payments/stripe/intent", {
      orderId,
    }),

  /** Confirme côté serveur le paiement Stripe (marque payé si succeeded). */
  stripeConfirm: (orderId: number) =>
    browserSend<{ status: string }>("POST", "/payments/stripe/confirm", {
      orderId,
    }),

  /** Crée une commande PayPal (montant serveur), renvoie l'id PayPal. */
  paypalOrder: (orderId: number) =>
    browserSend<{ paypalOrderId: string }>("POST", "/payments/paypal/order", {
      orderId,
    }),

  /** Capture une commande PayPal approuvée (marque payé si COMPLETED). */
  paypalCapture: (orderId: number, paypalOrderId: string) =>
    browserSend<{ status: string }>("POST", "/payments/paypal/capture", {
      orderId,
      paypalOrderId,
    }),
};

/*
 * L'identifiant du panier (getCartId, nouveauCartId, reprendreCartId) est
 * dans api-navigateur.ts, réexporté en tête de ce fichier.
 */

/* ---------------------------------------------------------------------------
 * Stand de salon.
 *
 * Le code du stand voyage dans un EN-TÊTE, jamais dans l'adresse : l'URL
 * s'affiche en clair devant le client, et se retrouve dans l'historique du
 * navigateur comme dans les journaux du proxy.
 * ------------------------------------------------------------------------- */

export interface EtatSalon {
  ouvert: boolean;
  evenement: string | null;
  /** Le code présenté ouvre-t-il le stand ? Le code n'est jamais renvoyé. */
  autorise: boolean;
}

/**
 * Accusé de commande stand — aucun montant, volontairement (cf. salon.ts).
 *
 * Calqué sur ce que l'API renvoie vraiment : le type annonçait un tableau
 * d'articles et un client en anglais, l'API répond un NOMBRE d'exemplaires et
 * un client en français. Personne ne le lisait, donc personne ne l'avait vu.
 */
export interface CommandeSalon {
  number: string;
  client: { nom: string; email: string };
  /** Nombre d'exemplaires enregistrés, toutes lignes confondues. */
  articles: number;
}

/**
 * Échec d'un appel au stand. Le CODE HTTP est le seul moyen de distinguer un
 * stand fermé ou un code refusé (403) d'une saisie incomplète (400) : les
 * deux se répondent très différemment à l'écran.
 */
export class ErreurSalon extends Error {
  constructor(
    readonly statut: number,
    message: string,
  ) {
    super(message);
    this.name = "ErreurSalon";
  }
}

async function salonFetch<T>(
  chemin: string,
  code: string | null,
  corps?: unknown,
): Promise<T> {
  const res = await fetch(`${PUBLIC_API_URL}${chemin}`, {
    method: corps ? "POST" : "GET",
    headers: {
      ...(corps ? { "Content-Type": "application/json" } : {}),
      ...(code ? { "X-Salon-Code": code } : {}),
    },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  if (!res.ok) {
    let detail = "";
    try {
      const json = (await res.json()) as { error?: unknown; message?: unknown };
      detail = String(json.error ?? json.message ?? "");
    } catch {
      /* corps illisible : le code HTTP suffit à choisir l'écran */
    }
    throw new ErreurSalon(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export const salonApi = {
  etat: (code: string | null) => salonFetch<EtatSalon>("/salon/etat", code),
  commander: (
    code: string | null,
    corps: { cartId: string; name: string; email: string },
  ) => salonFetch<CommandeSalon>("/salon/commandes", code, corps),
  /** Rouvre une vente tout juste validée : elle redevient le panier de la tablette. */
  rouvrir: (code: string | null, corps: { cartId: string; numero: string }) =>
    salonFetch<{ ok: true }>("/salon/commandes/rouvrir", code, corps),
};

/**
 * "2300" centimes -> "23 €".
 *
 * `locale` est le code complet de la langue de la page (LOCALE_COMPLETE) :
 * « 23,50 € » en français, « €23.50 » en anglais. Sans lui, le format
 * français.
 */
export function formatPrice(cents: number, locale = "fr-FR"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/* ---------------------------------------------------------------------------
 * Prix barré
 * ------------------------------------------------------------------------- */

/** Ce qu'une promotion affiche : l'ancien prix, et de combien on descend. */
export interface Promotion {
  /** Le prix barré, en centimes. */
  avantCents: number;
  /** La remise en pourcentage, arrondie : « -21 % ». */
  pourcent: number;
}

/**
 * La promotion d'une variante, s'il y en a vraiment une.
 *
 * Trois cas rendent `null`, et c'est volontaire : pas de prix barré du tout,
 * un prix barré à zéro, et un prix barré INFÉRIEUR OU ÉGAL au prix courant.
 * Ce dernier est le piège : une saisie ancienne qu'un baissement de prix a
 * rattrapée afficherait « 23 € au lieu de 19 € », c'est-à-dire une promotion
 * à l'envers. Un arrondi qui tombe à zéro pour cent est écarté de même : une
 * étiquette « -0 % » ne dit rien à personne.
 */
export function promotion(
  prixCents: number,
  compareAtCents?: number | null,
): Promotion | null {
  if (!compareAtCents || compareAtCents <= prixCents) return null;
  const pourcent = Math.round(
    ((compareAtCents - prixCents) / compareAtCents) * 100,
  );
  return pourcent >= 1 ? { avantCents: compareAtCents, pourcent } : null;
}

/**
 * La variante la MOINS CHÈRE d'une affiche, celle dont la vignette montre le
 * prix. C'est donc la sienne, et aucune autre, qu'il faut barrer.
 */
export function varianteLaMoinsChere<T extends { priceCents: number }>(
  variantes: T[],
): T | null {
  const tarifees = variantes.filter((v) => v.priceCents > 0);
  if (!tarifees.length) return null;
  return tarifees.reduce((a, b) => (b.priceCents < a.priceCents ? b : a));
}
