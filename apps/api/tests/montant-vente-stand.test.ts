/**
 * Corriger le montant d'une vente du stand après sa validation (26/11,
 * Margaux : « pouvoir modifier le montant € de la commande stand une fois
 * qu'elle est validée (car des fois ils changent d'avis ils veulent un cadre
 * par exemple) le but est d'avoir les statistiques bon »). Les règles de
 * montant-vente-stand.ts, sans base de données.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/montant-vente-stand.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  articlesInexpliques,
  attendusDUneVente,
  correctionNette,
  correctionsParVente,
  ecritureDeCorrection,
  encaissementDOrigine,
  estCorrectionDuMontant,
  euros,
  lireMontantCents,
  lireMotif,
  ligneDAjustement,
  MONTANT_MAX_CENTS,
  MOTIF_MAX,
  motifsDesCorrections,
  phraseDuJournal,
  refusDeCorrection,
  refusDuMontant,
  refusDuMotif,
  type EcritureDuGrandLivre,
  type VenteACorriger,
} from "../src/montant-vente-stand.js";

/** Une vente du stand validée à la tablette : payée, encaissée sur place, sans facture. */
const vente: VenteACorriger = {
  number: "SAL-0021",
  channel: "salon",
  status: "paid",
  tags: ["Marché de Noël Mulhouse"],
  legacyId: null,
  invoiceNumber: null,
  giftCardCents: 0,
  remboursements: 0,
  encaissementDOrigine: true,
};

test("une vente du stand payée, sans facture, se corrige", () => {
  assert.equal(refusDeCorrection(vente), null);
});

test("refus clairs : site, reprise Shopify, annulée, test, panier, à encaisser", () => {
  assert.match(refusDeCorrection({ ...vente, channel: "web", number: "WEB-1042" })!, /Seul le montant d'une vente du stand/);
  assert.match(refusDeCorrection({ ...vente, legacyId: 5512, number: "SHOP-1042" })!, /Shopify/);
  // Une reprise rangée au stand reste une reprise.
  assert.match(refusDeCorrection({ ...vente, legacyId: 5512 })!, /Shopify/);
  assert.match(refusDeCorrection({ ...vente, status: "cancelled" })!, /annulée/);
  assert.match(refusDeCorrection({ ...vente, status: "voided" })!, /annulée/);
  // Une vente de test (annulée ET étiquetée) se dit comme telle.
  assert.match(refusDeCorrection({ ...vente, status: "cancelled", tags: ["Test"] })!, /vente de test/);
  assert.match(refusDeCorrection({ ...vente, status: "draft" })!, /rouverte sur la tablette/);
  assert.match(refusDeCorrection({ ...vente, status: "pending" })!, /pas encore réglée/);
});

test("une vente déjà facturée ne change plus : la facture émise ne se modifie pas", () => {
  const r = refusDeCorrection({ ...vente, invoiceNumber: "F2026-0012" });
  assert.match(r!, /déjà facturée \(F2026-0012\)/);
  assert.match(r!, /une facture émise ne se modifie pas/);
});

test("carte cadeau, remboursement, ou rien au grand livre : refusé, en le disant", () => {
  assert.match(refusDeCorrection({ ...vente, giftCardCents: 500 })!, /carte cadeau/);
  assert.match(refusDeCorrection({ ...vente, remboursements: 1 })!, /remboursement/);
  assert.match(refusDeCorrection({ ...vente, encaissementDOrigine: false })!, /aucun encaissement au grand livre/);
});

test("le montant : des centimes entiers, plus grands que zéro, sous le plafond", () => {
  assert.equal(lireMontantCents(3900), 3900);
  assert.equal(lireMontantCents("3950"), 3950);
  assert.equal(lireMontantCents(39.5), null);
  assert.equal(lireMontantCents(""), null);
  assert.equal(lireMontantCents(null), null);
  assert.equal(lireMontantCents("39,50"), null);
  assert.match(refusDuMontant(null)!, /Saisissez le nouveau montant/);
  assert.match(refusDuMontant(0)!, /plus grand que zéro/);
  assert.match(refusDuMontant(-500)!, /plus grand que zéro/);
  assert.match(refusDuMontant(MONTANT_MAX_CENTS + 1)!, /vérifiez la saisie/);
  assert.equal(refusDuMontant(MONTANT_MAX_CENTS), null);
  assert.equal(refusDuMontant(1), null);
});

test("le motif est demandé, sur une ligne, et borné", () => {
  assert.match(refusDuMotif("")!, /cadre ajouté/);
  assert.equal(refusDuMotif(lireMotif("  cadre\n ajouté ")), null);
  assert.equal(lireMotif("  cadre\n   ajouté "), "cadre ajouté");
  assert.equal(lireMotif("x".repeat(500)).length, MOTIF_MAX);
  assert.equal(lireMotif(undefined), "");
});

test("l'écriture de correction : un encaissement de plus pour une hausse, de l'argent rendu pour une baisse, toujours positive", () => {
  assert.deepEqual(ecritureDeCorrection(2900, 3900), { kind: "sale", amountCents: 1000 });
  assert.deepEqual(ecritureDeCorrection(3900, 2900), { kind: "refund", amountCents: 1000 });
  assert.equal(ecritureDeCorrection(2900, 2900), null);
});

/** L'encaissement d'une vente du stand, puis deux corrections et un remboursement ordinaire. */
const ecritures: EcritureDuGrandLivre[] = [
  { id: 10, kind: "sale", status: "success", amountCents: 2900, gateway: "stand", parentId: null },
  { id: 11, kind: "sale", status: "success", amountCents: 1000, gateway: "stand", parentId: 10, message: "cadre ajouté" },
  { id: 12, kind: "refund", status: "success", amountCents: 400, gateway: "stand", parentId: 10, message: "remise accordée" },
];

test("une correction se reconnaît au moyen « stand » ET à son parent", () => {
  assert.equal(estCorrectionDuMontant(ecritures[0]!), false);
  assert.equal(estCorrectionDuMontant(ecritures[1]!), true);
  assert.equal(estCorrectionDuMontant(ecritures[2]!), true);
  // Un remboursement du bloc « Rembourser » n'écrit jamais sous « stand ».
  assert.equal(estCorrectionDuMontant({ kind: "refund", gateway: "manuel", parentId: null }), false);
  assert.equal(estCorrectionDuMontant({ kind: "refund", gateway: "stripe", parentId: 10 }), false);
  // Une écriture d'annulation n'en est pas une, même rattachée.
  assert.equal(estCorrectionDuMontant({ kind: "void", gateway: "stand", parentId: 10 }), false);
});

test("l'encaissement d'origine : le premier encaissement réussi sans parent", () => {
  assert.equal(encaissementDOrigine(ecritures), 10);
  // Une vente rouverte puis revalidée : l'encaissement annulé ne compte pas.
  assert.equal(
    encaissementDOrigine([
      { id: 3, kind: "sale", status: "annule", amountCents: 2300, gateway: "stand", parentId: null },
      { id: 7, kind: "sale", status: "success", amountCents: 3500, gateway: "stand", parentId: null },
    ]),
    7,
  );
  // Une vente du 17 au 19/11, marquée payée au BO : son encaissement « manuel ».
  assert.equal(
    encaissementDOrigine([{ id: 4, kind: "sale", status: "success", amountCents: 2900, gateway: "manuel", parentId: null }]),
    4,
  );
  assert.equal(encaissementDOrigine([]), null);
});

test("la correction nette et ses motifs : ce que la fiche et la facture relisent", () => {
  assert.equal(correctionNette(ecritures), 600);
  assert.deepEqual(motifsDesCorrections(ecritures), ["cadre ajouté", "remise accordée"]);
  // Annulée avec la vente (« annule ») : elle reste dans le total, qui ne
  // bouge pas à l'annulation, et compte donc encore.
  assert.equal(correctionNette([ecritures[0]!, { ...ecritures[1]!, status: "annule" }]), 1000);
  // Une écriture en échec n'a jamais rien changé.
  assert.equal(correctionNette([ecritures[0]!, { ...ecritures[1]!, status: "failure" }]), 0);
  assert.equal(correctionNette([ecritures[0]!]), 0);
});

test("la facture : une ligne « Ajustement du prix » pour une hausse nette, rien pour une baisse", () => {
  assert.deepEqual(ligneDAjustement(ecritures, "Ajustement du prix"), {
    designation: "Ajustement du prix",
    precision: "cadre ajouté, remise accordée",
    lignesAffiche: [],
    quantite: 1,
    unitPriceCents: 600,
  });
  // Une baisse nette se lit déjà comme une réduction (sous-total − total).
  assert.equal(ligneDAjustement([ecritures[0]!, ecritures[2]!], "Ajustement du prix"), null);
  assert.equal(ligneDAjustement([ecritures[0]!], "Ajustement du prix"), null);
  // Sans motif lisible, la ligne reste, sans précision ; un motif trop long est coupé.
  const sansMotif = { ...ecritures[1]!, message: "  " };
  assert.equal(ligneDAjustement([sansMotif], "Price adjustment")?.precision, null);
  const long = ligneDAjustement(
    [1, 2].map((i) => ({ ...ecritures[1]!, id: 20 + i, message: `${"m".repeat(100)}${i}` })),
    "Ajustement du prix",
  );
  assert.equal(long?.precision?.length, 160);
  assert.equal(long?.unitPriceCents, 2000);
});

test("le journal dit avant → après, l'écart et le motif", () => {
  assert.equal(
    phraseDuJournal(2900, 3900, "cadre ajouté"),
    "Montant de la vente corrigé : 29,00 € → 39,00 € (+10,00 €). Motif : « cadre ajouté ».",
  );
  assert.equal(
    phraseDuJournal(3900, 2950, "erreur de saisie"),
    "Montant de la vente corrigé : 39,00 € → 29,50 € (−9,50 €). Motif : « erreur de saisie ».",
  );
  assert.equal(euros(5), "0,05 €");
});

/*
 * La page Finances, sans base (relecture du 26/11) : l'essai sur base ne
 * pouvait pas voir la moitié « articles » du contrôle — une promotion
 * automatique en vigueur excuse tout écart où les articles dépassent ce qui
 * est attendu. Ici, promotion en vigueur ou non.
 */
test("Finances : les corrections par vente, à partir des sommes par genre", () => {
  const parVente = correctionsParVente([
    { orderId: 7, genre: "sale", cents: 1000 },
    { orderId: 7, genre: "refund", cents: 1400 },
    { orderId: 9, genre: "sale", cents: 500 },
  ]);
  assert.deepEqual(parVente.get(7), { nette: -400, baisse: 1400 });
  assert.deepEqual(parVente.get(9), { nette: 500, baisse: 0 });
  assert.equal(parVente.get(8), undefined);
});

test("Finances : une vente du stand corrigée n'est pas une anomalie, promotion en vigueur ou non", () => {
  // Une A3 à 29 €, sans port, encaissée 29 € à la tablette.
  const sansCorrection = { nette: 0, baisse: 0 };
  const controle = (totalCents: number, encaissementsCents: number, correction: { nette: number; baisse: number }) =>
    attendusDUneVente({ totalCents, portCents: 0, encaissementsCents, correction });
  const inexpliques = (attenduCents: number, promotionEnVigueur: boolean) =>
    articlesInexpliques({ lignesCents: 2900, attenduCents, remisesFigeesCents: null, promotionEnVigueur });

  // Avant toute correction : tout retombe.
  assert.deepEqual(controle(2900, 2900, sansCorrection), { grandLivreCents: 2900, articlesCents: 2900 });

  // La hausse, 29 € → 39 € (« cadre ajouté ») : +10 € au grand livre.
  const hausse = controle(3900, 3900, { nette: 1000, baisse: 0 });
  assert.deepEqual(hausse, { grandLivreCents: 3900, articlesCents: 2900 });
  for (const promo of [true, false]) assert.equal(inexpliques(hausse.articlesCents, promo), false);
  // Sans la correction dans l'attendu, 29 € d'articles pour 39 € : anomalie,
  // qu'aucune promotion n'excuse (des articles EN DESSOUS du total).
  for (const promo of [true, false]) assert.equal(inexpliques(controle(3900, 3900, sansCorrection).articlesCents, promo), true);

  // Puis la baisse, 39 € → 25 € : 14 € rendus sur place.
  const baisse = controle(2500, 3900, { nette: -400, baisse: 1400 });
  assert.deepEqual(baisse, { grandLivreCents: 2500, articlesCents: 2900 });
  for (const promo of [true, false]) assert.equal(inexpliques(baisse.articlesCents, promo), false);
  // Sans la correction : 29 € d'articles pour 25 € attendus. Une promotion
  // en vigueur l'excuserait (c'est ce qui aveuglait l'essai sur base) ;
  // sans elle, c'est bien une anomalie.
  const ignoree = controle(2500, 3900, sansCorrection);
  assert.equal(ignoree.grandLivreCents, 3900, "sans la baisse, le grand livre ne retombe pas sur 25 €");
  assert.equal(inexpliques(ignoree.articlesCents, true), false);
  assert.equal(inexpliques(ignoree.articlesCents, false), true);
});

test("Finances : une remise figée doit expliquer l'écart au centime près", () => {
  const figee = (remisesFigeesCents: number) =>
    articlesInexpliques({ lignesCents: 8700, attenduCents: 5800, remisesFigeesCents, promotionEnVigueur: false });
  assert.equal(figee(2900), false);
  assert.equal(figee(2800), true);
  // Des articles qui retombent n'ont besoin d'aucune remise.
  assert.equal(
    articlesInexpliques({ lignesCents: 5800, attenduCents: 5800, remisesFigeesCents: null, promotionEnVigueur: false }),
    false,
  );
});
