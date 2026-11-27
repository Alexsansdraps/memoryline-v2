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

test("villes : les villages aussi, avec leur département, et vite", async () => {
  const { chercherVilles } = await import("../src/ciel.ts");
  const r = chercherVilles("rimbach pres mase");
  assert.equal(r[0]?.nom, "Rimbach-près-Masevaux");
  assert.equal(r[0]?.region, "Haut-Rhin");
  const t0 = performance.now();
  for (const q of ["sa", "saint louis", "ungers", "lyon"]) chercherVilles(q);
  assert.ok(performance.now() - t0 < 1000);
});

test("thèmes : trois couleurs donnent tout le dégradé, « Nuit » retrouve les teintes d'origine", async () => {
  const { teintesDuTheme, themesDuReglage, THEMES_CIEL_DE_BASE, svgDuCiel } = await import("../src/ciel.ts");
  const nuit = teintesDuTheme(THEMES_CIEL_DE_BASE[0]!);
  // Le haut d'origine était #0b1424 : à deux unités près par canal.
  const proche = (a: string, b: string) =>
    [1, 3, 5].every((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= 3);
  assert.ok(proche(nuit.haut, "#0b1424"), nuit.haut);
  assert.ok(proche(nuit.collinePres, "#0a111e"), nuit.collinePres);
  // Réglage illisible ou vide : les thèmes de base ; couleurs invalides corrigées.
  assert.equal(themesDuReglage(null).length, THEMES_CIEL_DE_BASE.length);
  const lus = themesDuReglage([{ id: "x", nom: "Lavande", fond: "#8877aa", etoiles: "pas une couleur", dorures: "#ffffff" }]);
  assert.equal(lus[0]?.etoiles, THEMES_CIEL_DE_BASE[0]!.etoiles);
  // Le rendu porte bien la couleur choisie.
  assert.ok(svgDuCiel(47.75, 7.34, new Date(), lus[0]).includes("#8877aa"));
});

test("garde-fou : 120 créations par minute et par adresse passent, la 121e non ; deux compteurs ne se gênent pas (27/11)", async () => {
  const { compteurParMinute, CIELS_PAR_MINUTE } = await import("../src/ciel.ts");
  assert.equal(CIELS_PAR_MINUTE, 120);
  const ciels = compteurParMinute(CIELS_PAR_MINUTE);
  const apercus = compteurParMinute(CIELS_PAR_MINUTE);
  for (let i = 0; i < 120; i++) assert.equal(ciels("203.0.113.9"), false, `appel ${i + 1}`);
  assert.equal(ciels("203.0.113.9"), true, "le 121e est refusé");
  // Un autre compteur, ou une autre adresse : rien de partagé.
  assert.equal(apercus("203.0.113.9"), false);
  assert.equal(ciels("203.0.113.10"), false);
});
