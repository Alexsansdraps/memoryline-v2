/**
 * Le corpus de la recherche : tout ce que la boutique ÉCRIT (catalogue,
 * textes du site, réglages), chargé en mémoire et déjà aplati.
 *
 * Pourquoi en mémoire plutôt qu'une requête par frappe : ces textes tiennent
 * en moins d'un mégaoctet — un millier d'objets —, et les comparer en
 * JavaScript prend quelques millisecondes. Les chercher en base à chaque
 * lettre demanderait une vingtaine de requêtes, des index de texte, et une
 * extension (pg_trgm, unaccent) qu'il faudrait installer par migration. Ce
 * qui grandit sans fin — commandes, clientes — reste, lui, cherché en base
 * (recherche-direct.ts).
 *
 * Le corpus se recharge :
 *   - après toute écriture réussie du back-office (le middleware posé dans
 *     index.ts appelle `invaliderCorpusRecherche`) : un nom corrigé se
 *     retrouve à la recherche suivante ;
 *   - au bout de cinq minutes, pour ce qui s'écrit sans passer par l'API (les
 *     scripts d'import).
 *
 * Ce qui n'est JAMAIS lu, même ici : le code d'accès des stands, les réglages
 * « salon.* », les empreintes de mot de passe. La table des réglages n'est
 * lue que par des clés énumérées une à une.
 */
import { asc, count, desc, inArray } from "drizzle-orm";
import {
  etatBandeau,
  lireBandeauxVisuels,
  REGLAGE_BANDEAUX_VISUELS,
  type EtatBandeau,
} from "@memoryline/types/bandeaux-visuels";
import { motsDe } from "@memoryline/types/recherche";
import { db, schema } from "./db/client.js";
import { ordreDesCollections } from "./collections.js";
import {
  CLES_COURRIELS_RELANCE,
  CLES_TEXTES_DU_SITE,
  ficheBandeauAnnonce,
  ficheConsigneIa,
  fichesAffiches,
  fichesBandeauxVisuels,
  fichesCadres,
  fichesCategoriesPersonnages,
  fichesCategoriesPieces,
  fichesCategoriesProduits,
  fichesCollections,
  fichesComptes,
  fichesCourrielsRelance,
  fichesDecors,
  fichesLettres,
  fichesMenu,
  fichesModesLivraison,
  fichesPages,
  fichesPersonnages,
  fichesPieces,
  fichesPromotions,
  fichesStands,
  fichesStylesIa,
  fichesTextesDuSite,
  fichesTypesAffiche,
  fichesZonesLivraison,
  type Fiche,
  type LigneReglage,
} from "./recherche-extraction.js";

/* -------------------------------------------------------------------------- */
/*  Une source qui tombe ne fait pas tomber les autres                        */
/* -------------------------------------------------------------------------- */

/**
 * Une source qui échoue ne fait pas tomber les autres.
 *
 * La recherche interroge TOUTES les parties du back-office à la fois : elle a
 * donc autant d'occasions de rencontrer une table en retard de migration ou
 * une donnée abîmée. Sans ce filet, la moindre de ces pannes rendrait la barre
 * de recherche entièrement muette, alors que les autres sources répondaient
 * très bien. La réponse le dit (« partiel »), le panneau le montre.
 *
 * Le journal ne reçoit que le nom de la source, le type et le code de
 * l'erreur — PAS l'erreur entière : celle du pilote PostgreSQL embarque la
 * requête et ses paramètres, donc ce qui a été tapé, c'est-à-dire souvent le
 * nom d'une cliente.
 */
export async function sansTomber<T>(
  source: string,
  travail: () => Promise<T>,
  repli: T,
  echecs?: string[],
): Promise<T> {
  try {
    return await travail();
  } catch (erreur) {
    const e = erreur as { name?: unknown; code?: unknown } | null;
    const nom = typeof e?.name === "string" ? e.name : "Erreur";
    const code = typeof e?.code === "string" || typeof e?.code === "number" ? String(e.code) : "";
    console.error(`[recherche] ${source} : ${nom} ${code}`.trimEnd());
    echecs?.push(source);
    return repli;
  }
}

/* -------------------------------------------------------------------------- */
/*  Le cache                                                                  */
/* -------------------------------------------------------------------------- */

export interface Corpus {
  fiches: Fiche[];
  /** Les mots connus du corpus : ce qui permet de corriger une faute de frappe. */
  vocabulaire: Set<string>;
  /** Faux si une source a échoué : le corpus sert, mais n'est pas gardé. */
  complet: boolean;
  /** Les sources qui ont échoué, pour le drapeau « partiel ». */
  echecs: string[];
  chargeLe: number;
}

/** Cinq minutes : le temps qu'un import par script se voie sans rien faire. */
const DUREE_DE_VIE = 5 * 60 * 1000;

let enCache: Corpus | null = null;
let chargement: { promesse: Promise<Corpus>; generation: number } | null = null;
/**
 * Change à chaque invalidation. Un chargement commencé AVANT une écriture
 * rend encore ses données à ceux qui l'attendaient, mais ne les met pas en
 * cache : elles sont peut-être déjà périmées.
 */
let generation = 0;

/** Oublie le corpus : la prochaine recherche le relira. */
export function invaliderCorpusRecherche(): void {
  enCache = null;
  generation++;
}

/**
 * Le corpus, en cache s'il est frais. Les recherches qui arrivent pendant un
 * chargement attendent CE chargement au lieu d'en lancer un autre : taper
 * vite après une modification ne doit pas déclencher dix lectures complètes.
 */
export function corpusRecherche(): Promise<Corpus> {
  if (enCache && Date.now() - enCache.chargeLe < DUREE_DE_VIE) return Promise.resolve(enCache);
  if (chargement && chargement.generation === generation) return chargement.promesse;
  const sienne = generation;
  const promesse = charger()
    .then((corpus) => {
      if (corpus.complet && sienne === generation) enCache = corpus;
      return corpus;
    })
    .finally(() => {
      if (chargement?.promesse === promesse) chargement = null;
    });
  chargement = { promesse, generation: sienne };
  return promesse;
}

/* -------------------------------------------------------------------------- */
/*  Le chargement                                                             */
/* -------------------------------------------------------------------------- */

/** Les clés de réglages lues, et AUCUNE autre. */
const CLES_REGLAGES: string[] = [
  ...CLES_TEXTES_DU_SITE,
  ...CLES_COURRIELS_RELANCE,
  REGLAGE_BANDEAUX_VISUELS,
  "ia.stylePrompt",
];

/** L'état d'un bandeau visuel, dans les mots de son écran. */
const ETATS_BANDEAU: Record<EtatBandeau, string> = {
  "en-ligne": "En ligne",
  programme: "Programmé",
  termine: "Terminé",
  eteint: "Éteint",
  "sans-image": "Sans image",
  "sans-page": "Aucune page",
  archive: "Archivé",
};

async function chargerAffiches(): Promise<Fiche[]> {
  const p = schema.products;
  const [produits, images, variantes] = await Promise.all([
    db
      .select({
        id: p.id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        seoTitle: p.seoTitle,
        seoDescription: p.seoDescription,
        defaultTitle: p.defaultTitle,
        defaultSubtitle: p.defaultSubtitle,
        defaultLine3: p.defaultLine3,
        vendor: p.vendor,
        productType: p.productType,
        tags: p.tags,
        aiStylePrompt: p.aiStylePrompt,
        status: p.status,
        basePriceCents: p.basePriceCents,
        translations: p.translations,
      })
      .from(p),
    db
      .select({
        productId: schema.productImages.productId,
        url: schema.productImages.url,
        alt: schema.productImages.alt,
      })
      .from(schema.productImages)
      .orderBy(asc(schema.productImages.position), asc(schema.productImages.id)),
    db
      .select({
        productId: schema.variants.productId,
        priceCents: schema.variants.priceCents,
        sku: schema.variants.sku,
        barcode: schema.variants.barcode,
      })
      .from(schema.variants)
      .orderBy(asc(schema.variants.id)),
  ]);
  return fichesAffiches(produits, images, variantes);
}

async function chargerCollections(): Promise<Fiche[]> {
  const c = schema.collections;
  const [lignes, comptes] = await Promise.all([
    db
      .select({
        id: c.id,
        name: c.name,
        slug: c.slug,
        description: c.description,
        translations: c.translations,
        active: c.active,
        archivedAt: c.archivedAt,
      })
      .from(c)
      .orderBy(...ordreDesCollections()),
    db
      .select({ collection: schema.productCollections.collectionId, n: count() })
      .from(schema.productCollections)
      .groupBy(schema.productCollections.collectionId),
  ]);
  const parCollection = new Map(comptes.map((r) => [r.collection, Number(r.n)]));
  return fichesCollections(lignes.map((l) => ({ ...l, affiches: parCollection.get(l.id) ?? 0 })));
}

async function chargerAtelier(): Promise<Fiche[]> {
  const [cadres, types, decors, produits, personnages, categories, pieces, categoriesPieces, categoriesProduits] =
    await Promise.all([
      db
        .select({
          id: schema.frames.id,
          name: schema.frames.name,
          translations: schema.frames.translations,
          active: schema.frames.active,
          archivedAt: schema.frames.archivedAt,
        })
        .from(schema.frames)
        .orderBy(asc(schema.frames.position), asc(schema.frames.id)),
      db
        .select({
          id: schema.posterViews.id,
          name: schema.posterViews.name,
          archivedAt: schema.posterViews.archivedAt,
        })
        .from(schema.posterViews)
        .orderBy(asc(schema.posterViews.position), asc(schema.posterViews.id)),
      db
        .select({
          id: schema.backgrounds.id,
          name: schema.backgrounds.name,
          productId: schema.backgrounds.productId,
          archivedAt: schema.backgrounds.archivedAt,
        })
        .from(schema.backgrounds)
        .orderBy(asc(schema.backgrounds.name), asc(schema.backgrounds.id)),
      db.select({ id: schema.products.id, name: schema.products.name }).from(schema.products),
      db
        .select({
          id: schema.characterTypes.id,
          name: schema.characterTypes.name,
          translations: schema.characterTypes.translations,
          categoryId: schema.characterTypes.categoryId,
          archivedAt: schema.characterTypes.archivedAt,
        })
        .from(schema.characterTypes)
        .orderBy(asc(schema.characterTypes.position), asc(schema.characterTypes.id)),
      db
        .select({
          id: schema.characterCategories.id,
          name: schema.characterCategories.name,
          translations: schema.characterCategories.translations,
          archivedAt: schema.characterCategories.archivedAt,
        })
        .from(schema.characterCategories)
        .orderBy(asc(schema.characterCategories.position), asc(schema.characterCategories.id)),
      db
        .select({
          id: schema.assets.id,
          name: schema.assets.name,
          slot: schema.assets.slot,
          pieceCategoryId: schema.assets.pieceCategoryId,
          archivedAt: schema.assets.archivedAt,
        })
        .from(schema.assets)
        .orderBy(asc(schema.assets.slot), asc(schema.assets.position), asc(schema.assets.id)),
      db
        .select({
          id: schema.pieceCategories.id,
          name: schema.pieceCategories.name,
          archivedAt: schema.pieceCategories.archivedAt,
        })
        .from(schema.pieceCategories)
        .orderBy(asc(schema.pieceCategories.position), asc(schema.pieceCategories.id)),
      db
        .select({
          id: schema.productCategories.id,
          name: schema.productCategories.name,
          description: schema.productCategories.description,
          archivedAt: schema.productCategories.archivedAt,
        })
        .from(schema.productCategories)
        .orderBy(asc(schema.productCategories.position), asc(schema.productCategories.id)),
    ]);
  const nomProduit = new Map(produits.map((p) => [p.id, p.name]));
  const nomCategorie = new Map(categories.map((c) => [c.id, c.name]));
  const nomCategoriePiece = new Map(categoriesPieces.map((c) => [c.id, c.name]));
  return [
    ...fichesCadres(cadres),
    ...fichesTypesAffiche(types),
    ...fichesDecors(
      decors.map((d) => ({
        ...d,
        productName: d.productId !== null ? (nomProduit.get(d.productId) ?? null) : null,
      })),
    ),
    ...fichesPersonnages(
      personnages.map((p) => ({
        ...p,
        categoryName: p.categoryId !== null ? (nomCategorie.get(p.categoryId) ?? null) : null,
      })),
    ),
    ...fichesCategoriesPersonnages(categories),
    ...fichesPieces(
      pieces.map((p) => ({
        ...p,
        categoryName:
          p.pieceCategoryId !== null ? (nomCategoriePiece.get(p.pieceCategoryId) ?? null) : null,
      })),
    ),
    ...fichesCategoriesPieces(categoriesPieces),
    ...fichesCategoriesProduits(categoriesProduits),
  ];
}

/**
 * Les stands, par leur nom. La colonne `code` n'est PAS dans la projection :
 * elle ne peut ni partir dans une réponse par distraction, ni servir
 * d'oracle (« ce code existe-t-il ? ») à qui la taperait dans la recherche.
 */
async function chargerStands(): Promise<Fiche[]> {
  const stands = await db
    .select({
      id: schema.stands.id,
      nom: schema.stands.nom,
      ouvert: schema.stands.ouvert,
      archivedAt: schema.stands.archivedAt,
    })
    .from(schema.stands);
  return fichesStands(stands);
}

async function chargerBoutique(): Promise<Fiche[]> {
  const [bandeaux, promos, pages, menu, lettres] = await Promise.all([
    // La même bannière que l'écran « Bandeau et offre » modifie
    // (GET /admin/banner) : les autres lignes, aucun écran ne les montre.
    db
      .select({
        id: schema.announcementBanners.id,
        message: schema.announcementBanners.message,
        linkLabel: schema.announcementBanners.linkLabel,
        translations: schema.announcementBanners.translations,
        active: schema.announcementBanners.active,
      })
      .from(schema.announcementBanners)
      .orderBy(desc(schema.announcementBanners.priority), desc(schema.announcementBanners.id))
      .limit(1),
    db
      .select({
        id: schema.promoRules.id,
        name: schema.promoRules.name,
        code: schema.promoRules.code,
        translations: schema.promoRules.translations,
        active: schema.promoRules.active,
      })
      .from(schema.promoRules)
      .orderBy(desc(schema.promoRules.priority), asc(schema.promoRules.id)),
    db
      .select({
        id: schema.pages.id,
        title: schema.pages.title,
        slug: schema.pages.slug,
        status: schema.pages.status,
        seoTitle: schema.pages.seoTitle,
        seoDescription: schema.pages.seoDescription,
        blocks: schema.pages.blocks,
        translations: schema.pages.translations,
        archivedAt: schema.pages.archivedAt,
      })
      .from(schema.pages)
      .orderBy(asc(schema.pages.position), asc(schema.pages.title)),
    db
      .select({
        id: schema.menuItems.id,
        parentId: schema.menuItems.parentId,
        label: schema.menuItems.label,
        position: schema.menuItems.position,
        visible: schema.menuItems.visible,
        archivedAt: schema.menuItems.archivedAt,
        translations: schema.menuItems.translations,
      })
      .from(schema.menuItems),
    db
      .select({
        id: schema.lettres.id,
        titre: schema.lettres.titre,
        objet: schema.lettres.objet,
        contenuHtml: schema.lettres.contenuHtml,
        etat: schema.lettres.etat,
        envoyeeLe: schema.lettres.envoyeeLe,
        archivedAt: schema.lettres.archivedAt,
      })
      .from(schema.lettres)
      .orderBy(desc(schema.lettres.createdAt), desc(schema.lettres.id)),
  ]);
  return [
    ...ficheBandeauAnnonce(bandeaux[0] ?? null),
    ...fichesPromotions(promos),
    ...fichesPages(pages),
    ...fichesMenu(menu),
    ...fichesLettres(lettres),
  ];
}

/**
 * Les réglages, par leurs clés ÉNUMÉRÉES (inArray), jamais par motif ni par
 * `value::text` : la table range aussi le code d'accès du stand.
 */
async function chargerReglages(): Promise<Fiche[]> {
  const lignes: LigneReglage[] = await db
    .select({ key: schema.settings.key, value: schema.settings.value })
    .from(schema.settings)
    .where(inArray(schema.settings.key, CLES_REGLAGES));
  const valeur = (cle: string) => lignes.find((l) => l.key === cle)?.value;
  const maintenant = new Date();
  const bandeaux = lireBandeauxVisuels(valeur(REGLAGE_BANDEAUX_VISUELS)) ?? [];
  return [
    ...fichesBandeauxVisuels(
      bandeaux.map((b) => ({
        id: b.id,
        nom: b.nom,
        titre: b.titre,
        texte: b.texte,
        bouton: b.bouton,
        alt: b.alt,
        translations: b.translations,
        etat: ETATS_BANDEAU[etatBandeau(b, maintenant)] ?? null,
      })),
    ),
    ...fichesTextesDuSite(lignes),
    ...fichesCourrielsRelance(lignes),
    ...ficheConsigneIa(valeur("ia.stylePrompt")),
  ];
}

async function chargerReglagesBoutique(): Promise<Fiche[]> {
  const [modes, zones, styles, comptes] = await Promise.all([
    db
      .select({
        id: schema.shippingMethods.id,
        name: schema.shippingMethods.name,
        description: schema.shippingMethods.description,
        notePreparation: schema.shippingMethods.notePreparation,
        pickupLocation: schema.shippingMethods.pickupLocation,
        carrier: schema.shippingMethods.carrier,
        kind: schema.shippingMethods.kind,
        active: schema.shippingMethods.active,
        archivedAt: schema.shippingMethods.archivedAt,
        translations: schema.shippingMethods.translations,
      })
      .from(schema.shippingMethods)
      .orderBy(asc(schema.shippingMethods.position), asc(schema.shippingMethods.id)),
    db
      .select({ id: schema.shippingZones.id, name: schema.shippingZones.name })
      .from(schema.shippingZones)
      .orderBy(asc(schema.shippingZones.position), asc(schema.shippingZones.id)),
    db
      .select({
        id: schema.aiPrompts.id,
        title: schema.aiPrompts.title,
        prompt: schema.aiPrompts.prompt,
        translations: schema.aiPrompts.translations,
        active: schema.aiPrompts.active,
        archivedAt: schema.aiPrompts.archivedAt,
      })
      .from(schema.aiPrompts)
      .orderBy(asc(schema.aiPrompts.position), asc(schema.aiPrompts.id)),
    // L'adresse et le rôle, rien d'autre : l'empreinte du mot de passe n'est
    // pas dans la projection.
    db
      .select({
        id: schema.adminUsers.id,
        email: schema.adminUsers.email,
        role: schema.adminUsers.role,
        archivedAt: schema.adminUsers.archivedAt,
      })
      .from(schema.adminUsers)
      .orderBy(asc(schema.adminUsers.email)),
  ]);
  return [
    ...fichesModesLivraison(modes),
    ...fichesZonesLivraison(zones),
    ...fichesStylesIa(styles),
    ...fichesComptes(comptes),
  ];
}

const SOURCES: [string, () => Promise<Fiche[]>][] = [
  ["affiches", chargerAffiches],
  ["collections", chargerCollections],
  ["atelier", chargerAtelier],
  ["stands", chargerStands],
  ["boutique", chargerBoutique],
  ["réglages du site", chargerReglages],
  ["réglages de la boutique", chargerReglagesBoutique],
];

async function charger(): Promise<Corpus> {
  const echecs: string[] = [];
  const parSource = await Promise.all(
    SOURCES.map(([nom, lire]) => sansTomber(nom, lire, [] as Fiche[], echecs)),
  );
  const fiches = parSource.flat();
  const vocabulaire = new Set<string>();
  for (const f of fiches) {
    for (const m of motsDe(f.titre)) vocabulaire.add(m);
    for (const c of f.champs) for (const m of motsDe(c.texte)) vocabulaire.add(m);
  }
  return { fiches, vocabulaire, complet: echecs.length === 0, echecs, chargeLe: Date.now() };
}
