/**
 * LES COLLECTIONS QUI N'ONT PAS DE PAGE À ELLES SUR LE SITE.
 *
 * Deux listes, venues du relevé de l'ancienne boutique Shopify (6 octobre) :
 * le site (apps/web/src/lib/anciennes-adresses.ts) s'en sert pour faire mener
 * leur adresse ailleurs, en 301. Elles vivent ici, et non plus dans le seul
 * site, parce que le back-office doit les connaître aussi : BO › Produits ›
 * Ordre d'affichage proposait de ranger « Personnages de dos » ou « Vintage »,
 * des pages que personne ne voit — on rangeait, et rien ne changeait sur le
 * site. Une seule table, lue des deux côtés, pour que l'écran ne propose
 * jamais une page que le site n'a pas.
 *
 * Les destinations sont des chemins du site SANS préfixe de langue, écrits
 * comme le menu y mène (lib/referencement.ts, adresseDuRayon).
 *
 * ⚠ CHAQUE DESTINATION CHOISIE À LA MAIN EST À FAIRE VALIDER PAR MARGAUX.
 */

/** L'adresse d'un rayon, comme le menu du site y mène (adresseDuRayon). */
function rayon(genre: string | null, collection?: string): string {
  const p = new URLSearchParams();
  if (genre) p.set("genre", genre);
  if (collection) p.set("collection", collection);
  const requete = p.toString();
  return "/affiches" + (requete ? `?${requete}` : "");
}

/** Le rayon « Villes », tel que le menu y mène. */
const VILLES = rayon("personnalisable", "villes");
/** Le rayon « Thèmes & paysages », tel que le menu y mène. */
const PAYSAGES = rayon("personnalisable", "balades-paysages");
const PERSONNALISABLES = rayon("personnalisable");
const PRETES = rayon("prete_a_imprimer");

/**
 * Les rayons techniques de Shopify, et celui qui double un genre.
 *
 * Ils existent encore comme collections — on ne les supprime pas, d'autres
 * écrans peuvent s'en servir (la vitrine de l'accueil, une rangée de page) —,
 * mais leur page ferait doublon avec une page qui existe déjà. Leur ancienne
 * adresse (/collections/…) ET leur page rayon (/affiches?collection=…) mènent
 * donc à cette page-là. Toujours, qu'elles aient des affiches ou non.
 */
export const RAYONS_FUSIONNES: Record<string, string> = {
  // « Page d'accueil / En vedette » : la vitrine de l'accueil de Shopify.
  frontpage: "/",
  // « Collection TOUT VOIR » : l'entrée « Tout voir » des personnalisables.
  "collection-tout-voir": PERSONNALISABLES,
  // « Personnages de dos » : ses 145 affiches sont toutes dans « Villes ».
  "personnages-de-dos": VILLES,
  // « Personnages de FACE » : ses 16 affiches sont toutes dans « Thèmes & paysages ».
  "personnages-de-face": PAYSAGES,
  // « Affiches prêtes à imprimer » : exactement les affiches de la page de ce
  // genre, celle du menu.
  "affiches-diverses": PRETES,
};

/**
 * Les collections Shopify vides, absentes du nouveau site : le rayon le plus
 * proche par le thème. Elles ne servent que tant que la collection n'a pas
 * d'affiche en vente — remplie au back-office, elle redevient son propre rayon
 * (voir `pageDuSiteManquante`).
 */
export const COLLECTIONS_DISPARUES: Record<string, string> = {
  // Thèmes, nature, saisons, activités : montagne, forêt, ferme, Noël, golf,
  // station de ski… sont dans « Thèmes & paysages ».
  themes: PAYSAGES,
  "nature-animaux": PAYSAGES,
  saisons: PAYSAGES,
  activites: PAYSAGES,
  "activites-passions": PAYSAGES,
  // Mots, cuisine, vintage : « Good vibes only », « Vivre pour l'apéro »,
  // « Team matcha », les affiches de voyage rétro… sont les prêtes à imprimer.
  "mots-citations": PRETES,
  cuisine: PRETES,
  vintage: PRETES,
  // Enfance : les affiches de famille sont les personnalisables.
  enfance: PERSONNALISABLES,
  // « Affiches » : le catalogue entier.
  affiches: "/affiches",
};

/**
 * Où mène la page d'une collection qui n'en a pas à elle, ou null si elle a
 * bien sa page sur le site.
 *
 * `enLigne` : le nombre de ses affiches en ligne. Une collection disparue
 * n'est sans page que tant qu'elle est vide ; une collection fusionnée l'est
 * toujours.
 */
export function pageDuSiteManquante(slug: string, enLigne: number): string | null {
  const fusion = RAYONS_FUSIONNES[slug];
  if (fusion) return fusion;
  const proche = COLLECTIONS_DISPARUES[slug];
  return proche && enLigne <= 0 ? proche : null;
}
