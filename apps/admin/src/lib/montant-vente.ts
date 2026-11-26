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
