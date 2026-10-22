/**
 * La numérotation des commandes (src/numeros-commande.ts), sans base.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/numeros-commande.test.ts
 *
 * Le bug qu'ils gardent : « Error: API POST /orders -> 500 » à la caisse du
 * site, pour toutes les clientes. Une vente du stand rouverte, passée par la
 * caisse du site, gardait son canal « salon » avec un numéro WEB- ; le
 * compteur du site ne relisait que les commandes « web » et redonnait ce
 * numéro à chaque caisse suivante, refusée par l'index unique (numéro seul,
 * tous canaux). Toutes les données sont factices.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PgDialect } from "drizzle-orm/pg-core";
import { numeroSuivant, numerosDuPrefixe } from "../src/numeros-commande.ts";

test("numeroSuivant : le plus grand suffixe + 1, sur quatre chiffres", () => {
  assert.equal(numeroSuivant("WEB-", []), "WEB-0001");
  assert.equal(numeroSuivant("WEB-", ["WEB-0046", "WEB-0009", "WEB-0012"]), "WEB-0047");
  // Au-delà de 9999, le numéro s'allonge plutôt que de repartir à zéro.
  assert.equal(numeroSuivant("WEB-", ["WEB-9999"]), "WEB-10000");
  assert.equal(numeroSuivant("SAL-", ["SAL-0001"]), "SAL-0002");
});

test("numeroSuivant : paniers, numéros legacy et autre préfixe ne comptent pas", () => {
  assert.equal(
    numeroSuivant("WEB-", ["DRAFT-1b2c", "#1042", "WEB-12a", "SAL-0090", "WEB-0003"]),
    "WEB-0004",
  );
  assert.equal(numeroSuivant("SAL-", ["WEB-0500", "SAL-x", "SAL-0007"]), "SAL-0008");
});

test("une vente du stand qui porte un WEB- compte dans le compteur du site", () => {
  // Ce que la base contenait : WEB-0046 sur une commande du site, WEB-0047
  // sur une vente du stand rouverte puis passée par la caisse. Le compteur
  // d'avant ne voyait que la première, et redonnait WEB-0047 indéfiniment.
  const commandes = [
    { channel: "web", number: "WEB-0046" },
    { channel: "salon", number: "WEB-0047" },
    { channel: "salon", number: "SAL-0001" },
  ];
  const lusParLAncienCompteur = commandes.filter((c) => c.channel === "web").map((c) => c.number);
  assert.equal(numeroSuivant("WEB-", lusParLAncienCompteur), "WEB-0047", "le doublon d'avant");
  // Par préfixe, comme l'index unique : le numéro suivant est libre.
  const lusParPrefixe = commandes.map((c) => c.number).filter((n) => n.startsWith("WEB-"));
  assert.equal(numeroSuivant("WEB-", lusParPrefixe), "WEB-0048");
});

test("numerosDuPrefixe : un filtre sur le numéro seul, jamais sur le canal", () => {
  const { sql, params } = new PgDialect().sqlToQuery(numerosDuPrefixe("WEB-"));
  assert.match(sql, /"order"\."number" like \$1/);
  assert.doesNotMatch(sql, /channel/);
  assert.deepEqual(params, ["WEB-%"]);
});

/* -------------------------------------------------------------------------- */
/*  Les routes prennent leur numéro dans la transaction                       */
/* -------------------------------------------------------------------------- */

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Le corps d'une route, de sa déclaration à la suivante. */
function corpsDeRoute(source: string, declaration: string): string {
  const debut = source.indexOf(declaration);
  assert.ok(debut >= 0, `route introuvable : ${declaration}`);
  const suite = source.slice(debut + declaration.length).search(/\n {2}app\.(get|post|put|delete)\(/);
  return source.slice(debut, suite < 0 ? undefined : debut + declaration.length + suite);
}

test("POST /orders : le WEB- se prend sous verrou, et la commande devient une commande du site", () => {
  const route = corpsDeRoute(readFileSync(join(SRC, "configurator-routes.ts"), "utf8"), 'app.post("/orders"');
  const transaction = route.indexOf("db.transaction(");
  const numero = route.indexOf('prochainNumeroDeCommande(tx, "WEB-")');
  assert.ok(transaction > 0 && numero > transaction, "le numéro se prend dans la transaction");
  assert.doesNotMatch(route, /nextOrderNumber/);
  // Une vente du stand rouverte qui passe par ici ne garde pas son canal.
  assert.match(route, /channel: "web",\s+standId: null,/);
});

test("validation au stand : le SAL- se prend lui aussi sous verrou", () => {
  const route = corpsDeRoute(readFileSync(join(SRC, "salon.ts"), "utf8"), 'app.post("/salon/commandes",');
  const transaction = route.indexOf("db.transaction(");
  const numero = route.indexOf('prochainNumeroDeCommande(tx, "SAL-")');
  assert.ok(transaction > 0 && numero > transaction, "le numéro se prend dans la transaction");
});

test("aucun autre compteur de numéros ne filtre par canal", () => {
  for (const fichier of ["configurator-routes.ts", "salon.ts", "numeros-commande.ts"]) {
    const source = readFileSync(join(SRC, fichier), "utf8");
    assert.doesNotMatch(source, /nextOrderNumber|prochainNumeroSalon/, fichier);
  }
});
