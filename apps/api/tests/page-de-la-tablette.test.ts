/**
 * La tablette d'un stand n'affiche que la page de son stand (18/11), sans
 * base de données.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/page-de-la-tablette.test.ts
 *
 * Alexandra : « quand je vais sur memoryline.fr/?stand=1, je dois avoir que
 * la page /mulhouse. Il faut qu'un stand ait une page attribuée et une
 * seule ! ». Ce que ces tests gardent :
 *   - la valeur de `?stand=` (le numéro du stand) et ce qu'elle désigne ;
 *   - les adresses que la tablette garde ouvertes (sa page, la fiche de ses
 *     affiches, le panier, la caisse) et celles qui y ramènent ;
 *   - la relecture des affiches choisies une à une (ordre, doublons,
 *     plafond) et de leur rangement par collection ;
 *   - la liste des affiches alsaciennes de la migration 0101 (Mulhouse
 *     d'abord, cas limites laissés dehors).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  affichesDesSections,
  dansLOrdreChoisi,
  lireAffichesChoisies,
  lireSections,
} from "../src/cms.js";
import {
  cheminPermisALaTablette,
  numeroDuStand,
  valeurDuStand,
} from "../../../packages/types/src/index.ts";

/* -------------------------------------------------------------------------- */
/*  La valeur de ?stand=                                                       */
/* -------------------------------------------------------------------------- */

test("valeurDuStand : la valeur recopiée dans les liens de la tablette", () => {
  assert.equal(valeurDuStand("1"), "1");
  assert.equal(valeurDuStand("12"), "12");
  // Un aperçu du back-office : le mode stand, sans aucun stand.
  assert.equal(valeurDuStand("apercu"), "apercu");
  // Illisible : l'ancienne valeur, jamais du texte recopié tel quel.
  assert.equal(valeurDuStand(""), "1");
  assert.equal(valeurDuStand(null), "1");
  assert.equal(valeurDuStand("a b"), "1");
  assert.equal(valeurDuStand('"><script>'), "1");
  assert.equal(valeurDuStand("x".repeat(21)), "1");
});

test("numeroDuStand : seul un numéro désigne un stand", () => {
  // L'ancienne adresse de la tablette (?stand=1) : le stand n° 1, Mulhouse.
  assert.equal(numeroDuStand("1"), 1);
  assert.equal(numeroDuStand("12"), 12);
  assert.equal(numeroDuStand("0"), null);
  assert.equal(numeroDuStand("01"), null);
  assert.equal(numeroDuStand("-3"), null);
  assert.equal(numeroDuStand("1.5"), null);
  assert.equal(numeroDuStand("apercu"), null);
  assert.equal(numeroDuStand(undefined), null);
});

/* -------------------------------------------------------------------------- */
/*  Ce que la tablette garde ouvert                                           */
/* -------------------------------------------------------------------------- */

const pageMulhouse = {
  slug: "mulhouse",
  affiches: [
    "mulhouse-hotel-de-ville-affiche-personnalisee",
    "noel-alsacien-affiche-personnalisee",
  ],
};

test("cheminPermisALaTablette : la page du stand, ses affiches, le panier, la caisse", () => {
  const ouverts = [
    "/pages/mulhouse",
    "/pages/mulhouse/",
    "/pages/MULHOUSE",
    "/affiches/mulhouse-hotel-de-ville-affiche-personnalisee",
    "/affiches/NOEL-ALSACIEN-affiche-personnalisee",
    "/panier",
    "/commande",
    "/404",
  ];
  for (const chemin of ouverts)
    assert.equal(cheminPermisALaTablette(chemin, pageMulhouse), true, chemin);
});

test("cheminPermisALaTablette : tout le reste ramène à la page", () => {
  const fermes = [
    "/",
    "/affiches",
    "/affiches/paris-tour-eiffel-affiche-personnalisee",
    "/affiches/mulhouse-hotel-de-ville-affiche-personnalisee/autre",
    "/pages/autre-page",
    "/pages/mulhouse/autre",
    "/recherche",
    "/carte-cadeau",
    "/contact",
    "/compte",
    "/compte/connexion",
    "/affiches/%E2%28",
  ];
  for (const chemin of fermes)
    assert.equal(cheminPermisALaTablette(chemin, pageMulhouse), false, chemin);
});

/* -------------------------------------------------------------------------- */
/*  Les affiches choisies une à une                                           */
/* -------------------------------------------------------------------------- */

test("lireAffichesChoisies : l'ordre voulu, sans doublon", () => {
  assert.deepEqual(lireAffichesChoisies(["3", "1", "3", " 2 "], "La page"), ["3", "1", "2"]);
  assert.deepEqual(lireAffichesChoisies([3, 1], "La page"), ["3", "1"]);
  assert.deepEqual(lireAffichesChoisies([], "La page"), []);
});

test("lireAffichesChoisies : un numéro illisible ou trop d'affiches sont refusés", () => {
  assert.throws(() => lireAffichesChoisies(["abc"], "La page"), /n'a pas pu être reconnue/);
  assert.throws(() => lireAffichesChoisies(["0"], "La page"), /n'a pas pu être reconnue/);
  assert.throws(() => lireAffichesChoisies("1,2", "La page"), /n'a pas pu être lue/);
  const trop = Array.from({ length: 201 }, (_, i) => String(i + 1));
  assert.throws(() => lireAffichesChoisies(trop, "La page"), /au plus 200 affiches/);
  assert.equal(lireAffichesChoisies(trop.slice(0, 200), "La page").length, 200);
});

test("lireSections : une section par collection, chaque affiche une fois", () => {
  const sections = lireSections(
    [
      { collection: "villes", affiches: ["1", "2"] },
      { collection: "", affiches: ["2", "4"] },
      { collection: "villes", affiches: ["3"] },
      { collection: "balades-paysages", affiches: ["1"] },
    ],
    "La page",
  );
  // « 2 » reste dans « villes », où il a été rangé d'abord ; la section
  // « balades-paysages », vidée par le doublon, disparaît.
  assert.deepEqual(sections, [
    { collection: "villes", affiches: ["1", "2", "3"] },
    { collection: "", affiches: ["4"] },
  ]);
  assert.deepEqual(affichesDesSections(sections), ["1", "2", "3", "4"]);
  assert.throws(() => lireSections([{ collection: "Villes !", affiches: ["1"] }], "La page"), /pas pu être reconnue/);
  assert.throws(() => lireSections("villes", "La page"), /pas pu être lu/);
});

test("dansLOrdreChoisi : l'ordre de la page, sans les affiches disparues", () => {
  const lignes = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.deepEqual(dansLOrdreChoisi(lignes, ["3", "9", "1"]), [{ id: 3 }, { id: 1 }]);
  assert.deepEqual(dansLOrdreChoisi(lignes, []), []);
});

/* -------------------------------------------------------------------------- */
/*  La page « mulhouse » de la migration 0101                                 */
/* -------------------------------------------------------------------------- */

test("migration 0101 : les affiches alsaciennes, Mulhouse d'abord, sans les cas limites", () => {
  const ici = dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(join(ici, "..", "drizzle", "0101_page_mulhouse.sql"), "utf8");
  const tableau = /unnest\(ARRAY\[([\s\S]*?)\]::text\[\]\)/.exec(sql)?.[1] ?? "";
  const slugs = [...tableau.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]!);
  assert.equal(slugs.length, 64);
  assert.equal(new Set(slugs).size, slugs.length, "aucune affiche deux fois");
  // Les 18 affiches de Mulhouse en tête, et aucune plus loin.
  assert.ok(slugs.slice(0, 18).every((s) => s.startsWith("mulhouse-")));
  assert.ok(slugs.slice(18).every((s) => !s.startsWith("mulhouse-")));
  // Les cas limites restent dehors.
  for (const dehors of ["bale", "fribourg", "bresse", "vosges"])
    assert.ok(!slugs.some((s) => s.includes(dehors)), dehors);
  // Le garde-fou du stand : un seul stand non archivé « Mulhouse ».
  assert.match(sql, /count\(\*\) FROM "stand" x WHERE x\."archived_at" IS NULL AND x\."nom" ILIKE '%mulhouse%'\) = 1/);
  // La page existante n'est pas réécrite : on ajoute seulement, sans grille déjà posée.
  assert.match(sql, /NOT \(pg\."blocks" @> '\[\{"type": "produits"\}\]'::jsonb\)/);
});
