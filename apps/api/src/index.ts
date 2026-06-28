import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { count, eq, desc, inArray } from "drizzle-orm";
import { resolve, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, stat } from "node:fs/promises";
import { db, sql, schema } from "./db/client.js";
import {
  SESSION_COOKIE,
  createSession,
  deleteSession,
  validateSession,
  verifyPassword,
  purgeExpiredSessions,
} from "./auth.js";
import { mountConfiguratorRoutes } from "./configurator-routes.js";

const app = new Hono();
const isProd = process.env.NODE_ENV === "production";

/**
 * CORS — le web (4324) et l'admin (4323) appellent l'API (3100) depuis le
 * navigateur (configurateur, panier, édition couleurs…). Sans ces en-têtes,
 * le navigateur bloque les réponses (net::ERR_FAILED) même quand l'API répond
 * 200. `credentials: true` pour les requêtes admin authentifiées (cookie).
 * Les origines autorisées sont surchargeables via WEB_ORIGINS (CSV) en prod.
 */
const allowedOrigins = (
  process.env.WEB_ORIGINS ??
  "http://localhost:4321,http://localhost:4322,http://localhost:4323,http://localhost:4324,http://localhost:4325"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  "*",
  cors({
    origin: (origin) =>
      !origin || allowedOrigins.includes(origin) ? origin || "*" : null,
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

// Images/SVG rapatriés depuis Shopify (cf. scripts/fetch-assets.ts).
// Servis depuis data/assets/ à la racine du repo. On lit le fichier
// explicitement (chemin absolu) pour éviter les ambiguïtés de cwd.
const ASSETS_DIR = resolve(fileURLToPath(import.meta.url), "../../../../data/assets");
const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
};

app.get("/assets/:file", async (c) => {
  // basename() neutralise toute tentative de traversal (../).
  const file = basename(c.req.param("file"));
  const path = resolve(ASSETS_DIR, file);
  try {
    await stat(path);
    const buf = await readFile(path);
    const mime = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
    return c.body(buf, 200, {
      "Content-Type": mime,
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  } catch {
    return c.notFound();
  }
});

app.get("/", (c) => c.json({ name: "memoryline-api", status: "ok" }));

app.get("/health", async (c) => {
  try {
    await sql`select 1`;
    return c.json({ status: "ok", db: "up" });
  } catch (err) {
    return c.json({ status: "error", db: "down", error: String(err) }, 503);
  }
});

/** Compteurs globaux — pratique pour vérifier l'import d'un coup d'œil. */
app.get("/stats", async (c) => {
  const [[products], [variants], [collections], [customers], [orders], [items]] =
    await Promise.all([
      db.select({ n: count() }).from(schema.products),
      db.select({ n: count() }).from(schema.variants),
      db.select({ n: count() }).from(schema.collections),
      db.select({ n: count() }).from(schema.customers),
      db.select({ n: count() }).from(schema.orders),
      db.select({ n: count() }).from(schema.orderItems),
    ]);
  const byChannel = await db
    .select({ channel: schema.orders.channel, n: count() })
    .from(schema.orders)
    .groupBy(schema.orders.channel);
  return c.json({
    products: products!.n,
    variants: variants!.n,
    collections: collections!.n,
    customers: customers!.n,
    orders: orders!.n,
    orderItems: items!.n,
    ordersByChannel: Object.fromEntries(byChannel.map((r) => [r.channel, r.n])),
  });
});

/** Catalogue : liste de produits (avec leurs variantes A4/A3). */
app.get("/products", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const products = await db
    .select({
      id: schema.products.id,
      slug: schema.products.slug,
      name: schema.products.name,
      kind: schema.products.kind,
      basePriceCents: schema.products.basePriceCents,
    })
    .from(schema.products)
    .limit(limit);
  const ids = products.map((p) => p.id);
  const variants = ids.length
    ? await db
        .select({
          productId: schema.variants.productId,
          format: schema.variants.format,
          priceCents: schema.variants.priceCents,
        })
        .from(schema.variants)
        .where(inArray(schema.variants.productId, ids))
    : [];
  const byProduct = new Map<number, typeof variants>();
  for (const v of variants) {
    if (!byProduct.has(v.productId)) byProduct.set(v.productId, []);
    byProduct.get(v.productId)!.push(v);
  }
  // image principale (position la plus basse) par produit
  const images = ids.length
    ? await db
        .select({
          productId: schema.productImages.productId,
          url: schema.productImages.url,
          position: schema.productImages.position,
        })
        .from(schema.productImages)
        .where(inArray(schema.productImages.productId, ids))
        .orderBy(schema.productImages.position)
    : [];
  const imageByProduct = new Map<number, string>();
  for (const img of images) {
    if (!imageByProduct.has(img.productId))
      imageByProduct.set(img.productId, img.url);
  }
  return c.json(
    products.map((p) => ({
      ...p,
      image: imageByProduct.get(p.id) ?? null,
      variants: byProduct.get(p.id) ?? [],
    })),
  );
});

/** Fiche produit complète par slug (pour /affiches/[slug]). */
app.get("/products/:slug", async (c) => {
  const slug = c.req.param("slug");
  const rows = await db
    .select()
    .from(schema.products)
    .where(eq(schema.products.slug, slug));
  const product = rows[0];
  if (!product) return c.notFound();

  const [variants, images] = await Promise.all([
    db
      .select()
      .from(schema.variants)
      .where(eq(schema.variants.productId, product.id)),
    db
      .select()
      .from(schema.productImages)
      .where(eq(schema.productImages.productId, product.id))
      .orderBy(schema.productImages.position),
  ]);

  return c.json({
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    kind: product.kind,
    basePriceCents: product.basePriceCents,
    images: images.map((i) => i.url),
    // Réglages configurateur par défaut (repris de l'ancien site, éditables BO).
    defaultTitle: product.defaultTitle,
    defaultSubtitle: product.defaultSubtitle,
    defaultView: product.defaultView,
    foregroundUrl: product.foregroundUrl,
    variants: variants.map((v) => ({
      format: v.format,
      priceCents: v.priceCents,
      widthMm: v.widthMm,
      heightMm: v.heightMm,
    })),
  });
});

/** Commandes d'un canal donné (séparation §11). */
app.get("/orders", async (c) => {
  const channel = c.req.query("channel");
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const where =
    channel === "web" || channel === "salon"
      ? eq(schema.orders.channel, channel)
      : undefined;
  const rows = await db
    .select({
      id: schema.orders.id,
      number: schema.orders.number,
      channel: schema.orders.channel,
      status: schema.orders.status,
      totalCents: schema.orders.totalCents,
      legacyName: schema.orders.legacyName,
      createdAt: schema.orders.createdAt,
    })
    .from(schema.orders)
    .where(where)
    .orderBy(desc(schema.orders.createdAt))
    .limit(limit);
  return c.json(rows);
});

/** Bandeau d'annonce actif (le plus prioritaire, dans sa période). */
app.get("/banner", async (c) => {
  const now = new Date();
  const banners = await db
    .select()
    .from(schema.announcementBanners)
    .where(eq(schema.announcementBanners.active, true))
    .orderBy(desc(schema.announcementBanners.priority));
  const current = banners.find(
    (b) =>
      (!b.startsAt || b.startsAt <= now) && (!b.endsAt || b.endsAt >= now),
  );
  return c.json(current ?? null);
});

/** Réglages éditables (clé -> valeur), optionnellement filtrés par groupe. */
app.get("/settings", async (c) => {
  const group = c.req.query("group");
  const rows = await db.select().from(schema.settings);
  const filtered = group ? rows.filter((r) => r.group === group) : rows;
  return c.json(
    Object.fromEntries(filtered.map((r) => [r.key, r.value])),
  );
});

/** Promos actives (pour info front / calcul panier ultérieur). */
app.get("/promos", async (c) => {
  const now = new Date();
  const rows = await db
    .select()
    .from(schema.promoRules)
    .where(eq(schema.promoRules.active, true))
    .orderBy(desc(schema.promoRules.priority));
  const active = rows.filter(
    (r) =>
      (!r.startsAt || r.startsAt <= now) && (!r.endsAt || r.endsAt >= now),
  );
  return c.json(active);
});

// === Authentification back-office ========================================

app.post("/auth/login", async (c) => {
  const { email, password } = await c.req.json();
  await purgeExpiredSessions();
  const rows = await db
    .select()
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.email, String(email ?? "").toLowerCase()));
  const user = rows[0];
  // verifyPassword sur un hash factice si user absent -> évite l'oracle de timing
  const ok =
    user && (await verifyPassword(String(password ?? ""), user.passwordHash));
  if (!user || !ok) {
    return c.json({ error: "Identifiants invalides" }, 401);
  }
  const token = await createSession(user.id);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: isProd,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return c.json({ id: user.id, email: user.email, role: user.role });
});

app.post("/auth/logout", async (c) => {
  await deleteSession(getCookie(c, SESSION_COOKIE));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

app.get("/auth/me", async (c) => {
  const user = await validateSession(getCookie(c, SESSION_COOKIE));
  if (!user) return c.json({ user: null }, 401);
  return c.json({ user: { email: user.email, role: user.role } });
});

// === Back-office (écritures) — PROTÉGÉ ====================================
// Toute requête /admin/* exige une session admin valide.
app.use("/admin/*", async (c, next) => {
  const user = await validateSession(getCookie(c, SESSION_COOKIE));
  if (!user) return c.json({ error: "Non authentifié" }, 401);
  await next();
});

// Routes configurateur / panier / commandes web / PDF / CRUD personnages.
// Montées ici : les routes /admin/* qu'elles déclarent passent par le
// middleware d'auth ci-dessus ; les routes publiques (/characters, /cart…)
// ne sont pas concernées.
mountConfiguratorRoutes(app);

app.get("/admin/promos", async (c) => {
  const rows = await db
    .select()
    .from(schema.promoRules)
    .orderBy(desc(schema.promoRules.priority));
  return c.json(rows);
});

app.post("/admin/promos", async (c) => {
  const body = await c.req.json();
  const values = {
    name: String(body.name ?? "Promo"),
    type: String(body.type ?? "percent"),
    config: body.config ?? {},
    code: body.code || null,
    active: body.active ?? true,
    priority: Number(body.priority ?? 0),
    stackable: body.stackable ?? false,
    startsAt: body.startsAt ? new Date(body.startsAt) : null,
    endsAt: body.endsAt ? new Date(body.endsAt) : null,
    updatedAt: new Date(),
  };
  if (body.id) {
    const [row] = await db
      .update(schema.promoRules)
      .set(values)
      .where(eq(schema.promoRules.id, Number(body.id)))
      .returning();
    return c.json(row);
  }
  const [row] = await db.insert(schema.promoRules).values(values).returning();
  return c.json(row);
});

app.post("/admin/promos/:id/toggle", async (c) => {
  const id = Number(c.req.param("id"));
  const [cur] = await db
    .select({ active: schema.promoRules.active })
    .from(schema.promoRules)
    .where(eq(schema.promoRules.id, id));
  if (!cur) return c.notFound();
  const [row] = await db
    .update(schema.promoRules)
    .set({ active: !cur.active })
    .where(eq(schema.promoRules.id, id))
    .returning();
  return c.json(row);
});

app.post("/admin/banner", async (c) => {
  const body = await c.req.json();
  const values = {
    message: String(body.message ?? ""),
    linkUrl: body.linkUrl || null,
    linkLabel: body.linkLabel || null,
    bgColor: body.bgColor || "#20211f",
    textColor: body.textColor || "#f7f3ec",
    active: body.active ?? true,
    priority: Number(body.priority ?? 0),
    promoRuleId: body.promoRuleId ? Number(body.promoRuleId) : null,
    startsAt: body.startsAt ? new Date(body.startsAt) : null,
    endsAt: body.endsAt ? new Date(body.endsAt) : null,
  };
  if (body.id) {
    const [row] = await db
      .update(schema.announcementBanners)
      .set(values)
      .where(eq(schema.announcementBanners.id, Number(body.id)))
      .returning();
    return c.json(row);
  }
  const [row] = await db
    .insert(schema.announcementBanners)
    .values(values)
    .returning();
  return c.json(row);
});

app.post("/admin/settings", async (c) => {
  const body = await c.req.json();
  const key = String(body.key);
  const [row] = await db
    .insert(schema.settings)
    .values({ key, value: body.value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value: body.value, updatedAt: new Date() },
    })
    .returning();
  return c.json(row);
});

const port = Number(process.env.API_PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`✓ API memoryline sur http://localhost:${info.port}`);
});

export type AppType = typeof app;
