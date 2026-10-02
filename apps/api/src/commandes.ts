/**
 * Routes d'administration des commandes : expéditions, remboursements,
 * annulation, encaissement hors ligne, facture, étiquettes, actions de masse
 * et export.
 *
 * Le principe qui gouverne tout ce fichier : **rien ne s'écrase**. Une
 * expédition annulée reste dans la table avec sa date d'annulation, un
 * remboursement s'ajoute au grand livre au lieu de corriger le total de la
 * commande, une commande annulée reste lisible, et les statuts affichés sont
 * TOUJOURS recalculés à partir de ces lignes. Il n'y a donc aucun moyen que la
 * fiche raconte autre chose que ce qui s'est réellement passé.
 */
import type { Context, Hono } from "hono";
import type { SQL } from "drizzle-orm";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql as raw,
} from "drizzle-orm";
import { db, schema } from "./db/client.js";
import {
  capturePaypalDeLaCommande,
  paypalConfigured,
  refundPaypal,
  refundStripe,
} from "./payments.js";
import { lignesRemplies, type TextesAffiche } from "@memoryline/types";
import {
  courrierAnnulee,
  courrierExpediee,
  courrierFacture,
  courrierPreteAuStand,
  courrierRemboursee,
  envoyer as envoyerCourrier,
  estConfigure as mailConfigure,
  type LigneCourrier,
} from "./mail.js";
// L'encaissement d'un virement passe par la MÊME fonction que celui d'un
// paiement Stripe. L'import est croisé — configurator-routes.ts lit déjà
// `resumeCommandes` ici — mais chacun ne s'en sert qu'à l'intérieur d'une
// fonction, jamais au chargement du module : le cycle ne se referme donc
// jamais pendant l'évaluation, et Node le résout sans broncher.
import { markOrderPaid } from "./configurator-routes.js";
import { renderInvoicePdf, type LigneFacture } from "./pdf.js";
import { cheminApercu } from "./apercus.js";
import {
  dateCourte,
  langueDuDestinataire,
  langueLue,
  tc,
  type CleCourriel,
  type Langue,
} from "./courriels/index.js";
import { livraisonDansLaLangue, nomTraduit } from "./traductions.js";

/**
 * Le titre de repli d'une ligne (« Affiche personnalisée ») dans la langue du
 * courrier.
 *
 * Certains articles sont mis en forme AVANT qu'on sache à qui écrire — ceux
 * d'un remboursement ou d'une annulation, composés par la route elle-même. Ils
 * portent alors le repli français, qu'on traduit ici au dernier moment. Un
 * titre réellement saisi n'est jamais touché ; en français, rien ne change.
 */
function titresDansLaLangue(lignes: LigneCourrier[], langue: Langue): LigneCourrier[] {
  if (langue === "fr") return lignes;
  const repli = tc("fr")("lignes.titreParDefaut");
  return lignes.map((l) =>
    l.titre === repli ? { ...l, titre: tc(langue)("lignes.titreParDefaut") } : l,
  );
}

/**
 * L'adresse publique du site, pour les images des courriers.
 *
 * Un courrier ne sait pas résoudre un chemin relatif : sans origine, la
 * vignette ne s'afficherait nulle part.
 */
const ORIGINE_PUBLIQUE =
  (process.env.PUBLIC_ORIGIN ?? "").replace(/\/+$/, "") || "http://localhost:8080";

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
 * Minuit, heure de la boutique, pour une date « 2026-09-29 ».
 *
 * `new Date("2026-09-29")` se lit en heure UNIVERSELLE : un filtre « à partir
 * du 29 » commençait à 2 heures du matin à Paris, et les commandes de la nuit
 * glissaient au jour d'avant. Écrite sans « Z », l'heure se lit dans le fuseau
 * du serveur — Europe/Paris (TZ dans docker-compose).
 */
function debutDuJour(date: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00`) : new Date(date);
}

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

  /*
   * Les trois lectures partent ENSEMBLE : aucune n'a besoin des autres, elles
   * ne font que remplir trois colonnes du même tableau.
   *
   * La base est à 110 ms d'aller-retour (Neon, Ohio) : enchaînées, elles
   * coûtaient un tiers de seconde d'attente pure à chaque ouverture de la
   * liste des commandes.
   */
  const [lignes, partis, rembourses] = await Promise.all([
    db
      .select({
        orderId: schema.orderItems.orderId,
        id: schema.orderItems.id,
        quantity: schema.orderItems.quantity,
      })
      .from(schema.orderItems)
      .where(inArray(schema.orderItems.orderId, ids)),
    // Seules les expéditions non annulées comptent comme parties.
    db
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
      .where(inArray(schema.fulfillments.orderId, ids)),
    db
      .select({
        orderId: schema.refunds.orderId,
        amountCents: schema.refunds.amountCents,
      })
      .from(schema.refunds)
      .where(inArray(schema.refunds.orderId, ids)),
  ]);

  const commandeDeLigne = new Map<number, number>();
  for (const l of lignes) {
    out.get(l.orderId)!.articles += l.quantity;
    commandeDeLigne.set(l.id, l.orderId);
  }

  for (const p of partis) {
    if (p.status !== "success") continue;
    const oid = commandeDeLigne.get(p.orderItemId);
    if (oid != null) out.get(oid)!.expedies += p.quantity;
  }

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

/**
 * Remet en stock ce qui a été rendu ou annulé.
 *
 * Seules les variantes qui TIENNENT un stock sont touchées : une affiche est
 * imprimée à la commande et n'a rien à réintégrer, alors qu'un magnet ou une
 * carte, eux, sont revenus dans le tiroir. Le `is not null` fait la
 * différence, et il est dans la clause SQL plutôt que dans une lecture
 * préalable — sinon deux annulations simultanées liraient le même stock avant
 * de l'écrire toutes les deux.
 *
 * Écrite une fois, appelée par le remboursement ET par l'annulation : deux
 * additions de stock finiraient par diverger sur le cas des variantes sans
 * stock, qui est justement le cas courant ici.
 */
async function remettreEnStock(
  lignes: (typeof schema.orderItems.$inferSelect)[],
  quantites: Map<number, number>,
): Promise<void> {
  for (const ligne of lignes) {
    const q = quantites.get(ligne.id) ?? 0;
    if (q <= 0 || !ligne.variantId) continue;
    await db
      .update(schema.variants)
      .set({
        stockQty: raw`coalesce(${schema.variants.stockQty}, 0) + ${q}`,
      })
      .where(
        and(
          eq(schema.variants.id, ligne.variantId),
          raw`${schema.variants.stockQty} is not null`,
        ),
      );
  }
}

/**
 * Ce qui reste remboursable sur les frais de port d'une commande.
 *
 * Le port ne se rembourse pas par article : c'est une somme unique, qu'on rend
 * en une ou plusieurs fois. Il faut donc retrancher ce qui en est déjà parti,
 * et cette soustraction se fait ici seulement — le bouton « Rembourser » et
 * l'annulation d'une commande payée s'appuient sur la même.
 */
async function portRemboursable(
  orderId: number,
  portFactureCents: number,
): Promise<number> {
  const rendus = await db
    .select({ v: schema.refunds.shippingCents })
    .from(schema.refunds)
    .where(eq(schema.refunds.orderId, orderId));
  return Math.max(0, portFactureCents - rendus.reduce((s, r) => s + r.v, 0));
}

/**
 * Les commandes de ce lot qui ne peuvent plus rien expédier.
 *
 * Une commande annulée reste lisible et gardera son histoire, mais elle ne
 * doit plus RIEN faire partir : c'est tout le sens de l'annulation. Le
 * contrôle vit ici, en une requête pour tout le lot, et non dans l'écran —
 * une adresse tapée à la main doit buter sur la même règle.
 */
async function commandesAnnulees(ids: number[]): Promise<Set<number>> {
  if (!ids.length) return new Set();
  const rows = await db
    .select({ id: schema.orders.id, status: schema.orders.status })
    .from(schema.orders)
    .where(inArray(schema.orders.id, ids));
  return new Set(
    rows.filter((r) => r.status === "cancelled" || r.status === "voided").map((r) => r.id),
  );
}

/**
 * Expédie d'un coup tout ce qui reste sur un lot de commandes.
 *
 * Rend la liste de celles où quelque chose est RÉELLEMENT parti, et celle des
 * annulées qu'on a refusé de toucher. L'appelante en a besoin pour deux
 * choses : ne prévenir que les clientes dont le colis part vraiment, et dire à
 * l'écran combien de commandes ont été écartées, plutôt que d'annoncer
 * « 30 commandes traitées » quand deux d'entre elles étaient annulées.
 */
async function expedierTout(
  ids: number[],
): Promise<{ expediees: number[]; annulees: number[] }> {
  const annulees = await commandesAnnulees(ids);
  const expediees: number[] = [];
  for (const id of ids) {
    // Une commande annulée ne fait plus rien partir. Elle est écartée ici,
    // dans la fonction qui écrit, et pas seulement dans l'écran : un écran qui
    // masque un bouton est une politesse, pas une garde.
    if (annulees.has(id)) continue;
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
    expediees.push(id);
  }
  return { expediees, annulees: [...annulees] };
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
    // Les archivées sont hors de la liste ordinaire, et « archived=1 » les
    // montre SEULES : c'est la vue « Commandes archivées ». Les mélanger aux
    // autres ferait une liste où l'on ne saurait plus ce qui est rangé.
    conditions.push(
      q.archived === "1"
        ? isNotNull(schema.orders.archivedAt)
        : isNull(schema.orders.archivedAt),
    );
    if (q.channel === "web" || q.channel === "salon")
      conditions.push(eq(schema.orders.channel, q.channel));
    // Un stand précis : c'est la question qu'on se pose au retour d'un salon,
    // « combien celui-là a-t-il fait ».
    const stand = Number(q.stand);
    if (Number.isInteger(stand) && stand > 0)
      conditions.push(eq(schema.orders.standId, stand));
    conditions.push(...limiterAuStand(c));
    if (q.from) conditions.push(gte(schema.orders.createdAt, debutDuJour(q.from)));
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
    // Les aperçus des premières affiches de chaque commande, pour la liste
    // (demande de la boutique : voir les affiches sans ouvrir la commande,
    // comme dans le panier). Trois au plus ; le reste se dit « +N ».
    const lignesApercu = rows.length
      ? await db
          .select({ id: schema.orderItems.id, orderId: schema.orderItems.orderId })
          .from(schema.orderItems)
          .where(inArray(schema.orderItems.orderId, rows.map((r) => r.id)))
          .orderBy(asc(schema.orderItems.id))
      : [];
    const apercusParCommande = new Map<number, string[]>();
    const lignesParCommande = new Map<number, number>();
    for (const l of lignesApercu) {
      const liste = apercusParCommande.get(l.orderId) ?? [];
      if (liste.length < 3) liste.push(cheminApercu(l.id));
      lignesParCommande.set(l.orderId, (lignesParCommande.get(l.orderId) ?? 0) + 1);
      apercusParCommande.set(l.orderId, liste);
    }
    let enrichies = rows.map((r) => {
      const s = resume.get(r.id)!;
      return {
        ...r,
        apercus: apercusParCommande.get(r.id) ?? [],
        /** Nombre d'affiches DIFFÉRENTES (lignes), pour le « +N » des vignettes. */
        lignes: lignesParCommande.get(r.id) ?? 0,
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
    if (q.from) conditions.push(gte(schema.orders.createdAt, debutDuJour(q.from)));
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
    // Le même partage que la liste : l'export suit ce qu'on a sous les yeux.
    // Une commande rangée n'a pas à reparaître dans un fichier envoyé au
    // comptable sans que personne l'ait redemandée.
    conditions.push(
      q.archived === "1"
        ? isNotNull(schema.orders.archivedAt)
        : isNull(schema.orders.archivedAt),
    );

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
      /*
       * L'action groupée PRÉVIENT la cliente, comme le fait le formulaire
       * d'expédition à l'unité. Deux boutons qui portent le même mot ne
       * peuvent pas avoir deux effets différents : celui de la fiche envoyait
       * « votre commande est en route », celui de la liste ne disait rien, et
       * rien à l'écran ne permettait de deviner lequel des deux on venait de
       * cliquer. C'est la panne la plus courante du service client — une
       * cliente qui écrit « où en est ma commande ? » une semaine après
       * qu'elle est partie.
       *
       * Le courrier part SANS transporteur ni numéro de suivi, parce que
       * `expedierTout` n'en enregistre aucun. Le modèle sait le faire : il
       * écrit alors « votre affiche est partie, elle arrive » et n'affiche
       * aucun bouton de suivi. C'est moins qu'un suivi, mais c'est la réponse
       * à la question que la cliente se pose ; et le silence, lui, n'en est
       * pas une. Pour un colis suivi, c'est le formulaire de la fiche qu'il
       * faut ouvrir — lui prend le transporteur et le numéro.
       */
      const bilan = traite
        ? await expedierTout(ids)
        : { expediees: [], annulees: [] as number[] };
      if (!traite) await annulerExpeditions(ids);
      // Les annulées gardent leur date de traitement telle quelle : on ne les
      // a pas touchées, il n'y a pas de raison de l'écrire.
      const touchees = ids.filter((id) => !bilan.annulees.includes(id));
      if (touchees.length)
        await db
          .update(schema.orders)
          .set({ fulfilledAt: traite ? new Date() : null })
          .where(inArray(schema.orders.id, touchees));
      if (touchees.length)
        await db.insert(schema.orderEvents).values(
          touchees.map((orderId) => ({
            orderId,
            kind: "event",
            message: traite
              ? "Commande marquée comme traitée (action groupée)."
              : "Commande remise à traiter (action groupée).",
          })),
        );
      // Un courrier par commande réellement expédiée, et seulement celles-là :
      // une commande dont tout était déjà parti ne doit pas recevoir un
      // deuxième « c'est en route ».
      for (const orderId of bilan.expediees)
        await previenirDeLExpedition(orderId, {
          carrier: null,
          trackingNumber: null,
          trackingUrl: null,
        });
      return c.json({
        ok: true,
        count: touchees.length,
        prevenues: bilan.expediees.length,
        // Nommer ce qui a été écarté : « 30 traitées » quand deux étaient
        // annulées est un compte rendu qui ment par omission.
        annulees: bilan.annulees.length,
      });
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

    // « archiver » range le lot, « restaurer » le ressort. L'ancienne action
    // « supprimer » n'existe plus : elle effaçait les ventes pour de bon.
    if (action === "archiver" || action === "restaurer") {
      const archiver = action === "archiver";
      const touchees = await archiverCommandes(ids, archiver);
      return c.json({
        ok: true,
        archived: archiver,
        count: touchees.length,
        numeros: touchees,
      });
    }

    return c.json({ error: "action inconnue" }, 400);
  });

  /**
   * Archive une commande, ou la restaure.
   *
   * La suppression définitive a été RETIRÉE, et elle ne manquait à personne :
   * elle emportait en cascade les lignes, les expéditions, les
   * remboursements, les mouvements d'argent et le journal, laissait dans la
   * numérotation un trou que plus rien ne pouvait expliquer, et ne demandait
   * même pas si la commande était payée.
   *
   * Archivée, la commande quitte la liste ordinaire et l'export, et se range
   * dans « Commandes archivées ». Sa fiche reste lisible, ses fichiers
   * d'impression aussi, la recherche continue de la rendre — marquée
   * « Archivée », c'est ainsi qu'on la retrouve — et « Restaurer » la remet
   * dans la liste.
   *
   * Ce que l'archivage ne fait PAS, et c'est voulu : il ne touche ni au
   * statut, ni à l'argent, ni au stock, et ne prévient pas la cliente. Une
   * vente archivée continue donc de compter dans le chiffre d'affaires. Pour
   * qu'elle cesse d'y compter, c'est l'ANNULATION qu'il faut — elle existe
   * déjà, elle rend l'argent, rouvre le stock et écrit au journal.
   */
  app.post("/admin/orders/:id/archive", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: "commande inconnue" }, 400);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    // Défaut : on archive. Seul un « archived: false » explicite restaure.
    const archiver = b.archived !== false;
    const touchees = await archiverCommandes([id], archiver);
    if (!touchees.length)
      return c.json(
        { error: "Cette commande n'existe plus. Rechargez la liste." },
        404,
      );
    return c.json({ ok: true, archived: archiver, numero: touchees[0] });
  });

  /**
   * Range (ou ressort) les commandes demandées et rend leurs numéros.
   *
   * Une seule écriture pour tout le lot : la date d'archivage est la même
   * pour toutes, ce qui permet de les retrouver ensemble dans la vue des
   * archivées quand on en a rangé vingt d'un coup.
   */
  async function archiverCommandes(
    ids: number[],
    archiver: boolean,
  ): Promise<string[]> {
    if (!ids.length) return [];
    const touchees = await db
      .update(schema.orders)
      .set({ archivedAt: archiver ? new Date() : null })
      .where(inArray(schema.orders.id, ids))
      .returning({ numero: schema.orders.number });
    return touchees.map((p) => p.numero);
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
    // Une commande annulée ne fait plus rien partir : c'est tout le sens de
    // l'annulation, et la cliente a reçu un courrier qui le lui dit.
    if (order.status === "cancelled" || order.status === "voided")
      return c.json(
        {
          error:
            "Cette commande est annulée : plus rien ne peut en partir. Si l'annulation était une erreur, il faut repasser une commande.",
        },
        400,
      );

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
          langue: schema.orders.langue,
        })
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId));
      if (!commande?.customerId) return;

      const [client] = await db
        .select({
          name: schema.customers.name,
          email: schema.customers.email,
          langue: schema.customers.langue,
        })
        .from(schema.customers)
        .where(eq(schema.customers.id, commande.customerId));
      if (!client?.email) return;
      const langue = langueDuDestinataire({
        compte: client.langue,
        commande: commande.langue,
      });

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
          titre: l.title ?? tc(langue)("lignes.titreParDefaut"),
          format: typeof cfg.format === "string" ? cfg.format : null,
          cadre: null,
          quantite: l.quantity,
          unitPriceCents: l.unitPriceCents,
        };
      });
      const prenom =
        (client.name ?? "").split(" ")[0] || tc(langue)("commun.prenomParDefaut");

      const courrier =
        commande.channel === "salon"
          ? courrierPreteAuStand({
              langue,
              prenomClient: prenom,
              numero: commande.number,
              // Le nom du stand a été gardé dans la note interne au moment de
              // la vente : c'est le seul endroit où il vit sur la commande.
              evenement:
                commande.note?.replace(/^Stand\s*:\s*/, "").trim() || null,
              lignes,
            })
          : courrierExpediee({
              langue,
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
    const r = await enregistrerRemboursement(id, b);
    if (r.introuvable) return c.notFound();
    if (r.erreur) return c.json({ error: r.erreur }, r.code ?? 400);
    return c.json(r.refund);
  });

  /**
   * Le remboursement lui-même, détaché de sa route.
   *
   * L'annulation d'une commande payée doit pouvoir rendre l'argent, et elle
   * doit le faire EXACTEMENT comme le bouton « Rembourser » : mêmes plafonds,
   * même renvoi chez Stripe, même écriture au grand livre, même courrier. Une
   * seconde façon de rembourser aurait fini par diverger de celle-ci sur un
   * détail — le plafond du port, ou le cumul des remboursements précédents — et
   * l'écart ne se serait vu que le jour où il aurait coûté de l'argent.
   *
   * Rend un objet plutôt qu'une réponse HTTP, pour que l'annulation puisse
   * décider elle-même quoi dire quand le remboursement échoue.
   */
  async function enregistrerRemboursement(
    id: number,
    b: Record<string, unknown>,
  ): Promise<{
    introuvable?: true;
    erreur?: string;
    code?: 400 | 502;
    refund?: typeof schema.refunds.$inferSelect;
    montantCents?: number;
  }> {
    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, id));
    if (!order) return { introuvable: true };

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
    /**
     * Les mêmes lignes, telles que le courrier les montrera. Composées ici,
     * dans la boucle qui les valide : les retrouver après coup obligerait à
     * refaire la correspondance avec les articles, et une seconde façon de la
     * faire finirait par diverger de celle qui a servi à calculer l'argent.
     */
    const articlesRendus: LigneCourrier[] = [];
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
        return {
          erreur: `« ${ligne.title ?? "Article"} » : ${reste} exemplaire(s) remboursable(s) au plus.`,
        };
      detail.push({
        orderItemId: ligne.id,
        quantity: q,
        amountCents: ligne.unitPriceCents * q,
      });
      const cfg = (ligne.config ?? {}) as { format?: unknown };
      articlesRendus.push({
        titre: ligne.title ?? "Affiche personnalisée",
        format: typeof cfg.format === "string" ? cfg.format : null,
        cadre: null,
        quantite: q,
        unitPriceCents: ligne.unitPriceCents,
        // L'affiche elle-même : un remboursement partiel doit dire LAQUELLE
        // des trois affiches est concernée, et le titre seul ne suffit pas.
        imageUrl: `${ORIGINE_PUBLIQUE}/api${cheminApercu(ligne.id)}`,
      });
    }

    const portDemande = Math.max(0, Math.floor(Number(b.shippingCents) || 0));
    const portRestant = await portRemboursable(id, order.shippingCents);
    if (portDemande > portRestant)
      return {
        erreur: `Frais de port : ${(portRestant / 100).toFixed(2)} € remboursables au plus.`,
      };

    const montant = detail.reduce((s, d) => s + d.amountCents, 0) + portDemande;
    if (montant <= 0) return { erreur: "Rien à rembourser." };
    if (dejaCents + montant > order.totalCents)
      return { erreur: "Le total remboursé dépasserait le montant encaissé." };

    // Renvoi de l'argent chez le prestataire qui l'a encaissé, s'il est
    // demandé et possible. On ne cherchait ici qu'un paiement Stripe : une
    // vente réglée par PayPal retombait donc sur « à la main », c'est-à-dire
    // que la boutique notait un remboursement que personne n'avait fait.
    let gateway = "manuel";
    let externalRef: string | null = null;
    if (b.viaPsp !== false) {
      const [paiement] = await db
        .select()
        .from(schema.payments)
        .where(
          and(
            eq(schema.payments.orderId, id),
            inArray(schema.payments.provider, ["stripe", "paypal"]),
            eq(schema.payments.status, "succeeded"),
          ),
        )
        .orderBy(desc(schema.payments.createdAt));

      if (paiement?.provider === "stripe" && paiement.externalRef) {
        try {
          const r = await refundStripe(paiement.externalRef, montant);
          gateway = "stripe";
          externalRef = r.id;
        } catch (e) {
          return {
            erreur: `Stripe a refusé le remboursement : ${String(e)}`,
            code: 502,
          };
        }
      } else if (paiement?.provider === "paypal") {
        if (!paypalConfigured)
          return {
            erreur:
              "Cette commande a été réglée par PayPal, et PayPal n'est pas configuré sur ce serveur. Remboursez depuis votre compte PayPal, puis enregistrez le remboursement ici en décochant « rendre l'argent ».",
            code: 400,
          };
        // PayPal ne rembourse pas une commande mais une CAPTURE. Les ventes
        // d'avant qu'on garde cet identifiant n'en ont pas : on le redemande
        // plutôt que d'échouer sans explication.
        let capture = paiement.captureRef;
        if (!capture && paiement.externalRef) {
          try {
            capture = await capturePaypalDeLaCommande(paiement.externalRef);
            if (capture)
              await db
                .update(schema.payments)
                .set({ captureRef: capture })
                .where(eq(schema.payments.id, paiement.id));
          } catch {
            capture = null;
          }
        }
        if (!capture)
          return {
            erreur:
              "L'encaissement PayPal de cette commande est introuvable. Remboursez depuis votre compte PayPal, puis enregistrez le remboursement ici en décochant « rendre l'argent ».",
            code: 502,
          };
        try {
          const r = await refundPaypal(capture, montant);
          gateway = "paypal";
          externalRef = r.id;
        } catch (e) {
          return {
            erreur: `PayPal a refusé le remboursement : ${String(e)}`,
            code: 502,
          };
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
    if (b.restock === true)
      await remettreEnStock(
        lignes,
        new Map(detail.map((d) => [d.orderItemId, d.quantity])),
      );

    await db.insert(schema.orderEvents).values({
      orderId: id,
      kind: "event",
      message:
        `Remboursement de ${(montant / 100).toFixed(2).replace(".", ",")} €` +
        (gateway === "stripe" ? " via Stripe" : " (hors ligne)") +
        (b.restock === true ? ", articles remis en stock" : "") +
        ".",
    });

    // Le courrier suit le remboursement qui vient d'être inscrit, et lui seul.
    // Rejouer la requête ne le renverra pas : elle créerait un AUTRE
    // remboursement, et n'y arrive pas — les quantités déjà rendues et le
    // plafond du montant encaissé la refusent avant d'en écrire un second.
    await previenirDuRemboursement(id, {
      montantCents: montant,
      portCents: portDemande,
      articles: articlesRendus,
      totalRembourseCents: dejaCents + montant,
      viaPaiementEnLigne: gateway !== "manuel",
    });
    return { refund: refund!, montantCents: montant };
  }

  /**
   * Dit à la cliente ce qui vient de lui être rendu.
   *
   * Même prudence que pour l'expédition : le remboursement est écrit, le grand
   * livre en fait foi, et un courrier qui ne part pas n'a rien à défaire. Ne
   * lève donc jamais, et l'échec se lit dans la chronologie de la commande.
   *
   * RIEN ne part pour une commande de stand : ce courrier porte des montants,
   * et le stand n'en écrit aucun, du premier écran de la tablette jusqu'ici.
   * C'est la vendeuse qui a annoncé le prix de vive voix, et c'est elle qui
   * rend l'argent en disant ce qu'elle rend.
   */
  async function previenirDuRemboursement(
    orderId: number,
    remboursement: {
      montantCents: number;
      portCents: number;
      articles: LigneCourrier[];
      totalRembourseCents: number;
      viaPaiementEnLigne: boolean;
    },
  ): Promise<void> {
    if (!mailConfigure()) return;
    try {
      const [commande] = await db
        .select({
          number: schema.orders.number,
          channel: schema.orders.channel,
          customerId: schema.orders.customerId,
          totalCents: schema.orders.totalCents,
          langue: schema.orders.langue,
        })
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId));
      if (!commande) return;

      if (commande.channel === "salon") {
        await db.insert(schema.orderEvents).values({
          orderId,
          kind: "event",
          message:
            "Aucun courrier de remboursement : commande prise au stand, où les montants ne s'écrivent pas.",
        });
        return;
      }
      if (!commande.customerId) return;

      const [client] = await db
        .select({
          name: schema.customers.name,
          email: schema.customers.email,
          langue: schema.customers.langue,
        })
        .from(schema.customers)
        .where(eq(schema.customers.id, commande.customerId));
      if (!client?.email) return;
      const langue = langueDuDestinataire({
        compte: client.langue,
        commande: commande.langue,
      });

      const courrier = courrierRemboursee({
        langue,
        prenomClient:
          (client.name ?? "").split(" ")[0] || tc(langue)("commun.prenomParDefaut"),
        numero: commande.number,
        montantCents: remboursement.montantCents,
        portCents: remboursement.portCents,
        articles: titresDansLaLangue(remboursement.articles, langue),
        totalRembourseCents: remboursement.totalRembourseCents,
        totalCommandeCents: commande.totalCents,
        viaPaiementEnLigne: remboursement.viaPaiementEnLigne,
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
      // Une panne de courrier ne défait pas un remboursement enregistré.
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Annuler une commande                                              */
  /* ------------------------------------------------------------------ */

  /**
   * Annule une commande.
   *
   * L'annulation n'EFFACE rien : la commande reste dans la liste, sa
   * chronologie reste lisible, ses mouvements d'argent restent au grand livre.
   * Elle sort en revanche des chiffres (`HORS_VENTES`) et ne peut plus rien
   * expédier. C'est ce qui la distingue de la suppression, qui, elle, fait
   * disparaître la vente pour de bon.
   *
   * Elle fait, dans cet ordre, tout ce qu'une annulation demande : rendre
   * l'argent si on le lui demande, remettre le stock, fermer les expéditions,
   * inscrire au grand livre ce qui ne sera jamais encaissé, poser le statut,
   * prévenir la cliente, et tout écrire au journal. Cet ordre n'est pas
   * indifférent : l'argent part AVANT le changement de statut, parce que le
   * remboursement plafonne au montant encaissé et qu'une commande déjà
   * marquée annulée n'aurait plus rien à rendre.
   */
  app.post("/admin/orders/:id/cancel", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: "commande inconnue" }, 400);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, id));
    if (!order) return c.notFound();

    if (order.status === "cancelled" || order.status === "voided")
      return c.json(
        {
          error: `La commande ${order.number} est déjà annulée${
            order.cancelledAt
              ? ` depuis le ${order.cancelledAt.toLocaleDateString("fr-FR")}`
              : ""
          }. Rien n'a été refait.`,
        },
        400,
      );

    // Un panier n'est pas une commande : il n'a jamais été passé, il n'y a
    // rien à annuler ni personne à prévenir. Il se supprime, ou il s'oublie.
    if (order.status === "draft")
      return c.json(
        {
          error:
            "Ceci est un panier abandonné, pas une commande : il n'y a rien à annuler. Supprimez-le si vous voulez qu'il disparaisse.",
        },
        400,
      );

    const resume = (await resumeCommandes([id])).get(id)!;

    // Ce qui est PARTI ne se rattrape pas par une annulation. On le dit avec
    // les chiffres sous les yeux, et on dit quoi faire à la place : sans cela,
    // le refus ressemble à une panne.
    if (resume.expedies > 0)
      return c.json(
        {
          error:
            resume.expedies >= resume.articles
              ? `Cette commande est déjà entièrement partie (${resume.expedies} article(s)). On n'annule pas un colis en route : annulez d'abord l'expédition si elle n'est pas réellement partie, sinon enregistrez un remboursement au retour du colis.`
              : `Cette commande est déjà partie en partie : ${resume.expedies} article(s) sur ${resume.articles} ont quitté l'atelier. Annulez d'abord cette expédition si le colis n'est pas réellement parti ; sinon, remboursez ce qui revient plutôt que d'annuler la commande entière.`,
        },
        400,
      );

    const motif = motifDAnnulation(b.motif, b.motifLibre);
    const auteur = String(b.author ?? "").trim() || null;
    const auStand = order.channel === "salon";
    const etaitPayee = order.status === "paid";

    const lignes = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, id));

    /* --- 1. L'argent, s'il faut le rendre ----------------------------- */

    let rembourseCents = 0;
    if (b.rembourser === true) {
      if (!etaitPayee)
        return c.json(
          {
            error:
              "Cette commande n'a jamais été encaissée : il n'y a rien à rembourser. Décochez le remboursement pour l'annuler.",
          },
          400,
        );
      const dejaRendu = await quantitesRemboursees(id);
      const aRendre = lignes
        .map((l) => ({
          orderItemId: l.id,
          quantity: l.quantity - (dejaRendu.get(l.id) ?? 0),
        }))
        .filter((l) => l.quantity > 0);
      // Le port part avec le reste : la commande entière est annulée, la
      // cliente n'a rien reçu, il n'y a pas de raison qu'elle paie l'envoi.
      const portARendre = await portRemboursable(id, order.shippingCents);
      // Une commande déjà entièrement remboursée n'a plus rien à rendre. Le
      // remboursement refuserait — « Rien à rembourser » — et son refus
      // arrêterait l'annulation, alors qu'elle est justement le geste qui
      // reste à faire. On saute donc l'étape au lieu de buter dessus.
      if (!aRendre.length && portARendre <= 0) {
        await db.insert(schema.orderEvents).values({
          orderId: id,
          kind: "event",
          message:
            "Aucun remboursement à l'annulation : tout avait déjà été rendu sur cette commande.",
        });
      } else {
        const r = await enregistrerRemboursement(id, {
          items: aRendre,
          shippingCents: portARendre,
          reason: motif ?? "Commande annulée",
          note: String(b.note ?? "").trim() || null,
          restock: b.restock === true,
          viaPsp: b.viaPsp !== false,
          author: auteur,
        });
        // Un remboursement refusé ARRÊTE l'annulation. Annuler quand même
        // laisserait une commande annulée dont l'argent est resté chez nous,
        // et c'est exactement le genre d'écart qu'on ne retrouve jamais.
        if (r.erreur)
          return c.json(
            {
              error: `La commande n'a pas été annulée : le remboursement a échoué. ${r.erreur}`,
            },
            r.code ?? 400,
          );
        rembourseCents = r.montantCents ?? 0;
      }
    } else if (b.restock === true) {
      // Sans remboursement, la remise en stock n'a personne pour la faire :
      // on la fait ici, sur la totalité de ce qui a été commandé.
      await remettreEnStock(
        lignes,
        new Map(lignes.map((l) => [l.id, l.quantity])),
      );
    }

    /* --- 2. Les expéditions ------------------------------------------- */

    // Aucune expédition vivante ne survit à une annulation. Le contrôle plus
    // haut a déjà écarté les commandes dont quelque chose est parti : ce qui
    // reste ici est une expédition à zéro article, ou une trace laissée par
    // une manœuvre concurrente. L'appel est donc une GARANTIE, pas un geste
    // courant — mais sans lui, la garantie ne tiendrait qu'à un contrôle.
    await annulerExpeditions([id]);

    /* --- 3. Le grand livre -------------------------------------------- */

    // Ce qui n'a jamais été encaissé doit quand même se lire quelque part.
    // Une commande qui disparaît des chiffres sans un mot laisse la page
    // Finances avec une vente attendue qui ne vient pas ; l'écriture « void »
    // dit noir sur blanc que cet argent-là n'arrivera pas. On ne l'écrit que
    // s'il n'y a EU aucun encaissement : sinon c'est le remboursement qui
    // solde la commande, et deux écritures raconteraient deux histoires.
    const [encaisse] = await db
      .select({
        cents: raw<number>`coalesce(sum(${schema.orderTransactions.amountCents}), 0)::int`,
      })
      .from(schema.orderTransactions)
      .where(
        and(
          eq(schema.orderTransactions.orderId, id),
          eq(schema.orderTransactions.kind, "sale"),
          eq(schema.orderTransactions.status, "success"),
        ),
      );
    const rienEncaisse = (encaisse?.cents ?? 0) <= 0;
    if (rienEncaisse && order.totalCents > 0)
      await db.insert(schema.orderTransactions).values({
        orderId: id,
        kind: "void",
        status: "success",
        amountCents: order.totalCents,
        gateway: null,
        message: motif,
      });

    /* --- 4. Le statut -------------------------------------------------- */

    const annuleeLe = new Date();
    await db
      .update(schema.orders)
      .set({
        status: "cancelled",
        cancelledAt: annuleeLe,
        cancelReason: motif,
        // Une commande annulée n'est pas « traitée » : elle n'a plus rien à
        // faire, ce qui n'est pas la même chose que d'avoir tout fait.
        fulfilledAt: null,
      })
      .where(eq(schema.orders.id, id));

    /* --- 5. Le journal -------------------------------------------------- */

    /*
     * Ce que l'annulation laisse dû à la cliente.
     *
     * On retranche AUSSI ce qui avait été rendu avant elle : une commande déjà
     * remboursée en entier ne doit plus rien, et annoncer le contraire
     * enverrait la boutique rendre une seconde fois le même argent.
     */
    const resteADevoir = etaitPayee
      ? Math.max(0, order.totalCents - resume.rembourseCents - rembourseCents)
      : 0;

    await db.insert(schema.orderEvents).values({
      orderId: id,
      kind: "event",
      author: auteur,
      message:
        `Commande annulée${motif ? ` — ${motif}` : ""}.` +
        (rembourseCents > 0
          ? ` ${(rembourseCents / 100).toFixed(2).replace(".", ",")} € remboursés dans la foulée.`
          : resteADevoir > 0
            ? ` Le montant réglé n'a PAS été remboursé : ${(resteADevoir / 100).toFixed(2).replace(".", ",")} € restent à rendre à la cliente.`
            : "") +
        (b.restock === true ? " Articles remis en stock." : "") +
        (rienEncaisse && order.totalCents > 0
          ? " Écriture d'annulation portée au grand livre."
          : ""),
    });

    if (order.invoiceNumber)
      await db.insert(schema.orderEvents).values({
        orderId: id,
        kind: "event",
        message: `La facture ${order.invoiceNumber} a déjà été éditée pour cette commande : elle garde son numéro et reste éditable, portant désormais la mention « annulée ». Un avoir reste à établir si elle est partie chez la cliente.`,
      });

    /* --- 6. Le courrier ------------------------------------------------ */

    await previenirDeLAnnulation(id, {
      // Le choix brut, pas la phrase du journal : le courrier recompose le
      // motif dans la langue de la cliente.
      motif: { choix: b.motif, libre: b.motifLibre },
      // Une commande payée dont on n'a rien rendu ne doit pas laisser croire
      // à la cliente que son argent revient : le modèle ne le dit que si un
      // remboursement a réellement eu lieu.
      dejaPayee: rembourseCents > 0,
      articles: lignes.map((l) => {
        const cfg = (l.config ?? {}) as { format?: unknown };
        return {
          titre: l.title ?? "Affiche personnalisée",
          format: typeof cfg.format === "string" ? cfg.format : null,
          cadre: null,
          quantite: l.quantity,
          unitPriceCents: l.unitPriceCents,
        };
      }),
      auStand,
    });

    return c.json({
      ok: true,
      numero: order.number,
      annuleeLe: annuleeLe.toISOString(),
      motif,
      rembourseCents,
      // Ce que l'annulation LAISSE en suspens : l'écran le répète à la
      // boutiquière, qui vient de faire un geste dont elle ne verra plus la
      // conséquence nulle part si personne ne le lui dit.
      resteADevoir,
    });
  });

  /**
   * Les motifs proposés, et leur libellé complet.
   *
   * Une liste COURTE, choisie plutôt que tapée : un motif libre finit par
   * contenir « annulée », « annulation », « annul. » et « à la demande » pour
   * dire la même chose, et plus rien ne se compte ni ne se retrouve. Le champ
   * libre reste là pour « autre », parce qu'aucune liste ne couvre tout.
   */
  /*
   * Les libellés vivent dans le dictionnaire des courriels : le même motif
   * s'écrit en français au journal, et dans la langue de la cliente dans son
   * courrier. « Autre » n'en a pas, il ne s'écrit jamais (voir plus bas).
   */
  const MOTIFS_ANNULATION: Record<string, CleCourriel | null> = {
    saisie: "annulee.motifSaisie",
    rupture: "annulee.motifRupture",
    cliente: "annulee.motifCliente",
    impaye: "annulee.motifImpaye",
    autre: null,
  };

  /**
   * Le motif tel qu'il s'écrira au journal (en français) et dans le courrier
   * (dans la langue de la cliente). La précision saisie par la boutique, elle,
   * reste telle qu'elle a été écrite.
   */
  function motifDAnnulation(
    choix: unknown,
    libre: unknown,
    langue: Langue = "fr",
  ): string | null {
    const cle = String(choix ?? "").trim();
    const precision = String(libre ?? "")
      .trim()
      .slice(0, 200);
    const connu = Object.prototype.hasOwnProperty.call(MOTIFS_ANNULATION, cle);
    const libelle = connu ? MOTIFS_ANNULATION[cle] : null;
    // « Autre » sans précision ne dit rien : mieux vaut alors ne rien écrire
    // que d'envoyer à la cliente un motif qui s'appelle « Autre ». Un choix
    // inconnu vaut de même sa seule précision.
    if (!libelle) return precision || null;
    const texte = tc(langue)(libelle);
    return precision ? `${texte} — ${precision}` : texte;
  }

  /**
   * Dit à la cliente que sa commande est annulée.
   *
   * Même prudence que pour l'expédition et le remboursement : l'annulation est
   * écrite, elle ne se défait pas parce qu'un courrier n'est pas parti. Ne lève
   * donc jamais, et l'échec se lit dans la chronologie.
   *
   * RIEN ne part pour une commande de stand — la MÊME règle que le
   * remboursement, et pour la même raison : personne n'a laissé son adresse
   * e-mail au stand pour recevoir des nouvelles administratives, la vendeuse a
   * la cliente en face d'elle ou au téléphone, et c'est elle qui lui dit.
   */
  async function previenirDeLAnnulation(
    orderId: number,
    annulation: {
      /** Le motif tel que la boutique l'a choisi : il s'écrit dans la langue du courrier. */
      motif: { choix: unknown; libre: unknown };
      dejaPayee: boolean;
      articles: LigneCourrier[];
      auStand: boolean;
    },
  ): Promise<void> {
    try {
      if (annulation.auStand) {
        await db.insert(schema.orderEvents).values({
          orderId,
          kind: "event",
          message:
            "Aucun courrier d'annulation : commande prise au stand, c'est la vendeuse qui prévient la cliente.",
        });
        return;
      }
      if (!mailConfigure()) {
        await db.insert(schema.orderEvents).values({
          orderId,
          kind: "event",
          message:
            "Aucun courrier d'annulation : l'envoi d'e-mails n'est pas configuré. La cliente n'a pas été prévenue.",
        });
        return;
      }

      const [commande] = await db
        .select({
          number: schema.orders.number,
          customerId: schema.orders.customerId,
          langue: schema.orders.langue,
        })
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId));
      if (!commande?.customerId) {
        await db.insert(schema.orderEvents).values({
          orderId,
          kind: "event",
          message:
            "Aucun courrier d'annulation : cette commande n'a pas de client rattaché.",
        });
        return;
      }

      const [client] = await db
        .select({
          name: schema.customers.name,
          email: schema.customers.email,
          langue: schema.customers.langue,
        })
        .from(schema.customers)
        .where(eq(schema.customers.id, commande.customerId));
      if (!client?.email) {
        await db.insert(schema.orderEvents).values({
          orderId,
          kind: "event",
          message:
            "Aucun courrier d'annulation : aucune adresse e-mail sur la fiche de la cliente.",
        });
        return;
      }
      const langue = langueDuDestinataire({
        compte: client.langue,
        commande: commande.langue,
      });

      const courrier = courrierAnnulee({
        langue,
        prenomClient:
          (client.name ?? "").split(" ")[0] || tc(langue)("commun.prenomParDefaut"),
        numero: commande.number,
        motif: motifDAnnulation(annulation.motif.choix, annulation.motif.libre, langue),
        articles: titresDansLaLangue(annulation.articles, langue),
        dejaPayee: annulation.dejaPayee,
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
      // Une panne de courrier ne défait pas une annulation enregistrée.
    }
  }

  /**
   * Les champs de l'adresse de livraison, et leur nom dans la chronologie.
   * Le même ordre que le formulaire : c'est celui dans lequel on les relit.
   */
  const CHAMPS_ADRESSE = {
    shippingName: "nom",
    shippingLine1: "adresse",
    shippingLine2: "complément",
    shippingPostalCode: "code postal",
    shippingCity: "ville",
    shippingCountry: "pays",
    shippingPhone: "téléphone",
  } as const;
  type ChampAdresse = keyof typeof CHAMPS_ADRESSE;

  /**
   * Corrige l'adresse de livraison d'une commande déjà passée — depuis la
   * colonne de droite de la fiche, ou depuis le bloc du bordereau, qui en a
   * besoin avant d'acheter : un retrait sur place qu'on finit par envoyer, une
   * vente du stand qui doit voyager, une adresse fausse.
   *
   * Seuls les champs ENVOYÉS changent. Le bloc du bordereau d'une commande en
   * point relais ne corrige que le nom et le téléphone : il n'a pas à renvoyer
   * une adresse qu'il n'affiche pas pour qu'elle survive.
   *
   * `livrerALAdresse` envoie le colis à cette adresse plutôt qu'au point
   * relais choisi — un point fermé depuis, une cliente qui préfère être
   * livrée chez elle. Le point quitte la commande ; la chronologie le garde.
   *
   * La chronologie dit QUI a changé QUOI, ancienne et nouvelle valeur : une
   * étiquette partie à la mauvaise adresse se comprend en la relisant.
   */
  app.post("/admin/orders/:id/address", async (c) => {
    const id = Number(c.req.param("id"));
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const txt = (v: unknown) => {
      const s = String(v ?? "").trim();
      return s ? s.slice(0, 200) : null;
    };
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
    if (!order) return c.notFound();

    const maj: Partial<Record<ChampAdresse, string | null>> = {};
    for (const champ of Object.keys(CHAMPS_ADRESSE) as ChampAdresse[])
      if (champ in b) maj[champ] = txt(b[champ]);
    // Le pays sert de code aux transporteurs (« FR », « BE ») : « France »
    // écrit en toutes lettres ferait refuser l'étiquette bien plus tard, en
    // anglais. Mieux vaut le refuser ici, en français.
    if (maj.shippingCountry) {
      const pays = maj.shippingCountry.toUpperCase();
      if (!/^[A-Z]{2}$/.test(pays))
        return c.json(
          { error: "Le pays s'écrit avec son code à deux lettres : FR, BE, CH, LU…" },
          400,
        );
      maj.shippingCountry = pays;
    }
    // Un retrait sur stand se range lui aussi dans `relayPointId` (« stand:3 ») :
    // ce n'est pas un point relais à quitter, le colis va déjà à l'adresse.
    const pointQuitte =
      b.livrerALAdresse === true &&
      !!order.relayPointId &&
      !order.relayPointId.startsWith("stand:")
        ? (order.relayPointLabel ?? order.relayPointId)
        : null;

    const changes = (Object.keys(maj) as ChampAdresse[])
      .filter((k) => (order[k] ?? null) !== maj[k])
      .map((k) => `${CHAMPS_ADRESSE[k]} : « ${order[k] ?? "—"} » → « ${maj[k] ?? "—"} »`);
    if (!changes.length && !pointQuitte) return c.json({ ok: true, modifie: false, bordereauVivant: false });

    await db
      .update(schema.orders)
      .set({ ...maj, ...(pointQuitte ? { relayPointId: null, relayPointLabel: null } : {}) })
      .where(eq(schema.orders.id, id));

    // Une étiquette déjà achetée porte l'ANCIENNE adresse : SendCloud ne la
    // modifie pas. La fiche le redit, pour qu'on l'annule et qu'on la rachète.
    const [vivant] = await db
      .select({ id: schema.bordereaux.id })
      .from(schema.bordereaux)
      .where(
        and(
          eq(schema.bordereaux.orderId, id),
          inArray(schema.bordereaux.statut, ["achete", "en_cours"]),
        ),
      );
    const auteur = String(b.author ?? "").trim() || c.get("utilisateur")?.email || null;
    await db.insert(schema.orderEvents).values({
      orderId: id,
      kind: "event",
      author: auteur,
      message:
        (pointQuitte
          ? `Livraison au point relais « ${pointQuitte} » remplacée par une livraison à l'adresse, au back-office`
          : "Adresse de livraison modifiée au back-office") +
        (changes.length ? ` (${changes.join(" ; ")})` : "") +
        "." +
        (vivant ? " Le bordereau déjà acheté porte encore l'ancienne adresse." : ""),
    });
    return c.json({ ok: true, modifie: true, bordereauVivant: !!vivant });
  });

  /* ------------------------------------------------------------------ */
  /*  Encaisser un règlement hors ligne                                 */
  /* ------------------------------------------------------------------ */

  /**
   * Les moyens de règlement qui n'ont pas de prestataire, et leur libellé.
   *
   * Ils vont au JOURNAL, pas au grand livre : la page Finances range tout ce
   * qui entre à la main sous un seul moyen (« À la main (virement, espèces) »),
   * et le détail du chèque ou du virement se lit sur la fiche de la commande,
   * là où on le cherche.
   */
  const MOYENS_HORS_LIGNE: Record<string, string> = {
    virement: "virement bancaire",
    cheque: "chèque",
    especes: "espèces",
    autre: "un autre moyen",
  };

  /**
   * Marque une commande payée alors que l'argent est arrivé hors du site.
   *
   * Le virement et le chèque existent, et rien ne savait les enregistrer : la
   * commande restait « En attente » pour toujours, elle ne sortait jamais dans
   * les commandes à préparer, ses PDF d'impression n'étaient pas fabriqués et
   * la cliente ne recevait aucune confirmation. Elle avait pourtant payé.
   *
   * Tout le travail est fait par `markOrderPaid`, la MÊME fonction qu'un
   * paiement Stripe : date de paiement, PDF d'impression, écriture au grand
   * livre, confirmation à la cliente, panier relancé noté comme récupéré. On
   * ne fait ici que deux choses qu'elle ne fait pas — écrire la ligne de
   * paiement, qu'un paiement en ligne crée au moment du tunnel, et dire au
   * journal qui a encaissé quoi.
   */
  app.post("/admin/orders/:id/encaisser", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: "commande inconnue" }, 400);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, id));
    if (!order) return c.notFound();

    if (order.status === "draft")
      return c.json(
        {
          error:
            "Ceci est un panier abandonné, pas une commande : il n'y a rien à encaisser.",
        },
        400,
      );
    if (order.status === "cancelled" || order.status === "voided")
      return c.json(
        {
          error: `La commande ${order.number} est annulée. Si de l'argent est arrivé pour elle, il est à rendre, pas à encaisser.`,
        },
        400,
      );
    // Une vente de stand naît déjà réglée, de la main à la main. Elle n'a rien
    // à encaisser après coup, et la confirmation que cette route enverrait
    // porterait les tarifs du site, que le stand cache justement.
    if (order.channel === "salon")
      return c.json(
        {
          error:
            "Une vente prise au stand est réglée sur place : elle est encaissée dès la vente, il n'y a rien à marquer ici.",
        },
        400,
      );
    // Idempotence : ce n'est PAS une erreur de cliquer deux fois, c'est même
    // le geste naturel quand la page a mis un instant à répondre. On répond
    // donc que c'est déjà fait, sans écrire un second encaissement.
    if (order.status === "paid")
      return c.json({
        ok: true,
        deja: true,
        message: `La commande ${order.number} était déjà marquée payée. Rien n'a été encaissé une seconde fois.`,
      });
    if (order.totalCents <= 0)
      return c.json(
        { error: "Cette commande ne vaut rien : il n'y a rien à encaisser." },
        400,
      );

    const cle = String(b.moyen ?? "").trim();
    const moyen = MOYENS_HORS_LIGNE[cle];
    if (!moyen)
      return c.json(
        {
          error:
            "Indiquez comment la cliente a réglé : virement, chèque, espèces, ou autre.",
        },
        400,
      );
    const reference = String(b.reference ?? "")
      .trim()
      .slice(0, 120);
    const auteur = String(b.author ?? "").trim() || null;

    /*
     * La référence sert à retrouver l'argent sur le relevé de banque. Elle
     * doit donc être unique : la même référence sur deux commandes est presque
     * toujours le même chèque saisi deux fois, et c'est justement ce qu'on
     * veut voir arrêté. Sans référence, on en fabrique une à partir de
     * l'identifiant de la commande — `markOrderPaid` s'en sert pour retrouver
     * la ligne de paiement qu'elle doit passer en « succeeded », et une
     * référence vide en aurait rattrapé n'importe laquelle.
     */
    const externalRef = reference || `manuel-${id}`;
    const [dejaPrise] = await db
      .select({
        numero: schema.orders.number,
        orderId: schema.payments.orderId,
      })
      .from(schema.payments)
      .innerJoin(schema.orders, eq(schema.payments.orderId, schema.orders.id))
      .where(eq(schema.payments.externalRef, externalRef));
    if (dejaPrise && dejaPrise.orderId !== id)
      return c.json(
        {
          error: `La référence « ${externalRef} » est déjà portée par la commande ${dejaPrise.numero}. Vérifiez que ce n'est pas le même règlement saisi deux fois.`,
        },
        400,
      );

    await db.insert(schema.payments).values({
      orderId: id,
      // « manuel », et surtout pas « stripe » : la page Finances rapproche les
      // encaissements de ce que les prestataires ont réellement pris, et une
      // ligne Stripe qui n'existe pas chez Stripe y ferait une anomalie
      // permanente. C'est aussi le mot que le remboursement hors ligne emploie
      // déjà, et que Finances sait afficher : « À la main (virement, espèces) ».
      provider: "manuel",
      externalRef,
      status: "pending",
      amountCents: order.totalCents,
    });

    // Le montant déclaré reçu est le total lu plus haut : si la commande a
    // bougé depuis — la cliente a modifié son panier, elle est revenue en
    // panier —, markOrderPaid ne valide rien.
    const encaissee = await markOrderPaid(id, "manuel", externalRef, {
      montantCents: order.totalCents,
      devise: "EUR",
    });
    if (!encaissee) {
      // La ligne de paiement posée à l'instant ne correspond à aucun
      // encaissement : la laisser « en attente » ferait croire à un règlement
      // en cours.
      await db
        .delete(schema.payments)
        .where(
          and(
            eq(schema.payments.orderId, id),
            eq(schema.payments.externalRef, externalRef),
            eq(schema.payments.status, "pending"),
          ),
        );
      const [maintenant] = await db
        .select({ status: schema.orders.status })
        .from(schema.orders)
        .where(eq(schema.orders.id, id));
      if (maintenant?.status === "paid")
        return c.json({
          ok: true,
          deja: true,
          message: `La commande ${order.number} était déjà marquée payée. Rien n'a été encaissé une seconde fois.`,
        });
      return c.json(
        {
          error: `La commande ${order.number} a changé pendant la saisie : la cliente a modifié son panier, et son total n'est plus ${(order.totalCents / 100).toFixed(2).replace(".", ",")} €. Rien n'a été encaissé. Rechargez la page pour voir ce qu'elle contient maintenant.`,
        },
        409,
      );
    }

    await db.insert(schema.orderEvents).values({
      orderId: id,
      kind: "event",
      author: auteur,
      message:
        `Encaissement de ${(order.totalCents / 100).toFixed(2).replace(".", ",")} € reçu par ${moyen}` +
        (reference ? ` (réf. ${reference})` : "") +
        `, saisi au back-office${auteur ? ` par ${auteur}` : ""}.`,
    });

    return c.json({
      ok: true,
      encaissee,
      montantCents: order.totalCents,
      moyen,
      reference: reference || null,
    });
  });

  /* ------------------------------------------------------------------ */
  /*  La facture                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * La facture d'une commande, en PDF.
   *
   * Le numéro se pose à la PREMIÈRE édition et ne bouge plus : rouvrir cette
   * adresse rend la même facture, portant le même numéro. C'est une obligation
   * légale autant qu'une commodité — la cliente qui réclame « sa » facture
   * doit recevoir celle qu'elle a déjà, pas une nouvelle.
   */
  app.get("/admin/orders/:id/facture.pdf", async (c) => {
    // Réservée à la propriétaire, et vérifiée ICI. Le garde-fou général du
    // serveur laisse passer les LECTURES d'un vendeur sous « /admin/orders »,
    // pour qu'il retrouve ses ventes de stand et leurs fichiers d'impression.
    // Or cette adresse-ci n'est pas une lecture ordinaire : elle rend
    // l'adresse postale d'une cliente du site, et surtout elle CONSOMME un
    // numéro de facture, ce qui n'est pas le geste de quelqu'un qui tient une
    // table un samedi après-midi.
    const user = c.get("utilisateur");
    if (user && user.role !== "owner")
      return c.json(
        { error: "Les factures sont réservées à la propriétaire." },
        403,
      );
    const id = Number(c.req.param("id"));
    // La facture sort dans la langue de la cliente, comme celle qui lui est
    // envoyée : la boutique télécharge le document que la cliente a, ou aura.
    // `?langue=fr` en demande une autre, pour la comptabilité par exemple.
    const facture = await composerLaFacture(id, langueLue(c.req.query("langue")));
    if ("erreur" in facture) return c.json({ error: facture.erreur }, facture.code);
    // « inline » : le PDF s'ouvre dans l'onglet, d'où il s'imprime et se
    // télécharge. Forcer le téléchargement obligerait à ouvrir le fichier pour
    // le relire, alors qu'on veut le plus souvent juste y jeter un œil.
    return new Response(new Uint8Array(facture.pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${facture.nomFichier}"`,
      },
    });
  });

  /** Envoie la facture à la cliente, en pièce jointe. */
  app.post("/admin/orders/:id/facture/envoyer", async (c) => {
    const id = Number(c.req.param("id"));
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!mailConfigure())
      return c.json(
        {
          error:
            "L'envoi d'e-mails n'est pas configuré : la facture ne partirait nulle part. Elle reste téléchargeable depuis la fiche.",
        },
        503,
      );

    const facture = await composerLaFacture(id);
    if ("erreur" in facture) return c.json({ error: facture.erreur }, facture.code);
    if (!facture.clientEmail)
      return c.json(
        {
          error:
            "Cette commande n'a pas d'adresse e-mail : la facture ne peut pas partir. Elle reste téléchargeable depuis la fiche.",
        },
        400,
      );

    // Le courrier et le PDF joint, dans la même langue : celle de la cliente.
    const courrier = courrierFacture({
      langue: facture.langue,
      prenomClient: facture.prenomClient,
      numero: facture.numeroCommande,
      numeroFacture: facture.numeroFacture,
      totalCents: facture.totalCents,
      dejaPayee: facture.dejaPayee,
    });
    const parti = await envoyerCourrier({
      ...courrier,
      to: facture.clientEmail,
      pieces: [
        {
          nomFichier: facture.nomFichier,
          contenu: facture.pdf.toString("base64"),
          type: "application/pdf",
        },
      ],
    });

    await db.insert(schema.orderEvents).values({
      orderId: id,
      kind: "event",
      author: String(b.author ?? "").trim() || null,
      message: parti
        ? `Facture ${facture.numeroFacture} envoyée à ${facture.clientEmail}.`
        : `La facture ${facture.numeroFacture} n'a pas pu partir vers ${facture.clientEmail}.`,
    });

    if (!parti)
      return c.json(
        {
          error: `La facture ${facture.numeroFacture} n'a pas pu partir vers ${facture.clientEmail}. Le numéro reste attribué : réessayez, la même facture repartira.`,
        },
        502,
      );
    return c.json({
      ok: true,
      numeroFacture: facture.numeroFacture,
      destinataire: facture.clientEmail,
    });
  });

  /**
   * Attribue le numéro de facture d'une commande, ou rend celui qu'elle a.
   *
   * Le compteur et le numéro s'écrivent DANS LA MÊME TRANSACTION, et la ligne
   * du compteur est verrouillée le temps de l'opération (`for update`) : deux
   * factures demandées au même instant se rangent alors l'une derrière
   * l'autre au lieu de tirer le même numéro. Si quoi que ce soit échoue, les
   * deux écritures reviennent en arrière ensemble et le numéro reste libre —
   * c'est ainsi, et pas autrement, qu'une suite reste sans trou.
   */
  async function numeroterLaFacture(
    orderId: number,
  ): Promise<{ numero: string; emiseLe: Date }> {
    return db.transaction(async (tx) => {
      const [commande] = await tx
        .select({
          numero: schema.orders.invoiceNumber,
          emiseLe: schema.orders.invoicedAt,
        })
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId));
      if (commande?.numero)
        return { numero: commande.numero, emiseLe: commande.emiseLe ?? new Date() };

      const maintenant = new Date();
      const annee = maintenant.getFullYear();
      // « on conflict do update » plutôt que « do nothing » : c'est ce qui
      // rend la ligne verrouillée même quand elle existait déjà, et donc ce
      // qui sérialise deux demandes simultanées.
      const [compteur] = await tx
        .insert(schema.factureCompteur)
        .values({ annee, dernierNumero: 1 })
        .onConflictDoUpdate({
          target: schema.factureCompteur.annee,
          set: {
            dernierNumero: raw`${schema.factureCompteur.dernierNumero} + 1`,
            majLe: maintenant,
          },
        })
        .returning({ n: schema.factureCompteur.dernierNumero });

      const numero = `F${annee}-${String(compteur!.n).padStart(4, "0")}`;
      await tx
        .update(schema.orders)
        .set({ invoiceNumber: numero, invoicedAt: maintenant })
        .where(eq(schema.orders.id, orderId));
      return { numero, emiseLe: maintenant };
    });
  }

  /**
   * Tout ce qu'il faut pour éditer OU envoyer la facture, composé une fois.
   *
   * Les deux routes en ont besoin des mêmes données, et surtout du même PDF :
   * en fabriquer deux, l'un pour l'écran et l'autre pour la pièce jointe,
   * aurait fini par en donner deux qui ne disent pas la même chose.
   *
   * Dans la langue de la cliente (`langueDuDestinataire`), sauf `langueVoulue`
   * explicite. Les montants et les dates suivent ; la mention de TVA reste en
   * français, sa traduction dessous (voir renderInvoicePdf).
   */
  async function composerLaFacture(
    orderId: number,
    langueVoulue: Langue | null = null,
  ): Promise<
    | { erreur: string; code: 400 | 404 }
    | {
        pdf: Buffer;
        nomFichier: string;
        numeroFacture: string;
        numeroCommande: string;
        totalCents: number;
        dejaPayee: boolean;
        clientEmail: string | null;
        prenomClient: string;
        langue: Langue;
      }
  > {
    if (!Number.isInteger(orderId) || orderId <= 0)
      return { erreur: "commande inconnue", code: 400 };
    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId));
    if (!order) return { erreur: "Cette commande n'existe pas.", code: 404 };
    // Un panier n'a rien à facturer : personne n'a commandé, personne ne doit
    // rien. Lui donner un numéro le prendrait dans la suite des factures, et
    // ce numéro serait perdu pour de bon.
    if (order.status === "draft")
      return {
        erreur:
          "Ceci est un panier abandonné, pas une commande : il n'y a rien à facturer.",
        code: 400,
      };

    const { numero: numeroFacture, emiseLe } = await numeroterLaFacture(orderId);

    const [client] = order.customerId
      ? await db
          .select()
          .from(schema.customers)
          .where(eq(schema.customers.id, order.customerId))
      : [];
    const articles = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId));
    const cadres = await db.select().from(schema.frames);
    const langue =
      langueVoulue ??
      langueDuDestinataire({ compte: client?.langue, commande: order.langue });
    const t = tc(langue);

    const lignes: LigneFacture[] = articles.map((it) => {
      const cfg = (it.config ?? {}) as Record<string, unknown>;
      const cadre = cadres.find((f) => String(f.id) === String(cfg.frameId ?? ""));
      return {
        designation: it.title ?? t("lignes.titreParDefaut"),
        precision:
          [
            typeof cfg.format === "string" ? t("lignes.format", { format: cfg.format }) : null,
            cadre ? (nomTraduit(cadre.translations, langue) ?? cadre.name) : null,
          ]
            .filter(Boolean)
            .join(" · ") || null,
        // Le texte imprimé sur l'affiche, comme sur le bon de préparation :
        // c'est lui qui distingue deux lignes de même titre et de même prix.
        lignesAffiche: lignesRemplies(cfg.texts as TextesAffiche | undefined)
          .map((l) => l.value.trim())
          .filter(Boolean),
        quantite: it.quantity,
        unitPriceCents: it.unitPriceCents,
      };
    });

    const sousTotal = lignes.reduce(
      (s, l) => s + l.unitPriceCents * l.quantite,
      0,
    );
    const port = order.shippingCents ?? 0;
    const resume = (await resumeCommandes([orderId])).get(orderId)!;

    // L'identité légale de la boutique : adresse postale et SIRET sont
    // OBLIGATOIRES sur une facture. Elles ne vivent nulle part dans ce projet ;
    // on les lit dans les réglages pour qu'il y ait un endroit où les poser, et
    // on ne les invente pas quand elles manquent — une facture incomplète se
    // corrige, une facture qui ment se paie.
    const reglages = await db
      .select()
      .from(schema.settings)
      .where(inArray(schema.settings.key, ["facture.adresse", "facture.siret"]));
    const valeur = (cle: string): string =>
      String(reglages.find((r) => r.key === cle)?.value ?? "").trim();

    const pdf = await renderInvoicePdf({
      langue,
      numeroFacture,
      dateFacture: emiseLe,
      numeroCommande: order.number,
      dateCommande: order.createdAt,
      clientNom: order.shippingName ?? client?.name ?? t("facturePdf.clientParDefaut"),
      clientEmail: client?.email ?? null,
      clientAdresse: [
        order.relayPointLabel,
        order.shippingLine1,
        order.shippingLine2,
        [order.shippingPostalCode, order.shippingCity].filter(Boolean).join(" "),
        order.shippingCountry,
      ].filter((v): v is string => Boolean(v)),
      lignes,
      // La remise se DÉDUIT de ce qui a été facturé, comme partout ailleurs :
      // c'est le montant encaissé qui fait foi, pas un recalcul.
      remiseCents: Math.max(0, sousTotal + port - order.totalCents),
      codePromo: order.promoCode,
      portCents: port,
      // Le nom français reste sur la commande ; la facture d'une cliente
      // étrangère porte celui de sa langue, quand la boutique l'a traduit.
      modeLivraison: (await livraisonDansLaLangue(order, langue)).nom,
      totalCents: order.totalCents,
      rembourseCents: resume.rembourseCents,
      mentionReglement: mentionDeReglement(order, langue),
      adresseBoutique: valeur("facture.adresse")
        ? valeur("facture.adresse").split("\n")
        : null,
      siret: valeur("facture.siret") || null,
      // Une commande annulée après avoir été facturée garde sa facture et son
      // numéro — le trou serait pire —, mais le papier doit dire lui-même
      // qu'elle ne vaut plus.
      filigrane:
        order.status === "cancelled" || order.status === "voided"
          ? t("facturePdf.filigrane")
          : null,
    });

    return {
      pdf,
      nomFichier: `${t("facturePdf.nomFichier")}_${numeroFacture}_${order.number}.pdf`,
      numeroFacture,
      numeroCommande: order.number,
      totalCents: order.totalCents,
      dejaPayee: order.status === "paid",
      clientEmail: client?.email ?? null,
      prenomClient: (client?.name ?? "").split(" ")[0] || t("commun.prenomParDefaut"),
      langue,
    };
  }

  /**
   * « Commande réglée. Facture acquittée. », ou ce qui en tient lieu, dans la
   * langue de la facture.
   */
  function mentionDeReglement(
    order: typeof schema.orders.$inferSelect,
    langue: Langue = "fr",
  ): string {
    const t = tc(langue);
    if (order.status === "cancelled" || order.status === "voided")
      return `${
        order.cancelledAt
          ? t("facturePdf.annuleeLe", { date: dateCourte(langue, order.cancelledAt) })
          : t("facturePdf.annulee")
      }${order.cancelReason ? ` — ${motifDansLaLangue(order.cancelReason, langue)}` : ""}.`;
    if (order.status === "paid") return t("facturePdf.reglee");
    return t("facturePdf.nonReglee");
  }

  /**
   * Le motif d'annulation gardé sur la commande, dans la langue de la facture.
   *
   * La commande ne garde que la phrase du journal, en français : « Demande de
   * la cliente », suivie le cas échéant de « — » et de la précision saisie.
   * Le libellé de la liste se retrouve donc au début, et se traduit comme
   * dans le courrier d'annulation ; la précision, écrite par la boutique,
   * reste telle quelle. Une facture allemande ne doit pas porter un motif en
   * français quand le courrier qui l'accompagne l'a écrit en allemand.
   */
  function motifDansLaLangue(motif: string, langue: Langue): string {
    if (langue === "fr") return motif;
    for (const cle of Object.values(MOTIFS_ANNULATION)) {
      if (!cle) continue;
      const francais = tc("fr")(cle);
      if (motif === francais) return tc(langue)(cle);
      if (motif.startsWith(`${francais} — `))
        return `${tc(langue)(cle)}${motif.slice(francais.length)}`;
    }
    return motif;
  }
}
