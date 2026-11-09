/**
 * La case « C'est une ombre » sur une pièce dessinée EN PIXELS, sans base de
 * données.
 *
 *   npx tsx --test tests/ombres-pixels.test.ts
 *
 * Margaux, 9 novembre 2026 : ses vestes et manteaux sont des images collées
 * dans un SVG. La lecture de l'image a fait de leur ombre la plus sombre une
 * famille à part : la veste 517 passée au rouge gardait des ombres beiges, et
 * le client avait deux rangées de pastilles. Les familles ci-dessous sont
 * celles de la prod (517, 508, 512).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  familleASuivre,
  famillesDuDessin,
  planDeRecoloration,
  rattacherFamille,
  separerTeinte,
  type FamilleCouleur,
} from "@memoryline/types";

/** « female 3 manteau » (517) : le manteau et son ombre, lue à part. */
const manteau517: FamilleCouleur[] = [
  { cle: "fam0", reference: "#B0917E", part: 0.936, proposee: true },
  { cle: "fam1", reference: "#937867", part: 0.064, proposee: true },
];

/** « boy 1 marinière » (508) : bleu nuit, blanc, et le gris des plis du blanc. */
const mariniere508: FamilleCouleur[] = [
  { cle: "fam0", reference: "#204887", teintes: ["#6882A8"], part: 0.518 },
  { cle: "fam1", reference: "#ECE8E6", part: 0.321 },
  { cle: "fam2", reference: "#CBC9CB", part: 0.161 },
];

test("l'ombre du manteau suit le manteau", () => {
  assert.equal(familleASuivre(manteau517, "fam1")?.cle, "fam0");
});

test("le gris des plis suit le blanc, pas le bleu nuit", () => {
  assert.equal(familleASuivre(mariniere508, "fam2")?.cle, "fam1");
});

test("une famille seule n'a rien à suivre", () => {
  assert.equal(familleASuivre([manteau517[0]!], "fam0"), undefined);
  assert.equal(rattacherFamille([manteau517[0]!], "fam0"), null);
});

test("rattacher : une rangée de moins, la teinte et la part passent à la famille suivie", () => {
  const r = rattacherFamille(manteau517, "fam1");
  assert.ok(r);
  assert.deepEqual(
    r.familles.map((f) => f.cle),
    ["fam0"],
  );
  assert.deepEqual(r.suivie.teintes, ["#937867"]);
  assert.equal(r.suivie.part, 1);
  assert.equal(r.suivie.proposee, true);
  // L'original n'a pas bougé : l'écran peut reprendre son état enregistré.
  assert.equal(manteau517.length, 2);
});

test("rattacher garde les teintes déjà réunies, celles de la suivie comme celles de l'ombre", () => {
  const r = rattacherFamille(
    [
      { cle: "fam0", reference: "#C08850", teintes: ["#A36C3D"], part: 0.8 },
      { cle: "fam3", reference: "#7A5030", teintes: ["#6A4426"], part: 0.2 },
    ],
    "fam3",
  );
  assert.deepEqual(r?.suivie.teintes, ["#A36C3D", "#7A5030", "#6A4426"]);
});

test("`vers` impose la famille suivie", () => {
  const r = rattacherFamille(mariniere508, "fam2", "fam0");
  assert.equal(r?.suivie.cle, "fam0");
  assert.deepEqual(r?.suivie.teintes, ["#6882A8", "#CBC9CB"]);
  assert.equal(rattacherFamille(mariniere508, "fam2", "fam2"), null);
  assert.equal(rattacherFamille(mariniere508, "fam2", "fam9"), null);
});

test("après rattachement, l'ombre est recolorée avec le manteau (elle restait beige)", () => {
  const avant = planDeRecoloration({ familles: manteau517 }, { fam0: "#C41616" });
  assert.ok(avant);
  // Deux teintes : le manteau bouge, son ombre non.
  assert.equal(avant.transformations.length, 2);
  assert.notEqual(avant.transformations[0], null);
  assert.equal(avant.transformations[1], null);

  const r = rattacherFamille(manteau517, "fam1")!;
  const apres = planDeRecoloration({ familles: r.familles }, { fam0: "#C41616" });
  assert.ok(apres);
  assert.equal(apres.transformations.length, 2);
  assert.ok(apres.transformations.every((t) => t !== null));
  // La même transformation, calculée depuis la référence : l'ombre garde son
  // écart et reste plus sombre que le manteau.
  assert.deepEqual(apres.transformations[1], apres.transformations[0]);
});

test("séparer : la teinte redevient une partie, juste après, avec sa part et une clé neuve", () => {
  const rattache = rattacherFamille(manteau517, "fam1")!.familles;
  const r = separerTeinte(rattache, "fam0", "#937867", 0.064);
  assert.ok(r);
  assert.deepEqual(
    r.familles.map((f) => f.cle),
    ["fam0", "fam1"],
  );
  assert.equal(r.separee.reference, "#937867");
  assert.equal(r.separee.part, 0.064);
  assert.equal(r.familles[0]!.teintes, undefined);
  assert.ok(Math.abs(r.familles[0]!.part - 0.936) < 1e-9);
});

test("séparer prend une clé au-delà de toutes les autres", () => {
  const r = separerTeinte(
    [
      { cle: "fam0", reference: "#204887", teintes: ["#6882A8", "#CBC9CB"], part: 0.68 },
      { cle: "fam1", reference: "#ECE8E6", part: 0.32 },
    ],
    "fam0",
    "#cbc9cb",
    0.16,
  );
  assert.equal(r?.separee.cle, "fam2");
  assert.deepEqual(r?.familles[0]!.teintes, ["#6882A8"]);
  // Une famille de fam0 à fam1 : la séparée vient après fam0, avant fam1.
  assert.deepEqual(
    r?.familles.map((f) => f.cle),
    ["fam0", "fam2", "fam1"],
  );
});

test("séparer une teinte qui n'est pas rattachée ne fait rien", () => {
  assert.equal(separerTeinte(manteau517, "fam0", "#937867"), null);
  assert.equal(separerTeinte(manteau517, "fam7", "#937867"), null);
});

test("une part mesurée trop grande ou illisible reste dans les bornes", () => {
  const rattache = rattacherFamille(manteau517, "fam1")!.familles;
  assert.equal(separerTeinte(rattache, "fam0", "#937867", 5)?.separee.part, 1);
  assert.equal(separerTeinte(rattache, "fam0", "#937867", Number.NaN)?.separee.part, 0);
});

test("le résultat se relit tel quel (ce que l'API enregistre)", () => {
  const r = rattacherFamille(mariniere508, "fam2")!;
  assert.deepEqual(famillesDuDessin({ familles: r.familles }), r.familles);
});
