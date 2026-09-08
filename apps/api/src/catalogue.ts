/**
 * Catégories de produits et poids d'expédition.
 *
 * Le poids n'a qu'un usage : décider de la tranche d'affranchissement. Il est
 * donc traité comme un réglage de catalogue, pas comme une donnée technique —
 * la cliente le saisit une fois par catégorie (« une affiche pèse 60 g »), et
 * ne le reprend produit par produit que lorsqu'un article sort de l'ordinaire.
 *
 * La résolution en cascade (variante → produit → catégorie) vit dans
 * `@memoryline/types` (poids.ts) pour que la boutique, l'API et le back-office
 * ne puissent pas en donner trois réponses différentes.
 */
import type { Hono } from "hono";
import { and, asc, count, eq, inArray, isNull, sql as raw } from "drizzle-orm";
import { db, schema } from "./db/client.js";

/** Slug lisible et stable : accents retirés, tout en minuscules. */
function slugifier(nom: string): string {
  return (
    nom
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "categorie"
  );
}

/** Entier de grammes, ou null si le champ est laissé vide. */
function grammes(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function mountCatalogueRoutes(app: Hono): void {
  /* ---------------------------------------------------------------------- */
  /*  Catégories de produits                                                */
  /* ---------------------------------------------------------------------- */

  /** Catégories actives — le site s'en sert pour ranger le catalogue. */
  app.get("/product-categories", async (c) => {
    const rows = await db
      .select()
      .from(schema.productCategories)
      .where(eq(schema.productCategories.active, true))
      .orderBy(
        asc(schema.productCategories.position),
        asc(schema.productCategories.name),
      );
    return c.json(rows);
  });

  /** Catégories du back-office, avec le nombre de produits rangés dedans. */
  app.get("/admin/product-categories", async (c) => {
    const rows = await db
      .select()
      .from(schema.productCategories)
      .orderBy(
        asc(schema.productCategories.position),
        asc(schema.productCategories.name),
      );
    const compte = await db
      .select({ categoryId: schema.products.categoryId, n: count() })
      .from(schema.products)
      .groupBy(schema.products.categoryId);
    const parId = new Map(compte.map((r) => [r.categoryId, Number(r.n)]));
    return c.json(rows.map((r) => ({ ...r, produits: parId.get(r.id) ?? 0 })));
  });

  /** Crée ou met à jour une catégorie. */
  app.post("/admin/product-categories", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const nom = String(b.name ?? "").trim();
    if (!nom) return c.json({ error: "nom requis" }, 400);
    const donnees = {
      name: nom.slice(0, 80),
      description: String(b.description ?? "").trim() || null,
      defaultWeightGrams: grammes(b.defaultWeightGrams) ?? 0,
      active: b.active !== false,
      position: Number(b.position ?? 0) || 0,
    };

    if (b.id) {
      // Le slug ne suit PAS le renommage : il peut servir d'ancre ailleurs, et
      // une catégorie renommée reste la même catégorie.
      const [row] = await db
        .update(schema.productCategories)
        .set(donnees)
        .where(eq(schema.productCategories.id, Number(b.id)))
        .returning();
      if (!row) return c.notFound();
      return c.json(row);
    }

    // Slug unique : deux « Magnets » se distinguent par un suffixe plutôt que
    // de faire échouer la création sur une contrainte incompréhensible.
    const base = slugifier(nom);
    const pris = await db
      .select({ slug: schema.productCategories.slug })
      .from(schema.productCategories);
    const existants = new Set(pris.map((p) => p.slug));
    let slug = base;
    for (let i = 2; existants.has(slug); i++) slug = `${base}-${i}`;

    const [row] = await db
      .insert(schema.productCategories)
      .values({ ...donnees, slug })
      .returning();
    return c.json(row, 201);
  });

  /**
   * Supprime une catégorie vide.
   *
   * On refuse tant qu'elle contient des produits : la supprimer les laisserait
   * sans poids par défaut, et donc avec des frais de port faux, sans que rien
   * ne le signale.
   */
  app.delete("/admin/product-categories/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const [{ n } = { n: 0 }] = await db
      .select({ n: count() })
      .from(schema.products)
      .where(eq(schema.products.categoryId, id));
    if (Number(n) > 0)
      return c.json(
        {
          error: `${n} produit(s) sont rangés dans cette catégorie. Déplacez-les d'abord.`,
        },
        409,
      );
    await db
      .delete(schema.productCategories)
      .where(eq(schema.productCategories.id, id));
    return c.json({ ok: true });
  });

  /** Range un lot de produits dans une catégorie (null = les en sort). */
  app.post("/admin/products/category", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const ids = (Array.isArray(b.ids) ? (b.ids as unknown[]) : [])
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n));
    if (!ids.length) return c.json({ error: "aucun produit" }, 400);
    const categoryId = b.categoryId === null ? null : Number(b.categoryId);
    await db
      .update(schema.products)
      .set({ categoryId })
      .where(inArray(schema.products.id, ids));
    return c.json({ ok: true, count: ids.length });
  });

  /* ---------------------------------------------------------------------- */
  /*  Poids d'un produit                                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * Ce qu'il faut pour régler le poids d'un produit : sa catégorie, son poids
   * propre, celui de chaque variante, et le poids effectif qui en découle.
   *
   * Le back-office affiche « 60 g (de la catégorie Affiches) » plutôt qu'un
   * champ vide : c'est la seule façon de voir d'un coup d'œil ce qui sera
   * réellement pesé.
   */
  app.get("/admin/products/:id/logistique", async (c) => {
    const id = Number(c.req.param("id"));
    const [produit] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, id));
    if (!produit) return c.notFound();
    const [categorie] = produit.categoryId
      ? await db
          .select()
          .from(schema.productCategories)
          .where(eq(schema.productCategories.id, produit.categoryId))
      : [];
    const variantes = await db
      .select()
      .from(schema.variants)
      .where(eq(schema.variants.productId, id))
      .orderBy(asc(schema.variants.format));
    const categories = await db
      .select()
      .from(schema.productCategories)
      .orderBy(asc(schema.productCategories.position));

    return c.json({
      produit: {
        id: produit.id,
        name: produit.name,
        categoryId: produit.categoryId,
        weightGrams: produit.weightGrams,
      },
      categorie: categorie ?? null,
      categories,
      variantes: variantes.map((v) => ({
        id: v.id,
        format: v.format,
        sku: v.sku,
        weightGrams: v.weightGrams,
        /** Ce qui sera réellement pesé, cadre non compris. */
        poidsEffectif:
          v.weightGrams ??
          produit.weightGrams ??
          categorie?.defaultWeightGrams ??
          0,
      })),
    });
  });

  /** Enregistre la catégorie et les poids d'un produit et de ses variantes. */
  app.post("/admin/products/:id/logistique", async (c) => {
    const id = Number(c.req.param("id"));
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const [produit] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, id));
    if (!produit) return c.notFound();

    await db
      .update(schema.products)
      .set({
        categoryId:
          b.categoryId === null || b.categoryId === ""
            ? null
            : Number(b.categoryId),
        weightGrams: grammes(b.weightGrams),
      })
      .where(eq(schema.products.id, id));

    for (const v of (Array.isArray(b.variantes) ? b.variantes : []) as {
      id: number;
      weightGrams?: unknown;
    }[]) {
      await db
        .update(schema.variants)
        .set({ weightGrams: grammes(v.weightGrams) })
        .where(
          and(
            eq(schema.variants.id, Number(v.id)),
            eq(schema.variants.productId, id),
          ),
        );
    }
    return c.json({ ok: true });
  });

  /* ---------------------------------------------------------------------- */
  /*  Poids des cadres                                                      */
  /* ---------------------------------------------------------------------- */

  /**
   * Poids d'un cadre, en grammes.
   *
   * Séparé de la fiche cadre parce qu'il ne se règle pas au même moment : le
   * prix se décide en vendant, le poids en pesant un exemplaire.
   */
  app.post("/admin/frames/:id/poids", async (c) => {
    const id = Number(c.req.param("id"));
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const [row] = await db
      .update(schema.frames)
      .set({ weightGrams: grammes(b.weightGrams) ?? 0 })
      .where(eq(schema.frames.id, id))
      .returning();
    if (!row) return c.notFound();
    return c.json(row);
  });

  /* ---------------------------------------------------------------------- */
  /*  Produits sans poids                                                   */
  /* ---------------------------------------------------------------------- */

  /**
   * Les produits dont le poids est inconnu — ni sur la variante, ni sur le
   * produit, ni sur une catégorie.
   *
   * C'est le garde-fou de tout le dispositif : un seul produit oublié suffit à
   * sous-affranchir un colis, et rien d'autre ne le signalerait.
   */
  app.get("/admin/products/sans-poids", async (c) => {
    const rows = await db
      .select({
        id: schema.products.id,
        name: schema.products.name,
        slug: schema.products.slug,
      })
      .from(schema.products)
      .leftJoin(
        schema.productCategories,
        eq(schema.products.categoryId, schema.productCategories.id),
      )
      .where(
        and(
          isNull(schema.products.weightGrams),
          raw`coalesce(${schema.productCategories.defaultWeightGrams}, 0) = 0`,
          raw`not exists (select 1 from ${schema.variants} v where v.product_id = ${schema.products.id} and v.weight_grams is not null)`,
        ),
      )
      .orderBy(asc(schema.products.name));
    return c.json(rows);
  });
}
