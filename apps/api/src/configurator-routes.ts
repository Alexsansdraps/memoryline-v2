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
import { asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "./db/client.js";
import { renderPosterPdf, type ResolveData } from "./pdf.js";
import { posterConfigSchema, type PosterConfig } from "@memoryline/types";

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
  const assetMap = new Map<string, any>();
  for (const a of assets)
    assetMap.set(String(a.id), {
      id: a.id,
      slot: a.slot,
      svgUrl: a.svgUrl,
      colorZones: a.colorZones,
      position: a.position,
    });
  const bgMap = new Map<string, any>();
  for (const b of backgrounds)
    bgMap.set(String(b.id), { id: b.id, url: b.url });
  return { assets: assetMap, backgrounds: bgMap };
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

// --- Montage des routes -------------------------------------------------------

export function mountConfiguratorRoutes(app: Hono) {
  // === Données configurateur (public) ====================================

  /** Types de personnages NON archivés, groupés par catégorie+position, avec assets. */
  app.get("/characters", async (c) => {
    const includeArchived = c.req.query("all") === "1";
    const types = await db
      .select()
      .from(schema.characterTypes)
      .where(includeArchived ? undefined : isNull(schema.characterTypes.archivedAt))
      .orderBy(asc(schema.characterTypes.category), asc(schema.characterTypes.position));
    const typeIds = types.map((t) => t.id);
    const assets = typeIds.length
      ? await db
          .select()
          .from(schema.assets)
          .where(inArray(schema.assets.characterTypeId, typeIds))
          .orderBy(asc(schema.assets.position))
      : [];
    const bySlotByType = new Map<number, Record<string, any[]>>();
    for (const a of assets) {
      const tid = a.characterTypeId!;
      if (!bySlotByType.has(tid)) bySlotByType.set(tid, {});
      const bySlot = bySlotByType.get(tid)!;
      (bySlot[a.slot] ??= []).push({
        id: a.id,
        slot: a.slot,
        name: a.name,
        svgUrl: a.svgUrl,
        view: a.view,
        colorZones: a.colorZones,
        position: a.position,
      });
    }
    return c.json(
      types.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        category: t.category,
        position: t.position,
        archived: t.archivedAt != null,
        assetsBySlot: bySlotByType.get(t.id) ?? {},
      })),
    );
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
    const [item] = await db
      .insert(schema.orderItems)
      .values({
        orderId: order!.id,
        productId: body.productId ?? null,
        variantId: body.variantId ?? null,
        config: parsed.data,
        title: body.title ?? null,
        unitPriceCents: Number(body.unitPriceCents ?? 0),
        quantity: Number(body.quantity ?? 1),
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
    const [item] = await db
      .update(schema.orderItems)
      .set({
        config: parsed.data,
        variantId: body.variantId ?? undefined,
        unitPriceCents:
          body.unitPriceCents != null ? Number(body.unitPriceCents) : undefined,
        quantity: body.quantity != null ? Number(body.quantity) : undefined,
      })
      .where(eq(schema.orderItems.id, itemId))
      .returning();
    if (!item) return c.notFound();
    return c.json(item);
  });

  /** Supprime une ligne du panier. */
  app.delete("/cart/:cartId/items/:itemId", async (c) => {
    const itemId = Number(c.req.param("itemId"));
    await db.delete(schema.orderItems).where(eq(schema.orderItems.id, itemId));
    return c.json({ ok: true });
  });

  // === Validation de commande web =========================================

  /**
   * Transforme un panier draft en commande web confirmée (canal immuable).
   * Génère le PDF de chaque ligne. Le paiement réel (Stripe/PayPal) est
   * confirmé par webhook ailleurs ; ici on matérialise la commande.
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

    const items = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, draft.id));
    if (items.length === 0) return c.json({ error: "panier vide" }, 400);

    const [customer] = await db
      .insert(schema.customers)
      .values({ name, email })
      .returning();
    const number = await nextOrderNumber("web");
    const total = items.reduce(
      (s, it) => s + it.unitPriceCents * it.quantity,
      0,
    );
    const [order] = await db
      .update(schema.orders)
      .set({
        number,
        status: "paid",
        customerId: customer!.id,
        totalCents: total,
      })
      .where(eq(schema.orders.id, draft.id))
      .returning();

    // PDF par ligne (régénérable, §15.3)
    for (const it of items) {
      const cfg = it.config as PosterConfig | null;
      if (!cfg) continue;
      const fmt = (cfg.format ?? "A4") as "A4" | "A3";
      try {
        await generatePrintFile(it.id, cfg, name, number, fmt);
      } catch (e) {
        console.error("PDF génération échouée (item " + it.id + ") :", e);
      }
    }
    return c.json({ orderId: order!.id, number, status: order!.status });
  });

  /** Détail d'une commande + ses lignes (pour la fiche BO et les liens PDF). */
  app.get("/orders/:id", async (c) => {
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

  // === Téléchargement PDF (à tout moment, web + salon — §12) ===============

  /**
   * Renvoie le PDF d'une ligne de commande, régénéré à la demande depuis le
   * snapshot (idempotent). Disponible pour TOUTE commande, même ancienne.
   * C'est la cliente qui télécharge/imprime (depuis le BO ou l'app salon).
   */
  app.get("/print-files/:orderItemId", async (c) => {
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
      .orderBy(asc(schema.characterTypes.category), asc(schema.characterTypes.position));
    const assets = await db
      .select()
      .from(schema.assets)
      .orderBy(asc(schema.assets.position));
    return c.json({ types, assets });
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
      category: b.category ?? null,
      position: Number(b.position ?? 0),
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
}
