/**
 * Les étapes de traitement d'une commande (17/11), sans base de données.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/etapes-traitement.test.ts
 *
 * Trois parcours (packages/types/src/traitement.ts) : le stand (À imprimer →
 * Terminée, aucun courriel), la livraison (En préparation → Envoyée → Livrée,
 * l'avis d'expédition à « Envoyée ») et le retrait (En préparation → Prête à
 * retirer → Retirée, « Votre commande vous attend » à « Prête à retirer »).
 * Revenir en arrière n'écrit à personne, et ne passe pas un vrai bordereau.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  datesApresPassage,
  etapeDe,
  libelleEtape,
  parcoursDe,
  passageEtape,
  type EtapeTraitement,
  type ParcoursTraitement,
} from "@memoryline/types";

const payee = { status: "paid", articles: 3, expedies: 0 };

test("le parcours : stand, livraison, retrait, et le retrait qui voyage", () => {
  assert.equal(parcoursDe({ channel: "salon", retrait: false }), "stand");
  // Une vente du stand reste au stand, même avec un vieux bordereau.
  assert.equal(parcoursDe({ channel: "salon", retrait: true, bordereauReel: true }), "stand");
  assert.equal(parcoursDe({ channel: "web", retrait: false }), "livraison");
  assert.equal(parcoursDe({ channel: "web", retrait: true }), "retrait");
  assert.equal(parcoursDe({ channel: "web", retrait: true, bordereauReel: true }), "livraison");
});

test("l'étape se déduit du statut, des expéditions et des deux dates", () => {
  assert.equal(etapeDe("stand", { ...payee, status: "draft" }), "panier");
  assert.equal(etapeDe("stand", { ...payee, status: "cancelled" }), "annulee");
  assert.equal(etapeDe("stand", { ...payee, status: "pending" }), "a_encaisser");
  assert.equal(etapeDe("livraison", { ...payee, status: "pending" }), "a_encaisser");
  assert.equal(etapeDe("livraison", { ...payee, articles: 0 }), "rien_a_expedier");
  assert.equal(etapeDe("stand", payee), "a_imprimer");
  assert.equal(etapeDe("stand", { ...payee, expedies: 3 }), "terminee");
  assert.equal(etapeDe("livraison", payee), "en_preparation");
  assert.equal(etapeDe("livraison", { ...payee, expedies: 1 }), "en_partie");
  assert.equal(etapeDe("livraison", { ...payee, expedies: 3 }), "envoyee");
  assert.equal(etapeDe("livraison", { ...payee, expedies: 3, deliveredAt: new Date() }), "livree");
  // « Livrée » sans tout parti ne veut rien dire : l'expédition fait foi.
  assert.equal(etapeDe("livraison", { ...payee, expedies: 1, deliveredAt: new Date() }), "en_partie");
  assert.equal(etapeDe("retrait", payee), "en_preparation");
  assert.equal(etapeDe("retrait", { ...payee, readyAt: new Date() }), "prete");
  assert.equal(etapeDe("retrait", { ...payee, expedies: 3, readyAt: new Date() }), "retiree");
});

test("les libellés suivent le parcours", () => {
  assert.equal(libelleEtape("a_encaisser", "stand"), "À encaisser");
  assert.equal(libelleEtape("a_encaisser", "livraison"), "En attente de paiement");
  assert.equal(libelleEtape("prete", "retrait"), "Prête à retirer");
  assert.equal(libelleEtape("en_partie", "livraison"), "Envoyée en partie");
});

/** Le passage, ou sa raison de refus. */
function passer(p: ParcoursTraitement, de: EtapeTraitement, vers: string, bordereauReel = false) {
  return passageEtape(p, de, vers, { bordereauReel });
}

test("stand : À imprimer ⇄ Terminée, sans aucun courriel", () => {
  const avant = passer("stand", "a_imprimer", "terminee");
  assert.deepEqual(avant, {
    ok: true,
    inchange: false,
    sens: "avant",
    expedier: true,
    annulerExpeditions: false,
    courrier: null,
  });
  const arriere = passer("stand", "terminee", "a_imprimer");
  assert.ok(arriere.ok && !arriere.inchange);
  assert.equal(arriere.ok && !arriere.inchange && arriere.annulerExpeditions, true);
  assert.equal(arriere.ok && !arriere.inchange && arriere.courrier, null);
  // Pas d'« Envoyée » au stand.
  assert.equal(passer("stand", "a_imprimer", "envoyee").ok, false);
});

test("stand : rien avant le paiement", () => {
  const r = passer("stand", "a_encaisser", "terminee");
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.raison : "", /marquez-la payée/);
});

test("livraison : l'avis d'expédition part à « Envoyée », et seulement là", () => {
  const envoyee = passer("livraison", "en_preparation", "envoyee");
  assert.ok(envoyee.ok && !envoyee.inchange);
  assert.equal(envoyee.ok && !envoyee.inchange && envoyee.courrier, "expediee");
  assert.equal(envoyee.ok && !envoyee.inchange && envoyee.expedier, true);
  const livree = passer("livraison", "envoyee", "livree");
  assert.ok(livree.ok && !livree.inchange);
  assert.equal(livree.ok && !livree.inchange && livree.courrier, null);
  assert.equal(livree.ok && !livree.inchange && livree.expedier, false);
  // Livrée d'emblée (remise en main propre) : tout part, sans courriel.
  const direct = passer("livraison", "en_preparation", "livree");
  assert.ok(direct.ok && !direct.inchange && direct.expedier && direct.courrier === null);
  // Le reste d'une commande partie en partie : l'avis part pour le reste.
  const reste = passer("livraison", "en_partie", "envoyee");
  assert.ok(reste.ok && !reste.inchange && reste.expedier && reste.courrier === "expediee");
});

test("retrait : « Votre commande vous attend » à « Prête à retirer », rien à « Retirée »", () => {
  const prete = passer("retrait", "en_preparation", "prete");
  assert.ok(prete.ok && !prete.inchange);
  assert.equal(prete.ok && !prete.inchange && prete.courrier, "prete_a_retirer");
  assert.equal(prete.ok && !prete.inchange && prete.expedier, false);
  const retiree = passer("retrait", "prete", "retiree");
  assert.ok(retiree.ok && !retiree.inchange && retiree.expedier && retiree.courrier === null);
  // La cliente vient avant qu'on l'ait dite prête : aucun courriel.
  const direct = passer("retrait", "en_preparation", "retiree");
  assert.ok(direct.ok && !direct.inchange && direct.courrier === null);
});

test("revenir en arrière n'écrit à personne", () => {
  for (const [p, de, vers] of [
    ["livraison", "livree", "envoyee"],
    ["livraison", "livree", "en_preparation"],
    ["livraison", "envoyee", "en_preparation"],
    ["retrait", "retiree", "prete"],
    ["retrait", "prete", "en_preparation"],
    ["stand", "terminee", "a_imprimer"],
  ] as [ParcoursTraitement, EtapeTraitement, string][]) {
    const r = passer(p, de, vers);
    assert.ok(r.ok && !r.inchange, `${p} ${de} → ${vers}`);
    assert.equal(r.ok && !r.inchange && r.sens, "arriere");
    assert.equal(r.ok && !r.inchange && r.courrier, null, `${p} ${de} → ${vers}`);
  }
  // « Livrée » → « Envoyée » ne touche pas aux expéditions.
  const r = passer("livraison", "livree", "envoyee");
  assert.ok(r.ok && !r.inchange && !r.annulerExpeditions && !r.expedier);
  // « Retirée » → « Prête à retirer » les annule.
  const r2 = passer("retrait", "retiree", "prete");
  assert.ok(r2.ok && !r2.inchange && r2.annulerExpeditions);
});

test("un vrai bordereau interdit de revenir avant « Envoyée »", () => {
  const r = passer("livraison", "envoyee", "en_preparation", true);
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.raison : "", /bordereau .* annulez-le d'abord/);
  // Livrée → Envoyée reste permis : le colis est bien parti.
  assert.equal(passer("livraison", "livree", "envoyee", true).ok, true);
  // Avancer reste permis.
  assert.equal(passer("livraison", "en_preparation", "envoyee", true).ok, true);
});

test("ce qui n'a pas d'étape à choisir est refusé, avec sa raison", () => {
  assert.equal(passer("livraison", "annulee", "envoyee").ok, false);
  assert.equal(passer("livraison", "panier", "envoyee").ok, false);
  assert.equal(passer("livraison", "rien_a_expedier", "envoyee").ok, false);
  const nonPayee = passer("livraison", "a_encaisser", "envoyee");
  assert.match(!nonPayee.ok ? nonPayee.raison : "", /pas encore payée/);
  // « En partie » se constate, il ne se choisit pas.
  assert.equal(passer("livraison", "en_preparation", "en_partie").ok, false);
  assert.deepEqual(passer("livraison", "envoyee", "envoyee"), { ok: true, inchange: true });
});

test("les deux dates : posées à leur étape, effacées ailleurs", () => {
  const t0 = new Date("2026-11-20T10:00:00Z");
  const t1 = new Date("2026-11-21T10:00:00Z");
  const vide = { readyAt: null, deliveredAt: null };
  assert.deepEqual(datesApresPassage("prete", vide, t1), { readyAt: t1, deliveredAt: null });
  // La première date « prête » se garde, même en revenant de « Retirée ».
  assert.deepEqual(datesApresPassage("prete", { readyAt: t0, deliveredAt: null }, t1), {
    readyAt: t0,
    deliveredAt: null,
  });
  assert.deepEqual(datesApresPassage("retiree", { readyAt: t0, deliveredAt: null }, t1), {
    readyAt: t0,
    deliveredAt: null,
  });
  assert.deepEqual(datesApresPassage("en_preparation", { readyAt: t0, deliveredAt: null }, t1), vide);
  assert.deepEqual(datesApresPassage("livree", vide, t1), { readyAt: null, deliveredAt: t1 });
  assert.deepEqual(datesApresPassage("envoyee", { readyAt: null, deliveredAt: t0 }, t1), vide);
});
