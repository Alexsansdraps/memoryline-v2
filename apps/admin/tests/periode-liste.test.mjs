/**
 * La liste des commandes suit la période choisie dans les chiffres
 * (lib/periode-liste.ts, 26/11, Alexandra : « si je mets aujourd'hui ça doit
 * me sortir les commandes de aujourd'hui », « pareil avec 7 jours, 30 etc »).
 * Sans navigateur ni base.
 *
 * Lancés par : docker exec -w /app/apps/admin memoryline-admin node --test "tests/*.test.mjs"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PERIODES, PERIODE_PAR_DEFAUT, periodeDeLaListe } from "../src/lib/periode-liste.ts";

const p = (qs) => new URLSearchParams(qs);
// Le 26/11 à 14 h, heure de Paris (13 h en temps universel).
const MIDI = new Date("2026-11-26T13:00:00Z");

test("les quatre périodes des chiffres, 30 jours quand l'adresse n'en dit rien", () => {
  assert.deepEqual(PERIODES.map((x) => x.jours), [1, 7, 30, 90]);
  assert.equal(PERIODE_PAR_DEFAUT.jours, 30);
});

test("« Aujourd'hui » : la liste montre le jour même, à Paris", () => {
  const r = periodeDeLaListe(p("jours=1"), MIDI);
  assert.deepEqual(
    { from: r?.from, to: r?.to, jours: r?.jours },
    { from: "2026-11-26", to: "2026-11-26", jours: 1 },
  );
  assert.equal(r?.texte, "Commandes d'aujourd'hui (26 novembre)");
});

test("7, 30 et 90 jours : aujourd'hui compris, comme les chiffres", () => {
  assert.deepEqual(
    [7, 30, 90].map((n) => {
      const r = periodeDeLaListe(p(`jours=${n}`), MIDI);
      return [r?.from, r?.to];
    }),
    [
      ["2026-11-20", "2026-11-26"],
      ["2026-10-28", "2026-11-26"],
      ["2026-08-29", "2026-11-26"],
    ],
  );
  assert.equal(
    periodeDeLaListe(p("jours=7"), MIDI)?.texte,
    "Commandes des 7 derniers jours (du 20 au 26 novembre)",
  );
  assert.equal(
    periodeDeLaListe(p("jours=30"), MIDI)?.texte,
    "Commandes des 30 derniers jours (du 28 octobre au 26 novembre)",
  );
  assert.equal(
    periodeDeLaListe(p("jours=7"), new Date("2026-12-03T10:00:00Z"))?.texte,
    "Commandes des 7 derniers jours (du 27 novembre au 3 décembre)",
  );
  assert.equal(
    periodeDeLaListe(p("jours=7"), new Date("2026-12-07T10:00:00Z"))?.texte,
    "Commandes des 7 derniers jours (du 1er au 7 décembre)",
  );
});

test("après minuit à Paris, c'est déjà le jour suivant (23 h 30 en temps universel)", () => {
  const r = periodeDeLaListe(p("jours=1"), new Date("2026-11-26T23:30:00Z"));
  assert.equal(r?.from, "2026-11-27");
  assert.equal(r?.texte, "Commandes d'aujourd'hui (27 novembre)");
});

test("le passage à l'heure d'été ne saute ni ne double un jour", () => {
  const r = periodeDeLaListe(p("jours=7"), new Date("2026-03-30T10:00:00Z"));
  assert.deepEqual([r?.from, r?.to], ["2026-03-24", "2026-03-30"]);
});

test("le 1er du mois se dit « 1er », et l'année quand la période la change", () => {
  assert.equal(
    periodeDeLaListe(p("jours=1"), new Date("2026-12-01T10:00:00Z"))?.texte,
    "Commandes d'aujourd'hui (1er décembre)",
  );
  assert.equal(
    periodeDeLaListe(p("jours=7"), new Date("2027-01-03T10:00:00Z"))?.texte,
    "Commandes des 7 derniers jours (du 28 décembre 2026 au 3 janvier 2027)",
  );
});

test("rien de choisi, une période inconnue, ou des dates tapées : la liste ne suit pas", () => {
  for (const qs of ["", "jours=", "jours=5", "jours=abc", "q=SAL", "jours=1&from=2026-11-01", "jours=7&to=2026-11-20"])
    assert.equal(periodeDeLaListe(p(qs), MIDI), null, qs);
});
