/**
 * Le maillage d'une fiche : sous quel rayon elle se range, et vers quelles
 * autres affiches elle mène.
 *
 * Sur memoryline.fr, chaque fiche porte quatre « recommandations » et des
 * liens vers ses collections : c'est par là que Google passe d'une affiche à
 * l'autre. Le nouveau site n'en avait aucun — une fiche ne menait qu'au menu,
 * au pied de page et au catalogue entier —, si bien que les 146 villes
 * n'étaient plus reliées que par les quatre pages de leur rayon et par le plan
 * du site. Le jour de la bascule, chaque fiche aurait perdu les liens qui la
 * portaient.
 *
 * DEUX RÉPONSES, calculées ici en une fois pour GET /products/:slug.
 *
 *  - LE RAYON PRINCIPAL, celui du fil d'Ariane (Accueil › Affiches
 *    personnalisables › Villes › VIEUX MOULIN) : le premier rayon du MENU qui
 *    contient l'affiche. Le menu est la façon dont la boutique range son
 *    catalogue, et il se règle au back-office : les collections techniques
 *    héritées de Shopify (« Tout voir », « Personnages de dos »…) n'y
 *    figurent pas, elles ne deviennent donc jamais le rayon d'une fiche. Une
 *    affiche qu'aucun rayon du menu ne contient (les prêtes à imprimer,
 *    l'affiche tirée d'une photo) se range sous la page de son genre.
 *
 *  - LES VOISINES : huit autres affiches au plus, prises dans ce rayon (ou
 *    dans le genre) — d'abord celles du même lieu (les autres AMIENS, sous
 *    une affiche d'Amiens), puis celles qui l'entourent dans l'ordre réglé au
 *    back-office, de part et d'autre. Surtout pas « les huit premières du
 *    rayon » : elles recevraient les liens des 146 fiches, et les autres
 *    aucun. Avec un voisinage, chaque affiche est citée par ses voisines, et
 *    tout le rayon reste relié de proche en proche.
 *
 * Rien n'est écrit ici : deux lectures pour le rayon, deux ou trois pour les
 * voisines, sur des tables de quelques centaines de lignes.
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "./db/client.js";
import { ordreManuelDuGenre } from "./ordre-affichage.js";
import { genreDuRayon } from "./referencement.js";
import { champTraduit, texteDansLaLangue } from "./traductions.js";

type Genre = (typeof schema.products.$inferSelect)["kind"];

/** Le rayon sous lequel la fiche se range, nommé dans la langue de la page. */
export interface RayonPrincipal {
  slug: string;
  name: string;
  /** Le genre de toutes ses affiches, ou null s'il en mêle deux (son adresse en dépend). */
  genre: Genre | null;
}

/** Une affiche voisine : ce que dessine une vignette, comme une ligne de GET /products. */
export interface Voisine {
  id: number;
  slug: string;
  name: string;
  kind: Genre;
  basePriceCents: number;
  image: string | null;
  variants: { format: string; priceCents: number; compareAtCents: number | null }[];
}

export interface Maillage {
  rayonPrincipal: RayonPrincipal | null;
  voisines: Voisine[];
  /** D'où viennent les voisines : du rayon principal, ou de la page du genre. */
  voisinesDe: "rayon" | "genre";
}

/** Combien de voisines au plus. La fiche en montre selon ses colonnes (deux rangées). */
const VOISINES_MAX = 8;
/**
 * Combien, au moins, pour s'en tenir au rayon. Un rayon du menu qui ne
 * contiendrait que deux ou trois affiches laisserait un bloc maigre : on
 * prend alors les voisines dans le genre, qui en a toujours davantage.
 */
const VOISINES_MIN = 4;
/** La part du même lieu : la moitié au plus, pour que le bloc fasse aussi voyager. */
const MEME_LIEU_MAX = VOISINES_MAX / 2;

/**
 * La collection que désigne un lien du menu (« /affiches?genre=…&collection=villes »),
 * ou null pour un lien qui ne mène pas à un rayon de la boutique.
 */
function rayonDuLien(href: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null; // un autre site, un courriel…
  const [chemin = "", requete = ""] = href.split("?");
  if (!/^(\/[a-z]{2})?\/affiches\/?$/i.test(chemin)) return null;
  return new URLSearchParams(requete.split("#")[0]).get("collection")?.trim() || null;
}

/** Un lieu comparable : sans accents ni casse (« LE TRÉPORT » et « LE TREPORT »). */
function lieuComparable(lieu: string): string {
  return lieu.normalize("NFD").replace(/[̀-ͯ]/gu, "").toLowerCase();
}

/**
 * Le maillage d'une fiche en vente.
 *
 * `villeDuNom` est la règle qui lit le lieu dans le nom (« AMIENS Cathédrale »
 * → AMIENS) ; elle vit avec le filtre par lieu du catalogue (index.ts), et
 * c'est la même qui doit servir ici — on la reçoit plutôt que de la recopier.
 */
export async function maillageDeLaFiche(
  fiche: { id: number; kind: Genre; name: string },
  langue: string,
  villeDuNom: (nom: string) => string,
): Promise<Maillage> {
  const [rayons, menu] = await Promise.all([
    // Les rayons ouverts qui contiennent cette affiche, avec le genre de
    // leurs affiches en vente — la règle de GET /collections.
    db
      .select({
        slug: schema.collections.slug,
        name: schema.collections.name,
        translations: schema.collections.translations,
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
          sql`exists (select 1 from ${schema.productCollections} pc where pc.collection_id = ${schema.collections.id} and pc.product_id = ${fiche.id})`,
        ),
      )
      .groupBy(
        schema.collections.id,
        schema.collections.slug,
        schema.collections.name,
        schema.collections.translations,
      ),
    // Le menu tel que le site le montre (GET /menu) : visible, non archivé,
    // dans l'ordre du back-office.
    db
      .select({
        id: schema.menuItems.id,
        parentId: schema.menuItems.parentId,
        href: schema.menuItems.href,
      })
      .from(schema.menuItems)
      .where(and(eq(schema.menuItems.visible, true), isNull(schema.menuItems.archivedAt)))
      .orderBy(asc(schema.menuItems.position), asc(schema.menuItems.id)),
  ]);

  /*
   * Les liens du menu dans l'ordre où on les lit : chaque entrée du haut,
   * puis ses sous-entrées. « Villes » passe donc avant « Thèmes & paysages »
   * pour les cinq affiches rangées dans les deux.
   */
  const ordreDuMenu: string[] = [];
  for (const haut of menu.filter((l) => l.parentId === null)) {
    ordreDuMenu.push(haut.href);
    for (const sous of menu.filter((l) => l.parentId === haut.id)) ordreDuMenu.push(sous.href);
  }
  let rayonPrincipal: RayonPrincipal | null = null;
  for (const href of ordreDuMenu) {
    const slug = rayonDuLien(href);
    const r = slug ? rayons.find((x) => x.slug === slug) : undefined;
    if (!r) continue;
    const genre = genreDuRayon(r.personnalisables, r.pretes);
    // Un rayon d'un AUTRE genre ne peut pas contenir l'affiche — sauf à
    // contredire ses propres comptes ; un rayon mêlé, si.
    if (genre !== null && genre !== fiche.kind) continue;
    rayonPrincipal = {
      slug: r.slug,
      name: texteDansLaLangue(r.translations, langue, "name", r.name),
      genre,
    };
    break;
  }

  /*
   * La liste où chercher les voisines, dans l'ordre exact de sa page : celui
   * du rayon (« Ordre de la boutique », positions réglées au glisser-déposer),
   * ou celui de la page du genre.
   */
  const duRayon = (slug: string) =>
    db
      .select({ id: schema.products.id, name: schema.products.name })
      .from(schema.products)
      .innerJoin(
        schema.productCollections,
        eq(schema.productCollections.productId, schema.products.id),
      )
      .innerJoin(
        schema.collections,
        eq(schema.collections.id, schema.productCollections.collectionId),
      )
      .where(and(eq(schema.products.status, "active"), eq(schema.collections.slug, slug)))
      .orderBy(sql`${schema.productCollections.position} asc nulls last`, asc(schema.products.id));
  const duGenre = () =>
    db
      .select({ id: schema.products.id, name: schema.products.name })
      .from(schema.products)
      .where(and(eq(schema.products.status, "active"), eq(schema.products.kind, fiche.kind)))
      .orderBy(...ordreManuelDuGenre());

  let liste = rayonPrincipal ? await duRayon(rayonPrincipal.slug) : [];
  let voisinesDe: Maillage["voisinesDe"] = "rayon";
  if (liste.filter((l) => l.id !== fiche.id).length < VOISINES_MIN) {
    liste = await duGenre();
    voisinesDe = "genre";
  }

  const choisies = choisirVoisines(liste, fiche, villeDuNom);
  return {
    rayonPrincipal,
    voisines: await vignettes(choisies, langue),
    voisinesDe,
  };
}

/**
 * Les voisines, dans l'ordre où la fiche les montre : le même lieu d'abord,
 * puis la suite et ce qui précède, en alternant (+1, −1, +2, −2…). La liste
 * est circulaire : la dernière affiche du rayon a pour voisines les
 * premières, et personne ne reste au bout de la chaîne sans lien.
 */
function choisirVoisines(
  liste: { id: number; name: string }[],
  fiche: { id: number; name: string },
  villeDuNom: (nom: string) => string,
): number[] {
  const n = liste.length;
  if (n === 0) return [];
  // Absente de sa propre liste (cela ne devrait pas arriver), la fiche se
  // place avant la première.
  const ici = liste.findIndex((l) => l.id === fiche.id);
  const a = (decalage: number) => liste[(((ici + decalage) % n) + n) % n]!;
  const prises = new Set<number>([fiche.id]);
  const ordre: number[] = [];

  const lieu = lieuComparable(villeDuNom(fiche.name));
  if (lieu)
    for (let d = 1; d < n && ordre.length < MEME_LIEU_MAX; d++) {
      const l = a(d);
      if (prises.has(l.id) || lieuComparable(villeDuNom(l.name)) !== lieu) continue;
      prises.add(l.id);
      ordre.push(l.id);
    }

  for (let d = 1; d < n && ordre.length < VOISINES_MAX; d++)
    for (const l of [a(d), a(-d)]) {
      if (ordre.length >= VOISINES_MAX || prises.has(l.id)) continue;
      prises.add(l.id);
      ordre.push(l.id);
    }
  return ordre;
}

/** Ce que dessine la vignette de chaque voisine : nom traduit, première image, formats. */
async function vignettes(ids: number[], langue: string): Promise<Voisine[]> {
  if (!ids.length) return [];
  const [produits, formats, images] = await Promise.all([
    db
      .select({
        id: schema.products.id,
        slug: schema.products.slug,
        name: schema.products.name,
        kind: schema.products.kind,
        basePriceCents: schema.products.basePriceCents,
        translations: schema.products.translations,
      })
      .from(schema.products)
      .where(inArray(schema.products.id, ids)),
    db
      .select({
        productId: schema.variants.productId,
        format: schema.variants.format,
        priceCents: schema.variants.priceCents,
        compareAtCents: schema.variants.compareAtCents,
      })
      .from(schema.variants)
      .where(inArray(schema.variants.productId, ids))
      .orderBy(asc(schema.variants.priceCents), asc(schema.variants.id)),
    db
      .select({ productId: schema.productImages.productId, url: schema.productImages.url })
      .from(schema.productImages)
      .where(inArray(schema.productImages.productId, ids))
      .orderBy(asc(schema.productImages.position), asc(schema.productImages.id)),
  ]);
  const parId = new Map(produits.map((p) => [p.id, p]));
  return ids.flatMap((id) => {
    const p = parId.get(id);
    if (!p) return [];
    return [
      {
        id: p.id,
        slug: p.slug,
        // Le nom traduit quand il l'est, le français sinon — comme GET /products.
        name: champTraduit(p.translations, langue, "name") ?? p.name,
        kind: p.kind,
        basePriceCents: p.basePriceCents,
        image: images.find((i) => i.productId === id)?.url ?? null,
        variants: formats
          .filter((v) => v.productId === id)
          .map(({ format, priceCents, compareAtCents }) => ({ format, priceCents, compareAtCents })),
      },
    ];
  });
}
