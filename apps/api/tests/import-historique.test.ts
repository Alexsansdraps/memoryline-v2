/**
 * La reprise de l'historique Shopify (scripts/import/historique-shopify.ts),
 * sans base de données.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/import-historique.test.ts
 *
 * Ce qu'ils gardent : la lecture de l'export natif (et de l'ancien format, et
 * de Matrixify), le regroupement des lignes d'une commande, la correspondance
 * des statuts — jamais « à traiter », jamais « pending » —, le numéro
 * « SHOP-… » qui ne décale pas les séries du site, les règles de fusion des
 * clientes (compléter sans écraser, ne jamais réabonner) et le rattachement
 * des articles au catalogue. Les CSV sont écrits dans un dossier temporaire.
 * Toutes les données sont FICTIVES.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ImportImpossible,
  canalRepris,
  centimes,
  choisirFiches,
  codePays,
  decoder,
  indexerCatalogue,
  lireClientes,
  lireCommandes,
  lireDate,
  lireDossier,
  lireTable,
  numeroRepris,
  planCliente,
  planifier,
  rattacher,
  separateurDe,
  statutRepris,
  trouverFichiers,
  type ArticleLu,
  type ClienteLue,
  type EtatBase,
  type FicheExistante,
} from "../scripts/import/historique-shopify.ts";
import { numeroSuivant } from "../src/numeros-commande.ts";
import { HORS_VENTES } from "../src/statuts-vente.ts";
import { statutExpedition, statutFinancier } from "../src/commandes.ts";

/* -------------------------------------------------------------------------- */
/*  Les fichiers fictifs                                                      */
/* -------------------------------------------------------------------------- */

const dossiers: string[] = [];
function dossierTemporaire(): string {
  const d = mkdtempSync(join(tmpdir(), "reprise-shopify-"));
  dossiers.push(d);
  return d;
}
after(() => {
  for (const d of dossiers) rmSync(d, { recursive: true, force: true });
});

/** Un CSV comme Shopify l'écrit : guillemets quand il le faut, fins de ligne CRLF. */
function csv(lignes: string[][], sep = ","): string {
  const cellule = (v: string) => (/[",;\n\r\t]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return lignes.map((l) => l.map(cellule).join(sep)).join("\r\n") + "\r\n";
}

/** Une ligne dans l'ordre des en-têtes, les colonnes absentes laissées vides. */
function ligne(entetes: readonly string[], valeurs: Record<string, string>): string[] {
  for (const cle of Object.keys(valeurs))
    assert.ok(entetes.includes(cle), `colonne inconnue dans le test : ${cle}`);
  return entetes.map((e) => valeurs[e] ?? "");
}

// L'export « Tous les clients » d'aujourd'hui.
const CLIENTES = [
  "Customer ID", "First Name", "Last Name", "Email", "Accepts Email Marketing",
  "Default Address Company", "Default Address Address1", "Default Address Address2",
  "Default Address City", "Default Address Province Code", "Default Address Country Code",
  "Default Address Zip", "Default Address Phone", "Phone", "Accepts SMS Marketing",
  "Total Spent", "Total Orders", "Note", "Tax Exempt", "Tags",
];

const fichierClientes = csv([
  CLIENTES,
  ligne(CLIENTES, {
    "Customer ID": "'7000000000001",
    "First Name": "Cliente",
    "Last Name": "Essai Un",
    Email: "Cliente.Un@Example.test",
    "Accepts Email Marketing": "yes",
    "Default Address Address1": "1 rue des Essais",
    "Default Address City": "Lille",
    "Default Address Country Code": "FR",
    "Default Address Zip": "'59000",
    "Default Address Phone": "'+33 6 00 00 00 01",
    "Total Spent": "51.90",
    "Total Orders": "2",
    Tags: "VIP, Salon",
  }),
  ligne(CLIENTES, {
    "Customer ID": "'7000000000002",
    "First Name": "Cliente",
    "Last Name": "Essai Deux",
    Email: "cliente.deux@example.test",
    "Accepts Email Marketing": "yes",
    Phone: "'+33 6 00 00 00 02",
    Note: "Note fictive",
  }),
  // Sans adresse e-mail : écartée.
  ligne(CLIENTES, { "First Name": "Cliente", "Last Name": "Sans Adresse", "Accepts Email Marketing": "yes" }),
  // Adresse illisible : écartée.
  ligne(CLIENTES, { "First Name": "Cliente", "Last Name": "Illisible", Email: "pas-une-adresse" }),
  // Même adresse que la première, en majuscules : lue une seule fois.
  ligne(CLIENTES, { "First Name": "Cliente", "Last Name": "Doublon", Email: "CLIENTE.UN@example.test" }),
  // « pending » : la confirmation n'est jamais venue, ce n'est pas un accord.
  // Une adresse sans ville n'entre pas au carnet.
  ligne(CLIENTES, {
    "Customer ID": "'7000000000006",
    "First Name": "Cliente",
    "Last Name": "Essai Six",
    Email: "cliente.six@example.test",
    "Accepts Email Marketing": "pending",
    "Default Address Address1": "6 rue des Essais",
  }),
]);

// L'ancien export des clientes : « Accepts Marketing », « Address1 », « City »…
const ANCIENNES = [
  "First Name", "Last Name", "Email", "Accepts Marketing", "Company", "Address1", "Address2",
  "City", "Province", "Province Code", "Country", "Country Code", "Zip", "Phone",
  "Total Spent", "Total Orders", "Tags", "Note", "Tax Exempt",
];

// L'export « Toutes les commandes » : une ligne par article.
const COMMANDES = [
  "Name", "Email", "Financial Status", "Paid at", "Fulfillment Status", "Fulfilled at",
  "Accepts Marketing", "Currency", "Subtotal", "Shipping", "Taxes", "Total", "Discount Code",
  "Discount Amount", "Shipping Method", "Created at", "Lineitem quantity", "Lineitem name",
  "Lineitem price", "Lineitem sku", "Billing Name", "Billing Address1", "Billing City",
  "Billing Zip", "Billing Country", "Billing Phone", "Shipping Name", "Shipping Address1",
  "Shipping Address2", "Shipping City", "Shipping Zip", "Shipping Country", "Shipping Phone",
  "Notes", "Cancelled at", "Payment Method", "Refunded Amount", "Id", "Tags", "Source", "Phone",
];

/** La première ligne d'une commande : ses champs à elle, et un premier article. */
function tete(v: Record<string, string>): string[] {
  return ligne(COMMANDES, { Currency: "EUR", Source: "web", "Lineitem quantity": "1", ...v });
}
/** Une ligne suivante : le numéro, l'adresse, la date et l'article seulement. */
function suite(v: Record<string, string>): string[] {
  return ligne(COMMANDES, { "Lineitem quantity": "1", ...v });
}

const commande1001 = [
  tete({
    Name: "#1001",
    Email: "Cliente.Un@example.test",
    "Financial Status": "paid",
    "Paid at": "2025-12-03 10:16:00 +0100",
    "Fulfillment Status": "fulfilled",
    "Fulfilled at": "2025-12-05 09:00:00 +0100",
    "Accepts Marketing": "yes",
    Subtotal: "46.00",
    Shipping: "5.90",
    Total: "51.90",
    "Shipping Method": "Mondial Relay",
    "Created at": "2025-12-03 10:15:22 +0100",
    "Lineitem name": "Affiche Essai - A4 (21 x 29.7 cm)",
    "Lineitem price": "23.00",
    "Lineitem sku": "ESSAI-A4",
    "Billing Name": "Cliente Essai Un",
    "Shipping Name": "Cliente Essai Un",
    "Shipping Address1": "1 rue des Essais",
    "Shipping City": "Lille",
    "Shipping Zip": "'59000",
    "Shipping Country": "France",
    Notes: "Livrer, s'il vous plaît, \"avant Noël\"",
    "Payment Method": "Shopify Payments",
    Id: "5000000000001",
    Tags: "cadeau",
  }),
  suite({
    Name: "#1001",
    Email: "Cliente.Un@example.test",
    "Created at": "2025-12-03 10:15:22 +0100",
    "Lineitem name": "VILLE-ESSAI Plage - Affiche personnalisée - A3 (29.7 x 42 cm)",
    "Lineitem price": "23.00",
  }),
];

const fichierCommandes1 = csv([
  COMMANDES,
  ...commande1001,
  // Remboursée en totalité : hors ventes.
  tete({
    Name: "#1002", Email: "cliente.deux@example.test", "Financial Status": "refunded",
    "Paid at": "2025-12-04 11:00:00 +0100", "Fulfillment Status": "fulfilled",
    "Fulfilled at": "2025-12-06 11:00:00 +0100", Total: "23.00",
    "Created at": "2025-12-04 10:59:00 +0100", "Lineitem name": "Affiche Essai - A4 (21 x 29.7 cm)",
    "Lineitem price": "23.00", "Refunded Amount": "23.00", Id: "5000000000002",
  }),
  // Payée, jamais marquée expédiée : une commande saisie à la main au salon.
  tete({
    Name: "#1003", Email: "cliente.un@example.test", "Financial Status": "paid",
    "Fulfillment Status": "unfulfilled", Total: "15.00", "Created at": "2026-03-14 15:00:00 +0100",
    "Lineitem name": "Article inconnu du catalogue", "Lineitem price": "15.00",
    Id: "5000000000003", Source: "shopify_draft_order",
  }),
  // Jamais payée, cliente absente de l'export des clientes.
  tete({
    Name: "#1004", Email: "Invitee@Example.test", "Financial Status": "pending",
    "Fulfillment Status": "unfulfilled", "Accepts Marketing": "yes", Total: "23.00",
    "Created at": "2026-11-10 08:00:00 +0100", "Lineitem name": "Affiche Essai - A3",
    "Lineitem price": "23.00", "Billing Name": "Cliente Invitée", Id: "5000000000004",
  }),
  // Annulée dans Shopify.
  tete({
    Name: "#1005", Email: "cliente.six@example.test", "Financial Status": "voided",
    "Fulfillment Status": "unfulfilled", Total: "23.00", "Created at": "2026-01-02 12:00:00 +0100",
    "Cancelled at": "2026-01-02 13:00:00 +0100", "Lineitem name": "Affiche Essai - A4",
    "Lineitem price": "23.00", Id: "5000000000005",
  }),
  // Remboursée en partie : une vente, avec son remboursement.
  tete({
    Name: "#1006", Email: "cliente.deux@example.test", "Financial Status": "partially_refunded",
    "Paid at": "2026-02-01 10:00:00 +0100", "Fulfillment Status": "fulfilled", Total: "46.00",
    "Created at": "2026-02-01 09:59:00 +0100", "Lineitem quantity": "2",
    "Lineitem name": "Affiche Essai - A4", "Lineitem price": "23.00",
    "Refunded Amount": "10.00", Id: "5000000000006",
  }),
  // Autorisée, jamais encaissée : ni vente, ni « Impayées ».
  tete({
    Name: "#1007", Email: "cliente.six@example.test", "Financial Status": "authorized",
    "Fulfillment Status": "unfulfilled", Total: "23.00", "Created at": "2026-11-15 18:00:00 +0100",
    "Lineitem name": "Affiche Essai - A4", "Lineitem price": "23.00", Id: "5000000000007",
  }),
  // Caisse Shopify, sans adresse e-mail.
  tete({
    Name: "#1008", "Financial Status": "paid", "Fulfillment Status": "fulfilled", Total: "15.00",
    "Created at": "2026-06-20 14:00:00 +0200", "Lineitem name": "Article de stand",
    "Lineitem price": "15.00", Id: "5000000000008", Source: "pos",
  }),
  // Date illisible : écartée.
  tete({
    Name: "#1009", Email: "cliente.un@example.test", "Financial Status": "paid",
    Total: "23.00", "Created at": "hier", "Lineitem name": "Affiche Essai - A4",
    "Lineitem price": "23.00", Id: "5000000000009",
  }),
  // Coupée entre deux fichiers : la tête ici, un article dans le suivant.
  tete({
    Name: "#1010", Email: "cliente.un@example.test", "Financial Status": "paid",
    "Fulfillment Status": "fulfilled", Total: "46.00", "Created at": "2026-07-01 10:00:00 +0200",
    "Lineitem name": "Affiche Essai - A4", "Lineitem price": "23.00", Id: "5000000000010",
  }),
  // Une ligne sans numéro ni identifiant : écartée.
  suite({ "Lineitem name": "Ligne orpheline", "Lineitem price": "1.00" }),
]);

const fichierCommandes2 = csv([
  COMMANDES,
  suite({
    Name: "#1010", Email: "cliente.un@example.test", "Created at": "2026-07-01 10:00:00 +0200",
    "Lineitem name": "Affiche Essai - A3", "Lineitem price": "23.00",
  }),
  // La même #1001 une seconde fois, entière : lue une seule fois.
  ...commande1001,
  // Déjà reprise lors d'un passage précédent (voir l'état de la base plus bas).
  tete({
    Name: "#1011", Email: "cliente.un@example.test", "Financial Status": "paid",
    "Fulfillment Status": "fulfilled", Total: "23.00", "Created at": "2026-08-01 10:00:00 +0200",
    "Lineitem name": "Affiche Essai - A4", "Lineitem price": "23.00", Id: "5000000000011",
  }),
]);

/** Le dossier des exports, tel que la propriétaire le déposera. */
function dossierNatif(): string {
  const d = dossierTemporaire();
  writeFileSync(join(d, "customers_export.csv"), "﻿" + fichierClientes);
  writeFileSync(join(d, "orders_export_1.csv"), fichierCommandes1);
  writeFileSync(join(d, "orders_export_2.csv"), fichierCommandes2);
  return d;
}

/** Un catalogue fictif. */
const CATALOGUE = indexerCatalogue(
  [
    { id: 1, name: "Affiche Essai", legacyId: 900001 },
    { id: 2, name: "VILLE-ESSAI Plage - Affiche personnalisée", legacyId: null },
    { id: 3, name: "Doublon", legacyId: null },
    { id: 4, name: "doublon", legacyId: null },
  ],
  [
    { id: 11, productId: 1, format: "A4", sku: "ESSAI-A4", legacyId: 800001 },
    { id: 12, productId: 1, format: "A3", sku: null, legacyId: 800002 },
    { id: 21, productId: 2, format: "A4", sku: null, legacyId: null },
    { id: 22, productId: 2, format: "A3", sku: null, legacyId: null },
    { id: 31, productId: 3, format: "A4", sku: "DOUBLE", legacyId: null },
    { id: 41, productId: 4, format: "A4", sku: "DOUBLE", legacyId: null },
  ],
);

const MAINTENANT = new Date("2026-11-18T09:00:00Z");

function fiche(v: Partial<FicheExistante> & { id: number; email: string }): FicheExistante {
  return {
    name: null,
    firstName: null,
    lastName: null,
    phone: null,
    note: null,
    tags: [],
    acceptsMarketing: false,
    compte: false,
    aUneAdresse: false,
    legacyId: null,
    ...v,
  };
}

/** La base fictive : une cliente inscrite sur le nouveau site, une commande déjà reprise. */
function etatFictif(): EtatBase {
  return {
    fiches: [
      fiche({
        id: 40,
        email: "cliente.deux@example.test",
        name: "Cliente Essai Deux",
        compte: true,
        acceptsMarketing: false,
      }),
    ],
    legacyIds: new Set([5000000000011]),
    legacyNames: new Set(["#1011"]),
    numeros: new Set(["SHOP-1011"]),
    // Partie par le lien « Me désabonner » de la lettre, sans fiche cliente.
    desabonnees: new Set(["cliente.six@example.test"]),
    catalogue: CATALOGUE,
  };
}

/* -------------------------------------------------------------------------- */
/*  Lecture                                                                   */
/* -------------------------------------------------------------------------- */

test("les fichiers : clientes et commandes, dans l'ordre des numéros", () => {
  const f = trouverFichiers([
    "orders_export_10.csv",
    "orders_export_2.csv",
    "customers_export_1.csv",
    "orders_export_1.csv",
    "notes.txt",
  ]);
  assert.equal(f.format, "natif");
  assert.deepEqual(f.clientes, ["customers_export_1.csv"]);
  assert.deepEqual(f.commandes, ["orders_export_1.csv", "orders_export_2.csv", "orders_export_10.csv"]);
  assert.deepEqual(trouverFichiers(["customers_export.csv"]).clientes, ["customers_export.csv"]);
  // Matrixify seulement quand il n'y a aucun export natif.
  assert.equal(trouverFichiers(["Customers.csv", "Orders.csv"]).format, "matrixify");
  assert.equal(trouverFichiers(["Customers.csv", "orders_export_1.csv"]).format, "natif");
});

test("un fichier qui manque : refus, avec ce qu'il faut exporter de Shopify", () => {
  const vide = dossierTemporaire();
  assert.throws(
    () => lireDossier(vide),
    (e: unknown) =>
      e instanceof ImportImpossible &&
      /Clients › Exporter › « Tous les clients »/.test(e.message) &&
      /Commandes › Exporter › « Toutes les commandes »/.test(e.message),
  );
  const sansCommandes = dossierTemporaire();
  writeFileSync(join(sansCommandes, "customers_export.csv"), fichierClientes);
  assert.throws(
    () => lireDossier(sansCommandes),
    (e: unknown) => e instanceof ImportImpossible && /l'export des commandes/.test(e.message),
  );
  assert.throws(() => lireDossier(join(vide, "absent")), ImportImpossible);
});

test("lecture des clientes : apostrophes, casse, abonnement, carnet, écarts", () => {
  const lu = lireDossier(dossierNatif());
  const { clientes, ecartees, lignes } = lireClientes(lu.clientes);
  assert.equal(lignes, 6);
  assert.deepEqual(clientes.map((c) => c.email), [
    "cliente.un@example.test",
    "cliente.deux@example.test",
    "cliente.six@example.test",
  ]);
  const un = clientes[0]!;
  assert.equal(un.idShopify, 7000000000001);
  assert.equal(un.name, "Cliente Essai Un");
  assert.equal(un.firstName, "Cliente");
  assert.equal(un.lastName, "Essai Un");
  assert.equal(un.abonnement, true);
  assert.deepEqual(un.tags, ["VIP", "Salon"]);
  assert.deepEqual(un.adresse, {
    line1: "1 rue des Essais",
    line2: null,
    postalCode: "59000",
    city: "Lille",
    country: "FR",
    phone: "+33 6 00 00 00 01",
  });
  // Le téléphone de l'adresse vaut téléphone quand la colonne « Phone » est vide.
  assert.equal(un.phone, "+33 6 00 00 00 01");
  assert.equal(clientes[1]!.phone, "+33 6 00 00 00 02");
  assert.equal(clientes[1]!.note, "Note fictive");
  // « pending » n'est pas un accord ; une rue sans ville n'est pas une adresse.
  assert.equal(clientes[2]!.abonnement, false);
  assert.equal(clientes[2]!.adresse, null);
  assert.deepEqual(
    ecartees.map((e) => e.ligne),
    [4, 5, 6],
  );
  assert.match(ecartees[0]!.raison, /pas d'adresse e-mail/);
  assert.match(ecartees[1]!.raison, /illisible/);
  assert.match(ecartees[2]!.raison, /même adresse/);
});

test("l'ancien export des clientes se lit aussi, et un fichier repassé par Excel", () => {
  const ancien = [
    ANCIENNES,
    ligne(ANCIENNES, {
      "First Name": "Cliente",
      "Last Name": "Essai Ancienne",
      Email: "ancienne@example.test",
      "Accepts Marketing": "no",
      Address1: "2 place des Essais",
      City: "Amiens",
      Country: "France",
      Zip: "80000",
      Phone: "+33 3 00 00 00 00",
    }),
  ];
  for (const table of [
    lireTable("customers_export.csv", csv(ancien)),
    // Point-virgule et Windows-1252 : un fichier rouvert et réenregistré.
    lireTable("customers_export.csv", Buffer.from(csv(ancien, ";").replace("Essai", "Essai é"), "latin1")),
    // UTF-16 avec sa marque.
    lireTable("customers_export.csv", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(csv(ancien), "utf16le")])),
  ]) {
    const [c] = lireClientes([table]).clientes;
    assert.equal(c?.email, "ancienne@example.test");
    assert.equal(c?.abonnement, false);
    assert.equal(c?.adresse?.city, "Amiens");
    assert.equal(c?.adresse?.country, "FR", "le nom du pays devient son code");
    assert.equal(c?.idShopify, null);
  }
  const accentue = lireClientes([
    lireTable("x.csv", Buffer.from(csv(ancien, ";").replace("Essai Ancienne", "Essai Éléonore"), "latin1")),
  ]).clientes[0];
  assert.equal(accentue?.lastName, "Essai Éléonore");
  assert.equal(separateurDe("a;b;c\n1,2;3"), ";");
  assert.equal(separateurDe('"a,b"\tc\td\n'), "\t");
  assert.equal(decoder("﻿Name"), "Name");
});

test("pays : le code d'aujourd'hui, jamais un code périmé", () => {
  assert.equal(codePays("France"), "FR", "et non « FX », la France métropolitaine d'avant 1997");
  assert.equal(codePays("Royaume-Uni"), "GB");
  assert.equal(codePays("United Kingdom"), "GB");
  assert.equal(codePays("Allemagne"), "DE");
  assert.equal(codePays("Russie"), "RU");
  assert.equal(codePays("Belgique"), "BE");
  assert.equal(codePays("Suisse"), "CH");
  assert.equal(codePays("fr"), "FR");
  assert.equal(codePays(""), null);
  assert.equal(codePays("Pays imaginaire"), "Pays imaginaire");
});

test("dates, montants et codes de l'export", () => {
  assert.equal(lireDate("2025-12-03 10:15:22 +0100")?.toISOString(), "2025-12-03T09:15:22.000Z");
  assert.equal(lireDate("2026-07-01 10:00:00 +0200")?.toISOString(), "2026-07-01T08:00:00.000Z");
  assert.equal(lireDate("2026-07-01T10:00:00+02:00")?.toISOString(), "2026-07-01T08:00:00.000Z");
  assert.equal(lireDate("2026-07-01 08:00:00 UTC")?.toISOString(), "2026-07-01T08:00:00.000Z");
  // Sans fuseau : l'heure de Paris (l'été, deux heures d'avance).
  assert.equal(lireDate("2026-07-01 10:00:00")?.toISOString(), "2026-07-01T08:00:00.000Z");
  assert.equal(lireDate("03/12/2025 10:15")?.toISOString(), "2025-12-03T09:15:00.000Z");
  assert.equal(lireDate("hier"), null);
  assert.equal(lireDate(""), null);
  assert.equal(centimes("51.90"), 5190);
  assert.equal(centimes("0.29"), 29);
  assert.equal(centimes("23,5"), 2350);
  assert.equal(centimes("1 234,50 €"), 123450);
  assert.equal(centimes("0.00"), 0);
  assert.equal(centimes(""), null);
  assert.equal(centimes("abc"), null);
});

/* -------------------------------------------------------------------------- */
/*  Regroupement                                                              */
/* -------------------------------------------------------------------------- */

test("regroupement : une commande = toutes ses lignes, champs pris sur la première", () => {
  const lu = lireDossier(dossierNatif());
  const { commandes, ecartees, doublons, lignes } = lireCommandes(lu.commandes);
  assert.equal(lignes, 16);
  assert.deepEqual(
    commandes.map((c) => c.nom),
    ["#1001", "#1002", "#1003", "#1004", "#1005", "#1006", "#1007", "#1008", "#1009", "#1010", "#1011"],
  );
  const c1001 = commandes[0]!;
  // Deux articles, et non quatre : la copie du second fichier n'est pas recollée.
  assert.deepEqual(c1001.articles.map((a) => a.titre), [
    "Affiche Essai - A4 (21 x 29.7 cm)",
    "VILLE-ESSAI Plage - Affiche personnalisée - A3 (29.7 x 42 cm)",
  ]);
  assert.deepEqual(doublons, ["#1001 (orders_export_2.csv)"]);
  assert.equal(c1001.idShopify, 5000000000001);
  assert.equal(c1001.email, "cliente.un@example.test");
  assert.equal(c1001.financier, "paid");
  assert.equal(c1001.expedition, "fulfilled");
  assert.equal(c1001.totalCents, 5190);
  assert.equal(c1001.portCents, 590);
  assert.equal(c1001.creeLe?.toISOString(), "2025-12-03T09:15:22.000Z");
  assert.equal(c1001.expedieLe?.toISOString(), "2025-12-05T08:00:00.000Z");
  assert.equal(c1001.livraison.codePostal, "59000");
  assert.equal(c1001.livraison.pays, "FR");
  assert.equal(c1001.note, 'Livrer, s\'il vous plaît, "avant Noël"');
  assert.deepEqual(c1001.etiquettes, ["cadeau"]);
  assert.equal(c1001.moyenPaiement, "Shopify Payments");
  // Coupée entre deux fichiers : recollée.
  const c1010 = commandes.find((c) => c.nom === "#1010")!;
  assert.deepEqual(c1010.articles.map((a) => a.titre), ["Affiche Essai - A4", "Affiche Essai - A3"]);
  assert.deepEqual(c1010.fichiers, ["orders_export_1.csv", "orders_export_2.csv"]);
  // Deux articles identiques sur une même ligne : une quantité, pas deux lignes.
  assert.equal(commandes.find((c) => c.nom === "#1006")!.articles[0]!.quantite, 2);
  assert.equal(ecartees.length, 1);
  assert.match(ecartees[0]!.raison, /ni numéro/);
});

test("Matrixify : « Top Row », « Line: Type », personnalisation et adresses multiples", () => {
  const d = dossierTemporaire();
  const CLI = ["ID", "Email", "First Name", "Last Name", "Accepts Marketing", "Top Row", "Address: Address 1", "Address: City", "Address: Zip", "Address: Country Code"];
  writeFileSync(
    join(d, "Customers.csv"),
    csv([
      CLI,
      ligne(CLI, { ID: "7000000000009", Email: "mx@example.test", "First Name": "Cliente", "Last Name": "Essai Mx", "Accepts Marketing": "yes", "Top Row": "TRUE", "Address: Address 1": "3 rue Essai", "Address: City": "Arras", "Address: Zip": "62000", "Address: Country Code": "FR" }),
      // Une seconde adresse de la même cliente : ni fiche, ni écart.
      ligne(CLI, { ID: "7000000000009", "Address: Address 1": "4 rue Essai", "Address: City": "Lens" }),
    ]),
  );
  const CMD = ["ID", "Name", "Email", "Created At", "Payment: Status", "Order Fulfillment Status", "Price: Total", "Price: Total Shipping", "Source", "Top Row", "Line: Type", "Line: Name", "Line: Quantity", "Line: Price", "Line: Product ID", "Line: Variant ID", "Line: Properties", "Fulfillment: Created At"];
  const perso = 'product: {"text"\\:{"title"\\:"Essai"},"background"\\:"https\\://example.test/fond.svg","view"\\:"front"}';
  writeFileSync(
    join(d, "Orders.csv"),
    csv([
      CMD,
      ligne(CMD, { ID: "6000000000001", Name: "#2001", Email: "mx@example.test", "Created At": "2024-05-01 10:00:00 +0200", "Payment: Status": "paid", "Order Fulfillment Status": "fulfilled", "Price: Total": "46.00", "Price: Total Shipping": "0.00", Source: "web", "Top Row": "TRUE", "Line: Type": "Line Item", "Line: Name": "Affiche Essai - A3", "Line: Quantity": "1", "Line: Price": "23.00", "Line: Product ID": "900001", "Line: Variant ID": "800002", "Line: Properties": perso }),
      ligne(CMD, { ID: "6000000000001", Name: "#2001", "Line: Type": "Line Item", "Line: Name": "Affiche Essai - A4", "Line: Quantity": "1", "Line: Price": "23.00", "Line: Product ID": "900001" }),
      ligne(CMD, { ID: "6000000000001", Name: "#2001", "Line: Type": "Transaction", "Line: Price": "46.00" }),
      ligne(CMD, { ID: "6000000000001", Name: "#2001", "Line: Type": "Fulfillment Line", "Fulfillment: Created At": "2024-05-02 09:00:00 +0200" }),
    ]),
  );
  const lu = lireDossier(d);
  assert.equal(lu.fichiers.format, "matrixify");
  const clientes = lireClientes(lu.clientes);
  assert.equal(clientes.clientes.length, 1);
  assert.equal(clientes.ecartees.length, 0);
  assert.equal(clientes.clientes[0]!.idShopify, 7000000000009);
  assert.equal(clientes.clientes[0]!.adresse?.city, "Arras");
  const { commandes } = lireCommandes(lu.commandes);
  assert.equal(commandes.length, 1);
  const c = commandes[0]!;
  assert.equal(c.articles.length, 2, "les transactions et expéditions ne sont pas des articles");
  assert.equal(c.expedieLe?.toISOString(), "2024-05-02T07:00:00.000Z");
  assert.equal(rattacher(c.articles[0]!, CATALOGUE).variantId, 12);
  assert.deepEqual(rattacher(c.articles[1]!, CATALOGUE), { productId: 1, variantId: 11, par: "shopify" });
  const plan = planifier(
    { clientes, commandes: lireCommandes(lu.commandes) },
    { ...etatFictif(), legacyIds: new Set(), legacyNames: new Set(), numeros: new Set() },
    MAINTENANT,
  );
  assert.equal(plan.bilan.articles.personnalises, 1);
  const config = plan.commandes[0]!.articles[0]!.config as { schemaVersion?: number; backgroundUrl?: string };
  assert.equal(config.schemaVersion, 1);
  assert.equal(config.backgroundUrl, "https://example.test/fond.svg");
});

/* -------------------------------------------------------------------------- */
/*  Statuts                                                                   */
/* -------------------------------------------------------------------------- */

test("statuts : toujours un statut clos, vente si et seulement si payée et non annulée", () => {
  const creeLe = new Date("2026-01-10T10:00:00Z");
  const payees = new Set(["paid", "partially_paid", "partially_refunded"]);
  for (const financier of ["paid", "partially_paid", "partially_refunded", "refunded", "voided", "pending", "authorized", "expired", ""])
    for (const expedition of ["fulfilled", "unfulfilled", "partial", "restocked", ""])
      for (const annulee of [false, true]) {
        const cas = `${financier}/${expedition}/${annulee ? "annulée" : "-"}`;
        const s = statutRepris({
          financier,
          expedition,
          creeLe,
          payeLe: null,
          expedieLe: null,
          annuleLe: annulee ? new Date("2026-01-11T10:00:00Z") : null,
        });
        // Jamais « pending », « authorized » ni « draft » : ni relance de
        // panier, ni liste « Impayées ».
        assert.ok(["paid", "cancelled", "voided"].includes(s.status), cas);
        assert.equal(s.vente, !annulee && payees.has(financier), cas);
        assert.equal(s.vente, s.status === "paid", cas);
        // Hors ventes pour les statistiques ⇔ hors ventes ici.
        assert.equal(HORS_VENTES.includes(s.status), !s.vente, cas);
        assert.equal(s.cancelledAt !== null, s.status === "cancelled", cas);
        assert.equal(s.archiver, !s.vente, cas);
        if (s.vente) {
          // Une vente n'est jamais « à traiter » : date de traitement et expédition.
          assert.ok(s.fulfilledAt, cas);
          assert.equal(s.expedier, true, cas);
          assert.equal(statutFinancier({ status: s.status, totalCents: 2300 }, 0), "paid", cas);
        } else {
          assert.equal(statutFinancier({ status: s.status, totalCents: 2300 }, 0), "voided", cas);
        }
      }
});

test("statuts : les dates retenues", () => {
  const base = {
    creeLe: new Date("2026-01-10T10:00:00Z"),
    payeLe: new Date("2026-01-10T10:05:00Z"),
    expedieLe: new Date("2026-01-12T10:00:00Z"),
    annuleLe: null,
  };
  assert.equal(statutRepris({ ...base, financier: "paid", expedition: "fulfilled" }).fulfilledAt, base.expedieLe);
  assert.equal(
    statutRepris({ ...base, expedieLe: null, financier: "paid", expedition: "unfulfilled" }).fulfilledAt,
    base.payeLe,
  );
  // Remboursée après expédition : partie, mais hors ventes.
  const remboursee = statutRepris({ ...base, financier: "refunded", expedition: "fulfilled" });
  assert.equal(remboursee.status, "voided");
  assert.equal(remboursee.expedier, true);
  assert.equal(remboursee.archiver, true);
  // Jamais payée ni partie : ni expédition, ni date de traitement.
  const impayee = statutRepris({ ...base, financier: "pending", expedition: "unfulfilled" });
  assert.equal(impayee.expedier, false);
  assert.equal(impayee.fulfilledAt, null);
});

test("canal : la caisse et la commande saisie à la main sont des ventes de stand", () => {
  assert.equal(canalRepris("web"), "web");
  assert.equal(canalRepris("pos"), "salon");
  assert.equal(canalRepris("shopify_draft_order"), "salon");
  assert.equal(canalRepris("580111"), "web");
  assert.equal(canalRepris(""), "web");
});

/* -------------------------------------------------------------------------- */
/*  Numérotation                                                              */
/* -------------------------------------------------------------------------- */

test("numéro : « #1001 » devient « SHOP-1001 », hors des séries du site", () => {
  assert.equal(numeroRepris("#1001", 5000000000001), "SHOP-1001");
  assert.equal(numeroRepris("#ML-1001/b", null), "SHOP-ML-1001-B");
  assert.equal(numeroRepris(null, 5000000000001), "SHOP-ID5000000000001");
  assert.equal(numeroRepris("", null), null);
  for (const numero of ["SHOP-1001", "SHOP-0042", "SHOP-ID5000000000001"]) {
    assert.doesNotMatch(numero, /^(WEB|SAL)-\d+$/);
    assert.doesNotMatch(numero, /^DRAFT-/);
  }
  // Le compteur du site ne les voit pas : la séquence ne bouge pas.
  assert.equal(numeroSuivant("WEB-", ["WEB-0041", "SHOP-1001", "SHOP-99999"]), "WEB-0042");
  assert.equal(numeroSuivant("SAL-", ["SAL-0007", "SHOP-0008", "SHOP-ID12"]), "SAL-0008");
  assert.equal(numeroSuivant("WEB-", ["SHOP-1001"]), "WEB-0001");
});

/* -------------------------------------------------------------------------- */
/*  Clientes                                                                  */
/* -------------------------------------------------------------------------- */

const lue = (v: Partial<ClienteLue>): ClienteLue => ({
  email: "cliente.essai@example.test",
  name: "Cliente Essai",
  firstName: "Cliente",
  lastName: "Essai",
  phone: "+33 6 00 00 00 09",
  note: "Note du fichier",
  tags: ["fidèle", "VIP"],
  abonnement: true,
  adresse: { line1: "9 rue des Essais", line2: null, postalCode: "59000", city: "Lille", country: "FR", phone: null },
  idShopify: 7000000000099,
  source: "clientes",
  ...v,
});

test("fusion : une fiche existante se complète, rien ne s'écrase, jamais réabonnée", () => {
  const existante = fiche({
    id: 7,
    email: "cliente.essai@example.test",
    name: "C. Essai (inscrite sur le site)",
    note: "Note de la boutique",
    tags: ["Fidèle"],
    acceptsMarketing: false,
    compte: true,
  });
  const p = planCliente(lue({}), existante, MAINTENANT, new Date("2024-01-01T00:00:00Z"));
  assert.equal(p.action, "mise-a-jour");
  assert.equal(p.ficheId, 7);
  assert.equal(p.creation, null);
  // Seulement ce qui était vide, et les étiquettes nouvelles.
  assert.deepEqual(p.maj, {
    phone: "+33 6 00 00 00 09",
    tags: ["Fidèle", "VIP"],
    legacyId: 7000000000099,
  });
  assert.ok(!("acceptsMarketing" in (p.maj ?? {})));
  assert.ok(!("marketingOptInAt" in (p.maj ?? {})));
  assert.equal(p.abonnementNonRepris, true);
  assert.equal(p.identifiantPose, true);
  // Le carnet était vide : l'adresse y entre, au nom de la fiche.
  assert.equal(p.adresse?.city, "Lille");
  assert.equal(p.adresse?.name, "C. Essai (inscrite sur le site)");

  // Un identifiant déjà posé n'est pas remplacé ; un carnet rempli non plus.
  const complete = fiche({
    ...existante,
    phone: "+33 6 11 11 11 11",
    tags: ["Fidèle", "VIP"],
    legacyId: 123,
    aUneAdresse: true,
    acceptsMarketing: true,
  });
  const q = planCliente(lue({}), complete, MAINTENANT, null);
  assert.equal(q.action, "inchange");
  assert.equal(q.maj, null);
  assert.equal(q.adresse, null);
  assert.equal(q.identifiantPose, false);
  assert.equal(q.abonnementNonRepris, false);

  // Une fiche abonnée que le fichier dit désabonnée garde son abonnement.
  const desabonnee = planCliente(lue({ abonnement: false }), complete, MAINTENANT, null);
  assert.equal(desabonnee.maj, null);
});

test("fusion : une fiche nouvelle prend l'abonnement du fichier et la date de sa première commande", () => {
  const premiere = new Date("2024-03-01T10:00:00Z");
  const p = planCliente(lue({}), undefined, MAINTENANT, premiere);
  assert.equal(p.action, "creation");
  assert.equal(p.creation?.email, "cliente.essai@example.test");
  assert.equal(p.creation?.acceptsMarketing, true);
  assert.equal(p.creation?.marketingOptInAt, MAINTENANT);
  assert.equal(p.creation?.legacyId, 7000000000099);
  assert.equal(p.creation?.createdAt, premiere);
  assert.equal(p.creation?.passwordHash, undefined, "pas de compte : pas de mot de passe");
  assert.equal(p.adresse?.isDefaultShipping, true);
  const sansAccord = planCliente(lue({ abonnement: null }), undefined, MAINTENANT, null);
  assert.equal(sansAccord.creation?.acceptsMarketing, false);
  assert.equal(sansAccord.creation?.marketingOptInAt, null);
  assert.equal(sansAccord.creation?.createdAt, MAINTENANT);
  // Désabonnée de la lettre sur le nouveau site : Shopify ne la réabonne pas.
  const desabonnee = planCliente(lue({}), undefined, MAINTENANT, null, true);
  assert.equal(desabonnee.action, "creation");
  assert.equal(desabonnee.creation?.acceptsMarketing, false);
  assert.equal(desabonnee.creation?.marketingOptInAt, null);
  assert.equal(desabonnee.abonnementNonRepris, true);
});

test("fusion : la fiche retenue pour une adresse, comme l'import du back-office", () => {
  const choix = choisirFiches([
    fiche({ id: 5, email: "Cliente.Essai@example.test" }),
    fiche({ id: 3, email: "cliente.essai@example.test", compte: true }),
    fiche({ id: 9, email: "autre@example.test" }),
    fiche({ id: 12, email: "autre@example.test" }),
  ]);
  assert.equal(choix.get("cliente.essai@example.test")?.id, 3, "celle qui a un compte");
  assert.equal(choix.get("autre@example.test")?.id, 12, "sinon la plus récente");
});

/* -------------------------------------------------------------------------- */
/*  Rattachement des articles                                                 */
/* -------------------------------------------------------------------------- */

const article = (v: Partial<ArticleLu>): ArticleLu => ({
  titre: "",
  quantite: 1,
  prixCents: 2300,
  sku: null,
  produitShopifyId: null,
  varianteShopifyId: null,
  proprietes: null,
  ...v,
});

test("rattachement : la référence, puis le titre coupé au dernier tiret", () => {
  assert.deepEqual(rattacher(article({ sku: " essai-a4 " }), CATALOGUE), { productId: 1, variantId: 11, par: "sku" });
  assert.deepEqual(
    rattacher(article({ titre: "VILLE-ESSAI Plage - Affiche personnalisée - A3 (29.7 x 42 cm)" }), CATALOGUE),
    { productId: 2, variantId: 22, par: "titre" },
  );
  // Casse, accents et tiret long : le même titre.
  assert.deepEqual(
    rattacher(article({ titre: "Ville-Essai plage – affiche personnalisee" }), CATALOGUE),
    { productId: 2, variantId: null, par: "titre" },
  );
  assert.deepEqual(rattacher(article({ titre: "Affiche Essai - A4" }), CATALOGUE), {
    productId: 1,
    variantId: 11,
    par: "titre",
  });
  // Une référence ou un nom portés par deux fiches ne rattachent rien.
  assert.deepEqual(rattacher(article({ sku: "DOUBLE", titre: "Doublon - A4" }), CATALOGUE), {
    productId: null,
    variantId: null,
    par: null,
  });
  assert.deepEqual(rattacher(article({ titre: "Article inconnu du catalogue" }), CATALOGUE), {
    productId: null,
    variantId: null,
    par: null,
  });
});

/* -------------------------------------------------------------------------- */
/*  Le plan entier                                                            */
/* -------------------------------------------------------------------------- */

function planDuDossier() {
  const lu = lireDossier(dossierNatif());
  const lecture = { clientes: lireClientes(lu.clientes), commandes: lireCommandes(lu.commandes) };
  return { lecture, plan: planifier(lecture, etatFictif(), MAINTENANT) };
}

test("plan : ce qui est créé, sauté et écarté", () => {
  const { plan } = planDuDossier();
  const b = plan.bilan.commandes;
  assert.deepEqual(
    plan.commandes.map((c) => c.numero),
    ["SHOP-1001", "SHOP-1002", "SHOP-1003", "SHOP-1004", "SHOP-1005", "SHOP-1006", "SHOP-1007", "SHOP-1008", "SHOP-1010"],
  );
  assert.equal(b.dejaPresentes, 1, "#1011 était déjà reprise");
  assert.equal(b.ecartees.length, 2);
  assert.ok(b.ecartees.some((e) => /#1009 : date de commande/.test(e.raison)));
  assert.equal(b.ventes, 5);
  assert.equal(b.horsVentes, 4);
  assert.equal(b.chiffreAffairesCents, 5190 + 1500 + 4600 + 1500 + 4600);
  assert.equal(b.salon, 2);
  assert.deepEqual(b.traiteesALaReprise, ["#1003"]);
  assert.equal(b.sansCliente, 1);
  assert.equal(b.remboursements, 2);

  const parNom = new Map(plan.commandes.map((c) => [c.lue.nom, c]));
  const c1001 = parNom.get("#1001")!;
  assert.equal(c1001.valeurs.status, "paid");
  assert.equal(c1001.valeurs.legacyId, 5000000000001);
  assert.equal(c1001.valeurs.legacyName, "#1001");
  assert.equal(c1001.valeurs.createdAt?.toISOString(), "2025-12-03T09:15:22.000Z");
  assert.equal(c1001.valeurs.shippingLabel, "Mondial Relay");
  assert.equal(c1001.valeurs.archivedAt, null);
  assert.deepEqual(
    c1001.articles.map((a) => [a.productId, a.variantId, a.par]),
    [
      [1, 11, "sku"],
      [2, 22, "titre"],
    ],
  );
  const c1002 = parNom.get("#1002")!;
  assert.equal(c1002.valeurs.status, "voided");
  assert.equal(c1002.remboursement?.amountCents, 2300);
  assert.equal(c1002.valeurs.archivedAt, MAINTENANT);
  const c1005 = parNom.get("#1005")!;
  assert.equal(c1005.valeurs.status, "cancelled");
  assert.equal(c1005.valeurs.cancelledAt?.toISOString(), "2026-01-02T12:00:00.000Z");
  assert.equal(c1005.valeurs.cancelReason, "Annulée dans Shopify");
  const c1006 = parNom.get("#1006")!;
  assert.equal(c1006.valeurs.status, "paid");
  assert.equal(c1006.remboursement?.amountCents, 1000);
  assert.equal(parNom.get("#1003")!.valeurs.channel, "salon");
  assert.equal(parNom.get("#1007")!.valeurs.status, "voided");
  assert.equal(parNom.get("#1008")!.emailCliente, null);
  assert.match(parNom.get("#1003")!.evenement, /Marquée traitée à la reprise/);
  assert.match(c1001.evenement, /Aucun courriel, aucune facture, aucune étiquette/);
});

test("plan : jamais « à traiter », jamais « nouvelle », jamais de facture", () => {
  const { plan } = planDuDossier();
  for (const c of plan.commandes) {
    const v = c.valeurs;
    const cas = c.numero;
    // Déjà vue, sans numéro ni date de facture.
    assert.equal(v.seenAt, MAINTENANT, cas);
    assert.equal(v.invoiceNumber, undefined, cas);
    assert.equal(v.invoicedAt, undefined, cas);
    assert.ok(["paid", "cancelled", "voided"].includes(v.status ?? ""), cas);
    // Ce que la liste des commandes calcule : articles et quantités parties.
    const articles = c.articles.reduce((s, a) => s + (a.quantity ?? 1), 0);
    const parties = c.expeditionLe ? articles : 0;
    const rembourse = c.remboursement?.amountCents ?? 0;
    const financier = statutFinancier({ status: v.status!, totalCents: v.totalCents! }, rembourse);
    if (c.statut.vente) {
      // Hors de « À traiter » (payée sans date de traitement) et de
      // « À expédier » / « Non traitées » (articles non partis).
      assert.ok(v.fulfilledAt, cas);
      assert.equal(statutExpedition(articles, parties), "fulfilled", cas);
      assert.ok(["paid", "partially_refunded"].includes(financier), cas);
      assert.equal(v.archivedAt, null, cas);
    } else {
      // Hors ventes : rangée aux archives, donc hors de toutes les listes de
      // travail, et jamais « Impayée ».
      assert.equal(v.archivedAt, MAINTENANT, cas);
      assert.equal(financier, "voided", cas);
    }
  }
});

test("plan : les clientes du fichier et celles vues seulement dans les commandes", () => {
  const { lecture, plan } = planDuDossier();
  const b = plan.bilan.clientes;
  assert.equal(b.creees, 3, "cliente.un, cliente.six, et l'invitée des commandes");
  assert.equal(b.completees, 1);
  assert.equal(b.depuisCommandes, 1);
  assert.equal(b.abonnementNonRepris, 1);
  const parEmail = new Map(plan.clientes.map((p) => [p.email, p]));
  const un = parEmail.get("cliente.un@example.test")!;
  assert.equal(un.creation?.acceptsMarketing, true);
  // Inscrite à la date de sa première commande, pas le jour de l'import.
  assert.equal(un.creation?.createdAt?.toISOString(), "2025-12-03T09:15:22.000Z");
  const deux = parEmail.get("cliente.deux@example.test")!;
  assert.equal(deux.ficheId, 40);
  assert.equal(deux.abonnementNonRepris, true);
  assert.ok(!("acceptsMarketing" in (deux.maj ?? {})));
  assert.equal(deux.maj?.legacyId, 7000000000002);
  assert.equal(deux.maj?.phone, "+33 6 00 00 00 02");
  assert.equal(deux.maj?.name, undefined, "le nom de la fiche reste le sien");
  const invitee = parEmail.get("invitee@example.test")!;
  assert.equal(invitee.source, "commandes");
  assert.equal(invitee.creation?.name, "Cliente Invitée");
  assert.equal(invitee.creation?.acceptsMarketing, true, "l'accord donné à la caisse Shopify");

  // La même, désabonnée depuis par le lien de la lettre : pas réabonnée.
  const apres = planifier(
    lecture,
    { ...etatFictif(), desabonnees: new Set(["invitee@example.test"]) },
    MAINTENANT,
  );
  const desabonnee = apres.clientes.find((p) => p.email === "invitee@example.test")!;
  assert.equal(desabonnee.creation?.acceptsMarketing, false);
  assert.equal(apres.bilan.clientes.abonnementNonRepris, 2);
  assert.equal(apres.bilan.clientes.abonneesCreees, b.abonneesCreees - 1);
});

test("plan : rejoué sur la base qu'il a écrite, il ne crée plus rien", () => {
  const { lecture, plan } = planDuDossier();
  const etat = etatFictif();
  const ids = new Set(etat.legacyIds);
  const noms = new Set(etat.legacyNames);
  const numeros = new Set(etat.numeros);
  for (const c of plan.commandes) {
    if (c.valeurs.legacyId) ids.add(c.valeurs.legacyId);
    if (c.valeurs.legacyName) noms.add(c.valeurs.legacyName);
    numeros.add(c.numero);
  }
  let id = 100;
  const fiches = [
    ...etat.fiches.map((f) => {
      const p = plan.clientes.find((x) => x.ficheId === f.id);
      return { ...f, ...(p?.maj ?? {}), aUneAdresse: f.aUneAdresse || !!p?.adresse } as FicheExistante;
    }),
    ...plan.clientes
      .filter((p) => p.creation)
      .map((p) =>
        fiche({
          id: id++,
          email: p.email,
          name: p.creation!.name ?? null,
          phone: p.creation!.phone ?? null,
          note: p.creation!.note ?? null,
          tags: p.creation!.tags ?? [],
          acceptsMarketing: p.creation!.acceptsMarketing ?? false,
          legacyId: p.creation!.legacyId ?? null,
          aUneAdresse: !!p.adresse,
        }),
      ),
  ];
  const second = planifier(
    lecture,
    { ...etat, fiches, legacyIds: ids, legacyNames: noms, numeros },
    MAINTENANT,
  );
  assert.equal(second.commandes.length, 0);
  assert.equal(second.bilan.commandes.dejaPresentes, plan.commandes.length + 1);
  assert.equal(second.bilan.clientes.creees, 0);
  assert.equal(second.bilan.clientes.completees, 0);
});

test("plan : un numéro déjà pris par une autre commande reprise est sauté", () => {
  const { lecture } = planDuDossier();
  const etat = { ...etatFictif(), numeros: new Set(["SHOP-1001", "SHOP-1011"]) };
  const plan = planifier(lecture, etat, MAINTENANT);
  assert.ok(!plan.commandes.some((c) => c.numero === "SHOP-1001"));
  assert.equal(plan.bilan.commandes.dejaPresentes, 2);
});
