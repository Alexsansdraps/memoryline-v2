/**
 * Les essais des redirections posées quand l'adresse d'une affiche change,
 * sans base de données.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/redirections.test.ts
 *
 * Ils vérifient les trois règles de redirections.ts sur le plan, la fonction
 * pure : l'ancienne adresse mène à la nouvelle, un seul saut, et jamais une
 * redirection qui détournerait une fiche vivante (donc jamais de boucle).
 * Toutes les données sont factices.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normaliserChemin,
  planDesRedirections,
  redirectionsALiberer,
  type RedirectionActive,
} from "../src/redirections.js";

/** Applique un plan à une table en mémoire, comme le ferait poserRedirection. */
function appliquer(
  table: (RedirectionActive & { archivee?: boolean })[],
  ancien: string,
  nouveau: string,
) {
  const vivantes = table.filter((r) => !r.archivee);
  const plan = planDesRedirections(ancien, nouveau, vivantes);
  for (const id of plan.archiver) table.find((r) => r.id === id)!.archivee = true;
  for (const r of plan.repointer) table.find((x) => x.id === r.id)!.toPath = r.toPath;
  if (plan.poser)
    table.push({ id: table.length + 1, fromPath: plan.poser.fromPath, toPath: plan.poser.toPath });
  return plan;
}

/** Où mène une adresse, en suivant la table vivante (au plus 10 sauts). */
function suivre(table: (RedirectionActive & { archivee?: boolean })[], chemin: string): string[] {
  const parcours = [chemin];
  let ici = normaliserChemin(chemin);
  for (let i = 0; i < 10; i++) {
    const r = table.find((x) => !x.archivee && normaliserChemin(x.fromPath) === ici);
    if (!r) break;
    ici = normaliserChemin(r.toPath);
    parcours.push(ici);
  }
  return parcours;
}

test("A → B pose une seule 301 de l'ancienne adresse vers la nouvelle", () => {
  const plan = planDesRedirections("colmar", "colmar-alsace", []);
  assert.deepEqual(plan.poser, {
    fromPath: "/affiches/colmar",
    toPath: "/affiches/colmar-alsace",
    code: 301,
  });
  assert.deepEqual(plan.archiver, []);
  assert.deepEqual(plan.repointer, []);
});

test("une adresse inchangée ne pose rien", () => {
  const plan = planDesRedirections("colmar", "colmar", []);
  assert.equal(plan.poser, null);
});

test("A → B puis B → C donne A → C et B → C (un seul saut)", () => {
  const table: (RedirectionActive & { archivee?: boolean })[] = [];
  appliquer(table, "a", "b");
  appliquer(table, "b", "c");
  const vivantes = table.filter((r) => !r.archivee);
  assert.deepEqual(
    vivantes.map((r) => [r.fromPath, r.toPath]).sort(),
    [
      ["/affiches/a", "/affiches/c"],
      ["/affiches/b", "/affiches/c"],
    ],
  );
  assert.deepEqual(suivre(table, "/affiches/a"), ["/affiches/a", "/affiches/c"]);
});

test("une redirection partant du nouveau slug est archivée (la fiche vivante passe devant)", () => {
  const table: (RedirectionActive & { archivee?: boolean })[] = [];
  appliquer(table, "a", "b");
  // L'affiche revient à son ancien nom : /affiches/a doit rouvrir la fiche.
  const plan = appliquer(table, "b", "a");
  assert.deepEqual(plan.archiver, [1]);
  assert.equal(table[0]!.archivee, true);
  assert.deepEqual(suivre(table, "/affiches/a"), ["/affiches/a"]);
  assert.deepEqual(suivre(table, "/affiches/b"), ["/affiches/b", "/affiches/a"]);
});

test("aucune boucle, même après une suite de renommages croisés", () => {
  const table: (RedirectionActive & { archivee?: boolean })[] = [];
  const suite = ["a", "b", "c", "a", "d", "b", "e", "c"];
  for (let i = 1; i < suite.length; i++) appliquer(table, suite[i - 1]!, suite[i]!);
  const actuel = suite[suite.length - 1]!;
  for (const r of table.filter((x) => !x.archivee)) {
    const chemin = suivre(table, r.fromPath);
    // Chaque ancienne adresse mène à la fiche actuelle, en un saut.
    assert.equal(chemin.length, 2, r.fromPath);
    assert.equal(chemin[1], `/affiches/${actuel}`);
  }
  // L'adresse actuelle n'est redirigée nulle part.
  assert.deepEqual(suivre(table, `/affiches/${actuel}`), [`/affiches/${actuel}`]);
});

test("une redirection posée à la main sur l'ancienne adresse suit, requête comprise", () => {
  const existantes: RedirectionActive[] = [
    { id: 7, fromPath: "/products/colmar", toPath: "/affiches/colmar?utm_source=qr" },
    { id: 8, fromPath: "/Affiches/Colmar/", toPath: "/affiches/autre" },
    { id: 9, fromPath: "/pages/sans-rapport", toPath: "/contact" },
  ];
  const plan = planDesRedirections("colmar", "colmar-alsace", existantes);
  assert.deepEqual(plan.repointer, [
    { id: 7, toPath: "/affiches/colmar-alsace?utm_source=qr" },
  ]);
  // Partant de l'ancienne adresse (casse et barre finale mises de côté) :
  // remplacée par celle que l'on pose.
  assert.deepEqual(plan.archiver, [8]);
});

test("une affiche créée à une adresse quittée la reprend : la redirection qui en part s'archive", () => {
  const table: (RedirectionActive & { archivee?: boolean })[] = [];
  // « colmar » est renommée : colmar → colmar-cathedrale.
  appliquer(table, "colmar", "colmar-cathedrale");
  table.push({ id: 2, fromPath: "/Affiches/Colmar/", toPath: "/affiches/autre" });
  table.push({ id: 3, fromPath: "/affiches/colmar-2", toPath: "/affiches/colmar" });
  // Puis une nouvelle affiche « COLMAR » naît (création, copie ou import).
  const ids = redirectionsALiberer("colmar", table.filter((r) => !r.archivee));
  for (const id of ids) table.find((r) => r.id === id)!.archivee = true;
  // Seules celles qui PARTENT de /affiches/colmar (casse et barre finale
  // mises de côté) ; colmar-2 n'est pas la même adresse.
  assert.deepEqual(ids.sort(), [1, 2]);
  assert.deepEqual(suivre(table, "/affiches/colmar"), ["/affiches/colmar"]);
  assert.deepEqual(suivre(table, "/affiches/colmar-2"), ["/affiches/colmar-2", "/affiches/colmar"]);
});
