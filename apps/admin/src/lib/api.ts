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
  if (!res.ok) {
    // L'API refuse parfois pour une raison qui se lit (« 3 produits sont
    // rangés dans cette catégorie ») : la garder vaut mieux que d'afficher un
    // code que la cliente devrait interpréter.
    const brut = await res.text().catch(() => "");
    let raison = "";
    try {
      raison = String((JSON.parse(brut) as { error?: unknown }).error ?? "");
    } catch {
      /* réponse non JSON (404 du proxy, page d'erreur) : on garde le code */
    }
    throw new Error(
      raison || `API ${method} ${path} -> ${res.status}`,
    );
  }
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
  /** Poids du cadre, ajouté à celui de l'affiche quand il est vendu avec. */
  weightGrams: number;
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

/** Compte d'accès au back-office. */
export interface CompteAdmin {
  id: number;
  email: string;
  /** « owner » (tous droits) ou « seller » (lecture seule). */
  role: string;
  createdAt: string;
  /** Une session ouverte en ce moment. */
  connecte: boolean;
  /** C'est le compte avec lequel on est connecté. */
  moi: boolean;
}

/** Adresse laissée dans le formulaire de la lettre d'information. */
export interface Inscrit {
  id: number;
  email: string;
  langue: string | null;
  createdAt: string;
}

/**
 * Catégorie de produits (« Affiches », « Magnets »…). Elle porte le poids par
 * défaut de ce qu'elle contient : c'est là que la cliente le saisit une fois
 * pour toutes, les produits n'ayant à le reprendre qu'en cas d'exception.
 */
export interface CategorieProduit {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  defaultWeightGrams: number;
  active: boolean;
  position: number;
  /** Nombre de produits rangés dedans (renvoyé par /admin/product-categories). */
  produits?: number;
}

/**
 * Un produit vu du back-office.
 *
 * Le site n'a pas besoin du statut ni du poids ; la boutiquière, si. C'est la
 * même table, ce n'est pas la même lecture.
 */
export interface ProduitAdmin {
  id: number;
  name: string;
  slug: string;
  kind: string;
  /** active | draft | archived. Affiché « Actif », « Désactivé », « Archivé ». */
  status: string;
  /**
   * Prix de repli, utilisé seulement par un produit sans aucun format. Ce
   * n'est PAS le prix payé : celui-là est sur la variante.
   */
  basePriceCents: number;
  /** Fourchette des prix des formats. Null quand le produit n'en a aucun. */
  prixMin: number | null;
  prixMax: number | null;
  /** Les formats existants pour ce produit, par exemple ["A4", "A3"]. */
  formats: string[];
  categoryId: number | null;
  categoryName: string | null;
  /** Null = le produit prend le poids par défaut de sa catégorie. */
  weightGrams: number | null;
  /** Ce qui sera réellement pesé, cadre non compris. */
  poidsEffectif: number;
  aiEnabled: boolean;
  imageUrl: string | null;
  variantes: number;
  collections: { id: number; name: string }[];
}

/** La liste des produits, et de quoi remplir les filtres et les onglets. */
export interface ListeProduitsAdmin {
  produits: ProduitAdmin[];
  categories: { id: number; name: string }[];
  collections: { id: number; name: string }[];
  /** Tous les formats du catalogue, pour ne viser qu'un format à la fois. */
  formats: string[];
  /** Nombres par statut, tous filtres appliqués sauf celui du statut. */
  compte: { tous: number; active: number; draft: number; archived: number };
}

/** Un format d'une affiche : c'est lui qui porte le prix réellement payé. */
export interface VarianteFiche {
  id: number;
  format: string;
  priceCents: number;
  /** Prix barré affiché à côté du prix, quand il y en a un. */
  compareAtCents: number | null;
  /** Ce que le format coûte à produire, pour le calcul de la marge. */
  costCents: number | null;
  sku: string | null;
  barcode: string | null;
  /** Null = ce format prend le poids du produit. */
  weightGrams: number | null;
  poidsEffectif: number;
  /** Null = stock non suivi, ce qui est le cas des affiches. */
  stockQty: number | null;
  stockPolicy: string;
  widthMm: number | null;
  heightMm: number | null;
}

/** Tout ce que la fiche produit du back-office affiche et enregistre. */
export interface FicheProduit {
  produit: {
    id: number;
    name: string;
    slug: string;
    description: string | null;
    status: string;
    kind: string;
    vendor: string | null;
    productType: string | null;
    tags: string[];
    seoTitle: string | null;
    seoDescription: string | null;
    categoryId: number | null;
    weightGrams: number | null;
    poidsEffectif: number;
    aiEnabled: boolean;
    basePriceCents: number;
    createdAt: string;
    updatedAt: string;
  };
  categories: { id: number; name: string; defaultWeightGrams: number }[];
  collections: { id: number; name: string }[];
  collectionsDuProduit: number[];
  images: { id: number; url: string; alt: string | null; position: number }[];
  variantes: VarianteFiche[];
  /** Les étiquettes déjà posées ailleurs, proposées en suggestion. */
  etiquettesConnues: string[];
}

/** Ce qu'une affiche a rapporté sur une période, remboursements déduits. */
export interface VentesProduit {
  produit: string | null;
  jours: number;
  debut: string;
  fin: string;
  unites: number;
  acheteurs: number;
  commandes: number;
  ventesNettesCents: number;
  serie: { jour: string; cents: number }[];
  parCanal: { canal: string; unites: number; cents: number }[];
  clients: { nouveaux: number; recurrents: number };
}

/** Tout ce qu'il faut pour régler le poids d'un produit et de ses formats. */
export interface LogistiqueProduit {
  produit: {
    id: number;
    name: string;
    categoryId: number | null;
    /** Null = le produit prend le poids par défaut de sa catégorie. */
    weightGrams: number | null;
  };
  categorie: CategorieProduit | null;
  categories: CategorieProduit[];
  variantes: {
    id: number;
    format: string;
    sku: string | null;
    /** Null = la variante prend le poids du produit. */
    weightGrams: number | null;
    /** Ce qui sera réellement pesé, cadre non compris. */
    poidsEffectif: number;
  }[];
}

/** Une borne de poids habituelle d'un transporteur — sans prix. */
export interface TrancheStandard {
  minWeightGrams: number;
  /** Null = pas de limite haute. */
  maxWeightGrams: number | null;
  label: string;
}

/** Bornes habituelles des deux transporteurs, pour pré-remplir une grille. */
export interface TranchesStandard {
  colissimo: TrancheStandard[];
  mondial_relay: TrancheStandard[];
}

/** Une ligne de grille tarifaire : un prix pour une tranche de poids. */
export interface TarifLivraisonBO {
  id: number;
  methodId: number;
  zoneId: number;
  priceCents: number;
  freeFromCents: number | null;
  minWeightGrams: number;
  /** Null = pas de limite haute. */
  maxWeightGrams: number | null;
  active: boolean;
}

/** Catalogue de livraison tel que le back-office le manipule. */
export interface CatalogueLivraisonBO {
  zones: {
    id: number;
    slug: string;
    name: string;
    countries: string[] | null;
    position: number;
  }[];
  modes: {
    id: number;
    slug: string;
    name: string;
    description: string | null;
    kind: string;
    carrier: string | null;
    pickupLocation: string | null;
    active: boolean;
    position: number;
  }[];
  tarifs: TarifLivraisonBO[];
}

/** Chiffres d'une période de commandes, et de la précédente pour comparer. */
export interface StatsCommandes {
  jours: number;
  periode: {
    commandes: number;
    articles: number;
    caCents: number;
    portCents: number;
    /** Commandes payées de la période qui restent à préparer. */
    aTraiter: number;
  };
  precedent: {
    commandes: number;
    articles: number;
    caCents: number;
    portCents: number;
  };
  /** Nombre de commandes par jour, du plus ancien au plus récent. */
  serie: number[];
}

/** Statuts calculés côté API (voir apps/api/src/commandes.ts). */
export type StatutFinancier =
  | "draft"
  | "pending"
  | "authorized"
  | "paid"
  | "partially_refunded"
  | "refunded"
  | "voided";
export type StatutExpedition =
  | "unfulfilled"
  | "partially_fulfilled"
  | "fulfilled";

export interface OrderRow {
  id: number;
  number: string;
  channel: string;
  status: string;
  totalCents: number;
  createdAt?: string;
  /** Nom du client, absent pour une commande prise au salon. */
  customerName?: string | null;
  customerEmail?: string | null;
  customerId?: number | null;
  /** Non null = commande préparée et partie. */
  fulfilledAt?: string | null;
  /** Nombre d'articles, quantités comprises. */
  articles?: number;
  /** Quantités déjà parties. */
  expedies?: number;
  rembourseCents?: number;
  statutFinancier?: StatutFinancier;
  statutExpedition?: StatutExpedition;
  tags?: string[] | null;
  shippingLabel?: string | null;
  legacyName?: string | null;
}

/** Filtres de la liste des commandes — tous combinables. */
export interface FiltresCommandes {
  channel?: string;
  q?: string;
  financial?: string;
  fulfillment?: string;
  tag?: string;
  from?: string;
  to?: string;
  limit?: number;
}

/** Une expédition et ce qu'elle contenait. */
export interface Expedition {
  id: number;
  orderId: number;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: string;
  createdAt: string;
  cancelledAt: string | null;
  lignes: { id: number; orderItemId: number; quantity: number }[];
}

/** Un remboursement et son détail. */
export interface Remboursement {
  id: number;
  orderId: number;
  amountCents: number;
  shippingCents: number;
  reason: string | null;
  note: string | null;
  restock: boolean;
  gateway: string | null;
  externalRef: string | null;
  createdAt: string;
  lignes: {
    id: number;
    orderItemId: number;
    quantity: number;
    amountCents: number;
  }[];
}

/** Une écriture du grand livre. */
export interface Mouvement {
  id: number;
  kind: string;
  status: string;
  amountCents: number;
  gateway: string | null;
  externalRef: string | null;
  message: string | null;
  createdAt: string;
}

/** Un panier laissé en plan, tel que le back-office le présente. */
export interface PanierAbandonne {
  id: number;
  number: string;
  totalCents: number;
  createdAt: string;
  clientOrderId: string | null;
  relanceAt: string | null;
  nom: string | null;
  email: string | null;
  articles: number;
}

export interface OrderItem {
  id: number;
  title: string | null;
  quantity: number;
  unitPriceCents: number;
}

export interface OrderDetail {
  order: OrderRow & {
    createdAt?: string;
    legacyName?: string | null;
    promoCode?: string | null;
    shippingCents?: number;
    shippingName?: string | null;
    shippingLine1?: string | null;
    shippingLine2?: string | null;
    shippingPostalCode?: string | null;
    shippingCity?: string | null;
    shippingCountry?: string | null;
    shippingPhone?: string | null;
    relayPointId?: string | null;
    relayPointLabel?: string | null;
    internalNote?: string | null;
    tags?: string[] | null;
    shippingMethod?: string | null;
  };
  items: (OrderItem & {
    format?: string | null;
    cadre?: string | null;
    /** Les lignes du texte de l'affiche, dans l'ordre où elles s'impriment. */
    lignesAffiche?: (string | null)[] | null;
    /** Forme d'avant les trois lignes — les commandes déjà passées la portent. */
    titreAffiche?: string | null;
    sousTitreAffiche?: string | null;
    personnages?: number;
    /** Quantités déjà parties / déjà rendues, et ce qu'il reste à faire. */
    expedie?: number;
    rembourse?: number;
    aExpedier?: number;
    aRembourser?: number;
  })[];
  expeditions?: Expedition[];
  remboursements?: Remboursement[];
  mouvements?: Mouvement[];
  statutFinancier?: StatutFinancier;
  statutExpedition?: StatutExpedition;
  rembourseCents?: number;
  /** Ce qui reste remboursable sur les frais de port. */
  portRemboursableCents?: number;
  customer?: { id: number; name: string; email: string } | null;
  paiements?: {
    provider: string;
    status: string | null;
    externalRef: string | null;
    amountCents: number;
  }[];
  /** Journal de la commande, du plus récent au plus ancien. */
  journal?: {
    id: number;
    kind: string;
    message: string;
    author: string | null;
    createdAt: string;
  }[];
  commandesDuClient?: number;
}

/**
 * Client de la boutique, tel que la liste du CRM le présente : sa fiche et ce
 * qu'il a acheté. `compte` distingue le client inscrit (il a un mot de passe,
 * il retrouve ses commandes) du simple visiteur créé par une commande.
 */
export interface Client {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string;
  acceptsMarketing: boolean;
  tags: string[] | null;
  compte: boolean;
  commandes: number;
  caCents: number;
  derniereCommande: string | null;
}

/**
 * Segments proposés par l'API. « inactifs » = au moins une commande, mais
 * plus rien depuis 90 jours ; « sans-commande » = inscrit qui n'a jamais
 * acheté.
 */
export type SegmentClients =
  | "compte"
  | "optin"
  | "inactifs"
  | "fideles"
  | "sans-commande";

/** Filtres de la liste des clients. */
export interface FiltresClients {
  q?: string;
  segment?: SegmentClients | string;
  limit?: number;
}

/** Adresse du carnet d'un client — il la gère depuis son espace, pas le BO. */
export interface AdresseClient {
  id: number;
  label: string | null;
  name: string | null;
  line1: string | null;
  line2: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  isDefaultShipping: boolean;
  isDefaultBilling: boolean;
  createdAt?: string;
}

/** Fiche complète : la personne, son carnet d'adresses, son historique. */
export interface ClientDetail {
  customer: Client & {
    /** Note interne, jamais montrée au client. */
    note?: string | null;
    /** Quand il a accepté d'être démarché ; vide s'il ne l'a jamais accepté. */
    marketingOptInAt?: string | null;
    lastLoginAt?: string | null;
  };
  adresses: AdresseClient[];
  commandes: {
    id: number;
    number: string;
    createdAt: string;
    totalCents: number;
    articles: number;
    statutFinancier?: StatutFinancier;
    statutExpedition?: StatutExpedition;
  }[];
  stats: { commandes: number; caCents: number; panierMoyenCents: number };
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
  /**
   * Les trois lignes pré-remplies de l'affiche, dans l'ordre. Les colonnes
   * gardent leurs anciens noms : 161 affiches les remplissent déjà, les
   * renommer coûterait une migration pour rien.
   */
  defaultTitle: string | null;
  defaultSubtitle: string | null;
  defaultLine3: string | null;
  /** Slug du type d'affiche du produit. */
  defaultView: string | null;
  foregroundUrl: string | null;
  backgrounds: ProductBackground[];
  /** L'affiche est générée par IA à partir d'une photo du client. */
  aiEnabled?: boolean;
  /** Consignes de style propres à cette affiche, ajoutées au style commun. */
  aiStylePrompt?: string | null;
}

/** Réglages IA d'une affiche, tels que l'API les renvoie après écriture. */
export interface ProduitIA {
  id: number;
  name?: string;
  aiEnabled: boolean;
  aiStylePrompt: string | null;
}

/**
 * Une image fabriquée par le modèle à partir de la photo d'un client.
 * `apercu` porte TOUJOURS le filigrane ; l'image nette n'existe qu'une fois la
 * commande payée et ne s'ouvre que par /admin/ia/full/:publicId.
 */
export interface GenerationIA {
  id: number;
  publicId: string;
  productId: number | null;
  /** Nom de l'affiche, déjà résolu par l'API. */
  produit: string | null;
  cartId: string | null;
  orderItemId: number | null;
  customerId: number | null;
  status: "en_cours" | "prete" | "echec";
  model: string | null;
  size: string | null;
  costCents: number;
  erreur: string | null;
  /** Le texte envoyé au modèle : style de la boutique, de l'affiche, du client. */
  prompt: string | null;
  ip: string | null;
  createdAt: string;
  paidAt: string | null;
  aApercu: boolean;
  aPleine: boolean;
  apercu: string | null;
  pleine: string | null;
}

/** Une page de générations, la plus récente d'abord. */
export interface ListeGenerationsIA {
  lignes: GenerationIA[];
  /** Nombre total de générations répondant au filtre, toutes pages confondues. */
  total: number;
  /** Ce que ces générations ont coûté. */
  coutCents: number;
  page: number;
  limite: number;
}

/** Filtres de la galerie des générations. */
export interface FiltresIA {
  statut?: string;
  page?: number;
  limite?: number;
}

/** Ce que la génération d'images coûte, et ce qu'elle rate. */
export interface StatsIA {
  /** Faux si la clé OpenAI manque : plus rien ne peut être généré. */
  configuree: boolean;
  modele: string;
  taille: string;
  mois: {
    debut: string;
    essais: number;
    pretes: number;
    echecs: number;
    payees: number;
    tauxEchec: number;
    depenseCents: number;
  };
  /** Plafond mensuel de dépense (réglage « ia.plafondMensuelCents »). */
  plafondCents: number;
  resteCents: number;
  plafondAtteint: boolean;
  /** Ce que coûte une image avec le modèle et la taille réglés. */
  coutParImageCents: number;
  /** Délai au-delà duquel une photo non achetée peut être effacée. */
  purgeJours: number;
  total: { essais: number; coutCents: number };
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
    orders: (filtres?: string | FiltresCommandes) => {
      const f: FiltresCommandes =
        typeof filtres === "string" ? { channel: filtres } : (filtres ?? {});
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(f))
        if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
      const qs = p.toString();
      return req<OrderRow[]>(
        "GET",
        `/admin/orders${qs ? `?${qs}` : ""}`,
        undefined,
        cookie,
      );
    },
    /** Réglages du stand — par la route protégée, jamais par /settings. */
    salon: () =>
      req<{ code: string; evenement: string; ouvert: boolean }>(
        "GET",
        "/admin/salon",
        undefined,
        cookie,
      ),
    /** Étiquettes déjà employées, les plus fréquentes d'abord. */
    orderTags: () =>
      req<{ name: string; n: number }[]>(
        "GET",
        "/admin/orders/tags",
        undefined,
        cookie,
      ),
    /** Remplace les étiquettes d'une commande. */
    setOrderTags: (id: number, tags: string[]) =>
      req<{ id: number; tags: string[] }>(
        "POST",
        `/admin/orders/${id}/tags`,
        { tags },
        cookie,
      ),
    /** Action groupée sur les commandes cochées. */
    bulkOrders: (
      ids: number[],
      action: "fulfil" | "unfulfil" | "tag" | "untag",
      tags?: string[],
    ) =>
      req<{ ok: boolean; count: number }>(
        "POST",
        "/admin/orders/bulk",
        { ids, action, tags },
        cookie,
      ),
    /** Enregistre une expédition (transporteur + suivi + contenu du colis). */
    createFulfillment: (
      id: number,
      data: {
        items?: { orderItemId: number; quantity: number }[];
        carrier?: string;
        trackingNumber?: string;
        trackingUrl?: string;
      },
    ) =>
      req<Expedition>("POST", `/admin/orders/${id}/fulfillments`, data, cookie),
    cancelFulfillment: (id: number) =>
      req<Expedition>("POST", `/admin/fulfillments/${id}/cancel`, {}, cookie),
    /** Rembourse tout ou partie d'une commande. */
    refundOrder: (
      id: number,
      data: {
        items?: { orderItemId: number; quantity: number }[];
        shippingCents?: number;
        reason?: string;
        note?: string;
        restock?: boolean;
        viaPsp?: boolean;
        author?: string;
      },
    ) => req<Remboursement>("POST", `/admin/orders/${id}/refunds`, data, cookie),
    /** Corrige l'adresse de livraison d'une commande passée. */
    updateOrderAddress: (
      id: number,
      data: Record<string, string | null | undefined>,
    ) =>
      req<{ ok: boolean }>("POST", `/admin/orders/${id}/address`, data, cookie),
    /** Renvoie la confirmation au client. */
    resendConfirmation: (id: number) =>
      req<{ ok: boolean }>(
        "POST",
        `/admin/orders/${id}/renvoyer-confirmation`,
        {},
        cookie,
      ),
    /** Paniers engagés mais jamais payés, plus vieux que `hours` heures. */
    abandonedCarts: (hours = 1) =>
      req<PanierAbandonne[]>(
        "GET",
        `/admin/carts/abandoned?hours=${hours}`,
        undefined,
        cookie,
      ),
    /** Envoie la relance d'un panier abandonné. */
    relancerPanier: (id: number) =>
      req<{ ok: boolean }>("POST", `/admin/carts/${id}/relancer`, {}, cookie),
    orderDetail: (id: number) =>
      req<OrderDetail>("GET", `/admin/orders/${id}`, undefined, cookie),
    frames: () => req<Cadre[]>("GET", "/admin/frames", undefined, cookie),
    upsertFrame: (data: {
      id?: number;
      name: string;
      priceCents: number;
      weightGrams?: number;
      previewColor?: string;
      active: boolean;
      position: number;
    }) => req<Cadre>("POST", "/admin/frames", data, cookie),
    deleteFrame: (id: number) =>
      req<{ ok: boolean }>("DELETE", `/admin/frames/${id}`, undefined, cookie),
    /** Poids d'un cadre seul — se règle en pesant, pas en vendant. */
    setFrameWeight: (id: number, weightGrams: number) =>
      req<Cadre>("POST", `/admin/frames/${id}/poids`, { weightGrams }, cookie),

    subscribers: () =>
      req<Inscrit[]>("GET", "/admin/newsletter", undefined, cookie),
    deleteSubscriber: (id: number) =>
      req<{ ok: boolean }>("DELETE", `/admin/newsletter/${id}`, undefined, cookie),
    shipping: () =>
      req<CatalogueLivraisonBO>("GET", "/admin/shipping", undefined, cookie),
    updateShippingMethod: (
      id: number,
      data: {
        name?: string;
        description?: string;
        pickupLocation?: string;
        active?: boolean;
      },
    ) => req<unknown>("POST", `/admin/shipping/methods/${id}`, data, cookie),
    /** Une ligne de grille : un prix pour un mode, une zone, une tranche. */
    upsertShippingRate: (data: {
      id?: number;
      methodId: number;
      zoneId: number;
      priceCents: number;
      freeFromCents: number | null;
      minWeightGrams: number;
      maxWeightGrams: number | null;
      active: boolean;
    }) => req<TarifLivraisonBO>("POST", "/admin/shipping/rates", data, cookie),
    deleteShippingRate: (id: number) =>
      req<{ ok: boolean }>(
        "DELETE",
        `/admin/shipping/rates/${id}`,
        undefined,
        cookie,
      ),
    /**
     * Remplace TOUTE la grille d'un mode dans une zone. Une tranche retirée de
     * l'écran doit disparaître de la base : la seule façon sûre est d'envoyer
     * la grille entière plutôt que ligne à ligne.
     */
    setShippingGrille: (data: {
      methodId: number;
      zoneId: number;
      freeFromCents: number | null;
      tranches: {
        minWeightGrams: number;
        maxWeightGrams: number | null;
        priceCents: number;
      }[];
    }) =>
      req<{ ok: boolean; count: number }>(
        "POST",
        "/admin/shipping/rates/grille",
        data,
        cookie,
      ),
    /** Bornes habituelles des transporteurs, pour pré-remplir une grille. */
    tranchesStandard: () =>
      req<TranchesStandard>(
        "GET",
        "/admin/shipping/tranches-standard",
        undefined,
        cookie,
      ),
    updateShippingZone: (
      id: number,
      data: { name?: string; countries?: string },
    ) => req<unknown>("POST", `/admin/shipping/zones/${id}`, data, cookie),
    /** Note interne d'une commande — jamais montrée au client. */
    setOrderNote: (id: number, note: string) =>
      req<{ id: number; internalNote: string | null }>(
        "POST",
        `/admin/orders/${id}/note`,
        { note },
        cookie,
      ),
    /** Ajoute un commentaire au journal d'une commande. */
    addOrderComment: (id: number, message: string, author?: string) =>
      req<unknown>(
        "POST",
        `/admin/orders/${id}/comment`,
        { message, author },
        cookie,
      ),
    /** Marque une commande traitée (ou la remet à traiter). */
    fulfilOrder: (id: number, fulfilled: boolean) =>
      req<{ id: number; fulfilledAt: string | null }>(
        "POST",
        `/admin/orders/${id}/fulfil`,
        { fulfilled },
        cookie,
      ),
    orderStats: (days: number, channel?: string) =>
      req<StatsCommandes>(
        "GET",
        `/admin/stats/orders?days=${days}${channel ? `&channel=${channel}` : ""}`,
        undefined,
        cookie,
      ),
    customers: (filtres?: FiltresClients) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(filtres ?? {}))
        if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
      const qs = p.toString();
      return req<Client[]>(
        "GET",
        `/admin/customers${qs ? `?${qs}` : ""}`,
        undefined,
        cookie,
      );
    },
    customerDetail: (id: number) =>
      req<ClientDetail>("GET", `/admin/customers/${id}`, undefined, cookie),
    /**
     * Champs qu'on corrige au back-office (téléphone mal saisi, étiquettes,
     * note). Le carnet d'adresses, lui, appartient au client : il n'est pas
     * modifiable d'ici.
     */
    updateCustomer: (
      id: number,
      data: {
        name?: string;
        email?: string;
        phone?: string;
        note?: string;
        tags?: string[];
        acceptsMarketing?: boolean;
      },
    ) => req<Client>("POST", `/admin/customers/${id}`, data, cookie),
    users: () => req<CompteAdmin[]>("GET", "/admin/users", undefined, cookie),
    upsertUser: (data: {
      id?: number;
      email: string;
      role: string;
      password?: string;
    }) => req<{ id: number; email: string }>("POST", "/admin/users", data, cookie),
    deleteUser: (id: number) =>
      req<{ ok: boolean }>("DELETE", `/admin/users/${id}`, undefined, cookie),
    logoutUser: (id: number) =>
      req<{ ok: boolean }>(
        "POST",
        `/admin/users/${id}/deconnecter`,
        {},
        cookie,
      ),
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
    /**
     * La liste des produits telle que le back-office la voit, brouillons et
     * archives compris. La route publique /products ne sert plus ici : elle
     * ne montre que ce qui est en vente.
     */
    produitsAdmin: (params?: {
      statut?: string;
      q?: string;
      categorie?: number;
      collection?: number;
      /** Demander précisément ces produits-là, sans charger tout le reste. */
      ids?: number[];
      limit?: number;
    }) => {
      const p = new URLSearchParams();
      if (params?.ids?.length) p.set("ids", params.ids.join(","));
      if (params?.statut && params.statut !== "tous") p.set("statut", params.statut);
      if (params?.q) p.set("q", params.q);
      if (params?.categorie) p.set("categorie", String(params.categorie));
      if (params?.collection) p.set("collection", String(params.collection));
      if (params?.limit) p.set("limit", String(params.limit));
      const suite = p.toString();
      return req<ListeProduitsAdmin>(
        "GET",
        `/admin/products${suite ? `?${suite}` : ""}`,
        undefined,
        cookie,
      );
    },
    /** La fiche complète d'un produit, en un seul appel. */
    ficheProduit: (id: number) =>
      req<FicheProduit>("GET", `/admin/products/${id}/fiche`, undefined, cookie),
    /** Enregistre la fiche. Les clés absentes ne sont pas touchées. */
    enregistrerFicheProduit: (id: number, corps: Record<string, unknown>) =>
      req<{ ok: true }>("POST", `/admin/products/${id}/fiche`, corps, cookie),
    /** Ce que cette affiche a rapporté sur les derniers jours. */
    ventesProduit: (id: number, jours = 90) =>
      req<VentesProduit>(
        "GET",
        `/admin/products/${id}/ventes?jours=${jours}`,
        undefined,
        cookie,
      ),
    /** Une même action appliquée à plusieurs produits d'un coup. */
    produitsEnMasse: (
      ids: number[],
      action: string,
      params?: Record<string, unknown>,
    ) =>
      req<{
        ok: true;
        count: number;
        refuses?: { id: number; name: string; raison: string }[];
      }>("POST", "/admin/products/bulk", { ids, action, ...params }, cookie),
    /** L'éditeur en grille : chaque ligne porte ses propres changements. */
    enregistrerProduitsEnMasse: (modifications: Record<string, unknown>[]) =>
      req<{
        ok: true;
        count: number;
        erreurs?: { id: number; message: string }[];
      }>("POST", "/admin/products/masse", { modifications }, cookie),
    productCategories: () =>
      req<CategorieProduit[]>(
        "GET",
        "/admin/product-categories",
        undefined,
        cookie,
      ),
    upsertProductCategory: (data: {
      id?: number;
      name: string;
      description?: string | null;
      defaultWeightGrams?: number;
      active?: boolean;
      position?: number;
    }) =>
      req<CategorieProduit>("POST", "/admin/product-categories", data, cookie),
    deleteProductCategory: (id: number) =>
      req<{ ok: boolean }>(
        "DELETE",
        `/admin/product-categories/${id}`,
        undefined,
        cookie,
      ),
    /** Range un lot de produits dans une catégorie (null = les en sort). */
    setProductsCategory: (ids: number[], categoryId: number | null) =>
      req<{ ok: boolean; count: number }>(
        "POST",
        "/admin/products/category",
        { ids, categoryId },
        cookie,
      ),
    productLogistique: (id: number | string) =>
      req<LogistiqueProduit>(
        "GET",
        `/admin/products/${id}/logistique`,
        undefined,
        cookie,
      ),
    /** Un poids laissé à null retombe sur l'échelon du dessus. */
    setProductLogistique: (
      id: number | string,
      data: {
        categoryId: number | null;
        weightGrams: number | null;
        variantes: { id: number; weightGrams: number | null }[];
      },
    ) =>
      req<{ ok: boolean }>(
        "POST",
        `/admin/products/${id}/logistique`,
        data,
        cookie,
      ),
    /** Produits dont le poids reste inconnu — le garde-fou de l'affranchissement. */
    productsSansPoids: () =>
      req<{ id: number; name: string; slug: string }[]>(
        "GET",
        "/admin/products/sans-poids",
        undefined,
        cookie,
      ),
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
        /** Lignes 1, 2 et 3 du texte pré-rempli. */
        defaultTitle?: string | null;
        defaultSubtitle?: string | null;
        defaultLine3?: string | null;
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
      /** Lignes 1, 2 et 3 du texte pré-rempli. */
      defaultTitle?: string | null;
      defaultSubtitle?: string | null;
      defaultLine3?: string | null;
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
    /** Générations récentes, filtrables par statut et paginées. */
    iaGenerations: (filtres?: FiltresIA) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(filtres ?? {}))
        if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
      const qs = p.toString();
      return req<ListeGenerationsIA>(
        "GET",
        `/admin/ia/generations${qs ? `?${qs}` : ""}`,
        undefined,
        cookie,
      );
    },
    /** Dépense du mois, plafond, essais et échecs. */
    iaStats: () => req<StatsIA>("GET", "/admin/ia/stats", undefined, cookie),
    /** Ouvre (ou ferme) la génération par IA sur une affiche. */
    setProductIa: (
      id: number | string,
      data: { aiEnabled: boolean; aiStylePrompt: string | null },
    ) => req<ProduitIA>("POST", `/admin/products/${id}/ia`, data, cookie),
    /** Efface les photos et aperçus des générations jamais achetées. */
    purgerIa: () =>
      req<{ ok: boolean; supprimees: number }>(
        "POST",
        "/admin/ia/purger",
        {},
        cookie,
      ),
  };
}

/**
 * Les lignes de texte d'une affiche commandée, dans l'ordre, sans les vides.
 *
 * L'API les sert dans `lignesAffiche`. Une commande passée avant les trois
 * lignes ne porte qu'un titre et un sous-titre : sans ce repli, elle
 * s'afficherait — et s'imprimerait — sans son texte.
 */
export function lignesDeLAffiche(item: {
  lignesAffiche?: (string | null)[] | null;
  titreAffiche?: string | null;
  sousTitreAffiche?: string | null;
}): string[] {
  const remplies = (source: (string | null | undefined)[]) =>
    source.map((l) => String(l ?? "").trim()).filter(Boolean);
  const lignes = remplies(item.lignesAffiche ?? []);
  return lignes.length
    ? lignes
    : remplies([item.titreAffiche, item.sousTitreAffiche]);
}

export function formatPrice(cents: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
