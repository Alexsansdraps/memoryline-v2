/**
 * Ce que le plan du site doit lister, en un seul aller-retour.
 *
 * Le plan était construit AU BUILD, par l'intégration sitemap d'Astro, qui
 * interrogeait l'API pendant `docker compose build` — moment où l'API n'est
 * pas joignable (le conteneur de build n'est pas sur le réseau de la stack).
 * Résultat en ligne : trois adresses, toutes à ne pas indexer, et aucune des
 * 177 affiches. Même joignable, la liste aurait été figée jusqu'au build
 * suivant, alors que les affiches créées au back-office sont servies tout de
 * suite.
 *
 * Le site construit donc son plan À LA DEMANDE (apps/web/src/pages/sitemap.xml.ts)
 * à partir de cette route : les fiches en vente, les rayons ouverts, les
 * pages publiées — chacun avec sa date de mise à jour quand elle existe, et
 * les langues où il est vraiment écrit (voir referencement.ts). Rien de privé
 * n'en sort : ce sont les adresses que n'importe qui peut déjà ouvrir.
 */
import type { Hono } from "hono";
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "./db/client.js";
import { AFFICHAGES_SITE } from "./cms.js";
import {
  genreDuRayon,
  languesDeLaCollection,
  languesDeLaPage,
  languesDuProduit,
} from "./referencement.js";

export function mountPlanDuSite(app: Hono): void {
  app.get("/plan-du-site", async (c) => {
    const [produits, rayons, pages] = await Promise.all([
      db
        .select({
          slug: schema.products.slug,
          kind: schema.products.kind,
          description: schema.products.description,
          translations: schema.products.translations,
          updatedAt: schema.products.updatedAt,
        })
        .from(schema.products)
        // Même règle que la fiche : seule une affiche en vente a une adresse.
        .where(eq(schema.products.status, "active")),
      // Même sélection que GET /collections : ouvertes, non archivées, et
      // contenant au moins une affiche en vente. Un rayon vide répond 404 :
      // le lister enverrait Google sur une page introuvable.
      db
        .select({
          slug: schema.collections.slug,
          description: schema.collections.description,
          translations: schema.collections.translations,
          produits: count(schema.productCollections.productId),
          personnalisables: sql<number>`count(*) filter (where ${schema.products.kind} = 'personnalisable')`.mapWith(Number),
          pretes: sql<number>`count(*) filter (where ${schema.products.kind} = 'prete_a_imprimer')`.mapWith(Number),
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
        .where(
          and(
            eq(schema.collections.active, true),
            isNull(schema.collections.archivedAt),
          ),
        )
        .groupBy(
          schema.collections.id,
          schema.collections.slug,
          schema.collections.description,
          schema.collections.translations,
        ),
      // Les pages que le SITE sert (pas celles réservées à la tablette du
      // stand), publiées et non archivées — la règle de GET /pages/:slug.
      db
        .select({
          slug: schema.pages.slug,
          blocks: schema.pages.blocks,
          translations: schema.pages.translations,
          updatedAt: schema.pages.updatedAt,
        })
        .from(schema.pages)
        .where(
          and(
            eq(schema.pages.status, "active"),
            isNull(schema.pages.archivedAt),
            inArray(schema.pages.affichage, AFFICHAGES_SITE),
          ),
        ),
    ]);

    return c.json({
      produits: produits.map((p) => ({
        slug: p.slug,
        genre: p.kind,
        maj: p.updatedAt.toISOString(),
        langues: languesDuProduit(p),
      })),
      // Combien d'affiches de chaque genre : une page de genre vide répond
      // 404, elle n'a pas sa place dans le plan non plus.
      genres: {
        personnalisable: produits.filter((p) => p.kind === "personnalisable").length,
        prete_a_imprimer: produits.filter((p) => p.kind === "prete_a_imprimer").length,
      },
      rayons: rayons.map((r) => ({
        slug: r.slug,
        genre: genreDuRayon(r.personnalisables, r.pretes),
        produits: r.produits,
        langues: languesDeLaCollection(r),
      })),
      pages: pages.map((p) => ({
        slug: p.slug,
        maj: p.updatedAt.toISOString(),
        langues: languesDeLaPage(p),
      })),
    });
  });
}
