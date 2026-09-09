import type {
  ProductKind,
  BackgroundDTO,
  CatalogueLivraison,
  CharacterTypeDTO,
  PosterConfig,
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
  import.meta.env.API_URL_INTERNAL ??
  import.meta.env.PUBLIC_API_URL ??
  "http://localhost:3000";

/**
 * URL de l'API joignable depuis le NAVIGATEUR (pour les <img>, etc.).
 * Côté serveur SSR on parle à http://api:3000 (réseau Docker), mais le
 * navigateur du visiteur doit utiliser une URL publique (localhost:3000 en
 * dev). PUBLIC_API_URL la surcharge en prod (ex. https://api.memoryline.fr).
 */
export const PUBLIC_API_URL =
  import.meta.env.PUBLIC_API_URL ?? "http://localhost:3000";

/** Transforme un chemin /assets/... en URL absolue chargeable par le navigateur. */
export function assetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${PUBLIC_API_URL}${path}`;
}

export interface ProductVariant {
  productId: number;
  format: string;
  priceCents: number;
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

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) throw new Error(`API ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export interface Banner {
  id: number;
  message: string;
  linkUrl: string | null;
  linkLabel: string | null;
  bgColor: string | null;
  textColor: string | null;
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
  variants: {
    format: string;
    priceCents: number;
    widthMm: number | null;
    heightMm: number | null;
  }[];
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
}

export interface EntreeMenuPublique {
  id: number;
  label: string;
  href: string;
  enfants: { id: number; label: string; href: string }[];
}

/** Une collection du catalogue, telle que le menu la propose. */
export interface Collection {
  id: number;
  slug: string;
  name: string;
  produits: number;
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
  collections: () => get<Collection[]>("/collections"),
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
  banner: () => get<Banner | null>("/banner"),
  settings: (group?: string) =>
    get<Record<string, unknown>>(`/settings${group ? `?group=${group}` : ""}`),
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

/** Récupère un réglage texte avec valeur de repli. */
export async function setting(key: string, fallback: string): Promise<string> {
  try {
    const all = await api.settings();
    const v = all[key];
    return typeof v === "string" ? v : fallback;
  } catch {
    return fallback;
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
}

/** Client API navigateur (configurateur, panier, commande). */
export const browserApi = {
  /**
   * Catalogue lu DEPUIS LE NAVIGATEUR — c'est ce dont le stand a besoin.
   *
   * Rendu côté serveur, le catalogue arriverait par les propriétés de l'îlot,
   * donc dans le HTML servi, prix compris : le stand n'affiche aucun montant,
   * il ne doit pas non plus en transporter dans sa page.
   */
  produits: (limite = 500) => browserGet<Product[]>(`/products?limit=${limite}`),
  produit: (slug: string) => browserGet<ProductDetail>(`/products/${slug}`),
  characters: () => browserGet<CharacterLibrary>("/characters"),
  frames: () => browserGet<CadreDTO[]>("/frames"),
  /** Zones, modes et tarifs de livraison. */
  shipping: () => browserGet<CatalogueLivraison>("/shipping"),
  /** Points relais autour d'un code postal. */
  pointsRelais: (postalCode: string, country: string, carrier: string) =>
    browserGet<
      {
        id: string;
        nom: string;
        adresse: string;
        codePostal: string;
        ville: string;
        horaires?: string;
      }[]
    >(
      `/shipping/relay-points?postalCode=${encodeURIComponent(postalCode)}&country=${encodeURIComponent(country)}&carrier=${encodeURIComponent(carrier)}`,
    ),
  /** Vérifie un code promo ; rejette si le code est inconnu ou expiré. */
  verifierCode: (code: string) =>
    browserSend<{
      code: string;
      name: string;
      type: string;
      config: unknown;
      priority: number;
    }>("POST", "/promos/verifier", { code }),
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
  cart: async (cartId: string): Promise<Cart> => {
    const panier = await browserGet<Cart>(`/cart/${cartId}`);
    if (panier.status !== "paid") return panier;
    localStorage.removeItem(CART_ID_KEY);
    return { cartId: getCartId(), items: [], poidsGrammes: 0 };
  },

  addCartItem: (
    cartId: string,
    body: {
      productId: number | string;
      variantId?: number | string;
      unitPriceCents: number;
      quantity?: number;
      title?: string;
      config: PosterConfig;
    },
  ) =>
    browserSend<OrderItem>("POST", `/cart/${cartId}/items`, body).catch(
      async (e: unknown) => {
        // Panier clos (déjà payé) : on repart d'un panier neuf et on
        // réessaie une fois, sans rien demander au client.
        if (!String(e).includes("panier_clos")) throw e;
        localStorage.removeItem(CART_ID_KEY);
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
    },
  ) => browserSend<OrderItem>("PUT", `/cart/${cartId}/items/${itemId}`, body),

  deleteCartItem: (cartId: string, itemId: number) =>
    browserSend<{ ok: boolean }>("DELETE", `/cart/${cartId}/items/${itemId}`),

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
    },
  ) =>
    browserSend<{
      orderId: number;
      number: string;
      status: string;
      totalCents: number;
      shippingCents: number;
    }>("POST", "/orders", { cartId, customer, promoCode, shipping }),

  /* --- Paiement (Stripe & PayPal) --------------------------------------- */

  /** Moyens de paiement actifs + clés publiques (source de vérité = API). */
  paymentsConfig: () =>
    browserGet<{
      stripe: { publicKey: string } | null;
      paypal: { clientId: string } | null;
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

/** Clé localStorage du panier (UUID par navigateur). */
const CART_ID_KEY = "ml_cart_id";

/** Lit (ou crée) l'identifiant de panier persistant du navigateur. */
export function getCartId(): string {
  let id = localStorage.getItem(CART_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(CART_ID_KEY, id);
  }
  return id;
}

/**
 * Repart d'un panier VIDE, sans toucher au panier précédent.
 *
 * Au stand, chaque client a sa commande : la vendeuse enchaîne, et le panier
 * du client servi ne doit rien laisser au suivant.
 */
export function nouveauCartId(): string {
  const id = crypto.randomUUID();
  localStorage.setItem(CART_ID_KEY, id);
  return id;
}

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

/** Accusé de commande stand — aucun montant, volontairement (cf. /salon). */
export interface CommandeSalon {
  number: string;
  client: { name: string; email: string };
  articles: { title?: string | null; quantity?: number }[];
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
};

/** "2300" centimes -> "23 €" (format FR). */
export function formatPrice(cents: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
