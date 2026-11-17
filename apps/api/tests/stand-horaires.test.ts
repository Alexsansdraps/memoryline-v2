/**
 * Le calendrier des stands (17/11) : dates, horaires, jours de fermeture,
 * ouverture automatique et manuelle, retrait proposé sur le site.
 *
 *   npx tsx --test tests/stand-horaires.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dernierMomentDeRetrait,
  horairesDuJour,
  horairesLus,
  joursDuStand,
  ouvertureEffective,
  resumeHoraires,
  retraitProposable,
  type StandCalendrier,
} from "@memoryline/types";

/** Midi à Paris, ce jour-là. */
const midi = (jour: string) => new Date(`${jour}T11:00:00Z`);

const marche: StandCalendrier = {
  ouvert: false,
  pilotage: "calendrier",
  dateDebut: "2026-11-20",
  dateFin: "2026-12-24",
  horaires: {
    matin: { de: "10:00", a: "12:30" },
    apresMidi: { de: "14:00", a: "19:00" },
    jours: {
      "2026-11-23": { ferme: true },
      "2026-11-21": { matin: { de: "10:00", a: "13:00" }, apresMidi: { de: "14:00", a: "20:00" } },
    },
  },
};

test("les jours du stand, du premier au dernier compris", () => {
  const j = joursDuStand("2026-11-20", "2026-11-24");
  assert.deepEqual(j, ["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24"]);
  assert.deepEqual(joursDuStand("2026-11-24", "2026-11-20"), []);
  assert.deepEqual(joursDuStand(null, "2026-11-20"), []);
});

test("un jour suit l'horaire de base, sauf fermeture ou horaire à lui", () => {
  assert.deepEqual(horairesDuJour(marche.horaires, "2026-11-22").creneaux, [
    { de: "10:00", a: "12:30" },
    { de: "14:00", a: "19:00" },
  ]);
  assert.equal(horairesDuJour(marche.horaires, "2026-11-23").ferme, true);
  assert.deepEqual(horairesDuJour(marche.horaires, "2026-11-21").creneaux[1], { de: "14:00", a: "20:00" });
});

test("calendrier : ouvert toute la journée des jours de marché, fermé ailleurs", () => {
  assert.equal(ouvertureEffective(marche, midi("2026-11-20")), true);
  assert.equal(ouvertureEffective(marche, new Date("2026-11-20T21:30:00Z")), true, "22 h 30 à Paris, même jour");
  assert.equal(ouvertureEffective(marche, midi("2026-11-23")), false, "jour de fermeture");
  assert.equal(ouvertureEffective(marche, midi("2026-11-19")), false, "avant le premier jour");
  assert.equal(ouvertureEffective(marche, midi("2026-12-25")), false, "après le dernier");
});

test("manuel : le bouton décide, quoi que disent les horaires", () => {
  const fermeALaMain = { ...marche, pilotage: "manuel", ouvert: false };
  assert.equal(ouvertureEffective(fermeALaMain, midi("2026-11-20")), false);
  const ouvertALaMain = { ...marche, pilotage: "manuel", ouvert: true };
  assert.equal(ouvertureEffective(ouvertALaMain, midi("2026-11-23")), true);
  assert.equal(ouvertureEffective({ ...ouvertALaMain, archivedAt: new Date() }, midi("2026-11-20")), false);
});

test("retrait proposé jusqu'à la fermeture du dernier jour, ouvert ou fermé ; pas s'il est désactivé", () => {
  assert.equal(retraitProposable(marche, midi("2026-11-17")), true, "avant le premier jour");
  assert.equal(retraitProposable(marche, midi("2026-11-23")), true, "un jour de fermeture");
  // 17/11 : « ça peut être préparé le jour même » : plus de marge de 3 jours.
  assert.equal(retraitProposable(marche, midi("2026-12-24")), true, "le dernier jour, à midi");
  assert.equal(retraitProposable(marche, new Date("2026-12-24T17:59:00Z")), true, "18 h 59 à Paris, avant 19:00");
  assert.equal(retraitProposable(marche, new Date("2026-12-24T18:00:00Z")), false, "19 h à Paris : fermé");
  assert.equal(retraitProposable(marche, midi("2026-12-25")), false, "le lendemain de la fin");
  // Le dernier jour fermé : on s'arrête à la fermeture de l'avant-dernier.
  const finFermee = {
    ...marche,
    horaires: { ...marche.horaires!, jours: { ...marche.horaires!.jours, "2026-12-24": { ferme: true } } },
  };
  assert.equal(retraitProposable(finFermee, midi("2026-12-23")), true);
  assert.equal(retraitProposable(finFermee, midi("2026-12-24")), false);
  // Fermé à la main : la tablette ne vend pas, mais le site le propose toujours.
  assert.equal(retraitProposable({ ...marche, pilotage: "manuel", ouvert: false }, midi("2026-11-20")), true);
  // Désactivé : plus proposé, même ouvert.
  assert.equal(retraitProposable({ ...marche, ouvert: true, actif: false }, midi("2026-11-20")), false);
  // Sans dates : proposé tant qu'il est activé, ouvert ou non.
  const sansDates = { ...marche, pilotage: "manuel", dateDebut: null, dateFin: null };
  assert.equal(retraitProposable({ ...sansDates, ouvert: false }, midi("2026-11-20")), true);
  assert.equal(retraitProposable({ ...sansDates, actif: false }, midi("2026-11-20")), false);
  assert.equal(retraitProposable({ ...sansDates, archivedAt: new Date() }, midi("2026-11-20")), false);
});

test("le back-office envoie le calendrier : il est vérifié et nettoyé", () => {
  const r = horairesLus(
    {
      matin: { de: "10:00", a: "12:30" },
      apresMidi: { de: "14:00", a: "19:00" },
      jours: {
        "2026-11-23": { ferme: true },
        // Identique à la base : rien à retenir.
        "2026-11-22": { matin: { de: "10:00", a: "12:30" }, apresMidi: { de: "14:00", a: "19:00" } },
        // Hors des dates du stand : oublié.
        "2027-01-05": { ferme: true },
      },
    },
    "2026-11-20",
    "2026-12-24",
  );
  assert.ok(typeof r !== "string");
  assert.deepEqual(r.jours, { "2026-11-23": { ferme: true } });
  assert.match(String(horairesLus({ matin: { de: "12:00", a: "10:00" } }, null, null)), /fin doit venir après/);
  assert.match(String(horairesLus({ matin: { de: "10h", a: "12:00" } }, null, null)), /10:00/);
  assert.match(
    String(horairesLus({ matin: { de: "10:00", a: "15:00" }, apresMidi: { de: "14:00", a: "19:00" } }, null, null)),
    /matin doit finir avant/,
  );
});

test("le résumé pour les clientes, en français et dans les autres langues", () => {
  const fr = resumeHoraires(marche, "fr");
  assert.match(fr, /^Du vendredi 20 novembre au jeudi 24 décembre 2026\./);
  assert.match(fr, /Tous les jours : 10:00–12:30 et 14:00–19:00\./);
  assert.match(fr, /Fermé : lundi 23 novembre\./);
  assert.match(fr, /Samedi 21 novembre : 10:00–13:00 et 14:00–20:00\./);
  assert.match(fr, /À venir chercher au plus tard le jeudi 24 décembre à 19:00\.$/);
  // Le dernier jour fermé : le dernier moment est le dernier jour OUVERT.
  const finFermee = {
    ...marche,
    horaires: { ...marche.horaires!, jours: { ...marche.horaires!.jours, "2026-12-24": { ferme: true } } },
  };
  assert.deepEqual(dernierMomentDeRetrait(finFermee), { jour: "2026-12-23", heure: "19:00" });
  assert.match(resumeHoraires(marche, "en"), /Every day: 10:00–12:30 and 14:00–19:00\./);
  assert.match(resumeHoraires(marche, "de"), /Geschlossen: /);
  assert.equal(resumeHoraires({ ...marche, dateDebut: null }, "fr"), "");
});

test("à la caisse : les 7 prochains jours écrits un par un, puis la suite", () => {
  // Avant le premier jour : la semaine part du premier jour du stand.
  const fr = resumeHoraires(marche, "fr", { maintenant: midi("2026-11-17") });
  const lignes = fr.split("\n");
  assert.equal(lignes[0], "Du vendredi 20 novembre au jeudi 24 décembre 2026.");
  assert.equal(lignes[1], "Vendredi 20 novembre : 10:00–12:30 et 14:00–19:00.");
  assert.equal(lignes[2], "Samedi 21 novembre : 10:00–13:00 et 14:00–20:00.");
  assert.equal(lignes[4], "Lundi 23 novembre : fermé.");
  assert.equal(lignes[7], "Jeudi 26 novembre : 10:00–12:30 et 14:00–19:00.");
  assert.equal(lignes[8], "Ensuite, tous les jours : 10:00–12:30 et 14:00–19:00.");
  assert.doesNotMatch(fr, /Fermé : lundi 23 novembre/, "déjà écrit dans la semaine");
  assert.match(fr, /À venir chercher au plus tard le jeudi 24 décembre à 19:00\.$/);
  // Un jour particulier APRÈS la semaine reste dit après « Ensuite ».
  const avecNoel = {
    ...marche,
    horaires: { ...marche.horaires!, jours: { ...marche.horaires!.jours, "2026-12-05": { ferme: true } } },
  };
  assert.match(resumeHoraires(avecNoel, "fr", { maintenant: midi("2026-11-17") }), /Fermé : samedi 5 décembre\./);
  // En cours de stand : à partir d'aujourd'hui ; la fin dans la semaine, pas d'« Ensuite ».
  const fin = resumeHoraires(marche, "fr", { maintenant: midi("2026-12-20") }).split("\n");
  assert.equal(fin[1], "Dimanche 20 décembre : 10:00–12:30 et 14:00–19:00.");
  assert.equal(fin.length, 1 + 5 + 1, "période, 5 jours, dernier moment");
  assert.match(resumeHoraires(marche, "en", { maintenant: midi("2026-11-17") }), /After that, every day: 10:00–12:30 and 14:00–19:00\./);
});
