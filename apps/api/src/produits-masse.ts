/**
 * Le catalogue vu comme un tableau : tout voir, et tout corriger d'un coup.
 *
 * Un catalogue de deux cents affiches ne se tient pas fiche par fiche. Il y a
 * toujours une trentaine de produits à repasser en brouillon avant un salon,
 * un rayon entier à ranger dans la bonne catégorie une fois celle-ci créée,
 * ou une remise de saison à appliquer. Fiche par fiche, c'est une heure de
 * clics et une chance réelle d'en oublier un ; ici c'est une sélection et un
 * bouton.
 *
 * Deux principes gouvernent ce fichier, parce qu'une action de masse se
 * trompe en masse. D'abord, un produit déjà vendu ne s'efface jamais : les
 * commandes passées le citent, et le supprimer reviendrait à trouer
 * l'historique des ventes. Ensuite, une ligne fautive ne fait pas tomber
 * les autres : elle ressort seule, nommée et expliquée, pendant que le reste
 * du lot est bien enregistré.
 */
import type { Hono } from "hono";
import { and, asc, count, eq, inArray, or, sql as raw } from "drizzle-orm";
import { poidsArticle } from "@memoryline/types";
import { db, schema } from "./db/client.js";

/** Les seuls états qu'un produit peut prendre. */
const STATUTS = ["active", "draft", "archived"] as const;
type StatutProduit = (typeof STATUTS)[number];

function statutValide(v: unknown): v is StatutProduit {
  return typeof v === "string" && (STATUTS as readonly string[]).includes(v);
}

/** Identifiants d'une sélection, dédoublonnés, débarrassés de ce qui n'en est pas. */
function identifiants(v: unknown): number[] {
  return [
    ...new Set(
      (Array.isArray(v) ? (v as unknown[]) : [])
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n)),
    ),
  ];
}

/** Entier de grammes, ou null quand la valeur n'en est pas un. */
function grammes(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Un poids saisi dans un formulaire.
 *
 * Trois réponses possibles, et il faut vraiment les trois : un nombre, un
 * champ vidé (qui veut dire « reprends celui de la catégorie », pas « zéro
 * gramme »), et une saisie qui n'a pas de sens. Confondre les deux dernières
 * ferait passer une faute de frappe pour un effacement voulu, et le colis
 * partirait sous-affranchi sans que rien ne le signale.
 */
function poidsSaisi(v: unknown): { valeur: number | null } | null {
  if (v === null || v === undefined || v === "") return { valeur: null };
  const n = grammes(v);
  return n === null ? null : { valeur: n };
}

/**
 * Adresse web d'un produit, nettoyée.
 *
 * Rend une chaîne vide quand il ne reste rien d'utilisable : contrairement
 * aux catégories, le slug d'un produit est ici saisi à la main, et une saisie
 * qui ne donne rien doit être refusée à la commerçante plutôt que remplacée
 * en douce par un mot inventé.
 */
function slugifier(valeur: string): string {
  return valeur
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Prix après un changement en masse.
 *
 * Un pourcentage tombe rarement juste : on arrondit au centime, faute de quoi
 * la boutique afficherait des prix à la fraction de centime et les totaux ne
 * retomberaient jamais sur leurs pieds. Et rien ne passe sous zéro : une
 * remise de 120 % donne un produit gratuit, pas un produit qui rapporte de
 * l'argent au client.
 */
function nouveauPrix(
  base: number,
  mode: string,
  montantCents: number | null,
  pourcent: number | null,
): number {
  const sens = mode === "diminuer" ? -1 : 1;
  if (pourcent !== null)
    return Math.max(0, Math.round(base * (1 + (sens * pourcent) / 100)));
  return Math.max(0, base + sens * (montantCents ?? 0));
}

/** Ce qu'une ligne du tableau peut changer sur un produit. */
interface ChampsProduit {
  name?: string;
  slug?: string;
  basePriceCents?: number;
  status?: StatutProduit;
  categoryId?: number | null;
  weightGrams?: number | null;
  aiEnabled?: boolean;
}

type Verdict =
  | {
      ok: true;
      donnees: ChampsProduit;
      /** Nouveau prix par format, en centimes. Vide quand rien ne change. */
      prix: Map<string, number>;
    }
  | { ok: false; message: string };

/**
 * Relit une ligne du tableau AVANT d'écrire quoi que ce soit.
 *
 * Tout est vérifié d'abord et enregistré ensuite : une ligne à moitié
 * appliquée (le prix passé, le statut refusé) laisserait un produit dans un
 * état que personne n'a demandé, et que rien à l'écran ne trahirait.
 */
function verifierLigne(
  m: Record<string, unknown>,
  produit: { id: number; slug: string },
  connu: {
    proprietaireDuSlug: Map<string, number>;
    categories: Set<number>;
  },
): Verdict {
  const donnees: ChampsProduit = {};
  const prix = new Map<string, number>();

  if ("prix" in m && m.prix && typeof m.prix === "object") {
    // Reçu sous la forme { "A4": 2300, "A3": 3500 } : le format est la clé,
    // parce que c'est ainsi que la grille présente ses colonnes.
    for (const [format, valeur] of Object.entries(
      m.prix as Record<string, unknown>,
    )) {
      const cents = Math.round(Number(valeur));
      if (!Number.isFinite(cents))
        return {
          ok: false,
          message: `Le prix du format ${format} doit être un nombre.`,
        };
      if (cents < 0)
        return {
          ok: false,
          message: `Le prix du format ${format} ne peut pas être négatif.`,
        };
      prix.set(format, cents);
    }
  }

  if ("name" in m) {
    const nom = String(m.name ?? "").trim();
    if (!nom) return { ok: false, message: "Le nom ne peut pas rester vide." };
    donnees.name = nom;
  }

  if ("slug" in m) {
    const slug = slugifier(String(m.slug ?? ""));
    if (!slug)
      return {
        ok: false,
        message:
          "L'adresse du produit ne peut pas rester vide. Utilisez des lettres et des chiffres.",
      };
    const proprietaire = connu.proprietaireDuSlug.get(slug);
    if (proprietaire !== undefined && proprietaire !== produit.id)
      return {
        ok: false,
        message: `L'adresse « ${slug} » est déjà utilisée par un autre produit. Choisissez-en une autre.`,
      };
    if (slug !== produit.slug) donnees.slug = slug;
  }

  if ("basePriceCents" in m) {
    const prix = Math.round(Number(m.basePriceCents));
    if (!Number.isFinite(prix))
      return { ok: false, message: "Le prix doit être un nombre." };
    if (prix < 0)
      return { ok: false, message: "Le prix ne peut pas être négatif." };
    donnees.basePriceCents = prix;
  }

  if ("status" in m) {
    if (!statutValide(m.status))
      return {
        ok: false,
        message:
          "Ce statut n'existe pas. Choisissez en ligne, brouillon ou archivé.",
      };
    donnees.status = m.status;
  }

  if ("categoryId" in m) {
    const brut = m.categoryId;
    if (brut === null || brut === "" || brut === undefined) {
      donnees.categoryId = null;
    } else {
      const categoryId = Number(brut);
      if (!Number.isFinite(categoryId) || !connu.categories.has(categoryId))
        return {
          ok: false,
          message: "Cette catégorie n'existe plus. Rechargez la page.",
        };
      donnees.categoryId = categoryId;
    }
  }

  if ("weightGrams" in m) {
    const poids = poidsSaisi(m.weightGrams);
    if (!poids)
      return {
        ok: false,
        message:
          "Le poids doit être un nombre de grammes. Laissez vide pour reprendre celui de la catégorie.",
      };
    donnees.weightGrams = poids.valeur;
  }

  if ("aiEnabled" in m) donnees.aiEnabled = m.aiEnabled === true;

  return { ok: true, donnees, prix };
}

export function mountProduitsMasse(app: Hono): void {
  /* ---------------------------------------------------------------------- */
  /*  Le tableau                                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * Tout ce qu'affiche la page de gestion en masse, en une seule réponse.
   *
   * Variantes, image et collections sont ramassées par lots pour l'ensemble
   * des produits affichés : une requête par produit tiendrait encore à vingt
   * affiches et rendrait la page inutilisable à deux cents.
   */
  app.get("/admin/products", async (c) => {
    const q = c.req.query();
    const limite = Math.min(Number(q.limit ?? 500) || 500, 1000);

    // Ces filtres-là comptent aussi pour les onglets : « Actifs 200 » doit
    // parler de la recherche en cours, sinon les compteurs contrediraient le
    // tableau qu'ils surmontent.
    const communs = [];
    const cherche = (q.q ?? "").trim();
    if (cherche) {
      const motif = `%${cherche.toLowerCase()}%`;
      communs.push(
        or(
          raw`lower(${schema.products.name}) like ${motif}`,
          raw`lower(${schema.products.slug}) like ${motif}`,
        )!,
      );
    }
    const categorieFiltre = Number(q.categorie);
    if (Number.isFinite(categorieFiltre) && categorieFiltre > 0)
      communs.push(eq(schema.products.categoryId, categorieFiltre));
    const collectionFiltre = Number(q.collection);
    if (Number.isFinite(collectionFiltre) && collectionFiltre > 0)
      communs.push(
        raw`exists (select 1 from ${schema.productCollections} pc where pc.product_id = ${schema.products.id} and pc.collection_id = ${collectionFiltre})`,
      );

    // Les compteurs ignorent en revanche le statut demandé : ce sont eux qui
    // permettent de cliquer sur « Archivés 2 » quand on regarde les actifs.
    const parStatut = await db
      .select({ status: schema.products.status, n: count() })
      .from(schema.products)
      .where(communs.length ? and(...communs) : undefined)
      .groupBy(schema.products.status);
    const compte = { tous: 0, active: 0, draft: 0, archived: 0 };
    for (const r of parStatut) {
      const n = Number(r.n);
      compte.tous += n;
      if (statutValide(r.status)) compte[r.status] += n;
    }

    const conditions = [...communs];
    if (statutValide(q.statut))
      conditions.push(eq(schema.products.status, q.statut));

    const lignes = await db
      .select({
        id: schema.products.id,
        name: schema.products.name,
        slug: schema.products.slug,
        kind: schema.products.kind,
        status: schema.products.status,
        basePriceCents: schema.products.basePriceCents,
        categoryId: schema.products.categoryId,
        weightGrams: schema.products.weightGrams,
        aiEnabled: schema.products.aiEnabled,
      })
      .from(schema.products)
      .where(conditions.length ? and(...conditions) : undefined)
      // Par ordre alphabétique : on cherche ici un produit dont on connaît le
      // nom, pas une création récente.
      .orderBy(asc(schema.products.name), asc(schema.products.id))
      .limit(limite);

    const ids = lignes.map((l) => l.id);

    const categories = await db
      .select({
        id: schema.productCategories.id,
        name: schema.productCategories.name,
        defaultWeightGrams: schema.productCategories.defaultWeightGrams,
      })
      .from(schema.productCategories)
      .orderBy(
        asc(schema.productCategories.position),
        asc(schema.productCategories.name),
      );
    const collections = await db
      .select({ id: schema.collections.id, name: schema.collections.name })
      .from(schema.collections)
      .orderBy(asc(schema.collections.position), asc(schema.collections.name));

    // Les prix, pas seulement le nombre de formats : la liste doit montrer ce
    // que le client paiera, et le prix de base ne le dit pas.
    const variantes = ids.length
      ? await db
          .select({
            productId: schema.variants.productId,
            format: schema.variants.format,
            priceCents: schema.variants.priceCents,
          })
          .from(schema.variants)
          .where(inArray(schema.variants.productId, ids))
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
    const liens = ids.length
      ? await db
          .select({
            productId: schema.productCollections.productId,
            id: schema.collections.id,
            name: schema.collections.name,
          })
          .from(schema.productCollections)
          .innerJoin(
            schema.collections,
            eq(schema.productCollections.collectionId, schema.collections.id),
          )
          .where(inArray(schema.productCollections.productId, ids))
          .orderBy(
            asc(schema.productCollections.position),
            asc(schema.collections.name),
          )
      : [];

    const nombreDeVariantes = new Map<number, number>();
    const prixParProduit = new Map<number, { min: number; max: number }>();
    const formatsParProduit = new Map<number, string[]>();
    const tousLesFormats = new Set<string>();
    for (const v of variantes) {
      nombreDeVariantes.set(v.productId, (nombreDeVariantes.get(v.productId) ?? 0) + 1);
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
      tousLesFormats.add(v.format);
    }

    // La première rencontrée est celle de position la plus basse : c'est
    // l'image principale, celle qui illustre déjà le produit en boutique.
    const imageParProduit = new Map<number, string>();
    for (const img of images)
      if (!imageParProduit.has(img.productId))
        imageParProduit.set(img.productId, img.url);

    const collectionsParProduit = new Map<number, { id: number; name: string }[]>();
    for (const l of liens) {
      const liste = collectionsParProduit.get(l.productId) ?? [];
      liste.push({ id: l.id, name: l.name });
      collectionsParProduit.set(l.productId, liste);
    }

    const categorieParId = new Map(categories.map((cat) => [cat.id, cat]));

    return c.json({
      produits: lignes.map((p) => {
        const categorie =
          p.categoryId === null ? undefined : categorieParId.get(p.categoryId);
        return {
          id: p.id,
          name: p.name,
          slug: p.slug,
          kind: p.kind,
          status: p.status,
          basePriceCents: p.basePriceCents,
          categoryId: p.categoryId,
          categoryName: categorie?.name ?? null,
          weightGrams: p.weightGrams,
          // Ce qui sera réellement pesé, cadre non compris : le tableau montre
          // « 60 g » sur un produit au champ vide plutôt qu'une case muette.
          poidsEffectif: poidsArticle({
            produitGrammes: p.weightGrams,
            categorieGrammes: categorie?.defaultWeightGrams,
          }),
          prixMin: prixParProduit.get(p.id)?.min ?? null,
          prixMax: prixParProduit.get(p.id)?.max ?? null,
          formats: formatsParProduit.get(p.id) ?? [],
          aiEnabled: p.aiEnabled,
          imageUrl: imageParProduit.get(p.id) ?? null,
          variantes: nombreDeVariantes.get(p.id) ?? 0,
          collections: collectionsParProduit.get(p.id) ?? [],
        };
      }),
      categories: categories.map((cat) => ({ id: cat.id, name: cat.name })),
      collections,
      formats: [...tousLesFormats].sort(),
      compte,
    });
  });

  /* ---------------------------------------------------------------------- */
  /*  Actions groupées                                                      */
  /* ---------------------------------------------------------------------- */

  /**
   * Une même action sur tous les produits cochés.
   *
   * C'est la contrepartie du tableau : trente affiches à archiver après un
   * salon, c'est le genre de corvée qui fait détester un outil quand il faut
   * ouvrir trente fiches.
   */
  app.post("/admin/products/bulk", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const ids = identifiants(b.ids);
    const action = String(b.action ?? "");
    if (!ids.length) return c.json({ error: "Aucun produit sélectionné." }, 400);

    if (action === "statut") {
      if (!statutValide(b.valeur))
        return c.json(
          {
            error:
              "Ce statut n'existe pas. Choisissez en ligne, brouillon ou archivé.",
          },
          400,
        );
      const faits = await db
        .update(schema.products)
        .set({ status: b.valeur, updatedAt: new Date() })
        .where(inArray(schema.products.id, ids))
        .returning({ id: schema.products.id });
      return c.json({ ok: true, count: faits.length });
    }

    if (action === "categorie") {
      const brut = b.categoryId;
      let categoryId: number | null = null;
      if (brut !== null && brut !== undefined && brut !== "") {
        categoryId = Number(brut);
        const [existe] = Number.isFinite(categoryId)
          ? await db
              .select({ id: schema.productCategories.id })
              .from(schema.productCategories)
              .where(eq(schema.productCategories.id, categoryId))
          : [];
        if (!existe)
          return c.json(
            { error: "Cette catégorie n'existe plus. Rechargez la page." },
            400,
          );
      }
      const faits = await db
        .update(schema.products)
        .set({ categoryId, updatedAt: new Date() })
        .where(inArray(schema.products.id, ids))
        .returning({ id: schema.products.id });
      return c.json({ ok: true, count: faits.length });
    }

    if (action === "poids") {
      const poids = poidsSaisi(b.weightGrams);
      if (!poids)
        return c.json(
          {
            error:
              "Le poids doit être un nombre de grammes. Laissez vide pour reprendre celui de la catégorie.",
          },
          400,
        );
      const faits = await db
        .update(schema.products)
        .set({ weightGrams: poids.valeur, updatedAt: new Date() })
        .where(inArray(schema.products.id, ids))
        .returning({ id: schema.products.id });
      return c.json({ ok: true, count: faits.length });
    }

    if (action === "prix") {
      const mode = String(b.mode ?? "");
      if (mode !== "fixe" && mode !== "augmenter" && mode !== "diminuer")
        return c.json({ error: "Choisissez comment changer le prix." }, 400);

      const brutMontant = b.montantCents;
      const montantCents =
        brutMontant === null || brutMontant === undefined || brutMontant === ""
          ? null
          : Math.round(Number(brutMontant));
      if (montantCents !== null && !Number.isFinite(montantCents))
        return c.json({ error: "Le montant doit être un nombre." }, 400);
      const brutPourcent = b.pourcent;
      const pourcent =
        brutPourcent === null ||
        brutPourcent === undefined ||
        brutPourcent === ""
          ? null
          : Number(brutPourcent);
      if (pourcent !== null && !Number.isFinite(pourcent))
        return c.json({ error: "Le pourcentage doit être un nombre." }, 400);

      if (mode === "fixe" && montantCents === null)
        return c.json({ error: "Indiquez le nouveau prix." }, 400);
      if (mode !== "fixe" && montantCents === null && pourcent === null)
        return c.json(
          { error: "Indiquez un montant ou un pourcentage." },
          400,
        );

      // Le format visé. « tous » par défaut ; sinon on ne touche qu'à celui-là,
      // ce qui permet de remonter les A3 sans bouger les A4.
      const format = String(b.format ?? "tous").trim() || "tous";

      /** Le prix que devient un prix. La règle d'arrondi est ce qui compte. */
      const calculer = (actuel: number) =>
        mode === "fixe"
          ? Math.max(0, montantCents ?? actuel)
          : nouveauPrix(actuel, mode, montantCents, pourcent);

      // C'est la variante qui porte le prix payé ; le prix de base n'est qu'un
      // repli pour un produit qui n'aurait aucun format. Ne modifier que lui
      // n'aurait rien changé à la caisse.
      const variantes = await db
        .select({
          id: schema.variants.id,
          productId: schema.variants.productId,
          format: schema.variants.format,
          priceCents: schema.variants.priceCents,
        })
        .from(schema.variants)
        .where(inArray(schema.variants.productId, ids));

      const visees =
        format === "tous"
          ? variantes
          : variantes.filter((v) => v.format === format);
      const touches = new Set<number>();
      for (const v of visees) {
        const suivant = calculer(v.priceCents);
        if (suivant === v.priceCents) continue;
        await db
          .update(schema.variants)
          .set({ priceCents: suivant })
          .where(eq(schema.variants.id, v.id));
        v.priceCents = suivant;
        touches.add(v.productId);
      }

      // Un produit sans aucun format n'a que son prix de repli : sans ce
      // rattrapage, l'action resterait sans effet sur lui, sans le dire.
      const avecFormats = new Set(variantes.map((v) => v.productId));
      const sansFormat = ids.filter((i) => !avecFormats.has(i));
      if (sansFormat.length && format === "tous") {
        const rows = await db
          .select({
            id: schema.products.id,
            basePriceCents: schema.products.basePriceCents,
          })
          .from(schema.products)
          .where(inArray(schema.products.id, sansFormat));
        for (const r of rows) {
          const suivant = calculer(r.basePriceCents);
          if (suivant === r.basePriceCents) continue;
          await db
            .update(schema.products)
            .set({ basePriceCents: suivant, updatedAt: new Date() })
            .where(eq(schema.products.id, r.id));
          touches.add(r.id);
        }
      }

      // Le prix de base suit le plus bas des formats, comme à la création d'un
      // produit : c'est lui qui s'affiche en « à partir de ».
      const minParProduit = new Map<number, number>();
      for (const v of variantes) {
        const connu = minParProduit.get(v.productId);
        if (connu === undefined || v.priceCents < connu)
          minParProduit.set(v.productId, v.priceCents);
      }
      for (const produitId of touches) {
        const bas = minParProduit.get(produitId);
        if (bas === undefined) continue;
        await db
          .update(schema.products)
          .set({ basePriceCents: bas, updatedAt: new Date() })
          .where(eq(schema.products.id, produitId));
      }

      return c.json({ ok: true, count: touches.size });
    }

    if (action === "collection-ajouter" || action === "collection-retirer") {
      const collectionId = Number(b.collectionId);
      const [collection] = Number.isFinite(collectionId)
        ? await db
            .select({ id: schema.collections.id })
            .from(schema.collections)
            .where(eq(schema.collections.id, collectionId))
        : [];
      if (!collection)
        return c.json(
          { error: "Cette collection n'existe plus. Rechargez la page." },
          400,
        );

      if (action === "collection-retirer") {
        const retires = await db
          .delete(schema.productCollections)
          .where(
            and(
              eq(schema.productCollections.collectionId, collectionId),
              inArray(schema.productCollections.productId, ids),
            ),
          )
          .returning({ productId: schema.productCollections.productId });
        return c.json({ ok: true, count: retires.length });
      }

      const existants = await db
        .select({ id: schema.products.id })
        .from(schema.products)
        .where(inArray(schema.products.id, ids));
      if (!existants.length) return c.json({ ok: true, count: 0 });
      // Un produit déjà rangé dans la collection est un cas normal, pas une
      // erreur : on le laisse tranquille et les autres passent.
      await db
        .insert(schema.productCollections)
        .values(
          existants.map((p) => ({ productId: p.id, collectionId })),
        )
        .onConflictDoNothing();
      return c.json({ ok: true, count: existants.length });
    }

    if (action === "ia") {
      const faits = await db
        .update(schema.products)
        .set({ aiEnabled: b.valeur === true, updatedAt: new Date() })
        .where(inArray(schema.products.id, ids))
        .returning({ id: schema.products.id });
      return c.json({ ok: true, count: faits.length });
    }

    if (action === "supprimer") {
      // Une commande passée cite le produit qu'elle contient. L'effacer
      // viderait des ventes déjà faites de leur libellé et de leur lien, et
      // aucune comptabilité ne se relit après ça.
      const vendus = await db
        .select({ productId: schema.orderItems.productId })
        .from(schema.orderItems)
        .where(inArray(schema.orderItems.productId, ids))
        .groupBy(schema.orderItems.productId);
      const proteges = new Set(
        vendus
          .map((v) => v.productId)
          .filter((n): n is number => n !== null),
      );

      const refuses: { id: number; name: string; raison: string }[] = [];
      if (proteges.size) {
        const noms = await db
          .select({ id: schema.products.id, name: schema.products.name })
          .from(schema.products)
          .where(inArray(schema.products.id, [...proteges]));
        for (const p of noms)
          refuses.push({
            id: p.id,
            name: p.name,
            raison:
              "Ce produit figure dans des commandes, il ne peut pas être supprimé. Archivez-le plutôt.",
          });
      }

      const aSupprimer = ids.filter((id) => !proteges.has(id));
      const supprimes = aSupprimer.length
        ? await db
            .delete(schema.products)
            .where(inArray(schema.products.id, aSupprimer))
            .returning({ id: schema.products.id })
        : [];
      return c.json({
        ok: true,
        count: supprimes.length,
        ...(refuses.length ? { refuses } : {}),
      });
    }

    return c.json({ error: "Action inconnue." }, 400);
  });

  /* ---------------------------------------------------------------------- */
  /*  Édition ligne à ligne                                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * Enregistre les cases modifiées à même le tableau.
   *
   * Le tableau s'édite comme un tableur : on corrige dix noms et trois prix,
   * puis on enregistre une seule fois. Chaque ligne est jugée seule, et une
   * ligne refusée revient dans `erreurs` avec sa raison au lieu d'annuler le
   * travail des neuf autres.
   */
  app.post("/admin/products/masse", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const modifications = (
      Array.isArray(b.modifications) ? (b.modifications as unknown[]) : []
    ).filter(
      (m): m is Record<string, unknown> => typeof m === "object" && m !== null,
    );
    if (!modifications.length) return c.json({ ok: true, count: 0 });

    const ids = identifiants(modifications.map((m) => m.id));
    const produits = ids.length
      ? await db
          .select({ id: schema.products.id, slug: schema.products.slug })
          .from(schema.products)
          .where(inArray(schema.products.id, ids))
      : [];
    const parId = new Map(produits.map((p) => [p.id, p]));

    // Tous les slugs du catalogue, pas seulement ceux du lot : l'adresse d'un
    // produit doit rester unique face à ceux que la page n'affiche même pas.
    const tousLesSlugs = await db
      .select({ id: schema.products.id, slug: schema.products.slug })
      .from(schema.products);
    const proprietaireDuSlug = new Map(
      tousLesSlugs.map((p) => [p.slug, p.id] as const),
    );
    const categories = await db
      .select({ id: schema.productCategories.id })
      .from(schema.productCategories);
    const categoriesConnues = new Set(categories.map((cat) => cat.id));

    // Les formats du lot, chargés une fois : la grille en modifie plusieurs
    // par ligne, et une requête par cellule serait une requête de trop.
    const variantesDuLot = ids.length
      ? await db
          .select({
            id: schema.variants.id,
            productId: schema.variants.productId,
            format: schema.variants.format,
            priceCents: schema.variants.priceCents,
          })
          .from(schema.variants)
          .where(inArray(schema.variants.productId, ids))
      : [];
    const variantesParProduit = new Map<
      number,
      { id: number; format: string; priceCents: number }[]
    >();
    for (const v of variantesDuLot) {
      const liste = variantesParProduit.get(v.productId) ?? [];
      liste.push({ id: v.id, format: v.format, priceCents: v.priceCents });
      variantesParProduit.set(v.productId, liste);
    }

    const erreurs: { id: number; message: string }[] = [];
    let count = 0;

    for (const m of modifications) {
      const id = Number(m.id);
      const produit = Number.isFinite(id) ? parId.get(id) : undefined;
      if (!produit) {
        erreurs.push({
          id: Number.isFinite(id) ? id : 0,
          message: "Ce produit n'existe plus. Rechargez la page.",
        });
        continue;
      }

      const verdict = verifierLigne(m, produit, {
        proprietaireDuSlug,
        categories: categoriesConnues,
      });
      if (!verdict.ok) {
        erreurs.push({ id: produit.id, message: verdict.message });
        continue;
      }
      const formatsDuProduit = variantesParProduit.get(produit.id) ?? [];
      // Ne garder que les prix qui changent VRAIMENT : réécrire une valeur
      // identique ferait compter la ligne comme modifiée, et la page
      // annoncerait un travail qu'elle n'a pas fait.
      const prixAEcrire = formatsDuProduit.filter((v) => {
        const voulu = verdict.prix.get(v.format);
        return voulu !== undefined && voulu !== v.priceCents;
      });
      if (!Object.keys(verdict.donnees).length && !prixAEcrire.length) continue;

      try {
        if (Object.keys(verdict.donnees).length)
          await db
            .update(schema.products)
            .set({ ...verdict.donnees, updatedAt: new Date() })
            .where(eq(schema.products.id, produit.id));
      } catch {
        // Le lot entier ne tombe pas pour une ligne : la base peut refuser une
        // adresse prise entre-temps par quelqu'un d'autre, et les lignes
        // saines doivent quand même être enregistrées.
        erreurs.push({
          id: produit.id,
          message:
            "Cette ligne n'a pas pu être enregistrée. Vérifiez son adresse, puis réessayez.",
        });
        continue;
      }

      if (verdict.donnees.slug) {
        proprietaireDuSlug.delete(produit.slug);
        proprietaireDuSlug.set(verdict.donnees.slug, produit.id);
      }
      if (prixAEcrire.length) {
        for (const v of prixAEcrire) {
          const voulu = verdict.prix.get(v.format);
          if (voulu === undefined) continue;
          await db
            .update(schema.variants)
            .set({ priceCents: voulu })
            .where(eq(schema.variants.id, v.id));
          v.priceCents = voulu;
        }
        // Le prix de base suit le plus bas des formats : c'est lui qui sert de
        // « à partir de » en boutique.
        const bas = Math.min(...formatsDuProduit.map((v) => v.priceCents));
        if (Number.isFinite(bas))
          await db
            .update(schema.products)
            .set({ basePriceCents: bas, updatedAt: new Date() })
            .where(eq(schema.products.id, produit.id));
      }

      count++;
    }

    return c.json({
      ok: true,
      count,
      ...(erreurs.length ? { erreurs } : {}),
    });
  });
}
