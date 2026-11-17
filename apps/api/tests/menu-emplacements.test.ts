/**
 * Les deux menus du site — le haut et le pied de page —, sans base de données.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/menu-emplacements.test.ts
 *
 * Le pied de page vit dans la même table que le menu du haut (migration
 * 0086). Ce qu'ils gardent : enregistrer l'un ne doit JAMAIS archiver,
 * déplacer ni toucher une entrée de l'autre. L'enregistrement réécrit tout
 * l'arbre et archive ce qui manque : une seule requête oubliée sans son
 * emplacement viderait l'autre menu. Ils vérifient aussi la lecture d'un
 * arbre du pied de page (titres de colonne sans adresse, 4 colonnes au plus)
 * et que le rangement des pages (menu-ordre.ts) ne mêle pas les deux menus.
 * Toutes les données sont factices.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isNull, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as schema from "../src/db/schema.js";
import {
  COLONNES_PIED_MAX,
  aRanger,
  duMenu,
  lireArbreMenu,
  lireEmplacement,
} from "../src/cms.js";
import { menuSuitLOrdre } from "../src/menu-ordre.js";

const dialecte = new PgDialect();
const requete = (condition: SQL) => dialecte.sqlToQuery(condition);

/* -------------------------------------------------------------------------- */
/*  L'emplacement demandé                                                     */
/* -------------------------------------------------------------------------- */

test("lireEmplacement : absent, c'est le haut ; « pied » ; rien d'autre", () => {
  assert.equal(lireEmplacement(undefined), "haut");
  assert.equal(lireEmplacement(""), "haut");
  assert.equal(lireEmplacement("haut"), "haut");
  assert.equal(lireEmplacement("pied"), "pied");
  assert.equal(lireEmplacement(" Pied "), "pied");
  // Deviner reviendrait à écrire dans l'autre menu.
  assert.throws(() => lireEmplacement("bas"), /Le menu « bas » n'existe pas : c'est « haut » ou « pied »/);
  assert.throws(() => lireEmplacement("haut,pied"), /n'existe pas/);
});

/* -------------------------------------------------------------------------- */
/*  Chaque requête reste dans son menu                                        */
/* -------------------------------------------------------------------------- */

test("duMenu : l'emplacement d'abord, puis ce qu'on demande", () => {
  const { sql, params } = requete(duMenu("pied", isNull(schema.menuItems.archivedAt)));
  assert.equal(sql, '("menu_item"."emplacement" = $1 and "menu_item"."archived_at" is null)');
  assert.deepEqual(params, ["pied"]);
  assert.deepEqual(requete(duMenu("haut")).params, ["haut"]);
});

test("aRanger : le ménage d'un enregistrement ne sort jamais de son menu", () => {
  const pied = requete(aRanger("pied", [15, 16, 17]));
  assert.equal(
    pied.sql,
    '("menu_item"."emplacement" = $1 and "menu_item"."id" not in ($2, $3, $4) and "menu_item"."archived_at" is null)',
  );
  assert.deepEqual(pied.params, ["pied", 15, 16, 17]);
  // Le pied de page vidé exprès : tout CE menu part aux archives, et lui seul.
  const vide = requete(aRanger("pied", []));
  assert.equal(vide.sql, '("menu_item"."emplacement" = $1 and "menu_item"."archived_at" is null)');
  assert.deepEqual(vide.params, ["pied"]);
  // Le même geste sur le haut ne vise que le haut.
  assert.deepEqual(requete(aRanger("haut", [])).params, ["haut"]);
  assert.deepEqual(requete(aRanger("haut", [8, 9])).params, ["haut", 8, 9]);
});

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Le corps d'une route, de sa déclaration à la suivante (comme numeros-commande.test.ts). */
function corpsDeRoute(source: string, declaration: string): string {
  const debut = source.indexOf(declaration);
  assert.ok(debut >= 0, `route introuvable : ${declaration}`);
  const suite = source.slice(debut + declaration.length).search(/\n {2}app\.(get|post|put|delete)\(/);
  return source.slice(debut, suite < 0 ? undefined : debut + declaration.length + suite);
}

test("les routes du menu : aucune requête sur menu_item sans son emplacement", () => {
  const cms = readFileSync(join(SRC, "cms.ts"), "utf8");
  const routes = [
    'app.get("/menu"',
    'app.get("/admin/menu"',
    'app.post("/admin/menu"',
    'app.post("/admin/menu/:id/restaurer"',
    'app.delete("/admin/menu/:id"',
  ];
  for (const declaration of routes) {
    const corps = corpsDeRoute(cms, declaration);
    // Chaque route lit l'emplacement demandé.
    assert.match(corps, /lireEmplacement\(c\.req\.query\("emplacement"\)\)/, declaration);
    const requetes = [...corps.matchAll(/\.(from|update|delete)\(schema\.menuItems\)/g)];
    assert.ok(requetes.length > 0, `${declaration} : aucune requête trouvée`);
    for (const r of requetes) {
      // La condition qui suit la requête, avant la fin de l'instruction.
      const suite = corps.slice(r.index! + r[0].length);
      const fin = suite.search(/;|\)\[0\]/);
      const instruction = suite.slice(0, fin < 0 ? undefined : fin);
      const where = /\.where\(\s*(\w+)\(/.exec(instruction);
      assert.ok(where, `${declaration} : « ${r[0]} » sans .where()`);
      assert.ok(
        where[1] === "duMenu" || where[1] === "aRanger",
        `${declaration} : « ${r[0]} » filtré par ${where[1]}(), pas par duMenu()`,
      );
    }
  }
  // Une entrée créée naît dans le menu qu'on enregistre.
  assert.match(corpsDeRoute(cms, 'app.post("/admin/menu"'), /const donnees = \{\s*emplacement,/);
  // Le site ne prend pour pied de page qu'une réponse qui se dit « pied » :
  // GET /menu dit quel menu il rend.
  assert.match(corpsDeRoute(cms, 'app.get("/menu"'), /c\.json\(\{[\s\S]*?\bemplacement,\s*entrees:/);
});

test("le rayon d'une affiche (maillage.ts) ne se lit que dans le menu du haut", () => {
  const maillage = readFileSync(join(SRC, "maillage.ts"), "utf8");
  assert.match(maillage, /eq\(schema\.menuItems\.emplacement, "haut"\)/);
});

/* -------------------------------------------------------------------------- */
/*  La lecture d'un arbre du pied de page                                     */
/* -------------------------------------------------------------------------- */

const lien = (label: string, href: string, extra: Record<string, unknown> = {}) => ({
  label,
  href,
  ...extra,
});
const colonne = (label: string, enfants: unknown[] = [], extra: Record<string, unknown> = {}) => ({
  label,
  href: "",
  enfants,
  ...extra,
});

test("pied : un titre de colonne sans adresse est accepté, ses liens en exigent une", () => {
  const { voulues } = lireArbreMenu(
    [colonne("Aide et informations", [lien("Nous contacter", "/contact")])],
    "pied",
  );
  assert.equal(voulues.length, 1);
  assert.equal(voulues[0]!.href, "");
  assert.equal(voulues[0]!.enfants[0]!.href, "/contact");
  // Un titre de colonne PEUT mener quelque part : son adresse est alors relue.
  assert.equal(
    lireArbreMenu([lien("Aide", "/pages/aide", { enfants: [] })], "pied").voulues[0]!.href,
    "/pages/aide",
  );
  assert.throws(
    () => lireArbreMenu([colonne("Aide", [lien("Cookies", "")])], "pied"),
    /L'entrée « Cookies » ne peut pas rester vide/,
  );
  assert.throws(
    () => lireArbreMenu([lien("Aide", "//ailleurs.example")], "pied"),
    /ne mène nulle part/,
  );
});

test("haut : une entrée sans adresse reste refusée, au premier niveau comme dessous", () => {
  assert.throws(
    () => lireArbreMenu([colonne("Affiches")], "haut"),
    /L'entrée « Affiches » ne peut pas rester vide/,
  );
  assert.throws(
    () => lireArbreMenu([lien("Affiches", "/affiches", { enfants: [lien("Villes", " ")] })], "haut"),
    /L'entrée « Villes » ne peut pas rester vide/,
  );
});

test(`pied : ${COLONNES_PIED_MAX} colonnes visibles au plus ; une colonne masquée ne compte pas`, () => {
  const colonnes = (n: number) =>
    Array.from({ length: n }, (_, i) => colonne(`Colonne ${i + 1}`, [lien("Contact", "/contact")]));
  assert.equal(lireArbreMenu(colonnes(COLONNES_PIED_MAX), "pied").voulues.length, COLONNES_PIED_MAX);
  assert.throws(
    () => lireArbreMenu(colonnes(COLONNES_PIED_MAX + 1), "pied"),
    new RegExp(
      `Le pied de page affiche au plus ${COLONNES_PIED_MAX} colonnes, et ${COLONNES_PIED_MAX + 1} sont visibles\\. ` +
        "Masquez-en une",
    ),
  );
  const uneMasquee = [...colonnes(COLONNES_PIED_MAX), colonne("En préparation", [], { visible: false })];
  assert.equal(lireArbreMenu(uneMasquee, "pied").voulues.length, COLONNES_PIED_MAX + 1);
  // Le haut n'a pas de colonnes : la limite ne le concerne pas.
  const entrees = Array.from({ length: 6 }, (_, i) => lien(`Entrée ${i + 1}`, "/affiches"));
  assert.equal(lireArbreMenu(entrees, "haut").voulues.length, 6);
});

test("lireArbreMenu : un arbre illisible n'est pas un menu vide, et la phrase nomme le menu", () => {
  assert.throws(() => lireArbreMenu(undefined, "pied"), /^Error: Le pied de page n'a pas pu être lu\./);
  assert.throws(() => lireArbreMenu({}, "haut"), /^Error: Le menu n'a pas pu être lu\./);
  // Un tableau vide, lui, est un menu vidé exprès.
  assert.deepEqual(lireArbreMenu([], "pied").voulues, []);
});

/* -------------------------------------------------------------------------- */
/*  Le rangement des pages ne mêle pas les deux menus (menu-ordre.ts)         */
/* -------------------------------------------------------------------------- */

interface LigneFactice {
  id: number;
  emplacement: "haut" | "pied";
  parentId: number | null;
  href: string;
  position: number;
}

/** Une transaction factice : elle rend les lignes données et note les déplacements. */
function transaction(lignes: LigneFactice[]) {
  const deplaces: { id: number; position: number }[] = [];
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: async () =>
            [...lignes].sort((a, b) => a.position - b.position || a.id - b.id),
        }),
      }),
    }),
    update: () => ({
      set: (valeurs: { position: number }) => ({
        where: async (condition: SQL) => {
          const id = Number(requete(condition).params[0]);
          deplaces.push({ id, position: valeurs.position });
        },
      }),
    }),
  };
  return { tx: tx as unknown as Parameters<typeof menuSuitLOrdre>[0], deplaces };
}

test("menuSuitLOrdre : une entrée du haut et une colonne du pied ne s'échangent jamais leur place", async () => {
  // Deux entrées de premier niveau, l'une dans chaque menu, vers deux pages
  // qu'on range : sans parent toutes les deux, elles se seraient échangé
  // leurs positions — « Mulhouse » serait passée en tête du menu du haut.
  const { tx, deplaces } = transaction([
    { id: 1, emplacement: "haut", parentId: null, href: "/affiches?genre=personnalisable", position: 0 },
    { id: 2, emplacement: "haut", parentId: null, href: "/pages/mulhouse", position: 2 },
    { id: 3, emplacement: "pied", parentId: null, href: "/pages/aide", position: 0 },
  ]);
  const n = await menuSuitLOrdre(tx, new Map([["page:mulhouse", 0], ["page:aide", 1]]));
  assert.equal(n, 0);
  assert.deepEqual(deplaces, []);
});

test("menuSuitLOrdre : les liens d'une même colonne du pied suivent l'ordre des pages", async () => {
  const { tx, deplaces } = transaction([
    { id: 10, emplacement: "pied", parentId: null, href: "", position: 1 },
    { id: 11, emplacement: "pied", parentId: 10, href: "/contact", position: 0 },
    { id: 12, emplacement: "pied", parentId: 10, href: "/pages/mentions-legales", position: 1 },
    { id: 13, emplacement: "pied", parentId: 10, href: "/pages/cookies", position: 2 },
  ]);
  const n = await menuSuitLOrdre(
    tx,
    new Map([["page:cookies", 0], ["page:mentions-legales", 1]]),
  );
  assert.equal(n, 2);
  // Les deux pages échangent leurs places ; « Nous contacter » ne bouge pas.
  assert.deepEqual(
    deplaces.sort((a, b) => a.id - b.id),
    [
      { id: 12, position: 2 },
      { id: 13, position: 1 },
    ],
  );
});
