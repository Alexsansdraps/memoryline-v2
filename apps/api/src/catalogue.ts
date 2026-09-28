/**
 * Catégories de produits et poids d'expédition.
 *
 * Le poids n'a qu'un usage : décider de la tranche d'affranchissement. Il est
 * donc traité comme un réglage de catalogue, pas comme une donnée technique —
 * la cliente le saisit une fois par collection (« une affiche pèse 60 g »), et
 * ne le reprend produit par produit que lorsqu'un article sort de l'ordinaire.
 * Les catégories, elles, n'ont jamais reçu une seule ligne : leurs routes
 * restent servies, mais ce sont les collections qui portent le poids.
 *
 * La résolution en cascade (variante → produit → collection) vit dans
 * `@memoryline/types` (poids.ts) pour que la boutique, l'API et le back-office
 * ne puissent pas en donner trois réponses différentes. Quand un produit est
 * rangé dans plusieurs collections, c'est LA PLUS LOURDE de celles qui se
 * prononcent qui l'emporte (voir `poidsDesCollections`).
 */
import type { Hono } from "hono";
import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNull,
  or,
  sql as raw,
} from "drizzle-orm";
import { poidsDesCollections } from "./collections.js";
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
      .where(
        and(
          eq(schema.productCategories.active, true),
          // Archivée = rangée : elle quitte le site, comme une décochée.
          isNull(schema.productCategories.archivedAt),
        ),
      )
      .orderBy(
        asc(schema.productCategories.position),
        asc(schema.productCategories.name),
      );
    return c.json(rows);
  });

  /**
   * Catégories du back-office, avec le nombre de produits rangés dedans.
   *
   * Les archivées viennent AVEC, marquées par leur `archivedAt` : l'écran les
   * range dans sa section « Catégories archivées » sans redemander la liste.
   */
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
   * Archive une catégorie de produits, ou la restaure.
   *
   * La suppression définitive a été RETIRÉE. Elle n'était permise que sur une
   * catégorie vide, et pour cause : effacer la ligne remettait à zéro le
   * `category_id` de tout ce qu'elle rangeait (`on delete set null`). Les
   * produits perdaient d'un coup leur rangement ET le poids par défaut qu'elle
   * leur donnait — donc leur affranchissement —, sans que rien ne le signale.
   *
   * Archivée, elle peut donc l'être PLEINE : le rangement reste intact, c'est
   * ce qui permet de la restaurer complète. `dedans` dit combien de produits
   * elle range, pour que l'écran puisse le redire.
   */
  app.post("/admin/product-categories/:id/archive", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0)
      return c.json(
        { error: "Cette catégorie n'existe plus. Rechargez la liste." },
        400,
      );
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    // Défaut : on archive. Seul un « archived: false » explicite restaure.
    const archiver = b.archived !== false;

    const [ligne] = await db
      .update(schema.productCategories)
      .set({ archivedAt: archiver ? new Date() : null })
      .where(eq(schema.productCategories.id, id))
      .returning({ archivedAt: schema.productCategories.archivedAt });
    if (!ligne)
      return c.json(
        { error: "Cette catégorie n'existe plus. Rechargez la liste." },
        400,
      );

    const [{ n } = { n: 0 }] = await db
      .select({ n: count() })
      .from(schema.products)
      .where(eq(schema.products.categoryId, id));

    return c.json({
      ok: true,
      archived: ligne.archivedAt != null,
      dedans: Number(n),
    });
  });

  /** Range un lot de produits dans une catégorie (null = les en sort). */
  app.post("/admin/products/category", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const ids = (Array.isArray(b.ids) ? (b.ids as unknown[]) : [])
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n));
    if (!ids.length) return c.json({ error: "aucun produit" }, 400);
    const categoryId = b.categoryId === null ? null : Number(b.categoryId);
    // On peut toujours SORTIR d'une catégorie archivée — c'est du ménage. Y
    // ranger un lot, non : la catégorie étant rangée, le rayon resterait
    // introuvable sur le site, et le seul effet visible serait le poids par
    // défaut qu'elle donne aux colis.
    if (categoryId !== null) {
      const [cible] = await db
        .select({ archivedAt: schema.productCategories.archivedAt })
        .from(schema.productCategories)
        .where(eq(schema.productCategories.id, categoryId));
      if (!cible)
        return c.json(
          { error: "Cette catégorie n'existe plus. Rechargez la page." },
          400,
        );
      if (cible.archivedAt)
        return c.json(
          {
            error:
              "Cette catégorie est archivée. Restaurez-la avant d'y ranger des produits.",
          },
          400,
        );
    }
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
   * Ce qu'il faut pour régler le poids d'un produit : ses collections, son
   * poids propre, celui de chaque variante, et le poids effectif qui en
   * découle.
   *
   * Le back-office affiche « 60 g (de la collection Villes) » plutôt qu'un
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
    // Le choix proposé : les catégories non archivées, PLUS celle où le
    // produit se trouve déjà. Sans elle, une catégorie rangée disparaîtrait
    // de la liste déroulante, et le premier enregistrement de la fiche en
    // sortirait l'affiche sans que personne ne l'ait demandé.
    const categories = await db
      .select()
      .from(schema.productCategories)
      .where(
        produit.categoryId
          ? or(
              isNull(schema.productCategories.archivedAt),
              eq(schema.productCategories.id, produit.categoryId),
            )
          : isNull(schema.productCategories.archivedAt),
      )
      .orderBy(asc(schema.productCategories.position));

    // Le poids annoncé par les collections du produit. La plus lourde
    // l'emporte : un colis surestimé se paie quelques centimes, un colis
    // sous-affranchi revient en surtaxe sans que rien ne l'ait signalé.
    //
    // Les collections ARCHIVÉES comptent ici, et c'est voulu : le rangement
    // survit à l'archivage, et une affiche ne change pas de poids parce qu'on
    // a rangé le rayon où elle se trouvait. Les ignorer allégerait des colis
    // en silence, le jour où l'on fait du ménage.
    const liens = await db
      .select({ defaultWeightGrams: schema.collections.defaultWeightGrams })
      .from(schema.productCollections)
      .innerJoin(
        schema.collections,
        eq(schema.productCollections.collectionId, schema.collections.id),
      )
      .where(eq(schema.productCollections.productId, id));
    const poidsCollections = poidsDesCollections(
      liens.map((l) => l.defaultWeightGrams),
    );

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
          v.weightGrams ?? produit.weightGrams ?? poidsCollections ?? 0,
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
   * produit, ni sur une seule de ses collections.
   *
   * C'est le garde-fou de tout le dispositif : un seul produit oublié suffit à
   * sous-affranchir un colis, et rien d'autre ne le signalerait.
   *
   * Un poids de zéro compte pour un poids manquant. Aucun colis ne pèse rien,
   * et laisser passer ce zéro reviendrait à éteindre l'alerte exactement là où
   * elle sert.
   */
  app.get("/admin/products/sans-poids", async (c) => {
    const rows = await db
      .select({
        id: schema.products.id,
        name: schema.products.name,
        slug: schema.products.slug,
      })
      .from(schema.products)
      .where(
        and(
          isNull(schema.products.weightGrams),
          raw`not exists (select 1 from ${schema.productCollections} pc join ${schema.collections} col on col.id = pc.collection_id where pc.product_id = ${schema.products.id} and coalesce(col.default_weight_grams, 0) > 0)`,
          raw`not exists (select 1 from ${schema.variants} v where v.product_id = ${schema.products.id} and v.weight_grams is not null)`,
        ),
      )
      .orderBy(asc(schema.products.name));
    return c.json(rows);
  });
}
