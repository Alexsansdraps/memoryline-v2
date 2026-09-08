/**
 * Schéma de données Memory Line (PostgreSQL / Drizzle).
 * Implémente le §16 du PLAN_DE_DEV, ajusté à l'export Shopify réel.
 *
 * Principes structurants :
 *  - order.channel ('web' | 'salon') NON NULL et immuable (§11).
 *  - Numérotation séparée WEB-xxxx / SAL-xxxx.
 *  - order_item.config = snapshot JSON de la personnalisation (§14.3).
 *  - legacy_* : on conserve les identifiants Shopify d'origine pour la
 *    traçabilité de l'import et les redirections 301 (§13).
 */
import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  pgEnum,
  bigint,
  boolean,
  doublePrecision,
} from "drizzle-orm/pg-core";

export const orderChannelEnum = pgEnum("order_channel", ["web", "salon"]);
export const productKindEnum = pgEnum("product_kind", [
  "personnalisable",
  "prete_a_imprimer",
]);
export const paymentProviderEnum = pgEnum("payment_provider", [
  "stripe",
  "paypal",
]);

// --- Catalogue ------------------------------------------------------------

export const collections = pgTable(
  "collection",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    position: integer("position").default(0).notNull(),
    legacyId: bigint("legacy_id", { mode: "number" }), // Shopify Collection ID
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("collection_slug_uniq").on(t.slug)],
);

export const products = pgTable(
  "product",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    kind: productKindEnum("kind").notNull().default("personnalisable"),
    basePriceCents: integer("base_price_cents").notNull().default(0),
    status: text("status").notNull().default("active"), // active | draft | archived
    /**
     * Réglages par défaut du configurateur pour CE produit (repris de l'app
     * custom Shopify : metafield {title, subtitle, view}). Pré-remplissent le
     * configurateur ; éditables dans le back-office.
     */
    defaultTitle: text("default_title"),
    defaultSubtitle: text("default_subtitle"),
    defaultView: text("default_view"), // 'front' | 'back' (position des personnages)
    /**
     * Décor d'AVANT-PLAN optionnel (ex. muret/banc/fauteuil) : SVG rendu
     * par-dessus le fond et les personnages, pour l'effet « assis dessus ».
     * URL servie /assets/<fichier>. Éditable dans le back-office.
     */
    foregroundUrl: text("foreground_url"),
    /**
     * Traductions HUMAINES du contenu éditorial, par code langue :
     *   { en: { name, description }, de: { … }, … }
     *
     * Le français vit dans les colonnes `name` / `description` ci-dessus et
     * sert de repli : un champ vide ou absent affiche le français, jamais une
     * chaîne vide. Pas de traduction automatique — la cliente les rédige.
     */
    translations: jsonb("translations").$type<
      Partial<Record<string, { name?: string; description?: string }>>
    >(),
    legacyId: bigint("legacy_id", { mode: "number" }), // Shopify Product ID
    legacySlug: text("legacy_slug"), // slug d'origine -> 301 (§13)
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("product_slug_uniq").on(t.slug)],
);

/** Table de liaison produit <-> collection (un produit peut être dans plusieurs). */
export const productCollections = pgTable(
  "product_collection",
  {
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    collectionId: integer("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    position: integer("position").default(0).notNull(),
  },
  (t) => [
    uniqueIndex("product_collection_uniq").on(t.productId, t.collectionId),
    index("product_collection_collection_idx").on(t.collectionId),
  ],
);

export const productImages = pgTable("product_image", {
  id: serial("id").primaryKey(),
  productId: integer("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  alt: text("alt"),
  position: integer("position").default(0).notNull(),
});

export const variants = pgTable(
  "variant",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    format: text("format").notNull(), // 'A4' | 'A3'
    priceCents: integer("price_cents").notNull(),
    widthMm: integer("width_mm"),
    heightMm: integer("height_mm"),
    legacyId: bigint("legacy_id", { mode: "number" }), // Shopify Variant ID
  },
  (t) => [index("variant_product_idx").on(t.productId)],
);

/**
 * Cadre proposé en option lors de la personnalisation.
 *
 * Le prix s'ajoute à celui de l'affiche, par exemplaire. Géré depuis le
 * back-office : on peut en ajouter, changer les prix, ou en désactiver un sans
 * toucher aux commandes déjà passées (le prix est figé dans la ligne).
 */
export const frames = pgTable(
  "frame",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** Supplément en centimes, ajouté au prix de l'affiche. */
    priceCents: integer("price_cents").notNull().default(0),
    /** Couleur d'aperçu du cadre dans le configurateur (hex). */
    previewColor: text("preview_color"),
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
  },
  (t) => [uniqueIndex("frame_slug_uniq").on(t.slug)],
);

/**
 * Type d'affiche — « de face », « de dos », et tout ce que la cliente
 * inventera ensuite.
 *
 * C'était une paire figée dans le code (`front` / `back`). Un nouveau type
 * demandait un développeur ; il se crée maintenant au back-office. Le `slug`
 * est la valeur écrite dans `asset.view`, `character_type.orientation` et
 * `product.default_view` : il ne se renomme pas une fois des dessins
 * rattachés (le nom, lui, se change librement).
 */
export const posterViews = pgTable(
  "poster_view",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /**
     * Décor de premier plan par défaut (muret, banc…), posé DEVANT le fond et
     * DERRIÈRE les personnages. C'est ce qui distinguait la vue de dos : la
     * règle devient une donnée du type, un produit pouvant toujours donner le
     * sien.
     */
    foregroundUrl: text("foreground_url"),
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
  },
  (t) => [uniqueIndex("poster_view_slug_uniq").on(t.slug)],
);

/** Fond sélectionnable dans le configurateur, lié à un produit. */
export const backgrounds = pgTable("background", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").references(() => products.id, {
    onDelete: "cascade",
  }),
  url: text("url").notNull(),
  name: text("name"),
  position: integer("position").default(0).notNull(),
});

// --- Bibliothèque configurateur ------------------------------------------

/**
 * Catégorie de personnages, gérée depuis le back-office (backlog A3).
 *
 * Remplace le texte libre `character_type.category` : on peut créer une
 * catégorie vide, la renommer, la réordonner ou la supprimer sans toucher aux
 * personnages — ce que du texte recopié sur chaque ligne ne permettait pas.
 */
export const characterCategories = pgTable(
  "character_category",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** Ordre d'affichage des catégories entre elles (BO et configurateur). */
    position: integer("position").default(0).notNull(),
  },
  (t) => [uniqueIndex("character_category_slug_uniq").on(t.slug)],
);

export const characterTypes = pgTable(
  "character_type",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /**
     * Regroupement — texte libre HISTORIQUE, conservé le temps de la bascule.
     * La source de vérité est désormais `categoryId`. Sera supprimé une fois
     * tous les écrans passés sur la table character_category.
     */
    category: text("category"),
    /** Catégorie du personnage (table character_category). */
    categoryId: integer("category_id").references(
      () => characterCategories.id,
      { onDelete: "set null" },
    ),
    /** Ordre manuel d'affichage dans sa catégorie (§18.1 E). */
    position: integer("position").default(0).notNull(),
    /** Soft-delete (§18.1 A) : non null = archivé, masqué du configurateur, sans casser les commandes. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /**
     * SVG complet pré-composé du personnage (ex. Male_2.svg) — viewBox 500×1000,
     * sous-groupes Base/Bottoms/Clothes/Hair/Accessories. C'est l'affichage par
     * défaut quand on ajoute ce personnage (avant tout changement de slot).
     */
    baseSvgUrl: text("base_svg_url"),
    /** Zones de couleur par défaut du SVG de base (recoloration peau/tenue). */
    baseColorZones: jsonb("base_color_zones").$type<Record<string, string>>(),
    /**
     * Position du BAS réel du contenu dans le viewBox (0..1, 1 = tout en bas).
     * Les SVG animaux/bébés ont du vide sous le dessin (chat ~0.59) : ce ratio
     * permet d'aligner les pieds de tous les persos au sol (mesuré par script).
     */
    bottomPct: doublePrecision("bottom_pct").default(1).notNull(),
    /**
     * Orientation NATIVE du personnage : 'front' (face) ou 'back' (dos).
     * Propriété du perso (ex. "Homme assis de dos" = back), définie dans le BO.
     * Le configurateur affiche le perso dans son orientation ; un perso n'a
     * qu'une orientation (les variantes face/dos = deux persos distincts).
     */
    orientation: text("orientation").default("front").notNull(),
    /**
     * Calage des pièces SUR CE PERSONNAGE, par emplacement :
     *   { hair: { dx: 0, dy: -3, scale: 0.9 }, accessory: { … } }
     *
     * Les pièces sont dessinées dans le même cadre que les personnages et
     * simplement superposées : elles ne tombent juste que sur la morphologie
     * pour laquelle elles ont été dessinées. Sur un enfant ou un animal, la
     * coupe flotte. `dx`/`dy` sont en pourcents du cadre, `scale` un facteur.
     * Absent = pièce posée telle quelle.
     */
    slotAdjust: jsonb("slot_adjust").$type<
      Partial<Record<string, { dx: number; dy: number; scale: number }>>
    >(),
    legacyTypeId: integer("legacy_type_id"), // typeId Shopify (1, 15, 18…)
    /**
     * Variantes AUTORISÉES pour ce personnage, par slot, dans l'ordre
     * d'affichage : { clothes: [1], hair: [1, 15, 14, 13], … }. Les nombres
     * sont les ids de l'ancienne config (= `asset.position` des génériques,
     * stables d'un ré-import à l'autre), pas des asset.id. NULL = pas encore
     * lié -> le configurateur propose tout (repli). Source : metafield
     * `custom.characters` de l'ancien site (characters-config.json).
     */
    slotVariants: jsonb("slot_variants").$type<
      Partial<Record<"clothes" | "pants" | "hair" | "accessory", number[]>>
    >(),
  },
  (t) => [
    uniqueIndex("character_type_slug_uniq").on(t.slug),
    index("character_type_category_idx").on(t.category, t.position),
  ],
);

/**
 * Catégorie de PIÈCES — « Casquettes », « Robes », « Lunettes »…
 *
 * Deux besoins d'un coup :
 *  - ranger les pièces plus finement que les quatre emplacements, pour que le
 *    client s'y retrouve quand la garde-robe s'étoffe ;
 *  - donner à chaque famille SES couleurs. Les nuanciers vivaient en dur dans
 *    le code du configurateur (un pour les vêtements, un pour les pantalons,
 *    un pour les cheveux) : ajouter une teinte demandait un développeur, et
 *    toutes les pièces d'un emplacement partageaient forcément la même liste.
 */
export const pieceCategories = pgTable(
  "piece_category",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** Emplacement concerné (clothes | pants | hair | accessory). */
    slot: text("slot").notNull(),
    /**
     * Couleurs proposées au client pour les pièces de cette catégorie, dans
     * l'ordre d'affichage : ["#FFFFFF", "#B8551D", …]. Vide ou absent = on
     * retombe sur le nuancier de l'emplacement.
     */
    colors: jsonb("colors").$type<string[]>(),
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
  },
  (t) => [uniqueIndex("piece_category_slug_uniq").on(t.slug)],
);

export const assets = pgTable(
  "asset",
  {
    id: serial("id").primaryKey(),
    characterTypeId: integer("character_type_id").references(
      () => characterTypes.id,
      { onDelete: "cascade" },
    ),
    slot: text("slot").notNull(), // 'hair' | 'clothes' | 'pants' | 'head' …
    name: text("name"),
    svgUrl: text("svg_url").notNull(),
    view: text("view"), // slug du type d'affiche
    /**
     * Catégorie de la pièce (« Casquettes »…). Elle porte le nuancier
     * proposé au client. Null = pièce non rangée : nuancier de l'emplacement.
     */
    pieceCategoryId: integer("piece_category_id").references(
      () => pieceCategories.id,
      { onDelete: "set null" },
    ),
    /**
     * Zones de couleur recolorables (§18.1 D), extraites des classes `.stN`
     * du SVG : { "st0": "#BA6821", "st1": "#206FE2" } = couleur par défaut de
     * chaque zone. La cliente les édite dans le BO ; le client final les
     * surcharge dans le configurateur (snapshot character.colors, même clés).
     * Accessoires inclus (lève la limitation citée par la cliente).
     */
    colorZones: jsonb("color_zones").$type<Record<string, string>>(),
    position: integer("position").default(0).notNull(),
    legacyAssetId: integer("legacy_asset_id"), // id numérique dans les properties
    /**
     * Soft-delete, comme pour les personnages : non null = archivée,
     * masquée du configurateur mais TOUJOURS lisible pour régénérer le
     * PDF d'une commande passée qui l'utilisait.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [index("asset_slot_idx").on(t.slot)],
);

// --- Clients & commandes --------------------------------------------------

export const customers = pgTable(
  "customer",
  {
    id: serial("id").primaryKey(),
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    legacyId: bigint("legacy_id", { mode: "number" }), // Shopify Customer ID
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("customer_email_idx").on(t.email)],
);

export const orders = pgTable(
  "order",
  {
    id: serial("id").primaryKey(),
    channel: orderChannelEnum("channel").notNull(), // immuable (§11)
    number: text("number").notNull(), // 'WEB-1042' / 'SAL-0087'
    clientOrderId: text("client_order_id"), // idempotence envoi salon (§17.2)
    status: text("status").notNull().default("pending"),
    totalCents: integer("total_cents").notNull().default(0),
    customerId: integer("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    seenAt: timestamp("seen_at", { withTimezone: true }), // null = badge "ventes salon" (§17.3)
    legacyId: bigint("legacy_id", { mode: "number" }), // Shopify Order/Draft ID
    legacyName: text("legacy_name"), // ex. '#1042'
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("order_number_uniq").on(t.number),
    uniqueIndex("order_client_order_id_uniq").on(t.clientOrderId),
    index("order_channel_created_idx").on(t.channel, t.createdAt),
  ],
);

export const orderItems = pgTable("order_item", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => products.id, {
    onDelete: "set null",
  }),
  variantId: integer("variant_id").references(() => variants.id, {
    onDelete: "set null",
  }),
  /** Snapshot §14.3 (schemaVersion obligatoire). null si non personnalisé. */
  config: jsonb("config"),
  title: text("title"), // libellé figé (au cas où le produit change/disparaît)
  unitPriceCents: integer("unit_price_cents").notNull().default(0),
  quantity: integer("quantity").notNull().default(1),
});

export const payments = pgTable("payment", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  provider: paymentProviderEnum("provider").notNull(), // WEB uniquement (§11)
  externalRef: text("external_ref"),
  status: text("status"),
  amountCents: integer("amount_cents").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const printFiles = pgTable("print_file", {
  id: serial("id").primaryKey(),
  orderItemId: integer("order_item_id")
    .notNull()
    .references(() => orderItems.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  filename: text("filename").notNull(), // {NomClient}_{Num}.pdf (§15.3)
  format: text("format"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// --- Admin & SEO ----------------------------------------------------------

export const adminUsers = pgTable(
  "admin_user",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("staff"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("admin_user_email_uniq").on(t.email)],
);

export const sessions = pgTable("session", {
  id: text("id").primaryKey(),
  adminUserId: integer("admin_user_id")
    .notNull()
    .references(() => adminUsers.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const redirects = pgTable(
  "redirect",
  {
    id: serial("id").primaryKey(),
    fromPath: text("from_path").notNull(),
    toPath: text("to_path").notNull(),
    code: integer("code").notNull().default(301),
  },
  (t) => [uniqueIndex("redirect_from_uniq").on(t.fromPath)],
);

export const newsletterSubs = pgTable(
  "newsletter_sub",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("newsletter_email_uniq").on(t.email)],
);

// --- Configuration éditable depuis le BO ---------------------------------

/**
 * Réglages clé/valeur : contenu et paramètres éditables par la cliente sans
 * toucher au code (textes de la home, promo "2 min", liens, etc.).
 * `value` en JSONB pour accepter texte, nombre, objet…
 */
export const settings = pgTable(
  "setting",
  {
    key: text("key").primaryKey(),
    value: jsonb("value").notNull(),
    label: text("label"), // libellé lisible dans le BO
    group: text("group"), // regroupement BO (ex. 'home', 'footer', 'seo')
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
);

/**
 * Moteur de promotions configurable (§ offre du moment).
 * `type` détermine l'effet ; `config` porte les paramètres propres au type :
 *   - buy_x_get_y : { buyQty, getQty, format }       (ex. 3 achetées = 1 A4 offerte)
 *   - percent     : { percent }                       (ex. -15%)
 *   - fixed       : { amountCents }                   (ex. -5 €)
 *   - free_shipping_over : { thresholdCents }         (livraison offerte dès X €)
 * Conditions communes : période [startsAt, endsAt], code optionnel, priorité.
 */
export const promoRules = pgTable(
  "promo_rule",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    type: text("type").notNull(), // buy_x_get_y | percent | fixed | free_shipping_over
    config: jsonb("config").notNull(),
    code: text("code"), // null = automatique (sans code)
    active: boolean("active").notNull().default(true),
    priority: integer("priority").notNull().default(0),
    stackable: boolean("stackable").notNull().default(false),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("promo_active_idx").on(t.active)],
);

/**
 * Bandeau d'annonce en haut du site (l'offre du moment), piloté depuis le BO.
 * Lié optionnellement à une promo. Période d'affichage + style.
 */
export const announcementBanners = pgTable(
  "announcement_banner",
  {
    id: serial("id").primaryKey(),
    message: text("message").notNull(),
    linkUrl: text("link_url"),
    linkLabel: text("link_label"),
    bgColor: text("bg_color").default("#20211f"),
    textColor: text("text_color").default("#f7f3ec"),
    active: boolean("active").notNull().default(true),
    priority: integer("priority").notNull().default(0),
    promoRuleId: integer("promo_rule_id").references(() => promoRules.id, {
      onDelete: "set null",
    }),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("banner_active_idx").on(t.active)],
);
