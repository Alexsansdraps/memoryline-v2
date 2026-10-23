/**
 * Les données structurées calculées à partir des réglages de la boutique
 * (packages/types/src/donnees-structurees.ts) : livraison et retours d'une
 * fiche, fil d'Ariane et liste d'un rayon (AUDIT-SEO.md, DS-2 et DS-3).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  delaiDuMode,
  filDAriane,
  livraisonsStructurees,
  pageDeRayon,
  paysLivres,
  politiqueDeRetour,
  type CatalogueLivraison,
} from "../../../packages/types/src/index.ts";

/** Les réglages de livraison du site, tels que l'API les rend le 23/10. */
const catalogue: CatalogueLivraison = {
  zones: [
    { id: 1, slug: "france", name: "France", countries: ["FR", "MC"], position: 0 },
    { id: 2, slug: "europe", name: "Europe", countries: ["BE", "DE"], position: 1 },
    { id: 3, slug: "monde", name: "Reste du monde", countries: [], position: 2 },
  ],
  modes: [
    { id: 1, slug: "mondial_relay", name: "Point relais", description: "Mondial Relay — 3 à 5 jours ouvrés", kind: "relay", active: true, position: 0 },
    { id: 4, slug: "colissimo_relais", name: "Point de retrait", description: "Colissimo — bureau de poste", kind: "relay", active: true, position: 1 },
    { id: 2, slug: "colissimo", name: "À domicile", description: "Colissimo — 2 à 3 jours ouvrés", kind: "home", active: true, position: 1 },
    { id: 3, slug: "retrait", name: "Retrait sur place", description: "", kind: "pickup", active: true, position: 3 },
  ],
  tarifs: [
    { methodId: 1, zoneId: 1, priceCents: 490, freeFromCents: 6000, active: true },
    { methodId: 4, zoneId: 1, priceCents: 490, freeFromCents: 6000, active: true },
    { methodId: 2, zoneId: 1, priceCents: 690, freeFromCents: 6000, active: true },
    { methodId: 3, zoneId: 1, priceCents: 0, freeFromCents: null, active: true },
    { methodId: 1, zoneId: 2, priceCents: 790, freeFromCents: 9000, active: true },
    { methodId: 2, zoneId: 2, priceCents: 1290, freeFromCents: 9000, active: true },
    { methodId: 2, zoneId: 3, priceCents: 1990, freeFromCents: 15000, active: true },
  ],
};

test("délai d'un mode : lu dans sa description, sinon rien", () => {
  assert.deepEqual(delaiDuMode("Mondial Relay — 3 à 5 jours ouvrés"), { min: 3, max: 5 });
  assert.deepEqual(delaiDuMode("2-3 jours"), { min: 2, max: 3 });
  assert.equal(delaiDuMode("Colissimo — bureau de poste"), null);
  assert.equal(delaiDuMode(null), null);
});

test("livraison d'une affiche à 23 € : le mode le moins cher de chaque zone, sans le retrait sur place", () => {
  const l = livraisonsStructurees(catalogue, 2300) as any[];
  // France et Europe ; le reste du monde ne cite aucun pays.
  assert.equal(l.length, 2);
  assert.equal(l[0].shippingRate.value, "4.90");
  assert.equal(l[0].shippingRate.currency, "EUR");
  assert.deepEqual(
    l[0].shippingDestination.map((d: any) => d.addressCountry),
    ["FR", "MC"],
  );
  // À frais égaux, le premier mode de la caisse : Mondial Relay, 3 à 5 jours.
  assert.deepEqual(
    [l[0].deliveryTime.transitTime.minValue, l[0].deliveryTime.transitTime.maxValue],
    [3, 5],
  );
  assert.deepEqual(
    [l[0].deliveryTime.handlingTime.minValue, l[0].deliveryTime.handlingTime.maxValue],
    [2, 3],
  );
  assert.equal(l[1].shippingRate.value, "7.90");
});

test("livraison : offerte quand le prix de l'affiche atteint la franchise", () => {
  const l = livraisonsStructurees(catalogue, 6500) as any[];
  assert.equal(l[0].shippingRate.value, "0.00");
  assert.equal(l[1].shippingRate.value, "7.90");
});

test("pays livrés : ceux que les zones citent, sans doublon", () => {
  assert.deepEqual(paysLivres(catalogue), ["FR", "MC", "BE", "DE"]);
});

test("retours : aucun pour une affiche personnalisée, 14 jours pour une prête à imprimer", () => {
  const perso = politiqueDeRetour("personnalisable", ["FR"]) as any;
  assert.equal(perso.returnPolicyCategory, "https://schema.org/MerchantReturnNotPermitted");
  assert.equal(perso.applicableCountry, "FR");
  assert.equal(perso.merchantReturnDays, undefined);
  const prete = politiqueDeRetour("prete_a_imprimer", ["FR", "BE"]) as any;
  assert.equal(prete.returnPolicyCategory, "https://schema.org/MerchantReturnFiniteReturnWindow");
  assert.equal(prete.merchantReturnDays, 14);
  assert.equal(prete.returnFees, "https://schema.org/ReturnFeesCustomerResponsibility");
  assert.deepEqual(prete.applicableCountry, ["FR", "BE"]);
});

test("fil d'Ariane et liste d'un rayon : positions dans l'ordre, rangs de la page", () => {
  const fil = filDAriane([
    { nom: "Accueil", url: "https://memoryline.fr/" },
    { nom: "Villes", url: "https://memoryline.fr/affiches?collection=villes" },
  ]) as any;
  assert.deepEqual(
    fil.itemListElement.map((e: any) => [e.position, e.name]),
    [
      [1, "Accueil"],
      [2, "Villes"],
    ],
  );
  const page = pageDeRayon(
    "Villes",
    "https://memoryline.fr/affiches?collection=villes&page=2",
    [{ nom: "AMIENS", url: "https://memoryline.fr/affiches/amiens" }],
    49,
  ) as any;
  assert.equal(page["@type"], "CollectionPage");
  assert.equal(page.mainEntity.itemListElement[0].position, 49);
  assert.equal(page.mainEntity.numberOfItems, 1);
});
