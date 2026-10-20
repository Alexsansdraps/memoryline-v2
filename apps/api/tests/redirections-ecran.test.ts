/**
 * Les essais des règles de BO › Redirections, sans base de données.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/redirections-ecran.test.ts
 *
 * Ils vérifient ce que l'écran promet : une adresse saisie s'écrit comme le
 * site la compare, une cible n'est jamais autre chose qu'une page, pas de
 * boucle, un seul saut, un seul doublon vivant, et le fichier de Shopify lu
 * ligne par ligne. Toutes les données sont factices.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  affichesDesAdresses,
  lireAncienneAdresse,
  lireFichierRedirections,
  lireNouvelleAdresse,
  montrer,
  planDeSaisie,
  planDImport,
  type RedirectionVivante,
} from "../src/redirections-ecran.js";

const HOTES = ["memoryline.fr", "www.memoryline.fr", "localhost"];
const ancienne = (s: string) => lireAncienneAdresse(s, HOTES);
const nouvelle = (s: string) => lireNouvelleAdresse(s, HOTES);
const chemin = (s: string) => {
  const a = ancienne(s);
  assert.ok(a.ok, `${s} : ${a.ok ? "" : a.raison}`);
  return a.chemin;
};
const cible = (s: string) => {
  const n = nouvelle(s);
  assert.ok(n.ok, `${s} : ${n.ok ? "" : n.raison}`);
  return n.cible;
};

/* -------------------------------------------------------------------------- */
/*  Les adresses                                                              */
/* -------------------------------------------------------------------------- */

test("ancienne adresse : la forme sous laquelle le site la cherche", () => {
  assert.equal(chemin("/products/Vieux-Moulin/"), "/products/vieux-moulin");
  assert.equal(chemin("https://memoryline.fr/products/vieux-moulin?variant=12#avis"), "/products/vieux-moulin");
  assert.equal(chemin("https://memory-line.myshopify.com/collections/villes"), "/collections/villes");
  assert.equal(chemin("memoryline.fr/pages/cgv"), "/pages/cgv");
  assert.equal(chemin("products/vieux-moulin"), "/products/vieux-moulin");
  // La langue : le site la retire avant de chercher, et la remet devant la cible.
  assert.equal(chemin("/en/products/vieux-moulin"), "/products/vieux-moulin");
  // Un accent s'écrit comme le navigateur l'envoie ; un code déjà écrit ne se réencode pas.
  assert.equal(chemin("/products/café"), "/products/caf%c3%a9");
  assert.equal(chemin("/products/caf%C3%A9"), "/products/caf%c3%a9");
  // Les anciens plans du site sont les seuls fichiers que le site redirige.
  assert.equal(chemin("/sitemap_products_1.xml"), "/sitemap_products_1.xml");
});

test("ancienne adresse : ce qui ne se redirige pas", () => {
  for (const s of [
    "",
    "/",
    "/fr",
    "https://autre-site.fr/products/x",
    "autre-site.fr/products/x",
    "javascript:alert(1)",
    "//memoryline.fr/x",
    // La barre doublée qui survit au retrait du nom de la boutique.
    "https://memoryline.fr//x",
    "memoryline.fr//x",
    "/products/a /products/b",
    "/_astro/page.js",
    "/api/redirects",
    "/bo/redirections",
    "/catalogue.pdf",
    "/cdn/shop/files/vieux-moulin.jpg",
    "/x%zz",
    `/${"a".repeat(600)}`,
  ]) {
    const a = ancienne(s);
    assert.equal(a.ok, false, s);
  }
});

test("nouvelle adresse : chemin du site, fiche Shopify gardée sous sa forme, autre site", () => {
  assert.equal(cible("/Affiches/Colmar/"), "/affiches/colmar");
  // La fiche Shopify reste telle quelle ici : c'est le plan qui la suit, puis
  // la réécrit (voir « saisie : une cible Shopify… »). Ses paramètres tombent.
  assert.equal(cible("/products/colmar?variant=3"), "/products/colmar");
  assert.equal(cible("/collections/villes/products/colmar"), "/collections/villes/products/colmar");
  assert.equal(cible("/products"), "/products");
  assert.equal(cible("https://www.memoryline.fr/pages/cgv"), "/pages/cgv");
  assert.equal(cible("/en/affiches"), "/affiches");
  // La requête d'un rayon garde sa casse et sa forme.
  assert.equal(cible("/affiches?genre=personnalisable&collection=villes"), "/affiches?genre=personnalisable&collection=villes");
  // Le code d'une photo garde ses capitales : la page l'attend ainsi.
  assert.equal(cible("/photo/K7M2QX"), "/photo/K7M2QX");
  const externe = nouvelle("https://www.instagram.com/memoryline/");
  assert.ok(externe.ok && externe.externe);
  assert.equal(externe.ok && externe.cible, "https://www.instagram.com/memoryline/");
  // L'accueil est une cible permise.
  assert.equal(cible("/"), "/");
});

test("nouvelle adresse : jamais autre chose qu'une page", () => {
  for (const s of [
    "",
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox",
    "mailto:contact@memoryline.fr",
    "//evil.example/x",
    "evil.example/x",
    // Une adresse de la boutique ramenée à « //… » : le navigateur la lirait
    // comme un autre site (et « \ » vaut « / » pour lui).
    "https://memoryline.fr//evil.example/x",
    "memoryline.fr//evil.example",
    "https://memoryline.fr/\\evil.example",
    "https://moi:secret@evil.example/",
    "/a b",
    "/x%zz",
  ]) {
    const n = nouvelle(s);
    assert.equal(n.ok, false, s);
  }
});

/* -------------------------------------------------------------------------- */
/*  Une redirection saisie                                                    */
/* -------------------------------------------------------------------------- */

const vivantes: RedirectionVivante[] = [
  { id: 1, fromPath: "/affiches/colmar-ancien", toPath: "/affiches/colmar" },
  { id: 2, fromPath: "/products/strasbourg", toPath: "/affiches/colmar" },
  { id: 3, fromPath: "/pages/ancienne-faq", toPath: "/pages/faq?utm_source=qr" },
  // Un handle Shopify changé : posée telle que l'export l'écrit, cible réécrite.
  { id: 4, fromPath: "/products/moulin-ancien", toPath: "/affiches/vieux-moulin" },
];
/** La nouvelle adresse lue, puis le plan : le chemin que suivent les routes. */
const saisir = (de: string, vers: string, options?: Parameters<typeof planDeSaisie>[3], liste = vivantes) =>
  planDeSaisie(de, cible(vers), liste, options);

test("saisie : pas de boucle, ni directe ni par une redirection de la liste", () => {
  const directe = planDeSaisie("/affiches/x", "/affiches/x", vivantes);
  assert.equal(directe.ok, false);
  const parLaListe = planDeSaisie("/affiches/colmar", "/affiches/colmar-ancien", vivantes);
  assert.equal(parLaListe.ok, false);
  assert.match(!parLaListe.ok ? parLaListe.raison : "", /se renverraient/);
  // Une requête n'y change rien : A → A?x tournerait aussi en rond.
  assert.equal(planDeSaisie("/affiches/x", "/affiches/x?ref=1", vivantes).ok, false);
  // Ni sous sa forme Shopify : /products/x mène d'elle-même à /affiches/x.
  const parShopify = saisir("/affiches/x", "/products/x");
  assert.equal(parShopify.ok, false);
  assert.match(!parShopify.ok ? parShopify.raison : "", /d'elle-même/);
});

test("saisie : A → B?x quand B mène déjà à A est une boucle (le site compare sans la requête)", () => {
  const liste: RedirectionVivante[] = [{ id: 1, fromPath: "/colmar", toPath: "/strasbourg" }];
  const p = planDeSaisie("/strasbourg", "/colmar?utm_source=x", liste);
  assert.equal(p.ok, false);
  assert.match(!p.ok ? p.raison : "", /se renverraient/);
});

test("saisie : A → B?x quand B mène à C donne A → C?x, en un seul saut", () => {
  const liste: RedirectionVivante[] = [
    { id: 2, fromPath: "/b", toPath: "/c" },
    { id: 3, fromPath: "/rayon-villes", toPath: "/affiches?collection=villes" },
  ];
  const p = planDeSaisie("/a", "/b?utm_source=x", liste);
  assert.ok(p.ok);
  assert.equal(p.plan.toPath, "/c?utm_source=x");
  assert.match(p.plan.notes.join(" "), /un seul saut/);
  // La requête de la destination passe devant celle qui suit.
  const r = planDeSaisie("/a", "/rayon-villes?utm_source=lettre#haut", liste);
  assert.ok(r.ok);
  assert.equal(r.plan.toPath, "/affiches?collection=villes&utm_source=lettre#haut");
});

test("saisie : pas de doublon vivant sur la même ancienne adresse", () => {
  const p = planDeSaisie("/products/strasbourg", "/affiches/mulhouse", vivantes);
  assert.equal(p.ok, false);
  assert.equal(!p.ok && p.existante?.id, 2);
  assert.match(!p.ok ? p.raison : "", /Modifiez cette redirection-là/);
  // La modifier, elle, n'est pas un doublon d'elle-même.
  assert.equal(planDeSaisie("/products/strasbourg", "/affiches/mulhouse", vivantes, { soi: 2 }).ok, true);
  // Restaurer une ancienne dont l'adresse a été reprise : la phrase d'une restauration.
  const r = planDeSaisie("/products/strasbourg", "/affiches/mulhouse", vivantes, { soi: 99, pour: "restauration" });
  assert.match(!r.ok ? r.raison : "", /archivez-la d'abord, ou gardez celle-là/);
});

test("saisie : une cible redirigée est remplacée par sa destination finale (un seul saut)", () => {
  const p = planDeSaisie("/products/colmar-vieux", "/affiches/colmar-ancien", vivantes);
  assert.ok(p.ok);
  assert.equal(p.plan.toPath, "/affiches/colmar");
  assert.equal(p.plan.notes.length, 1);
});

test("saisie : une cible Shopify est suivie sous sa forme Shopify, puis réécrite", () => {
  // /products/moulin-ancien est redirigée dans la liste : on la suit AVANT
  // de réécrire, sans quoi « /affiches/moulin-ancien » mènerait à une 404.
  const p = saisir("/ancien-lien", "/products/moulin-ancien");
  assert.ok(p.ok);
  assert.equal(p.plan.toPath, "/affiches/vieux-moulin");
  assert.match(p.plan.notes.join(" "), /« \/products\/moulin-ancien » est elle-même redirigée/);
  // Sous sa collection, la même fiche, la même redirection (comme le site).
  const c = saisir("/ancien-lien", "/collections/villes/products/moulin-ancien");
  assert.ok(c.ok);
  assert.equal(c.plan.toPath, "/affiches/vieux-moulin");
  // Sans redirection : la fiche du nouveau site, comme le site le fait de lui-même.
  const libre = saisir("/ancien-lien", "/products/colmar?variant=3");
  assert.ok(libre.ok);
  assert.equal(libre.plan.toPath, "/affiches/colmar");
  assert.match(libre.plan.notes.join(" "), /Adresse Shopify « \/products\/colmar »/);
  // La même fiche que l'ancienne adresse : pas une boucle, la fiche du nouveau site.
  const meme = saisir("/collections/villes/products/thann", "/products/thann");
  assert.ok(meme.ok);
  assert.equal(meme.plan.toPath, "/affiches/thann");
});

test("saisie : celles qui menaient à l'ancienne adresse ne sont pas réécrites, l'écran le dit", () => {
  const p = planDeSaisie("/pages/faq", "/pages/questions", vivantes, { code: 302 });
  assert.ok(p.ok);
  assert.equal(p.plan.toPath, "/pages/questions");
  // Le plan n'écrit qu'elle : /pages/ancienne-faq garde sa cible, et le site
  // la conduit jusqu'à /pages/questions tant que celle-ci vit.
  assert.deepEqual(Object.keys(p.plan).sort(), ["fromPath", "notes", "toPath"]);
  const note = p.plan.notes.join(" ");
  assert.match(note, /« \/pages\/ancienne-faq » mène à « \/pages\/faq »/);
  assert.match(note, /302/);
  assert.match(note, /archiver cette redirection-ci la rendrait à « \/pages\/faq »/);
});

test("les adresses se montrent en clair, et s'enregistrent encodées", () => {
  assert.equal(montrer("/recette-caf%c3%a9"), "/recette-café");
  // Un « / » ou un « ? » encodés gardent leur sens : ils restent encodés.
  assert.equal(montrer("/a%2Fb%3Fc"), "/a%2Fb%3Fc");
  assert.equal(montrer("/x%zz"), "/x%zz");
  const p = planDeSaisie("/products/strasbourg", "/caf%c3%a9", vivantes);
  assert.match(!p.ok ? p.raison : "", /« \/products\/strasbourg » est déjà redirigée/);
});

/* -------------------------------------------------------------------------- */
/*  L'import                                                                  */
/* -------------------------------------------------------------------------- */

const AUCUNE_PAGE = new Map<string, string>();

test("fichier : l'export Redirects.csv de Shopify", () => {
  const lu = lireFichierRedirections(
    "﻿Redirect from,Redirect to\r\n/products/strasbourg,/products/colmar\r\n\r\n\"/pages/cgv\",\"/pages/conditions-de-vente\"\r\n",
  );
  assert.deepEqual(lu.entete, { ancienne: "Redirect from", nouvelle: "Redirect to" });
  assert.deepEqual(lu.lignes, [
    { ligne: 2, ancienne: "/products/strasbourg", nouvelle: "/products/colmar" },
    { ligne: 4, ancienne: "/pages/cgv", nouvelle: "/pages/conditions-de-vente" },
  ]);
});

test("fichier : deux colonnes « ancienne », « nouvelle », un tableur, un collage", () => {
  const fr = lireFichierRedirections("Nouvelle;Ancienne\n/affiches/b;/products/a\n");
  assert.deepEqual(fr.lignes, [{ ligne: 2, ancienne: "/products/a", nouvelle: "/affiches/b" }]);
  const tableur = lireFichierRedirections("/products/a\t/affiches/b\n/products/c\t/affiches/d");
  assert.equal(tableur.entete, null);
  assert.equal(tableur.lignes.length, 2);
  // Une ligne d'adresses n'est jamais prise pour un en-tête, même « /de,/vers ».
  assert.equal(lireFichierRedirections("/de,/vers\n").lignes.length, 1);
  const colle = lireFichierRedirections("/products/a /affiches/b\n/products/c → /affiches/d\n/products/e\n");
  assert.deepEqual(
    colle.lignes.map((l) => [l.ancienne, l.nouvelle]),
    [
      ["/products/a", "/affiches/b"],
      ["/products/c", "/affiches/d"],
    ],
  );
  assert.deepEqual(colle.illisibles.map((l) => l.ligne), [3]);
});

test("import : créée, déjà là, refusée — et pourquoi", () => {
  const lu = lireFichierRedirections(
    [
      "Redirect from,Redirect to",
      "/products/strasbourg,/products/colmar", // déjà dans la liste, même page
      "/products/mulhouse,/products/colmar", // créée, cible réécrite
      "/products/strasbourg,/affiches/nancy", // en double dans le fichier
      "/pages/contact-us,javascript:alert(1)", // cible refusée
      "/affiches/colmar,/affiches/mulhouse", // une affiche en vente
      // Pas une boucle : la cible devient /affiches/thann, la fiche du nouveau site.
      "/products/thann,/products/thann",
    ].join("\n"),
  );
  const pages = new Map([["/affiches/colmar", "l'affiche « Colmar », en vente"]]);
  const plan = planDImport(lu, vivantes, pages, HOTES);
  const actions = plan.apercu.map((l) => [l.ligne, l.action]);
  assert.deepEqual(actions, [
    [2, "deja-la"],
    [3, "creation"],
    [4, "refus"],
    [5, "refus"],
    [6, "refus"],
    [7, "creation"],
  ]);
  assert.deepEqual(plan.creer, [
    { fromPath: "/products/mulhouse", toPath: "/affiches/colmar" },
    { fromPath: "/products/thann", toPath: "/affiches/thann" },
  ]);
  assert.deepEqual(plan.compte, { creation: 2, "deja-la": 1, refus: 3 });
  assert.match(plan.apercu[4]!.raison ?? "", /en vente/);
});

test("import : une redirection déjà là vers une autre page n'est pas écrasée", () => {
  const lu = lireFichierRedirections("Redirect from,Redirect to\n/products/strasbourg,/affiches/nancy\n");
  const plan = planDImport(lu, vivantes, AUCUNE_PAGE, HOTES);
  assert.equal(plan.apercu[0]!.action, "refus");
  assert.match(plan.apercu[0]!.raison ?? "", /Déjà redirigée/);
  assert.deepEqual(plan.creer, []);
});

test("import : les chaînes du fichier se résolvent, ses boucles se refusent", () => {
  const lu = lireFichierRedirections(
    ["Redirect from,Redirect to", "/a,/b", "/b,/c", "/x,/y", "/y,/x"].join("\n"),
  );
  const plan = planDImport(lu, [], AUCUNE_PAGE, HOTES);
  assert.deepEqual(plan.creer, [
    { fromPath: "/a", toPath: "/c" },
    { fromPath: "/b", toPath: "/c" },
  ]);
  assert.deepEqual(
    plan.apercu.filter((l) => l.action === "refus").map((l) => l.ligne),
    [4, 5],
  );
});

test("import : ce qui menait à une ancienne adresse du fichier n'est pas réécrit, la ligne le dit", () => {
  const lu = lireFichierRedirections("Redirect from,Redirect to\n/pages/faq,/pages/questions\n");
  const plan = planDImport(lu, vivantes, AUCUNE_PAGE, HOTES);
  assert.deepEqual(plan.creer, [{ fromPath: "/pages/faq", toPath: "/pages/questions" }]);
  assert.deepEqual(Object.keys(plan).sort(), ["apercu", "compte", "creer"]);
  assert.match(plan.apercu[0]!.notes.join(" "), /« \/pages\/ancienne-faq » mène à « \/pages\/faq »/);
});

test("import : une chaîne Shopify (handle changé deux fois) se suit avant la réécriture", () => {
  // Le cas relevé en recette : sans cela, la ligne 2 menait à
  // /affiches/recette-supprimee, une page introuvable.
  const lu = lireFichierRedirections(
    [
      "Redirect from,Redirect to",
      "/products/recette-alias,/products/recette-supprimee",
      "/products/recette-supprimee,/products/vieux-moulin-affiche-personnalisee",
      // Par la liste : /products/moulin-ancien y est déjà redirigée.
      "/collections/villes/products/recette-lien,/products/moulin-ancien",
      // Une boucle sous forme Shopify, dans le fichier même.
      "/products/p1,/collections/villes/products/p2",
      "/products/p2,/products/p1",
    ].join("\n"),
  );
  const plan = planDImport(lu, vivantes, AUCUNE_PAGE, HOTES);
  assert.deepEqual(plan.creer, [
    { fromPath: "/products/recette-alias", toPath: "/affiches/vieux-moulin-affiche-personnalisee" },
    { fromPath: "/products/recette-supprimee", toPath: "/affiches/vieux-moulin-affiche-personnalisee" },
    { fromPath: "/collections/villes/products/recette-lien", toPath: "/affiches/vieux-moulin" },
  ]);
  assert.match(plan.apercu[0]!.notes.join(" "), /« \/products\/recette-supprimee » est elle-même redirigée \(ligne 3\)/);
  assert.deepEqual(
    plan.apercu.filter((l) => l.action === "refus").map((l) => l.ligne),
    [5, 6],
  );
});

test("import : l'ancienne adresse Shopify d'une affiche en vente se refuse comme l'affiche", () => {
  // La correspondance que fait pagesQuiExistent avant de lire la base.
  const designees = affichesDesAdresses([
    "/products/senlis-rues",
    "/collections/villes/products/senlis-rues",
    "/affiches/senlis-rues",
    "/pages/cgv",
  ]);
  assert.deepEqual(designees.get("senlis-rues"), [
    { chemin: "/products/senlis-rues", shopify: true },
    { chemin: "/collections/villes/products/senlis-rues", shopify: true },
    { chemin: "/affiches/senlis-rues", shopify: false },
  ]);
  assert.equal(designees.size, 1);
  const lu = lireFichierRedirections(
    "Redirect from,Redirect to\n/products/senlis-rues,/products/vieux-moulin\n/collections/villes/products/senlis-rues,/affiches\n",
  );
  const pages = new Map([
    ["/products/senlis-rues", "l'ancienne adresse Shopify de l'affiche « Senlis », toujours en vente"],
    ["/collections/villes/products/senlis-rues", "l'ancienne adresse Shopify de l'affiche « Senlis », toujours en vente"],
  ]);
  const plan = planDImport(lu, vivantes, pages, HOTES);
  assert.deepEqual(plan.apercu.map((l) => l.action), ["refus", "refus"]);
  assert.match(plan.apercu[0]!.raison ?? "", /toujours en vente/);
  assert.deepEqual(plan.creer, []);
});
