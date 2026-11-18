/**
 * Les cartes cadeaux : ce que le site, la caisse et l'API partagent.
 *
 * Une carte cadeau est de l'argent déjà encaissé, que la boutique doit encore
 * rendre en affiches (apps/api/src/cartes-cadeaux.ts). Deux usages se
 * croisent ici :
 *  - la carte VENDUE sur le site : une ligne de panier d'un montant libre,
 *    sans format, sans cadre, sans port, que les promotions ne touchent pas ;
 *  - la carte DÉPENSÉE à la caisse : son code paie tout ou partie d'une
 *    commande, jusqu'à épuisement de son solde.
 *
 * Les montants sont en CENTIMES, entiers.
 */

/**
 * Les signes d'un code de carte, choisis pour être dictés et retapés : ni
 * I/1, O/0, B/8, G/6, S/5, Z/2, Q/9, ni les lettres qui riment en français
 * (voir cartes-cadeaux.ts, qui tire les codes).
 */
export const ALPHABET_CARTE = "ACEFHJKLRUWXY23456789";

/**
 * Le montant d'une carte vendue sur le site : 5 € au moins (18/11, Alexandra :
 * « le montant mini c'est 5 »), en euros ronds. Pas de plafond annoncé
 * (« on met pas de max ») ; les 10 000 € ne sont qu'un garde-fou contre des
 * zéros de trop, que personne ne voit sans les avoir tapés.
 */
export const CARTE_MONTANT_MIN_CENTS = 500;
export const CARTE_MONTANT_MAX_CENTS = 1_000_000;

/**
 * Le montant demandé est-il celui d'une carte qu'on peut vendre ?
 *
 * Des euros RONDS : un montant tapé au clavier se lit sans virgule ni
 * arrondi, et « 25,505 » n'a pas à exister. Lu sans confiance : il arrive
 * du navigateur.
 */
export function montantCarteValide(cents: unknown): cents is number {
  return (
    typeof cents === "number" &&
    Number.isInteger(cents) &&
    cents % 100 === 0 &&
    cents >= CARTE_MONTANT_MIN_CENTS &&
    cents <= CARTE_MONTANT_MAX_CENTS
  );
}

/**
 * La CLÉ d'un code de carte saisi : ses seuls signes, en majuscules.
 *
 * Les anciens codes ont douze signes (« XXXX-XXXX-XXXX »), les nouveaux seize
 * (« XXXX-XXXX-XXXX-XXXX ») ; la saisie accepte les deux, avec ou sans
 * tirets ni espaces, en minuscules comme en majuscules. Null quand la saisie
 * n'a pas la forme d'un code de carte : ce n'en est pas un, inutile d'aller
 * le chercher.
 */
export function cleDeCarte(saisie: unknown): string | null {
  const brut = String(saisie ?? "")
    .toUpperCase()
    .replace(/[\s\-–—.]+/g, "");
  if (brut.length !== 12 && brut.length !== 16) return null;
  for (const signe of brut) if (!ALPHABET_CARTE.includes(signe)) return null;
  return brut;
}

/**
 * Le code masqué, sauf son dernier groupe : « ••••-••••-K7R2 »,
 * « ••••-••••-••••-K7R2 ».
 *
 * Une carte est au porteur : son code complet ne s'affiche qu'à celui qui l'a
 * saisi ou reçu, jamais dans un compte, un récapitulatif ou un courriel qui
 * pourrait être lu par quelqu'un d'autre.
 */
export function codeCarteMasque(code: string): string {
  const signes = String(code ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const groupes = signes.match(/.{1,4}/g) ?? [];
  if (groupes.length === 0) return "••••";
  return groupes.map((g, i) => (i === groupes.length - 1 ? g : "••••")).join("-");
}

/**
 * Ce qu'une ligne de panier dit d'elle quand c'est une carte cadeau
 * (`order_item.gift_card`). Le destinataire se remplit à la caisse.
 */
export interface LigneCarteCadeau {
  montantCents: number;
  destinataireEmail?: string | null;
  destinatairePrenom?: string | null;
  message?: string | null;
}

/** La ligne est-elle une carte cadeau ? Une affiche n'a pas ce champ. */
export function estLigneCarte(ligne: { giftCard?: unknown } | null | undefined): boolean {
  const g = ligne?.giftCard;
  return g != null && typeof g === "object";
}

/** Le petit mot : 300 signes au plus, comme une carte qu'on écrit à la main. */
export const CARTE_MESSAGE_MAX = 300;
/** Le prénom du destinataire. */
export const CARTE_PRENOM_MAX = 60;

/**
 * La part qu'une carte cadeau paie sur une commande.
 *
 * Jusqu'au total, sans dépasser le solde — et jamais sur les cartes cadeaux
 * que la commande achète : on ne paie pas une carte avec une autre carte, ce
 * serait la recharger sans passer par la caisse.
 */
export function partCarteCadeau(
  totalCents: number,
  cartesAcheteesCents: number,
  soldeCents: number,
): number {
  const payable = Math.max(0, Math.round(totalCents) - Math.max(0, Math.round(cartesAcheteesCents)));
  return Math.max(0, Math.min(Math.max(0, Math.round(soldeCents)), payable));
}

/** Ce qui reste à payer par carte bancaire ou PayPal, une fois la carte cadeau comptée. */
export function resteAPayerCents(totalCents: number, carteCents: number): number {
  return Math.max(0, Math.round(totalCents) - Math.max(0, Math.round(carteCents)));
}

/**
 * Une commande peut-elle se valider SANS paiement ?
 *
 * Seulement si, recalculée par le serveur au moment de valider, elle vaut ce
 * qu'elle valait au passage en caisse, se livre, et qu'il ne reste EXACTEMENT
 * rien à payer une fois la carte cadeau comptée. Le moindre centime, et c'est
 * non : la commande se paie par carte ou par PayPal.
 */
export function validableSansPaiement(o: {
  /** Le mode de livraison sait encore porter le colis. */
  livrable: boolean;
  /** Ce que valent les lignes, recalculées à l'instant. */
  totalCents: number;
  /** Le total figé au passage en caisse. */
  totalCommandeCents: number;
  /** La part retenue sur une carte cadeau. */
  carteCents: number;
}): boolean {
  return (
    o.livrable &&
    Number.isInteger(o.totalCents) &&
    o.totalCents >= 0 &&
    o.totalCents === o.totalCommandeCents &&
    o.totalCents - Math.max(0, o.carteCents) === 0
  );
}
