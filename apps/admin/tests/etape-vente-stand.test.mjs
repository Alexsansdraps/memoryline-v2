/**
 * « Marquer terminées » et « Remettre à imprimer », la barre de la sélection
 * de Ventes stand (lib/etape-vente-stand.ts, 26/11, Alexandra : « il faut que
 * quand la personne créé une affiche, qu'elle ne soit pas directement
 * terminée mais qu'on doive le faire soit dans la commande soit sur la liste
 * avec case à cocher »). Sans navigateur ni base.
 *
 * Lancés par : docker exec -w /app/apps/admin memoryline-admin node --test "tests/*.test.mjs"
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compteRenduEtapeStand,
  estGesteEtapeStand,
  GESTES_ETAPE_STAND,
} from "../src/lib/etape-vente-stand.ts";

test("les deux gestes de la barre, et eux seuls", () => {
  assert.deepEqual([...GESTES_ETAPE_STAND], ["terminer-stand", "remettre-a-imprimer"]);
  assert.equal(estGesteEtapeStand("terminer-stand"), true);
  assert.equal(estGesteEtapeStand("remettre-a-imprimer"), true);
  assert.equal(estGesteEtapeStand("etape-suivante"), false);
  assert.equal(estGesteEtapeStand("test"), false);
});

test("« Marquer terminées » : combien, accordé, et aucun courriel", () => {
  assert.equal(
    compteRenduEtapeStand("terminer-stand", { count: 1 }),
    "1 vente marquée terminée. Aucun courriel n'est parti.",
  );
  assert.equal(
    compteRenduEtapeStand("terminer-stand", { count: 2, ignorees: [] }),
    "2 ventes marquées terminées. Aucun courriel n'est parti.",
  );
  assert.equal(compteRenduEtapeStand("terminer-stand", { count: 0 }), "Aucune vente n'a été marquée terminée.");
});

test("les ventes ignorées sont comptées, chacune avec son numéro et sa raison", () => {
  assert.equal(
    compteRenduEtapeStand("terminer-stand", {
      count: 2,
      ignorees: [
        { numero: "SAL-0007", raison: "vente de test" },
        { numero: "WEB-1042", raison: "commande du site, pas une vente du stand" },
      ],
    }),
    "2 ventes marquées terminées. Aucun courriel n'est parti. 2 ventes ignorées : SAL-0007 (vente de test), WEB-1042 (commande du site, pas une vente du stand).",
  );
  // Le second clic : rien n'est refait, et on le dit.
  assert.equal(
    compteRenduEtapeStand("terminer-stand", { count: 0, ignorees: [{ numero: "SAL-0036", raison: "déjà terminée" }] }),
    "Aucune vente n'a été marquée terminée. 1 vente ignorée : SAL-0036 (déjà terminée).",
  );
  // Une raison longue de l'API (un bordereau acheté) perd son point final.
  assert.match(
    compteRenduEtapeStand("remettre-a-imprimer", {
      count: 0,
      ignorees: [{ numero: "SAL-0040", raison: "Un bordereau SendCloud a été acheté pour cette commande : annulez-le d'abord." }],
    }),
    /SAL-0040 \(Un bordereau SendCloud a été acheté pour cette commande : annulez-le d'abord\)\.$/,
  );
});

test("« Remettre à imprimer » : les mêmes comptes, sans « (s) »", () => {
  assert.equal(
    compteRenduEtapeStand("remettre-a-imprimer", { count: 1 }),
    "1 vente remise « À imprimer ». Aucun courriel n'est parti.",
  );
  assert.equal(
    compteRenduEtapeStand("remettre-a-imprimer", { count: 3 }),
    "3 ventes remises « À imprimer ». Aucun courriel n'est parti.",
  );
  assert.equal(
    compteRenduEtapeStand("remettre-a-imprimer", { count: 0, ignorees: [{ numero: "SAL-0036", raison: "déjà à imprimer" }] }),
    "Aucune vente n'a été remise « À imprimer ». 1 vente ignorée : SAL-0036 (déjà à imprimer).",
  );
  for (const n of [0, 1, 2])
    assert.doesNotMatch(compteRenduEtapeStand("remettre-a-imprimer", { count: n }), /\(s\)/);
});
