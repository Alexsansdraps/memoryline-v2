import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import {
  and,
  asc,
  count,
  eq,
  desc,
  gte,
  inArray,
  sql as sqlOp,
} from "drizzle-orm";
import { resolve, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, stat, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { db, sql, schema } from "./db/client.js";
import {
  SESSION_COOKIE,
  createSession,
  deleteSession,
  hashPassword,
  validateSession,
  verifyPassword,
  purgeExpiredSessions,
} from "./auth.js";
import { formaterPoids, normaliserCode } from "@memoryline/types";
import {
  estConfigure as mondialRelayConfigure,
  rechercherPointsRelais,
} from "./mondial-relay.js";
import {
  estConfigure as colissimoConfigure,
  rechercherPointsRetrait,
} from "./colissimo.js";

/** Un transporteur sait-il chercher ses points ? */
function transporteurConfigure(carrier: string | null | undefined): boolean {
  if (carrier === "colissimo") return colissimoConfigure();
  if (carrier === "mondial_relay") return mondialRelayConfigure();
  // Transporteur inconnu : on ne prétend pas savoir chercher pour lui.
  return false;
}
import { mountConfiguratorRoutes } from "./configurator-routes.js";
import { mountOrderRoutes } from "./commandes.js";
import { mountCatalogueRoutes } from "./catalogue.js";
import { mountProduitsMasse } from "./produits-masse.js";
import { mountVentesProduit } from "./ventes-produit.js";
import { mountFicheProduit } from "./fiche-produit.js";
import { mountCms } from "./cms.js";
import { mountCollections } from "./collections.js";
import { mountImportProduits } from "./import-produits.js";
import { mountCartesCadeaux } from "./cartes-cadeaux.js";
import { mountLettre } from "./lettre.js";
import { mountCourriers } from "./courriers.js";
import { mountSalonRoutes } from "./salon.js";
import { mountCompteRoutes } from "./comptes.js";
import { mountIaRoutes } from "./ia.js";

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

// === Back-office — PROTÉGÉ ================================================
// Toute requête /admin/* exige une session valide, et les ÉCRITURES exigent
// en plus le rôle « owner ».
//
// Ce garde est déclaré ICI, AVANT la moindre route, et c'est essentiel : Hono
// n'applique un middleware qu'aux routes déclarées APRÈS lui. Placé plus bas,
// il laissait passer sans session tout ce qui était écrit au-dessus — les
// adresses de la lettre d'information et la grille tarifaire, entre autres.
// Toute nouvelle route /admin/* est désormais couverte par construction.
//
// Règle volontairement simple, donc difficile à contourner par oubli : toute
// méthode autre que GET est réservée au propriétaire. Un « seller » consulte
// le catalogue, les commandes et télécharge les PDF d'impression, mais ne peut
// modifier ni les produits, ni les personnages, ni les prix, ni les promotions,
// ni le contenu du site. Énumérer les routes à protéger une par une aurait
// laissé passer la prochaine route ajoutée.
const OWNER_ROLE = "owner";

/**
 * Ce qu'un VENDEUR a le droit de lire, et rien d'autre.
 *
 * La règle d'avant disait « le vendeur consulte, le propriétaire modifie ».
 * Elle laissait donc lire tout : le chiffre du site, les fiches clients, les
 * marges, les autres stands. Ce n'est pas ce qu'on confie à quelqu'un qui
 * tient une table un samedi après-midi.
 *
 * Le sens de la marche compte plus que la liste elle-même. Énumérer ce qui est
 * INTERDIT laisse passer chaque route ajoutée ensuite, et personne ne s'en
 * aperçoit avant la fuite. Énumérer ce qui est PERMIS refuse par défaut :
 * l'oubli se voit tout de suite, parce que l'écran cesse de marcher.
 *
 * Sur ces routes-là, les données sont en plus bornées au stand : voir
 * `limiterAuStand` dans apps/api/src/commandes.ts.
 */
const LECTURES_DU_VENDEUR = [
  "/admin/orders", // bornées au stand, cf. commandes.ts
  "/admin/stats/orders", // idem
  "/admin/stands", // son stand seulement
  "/admin/print-files", // le fichier d'impression d'une affiche vendue
  "/admin/me",
];

app.use("/admin/*", async (c, next) => {
  const user = await validateSession(getCookie(c, SESSION_COOKIE));
  if (!user) return c.json({ error: "Non authentifié" }, 401);
  // Les routes lisent l'utilisateur pour borner ce qu'elles renvoient. Posé
  // ici, une fois : une route qui l'oublierait renverrait tout.
  c.set("utilisateur", user);

  if (user.role !== OWNER_ROLE) {
    const chemin = new URL(c.req.url).pathname;
    const permise =
      c.req.method === "GET" &&
      LECTURES_DU_VENDEUR.some(
        (p) => chemin === p || chemin.startsWith(`${p}/`) || chemin.startsWith(`${p}?`),
      );
    if (!permise)
      return c.json(
        { error: "Cette partie du back-office est réservée au propriétaire." },
        403,
      );
  }
  await next();
});

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
      // Un SVG est un document : ouvert directement, un fichier piégé
      // s'exécuterait sur l'origine de l'API, là où vit le cookie admin.
      // On neutralise scripts et ressources externes, et on interdit au
      // navigateur de deviner un autre type que celui annoncé.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
      "X-Content-Type-Options": "nosniff",
    });
  } catch {
    return c.notFound();
  }
});

/**
 * Résout le contenu éditorial d'un produit dans la langue demandée.
 *
 * Le français (colonnes `name` / `description`) est la référence ET le repli :
 * une traduction absente, vide ou faite d'espaces retombe dessus. Le client
 * voit donc toujours un texte, jamais un blanc — c'est ce qui permet de
 * traduire progressivement, produit par produit.
 */
type Traduisible = {
  name: string;
  description?: string | null;
  translations?: Partial<
    Record<string, { name?: string; description?: string }>
  > | null;
};

function traduire<T extends Traduisible>(p: T, langue?: string) {
  const t = langue && langue !== "fr" ? p.translations?.[langue] : undefined;
  const utile = (v?: string | null) => (v && v.trim() ? v : undefined);
  return {
    ...p,
    name: utile(t?.name) ?? p.name,
    description: utile(t?.description) ?? p.description,
  };
}

/** Langue demandée par le client (?lang=en). Inconnue ou absente -> français. */
function langueDemandee(c: { req: { query: (k: string) => string | undefined } }) {
  const l = (c.req.query("lang") ?? "").toLowerCase();
  return ["en", "de", "it", "es"].includes(l) ? l : "fr";
}

app.get("/", (c) => c.json({ name: "memoryline-api", status: "ok" }));

app.get("/health", async (c) => {
  try {
    await sql`select 1`;
    return c.json({ status: "ok", db: "up" });
  } catch (err) {
    return c.json({ status: "error", db: "down", error: String(err) }, 503);
  }
});

/**
 * Compteurs CATALOGUE — publics (la home les affiche : « X affiches »).
 * Volontairement limités : clients, commandes et chiffre d'affaires relèvent
 * du BO et vivent sur /admin/stats.
 */
app.get("/stats", async (c) => {
  const [[products], [variants], [collections]] = await Promise.all([
    db.select({ n: count() }).from(schema.products),
    db.select({ n: count() }).from(schema.variants),
    db.select({ n: count() }).from(schema.collections),
  ]);
  return c.json({
    products: products!.n,
    variants: variants!.n,
    collections: collections!.n,
  });
});

/** Catalogue : liste de produits (avec leurs variantes A4/A3). */
app.get("/products", async (c) => {
  // Plafond relevé : la boutique en demande la totalité, et le catalogue a
  // dépassé les 200 depuis longtemps — au-delà, les dernières affiches
  // créées n'apparaissaient nulle part.
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 1000);
  const langue = langueDemandee(c);

  const filtres = [eq(schema.products.status, "active")];
  const genre = (c.req.query("genre") ?? "").trim();
  if (genre === "personnalisable" || genre === "prete_a_imprimer")
    filtres.push(eq(schema.products.kind, genre));
  const collection = (c.req.query("collection") ?? "").trim();
  if (collection)
    filtres.push(
      sqlOp`exists (select 1 from ${schema.productCollections} pc join ${schema.collections} col on col.id = pc.collection_id where pc.product_id = ${schema.products.id} and col.slug = ${collection})`,
    );
  const rows = await db
    .select({
      id: schema.products.id,
      slug: schema.products.slug,
      name: schema.products.name,
      kind: schema.products.kind,
      basePriceCents: schema.products.basePriceCents,
      translations: schema.products.translations,
    })
    .from(schema.products)
    // Seuls les produits actifs sont en vente. Un brouillon est un produit
    // qu'on prépare, une archive un produit retiré : ni l'un ni l'autre n'a
    // sa place dans la boutique. Le back-office passe par /admin/products,
    // qui, lui, montre tout.
    //
    // Les deux filtres facultatifs servent les rayons du menu : le GENRE
    // sépare les affiches à composer des affiches prêtes à imprimer, la
    // COLLECTION donne « Villes » et « Thèmes & paysages ».
    .where(and(...filtres))
    // Ordre stable : sans tri explicite, Postgres est libre de renvoyer les
    // lignes dans n'importe quel ordre, et la boutique se réorganisait toute
    // seule d'une requête à l'autre. Les créations récentes ferment la marche.
    .orderBy(asc(schema.products.id))
    .limit(limit);
  // Nom traduit, sans exposer le dictionnaire complet au site public.
  const products = rows.map(({ translations, ...p }) => ({
    ...p,
    name: traduire({ ...p, translations }, langue).name,
  }));
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
/**
 * Les collections qui contiennent au moins une affiche en vente.
 *
 * Une collection vide est un vestige de l'import : la proposer au menu
 * mènerait à une page blanche. Le compte sert aussi à écrire « Villes (146) »
 * si la boutique le souhaite un jour.
 */
app.get("/collections", async (c) => {
  const rows = await db
    .select({
      id: schema.collections.id,
      slug: schema.collections.slug,
      name: schema.collections.name,
      position: schema.collections.position,
      produits: count(schema.productCollections.productId),
    })
    .from(schema.collections)
    .innerJoin(
      schema.productCollections,
      eq(schema.productCollections.collectionId, schema.collections.id),
    )
    .innerJoin(
      schema.products,
      and(
        eq(schema.products.id, schema.productCollections.productId),
        eq(schema.products.status, "active"),
      ),
    )
    .groupBy(
      schema.collections.id,
      schema.collections.slug,
      schema.collections.name,
      schema.collections.position,
    )
    .orderBy(asc(schema.collections.position), asc(schema.collections.name));
  return c.json(rows.map(({ position: _p, ...r }) => r));
});

app.get("/products/:slug", async (c) => {
  const slug = c.req.param("slug");
  const rows = await db
    .select()
    .from(schema.products)
    // Même règle que pour la liste : une adresse devinée ne doit pas donner
    // accès à une affiche que la boutique a retirée de la vente.
    .where(and(eq(schema.products.slug, slug), eq(schema.products.status, "active")));
  const brut = rows[0];
  if (!brut) return c.notFound();
  const product = traduire(brut, langueDemandee(c));

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

  // Type d'affiche du produit : il porte le décor par défaut.
  const [vue] = product.defaultView
    ? await db
        .select({ foregroundUrl: schema.posterViews.foregroundUrl })
        .from(schema.posterViews)
        .where(eq(schema.posterViews.slug, product.defaultView))
    : [];

  return c.json({
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    /**
     * Ce que la boutiquière veut voir dans Google. Vides, la page retombe sur
     * le nom du produit et sur les premiers mots de sa description : c'est un
     * repli acceptable, pas un choix éditorial.
     */
    seoTitle: product.seoTitle,
    seoDescription: product.seoDescription,
    kind: product.kind,
    /**
     * Affiche tirée d'une photo du client. Ce n'est pas un autre genre de
     * produit : c'est une affiche ordinaire dont la fiche remplace le
     * configurateur par l'envoi d'une photo — d'où le drapeau à côté de
     * `kind` plutôt qu'une valeur de plus dedans.
     */
    aiEnabled: product.aiEnabled,
    basePriceCents: product.basePriceCents,
    images: images.map((i) => i.url),
    // Réglages configurateur par défaut (repris de l'ancien site, éditables BO).
    defaultTitle: product.defaultTitle,
    defaultSubtitle: product.defaultSubtitle,
    defaultLine3: product.defaultLine3,
    defaultView: product.defaultView,
    // Décor de premier plan EFFECTIF : celui du produit s'il en a un, sinon
    // celui de son type d'affiche (le muret de la vue de dos, par exemple).
    // Résolu ici, une fois : le site, le panier et le PDF n'ont plus à
    // connaître la règle.
    foregroundUrl: product.foregroundUrl ?? vue?.foregroundUrl ?? null,
    variants: variants.map((v) => ({
      format: v.format,
      priceCents: v.priceCents,
      widthMm: v.widthMm,
      heightMm: v.heightMm,
    })),
  });
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
/**
 * Réglages lisibles par le SITE — donc par n'importe qui.
 *
 * Certaines clés n'ont rien à y faire : le code d'accès du stand protège des
 * commandes sans paiement, le servir ici reviendrait à l'afficher sur la
 * porte. Tout ce qui commence par « salon. » reste réservé au back-office,
 * qui a sa propre route (GET /admin/salon).
 */
const PREFIXES_PRIVES = ["salon.", "ia."];

app.get("/settings", async (c) => {
  const group = c.req.query("group");
  const rows = await db.select().from(schema.settings);
  const filtered = (group ? rows.filter((r) => r.group === group) : rows).filter(
    (r) => !PREFIXES_PRIVES.some((p) => r.key.startsWith(p)),
  );
  return c.json(
    Object.fromEntries(filtered.map((r) => [r.key, r.value])),
  );
});

/** Promos actives (pour info front / calcul panier ultérieur). */
/** Cadres proposés au client (actifs uniquement), dans l'ordre du BO. */
app.get("/frames", async (c) => {
  const rows = await db
    .select()
    .from(schema.frames)
    .where(eq(schema.frames.active, true))
    .orderBy(asc(schema.frames.position));
  return c.json(rows);
});

/**
 * Types d'affiche actifs (« de face », « de dos », …), dans l'ordre du BO.
 * Le site s'en sert pour proposer les vues sans rien connaître de leurs noms.
 */
app.get("/views", async (c) => {
  const rows = await db
    .select()
    .from(schema.posterViews)
    .where(eq(schema.posterViews.active, true))
    .orderBy(asc(schema.posterViews.position));
  return c.json(rows);
});

/**
 * Inscription à la lettre d'information. Publique, forcément : c'est un
 * visiteur qui la remplit. Une adresse déjà inscrite renvoie le même succès —
 * lui dire « déjà inscrite » révélerait qui est dans la liste.
 */
app.post("/newsletter", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const email = String(b.email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200)
    return c.json({ error: "adresse invalide" }, 400);
  const langue = String(b.langue ?? "").slice(0, 5) || null;
  await db
    .insert(schema.newsletterSubscribers)
    .values({ email, langue })
    .onConflictDoNothing();
  return c.json({ ok: true });
});

app.get("/admin/newsletter", async (c) => {
  const rows = await db
    .select()
    .from(schema.newsletterSubscribers)
    .orderBy(desc(schema.newsletterSubscribers.createdAt));
  return c.json(rows);
});

app.delete("/admin/newsletter/:id", async (c) => {
  await db
    .delete(schema.newsletterSubscribers)
    .where(eq(schema.newsletterSubscribers.id, Number(c.req.param("id"))));
  return c.json({ ok: true });
});

/**
 * Promotions AUTOMATIQUES, celles qui s'appliquent sans rien saisir.
 *
 * Les promotions à code en sont exclues : les exposer ici, c'était les
 * appliquer à tout le monde — et publier la liste des codes par la même
 * occasion.
 */
/**
 * Catalogue de livraison : zones, modes et tarifs. Public, parce que le
 * tunnel de commande doit afficher les frais AVANT de créer la commande.
 * Les modes désactivés n'en font pas partie.
 */
/**
 * Points relais autour d'un code postal.
 *
 * Le compte Mondial Relay n'est pas configuré ? On répond 503 avec un message
 * clair plutôt qu'une liste vide, qui se lirait « aucun point relais par ici ».
 */
app.get("/shipping/relay-points", async (c) => {
  const carrier = String(c.req.query("carrier") ?? "mondial_relay");
  if (!transporteurConfigure(carrier))
    return c.json({ error: "Recherche de points non configurée" }, 503);
  const cp = String(c.req.query("postalCode") ?? "").trim();
  if (!/^[A-Za-z0-9 -]{3,10}$/.test(cp))
    return c.json({ error: "code postal invalide" }, 400);
  const pays = String(c.req.query("country") ?? "FR");
  const ville = String(c.req.query("city") ?? "");
  try {
    const points =
      carrier === "colissimo"
        ? await rechercherPointsRetrait({ codePostal: cp, pays, ville })
        : await rechercherPointsRelais({
            codePostal: cp,
            pays,
            ville,
            nombre: 12,
          });
    return c.json(points);
  } catch (e) {
    console.error("[points de retrait]", carrier, e);
    return c.json({ error: "recherche indisponible" }, 502);
  }
});

app.get("/shipping", async (c) => {
  const [zones, tousModes, tarifs] = await Promise.all([
    db.select().from(schema.shippingZones).orderBy(asc(schema.shippingZones.position)),
    db
      .select()
      .from(schema.shippingMethods)
      .where(eq(schema.shippingMethods.active, true))
      .orderBy(asc(schema.shippingMethods.position)),
    db.select().from(schema.shippingRates),
  ]);
  // Un mode « point relais » suppose de pouvoir CHOISIR son point. Tant que
  // le compte du transporteur n'est pas branché, on ne le propose pas : une
  // adresse saisie à la main ne vaut rien pour l'expédition.
  const modes = tousModes.filter(
    (m) => m.kind !== "relay" || transporteurConfigure(m.carrier),
  );
  return c.json({
    zones,
    modes,
    tarifs: tarifs.map((t) => ({
      methodId: t.methodId,
      zoneId: t.zoneId,
      priceCents: t.priceCents,
      freeFromCents: t.freeFromCents,
      minWeightGrams: t.minWeightGrams,
      maxWeightGrams: t.maxWeightGrams,
      active: t.active,
    })),
  });
});

/** Idem, tout compris (modes désactivés inclus) — gestion au back-office. */
app.get("/admin/shipping", async (c) => {
  const [zones, modes, tarifs] = await Promise.all([
    db.select().from(schema.shippingZones).orderBy(asc(schema.shippingZones.position)),
    db.select().from(schema.shippingMethods).orderBy(asc(schema.shippingMethods.position)),
    db.select().from(schema.shippingRates),
  ]);
  return c.json({ zones, modes, tarifs });
});

/** Modifie un mode de livraison : nom, texte, emplacement de retrait, actif. */
app.post("/admin/shipping/methods/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json();
  const set: Record<string, unknown> = {};
  if (b.name !== undefined) set.name = String(b.name).trim() || "Livraison";
  if (b.description !== undefined)
    set.description = String(b.description).trim() || null;
  if (b.pickupLocation !== undefined)
    set.pickupLocation = String(b.pickupLocation).trim() || null;
  if (b.active !== undefined) set.active = b.active !== false;
  if (b.position !== undefined) set.position = Number(b.position) || 0;
  const [row] = await db
    .update(schema.shippingMethods)
    .set(set)
    .where(eq(schema.shippingMethods.id, id))
    .returning();
  if (!row) return c.notFound();
  return c.json(row);
});

/** Montant en centimes, ou null quand le champ est laissé vide. */
function centimesOuNull(v: unknown): number | null {
  if (v === null || v === "" || v === undefined) return null;
  return Math.max(0, Math.round(Number(v)));
}

/**
 * Bornes d'une tranche de poids, en grammes : de `min` inclus à `max` exclu.
 * Null en haut = pas de limite. Renvoie un message quand la tranche n'a pas
 * de sens — une borne haute sous la borne basse ne facturerait jamais rien.
 */
function trancheLue(
  brut: { minWeightGrams?: unknown; maxWeightGrams?: unknown },
): { min: number; max: number | null } | string {
  const min = Math.round(Number(brut.minWeightGrams ?? 0));
  if (!Number.isFinite(min) || min < 0) return "poids minimum invalide";
  const brutMax = brut.maxWeightGrams;
  if (brutMax === null || brutMax === "" || brutMax === undefined)
    return { min, max: null };
  const max = Math.round(Number(brutMax));
  if (!Number.isFinite(max) || max <= min)
    return "le poids maximum doit dépasser le poids minimum";
  return { min, max };
}

/**
 * Modifie un tarif (prix, franchise de port, tranche de poids, disponibilité).
 *
 * L'unicité porte sur (mode, zone, poids minimum) : réenvoyer une tranche
 * déjà connue la met à jour, en poser une nouvelle l'ajoute à la grille.
 */
app.post("/admin/shipping/rates", async (c) => {
  const b = await c.req.json();
  const methodId = Number(b.methodId);
  const zoneId = Number(b.zoneId);
  if (!Number.isFinite(methodId) || !Number.isFinite(zoneId))
    return c.json({ error: "mode et zone requis" }, 400);
  const tranche = trancheLue(b);
  if (typeof tranche === "string") return c.json({ error: tranche }, 400);
  const valeurs = {
    priceCents: Math.max(0, Math.round(Number(b.priceCents ?? 0))),
    freeFromCents: centimesOuNull(b.freeFromCents),
    minWeightGrams: tranche.min,
    maxWeightGrams: tranche.max,
    active: b.active !== false,
  };
  // L'identifiant explicite l'emporte : il permet de DÉPLACER la borne basse
  // d'une tranche existante, ce que la recherche par (mode, zone, poids) ne
  // saurait pas faire — elle en créerait une seconde à côté.
  const [existant] = b.id
    ? await db
        .select({ id: schema.shippingRates.id })
        .from(schema.shippingRates)
        .where(eq(schema.shippingRates.id, Number(b.id)))
    : await db
        .select({ id: schema.shippingRates.id })
        .from(schema.shippingRates)
        .where(
          and(
            eq(schema.shippingRates.methodId, methodId),
            eq(schema.shippingRates.zoneId, zoneId),
            eq(schema.shippingRates.minWeightGrams, tranche.min),
          ),
        );
  if (existant) {
    const [row] = await db
      .update(schema.shippingRates)
      .set({ methodId, zoneId, ...valeurs })
      .where(eq(schema.shippingRates.id, existant.id))
      .returning();
    return c.json(row);
  }
  const [row] = await db
    .insert(schema.shippingRates)
    .values({ methodId, zoneId, ...valeurs })
    .returning();
  return c.json(row);
});

/** Retire une tranche de la grille. */
app.delete("/admin/shipping/rates/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "identifiant invalide" }, 400);
  await db.delete(schema.shippingRates).where(eq(schema.shippingRates.id, id));
  return c.json({ ok: true });
});

/**
 * Remplace TOUTE la grille tarifaire d'un mode dans une zone.
 *
 * Saisir tranche par tranche laissait vivre les anciennes bornes à côté des
 * nouvelles ; on repart donc de zéro à chaque enregistrement.
 *
 * Une grille est refusée si elle laisse un trou ou si deux tranches se
 * chevauchent : un trou, c'est un colis d'un certain poids que plus personne
 * ne sait livrer, et mieux vaut l'apprendre à la saisie qu'au moment où un
 * client ne peut plus commander. Une grille VIDE reste permise : elle dit que
 * le mode ne dessert pas cette zone.
 */
app.post("/admin/shipping/rates/grille", async (c) => {
  const b = await c.req.json();
  const methodId = Number(b.methodId);
  const zoneId = Number(b.zoneId);
  if (!Number.isFinite(methodId) || !Number.isFinite(zoneId))
    return c.json({ error: "mode et zone requis" }, 400);
  const freeFromCents = centimesOuNull(b.freeFromCents);
  const brutes = Array.isArray(b.tranches) ? b.tranches : [];

  const tranches: { min: number; max: number | null; priceCents: number }[] = [];
  for (const brute of brutes) {
    const bornes = trancheLue(brute);
    if (typeof bornes === "string") return c.json({ error: bornes }, 400);
    tranches.push({
      ...bornes,
      priceCents: Math.max(0, Math.round(Number(brute.priceCents ?? 0))),
    });
  }
  tranches.sort((a, z) => a.min - z.min);

  for (const [i, t] of tranches.entries()) {
    const attendu = i === 0 ? 0 : tranches[i - 1]!.max;
    if (attendu === null)
      return c.json(
        { error: "une tranche sans limite haute doit être la dernière" },
        400,
      );
    if (t.min !== attendu)
      return c.json(
        {
          error:
            t.min > attendu
              ? `trou dans la grille : rien ne couvre ${formaterPoids(attendu)} à ${formaterPoids(t.min)}`
              : `tranches qui se chevauchent à partir de ${formaterPoids(t.min)}`,
        },
        400,
      );
  }

  const count = await db.transaction(async (tx) => {
    await tx
      .delete(schema.shippingRates)
      .where(
        and(
          eq(schema.shippingRates.methodId, methodId),
          eq(schema.shippingRates.zoneId, zoneId),
        ),
      );
    if (tranches.length === 0) return 0;
    const posees = await tx
      .insert(schema.shippingRates)
      .values(
        tranches.map((t) => ({
          methodId,
          zoneId,
          priceCents: t.priceCents,
          freeFromCents,
          minWeightGrams: t.min,
          maxWeightGrams: t.max,
          active: true,
        })),
      )
      .returning({ id: schema.shippingRates.id });
    return posees.length;
  });
  return c.json({ ok: true, count });
});

/**
 * Bornes de poids HABITUELLES de Colissimo et Mondial Relay, sans prix.
 *
 * C'est une aide à la saisie, pas une vérité contractuelle : les transporteurs
 * n'exposent aucune API de tarifs, et les paliers négociés par la cliente
 * peuvent différer. Elle doit confronter ces bornes à sa propre grille avant
 * de les remplir — seuls ses prix à elle font foi.
 */
app.get("/admin/shipping/tranches-standard", (c) => {
  const bornes = (paliers: (number | null)[]) => {
    const tranches: {
      minWeightGrams: number;
      maxWeightGrams: number | null;
      label: string;
    }[] = [];
    let min = 0;
    for (const max of paliers) {
      tranches.push({
        minWeightGrams: min,
        maxWeightGrams: max,
        label:
          max === null
            ? `plus de ${formaterPoids(min)}`
            : min === 0
              ? `jusqu'à ${formaterPoids(max)}`
              : `${formaterPoids(min)} à ${formaterPoids(max)}`,
      });
      if (max === null) break;
      min = max;
    }
    return tranches;
  };
  return c.json({
    colissimo: bornes([
      250, 500, 750, 1000, 2000, 5000, 10000, 15000, 30000,
    ]),
    mondial_relay: bornes([
      500, 1000, 2000, 3000, 5000, 7000, 10000, 15000, 20000, 25000, 30000,
    ]),
  });
});

/** Modifie une zone : son nom et la liste des pays qu'elle couvre. */
app.post("/admin/shipping/zones/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json();
  const set: Record<string, unknown> = {};
  if (b.name !== undefined) set.name = String(b.name).trim() || "Zone";
  if (b.countries !== undefined) {
    // Codes ISO à deux lettres, en majuscules, sans doublon : c'est ce que
    // compare `zonePourPays`.
    const propres = [
      ...new Set(
        (Array.isArray(b.countries) ? b.countries : String(b.countries).split(/[\s,;]+/))
          .map((v: unknown) => String(v).trim().toUpperCase())
          .filter((v: string) => /^[A-Z]{2}$/.test(v)),
      ),
    ];
    set.countries = propres;
  }
  if (b.position !== undefined) set.position = Number(b.position) || 0;
  const [row] = await db
    .update(schema.shippingZones)
    .set(set)
    .where(eq(schema.shippingZones.id, id))
    .returning();
  if (!row) return c.notFound();
  return c.json(row);
});

app.get("/promos", async (c) => {
  const now = new Date();
  const rows = await db
    .select()
    .from(schema.promoRules)
    .where(eq(schema.promoRules.active, true))
    .orderBy(desc(schema.promoRules.priority));
  const active = rows.filter(
    (r) =>
      !r.code &&
      (!r.startsAt || r.startsAt <= now) &&
      (!r.endsAt || r.endsAt >= now),
  );
  return c.json(active);
});

/**
 * Vérifie un code promo saisi au panier.
 *
 * Réponse volontairement avare : la règle qui s'applique, rien de plus. On ne
 * dit jamais qu'un code existe mais est expiré ou désactivé — ce serait aider
 * à deviner les autres.
 */
app.post("/promos/verifier", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const code = normaliserCode(b.code);
  if (!code || code.length > 60)
    return c.json({ error: "code inconnu" }, 404);
  const now = new Date();
  const [regle] = await db
    .select()
    .from(schema.promoRules)
    .where(
      and(
        eq(schema.promoRules.active, true),
        sqlOp`upper(${schema.promoRules.code}) = ${code}`,
      ),
    );
  if (
    !regle ||
    (regle.startsAt && regle.startsAt > now) ||
    (regle.endsAt && regle.endsAt < now)
  )
    return c.json({ error: "code inconnu" }, 404);
  return c.json({
    code,
    name: regle.name,
    type: regle.type,
    config: regle.config,
    priority: regle.priority,
  });
});

// === Authentification back-office ========================================

/**
 * Anti-bruteforce du login : au-delà de LOGIN_MAX_ATTEMPTS échecs par IP dans
 * la fenêtre, on répond 429. En mémoire (un seul process API) — suffisant ici,
 * et sans dépendance supplémentaire, comme le reste du module d'auth.
 */
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
/**
 * La requête est-elle arrivée en HTTPS ?
 *
 * Même raisonnement que pour le cookie client : on regarde l'hôte appelé et
 * l'adresse publique annoncée, puis l'en-tête du proxy. Une variable
 * d'environnement ne dit rien de la requête en cours.
 */
function requeteEnHttps(c: Context): boolean {
  const hote = (c.req.header("host") ?? "").toLowerCase();
  const publique = (process.env.PUBLIC_ORIGIN ?? "").toLowerCase();
  if (hote && publique.startsWith("https://") && publique.endsWith(hote))
    return true;
  const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  return proto === "https" || c.req.url.startsWith("https://");
}

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

/**
 * L'adresse d'où vient l'appel, telle qu'on peut la croire.
 *
 * Le proxy AJOUTE son entrée à « X-Forwarded-For » sans effacer celle qui
 * arrive : le PREMIER élément est donc écrit par l'appelant, qui peut le
 * changer à chaque requête. Un compteur d'essais fondé dessus ne se déclenche
 * jamais, et un mot de passe se devine indéfiniment.
 *
 * Le dernier élément, lui, a été posé par notre propre proxy. C'est le seul
 * qu'on ne puisse pas écrire soi-même.
 */
function clientIp(c: { req: { header: (k: string) => string | undefined } }) {
  const chaine = c.req.header("x-forwarded-for");
  if (chaine) {
    const morceaux = chaine
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    const dernier = morceaux[morceaux.length - 1];
    if (dernier) return dernier;
  }
  return c.req.header("x-real-ip") || "local";
}

function loginRateLimited(key: string): boolean {
  const cur = loginAttempts.get(key);
  return Boolean(cur && cur.resetAt > Date.now() && cur.count >= LOGIN_MAX_ATTEMPTS);
}

function noteFailedLogin(key: string): void {
  const now = Date.now();
  // Purge opportuniste : la table ne doit pas croître indéfiniment.
  if (loginAttempts.size > 500)
    for (const [k, v] of loginAttempts) if (v.resetAt < now) loginAttempts.delete(k);
  const cur = loginAttempts.get(key);
  if (!cur || cur.resetAt < now)
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  else cur.count += 1;
}

app.post("/auth/login", async (c) => {
  const ip = clientIp(c);
  if (loginRateLimited(ip))
    return c.json({ error: "Trop de tentatives, réessayez plus tard" }, 429);
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
    noteFailedLogin(ip);
    return c.json({ error: "Identifiants invalides" }, 401);
  }
  loginAttempts.delete(ip);
  const token = await createSession(user.id);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    // La vraie requête décide, pas une variable d'environnement : NODE_ENV
    // n'est défini nulle part, et le cookie du back-office partait donc sans
    // « Secure » y compris derrière le tunnel en HTTPS.
    secure: requeteEnHttps(c),
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


// Routes configurateur / panier / commandes web / PDF / CRUD personnages.
// Montées ici : les routes /admin/* qu'elles déclarent passent par le
// middleware d'auth ci-dessus ; les routes publiques (/characters, /cart…)
// ne sont pas concernées.
// Commandes AVANT le configurateur : celui-ci déclare « /admin/orders/:id »,
// qui avalerait sinon « /admin/orders/tags » et « /admin/orders/export.csv ».
// Hono retient la première route déclarée qui correspond.
mountOrderRoutes(app);

// Catégories de produits et poids d'expédition (apps/api/src/catalogue.ts).
mountCatalogueRoutes(app);

// Liste des produits vue du back-office et actions groupées. AVANT le
// configurateur, qui déclare « /admin/products/:id/... » : une route
// paramétrée posée d'abord avalerait « /admin/products/bulk » et
// « /admin/products/masse ».
mountProduitsMasse(app);

// Ce qu'une affiche a rapporté, pour sa fiche produit.
mountVentesProduit(app);

// La fiche produit complète du back-office : contenu, médias, formats et
// tarifs, stock, référencement. Un seul aller-retour pour lire, un seul pour
// enregistrer, là où la page interrogeait quatre routes différentes.
mountFicheProduit(app);

// Les collections : la façon dont la boutique range ses affiches, et le poids
// par défaut de ce qu'elles contiennent.
mountCollections(app);

// Import de fiches produit par fichier, et l'image qu'on dépose ensuite sur
// chacune. Après les collections : l'import y range les affiches.
mountImportProduits(app);

// Cartes cadeaux : de l'argent encaissé d'avance, avec son journal et sa
// carte imprimable.
mountCartesCadeaux(app);

// Lettre d'information : l'écrire, l'envoyer par paquets, et le lien de
// désabonnement qui doit fonctionner sans être connecté.
mountLettre(app);

// Pages libres et menu du site, écrits depuis le back-office. Ouvrir un rayon
// « Magnets » ne demande plus de toucher au code.
mountCms(app);

// Banc d'essai des courriers : les voir et s'en envoyer un, sans attendre
// qu'une commande passe.
mountCourriers(app);

// Commandes prises au stand : pas de prix a l'ecran, pas de paiement en ligne.
mountSalonRoutes(app);

// Comptes clients : /compte/* pour la boutique, /admin/customers/* pour le BO.
// Aucune route paramétrée déjà déclarée ne les avale (les /admin/* posées
// avant portent sur /admin/orders et /admin/fulfillments).
mountCompteRoutes(app);

mountConfiguratorRoutes(app);

// Affiches générées par IA (apps/api/src/ia.ts) : envoi de la photo, aperçu
// filigrané, back-office. Monté APRÈS les autres : « /admin/products/:id/ia »
// ne doit pas être avalé par une route paramétrée déclarée plus haut.
mountIaRoutes(app);

/**
 * Marque une commande traitée, ou revient en arrière.
 *
 * « Traitée » veut dire : imprimée, emballée, partie. C'est l'information qui
 * manque le matin pour savoir quoi préparer — le statut de paiement, lui, ne
 * dit rien de ce travail-là.
 */
app.post("/admin/orders/:id/fulfil", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json().catch(() => ({}));
  const traite = b.fulfilled !== false;
  const [row] = await db
    .update(schema.orders)
    .set({ fulfilledAt: traite ? new Date() : null })
    .where(eq(schema.orders.id, id))
    .returning({ id: schema.orders.id, fulfilledAt: schema.orders.fulfilledAt });
  if (!row) return c.notFound();
  // Le journal garde la trace : dans un mois, on saura quand c'est parti.
  await db.insert(schema.orderEvents).values({
    orderId: id,
    kind: "event",
    message: traite
      ? "Commande marquée comme traitée."
      : "Commande remise dans les commandes à traiter.",
  });
  return c.json(row);
});

/** Compteurs complets (catalogue + clients + commandes) — tableau de bord BO. */
app.get("/admin/stats", async (c) => {
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

/**
 * Téléverse un visuel dans data/assets et renvoie son URL publique.
 *
 * Réservé au propriétaire (comme toute écriture /admin/*). Le nom est
 * reconstruit à partir de zéro — jamais celui du client — et l'extension doit
 * figurer dans la liste blanche : c'est ce fichier qui sera ensuite servi par
 * /assets/:file, et rasterisé dans le PDF d'impression.
 */
const UPLOAD_EXT = new Set([".svg", ".png", ".jpg", ".jpeg", ".webp"]);
const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

app.post("/admin/uploads", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) {
    return c.json({ error: "aucun fichier reçu" }, 400);
  }
  if (file.size > UPLOAD_MAX_BYTES) {
    return c.json(
      { error: `fichier trop lourd (max ${UPLOAD_MAX_BYTES / 1048576} Mo)` },
      413,
    );
  }
  const ext = extname(file.name).toLowerCase();
  if (!UPLOAD_EXT.has(ext)) {
    return c.json(
      { error: `extension refusée (acceptées : ${[...UPLOAD_EXT].join(", ")})` },
      415,
    );
  }

  // Nom sûr : on repart du nom d'origine réduit à [a-z0-9-], puis on suffixe
  // pour ne jamais écraser un visuel existant.
  const base =
    basename(file.name, extname(file.name))
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "visuel";
  const suffixe = randomBytes(4).toString("hex");
  const nom = `${base}-${suffixe}${ext}`;

  await writeFile(resolve(ASSETS_DIR, nom), Buffer.from(await file.arrayBuffer()));
  return c.json({ url: `/assets/${nom}`, name: nom, size: file.size });
});

/**
 * Analyse un SVG fraîchement téléversé : ses zones de couleur et le bas réel
 * de son dessin.
 *
 * Ces deux valeurs étaient calculées par des scripts lancés à la main lors de
 * l'import. Sans elles, créer un personnage au back-office demandait de taper
 * « st0 », « st1 »… à l'aveugle et de régler le calage vertical par essais
 * successifs. Le formulaire les remplit maintenant tout seul.
 */
app.post("/admin/svg/analyse", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const brut = String(b.url ?? "").trim();
  if (!brut) return c.json({ error: "url requise" }, 400);
  // On ne lit que dans le dossier des assets : une URL bricolée ne doit pas
  // pouvoir faire lire un fichier quelconque du serveur.
  const nom = basename(brut.split("?")[0] ?? "");
  if (!nom) return c.json({ error: "url invalide" }, 400);
  const chemin = resolve(ASSETS_DIR, nom);
  if (!chemin.startsWith(resolve(ASSETS_DIR)))
    return c.json({ error: "url invalide" }, 400);

  let contenu: Buffer;
  try {
    contenu = await readFile(chemin);
  } catch {
    return c.json({ error: "fichier introuvable" }, 404);
  }

  // Zones recolorables : les classes « .stN{fill:#…} » du SVG.
  const colorZones: Record<string, string> = {};
  if (extname(nom).toLowerCase() === ".svg") {
    const texte = contenu.toString("utf8");
    const re = /\.(st\d+)\s*\{\s*fill\s*:\s*(#[0-9a-fA-F]{3,8})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(texte)) !== null) colorZones[m[1]!] = m[2]!.toUpperCase();
  }

  // Où le dessin se trouve VRAIMENT dans son cadre. Deux usages :
  //  - `bottomPct`, le bas du contenu, pour aligner les pieds sur le muret
  //    (les animaux et les bébés ont du vide sous eux et « flotteraient ») ;
  //  - `bbox`, le rectangle occupé, pour dessiner autour d'une pièce la
  //    poignée de redimensionnement du back-office. Sans lui, il faudrait
  //    encadrer tout le cadre 500×1000 — une boîte immense autour d'une
  //    casquette.
  let bottomPct: number | null = null;
  let bbox: { left: number; top: number; right: number; bottom: number } | null =
    null;
  try {
    const H = 400;
    const { data, info } = await sharp(contenu, { density: 120, unlimited: true })
      .resize(200, H, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const W = info.width;
    let bas = -1;
    let haut = H;
    let gauche = W;
    let droite = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (data[(y * W + x) * info.channels + 3]! <= 20) continue;
        if (y < haut) haut = y;
        if (y > bas) bas = y;
        if (x < gauche) gauche = x;
        if (x > droite) droite = x;
      }
    }
    if (bas >= 0) {
      bottomPct = Number(Math.min(1, Math.max(0.05, bas / H)).toFixed(4));
      // Fractions du cadre : le back-office les multiplie par la taille de sa
      // scène, quelle qu'elle soit.
      bbox = {
        left: Number((gauche / W).toFixed(4)),
        top: Number((haut / H).toFixed(4)),
        right: Number(((droite + 1) / W).toFixed(4)),
        bottom: Number(((bas + 1) / H).toFixed(4)),
      };
    }
  } catch {
    // Rasterisation impossible : on rend les zones sans le calage, plutôt que
    // de faire échouer tout le formulaire.
  }

  return c.json({ url: `/assets/${nom}`, colorZones, bottomPct, bbox });
});

/**
 * Traductions d'un produit, telles que saisies (sans repli) : le back-office
 * doit distinguer « traduit à l'identique » de « pas encore traduit ».
 */
app.get("/admin/products/:id/translations", async (c) => {
  const id = Number(c.req.param("id"));
  const [p] = await db
    .select({
      id: schema.products.id,
      name: schema.products.name,
      description: schema.products.description,
      translations: schema.products.translations,
    })
    .from(schema.products)
    .where(eq(schema.products.id, id));
  if (!p) return c.notFound();
  return c.json({
    id: p.id,
    // Le français de référence, pour l'afficher en regard des champs.
    fr: { name: p.name, description: p.description },
    translations: p.translations ?? {},
  });
});

/**
 * Enregistre les traductions d'UNE langue. Un champ vidé est retiré du
 * dictionnaire plutôt que stocké vide : « vide » et « absent » doivent
 * signifier la même chose — le français s'affiche.
 */
app.post("/admin/products/:id/translations", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json();
  const langue = String(b.lang ?? "");
  if (!["en", "de", "it", "es"].includes(langue)) {
    return c.json({ error: "langue inconnue" }, 400);
  }
  const [p] = await db
    .select({ translations: schema.products.translations })
    .from(schema.products)
    .where(eq(schema.products.id, id));
  if (!p) return c.notFound();

  const propre = (v: unknown) => {
    const s = typeof v === "string" ? v.trim() : "";
    return s || undefined;
  };
  const entree = {
    ...(propre(b.name) ? { name: propre(b.name) } : {}),
    ...(propre(b.description) ? { description: propre(b.description) } : {}),
  };

  const dico = { ...(p.translations ?? {}) };
  if (Object.keys(entree).length) dico[langue] = entree;
  else delete dico[langue];

  const [row] = await db
    .update(schema.products)
    .set({ translations: dico, updatedAt: new Date() })
    .where(eq(schema.products.id, id))
    .returning({ translations: schema.products.translations });
  return c.json({ ok: true, translations: row?.translations ?? {} });
});

/* --------------------------------------------------------------------------
 *  Comptes du back-office
 *
 *  Réservés au PROPRIÉTAIRE, lecture comprise : la liste des comptes dit qui
 *  peut entrer, un vendeur n'a pas à la connaître (le garde-fou global ne
 *  protège que les écritures).
 * ----------------------------------------------------------------------- */

/** L'appelant, s'il est propriétaire ; null sinon. */
async function exigerProprietaire(jeton: string | undefined) {
  const user = await validateSession(jeton);
  if (!user || user.role !== OWNER_ROLE) return null;
  return user;
}

/** Combien de propriétaires reste-t-il ? Sert à ne jamais tomber à zéro. */
async function nombreProprietaires(): Promise<number> {
  const [n] = await db
    .select({ n: count() })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.role, OWNER_ROLE));
  return Number(n?.n ?? 0);
}

/**
 * Chiffres des commandes sur une période, avec la période PRÉCÉDENTE de même
 * durée pour donner une évolution — un nombre seul ne dit pas grand-chose.
 *
 * Seules les commandes payées comptent : un panier abandonné n'est pas une
 * vente, et les gonfler ferait mentir le tableau de bord.
 */
app.get("/admin/stats/orders", async (c) => {
  const jours = Math.min(365, Math.max(1, Number(c.req.query("days") ?? 30)));
  const canal = String(c.req.query("channel") ?? "");
  const maintenant = new Date();
  const debut = new Date(maintenant.getTime() - jours * 86400000);
  const debutPrecedent = new Date(maintenant.getTime() - 2 * jours * 86400000);

  const conditions = [
    eq(schema.orders.status, "paid"),
    gte(schema.orders.createdAt, debutPrecedent),
  ];
  if (canal === "web" || canal === "salon")
    conditions.push(eq(schema.orders.channel, canal));
  // Un stand précis : c'est la question du retour de salon, « celui-là,
  // combien a-t-il fait ».
  const standDemande = Number(c.req.query("stand"));
  if (Number.isInteger(standDemande) && standDemande > 0)
    conditions.push(eq(schema.orders.standId, standDemande));

  // Un vendeur ne voit que le stand, quoi qu'il demande. Le filtre est posé
  // ici et non dans l'écran : une adresse tapée à la main doit buter sur la
  // même règle qu'un bouton.
  const utilisateur = c.get("utilisateur");
  if (utilisateur && utilisateur.role !== OWNER_ROLE) {
    conditions.push(eq(schema.orders.channel, "salon"));
    if (typeof utilisateur.standId === "number" && utilisateur.standId > 0)
      conditions.push(eq(schema.orders.standId, utilisateur.standId));
  }

  const lignes = await db
    .select({
      id: schema.orders.id,
      createdAt: schema.orders.createdAt,
      totalCents: schema.orders.totalCents,
      shippingCents: schema.orders.shippingCents,
      fulfilledAt: schema.orders.fulfilledAt,
    })
    .from(schema.orders)
    .where(and(...conditions));

  // Articles vendus : la somme des quantités des lignes de ces commandes.
  const ids = lignes.map((l) => l.id);
  const articles = ids.length
    ? await db
        .select({
          orderId: schema.orderItems.orderId,
          quantity: schema.orderItems.quantity,
        })
        .from(schema.orderItems)
        .where(inArray(schema.orderItems.orderId, ids))
    : [];
  const parCommande = new Map<number, number>();
  for (const a of articles)
    parCommande.set(a.orderId, (parCommande.get(a.orderId) ?? 0) + a.quantity);

  const dansPeriode = (d: Date) => d >= debut;
  const resume = (garder: (d: Date) => boolean) => {
    const sel = lignes.filter((l) => garder(l.createdAt));
    return {
      commandes: sel.length,
      articles: sel.reduce((s, l) => s + (parCommande.get(l.id) ?? 0), 0),
      caCents: sel.reduce((s, l) => s + l.totalCents, 0),
      portCents: sel.reduce((s, l) => s + l.shippingCents, 0),
    };
  };

  // Une valeur par jour, pour la courbe. Le jour le plus ancien en premier.
  const serie: number[] = [];
  for (let i = jours - 1; i >= 0; i--) {
    const fin = new Date(maintenant.getTime() - i * 86400000);
    const deb = new Date(fin.getTime() - 86400000);
    serie.push(
      lignes.filter((l) => l.createdAt > deb && l.createdAt <= fin).length,
    );
  }

  // Ce qui reste à préparer sur la période : le chiffre qui dit quoi faire
  // aujourd'hui, là où les autres disent ce qui s'est passé.
  const aTraiter = lignes.filter(
    (l) => dansPeriode(l.createdAt) && !l.fulfilledAt,
  ).length;

  return c.json({
    jours,
    periode: { ...resume(dansPeriode), aTraiter },
    precedent: resume((d) => !dansPeriode(d)),
    serie,
  });
});

app.get("/admin/users", async (c) => {
  const moi = await exigerProprietaire(getCookie(c, SESSION_COOKIE));
  if (!moi) return c.json({ error: "Réservé au propriétaire" }, 403);
  const rows = await db
    .select({
      id: schema.adminUsers.id,
      email: schema.adminUsers.email,
      role: schema.adminUsers.role,
      createdAt: schema.adminUsers.createdAt,
    })
    .from(schema.adminUsers)
    .orderBy(asc(schema.adminUsers.id));
  // Sessions ouvertes : dit d'un coup d'œil quels comptes servent vraiment.
  const ouvertes = await db
    .select({
      adminUserId: schema.sessions.adminUserId,
      expiresAt: schema.sessions.expiresAt,
    })
    .from(schema.sessions);
  const actifs = new Set(
    ouvertes
      .filter((s) => s.expiresAt.getTime() > Date.now())
      .map((s) => s.adminUserId),
  );
  return c.json(
    rows.map((r) => ({
      ...r,
      connecte: actifs.has(r.id),
      moi: r.id === moi.adminUserId,
    })),
  );
});

/**
 * Crée un compte, ou change le rôle et/ou le mot de passe d'un compte
 * existant.
 *
 * Deux garde-fous, parce qu'un back-office sans propriétaire ne se répare pas
 * depuis le back-office : on ne rétrograde pas le dernier propriétaire, et on
 * ne change pas son propre rôle (on se verrouillerait dehors d'un clic).
 */
app.post("/admin/users", async (c) => {
  const moi = await exigerProprietaire(getCookie(c, SESSION_COOKIE));
  if (!moi) return c.json({ error: "Réservé au propriétaire" }, 403);
  const b = await c.req.json();
  const email = String(b.email ?? "").trim().toLowerCase();
  const role = b.role === "seller" ? "seller" : OWNER_ROLE;
  const motDePasse = String(b.password ?? "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return c.json({ error: "adresse e-mail invalide" }, 400);
  if (motDePasse && motDePasse.length < 10)
    return c.json({ error: "mot de passe : 10 caractères minimum" }, 400);

  const id = b.id ? Number(b.id) : null;
  if (id) {
    const [avant] = await db
      .select({ id: schema.adminUsers.id, role: schema.adminUsers.role })
      .from(schema.adminUsers)
      .where(eq(schema.adminUsers.id, id));
    if (!avant) return c.notFound();
    if (avant.id === moi.adminUserId && role !== avant.role)
      return c.json({ error: "on ne change pas son propre rôle" }, 400);
    if (
      avant.role === OWNER_ROLE &&
      role !== OWNER_ROLE &&
      (await nombreProprietaires()) <= 1
    )
      return c.json({ error: "il faut au moins un propriétaire" }, 400);
    const [row] = await db
      .update(schema.adminUsers)
      .set({
        email,
        role,
        ...(motDePasse ? { passwordHash: await hashPassword(motDePasse) } : {}),
      })
      .where(eq(schema.adminUsers.id, id))
      .returning({ id: schema.adminUsers.id, email: schema.adminUsers.email });
    // Changement de mot de passe : on ferme les sessions ouvertes de ce
    // compte, sinon l'ancien mot de passe continue de donner accès.
    if (motDePasse)
      await db.delete(schema.sessions).where(eq(schema.sessions.adminUserId, id));
    return c.json(row);
  }

  if (!motDePasse)
    return c.json({ error: "mot de passe requis pour un nouveau compte" }, 400);
  const [existe] = await db
    .select({ id: schema.adminUsers.id })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.email, email));
  if (existe) return c.json({ error: "cette adresse a déjà un compte" }, 409);
  const [row] = await db
    .insert(schema.adminUsers)
    .values({ email, role, passwordHash: await hashPassword(motDePasse) })
    .returning({ id: schema.adminUsers.id, email: schema.adminUsers.email });
  return c.json(row);
});

/**
 * Supprime un compte. Ni le sien (on se mettrait dehors), ni le dernier
 * propriétaire. Les sessions du compte tombent avec lui (cascade).
 */
app.delete("/admin/users/:id", async (c) => {
  const moi = await exigerProprietaire(getCookie(c, SESSION_COOKIE));
  if (!moi) return c.json({ error: "Réservé au propriétaire" }, 403);
  const id = Number(c.req.param("id"));
  if (id === moi.adminUserId)
    return c.json({ error: "on ne supprime pas son propre compte" }, 400);
  const [cible] = await db
    .select({ role: schema.adminUsers.role })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.id, id));
  if (!cible) return c.notFound();
  if (cible.role === OWNER_ROLE && (await nombreProprietaires()) <= 1)
    return c.json({ error: "il faut au moins un propriétaire" }, 400);
  await db.delete(schema.adminUsers).where(eq(schema.adminUsers.id, id));
  return c.json({ ok: true });
});

/** Ferme toutes les sessions d'un compte — le remet à la porte. */
app.post("/admin/users/:id/deconnecter", async (c) => {
  const moi = await exigerProprietaire(getCookie(c, SESSION_COOKIE));
  if (!moi) return c.json({ error: "Réservé au propriétaire" }, 403);
  const id = Number(c.req.param("id"));
  await db.delete(schema.sessions).where(eq(schema.sessions.adminUserId, id));
  return c.json({ ok: true });
});

/** Tous les cadres, actifs ou non — gestion au back-office. */
app.get("/admin/frames", async (c) => {
  const rows = await db
    .select()
    .from(schema.frames)
    .orderBy(asc(schema.frames.position));
  return c.json(rows);
});

/** Crée ou met à jour un cadre (nom, prix, couleur d'aperçu, ordre, actif). */
app.post("/admin/frames", async (c) => {
  const b = await c.req.json();
  const name = String(b.name ?? "").trim();
  if (!name) return c.json({ error: "nom requis" }, 400);
  const valeurs = {
    name,
    priceCents: Math.max(0, Math.round(Number(b.priceCents ?? 0))),
    weightGrams: Math.max(0, Math.round(Number(b.weightGrams ?? 0))),
    previewColor: b.previewColor ? String(b.previewColor) : null,
    active: b.active !== false,
    position: Number(b.position ?? 0),
  };
  if (b.id) {
    const [row] = await db
      .update(schema.frames)
      .set(valeurs)
      .where(eq(schema.frames.id, Number(b.id)))
      .returning();
    if (!row) return c.notFound();
    return c.json(row);
  }
  const base =
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "cadre";
  const pris = new Set(
    (await db.select({ slug: schema.frames.slug }).from(schema.frames)).map(
      (r) => r.slug,
    ),
  );
  let slug = base;
  for (let i = 2; pris.has(slug); i++) slug = `${base}-${i}`;
  const [row] = await db
    .insert(schema.frames)
    .values({ ...valeurs, slug })
    .returning();
  return c.json(row);
});

/**
 * Retire un cadre du catalogue. Les commandes passées ne bougent pas : leur
 * prix a été figé à l'achat, le cadre n'y est plus relu.
 */
app.delete("/admin/frames/:id", async (c) => {
  const [row] = await db
    .delete(schema.frames)
    .where(eq(schema.frames.id, Number(c.req.param("id"))))
    .returning();
  if (!row) return c.notFound();
  return c.json({ ok: true });
});

/** Tous les types d'affiche, avec ce qui s'y rattache (pour le BO). */
app.get("/admin/views", async (c) => {
  const rows = await db
    .select()
    .from(schema.posterViews)
    .orderBy(asc(schema.posterViews.position));
  // Un type rattaché à des dessins ne se supprime pas : on compte d'abord.
  const usages = await Promise.all(
    rows.map(async (v) => {
      const [p] = await db
        .select({ n: count() })
        .from(schema.products)
        .where(eq(schema.products.defaultView, v.slug));
      const [ct] = await db
        .select({ n: count() })
        .from(schema.characterTypes)
        .where(eq(schema.characterTypes.orientation, v.slug));
      const [a] = await db
        .select({ n: count() })
        .from(schema.assets)
        .where(eq(schema.assets.view, v.slug));
      return {
        ...v,
        usage: {
          produits: Number(p?.n ?? 0),
          personnages: Number(ct?.n ?? 0),
          pieces: Number(a?.n ?? 0),
        },
      };
    }),
  );
  return c.json(usages);
});

/**
 * Crée ou renomme un type d'affiche.
 *
 * Le `slug` est posé à la création et ne bouge plus : c'est lui qui relie les
 * personnages, les pièces et les produits à leur type. Le renommer les
 * détacherait tous d'un coup.
 */
app.post("/admin/views", async (c) => {
  const b = await c.req.json();
  const name = String(b.name ?? "").trim();
  if (!name) return c.json({ error: "nom requis" }, 400);
  const valeurs = {
    name,
    foregroundUrl: b.foregroundUrl ? String(b.foregroundUrl).trim() : null,
    active: b.active !== false,
    position: Number(b.position ?? 0),
  };
  if (b.id) {
    const [row] = await db
      .update(schema.posterViews)
      .set(valeurs)
      .where(eq(schema.posterViews.id, Number(b.id)))
      .returning();
    if (!row) return c.notFound();
    return c.json(row);
  }
  const base =
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "vue";
  const pris = new Set(
    (
      await db.select({ slug: schema.posterViews.slug }).from(schema.posterViews)
    ).map((r) => r.slug),
  );
  let slug = base;
  for (let i = 2; pris.has(slug); i++) slug = `${base}-${i}`;
  const [row] = await db
    .insert(schema.posterViews)
    .values({ ...valeurs, slug })
    .returning();
  return c.json(row);
});

/**
 * Supprime un type d'affiche — seulement s'il ne sert plus à rien.
 *
 * Sinon ses personnages, pièces et produits pointeraient sur un type qui
 * n'existe plus : le configurateur n'aurait plus rien à proposer. Le BO
 * propose alors de le désactiver, ce qui le retire du site sans casser
 * l'existant.
 */
app.delete("/admin/views/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const [vue] = await db
    .select()
    .from(schema.posterViews)
    .where(eq(schema.posterViews.id, id));
  if (!vue) return c.notFound();
  const [p] = await db
    .select({ n: count() })
    .from(schema.products)
    .where(eq(schema.products.defaultView, vue.slug));
  const [ct] = await db
    .select({ n: count() })
    .from(schema.characterTypes)
    .where(eq(schema.characterTypes.orientation, vue.slug));
  const [a] = await db
    .select({ n: count() })
    .from(schema.assets)
    .where(eq(schema.assets.view, vue.slug));
  const usage = {
    produits: Number(p?.n ?? 0),
    personnages: Number(ct?.n ?? 0),
    pieces: Number(a?.n ?? 0),
  };
  if (usage.produits + usage.personnages + usage.pieces > 0) {
    return c.json({ error: "type encore utilisé", usage }, 409);
  }
  await db.delete(schema.posterViews).where(eq(schema.posterViews.id, id));
  return c.json({ ok: true });
});

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
