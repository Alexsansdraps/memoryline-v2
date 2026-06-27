import type {
  ProductKind,
  BackgroundDTO,
  CharacterTypeDTO,
  PosterConfig,
} from "@memoryline/types";

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

export interface Stats {
  products: number;
  variants: number;
  collections: number;
  customers: number;
  orders: number;
  orderItems: number;
  ordersByChannel: Record<string, number>;
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
  kind: ProductKind;
  basePriceCents: number;
  images: string[];
  variants: {
    format: string;
    priceCents: number;
    widthMm: number | null;
    heightMm: number | null;
  }[];
}

export const api = {
  stats: () => get<Stats>("/stats"),
  products: (limit = 60) => get<Product[]>(`/products?limit=${limit}`),
  product: (slug: string) => get<ProductDetail>(`/products/${slug}`),
  banner: () => get<Banner | null>("/banner"),
  settings: (group?: string) =>
    get<Record<string, unknown>>(`/settings${group ? `?group=${group}` : ""}`),
};

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

/** Client API navigateur (configurateur, panier, commande). */
export const browserApi = {
  characters: () => browserGet<CharacterTypeDTO[]>("/characters"),
  backgrounds: (productId: number | string) =>
    browserGet<BackgroundDTO[]>(`/backgrounds?productId=${productId}`),

  cart: (cartId: string) => browserGet<Cart>(`/cart/${cartId}`),

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
  ) => browserSend<OrderItem>("POST", `/cart/${cartId}/items`, body),

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

  createOrder: (cartId: string, customer: { name: string; email: string }) =>
    browserSend<{ orderId: number; number: string; status: string }>(
      "POST",
      "/orders",
      { cartId, customer },
    ),
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

/** "2300" centimes -> "23 €" (format FR). */
export function formatPrice(cents: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
