/**
 * Le vrai coût d'une image IA (25/11) : calculé d'après ce qu'OpenAI dit
 * avoir consommé (`usage`), au tarif publié du modèle, au lieu des 8 c fixes
 * d'avant. Sans base.
 *
 *   DATABASE_URL=postgres://e:e@127.0.0.1:1/e npx tsx --test tests/cout-ia.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://essai:essai@127.0.0.1:1/essai";
const { coutReelCents } = await import("../src/ia.ts");

test("gpt-image-2 : texte 5 $, image envoyée 8 $, image produite 30 $ le million, en centimes d'euro", () => {
  // (3000 × 5 + 2000 × 8 + 6240 × 30) / 1e6 = 0,2182 $ → × 0,9 = 0,196 € → 20 c
  const usage = {
    input_tokens: 5000,
    output_tokens: 6240,
    input_tokens_details: { text_tokens: 3000, image_tokens: 2000 },
  };
  assert.equal(coutReelCents("gpt-image-2", usage), 20);
  // Un nom daté du même modèle se lit pareil.
  assert.equal(coutReelCents("gpt-image-2-2026-04-21", usage), 20);
});

test("sans le détail texte / image, tout ce qui entre compte comme du texte", () => {
  assert.equal(coutReelCents("gpt-image-2", { input_tokens: 1_000_000, output_tokens: 0 }), 450);
});

test("modèle inconnu, réponse sans consommation, ou consommation nulle : pas de calcul (on garde l'estimation)", () => {
  assert.equal(coutReelCents("un-autre-modele", { input_tokens: 10, output_tokens: 10 }), null);
  assert.equal(coutReelCents("gpt-image-2", null), null);
  assert.equal(coutReelCents("gpt-image-2", {}), null);
});

test("une image facturée coûte au moins un centime", () => {
  assert.equal(coutReelCents("gpt-image-2", { input_tokens: 1, output_tokens: 1 }), 1);
});
