/**
 * Schéma de données Memory Line (PostgreSQL / Drizzle).
 * Le schéma de la base, ajusté à l'export Shopify réel.
 *
 * Principes structurants :
 *  - order.channel ('web' | 'salon') NON NULL, fixé quand la commande naît
 *    (validation au stand, passage par la caisse du site), immuable ensuite (§11),
 *    à une exception : une vente du stand rouverte puis payée par la caisse du
 *    site devient « web », abandonne son SAL- (qui peut être redonné) et sa
 *    note « Stand : … » (POST /orders).
 *  - Numérotation séparée WEB-xxxx / SAL-xxxx, compteur par préfixe et non par
 *    canal (numeros-commande.ts).
 *  - order_item.config = snapshot JSON de la personnalisation (§14.3).
 *  - legacy_* : on conserve les identifiants Shopify d'origine pour la
 *    traçabilité de l'import et les redirections 301 (§13).
 */
import { sql } from "drizzle-orm";
import type {
  CouleursImage,
  CouleursProposees,
  GroupeCouleur,
  HorairesStand,
  LigneCarteCadeau,
  PosterConfig,
  RegleParier,
  RemiseAppliquee,
} from "@memoryline/types";
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
  check,
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
    /**
     * Archivée : sortie de la boutique ET des listes ordinaires du
     * back-office, restaurable depuis la section « Archivés ».
     *
     * Distinct de `active`, qui masque la collection du site tout en la
     * laissant sous les yeux : archiver, c'est la ranger. Les lignes de
     * `product_collection` restent en place — c'est ce qui permet de la
     * restaurer COMPLÈTE, avec les affiches qu'elle rangeait.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /**
     * Le nom et la description dans les autres langues :
     * { en: { name, description }, de: { … }, … }. C'est le NOM que lit la
     * cliente, en titre du rayon (« Villes » → « Cities »). Un champ absent ou
     * vide affiche le français ; le français (`name`) reste celui du
     * back-office, et l'adresse (`slug`) ne change pas avec la langue.
     */
    translations: jsonb("translations").$type<
      Partial<Record<string, { name?: string; description?: string }>>
    >(),
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
    /**
     * Archivée : sortie du site ET de la liste ordinaire du back-office,
     * restaurable depuis « Catégories archivées ».
     *
     * Distinct de `active`, qui la retire du site en la laissant sous les yeux.
     * Les produits gardent leur `category_id` : c'est ce qui permet de la
     * restaurer COMPLÈTE, avec ce qu'elle rangeait. La supprimer, à l'inverse,
     * remettait tous ses produits à zéro (`on delete set null`) sans que rien
     * ne sache les y remettre.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
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
     * Affiche « ciel étoilé » (26/11) : sur sa fiche, la photo cède la place
     * à une date, une heure et un lieu, et le fond est le ciel calculé
     * (apps/api/src/ciel.ts). Va avec `aiEnabled` : la suite — textes,
     * personnages, format, panier, impression — est celle des affiches IA.
     */
    skyEnabled: boolean("sky_enabled").notNull().default(false),
    /**
     * Consignes de style propres à CETTE affiche, ajoutées au style commun de
     * la boutique. C'est ici qu'on écrit « vue de la plage, ciel de coucher de
     * soleil, personnages de dos » — ce que la photo du client ne dit pas.
     */
    aiStylePrompt: text("ai_style_prompt"),
    /**
     * La place de l'affiche sur la page de son genre (« Affiches
     * personnalisables », « Affiches prêtes à imprimer »), réglée à la main au
     * back-office. 0 = pas encore rangée : elle passe après les rangées, par
     * nouveauté. Voir ordre-affichage.ts.
     */
    ordreAffichage: integer("ordre_affichage").default(0).notNull(),
    /**
     * La place de l'affiche sur « Toutes les affiches », la page sans filtre.
     *
     * Une colonne à part et non `ordreAffichage` : cette page mêle les deux
     * genres, et les rangs de chacun, réglés séparément, s'y marchaient
     * dessus. Même convention : 0 = pas encore rangée, l'affiche passe après
     * les rangées, par nouveauté. Tant que la boutique n'a rien rangé, la page
     * garde donc exactement l'ordre des nouveautés. Voir ordre-affichage.ts.
     */
    ordreCatalogue: integer("ordre_catalogue").default(0).notNull(),
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
     * Le jeu de motifs que la fiche propose au client (28/11, affiche éphémère
     * du stand de Mulhouse) : le slug d'un type d'affiche « motifs-… », dont
     * les personnages sont les motifs, rangés par catégorie (BO › Personnages).
     * Vide : affiche classique, sans choix de motif.
     */
    vueMotifs: text("vue_motifs"),
    /**
     * Le stand de rattachement (28/11, Alexandra : « le produit doit
     * disparaître quand le stand sera clôturé donc désactivé »). L'affiche
     * n'est proposée (site, tablette, rayons, recherche, plan du site) que
     * tant que ce stand est en service : voir affiches-de-stand.ts. Vide :
     * affiche ordinaire.
     *
     * Sans clé étrangère, exprès : un stand supprimé laisse l'affiche cachée
     * (la règle échoue fermée) au lieu de la remettre en vente, comme le
     * ferait un « on delete set null ».
     */
    standId: integer("stand_id"),
    /**
     * Traductions HUMAINES du contenu éditorial, par code langue :
     *   { en: { name, description, seoTitle, seoDescription }, de: { … }, … }
     *
     * Le français vit dans les colonnes `name` / `description` ci-dessus et
     * sert de repli : un champ vide ou absent affiche le français, jamais une
     * chaîne vide. Pas de traduction automatique — la cliente les rédige.
     *
     * Le référencement fait exception au repli : un `seoTitle` français sur
     * la page anglaise mettrait du français dans Google. Non traduit, il vaut
     * null hors du français, et le site retombe sur le nom traduit (voir
     * GET /products/:slug).
     */
    translations: jsonb("translations").$type<
      Partial<
        Record<
          string,
          {
            name?: string;
            description?: string;
            seoTitle?: string;
            seoDescription?: string;
          }
        >
      >
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
    /**
     * Une version d'un fond (BO › Atelier › Créer un fond, 20/11) : pas une
     * affiche de visiteur, mais un décor demandé par la boutique. Nul pour
     * les affiches. La ligne est là pour le coût : un fond se paie comme une
     * affiche, et doit compter dans le plafond du mois.
     */
    fondId: integer("fond_id").references((): AnyPgColumn => fondsIa.id, {
      onDelete: "set null",
    }),
    /** Le message de la discussion du fond d'où sort cette version. */
    fondMessageId: integer("fond_message_id").references((): AnyPgColumn => fondsIaMessages.id, {
      onDelete: "set null",
    }),
    /**
     * D'où vient l'affiche : « stand » (la tablette) ou « site » (27/11,
     * migration 0118). Null : inconnue (une affiche d'avant, jamais mise au
     * panier). Elle décide aussi de la limite d'essais du jour, qui ne vaut
     * que pour le site (ia.ts).
     */
    origine: text("origine"),
    /** Le stand de la tablette, quand il est connu (son code, ou le numéro de sa page). */
    standId: integer("stand_id").references((): AnyPgColumn => stands.id, {
      onDelete: "set null",
    }),
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
    /**
     * Supplément en centimes, ajouté au prix de l'affiche — UN PAR FORMAT :
     * un cadre A3 coûte plus cher qu'un cadre A4. Il n'y avait qu'un prix
     * (`price_cents`) ; la migration 0045 l'a recopié dans les deux. Le choix
     * entre les deux se fait dans `prixDuCadreCents` (@memoryline/types), et
     * nulle part ailleurs.
     */
    priceA4Cents: integer("price_a4_cents").notNull().default(0),
    priceA3Cents: integer("price_a3_cents").notNull().default(0),
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
    /**
     * Non nul = archivé : le cadre quitte le configurateur et la liste
     * ordinaire du back-office, et se range dans « Cadres archivés ».
     *
     * La ligne RESTE, et c'est indispensable : le prix est bien figé sur la
     * ligne de commande, mais le NOM du cadre, lui, se relit ici — sur la
     * fiche d'une commande passée, dans le courrier de confirmation, et
     * jusque dans le nom du fichier d'impression (configurator-routes.ts).
     * Effacer le cadre laissait donc des commandes anciennes sans cadre
     * nommé, et des fichiers d'impression qui ne disaient plus lequel poser.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /**
     * Le nom du cadre dans les autres langues — c'est sa COULEUR que le client
     * lit (« Bois naturel », « Noir »). { en: { name }, de: { … }, … } ; un
     * nom absent affiche le français, comme pour les produits. Le français
     * (`name`) reste celui du back-office, des commandes et des fichiers
     * d'impression.
     */
    translations: jsonb("translations").$type<
      Partial<Record<string, { name?: string }>>
    >(),
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
    /**
     * Archivé : retiré des listes et des sélecteurs, restaurable.
     *
     * Le `slug` reste en base, et c'est tout l'intérêt : produits, personnages
     * et pièces citent leur type PAR SON SLUG. Un type effacé les laissait
     * pointer dans le vide, et le configurateur n'avait plus rien à proposer.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
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
  /**
   * Archivé : retiré des choix du configurateur, restaurable.
   *
   * La ligne reste lisible pour l'impression — `donneesDImpression()` prend
   * TOUS les fonds, archivés compris. Une commande passée sur ce fond doit
   * pouvoir se réimprimer des mois plus tard, à l'identique.
   */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

// --- Bibliothèque configurateur ------------------------------------------

/**
 * Catégorie de personnages, gérée depuis le back-office (backlog A3).
 *
 * Remplace le texte libre `character_type.category` : on peut créer une
 * catégorie vide, la renommer, la réordonner ou la ranger sans toucher aux
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
    /**
     * Archivée : hors du configurateur et de la liste ordinaire, restaurable.
     *
     * Ses PERSONNAGES ne bougent pas : ils gardent leur `category_id` et
     * restent proposés, simplement rangés sous « sans catégorie » le temps de
     * l'archivage. C'est toute la différence avec la suppression, qui vidait
     * leur `category_id` (`on delete set null`) — la composition du rayon était
     * alors perdue, et aucune restauration ne pouvait la rendre.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /**
     * Le nom de la catégorie dans les autres langues (« Femmes » → « Women »),
     * tel que l'onglet du module de personnalisation l'affiche. Un nom absent
     * affiche le français.
     */
    translations: jsonb("translations").$type<
      Partial<Record<string, { name?: string }>>
    >(),
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
     * Le nom du personnage dans les autres langues (« Berger australien » →
     * « Australian Shepherd ») : le module de personnalisation l'affiche dans
     * la liste des personnages ajoutés et en bulle sur les vignettes.
     * { en: { name }, de: { … }, … } ; un nom absent affiche le français, qui
     * reste celui du back-office.
     */
    translations: jsonb("translations").$type<
      Partial<Record<string, { name?: string }>>
    >(),
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
     * Proposé aux clients du site ? Faux, le personnage quitte la galerie du
     * module (« Masqué » au BO) SANS être archivé : il reste dans la liste du
     * BO avec tous ses réglages, et une affiche qui le porte déjà (panier,
     * commande, réimpression) s'affiche toujours. Pour un personnage pas
     * encore prêt — dessiné nu, sans tenue par défaut (0073, 27/10/2026).
     */
    active: boolean("active").default(true).notNull(),
    /**
     * SVG complet pré-composé du personnage (ex. Male_2.svg) — viewBox 500×1000,
     * sous-groupes Base/Bottoms/Clothes/Hair/Accessories. C'est l'affichage par
     * défaut quand on ajoute ce personnage (avant tout changement de slot).
     */
    baseSvgUrl: text("base_svg_url"),
    /** Zones de couleur par défaut du SVG de base (recoloration peau/tenue). */
    baseColorZones: jsonb("base_color_zones").$type<Record<string, string>>(),
    /**
     * Groupes de couleurs du dessin de base : les nuances d'une même couleur
     * (ombres, reflets) réunies sous une seule couleur au choix du client,
     * avec le nom qu'il lit (« pelage », « robe »). Voir couleurs-groupes.ts.
     * Null = une zone par groupe, comme avant ce réglage.
     */
    baseGroupesCouleurs: jsonb("base_groupes_couleurs").$type<GroupeCouleur[]>(),
    /**
     * Zones de référence des groupes que le client peut recolorer.
     *
     * On range ici les groupes PROPOSÉS, à l'inverse des pièces (qui rangent
     * les masqués) : la règle d'un personnage a toujours été « la première
     * zone seulement » — la peau. Null garde cette règle, et un groupe apparu
     * avec un nouveau dessin reste non proposé tant que la boutique ne l'a pas
     * coché.
     */
    baseZonesProposees: jsonb("base_zones_proposees").$type<string[]>(),
    /**
     * Couleurs du dessin de base quand celui-ci est une IMAGE EN PIXELS (photo
     * ou illustration enregistrée en SVG, sans le moindre tracé) : ses familles
     * de teintes, celles que le client peut recolorer, et la carte qui dit où
     * elles se trouvent dans le dessin. Voir couleurs-image.ts.
     * Null = rien de détecté, le dessin s'affiche exactement comme son fichier.
     */
    baseCouleursImage: jsonb("base_couleurs_image").$type<CouleursImage>(),
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
     * Le décalage de CÔTÉ de ce personnage, en fraction de la largeur de
     * l'affiche : négatif vers la gauche, positif vers la droite, 0 à sa place
     * dans la rangée. Réglé à l'écran de calage, comme la hauteur et la taille.
     */
    decalageX: doublePrecision("decalage_x").default(0).notNull(),
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
    /**
     * Les couleurs proposées au client pour chaque pièce de la catégorie :
     * « toutes » (une rangée de pastilles par couleur de la pièce) ou
     * « principale » (la couleur principale seule ; les détails, comme le
     * ruban d'un chapeau, gardent la couleur du dessin).
     *
     * Une pièce qui a son propre réglage (`asset.zones_masquees` non nul)
     * garde le dernier mot. « toutes » par défaut depuis 0068 : la cliente a
     * changé d'avis le 19 octobre (« le client peut changer toutes les
     * couleurs ») après avoir demandé, en 0066, de ne proposer que la
     * principale. Sous « toutes », chaque famille de teinte de la pièce a sa
     * rangée de pastilles et ses ombres la suivent (famillesDeLaPiece, cf.
     * couleurs-groupes.ts) ; « principale » reste au choix, catégorie par
     * catégorie.
     */
    couleursProposees: text("couleurs_proposees")
      .$type<CouleursProposees>()
      .notNull()
      .default("toutes"),
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
    /**
     * Archivée : hors du configurateur et de la liste ordinaire, restaurable.
     *
     * Ses PIÈCES gardent leur `piece_category_id` et restent proposées : elles
     * reprennent simplement le nuancier de leur emplacement, comme le font
     * déjà celles d'une catégorie décochée. La supprimer, elle, effaçait ce
     * rangement (`on delete set null`) — et avec lui le nuancier écrit à la
     * main, que rien ne savait rendre.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
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
    /**
     * Zones de couleur que le client ne peut PAS changer : ["st3"]. Les petits
     * détails (ruban du chapeau, élastique des cheveux) ajoutaient chacun une
     * rangée de pastilles au configurateur, sans rien apporter.
     *
     * On range les zones MASQUÉES plutôt que les proposées : liste vide = tout
     * est proposé, et une zone apparue avec un nouveau dessin reste proposée
     * tant que la boutique ne l'a pas décochée. Une zone masquée garde sa
     * couleur par défaut (`colorZones`), à l'écran comme à l'impression, même
     * si un ancien panier en avait choisi une autre.
     *
     * NULL = la pièce n'a pas de réglage propre : elle suit celui de sa
     * catégorie (`piece_category.couleurs_proposees`). Une liste, même vide,
     * est le réglage de la pièce, et il a le dernier mot sur la catégorie.
     */
    zonesMasquees: jsonb("zones_masquees").$type<string[]>(),
    /**
     * La part du dessin que peint chaque zone, mesurée sur un petit rendu :
     * { signature, parts: { st0: 0.62, st1: 0.31, … } }. C'est elle qui
     * désigne la couleur PRINCIPALE d'une pièce (la plus étendue), quand sa
     * catégorie ne propose que celle-là.
     *
     * La signature (adresse du dessin + noms des zones) dit pour quel dessin
     * la mesure vaut : une mesure d'un autre dessin est ignorée, puis refaite
     * (cf. couleur-principale.ts). Null = pas encore mesurée.
     */
    partsDesZones: jsonb("parts_des_zones").$type<{
      signature: string;
      parts: Record<string, number>;
    }>(),
    /**
     * Groupes de couleurs : les nuances d'une même couleur (ombres, reflets)
     * réunies sous une seule rangée de pastilles, avec le nom que le client
     * lit (« ruban »). Un groupe masqué l'est par sa zone de référence, dans
     * `zonesMasquees`. Null = une zone par groupe, comme avant ce réglage.
     */
    groupesCouleurs: jsonb("groupes_couleurs").$type<GroupeCouleur[]>(),
    /**
     * Familles de couleurs de la pièce quand son dessin est une image en
     * pixels : même réglage que pour un personnage (couleurs-image.ts).
     * Null = rien de détecté, le dessin s'affiche exactement comme son fichier.
     */
    couleursImage: jsonb("couleurs_image").$type<CouleursImage>(),
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
     *
     * La liste fait foi dans `NATURES_LIVRAISON` (@memoryline/types) : c'est
     * elle que lisent le tunnel de commande et le back-office.
     */
    kind: text("kind").notNull().default("home"),
    /** Transporteur, pour les intégrations à venir (étiquettes, suivi). */
    carrier: text("carrier"),
    /**
     * Ce qu'il reste à faire AVANT de proposer ce mode — contrat à signer,
     * compte à ouvrir, ou rien. Back-office uniquement : le client ne le voit
     * jamais, contrairement à `description`. C'est à la route `/shipping` de
     * tenir cette promesse, en nommant les colonnes qu'elle publie au lieu de
     * recopier la ligne entière.
     *
     * Les modes préparés d'avance arrivent avec cette note déjà écrite. Sans
     * elle, une liste de modes décochés ne dit pas lesquels attendent une
     * signature et lesquels n'attendent qu'un prix. Elle se modifie et se vide
     * au back-office : le jour où le contrat est signé, la note n'a plus lieu
     * d'être.
     */
    notePreparation: text("note_preparation"),
    /**
     * Où retirer sa commande, pour un mode « pickup ». La boutique est
     * itinérante : l'emplacement change de salon en salon, il se modifie donc
     * au back-office, et le mode se désactive les semaines sans marché.
     */
    pickupLocation: text("pickup_location"),
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
    /**
     * Non nul = archivé : le mode quitte le tunnel de commande et la liste
     * ordinaire du back-office, et se range dans « Modes archivés ».
     *
     * La ligne RESTE, avec son `slug` : c'est lui que les commandes déjà
     * parties ont figé dans `order.shipping_method`, et c'est par lui qu'on
     * retrouve de quelle façon un colis est parti. Ses tarifs restent
     * attachés, intacts : restaurer le mode rend la grille entière.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /**
     * Ce que la cliente lit, dans les autres langues :
     * { en: { name, description, pickupLocation }, de: { … }, … }. Un champ
     * absent ou vide affiche le français.
     *
     * La commande, elle, fige le nom FRANÇAIS (`order.shipping_label`) : c'est
     * celui du back-office et des bordereaux. Les courriels et la facture
     * d'une cliente étrangère retrouvent la traduction par le `slug` du mode,
     * au moment de les écrire (`livraisonDansLaLangue`, traductions.ts).
     * `notePreparation` n'a pas de traduction : le client ne la voit jamais.
     */
    translations: jsonb("translations").$type<
      Partial<
        Record<
          string,
          { name?: string; description?: string; pickupLocation?: string }
        >
      >
    >(),
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
    /**
     * Non nul = archivée : la tranche ne facture plus rien et quitte la
     * grille, sans être détruite. Elle se relit et se restaure depuis
     * « Tranches archivées ».
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    // L'unicité ne porte QUE sur les tranches vivantes. Une tranche archivée
    // garde sa borne basse, et cette borne doit pouvoir être reprise par une
    // nouvelle grille : sans ce « where », archiver une tranche à 0 g
    // interdirait d'en reposer une à 0 g, et la grille deviendrait
    // insaisissable après le premier archivage.
    uniqueIndex("shipping_rate_uniq")
      .on(t.methodId, t.zoneId, t.minWeightGrams)
      .where(sql`${t.archivedAt} is null`),
  ],
);

/**
 * Un lieu où retirer sa commande, pour les modes « pickup » : le chalet du
 * marché de Noël de Mulhouse, l'atelier, un salon.
 *
 * Avant, les lieux proposés à la caisse étaient les STANDS ouverts. Mais un
 * stand est une tablette qui vend, pas forcément un endroit où l'on vient
 * chercher une affiche : la boutique veut gérer ses lieux de retrait à part,
 * avec une adresse et un texte libre (horaires, accès), sans ouvrir de
 * tablette pour autant. Voir lieux-retrait.ts.
 *
 * Il s'archive, ne se supprime pas : les commandes qui l'ont choisi gardent
 * de toute façon une copie de ce qu'elles ont lu (`order.pickup_point`).
 */
export const pickupPoints = pgTable(
  "pickup_point",
  {
    id: serial("id").primaryKey(),
    /** « Chalet du marché de Noël de Mulhouse » : ce que la cliente choisit. */
    nom: text("nom").notNull(),
    /** Adresse, sur plusieurs lignes. Ne se traduit pas : on l'écrit telle quelle. */
    adresse: text("adresse"),
    /** Texte libre sur plusieurs lignes : horaires, accès, quoi apporter. */
    description: text("description"),
    /**
     * Proposé à la caisse. Éteint, le lieu reste dans la liste du back-office
     * — un chalet qui ne rouvre qu'en décembre n'a pas à être recréé.
     */
    active: boolean("active").notNull().default(true),
    /** Rang à la caisse, réglé à la main au back-office. */
    position: integer("position").notNull().default(0),
    /**
     * Le nom et la description dans les autres langues :
     * { en: { nom, description }, … }. Absents ou vides, le français
     * s'affiche.
     */
    translations: jsonb("translations").$type<
      Partial<Record<string, { nom?: string; description?: string }>>
    >(),
    /**
     * Non nul = archivé : le lieu quitte la caisse et la liste ordinaire, et
     * se range dans « Lieux archivés », d'où il se restaure.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /**
     * Le stand dont ce lieu est le point de retrait (17/11), ou null pour un
     * lieu saisi dans BO › Livraison › Lieux de retrait. Le lieu d'un stand
     * se tient tout seul (lieux-retrait.ts, synchroniserLieuDuStand) : actif
     * quand le stand est ouvert, son nom et son emplacement. Il n'apparaît
     * que sous le mode « Retrait au stand », gratuit.
     */
    standId: integer("stand_id").references(() => stands.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("pickup_point_active_idx").on(t.active)],
);

/**
 * Le lieu de retrait tel que la cliente l'a lu en commandant, figé sur la
 * commande (`order.pickup_point`). Le lieu peut être renommé, déplacé ou
 * archivé depuis : la fiche, le bon et la facture disent toujours où elle
 * a été attendue.
 */
export type InstantaneLieuRetrait = {
  nom: string;
  adresse: string | null;
  description: string | null;
  /** Retrait au stand : le dernier jour pour venir, et la case cochée par la cliente. */
  retirerAvant?: string;
  retraitCompris?: boolean;
  translations?: Partial<Record<string, { nom?: string; description?: string }>>;
};

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
    /**
     * La langue de ses courriels — « fr », « en », « de », « it », « es » —,
     * CHOISIE par le client : celle de la page où il s'inscrit, puis celle
     * qu'il règle lui-même dans « Mes informations ». Rien d'autre ne la
     * change : ni la page d'où il commande, ni celle où il remplit un panier.
     *
     * Null pour les fiches d'avant, et pour les visiteurs sans compte : le
     * courrier prend alors la langue de la commande, et le français à défaut
     * (voir `langueDuDestinataire`, apps/api/src/courriels/index.ts).
     */
    langue: text("langue"),
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
     * Où trouver le stand, en texte libre : une adresse, une place, « allée B,
     * chalet 12 »… (17/11). La caisse du site le montre sous « Retrait au
     * stand », pour que la cliente sache où venir chercher son affiche.
     */
    emplacement: text("emplacement"),
    /**
     * Le calendrier du stand (17/11) : premier et dernier jour (« AAAA-MM-JJ »,
     * à Paris), l'horaire de base et les jours qui s'en écartent ou sont
     * fermés (packages/types/src/stand-horaires.ts).
     */
    dateDebut: text("date_debut"),
    dateFin: text("date_fin"),
    horaires: jsonb("horaires").$type<HorairesStand>(),
    /**
     * Qui décide de l'ouverture : « manuel » (le bouton, et lui seul — fermé à
     * la main, le stand le reste quoi que disent les horaires) ou
     * « calendrier » (`ouvert` suit les jours de marché, tenu à jour chaque
     * minute par stands-calendrier.ts).
     */
    pilotage: text("pilotage").notNull().default("manuel"),
    /**
     * Proposé au « Retrait au stand » sur le site (17/11) : « Activé /
     * Désactivé », à part d'ouvert/fermé, qui dit seulement si la tablette
     * vend. Un stand fermé reste proposé tant qu'il est activé.
     */
    actif: boolean("actif").notNull().default(true),
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
    /**
     * Non nul = archivé : le stand quitte la liste ordinaire et se range dans
     * « Stands archivés ». Il est toujours fermé — l'archivage le ferme —,
     * donc sa tablette n'accepte plus rien.
     *
     * La ligne RESTE, et son code avec elle : les ventes du salon pointent
     * ici par `order.stand_id`, et c'est la seule chose qui sache encore dire
     * où elles ont été faites. Le code garde sa place pour qu'aucun nouveau
     * stand ne le reprenne et n'hérite des ventes d'un autre.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /**
     * La page que la tablette du stand affiche, et elle seule (18/11,
     * Alexandra : « il faut qu'un stand ait une page attribuée et une
     * seule »). En mode stand, l'accueil y mène et toute adresse hors d'elle
     * y ramène ; restent la fiche de ses affiches, le panier et la
     * validation de la vente (packages/types, tablette-stand.ts). Null : la
     * tablette montre tout le catalogue, comme avant. Choisie dans BO ›
     * Ventes stand ; une page supprimée libère le stand (« set null »).
     */
    pageId: integer("page_id").references((): AnyPgColumn => pages.id, {
      onDelete: "set null",
    }),
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
    /* --- Carte vendue sur le site (17/11) ------------------------------- */
    /**
     * La commande qui a ACHETÉ cette carte, quand elle a été vendue en ligne.
     * Null pour une carte vendue au back-office. « set null » : la carte est
     * une dette, elle survit à tout ce qui arriverait à la commande.
     */
    orderId: integer("order_id").references((): AnyPgColumn => orders.id, {
      onDelete: "set null",
    }),
    /**
     * La ligne de cette commande : une ligne donne UNE carte, jamais deux
     * (index unique ci-dessous), même si le paiement est confirmé deux fois.
     */
    orderItemId: integer("order_item_id").references((): AnyPgColumn => orderItems.id, {
      onDelete: "set null",
    }),
    /** À qui la carte a été envoyée par e-mail, et son prénom s'il a été donné. */
    recipientEmail: text("recipient_email"),
    recipientName: text("recipient_name"),
    /** Le petit mot de l'acheteuse, repris dans le courriel. */
    message: text("message"),
    /** Quand le courriel du destinataire est parti. Null = pas encore. */
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("gift_card_code_uniq").on(t.code),
    // La saisie se compare sans tirets (cleDeCarte) : deux codes ne doivent
    // pas se confondre une fois leurs tirets retirés.
    uniqueIndex("gift_card_cle_uniq").on(sql`replace(${t.code}, '-', '')`),
    uniqueIndex("gift_card_order_item_uniq")
      .on(t.orderItemId)
      .where(sql`${t.orderItemId} is not null`),
    index("gift_card_order_idx").on(t.orderId),
  ],
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
    channel: orderChannelEnum("channel").notNull(), // immuable une fois née (§11), sauf stand → site (voir l'en-tête)
    number: text("number").notNull(), // 'WEB-1042' / 'SAL-0087'
    clientOrderId: text("client_order_id"),
    /**
     * Code promo saisi au panier, tel qu'il a été validé. Gardé sur la
     * commande : c'est ce qui explique l'écart entre la somme des lignes et
     * le montant encaissé, des mois plus tard.
     */
    promoCode: text("promo_code"),
    /**
     * Les promotions telles qu'elles étaient au passage en caisse : les règles
     * en jeu (code compris), la remise accordée par chacune, et les codes
     * saisis.
     *
     * Le paiement arrive APRÈS la caisse, parfois des minutes plus tard, et
     * la boutique peut modifier ou archiver une promotion entre-temps. Sans
     * cette copie, le contrôle de l'encaissement recalculait avec les règles
     * du moment et refusait une commande honnête ; la page Finances, elle,
     * jugeait les ventes passées avec les règles d'aujourd'hui.
     *
     * Null pour les commandes d'avant : on retombe sur les règles en vigueur,
     * comme avant.
     */
    promotions: jsonb("promotions").$type<{
      regles: RegleParier[];
      detail: RemiseAppliquee[];
      codes: string[];
    }>(),
    /* --- Livraison ------------------------------------------------------- */
    /** Mode choisi (slug), figé sur la commande : le catalogue peut changer. */
    shippingMethod: text("shipping_method"),
    /** Nom du mode tel qu'il s'appelait le jour de la commande. */
    shippingLabel: text("shipping_label"),
    /**
     * Sa description le même jour (« livré le lendemain avant 13 h ») : la
     * cliente l'a lue avant de payer, c'est la promesse que le bordereau doit
     * tenir, même si le mode est réécrit depuis.
     */
    shippingDescription: text("shipping_description"),
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
    /**
     * Adresse de FACTURATION (18/11) : l'adresse par défaut du carnet de la
     * cliente au moment de commander, figée ici comme celle de livraison. La
     * facture la porte dans « Facturé à ». Vide (commandes d'avant, retrait
     * sans carnet) : la facture reprend l'adresse de livraison, comme avant.
     */
    billingName: text("billing_name"),
    billingLine1: text("billing_line1"),
    billingLine2: text("billing_line2"),
    billingPostalCode: text("billing_postal_code"),
    billingCity: text("billing_city"),
    billingCountry: text("billing_country"),
    /** Point relais choisi (identifiant Mondial Relay et libellé lisible). */
    relayPointId: text("relay_point_id"),
    relayPointLabel: text("relay_point_label"), // idempotence envoi salon (§17.2)
    /**
     * Le lieu de retrait choisi, pour un mode « pickup ».
     *
     * « set null » : le lieu s'archive et ne se supprime pas, mais si une
     * ligne disparaissait un jour, la commande ne doit pas partir avec elle —
     * l'instantané ci-dessous suffit à dire où elle était attendue.
     *
     * Null pour les commandes d'avant les lieux : leur retrait se lit dans
     * `relayPointLabel` (« stand:<id> »), qu'on ne réécrit pas.
     */
    pickupPointId: integer("pickup_point_id").references(() => pickupPoints.id, {
      onDelete: "set null",
    }),
    /**
     * Le lieu tel que la cliente l'a lu en commandant (nom, adresse, texte,
     * traductions). C'est lui qu'affichent la fiche, le bon, les courriels et
     * la facture : renommer ou déplacer le lieu ensuite ne change pas une
     * commande déjà passée.
     */
    pickupPoint: jsonb("pickup_point").$type<InstantaneLieuRetrait>(),
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
     * Ce panier se remplit sur la tablette du stand.
     *
     * Un panier du stand naît sur le canal « web », comme tous les paniers :
     * il ne devient une vente « salon » qu'au moment où la vendeuse la valide
     * (salon.ts). Jusque-là rien ne le distinguait d'un panier du site, et
     * chaque client reparti du stand sans commander gonflait les paniers
     * abandonnés EN LIGNE des statistiques.
     *
     * Suit le mode de la dernière modification du panier (ajout, changement,
     * retrait d'une affiche) et retombe à faux au passage par la caisse du
     * site. Ce n'est qu'un repère de comptage : le cookie du stand qui le pose
     * ne donne aucun droit (voir cadres.ts).
     */
    panierDuStand: boolean("panier_du_stand").notNull().default(false),
    /**
     * La langue de la page où ce panier a été rempli, puis passé en caisse.
     *
     * C'est ce qui permet d'écrire à quelqu'un dans sa langue quand on ne sait
     * rien d'autre de lui — la relance d'un panier, la confirmation d'une
     * commande dont la fiche n'a pas de langue choisie. Elle ne passe
     * qu'APRÈS celle du compte, et ne la modifie jamais : la page d'où l'on
     * commande est un constat, la langue du compte est un choix.
     *
     * Null : rien de connu, ou une vente du stand, qui reste en français.
     */
    langue: text("langue"),
    /**
     * Part du total réglée par une carte cadeau, en centimes.
     *
     * Gardée sur la commande et pas seulement dans le journal de la carte :
     * c'est ce qui explique, des mois plus tard, pourquoi le prestataire de
     * paiement n'a encaissé que la différence.
     */
    giftCardCents: integer("gift_card_cents").notNull().default(0),
    /**
     * La carte cadeau retenue à la caisse pour payer `giftCardCents`.
     *
     * Posée au passage en caisse, DÉBITÉE seulement quand la commande est
     * payée (markOrderPaid) : une commande abandonnée ne dépense rien. Le
     * débit lui-même s'écrit au journal de la carte, qui fait foi.
     */
    giftCardId: integer("gift_card_id").references((): AnyPgColumn => giftCards.id, {
      onDelete: "set null",
    }),
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
     * Les étapes de traitement que les expéditions ne disent pas (17/11,
     * packages/types/src/traitement.ts). `readyAt` : un retrait « Prête à
     * retirer », rien n'est encore parti. `deliveredAt` : un colis envoyé
     * est « Livré » (posé à la main au BO). Null = pas à cette étape.
     */
    readyAt: timestamp("ready_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
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
     * L'émetteur imprimé sur la facture — adresse de la boutique, SIRET,
     * mention complémentaire —, figé dans la même transaction que le numéro.
     *
     * La facture se refabrique à chaque téléchargement. Sans cette copie, elle
     * prenait les réglages DU MOMENT : un déménagement aurait changé
     * l'adresse de toutes les factures déjà émises, ce qu'une facture ne doit
     * jamais faire.
     *
     * Null pour les factures d'avant : elles retombent sur les réglages du
     * moment, comme avant (voir facturation.ts).
     */
    invoiceIssuer: jsonb("invoice_issuer").$type<{
      adresse: string[];
      siret: string | null;
      mention: string | null;
    }>(),
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
     * Combien de relances sont parties pour ce panier : la 1re, la 2e, la 3e.
     *
     * La boutique peut désormais programmer jusqu'à trois relances, et la date
     * seule ne dit plus à laquelle on en est. `reminderSentAt` reste la date
     * de la DERNIÈRE, et le drapeau « relancé au moins une fois ».
     *
     * Les paniers relancés avant cette colonne y portent 0 avec une date :
     * le code les lit comme « une relance partie » (voir `nombreDeRelances`
     * dans relance-panier.ts) plutôt que de réécrire l'historique.
     */
    reminderCount: integer("reminder_count").notNull().default(0),
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
    /**
     * Non nul = archivée : la commande quitte la liste ordinaire et l'export,
     * et se range dans « Commandes archivées », d'où elle se restaure. Sa
     * fiche reste lisible par son adresse. La RECHERCHE, elle, continue de la
     * rendre, marquée « Archivée » : c'est par là qu'on la retrouve pour la
     * relire ou la restaurer, puisqu'elle n'est plus dans la liste.
     *
     * C'est ce qui a remplacé la suppression : une vente effacée emportait en
     * cascade ses lignes, ses expéditions, ses remboursements et ses
     * mouvements d'argent, et laissait un trou dans la numérotation que rien
     * ne pouvait expliquer.
     *
     * À ne pas confondre avec l'annulation. Archiver RANGE, cela ne touche ni
     * au statut, ni à l'argent, ni au stock, et ne prévient personne : une
     * vente archivée qui compte dans le chiffre d'affaires continue d'y
     * compter (voir HORS_VENTES dans statuts-vente.ts). Pour qu'elle cesse de
     * compter, c'est l'annulation qu'il faut, et elle existe déjà.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
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
  /**
   * La part de `unitPriceCents` due au cadre, en centimes.
   *
   * Une promotion peut offrir une affiche « cadre non compris » : il faut
   * alors savoir ce que vaut l'affiche seule, et le prix unitaire mêle les
   * deux. Écrite à l'ajout et à la modification de la ligne.
   *
   * Null pour les lignes d'avant : le serveur prend le prix actuel du cadre,
   * borné au prix unitaire. Une commande déjà passée ne change pas pour
   * autant : ses montants sont figés.
   */
  frameCents: integer("frame_cents"),
  quantity: integer("quantity").notNull().default(1),
  /**
   * Non nul : la ligne est une CARTE CADEAU achetée sur le site, et non une
   * affiche. Son montant (libre, 10 à 300 €, vérifié par le serveur) est
   * aussi son prix unitaire ; le destinataire se remplit à la caisse.
   *
   * Une telle ligne n'a ni configuration, ni format, ni cadre, ni port, ni
   * fichier d'impression, et les promotions ne la touchent pas. Sa carte
   * naît au paiement (gift_card.order_item_id).
   */
  giftCard: jsonb("gift_card").$type<LigneCarteCadeau>(),
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
 * Un BORDEREAU transporteur acheté chez SendCloud depuis la fiche commande.
 *
 * La ligne naît AVANT l'appel à SendCloud (« en_cours »), avec la clé de la
 * demande : un double-clic, un F5 ou une panne au mauvais moment retombent
 * sur cette ligne au lieu d'acheter une seconde étiquette. Elle devient
 * « achete » avec le colis SendCloud, ou « echec » avec le refus en clair.
 *
 * L'étiquette elle-même n'est pas gardée : elle contient l'adresse d'une
 * cliente, et SendCloud la redonne à la demande par `parcelId`.
 */
export const bordereaux = pgTable(
  "bordereau",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /** La clé tirée par le formulaire : une demande = un achat au plus. */
    cleDemande: text("cle_demande").notNull(),
    /** « en_cours », « achete », « echec » ou « annule ». */
    statut: text("statut").notNull().default("en_cours"),
    /** Vrai pour une « lettre non affranchie » d'essai, que SendCloud ne facture pas. */
    essai: boolean("essai").notNull().default(false),
    /** Code de l'option d'envoi chez SendCloud (« mondial_relay:service_point,… »). */
    methodeCode: text("methode_code").notNull(),
    methodeNom: text("methode_nom").notNull(),
    /** Code SendCloud du transporteur (« mondial_relay »). */
    transporteur: text("transporteur"),
    poidsGrammes: integer("poids_grammes").notNull(),
    /** Le prix affiché sur le bouton au moment du clic. */
    prixAnnonceCents: integer("prix_annonce_cents"),
    /** L'ENVOI chez SendCloud : c'est lui qu'on annule. */
    shipmentId: text("shipment_id"),
    /** Le COLIS chez SendCloud : c'est lui qui porte l'étiquette. */
    parcelId: integer("parcel_id"),
    trackingNumber: text("tracking_number"),
    trackingUrl: text("tracking_url"),
    /** Le refus de SendCloud, en clair, pour le relire. Jamais une clé. */
    erreur: text("erreur"),
    auteur: text("auteur"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    acheteAt: timestamp("achete_at", { withTimezone: true }),
    annuleAt: timestamp("annule_at", { withTimezone: true }),
  },
  (t) => [
    index("bordereau_order_idx").on(t.orderId),
    uniqueIndex("bordereau_cle_demande_uniq").on(t.cleDemande),
    // UN SEUL bordereau vivant par commande : la base elle-même refuse le
    // second achat, quoi qu'il arrive dans le code au-dessus.
    uniqueIndex("bordereau_vivant_uniq")
      .on(t.orderId)
      .where(sql`${t.statut} in ('en_cours', 'achete')`),
  ],
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
  /**
   * « test » ou « live » : les clés avec lesquelles ce paiement a été ouvert.
   *
   * Depuis que la boutique passe de l'essai au réel d'un clic (BO › Réglages
   * › Paiements), un paiement ouvert la veille peut survivre aux clés qui
   * l'ont créé. Le confirmer, le capturer ou le rembourser avec les clés de
   * l'AUTRE mode échouerait : Stripe et PayPal ne connaissent un paiement que
   * dans le mode où il est né. Vide pour les lignes d'avant : elles ont toutes
   * été faites avec les clés du .env, dont le mode se déduit encore
   * (paiements-reglages.ts, modeDuPaiement).
   */
  mode: text("mode"),
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
    /**
     * Non nul = archivé : le compte ne peut plus se connecter et quitte la
     * liste ordinaire, sans disparaître. Il se restaure depuis « Comptes
     * archivés », et retrouve alors son adresse et son rôle.
     *
     * La ligne RESTE parce que l'historique la cite : les journaux des
     * commandes gardent le nom de qui a expédié, remboursé ou annulé, et un
     * compte effacé rendait ces lignes anonymes.
     *
     * Ses sessions, elles, sont bel et bien fermées à l'archivage : une
     * session n'est pas un souvenir, c'est une porte ouverte, et c'est la
     * seule suppression que cette table s'autorise.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /**
     * Les stands confiés à un compte vendeur : il ne voit que leurs ventes
     * (liste, fiche, fichiers d'impression, statistiques). Voir vendeurs.ts.
     *
     * Vide = il ne voit AUCUNE vente. C'est le refus par défaut : un vendeur
     * qu'on a oublié de rattacher ne doit pas lire les commandes de tous les
     * marchés de Noël, adresses comprises. Ignoré pour la propriétaire, qui
     * voit tout.
     *
     * Un tableau d'identifiants plutôt qu'une table de liaison : retirer un
     * stand à un vendeur réécrit la liste au lieu d'effacer des lignes, et les
     * stands eux-mêmes ne se suppriment jamais (ils s'archivent).
     */
    standIds: jsonb("stand_ids")
      .$type<number[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
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
    /**
     * Non nul = archivée : la redirection ne s'applique plus, sans être
     * détruite.
     *
     * Changer l'adresse d'une affiche pose une 301 de l'ancienne vers la
     * nouvelle ; la changer encore remplace des redirections existantes (pour
     * garder un seul saut, ou pour qu'une vieille redirection ne détourne pas
     * une fiche revenue à son ancienne adresse). Celles qu'on remplace
     * s'archivent : on sait toujours d'où venait un lien, et quand il a cessé
     * de servir.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    // L'unicité ne porte QUE sur les redirections vivantes : une adresse dont
    // la redirection a été archivée doit pouvoir en recevoir une nouvelle,
    // sinon le premier remplacement bloquerait l'adresse pour toujours.
    uniqueIndex("redirect_from_uniq")
      .on(t.fromPath)
      .where(sql`${t.archivedAt} is null`),
  ],
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
  /**
   * Non nul = archivée : la lettre quitte la liste ordinaire et se range dans
   * « Lettres archivées », d'où elle se restaure.
   *
   * Une lettre PARTIE ne s'effaçait déjà pas, et c'était la bonne règle : ses
   * `lettre_envoi` disent qui l'a reçue, et cette liste est ce qui empêche
   * d'écrire deux fois à la même personne. L'archivage étend la règle au
   * brouillon, qui était, lui, réellement détruit.
   */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
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
    /**
     * Le nom de la promotion dans les autres langues — c'est lui qui s'écrit
     * sur la ligne de remise du panier et de la caisse (« 3 achetées = 1 A4
     * offerte »). { en: { name }, … } ; absent, le français s'affiche. Le
     * CODE, lui, ne se traduit pas : c'est ce que la cliente tape.
     */
    translations: jsonb("translations").$type<
      Partial<Record<string, { name?: string }>>
    >(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    /**
     * Non nul = archivée : la promotion ne s'applique plus nulle part et se
     * range dans « Promotions archivées », d'où elle se restaure.
     *
     * Plus fort que « désactivée » : une promotion désactivée reste dans la
     * liste, prête à resservir ; une archivée en sort. La ligne RESTE dans
     * les deux cas, car les commandes passées citent son nom et sa remise.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [index("promo_active_idx").on(t.active)],
);

/**
 * Un message du bandeau d'annonce, en haut du site, piloté depuis le BO.
 *
 * Le bandeau est une LISTE de messages qui défilent (texte, bouton
 * facultatif), rangés à la main, chacun actif ou non, avec sa période
 * d'affichage. Il n'est plus lié aux promotions : la boutique règle ses
 * offres dans « Promotions » et écrit ses messages ici, sans que modifier
 * l'un touche à l'autre (voir bandeau.ts).
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
    /**
     * Historique, plus lu : le bandeau n'est plus lié aux promotions. La
     * colonne reste, avec ce qu'elle contient, pour ne rien effacer de ce qui
     * a été réglé avant.
     */
    promoRuleId: integer("promo_rule_id").references(() => promoRules.id, {
      onDelete: "set null",
    }),
    /**
     * Rang du message dans le défilement, réglé à la main. À égalité (0 pour
     * les messages d'avant), l'ordre de création départage : le bandeau
     * existant reste premier.
     */
    position: integer("position").notNull().default(0),
    /**
     * Non nul = archivé : le message quitte le site et la liste ordinaire, et
     * se range dans « Messages archivés », d'où il se restaure.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    /**
     * Le message et le texte du lien dans les autres langues :
     * { en: { message, linkLabel }, … }. Absents ou vides, le français
     * s'affiche. L'adresse du lien ne se traduit pas : le site y ajoute
     * lui-même le préfixe de la langue quand elle mène à une de ses pages.
     */
    translations: jsonb("translations").$type<
      Partial<Record<string, { message?: string; linkLabel?: string }>>
    >(),
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
      /**
       * « affiches » (18/11) : des affiches choisies UNE À UNE dans l'éditeur
       * de la page, dans l'ordre voulu — `references` porte alors leurs
       * numéros. C'est la page d'un stand (« une page qu'on aura créée qui
       * contiendra les affiches que l'on veut »). Une affiche retirée de la
       * vente ne s'y montre plus ; une nouveauté n'y entre que si on l'y met.
       */
      source: "collection" | "categorie" | "affiches";
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
       * « affiches » : les numéros des affiches, dans l'ordre de la page.
       */
      references?: string[];
      limite: number;
      /**
       * « affiches » rangées PAR COLLECTION : une section par collection
       * (son adresse), dans l'ordre voulu, chacune avec ses affiches dans
       * l'ordre voulu. `references` en est la mise bout à bout. Absent : une
       * seule liste.
       */
      sections?: { collection: string; affiches: string[] }[];
      /** Avec des sections : le nom de chaque collection au-dessus de la sienne. */
      titresSections?: boolean;
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
    /**
     * Le rang de la page, réglé à la main dans « Pages du site ».
     *
     * C'est l'ordre de toutes les listes de pages : celle du back-office, la
     * tablette du stand, le choix d'une page dans le menu. Zéro = pas encore
     * rangée : les pages rangées passent devant, les autres suivent par titre,
     * comme avant que l'ordre existe.
     */
    position: integer("position").notNull().default(0),
    blocks: jsonb("blocks")
      .$type<BlocPage[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /**
     * Traductions HUMAINES, par code langue. Le français vit dans les colonnes
     * ci-dessus et sert de repli, exactement comme pour les produits : une
     * traduction absente ou vide affiche le français, jamais un blanc.
     *
     * Même exception que pour les produits : un référencement (`seoTitle`,
     * `seoDescription`) non traduit vaut null hors du français, et le site
     * retombe sur le titre traduit plutôt que de servir du français à Google.
     */
    translations: jsonb("translations").$type<
      Partial<
        Record<
          string,
          {
            title?: string;
            blocks?: BlocPage[];
            seoTitle?: string;
            seoDescription?: string;
          }
        >
      >
    >(),
    /**
     * Archivée : hors du site, hors de la liste ordinaire du back-office,
     * restaurable depuis la section « Archivées ».
     *
     * Son adresse reste RÉSERVÉE — l'index unique porte sur toutes les pages.
     * C'est voulu : deux pages « magnets », dont une rangée, se disputeraient
     * la même adresse le jour où l'on restaure la première.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
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
 * Les deux menus du site : « haut », le bandeau en tête de chaque page, et
 * « pied », les colonnes de liens du pied de page (17/11).
 */
export type EmplacementMenu = "haut" | "pied";

/**
 * Une entrée du menu principal, avec ses sous-entrées.
 *
 * Un seul niveau de profondeur, et ce n'est pas une limite technique : le
 * bandeau du site déroule un sous-menu, pas deux, et une entrée cachée à trois
 * niveaux serait invisible pour tout le monde sauf pour celle qui l'a écrite.
 *
 * Retirer une entrée du menu l'ARCHIVE, sous-entrées comprises : « Affiches
 * personnalisables » sans ses sous-entrées n'aurait aucun sens. La cascade de
 * la clé étrangère ne joue donc plus — plus rien ne s'efface ici.
 *
 * La même table porte le pied de page (`emplacement` = « pied ») : une
 * entrée de premier niveau y est une colonne, son libellé en est le titre,
 * et ses sous-entrées en sont les liens.
 */
export const menuItems = pgTable(
  "menu_item",
  {
    id: serial("id").primaryKey(),
    /**
     * Le menu de la ligne : « haut » ou « pied ». Chaque menu s'enregistre
     * seul (cms.ts) : enregistrer l'un ne touche jamais une ligne de l'autre.
     * Une sous-entrée est toujours dans le menu de son parent.
     */
    emplacement: text("emplacement").$type<EmplacementMenu>().notNull().default("haut"),
    /** Null = entrée de premier niveau. */
    parentId: integer("parent_id").references((): AnyPgColumn => menuItems.id, {
      onDelete: "cascade",
    }),
    label: text("label").notNull(),
    /**
     * Vide seulement pour le titre d'une colonne du pied de page : il nomme
     * la colonne, ce sont ses liens qui mènent quelque part.
     */
    href: text("href").notNull(),
    position: integer("position").notNull().default(0),
    /** Masquée : préparée dans le back-office, absente du site. */
    visible: boolean("visible").notNull().default(true),
    /**
     * Archivée : retirée du menu, gardée dans « Liens retirés du menu ».
     *
     * Une entrée retirée de l'arbre n'est plus effacée : on la range ici, avec
     * son libellé, son adresse et ses traductions, et « Restaurer » la remet
     * dans le menu telle quelle.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    translations: jsonb("translations").$type<
      Partial<Record<string, { label?: string }>>
    >(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("menu_item_parent_idx").on(t.parentId, t.position),
    // Une autre valeur ferait une ligne qu'aucun des deux menus ne montre.
    check("menu_item_emplacement_check", sql`${t.emplacement} in ('haut', 'pied')`),
  ],
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
    /**
     * Archivé : hors du site ET de la liste ordinaire, restaurable depuis
     * « Styles archivés ».
     *
     * Distinct de `active`, qui l'éteint en le laissant sous les yeux. La
     * ligne reste : elle garde son titre, sa consigne — la recette de la
     * boutique, réécrite essai après essai — et ses images, que rien d'autre
     * ne conserve. Restaurer redonne le style entier, pas son squelette.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
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

/**
 * Une photo qui voyage du téléphone du client à la tablette du stand, ou,
 * depuis le 21/11, à la page du site où il crée son affiche
 * (apps/api/src/ia-relais.ts).
 *
 * Au marché de Noël, la photo à mettre en affiche est dans le téléphone du
 * client, pas dans la tablette. La tablette affiche un code — QR et adresse
 * courte —, le téléphone y envoie la photo, la tablette la récupère.
 *
 * EN BASE et non en mémoire : l'API redémarre à chaque mise en ligne (et à
 * chaque modification en développement). Un relais tenu dans une variable
 * disparaîtrait alors entre le moment où la tablette montre le code et celui
 * où le client envoie sa photo — sans que personne comprenne pourquoi.
 *
 * La ligne ne porte AUCUNE donnée personnelle : un code, l'empreinte d'un
 * jeton, un compteur. La photo elle-même vit sur le disque jusqu'à ce que
 * la tablette confirme l'avoir reçue, et jamais au-delà de l'expiration du
 * code.
 */
export const aiPhotoRelays = pgTable(
  "ia_relais_photo",
  {
    id: serial("id").primaryKey(),
    /**
     * Le code court de l'adresse (/photo/K7M2QX), dicté ou scanné. Il ne
     * permet QUE d'envoyer une photo vers la tablette, jamais d'en lire une.
     */
    code: text("code").notNull(),
    /**
     * SHA-256 du jeton remis à la tablette : c'est lui, et lui seul, qui
     * permet de récupérer la photo. Comme pour les sessions, la base ne garde
     * que l'empreinte.
     */
    jetonHash: text("jeton_hash").notNull(),
    /**
     * Le stand dont la tablette a ouvert le relais ; NUL pour un relais ouvert
     * depuis le site, sans code de stand (21/11, migration 0113). C'est ce qui
     * donne l'origine du relais (« stand » ou « site ») et ce que comptent les
     * deux plafonds : celui de chaque stand, celui du site (ia-relais.ts).
     */
    standId: integer("stand_id").references(() => stands.id, { onDelete: "cascade" }),
    /**
     * La dernière photo reçue (« ia/relais-….jpg »), tant que la tablette n'a
     * pas confirmé l'avoir reçue.
     */
    photoPath: text("photo_path"),
    /** Photos reçues sur ce code : borne les envois d'une même session. */
    envois: integer("envois").notNull().default(0),
    recueAt: timestamp("recue_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("ia_relais_photo_code_uniq").on(t.code),
    uniqueIndex("ia_relais_photo_jeton_uniq").on(t.jetonHash),
    index("ia_relais_photo_expire_idx").on(t.expiresAt),
    index("ia_relais_photo_stand_idx").on(t.standId),
  ],
);

/**
 * Les clés de paiement saisies au back-office (BO › Réglages › Paiements).
 *
 * Une ligne par valeur SAISIE, et non par case : remplacer une clé archive la
 * précédente (archive_le) et en ajoute une nouvelle. On sait ainsi, des mois
 * après, qui a changé quelle clé et quand — sans jamais pouvoir la relire.
 *
 * La valeur est CHIFFRÉE (AES-256-GCM, clé dérivée d'APP_SECRET, voir
 * paiements-cles.ts) : une sauvegarde de la base, seule, ne donne aucune clé.
 * Même les valeurs publiques (pk_…, client-id) le sont, pour n'avoir qu'une
 * seule façon de faire. `fin` (les 4 derniers caractères) et `empreinte`
 * (HMAC tronqué, avec une clé dérivée à part) servent à l'affichage et aux
 * comparaisons, jamais à retrouver la valeur.
 *
 * Table À PART, et non dans « setting » : la route publique des réglages lit
 * toute la table « setting » sauf quelques préfixes, et celle du back-office
 * la relit en entier. Ranger des secrets là, c'était dépendre d'une liste de
 * préfixes facile à oublier. Aucune route générique ne lit celle-ci.
 */
export const clesPaiement = pgTable(
  "cle_paiement",
  {
    id: serial("id").primaryKey(),
    /** « stripe » ou « paypal ». */
    prestataire: text("prestataire").notNull(),
    /** « test » (essai, bac à sable) ou « live » (pour de vrai). */
    mode: text("mode").notNull(),
    /** cle_publique | cle_secrete | secret_webhook (Stripe), client_id | secret (PayPal). */
    champ: text("champ").notNull(),
    /** « v1.<marque>.<iv>.<tag>.<texte chiffré> », jamais la valeur en clair. */
    valeurChiffree: text("valeur_chiffree").notNull(),
    /** Les 4 derniers caractères, pour « se termine par … ». */
    fin: text("fin").notNull(),
    /** HMAC-SHA256 tronqué : reconnaît une valeur déjà vue, sans la révéler. */
    empreinte: text("empreinte").notNull(),
    creeLe: timestamp("cree_le", { withTimezone: true }).defaultNow().notNull(),
    /** L'adresse du compte du back-office qui l'a saisie. */
    creePar: text("cree_par"),
    /** Remplacée ou effacée : la ligne reste, elle ne sert plus. */
    archiveLe: timestamp("archive_le", { withTimezone: true }),
    archivePar: text("archive_par"),
  },
  (t) => [
    // UNE seule valeur vivante par case : la base elle-même refuse la
    // seconde, même si deux onglets enregistrent au même instant.
    uniqueIndex("cle_paiement_vivante_uniq")
      .on(t.prestataire, t.mode, t.champ)
      .where(sql`${t.archiveLe} is null`),
    check("cle_paiement_prestataire_check", sql`${t.prestataire} in ('stripe', 'paypal')`),
    check("cle_paiement_mode_check", sql`${t.mode} in ('test', 'live')`),
    check(
      "cle_paiement_champ_check",
      sql`(${t.prestataire} = 'stripe' and ${t.champ} in ('cle_publique', 'cle_secrete', 'secret_webhook')) or (${t.prestataire} = 'paypal' and ${t.champ} in ('client_id', 'secret'))`,
    ),
  ],
);

/**
 * Le journal des réglages de paiement : on n'y fait qu'AJOUTER des lignes.
 *
 * Il porte qui a fait quoi et quand — une clé enregistrée ou effacée, une
 * vérification, une bascule entre l'essai et le réel, l'achat des vraies
 * étiquettes —, et JAMAIS une valeur, ni même sa fin.
 *
 * L'ÉTAT EST LA DERNIÈRE LIGNE de chaque sujet (action, prestataire, mode) :
 * le mode choisi, les étiquettes, la dernière vérification. Il n'existe donc
 * aucun moyen de changer l'un d'eux sans laisser de trace.
 */
export const journalPaiement = pgTable(
  "journal_paiement",
  {
    id: serial("id").primaryKey(),
    le: timestamp("le", { withTimezone: true }).defaultNow().notNull(),
    /** L'adresse du compte du back-office. */
    par: text("par"),
    /** cle_enregistree | cle_archivee | verification | mode | etiquettes */
    action: text("action").notNull(),
    prestataire: text("prestataire"),
    mode: text("mode"),
    champ: text("champ"),
    /**
     * essai | reel | env pour le mode, oui | non pour les étiquettes,
     * ok | refus pour une vérification. Jamais une clé.
     */
    valeur: text("valeur"),
    /** Le verdict en clair, le compte, les empreintes vérifiées, la source. */
    detail: jsonb("detail"),
  },
  (t) => [
    index("journal_paiement_sujet_idx").on(t.action, t.prestataire, t.mode, t.id),
    check(
      "journal_paiement_action_check",
      sql`${t.action} in ('cle_enregistree', 'cle_archivee', 'verification', 'mode', 'etiquettes')`,
    ),
  ],
);

/* --- Affiches de démonstration ------------------------------------------- */

/**
 * Un lot d'affiches de démonstration : des affiches personnalisées au hasard,
 * à imprimer d'avance pour un marché, un salon ou une vitrine (BO › Atelier ›
 * Affiches de démonstration, voir apps/api/src/affiches-demo.ts).
 *
 * Des tables À ELLES, et non de fausses commandes : une commande fausserait
 * les numéros WEB-/SAL-, les ventes, les Finances et les Statistiques, et
 * retiendrait fonds et personnages contre la suppression (usages-commandes.ts).
 * Rien ici n'est lu par le circuit des commandes.
 */
export const lotsAffichesDemo = pgTable(
  "lot_affiches_demo",
  {
    id: serial("id").primaryKey(),
    creeLe: timestamp("cree_le", { withTimezone: true }).defaultNow().notNull(),
    /** L'adresse du compte du back-office qui l'a lancé. */
    creePar: text("cree_par"),
    /** « A4 » ou « A3 » : un lot sort tout entier dans un format. */
    format: text("format").notNull(),
    /** Les personnages demandés : une scène, ou « varie » (elles tournent sur le lot). */
    scene: text("scene").notNull(),
    /**
     * La demande telle que saisie : affiches et exemplaires, noms d'exemple
     * de la 2e ligne, couleur du texte, départ de la rotation des scènes.
     * « Refaire au hasard » la relit, pour retirer une affiche dans les mêmes
     * conditions.
     */
    demande: jsonb("demande").notNull(),
    /**
     * « Arrêter le lot » : les affiches qui restent ne partent plus, ni à la
     * reprise au démarrage, ni quand la page du lot est ouverte. « Reprendre »
     * l'éteint.
     */
    arrete: boolean("arrete").notNull().default(false),
  },
  (t) => [check("lot_affiches_demo_format_check", sql`${t.format} in ('A4', 'A3')`)],
);

/**
 * Une affiche d'un lot : sa configuration TIRÉE, enregistrée, et son fichier.
 *
 * La configuration est celle d'une ligne de commande (posterConfigSchema) :
 * c'est elle qui permet de refaire exactement la même affiche après un ménage
 * ou un redémarrage — le PDF, lui, n'est qu'un cache sur le disque
 * (data/assets/cache/affiches-demo/<lot>/<id>.pdf).
 *
 * `taille` et `crc32` sont ceux du PDF rangé : nuls, il n'est pas (ou plus)
 * prêt. Ils permettent d'écrire l'archive .zip du lot en flux, sans relire
 * chaque fichier avant de l'envoyer (archive-zip.ts).
 */
export const affichesDemo = pgTable(
  "affiche_demo",
  {
    id: serial("id").primaryKey(),
    lotId: integer("lot_id")
      .notNull()
      .references(() => lotsAffichesDemo.id, { onDelete: "cascade" }),
    /** Sa place dans le lot (1, 2, 3…) : l'ordre de fabrication et du .zip. */
    rang: integer("rang").notNull(),
    /**
     * L'affiche du catalogue d'où elle est tirée. SANS clé étrangère, exprès :
     * une affiche de démonstration ne doit empêcher ni l'archivage ni la
     * suppression d'un produit.
     */
    productId: integer("product_id"),
    /** Le nom de l'affiche au moment du tirage. */
    titre: text("titre").notNull(),
    /** La scène demandée pour elle (jamais « varie ») : « Refaire » la reprend. */
    scene: text("scene").notNull(),
    /**
     * Combien de fois elle a été retirée au hasard (0 : le tirage du lot).
     * Il change la graine du tirage, et il garde l'ouvrier d'enregistrer le
     * PDF d'une configuration remplacée pendant son rendu.
     */
    tirage: integer("tirage").notNull().default(0),
    /** Ce qu'on lit sur la carte avant le rendu : scène, personnages, décor. */
    resume: jsonb("resume").$type<{
      scene: string;
      degradee: boolean;
      personnages: string[];
      decor: string;
    }>(),
    config: jsonb("config").$type<PosterConfig>().notNull(),
    /** « mulhouse-place-de-la-reunion_A4_famille_3.pdf », en ASCII. */
    nomFichier: text("nom_fichier").notNull(),
    /** Octets du PDF rangé ; nul tant qu'il n'est pas prêt. */
    taille: integer("taille"),
    /** CRC-32 du PDF rangé (l'en-tête de son entrée dans le .zip). */
    crc32: bigint("crc32", { mode: "number" }),
    /** Durée du rendu, de son départ réel à son rangement. */
    dureeMs: integer("duree_ms"),
    /** La raison du dernier échec, dite pour la boutique. */
    erreur: text("erreur"),
    faitLe: timestamp("fait_le", { withTimezone: true }),
  },
  (t) => [index("affiche_demo_lot_idx").on(t.lotId, t.rang)],
);

/**
 * Un fond à créer (BO › Atelier › Créer un fond, 20/11) : UNE photo d'un lieu
 * et l'image qu'on en tire, au fil de sa discussion.
 *
 * Margaux : « Si seulement tu pouvais me faire un programme où j'ai juste à
 * mettre des photos et qu'il me génère des fonds automatiquement sans que je
 * discute pendant 2h pour faire un seule fond de ville ». Plusieurs photos
 * déposées d'un coup forment un LOT, et chacune donne son fond à elle
 * (Alexandra : « ça doit pas créer une photo pour plusieurs uploadées ! »).
 *
 * Les versions sont des lignes `ai_generation` (fond_id) : c'est là que vit
 * le coût, et le plafond du mois les compte avec les affiches.
 */
export const fondsIa = pgTable(
  "fond_ia",
  {
    id: serial("id").primaryKey(),
    creeLe: timestamp("cree_le", { withTimezone: true }).defaultNow().notNull(),
    creePar: text("cree_par"),
    /**
     * Jeton tiré par la page à l'affichage du formulaire, suivi du rang de la
     * photo : un double clic, ou un formulaire renvoyé par « Précédent »,
     * retrouve le lot déjà fait au lieu d'en payer un second.
     */
    jeton: text("jeton").notNull(),
    /** Le lot d'envoi : toutes les photos déposées d'un coup. */
    lot: text("lot").notNull(),
    /** « Colmar, la Petite Venise » : le nom du décor, à l'enregistrement. */
    nom: text("nom").notNull(),
    /** La précision du lot (« sous la neige »), reprise dans le premier message. */
    precision: text("precision"),
    /** La photo du lieu, rangée dans data/assets/ia/fonds (« ia/fonds/…jpg »). */
    photos: jsonb("photos").$type<string[]>().notNull(),
    /** Les décors de la bibliothèque montrés au modèle comme exemples de style. */
    exemples: jsonb("exemples").$type<number[]>().notNull().default([]),
    /**
     * Le style des affiches IA dont la consigne (« prompt ») est relue en
     * base à CHAQUE génération : le réécrire au BO change le fond suivant.
     */
    styleId: integer("style_id").references(() => aiPrompts.id, { onDelete: "set null" }),
    /** Versions du premier dessin ; un message en demande une. */
    versions: integer("versions").notNull(),
    /** La version d'où repart le prochain message (« revenir à cette version »). */
    versionCourante: text("version_courante"),
    /** La version gardée et enregistrée comme décor. */
    versionGardee: text("version_gardee"),
    backgroundId: integer("background_id").references(() => backgrounds.id, {
      onDelete: "set null",
    }),
    enregistreLe: timestamp("enregistre_le", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("fond_ia_jeton_uniq").on(t.jeton),
    index("fond_ia_lot_idx").on(t.lot),
  ],
);

/**
 * La discussion d'un fond (Alexandra, 20/11 : « il faut qu'elle puisse
 * discuter quand même si jamais le résultat est pas top top »). Un message =
 * une demande, et le dessin qui en sort, payé comme les autres. Le premier
 * message est le dessin de départ, à partir de la photo.
 */
export const fondsIaMessages = pgTable(
  "fond_ia_message",
  {
    id: serial("id").primaryKey(),
    fondId: integer("fond_id")
      .notNull()
      .references(() => fondsIa.id, { onDelete: "cascade" }),
    creeLe: timestamp("cree_le", { withTimezone: true }).defaultNow().notNull(),
    creePar: text("cree_par"),
    /** Contre le double envoi d'un même message. */
    jeton: text("jeton").notNull(),
    /** Ce qu'on lit dans le fil : boutons choisis et texte de Margaux. */
    texte: text("texte").notNull().default(""),
    /** Ce qui part au modèle : consignes des boutons, puis son texte. */
    demande: text("demande").notNull().default(""),
    /** La version d'où il repart ; nulle : de zéro, à partir de la photo. */
    baseVersion: text("base_version"),
    versions: integer("versions").notNull(),
  },
  (t) => [
    uniqueIndex("fond_ia_message_jeton_uniq").on(t.jeton),
    index("fond_ia_message_fond_idx").on(t.fondId),
  ],
);
