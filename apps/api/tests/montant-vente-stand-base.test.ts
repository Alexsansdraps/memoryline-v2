/**
 * Corriger le montant d'une vente du stand, de bout en bout (26/11, Margaux :
 * « pouvoir modifier le montant € de la commande stand une fois qu'elle est
 * validée (car des fois ils changent d'avis ils veulent un cadre par
 * exemple) le but est d'avoir les statistiques bon »).
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/montant-vente-stand-base.test.ts
 *
 * Par les vraies routes (POST /admin/orders/:id/montant, la liste, les
 * totaux du stand et la carte de l'accueil, la page Finances, la tablette
 * qui rouvre une vente, la page « Mon compte » de la cliente) : le total suit
 * partout, le grand livre reçoit une écriture de correction sans que
 * l'encaissement d'origine bouge, la page Finances ne signale aucune
 * anomalie, « Mon compte » explique la hausse (« Ajustement du prix »), la
 * tablette ne rouvre plus la vente corrigée, et une vente facturée est
 * refusée.
 *
 * Touche la BASE LOCALE, et elle seule (`@db:5432`, hors production) : il
 * crée son stand du jour, piloté à la main, sa cliente et sa vente fictives
 * (« TEST-MONTANT-… »), puis les efface, avec le lieu de retrait que la tâche
 * des stands aurait pu lui poser. Il ne numérote aucune facture : le numéro
 * posé pour le refus est fictif.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { jourAParis } from "@memoryline/types";
import { mountOrderRoutes } from "../src/commandes.js";
import { COOKIE_CLIENT, creerSessionClient, mountCompteRoutes } from "../src/comptes.js";
import { mountFinances } from "../src/finances.js";
import { mountSalonRoutes, nouveauCode } from "../src/salon.js";

// Une base de conteneur local, et jamais la production : l'image de
// production contient les tests, NODE_ENV=production les en écarte.
const baseLocale =
  /@db:5432\//.test(process.env.DATABASE_URL ?? "") && process.env.NODE_ENV !== "production";

after(async () => {
  if (!baseLocale) return;
  const { sql } = await import("../src/db/client.js");
  await sql.end({ timeout: 5 });
});

/** Les routes des commandes, de la page Finances et du stand, la session de propriétaire déjà posée. */
function application(): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("utilisateur", {
      sessionId: "essai",
      adminUserId: 1,
      email: "essai@example.invalid",
      role: "owner",
      standIds: [],
    });
    await next();
  });
  mountOrderRoutes(app);
  mountFinances(app);
  mountSalonRoutes(app);
  // « Mon compte » d'une habituée (relecture du 26/11) : la page de la
  // commande doit expliquer un montant corrigé à la hausse.
  mountCompteRoutes(app);
  return app;
}

test(
  "hausse puis baisse : total, grand livre, journal, Finances, liste, tablette, facture",
  { skip: !baseLocale && "hors de la base locale du conteneur" },
  async () => {
    const { db, schema } = await import("../src/db/client.js");
    const { asc, eq } = await import("drizzle-orm");
    const suffixe = `${Date.now()}`;
    const jour = jourAParis(new Date());
    // Un stand du jour, piloté à la main (la tâche des stands ne touche pas
    // à son ouverture) : la carte de l'accueil (/admin/stands/en-cours) le
    // compte. Son lieu de retrait, si la tâche en pose un, part avec lui.
    const [stand] = await db
      .insert(schema.stands)
      .values({
        code: nouveauCode(),
        nom: `TEST-MONTANT-${suffixe}`,
        ouvert: true,
        actif: true,
        pilotage: "manuel",
        dateDebut: jour,
        dateFin: jour,
      })
      .returning();
    const cartId = `test-montant-${suffixe}`;
    // Une habituée qui a un compte : la vente du stand se range sur sa fiche
    // (salon.ts) et se relit dans « Mon compte » (comptes.ts).
    const [habituee] = await db
      .insert(schema.customers)
      .values({ email: `test-montant-${suffixe}@example.invalid`, name: "Essai Montant" })
      .returning();
    const [vente] = await db
      .insert(schema.orders)
      .values({
        channel: "salon" as const,
        number: `TEST-MONTANT-${suffixe}`,
        clientOrderId: cartId,
        status: "paid",
        totalCents: 2900,
        standId: stand!.id,
        customerId: habituee!.id,
        fulfilledAt: new Date(),
      })
      .returning();
    const id = vente!.id;
    try {
      const [cadre] = await db.select().from(schema.frames).orderBy(asc(schema.frames.id)).limit(1);
      // UNE affiche à 29 € : les articles valent le total de départ. À deux
      // (58 € pour 29 €), la vente ne passait « sans anomalie » que grâce à
      // la promotion « 3 achetées = 1 A4 offerte » de la base locale, qui
      // excuse tout surplus d'articles — et l'essai ne voyait plus si la
      // correction entrait dans les articles attendus (relecture du 26/11).
      await db.insert(schema.orderItems).values({
        orderId: id,
        title: "VIEUX MOULIN",
        unitPriceCents: 2900,
        quantity: 1,
        config: { schemaVersion: 1, format: "A3", frameId: cadre?.id ?? null },
      });
      const [origine] = await db
        .insert(schema.orderTransactions)
        .values({ orderId: id, kind: "sale", status: "success", amountCents: 2900, gateway: "stand" })
        .returning();
      const app = application();
      const corriger = (totalCents: number | null, motif: string) =>
        app.request(`/admin/orders/${id}/montant`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ totalCents, motif, author: "essai@example.invalid" }),
        });
      const relire = async () => {
        const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
        const livre = await db
          .select()
          .from(schema.orderTransactions)
          .where(eq(schema.orderTransactions.orderId, id))
          .orderBy(asc(schema.orderTransactions.id));
        const journal = await db
          .select()
          .from(schema.orderEvents)
          .where(eq(schema.orderEvents.orderId, id))
          .orderBy(asc(schema.orderEvents.id));
        return { total: o!.totalCents, livre, journal };
      };
      // Les totaux du stand : la liste des stands (BO › Ventes stand) et la
      // carte de l'accueil (stands en cours, aujourd'hui et depuis le début).
      const totauxDuStand = async () => {
        const tous = (await (await app.request("/admin/stands")).json()) as {
          stands: { id: number; cents: number; commandes: number }[];
        };
        const enCours = (await (await app.request("/admin/stands/en-cours")).json()) as {
          stands: { id: number; aujourdhui: { cents: number }; depuisLeDebut: { cents: number } }[];
        };
        const carte = enCours.stands.find((s) => s.id === stand!.id);
        return {
          stands: tous.stands.find((s) => s.id === stand!.id)?.cents,
          aujourdhui: carte?.aujourdhui.cents,
          depuisLeDebut: carte?.depuisLeDebut.cents,
        };
      };
      const finances = async () => {
        const res = await app.request(`/admin/finances?du=${jour}&au=${jour}`);
        assert.equal(res.status, 200);
        const f = (await res.json()) as {
          anomalies: { id: number; raison: string }[];
          mouvements: { orderId: number; genre: string; cents: number }[];
        };
        return {
          anomalie: f.anomalies.find((a) => a.id === id)?.raison ?? null,
          mouvements: f.mouvements
            .filter((m) => m.orderId === id)
            .map((m) => `${m.genre} ${m.cents}`)
            .sort(),
        };
      };

      // La page « Mon compte » de l'habituée (GET /compte/commandes/:id).
      const jeton = await creerSessionClient(habituee!.id);
      const compte = async () => {
        const r = await app.request(`/compte/commandes/${id}`, {
          headers: { cookie: `${COOKIE_CLIENT}=${jeton}` },
        });
        assert.equal(r.status, 200);
        const { montants: m } = (await r.json()) as {
          montants: { sousTotalCents: number; ajustementCents: number; remiseCents: number; totalCents: number };
        };
        return { sousTotal: m.sousTotalCents, ajustement: m.ajustementCents, remise: m.remiseCents, total: m.totalCents };
      };

      // Avant : ni anomalie, un seul encaissement.
      assert.deepEqual(await finances(), { anomalie: null, mouvements: ["Vente 2900"] });
      assert.deepEqual(await totauxDuStand(), { stands: 2900, aujourdhui: 2900, depuisLeDebut: 2900 });
      assert.deepEqual(await compte(), { sousTotal: 2900, ajustement: 0, remise: 0, total: 2900 });

      // 1. La hausse : un cadre pris après la validation, 29 € → 39 €.
      let res = await corriger(3900, "  cadre   ajouté ");
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), {
        ok: true,
        inchange: false,
        numero: vente!.number,
        avantCents: 2900,
        apresCents: 3900,
      });
      let lu = await relire();
      assert.equal(lu.total, 3900);
      assert.equal(lu.livre.length, 2);
      assert.deepEqual(
        { ...lu.livre[0], createdAt: null },
        { ...origine, createdAt: null },
        "l'encaissement d'origine n'a pas bougé",
      );
      assert.deepEqual(
        { kind: lu.livre[1]!.kind, status: lu.livre[1]!.status, cents: lu.livre[1]!.amountCents, gateway: lu.livre[1]!.gateway, parent: lu.livre[1]!.parentId, message: lu.livre[1]!.message },
        { kind: "sale", status: "success", cents: 1000, gateway: "stand", parent: origine!.id, message: "cadre ajouté" },
      );
      assert.equal(
        lu.journal.at(-1)!.message,
        "Montant de la vente corrigé : 29,00 € → 39,00 € (+10,00 €). Motif : « cadre ajouté ».",
      );
      assert.equal(lu.journal.at(-1)!.author, "essai@example.invalid");
      assert.deepEqual(await finances(), {
        anomalie: null,
        mouvements: ["Correction du montant 1000", "Vente 2900"],
      });
      assert.deepEqual(await totauxDuStand(), { stands: 3900, aujourdhui: 3900, depuisLeDebut: 3900 });
      // « Mon compte » : 29 € d'articles, + 10 € d'ajustement, 39 € au total.
      assert.deepEqual(await compte(), { sousTotal: 2900, ajustement: 1000, remise: 0, total: 3900 });

      // 2. La baisse : 39 € → 25 €, de l'argent rendu sur place.
      res = await corriger(2500, "erreur de saisie");
      assert.equal(res.status, 200);
      lu = await relire();
      assert.equal(lu.total, 2500);
      assert.deepEqual(
        lu.livre.map((e) => `${e.kind} ${e.status} ${e.amountCents} ${e.gateway} ${e.parentId ?? "-"}`),
        ["sale success 2900 stand -", `sale success 1000 stand ${origine!.id}`, `refund success 1400 stand ${origine!.id}`],
      );
      assert.match(lu.journal.at(-1)!.message, /39,00 € → 25,00 € \(−14,00 €\)\. Motif : « erreur de saisie »/);
      assert.deepEqual(await finances(), {
        anomalie: null,
        mouvements: ["Correction du montant -1400", "Correction du montant 1000", "Vente 2900"],
      });
      assert.deepEqual(await totauxDuStand(), { stands: 2500, aujourdhui: 2500, depuisLeDebut: 2500 });
      // Nette à la baisse (−4 €) : plus d'ajustement, la page lit une remise.
      assert.deepEqual(await compte(), { sousTotal: 2900, ajustement: 0, remise: 400, total: 2500 });

      // 3. Le même montant : rien n'est écrit.
      res = await corriger(2500, "rien");
      assert.deepEqual(await res.json(), {
        ok: true,
        inchange: true,
        numero: vente!.number,
        avantCents: 2500,
        apresCents: 2500,
      });
      assert.equal((await relire()).livre.length, 3);

      // 4. La liste de Ventes stand : le choix du client, par affiche.
      res = await app.request(`/admin/orders?channel=salon&stand=${stand!.id}`);
      const liste = (await res.json()) as {
        id: number;
        totalCents: number;
        affiches: { titre: string; format: string; cadre: string | null; paysage: boolean; quantite: number }[];
      }[];
      const ligne = liste.find((o) => o.id === id)!;
      assert.equal(ligne.totalCents, 2500);
      assert.deepEqual(
        ligne.affiches.map(({ titre, format, cadre: c, paysage, quantite }) => ({ titre, format, cadre: c, paysage, quantite })),
        [{ titre: "VIEUX MOULIN", format: "A3", cadre: cadre?.name ?? null, paysage: false, quantite: 1 }],
      );

      // 5. La tablette ne rouvre plus une vente corrigée au BO.
      res = await app.request("/salon/commandes/rouvrir", {
        method: "POST",
        headers: { "content-type": "application/json", "x-salon-code": stand!.code },
        body: JSON.stringify({ cartId, numero: vente!.number }),
      });
      assert.equal(res.status, 409);
      assert.match(((await res.json()) as { error: string }).error, /corrigé au back-office/);
      assert.equal((await relire()).total, 2500, "toujours payée, au montant corrigé");

      // 6. Facturée (numéro fictif : aucun numéro réel n'est pris) : refusée.
      await db
        .update(schema.orders)
        .set({ invoiceNumber: `TEST-F-${suffixe}` })
        .where(eq(schema.orders.id, id));
      res = await corriger(3000, "cadre ajouté");
      assert.equal(res.status, 409);
      assert.match(((await res.json()) as { error: string }).error, /une facture émise ne se modifie pas/);
      assert.equal((await relire()).total, 2500);
    } finally {
      await db.delete(schema.orders).where(eq(schema.orders.id, id));
      await db.delete(schema.pickupPoints).where(eq(schema.pickupPoints.standId, stand!.id));
      await db.delete(schema.stands).where(eq(schema.stands.id, stand!.id));
      // Sa session part avec elle (cascade).
      await db.delete(schema.customers).where(eq(schema.customers.id, habituee!.id));
    }
  },
);
