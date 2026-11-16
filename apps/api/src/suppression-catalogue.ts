/**
 * La suppression définitive du catalogue : affiches, collections, catégories.
 *
 * Les trois règles communes vivent dans suppression.ts (archivé d'abord, rien
 * de ce qui sert encore, tout dans une transaction). Ce fichier dit, pour le
 * catalogue, ce que « sert encore » veut dire — et c'est surtout ce que la base
 * ne sait PAS dire elle-même :
 *
 *   - une affiche : `order_item.product_id` et `variant_id` sont en
 *     `on delete set null`. La base laisserait donc partir une affiche
 *     commandée, et la commande perdrait en silence de quoi s'afficher et se
 *     réimprimer (sa fiche, son format, ses fonds — `config.backgroundId`
 *     n'est qu'un numéro dans du JSON). Toute commande compte, payée,
 *     abandonnée ou archivée : c'est la route qui refuse ;
 *   - une collection ou une catégorie : `product_collection` part en cascade
 *     et `product.category_id` revient à null. Les affiches rangées dedans
 *     perdraient leur rangement — et pour une collection le poids par défaut
 *     qui décide de leur affranchissement — sans que rien ne le signale. Le
 *     menu du site et les rangées des pages, eux, les citent par leur adresse
 *     ou leur numéro, en texte : aucune clé étrangère ne les protège.
 *
 * Ce qui APPARTIENT à l'affiche part avec elle, par les cascades de la base,
 * dans la même instruction : ses formats, ses photos, ses fonds de
 * configurateur, son rangement en collections ; ses traductions et son
 * référencement sont dans sa ligne. Les fichiers sur disque (photos, SVG des
 * fonds) restent où ils sont : effacer un fichier ne se rattrape pas, et un
 * même fichier peut servir à une autre fiche, dupliquée de celle-ci.
 */
import type { Hono } from "hono";
import { and, asc, count, eq, inArray, isNull, or, sql as raw } from "drizzle-orm";
import { PANIER_EN_COURS_MS } from "./usages-commandes.js";
import { db, schema } from "./db/client.js";
import type { BlocPage } from "./db/schema.js";
import { cibleDuLien } from "./menu-ordre.js";
import { cheminAffiche, normaliserChemin } from "./redirections.js";
import { supprimerPourToujours } from "./suppression.js";

/** Combien de noms on cite avant d'écrire « et N autres ». */
const NOMS_CITES = 3;

/**
 * Une énumération lisible : « « A » », « « A » et « B » », « « A », « B »,
 * « C » et 4 autres ». `total` compte tout, `noms` n'en porte que le début —
 * on ne relit pas mille commandes pour en citer trois.
 */
export function enumerer(
  noms: readonly string[],
  total: number = noms.length,
  guillemets = true,
): string {
  const cites = noms
    .slice(0, NOMS_CITES)
    .map((n) => (guillemets ? `« ${n} »` : n));
  const reste = Math.max(0, total - cites.length);
  if (reste > 0)
    return `${cites.join(", ")} et ${reste} autre${reste > 1 ? "s" : ""}`;
  if (cites.length <= 1) return cites.join("");
  return `${cites.slice(0, -1).join(", ")} et ${cites[cites.length - 1]}`;
}

/** Ce qu'une page enregistre : ses blocs, et ceux de ses traductions. */
interface PageAvecBlocs {
  blocks: readonly BlocPage[] | null;
  translations?: Partial<
    Record<string, { blocks?: readonly BlocPage[] } | undefined>
  > | null;
}

/**
 * Vrai si une rangée d'affiches de la page cite cette collection (par son
 * adresse) ou cette catégorie (par son numéro).
 *
 * Les traductions sont relues aussi : leurs rangées sont recopiées du
 * français, mais une page enregistrée avant cette règle peut en garder une à
 * elle. `references` fait foi quand il est là ; sinon, `reference` seule (les
 * pages composées avant qu'une rangée puisse réunir plusieurs collections).
 */
export function pageCite(
  page: PageAvecBlocs,
  source: "collection" | "categorie",
  reference: string,
): boolean {
  const cherchee = reference.trim().toLowerCase();
  const jeux = [
    page.blocks ?? [],
    ...Object.values(page.translations ?? {}).map((t) => t?.blocks ?? []),
  ];
  return jeux.some((blocs) =>
    blocs.some(
      (b) =>
        b.type === "produits" &&
        b.source === source &&
        (b.references?.length ? b.references : [b.reference]).some(
          (r) => String(r ?? "").trim().toLowerCase() === cherchee,
        ),
    ),
  );
}

/**
 * Les pages EN SERVICE (non archivées) qui montrent cette collection ou cette
 * catégorie dans une rangée. Une page archivée ne bloque rien : elle n'est
 * plus en ligne, et sa rangée restaurée s'afficherait vide, comme le fait
 * déjà celle d'une collection archivée.
 */
async function pagesQuiCitent(
  source: "collection" | "categorie",
  reference: string,
): Promise<string[]> {
  const pages = await db
    .select({
      title: schema.pages.title,
      blocks: schema.pages.blocks,
      translations: schema.pages.translations,
    })
    .from(schema.pages)
    .where(isNull(schema.pages.archivedAt));
  return pages
    .filter((p) => pageCite(p, source, reference))
    .map((p) => p.title);
}

/**
 * Ce qui garde une collection en vie : les affiches qu'elle range encore, le
 * menu du site qui y mène, les pages qui la montrent. Null si rien.
 *
 * Toutes les raisons sont dites d'un coup : en découvrir une seule à chaque
 * essai ferait faire trois allers-retours pour une suppression.
 */
export async function raisonDeGarderLaCollection(col: {
  id: number;
  slug: string;
}): Promise<string | null> {
  const raisons: string[] = [];

  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(schema.productCollections)
    .where(eq(schema.productCollections.collectionId, col.id));
  if (Number(n) > 0) {
    const noms = await db
      .select({ name: schema.products.name })
      .from(schema.productCollections)
      .innerJoin(
        schema.products,
        eq(schema.products.id, schema.productCollections.productId),
      )
      .where(eq(schema.productCollections.collectionId, col.id))
      .orderBy(asc(schema.products.name))
      .limit(NOMS_CITES);
    raisons.push(
      `${Number(n) > 1 ? "Des affiches y sont encore rangées" : "Une affiche y est encore rangée"} : ${enumerer(noms.map((x) => x.name), Number(n))}. ${Number(n) > 1 ? "Sortez-les" : "Sortez-la"} d'abord de la collection (Produits › Modifier en masse, archivées comprises) : supprimée, elle ${Number(n) > 1 ? "leur" : "lui"} retirerait en silence ce rangement et le poids par défaut qu'elle ${Number(n) > 1 ? "leur" : "lui"} donne.`,
    );
  }

  const cible = `collection:${col.slug.toLowerCase()}`;
  const menu = (
    await db
      .select({ label: schema.menuItems.label, href: schema.menuItems.href })
      .from(schema.menuItems)
      .where(isNull(schema.menuItems.archivedAt))
  ).filter((m) => cibleDuLien(m.href) === cible);
  if (menu.length)
    raisons.push(
      `Le menu du site y mène encore (${enumerer(menu.map((m) => m.label))}) : retirez ce lien dans « Menu du site ».`,
    );

  const pages = await pagesQuiCitent("collection", col.slug);
  if (pages.length)
    raisons.push(
      `${pages.length > 1 ? "Les pages" : "La page"} ${enumerer(pages)} la ${pages.length > 1 ? "montrent" : "montre"} encore dans une rangée d'affiches : retirez-la de cette rangée dans « Pages du site ».`,
    );

  return raisons.length ? `${raisons.join(" ")} La collection reste archivée.` : null;
}

/** Ce qui garde une catégorie de produits en vie : ses produits, les pages qui la montrent. */
export async function raisonDeGarderLaCategorie(cat: {
  id: number;
}): Promise<string | null> {
  const raisons: string[] = [];

  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(schema.products)
    .where(eq(schema.products.categoryId, cat.id));
  if (Number(n) > 0) {
    const noms = await db
      .select({ name: schema.products.name })
      .from(schema.products)
      .where(eq(schema.products.categoryId, cat.id))
      .orderBy(asc(schema.products.name))
      .limit(NOMS_CITES);
    raisons.push(
      `${Number(n) > 1 ? "Des produits y sont encore rangés" : "Un produit y est encore rangé"} : ${enumerer(noms.map((x) => x.name), Number(n))}. Sortez-les-en d'abord (Produits › cochez-les › Catégorie « Aucune » › Ranger) : supprimée, elle leur retirerait ce rangement en silence.`,
    );
  }

  const pages = await pagesQuiCitent("categorie", String(cat.id));
  if (pages.length)
    raisons.push(
      `${pages.length > 1 ? "Les pages" : "La page"} ${enumerer(pages)} la ${pages.length > 1 ? "montrent" : "montre"} encore dans une rangée d'affiches : retirez-la de cette rangée dans « Pages du site ».`,
    );

  return raisons.length ? `${raisons.join(" ")} La catégorie reste archivée.` : null;
}

/**
 * La phrase du refus quand des commandes portent l'affiche. Pure : les
 * numéros sont lus avant, et seulement les premiers.
 *
 * Les paniers (numéro « DRAFT-<uuid> ») sont COMPTÉS, pas cités : leur uuid
 * ne dit rien à personne, et ils retiennent l'affiche au même titre — un
 * panier se paie plus tard, ou se relance par courriel avec sa photo.
 */
export function phraseCommandes(
  numeros: readonly string[],
  commandes: number,
  paniers = 0,
): string {
  const p = `${paniers} panier${paniers > 1 ? "s" : ""} non payé${paniers > 1 ? "s" : ""}`;
  const qui =
    commandes > 0
      ? `${enumerer(numeros, commandes, false)}${paniers > 0 ? `, sans compter ${p}` : ""}`
      : p;
  return `Des commandes portent cette affiche : ${qui}. Elles doivent pouvoir s'afficher et se réimprimer à l'identique, avec sa fiche, ses formats et ses fonds : elle reste archivée.`;
}

/**
 * Les commandes qui ont besoin de l'affiche, quel que soit leur état —
 * payée, en cours, abandonnée en panier, archivée : une ligne qui la cite
 * par son numéro, par l'un de ses formats, ou par l'un de ses fonds dans la
 * personnalisation enregistrée (`config.backgroundId`). Ce dernier cas est
 * celui que rien d'autre ne verrait : le fond part en cascade avec l'affiche,
 * et l'impression ne retrouverait plus l'image.
 */
export async function raisonDeGarderLAffiche(id: number): Promise<string | null> {
  const fonds = (
    await db
      .select({ id: schema.backgrounds.id })
      .from(schema.backgrounds)
      .where(eq(schema.backgrounds.productId, id))
  ).map((f) => String(f.id));

  const cite = or(
    eq(schema.orderItems.productId, id),
    inArray(
      schema.orderItems.variantId,
      db
        .select({ id: schema.variants.id })
        .from(schema.variants)
        .where(eq(schema.variants.productId, id)),
    ),
    // Un tableau dans `sql` s'écrit « ($1, $2…) » : la liste du `in`.
    fonds.length
      ? raw`${schema.orderItems.config}->>'backgroundId' in ${fonds}`
      : undefined,
  );

  const panier = raw`${schema.orders.number} like 'DRAFT-%'`;
  // Même règle que l'atelier (usages-commandes.ts, `retient`) : une commande
  // bloque toujours, un panier jamais payé seulement s'il a bougé depuis
  // moins de quatorze jours (la fenêtre des relances). Un vieux panier
  // abandonné n'empêche plus de supprimer une affiche archivée.
  const perime = raw`${schema.orders.status} in ('draft', 'pending') and ${schema.orders.lastActivityAt} is not null and ${schema.orders.lastActivityAt} < now() - make_interval(secs => ${PANIER_EN_COURS_MS / 1000})`;
  const citeEtRetient = and(cite, raw`not (${perime})`);
  const [compte] = await db
    .select({
      commandes: raw<number>`count(distinct ${schema.orders.id}) filter (where not ${panier})`.mapWith(Number),
      paniers: raw<number>`count(distinct ${schema.orders.id}) filter (where ${panier})`.mapWith(Number),
    })
    .from(schema.orderItems)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
    .where(citeEtRetient);
  const commandes = compte?.commandes ?? 0;
  const paniers = compte?.paniers ?? 0;
  if (!commandes && !paniers) return null;

  const numeros = commandes
    ? await db
        .selectDistinct({ numero: schema.orders.number })
        .from(schema.orderItems)
        .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
        .where(and(citeEtRetient, raw`not ${panier}`))
        .orderBy(asc(schema.orders.number))
        .limit(NOMS_CITES)
    : [];
  return phraseCommandes(
    numeros.map((x) => x.numero),
    commandes,
    paniers,
  );
}

/**
 * La route de l'affiche. Montée depuis `mountCatalogueRoutes` (catalogue.ts),
 * qui l'est déjà depuis index.ts : rien à brancher ailleurs.
 */
export function mountSuppressionProduit(app: Hono): void {
  /**
   * Supprime définitivement une affiche ARCHIVÉE (statut `archived`).
   *
   * Refusée dès qu'une commande en a besoin (voir `raisonDeGarderLAffiche`).
   * Sinon, la ligne part et ses dépendances avec elle, par cascade ; les
   * redirections qui menaient à son adresse sont ARCHIVÉES dans la même
   * transaction : elles conduiraient à une page introuvable, et pire, à
   * l'affiche qui reprendrait un jour cette adresse. Le statut est répété dans
   * la requête : remise en vente depuis un autre onglet entre la lecture et
   * l'effacement, l'affiche n'est pas touchée.
   */
  app.delete("/admin/products/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.notFound();
    return supprimerPourToujours(c, {
      lire: async () =>
        (
          await db
            .select({
              id: schema.products.id,
              slug: schema.products.slug,
              status: schema.products.status,
            })
            .from(schema.products)
            .where(eq(schema.products.id, id))
        )[0] ?? null,
      estArchive: (p) => p.status === "archived",
      empeche: (p) => raisonDeGarderLAffiche(p.id),
      utilisePar: "d'autres éléments de la boutique",
      supprimer: async () => {
        await db.transaction(async (tx) => {
          const [partie] = await tx
            .delete(schema.products)
            .where(
              and(
                eq(schema.products.id, id),
                eq(schema.products.status, "archived"),
              ),
            )
            .returning({ slug: schema.products.slug });
          if (!partie) return;

          const ici = normaliserChemin(cheminAffiche(partie.slug));
          const versElle = (
            await tx
              .select({ id: schema.redirects.id, toPath: schema.redirects.toPath })
              .from(schema.redirects)
              .where(
                raw`${schema.redirects.archivedAt} is null and lower(${schema.redirects.toPath}) like ${`${ici}%`}`,
              )
          ).filter((r) => normaliserChemin(r.toPath) === ici);
          if (versElle.length)
            await tx
              .update(schema.redirects)
              .set({ archivedAt: new Date() })
              .where(inArray(schema.redirects.id, versElle.map((r) => r.id)));
        });
      },
    });
  });
}
