/**
 * Ce qui compte comme une vente, et ce qui n'en est pas une.
 *
 * La question revient partout : les chiffres d'une affiche, le garde-fou qui
 * refuse d'effacer un produit déjà vendu, le chiffre d'affaires d'un client.
 * Elle a longtemps reçu deux réponses différentes selon le fichier, et la
 * mauvaise réponse était « status = paid ».
 *
 * Car « paid » n'est posé que par le retour de Stripe ou de PayPal. Une
 * commande prise au STAND naît « pending » et le reste toute sa vie : la
 * vendeuse a encaissé de la main à la main, aucun prestataire n'a rien à
 * confirmer. Compter sur « paid » revenait donc à dire que le salon ne vend
 * rien — et à laisser effacer un produit qui n'y a été vendu que trop bien.
 *
 * La bonne question est l'inverse : qu'est-ce qui n'est PAS une vente ? Un
 * panier abandonné (« draft », car un panier est une commande dans ce
 * schéma), une commande annulée, une commande avortée. Tout le reste a été
 * commandé pour de bon.
 */
// Typé `string[]` et non figé : la clause `not in` de Drizzle refuse un
// tuple en lecture seule, et le rendre mutable ici évite une copie à chaque
// appel.
export const HORS_VENTES: string[] = ["draft", "cancelled", "voided"];

/**
 * Le format vendu sur une ligne de commande.
 *
 * Il ne se lit PAS dans `variant_id`, qui est vide partout : aucun des chemins
 * d'ajout au panier ne le remplit. Il vit dans la configuration figée de la
 * ligne, et une ligne sans format est un A4, exactement comme le suppose le
 * calcul du prix dans configurator-routes.ts.
 */
export const FORMAT_PAR_DEFAUT = "A4";
