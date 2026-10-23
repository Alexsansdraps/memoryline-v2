/**
 * Le titre et la description qu'une fiche donne à Google
 * (packages/types/src/textes-seo.ts, referencementDeFiche) : la même recette
 * pour la fiche du site et pour l'aperçu Google du back-office
 * (AUDIT-SEO.md, CNT-3).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TEXTES_REFERENCEMENT_FR,
  referencementDeFiche,
} from "../../../packages/types/src/textes-seo.ts";
import { ui } from "../../web/src/i18n/ui.ts";

test("les phrases françaises du back-office sont celles du site, mot pour mot", () => {
  const fr = ui.fr as Record<string, string>;
  assert.equal(TEXTES_REFERENCEMENT_FR.naturePersonnalisable, fr["seo.nature.personnalisable"]);
  assert.equal(TEXTES_REFERENCEMENT_FR.naturePrete, fr["seo.nature.prete_a_imprimer"]);
  assert.equal(TEXTES_REFERENCEMENT_FR.reprisPersonnalisable, fr["produit.meta_repli.personnalisable"]);
  assert.equal(TEXTES_REFERENCEMENT_FR.reprisPrete, fr["produit.meta_repli.prete_a_imprimer"]);
  assert.equal(TEXTES_REFERENCEMENT_FR.introIa, fr["ia.intro"]);
});

test("sans champs SEO : nom court, nature et marque ; description tirée du texte", () => {
  const r = referencementDeFiche({
    name: "VIEUX MOULIN - Affiche personnalisée",
    kind: "personnalisable",
    description: "<p>Un village de l'Oise.<br>Personnalisez vos personnages.</p>",
  });
  assert.equal(r.titre, "VIEUX MOULIN – Affiche personnalisée | Memory Line");
  assert.equal(r.description, "Un village de l'Oise. Personnalisez vos personnages.");
});

test("sans texte : la phrase de repli, avec le nom court", () => {
  const r = referencementDeFiche({ name: "LE HAVRE - Affiche personnalisée", kind: "personnalisable", description: "<p><img src=\"x.jpg\"></p>" });
  assert.match(r.description, /^LE HAVRE : affiche personnalisée à composer en ligne\./);
});

test("champs SEO saisis : le séparateur du site, la description ramenée à 155 caractères", () => {
  const r = referencementDeFiche({
    name: "AULT",
    kind: "personnalisable",
    seoTitle: "AULT - Affiche personnalisée – Memory Line",
    seoDescription: "Une phrase. ".repeat(20),
  });
  assert.equal(r.titre, "AULT – Affiche personnalisée | Memory Line");
  assert.ok(r.description.length <= 155);
});

test("un nom qui dit déjà « affiche » ne répète pas la nature", () => {
  const r = referencementDeFiche({ name: "Affiche à partir de votre photo", kind: "personnalisable", aiEnabled: true });
  assert.equal(r.titre, "Affiche à partir de votre photo | Memory Line");
  assert.equal(r.description, TEXTES_REFERENCEMENT_FR.introIa);
});
