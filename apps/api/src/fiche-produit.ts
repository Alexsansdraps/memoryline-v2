/**
 * La fiche d'un produit : tout ce qui le décrit, lu et réécrit d'un seul tenant.
 *
 * Le tableau de masse sert à corriger vingt affiches d'un coup ; la fiche sert
 * au travail inverse, celui qu'on fait sur UNE affiche quand on la sort du
 * lot : la renommer, refaire sa description, ajouter le format A2 qu'on vient
 * de faire imprimer, remonter la bonne photo en premier, la ranger dans la
 * collection de Noël et écrire soi-même ce que Google en dira.
 *
 * Tout cela se décide ensemble et doit donc s'enregistrer ensemble. Une fiche
 * à moitié écrite — le nouveau prix passé, le format ajouté perdu — est pire
 * qu'une fiche refusée : rien à l'écran ne dirait ce qui a été retenu, et la
 * boutique vendrait entre-temps un état que personne n'a voulu. D'où la règle
 * qui gouverne ce fichier : on relit TOUT avant d'écrire quoi que ce soit, et
 * l'écriture entière tient dans une seule transaction.
 *
 * Deux prudences valent d'être dites, parce qu'elles ont déjà coûté cher
 * ailleurs. Un champ de prix vidé par mégarde ne devient jamais zéro : il est
 * refusé, et on dit pourquoi. Et un format déjà vendu ne se supprime pas, même
 * s'il ne se vend plus : les commandes passées le citent, et l'effacer
 * trouerait l'historique des ventes.
 */
import type { Hono } from "hono";
import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  notInArray,
  or,
  sql as raw,
} from "drizzle-orm";
import { poidsArticle, POSTER_FORMATS } from "@memoryline/types";
import { poidsDesCollections } from "./collections.js";
import { db, schema } from "./db/client.js";
import { FORMAT_PAR_DEFAUT, HORS_VENTES } from "./statuts-vente.js";

/** Les seuls états qu'un produit peut prendre. */
const STATUTS = ["active", "draft", "archived"] as const;
type StatutProduit = (typeof STATUTS)[number];

/** Ce qu'on fait d'une variante en rupture : arrêter la vente, ou la laisser. */
const POLITIQUES_STOCK = ["deny", "continue"] as const;

/**
 * Borne haute des montants, en centimes : un million d'euros.
 *
 * Rien à voir avec la boutique, tout à voir avec la base : un entier Postgres
 * s'arrête à 2 147 483 647, et un zéro de trop collé à un prix ferait échouer
 * l'enregistrement sur une erreur que personne ne saurait lire. Refuser tôt
 * permet de dire « ce prix est trop élevé » plutôt que de laisser tomber la
 * fiche entière.
 */
const MONTANT_MAX_CENTS = 100_000_000;

/** Un stock au-delà de ça est une faute de frappe, pas un inventaire. */
const STOCK_MAX = 1_000_000;

/**
 * Une saisie que l'on refuse, avec la phrase à montrer à la commerçante.
 *
 * Elle traverse la transaction pour la faire retomber d'un bloc : c'est le seul
 * moyen d'abandonner l'enregistrement en cours de route sans laisser la moitié
 * du travail écrite.
 */
class SaisieRefusee extends Error {}

/** Adresse web du produit, nettoyée. Vide quand il ne reste rien d'utilisable. */
function slugifier(valeur: string): string {
  return valeur
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Une étiquette lisible : espaces resserrés, longueur bornée. */
function etiquette(v: unknown): string {
  return String(v ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 40);
}

/** Texte libre borné ; un champ vidé vaut null, jamais chaîne vide. */
function texteOuNull(v: unknown, max: number): string | null {
  return String(v ?? "").trim().slice(0, max) || null;
}

/**
 * Un montant en centimes.
 *
 * Le point délicat de tout ce fichier. `Math.round(Number(""))` vaut ZÉRO :
 * lire un champ de prix sans distinguer « vide » de « zéro » transforme une
 * frappe malheureuse en produit gratuit, et la boutique le vend ainsi jusqu'à
 * ce que quelqu'un s'en aperçoive. Un champ vide, une lettre, un espace : tout
 * cela est refusé et expliqué, jamais corrigé en douce.
 */
function centimes(v: unknown, quoi: string): number {
  if (typeof v !== "number" && typeof v !== "string")
    throw new SaisieRefusee(`${quoi} doit être renseigné.`);
  const brut = typeof v === "string" ? v.trim() : v;
  if (brut === "") throw new SaisieRefusee(`${quoi} doit être renseigné.`);
  const n = Number(brut);
  if (!Number.isFinite(n))
    throw new SaisieRefusee(`${quoi} doit être un nombre.`);
  const cents = Math.round(n);
  if (cents < 0) throw new SaisieRefusee(`${quoi} ne peut pas être négatif.`);
  if (cents > MONTANT_MAX_CENTS)
    throw new SaisieRefusee(`${quoi} est trop élevé. Vérifiez la saisie.`);
  return cents;
}

/**
 * Un montant facultatif : le prix barré et le coût de revient.
 *
 * Vide veut dire « il n'y en a pas », et c'est une réponse en soi : une affiche
 * sans promotion n'a pas de prix barré. Ce n'est pas convertir en zéro, c'est
 * enregistrer une absence — un prix barré à 0 s'afficherait, lui, en boutique.
 */
function centimesOuNull(v: unknown, quoi: string): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string" && v.trim() === "") return null;
  return centimes(v, quoi);
}

/**
 * Un poids saisi, en grammes.
 *
 * Vide ne veut pas dire zéro gramme : cela veut dire « reprends celui du
 * niveau au-dessus », la variante retombant sur le produit et le produit sur sa
 * catégorie. Confondre les deux ferait partir des colis sous-affranchis sans
 * que rien ne le signale.
 */
function grammesOuNull(v: unknown, quoi: string): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "number" && typeof v !== "string")
    throw new SaisieRefusee(`${quoi} doit être un nombre de grammes.`);
  const n = Number(typeof v === "string" ? v.trim() : v);
  if (!Number.isFinite(n) || n < 0)
    throw new SaisieRefusee(
      `${quoi} doit être un nombre de grammes. Laissez vide pour reprendre celui de la catégorie.`,
    );
  const g = Math.round(n);
  if (g > 100_000)
    throw new SaisieRefusee(`${quoi} est trop élevé. Vérifiez la saisie.`);
  return g;
}

/**
 * Le stock d'une variante.
 *
 * Vide veut dire « stock non suivi », et c'est le cas de toutes les affiches :
 * elles sont imprimées à la commande, il n'y a rien à compter. Zéro veut dire
 * « suivi, et il n'en reste plus », ce qui arrête la vente. Deux situations
 * franchement différentes qu'un champ vide ramené à zéro confondrait.
 */
function stockOuNull(v: unknown, quoi: string): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "number" && typeof v !== "string")
    throw new SaisieRefusee(`${quoi} doit être un nombre.`);
  const brut = typeof v === "string" ? v.trim() : v;
  if (brut === "") return null;
  const n = Number(brut);
  if (!Number.isFinite(n))
    throw new SaisieRefusee(
      `${quoi} doit être un nombre. Laissez vide si vous ne suivez pas le stock.`,
    );
  const q = Math.round(n);
  if (q < 0) throw new SaisieRefusee(`${quoi} ne peut pas être négatif.`);
  if (q > STOCK_MAX)
    throw new SaisieRefusee(`${quoi} est trop élevé. Vérifiez la saisie.`);
  return q;
}

/**
 * L'adresse d'une image.
 *
 * Deux formes acceptées : un fichier de la boutique (« /assets/… ») ou une
 * adresse web complète. Le reste est refusé, y compris « //ailleurs.com/x.jpg »
 * qui ressemble à une adresse interne mais désigne un autre site.
 */
function urlImage(v: unknown): string {
  const url = String(v ?? "").trim();
  if (!url)
    throw new SaisieRefusee("Une image ne peut pas être ajoutée sans adresse.");
  const interne = url.startsWith("/") && !url.startsWith("//");
  const distante = /^https?:\/\//i.test(url);
  if (!interne && !distante)
    throw new SaisieRefusee(
      `L'adresse « ${url.slice(0, 60)} » n'est pas une adresse d'image valable. Elle doit commencer par « / », « http:// » ou « https:// ».`,
    );
  return url.slice(0, 500);
}

/** Un objet reçu dans un tableau, ou rien du tout. */
function objet(v: unknown): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v))
    throw new SaisieRefusee(
      "Cette fiche n'a pas pu être lue. Rechargez la page et réessayez.",
    );
  return v as Record<string, unknown>;
}

/**
 * L'identifiant d'une ligne déjà en base, quand il y en a un.
 *
 * Absent, nul ou vide veut dire « c'est une ligne nouvelle ». Une page qui
 * envoie `id: null` pour le format qu'on vient d'ajouter dit exactement la même
 * chose que celle qui n'envoie pas la clé du tout ; prendre ce nul pour un
 * identifiant ferait refuser une création parfaitement légitime.
 */
function identifiantExistant(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Ce que la fiche peut changer sur la ligne du produit lui-même. */
interface ChampsProduit {
  name?: string;
  slug?: string;
  description?: string | null;
  status?: StatutProduit;
  vendor?: string | null;
  productType?: string | null;
  tags?: string[];
  seoTitle?: string | null;
  seoDescription?: string | null;
  categoryId?: number | null;
  weightGrams?: number | null;
}

/** Ce que la fiche peut changer sur un format. */
interface ChampsVariante {
  format?: string;
  priceCents?: number;
  compareAtCents?: number | null;
  costCents?: number | null;
  sku?: string | null;
  barcode?: string | null;
  weightGrams?: number | null;
  stockQty?: number | null;
  stockPolicy?: string;
}

export function mountFicheProduit(app: Hono): void {
  /* ---------------------------------------------------------------------- */
  /*  Dupliquer une affiche                                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * Copie une affiche entiere, sous un nouveau nom.
   *
   * La copie nait en BROUILLON, toujours : une affiche dupliquee n'est pas
   * finie, et la mettre en ligne d'office publierait un doublon de la
   * precedente le temps qu'on s'en apercoive.
   *
   * Tout se fait en une seule transaction. Une copie a moitie faite — la
   * fiche sans ses formats, ou sans ses collections — serait pire que pas de
   * copie du tout : elle a l'air complete.
   */
  app.post("/admin/products/:id/dupliquer", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.notFound();

    const corps = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const [source] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, id));
    if (!source) return c.notFound();

    const nom =
      String(corps.name ?? "").trim().slice(0, 200) || `${source.name} (copie)`;

    // L'adresse se derive du nom, et se decale tant qu'elle est prise. On ne
    // refuse pas : dupliquer doit marcher du premier coup, sans faire chercher
    // une adresse libre a la main.
    const racine = slugifier(nom) || `${source.slug}-copie`;
    let adresse = racine;
    for (let n = 2; n < 200; n++) {
      const [pris] = await db
        .select({ id: schema.products.id })
        .from(schema.products)
        .where(eq(schema.products.slug, adresse));
      if (!pris) break;
      adresse = `${racine}-${n}`.slice(0, 200);
    }

    const copie = await db.transaction(async (tx) => {
      const [neuf] = await tx
        .insert(schema.products)
        .values({
          slug: adresse,
          name: nom,
          description: source.description,
          kind: source.kind,
          categoryId: source.categoryId,
          aiEnabled: source.aiEnabled,
          aiStylePrompt: source.aiStylePrompt,
          weightGrams: source.weightGrams,
          basePriceCents: source.basePriceCents,
          // Toujours en brouillon : voir l'en-tete.
          status: "draft",
          defaultTitle: source.defaultTitle,
          defaultSubtitle: source.defaultSubtitle,
          defaultLine3: source.defaultLine3,
          defaultView: source.defaultView,
          foregroundUrl: source.foregroundUrl,
          translations: source.translations,
          vendor: source.vendor,
          productType: source.productType,
          tags: source.tags,
          // Le referencement ne se copie pas : deux fiches avec le meme titre
          // Google se font concurrence a elles-memes. Elles repartent du nom.
          seoTitle: null,
          seoDescription: null,
        })
        .returning();

      const formats = await tx
        .select()
        .from(schema.variants)
        .where(eq(schema.variants.productId, id));
      if (formats.length)
        await tx.insert(schema.variants).values(
          formats.map((v) => ({
            productId: neuf!.id,
            format: v.format,
            priceCents: v.priceCents,
            compareAtCents: v.compareAtCents,
            costCents: v.costCents,
            weightGrams: v.weightGrams,
            widthMm: v.widthMm,
            heightMm: v.heightMm,
            // La reference et le code-barres designent un article precis : les
            // recopier ferait deux articles differents sous un meme code.
            sku: null,
            barcode: null,
            stockQty: v.stockQty,
            stockPolicy: v.stockPolicy,
          })),
        );

      const images = await tx
        .select()
        .from(schema.productImages)
        .where(eq(schema.productImages.productId, id));
      if (images.length)
        await tx.insert(schema.productImages).values(
          images.map((im) => ({
            productId: neuf!.id,
            url: im.url,
            alt: im.alt,
            position: im.position,
          })),
        );

      const fonds = await tx
        .select()
        .from(schema.backgrounds)
        .where(eq(schema.backgrounds.productId, id));
      if (fonds.length)
        await tx.insert(schema.backgrounds).values(
          fonds.map((f) => ({
            productId: neuf!.id,
            url: f.url,
            name: f.name,
            position: f.position,
          })),
        );

      const rangements = await tx
        .select()
        .from(schema.productCollections)
        .where(eq(schema.productCollections.productId, id));
      if (rangements.length)
        await tx.insert(schema.productCollections).values(
          rangements.map((r) => ({
            productId: neuf!.id,
            collectionId: r.collectionId,
            position: r.position,
          })),
        );

      return {
        id: neuf!.id,
        slug: neuf!.slug,
        name: neuf!.name,
        formats: formats.length,
        images: images.length,
        fonds: fonds.length,
        collections: rangements.length,
      };
    });

    return c.json(copie);
  });

  /* ---------------------------------------------------------------------- */
  /*  Lecture de la fiche                                                   */
  /* ---------------------------------------------------------------------- */

  /**
   * Tout ce qu'affiche la fiche, en une seule réponse.
   *
   * Y compris les listes où il faut choisir (catégories, collections) et les
   * étiquettes déjà posées ailleurs : sans elles, la page proposerait un champ
   * libre, et « best-seller » finirait écrit de quatre façons différentes.
   */
  app.get("/admin/products/:id/fiche", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.notFound();

    const [produit] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, id));
    if (!produit) return c.notFound();

    // Même règle que pour les collections : les archivées ne se proposent
    // plus, mais celle où l'affiche est DÉJÀ rangée reste dans la liste. Sans
    // elle, le premier enregistrement de la fiche la sortirait de sa catégorie
    // sans que personne ne l'ait demandé.
    const categories = await db
      .select({
        id: schema.productCategories.id,
        name: schema.productCategories.name,
        defaultWeightGrams: schema.productCategories.defaultWeightGrams,
      })
      .from(schema.productCategories)
      .where(
        produit.categoryId
          ? or(
              isNull(schema.productCategories.archivedAt),
              eq(schema.productCategories.id, produit.categoryId),
            )
          : isNull(schema.productCategories.archivedAt),
      )
      .orderBy(
        asc(schema.productCategories.position),
        asc(schema.productCategories.name),
      );
    // Le choix des collections où ranger l'affiche : les archivées n'y sont
    // pas. Celles où elle est DÉJÀ rangée arrivent par `liens` juste en
    // dessous, archivées comprises — une affiche ne doit pas sortir d'une
    // collection parce qu'on a rangé cette collection.
    const collections = await db
      .select({ id: schema.collections.id, name: schema.collections.name })
      .from(schema.collections)
      .where(isNull(schema.collections.archivedAt))
      .orderBy(asc(schema.collections.position), asc(schema.collections.name));
    // Le poids par défaut vient avec les liens : c'est la collection qui le
    // porte, et la fiche doit pouvoir montrer ce qui sera réellement pesé.
    const liens = await db
      .select({
        collectionId: schema.productCollections.collectionId,
        defaultWeightGrams: schema.collections.defaultWeightGrams,
      })
      .from(schema.productCollections)
      .innerJoin(
        schema.collections,
        eq(schema.productCollections.collectionId, schema.collections.id),
      )
      .where(eq(schema.productCollections.productId, id))
      .orderBy(asc(schema.productCollections.position));
    const images = await db
      .select({
        id: schema.productImages.id,
        url: schema.productImages.url,
        alt: schema.productImages.alt,
        position: schema.productImages.position,
      })
      .from(schema.productImages)
      .where(eq(schema.productImages.productId, id))
      .orderBy(asc(schema.productImages.position), asc(schema.productImages.id));
    const variantes = await db
      .select()
      .from(schema.variants)
      .where(eq(schema.variants.productId, id))
      .orderBy(asc(schema.variants.format), asc(schema.variants.id));

    // Toutes les étiquettes du catalogue, pas seulement celles de ce produit :
    // c'est la liste dans laquelle on pioche pour éviter d'en réinventer une.
    const tousLesTags = await db
      .select({ tags: schema.products.tags })
      .from(schema.products);
    const etiquettesConnues = new Map<string, string>();
    for (const r of tousLesTags)
      for (const t of r.tags ?? []) {
        const propre = etiquette(t);
        if (propre && !etiquettesConnues.has(propre.toLowerCase()))
          etiquettesConnues.set(propre.toLowerCase(), propre);
      }

    // La plus lourde des collections qui se prononcent : un colis surestimé se
    // paie quelques centimes, un colis sous-affranchi revient en surtaxe sans
    // que rien ne l'ait signalé.
    const poidsCollections = poidsDesCollections(
      liens.map((l) => l.defaultWeightGrams),
    );

    return c.json({
      produit: {
        id: produit.id,
        name: produit.name,
        slug: produit.slug,
        description: produit.description,
        status: produit.status,
        kind: produit.kind,
        vendor: produit.vendor,
        productType: produit.productType,
        tags: produit.tags ?? [],
        seoTitle: produit.seoTitle,
        seoDescription: produit.seoDescription,
        categoryId: produit.categoryId,
        weightGrams: produit.weightGrams,
        // Ce qui sera réellement pesé, cadre non compris : la fiche montre
        // « 60 g » sur un produit au champ vide plutôt qu'une case muette.
        poidsEffectif: poidsArticle({
          produitGrammes: produit.weightGrams,
          collectionGrammes: poidsCollections,
        }),
        aiEnabled: produit.aiEnabled,
        basePriceCents: produit.basePriceCents,
        createdAt: produit.createdAt.toISOString(),
        updatedAt: produit.updatedAt.toISOString(),
      },
      categories,
      collections,
      collectionsDuProduit: liens.map((l) => l.collectionId),
      images,
      variantes: variantes.map((v) => ({
        id: v.id,
        format: v.format,
        priceCents: v.priceCents,
        compareAtCents: v.compareAtCents,
        costCents: v.costCents,
        sku: v.sku,
        barcode: v.barcode,
        weightGrams: v.weightGrams,
        poidsEffectif: poidsArticle({
          varianteGrammes: v.weightGrams,
          produitGrammes: produit.weightGrams,
          collectionGrammes: poidsCollections,
        }),
        stockQty: v.stockQty,
        stockPolicy: v.stockPolicy,
        widthMm: v.widthMm,
        heightMm: v.heightMm,
      })),
      etiquettesConnues: [...etiquettesConnues.values()].sort((a, b) =>
        a.localeCompare(b, "fr"),
      ),
    });
  });

  /* ---------------------------------------------------------------------- */
  /*  Enregistrement de la fiche                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * Enregistre la fiche entière, ou rien.
   *
   * Une clé absente n'est pas touchée : la page peut n'envoyer que ce qu'elle
   * modifie, et un champ qu'elle ignore ne risque pas d'être effacé au passage.
   * Un tableau fourni, lui, remplace la liste correspondante : c'est ainsi que
   * l'on retire une collection ou que l'on réordonne les images.
   *
   * Tout est relu avant la première écriture, et l'ensemble tient dans une
   * transaction : ou bien la fiche est enregistrée telle qu'elle a été voulue,
   * ou bien rien ne bouge et une phrase dit ce qui n'allait pas.
   */
  app.post("/admin/products/:id/fiche", async (c) => {
    const id = Number(c.req.param("id"));
    const corps = (await c.req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    try {
      if (!Number.isFinite(id))
        throw new SaisieRefusee("Ce produit n'existe plus. Rechargez la page.");

      await db.transaction(async (tx) => {
        const [produit] = await tx
          .select()
          .from(schema.products)
          .where(eq(schema.products.id, id));
        if (!produit)
          throw new SaisieRefusee(
            "Ce produit n'existe plus. Rechargez la page.",
          );

        /* -- Relecture : la fiche elle-même ------------------------------- */

        const champs: ChampsProduit = {};
        if (corps.produit !== undefined) {
          const p = objet(corps.produit);

          if ("name" in p) {
            const nom = String(p.name ?? "")
              .trim()
              .slice(0, 200);
            if (!nom)
              throw new SaisieRefusee(
                "Le nom du produit ne peut pas rester vide.",
              );
            champs.name = nom;
          }

          if ("slug" in p) {
            const slug = slugifier(String(p.slug ?? ""));
            if (!slug)
              throw new SaisieRefusee(
                "L'adresse du produit ne peut pas rester vide. Utilisez des lettres et des chiffres.",
              );
            // Unique dans tout le catalogue, y compris face aux produits que
            // la page n'affiche pas. L'ancienne adresse se libère d'elle-même :
            // elle n'appartient plus à personne une fois la ligne réécrite.
            const [pris] = await tx
              .select({ id: schema.products.id })
              .from(schema.products)
              .where(eq(schema.products.slug, slug));
            if (pris && pris.id !== produit.id)
              throw new SaisieRefusee(
                `L'adresse « ${slug} » est déjà utilisée par un autre produit. Choisissez-en une autre.`,
              );
            champs.slug = slug;
          }

          if ("description" in p)
            champs.description = texteOuNull(p.description, 20_000);

          if ("status" in p) {
            const statut = String(p.status ?? "");
            if (!(STATUTS as readonly string[]).includes(statut))
              throw new SaisieRefusee(
                "Ce statut n'existe pas. Choisissez en ligne, brouillon ou archivé.",
              );
            champs.status = statut as StatutProduit;
          }

          if ("vendor" in p) champs.vendor = texteOuNull(p.vendor, 120);
          if ("productType" in p)
            champs.productType = texteOuNull(p.productType, 120);

          if ("tags" in p) {
            if (!Array.isArray(p.tags))
              throw new SaisieRefusee(
                "Les étiquettes n'ont pas pu être lues. Rechargez la page et réessayez.",
              );
            // Dédoublonnage insensible à la casse : « Salon » et « salon »
            // désignent la même chose, et les voir deux fois dans la liste
            // donnerait l'impression que le rangement ne sert à rien.
            const propres = new Map<string, string>();
            for (const t of p.tags as unknown[]) {
              const e = etiquette(t);
              if (e && !propres.has(e.toLowerCase()))
                propres.set(e.toLowerCase(), e);
            }
            champs.tags = [...propres.values()].slice(0, 30);
          }

          // Un référencement vidé vaut « pas de titre écrit à la main », pas
          // « titre vide » : le site retombe alors sur le nom du produit, alors
          // qu'une chaîne vide ferait afficher un résultat sans titre.
          if ("seoTitle" in p) champs.seoTitle = texteOuNull(p.seoTitle, 200);
          if ("seoDescription" in p)
            champs.seoDescription = texteOuNull(p.seoDescription, 400);

          if ("categoryId" in p) {
            const brut = p.categoryId;
            if (brut === null || brut === undefined || brut === "") {
              champs.categoryId = null;
            } else {
              const categoryId = Number(brut);
              const [categorie] = Number.isFinite(categoryId)
                ? await tx
                    .select({
                      id: schema.productCategories.id,
                      archivedAt: schema.productCategories.archivedAt,
                    })
                    .from(schema.productCategories)
                    .where(eq(schema.productCategories.id, categoryId))
                : [];
              if (!categorie)
                throw new SaisieRefusee(
                  "Cette catégorie n'existe plus. Rechargez la page.",
                );
              // Une catégorie archivée ne se choisit plus. Celle où l'affiche
              // se trouve DÉJÀ reste acceptée : la fiche la renvoie à chaque
              // enregistrement, et la refuser rendrait le produit immodifiable
              // le jour où l'on range sa catégorie.
              if (categorie.archivedAt && produit.categoryId !== categoryId)
                throw new SaisieRefusee(
                  "Cette catégorie est archivée. Restaurez-la avant d'y ranger cette affiche.",
                );
              champs.categoryId = categoryId;
            }
          }

          if ("weightGrams" in p)
            champs.weightGrams = grammesOuNull(p.weightGrams, "Le poids");
        }

        /* -- Relecture : les collections ---------------------------------- */

        let collectionsVoulues: number[] | null = null;
        if (corps.collections !== undefined) {
          if (!Array.isArray(corps.collections))
            throw new SaisieRefusee(
              "Les collections n'ont pas pu être lues. Rechargez la page et réessayez.",
            );
          const ids = [
            ...new Set(
              (corps.collections as unknown[])
                .map((v) => Number(v))
                .filter((n) => Number.isFinite(n)),
            ),
          ];
          if (ids.length) {
            const existantes = await tx
              .select({ id: schema.collections.id })
              .from(schema.collections)
              .where(inArray(schema.collections.id, ids));
            if (existantes.length !== ids.length)
              throw new SaisieRefusee(
                "Une des collections choisies n'existe plus. Rechargez la page.",
              );
          }
          collectionsVoulues = ids;
        }

        /* -- Relecture : les formats -------------------------------------- */

        const variantesExistantes = await tx
          .select({
            id: schema.variants.id,
            format: schema.variants.format,
            priceCents: schema.variants.priceCents,
          })
          .from(schema.variants)
          .where(eq(schema.variants.productId, produit.id));
        const varianteParId = new Map(
          variantesExistantes.map((v) => [v.id, v] as const),
        );

        const aSupprimer: number[] = [];
        const aMettreAJour: { id: number; champs: ChampsVariante }[] = [];
        const aCreer: ChampsVariante[] = [];
        let variantesFournies = false;

        if (corps.variantes !== undefined) {
          if (!Array.isArray(corps.variantes))
            throw new SaisieRefusee(
              "Les formats n'ont pas pu être lus. Rechargez la page et réessayez.",
            );
          variantesFournies = true;
          const entrees = (corps.variantes as unknown[]).map(objet);

          // Les suppressions d'abord : il faut savoir ce qui disparaît avant de
          // pouvoir dire quels formats coexisteront à la fin.
          for (const e of entrees) {
            if (e.supprimer !== true) continue;
            const varianteId = identifiantExistant(e.id);
            const existante =
              varianteId === null ? undefined : varianteParId.get(varianteId);
            if (!existante)
              throw new SaisieRefusee(
                "Un des formats à supprimer n'existe plus. Rechargez la page.",
              );
            aSupprimer.push(existante.id);
          }

          /**
           * Les formats de CE produit qui figurent déjà dans une vente.
           *
           * On ne cherche PAS par `variant_id` : la colonne est vide dans
           * toute la base, aucun chemin d'ajout au panier ne la remplit. Le
           * format vendu se lit dans la configuration figée de la ligne,
           * exactement comme le fait le calcul du prix, et une ligne sans
           * format est un A4.
           *
           * Un panier abandonné (« draft »), une commande annulée ou avortée
           * ne comptent pas. Une commande du stand, elle, compte : elle reste
           * « en attente » à vie faute de prestataire de paiement à confirmer.
           */
          const formatsVendus = new Set<string>();
          if (aSupprimer.length || variantesExistantes.length) {
            const lignesVendues = await tx
              .select({
                format: raw<
                  string | null
                >`${schema.orderItems.config}->>'format'`,
                varianteId: schema.orderItems.variantId,
              })
              .from(schema.orderItems)
              .innerJoin(
                schema.orders,
                eq(schema.orderItems.orderId, schema.orders.id),
              )
              .where(
                and(
                  eq(schema.orderItems.productId, id),
                  notInArray(schema.orders.status, HORS_VENTES),
                ),
              );
            for (const l of lignesVendues) {
              const parNom = (l.format ?? "").trim() || FORMAT_PAR_DEFAUT;
              formatsVendus.add(parNom.toLowerCase());
              // Ceinture : le jour où `variant_id` sera rempli, cette ligne
              // protégera aussi les commandes passées d'ici là.
              if (l.varianteId !== null) {
                const nom = varianteParId.get(l.varianteId)?.format;
                if (nom) formatsVendus.add(nom.toLowerCase());
              }
            }
          }

          for (const varianteId of aSupprimer) {
            const nom = varianteParId.get(varianteId)?.format ?? "";
            if (!formatsVendus.has(nom.toLowerCase())) continue;
            throw new SaisieRefusee(
              `Le format ${nom} a déjà été vendu, il ne peut pas être supprimé : des commandes le citent. Vous pouvez le retirer de la vente en mettant son stock à zéro.`,
            );
          }

          // Les formats tels qu'ils seront APRÈS enregistrement : c'est là que
          // se voit le doublon, avant qu'il n'existe. Deux « A4 » sur la même
          // affiche, et la boutique propose deux fois le même choix à deux prix
          // différents sans que rien ne dise lequel fait foi.
          const supprimes = new Set(aSupprimer);
          const modifies = new Set<number>();
          for (const e of entrees) {
            if (e.supprimer === true) continue;
            const varianteId = identifiantExistant(e.id);
            if (varianteId !== null) modifies.add(varianteId);
          }
          const dejaVus = new Set<number>();
          const formatsFinaux = new Map<string, string>();
          for (const v of variantesExistantes)
            if (!supprimes.has(v.id) && !modifies.has(v.id))
              formatsFinaux.set(v.format.toLowerCase(), v.format);

          for (const e of entrees) {
            if (e.supprimer === true) continue;

            const format = String(e.format ?? "")
              .trim()
              .slice(0, 40);
            if (!format)
              throw new SaisieRefusee(
                "Chaque format doit porter un nom, par exemple A4 ou A3.",
              );
            // La boutique ne sait commander que les formats de sa liste : le
            // formulaire de panier les refuse tous les autres. Créer un « A2 »
            // ici donnerait une variante que personne ne pourrait acheter.
            const connu = (POSTER_FORMATS as readonly string[]).find(
              (f) => f.toLowerCase() === format.toLowerCase(),
            );
            if (!connu)
              throw new SaisieRefusee(
                `La boutique ne sait pas vendre le format ${format}. Les formats possibles sont ${POSTER_FORMATS.join(" et ")}.`,
              );
            // Renommer un format vendu revient à le supprimer : tout se
            // rattache à son nom, les commandes passées comprises.
            const varianteVisee = identifiantExistant(e.id);
            const ancienNom =
              varianteVisee === null
                ? undefined
                : varianteParId.get(varianteVisee)?.format;
            if (
              ancienNom &&
              ancienNom.toLowerCase() !== connu.toLowerCase() &&
              formatsVendus.has(ancienNom.toLowerCase())
            )
              throw new SaisieRefusee(
                `Le format ${ancienNom} a déjà été vendu, son nom ne peut plus changer : des commandes le citent.`,
              );
            if (formatsFinaux.has(format.toLowerCase()))
              throw new SaisieRefusee(
                `Le format ${format} apparaît deux fois. Un produit ne peut proposer qu'une seule fois le même format.`,
              );
            formatsFinaux.set(format.toLowerCase(), format);

            const v: ChampsVariante = {
              format,
              priceCents: centimes(e.priceCents, `Le prix du format ${format}`),
            };
            if ("compareAtCents" in e)
              v.compareAtCents = centimesOuNull(
                e.compareAtCents,
                `Le prix barré du format ${format}`,
              );
            if ("costCents" in e)
              v.costCents = centimesOuNull(
                e.costCents,
                `Le coût du format ${format}`,
              );
            if ("sku" in e) v.sku = texteOuNull(e.sku, 60);
            if ("barcode" in e) v.barcode = texteOuNull(e.barcode, 60);
            if ("weightGrams" in e)
              v.weightGrams = grammesOuNull(
                e.weightGrams,
                `Le poids du format ${format}`,
              );
            if ("stockQty" in e)
              v.stockQty = stockOuNull(
                e.stockQty,
                `Le stock du format ${format}`,
              );
            if ("stockPolicy" in e) {
              const politique = String(e.stockPolicy ?? "");
              if (!(POLITIQUES_STOCK as readonly string[]).includes(politique))
                throw new SaisieRefusee(
                  `Pour le format ${format}, indiquez s'il faut arrêter la vente en rupture de stock, ou la laisser continuer.`,
                );
              v.stockPolicy = politique;
            }

            const varianteId = identifiantExistant(e.id);
            if (varianteId !== null) {
              // Un format d'un AUTRE produit n'a rien à faire ici : sans ce
              // contrôle, une page restée ouverte sur deux onglets pourrait
              // réécrire le prix d'une autre affiche.
              if (!varianteParId.has(varianteId))
                throw new SaisieRefusee(
                  "Un des formats n'existe plus. Rechargez la page.",
                );
              // Le même format cité deux fois, une fois à supprimer et une fois
              // à modifier : impossible de deviner ce qui est voulu, et écrire
              // l'un puis l'autre donnerait un résultat au hasard de l'ordre.
              if (supprimes.has(varianteId) || dejaVus.has(varianteId))
                throw new SaisieRefusee(
                  `Le format ${format} est envoyé deux fois. Rechargez la page et reprenez la modification.`,
                );
              dejaVus.add(varianteId);
              aMettreAJour.push({ id: varianteId, champs: v });
            } else {
              aCreer.push(v);
            }
          }

          if (formatsFinaux.size === 0 && variantesExistantes.length)
            throw new SaisieRefusee(
              "Un produit doit garder au moins un format en vente.",
            );
        }

        /* -- Relecture : les images --------------------------------------- */

        let imagesVoulues:
          | { id: number | null; url: string; alt: string | null }[]
          | null = null;
        if (corps.images !== undefined) {
          if (!Array.isArray(corps.images))
            throw new SaisieRefusee(
              "Les images n'ont pas pu être lues. Rechargez la page et réessayez.",
            );
          const existantes = await tx
            .select({
              id: schema.productImages.id,
              alt: schema.productImages.alt,
            })
            .from(schema.productImages)
            .where(eq(schema.productImages.productId, produit.id));
          const connues = new Map(existantes.map((i) => [i.id, i] as const));
          const dejaVues = new Set<number>();
          imagesVoulues = (corps.images as unknown[]).map(objet).map((e) => {
            const imageId = identifiantExistant(e.id);
            if (imageId !== null && !connues.has(imageId))
              throw new SaisieRefusee(
                "Une des images n'existe plus. Rechargez la page.",
              );
            // Deux fois la même image dans la liste, ce n'est pas deux images :
            // la seconde écraserait la position de la première et la boutique
            // en afficherait une de moins que ce que montre la page.
            if (imageId !== null && dejaVues.has(imageId))
              throw new SaisieRefusee(
                "La même image apparaît deux fois. Retirez le doublon.",
              );
            if (imageId !== null) dejaVues.add(imageId);
            // Une image renvoyée sans son texte alternatif ne demande pas qu'on
            // l'efface : la page peut n'avoir réordonné la liste, et le texte
            // écrit pour les lecteurs d'écran doit lui survivre.
            const alt =
              "alt" in e
                ? texteOuNull(e.alt, 200)
                : imageId === null
                  ? null
                  : (connues.get(imageId)?.alt ?? null);
            return { id: imageId, url: urlImage(e.url), alt };
          });
        }

        /* -- Écriture ----------------------------------------------------- */

        if (aSupprimer.length)
          await tx
            .delete(schema.variants)
            .where(
              and(
                eq(schema.variants.productId, produit.id),
                inArray(schema.variants.id, aSupprimer),
              ),
            );

        for (const v of aMettreAJour)
          await tx
            .update(schema.variants)
            .set(v.champs)
            .where(
              and(
                eq(schema.variants.id, v.id),
                eq(schema.variants.productId, produit.id),
              ),
            );

        for (const v of aCreer) {
          // `format` et `priceCents` sont garantis par la relecture ci-dessus ;
          // les redonner ici évite d'avoir à convaincre le typage d'un objet
          // partiel là où la base attend deux colonnes obligatoires.
          if (v.format === undefined || v.priceCents === undefined) continue;
          await tx.insert(schema.variants).values({
            ...v,
            productId: produit.id,
            format: v.format,
            priceCents: v.priceCents,
          });
        }

        if (collectionsVoulues !== null) {
          await tx
            .delete(schema.productCollections)
            .where(eq(schema.productCollections.productId, produit.id));
          if (collectionsVoulues.length)
            await tx.insert(schema.productCollections).values(
              collectionsVoulues.map((collectionId, i) => ({
                productId: produit.id,
                collectionId,
                position: i,
              })),
            );
        }

        if (imagesVoulues !== null) {
          // L'ordre du tableau fait la position : c'est ainsi que la page
          // permet de choisir l'image principale, en la glissant en tête.
          const gardees = imagesVoulues
            .map((i) => i.id)
            .filter((i): i is number => i !== null);
          await tx
            .delete(schema.productImages)
            .where(
              gardees.length
                ? and(
                    eq(schema.productImages.productId, produit.id),
                    notInArray(schema.productImages.id, gardees),
                  )
                : eq(schema.productImages.productId, produit.id),
            );
          for (const [position, image] of imagesVoulues.entries()) {
            if (image.id === null) {
              await tx.insert(schema.productImages).values({
                productId: produit.id,
                url: image.url,
                alt: image.alt,
                position,
              });
            } else {
              await tx
                .update(schema.productImages)
                .set({ url: image.url, alt: image.alt, position })
                .where(
                  and(
                    eq(schema.productImages.id, image.id),
                    eq(schema.productImages.productId, produit.id),
                  ),
                );
            }
          }
        }

        // Le prix de base suit le plus bas des formats, comme à la création
        // d'un produit : c'est lui qui s'affiche en « à partir de ». Il ne
        // sert de vrai prix que pour un produit sans aucun format, et on le
        // laisse alors tel quel plutôt que de le ramener à zéro.
        const misAJour: ChampsProduit & {
          basePriceCents?: number;
          updatedAt: Date;
        } = { ...champs, updatedAt: new Date() };
        if (variantesFournies) {
          const restantes = await tx
            .select({ priceCents: schema.variants.priceCents })
            .from(schema.variants)
            .where(eq(schema.variants.productId, produit.id));
          if (restantes.length)
            misAJour.basePriceCents = Math.min(
              ...restantes.map((v) => v.priceCents),
            );
        }

        await tx
          .update(schema.products)
          .set(misAJour)
          .where(eq(schema.products.id, produit.id));
      });
    } catch (erreur) {
      if (erreur instanceof SaisieRefusee)
        return c.json({ error: erreur.message }, 400);
      // La base peut refuser au dernier moment ce que la relecture ne pouvait
      // pas voir, par exemple une adresse prise entre-temps par quelqu'un
      // d'autre. La transaction a tout annulé : la fiche est intacte, il n'y a
      // qu'à recommencer.
      console.error("[fiche produit] enregistrement impossible", erreur);
      return c.json(
        {
          error:
            "Cette fiche n'a pas pu être enregistrée. Vérifiez son adresse web, puis réessayez.",
        },
        400,
      );
    }

    return c.json({ ok: true });
  });
}
