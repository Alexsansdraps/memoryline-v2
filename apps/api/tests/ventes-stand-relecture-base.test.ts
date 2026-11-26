/**
 * Ventes du stand « À imprimer » : ce que la relecture du 26/11 a trouvé,
 * essayé sur la base, par les vraies routes.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/ventes-stand-relecture-base.test.ts
 *
 *  1. « Marquer terminées » (BO) et « Revenir à ma commande » (tablette)
 *     lancés ensemble : ni le panier rouvert ni la vente revalidée ne gardent
 *     de remise réussie, et la vente revalidée naît « À imprimer »
 *     (verrou-commande.ts, et la validation qui annule une remise restée).
 *  2. Le filtre « Statuts » de la liste passe AVANT sa limite : une vente « À
 *     imprimer » plus ancienne que les dernières se retrouve encore.
 *  3. La migration 0114 rejouée au démarrage rattrape une vente validée par
 *     l'ancienne API pendant la mise en ligne — et rien d'autre (dans une
 *     transaction annulée).
 *
 * Touche la BASE LOCALE, et elle seule (`@db:5432`, hors production) : il
 * crée son stand du jour, sa cliente et ses ventes fictives
 * (« TEST-RELECTURE-… »), puis les efface. Les ventes validées prennent les
 * numéros SAL- suivants de la base locale, rendus à leur effacement. Aucune
 * ligne n'a de configuration : rien ne part au rendu des fichiers
 * d'impression. Aucun courriel (le stand n'en envoie pas).
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { jourAParis } from "@memoryline/types";
import { mountOrderRoutes } from "../src/commandes.js";
import { mountSalonRoutes, nouveauCode, rattraperLesVentesDeLAncienneRegle } from "../src/salon.js";

const baseLocale =
  /@db:5432\//.test(process.env.DATABASE_URL ?? "") && process.env.NODE_ENV !== "production";

after(async () => {
  if (!baseLocale) return;
  const { sql } = await import("../src/db/client.js");
  await sql.end({ timeout: 5 });
});

/** Les routes des commandes et du stand, la session de propriétaire posée. */
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
  mountSalonRoutes(app);
  return app;
}

const pause = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

test(
  "course « Marquer terminées » / « Revenir à ma commande », et le filtre « Statuts » avant la limite",
  { skip: !baseLocale && "hors de la base locale du conteneur" },
  async () => {
    const { db, schema } = await import("../src/db/client.js");
    const { and, eq, inArray, like } = await import("drizzle-orm");
    const suffixe = `${Date.now()}`;
    const jour = jourAParis(new Date());
    const [stand] = await db
      .insert(schema.stands)
      .values({
        code: nouveauCode(),
        nom: `TEST-RELECTURE-${suffixe}`,
        ouvert: true,
        actif: true,
        pilotage: "manuel",
        dateDebut: jour,
        dateFin: jour,
      })
      .returning();
    const email = `test-relecture-${suffixe}@example.invalid`;
    const ids: number[] = [];
    let n = 0;
    /** Un panier de la tablette : une affiche à 29 €, sans configuration. */
    const panier = async () => {
      const cartId = `test-relecture-${suffixe}-${n++}`;
      const [o] = await db
        .insert(schema.orders)
        .values({ channel: "salon", number: `DRAFT-${cartId}`, clientOrderId: cartId, status: "draft", totalCents: 0 })
        .returning();
      ids.push(o!.id);
      const [l] = await db
        .insert(schema.orderItems)
        .values({ orderId: o!.id, title: "VIEUX MOULIN", unitPriceCents: 2900, quantity: 1, config: null })
        .returning();
      return { id: o!.id, cartId, ligne: l!.id };
    };
    const app = application();
    const valider = async (cartId: string) => {
      const r = await app.request("/salon/commandes", {
        method: "POST",
        headers: { "content-type": "application/json", "x-salon-code": stand!.code },
        body: JSON.stringify({ cartId, name: "Essai relecture", email }),
      });
      assert.equal(r.status, 200, await r.clone().text());
      return ((await r.json()) as { number: string }).number;
    };
    const rouvrir = (cartId: string, numero: string) =>
      app.request("/salon/commandes/rouvrir", {
        method: "POST",
        headers: { "content-type": "application/json", "x-salon-code": stand!.code },
        body: JSON.stringify({ cartId, numero }),
      });
    const terminer = (liste: number[]) =>
      app.request("/admin/orders/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: liste, action: "terminer-stand" }),
      });
    const remisesReussies = async (id: number) =>
      (
        await db
          .select({ id: schema.fulfillments.id })
          .from(schema.fulfillments)
          .where(and(eq(schema.fulfillments.orderId, id), eq(schema.fulfillments.status, "success")))
      ).length;
    const liste = async (filtres: string) => {
      const r = await app.request(`/admin/orders?channel=salon&stand=${stand!.id}&${filtres}`);
      assert.equal(r.status, 200);
      return ((await r.json()) as { id: number; number: string; etapeTraitement: string }[]).map((o) => o.id);
    };

    try {
      // 1. La course, sous plusieurs écarts, dans les deux ordres : elle
      //    gagnait 4 fois sur 4 jusqu'à 5 ms d'écart avant le verrou commun.
      let cas = 0;
      for (const ecart of [0, 2, 5, 10]) {
        for (const premier of ["terminer", "rouvrir"] as const) {
          for (let essai = 0; essai < 2; essai++) {
            const p = await panier();
            const numero = await valider(p.cartId);
            const a = premier === "terminer" ? () => terminer([p.id]) : () => rouvrir(p.cartId, numero);
            const b = premier === "terminer" ? () => rouvrir(p.cartId, numero) : () => terminer([p.id]);
            const [ra, rb] = await Promise.all([a(), pause(ecart).then(b)]);
            assert.equal(ra.status, 200);
            assert.equal(rb.status, 200);
            const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, p.id));
            assert.equal(o!.status, "draft", `rouverte (${premier} d'abord, ${ecart} ms)`);
            assert.equal(o!.fulfilledAt, null, `panier sans date de fin (${premier} d'abord, ${ecart} ms)`);
            assert.equal(await remisesReussies(p.id), 0, `panier sans remise réussie (${premier} d'abord, ${ecart} ms)`);
            // Revalidée : payée, « À imprimer », sans remise.
            assert.equal(await valider(p.cartId), numero);
            assert.equal(await remisesReussies(p.id), 0, `vente revalidée sans remise (${premier} d'abord, ${ecart} ms)`);
            cas++;
          }
        }
      }
      assert.equal(cas, 16);

      // 2. Une remise réussie restée sur un panier (d'avant le verrou
      //    commun) : la validation l'annule, la vente naît « À imprimer ».
      const reste = await panier();
      const [f] = await db.insert(schema.fulfillments).values({ orderId: reste.id, status: "success" }).returning();
      await db.insert(schema.fulfillmentItems).values({ fulfillmentId: f!.id, orderItemId: reste.ligne, quantity: 1 });
      await valider(reste.cartId);
      assert.equal(await remisesReussies(reste.id), 0, "la remise restée est annulée à la validation");
      const [annulee] = await db.select().from(schema.fulfillments).where(eq(schema.fulfillments.id, f!.id));
      assert.equal(annulee!.status, "cancelled");
      assert.ok(annulee!.cancelledAt);

      // 3. Le filtre « Statuts » avant la limite : deux ventes « À
      //    imprimer », puis trois plus récentes marquées terminées.
      await db.delete(schema.orders).where(inArray(schema.orders.id, ids.splice(0)));
      const anciennes: number[] = [];
      for (let i = 0; i < 2; i++) {
        const p = await panier();
        await valider(p.cartId);
        anciennes.unshift(p.id);
        await pause(5);
      }
      const recentes: number[] = [];
      for (let i = 0; i < 3; i++) {
        const p = await panier();
        await valider(p.cartId);
        recentes.unshift(p.id);
        await pause(5);
      }
      assert.equal(((await (await terminer(recentes)).json()) as { count: number }).count, 3);
      assert.deepEqual(await liste("limit=2"), recentes.slice(0, 2), "sans filtre : les deux dernières");
      assert.deepEqual(
        await liste("etape=a_imprimer&limit=2"),
        anciennes,
        "« À imprimer » : les deux ventes plus anciennes que les deux dernières",
      );
      assert.deepEqual(await liste("etape=terminee&limit=2"), recentes.slice(0, 2));
      assert.deepEqual(await liste("etape=a_imprimer"), anciennes);
      assert.deepEqual(await liste("etape=terminee"), recentes);
    } finally {
      await db.delete(schema.orders).where(inArray(schema.orders.id, ids));
      await db.delete(schema.pickupPoints).where(eq(schema.pickupPoints.standId, stand!.id));
      await db.delete(schema.stands).where(eq(schema.stands.id, stand!.id));
      await db.delete(schema.customers).where(and(like(schema.customers.email, "test-relecture-%"), eq(schema.customers.email, email)));
    }
  },
);

/** Ce qui annule la transaction une fois les vérifications faites. */
class Annuler extends Error {}

test(
  "0114 rejouée au démarrage : la vente validée par l'ancienne API pendant la mise en ligne repasse « À imprimer », rien d'autre",
  { skip: !baseLocale && "hors de la base locale du conteneur" },
  async () => {
    const { sql } = await import("../src/db/client.js");
    const s = `${Date.now()}`.slice(-6);
    try {
      await sql.begin(async (tx) => {
        /** Une vente fictive, validée par l'ancienne ou la nouvelle règle. */
        const vente = async (numero: string, message: string, termine: boolean) => {
          const [o] = await tx`
            insert into "order" (channel, number, status, total_cents, tags, fulfilled_at)
            values ('salon'::order_channel, ${numero}, 'paid', 2900, '[]'::jsonb, ${termine ? new Date().toISOString() : null})
            returning id`;
          const [l] = await tx`
            insert into order_item (order_id, title, unit_price_cents, quantity)
            values (${o!.id}, 'VIEUX MOULIN', 2900, 1) returning id`;
          if (termine) {
            const [f] = await tx`insert into fulfillment (order_id, status) values (${o!.id}, 'success') returning id`;
            await tx`insert into fulfillment_item (fulfillment_id, order_item_id, quantity) values (${f!.id}, ${l!.id}, 1)`;
          }
          await tx`insert into order_event (order_id, kind, message) values (${o!.id}, 'event', ${message})`;
          return o!.id as number;
        };
        // Les numéros SAL- fictifs sont dans la série : la transaction
        // annulée les rend, et aucun n'est vu d'ailleurs entre-temps.
        const ancienne = await vente(
          `SAL-8${s}1`,
          "Commande prise au stand (Essai), réglée sur place et remise : terminée.",
          true,
        );
        const nouvelleMarquee = await vente(
          `SAL-8${s}2`,
          "Commande prise au stand (Essai), réglée sur place : à imprimer, puis à marquer terminée au back-office.",
          true,
        );
        const executer = (requete: string) => tx.unsafe(requete) as unknown as Promise<{ count: number }>;
        const premier = await rattraperLesVentesDeLAncienneRegle(executer);
        const etat = async (id: number) => {
          const [o] = await tx`select fulfilled_at from "order" where id = ${id}`;
          const [r] = await tx`select count(*) filter (where status = 'success')::int as ok from fulfillment where order_id = ${id}`;
          const [j] = await tx`select count(*)::int as n from order_event where order_id = ${id} and message like 'Vente remise « À imprimer » le 26/11,%'`;
          return { termine: o!.fulfilled_at !== null, remises: r!.ok as number, ligne: j!.n as number };
        };
        assert.deepEqual(await etat(ancienne), { termine: false, remises: 0, ligne: 1 }, "rattrapée");
        assert.deepEqual(await etat(nouvelleMarquee), { termine: true, remises: 1, ligne: 0 }, "marquée par Margaux : intacte");
        assert.ok(premier >= 1, "au moins la vente de l'ancienne API");
        // Rejouée (le démarrage suivant) : plus rien à faire.
        assert.equal(await rattraperLesVentesDeLAncienneRegle(executer), 0);
        throw new Annuler();
      });
    } catch (e) {
      if (!(e instanceof Annuler)) throw e;
    }
  },
);
