/**
 * Les horaires dictés en une phrase (17/11) : ce que l'IA rend est relu par
 * les mêmes règles que la saisie à la main. Le service est simulé : on
 * vérifie la lecture de sa réponse, pas sa compréhension du français.
 *
 *   npx tsx --test tests/stand-horaires-ia.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EchecHorairesIa, horairesDepuisTexte } from "../src/stand-horaires-ia.js";

const actuel = { dateDebut: null, dateFin: null, horaires: null };

function repondre(contenu: unknown) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(contenu) } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

test("la réponse de l'IA devient un calendrier vérifié", async () => {
  process.env.OPENAI_API_KEY = "cle-de-test";
  repondre({
    dateDebut: "2026-11-20",
    dateFin: "2026-12-27",
    matin: { de: "11:00", a: "12:30" },
    apresMidi: { de: "13:00", a: "20:00" },
    jours: [
      { date: "2026-11-23", ferme: true },
      { date: "2026-12-24", matin: { de: "11:00", a: "12:30" }, apresMidi: { de: "13:00", a: "16:00" } },
      { date: "2026-12-25", ferme: true },
      { date: "2027-03-01", ferme: true },
    ],
  });
  const r = await horairesDepuisTexte("fermé les lundis…", actuel, "2026-11-17");
  assert.equal(r.dateDebut, "2026-11-20");
  assert.equal(r.dateFin, "2026-12-27");
  assert.deepEqual(r.horaires.jours?.["2026-11-23"], { ferme: true });
  assert.deepEqual(r.horaires.jours?.["2026-12-24"]?.apresMidi, { de: "13:00", a: "16:00" });
  assert.equal(r.horaires.jours?.["2027-03-01"], undefined, "hors des dates : oublié");
});

test("une réponse impossible est refusée, jamais enregistrée", async () => {
  process.env.OPENAI_API_KEY = "cle-de-test";
  repondre({ dateDebut: "2026-12-27", dateFin: "2026-11-20", matin: null, apresMidi: null, jours: [] });
  await assert.rejects(horairesDepuisTexte("…", actuel, "2026-11-17"), EchecHorairesIa);
  repondre({ dateDebut: "2026-11-20", dateFin: "2026-12-27", matin: { de: "14:00", a: "10:00" }, apresMidi: null, jours: [] });
  await assert.rejects(horairesDepuisTexte("…", actuel, "2026-11-17"), /horaire impossible/);
});

test("sans clé ni phrase : une phrase claire", async () => {
  delete process.env.OPENAI_API_KEY;
  await assert.rejects(horairesDepuisTexte("fermé les lundis", actuel, "2026-11-17"), /OPENAI_API_KEY/);
  process.env.OPENAI_API_KEY = "cle-de-test";
  await assert.rejects(horairesDepuisTexte("   ", actuel, "2026-11-17"), /Écrivez d'abord/);
});

test("non-stop : toujours un seul créneau, dans le matin (17/11)", async () => {
  process.env.OPENAI_API_KEY = "cle-de-test";
  repondre({
    dateDebut: "2026-11-20",
    dateFin: "2026-12-27",
    // Base rendue en deux créneaux qui se touchent : une journée continue.
    matin: { de: "11:00", a: "13:00" },
    apresMidi: { de: "13:00", a: "20:00" },
    jours: [
      // Un non-stop rendu tout entier dans l'après-midi.
      { date: "2026-11-21", matin: null, apresMidi: { de: "10:00", a: "21:00" } },
      // Un vrai « fermé le matin » reste tel quel.
      { date: "2026-11-22", matin: null, apresMidi: { de: "14:00", a: "19:00" } },
      // Le format attendu passe sans changement.
      { date: "2026-11-28", matin: { de: "10:00", a: "21:00" }, apresMidi: null },
    ],
  });
  const r = await horairesDepuisTexte("tout en non-stop", actuel, "2026-11-17");
  assert.deepEqual(r.horaires.matin, { de: "11:00", a: "20:00" });
  assert.equal(r.horaires.apresMidi, null);
  assert.deepEqual(r.horaires.jours?.["2026-11-21"], { matin: { de: "10:00", a: "21:00" }, apresMidi: null });
  assert.deepEqual(r.horaires.jours?.["2026-11-22"], { matin: null, apresMidi: { de: "14:00", a: "19:00" } });
  assert.deepEqual(r.horaires.jours?.["2026-11-28"], { matin: { de: "10:00", a: "21:00" }, apresMidi: null });
});
