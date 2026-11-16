/**
 * Les essais du fuseau de la boutique (packages/types/src/fuseau.ts), sans
 * base ni réseau.
 *
 * Lancés par : docker exec -w /app/apps/api memoryline-api npx tsx --test tests/fuseau.test.ts
 *
 * Le processus est mis EXPRÈS sur un autre fuseau que Paris (Los Angeles,
 * neuf heures de décalage) : ce que ces fonctions disent doit être l'heure de
 * Paris quel que soit le réglage TZ de la machine. Si l'une d'elles lisait en
 * douce le fuseau local, ces essais tomberaient — alors qu'avec TZ=Europe/Paris
 * (docker-compose) le défaut passerait inaperçu.
 *
 * Les cas sont ceux où une heure de travers se voit : la vente de 23 h 30 et
 * celle de 0 h 30, hiver comme été ; les deux nuits de changement d'heure
 * (29 mars et 25 octobre 2026) ; le passage du 31 décembre au 1er janvier, qui
 * change l'année des factures.
 */
process.env.TZ = "America/Los_Angeles";

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anneeAParis,
  champAParis,
  debutDuMoisAParis,
  decalerJour,
  derniersJoursAParis,
  instantDeParis,
  jourAParis,
} from "@memoryline/types";
import { dateCourte, dateLongue } from "../src/courriels/index.js";

const iso = (d: Date | null) => d?.toISOString() ?? null;

test("le processus tourne bien hors de Paris pendant ces essais", () => {
  // 20 h 00 à Los Angeles = 4 h du matin le lendemain à Paris.
  assert.equal(new Date("2026-11-20T04:00:00Z").getDate(), 19);
});

test("jourAParis : 23 h 30 reste le jour même, 0 h 30 est déjà le lendemain", () => {
  // Hiver (UTC+1).
  assert.equal(jourAParis(new Date("2026-11-20T22:30:00Z")), "2026-11-20"); // 23 h 30
  assert.equal(jourAParis(new Date("2026-11-20T23:30:00Z")), "2026-11-21"); // 0 h 30
  // Été (UTC+2) : 0 h 30 à Paris, c'est 22 h 30 la veille en temps universel.
  assert.equal(jourAParis(new Date("2026-07-20T21:30:00Z")), "2026-07-20"); // 23 h 30
  assert.equal(jourAParis(new Date("2026-07-20T22:30:00Z")), "2026-07-21"); // 0 h 30
  // Minuit pile appartient au jour qui commence.
  assert.equal(jourAParis(new Date("2026-11-20T23:00:00Z")), "2026-11-21");
});

test("anneeAParis : la facture du 1er janvier à 0 h 30 est de la nouvelle année", () => {
  assert.equal(anneeAParis(new Date("2026-12-31T22:30:00Z")), 2026); // 31/12, 23 h 30
  assert.equal(anneeAParis(new Date("2026-12-31T23:30:00Z")), 2027); // 1/1, 0 h 30
  assert.equal(jourAParis(new Date("2026-12-31T23:30:00Z")), "2027-01-01");
});

test("instantDeParis : un jour seul vaut minuit à Paris, été comme hiver", () => {
  assert.equal(iso(instantDeParis("2026-11-20")), "2026-11-19T23:00:00.000Z");
  assert.equal(iso(instantDeParis("2026-07-20")), "2026-07-19T22:00:00.000Z");
  assert.equal(iso(instantDeParis("2027-01-01")), "2026-12-31T23:00:00.000Z");
  // Le soir, à la milliseconde près (fin de période, fin de promotion).
  assert.equal(
    iso(instantDeParis("2026-12-24T23:59:59.999")),
    "2026-12-24T22:59:59.999Z",
  );
  // Un champ datetime-local : « 2026-12-01T09:00 », sans secondes.
  assert.equal(iso(instantDeParis("2026-12-01T09:00")), "2026-12-01T08:00:00.000Z");
});

test("instantDeParis : les deux nuits de changement d'heure", () => {
  // 29 mars 2026 : 2 h → 3 h. Minuit est encore en hiver, midi déjà en été.
  assert.equal(iso(instantDeParis("2026-03-29")), "2026-03-28T23:00:00.000Z");
  assert.equal(iso(instantDeParis("2026-03-29T12:00")), "2026-03-29T10:00:00.000Z");
  assert.equal(iso(instantDeParis("2026-03-30")), "2026-03-29T22:00:00.000Z");
  // Cette journée-là ne dure que 23 heures.
  const courte = instantDeParis("2026-03-30")!.getTime() - instantDeParis("2026-03-29")!.getTime();
  assert.equal(courte, 23 * 3600_000);

  // 25 octobre 2026 : 3 h → 2 h. Minuit est en été, midi en hiver.
  assert.equal(iso(instantDeParis("2026-10-25")), "2026-10-24T22:00:00.000Z");
  assert.equal(iso(instantDeParis("2026-10-25T12:00")), "2026-10-25T11:00:00.000Z");
  assert.equal(iso(instantDeParis("2026-10-26")), "2026-10-25T23:00:00.000Z");
  // Et celle-ci en dure 25.
  const longue = instantDeParis("2026-10-26")!.getTime() - instantDeParis("2026-10-25")!.getTime();
  assert.equal(longue, 25 * 3600_000);
});

test("instantDeParis refuse ce que le calendrier ne connaît pas", () => {
  assert.equal(instantDeParis("2026-02-31"), null);
  assert.equal(instantDeParis("2026-13-01"), null);
  assert.equal(instantDeParis("2026-11-20T24:00"), null);
  assert.equal(instantDeParis("20/11/2026"), null);
  assert.equal(instantDeParis(""), null);
  // 2028 est bissextile, 2027 non.
  assert.notEqual(instantDeParis("2028-02-29"), null);
  assert.equal(instantDeParis("2027-02-29"), null);
});

test("champAParis relit exactement ce que instantDeParis a lu", () => {
  for (const saisie of [
    "2026-12-01T09:00",
    "2026-12-24T23:59",
    "2026-07-14T00:00",
    "2026-03-29T03:30",
    "2026-10-25T01:15",
    "2027-01-01T00:30",
  ])
    assert.equal(champAParis(instantDeParis(saisie)!), saisie, saisie);
  // Une promotion enregistrée en UTC pour le 1er décembre à 0 h 00 de Paris
  // se réaffiche « 2026-12-01T00:00 », pas « 2026-11-30T23:00 ».
  assert.equal(champAParis(new Date("2026-11-30T23:00:00Z")), "2026-12-01T00:00");
});

test("decalerJour compte des jours de calendrier", () => {
  assert.equal(decalerJour("2026-12-31", 1), "2027-01-01");
  assert.equal(decalerJour("2027-01-01", -1), "2026-12-31");
  assert.equal(decalerJour("2026-03-01", -1), "2026-02-28");
  assert.equal(decalerJour("2026-03-28", 2), "2026-03-30");
  assert.equal(decalerJour("2026-10-24", 2), "2026-10-26");
});

test("derniersJoursAParis ne saute ni ne double aucun jour aux changements d'heure", () => {
  // Le 30 mars à 0 h 30 de Paris : « maintenant moins 24 h » tombait le 28 et
  // sautait le 29.
  assert.deepEqual(derniersJoursAParis(new Date("2026-03-29T22:30:00Z"), 3), [
    "2026-03-28",
    "2026-03-29",
    "2026-03-30",
  ]);
  // Le 25 octobre à 23 h 30 de Paris : l'ancien calcul comptait le 25 deux fois.
  assert.deepEqual(derniersJoursAParis(new Date("2026-10-25T22:30:00Z"), 3), [
    "2026-10-23",
    "2026-10-24",
    "2026-10-25",
  ]);
  // « Aujourd'hui » le 1er janvier à 0 h 30 : c'est le 1er, pas le 31.
  assert.deepEqual(derniersJoursAParis(new Date("2026-12-31T23:30:00Z"), 1), ["2027-01-01"]);
  // Les ventes du stand « Aujourd'hui » commencent à minuit de Paris.
  const debut = instantDeParis(derniersJoursAParis(new Date("2026-12-12T09:00:00Z"), 1)[0]!);
  assert.equal(iso(debut), "2026-12-11T23:00:00.000Z");
});

test("debutDuMoisAParis : le 1er à 0 h 30, c'est déjà le nouveau mois", () => {
  // 1er décembre, 0 h 30 de Paris (encore le 30 novembre en temps universel).
  assert.equal(
    iso(debutDuMoisAParis(new Date("2026-11-30T23:30:00Z"))),
    "2026-11-30T23:00:00.000Z",
  );
  // 30 novembre, 23 h 30 de Paris : encore novembre.
  assert.equal(
    iso(debutDuMoisAParis(new Date("2026-11-30T22:30:00Z"))),
    "2026-10-31T23:00:00.000Z",
  );
  // Été : 1er août, 0 h 30 de Paris.
  assert.equal(
    iso(debutDuMoisAParis(new Date("2026-07-31T22:30:00Z"))),
    "2026-07-31T22:00:00.000Z",
  );
  // Nouvel an.
  assert.equal(
    iso(debutDuMoisAParis(new Date("2026-12-31T23:30:00Z"))),
    "2026-12-31T23:00:00.000Z",
  );
});

test("la date d'une facture ou d'un courrier est celle de Paris", () => {
  // Commande du 1er janvier 2027 à 0 h 30 de Paris.
  const nouvelAn = new Date("2026-12-31T23:30:00Z");
  assert.equal(dateLongue("fr", nouvelAn), "1 janvier 2027");
  assert.equal(dateCourte("fr", nouvelAn), "01/01/2027");
  assert.equal(dateLongue("en", nouvelAn), "1 January 2027");
  // Commande du 20 novembre à 23 h 30 de Paris : toujours le 20.
  assert.equal(dateLongue("fr", new Date("2026-11-20T22:30:00Z")), "20 novembre 2026");
});
