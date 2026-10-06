/**
 * L'argent de la boutique, avec ses sources, au même endroit.
 *
 * La même question — « combien est entré ce mois-ci ? » — recevait jusqu'ici
 * trois réponses différentes selon l'endroit où on la posait, et chacune avait
 * ses raisons d'être :
 *
 *   - le TOTAL DES COMMANDES vendues, ce que lisent les tableaux de bord. Il
 *     dit ce qui a été commandé, pas ce qui a été encaissé ;
 *   - le GRAND LIVRE, qui note chaque encaissement et chaque remboursement au
 *     fil de l'eau, et qui seul sait ce qui est ressorti ;
 *   - les ENCAISSEMENTS EN LIGNE de Stripe et de PayPal, qui ne peuvent par
 *     construction rien savoir d'une vente réglée en espèces sur un stand.
 *
 * Aucune n'est « la bonne », et choisir en silence serait le vrai danger :
 * l'écart entre deux d'entre elles est presque toujours l'information la plus
 * intéressante de la page. Ce fichier les calcule donc CÔTE À CÔTE, sur la
 * même période et sur le même ensemble de ventes, puis nomme les écarts au
 * lieu de les arbitrer.
 *
 * Deux partis pris qui gouvernent tout le reste :
 *
 *   1. LA PÉRIODE PORTE SUR LA DATE DE LA COMMANDE. Tout ce qui s'y rattache
 *      est compté avec elle, même survenu plus tard : un remboursement de
 *      novembre sur une vente d'octobre reste attaché à octobre. Sans cela,
 *      les quatre chiffres ne porteraient pas sur le même ensemble et leur
 *      comparaison ne voudrait plus rien dire.
 *   2. TOUT EST EN CENTIMES ENTIERS. Aucune division n'entre dans un calcul ;
 *      les seules qui subsistent servent à écrire un montant à l'écran.
 */
import type { Hono } from "hono";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  notInArray,
  or,
  sql as raw,
} from "drizzle-orm";
import { reglesActives, TYPES_REGLE_APPLIQUES } from "@memoryline/types";
import { db, schema } from "./db/client.js";
import { HORS_VENTES } from "./statuts-vente.js";

/* -------------------------------------------------------------------------- */
/*  Bornes de la période                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Le plus loin qu'on accepte de remonter. La boutique n'a rien de plus vieux,
 * et une date saisie de travers (« 0202-01-01 ») doit buter sur un refus
 * lisible plutôt que de lancer une lecture de toute la table.
 */
const PREMIERE_ANNEE = 2015;

/** Trois ans d'un coup : au-delà, la page ne se lit plus, elle se subit. */
const JOURS_MAX = 1100;

/**
 * Combien de mouvements le détail ramène au plus.
 *
 * Le tableau à l'écran n'est pas fait pour être parcouru sur dix mille
 * lignes : au-delà, c'est l'export qui prend le relais. Les totaux, eux, ne
 * sont JAMAIS bornés — ils viennent de requêtes groupées.
 */
const LIMITE_MOUVEMENTS = 1000;

/** Le même plafond pour l'export, plus large : un tableur, lui, encaisse. */
const LIMITE_EXPORT = 20000;

/** Combien d'anomalies la page montre. Les plus gros écarts d'abord. */
const LIMITE_ANOMALIES = 200;

const FORMAT_JOUR = /^\d{4}-\d{2}-\d{2}$/;

/** « 2026-09-09 » en heure locale : c'est la journée commerciale. */
function jourISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Un jour saisi, converti en instant local.
 *
 * Le repli silencieux de JavaScript est refusé : « 2026-02-31 » deviendrait le
 * 3 mars sans que personne ne le voie, et la période affichée ne serait plus
 * celle qu'on a demandée.
 */
function instantDuJour(jour: string, finDeJournee: boolean): Date | null {
  if (!FORMAT_JOUR.test(jour)) return null;
  const [a, m, j] = jour.split("-").map(Number);
  if (a === undefined || m === undefined || j === undefined) return null;
  const d = finDeJournee
    ? new Date(a, m - 1, j, 23, 59, 59, 999)
    : new Date(a, m - 1, j, 0, 0, 0, 0);
  if (d.getFullYear() !== a || d.getMonth() !== m - 1 || d.getDate() !== j)
    return null;
  return d;
}

interface Periode {
  du: string;
  au: string;
  debut: Date;
  fin: Date;
}

/**
 * La période demandée, ou la phrase qui explique pourquoi elle est refusée.
 *
 * Le refus est un texte que la propriétaire peut lire et corriger seule : un
 * code d'erreur ne lui apprendrait rien sur la date qu'elle vient de taper.
 */
function lirePeriode(
  duBrut: string,
  auBrut: string,
): { periode: Periode } | { erreur: string } {
  const aujourdhui = new Date();
  const premierDuMois = new Date(
    aujourdhui.getFullYear(),
    aujourdhui.getMonth(),
    1,
  );
  const du = duBrut.trim() || jourISO(premierDuMois);
  const au = auBrut.trim() || jourISO(aujourdhui);

  const debut = instantDuJour(du, false);
  if (!debut)
    return {
      erreur:
        "La date de début ne se lit pas. Elle s'écrit sous la forme 2026-01-31.",
    };
  const fin = instantDuJour(au, true);
  if (!fin)
    return {
      erreur:
        "La date de fin ne se lit pas. Elle s'écrit sous la forme 2026-01-31.",
    };

  if (debut.getTime() > fin.getTime())
    return {
      erreur:
        "La période se termine avant d'avoir commencé. Inversez les deux dates.",
    };
  if (debut.getFullYear() < PREMIERE_ANNEE)
    return {
      erreur: `La boutique n'a aucune vente avant ${PREMIERE_ANNEE}. Choisissez une date de début plus récente.`,
    };
  const finDuMondeConnu = new Date(
    aujourdhui.getFullYear() + 1,
    aujourdhui.getMonth(),
    aujourdhui.getDate(),
  );
  if (debut.getTime() > Date.now())
    return {
      erreur: "La période commence dans le futur : il n'y a rien à y lire.",
    };
  if (fin.getTime() > finDuMondeConnu.getTime())
    return {
      erreur: "La période se termine trop loin dans le futur. Rapprochez la date de fin.",
    };
  const jours = Math.round((fin.getTime() - debut.getTime()) / 86400000);
  if (jours > JOURS_MAX)
    return {
      erreur:
        "Une période de plus de trois ans est trop large pour être lue d'un coup. Resserrez les dates.",
    };

  return { periode: { du, au, debut, fin } };
}

/* -------------------------------------------------------------------------- */
/*  Écriture des montants                                                     */
/* -------------------------------------------------------------------------- */

/**
 * « 1 234,50 € », composé à partir des centimes ENTIERS.
 *
 * L'euro et les centimes sont séparés par un reste, jamais par une division
 * flottante : un montant écrit doit être exactement celui qui a été calculé.
 * Sert uniquement aux phrases d'explication, jamais à un calcul.
 */
function montant(cents: number): string {
  const signe = cents < 0 ? "-" : "";
  const absolu = Math.abs(cents);
  const centimes = absolu % 100;
  const euros = (absolu - centimes) / 100;
  return `${signe}${euros.toLocaleString("fr-FR")},${String(centimes).padStart(2, "0")} €`;
}

/* -------------------------------------------------------------------------- */
/*  Ce que la page renvoie                                                    */
/* -------------------------------------------------------------------------- */

/** Un montant vu par une source, et le nombre d'écritures derrière lui. */
export interface SourceChiffree {
  cents: number;
  nombre: number;
}

export interface Anomalie {
  numero: string;
  id: number;
  date: string;
  canal: string;
  /** Ce que la commande dit valoir : son total. */
  attendu: number;
  /** Ce que le grand livre a noté comme encaissé sur cette commande. */
  journal: number;
  /**
   * Ce qui a été encaissé sur cette commande, un règlement pris à la main
   * compris : la question posée ici est « l'argent est-il arrivé ? », pas
   * « par quel prestataire ? ».
   */
  paiement: number;
  /** La somme des articles vendus, port exclu. */
  lignes: number;
  /** Pourquoi cette commande figure ici, en toutes lettres. */
  raison: string;
}

export interface Mouvement {
  date: string;
  numero: string;
  orderId: number;
  canal: string;
  stand: string | null;
  /** « Vente », « Remboursement », « Encaissement ». */
  genre: string;
  /** D'où la ligne est tirée, registre et moyen compris. */
  source: string;
  /** Signé : négatif quand l'argent ressort. */
  cents: number;
  client: string;
}

export interface Finances {
  periode: { du: string; au: string };
  sources: {
    commandes: SourceChiffree;
    journal: SourceChiffree;
    paiements: SourceChiffree;
    lignes: { cents: number };
  };
  anomalies: Anomalie[];
  mouvements: Mouvement[];
  parCanal: { canal: string; stand: string | null; cents: number; nombre: number }[];
  parMoyen: { moyen: string; cents: number; nombre: number }[];
  remboursements: SourceChiffree;
  cartesCadeaux: {
    emisesCents: number;
    utiliseesCents: number;
    soldeCents: number;
  };
}

/**
 * Le moyen de paiement, dit comme on le dit à la boutique.
 *
 * « stand » n'est pas un prestataire : c'est de l'argent reçu de la main à la
 * main, et il n'y aura jamais de ligne d'encaissement en ligne en face.
 */
const LIBELLE_MOYEN: Record<string, string> = {
  stripe: "Stripe",
  paypal: "PayPal",
  stand: "Réglé sur place",
  manuel: "À la main (virement, espèces)",
};

const MOYEN_INCONNU = "Moyen non renseigné";

function libelleMoyen(passerelle: string | null): string {
  if (!passerelle) return MOYEN_INCONNU;
  return LIBELLE_MOYEN[passerelle] ?? passerelle;
}

/**
 * Les seuls prestataires qui encaissent VRAIMENT en ligne.
 *
 * L'énumération `payment_provider` accepte aussi « manuel », posé sur la ligne
 * de paiement quand la boutique encaisse un virement, un chèque ou des espèces
 * depuis la fiche commande. Cette ligne-là DOIT exister — sans elle, le
 * contrôle par commande, plus bas, signalerait à tort chaque vente réglée par
 * virement comme payée sans encaissement — mais elle n'a rien à faire dans un
 * chiffre présenté comme celui de Stripe et de PayPal : personne ne retrouvera
 * jamais un chèque sur un relevé Stripe.
 */
const PRESTATAIRES_EN_LIGNE = new Set(["stripe", "paypal"]);

/** « Site » ou « Stand », les deux façons dont la boutique vend. */
function libelleCanal(canal: string): string {
  return canal === "salon" ? "Stand" : "Site";
}

/* -------------------------------------------------------------------------- */
/*  Le rapprochement                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Tout ce que la page affiche, en neuf requêtes groupées.
 *
 * Aucune n'est faite commande par commande : chacune part de sa table et
 * rejoint les commandes de la période, si bien que le nombre de requêtes ne
 * dépend pas du nombre de ventes.
 */
async function rapprocher(periode: Periode): Promise<Finances> {
  const { debut, fin } = periode;

  /** Les commandes qui comptent comme des ventes, sur la période. */
  const ventesDeLaPeriode = () =>
    and(
      notInArray(schema.orders.status, HORS_VENTES),
      gte(schema.orders.createdAt, debut),
      lte(schema.orders.createdAt, fin),
    );

  const [
    commandes,
    lignesParCommande,
    journalParCommande,
    paiementsParCommande,
    remboursementsParCommande,
    detailJournal,
    cartesEmises,
    cartesDepensees,
    cartesEnCirculation,
  ] = await Promise.all([
    // 1. Les commandes de la période, avec leur stand et leur client. C'est la
    //    colonne vertébrale : tout le reste vient s'y accrocher.
    db
      .select({
        id: schema.orders.id,
        numero: schema.orders.number,
        creeLe: schema.orders.createdAt,
        canal: schema.orders.channel,
        statut: schema.orders.status,
        standNom: schema.stands.nom,
        totalCents: schema.orders.totalCents,
        portCents: schema.orders.shippingCents,
        carteCadeauCents: schema.orders.giftCardCents,
        codePromo: schema.orders.promoCode,
        clientNom: schema.customers.name,
        clientEmail: schema.customers.email,
      })
      .from(schema.orders)
      .leftJoin(schema.stands, eq(schema.orders.standId, schema.stands.id))
      .leftJoin(schema.customers, eq(schema.orders.customerId, schema.customers.id))
      .where(ventesDeLaPeriode())
      .orderBy(desc(schema.orders.createdAt)),

    // 2. Ce que pèsent les articles vendus, commande par commande.
    db
      .select({
        orderId: schema.orderItems.orderId,
        cents: raw<number>`coalesce(sum(${schema.orderItems.unitPriceCents} * ${schema.orderItems.quantity}), 0)::int`,
      })
      .from(schema.orderItems)
      .innerJoin(schema.orders, eq(schema.orderItems.orderId, schema.orders.id))
      .where(ventesDeLaPeriode())
      .groupBy(schema.orderItems.orderId),

    // 3. Le grand livre, regroupé par commande, par genre et par moyen. Le
    //    moyen est dans le regroupement parce que c'est LUI qui dit comment
    //    l'argent est entré : la répartition par moyen en découle.
    db
      .select({
        orderId: schema.orderTransactions.orderId,
        genre: schema.orderTransactions.kind,
        passerelle: schema.orderTransactions.gateway,
        cents: raw<number>`coalesce(sum(${schema.orderTransactions.amountCents}), 0)::int`,
        nombre: raw<number>`count(*)::int`,
      })
      .from(schema.orderTransactions)
      .innerJoin(
        schema.orders,
        eq(schema.orderTransactions.orderId, schema.orders.id),
      )
      .where(
        and(ventesDeLaPeriode(), eq(schema.orderTransactions.status, "success")),
      )
      .groupBy(
        schema.orderTransactions.orderId,
        schema.orderTransactions.kind,
        schema.orderTransactions.gateway,
      ),

    // 4. Les lignes de paiement, commande par commande ET prestataire par
    //    prestataire. Le prestataire est dans le regroupement parce que deux
    //    lecteurs attendent d'ici deux sous-ensembles différents : le contrôle
    //    par commande veut TOUTES les lignes, « manuel » compris, sans quoi
    //    une vente réglée par virement passerait pour non encaissée ; le
    //    chiffre affiché comme celui de Stripe et de PayPal, lui, ne veut
    //    qu'eux deux. Une vente de stand, elle, n'apparaît dans ni l'un ni
    //    l'autre, et n'y apparaîtra jamais.
    db
      .select({
        orderId: schema.payments.orderId,
        prestataire: schema.payments.provider,
        cents: raw<number>`coalesce(sum(${schema.payments.amountCents}), 0)::int`,
        nombre: raw<number>`count(*)::int`,
      })
      .from(schema.payments)
      .innerJoin(schema.orders, eq(schema.payments.orderId, schema.orders.id))
      .where(and(ventesDeLaPeriode(), eq(schema.payments.status, "succeeded")))
      .groupBy(schema.payments.orderId, schema.payments.provider),

    // 5. Ce qui a été rendu aux clients sur ces ventes.
    db
      .select({
        orderId: schema.refunds.orderId,
        cents: raw<number>`coalesce(sum(${schema.refunds.amountCents}), 0)::int`,
        nombre: raw<number>`count(*)::int`,
      })
      .from(schema.refunds)
      .innerJoin(schema.orders, eq(schema.refunds.orderId, schema.orders.id))
      .where(ventesDeLaPeriode())
      .groupBy(schema.refunds.orderId),

    // 6. Le détail, mouvement par mouvement. Borné : c'est un tableau qu'on
    //    lit, pas un fichier qu'on traite. Les totaux, eux, viennent d'en haut.
    db
      .select({
        id: schema.orderTransactions.id,
        date: schema.orderTransactions.createdAt,
        genre: schema.orderTransactions.kind,
        passerelle: schema.orderTransactions.gateway,
        cents: schema.orderTransactions.amountCents,
        orderId: schema.orders.id,
        numero: schema.orders.number,
        canal: schema.orders.channel,
        standNom: schema.stands.nom,
        clientNom: schema.customers.name,
        clientEmail: schema.customers.email,
      })
      .from(schema.orderTransactions)
      .innerJoin(
        schema.orders,
        eq(schema.orderTransactions.orderId, schema.orders.id),
      )
      .leftJoin(schema.stands, eq(schema.orders.standId, schema.stands.id))
      .leftJoin(schema.customers, eq(schema.orders.customerId, schema.customers.id))
      .where(
        and(
          ventesDeLaPeriode(),
          eq(schema.orderTransactions.status, "success"),
          inArray(schema.orderTransactions.kind, ["sale", "refund"]),
        ),
      )
      .orderBy(
        desc(schema.orderTransactions.createdAt),
        desc(schema.orderTransactions.id),
      )
      .limit(LIMITE_EXPORT),

    // 7. Les cartes cadeaux vendues sur la période : de l'argent encaissé
    //    d'avance, qui n'est pas une vente d'affiche.
    db
      .select({
        cents: raw<number>`coalesce(sum(${schema.giftCards.initialAmountCents}), 0)::int`,
        nombre: raw<number>`count(*)::int`,
      })
      .from(schema.giftCards)
      .where(
        and(
          gte(schema.giftCards.createdAt, debut),
          lte(schema.giftCards.createdAt, fin),
        ),
      ),

    // 8. Ce que les clients ont dépensé de leurs cartes sur la période. Les
    //    mouvements négatifs seuls : une recharge n'est pas un usage.
    db
      .select({
        cents: raw<number>`coalesce(sum(${schema.giftCardTransactions.amountCents}), 0)::int`,
      })
      .from(schema.giftCardTransactions)
      .where(
        and(
          gte(schema.giftCardTransactions.createdAt, debut),
          lte(schema.giftCardTransactions.createdAt, fin),
          raw`${schema.giftCardTransactions.amountCents} < 0`,
        ),
      ),

    // 9. Ce que la boutique doit encore, aujourd'hui. Ce chiffre-là ne dépend
    //    pas de la période : une dette n'a pas de mois.
    db
      .select({
        cents: raw<number>`coalesce(sum(${schema.giftCards.balanceCents}), 0)::int`,
      })
      .from(schema.giftCards)
      .where(
        and(
          eq(schema.giftCards.status, "active"),
          or(
            isNull(schema.giftCards.expiresAt),
            gte(schema.giftCards.expiresAt, new Date()),
          ),
        ),
      ),
  ]);

  /* --- Ce que chaque source dit, commande par commande ------------------- */

  const lignesDe = new Map<number, number>();
  for (const l of lignesParCommande) lignesDe.set(l.orderId, l.cents);

  /** Encaissements notés au grand livre, et le moyen qui domine. */
  const venteJournalDe = new Map<number, number>();
  const moyenDe = new Map<number, string | null>();
  const plusGrosseVenteDe = new Map<number, number>();
  let journalVenteCents = 0;
  let journalRemboursementCents = 0;
  let journalMouvements = 0;
  for (const t of journalParCommande) {
    if (t.genre === "sale") {
      venteJournalDe.set(t.orderId, (venteJournalDe.get(t.orderId) ?? 0) + t.cents);
      journalVenteCents += t.cents;
      journalMouvements += t.nombre;
      // Quand une commande porte plusieurs encaissements, c'est le plus gros
      // qui la caractérise : c'est celui-là qu'on cherchera à retrouver.
      if (t.cents > (plusGrosseVenteDe.get(t.orderId) ?? -1)) {
        plusGrosseVenteDe.set(t.orderId, t.cents);
        moyenDe.set(t.orderId, t.passerelle);
      }
    } else if (t.genre === "refund") {
      journalRemboursementCents += t.cents;
      journalMouvements += t.nombre;
    }
  }

  /**
   * Ce qui a été encaissé sur chaque commande, TOUS moyens confondus, un
   * règlement hors ligne compris. C'est ce que lit le contrôle par commande,
   * qui ne demande qu'une chose : l'argent d'une vente marquée payée est-il
   * arrivé quelque part ? Un virement encaissé à la main y répond « oui ».
   */
  const paiementDe = new Map<number, number>();
  const prestataireDe = new Map<number, string>();
  /*
   * Le total affiché, lui, s'arrête aux prestataires en ligne, parce que les
   * deux endroits qui le lisent parlent d'eux et d'eux seuls : la tuile
   * annonce « ce qu'ont encaissé Stripe et PayPal », et le rapprochement le
   * compare à la part que le grand livre attribue à ces deux-là. Or le grand
   * livre range un règlement hors ligne sous la passerelle « manuel » : un
   * chèque compté ici fabriquerait un « écart inexpliqué » de son propre
   * montant, alors que rien n'a été perdu — l'argent est simplement entré par
   * un autre chemin, et il se lit déjà dans « Ce que disent les commandes »,
   * dans « Ce que dit le grand livre » et sous « À la main (virement,
   * espèces) » de la répartition par moyen de paiement.
   */
  let paiementsCents = 0;
  let paiementsNombre = 0;
  for (const p of paiementsParCommande) {
    paiementDe.set(p.orderId, (paiementDe.get(p.orderId) ?? 0) + p.cents);
    prestataireDe.set(p.orderId, p.prestataire);
    if (!PRESTATAIRES_EN_LIGNE.has(p.prestataire)) continue;
    paiementsCents += p.cents;
    paiementsNombre += p.nombre;
  }

  let remboursementsCents = 0;
  let remboursementsNombre = 0;
  for (const r of remboursementsParCommande) {
    remboursementsCents += r.cents;
    remboursementsNombre += r.nombre;
  }

  /* --- Les quatre chiffres, côte à côte ---------------------------------- */

  let commandesCents = 0;
  let lignesCents = 0;
  for (const cmd of commandes) {
    commandesCents += cmd.totalCents;
    lignesCents += lignesDe.get(cmd.id) ?? 0;
  }

  /* --- Répartitions ------------------------------------------------------ */

  // Calculées à partir des commandes DÉJÀ lues plus haut : une requête
  // supplémentaire ne ferait que rapporter les mêmes lignes une seconde fois.
  const parCanal = new Map<
    string,
    { canal: string; stand: string | null; cents: number; nombre: number }
  >();
  const parMoyen = new Map<string, { moyen: string; cents: number; nombre: number }>();

  const ajouterMoyen = (moyen: string, cents: number) => {
    const actuel = parMoyen.get(moyen) ?? { moyen, cents: 0, nombre: 0 };
    actuel.cents += cents;
    actuel.nombre += 1;
    parMoyen.set(moyen, actuel);
  };

  for (const cmd of commandes) {
    const canal = libelleCanal(cmd.canal);
    const cle = `${canal} ${cmd.standNom ?? ""}`;
    const entree = parCanal.get(cle) ?? {
      canal,
      stand: cmd.standNom,
      cents: 0,
      nombre: 0,
    };
    entree.cents += cmd.totalCents;
    entree.nombre += 1;
    parCanal.set(cle, entree);

    // Une commande peut être réglée en deux temps : une part sur une carte
    // cadeau, le reste chez un prestataire. Chaque euro n'est compté qu'une
    // fois, et la somme des moyens retombe sur le total des commandes.
    const partCarte = Math.max(
      0,
      Math.min(cmd.carteCadeauCents, cmd.totalCents),
    );
    if (partCarte > 0) ajouterMoyen("Carte cadeau", partCarte);
    const reste = cmd.totalCents - partCarte;
    if (reste > 0) {
      const passerelle =
        moyenDe.get(cmd.id) ??
        prestataireDe.get(cmd.id) ??
        (cmd.canal === "salon" ? "stand" : null);
      ajouterMoyen(libelleMoyen(passerelle), reste);
    }
  }

  /* --- Les anomalies ----------------------------------------------------- */

  // Une promotion automatique (« 3 achetées = 1 A4 offerte ») n'a pas de
  // code : sans ce relevé, chaque vente qui en profitait passait pour une
  // commande à vérifier. Seuls comptent ses dates et son interrupteur, comme
  // au panier.
  const regles = await db.select().from(schema.promoRules);
  const typesQuiRemisent: readonly string[] = TYPES_REGLE_APPLIQUES;
  const promotionEnVigueur = (le: Date) =>
    reglesActives(regles, le).some((r) => typesQuiRemisent.includes(r.type));

  // L'écart accompagne chaque anomalie sans figurer dans ce qui est renvoyé :
  // il ne sert qu'à mettre en tête ce qui coûte le plus cher à comprendre.
  const trouvailles: { anomalie: Anomalie; ecart: number }[] = [];
  for (const cmd of commandes) {
    const journalVente = venteJournalDe.get(cmd.id) ?? 0;
    const aUneEcriture = venteJournalDe.has(cmd.id);
    const paiement = paiementDe.get(cmd.id) ?? 0;
    const lignes = lignesDe.get(cmd.id) ?? 0;
    const raisons: string[] = [];
    let ecart = 0;

    // Le grand livre, d'abord : c'est lui qui fait foi pour le solde d'une
    // commande, et une vente sans écriture est de l'argent dont personne ne
    // sait s'il est arrivé.
    if (!aUneEcriture) {
      raisons.push(
        `Aucun encaissement n'est écrit au grand livre pour cette vente de ${montant(cmd.totalCents)}.`,
      );
      ecart = Math.max(ecart, cmd.totalCents);
    } else if (journalVente !== cmd.totalCents) {
      raisons.push(
        `Le grand livre a noté ${montant(journalVente)} quand la commande en vaut ${montant(cmd.totalCents)}.`,
      );
      ecart = Math.max(ecart, Math.abs(journalVente - cmd.totalCents));
    }

    // Les encaissements en ligne ne concernent QUE le site. Une vente au stand
    // se règle de la main à la main : elle n'a pas de ligne chez Stripe ni
    // chez PayPal et n'en aura jamais, ce n'est donc pas une anomalie.
    const attenduDuPrestataire = Math.max(
      0,
      cmd.totalCents - Math.max(0, cmd.carteCadeauCents),
    );
    if (cmd.canal === "web" && cmd.statut === "paid" && attenduDuPrestataire > 0) {
      if (paiement === 0) {
        raisons.push(
          "Cette vente en ligne est marquée payée, mais ni Stripe ni PayPal n'a d'encaissement enregistré.",
        );
        ecart = Math.max(ecart, attenduDuPrestataire);
      } else if (paiement !== attenduDuPrestataire) {
        raisons.push(
          `Le prestataire a encaissé ${montant(paiement)} quand la commande en attendait ${montant(attenduDuPrestataire)}.`,
        );
        ecart = Math.max(ecart, Math.abs(paiement - attenduDuPrestataire));
      }
    }

    // Un code promo explique à lui seul que les articles ne retombent pas sur
    // le total : c'est même sa raison d'être. On ne signale que les écarts
    // qu'aucune remise ne justifie.
    if (!cmd.codePromo) {
      const attenduDesLignes = cmd.totalCents - cmd.portCents;
      // Des articles AU-DESSUS du total, un jour où une promotion automatique
      // était en vigueur : c'est la remise, déduite comme partout ailleurs
      // (compte client, courriels). Un total plus élevé que les articles, lui,
      // reste signalé : aucune remise ne l'explique.
      const remiseAutomatique =
        lignes > attenduDesLignes && promotionEnVigueur(cmd.creeLe);
      if (lignes !== attenduDesLignes && !remiseAutomatique) {
        raisons.push(
          `Les articles totalisent ${montant(lignes)} et le port ${montant(cmd.portCents)}, ce qui ne retombe pas sur les ${montant(cmd.totalCents)} de la commande.`,
        );
        ecart = Math.max(ecart, Math.abs(lignes - attenduDesLignes));
      }
    }

    if (!raisons.length) continue;
    trouvailles.push({
      ecart,
      anomalie: {
        numero: cmd.numero,
        id: cmd.id,
        date: cmd.creeLe.toISOString(),
        canal: cmd.standNom ?? libelleCanal(cmd.canal),
        attendu: cmd.totalCents,
        journal: journalVente,
        paiement,
        lignes,
        raison: raisons.join(" "),
      },
    });
  }
  trouvailles.sort((a, b) => b.ecart - a.ecart);
  const anomalies = trouvailles.map((t) => t.anomalie);

  /* --- Le détail des mouvements ------------------------------------------ */

  const mouvements: Mouvement[] = detailJournal.map((t) => ({
    date: t.date.toISOString(),
    numero: t.numero,
    orderId: t.orderId,
    canal: libelleCanal(t.canal),
    stand: t.standNom,
    genre: t.genre === "refund" ? "Remboursement" : "Vente",
    source: `Grand livre · ${libelleMoyen(t.passerelle)}`,
    // Le grand livre garde tous ses montants positifs et laisse le genre dire
    // le sens ; ici on rend le signe, parce qu'une colonne de montants doit
    // pouvoir s'additionner.
    cents: t.genre === "refund" ? -t.cents : t.cents,
    client: t.clientNom ?? t.clientEmail ?? "",
  }));

  // L'argent qu'un prestataire a pris sans que le grand livre le sache. C'est
  // le cas qui ne se voit nulle part ailleurs, et c'est celui qui coûte cher.
  const commandeParId = new Map(commandes.map((cmd) => [cmd.id, cmd]));
  for (const [orderId, cents] of paiementDe) {
    if (venteJournalDe.has(orderId)) continue;
    const cmd = commandeParId.get(orderId);
    if (!cmd) continue;
    mouvements.push({
      date: cmd.creeLe.toISOString(),
      numero: cmd.numero,
      orderId,
      canal: libelleCanal(cmd.canal),
      stand: cmd.standNom,
      genre: "Encaissement",
      source: `${libelleMoyen(prestataireDe.get(orderId) ?? null)}, sans écriture au grand livre`,
      cents,
      client: cmd.clientNom ?? cmd.clientEmail ?? "",
    });
  }
  mouvements.sort((a, b) => b.date.localeCompare(a.date));

  const utiliseesCents = Math.abs(cartesDepensees[0]?.cents ?? 0);

  return {
    periode: { du: periode.du, au: periode.au },
    sources: {
      commandes: { cents: commandesCents, nombre: commandes.length },
      journal: {
        cents: journalVenteCents - journalRemboursementCents,
        nombre: journalMouvements,
      },
      paiements: { cents: paiementsCents, nombre: paiementsNombre },
      lignes: { cents: lignesCents },
    },
    anomalies: anomalies.slice(0, LIMITE_ANOMALIES),
    mouvements,
    parCanal: [...parCanal.values()].sort((a, b) => b.cents - a.cents),
    parMoyen: [...parMoyen.values()].sort((a, b) => b.cents - a.cents),
    remboursements: { cents: remboursementsCents, nombre: remboursementsNombre },
    cartesCadeaux: {
      emisesCents: cartesEmises[0]?.cents ?? 0,
      utiliseesCents,
      soldeCents: cartesEnCirculation[0]?.cents ?? 0,
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Les routes                                                                */
/* -------------------------------------------------------------------------- */

/** Échappe une cellule CSV (Excel français : point-virgule, guillemets doublés). */
function cellule(v: unknown): string {
  const s = String(v ?? "");
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function mountFinances(app: Hono): void {
  /**
   * Le garde global de « /admin/* » ne réserve au propriétaire que ce qui
   * écrit ; une lecture y passe. Or ces chiffres-là sont exactement ce qu'on
   * ne montre pas à quelqu'un qui tient une table un samedi après-midi : le
   * contrôle est donc posé ici, en tête de chaque handler.
   */
  const refuseAuVendeur = (role: string | undefined) => role !== "owner";
  const REFUS =
    "Les finances de la boutique sont réservées à la propriétaire.";

  app.get("/admin/finances", async (c) => {
    if (refuseAuVendeur(c.get("utilisateur")?.role))
      return c.json({ error: REFUS }, 403);

    const lue = lirePeriode(c.req.query("du") ?? "", c.req.query("au") ?? "");
    if ("erreur" in lue) return c.json({ error: lue.erreur }, 400);

    const finances = await rapprocher(lue.periode);
    return c.json({
      ...finances,
      // Le détail est borné à l'écran ; l'export, lui, ramène tout.
      mouvements: finances.mouvements.slice(0, LIMITE_MOUVEMENTS),
    });
  });

  /**
   * Le détail des mouvements en CSV.
   *
   * Séparateur point-virgule et BOM UTF-8 : c'est ce qu'attend Excel en
   * français. Sans eux, les accents arrivent en charabia et tout se retrouve
   * dans une seule colonne.
   */
  app.get("/admin/finances/export.csv", async (c) => {
    if (refuseAuVendeur(c.get("utilisateur")?.role))
      return c.json({ error: REFUS }, 403);

    const lue = lirePeriode(c.req.query("du") ?? "", c.req.query("au") ?? "");
    if ("erreur" in lue) return c.json({ error: lue.erreur }, 400);

    const finances = await rapprocher(lue.periode);
    const entetes = [
      "Date",
      "Commande",
      "Canal",
      "Stand",
      "Nature",
      "Provenance",
      "Montant",
      "Client",
    ];
    // Le tableur attend une virgule décimale : la conversion se fait ici, à la
    // toute dernière seconde, sur des centimes restés entiers jusque-là.
    const euros = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
    const lignes = finances.mouvements.map((m) =>
      [
        new Date(m.date).toLocaleString("fr-FR"),
        m.numero,
        m.canal,
        m.stand ?? "",
        m.genre,
        m.source,
        euros(m.cents),
        m.client,
      ]
        .map(cellule)
        .join(";"),
    );
    const csv = "﻿" + [entetes.join(";"), ...lignes].join("\r\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="finances-${lue.periode.du}-${lue.periode.au}.csv"`,
      },
    });
  });
}
