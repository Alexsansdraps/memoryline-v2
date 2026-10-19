/**
 * L'ordre d'affichage des affiches, réglé à la main — sur CHAQUE page de liste.
 *
 * Les COLLECTIONS avaient déjà le leur : on attrape une affiche, on la range,
 * et la page de la collection suit. Mais les pages où les clientes arrivent —
 * « Affiches personnalisables », « Affiches prêtes à imprimer » et « Toutes
 * les affiches » — ne sont pas des collections : ce sont des genres, ou le
 * catalogue entier. Elles se rangeaient par nouveautés, et rien ne permettait
 * de mettre devant ce qui se vend (« il faut que je puisse le faire par pages
 * aussi, pas seulement sur la page d'accueil », Margaux, carte Trello).
 *
 * Chaque affiche porte donc deux rangs :
 *
 *   - `ordre_affichage`, propre à son genre — une affiche n'appartient qu'à un
 *     seul genre, un seul rang suffit pour les deux pages de genre ;
 *   - `ordre_catalogue`, pour « Toutes les affiches », qui mêle les deux
 *     genres : les rangs de chacun, réglés séparément, s'y seraient marché
 *     dessus.
 *
 * Même convention pour les deux :
 *
 *   0          = pas encore rangée ;
 *   1, 2, 3…   = sa place, dans l'ordre voulu.
 *
 * Les affiches rangées passent devant, dans l'ordre ; les autres suivent, les
 * plus récentes d'abord. Deux conséquences voulues :
 *
 *   - tant que rien n'est rangé, la page reste triée par nouveautés, comme
 *     avant — rien ne change pour les clientes avant qu'on s'en serve ;
 *   - une affiche ajoutée plus tard arrive APRÈS l'ordre établi, comme dans
 *     une collection manuelle de Shopify : elle ne bouscule pas le rangement.
 *
 * Les collections, elles, gardent leur rang dans `product_collection.position`
 * (collections.ts) ; cet écran les LIT ici pour qu'il n'y ait qu'un seul
 * endroit où ranger des affiches, quelle que soit la page.
 */
import type { Hono } from "hono";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  sql as sqlOp,
} from "drizzle-orm";
import { db, schema } from "./db/client.js";
import { ordreDesCollections } from "./collections.js";

const GENRES = ["personnalisable", "prete_a_imprimer"] as const;
type Genre = (typeof GENRES)[number];

/** Ce qu'on range ici sans passer par une collection : un genre, ou tout. */
type PageRangee = Genre | "tout";

function estGenre(v: string): v is Genre {
  return (GENRES as readonly string[]).includes(v);
}

function estPageRangee(v: string): v is PageRangee {
  return v === "tout" || estGenre(v);
}

/**
 * L'ordre manuel d'un genre, en clauses SQL : les rangées d'abord, dans
 * l'ordre, puis les autres par nouveauté. Partagé avec la boutique, pour que
 * l'écran de rangement et la page publique ne puissent pas se contredire.
 */
export function ordreManuelDuGenre() {
  return [
    // `false` avant `true` : une affiche rangée (rang non nul) passe devant.
    sqlOp`(${schema.products.ordreAffichage} = 0) asc`,
    asc(schema.products.ordreAffichage),
    desc(schema.products.createdAt),
    desc(schema.products.id),
  ];
}

/**
 * L'ordre manuel de « Toutes les affiches », la page sans filtre : même
 * règle que pour un genre, sur le rang du catalogue. Tant qu'aucune affiche
 * n'est rangée, c'est EXACTEMENT l'ordre des nouveautés (createdAt puis id,
 * tous deux décroissants) — la page ne change pas avant qu'on s'en serve.
 */
export function ordreManuelDuCatalogue() {
  return [
    sqlOp`(${schema.products.ordreCatalogue} = 0) asc`,
    asc(schema.products.ordreCatalogue),
    desc(schema.products.createdAt),
    desc(schema.products.id),
  ];
}

/** Ce qu'il faut pour reconnaître une affiche d'un coup d'œil dans la grille. */
async function habiller(
  lignes: { id: number; name: string; slug: string; status: string }[],
) {
  const ids = lignes.map((p) => p.id);
  const [variantes, images] = await Promise.all([
    ids.length
      ? db
          .select({
            productId: schema.variants.productId,
            format: schema.variants.format,
            priceCents: schema.variants.priceCents,
          })
          .from(schema.variants)
          .where(inArray(schema.variants.productId, ids))
          .orderBy(asc(schema.variants.format), asc(schema.variants.id))
      : Promise.resolve([]),
    ids.length
      ? db
          .select({
            productId: schema.productImages.productId,
            url: schema.productImages.url,
          })
          .from(schema.productImages)
          .where(inArray(schema.productImages.productId, ids))
          .orderBy(
            asc(schema.productImages.position),
            asc(schema.productImages.id),
          )
      : Promise.resolve([]),
  ]);

  const imageDe = new Map<number, string>();
  for (const img of images)
    if (!imageDe.has(img.productId)) imageDe.set(img.productId, img.url);
  const prixDe = new Map<number, number[]>();
  const formatsDe = new Map<number, string[]>();
  for (const v of variantes) {
    if (!prixDe.has(v.productId)) prixDe.set(v.productId, []);
    if (!formatsDe.has(v.productId)) formatsDe.set(v.productId, []);
    prixDe.get(v.productId)!.push(v.priceCents);
    formatsDe.get(v.productId)!.push(v.format);
  }

  return lignes.map((l) => {
    const prix = prixDe.get(l.id) ?? [];
    return {
      id: l.id,
      name: l.name,
      slug: l.slug,
      status: l.status,
      image: imageDe.get(l.id) ?? null,
      prixMin: prix.length ? Math.min(...prix) : null,
      prixMax: prix.length ? Math.max(...prix) : null,
      formats: formatsDe.get(l.id) ?? [],
    };
  });
}

/**
 * Les collections citées par les rangées « Affiches » des pages du site.
 *
 * Défensif comme cms.ts : ces blocs viennent d'une colonne JSON écrite par
 * plusieurs versions du back-office. Ce qui n'est pas lisible est écarté.
 */
function collectionsDesBlocs(blocs: unknown): string[] {
  if (!Array.isArray(blocs)) return [];
  const slugs: string[] = [];
  for (const brut of blocs) {
    if (!brut || typeof brut !== "object") continue;
    const b = brut as Record<string, unknown>;
    if (b.type !== "produits" || b.source !== "collection") continue;
    const refs =
      Array.isArray(b.references) && b.references.length
        ? b.references
        : [b.reference];
    for (const r of refs) {
      const slug = String(r ?? "").trim();
      if (slug && !slugs.includes(slug)) slugs.push(slug);
    }
  }
  return slugs;
}

export function mountOrdreAffichageRoutes(app: Hono): void {
  /**
   * Les pages de liste que l'on peut ranger, dans l'ordre du sélecteur.
   *
   * Chaque collection dit où elle se montre en plus de sa propre page — la
   * vitrine de l'accueil, la rangée d'une page du site — : ranger « Coups de
   * cœur » range aussi l'accueil, et l'écran doit le dire avant qu'on le
   * découvre sur le site.
   */
  app.get("/admin/products/ordre/pages", async (c) => {
    const [collections, comptes, vitrine, pages] = await Promise.all([
      db
        .select({
          id: schema.collections.id,
          slug: schema.collections.slug,
          name: schema.collections.name,
        })
        .from(schema.collections)
        .where(
          and(
            eq(schema.collections.active, true),
            isNull(schema.collections.archivedAt),
          ),
        )
        .orderBy(...ordreDesCollections()),
      db
        .select({
          collectionId: schema.productCollections.collectionId,
          n: count(),
        })
        .from(schema.productCollections)
        .innerJoin(
          schema.products,
          eq(schema.products.id, schema.productCollections.productId),
        )
        .where(eq(schema.products.status, "active"))
        .groupBy(schema.productCollections.collectionId),
      db
        .select({ value: schema.settings.value })
        .from(schema.settings)
        .where(eq(schema.settings.key, "home.vitrine.collection")),
      db
        .select({ title: schema.pages.title, blocks: schema.pages.blocks })
        .from(schema.pages)
        .where(isNull(schema.pages.archivedAt)),
    ]);

    // Le réglage est une chaîne simple ; une ancienne écriture par langue
    // ({ fr: "…" }) se lit en français, la langue de référence.
    const brut = vitrine[0]?.value;
    const slugVitrine = String(
      brut && typeof brut === "object"
        ? ((brut as Record<string, unknown>).fr ?? "")
        : (brut ?? ""),
    ).trim();
    const pagesParCollection = new Map<string, string[]>();
    for (const p of pages)
      for (const slug of collectionsDesBlocs(p.blocks)) {
        const liste = pagesParCollection.get(slug) ?? [];
        if (!liste.includes(p.title)) liste.push(p.title);
        pagesParCollection.set(slug, liste);
      }
    const enLigne = new Map(comptes.map((r) => [r.collectionId, Number(r.n)]));

    const [parGenre] = await Promise.all([
      db
        .select({ kind: schema.products.kind, n: count() })
        .from(schema.products)
        .where(eq(schema.products.status, "active"))
        .groupBy(schema.products.kind),
    ]);
    const duGenre = (g: string) =>
      Number(parGenre.find((r) => r.kind === g)?.n ?? 0);

    return c.json({
      pages: [
        {
          cle: "tout",
          nom: "Toutes les affiches",
          lien: "/affiches",
          enLigne: duGenre("personnalisable") + duGenre("prete_a_imprimer"),
          usages: [],
        },
        {
          cle: "personnalisable",
          nom: "Affiches personnalisables",
          lien: "/affiches?genre=personnalisable",
          enLigne: duGenre("personnalisable"),
          usages: [],
        },
        {
          cle: "prete_a_imprimer",
          nom: "Affiches prêtes à imprimer",
          lien: "/affiches?genre=prete_a_imprimer",
          enLigne: duGenre("prete_a_imprimer"),
          usages: [],
        },
        ...collections.map((col) => ({
          cle: `collection:${col.id}`,
          nom: col.name,
          lien: `/affiches?collection=${encodeURIComponent(col.slug)}`,
          enLigne: enLigne.get(col.id) ?? 0,
          usages: [
            ...(col.slug === slugVitrine ? ["vitrine de l'accueil"] : []),
            ...(pagesParCollection.get(col.slug) ?? []).map(
              (t) => `rangée de la page « ${t} »`,
            ),
          ],
        })),
      ],
    });
  });

  /**
   * Les affiches d'une page, dans l'ordre où la boutique les montre.
   *
   * `genre` = personnalisable | prete_a_imprimer | tout, ou `collection` = son
   * identifiant. Les brouillons et les archives n'y sont pas : on range ce que
   * les clientes voient. Les ranger ne servirait à rien, et noierait la
   * grille — `horsLigne` dit seulement combien il y en a, pour qu'on ne les
   * croie pas perdues.
   */
  app.get("/admin/products/ordre", async (c) => {
    const genre = String(c.req.query("genre") ?? "");
    const collectionId = Number(c.req.query("collection") ?? "");

    if (Number.isInteger(collectionId) && collectionId > 0) {
      const [collection] = await db
        .select({ id: schema.collections.id, name: schema.collections.name })
        .from(schema.collections)
        .where(eq(schema.collections.id, collectionId));
      if (!collection) return c.json({ error: "collection inconnue" }, 404);
      // Le même ordre que le site (index.ts, positionDansCollection) : rang,
      // puis identifiant pour départager deux rangs égaux.
      const [lignes, [horsLigne]] = await Promise.all([
        db
          .select({
            id: schema.products.id,
            name: schema.products.name,
            slug: schema.products.slug,
            status: schema.products.status,
          })
          .from(schema.productCollections)
          .innerJoin(
            schema.products,
            eq(schema.products.id, schema.productCollections.productId),
          )
          .where(
            and(
              eq(schema.productCollections.collectionId, collectionId),
              eq(schema.products.status, "active"),
            ),
          )
          .orderBy(
            asc(schema.productCollections.position),
            asc(schema.products.id),
          ),
        db
          .select({ n: count() })
          .from(schema.productCollections)
          .innerJoin(
            schema.products,
            eq(schema.products.id, schema.productCollections.productId),
          )
          .where(
            and(
              eq(schema.productCollections.collectionId, collectionId),
              ne(schema.products.status, "active"),
            ),
          ),
      ]);
      return c.json({
        page: `collection:${collectionId}`,
        // Une collection n'a pas d'état « pas encore rangée » : son ordre est
        // toujours un choix, même celui de l'import.
        rangees: null,
        horsLigne: Number(horsLigne?.n ?? 0),
        produits: await habiller(lignes),
      });
    }

    if (!estPageRangee(genre)) return c.json({ error: "genre inconnu" }, 400);

    const rang =
      genre === "tout"
        ? schema.products.ordreCatalogue
        : schema.products.ordreAffichage;
    const lignes = await db
      .select({
        id: schema.products.id,
        name: schema.products.name,
        slug: schema.products.slug,
        status: schema.products.status,
        rang,
      })
      .from(schema.products)
      .where(
        genre === "tout"
          ? eq(schema.products.status, "active")
          : and(
              eq(schema.products.kind, genre),
              eq(schema.products.status, "active"),
            ),
      )
      .orderBy(
        ...(genre === "tout" ? ordreManuelDuCatalogue() : ordreManuelDuGenre()),
      );
    const [horsLigne] = await db
      .select({ n: count() })
      .from(schema.products)
      .where(
        genre === "tout"
          ? ne(schema.products.status, "active")
          : and(
              eq(schema.products.kind, genre),
              ne(schema.products.status, "active"),
            ),
      );

    return c.json({
      page: genre,
      genre,
      // Combien sont déjà rangées : l'écran le dit, pour qu'on sache si
      // l'ordre affiché est un choix ou encore l'ordre par défaut.
      rangees: lignes.filter((l) => l.rang > 0).length,
      horsLigne: Number(horsLigne?.n ?? 0),
      produits: await habiller(lignes),
    });
  });

  /**
   * Enregistre l'ordre d'un genre, ou de « Toutes les affiches ».
   *
   * Toute la page est d'abord remise à « non rangée », puis chaque affiche
   * reçue prend son rang. Dans une seule transaction : un enregistrement
   * interrompu à la moitié laisserait une page à moitié rangée et à moitié
   * par nouveautés, sans que rien ne le signale.
   *
   * Une affiche d'un AUTRE genre glissée dans la liste est ignorée : ranger
   * une affiche prête à imprimer parmi les personnalisables ne veut rien dire.
   * L'ordre d'une COLLECTION, lui, s'enregistre par
   * POST /admin/collections/:id/ordre (collections.ts).
   */
  app.post("/admin/products/ordre", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const genre = String(b.genre ?? "");
    if (!estPageRangee(genre)) return c.json({ error: "genre inconnu" }, 400);
    const ordre = (Array.isArray(b.produits) ? b.produits : [])
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n > 0);
    // Sans doublon : une affiche citée deux fois garderait sinon le dernier
    // rang, et un trou apparaîtrait à la place du premier.
    const uniques = [...new Set(ordre)];
    if (!uniques.length) return c.json({ error: "ordre vide" }, 400);

    const connues = await db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(
        genre === "tout"
          ? inArray(schema.products.id, uniques)
          : and(
              eq(schema.products.kind, genre),
              inArray(schema.products.id, uniques),
            ),
      );
    const valides = new Set(connues.map((p) => p.id));
    const rangs = uniques.filter((id) => valides.has(id));

    await db.transaction(async (tx) => {
      if (genre === "tout") {
        await tx.update(schema.products).set({ ordreCatalogue: 0 });
        for (let i = 0; i < rangs.length; i++)
          await tx
            .update(schema.products)
            .set({ ordreCatalogue: i + 1 })
            .where(eq(schema.products.id, rangs[i]!));
        return;
      }
      await tx
        .update(schema.products)
        .set({ ordreAffichage: 0 })
        .where(eq(schema.products.kind, genre));
      for (let i = 0; i < rangs.length; i++)
        await tx
          .update(schema.products)
          .set({ ordreAffichage: i + 1 })
          .where(eq(schema.products.id, rangs[i]!));
    });

    return c.json({ ok: true, ranges: rangs.length });
  });
}
