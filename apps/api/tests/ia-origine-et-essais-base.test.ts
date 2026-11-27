/**
 * BO › Affiches IA et les essais du site (27/11, Alexandra) :
 *  1. « on ne garde pas les affiches étoile », « pas dans affiche IA » : les
 *     ciels étoilés ne sont ni dans la galerie ni dans ses chiffres ;
 *  2. « faut qu'on puisse identifier si la photo vient du stand ou site et si
 *     possible quel stand » : d'où vient une demande (origineDeLaDemande), et
 *     ce que la migration 0118 dit des affiches d'avant ;
 *  3. « bloquer à 3 essais par jour uniquement en mode site pas en mode
 *     stand » : la 4e demande du jour d'un visiteur du site est refusée (429,
 *     `limiteDuJour`), sans rien écrire ni appeler OpenAI.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/ia-origine-et-essais-base.test.ts
 *
 * Touche la BASE LOCALE, et elle seule (`@db:5432`, hors production) : ses
 * lignes portent une marque à part et sont effacées à la fin ; son stand
 * d'essai naît archivé et fermé, et est effacé ensuite ; la migration est
 * essayée dans une transaction annulée. Aucun appel à OpenAI (clé factice,
 * adresse injoignable, et la demande refusée ne va jamais jusqu'à lui), aucun
 * courriel.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";

const baseLocale =
  /@db:5432\//.test(process.env.DATABASE_URL ?? "") && process.env.NODE_ENV !== "production";

// Avant le premier import d'ia.ts, qui lit la clé à son chargement.
if (baseLocale) {
  process.env.OPENAI_API_KEY = "sk-TEST-ORIGINE-factice";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:9/v1";
}

after(async () => {
  if (!baseLocale) return;
  const { sql } = await import("../src/db/client.js");
  await sql.end({ timeout: 5 });
});

const MIGRATION_0118 = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../drizzle/0118_ia_origine_stand_ou_site.sql"),
  "utf8",
);

/** Ce qui annule la transaction une fois les vérifications faites. */
class Annuler extends Error {}

const sauf = !baseLocale && "hors de la base locale du conteneur";

test("les ciels étoilés ne sont ni dans la galerie de BO › Affiches IA, ni dans ses chiffres", { skip: sauf }, async () => {
  const { db, schema } = await import("../src/db/client.js");
  const { like } = await import("drizzle-orm");
  const { mountIaRoutes, MODELE_CIEL } = await import("../src/ia.js");
  const g = schema.aiGenerations;
  const marque = `essai-ciel-bo-${Date.now()}`;
  const app = new Hono();
  mountIaRoutes(app);
  const essaisDuMois = async () => {
    const r = await app.request("/admin/ia/stats");
    assert.equal(r.status, 200);
    return ((await r.json()) as { mois: { essais: number } }).mois.essais;
  };
  try {
    const le = new Date("2020-01-01T10:00:00Z");
    await db.insert(g).values([
      { publicId: `${marque}-affiche`, model: "gpt-image-2", size: "1584x2240", status: "prete", createdAt: le },
      { publicId: `${marque}-ciel`, model: MODELE_CIEL, size: "2480x3508", status: "prete", createdAt: le },
    ]);
    const r = await app.request("/admin/ia/generations?depuis=2019-12-31T00:00:00Z&jusqua=2020-01-02T00:00:00Z&limite=200");
    assert.equal(r.status, 200);
    const ids = ((await r.json()) as { lignes: { publicId: string }[] }).lignes.map((l) => l.publicId);
    assert.ok(ids.includes(`${marque}-affiche`), "l'affiche IA est dans la galerie");
    assert.ok(!ids.includes(`${marque}-ciel`), "le ciel n'y est pas");

    // Un ciel de CE mois ne change pas les essais du mois ; une affiche, si.
    const avant = await essaisDuMois();
    await db.insert(g).values({ publicId: `${marque}-ciel-du-mois`, model: MODELE_CIEL, status: "prete" });
    assert.equal(await essaisDuMois(), avant);
    await db.insert(g).values({ publicId: `${marque}-affiche-du-mois`, model: "gpt-image-2", status: "prete" });
    assert.equal(await essaisDuMois(), avant + 1);
  } finally {
    await db.delete(g).where(like(g.publicId, `${marque}-%`));
  }
});

test("stand ou site : le code de la tablette fait foi ; sans lui, rien qu'un visiteur du site", { skip: sauf }, async () => {
  const { db, schema } = await import("../src/db/client.js");
  const { eq } = await import("drizzle-orm");
  const { origineDeLaDemande } = await import("../src/ia.js");
  const { nouveauCode } = await import("../src/salon.js");
  const code = nouveauCode();
  // Archivé et fermé dès sa naissance : il ne se montre nulle part.
  const [stand] = await db
    .insert(schema.stands)
    .values({ code, nom: "Essai origine IA (à effacer)", ouvert: false, archivedAt: new Date() })
    .returning({ id: schema.stands.id });
  const app = new Hono();
  app.post("/essai-origine", async (c) => {
    const corps = (await c.req.json().catch(() => ({}))) as { stand?: unknown };
    return c.json(await origineDeLaDemande(c, corps.stand));
  });
  const demander = async (entetes: Record<string, string>, corps: Record<string, unknown> = {}) => {
    const r = await app.request("/essai-origine", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...entetes },
      body: JSON.stringify(corps),
    });
    return (await r.json()) as { origine: string; standId: number | null };
  };
  try {
    assert.deepEqual(await demander({}), { origine: "site", standId: null });
    // Le code d'un stand, même fermé : la tablette est reconnue, et son stand.
    assert.deepEqual(await demander({ "X-Stand": "1", "X-Salon-Code": code.toLowerCase() }), {
      origine: "stand",
      standId: stand!.id,
    });
    // Un code faux, sans le mode stand : un visiteur du site.
    assert.deepEqual(await demander({ "X-Salon-Code": "ZZZZZZ" }), { origine: "site", standId: null });
    // Le mode stand sans code ne vaut que pendant l'ouverture d'un stand.
    const [ouvert] = await db
      .select({ id: schema.stands.id })
      .from(schema.stands)
      .where(eq(schema.stands.ouvert, true))
      .limit(1);
    const sansCode = await demander({ "X-Stand": "1" }, { stand: String(stand!.id) });
    assert.deepEqual(
      sansCode,
      ouvert ? { origine: "stand", standId: stand!.id } : { origine: "site", standId: null },
    );
  } finally {
    await db.delete(schema.stands).where(eq(schema.stands.id, stand!.id));
  }
});

test("3 essais par jour sur le site : la 4e demande est refusée, sans rien écrire ; échecs, stand, ciels et veille ne comptent pas", { skip: sauf }, async () => {
  const { db, schema } = await import("../src/db/client.js");
  const { and, eq, like } = await import("drizzle-orm");
  const { ESSAIS_PAR_JOUR_SITE, IA_DIR, MODELE_CIEL, essaisDuJourSurLeSite, mountIaRoutes } = await import(
    "../src/ia.js"
  );
  assert.equal(ESSAIS_PAR_JOUR_SITE, 3);
  const g = schema.aiGenerations;
  const marque = `essai-quota-${Date.now()}`;
  const panier = `${marque}-panier`;
  const autrePanier = `${marque}-autre-panier`;
  // Une adresse de documentation (RFC 5737) : personne ne l'a.
  const ip = "203.0.113.77";
  const photo = `${marque}.jpg`;
  const [affichePhoto] = await db
    .select({ id: schema.products.id })
    .from(schema.products)
    .where(and(eq(schema.products.aiEnabled, true), eq(schema.products.skyEnabled, false)))
    .limit(1);
  assert.ok(affichePhoto, "une affiche « à partir de votre photo » dans la base locale");
  const app = new Hono();
  mountIaRoutes(app);
  try {
    const hier = new Date(Date.now() - 2 * 86_400_000);
    await db.insert(g).values([
      { publicId: `${marque}-1`, cartId: panier, ip, model: "gpt-image-2", status: "prete", origine: "site" },
      { publicId: `${marque}-2`, cartId: panier, ip, model: "gpt-image-2", status: "en_cours", origine: "site" },
      // Ne comptent pas : un échec, une affiche du stand, un ciel, une affiche d'avant-hier.
      { publicId: `${marque}-echec`, cartId: panier, ip, model: "gpt-image-2", status: "echec", origine: "site" },
      { publicId: `${marque}-stand`, cartId: panier, ip, model: "gpt-image-2", status: "prete", origine: "stand" },
      { publicId: `${marque}-ciel`, cartId: panier, ip, model: MODELE_CIEL, status: "prete" },
      { publicId: `${marque}-veille`, cartId: panier, ip, model: "gpt-image-2", status: "prete", origine: "site", createdAt: hier },
    ]);
    assert.equal(await essaisDuJourSurLeSite({ cartId: panier, customerId: null, ip: null }), 2);
    // Un autre panier, depuis la même adresse : une fenêtre privée ne remet pas à zéro.
    await db.insert(g).values({ publicId: `${marque}-3`, cartId: autrePanier, ip, model: "gpt-image-2", status: "prete", origine: "site" });
    assert.equal(await essaisDuJourSurLeSite({ cartId: `${marque}-neuf`, customerId: null, ip }), 3);
    assert.equal(await essaisDuJourSurLeSite({ cartId: panier, customerId: null, ip: null }), 2);
    // Sans adresse transmise (« local »), l'adresse ne désigne personne.
    assert.equal(await essaisDuJourSurLeSite({ cartId: null, customerId: null, ip: "local" }), 0);

    // La 4e demande du jour, depuis le site : refusée avant d'écrire quoi que ce soit.
    await writeFile(resolve(IA_DIR, photo), Buffer.from("photo d'essai"));
    const r = await app.request("/ia/generer", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
      body: JSON.stringify({ productId: affichePhoto!.id, photo, cartId: panier }),
    });
    assert.equal(r.status, 429);
    const corps = (await r.json()) as { limiteDuJour?: boolean; limite?: number; error?: string };
    assert.equal(corps.limiteDuJour, true);
    assert.equal(corps.limite, 3);
    assert.match(String(corps.error), /3 essais du jour/);
    const lignes = await db.select({ id: g.id }).from(g).where(like(g.publicId, `${marque}-%`));
    assert.equal(lignes.length, 7, "aucune ligne de plus");
  } finally {
    await db.delete(g).where(like(g.publicId, `${marque}-%`));
    await rm(resolve(IA_DIR, photo), { force: true });
  }
});

test("0118 : les affiches d'avant prennent l'origine de leur panier ou de leur commande ; sans eux, aucune ; rejouable", { skip: sauf }, async () => {
  const { sql } = await import("../src/db/client.js");
  const s = `${Date.now()}`.slice(-7);
  try {
    await sql.begin(async (tx) => {
      const [stand] = await tx`
        insert into stand (code, nom, ouvert, archived_at)
        values (${`Q${s.slice(-5)}`}, 'Essai 0118 (transaction annulée)', false, now())
        returning id`;
      /** Un panier ou une commande fictive. */
      const commande = async (v: { cle: string; channel: string; status: string; auStand: boolean; standId?: number | null }) => {
        const [o] = await tx`
          insert into "order" (channel, number, status, total_cents, tags, client_order_id, panier_du_stand, stand_id)
          values (${v.channel}::order_channel, ${`ESSAI-${s}-${v.cle}`}, ${v.status}, 2900, '[]'::jsonb,
                  ${`${s}-${v.cle}`}, ${v.auStand}, ${v.standId ?? null})
          returning id`;
        return o!.id as number;
      };
      const affiche = async (cle: string, v: { cartId?: string | null; orderItemId?: number | null }) => {
        await tx`
          insert into ai_generation (public_id, cart_id, order_item_id, model, status)
          values (${`essai-0118-${s}-${cle}`}, ${v.cartId ?? null}, ${v.orderItemId ?? null}, 'gpt-image-2', 'prete')`;
      };
      await commande({ cle: "vente-stand", channel: "salon", status: "paid", auStand: false, standId: stand!.id });
      await commande({ cle: "panier-tablette", channel: "web", status: "draft", auStand: true });
      await commande({ cle: "panier-site", channel: "web", status: "draft", auStand: false });
      const venteParLigne = await commande({ cle: "par-ligne", channel: "salon", status: "paid", auStand: false, standId: stand!.id });
      const [ligne] = await tx`
        insert into order_item (order_id, title, unit_price_cents, quantity)
        values (${venteParLigne}, 'VIEUX MOULIN', 2900, 1) returning id`;
      await affiche("vente-stand", { cartId: `${s}-vente-stand` });
      await affiche("panier-tablette", { cartId: `${s}-panier-tablette` });
      await affiche("panier-site", { cartId: `${s}-panier-site` });
      await affiche("par-ligne", { orderItemId: ligne!.id as number });
      await affiche("sans-panier", { cartId: `${s}-jamais-cree` });

      await tx.unsafe(MIGRATION_0118);
      const lire = async () =>
        Object.fromEntries(
          (
            await tx`
              select public_id, origine, stand_id from ai_generation
              where public_id like ${`essai-0118-${s}-%`}`
          ).map((r) => [String(r.public_id).slice(`essai-0118-${s}-`.length), [r.origine, r.stand_id]]),
        );
      const attendu = {
        "vente-stand": ["stand", stand!.id],
        "panier-tablette": ["stand", null],
        "panier-site": ["site", null],
        "par-ligne": ["stand", stand!.id],
        "sans-panier": [null, null],
      };
      assert.deepEqual(await lire(), attendu);
      // Rejouée, elle ne change rien.
      await tx.unsafe(MIGRATION_0118);
      assert.deepEqual(await lire(), attendu);
      throw new Annuler();
    });
  } catch (e) {
    if (!(e instanceof Annuler)) throw e;
  }
});
