/**
 * Les clients suisses (18/11) : la Suisse est dans la zone « Europe », mais
 * aucun réseau de points relais n'y livre — la recherche ne trouvait aucun
 * point à Bâle, alors que la caisse proposait « Point relais » et « Point de
 * retrait ». Hors de l'Union européenne, seuls l'envoi à domicile et le
 * retrait sur place sont proposés (packages/types, livraison.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fraisDePort,
  livraisonsStructurees,
  optionsLivraison,
  passeLaDouane,
  type CatalogueLivraison,
} from "../../../packages/types/src/index.ts";

/** Les réglages du site en ligne le 18/11, réduits à l'essentiel. */
const catalogue: CatalogueLivraison = {
  zones: [
    { id: 1, slug: "france", name: "France", countries: ["FR", "MC"], position: 0 },
    { id: 2, slug: "europe", name: "Europe", countries: ["BE", "CH", "DE", "GB"], position: 1 },
    { id: 3, slug: "monde", name: "Reste du monde", countries: [], position: 2 },
  ],
  modes: [
    { id: 1, slug: "mondial_relay", name: "Point relais", description: "Mondial Relay — 3 à 5 jours ouvrés", kind: "relay", active: true, position: 0 },
    { id: 4, slug: "colissimo_relais", name: "Point de retrait", description: "Colissimo — bureau de poste", kind: "relay", active: true, position: 1 },
    { id: 2, slug: "colissimo", name: "À domicile", description: "Colissimo — 2 à 3 jours ouvrés", kind: "home", active: true, position: 2 },
    { id: 20, slug: "retrait-au-stand", name: "Retrait au stand", description: "", kind: "pickup", active: true, position: 3 },
  ],
  tarifs: [
    { methodId: 1, zoneId: 2, priceCents: 790, freeFromCents: 9000, active: true },
    { methodId: 4, zoneId: 2, priceCents: 790, freeFromCents: 9000, active: true },
    { methodId: 2, zoneId: 2, priceCents: 1290, freeFromCents: 9000, active: true },
    { methodId: 20, zoneId: 2, priceCents: 0, freeFromCents: null, active: true },
    { methodId: 2, zoneId: 3, priceCents: 1990, freeFromCents: 15000, active: true },
  ],
};

const modes = (pays: string) => optionsLivraison(catalogue, pays, 2300).map((o) => o.mode.slug);

test("Suisse : pas de point relais, l'envoi à domicile et le retrait au stand restent", () => {
  assert.deepEqual(modes("CH"), ["colissimo", "retrait-au-stand"]);
  assert.deepEqual(modes("ch"), ["colissimo", "retrait-au-stand"]);
  // Le serveur refuse donc un point relais pour la Suisse (même règle).
  assert.equal(fraisDePort(catalogue, "mondial_relay", "CH", 2300), null);
  assert.equal(fraisDePort(catalogue, "colissimo", "CH", 2300)?.fraisCents, 1290);
});

test("Royaume-Uni : même règle hors UE", () => {
  assert.deepEqual(modes("GB"), ["colissimo", "retrait-au-stand"]);
});

test("Belgique et Allemagne : les points relais restent proposés", () => {
  assert.deepEqual(modes("BE"), ["mondial_relay", "colissimo_relais", "colissimo", "retrait-au-stand"]);
  assert.deepEqual(modes("DE"), ["mondial_relay", "colissimo_relais", "colissimo", "retrait-au-stand"]);
});

test("douane : UE et Monaco non, Suisse, Royaume-Uni et Outre-mer oui, pays inconnu non", () => {
  for (const p of ["FR", "MC", "BE", "DE", "IT", "SE"]) assert.equal(passeLaDouane(p), false, p);
  for (const p of ["CH", "LI", "GB", "NO", "US", "GP", "RE"]) assert.equal(passeLaDouane(p), true, p);
  assert.equal(passeLaDouane(""), false);
  assert.equal(passeLaDouane("France"), false);
});

test("données Google : la Suisse et le Royaume-Uni à part, au prix de l'envoi à domicile", () => {
  const l = livraisonsStructurees(catalogue, 2300) as any[];
  const europe = l.map((d) => ({
    pays: d.shippingDestination.map((x: any) => x.addressCountry),
    prix: d.shippingRate.value,
  }));
  assert.deepEqual(europe, [
    { pays: ["BE", "DE"], prix: "7.90" },
    { pays: ["CH", "GB"], prix: "12.90" },
  ]);
});
