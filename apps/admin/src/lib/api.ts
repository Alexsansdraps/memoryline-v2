/**
 * Client API du back-office. Lecture ET écriture (le BO modifie la config).
 * SSR -> on parle à l'API via le réseau interne Docker (api:3000) en conteneur,
 * sinon localhost:3000 en dev local.
 */
const API_URL =
  import.meta.env.API_URL_INTERNAL ??
  import.meta.env.PUBLIC_API_URL ??
  "http://localhost:3000";

/**
 * Appel API. `cookie` (optionnel) = en-tête Cookie de la requête entrante du
 * BO, à relayer pour authentifier les routes /admin/* protégées.
 */
async function req<T>(
  method: string,
  path: string,
  body?: unknown,
  cookie?: string,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  if (cookie) headers["cookie"] = cookie;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API ${method} ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export interface PromoRule {
  id: number;
  name: string;
  type: string;
  config: Record<string, unknown>;
  code: string | null;
  active: boolean;
  priority: number;
  startsAt: string | null;
  endsAt: string | null;
}

export interface Banner {
  id: number;
  message: string;
  linkUrl: string | null;
  linkLabel: string | null;
  bgColor: string | null;
  textColor: string | null;
  active: boolean;
}

export interface Stats {
  products: number;
  collections: number;
  customers: number;
  orders: number;
  ordersByChannel: Record<string, number>;
}

/** Catégorie de personnages (table character_category). */
export interface CharacterCategory {
  id: number;
  slug: string;
  name: string;
  position: number;
  /** Nombre de personnages non archivés rattachés (renvoyé par /admin/categories). */
  count?: number;
}

/** Cadre proposé en option lors de la personnalisation. */
export interface Cadre {
  id: number;
  slug: string;
  name: string;
  priceCents: number;
  previewColor: string | null;
  active: boolean;
  position: number;
}

/**
 * Type d'affiche : « de face », « de dos », et ceux créés au back-office.
 * Le `slug` relie personnages, pièces et produits à leur type ; il ne change
 * jamais après la création.
 */
export interface TypeAffiche {
  id: number;
  slug: string;
  name: string;
  foregroundUrl: string | null;
  active: boolean;
  position: number;
  /** Ce qui s'y rattache — un type utilisé ne se supprime pas. */
  usage?: { produits: number; personnages: number; pieces: number };
}

export interface OrderRow {
  id: number;
  number: string;
  channel: string;
  status: string;
  totalCents: number;
}

export interface OrderItem {
  id: number;
  title: string | null;
  quantity: number;
  unitPriceCents: number;
}

export interface OrderDetail {
  order: OrderRow & { createdAt?: string; legacyName?: string | null };
  items: OrderItem[];
}

export interface CharacterType {
  id: number;
  slug: string;
  name: string;
  /** Ancien champ texte, conservé le temps de la bascule — lire categoryId. */
  category: string | null;
  /** Catégorie du personnage (table character_category), null = non rangé. */
  categoryId: number | null;
  position: number;
  archivedAt: string | null;
  baseSvgUrl: string | null;
  baseColorZones: Record<string, string> | null;
  /** Type d'affiche (slug) sous lequel ce personnage est dessiné. */
  orientation?: string;
  /**
   * Calage vertical : position du bas réel du dessin dans le viewBox (0..1).
   * Sert à aligner les pieds de tous les personnages sur le muret.
   */
  bottomPct?: number;
  /**
   * Pièces autorisées par emplacement, en POSITIONS de pièces génériques.
   * Absent = pas encore paramétré, le configurateur propose alors tout.
   */
  slotVariants?: Partial<
    Record<"clothes" | "pants" | "hair" | "accessory", number[]>
  > | null;
  /**
   * Calage des pièces sur ce personnage, par emplacement : décalage en
   * pourcents du cadre et facteur de taille. Absent = pièce posée telle
   * qu'elle a été dessinée.
   */
  slotAdjust?: Partial<
    Record<
      "clothes" | "pants" | "hair" | "accessory",
      { dx: number; dy: number; scale: number }
    >
  > | null;
  /**
   * Tenue portée d'emblée par le client, en positions de pièces :
   * { clothes: 3, hair: 7 }. Utile aux personnages importés nus.
   */
  defaultAssets?: Partial<
    Record<"clothes" | "pants" | "hair" | "accessory", number>
  > | null;
}

export interface Asset {
  id: number;
  characterTypeId: number | null;
  slot: string;
  name: string;
  svgUrl: string | null;
  /** Type d'affiche (slug) sous lequel cette pièce est dessinée. */
  view: string | null;
  colorZones: Record<string, string> | null;
  position: number;
  /** Non null = pièce archivée : masquée du configurateur, jamais supprimée. */
  archivedAt?: string | null;
  /** Catégorie de pièces (« Casquettes »…), qui porte le nuancier. */
  pieceCategoryId?: number | null;
}

/**
 * Catégorie de pièces : un rangement plus fin que l'emplacement, et surtout
 * le nuancier proposé au client pour les pièces qu'elle contient.
 */
export interface CategoriePiece {
  id: number;
  slug: string;
  name: string;
  slot: string;
  colors: string[];
  active: boolean;
  position: number;
  /** Nombre de pièces rangées dedans. */
  pieces?: number;
}

/** Un visuel (arrière-plan) disponible pour un produit. */
export interface ProductBackground {
  id: number;
  url: string;
  name: string | null;
  position: number;
}

/** Configuration du configurateur pour un produit donné. */
export interface ProductConfig {
  id: number;
  slug: string;
  name: string;
  defaultTitle: string | null;
  defaultSubtitle: string | null;
  /** Slug du type d'affiche du produit. */
  defaultView: string | null;
  foregroundUrl: string | null;
  backgrounds: ProductBackground[];
}

/**
 * Crée un client API lié au cookie de session de la requête entrante.
 * À utiliser dans les pages : `const api = adminApi(Astro.request)`.
 */
export function adminApi(request?: Request) {
  const cookie = request?.headers.get("cookie") ?? undefined;
  return {
    stats: () => req<Stats>("GET", "/admin/stats", undefined, cookie),
    promos: () => req<PromoRule[]>("GET", "/admin/promos", undefined, cookie),
    upsertPromo: (data: Partial<PromoRule>) =>
      req<PromoRule>("POST", "/admin/promos", data, cookie),
    banner: () => req<Banner | null>("GET", "/banner", undefined, cookie),
    upsertBanner: (data: Partial<Banner>) =>
      req<Banner>("POST", "/admin/banner", data, cookie),
    settings: () =>
      req<Record<string, unknown>>("GET", "/settings", undefined, cookie),
    setSetting: (key: string, value: unknown) =>
      req<unknown>("POST", "/admin/settings", { key, value }, cookie),
    orders: (channel?: string) =>
      req<OrderRow[]>(
        "GET",
        `/admin/orders${channel ? `?channel=${channel}` : ""}`,
        undefined,
        cookie,
      ),
    orderDetail: (id: number) =>
      req<OrderDetail>("GET", `/admin/orders/${id}`, undefined, cookie),
    frames: () => req<Cadre[]>("GET", "/admin/frames", undefined, cookie),
    upsertFrame: (data: {
      id?: number;
      name: string;
      priceCents: number;
      previewColor?: string;
      active: boolean;
      position: number;
    }) => req<Cadre>("POST", "/admin/frames", data, cookie),
    deleteFrame: (id: number) =>
      req<{ ok: boolean }>("DELETE", `/admin/frames/${id}`, undefined, cookie),

    views: () =>
      req<TypeAffiche[]>("GET", "/admin/views", undefined, cookie),
    upsertView: (data: {
      id?: number;
      name: string;
      foregroundUrl?: string | null;
      active?: boolean;
      position?: number;
    }) => req<TypeAffiche>("POST", "/admin/views", data, cookie),
    deleteView: (id: number) =>
      req<{ ok: boolean }>("DELETE", `/admin/views/${id}`, undefined, cookie),
    pieceCategories: () =>
      req<CategoriePiece[]>("GET", "/admin/piece-categories", undefined, cookie),
    upsertPieceCategory: (data: {
      id?: number;
      name: string;
      slot: string;
      colors: string[];
      active?: boolean;
      position?: number;
    }) => req<CategoriePiece>("POST", "/admin/piece-categories", data, cookie),
    deletePieceCategory: (id: number) =>
      req<{ ok: boolean }>(
        "DELETE",
        `/admin/piece-categories/${id}`,
        undefined,
        cookie,
      ),
    /** Range un lot de pièces dans une catégorie (null = les en sort). */
    setAssetsCategory: (ids: number[], pieceCategoryId: number | null) =>
      req<{ ok: boolean; count: number }>(
        "POST",
        "/admin/assets/category",
        { ids, pieceCategoryId },
        cookie,
      ),
    categories: () =>
      req<CharacterCategory[]>("GET", "/admin/categories", undefined, cookie),
    upsertCategory: (data: { id?: number; name: string; position?: number }) =>
      req<CharacterCategory>("POST", "/admin/categories", data, cookie),
    deleteCategory: (id: number) =>
      req<{ ok: boolean }>("DELETE", `/admin/categories/${id}`, undefined, cookie),
    /** Remplace la composition de la catégorie par la liste cochée. */
    setCategoryCharacters: (id: number, characterIds: number[]) =>
      req<{ category: string; attached: number; detached: number }>(
        "POST",
        `/admin/categories/${id}/characters`,
        { characterIds },
        cookie,
      ),
    characters: () =>
      req<{ types: CharacterType[]; assets: Asset[]; categories: CharacterCategory[] }>(
        "GET",
        "/admin/characters",
        undefined,
        cookie,
      ),
    upsertCharacter: (data: Partial<CharacterType>) =>
      req<CharacterType>("POST", "/admin/characters", data, cookie),
    setCharacterBase: (
      id: number,
      data: {
        baseSvgUrl?: string | null;
        baseColorZones?: Record<string, string> | null;
      },
    ) => req<CharacterType>("POST", `/admin/characters/${id}/base`, data, cookie),
    /** Archive ou restaure une pièce (la suppression définitive n'existe plus). */
    archiveAsset: (id: number, archived: boolean) =>
      req<{ ok: boolean; archived: boolean }>(
        "POST",
        `/admin/assets/${id}/archive`,
        { archived },
        cookie,
      ),
    archiveCharacter: (id: number, archived: boolean) =>
      req<CharacterType>(
        "POST",
        `/admin/characters/${id}/archive`,
        { archived },
        cookie,
      ),
    /** Déplace des personnages vers une catégorie (null = sans catégorie). */
    moveCharacters: (ids: number[], categoryId: number | null) =>
      req<{ ok: boolean; moved: number }>(
        "POST",
        "/admin/characters/category",
        { ids, categoryId },
        cookie,
      ),
    /** Enregistre les pièces autorisées d'un personnage, par emplacement. */
    setSlotVariants: (
      id: number,
      data: Partial<
        Record<"clothes" | "pants" | "hair" | "accessory", number[]>
      >,
    ) =>
      req<{ ok: boolean; slotVariants: Record<string, number[]> }>(
        "POST",
        `/admin/characters/${id}/slot-variants`,
        data,
        cookie,
      ),
    reorderCharacters: (
      items: { id: number; position: number; category?: string | null }[],
    ) =>
      req<{ ok: boolean; count: number }>(
        "POST",
        "/admin/characters/reorder",
        { items },
        cookie,
      ),
    assets: () => req<Asset[]>("GET", "/admin/assets", undefined, cookie),
    upsertAsset: (data: Partial<Asset>) =>
      req<Asset>("POST", "/admin/assets", data, cookie),
    setAssetColors: (id: number, colorZones: Record<string, string>) =>
      req<Asset>("POST", `/admin/assets/${id}/colors`, { colorZones }, cookie),
    productConfig: (id: number | string) =>
      req<ProductConfig>("GET", `/admin/products/${id}/config`, undefined, cookie),
    /** Traductions saisies (sans repli) + le français de référence. */
    productTranslations: (id: number | string) =>
      req<{
        id: number;
        fr: { name: string; description: string | null };
        translations: Record<string, { name?: string; description?: string }>;
      }>("GET", `/admin/products/${id}/translations`, undefined, cookie),
    /** Enregistre UNE langue ; un champ vide retire la traduction. */
    setProductTranslation: (
      id: number | string,
      data: { lang: string; name?: string; description?: string },
    ) =>
      req<{ ok: boolean; translations: Record<string, unknown> }>(
        "POST",
        `/admin/products/${id}/translations`,
        data,
        cookie,
      ),
    setProductConfig: (
      id: number | string,
      data: {
        defaultTitle?: string | null;
        defaultSubtitle?: string | null;
        /** Slug du type d'affiche (« front », « back », ou créé au BO). */
        defaultView?: string | null;
        foregroundUrl?: string | null;
      },
    ) =>
      req<ProductConfig>(
        "POST",
        `/admin/products/${id}/config`,
        data,
        cookie,
      ),
    /** Crée une affiche complète (fiche + formats + visuels + fonds). */
    createProduct: (data: {
      name: string;
      description?: string | null;
      kind?: "personnalisable" | "prete_a_imprimer";
      defaultView?: string | null;
      defaultTitle?: string | null;
      defaultSubtitle?: string | null;
      variants: { format: string; priceCents: number }[];
      images?: string[];
      backgrounds?: string[];
    }) =>
      req<{ id: number; slug: string; name: string }>(
        "POST",
        "/admin/products",
        data,
        cookie,
      ),
    addProductBackground: (
      id: number | string,
      data: { url: string; name?: string },
    ) =>
      req<ProductBackground>(
        "POST",
        `/admin/products/${id}/backgrounds`,
        data,
        cookie,
      ),
    deleteBackground: (bgId: number | string) =>
      req<{ ok: boolean }>(
        "DELETE",
        `/admin/backgrounds/${bgId}`,
        undefined,
        cookie,
      ),
  };
}

export function formatPrice(cents: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
