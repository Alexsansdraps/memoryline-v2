/**
 * Une bannière par langue et par page (20/11, Alexandra : « si on décide
 * rien, c'est la bannière par défaut qui prime […] faut pas que ça change
 * actuellement »). Le plus précis l'emporte : la langue d'abord, puis la page.
 *
 *   npx tsx --test tests/bandeaux-langues.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PAGE_ACCUEIL,
  PAGE_PARTOUT,
  PAGE_TOUS_LES_RAYONS,
  bandeauxDeLaPage,
  normaliserBandeau,
  nouveauBandeau,
  pageLibre,
  pageRayon,
} from "../../../packages/types/src/index.ts";

const maintenant = new Date("2026-11-20T15:00:00Z");

function bandeau(id: string, pages: string[], langues: string[] = []) {
  return { ...nouveauBandeau(id), image: `/assets/${id}.png`, pages, langues };
}
const ids = (l: { id: string }[]) => l.map((b) => b.id);

test("aujourd'hui (la bannière de Margaux, accueil, toutes langues) : rien ne change", () => {
  const liste = [bandeau("margaux", [PAGE_ACCUEIL])];
  for (const langue of ["fr", "en", "de", "it", "es", "ja", "zh"]) {
    assert.deepEqual(ids(bandeauxDeLaPage(liste, [PAGE_ACCUEIL], maintenant, langue)), ["margaux"]);
    assert.deepEqual(ids(bandeauxDeLaPage(liste, [], maintenant, langue)), []);
    assert.deepEqual(ids(bandeauxDeLaPage(liste, [pageLibre("mulhouse")], maintenant, langue)), []);
  }
  // Sans langue précisée : le français, comme avant.
  assert.deepEqual(ids(bandeauxDeLaPage(liste, [PAGE_ACCUEIL], maintenant)), ["margaux"]);
});

test("un bandeau réservé à l'anglais remplace celui par défaut, en anglais seulement", () => {
  const liste = [bandeau("margaux", [PAGE_ACCUEIL]), bandeau("anglais", [PAGE_ACCUEIL], ["en"])];
  assert.deepEqual(ids(bandeauxDeLaPage(liste, [PAGE_ACCUEIL], maintenant, "en")), ["anglais"]);
  assert.deepEqual(ids(bandeauxDeLaPage(liste, [PAGE_ACCUEIL], maintenant, "fr")), ["margaux"]);
  assert.deepEqual(ids(bandeauxDeLaPage(liste, [PAGE_ACCUEIL], maintenant, "de")), ["margaux"]);
});

test("la langue passe avant la page : un anglais « partout » remplace l'image française de l'accueil", () => {
  const liste = [bandeau("margaux", [PAGE_ACCUEIL]), bandeau("anglais", [PAGE_PARTOUT], ["en"])];
  assert.deepEqual(ids(bandeauxDeLaPage(liste, [PAGE_ACCUEIL], maintenant, "en")), ["anglais"]);
  assert.deepEqual(ids(bandeauxDeLaPage(liste, [], maintenant, "en")), ["anglais"]);
  assert.deepEqual(ids(bandeauxDeLaPage(liste, [PAGE_ACCUEIL], maintenant, "fr")), ["margaux"]);
  assert.deepEqual(ids(bandeauxDeLaPage(liste, [], maintenant, "fr")), []);
});

test("une page précise remplace « Toutes les pages du site », qui reste ailleurs", () => {
  const liste = [bandeau("defaut", [PAGE_PARTOUT]), bandeau("mulhouse", [pageLibre("mulhouse")])];
  assert.deepEqual(ids(bandeauxDeLaPage(liste, [pageLibre("mulhouse")], maintenant, "fr")), ["mulhouse"]);
  assert.deepEqual(ids(bandeauxDeLaPage(liste, [PAGE_ACCUEIL], maintenant, "fr")), ["defaut"]);
  assert.deepEqual(ids(bandeauxDeLaPage(liste, [], maintenant, "fr")), ["defaut"]);
});

test("un rayon précis passe avant « tous les rayons »", () => {
  const liste = [bandeau("rayons", [PAGE_TOUS_LES_RAYONS]), bandeau("villes", [pageRayon("villes")])];
  const cles = [pageRayon("villes"), PAGE_TOUS_LES_RAYONS];
  assert.deepEqual(ids(bandeauxDeLaPage(liste, cles, maintenant, "fr")), ["villes"]);
  assert.deepEqual(
    ids(bandeauxDeLaPage(liste, [pageRayon("noel"), PAGE_TOUS_LES_RAYONS], maintenant, "fr")),
    ["rayons"],
  );
});

test("des bandeaux aussi précis s'affichent tous, dans l'ordre de la liste", () => {
  const liste = [bandeau("a", [PAGE_ACCUEIL]), bandeau("b", [PAGE_ACCUEIL])];
  assert.deepEqual(ids(bandeauxDeLaPage(liste, [PAGE_ACCUEIL], maintenant, "fr")), ["a", "b"]);
});

test("un bandeau réservé éteint ou fini ne remplace rien", () => {
  const eteint = { ...bandeau("anglais", [PAGE_ACCUEIL], ["en"]), actif: false };
  const liste = [bandeau("margaux", [PAGE_ACCUEIL]), eteint];
  assert.deepEqual(ids(bandeauxDeLaPage(liste, [PAGE_ACCUEIL], maintenant, "en")), ["margaux"]);
});

test("les langues lues : connues seulement, sans doublon ; toutes cochées = toutes", () => {
  const lu = (langues: unknown) => normaliserBandeau({ id: "x", image: "/i.png", langues })?.langues;
  assert.deepEqual(lu(undefined), []);
  assert.deepEqual(lu(["en", "en", "xx", 3, "ja"]), ["en", "ja"]);
  assert.deepEqual(lu(["fr", "en", "de", "it", "es", "ja", "zh"]), []);
  // Un bandeau enregistré avant le 20/11 n'a pas de langues : toutes.
  assert.deepEqual(normaliserBandeau({ id: "ancien", image: "/i.png", pages: [PAGE_ACCUEIL] })?.langues, []);
});
