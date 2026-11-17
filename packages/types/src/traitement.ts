/**
 * Le traitement d'une commande, étape par étape (17/11).
 *
 * Trois parcours, décidés par la propriétaire :
 *
 *   - « stand » : une vente prise sur la tablette. Elle naît « à encaisser »,
 *     Margaux la marque payée, puis elle s'imprime et se remet sur place :
 *     À imprimer → Terminée. AUCUN courriel : la personne est là.
 *   - « livraison » : une commande du site qui voyage. Payée, elle est
 *     « En préparation » ; puis « Envoyée » (l'avis d'expédition part, avec
 *     le suivi s'il y en a un) ; puis « Livrée », sans courriel.
 *   - « retrait » : une commande du site retirée sur place (un lieu, ou le
 *     retrait au stand). « En préparation », puis « Prête à retirer » (le
 *     courriel « Votre commande vous attend » part), puis « Retirée ».
 *
 * Rien de tout cela n'est stocké tel quel : l'étape se DÉDUIT. Ce qui est
 * parti se lit dans les expéditions (`fulfillment`), comme avant — une
 * vente « Terminée », une commande « Envoyée » ou « Retirée », c'est une
 * expédition pour chaque article. Deux dates seulement s'ajoutent sur la
 * commande, pour ce que les expéditions ne savent pas dire : `readyAt`
 * (prête à retirer, rien n'est encore parti) et `deliveredAt` (livrée).
 * Les commandes d'avant gardent donc l'étape que disent leurs expéditions.
 *
 * Ce fichier ne lit ni n'écrit rien : il répond, et c'est ce qui permet de
 * l'essayer sans base (apps/api/tests/etapes-traitement.test.ts). L'API s'en
 * sert pour décider, le back-office pour afficher : les deux disent la même
 * chose, par construction.
 */

/** Les trois façons dont une commande arrive à sa cliente. */
export type ParcoursTraitement = "stand" | "livraison" | "retrait";

/**
 * Où en est une commande.
 *
 * Les étapes qu'on CHOISIT sont celles de `ETAPES_DU_PARCOURS`. Les autres
 * disent pourquoi il n'y a rien à choisir (panier, annulée, pas encore
 * payée, rien à expédier), ou qu'une partie seulement est partie.
 */
export type EtapeTraitement =
  | "panier"
  | "annulee"
  | "a_encaisser"
  | "rien_a_expedier"
  | "a_imprimer"
  | "terminee"
  | "en_preparation"
  | "en_partie"
  | "prete"
  | "retiree"
  | "envoyee"
  | "livree";

/** Les étapes qu'on choisit, dans l'ordre, pour chaque parcours. */
export const ETAPES_DU_PARCOURS: Record<ParcoursTraitement, readonly EtapeTraitement[]> = {
  stand: ["a_imprimer", "terminee"],
  livraison: ["en_preparation", "envoyee", "livree"],
  retrait: ["en_preparation", "prete", "retiree"],
};

/** L'étape où tout est parti : une expédition couvre chaque article. */
export const ETAPE_PARTIE: Record<ParcoursTraitement, EtapeTraitement> = {
  stand: "terminee",
  livraison: "envoyee",
  retrait: "retiree",
};

/**
 * Le parcours d'une commande.
 *
 * Un retrait pour lequel la boutique a acheté un VRAI bordereau voyage : il
 * suit alors le parcours d'une livraison, avec son suivi. Une lettre
 * d'essai ne compte pas, elle ne part nulle part. Une vente du stand reste
 * une vente du stand : elle s'imprime et se remet sur place.
 */
export function parcoursDe(c: {
  channel: string | null | undefined;
  /** La commande a un lieu de retrait (lieu choisi, ou ancien retrait au stand). */
  retrait: boolean;
  /** Un vrai bordereau SendCloud est acheté, ou en cours d'achat. */
  bordereauReel?: boolean;
}): ParcoursTraitement {
  if (c.channel === "salon") return "stand";
  return c.retrait && !c.bordereauReel ? "retrait" : "livraison";
}

/** Ce qu'il faut savoir d'une commande pour dire où elle en est. */
export interface EtatDeTraitement {
  status: string;
  /** Articles à préparer, quantités comprises, cartes cadeaux exclues. */
  articles: number;
  /** Combien sont déjà partis (expéditions non annulées). */
  expedies: number;
  readyAt?: Date | string | null;
  deliveredAt?: Date | string | null;
}

/** L'étape d'une commande, déduite de son statut, de ses expéditions et de ses deux dates. */
export function etapeDe(parcours: ParcoursTraitement, e: EtatDeTraitement): EtapeTraitement {
  if (e.status === "draft") return "panier";
  if (e.status === "cancelled" || e.status === "voided") return "annulee";
  // On ne prépare pas ce qui n'est pas réglé : une vente du stand « à
  // encaisser », une commande du site qui attend son virement.
  if (e.status !== "paid") return "a_encaisser";
  // Des cartes cadeaux seules : parties par e-mail au paiement.
  if (e.articles <= 0) return "rien_a_expedier";
  if (e.expedies >= e.articles)
    return parcours === "livraison" && e.deliveredAt ? "livree" : ETAPE_PARTIE[parcours];
  if (e.expedies > 0) return "en_partie";
  if (parcours === "stand") return "a_imprimer";
  if (parcours === "retrait" && e.readyAt) return "prete";
  return "en_preparation";
}

/**
 * Le rang d'une étape dans son parcours : 0, 1, 2… « En partie » se range
 * juste avant l'étape où tout est parti. Null : une étape hors du parcours
 * (panier, annulée, pas encore payée, rien à expédier).
 */
export function rangEtape(parcours: ParcoursTraitement, etape: string): number | null {
  const liste = ETAPES_DU_PARCOURS[parcours];
  const i = liste.indexOf(etape as EtapeTraitement);
  if (i >= 0) return i;
  if (etape === "en_partie") return liste.indexOf(ETAPE_PARTIE[parcours]) - 0.5;
  return null;
}

/** Le nom d'une étape, tel que l'écrit le back-office. */
export function libelleEtape(etape: EtapeTraitement, parcours: ParcoursTraitement): string {
  switch (etape) {
    case "panier":
      return "Panier";
    case "annulee":
      return "Annulée";
    case "a_encaisser":
      return parcours === "stand" ? "À encaisser" : "En attente de paiement";
    case "rien_a_expedier":
      return "Rien à expédier";
    case "a_imprimer":
      return "À imprimer";
    case "terminee":
      return "Terminée";
    case "en_preparation":
      return "En préparation";
    case "en_partie":
      return parcours === "stand"
        ? "Remise en partie"
        : parcours === "retrait"
          ? "Retirée en partie"
          : "Envoyée en partie";
    case "prete":
      return "Prête à retirer";
    case "retiree":
      return "Retirée";
    case "envoyee":
      return "Envoyée";
    case "livree":
      return "Livrée";
  }
}

/**
 * La couleur d'une étape, la même dans la liste et sur la fiche : gris, rien
 * à faire ici ; ambre, à faire ; orange, à moitié fait ; bleu, chez la
 * cliente ou en route ; vert, fini.
 */
export type TonEtape = "neutre" | "a_faire" | "en_partie" | "en_cours" | "fait";

export function tonEtape(etape: EtapeTraitement): TonEtape {
  switch (etape) {
    case "a_imprimer":
    case "en_preparation":
      return "a_faire";
    case "en_partie":
      return "en_partie";
    case "prete":
    case "envoyee":
      return "en_cours";
    case "terminee":
    case "retiree":
    case "livree":
      return "fait";
    default:
      return "neutre";
  }
}

/** Le courriel qu'un passage envoie à la cliente. Le stand n'en reçoit aucun. */
export type CourrierEtape = "expediee" | "prete_a_retirer";

/** Ce que la cliente reçoit, dit sous le bouton qui l'envoie. */
export const ANNONCE_COURRIER: Record<CourrierEtape, string> = {
  expediee:
    "La cliente recevra l'avis d'expédition « Votre commande est en route », avec le suivi s'il y en a un.",
  prete_a_retirer:
    "La cliente recevra « Votre commande vous attend », avec le lieu où la retirer.",
};

/** Pourquoi une commande n'a pas d'étape à choisir. */
function raisonSansEtape(etape: EtapeTraitement, parcours: ParcoursTraitement): string {
  switch (etape) {
    case "panier":
      return "C'est un panier, pas une commande : il n'y a rien à préparer.";
    case "annulee":
      return "Cette commande est annulée : plus rien ne se prépare ni ne part.";
    case "a_encaisser":
      return parcours === "stand"
        ? "Cette vente du stand n'est pas encore réglée : marquez-la payée d'abord."
        : "Cette commande n'est pas encore payée : on ne prépare pas ce qui n'est pas réglé. Si l'argent est arrivé hors du site, encaissez-la d'abord.";
    case "rien_a_expedier":
      return "Cette commande ne contient que des cartes cadeaux, parties par e-mail : il n'y a rien à préparer.";
    default:
      return "Cette commande n'a pas d'étape à choisir.";
  }
}

/** Ce que demande le passage d'une étape à une autre, ou pourquoi il est refusé. */
export type PassageEtape =
  | { ok: false; raison: string }
  | { ok: true; inchange: true }
  | {
      ok: true;
      inchange: false;
      sens: "avant" | "arriere";
      /** Expédier tout ce qui reste : une expédition pour les articles restants. */
      expedier: boolean;
      /** Annuler les expéditions en cours : on revient avant « parti ». */
      annulerExpeditions: boolean;
      /** Le courriel à envoyer, seulement en allant de l'avant. */
      courrier: CourrierEtape | null;
    };

/**
 * Peut-on passer de `de` à `vers`, et qu'est-ce que cela demande ?
 *
 * Toutes les étapes du parcours se choisissent, en avant comme en arrière :
 * une cliente vient chercher sa commande avant qu'on l'ait dite prête, une
 * étape cliquée par erreur se défait. Deux règles seulement :
 *
 *   - un courriel ne part qu'en avançant, et seulement en arrivant à
 *     « Envoyée » ou à « Prête à retirer ». Revenir en arrière n'écrit
 *     jamais à personne ;
 *   - on ne revient pas avant « parti » quand un vrai bordereau SendCloud
 *     est acheté : le colis a son étiquette, il faut l'annuler d'abord.
 */
export function passageEtape(
  parcours: ParcoursTraitement,
  de: EtapeTraitement,
  vers: string,
  options: { bordereauReel?: boolean } = {},
): PassageEtape {
  const depart = rangEtape(parcours, de);
  if (depart === null) return { ok: false, raison: raisonSansEtape(de, parcours) };
  const arrivee = rangEtape(parcours, vers);
  // « En partie » se constate, il ne se choisit pas.
  if (arrivee === null || !Number.isInteger(arrivee))
    return { ok: false, raison: "Cette étape n'existe pas pour cette commande." };
  if (arrivee === depart) return { ok: true, inchange: true };

  const partie = rangEtape(parcours, ETAPE_PARTIE[parcours])!;
  const expedier = arrivee >= partie && depart < partie;
  const annulerExpeditions = arrivee < partie && depart > partie - 1;
  if (annulerExpeditions && options.bordereauReel)
    return {
      ok: false,
      raison:
        "Un bordereau SendCloud a été acheté pour cette commande : annulez-le d'abord (bloc « Bordereau transporteur »). On ne revient pas en arrière sur un colis qui a son étiquette.",
    };
  const sens = arrivee > depart ? "avant" : "arriere";
  const courrier: CourrierEtape | null =
    sens === "avant" && vers === "envoyee"
      ? "expediee"
      : sens === "avant" && vers === "prete"
        ? "prete_a_retirer"
        : null;
  return { ok: true, inchange: false, sens, expedier, annulerExpeditions, courrier };
}

/**
 * Les deux dates de la commande après un passage vers `vers`.
 *
 * « Prête à retirer » garde sa première date, « Retirée » aussi (on sait
 * encore depuis quand elle attendait) ; toute autre étape l'efface. « Livrée »
 * garde la sienne ; toute autre étape l'efface — un colis renvoyé en
 * préparation n'a jamais été livré.
 */
export function datesApresPassage(
  vers: EtapeTraitement,
  avant: { readyAt: Date | null; deliveredAt: Date | null },
  maintenant: Date,
): { readyAt: Date | null; deliveredAt: Date | null } {
  return {
    readyAt:
      vers === "prete" ? (avant.readyAt ?? maintenant) : vers === "retiree" ? avant.readyAt : null,
    deliveredAt: vers === "livree" ? (avant.deliveredAt ?? maintenant) : null,
  };
}
