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

export const characterTypes = pgTable(
  "character_type",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** Regroupement back-office / configurateur (§18.1 E) : ex. 'Adultes', 'Enfants', 'Animaux'. */
    category: text("category"),
    /** Ordre manuel d'affichage dans sa catégorie (§18.1 E). */
    position: integer("position").default(0).notNull(),
    /** Soft-delete (§18.1 A) : non null = archivé, masqué du configurateur, sans casser les commandes. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    legacyTypeId: integer("legacy_type_id"), // typeId Shopify (1, 15, 18…)
  },
  (t) => [
    uniqueIndex("character_type_slug_uniq").on(t.slug),
    index("character_type_category_idx").on(t.category, t.position),
  ],
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
    view: text("view"), // 'front' | 'back'
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
