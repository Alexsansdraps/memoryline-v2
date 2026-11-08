/**
 * Les collections : le seul rangement du catalogue, et le poids qui va avec.
 *
 * La boutique a longtemps eu deux mots pour une même idée. Les CATÉGORIES,
 * héritées du plan de départ, devaient porter le poids d'expédition ; les
 * COLLECTIONS, ramenées de l'ancienne boutique, portaient le catalogue réel.
 * Dans les faits, la table des catégories est restée vide du premier jour au
 * dernier, et tout s'est rangé en collections. Un seul mot subsiste donc, celui
 * que la propriétaire emploie, et c'est la collection qui annonce désormais
 * « une affiche pèse 60 g ».
 *
 * Deux règles gouvernent ce fichier, et elles se paient toutes les deux en
 * argent réel. D'abord, une case vidée n'est jamais un zéro : un poids effacé
 * veut dire « je ne sais pas », et le laisser devenir zéro ferait partir des
 * colis annoncés sans masse. Ensuite, une collection qui contient encore des
 * produits ne se supprime pas : le lien partirait en silence, les affiches
 * perdraient leur poids par défaut, et rien à l'écran ne dirait pourquoi les
 * frais de port sont soudain faux.
 */
import type { Hono } from "hono";
import { and, asc, count, eq, inArray, sql as raw } from "drizzle-orm";
import { db, schema } from "./db/client.js";
import { menuSuitLOrdre } from "./menu-ordre.js";
import { raisonDeGarderLaCollection } from "./suppression-catalogue.js";
import { supprimerPourToujours } from "./suppression.js";

/** Au-delà, ce n'est plus un nom de collection, c'est un paragraphe. */
const NOM_MAX = 80;

/** Slug lisible et stable : accents retirés, tout en minuscules. */
function slugifier(nom: string): string {
  return (
    nom
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "collection"
  );
}

/** Texte libre borné ; un champ vidé vaut null, jamais chaîne vide. */
function texteOuNull(v: unknown, max: number): string | null {
  return (
    String(v ?? "")
      .trim()
      .slice(0, max) || null
  );
}

/**
 * Un identifiant, ou null quand ce n'en est pas un.
 *
 * `Number()` accepte beaucoup trop : `true` désignerait la ligne 1 et « 3.7 »
 * une ligne à virgule qui n'existe pas. Une requête mal transmise doit être
 * refusée plutôt que viser une collection au hasard.
 */
function identifiant(v: unknown): number | null {
  if (typeof v !== "number" && typeof v !== "string") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Identifiants d'une liste, dédoublonnés ; null si l'un d'eux n'en est pas un. */
function identifiants(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  const lus: number[] = [];
  for (const brut of v as unknown[]) {
    const n = identifiant(brut);
    if (n === null) return null;
    lus.push(n);
  }
  return [...new Set(lus)];
}

/**
 * Un poids saisi dans un formulaire.
 *
 * Trois réponses possibles, et il faut vraiment les trois : un nombre, une case
 * vidée (qui veut dire « non renseigné », pas « zéro gramme »), et une saisie
 * qui n'a pas de sens. `Math.round(Number(""))` vaut ZÉRO : confondre les deux
 * dernières ferait passer une faute de frappe pour un effacement voulu, et le
 * colis partirait sous-affranchi sans que rien ne le signale.
 */
function poidsSaisi(v: unknown): { valeur: number | null } | null {
  if (v === null || v === undefined || v === "") return { valeur: null };
  if (typeof v !== "number" && typeof v !== "string") return null;
  const n = Math.round(Number(typeof v === "string" ? v.trim() : v));
  return Number.isFinite(n) && n >= 0 ? { valeur: n } : null;
}

/**
 * Une case à cocher, qui revient tantôt en booléen, tantôt en texte.
 *
 * Un formulaire envoie volontiers « false » en toutes lettres, et cette chaîne
 * n'est pas le booléen `false` : la lire de travers remettrait en ligne une
 * collection que la propriétaire vient de retirer.
 */
function booleenSaisi(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const mot = v.trim().toLowerCase();
    if (mot === "true" || mot === "1" || mot === "oui") return true;
    if (mot === "false" || mot === "0" || mot === "non") return false;
  }
  return null;
}

/** Un rang d'affichage saisi ; null quand la valeur n'en est pas un. */
function positionSaisie(v: unknown): number | null {
  if (typeof v !== "number" && typeof v !== "string") return null;
  const brut = typeof v === "string" ? v.trim() : v;
  if (brut === "") return null;
  const n = Math.round(Number(brut));
  return Number.isFinite(n) && n >= 0 && n <= 10_000 ? n : null;
}

/**
 * Le poids par défaut à retenir pour un produit rangé dans PLUSIEURS
 * collections : LE PLUS LOURD de ceux qui sont déclarés.
 *
 * Le choix n'est pas arbitraire. Un colis surestimé se paie quelques centimes
 * d'affranchissement en trop, une fois, et cela se voit sur la facture. Un
 * colis sous-affranchi, lui, part quand même : il revient en surtaxe des
 * semaines plus tard, ou arrive taxé chez le client, et rien dans le
 * back-office ne l'aura signalé. Entre une erreur qui se voit et une erreur qui
 * ne se voit pas, on choisit celle qui se voit.
 *
 * Les collections muettes ne comptent pas : ne rien dire, ce n'est pas dire
 * zéro. Rend null quand aucune ne se prononce, pour que le niveau du dessus
 * garde la main.
 */
export function poidsDesCollections(
  valeurs: readonly (number | null | undefined)[],
): number | null {
  let retenu: number | null = null;
  for (const valeur of valeurs) {
    if (valeur === null || valeur === undefined) continue;
    if (!Number.isFinite(valeur)) continue;
    if (retenu === null || valeur > retenu) retenu = valeur;
  }
  return retenu;
}

/**
 * L'ordre des collections, partout où elles se listent.
 *
 * Celles que la boutique a rangées (écran « Collections », poignée ⠿ ou
 * flèches) d'abord, dans son ordre ; les autres ensuite, par nom. Même règle
 * que pour les affiches (ordre-affichage.ts) : `position` à zéro veut dire
 * « pas encore rangée », et une collection créée plus tard — à la main ou par
 * un import — arrive APRÈS l'ordre établi au lieu de le bousculer.
 *
 * Partagé avec la boutique, le back-office et la recherche : deux listes qui
 * ne suivraient pas le même ordre feraient croire que le rangement n'a pas
 * été enregistré.
 */
export function ordreDesCollections() {
  return [
    raw`(${schema.collections.position} = 0) asc`,
    asc(schema.collections.position),
    asc(schema.collections.name),
  ];
}

/** Une transaction en cours, ou la base elle-même pour une écriture isolée. */
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executeur = typeof db | Transaction;

/**
 * Le dernier rang occupé dans chacune de ces collections (-1 si elle est vide).
 *
 * `product_collection.position` n'a qu'UN sens : la place de l'affiche DANS la
 * collection, celle que la boutique règle dans Produits › Ordre d'affichage et
 * que le site suit. Elle en a longtemps eu deux — la fiche d'une affiche y
 * écrivait le rang de la collection dans SA liste à elle (0, 1, 2…), l'action
 * groupée y laissait 0 —, si bien que « Villes » comptait 146 affiches pour
 * quatre places distinctes, et qu'enregistrer une fiche bousculait le rayon.
 *
 * Lu en une requête pour toutes les collections du lot : un import ou une
 * grille de deux cents lignes ne doit pas payer un aller-retour par lien.
 */
export async function derniersRangs(
  ex: Executeur,
  collectionIds: readonly number[],
): Promise<Map<number, number>> {
  const rangs = new Map<number, number>();
  const ids = [...new Set(collectionIds)];
  for (const id of ids) rangs.set(id, -1);
  if (!ids.length) return rangs;
  const lignes = await ex
    .select({
      collectionId: schema.productCollections.collectionId,
      rang: raw<number | null>`max(${schema.productCollections.position})`,
    })
    .from(schema.productCollections)
    .where(inArray(schema.productCollections.collectionId, ids))
    .groupBy(schema.productCollections.collectionId);
  for (const l of lignes) rangs.set(l.collectionId, Number(l.rang ?? -1));
  return rangs;
}

/**
 * Range des affiches À LA FIN d'une collection, dans l'ordre reçu.
 *
 * C'est la règle de Shopify pour une collection manuelle, et celle de toute la
 * boutique : ajouter une affiche ne bouscule pas un rangement fait à la main,
 * elle se place derrière, et l'écran d'ordre permet ensuite de la remonter.
 * Une affiche déjà rangée là garde sa place : la réécrire la renverrait en fin
 * de liste à chaque enregistrement d'une fiche.
 *
 * Rend le nombre d'affiches réellement ajoutées.
 */
export async function rangerEnFinDeCollection(
  ex: Executeur,
  collectionId: number,
  produitIds: readonly number[],
): Promise<number> {
  const voulus = [...new Set(produitIds)];
  if (!voulus.length) return 0;
  const deja = await ex
    .select({ productId: schema.productCollections.productId })
    .from(schema.productCollections)
    .where(
      and(
        eq(schema.productCollections.collectionId, collectionId),
        inArray(schema.productCollections.productId, voulus),
      ),
    );
  const dejaLa = new Set(deja.map((d) => d.productId));
  const nouveaux = voulus.filter((p) => !dejaLa.has(p));
  if (!nouveaux.length) return 0;
  let rang = (await derniersRangs(ex, [collectionId])).get(collectionId) ?? -1;
  await ex
    .insert(schema.productCollections)
    .values(
      nouveaux.map((productId) => ({
        productId,
        collectionId,
        position: ++rang,
      })),
    )
    // Deux enregistrements simultanés du même lien : le second n'a rien à
    // faire, l'affiche est déjà rangée.
    .onConflictDoNothing();
  return nouveaux.length;
}

export function mountCollections(app: Hono): void {
  /* ---------------------------------------------------------------------- */
  /*  La liste des collections                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * Toutes les collections, avec ce que chacune contient.
   *
   * Le compte ignore le statut des produits, et c'est voulu : on regarde cette
   * liste pour savoir ce qu'on peut supprimer ou renommer sans casse. Une
   * collection qui ne tient que des brouillons afficherait « 0 » et se ferait
   * supprimer par erreur.
   */
  app.get("/admin/collections", async (c) => {
    const lignes = await db
      .select()
      .from(schema.collections)
      .orderBy(...ordreDesCollections());

    // Les produits comptés d'un coup : une requête par collection serait une
    // requête de trop dès la dizaine de rayons.
    const comptes = await db
      .select({
        collectionId: schema.productCollections.collectionId,
        n: count(),
      })
      .from(schema.productCollections)
      .groupBy(schema.productCollections.collectionId);
    const parCollection = new Map(
      comptes.map((r) => [r.collectionId, Number(r.n)]),
    );

    return c.json({
      collections: lignes.map((col) => ({
        id: col.id,
        slug: col.slug,
        name: col.name,
        description: col.description,
        position: col.position,
        active: col.active,
        // Les archivées viennent AVEC, marquées : l'écran les range dans sa
        // section « Archivées » sans redemander la liste.
        archivedAt: col.archivedAt?.toISOString() ?? null,
        defaultWeightGrams: col.defaultWeightGrams,
        produits: parCollection.get(col.id) ?? 0,
        // Les traductions telles que saisies, sans repli : l'écran doit
        // distinguer « pas encore traduit » de « traduit à l'identique ».
        // Elles s'enregistrent par POST /admin/collections/:id/translations.
        translations: col.translations ?? null,
      })),
    });
  });

  /**
   * Une collection et les affiches qui y sont rangées.
   *
   * Dans l'ordre voulu pour la boutique, puis par identifiant : deux produits
   * laissés au même rang doivent se suivre toujours pareil, et EXACTEMENT comme
   * sur le site (index.ts, positionDansCollection). Départagés par leur nom,
   * ils se présentaient ici dans un ordre que la boutique démentait.
   */
  app.get("/admin/collections/:id", async (c) => {
    const id = identifiant(c.req.param("id"));
    if (id === null) return c.notFound();

    const [collection] = await db
      .select()
      .from(schema.collections)
      .where(eq(schema.collections.id, id));
    if (!collection) return c.notFound();

    const lignes = await db
      .select({
        id: schema.products.id,
        name: schema.products.name,
        slug: schema.products.slug,
        status: schema.products.status,
      })
      .from(schema.productCollections)
      .innerJoin(
        schema.products,
        eq(schema.productCollections.productId, schema.products.id),
      )
      .where(eq(schema.productCollections.collectionId, id))
      .orderBy(
        raw`${schema.productCollections.position} asc nulls last`,
        asc(schema.products.id),
      );

    const ids = lignes.map((p) => p.id);

    const variantes = ids.length
      ? await db
          .select({
            productId: schema.variants.productId,
            format: schema.variants.format,
            priceCents: schema.variants.priceCents,
          })
          .from(schema.variants)
          .where(inArray(schema.variants.productId, ids))
          .orderBy(asc(schema.variants.format), asc(schema.variants.id))
      : [];
    const images = ids.length
      ? await db
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
      : [];

    const prixParProduit = new Map<number, { min: number; max: number }>();
    const formatsParProduit = new Map<number, string[]>();
    for (const v of variantes) {
      const bornes = prixParProduit.get(v.productId);
      prixParProduit.set(
        v.productId,
        bornes
          ? {
              min: Math.min(bornes.min, v.priceCents),
              max: Math.max(bornes.max, v.priceCents),
            }
          : { min: v.priceCents, max: v.priceCents },
      );
      const liste = formatsParProduit.get(v.productId) ?? [];
      if (!liste.includes(v.format)) liste.push(v.format);
      formatsParProduit.set(v.productId, liste);
    }

    // La première rencontrée est celle de position la plus basse : c'est
    // l'image principale, celle qui illustre déjà le produit en boutique.
    const imageParProduit = new Map<number, string>();
    for (const img of images)
      if (!imageParProduit.has(img.productId))
        imageParProduit.set(img.productId, img.url);

    return c.json({
      collection: {
        id: collection.id,
        slug: collection.slug,
        name: collection.name,
        description: collection.description,
        position: collection.position,
        active: collection.active,
        defaultWeightGrams: collection.defaultWeightGrams,
        produits: lignes.length,
        // Telles que saisies, sans repli (voir la liste ci-dessus).
        translations: collection.translations ?? null,
      },
      produits: lignes.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        status: p.status,
        image: imageParProduit.get(p.id) ?? null,
        // Null plutôt que zéro : un produit sans format n'est pas un produit
        // gratuit, c'est un produit dont le prix reste à décider.
        prixMin: prixParProduit.get(p.id)?.min ?? null,
        prixMax: prixParProduit.get(p.id)?.max ?? null,
        formats: formatsParProduit.get(p.id) ?? [],
      })),
    });
  });

  /* ---------------------------------------------------------------------- */
  /*  Créer, modifier, supprimer                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * Range les collections dans l'ordre voulu.
   *
   * Le tableau fait foi : la première reçoit le rang 1, la suivante le 2…
   * L'écran envoie toutes les collections qu'il montre, archivées exceptées ;
   * une archivée garde son ancien rang, qu'elle retrouve si on la restaure.
   *
   * Dans une seule transaction : un ordre enregistré à moitié laisserait deux
   * collections au même rang, et leur ordre serait celui de leur nom, sans que
   * rien ne le dise.
   *
   * Avec `menu: true`, les liens du menu qui mènent à ces collections suivent
   * le même ordre entre eux (menu-ordre.ts) — dans la même transaction.
   *
   * Déclarée AVANT « /admin/collections/:id » : sinon « ordre » serait lu comme
   * l'identifiant d'une collection.
   */
  app.post("/admin/collections/ordre", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const ids = [
      ...new Set(
        (Array.isArray(b.collections) ? b.collections : [])
          .map((v) => Number(v))
          .filter((n) => Number.isInteger(n) && n > 0),
      ),
    ];
    if (!ids.length) return c.json({ error: "L'ordre envoyé était vide." }, 400);
    const connues = await db
      .select({ id: schema.collections.id, slug: schema.collections.slug })
      .from(schema.collections)
      .where(inArray(schema.collections.id, ids));
    const slugDe = new Map(connues.map((l) => [l.id, l.slug]));
    const rangs = ids.filter((id) => slugDe.has(id));
    let liensMenu = 0;
    await db.transaction(async (tx) => {
      for (let i = 0; i < rangs.length; i++)
        await tx
          .update(schema.collections)
          .set({ position: i + 1 })
          .where(eq(schema.collections.id, rangs[i]!));
      if (b.menu === true)
        liensMenu = await menuSuitLOrdre(
          tx,
          new Map(rangs.map((id, i) => [`collection:${slugDe.get(id)!.toLowerCase()}`, i])),
        );
    });
    return c.json({ ok: true, ranges: rangs.length, liensMenu });
  });

  /**
   * Crée une collection.
   *
   * Le nom suffit : le reste se règle ensuite, sur la fiche, une fois qu'on voit
   * ce qu'on y range. Demander le poids à la création ferait inventer un chiffre
   * avant d'avoir pesé quoi que ce soit.
   */
  app.post("/admin/collections", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const nom = String(b.name ?? "")
      .trim()
      .slice(0, NOM_MAX);
    if (!nom)
      return c.json(
        { error: "Donnez un nom à la collection, par exemple « Villes »." },
        400,
      );

    // Adresse unique : deux « Villes » se distinguent par un suffixe plutôt que
    // de faire échouer la création sur une contrainte incompréhensible.
    const base = slugifier(nom);
    const pris = await db
      .select({ slug: schema.collections.slug })
      .from(schema.collections);
    const existants = new Set(pris.map((p) => p.slug));
    let slug = base;
    for (let i = 2; existants.has(slug); i++) slug = `${base}-${i}`;

    const [creee] = await db
      .insert(schema.collections)
      .values({ name: nom, slug })
      .returning({ id: schema.collections.id });
    if (!creee)
      return c.json(
        { error: "Cette collection n'a pas pu être créée. Réessayez." },
        400,
      );
    return c.json({ id: creee.id }, 201);
  });

  /**
   * Modifie une collection. Une clé absente n'est pas touchée.
   *
   * L'adresse ne suit PAS le renommage, et c'est délibéré : les pages du
   * back-office citent une collection par son adresse, et la changer viderait
   * en silence toutes les rangées qui la montrent. Une collection renommée
   * reste la même collection.
   */
  app.post("/admin/collections/:id", async (c) => {
    const id = identifiant(c.req.param("id"));
    if (id === null)
      return c.json(
        { error: "Cette collection n'existe plus. Rechargez la liste." },
        400,
      );
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    const [collection] = await db
      .select({ id: schema.collections.id })
      .from(schema.collections)
      .where(eq(schema.collections.id, id));
    if (!collection)
      return c.json(
        { error: "Cette collection n'existe plus. Rechargez la liste." },
        404,
      );

    const champs: {
      name?: string;
      description?: string | null;
      active?: boolean;
      defaultWeightGrams?: number | null;
      position?: number;
    } = {};

    if ("name" in b) {
      const nom = String(b.name ?? "")
        .trim()
        .slice(0, NOM_MAX);
      if (!nom)
        return c.json(
          { error: "Le nom de la collection ne peut pas rester vide." },
          400,
        );
      champs.name = nom;
    }

    if ("description" in b) champs.description = texteOuNull(b.description, 2000);

    if ("active" in b) {
      const actif = booleenSaisi(b.active);
      if (actif === null)
        return c.json(
          {
            error:
              "Dites si la collection doit être visible en boutique, ou mise de côté.",
          },
          400,
        );
      champs.active = actif;
    }

    if ("defaultWeightGrams" in b) {
      const poids = poidsSaisi(b.defaultWeightGrams);
      if (poids === null)
        return c.json(
          {
            error:
              "Le poids doit être un nombre de grammes, par exemple 60. Laissez la case vide si vous ne le connaissez pas encore.",
          },
          400,
        );
      champs.defaultWeightGrams = poids.valeur;
    }

    if ("position" in b) {
      const position = positionSaisie(b.position);
      if (position === null)
        return c.json(
          {
            error:
              "Le rang d'affichage doit être un nombre entier, 0 pour la première place.",
          },
          400,
        );
      champs.position = position;
    }

    // Rien à écrire : une requête vide n'est pas une erreur, elle n'a
    // simplement rien demandé.
    if (!Object.keys(champs).length) return c.json({ ok: true });

    await db
      .update(schema.collections)
      .set(champs)
      .where(eq(schema.collections.id, id));
    return c.json({ ok: true });
  });

  /**
   * Archive une collection, ou la restaure.
   *
   * L'archivage est le geste ordinaire. La suppression définitive (route
   * DELETE plus bas) ne vient qu'après, et seulement sur une collection vide :
   * effacer la ligne emporte en cascade tout le rangement
   * (`product_collection`), et rien ne saurait remettre les affiches dedans.
   *
   * Archivée, la collection quitte la boutique et la liste ordinaire, mais le
   * rangement reste INTACT — c'est ce qui permet de la restaurer complète, avec
   * ses affiches à la place où elles étaient. Elle peut donc s'archiver pleine.
   *
   * `dedans` dit combien d'affiches elle range, pour que l'écran puisse le
   * redire : elles ne sont ni supprimées ni déplacées, et gardent même le
   * poids par défaut qu'elle leur donne (voir catalogue.ts) — ranger un rayon
   * ne doit pas alléger des colis en silence.
   */
  app.post("/admin/collections/:id/archive", async (c) => {
    const id = identifiant(c.req.param("id"));
    if (id === null)
      return c.json(
        { error: "Cette collection n'existe plus. Rechargez la liste." },
        400,
      );
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    // Défaut : on archive. Seul un « archived: false » explicite restaure.
    const archiver = b.archived !== false;

    const [ligne] = await db
      .update(schema.collections)
      .set({ archivedAt: archiver ? new Date() : null })
      .where(eq(schema.collections.id, id))
      .returning({ archivedAt: schema.collections.archivedAt });
    if (!ligne)
      return c.json(
        { error: "Cette collection n'existe plus. Rechargez la liste." },
        400,
      );

    const [compte] = await db
      .select({ n: count() })
      .from(schema.productCollections)
      .where(eq(schema.productCollections.collectionId, id));

    return c.json({
      ok: true,
      archived: ligne.archivedAt != null,
      dedans: Number(compte?.n ?? 0),
    });
  });

  /**
   * Supprime définitivement une collection ARCHIVÉE (règles : suppression.ts).
   *
   * Seulement VIDE, et c'est la règle de l'en-tête de ce fichier : le
   * rangement (`product_collection`) partirait en cascade, et avec lui le
   * poids par défaut de ses affiches. Le menu du site et les rangées des pages
   * la citent par son adresse, en texte : la route le vérifie aussi (voir
   * `raisonDeGarderLaCollection`). Le vide et l'archivage sont répétés dans
   * la requête : remplie ou restaurée depuis un autre onglet entre la lecture
   * et l'effacement, elle n'est pas touchée.
   */
  app.delete("/admin/collections/:id", async (c) => {
    const id = identifiant(c.req.param("id"));
    if (id === null) return c.notFound();
    return supprimerPourToujours(c, {
      lire: async () =>
        (
          await db
            .select({
              id: schema.collections.id,
              slug: schema.collections.slug,
              archivedAt: schema.collections.archivedAt,
            })
            .from(schema.collections)
            .where(eq(schema.collections.id, id))
        )[0] ?? null,
      estArchive: (col) => col.archivedAt != null,
      empeche: raisonDeGarderLaCollection,
      utilisePar: "des affiches",
      supprimer: async () => {
        await db.transaction(async (tx) => {
          await tx
            .delete(schema.collections)
            .where(
              and(
                eq(schema.collections.id, id),
                raw`${schema.collections.archivedAt} is not null`,
                raw`not exists (select 1 from ${schema.productCollections} pc where pc.collection_id = ${id})`,
              ),
            );
        });
      },
    });
  });

  /* ---------------------------------------------------------------------- */
  /*  Ranger des produits, ou les sortir                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * Ajoute et retire des produits d'une collection.
   *
   * Les deux gestes se font ensemble parce qu'ils se pensent ensemble : on
   * remplace trois affiches par trois autres en un seul enregistrement. D'où la
   * transaction : à moitié appliqué, ce remplacement laisserait la collection
   * avec six affiches ou avec zéro, et il faudrait deviner laquelle des deux
   * moitiés est passée.
   */
  app.post("/admin/collections/:id/produits", async (c) => {
    const id = identifiant(c.req.param("id"));
    if (id === null)
      return c.json(
        { error: "Cette collection n'existe plus. Rechargez la liste." },
        400,
      );
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    // Une clé absente ne demande rien ; une clé présente mais illisible est une
    // requête qu'on n'a pas su lire, et l'appliquer à moitié serait pire que de
    // la refuser.
    const ajouter = "ajouter" in b ? identifiants(b.ajouter) : [];
    const retirer = "retirer" in b ? identifiants(b.retirer) : [];
    if (ajouter === null || retirer === null)
      return c.json(
        {
          error:
            "La liste des produits n'a pas pu être lue. Rechargez la page et reprenez la modification.",
        },
        400,
      );

    // Le même produit ajouté et retiré dans le même geste : impossible de
    // deviner ce qui est voulu, et l'ordre des écritures déciderait à notre
    // place.
    const desDeux = ajouter.filter((pid) => retirer.includes(pid));
    if (desDeux.length)
      return c.json(
        {
          error:
            "Un même produit est à la fois ajouté et retiré. Rechargez la page et reprenez la modification.",
        },
        400,
      );

    const [collection] = await db
      .select({
        id: schema.collections.id,
        archivedAt: schema.collections.archivedAt,
      })
      .from(schema.collections)
      .where(eq(schema.collections.id, id));
    if (!collection)
      return c.json(
        { error: "Cette collection n'existe plus. Rechargez la liste." },
        404,
      );
    // Sortir une affiche d'une collection archivée reste permis — c'est du
    // ménage. Y en ranger une, non : la collection étant rangée, le rayon
    // resterait introuvable en boutique, et le seul effet visible serait le
    // poids par défaut qu'elle donne aux colis.
    if (ajouter.length && collection.archivedAt)
      return c.json(
        {
          error:
            "Cette collection est archivée. Restaurez-la avant d'y ranger des affiches.",
        },
        400,
      );

    // Vérifié AVANT d'écrire : un produit supprimé entre-temps ferait échouer
    // l'enregistrement au dernier moment, en langage de base de données.
    if (ajouter.length) {
      const connus = await db
        .select({ id: schema.products.id })
        .from(schema.products)
        .where(inArray(schema.products.id, ajouter));
      if (connus.length !== ajouter.length)
        return c.json(
          {
            error:
              "Un des produits choisis n'existe plus. Rechargez la page et reprenez la modification.",
          },
          400,
        );
    }

    let dedans = 0;
    try {
      await db.transaction(async (tx) => {
        if (retirer.length)
          await tx
            .delete(schema.productCollections)
            .where(
              and(
                eq(schema.productCollections.collectionId, id),
                inArray(schema.productCollections.productId, retirer),
              ),
            );

        // Un produit déjà rangé là n'est pas une erreur : la page peut renvoyer
        // toute sa sélection. Les nouveaux venus se rangent DERRIÈRE, sans
        // bousculer l'ordre réglé à la main (cf. rangerEnFinDeCollection).
        if (ajouter.length) await rangerEnFinDeCollection(tx, id, ajouter);

        const [apres] = await tx
          .select({ n: count() })
          .from(schema.productCollections)
          .where(eq(schema.productCollections.collectionId, id));
        dedans = Number(apres?.n ?? 0);
      });
    } catch (erreur) {
      // La transaction a tout annulé : la collection est restée exactement
      // comme avant, il n'y a qu'à recommencer. Le détail est journalisé pour
      // nous, jamais renvoyé à l'écran.
      console.error("[collections] rangement impossible", erreur);
      return c.json(
        {
          error:
            "Ces produits n'ont pas pu être rangés. Rien n'a été modifié. Rechargez la page et réessayez.",
        },
        400,
      );
    }

    return c.json({ ok: true, dedans });
  });

  /* ---------------------------------------------------------------------- */
  /*  L'ordre des affiches dans la collection                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Fixe l'ordre des affiches, tel qu'il a été posé à la main.
   *
   * La position décide de l'affichage sur le site : ce qu'on met devant est ce
   * qui se vend. Elle ne s'écrivait jusqu'ici nulle part, et l'ordre d'une
   * collection était celui de l'import, c'est-à-dire aucun.
   */
  app.post("/admin/collections/:id/ordre", async (c) => {
    const id = identifiant(c.req.param("id"));
    if (id === null) return c.json({ error: "collection inconnue" }, 400);
    const [collection] = await db
      .select({ id: schema.collections.id })
      .from(schema.collections)
      .where(eq(schema.collections.id, id));
    if (!collection)
      return c.json(
        { error: "Cette collection n'existe plus. Rechargez la page." },
        404,
      );

    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!Array.isArray(b.produits))
      return c.json(
        {
          error:
            "L'ordre n'a pas pu être lu. Rechargez la page et refaites le déplacement.",
        },
        400,
      );
    const voulu: number[] = [];
    for (const v of b.produits as unknown[]) {
      const n = identifiant(v);
      // Un identifiant illisible n'est pas une raison d'effacer l'ordre, mais
      // ce n'est pas non plus une place : on le laisse de côté.
      if (n !== null && !voulu.includes(n)) voulu.push(n);
    }
    if (!voulu.length)
      return c.json({ error: "Aucune affiche à ranger." }, 400);

    const dedans = await db
      .select({ productId: schema.productCollections.productId })
      .from(schema.productCollections)
      .where(eq(schema.productCollections.collectionId, id))
      .orderBy(
        asc(schema.productCollections.position),
        asc(schema.productCollections.productId),
      );
    const presents = new Set(dedans.map((d) => d.productId));

    // Réordonner n'est pas ranger : un identifiant étranger à la collection
    // est ignoré, il n'y entre pas par cette porte.
    const ranges = voulu.filter((n) => presents.has(n));
    // Ceux que l'écran ne montrait pas gardent leur place, derrière, dans leur
    // ordre actuel. Sans cela, une page de vingt affiches sur cent enverrait
    // les quatre-vingts autres à la dérive.
    const suite = dedans
      .map((d) => d.productId)
      .filter((n) => !ranges.includes(n));
    const ordre = [...ranges, ...suite];

    await db.transaction(async (tx) => {
      for (let i = 0; i < ordre.length; i++)
        await tx
          .update(schema.productCollections)
          .set({ position: i })
          .where(
            and(
              eq(schema.productCollections.collectionId, id),
              eq(schema.productCollections.productId, ordre[i]!),
            ),
          );
    });

    return c.json({ ok: true, ranges: ranges.length });
  });
}
