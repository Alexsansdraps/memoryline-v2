/**
 * Ventes stand (26/11) : deux demandes de Margaux, relayées par Alexandra.
 *
 * 1. Le CHOIX DU CLIENT à la place de « Remise sur le stand » : « pouvoir
 *    voir le choix du client (format/cadre) au lieu de "Remise sur le stand"
 *    par exemple qui ne sert à rien ». Une vente du stand est toujours remise
 *    sur place : la colonne « Livraison » de Ventes stand disait la même
 *    chose sur chaque ligne. Elle dit désormais, par affiche, le format et le
 *    cadre choisis (`choixDeLAffiche`), et la fiche de la vente aussi.
 *
 * 2. La CORRECTION DU MONTANT d'une vente validée : « pouvoir modifier le
 *    montant € de la commande stand une fois qu'elle est validée (car des
 *    fois ils changent d'avis ils veulent un cadre par exemple) le but est
 *    d'avoir les statistiques bon ». L'API fait tout
 *    (apps/api/src/montant-vente-stand.ts, POST /admin/orders/:id/montant) ;
 *    ici, la saisie en euros, la question de confirmation, le message
 *    d'après, et la règle qui reconnaît une correction au grand livre, pour
 *    l'afficher sur la fiche : le moyen « stand » ET un `parentId`, recopiée
 *    de l'API comme celle des ventes de test (lib/vente-de-test.ts).
 *
 * Sans dépendance ni base : essayé par tests/montant-vente.test.mjs, et
 * importé tel quel par le script du navigateur (lib/montant-vente-bo.ts).
 */

/** « 39 € », « 39,50 € » : les montants comme le reste du BO (formatPrice, lib/api.ts). */
export function euros(cents: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/** Ce que l'API dit d'une affiche dans la liste des commandes. */
export interface ChoixDuClient {
  format?: string | null;
  /** Le nom du cadre (« Cadre noir ») ; null ou absent : sans cadre. */
  cadre?: string | null;
  quantite?: number | null;
  paysage?: boolean | null;
}

/**
 * « A4 · Sans cadre », « A3 paysage · Cadre noir · × 2 » : le choix du
 * client pour une affiche. Le nom du cadre est celui du BO (BO › Cadres),
 * comme sur la fiche et le bon de livraison ; « Sans cadre » aussi. La
 * quantité ne se dit qu'au-delà d'un exemplaire.
 *
 * « Sans cadre » ne se dit que d'une affiche dont on connaît le format
 * (relecture du 26/11) : une ligne reprise de Shopify n'a ni format ni cadre
 * dans sa configuration, et elle avait peut-être un cadre. Sans rien de
 * connu : « — ».
 */
export function choixDeLAffiche(a: ChoixDuClient): string {
  const format = String(a.format ?? "").trim();
  const cadre = String(a.cadre ?? "").trim();
  const quantite = Number(a.quantite ?? 1);
  const choix = [
    format ? `${format}${a.paysage ? " paysage" : ""}` : a.paysage ? "Paysage" : null,
    cadre || (format ? "Sans cadre" : null),
  ].filter(Boolean);
  if (!choix.length) return "—";
  return [...choix, quantite > 1 ? `× ${quantite}` : null].filter(Boolean).join(" · ");
}

/**
 * Le montant saisi en euros, en centimes entiers, ou null s'il ne se lit
 * pas : « 39 », « 39,5 », « 39.50 », « 39,50 € ». Le serveur refuse ensuite
 * ce qui ne convient pas (zéro, négatif, trop grand) avec sa propre phrase.
 */
export function centimesSaisis(texte: string): number | null {
  const propre = String(texte ?? "")
    .replace(/[\s  €]/g, "")
    .replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(propre)) return null;
  return Math.round(Number(propre) * 100);
}

/**
 * La question posée avant d'enregistrer, ou null quand le montant ne change
 * pas (rien à confirmer : le serveur le dira). Elle redit le nouveau montant
 * tapé — une faute de frappe se voit ici — et ce qui va suivre.
 */
export function questionDeCorrection(
  numero: string,
  avantCents: number,
  apresCents: number | null,
  motif: string,
): string | null {
  if (apresCents === null || apresCents === avantCents) return null;
  return (
    `Passer la vente ${numero} de ${euros(avantCents)} à ${euros(apresCents)} ?` +
    (motif.trim() ? ` Motif : « ${motif.trim()} ».` : "") +
    "\n\nLes statistiques, les totaux du stand, l'export et la page Finances suivront. Le grand livre garde l'encaissement d'origine et reçoit une écriture de correction."
  );
}

/* -------------------------------------------------------------------------- */
/*  Le total corrigé DANS LA LIGNE de Ventes stand (26/11)                     */
/* -------------------------------------------------------------------------- */
/*
 * Margaux, en vidéo : « commande stand pouvoir modifier directement le total
 * dans la ligne. Car si elle applique des réductions par ex, faudrait juste
 * le total indépendamment du reste. Juste les commandes stands ! ». Dans la
 * cellule du total, un champ et un petit « OK » ; Entrée enregistre ; pas de
 * fenêtre de confirmation, elle en corrigera beaucoup ; pas de motif à
 * saisir (le journal dit qu'il n'y en a pas). Une valeur inchangée n'envoie
 * rien. Le résultat s'affiche dans la ligne : « SAL-0036 : 69,00 € → 59,00 € ».
 */

/** « 69,00 € » : au centime près, comme le journal de la vente. */
export function eurosAuCentime(cents: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

/** La valeur du champ, sans le symbole : « 69,00 ». */
export function saisieDuTotal(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

/**
 * Ce que fait le champ à l'envoi (Entrée ou « OK ») : rien quand la valeur
 * n'a pas changé (« 69 » pour 69,00 € compris), rien non plus quand elle ne
 * se lit pas — la ligne le dit —, sinon le nouveau total en centimes. Zéro
 * ou un montant négatif partent : le serveur les refuse avec sa phrase.
 */
export function envoiDuTotal(
  saisie: string,
  avantCents: number,
): { envoyer: false; raison: "inchange" | "illisible" } | { envoyer: true; cents: number } {
  const cents = centimesSaisis(saisie);
  if (cents === null) return { envoyer: false, raison: "illisible" };
  if (cents === avantCents) return { envoyer: false, raison: "inchange" };
  return { envoyer: true, cents };
}

/** Ce que dit la ligne quand la saisie ne se lit pas. */
export const SAISIE_ILLISIBLE = "Montant illisible : tapez par exemple 59, 59,50 ou 59 €.";

/** Le résultat, dans la ligne et en tête de la liste : « SAL-0036 : 69,00 € → 59,00 € ». */
export function resultatDuTotal(r: {
  numero: string;
  avantCents: number;
  apresCents: number;
  inchange?: boolean;
}): string {
  return r.inchange
    ? `${r.numero} : ${eurosAuCentime(r.apresCents)}, inchangé`
    : `${r.numero} : ${eurosAuCentime(r.avantCents)} → ${eurosAuCentime(r.apresCents)}`;
}

/* -------------------------------------------------------------------------- */
/*  Plusieurs totaux d'un coup (relecture du 26/11)                            */
/* -------------------------------------------------------------------------- */
/*
 * Chaque ligne est son formulaire : un total tapé sur une ligne, sans
 * Entrée, puis Entrée sur une autre, était PERDU sans rien dire — le champ
 * gardait la valeur tapée jusqu'au rechargement, comme enregistrée, et la
 * base l'ancienne. Margaux « en corrigera beaucoup ». Désormais, un total
 * tapé et pas encore envoyé se voit (cadre ambre, « Pas encore
 * enregistré »), part avec le prochain Entrée de N'IMPORTE QUELLE ligne
 * (champ caché « autres »), et la page retient avant qu'on la quitte.
 */

/** Où en est un champ de total : rien tapé, tapé (à envoyer), ou illisible. */
export function etatDuTotal(saisie: string, avantCents: number): "inchange" | "modifie" | "illisible" {
  const envoi = envoiDuTotal(saisie, avantCents);
  return envoi.envoyer ? "modifie" : envoi.raison;
}

/** Ce que dit, sous son champ, un total tapé et pas encore envoyé. */
export const TOTAL_EN_ATTENTE = "Pas encore enregistré : Entrée ou OK.";

/** Un total tapé dans une ligne de Ventes stand, tel que le formulaire le porte. */
export interface TotalTape {
  id: number;
  numero: string;
  avantCents: number;
  saisie: string;
}

/** Au plus tant de lignes par envoi : une page de Ventes stand en montre 100. */
const TOTAUX_PAR_ENVOI = 200;

/**
 * Les totaux d'un envoi « montant-ligne » : celui de la ligne où l'on a fait
 * Entrée, puis ceux tapés sur les autres lignes (champ « autres », en JSON,
 * posé par lib/montant-vente-bo.ts) — chacun une fois, la ligne d'Entrée
 * d'abord. Ce qui ne se lit pas (identifiant, JSON abîmé) est écarté sans
 * bruit : le serveur ne corrige que ce qu'on lui désigne clairement.
 */
export function totauxDeLEnvoi(champs: {
  id: unknown;
  numero: unknown;
  avant: unknown;
  montant: unknown;
  autres?: unknown;
}): TotalTape[] {
  const totaux: TotalTape[] = [];
  const vus = new Set<number>();
  const ajouter = (t: { id: unknown; numero: unknown; avant: unknown; montant: unknown }) => {
    const id = Number(t.id);
    const avantCents = Number(t.avant);
    if (!Number.isInteger(id) || id <= 0 || vus.has(id) || !Number.isInteger(avantCents)) return;
    if (totaux.length >= TOTAUX_PAR_ENVOI) return;
    vus.add(id);
    totaux.push({
      id,
      numero: String(t.numero ?? "").slice(0, 40),
      avantCents,
      saisie: String(t.montant ?? "").slice(0, 40),
    });
  };
  ajouter(champs);
  let autres: unknown = [];
  try {
    autres = JSON.parse(String(champs.autres ?? "[]"));
  } catch {
    autres = [];
  }
  if (Array.isArray(autres))
    for (const a of autres)
      if (a && typeof a === "object") {
        const { id, numero, avant, montant } = a as Record<string, unknown>;
        ajouter({ id, numero, avant, montant });
      }
  return totaux;
}

/**
 * Les messages de la liste après un envoi de totaux : le vert dit ce qui a
 * changé (« SAL-0036 : 69,00 € → 59,00 € », ou « 2 totaux corrigés : … »),
 * le rouge ce qui a été refusé, vente par vente. Chaque résultat se lit en
 * outre sous son champ.
 */
export function messagesDesTotaux(resultats: readonly { numero: string; texte: string; erreur: boolean }[]): {
  flash: string | null;
  erreur: string | null;
} {
  const bons = resultats.filter((r) => !r.erreur);
  const refus = resultats.filter((r) => r.erreur);
  return {
    flash: !bons.length
      ? null
      : bons.length === 1
        ? bons[0]!.texte
        : `${bons.length} totaux corrigés : ${bons.map((r) => r.texte).join(" ; ")}`,
    erreur: refus.length ? refus.map((r) => `${r.numero} : ${r.texte}`).join(" ; ") : null,
  };
}

/* -------------------------------------------------------------------------- */
/*  Les totaux tapés, vus du reste de la liste (relecture finale du 26/11)     */
/* -------------------------------------------------------------------------- */

/** « SAL-0023 », « SAL-0023 et SAL-0025 », « SAL-0023, SAL-0025 et 3 autres ». */
export function listeDesVentes(numeros: readonly string[]): string {
  const tous = numeros.filter(Boolean);
  if (tous.length <= 1) return tous[0] ?? "";
  if (tous.length > 5) return `${tous.slice(0, 4).join(", ")} et ${tous.length - 4} autres`;
  return `${tous.slice(0, -1).join(", ")} et ${tous[tous.length - 1]}`;
}

/**
 * Le refus de « Factures » quand une vente cochée a un total tapé et pas
 * encore enregistré. « Factures » télécharge sans quitter la page : le
 * navigateur ne retenait rien, et la facture prenait son numéro définitif
 * avec l'ANCIEN total — après quoi le nouveau était refusé (« déjà
 * facturée… son montant ne peut donc plus changer »).
 */
export function refusDesFacturesEnAttente(numeros: readonly string[]): string {
  const plusieurs = numeros.length > 1;
  return (
    `${plusieurs ? "Les totaux tapés pour" : "Le total tapé pour"} ${listeDesVentes(numeros)} ` +
    `${plusieurs ? "ne sont" : "n'est"} pas encore enregistré${plusieurs ? "s" : ""} : faites Entrée (ou OK) ` +
    `dans ${plusieurs ? "l'une des lignes" : "sa ligne"}, puis « Factures ». Une facture garde pour toujours ` +
    "le montant qu'elle a le jour où elle est faite. Aucune facture n'a été faite."
  );
}

/**
 * La question posée avant un geste de la barre de la sélection (« Marquer
 * terminées », « Ces commandes sont des tests »…) qui recharge la page alors
 * qu'un total tapé n'est pas enregistré. Sans elle, le navigateur demandait
 * à sa façon s'il fallait quitter la page ; « Rester » laissait la barre
 * bloquée sans rien dire, jusqu'au rechargement.
 */
export function questionTotauxEnAttente(numeros: readonly string[]): string {
  const plusieurs = numeros.length > 1;
  return (
    `${plusieurs ? "Les totaux tapés pour" : "Le total tapé pour"} ${listeDesVentes(numeros)} ` +
    `${plusieurs ? "ne sont" : "n'est"} pas enregistré${plusieurs ? "s" : ""} : ` +
    `${plusieurs ? "ils seront perdus" : "il sera perdu"}. Continuer quand même ?\n\n` +
    `Pour ${plusieurs ? "les" : "le"} garder : Annuler, puis Entrée dans ${plusieurs ? "l'une des lignes (ils partent ensemble)" : "sa ligne"}.`
  );
}

/** Le résultat d'un total envoyé, tel que la liste le reçoit (actions-liste-commandes.ts). */
export interface ResultatDUnTotal {
  id: number;
  numero: string;
  texte: string;
  erreur: boolean;
  /** Ce qui avait été tapé, pour un total refusé : le champ, lui, revient au total enregistré. */
  saisie?: string;
}

/**
 * Ce que dit la ligne de l'Entrée des totaux partis avec elle depuis
 * d'AUTRES lignes, enregistrés comme refusés. La page revient sur la ligne
 * de l'Entrée (#vente-…) : le résultat de chacun des autres restait sous son
 * propre champ, hors de l'écran, et le bandeau en tête de la liste aussi —
 * un total refusé (0 €) ou une faute de frappe enregistrée (370 € pour 37)
 * passaient inaperçus. null quand aucun autre total n'est parti.
 *
 * Les refus d'abord ; le texte de chacun sans son numéro, que la page met
 * en lien vers sa ligne.
 */
export function autresTotauxDeLEnvoi(
  resultats: readonly ResultatDUnTotal[],
  idEntree: number | null | undefined,
): { titre: string; refus: number; lignes: { id: number; numero: string; texte: string; erreur: boolean }[] } | null {
  const autres = resultats.filter((r) => r.id !== idEntree);
  if (!autres.length) return null;
  const n = autres.length;
  const refus = autres.filter((r) => r.erreur).length;
  const titre =
    `En même temps, ${n > 1 ? `${n} autres totaux` : "un autre total"} ${n > 1 ? "sont partis" : "est parti"}` +
    (refus === 0
      ? ""
      : refus === n
        ? `, ${n > 1 ? "tous refusés" : "refusé"}`
        : `, dont ${refus} refusé${refus > 1 ? "s" : ""}`) +
    " :";
  const sansNumero = (r: ResultatDUnTotal) =>
    r.texte.startsWith(`${r.numero} : `) ? r.texte.slice(r.numero.length + 3) : r.texte;
  return {
    titre,
    refus,
    lignes: [...autres]
      .sort((a, b) => Number(b.erreur) - Number(a.erreur))
      .map((r) => ({
        id: r.id,
        numero: r.numero,
        erreur: r.erreur,
        texte: r.erreur
          ? `refusé${r.saisie?.trim() ? ` (« ${r.saisie.trim()} » tapé, le total n'a pas changé)` : ""} : ${sansNumero(r)}`
          : `enregistré, ${sansNumero(r)}`,
      })),
  };
}

/** Le message vert, après la correction. */
export function messageDeCorrection(r: {
  numero: string;
  avantCents: number;
  apresCents: number;
  inchange?: boolean;
}): string {
  return r.inchange
    ? `La vente ${r.numero} vaut déjà ${euros(r.apresCents)} : rien n'a changé.`
    : `Vente ${r.numero} : ${euros(r.avantCents)} → ${euros(r.apresCents)}. Les statistiques, les totaux du stand, l'export et la page Finances en tiennent compte ; la correction est au journal de la vente.`;
}

/** Une écriture du grand livre, telle que la fiche la reçoit. */
export interface MouvementLu {
  kind: string;
  status: string;
  amountCents: number;
  gateway: string | null;
  parentId?: number | null;
  message?: string | null;
}

/** Vrai pour une correction du montant : le moyen « stand » ET un parent (voir l'API). */
export function estCorrectionDuMontant(m: Pick<MouvementLu, "kind" | "gateway" | "parentId">): boolean {
  return (
    m.gateway === "stand" &&
    m.parentId != null &&
    (m.kind === "sale" || m.kind === "refund")
  );
}

/**
 * Ce que les corrections ont changé au montant de la vente (signé) et leurs
 * motifs, sans doublon : la fiche les montre entre le sous-total et le
 * total, pour que les deux se recoupent. Une correction annulée avec la
 * vente (« annule ») compte encore : l'annulation laisse le total tel quel
 * (même règle que l'API, `correctionNette`).
 */
export function correctionsDuMontant(mouvements: readonly MouvementLu[]): {
  netteCents: number;
  motifs: string[];
} {
  const corrections = mouvements.filter(
    (m) => (m.status === "success" || m.status === "annule") && estCorrectionDuMontant(m),
  );
  return {
    netteCents: corrections.reduce((s, m) => s + (m.kind === "sale" ? m.amountCents : -m.amountCents), 0),
    motifs: [...new Set(corrections.map((m) => String(m.message ?? "").trim()).filter(Boolean))],
  };
}
