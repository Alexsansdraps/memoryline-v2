/**
 * « Toutes les pages du site » pour un bandeau visuel (19/11, Alexandra : « la
 * bannière doit être affichée sur chaque page »).
 *
 *   npx tsx --test tests/bandeaux-partout.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PAGE_ACCUEIL,
  PAGE_PARTOUT,
  bandeauxDeLaPage,
  nouveauBandeau,
  pageLibre,
  pageRayon,
} from "../../../packages/types/src/index.ts";

const maintenant = new Date("2026-11-19T18:00:00Z");

function bandeau(id: string, pages: string[]) {
  return { ...nouveauBandeau(id), image: "/assets/noel.png", pages };
}

test("un bandeau « partout » s'affiche sur toute page, même sans clé (fiche, recherche…)", () => {
  const liste = [bandeau("noel", [PAGE_ACCUEIL, PAGE_PARTOUT])];
  assert.equal(bandeauxDeLaPage(liste, [], maintenant).length, 1);
  assert.equal(bandeauxDeLaPage(liste, [PAGE_ACCUEIL], maintenant).length, 1);
  assert.equal(bandeauxDeLaPage(liste, [pageRayon("villes")], maintenant).length, 1);
  assert.equal(bandeauxDeLaPage(liste, [pageLibre("mulhouse")], maintenant).length, 1);
});

test("un bandeau de l'accueil seul reste sur l'accueil", () => {
  const liste = [bandeau("accueil", [PAGE_ACCUEIL])];
  assert.equal(bandeauxDeLaPage(liste, [PAGE_ACCUEIL], maintenant).length, 1);
  assert.equal(bandeauxDeLaPage(liste, [], maintenant).length, 0);
  assert.equal(bandeauxDeLaPage(liste, [pageRayon("villes")], maintenant).length, 0);
});

test("« partout » respecte toujours l'interrupteur et les dates", () => {
  const eteint = { ...bandeau("eteint", [PAGE_PARTOUT]), actif: false };
  const fini = { ...bandeau("fini", [PAGE_PARTOUT]), fin: "2026-11-01T00:00:00Z" };
  assert.equal(bandeauxDeLaPage([eteint, fini], [], maintenant).length, 0);
});
