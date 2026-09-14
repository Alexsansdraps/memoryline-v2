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
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
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
/**
 * Par où l'argent est entré.
 *
 * « manuel » couvre tout ce qui n'a pas de prestataire : le virement, le
 * chèque, les espèces. Il fallait bien un nom, car une cliente qui règle par
 * virement laissait sa commande « En attente » pour toujours, faute de moyen
 * de l'encaisser — et la marquer « stripe » aurait fait mentir la page
 * Finances, qui rapproche justement les encaissements de ce que le prestataire
 * a réellement pris.
 *
 * Ce mot-là et pas un autre : c'est déjà celui que le remboursement hors ligne
 * emploie, et le seul que la page Finances sache écrire en français
 * (« À la main (virement, espèces) »). Le moyen exact — virement, chèque,
 * espèces — et sa référence se lisent au journal de la commande, là où on les
 * cherche ; ce champ-ci ne répond qu'à « chez qui ».
 */
export const paymentProviderEnum = pgEnum("payment_provider", [
  "stripe",
  "paypal",
  "manuel",
]);

// --- Catalogue ------------------------------------------------------------

/**
 * Une collection : la façon dont la boutique range ses affiches, et le seul
 * rangement dont la propriétaire parle — « Villes », « Thèmes & paysages »,
 * « Affiches prêtes à imprimer ».
 *
 * C'est elle qui porte désormais le POIDS PAR DÉFAUT de ce qu'elle contient.
 * C'est le seul endroit où l'on peut dire une bonne fois « une affiche pèse
 * 60 g » : sans cela il faudrait le ressaisir à chaque création de produit, et
 * l'oublier une seule fois suffirait à fausser des frais de port.
 *
 * Le poids est FACULTATIF, et un poids vide n'est pas un poids de zéro : une
 * collection qui ne dit rien laisse simplement la question au produit ou à sa
 * variante. Un zéro, lui, annoncerait un colis sans masse.
 */
export const collections = pgTable(
  "collection",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    position: integer("position").default(0).notNull(),
    /** Poids en grammes des articles de cette collection. Null = non renseigné. */
    defaultWeightGrams: integer("default_weight_grams"),
    /** Désactivée : conservée au back-office, absente de la boutique. */
    active: boolean("active").notNull().default(true),
    legacyId: bigint("legacy_id", { mode: "number" }), // Shopify Collection ID
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("collection_slug_uniq").on(t.slug)],
);

/**
 * Catégorie de produits : « Affiches », « Magnets », « Cartes postales ».
 *
 * PLUS UTILISÉE. Elle n'a jamais reçu une seule ligne, et le rangement du
 * catalogue s'est fait tout entier par collections. Le poids par défaut a suivi
 * : il vit maintenant sur la collection. La table reste en place parce que
 * `product.category_id` la cite encore et que la supprimer coûterait une
 * migration de données pour ne rien apporter.
 */
export const productCategories = pgTable(
  "product_category",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** Poids en grammes proposé aux produits de cette catégorie. */
    defaultWeightGrams: integer("default_weight_grams").notNull().default(0),
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex("product_category_slug_uniq").on(t.slug)],
);

export const products = pgTable(
  "product",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    kind: productKindEnum("kind").notNull().default("personnalisable"),
    /** Ancienne catégorie. Plus alimentée : le rangement passe par les collections. */
    categoryId: integer("category_id").references(() => productCategories.id, {
      onDelete: "set null",
    }),
    /**
     * Le client fournit une photo, l'affiche en est tirée par l'IA.
     *
     * Un drapeau plutôt qu'une valeur de plus dans `kind` : la tarification lit
     * `kind` partout, et une affiche existante peut vouloir gagner ce mode sans
     * pour autant changer de nature.
     */
    aiEnabled: boolean("ai_enabled").notNull().default(false),
    /**
     * Consignes de style propres à CETTE affiche, ajoutées au style commun de
     * la boutique. C'est ici qu'on écrit « vue de la plage, ciel de coucher de
     * soleil, personnages de dos » — ce que la photo du client ne dit pas.
     */
    aiStylePrompt: text("ai_style_prompt"),
    /**
     * Poids du produit en grammes. Null = celui de ses collections.
     *
     * Trois niveaux, du plus précis au plus général : la variante (un A3 pèse
     * plus qu'un A4), puis le produit, puis la collection. On ne recopie jamais
     * la valeur d'un niveau à l'autre : changer le poids d'une collection doit
     * corriger d'un coup tout ce qui n'a pas été réglé à la main.
     */
    weightGrams: integer("weight_grams"),
    basePriceCents: integer("base_price_cents").notNull().default(0),
    status: text("status").notNull().default("active"), // active | draft | archived
    /**
     * Réglages par défaut du configurateur pour CE produit (repris de l'app
     * custom Shopify : metafield {title, subtitle, view}). Pré-remplissent le
     * configurateur ; éditables dans le back-office.
     */
    /**
     * Textes pré-remplis dans le configurateur, ligne par ligne.
     *
     * Les deux premières colonnes s'appelaient « titre » et « sous-titre » du
     * temps où l'affiche n'avait que ces deux textes. On les garde telles
     * quelles — 161 affiches les remplissent — et on ajoute simplement la
     * troisième : renommer les colonnes aurait coûté une migration de données
     * pour ne rien apporter de plus.
     */
    defaultTitle: text("default_title"),
    defaultSubtitle: text("default_subtitle"),
    defaultLine3: text("default_line3"),
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
    /* --- Classement interne ---------------------------------------------- */
    /**
     * Type de produit et fournisseur, tels que la boutique les tenait sur
     * Shopify (« CRIEL Cabines », fournisseur « CRIEL »). Purement internes :
     * ils ne s'affichent jamais en boutique, ils servent à filtrer et à
     * retrouver. La COLLECTION, elle, porte le poids et compte vraiment.
     */
    vendor: text("vendor"),
    productType: text("product_type"),
    /**
     * Étiquettes libres. Les commandes en ont depuis longtemps ; les produits
     * n'en avaient pas, alors que c'est le seul moyen de rassembler des
     * affiches qui n'ont aucune collection en commun (« à refaire »,
     * « best-seller », « salon de Vannes »).
     */
    tags: jsonb("tags").$type<string[]>(),
    /* --- Référencement ---------------------------------------------------- */
    /**
     * Ce que Google affiche. Vides, le site retombe sur le nom du produit et
     * sur les premiers mots de sa description — ce qui donne des phrases
     * coupées au milieu. Les remplir est le seul moyen d'écrire soi-même ce
     * que voit quelqu'un qui cherche « affiche personnalisée Amiens ».
     */
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    legacyId: bigint("legacy_id", { mode: "number" }), // Shopify Product ID
    legacySlug: text("legacy_slug"), // slug d'origine -> 301 (§13)
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("product_slug_uniq").on(t.slug)],
);

/**
 * Une génération d'affiche par IA : la photo envoyée, ce qu'on a demandé, et
 * ce qui est revenu.
 *
 * Chaque essai laisse une ligne, y compris les échecs. C'est ce qui permet de
 * répondre « combien ça nous a coûté ce mois-ci », de retrouver l'image d'une
 * commande six mois plus tard, et de purger les photos des visiteurs qui n'ont
 * jamais acheté — une photo de client est une donnée personnelle, on ne la
 * garde pas indéfiniment « au cas où ».
 */
export const aiGenerations = pgTable(
  "ai_generation",
  {
    id: serial("id").primaryKey(),
    /** Identifiant utilisé dans les URL : il ne révèle pas le nombre d'essais. */
    publicId: text("public_id").notNull(),
    productId: integer("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    /** Panier d'où vient la demande, avant qu'une commande existe. */
    cartId: text("cart_id"),
    /** Ligne de commande, une fois l'affiche achetée. */
    orderItemId: integer("order_item_id").references(() => orderItems.id, {
      onDelete: "set null",
    }),
    customerId: integer("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    /** Photo envoyée par le client. */
    sourcePath: text("source_path"),
    /** Consigne réellement envoyée au modèle, style de la boutique compris. */
    prompt: text("prompt"),
    model: text("model"),
    size: text("size"),
    /** « en_cours », « prete » ou « echec ». */
    status: text("status").notNull().default("en_cours"),
    /** Aperçu FILIGRANÉ, seul visible tant que la commande n'est pas payée. */
    previewPath: text("preview_path"),
    /** Image sans filigrane, produite au paiement pour l'impression. */
    fullPath: text("full_path"),
    erreur: text("erreur"),
    /** Coût estimé de l'appel, pour suivre la dépense du mois. */
    costCents: integer("cost_cents").notNull().default(0),
    /** Origine de la demande — sert uniquement à repérer un usage automatisé. */
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    /** Date du paiement : au-delà, l'image et la photo sont conservées. */
    paidAt: timestamp("paid_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("ai_generation_public_id_uniq").on(t.publicId),
    index("ai_generation_cart_idx").on(t.cartId),
    index("ai_generation_created_idx").on(t.createdAt),
  ],
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
    /** Référence interne, imprimée sur les bons de préparation. */
    sku: text("sku"),
    barcode: text("barcode"),
    /** Poids de CETTE variante en grammes. Null = celui du produit. */
    weightGrams: integer("weight_grams"),
    /** Prix barré affiché à côté du prix, quand il y en a un. */
    compareAtCents: integer("compare_at_cents"),
    /** Ce que la variante coûte à produire — sert au calcul de la marge. */
    costCents: integer("cost_cents"),
    /**
     * Stock disponible. NULL = stock non suivi, et c'est le cas de toutes les
     * affiches : elles sont imprimées à la commande, il n'y a rien à compter.
     * Les magnets et cartes postales, eux, seront suivis.
     */
    stockQty: integer("stock_qty"),
    /** À court de stock : « deny » (on arrête la vente) ou « continue ». */
    stockPolicy: text("stock_policy").notNull().default("deny"),
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
    /**
     * Poids du cadre en grammes, ajouté à celui de l'affiche quand il est
     * vendu avec. Un cadre bois change la tranche d'affranchissement à lui
     * seul : l'oublier, c'est facturer un colis au prix d'une lettre.
     */
    weightGrams: integer("weight_grams").notNull().default(0),
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
     * Taille de CE personnage, en facteur de la largeur de référence.
     *
     * Tous les personnages étaient dessinés à la même largeur : un chat
     * occupait autant de place qu'un homme adulte. Ce facteur corrige la
     * proportion, personnage par personnage. 1 = la largeur de référence,
     * 0,6 = nettement plus petit, 1,3 = plus grand.
     *
     * Il s'applique quand l'affiche se COMPOSE, pas au rendu : il entre dans
     * l'échelle enregistrée avec la commande. Une affiche commandée hier ne
     * bouge donc jamais, même si ce facteur change demain.
     */
    facteurTaille: doublePrecision("facteur_taille").default(1).notNull(),
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
    /**
     * Tenue par défaut : la POSITION de la pièce portée d'emblée pour chaque
     * emplacement — { clothes: 3, hair: 7 }.
     *
     * Les personnages d'origine ont leur tenue dessinée dans leur SVG de base,
     * ils arrivent donc habillés sans rien de plus. Un personnage importé nu
     * arrivait tout nu chez le client, à lui de tout choisir : ce réglage lui
     * donne une tenue de départ, modifiable ensuite comme n'importe quelle
     * pièce. Emplacement absent = rien de porté au départ.
     */
    defaultAssets: jsonb("default_assets").$type<Partial<Record<string, number>>>(),
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

/* --------------------------------------------------------------------------
 *  Livraison
 *
 *  Trois tables plutôt qu'une colonne de prix : le tarif dépend du MODE
 *  (point relais, domicile, retrait) ET de la ZONE (France, Europe, reste du
 *  monde). Les deux se gèrent au back-office sans toucher au code, et le
 *  croisement des deux donne le prix.
 * ----------------------------------------------------------------------- */

/** Zone de livraison : un groupe de pays qui partagent les mêmes tarifs. */
export const shippingZones = pgTable(
  "shipping_zone",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /**
     * Codes pays ISO (« FR », « BE »…). Une zone dont la liste est VIDE est
     * la zone par défaut : elle ramasse tous les pays qu'aucune autre ne
     * réclame. Sans elle, un client d'un pays oublié ne pourrait pas
     * commander.
     */
    countries: jsonb("countries").$type<string[]>(),
    position: integer("position").notNull().default(0),
  },
  (t) => [uniqueIndex("shipping_zone_slug_uniq").on(t.slug)],
);

/** Mode de livraison proposé au client. */
export const shippingMethods = pgTable(
  "shipping_method",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** Texte affiché sous le nom (délai indicatif, précisions). */
    description: text("description"),
    /**
     * Nature du mode, qui décide de ce qu'on demande au client :
     *   relay  → un point relais à choisir (Mondial Relay) ;
     *   home   → une adresse de livraison (Colissimo) ;
     *   pickup → rien du tout (retrait sur place).
     */
    kind: text("kind").notNull().default("home"),
    /** Transporteur, pour les intégrations à venir (étiquettes, suivi). */
    carrier: text("carrier"),
    /**
     * Où retirer sa commande, pour un mode « pickup ». La boutique est
     * itinérante : l'emplacement change de salon en salon, il se modifie donc
     * au back-office, et le mode se désactive les semaines sans marché.
     */
    pickupLocation: text("pickup_location"),
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
  },
  (t) => [uniqueIndex("shipping_method_slug_uniq").on(t.slug)],
);

/** Tarif d'un mode dans une zone, avec son éventuelle franchise de port. */
export const shippingRates = pgTable(
  "shipping_rate",
  {
    id: serial("id").primaryKey(),
    methodId: integer("method_id")
      .notNull()
      .references(() => shippingMethods.id, { onDelete: "cascade" }),
    zoneId: integer("zone_id")
      .notNull()
      .references(() => shippingZones.id, { onDelete: "cascade" }),
    priceCents: integer("price_cents").notNull().default(0),
    /**
     * Montant d'achat à partir duquel la livraison est offerte. Null = jamais
     * offerte. Le seuil se compare au panier APRÈS remises : une promotion ne
     * doit pas faire perdre le franco de port qu'elle vient de faire gagner…
     * ni l'inverse.
     */
    freeFromCents: integer("free_from_cents"),
    /**
     * Tranche de poids où ce tarif s'applique, en grammes : de `minWeightGrams`
     * inclus à `maxWeightGrams` exclu. Null en haut = pas de limite.
     *
     * Un tarif unique de 0 à l'infini est le cas simple, et c'est ce qu'ont
     * les tarifs existants. Les tranches ne servent qu'aux transporteurs qui
     * facturent au poids — on ne les impose donc à personne.
     */
    minWeightGrams: integer("min_weight_grams").notNull().default(0),
    maxWeightGrams: integer("max_weight_grams"),
    /** Mode indisponible dans cette zone (ex. retrait sur place à l'étranger). */
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    uniqueIndex("shipping_rate_uniq").on(t.methodId, t.zoneId, t.minWeightGrams),
  ],
);

// --- Clients & commandes --------------------------------------------------

/**
 * Un client. La même ligne sert au visiteur de passage et au titulaire d'un
 * compte : c'est `passwordHash` qui fait la différence.
 *
 * Ce choix évite le pire scénario côté cliente — deux fiches pour la même
 * personne, l'une avec l'historique, l'autre avec le compte. À l'inscription,
 * les commandes passées en visiteur avec la même adresse sont rattachées au
 * compte, et la fiche en double disparaît.
 */
export const customers = pgTable(
  "customer",
  {
    id: serial("id").primaryKey(),
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    /** « scrypt:<sel>:<empreinte> ». Null = pas de compte, simple visiteur. */
    passwordHash: text("password_hash"),
    /**
     * Prénom et nom, séparés.
     *
     * `name` reste le nom COMPLET : c'est lui qu'affichent les écrans, les
     * étiquettes de colis et les courriers, et le séparer aurait demandé de
     * réécrire partout. Ces deux champs-ci le composent, et servent là où la
     * distinction compte : « Bonjour Marie » dans un courrier, un tri par nom
     * de famille dans la liste des clientes.
     *
     * Vides sur les fiches d'avant : on ne devine pas où couper « Jean-Pierre
     * de la Tour », et une mauvaise coupure vaut moins que rien du tout.
     */
    firstName: text("first_name"),
    lastName: text("last_name"),
    /** Consentement marketing explicite, avec sa date (RGPD). */
    acceptsMarketing: boolean("accepts_marketing").notNull().default(false),
    marketingOptInAt: timestamp("marketing_opt_in_at", { withTimezone: true }),
    /** Étiquettes de classement interne, jamais montrées au client. */
    tags: jsonb("tags").$type<string[]>(),
    /** Note du back-office sur ce client. */
    note: text("note"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    legacyId: bigint("legacy_id", { mode: "number" }), // Shopify Customer ID
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("customer_email_idx").on(t.email),
    // Unicité RÉSERVÉE aux comptes : deux visiteurs peuvent partager une
    // adresse dans l'historique importé, mais on ne veut jamais deux comptes
    // qui se disputent la même boîte mail.
    uniqueIndex("customer_account_email_uniq")
      .on(sql`lower(${t.email})`)
      .where(sql`${t.passwordHash} is not null`),
  ],
);

/**
 * Carnet d'adresses d'un client.
 *
 * Séparé de la commande : celle-ci fige l'adresse du jour (une commande partie
 * ne doit jamais changer de destination parce que le client a déménagé),
 * tandis que le carnet, lui, suit la vie du client.
 */
export const customerAddresses = pgTable(
  "customer_address",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    /** « Maison », « Bureau »… saisi par le client. */
    label: text("label"),
    name: text("name"),
    line1: text("line1"),
    line2: text("line2"),
    postalCode: text("postal_code"),
    city: text("city"),
    country: text("country"),
    phone: text("phone"),
    isDefaultShipping: boolean("is_default_shipping").notNull().default(false),
    isDefaultBilling: boolean("is_default_billing").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("customer_address_customer_idx").on(t.customerId)],
);

/**
 * Sessions de la boutique. Même principe que le back-office : la base ne
 * garde que le SHA-256 du jeton, jamais le jeton lui-même — une fuite de
 * cette table ne permet donc de se connecter au compte de personne.
 */
export const customerSessions = pgTable(
  "customer_session",
  {
    id: text("id").primaryKey(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("customer_session_customer_idx").on(t.customerId)],
);

/**
 * Jetons à usage unique envoyés par e-mail : réinitialisation de mot de passe
 * aujourd'hui, vérification d'adresse demain.
 *
 * `usedAt` plutôt qu'une suppression : on veut pouvoir répondre « ce lien a
 * déjà servi » au lieu de « lien inconnu », qui laisse croire à une panne.
 */
export const customerTokens = pgTable(
  "customer_token",
  {
    id: text("id").primaryKey(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    /** « reset » ou « verify ». */
    kind: text("kind").notNull().default("reset"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("customer_token_customer_idx").on(t.customerId, t.kind)],
);

/**
 * Un stand, c'est-à-dire un endroit et un moment où l'on vend en personne.
 *
 * Il y en avait un seul, tenu dans les réglages : un code, un nom, un
 * interrupteur. Deux stands le même week-end étaient donc impossibles, et
 * rien ne disait des mois plus tard d'où venait une vente, sinon une étiquette
 * posée à la main.
 *
 * Le CODE est ce qui ouvre la tablette. Il vit ici et nulle part ailleurs :
 * deux stands ouverts en même temps ne peuvent pas partager le même, sans quoi
 * on ne saurait plus attribuer une commande.
 */
export const stands = pgTable(
  "stand",
  {
    id: serial("id").primaryKey(),
    /** Le code que la vendeuse tape sur la tablette. Jamais montré au client. */
    code: text("code").notNull(),
    /** « Salon du livre de Nantes 2026 » : le nom du lieu, tel qu'on le dit. */
    nom: text("nom").notNull(),
    /**
     * Ouvert veut dire « la tablette accepte des commandes ». Fermer ne
     * supprime rien : les ventes restent, et le stand peut rouvrir l'an
     * prochain sous le même nom.
     */
    ouvert: boolean("ouvert").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    /** Dernière fermeture. Null tant qu'il n'a jamais été fermé. */
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("stand_code_uniq").on(t.code)],
);

/**
 * Une carte cadeau : une somme encaissée d'avance, à rendre en affiches.
 *
 * Ce n'est pas un code promo. Une remise réduit un prix au moment de l'achat ;
 * une carte cadeau est de l'argent déjà versé, donc une dette de la boutique.
 * Elle garde un solde, se dépense en plusieurs fois, et ne se supprime pas :
 * on la désactive, ce qui laisse la trace de ce qui a été vendu.
 */
export const giftCards = pgTable(
  "gift_card",
  {
    id: serial("id").primaryKey(),
    /** Le code que porte la carte. Jamais deux fois le même. */
    code: text("code").notNull(),
    /** Ce qui a été payé à l'achat de la carte. Ne bouge plus jamais. */
    initialAmountCents: integer("initial_amount_cents").notNull(),
    /**
     * Ce qu'il reste. Recopié du journal pour que la caisse n'ait pas à faire
     * une somme à chaque passage ; c'est le JOURNAL qui fait foi en cas de
     * doute, jamais ce compteur.
     */
    balanceCents: integer("balance_cents").notNull(),
    /** active | disabled. Une carte vidée reste active : elle vaut zéro. */
    status: text("status").notNull().default("active"),
    /** Null = sans date de fin. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** À qui elle a été remise, quand on le sait. */
    customerId: integer("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    /** Note interne : « offerte au salon de Vannes », « geste commercial ». */
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("gift_card_code_uniq").on(t.code)],
);

/**
 * Chaque mouvement d'une carte cadeau, en écriture seule.
 *
 * Négatif quand la carte paie une commande, positif quand elle est rechargée
 * ou qu'un remboursement lui rend sa valeur. Rien ne se corrige ici : une
 * erreur se répare par une écriture inverse, comme dans un livre de comptes.
 */
export const giftCardTransactions = pgTable(
  "gift_card_transaction",
  {
    id: serial("id").primaryKey(),
    giftCardId: integer("gift_card_id")
      .notNull()
      .references(() => giftCards.id, { onDelete: "cascade" }),
    /**
     * La commande payée avec la carte. « set null » et non cascade : effacer
     * une commande ne doit pas effacer la preuve que la carte a été dépensée.
     */
    orderId: integer("order_id").references(() => orders.id, {
      onDelete: "set null",
    }),
    amountCents: integer("amount_cents").notNull(),
    /** Ce que dira le back-office : « payé la commande WEB-0042 ». */
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("gift_card_transaction_card_idx").on(t.giftCardId, t.createdAt)],
);

export const orders = pgTable(
  "order",
  {
    id: serial("id").primaryKey(),
    channel: orderChannelEnum("channel").notNull(), // immuable (§11)
    number: text("number").notNull(), // 'WEB-1042' / 'SAL-0087'
    clientOrderId: text("client_order_id"),
    /**
     * Code promo saisi au panier, tel qu'il a été validé. Gardé sur la
     * commande : c'est ce qui explique l'écart entre la somme des lignes et
     * le montant encaissé, des mois plus tard.
     */
    promoCode: text("promo_code"),
    /* --- Livraison ------------------------------------------------------- */
    /** Mode choisi (slug), figé sur la commande : le catalogue peut changer. */
    shippingMethod: text("shipping_method"),
    /** Nom du mode tel qu'il s'appelait le jour de la commande. */
    shippingLabel: text("shipping_label"),
    /** Frais réellement facturés, en centimes. Compris dans `totalCents`. */
    shippingCents: integer("shipping_cents").notNull().default(0),
    /**
     * Poids total figé au moment de la commande, en grammes. Le catalogue
     * changera ; le colis, lui, a pesé ce qu'il a pesé — et c'est ce chiffre
     * qu'il faut pour rééditer une étiquette ou contester une facture.
     */
    weightGrams: integer("weight_grams").notNull().default(0),
    /** Adresse de livraison, quand le mode en demande une. */
    shippingName: text("shipping_name"),
    shippingLine1: text("shipping_line1"),
    shippingLine2: text("shipping_line2"),
    shippingPostalCode: text("shipping_postal_code"),
    shippingCity: text("shipping_city"),
    shippingCountry: text("shipping_country"),
    shippingPhone: text("shipping_phone"),
    /** Point relais choisi (identifiant Mondial Relay et libellé lisible). */
    relayPointId: text("relay_point_id"),
    relayPointLabel: text("relay_point_label"), // idempotence envoi salon (§17.2)
    status: text("status").notNull().default("pending"),
    totalCents: integer("total_cents").notNull().default(0),
    customerId: integer("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    seenAt: timestamp("seen_at", { withTimezone: true }), // null = badge "ventes stand" (§17.3)
    /**
     * Le stand où cette commande a été prise. Null pour une vente du site, et
     * pour les ventes d'avant que les stands soient plusieurs.
     *
     * « set null » plutôt qu'une cascade : supprimer un stand ne doit pas
     * emporter les ventes qu'on y a faites. On perd le rattachement, jamais
     * le chiffre.
     */
    standId: integer("stand_id").references(() => stands.id, {
      onDelete: "set null",
    }),
    /**
     * Part du total réglée par une carte cadeau, en centimes.
     *
     * Gardée sur la commande et pas seulement dans le journal de la carte :
     * c'est ce qui explique, des mois plus tard, pourquoi le prestataire de
     * paiement n'a encaissé que la différence.
     */
    giftCardCents: integer("gift_card_cents").notNull().default(0),
    legacyId: bigint("legacy_id", { mode: "number" }), // Shopify Order/Draft ID
    legacyName: text("legacy_name"), // ex. '#1042'
    /**
     * Date de traitement : la commande a été imprimée, emballée, expédiée ou
     * remise. Null = reste à faire. C'est ce qui distingue « payée » (l'argent
     * est arrivé) de « traitée » (le client a son affiche) — deux questions
     * différentes que la liste doit répondre d'un coup d'œil.
     */
    fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
    /**
     * Quand la commande a été annulée. Null = elle ne l'est pas.
     *
     * Le statut `cancelled` dit DÉJÀ qu'elle l'est ; cette date dit QUAND, ce
     * que le statut seul ne peut pas porter. Les deux vont ensemble et sont
     * posés d'un seul geste par la route d'annulation : on ne pose jamais
     * l'un sans l'autre, sinon la fiche saurait qu'une commande est annulée
     * sans savoir depuis quand.
     */
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    /**
     * Pourquoi elle a été annulée, dans les mots de la boutique : « rupture »,
     * « demande de la cliente »… Gardé en clair et pas en code, comme
     * `recoveryDeclinedReason` : c'est une phrase qu'on lit sur la fiche, et
     * personne n'a envie d'entretenir un dictionnaire pour l'afficher.
     */
    cancelReason: text("cancel_reason"),
    /**
     * Le numéro de la FACTURE de cette commande — « F2026-0001 ».
     *
     * Rien à voir avec `number`, le numéro de commande : celui-ci se donne à
     * la commande dès qu'elle naît, y compris à un panier qui ne sera jamais
     * payé. Le numéro de facture, lui, est une obligation légale (art. 242
     * nonies A de l'annexe II au CGI) : une suite chronologique, continue et
     * SANS TROU. Il n'est donc attribué qu'à la première édition de la
     * facture, une seule fois, et ne bouge plus jamais — rééditer le PDF rend
     * la même facture, portant le même numéro.
     */
    invoiceNumber: text("invoice_number"),
    /** Date d'émission de la facture, figée avec son numéro. */
    invoicedAt: timestamp("invoiced_at", { withTimezone: true }),
    /**
     * Note interne : « à envoyer avec la commande #2141 », « client rappelé »…
     * Elle n'est jamais montrée au client, elle sert à se souvenir.
     */
    internalNote: text("internal_note"),
    /**
     * Date d'envoi de la relance de panier abandonné.
     *
     * C'EST le drapeau d'unicité : « relancé » se lit « cette date existe ».
     * Shopify porte un booléen `recovery_email_sent` à côté de sa date ; ici
     * la date seule dit la même chose et ne peut pas se contredire — un
     * booléen et une date finissent toujours par diverger, et il faut alors
     * choisir lequel des deux ment. On n'ajoute donc PAS de colonne
     * `recovery_email_sent_at` en double : c'est cette colonne-ci.
     */
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    /**
     * Dernière fois que ce panier a bougé : article ajouté, modifié, retiré,
     * ou passage au tunnel de commande. C'est L'HORLOGE D'INACTIVITÉ, celle
     * qui décide qu'un panier est abandonné.
     *
     * Sans elle, on ne savait mesurer que l'âge du panier : un client qui
     * compose son affiche pendant une heure était déclaré « abandonné » alors
     * qu'il était encore là. Null pour les paniers d'avant cette colonne — on
     * retombe alors sur `createdAt`, qui reste une approximation honnête.
     */
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    /**
     * Le jeton du lien de récupération envoyé dans la relance.
     *
     * Tiré au sort, propre à ce panier, il ne dit rien de la personne et ne
     * se devine pas : il ne sert qu'à remettre CE panier dans le navigateur
     * qui ouvre le lien. Créé au moment où on en a besoin, jamais avant.
     */
    recoveryToken: text("recovery_token"),
    /**
     * Le panier a été payé APRÈS une relance.
     *
     * C'est le seul chiffre qui dit si la relance sert à quelque chose : sans
     * lui, on sait combien de courriers sont partis, jamais combien de
     * commandes ils ont ramenées.
     */
    recoveredAt: timestamp("recovered_at", { withTimezone: true }),
    /**
     * Pourquoi la relance automatique a renoncé : « achat croisé »,
     * « article indisponible », « pas de consentement »…
     *
     * Gardé en clair plutôt qu'en code : c'est une phrase que la boutique lit
     * dans la liste, et personne n'a envie d'entretenir un dictionnaire de
     * codes pour l'afficher. Réécrit à chaque passage du travailleur.
     */
    recoveryDeclinedReason: text("recovery_declined_reason"),
    /** Quand ce renoncement a été constaté. */
    recoveryDeclinedAt: timestamp("recovery_declined_at", { withTimezone: true }),
    /**
     * Étiquettes libres de classement interne : « cadeau », « urgent »,
     * « salon de Nantes ». Jamais montrées au client ; elles servent à
     * retrouver un lot de commandes qui n'ont rien d'autre en commun.
     */
    tags: jsonb("tags").$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("order_number_uniq").on(t.number),
    uniqueIndex("order_client_order_id_uniq").on(t.clientOrderId),
    index("order_channel_created_idx").on(t.channel, t.createdAt),
    // Deux commandes ne doivent JAMAIS porter le même numéro de facture : la
    // base le refuse, ce qui vaut mieux qu'un contrôle applicatif qu'un
    // deuxième onglet ouvert au même instant contournerait.
    uniqueIndex("order_invoice_number_uniq").on(t.invoiceNumber),
    // Unique : deux paniers ne doivent jamais partager un jeton, sinon le
    // lien de l'un ouvrirait le panier de l'autre. Et indexé, parce que la
    // page de récupération n'a que ce jeton pour retrouver la commande.
    uniqueIndex("order_recovery_token_uniq").on(t.recoveryToken),
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

/**
 * Journal d'une commande : ce qui lui est arrivé, dans l'ordre.
 *
 * Deux natures d'entrées. Les ÉVÉNEMENTS sont écrits par le système quand
 * quelque chose se produit (payée, traitée, PDF téléchargé) — ils racontent
 * l'histoire sans qu'on ait à s'en souvenir. Les COMMENTAIRES sont écrits à
 * la main, pour ce que le système ne peut pas deviner : « cliente rappelée »,
 * « à joindre au colis de sa sœur ».
 */
export const orderEvents = pgTable(
  "order_event",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /** « event » (le système) ou « comment » (quelqu'un). */
    kind: text("kind").notNull().default("event"),
    message: text("message").notNull(),
    /** Qui l'a écrit, pour un commentaire. */
    author: text("author"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("order_event_order_idx").on(t.orderId, t.createdAt)],
);

/**
 * Une EXPÉDITION : un colis parti, avec son transporteur et son suivi.
 *
 * Une commande peut en avoir plusieurs — deux affiches envoyées séparément
 * parce que l'une attendait un cadre. C'est pour ça que l'expédition porte
 * ses propres lignes (`fulfillmentItems`) plutôt qu'un simple drapeau sur la
 * commande : « partiellement expédiée » est un état réel, pas un entre-deux.
 */
export const fulfillments = pgTable(
  "fulfillment",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /** « Colissimo », « Mondial Relay », « Remise en main propre »… */
    carrier: text("carrier"),
    trackingNumber: text("tracking_number"),
    /** Lien de suivi, calculé à la création si le transporteur est connu. */
    trackingUrl: text("tracking_url"),
    /** « success » (parti) ou « cancelled » (annulé après coup). */
    status: text("status").notNull().default("success"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (t) => [index("fulfillment_order_idx").on(t.orderId)],
);

/** Ce qu'il y avait dans un colis, ligne par ligne. */
export const fulfillmentItems = pgTable(
  "fulfillment_item",
  {
    id: serial("id").primaryKey(),
    fulfillmentId: integer("fulfillment_id")
      .notNull()
      .references(() => fulfillments.id, { onDelete: "cascade" }),
    orderItemId: integer("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull().default(1),
  },
  (t) => [index("fulfillment_item_ful_idx").on(t.fulfillmentId)],
);

/**
 * Un REMBOURSEMENT, total ou partiel.
 *
 * On garde le détail (quelles lignes, quelles quantités, quelle part du port)
 * et pas seulement un montant : c'est ce qui permet de dire, six mois après,
 * *ce qui* a été remboursé — et d'empêcher de rembourser deux fois la même
 * affiche.
 */
export const refunds = pgTable(
  "refund",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /** Total rendu au client, port compris. */
    amountCents: integer("amount_cents").notNull().default(0),
    /** Part des frais de port dans ce total. */
    shippingCents: integer("shipping_cents").notNull().default(0),
    /** « Article abîmé », « erreur de commande »… */
    reason: text("reason"),
    /** Précision interne, jamais envoyée au client. */
    note: text("note"),
    /** Les articles rendus sont-ils remis en stock ? */
    restock: boolean("restock").notNull().default(false),
    /** « stripe », « paypal », « manuel » (virement, espèces au salon). */
    gateway: text("gateway"),
    /** Identifiant du remboursement chez le prestataire. */
    externalRef: text("external_ref"),
    author: text("author"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("refund_order_idx").on(t.orderId)],
);

/** Lignes d'un remboursement. */
export const refundItems = pgTable(
  "refund_item",
  {
    id: serial("id").primaryKey(),
    refundId: integer("refund_id")
      .notNull()
      .references(() => refunds.id, { onDelete: "cascade" }),
    orderItemId: integer("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull().default(1),
    amountCents: integer("amount_cents").notNull().default(0),
  },
  (t) => [index("refund_item_refund_idx").on(t.refundId)],
);

/**
 * GRAND LIVRE des mouvements d'argent — en écriture seule.
 *
 * Rien n'y est jamais modifié ni supprimé : une erreur se corrige en ajoutant
 * un mouvement contraire, comme en comptabilité. Le solde d'une commande est
 * toujours la somme de ses lignes, ce qui rend impossible l'écart entre « ce
 * que dit la fiche » et « ce qui s'est passé à la banque ».
 *
 * `kind` : sale (encaissement) · authorization (empreinte) · capture ·
 * refund (remboursement) · void (annulation d'une empreinte).
 * `amountCents` est toujours POSITIF ; c'est `kind` qui donne le sens.
 */
export const orderTransactions = pgTable(
  "order_transaction",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** « success », « pending » ou « failure ». */
    status: text("status").notNull().default("success"),
    amountCents: integer("amount_cents").notNull().default(0),
    gateway: text("gateway"),
    externalRef: text("external_ref"),
    /** Mouvement dont celui-ci découle (un remboursement suit une vente). */
    parentId: integer("parent_id"),
    message: text("message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("order_transaction_order_idx").on(t.orderId, t.createdAt)],
);

export const payments = pgTable("payment", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  provider: paymentProviderEnum("provider").notNull(), // WEB uniquement (§11)
  externalRef: text("external_ref"),
  /**
   * L'identifiant de l'encaissement chez le prestataire, quand il diffère de
   * `externalRef`.
   *
   * PayPal en a besoin : il ne rembourse pas une COMMANDE mais une CAPTURE,
   * et ce sont deux identifiants différents. Sans celui-ci, un remboursement
   * PayPal n'aurait aucun moyen de partir, et l'argent resterait chez nous
   * pendant que la boutique noterait qu'il est rendu.
   */
  captureRef: text("capture_ref"),
  status: text("status"),
  amountCents: integer("amount_cents").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Le compteur des numéros de facture, une ligne par année.
 *
 * Pourquoi une table et pas une séquence Postgres : une séquence AVANCE même
 * quand la transaction qui l'a lue échoue. Elle laisserait donc des trous, et
 * un trou dans une suite de factures est exactement ce que la loi interdit
 * (art. 242 nonies A de l'annexe II au CGI). Ici le compteur est une ligne
 * verrouillée puis incrémentée DANS la même transaction que l'écriture du
 * numéro sur la commande : si quoi que ce soit échoue, les deux reviennent en
 * arrière ensemble et le numéro reste libre pour la facture suivante.
 *
 * Une ligne par année parce que la suite repart à 1 le 1er janvier — c'est la
 * pratique française courante, et elle est admise tant que la numérotation
 * reste chronologique et continue à l'intérieur de la série.
 */
export const factureCompteur = pgTable("facture_compteur", {
  /** L'année civile de la série : 2026, 2027… */
  annee: integer("annee").primaryKey(),
  /** Le dernier numéro attribué dans cette année. 0 = aucune facture encore. */
  dernierNumero: integer("dernier_numero").notNull().default(0),
  majLe: timestamp("maj_le", { withTimezone: true }).defaultNow().notNull(),
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

/**
 * Inscrits à la lettre d'information — le formulaire du bas de l'accueil.
 *
 * Une adresse ne s'inscrit qu'une fois (index unique) : réenvoyer le
 * formulaire ne crée pas de doublon et n'a pas à être signalé comme une
 * erreur au visiteur.
 */
export const newsletterSubscribers = pgTable(
  "newsletter_subscriber",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    /** Langue du site au moment de l'inscription, pour écrire dans la sienne. */
    langue: text("langue"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex("newsletter_subscriber_email_uniq").on(t.email)],
);

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

// --- Lettre d'information : ce que la boutique écrit et envoie ------------

/**
 * Une lettre d'information, de son brouillon à son envoi.
 *
 * Le nombre de destinataires et celui des envois réussis sont FIGÉS ici au
 * moment de l'envoi, au lieu d'être recomptés à l'affichage. La liste bouge
 * tous les jours : recomptée un mois plus tard, elle raconterait l'envoi
 * d'aujourd'hui avec les inscrits de demain.
 */
export const lettres = pgTable("lettre", {
  id: serial("id").primaryKey(),
  /** Nom interne, pour s'y retrouver dans la liste. Jamais envoyé. */
  titre: text("titre").notNull(),
  /** L'objet du courrier, celui que le destinataire voit dans sa boîte. */
  objet: text("objet").notNull(),
  contenuHtml: text("contenu_html").notNull().default(""),
  /**
   * « brouillon », « en_cours » ou « envoyee ».
   *
   * L'état intermédiaire n'est pas décoratif : l'envoi part par paquets et
   * dure plusieurs requêtes. Sans lui, une lettre à moitié partie resterait
   * un brouillon, donc modifiable et supprimable pendant que le reste part.
   */
  etat: text("etat").notNull().default("brouillon"),
  envoyeeLe: timestamp("envoyee_le", { withTimezone: true }),
  /** Personnes visées au lancement, avant le premier paquet. */
  destinatairesPrevus: integer("destinataires_prevus").notNull().default(0),
  envoisReussis: integer("envois_reussis").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Une ligne par destinataire et par lettre : qui a reçu quoi, et quand.
 *
 * L'index unique (lettre, adresse) est la seule chose qui empêche vraiment
 * d'écrire deux fois à la même personne. Un envoi interrompu se reprend en
 * sautant les lignes déjà posées ; sans cette table, reprendre voudrait dire
 * tout renvoyer, y compris à ceux qui ont déjà lu la lettre.
 */
export const lettreEnvois = pgTable(
  "lettre_envoi",
  {
    id: serial("id").primaryKey(),
    lettreId: integer("lettre_id")
      .notNull()
      .references(() => lettres.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    /**
     * « en_attente », « en_cours », « reussi » ou « echec ».
     *
     * La liste entière est posée en attente au lancement, puis chaque paquet
     * prend ses lignes en passant par « en_cours ». Une ligne restée dans cet
     * état est un envoi coupé en plein vol : elle compte pour un échec et
     * n'est PAS reprise. Rater un courrier se rattrape ; en envoyer deux, non.
     */
    resultat: text("resultat").notNull().default("en_attente"),
    envoyeLe: timestamp("envoye_le", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("lettre_envoi_lettre_email_uniq").on(t.lettreId, t.email)],
);

/**
 * Le jeton de désabonnement d'une adresse.
 *
 * Il est tiré au sort, propre à la personne, et ne sert qu'à la sortir de la
 * liste : il n'ouvre aucune session et ne dit rien d'elle. Une adresse garde
 * le même jeton d'une lettre à l'autre, sinon les liens des lettres déjà
 * parties cesseraient de fonctionner au premier envoi suivant.
 */
export const lettreJetons = pgTable(
  "lettre_jeton",
  {
    jeton: text("jeton").primaryKey(),
    email: text("email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    /** Renseignée dès que la personne s'est désabonnée. Trace, pas filtre. */
    desabonneLe: timestamp("desabonne_le", { withTimezone: true }),
  },
  (t) => [uniqueIndex("lettre_jeton_email_uniq").on(t.email)],
);

/**
 * Les adresses qui ne veulent plus qu'on leur rappelle leur panier.
 *
 * Une table à part, et non un drapeau sur la fiche client, pour deux raisons.
 * D'abord un refus porte sur une ADRESSE, pas sur une fiche : cette base
 * accepte plusieurs fiches pour la même adresse (l'unicité n'est imposée
 * qu'aux comptes), et un drapeau posé sur l'une laisserait les autres
 * relançables. Ensuite le refus doit survivre à la fiche : fusionner deux
 * clients ou en effacer un ne doit jamais faire repartir des courriers que
 * quelqu'un avait refusés.
 *
 * Même forme que le jeton de la lettre d'information : l'adresse garde son
 * jeton d'un courrier à l'autre, sinon les liens déjà partis cesseraient de
 * fonctionner. `refuseLe` renseigné = plus aucune relance, jamais.
 */
export const relanceRefus = pgTable(
  "relance_refus",
  {
    jeton: text("jeton").primaryKey(),
    email: text("email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    /** Renseignée dès que la personne a refusé. Trace, et filtre. */
    refuseLe: timestamp("refuse_le", { withTimezone: true }),
  },
  (t) => [uniqueIndex("relance_refus_email_uniq").on(t.email)],
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

// --- Contenu éditorial : pages et menu ------------------------------------

/**
 * Un bloc de page, tel qu'il est enregistré dans `page.blocks`.
 *
 * Cinq formes, pas une de plus. La liste est volontairement fermée : c'est
 * elle qui permet au back-office de proposer un formulaire par type plutôt
 * qu'un champ de code, et à la boutique de savoir dessiner chaque bloc sans
 * jamais rencontrer une forme qu'elle ne connaît pas.
 *
 * `produits` ne stocke que des références, jamais la liste des produits : une
 * liste figée vieillirait mal — un produit retiré de la vente continuerait de
 * s'afficher, et une nouveauté n'apparaîtrait jamais.
 */
export type BlocPage =
  | { type: "titre"; texte: string; niveau: 2 | 3 }
  | { type: "texte"; html: string }
  | { type: "image"; url: string; alt: string; legende?: string }
  | {
      type: "produits";
      source: "collection" | "categorie";
      /**
       * La première des références, recopiée telle qu'elle s'écrivait avant que
       * le bloc puisse en porter plusieurs. Elle reste renseignée pour que les
       * pages déjà enregistrées, et tout ce qui les lit encore ainsi, continuent
       * d'afficher quelque chose au lieu de rien.
       */
      reference: string;
      /**
       * Les collections à réunir dans la rangée, dans l'ordre voulu. Absente sur
       * les pages composées avant, où `reference` fait foi à elle seule.
       */
      references?: string[];
      limite: number;
    }
  | { type: "bouton"; texte: string; href: string };

/**
 * Une page écrite depuis le back-office : « Qui sommes-nous », « Magnets »,
 * « Livraison et retours ».
 *
 * Jusqu'ici, ouvrir un rayon demandait d'écrire un fichier dans la boutique et
 * une ligne dans le menu. C'est ce que cette table supprime : la propriétaire
 * compose sa page par blocs, lui donne une adresse, et la publie seule.
 *
 * Le statut suit la même règle que celui d'un produit : un brouillon se
 * prépare, il ne se visite pas. Le site public ne doit jamais en servir un,
 * même à quelqu'un qui devinerait l'adresse.
 */
export const pages = pgTable(
  "page",
  {
    id: serial("id").primaryKey(),
    /** Ce qui suit le nom de domaine. Unique dans toute la boutique. */
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    /** « active » (en ligne) ou « draft » (brouillon). */
    status: text("status").notNull().default("draft"),
    /**
     * Où la page se montre : « site », « stand », ou « les-deux ».
     *
     * La tablette du salon et la boutique n'ont pas les mêmes besoins — un mode
     * d'emploi du configurateur n'a rien à faire en ligne, et les conditions de
     * vente à distance n'ont rien à faire sur un stand. Par défaut « site » :
     * une page écrite sans y penser va là où l'on écrit d'ordinaire.
     */
    affichage: text("affichage").notNull().default("site"),
    /**
     * Ce que Google affiche. Vides, la page retombe sur son titre : un repli
     * acceptable, pas un choix éditorial.
     */
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    blocks: jsonb("blocks")
      .$type<BlocPage[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /**
     * Traductions HUMAINES, par code langue. Le français vit dans les colonnes
     * ci-dessus et sert de repli, exactement comme pour les produits : une
     * traduction absente ou vide affiche le français, jamais un blanc.
     */
    translations: jsonb("translations").$type<
      Partial<Record<string, { title?: string; blocks?: BlocPage[] }>>
    >(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex("page_slug_uniq").on(t.slug)],
);

/**
 * Une entrée du menu principal, avec ses sous-entrées.
 *
 * Un seul niveau de profondeur, et ce n'est pas une limite technique : le
 * bandeau du site déroule un sous-menu, pas deux, et une entrée cachée à trois
 * niveaux serait invisible pour tout le monde sauf pour celle qui l'a écrite.
 *
 * La suppression en cascade suit la même idée : retirer « Affiches
 * personnalisables » retire ses sous-entrées, qui n'ont aucun sens seules.
 */
export const menuItems = pgTable(
  "menu_item",
  {
    id: serial("id").primaryKey(),
    /** Null = entrée de premier niveau. */
    parentId: integer("parent_id").references((): AnyPgColumn => menuItems.id, {
      onDelete: "cascade",
    }),
    label: text("label").notNull(),
    href: text("href").notNull(),
    position: integer("position").notNull().default(0),
    /** Masquée : préparée dans le back-office, absente du site. */
    visible: boolean("visible").notNull().default(true),
    translations: jsonb("translations").$type<
      Partial<Record<string, { label?: string }>>
    >(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("menu_item_parent_idx").on(t.parentId, t.position)],
);

/**
 * Un style d'affiche IA : un titre, une consigne, et ses images de référence.
 *
 * La boutique n'avait qu'UNE consigne, écrite dans les réglages, et trois
 * images de référence lues dans un dossier du serveur que personne ne pouvait
 * voir ni changer. La cliente ne choisissait rien : elle envoyait sa photo et
 * ajoutait une phrase libre.
 *
 * Ici, chaque style est une ligne : « Couple », « Paysage », « Famille ». La
 * cliente choisit le TITRE — c'est le seul mot qu'elle voit — et la consigne
 * qui part au modèle, elle, se règle au back-office sans toucher au code.
 *
 * Les images servent DEUX FOIS, et c'est voulu : montrées à la cliente comme
 * exemples de ce qu'elle obtiendra, et envoyées au modèle comme références de
 * style. Deux jeux d'images séparés finiraient par ne plus se ressembler, et
 * c'est l'exemple montré qui deviendrait un mensonge.
 *
 * Cinq au maximum : c'est le plafond demandé, et il est tenu par l'API — un
 * tableau JSON ne sait pas se limiter tout seul.
 */
export const aiPrompts = pgTable(
  "ia_prompt",
  {
    id: serial("id").primaryKey(),
    /** Ce que la cliente lit et choisit : « Couple », « Paysage »… */
    title: text("title").notNull(),
    /**
     * La consigne envoyée au modèle, ajoutée à la consigne générale de la
     * boutique. Vide, le style ne fait qu'apporter ses images.
     */
    prompt: text("prompt").notNull().default(""),
    /** Chemins dans data/assets, cinq au plus. */
    images: jsonb("images")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    position: integer("position").notNull().default(0),
    /** Éteint : gardé au back-office, absent du site. */
    active: boolean("active").notNull().default(true),
    /** Le titre dans les autres langues ; vide, le français s'affiche. */
    translations: jsonb("translations").$type<
      Partial<Record<string, { title?: string }>>
    >(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("ia_prompt_position_idx").on(t.position, t.id)],
);
