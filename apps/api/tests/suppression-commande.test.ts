/**
 * Les essais de la règle qui décide si une commande archivée peut être
 * supprimée pour toujours, sans base de données.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/suppression-commande.test.ts
 *
 * La règle (commandes.ts, `motifCommandeAGarder`) : un panier ou une commande
 * jamais payée peut partir ; tout ce qui a été payé, remboursé, facturé,
 * encaissé, expédié ou réglé en carte cadeau reste, jamais supprimé — les
 * pièces comptables se gardent dix ans. Le module ouvre un client de base à
 * son chargement, mais la règle ne s'en sert pas : rien n'est lu ni écrit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { motifCommandeAGarder, type EtatCommandeASupprimer } from "../src/commandes.js";

/** Un panier abandonné, sans rien autour : la seule chose qui puisse partir. */
const panier: EtatCommandeASupprimer = {
  status: "draft",
  invoiceNumber: null,
  remboursements: 0,
  mouvements: 0,
  paiementsAboutis: 0,
  expeditions: 0,
  bordereaux: 0,
  depensesCarteCadeau: 0,
  giftCardCents: 0,
  dernierDeSaSerie: false,
};

test("un panier ou une commande jamais payée peut partir", () => {
  assert.equal(motifCommandeAGarder(panier), null);
  assert.equal(motifCommandeAGarder({ ...panier, status: "pending" }), null);
  assert.equal(motifCommandeAGarder({ ...panier, status: "cancelled" }), null);
  assert.equal(motifCommandeAGarder({ ...panier, status: "voided" }), null);
});

test("une commande payée ne se supprime jamais, vente du stand comprise", () => {
  const motif = motifCommandeAGarder({ ...panier, status: "paid", mouvements: 1 });
  assert.match(motif ?? "", /payée/);
  assert.match(motif ?? "", /dix ans/);
  assert.ok(motifCommandeAGarder({ ...panier, status: "authorized" }));
});

test("une facture l'emporte sur tout, et la réponse la nomme", () => {
  const motif = motifCommandeAGarder({ ...panier, status: "cancelled", invoiceNumber: "2026-0042" });
  assert.match(motif ?? "", /facture \(n° 2026-0042\)/);
});

test("une commande remboursée reste, même annulée depuis", () => {
  const motif = motifCommandeAGarder({ ...panier, status: "cancelled", remboursements: 1 });
  assert.match(motif ?? "", /remboursée/);
});

test("le moindre mouvement d'argent retient la commande", () => {
  assert.ok(motifCommandeAGarder({ ...panier, status: "cancelled", mouvements: 1 }));
  assert.ok(motifCommandeAGarder({ ...panier, status: "pending", paiementsAboutis: 1 }));
});

test("une carte cadeau dépensée retient la commande", () => {
  assert.match(motifCommandeAGarder({ ...panier, depensesCarteCadeau: 1 }) ?? "", /carte cadeau/);
  assert.match(motifCommandeAGarder({ ...panier, giftCardCents: 500 }) ?? "", /carte cadeau/);
});

test("un colis ou une étiquette retient la commande", () => {
  assert.ok(motifCommandeAGarder({ ...panier, status: "pending", expeditions: 1 }));
  assert.ok(motifCommandeAGarder({ ...panier, status: "pending", bordereaux: 1 }));
});

test("la dernière de sa série attend : son numéro resservirait", () => {
  const motif = motifCommandeAGarder({ ...panier, status: "pending", dernierDeSaSerie: true });
  assert.match(motif ?? "", /dernière commande numérotée/);
});
