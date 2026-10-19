import type { CleUi } from "../i18n/utils.ts";

/**
 * Le message d'un ajout au panier refusé, dans la langue de la page.
 *
 * Le module de personnalisation affichait l'erreur brute — « Error: API POST
 * /cart/…/items -> 400 {"error":"config invalide",…} » —, en français et en
 * jargon, quelle que soit la langue de la fiche ; le bouton des affiches
 * prêtes à imprimer la gardait pour tout ce qu'il ne reconnaissait pas. La
 * cliente lit désormais une phrase de son site ; le détail reste dans la
 * console, pour qui cherche la cause.
 *
 * Deux cas seulement, parce qu'ils ne demandent pas le même geste :
 *  - une ligne que l'API refuse (« config invalide ») : réessayer ne
 *    changera rien, il faut recharger la page ;
 *  - tout le reste — API injoignable (le navigateur lève alors une
 *    TypeError, sans réponse), panne passagère : réessayer dans un instant.
 */
export function messageAjoutRefuse(e: unknown, tr: (cle: CleUi) => string): string {
  console.error("[panier] ajout refusé :", e);
  return String(e).includes("config invalide")
    ? tr("panier.err.config")
    : tr("panier.err.ajout");
}
