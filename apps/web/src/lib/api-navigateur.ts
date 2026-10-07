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
  const res = await fetch(`${PUBLIC_API_URL}${chemin}`);
  if (!res.ok) throw new Error(`API ${chemin} -> ${res.status}`);
  const panier = (await res.json()) as T;
  if (panier.status !== "paid") return panier;
  oublierCartId();
  return null;
}
