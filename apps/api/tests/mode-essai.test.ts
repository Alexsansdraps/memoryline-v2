/**
 * Les essais de la décision « la boutique est-elle en mode essai ? »
 * (src/mode-essai.ts), sans réseau ni base : seule la fonction pure est
 * appelée.
 *
 * Lancés par : docker exec -w /app/apps/api memoryline-api npx tsx --test tests/mode-essai.test.ts
 *
 * Le cas qui compte le plus est le premier : la vraie boutique, avec une vraie
 * clé Stripe et sans PayPal, ne doit JAMAIS se croire en essai. L'ancienne
 * règle s'y trompait, et la caisse aurait montré les cartes d'essai à de
 * vraies clientes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { etatEssaiDepuis, type BranchementsEssai } from "../src/mode-essai.ts";

const rien: BranchementsEssai = {
  stripe: false,
  paypal: false,
  courriersEnEssai: false,
  colisEnEssai: false,
};

test("Stripe pk_live sans PayPal : ni paiement d'essai, ni site d'essai", () => {
  const e = etatEssaiDepuis(
    { stripePublicKey: "pk_live_abc", paypalEnv: "" },
    { ...rien, stripe: true },
  );
  assert.equal(e.paiement, false);
  assert.equal(e.essai, false);
});

test("Stripe pk_test branché : paiement d'essai", () => {
  const e = etatEssaiDepuis(
    { stripePublicKey: "pk_test_abc", paypalEnv: "live" },
    { ...rien, stripe: true },
  );
  assert.equal(e.paiement, true);
  assert.equal(e.essai, true);
});

test("une clé pk_test sans Stripe branché ne compte pas", () => {
  const e = etatEssaiDepuis({ stripePublicKey: "pk_test_abc", paypalEnv: "" }, rien);
  assert.equal(e.paiement, false);
});

test("PayPal sandbox branché : paiement d'essai ; PayPal live : non", () => {
  assert.equal(
    etatEssaiDepuis({ stripePublicKey: "", paypalEnv: "sandbox" }, { ...rien, paypal: true }).paiement,
    true,
  );
  assert.equal(
    etatEssaiDepuis({ stripePublicKey: "", paypalEnv: "" }, { ...rien, paypal: true }).paiement,
    true,
  );
  assert.equal(
    etatEssaiDepuis({ stripePublicKey: "", paypalEnv: " LIVE " }, { ...rien, paypal: true }).paiement,
    false,
  );
});

test("PayPal non branché n'entre pas en compte, quel que soit PAYPAL_ENV", () => {
  const e = etatEssaiDepuis(
    { stripePublicKey: "pk_live_abc", paypalEnv: "sandbox" },
    { ...rien, stripe: true, paypal: false },
  );
  assert.equal(e.paiement, false);
  assert.equal(e.essai, false);
});

test("la boîte d'essai des courriers suffit à faire un site d'essai", () => {
  const e = etatEssaiDepuis(
    { stripePublicKey: "pk_live_abc", paypalEnv: "live" },
    { ...rien, stripe: true, paypal: true, courriersEnEssai: true },
  );
  assert.equal(e.paiement, false);
  assert.equal(e.courriers, true);
  assert.equal(e.essai, true);
});

test("les étiquettes d'essai ne font pas, seules, un site d'essai", () => {
  const e = etatEssaiDepuis(
    { stripePublicKey: "pk_live_abc", paypalEnv: "live" },
    { ...rien, stripe: true, colisEnEssai: true },
  );
  assert.equal(e.colis, true);
  assert.equal(e.essai, false);
});
