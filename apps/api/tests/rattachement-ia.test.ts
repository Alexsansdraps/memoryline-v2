/**
 * Le rattachement des affiches IA à la commande payée (ia.ts,
 * candidatDeLaLigne), depuis que deux lignes peuvent annoncer la même
 * génération : la création seule, puis la même avec des personnages (20/11).
 *
 *   npx tsx --test tests/rattachement-ia.test.ts
 *
 * La seconde ligne se voyait rattacher une AUTRE génération du même produit,
 * la plus récente du panier : marquée payée, sa photo d'origine effacée, pour
 * une affiche que personne n'avait achetée. Sans base : la fonction choisit,
 * rattacherGenerationsAuPanier écrit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { candidatDeLaLigne, type GenerationARattacher } from "../src/ia.js";

type Ligne = { id: number; productId: number | null; config: unknown };

/**
 * La boucle de rattacherGenerationsAuPanier : les lignes dans l'ordre de
 * leur identifiant, chaque génération retenue une seule fois. Rend, par
 * ligne, la génération rattachée.
 */
function rattacher(
  lignes: Ligne[],
  generations: GenerationARattacher[],
): Map<number, string> {
  const retenues = new Set<number>();
  const rattachees = new Map<number, string>();
  for (const ligne of lignes) {
    const g = candidatDeLaLigne(ligne, generations, retenues);
    if (!g) continue;
    retenues.add(g.id);
    rattachees.set(ligne.id, g.publicId);
  }
  return rattachees;
}

/** Les générations d'un panier, de la plus récente à la plus ancienne. */
const RECENTE: GenerationARattacher = { id: 3, publicId: "gen-recente", productId: 42, orderItemId: null };
const CHOISIE: GenerationARattacher = { id: 2, publicId: "gen-choisie", productId: 42, orderItemId: null };
const ANCIENNE: GenerationARattacher = { id: 1, publicId: "gen-ancienne", productId: 42, orderItemId: null };
const PANIER = [RECENTE, CHOISIE, ANCIENNE];

const ia = (publicId: string, personnages = 0) => ({
  schemaVersion: 1,
  aiPublicId: publicId,
  characters: Array.from({ length: personnages }, (_, i) => ({ typeId: 7, position: i, assets: {} })),
});

test("deux lignes annoncent la même génération : la seconde n'en emprunte aucune autre", () => {
  const lignes: Ligne[] = [
    { id: 10, productId: 42, config: ia("gen-choisie") },
    { id: 11, productId: 42, config: ia("gen-choisie", 2) },
  ];
  const r = rattacher(lignes, PANIER);
  assert.equal(r.get(10), "gen-choisie");
  assert.equal(r.has(11), false, "ni « gen-recente », ni « gen-ancienne »");
  assert.equal(r.size, 1);
});

test("une ligne qui annonce une génération absente du panier n'emprunte pas la plus récente", () => {
  // Le nouvel essai « panier_clos » : la génération vient d'un autre panier.
  const r = rattacher([{ id: 10, productId: 42, config: ia("gen-d-un-autre-panier", 1) }], PANIER);
  assert.equal(r.size, 0);
});

test("une ligne SANS aiPublicId garde le repli par produit : la plus récente non retenue", () => {
  const lignes: Ligne[] = [
    { id: 10, productId: 42, config: { schemaVersion: 1, characters: [] } },
    { id: 11, productId: 42, config: null },
  ];
  const r = rattacher(lignes, PANIER);
  assert.equal(r.get(10), "gen-recente");
  assert.equal(r.get(11), "gen-choisie");
});

test("une annonce vide n'annonce rien : le repli par produit reste, comme avant", () => {
  const r = rattacher([{ id: 10, productId: 42, config: ia("") }], PANIER);
  assert.equal(r.get(10), "gen-recente");
});

test("l'identifiant annoncé passe avant tout, puis la liaison posée par /ia/lier", () => {
  const liee: GenerationARattacher = { id: 4, publicId: "gen-liee", productId: 42, orderItemId: 11 };
  const lignes: Ligne[] = [
    { id: 10, productId: 42, config: ia("gen-ancienne") },
    { id: 11, productId: 42, config: { schemaVersion: 1 } },
    { id: 12, productId: 42, config: { schemaVersion: 1 } },
  ];
  const r = rattacher(lignes, [liee, ...PANIER]);
  assert.equal(r.get(10), "gen-ancienne", "l'annonce, même si une plus récente existe");
  assert.equal(r.get(11), "gen-liee", "la liaison avant le repli par produit");
  assert.equal(r.get(12), "gen-recente", "le repli ne prend jamais une génération liée à une autre ligne");
});

test("une génération retenue ne l'est qu'une fois, et jamais pour une autre affiche", () => {
  const lignes: Ligne[] = [
    { id: 10, productId: 42, config: ia("gen-recente") },
    { id: 11, productId: 42, config: { schemaVersion: 1 } },
    { id: 12, productId: 43, config: { schemaVersion: 1 } },
    { id: 13, productId: null, config: { schemaVersion: 1 } },
  ];
  const r = rattacher(lignes, PANIER);
  assert.equal(r.get(10), "gen-recente");
  assert.equal(r.get(11), "gen-choisie");
  assert.equal(r.has(12), false, "autre produit");
  assert.equal(r.has(13), false, "ligne sans produit");
});

test("candidatDeLaLigne rend la génération elle-même, ou null", () => {
  assert.equal(candidatDeLaLigne({ id: 1, productId: 42, config: ia("gen-choisie") }, PANIER, new Set()), CHOISIE);
  assert.equal(
    candidatDeLaLigne({ id: 1, productId: 42, config: ia("gen-choisie") }, PANIER, new Set([CHOISIE.id])),
    null,
  );
  assert.equal(candidatDeLaLigne({ id: 1, productId: 42, config: null }, [], new Set()), null);
});
