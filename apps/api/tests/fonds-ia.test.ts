/**
 * « Créer un fond » (BO › Atelier, 20/11) : ce qui se calcule sans base ni
 * réseau — la consigne, le fil de la discussion, les noms d'un lot, le coût,
 * et le bouchon qui ne doit JAMAIS se brancher en production.
 *
 * Margaux : « Si seulement tu pouvais me faire un programme où j'ai juste à
 * mettre des photos et qu'il me génère des fonds automatiquement sans que je
 * discute pendant 2h pour faire un seule fond de ville ».
 *
 *   npx tsx --test tests/fonds-ia.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONSIGNE_FOND_DEFAUT,
  HISTORIQUE_MAX,
  PHOTOS_MAX,
  RETOUCHES,
  VERSIONS_MAX,
  baseNomFichier,
  bornerVersions,
  composerConsigneFond,
  coutDuLotCents,
  etatDuFond,
  lireExemples,
  lireMessage,
  nettoyerTexte,
  nomsDuLot,
  plafondDepasse,
  styleParDefaut,
} from "../src/fonds-ia-consigne.js";

test("la consigne des fonds fait le travail de Margaux : angle, nettoyage, cadrage, ni texte ni personne", () => {
  for (const attendu of [
    /BEST VIEWPOINT/,
    /cars/,
    /traffic signs/,
    /scaffolding/,
    /TOP 30 %: open, calm sky/,
    /BOTTOM 30 %/,
    /foreground wall/,
    /No people/,
    /No text/,
    /2:3/,
  ])
    assert.match(CONSIGNE_FOND_DEFAUT, attendu);
  // Le style n'y est PAS : il vient du style des affiches IA, lu en base.
  assert.doesNotMatch(CONSIGNE_FOND_DEFAUT, /HOUSE STYLE/);
});

test("ordre de la consigne : rôles, style lu en base, règles des fonds, fil, demande en dernier", () => {
  const c = composerConsigneFond({
    style: "STYLE DU CHAMP PROMPT",
    gabarit: "Rules for {{LIEU}} {{INCONNU}}",
    lieu: "Colmar, la Petite Venise",
    nbPhotos: 1,
    nbExemples: 2,
    historique: ["sous la neige"],
    demande: "recule un peu",
  });
  const pos = (s: string) => c.indexOf(s);
  assert.ok(pos("IMAGE ROLES") === 0);
  assert.ok(pos("IMAGE 1: PHOTO") > 0);
  assert.ok(pos("IMAGES 2 TO 3: STYLE EXAMPLES") > 0);
  assert.ok(pos("STYLE DU CHAMP PROMPT") > pos("IMAGES 2 TO 3"));
  assert.ok(pos("Rules for Colmar, la Petite Venise") > pos("STYLE DU CHAMP PROMPT"));
  assert.ok(pos("sous la neige") > pos("Rules for"));
  assert.ok(pos("recule un peu") > pos("sous la neige"));
  assert.ok(!c.includes("{{"), "un marqueur inconnu ne part jamais au modèle");
});

test("un message de la discussion repart de la version courante : elle est IMAGE 1", () => {
  const c = composerConsigneFond({
    gabarit: "x",
    lieu: "Reims",
    nbPhotos: 1,
    nbExemples: 0,
    depuisVersion: true,
    historique: ["enlève la grue à gauche"],
    demande: "la cathédrale est coupée, recule un peu",
  });
  assert.match(c, /IMAGE 1: the CURRENT BACKGROUND/);
  assert.match(c, /IMAGE 2: PHOTO/);
  assert.doesNotMatch(c, /STYLE EXAMPLES/);
  assert.match(c, /REQUESTS ALREADY MADE[^]*enlève la grue/);
  assert.match(c, /NEW REQUEST[^]*cathédrale est coupée/);
});

test("le fil ne rappelle que les dernières demandes, vides écartées", () => {
  const historique = Array.from({ length: HISTORIQUE_MAX + 5 }, (_, i) => `demande ${i}`);
  const c = composerConsigneFond({ gabarit: "x", lieu: "L", nbPhotos: 1, nbExemples: 0, historique: [...historique, "  "] });
  assert.ok(!c.includes("demande 4\n") && !c.includes("- demande 0"));
  assert.ok(c.includes(`- demande ${HISTORIQUE_MAX + 4}`));
});

test("les boutons de retouche : libellé dans le fil, consigne au modèle, clés inconnues ignorées", () => {
  const m = lireMessage(["ciel", "pirate", "angle"], "  enlève la grue  ");
  assert.equal(m.texte, "Changer l'angle · Plus de ciel en haut · enlève la grue");
  assert.ok(m.demande.startsWith(RETOUCHES[0].consigne));
  assert.ok(m.demande.endsWith("enlève la grue"));
  assert.deepEqual(lireMessage([], ""), { texte: "", demande: "" });
});

test("le style par défaut parle de bâtiment ou de paysage, accents et casse ignorés", () => {
  const s = (title: string, id: number) => ({ id, title });
  assert.equal(styleParDefaut([s("Personnes", 1), s("Bâtiment / paysage", 7)])?.id, 7);
  assert.equal(styleParDefaut([s("Personnes", 1), s("MAISON / BATIMENT", 3)])?.id, 3);
  assert.equal(styleParDefaut([s("Personnes", 1), s("Couple", 2)])?.id, 1);
  assert.equal(styleParDefaut([]), null);
});

test("une photo = un fond : les noms d'un lot", () => {
  assert.deepEqual(nomsDuLot("Colmar", [], 1), ["Colmar"]);
  assert.deepEqual(nomsDuLot("Colmar", ["", "Colmar, la Petite Venise", ""], 3), [
    "Colmar 1",
    "Colmar, la Petite Venise",
    "Colmar 2",
  ]);
  assert.deepEqual(nomsDuLot("Colmar", ["Colmar", "Maison Pfister"], 2), ["Colmar", "Maison Pfister"]);
});

test("le coût d'un lot : photos × versions", () => {
  assert.equal(coutDuLotCents(3, 2, 25), 150);
  assert.equal(plafondDepasse(4901, 4, 25, 5000), true);
  assert.equal(plafondDepasse(4900, 4, 25, 5000), false);
});

test("bornes : versions, exemples, textes", () => {
  assert.equal(bornerVersions("abc", 2), 2);
  assert.equal(bornerVersions(99, 2), VERSIONS_MAX);
  assert.equal(bornerVersions(0, 7), VERSIONS_MAX);
  assert.deepEqual(lireExemples("12, 57, 12, 3"), [12, 57]);
  assert.deepEqual(lireExemples(["x", 4]), [4]);
  assert.equal(nettoyerTexte("a\u0000\n  b ", 10), "a b");
  assert.ok(PHOTOS_MAX >= 5);
});

test("l'état d'un fond suit son dernier message", () => {
  assert.equal(etatDuFond(["en_cours", "prete"]).etat, "en_cours");
  assert.equal(etatDuFond(["echec", "prete"]).etat, "prete");
  assert.equal(etatDuFond(["echec"]).etat, "echec");
});

test("le nom du fichier d'un décor", () => {
  assert.equal(baseNomFichier("Colmar, la Petite Venise"), "colmar-la-petite-venise");
  assert.equal(baseNomFichier("!!!"), "decor");
});

test("le bouchon ne se branche jamais en production", async () => {
  // Import paresseux : fonds-ia.ts ouvre la base au chargement ; on ne lit
  // ici que bouchonActif, sans requête.
  process.env.DATABASE_URL ??= "postgres://essai:essai@127.0.0.1:1/essai";
  const { bouchonActif } = await import("../src/fonds-ia.js");
  assert.equal(bouchonActif(true, { NODE_ENV: "production", IA_FONDS_BOUCHON: "1" }), false);
  assert.equal(bouchonActif(false, { IA_FONDS_BOUCHON: "1" }), true);
  assert.equal(bouchonActif(true, {}), true);
  assert.equal(bouchonActif(false, {}), false);
});

test("en discussion, le style (écrit pour « IMAGE 1 = la photo ») est remis d'aplomb", () => {
  const c = composerConsigneFond({
    style: "Preserve the real geography of IMAGE 1.",
    gabarit: "x",
    lieu: "Étretat",
    nbPhotos: 1,
    nbExemples: 0,
    depuisVersion: true,
    demande: "plus de ciel",
  });
  assert.match(c, /"IMAGE 1" and "the photo" mean the PHOTO of the place \(IMAGE 2 here\)/);
  // Au premier dessin, la photo EST l'image 1 : rien à préciser.
  const d = composerConsigneFond({ style: "IMAGE 1", gabarit: "x", lieu: "É", nbPhotos: 1, nbExemples: 0 });
  assert.doesNotMatch(d, /mean the PHOTO/);
});
