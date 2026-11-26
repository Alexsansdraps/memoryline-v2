/**
 * « Marquer terminées » et « Remettre à imprimer » : les ventes du stand
 * qu'on fait avancer, ou reculer, à la main (26/11).
 *
 * Alexandra, pour Margaux : « il faut que quand la personne créé une
 * affiche, qu'elle ne soit pas directement terminée mais qu'on doive le
 * faire soit dans la commande soit sur la liste avec case à cocher »,
 * « sinon elle peut pas modifier ». Une vente validée à la tablette naît
 * donc payée et « À imprimer » (salon.ts). C'est Margaux qui la marque
 * terminée : dans Ventes stand, en cochant des ventes (action groupée
 * « terminer-stand » de commandes.ts), ou sur sa fiche (la frise, POST
 * /admin/orders/:id/traitement). « Remettre à imprimer » rattrape une erreur.
 *
 * Le passage lui-même est celui de la frise (changerEtape, commandes.ts).
 * Vers « Terminée » : la remise qu'écrivait la validation jusqu'au 26/11 —
 * une expédition réussie, sans transporteur, des affiches qui restent
 * (cartes cadeaux exclues) — et la date de fin (`fulfilledAt`). Vers « À
 * imprimer » : ses remises annulées, la date de fin vidée. Le journal dit
 * qui, et quand. Aucun courriel : le stand n'en reçoit jamais (traitement.ts).
 *
 * Ici, la règle de la SÉLECTION : seules les ventes du stand payées s'y
 * prêtent. Une commande du site a sa liste, ses étapes et ses courriels ;
 * une reprise de Shopify a été traitée là-bas ; une vente annulée, de test,
 * ou rouverte sur la tablette (redevenue un panier) n'a rien à imprimer.
 * Elles sont ignorées, et le message de Ventes stand les compte, chacune
 * avec sa raison (apps/admin/src/lib/etape-vente-stand.ts).
 *
 * Et ce que « Mon compte » dit d'un achat au stand, quelle que soit son
 * étape (`traitementVuParLaCliente`).
 *
 * Rien ici ne lit ni n'écrit la base : les règles s'essaient sans elle
 * (tests/etape-vente-stand.test.ts).
 */
import { estVenteDeTest, STATUTS_ANNULES } from "./ventes-de-test.js";

/** Les deux gestes de la sélection, et l'étape où chacun mène. */
export const ACTIONS_ETAPE_STAND = {
  "terminer-stand": "terminee",
  "remettre-a-imprimer": "a_imprimer",
} as const;

export type ActionEtapeStand = keyof typeof ACTIONS_ETAPE_STAND;

/** Vrai pour « terminer-stand » et « remettre-a-imprimer ». */
export function estActionEtapeStand(action: string): action is ActionEtapeStand {
  return Object.hasOwn(ACTIONS_ETAPE_STAND, action);
}

/** Ce qu'il faut savoir d'une commande cochée pour savoir si le geste la concerne. */
export interface VenteCochee {
  number: string;
  channel: string;
  status: string;
  tags?: unknown;
  /** Non nul : une reprise de Shopify (17/11). */
  legacyId: number | null;
}

/**
 * Pourquoi « Marquer terminées » ou « Remettre à imprimer » laisse cette
 * commande telle quelle, ou null si le geste la concerne. Une raison
 * COURTE, sans majuscule ni point : le message de Ventes stand la met entre
 * parenthèses après le numéro (« SAL-0007 (vente de test) »).
 */
export function refusEtapeDuStand(v: VenteCochee): string | null {
  if (v.legacyId != null || v.number.startsWith("SHOP-"))
    return "reprise de l'ancienne boutique Shopify, traitée là-bas";
  if (v.channel !== "salon") return "commande du site, pas une vente du stand";
  if (v.status === "draft") return "rouverte sur la tablette et pas revalidée";
  if (estVenteDeTest(v)) return "vente de test";
  if (STATUTS_ANNULES.includes(v.status)) return "vente annulée";
  if (v.status !== "paid") return "pas encore réglée";
  return null;
}

/** La raison d'une vente déjà à l'étape demandée : rien n'est refait (un double clic, par exemple). */
export function raisonDejaFaite(vers: "terminee" | "a_imprimer"): string {
  return vers === "terminee" ? "déjà terminée" : "déjà à imprimer";
}

/**
 * Le traitement que « Mon compte » montre à la cliente (comptes.ts).
 *
 * Pour un achat au stand, les étapes du back-office (« À imprimer »,
 * « Terminée ») sont la cuisine de la boutique : depuis le 26/11, une vente
 * reste « À imprimer » jusqu'à ce que Margaux la marque terminée, et la
 * cliente lisait « Non expédiée » pour une affiche qu'elle avait peut-être
 * déjà sous le bras — avant, « Expédiée », pour une affiche qui n'avait
 * jamais voyagé. Elle lit donc « Remise sur le stand », la façon dont la
 * boutique lui remet son affiche (clé « compte.statut.expedition.stand » du
 * site, les mots de « livraison.remiseStand » de ses courriels), et
 * « Annulée » pour une vente annulée. Une commande du site garde le statut
 * calculé (`statut`).
 */
export function traitementVuParLaCliente(
  o: { channel: string; status: string },
  statut: string,
): string {
  if (o.channel !== "salon") return statut;
  return STATUTS_ANNULES.includes(o.status) ? "cancelled" : "stand";
}
