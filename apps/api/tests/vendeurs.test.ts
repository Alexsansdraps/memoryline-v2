/**
 * Les essais de la règle des vendeurs, sans base de données.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/vendeurs.test.ts
 *
 * La règle tient en trois phrases (vendeurs.ts) : la propriétaire voit tout,
 * un vendeur ne voit que les ventes de ses stands, un vendeur sans stand ne
 * voit rien. Ces essais vérifient les trois, pour une commande lue
 * (`commandeVisible`) comme pour une requête (`bornesDuVendeur`, rendue en
 * SQL sans connexion). Toutes les données sont factices.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { and } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  bornesDuVendeur,
  commandeVisible,
  standsDuVendeur,
  type Personne,
} from "../src/vendeurs.js";

const proprietaire: Personne = { role: "owner", standIds: [] };
const sansStand: Personne = { role: "seller", standIds: [] };
const stand2: Personne = { role: "seller", standIds: [2] };
const stands2et5: Personne = { role: "seller", standIds: [5, 2] };

const venteStand2 = { channel: "salon", standId: 2 };
const venteStand3 = { channel: "salon", standId: 3 };
const venteSansStand = { channel: "salon", standId: null };
const venteDuSite = { channel: "web", standId: null };

/** La condition rendue en SQL, comme la base la recevrait. */
function enSql(personne: Personne) {
  const bornes = bornesDuVendeur(personne);
  if (!bornes.length) return null;
  return new PgDialect().sqlToQuery(and(...bornes)!);
}

test("la propriétaire voit tout, sans aucune borne", () => {
  assert.deepEqual(bornesDuVendeur(proprietaire), []);
  for (const vente of [venteStand2, venteStand3, venteSansStand, venteDuSite])
    assert.equal(commandeVisible(proprietaire, vente), true);
});

test("un vendeur sans stand confié ne voit rien", () => {
  for (const vente of [venteStand2, venteStand3, venteSansStand, venteDuSite])
    assert.equal(commandeVisible(sansStand, vente), false);
  const q = enSql(sansStand);
  assert.ok(q);
  assert.match(q.sql, /^false$/);
});

test("un vendeur voit les ventes de SON stand, pas celles d'un autre ni du site", () => {
  assert.equal(commandeVisible(stand2, venteStand2), true);
  assert.equal(commandeVisible(stand2, venteStand3), false);
  assert.equal(commandeVisible(stand2, venteDuSite), false);
  // Une vente de stand d'avant les stands multiples n'est à personne.
  assert.equal(commandeVisible(stand2, venteSansStand), false);
  // Un stand dans la liste ne suffit pas : il faut aussi le canal du stand.
  assert.equal(commandeVisible(stand2, { channel: "web", standId: 2 }), false);
});

test("la requête d'un vendeur porte le canal et ses stands", () => {
  const q = enSql(stands2et5);
  assert.ok(q);
  assert.match(q.sql, /"channel" = \$1/);
  assert.match(q.sql, /"stand_id" in \(\$2, \$3\)/);
  assert.deepEqual(q.params, ["salon", 5, 2]);
});

test("plusieurs stands : chacun ouvre ses ventes", () => {
  assert.equal(commandeVisible(stands2et5, venteStand2), true);
  assert.equal(commandeVisible(stands2et5, { channel: "salon", standId: 5 }), true);
  assert.equal(commandeVisible(stands2et5, venteStand3), false);
});

test("sans personne connue, refus par défaut", () => {
  assert.equal(commandeVisible(null, venteStand2), false);
  assert.equal(commandeVisible(undefined, venteDuSite), false);
  assert.match(enSql(null)!.sql, /^false$/);
});

test("une liste de stands abîmée n'ouvre aucune porte", () => {
  const abimee = {
    role: "seller",
    standIds: ["2", 0, -1, 2.5, null, "x", 2] as unknown as number[],
  };
  assert.deepEqual(standsDuVendeur(abimee), [2]);
  assert.deepEqual(
    standsDuVendeur({ role: "seller", standIds: "2" as unknown as number[] }),
    [],
  );
});
