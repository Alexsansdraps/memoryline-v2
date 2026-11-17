/**
 * Finances : une carte cadeau se compte dans le chiffre d'affaires quand elle
 * est UTILISÉE, pas quand elle est vendue (décision d'Alexandra, 17/11).
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/finances-cartes-cadeaux.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { partDuChiffreDAffaires } from "../src/finances.js";

test("vendre une carte de 50 € : rien au chiffre d'affaires, 50 € encaissés d'avance", () => {
  assert.deepEqual(partDuChiffreDAffaires({ totalCents: 5000, cartesVenduesCents: 5000 }), {
    chiffreAffairesCents: 0,
    avanceCents: 5000,
  });
});

test("payer une affiche de 50 € avec la carte : 50 € au chiffre d'affaires", () => {
  // La part payée par la carte est dans le total de la commande, et aucune
  // carte n'y est vendue.
  assert.deepEqual(partDuChiffreDAffaires({ totalCents: 5000, cartesVenduesCents: 0 }), {
    chiffreAffairesCents: 5000,
    avanceCents: 0,
  });
});

test("la carte vendue puis utilisée ne compte qu'une fois", () => {
  const vente = partDuChiffreDAffaires({ totalCents: 5000, cartesVenduesCents: 5000 });
  const usage = partDuChiffreDAffaires({ totalCents: 5000, cartesVenduesCents: 0 });
  assert.equal(vente.chiffreAffairesCents + usage.chiffreAffairesCents, 5000);
});

test("une affiche et une carte dans la même commande : seule l'affiche compte", () => {
  assert.deepEqual(partDuChiffreDAffaires({ totalCents: 7900, cartesVenduesCents: 5000 }), {
    chiffreAffairesCents: 2900,
    avanceCents: 5000,
  });
});
