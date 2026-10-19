/**
 * Les essais des mentions de la facture (adresse, SIRET, mention), sans
 * toucher à la base.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/facture.test.ts
 *
 * Le module ouvre un client de base à son chargement, mais aucune de ces
 * fonctions ne s'en sert : rien n'est lu ni écrit. Les SIRET sont factices,
 * fabriqués pour passer (ou rater) la clé de contrôle.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADRESSE_LIGNES_MAX,
  cleSiretValide,
  emetteurDepuisReglages,
  lignesDAdresse,
  mentionNettoyee,
  siretGroupe,
  siretNettoye,
} from "../src/facturation.js";

/** Complète 13 chiffres par la clé qui fait passer le contrôle de Luhn. */
function avecCle(treize: string): string {
  for (let d = 0; d <= 9; d++) if (cleSiretValide(treize + d)) return treize + d;
  throw new Error("aucune clé");
}

test("adresse : lignes nettoyées, vides retirées, 4 lignes de 50 caractères au plus", () => {
  const r = lignesDAdresse("  12 rue de l'Exemple \r\n\r\n68100   Mulhouse\n");
  assert.deepEqual(r.lignes, ["12 rue de l'Exemple", "68100 Mulhouse"]);
  assert.equal(r.erreur, null);

  const cinq = lignesDAdresse("a\nb\nc\nd\ne");
  assert.equal(cinq.lignes.length, ADRESSE_LIGNES_MAX + 1);
  assert.match(cinq.erreur ?? "", /4 lignes au plus/);

  const longue = lignesDAdresse(`ok\n${"x".repeat(51)}`);
  assert.match(longue.erreur ?? "", /Ligne 2/);

  assert.deepEqual(lignesDAdresse("").lignes, []);
});

test("SIRET : 14 chiffres, espaces de recopie acceptés, sinon refus", () => {
  const bon = avecCle("1234567890001");
  assert.equal(siretNettoye(`${bon.slice(0, 3)} ${bon.slice(3, 6)} ${bon.slice(6, 9)} ${bon.slice(9)}`).siret, bon);
  assert.equal(siretNettoye(bon).avertissement, null);

  // Vide : pas de SIRET, pas d'erreur (la facture sortira sans, l'écran le dit).
  assert.deepEqual(siretNettoye("  "), { siret: null, erreur: null, avertissement: null });

  assert.match(siretNettoye("123 456 789").erreur ?? "", /14 chiffres/);
  assert.match(siretNettoye("1234567890001A").erreur ?? "", /14 chiffres/);
});

test("SIRET : une clé qui ne tombe pas juste avertit sans bloquer", () => {
  const bon = avecCle("7300000000001");
  const dernier = Number(bon.at(-1));
  const faux = bon.slice(0, 13) + String((dernier + 1) % 10);
  assert.equal(cleSiretValide(bon), true);
  assert.equal(cleSiretValide(faux), false);
  const r = siretNettoye(faux);
  assert.equal(r.siret, faux);
  assert.equal(r.erreur, null);
  assert.match(r.avertissement ?? "", /clé/);
});

test("SIRET : l'exception de La Poste (somme des chiffres multiple de 5)", () => {
  // 356000000 + 00001 : 3 + 5 + 6 + 1 = 15, multiple de 5 → valide.
  assert.equal(cleSiretValide("35600000000001"), true);
  // 356000000 + 00002 : 16 → refusé, quoi qu'en dise Luhn.
  assert.equal(cleSiretValide("35600000000002"), false);
});

test("SIRET groupé comme sur un Kbis ; une valeur inattendue reste telle quelle", () => {
  assert.equal(siretGroupe("12345678900012"), "123 456 789 00012");
  assert.equal(siretGroupe("123 45678900012"), "123 456 789 00012");
  assert.equal(siretGroupe("ABC"), "ABC");
  assert.equal(siretGroupe(null), null);
});

test("mention : une ligne, 80 caractères au plus", () => {
  assert.deepEqual(mentionNettoyee("  EI  \n Mulhouse "), { mention: "EI Mulhouse", erreur: null });
  assert.equal(mentionNettoyee("").mention, null);
  assert.match(mentionNettoyee("x".repeat(81)).erreur ?? "", /80 caractères/);
});

test("réglages d'avant l'écran : dictionnaire de langues, tableau, SIRET groupé", () => {
  // Une valeur rangée par la route générale des réglages, avec une langue :
  // imprimée telle quelle, elle donnait « [object Object] ».
  const e = emetteurDepuisReglages([
    { key: "facture.adresse", value: { fr: "1 rue A\n00000 Ville" } },
    { key: "facture.siret", value: "123 456 789 00012" },
    { key: "facture.mention", value: "  EI " },
  ]);
  assert.deepEqual(e, { adresse: ["1 rue A", "00000 Ville"], siret: "12345678900012", mention: "EI" });

  const tableau = emetteurDepuisReglages([
    { key: "facture.adresse", value: ["a", "b", "c", "d", "e", "f"] },
  ]);
  // Coupée à 4 lignes plutôt que refusée : la facture sort quand même.
  assert.deepEqual(tableau.adresse, ["a", "b", "c", "d"]);
  assert.equal(tableau.siret, null);
  assert.equal(tableau.mention, null);

  // Rien de réglé : rien d'inventé.
  assert.deepEqual(emetteurDepuisReglages([]), { adresse: [], siret: null, mention: null });
});
