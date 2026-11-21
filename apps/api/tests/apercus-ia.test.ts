/**
 * La version de la vignette d'une affiche IA (apercus.ts), depuis qu'elle
 * peut porter des personnages et un muret (20/11).
 *
 *   npx tsx --test tests/apercus-ia.test.ts
 *
 * Une version entre dans l'ADRESSE de la vignette, et cette adresse est
 * partie dans des courriels : en changer refait l'image, et une adresse
 * ancienne ne la retrouve plus en cache. Les affiches IA « texte seul »
 * doivent donc garder la leur, au caractère près ; seules celles qui portent
 * des personnages (nouvelles) prennent le sel des affiches composées.
 *
 * Sans requête : la version ne dépend que de la configuration.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lignesRemplies, type TextesAffiche } from "@memoryline/types";
import { cheminApercu, iaComposee, versionApercu } from "../src/apercus.js";

/** La version telle qu'apercus.ts la calculait AVANT les personnages. */
function versionAvant(config: unknown): string {
  const h = createHash("sha1").update(JSON.stringify(config ?? null));
  const c = config as { aiPublicId?: string; texts?: TextesAffiche } | null;
  if (!!c?.aiPublicId && lignesRemplies(c.texts).length > 0) h.update("ia-avec-texte");
  return h.digest("base64url").slice(0, 10);
}

const avecSel = (config: unknown) =>
  createHash("sha1")
    .update(JSON.stringify(config ?? null))
    .update("ia-avec-texte")
    .digest("base64url")
    .slice(0, 10);

const sansSel = (config: unknown) =>
  createHash("sha1").update(JSON.stringify(config ?? null)).digest("base64url").slice(0, 10);

const ID = "3f0c2b1e-5a4d-4c3b-8a29-0d1e2f3a4b5c";

/** Une affiche IA telle qu'AfficheIA l'envoie aujourd'hui, avec un texte. */
const texteSeul = {
  schemaVersion: 1,
  productId: 42,
  format: "A4",
  view: "front",
  texts: { lines: [{ value: "Léa & Tom", font: "Amatic SC", color: "#ffffff", x: 0.42, y: 0.12 }] },
  characters: [] as unknown[],
  aiPublicId: ID,
  aiApercuUrl: `/ia/apercu/${ID}`,
};
/** La même, sans texte : l'aperçu du modèle tel quel. */
const nue = { ...texteSeul, texts: { lines: [] } };

const PERSONNAGE = {
  typeId: 7,
  position: 0,
  x: 0.31,
  y: 0.816,
  scale: 0.29,
  assets: { hair: 12 },
  colors: {},
};
/** « Assis sur le muret », sans texte. */
const personnagesSeuls = {
  ...nue,
  view: "back",
  foregroundUrl: "/assets/muret_officiel.svg",
  characters: [PERSONNAGE, { ...PERSONNAGE, typeId: 9, position: 1, x: 0.64 }],
};
/** Des personnages ET du texte. */
const personnagesEtTexte = { ...personnagesSeuls, texts: texteSeul.texts };

test("une affiche IA « texte seul » garde EXACTEMENT sa version (même sha1, sel compris)", () => {
  assert.equal(versionApercu(texteSeul), versionAvant(texteSeul));
  assert.equal(versionApercu(texteSeul), avecSel(texteSeul));
  // Calculée avec la formule d'avant le 20/11 (HEAD) : l'adresse déjà partie
  // dans un courriel ne doit pas bouger d'un caractère.
  assert.equal(versionApercu(texteSeul), "t9BHbGYCo4");
});

test("une affiche IA nue reste sans sel, comme avant", () => {
  assert.equal(versionApercu(nue), versionAvant(nue));
  assert.equal(versionApercu(nue), sansSel(nue));
  assert.equal(versionApercu(nue), "_s5R9MI8kE");
  assert.equal(iaComposee(nue), false);
});

test("une affiche IA avec personnages et sans texte reçoit le sel des affiches composées", () => {
  assert.equal(iaComposee(personnagesSeuls), true);
  assert.equal(versionApercu(personnagesSeuls), avecSel(personnagesSeuls));
  assert.notEqual(versionApercu(personnagesSeuls), sansSel(personnagesSeuls));
  // Avec du texte en plus : elle avait déjà le sel, rien ne change.
  assert.equal(versionApercu(personnagesEtTexte), versionAvant(personnagesEtTexte));
  assert.equal(versionApercu(personnagesEtTexte), avecSel(personnagesEtTexte));
  // Une configuration abîmée en base (personnages qui ne sont pas une liste)
  // ne se compte pas comme composée.
  const abimee = { ...nue, characters: "pas un tableau" };
  assert.equal(iaComposee(abimee), false);
  assert.equal(versionApercu(abimee), versionAvant(abimee));
});

test("les affiches du catalogue ne changent pas de version, personnages ou non", () => {
  const { aiPublicId: _a, aiApercuUrl: _b, ...classique } = personnagesEtTexte;
  for (const config of [
    classique,
    { ...classique, characters: [] },
    { ...classique, backgroundId: 3, texts: { lines: [] } },
    // Un aiPublicId vide ne fait pas une affiche IA.
    { ...personnagesSeuls, aiPublicId: "" },
    null,
    undefined,
    { schemaVersion: 1, texts: {}, characters: "pas un tableau" },
  ]) {
    assert.equal(versionApercu(config), versionAvant(config), JSON.stringify(config));
    assert.equal(iaComposee(config), false, JSON.stringify(config));
  }
});

test("l'adresse de la vignette porte la version", () => {
  assert.match(cheminApercu(12, texteSeul), /^\/apercus\/ligne\/12\/image\.jpg\?j=[A-Za-z0-9_-]{16}&v=t9BHbGYCo4$/);
  const avant = cheminApercu(12, nue);
  const apres = cheminApercu(12, personnagesSeuls);
  assert.notEqual(avant, apres, "une autre affiche, une autre adresse");
  assert.equal(avant.split("&v=")[0], apres.split("&v=")[0], "le jeton ne signe que la ligne");
});
