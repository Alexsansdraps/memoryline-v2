import type { CouleursImage, GroupeCouleur } from "@memoryline/types";
import { apiInterne } from "./api-interne.ts";
/**
 * Client API du back-office. Lecture ET écriture (le BO modifie la config).
 * SSR -> on parle à l'API via le réseau interne Docker (api:3000) en conteneur,
 * sinon localhost:3000 en dev local.
 */
const API_URL =
  apiInterne();

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
  startsAt?: string | null;
  endsAt?: string | null;
  promoRuleId?: number | null;
}

/**
 * Le bandeau tel que le back-office le lit : meme eteint, et avec la regle
 * qu'il annonce. La route publique, elle, ne rend que les bandeaux visibles.
 */
export interface BannerBo extends Banner {
  promo: PromoRule | null;
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
  /**
   * Non nul = archivée : hors du configurateur et de la liste ordinaire,
   * rangée dans « Catégories archivées ». Ses personnages ne bougent pas.
   */
  archivedAt?: string | null;
  /** Nombre de personnages non archivés rattachés (renvoyé par /admin/categories). */
  count?: number;
}

/** Cadre proposé en option lors de la personnalisation. */
export interface Cadre {
  id: number;
  slug: string;
  name: string;
  /** Supplément pour une affiche A4, en centimes. */
  priceA4Cents: number;
  /** Supplément pour une affiche A3, en centimes : un cadre plus grand. */
  priceA3Cents: number;
  /** Poids du cadre, ajouté à celui de l'affiche quand il est vendu avec. */
  weightGrams: number;
  previewColor: string | null;
  active: boolean;
  position: number;
  /**
   * Non nul = archivé : hors du configurateur et de la liste ordinaire, rangé
   * dans « Cadres archivés ». Son nom reste lisible sur les commandes déjà
   * passées et dans le nom des fichiers d'impression.
   */
  archivedAt?: string | null;
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
  /** Non nul = archivé : hors du site et des listes, restaurable. */
  archivedAt?: string | null;
  /** Ce qui s'y rattache — redit avant d'archiver. */
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
  /**
   * Non nul = archivé : le compte ne peut plus se connecter et quitte la
   * liste ordinaire, rangé dans « Comptes archivés ». L'historique des
   * commandes garde son nom.
   */
  archivedAt?: string | null;
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
  /**
   * Non nul = archivée : hors du site et de la liste ordinaire, rangée dans
   * « Catégories archivées ». Ses produits gardent leur rangement.
   */
  archivedAt?: string | null;
  /** Nombre de produits rangés dedans (renvoyé par /admin/product-categories). */
  produits?: number;
}

/**
 * Un bloc d'une page du site.
 *
 * Cinq formes possibles, pas une de plus : c'est ce qui permet à l'éditeur de
 * rester compréhensible sans formation. Le type est volontairement large côté
 * client — c'est l'API qui refuse un bloc mal formé, et elle seule.
 */
export interface BlocPage {
  type: "titre" | "texte" | "image" | "produits" | "bouton";
  [cle: string]: unknown;
}

/** Une page du site telle que la liste du back-office la montre. */
export interface ResumePage {
  id: number;
  slug: string;
  title: string;
  status: string;
  /** Non nul = archivée : hors du site, rangée dans « Pages archivées ». */
  archivedAt?: string | null;
  updatedAt: string;
}

/** Tout ce qu'il faut pour éditer une page, et de quoi remplir ses listes. */
export interface PageCms {
  page: {
    id: number;
    slug: string;
    title: string;
    status: string;
    seoTitle: string | null;
    seoDescription: string | null;
    blocks: BlocPage[];
    translations: Record<string, { title?: string; blocks?: BlocPage[] }> | null;
    createdAt: string;
    updatedAt: string;
  };
  collections: { id: number; slug: string; name: string }[];
  categories: { id: number; name: string }[];
}

/** Une entrée du menu du site, avec ses sous-liens. */
export interface EntreeMenu {
  id?: number;
  label: string;
  href: string;
  visible: boolean;
  translations?: Record<string, { label?: string }> | null;
  enfants: EntreeMenu[];
}

/** Un lien retiré du menu, gardé pour pouvoir le remettre. */
export interface LienArchive {
  id: number;
  label: string;
  href: string;
  /** Nom de l'entrée dont il était le sous-lien, ou null au premier niveau. */
  parent: string | null;
  archivedAt: string;
}

export interface MenuCms {
  entrees: EntreeMenu[];
  /** Les liens retirés du menu, restaurables. Absent des anciennes réponses. */
  archives?: LienArchive[];
}

/** Ce qu'un import ferait, ou vient de faire, sur une fiche produit. */
export interface LigneImport {
  /** L'adresse du produit dans le fichier : c'est elle qui identifie. */
  handle: string;
  nom: string;
  action: "creation" | "mise-a-jour" | "inchange" | "refus";
  /** Pourquoi la ligne est refusée, en français. */
  raison?: string;
  /** Ce qui change, phrase par phrase : « prix A3 : 29 € vers 31 € ». */
  changements: string[];
  collections: string[];
  formats: { format: string; prixCents: number; sku: string | null }[];
  /** Renseigné après application : de quoi enchaîner sur les images. */
  produitId?: number;
  /** Vrai quand la fiche n'a encore aucune image. */
  sansImage?: boolean;
}

/** Le résultat d'un import, qu'il ait été appliqué ou seulement simulé. */
export interface ResultatImport {
  applique: boolean;
  lignes: number;
  produits: number;
  /** Collections créées au passage, parce qu'une étiquette les nommait. */
  collectionsCreees: string[];
  apercu: LigneImport[];
  erreurs: { ligne: number; message: string }[];
}

/**
 * Une collection : la façon dont la boutique range ses affiches.
 *
 * C'est ce que l'ancienne boutique appelait déjà collection, et ce que le
 * back-office appelait catégorie. Un seul mot désormais, et un seul endroit :
 * les catégories étaient restées vides depuis le premier jour.
 */
export interface CollectionBo {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  position: number;
  active: boolean;
  /**
   * Non nul = archivée : hors boutique et hors liste ordinaire, rangée dans
   * « Collections archivées ». Son rangement d'affiches reste intact.
   */
  archivedAt?: string | null;
  /** Poids d'un article de cette collection, quand rien de plus précis ne le dit. */
  defaultWeightGrams: number | null;
  /** Nombre de produits dedans, tous statuts confondus. */
  produits: number;
}

/** Un produit vu depuis sa collection : de quoi le reconnaître d'un coup d'œil. */
export interface ProduitDeCollection {
  id: number;
  name: string;
  slug: string;
  status: string;
  image: string | null;
  prixMin: number | null;
  prixMax: number | null;
  formats: string[];
}

/**
 * Un stand : un endroit et un moment où l'on vend en personne.
 *
 * Plusieurs peuvent être ouverts en même temps, chacun avec son code : c'est
 * ce qui permet de savoir, des mois plus tard, lequel a bien marché.
 */
export interface StandBo {
  id: number;
  code: string;
  nom: string;
  ouvert: boolean;
  createdAt: string;
  closedAt: string | null;
  /**
   * Non nul = archivé : hors de la liste ordinaire, rangé dans « Stands
   * archivés ». Toujours fermé, donc sa tablette n'accepte plus rien. Ses
   * ventes gardent son nom.
   */
  archivedAt?: string | null;
  /** Commandes prises sur ce stand, paniers en cours exclus. */
  commandes: number;
  /** Ce qu'elles totalisent, en centimes. */
  cents: number;
}

/** Où partent les courriers de la boutique en ce moment. */
export interface EtatCourriers {
  configure: boolean;
  /** Vrai quand tout part dans la boîte d'essai, donc vers personne. */
  enEssai: boolean;
  expediteur: string | null;
  copie: string | null;
  boiteTestUrl: string | null;
  /** La phrase que la boutiquière lira : « si j'envoie maintenant, où ça va ». */
  resume: string;
  /** L'adresse du site écrite dans les courriers ; null = ni logo ni liens valables. */
  adressePublique: string | null;
}

/** Un des courriers que la boutique sait envoyer. */
export interface ModeleCourrier {
  id: string;
  nom: string;
  /** À quel moment la boutique l'envoie, en une phrase. */
  quand: string;
  besoinCommande: boolean;
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
  /**
   * Non nul = archivée : la tranche ne facture plus rien et quitte la grille,
   * rangée dans « Tranches archivées ».
   */
  archivedAt?: string | null;
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
    /**
     * Non nul = archivé : hors du tunnel de commande et de la liste
     * ordinaire, rangé dans « Modes archivés ». Les commandes déjà parties
     * continuent d'afficher son nom.
     */
    archivedAt?: string | null;
    /**
     * Pourquoi ce mode ne sort pas sur le site, ou null quand il en sort.
     *
     * Calculé par l'API, avec la règle qui filtre vraiment le site. Le
     * back-office ne la recalcule pas : deux versions finiraient par
     * afficher « proposé » sur un mode que personne ne voit.
     */
    masquePourquoi?: string | null;
  }[];
  tarifs: TarifLivraisonBO[];
  /** Les transporteurs connus de l'API, avec leur état d'intégration. */
  transporteurs?: {
    code: string;
    nom: string;
    integre: boolean;
    variables: readonly string[];
  }[];
  /** Nombre de stands ouverts en ce moment. */
  standsOuverts?: number;
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
  /**
   * Non nul = archivée : hors de la liste ordinaire, de l'export et des
   * actions groupées. Elle se relit et se restaure depuis « Commandes
   * archivées ». Rien n'est effacé, et son statut n'a pas bougé.
   */
  archivedAt?: string | null;
}

/** Filtres de la liste des commandes — tous combinables. */
export interface FiltresCommandes {
  channel?: string;
  /** Identifiant d'un stand : ne garde que ce qui y a été vendu. */
  stand?: number;
  q?: string;
  financial?: string;
  fulfillment?: string;
  tag?: string;
  from?: string;
  to?: string;
  limit?: number;
  /**
   * « 1 » pour ne voir QUE les commandes archivées — la vue « Archivées ».
   * Absent, la liste ne montre que les autres : les deux ne se mélangent
   * jamais, sinon on ne saurait plus ce qui est rangé.
   */
  archived?: string;
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
  articles: number;
  nom: string | null;
  email: string;
  createdAt: string;
  /** Dernière fois que le panier a bougé — l'horloge de l'abandon. */
  derniereActivite: string;
  relanceAt: string | null;
  recupereLe: string | null;
  etat: "abandonne" | "relance" | "recupere" | "trop_ancien" | "renonce";
  /** L'état en une phrase : « Abandonné il y a 3 h », « Récupéré le 4 mars ». */
  etatLibelle: string;
  /** Pourquoi la relance automatique a renoncé. Null quand elle n'a pas renoncé. */
  motifRenoncement: string | null;
  /** Le lien qui remet ce panier dans le navigateur de la cliente. */
  lienRecuperation: string;
  relancable: boolean;
}

/** Les réglages de la relance, tenus dans le back-office. */
export interface ReglagesRelance {
  active: boolean;
  palierHeures: number;
  plancherMinutes: number;
  baseLegale: "consentement" | "interet_legitime";
}

/** Ce que rapporte la relance, en chiffres. */
export interface ChiffresRelance {
  relancables: number;
  montantEnJeu: number;
  relancesEnvoyees: number;
  paniersRecuperes: number;
  montantRecupere: number;
}

/** Tout l'écran des paniers abandonnés, en un seul aller-retour. */
export interface EcranPaniers {
  reglages: ReglagesRelance;
  /** Le délai plancher réellement appliqué à cette liste, en minutes. */
  plancher: number;
  paliers: number[];
  /** La limite au-delà de laquelle plus rien ne part : 336 h, soit 14 jours. */
  fenetreHeures: number;
  courrierConfigure: boolean;
  chiffres: ChiffresRelance;
  paniers: PanierAbandonne[];
}

/** Ce qu'un passage du travailleur a fait. */
export interface BilanPassage {
  examines: number;
  envoyes: number;
  renonces: number;
  echecs: number;
  /** Pourquoi le passage n'a rien fait, quand ce n'est pas faute de paniers. */
  motif?: string | null;
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
    /** Quand la commande a été annulée, et pourquoi. Null = elle ne l'est pas. */
    cancelledAt?: string | null;
    cancelReason?: string | null;
    /**
     * Le numéro de la FACTURE, attribué à sa première édition et jamais
     * réattribué. Absent tant que personne n'a édité la facture.
     */
    invoiceNumber?: string | null;
    invoicedAt?: string | null;
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
    /**
     * L'aperçu de l'affiche commandée, rendu comme le fichier d'impression.
     * Adresse relative à l'API, signée : à préfixer par `apiUrl`.
     */
    apercu?: string;
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
  /** Groupes de couleurs du dessin (nuances réunies, noms, nuanciers). */
  baseGroupesCouleurs?: GroupeCouleur[] | null;
  /** Groupes proposés au client (zones de référence) ; null = la peau seule. */
  baseZonesProposees?: string[] | null;
  /**
   * Familles de couleurs, quand le dessin de base est une image EN PIXELS
   * (photo ou illustration enregistrée en SVG). Null = dessin vectoriel.
   */
  baseCouleursImage?: CouleursImage | null;
  /** Type d'affiche (slug) sous lequel ce personnage est dessiné. */
  orientation?: string;
  /**
   * Calage vertical : position du bas réel du dessin dans le viewBox (0..1).
   * Sert à aligner les pieds de tous les personnages sur le muret.
   */
  bottomPct?: number;
  /**
   * Taille de ce personnage, en facteur de la largeur de référence.
   * 1 = la largeur commune d'avant ce réglage, 0,6 = nettement plus petit.
   */
  facteurTaille?: number;
  /** Décalage de côté sur l'affiche, en fraction de sa largeur (0 = centré). */
  decalageX?: number;
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
  /**
   * Zones de couleur que le client ne peut pas changer (petits détails :
   * ruban, élastique…). Vide = toutes les zones sont proposées.
   */
  zonesMasquees?: string[];
  /** Nuances réunies sous une seule couleur, et leurs noms (« ruban »). */
  groupesCouleurs?: GroupeCouleur[] | null;
  /** Familles de couleurs, quand le dessin de la pièce est une image en pixels. */
  couleursImage?: CouleursImage | null;
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
  /**
   * Non nul = archivée : hors du configurateur et de la liste ordinaire,
   * rangée dans « Catégories archivées ». Ses pièces gardent leur rangement
   * et reprennent le nuancier de leur emplacement.
   */
  archivedAt?: string | null;
  /** Nombre de pièces rangées dedans. */
  pieces?: number;
}

/** Un visuel (arrière-plan) disponible pour un produit. */
export interface ProductBackground {
  id: number;
  url: string;
  name: string | null;
  position: number;
  /**
   * Non nul = archivé : retiré des choix du configurateur, mais toujours
   * imprimable pour les commandes passées dessus.
   */
  archivedAt?: string | null;
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
 * Ce que la purge des photos de visiteurs a effacé — ou, en simulation,
 * effacerait. La même purge passe d'elle-même toutes les heures dans l'API.
 */
export interface BilanPurgeIa {
  jours: number;
  simulation: boolean;
  /** Générations jamais achetées vidées de leurs fichiers. */
  lignes: number;
  /** Fichiers de ces générations : photo, aperçu, pleine définition, impression. */
  fichiers: number;
  /** Photos qui n'ont servi à aucune génération. */
  orphelins: number;
  /** Photos du relais téléphone → tablette restées sur le disque. */
  relais: number;
  /** L'âge, en heures, à partir duquel une photo inutilisée est effacée. */
  heuresPhotosInutilisees: number;
  /** Pourquoi la purge n'a rien fait, quand elle n'a rien fait exprès. */
  motif: string | null;
}

/**
 * Une carte cadeau : de l'argent déjà encaissé, à rendre en affiches.
 *
 * `initialAmountCents` ne bouge jamais, c'est ce qui a été payé le jour de la
 * vente. `balanceCents` est ce qu'il en reste, recopié du journal de la carte.
 */
export interface CarteCadeau {
  id: number;
  code: string;
  initialAmountCents: number;
  balanceCents: number;
  /** « active » ou « disabled ». Une carte ne se supprime pas. */
  status: string;
  expiresAt: string | null;
  customerId: number | null;
  clientNom: string | null;
  clientEmail: string | null;
  note: string | null;
  createdAt: string;
  disabledAt: string | null;
  /** Nombre de fois où la carte a servi à payer quelque chose. */
  utilisations: number;
}

/**
 * Un mouvement du journal d'une carte.
 *
 * `amountCents` est NÉGATIF quand la carte paie, positif à l'achat et aux
 * recharges. Le journal fait foi : le solde n'en est que la somme.
 */
export interface MouvementCarteCadeau {
  id: number;
  amountCents: number;
  label: string | null;
  orderId: number | null;
  /** Le numéro de la commande payée, quand le mouvement en désigne une. */
  numeroCommande: string | null;
  createdAt: string;
}

/** Une carte, son journal, et la personne à qui elle a été remise. */
export interface DetailCarteCadeau {
  carte: Omit<CarteCadeau, "clientNom" | "clientEmail" | "utilisations">;
  mouvements: MouvementCarteCadeau[];
  client: { id: number; nom: string | null; email: string | null } | null;
}

/**
 * La liste des cartes, et ce que la boutique doit encore en affiches.
 *
 * `totalEnCirculationCents` ne compte que les cartes encore échangeables :
 * une carte désactivée ou périmée a cessé d'être une dette.
 */
export interface ListeCartesCadeaux {
  cartes: CarteCadeau[];
  totalEnCirculationCents: number;
  cartesEnCirculation: number;
}

/** Les ventes que regardent les statistiques : le site, les stands, ou toutes. */
export type CanalAnalytique = "site" | "stands" | "tout";

/**
 * Crée un client API lié au cookie de session de la requête entrante.
 * À utiliser dans les pages : `const api = adminApi(Astro.request)`.
 */
/** Ce que l'écran des statistiques reçoit, en un seul appel. */
export interface Analytique {
  /** Le canal effectivement lu : « tout » quand la demande n'en nommait aucun. */
  canal: CanalAnalytique;
  periode: { debut: string; fin: string; jours: number };
  resume: {
    caCents: number;
    commandes: number;
    panierMoyenCents: number;
    clients: number;
    /** Null quand la période précédente était vide : on ne compare pas à rien. */
    evolution: {
      caCents: number | null;
      commandes: number | null;
      panierMoyenCents: number | null;
    };
    precedent: { caCents: number; commandes: number; panierMoyenCents: number };
  };
  parJour: { jour: string; caCents: number; commandes: number }[];
  meilleuresVentes: {
    nom: string;
    slug: string | null;
    quantite: number;
    caCents: number;
  }[];
  parCanal: { canal: string; commandes: number; caCents: number }[];
  parFormat: { format: string; quantite: number; caCents: number }[];
  /** Des personnes : « nouvelle » se juge sur la première commande payée, tous canaux. */
  clients: { nouvelles: number; revenantes: number };
  /**
   * Les paniers du SITE — y compris sous « Tout ». Null sous « Stands », où la
   * vente se règle sur place et où rien ne s'abandonne.
   */
  paniers: {
    abandonnes: number;
    enAttente: number;
    perduCents: number;
    transformation: number | null;
  } | null;
  /** Les villes de livraison. Vide sous « Stands » : une vente de stand est remise sur place. */
  lieux: { ville: string; commandes: number }[];
  /** Stand par stand. Rempli sous « Stands » seulement. */
  parStand: { stand: string; commandes: number; caCents: number }[];
}

/**
 * Un style d'affiche IA tel que le back-office le manipule.
 *
 * `prompt` n'existe QUE côté administration : la route publique ne renvoie
 * jamais la consigne, seulement le titre et les images.
 */
export interface StyleIa {
  id: number;
  title: string;
  prompt: string;
  images: string[];
  position: number;
  active: boolean;
  /**
   * Non nul = archivé : hors du site et de la liste ordinaire, rangé dans
   * « Styles archivés ». Sa consigne et ses images sont gardées entières.
   */
  archivedAt?: string | null;
  translations: Partial<Record<string, { title?: string }>> | null;
}

/** Une chose archivée, telle que l'écran « Archives » l'affiche. */
export interface ElementArchive {
  id: number;
  libelle: string;
  detail: string | null;
  /** ISO, ou null quand la ligne n'a gardé aucune date. */
  date: string | null;
}

/**
 * Une nature de chose archivée : les pages, les collections, les fonds…
 *
 * `dateSource` dit ce que la date raconte. « archivage » = l'heure exacte du
 * rangement. « modification » = le dernier enregistrement, seule date connue
 * pour les produits, dont l'archivage est un statut et non une date : l'écran
 * doit écrire « Modifié le » plutôt qu'une date d'archivage inventée.
 */
export interface GroupeArchives {
  cle: string;
  titre: string;
  /** L'écran où cette nature se range et se restaure aussi. */
  ecran: string;
  /** Son nom dans le menu de gauche, pour que le lien se lise. */
  ecranNom: string;
  dateSource: "archivage" | "modification";
  elements: ElementArchive[];
}

export function adminApi(request?: Request) {
  const cookie = request?.headers.get("cookie") ?? undefined;
  return {
    /**
     * Tout ce qui est archivé, d'un coup. Lecture seule : la restauration
     * passe par la route d'archivage de chaque nature, la seule qui en
     * connaisse les règles.
     */
    archives: () =>
      req<{
        groupes: GroupeArchives[];
        total: number;
        /** Comptées seulement : elles ont leur onglet « Archivées ». */
        commandesArchivees: number;
        /** Comptés seulement : un lien se restaure avec sa famille, côté menu. */
        liensMenuArchives: number;
      }>("GET", "/admin/archives", undefined, cookie),
    /**
     * Archive une lettre, ou la restaure. Il n'y a plus de suppression : une
     * lettre partie garde la trace de qui l'a reçue, et l'effacer emportait
     * cette trace avec elle.
     */
    archiverLettre: (id: number, archived = true) =>
      req<{ ok: boolean }>(
        "POST",
        `/admin/lettres/${id}/archive`,
        { archived },
        cookie,
      ),
    stats: () => req<Stats>("GET", "/admin/stats", undefined, cookie),
    promos: () => req<PromoRule[]>("GET", "/admin/promos", undefined, cookie),
    upsertPromo: (data: Partial<PromoRule>) =>
      req<PromoRule>("POST", "/admin/promos", data, cookie),
    banner: () => req<Banner | null>("GET", "/banner", undefined, cookie),
    /** Le bandeau du back-office : meme eteint, et avec sa regle. */
    bannerBo: () => req<BannerBo | null>("GET", "/admin/banner", undefined, cookie),
    /**
     * Enregistre le bandeau ET l'offre qu'il annonce.
     *
     * `promo` absent ne touche pas au lien ; `null` le retire (la regle liee
     * s'eteint) ; un objet ecrit la regle, qui prend l'etat et les dates du
     * bandeau.
     */
    upsertBanner: (
      data: Partial<Banner> & { promo?: Record<string, unknown> | null },
    ) => req<Banner>("POST", "/admin/banner", data, cookie),
    /**
     * Les réglages tels que le back-office doit les voir.
     *
     * La route ADMIN, et non la route publique : celle-ci retire les clés
     * « ia. », « salon. » et « relance. ». Le back-office y lisait donc une
     * consigne de style IA toujours vide, et l'enregistrait vide par-dessus
     * la vraie. Le résultat garde la forme d'un dictionnaire clé → valeur
     * pour ne rien casser chez les appelants.
     */
    settings: async () => {
      const lignes = await req<
        { key: string; value: unknown; label: string | null; group: string | null }[]
      >("GET", "/admin/settings", undefined, cookie);
      return Object.fromEntries(lignes.map((l) => [l.key, l.value]));
    },
    /** Les lignes entières : label, groupe, et toutes les langues. */
    settingsLignes: () =>
      req<
        {
          key: string;
          label: string | null;
          group: string | null;
          value: unknown;
          updatedAt: string;
        }[]
      >("GET", "/admin/settings", undefined, cookie),
    /**
     * Enregistre un réglage. `lang` fusionne dans la langue demandée sans
     * toucher aux autres ; sans `lang`, la valeur remplace tout.
     */
    setSetting: (key: string, value: unknown, lang?: string) =>
      req<unknown>(
        "POST",
        "/admin/settings",
        lang ? { key, value, lang } : { key, value },
        cookie,
      ),
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
    /**
     * Tous les stands, avec ce que chacun a rapporté.
     *
     * « orphelines » compte les ventes de stand d'avant que les stands soient
     * plusieurs, et qui n'ont pas pu être rattachées : les taire ferait un
     * trou dans les chiffres.
     */
    stands: () =>
      req<{
        stands: StandBo[];
        orphelines: { commandes: number; cents: number };
      }>("GET", "/admin/stands", undefined, cookie),
    /** Ouvre un nouveau stand. Le code est tiré par le serveur. */
    creerStand: (corps: { nom: string; ouvert?: boolean }) =>
      req<{ ok: true; stand: StandBo }>("POST", "/admin/stands", corps, cookie),
    /** Renomme, ouvre, ferme, ou donne un nouveau code d'accès. */
    majStand: (
      id: number,
      corps: { nom?: string; ouvert?: boolean; nouveauCode?: boolean },
    ) =>
      req<{ ok: true; stand: StandBo }>(
        "POST",
        `/admin/stands/${id}`,
        corps,
        cookie,
      ),
    /**
     * Archive un stand, ou le restaure. Il n'y a plus de suppression : un
     * stand effacé laissait ses ventes sans rien qui dise où elles avaient
     * été faites. Archiver le FERME aussi — sa tablette n'accepte plus rien.
     * `commandes` dit combien de ventes s'y rattachent, pour le redire.
     */
    archiverStand: (id: number, archived = true) =>
      req<{ ok: true; archived: boolean; commandes: number }>(
        "POST",
        `/admin/stands/${id}/archive`,
        { archived },
        cookie,
      ),
    /**
     * Archive une commande, ou la restaure. Il n'y a plus de suppression :
     * elle emportait en cascade les lignes, les expéditions, les
     * remboursements et les mouvements d'argent.
     *
     * À ne pas confondre avec l'annulation : archiver RANGE — la commande
     * quitte la liste mais garde son statut, son argent et sa place dans les
     * chiffres. C'est l'annulation qui la sort du chiffre d'affaires.
     */
    archiverCommande: (id: number, archived = true) =>
      req<{ ok: true; archived: boolean; numero: string }>(
        "POST",
        `/admin/orders/${id}/archive`,
        { archived },
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
    /**
     * Action groupée sur les commandes cochées.
     *
     * « supprimer » n'existe plus : elle effaçait les ventes pour de bon.
     * « archiver » les range, « restaurer » les ressort.
     */
    bulkOrders: (
      ids: number[],
      action: "fulfil" | "unfulfil" | "tag" | "untag" | "archiver" | "restaurer",
      tags?: string[],
    ) =>
      // `numeros` n'accompagne que l'archivage : nommer ce qui a quitté la
      // liste évite d'avoir à la relire pour savoir ce qu'on vient de ranger.
      req<{ ok: boolean; count: number; numeros?: string[] }>(
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
    /**
     * Annule une commande.
     *
     * À ne pas confondre avec la suppression : une commande annulée reste
     * lisible et garde son histoire, elle sort seulement des chiffres et ne
     * peut plus rien expédier.
     */
    annulerCommande: (
      id: number,
      data: {
        motif?: string;
        motifLibre?: string;
        rembourser?: boolean;
        restock?: boolean;
        viaPsp?: boolean;
        note?: string;
        author?: string;
      },
    ) =>
      req<{
        ok: true;
        numero: string;
        annuleeLe: string;
        motif: string | null;
        rembourseCents: number;
        /** Ce que l'annulation laisse dû à la cliente. Zéro le plus souvent. */
        resteADevoir: number;
      }>("POST", `/admin/orders/${id}/cancel`, data, cookie),
    /**
     * Marque une commande payée alors que l'argent est arrivé hors du site
     * (virement, chèque, espèces). Idempotent : `deja` dit qu'elle l'était.
     */
    encaisserCommande: (
      id: number,
      data: { moyen: string; reference?: string; author?: string },
    ) =>
      req<{
        ok: true;
        deja?: boolean;
        message?: string;
        encaissee?: boolean;
        montantCents?: number;
        moyen?: string;
        reference?: string | null;
      }>("POST", `/admin/orders/${id}/encaisser`, data, cookie),
    /** Envoie la facture à la cliente, en pièce jointe. */
    envoyerFacture: (id: number, author?: string) =>
      req<{ ok: true; numeroFacture: string; destinataire: string }>(
        "POST",
        `/admin/orders/${id}/facture/envoyer`,
        { author },
        cookie,
      ),
    /** Renvoie la confirmation au client. */
    resendConfirmation: (id: number) =>
      req<{ ok: boolean }>(
        "POST",
        `/admin/orders/${id}/renvoyer-confirmation`,
        {},
        cookie,
      ),
    /**
     * L'écran des paniers abandonnés : réglages, chiffres et liste.
     *
     * `plancher` (en minutes) permet de regarder la liste avec un autre délai
     * que celui enregistré, sans toucher aux réglages. Omis, c'est le réglage
     * de la boutique qui s'applique.
     */
    abandonedCarts: (plancher?: number) =>
      req<EcranPaniers>(
        "GET",
        plancher === undefined
          ? "/admin/carts/abandoned"
          : `/admin/carts/abandoned?plancher=${plancher}`,
        undefined,
        cookie,
      ),
    /** Enregistre les réglages de la relance. */
    reglagesRelance: (r: Partial<ReglagesRelance>) =>
      req<{ reglages: ReglagesRelance }>(
        "POST",
        "/admin/relance/reglages",
        r,
        cookie,
      ),
    /** Envoie la relance d'un panier abandonné, à la main. */
    relancerPanier: (id: number) =>
      req<{ ok: boolean }>("POST", `/admin/carts/${id}/relancer`, {}, cookie),
    /** Déclenche un passage du travailleur tout de suite. */
    passageRelance: () =>
      req<{ bilan: BilanPassage }>("POST", "/admin/relance/passage", {}, cookie),
    orderDetail: (id: number) =>
      req<OrderDetail>("GET", `/admin/orders/${id}`, undefined, cookie),
    frames: () => req<Cadre[]>("GET", "/admin/frames", undefined, cookie),
    upsertFrame: (data: {
      id?: number;
      name: string;
      priceA4Cents: number;
      priceA3Cents: number;
      weightGrams?: number;
      previewColor?: string;
      active: boolean;
      position: number;
    }) => req<Cadre>("POST", "/admin/frames", data, cookie),
    /**
     * Archive un cadre, ou le restaure. Il n'y a plus de suppression : le
     * prix est bien figé sur la ligne de commande, mais le NOM du cadre se
     * relit — sur les commandes passées, dans les courriers, et jusque dans
     * le nom du fichier d'impression. `commandes` dit combien de lignes
     * vendues le citent, pour le redire à l'écran.
     */
    archiverCadre: (id: number, archived = true) =>
      req<{ ok: boolean; archived: boolean; commandes: number }>(
        "POST",
        `/admin/frames/${id}/archive`,
        { archived },
        cookie,
      ),
    /** Poids d'un cadre seul — se règle en pesant, pas en vendant. */
    setFrameWeight: (id: number, weightGrams: number) =>
      req<Cadre>("POST", `/admin/frames/${id}/poids`, { weightGrams }, cookie),

    subscribers: () =>
      req<Inscrit[]>("GET", "/admin/newsletter", undefined, cookie),
    deleteSubscriber: (id: number) =>
      req<{ ok: boolean }>("DELETE", `/admin/newsletter/${id}`, undefined, cookie),
    shipping: () =>
      req<CatalogueLivraisonBO>("GET", "/admin/shipping", undefined, cookie),
    createShippingMethod: (data: {
      name: string;
      kind: string;
      carrier?: string;
      description?: string;
      pickupLocation?: string;
    }) => req<unknown>("POST", "/admin/shipping/methods", data, cookie),
    /**
     * Archive un mode de livraison, ou le restaure. Il n'y a plus de
     * suppression : elle était refusée dès qu'une commande était partie avec
     * ce mode, et quand elle passait, elle emportait toute la grille
     * tarifaire. Archiver le décoche aussi. `commandes` dit combien sont
     * parties avec lui.
     */
    archiverModeLivraison: (id: number, archived = true) =>
      req<{ ok: boolean; archived: boolean; commandes: number }>(
        "POST",
        `/admin/shipping/methods/${id}/archive`,
        { archived },
        cookie,
      ),
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
    /**
     * Archive une tranche de la grille, ou la restaure. Il n'y a plus de
     * suppression : un prix négocié, une borne de poids et une franchise de
     * port ne vivent nulle part ailleurs. La restauration est refusée si une
     * autre tranche a repris cette borne de poids entre-temps.
     */
    archiverTarifLivraison: (id: number, archived = true) =>
      req<{ ok: boolean; archived: boolean }>(
        "POST",
        `/admin/shipping/rates/${id}/archive`,
        { archived },
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
    /** `stand` restreint les chiffres à un seul stand de salon. */
    orderStats: (days: number, channel?: string, stand?: number) =>
      req<StatsCommandes>(
        "GET",
        `/admin/stats/orders?days=${days}${channel ? `&channel=${channel}` : ""}${
          stand ? `&stand=${stand}` : ""
        }`,
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
    /**
     * Archive un compte, ou le restaure. Il n'y a plus de suppression : les
     * journaux des commandes citent le NOM de qui a expédié, remboursé ou
     * annulé, et un compte effacé rendait ces lignes anonymes.
     *
     * Un compte archivé ne peut plus se connecter, et ses sessions ouvertes
     * sont fermées — c'est la seule suppression que cet archivage s'autorise.
     */
    archiverCompte: (id: number, archived = true) =>
      req<{ ok: boolean; archived: boolean }>(
        "POST",
        `/admin/users/${id}/archive`,
        { archived },
        cookie,
      ),
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
    /**
     * Archive un type d'affiche, ou le restaure. Il n'y a plus de suppression :
     * le `slug` relie produits, personnages et pièces à leur type, et l'effacer
     * les laissait pointer dans le vide.
     */
    archiverView: (id: number, archived = true) =>
      req<{
        ok: boolean;
        archived: boolean;
        usage: { produits: number; personnages: number; pieces: number };
      }>("POST", `/admin/views/${id}/archive`, { archived }, cookie),
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
    /**
     * Archive une catégorie de pièces, ou la restaure. Il n'y a plus de
     * suppression : l'effacer dispersait ses pièces et emportait son nuancier.
     * `dedans` dit combien de pièces elle range, pour le redire à l'écran.
     */
    archiverCategoriePiece: (id: number, archived = true) =>
      req<{ ok: boolean; archived: boolean; dedans: number }>(
        "POST",
        `/admin/piece-categories/${id}/archive`,
        { archived },
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
    /**
     * Archive une catégorie de personnages, ou la restaure. Il n'y a plus de
     * suppression : l'effacer vidait le rangement de chaque personnage, et
     * seule une remise à la main les y ramenait. `dedans` dit combien elle en
     * range, pour le redire à l'écran.
     */
    archiverCategoriePersonnage: (id: number, archived = true) =>
      req<{ ok: boolean; archived: boolean; dedans: number }>(
        "POST",
        `/admin/categories/${id}/archive`,
        { archived },
        cookie,
      ),
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
        baseGroupesCouleurs?: GroupeCouleur[] | null;
        baseZonesProposees?: string[] | null;
        baseCouleursImage?: CouleursImage | null;
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
    /**
     * Lit un fichier d'import de fiches produit.
     *
     * Sans `appliquer`, RIEN n'est écrit : on rend seulement ce qui se
     * passerait. Un import de quarante affiches ne se lance pas à l'aveugle.
     */
    importerProduits: (csv: string, appliquer = false) =>
      req<ResultatImport>(
        "POST",
        "/admin/products/import",
        { csv, appliquer },
        cookie,
      ),

    /* --- Collections : la façon de ranger les affiches ------------------ */
    collections: () =>
      req<{ collections: CollectionBo[] }>(
        "GET",
        "/admin/collections",
        undefined,
        cookie,
      ),
    /** Une collection et les produits qui y sont rangés, dans l'ordre voulu. */
    collection: (id: number) =>
      req<{ collection: CollectionBo; produits: ProduitDeCollection[] }>(
        "GET",
        `/admin/collections/${id}`,
        undefined,
        cookie,
      ),
    creerCollection: (corps: { name: string }) =>
      req<{ id: number }>("POST", "/admin/collections", corps, cookie),
    /** Renomme, décrit, active, ou fixe le poids par défaut. */
    majCollection: (
      id: number,
      corps: {
        name?: string;
        description?: string | null;
        active?: boolean;
        defaultWeightGrams?: number | null;
        position?: number;
      },
    ) => req<{ ok: true }>("POST", `/admin/collections/${id}`, corps, cookie),
    /**
     * Archive la collection, ou la restaure.
     *
     * Le rangement des affiches n'est pas touché : `dedans` dit combien elle en
     * range, pour pouvoir le redire à l'écran. C'est ce qui permet de la
     * restaurer complète.
     */
    archiverCollection: (id: number, archived = true) =>
      req<{ ok: true; archived: boolean; dedans: number }>(
        "POST",
        `/admin/collections/${id}/archive`,
        { archived },
        cookie,
      ),
    /** Range des produits dans la collection, ou les en sort. */
    produitsDeCollection: (
      id: number,
      corps: { ajouter?: number[]; retirer?: number[] },
    ) =>
      req<{ ok: true; dedans: number }>(
        "POST",
        `/admin/collections/${id}/produits`,
        corps,
        cookie,
      ),
    /**
     * Fixe l'ordre des produits dans la collection.
     *
     * Le tableau fait foi : la position devient l'indice. Ceux qui n'y
     * figurent pas gardent leur place derrière.
     */
    ordreCollection: (id: number, produits: number[]) =>
      req<{ ok: true; ranges: number }>(
        "POST",
        `/admin/collections/${id}/ordre`,
        { produits },
        cookie,
      ),

    /* --- Contenu du site : pages libres et menu ------------------------ */
    /** Les pages créées depuis le back-office. */
    pages: () =>
      req<{ pages: ResumePage[] }>("GET", "/admin/pages", undefined, cookie),
    /** Une page, plus les collections et catégories pour ses blocs produits. */
    page: (id: number) =>
      req<PageCms>("GET", `/admin/pages/${id}`, undefined, cookie),
    creerPage: (corps: { slug: string; title: string }) =>
      req<{ id: number }>("POST", "/admin/pages", corps, cookie),
    /** Enregistre une page. Les clés absentes ne sont pas touchées. */
    enregistrerPage: (id: number, corps: Record<string, unknown>) =>
      req<{ ok: true }>("POST", `/admin/pages/${id}`, corps, cookie),
    /**
     * Archive une page, ou la restaure. La page garde son texte et son
     * adresse : elle quitte le site, elle ne disparaît pas.
     */
    archiverPage: (id: number, archived = true) =>
      req<{ ok: true; archived: boolean }>(
        "POST",
        `/admin/pages/${id}/archive`,
        { archived },
        cookie,
      ),
    /** Le menu du site, entrées masquées comprises — et les liens retirés. */
    menu: () => req<MenuCms>("GET", "/admin/menu", undefined, cookie),
    /**
     * Remplace TOUT l'arbre du menu : l'ordre du tableau fait la position.
     * Ce qui n'y figure plus part aux archives, d'où il se restaure.
     */
    enregistrerMenu: (entrees: unknown[]) =>
      req<{ ok: true }>("POST", "/admin/menu", { entrees }, cookie),
    /** Remet dans le menu un lien qui en avait été retiré. */
    restaurerLienMenu: (id: number) =>
      req<{ ok: true }>("POST", `/admin/menu/${id}/restaurer`, {}, cookie),

    /* --- Ordre d'affichage des pages de genre ------------------------- */
    /** Les affiches actives d'un genre, dans l'ordre où la boutique les montre. */
    ordreGenre: (genre: string) =>
      req<{ genre: string; rangees: number; produits: ProduitDeCollection[] }>(
        "GET",
        `/admin/products/ordre?genre=${encodeURIComponent(genre)}`,
        undefined,
        cookie,
      ),
    /** Enregistre l'ordre d'un genre : les affiches reçues prennent leur rang. */
    enregistrerOrdreGenre: (genre: string, produits: number[]) =>
      req<{ ok: true; ranges: number }>(
        "POST",
        "/admin/products/ordre",
        { genre, produits },
        cookie,
      ),

    /* --- Statistiques de vente ----------------------------------------- */
    /** Tout l'écran en un appel : résumé, courbe, meilleures ventes, clientes. */
    analytique: (filtres: { depuis?: string; jusqu?: string; canal?: CanalAnalytique } = {}) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(filtres)) if (v) p.set(k, v);
      const qs = p.toString();
      return req<Analytique>(
        "GET",
        `/admin/analytique${qs ? `?${qs}` : ""}`,
        undefined,
        cookie,
      );
    },

    /* --- Styles d'affiche IA ------------------------------------------- */
    /** Tous les styles, éteints compris : c'est l'écran qui les range. */
    stylesIa: () =>
      req<StyleIa[]>("GET", "/admin/ia/prompts", undefined, cookie),
    creerStyleIa: (corps: Record<string, unknown>) =>
      req<StyleIa>("POST", "/admin/ia/prompts", corps, cookie),
    majStyleIa: (id: number, corps: Record<string, unknown>) =>
      req<StyleIa>("PUT", `/admin/ia/prompts/${id}`, corps, cookie),
    /**
     * Archive un style, ou le restaure. Il n'y a plus de suppression : la
     * consigne et les images d'un style ne vivent nulle part ailleurs.
     */
    archiverStyleIa: (id: number, archived = true) =>
      req<{ ok: true; archived: boolean }>(
        "POST",
        `/admin/ia/prompts/${id}/archive`,
        { archived },
        cookie,
      ),

    /* --- Essai des courriers ------------------------------------------- */
    /** Où partent les courriers en ce moment : boîte d'essai, ou vrais clients. */
    etatCourriers: () =>
      req<EtatCourriers>("GET", "/admin/courriers/etat", undefined, cookie),
    modelesCourriers: () =>
      req<{ modeles: ModeleCourrier[] }>(
        "GET",
        "/admin/courriers/modeles",
        undefined,
        cookie,
      ),
    /** Le courrier tel qu'il arrivera, sans rien envoyer. */
    apercuCourrier: (modele: string, commande?: string) =>
      req<{
        modele: string;
        sujet: string;
        html: string;
        source: string;
        commande?: string;
      }>(
        "GET",
        `/admin/courriers/apercu/${encodeURIComponent(modele)}${
          commande ? `?commande=${encodeURIComponent(commande)}` : ""
        }`,
        undefined,
        cookie,
      ),
    /** Envoie un courrier d'essai. La réponse dit où il est réellement allé. */
    essaiCourrier: (corps: {
      modele: string;
      destinataire: string;
      commande?: string;
    }) =>
      req<{ ok: true; parti: boolean; resume: string }>(
        "POST",
        "/admin/courriers/essai",
        corps,
        cookie,
      ),

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
    /**
     * Archive une catégorie de produits, ou la restaure. Il n'y a plus de
     * suppression : l'effacer remettait à zéro le rangement de ses produits,
     * et donc le poids par défaut qui décide de leur affranchissement.
     * `dedans` dit combien elle en range, pour le redire à l'écran.
     */
    archiverCategorieProduit: (id: number, archived = true) =>
      req<{ ok: boolean; archived: boolean; dedans: number }>(
        "POST",
        `/admin/product-categories/${id}/archive`,
        { archived },
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
    /**
     * Archive un visuel (fond), ou le restaure. Archivé, il quitte les choix
     * du configurateur et reste imprimable pour les commandes passées dessus.
     */
    archiverBackground: (bgId: number | string, archived = true) =>
      req<{ ok: boolean; archived: boolean }>(
        "POST",
        `/admin/backgrounds/${bgId}/archive`,
        { archived },
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
    /**
     * Lance la purge des photos de visiteurs sans attendre son passage
     * horaire. `simulation` compte ce qui partirait, sans rien effacer.
     */
    purgerIa: (simulation = false) =>
      req<BilanPurgeIa>("POST", "/admin/ia/purger", { simulation }, cookie),

    /* --- Cartes cadeaux -------------------------------------------------- */

    /** Toutes les cartes, et la somme des soldes encore échangeables. */
    cartesCadeaux: () =>
      req<ListeCartesCadeaux>("GET", "/admin/gift-cards", undefined, cookie),
    /** Une carte, tous ses mouvements, et son destinataire. */
    carteCadeau: (id: number) =>
      req<DetailCarteCadeau>("GET", `/admin/gift-cards/${id}`, undefined, cookie),
    /**
     * Vend une carte. Le code est tiré par le serveur : on ne l'envoie jamais.
     *
     * Le montant part en CENTIMES, comme partout ailleurs dans cette API. La
     * saisie en euros se convertit dans la page, jamais ici.
     */
    creerCarteCadeau: (data: {
      montantCents: number;
      expiresAt?: string | null;
      customerId?: number | null;
      note?: string | null;
    }) => req<{ carte: CarteCadeau }>("POST", "/admin/gift-cards", data, cookie),
    /** Désactive, réactive, ou change la note et la date de fin. */
    majCarteCadeau: (
      id: number,
      data: { status?: string; note?: string | null; expiresAt?: string | null },
    ) => req<{ ok: boolean }>("POST", `/admin/gift-cards/${id}`, data, cookie),
    /**
     * Recharge la carte, ou corrige une erreur.
     *
     * Passe par le journal, jamais par une écriture directe du solde : c'est ce
     * qui garantit que le compteur et les écritures ne peuvent pas diverger.
     */
    ajusterCarteCadeau: (
      id: number,
      data: { amountCents: number; label: string },
    ) =>
      req<{ ok: boolean; solde: number }>(
        "POST",
        `/admin/gift-cards/${id}/ajuster`,
        data,
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
