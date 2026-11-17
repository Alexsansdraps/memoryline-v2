/**
 * Recette du 17/11 : ce que la caisse refuse avant le paiement (code postal,
 * téléphone), et le prénom des courriers.
 *
 *   npx tsx --test tests/saisies-caisse.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { codePostalValide, telephoneValide } from "@memoryline/types";
import { prenomPourCourrier } from "../src/prenom.js";

test("code postal : la forme du pays", () => {
  for (const [cp, pays] of [
    ["80350", "FR"], ["97110", "FR"], ["20000", "FR"], [" 60170 ", "FR"],
    ["1000", "BE"], ["8001", "CH"], ["L-1234", "LU"], ["1234", "LU"],
    ["10115", "DE"], ["28001", "ES"], ["00100", "IT"],
    ["1012 AB", "NL"], ["1012ab", "NL"], ["1000-001", "PT"],
    ["SW1A 1AA", "GB"], ["M1 1AE", "GB"], ["H2X 1Y4", "CA"],
    ["90210", "US"], ["90210-1234", "US"], ["AB 123", "ZZ"],
  ] as const)
    assert.ok(codePostalValide(cp, pays), `${cp} (${pays}) devrait passer`);
  for (const [cp, pays] of [
    ["123", "FR"], ["abc", "FR"], ["8035", "FR"], ["803500", "FR"], ["", "FR"],
    ["10000", "BE"], ["1012", "NL"], ["12345", "GB"], ["x", "ZZ"], ["", "ZZ"],
  ] as const)
    assert.ok(!codePostalValide(cp, pays), `${cp} (${pays}) devrait être refusé`);
});

test("téléphone : facultatif, mais plausible quand il est donné", () => {
  for (const t of ["", "06 12 34 56 78", "+33 6 12 34 56 78", "06.12.34.56.78", "(0)6-12-34-56-78", "+41 21 123 45 67"])
    assert.ok(telephoneValide(t), `« ${t} » devrait passer`);
  for (const t of ["abc", "12", "06 12 34 56 7a", "+33 6 12 34 56 78 90 12 34", "06 12 34 + 56"])
    assert.ok(!telephoneValide(t), `« ${t} » devrait être refusé`);
});

test("prénom des courriers : celui saisi d'abord, sinon le premier mot", () => {
  assert.equal(prenomPourCourrier({ firstName: "Marie Claire", name: "Marie Claire Dupont" }), "Marie Claire");
  assert.equal(prenomPourCourrier({ firstName: "  ", name: "Jean-Pierre de la Tour" }), "Jean-Pierre");
  assert.equal(prenomPourCourrier({ firstName: null, name: "  Léa   Martin " }), "Léa");
  assert.equal(prenomPourCourrier({ name: null }), "");
  assert.equal(prenomPourCourrier(null), "");
});
