export * from "./config.js";
export * from "./library.js";
export * from "./svg-color.js";
export * from "./promo.js";
export * from "./fonts.js";

/** Canal d'une commande — dimension structurante, immuable (§11). */
export const ORDER_CHANNELS = ["web", "salon"] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

/** Gamme de produit (§5) : prix de base 23 € vs 15 € à l'audit. */
export const PRODUCT_KINDS = ["personnalisable", "prete_a_imprimer"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

/** Fournisseurs de paiement — web uniquement (§11). */
export const PAYMENT_PROVIDERS = ["stripe", "paypal"] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];
