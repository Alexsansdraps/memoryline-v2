/**
 * Les essais du moteur de promotions (packages/types/src/promo.ts), sans base
 * ni réseau.
 *
 * Lancés par : docker exec -w /app/apps/api memoryline-api npx tsx --test tests/promo.test.ts
 *
 * Le premier bloc compare le moteur à une copie de l'ANCIEN calcul, gardée
 * ici telle qu'elle était : une règle enregistrée avant la nouvelle forme
 * (la « 3 achetées = 1 A4 offerte » de la boutique) doit remiser exactement
 * les mêmes paniers, au centime près. Le second vérifie la forme réglable
 * demandée par Margaux : 3 affiches de n'importe quelle taille, une A4
 * offerte, sans son cadre.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  libelleRegle,
  remisesPanier,
  seuilDeclenchement,
  type LignePanier,
  type RegleParier,
} from "@memoryline/types";

/* -------------------------------------------------------------------------- */
/*  L'ancien calcul, tel qu'il était (référence)                              */
/* -------------------------------------------------------------------------- */

function ancienneRemise(lignes: LignePanier[], cfg: Record<string, unknown>): number {
  const nombre = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const buyQty = Math.max(1, Math.floor(nombre(cfg.buyQty, 3)));
  const getQty = Math.max(1, Math.floor(nombre(cfg.getQty, 1)));
  const pct = Math.min(100, Math.max(0, nombre(cfg.percent, 100)));
  const vise = typeof cfg.format === "string" && cfg.format ? cfg.format : null;
  const eligibles: number[] = [];
  for (const l of lignes) {
    if (vise && (l.format ?? null) !== vise) continue;
    const q = Math.max(0, Math.floor(nombre(l.quantity, 0)));
    for (let i = 0; i < q; i++) eligibles.push(nombre(l.unitPriceCents, 0));
  }
  eligibles.sort((a, b) => a - b);
  const offerts = Math.floor(eligibles.length / (buyQty + getQty)) * getQty;
  let montant = 0;
  for (let i = 0; i < offerts && i < eligibles.length; i++)
    montant += Math.round((eligibles[i]! * pct) / 100);
  const sousTotal = lignes.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
  return Math.min(montant, sousTotal);
}

const A4 = (q = 1, prix = 2300, cadreCents = 0): LignePanier => ({ unitPriceCents: prix, quantity: q, format: "A4", cadreCents });
const A3 = (q = 1, prix = 2900, cadreCents = 0): LignePanier => ({ unitPriceCents: prix, quantity: q, format: "A3", cadreCents });

const regle = (config: unknown, autres: Partial<RegleParier> = {}): RegleParier => ({
  id: 1,
  name: "Offre",
  type: "buy_x_get_y",
  config,
  active: true,
  ...autres,
});
const remise = (lignes: LignePanier[], regles: RegleParier[]) =>
  remisesPanier(lignes, regles, new Date("2026-10-08T12:00:00Z")).remiseCents;

const ANCIENNE_REGLE_1 = { buyQty: 3, getQty: 1, format: "A4", percent: 100 };

test("ancienne forme : même remise que l'ancien calcul, sur une douzaine de paniers", () => {
  const paniers: LignePanier[][] = [
    [],
    [A4(1)],
    [A4(3)],
    [A4(4)],
    [A4(4, 2300, 1500)],
    [A4(2), A4(2, 2600)],
    [A4(8)],
    [A3(3), A4(1)],
    [A3(4)],
    [A4(3), A3(5), A4(2, 2100)],
    [{ unitPriceCents: 2300, quantity: 4, format: null }],
    [A4(7, 1999), A4(1, 4500)],
  ];
  const configs: Record<string, unknown>[] = [
    ANCIENNE_REGLE_1,
    { buyQty: 3, getQty: 1 },
    { buyQty: 1, getQty: 1, percent: 50 },
    { buyQty: 2, getQty: 2, format: "A3" },
    {},
  ];
  for (const cfg of configs)
    for (const p of paniers)
      assert.equal(remise(p, [regle(cfg)]), ancienneRemise(p, cfg), `${JSON.stringify(cfg)} sur ${JSON.stringify(p)}`);
});

test("ancienne forme : la phrase ne change pas", () => {
  assert.equal(
    libelleRegle(regle(ANCIENNE_REGLE_1)),
    "3 affiches achetées, la 4e offerte (format A4 seulement)",
  );
});

/* -------------------------------------------------------------------------- */
/*  La nouvelle forme : 3 achetées (tous formats) = 1 A4 offerte, sans cadre   */
/* -------------------------------------------------------------------------- */

const OFFRE_MARGAUX = {
  version: 2,
  achat: { quantite: 3, formats: [] },
  offert: { quantite: 1, formats: ["A4"], pourcentage: 100, cadreCompris: false, maxLots: null },
};

test("3 A3 + 1 A4 encadrée : seule l'affiche A4 est offerte, pas son cadre", () => {
  // A4 encadrée : 23 € d'affiche + 15 € de cadre = 38 €.
  assert.equal(remise([A3(3), A4(1, 3800, 1500)], [regle(OFFRE_MARGAUX)]), 2300);
});

test("4 A4 → une offerte ; 3 A3 → rien ; 8 affiches dont 2 A4 → deux offertes", () => {
  assert.equal(remise([A4(4)], [regle(OFFRE_MARGAUX)]), 2300);
  assert.equal(remise([A3(3)], [regle(OFFRE_MARGAUX)]), 0);
  assert.equal(remise([A3(6), A4(2)], [regle(OFFRE_MARGAUX)]), 4600);
});

test("la moins chère des A4 est offerte, cadre déduit", () => {
  // Deux A4 : l'une nue à 23 €, l'autre encadrée à 38 € dont 15 € de cadre.
  // Affiche seule : 23 € chacune ; la remise vaut 23 €, jamais le cadre.
  assert.equal(remise([A3(2), A4(1, 2300), A4(1, 3800, 1500)], [regle(OFFRE_MARGAUX)]), 2300);
});

test("cadre compris : le cadre part avec l'affiche offerte", () => {
  const avecCadre = { ...OFFRE_MARGAUX, offert: { ...OFFRE_MARGAUX.offert, cadreCompris: true } };
  assert.equal(remise([A3(3), A4(1, 3800, 1500)], [regle(avecCadre)]), 3800);
});

test("maximum de lots : 9 affiches, une seule offerte si maxLots = 1", () => {
  const unSeul = { ...OFFRE_MARGAUX, offert: { ...OFFRE_MARGAUX.offert, maxLots: 1 } };
  assert.equal(remise([A3(6), A4(3)], [regle(unSeul)]), 2300);
  assert.equal(remise([A3(6), A4(3)], [regle(OFFRE_MARGAUX)]), 4600);
});

test("une règle archivée ne remise plus rien", () => {
  assert.equal(remise([A4(4)], [regle(OFFRE_MARGAUX, { archivedAt: "2026-10-01T00:00:00Z" })]), 0);
});

test("non cumulable : elle ne joue pas après une autre, et arrête les suivantes", () => {
  const dixPourcent = (cumulable?: boolean): RegleParier => ({
    id: 2,
    name: "-10 %",
    type: "percent",
    config: cumulable === undefined ? { percent: 10 } : { percent: 10, cumulable },
    active: true,
    priority: 5,
  });
  const offre = regle({ ...OFFRE_MARGAUX, cumulable: false }, { priority: 10 });
  const panier = [A3(3), A4(1)];
  // L'offre passe d'abord (priorité 10) et arrête le -10 %.
  const r = remisesPanier(panier, [offre, dixPourcent()], new Date());
  assert.deepEqual(r.detail.map((d) => d.regle), ["Offre"]);
  // Le -10 % d'abord : l'offre non cumulable ne joue plus.
  const r2 = remisesPanier(panier, [{ ...offre, priority: 1 }, dixPourcent()], new Date());
  assert.deepEqual(r2.detail.map((d) => d.regle), ["-10 %"]);
  // Absent = cumulable, comme avant : les deux jouent.
  const r3 = remisesPanier(panier, [regle(OFFRE_MARGAUX, { priority: 10 }), dixPourcent()], new Date());
  assert.equal(r3.detail.length, 2);
});

test("minimum non atteint → rien", () => {
  const avecMinimum = { ...OFFRE_MARGAUX, conditions: { minCents: 15000, minQuantite: null } };
  // 3 × 29 € + 23 € = 110 € : sous les 150 €.
  assert.equal(remise([A3(3), A4(1)], [regle(avecMinimum)]), 0);
  // 5 × 29 € + 23 € = 168 € : au-dessus.
  assert.equal(remise([A3(5), A4(1)], [regle(avecMinimum)]), 2300);
  const auMoinsSix = { percent: 10, conditions: { minQuantite: 6 } };
  assert.equal(remise([A4(5)], [regle(auMoinsSix, { type: "percent" })]), 0);
  assert.equal(remise([A4(6)], [regle(auMoinsSix, { type: "percent" })]), 1380);
});

test("la phrase et le seuil de la nouvelle forme", () => {
  assert.equal(
    libelleRegle(regle(OFFRE_MARGAUX)),
    "3 affiches achetées (tous formats) = 1 A4 offerte, cadre non compris",
  );
  assert.equal(seuilDeclenchement(regle(OFFRE_MARGAUX)), 4);
});

/* -------------------------------------------------------------------------- */
/*  Ce que l'écran Promotions et l'écran du bandeau enregistrent              */
/* -------------------------------------------------------------------------- */

test("une ancienne forme envoyée à l'enregistrement devient la nouvelle, sans changer de sens", async () => {
  const { configPromotion } = await import("../src/promotions.ts");
  const lu = configPromotion("buy_x_get_y", ANCIENNE_REGLE_1);
  assert.ok("config" in lu);
  const panier = [A4(4), A3(2)];
  assert.equal(remise(panier, [regle(lu.config)]), remise(panier, [regle(ANCIENNE_REGLE_1)]));
  // Tous les formats cochés, c'est « tous les formats ».
  const tous = configPromotion("buy_x_get_y", {
    ...OFFRE_MARGAUX,
    achat: { quantite: 3, formats: ["A4", "A3"] },
  });
  assert.ok("config" in tous);
  assert.deepEqual((tous.config.achat as { formats: string[] }).formats, []);
  // Un réglage qui ne veut rien dire est refusé, en clair.
  assert.ok("erreur" in configPromotion("buy_x_get_y", { ...OFFRE_MARGAUX, offert: { ...OFFRE_MARGAUX.offert, pourcentage: 0 } }));
  assert.ok("erreur" in configPromotion("percent", { percent: 120 }));
  assert.ok("erreur" in configPromotion("inconnu", {}));
});

test("bandeau : un message seul, ou avec un bouton complet ; jamais une moitié de bouton", async () => {
  const { messageRecu } = await import("../src/bandeau.ts");
  assert.ok("valeurs" in messageRecu({ message: "Livraison offerte dès 60 €" }));
  const complet = messageRecu({ message: "Nouveautés", linkLabel: "Voir", linkUrl: "affiches" });
  assert.ok("valeurs" in complet);
  // Une adresse sans barre de tête devient une page du site.
  assert.equal(complet.valeurs.linkUrl, "/affiches");
  assert.ok("erreur" in messageRecu({ message: "x", linkLabel: "Voir" }));
  assert.ok("erreur" in messageRecu({ message: "x", linkUrl: "/affiches" }));
  assert.ok("erreur" in messageRecu({ message: "" }));
  assert.ok("erreur" in messageRecu({ message: "x".repeat(201) }));
});
