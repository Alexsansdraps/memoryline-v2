/**
 * Le code promo retenu d'une visite de la caisse à l'autre.
 *
 * Il ne vaut RIEN par lui-même : le serveur revérifie le code au passage en
 * caisse et recalcule le montant. Ce qui est gardé ici n'est qu'un confort —
 * ne pas avoir à le retaper après un rechargement, ou en revenant par le lien
 * d'un courriel de relance (pages/panier/recuperer.astro le repose sous la
 * même clé).
 *
 * Seul le code PROMO est gardé : un code de carte cadeau vaut de l'argent au
 * porteur, il ne reste pas dans le navigateur.
 *
 * Depuis le 17/11, le code ne se saisit plus qu'à la caisse : le panier du
 * stand n'affiche aucune remise.
 */
export const CLE_CODE_PROMO = "ml_code_promo";

export function codePromoRetenu(): string {
  try {
    return localStorage.getItem(CLE_CODE_PROMO) ?? "";
  } catch {
    return "";
  }
}

export function retenirCodePromo(code: string): void {
  try {
    localStorage.setItem(CLE_CODE_PROMO, code);
  } catch {
    // Stockage refusé (navigation privée) : le code vaut pour cette page.
  }
}

export function oublierCodePromo(): void {
  try {
    localStorage.removeItem(CLE_CODE_PROMO);
  } catch {
    // Sans stockage, il n'y avait rien à oublier.
  }
}
