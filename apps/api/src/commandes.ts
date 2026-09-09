/**
 * Routes d'administration des commandes : expéditions, remboursements,
 * étiquettes, actions de masse et export.
 *
 * Le principe qui gouverne tout ce fichier : **rien ne s'écrase**. Une
 * expédition annulée reste dans la table avec sa date d'annulation, un
 * remboursement s'ajoute au grand livre au lieu de corriger le total de la
 * commande, et les statuts affichés sont TOUJOURS recalculés à partir de ces
 * lignes. Il n'y a donc aucun moyen que la fiche raconte autre chose que ce
 * qui s'est réellement passé.
 */
import type { Context, Hono } from "hono";
import type { SQL } from "drizzle-orm";
import { and, desc, eq, gte, inArray, lte, or, sql as raw } from "drizzle-orm";
import { db, schema } from "./db/client.js";
import { refundStripe } from "./payments.js";
import {
  courrierExpediee,
  courrierPreteAuStand,
  envoyer as envoyerCourrier,
  estConfigure as mailConfigure,
} from "./mail.js";

/* -------------------------------------------------------------------------- */
/*  Statuts calculés                                                          */
/* -------------------------------------------------------------------------- */

export type StatutFinancier =
  | "draft"
  | "pending"
  | "authorized"
  | "paid"
  | "partially_refunded"
  | "refunded"
  | "voided";

/**
 * Statut financier d'une commande — déduit, jamais stocké.
 *
 * Un champ figé finirait par mentir : il suffirait d'un remboursement
 * enregistré sans que personne pense à le mettre à jour. Ici la réponse vient
 * du montant encaissé et de la somme des remboursements, donc elle est juste
 * par construction.
 */
export function statutFinancier(
  o: { status: string; totalCents: number },
  rembourseCents: number,
): StatutFinancier {
  if (o.status === "cancelled" || o.status === "voided") return "voided";
  if (o.status === "draft") return "draft";
  if (o.status !== "paid")
    return o.status === "authorized" ? "authorized" : "pending";
  if (rembourseCents <= 0) return "paid";
  if (rembourseCents >= o.totalCents) return "refunded";
  return "partially_refunded";
}

export type StatutExpedition =
  | "unfulfilled"
  | "partially_fulfilled"
  | "fulfilled";

/** Où en est la préparation : rien parti, une partie, ou tout. */
export function statutExpedition(
  commandes: number,
  expedies: number,
): StatutExpedition {
  if (expedies <= 0) return "unfulfilled";
  if (expedies < commandes) return "partially_fulfilled";
  return "fulfilled";
}

export const LIBELLE_FINANCIER: Record<StatutFinancier, string> = {
  draft: "Panier",
  pending: "En attente",
  authorized: "Autorisée",
  paid: "Payée",
  partially_refunded: "Remboursée en partie",
  refunded: "Remboursée",
  voided: "Annulée",
};

export const LIBELLE_EXPEDITION: Record<StatutExpedition, string> = {
  unfulfilled: "Non traitée",
  partially_fulfilled: "Partiellement traitée",
  fulfilled: "Traitée",
};

/** Lien de suivi public, quand on sait le fabriquer. */
export function lienDeSuivi(
  carrier: string | null | undefined,
  numero: string | null | undefined,
): string | null {
  if (!numero) return null;
  const c = (carrier ?? "").toLowerCase();
  const n = encodeURIComponent(numero.trim());
  if (c.includes("mondial"))
    return `https://www.mondialrelay.fr/suivi-de-colis?numeroExpedition=${n}`;
  if (c.includes("colissimo") || c.includes("poste"))
    return `https://www.laposte.fr/outils/suivre-vos-envois?code=${n}`;
  if (c.includes("chronopost"))
    return `https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=${n}`;
  if (c.includes("dhl"))
    return `https://www.dhl.com/fr-fr/home/tracking.html?tracking-id=${n}`;
  if (c.includes("ups")) return `https://www.ups.com/track?tracknum=${n}`;
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Agrégats                                                                  */
/* -------------------------------------------------------------------------- */

export interface ResumeCommande {
  articles: number;
  expedies: number;
  rembourseCents: number;
}

/**
 * Pour un lot de commandes : quantités commandées, quantités parties et
 * montant déjà remboursé. Trois requêtes pour toute la page — une par
 * commande transformerait la liste en salle d'attente.
 */
export async function resumeCommandes(
  ids: number[],
): Promise<Map<number, ResumeCommande>> {
  const out = new Map<number, ResumeCommande>();
  if (!ids.length) return out;
  for (const id of ids)
    out.set(id, { articles: 0, expedies: 0, rembourseCents: 0 });

  const lignes = await db
    .select({
      orderId: schema.orderItems.orderId,
      id: schema.orderItems.id,
      quantity: schema.orderItems.quantity,
    })
    .from(schema.orderItems)
    .where(inArray(schema.orderItems.orderId, ids));
  const commandeDeLigne = new Map<number, number>();
  for (const l of lignes) {
    out.get(l.orderId)!.articles += l.quantity;
    commandeDeLigne.set(l.id, l.orderId);
  }

  // Seules les expéditions non annulées comptent comme parties.
  const partis = await db
    .select({
      orderItemId: schema.fulfillmentItems.orderItemId,
      quantity: schema.fulfillmentItems.quantity,
      status: schema.fulfillments.status,
    })
    .from(schema.fulfillmentItems)
    .innerJoin(
      schema.fulfillments,
      eq(schema.fulfillmentItems.fulfillmentId, schema.fulfillments.id),
    )
    .where(inArray(schema.fulfillments.orderId, ids));
  for (const p of partis) {
    if (p.status !== "success") continue;
    const oid = commandeDeLigne.get(p.orderItemId);
    if (oid != null) out.get(oid)!.expedies += p.quantity;
  }

  const rembourses = await db
    .select({
      orderId: schema.refunds.orderId,
      amountCents: schema.refunds.amountCents,
    })
    .from(schema.refunds)
    .where(inArray(schema.refunds.orderId, ids));
  for (const r of rembourses)
    out.get(r.orderId)!.rembourseCents += r.amountCents;

  return out;
}

/* -------------------------------------------------------------------------- */
/*  Petits outils                                                             */
/* -------------------------------------------------------------------------- */

/** Normalise une étiquette : casse et espaces ne doivent pas faire doublon. */
function etiquette(v: unknown): string {
  return String(v ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 40);
}

/** Fusionne deux listes d'étiquettes sans doublon, en gardant l'ordre. */
function fusionner(a: string[], b: string[]): string[] {
  const vus = new Set(a.map((t) => t.toLowerCase()));
  const out = [...a];
  for (const t of b)
    if (t && !vus.has(t.toLowerCase())) {
      vus.add(t.toLowerCase());
      out.push(t);
    }
  return out;
}

/** Échappe une cellule CSV (Excel français : point-virgule, guillemets doublés). */
function cellule(v: unknown): string {
  const s = String(v ?? "");
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Quantités déjà expédiées, par ligne de commande. */
async function quantitesExpediees(
  orderId: number,
): Promise<Map<number, number>> {
  const rows = await db
    .select({
      orderItemId: schema.fulfillmentItems.orderItemId,
      quantity: schema.fulfillmentItems.quantity,
      status: schema.fulfillments.status,
    })
    .from(schema.fulfillmentItems)
    .innerJoin(
      schema.fulfillments,
      eq(schema.fulfillmentItems.fulfillmentId, schema.fulfillments.id),
    )
    .where(eq(schema.fulfillments.orderId, orderId));
  const m = new Map<number, number>();
  for (const r of rows)
    if (r.status === "success")
      m.set(r.orderItemId, (m.get(r.orderItemId) ?? 0) + r.quantity);
  return m;
}

/** Quantités déjà remboursées, par ligne de commande. */
async function quantitesRemboursees(
  orderId: number,
): Promise<Map<number, number>> {
  const rows = await db
    .select({
      orderItemId: schema.refundItems.orderItemId,
      quantity: schema.refundItems.quantity,
    })
    .from(schema.refundItems)
    .innerJoin(schema.refunds, eq(schema.refundItems.refundId, schema.refunds.id))
    .where(eq(schema.refunds.orderId, orderId));
  const m = new Map<number, number>();
  for (const r of rows)
    m.set(r.orderItemId, (m.get(r.orderItemId) ?? 0) + r.quantity);
  return m;
}

/** Expédie d'un coup tout ce qui reste sur un lot de commandes. */
async function expedierTout(ids: number[]): Promise<void> {
  for (const id of ids) {
    const lignes = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, id));
    const partis = await quantitesExpediees(id);
    const reste = lignes
      .map((l) => ({
        orderItemId: l.id,
        quantity: l.quantity - (partis.get(l.id) ?? 0),
      }))
      .filter((l) => l.quantity > 0);
    if (!reste.length) continue;
    const [ful] = await db
      .insert(schema.fulfillments)
      .values({ orderId: id, status: "success" })
      .returning();
    await db
      .insert(schema.fulfillmentItems)
      .values(reste.map((l) => ({ ...l, fulfillmentId: ful!.id })));
  }
}

/** Annule toutes les expéditions en cours d'un lot de commandes. */
async function annulerExpeditions(ids: number[]): Promise<void> {
  await db
    .update(schema.fulfillments)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(
      and(
        inArray(schema.fulfillments.orderId, ids),
        eq(schema.fulfillments.status, "success"),
      ),
    );
}

/* -------------------------------------------------------------------------- */
/*  Routes                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Le vendeur ne voit que les ventes du stand.
 *
 * Rend les conditions à AJOUTER aux siennes, quoi qu'il demande. Le
 * propriétaire, lui, ne reçoit rien de plus : il voit tout.
 *
 * Le filtre vit dans la requête et non dans l'écran : un écran qui masque un
 * bouton est une politesse, pas une garde. Une adresse tapée à la main doit
 * buter sur la même règle.
 */
function limiterAuStand(c: Context): SQL[] {
  const user = c.get("utilisateur");
  if (!user || user.role === "owner") return [];
  const bornes: SQL[] = [eq(schema.orders.channel, "salon")];
  // Le stand du vendeur, quand il lui en a été attribué un. Sans attribution,
  // il voit les ventes de stand mais aucune du site : c'est déjà la moitié de
  // la règle, et le refus par défaut vaut mieux qu'un accès complet.
  const stand = user.standId;
  if (typeof stand === "number" && stand > 0)
    bornes.push(eq(schema.orders.standId, stand));
  return bornes;
}

export function mountOrderRoutes(app: Hono): void {
  /**
   * Liste des commandes, filtrable.
   *
   * Tous les filtres se combinent : c'est ce qui permet de répondre à « les
   * commandes payées, pas encore parties, de la semaine dernière » sans
   * sortir un tableur.
   */
  app.get("/admin/orders", async (c) => {
    const q = c.req.query();
    const limit = Math.min(Number(q.limit ?? 100), 500);
    const conditions = [];
    if (q.channel === "web" || q.channel === "salon")
      conditions.push(eq(schema.orders.channel, q.channel));
    // Un stand précis : c'est la question qu'on se pose au retour d'un salon,
    // « combien celui-là a-t-il fait ».
    const stand = Number(q.stand);
    if (Number.isInteger(stand) && stand > 0)
      conditions.push(eq(schema.orders.standId, stand));
    conditions.push(...limiterAuStand(c));
    if (q.from) conditions.push(gte(schema.orders.createdAt, new Date(q.from)));
    if (q.to) {
      // Une date de fin s'entend « jusqu'au soir » : sinon un filtre « du 1er
      // au 3 » perdrait toutes les commandes du 3.
      const fin = new Date(q.to);
      fin.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.orders.createdAt, fin));
    }
    const cherche = (q.q ?? "").trim();
    if (cherche) {
      const motif = `%${cherche.toLowerCase()}%`;
      conditions.push(
        or(
          raw`lower(${schema.orders.number}) like ${motif}`,
          raw`lower(coalesce(${schema.orders.legacyName}, '')) like ${motif}`,
          raw`lower(coalesce(${schema.customers.name}, '')) like ${motif}`,
          raw`lower(coalesce(${schema.customers.email}, '')) like ${motif}`,
          raw`lower(coalesce(${schema.orders.shippingCity}, '')) like ${motif}`,
        )!,
      );
    }

    const rows = await db
      .select({
        id: schema.orders.id,
        number: schema.orders.number,
        channel: schema.orders.channel,
        status: schema.orders.status,
        totalCents: schema.orders.totalCents,
        legacyName: schema.orders.legacyName,
        createdAt: schema.orders.createdAt,
        fulfilledAt: schema.orders.fulfilledAt,
        shippingLabel: schema.orders.shippingLabel,
        shippingMethod: schema.orders.shippingMethod,
        tags: schema.orders.tags,
        customerId: schema.orders.customerId,
        customerName: schema.customers.name,
        customerEmail: schema.customers.email,
      })
      .from(schema.orders)
      .leftJoin(
        schema.customers,
        eq(schema.orders.customerId, schema.customers.id),
      )
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.orders.createdAt))
      .limit(limit);

    const resume = await resumeCommandes(rows.map((r) => r.id));
    let enrichies = rows.map((r) => {
      const s = resume.get(r.id)!;
      return {
        ...r,
        articles: s.articles,
        expedies: s.expedies,
        rembourseCents: s.rembourseCents,
        statutFinancier: statutFinancier(r, s.rembourseCents),
        statutExpedition: statutExpedition(s.articles, s.expedies),
      };
    });

    // Statuts et étiquettes se filtrent après coup : ils se déduisent de
    // plusieurs tables, les calculer en SQL rendrait la requête illisible
    // pour un gain nul à cette échelle.
    const fin = (q.financial ?? "").split(",").filter(Boolean);
    if (fin.length)
      enrichies = enrichies.filter((o) => fin.includes(o.statutFinancier));
    const exp = (q.fulfillment ?? "").split(",").filter(Boolean);
    if (exp.length)
      enrichies = enrichies.filter((o) => exp.includes(o.statutExpedition));
    const tag = (q.tag ?? "").trim().toLowerCase();
    if (tag)
      enrichies = enrichies.filter((o) =>
        (o.tags ?? []).some((t) => t.toLowerCase() === tag),
      );

    return c.json(enrichies);
  });

  /** Toutes les étiquettes déjà employées, pour l'autocomplétion. */
  app.get("/admin/orders/tags", async (c) => {
    const rows = await db.select({ tags: schema.orders.tags }).from(schema.orders);
    const compte = new Map<string, number>();
    for (const r of rows)
      for (const t of r.tags ?? []) compte.set(t, (compte.get(t) ?? 0) + 1);
    return c.json(
      [...compte.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([name, n]) => ({ name, n })),
    );
  });

  /**
   * Export CSV des commandes filtrées.
   *
   * Séparateur point-virgule et BOM UTF-8 : c'est ce qu'attend Excel en
   * français. Sans eux, les accents arrivent en charabia et tout se retrouve
   * dans une seule colonne.
   */
  app.get("/admin/orders/export.csv", async (c) => {
    const q = c.req.query();
    const conditions = [];
    if (q.channel === "web" || q.channel === "salon")
      conditions.push(eq(schema.orders.channel, q.channel));
    // Un stand précis : c'est la question qu'on se pose au retour d'un salon,
    // « combien celui-là a-t-il fait ».
    const stand = Number(q.stand);
    if (Number.isInteger(stand) && stand > 0)
      conditions.push(eq(schema.orders.standId, stand));
    conditions.push(...limiterAuStand(c));
    if (q.from) conditions.push(gte(schema.orders.createdAt, new Date(q.from)));
    if (q.to) {
      const fin = new Date(q.to);
      fin.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.orders.createdAt, fin));
    }
    const ids = (q.ids ?? "")
      .split(",")
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length) conditions.push(inArray(schema.orders.id, ids));

    const rows = await db
      .select({
        id: schema.orders.id,
        number: schema.orders.number,
        createdAt: schema.orders.createdAt,
        status: schema.orders.status,
        totalCents: schema.orders.totalCents,
        shippingCents: schema.orders.shippingCents,
        promoCode: schema.orders.promoCode,
        shippingLabel: schema.orders.shippingLabel,
        shippingName: schema.orders.shippingName,
        shippingLine1: schema.orders.shippingLine1,
        shippingLine2: schema.orders.shippingLine2,
        shippingPostalCode: schema.orders.shippingPostalCode,
        shippingCity: schema.orders.shippingCity,
        shippingCountry: schema.orders.shippingCountry,
        relayPointLabel: schema.orders.relayPointLabel,
        tags: schema.orders.tags,
        channel: schema.orders.channel,
        customerName: schema.customers.name,
        customerEmail: schema.customers.email,
      })
      .from(schema.orders)
      .leftJoin(
        schema.customers,
        eq(schema.orders.customerId, schema.customers.id),
      )
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.orders.createdAt))
      .limit(5000);

    const resume = await resumeCommandes(rows.map((r) => r.id));
    const euros = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
    const entetes = [
      "Commande",
      "Date",
      "Client",
      "E-mail",
      "Canal",
      "Statut paiement",
      "Statut traitement",
      "Articles",
      "Sous-total",
      "Livraison",
      "Code promo",
      "Remboursé",
      "Total",
      "Mode de livraison",
      "Nom livraison",
      "Adresse",
      "Complément",
      "Code postal",
      "Ville",
      "Pays",
      "Point relais",
      "Étiquettes",
    ];
    const lignes = rows.map((r) => {
      const s = resume.get(r.id)!;
      return [
        r.number,
        r.createdAt ? new Date(r.createdAt).toLocaleString("fr-FR") : "",
        r.customerName ?? "",
        r.customerEmail ?? "",
        r.channel,
        LIBELLE_FINANCIER[statutFinancier(r, s.rembourseCents)],
        LIBELLE_EXPEDITION[statutExpedition(s.articles, s.expedies)],
        s.articles,
        euros(r.totalCents - r.shippingCents),
        euros(r.shippingCents),
        r.promoCode ?? "",
        s.rembourseCents ? euros(s.rembourseCents) : "",
        euros(r.totalCents),
        r.shippingLabel ?? "",
        r.shippingName ?? "",
        r.shippingLine1 ?? "",
        r.shippingLine2 ?? "",
        r.shippingPostalCode ?? "",
        r.shippingCity ?? "",
        r.shippingCountry ?? "",
        r.relayPointLabel ?? "",
        (r.tags ?? []).join(", "),
      ]
        .map(cellule)
        .join(";");
    });
    const csv = "﻿" + [entetes.join(";"), ...lignes].join("\r\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="commandes.csv"',
      },
    });
  });

  /** Étiquettes d'une commande (la liste envoyée remplace l'ancienne). */
  app.post("/admin/orders/:id/tags", async (c) => {
    const id = Number(c.req.param("id"));
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const tags = Array.isArray(b.tags)
      ? [
          ...new Set((b.tags as unknown[]).map(etiquette).filter(Boolean)),
        ].slice(0, 30)
      : [];
    const [row] = await db
      .update(schema.orders)
      .set({ tags })
      .where(eq(schema.orders.id, id))
      .returning({ id: schema.orders.id, tags: schema.orders.tags });
    if (!row) return c.notFound();
    return c.json(row);
  });

  /**
   * Actions de masse sur les commandes cochées.
   *
   * Le rendu du matin, c'est trente commandes à passer en « traitée » : les
   * faire une par une est le genre de corvée qui fait détester un outil.
   */
  app.post("/admin/orders/bulk", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const ids = (Array.isArray(b.ids) ? (b.ids as unknown[]) : [])
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n));
    const action = String(b.action ?? "");
    if (!ids.length) return c.json({ error: "aucune commande" }, 400);

    if (action === "fulfil" || action === "unfulfil") {
      const traite = action === "fulfil";
      if (traite) await expedierTout(ids);
      else await annulerExpeditions(ids);
      await db
        .update(schema.orders)
        .set({ fulfilledAt: traite ? new Date() : null })
        .where(inArray(schema.orders.id, ids));
      await db.insert(schema.orderEvents).values(
        ids.map((orderId) => ({
          orderId,
          kind: "event",
          message: traite
            ? "Commande marquée comme traitée (action groupée)."
            : "Commande remise à traiter (action groupée).",
        })),
      );
      return c.json({ ok: true, count: ids.length });
    }

    if (action === "tag" || action === "untag") {
      const tags = (Array.isArray(b.tags) ? (b.tags as unknown[]) : [])
        .map(etiquette)
        .filter(Boolean);
      if (!tags.length) return c.json({ error: "aucune étiquette" }, 400);
      const rows = await db
        .select({ id: schema.orders.id, tags: schema.orders.tags })
        .from(schema.orders)
        .where(inArray(schema.orders.id, ids));
      const bas = tags.map((t) => t.toLowerCase());
      for (const r of rows) {
        const actuel = r.tags ?? [];
        const suivant =
          action === "tag"
            ? fusionner(actuel, tags)
            : actuel.filter((t) => !bas.includes(t.toLowerCase()));
        await db
          .update(schema.orders)
          .set({ tags: suivant })
          .where(eq(schema.orders.id, r.id));
      }
      return c.json({ ok: true, count: rows.length });
    }

    if (action === "supprimer") {
      const detruites = await supprimerCommandes(ids);
      return c.json({ ok: true, count: detruites.length, numeros: detruites });
    }

    return c.json({ error: "action inconnue" }, 400);
  });

  /**
   * Efface une commande et tout ce qui pend après elle.
   *
   * Rien n'est refusé, pas même une commande payée : c'est la boutiquière qui
   * sait ce qu'elle veut garder, et l'écran la prévient nommément avant
   * d'agir. Une vente supprimée disparaît en revanche des chiffres, ce qui la
   * distingue d'une commande annulée — celle-ci reste et se lit encore.
   */
  app.delete("/admin/orders/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: "commande inconnue" }, 400);
    const detruites = await supprimerCommandes([id]);
    if (!detruites.length)
      return c.json(
        { error: "Cette commande n'existe plus. Rechargez la liste." },
        404,
      );
    return c.json({ ok: true, numero: detruites[0] });
  });

  /**
   * Efface les commandes demandées et rend les numéros réellement effacés.
   *
   * Les lignes, expéditions, remboursements, mouvements d'argent et journaux
   * partent en cascade : les clés étrangères le déclarent, inutile de les
   * énumérer ici et de risquer d'en oublier une à la prochaine table ajoutée.
   *
   * Les affiches générées par IA survivent, leur lien vers la ligne se vidant
   * de lui-même : ce sont des images déjà fabriquées et payées, et leur propre
   * purge s'en occupe. Les fichiers d'impression écrits sur le disque restent
   * eux aussi, faute de savoir ici lesquels ne servent plus à personne.
   */
  async function supprimerCommandes(ids: number[]): Promise<string[]> {
    if (!ids.length) return [];
    const partis = await db
      .delete(schema.orders)
      .where(inArray(schema.orders.id, ids))
      .returning({ numero: schema.orders.number });
    return partis.map((p) => p.numero);
  }

  /** Crée une expédition : ce qui part, par qui, avec quel numéro de suivi. */
  app.post("/admin/orders/:id/fulfillments", async (c) => {
    const id = Number(c.req.param("id"));
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, id));
    if (!order) return c.notFound();

    const lignes = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, id));
    const resume = await resumeCommandes([id]);
    const dejaParti = await quantitesExpediees(id);

    const demande = new Map<number, number>();
    const detailDemande = Array.isArray(b.items)
      ? (b.items as { orderItemId: number; quantity: number }[])
      : [];
    if (detailDemande.length) {
      for (const it of detailDemande) {
        const q = Math.max(0, Math.floor(Number(it.quantity) || 0));
        if (q > 0) demande.set(Number(it.orderItemId), q);
      }
    } else {
      // Sans détail, on expédie tout ce qui reste : c'est le cas courant.
      for (const l of lignes) {
        const reste = l.quantity - (dejaParti.get(l.id) ?? 0);
        if (reste > 0) demande.set(l.id, reste);
      }
    }

    const aInserer: { orderItemId: number; quantity: number }[] = [];
    for (const l of lignes) {
      const q = demande.get(l.id) ?? 0;
      if (q <= 0) continue;
      const reste = l.quantity - (dejaParti.get(l.id) ?? 0);
      if (q > reste)
        return c.json(
          {
            error: `Il ne reste que ${reste} exemplaire(s) à expédier sur « ${l.title ?? "cet article"} ».`,
          },
          400,
        );
      aInserer.push({ orderItemId: l.id, quantity: q });
    }
    if (!aInserer.length)
      return c.json({ error: "Rien à expédier : tout est déjà parti." }, 400);

    const carrier = String(b.carrier ?? "").trim() || null;
    const trackingNumber = String(b.trackingNumber ?? "").trim() || null;
    const [ful] = await db
      .insert(schema.fulfillments)
      .values({
        orderId: id,
        carrier,
        trackingNumber,
        trackingUrl:
          String(b.trackingUrl ?? "").trim() ||
          lienDeSuivi(carrier, trackingNumber),
        status: "success",
      })
      .returning();
    await db
      .insert(schema.fulfillmentItems)
      .values(aInserer.map((l) => ({ ...l, fulfillmentId: ful!.id })));

    // La commande est « traitée » quand il ne reste plus rien à envoyer.
    const envoyes = aInserer.reduce((s, l) => s + l.quantity, 0);
    const total = resume.get(id)!.articles;
    const partis = resume.get(id)!.expedies + envoyes;
    await db
      .update(schema.orders)
      .set({ fulfilledAt: partis >= total ? new Date() : null })
      .where(eq(schema.orders.id, id));

    await db.insert(schema.orderEvents).values({
      orderId: id,
      kind: "event",
      message:
        `Expédition créée (${envoyes} article(s))` +
        (carrier ? ` — ${carrier}` : "") +
        (trackingNumber ? `, suivi ${trackingNumber}` : "") +
        ".",
    });

    await previenirDeLExpedition(id, {
      carrier,
      trackingNumber,
      trackingUrl: ful!.trackingUrl ?? null,
    });
    return c.json(ful);
  });

  /**
   * Dit à la cliente que son affiche part, ou qu'elle est prête.
   *
   * Le texte dépend du canal, et ce n'est pas cosmétique : une commande de
   * stand ne porte AUCUN prix, du premier écran de la tablette jusqu'ici. La
   * vendeuse a annoncé le montant de vive voix, un chiffre écrit là la
   * contredirait après coup.
   *
   * Ne lève jamais. Le colis est parti, c'est le fait qui compte ; un courrier
   * qui ne part pas ne doit pas défaire une expédition enregistrée. L'échec se
   * lit dans la chronologie de la commande.
   */
  async function previenirDeLExpedition(
    orderId: number,
    envoi: {
      carrier: string | null;
      trackingNumber: string | null;
      trackingUrl: string | null;
    },
  ): Promise<void> {
    if (!mailConfigure()) return;
    try {
      const [commande] = await db
        .select({
          number: schema.orders.number,
          channel: schema.orders.channel,
          customerId: schema.orders.customerId,
          note: schema.orders.internalNote,
        })
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId));
      if (!commande?.customerId) return;

      const [client] = await db
        .select({ name: schema.customers.name, email: schema.customers.email })
        .from(schema.customers)
        .where(eq(schema.customers.id, commande.customerId));
      if (!client?.email) return;

      const lignesCommande = await db
        .select({
          title: schema.orderItems.title,
          quantity: schema.orderItems.quantity,
          unitPriceCents: schema.orderItems.unitPriceCents,
          config: schema.orderItems.config,
        })
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, orderId));
      const lignes = lignesCommande.map((l) => {
        const cfg = (l.config ?? {}) as { format?: unknown };
        return {
          titre: l.title ?? "Affiche personnalisée",
          format: typeof cfg.format === "string" ? cfg.format : null,
          cadre: null,
          quantite: l.quantity,
          unitPriceCents: l.unitPriceCents,
        };
      });
      const prenom = (client.name ?? "").split(" ")[0] || "vous";

      const courrier =
        commande.channel === "salon"
          ? courrierPreteAuStand({
              prenomClient: prenom,
              numero: commande.number,
              // Le nom du stand a été gardé dans la note interne au moment de
              // la vente : c'est le seul endroit où il vit sur la commande.
              evenement:
                commande.note?.replace(/^Stand\s*:\s*/, "").trim() || null,
              lignes,
            })
          : courrierExpediee({
              prenomClient: prenom,
              numero: commande.number,
              transporteur: envoi.carrier,
              numeroSuivi: envoi.trackingNumber,
              lienSuivi: envoi.trackingUrl,
              lignes,
            });

      const parti = await envoyerCourrier({ ...courrier, to: client.email });
      await db.insert(schema.orderEvents).values({
        orderId,
        kind: "event",
        message: parti
          ? `Courrier envoyé à ${client.email} : ${courrier.subject}.`
          : `Le courrier « ${courrier.subject} » n'a pas pu partir vers ${client.email}.`,
      });
    } catch {
      // Une panne de courrier ne défait pas une expédition enregistrée.
    }
  }

  /** Annule une expédition (colis jamais parti, erreur de saisie). */
  app.post("/admin/fulfillments/:id/cancel", async (c) => {
    const id = Number(c.req.param("id"));
    const [ful] = await db
      .update(schema.fulfillments)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(eq(schema.fulfillments.id, id))
      .returning();
    if (!ful) return c.notFound();
    const s = (await resumeCommandes([ful.orderId])).get(ful.orderId)!;
    await db
      .update(schema.orders)
      .set({
        fulfilledAt:
          s.articles > 0 && s.expedies >= s.articles ? new Date() : null,
      })
      .where(eq(schema.orders.id, ful.orderId));
    await db.insert(schema.orderEvents).values({
      orderId: ful.orderId,
      kind: "event",
      message: `Expédition annulée${ful.trackingNumber ? ` (suivi ${ful.trackingNumber})` : ""}.`,
    });
    return c.json(ful);
  });

  /**
   * Rembourse tout ou partie d'une commande.
   *
   * Le montant n'est jamais celui qu'on saisit à la main : il est recalculé à
   * partir des quantités rendues et du prix réellement payé. On ne peut donc
   * pas rembourser plus que ce qui a été encaissé, ni deux fois le même
   * article.
   */
  app.post("/admin/orders/:id/refunds", async (c) => {
    const id = Number(c.req.param("id"));
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, id));
    if (!order) return c.notFound();

    const lignes = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, id));
    const dejaRendu = await quantitesRemboursees(id);
    const dejaCents = (await resumeCommandes([id])).get(id)!.rembourseCents;

    const detail: {
      orderItemId: number;
      quantity: number;
      amountCents: number;
    }[] = [];
    for (const it of (Array.isArray(b.items) ? b.items : []) as {
      orderItemId: number;
      quantity: number;
    }[]) {
      const ligne = lignes.find((l) => l.id === Number(it.orderItemId));
      if (!ligne) continue;
      const q = Math.max(0, Math.floor(Number(it.quantity) || 0));
      if (q <= 0) continue;
      const reste = ligne.quantity - (dejaRendu.get(ligne.id) ?? 0);
      if (q > reste)
        return c.json(
          {
            error: `« ${ligne.title ?? "Article"} » : ${reste} exemplaire(s) remboursable(s) au plus.`,
          },
          400,
        );
      detail.push({
        orderItemId: ligne.id,
        quantity: q,
        amountCents: ligne.unitPriceCents * q,
      });
    }

    const portDemande = Math.max(0, Math.floor(Number(b.shippingCents) || 0));
    const portDejaRendu = (
      await db
        .select({ v: schema.refunds.shippingCents })
        .from(schema.refunds)
        .where(eq(schema.refunds.orderId, id))
    ).reduce((s, r) => s + r.v, 0);
    const portRestant = Math.max(0, order.shippingCents - portDejaRendu);
    if (portDemande > portRestant)
      return c.json(
        {
          error: `Frais de port : ${(portRestant / 100).toFixed(2)} € remboursables au plus.`,
        },
        400,
      );

    const montant = detail.reduce((s, d) => s + d.amountCents, 0) + portDemande;
    if (montant <= 0) return c.json({ error: "Rien à rembourser." }, 400);
    if (dejaCents + montant > order.totalCents)
      return c.json(
        { error: "Le total remboursé dépasserait le montant encaissé." },
        400,
      );

    // Renvoi de l'argent chez le prestataire, s'il est demandé et possible.
    let gateway = "manuel";
    let externalRef: string | null = null;
    if (b.viaPsp !== false) {
      const [paiement] = await db
        .select()
        .from(schema.payments)
        .where(
          and(
            eq(schema.payments.orderId, id),
            eq(schema.payments.provider, "stripe"),
          ),
        )
        .orderBy(desc(schema.payments.createdAt));
      if (paiement?.externalRef) {
        try {
          const r = await refundStripe(paiement.externalRef, montant);
          gateway = "stripe";
          externalRef = r.id;
        } catch (e) {
          return c.json(
            { error: `Stripe a refusé le remboursement : ${String(e)}` },
            502,
          );
        }
      }
    }

    const [refund] = await db
      .insert(schema.refunds)
      .values({
        orderId: id,
        amountCents: montant,
        shippingCents: portDemande,
        reason: String(b.reason ?? "").trim() || null,
        note: String(b.note ?? "").trim() || null,
        restock: b.restock === true,
        gateway,
        externalRef,
        author: String(b.author ?? "").trim() || null,
      })
      .returning();
    if (detail.length)
      await db
        .insert(schema.refundItems)
        .values(detail.map((d) => ({ ...d, refundId: refund!.id })));

    await db.insert(schema.orderTransactions).values({
      orderId: id,
      kind: "refund",
      status: "success",
      amountCents: montant,
      gateway,
      externalRef,
      message: String(b.reason ?? "").trim() || null,
    });

    // Remise en stock, pour les articles qui en ont un (magnets, cartes) ;
    // une affiche imprimée à la commande n'a rien à réintégrer.
    if (b.restock === true) {
      for (const d of detail) {
        const ligne = lignes.find((l) => l.id === d.orderItemId);
        if (!ligne?.variantId) continue;
        await db
          .update(schema.variants)
          .set({
            stockQty: raw`coalesce(${schema.variants.stockQty}, 0) + ${d.quantity}`,
          })
          .where(
            and(
              eq(schema.variants.id, ligne.variantId),
              raw`${schema.variants.stockQty} is not null`,
            ),
          );
      }
    }

    await db.insert(schema.orderEvents).values({
      orderId: id,
      kind: "event",
      message:
        `Remboursement de ${(montant / 100).toFixed(2).replace(".", ",")} €` +
        (gateway === "stripe" ? " via Stripe" : " (hors ligne)") +
        (b.restock === true ? ", articles remis en stock" : "") +
        ".",
    });
    return c.json(refund);
  });

  /** Corrige l'adresse de livraison d'une commande déjà passée. */
  app.post("/admin/orders/:id/address", async (c) => {
    const id = Number(c.req.param("id"));
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const txt = (v: unknown) => {
      const s = String(v ?? "").trim();
      return s ? s.slice(0, 200) : null;
    };
    const [row] = await db
      .update(schema.orders)
      .set({
        shippingName: txt(b.shippingName),
        shippingLine1: txt(b.shippingLine1),
        shippingLine2: txt(b.shippingLine2),
        shippingPostalCode: txt(b.shippingPostalCode),
        shippingCity: txt(b.shippingCity),
        shippingCountry: txt(b.shippingCountry),
        shippingPhone: txt(b.shippingPhone),
      })
      .where(eq(schema.orders.id, id))
      .returning({ id: schema.orders.id });
    if (!row) return c.notFound();
    await db.insert(schema.orderEvents).values({
      orderId: id,
      kind: "event",
      message: "Adresse de livraison modifiée au back-office.",
    });
    return c.json({ ok: true });
  });
}
