/**
 * Les essais de la suppression définitive du catalogue, sans base de données.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/suppression-catalogue.test.ts
 *
 * Ils vérifient les parties pures de suppression-catalogue.ts : la phrase qui
 * énumère ce qui retient un élément, et la lecture des rangées d'une page —
 * c'est elle qui dit si une collection ou une catégorie sert encore, alors
 * qu'aucune clé étrangère ne la protège. Toutes les données sont factices.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  enumerer,
  pageCite,
  phraseCommandes,
} from "../src/suppression-catalogue.js";
import type { BlocPage } from "../src/db/schema.js";

test("enumerer : un, deux, trois noms, puis « et N autres »", () => {
  assert.equal(enumerer([]), "");
  assert.equal(enumerer(["Villes"]), "« Villes »");
  assert.equal(enumerer(["Villes", "Mer"]), "« Villes » et « Mer »");
  assert.equal(enumerer(["A", "B", "C"]), "« A », « B » et « C »");
  // Le total compte ce qu'on n'a pas relu : seuls trois noms sont cités.
  assert.equal(enumerer(["A", "B", "C"], 4), "« A », « B », « C » et 1 autre");
  assert.equal(enumerer(["A", "B", "C", "D", "E"], 12), "« A », « B », « C » et 9 autres");
  assert.equal(enumerer(["WEB-1042", "SAL-0087"], 2, false), "WEB-1042 et SAL-0087");
});

test("phraseCommandes : cite les numéros et dit que l'affiche reste archivée", () => {
  const p = phraseCommandes(["WEB-1042"], 1);
  assert.match(p, /^Des commandes portent cette affiche : WEB-1042\./);
  assert.match(p, /elle reste archivée\.$/);
  assert.match(phraseCommandes(["WEB-1", "WEB-2", "WEB-3"], 7), /WEB-1, WEB-2, WEB-3 et 4 autres\./);
  // Les paniers sont comptés, jamais cités par leur uuid.
  assert.match(phraseCommandes(["WEB-1"], 1, 48), /: WEB-1, sans compter 48 paniers non payés\./);
  assert.match(phraseCommandes([], 0, 1), /: 1 panier non payé\./);
});

const rangee = (
  source: "collection" | "categorie",
  reference: string,
  references?: string[],
): BlocPage => ({ type: "produits", source, reference, references, limite: 8 });

test("pageCite : une rangée cite la collection par son adresse, sans tenir compte de la casse", () => {
  const page = { blocks: [{ type: "titre", texte: "Nos villes", niveau: 2 } as BlocPage, rangee("collection", "Villes")] };
  assert.equal(pageCite(page, "collection", "villes"), true);
  assert.equal(pageCite(page, "collection", "mer"), false);
  // Même adresse, autre nature : une catégorie ne se confond pas avec une collection.
  assert.equal(pageCite(page, "categorie", "villes"), false);
});

test("pageCite : `references` fait foi quand il est là, `reference` seule sinon", () => {
  const plusieurs = { blocks: [rangee("collection", "villes", ["villes", "balades-paysages"])] };
  assert.equal(pageCite(plusieurs, "collection", "balades-paysages"), true);
  // `reference` recopie la première : une liste qui ne la contient plus l'emporte.
  const retiree = { blocks: [rangee("collection", "villes", ["mer"])] };
  assert.equal(pageCite(retiree, "collection", "villes"), false);
  const ancienne = { blocks: [rangee("collection", "villes", [])] };
  assert.equal(pageCite(ancienne, "collection", "villes"), true);
});

test("pageCite : les rangées des traductions comptent aussi ; une catégorie se cite par son numéro", () => {
  const page = {
    blocks: [] as BlocPage[],
    translations: { en: { blocks: [rangee("categorie", "12")] }, de: {} },
  };
  assert.equal(pageCite(page, "categorie", "12"), true);
  assert.equal(pageCite(page, "categorie", "1"), false);
  assert.equal(pageCite({ blocks: null, translations: null }, "collection", "villes"), false);
});
