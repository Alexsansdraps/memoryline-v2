/**
 * « Marquer terminées » et « Remettre à imprimer » dans Ventes stand (26/11,
 * Alexandra : « il faut que quand la personne créé une affiche, qu'elle ne
 * soit pas directement terminée mais qu'on doive le faire soit dans la
 * commande soit sur la liste avec case à cocher »). Les règles de
 * etape-vente-stand.ts, sans base de données.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/etape-vente-stand.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ui } from "../../web/src/i18n/ui.ts";
// Les mots des courriels (« livraison.remiseStand »), repris par le site.
import { fr } from "../src/courriels/fr.js";
import { en } from "../src/courriels/en.js";
import { de } from "../src/courriels/de.js";
import { it } from "../src/courriels/it.js";
import { es } from "../src/courriels/es.js";
import { ja } from "../src/courriels/ja.js";
import { zh } from "../src/courriels/zh.js";
import {
  ACTIONS_ETAPE_STAND,
  estActionEtapeStand,
  raisonDejaFaite,
  refusEtapeDuStand,
  traitementVuParLaCliente,
  type VenteCochee,
} from "../src/etape-vente-stand.js";
import { etapeDe, passageEtape } from "@memoryline/types";

/** Une vente validée à la tablette : payée, sans étiquette « test ». */
const vente: VenteCochee = {
  number: "SAL-0036",
  channel: "salon",
  status: "paid",
  tags: ["Marché de Noël Mulhouse"],
  legacyId: null,
};

test("les deux gestes de la sélection, et l'étape où chacun mène", () => {
  assert.equal(ACTIONS_ETAPE_STAND["terminer-stand"], "terminee");
  assert.equal(ACTIONS_ETAPE_STAND["remettre-a-imprimer"], "a_imprimer");
  assert.equal(estActionEtapeStand("terminer-stand"), true);
  assert.equal(estActionEtapeStand("remettre-a-imprimer"), true);
  // Les gestes d'avant gardent leur chemin, et rien d'hérité ne passe.
  assert.equal(estActionEtapeStand("fulfil"), false);
  assert.equal(estActionEtapeStand("etape-suivante"), false);
  assert.equal(estActionEtapeStand("toString"), false);
});

test("seule une vente du stand payée s'y prête", () => {
  assert.equal(refusEtapeDuStand(vente), null);
  // Une étiquette qui n'est pas exactement « test » ne fait pas une vente de test.
  assert.equal(refusEtapeDuStand({ ...vente, tags: ["TEST : viendra chercher le 20/9"] }), null);
});

test("les autres sont ignorées, avec une raison courte, sans majuscule ni point", () => {
  const raisons = [
    refusEtapeDuStand({ ...vente, channel: "web", number: "WEB-1042" }),
    refusEtapeDuStand({ ...vente, legacyId: 5512, number: "SHOP-1042" }),
    refusEtapeDuStand({ ...vente, legacyId: 5512 }),
    refusEtapeDuStand({ ...vente, status: "draft" }),
    refusEtapeDuStand({ ...vente, status: "cancelled", tags: ["Test"] }),
    refusEtapeDuStand({ ...vente, status: "cancelled" }),
    refusEtapeDuStand({ ...vente, status: "voided" }),
    refusEtapeDuStand({ ...vente, status: "pending" }),
  ];
  assert.deepEqual(raisons, [
    "commande du site, pas une vente du stand",
    "reprise de l'ancienne boutique Shopify, traitée là-bas",
    "reprise de l'ancienne boutique Shopify, traitée là-bas",
    "rouverte sur la tablette et pas revalidée",
    "vente de test",
    "vente annulée",
    "vente annulée",
    "pas encore réglée",
  ]);
  for (const r of raisons) {
    assert.doesNotMatch(r!, /^[A-ZÀ-Ý]|\.$|\(s\)/);
  }
  assert.equal(raisonDejaFaite("terminee"), "déjà terminée");
  assert.equal(raisonDejaFaite("a_imprimer"), "déjà à imprimer");
});

test("une vente payée sans remise est « À imprimer » ; marquée, « Terminée » ; et l'inverse, sans courriel", () => {
  // Ce que dit traitement.ts d'une vente du stand validée le 26/11 : payée,
  // deux affiches, aucune remise.
  const payee = { status: "paid", articles: 2, expedies: 0 };
  assert.equal(etapeDe("stand", payee), "a_imprimer");
  const marquer = passageEtape("stand", "a_imprimer", "terminee");
  assert.ok(marquer.ok && !marquer.inchange);
  assert.equal(marquer.ok && !marquer.inchange && marquer.expedier, true);
  assert.equal(marquer.ok && !marquer.inchange && marquer.courrier, null);
  assert.equal(etapeDe("stand", { ...payee, expedies: 2 }), "terminee");
  const remettre = passageEtape("stand", "terminee", "a_imprimer");
  assert.ok(remettre.ok && !remettre.inchange);
  assert.equal(remettre.ok && !remettre.inchange && remettre.annulerExpeditions, true);
  assert.equal(remettre.ok && !remettre.inchange && remettre.courrier, null);
  // Le second clic de « Marquer terminées » ne refait rien.
  assert.deepEqual(passageEtape("stand", "terminee", "terminee"), { ok: true, inchange: true });
});

test("« Mon compte » : un achat au stand se dit « Remise sur le stand », quelle que soit son étape", () => {
  assert.equal(traitementVuParLaCliente({ channel: "salon", status: "paid" }, "unfulfilled"), "stand");
  assert.equal(traitementVuParLaCliente({ channel: "salon", status: "paid" }, "fulfilled"), "stand");
  assert.equal(traitementVuParLaCliente({ channel: "salon", status: "cancelled" }, "unfulfilled"), "cancelled");
  // Une commande du site garde son statut calculé.
  assert.equal(traitementVuParLaCliente({ channel: "web", status: "paid" }, "unfulfilled"), "unfulfilled");
  assert.equal(traitementVuParLaCliente({ channel: "web", status: "paid" }, "fulfilled"), "fulfilled");
});

/*
 * La clé « compte.statut.expedition.stand » existe dans les sept langues du
 * site (apps/web/src/i18n/ui.ts) : sans elle, la page « Mon compte » afficherait
 * le code brut « stand ». Ses mots sont ceux des courriels de la boutique
 * (« livraison.remiseStand »), déjà traduits : la cliente lit la même chose
 * partout.
 */
test("« Remise sur le stand » se dit dans les sept langues, avec les mots des courriels", () => {
  const courriels = { fr, en, de, it, es, ja, zh } as const;
  for (const [langue, mots] of Object.entries(courriels)) {
    const site = (ui as Record<string, Record<string, string>>)[langue];
    assert.ok(site, `la langue ${langue} existe sur le site`);
    assert.equal(
      site!["compte.statut.expedition.stand"],
      (mots as Record<string, string>)["livraison.remiseStand"],
      `« Remise sur le stand » en ${langue}`,
    );
  }
});
