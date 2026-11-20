/**
 * « Créer un fond », relecture du 20/11 : ce qui se vérifie sans base.
 *
 *   - le fil rappelé au modèle suit la LIGNÉE de la version de départ, pas
 *     toutes les demandes du fond (« Revenir à celle-ci » abandonne une
 *     branche : ses demandes ne doivent pas revenir) ;
 *   - les fonds ont LEUR plafond, à part de celui des affiches des clients,
 *     et les versions en cours y comptent (coût réservé au lancement) ;
 *   - un montant vidé au BO ne s'enregistre plus à 0 ;
 *   - « Aucun » décor d'exemple choisi partout ne reprend plus ceux d'office ;
 *   - l'atelier d'affiche n'imprime jamais un avant-plan désigné par la page.
 *
 *   DATABASE_URL=postgres://e:e@127.0.0.1:1/e npx tsx --test tests/fonds-ia-plafond.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLE_PLAFOND_FONDS,
  PART_DU_PLAFOND_POUR_LES_FONDS,
  centimesDuReglage,
  composerConsigneFond,
  demandesDeLaLignee,
  exemplesDemandes,
  plafondDepasse,
  plafondDesFonds,
  resteSousLePlafond,
} from "../src/fonds-ia-consigne.js";

/* -------------------------------------------------------------------------- */
/*  Le fil : la lignée de la version de départ                                */
/* -------------------------------------------------------------------------- */

type M = { id: number; demande: string; baseVersion: string | null };

/**
 * Un fond de Colmar, lot « sous la neige » :
 *   1. premier dessin (précision du lot)          → v1
 *   2. « enlève la grue », depuis v1              → v2
 *   3. « plus large », depuis v2                  → v3
 *   — Margaux revient à v1 (« Revenir à celle-ci ») —
 *   4. « plus de ciel », depuis v1                → v4
 *   5. « Recommencer de zéro » : « vue du quai »  → v5
 *   6. « dégage le bas », depuis v5               → v6
 */
const fil: M[] = [
  { id: 11, demande: "sous la neige", baseVersion: null },
  { id: 12, demande: "enlève la grue", baseVersion: "v1" },
  { id: 13, demande: "plus large", baseVersion: "v2" },
  { id: 14, demande: "plus de ciel", baseVersion: "v1" },
  { id: 15, demande: "vue du quai", baseVersion: null },
  { id: 16, demande: "dégage le bas", baseVersion: "v5" },
];
const versions = new Map<string, number>([
  ["v1", 11],
  ["v2", 12],
  ["v3", 13],
  ["v4", 14],
  ["v5", 15],
  ["v6", 16],
]);
const lignee = (id: number) =>
  demandesDeLaLignee(fil.find((m) => m.id === id)!, fil, versions, "sous la neige");

test("le fil suit la lignée : chaque demande qui a mené à la version de départ, de la plus ancienne à la plus récente", () => {
  assert.deepEqual(lignee(12), ["sous la neige"]);
  assert.deepEqual(lignee(13), ["sous la neige", "enlève la grue"]);
});

test("après « Revenir à celle-ci », la branche abandonnée ne revient pas dans le fil", () => {
  // Repartie de v1 : ni « enlève la grue » ni « plus large » ne sont dans
  // l'image de départ ; les dire « déjà appliquées » les y ferait revenir.
  assert.deepEqual(lignee(14), ["sous la neige"]);
});

test("le premier dessin porte lui-même la précision du lot : rien à rappeler", () => {
  assert.deepEqual(lignee(11), []);
});

test("« Recommencer de zéro » garde la précision du lot, et rien de la discussion", () => {
  assert.deepEqual(lignee(15), ["sous la neige"]);
  assert.deepEqual(lignee(16), ["sous la neige", "vue du quai"]);
  // Sans précision de lot, un dessin de zéro n'a rien à rappeler.
  assert.deepEqual(demandesDeLaLignee(fil[4]!, fil, versions, null), []);
  assert.deepEqual(demandesDeLaLignee(fil[4]!, fil, versions, "   "), []);
});

test("un lien perdu, une boucle ou un parent plus récent arrêtent la remontée sans planter", () => {
  // Version inconnue (ligne effacée) : on s'arrête là.
  assert.deepEqual(
    demandesDeLaLignee({ id: 20, baseVersion: "inconnue" }, fil, versions, "sous la neige"),
    ["sous la neige"],
  );
  // Version dont le message a disparu (fond_message_id remis à NULL).
  assert.deepEqual(
    demandesDeLaLignee({ id: 20, baseVersion: "orpheline" }, fil, new Map([["orpheline", null]]), null),
    [],
  );
  // Une boucle (impossible en base, mais on ne tourne jamais sans fin).
  const boucle: M[] = [
    { id: 1, demande: "a", baseVersion: "vb" },
    { id: 2, demande: "b", baseVersion: "va" },
  ];
  const vb = new Map([
    ["va", 1],
    ["vb", 2],
  ]);
  assert.deepEqual(demandesDeLaLignee({ id: 3, baseVersion: "va" }, boucle, vb, null), ["b", "a"]);
  // Un « parent » plus récent que le message n'en est pas un.
  assert.deepEqual(
    demandesDeLaLignee({ id: 12, baseVersion: "v6" }, fil, versions, "sous la neige"),
    ["sous la neige"],
  );
});

test("la consigne dit « déjà appliquées » depuis une version, « à appliquer » depuis la photo", () => {
  const depuisVersion = composerConsigneFond({
    gabarit: "x",
    lieu: "Colmar",
    nbPhotos: 1,
    nbExemples: 0,
    depuisVersion: true,
    historique: ["sous la neige"],
    demande: "plus de ciel",
  });
  assert.match(depuisVersion, /REQUESTS ALREADY MADE FOR THIS IMAGE[^\n]*already applied[^]*sous la neige/);
  const depuisLaPhoto = composerConsigneFond({
    gabarit: "x",
    lieu: "Colmar",
    nbPhotos: 1,
    nbExemples: 2,
    historique: ["sous la neige"],
    demande: "vue du quai",
  });
  assert.match(depuisLaPhoto, /REQUESTS ALREADY MADE FOR THIS PLACE[^\n]*apply them too[^]*sous la neige/);
  assert.doesNotMatch(depuisLaPhoto, /already applied/);
  assert.ok(depuisLaPhoto.indexOf("vue du quai") > depuisLaPhoto.indexOf("sous la neige"));
});

/* -------------------------------------------------------------------------- */
/*  Le plafond des fonds                                                      */
/* -------------------------------------------------------------------------- */

test("sans réglage, le plafond des fonds vaut la moitié de celui des affiches", () => {
  assert.equal(CLE_PLAFOND_FONDS, "ia.fondPlafondMensuelCents");
  assert.equal(PART_DU_PLAFOND_POUR_LES_FONDS, 0.5);
  for (const absent of [undefined, null, "", "  ", "abc", "-5", { fr: "" }])
    assert.deepEqual(plafondDesFonds(absent, 5000), {
      cents: 2500,
      parDefaut: true,
      reglageCents: null,
      defautCents: 2500,
    });
  assert.equal(plafondDesFonds("", 4999).cents, 2500);
  assert.equal(plafondDesFonds("", Number.NaN).cents, 0);
});

test("un plafond des fonds réglé s'applique tel quel, 0 compris (les fonds s'arrêtent)", () => {
  assert.deepEqual(plafondDesFonds("3000", 5000), {
    cents: 3000,
    parDefaut: false,
    reglageCents: 3000,
    defautCents: 2500,
  });
  assert.deepEqual(plafondDesFonds(8000, 5000).cents, 8000);
  assert.equal(plafondDesFonds("0", 5000).cents, 0);
  assert.equal(plafondDesFonds("0", 5000).parDefaut, false);
});

test("un coût par image vidé au BO retombe sur le défaut, jamais sur 0", () => {
  assert.equal(centimesDuReglage("", 25), 25);
  assert.equal(centimesDuReglage("   ", 25), 25);
  assert.equal(centimesDuReglage(null, 25), 25);
  assert.equal(centimesDuReglage(undefined, 25), 25);
  assert.equal(centimesDuReglage("abc", 25), 25);
  assert.equal(centimesDuReglage("-1", 25), 25);
  assert.equal(centimesDuReglage({ fr: "" }, 25), 25);
  // Un 0 SAISI reste un choix, comme avant.
  assert.equal(centimesDuReglage("0", 25), 0);
  assert.equal(centimesDuReglage(40, 25), 40);
  assert.equal(centimesDuReglage("30", 25), 30);
  assert.equal(centimesDuReglage("12.6", 25), 13);
});

// L'ARITHMÉTIQUE seule : la réservation elle-même (reserverVersions), son
// retour à 0 et la séparation affiches / fonds (depenseDuMoisCents) ne se
// vérifient qu'avec une base.
test("arithmétique du plafond : un coût réservé compte comme un coût dépensé", () => {
  // Plafond des fonds 25 € ; 20 € déjà dessinés, plus un lot de 10 photos ×
  // 2 versions en cours (5 € réservés) : le plafond est plein.
  const dessinees = 2000;
  const reservees = 10 * 2 * 25;
  assert.equal(plafondDepasse(dessinees, 1, 25, 2500), false, "sans la réservation, il passait");
  assert.equal(plafondDepasse(dessinees + reservees, 1, 25, 2500), true);
  assert.equal(resteSousLePlafond(dessinees + reservees, 2500), 0);
  assert.equal(resteSousLePlafond(3000, 2500), 0, "jamais moins que rien");
  assert.equal(resteSousLePlafond(1000, 2500), 1500);
});

/* -------------------------------------------------------------------------- */
/*  Les décors d'exemple                                                      */
/* -------------------------------------------------------------------------- */

test("« Aucun » dans chaque liste : aucun exemple, pas ceux d'office", () => {
  assert.equal(exemplesDemandes(["", ""]), "aucun");
  assert.equal(exemplesDemandes(["aucun"]), "aucun");
  assert.equal(exemplesDemandes(["Aucun", ""]), "aucun");
});

test("des décors choisis passent tels quels ; un champ absent ou illisible prend ceux d'office", () => {
  assert.deepEqual(exemplesDemandes(["12", ""]), [12]);
  assert.deepEqual(exemplesDemandes(["12,57"]), [12, 57]);
  assert.deepEqual(exemplesDemandes(["57", "12", "3"]), [57, 12]);
  assert.equal(exemplesDemandes([]), null);
  assert.equal(exemplesDemandes(["n'importe quoi"]), null);
});

/* -------------------------------------------------------------------------- */
/*  L'atelier d'affiche (BO › Affiches IA › Créer une affiche)                */
/* -------------------------------------------------------------------------- */

test("l'atelier n'imprime jamais un avant-plan, un fond ou un cadre désignés par la page", async () => {
  // Import paresseux : ia-reutiliser.ts ouvre la base au chargement ; on ne
  // lit ici que configDeLAtelier, sans requête.
  process.env.DATABASE_URL ??= "postgres://essai:essai@127.0.0.1:1/essai";
  const { configDeLAtelier } = await import("../src/ia-reutiliser.js");
  const config = configDeLAtelier(
    {
      characters: [],
      format: "A4",
      view: "back",
      backgroundId: 12,
      backgroundUrl: "https://ailleurs.example/fond.png",
      foregroundUrl: "ia/abcd-pleine.png",
      aiPublicId: "x",
      aiApercuUrl: "/ia/apercu/x",
      frameId: 3,
      productId: 9,
    } as never,
    "ia/fonds/version.png",
  ) as Record<string, unknown>;
  assert.equal(config.backgroundUrl, "ia/fonds/version.png");
  for (const ecarte of ["foregroundUrl", "backgroundId", "aiPublicId", "aiApercuUrl", "frameId", "productId"])
    assert.ok(!(ecarte in config), `${ecarte} doit être écarté`);
  // Le reste de l'affiche passe : la vue de dos garde son muret officiel,
  // que le moteur du PDF pose lui-même.
  assert.equal(config.view, "back");
  assert.equal(config.format, "A4");
});
