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
  autresTotauxDeLEnvoi,
  centimesSaisis,
  choixDeLAffiche,
  correctionsDuMontant,
  envoiDuTotal,
  estCorrectionDuMontant,
  etatDuTotal,
  euros,
  eurosAuCentime,
  listeDesVentes,
  messageDeCorrection,
  messagesDesTotaux,
  questionDeCorrection,
  questionTotauxEnAttente,
  refusDesFacturesEnAttente,
  resultatDuTotal,
  SAISIE_ILLISIBLE,
  saisieDuTotal,
  TOTAL_EN_ATTENTE,
  totauxDeLEnvoi,
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

/*
 * Le total DANS LA LIGNE de Ventes stand (26/11, Margaux : « commande stand
 * pouvoir modifier directement le total dans la ligne. Car si elle applique
 * des réductions par ex, faudrait juste le total indépendamment du reste ») :
 * le champ accepte « 59 », « 59,5 », « 59.50 », « 59 € » ; une valeur
 * inchangée n'envoie rien ; le résultat se lit « SAL-0036 : 69,00 € → 59,00 € ».
 */
test("le champ de la ligne : sa valeur, et les quatre façons de taper un total", () => {
  assert.equal(saisieDuTotal(6900), "69,00");
  assert.equal(saisieDuTotal(5950), "59,50");
  assert.equal(saisieDuTotal(5), "0,05");
  for (const [tape, cents] of [
    ["59", 5900],
    ["59,5", 5950],
    ["59.50", 5950],
    ["59 €", 5900],
    [" 59,00 € ", 5900],
  ])
    assert.deepEqual(envoiDuTotal(tape, 6900), { envoyer: true, cents }, tape);
});

test("valeur inchangée ou illisible : rien n'est envoyé", () => {
  assert.deepEqual(envoiDuTotal("69,00", 6900), { envoyer: false, raison: "inchange" });
  assert.deepEqual(envoiDuTotal("69", 6900), { envoyer: false, raison: "inchange" });
  assert.deepEqual(envoiDuTotal("69 €", 6900), { envoyer: false, raison: "inchange" });
  assert.deepEqual(envoiDuTotal("", 6900), { envoyer: false, raison: "illisible" });
  assert.deepEqual(envoiDuTotal("soixante", 6900), { envoyer: false, raison: "illisible" });
  assert.deepEqual(envoiDuTotal("59,505", 6900), { envoyer: false, raison: "illisible" });
  assert.match(SAISIE_ILLISIBLE, /59, 59,50 ou 59 €/);
  // Zéro part : c'est le serveur qui le refuse, avec sa phrase.
  assert.deepEqual(envoiDuTotal("0", 6900), { envoyer: true, cents: 0 });
});

test("le résultat, au centime près : « SAL-0036 : 69,00 € → 59,00 € »", () => {
  assert.equal(
    lu(resultatDuTotal({ numero: "SAL-0036", avantCents: 6900, apresCents: 5900, inchange: false })),
    "SAL-0036 : 69,00 € → 59,00 €",
  );
  assert.equal(
    lu(resultatDuTotal({ numero: "SAL-0036", avantCents: 5900, apresCents: 5900, inchange: true })),
    "SAL-0036 : 59,00 €, inchangé",
  );
  assert.equal(lu(eurosAuCentime(123456)), "1 234,56 €");
});

/* Relecture du 26/11 : un total tapé sur une ligne, sans Entrée, puis Entrée
   sur une autre, était perdu sans rien dire. Il part désormais avec elle. */

test("l'état d'un champ : rien tapé, tapé (à envoyer), ou illisible", () => {
  assert.equal(etatDuTotal("69,00", 6900), "inchange");
  assert.equal(etatDuTotal("69 €", 6900), "inchange");
  assert.equal(etatDuTotal("59", 6900), "modifie");
  assert.equal(etatDuTotal("5O", 6900), "illisible");
  assert.equal(etatDuTotal("", 6900), "illisible");
  assert.match(TOTAL_EN_ATTENTE, /Pas encore enregistré/);
});

test("les totaux d'un envoi : la ligne d'Entrée d'abord, puis les autres tapés, chacun une fois", () => {
  const autres = JSON.stringify([
    { id: 16, numero: "SAL-0016", avant: 3700, montant: "30" },
    { id: 17, numero: "SAL-0017", avant: 3700, montant: "31" },
    // La ligne d'Entrée répétée, un identifiant illisible, un intrus : écartés.
    { id: 18, numero: "SAL-0018", avant: 3700, montant: "99" },
    { id: "abc", numero: "SAL-X", avant: 100, montant: "1" },
    null,
    "SAL-0019",
  ]);
  assert.deepEqual(
    totauxDeLEnvoi({ id: "18", numero: "SAL-0018", avant: "3700", montant: "41", autres }),
    [
      { id: 18, numero: "SAL-0018", avantCents: 3700, saisie: "41" },
      { id: 16, numero: "SAL-0016", avantCents: 3700, saisie: "30" },
      { id: 17, numero: "SAL-0017", avantCents: 3700, saisie: "31" },
    ],
  );
  // Sans script (ou rien d'autre de tapé) : la seule ligne d'Entrée.
  assert.deepEqual(totauxDeLEnvoi({ id: "18", numero: "SAL-0018", avant: "3700", montant: "41" }), [
    { id: 18, numero: "SAL-0018", avantCents: 3700, saisie: "41" },
  ]);
  // Un champ « autres » abîmé ne fait rien perdre de la ligne d'Entrée.
  assert.equal(totauxDeLEnvoi({ id: "18", numero: "SAL-0018", avant: "3700", montant: "41", autres: "[{" }).length, 1);
});

test("les messages : un résultat tel quel, plusieurs comptés, les refus vente par vente", () => {
  const a = { numero: "SAL-0016", texte: "SAL-0016 : 37,00 € → 30,00 €", erreur: false };
  const b = { numero: "SAL-0017", texte: "SAL-0017 : 37,00 € → 31,00 €", erreur: false };
  const refus = { numero: "SAL-0018", texte: "Cette vente a une facture : une facture émise ne se modifie pas.", erreur: true };
  assert.deepEqual(messagesDesTotaux([a]), { flash: a.texte, erreur: null });
  assert.deepEqual(messagesDesTotaux([a, b, refus]), {
    flash: `2 totaux corrigés : ${a.texte} ; ${b.texte}`,
    erreur: `SAL-0018 : ${refus.texte}`,
  });
  assert.deepEqual(messagesDesTotaux([]), { flash: null, erreur: null });
});

test("les totaux en attente, vus de la barre : « Factures » refuse, les autres gestes demandent (relecture finale du 26/11)", () => {
  assert.equal(listeDesVentes([]), "");
  assert.equal(listeDesVentes(["SAL-0023"]), "SAL-0023");
  assert.equal(listeDesVentes(["SAL-0023", "SAL-0025"]), "SAL-0023 et SAL-0025");
  assert.equal(listeDesVentes(["A", "B", "C"]), "A, B et C");
  assert.equal(listeDesVentes(["A", "B", "C", "D", "E", "F", "G"]), "A, B, C, D et 3 autres");

  const une = refusDesFacturesEnAttente(["SAL-0023"]);
  assert.match(une, /^Le total tapé pour SAL-0023 n'est pas encore enregistré : faites Entrée \(ou OK\) dans sa ligne, puis « Factures »\./);
  assert.match(une, /Aucune facture n'a été faite\.$/);
  assert.match(refusDesFacturesEnAttente(["SAL-0023", "SAL-0025"]), /^Les totaux tapés pour SAL-0023 et SAL-0025 ne sont pas encore enregistrés : faites Entrée \(ou OK\) dans l'une des lignes/);

  assert.match(questionTotauxEnAttente(["SAL-0023"]), /^Le total tapé pour SAL-0023 n'est pas enregistré : il sera perdu\. Continuer quand même \?/);
  assert.match(questionTotauxEnAttente(["SAL-0023", "SAL-0025"]), /ils seront perdus\. Continuer quand même \?[\s\S]*ils partent ensemble/);
});

test("les totaux partis depuis d'autres lignes se redisent sous la ligne de l'Entrée, refus d'abord (relecture finale du 26/11)", () => {
  const entree = { id: 70, numero: "SAL-0070", texte: "SAL-0070 : 37,00 € → 40,00 €", erreur: false };
  const fauteDeFrappe = { id: 83, numero: "SAL-0083", texte: "SAL-0083 : 37,00 € → 370,00 €", erreur: false };
  const zero = {
    id: 82,
    numero: "SAL-0082",
    texte: "Le montant d'une vente est plus grand que zéro.",
    erreur: true,
    saisie: "0",
  };
  // Seule la ligne de l'Entrée : rien de plus à dire, son résultat est sous son champ.
  assert.equal(autresTotauxDeLEnvoi([entree], 70), null);
  assert.equal(autresTotauxDeLEnvoi([], 70), null);

  const r = autresTotauxDeLEnvoi([entree, fauteDeFrappe, zero], 70);
  assert.equal(r.titre, "En même temps, 2 autres totaux sont partis, dont 1 refusé :");
  assert.equal(r.refus, 1);
  assert.deepEqual(
    r.lignes.map((l) => [l.id, l.numero, lu(l.texte), l.erreur]),
    [
      [82, "SAL-0082", "refusé (« 0 » tapé, le total n'a pas changé) : Le montant d'une vente est plus grand que zéro.", true],
      [83, "SAL-0083", "enregistré, 37,00 € → 370,00 €", false],
    ],
  );
  // L'Entrée sur une ligne inchangée : elle n'a pas de résultat, les autres se disent quand même.
  const seul = autresTotauxDeLEnvoi([fauteDeFrappe], 70);
  assert.equal(seul.titre, "En même temps, un autre total est parti :");
  assert.equal(seul.refus, 0);
  assert.equal(autresTotauxDeLEnvoi([zero], 70).titre, "En même temps, un autre total est parti, refusé :");
  assert.equal(autresTotauxDeLEnvoi([zero, { ...zero, id: 84, numero: "SAL-0084" }], 70).titre, "En même temps, 2 autres totaux sont partis, tous refusés :");
});
