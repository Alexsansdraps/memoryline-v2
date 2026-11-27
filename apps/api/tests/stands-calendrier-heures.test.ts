/**
 * La tablette d'un stand « calendrier » ferme 1 h après l'heure de fermeture
 * du calendrier (27/11 au soir, Alexandra : « il est 21 h 58 et le marché de
 * Noël de Mulhouse, il est ouvert selon calendrier, alors qu'il est censé
 * fermer à 21 h »). Sans base.
 *
 *   npx tsx --test tests/stands-calendrier-heures.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://essai:essai@127.0.0.1:1/essai";
const { ouvertAuxHeures } = await import("../src/stands-calendrier.ts");

const marche = {
  ouvert: false,
  pilotage: "calendrier",
  dateDebut: "2026-11-20",
  dateFin: "2026-12-27",
  horaires: { matin: { de: "11:00", a: "12:30" }, apresMidi: { de: "13:00", a: "21:00" } },
  archivedAt: null,
  actif: true,
};
// Heure de Paris en hiver = UTC + 1.
const a = (hhmm: string) => new Date(`2026-11-27T${hhmm}:00+01:00`);

test("ouvert pendant les horaires, et jusqu'à 1 h après la fermeture", () => {
  assert.equal(ouvertAuxHeures(marche, a("11:00")), true);
  assert.equal(ouvertAuxHeures(marche, a("12:45")), true, "pause de midi : la tablette reste ouverte");
  assert.equal(ouvertAuxHeures(marche, a("21:58")), true, "dans l'heure de marge");
  assert.equal(ouvertAuxHeures(marche, a("22:00")), false, "1 h après la fermeture");
  assert.equal(ouvertAuxHeures(marche, a("23:30")), false);
  assert.equal(ouvertAuxHeures(marche, a("10:30")), false, "avant l'ouverture");
});

test("hors des jours de marché, ou en manuel : la règle d'avant", () => {
  assert.equal(ouvertAuxHeures(marche, new Date("2026-12-28T15:00:00+01:00")), false);
  assert.equal(ouvertAuxHeures({ ...marche, pilotage: "manuel", ouvert: true }, a("23:30")), true);
});

test("un jour sans heure connue reste ouvert toute la journée", () => {
  const sansHeures = { ...marche, horaires: { matin: null, apresMidi: null } };
  assert.equal(ouvertAuxHeures(sansHeures, a("23:30")), true);
});
