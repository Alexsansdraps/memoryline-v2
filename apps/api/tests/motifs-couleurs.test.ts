/**
 * L'affiche à motifs du stand de Mulhouse, réglages du 28/11 — sans base : la
 * palette des couleurs du motif (réglage « motifs.couleurs ») : lue,
 * assainie, servie dans la langue de la page. Le contrôle des lignes de
 * panier, lui, lit la base : motifs-couleurs-base.test.ts.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/motifs-couleurs.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COULEURS_MOTIFS_DE_BASE,
  couleursDuReglage,
  couleursPubliques,
  couleurSure,
  hexa6,
} from "../src/motifs-couleurs.js";

test("palette : dix couleurs de base, toutes activées, noms dans les sept langues", () => {
  assert.equal(COULEURS_MOTIFS_DE_BASE.length, 10);
  for (const c of COULEURS_MOTIFS_DE_BASE) {
    assert.match(c.hex, /^#[0-9A-F]{6}$/);
    assert.equal(c.actif, true);
    for (const l of ["en", "de", "it", "es", "ja", "zh"] as const) assert.ok(c.noms?.[l], `${c.id} sans ${l}`);
  }
  assert.equal(new Set(COULEURS_MOTIFS_DE_BASE.map((c) => c.id)).size, 10);
});

test("palette : réglage absent, vide ou illisible = les dix de base", () => {
  assert.equal(couleursDuReglage(undefined), COULEURS_MOTIFS_DE_BASE);
  assert.equal(couleursDuReglage([]), COULEURS_MOTIFS_DE_BASE);
  assert.equal(couleursDuReglage("rouge"), COULEURS_MOTIFS_DE_BASE);
  assert.equal(couleursDuReglage([{ nom: "", hex: "#zzz" }]), COULEURS_MOTIFS_DE_BASE);
});

test("palette : une couleur réglée est assainie (hex en capitales, id propre, doublons écartés)", () => {
  const lues = couleursDuReglage([
    { id: "Vert d'eau!", nom: "  Vert d'eau  ", hex: "#5f8f86", actif: true, noms: { en: "Sea green", de: "" } },
    { id: "vertdeau", nom: "Doublon", hex: "#000000" },
    { nom: "Sans id", hex: "#abc", actif: false },
    { nom: "Mauvaise couleur", hex: "rouge" },
  ]);
  assert.deepEqual(lues, [
    { id: "vertdeau", nom: "Vert d'eau", hex: "#5F8F86", actif: true, noms: { en: "Sea green" } },
    { id: "couleur-3", nom: "Sans id", hex: "#AABBCC", actif: false },
  ]);
  assert.equal(couleurSure(null), null);
  assert.equal(hexa6("#2b2b2b"), "#2B2B2B");
  assert.equal(hexa6("#FFF8EC00"), null);
});

test("palette publique : les activées seulement, le nom dans la langue (français à défaut)", () => {
  const liste = couleursDuReglage([
    { id: "a", nom: "Anthracite", hex: "#2B2B2B", noms: { en: "Charcoal" } },
    { id: "b", nom: "Bleu", hex: "#1B2A4A", actif: false },
    { id: "c", nom: "Crème", hex: "#F4ECDD" },
  ]);
  assert.deepEqual(couleursPubliques(liste, "en"), [
    { id: "a", nom: "Charcoal", hex: "#2B2B2B" },
    { id: "c", nom: "Crème", hex: "#F4ECDD" },
  ]);
  // Tout décoché : la première reste, le motif garde une couleur.
  const eteintes = liste.map((c) => ({ ...c, actif: false }));
  assert.deepEqual(couleursPubliques(eteintes, "fr"), [{ id: "a", nom: "Anthracite", hex: "#2B2B2B" }]);
});
