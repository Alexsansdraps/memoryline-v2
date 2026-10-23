export * from "./config.js";
export * from "./library.js";
export * from "./svg-color.js";
export * from "./couleurs-groupes.js";
export * from "./couleurs-image.js";
export * from "./svg-normalisation.js";
export * from "./empilement-personnage.js";
export * from "./promo.js";
export * from "./livraison.js";
export * from "./poids.js";
export * from "./fonts.js";
export * from "./textes-affiche.js";
export * from "./mise-en-page-texte.js";
export * from "./couleurs-texte.js";
export * from "./sol-personnages.js";
export * from "./composition-personnages.js";
export * from "./cadres.js";
export * from "./video.js";
export * from "./bandeaux-visuels.js";
export * from "./grille.js";
export * from "./filigrane.js";

/** Canal d'une commande — dimension structurante, immuable (§11). */
export const ORDER_CHANNELS = ["web", "salon"] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

/** Gamme de produit (§5) : prix de base 23 € vs 15 € à l'audit. */
export const PRODUCT_KINDS = ["personnalisable", "prete_a_imprimer"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

/** Fournisseurs de paiement — web uniquement (§11). */
export const PAYMENT_PROVIDERS = ["stripe", "paypal"] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];
export * from "./formats.js";
export * from "./nuanciers.js";
export * from "./rayons-sans-page.js";
export * from "./donnees-structurees.js";
