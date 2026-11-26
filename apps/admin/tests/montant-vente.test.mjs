/**
 * Ventes stand, côté back-office (lib/montant-vente.ts, 26/11) : le choix du
 * client à la place de « Remise sur le stand », et la correction du montant
 * d'une vente validée (Margaux : « pouvoir modifier le montant € de la
 * commande stand une fois qu'elle est validée (car des fois ils changent
 * d'avis ils veulent un cadre par exemple) le but est d'avoir les
 * statistiques bon »). Sans navigateur ni base.
 *
 * Lancés par : docker exec -w /app/apps/admin memoryline-admin node --test "tests/*.test.mjs"
 * (Node retire seul les types des fichiers .ts importés.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  centimesSaisis,
  choixDeLAffiche,
  correctionsDuMontant,
  estCorrectionDuMontant,
  euros,
  messageDeCorrection,
  questionDeCorrection,
} from "../src/lib/montant-vente.ts";

/** Intl sépare l'euro par une espace insécable fine : les essais lisent des espaces simples. */
const lu = (texte) => String(texte).replace(/[  ]/g, " ");

test("le choix du client : format, cadre (ou « Sans cadre »), sens et quantité au-delà d'un", () => {
  assert.equal(choixDeLAffiche({ format: "A4", cadre: null, quantite: 1 }), "A4 · Sans cadre");
  assert.equal(choixDeLAffiche({ format: "A3", cadre: "Cadre noir", quantite: 2 }), "A3 · Cadre noir · × 2");
  assert.equal(
    choixDeLAffiche({ format: "A4", cadre: "Cadre bois façon chêne", paysage: true }),
    "A4 paysage · Cadre bois façon chêne",
  );
  // Un cadre au nom vide se lit comme pas de cadre, une ligne sans format garde son cadre.
  assert.equal(choixDeLAffiche({ format: "A4", cadre: "  " }), "A4 · Sans cadre");
  assert.equal(choixDeLAffiche({ format: null, cadre: "Cadre blanc" }), "Cadre blanc");
  assert.doesNotMatch(choixDeLAffiche({ format: "A4" }), /\(s\)/);
});

test("une ligne sans format connu (reprise de Shopify) ne se dit pas « Sans cadre »", () => {
  // Relecture du 26/11 : ni format ni cadre dans sa configuration, elle avait
  // peut-être un cadre chez Shopify.
  assert.equal(choixDeLAffiche({ format: null, cadre: null, quantite: 1 }), "—");
  assert.equal(choixDeLAffiche({}), "—");
  assert.equal(choixDeLAffiche({ format: "", cadre: "", quantite: 3 }), "—");
  assert.equal(choixDeLAffiche({ format: null, cadre: null, paysage: true }), "Paysage");
});

test("le montant saisi en euros devient des centimes entiers", () => {
  assert.equal(centimesSaisis("39"), 3900);
  assert.equal(centimesSaisis("39,5"), 3950);
  assert.equal(centimesSaisis("39.50"), 3950);
  assert.equal(centimesSaisis(" 39,50 € "), 3950);
  assert.equal(centimesSaisis("0.1"), 10);
  // Le serveur refuse zéro et le négatif, avec sa phrase : ici, ils se lisent.
  assert.equal(centimesSaisis("0"), 0);
  assert.equal(centimesSaisis("-5"), -500);
  assert.equal(centimesSaisis(""), null);
  assert.equal(centimesSaisis("trente"), null);
  assert.equal(centimesSaisis("39,505"), null);
  assert.equal(centimesSaisis("1 039,00"), 103900);
});

test("la question redit l'ancien et le nouveau montant, et ne se pose pas pour rien", () => {
  const q = lu(questionDeCorrection("SAL-0021", 2900, 3900, " cadre ajouté "));
  assert.match(q, /^Passer la vente SAL-0021 de 29 € à 39 € \? Motif : « cadre ajouté »\./);
  assert.match(q, /Le grand livre garde l'encaissement d'origine/);
  assert.equal(questionDeCorrection("SAL-0021", 2900, 2900, "x"), null);
  assert.equal(questionDeCorrection("SAL-0021", 2900, null, "x"), null);
  assert.match(lu(questionDeCorrection("SAL-0021", 3900, 2950, "")), /de 39 € à 29,50 € \?\n/);
});

test("le message d'après dit le changement, ou que rien n'a changé", () => {
  assert.match(
    lu(messageDeCorrection({ numero: "SAL-0021", avantCents: 2900, apresCents: 3900, inchange: false })),
    /^Vente SAL-0021 : 29 € → 39 €\. Les statistiques/,
  );
  assert.equal(
    lu(messageDeCorrection({ numero: "SAL-0021", avantCents: 2900, apresCents: 2900, inchange: true })),
    "La vente SAL-0021 vaut déjà 29 € : rien n'a changé.",
  );
  assert.equal(lu(euros(3950)), "39,50 €");
});

test("les corrections au grand livre : moyen « stand » ET parent ; une annulée avec la vente compte encore", () => {
  const mouvements = [
    { kind: "refund", status: "success", amountCents: 400, gateway: "stand", parentId: 10, message: "remise accordée" },
    { kind: "sale", status: "success", amountCents: 1000, gateway: "stand", parentId: 10, message: "cadre ajouté" },
    { kind: "sale", status: "success", amountCents: 2900, gateway: "stand", parentId: null, message: null },
    // Un remboursement ordinaire, et une écriture en échec.
    { kind: "refund", status: "success", amountCents: 500, gateway: "manuel", parentId: null, message: "geste" },
    { kind: "sale", status: "failure", amountCents: 700, gateway: "stand", parentId: 10, message: "échec" },
  ];
  assert.equal(estCorrectionDuMontant(mouvements[1]), true);
  assert.equal(estCorrectionDuMontant(mouvements[2]), false);
  assert.equal(estCorrectionDuMontant(mouvements[3]), false);
  assert.deepEqual(correctionsDuMontant(mouvements), {
    netteCents: 600,
    motifs: ["remise accordée", "cadre ajouté"],
  });
  // La vente annulée ensuite : ses encaissements passent « annule », son
  // total ne bouge pas, la correction qu'il porte se lit encore.
  assert.equal(correctionsDuMontant([{ ...mouvements[1], status: "annule" }]).netteCents, 1000);
  assert.deepEqual(correctionsDuMontant([]), { netteCents: 0, motifs: [] });
});
