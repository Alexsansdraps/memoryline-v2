/**
 * Une vente du stand naît « À imprimer », et c'est Margaux qui la marque
 * terminée (26/11), de bout en bout.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/ventes-stand-a-imprimer-base.test.ts
 *
 * Alexandra et Margaux, le 26/11 : « il faut que quand la personne créé une
 * affiche, qu'elle ne soit pas directement terminée mais qu'on doive le
 * faire soit dans la commande soit sur la liste avec case à cocher » ; « elle
 * voudrait pouvoir modifier une commande peu importe son statut » ;
 * « commande stand pouvoir modifier directement le total dans la ligne ».
 *
 * Par les vraies routes : la validation de la tablette (POST
 * /salon/commandes) rend une vente payée, encaissée, SANS remise ni date de
 * fin ; la liste de Ventes stand la dit « À imprimer » et propose de corriger
 * son total ; « Mon compte » dit « Remise sur le stand » ; « Marquer
 * terminées » (POST /admin/orders/bulk, « terminer-stand ») écrit la remise
 * sans transporteur, la date de fin et le journal, sans courriel, ignore en
 * les comptant la commande du site et la vente de test cochées avec elle, et
 * ne refait rien au second clic ; le total se corrige sans motif, Terminée ou
 * À imprimer ; « Remettre à imprimer » annule la remise ; « Revenir à ma
 * commande » marche encore, même sur une vente déjà marquée terminée.
 *
 * Touche la BASE LOCALE, et elle seule (`@db:5432`, hors production) : il
 * crée son stand du jour, ses clientes et ses ventes fictives (« TEST-A-
 * IMPRIMER-… »), puis les efface. Les deux ventes validées prennent les
 * numéros SAL- suivants de la base locale, rendus à leur effacement (le
 * compteur prend le plus haut + 1). Aucune ligne n'a de configuration : rien
 * ne part au rendu des fichiers d'impression.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { jourAParis } from "@memoryline/types";
import { mountOrderRoutes } from "../src/commandes.js";
import { COOKIE_CLIENT, creerSessionClient, mountCompteRoutes } from "../src/comptes.js";
import { mountSalonRoutes, nouveauCode } from "../src/salon.js";

const baseLocale =
  /@db:5432\//.test(process.env.DATABASE_URL ?? "") && process.env.NODE_ENV !== "production";

after(async () => {
  if (!baseLocale) return;
  const { sql } = await import("../src/db/client.js");
  await sql.end({ timeout: 5 });
});

/** Les routes des commandes, du stand et de « Mon compte », la session de propriétaire posée. */
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
  mountCompteRoutes(app);
  return app;
}

test(
  "validée « À imprimer », marquée terminée à la main, remise à imprimer ; total corrigé à toute étape",
  { skip: !baseLocale && "hors de la base locale du conteneur" },
  async () => {
    const { db, schema } = await import("../src/db/client.js");
    const { and, asc, eq, inArray, like } = await import("drizzle-orm");
    const suffixe = `${Date.now()}`;
    const jour = jourAParis(new Date());
    const [stand] = await db
      .insert(schema.stands)
      .values({
        code: nouveauCode(),
        nom: `TEST-A-IMPRIMER-${suffixe}`,
        ouvert: true,
        actif: true,
        pilotage: "manuel",
        dateDebut: jour,
        dateFin: jour,
      })
      .returning();
    const email = `test-a-imprimer-${suffixe}@example.invalid`;
    const ids: number[] = [];
    /** Un panier de la tablette : deux affiches à 29 €, sans configuration. */
    const panier = async (n: number) => {
      const cartId = `test-a-imprimer-${suffixe}-${n}`;
      const [o] = await db
        .insert(schema.orders)
        .values({ channel: "salon", number: `DRAFT-${cartId}`, clientOrderId: cartId, status: "draft", totalCents: 0 })
        .returning();
      ids.push(o!.id);
      await db.insert(schema.orderItems).values({
        orderId: o!.id,
        title: "VIEUX MOULIN",
        unitPriceCents: 2900,
        quantity: 2,
        config: null,
      });
      return { id: o!.id, cartId };
    };
    const app = application();
    const valider = (cartId: string) =>
      app.request("/salon/commandes", {
        method: "POST",
        headers: { "content-type": "application/json", "x-salon-code": stand!.code },
        body: JSON.stringify({ cartId, name: "Essai À imprimer", email }),
      });
    const grouper = (action: string, liste: number[]) =>
      app.request("/admin/orders/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: liste, action, auteur: "ignore@example.invalid" }),
      });
    const corriger = (id: number, totalCents: number, motif?: string) =>
      app.request(`/admin/orders/${id}/montant`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ totalCents, motif }),
      });
    const relire = async (id: number) => {
      const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
      const remises = await db
        .select()
        .from(schema.fulfillments)
        .where(eq(schema.fulfillments.orderId, id))
        .orderBy(asc(schema.fulfillments.id));
      const lignesRemises = remises.length
        ? await db
            .select()
            .from(schema.fulfillmentItems)
            .where(inArray(schema.fulfillmentItems.fulfillmentId, remises.map((r) => r.id)))
        : [];
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
      return { o: o!, remises, lignesRemises, livre, journal };
    };
    const ligneDeLaListe = async (id: number) => {
      const r = await app.request(`/admin/orders?channel=salon&stand=${stand!.id}&test=exclure`);
      assert.equal(r.status, 200);
      return ((await r.json()) as { id: number; etapeTraitement: string; status: string; refusMontant?: string | null; totalCents: number }[]).find(
        (o) => o.id === id,
      );
    };
    // Une commande du site et une vente de test, cochées avec la vente du stand.
    const [site] = await db
      .insert(schema.orders)
      .values({ channel: "web", number: `TEST-A-IMPRIMER-WEB-${suffixe}`, status: "paid", totalCents: 3900 })
      .returning();
    const [essai] = await db
      .insert(schema.orders)
      .values({
        channel: "salon",
        number: `TEST-A-IMPRIMER-ESSAI-${suffixe}`,
        status: "cancelled",
        totalCents: 2900,
        standId: stand!.id,
        tags: ["test"],
      })
      .returning();
    ids.push(site!.id, essai!.id);
    try {
      // 1. La validation à la tablette : payée, encaissée, « À imprimer ».
      const p1 = await panier(1);
      let res = await valider(p1.cartId);
      assert.equal(res.status, 200, await res.clone().text());
      const { number: numero } = (await res.json()) as { number: string };
      assert.match(numero, /^SAL-\d{4}$/);
      let lu = await relire(p1.id);
      assert.equal(lu.o.status, "paid");
      assert.equal(lu.o.totalCents, 5800);
      assert.equal(lu.o.fulfilledAt, null, "pas de date de fin à la validation");
      assert.equal(lu.remises.length, 0, "pas de remise à la validation");
      assert.deepEqual(
        lu.livre.map((e) => `${e.kind} ${e.status} ${e.amountCents} ${e.gateway}`),
        ["sale success 5800 stand"],
      );
      assert.equal(
        lu.journal.at(-1)!.message,
        `Commande prise au stand (${stand!.nom}), réglée sur place : à imprimer, puis à marquer terminée au back-office.`,
      );
      // La liste de Ventes stand : « À imprimer », payée (ses PDF s'y
      // proposent dès qu'elle l'est), et son total se corrige dans la ligne.
      let ligne = await ligneDeLaListe(p1.id);
      assert.equal(ligne?.etapeTraitement, "a_imprimer");
      assert.equal(ligne?.status, "paid");
      assert.equal(ligne?.refusMontant, null);

      // 2. « Mon compte » : « Remise sur le stand », pas « Non expédiée ».
      const [cliente] = await db.select().from(schema.customers).where(eq(schema.customers.email, email));
      const jeton = await creerSessionClient(cliente!.id);
      const compte = async () => {
        const liste = (await (
          await app.request("/compte/commandes", { headers: { cookie: `${COOKIE_CLIENT}=${jeton}` } })
        ).json()) as { id: number; statutExpedition: string }[];
        const fiche = (await (
          await app.request(`/compte/commandes/${p1.id}`, { headers: { cookie: `${COOKIE_CLIENT}=${jeton}` } })
        ).json()) as { statutExpedition: string };
        return [liste.find((c) => c.id === p1.id)?.statutExpedition, fiche.statutExpedition];
      };
      assert.deepEqual(await compte(), ["stand", "stand"]);

      // 3. « Marquer terminées » : la vente du stand passe, la commande du
      //    site et la vente de test sont ignorées, comptées, avec leur raison.
      res = await grouper("terminer-stand", [p1.id, site!.id, essai!.id, p1.id]);
      assert.equal(res.status, 200);
      const marque = (await res.json()) as {
        count: number;
        etape: string;
        ignorees: { id: number; numero: string; raison: string }[];
      };
      assert.equal(marque.count, 1);
      assert.equal(marque.etape, "terminee");
      assert.deepEqual(
        marque.ignorees.map((i) => `${i.numero} : ${i.raison}`).sort(),
        [
          `${essai!.number} : vente de test`,
          `${site!.number} : commande du site, pas une vente du stand`,
        ].sort(),
      );
      lu = await relire(p1.id);
      assert.ok(lu.o.fulfilledAt, "la date de fin est posée");
      assert.deepEqual(
        lu.remises.map((r) => `${r.status} ${r.carrier ?? "sans transporteur"} ${r.trackingNumber ?? "-"}`),
        ["success sans transporteur -"],
      );
      assert.deepEqual(lu.lignesRemises.map((l) => l.quantity), [2], "les deux exemplaires sont remis");
      const traitement = lu.journal.at(-1)!;
      assert.equal(traitement.message, "Traitement : À imprimer → Terminée.");
      assert.equal(traitement.author, "essai@example.invalid", "qui : la session");
      assert.ok(traitement.createdAt, "quand");
      assert.equal(lu.journal.filter((e) => /Courrier|courriel/i.test(e.message)).length, 0, "aucun courriel");
      ligne = await ligneDeLaListe(p1.id);
      assert.equal(ligne?.etapeTraitement, "terminee");
      // Les deux autres n'ont pas bougé.
      assert.equal((await relire(site!.id)).remises.length, 0);
      assert.equal((await relire(essai!.id)).remises.length, 0);
      // « Mon compte » ne change pas pour autant.
      assert.deepEqual(await compte(), ["stand", "stand"]);

      // 4. Le second clic ne refait rien : déjà terminée.
      res = await grouper("terminer-stand", [p1.id]);
      const encore = (await res.json()) as { count: number; ignorees: { numero: string; raison: string }[] };
      assert.equal(encore.count, 0);
      assert.deepEqual(encore.ignorees.map((i) => `${i.numero} : ${i.raison}`), [`${numero} : déjà terminée`]);
      assert.equal((await relire(p1.id)).remises.length, 1, "une seule remise");

      // 5. Le total se corrige « Terminée », sans motif : le journal le dit.
      res = await corriger(p1.id, 4900);
      assert.equal(res.status, 200, await res.clone().text());
      lu = await relire(p1.id);
      assert.equal(lu.o.totalCents, 4900);
      assert.equal(
        lu.journal.at(-1)!.message,
        "Montant de la vente corrigé : 58,00 € → 49,00 € (−9,00 €). Aucun motif saisi.",
      );
      assert.deepEqual(
        { kind: lu.livre.at(-1)!.kind, cents: lu.livre.at(-1)!.amountCents, message: lu.livre.at(-1)!.message },
        { kind: "refund", cents: 900, message: null },
      );

      // 6. « Remettre à imprimer » : la remise est annulée, la date de fin vidée.
      res = await grouper("remettre-a-imprimer", [p1.id]);
      assert.equal(((await res.json()) as { count: number }).count, 1);
      lu = await relire(p1.id);
      assert.equal(lu.o.fulfilledAt, null);
      assert.deepEqual(lu.remises.map((r) => r.status), ["cancelled"]);
      assert.equal(lu.journal.at(-1)!.message, "Traitement : Terminée → À imprimer. La remise enregistrée est annulée.");
      assert.equal((await ligneDeLaListe(p1.id))?.etapeTraitement, "a_imprimer");

      // 7. … et « À imprimer », le total se corrige encore, motif compris.
      res = await corriger(p1.id, 5900, "cadre ajouté");
      assert.equal(res.status, 200);
      assert.match((await relire(p1.id)).journal.at(-1)!.message, /49,00 € → 59,00 € \(\+10,00 €\)\. Motif : « cadre ajouté »\./);

      // 8. Facturée (numéro fictif : aucun numéro réel n'est pris) : la liste
      //    montre le total en texte, et dit pourquoi.
      await db.update(schema.orders).set({ invoiceNumber: `TEST-F-${suffixe}` }).where(eq(schema.orders.id, p1.id));
      assert.match((await ligneDeLaListe(p1.id))?.refusMontant ?? "", /une facture émise ne se modifie pas/);

      // 9. « Revenir à ma commande » à la tablette, sur une vente que Margaux
      //    vient de marquer terminée : sa remise tombe, elle redevient un
      //    panier, et la revalidation la rend « À imprimer », même numéro.
      const p2 = await panier(2);
      res = await valider(p2.cartId);
      assert.equal(res.status, 200);
      const { number: numero2 } = (await res.json()) as { number: string };
      res = await grouper("terminer-stand", [p2.id]);
      assert.equal(((await res.json()) as { count: number }).count, 1);
      res = await app.request("/salon/commandes/rouvrir", {
        method: "POST",
        headers: { "content-type": "application/json", "x-salon-code": stand!.code },
        body: JSON.stringify({ cartId: p2.cartId, numero: numero2 }),
      });
      assert.equal(res.status, 200, await res.clone().text());
      lu = await relire(p2.id);
      assert.equal(lu.o.status, "draft");
      assert.equal(lu.o.fulfilledAt, null);
      assert.deepEqual(lu.remises.map((r) => r.status), ["cancelled"]);
      res = await valider(p2.cartId);
      assert.equal(res.status, 200);
      assert.equal(((await res.json()) as { number: string }).number, numero2, "même numéro");
      lu = await relire(p2.id);
      assert.equal(lu.o.status, "paid");
      assert.equal(lu.o.fulfilledAt, null);
      assert.equal((await ligneDeLaListe(p2.id))?.etapeTraitement, "a_imprimer");
      assert.equal(
        lu.journal.filter((e) => e.message.startsWith("Commande prise au stand")).length,
        2,
        "deux validations au journal",
      );
    } finally {
      await db.delete(schema.orders).where(inArray(schema.orders.id, ids));
      await db.delete(schema.pickupPoints).where(eq(schema.pickupPoints.standId, stand!.id));
      await db.delete(schema.stands).where(eq(schema.stands.id, stand!.id));
      await db.delete(schema.customers).where(and(like(schema.customers.email, "test-a-imprimer-%"), eq(schema.customers.email, email)));
    }
  },
);
