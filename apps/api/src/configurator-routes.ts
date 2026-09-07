/**
 * Routes du configurateur, du panier, des commandes web et des PDF.
 *
 * - Lecture publique : /characters, /backgrounds (alimentent le configurateur).
 * - Panier : /cart (création/maj de lignes éditables — §18.3).
 * - Commandes web : POST /orders (canal 'web', §11), génère le PDF (§12/§15).
 * - PDF : /print-files/:orderItemId (téléchargement à tout moment — §12).
 * - CRUD personnages/assets (BO, protégé /admin/*) : §18.1 A/D/E.
 *
 * Le wiring d'auth /admin/* est posé dans index.ts ; ici on définit les
 * handlers, montés via `mountConfiguratorRoutes(app)`.
 */
import type { Hono } from "hono";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  notInArray,
  sql,
} from "drizzle-orm";
import { db, schema } from "./db/client.js";
import { renderPosterPdf, type ResolveData } from "./pdf.js";
import {
  posterConfigSchema,
  totalPanierCents,
  type PosterConfig,
} from "@memoryline/types";
import {
  createPaypalOrder,
  capturePaypalOrder,
  createStripeIntent,
  getStripeIntentStatus,
  paypalConfigured,
  stripeConfigured,
  verifyStripeEvent,
} from "./payments.js";

// --- Helpers -----------------------------------------------------------------

/** Slugifie un nom client pour un nom de fichier sûr mais lisible (§15.3). */
function slugifyName(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "client"
  );
}

/**
 * Prochaine numérotation de commande par canal (WEB-xxxx / SAL-xxxx).
 * On prend le MAX du suffixe numérique parmi les numéros bien formés du canal
 * (ignore les DRAFT- et numéros legacy non conformes) — robuste aux historiques.
 * Retry intégré côté appelant non nécessaire : un index unique protège déjà.
 */
async function nextOrderNumber(channel: "web" | "salon"): Promise<string> {
  const prefix = channel === "web" ? "WEB-" : "SAL-";
  const rows = await db
    .select({ n: schema.orders.number })
    .from(schema.orders)
    .where(eq(schema.orders.channel, channel));
  let max = 0;
  for (const r of rows) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(r.n);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return prefix + String(max + 1).padStart(4, "0");
}

/** Charge les données nécessaires au rendu PDF d'un snapshot. */
async function buildResolveData(): Promise<ResolveData> {
  const assets = await db.select().from(schema.assets);
  const backgrounds = await db.select().from(schema.backgrounds);
  const types = await db.select().from(schema.characterTypes);
  const assetMap = new Map<string, any>();
  for (const a of assets)
    assetMap.set(String(a.id), {
      id: a.id,
      slot: a.slot,
      svgUrl: a.svgUrl,
      colorZones: a.colorZones,
      position: a.position,
    });
  // Personnages (SVG de base pré-composé) pour le rendu PDF du nouveau modèle.
  const charMap = new Map<string, any>();
  for (const t of types)
    charMap.set(String(t.id), {
      id: t.id,
      baseSvgUrl: t.baseSvgUrl,
      baseColorZones: t.baseColorZones,
      bottomPct: t.bottomPct ?? 1,
    });
  const bgMap = new Map<string, any>();
  for (const b of backgrounds)
    bgMap.set(String(b.id), { id: b.id, url: b.url });
  return { assets: assetMap, characters: charMap, backgrounds: bgMap };
}

/** Génère le PDF d'une ligne de commande et l'enregistre (print_file). */
async function generatePrintFile(
  orderItemId: number,
  config: PosterConfig,
  customerName: string,
  orderNumber: string,
  format: "A4" | "A3",
): Promise<{ filename: string }> {
  const data = await buildResolveData();
  const pdf = await renderPosterPdf(config, { data, format });
  const filename = `${slugifyName(customerName)}_${orderNumber}.pdf`;
  // Stockage : en l'absence de R2 configuré en dev, on dépose le binaire en
  // base via une route à la demande (régénérable). Ici on garde la trace.
  await db
    .insert(schema.printFiles)
    .values({
      orderItemId,
      url: `/print-files/${orderItemId}`,
      filename,
      format,
    })
    .onConflictDoNothing();
  return { filename };
}

// --- Tarification & paiement -------------------------------------------------

/** Ligne de commande minimale pour le calcul de prix. */
type PricedItem = {
  unitPriceCents: number;
  quantity: number;
  config: unknown;
};

/**
 * Prix unitaire d'une ligne, en centimes — RÉSOLU CÔTÉ SERVEUR depuis le
 * catalogue. Le navigateur envoie bien un `unitPriceCents` (il doit l'afficher),
 * mais on ne le lit JAMAIS : sinon un POST forgé fixerait librement le montant
 * encaissé. Miroir de priceForConfig() côté web : prix de la variante du format
 * demandé, à défaut le prix de base du produit.
 */
async function resolveUnitPriceCents(
  productId: number | null | undefined,
  format: string | null | undefined,
  frameId?: string | number | null,
): Promise<number> {
  if (productId == null || !Number.isFinite(productId)) return 0;
  const [product] = await db
    .select({ basePriceCents: schema.products.basePriceCents })
    .from(schema.products)
    .where(eq(schema.products.id, productId));
  if (!product) return 0;
  const [variant] = await db
    .select({ priceCents: schema.variants.priceCents })
    .from(schema.variants)
    .where(
      and(
        eq(schema.variants.productId, productId),
        eq(schema.variants.format, format ?? "A4"),
      ),
    );
  const affiche = variant?.priceCents ?? product.basePriceCents;

  // Supplément du cadre, relu au catalogue lui aussi : le navigateur n'a
  // jamais son mot à dire sur un montant.
  let cadre = 0;
  if (frameId != null && frameId !== "") {
    const [f] = await db
      .select({ priceCents: schema.frames.priceCents })
      .from(schema.frames)
      .where(
        and(
          eq(schema.frames.id, Number(frameId)),
          eq(schema.frames.active, true),
        ),
      );
    cadre = f?.priceCents ?? 0;
  }
  return affiche + cadre;
}

/**
 * Charge une ligne de panier EN VÉRIFIANT qu'elle appartient bien au panier
 * `cartId`. Sans ce contrôle, l'id de ligne (entier séquentiel) suffirait à
 * modifier ou supprimer la ligne du panier de quelqu'un d'autre.
 */
async function loadCartItem(cartId: string, itemId: number) {
  if (!Number.isFinite(itemId)) return null;
  const [order] = await db
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .where(eq(schema.orders.clientOrderId, cartId));
  if (!order) return null;
  const [item] = await db
    .select()
    .from(schema.orderItems)
    .where(
      and(
        eq(schema.orderItems.id, itemId),
        eq(schema.orderItems.orderId, order.id),
      ),
    );
  return item ?? null;
}

/**
 * Total à FACTURER en centimes, remises comprises — calculé côté SERVEUR (le
 * montant envoyé par le navigateur n'est jamais de confiance).
 *
 * Le calcul lui-même vit dans @memoryline/types : le panier et le tunnel de
 * commande utilisent EXACTEMENT la même fonction, donc le montant affiché au
 * client et le montant encaissé ne peuvent plus diverger.
 */
async function computeOrderTotalCents(items: PricedItem[]): Promise<number> {
  const rules = await db.select().from(schema.promoRules);
  const lignes = items.map((it) => ({
    unitPriceCents: it.unitPriceCents,
    quantity: it.quantity,
    format:
      (it.config as { format?: string } | null)?.format ?? null,
  }));
  return totalPanierCents(lignes, rules);
}

/**
 * Passe une commande de `pending` à `paid` et génère les PDF — UNE SEULE FOIS
 * (idempotent : appelé par le webhook Stripe ou la capture PayPal, qui peuvent
 * rejouer). Met aussi à jour la ligne `payment` correspondante en `succeeded`.
 * No-op si la commande est déjà payée. Renvoie true si elle vient d'être payée.
 */
async function markOrderPaid(
  orderId: number,
  provider: "stripe" | "paypal",
  externalRef: string,
): Promise<boolean> {
  const [order] = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId));
  if (!order) return false;

  // Trace le paiement (idempotent sur externalRef).
  await db
    .update(schema.payments)
    .set({ status: "succeeded" })
    .where(eq(schema.payments.externalRef, externalRef));

  if (order.status === "paid") return false; // déjà fait

  await db
    .update(schema.orders)
    .set({ status: "paid" })
    .where(eq(schema.orders.id, orderId));

  // Nom client (pour le nom de fichier PDF).
  let customerName = "client";
  if (order.customerId != null) {
    const [cust] = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, order.customerId));
    if (cust?.name) customerName = cust.name;
  }

  const items = await db
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, orderId));
  for (const it of items) {
    const cfg = it.config as PosterConfig | null;
    if (!cfg) continue;
    const fmt = (cfg.format ?? "A4") as "A4" | "A3";
    try {
      await generatePrintFile(it.id, cfg, customerName, order.number, fmt);
    } catch (e) {
      console.error("PDF génération échouée (item " + it.id + ") :", e);
    }
  }
  return true;
}

// --- Montage des routes -------------------------------------------------------

export function mountConfiguratorRoutes(app: Hono) {
  // === Données configurateur (public) ====================================

  /**
   * Bibliothèque du configurateur (architecture fidèle à memoryline.fr) :
   *  - `characters` : les personnages à AJOUTER (Homme/Femme/Bébé/Animal…),
   *    chacun avec son SVG complet de base (baseSvgUrl) et ses couleurs.
   *  - `slots` : les variantes interchangeables GÉNÉRIQUES, regroupées par
   *    vue (front/back) puis par slot (clothes/pants/hair/accessory).
   * Le client choisit un personnage, puis change ses vêtements/cheveux/etc.
   * en piochant dans `slots`, et recolore via les zones .stN.
   */
  app.get("/characters", async (c) => {
    const includeArchived = c.req.query("all") === "1";
    // La catégorie vient de la table character_category (jointure), mais le
    // contrat exposé au front ne change pas : `category` reste son NOM.
    // L'ordre suit la position des catégories, puis celle des personnages.
    const types = await db
      .select({
        t: schema.characterTypes,
        categoryName: schema.characterCategories.name,
        categoryPosition: schema.characterCategories.position,
      })
      .from(schema.characterTypes)
      .leftJoin(
        schema.characterCategories,
        eq(schema.characterTypes.categoryId, schema.characterCategories.id),
      )
      .where(includeArchived ? undefined : isNull(schema.characterTypes.archivedAt))
      .orderBy(
        asc(schema.characterCategories.position),
        asc(schema.characterTypes.position),
      );

    // Variantes génériques (character_type_id IS NULL), partagées par tous.
    const variants = await db
      .select()
      .from(schema.assets)
      // Génériques ET non archivées : une pièce archivée disparaît du
      // configurateur, mais reste en base pour les réimpressions.
      .where(
        and(
          isNull(schema.assets.characterTypeId),
          isNull(schema.assets.archivedAt),
        ),
      )
      .orderBy(asc(schema.assets.position));
    const slots: Record<string, Record<string, unknown[]>> = {
      front: {},
      back: {},
    };
    for (const a of variants) {
      const view = a.view === "back" ? "back" : "front";
      (slots[view]![a.slot] ??= []).push({
        id: a.id,
        slot: a.slot,
        name: a.name,
        svgUrl: a.svgUrl,
        view,
        colorZones: a.colorZones,
        position: a.position,
      });
    }

    return c.json({
      characters: types.map(({ t, categoryName }) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        category: categoryName ?? null,
        categoryId: t.categoryId,
        position: t.position,
        archived: t.archivedAt != null,
        baseSvgUrl: t.baseSvgUrl,
        baseColorZones: t.baseColorZones,
        orientation: t.orientation === "back" ? "back" : "front",
        bottomPct: t.bottomPct ?? 1,
        // Ids d'ancienne config par slot (= asset.position des génériques) :
        // le front restreint les galeries de l'éditeur à ces variantes.
        slotVariants: t.slotVariants ?? null,
      })),
      slots,
    });
  });

  /**
   * Fonds proposés dans le configurateur POUR UN PRODUIT DONNÉ.
   *
   * Exigence cliente : ouvrir le configurateur depuis la fiche "Amiens" doit
   * proposer l'affiche d'Amiens — pas toute la bibliothèque.
   *
   * Stratégie en cascade (la 1re non vide gagne) :
   *  1. fonds explicitement rattachés (`background.product_id`),
   *  2. à défaut, fonds dont le NOM correspond à la VILLE du produit
   *     (ex. produit "AMIENS Cathédrale" -> fonds dont le nom commence par
   *     "AMIENS"). Couvre les fonds non encore rattachés en base.
   *  3. en tout dernier recours seulement, la bibliothèque complète
   *     (un produit sans aucun fond identifiable garde de quoi composer).
   * Le 1er fond renvoyé est le fond "par défaut" présélectionné côté UI.
   */
  app.get("/backgrounds", async (c) => {
    const productId = c.req.query("productId");
    const project = (b: typeof schema.backgrounds.$inferSelect) => ({
      id: b.id,
      url: b.url,
      name: b.name,
      position: b.position,
    });

    if (productId) {
      // 1. rattachement explicite
      const linked = await db
        .select()
        .from(schema.backgrounds)
        .where(eq(schema.backgrounds.productId, Number(productId)))
        .orderBy(asc(schema.backgrounds.position));
      if (linked.length > 0) return c.json(linked.map(project));

      // 2. correspondance par ville (nom du produit)
      const [product] = await db
        .select({ name: schema.products.name })
        .from(schema.products)
        .where(eq(schema.products.id, Number(productId)));
      if (product) {
        const norm = (s: string | null) =>
          (s ?? "").toUpperCase().normalize("NFD").replace(/[^A-Z0-9]/g, "");
        // On dérive des mots-clés candidats du nom produit (avant le tiret),
        // en sautant les articles ("LE Tréport" -> "TREPORT"). On essaie chaque
        // candidat et on garde le PREMIER qui correspond à des fonds : ça gère
        // "AMIENS Cathédrale" (-> AMIENS), "LE TRÉPORT Phare" (-> TREPORT) et
        // "ITALIE Venise" (fond nommé ITALIE) sans liste de villes en dur.
        const STOP = new Set(["LE", "LA", "LES", "DU", "DE", "DES", "AFFICHE"]);
        const candidates = product.name
          .split(/[-–]/)[0]!
          .trim()
          .split(/\s+/)
          .map(norm)
          .filter((w) => w.length >= 3 && !STOP.has(w));
        if (candidates.length > 0) {
          const all = await db
            .select()
            .from(schema.backgrounds)
            .orderBy(asc(schema.backgrounds.position));
          // `includes` plutôt que `startsWith` : le nom du fond peut être
          // préfixé par l'article ("LE_TOUQUET_..." pour le candidat "TOUQUET").
          for (const cand of candidates) {
            const cityMatch = all.filter((b) => norm(b.name).includes(cand));
            if (cityMatch.length > 0) return c.json(cityMatch.map(project));
          }
        }
      }
    }

    // 3. repli : bibliothèque complète (jamais vide)
    const rows = await db
      .select()
      .from(schema.backgrounds)
      .orderBy(asc(schema.backgrounds.position))
      .limit(500);
    return c.json(rows.map(project));
  });

  // === Panier (lignes éditables — §18.3) ==================================
  // Panier minimal côté API : une commande 'draft' web sert de panier ; les
  // lignes portent le snapshot config et sont MODIFIABLES tant que draft.

  /** Crée/relit un panier (draft) par clientCartId, renvoie ses lignes. */
  app.get("/cart/:cartId", async (c) => {
    const cartId = c.req.param("cartId");
    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.clientOrderId, cartId));
    if (!order) return c.json({ cartId, items: [] });
    const items = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, order.id));
    return c.json({ cartId, orderId: order.id, status: order.status, items });
  });

  /** Ajoute une ligne au panier (crée le draft si besoin). */
  app.post("/cart/:cartId/items", async (c) => {
    const cartId = c.req.param("cartId");
    const body = await c.req.json();
    const parsed = posterConfigSchema.safeParse(body.config);
    if (!parsed.success)
      return c.json({ error: "config invalide", details: parsed.error.issues }, 400);

    let [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.clientOrderId, cartId));
    if (!order) {
      [order] = await db
        .insert(schema.orders)
        .values({
          channel: "web",
          number: `DRAFT-${cartId.slice(0, 8)}`,
          clientOrderId: cartId,
          status: "draft",
          totalCents: 0,
        })
        .returning();
    }
    const productId = body.productId != null ? Number(body.productId) : null;
    const unitPriceCents = await resolveUnitPriceCents(
      productId,
      parsed.data.format,
      parsed.data.frameId,
    );
    const [item] = await db
      .insert(schema.orderItems)
      .values({
        orderId: order!.id,
        productId,
        variantId: body.variantId ?? null,
        config: parsed.data,
        title: body.title ?? null,
        unitPriceCents,
        quantity: Math.max(1, Number(body.quantity ?? 1)),
      })
      .returning();
    return c.json(item);
  });

  /** MODIFIE une ligne existante (réouverture configurateur — §18.3 I). */
  app.put("/cart/:cartId/items/:itemId", async (c) => {
    const itemId = Number(c.req.param("itemId"));
    const body = await c.req.json();
    const parsed = posterConfigSchema.safeParse(body.config);
    if (!parsed.success)
      return c.json({ error: "config invalide", details: parsed.error.issues }, 400);
    const current = await loadCartItem(c.req.param("cartId"), itemId);
    if (!current) return c.notFound();
    const unitPriceCents = await resolveUnitPriceCents(
      current.productId,
      parsed.data.format,
      parsed.data.frameId,
    );
    const [item] = await db
      .update(schema.orderItems)
      .set({
        config: parsed.data,
        variantId: body.variantId ?? undefined,
        unitPriceCents,
        quantity:
          body.quantity != null
            ? Math.max(1, Number(body.quantity))
            : undefined,
      })
      .where(eq(schema.orderItems.id, itemId))
      .returning();
    if (!item) return c.notFound();
    return c.json(item);
  });

  /** Supprime une ligne du panier. */
  app.delete("/cart/:cartId/items/:itemId", async (c) => {
    const item = await loadCartItem(
      c.req.param("cartId"),
      Number(c.req.param("itemId")),
    );
    if (!item) return c.notFound();
    await db.delete(schema.orderItems).where(eq(schema.orderItems.id, item.id));
    return c.json({ ok: true });
  });

  // === Validation de commande web =========================================

  /**
   * Prépare une commande web à PAYER à partir du panier draft.
   *
   * Attache le client + un numéro, fige le total (promos incluses, calculé
   * SERVEUR) et passe la commande en `pending`. Le PDF et le passage en `paid`
   * ne se font QU'APRÈS encaissement (webhook Stripe / capture PayPal, via
   * markOrderPaid). Une commande n'est donc JAMAIS marquée payée sans paiement.
   *
   * Idempotent : relançable tant que non payée (met à jour client + total,
   * garde le numéro). Renvoie 409 si la commande est déjà payée.
   */
  app.post("/orders", async (c) => {
    const body = await c.req.json();
    const cartId = String(body.cartId ?? "");
    const name = String(body.customer?.name ?? "").trim();
    const email = String(body.customer?.email ?? "").trim();
    if (!name || !email)
      return c.json({ error: "nom et email requis" }, 400);

    const [draft] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.clientOrderId, cartId));
    if (!draft) return c.json({ error: "panier introuvable" }, 404);
    if (draft.status === "paid")
      return c.json({ error: "commande déjà payée" }, 409);

    const items = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, draft.id));
    if (items.length === 0) return c.json({ error: "panier vide" }, 400);

    const [customer] = await db
      .insert(schema.customers)
      .values({ name, email })
      .returning();
    // Garde le numéro s'il en a déjà un (retry) ; sinon en attribue un.
    const number = /^WEB-\d+$/.test(draft.number)
      ? draft.number
      : await nextOrderNumber("web");
    const total = await computeOrderTotalCents(items);
    const [order] = await db
      .update(schema.orders)
      .set({
        number,
        status: "pending",
        customerId: customer!.id,
        totalCents: total,
      })
      .where(eq(schema.orders.id, draft.id))
      .returning();

    return c.json({
      orderId: order!.id,
      number,
      status: order!.status,
      totalCents: total,
    });
  });

  // === Paiement (Stripe & PayPal) =========================================

  /**
   * Config paiement exposée au NAVIGATEUR : quels moyens sont réellement
   * activés + les clés PUBLIQUES nécessaires côté client (clé publiable Stripe,
   * client-id PayPal). Évite d'avoir à câbler des PUBLIC_* dans le conteneur
   * web : l'API (qui lit le .env racine) est la source de vérité.
   * Un moyen n'est "prêt" que si SES clés serveur ET publique sont présentes.
   */
  app.get("/payments/config", (c) => {
    const stripePublicKey = process.env.PUBLIC_STRIPE_KEY ?? "";
    const paypalClientId =
      process.env.PUBLIC_PAYPAL_CLIENT_ID ?? process.env.PAYPAL_CLIENT_ID ?? "";
    return c.json({
      stripe:
        stripeConfigured && stripePublicKey
          ? { publicKey: stripePublicKey }
          : null,
      paypal:
        paypalConfigured && paypalClientId ? { clientId: paypalClientId } : null,
    });
  });

  /** Charge une commande à payer (existe, non déjà payée). */
  async function loadPayableOrder(orderId: number) {
    if (!Number.isFinite(orderId)) return null;
    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId));
    return order ?? null;
  }

  /**
   * Crée un PaymentIntent Stripe pour la commande et renvoie son clientSecret
   * (le navigateur confirme le paiement avec Stripe.js). Le montant vient du
   * SERVEUR (order.totalCents), jamais du client.
   */
  app.post("/payments/stripe/intent", async (c) => {
    if (!stripeConfigured)
      return c.json({ error: "Stripe non configuré" }, 503);
    const body = await c.req.json().catch(() => ({}));
    const order = await loadPayableOrder(Number(body.orderId));
    if (!order) return c.json({ error: "commande introuvable" }, 404);
    if (order.status === "paid")
      return c.json({ error: "commande déjà payée" }, 409);
    try {
      const intent = await createStripeIntent(
        order.totalCents,
        order.id,
        order.number,
      );
      await db.insert(schema.payments).values({
        orderId: order.id,
        provider: "stripe",
        externalRef: intent.id,
        status: "pending",
        amountCents: order.totalCents,
      });
      return c.json({ clientSecret: intent.clientSecret });
    } catch (e) {
      console.error("Stripe intent:", e);
      return c.json({ error: "création du paiement impossible" }, 502);
    }
  });

  /**
   * Webhook Stripe : source de vérité de l'encaissement. Vérifie la signature
   * sur le corps BRUT, et sur `payment_intent.succeeded` passe la commande en
   * payée + génère les PDF (idempotent).
   */
  app.post("/payments/stripe/webhook", async (c) => {
    const raw = await c.req.text();
    const event = verifyStripeEvent(raw, c.req.header("stripe-signature"));
    if (!event) return c.json({ error: "signature invalide" }, 400);
    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object as {
        id: string;
        metadata?: { orderId?: string };
      };
      const orderId = Number(pi.metadata?.orderId);
      if (Number.isFinite(orderId)) {
        await markOrderPaid(orderId, "stripe", pi.id);
      }
    }
    return c.json({ received: true });
  });

  /**
   * Confirme un paiement Stripe DEPUIS LE SERVEUR (revérifie le statut du
   * PaymentIntent auprès de Stripe) et marque la commande payée si succeeded.
   * Appelé par le navigateur juste après confirmPayment : permet de finaliser
   * SANS webhook (dev) et sert de filet si le webhook n'arrive pas.
   */
  app.post("/payments/stripe/confirm", async (c) => {
    if (!stripeConfigured)
      return c.json({ error: "Stripe non configuré" }, 503);
    const body = await c.req.json().catch(() => ({}));
    const orderId = Number(body.orderId);
    const [payment] = await db
      .select()
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.orderId, orderId),
          eq(schema.payments.provider, "stripe"),
        ),
      )
      .orderBy(desc(schema.payments.id));
    if (!payment?.externalRef)
      return c.json({ error: "paiement introuvable" }, 404);
    try {
      const status = await getStripeIntentStatus(payment.externalRef);
      if (status === "succeeded") {
        await markOrderPaid(orderId, "stripe", payment.externalRef);
        return c.json({ status: "paid" });
      }
      return c.json({ status }, 202);
    } catch (e) {
      console.error("Stripe confirm:", e);
      return c.json({ error: "vérification impossible" }, 502);
    }
  });

  /**
   * Crée une commande PayPal (montant serveur) à approuver côté navigateur.
   * Renvoie l'id PayPal. La capture (encaissement) se fait ensuite via
   * /payments/paypal/capture.
   */
  app.post("/payments/paypal/order", async (c) => {
    if (!paypalConfigured)
      return c.json({ error: "PayPal non configuré" }, 503);
    const body = await c.req.json().catch(() => ({}));
    const order = await loadPayableOrder(Number(body.orderId));
    if (!order) return c.json({ error: "commande introuvable" }, 404);
    if (order.status === "paid")
      return c.json({ error: "commande déjà payée" }, 409);
    try {
      const paypalOrderId = await createPaypalOrder(
        order.totalCents,
        order.number,
      );
      await db.insert(schema.payments).values({
        orderId: order.id,
        provider: "paypal",
        externalRef: paypalOrderId,
        status: "pending",
        amountCents: order.totalCents,
      });
      return c.json({ paypalOrderId });
    } catch (e) {
      console.error("PayPal order:", e);
      return c.json({ error: "création du paiement impossible" }, 502);
    }
  });

  /**
   * Capture une commande PayPal approuvée. On vérifie que le `paypalOrderId`
   * appartient bien à cette commande (ligne payment), puis on capture : si
   * COMPLETED, la commande passe en payée + PDF (markOrderPaid).
   */
  app.post("/payments/paypal/capture", async (c) => {
    if (!paypalConfigured)
      return c.json({ error: "PayPal non configuré" }, 503);
    const body = await c.req.json().catch(() => ({}));
    const orderId = Number(body.orderId);
    const paypalOrderId = String(body.paypalOrderId ?? "");
    const [payment] = await db
      .select()
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.orderId, orderId),
          eq(schema.payments.externalRef, paypalOrderId),
        ),
      );
    if (!payment)
      return c.json({ error: "paiement introuvable pour cette commande" }, 404);
    try {
      const cap = await capturePaypalOrder(paypalOrderId);
      if (!cap.ok)
        return c.json({ error: "paiement non complété", status: cap.status }, 402);
      await markOrderPaid(orderId, "paypal", paypalOrderId);
      return c.json({ status: "paid" });
    } catch (e) {
      console.error("PayPal capture:", e);
      return c.json({ error: "encaissement impossible" }, 502);
    }
  });

  /** Détail d'une commande + ses lignes (pour la fiche BO et les liens PDF). */
  app.get("/admin/orders/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, id));
    if (!order) return c.notFound();
    const items = await db
      .select({
        id: schema.orderItems.id,
        title: schema.orderItems.title,
        productId: schema.orderItems.productId,
        quantity: schema.orderItems.quantity,
        unitPriceCents: schema.orderItems.unitPriceCents,
        format: sql<string>`(${schema.orderItems.config} ->> 'format')`,
      })
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, id));
    const [customer] = order.customerId
      ? await db
          .select()
          .from(schema.customers)
          .where(eq(schema.customers.id, order.customerId))
      : [];
    return c.json({ order, customer: customer ?? null, items });
  });

  // === Téléchargement PDF (BO uniquement — §12) ============================

  /**
   * Renvoie le PDF d'une ligne de commande, régénéré à la demande depuis le
   * snapshot (idempotent). Disponible pour TOUTE commande, même ancienne.
   * C'est la cliente qui télécharge/imprime (depuis le BO ou l'app salon).
   *
   * PROTÉGÉ : l'id de ligne est un entier séquentiel — en accès libre, il
   * suffisait de l'incrémenter pour aspirer les affiches de tous les clients.
   */
  app.get("/admin/print-files/:orderItemId", async (c) => {
    const itemId = Number(c.req.param("orderItemId"));
    const [item] = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.id, itemId));
    if (!item || !item.config) return c.notFound();
    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, item.orderId));
    const [customer] = order?.customerId
      ? await db
          .select()
          .from(schema.customers)
          .where(eq(schema.customers.id, order.customerId))
      : [];
    const cfg = item.config as PosterConfig;
    const fmt = (cfg.format ?? "A4") as "A4" | "A3";
    const data = await buildResolveData();
    const pdf = await renderPosterPdf(cfg, { data, format: fmt });
    const filename = `${slugifyName(customer?.name ?? "client")}_${order?.number ?? "CMD"}.pdf`;
    return c.body(new Uint8Array(pdf), 200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    });
  });

  // === CRUD personnages / assets (BO, protégé /admin/*) ===================

  /** Liste complète (BO) : types + assets, archivés inclus, pour la gestion. */
  app.get("/admin/characters", async (c) => {
    const types = await db
      .select()
      .from(schema.characterTypes)
      .orderBy(asc(schema.characterTypes.position), asc(schema.characterTypes.name));
    const assets = await db
      .select()
      .from(schema.assets)
      .orderBy(asc(schema.assets.position));
    const categories = await db
      .select()
      .from(schema.characterCategories)
      .orderBy(asc(schema.characterCategories.position));
    return c.json({ types, assets, categories });
  });

  // === Catégories de personnages (BO) =====================================

  /** Catégories, avec le nombre de personnages non archivés dans chacune. */
  app.get("/admin/categories", async (c) => {
    const rows = await db
      .select({
        id: schema.characterCategories.id,
        slug: schema.characterCategories.slug,
        name: schema.characterCategories.name,
        position: schema.characterCategories.position,
        count: sql<number>`count(${schema.characterTypes.id})::int`,
      })
      .from(schema.characterCategories)
      .leftJoin(
        schema.characterTypes,
        and(
          eq(schema.characterTypes.categoryId, schema.characterCategories.id),
          isNull(schema.characterTypes.archivedAt),
        ),
      )
      .groupBy(schema.characterCategories.id)
      .orderBy(asc(schema.characterCategories.position));
    return c.json(rows);
  });

  /** Crée une catégorie, ou renomme / réordonne une catégorie existante. */
  app.post("/admin/categories", async (c) => {
    const b = await c.req.json();
    const name = String(b.name ?? "").trim();
    if (!name) return c.json({ error: "nom requis" }, 400);

    if (b.id) {
      const [row] = await db
        .update(schema.characterCategories)
        .set({
          name,
          ...(b.position != null ? { position: Number(b.position) } : {}),
        })
        .where(eq(schema.characterCategories.id, Number(b.id)))
        .returning();
      if (!row) return c.notFound();
      return c.json(row);
    }

    // Slug dérivé du nom, suffixé si déjà pris (deux catégories peuvent
    // porter des noms proches : « Bébés » et « Bebes »).
    const base =
      name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "categorie";
    const taken = new Set(
      (
        await db
          .select({ slug: schema.characterCategories.slug })
          .from(schema.characterCategories)
      ).map((r) => r.slug),
    );
    let slug = base;
    for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;

    const [{ max } = { max: -1 }] = await db
      .select({ max: sql<number>`coalesce(max(${schema.characterCategories.position}), -1)::int` })
      .from(schema.characterCategories);
    const [row] = await db
      .insert(schema.characterCategories)
      .values({ slug, name, position: (max ?? -1) + 1 })
      .returning();
    return c.json(row);
  });

  /**
   * Supprime une catégorie. Les personnages ne sont PAS supprimés : la clé
   * étrangère est en ON DELETE SET NULL, ils se retrouvent sans catégorie et
   * restent modifiables. Supprimer une catégorie n'est donc jamais destructif.
   */
  app.delete("/admin/categories/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const [row] = await db
      .delete(schema.characterCategories)
      .where(eq(schema.characterCategories.id, id))
      .returning();
    if (!row) return c.notFound();
    return c.json({ ok: true });
  });

  /**
   * Affecte un LOT de personnages à une catégorie (vue liste à cocher du BO).
   * `characterIds` = la liste COMPLÈTE des personnages cochés : ceux qui n'y
   * figurent plus et appartenaient à cette catégorie en sortent.
   */
  app.post("/admin/categories/:id/characters", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json();
    const ids = Array.isArray(b.characterIds)
      ? b.characterIds.map(Number).filter(Number.isFinite)
      : [];

    const [category] = await db
      .select()
      .from(schema.characterCategories)
      .where(eq(schema.characterCategories.id, id));
    if (!category) return c.notFound();

    // Sortie : les persos actuellement dans la catégorie et plus cochés.
    const detached = await db
      .update(schema.characterTypes)
      .set({ categoryId: null })
      .where(
        ids.length
          ? and(
              eq(schema.characterTypes.categoryId, id),
              notInArray(schema.characterTypes.id, ids),
            )
          : eq(schema.characterTypes.categoryId, id),
      )
      .returning({ id: schema.characterTypes.id });

    // Entrée : tous les persos cochés rejoignent la catégorie.
    const attached = ids.length
      ? await db
          .update(schema.characterTypes)
          .set({ categoryId: id })
          .where(inArray(schema.characterTypes.id, ids))
          .returning({ id: schema.characterTypes.id })
      : [];

    return c.json({
      category: category.name,
      attached: attached.length,
      detached: detached.length,
    });
  });

  /** Crée ou met à jour un type (nom, catégorie, position). */
  app.post("/admin/characters", async (c) => {
    const b = await c.req.json();
    const slug =
      b.slug ??
      String(b.name ?? "type")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[^a-z0-9]+/g, "-");
    const values = {
      name: String(b.name ?? "Type"),
      // La catégorie est désormais une référence ; `category` (texte) n'est
      // plus écrit, il ne subsiste que le temps de la bascule.
      ...(b.categoryId !== undefined
        ? { categoryId: b.categoryId == null ? null : Number(b.categoryId) }
        : {}),
      position: Number(b.position ?? 0),
      ...(b.orientation !== undefined
        ? { orientation: b.orientation === "back" ? "back" : "front" }
        : {}),
      // Calage vertical (0..1) : editable depuis le BO en plus de la mesure
      // automatique, pour les persos dont les pieds tombent mal.
      ...(b.bottomPct !== undefined && Number.isFinite(Number(b.bottomPct))
        ? { bottomPct: Math.min(1, Math.max(0.05, Number(b.bottomPct))) }
        : {}),
    };
    if (b.id) {
      const [row] = await db
        .update(schema.characterTypes)
        .set(values)
        .where(eq(schema.characterTypes.id, Number(b.id)))
        .returning();
      return c.json(row);
    }
    const [row] = await db
      .insert(schema.characterTypes)
      .values({ ...values, slug })
      .returning();
    return c.json(row);
  });

  /** Archive (soft-delete) ou désarchive un type — §18.1 A. */
  app.post("/admin/characters/:id/archive", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json().catch(() => ({}));
    const archived = b.archived !== false; // défaut: archive
    const [row] = await db
      .update(schema.characterTypes)
      .set({ archivedAt: archived ? new Date() : null })
      .where(eq(schema.characterTypes.id, id))
      .returning();
    if (!row) return c.notFound();
    return c.json(row);
  });

  /** Réordonne des types (drag & drop) : liste d'{id, position, category?}. */
  /**
   * Déplace un LOT de personnages vers une catégorie — ou hors catégorie
   * (`categoryId: null`, le groupe « sans catégorie »).
   *
   * Distinct de POST /admin/categories/:id/characters, qui REMPLACE la
   * composition d'une catégorie : ici on ne touche qu'aux personnages cités,
   * et une route dédiée évite d'écraser au passage nom, position ou
   * orientation comme le ferait un upsert partiel.
   */
  app.post("/admin/characters/category", async (c) => {
    const b = await c.req.json();
    const ids = Array.isArray(b.ids)
      ? b.ids.map(Number).filter(Number.isFinite)
      : [];
    if (!ids.length) return c.json({ error: "aucun personnage" }, 400);
    const categoryId =
      b.categoryId == null || b.categoryId === "" ? null : Number(b.categoryId);

    if (categoryId != null) {
      const [cat] = await db
        .select({ id: schema.characterCategories.id })
        .from(schema.characterCategories)
        .where(eq(schema.characterCategories.id, categoryId));
      if (!cat) return c.json({ error: "catégorie inconnue" }, 404);
    }

    const moved = await db
      .update(schema.characterTypes)
      .set({ categoryId })
      .where(inArray(schema.characterTypes.id, ids))
      .returning({ id: schema.characterTypes.id });
    return c.json({ ok: true, moved: moved.length });
  });

  app.post("/admin/characters/reorder", async (c) => {
    const b = await c.req.json();
    const list: { id: number; position: number; category?: string }[] =
      b.items ?? [];
    for (const it of list) {
      await db
        .update(schema.characterTypes)
        .set({
          position: Number(it.position),
          ...(it.category !== undefined ? { category: it.category } : {}),
        })
        .where(eq(schema.characterTypes.id, Number(it.id)));
    }
    return c.json({ ok: true, count: list.length });
  });

  /** Édite les couleurs d'un asset (accessoires inclus — §18.1 D). */
  app.post("/admin/assets/:id/colors", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json();
    const zones = b.colorZones ?? {};
    // garde-fou : clés stN + valeurs hex
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(zones)) {
      if (/^st\d+$/.test(k) && /^#[0-9a-fA-F]{3,8}$/.test(String(v)))
        clean[k] = String(v).toUpperCase();
    }
    const [row] = await db
      .update(schema.assets)
      .set({ colorZones: clean })
      .where(eq(schema.assets.id, id))
      .returning();
    if (!row) return c.notFound();
    return c.json(row);
  });

  /**
   * Définit le SVG de BASE d'un personnage prédéfini + ses couleurs par défaut.
   * Permet de composer un perso depuis le BO (baseSvgUrl = un perso complet,
   * ou un assemblage exporté). baseColorZones = couleurs par défaut (peau/tenue).
   */
  app.post("/admin/characters/:id/base", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json();
    const set: Record<string, unknown> = {};
    if (b.baseSvgUrl !== undefined) set.baseSvgUrl = b.baseSvgUrl || null;
    if (b.baseColorZones !== undefined) {
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(b.baseColorZones ?? {})) {
        if (/^st\d+$/.test(k) && /^#[0-9a-fA-F]{3,8}$/.test(String(v)))
          clean[k] = String(v).toUpperCase();
      }
      set.baseColorZones = clean;
    }
    const [row] = await db
      .update(schema.characterTypes)
      .set(set)
      .where(eq(schema.characterTypes.id, id))
      .returning();
    if (!row) return c.notFound();
    return c.json(row);
  });

  /** Supprime DÉFINITIVEMENT un type de personnage (et ses assets liés). */
  // La suppression définitive d'un personnage a été RETIRÉE volontairement.
  // Les PDF des commandes passées se régénèrent en relisant les personnages en
  // base : supprimer une ligne rendait donc impossible la réimpression d'une
  // commande déjà payée. On archive (POST /admin/characters/:id/archive), ce
  // qui masque du configurateur sans rien casser.

  // === Gestion des PIÈCES (assets) — bibliothèque d'éléments ================

  /** Liste des pièces (variantes génériques), groupées par slot + vue. */
  app.get("/admin/assets", async (c) => {
    const rows = await db
      .select()
      .from(schema.assets)
      .orderBy(asc(schema.assets.slot), asc(schema.assets.position));
    return c.json(rows);
  });

  /** Crée ou met à jour une pièce (vêtement, coupe, accessoire…). */
  app.post("/admin/assets", async (c) => {
    const b = await c.req.json();
    const cleanZones: Record<string, string> = {};
    for (const [k, v] of Object.entries(b.colorZones ?? {})) {
      if (/^st\d+$/.test(k) && /^#[0-9a-fA-F]{3,8}$/.test(String(v)))
        cleanZones[k] = String(v).toUpperCase();
    }
    const values = {
      slot: String(b.slot ?? "clothes"),
      name: b.name ?? null,
      svgUrl: String(b.svgUrl ?? ""),
      view: b.view === "back" ? "back" : "front",
      colorZones: Object.keys(cleanZones).length ? cleanZones : null,
      position: Number(b.position ?? 0),
      characterTypeId: b.characterTypeId ? Number(b.characterTypeId) : null,
    };
    if (!values.svgUrl) return c.json({ error: "svgUrl requis" }, 400);
    if (b.id) {
      const [row] = await db
        .update(schema.assets)
        .set(values)
        .where(eq(schema.assets.id, Number(b.id)))
        .returning();
      return c.json(row);
    }
    const [row] = await db.insert(schema.assets).values(values).returning();
    return c.json(row);
  });

  /** Supprime une pièce. */
  /**
   * Archive ou restaure une pièce. La suppression définitive a été RETIRÉE :
   * une pièce effacée empêchait de régénérer le PDF des commandes qui
   * l'utilisaient. Archivée, elle disparaît du configurateur mais reste
   * lisible pour l'impression.
   */
  app.post("/admin/assets/:id/archive", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json().catch(() => ({}));
    const [row] = await db
      .update(schema.assets)
      .set({ archivedAt: b.archived === false ? null : new Date() })
      .where(eq(schema.assets.id, id))
      .returning();
    if (!row) return c.notFound();
    return c.json({ ok: true, archived: row.archivedAt != null });
  });

  // === Config CONFIGURATEUR par produit (BO) ===============================

  /** Détail config configurateur d'un produit : défauts + visuels (fonds). */
  app.get("/admin/products/:id/config", async (c) => {
    const id = Number(c.req.param("id"));
    const [product] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, id));
    if (!product) return c.notFound();
    const backgrounds = await db
      .select()
      .from(schema.backgrounds)
      .where(eq(schema.backgrounds.productId, id))
      .orderBy(asc(schema.backgrounds.position));
    return c.json({
      id: product.id,
      slug: product.slug,
      name: product.name,
      defaultTitle: product.defaultTitle,
      defaultSubtitle: product.defaultSubtitle,
      defaultView: product.defaultView,
      foregroundUrl: product.foregroundUrl,
      backgrounds,
    });
  });

  /** Met à jour les défauts configurateur d'un produit (titre/sous-titre/
   *  position/décor avant-plan). */
  app.post("/admin/products/:id/config", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json();
    const set: Record<string, unknown> = {};
    if (b.defaultTitle !== undefined) set.defaultTitle = b.defaultTitle || null;
    if (b.defaultSubtitle !== undefined)
      set.defaultSubtitle = b.defaultSubtitle || null;
    if (b.defaultView !== undefined)
      set.defaultView =
        b.defaultView === "back" ? "back" : b.defaultView === "front" ? "front" : null;
    if (b.foregroundUrl !== undefined)
      set.foregroundUrl = b.foregroundUrl || null;
    const [row] = await db
      .update(schema.products)
      .set(set)
      .where(eq(schema.products.id, id))
      .returning();
    if (!row) return c.notFound();
    return c.json(row);
  });

  /** Ajoute un visuel (fond) à un produit, par URL. */
  app.post("/admin/products/:id/backgrounds", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json();
    const url = String(b.url ?? "").trim();
    if (!url) return c.json({ error: "url requise" }, 400);
    const [maxPos] = await db
      .select({ p: schema.backgrounds.position })
      .from(schema.backgrounds)
      .where(eq(schema.backgrounds.productId, id))
      .orderBy(desc(schema.backgrounds.position))
      .limit(1);
    const [row] = await db
      .insert(schema.backgrounds)
      .values({
        productId: id,
        url,
        name: b.name ?? url.split("/").pop()?.replace(/\.[a-z]+$/i, "") ?? null,
        position: (maxPos?.p ?? -1) + 1,
      })
      .returning();
    return c.json(row);
  });

  /** Retire un visuel (fond) d'un produit. */
  app.delete("/admin/backgrounds/:bgId", async (c) => {
    const bgId = Number(c.req.param("bgId"));
    await db.delete(schema.backgrounds).where(eq(schema.backgrounds.id, bgId));
    return c.json({ ok: true });
  });
}
