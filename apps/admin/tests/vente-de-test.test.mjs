/**
 * Les ventes de test du stand, côté back-office (lib/vente-de-test.ts), sans
 * navigateur ni base (20/11, Alexandra : « non pour mettre en test à la main
 * c'est avec sélectionner et une option à la sélection »).
 *
 * Lancés par : docker exec -w /app/apps/admin memoryline-admin node --test "tests/*.test.mjs"
 * (Node retire seul les types des fichiers .ts importés.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { compteRenduMiseEnTest, estVenteDeTest } from "../src/lib/vente-de-test.ts";

test("une vente de test : du stand, annulée ET étiquetée « test », la casse ignorée", () => {
  const stand = { channel: "salon" };
  assert.equal(estVenteDeTest({ ...stand, status: "cancelled", tags: ["test"] }), true);
  assert.equal(estVenteDeTest({ ...stand, status: "voided", tags: ["Marché de Noël", "TEST"] }), true);
  // Étiquetée sans être annulée : elle compte encore, ce n'est pas une vente de test.
  assert.equal(estVenteDeTest({ ...stand, status: "paid", tags: ["test"] }), false);
  // Annulée sans l'étiquette, ou avec une étiquette qui contient seulement le mot.
  assert.equal(estVenteDeTest({ ...stand, status: "cancelled", tags: null }), false);
  assert.equal(estVenteDeTest({ ...stand, status: "cancelled", tags: ["TEST : viendra chercher le 20/9"] }), false);
});

test("une commande du site annulée et étiquetée n'est pas une vente de test", () => {
  // Relecture du 20/11 : sa fiche disait « Vente de test : hors des
  // chiffres. », alors qu'aucun onglet « Test » ne la range.
  assert.equal(estVenteDeTest({ channel: "web", status: "cancelled", tags: ["test"] }), false);
  // Sans canal connu, pas de vente de test non plus.
  assert.equal(estVenteDeTest({ status: "cancelled", tags: ["test"] }), false);
});

test("le compte rendu accorde ses mots, sans « (s) »", () => {
  const une = compteRenduMiseEnTest({ count: 1, ecartees: [] });
  assert.match(une, /^1 vente mise en test : elle ne compte plus/);
  assert.match(une, /Aucun courriel n'est parti\.$/);
  const deux = compteRenduMiseEnTest({ count: 2 });
  assert.match(deux, /^2 ventes mises en test : elles ne comptent plus dans vos chiffres et se rangent dans l'onglet « Test »/);
  assert.equal(compteRenduMiseEnTest({ count: 0, ecartees: null }), "Aucune vente n'a été mise en test.");
  for (const phrase of [une, deux]) assert.doesNotMatch(phrase, /\(s\)/);
});

test("les commandes écartées sont comptées, avec leur raison", () => {
  const site = "La commande WEB-0015 vient du site : seules les ventes du stand se mettent en test.";
  const r = compteRenduMiseEnTest({ count: 2, ecartees: [{ raison: site }] });
  assert.match(r, /^2 ventes mises en test/);
  assert.ok(r.endsWith(`1 commande laissée telle quelle : ${site}`));
  // Rien de passé : on le dit, puis pourquoi.
  const rien = compteRenduMiseEnTest({ count: 0, ecartees: [{ raison: site }, { raison: "Autre raison." }] });
  assert.equal(rien, `Aucune vente n'a été mise en test. 2 commandes laissées telles quelles : ${site} Autre raison.`);
  // La même raison deux fois ne se lit qu'une fois, mais les deux comptent.
  const double = compteRenduMiseEnTest({ count: 0, ecartees: [{ raison: "Pareil." }, { raison: "Pareil." }] });
  assert.ok(double.endsWith("2 commandes laissées telles quelles : Pareil."));
});
