/**
 * Le ciel étoilé (26/11) : le calcul astronomique et le fuseau. Sans base.
 *
 *   npx tsx --test tests/ciel.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://essai:essai@127.0.0.1:1/essai";
const { tempsSideralGreenwich, horizontales, instantLocal, surLaCarte } = await import("../src/ciel.ts");

test("temps sidéral de Greenwich : exemple 12.a de Meeus (10/04/1987 0 h TU → 197,6932°)", () => {
  assert.ok(Math.abs(tempsSideralGreenwich(new Date(Date.UTC(1987, 3, 10))) - 197.693195) < 0.001);
});

test("l'étoile Polaire est à la hauteur de la latitude, au nord, à toute heure", () => {
  for (const h of [0, 7, 15, 22]) {
    const p = horizontales(37.95, 89.26, 47.75, 7.34, new Date(Date.UTC(2026, 11, 24, h)));
    assert.ok(Math.abs(p.hauteur - 47.75) < 1, `hauteur ${p.hauteur}`);
    assert.ok(p.azimut < 2 || p.azimut > 358, `azimut ${p.azimut}`);
  }
});

test("Orion au sud vers minuit fin décembre à Mulhouse ; sous l'horizon un midi de juin", () => {
  // Bételgeuse : α 88,79°, δ +7,41°.
  const hiver = horizontales(88.79, 7.41, 47.75, 7.34, instantLocal("2026-12-25", "00:30", "Europe/Paris")!);
  assert.ok(hiver.hauteur > 40 && hiver.azimut > 150 && hiver.azimut < 210, JSON.stringify(hiver));
  const ete = horizontales(88.79, 7.41, 47.75, 7.34, instantLocal("2026-06-21", "23:00", "Europe/Paris")!);
  assert.ok(ete.hauteur < 0);
});

test("heure locale → temps universel, heure d'hiver et d'été", () => {
  assert.equal(instantLocal("2026-12-25", "21:30", "Europe/Paris")!.toISOString(), "2026-12-25T20:30:00.000Z");
  assert.equal(instantLocal("2026-07-14", "23:00", "Europe/Paris")!.toISOString(), "2026-07-14T21:00:00.000Z");
  assert.equal(instantLocal("2026-07-14", "23:00", "America/New_York")!.toISOString(), "2026-07-15T03:00:00.000Z");
  assert.equal(instantLocal("2026-13-01", "10:00", "Europe/Paris"), null);
  assert.equal(instantLocal("2026-01-01", "10:00", "Pas/Un_Fuseau"), null);
});

test("carte : zénith au centre, horizon au bord, nord en haut, est à gauche", () => {
  assert.deepEqual(surLaCarte(90, 0), { x: -0, y: -0 });
  const nord = surLaCarte(0, 0)!;
  assert.ok(Math.abs(nord.y + 1) < 1e-9 && Math.abs(nord.x) < 1e-9);
  const est = surLaCarte(0, 90)!;
  assert.ok(Math.abs(est.x + 1) < 1e-9);
  assert.equal(surLaCarte(-1, 0), null);
});

test("villes : on tape le nom, avec ou sans accents, en français ou non", async () => {
  const { chercherVilles } = await import("../src/ciel.ts");
  const mulh = chercherVilles("mulh");
  assert.equal(mulh[0]?.nom, "Mulhouse");
  assert.equal(mulh[0]?.fuseau, "Europe/Paris");
  assert.equal(chercherVilles("Bâle")[0]?.nom, "Basel");
  assert.equal(chercherVilles("londres")[0]?.nom, "London");
  assert.equal(chercherVilles("saint-louis").some((v) => v.pays === "FR"), true);
  assert.equal(chercherVilles("thann")[0]?.pays, "FR");
  assert.deepEqual(chercherVilles("m"), []);
});
