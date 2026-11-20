/**
 * Les ventes de test du stand (20/11, Alexandra : « il faudrait ajouter
 * "test" comme ça on peut mettre des commandes en test », puis : « non pour
 * mettre en test à la main c'est avec sélectionner et une option à la
 * sélection »), sans base de données.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/ventes-de-test.test.ts
 *
 * La règle (ventes-de-test.ts) : une vente de test est une vente du stand
 * ANNULÉE et étiquetée « test ». La mise en test — vente par vente, dans
 * l'action groupée « test » comme sur la route d'annulation — se refuse aux
 * commandes du site, aux reprises de Shopify et aux paniers, ne refait rien
 * sur une vente déjà en test, étiquette seulement une vente déjà annulée, et
 * annule les autres. Depuis la relecture, l'étiquette « test » ne se pose plus
 * à la main sur une vente du stand qui compte encore.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avecEtiquetteTest,
  estVenteDeTest,
  lireFiltreTest,
  miseEnTest,
  MOTIF_TEST,
  porteEtiquetteTest,
  poseTestALaMain,
  refusEtiquetteTest,
} from "../src/ventes-de-test.js";

/** Une vente du stand payée, sans étiquette. */
const vente = { number: "SAL-0042", channel: "salon", status: "paid", tags: null as unknown };

test("l'étiquette « test » se lit sans tenir compte de la casse, et seule", () => {
  assert.equal(porteEtiquetteTest(["test"]), true);
  assert.equal(porteEtiquetteTest(["Marché de Noël", "TEST"]), true);
  assert.equal(porteEtiquetteTest(["Test"]), true);
  // Une étiquette qui CONTIENT le mot n'est pas l'étiquette (il y en a une
  // en base de développement : « TEST : viendra chercher le 20/9 »).
  assert.equal(porteEtiquetteTest(["TEST : viendra chercher le 20/9"]), false);
  assert.equal(porteEtiquetteTest(["tests"]), false);
  assert.equal(porteEtiquetteTest([]), false);
  assert.equal(porteEtiquetteTest(null), false);
  assert.equal(porteEtiquetteTest(undefined), false);
  // Une colonne JSON qui ne serait pas un tableau ne fait pas planter la liste.
  assert.equal(porteEtiquetteTest("test"), false);
  assert.equal(porteEtiquetteTest({ test: true }), false);
});

test("une vente de test est une vente du stand, annulée ET étiquetée", () => {
  const stand = { channel: "salon" };
  assert.equal(estVenteDeTest({ ...stand, status: "cancelled", tags: ["test"] }), true);
  assert.equal(estVenteDeTest({ ...stand, status: "voided", tags: ["Test"] }), true);
  // Étiquetée à la main sans être annulée : elle compte encore, elle reste
  // dans « Toutes ».
  assert.equal(estVenteDeTest({ ...stand, status: "paid", tags: ["test"] }), false);
  assert.equal(estVenteDeTest({ ...stand, status: "pending", tags: ["test"] }), false);
  // Annulée sans l'étiquette : une annulée ordinaire.
  assert.equal(estVenteDeTest({ ...stand, status: "cancelled", tags: ["Pas payée"] }), false);
  assert.equal(estVenteDeTest({ ...stand, status: "cancelled", tags: null }), false);
  // Une commande du site annulée et étiquetée à la main (relecture du 20/11) :
  // le site n'a pas d'onglet « Test », elle reste une commande annulée.
  assert.equal(estVenteDeTest({ channel: "web", status: "cancelled", tags: ["test"] }), false);
});

test("« test » ne se pose pas à la main sur une vente du stand qui compte encore", () => {
  // Relecture du 20/11 : « Ajouter une étiquette » ou l'éditeur de la fiche
  // l'affichaient sans sortir la vente des chiffres.
  assert.equal(poseTestALaMain(vente, ["test"]), true);
  assert.equal(poseTestALaMain({ ...vente, status: "pending" }, ["Marché", "TEST"]), true);
  // D'autres étiquettes, ou une qui contient seulement le mot : rien à refuser.
  assert.equal(poseTestALaMain(vente, ["Marché de Noël Mulhouse"]), false);
  assert.equal(poseTestALaMain(vente, ["TEST : viendra chercher le 20/9"]), false);
  // Déjà là (posée avant la règle) : la vente garde le droit d'enregistrer
  // ses autres étiquettes.
  assert.equal(poseTestALaMain({ ...vente, tags: ["Test"] }, ["Test", "urgent"]), false);
  // Annulée, ou panier : déjà hors des chiffres, l'étiquette n'y trompe personne.
  assert.equal(poseTestALaMain({ ...vente, status: "cancelled" }, ["test"]), false);
  assert.equal(poseTestALaMain({ ...vente, status: "voided" }, ["test"]), false);
  assert.equal(poseTestALaMain({ ...vente, status: "draft" }, ["test"]), false);
  // Le site n'est pas concerné.
  assert.equal(poseTestALaMain({ ...vente, channel: "web" }, ["test"]), false);
});

test("le refus nomme les ventes en cause et mène à « Mettre en test »", () => {
  const une = refusEtiquetteTest(["SAL-0005"]);
  assert.equal(
    une,
    "L'étiquette « test » seule ne sort pas la vente SAL-0005 des chiffres. Pour une vente d'essai, cochez-la dans Ventes stand et choisissez « Mettre en test ». Aucune étiquette n'a été enregistrée.",
  );
  assert.match(
    refusEtiquetteTest(["SAL-0001", "SAL-0002", "SAL-0003"]),
    /^L'étiquette « test » seule ne sort pas les ventes SAL-0001, SAL-0002 et SAL-0003 des chiffres\. Pour des ventes d'essai, cochez-les/,
  );
  // Au-delà de cinq, le nombre des autres.
  const sept = refusEtiquetteTest(["A1", "A2", "A3", "A4", "A5", "A6", "A7"]);
  assert.match(sept, /les ventes A1, A2, A3, A4, A5 et 2 autres des chiffres/);
  assert.match(refusEtiquetteTest(["A1", "A2", "A3", "A4", "A5", "A6"]), /A5 et 1 autre des chiffres/);
  for (const phrase of [une, sept]) assert.doesNotMatch(phrase, /\(s\)/);
});

test("l'étiquette s'ajoute une fois, et garde celles d'avant", () => {
  assert.deepEqual(avecEtiquetteTest(null), ["test"]);
  assert.deepEqual(avecEtiquetteTest([]), ["test"]);
  assert.deepEqual(avecEtiquetteTest(["Marché de Noël Mulhouse"]), ["Marché de Noël Mulhouse", "test"]);
  // Déjà là, en majuscules : pas de doublon, et la casse choisie reste.
  assert.deepEqual(avecEtiquetteTest(["TEST", "urgent"]), ["TEST", "urgent"]);
  // Ce qui n'est pas du texte ne survit pas.
  assert.deepEqual(avecEtiquetteTest(["a", 3, null]), ["a", "test"]);
  assert.deepEqual(avecEtiquetteTest("test"), ["test"]);
});

test("le filtre de la liste ne connaît que « seul » et « exclure »", () => {
  assert.equal(lireFiltreTest("seul"), "seul");
  assert.equal(lireFiltreTest("exclure"), "exclure");
  // Rien, ou autre chose : pas de filtre, la liste d'avant.
  assert.equal(lireFiltreTest(undefined), null);
  assert.equal(lireFiltreTest(""), null);
  assert.equal(lireFiltreTest("1"), null);
  assert.equal(lireFiltreTest("SEUL"), null);
});

test("une commande du site ne se met pas en test", () => {
  const r = miseEnTest({ ...vente, number: "WEB-0015", channel: "web" });
  assert.equal(r.geste, "refuser");
  assert.match(r.geste === "refuser" ? r.erreur : "", /WEB-0015 vient du site/);
  assert.match(r.geste === "refuser" ? r.erreur : "", /seules les ventes du stand/);
  // Même annulée et étiquetée : le site n'a pas d'onglet « Test ».
  assert.equal(miseEnTest({ ...vente, channel: "web", status: "cancelled", tags: ["test"] }).geste, "refuser");
});

test("un panier de la tablette ne se met pas en test", () => {
  const r = miseEnTest({ ...vente, number: "DRAFT-12", status: "draft" });
  assert.equal(r.geste, "refuser");
  // Le numéro est dans la phrase : dans le compte rendu d'une sélection, on
  // sait laquelle a été écartée.
  assert.match(r.geste === "refuser" ? r.erreur : "", /^DRAFT-12 est un panier/);
});

test("une reprise de Shopify ne se met pas en test, même rangée au stand", () => {
  // L'action groupée ne passe pas par la garde d'index.ts : la règle la porte.
  const r = miseEnTest({ ...vente, number: "SHOP-1042", legacyId: 5512345678 });
  assert.equal(r.geste, "refuser");
  assert.match(r.geste === "refuser" ? r.erreur : "", /SHOP-1042 a été reprise de Shopify/);
  // Même déjà annulée : on ne lui ajoute rien.
  assert.equal(miseEnTest({ ...vente, status: "cancelled", legacyId: 1 }).geste, "refuser");
  // Sans reprise (null ou absent), la règle ordinaire.
  assert.equal(miseEnTest({ ...vente, legacyId: null }).geste, "annuler");
});

test("une vente du stand payée ou à encaisser s'annule", () => {
  assert.deepEqual(miseEnTest(vente), { geste: "annuler" });
  assert.deepEqual(miseEnTest({ ...vente, status: "pending" }), { geste: "annuler" });
  // Étiquetée « test » à la main mais pas annulée : elle compte encore, on
  // l'annule (l'étiquette ne se double pas, voir plus haut).
  assert.deepEqual(miseEnTest({ ...vente, tags: ["test"] }), { geste: "annuler" });
});

test("une vente déjà annulée reçoit seulement l'étiquette et le motif", () => {
  assert.deepEqual(miseEnTest({ ...vente, status: "cancelled", tags: ["Pas payée"] }), { geste: "etiqueter" });
  assert.deepEqual(miseEnTest({ ...vente, status: "voided" }), { geste: "etiqueter" });
});

test("une vente déjà en test : rien à refaire", () => {
  assert.deepEqual(miseEnTest({ ...vente, status: "cancelled", tags: ["Test"] }), { geste: "rien" });
});

test("le motif est celui qu'on lit au journal et sur la fiche", () => {
  assert.equal(MOTIF_TEST, "Commande de test");
});
