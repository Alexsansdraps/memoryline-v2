/**
 * L'ordre d'affichage des affiches, réglé à la main.
 *
 * Les COLLECTIONS avaient déjà le leur : on attrape une affiche, on la range,
 * et la page de la collection suit. Mais les deux pages où les clientes
 * arrivent — « Affiches personnalisables » et « Affiches prêtes à imprimer » —
 * ne sont pas des collections, ce sont des genres. Elles se rangeaient par
 * nouveautés, et rien ne permettait de mettre devant ce qui se vend.
 *
 * Chaque affiche porte donc un rang, `ordre_affichage`, propre à son genre —
 * une affiche n'appartient qu'à un seul genre, un seul rang suffit.
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
 */
import type { Hono } from "hono";
import { and, asc, desc, eq, inArray, sql as sqlOp } from "drizzle-orm";
import { db, schema } from "./db/client.js";

const GENRES = ["personnalisable", "prete_a_imprimer"] as const;
type Genre = (typeof GENRES)[number];

function estGenre(v: string): v is Genre {
  return (GENRES as readonly string[]).includes(v);
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

export function mountOrdreAffichageRoutes(app: Hono): void {
  /**
   * Les affiches d'un genre, dans l'ordre où la boutique les montre.
   *
   * Les brouillons et les archives n'y sont pas : on range ce que les
   * clientes voient. Les ranger ne servirait à rien, et noierait la grille.
   */
  app.get("/admin/products/ordre", async (c) => {
    const genre = String(c.req.query("genre") ?? "");
    if (!estGenre(genre)) return c.json({ error: "genre inconnu" }, 400);

    const lignes = await db
      .select({
        id: schema.products.id,
        name: schema.products.name,
        slug: schema.products.slug,
        status: schema.products.status,
        ordreAffichage: schema.products.ordreAffichage,
      })
      .from(schema.products)
      .where(
        and(
          eq(schema.products.kind, genre),
          eq(schema.products.status, "active"),
        ),
      )
      .orderBy(...ordreManuelDuGenre());

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

    return c.json({
      genre,
      // Combien sont déjà rangées : l'écran le dit, pour qu'on sache si
      // l'ordre affiché est un choix ou encore l'ordre par défaut.
      rangees: lignes.filter((l) => l.ordreAffichage > 0).length,
      produits: lignes.map((l) => {
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
      }),
    });
  });

  /**
   * Enregistre l'ordre d'un genre.
   *
   * Tout le genre est d'abord remis à « non rangé », puis chaque affiche
   * reçue prend son rang. Dans une seule transaction : un enregistrement
   * interrompu à la moitié laisserait une page à moitié rangée et à moitié
   * par nouveautés, sans que rien ne le signale.
   *
   * Une affiche d'un AUTRE genre glissée dans la liste est ignorée : ranger
   * une affiche prête à imprimer parmi les personnalisables ne veut rien dire.
   */
  app.post("/admin/products/ordre", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const genre = String(b.genre ?? "");
    if (!estGenre(genre)) return c.json({ error: "genre inconnu" }, 400);
    const ordre = (Array.isArray(b.produits) ? b.produits : [])
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n > 0);
    // Sans doublon : une affiche citée deux fois garderait sinon le dernier
    // rang, et un trou apparaîtrait à la place du premier.
    const uniques = [...new Set(ordre)];
    if (!uniques.length) return c.json({ error: "ordre vide" }, 400);

    const duGenre = await db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(
        and(eq(schema.products.kind, genre), inArray(schema.products.id, uniques)),
      );
    const valides = new Set(duGenre.map((p) => p.id));
    const rangs = uniques.filter((id) => valides.has(id));

    await db.transaction(async (tx) => {
      await tx
        .update(schema.products)
        .set({ ordreAffichage: 0 })
        .where(eq(schema.products.kind, genre));
      for (let i = 0; i < rangs.length; i++) {
        await tx
          .update(schema.products)
          .set({ ordreAffichage: i + 1 })
          .where(eq(schema.products.id, rangs[i]!));
      }
    });

    return c.json({ ok: true, ranges: rangs.length });
  });
}
