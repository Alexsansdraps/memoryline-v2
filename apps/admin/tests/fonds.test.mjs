/**
 * Les phrases de « Créer un fond » (lib/fonds-textes.ts, 20/11) : le coût
 * annoncé avant de lancer — photos × versions —, l'état d'un fond, et le
 * sondage qui sait quand recharger la page.
 *
 * Lancés par : docker exec -w /app/apps/admin memoryline-admin node --test "tests/*.test.mjs"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  confirmationLot,
  confirmationMessage,
  encoreEnCours,
  euros,
  nouveauJeton,
  pluriel,
  texteEtat,
} from "../src/lib/fonds-textes.ts";

test("euros et pluriels, sans « (s) »", () => {
  assert.equal(euros(25), "0,25 €");
  assert.equal(euros(150), "1,50 €");
  assert.equal(pluriel(1, "photo"), "1 photo");
  assert.equal(pluriel(3, "photo"), "3 photos");
});

test("la confirmation d'un lot compte photos × versions, une photo = un fond", () => {
  const q = confirmationLot(3, 2, 25);
  assert.match(q, /3 fonds \(un par photo\), 2 versions chacun/);
  assert.match(q, /1,50 € \(6 images à 0,25 €\)/);
  assert.doesNotMatch(q, /\(s\)/);
  assert.match(confirmationLot(1, 1, 25), /Lancer 1 fond, 1 version chacun/);
  assert.match(confirmationLot(2, 2, 25, true), /rien n'est payé/);
});

test("la confirmation d'un message de la discussion rappelle qu'il est payé", () => {
  assert.match(confirmationMessage(1, 25), /1 nouvelle image, payée : environ 0,25 €/);
  assert.match(confirmationMessage(1, 25, true), /rien n'est payé/);
});

test("l'état d'un fond", () => {
  assert.equal(texteEtat({ etat: "en_cours", enCours: 2, pretes: 0, echecs: 0 }), "2 images en cours de dessin…");
  assert.equal(texteEtat({ etat: "prete", enCours: 0, pretes: 1, echecs: 1 }), "Prêt · 1 échec");
  assert.equal(texteEtat({ etat: "echec", enCours: 0, pretes: 0, echecs: 2 }), "Échec du dessin");
});

test("le sondage recharge dès que plus rien n'est en cours, pour un fond comme pour un lot", () => {
  assert.equal(encoreEnCours({ etat: "en_cours" }), true);
  assert.equal(encoreEnCours({ etat: "prete" }), false);
  assert.equal(encoreEnCours({ fonds: [{ etat: "prete" }, { etat: "en_cours" }] }), true);
  assert.equal(encoreEnCours({ fonds: [{ etat: "prete" }, { etat: "echec" }] }), false);
  assert.equal(encoreEnCours(null), false);
});

test("un jeton par envoi, accepté par l'API (lettres, chiffres, tirets)", () => {
  const a = nouveauJeton();
  assert.match(a, /^[A-Za-z0-9-]{8,80}$/);
  assert.notEqual(a, nouveauJeton());
});
