/**
 * Routes d'administration des commandes : expéditions, remboursements,
 * annulation, encaissement hors ligne, facture, étiquettes, actions de masse
 * et export.
 *
 * Le principe qui gouverne tout ce fichier : **rien ne s'écrase**. Une
 * expédition annulée reste dans la table avec sa date d'annulation, un
 * remboursement s'ajoute au grand livre au lieu de corriger le total de la
 * commande, une commande annulée reste lisible, et les statuts affichés sont
 * TOUJOURS recalculés à partir de ces lignes. Il n'y a donc aucun moyen que la
 * fiche raconte autre chose que ce qui s'est réellement passé.
 */
import { archiveZip, type FichierArchive } from "./archive-zip.js";
import type { Context, Hono } from "hono";
import type { SQL } from "drizzle-orm";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql as raw,
} from "drizzle-orm";
import { db, schema } from "./db/client.js";
import { annulerBordereau } from "./sendcloud-colis.js";
import {
  desactiverCartesVendues,
  recrediterCarte,
  resteARendreALaCarte,
} from "./cartes-cadeaux.js";
import {
  capturePaypalDeLaCommande,
  RefusPaypal,
  refundPaypal,
  refundStripe,
} from "./payments.js";
// Un remboursement part avec les clés du mode où le paiement est né (essai
// ou réel), pas avec celles du moment : voir paiements-reglages.ts.
import { configPaiement, modeDuPaiement, payeeEnEssai } from "./paiements-reglages.js";
import { nomDuMode } from "./paiements-cles.js";
import {
  FUSEAU_BOUTIQUE,
  anneeAParis,
  instantDeParis,
  lignesRemplies,
  type TextesAffiche,
} from "@memoryline/types";
import {
  datesApresPassage,
  ETAPE_PARTIE,
  ETAPES_DU_PARCOURS,
  etapeDe,
  libelleEtape,
  parcoursDe,
  passageEtape,
  rangEtape,
  type EtapeTraitement,
  type ParcoursTraitement,
} from "@memoryline/types";
import {
  courrierAnnulee,
  courrierExpediee,
  courrierFacture,
  courrierPreteAuRetrait,
  courrierRemboursee,
  envoyer as envoyerCourrier,
  estConfigure as mailConfigure,
  type LigneCourrier,
  prix,
} from "./mail.js";
// L'encaissement d'un virement passe par la MÊME fonction que celui d'un
// paiement Stripe. L'import est croisé — configurator-routes.ts lit déjà
// `resumeCommandes` ici — mais chacun ne s'en sert qu'à l'intérieur d'une
// fonction, jamais au chargement du module : le cycle ne se referme donc
// jamais pendant l'évaluation, et Node le résout sans broncher.
import { markOrderPaid, ValidationRefusee } from "./configurator-routes.js";
import { renderInvoicePdf, type LigneFacture } from "./pdf.js";
import { cheminApercu } from "./apercus.js";
import { bornesDuVendeur } from "./vendeurs.js";
import { supprimerPourToujours } from "./suppression.js";
import {
  avecEtiquetteTest,
  estVenteDeTest,
  ETIQUETTE_TEST,
  lireFiltreTest,
  miseEnTest,
  MOTIF_TEST,
  poseTestALaMain,
  refusEtiquetteTest,
  STATUTS_ANNULES,
  type FiltreTest,
} from "./ventes-de-test.js";
// Le montant d'une vente du stand, corrigé après sa validation (26/11).
import {
  ecritureDeCorrection,
  encaissementDOrigine,
  lireMontantCents,
  lireMotif,
  ligneDAjustement,
  PASSERELLE_DU_STAND,
  phraseDuJournal,
  refusDeCorrection,
  refusDuMontant,
} from "./montant-vente-stand.js";
// « Marquer terminées » et « Remettre à imprimer » dans Ventes stand (26/11).
import {
  ACTIONS_ETAPE_STAND,
  estActionEtapeStand,
  raisonDejaFaite,
  refusEtapeDuStand,
} from "./etape-vente-stand.js";
import { unPassageALaFois } from "./verrou-commande.js";
import {
  numeroSuivant,
  numerosDuPrefixe,
  type PrefixeNumero,
} from "./numeros-commande.js";
import {
  emetteurComplet,
  emetteurDuMoment,
  siretGroupe,
  type Emetteur,
} from "./facturation.js";
import { libelleDuLieu, lieuDeRetrait, lignesDuLieu } from "./lieux-retrait.js";
import {
  dateCourte,
  langueDuDestinataire,
  langueLue,
  tc,
  type CleCourriel,
  type Langue,
} from "./courriels/index.js";
import { livraisonDansLaLangue, nomTraduit } from "./traductions.js";
import { prenomPourCourrier } from "./prenom.js";

/**
 * Le titre de repli d'une ligne (« Affiche personnalisée ») dans la langue du
 * courrier.
 *
 * Certains articles sont mis en forme AVANT qu'on sache à qui écrire — ceux
 * d'un remboursement ou d'une annulation, composés par la route elle-même. Ils
 * portent alors le repli français, qu'on traduit ici au dernier moment. Un
 * titre réellement saisi n'est jamais touché ; en français, rien ne change.
 */
function titresDansLaLangue(lignes: LigneCourrier[], langue: Langue): LigneCourrier[] {
  if (langue === "fr") return lignes;
  const repli = tc("fr")("lignes.titreParDefaut");
  return lignes.map((l) =>
    l.titre === repli ? { ...l, titre: tc(langue)("lignes.titreParDefaut") } : l,
  );
}

/**
 * L'adresse publique du site, pour les images des courriers.
 *
 * Un courrier ne sait pas résoudre un chemin relatif : sans origine, la
 * vignette ne s'afficherait nulle part.
 */
const ORIGINE_PUBLIQUE =
  (process.env.PUBLIC_ORIGIN ?? "").replace(/\/+$/, "") || "http://localhost:8080";

/* -------------------------------------------------------------------------- */
/*  Statuts calculés                                                          */
/* -------------------------------------------------------------------------- */

export type StatutFinancier =
  | "draft"
  | "pending"
  | "authorized"
  | "paid"
  | "partially_refunded"
  | "refunded"
  | "voided";

/**
 * Minuit, heure de la boutique, pour une date « 2026-09-29 ».
 *
 * `new Date("2026-09-29")` se lit en heure UNIVERSELLE : un filtre « à partir
 * du 29 » commençait à 2 heures du matin à Paris, et les commandes de la nuit
 * glissaient au jour d'avant. Lue par instantDeParis, elle est à Paris quel
 * que soit le fuseau de la machine (TZ dans docker-compose, ou pas).
 */
function debutDuJour(date: string): Date {
  return (/^\d{4}-\d{2}-\d{2}$/.test(date) && instantDeParis(date)) || new Date(date);
}

/**
 * Le dernier instant de la journée de Paris, pour une date « 2026-09-29 ».
 *
 * Une date de fin s'entend « jusqu'au soir » : sinon un filtre « du 1er au 3 »
 * perdrait toutes les commandes du 3. `new Date("2026-09-29")` puis
 * `setHours(23, 59…)` tombait juste à Paris, mais seulement parce que le
 * serveur y est réglé : ailleurs, le soir pris était celui d'un autre fuseau.
 */
function finDuJour(date: string): Date {
  const soir = /^\d{4}-\d{2}-\d{2}$/.test(date) && instantDeParis(`${date}T23:59:59.999`);
  if (soir) return soir;
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Statut financier d'une commande — déduit, jamais stocké.
 *
 * Un champ figé finirait par mentir : il suffirait d'un remboursement
 * enregistré sans que personne pense à le mettre à jour. Ici la réponse vient
 * du montant encaissé et de la somme des remboursements, donc elle est juste
 * par construction.
 */
export function statutFinancier(
  o: { status: string; totalCents: number },
  rembourseCents: number,
): StatutFinancier {
  if (o.status === "cancelled" || o.status === "voided") return "voided";
  if (o.status === "draft") return "draft";
  if (o.status !== "paid")
    return o.status === "authorized" ? "authorized" : "pending";
  if (rembourseCents <= 0) return "paid";
  if (rembourseCents >= o.totalCents) return "refunded";
  return "partially_refunded";
}

export type StatutExpedition =
  | "unfulfilled"
  | "partially_fulfilled"
  | "fulfilled";

/**
 * Où en est la préparation : rien parti, une partie, ou tout.
 *
 * Rien à expédier du tout — des cartes cadeaux seules, parties par e-mail au
 * paiement — compte pour « tout est parti » : la commande ne doit pas
 * attendre sous « À expédier » un colis qui n'existera jamais.
 */
export function statutExpedition(
  commandes: number,
  expedies: number,
): StatutExpedition {
  if (commandes <= 0) return "fulfilled";
  if (expedies <= 0) return "unfulfilled";
  if (expedies < commandes) return "partially_fulfilled";
  return "fulfilled";
}

export const LIBELLE_FINANCIER: Record<StatutFinancier, string> = {
  draft: "Panier",
  pending: "En attente",
  authorized: "Autorisée",
  paid: "Payée",
  partially_refunded: "Remboursée en partie",
  refunded: "Remboursée",
  voided: "Annulée",
};

export const LIBELLE_EXPEDITION: Record<StatutExpedition, string> = {
  unfulfilled: "Non traitée",
  partially_fulfilled: "Partiellement traitée",
  fulfilled: "Traitée",
};

/* -------------------------------------------------------------------------- */
/*  Suppression définitive                                                    */
/* -------------------------------------------------------------------------- */

/** Les séries de numéros de commande, celles du compteur. */
const PREFIXES_NUMERO: readonly PrefixeNumero[] = ["WEB-", "SAL-"];

/**
 * Ce qu'il faut savoir d'une commande pour décider si elle peut partir pour
 * toujours. Des NOMBRES de lignes, lus en base par la route : la règle
 * elle-même ne touche à rien, et s'essaie sans base (tests/suppression-
 * commande.test.ts).
 */
export interface EtatCommandeASupprimer {
  status: string;
  /**
   * « salon » : une vente du stand, supprimable même payée (19/11). Absent :
   * une commande du site, sous la règle de la loi.
   */
  channel?: string | null;
  /**
   * Reprise de Shopify (SHOP-…, `legacyId`) : une vraie vente encaissée chez
   * Shopify, même rangée au stand. Elle ne profite jamais de l'exception du
   * stand.
   */
  reprise?: boolean;
  /**
   * Étiquettes SendCloud VIVANTES et réelles (achetée ou en cours, pas
   * d'essai) : seules elles retiennent une vente du stand. Une étiquette
   * annulée, en échec ou d'essai ne coûte rien.
   */
  bordereauxVivants?: number;
  /**
   * Paiements Stripe ou PayPal ouverts depuis moins de 48 h, pas encore
   * aboutis : la cliente est peut-être en train de payer (3-D Secure,
   * PayPal). Supprimer la commande perdrait la trace de cet argent.
   */
  paiementsEnCours?: number;
  invoiceNumber: string | null;
  /** Lignes de `refund`. */
  remboursements: number;
  /** Mouvements au grand livre (`order_transaction`), quels qu'ils soient. */
  mouvements: number;
  /**
   * Paiements dont le prestataire a dit autre chose que « en attente » :
   * encaissé, montant différent, en trop… De l'argent est passé.
   */
  paiementsAboutis: number;
  /** Expéditions (`fulfillment`), annulées comprises : un colis a existé. */
  expeditions: number;
  /** Étiquettes demandées à SendCloud (`bordereau`) : un achat a pu partir. */
  bordereaux: number;
  /** Dépenses de carte cadeau écrites sur cette commande. */
  depensesCarteCadeau: number;
  /** Part réglée en carte cadeau, figée sur la commande. */
  giftCardCents: number;
  /**
   * Vrai si son numéro (WEB-0042) est le plus haut de sa série : le compteur
   * prend le maximum + 1 (numeros-commande.ts), la supprimer redonnerait donc
   * ce numéro à la commande suivante.
   */
  dernierDeSaSerie: boolean;
}

/**
 * La raison pour laquelle une commande archivée ne peut PAS être supprimée,
 * ou null si elle le peut.
 *
 * La loi tranche l'essentiel : factures et pièces comptables se gardent dix
 * ans (art. L123-22 du Code de commerce), et une facture effacée laisserait
 * un trou dans une numérotation qui doit être continue (art. 242 nonies A de
 * l'annexe II au CGI). Une commande payée, remboursée ou facturée ne se
 * supprime donc JAMAIS — elle reste archivée, et c'est tout.
 *
 * Ce qui peut partir : un panier, ou une commande jamais payée (un virement
 * jamais arrivé, une annulation avant paiement), sans facture, sans un seul
 * mouvement d'argent, sans colis, sans étiquette, sans carte cadeau.
 *
 * Le doute retient : le moindre mouvement au grand livre suffit, même un
 * échec, parce que le grand livre est justement ce qu'on ne réécrit pas.
 *
 * SAUF une vente du STAND (19/11, Alexandra : « on va faire plein de tests,
 * donc faut qu'on puisse supprimer malgré la loi les commandes, et ceux qui
 * paient pas »). Elle naît payée (salon.ts), sans argent passé par un
 * prestataire : elle se supprime, payée, annulée, terminée ou non. Deux
 * choses la retiennent encore, parce qu'elles vivent hors d'ici : une
 * facture numérotée (la suite des numéros de facture), et une étiquette
 * SendCloud (un achat réel chez le transporteur).
 */
export function motifCommandeAGarder(e: EtatCommandeASupprimer): string | null {
  const suite = "Elle est gardée.";
  if (e.channel === "salon" && !e.reprise) {
    if (e.invoiceNumber)
      return `Cette vente a une facture (n° ${e.invoiceNumber}) : la suite des numéros de facture ne doit pas avoir de trou. ${suite}`;
    if ((e.bordereauxVivants ?? e.bordereaux) > 0)
      return `Une étiquette SendCloud est active pour cette vente : annulez-la d'abord (bloc « Bordereau transporteur »). ${suite}`;
    return null;
  }
  if ((e.paiementsEnCours ?? 0) > 0)
    return `Un paiement Stripe ou PayPal a été ouvert pour cette commande il y a moins de 48 h : la cliente est peut-être en train de payer. Annulez-la plutôt, et supprimez-la plus tard. ${suite}`;
  if (e.invoiceNumber)
    return `Cette commande a une facture (n° ${e.invoiceNumber}) : factures et pièces comptables se gardent dix ans, et la suite des numéros de facture ne doit pas avoir de trou. ${suite}`;
  if (e.remboursements > 0)
    return `Cette commande a été remboursée : c'est une pièce comptable, à garder dix ans. ${suite}`;
  if (e.status === "paid" || e.status === "authorized")
    return `Cette commande a été payée : c'est une vente, et ses pièces comptables se gardent dix ans. ${suite}`;
  if (e.mouvements > 0 || e.paiementsAboutis > 0)
    return `De l'argent a été enregistré pour cette commande (grand livre ou prestataire de paiement) : c'est une pièce comptable, à garder dix ans. ${suite}`;
  if (e.depensesCarteCadeau > 0 || e.giftCardCents > 0)
    return `Une carte cadeau a été dépensée sur cette commande : elle est la preuve de cette dépense. ${suite}`;
  if (e.expeditions > 0 || e.bordereaux > 0)
    return `Un colis ou une étiquette d'envoi a été préparé pour cette commande : elle garde la trace de ce qui est parti. ${suite}`;
  // Un panier porte un numéro DRAFT-, hors de toute série : jamais concerné.
  // Une commande en attente de virement, si : la cliente a reçu son numéro
  // par courriel, et le virer avec ce libellé l'attribuerait à une autre.
  if (e.dernierDeSaSerie)
    return `C'est la dernière commande numérotée de sa série : la supprimer redonnerait son numéro à la prochaine commande, alors que le client a pu le recevoir par courriel. Elle pourra partir dès qu'une commande plus récente aura été passée. ${suite}`;
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Factures : qui en reçoit une, sous quel nom, et d'où se demande le ZIP    */
/* -------------------------------------------------------------------------- */

/**
 * Ce qu'il faut savoir d'une commande cochée pour décider si le ZIP des
 * factures (GET /admin/factures.zip) lui en fait une. Lu en base par la
 * route ; la règle elle-même ne touche à rien et s'essaie sans base
 * (tests/factures-zip.test.ts).
 */
export interface CommandeAFacturer {
  number: string;
  channel: string;
  status: string;
  tags?: unknown;
  /** Non nul : une commande reprise de Shopify (17/11). */
  legacyId: number | null;
  /** Son numéro chez Shopify (« #1042 »). */
  legacyName?: string | null;
  invoiceNumber: string | null;
}

/**
 * Pourquoi le ZIP des factures ne fait PAS la facture de cette commande, ou
 * null s'il la fait.
 *
 * Un numéro de facture se donne à la première édition et ne se reprend
 * jamais : la suite doit rester continue, sans trou (art. 242 nonies A de
 * l'annexe II au CGI). Or une sélection de Ventes stand mêle des ventes
 * payées, des annulées, des ventes de test, parfois une vente rouverte : les
 * facturer toutes aurait pris des numéros pour des ventes qui n'ont pas eu
 * lieu — et une vente du stand qui a une facture ne se supprime plus
 * (motifCommandeAGarder). Relecture du 20/11.
 *
 * Dans l'ordre :
 *   1. une reprise de Shopify : réglée et facturée là-bas, jamais ici ;
 *   2. un panier, vente rouverte et pas revalidée comprise : rien à facturer
 *      (composerLaFacture le refuse aussi) ;
 *   3. une commande qui a DÉJÀ sa facture la garde, même annulée depuis — son
 *      PDF le dit : rien de neuf n'est numéroté ;
 *   4. sinon, une annulée (vente de test comprise) ou une commande pas
 *      encore payée n'en reçoit pas.
 *
 * La raison est courte, sans point final : elle suit le numéro de la
 * commande dans « factures-non-faites.txt » et dans le message du BO.
 */
export function raisonSansFactureDansLeZip(o: CommandeAFacturer): string | null {
  if (o.legacyId != null)
    return `reprise de Shopify${o.legacyName ? ` (${o.legacyName})` : ""}, réglée et facturée là-bas`;
  if (o.status === "draft")
    // Une vente du stand rouverte garde son SAL- (salon.ts) : c'est elle.
    return /^SAL-\d+$/.test(o.number)
      ? o.invoiceNumber
        ? `vente rouverte sur la tablette et pas revalidée ; sa facture ${o.invoiceNumber} existe déjà et se réédite une fois la vente revalidée`
        : "vente rouverte sur la tablette et pas revalidée, redevenue un panier"
      : "panier, pas une commande";
  if (o.invoiceNumber) return null;
  if (estVenteDeTest(o)) return "vente de test";
  if (STATUTS_ANNULES.includes(o.status)) return "annulée";
  if (o.status !== "paid") return "pas encore payée";
  return null;
}

/** Une commande cochée que le ZIP n'a pas facturée : son numéro de commande, et pourquoi. */
export interface FactureNonFaite {
  /** Le numéro de la liste (SAL-0012, WEB-1042), jamais l'identifiant interne. */
  numero: string;
  raison: string;
}

/** Une raison sans son point final : la phrase qui la cite met le sien. */
function sansPointFinal(raison: string): string {
  return raison.trim().replace(/[\s.]+$/, "");
}

/** La phrase des commandes cochées qui n'existent plus, ou null s'il n'y en a pas. */
function phraseIntrouvables(introuvables: number): string | null {
  if (introuvables <= 0) return null;
  return introuvables > 1
    ? `${introuvables} commandes cochées n'existent plus (supprimées depuis l'affichage de la liste).`
    : "Une commande cochée n'existe plus (supprimée depuis l'affichage de la liste).";
}

/**
 * Le contenu de « factures-non-faites.txt », rangé dans le ZIP à côté des
 * factures : chaque commande cochée qui n'en a pas, par son NUMÉRO de
 * commande et avec sa raison. Aucune n'a reçu de numéro de facture, et le
 * fichier le dit.
 */
export function texteFacturesNonFaites(
  nonFaites: readonly FactureNonFaite[],
  introuvables = 0,
): string {
  const lignes = nonFaites.map((n) => `${n.numero} : ${sansPointFinal(n.raison)}.`);
  const perdues = phraseIntrouvables(introuvables);
  if (perdues) lignes.push(perdues);
  return `Factures non faites : ce téléchargement n'a donné aucun numéro de facture à ces commandes.\n\n${lignes.join("\n")}\n`;
}

/**
 * Le refus quand aucune des commandes cochées n'a de facture à faire : les
 * premières avec leur raison, puis combien d'autres, pour que la phrase
 * tienne dans le message du back-office.
 */
export function messageAucuneFacture(
  nonFaites: readonly FactureNonFaite[],
  introuvables = 0,
  max = 6,
): string {
  const perdues = phraseIntrouvables(introuvables);
  if (!nonFaites.length)
    return `${perdues ?? "Aucune commande cochée."} Rechargez la page : aucune facture n'a été faite.`;
  const vues = nonFaites.slice(0, max).map((n) => `${n.numero} (${sansPointFinal(n.raison)})`);
  const autres = nonFaites.length - vues.length;
  const liste =
    autres > 0
      ? `${vues.join(", ")} et ${autres} autre${autres > 1 ? "s" : ""}`
      : vues.length > 1
        ? `${vues.slice(0, -1).join(", ")} et ${vues[vues.length - 1]}`
        : vues[0];
  return `Aucune facture à faire parmi les commandes cochées, et aucun numéro de facture n'a été donné : ${liste}.${perdues ? ` ${perdues}` : ""}`;
}

/**
 * Vrai si la requête peut venir du back-office lui-même.
 *
 * GET /admin/factures.zip NUMÉROTE des factures. Un lien piégé — sur une autre
 * page, dans un courriel —, ouvert par la propriétaire connectée, en ferait
 * à son insu : le cookie de session (« SameSite=Lax ») accompagne une
 * navigation venue d'ailleurs. L'en-tête « Sec-Fetch-Site », que le
 * navigateur pose et qu'aucune page ne peut écrire à sa place, dit d'où part
 * la requête : seul « same-origin » passe — le bouton du back-office, qui
 * télécharge par fetch, servi à la même adresse que l'API derrière le
 * proxy. « none » (un lien cliqué dans Outlook ou Thunderbird, une adresse
 * tapée), « same-site » et « cross-site » sont refusés (relecture du
 * 20/11). Sans l'en-tête (navigateur ancien, outil en ligne de commande),
 * rien ne se décide ici : la session reste exigée, comme partout.
 */
export function requeteDuBackOffice(secFetchSite: string | null | undefined): boolean {
  if (secFetchSite === undefined || secFetchSite === null) return true;
  return secFetchSite.trim().toLowerCase() === "same-origin";
}

/**
 * Un nom de fichier en ASCII imprimable : accents retirés, tout autre
 * caractère remplacé par « _ », barres comprises (dans un ZIP, « / » rangerait
 * le fichier dans un dossier). Même règle que les noms des affiches de
 * démonstration (archive-zip.ts).
 */
export function nomEnAscii(nom: string): string {
  return (
    nom
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^\x20-\x7e]|[/\\]/g, "_")
      .trim() || "fichier"
  );
}

/**
 * L'en-tête Content-Disposition d'un fichier, quel que soit son nom.
 *
 * Un en-tête HTTP ne porte que des octets : un nom en japonais y faisait
 * lever une exception, et la facture d'une cliente japonaise répondait 500.
 * Le nom part donc en ASCII dans `filename`, que lisent tous les navigateurs,
 * et, s'il y perdait quelque chose, en entier dans `filename*` (RFC 6266 et
 * 5987), que les navigateurs préfèrent quand il est là.
 */
export function dispositionDuFichier(mode: "inline" | "attachment", nom: string): string {
  const ascii = nomEnAscii(nom).replace(/["\\]/g, "_");
  if (ascii === nom) return `${mode}; filename="${ascii}"`;
  const encode = encodeURIComponent(nom).replace(
    /['()*]/g,
    (signe) => `%${signe.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${mode}; filename="${ascii}"; filename*=UTF-8''${encode}`;
}

/**
 * Le nom du PDF d'une facture : « Facture_F2026-0001_SAL-0012.pdf », dans la
 * langue du PDF.
 *
 * Japonais et chinois sortent en anglais (« Invoice_… »), comme le PDF
 * lui-même : Helvetica n'a pas leurs caractères (renderInvoicePdf, pdf.ts,
 * 18/11). « 請求書 » dans le nom faisait en plus répondre 500 au
 * téléchargement (voir dispositionDuFichier). Toujours en ASCII : c'est aussi
 * le nom de la pièce jointe du courriel et celui du fichier dans le ZIP, que
 * l'Explorateur de Windows lit mal hors de l'ASCII.
 */
export function nomDuFichierDeFacture(
  langue: Langue,
  numeroFacture: string,
  numeroCommande: string,
): string {
  const langueDuPdf: Langue = langue === "ja" || langue === "zh" ? "en" : langue;
  return nomEnAscii(
    `${tc(langueDuPdf)("facturePdf.nomFichier")}_${numeroFacture}_${numeroCommande}.pdf`,
  );
}

/** Lien de suivi public, quand on sait le fabriquer. */
export function lienDeSuivi(
  carrier: string | null | undefined,
  numero: string | null | undefined,
): string | null {
  if (!numero) return null;
  const c = (carrier ?? "").toLowerCase();
  const n = encodeURIComponent(numero.trim());
  if (c.includes("mondial"))
    return `https://www.mondialrelay.fr/suivi-de-colis?numeroExpedition=${n}`;
  if (c.includes("colissimo") || c.includes("poste"))
    return `https://www.laposte.fr/outils/suivre-vos-envois?code=${n}`;
  if (c.includes("chronopost"))
    return `https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=${n}`;
  if (c.includes("dhl"))
    return `https://www.dhl.com/fr-fr/home/tracking.html?tracking-id=${n}`;
  if (c.includes("ups")) return `https://www.ups.com/track?tracknum=${n}`;
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Agrégats                                                                  */
/* -------------------------------------------------------------------------- */

export interface ResumeCommande {
  articles: number;
  expedies: number;
  rembourseCents: number;
}

/**
 * Pour un lot de commandes : quantités commandées, quantités parties et
 * montant déjà remboursé. Trois requêtes pour toute la page — une par
 * commande transformerait la liste en salle d'attente.
 */
export async function resumeCommandes(
  ids: number[],
): Promise<Map<number, ResumeCommande>> {
  const out = new Map<number, ResumeCommande>();
  if (!ids.length) return out;
  for (const id of ids)
    out.set(id, { articles: 0, expedies: 0, rembourseCents: 0 });

  /*
   * Les trois lectures partent ENSEMBLE : aucune n'a besoin des autres, elles
   * ne font que remplir trois colonnes du même tableau.
   *
   * La base est à 110 ms d'aller-retour (Neon, Ohio) : enchaînées, elles
   * coûtaient un tiers de seconde d'attente pure à chaque ouverture de la
   * liste des commandes.
   */
  const [lignes, partis, rembourses] = await Promise.all([
    // Les cartes cadeaux ne comptent pas parmi les articles à expédier : elles
    // partent par e-mail au paiement. Une commande qui n'en a pas d'autres n'a
    // rien à expédier (statutExpedition).
    db
      .select({
        orderId: schema.orderItems.orderId,
        id: schema.orderItems.id,
        quantity: schema.orderItems.quantity,
      })
      .from(schema.orderItems)
      .where(
        and(
          inArray(schema.orderItems.orderId, ids),
          isNull(schema.orderItems.giftCard),
        ),
      ),
    // Seules les expéditions non annulées comptent comme parties.
    db
      .select({
        orderItemId: schema.fulfillmentItems.orderItemId,
        quantity: schema.fulfillmentItems.quantity,
        status: schema.fulfillments.status,
      })
      .from(schema.fulfillmentItems)
      .innerJoin(
        schema.fulfillments,
        eq(schema.fulfillmentItems.fulfillmentId, schema.fulfillments.id),
      )
      .where(inArray(schema.fulfillments.orderId, ids)),
    db
      .select({
        orderId: schema.refunds.orderId,
        amountCents: schema.refunds.amountCents,
      })
      .from(schema.refunds)
      .where(inArray(schema.refunds.orderId, ids)),
  ]);

  const commandeDeLigne = new Map<number, number>();
  for (const l of lignes) {
    out.get(l.orderId)!.articles += l.quantity;
    commandeDeLigne.set(l.id, l.orderId);
  }

  for (const p of partis) {
    if (p.status !== "success") continue;
    const oid = commandeDeLigne.get(p.orderItemId);
    if (oid != null) out.get(oid)!.expedies += p.quantity;
  }

  for (const r of rembourses)
    out.get(r.orderId)!.rembourseCents += r.amountCents;

  return out;
}

/* -------------------------------------------------------------------------- */
/*  Étapes de traitement (17/11)                                              */
/* -------------------------------------------------------------------------- */

/**
 * Les commandes de ce lot qui ont un VRAI bordereau SendCloud : acheté, ou
 * dont l'achat est en cours. Une lettre d'essai ne compte pas : elle ne
 * voyage pas. Un tel colis a son étiquette : on ne revient plus avant
 * « Envoyée », et un retrait qui en a un voyage comme une livraison.
 */
export async function avecBordereauReel(ids: number[]): Promise<Set<number>> {
  if (!ids.length) return new Set();
  const rows = await db
    .select({ orderId: schema.bordereaux.orderId })
    .from(schema.bordereaux)
    .where(
      and(
        inArray(schema.bordereaux.orderId, ids),
        inArray(schema.bordereaux.statut, ["achete", "en_cours"]),
        eq(schema.bordereaux.essai, false),
      ),
    );
  return new Set(rows.map((r) => r.orderId));
}

/**
 * Le parcours et l'étape d'une commande (packages/types/src/traitement.ts) :
 * la liste, l'export et la frise de la fiche les lisent tous ici.
 */
export function etapeDeLaCommande(
  o: Parameters<typeof lieuDeRetrait>[0] & {
    channel: string;
    status: string;
    readyAt: Date | null;
    deliveredAt: Date | null;
  },
  s: ResumeCommande,
  bordereauReel: boolean,
): { parcours: ParcoursTraitement; etape: EtapeTraitement } {
  const parcours = parcoursDe({
    channel: o.channel,
    retrait: lieuDeRetrait(o) !== null,
    bordereauReel,
  });
  return {
    parcours,
    etape: etapeDe(parcours, {
      status: o.status,
      articles: s.articles,
      expedies: s.expedies,
      readyAt: o.readyAt,
      deliveredAt: o.deliveredAt,
    }),
  };
}

// Un passage d'étape à la fois par commande : verrou-commande.ts (sorti
// d'ici le 26/11, pour que « Revenir à ma commande » de la tablette le
// prenne aussi).

/** Le nom des transporteurs de SendCloud, comme le formulaire « Expédier » de la fiche. */
const NOM_TRANSPORTEUR_SENDCLOUD: Record<string, string> = {
  mondial_relay: "Mondial Relay",
  colissimo: "Colissimo",
  chronopost: "Chronopost",
};

/* -------------------------------------------------------------------------- */
/*  Petits outils                                                             */
/* -------------------------------------------------------------------------- */

/** Normalise une étiquette : casse et espaces ne doivent pas faire doublon. */
function etiquette(v: unknown): string {
  return String(v ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 40);
}

/** Fusionne deux listes d'étiquettes sans doublon, en gardant l'ordre. */
function fusionner(a: string[], b: string[]): string[] {
  const vus = new Set(a.map((t) => t.toLowerCase()));
  const out = [...a];
  for (const t of b)
    if (t && !vus.has(t.toLowerCase())) {
      vus.add(t.toLowerCase());
      out.push(t);
    }
  return out;
}

/** Échappe une cellule CSV (Excel français : point-virgule, guillemets doublés). */
function cellule(v: unknown): string {
  const s = String(v ?? "");
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Quantités déjà expédiées, par ligne de commande. */
async function quantitesExpediees(
  orderId: number,
): Promise<Map<number, number>> {
  const rows = await db
    .select({
      orderItemId: schema.fulfillmentItems.orderItemId,
      quantity: schema.fulfillmentItems.quantity,
      status: schema.fulfillments.status,
    })
    .from(schema.fulfillmentItems)
    .innerJoin(
      schema.fulfillments,
      eq(schema.fulfillmentItems.fulfillmentId, schema.fulfillments.id),
    )
    .where(eq(schema.fulfillments.orderId, orderId));
  const m = new Map<number, number>();
  for (const r of rows)
    if (r.status === "success")
      m.set(r.orderItemId, (m.get(r.orderItemId) ?? 0) + r.quantity);
  return m;
}

/** Quantités déjà remboursées, par ligne de commande. */
async function quantitesRemboursees(
  orderId: number,
): Promise<Map<number, number>> {
  const rows = await db
    .select({
      orderItemId: schema.refundItems.orderItemId,
      quantity: schema.refundItems.quantity,
    })
    .from(schema.refundItems)
    .innerJoin(schema.refunds, eq(schema.refundItems.refundId, schema.refunds.id))
    .where(eq(schema.refunds.orderId, orderId));
  const m = new Map<number, number>();
  for (const r of rows)
    m.set(r.orderItemId, (m.get(r.orderItemId) ?? 0) + r.quantity);
  return m;
}

/**
 * Remet en stock ce qui a été rendu ou annulé.
 *
 * Seules les variantes qui TIENNENT un stock sont touchées : une affiche est
 * imprimée à la commande et n'a rien à réintégrer, alors qu'un magnet ou une
 * carte, eux, sont revenus dans le tiroir. Le `is not null` fait la
 * différence, et il est dans la clause SQL plutôt que dans une lecture
 * préalable — sinon deux annulations simultanées liraient le même stock avant
 * de l'écrire toutes les deux.
 *
 * Écrite une fois, appelée par le remboursement ET par l'annulation : deux
 * additions de stock finiraient par diverger sur le cas des variantes sans
 * stock, qui est justement le cas courant ici.
 */
async function remettreEnStock(
  lignes: (typeof schema.orderItems.$inferSelect)[],
  quantites: Map<number, number>,
): Promise<void> {
  for (const ligne of lignes) {
    const q = quantites.get(ligne.id) ?? 0;
    if (q <= 0 || !ligne.variantId) continue;
    await db
      .update(schema.variants)
      .set({
        stockQty: raw`coalesce(${schema.variants.stockQty}, 0) + ${q}`,
      })
      .where(
        and(
          eq(schema.variants.id, ligne.variantId),
          raw`${schema.variants.stockQty} is not null`,
        ),
      );
  }
}

/**
 * Ce qui reste remboursable sur les frais de port d'une commande.
 *
 * Le port ne se rembourse pas par article : c'est une somme unique, qu'on rend
 * en une ou plusieurs fois. Il faut donc retrancher ce qui en est déjà parti,
 * et cette soustraction se fait ici seulement — le bouton « Rembourser » et
 * l'annulation d'une commande payée s'appuient sur la même.
 */
async function portRemboursable(
  orderId: number,
  portFactureCents: number,
): Promise<number> {
  const rendus = await db
    .select({ v: schema.refunds.shippingCents })
    .from(schema.refunds)
    .where(eq(schema.refunds.orderId, orderId));
  return Math.max(0, portFactureCents - rendus.reduce((s, r) => s + r.v, 0));
}

/**
 * Les commandes de ce lot qui ne peuvent plus rien expédier.
 *
 * Une commande annulée reste lisible et gardera son histoire, mais elle ne
 * doit plus RIEN faire partir : c'est tout le sens de l'annulation. Le
 * contrôle vit ici, en une requête pour tout le lot, et non dans l'écran —
 * une adresse tapée à la main doit buter sur la même règle.
 */
async function commandesAnnulees(ids: number[]): Promise<Set<number>> {
  if (!ids.length) return new Set();
  const rows = await db
    .select({ id: schema.orders.id, status: schema.orders.status })
    .from(schema.orders)
    .where(inArray(schema.orders.id, ids));
  return new Set(
    rows.filter((r) => r.status === "cancelled" || r.status === "voided").map((r) => r.id),
  );
}

/**
 * Expédie d'un coup tout ce qui reste sur un lot de commandes.
 *
 * Rend la liste de celles où quelque chose est RÉELLEMENT parti, et celle des
 * annulées qu'on a refusé de toucher. L'appelante en a besoin pour deux
 * choses : ne prévenir que les clientes dont le colis part vraiment, et dire à
 * l'écran combien de commandes ont été écartées, plutôt que d'annoncer
 * « 30 commandes traitées » quand deux d'entre elles étaient annulées.
 *
 * `envoi` : le transporteur et le suivi du colis, quand on les connaît
 * (l'étape « Envoyée » de la fiche, ou le vrai bordereau de la commande).
 */
async function expedierTout(
  ids: number[],
  envoi: {
    carrier?: string | null;
    trackingNumber?: string | null;
    trackingUrl?: string | null;
  } = {},
): Promise<{ expediees: number[]; annulees: number[] }> {
  const annulees = await commandesAnnulees(ids);
  const expediees: number[] = [];
  for (const id of ids) {
    // Une commande annulée ne fait plus rien partir. Elle est écartée ici,
    // dans la fonction qui écrit, et pas seulement dans l'écran : un écran qui
    // masque un bouton est une politesse, pas une garde.
    if (annulees.has(id)) continue;
    // Les cartes cadeaux partent par e-mail, au paiement : rien à expédier.
    const lignes = (
      await db
        .select()
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, id))
    ).filter((l) => !l.giftCard);
    const partis = await quantitesExpediees(id);
    const reste = lignes
      .map((l) => ({
        orderItemId: l.id,
        quantity: l.quantity - (partis.get(l.id) ?? 0),
      }))
      .filter((l) => l.quantity > 0);
    if (!reste.length) continue;
    const [ful] = await db
      .insert(schema.fulfillments)
      .values({ orderId: id, status: "success", ...envoi })
      .returning();
    await db
      .insert(schema.fulfillmentItems)
      .values(reste.map((l) => ({ ...l, fulfillmentId: ful!.id })));
    expediees.push(id);
  }
  return { expediees, annulees: [...annulees] };
}

/** Annule toutes les expéditions en cours d'un lot de commandes. */
async function annulerExpeditions(ids: number[]): Promise<void> {
  await db
    .update(schema.fulfillments)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(
      and(
        inArray(schema.fulfillments.orderId, ids),
        eq(schema.fulfillments.status, "success"),
      ),
    );
}

/* -------------------------------------------------------------------------- */
/*  Routes                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Le vendeur ne voit que les ventes des stands qui lui sont confiés.
 *
 * Rend les conditions à AJOUTER aux siennes, quoi qu'il demande. Le
 * propriétaire, lui, ne reçoit rien de plus : il voit tout. Un vendeur sans
 * stand ne voit rien (la règle entière est dans vendeurs.ts).
 *
 * Le filtre vit dans la requête et non dans l'écran : un écran qui masque un
 * bouton est une politesse, pas une garde. Une adresse tapée à la main doit
 * buter sur la même règle.
 */
function limiterAuStand(c: Context): SQL[] {
  return bornesDuVendeur(c.get("utilisateur"));
}

/**
 * Le filtre « test » de la liste et de l'export (20/11, Alexandra : « il
 * faudrait ajouter "test" comme ça on peut mettre des commandes en test ») :
 * « seul » ne garde que les ventes de test, « exclure » les écarte.
 *
 * La règle de ventes-de-test.ts, `estVenteDeTest` : une vente du stand,
 * annulée ET étiquetée « test », la casse ignorée — les étiquettes se
 * relisent en minuscules, le tableau entier repassé par le JSON. Sans
 * étiquette, une commande n'est pas de test : le `coalesce` le dit, sans quoi
 * « exclure » l'écarterait aussi (`not null` n'est pas vrai). Le canal y est
 * depuis la relecture (20/11) : Ventes stand demande de toute façon le sien,
 * mais une commande du site annulée et étiquetée n'est pas une vente de test.
 *
 * Dans la requête, et non après coup comme l'étaient, jusqu'au 26/11,
 * l'étiquette et les statuts : la liste s'arrête à cent lignes, et un filtre
 * posé ensuite chercherait les ventes de test parmi les cent plus récentes
 * seulement — l'onglet « Test » perdrait les plus anciennes, et « Toutes »
 * montrerait moins de cent ventes. (Les filtres calculés passent désormais
 * avant la limite : LIGNES_LUES_AVANT_FILTRE.)
 */
function conditionVentesDeTest(filtre: FiltreTest): SQL {
  const deTest = and(
    eq(schema.orders.channel, "salon"),
    inArray(schema.orders.status, [...STATUTS_ANNULES]),
    raw`coalesce(lower(${schema.orders.tags}::text)::jsonb @> ${JSON.stringify([ETIQUETTE_TEST])}::jsonb, false)`,
  )!;
  return filtre === "seul" ? deTest : raw`not (${deTest})`;
}

/**
 * Combien de commandes la liste lit, au plus, quand un filtre calculé
 * (statut, étape, parcours, étiquette) doit passer AVANT sa limite (relecture
 * du 26/11, GET /admin/orders). Large devant la boutique — quelques milliers
 * de commandes, reprises de Shopify comprises — et borné quand même : la
 * page ne doit jamais tout charger.
 */
const LIGNES_LUES_AVANT_FILTRE = 10_000;

export function mountOrderRoutes(app: Hono): void {
  /**
   * Liste des commandes, filtrable.
   *
   * Tous les filtres se combinent : c'est ce qui permet de répondre à « les
   * commandes payées, pas encore parties, de la semaine dernière » sans
   * sortir un tableur.
   */
  app.get("/admin/orders", async (c) => {
    const q = c.req.query();
    const limit = Math.min(Number(q.limit ?? 100), 500);
    // Statuts, étapes, parcours et étiquette se déduisent de plusieurs
    // tables : ils se filtrent en JavaScript, plus bas. AVANT la limite
    // désormais (relecture du 26/11) : filtrés après, une vente du stand « À
    // imprimer » qui n'était pas parmi les 100 dernières ne sortait jamais
    // sous « Statuts → À imprimer », alors que « À traiter » la comptait — et
    // depuis le 26/11, chaque vente du stand attend que Margaux la marque
    // terminée. Les lignes sont donc lues sans la limite (dans une borne
    // large), filtrées, puis coupées ; seules celles qui restent sont
    // complétées (aperçus, paiements, montant).
    const fin = (q.financial ?? "").split(",").filter(Boolean);
    const exp = (q.fulfillment ?? "").split(",").filter(Boolean);
    const etapes = (q.etape ?? "").split(",").filter(Boolean);
    const parcoursDemandes = (q.parcours ?? "").split(",").filter(Boolean);
    const tag = (q.tag ?? "").trim().toLowerCase();
    const filtreApres = fin.length > 0 || exp.length > 0 || etapes.length > 0 || parcoursDemandes.length > 0 || !!tag;
    const conditions = [];
    // Les archivées sont hors de la liste ordinaire, et « archived=1 » les
    // montre SEULES : c'est la vue « Commandes archivées ». Les mélanger aux
    // autres ferait une liste où l'on ne saurait plus ce qui est rangé.
    conditions.push(
      q.archived === "1"
        ? isNotNull(schema.orders.archivedAt)
        : isNull(schema.orders.archivedAt),
    );
    if (q.channel === "web" || q.channel === "salon")
      conditions.push(eq(schema.orders.channel, q.channel));
    // Les paniers en cours ne sont pas des commandes : ils ont leur écran,
    // « Paniers abandonnés ». Dans « Toutes » et « Non traitées », ils
    // noyaient les vraies commandes sous des lignes « Panier, 0 €, aucun
    // client ». Ils ne viennent que si on les demande (statut « Panier »).
    if (!(q.financial ?? "").split(",").includes("draft"))
      conditions.push(raw`${schema.orders.status} <> 'draft'`);
    // Un stand précis : c'est la question qu'on se pose au retour d'un salon,
    // « combien celui-là a-t-il fait ».
    const stand = Number(q.stand);
    if (Number.isInteger(stand) && stand > 0)
      conditions.push(eq(schema.orders.standId, stand));
    conditions.push(...limiterAuStand(c));
    // Les ventes de test (20/11) : « test=seul », « test=exclure ». Sans le
    // paramètre, rien ne change — les autres écrans voient ce qu'ils voyaient.
    const test = lireFiltreTest(q.test);
    if (test) conditions.push(conditionVentesDeTest(test));
    if (q.from) conditions.push(gte(schema.orders.createdAt, debutDuJour(q.from)));
    if (q.to) conditions.push(lte(schema.orders.createdAt, finDuJour(q.to)));
    const cherche = (q.q ?? "").trim();
    if (cherche) {
      const motif = `%${cherche.toLowerCase()}%`;
      conditions.push(
        or(
          raw`lower(${schema.orders.number}) like ${motif}`,
          raw`lower(coalesce(${schema.orders.legacyName}, '')) like ${motif}`,
          raw`lower(coalesce(${schema.customers.name}, '')) like ${motif}`,
          raw`lower(coalesce(${schema.customers.email}, '')) like ${motif}`,
          raw`lower(coalesce(${schema.orders.shippingCity}, '')) like ${motif}`,
        )!,
      );
    }

    const lues = await db
      .select({
        id: schema.orders.id,
        number: schema.orders.number,
        channel: schema.orders.channel,
        status: schema.orders.status,
        totalCents: schema.orders.totalCents,
        legacyName: schema.orders.legacyName,
        createdAt: schema.orders.createdAt,
        fulfilledAt: schema.orders.fulfilledAt,
        shippingLabel: schema.orders.shippingLabel,
        shippingMethod: schema.orders.shippingMethod,
        tags: schema.orders.tags,
        // Une vente du stand facturée garde son montant (26/11,
        // montant-vente-stand.ts) : Ventes stand le dit au lieu de proposer
        // de le corriger.
        invoiceNumber: schema.orders.invoiceNumber,
        // Avec la reprise de Shopify et la carte cadeau, ce que la règle de
        // la correction lit (refusMontant, plus bas). Ni l'une ni l'autre ne
        // repart dans la réponse.
        legacyId: schema.orders.legacyId,
        giftCardCents: schema.orders.giftCardCents,
        customerId: schema.orders.customerId,
        customerName: schema.customers.name,
        customerEmail: schema.customers.email,
        // L'étape de traitement (17/11) : ses deux dates, et de quoi savoir
        // si c'est un retrait.
        readyAt: schema.orders.readyAt,
        deliveredAt: schema.orders.deliveredAt,
        pickupPoint: schema.orders.pickupPoint,
        relayPointId: schema.orders.relayPointId,
        relayPointLabel: schema.orders.relayPointLabel,
      })
      .from(schema.orders)
      .leftJoin(
        schema.customers,
        eq(schema.orders.customerId, schema.customers.id),
      )
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.orders.createdAt))
      .limit(filtreApres ? LIGNES_LUES_AVANT_FILTRE : limit);

    const [resume, bordereauxReels] = await Promise.all([
      resumeCommandes(lues.map((r) => r.id)),
      avecBordereauReel(lues.map((r) => r.id)),
    ]);
    // Les filtres calculés, puis la limite (relecture du 26/11, voir plus
    // haut) : mêmes règles qu'avant, sur toutes les lignes lues.
    const rows = filtreApres
      ? lues
          .filter((r) => {
            const s = resume.get(r.id)!;
            if (fin.length && !fin.includes(statutFinancier(r, s.rembourseCents))) return false;
            if (exp.length && !exp.includes(statutExpedition(s.articles, s.expedies))) return false;
            if (etapes.length || parcoursDemandes.length) {
              const { parcours, etape } = etapeDeLaCommande(r, s, bordereauxReels.has(r.id));
              if (etapes.length && !etapes.includes(etape)) return false;
              if (parcoursDemandes.length && !parcoursDemandes.includes(parcours)) return false;
            }
            if (tag && !(r.tags ?? []).some((t) => t.toLowerCase() === tag)) return false;
            return true;
          })
          .slice(0, limit)
      : lues;
    // Les aperçus des premières affiches de chaque commande, pour la liste
    // (demande de la boutique : voir les affiches sans ouvrir la commande,
    // comme dans le panier). Trois au plus ; le reste se dit « +N ».
    const lignesApercu = rows.length
      ? await db
          .select({
            id: schema.orderItems.id,
            orderId: schema.orderItems.orderId,
            title: schema.orderItems.title,
            config: schema.orderItems.config,
            format: raw<string | null>`(${schema.orderItems.config} ->> 'format')`,
            imprimable: raw<boolean>`(${schema.orderItems.config} is not null)`,
            // Le choix du client, pour Ventes stand (26/11) : cadre, sens et
            // quantité de chaque affiche.
            quantity: schema.orderItems.quantity,
            cadreId: raw<string | null>`(${schema.orderItems.config} ->> 'frameId')`,
            orientation: raw<string | null>`(${schema.orderItems.config} ->> 'orientation')`,
          })
          .from(schema.orderItems)
          .where(inArray(schema.orderItems.orderId, rows.map((r) => r.id)))
          .orderBy(asc(schema.orderItems.id))
      : [];
    // Le nom des cadres, lu comme la fiche le lit (configurator-routes.ts,
    // GET /admin/orders/:id) : la configuration n'en garde que l'identifiant.
    // Un cadre s'archive, il ne disparaît pas : son nom se relit toujours.
    const nomDuCadre = new Map(
      (lignesApercu.length
        ? await db.select({ id: schema.frames.id, name: schema.frames.name }).from(schema.frames)
        : []
      ).map((f) => [String(f.id), f.name]),
    );
    const apercusParCommande = new Map<number, string[]>();
    const lignesParCommande = new Map<number, number>();
    // Les affiches à imprimer de chaque commande, dans l'ordre des vignettes :
    // la liste propose leurs PDF sans ouvrir la commande (demande de la
    // boutique), « 1 », « 2 »… comme les vignettes de gauche à droite.
    //
    // Avec le choix du client (26/11, Margaux : « pouvoir voir le choix du
    // client (format/cadre) au lieu de "Remise sur le stand" par exemple qui
    // ne sert à rien ») : Ventes stand montre, par affiche, le format, le
    // cadre (null : sans cadre), le sens et la quantité.
    const affichesParCommande = new Map<
      number,
      {
        id: number;
        titre: string | null;
        format: string | null;
        cadre: string | null;
        paysage: boolean;
        quantite: number;
      }[]
    >();
    for (const l of lignesApercu) {
      const liste = apercusParCommande.get(l.orderId) ?? [];
      // Une carte cadeau n'a pas d'aperçu : rien n'est composé.
      if (liste.length < 3 && l.config) liste.push(cheminApercu(l.id, l.config));
      lignesParCommande.set(l.orderId, (lignesParCommande.get(l.orderId) ?? 0) + 1);
      apercusParCommande.set(l.orderId, liste);
      if (l.imprimable)
        affichesParCommande.set(l.orderId, [
          ...(affichesParCommande.get(l.orderId) ?? []),
          {
            id: l.id,
            titre: l.title,
            format: l.format,
            cadre: nomDuCadre.get(String(l.cadreId ?? "")) ?? null,
            paysage: l.orientation === "paysage",
            quantite: l.quantity,
          },
        ]);
    }
    // Les ventes payées avec les clés d'ESSAI alors que la boutique encaisse
    // pour de vrai : la liste les signale, sans quoi elles passent pour de
    // vraies ventes. Rien à lire tant que la boutique est en essai.
    const config = await configPaiement();
    const enEssai = new Set<number>();
    if (rows.length && (config.modeVoulu.stripe === "live" || config.modeVoulu.paypal === "live")) {
      const lignesPaiement = await db
        .select({
          orderId: schema.payments.orderId,
          provider: schema.payments.provider,
          status: schema.payments.status,
          mode: schema.payments.mode,
        })
        .from(schema.payments)
        .where(
          and(
            inArray(schema.payments.orderId, rows.map((r) => r.id)),
            eq(schema.payments.status, "succeeded"),
          ),
        );
      for (const l of lignesPaiement) if (payeeEnEssai([l], config)) enEssai.add(l.orderId);
    }
    // Le total d'une vente du stand se corrige DANS LA LIGNE de Ventes stand
    // (26/11, Margaux : « commande stand pouvoir modifier directement le
    // total dans la ligne. Car si elle applique des réductions par ex,
    // faudrait juste le total indépendamment du reste. Juste les commandes
    // stands ! »). La liste dit pour chaque vente du stand si son total se
    // corrige, et sinon pourquoi (`refusMontant`) : la règle de la route qui
    // corrige (refusDeCorrection, montant-vente-stand.ts), avec ce qu'elle
    // lit au grand livre et aux remboursements, en deux requêtes pour toute
    // la page. L'écran montre alors le total en texte, la raison en
    // info-bulle. Les commandes du site n'en reçoivent pas : leur écran ne
    // change pas.
    const idsDuStand = rows.filter((r) => r.channel === "salon").map((r) => r.id);
    const [avecOrigine, remboursementsParVente] = idsDuStand.length
      ? await Promise.all([
          db
            .select({ orderId: schema.orderTransactions.orderId })
            .from(schema.orderTransactions)
            .where(
              and(
                inArray(schema.orderTransactions.orderId, idsDuStand),
                eq(schema.orderTransactions.kind, "sale"),
                eq(schema.orderTransactions.status, "success"),
                isNull(schema.orderTransactions.parentId),
              ),
            )
            .then((l) => new Set(l.map((e) => e.orderId))),
          db
            .select({ orderId: schema.refunds.orderId, n: raw<number>`count(*)::int` })
            .from(schema.refunds)
            .where(inArray(schema.refunds.orderId, idsDuStand))
            .groupBy(schema.refunds.orderId)
            .then((l) => new Map(l.map((e) => [e.orderId, Number(e.n)]))),
        ])
      : [new Set<number>(), new Map<number, number>()];
    const enrichies = rows.map(({ pickupPoint, relayPointId, relayPointLabel, legacyId, giftCardCents, ...r }) => {
      const s = resume.get(r.id)!;
      const { parcours, etape } = etapeDeLaCommande(
        { ...r, pickupPoint, relayPointId, relayPointLabel },
        s,
        bordereauxReels.has(r.id),
      );
      return {
        ...r,
        ...(r.channel === "salon"
          ? {
              /** Null : le total se corrige dans la ligne ; sinon, pourquoi pas. */
              refusMontant: refusDeCorrection({
                number: r.number,
                channel: r.channel,
                status: r.status,
                tags: r.tags,
                legacyId,
                invoiceNumber: r.invoiceNumber,
                giftCardCents,
                remboursements: remboursementsParVente.get(r.id) ?? 0,
                encaissementDOrigine: avecOrigine.has(r.id),
              }),
            }
          : {}),
        parcours,
        etapeTraitement: etape,
        payeeEnEssai: enEssai.has(r.id),
        apercus: apercusParCommande.get(r.id) ?? [],
        /** Nombre d'affiches DIFFÉRENTES (lignes), pour le « +N » des vignettes. */
        lignes: lignesParCommande.get(r.id) ?? 0,
        affiches: affichesParCommande.get(r.id) ?? [],
        articles: s.articles,
        expedies: s.expedies,
        rembourseCents: s.rembourseCents,
        statutFinancier: statutFinancier(r, s.rembourseCents),
        statutExpedition: statutExpedition(s.articles, s.expedies),
      };
    });

    // Statuts, étapes de traitement (17/11 : « en_preparation,prete »…),
    // parcours (« livraison », « retrait », « stand ») et étiquette sont
    // filtrés plus haut, AVANT la limite (relecture du 26/11) : les calculer
    // en SQL rendrait la requête illisible pour un gain nul à cette échelle.
    return c.json(enrichies);
  });

  /**
   * Toutes les étiquettes déjà employées, pour l'autocomplétion.
   *
   * Bornées comme la liste : une étiquette dit quelque chose d'une commande
   * (« cliente mécontente », « à rappeler »), et celles des ventes du site
   * n'ont pas à remonter chez un vendeur de stand.
   */
  app.get("/admin/orders/tags", async (c) => {
    const bornes = limiterAuStand(c);
    const rows = await db
      .select({ tags: schema.orders.tags })
      .from(schema.orders)
      .where(bornes.length ? and(...bornes) : undefined);
    const compte = new Map<string, number>();
    for (const r of rows)
      for (const t of r.tags ?? []) compte.set(t, (compte.get(t) ?? 0) + 1);
    return c.json(
      [...compte.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([name, n]) => ({ name, n })),
    );
  });

  /**
   * Export CSV des commandes filtrées.
   *
   * Séparateur point-virgule et BOM UTF-8 : c'est ce qu'attend Excel en
   * français. Sans eux, les accents arrivent en charabia et tout se retrouve
   * dans une seule colonne.
   */
  app.get("/admin/orders/export.csv", async (c) => {
    const q = c.req.query();
    const conditions = [];
    if (q.channel === "web" || q.channel === "salon")
      conditions.push(eq(schema.orders.channel, q.channel));
    // Comme la liste : pas de paniers en cours dans le fichier, sauf demandés.
    if (!(q.financial ?? "").split(",").includes("draft"))
      conditions.push(raw`${schema.orders.status} <> 'draft'`);
    // Un stand précis : c'est la question qu'on se pose au retour d'un salon,
    // « combien celui-là a-t-il fait ».
    const stand = Number(q.stand);
    if (Number.isInteger(stand) && stand > 0)
      conditions.push(eq(schema.orders.standId, stand));
    conditions.push(...limiterAuStand(c));
    if (q.from) conditions.push(gte(schema.orders.createdAt, debutDuJour(q.from)));
    if (q.to) conditions.push(lte(schema.orders.createdAt, finDuJour(q.to)));
    // Les ventes de test (20/11), comme la liste : l'onglet « Toutes » de
    // Ventes stand les écarte, son export aussi. Sans le paramètre, le
    // fichier reste celui d'avant.
    const test = lireFiltreTest(q.test);
    if (test) conditions.push(conditionVentesDeTest(test));
    const ids = (q.ids ?? "")
      .split(",")
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length) conditions.push(inArray(schema.orders.id, ids));
    // Le même partage que la liste : l'export suit ce qu'on a sous les yeux.
    // Une commande rangée n'a pas à reparaître dans un fichier envoyé au
    // comptable sans que personne l'ait redemandée.
    conditions.push(
      q.archived === "1"
        ? isNotNull(schema.orders.archivedAt)
        : isNull(schema.orders.archivedAt),
    );

    const rows = await db
      .select({
        id: schema.orders.id,
        number: schema.orders.number,
        createdAt: schema.orders.createdAt,
        status: schema.orders.status,
        totalCents: schema.orders.totalCents,
        shippingCents: schema.orders.shippingCents,
        promoCode: schema.orders.promoCode,
        shippingLabel: schema.orders.shippingLabel,
        shippingName: schema.orders.shippingName,
        shippingLine1: schema.orders.shippingLine1,
        shippingLine2: schema.orders.shippingLine2,
        shippingPostalCode: schema.orders.shippingPostalCode,
        shippingCity: schema.orders.shippingCity,
        shippingCountry: schema.orders.shippingCountry,
        relayPointId: schema.orders.relayPointId,
        relayPointLabel: schema.orders.relayPointLabel,
        pickupPoint: schema.orders.pickupPoint,
        tags: schema.orders.tags,
        channel: schema.orders.channel,
        customerName: schema.customers.name,
        customerEmail: schema.customers.email,
      })
      .from(schema.orders)
      .leftJoin(
        schema.customers,
        eq(schema.orders.customerId, schema.customers.id),
      )
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.orders.createdAt))
      .limit(5000);

    const resume = await resumeCommandes(rows.map((r) => r.id));
    const euros = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
    const entetes = [
      "Commande",
      "Date",
      "Client",
      "E-mail",
      "Canal",
      "Statut paiement",
      "Statut traitement",
      "Articles",
      "Sous-total",
      "Livraison",
      "Code promo",
      "Remboursé",
      "Total",
      "Mode de livraison",
      "Nom livraison",
      "Adresse",
      "Complément",
      "Code postal",
      "Ville",
      "Pays",
      "Point relais",
      "Étiquettes",
      // En dernier : une colonne ajoutée au milieu décalerait les tableaux
      // que la boutique ou son comptable ont déjà montés sur cet export.
      "Lieu de retrait",
    ];
    const lignes = rows.map((r) => {
      const s = resume.get(r.id)!;
      const lieu = lieuDeRetrait(r);
      return [
        r.number,
        // L'heure de Paris, dite : le fichier part chez la comptable.
        r.createdAt
          ? new Date(r.createdAt).toLocaleString("fr-FR", { timeZone: FUSEAU_BOUTIQUE })
          : "",
        r.customerName ?? "",
        r.customerEmail ?? "",
        r.channel,
        LIBELLE_FINANCIER[statutFinancier(r, s.rembourseCents)],
        LIBELLE_EXPEDITION[statutExpedition(s.articles, s.expedies)],
        s.articles,
        euros(r.totalCents - r.shippingCents),
        euros(r.shippingCents),
        r.promoCode ?? "",
        s.rembourseCents ? euros(s.rembourseCents) : "",
        euros(r.totalCents),
        r.shippingLabel ?? "",
        r.shippingName ?? "",
        r.shippingLine1 ?? "",
        r.shippingLine2 ?? "",
        r.shippingPostalCode ?? "",
        r.shippingCity ?? "",
        r.shippingCountry ?? "",
        // Un point relais, pas un lieu de retrait : l'ancien repère des
        // retraits au stand (« stand:… ») part dans la dernière colonne.
        lieu ? "" : (r.relayPointLabel ?? ""),
        (r.tags ?? []).join(", "),
        lieu ? libelleDuLieu(lieu) : "",
      ]
        .map(cellule)
        .join(";");
    });
    const csv = "﻿" + [entetes.join(";"), ...lignes].join("\r\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="commandes.csv"',
      },
    });
  });

  /** Étiquettes d'une commande (la liste envoyée remplace l'ancienne). */
  app.post("/admin/orders/:id/tags", async (c) => {
    const id = Number(c.req.param("id"));
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const tags = Array.isArray(b.tags)
      ? [
          ...new Set((b.tags as unknown[]).map(etiquette).filter(Boolean)),
        ].slice(0, 30)
      : [];
    // « test » ne se pose pas à la main sur une vente du stand qui compte
    // encore (relecture du 20/11, ventes-de-test.ts, `poseTestALaMain`) :
    // elle afficherait l'étiquette sans sortir des chiffres. La phrase mène à
    // « Mettre en test », le seul geste qui l'en sort.
    const [avant] = await db
      .select({
        number: schema.orders.number,
        channel: schema.orders.channel,
        status: schema.orders.status,
        tags: schema.orders.tags,
      })
      .from(schema.orders)
      .where(eq(schema.orders.id, id));
    if (!avant) return c.notFound();
    if (poseTestALaMain(avant, tags))
      return c.json({ error: refusEtiquetteTest([avant.number]) }, 400);
    const [row] = await db
      .update(schema.orders)
      .set({ tags })
      .where(eq(schema.orders.id, id))
      .returning({ id: schema.orders.id, tags: schema.orders.tags });
    if (!row) return c.notFound();
    return c.json(row);
  });

  /**
   * Actions de masse sur les commandes cochées.
   *
   * Le rendu du matin, c'est trente commandes à passer en « traitée » : les
   * faire une par une est le genre de corvée qui fait détester un outil.
   * Les ventes d'essai du stand se mettent en test de la même façon (« test »,
   * 20/11).
   */
  app.post("/admin/orders/bulk", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const ids = (Array.isArray(b.ids) ? (b.ids as unknown[]) : [])
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n));
    const action = String(b.action ?? "");
    if (!ids.length) return c.json({ error: "aucune commande" }, 400);

    /*
     * Les étapes de traitement (17/11) : une action groupée fait exactement
     * ce que ferait la frise de la fiche, commande par commande — mêmes
     * règles, mêmes courriels (packages/types/src/traitement.ts).
     *   - « etape-suivante » : chaque commande avance d'une étape ;
     *   - « fulfil » (gardé pour les anciens appels) : jusqu'à l'étape où
     *     tout est parti (Terminée, Envoyée, Retirée) ;
     *   - « unfulfil » : retour à la première étape, sans courriel.
     * Une commande qui n'a pas d'étape à choisir (pas payée, annulée…) ou
     * qu'une règle retient (bordereau acheté) est comptée à part, avec sa
     * raison : « 30 traitées » quand deux ne l'étaient pas serait un compte
     * rendu qui ment par omission.
     */
    if (action === "etape-suivante" || action === "fulfil" || action === "unfulfil") {
      const auteur = typeof b.auteur === "string" ? b.auteur : null;
      let count = 0;
      let prevenues = 0;
      const ecartees: { id: number; raison: string }[] = [];
      for (const id of ids) {
        const r = await changerEtape(
          id,
          (parcours, de) => {
            const liste = ETAPES_DU_PARCOURS[parcours];
            const rang = rangEtape(parcours, de);
            if (rang === null) return liste[0]!; // passageEtape dira pourquoi
            if (action === "unfulfil") return liste[0]!;
            if (action === "fulfil") return ETAPE_PARTIE[parcours];
            const suivante = liste[Math.floor(rang) + 1];
            return suivante ?? null;
          },
          { auteur },
        );
        if ("erreur" in r) ecartees.push({ id, raison: r.erreur });
        else if (!r.inchange) {
          count++;
          if (r.courrier?.parti) prevenues++;
        }
      }
      return c.json({ ok: true, count, prevenues, ecartees, annulees: 0 });
    }

    /*
     * « Marquer terminées » et « Remettre à imprimer », les ventes cochées
     * dans Ventes stand (26/11, Alexandra : « il faut que quand la personne
     * créé une affiche, qu'elle ne soit pas directement terminée mais qu'on
     * doive le faire soit dans la commande soit sur la liste avec case à
     * cocher »). Chacune passe par la frise de la fiche (changerEtape) : la
     * remise sans transporteur et la date de fin, ou leur annulation ; au
     * journal, qui et quand ; aucun courriel. La garde n'y laisse que les
     * ventes du stand payées (etape-vente-stand.ts). Les autres sont
     * IGNORÉES, chacune avec son numéro et sa raison courte, que le message
     * compte — comme celles qui étaient déjà à l'étape demandée : un double
     * clic ne refait rien, le second envoi les trouve déjà terminées.
     */
    if (estActionEtapeStand(action)) {
      const vers = ACTIONS_ETAPE_STAND[action];
      // « Qui » : la session d'abord (une propriétaire, la garde de /admin/*
      // l'a posée), le nom envoyé par le BO à défaut.
      const auteur =
        c.get("utilisateur")?.email?.trim() ||
        (typeof b.auteur === "string" ? b.auteur.trim().slice(0, 200) : "") ||
        null;
      let count = 0;
      const ignorees: { id: number; raison: string }[] = [];
      for (const id of new Set(ids)) {
        const r = await changerEtape(id, () => vers, { auteur, garde: refusEtapeDuStand });
        if ("erreur" in r)
          ignorees.push({
            id,
            raison: r.code === 404 ? "supprimée depuis l'affichage de la liste" : r.erreur,
          });
        else if (r.inchange) ignorees.push({ id, raison: raisonDejaFaite(vers) });
        else count++;
      }
      const numeros = new Map(
        (ignorees.length
          ? await db
              .select({ id: schema.orders.id, number: schema.orders.number })
              .from(schema.orders)
              .where(inArray(schema.orders.id, ignorees.map((i) => i.id)))
          : []
        ).map((o) => [o.id, o.number]),
      );
      return c.json({
        ok: true,
        etape: vers,
        count,
        ignorees: ignorees.map((i) => ({ ...i, numero: numeros.get(i.id) ?? `n° ${i.id}` })),
      });
    }

    if (action === "tag" || action === "untag") {
      const tags = (Array.isArray(b.tags) ? (b.tags as unknown[]) : [])
        .map(etiquette)
        .filter(Boolean);
      if (!tags.length) return c.json({ error: "aucune étiquette" }, 400);
      const rows = await db
        .select({
          id: schema.orders.id,
          tags: schema.orders.tags,
          number: schema.orders.number,
          channel: schema.orders.channel,
          status: schema.orders.status,
        })
        .from(schema.orders)
        .where(inArray(schema.orders.id, ids));
      // « test » posé à la main sur des ventes du stand qui comptent encore
      // (relecture du 20/11, ventes-de-test.ts, `poseTestALaMain`) : refusé
      // pour toute la sélection, rien n'est posé, et la phrase nomme les
      // ventes en cause et mène à « Mettre en test ». La moitié d'une
      // sélection étiquetée laisserait se demander lesquelles l'ont été.
      if (action === "tag") {
        const comptent = rows.filter((r) => poseTestALaMain(r, tags));
        if (comptent.length)
          return c.json(
            { error: refusEtiquetteTest(comptent.map((r) => r.number).sort()) },
            400,
          );
      }
      const bas = tags.map((t) => t.toLowerCase());
      for (const r of rows) {
        const actuel = r.tags ?? [];
        const suivant =
          action === "tag"
            ? fusionner(actuel, tags)
            : actuel.filter((t) => !bas.includes(t.toLowerCase()));
        await db
          .update(schema.orders)
          .set({ tags: suivant })
          .where(eq(schema.orders.id, r.id));
      }
      return c.json({ ok: true, count: rows.length });
    }

    /*
     * La mise en test (20/11, Alexandra : « non pour mettre en test à la main
     * c'est avec sélectionner et une option à la sélection ») : les ventes
     * cochées dans Ventes stand passent une à une par le chemin d'annulation,
     * `annulerLaCommande` avec `test: true` — annulées sans courriel, leur
     * encaissement sur place retiré du grand livre, étiquetées « test »
     * (ventes-de-test.ts). Ce que la règle refuse (une commande du site, une
     * reprise de Shopify, un panier) est écarté avec sa raison, sans retenir
     * les autres : une commande du site annulée écrirait à son client. Une
     * vente déjà en test l'est aussi, il n'y a rien à refaire. `count` :
     * celles qui viennent de passer en test.
     */
    if (action === "test") {
      const auteur = typeof b.auteur === "string" ? b.auteur : null;
      let count = 0;
      const ecartees: { id: number; raison: string }[] = [];
      for (const id of new Set(ids)) {
        // Relue juste avant : une vente annulée depuis l'affichage de la
        // liste n'est plus qu'à étiqueter.
        const [order] = await db
          .select()
          .from(schema.orders)
          .where(eq(schema.orders.id, id));
        if (!order) {
          ecartees.push({ id, raison: "Une vente cochée n'existe plus : rechargez la liste." });
          continue;
        }
        const r = await annulerLaCommande(order, { test: true, author: auteur });
        if ("erreur" in r) ecartees.push({ id, raison: r.erreur });
        else if (r.deja)
          ecartees.push({
            id,
            raison: `La vente ${order.number} était déjà en test : rien n'a été refait.`,
          });
        else count++;
      }
      return c.json({ ok: true, count, ecartees });
    }

    // « archiver » range le lot, « restaurer » le ressort. L'ancienne action
    // « supprimer » n'existe plus : elle effaçait les ventes pour de bon.
    if (action === "archiver" || action === "restaurer") {
      const archiver = action === "archiver";
      const touchees = await archiverCommandes(ids, archiver);
      return c.json({
        ok: true,
        archived: archiver,
        count: touchees.length,
        numeros: touchees,
      });
    }

    return c.json({ error: "action inconnue" }, 400);
  });

  /**
   * Archive une commande, ou la restaure.
   *
   * La suppression définitive a été RETIRÉE, et elle ne manquait à personne :
   * elle emportait en cascade les lignes, les expéditions, les
   * remboursements, les mouvements d'argent et le journal, laissait dans la
   * numérotation un trou que plus rien ne pouvait expliquer, et ne demandait
   * même pas si la commande était payée.
   *
   * Archivée, la commande quitte la liste ordinaire et l'export, et se range
   * dans « Commandes archivées ». Sa fiche reste lisible, ses fichiers
   * d'impression aussi, la recherche continue de la rendre — marquée
   * « Archivée », c'est ainsi qu'on la retrouve — et « Restaurer » la remet
   * dans la liste.
   *
   * Ce que l'archivage ne fait PAS, et c'est voulu : il ne touche ni au
   * statut, ni à l'argent, ni au stock, et ne prévient pas la cliente. Une
   * vente archivée continue donc de compter dans le chiffre d'affaires. Pour
   * qu'elle cesse d'y compter, c'est l'ANNULATION qu'il faut — elle existe
   * déjà, elle rend l'argent, rouvre le stock et écrit au journal.
   */
  app.post("/admin/orders/:id/archive", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: "commande inconnue" }, 400);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    // Défaut : on archive. Seul un « archived: false » explicite restaure.
    const archiver = b.archived !== false;
    const touchees = await archiverCommandes([id], archiver);
    if (!touchees.length)
      return c.json(
        { error: "Cette commande n'existe plus. Rechargez la liste." },
        404,
      );
    return c.json({ ok: true, archived: archiver, numero: touchees[0] });
  });

  /**
   * Supprime DÉFINITIVEMENT une commande archivée — un panier, ou une
   * commande jamais payée. La règle est dans `motifCommandeAGarder`, plus
   * haut : rien de ce qui a été payé, remboursé, facturé, encaissé, expédié
   * ou réglé en carte cadeau ne part, jamais.
   *
   * Ce qui part avec elle, dans la même transaction : ses lignes, leurs
   * fichiers d'impression EN BASE (les PDF sur le disque restent : ce n'est
   * pas à une route de ménage d'effacer des fichiers), son journal et ses
   * paiements restés « en attente » (un passage chez Stripe ou PayPal jamais
   * abouti). Les générations d'images IA qui citaient une de ses lignes
   * restent, détachées. La base en ferait autant par ses cascades ; on
   * l'écrit, pour ne pas dépendre d'une base où elles manqueraient.
   *
   * Le trou qu'elle laisse dans la numérotation des COMMANDES est permis :
   * seule celle des FACTURES doit être continue, et une commande facturée ne
   * passe pas ici. La dernière de sa série, en revanche, attend : son numéro
   * resservirait (voir `dernierDeSaSerie`).
   */
  app.delete("/admin/orders/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: "commande inconnue" }, 400);
    return supprimerPourToujours(c, {
      lire: async () =>
        (
          await db
            .select({
              id: schema.orders.id,
              number: schema.orders.number,
              status: schema.orders.status,
              channel: schema.orders.channel,
              legacyId: schema.orders.legacyId,
              invoiceNumber: schema.orders.invoiceNumber,
              giftCardCents: schema.orders.giftCardCents,
              archivedAt: schema.orders.archivedAt,
            })
            .from(schema.orders)
            .where(eq(schema.orders.id, id))
        )[0] ?? null,
      // Plus besoin de l'archiver d'abord (19/11, Alexandra : « et pas devoir
      // passer par archivées ») : la règle qui garde ce qui doit l'être,
      // c'est motifCommandeAGarder.
      estArchive: () => true,
      empeche: async (o) => {
        const nombre = async (requete: Promise<{ n: number }[]>) =>
          Number((await requete)[0]?.n ?? 0);
        const n = raw<number>`count(*)::int`;
        const [
          remboursements,
          mouvements,
          paiementsAboutis,
          expeditions,
          bordereaux,
          cartes,
          bordereauxVivants,
          paiementsEnCours,
        ] = await Promise.all([
            nombre(db.select({ n }).from(schema.refunds).where(eq(schema.refunds.orderId, o.id))),
            nombre(
              db
                .select({ n })
                .from(schema.orderTransactions)
                .where(
                  and(
                    eq(schema.orderTransactions.orderId, o.id),
                    // L'écriture d'annulation d'une commande jamais payée
                    // (« void ») dit que l'argent n'arrivera pas : ce n'est
                    // pas de l'argent. Une commande qui n'a jamais payé puis
                    // a été annulée se supprime donc (19/11).
                    ne(schema.orderTransactions.kind, "void"),
                  ),
                ),
            ),
            nombre(
              db
                .select({ n })
                .from(schema.payments)
                .where(
                  and(
                    eq(schema.payments.orderId, o.id),
                    // Un statut vide compte comme abouti : le doute retient.
                    raw`coalesce(${schema.payments.status}, '') <> 'pending'`,
                  ),
                ),
            ),
            nombre(
              db
                .select({ n })
                .from(schema.fulfillments)
                .where(eq(schema.fulfillments.orderId, o.id)),
            ),
            nombre(
              db.select({ n }).from(schema.bordereaux).where(eq(schema.bordereaux.orderId, o.id)),
            ),
            nombre(
              db
                .select({ n })
                .from(schema.giftCardTransactions)
                .where(eq(schema.giftCardTransactions.orderId, o.id)),
            ),
            nombre(
              db
                .select({ n })
                .from(schema.bordereaux)
                .where(
                  and(
                    eq(schema.bordereaux.orderId, o.id),
                    inArray(schema.bordereaux.statut, ["achete", "en_cours"]),
                    eq(schema.bordereaux.essai, false),
                  ),
                ),
            ),
            nombre(
              db
                .select({ n })
                .from(schema.payments)
                .where(
                  and(
                    eq(schema.payments.orderId, o.id),
                    inArray(schema.payments.provider, ["stripe", "paypal"]),
                    eq(schema.payments.status, "pending"),
                    gte(schema.payments.createdAt, new Date(Date.now() - 48 * 3600_000)),
                  ),
                ),
            ),
          ]);
        // Le plus haut numéro de sa série ? Même lecture que le compteur
        // (numeros-commande.ts) : tous canaux confondus, par préfixe.
        const prefixe = PREFIXES_NUMERO.find((p) => o.number.startsWith(p));
        let dernierDeSaSerie = false;
        if (prefixe && /^\d+$/.test(o.number.slice(prefixe.length))) {
          const serie = await db
            .select({ n: schema.orders.number })
            .from(schema.orders)
            .where(numerosDuPrefixe(prefixe));
          dernierDeSaSerie =
            numeroSuivant(prefixe, serie.map((r) => r.n)) ===
            numeroSuivant(prefixe, [o.number]);
        }
        return motifCommandeAGarder({
          status: o.status,
          channel: o.channel,
          reprise: o.legacyId != null,
          bordereauxVivants,
          paiementsEnCours,
          invoiceNumber: o.invoiceNumber,
          remboursements,
          mouvements,
          paiementsAboutis,
          expeditions,
          bordereaux,
          depensesCarteCadeau: cartes,
          giftCardCents: o.giftCardCents,
          dernierDeSaSerie,
        });
      },
      supprimer: async (o) => {
        await db.transaction(async (tx) => {
          const lignes = await tx
            .select({ id: schema.orderItems.id })
            .from(schema.orderItems)
            .where(eq(schema.orderItems.orderId, o.id));
          const idsLignes = lignes.map((l) => l.id);
          if (idsLignes.length) {
            // Une vente du stand supprimée (19/11) avait donné sa date de
            // paiement aux affiches tirées d'une photo : sans elle, la purge
            // des photos de visiteurs les reprend, comme celles d'un panier.
            await tx
              .update(schema.aiGenerations)
              .set({ orderItemId: null, paidAt: null })
              .where(inArray(schema.aiGenerations.orderItemId, idsLignes));
            await tx
              .delete(schema.printFiles)
              .where(inArray(schema.printFiles.orderItemId, idsLignes));
            await tx.delete(schema.orderItems).where(eq(schema.orderItems.orderId, o.id));
          }
          await tx.delete(schema.orderEvents).where(eq(schema.orderEvents.orderId, o.id));
          await tx.delete(schema.payments).where(eq(schema.payments.orderId, o.id));
          await tx.delete(schema.orders).where(eq(schema.orders.id, o.id));
        });
      },
      utilisePar: "d'autres éléments",
    });
  });

  /**
   * Range (ou ressort) les commandes demandées et rend leurs numéros.
   *
   * Une seule écriture pour tout le lot : la date d'archivage est la même
   * pour toutes, ce qui permet de les retrouver ensemble dans la vue des
   * archivées quand on en a rangé vingt d'un coup.
   */
  async function archiverCommandes(
    ids: number[],
    archiver: boolean,
  ): Promise<string[]> {
    if (!ids.length) return [];
    const touchees = await db
      .update(schema.orders)
      .set({ archivedAt: archiver ? new Date() : null })
      .where(inArray(schema.orders.id, ids))
      .returning({ numero: schema.orders.number });
    return touchees.map((p) => p.numero);
  }

  /** Crée une expédition : ce qui part, par qui, avec quel numéro de suivi. */
  app.post("/admin/orders/:id/fulfillments", async (c) => {
    const id = Number(c.req.param("id"));
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, id));
    if (!order) return c.notFound();
    // Une commande annulée ne fait plus rien partir : c'est tout le sens de
    // l'annulation, et la cliente a reçu un courrier qui le lui dit.
    if (order.status === "cancelled" || order.status === "voided")
      return c.json(
        {
          error:
            "Cette commande est annulée : plus rien ne peut en partir. Si l'annulation était une erreur, il faut repasser une commande.",
        },
        400,
      );

    // Les cartes cadeaux partent par e-mail, au paiement : seules les
    // affiches s'expédient.
    const lignes = (
      await db
        .select()
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, id))
    ).filter((l) => !l.giftCard);
    const resume = await resumeCommandes([id]);
    const dejaParti = await quantitesExpediees(id);

    const demande = new Map<number, number>();
    const detailDemande = Array.isArray(b.items)
      ? (b.items as { orderItemId: number; quantity: number }[])
      : [];
    if (detailDemande.length) {
      for (const it of detailDemande) {
        const q = Math.max(0, Math.floor(Number(it.quantity) || 0));
        if (q > 0) demande.set(Number(it.orderItemId), q);
      }
    } else {
      // Sans détail, on expédie tout ce qui reste : c'est le cas courant.
      for (const l of lignes) {
        const reste = l.quantity - (dejaParti.get(l.id) ?? 0);
        if (reste > 0) demande.set(l.id, reste);
      }
    }

    const aInserer: { orderItemId: number; quantity: number }[] = [];
    for (const l of lignes) {
      const q = demande.get(l.id) ?? 0;
      if (q <= 0) continue;
      const reste = l.quantity - (dejaParti.get(l.id) ?? 0);
      if (q > reste)
        return c.json(
          {
            error: `Il ne reste que ${reste} exemplaire(s) à expédier sur « ${l.title ?? "cet article"} ».`,
          },
          400,
        );
      aInserer.push({ orderItemId: l.id, quantity: q });
    }
    if (!aInserer.length)
      return c.json({ error: "Rien à expédier : tout est déjà parti." }, 400);

    const carrier = String(b.carrier ?? "").trim() || null;
    const trackingNumber = String(b.trackingNumber ?? "").trim() || null;
    const [ful] = await db
      .insert(schema.fulfillments)
      .values({
        orderId: id,
        carrier,
        trackingNumber,
        trackingUrl:
          String(b.trackingUrl ?? "").trim() ||
          lienDeSuivi(carrier, trackingNumber),
        status: "success",
      })
      .returning();
    await db
      .insert(schema.fulfillmentItems)
      .values(aInserer.map((l) => ({ ...l, fulfillmentId: ful!.id })));

    // La commande est « traitée » quand il ne reste plus rien à envoyer.
    const envoyes = aInserer.reduce((s, l) => s + l.quantity, 0);
    const total = resume.get(id)!.articles;
    const partis = resume.get(id)!.expedies + envoyes;
    await db
      .update(schema.orders)
      .set({ fulfilledAt: partis >= total ? new Date() : null })
      .where(eq(schema.orders.id, id));

    await db.insert(schema.orderEvents).values({
      orderId: id,
      kind: "event",
      message:
        `Expédition créée (${envoyes} article(s))` +
        (carrier ? ` — ${carrier}` : "") +
        (trackingNumber ? `, suivi ${trackingNumber}` : "") +
        ".",
    });

    // Le courriel suit la règle des étapes : l'avis d'expédition pour une
    // commande qui voyage, rien pour un retrait ni pour le stand.
    await previenirDeLExpedition(
      id,
      { carrier, trackingNumber, trackingUrl: ful!.trackingUrl ?? null },
      "envoyee",
    );
    return c.json(ful);
  });

  /**
   * Dit à la cliente que son affiche part, ou qu'elle est prête.
   *
   * Le texte dépend du canal, et ce n'est pas cosmétique : une commande de
   * stand ne porte AUCUN prix, du premier écran de la tablette jusqu'ici. La
   * vendeuse a annoncé le montant de vive voix, un chiffre écrit là la
   * contredirait après coup.
   *
   * Ne lève jamais. Le colis est parti, c'est le fait qui compte ; un courrier
   * qui ne part pas ne doit pas défaire une expédition enregistrée. L'échec se
   * lit dans la chronologie de la commande.
   *
   * Depuis le 17/11 (étapes de traitement, packages/types/src/traitement.ts) :
   *   - « envoyee » : l'avis d'expédition, pour une commande qui VOYAGE
   *     seulement. Un retrait qui part (« Retirée ») et une vente du stand
   *     (« Terminée ») ne reçoivent rien : la personne est là ;
   *   - « prete » : « Votre commande vous attend », pour un retrait ;
   *   - le stand ne reçoit JAMAIS de courrier.
   * Rend ce qui est parti, pour que la fiche le dise.
   */
  async function previenirDeLExpedition(
    orderId: number,
    envoi: {
      carrier: string | null;
      trackingNumber: string | null;
      trackingUrl: string | null;
    },
    quoi: "envoyee" | "prete",
  ): Promise<{ sujet: string; email: string; parti: boolean } | null> {
    if (!mailConfigure()) return null;
    try {
      const [commande] = await db
        .select({
          number: schema.orders.number,
          channel: schema.orders.channel,
          customerId: schema.orders.customerId,
          note: schema.orders.internalNote,
          langue: schema.orders.langue,
          pickupPoint: schema.orders.pickupPoint,
          relayPointId: schema.orders.relayPointId,
          relayPointLabel: schema.orders.relayPointLabel,
        })
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId));
      if (!commande?.customerId) return null;
      // Le stand ne reçoit aucun courrier (17/11) : la personne est là.
      if (commande.channel === "salon") return null;

      const [client] = await db
        .select({
          name: schema.customers.name,
          firstName: schema.customers.firstName,
          email: schema.customers.email,
          langue: schema.customers.langue,
        })
        .from(schema.customers)
        .where(eq(schema.customers.id, commande.customerId));
      if (!client?.email) return null;
      const langue = langueDuDestinataire({
        compte: client.langue,
        commande: commande.langue,
      });

      const lignesCommande = await db
        .select({
          title: schema.orderItems.title,
          quantity: schema.orderItems.quantity,
          unitPriceCents: schema.orderItems.unitPriceCents,
          config: schema.orderItems.config,
        })
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, orderId));
      const lignes = lignesCommande.map((l) => {
        const cfg = (l.config ?? {}) as { format?: unknown };
        return {
          titre: l.title ?? tc(langue)("lignes.titreParDefaut"),
          format: typeof cfg.format === "string" ? cfg.format : null,
          cadre: null,
          quantite: l.quantity,
          unitPriceCents: l.unitPriceCents,
        };
      });
      const prenom =
        prenomPourCourrier(client) || tc(langue)("commun.prenomParDefaut");
      // Une commande du site à retirer sur place n'est pas « en route » :
      // elle attend au lieu choisi, et c'est ce que dit son courrier. Un
      // retrait qui voyage finalement (vrai bordereau) se lit comme une
      // livraison : même règle que la frise (parcoursDe).
      const lieu = lignesDuLieu(lieuDeRetrait(commande, langue));
      const retrait = !!lieu && !(await avecBordereauReel([orderId])).has(orderId);
      if (quoi === "prete" ? !retrait : retrait) return null;

      const courrier =
        quoi === "prete" && lieu
          ? courrierPreteAuRetrait({
              langue,
              prenomClient: prenom,
              numero: commande.number,
              lieu,
              lignes,
            })
          : courrierExpediee({
              langue,
              prenomClient: prenom,
              numero: commande.number,
              transporteur: envoi.carrier,
              numeroSuivi: envoi.trackingNumber,
              lienSuivi: envoi.trackingUrl,
              lignes,
            });

      const parti = await envoyerCourrier({ ...courrier, to: client.email });
      await db.insert(schema.orderEvents).values({
        orderId,
        kind: "event",
        message: parti
          ? `Courrier envoyé à ${client.email} : ${courrier.subject}.`
          : `Le courrier « ${courrier.subject} » n'a pas pu partir vers ${client.email}.`,
      });
      return { sujet: courrier.subject, email: client.email, parti };
    } catch {
      // Une panne de courrier ne défait pas une expédition enregistrée.
      return null;
    }
  }

  /**
   * Fait passer une commande à une autre étape de traitement (17/11).
   *
   * La frise de la fiche passe par ici. La règle (qui choisit quoi, quel
   * courriel part, quand on ne revient pas en arrière) est dans
   * packages/types/src/traitement.ts ; ce qui s'écrit réutilise la logique
   * d'avant : `expedierTout` pour faire partir ce qui reste,
   * `annulerExpeditions` pour revenir avant « parti », et
   * `previenirDeLExpedition` pour le courriel.
   *
   * `cible` reçoit le parcours et l'étape actuelle : null = rien à faire.
   * `garde` (26/11) : une règle de plus, lue sur la commande relue sous le
   * verrou ; sa raison refuse le passage. « Marquer terminées » et
   * « Remettre à imprimer » de Ventes stand s'en servent pour n'agir que
   * sur des ventes du stand payées (etape-vente-stand.ts).
   */
  async function changerEtape(
    id: number,
    cible: (parcours: ParcoursTraitement, de: EtapeTraitement) => string | null,
    opts: {
      auteur?: string | null;
      carrier?: string | null;
      trackingNumber?: string | null;
      garde?: (order: typeof schema.orders.$inferSelect) => string | null;
    } = {},
  ): Promise<
    | { erreur: string; code: 404 | 409 }
    | {
        inchange: boolean;
        parcours: ParcoursTraitement;
        de: EtapeTraitement;
        etape: EtapeTraitement;
        courrier: { sujet: string; email: string; parti: boolean } | null;
      }
  > {
    type Envoi = { carrier: string | null; trackingNumber: string | null; trackingUrl: string | null };
    type Fait =
      | { erreur: string; code: 404 | 409 }
      | {
          inchange: boolean;
          parcours: ParcoursTraitement;
          de: EtapeTraitement;
          etape: EtapeTraitement;
          envoi: Envoi | null;
          courrierAEnvoyer: "expediee" | "prete_a_retirer" | null;
        };
    const fait = await unPassageALaFois<Fait>(id, async (): Promise<Fait> => {
      const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
      if (!order) return { erreur: "Cette commande n'existe plus.", code: 404 as const };
      const refus = opts.garde?.(order);
      if (refus) return { erreur: refus, code: 409 as const };
      // Les reprises de Shopify ont été traitées là-bas (voir index.ts).
      if (order.legacyId != null)
        return {
          erreur: `Commande reprise de Shopify (${order.legacyName ?? "ancienne boutique"}) : elle a été traitée là-bas.`,
          code: 409 as const,
        };
      const [resumes, reels] = await Promise.all([
        resumeCommandes([id]),
        avecBordereauReel([id]),
      ]);
      const bordereauReel = reels.has(id);
      const { parcours, etape: de } = etapeDeLaCommande(order, resumes.get(id)!, bordereauReel);
      const vers = cible(parcours, de);
      if (vers === null)
        return { inchange: true, parcours, de, etape: de, envoi: null, courrierAEnvoyer: null };
      const passage = passageEtape(parcours, de, vers, { bordereauReel });
      if (!passage.ok) return { erreur: passage.raison, code: 409 as const };
      if (passage.inchange)
        return { inchange: true, parcours, de, etape: de, envoi: null, courrierAEnvoyer: null };
      const etape = vers as EtapeTraitement;

      // 1. Les expéditions, par la logique d'avant. Une commande qui voyage
      //    part avec le transporteur et le suivi saisis, sinon ceux de son
      //    vrai bordereau ; un retrait ou une vente du stand, sans.
      const envoi: Envoi = { carrier: null, trackingNumber: null, trackingUrl: null };
      if (passage.expedier) {
        if (parcours === "livraison") {
          envoi.carrier = opts.carrier?.trim() || null;
          envoi.trackingNumber = opts.trackingNumber?.trim() || null;
          if (!envoi.carrier && !envoi.trackingNumber && bordereauReel) {
            const [b] = await db
              .select()
              .from(schema.bordereaux)
              .where(
                and(
                  eq(schema.bordereaux.orderId, id),
                  eq(schema.bordereaux.statut, "achete"),
                  eq(schema.bordereaux.essai, false),
                ),
              );
            if (b) {
              envoi.carrier = NOM_TRANSPORTEUR_SENDCLOUD[b.transporteur ?? ""] ?? b.transporteur ?? null;
              envoi.trackingNumber = b.trackingNumber;
              envoi.trackingUrl = b.trackingUrl;
            }
          }
          envoi.trackingUrl ??= lienDeSuivi(envoi.carrier, envoi.trackingNumber);
        }
        await expedierTout([id], envoi);
      }
      if (passage.annulerExpeditions) await annulerExpeditions([id]);

      // 2. La commande : traitée ou non (comme avant), et les deux dates.
      const dates = datesApresPassage(etape, order, new Date());
      await db
        .update(schema.orders)
        .set({
          ...dates,
          ...(passage.expedier ? { fulfilledAt: new Date() } : {}),
          ...(passage.annulerExpeditions ? { fulfilledAt: null } : {}),
        })
        .where(eq(schema.orders.id, id));

      // 3. Le journal : dans un mois, on saura qui a fait quoi, et quand.
      await db.insert(schema.orderEvents).values({
        orderId: id,
        kind: "event",
        author: opts.auteur?.trim() || null,
        message:
          `Traitement : ${libelleEtape(de, parcours)} → ${libelleEtape(etape, parcours)}.` +
          // Au stand, rien n'a voyagé : c'est la remise au client qui tombe.
          (passage.annulerExpeditions
            ? parcours === "stand"
              ? " La remise enregistrée est annulée."
              : " Les expéditions enregistrées sont annulées."
            : "") +
          (envoi.trackingNumber ? ` Suivi ${envoi.trackingNumber}.` : ""),
      });
      return {
        inchange: false,
        parcours,
        de,
        etape,
        envoi: passage.courrier ? envoi : null,
        courrierAEnvoyer: passage.courrier,
      };
    });
    if ("erreur" in fait) return fait;
    // 4. Le courriel, hors du verrou : un envoi lent ne retient personne.
    const courrier =
      fait.courrierAEnvoyer && fait.envoi
        ? await previenirDeLExpedition(
            id,
            fait.envoi,
            fait.courrierAEnvoyer === "prete_a_retirer" ? "prete" : "envoyee",
          )
        : null;
    return {
      inchange: fait.inchange,
      parcours: fait.parcours,
      de: fait.de,
      etape: fait.etape,
      courrier,
    };
  }

  /**
   * L'étape de traitement d'une commande (17/11) : la frise de la fiche.
   * Corps : { etape, carrier?, trackingNumber?, auteur? }.
   */
  app.post("/admin/orders/:id/traitement", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: "commande inconnue" }, 400);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const vers = String(b.etape ?? "");
    const r = await changerEtape(id, () => vers, {
      auteur: typeof b.auteur === "string" ? b.auteur : null,
      carrier: typeof b.carrier === "string" ? b.carrier : null,
      trackingNumber: typeof b.trackingNumber === "string" ? b.trackingNumber : null,
    });
    if ("erreur" in r) return c.json({ error: r.erreur }, r.code);
    return c.json(r);
  });

  /** Annule une expédition (colis jamais parti, erreur de saisie). */
  app.post("/admin/fulfillments/:id/cancel", async (c) => {
    const id = Number(c.req.param("id"));
    const [ful] = await db
      .update(schema.fulfillments)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(eq(schema.fulfillments.id, id))
      .returning();
    if (!ful) return c.notFound();
    const s = (await resumeCommandes([ful.orderId])).get(ful.orderId)!;
    await db
      .update(schema.orders)
      .set({
        fulfilledAt:
          s.articles > 0 && s.expedies >= s.articles ? new Date() : null,
      })
      .where(eq(schema.orders.id, ful.orderId));
    await db.insert(schema.orderEvents).values({
      orderId: ful.orderId,
      kind: "event",
      message: `Expédition annulée${ful.trackingNumber ? ` (suivi ${ful.trackingNumber})` : ""}.`,
    });
    return c.json(ful);
  });

  /**
   * Rembourse tout ou partie d'une commande.
   *
   * Deux façons, l'une OU l'autre :
   *   - des articles et/ou le port : le montant est recalculé à partir des
   *     quantités rendues et du prix réellement payé — on ne peut pas rendre
   *     deux fois le même article ;
   *   - un MONTANT LIBRE (`amountCents`), demandé par la boutique le 16/11
   *     (« une option de remboursement où je peux choisir le montant, avec
   *     Stripe et PayPal ») : un geste commercial, une affiche abîmée qu'on
   *     ne reprend pas… Aucun article n'est marqué rendu.
   * Dans les deux cas, jamais plus que ce qui reste encaissé.
   */
  app.post("/admin/orders/:id/refunds", async (c) => {
    const id = Number(c.req.param("id"));
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const r = await enregistrerRemboursement(id, b);
    if (r.introuvable) return c.notFound();
    if (r.erreur) return c.json({ error: r.erreur }, r.code ?? 400);
    return c.json(r.refund);
  });

  /**
   * Le remboursement lui-même, détaché de sa route.
   *
   * L'annulation d'une commande payée doit pouvoir rendre l'argent, et elle
   * doit le faire EXACTEMENT comme le bouton « Rembourser » : mêmes plafonds,
   * même renvoi chez Stripe, même écriture au grand livre, même courrier. Une
   * seconde façon de rembourser aurait fini par diverger de celle-ci sur un
   * détail — le plafond du port, ou le cumul des remboursements précédents — et
   * l'écart ne se serait vu que le jour où il aurait coûté de l'argent.
   *
   * Rend un objet plutôt qu'une réponse HTTP, pour que l'annulation puisse
   * décider elle-même quoi dire quand le remboursement échoue.
   */
  async function enregistrerRemboursement(
    id: number,
    b: Record<string, unknown>,
  ): Promise<{
    introuvable?: true;
    erreur?: string;
    code?: 400 | 502;
    refund?: typeof schema.refunds.$inferSelect;
    montantCents?: number;
  }> {
    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, id));
    if (!order) return { introuvable: true };

    const lignes = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, id));
    const dejaRendu = await quantitesRemboursees(id);
    const dejaCents = (await resumeCommandes([id])).get(id)!.rembourseCents;

    // « Tout rembourser » (`tout: true`, le choix par défaut du bloc
    // Rembourser depuis le 17/11) : tous les articles qui restent, et le port
    // qui reste. Par les articles plutôt que par un montant libre égal au
    // reste : chaque ligne est ainsi marquée rendue, comme le faisait
    // l'annulation.
    //
    // Sauf quand ces articles et ce port valent PLUS que l'argent qui reste
    // encaissé : une remise (« 3 achetées = 1 A4 offerte »), ou un montant
    // libre déjà rendu, que les articles ne connaissent pas. Additionner les
    // prix faisait alors refuser « tout rembourser » (« dépasserait le
    // montant encaissé ») — et l'annulation avec lui. On rend alors exactement
    // ce qui reste, en un montant.
    if (b.tout === true) {
      const items = lignes
        .map((l) => ({ orderItemId: l.id, quantity: l.quantity - (dejaRendu.get(l.id) ?? 0) }))
        .filter((l) => l.quantity > 0);
      const port = await portRemboursable(id, order.shippingCents);
      const parArticles =
        items.reduce((s, it) => s + (lignes.find((l) => l.id === it.orderItemId)!.unitPriceCents * it.quantity), 0) + port;
      const resteEncaisse = Math.max(0, order.totalCents - dejaCents);
      b =
        parArticles > 0 && parArticles <= resteEncaisse
          ? { ...b, items, shippingCents: port, amountCents: 0 }
          : { ...b, items: [], shippingCents: 0, amountCents: resteEncaisse };
    }

    const detail: {
      orderItemId: number;
      quantity: number;
      amountCents: number;
    }[] = [];
    /**
     * Les mêmes lignes, telles que le courrier les montrera. Composées ici,
     * dans la boucle qui les valide : les retrouver après coup obligerait à
     * refaire la correspondance avec les articles, et une seconde façon de la
     * faire finirait par diverger de celle qui a servi à calculer l'argent.
     */
    const articlesRendus: LigneCourrier[] = [];
    for (const it of (Array.isArray(b.items) ? b.items : []) as {
      orderItemId: number;
      quantity: number;
    }[]) {
      const ligne = lignes.find((l) => l.id === Number(it.orderItemId));
      if (!ligne) continue;
      const q = Math.max(0, Math.floor(Number(it.quantity) || 0));
      if (q <= 0) continue;
      const reste = ligne.quantity - (dejaRendu.get(ligne.id) ?? 0);
      if (q > reste)
        return {
          erreur: `« ${ligne.title ?? "Article"} » : ${reste} exemplaire(s) remboursable(s) au plus.`,
        };
      detail.push({
        orderItemId: ligne.id,
        quantity: q,
        amountCents: ligne.unitPriceCents * q,
      });
      const cfg = (ligne.config ?? {}) as { format?: unknown };
      articlesRendus.push({
        titre: ligne.title ?? "Affiche personnalisée",
        format: typeof cfg.format === "string" ? cfg.format : null,
        cadre: null,
        quantite: q,
        unitPriceCents: ligne.unitPriceCents,
        // L'affiche elle-même : un remboursement partiel doit dire LAQUELLE
        // des trois affiches est concernée, et le titre seul ne suffit pas.
        imageUrl: ligne.config
          ? `${ORIGINE_PUBLIQUE}/api${cheminApercu(ligne.id, ligne.config)}`
          : null,
      });
    }

    const portDemande = Math.max(0, Math.floor(Number(b.shippingCents) || 0));
    const portRestant = await portRemboursable(id, order.shippingCents);
    if (portDemande > portRestant)
      return {
        erreur: `Frais de port : ${(portRestant / 100).toFixed(2)} € remboursables au plus.`,
      };

    let montant = detail.reduce((s, d) => s + d.amountCents, 0) + portDemande;
    const libre = Math.max(0, Math.round(Number(b.amountCents) || 0));
    if (libre > 0) {
      if (montant > 0)
        return {
          erreur:
            "Choisissez soit des articles et le port, soit un montant libre, mais pas les deux à la fois.",
        };
      montant = libre;
    }
    if (montant <= 0) return { erreur: "Rien à rembourser." };
    if (dejaCents + montant > order.totalCents)
      return {
        erreur: `Le total remboursé dépasserait le montant encaissé : ${(
          Math.max(0, order.totalCents - dejaCents) / 100
        )
          .toFixed(2)
          .replace(".", ",")} € remboursables au plus.`,
      };

    // Une commande réglée en partie par une CARTE CADEAU (17/11) : chaque
    // moyen ne rend que ce qu'il a reçu. Le prestataire d'abord — c'est de
    // l'argent qui retourne sur le moyen de paiement de la cliente —, la
    // carte ensuite, recréditée dans son journal, jamais au-delà de ce
    // qu'elle a payé pour cette commande.
    const rendableCarte = await resteARendreALaCarte(order.giftCardId, id);
    const [dejaHorsCarte] = await db
      .select({
        n: raw<number>`coalesce(sum(${schema.orderTransactions.amountCents}), 0)::int`,
      })
      .from(schema.orderTransactions)
      .where(
        and(
          eq(schema.orderTransactions.orderId, id),
          eq(schema.orderTransactions.kind, "refund"),
          raw`coalesce(${schema.orderTransactions.gateway}, '') <> 'carte_cadeau'`,
        ),
      );
    const payeHorsCarte = Math.max(
      0,
      order.totalCents - (order.giftCardId ? Math.max(0, order.giftCardCents) : 0),
    );
    const rendableHorsCarte = Math.max(0, payeHorsCarte - Number(dejaHorsCarte?.n ?? 0));
    if (montant > rendableHorsCarte + rendableCarte)
      return {
        erreur: `Le total remboursé dépasserait ce qui reste à rendre : ${(
          (rendableHorsCarte + rendableCarte) / 100
        )
          .toFixed(2)
          .replace(".", ",")} € au plus.`,
      };
    const partPrestataire = Math.min(montant, rendableHorsCarte);
    const partCarte = montant - partPrestataire;

    // Renvoi de l'argent chez le prestataire qui l'a encaissé, s'il est
    // demandé et possible. On ne cherchait ici qu'un paiement Stripe : une
    // vente réglée par PayPal retombait donc sur « à la main », c'est-à-dire
    // que la boutique notait un remboursement que personne n'avait fait.
    // Seule la part du prestataire part chez lui : il refuserait de rendre
    // plus qu'il n'a pris.
    let gateway = partPrestataire > 0 ? "manuel" : "carte_cadeau";
    let externalRef: string | null = null;
    if (b.viaPsp !== false && partPrestataire > 0) {
      const [paiement] = await db
        .select()
        .from(schema.payments)
        .where(
          and(
            eq(schema.payments.orderId, id),
            inArray(schema.payments.provider, ["stripe", "paypal"]),
            eq(schema.payments.status, "succeeded"),
          ),
        )
        .orderBy(desc(schema.payments.createdAt));

      // Les clés du mode où le paiement a été fait. Une commande payée en
      // essai, avant le passage en réel, se rembourse avec les clés d'essai
      // tant qu'elles existent ; sinon, la phrase dit quoi faire.
      const config = paiement ? await configPaiement() : null;
      if (paiement?.provider === "stripe" && paiement.externalRef && config) {
        const mode = modeDuPaiement(paiement, "stripe", config);
        const jeu = config.jeux.stripe[mode];
        if (!jeu)
          return {
            erreur: `Cette commande a été réglée par carte avec les clés Stripe ${nomDuMode("stripe", mode)}, qui ne sont plus sur ce serveur. Remboursez depuis votre tableau de bord Stripe, puis enregistrez le remboursement ici en décochant « rendre l'argent ».`,
            code: 400,
          };
        try {
          const r = await refundStripe(jeu, paiement.externalRef, partPrestataire);
          gateway = "stripe";
          externalRef = r.id;
        } catch (e) {
          return {
            erreur: `Stripe a refusé le remboursement : ${String(e)}`,
            code: 502,
          };
        }
      } else if (paiement?.provider === "paypal" && config) {
        const mode = modeDuPaiement(paiement, "paypal", config);
        const jeu = config.jeux.paypal[mode];
        if (!jeu)
          return {
            erreur: `Cette commande a été réglée par PayPal (${nomDuMode("paypal", mode)}), et les identifiants PayPal de ce mode ne sont pas sur ce serveur. Remboursez depuis votre compte PayPal, puis enregistrez le remboursement ici en décochant « rendre l'argent ».`,
            code: 400,
          };
        // PayPal ne rembourse pas une commande mais une CAPTURE. Les ventes
        // d'avant qu'on garde cet identifiant n'en ont pas : on le redemande
        // plutôt que d'échouer sans explication.
        let capture = paiement.captureRef;
        if (!capture && paiement.externalRef) {
          try {
            capture = await capturePaypalDeLaCommande(jeu, paiement.externalRef);
            if (capture)
              await db
                .update(schema.payments)
                .set({ captureRef: capture })
                .where(eq(schema.payments.id, paiement.id));
          } catch {
            capture = null;
          }
        }
        if (!capture)
          return {
            erreur:
              "L'encaissement PayPal de cette commande est introuvable. Remboursez depuis votre compte PayPal, puis enregistrez le remboursement ici en décochant « rendre l'argent ».",
            code: 502,
          };
        try {
          const r = await refundPaypal(jeu, capture, partPrestataire);
          gateway = "paypal";
          externalRef = r.id;
        } catch (e) {
          return {
            // L'explication en clair (RefusPaypal) plutôt que « RefusPaypal:
            // PayPal a refusé : CODE — … » : c'est la boutique qui la lit.
            erreur: `PayPal a refusé le remboursement. ${e instanceof RefusPaypal ? e.explication : String(e)}`,
            code: 502,
          };
        }
      }
    }

    // La part de la carte cadeau lui est rendue dans SON journal, sous
    // verrou : jamais plus que ce qu'elle a payé pour cette commande, même si
    // deux remboursements partent au même instant.
    const rendueALaCarte =
      partCarte > 0 && order.giftCardId
        ? await db.transaction((tx) =>
            recrediterCarte(
              tx,
              order.giftCardId!,
              order,
              partCarte,
              `Remboursement de la commande ${order.number}`,
            ),
          )
        : 0;
    // Ce qui a vraiment été rendu, par les deux moyens réunis.
    const rendu = partPrestataire + rendueALaCarte;
    if (rendu <= 0) return { erreur: "Rien à rembourser." };

    const [refund] = await db
      .insert(schema.refunds)
      .values({
        orderId: id,
        amountCents: rendu,
        shippingCents: portDemande,
        reason: String(b.reason ?? "").trim() || null,
        note: String(b.note ?? "").trim() || null,
        restock: b.restock === true,
        gateway,
        externalRef,
        author: String(b.author ?? "").trim() || null,
      })
      .returning();
    if (detail.length)
      await db
        .insert(schema.refundItems)
        .values(detail.map((d) => ({ ...d, refundId: refund!.id })));

    // Le grand livre : une ligne par moyen qui rend de l'argent.
    if (partPrestataire > 0)
      await db.insert(schema.orderTransactions).values({
        orderId: id,
        kind: "refund",
        status: "success",
        amountCents: partPrestataire,
        gateway,
        externalRef,
        message: String(b.reason ?? "").trim() || null,
      });
    if (rendueALaCarte > 0)
      await db.insert(schema.orderTransactions).values({
        orderId: id,
        kind: "refund",
        status: "success",
        amountCents: rendueALaCarte,
        gateway: "carte_cadeau",
        externalRef: `carte-${order.giftCardId}`,
        message: "Recrédité sur la carte cadeau",
      });

    // Remise en stock, pour les articles qui en ont un (magnets, cartes) ;
    // une affiche imprimée à la commande n'a rien à réintégrer.
    if (b.restock === true)
      await remettreEnStock(
        lignes,
        new Map(detail.map((d) => [d.orderItemId, d.quantity])),
      );

    const enEuros = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} €`;
    await db.insert(schema.orderEvents).values({
      orderId: id,
      kind: "event",
      message:
        `Remboursement de ${enEuros(rendu)}` +
        (partPrestataire > 0
          ? gateway === "stripe"
            ? " via Stripe"
            : gateway === "paypal"
              ? " via PayPal"
              : " (hors ligne)"
          : "") +
        (rendueALaCarte > 0
          ? partPrestataire > 0
            ? `, dont ${enEuros(rendueALaCarte)} recrédités sur la carte cadeau`
            : " recrédités sur la carte cadeau"
          : "") +
        (libre > 0 ? (b.tout === true ? " (tout le reste)" : " (montant libre)") : "") +
        (b.restock === true ? ", articles remis en stock" : "") +
        ".",
    });

    // Les cartes cadeaux que cette commande avait ACHETÉES et qu'on rembourse
    // ne doivent plus servir : la cliente ne garde pas l'argent ET la carte.
    // Rembourser tout, ou leurs lignes, les met hors service ; un montant
    // libre ne dit pas lesquelles, la boutique en décide au BO.
    const lignesCartes = lignes.filter((l) => l.giftCard).map((l) => l.id);
    if (lignesCartes.length) {
      const visees =
        b.tout === true
          ? null
          : detail.map((d) => d.orderItemId).filter((oid) => lignesCartes.includes(oid));
      const note =
        visees === null || visees.length
          ? await desactiverCartesVendues(id, visees, `remboursement de la commande ${order.number}`)
          : libre > 0
            ? "Cette commande a vendu une ou plusieurs cartes cadeaux : ce remboursement libre ne les a pas mises hors service. Faites-le au besoin dans BO › Cartes cadeaux."
            : null;
      if (note)
        await db.insert(schema.orderEvents).values({ orderId: id, kind: "event", message: note });
    }

    // Le courrier suit le remboursement qui vient d'être inscrit, et lui seul.
    // Rejouer la requête ne le renverra pas : elle créerait un AUTRE
    // remboursement, et n'y arrive pas — les quantités déjà rendues et le
    // plafond du montant encaissé la refusent avant d'en écrire un second.
    await previenirDuRemboursement(id, {
      montantCents: rendu,
      portCents: portDemande,
      articles: articlesRendus,
      totalRembourseCents: dejaCents + rendu,
      viaPaiementEnLigne: partPrestataire > 0 && gateway !== "manuel",
      surCarteCadeauCents: rendueALaCarte,
    });
    return { refund: refund!, montantCents: rendu };
  }

  /**
   * Dit à la cliente ce qui vient de lui être rendu.
   *
   * Même prudence que pour l'expédition : le remboursement est écrit, le grand
   * livre en fait foi, et un courrier qui ne part pas n'a rien à défaire. Ne
   * lève donc jamais, et l'échec se lit dans la chronologie de la commande.
   *
   * RIEN ne part pour une commande de stand : ce courrier porte des montants,
   * et le stand n'en écrit aucun, du premier écran de la tablette jusqu'ici.
   * C'est la vendeuse qui a annoncé le prix de vive voix, et c'est elle qui
   * rend l'argent en disant ce qu'elle rend.
   */
  async function previenirDuRemboursement(
    orderId: number,
    remboursement: {
      montantCents: number;
      portCents: number;
      articles: LigneCourrier[];
      totalRembourseCents: number;
      viaPaiementEnLigne: boolean;
      /** La part rendue sur la carte cadeau qui avait payé. */
      surCarteCadeauCents?: number;
    },
  ): Promise<void> {
    if (!mailConfigure()) return;
    try {
      const [commande] = await db
        .select({
          number: schema.orders.number,
          channel: schema.orders.channel,
          customerId: schema.orders.customerId,
          totalCents: schema.orders.totalCents,
          langue: schema.orders.langue,
        })
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId));
      if (!commande) return;

      if (commande.channel === "salon") {
        await db.insert(schema.orderEvents).values({
          orderId,
          kind: "event",
          message:
            "Aucun courrier de remboursement : commande prise au stand, où les montants ne s'écrivent pas.",
        });
        return;
      }
      if (!commande.customerId) return;

      const [client] = await db
        .select({
          name: schema.customers.name,
          firstName: schema.customers.firstName,
          email: schema.customers.email,
          langue: schema.customers.langue,
        })
        .from(schema.customers)
        .where(eq(schema.customers.id, commande.customerId));
      if (!client?.email) return;
      const langue = langueDuDestinataire({
        compte: client.langue,
        commande: commande.langue,
      });

      const courrier = courrierRemboursee({
        langue,
        prenomClient:
          prenomPourCourrier(client) || tc(langue)("commun.prenomParDefaut"),
        numero: commande.number,
        montantCents: remboursement.montantCents,
        portCents: remboursement.portCents,
        articles: titresDansLaLangue(remboursement.articles, langue),
        totalRembourseCents: remboursement.totalRembourseCents,
        totalCommandeCents: commande.totalCents,
        viaPaiementEnLigne: remboursement.viaPaiementEnLigne,
        surCarteCadeauCents: remboursement.surCarteCadeauCents ?? 0,
      });
      const parti = await envoyerCourrier({ ...courrier, to: client.email });
      await db.insert(schema.orderEvents).values({
        orderId,
        kind: "event",
        message: parti
          ? `Courrier envoyé à ${client.email} : ${courrier.subject}.`
          : `Le courrier « ${courrier.subject} » n'a pas pu partir vers ${client.email}.`,
      });
    } catch {
      // Une panne de courrier ne défait pas un remboursement enregistré.
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Annuler une commande                                              */
  /* ------------------------------------------------------------------ */

  /**
   * Annule une commande.
   *
   * L'annulation n'EFFACE rien : la commande reste dans la liste, sa
   * chronologie reste lisible, ses mouvements d'argent restent au grand livre.
   * Elle sort en revanche des chiffres (`HORS_VENTES`) et ne peut plus rien
   * expédier. C'est ce qui la distingue de la suppression, qui, elle, fait
   * disparaître la vente pour de bon.
   *
   * Elle fait, dans cet ordre, tout ce qu'une annulation demande : rendre
   * l'argent si on le lui demande, remettre le stock, fermer les expéditions,
   * inscrire au grand livre ce qui ne sera jamais encaissé, poser le statut,
   * prévenir la cliente, et tout écrire au journal. Cet ordre n'est pas
   * indifférent : l'argent part AVANT le changement de statut, parce que le
   * remboursement plafonne au montant encaissé et qu'une commande déjà
   * marquée annulée n'aurait plus rien à rendre.
   */
  app.post("/admin/orders/:id/cancel", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: "commande inconnue" }, 400);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, id));
    if (!order) return c.notFound();

    const r = await annulerLaCommande(order, b);
    if ("erreur" in r) return c.json({ error: r.erreur }, r.code);
    return c.json(r);
  });

  /**
   * L'annulation elle-même : celle de la route ci-dessus, et celle des ventes
   * mises en test par la sélection (action groupée « test », 20/11).
   *
   * Une fonction plutôt que le corps de la route : une vente de test EST une
   * vente annulée, et ce qui change le statut, le grand livre et le courrier
   * d'une annulation reste ainsi écrit une seule fois, quel que soit le
   * chemin qui y mène.
   *
   * `b` est le corps de la route : motif, motifLibre, rembourser, restock,
   * viaPsp, note, author, et `test` (ventes-de-test.ts). Un refus rend sa
   * phrase et le code HTTP de la route.
   */
  async function annulerLaCommande(
    order: typeof schema.orders.$inferSelect,
    b: Record<string, unknown>,
  ): Promise<
    | { erreur: string; code: 400 | 409 | 502 }
    | {
        ok: true;
        numero: string;
        annuleeLe: string | null;
        motif: string | null;
        rembourseCents: number;
        /** Ce que l'annulation laisse dû à la cliente. */
        resteADevoir: number;
        /** Une mise en test (`test: true`). */
        test?: true;
        /** La vente était déjà en test : rien n'a été refait. */
        deja?: true;
      }
  > {
    const id = order.id;

    /*
     * La mise en test (20/11, Alexandra : « il faudrait ajouter "test" comme
     * ça on peut mettre des commandes en test », puis : « non pour mettre en
     * test à la main c'est avec sélectionner et une option à la sélection ») :
     * `{ test: true }`, que l'action groupée « test » pose pour chaque vente
     * cochée. Une vente d'essai du stand s'annule par le chemin ci-dessous,
     * sans rien de plus — aucun courriel, l'encaissement sur place sort du
     * grand livre —, avec le motif « Commande de test » et l'étiquette
     * « test », qui la range dans l'onglet « Test » de Ventes stand
     * (ventes-de-test.ts). La règle écarte les commandes du site, les
     * reprises de Shopify et les paniers.
     */
    const test = b.test === true ? miseEnTest(order) : null;
    if (test?.geste === "refuser") return { erreur: test.erreur, code: 400 };
    if (test?.geste === "rien")
      return {
        ok: true,
        test: true,
        deja: true,
        numero: order.number,
        annuleeLe: order.cancelledAt?.toISOString() ?? null,
        motif: order.cancelReason,
        rembourseCents: 0,
        resteADevoir: 0,
      };
    if (test?.geste === "etiqueter") {
      // Déjà annulée, donc déjà hors des chiffres, et son annulation a soldé
      // son grand livre : l'étiquette et le motif, rien d'autre. L'ancien
      // motif reste lisible au journal, sur la ligne de l'annulation.
      await db
        .update(schema.orders)
        .set({ tags: avecEtiquetteTest(order.tags), cancelReason: MOTIF_TEST })
        .where(eq(schema.orders.id, id));
      await db.insert(schema.orderEvents).values({
        orderId: id,
        kind: "event",
        author: String(b.author ?? "").trim() || null,
        message: `Vente mise en test (elle était déjà annulée${
          order.cancelReason ? `, motif « ${order.cancelReason} »` : ""
        } ; grand livre inchangé) : hors des chiffres, aucun courriel.`,
      });
      return {
        ok: true,
        test: true,
        numero: order.number,
        annuleeLe: order.cancelledAt?.toISOString() ?? null,
        motif: MOTIF_TEST,
        rembourseCents: 0,
        resteADevoir: 0,
      };
    }

    if (order.status === "cancelled" || order.status === "voided")
      return {
        erreur: `La commande ${order.number} est déjà annulée${
          order.cancelledAt
            ? ` depuis le ${order.cancelledAt.toLocaleDateString("fr-FR", { timeZone: FUSEAU_BOUTIQUE })}`
            : ""
        }. Rien n'a été refait.`,
        code: 400,
      };

    // Un panier n'est pas une commande : il n'a jamais été passé, il n'y a
    // rien à annuler ni personne à prévenir. Il se supprime, ou il s'oublie.
    if (order.status === "draft")
      return {
        erreur:
          "Ceci est un panier abandonné, pas une commande : il n'y a rien à annuler. Supprimez-le si vous voulez qu'il disparaisse.",
        code: 400,
      };

    const resume = (await resumeCommandes([id])).get(id)!;
    const auStand = order.channel === "salon";

    // Ce qui est PARTI ne se rattrape pas par une annulation. On le dit avec
    // les chiffres sous les yeux, et on dit quoi faire à la place : sans cela,
    // le refus ressemble à une panne.
    //
    // Une vente du STAND, même remise (« Terminée », marquée au BO depuis le
    // 26/11), s'annule quand même — le client n'a pas payé, ou autre
    // (Alexandra : « si elle paie pas ou autre, faut que Margaux puisse
    // annuler ») : sa remise tombe plus bas, avec les expéditions.
    if (resume.expedies > 0 && !auStand)
      return {
        erreur:
          resume.expedies >= resume.articles
            ? `Cette commande est déjà entièrement partie (${resume.expedies} article(s)). On n'annule pas un colis en route : annulez d'abord l'expédition si elle n'est pas réellement partie, sinon enregistrez un remboursement au retour du colis.`
            : `Cette commande est déjà partie en partie : ${resume.expedies} article(s) sur ${resume.articles} ont quitté l'atelier. Annulez d'abord cette expédition si le colis n'est pas réellement parti ; sinon, remboursez ce qui revient plutôt que d'annuler la commande entière.`,
        code: 400,
      };

    // Une vente de test a son motif à elle, toujours le même : c'est lui qui
    // la dit essai, au journal comme sur la fiche.
    const motif = test ? MOTIF_TEST : motifDAnnulation(b.motif, b.motifLibre);
    const auteur = String(b.author ?? "").trim() || null;
    const etaitPayee = order.status === "paid";

    const lignes = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, id));

    /* --- 0. Le bordereau, s'il en a un -------------------------------- */

    // Une étiquette achetée avant l'annulation restait valable — et
    // facturée — : l'annulation bloquait seulement l'achat d'une nouvelle
    // (Alexandra, 17/11 : « quand la commande est annulée, on ne doit plus
    // pouvoir acheter de bordereau »). Elle est annulée chez SendCloud ICI,
    // AVANT l'argent : si SendCloud refuse, rien n'est rendu ni annulé, et la
    // boutique sait quoi faire.
    const [etiquette] = await db
      .select({ statut: schema.bordereaux.statut, suivi: schema.bordereaux.trackingNumber })
      .from(schema.bordereaux)
      .where(
        and(
          eq(schema.bordereaux.orderId, id),
          inArray(schema.bordereaux.statut, ["achete", "en_cours"]),
        ),
      );
    if (etiquette) {
      try {
        await annulerBordereau(id, auteur ?? undefined);
      } catch (e) {
        return {
          erreur: `La commande n'a pas été annulée : son bordereau${etiquette.suivi ? ` ${etiquette.suivi}` : ""} n'a pas pu être annulé chez SendCloud (${e instanceof Error ? e.message : String(e)}). Annulez-le depuis le bloc « Bordereau transporteur », puis recommencez.`,
          code: 409,
        };
      }
    }

    /* --- 1. L'argent, s'il faut le rendre ----------------------------- */

    let rembourseCents = 0;
    // Au stand, l'argent se règle de la main à la main : rien ne se rembourse
    // d'ici (17/11). L'annulation retire l'encaissement du grand livre (plus
    // bas, 3).
    if (b.rembourser === true && !auStand) {
      if (!etaitPayee)
        return {
          erreur:
            "Cette commande n'a jamais été encaissée : il n'y a rien à rembourser. Décochez le remboursement pour l'annuler.",
          code: 400,
        };
      // Tout ce qui reste encaissé, port compris (la commande entière est
      // annulée, la cliente n'a rien reçu) : le même calcul que « tout
      // rembourser » (enregistrerRemboursement, `tout`), remises et montants
      // libres déjà rendus compris.
      const dejaRembourse = (await resumeCommandes([id])).get(id)!.rembourseCents;
      // Une commande déjà entièrement remboursée n'a plus rien à rendre. Le
      // remboursement refuserait — « Rien à rembourser » — et son refus
      // arrêterait l'annulation, alors qu'elle est justement le geste qui
      // reste à faire. On saute donc l'étape au lieu de buter dessus.
      if (order.totalCents - dejaRembourse <= 0) {
        await db.insert(schema.orderEvents).values({
          orderId: id,
          kind: "event",
          message:
            "Aucun remboursement à l'annulation : tout avait déjà été rendu sur cette commande.",
        });
      } else {
        const r = await enregistrerRemboursement(id, {
          tout: true,
          reason: motif ?? "Commande annulée",
          note: String(b.note ?? "").trim() || null,
          restock: b.restock === true,
          viaPsp: b.viaPsp !== false,
          author: auteur,
        });
        // Un remboursement refusé ARRÊTE l'annulation. Annuler quand même
        // laisserait une commande annulée dont l'argent est resté chez nous,
        // et c'est exactement le genre d'écart qu'on ne retrouve jamais.
        if (r.erreur)
          return {
            erreur: `La commande n'a pas été annulée : le remboursement a échoué. ${r.erreur}`,
            code: r.code ?? 400,
          };
        rembourseCents = r.montantCents ?? 0;
      }
    } else if (b.restock === true) {
      // Sans remboursement, la remise en stock n'a personne pour la faire :
      // on la fait ici, sur la totalité de ce qui a été commandé.
      await remettreEnStock(
        lignes,
        new Map(lignes.map((l) => [l.id, l.quantity])),
      );
    }

    /* --- 2. Les expéditions ------------------------------------------- */

    // Aucune expédition vivante ne survit à une annulation. Le contrôle plus
    // haut a déjà écarté les commandes dont quelque chose est parti : ce qui
    // reste ici est une expédition à zéro article, ou une trace laissée par
    // une manœuvre concurrente. L'appel est donc une GARANTIE, pas un geste
    // courant — mais sans lui, la garantie ne tiendrait qu'à un contrôle.
    await annulerExpeditions([id]);

    /* --- 3. Le grand livre -------------------------------------------- */

    // Une vente du stand annulée n'a pas été payée — ou l'argent a été rendu
    // de la main à la main : son encaissement sur place sort du grand livre,
    // comme quand la tablette rouvre une vente (salon.ts). L'écriture
    // d'annulation, plus bas, dit alors que cet argent n'arrivera pas.
    if (auStand)
      await db
        .update(schema.orderTransactions)
        .set({ status: "annule" })
        .where(
          and(
            eq(schema.orderTransactions.orderId, id),
            eq(schema.orderTransactions.kind, "sale"),
            eq(schema.orderTransactions.status, "success"),
            inArray(schema.orderTransactions.gateway, ["stand", "manuel"]),
          ),
        );

    // Ce qui n'a jamais été encaissé doit quand même se lire quelque part.
    // Une commande qui disparaît des chiffres sans un mot laisse la page
    // Finances avec une vente attendue qui ne vient pas ; l'écriture « void »
    // dit noir sur blanc que cet argent-là n'arrivera pas. On ne l'écrit que
    // s'il n'y a EU aucun encaissement : sinon c'est le remboursement qui
    // solde la commande, et deux écritures raconteraient deux histoires.
    const [encaisse] = await db
      .select({
        cents: raw<number>`coalesce(sum(${schema.orderTransactions.amountCents}), 0)::int`,
      })
      .from(schema.orderTransactions)
      .where(
        and(
          eq(schema.orderTransactions.orderId, id),
          eq(schema.orderTransactions.kind, "sale"),
          eq(schema.orderTransactions.status, "success"),
        ),
      );
    const rienEncaisse = (encaisse?.cents ?? 0) <= 0;
    if (rienEncaisse && order.totalCents > 0)
      await db.insert(schema.orderTransactions).values({
        orderId: id,
        kind: "void",
        status: "success",
        amountCents: order.totalCents,
        gateway: null,
        message: motif,
      });

    /* --- 3 bis. Les cartes cadeaux ------------------------------------ */

    // La carte cadeau qui avait payé une part : ce qu'elle a payé pour cette
    // commande, et qu'un remboursement ne lui a pas déjà rendu, revient dans
    // son journal. Une commande jamais payée n'a rien débité : rien à rendre.
    const rendueALaCarte = order.giftCardId
      ? await db.transaction((tx) =>
          recrediterCarte(tx, order.giftCardId!, order, null, `Commande ${order.number} annulée`),
        )
      : 0;
    // Les cartes que la commande avait ACHETÉES ne servent plus.
    const noteCartes = await desactiverCartesVendues(
      id,
      null,
      `commande ${order.number} annulée`,
    );
    if (noteCartes)
      await db.insert(schema.orderEvents).values({ orderId: id, kind: "event", message: noteCartes });

    /* --- 4. Le statut -------------------------------------------------- */

    const annuleeLe = new Date();
    await db
      .update(schema.orders)
      .set({
        status: "cancelled",
        cancelledAt: annuleeLe,
        cancelReason: motif,
        // Une commande annulée n'est pas « traitée » : elle n'a plus rien à
        // faire, ce qui n'est pas la même chose que d'avoir tout fait.
        fulfilledAt: null,
        // L'étiquette d'une vente de test, posée avec le statut : l'une ne va
        // pas sans l'autre (ventes-de-test.ts, `estVenteDeTest`).
        ...(test ? { tags: avecEtiquetteTest(order.tags) } : {}),
      })
      .where(eq(schema.orders.id, id));

    /* --- 5. Le journal -------------------------------------------------- */

    /*
     * Ce que l'annulation laisse dû à la cliente.
     *
     * On retranche AUSSI ce qui avait été rendu avant elle : une commande déjà
     * remboursée en entier ne doit plus rien, et annoncer le contraire
     * enverrait la boutique rendre une seconde fois le même argent.
     */
    // Au stand, rien n'est dû : l'encaissement sur place vient d'être retiré.
    const resteADevoir =
      etaitPayee && !auStand
        ? Math.max(0, order.totalCents - resume.rembourseCents - rembourseCents - rendueALaCarte)
        : 0;

    await db.insert(schema.orderEvents).values({
      orderId: id,
      kind: "event",
      author: auteur,
      message:
        `Commande annulée${motif ? ` — ${motif}` : ""}.` +
        (rembourseCents > 0
          ? ` ${(rembourseCents / 100).toFixed(2).replace(".", ",")} € remboursés dans la foulée.`
          : resteADevoir > 0
            ? ` Le montant réglé n'a PAS été remboursé : ${(resteADevoir / 100).toFixed(2).replace(".", ",")} € restent à rendre au client.`
            : "") +
        (rendueALaCarte > 0
          ? ` ${(rendueALaCarte / 100).toFixed(2).replace(".", ",")} € recrédités sur la carte cadeau qui avait payé.`
          : "") +
        (b.restock === true ? " Articles remis en stock." : "") +
        (rienEncaisse && order.totalCents > 0
          ? " Écriture d'annulation portée au grand livre."
          : ""),
    });

    if (order.invoiceNumber)
      await db.insert(schema.orderEvents).values({
        orderId: id,
        kind: "event",
        message: `La facture ${order.invoiceNumber} a déjà été éditée pour cette commande : elle garde son numéro et reste éditable, portant désormais la mention « annulée ». Un avoir reste à établir si elle est partie chez le client.`,
      });

    // Une vente de test s'arrête ici : elle n'a personne à prévenir, et sa
    // ligne du journal le dit (« aucun courriel »). Les autres ventes du stand
    // passent par previenirDeLAnnulation, qui ne leur écrit rien non plus.
    if (test) {
      await db.insert(schema.orderEvents).values({
        orderId: id,
        kind: "event",
        author: auteur,
        message: `Vente mise en test (annulée, motif « ${MOTIF_TEST} », étiquette « ${ETIQUETTE_TEST} ») : hors des chiffres, aucun courriel.`,
      });
      return {
        ok: true,
        test: true,
        numero: order.number,
        annuleeLe: annuleeLe.toISOString(),
        motif,
        rembourseCents,
        resteADevoir,
      };
    }

    /* --- 6. Le courrier ------------------------------------------------ */

    await previenirDeLAnnulation(id, {
      // Le choix brut, pas la phrase du journal : le courrier recompose le
      // motif dans la langue de la cliente.
      motif: { choix: b.motif, libre: b.motifLibre },
      // Une commande payée dont on n'a rien rendu ne doit pas laisser croire
      // à la cliente que son argent revient : le modèle ne le dit que si un
      // remboursement a réellement eu lieu.
      dejaPayee: rembourseCents > 0,
      articles: lignes.map((l) => {
        const cfg = (l.config ?? {}) as { format?: unknown };
        return {
          titre: l.title ?? "Affiche personnalisée",
          format: typeof cfg.format === "string" ? cfg.format : null,
          cadre: null,
          quantite: l.quantity,
          unitPriceCents: l.unitPriceCents,
        };
      }),
      auStand,
    });

    return {
      ok: true,
      numero: order.number,
      annuleeLe: annuleeLe.toISOString(),
      motif,
      rembourseCents,
      // Ce que l'annulation LAISSE en suspens : l'écran le répète à la
      // boutiquière, qui vient de faire un geste dont elle ne verra plus la
      // conséquence nulle part si personne ne le lui dit.
      resteADevoir,
    };
  }

  /**
   * Les motifs proposés, et leur libellé complet.
   *
   * Une liste COURTE, choisie plutôt que tapée : un motif libre finit par
   * contenir « annulée », « annulation », « annul. » et « à la demande » pour
   * dire la même chose, et plus rien ne se compte ni ne se retrouve. Le champ
   * libre reste là pour « autre », parce qu'aucune liste ne couvre tout.
   */
  /*
   * Les libellés vivent dans le dictionnaire des courriels : le même motif
   * s'écrit en français au journal, et dans la langue de la cliente dans son
   * courrier. « Autre » n'en a pas, il ne s'écrit jamais (voir plus bas).
   */
  const MOTIFS_ANNULATION: Record<string, CleCourriel | null> = {
    saisie: "annulee.motifSaisie",
    rupture: "annulee.motifRupture",
    cliente: "annulee.motifCliente",
    impaye: "annulee.motifImpaye",
    autre: null,
  };

  /**
   * Le motif tel qu'il s'écrira au journal (en français) et dans le courrier
   * (dans la langue de la cliente). La précision saisie par la boutique, elle,
   * reste telle qu'elle a été écrite.
   */
  function motifDAnnulation(
    choix: unknown,
    libre: unknown,
    langue: Langue = "fr",
  ): string | null {
    const cle = String(choix ?? "").trim();
    const precision = String(libre ?? "")
      .trim()
      .slice(0, 200);
    const connu = Object.prototype.hasOwnProperty.call(MOTIFS_ANNULATION, cle);
    const libelle = connu ? MOTIFS_ANNULATION[cle] : null;
    // « Autre » sans précision ne dit rien : mieux vaut alors ne rien écrire
    // que d'envoyer à la cliente un motif qui s'appelle « Autre ». Un choix
    // inconnu vaut de même sa seule précision.
    if (!libelle) return precision || null;
    const texte = tc(langue)(libelle);
    return precision ? `${texte} — ${precision}` : texte;
  }

  /**
   * Dit à la cliente que sa commande est annulée.
   *
   * Même prudence que pour l'expédition et le remboursement : l'annulation est
   * écrite, elle ne se défait pas parce qu'un courrier n'est pas parti. Ne lève
   * donc jamais, et l'échec se lit dans la chronologie.
   *
   * RIEN ne part pour une commande de stand — la MÊME règle que le
   * remboursement, et pour la même raison : personne n'a laissé son adresse
   * e-mail au stand pour recevoir des nouvelles administratives, la vendeuse a
   * la cliente en face d'elle ou au téléphone, et c'est elle qui lui dit.
   */
  async function previenirDeLAnnulation(
    orderId: number,
    annulation: {
      /** Le motif tel que la boutique l'a choisi : il s'écrit dans la langue du courrier. */
      motif: { choix: unknown; libre: unknown };
      dejaPayee: boolean;
      articles: LigneCourrier[];
      auStand: boolean;
    },
  ): Promise<void> {
    try {
      if (annulation.auStand) {
        await db.insert(schema.orderEvents).values({
          orderId,
          kind: "event",
          message:
            "Aucun courrier d'annulation : commande prise au stand, c'est la vendeuse qui prévient le client.",
        });
        return;
      }
      if (!mailConfigure()) {
        await db.insert(schema.orderEvents).values({
          orderId,
          kind: "event",
          message:
            "Aucun courrier d'annulation : l'envoi d'e-mails n'est pas configuré. Le client n'a pas été prévenu.",
        });
        return;
      }

      const [commande] = await db
        .select({
          number: schema.orders.number,
          customerId: schema.orders.customerId,
          langue: schema.orders.langue,
        })
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId));
      if (!commande?.customerId) {
        await db.insert(schema.orderEvents).values({
          orderId,
          kind: "event",
          message:
            "Aucun courrier d'annulation : cette commande n'a pas de client rattaché.",
        });
        return;
      }

      const [client] = await db
        .select({
          name: schema.customers.name,
          firstName: schema.customers.firstName,
          email: schema.customers.email,
          langue: schema.customers.langue,
        })
        .from(schema.customers)
        .where(eq(schema.customers.id, commande.customerId));
      if (!client?.email) {
        await db.insert(schema.orderEvents).values({
          orderId,
          kind: "event",
          message:
            "Aucun courrier d'annulation : aucune adresse e-mail sur la fiche du client.",
        });
        return;
      }
      const langue = langueDuDestinataire({
        compte: client.langue,
        commande: commande.langue,
      });

      const courrier = courrierAnnulee({
        langue,
        prenomClient:
          prenomPourCourrier(client) || tc(langue)("commun.prenomParDefaut"),
        numero: commande.number,
        motif: motifDAnnulation(annulation.motif.choix, annulation.motif.libre, langue),
        articles: titresDansLaLangue(annulation.articles, langue),
        dejaPayee: annulation.dejaPayee,
      });
      const parti = await envoyerCourrier({ ...courrier, to: client.email });
      await db.insert(schema.orderEvents).values({
        orderId,
        kind: "event",
        message: parti
          ? `Courrier envoyé à ${client.email} : ${courrier.subject}.`
          : `Le courrier « ${courrier.subject} » n'a pas pu partir vers ${client.email}.`,
      });
    } catch {
      // Une panne de courrier ne défait pas une annulation enregistrée.
    }
  }

  /**
   * Les champs de l'adresse de livraison, et leur nom dans la chronologie.
   * Le même ordre que le formulaire : c'est celui dans lequel on les relit.
   */
  const CHAMPS_ADRESSE = {
    shippingName: "nom",
    shippingLine1: "adresse",
    shippingLine2: "complément",
    shippingPostalCode: "code postal",
    shippingCity: "ville",
    shippingCountry: "pays",
    shippingPhone: "téléphone",
  } as const;
  type ChampAdresse = keyof typeof CHAMPS_ADRESSE;

  /**
   * Corrige l'adresse de livraison d'une commande déjà passée — depuis la
   * colonne de droite de la fiche, ou depuis le bloc du bordereau, qui en a
   * besoin avant d'acheter : un retrait sur place qu'on finit par envoyer, une
   * vente du stand qui doit voyager, une adresse fausse.
   *
   * Seuls les champs ENVOYÉS changent. Le bloc du bordereau d'une commande en
   * point relais ne corrige que le nom et le téléphone : il n'a pas à renvoyer
   * une adresse qu'il n'affiche pas pour qu'elle survive.
   *
   * `livrerALAdresse` envoie le colis à cette adresse plutôt qu'au point
   * relais choisi — un point fermé depuis, une cliente qui préfère être
   * livrée chez elle. Le point quitte la commande ; la chronologie le garde.
   *
   * La chronologie dit QUI a changé QUOI, ancienne et nouvelle valeur : une
   * étiquette partie à la mauvaise adresse se comprend en la relisant.
   */
  app.post("/admin/orders/:id/address", async (c) => {
    const id = Number(c.req.param("id"));
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const txt = (v: unknown) => {
      const s = String(v ?? "").trim();
      return s ? s.slice(0, 200) : null;
    };
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
    if (!order) return c.notFound();

    const maj: Partial<Record<ChampAdresse, string | null>> = {};
    for (const champ of Object.keys(CHAMPS_ADRESSE) as ChampAdresse[])
      if (champ in b) maj[champ] = txt(b[champ]);
    // Le pays sert de code aux transporteurs (« FR », « BE ») : « France »
    // écrit en toutes lettres ferait refuser l'étiquette bien plus tard, en
    // anglais. Mieux vaut le refuser ici, en français.
    if (maj.shippingCountry) {
      const pays = maj.shippingCountry.toUpperCase();
      if (!/^[A-Z]{2}$/.test(pays))
        return c.json(
          { error: "Le pays s'écrit avec son code à deux lettres : FR, BE, CH, LU…" },
          400,
        );
      maj.shippingCountry = pays;
    }
    // Un ancien retrait sur stand se rangeait lui aussi dans `relayPointId`
    // (« stand:3 ») : ce n'est pas un point relais à quitter, le colis va
    // déjà à l'adresse. `lieuDeRetrait` sait reconnaître les deux formes.
    const pointQuitte =
      b.livrerALAdresse === true && !!order.relayPointId && !lieuDeRetrait(order)
        ? (order.relayPointLabel ?? order.relayPointId)
        : null;

    const changes = (Object.keys(maj) as ChampAdresse[])
      .filter((k) => (order[k] ?? null) !== maj[k])
      .map((k) => `${CHAMPS_ADRESSE[k]} : « ${order[k] ?? "—"} » → « ${maj[k] ?? "—"} »`);
    if (!changes.length && !pointQuitte) return c.json({ ok: true, modifie: false, bordereauVivant: false });

    await db
      .update(schema.orders)
      .set({ ...maj, ...(pointQuitte ? { relayPointId: null, relayPointLabel: null } : {}) })
      .where(eq(schema.orders.id, id));

    // Une étiquette déjà achetée porte l'ANCIENNE adresse : SendCloud ne la
    // modifie pas. La fiche le redit, pour qu'on l'annule et qu'on la rachète.
    const [vivant] = await db
      .select({ id: schema.bordereaux.id })
      .from(schema.bordereaux)
      .where(
        and(
          eq(schema.bordereaux.orderId, id),
          inArray(schema.bordereaux.statut, ["achete", "en_cours"]),
        ),
      );
    const auteur = String(b.author ?? "").trim() || c.get("utilisateur")?.email || null;
    await db.insert(schema.orderEvents).values({
      orderId: id,
      kind: "event",
      author: auteur,
      message:
        (pointQuitte
          ? `Livraison au point relais « ${pointQuitte} » remplacée par une livraison à l'adresse, au back-office`
          : "Adresse de livraison modifiée au back-office") +
        (changes.length ? ` (${changes.join(" ; ")})` : "") +
        "." +
        (vivant ? " Le bordereau déjà acheté porte encore l'ancienne adresse." : ""),
    });
    return c.json({ ok: true, modifie: true, bordereauVivant: !!vivant });
  });

  /* ------------------------------------------------------------------ */
  /*  Encaisser un règlement hors ligne                                 */
  /* ------------------------------------------------------------------ */

  /**
   * Les moyens de règlement qui n'ont pas de prestataire, et leur libellé.
   *
   * Ils vont au JOURNAL, pas au grand livre : la page Finances range tout ce
   * qui entre à la main sous un seul moyen (« À la main (virement, espèces) »),
   * et le détail du chèque ou du virement se lit sur la fiche de la commande,
   * là où on le cherche.
   */
  const MOYENS_HORS_LIGNE: Record<string, string> = {
    // Une vente du stand, réglée au stand (espèces ou carte) : 17/11.
    sur_place: "règlement sur place, au stand",
    virement: "virement bancaire",
    cheque: "chèque",
    especes: "espèces",
    autre: "un autre moyen",
  };

  /**
   * Marque une commande payée alors que l'argent est arrivé hors du site.
   *
   * Le virement et le chèque existent, et rien ne savait les enregistrer : la
   * commande restait « En attente » pour toujours, elle ne sortait jamais dans
   * les commandes à préparer, ses PDF d'impression n'étaient pas fabriqués et
   * la cliente ne recevait aucune confirmation. Elle avait pourtant payé.
   *
   * Tout le travail est fait par `markOrderPaid`, la MÊME fonction qu'un
   * paiement Stripe : date de paiement, PDF d'impression, écriture au grand
   * livre, confirmation à la cliente, panier relancé noté comme récupéré. On
   * ne fait ici que deux choses qu'elle ne fait pas — écrire la ligne de
   * paiement, qu'un paiement en ligne crée au moment du tunnel, et dire au
   * journal qui a encaissé quoi.
   */
  app.post("/admin/orders/:id/encaisser", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: "commande inconnue" }, 400);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, id));
    if (!order) return c.notFound();

    if (order.status === "draft")
      return c.json(
        {
          error:
            "Ceci est un panier abandonné, pas une commande : il n'y a rien à encaisser.",
        },
        400,
      );
    if (order.status === "cancelled" || order.status === "voided")
      return c.json(
        {
          error: `La commande ${order.number} est annulée. Si de l'argent est arrivé pour elle, il est à rendre, pas à encaisser.`,
        },
        400,
      );
    // Une vente du stand s'encaisse ici depuis le 17/11 : la tablette
    // l'enregistre « à encaisser », et Margaux la marque réglée sur place.
    // Aucun courrier ne part pour elle (previenirDuPaiement) : il porterait
    // les tarifs du site, que le stand cache justement.
    // Idempotence : ce n'est PAS une erreur de cliquer deux fois, c'est même
    // le geste naturel quand la page a mis un instant à répondre. On répond
    // donc que c'est déjà fait, sans écrire un second encaissement.
    if (order.status === "paid")
      return c.json({
        ok: true,
        deja: true,
        message: `La commande ${order.number} était déjà marquée payée. Rien n'a été encaissé une seconde fois.`,
      });
    // Ce qui reste à encaisser : le total, moins la part qu'une carte cadeau
    // paiera (son journal la débite au même moment, dans markOrderPaid).
    const aEncaisser =
      order.totalCents - (order.giftCardId ? Math.max(0, order.giftCardCents) : 0);
    if (aEncaisser <= 0)
      return c.json(
        {
          error:
            order.totalCents > 0
              ? "Une carte cadeau couvre toute cette commande : il n'y a rien à encaisser. Le client la valide lui-même à la caisse."
              : "Cette commande ne vaut rien : il n'y a rien à encaisser.",
        },
        400,
      );

    const cle = String(b.moyen ?? "").trim();
    const moyen = MOYENS_HORS_LIGNE[cle];
    if (!moyen)
      return c.json(
        {
          error:
            "Indiquez comment le client a réglé : virement, chèque, espèces, ou autre.",
        },
        400,
      );
    const reference = String(b.reference ?? "")
      .trim()
      .slice(0, 120);
    const auteur = String(b.author ?? "").trim() || null;

    /*
     * La référence sert à retrouver l'argent sur le relevé de banque. Elle
     * doit donc être unique : la même référence sur deux commandes est presque
     * toujours le même chèque saisi deux fois, et c'est justement ce qu'on
     * veut voir arrêté. Sans référence, on en fabrique une à partir de
     * l'identifiant de la commande — `markOrderPaid` s'en sert pour retrouver
     * la ligne de paiement qu'elle doit passer en « succeeded », et une
     * référence vide en aurait rattrapé n'importe laquelle.
     */
    const externalRef = reference || `manuel-${id}`;
    const [dejaPrise] = await db
      .select({
        numero: schema.orders.number,
        orderId: schema.payments.orderId,
      })
      .from(schema.payments)
      .innerJoin(schema.orders, eq(schema.payments.orderId, schema.orders.id))
      .where(eq(schema.payments.externalRef, externalRef));
    if (dejaPrise && dejaPrise.orderId !== id)
      return c.json(
        {
          error: `La référence « ${externalRef} » est déjà portée par la commande ${dejaPrise.numero}. Vérifiez que ce n'est pas le même règlement saisi deux fois.`,
        },
        400,
      );

    await db.insert(schema.payments).values({
      orderId: id,
      // « manuel », et surtout pas « stripe » : la page Finances rapproche les
      // encaissements de ce que les prestataires ont réellement pris, et une
      // ligne Stripe qui n'existe pas chez Stripe y ferait une anomalie
      // permanente. C'est aussi le mot que le remboursement hors ligne emploie
      // déjà, et que Finances sait afficher : « À la main (virement, espèces) ».
      provider: "manuel",
      externalRef,
      status: "pending",
      amountCents: aEncaisser,
    });

    // Le montant déclaré reçu est le total lu plus haut, moins la part d'une
    // carte cadeau : si la commande a bougé depuis — la cliente a modifié son
    // panier, elle est revenue en panier —, markOrderPaid ne valide rien. Elle
    // refuse aussi, en le disant, quand la carte cadeau ne peut plus payer sa
    // part ou qu'un code à usage unique a servi entre-temps.
    let encaissee: boolean;
    let refus: string | null = null;
    try {
      encaissee = await markOrderPaid(id, "manuel", externalRef, {
        montantCents: aEncaisser,
        devise: "EUR",
      });
    } catch (e) {
      if (!(e instanceof ValidationRefusee)) throw e;
      encaissee = false;
      refus = e.message;
    }
    if (!encaissee) {
      // La ligne de paiement posée à l'instant ne correspond à aucun
      // encaissement : la laisser « en attente » ferait croire à un règlement
      // en cours.
      await db
        .delete(schema.payments)
        .where(
          and(
            eq(schema.payments.orderId, id),
            eq(schema.payments.externalRef, externalRef),
            eq(schema.payments.status, "pending"),
          ),
        );
      const [maintenant] = await db
        .select({ status: schema.orders.status })
        .from(schema.orders)
        .where(eq(schema.orders.id, id));
      if (maintenant?.status === "paid")
        return c.json({
          ok: true,
          deja: true,
          message: `La commande ${order.number} était déjà marquée payée. Rien n'a été encaissé une seconde fois.`,
        });
      if (refus)
        return c.json(
          { error: `Rien n'a été encaissé pour la commande ${order.number} : ${refus}` },
          409,
        );
      return c.json(
        {
          error: `La commande ${order.number} a changé pendant la saisie : le client a modifié son panier, et son total n'est plus ${(order.totalCents / 100).toFixed(2).replace(".", ",")} €. Rien n'a été encaissé. Rechargez la page pour voir ce qu'elle contient maintenant.`,
        },
        409,
      );
    }

    await db.insert(schema.orderEvents).values({
      orderId: id,
      kind: "event",
      author: auteur,
      message:
        `Encaissement de ${(aEncaisser / 100).toFixed(2).replace(".", ",")} € reçu par ${moyen}` +
        (aEncaisser !== order.totalCents
          ? ` (le reste, ${((order.totalCents - aEncaisser) / 100).toFixed(2).replace(".", ",")} €, réglé par carte cadeau)`
          : "") +
        (reference ? ` (réf. ${reference})` : "") +
        `, saisi au back-office${auteur ? ` par ${auteur}` : ""}.`,
    });

    return c.json({
      ok: true,
      encaissee,
      montantCents: aEncaisser,
      moyen,
      reference: reference || null,
    });
  });

  /**
   * Corrige le MONTANT d'une vente du stand déjà validée (26/11, Margaux :
   * « pouvoir modifier le montant € de la commande stand une fois qu'elle est
   * validée (car des fois ils changent d'avis ils veulent un cadre par
   * exemple) le but est d'avoir les statistiques bon »).
   *
   * Corps : { totalCents, motif?, author }. Les règles, l'écriture de
   * correction et la phrase du journal sont dans montant-vente-stand.ts. Le
   * total se corrige quelle que soit l'étape de la vente (À imprimer, remise
   * en partie, Terminée) : aucune règle ne lit ses remises.
   * Ici, la commande est relue sous son verrou — le même que prennent la
   * tablette pour rouvrir une vente (salon.ts) et la facture pour se
   * numéroter (numeroterLaFacture) : une facture éditée au même instant
   * passe avant ou après, jamais entre la relecture et l'écriture. Puis le
   * total, l'écriture au grand livre et la ligne du journal partent d'un
   * bloc. L'encaissement d'origine n'est jamais réécrit.
   */
  app.post("/admin/orders/:id/montant", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: "commande inconnue" }, 400);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const apresCents = lireMontantCents(b.totalCents);
    const refusMontant = refusDuMontant(apresCents);
    if (refusMontant || apresCents === null)
      return c.json({ error: refusMontant ?? "Montant illisible." }, 400);
    // Le motif est FACULTATIF depuis le 26/11 (Margaux : « faudrait juste le
    // total indépendamment du reste ») : le total se corrige dans la ligne
    // de Ventes stand, sans rien d'autre à saisir. Sans motif, le journal le
    // dit (phraseDuJournal).
    const motif = lireMotif(b.motif);
    // « Qui » : la session d'abord (la garde de /admin/* l'a posée, une
    // propriétaire), le nom envoyé par le BO à défaut.
    const auteur =
      c.get("utilisateur")?.email?.trim() ||
      String(b.author ?? "").trim().slice(0, 200) ||
      null;

    const resultat = await db.transaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, id))
        .for("no key update");
      if (!order) return { introuvable: true as const };
      const ecritures = await tx
        .select()
        .from(schema.orderTransactions)
        .where(
          and(
            eq(schema.orderTransactions.orderId, id),
            eq(schema.orderTransactions.status, "success"),
          ),
        );
      const [rendus] = await tx
        .select({ n: raw<number>`count(*)::int` })
        .from(schema.refunds)
        .where(eq(schema.refunds.orderId, id));
      const origine = encaissementDOrigine(ecritures);
      const refus = refusDeCorrection({
        number: order.number,
        channel: order.channel,
        status: order.status,
        tags: order.tags,
        legacyId: order.legacyId,
        invoiceNumber: order.invoiceNumber,
        giftCardCents: order.giftCardCents,
        remboursements: Number(rendus?.n ?? 0),
        encaissementDOrigine: origine !== null,
      });
      if (refus) return { erreur: refus };

      const avantCents = order.totalCents;
      const ecriture = ecritureDeCorrection(avantCents, apresCents);
      // Le même montant : rien à écrire, ni au grand livre ni au journal.
      if (!ecriture)
        return { ok: true as const, inchange: true, numero: order.number, avantCents, apresCents };

      await tx
        .update(schema.orders)
        .set({ totalCents: apresCents })
        .where(eq(schema.orders.id, id));
      await tx.insert(schema.orderTransactions).values({
        orderId: id,
        kind: ecriture.kind,
        status: "success",
        amountCents: ecriture.amountCents,
        gateway: PASSERELLE_DU_STAND,
        parentId: origine,
        // Le motif seul : la fiche et la facture le relisent tel quel. Sans
        // motif (26/11), rien : la facture n'imprime alors aucune précision.
        message: motif || null,
      });
      await tx.insert(schema.orderEvents).values({
        orderId: id,
        kind: "event",
        author: auteur,
        message: phraseDuJournal(avantCents, apresCents, motif),
      });
      return { ok: true as const, inchange: false, numero: order.number, avantCents, apresCents };
    });
    if ("introuvable" in resultat) return c.notFound();
    if ("erreur" in resultat) return c.json({ error: resultat.erreur }, 409);
    return c.json(resultat);
  });

  /* ------------------------------------------------------------------ */
  /*  La facture                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Les factures de plusieurs commandes d'un coup, en ZIP (20/11, Alexandra,
   * barre de sélection de Ventes stand : « change bons de livraisons en
   * facture »). Chaque facture est celle du bouton de la fiche
   * (composerLaFacture) : la première édition lui donne son numéro. Réservée
   * à la propriétaire, comme la facture seule. Hors de « /admin/orders » :
   * l'adresse ne doit pas se lire comme l'identifiant d'une commande.
   *
   * Ce numéro ne se reprend jamais : seules les commandes qui doivent avoir
   * une facture en reçoivent une (raisonSansFactureDansLeZip, relecture du
   * 20/11). Les autres — reprises de Shopify, paniers, annulées et ventes de
   * test sans facture, commandes pas encore payées — sont écartées AVANT
   * toute numérotation, et citées par leur numéro de commande, avec leur
   * raison, dans « factures-non-faites.txt ». Leur nombre part aussi dans
   * l'en-tête « X-Factures-Non-Faites », que le back-office affiche.
   *
   * Un GET qui numérote : il ne se fait que depuis le back-office lui-même
   * (requeteDuBackOffice), pas depuis un lien venu d'ailleurs.
   */
  app.get("/admin/factures.zip", async (c) => {
    const user = c.get("utilisateur");
    if (user && user.role !== "owner")
      return c.json({ error: "Les factures sont réservées à la propriétaire." }, 403);
    if (!requeteDuBackOffice(c.req.header("Sec-Fetch-Site")))
      return c.json(
        {
          error:
            "Les factures se téléchargent depuis le back-office (Ventes stand, bouton « Factures »), pas par un lien venu d'une autre page : aucune facture n'a été faite.",
        },
        403,
      );
    const ids = [
      ...new Set(
        String(c.req.query("ids") ?? "")
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isInteger(n) && n > 0),
      ),
    ].slice(0, 200);
    if (!ids.length) return c.json({ error: "Aucune commande choisie." }, 400);
    const langue = langueLue(c.req.query("langue"));

    // Toute la sélection d'une lecture, pour trier AVANT de numéroter quoi
    // que ce soit.
    const commandes = await db
      .select({
        id: schema.orders.id,
        number: schema.orders.number,
        channel: schema.orders.channel,
        status: schema.orders.status,
        tags: schema.orders.tags,
        legacyId: schema.orders.legacyId,
        legacyName: schema.orders.legacyName,
        invoiceNumber: schema.orders.invoiceNumber,
      })
      .from(schema.orders)
      .where(inArray(schema.orders.id, ids));
    const parId = new Map(commandes.map((o) => [o.id, o]));

    const fichiers: FichierArchive[] = [];
    const nonFaites: FactureNonFaite[] = [];
    let introuvables = 0;
    // Dans l'ordre de la sélection, celui de la liste.
    for (const id of ids) {
      const commande = parId.get(id);
      if (!commande) {
        introuvables++;
        continue;
      }
      const raison = raisonSansFactureDansLeZip(commande);
      if (raison) {
        nonFaites.push({ numero: commande.number, raison });
        continue;
      }
      // composerLaFacture relit la commande et, sur la ligne verrouillée au
      // moment de numéroter, rejoue la même règle : une vente rouverte sur la
      // tablette, annulée ou mise en test depuis la lecture ci-dessus (le ZIP
      // prend quelques secondes) est écartée ici, sans numéro.
      const facture = await composerLaFacture(id, langue, { seulementLesVentes: true });
      if ("erreur" in facture) nonFaites.push({ numero: commande.number, raison: facture.erreur });
      else fichiers.push({ nom: facture.nomFichier, contenu: new Uint8Array(facture.pdf) });
    }
    if (!fichiers.length)
      return c.json({ error: messageAucuneFacture(nonFaites, introuvables) }, 400);
    const ecartees = nonFaites.length + introuvables;
    if (ecartees)
      fichiers.push({
        nom: "factures-non-faites.txt",
        contenu: new TextEncoder().encode(texteFacturesNonFaites(nonFaites, introuvables)),
      });
    const morceaux = archiveZip(fichiers);
    const taille = morceaux.reduce((n, m) => n + m.length, 0);
    const flux = new ReadableStream<Uint8Array>({
      pull(controleur) {
        const morceau = morceaux.shift();
        if (morceau) controleur.enqueue(morceau);
        else controleur.close();
      },
    });
    return c.body(flux, 200, {
      "Content-Type": "application/zip",
      "Content-Disposition": dispositionDuFichier("attachment", "factures.zip"),
      "Content-Length": String(taille),
      "Cache-Control": "no-store",
      "X-Factures-Non-Faites": String(ecartees),
    });
  });

  /**
   * La facture d'une commande, en PDF.
   *
   * Le numéro se pose à la PREMIÈRE édition et ne bouge plus : rouvrir cette
   * adresse rend la même facture, portant le même numéro. C'est une obligation
   * légale autant qu'une commodité — la cliente qui réclame « sa » facture
   * doit recevoir celle qu'elle a déjà, pas une nouvelle.
   */
  app.get("/admin/orders/:id/facture.pdf", async (c) => {
    // Réservée à la propriétaire, et vérifiée ICI. Le garde-fou général du
    // serveur laisse passer les LECTURES d'un vendeur sous « /admin/orders »,
    // pour qu'il retrouve ses ventes de stand et leurs fichiers d'impression.
    // Or cette adresse-ci n'est pas une lecture ordinaire : elle rend
    // l'adresse postale d'une cliente du site, et surtout elle CONSOMME un
    // numéro de facture, ce qui n'est pas le geste de quelqu'un qui tient une
    // table un samedi après-midi.
    const user = c.get("utilisateur");
    if (user && user.role !== "owner")
      return c.json(
        { error: "Les factures sont réservées à la propriétaire." },
        403,
      );
    const id = Number(c.req.param("id"));
    // Un lien venu d'ailleurs ne fait pas NUMÉROTER une facture (relecture du
    // 20/11, même garde que le ZIP) : la première édition consomme un numéro,
    // définitif. Le bouton de la fiche, lui, part du back-office
    // (« same-origin »). Rouvrir une facture qui a DÉJÀ son numéro reste
    // possible d'où que ce soit (favori, lien gardé) : ce n'est qu'une lecture.
    if (!requeteDuBackOffice(c.req.header("Sec-Fetch-Site"))) {
      const [deja] =
        Number.isInteger(id) && id > 0
          ? await db
              .select({ numero: schema.orders.invoiceNumber })
              .from(schema.orders)
              .where(eq(schema.orders.id, id))
          : [];
      if (!deja?.numero)
        return c.json(
          {
            error:
              "Cette commande n'a pas encore de facture : éditez-la depuis sa fiche, au back-office (bouton « Éditer la facture »). Aucun numéro n'a été donné.",
          },
          403,
        );
    }
    // La facture sort dans la langue de la cliente, comme celle qui lui est
    // envoyée : la boutique télécharge le document que la cliente a, ou aura.
    // `?langue=fr` en demande une autre, pour la comptabilité par exemple.
    const facture = await composerLaFacture(id, langueLue(c.req.query("langue")));
    if ("erreur" in facture) return c.json({ error: facture.erreur }, facture.code);
    // « inline » : le PDF s'ouvre dans l'onglet, d'où il s'imprime et se
    // télécharge. Forcer le téléchargement obligerait à ouvrir le fichier pour
    // le relire, alors qu'on veut le plus souvent juste y jeter un œil.
    return new Response(new Uint8Array(facture.pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": dispositionDuFichier("inline", facture.nomFichier),
      },
    });
  });

  /** Envoie la facture à la cliente, en pièce jointe. */
  app.post("/admin/orders/:id/facture/envoyer", async (c) => {
    const id = Number(c.req.param("id"));
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!mailConfigure())
      return c.json(
        {
          error:
            "L'envoi d'e-mails n'est pas configuré : la facture ne partirait nulle part. Elle reste téléchargeable depuis la fiche.",
        },
        503,
      );

    const facture = await composerLaFacture(id);
    if ("erreur" in facture) return c.json({ error: facture.erreur }, facture.code);
    if (!facture.clientEmail)
      return c.json(
        {
          error:
            "Cette commande n'a pas d'adresse e-mail : la facture ne peut pas partir. Elle reste téléchargeable depuis la fiche.",
        },
        400,
      );

    // Le courrier et le PDF joint, dans la même langue : celle de la cliente.
    const courrier = courrierFacture({
      langue: facture.langue,
      prenomClient: facture.prenomClient,
      numero: facture.numeroCommande,
      numeroFacture: facture.numeroFacture,
      totalCents: facture.totalCents,
      dejaPayee: facture.dejaPayee,
    });
    const parti = await envoyerCourrier({
      ...courrier,
      to: facture.clientEmail,
      pieces: [
        {
          nomFichier: facture.nomFichier,
          contenu: facture.pdf.toString("base64"),
          type: "application/pdf",
        },
      ],
    });

    await db.insert(schema.orderEvents).values({
      orderId: id,
      kind: "event",
      author: String(b.author ?? "").trim() || null,
      message: parti
        ? `Facture ${facture.numeroFacture} envoyée à ${facture.clientEmail}.`
        : `La facture ${facture.numeroFacture} n'a pas pu partir vers ${facture.clientEmail}.`,
    });

    if (!parti)
      return c.json(
        {
          error: `La facture ${facture.numeroFacture} n'a pas pu partir vers ${facture.clientEmail}. Le numéro reste attribué : réessayez, la même facture repartira.`,
        },
        502,
      );
    return c.json({
      ok: true,
      numeroFacture: facture.numeroFacture,
      destinataire: facture.clientEmail,
    });
  });

  /**
   * Attribue le numéro de facture d'une commande, ou rend celui qu'elle a.
   *
   * Le compteur et le numéro s'écrivent DANS LA MÊME TRANSACTION, et la ligne
   * du compteur est verrouillée le temps de l'opération (`for update`) : deux
   * factures demandées au même instant se rangent alors l'une derrière
   * l'autre au lieu de tirer le même numéro. Si quoi que ce soit échoue, les
   * deux écritures reviennent en arrière ensemble et le numéro reste libre —
   * c'est ainsi, et pas autrement, qu'une suite reste sans trou.
   *
   * L'émetteur (adresse de la boutique, SIRET, mention) est figé dans la
   * même transaction : la facture se refabrique à chaque téléchargement, et
   * un déménagement de la boutique ne doit pas réécrire celles déjà émises.
   * Une facture numérotée avant ce figeage n'en a pas (`emetteur: null`) :
   * elle prend les réglages du moment, comme elle l'a toujours fait.
   * Un émetteur INCOMPLET (adresse ou SIRET pas encore saisis dans BO ›
   * Factures) ne se fige pas non plus : figé vide, il aurait privé cette
   * facture de ses mentions obligatoires pour toujours. Elle les prendra
   * dès qu'elles seront saisies (emetteurComplet, facturation.ts).
   *
   * La COMMANDE aussi est verrouillée (relecture du 20/11) : deux éditions
   * simultanées de la même commande (le ZIP et la fiche) se rangent l'une
   * derrière l'autre, et la seconde rend le numéro de la première au lieu
   * d'en tirer un autre — qui aurait écrasé le premier et laissé un trou.
   * `refus`, quand il est donné (le ZIP : raisonSansFactureDansLeZip), se
   * relit sur cette ligne verrouillée : une vente annulée ou mise en test
   * pendant la préparation du ZIP n'a pas de numéro.
   */
  async function numeroterLaFacture(
    orderId: number,
    refus?: (commande: CommandeAFacturer) => string | null,
  ): Promise<{ numero: string; emiseLe: Date; emetteur: Emetteur | null } | { refus: string }> {
    return db.transaction(async (tx) => {
      const [commande] = await tx
        .select({
          numero: schema.orders.invoiceNumber,
          emiseLe: schema.orders.invoicedAt,
          emetteur: schema.orders.invoiceIssuer,
          number: schema.orders.number,
          channel: schema.orders.channel,
          status: schema.orders.status,
          tags: schema.orders.tags,
          legacyId: schema.orders.legacyId,
          legacyName: schema.orders.legacyName,
        })
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId))
        .for("update");
      if (commande && refus) {
        const raison = refus({ ...commande, invoiceNumber: commande.numero });
        if (raison) return { refus: raison };
      }
      if (commande?.numero)
        return {
          numero: commande.numero,
          emiseLe: commande.emiseLe ?? new Date(),
          emetteur: commande.emetteur ?? null,
        };

      const maintenant = new Date();
      // L'année de PARIS : une facture éditée le 1er janvier à 0 h 30 ouvre
      // F2027, même s'il n'est encore que 23 h 30 le 31 en temps universel.
      const annee = anneeAParis(maintenant);
      // « on conflict do update » plutôt que « do nothing » : c'est ce qui
      // rend la ligne verrouillée même quand elle existait déjà, et donc ce
      // qui sérialise deux demandes simultanées.
      const [compteur] = await tx
        .insert(schema.factureCompteur)
        .values({ annee, dernierNumero: 1 })
        .onConflictDoUpdate({
          target: schema.factureCompteur.annee,
          set: {
            dernierNumero: raw`${schema.factureCompteur.dernierNumero} + 1`,
            majLe: maintenant,
          },
        })
        .returning({ n: schema.factureCompteur.dernierNumero });

      const numero = `F${annee}-${String(compteur!.n).padStart(4, "0")}`;
      const duMoment = await emetteurDuMoment(tx);
      const emetteur = emetteurComplet(duMoment) ? duMoment : null;
      await tx
        .update(schema.orders)
        .set({ invoiceNumber: numero, invoicedAt: maintenant, invoiceIssuer: emetteur })
        .where(and(eq(schema.orders.id, orderId), isNull(schema.orders.invoiceNumber)));
      return { numero, emiseLe: maintenant, emetteur };
    });
  }

  /**
   * Tout ce qu'il faut pour éditer OU envoyer la facture, composé une fois.
   *
   * Les deux routes en ont besoin des mêmes données, et surtout du même PDF :
   * en fabriquer deux, l'un pour l'écran et l'autre pour la pièce jointe,
   * aurait fini par en donner deux qui ne disent pas la même chose.
   *
   * Dans la langue de la cliente (`langueDuDestinataire`), sauf `langueVoulue`
   * explicite. Les montants et les dates suivent ; la mention de TVA reste en
   * français, sa traduction dessous (voir renderInvoicePdf).
   *
   * `seulementLesVentes` (le ZIP des factures) : la règle du ZIP se relit au
   * moment de numéroter, sur la commande verrouillée (numeroterLaFacture).
   */
  async function composerLaFacture(
    orderId: number,
    langueVoulue: Langue | null = null,
    options: { seulementLesVentes?: boolean } = {},
  ): Promise<
    | { erreur: string; code: 400 | 404 | 409 }
    | {
        pdf: Buffer;
        nomFichier: string;
        numeroFacture: string;
        numeroCommande: string;
        totalCents: number;
        dejaPayee: boolean;
        clientEmail: string | null;
        prenomClient: string;
        langue: Langue;
      }
  > {
    if (!Number.isInteger(orderId) || orderId <= 0)
      return { erreur: "commande inconnue", code: 400 };
    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId));
    if (!order) return { erreur: "Cette commande n'existe pas.", code: 404 };
    // Une reprise de Shopify (17/11) a été réglée et facturée là-bas : un
    // numéro d'ici la ferait entrer dans la suite légale pour une facture qui
    // existe déjà ailleurs, et il ne se reprendrait plus. index.ts le refuse
    // sous « /admin/orders/:id/facture… » (GESTES_REFUSES_AUX_REPRISES), mais
    // le ZIP des factures ne passe pas par là : la garde est donc ICI aussi,
    // avant toute numérotation, pour tous les chemins.
    if (order.legacyId != null)
      return {
        erreur: `Commande reprise de Shopify (${order.legacyName ?? "ancienne boutique"}) : elle a été réglée et facturée là-bas. Aucune facture ne se fait ici, et aucun numéro ne lui a été donné.`,
        code: 409,
      };
    // Un panier n'a rien à facturer : personne n'a commandé, personne ne doit
    // rien. Lui donner un numéro le prendrait dans la suite des factures, et
    // ce numéro serait perdu pour de bon.
    if (order.status === "draft")
      return {
        erreur:
          "Ceci est un panier abandonné, pas une commande : il n'y a rien à facturer.",
        code: 400,
      };

    const numerotee = await numeroterLaFacture(
      orderId,
      options.seulementLesVentes ? raisonSansFactureDansLeZip : undefined,
    );
    if ("refus" in numerotee) return { erreur: numerotee.refus, code: 409 };
    const { numero: numeroFacture, emiseLe, emetteur: emetteurFige } = numerotee;

    const [client] = order.customerId
      ? await db
          .select()
          .from(schema.customers)
          .where(eq(schema.customers.id, order.customerId))
      : [];
    const articles = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId));
    const cadres = await db.select().from(schema.frames);
    const langue =
      langueVoulue ??
      langueDuDestinataire({ compte: client?.langue, commande: order.langue });
    // Le PDF d'une cliente japonaise ou chinoise sort en anglais
    // (renderInvoicePdf : Helvetica n'a pas leurs caractères, et tout ce qui
    // n'est pas latin s'efface). Ce qui s'écrit DANS le PDF se compose donc
    // dans sa langue à lui : en japonais, la mention de règlement et le mode
    // de livraison sortaient vides (relecture du 20/11). Le courriel, lui,
    // garde la langue de la cliente (`langue`, rendue plus bas).
    const langueDuPdf: Langue = langue === "ja" || langue === "zh" ? "en" : langue;
    const t = tc(langueDuPdf);

    const lignes: LigneFacture[] = articles.map((it) => {
      const cfg = (it.config ?? {}) as Record<string, unknown>;
      const cadre = cadres.find((f) => String(f.id) === String(cfg.frameId ?? ""));
      // Une carte cadeau achetée : son nom dans la langue de la facture, et
      // son destinataire.
      if (it.giftCard)
        return {
          designation: t("lignes.carteCadeau"),
          precision: it.giftCard.destinataireEmail ?? null,
          lignesAffiche: [],
          quantite: it.quantity,
          unitPriceCents: it.unitPriceCents,
        };
      return {
        designation: it.title ?? t("lignes.titreParDefaut"),
        precision:
          [
            typeof cfg.format === "string" ? t("lignes.format", { format: cfg.format }) : null,
            cadre ? (nomTraduit(cadre.translations, langueDuPdf) ?? cadre.name) : null,
          ]
            .filter(Boolean)
            .join(" · ") || null,
        // Le texte imprimé sur l'affiche, comme sur le bon de préparation :
        // c'est lui qui distingue deux lignes de même titre et de même prix.
        lignesAffiche: lignesRemplies(cfg.texts as TextesAffiche | undefined)
          .map((l) => l.value.trim())
          .filter(Boolean),
        quantite: it.quantity,
        unitPriceCents: it.unitPriceCents,
      };
    });

    // Une vente du stand dont le montant a été corrigé À LA HAUSSE au BO
    // (26/11, montant-vente-stand.ts : « ils changent d'avis ils veulent un
    // cadre par exemple ») : ses lignes ne disent plus son total. L'écart
    // s'imprime sur sa propre ligne, « Ajustement du prix », avec le motif
    // saisi — sans elle, la facture alignait des articles à 29 € sous un
    // total de 39 €. Une baisse se lit déjà comme une réduction
    // (`remiseCents`, plus bas). Seules les ventes du stand ont des
    // corrections : une commande du site ne fait pas la lecture.
    if (order.channel === "salon") {
      // Réussies OU annulées avec la vente : une vente annulée garde son
      // total, et sa facture doit encore y retomber (ligneDAjustement).
      const corrections = await db
        .select()
        .from(schema.orderTransactions)
        .where(
          and(
            eq(schema.orderTransactions.orderId, orderId),
            eq(schema.orderTransactions.gateway, PASSERELLE_DU_STAND),
            isNotNull(schema.orderTransactions.parentId),
          ),
        );
      const ajustement = ligneDAjustement(corrections, t("lignes.ajustement"));
      if (ajustement) lignes.push(ajustement);
    }

    const sousTotal = lignes.reduce(
      (s, l) => s + l.unitPriceCents * l.quantite,
      0,
    );
    const port = order.shippingCents ?? 0;
    const resume = (await resumeCommandes([orderId])).get(orderId)!;

    // L'identité légale de la boutique : adresse postale et SIRET sont
    // OBLIGATOIRES sur une facture. Elles se règlent dans BO › Factures
    // (facturation.ts) et sont figées sur la commande avec le numéro ; on ne
    // les invente pas quand elles manquent — une facture incomplète se
    // corrige, une facture qui ment se paie.
    // Un émetteur figé incomplet — une facture émise en prod entre le 19/10
    // et la saisie de l'adresse et du SIRET, avant que l'on cesse de figer
    // le vide — se lit comme absent : il reprend les réglages du moment.
    const emetteur = emetteurComplet(emetteurFige)
      ? emetteurFige
      : await emetteurDuMoment();
    // Le lieu de retrait, quand la cliente vient chercher sa commande : il
    // se dit sous la commande, pas dans « Facturé à » — un chalet n'est pas
    // son adresse.
    const lieu = lieuDeRetrait(order, langueDuPdf);

    const pdf = await renderInvoicePdf({
      langue,
      numeroFacture,
      dateFacture: emiseLe,
      numeroCommande: order.number,
      dateCommande: order.createdAt,
      // « Facturé à » : l'adresse de FACTURATION de la commande (18/11,
      // l'adresse par défaut du carnet de la cliente) ; à défaut (commandes
      // d'avant, retrait sans carnet), celle de livraison, comme avant.
      clientNom:
        (order.billingLine1 ? order.billingName : null) ??
        order.shippingName ??
        client?.name ??
        t("facturePdf.clientParDefaut"),
      clientEmail: client?.email ?? null,
      clientAdresse: (order.billingLine1
        ? [
            order.billingLine1,
            order.billingLine2,
            [order.billingPostalCode, order.billingCity].filter(Boolean).join(" "),
            order.billingCountry,
          ]
        : [
            // Un point relais reste ici, comme avant ; un lieu de retrait (ou un
            // ancien retrait au stand, « stand:… ») part sous la commande.
            lieu ? null : order.relayPointLabel,
            order.shippingLine1,
            order.shippingLine2,
            [order.shippingPostalCode, order.shippingCity].filter(Boolean).join(" "),
            order.shippingCountry,
          ]
      ).filter((v): v is string => Boolean(v)),
      lignes,
      // La remise se DÉDUIT de ce qui a été facturé, comme partout ailleurs :
      // c'est le montant encaissé qui fait foi, pas un recalcul.
      remiseCents: Math.max(0, sousTotal + port - order.totalCents),
      codePromo: order.promoCode,
      portCents: port,
      // Le nom français reste sur la commande ; la facture d'une cliente
      // étrangère porte celui de sa langue, quand la boutique l'a traduit.
      modeLivraison: (await livraisonDansLaLangue(order, langueDuPdf)).nom,
      totalCents: order.totalCents,
      rembourseCents: resume.rembourseCents,
      mentionReglement: mentionDeReglement(order, langueDuPdf),
      adresseBoutique: emetteur.adresse.length ? emetteur.adresse : null,
      siret: siretGroupe(emetteur.siret),
      mention: emetteur.mention,
      retrait: lieu
        ? t("facturePdf.retrait", { lieu: libelleDuLieu(lieu) })
        : null,
      // Une commande annulée après avoir été facturée garde sa facture et son
      // numéro — le trou serait pire —, mais le papier doit dire lui-même
      // qu'elle ne vaut plus.
      filigrane:
        order.status === "cancelled" || order.status === "voided"
          ? t("facturePdf.filigrane")
          : null,
    });

    return {
      pdf,
      // Dans la langue du PDF, en ASCII : « Invoice_… » pour une cliente
      // japonaise ou chinoise, dont le nom en kanji faisait répondre 500.
      nomFichier: nomDuFichierDeFacture(langue, numeroFacture, order.number),
      numeroFacture,
      numeroCommande: order.number,
      totalCents: order.totalCents,
      dejaPayee: order.status === "paid",
      clientEmail: client?.email ?? null,
      prenomClient: prenomPourCourrier(client) || tc(langue)("commun.prenomParDefaut"),
      langue,
    };
  }

  /**
   * « Commande réglée. Facture acquittée. », ou ce qui en tient lieu, dans la
   * langue de la facture.
   */
  function mentionDeReglement(
    order: typeof schema.orders.$inferSelect,
    langue: Langue = "fr",
  ): string {
    const t = tc(langue);
    if (order.status === "cancelled" || order.status === "voided")
      return `${
        order.cancelledAt
          ? t("facturePdf.annuleeLe", { date: dateCourte(langue, order.cancelledAt) })
          : t("facturePdf.annulee")
      }${order.cancelReason ? ` — ${motifDansLaLangue(order.cancelReason, langue)}` : ""}.`;
    // Payée en partie (ou en entier) par une carte cadeau : la facture le dit
    // (17/11), sous la mention de règlement.
    if (order.status === "paid")
      return order.giftCardCents > 0
        ? `${t("facturePdf.reglee")} ${t("facturePdf.dontCarte", {
            montant: prix(Math.min(order.giftCardCents, order.totalCents), langue),
          })}`
        : t("facturePdf.reglee");
    return t("facturePdf.nonReglee");
  }

  /**
   * Le motif d'annulation gardé sur la commande, dans la langue de la facture.
   *
   * La commande ne garde que la phrase du journal, en français : « Demande de
   * la cliente », suivie le cas échéant de « — » et de la précision saisie.
   * Le libellé de la liste se retrouve donc au début, et se traduit comme
   * dans le courrier d'annulation ; la précision, écrite par la boutique,
   * reste telle quelle. Une facture allemande ne doit pas porter un motif en
   * français quand le courrier qui l'accompagne l'a écrit en allemand.
   */
  function motifDansLaLangue(motif: string, langue: Langue): string {
    if (langue === "fr") return motif;
    for (const cle of Object.values(MOTIFS_ANNULATION)) {
      if (!cle) continue;
      const francais = tc("fr")(cle);
      if (motif === francais) return tc(langue)(cle);
      if (motif.startsWith(`${francais} — `))
        return `${tc(langue)(cle)}${motif.slice(francais.length)}`;
    }
    return motif;
  }
}
