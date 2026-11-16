/**
 * Le retour d'un moyen de paiement À REDIRECTION (Bancontact, iDEAL, Klarna…) :
 * ce que la caisse affiche, et la preuve que le navigateur qui revient est
 * celui qui a payé (src/payments.ts, route /payments/stripe/retour).
 *
 * Sans base ni réseau : `fetch` est remplacé le temps d'un essai par un faux
 * qui ne part nulle part. TOUTES LES VALEURS SONT FACTICES.
 *
 * Lancés par : docker exec -w /app/apps/api memoryline-api npx tsx --test tests/retour-stripe.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Secret } from "../src/paiements-cles.ts";
import {
  getStripeIntent,
  issueDuRetour,
  secretClientConcorde,
} from "../src/payments.ts";

const SECRET_CLIENT = "pi_3FACTICE0essai_secret_FACTICEclientsecret0001";

test("l'écran vient de la commande et de l'intention, jamais de redirect_status", () => {
  // Payée — à l'instant, ou déjà par le webhook arrivé avant la cliente.
  assert.equal(issueDuRetour("succeeded", "paid"), "payee");
  // Payée par une autre tentative : rien à repayer, quoi qu'en dise celle-ci.
  assert.equal(issueDuRetour("requires_payment_method", "paid"), "payee");
  // La banque n'a pas encore répondu (SEPA, virement).
  assert.equal(issueDuRetour("processing", "pending"), "en_cours");
  // L'argent est pris, la commande n'a pas pu passer payée (écart de montant,
  // au journal de la commande) : surtout pas « réessayez ».
  assert.equal(issueDuRetour("succeeded", "pending"), "en_cours");
  assert.equal(issueDuRetour("succeeded", "draft"), "en_cours");
  // Le même cas, quand le serveur SAIT que c'est un écart de montant : la
  // cliente lit que la boutique revient vers elle, pas « en cours ».
  assert.equal(issueDuRetour("succeeded", "pending", true), "ecart");
  // Un écart ne change rien à une commande payée, ni à un refus.
  assert.equal(issueDuRetour("succeeded", "paid", true), "payee");
  assert.equal(issueDuRetour("canceled", "pending", true), "refuse");
  // Refus, abandon chez la banque, annulation : le panier est gardé.
  assert.equal(issueDuRetour("requires_payment_method", "pending"), "refuse");
  assert.equal(issueDuRetour("requires_action", "pending"), "refuse");
  assert.equal(issueDuRetour("canceled", "pending"), "refuse");
});

test("le client_secret : seul celui que Stripe garde ouvre le retour", () => {
  assert.equal(secretClientConcorde(SECRET_CLIENT, SECRET_CLIENT), true);
  assert.equal(secretClientConcorde(SECRET_CLIENT, SECRET_CLIENT.slice(0, -1) + "2"), false);
  assert.equal(secretClientConcorde(SECRET_CLIENT, SECRET_CLIENT + "0"), false);
  // Vide d'un côté ou de l'autre : refusé, même vide contre vide.
  assert.equal(secretClientConcorde("", ""), false);
  assert.equal(secretClientConcorde(SECRET_CLIENT, ""), false);
  assert.equal(secretClientConcorde("", SECRET_CLIENT), false);
});

test("getStripeIntent rend le client_secret avec le statut et le montant encaissé", async () => {
  const vraiFetch = globalThis.fetch;
  const appels: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    appels.push(String(url));
    return new Response(
      JSON.stringify({
        status: "succeeded",
        amount_received: 4590,
        currency: "eur",
        client_secret: SECRET_CLIENT,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    const i = await getStripeIntent(
      { mode: "test", cleSecrete: new Secret("sk_test_FACTICE_essai_retour") },
      "pi_3FACTICE0essai",
    );
    assert.deepEqual(i, {
      status: "succeeded",
      montantCents: 4590,
      devise: "eur",
      clientSecret: SECRET_CLIENT,
    });
    assert.deepEqual(appels, ["https://api.stripe.com/v1/payment_intents/pi_3FACTICE0essai"]);
  } finally {
    globalThis.fetch = vraiFetch;
  }
});
