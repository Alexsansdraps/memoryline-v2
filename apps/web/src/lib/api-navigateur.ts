/**
 * Le strict nécessaire pour parler à l'API depuis le navigateur : son
 * adresse, l'identifiant du panier, et la lecture du panier.
 *
 * Ces quelques lignes vivaient dans api.ts, et c'est ce qui coûtait cher. La
 * pastille du panier, posée sur TOUTES les pages, importait api.ts pour
 * elles — et avec lui, par le jeu des imports, le dictionnaire des cinq
 * langues (i18n/ui.ts) et la bibliothèque de validation zod
 * (@memoryline/types) : mesuré sur la construction de production, 209 Ko de
 * JavaScript (53 Ko compressés) téléchargés et analysés sur chaque page, pour
 * afficher un chiffre. Les îlots qui n'ont besoin que de ceci l'importent
 * d'ici ; api.ts le réexporte, et les autres continuent de tout trouver au
 * même endroit.
 *
 * Rien d'autre ne doit entrer ici, et surtout aucun import de
 * @memoryline/types ni de i18n : ce module ne sert qu'à rester léger.
 */

/**
 * URL de l'API joignable depuis le NAVIGATEUR (pour les <img>, etc.).
 * Côté serveur SSR on parle à http://api:3000 (réseau Docker), mais le
 * navigateur du visiteur doit utiliser une URL publique (localhost:3000 en
 * dev). PUBLIC_API_URL la surcharge en prod (ex. https://api.memoryline.fr).
 */
export const PUBLIC_API_URL =
  import.meta.env.PUBLIC_API_URL ?? "http://localhost:3000";

/**
 * La page est-elle en mode stand ? Le serveur le dit sur <html data-stand="1">
 * (Base.astro), d'après l'ADRESSE seule (?stand=1) : plus de cookie depuis le
 * 17/11 (« sur memoryline.fr on ne doit plus être en mode stand »).
 */
export function enModeStand(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.stand === "1";
}

/**
 * L'en-tête qui dit à l'API qu'un appel vient de la tablette en mode stand
 * (apps/api/src/cadres.ts, requeteDuStand) : le panier garde ses cadres, et
 * se range parmi ceux du stand.
 */
export function enteteStand(): Record<string, string> {
  return enModeStand() ? { "X-Stand": "1" } : {};
}

/**
 * Une adresse du site qui garde le mode stand quand on y est : la tablette
 * passe de page en page sans en sortir. Une adresse d'un autre site, ou qui
 * dit déjà ce qu'elle veut (`stand=0` pour en sortir), ne change pas.
 */
export function avecStand(adresse: string): string {
  if (!enModeStand()) return adresse;
  try {
    const u = new URL(adresse, window.location.href);
    if (u.origin !== window.location.origin || u.searchParams.has("stand")) return adresse;
    u.searchParams.set("stand", "1");
    return u.pathname + u.search + u.hash;
  } catch {
    return adresse;
  }
}

/**
 * Où mène « le panier » (17/11, plus de page /panier sur le site) : sur le
 * site, la page de commande, qui porte le récapitulatif modifiable ; au
 * stand, la page /panier de la tablette, qui reste sa dernière étape.
 * Les deux adresses arrivent déjà dans la langue de la page.
 */
export function versLePanier(adresseCommande: string, adressePanierDuStand: string): string {
  return enModeStand() ? avecStand(adressePanierDuStand) : adresseCommande;
}

/** Clé localStorage du panier (UUID par navigateur). */
const CART_ID_KEY = "ml_cart_id";

/** Lit (ou crée) l'identifiant de panier persistant du navigateur. */
export function getCartId(): string {
  let id = localStorage.getItem(CART_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(CART_ID_KEY, id);
  }
  return id;
}

/**
 * Oublie le panier de ce navigateur (payé, ou clos côté API) : le prochain
 * getCartId() en ouvre un neuf.
 */
export function oublierCartId(): void {
  localStorage.removeItem(CART_ID_KEY);
}

/** Rend à la tablette le panier d'une vente rouverte (voir ConfirmationStand). */
export function reprendreCartId(id: string): void {
  localStorage.setItem(CART_ID_KEY, id);
}

/**
 * Repart d'un panier VIDE, sans toucher au panier précédent.
 *
 * Au stand, chaque client a sa commande : la vendeuse enchaîne, et le panier
 * du client servi ne doit rien laisser au suivant (CommandeStand.tsx).
 */
export function nouveauCartId(): string {
  const id = crypto.randomUUID();
  localStorage.setItem(CART_ID_KEY, id);
  return id;
}

/**
 * Le panier de ce navigateur, tel que l'API le rend — ou `null` s'il vient
 * d'être PAYÉ.
 *
 * Un panier payé est devenu une commande : on l'oublie, et le prochain appel
 * à getCartId() en ouvre un neuf. Sans cela, la pastille afficherait encore
 * les articles achetés, et un nouvel ajout irait dans une commande close.
 * C'est l'unique endroit qui applique cette règle : api.ts (browserApi.cart)
 * et la pastille passent tous deux par ici.
 */
export async function lirePanier<T extends { status?: string | null }>(
  cartId: string,
): Promise<T | null> {
  const chemin = `/cart/${cartId}`;
  const res = await fetch(`${PUBLIC_API_URL}${chemin}`, { headers: enteteStand() });
  if (!res.ok) throw new Error(`API ${chemin} -> ${res.status}`);
  const panier = (await res.json()) as T;
  // Payé, ou annulé (recette du 17/11) : ce n'est plus un panier.
  if (panier.status !== "paid" && panier.status !== "cancelled" && panier.status !== "voided")
    return panier;
  oublierCartId();
  return null;
}

/**
 * Ajoute une ligne au panier de ce navigateur, et rend la ligne créée.
 *
 * Ici et non dans api.ts : le bouton « Ajouter au panier » de la fiche n'a
 * besoin que de cela, et importer api.ts lui faisait télécharger, avant
 * d'être cliquable, le dictionnaire des cinq langues et zod
 * (AUDIT-SEO.md, VIT-2). api.ts (browserApi.addCartItem) passe par ici : une
 * seule règle pour le panier clos.
 *
 * Panier clos (déjà payé) : on repart d'un panier neuf et on réessaie une
 * fois, sans rien demander à la cliente. L'erreur garde la forme de celles
 * d'api.ts (« API POST … -> 400 {"error":"config invalide"} ») : c'est ce
 * texte que lit messageAjoutRefuse (ajout-panier.ts).
 */
export async function ajouterAuPanier<T>(
  cartId: string,
  ligne: Record<string, unknown>,
): Promise<T> {
  const envoyer = async (id: string): Promise<T> => {
    const chemin = `/cart/${id}/items`;
    const res = await fetch(`${PUBLIC_API_URL}${chemin}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...enteteStand() },
      body: JSON.stringify(ligne),
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = JSON.stringify(await res.json());
      } catch {
        /* corps illisible : le code suffit */
      }
      throw new Error(`API POST ${chemin} -> ${res.status} ${detail}`);
    }
    return res.json() as Promise<T>;
  };
  try {
    return await envoyer(cartId);
  } catch (e) {
    if (!String(e).includes("panier_clos")) throw e;
    oublierCartId();
    return envoyer(getCartId());
  }
}
