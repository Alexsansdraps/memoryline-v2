/**
 * Un seul interrupteur pour toute la boutique, sans base de données.
 *
 *   npx tsx --test tests/courriers-mode.test.ts
 *
 * Alexandra, 9 novembre 2026 : « tout renseigner, et que ça sache quand on est
 * en test et en prod ». L'interrupteur « La boutique encaisse » (BO › Réglages
 * › Paiements) décide des paiements, et maintenant aussi des courriers (boîte
 * d'essai ou Resend) et des étiquettes SendCloud (gratuites ou facturées).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { aiguillageCourriers } from "../src/mail.js";
import { casesVides, preconditionsBascule, resoudreConfig, type EntreeBascule } from "../src/paiements-cles.js";

test("jamais touché : la boîte d'essai passe devant, comme avant", () => {
  assert.equal(aiguillageCourriers({ mode: null, boiteTest: true, resendPret: true }), "boite");
  assert.equal(aiguillageCourriers({ mode: null, boiteTest: false, resendPret: true }), "resend");
  assert.equal(aiguillageCourriers({ mode: null, boiteTest: false, resendPret: false }), "aucun");
});

test("en essai : la boîte d'essai, même avec Resend prêt dans le .env", () => {
  assert.equal(aiguillageCourriers({ mode: "essai", boiteTest: true, resendPret: true }), "boite");
});

test("pour de vrai : Resend, même avec la boîte d'essai encore dans le .env", () => {
  assert.equal(aiguillageCourriers({ mode: "reel", boiteTest: true, resendPret: true }), "resend");
});

test("pour de vrai sans Resend : la boîte d'essai garde le courrier plutôt que de le perdre", () => {
  assert.equal(aiguillageCourriers({ mode: "reel", boiteTest: true, resendPret: false }), "boite");
  assert.equal(aiguillageCourriers({ mode: "reel", boiteTest: false, resendPret: false }), "aucun");
});

test("les étiquettes suivent l'interrupteur dès qu'il est réglé", () => {
  // Pour de vrai : de vraies étiquettes, même si l'ancien réglage disait non.
  const reel = resoudreConfig({}, casesVides(), "reel", false);
  assert.equal(reel.etiquettesReelles, true);
  assert.equal(reel.etiquettesSource, "mode");
  // En essai : des étiquettes d'essai, même si le .env les demande payantes.
  const essai = resoudreConfig({ SENDCLOUD_ACHATS_REELS: "oui" }, casesVides(), "essai", true);
  assert.equal(essai.etiquettesReelles, false);
  assert.equal(essai.etiquettesSource, "mode");
});

test("interrupteur jamais touché : les étiquettes gardent leur ancienne règle", () => {
  assert.equal(resoudreConfig({ SENDCLOUD_ACHATS_REELS: "oui" }, casesVides(), "env", null).etiquettesReelles, true);
  assert.equal(resoudreConfig({}, casesVides(), "env", true).etiquettesSource, "bo");
  assert.equal(resoudreConfig({}, casesVides(), "env", null).etiquettesSource, "env");
});

const vide: EntreeBascule = { jeu: null, verification: null, empreintesActuelles: null };

test("pas de passage en réel tant que les courriels ne peuvent pas partir pour de vrai", () => {
  const r = preconditionsBascule({ stripe: vide, paypal: vide }, false);
  assert.equal(r.possible, false);
  assert.ok(r.raisons.some((x) => x.includes("RESEND_API_KEY")));
  assert.ok(r.raisons.some((x) => x.startsWith("Aucune clé live")));
});

test("courriels prêts (ou non précisé) : la raison n'apparaît pas", () => {
  for (const r of [preconditionsBascule({ stripe: vide, paypal: vide }, true), preconditionsBascule({ stripe: vide, paypal: vide })]) {
    assert.ok(!r.raisons.some((x) => x.includes("RESEND_API_KEY")));
  }
});

test("la raison nomme ce qui manque : MAIL_FROM seul, la clé seule, ou les deux", () => {
  const seulFrom = preconditionsBascule({ stripe: vide, paypal: vide }, false, ["MAIL_FROM"]).raisons[0]!;
  assert.match(seulFrom, /la clé Resend est là, il manque MAIL_FROM/);
  const seuleCle = preconditionsBascule({ stripe: vide, paypal: vide }, false, ["RESEND_API_KEY"]).raisons[0]!;
  assert.match(seuleCle, /il manque RESEND_API_KEY .*redémarrée/);
  assert.doesNotMatch(seuleCle, /MAIL_FROM/);
  const lesDeux = preconditionsBascule({ stripe: vide, paypal: vide }, false, ["RESEND_API_KEY", "MAIL_FROM"]).raisons[0]!;
  assert.match(lesDeux, /RESEND_API_KEY et MAIL_FROM/);
});
