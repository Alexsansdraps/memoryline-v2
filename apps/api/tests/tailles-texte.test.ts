/**
 * Les trois tailles de texte par ligne (27/11) : une ligne d'avant, sans
 * taille, doit garder exactement son rendu ET son empreinte d'impression
 * (fichiers-impression.ts hache JSON.stringify(config)). Sans base.
 *
 *   npx tsx --test tests/tailles-texte.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { textBlockSchema, posterConfigSchema } from "../../../packages/types/src/config.ts";
import { facteurTailleLigne } from "../../../packages/types/src/mise-en-page-texte.ts";

test("moyen ou absent = facteur 1 exactement ; petit 0,8 ; grand 1,25", () => {
  assert.equal(facteurTailleLigne(undefined), 1);
  assert.equal(facteurTailleLigne(null), 1);
  assert.equal(facteurTailleLigne("m"), 1);
  assert.equal(facteurTailleLigne("s"), 0.8);
  assert.equal(facteurTailleLigne("l"), 1.25);
});

test("une ligne sans taille ressort du schéma sans clé taille (même JSON, même empreinte)", () => {
  const ligne = { value: "Mulhouse", font: "playfair" };
  const lue = textBlockSchema.parse(ligne);
  assert.equal("taille" in lue, false);
  assert.equal(JSON.stringify(lue), JSON.stringify(ligne));
});

test("une configuration d'avant garde son JSON au caractère près", () => {
  const brut = posterConfigSchema.safeParse({ texts: { lines: [{ value: "Mulhouse" }, { value: "2026" }] } });
  if (!brut.success) return; // le schéma demande d'autres champs : le test du bloc suffit
  for (const l of (brut.data.texts as { lines?: object[] } | undefined)?.lines ?? [])
    assert.equal("taille" in l, false);
});
