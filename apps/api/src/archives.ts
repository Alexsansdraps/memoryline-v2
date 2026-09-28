/**
 * Tout ce qui est archivé, au même endroit.
 *
 * Chaque écran du back-office garde SA section « Archivés » — c'est là qu'on
 * range et qu'on restaure au fil du travail. Mais après trois mois, « j'avais
 * retiré une affiche cet hiver, où est-elle ? » n'a plus de réponse : il faut
 * se souvenir de l'écran avant de pouvoir chercher. Cette route répond à la
 * question sans le souvenir, en relisant toutes les tables qui savent archiver.
 *
 * Elle ne fait que LIRE. La restauration passe, elle, par la route d'archivage
 * de chaque nature (`/admin/collections/:id/archive` et ses sœurs) : une
 * seconde voie d'écriture finirait par diverger de la première, et c'est la
 * première qui connaît les règles — une tranche de livraison, par exemple,
 * refuse de revenir si une autre couvre déjà son poids.
 *
 * `dateSource` dit ce que la date raconte. Presque partout c'est `archivage`,
 * l'heure exacte du rangement. Pour les produits, c'est `modification` : leur
 * archivage est un STATUT (`status = 'archived'`) et non une date, donc la
 * seule date disponible est celle du dernier enregistrement. L'écran doit
 * écrire « Modifié le » et non « Archivé le » — une date inventée vaudrait
 * moins que pas de date du tout.
 */
import type { Hono } from "hono";
import { and, desc, eq, isNotNull, sql as raw } from "drizzle-orm";
import { formaterPoids } from "@memoryline/types";
import { db, schema } from "./db/client.js";

/** Une chose archivée, telle que l'écran l'affiche. */
export interface ElementArchive {
  id: number;
  /** Le nom sous lequel la patronne la reconnaît. */
  libelle: string;
  /** Une précision qui lève l'ambiguïté entre deux homonymes. Peut manquer. */
  detail: string | null;
  /** ISO, ou null quand la ligne n'a gardé aucune date. */
  date: string | null;
}

/** Une nature de chose archivée : les pages, les collections, les fonds… */
export interface GroupeArchives {
  /** Ce que le back-office renvoie pour demander la restauration. */
  cle: string;
  titre: string;
  /** L'écran où cette nature se range et se restaure aussi, chemin du BO. */
  ecran: string;
  /** Son nom dans le menu de gauche, pour que le lien se lise. */
  ecranNom: string;
  /** Ce que la date raconte : l'archivage lui-même, ou le dernier changement. */
  dateSource: "archivage" | "modification";
  elements: ElementArchive[];
}

/** Date ISO, ou null. Écrit une fois : ce `?.` oublié rendait « Invalid Date ». */
function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

/** Le nom de fichier d'une URL, quand un fond n'a jamais été nommé. */
function nomDeFichier(url: string): string {
  const sansParams = url.split("?")[0] ?? url;
  return sansParams.split("/").pop() || url;
}

/**
 * Poids lisible pour la borne d'une tranche de livraison.
 *
 * `formaterPoids` est celui de toute la boutique : une seconde écriture des
 * grammes aurait fini par afficher « 1.5 kg » ici et « 1,5 kg » ailleurs.
 */
function poids(g: number | null): string {
  return g === null ? "sans limite" : formaterPoids(g);
}

export function mountArchives(app: Hono): void {
  /**
   * Tout ce qui est archivé, par nature, le plus récemment rangé en tête.
   *
   * Une requête par nature plutôt qu'une grande union : les tables n'ont ni
   * les mêmes colonnes ni les mêmes jointures, et une union les aurait toutes
   * réduites au plus petit dénominateur — un identifiant et un nom —, ce qui
   * retire justement ce qui permet de reconnaître une pièce parmi trente
   * « Cheveux ».
   */
  app.get("/admin/archives", async (c) => {
    const groupes: GroupeArchives[] = [];

    /* --- Boutique en ligne ------------------------------------------------ */

    const pages = await db
      .select({
        id: schema.pages.id,
        title: schema.pages.title,
        slug: schema.pages.slug,
        archivedAt: schema.pages.archivedAt,
      })
      .from(schema.pages)
      .where(isNotNull(schema.pages.archivedAt))
      .orderBy(desc(schema.pages.archivedAt));
    groupes.push({
      cle: "pages",
      titre: "Pages du site",
      ecran: "/pages",
      ecranNom: "Pages du site",
      dateSource: "archivage",
      elements: pages.map((p) => ({
        id: p.id,
        libelle: p.title,
        detail: `/${p.slug}`,
        date: iso(p.archivedAt),
      })),
    });

    /* --- Catalogue -------------------------------------------------------- */

    const produits = await db
      .select({
        id: schema.products.id,
        name: schema.products.name,
        slug: schema.products.slug,
        updatedAt: schema.products.updatedAt,
      })
      .from(schema.products)
      .where(eq(schema.products.status, "archived"))
      .orderBy(desc(schema.products.updatedAt));
    groupes.push({
      cle: "produits",
      titre: "Produits",
      ecran: "/produits?statut=archived",
      ecranNom: "Produits",
      // Un statut, pas une date : voir l'en-tête du fichier.
      dateSource: "modification",
      elements: produits.map((p) => ({
        id: p.id,
        libelle: p.name,
        detail: `/${p.slug}`,
        date: iso(p.updatedAt),
      })),
    });

    const collections = await db
      .select({
        id: schema.collections.id,
        name: schema.collections.name,
        slug: schema.collections.slug,
        archivedAt: schema.collections.archivedAt,
        dedans: raw<number>`(
          select count(*) from ${schema.productCollections}
          where ${schema.productCollections.collectionId} = ${schema.collections.id}
        )`,
      })
      .from(schema.collections)
      .where(isNotNull(schema.collections.archivedAt))
      .orderBy(desc(schema.collections.archivedAt));
    groupes.push({
      cle: "collections",
      titre: "Collections",
      ecran: "/collections",
      ecranNom: "Collections",
      dateSource: "archivage",
      elements: collections.map((col) => {
        const n = Number(col.dedans ?? 0);
        return {
          id: col.id,
          libelle: col.name,
          detail:
            n > 0
              ? `${n} affiche${n > 1 ? "s" : ""} rangée${n > 1 ? "s" : ""} dedans`
              : "vide",
          date: iso(col.archivedAt),
        };
      }),
    });

    const categoriesProduits = await db
      .select({
        id: schema.productCategories.id,
        name: schema.productCategories.name,
        slug: schema.productCategories.slug,
        archivedAt: schema.productCategories.archivedAt,
      })
      .from(schema.productCategories)
      .where(isNotNull(schema.productCategories.archivedAt))
      .orderBy(desc(schema.productCategories.archivedAt));
    groupes.push({
      cle: "categories-produits",
      titre: "Catégories de produits",
      ecran: "/categories-produits",
      ecranNom: "Catégories de produits",
      dateSource: "archivage",
      elements: categoriesProduits.map((cat) => ({
        id: cat.id,
        libelle: cat.name,
        detail: cat.slug,
        date: iso(cat.archivedAt),
      })),
    });

    const cadres = await db
      .select({
        id: schema.frames.id,
        name: schema.frames.name,
        slug: schema.frames.slug,
        archivedAt: schema.frames.archivedAt,
      })
      .from(schema.frames)
      .where(isNotNull(schema.frames.archivedAt))
      .orderBy(desc(schema.frames.archivedAt));
    groupes.push({
      cle: "cadres",
      titre: "Cadres",
      ecran: "/cadres",
      ecranNom: "Cadres",
      dateSource: "archivage",
      elements: cadres.map((f) => ({
        id: f.id,
        libelle: f.name,
        detail: f.slug,
        date: iso(f.archivedAt),
      })),
    });

    /* --- Atelier ---------------------------------------------------------- */

    const personnages = await db
      .select({
        id: schema.characterTypes.id,
        name: schema.characterTypes.name,
        slug: schema.characterTypes.slug,
        archivedAt: schema.characterTypes.archivedAt,
      })
      .from(schema.characterTypes)
      .where(isNotNull(schema.characterTypes.archivedAt))
      .orderBy(desc(schema.characterTypes.archivedAt));
    groupes.push({
      cle: "personnages",
      titre: "Personnages",
      ecran: "/personnages",
      ecranNom: "Personnages",
      dateSource: "archivage",
      elements: personnages.map((t) => ({
        id: t.id,
        libelle: t.name,
        detail: t.slug,
        date: iso(t.archivedAt),
      })),
    });

    // Le personnage est joint plutôt que compté : trente pièces s'appellent
    // « Cheveux », et seul « Cheveux — Lapin » se reconnaît dans une liste.
    const pieces = await db
      .select({
        id: schema.assets.id,
        name: schema.assets.name,
        slot: schema.assets.slot,
        personnage: schema.characterTypes.name,
        archivedAt: schema.assets.archivedAt,
      })
      .from(schema.assets)
      .leftJoin(
        schema.characterTypes,
        eq(schema.assets.characterTypeId, schema.characterTypes.id),
      )
      .where(isNotNull(schema.assets.archivedAt))
      .orderBy(desc(schema.assets.archivedAt));
    groupes.push({
      cle: "pieces",
      titre: "Pièces de personnage",
      ecran: "/personnages",
      ecranNom: "Personnages",
      dateSource: "archivage",
      elements: pieces.map((a) => ({
        id: a.id,
        libelle: a.name || a.slot,
        detail: [a.personnage, a.slot].filter(Boolean).join(" · ") || null,
        date: iso(a.archivedAt),
      })),
    });

    const categoriesPersonnages = await db
      .select({
        id: schema.characterCategories.id,
        name: schema.characterCategories.name,
        slug: schema.characterCategories.slug,
        archivedAt: schema.characterCategories.archivedAt,
      })
      .from(schema.characterCategories)
      .where(isNotNull(schema.characterCategories.archivedAt))
      .orderBy(desc(schema.characterCategories.archivedAt));
    groupes.push({
      cle: "categories-personnages",
      titre: "Catégories de personnages",
      ecran: "/personnages",
      ecranNom: "Personnages",
      dateSource: "archivage",
      elements: categoriesPersonnages.map((cat) => ({
        id: cat.id,
        libelle: cat.name,
        detail: cat.slug,
        date: iso(cat.archivedAt),
      })),
    });

    const categoriesPieces = await db
      .select({
        id: schema.pieceCategories.id,
        name: schema.pieceCategories.name,
        slug: schema.pieceCategories.slug,
        archivedAt: schema.pieceCategories.archivedAt,
      })
      .from(schema.pieceCategories)
      .where(isNotNull(schema.pieceCategories.archivedAt))
      .orderBy(desc(schema.pieceCategories.archivedAt));
    groupes.push({
      cle: "categories-pieces",
      titre: "Catégories de pièces",
      ecran: "/categories-pieces",
      ecranNom: "Catégories de pièces",
      dateSource: "archivage",
      elements: categoriesPieces.map((cat) => ({
        id: cat.id,
        libelle: cat.name,
        detail: cat.slug,
        date: iso(cat.archivedAt),
      })),
    });

    const typesAffiche = await db
      .select({
        id: schema.posterViews.id,
        name: schema.posterViews.name,
        slug: schema.posterViews.slug,
        archivedAt: schema.posterViews.archivedAt,
      })
      .from(schema.posterViews)
      .where(isNotNull(schema.posterViews.archivedAt))
      .orderBy(desc(schema.posterViews.archivedAt));
    groupes.push({
      cle: "types-affiche",
      titre: "Types d'affiche",
      ecran: "/types-affiche",
      ecranNom: "Types d'affiche",
      dateSource: "archivage",
      elements: typesAffiche.map((v) => ({
        id: v.id,
        libelle: v.name,
        detail: v.slug,
        date: iso(v.archivedAt),
      })),
    });

    // Le produit est joint : un fond s'appelle « Fond 3 » ou rien du tout, et
    // c'est l'affiche qui le porte qui dit de quoi on parle.
    const fonds = await db
      .select({
        id: schema.backgrounds.id,
        name: schema.backgrounds.name,
        url: schema.backgrounds.url,
        produit: schema.products.name,
        archivedAt: schema.backgrounds.archivedAt,
      })
      .from(schema.backgrounds)
      .leftJoin(
        schema.products,
        eq(schema.backgrounds.productId, schema.products.id),
      )
      .where(isNotNull(schema.backgrounds.archivedAt))
      .orderBy(desc(schema.backgrounds.archivedAt));
    groupes.push({
      cle: "fonds",
      titre: "Fonds d'affiche",
      ecran: "/produits",
      ecranNom: "Produits",
      dateSource: "archivage",
      elements: fonds.map((b) => ({
        id: b.id,
        libelle: b.name || nomDeFichier(b.url),
        detail: b.produit,
        date: iso(b.archivedAt),
      })),
    });

    const stylesIa = await db
      .select({
        id: schema.aiPrompts.id,
        title: schema.aiPrompts.title,
        archivedAt: schema.aiPrompts.archivedAt,
      })
      .from(schema.aiPrompts)
      .where(isNotNull(schema.aiPrompts.archivedAt))
      .orderBy(desc(schema.aiPrompts.archivedAt));
    groupes.push({
      cle: "styles-ia",
      titre: "Styles d'affiche IA",
      ecran: "/ia/styles",
      ecranNom: "Styles proposés",
      dateSource: "archivage",
      elements: stylesIa.map((p) => ({
        id: p.id,
        libelle: p.title,
        detail: null,
        date: iso(p.archivedAt),
      })),
    });

    /* --- Exploitation ----------------------------------------------------- */

    const stands = await db
      .select({
        id: schema.stands.id,
        nom: schema.stands.nom,
        code: schema.stands.code,
        archivedAt: schema.stands.archivedAt,
      })
      .from(schema.stands)
      .where(isNotNull(schema.stands.archivedAt))
      .orderBy(desc(schema.stands.archivedAt));
    groupes.push({
      cle: "stands",
      titre: "Stands",
      ecran: "/ventes-salon",
      ecranNom: "Ventes stand",
      dateSource: "archivage",
      elements: stands.map((s) => ({
        id: s.id,
        libelle: s.nom,
        detail: s.code,
        date: iso(s.archivedAt),
      })),
    });

    const modesLivraison = await db
      .select({
        id: schema.shippingMethods.id,
        name: schema.shippingMethods.name,
        slug: schema.shippingMethods.slug,
        archivedAt: schema.shippingMethods.archivedAt,
      })
      .from(schema.shippingMethods)
      .where(isNotNull(schema.shippingMethods.archivedAt))
      .orderBy(desc(schema.shippingMethods.archivedAt));
    groupes.push({
      cle: "modes-livraison",
      titre: "Modes de livraison",
      ecran: "/livraison",
      ecranNom: "Livraison",
      dateSource: "archivage",
      elements: modesLivraison.map((m) => ({
        id: m.id,
        libelle: m.name,
        detail: m.slug,
        date: iso(m.archivedAt),
      })),
    });

    // Une tranche n'a pas de nom : elle se reconnaît au mode, à la zone et au
    // poids qu'elle couvre. Les trois sont donc dans le libellé.
    const tarifsLivraison = await db
      .select({
        id: schema.shippingRates.id,
        mode: schema.shippingMethods.name,
        zone: schema.shippingZones.name,
        min: schema.shippingRates.minWeightGrams,
        max: schema.shippingRates.maxWeightGrams,
        prixCents: schema.shippingRates.priceCents,
        archivedAt: schema.shippingRates.archivedAt,
      })
      .from(schema.shippingRates)
      .leftJoin(
        schema.shippingMethods,
        eq(schema.shippingRates.methodId, schema.shippingMethods.id),
      )
      .leftJoin(
        schema.shippingZones,
        eq(schema.shippingRates.zoneId, schema.shippingZones.id),
      )
      .where(isNotNull(schema.shippingRates.archivedAt))
      .orderBy(desc(schema.shippingRates.archivedAt));
    groupes.push({
      cle: "tarifs-livraison",
      titre: "Tranches de la grille de livraison",
      ecran: "/livraison",
      ecranNom: "Livraison",
      dateSource: "archivage",
      elements: tarifsLivraison.map((t) => ({
        id: t.id,
        libelle: `${t.mode ?? "Mode inconnu"} — ${t.zone ?? "zone inconnue"}`,
        detail: `de ${poids(t.min)} à ${poids(t.max)} · ${(t.prixCents / 100)
          .toFixed(2)
          .replace(".", ",")} €`,
        date: iso(t.archivedAt),
      })),
    });

    const lettres = await db
      .select({
        id: schema.lettres.id,
        titre: schema.lettres.titre,
        etat: schema.lettres.etat,
        archivedAt: schema.lettres.archivedAt,
      })
      .from(schema.lettres)
      .where(isNotNull(schema.lettres.archivedAt))
      .orderBy(desc(schema.lettres.archivedAt));
    groupes.push({
      cle: "lettres",
      titre: "Lettres d'information",
      ecran: "/lettre",
      ecranNom: "Lettre d'information",
      dateSource: "archivage",
      elements: lettres.map((l) => ({
        id: l.id,
        libelle: l.titre,
        detail: l.etat,
        date: iso(l.archivedAt),
      })),
    });

    const comptes = await db
      .select({
        id: schema.adminUsers.id,
        email: schema.adminUsers.email,
        role: schema.adminUsers.role,
        archivedAt: schema.adminUsers.archivedAt,
      })
      .from(schema.adminUsers)
      .where(isNotNull(schema.adminUsers.archivedAt))
      .orderBy(desc(schema.adminUsers.archivedAt));
    groupes.push({
      cle: "comptes",
      titre: "Comptes du back-office",
      ecran: "/comptes",
      ecranNom: "Comptes",
      dateSource: "archivage",
      elements: comptes.map((u) => ({
        id: u.id,
        libelle: u.email,
        detail: u.role === "owner" ? "propriétaire" : "vendeur",
        date: iso(u.archivedAt),
      })),
    });

    /* --- Ce qui se restaure ailleurs, et qu'on compte seulement ---------- */

    // Le détail des commandes archivées n'est PAS repris ici : elles se
    // comptent par milliers et ont leur onglet « Archivées ». Seul leur
    // nombre est renvoyé, pour que l'écran puisse y renvoyer sans mentir.
    const [commandes] = await db
      .select({ n: raw<number>`count(*)` })
      .from(schema.orders)
      .where(
        and(
          isNotNull(schema.orders.archivedAt),
          raw`${schema.orders.status} <> 'draft'`,
        ),
      );

    // Les liens retirés du menu s'archivent eux aussi, mais ne se restaurent
    // pas ligne à ligne : remettre un sous-lien ramène son entrée principale,
    // et remettre une entrée ramène les sous-liens partis avec elle (route
    // /admin/menu/:id/restaurer). Un bouton « Restaurer » isolé ici aurait donc
    // fait revenir plus que la ligne cliquée, sans le dire. On les COMPTE, et
    // l'écran renvoie vers le menu — se taire aurait été pire : l'écran promet
    // de montrer tout ce qui est archivé.
    const [menu] = await db
      .select({ n: raw<number>`count(*)` })
      .from(schema.menuItems)
      .where(isNotNull(schema.menuItems.archivedAt));

    const total = groupes.reduce((n, g) => n + g.elements.length, 0);
    return c.json({
      groupes,
      total,
      commandesArchivees: Number(commandes?.n ?? 0),
      liensMenuArchives: Number(menu?.n ?? 0),
    });
  });
}
