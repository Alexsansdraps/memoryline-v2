/**
 * Corriger le MONTANT d'une vente du stand déjà validée (26/11).
 *
 * Margaux, relayée par Alexandra : « pouvoir modifier le montant € de la
 * commande stand une fois qu'elle est validée (car des fois ils changent
 * d'avis ils veulent un cadre par exemple) le but est d'avoir les
 * statistiques bon ». Une vente du stand naît payée à la validation
 * (salon.ts), et la tablette ne la rouvre qu'un quart d'heure. Un
 * client qui revenait plus tard prendre un cadre laissait une vente à 29 €
 * pour 39 € encaissés : les statistiques, les totaux du stand et la page
 * Finances restaient faux.
 *
 * La propriétaire saisit au BO le nouveau total, et un motif court si elle
 * veut : il est FACULTATIF depuis le 26/11 (Margaux : « commande stand
 * pouvoir modifier directement le total dans la ligne. Car si elle applique
 * des réductions par ex, faudrait juste le total indépendamment du reste »)
 * — le total se corrige dans la ligne de Ventes stand, sans confirmation ni
 * motif, ou dans le bloc de la fiche, motif au choix. Le total se corrige
 * quelle que soit l'étape de la vente (À imprimer, remise en partie,
 * Terminée) : aucune règle ici ne lit ses remises. Ce qui change, d'un bloc
 * (POST /admin/orders/:id/montant, commandes.ts) :
 *   - `order.total_cents`, que lisent les statistiques, la carte de
 *     l'accueil, les totaux par stand et l'export ;
 *   - le GRAND LIVRE, par une écriture de correction AJOUTÉE. L'encaissement
 *     d'origine n'est jamais réécrit (le grand livre est en écriture seule,
 *     schema.ts) : une hausse est un encaissement de plus (« sale »), une
 *     baisse de l'argent rendu sur place (« refund »), toujours sous le moyen
 *     « stand » (Réglé sur place), rattachée à l'encaissement d'origine par
 *     `parent_id`. « Ce que dit le grand livre » (les ventes moins ce qui est
 *     rendu, finances.ts) retombe ainsi sur le nouveau total, et le
 *     rapprochement de la page Finances avec les commandes reste à zéro ;
 *   - le journal de la commande : avant → après, le motif, et qui.
 *
 * Une correction se reconnaît au moyen « stand » ET à son `parent_id` :
 * l'encaissement d'une vente du stand n'a pas de parent (salon.ts), et le
 * bloc « Rembourser » n'écrit jamais sous le moyen « stand » (commandes.ts,
 * enregistrerRemboursement). C'est `estCorrectionDuMontant`, que lisent la
 * page Finances (pour ne pas prendre la vente corrigée pour une anomalie),
 * la facture (pour retomber sur son total) et la tablette (qui ne rouvre plus
 * une vente corrigée) ; le BO en a une copie (apps/admin/src/lib/montant-vente.ts).
 *
 * Les LIGNES (format, cadre) ne changent pas : seul le montant se corrige.
 * Rien ici ne lit ni n'écrit la base : les règles s'essaient sans elle
 * (tests/montant-vente-stand.test.ts).
 */
import { estVenteDeTest, STATUTS_ANNULES } from "./ventes-de-test.js";
import type { LigneFacture } from "./pdf.js";

/** Le moyen des ventes du stand au grand livre : « Réglé sur place » (finances.ts). */
export const PASSERELLE_DU_STAND = "stand";

/**
 * Le plus haut total accepté, 10 000 € : un garde-fou contre une saisie
 * aberrante, comme celui des cartes cadeaux. Une faute plus petite (390 €
 * pour 39 €) se voit au message qui suit l'enregistrement, dans la ligne
 * même (« SAL-0036 : 39,00 € → 390,00 € »), et se corrige aussitôt ; la
 * fiche, elle, redit l'ancien et le nouveau montant avant d'envoyer
 * (apps/admin/src/lib/montant-vente-bo.ts).
 */
export const MONTANT_MAX_CENTS = 1_000_000;

/** Un motif tient en quelques mots : il se lit au journal et sur la facture. */
export const MOTIF_MAX = 120;

/** « 29,00 € » : le montant dit au journal, au centime près. */
export function euros(cents: number): string {
  const signe = cents < 0 ? "−" : "";
  const absolu = Math.abs(Math.round(cents));
  const centimes = absolu % 100;
  return `${signe}${((absolu - centimes) / 100).toLocaleString("fr-FR")},${String(centimes).padStart(2, "0")} €`;
}

/** Ce qu'il faut savoir d'une vente pour dire si son montant se corrige. */
export interface VenteACorriger {
  number: string;
  channel: string;
  status: string;
  tags?: unknown;
  /** Non nul : une reprise de Shopify (17/11). */
  legacyId: number | null;
  invoiceNumber: string | null;
  giftCardCents: number;
  /** Lignes de `refund` : des remboursements passés par le bloc « Rembourser ». */
  remboursements: number;
  /** Un encaissement réussi au grand livre, celui dont la correction découle. */
  encaissementDOrigine: boolean;
}

/**
 * Pourquoi le montant de cette vente ne se corrige PAS, ou null s'il se
 * corrige. Une phrase que la propriétaire lit telle quelle au BO.
 *
 * Une vente FACTURÉE est refusée : la facture se refabrique à chaque
 * téléchargement à partir de la commande (composerLaFacture), et changer son
 * total changerait une facture déjà émise — ce qu'une facture ne fait jamais.
 */
export function refusDeCorrection(v: VenteACorriger): string | null {
  if (v.legacyId != null || v.number.startsWith("SHOP-"))
    return "Commande reprise de l'ancienne boutique Shopify : elle y a été réglée et facturée. Son montant ne se corrige pas ici.";
  if (v.channel !== "salon")
    return "Seul le montant d'une vente du stand se corrige ici. Une commande du site a été payée en ligne pour son montant : pour rendre de l'argent, passez par « Rembourser ».";
  if (estVenteDeTest(v))
    return "Cette vente est une vente de test : elle est hors des chiffres, son montant n'y compte pas.";
  if (STATUTS_ANNULES.includes(v.status))
    return "Cette vente est annulée : elle ne compte plus dans vos chiffres, son montant ne se corrige pas.";
  if (v.status === "draft")
    return "Cette vente a été rouverte sur la tablette et n'est pas revalidée : son montant se fera à la revalidation.";
  if (v.status !== "paid")
    return "Cette vente n'est pas encore réglée : marquez-la payée d'abord, puis corrigez son montant si besoin.";
  if (v.invoiceNumber)
    return `Cette vente est déjà facturée (${v.invoiceNumber}) : une facture émise ne se modifie pas, son montant ne peut donc plus changer.`;
  if (v.giftCardCents > 0)
    return "Une carte cadeau a payé une part de cette vente : son montant ne se corrige pas ici.";
  if (v.remboursements > 0)
    return "Cette vente a déjà un remboursement enregistré : son montant ne se corrige plus ici.";
  if (!v.encaissementDOrigine)
    return "Cette vente n'a aucun encaissement au grand livre : la correction n'aurait rien à quoi se rattacher. Elle figure dans les commandes à vérifier de la page Finances.";
  return null;
}

/**
 * Le montant envoyé par le BO, en centimes ENTIERS, ou null s'il ne se lit
 * pas. Le BO convertit la saisie en euros (« 39,50 ») ; ici, plus rien ne
 * s'arrondit.
 */
export function lireMontantCents(brut: unknown): number | null {
  const n =
    typeof brut === "number"
      ? brut
      : typeof brut === "string" && brut.trim()
        ? Number(brut.trim())
        : Number.NaN;
  return Number.isInteger(n) ? n : null;
}

/** Pourquoi ce nouveau montant est refusé, ou null s'il convient. */
export function refusDuMontant(apresCents: number | null): string | null {
  if (apresCents === null)
    return "Saisissez le nouveau montant total de la vente, en euros (par exemple 39 ou 39,50).";
  if (apresCents <= 0)
    return "Le montant d'une vente est plus grand que zéro. Pour une vente que le client n'a pas payée, annulez-la plutôt.";
  if (apresCents > MONTANT_MAX_CENTS)
    return `Ce montant dépasse ${euros(MONTANT_MAX_CENTS)} : vérifiez la saisie.`;
  return null;
}

/**
 * Le motif saisi, sur une ligne, sans espaces en trop, borné à MOTIF_MAX.
 * Vide quand il n'y en a pas : il n'est plus demandé (26/11, voir l'en-tête).
 */
export function lireMotif(brut: unknown): string {
  return String(brut ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MOTIF_MAX);
}

/**
 * L'écriture de correction à ajouter au grand livre, ou null si le montant
 * ne change pas. Le montant d'une écriture est toujours POSITIF : c'est le
 * genre qui donne le sens (schema.ts) — un encaissement de plus pour une
 * hausse, de l'argent rendu pour une baisse.
 */
export function ecritureDeCorrection(
  avantCents: number,
  apresCents: number,
): { kind: "sale" | "refund"; amountCents: number } | null {
  if (apresCents === avantCents) return null;
  return apresCents > avantCents
    ? { kind: "sale", amountCents: apresCents - avantCents }
    : { kind: "refund", amountCents: avantCents - apresCents };
}

/** Une écriture du grand livre, telle que la base la rend. */
export interface EcritureDuGrandLivre {
  id: number;
  kind: string;
  status: string;
  amountCents: number;
  gateway: string | null;
  parentId: number | null;
  message?: string | null;
  createdAt?: Date | string | null;
}

/**
 * L'encaissement dont une correction découle : le premier encaissement
 * réussi qui ne découle lui-même de rien. Celui de la validation au stand
 * (« stand »), ou celui d'une vente du 17 au 19/11 marquée payée au BO
 * (« manuel »). Null s'il n'y en a pas.
 */
export function encaissementDOrigine(ecritures: readonly EcritureDuGrandLivre[]): number | null {
  const origines = ecritures
    .filter((e) => e.status === "success" && e.kind === "sale" && e.parentId == null)
    .sort((a, b) => a.id - b.id);
  return origines[0]?.id ?? null;
}

/** Vrai pour une écriture de correction du montant (voir l'en-tête). */
export function estCorrectionDuMontant(e: {
  kind: string;
  gateway: string | null;
  parentId: number | null;
}): boolean {
  return (
    e.gateway === PASSERELLE_DU_STAND &&
    e.parentId != null &&
    (e.kind === "sale" || e.kind === "refund")
  );
}

/**
 * Une correction qui compte dans le MONTANT de la vente : réussie, ou
 * annulée avec la vente. L'annulation d'une vente du stand passe ses
 * encaissements en « annule » (commandes.ts) sans toucher à son total : la
 * hausse qu'elle portait reste dans ce total, et la fiche comme la facture
 * d'une vente annulée doivent encore retomber dessus. (La tablette ne rouvre
 * pas une vente corrigée : rien d'autre n'annule une correction.)
 */
function compteDansLeMontant(e: EcritureDuGrandLivre): boolean {
  return (e.status === "success" || e.status === "annule") && estCorrectionDuMontant(e);
}

/**
 * Ce que les corrections ont ajouté au montant de la vente, signé : positif
 * quand elles l'ont monté, négatif quand elles l'ont baissé.
 */
export function correctionNette(ecritures: readonly EcritureDuGrandLivre[]): number {
  return ecritures
    .filter(compteDansLeMontant)
    .reduce((s, e) => s + (e.kind === "sale" ? e.amountCents : -e.amountCents), 0);
}

/** Les motifs des corrections, du plus ancien au plus récent, sans doublon. */
export function motifsDesCorrections(ecritures: readonly EcritureDuGrandLivre[]): string[] {
  const motifs = ecritures
    .filter(compteDansLeMontant)
    .sort((a, b) => a.id - b.id)
    .map((e) => String(e.message ?? "").trim())
    .filter(Boolean);
  return [...new Set(motifs)];
}

/**
 * La ligne de la FACTURE qui porte une correction à la hausse, ou null.
 *
 * Les lignes d'une vente corrigée ne disent plus son total : un cadre pris
 * après la validation n'est que dans le montant. Sans cette ligne, la facture
 * alignait des articles à 29 € sous un total de 39 €. Une correction nette à
 * la baisse n'en a pas besoin : la facture la lit déjà comme une réduction
 * (sous-total moins total, composerLaFacture). `designation` vient de la
 * langue de la facture (« Ajustement du prix », clé « lignes.ajustement ») ;
 * les motifs saisis s'impriment dessous, tels quels.
 */
export function ligneDAjustement(
  ecritures: readonly EcritureDuGrandLivre[],
  designation: string,
): LigneFacture | null {
  const hausse = correctionNette(ecritures);
  if (hausse <= 0) return null;
  const motifs = motifsDesCorrections(ecritures).join(", ");
  return {
    designation,
    precision: motifs ? (motifs.length > 160 ? `${motifs.slice(0, 159)}…` : motifs) : null,
    lignesAffiche: [],
    quantite: 1,
    unitPriceCents: hausse,
  };
}

/* -------------------------------------------------------------------------- */
/*  Ce que la page Finances attend d'une vente corrigée                        */
/* -------------------------------------------------------------------------- */

/**
 * Les corrections d'une vente, telles que la page Finances les relit :
 * `nette`, ce qu'elles ont ajouté au montant (négatif quand elles l'ont
 * baissé) ; `baisse`, ce qu'elles ont rendu au client sur place.
 */
export interface CorrectionDUneVente {
  nette: number;
  baisse: number;
}

/**
 * Les corrections par vente, à partir de leurs sommes par genre (finances.ts,
 * requête 10 : « sale » pour une hausse, « refund » pour une baisse).
 */
export function correctionsParVente(
  sommes: readonly { orderId: number; genre: string; cents: number }[],
): Map<number, CorrectionDUneVente> {
  const parVente = new Map<number, CorrectionDUneVente>();
  for (const s of sommes) {
    const c = parVente.get(s.orderId) ?? { nette: 0, baisse: 0 };
    if (s.genre === "sale") c.nette += s.cents;
    else {
      c.nette -= s.cents;
      c.baisse += s.cents;
    }
    parVente.set(s.orderId, c);
  }
  return parVente;
}

/**
 * Ce que la page Finances attend d'une vente (sortie de finances.ts le 26/11
 * pour s'essayer sans base : relecture de « avoir les statistiques bon ») :
 *   - le GRAND LIVRE comparé au total : ses encaissements, moins ce qu'une
 *     correction à la baisse a rendu. L'encaissement d'origine reste au grand
 *     livre tel quel ; une hausse est un encaissement de plus, déjà compté ;
 *   - ce que ses ARTICLES doivent valoir : le total, moins le port, moins ce
 *     que les corrections ont ajouté. Un cadre pris après la validation ne
 *     change pas les lignes, seulement le montant.
 */
export function attendusDUneVente(v: {
  totalCents: number;
  portCents: number;
  encaissementsCents: number;
  correction: CorrectionDUneVente;
}): { grandLivreCents: number; articlesCents: number } {
  return {
    grandLivreCents: v.encaissementsCents - v.correction.baisse,
    articlesCents: v.totalCents - v.portCents - v.correction.nette,
  };
}

/**
 * Les articles d'une vente sans code promo ne retombent pas sur ce qu'on
 * attend d'eux, et rien ne l'explique : c'est une anomalie de la page
 * Finances. Une remise l'explique, au centime près quand elle est figée sur
 * la commande ; sinon (commandes d'avant), des articles AU-DESSUS de
 * l'attendu un jour où une promotion automatique tournait. Des articles en
 * dessous, aucune remise ne l'explique.
 */
export function articlesInexpliques(a: {
  lignesCents: number;
  attenduCents: number;
  /** La somme des remises figées sur la commande ; null si elle n'en a pas. */
  remisesFigeesCents: number | null;
  promotionEnVigueur: boolean;
}): boolean {
  if (a.lignesCents === a.attenduCents) return false;
  const remiseAutomatique =
    a.remisesFigeesCents !== null
      ? a.lignesCents - a.remisesFigeesCents === a.attenduCents
      : a.lignesCents > a.attenduCents && a.promotionEnVigueur;
  return !remiseAutomatique;
}

/**
 * La ligne du journal de la commande : avant → après, l'écart et le motif —
 * ou, sans motif (26/11), qu'il n'y en a pas eu : des mois plus tard, on
 * saura que personne n'en a donné, plutôt que de le chercher.
 */
export function phraseDuJournal(avantCents: number, apresCents: number, motif: string): string {
  const ecart = apresCents - avantCents;
  const raison = motif.trim();
  return `Montant de la vente corrigé : ${euros(avantCents)} → ${euros(apresCents)} (${ecart > 0 ? "+" : "−"}${euros(Math.abs(ecart))}). ${raison ? `Motif : « ${raison} ».` : "Aucun motif saisi."}`;
}
