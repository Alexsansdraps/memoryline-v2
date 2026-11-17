/**
 * Un code à usage unique ne compte comme utilisé que s'il a fait baisser le
 * prix (décision d'Alexandra, 17/11) : codeARemise (@memoryline/types), lu
 * par utilisationsDuCode et par la liste des promotions.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/code-usage-unique.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  codeARemise,
  remisesPanier,
  reglesActives,
  type LignePanier,
  type RegleParier,
} from "@memoryline/types";

/** -10 € dès 50 € d'achat, une seule fois. */
const DIX: RegleParier = {
  id: 7,
  name: "Bienvenue -10 €",
  code: "BIENVENUE",
  type: "fixed",
  config: {
    amountCents: 1000,
    usageUnique: true,
    conditions: { minCents: 5000, minQuantite: null },
  },
  active: true,
  priority: 10,
};

/** Seulement la livraison offerte. */
const PORT: RegleParier = {
  id: 8,
  name: "Livraison offerte",
  code: "PORT",
  type: "percent",
  config: { percent: 0, livraisonOfferte: true, usageUnique: true },
  active: true,
  priority: 10,
};

const A4 = (q = 1): LignePanier => ({ unitPriceCents: 2300, quantity: q, format: "A4" });

/** Ce que la caisse fige sur la commande (calculerArticles). */
function figer(lignes: LignePanier[], regle: RegleParier, code: string) {
  const { detail } = remisesPanier(lignes, [regle], new Date(), [code]);
  return { regles: reglesActives([regle], new Date(), [code]), detail, codes: [code] };
}

test("minimum pas atteint : le code n'a rien remisé, il reste utilisable", () => {
  const promotions = figer([A4(1)], DIX, "BIENVENUE"); // 23 € < 50 €
  assert.equal(promotions.detail.length, 0);
  assert.equal(codeARemise({ promoCode: "bienvenue", shippingCents: 590, promotions }), false);
});

test("minimum atteint : le code a remisé, il compte", () => {
  const promotions = figer([A4(3)], DIX, "BIENVENUE"); // 69 € ≥ 50 €
  assert.ok(promotions.detail.some((d) => d.montantCents === 1000));
  assert.equal(codeARemise({ promoCode: "BIEN-VENUE", shippingCents: 590, promotions }), true);
});

test("livraison offerte par le code, port à 0 : il compte", () => {
  const promotions = figer([A4(1)], PORT, "PORT");
  assert.equal(codeARemise({ promoCode: "PORT", shippingCents: 0, promotions }), true);
  // Port payé quand même : le code n'a rien fait baisser.
  assert.equal(codeARemise({ promoCode: "PORT", shippingCents: 590, promotions }), false);
});

test("commande d'avant la copie des promotions : comptée, par prudence", () => {
  assert.equal(codeARemise({ promoCode: "BIENVENUE", promotions: null }), true);
});

test("sans code : rien à compter", () => {
  assert.equal(codeARemise({ promoCode: null, promotions: null }), false);
});
