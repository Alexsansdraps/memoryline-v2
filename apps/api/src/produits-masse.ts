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
 * trompe en masse. D'abord, aucun produit ne s'efface : retirer une affiche,
 * c'est l'ARCHIVER — elle quitte le site et garde tout, ses photos, ses fonds
 * de configurateur, son rangement, et le lien des commandes qui la citent.
 * Ensuite, une ligne fautive ne fait pas tomber les autres : elle ressort
 * seule, nommée et expliquée, pendant que le reste du lot est bien enregistré.
 */
import type { Hono } from "hono";
import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNull,
  or,
  sql as raw,
} from "drizzle-orm";
import { poidsArticle } from "@memoryline/types";
import {
  derniersRangs,
  ordreDesCollections,
  poidsDesCollections,
  rangerEnFinDeCollection,
} from "./collections.js";
import { db, schema } from "./db/client.js";
import { cheminAffiche, poserRedirection } from "./redirections.js";

/** Les seuls états qu'un produit peut prendre. */
const STATUTS = ["active", "draft", "archived"] as const;
type StatutProduit = (typeof STATUTS)[number];

function statutValide(v: unknown): v is StatutProduit {
  return typeof v === "string" && (STATUTS as readonly string[]).includes(v);
}

/**
 * Un identifiant de produit, ou null quand ce n'en est pas un.
 *
 * `Number()` accepte beaucoup trop : `true` désignerait le produit 1 et
 * « 3.7 » un produit à virgule qui n'existe pas. Une sélection mal transmise
 * doit sortir du lot plutôt que viser un produit au hasard.
 */
function identifiant(v: unknown): number | null {
  if (typeof v !== "number" && typeof v !== "string") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Identifiants d'une sélection, dédoublonnés, débarrassés de ce qui n'en est pas. */
function identifiants(v: unknown): number[] {
  return [
    ...new Set(
      (Array.isArray(v) ? (v as unknown[]) : [])
        .map(identifiant)
        .filter((n): n is number => n !== null),
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
 * champ vidé (qui veut dire « reprends celui de la collection », pas « zéro
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
 * Au-delà, c'est une faute de frappe, pas un prix.
 *
 * Une affiche ne se vend pas dix mille euros, et la base garde les prix dans
 * un entier qui déborde un peu plus loin : sans borne haute, une saisie
 * fantaisiste ne donne pas un prix absurde mais un enregistrement qui casse
 * au milieu du lot, sans dire où il s'est arrêté.
 */
const PRIX_MAX_CENTS = 1_000_000;

/** La plus forte hausse ou remise qu'un pourcentage puisse demander. */
const POURCENT_MAX = 1000;

/** Un prix en euros, tel qu'on l'écrit dans un message. */
function euros(cents: number): string {
  return `${(cents / 100).toLocaleString("fr-FR")} €`;
}

/** Pourquoi un prix saisi a été refusé. */
type RefusPrix = "vide" | "illisible" | "negatif" | "trop-grand";

/**
 * Un prix saisi dans un formulaire, en centimes.
 *
 * Une case de prix vidée n'est PAS un prix de zéro euro. Sélectionner une
 * cellule et appuyer sur Suppr est le geste le plus banal d'une grille ;
 * converti en nombre, il mettrait l'affiche en vente pour rien, avec un
 * compteur qui annonce fièrement la ligne comme enregistrée. Comme pour le
 * poids, la case vide et la saisie qui n'a pas de sens se distinguent, et
 * aucune des deux ne devient un chiffre.
 */
function prixSaisi(v: unknown): number | RefusPrix {
  if (v === null || v === undefined) return "vide";
  if (typeof v === "string" && v.trim() === "") return "vide";
  if (typeof v !== "number" && typeof v !== "string") return "illisible";
  const n = Number(v);
  if (!Number.isFinite(n)) return "illisible";
  const cents = Math.round(n);
  if (cents < 0) return "negatif";
  if (cents > PRIX_MAX_CENTS) return "trop-grand";
  return cents;
}

/** Ce qu'on dit quand un prix n'est pas utilisable. `quoi` ouvre la phrase. */
function messagePrix(refus: RefusPrix, quoi: string): string {
  if (refus === "vide")
    return `${quoi} ne peut pas rester vide. Écrivez 0 si le produit est offert.`;
  if (refus === "negatif") return `${quoi} ne peut pas être négatif.`;
  if (refus === "trop-grand")
    return `${quoi} dépasse ${euros(PRIX_MAX_CENTS)}. Vérifiez la saisie : les prix s'écrivent en centimes.`;
  return `${quoi} doit être un nombre.`;
}

/**
 * Une case à cocher, qui revient tantôt en booléen, tantôt en texte.
 *
 * Null quand la valeur ne veut rien dire : sur une action de masse, mieux
 * vaut refuser que comprendre « non » et éteindre l'IA de toute la sélection.
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

/**
 * Regroupe des écritures par valeur : une requête par prix, pas une par ligne.
 *
 * Une remise de saison touche des centaines de variantes mais ne produit
 * qu'une poignée de prix différents.
 */
function parValeur(cibles: Map<number, number>): Map<number, number[]> {
  const groupes = new Map<number, number[]>();
  for (const [id, valeur] of cibles) {
    const liste = groupes.get(valeur) ?? [];
    liste.push(id);
    groupes.set(valeur, liste);
  }
  return groupes;
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
 *
 * Le pourcentage est vérifié positif par l'appelant : « diminuer de moins
 * cinquante » augmenterait les prix de moitié en annonçant une remise.
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
  description?: string | null;
  /** Le type d'affiche (« de face », « de dos »…) : un slug de poster_view. */
  defaultView?: string | null;
}

/** Les collections qu'une ligne fait gagner ou perdre à son affiche. */
interface ChangementCollections {
  ajouter: number[];
  retirer: number[];
}

type Verdict =
  | {
      ok: true;
      donnees: ChampsProduit;
      /** Nouveau prix par format, en centimes. Vide quand rien ne change. */
      prix: Map<string, number>;
      /** Null quand la ligne ne touche pas aux collections. */
      collections: ChangementCollections | null;
    }
  | { ok: false; message: string };

/** Une description ne dépasse pas ce que la fiche accepte (fiche-produit.ts). */
const DESCRIPTION_MAX = 20_000;

/** Les trois façons de toucher aux collections d'un lot, comme dans Shopify. */
const MODES_COLLECTIONS = ["ajouter", "retirer", "remplacer"] as const;

/**
 * Une adresse tirée du nom, rendue unique.
 *
 * « Refaire depuis le nom » sur cinquante affiches d'une même ville donnerait
 * cinquante fois « colmar » : la première l'aurait, les quarante-neuf autres
 * seraient refusées. On suffixe donc (-2, -3…), face au catalogue entier ET
 * aux autres lignes du lot, que `proprietaireDuSlug` suit au fil de l'envoi.
 * Rend une chaîne vide quand le nom ne donne rien d'utilisable.
 */
function slugDisponible(
  nom: string,
  produitId: number,
  proprietaireDuSlug: Map<string, number>,
): string {
  const base = slugifier(nom);
  if (!base) return "";
  let candidat = base;
  for (let i = 2; ; i++) {
    const proprietaire = proprietaireDuSlug.get(candidat);
    if (proprietaire === undefined || proprietaire === produitId) return candidat;
    const suffixe = `-${i}`;
    candidat = `${base.slice(0, 80 - suffixe.length).replace(/-+$/, "")}${suffixe}`;
  }
}

/**
 * Relit une ligne du tableau AVANT d'écrire quoi que ce soit.
 *
 * Tout est vérifié d'abord et enregistré ensuite : une ligne à moitié
 * appliquée (le prix passé, le statut refusé) laisserait un produit dans un
 * état que personne n'a demandé, et que rien à l'écran ne trahirait.
 */
function verifierLigne(
  m: Record<string, unknown>,
  produit: { id: number; slug: string; name: string; defaultView: string | null },
  connu: {
    proprietaireDuSlug: Map<string, number>;
    categories: Set<number>;
    /** Les types d'affiche qu'on peut choisir : les non archivés. */
    vues: Set<string>;
    /** Toutes les collections, archivées comprises, avec leur nom. */
    collections: Map<number, { name: string; archivee: boolean }>;
    /** Les collections où l'affiche est rangée aujourd'hui. */
    liens: Set<number>;
  },
): Verdict {
  const donnees: ChampsProduit = {};
  const prix = new Map<string, number>();
  let collections: ChangementCollections | null = null;

  if ("prix" in m && m.prix && typeof m.prix === "object") {
    // Reçu sous la forme { "A4": 2300, "A3": 3500 } : le format est la clé,
    // parce que c'est ainsi que la grille présente ses colonnes.
    for (const [format, valeur] of Object.entries(
      m.prix as Record<string, unknown>,
    )) {
      const cents = prixSaisi(valeur);
      if (typeof cents !== "number")
        return {
          ok: false,
          message: messagePrix(cents, `Le prix du format ${format}`),
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
  } else if (m.slugDepuisNom === true) {
    // « Refaire depuis le nom » : l'adresse suit le nom de la ligne — le
    // nouveau s'il change dans le même envoi —, rendue unique ici plutôt que
    // refusée (cf. slugDisponible). Une adresse tapée à la main, elle, passe
    // au-dessus : c'est le `if` juste avant.
    const nom = donnees.name ?? produit.name;
    const slug = slugDisponible(nom, produit.id, connu.proprietaireDuSlug);
    if (!slug)
      return {
        ok: false,
        message:
          "Ce nom ne donne aucune adresse utilisable. Tapez l'adresse à la main, avec des lettres et des chiffres.",
      };
    if (slug !== produit.slug) donnees.slug = slug;
  }

  if ("description" in m) {
    // Le même nettoyage que la fiche : le texte part tel quel dans la page
    // publique, et une description vidée vaut « pas de description ».
    const texte = String(m.description ?? "").trim();
    if (texte.length > DESCRIPTION_MAX)
      return {
        ok: false,
        message: `La description dépasse ${DESCRIPTION_MAX.toLocaleString("fr-FR")} caractères. Raccourcissez-la.`,
      };
    donnees.description = texte || null;
  }

  if ("defaultView" in m) {
    const vue = String(m.defaultView ?? "").trim();
    // Vide : le type par défaut de la boutique, comme une fiche jamais
    // réglée. Un type archivé ne se choisit plus, sauf celui que l'affiche a
    // DÉJÀ : la grille le renvoie tel quel, et le refuser rendrait la ligne
    // immodifiable le jour où l'on range ce type.
    if (vue && !connu.vues.has(vue) && vue !== produit.defaultView)
      return {
        ok: false,
        message: "Ce type d'affiche n'existe plus, ou il est archivé. Rechargez la page.",
      };
    donnees.defaultView = vue || null;
  }

  if ("collections" in m) {
    const brut = m.collections;
    const lues =
      brut && typeof brut === "object" && !Array.isArray(brut)
        ? (brut as Record<string, unknown>)
        : null;
    const mode = String(lues?.mode ?? "");
    if (!lues || !(MODES_COLLECTIONS as readonly string[]).includes(mode))
      return {
        ok: false,
        message:
          "Les collections n'ont pas pu être lues. Rechargez la page et reprenez la modification.",
      };
    const ids = identifiants(lues.ids);
    if (ids.some((id) => !connu.collections.has(id)))
      return {
        ok: false,
        message: "Une des collections choisies n'existe plus. Rechargez la page.",
      };
    const ajouter =
      mode === "retirer" ? [] : ids.filter((id) => !connu.liens.has(id));
    const retirer =
      mode === "ajouter"
        ? []
        : mode === "retirer"
          ? ids.filter((id) => connu.liens.has(id))
          : [...connu.liens].filter((id) => !ids.includes(id));
    // On peut toujours SORTIR d'une collection archivée — c'est du ménage.
    // Y ranger une affiche, non : le rayon étant rangé, elle n'y serait vue
    // de personne, et le seul effet serait le poids qu'il donne aux colis.
    const archivee = ajouter.find((id) => connu.collections.get(id)?.archivee);
    if (archivee !== undefined)
      return {
        ok: false,
        message: `La collection « ${connu.collections.get(archivee)?.name} » est archivée. Restaurez-la avant d'y ranger des affiches.`,
      };
    if (ajouter.length || retirer.length) collections = { ajouter, retirer };
  }

  if ("basePriceCents" in m) {
    const base = prixSaisi(m.basePriceCents);
    if (typeof base !== "number")
      return { ok: false, message: messagePrix(base, "Le prix de base") };
    donnees.basePriceCents = base;
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

  if ("aiEnabled" in m) {
    const actif = booleenSaisi(m.aiEnabled);
    if (actif === null)
      return {
        ok: false,
        message: "La colonne IA attend oui ou non.",
      };
    donnees.aiEnabled = actif;
  }

  return { ok: true, donnees, prix, collections };
}

/** Une transaction en cours, ou la base pour une écriture isolée. */
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executeur = typeof db | Transaction;

/**
 * Sort des affiches de collections : le SEUL `delete` de ce fichier.
 *
 * L'affiche reste au catalogue et la collection reste entière : seule la
 * liaison est réécrite, et l'y remettre est un clic. C'est ce que
 * scripts/verifier-archivage.mjs autorise ici, une fois. Le paramètre
 * s'appelle `tx` exprès : c'est sous ce nom (ou `db`) que le garde-fou voit
 * une suppression — rebaptisé, il la rendrait invisible.
 */
async function sortirDesCollections(
  tx: Executeur,
  produitIds: readonly number[],
  collectionIds: readonly number[],
): Promise<number> {
  if (!produitIds.length || !collectionIds.length) return 0;
  const retires = await tx
    .delete(schema.productCollections)
    .where(
      and(
        inArray(schema.productCollections.productId, [...produitIds]),
        inArray(schema.productCollections.collectionId, [...collectionIds]),
      ),
    )
    .returning({ productId: schema.productCollections.productId });
  return retires.length;
}

/** Une ligne de l'aperçu : ce qu'un champ était, ce qu'il deviendra. */
interface Changement {
  champ: string;
  avant: string;
  apres: string;
}

/** Le texte d'une description, pour un aperçu d'une ligne : sans balises, court. */
function extrait(html: string | null | undefined): string {
  const texte = String(html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!texte) return "aucune";
  return texte.length > 80 ? `${texte.slice(0, 79)}… (${texte.length} caractères)` : texte;
}

/** Le nom d'un statut, tel que la grille le montre. */
const LIBELLES_STATUT: Record<string, string> = {
  active: "Actif",
  draft: "Brouillon",
  archived: "Archivé",
};

export function mountProduitsMasse(app: Hono): void {
/* -------------------------------------------------------------------------- */
/*  L'export du catalogue                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Une cellule de fichier CSV, echappee.
 *
 * Point-virgule et BOM : c'est ce qu'Excel francais ouvre sans rien demander.
 * Meme convention que l'export des commandes, pour que les deux fichiers
 * s'ouvrent de la meme facon.
 */
function cellule(v: unknown): string {
  const t = v === null || v === undefined ? "" : String(v);
  return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** Les centimes en euros, avec la virgule francaise. */
function euros(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

/**
 * Les colonnes du fichier.
 *
 * Les quinze premieres sont celles que NOTRE importeur sait relire
 * (`import-produits.ts`) : le fichier exporte se reimporte donc tel quel,
 * c'est tout l'interet. Les suivantes ne sont la que pour etre lues — un
 * poids, un stock, une image — et l'importeur les ignore sans se plaindre.
 *
 * « Tags » porte les COLLECTIONS, et pas les etiquettes du produit : c'est la
 * convention de l'importeur, heritee de l'ancienne boutique ou les etiquettes
 * Shopify tenaient lieu de collections. Les vraies etiquettes ont leur propre
 * colonne, plus loin, qui ne revient pas a l'import.
 */
const COLONNES_EXPORT = [
  "Handle",
  "Title",
  "Body (HTML)",
  "Vendor",
  "Type",
  "Tags",
  "Published",
  "Status",
  "SEO Title",
  "SEO Description",
  "Option1 Name",
  "Option1 Value",
  "Variant SKU",
  "Variant Price",
  "Variant Compare At Price",
  "Variant Grams",
  "Variant Barcode",
  "Cost per item",
  "Variant Inventory Qty",
  "Image Src",
  "Etiquettes produit",
  "Poids de l'affiche (g)",
  "Poids de la collection (g)",
];

/**
 * Tout le catalogue dans un fichier, une ligne par format.
 *
 * La premiere ligne d'une affiche porte l'affiche entiere ; les suivantes ne
 * portent que le format, comme le fait Shopify et comme l'attend notre
 * importeur. Une affiche sans format sort quand meme : mieux vaut une ligne
 * incomplete qu'une affiche absente du fichier.
 */
app.get("/admin/products/export.csv", async (c) => {
  const q = c.req.query();

  const conditions = [];
  if (statutValide(q.statut))
    conditions.push(eq(schema.products.status, q.statut));
  const ids = identifiants((q.ids ?? "").split(",").filter(Boolean));
  if (ids.length) conditions.push(inArray(schema.products.id, ids));

  const produits = await db
    .select({
      id: schema.products.id,
      slug: schema.products.slug,
      name: schema.products.name,
      description: schema.products.description,
      vendor: schema.products.vendor,
      productType: schema.products.productType,
      tags: schema.products.tags,
      status: schema.products.status,
      seoTitle: schema.products.seoTitle,
      seoDescription: schema.products.seoDescription,
      weightGrams: schema.products.weightGrams,
    })
    .from(schema.products)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(schema.products.name));

  if (!produits.length) {
    const vide = "﻿" + COLONNES_EXPORT.join(";") + "\r\n";
    return new Response(vide, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="catalogue.csv"',
      },
    });
  }

  const idsProduits = produits.map((p) => p.id);

  // Trois lectures groupees plutot qu'une par affiche : le fichier doit sortir
  // en une fois, meme avec deux cents affiches et leurs formats.
  const [variantes, rangements, visuels] = await Promise.all([
    db
      .select()
      .from(schema.variants)
      .where(inArray(schema.variants.productId, idsProduits))
      .orderBy(asc(schema.variants.productId), asc(schema.variants.id)),
    db
      .select({
        productId: schema.productCollections.productId,
        nom: schema.collections.name,
        poids: schema.collections.defaultWeightGrams,
      })
      .from(schema.productCollections)
      .innerJoin(
        schema.collections,
        eq(schema.collections.id, schema.productCollections.collectionId),
      )
      .where(inArray(schema.productCollections.productId, idsProduits))
      // L'ordre des collections elles-mêmes : `position` dit la place de
      // l'affiche dans chaque rayon, il ne range pas les rayons entre eux.
      .orderBy(...ordreDesCollections()),
    db
      .select({
        productId: schema.productImages.productId,
        url: schema.productImages.url,
        position: schema.productImages.position,
      })
      .from(schema.productImages)
      .where(inArray(schema.productImages.productId, idsProduits))
      .orderBy(asc(schema.productImages.position)),
  ]);

  const parProduit = <T extends { productId: number }>(lignes: T[]) => {
    const m = new Map<number, T[]>();
    for (const l of lignes) {
      const liste = m.get(l.productId);
      if (liste) liste.push(l);
      else m.set(l.productId, [l]);
    }
    return m;
  };
  const variantesDe = parProduit(variantes);
  const rangementsDe = parProduit(rangements);
  const visuelsDe = parProduit(visuels);

  const lignes: string[] = [];
  for (const p of produits) {
    const formats = variantesDe.get(p.id) ?? [];
    const collections = rangementsDe.get(p.id) ?? [];
    const images = visuelsDe.get(p.id) ?? [];
    // Le poids que la collection donnerait : c'est lui qui s'applique quand
    // ni la variante ni l'affiche n'en portent, et il explique un
    // affranchissement qu'on croirait sorti de nulle part.
    const poidsCollection = collections
      .map((r) => r.poids)
      .filter((v): v is number => typeof v === "number")
      .sort((a, b) => b - a)[0];

    const commun = [
      p.slug,
      p.name,
      p.description ?? "",
      p.vendor ?? "",
      p.productType ?? "",
      collections.map((r) => r.nom).join(", "),
      p.status === "active" ? "TRUE" : "FALSE",
      p.status,
      p.seoTitle ?? "",
      p.seoDescription ?? "",
      formats.length ? "Format" : "",
    ];
    const queue = (v: (typeof formats)[number] | null) => [
      v?.format ?? "",
      v?.sku ?? "",
      euros(v?.priceCents ?? null),
      euros(v?.compareAtCents ?? null),
      v?.weightGrams ?? "",
      v?.barcode ?? "",
      euros(v?.costCents ?? null),
      v?.stockQty ?? "",
    ];
    const informatif = [
      (p.tags ?? []).join(", "),
      p.weightGrams ?? "",
      poidsCollection ?? "",
    ];

    if (!formats.length) {
      lignes.push(
        [...commun, ...queue(null), images[0]?.url ?? "", ...informatif]
          .map(cellule)
          .join(";"),
      );
      continue;
    }
    formats.forEach((v, i) => {
      // La premiere ligne porte l'affiche, les suivantes seulement le format :
      // c'est ce que produit Shopify, et ce que notre importeur relit.
      const tete = i === 0 ? commun : [p.slug, ...Array(commun.length - 1).fill("")];
      const image = images[i]?.url ?? (i === 0 ? images[0]?.url ?? "" : "");
      lignes.push(
        [...tete, ...queue(v), image, ...(i === 0 ? informatif : ["", "", ""])]
          .map(cellule)
          .join(";"),
      );
    });
  }

  const csv = "﻿" + [COLONNES_EXPORT.join(";"), ...lignes].join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="catalogue.csv"',
    },
  });
});

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
    // Bornée des deux côtés : une adresse bricolée avec `limit=-5` ferait
    // refuser la requête par la base et renverrait une page en erreur.
    const limite = Math.min(
      Math.max(1, Math.round(Number(q.limit ?? 500) || 500)),
      1000,
    );

    // Ces filtres-là comptent aussi pour les onglets : « Actifs 200 » doit
    // parler de la recherche en cours, sinon les compteurs contrediraient le
    // tableau qu'ils surmontent.
    const communs = [];

    // Demander des produits nommément. L'éditeur en grille arrive avec la
    // liste cochée : sans ce filtre il recevait les premiers du catalogue par
    // ordre alphabétique, c'est-à-dire n'importe lesquels.
    const choisis = identifiants(
      (q.ids ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    );
    if (choisis.length) communs.push(inArray(schema.products.id, choisis));

    const cherche = (q.q ?? "").trim();
    if (cherche) {
      // « % » et « _ » ont un sens pour la base : cherchés tels quels, ils
      // ramèneraient tout le catalogue et les compteurs mentiraient avec la
      // liste. Le nom d'une affiche a le droit de contenir « 50% ».
      const motif = `%${cherche.toLowerCase().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      communs.push(
        or(
          raw`lower(${schema.products.name}) like ${motif}`,
          raw`lower(${schema.products.slug}) like ${motif}`,
          // Les étiquettes aussi : « vannes » doit trouver l'affiche
          // étiquetée « salon de Vannes », même si son nom ne dit rien de
          // Vannes. C'est tout l'intérêt d'étiqueter.
          raw`exists (select 1 from jsonb_array_elements_text(coalesce(${schema.products.tags}, '[]'::jsonb)) e where lower(e) like ${motif})`,
        )!,
      );
    }
    // Une étiquette précise, choisie dans la liste : la comparaison est
    // exacte, sans quoi « salon » ramènerait « salon de Vannes » et on ne
    // pourrait plus isoler l'une des deux.
    const etiquette = (q.etiquette ?? "").trim();
    if (etiquette)
      communs.push(
        raw`exists (select 1 from jsonb_array_elements_text(coalesce(${schema.products.tags}, '[]'::jsonb)) e where lower(e) = ${etiquette.toLowerCase()})`,
      );
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
    const conditionsLignes = [...communs];
    if (statutValide(q.statut))
      conditionsLignes.push(eq(schema.products.status, q.statut));

    // La description ne vient que si on la demande : seule la grille de
    // modification groupée en a l'usage, et deux cents textes n'ont pas à
    // traverser la liste des produits à chaque visite.
    const avecDescription = q.avecDescription === "1";

    /*
     * PREMIÈRE VAGUE — quatre requêtes qui ne dépendent de rien.
     *
     * La base est à 300 ms d'aller-retour (Neon, Ohio). Les enchaîner faisait
     * 1,2 seconde d'attente pure, alors qu'aucune n'a besoin du résultat des
     * autres. Ensemble, elles coûtent une attente au lieu de quatre.
     */
    const [parStatut, lignes, categories, collections] = await Promise.all([
      db
        .select({ status: schema.products.status, n: count() })
        .from(schema.products)
        .where(communs.length ? and(...communs) : undefined)
        .groupBy(schema.products.status),
      db
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
          defaultView: schema.products.defaultView,
          description: avecDescription
            ? schema.products.description
            : raw<string | null>`null`,
        })
        .from(schema.products)
        .where(conditionsLignes.length ? and(...conditionsLignes) : undefined)
        // Par ordre alphabétique : on cherche ici un produit dont on connaît
        // le nom, pas une création récente.
        .orderBy(asc(schema.products.name), asc(schema.products.id))
        .limit(limite),
      // Les catégories où l'on peut ranger un lot : pas les archivées, pour
      // la même raison que les collections juste en dessous.
      db
        .select({
          id: schema.productCategories.id,
          name: schema.productCategories.name,
        })
        .from(schema.productCategories)
        .where(isNull(schema.productCategories.archivedAt))
        .orderBy(
          asc(schema.productCategories.position),
          asc(schema.productCategories.name),
        ),
      // Les collections où l'on peut ranger un lot : pas les archivées. Y
      // envoyer des affiches les ferait disparaître de la boutique sans que
      // rien ne le dise.
      db
        .select({ id: schema.collections.id, name: schema.collections.name })
        .from(schema.collections)
        .where(isNull(schema.collections.archivedAt))
        .orderBy(...ordreDesCollections()),
    ]);

    const compte = { tous: 0, active: 0, draft: 0, archived: 0 };
    for (const r of parStatut) {
      const n = Number(r.n);
      compte.tous += n;
      if (statutValide(r.status)) compte[r.status] += n;
    }

    const ids = lignes.map((l) => l.id);

    /*
     * DEUXIÈME VAGUE — les trois requêtes qui ont besoin des identifiants
     * trouvés ci-dessus. Elles partent ensemble, elles aussi.
     *
     * Les prix, et pas seulement le nombre de formats : la liste doit montrer
     * ce que la cliente paiera, et le prix de base ne le dit pas.
     */
    const [variantes, images, liens] = await Promise.all([
      ids.length
        ? db
          .select({
            productId: schema.variants.productId,
            format: schema.variants.format,
            priceCents: schema.variants.priceCents,
          })
          .from(schema.variants)
          .where(inArray(schema.variants.productId, ids))
        : [],
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
        : [],
      ids.length
        ? db
          .select({
            productId: schema.productCollections.productId,
            id: schema.collections.id,
            name: schema.collections.name,
            defaultWeightGrams: schema.collections.defaultWeightGrams,
            archivedAt: schema.collections.archivedAt,
          })
          .from(schema.productCollections)
          .innerJoin(
            schema.collections,
            eq(schema.productCollections.collectionId, schema.collections.id),
          )
          .where(inArray(schema.productCollections.productId, ids))
          .orderBy(...ordreDesCollections())
        : [],
    ]);

    const nombreDeVariantes = new Map<number, number>();
    const prixParProduit = new Map<number, { min: number; max: number }>();
    const formatsParProduit = new Map<number, string[]>();
    const prixParFormat = new Map<number, Record<string, number | null>>();
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
      // Le prix de CHAQUE format, pour que la grille de modification groupée
      // le montre dans sa case (comme Shopify montre celui de chaque
      // variante) au lieu d'une case vide dès que l'A3 et l'A4 diffèrent.
      // Deux variantes d'un même format à des prix différents : null, la
      // case reste vide plutôt que d'afficher l'un des deux pour le prix.
      const parFormat = prixParFormat.get(v.productId) ?? {};
      parFormat[v.format] =
        parFormat[v.format] === undefined || parFormat[v.format] === v.priceCents
          ? v.priceCents
          : null;
      prixParFormat.set(v.productId, parFormat);
    }

    // La première rencontrée est celle de position la plus basse : c'est
    // l'image principale, celle qui illustre déjà le produit en boutique.
    const imageParProduit = new Map<number, string>();
    for (const img of images)
      if (!imageParProduit.has(img.productId))
        imageParProduit.set(img.productId, img.url);

    const collectionsParProduit = new Map<
      number,
      { id: number; name: string; archivee?: true }[]
    >();
    // La plus lourde des collections qui se prononcent : un colis surestimé se
    // paie quelques centimes, un colis sous-affranchi revient en surtaxe sans
    // que rien ne l'ait signalé.
    const poidsCollectionsParProduit = new Map<number, number | null>();
    for (const l of liens) {
      const liste = collectionsParProduit.get(l.productId) ?? [];
      // Archivée, elle reste nommée et marquée : la grille de modification
      // groupée doit pouvoir la montrer, et ne pas l'en faire sortir sans
      // qu'on l'ait demandé.
      liste.push({ id: l.id, name: l.name, ...(l.archivedAt ? { archivee: true as const } : {}) });
      collectionsParProduit.set(l.productId, liste);
      poidsCollectionsParProduit.set(
        l.productId,
        poidsDesCollections([
          poidsCollectionsParProduit.get(l.productId),
          l.defaultWeightGrams,
        ]),
      );
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
            collectionGrammes: poidsCollectionsParProduit.get(p.id),
          }),
          prixMin: prixParProduit.get(p.id)?.min ?? null,
          prixMax: prixParProduit.get(p.id)?.max ?? null,
          prixParFormat: prixParFormat.get(p.id) ?? {},
          formats: formatsParProduit.get(p.id) ?? [],
          aiEnabled: p.aiEnabled,
          imageUrl: imageParProduit.get(p.id) ?? null,
          variantes: nombreDeVariantes.get(p.id) ?? 0,
          collections: collectionsParProduit.get(p.id) ?? [],
          defaultView: p.defaultView,
          ...(avecDescription ? { description: p.description } : {}),
        };
      }),
      categories: categories.map((cat) => ({ id: cat.id, name: cat.name })),
      collections,
      formats: [...tousLesFormats].sort(),
      // Les étiquettes déjà posées dans tout le catalogue, pour choisir dans
      // une liste au lieu de retaper : « best-seller » écrit de quatre façons
      // différentes ne se retrouve jamais.
      etiquettes: [
        ...new Set(
          (
            await db
              .select({ tags: schema.products.tags })
              .from(schema.products)
          ).flatMap((r) => r.tags ?? []),
        ),
      ].sort((a, b) => a.localeCompare(b, "fr")),
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
      // Champ absent : c'est un envoi incomplet, pas l'ordre de déclasser
      // toute la sélection. Pour retirer la catégorie, il faut l'écrire.
      if (!("categoryId" in b))
        return c.json(
          {
            error:
              "Indiquez la catégorie à appliquer, ou choisissez « aucune catégorie » pour les en retirer.",
          },
          400,
        );
      const brut = b.categoryId;
      let categoryId: number | null = null;
      if (brut !== null && brut !== undefined && brut !== "") {
        categoryId = Number(brut);
        const [existe] = Number.isFinite(categoryId)
          ? await db
              .select({
                id: schema.productCategories.id,
                archivedAt: schema.productCategories.archivedAt,
              })
              .from(schema.productCategories)
              .where(eq(schema.productCategories.id, categoryId))
          : [];
        if (!existe)
          return c.json(
            { error: "Cette catégorie n'existe plus. Rechargez la page." },
            400,
          );
        // Même règle que pour les collections : on peut toujours en SORTIR un
        // lot (« aucune catégorie »), mais pas en ranger dans un rayon rangé.
        if (existe.archivedAt)
          return c.json(
            {
              error:
                "Cette catégorie est archivée. Restaurez-la avant d'y ranger des affiches.",
            },
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
      // Même prudence que pour la catégorie : sans le champ, on ne vide pas
      // le poids de trente produits au motif que le formulaire l'a oublié.
      if (!("weightGrams" in b))
        return c.json(
          {
            error:
              "Indiquez le poids à appliquer. Laissez la case vide pour reprendre celui de la catégorie.",
          },
          400,
        );
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

      // Un montant laissé vide veut dire « je passe par le pourcentage » ;
      // toute autre saisie illisible est refusée plutôt que lue comme zéro.
      const luMontant = prixSaisi(b.montantCents);
      if (typeof luMontant !== "number" && luMontant !== "vide")
        return c.json({ error: messagePrix(luMontant, "Le montant") }, 400);
      const montantCents: number | null =
        typeof luMontant === "number" ? luMontant : null;

      const brutPourcent = b.pourcent;
      let pourcent: number | null = null;
      if (
        brutPourcent !== null &&
        brutPourcent !== undefined &&
        brutPourcent !== ""
      ) {
        const n =
          typeof brutPourcent === "number" || typeof brutPourcent === "string"
            ? Number(brutPourcent)
            : Number.NaN;
        if (!Number.isFinite(n))
          return c.json({ error: "Le pourcentage doit être un nombre." }, 400);
        // Un pourcentage négatif retourne l'opération : « diminuer de moins
        // cinquante » remonterait tous les prix de la sélection en annonçant
        // une remise.
        if (n < 0)
          return c.json(
            {
              error:
                "Le pourcentage ne peut pas être négatif. Pour baisser les prix, choisissez « diminuer ».",
            },
            400,
          );
        if (n > POURCENT_MAX)
          return c.json(
            {
              error: `Le pourcentage doit rester entre 0 et ${POURCENT_MAX}.`,
            },
            400,
          );
        pourcent = n;
      }

      if (mode === "fixe" && montantCents === null)
        return c.json({ error: "Indiquez le nouveau prix." }, 400);
      if (mode !== "fixe" && montantCents === null && pourcent === null)
        return c.json(
          { error: "Indiquez un montant ou un pourcentage." },
          400,
        );
      // Les deux à la fois : le calcul n'en retiendrait qu'un, et personne ne
      // saurait lequel a été appliqué à toute la sélection.
      if (mode === "fixe" && pourcent !== null)
        return c.json(
          {
            error:
              "Pour un prix fixe, indiquez seulement le nouveau prix : le pourcentage ne s'applique pas.",
          },
          400,
        );
      if (montantCents !== null && pourcent !== null)
        return c.json(
          {
            error:
              "Choisissez un montant ou un pourcentage, pas les deux à la fois.",
          },
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

      /** Le message d'un calcul qui sort des prix possibles pour une affiche. */
      const horsBornes = `Ce calcul donnerait un prix au-dessus de ${euros(PRIX_MAX_CENTS)}. Vérifiez le montant ou le pourcentage saisi.`;

      // Tout est calculé AVANT la moindre écriture : un prix hors bornes doit
      // arrêter l'action pendant qu'elle est encore sans effet, plutôt que de
      // laisser la moitié du catalogue re-tarifée.
      const prixAEcrire = new Map<number, number>();
      const touches = new Set<number>();
      for (const v of visees) {
        const suivant = calculer(v.priceCents);
        if (suivant > PRIX_MAX_CENTS)
          return c.json({ error: horsBornes }, 400);
        if (suivant === v.priceCents) continue;
        prixAEcrire.set(v.id, suivant);
        v.priceCents = suivant;
        touches.add(v.productId);
      }

      // Un produit sans aucun format n'a que son prix de repli : sans ce
      // rattrapage, l'action resterait sans effet sur lui, sans le dire.
      const basesAEcrire = new Map<number, number>();
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
          if (suivant > PRIX_MAX_CENTS)
            return c.json({ error: horsBornes }, 400);
          if (suivant === r.basePriceCents) continue;
          basesAEcrire.set(r.id, suivant);
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
        if (bas !== undefined) basesAEcrire.set(produitId, bas);
      }

      // Une remise s'applique en entier ou pas du tout : un catalogue à
      // moitié re-tarifé serait invendable et impossible à rattraper à la
      // main. Les prix identiques partent ensemble, pour ne pas envoyer une
      // requête par affiche.
      await db.transaction(async (tx) => {
        for (const [cents, varianteIds] of parValeur(prixAEcrire))
          await tx
            .update(schema.variants)
            .set({ priceCents: cents })
            .where(inArray(schema.variants.id, varianteIds));
        const maintenant = new Date();
        for (const [cents, produitIds] of parValeur(basesAEcrire))
          await tx
            .update(schema.products)
            .set({ basePriceCents: cents, updatedAt: maintenant })
            .where(inArray(schema.products.id, produitIds));
      });

      return c.json({ ok: true, count: touches.size });
    }

    if (action === "collection-ajouter" || action === "collection-retirer") {
      const collectionId = Number(b.collectionId);
      const [collection] = Number.isFinite(collectionId)
        ? await db
            .select({
              id: schema.collections.id,
              archivedAt: schema.collections.archivedAt,
            })
            .from(schema.collections)
            .where(eq(schema.collections.id, collectionId))
        : [];
      if (!collection)
        return c.json(
          { error: "Cette collection n'existe plus. Rechargez la page." },
          400,
        );
      // On peut toujours SORTIR d'une collection archivée — c'est du ménage.
      // Y ranger un lot, non : la collection étant rangée, le rayon resterait
      // introuvable en boutique, et le seul effet visible serait le poids par
      // défaut qu'elle donne aux colis. Un rangement qui ne range rien et
      // change l'affranchissement n'est pas ce qu'on croit avoir demandé.
      if (action === "collection-ajouter" && collection.archivedAt)
        return c.json(
          {
            error:
              "Cette collection est archivée. Restaurez-la avant d'y ranger des affiches.",
          },
          400,
        );

      if (action === "collection-retirer") {
        const retires = await sortirDesCollections(db, ids, [collectionId]);
        return c.json({ ok: true, count: retires });
      }

      const existants = await db
        .select({ id: schema.products.id })
        .from(schema.products)
        .where(inArray(schema.products.id, ids));
      if (!existants.length) return c.json({ ok: true, count: 0 });
      // Un produit déjà rangé dans la collection est un cas normal, pas une
      // erreur : il garde sa place, et les autres se rangent À LA FIN, dans
      // l'ordre de la sélection. Les poser tous au rang 0, comme avant, les
      // faisait passer devant tout ce que la boutique avait rangé à la main.
      const exist = new Set(existants.map((p) => p.id));
      await db.transaction((tx) =>
        rangerEnFinDeCollection(
          tx,
          collectionId,
          ids.filter((i) => exist.has(i)),
        ),
      );
      return c.json({ ok: true, count: existants.length });
    }

    if (action === "ia") {
      // Sans valeur lisible, on ne suppose pas « non » : ce serait éteindre
      // l'IA de toute la sélection sur un simple champ oublié en chemin.
      const actif = booleenSaisi(b.valeur);
      if (actif === null)
        return c.json(
          { error: "Indiquez si l'IA doit être activée ou désactivée." },
          400,
        );
      const faits = await db
        .update(schema.products)
        .set({ aiEnabled: actif, updatedAt: new Date() })
        .where(inArray(schema.products.id, ids))
        .returning({ id: schema.products.id });
      return c.json({ ok: true, count: faits.length });
    }

    /*
     * « Supprimer » N'EXISTE PLUS, et c'est une action de moins, pas une
     * action de plus : une affiche a toujours eu son statut « archivé », qui
     * la retire du site en la gardant entière. Le bouton rouge faisait autre
     * chose — il effaçait la ligne, et avec elle les photos de la fiche, les
     * fonds du configurateur, le rangement en collections et le lien des
     * affiches déjà créées par l'IA. Rien de tout cela ne se récupérait.
     *
     * Le garde-fou des produits vendus est donc lui aussi sans objet : ce
     * qu'il protégeait ne peut plus arriver. On garde en revanche la réponse
     * explicite pour un écran resté ouvert avant la bascule, plutôt qu'un
     * « Action inconnue » qui laisserait croire à une panne.
     */
    if (action === "supprimer")
      return c.json(
        {
          error:
            "Les affiches ne se suppriment plus : choisissez « Archiver ». Elles quittent le site et restent dans l'onglet « Archivées », d'où elles se remettent en vente.",
        },
        400,
      );

    return c.json({ error: "Action inconnue." }, 400);
  });


  /* ---------------------------------------------------------------------- */
  /*  Édition ligne à ligne                                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * Enregistre les cases modifiées à même le tableau — ou montre d'abord ce
   * qu'elles changeraient.
   *
   * Le tableau s'édite comme un tableur : on corrige dix noms et trois prix,
   * puis on enregistre une seule fois. Chaque ligne est jugée seule, et une
   * ligne refusée revient dans `erreurs` avec sa raison au lieu d'annuler le
   * travail des neuf autres.
   *
   * Avec `apercu: true`, RIEN n'est écrit : chaque ligne passe exactement par
   * la même vérification, et la réponse dit, champ par champ, ce qui était et
   * ce qui sera — avec les redirections 301 que poseront les adresses
   * changées. C'est le « Vérifier les changements » de la grille : appliquer
   * un nouveau nom à cent affiches se regarde avant de s'enregistrer. Le même
   * lot renvoyé sans `apercu` s'enregistre alors tel qu'il a été montré.
   */
  app.post("/admin/products/masse", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const apercu = b.apercu === true;
    const modifications = (
      Array.isArray(b.modifications) ? (b.modifications as unknown[]) : []
    ).filter(
      (m): m is Record<string, unknown> => typeof m === "object" && m !== null,
    );
    if (!modifications.length)
      return c.json({ ok: true, count: 0, ...(apercu ? { apercu: [] } : {}) });

    const ids = identifiants(modifications.map((m) => m.id));

    /*
     * Tout ce que la vérification lit, chargé une fois et ensemble : la base
     * peut être à 300 ms d'aller-retour, et deux cents lignes à une requête
     * chacune ne se supporteraient pas.
     */
    const [
      produits,
      tousLesSlugs,
      categories,
      vues,
      collectionsBase,
      liensDuLot,
      variantesDuLot,
    ] = await Promise.all([
      ids.length
        ? db
            .select({
              id: schema.products.id,
              slug: schema.products.slug,
              name: schema.products.name,
              status: schema.products.status,
              basePriceCents: schema.products.basePriceCents,
              categoryId: schema.products.categoryId,
              weightGrams: schema.products.weightGrams,
              aiEnabled: schema.products.aiEnabled,
              description: schema.products.description,
              defaultView: schema.products.defaultView,
            })
            .from(schema.products)
            .where(inArray(schema.products.id, ids))
        : Promise.resolve([]),
      // Tous les slugs du catalogue, pas seulement ceux du lot : l'adresse
      // d'un produit doit rester unique face à ceux que la page n'affiche
      // même pas.
      db
        .select({ id: schema.products.id, slug: schema.products.slug })
        .from(schema.products),
      // Les archivées comptent ici, exprès : la grille renvoie pour chaque
      // ligne la catégorie qu'elle a déjà, et la refuser rendrait
      // immodifiable toute affiche dont on vient de ranger la catégorie.
      // C'est la liste déroulante, elle, qui ne propose plus les archivées.
      db
        .select({ id: schema.productCategories.id, name: schema.productCategories.name })
        .from(schema.productCategories),
      db
        .select({
          slug: schema.posterViews.slug,
          name: schema.posterViews.name,
          archivedAt: schema.posterViews.archivedAt,
        })
        .from(schema.posterViews),
      db
        .select({
          id: schema.collections.id,
          name: schema.collections.name,
          archivedAt: schema.collections.archivedAt,
        })
        .from(schema.collections),
      ids.length
        ? db
            .select({
              productId: schema.productCollections.productId,
              collectionId: schema.productCollections.collectionId,
            })
            .from(schema.productCollections)
            .where(inArray(schema.productCollections.productId, ids))
        : Promise.resolve([]),
      // Les formats du lot : la grille en modifie plusieurs par ligne.
      ids.length
        ? db
            .select({
              id: schema.variants.id,
              productId: schema.variants.productId,
              format: schema.variants.format,
              priceCents: schema.variants.priceCents,
            })
            .from(schema.variants)
            .where(inArray(schema.variants.productId, ids))
        : Promise.resolve([]),
    ]);

    const parId = new Map(produits.map((p) => [p.id, p]));
    const proprietaireDuSlug = new Map(
      tousLesSlugs.map((p) => [p.slug, p.id] as const),
    );
    const nomCategorie = new Map(categories.map((cat) => [cat.id, cat.name]));
    const categoriesConnues = new Set(categories.map((cat) => cat.id));
    const nomVue = new Map(vues.map((v) => [v.slug, v.name]));
    const vuesOuvertes = new Set(
      vues.filter((v) => !v.archivedAt).map((v) => v.slug),
    );
    const collections = new Map(
      collectionsBase.map((col) => [
        col.id,
        { name: col.name, archivee: col.archivedAt !== null },
      ]),
    );
    const liensParProduit = new Map<number, Set<number>>();
    for (const l of liensDuLot) {
      const s = liensParProduit.get(l.productId) ?? new Set<number>();
      s.add(l.collectionId);
      liensParProduit.set(l.productId, s);
    }
    const variantesParProduit = new Map<
      number,
      { id: number; format: string; priceCents: number }[]
    >();
    for (const v of variantesDuLot) {
      const liste = variantesParProduit.get(v.productId) ?? [];
      liste.push({ id: v.id, format: v.format, priceCents: v.priceCents });
      variantesParProduit.set(v.productId, liste);
    }

    // Le dernier rang de chaque collection : une affiche qu'on y range
    // arrive À LA FIN, sans bousculer l'ordre réglé à la main (collections.ts).
    // Lu seulement s'il faut écrire : un aperçu n'en a pas besoin.
    const rangs = apercu ? new Map<number, number>() : await derniersRangs(db, [...collections.keys()]);
    const nomsCollections = (liste: number[]) =>
      liste.map((id) => collections.get(id)?.name ?? `n° ${id}`).join(", ");
    const prixLisible = (cents: number) =>
      `${(cents / 100).toFixed(2).replace(".", ",")} €`;
    const grammesLisibles = (g: number | null) =>
      g === null ? "vide (celui de la catégorie)" : `${g} g`;
    const nomDeVue = (slug: string | null) =>
      slug === null ? "par défaut" : (nomVue.get(slug) ?? slug);

    const erreurs: { id: number; message: string }[] = [];
    const lignesApercu: {
      id: number;
      nom: string;
      changements: Changement[];
      redirection: { de: string; vers: string } | null;
    }[] = [];
    let count = 0;
    let redirectionsPosees = 0;

    for (const m of modifications) {
      const id = identifiant(m.id);
      const produit = id === null ? undefined : parId.get(id);
      if (!produit) {
        erreurs.push({
          id: id ?? 0,
          message: "Ce produit n'existe plus. Rechargez la page.",
        });
        continue;
      }

      const liens = liensParProduit.get(produit.id) ?? new Set<number>();
      const verdict = verifierLigne(m, produit, {
        proprietaireDuSlug,
        categories: categoriesConnues,
        vues: vuesOuvertes,
        collections,
        liens,
      });
      if (!verdict.ok) {
        erreurs.push({ id: produit.id, message: verdict.message });
        continue;
      }
      const formatsDuProduit = variantesParProduit.get(produit.id) ?? [];

      // Un prix tapé pour un format que le produit n'a pas ne s'applique nulle
      // part. Le passer sous silence laisserait croire à un enregistrement
      // réussi devant une valeur qui n'a pas pris.
      const formatsConnus = new Set(formatsDuProduit.map((v) => v.format));
      const inconnus = [...verdict.prix.keys()].filter(
        (f) => !formatsConnus.has(f),
      );
      if (inconnus.length) {
        erreurs.push({
          id: produit.id,
          message: `Ce produit n'existe pas en ${inconnus.join(", ")}. Rechargez la page pour voir ses formats.`,
        });
        continue;
      }

      // Ne garder que ce qui change VRAIMENT : réécrire une valeur identique
      // ferait compter la ligne comme modifiée, et la page annoncerait un
      // travail qu'elle n'a pas fait.
      const donnees: ChampsProduit = {};
      for (const [cle, valeur] of Object.entries(verdict.donnees) as [
        keyof ChampsProduit,
        unknown,
      ][])
        if (valeur !== produit[cle])
          (donnees as Record<string, unknown>)[cle] = valeur;
      const prixAEcrire = new Map<number, number>();
      for (const v of formatsDuProduit) {
        const voulu = verdict.prix.get(v.format);
        if (voulu !== undefined && voulu !== v.priceCents)
          prixAEcrire.set(v.id, voulu);
      }
      const changeCollections = verdict.collections;
      if (!Object.keys(donnees).length && !prixAEcrire.size && !changeCollections)
        continue;

      // Le prix de base suit le plus bas des formats, sauf quand la ligne le
      // fixe elle-même : la valeur tapée à la main a le dernier mot, sinon
      // elle serait écrasée dans la seconde par un calcul que personne n'a
      // demandé.
      const baseARecaler =
        prixAEcrire.size && donnees.basePriceCents === undefined
          ? Math.min(
              ...formatsDuProduit.map(
                (v) => prixAEcrire.get(v.id) ?? v.priceCents,
              ),
            )
          : null;

      const redirection =
        donnees.slug !== undefined
          ? {
              de: cheminAffiche(produit.slug),
              vers: cheminAffiche(donnees.slug),
            }
          : null;

      if (apercu) {
        // Champ par champ, avec les mots de la grille : c'est ce que la
        // propriétaire relit avant d'enregistrer.
        const changements: Changement[] = [];
        if (donnees.name !== undefined)
          changements.push({ champ: "Nom", avant: produit.name, apres: donnees.name });
        if (donnees.slug !== undefined)
          changements.push({ champ: "Identifiant", avant: produit.slug, apres: donnees.slug });
        if (donnees.status !== undefined)
          changements.push({
            champ: "Statut",
            avant: LIBELLES_STATUT[produit.status] ?? produit.status,
            apres: LIBELLES_STATUT[donnees.status] ?? donnees.status,
          });
        for (const v of formatsDuProduit) {
          const voulu = prixAEcrire.get(v.id);
          if (voulu !== undefined)
            changements.push({
              champ: `Prix ${v.format}`,
              avant: prixLisible(v.priceCents),
              apres: prixLisible(voulu),
            });
        }
        if (donnees.basePriceCents !== undefined)
          changements.push({
            champ: "Prix de repli",
            avant: prixLisible(produit.basePriceCents),
            apres: prixLisible(donnees.basePriceCents),
          });
        if (donnees.categoryId !== undefined)
          changements.push({
            champ: "Catégorie",
            avant: produit.categoryId === null ? "aucune" : (nomCategorie.get(produit.categoryId) ?? `n° ${produit.categoryId}`),
            apres: donnees.categoryId === null ? "aucune" : (nomCategorie.get(donnees.categoryId) ?? `n° ${donnees.categoryId}`),
          });
        if (donnees.weightGrams !== undefined)
          changements.push({
            champ: "Poids",
            avant: grammesLisibles(produit.weightGrams),
            apres: grammesLisibles(donnees.weightGrams),
          });
        if (donnees.aiEnabled !== undefined)
          changements.push({
            champ: "Affiche IA",
            avant: produit.aiEnabled ? "oui" : "non",
            apres: donnees.aiEnabled ? "oui" : "non",
          });
        if (donnees.description !== undefined)
          changements.push({
            champ: "Description",
            avant: extrait(produit.description),
            apres: extrait(donnees.description),
          });
        if (donnees.defaultView !== undefined)
          changements.push({
            champ: "Type d'affiche",
            avant: nomDeVue(produit.defaultView),
            apres: nomDeVue(donnees.defaultView),
          });
        if (changeCollections) {
          const avant = [...liens];
          const apres = [
            ...avant.filter((cid) => !changeCollections.retirer.includes(cid)),
            ...changeCollections.ajouter,
          ];
          changements.push({
            champ: "Collections",
            avant: nomsCollections(avant) || "aucune",
            apres: nomsCollections(apres) || "aucune",
          });
        }
        lignesApercu.push({ id: produit.id, nom: produit.name, changements, redirection });
        // Le lot se juge comme il s'enregistrera : une adresse prise par une
        // ligne plus haut n'est plus libre pour les suivantes.
        if (donnees.slug) {
          proprietaireDuSlug.delete(produit.slug);
          proprietaireDuSlug.set(donnees.slug, produit.id);
        }
        count++;
        if (redirection) redirectionsPosees++;
        continue;
      }

      try {
        // La ligne passe en entier ou pas du tout : un produit dont le statut
        // serait écrit et le prix non serait dans un état que personne n'a
        // demandé, et que rien à l'écran ne trahirait.
        await db.transaction(async (tx) => {
          if (Object.keys(donnees).length)
            await tx
              .update(schema.products)
              .set({ ...donnees, updatedAt: new Date() })
              .where(eq(schema.products.id, produit.id));
          for (const [cents, varianteIds] of parValeur(prixAEcrire))
            await tx
              .update(schema.variants)
              .set({ priceCents: cents })
              .where(inArray(schema.variants.id, varianteIds));
          if (baseARecaler !== null)
            await tx
              .update(schema.products)
              .set({ basePriceCents: baseARecaler, updatedAt: new Date() })
              .where(eq(schema.products.id, produit.id));
          if (changeCollections) {
            await sortirDesCollections(tx, [produit.id], changeCollections.retirer);
            // Ajoutée à la fin de chaque collection, dans l'ordre du lot.
            for (const collectionId of changeCollections.ajouter) {
              const rang = (rangs.get(collectionId) ?? -1) + 1;
              await tx
                .insert(schema.productCollections)
                .values({ productId: produit.id, collectionId, position: rang })
                .onConflictDoNothing();
              rangs.set(collectionId, rang);
            }
          }
          // L'ancienne adresse mène à la nouvelle, dans la même transaction
          // que le changement : jamais l'un sans l'autre.
          if (donnees.slug !== undefined)
            await poserRedirection(tx, produit.slug, donnees.slug);
        });
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

      // La mémoire du lot ne se met à jour qu'une fois la ligne écrite : le
      // même produit peut revenir plus bas dans le même envoi.
      if (donnees.slug) {
        proprietaireDuSlug.delete(produit.slug);
        proprietaireDuSlug.set(donnees.slug, produit.id);
        produit.slug = donnees.slug;
        redirectionsPosees++;
      }
      Object.assign(produit, donnees);
      for (const v of formatsDuProduit) {
        const ecrit = prixAEcrire.get(v.id);
        if (ecrit !== undefined) v.priceCents = ecrit;
      }
      if (changeCollections) {
        for (const cid of changeCollections.retirer) liens.delete(cid);
        for (const cid of changeCollections.ajouter) liens.add(cid);
        liensParProduit.set(produit.id, liens);
      }

      count++;
    }

    return c.json({
      ok: true,
      count,
      redirections: redirectionsPosees,
      ...(apercu ? { apercu: lignesApercu } : {}),
      ...(erreurs.length ? { erreurs } : {}),
    });
  });
}
