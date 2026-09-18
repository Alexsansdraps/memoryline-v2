/// <reference lib="dom" />

/**
 * Le code du stand, retenu par la tablette : le retaper entre deux clients
 * est intenable un jour de salon. Le nom de la clé date du « salon » ; le
 * changer ferait redemander le code à toutes les tablettes déjà réglées.
 *
 * Deux écrans s'en servent : la validation de la commande (CommandeStand.tsx)
 * et le relais de photo du téléphone vers la tablette (RelaisPhoto.tsx). Un
 * code tapé à l'un est donc connu de l'autre — la vendeuse ne le saisit
 * qu'une fois dans la journée.
 *
 * Chaque accès est gardé : en navigation privée le stockage peut refuser, et
 * le stand doit marcher quand même — il faudra seulement retaper le code.
 */
const CLE_CODE = "ml_salon_code";

export function codeMemorise(): string | null {
  try {
    return localStorage.getItem(CLE_CODE);
  } catch {
    return null;
  }
}

export function retenirCode(valeur: string) {
  try {
    localStorage.setItem(CLE_CODE, valeur);
  } catch {
    /* navigation privée : le stand marche, il faudra retaper le code */
  }
}

export function oublierCode() {
  try {
    localStorage.removeItem(CLE_CODE);
  } catch {
    /* rien à oublier */
  }
}
