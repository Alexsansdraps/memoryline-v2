/**
 * Les commandes qui retiennent un élément de l'atelier, sans base de données.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/usages-commandes.test.ts
 *
 * Une suppression définitive (fond, personnage, pièce) est refusée tant
 * qu'une commande s'en sert — quel que soit son âge — ou qu'un panier encore
 * en cours (modifié il y a moins de quatorze jours) le porte. Ces essais
 * vérifient la règle (`retient`), la phrase du refus (`raisonDesCommandes`)
 * et la requête rendue en SQL : les identifiants y sont comparés en TEXTE,
 * pour trouver aussi bien `163` que `"163"`. Toutes les données sont
 * factices.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  PANIER_EN_COURS_MS,
  configSeSertDe,
  enBref,
  raisonDesCommandes,
  retient,
  type CommandeQuiSertDe,
} from "../src/usages-commandes.js";

const maintenant = new Date("2026-11-08T12:00:00Z");
const ilYa = (jours: number) => new Date(maintenant.getTime() - jours * 24 * 3600 * 1000);
const reste = "Il reste archivé.";

const commande = (numero: string, statut = "paid", jours = 400): CommandeQuiSertDe => ({
  numero,
  statut,
  derniereActivite: ilYa(jours),
});

test("une commande retient toujours, même très ancienne, annulée ou remboursée", () => {
  for (const statut of ["paid", "cancelled", "refunded", "authorized", "voided"])
    assert.equal(retient(commande("WEB-1", statut, 900), maintenant), true, statut);
});

test("un panier ne retient que pendant quatorze jours après sa dernière modification", () => {
  for (const statut of ["draft", "pending"]) {
    assert.equal(retient(commande("WEB-2", statut, 3), maintenant), true);
    assert.equal(retient(commande("WEB-2", statut, 13.9), maintenant), true);
    assert.equal(retient(commande("WEB-2", statut, 14.1), maintenant), false);
  }
  assert.equal(PANIER_EN_COURS_MS, 14 * 24 * 3600 * 1000);
});

test("un panier sans date lisible compte comme en cours : dans le doute, on garde", () => {
  assert.equal(retient({ numero: "X", statut: "draft", derniereActivite: null }, maintenant), true);
  assert.equal(retient({ numero: "X", statut: "draft", derniereActivite: "pas une date" }, maintenant), true);
  // La date telle que le pilote la rend parfois : une chaîne.
  assert.equal(retient({ numero: "X", statut: "draft", derniereActivite: ilYa(20).toISOString() }, maintenant), false);
});

test("rien ne retient : pas de refus", () => {
  assert.equal(raisonDesCommandes([], reste, maintenant), null);
  assert.equal(raisonDesCommandes([commande("P-1", "draft", 30)], reste, maintenant), null);
});

test("la phrase cite les commandes, sans doublon, trois au plus", () => {
  assert.equal(
    raisonDesCommandes([commande("WEB-1042"), commande("WEB-1042")], reste, maintenant),
    "La commande WEB-1042 s'en sert : elle en a besoin pour se réimprimer. Il reste archivé.",
  );
  const r = raisonDesCommandes(
    ["WEB-5", "WEB-1", "WEB-4", "WEB-2", "WEB-3"].map((n) => commande(n)),
    "Elle reste archivée.",
    maintenant,
  );
  assert.equal(
    r,
    "Des commandes s'en servent (WEB-1, WEB-2, WEB-3 et 2 autres) : elles en ont besoin pour se réimprimer. Elle reste archivée.",
  );
});

test("les paniers en cours s'ajoutent aux commandes, ou parlent seuls", () => {
  const lignes = [commande("WEB-7"), commande("P-1", "draft", 1), commande("P-2", "pending", 2), commande("P-3", "draft", 40)];
  assert.match(raisonDesCommandes(lignes, reste, maintenant)!, /^La commande WEB-7 s'en sert \(et 2 paniers en cours\)/);
  assert.match(raisonDesCommandes([commande("P-1", "draft", 1)], reste, maintenant)!, /^Un panier en cours s'en sert/);
  assert.match(
    raisonDesCommandes([commande("P-1", "draft", 1), commande("P-2", "draft", 1)], reste, maintenant)!,
    /^2 paniers en cours s'en servent/,
  );
});

test("enBref : trois noms, puis le compte du reste", () => {
  assert.equal(enBref(["a"]), "a");
  assert.equal(enBref(["a", "b", "c"]), "a, b, c");
  assert.equal(enBref(["a", "b", "c", "d"]), "a, b, c et 1 autre");
});

test("la requête compare les identifiants en texte, sans conversion en entier", () => {
  const d = new PgDialect();
  const fond = d.sqlToQuery(configSeSertDe({ fond: 163 }));
  assert.match(fond.sql, /"config" ->> 'backgroundId'\) = \$1/);
  assert.deepEqual(fond.params, ["163"]);
  assert.doesNotMatch(fond.sql, /::int/);

  const perso = d.sqlToQuery(configSeSertDe({ personnage: 55 }));
  assert.match(perso.sql, /jsonb_typeof\("order_item"\."config" -> 'characters'\) = 'array'/);
  assert.match(perso.sql, /p ->> 'typeId' = \$1/);
  assert.deepEqual(perso.params, ["55"]);

  const pieces = d.sqlToQuery(configSeSertDe({ pieces: [12, 7] }));
  assert.match(pieces.sql, /jsonb_each_text/);
  assert.match(pieces.sql, /piece\.id in \(\$1, \$2\)/);
  assert.deepEqual(pieces.params, ["12", "7"]);

  // Aucune pièce : aucune ligne ne peut correspondre.
  assert.equal(d.sqlToQuery(configSeSertDe({ pieces: [] })).sql, "false");
});
