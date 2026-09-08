/**
 * Commandes prises au stand.
 *
 * Sur un salon, la boutique n'est pas un site : c'est une tablette posée sur
 * une table, devant quelqu'un qui a déjà son porte-monnaie à la main. D'où
 * trois différences avec la boutique en ligne, et elles ne sont pas
 * cosmétiques :
 *
 *   - AUCUN PRIX n'est montré. Le tarif du stand n'est pas celui du site (pas
 *     de frais de port, remises de salon, lots), et c'est la vendeuse qui
 *     l'annonce. Un prix affiché à l'écran la contredirait devant le client.
 *   - AUCUN PAIEMENT en ligne. L'argent se règle sur place ; la commande part
 *     en « à préparer » et la vendeuse la marque encaissée au back-office.
 *   - LE NOM ET L'ADRESSE E-MAIL suffisent à valider. On ne demande pas
 *     d'adresse postale : le client repart avec son affiche, ou vient la
 *     chercher. L'adresse e-mail, elle, sert à le prévenir quand c'est prêt —
 *     et c'est la seule occasion de la recueillir.
 *
 * L'accès passe par un code secret réglable au back-office : l'adresse du
 * stand ne doit pas permettre à un visiteur du site de commander gratuitement.
 */
import type { Hono } from "hono";
import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { db, schema } from "./db/client.js";

/** Réglages du stand, modifiables au back-office. */
const DEFAUTS = {
  /** Code à saisir pour ouvrir le stand. Vide = stand fermé. */
  "salon.code": "",
  /** Nom de l'événement en cours, imprimé sur les bons de préparation. */
  "salon.evenement": "",
  /** Le stand accepte-t-il les commandes en ce moment ? */
  "salon.ouvert": "0",
} as const;

async function reglagesSalon(): Promise<Record<string, string>> {
  const rows = await db.select().from(schema.settings);
  const trouves = new Map(rows.map((r) => [r.key, r.value]));
  const out: Record<string, string> = { ...DEFAUTS };
  for (const cle of Object.keys(DEFAUTS)) {
    const v = trouves.get(cle);
    if (v !== undefined && v !== null && v !== "") out[cle] = String(v);
  }
  return out;
}

/**
 * Le code du stand accompagne-t-il la requête ?
 *
 * Comparaison simple : ce code n'est pas un mot de passe, il empêche de tomber
 * par hasard sur le stand depuis le site. Ce qui protège réellement, c'est que
 * la commande n'est pas payée et qu'elle passe sous les yeux de la vendeuse
 * avant d'être imprimée.
 */
function codeFourni(c: Context): string {
  return String(
    c.req.query("code") ?? c.req.header("x-salon-code") ?? "",
  ).trim();
}

/** Numéro SAL-xxxx suivant, compteur séparé de celui de la boutique. */
async function prochainNumeroSalon(): Promise<string> {
  const rows = await db
    .select({ n: schema.orders.number })
    .from(schema.orders)
    .where(eq(schema.orders.channel, "salon"));
  let max = 0;
  for (const r of rows) {
    const m = /^SAL-(\d+)$/.exec(r.n);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return "SAL-" + String(max + 1).padStart(4, "0");
}

export function mountSalonRoutes(app: Hono): void {
  /**
   * Le stand est-il ouvert, et le code est-il le bon ?
   *
   * La tablette interroge cette route au chargement : elle sait alors s'il
   * faut demander le code, afficher le catalogue, ou dire que le stand est
   * fermé. On ne renvoie JAMAIS le code lui-même.
   */
  app.get("/salon/etat", async (c) => {
    const reg = await reglagesSalon();
    const attendu = reg["salon.code"]!;
    const ouvert = reg["salon.ouvert"] === "1" && attendu.length > 0;
    const autorise = ouvert && codeFourni(c) === attendu;
    return c.json({
      ouvert,
      // Le nom de l'événement ne se dit qu'à qui a le code : l'écran du
      // stand le cache justement tant que le code n'est pas bon.
      evenement: autorise ? reg["salon.evenement"] || null : null,
      /** Vrai si la requête porte déjà le bon code. */
      autorise,
    });
  });

  /**
   * Enregistre une commande prise au stand.
   *
   * Le total est calculé et gardé en base — la boutique doit savoir ce qu'elle
   * a vendu, même si l'écran ne l'a jamais montré au client. Ce qui change,
   * c'est uniquement ce qu'on AFFICHE.
   */
  app.post("/salon/commandes", async (c) => {
    const reg = await reglagesSalon();
    const attendu = reg["salon.code"]!;
    if (reg["salon.ouvert"] !== "1" || !attendu)
      return c.json({ error: "Le stand est fermé." }, 403);
    if (codeFourni(c) !== attendu)
      return c.json({ error: "Code du stand incorrect." }, 403);

    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    const cartId = String(body.cartId ?? "");
    const nom = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!nom) return c.json({ error: "Le nom du client est nécessaire." }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return c.json({ error: "L'adresse e-mail ne semble pas valide." }, 400);

    const [panier] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.clientOrderId, cartId));
    if (!panier) return c.json({ error: "Panier introuvable." }, 404);
    if (panier.status !== "draft")
      return c.json({ error: "Cette commande est déjà enregistrée." }, 409);

    const lignes = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, panier.id));
    if (!lignes.length) return c.json({ error: "Aucune affiche choisie." }, 400);

    // Une fiche par personne, pas une par commande : un habitué des salons
    // reviendra, et on veut retrouver son historique.
    const [existant] = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.email, email));
    const client =
      existant ??
      (
        await db
          .insert(schema.customers)
          .values({ name: nom, email })
          .returning()
      )[0]!;
    if (existant && !existant.name)
      await db
        .update(schema.customers)
        .set({ name: nom })
        .where(eq(schema.customers.id, existant.id));

    const total = lignes.reduce(
      (s, l) => s + l.unitPriceCents * l.quantity,
      0,
    );
    const numero = await prochainNumeroSalon();
    const evenement = reg["salon.evenement"];

    const [commande] = await db
      .update(schema.orders)
      .set({
        channel: "salon",
        number: numero,
        status: "pending",
        customerId: client.id,
        totalCents: total,
        shippingCents: 0,
        shippingLabel: "Remise sur le stand",
        shippingName: nom,
        // L'événement va dans la note : c'est ce qu'on cherche des mois plus
        // tard pour savoir quel salon a bien marché.
        internalNote: evenement ? `Salon : ${evenement}` : null,
        tags: evenement ? [evenement] : [],
      })
      .where(eq(schema.orders.id, panier.id))
      .returning();

    await db.insert(schema.orderEvents).values({
      orderId: panier.id,
      kind: "event",
      message:
        `Commande prise au stand${evenement ? ` (${evenement})` : ""}, à encaisser sur place.`,
    });

    return c.json({
      number: commande!.number,
      // Le prix ne remonte PAS à la tablette : rien à l'écran ne doit pouvoir
      // contredire ce que la vendeuse annonce de vive voix.
      client: { nom, email },
      articles: lignes.reduce((s, l) => s + l.quantity, 0),
    });
  });

  /** Réglages du stand pour le back-office (le code y est visible : c'est elle qui le donne). */
  app.get("/admin/salon", async (c) => {
    const reg = await reglagesSalon();
    return c.json({
      code: reg["salon.code"],
      evenement: reg["salon.evenement"],
      ouvert: reg["salon.ouvert"] === "1",
    });
  });
}
