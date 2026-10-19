/**
 * Les essais des nuanciers des personnages, sans base de données.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/nuanciers.test.ts
 *
 * Ils vérifient ce qui ne se voit pas à l'écran : qu'un nuancier de
 * catégorie (« categorie:robes ») survit au nettoyage des groupes ET des
 * familles d'un dessin, qu'une valeur inconnue en est écartée, qu'un nuancier
 * mal saisi est refusé, et que les couleurs d'origine reprennent la main sur
 * tout ce qui manque. Toutes les données sont factices.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NUANCIERS_PAR_DEFAUT,
  couleursDuNuancier,
  estNuancier,
  famillesDuDessin,
  groupesDuDessin,
  normaliserNuanciers,
  verifierNuancier,
} from "@memoryline/types";

test("« categorie:robes » survit au nettoyage des groupes et des familles", () => {
  const groupes = groupesDuDessin({ st0: "#E0AC7E", st1: "#333333" }, [
    { zone: "st0", nuancier: "categorie:robes" },
    { zone: "st1", nuancier: "peau" },
  ]);
  assert.equal(groupes[0]!.nuancier, "categorie:robes");
  assert.equal(groupes[1]!.nuancier, "peau");

  const familles = famillesDuDessin({
    familles: [
      { cle: "fam0", reference: "#8B5B38", part: 0.6, nuancier: "categorie:pelages-longs" },
      { cle: "fam1", reference: "#222222", part: 0.4, nuancier: "cheveux" },
    ],
  });
  assert.equal(familles[0]!.nuancier, "categorie:pelages-longs");
  assert.equal(familles[1]!.nuancier, "cheveux");
});

test("un nuancier inconnu est écarté sans bruit", () => {
  for (const v of ["inconnu", "categorie:", "categorie:Robes", "categorie:robes;drop", 12, null])
    assert.equal(estNuancier(v), false, String(v));
  const groupes = groupesDuDessin({ st0: "#E0AC7E" }, [{ zone: "st0", nuancier: "inconnu" }]);
  assert.equal(groupes[0]!.nuancier, undefined);
  const familles = famillesDuDessin({
    familles: [{ cle: "fam0", reference: "#8B5B38", part: 1, nuancier: "categorie:" }],
  });
  assert.equal(familles[0]!.nuancier, undefined);
});

test("un nuancier mal saisi est refusé, avec sa raison", () => {
  assert.equal(verifierNuancier([]).ok, false);
  assert.equal(verifierNuancier("#FFFFFF").ok, false);
  assert.equal(verifierNuancier(["#FFF"]).ok, false);
  assert.equal(verifierNuancier(["#FFFFFF", "#ffffff"]).ok, false);
  assert.equal(verifierNuancier(Array.from({ length: 25 }, (_, i) => `#0000${String(i).padStart(2, "0")}`)).ok, false);
  const bon = verifierNuancier(["#b8551d", "#FFFFFF"]);
  assert.deepEqual(bon, { ok: true, couleurs: ["#B8551D", "#FFFFFF"] });
});

test("fusion : le réglage de la boutique, sinon les couleurs d'origine, nuancier par nuancier", () => {
  const vide = normaliserNuanciers(null);
  assert.deepEqual(vide.peau, [...NUANCIERS_PAR_DEFAUT.peau]);
  assert.deepEqual(vide.pantalon, [...NUANCIERS_PAR_DEFAUT.pantalon]);

  const regle = normaliserNuanciers({ peau: ["#123456", "#ABCDEF"], cheveux: "abîmé" });
  assert.deepEqual(regle.peau, ["#123456", "#ABCDEF"]);
  assert.deepEqual(regle.cheveux, [...NUANCIERS_PAR_DEFAUT.cheveux]);
  assert.deepEqual(regle.vetements, [...NUANCIERS_PAR_DEFAUT.vetements]);
});

test("les couleurs d'origine sont celles que le configurateur avait en dur", () => {
  // Le premier et le dernier ton de chacun, relus sur l'ancien code (store.ts).
  assert.equal(NUANCIERS_PAR_DEFAUT.peau[0], "#FFEEE0");
  assert.equal(NUANCIERS_PAR_DEFAUT.peau[5], "#8B5B38");
  assert.equal(NUANCIERS_PAR_DEFAUT.cheveux.length, 9);
  assert.equal(NUANCIERS_PAR_DEFAUT.vetements[0], "#FAFAFA");
  assert.equal(NUANCIERS_PAR_DEFAUT.pantalon[3], "#165176");
});

test("le nuancier d'une couleur : base, catégorie, ou repli du groupe", () => {
  const base = { peau: ["#111111"] };
  const categories = [
    { slug: "robes", colors: ["#AA0000", "#00AA00"] },
    { slug: "vide", colors: [] },
  ];
  assert.deepEqual(couleursDuNuancier("peau", "cheveux", base, categories), ["#111111"]);
  assert.deepEqual(couleursDuNuancier("categorie:robes", "peau", base, categories), ["#AA0000", "#00AA00"]);
  // Catégorie absente ou sans couleur : le nuancier du groupe.
  assert.deepEqual(couleursDuNuancier("categorie:archivee", "peau", base, categories), ["#111111"]);
  assert.deepEqual(couleursDuNuancier("categorie:vide", "cheveux", base, categories), [...NUANCIERS_PAR_DEFAUT.cheveux]);
  // Rien de réglé : la couleur garde le repli de son groupe.
  assert.deepEqual(couleursDuNuancier(undefined, "vetements", null, null), [...NUANCIERS_PAR_DEFAUT.vetements]);
});
