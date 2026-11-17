/**
 * Cartes cadeaux en ligne, commandes à 0 € et codes « tout gratuit » (17/11).
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/cartes-cadeaux-caisse.test.ts
 *
 * Les calculs sont ceux du moteur PARTAGÉ (@memoryline/types) : la caisse et
 * l'API les font avec les mêmes fonctions, donc ce que la cliente lit est ce
 * que le serveur encaisse.
 *
 * Les deux derniers tests touchent la BASE LOCALE, et elle seule : la double
 * dépense et le code à usage unique ne se prouvent que contre un vrai verrou.
 * Ils créent leurs lignes fictives (« TEST- … »), puis les effacent. Hors de
 * la base du conteneur local (`@db:5432`), ils ne s'exécutent pas.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import {
  cleDeCarte,
  cleDeCode,
  codeCarteMasque,
  montantCarteValide,
  optionsLivraison,
  partCarteCadeau,
  reglesActives,
  remisesPanier,
  resteAPayerCents,
  seuilPortCents,
  totalPanierCents,
  validableSansPaiement,
  type CatalogueLivraison,
  type LignePanier,
  type RegleParier,
} from "@memoryline/types";

/** Une affiche A4 à 23 €, et une A3 à 33 €. */
const A4 = (q = 1): LignePanier => ({ unitPriceCents: 2300, quantity: q, format: "A4" });
const A3 = (q = 1): LignePanier => ({ unitPriceCents: 3300, quantity: q, format: "A3" });

/** Le code de test d'Alexandra, tel que la migration 0087 l'insère. */
const TOUT_GRATUIT: RegleParier = {
  id: 5,
  name: "Tests Alexandra : tout gratuit",
  code: "V7X9-KQ4M-Z8WP-3N6R",
  type: "percent",
  config: {
    percent: 100,
    livraisonOfferte: true,
    usageUnique: false,
    conditions: { minCents: null, minQuantite: null },
    cumulable: false,
  },
  active: true,
  priority: 999,
};

/** « 3 achetées = la 4e offerte », automatique, comme en boutique. */
const TROIS_PLUS_UN: RegleParier = {
  id: 1,
  name: "3 achetées = 1 offerte",
  type: "buy_x_get_y",
  config: { buyQty: 3, getQty: 1 },
  active: true,
  priority: 10,
};

/** Deux modes : Colissimo à 6,90 €, offert dès 80 € ; un relais à 4,50 €. */
const CATALOGUE: CatalogueLivraison = {
  zones: [{ id: 1, slug: "fr", name: "France", countries: ["FR"] }],
  modes: [
    { id: 1, slug: "colissimo", name: "Colissimo", kind: "home" },
    { id: 2, slug: "relais", name: "Point relais", kind: "relay" },
  ],
  tarifs: [
    { methodId: 1, zoneId: 1, priceCents: 690, freeFromCents: 8000 },
    { methodId: 2, zoneId: 1, priceCents: 450 },
  ],
};

/** Ce que la caisse paie au total : affiches remisées, puis le port du mode. */
function totalAvecPort(
  lignes: LignePanier[],
  regles: RegleParier[],
  codes: string[],
  mode: string,
): number {
  const articles = totalPanierCents(lignes, regles, new Date(), codes);
  const option = optionsLivraison(
    CATALOGUE,
    "FR",
    articles,
    500,
    seuilPortCents(lignes, regles, new Date(), codes),
  ).find((o) => o.mode.slug === mode);
  assert.ok(option, `le mode ${mode} doit être proposé`);
  return articles + option.fraisCents;
}

/* ------------------------------------------------------------------------ */
/*  Le code « tout gratuit » : 100 % et livraison offerte                    */
/* ------------------------------------------------------------------------ */

test("100 % et livraison offerte : n'importe quel panier tombe à 0 €, port compris", () => {
  for (const lignes of [[A4()], [A3(2)], [A4(3), A3(1)], [A4(7)]])
    for (const mode of ["colissimo", "relais"])
      assert.equal(
        totalAvecPort(lignes, [TROIS_PLUS_UN, TOUT_GRATUIT], ["V7X9-KQ4M-Z8WP-3N6R"], mode),
        0,
        `${JSON.stringify(lignes)} en ${mode}`,
      );
});

test("le code se reconnaît sans casse, sans tirets et sans espaces", () => {
  assert.equal(cleDeCode("v7x9 kq4m-z8wp3n6r"), "V7X9KQ4MZ8WP3N6R");
  const actives = reglesActives([TOUT_GRATUIT], new Date(), ["v7x9kq4mz8wp3n6r"]);
  assert.equal(actives.length, 1);
  const { remiseCents, portOffert } = remisesPanier([A4(2)], [TOUT_GRATUIT], new Date(), [
    " V7X9 KQ4M Z8WP 3N6R ",
  ]);
  assert.equal(remiseCents, 4600);
  assert.equal(portOffert, true);
});

test("sans le code, rien n'est offert : ni les affiches, ni le port", () => {
  const { portOffert } = remisesPanier([A4()], [TOUT_GRATUIT], new Date(), []);
  assert.equal(portOffert, false);
  assert.equal(totalAvecPort([A4()], [TOUT_GRATUIT], [], "colissimo"), 2300 + 690);
});

test("100 % SANS l'option livraison : les affiches sont offertes, le port reste dû", () => {
  const sansPort: RegleParier = {
    ...TOUT_GRATUIT,
    config: { ...(TOUT_GRATUIT.config as object), livraisonOfferte: false },
  };
  assert.equal(totalAvecPort([A4()], [sansPort], ["V7X9-KQ4M-Z8WP-3N6R"], "colissimo"), 690);
});

test("livraison offerte, mais minimum d'achat non atteint : la règle ne joue pas du tout", () => {
  const avecMinimum: RegleParier = {
    ...TOUT_GRATUIT,
    config: { ...(TOUT_GRATUIT.config as object), conditions: { minCents: 5000 } },
  };
  const r = remisesPanier([A4()], [avecMinimum], new Date(), ["V7X9-KQ4M-Z8WP-3N6R"]);
  assert.equal(r.remiseCents, 0);
  assert.equal(r.portOffert, false);
  assert.equal(seuilPortCents([A4()], [avecMinimum], new Date(), ["V7X9-KQ4M-Z8WP-3N6R"]), null);
});

test("l'option livraison ne change rien aux remises des autres règles", () => {
  // Le même panier, avec et sans l'option : la remise est identique.
  const dixPourcent = (livraisonOfferte: boolean): RegleParier => ({
    id: 9,
    name: "-10 %",
    code: "DIX",
    type: "percent",
    config: { percent: 10, livraisonOfferte },
  });
  const lignes = [A4(4), A3()];
  const avec = remisesPanier(lignes, [TROIS_PLUS_UN, dixPourcent(true)], new Date(), ["DIX"]);
  const sans = remisesPanier(lignes, [TROIS_PLUS_UN, dixPourcent(false)], new Date(), ["DIX"]);
  assert.equal(avec.remiseCents, sans.remiseCents);
  assert.deepEqual(avec.detail, sans.detail);
  assert.equal(avec.portOffert, true);
  assert.equal(sans.portOffert, false);
});

/* ------------------------------------------------------------------------ */
/*  La carte cadeau à la caisse                                              */
/* ------------------------------------------------------------------------ */

test("carte partielle : elle paie son solde, le reste se paie par carte ou PayPal", () => {
  const total = totalAvecPort([A4(2)], [], [], "colissimo"); // 46 € + 6,90 €
  assert.equal(total, 5290);
  const carte = partCarteCadeau(total, 0, 2000);
  assert.equal(carte, 2000);
  assert.equal(resteAPayerCents(total, carte), 3290);
});

test("carte qui couvre tout : la part s'arrête au total, rien ne reste à payer", () => {
  const total = totalAvecPort([A4()], [], [], "relais"); // 23 € + 4,50 €
  const carte = partCarteCadeau(total, 0, 10_000);
  assert.equal(carte, 2750);
  assert.equal(resteAPayerCents(total, carte), 0);
  // Et la commande se valide alors sans paiement.
  assert.equal(
    validableSansPaiement({ livrable: true, totalCents: total, totalCommandeCents: total, carteCents: carte }),
    true,
  );
});

test("on ne paie pas une carte cadeau avec une carte cadeau", () => {
  // Une carte de 50 € achetée seule : la carte saisie ne paie rien.
  assert.equal(partCarteCadeau(5000, 5000, 9000), 0);
  // Un panier mixte : la carte paie les affiches et le port, pas la carte achetée.
  assert.equal(partCarteCadeau(5000 + 2990, 5000, 9000), 2990);
});

test("les codes de carte : douze ou seize signes, tirets et casse libres", () => {
  assert.equal(cleDeCarte("acef-hjkl-r234"), "ACEFHJKLR234");
  assert.equal(cleDeCarte("ACEF HJKL R234 5678"), "ACEFHJKLR2345678");
  assert.equal(cleDeCarte("acefhjklr2345678"), "ACEFHJKLR2345678");
  // Pas la forme d'une carte : longueur, ou signe hors de l'alphabet.
  assert.equal(cleDeCarte("ACEF-HJKL-R23"), null);
  assert.equal(cleDeCarte("V7X9-KQ4M-Z8WP-3N6R"), null);
  assert.equal(cleDeCarte("ACEF-HJKL-R230"), null);
  assert.equal(codeCarteMasque("ACEF-HJKL-K7R2"), "••••-••••-K7R2");
  assert.equal(codeCarteMasque("ACEF-HJKL-R234-K7R2"), "••••-••••-••••-K7R2");
});

test("le montant d'une carte vendue : de 10 à 300 €, en euros ronds", () => {
  assert.equal(montantCarteValide(1000), true);
  assert.equal(montantCarteValide(30000), true);
  assert.equal(montantCarteValide(5000), true);
  for (const faux of [999, 30100, 0, -5000, 2550, 1000.5, Number.NaN, "5000", null])
    assert.equal(montantCarteValide(faux), false, String(faux));
});

/* ------------------------------------------------------------------------ */
/*  La validation sans paiement                                              */
/* ------------------------------------------------------------------------ */

test("validation sans paiement : refusée dès qu'il reste un centime à payer", () => {
  const base = { livrable: true, totalCents: 0, totalCommandeCents: 0, carteCents: 0 };
  assert.equal(validableSansPaiement(base), true);
  // Un centime.
  assert.equal(validableSansPaiement({ ...base, totalCents: 1, totalCommandeCents: 1 }), false);
  // Une affiche sans remise.
  assert.equal(validableSansPaiement({ ...base, totalCents: 2990, totalCommandeCents: 2990 }), false);
  // Une carte qui ne couvre pas tout.
  assert.equal(
    validableSansPaiement({ ...base, totalCents: 2990, totalCommandeCents: 2990, carteCents: 2000 }),
    false,
  );
  // Le panier a bougé depuis la caisse : le total recalculé n'est plus le même.
  assert.equal(validableSansPaiement({ ...base, totalCents: 0, totalCommandeCents: 2990 }), false);
  // Le mode de livraison ne sait plus porter le colis.
  assert.equal(validableSansPaiement({ ...base, livrable: false }), false);
});

/* ------------------------------------------------------------------------ */
/*  Contre la base locale : la double dépense, le code à usage unique        */
/* ------------------------------------------------------------------------ */

const baseLocale = /@db:5432\//.test(process.env.DATABASE_URL ?? "");

after(async () => {
  if (!baseLocale) return;
  const { sql } = await import("../src/db/client.js");
  await sql.end({ timeout: 5 });
});

test(
  "double dépense impossible : deux commandes simultanées ne paient jamais avec le même solde",
  { skip: !baseLocale && "hors de la base locale du conteneur" },
  async () => {
    const { db, schema } = await import("../src/db/client.js");
    const { debiterCarte, verifierCarteSousVerrou } = await import("../src/cartes-cadeaux.js");
    const { eq, inArray } = await import("drizzle-orm");
    const suffixe = `${Date.now()}`;
    const [carte] = await db
      .insert(schema.giftCards)
      .values({
        code: `TEST-${suffixe}`,
        initialAmountCents: 3000,
        balanceCents: 3000,
        status: "active",
        note: "Test automatique : double dépense",
      })
      .returning();
    assert.ok(carte);
    await db.insert(schema.giftCardTransactions).values({
      giftCardId: carte.id,
      amountCents: 3000,
      label: "Achat de la carte (test)",
    });
    const commandes = await db
      .insert(schema.orders)
      .values(
        ["A", "B"].map((x) => ({
          channel: "web" as const,
          number: `TEST-DOUBLE-${x}-${suffixe}`,
          status: "pending",
          totalCents: 2000,
        })),
      )
      .returning();
    try {
      // Deux paiements de 20 € sur une carte de 30 €, au même instant.
      const payer = (order: { id: number; number: string }) =>
        db.transaction(async (tx) => {
          const verdict = await verifierCarteSousVerrou(tx, carte.id, 2000, new Date());
          if (!verdict.ok) return verdict.raison;
          // Le temps qu'une autre transaction tente sa chance.
          await new Promise((r) => setTimeout(r, 150));
          await debiterCarte(tx, carte.id, 2000, order);
          return "payee";
        });
      const issues = await Promise.all(commandes.map(payer));
      assert.deepEqual([...issues].sort(), ["payee", "solde"]);
      const [apres] = await db
        .select()
        .from(schema.giftCards)
        .where(eq(schema.giftCards.id, carte.id));
      assert.equal(apres?.balanceCents, 1000, "un seul débit, le solde est relu du journal");
    } finally {
      await db
        .delete(schema.giftCardTransactions)
        .where(eq(schema.giftCardTransactions.giftCardId, carte.id));
      await db.delete(schema.giftCards).where(eq(schema.giftCards.id, carte.id));
      await db.delete(schema.orders).where(
        inArray(
          schema.orders.id,
          commandes.map((c) => c.id),
        ),
      );
    }
  },
);

test(
  "code à usage unique : une commande payée le ferme, son annulation le rouvre",
  { skip: !baseLocale && "hors de la base locale du conteneur" },
  async () => {
    const { db, schema } = await import("../src/db/client.js");
    const { utilisationsDuCode } = await import("../src/promotions.js");
    const { eq } = await import("drizzle-orm");
    const code = `TEST-UNIQUE-${Date.now()}`;
    const [commande] = await db
      .insert(schema.orders)
      .values({
        channel: "web",
        number: code,
        status: "paid",
        totalCents: 0,
        // Saisi en minuscules, sans tirets : il compte quand même.
        promoCode: code.toLowerCase().replace(/-/g, ""),
      })
      .returning();
    assert.ok(commande);
    try {
      assert.equal(await utilisationsDuCode(db, code), 1);
      // La commande elle-même ne se compte pas contre elle.
      assert.equal(await utilisationsDuCode(db, code, commande.id), 0);
      await db
        .update(schema.orders)
        .set({ status: "cancelled", cancelledAt: new Date() })
        .where(eq(schema.orders.id, commande.id));
      assert.equal(await utilisationsDuCode(db, code), 0);
    } finally {
      await db.delete(schema.orders).where(eq(schema.orders.id, commande.id));
    }
  },
);
