import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import {
  and,
  asc,
  count,
  eq,
  desc,
  gte,
  inArray,
  isNull,
  or,
  sql as sqlOp,
} from "drizzle-orm";
import type { Column, SQL } from "drizzle-orm";
import { resolve, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { db, sql, schema } from "./db/client.js";
import {
  SESSION_COOKIE,
  createSession,
  deleteSession,
  hashPassword,
  validateSession,
  verifyPassword,
  purgeExpiredSessions,
} from "./auth.js";
import {
  CODES_NATURE,
  NATURES_LIVRAISON,
  formaterPoids,
  normaliserCode,
} from "@memoryline/types";
import { rechercherPointsRelais } from "./mondial-relay.js";
import { suggererAdresses } from "./adresses.js";
import { langueDuVisiteur, mountTraduction, nomTraduit } from "./traductions.js";
import { mountBordereaux } from "./sendcloud-colis.js";
import {
  gerePoints as sendcloudGerePoints,
  rechercherPoints as rechercherPointsSendcloud,
} from "./sendcloud-points.js";
import { rechercherPointsRetrait } from "./colissimo.js";
// La règle qui décide si un mode de livraison sort sur le site vit à part :
// le site la consulte pour filtrer, le back-office pour expliquer.
import {
  SANS_TARIF,
  TRANSPORTEURS,
  checklistOuverture,
  couverturesParMode,
  raisonsMasquage,
  transporteurConfigure,
  transporteursEnService,
} from "./livraison-regles.js";

import { mountConfiguratorRoutes } from "./configurator-routes.js";
import { mountOrderRoutes } from "./commandes.js";
import { mountCatalogueRoutes } from "./catalogue.js";
import { mountProduitsMasse } from "./produits-masse.js";
import { mountVentesProduit } from "./ventes-produit.js";
import { mountFicheProduit } from "./fiche-produit.js";
import { mountCms } from "./cms.js";
import { mountCollections } from "./collections.js";
import { mountImportProduits } from "./import-produits.js";
import { mountCartesCadeaux } from "./cartes-cadeaux.js";
import { mountLettre } from "./lettre.js";
import { mountFinances } from "./finances.js";
import { mountRecherche } from "./recherche.js";
import { mountDecors } from "./decors.js";
import { mountApercus } from "./apercus.js";
import { mountCouleursDessins } from "./couleurs-dessins.js";
import { mountCourriers } from "./courriers.js";
import { mountArchives } from "./archives.js";
import {
  demarrerRelancePanier,
  mountRelancePanier,
} from "./relance-panier.js";
import { mountSalonRoutes } from "./salon.js";
import { mountCompteRoutes } from "./comptes.js";
import { mountAnalytiqueRoutes } from "./analytique.js";
import {
  mountOrdreAffichageRoutes,
  ordreManuelDuGenre,
} from "./ordre-affichage.js";
import { demarrerPurgeIa, mountIaRoutes } from "./ia.js";
import { demarrerMenageRelais, mountRelaisPhotoRoutes } from "./ia-relais.js";
import { mountContact } from "./contact.js";

const app = new Hono();
const isProd = process.env.NODE_ENV === "production";

/**
 * CORS — le web (4324) et l'admin (4323) appellent l'API (3100) depuis le
 * navigateur (configurateur, panier, édition couleurs…). Sans ces en-têtes,
 * le navigateur bloque les réponses (net::ERR_FAILED) même quand l'API répond
 * 200. `credentials: true` pour les requêtes admin authentifiées (cookie).
 * Les origines autorisées sont surchargeables via WEB_ORIGINS (CSV) en prod.
 */
const allowedOrigins = (
  process.env.WEB_ORIGINS ??
  "http://localhost:4321,http://localhost:4322,http://localhost:4323,http://localhost:4324,http://localhost:4325"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  "*",
  cors({
    origin: (origin) =>
      !origin || allowedOrigins.includes(origin) ? origin || "*" : null,
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

// === Back-office — PROTÉGÉ ================================================
// Toute requête /admin/* exige une session valide, et les ÉCRITURES exigent
// en plus le rôle « owner ».
//
// Ce garde est déclaré ICI, AVANT la moindre route, et c'est essentiel : Hono
// n'applique un middleware qu'aux routes déclarées APRÈS lui. Placé plus bas,
// il laissait passer sans session tout ce qui était écrit au-dessus — les
// adresses de la lettre d'information et la grille tarifaire, entre autres.
// Toute nouvelle route /admin/* est désormais couverte par construction.
//
// Règle volontairement simple, donc difficile à contourner par oubli : toute
// méthode autre que GET est réservée au propriétaire. Un « seller » consulte
// le catalogue, les commandes et télécharge les PDF d'impression, mais ne peut
// modifier ni les produits, ni les personnages, ni les prix, ni les promotions,
// ni le contenu du site. Énumérer les routes à protéger une par une aurait
// laissé passer la prochaine route ajoutée.
const OWNER_ROLE = "owner";

/**
 * Ce qu'un VENDEUR a le droit de lire, et rien d'autre.
 *
 * La règle d'avant disait « le vendeur consulte, le propriétaire modifie ».
 * Elle laissait donc lire tout : le chiffre du site, les fiches clients, les
 * marges, les autres stands. Ce n'est pas ce qu'on confie à quelqu'un qui
 * tient une table un samedi après-midi.
 *
 * Le sens de la marche compte plus que la liste elle-même. Énumérer ce qui est
 * INTERDIT laisse passer chaque route ajoutée ensuite, et personne ne s'en
 * aperçoit avant la fuite. Énumérer ce qui est PERMIS refuse par défaut :
 * l'oubli se voit tout de suite, parce que l'écran cesse de marcher.
 *
 * Sur ces routes-là, les données sont en plus bornées au stand : voir
 * `limiterAuStand` dans apps/api/src/commandes.ts.
 */
const LECTURES_DU_VENDEUR = [
  "/admin/orders", // bornées au stand, cf. commandes.ts
  "/admin/stats/orders", // idem
  "/admin/stands", // son stand seulement
  "/admin/print-files", // le fichier d'impression d'une affiche vendue
  "/admin/me",
];

app.use("/admin/*", async (c, next) => {
  const user = await validateSession(getCookie(c, SESSION_COOKIE));
  if (!user) return c.json({ error: "Non authentifié" }, 401);
  // Les routes lisent l'utilisateur pour borner ce qu'elles renvoient. Posé
  // ici, une fois : une route qui l'oublierait renverrait tout.
  c.set("utilisateur", user);

  if (user.role !== OWNER_ROLE) {
    const chemin = new URL(c.req.url).pathname;
    const permise =
      c.req.method === "GET" &&
      LECTURES_DU_VENDEUR.some(
        (p) => chemin === p || chemin.startsWith(`${p}/`) || chemin.startsWith(`${p}?`),
      );
    if (!permise)
      return c.json(
        { error: "Cette partie du back-office est réservée au propriétaire." },
        403,
      );
  }
  await next();
});

// Images/SVG rapatriés depuis Shopify (cf. scripts/fetch-assets.ts).
// Servis depuis data/assets/ à la racine du repo. On lit le fichier
// explicitement (chemin absolu) pour éviter les ambiguïtés de cwd.
const ASSETS_DIR = resolve(fileURLToPath(import.meta.url), "../../../../data/assets");
const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
};

/**
 * Les largeurs qu'on sait servir, et rien d'autre.
 *
 * Une liste fermee, parce qu'une largeur libre est un disque qu'on remplit :
 * il suffirait de demander mille largeurs d'une meme image pour ecrire mille
 * fichiers. Ces cinq-la couvrent la grille, la fiche et le grand ecran.
 */
const LARGEURS_SERVIES = [200, 400, 600, 900, 1400] as const;

/** Le dossier ou l'on range les tailles calculees. Jamais les originaux. */
const TAILLES_DIR = resolve(ASSETS_DIR, "tailles");

/** Les retailles en cours, pour n'en lancer qu'une par fichier a la fois. */
const tailleEnCours = new Map<string, Promise<void>>();

/**
 * Le fichier a servir : l'original, ou la taille demandee.
 *
 * L'original n'est jamais modifie — c'est lui qu'on imprime. La taille
 * calculee est ecrite a cote, une fois, puis relue. Si la retaille echoue
 * pour une raison quelconque, on rend l'original : une image lourde vaut
 * mieux qu'une image absente.
 */
async function fichierALaTaille(
  path: string,
  file: string,
  largeur: number | null,
): Promise<{ chemin: string; mime: string }> {
  const ext = extname(file).toLowerCase();
  const mimeOrigine = MIME[ext] ?? "application/octet-stream";
  // Un SVG est un dessin : il s'agrandit sans perdre, le retailler n'aurait
  // aucun sens. Un format qu'on ne connait pas, on n'y touche pas non plus.
  if (largeur === null || ext === ".svg" || !mimeOrigine.startsWith("image/"))
    return { chemin: path, mime: mimeOrigine };

  const nomCache = `${largeur}-${file.replace(/\.[^.]+$/, "")}.webp`;
  const cache = resolve(TAILLES_DIR, basename(nomCache));
  try {
    await stat(cache);
    return { chemin: cache, mime: "image/webp" };
  } catch {
    // Pas encore calculee : on la fabrique.
  }
  try {
    // Deux visiteurs qui demandent la meme taille au meme instant écriraient
    // le même fichier en même temps, et l'un lirait ce que l'autre est en
    // train d'écrire. Le premier arrivé calcule, les autres attendent son
    // résultat.
    let travail = tailleEnCours.get(cache);
    if (!travail) {
      travail = (async () => {
        const sharp = (await import("sharp")).default;
        await mkdir(TAILLES_DIR, { recursive: true });
        await sharp(path)
          // `withoutEnlargement` : on ne fabrique jamais une image plus grande
          // que l'originale, ce qui ne ferait qu'ajouter du poids sans un
          // pixel de détail en plus.
          .resize({ width: largeur, withoutEnlargement: true })
          .webp({ quality: 82 })
          .toFile(cache);
      })().finally(() => tailleEnCours.delete(cache));
      tailleEnCours.set(cache, travail);
    }
    await travail;
    return { chemin: cache, mime: "image/webp" };
  } catch (e) {
    console.warn("[assets] retaille impossible", file, String(e));
    return { chemin: path, mime: mimeOrigine };
  }
}

app.get("/assets/:file", async (c) => {
  // basename() neutralise toute tentative de traversal (../).
  const file = basename(c.req.param("file"));
  const path = resolve(ASSETS_DIR, file);
  // « ?l=600 » demande une largeur. Une largeur hors de la liste est ignoree
  // plutot que refusee : l'image doit s'afficher, meme mal demandee.
  const demandee = Number(c.req.query("l"));
  const largeur = (LARGEURS_SERVIES as readonly number[]).includes(demandee)
    ? demandee
    : null;
  try {
    await stat(path);
    const servi = await fichierALaTaille(path, file, largeur);
    const buf = await readFile(servi.chemin);
    const mime = servi.mime;
    return c.body(buf, 200, {
      "Content-Type": mime,
      "Cache-Control": "public, max-age=31536000, immutable",
      // Un SVG est un document : ouvert directement, un fichier piégé
      // s'exécuterait sur l'origine de l'API, là où vit le cookie admin.
      // On neutralise scripts et ressources externes, et on interdit au
      // navigateur de deviner un autre type que celui annoncé.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
      "X-Content-Type-Options": "nosniff",
    });
  } catch {
    return c.notFound();
  }
});

/**
 * Résout le contenu éditorial d'un produit dans la langue demandée.
 *
 * Le français (colonnes `name` / `description`) est la référence ET le repli :
 * une traduction absente, vide ou faite d'espaces retombe dessus. Le client
 * voit donc toujours un texte, jamais un blanc — c'est ce qui permet de
 * traduire progressivement, produit par produit.
 */
type Traduisible = {
  name: string;
  description?: string | null;
  translations?: Partial<
    Record<string, { name?: string; description?: string }>
  > | null;
};

function traduire<T extends Traduisible>(p: T, langue?: string) {
  const t = langue && langue !== "fr" ? p.translations?.[langue] : undefined;
  const utile = (v?: string | null) => (v && v.trim() ? v : undefined);
  return {
    ...p,
    name: utile(t?.name) ?? p.name,
    description: utile(t?.description) ?? p.description,
  };
}

/** Langue demandée par le client (?lang=en). Inconnue ou absente -> français. */
function langueDemandee(c: { req: { query: (k: string) => string | undefined } }) {
  const l = (c.req.query("lang") ?? "").toLowerCase();
  return ["en", "de", "it", "es"].includes(l) ? l : "fr";
}

app.get("/", (c) => c.json({ name: "memoryline-api", status: "ok" }));

app.get("/health", async (c) => {
  try {
    await sql`select 1`;
    return c.json({ status: "ok", db: "up" });
  } catch (err) {
    return c.json({ status: "error", db: "down", error: String(err) }, 503);
  }
});

/**
 * Compteurs CATALOGUE — publics (la home les affiche : « X affiches »).
 * Volontairement limités : clients, commandes et chiffre d'affaires relèvent
 * du BO et vivent sur /admin/stats.
 */
app.get("/stats", async (c) => {
  const [[products], [variants], [collections]] = await Promise.all([
    db.select({ n: count() }).from(schema.products),
    db.select({ n: count() }).from(schema.variants),
    db.select({ n: count() }).from(schema.collections),
  ]);
  return c.json({
    products: products!.n,
    variants: variants!.n,
    collections: collections!.n,
  });
});

/* -------------------------------------------------------------------------- */
/*  Chercher une affiche depuis la boutique                                   */
/* -------------------------------------------------------------------------- */

/**
 * La table de correspondance des lettres accentuées, pour `translate()`.
 *
 * Recopiée de la recherche du back-office (recherche.ts), volontairement : ce
 * fichier-là est réservé au back-office — il lit des noms de clientes, des
 * montants et des numéros de commande — et une route publique n'a rien à
 * importer de lui. La méthode, elle, est la bonne : `unaccent` demanderait un
 * `CREATE EXTENSION`, donc les droits d'administration de la base et une
 * migration de plus à ne pas oublier ; `translate()` est présent partout.
 *
 * Les majuscules accentuées figurent dans la table alors que `lower()` est
 * appliqué avant : sur une base créée avec la locale « C », `lower('É')` ne
 * rend pas « é », et « Éléonore » cesserait de se trouver en tapant
 * « eleonore ».
 */
const LETTRES_ACCENTUEES =
  "àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝŸ";
const LETTRES_PLATES =
  "aaaaaaceeeeiiiinooooouuuuyyaaaaaaceeeeiiiinooooouuuuyy";

/** Le même aplatissement, côté JavaScript, pour la saisie du visiteur. */
function aplatir(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase();
}

/**
 * Le motif `like` correspondant à une saisie.
 *
 * `%` et `_` ont un sens pour la base : cherchés tels quels, taper « 50% »
 * ramènerait le catalogue entier. Une affiche a parfaitement le droit de
 * s'appeler « Promo 50% », et la barre oblique inversée d'être tapée par
 * erreur — les trois sont donc échappées.
 */
function motifDe(saisie: string): string {
  const plat = aplatir(saisie).replace(/[\\%_]/g, (signe) => `\\${signe}`);
  return `%${plat}%`;
}

/** « cette colonne, accents et casse mis de côté, contient le motif ». */
function contient(colonne: Column, motif: string): SQL {
  return sqlOp`translate(lower(coalesce(${colonne}, '')), ${LETTRES_ACCENTUEES}, ${LETTRES_PLATES}) like ${motif}`;
}

/**
 * « le nom TRADUIT dans cette langue contient le motif ».
 *
 * Une visiteuse allemande cherche avec les mots qu'elle a sous les yeux. Le
 * nom français reste cherché en même temps : les noms de villes ne se
 * traduisent pas, et une traduction non saisie retombe déjà sur le français.
 */
function contientTraduction(langue: string, motif: string): SQL {
  return sqlOp`translate(lower(coalesce(${schema.products.translations} -> ${langue} ->> 'name', '')), ${LETTRES_ACCENTUEES}, ${LETTRES_PLATES}) like ${motif}`;
}

/* -------------------------------------------------------------------------- */
/*  Ranger un rayon                                                           */
/* -------------------------------------------------------------------------- */

/** Les tris que la boutique sait rendre. Tout le reste retombe sur le défaut. */
const TRIS = ["manuel", "nouveautes", "prix_asc", "prix_desc", "alpha"] as const;
type Tri = (typeof TRIS)[number];

/**
 * Le prix qu'une affiche AFFICHE : le plus bas de ses variantes.
 *
 * C'est ce que la vignette montre (« à partir de 23 € »), donc c'est sur lui
 * que le tri par prix doit porter — trier sur le prix de base rangerait la
 * grille dans un ordre que l'œil dément. Sans variante tarifée, le prix de
 * base reprend la main.
 */
const PRIX_AFFICHE = sqlOp`coalesce((select min(v.price_cents) from ${schema.variants} v where v.product_id = ${schema.products.id} and v.price_cents > 0), ${schema.products.basePriceCents})`;

/** Le nom, accents et casse mis de côté : « Élan » se range entre « Eau » et « Été ». */
const NOM_RANGE = sqlOp`translate(lower(${schema.products.name}), ${LETTRES_ACCENTUEES}, ${LETTRES_PLATES})`;

/**
 * La place que la propriétaire a donnée à l'affiche DANS CETTE collection.
 *
 * Elle range ses affiches au glisser-déposer dans le back-office, et cette
 * position dormait : la boutique servait l'ordre de création. Une affiche qui
 * n'est pas dans la collection demandée ne peut pas se présenter ici — le
 * filtre l'a déjà écartée — mais `nulls last` garde le tri lisible plutôt que
 * de laisser Postgres choisir.
 */
function positionDansCollection(collection: string): SQL {
  return sqlOp`(select min(pc.position) from ${schema.productCollections} pc join ${schema.collections} col on col.id = pc.collection_id where pc.product_id = ${schema.products.id} and col.slug = ${collection})`;
}

/**
 * L'ordre demandé, en clauses SQL.
 *
 * Chaque tri se termine par l'identifiant : deux affiches au même prix, au
 * même nom ou à la même position doivent se présenter dans le même ordre
 * d'une page à l'autre, sinon la pagination perd et répète des affiches.
 */
function ordreDeTri(tri: Tri, collection: string): SQL[] {
  switch (tri) {
    case "nouveautes":
      return [desc(schema.products.createdAt), desc(schema.products.id)];
    case "prix_asc":
      return [sqlOp`${PRIX_AFFICHE} asc`, asc(schema.products.id)];
    case "prix_desc":
      return [sqlOp`${PRIX_AFFICHE} desc`, asc(schema.products.id)];
    case "alpha":
      return [sqlOp`${NOM_RANGE} asc`, asc(schema.products.id)];
    case "manuel":
      // Dans une collection, l'ordre de la collection. Ailleurs — les pages
      // « Affiches personnalisables » et « prêtes à imprimer » — l'ordre
      // réglé pour le genre, et à défaut les nouveautés : tant que rien n'est
      // rangé, rien ne change pour les clientes.
      return collection
        ? [
            sqlOp`${positionDansCollection(collection)} asc nulls last`,
            asc(schema.products.id),
          ]
        : ordreManuelDuGenre();
  }
}

/**
 * Catalogue : liste de produits (avec leurs variantes A4/A3).
 *
 * Quatre paramètres facultatifs, tous portés par l'adresse pour qu'un lien
 * reste partageable :
 *
 *   - `genre` et `collection` découpent les rayons du menu ;
 *   - `q` cherche dans le nom et l'adresse de l'affiche, accents et casse mis
 *     de côté ;
 *   - `sort` range (`manuel`, `nouveautes`, `prix_asc`, `prix_desc`, `alpha`) ;
 *   - `limit` et `offset` paginent.
 *
 * Le nombre TOTAL d'affiches correspondant aux filtres part dans l'en-tête
 * `X-Total-Count`. Il ne rentre pas dans le corps, qui reste un tableau nu :
 * le stand, le plan de site et la page d'accueil le lisent tel quel, et les
 * envelopper dans un objet aurait cassé les trois pour une pagination qu'eux
 * n'utilisent pas.
 */
/**
 * La ville d'une affiche, lue dans son nom.
 *
 * La convention de la boutique : le nom commence par la ville en CAPITALES,
 * puis vient le sujet en minuscules — « AMIENS Cathédrale ciel bleu ».
 * Un mot appartient donc à la ville tant qu'il est entièrement en capitales,
 * ce qui attrape aussi « BAIE DE SOMME », « CÔTE D'OPALE » et
 * « SAINT-VALERY-SUR-SOMME » sans rien coder de particulier.
 *
 * Vérifié sur le catalogue : 176 affiches, 101 villes, aucune exception.
 * Une affiche qui ne suivrait pas la convention n'a simplement pas de ville,
 * et n'apparaît sous aucun filtre — jamais sous une mauvaise.
 */
export function villeDuNom(nom: string): string {
  const pris: string[] = [];
  for (const brut of String(nom ?? "").split(/\s+/)) {
    const mot = brut.replace(/[–—-]+$/, "");
    if (!/^[A-ZÀ-ÖØ-Þ0-9'’-]{2,}$/u.test(mot)) break;
    pris.push(mot);
  }
  return pris.join(" ");
}

/**
 * Les villes du catalogue, avec le nombre d'affiches de chacune.
 *
 * Calculées sur les noms plutôt que stockées : 176 lignes à lire, c'est
 * moins cher qu'une colonne à tenir à jour, et le résultat ne peut pas
 * contredire le nom affiché.
 *
 * L'affiche générée à partir d'une photo est écartée : elle n'est d'aucune
 * ville, et son nom commence par des capitales qui n'en sont pas une.
 *
 * La collection filtre comme sur `/products`. Sans elle, le rayon « Thèmes &
 * paysages » proposait les cent villes du catalogue, dont presque toutes
 * menaient à une grille vide : la ville « ne ressortait pas ».
 */
app.get("/villes", async (c) => {
  const genre = (c.req.query("genre") ?? "").trim();
  const filtres = [eq(schema.products.status, "active")];
  if (genre === "personnalisable" || genre === "prete_a_imprimer")
    filtres.push(eq(schema.products.kind, genre));
  const collection = (c.req.query("collection") ?? "").trim();
  if (collection)
    filtres.push(
      sqlOp`exists (select 1 from ${schema.productCollections} pc join ${schema.collections} col on col.id = pc.collection_id where pc.product_id = ${schema.products.id} and col.slug = ${collection} and col.active = true and col.archived_at is null)`,
    );
  const rows = await db
    .select({ name: schema.products.name, ai: schema.products.aiEnabled })
    .from(schema.products)
    .where(and(...filtres));

  // Regroupées sans les accents, comme le filtre les compare : « LE TREPORT »
  // et « LE TRÉPORT » sont un seul lieu, et le menu les montrait deux fois,
  // chacun avec un compte faux. On garde l'orthographe la plus fréquente.
  const groupes = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (r.ai) continue;
    const v = villeDuNom(r.name);
    if (!v) continue;
    const cle = aplatir(v);
    const graphies = groupes.get(cle) ?? new Map<string, number>();
    graphies.set(v, (graphies.get(v) ?? 0) + 1);
    groupes.set(cle, graphies);
  }
  // Par ordre alphabétique : dans une liste de cent entrées, on cherche un
  // nom, on ne parcourt pas un classement.
  const villes = [...groupes.values()]
    .map((graphies) => {
      const [[nom]] = [...graphies.entries()].sort((a, b) => b[1] - a[1]) as [
        [string, number],
      ];
      const nombre = [...graphies.values()].reduce((s, n) => s + n, 0);
      return { nom, nombre };
    })
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  return c.json(villes);
});

app.get("/products", async (c) => {
  // Plafond relevé : la boutique en demande la totalité, et le catalogue a
  // dépassé les 200 depuis longtemps — au-delà, les dernières affiches
  // créées n'apparaissaient nulle part.
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 0, 1), 1000);
  // Une page négative ou illisible vaut la première : mieux qu'une erreur sur
  // une adresse qu'un visiteur peut très bien avoir tapée à la main.
  const offset = Math.max(Math.trunc(Number(c.req.query("offset") ?? 0)) || 0, 0);
  const langue = langueDemandee(c);

  const filtres = [eq(schema.products.status, "active")];
  const genre = (c.req.query("genre") ?? "").trim();
  if (genre === "personnalisable" || genre === "prete_a_imprimer")
    filtres.push(eq(schema.products.kind, genre));
  const collection = (c.req.query("collection") ?? "").trim();
  if (collection)
    // `col.active` : une collection désactivée est retirée de la boutique, pas
    // seulement du menu. Sans cette condition, son adresse continuait d'ouvrir
    // un rayon que la propriétaire croyait fermé. Une collection archivée est
    // fermée de la même façon — et rouvre telle quelle si on la restaure.
    filtres.push(
      sqlOp`exists (select 1 from ${schema.productCollections} pc join ${schema.collections} col on col.id = pc.collection_id where pc.product_id = ${schema.products.id} and col.slug = ${collection} and col.active = true and col.archived_at is null)`,
    );

  /*
   * La ville.
   *
   * Le filtre s'applique sur la ville LUE DANS LE NOM, avec exactement la
   * règle qui a servi à dresser la liste — sans quoi les deux se
   * contrediraient. Un simple préfixe « PARIS % » ne suffisait pas : il
   * ramenait aussi « PARIS MON AMOUR » et « PARIS L'AMOUR DANS L'AIR »,
   * deux affiches prêtes à imprimer dont le titre entier est en capitales.
   * Le filtre annonçait 19 affiches et en montrait 21.
   *
   * On lit donc les noms des affiches actives — 176 lignes, une requête
   * courte — et on ne garde que celles dont la ville correspond. La
   * pagination reste faite par la base, sur une liste d'identifiants.
   */
  const ville = (c.req.query("ville") ?? "").trim();
  if (ville) {
    const candidats = await db
      .select({ id: schema.products.id, name: schema.products.name })
      .from(schema.products)
      .where(eq(schema.products.status, "active"));
    const cherchee = aplatir(ville);
    const ids = candidats
      .filter((p) => aplatir(villeDuNom(p.name)) === cherchee)
      .map((p) => p.id);
    // Aucune affiche pour cette ville : une liste d'identifiants vide ne
    // s'écrit pas en SQL, on force donc une condition fausse.
    filtres.push(ids.length ? inArray(schema.products.id, ids) : sqlOp`false`);
  }

  const saisie = (c.req.query("q") ?? "").trim();
  if (saisie) {
    const motif = motifDe(saisie);
    const surLeNom = [
      contient(schema.products.name, motif),
      contient(schema.products.slug, motif),
      ...(langue !== "fr" ? [contientTraduction(langue, motif)] : []),
    ];
    filtres.push(or(...surLeNom)!);
  }

  const tri: Tri =
    (TRIS as readonly string[]).indexOf(c.req.query("sort") ?? "") >= 0
      ? (c.req.query("sort") as Tri)
      : // Par défaut, l'ordre réglé à la main quand un rayon est demandé, et
        // l'ordre de création sinon — celui que la boutique servait déjà.
        "manuel";

  // Seuls les produits actifs sont en vente. Un brouillon est un produit
  // qu'on prépare, une archive un produit retiré : ni l'un ni l'autre n'a
  // sa place dans la boutique. Le back-office passe par /admin/products,
  // qui, lui, montre tout.
  const conditions = and(...filtres);

  // Le compte va avec la page : sans lui, la boutique ne peut ni annoncer
  // « 146 affiches » ni savoir combien de pages proposer. Les deux requêtes
  // partent ensemble — l'une derrière l'autre, la page attendrait deux fois.
  const [rows, [totalRow]] = await Promise.all([
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
      .where(conditions)
      .orderBy(...ordreDeTri(tri, collection))
      .limit(limit)
      .offset(offset),
    db.select({ n: count() }).from(schema.products).where(conditions),
  ]);
  c.header("X-Total-Count", String(totalRow?.n ?? 0));
  // Nom traduit, sans exposer le dictionnaire complet au site public.
  const products = rows.map(({ translations, ...p }) => ({
    ...p,
    name: traduire({ ...p, translations }, langue).name,
  }));
  const ids = products.map((p) => p.id);
  const variants = ids.length
    ? await db
        .select({
          productId: schema.variants.productId,
          format: schema.variants.format,
          priceCents: schema.variants.priceCents,
          /**
           * Le prix barré, saisi au back-office et jamais servi jusqu'ici : la
           * vignette ne pouvait pas montrer une remise que la boutique avait
           * bel et bien réglée. Vide pour la plupart des affiches — c'est au
           * site de n'en rien faire dans ce cas.
           */
          compareAtCents: schema.variants.compareAtCents,
        })
        .from(schema.variants)
        .where(inArray(schema.variants.productId, ids))
    : [];
  const byProduct = new Map<number, typeof variants>();
  for (const v of variants) {
    if (!byProduct.has(v.productId)) byProduct.set(v.productId, []);
    byProduct.get(v.productId)!.push(v);
  }
  // image principale (position la plus basse) par produit
  const images = ids.length
    ? await db
        .select({
          productId: schema.productImages.productId,
          url: schema.productImages.url,
          position: schema.productImages.position,
        })
        .from(schema.productImages)
        .where(inArray(schema.productImages.productId, ids))
        .orderBy(schema.productImages.position)
    : [];
  const imageByProduct = new Map<number, string>();
  for (const img of images) {
    if (!imageByProduct.has(img.productId))
      imageByProduct.set(img.productId, img.url);
  }
  return c.json(
    products.map((p) => ({
      ...p,
      image: imageByProduct.get(p.id) ?? null,
      variants: byProduct.get(p.id) ?? [],
    })),
  );
});

/** Fiche produit complète par slug (pour /affiches/[slug]). */
/**
 * Les collections qui contiennent au moins une affiche en vente.
 *
 * Une collection vide est un vestige de l'import : la proposer au menu
 * mènerait à une page blanche. Le compte sert aussi à écrire « Villes (146) »
 * si la boutique le souhaite un jour.
 *
 * Une collection DÉSACTIVÉE n'en fait pas partie non plus. La case existe au
 * back-office et n'était lue que par les pages du CMS : le menu de la boutique
 * et le filtre `?collection=` continuaient de servir un rayon que la
 * propriétaire avait fermé. Une collection ARCHIVÉE en sort pareillement — et
 * y revient entière, avec ses affiches, le jour où on la restaure.
 */
app.get("/collections", async (c) => {
  const rows = await db
    .select({
      id: schema.collections.id,
      slug: schema.collections.slug,
      name: schema.collections.name,
      position: schema.collections.position,
      produits: count(schema.productCollections.productId),
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
      schema.collections.name,
      schema.collections.position,
    )
    .orderBy(asc(schema.collections.position), asc(schema.collections.name));
  return c.json(rows.map(({ position: _p, ...r }) => r));
});

app.get("/products/:slug", async (c) => {
  const slug = c.req.param("slug");
  const rows = await db
    .select()
    .from(schema.products)
    // Même règle que pour la liste : une adresse devinée ne doit pas donner
    // accès à une affiche que la boutique a retirée de la vente.
    .where(and(eq(schema.products.slug, slug), eq(schema.products.status, "active")));
  const brut = rows[0];
  if (!brut) return c.notFound();
  const product = traduire(brut, langueDemandee(c));

  const [variants, images] = await Promise.all([
    db
      .select()
      .from(schema.variants)
      .where(eq(schema.variants.productId, product.id)),
    db
      .select()
      .from(schema.productImages)
      .where(eq(schema.productImages.productId, product.id))
      .orderBy(schema.productImages.position),
  ]);

  // Type d'affiche du produit : il porte le décor par défaut.
  const [vue] = product.defaultView
    ? await db
        .select({ foregroundUrl: schema.posterViews.foregroundUrl })
        .from(schema.posterViews)
        .where(eq(schema.posterViews.slug, product.defaultView))
    : [];

  return c.json({
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    /**
     * Ce que la boutiquière veut voir dans Google. Vides, la page retombe sur
     * le nom du produit et sur les premiers mots de sa description : c'est un
     * repli acceptable, pas un choix éditorial.
     */
    seoTitle: product.seoTitle,
    seoDescription: product.seoDescription,
    kind: product.kind,
    /**
     * Affiche tirée d'une photo du client. Ce n'est pas un autre genre de
     * produit : c'est une affiche ordinaire dont la fiche remplace le
     * configurateur par l'envoi d'une photo — d'où le drapeau à côté de
     * `kind` plutôt qu'une valeur de plus dedans.
     */
    aiEnabled: product.aiEnabled,
    basePriceCents: product.basePriceCents,
    images: images.map((i) => i.url),
    // Réglages configurateur par défaut (repris de l'ancien site, éditables BO).
    defaultTitle: product.defaultTitle,
    defaultSubtitle: product.defaultSubtitle,
    defaultLine3: product.defaultLine3,
    defaultView: product.defaultView,
    // Décor de premier plan EFFECTIF : celui du produit s'il en a un, sinon
    // celui de son type d'affiche (le muret de la vue de dos, par exemple).
    // Résolu ici, une fois : le site, le panier et le PDF n'ont plus à
    // connaître la règle.
    foregroundUrl: product.foregroundUrl ?? vue?.foregroundUrl ?? null,
    variants: variants.map((v) => ({
      format: v.format,
      priceCents: v.priceCents,
      /**
       * Le prix barré, quand la boutique en a réglé un. Il était saisi au
       * back-office, enregistré, et n'arrivait jamais au client : la fiche ne
       * pouvait pas annoncer une remise pourtant décidée. Vide reste vide — la
       * fiche n'invente pas de promotion.
       */
      compareAtCents: v.compareAtCents,
      widthMm: v.widthMm,
      heightMm: v.heightMm,
    })),
  });
});

/** Bandeau d'annonce actif (le plus prioritaire, dans sa période). */
app.get("/banner", async (c) => {
  const now = new Date();
  const banners = await db
    .select()
    .from(schema.announcementBanners)
    .where(eq(schema.announcementBanners.active, true))
    .orderBy(desc(schema.announcementBanners.priority));
  const current = banners.find(
    (b) =>
      (!b.startsAt || b.startsAt <= now) && (!b.endsAt || b.endsAt >= now),
  );
  return c.json(current ?? null);
});

/** Réglages éditables (clé -> valeur), optionnellement filtrés par groupe. */
/**
 * Réglages lisibles par le SITE — donc par n'importe qui.
 *
 * Certaines clés n'ont rien à y faire : le code d'accès du stand protège des
 * commandes sans paiement, le servir ici reviendrait à l'afficher sur la
 * porte. Tout ce qui commence par « salon. » reste réservé au back-office,
 * qui a sa propre route (GET /admin/salon). « relance. » de même : le rythme
 * auquel la boutique écrit à ses clientes et la base légale qu'elle invoque
 * la regardent, et la vitrine n'en a aucun usage.
 */
const PREFIXES_PRIVES = ["salon.", "ia.", "relance."];

/**
 * La valeur d'un réglage dans une langue.
 *
 * Une valeur est soit une CHAÎNE — la forme d'origine, toutes langues
 * confondues — soit un DICTIONNAIRE par langue. La chaîne se lit comme du
 * français : c'est ce qui permet de rendre les réglages traduisibles sans
 * réécrire une seule ligne en base.
 *
 * Le repli descend d'un cran à la fois : langue demandée, puis français.
 * Une case laissée blanche ne compte PAS comme une traduction — sans quoi
 * une visiteuse allemande lirait un titre vide au lieu du texte français.
 * C'est la règle des pages et du menu, on n'en invente pas une deuxième.
 */
export function valeurDansLaLangue(brut: unknown, langue: string): unknown {
  if (brut === null || typeof brut !== "object" || Array.isArray(brut))
    return brut;
  const dico = brut as Record<string, unknown>;
  const utile = (v: unknown) =>
    typeof v === "string" ? (v.trim() ? v : undefined) : (v ?? undefined);
  return utile(dico[langue]) ?? utile(dico.fr) ?? "";
}

app.get("/settings", async (c) => {
  const group = c.req.query("group");
  // La langue demandée par le site. Absente, on sert le français : c'est la
  // langue de référence, celle qui existe toujours.
  const langue = (c.req.query("lang") ?? "fr").slice(0, 5);
  const rows = await db.select().from(schema.settings);
  const filtered = (group ? rows.filter((r) => r.group === group) : rows).filter(
    (r) => !PREFIXES_PRIVES.some((p) => r.key.startsWith(p)),
  );
  return c.json(
    Object.fromEntries(
      filtered.map((r) => [r.key, valeurDansLaLangue(r.value, langue)]),
    ),
  );
});

/**
 * Les réglages tels que le BACK-OFFICE doit les voir : lignes entières,
 * toutes les langues, et RIEN de filtré.
 *
 * Son absence était un bug destructeur : le back-office lisait la route
 * publique, qui retire les clés « ia. », « salon. » et « relance. ». L'écran
 * de l'IA affichait donc une consigne de style vide et l'enregistrait vide
 * par-dessus la vraie. La garde /admin/* suffit à protéger cette route-ci.
 */
app.get("/admin/settings", async (c) => {
  const rows = await db
    .select()
    .from(schema.settings)
    .orderBy(asc(schema.settings.key));
  return c.json(
    rows.map((r) => ({
      key: r.key,
      label: r.label,
      group: r.group,
      value: r.value,
      updatedAt: r.updatedAt,
    })),
  );
});

/**
 * Les redirections d'anciennes adresses, pour le site.
 *
 * Publique, et sans risque : ce sont des correspondances d'adresses, la même
 * information que celle qu'un visiteur obtient en suivant le lien. C'est le
 * SITE qui redirige, parce qu'il est le seul à voir passer l'adresse
 * demandée — l'API, elle, ne reçoit jamais « /products/… ».
 */
app.get("/redirects", async (c) => {
  const rows = await db
    .select({
      fromPath: schema.redirects.fromPath,
      toPath: schema.redirects.toPath,
      code: schema.redirects.code,
    })
    .from(schema.redirects);
  return c.json(rows);
});

/** Promos actives (pour info front / calcul panier ultérieur). */
/** Cadres proposés au client (actifs uniquement), dans l'ordre du BO. */
app.get("/frames", async (c) => {
  const langue = langueDuVisiteur(c);
  const rows = await db
    .select()
    .from(schema.frames)
    // Archivé = rangé : le cadre quitte le configurateur, comme un cadre
    // décoché. Son nom reste lisible sur les commandes déjà passées.
    .where(and(eq(schema.frames.active, true), isNull(schema.frames.archivedAt)))
    .orderBy(asc(schema.frames.position));
  // Le nom — c'est-à-dire la couleur — dans la langue du visiteur (?lang=),
  // le français à défaut. Les commandes, elles, gardent le nom français.
  return c.json(
    rows.map(({ translations, ...r }) => ({
      ...r,
      name: nomTraduit(translations, langue) ?? r.name,
    })),
  );
});

/**
 * Types d'affiche actifs (« de face », « de dos », …), dans l'ordre du BO.
 * Le site s'en sert pour proposer les vues sans rien connaître de leurs noms.
 */
app.get("/views", async (c) => {
  const rows = await db
    .select()
    .from(schema.posterViews)
    // Archivé = rangé : retiré du site comme un type décoché, mais restaurable.
    .where(
      and(
        eq(schema.posterViews.active, true),
        isNull(schema.posterViews.archivedAt),
      ),
    )
    .orderBy(asc(schema.posterViews.position));
  return c.json(rows);
});

/**
 * Inscription à la lettre d'information. Publique, forcément : c'est un
 * visiteur qui la remplit. Une adresse déjà inscrite renvoie le même succès —
 * lui dire « déjà inscrite » révélerait qui est dans la liste.
 */
app.post("/newsletter", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const email = String(b.email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200)
    return c.json({ error: "adresse invalide" }, 400);
  const langue = String(b.langue ?? "").slice(0, 5) || null;
  await db
    .insert(schema.newsletterSubscribers)
    .values({ email, langue })
    .onConflictDoNothing();
  return c.json({ ok: true });
});

app.get("/admin/newsletter", async (c) => {
  const rows = await db
    .select()
    .from(schema.newsletterSubscribers)
    .orderBy(desc(schema.newsletterSubscribers.createdAt));
  return c.json(rows);
});

app.delete("/admin/newsletter/:id", async (c) => {
  await db
    .delete(schema.newsletterSubscribers)
    .where(eq(schema.newsletterSubscribers.id, Number(c.req.param("id"))));
  return c.json({ ok: true });
});

/**
 * Promotions AUTOMATIQUES, celles qui s'appliquent sans rien saisir.
 *
 * Les promotions à code en sont exclues : les exposer ici, c'était les
 * appliquer à tout le monde — et publier la liste des codes par la même
 * occasion.
 */
/**
 * Catalogue de livraison : zones, modes et tarifs. Public, parce que le
 * tunnel de commande doit afficher les frais AVANT de créer la commande.
 * Les modes désactivés n'en font pas partie.
 */
/**
 * Points relais autour d'un code postal.
 *
 * Le compte Mondial Relay n'est pas configuré ? On répond 503 avec un message
 * clair plutôt qu'une liste vide, qui se lirait « aucun point relais par ici ».
 */
app.get("/shipping/relay-points", async (c) => {
  const carrier = String(c.req.query("carrier") ?? "mondial_relay");
  if (!transporteurConfigure(carrier))
    return c.json({ error: "Recherche de points non configurée" }, 503);
  const cp = String(c.req.query("postalCode") ?? "").trim();
  if (!/^[A-Za-z0-9 -]{3,10}$/.test(cp))
    return c.json({ error: "code postal invalide" }, 400);
  const pays = String(c.req.query("country") ?? "FR");
  const ville = String(c.req.query("city") ?? "");
  // L'adresse exacte, quand le client l'a choisie dans les suggestions : les
  // points se classent alors depuis sa porte, pas depuis le centre-ville.
  // Hors des bornes du globe, on l'ignore et on s'en tient au code postal.
  const lat = Number(c.req.query("lat"));
  const lng = Number(c.req.query("lng"));
  const coordonnees =
    c.req.query("lat") && c.req.query("lng") &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180
      ? { latitude: lat, longitude: lng }
      : {};
  try {
    // SendCloud d'abord quand il sait chercher ce transporteur : c'est lui qui
    // fabriquera l'étiquette, et l'identifiant du point doit être le sien.
    const points = sendcloudGerePoints(carrier)
      ? await rechercherPointsSendcloud({
          carrier,
          codePostal: cp,
          pays,
          ville,
          ...coordonnees,
        })
      : carrier === "colissimo"
        ? await rechercherPointsRetrait({ codePostal: cp, pays, ville })
        : await rechercherPointsRelais({
            codePostal: cp,
            pays,
            ville,
            nombre: 12,
          });
    return c.json(points);
  } catch (e) {
    console.error("[points de retrait]", carrier, e);
    return c.json({ error: "recherche indisponible" }, 502);
  }
});

/**
 * Suggestions d'adresses pour la recherche de points relais (France).
 *
 * Une liste vide n'est pas une erreur — l'adresse n'existe pas, ou pas encore
 * assez tapée. Un 502 dit que le service ne répond pas : le tunnel garde alors
 * la recherche par code postal, qui ne dépend pas de lui.
 */
app.get("/shipping/adresses", async (c) => {
  try {
    return c.json(await suggererAdresses(String(c.req.query("q") ?? "")));
  } catch (e) {
    console.error("[adresses]", e);
    return c.json({ error: "suggestions indisponibles" }, 502);
  }
});

app.get("/shipping", async (c) => {
  const [zones, tousModes, tarifs, standsOuverts] = await Promise.all([
    db.select().from(schema.shippingZones).orderBy(asc(schema.shippingZones.position)),
    db
      .select()
      .from(schema.shippingMethods)
      // Archivé = rangé : le mode quitte le tunnel de commande, comme un mode
      // décoché. Il n'y a pas à choisir une livraison qu'on ne fait plus.
      .where(
        and(
          eq(schema.shippingMethods.active, true),
          isNull(schema.shippingMethods.archivedAt),
        ),
      )
      .orderBy(asc(schema.shippingMethods.position)),
    // Les tranches archivées ne facturent plus rien : les laisser entrer ici
    // remettrait un ancien prix au panier sans que rien ne le montre.
    db
      .select()
      .from(schema.shippingRates)
      .where(isNull(schema.shippingRates.archivedAt)),
    // Le CODE ne sort pas : c'est lui qui ouvre la tablette de vente.
    db
      .select({ id: schema.stands.id, nom: schema.stands.nom })
      .from(schema.stands)
      .where(eq(schema.stands.ouvert, true))
      .orderBy(asc(schema.stands.nom)),
  ]);
  // Un mode « point relais » suppose de pouvoir CHOISIR son point. Tant que
  // le compte du transporteur n'est pas branché, on ne le propose pas : une
  // adresse saisie à la main ne vaut rien pour l'expédition.
  // Un mode sans le moindre tarif ne sort pas non plus : préparé d'avance, il
  // attend son prix, et l'afficher à 0 € offrirait le port sans le vouloir.
  // Et un « retrait sur place » suppose un endroit où retirer. La règle est
  // celle de `raisonsMasquage`, la même que celle expliquée au back-office.
  const couvertures = couverturesParMode(tarifs);
  const modes = tousModes.filter(
    (m) =>
      raisonsMasquage(m, standsOuverts.length, couvertures.get(m.id) ?? SANS_TARIF)
        .length === 0,
  );
  return c.json({
    zones,
    // Les colonnes sortent une à une, JAMAIS la ligne entière : la note
    // « ce qu'il reste à faire » est écrite pour la boutique, et une réponse
    // qui recopie la ligne de base l'aurait publiée dans le tunnel de
    // commande, lisible par n'importe quel client. Une colonne ajoutée
    // demain reste dedans tant que personne ne l'a écrite ici.
    modes: modes.map((m) => ({
      id: m.id,
      slug: m.slug,
      name: m.name,
      description: m.description,
      kind: m.kind,
      carrier: m.carrier,
      pickupLocation: m.pickupLocation,
      active: m.active,
      position: m.position,
    })),
    stands: standsOuverts,
    tarifs: tarifs.map((t) => ({
      methodId: t.methodId,
      zoneId: t.zoneId,
      priceCents: t.priceCents,
      freeFromCents: t.freeFromCents,
      minWeightGrams: t.minWeightGrams,
      maxWeightGrams: t.maxWeightGrams,
      active: t.active,
    })),
  });
});

/** Idem, tout compris (modes désactivés inclus) — gestion au back-office. */
app.get("/admin/shipping", async (c) => {
  const [zones, modes, tarifs, ouverts] = await Promise.all([
    db.select().from(schema.shippingZones).orderBy(asc(schema.shippingZones.position)),
    db.select().from(schema.shippingMethods).orderBy(asc(schema.shippingMethods.position)),
    db.select().from(schema.shippingRates),
    db
      .select({ id: schema.stands.id })
      .from(schema.stands)
      .where(eq(schema.stands.ouvert, true)),
  ]);
  // Chaque mode porte TOUT ce qui l'empêche de sortir sur le site. Sans ces
  // raisons, l'écran affiche « proposé » sur un mode que personne ne voit, et
  // on cherche l'erreur ailleurs pendant une heure.
  //
  // Et il porte la même chose vue à l'endroit — `ouverture` : la liste de ce
  // qu'il reste à faire pour l'ouvrir, contrat compris, avec ce qui est déjà
  // fait. Calculée ici, et non à l'écran : c'est l'API qui sait quels comptes
  // transporteurs sont branchés.
  const couvertures = couverturesParMode(tarifs);
  const enService = transporteursEnService(modes, couvertures);
  return c.json({
    zones,
    modes: modes.map((m) => ({
      ...m,
      masqueRaisons: raisonsMasquage(
        m,
        ouverts.length,
        couvertures.get(m.id) ?? SANS_TARIF,
      ),
      ouverture: checklistOuverture(m, {
        zones,
        couverture: couvertures.get(m.id) ?? SANS_TARIF,
        standsOuverts: ouverts.length,
        transporteursEnService: enService,
      }),
    })),
    tarifs,
    transporteurs: TRANSPORTEURS,
    natures: NATURES_LIVRAISON,
    standsOuverts: ouverts.length,
  });
});

/**
 * Crée un mode de livraison.
 *
 * Le SLUG est l'identifiant technique : il voyage dans les commandes déjà
 * passées, et le changer ferait perdre le lien. Il est donc calculé une fois,
 * à la création, et jamais modifiable ensuite.
 */
app.post("/admin/shipping/methods", async (c) => {
  const b = await c.req.json();
  const nom = String(b.name ?? "").trim();
  if (!nom) return c.json({ error: "nom obligatoire" }, 400);
  const kind = CODES_NATURE.includes(String(b.kind)) ? String(b.kind) : "home";
  const carrier = String(b.carrier ?? "").trim() || null;
  if (kind === "relay" && !carrier)
    return c.json({ error: "un point relais demande un transporteur" }, 400);
  if (carrier && !TRANSPORTEURS.some((t) => t.code === carrier))
    return c.json({ error: "transporteur inconnu" }, 400);

  const base =
    nom
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "mode";
  const pris = new Set(
    (
      await db
        .select({ slug: schema.shippingMethods.slug })
        .from(schema.shippingMethods)
    ).map((r) => r.slug),
  );
  let slug = base;
  for (let i = 2; pris.has(slug); i++) slug = `${base}_${i}`;

  const [dernier] = await db
    .select({ p: schema.shippingMethods.position })
    .from(schema.shippingMethods)
    .orderBy(desc(schema.shippingMethods.position))
    .limit(1);

  const [row] = await db
    .insert(schema.shippingMethods)
    .values({
      slug,
      name: nom,
      kind,
      carrier,
      description: String(b.description ?? "").trim() || null,
      pickupLocation: String(b.pickupLocation ?? "").trim() || null,
      notePreparation: String(b.notePreparation ?? "").trim() || null,
      // Décoché au départ : un mode sans tarif afficherait 0 € de port.
      active: false,
      position: (dernier?.p ?? 0) + 1,
    })
    .returning();
  return c.json(row, 201);
});

/**
 * Archive un mode de livraison, ou le restaure.
 *
 * La suppression définitive a été RETIRÉE. Elle n'était permise que sur un
 * mode dont aucune commande n'était jamais partie — un mode qui avait servi
 * n'avait donc aucun moyen de quitter la liste — et, quand elle passait, elle
 * emportait au passage toute la grille tarifaire, en silence.
 *
 * Archivé, le mode quitte le tunnel de commande et la liste ordinaire, mais
 * sa ligne reste : les commandes déjà parties ont figé son `slug`, et c'est
 * par lui qu'elles savent encore dire comment le colis est parti. Ses tarifs
 * restent attachés, intacts, et « Restaurer » rend le mode avec sa grille.
 *
 * `commandes` dit combien sont parties avec lui, pour que l'écran le redise.
 */
app.post("/admin/shipping/methods/:id/archive", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "identifiant invalide" }, 400);
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  // Défaut : on archive. Seul un « archived: false » explicite restaure.
  const archiver = b.archived !== false;

  const [m] = await db
    .select()
    .from(schema.shippingMethods)
    .where(eq(schema.shippingMethods.id, id));
  if (!m) return c.notFound();
  const lignes = await sql`
    select count(*)::int as n from "order" where shipping_method = ${m.slug}
  `;

  const [ligne] = await db
    .update(schema.shippingMethods)
    .set({
      archivedAt: archiver ? new Date() : null,
      // Rangé et décoché d'un même geste : laisser « Proposé » sur un mode
      // archivé ferait réapparaître la livraison au premier rétablissement,
      // sans que personne l'ait redemandé.
      ...(archiver ? { active: false } : {}),
    })
    .where(eq(schema.shippingMethods.id, id))
    .returning({ archivedAt: schema.shippingMethods.archivedAt });
  if (!ligne) return c.notFound();

  return c.json({
    ok: true,
    archived: ligne.archivedAt != null,
    commandes: Number(lignes[0]?.n ?? 0),
  });
});

/**
 * Remet les modes dans l'ordre voulu, d'après la liste d'identifiants reçue.
 *
 * L'écran envoie l'ordre ENTIER plutôt qu'un « monte d'un cran » : les
 * positions en base ont le droit d'être égales (deux modes à 1, c'est le cas
 * aujourd'hui), et un échange deux à deux n'aurait alors rien échangé du
 * tout. Renuméroter de 0 à n remet la liste d'aplomb du même geste.
 *
 * Les modes absents de la liste — les archivés, notamment — gardent leur
 * position : ils ne figurent pas dans la liste ordinaire, il n'y a pas
 * d'ordre à leur imposer.
 */
app.post("/admin/shipping/methods/ordre", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const ids = (Array.isArray(b.ids) ? b.ids : [])
    .map((v: unknown) => Number(v))
    .filter((n: number) => Number.isFinite(n));
  if (!ids.length) return c.json({ error: "aucun mode à ranger" }, 400);
  await db.transaction(async (tx) => {
    for (const [i, id] of ids.entries())
      await tx
        .update(schema.shippingMethods)
        .set({ position: i })
        .where(eq(schema.shippingMethods.id, id));
  });
  return c.json({ ok: true, count: ids.length });
});

/**
 * Modifie un mode de livraison : nom, texte, transporteur, emplacement de
 * retrait, note de préparation, actif.
 *
 * Le SLUG et la NATURE ne bougent pas. Le slug voyage dans les commandes déjà
 * parties. La nature, elle, décide de ce qu'on demande au client — passer un
 * mode « à domicile » en « point relais » laisserait des commandes avec une
 * adresse et sans point de retrait, et personne ne saurait plus où livrer.
 * Se tromper de nature se répare en créant l'autre mode et en archivant
 * celui-ci : rien n'est perdu.
 */
app.post("/admin/shipping/methods/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json();
  const [avant] = await db
    .select()
    .from(schema.shippingMethods)
    .where(eq(schema.shippingMethods.id, id));
  if (!avant) return c.notFound();

  const set: Record<string, unknown> = {};
  if (b.name !== undefined) set.name = String(b.name).trim() || "Livraison";
  if (b.description !== undefined)
    set.description = String(b.description).trim() || null;
  if (b.pickupLocation !== undefined)
    set.pickupLocation = String(b.pickupLocation).trim() || null;
  if (b.notePreparation !== undefined)
    set.notePreparation = String(b.notePreparation).trim() || null;
  if (b.carrier !== undefined) {
    const carrier = String(b.carrier).trim() || null;
    if (carrier && !TRANSPORTEURS.some((t) => t.code === carrier))
      return c.json({ error: "transporteur inconnu" }, 400);
    // Un point relais sans transporteur n'a personne à qui demander sa liste
    // de points : le mode disparaîtrait du site sans qu'on ait rien décoché.
    if (!carrier && avant.kind === "relay")
      return c.json(
        { error: "un point relais demande un transporteur" },
        400,
      );
    set.carrier = carrier;
  }
  if (b.active !== undefined) set.active = b.active !== false;
  if (b.position !== undefined) set.position = Number(b.position) || 0;
  const [row] = await db
    .update(schema.shippingMethods)
    .set(set)
    .where(eq(schema.shippingMethods.id, id))
    .returning();
  if (!row) return c.notFound();
  return c.json(row);
});

/** Montant en centimes, ou null quand le champ est laissé vide. */
function centimesOuNull(v: unknown): number | null {
  if (v === null || v === "" || v === undefined) return null;
  return Math.max(0, Math.round(Number(v)));
}

/**
 * Bornes d'une tranche de poids, en grammes : de `min` inclus à `max` exclu.
 * Null en haut = pas de limite. Renvoie un message quand la tranche n'a pas
 * de sens — une borne haute sous la borne basse ne facturerait jamais rien.
 */
function trancheLue(
  brut: { minWeightGrams?: unknown; maxWeightGrams?: unknown },
): { min: number; max: number | null } | string {
  const min = Math.round(Number(brut.minWeightGrams ?? 0));
  if (!Number.isFinite(min) || min < 0) return "poids minimum invalide";
  const brutMax = brut.maxWeightGrams;
  if (brutMax === null || brutMax === "" || brutMax === undefined)
    return { min, max: null };
  const max = Math.round(Number(brutMax));
  if (!Number.isFinite(max) || max <= min)
    return "le poids maximum doit dépasser le poids minimum";
  return { min, max };
}

/**
 * Modifie un tarif (prix, franchise de port, tranche de poids, disponibilité).
 *
 * L'unicité porte sur (mode, zone, poids minimum) : réenvoyer une tranche
 * déjà connue la met à jour, en poser une nouvelle l'ajoute à la grille.
 */
app.post("/admin/shipping/rates", async (c) => {
  const b = await c.req.json();
  const methodId = Number(b.methodId);
  const zoneId = Number(b.zoneId);
  if (!Number.isFinite(methodId) || !Number.isFinite(zoneId))
    return c.json({ error: "mode et zone requis" }, 400);
  const tranche = trancheLue(b);
  if (typeof tranche === "string") return c.json({ error: tranche }, 400);
  const valeurs = {
    priceCents: Math.max(0, Math.round(Number(b.priceCents ?? 0))),
    freeFromCents: centimesOuNull(b.freeFromCents),
    minWeightGrams: tranche.min,
    maxWeightGrams: tranche.max,
    active: b.active !== false,
  };
  // L'identifiant explicite l'emporte : il permet de DÉPLACER la borne basse
  // d'une tranche existante, ce que la recherche par (mode, zone, poids) ne
  // saurait pas faire — elle en créerait une seconde à côté.
  const [existant] = b.id
    ? await db
        .select({ id: schema.shippingRates.id })
        .from(schema.shippingRates)
        .where(eq(schema.shippingRates.id, Number(b.id)))
    : await db
        .select({ id: schema.shippingRates.id })
        .from(schema.shippingRates)
        .where(
          and(
            eq(schema.shippingRates.methodId, methodId),
            eq(schema.shippingRates.zoneId, zoneId),
            eq(schema.shippingRates.minWeightGrams, tranche.min),
            // Une tranche ARCHIVÉE ne se laisse pas retrouver ainsi : saisir
            // ce poids poserait une tranche neuve, comme on s'y attend, au
            // lieu de réécrire par-dessus une ligne rangée qui resterait
            // invisible, et le prix saisi n'apparaîtrait nulle part.
            isNull(schema.shippingRates.archivedAt),
          ),
        );
  if (existant) {
    const [row] = await db
      .update(schema.shippingRates)
      .set({ methodId, zoneId, ...valeurs })
      .where(eq(schema.shippingRates.id, existant.id))
      .returning();
    return c.json(row);
  }
  const [row] = await db
    .insert(schema.shippingRates)
    .values({ methodId, zoneId, ...valeurs })
    .returning();
  return c.json(row);
});

/**
 * Archive une tranche de la grille, ou la restaure.
 *
 * Elle était effacée. Une tranche, c'est un prix négocié avec un
 * transporteur, une borne de poids et une franchise de port : rien de tout
 * cela ne vit ailleurs, et un clic de trop le redemandait à la main.
 *
 * Archivée, elle ne facture plus rien et sort de la grille ; sa borne basse
 * redevient libre pour une nouvelle tranche (l'unicité ne porte que sur les
 * tranches vivantes, voir le schéma). D'où le refus de restaurer quand une
 * autre tranche a repris cette borne depuis : deux prix pour le même poids,
 * c'est la base qui trancherait, au hasard.
 */
app.post("/admin/shipping/rates/:id/archive", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "identifiant invalide" }, 400);
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  // Défaut : on archive. Seul un « archived: false » explicite restaure.
  const archiver = b.archived !== false;

  const [tranche] = await db
    .select()
    .from(schema.shippingRates)
    .where(eq(schema.shippingRates.id, id));
  if (!tranche) return c.notFound();

  if (!archiver) {
    const [occupee] = await db
      .select({ id: schema.shippingRates.id })
      .from(schema.shippingRates)
      .where(
        and(
          eq(schema.shippingRates.methodId, tranche.methodId),
          eq(schema.shippingRates.zoneId, tranche.zoneId),
          eq(schema.shippingRates.minWeightGrams, tranche.minWeightGrams),
          isNull(schema.shippingRates.archivedAt),
        ),
      );
    if (occupee)
      return c.json(
        {
          error: `Une tranche couvre déjà ce poids dans cette zone : restaurer celle-ci en poserait deux au même endroit. Retirez l'autre d'abord, ou saisissez ce prix dans la grille.`,
        },
        409,
      );
  }

  const [ligne] = await db
    .update(schema.shippingRates)
    .set({ archivedAt: archiver ? new Date() : null })
    .where(eq(schema.shippingRates.id, id))
    .returning({ archivedAt: schema.shippingRates.archivedAt });
  if (!ligne) return c.notFound();
  return c.json({ ok: true, archived: ligne.archivedAt != null });
});

/**
 * Enregistre TOUTE la grille tarifaire d'un mode dans une zone.
 *
 * L'écran envoie la grille entière, jamais une tranche isolée : c'est la
 * seule façon de vérifier d'un bloc qu'elle se tient — les bornes s'enchaînent
 * et se répondent, une tranche seule ne dit rien. Ce qui n'y figure plus
 * cesse de facturer, sans rien perdre : le détail est plus bas, au moment de
 * l'écrire.
 *
 * Une grille est refusée si elle laisse un trou ou si deux tranches se
 * chevauchent : un trou, c'est un colis d'un certain poids que plus personne
 * ne sait livrer, et mieux vaut l'apprendre à la saisie qu'au moment où un
 * client ne peut plus commander. Une grille VIDE reste permise : elle dit que
 * le mode ne dessert pas cette zone.
 */
app.post("/admin/shipping/rates/grille", async (c) => {
  const b = await c.req.json();
  const methodId = Number(b.methodId);
  const zoneId = Number(b.zoneId);
  if (!Number.isFinite(methodId) || !Number.isFinite(zoneId))
    return c.json({ error: "mode et zone requis" }, 400);
  const freeFromCents = centimesOuNull(b.freeFromCents);
  const brutes = Array.isArray(b.tranches) ? b.tranches : [];

  const tranches: { min: number; max: number | null; priceCents: number }[] = [];
  for (const brute of brutes) {
    const bornes = trancheLue(brute);
    if (typeof bornes === "string") return c.json({ error: bornes }, 400);
    tranches.push({
      ...bornes,
      priceCents: Math.max(0, Math.round(Number(brute.priceCents ?? 0))),
    });
  }
  tranches.sort((a, z) => a.min - z.min);

  for (const [i, t] of tranches.entries()) {
    const attendu = i === 0 ? 0 : tranches[i - 1]!.max;
    if (attendu === null)
      return c.json(
        { error: "une tranche sans limite haute doit être la dernière" },
        400,
      );
    if (t.min !== attendu)
      return c.json(
        {
          error:
            t.min > attendu
              ? `trou dans la grille : rien ne couvre ${formaterPoids(attendu)} à ${formaterPoids(t.min)}`
              : `tranches qui se chevauchent à partir de ${formaterPoids(t.min)}`,
        },
        400,
      );
  }

  /*
   * La grille se réécrit SANS rien détruire.
   *
   * Elle partait autrefois d'une table rase : toutes les tranches du couple
   * (mode, zone) effacées, puis réinsérées. C'était la seule façon, depuis cet
   * écran, de perdre un prix négocié — retirer une ligne de la grille et
   * enregistrer l'effaçait pour de bon.
   *
   * On compare donc tranche à tranche, par leur borne basse, qui est ce qui
   * les identifie :
   *   - une borne déjà là est MISE À JOUR sur place (son identifiant ne
   *     bouge pas, et la ligne archivée qui lui correspondrait ailleurs n'est
   *     pas touchée) ;
   *   - une borne nouvelle est AJOUTÉE ;
   *   - une borne qui disparaît de l'écran est ARCHIVÉE, jamais effacée. Elle
   *     cesse aussitôt de facturer et se retrouve dans « Tranches archivées ».
   *
   * Conséquence voulue : réenregistrer une grille inchangée n'archive rien.
   * Archiver à chaque enregistrement aurait rempli la vue des archivées d'une
   * copie par clic, et ce qu'on y cherche serait devenu introuvable.
   */
  const count = await db.transaction(async (tx) => {
    const vivantes = await tx
      .select({
        id: schema.shippingRates.id,
        minWeightGrams: schema.shippingRates.minWeightGrams,
      })
      .from(schema.shippingRates)
      .where(
        and(
          eq(schema.shippingRates.methodId, methodId),
          eq(schema.shippingRates.zoneId, zoneId),
          isNull(schema.shippingRates.archivedAt),
        ),
      );
    const parBorne = new Map(vivantes.map((v) => [v.minWeightGrams, v.id]));
    const gardees = new Set(tranches.map((t) => t.min));

    // Les disparues d'abord : leur borne redevient libre AVANT qu'une
    // nouvelle tranche ne vienne éventuellement l'occuper.
    const aArchiver = vivantes
      .filter((v) => !gardees.has(v.minWeightGrams))
      .map((v) => v.id);
    if (aArchiver.length)
      await tx
        .update(schema.shippingRates)
        .set({ archivedAt: new Date() })
        .where(inArray(schema.shippingRates.id, aArchiver));

    for (const t of tranches) {
      const valeurs = {
        methodId,
        zoneId,
        priceCents: t.priceCents,
        freeFromCents,
        minWeightGrams: t.min,
        maxWeightGrams: t.max,
        active: true,
      };
      const existante = parBorne.get(t.min);
      if (existante !== undefined)
        await tx
          .update(schema.shippingRates)
          .set(valeurs)
          .where(eq(schema.shippingRates.id, existante));
      else await tx.insert(schema.shippingRates).values(valeurs);
    }
    return tranches.length;
  });
  return c.json({ ok: true, count });
});

/**
 * Bornes de poids HABITUELLES de Colissimo et Mondial Relay, sans prix.
 *
 * C'est une aide à la saisie, pas une vérité contractuelle : les transporteurs
 * n'exposent aucune API de tarifs, et les paliers négociés par la cliente
 * peuvent différer. Elle doit confronter ces bornes à sa propre grille avant
 * de les remplir — seuls ses prix à elle font foi.
 */
app.get("/admin/shipping/tranches-standard", (c) => {
  const bornes = (paliers: (number | null)[]) => {
    const tranches: {
      minWeightGrams: number;
      maxWeightGrams: number | null;
      label: string;
    }[] = [];
    let min = 0;
    for (const max of paliers) {
      tranches.push({
        minWeightGrams: min,
        maxWeightGrams: max,
        label:
          max === null
            ? `plus de ${formaterPoids(min)}`
            : min === 0
              ? `jusqu'à ${formaterPoids(max)}`
              : `${formaterPoids(min)} à ${formaterPoids(max)}`,
      });
      if (max === null) break;
      min = max;
    }
    return tranches;
  };
  return c.json({
    colissimo: bornes([
      250, 500, 750, 1000, 2000, 5000, 10000, 15000, 30000,
    ]),
    mondial_relay: bornes([
      500, 1000, 2000, 3000, 5000, 7000, 10000, 15000, 20000, 25000, 30000,
    ]),
  });
});

/** Modifie une zone : son nom et la liste des pays qu'elle couvre. */
app.post("/admin/shipping/zones/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json();
  const set: Record<string, unknown> = {};
  if (b.name !== undefined) set.name = String(b.name).trim() || "Zone";
  if (b.countries !== undefined) {
    // Codes ISO à deux lettres, en majuscules, sans doublon : c'est ce que
    // compare `zonePourPays`.
    const propres = [
      ...new Set(
        (Array.isArray(b.countries) ? b.countries : String(b.countries).split(/[\s,;]+/))
          .map((v: unknown) => String(v).trim().toUpperCase())
          .filter((v: string) => /^[A-Z]{2}$/.test(v)),
      ),
    ];
    set.countries = propres;
  }
  if (b.position !== undefined) set.position = Number(b.position) || 0;
  const [row] = await db
    .update(schema.shippingZones)
    .set(set)
    .where(eq(schema.shippingZones.id, id))
    .returning();
  if (!row) return c.notFound();
  return c.json(row);
});

app.get("/promos", async (c) => {
  const now = new Date();
  const rows = await db
    .select()
    .from(schema.promoRules)
    .where(eq(schema.promoRules.active, true))
    .orderBy(desc(schema.promoRules.priority));
  const active = rows.filter(
    (r) =>
      !r.code &&
      (!r.startsAt || r.startsAt <= now) &&
      (!r.endsAt || r.endsAt >= now),
  );
  return c.json(active);
});

/**
 * Vérifie un code promo saisi au panier.
 *
 * Réponse volontairement avare : la règle qui s'applique, rien de plus. On ne
 * dit jamais qu'un code existe mais est expiré ou désactivé — ce serait aider
 * à deviner les autres.
 */
app.post("/promos/verifier", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const code = normaliserCode(b.code);
  if (!code || code.length > 60)
    return c.json({ error: "code inconnu" }, 404);
  const now = new Date();
  const [regle] = await db
    .select()
    .from(schema.promoRules)
    .where(
      and(
        eq(schema.promoRules.active, true),
        sqlOp`upper(${schema.promoRules.code}) = ${code}`,
      ),
    );
  if (
    !regle ||
    (regle.startsAt && regle.startsAt > now) ||
    (regle.endsAt && regle.endsAt < now)
  )
    return c.json({ error: "code inconnu" }, 404);
  return c.json({
    code,
    name: regle.name,
    type: regle.type,
    config: regle.config,
    priority: regle.priority,
  });
});

// === Authentification back-office ========================================

/**
 * Anti-bruteforce du login : au-delà de LOGIN_MAX_ATTEMPTS échecs par IP dans
 * la fenêtre, on répond 429. En mémoire (un seul process API) — suffisant ici,
 * et sans dépendance supplémentaire, comme le reste du module d'auth.
 */
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
/**
 * La requête est-elle arrivée en HTTPS ?
 *
 * Même raisonnement que pour le cookie client : on regarde l'hôte appelé et
 * l'adresse publique annoncée, puis l'en-tête du proxy. Une variable
 * d'environnement ne dit rien de la requête en cours.
 */
function requeteEnHttps(c: Context): boolean {
  const hote = (c.req.header("host") ?? "").toLowerCase();
  const publique = (process.env.PUBLIC_ORIGIN ?? "").toLowerCase();
  if (hote && publique.startsWith("https://") && publique.endsWith(hote))
    return true;
  const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  return proto === "https" || c.req.url.startsWith("https://");
}

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

/**
 * L'adresse d'où vient l'appel, telle qu'on peut la croire.
 *
 * Le proxy AJOUTE son entrée à « X-Forwarded-For » sans effacer celle qui
 * arrive : le PREMIER élément est donc écrit par l'appelant, qui peut le
 * changer à chaque requête. Un compteur d'essais fondé dessus ne se déclenche
 * jamais, et un mot de passe se devine indéfiniment.
 *
 * Le dernier élément, lui, a été posé par notre propre proxy. C'est le seul
 * qu'on ne puisse pas écrire soi-même.
 */
function clientIp(c: { req: { header: (k: string) => string | undefined } }) {
  const chaine = c.req.header("x-forwarded-for");
  if (chaine) {
    const morceaux = chaine
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    const dernier = morceaux[morceaux.length - 1];
    if (dernier) return dernier;
  }
  return c.req.header("x-real-ip") || "local";
}

function loginRateLimited(key: string): boolean {
  const cur = loginAttempts.get(key);
  return Boolean(cur && cur.resetAt > Date.now() && cur.count >= LOGIN_MAX_ATTEMPTS);
}

function noteFailedLogin(key: string): void {
  const now = Date.now();
  // Purge opportuniste : la table ne doit pas croître indéfiniment.
  if (loginAttempts.size > 500)
    for (const [k, v] of loginAttempts) if (v.resetAt < now) loginAttempts.delete(k);
  const cur = loginAttempts.get(key);
  if (!cur || cur.resetAt < now)
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  else cur.count += 1;
}

app.post("/auth/login", async (c) => {
  const ip = clientIp(c);
  if (loginRateLimited(ip))
    return c.json({ error: "Trop de tentatives, réessayez plus tard" }, 429);
  const { email, password } = await c.req.json();
  await purgeExpiredSessions();
  const rows = await db
    .select()
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.email, String(email ?? "").toLowerCase()));
  const user = rows[0];
  // verifyPassword sur un hash factice si user absent -> évite l'oracle de timing
  const ok =
    user && (await verifyPassword(String(password ?? ""), user.passwordHash));
  if (!user || !ok) {
    noteFailedLogin(ip);
    return c.json({ error: "Identifiants invalides" }, 401);
  }
  // Un compte archivé n'entre plus. Le contrôle vient APRÈS la vérification
  // du mot de passe, exprès : il ne se déclenche que pour qui le connaissait
  // déjà, et ne dit donc à personne d'autre que cette adresse a un compte.
  if (user.archivedAt) {
    noteFailedLogin(ip);
    return c.json(
      {
        error:
          "Ce compte est archivé : il ne donne plus accès au back-office. La propriétaire peut le restaurer depuis « Comptes ».",
      },
      403,
    );
  }
  loginAttempts.delete(ip);
  const token = await createSession(user.id);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    // La vraie requête décide, pas une variable d'environnement : NODE_ENV
    // n'est défini nulle part, et le cookie du back-office partait donc sans
    // « Secure » y compris derrière le tunnel en HTTPS.
    secure: requeteEnHttps(c),
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return c.json({ id: user.id, email: user.email, role: user.role });
});

app.post("/auth/logout", async (c) => {
  await deleteSession(getCookie(c, SESSION_COOKIE));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

app.get("/auth/me", async (c) => {
  const user = await validateSession(getCookie(c, SESSION_COOKIE));
  if (!user) return c.json({ user: null }, 401);
  return c.json({ user: { email: user.email, role: user.role } });
});


// Routes configurateur / panier / commandes web / PDF / CRUD personnages.
// Montées ici : les routes /admin/* qu'elles déclarent passent par le
// middleware d'auth ci-dessus ; les routes publiques (/characters, /cart…)
// ne sont pas concernées.
// Commandes AVANT le configurateur : celui-ci déclare « /admin/orders/:id »,
// qui avalerait sinon « /admin/orders/tags » et « /admin/orders/export.csv ».
// Hono retient la première route déclarée qui correspond.
mountOrderRoutes(app);

// Bordereaux transporteur achetés chez SendCloud (apps/api/src/sendcloud-colis.ts).
mountBordereaux(app);

// Proposition de traduction automatique pour le back-office (traductions.ts).
mountTraduction(app);

// Catégories de produits et poids d'expédition (apps/api/src/catalogue.ts).
mountCatalogueRoutes(app);

// Liste des produits vue du back-office et actions groupées. AVANT le
// configurateur, qui déclare « /admin/products/:id/... » : une route
// paramétrée posée d'abord avalerait « /admin/products/bulk » et
// « /admin/products/masse ».
mountProduitsMasse(app);

// Ce qu'une affiche a rapporté, pour sa fiche produit.
mountVentesProduit(app);

// La fiche produit complète du back-office : contenu, médias, formats et
// tarifs, stock, référencement. Un seul aller-retour pour lire, un seul pour
// enregistrer, là où la page interrogeait quatre routes différentes.
mountFicheProduit(app);

// Les collections : la façon dont la boutique range ses affiches, et le poids
// par défaut de ce qu'elles contiennent.
mountCollections(app);

// Import de fiches produit par fichier, et l'image qu'on dépose ensuite sur
// chacune. Après les collections : l'import y range les affiches.
mountImportProduits(app);

// Cartes cadeaux : de l'argent encaissé d'avance, avec son journal et sa
// carte imprimable.
mountCartesCadeaux(app);

// Lettre d'information : l'écrire, l'envoyer par paquets, et le lien de
// désabonnement qui doit fonctionner sans être connecté.
mountLettre(app);

// Finances : les quatre sources d'argent côte à côte, et ce qui ne se
// recoupe pas. Réservé à la propriétaire, la route le revérifie elle-même.
mountFinances(app);

// Recherche globale : le champ en tête du back-office. Réservée à la
// propriétaire, et elle ne lit jamais le code d'accès d'un stand.
mountRecherche(app);

// Les décors des affiches, vus tous ensemble : ce que le configurateur
// propose, et ce qu'il devine quand une affiche n'a rien à elle.
mountDecors(app);
mountApercus(app);

// Les couleurs des dessins téléversés, qu'ils sortent d'Illustrator, de Canva
// ou d'une vectorisation d'image IA : zones recolorables et nuances groupées.
mountCouleursDessins(app);

// Pages libres et menu du site, écrits depuis le back-office. Ouvrir un rayon
// « Magnets » ne demande plus de toucher au code.
mountCms(app);

// Banc d'essai des courriers : les voir et s'en envoyer un, sans attendre
// qu'une commande passe.
mountCourriers(app);

// Tout ce qui est archivé, relu d'un coup. Lecture seule : on restaure par la
// route d'archivage de chaque nature, la seule qui en connaisse les règles.
mountArchives(app);

// Relance des paniers abandonnés : les trois critères d'abandon, les cinq
// garde-fous, le travailleur d'envoi, le lien de récupération et le refus.
// AVANT le configurateur, qui déclare « /cart/:cartId » et « /admin/... » :
// une route paramétrée posée d'abord avalerait celles-ci.
mountRelancePanier(app);

// Commandes prises au stand : pas de prix a l'ecran, pas de paiement en ligne.
mountSalonRoutes(app);

// Comptes clients : /compte/* pour la boutique, /admin/customers/* pour le BO.
// Aucune route paramétrée déjà déclarée ne les avale (les /admin/* posées
// avant portent sur /admin/orders et /admin/fulfillments).
mountCompteRoutes(app);

mountConfiguratorRoutes(app);

// Affiches générées par IA (apps/api/src/ia.ts) : envoi de la photo, aperçu
// filigrané, back-office. Monté APRÈS les autres : « /admin/products/:id/ia »
// ne doit pas être avalé par une route paramétrée déclarée plus haut.
mountIaRoutes(app);
// La photo du client, de son téléphone à la tablette du stand
// (apps/api/src/ia-relais.ts). Routes publiques /ia/relais*, aucune /admin.
mountRelaisPhotoRoutes(app);
mountAnalytiqueRoutes(app);
mountOrdreAffichageRoutes(app);

// Formulaire de contact du site (apps/api/src/contact.ts) : une seule route
// publique, « POST /contact », qui n'écrit rien en base et se contente
// d'envoyer deux courriers. Montée en dernier : elle ne réclame aucune
// priorité et n'a donc pas à se glisser devant quoi que ce soit.
mountContact(app);

/**
 * Marque une commande traitée, ou revient en arrière.
 *
 * « Traitée » veut dire : imprimée, emballée, partie. C'est l'information qui
 * manque le matin pour savoir quoi préparer — le statut de paiement, lui, ne
 * dit rien de ce travail-là.
 */
app.post("/admin/orders/:id/fulfil", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json().catch(() => ({}));
  const traite = b.fulfilled !== false;
  const [row] = await db
    .update(schema.orders)
    .set({ fulfilledAt: traite ? new Date() : null })
    .where(eq(schema.orders.id, id))
    .returning({ id: schema.orders.id, fulfilledAt: schema.orders.fulfilledAt });
  if (!row) return c.notFound();
  // Le journal garde la trace : dans un mois, on saura quand c'est parti.
  await db.insert(schema.orderEvents).values({
    orderId: id,
    kind: "event",
    message: traite
      ? "Commande marquée comme traitée."
      : "Commande remise dans les commandes à traiter.",
  });
  return c.json(row);
});

/** Compteurs complets (catalogue + clients + commandes) — tableau de bord BO. */
app.get("/admin/stats", async (c) => {
  const [[products], [variants], [collections], [customers], [orders], [items]] =
    await Promise.all([
      db.select({ n: count() }).from(schema.products),
      db.select({ n: count() }).from(schema.variants),
      db.select({ n: count() }).from(schema.collections),
      db.select({ n: count() }).from(schema.customers),
      db.select({ n: count() }).from(schema.orders),
      db.select({ n: count() }).from(schema.orderItems),
    ]);
  const byChannel = await db
    .select({ channel: schema.orders.channel, n: count() })
    .from(schema.orders)
    .groupBy(schema.orders.channel);
  return c.json({
    products: products!.n,
    variants: variants!.n,
    collections: collections!.n,
    customers: customers!.n,
    orders: orders!.n,
    orderItems: items!.n,
    ordersByChannel: Object.fromEntries(byChannel.map((r) => [r.channel, r.n])),
  });
});

/**
 * Téléverse un visuel dans data/assets et renvoie son URL publique.
 *
 * Réservé au propriétaire (comme toute écriture /admin/*). Le nom est
 * reconstruit à partir de zéro — jamais celui du client — et l'extension doit
 * figurer dans la liste blanche : c'est ce fichier qui sera ensuite servi par
 * /assets/:file, et rasterisé dans le PDF d'impression.
 */
const UPLOAD_EXT = new Set([".svg", ".png", ".jpg", ".jpeg", ".webp"]);
const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

app.post("/admin/uploads", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) {
    return c.json({ error: "aucun fichier reçu" }, 400);
  }
  if (file.size > UPLOAD_MAX_BYTES) {
    return c.json(
      { error: `fichier trop lourd (max ${UPLOAD_MAX_BYTES / 1048576} Mo)` },
      413,
    );
  }
  const ext = extname(file.name).toLowerCase();
  if (!UPLOAD_EXT.has(ext)) {
    return c.json(
      { error: `extension refusée (acceptées : ${[...UPLOAD_EXT].join(", ")})` },
      415,
    );
  }

  // Nom sûr : on repart du nom d'origine réduit à [a-z0-9-], puis on suffixe
  // pour ne jamais écraser un visuel existant.
  const base =
    basename(file.name, extname(file.name))
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "visuel";
  const suffixe = randomBytes(4).toString("hex");
  const nom = `${base}-${suffixe}${ext}`;

  await writeFile(resolve(ASSETS_DIR, nom), Buffer.from(await file.arrayBuffer()));
  return c.json({ url: `/assets/${nom}`, name: nom, size: file.size });
});

/**
 * Analyse un SVG fraîchement téléversé : ses zones de couleur et le bas réel
 * de son dessin.
 *
 * Ces deux valeurs étaient calculées par des scripts lancés à la main lors de
 * l'import. Sans elles, créer un personnage au back-office demandait de taper
 * « st0 », « st1 »… à l'aveugle et de régler le calage vertical par essais
 * successifs. Le formulaire les remplit maintenant tout seul.
 */
app.post("/admin/svg/analyse", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const brut = String(b.url ?? "").trim();
  if (!brut) return c.json({ error: "url requise" }, 400);
  // On ne lit que dans le dossier des assets : une URL bricolée ne doit pas
  // pouvoir faire lire un fichier quelconque du serveur.
  const nom = basename(brut.split("?")[0] ?? "");
  if (!nom) return c.json({ error: "url invalide" }, 400);
  const chemin = resolve(ASSETS_DIR, nom);
  if (!chemin.startsWith(resolve(ASSETS_DIR)))
    return c.json({ error: "url invalide" }, 400);

  let contenu: Buffer;
  try {
    contenu = await readFile(chemin);
  } catch {
    return c.json({ error: "fichier introuvable" }, 404);
  }

  // Zones recolorables : les classes « .stN{fill:#…} » du SVG.
  const colorZones: Record<string, string> = {};
  if (extname(nom).toLowerCase() === ".svg") {
    const texte = contenu.toString("utf8");
    const re = /\.(st\d+)\s*\{\s*fill\s*:\s*(#[0-9a-fA-F]{3,8})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(texte)) !== null) colorZones[m[1]!] = m[2]!.toUpperCase();
  }

  // Où le dessin se trouve VRAIMENT dans son cadre. Deux usages :
  //  - `bottomPct`, le bas du contenu, pour aligner les pieds sur le muret
  //    (les animaux et les bébés ont du vide sous eux et « flotteraient ») ;
  //  - `bbox`, le rectangle occupé, pour dessiner autour d'une pièce la
  //    poignée de redimensionnement du back-office. Sans lui, il faudrait
  //    encadrer tout le cadre 500×1000 — une boîte immense autour d'une
  //    casquette.
  let bottomPct: number | null = null;
  let bbox: { left: number; top: number; right: number; bottom: number } | null =
    null;
  try {
    const H = 400;
    const { data, info } = await sharp(contenu, { density: 120, unlimited: true })
      .resize(200, H, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const W = info.width;
    let bas = -1;
    let haut = H;
    let gauche = W;
    let droite = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (data[(y * W + x) * info.channels + 3]! <= 20) continue;
        if (y < haut) haut = y;
        if (y > bas) bas = y;
        if (x < gauche) gauche = x;
        if (x > droite) droite = x;
      }
    }
    if (bas >= 0) {
      bottomPct = Number(Math.min(1, Math.max(0.05, bas / H)).toFixed(4));
      // Fractions du cadre : le back-office les multiplie par la taille de sa
      // scène, quelle qu'elle soit.
      bbox = {
        left: Number((gauche / W).toFixed(4)),
        top: Number((haut / H).toFixed(4)),
        right: Number(((droite + 1) / W).toFixed(4)),
        bottom: Number(((bas + 1) / H).toFixed(4)),
      };
    }
  } catch {
    // Rasterisation impossible : on rend les zones sans le calage, plutôt que
    // de faire échouer tout le formulaire.
  }

  return c.json({ url: `/assets/${nom}`, colorZones, bottomPct, bbox });
});

/**
 * Traductions d'un produit, telles que saisies (sans repli) : le back-office
 * doit distinguer « traduit à l'identique » de « pas encore traduit ».
 */
app.get("/admin/products/:id/translations", async (c) => {
  const id = Number(c.req.param("id"));
  const [p] = await db
    .select({
      id: schema.products.id,
      name: schema.products.name,
      description: schema.products.description,
      translations: schema.products.translations,
    })
    .from(schema.products)
    .where(eq(schema.products.id, id));
  if (!p) return c.notFound();
  return c.json({
    id: p.id,
    // Le français de référence, pour l'afficher en regard des champs.
    fr: { name: p.name, description: p.description },
    translations: p.translations ?? {},
  });
});

/**
 * Enregistre les traductions d'UNE langue. Un champ vidé est retiré du
 * dictionnaire plutôt que stocké vide : « vide » et « absent » doivent
 * signifier la même chose — le français s'affiche.
 */
app.post("/admin/products/:id/translations", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json();
  const langue = String(b.lang ?? "");
  if (!["en", "de", "it", "es"].includes(langue)) {
    return c.json({ error: "langue inconnue" }, 400);
  }
  const [p] = await db
    .select({ translations: schema.products.translations })
    .from(schema.products)
    .where(eq(schema.products.id, id));
  if (!p) return c.notFound();

  const propre = (v: unknown) => {
    const s = typeof v === "string" ? v.trim() : "";
    return s || undefined;
  };
  const entree = {
    ...(propre(b.name) ? { name: propre(b.name) } : {}),
    ...(propre(b.description) ? { description: propre(b.description) } : {}),
  };

  const dico = { ...(p.translations ?? {}) };
  if (Object.keys(entree).length) dico[langue] = entree;
  else delete dico[langue];

  const [row] = await db
    .update(schema.products)
    .set({ translations: dico, updatedAt: new Date() })
    .where(eq(schema.products.id, id))
    .returning({ translations: schema.products.translations });
  return c.json({ ok: true, translations: row?.translations ?? {} });
});

/* --------------------------------------------------------------------------
 *  Comptes du back-office
 *
 *  Réservés au PROPRIÉTAIRE, lecture comprise : la liste des comptes dit qui
 *  peut entrer, un vendeur n'a pas à la connaître (le garde-fou global ne
 *  protège que les écritures).
 * ----------------------------------------------------------------------- */

/** L'appelant, s'il est propriétaire ; null sinon. */
async function exigerProprietaire(jeton: string | undefined) {
  const user = await validateSession(jeton);
  if (!user || user.role !== OWNER_ROLE) return null;
  return user;
}

/**
 * Combien de propriétaires reste-t-il ? Sert à ne jamais tomber à zéro.
 *
 * Les comptes ARCHIVÉS ne comptent pas : ils ne peuvent plus se connecter, et
 * les laisser dans le total autoriserait à archiver le dernier propriétaire
 * encore capable d'entrer — un back-office sans propriétaire ne se répare pas
 * depuis le back-office.
 */
async function nombreProprietaires(): Promise<number> {
  const [n] = await db
    .select({ n: count() })
    .from(schema.adminUsers)
    .where(
      and(
        eq(schema.adminUsers.role, OWNER_ROLE),
        isNull(schema.adminUsers.archivedAt),
      ),
    );
  return Number(n?.n ?? 0);
}

/**
 * Chiffres des commandes sur une période, avec la période PRÉCÉDENTE de même
 * durée pour donner une évolution — un nombre seul ne dit pas grand-chose.
 *
 * Seules les commandes payées comptent : un panier abandonné n'est pas une
 * vente, et les gonfler ferait mentir le tableau de bord.
 */
app.get("/admin/stats/orders", async (c) => {
  const jours = Math.min(365, Math.max(1, Number(c.req.query("days") ?? 30)));
  const canal = String(c.req.query("channel") ?? "");
  const maintenant = new Date();
  const debut = new Date(maintenant.getTime() - jours * 86400000);
  const debutPrecedent = new Date(maintenant.getTime() - 2 * jours * 86400000);

  const conditions = [
    eq(schema.orders.status, "paid"),
    gte(schema.orders.createdAt, debutPrecedent),
  ];
  if (canal === "web" || canal === "salon")
    conditions.push(eq(schema.orders.channel, canal));
  // Un stand précis : c'est la question du retour de salon, « celui-là,
  // combien a-t-il fait ».
  const standDemande = Number(c.req.query("stand"));
  if (Number.isInteger(standDemande) && standDemande > 0)
    conditions.push(eq(schema.orders.standId, standDemande));

  // Un vendeur ne voit que le stand, quoi qu'il demande. Le filtre est posé
  // ici et non dans l'écran : une adresse tapée à la main doit buter sur la
  // même règle qu'un bouton.
  const utilisateur = c.get("utilisateur");
  if (utilisateur && utilisateur.role !== OWNER_ROLE) {
    conditions.push(eq(schema.orders.channel, "salon"));
    if (typeof utilisateur.standId === "number" && utilisateur.standId > 0)
      conditions.push(eq(schema.orders.standId, utilisateur.standId));
  }

  const lignes = await db
    .select({
      id: schema.orders.id,
      createdAt: schema.orders.createdAt,
      totalCents: schema.orders.totalCents,
      shippingCents: schema.orders.shippingCents,
      fulfilledAt: schema.orders.fulfilledAt,
    })
    .from(schema.orders)
    .where(and(...conditions));

  // Articles vendus : la somme des quantités des lignes de ces commandes.
  const ids = lignes.map((l) => l.id);
  const articles = ids.length
    ? await db
        .select({
          orderId: schema.orderItems.orderId,
          quantity: schema.orderItems.quantity,
        })
        .from(schema.orderItems)
        .where(inArray(schema.orderItems.orderId, ids))
    : [];
  const parCommande = new Map<number, number>();
  for (const a of articles)
    parCommande.set(a.orderId, (parCommande.get(a.orderId) ?? 0) + a.quantity);

  const dansPeriode = (d: Date) => d >= debut;
  const resume = (garder: (d: Date) => boolean) => {
    const sel = lignes.filter((l) => garder(l.createdAt));
    return {
      commandes: sel.length,
      articles: sel.reduce((s, l) => s + (parCommande.get(l.id) ?? 0), 0),
      caCents: sel.reduce((s, l) => s + l.totalCents, 0),
      portCents: sel.reduce((s, l) => s + l.shippingCents, 0),
    };
  };

  // Une valeur par jour, pour la courbe. Le jour le plus ancien en premier.
  const serie: number[] = [];
  for (let i = jours - 1; i >= 0; i--) {
    const fin = new Date(maintenant.getTime() - i * 86400000);
    const deb = new Date(fin.getTime() - 86400000);
    serie.push(
      lignes.filter((l) => l.createdAt > deb && l.createdAt <= fin).length,
    );
  }

  // Ce qui reste à préparer sur la période : le chiffre qui dit quoi faire
  // aujourd'hui, là où les autres disent ce qui s'est passé.
  const aTraiter = lignes.filter(
    (l) => dansPeriode(l.createdAt) && !l.fulfilledAt,
  ).length;

  return c.json({
    jours,
    periode: { ...resume(dansPeriode), aTraiter },
    precedent: resume((d) => !dansPeriode(d)),
    serie,
  });
});

app.get("/admin/users", async (c) => {
  const moi = await exigerProprietaire(getCookie(c, SESSION_COOKIE));
  if (!moi) return c.json({ error: "Réservé au propriétaire" }, 403);
  const rows = await db
    .select({
      id: schema.adminUsers.id,
      email: schema.adminUsers.email,
      role: schema.adminUsers.role,
      createdAt: schema.adminUsers.createdAt,
      // Les archivés viennent AVEC, marqués : l'écran les range dans sa
      // section « Comptes archivés », d'où ils se restaurent.
      archivedAt: schema.adminUsers.archivedAt,
    })
    .from(schema.adminUsers)
    .orderBy(asc(schema.adminUsers.id));
  // Sessions ouvertes : dit d'un coup d'œil quels comptes servent vraiment.
  const ouvertes = await db
    .select({
      adminUserId: schema.sessions.adminUserId,
      expiresAt: schema.sessions.expiresAt,
    })
    .from(schema.sessions);
  const actifs = new Set(
    ouvertes
      .filter((s) => s.expiresAt.getTime() > Date.now())
      .map((s) => s.adminUserId),
  );
  return c.json(
    rows.map((r) => ({
      ...r,
      connecte: actifs.has(r.id),
      moi: r.id === moi.adminUserId,
    })),
  );
});

/**
 * Crée un compte, ou change le rôle et/ou le mot de passe d'un compte
 * existant.
 *
 * Deux garde-fous, parce qu'un back-office sans propriétaire ne se répare pas
 * depuis le back-office : on ne rétrograde pas le dernier propriétaire, et on
 * ne change pas son propre rôle (on se verrouillerait dehors d'un clic).
 */
app.post("/admin/users", async (c) => {
  const moi = await exigerProprietaire(getCookie(c, SESSION_COOKIE));
  if (!moi) return c.json({ error: "Réservé au propriétaire" }, 403);
  const b = await c.req.json();
  const email = String(b.email ?? "").trim().toLowerCase();
  const role = b.role === "seller" ? "seller" : OWNER_ROLE;
  const motDePasse = String(b.password ?? "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return c.json({ error: "adresse e-mail invalide" }, 400);
  if (motDePasse && motDePasse.length < 10)
    return c.json({ error: "mot de passe : 10 caractères minimum" }, 400);

  const id = b.id ? Number(b.id) : null;
  if (id) {
    const [avant] = await db
      .select({ id: schema.adminUsers.id, role: schema.adminUsers.role })
      .from(schema.adminUsers)
      .where(eq(schema.adminUsers.id, id));
    if (!avant) return c.notFound();
    if (avant.id === moi.adminUserId && role !== avant.role)
      return c.json({ error: "on ne change pas son propre rôle" }, 400);
    if (
      avant.role === OWNER_ROLE &&
      role !== OWNER_ROLE &&
      (await nombreProprietaires()) <= 1
    )
      return c.json({ error: "il faut au moins un propriétaire" }, 400);
    const [row] = await db
      .update(schema.adminUsers)
      .set({
        email,
        role,
        ...(motDePasse ? { passwordHash: await hashPassword(motDePasse) } : {}),
      })
      .where(eq(schema.adminUsers.id, id))
      .returning({ id: schema.adminUsers.id, email: schema.adminUsers.email });
    // Changement de mot de passe : on ferme les sessions ouvertes de ce
    // compte, sinon l'ancien mot de passe continue de donner accès.
    if (motDePasse)
      await db.delete(schema.sessions).where(eq(schema.sessions.adminUserId, id));
    return c.json(row);
  }

  if (!motDePasse)
    return c.json({ error: "mot de passe requis pour un nouveau compte" }, 400);
  const [existe] = await db
    .select({
      id: schema.adminUsers.id,
      archivedAt: schema.adminUsers.archivedAt,
    })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.email, email));
  // Un compte archivé garde son adresse réservée : la recréer échouerait sur
  // l'index unique, et le message générique aurait envoyé chercher un compte
  // qui ne s'affiche nulle part. On dit donc où il est.
  if (existe?.archivedAt)
    return c.json(
      {
        error:
          "Cette adresse a un compte archivé. Restaurez-le depuis « Comptes archivés » plutôt que d'en créer un second.",
      },
      409,
    );
  if (existe) return c.json({ error: "cette adresse a déjà un compte" }, 409);
  const [row] = await db
    .insert(schema.adminUsers)
    .values({ email, role, passwordHash: await hashPassword(motDePasse) })
    .returning({ id: schema.adminUsers.id, email: schema.adminUsers.email });
  return c.json(row);
});

/**
 * Archive un compte, ou le restaure.
 *
 * La suppression définitive a été RETIRÉE. Un compte effacé emportait son
 * nom, et le nom est justement ce que l'historique cite : les journaux des
 * commandes gardent qui a expédié, remboursé, encaissé ou annulé. Effacer la
 * vendeuse rendait anonymes des mois d'écritures.
 *
 * Archivé, le compte ne peut plus entrer (le contrôle est dans /auth/login)
 * et quitte la liste ordinaire ; l'historique garde son nom, et « Restaurer »
 * lui rend son accès avec son rôle.
 *
 * Ses SESSIONS, elles, sont réellement supprimées : une session n'est pas un
 * souvenir mais une porte ouverte, et la laisser ouverte pendant un mois
 * viderait l'archivage de son sens. C'est la seule suppression que cet
 * archivage s'autorise, et elle ne coûte rien à personne — il suffit de se
 * reconnecter après une restauration.
 *
 * Les deux garde-fous de la création restent : ni son propre compte (on se
 * mettrait dehors), ni le dernier propriétaire encore capable d'entrer.
 */
app.post("/admin/users/:id/archive", async (c) => {
  const moi = await exigerProprietaire(getCookie(c, SESSION_COOKIE));
  if (!moi) return c.json({ error: "Réservé au propriétaire" }, 403);
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "identifiant invalide" }, 400);
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  // Défaut : on archive. Seul un « archived: false » explicite restaure.
  const archiver = b.archived !== false;

  if (archiver && id === moi.adminUserId)
    return c.json({ error: "on n'archive pas son propre compte" }, 400);
  const [cible] = await db
    .select({
      role: schema.adminUsers.role,
      archivedAt: schema.adminUsers.archivedAt,
    })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.id, id));
  if (!cible) return c.notFound();
  if (
    archiver &&
    !cible.archivedAt &&
    cible.role === OWNER_ROLE &&
    (await nombreProprietaires()) <= 1
  )
    return c.json({ error: "il faut au moins un propriétaire" }, 400);

  const [ligne] = await db
    .update(schema.adminUsers)
    .set({ archivedAt: archiver ? new Date() : null })
    .where(eq(schema.adminUsers.id, id))
    .returning({ archivedAt: schema.adminUsers.archivedAt });
  if (!ligne) return c.notFound();
  if (archiver)
    await db.delete(schema.sessions).where(eq(schema.sessions.adminUserId, id));
  return c.json({ ok: true, archived: ligne.archivedAt != null });
});

/** Ferme toutes les sessions d'un compte — le remet à la porte. */
app.post("/admin/users/:id/deconnecter", async (c) => {
  const moi = await exigerProprietaire(getCookie(c, SESSION_COOKIE));
  if (!moi) return c.json({ error: "Réservé au propriétaire" }, 403);
  const id = Number(c.req.param("id"));
  await db.delete(schema.sessions).where(eq(schema.sessions.adminUserId, id));
  return c.json({ ok: true });
});

/** Tous les cadres, actifs ou non — gestion au back-office. */
app.get("/admin/frames", async (c) => {
  const rows = await db
    .select()
    .from(schema.frames)
    .orderBy(asc(schema.frames.position));
  return c.json(rows);
});

/**
 * Crée ou met à jour un cadre (nom, prix A4 et A3, couleur d'aperçu, ordre,
 * actif).
 */
app.post("/admin/frames", async (c) => {
  const b = await c.req.json();
  const name = String(b.name ?? "").trim();
  if (!name) return c.json({ error: "nom requis" }, 400);
  const valeurs = {
    name,
    // Un supplément par format : un cadre A3 coûte plus qu'un cadre A4.
    priceA4Cents: Math.max(0, Math.round(Number(b.priceA4Cents ?? 0))),
    priceA3Cents: Math.max(0, Math.round(Number(b.priceA3Cents ?? 0))),
    weightGrams: Math.max(0, Math.round(Number(b.weightGrams ?? 0))),
    previewColor: b.previewColor ? String(b.previewColor) : null,
    active: b.active !== false,
    position: Number(b.position ?? 0),
  };
  if (b.id) {
    const [row] = await db
      .update(schema.frames)
      .set(valeurs)
      .where(eq(schema.frames.id, Number(b.id)))
      .returning();
    if (!row) return c.notFound();
    return c.json(row);
  }
  const base =
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "cadre";
  const pris = new Set(
    (await db.select({ slug: schema.frames.slug }).from(schema.frames)).map(
      (r) => r.slug,
    ),
  );
  let slug = base;
  for (let i = 2; pris.has(slug); i++) slug = `${base}-${i}`;
  const [row] = await db
    .insert(schema.frames)
    .values({ ...valeurs, slug })
    .returning();
  return c.json(row);
});

/**
 * Archive un cadre, ou le restaure.
 *
 * La suppression définitive a été RETIRÉE. Elle se croyait sans conséquence
 * parce que le PRIX est figé sur la ligne de commande — mais le NOM, lui, se
 * relit ici, et à trois endroits qui regardent en arrière : la fiche d'une
 * commande passée, le courrier de confirmation, et le nom du fichier
 * d'impression. Effacer un cadre laissait donc des commandes anciennes sans
 * cadre nommé, et un atelier qui ne savait plus lequel poser.
 *
 * Archivé, le cadre quitte le configurateur et la liste ordinaire ; son nom
 * continue de s'afficher partout où il a été vendu, et « Restaurer » le
 * remet au catalogue avec ses prix et son poids.
 */
app.post("/admin/frames/:id/archive", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "identifiant invalide" }, 400);
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  // Défaut : on archive. Seul un « archived: false » explicite restaure.
  const archiver = b.archived !== false;

  // Combien de fois il a été vendu : l'écran le redit, pour que la
  // propriétaire voie ce que son archivage laisse derrière lui.
  //
  // La comparaison se fait en TEXTE, et surtout pas en `::int`. « Sans
  // cadre » s'écrit tantôt `null`, tantôt la chaîne VIDE — le reste du code
  // attend explicitement les deux (configurator-routes.ts, le panier, les
  // courriers). Or cette requête balaie TOUTES les lignes de commande : une
  // seule chaîne vide quelque part dans l'historique et Postgres refuse le
  // cast, ce qui rendrait impossible l'archivage de N'IMPORTE QUEL cadre,
  // pas seulement celui-là. En texte, une valeur inattendue ne correspond
  // simplement à rien.
  const [vendu] = await db
    .select({ n: count() })
    .from(schema.orderItems)
    .where(sqlOp`${schema.orderItems.config} ->> 'frameId' = ${String(id)}`);

  const [row] = await db
    .update(schema.frames)
    .set({
      archivedAt: archiver ? new Date() : null,
      // Rangé et décoché d'un même geste, comme un mode de livraison : sinon
      // la restauration le remettrait en vente sans qu'on l'ait demandé.
      ...(archiver ? { active: false } : {}),
    })
    .where(eq(schema.frames.id, id))
    .returning({ archivedAt: schema.frames.archivedAt });
  if (!row) return c.notFound();
  return c.json({
    ok: true,
    archived: row.archivedAt != null,
    commandes: Number(vendu?.n ?? 0),
  });
});

/**
 * Tous les types d'affiche, avec ce qui s'y rattache (pour le BO).
 *
 * Les archivés viennent AVEC, marqués par leur `archivedAt` : l'écran les
 * range dans sa section « Archivés », d'où ils se restaurent.
 */
app.get("/admin/views", async (c) => {
  const rows = await db
    .select()
    .from(schema.posterViews)
    .orderBy(asc(schema.posterViews.position));
  // Ce qui se rattache à un type : l'écran le redit avant de l'archiver.
  const usages = await Promise.all(
    rows.map(async (v) => {
      const [p] = await db
        .select({ n: count() })
        .from(schema.products)
        .where(eq(schema.products.defaultView, v.slug));
      const [ct] = await db
        .select({ n: count() })
        .from(schema.characterTypes)
        .where(eq(schema.characterTypes.orientation, v.slug));
      const [a] = await db
        .select({ n: count() })
        .from(schema.assets)
        .where(eq(schema.assets.view, v.slug));
      return {
        ...v,
        usage: {
          produits: Number(p?.n ?? 0),
          personnages: Number(ct?.n ?? 0),
          pieces: Number(a?.n ?? 0),
        },
      };
    }),
  );
  return c.json(usages);
});

/**
 * Crée ou renomme un type d'affiche.
 *
 * Le `slug` est posé à la création et ne bouge plus : c'est lui qui relie les
 * personnages, les pièces et les produits à leur type. Le renommer les
 * détacherait tous d'un coup.
 */
app.post("/admin/views", async (c) => {
  const b = await c.req.json();
  const name = String(b.name ?? "").trim();
  if (!name) return c.json({ error: "nom requis" }, 400);
  const valeurs = {
    name,
    foregroundUrl: b.foregroundUrl ? String(b.foregroundUrl).trim() : null,
    active: b.active !== false,
    position: Number(b.position ?? 0),
  };
  if (b.id) {
    const [row] = await db
      .update(schema.posterViews)
      .set(valeurs)
      .where(eq(schema.posterViews.id, Number(b.id)))
      .returning();
    if (!row) return c.notFound();
    return c.json(row);
  }
  const base =
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "vue";
  const pris = new Set(
    (
      await db.select({ slug: schema.posterViews.slug }).from(schema.posterViews)
    ).map((r) => r.slug),
  );
  let slug = base;
  for (let i = 2; pris.has(slug); i++) slug = `${base}-${i}`;
  const [row] = await db
    .insert(schema.posterViews)
    .values({ ...valeurs, slug })
    .returning();
  return c.json(row);
});

/**
 * Archive un type d'affiche, ou le restaure.
 *
 * La suppression définitive a été RETIRÉE. Elle n'était d'ailleurs possible
 * que pour un type inutilisé : ailleurs, ses personnages, ses pièces et ses
 * produits auraient pointé sur un type disparu, et le configurateur n'aurait
 * plus rien eu à proposer.
 *
 * Archiver marche dans tous les cas, justement parce que rien ne disparaît :
 * la ligne reste, son `slug` avec elle, et tout ce qui la cite continue de la
 * trouver. Le type quitte le site et les listes, et revient sur « Restaurer ».
 * Le décompte de ce qui s'y rattache repart quand même avec la réponse : c'est
 * ce que l'écran redit avant d'archiver.
 */
app.post("/admin/views/:id/archive", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.notFound();
  const corps = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  // Défaut : on archive. Seul un « archived: false » explicite restaure.
  const archiver = corps.archived !== false;
  const [vue] = await db
    .update(schema.posterViews)
    .set({ archivedAt: archiver ? new Date() : null })
    .where(eq(schema.posterViews.id, id))
    .returning();
  if (!vue) return c.notFound();
  const [p] = await db
    .select({ n: count() })
    .from(schema.products)
    .where(eq(schema.products.defaultView, vue.slug));
  const [ct] = await db
    .select({ n: count() })
    .from(schema.characterTypes)
    .where(eq(schema.characterTypes.orientation, vue.slug));
  const [a] = await db
    .select({ n: count() })
    .from(schema.assets)
    .where(eq(schema.assets.view, vue.slug));
  return c.json({
    ok: true,
    archived: vue.archivedAt != null,
    usage: {
      produits: Number(p?.n ?? 0),
      personnages: Number(ct?.n ?? 0),
      pieces: Number(a?.n ?? 0),
    },
  });
});

app.get("/admin/promos", async (c) => {
  const rows = await db
    .select()
    .from(schema.promoRules)
    .orderBy(desc(schema.promoRules.priority));
  return c.json(rows);
});

app.post("/admin/promos", async (c) => {
  const body = await c.req.json();
  const values = {
    name: String(body.name ?? "Promo"),
    type: String(body.type ?? "percent"),
    config: body.config ?? {},
    code: body.code || null,
    active: body.active ?? true,
    priority: Number(body.priority ?? 0),
    stackable: body.stackable ?? false,
    startsAt: body.startsAt ? new Date(body.startsAt) : null,
    endsAt: body.endsAt ? new Date(body.endsAt) : null,
    updatedAt: new Date(),
  };
  if (body.id) {
    const [row] = await db
      .update(schema.promoRules)
      .set(values)
      .where(eq(schema.promoRules.id, Number(body.id)))
      .returning();
    return c.json(row);
  }
  const [row] = await db.insert(schema.promoRules).values(values).returning();
  return c.json(row);
});

app.post("/admin/promos/:id/toggle", async (c) => {
  const id = Number(c.req.param("id"));
  const [cur] = await db
    .select({ active: schema.promoRules.active })
    .from(schema.promoRules)
    .where(eq(schema.promoRules.id, id));
  if (!cur) return c.notFound();
  const [row] = await db
    .update(schema.promoRules)
    .set({ active: !cur.active })
    .where(eq(schema.promoRules.id, id))
    .returning();
  return c.json(row);
});

/**
 * Le bandeau tel que le BACK-OFFICE doit le voir, avec la regle qu'il annonce.
 *
 * L'ecran lisait jusqu'ici la route publique, qui ne rend que les bandeaux
 * actifs et dans leur periode. Bandeau eteint = ecran vide = champ « id »
 * absent = l'enregistrement suivant creait une DEUXIEME ligne au lieu de
 * modifier la premiere, et le site se mettait a afficher l'ancienne.
 */
app.get("/admin/banner", async (c) => {
  const [banner] = await db
    .select()
    .from(schema.announcementBanners)
    .orderBy(desc(schema.announcementBanners.priority), desc(schema.announcementBanners.id))
    .limit(1);
  if (!banner) return c.json(null);
  let promo = null;
  if (banner.promoRuleId) {
    [promo] = await db
      .select()
      .from(schema.promoRules)
      .where(eq(schema.promoRules.id, banner.promoRuleId));
  }
  return c.json({ ...banner, promo: promo ?? null });
});

app.post("/admin/banner", async (c) => {
  const body = await c.req.json();
  const actif = body.active ?? true;
  const debut = body.startsAt ? new Date(body.startsAt) : null;
  const fin = body.endsAt ? new Date(body.endsAt) : null;

  // La regle annoncee, s'il y en a une. Trois cas, et un seul silencieux :
  //   `promo` absent  -> on ne touche pas au lien (compatibilite).
  //   `promo` null    -> le bandeau n'annonce plus rien.
  //   `promo` objet   -> on l'ecrit et on la lie.
  const [avant] = body.id
    ? await db
        .select({ promoRuleId: schema.announcementBanners.promoRuleId })
        .from(schema.announcementBanners)
        .where(eq(schema.announcementBanners.id, Number(body.id)))
    : [];
  const ancienneRegle = avant?.promoRuleId ?? null;
  let promoRuleId: number | null | undefined =
    body.promoRuleId === undefined ? undefined : body.promoRuleId ? Number(body.promoRuleId) : null;

  if (body.promo !== undefined) {
    if (body.promo === null) {
      promoRuleId = null;
    } else {
      const p = body.promo as Record<string, unknown>;
      if (p.id && !p.type) {
        // Une regle deja enregistree, choisie dans la liste : on la lie sans
        // rien reecrire de ce qu'elle dit. Seuls son etat et ses dates suivent
        // le bandeau.
        const [lie] = await db
          .update(schema.promoRules)
          .set({ active: actif, startsAt: debut, endsAt: fin, updatedAt: new Date() })
          .where(eq(schema.promoRules.id, Number(p.id)))
          .returning();
        promoRuleId = lie?.id ?? null;
      } else {
      // La regle suit le bandeau : meme etat, memes dates. C'est tout le sens
      // du lien — on ne peut pas annoncer une offre eteinte, ni faire tourner
      // une offre que plus rien n'annonce.
      const valeurs = {
        name: String(p.name ?? "Offre du bandeau"),
        type: String(p.type ?? "percent"),
        config: p.config ?? {},
        code: p.code ? String(p.code) : null,
        active: actif,
        priority: Number(p.priority ?? 10),
        startsAt: debut,
        endsAt: fin,
        updatedAt: new Date(),
      };
      const cible = p.id ? Number(p.id) : ancienneRegle;
      if (cible) {
        const [maj] = await db
          .update(schema.promoRules)
          .set(valeurs)
          .where(eq(schema.promoRules.id, cible))
          .returning();
        promoRuleId = maj?.id ?? null;
      } else {
        const [cree] = await db.insert(schema.promoRules).values(valeurs).returning();
        promoRuleId = cree?.id ?? null;
      }
      }
    }
  }

  // Une regle qu'on vient de delier ne doit pas continuer a remiser dans le
  // dos de la boutique : elle s'eteint avec le bandeau qui l'annoncait. Elle
  // reste dans l'ecran Promotions, ou elle peut etre rallumee a la main.
  if (
    ancienneRegle &&
    promoRuleId !== undefined &&
    promoRuleId !== ancienneRegle
  ) {
    await db
      .update(schema.promoRules)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(schema.promoRules.id, ancienneRegle));
  }

  const values = {
    message: String(body.message ?? ""),
    linkUrl: body.linkUrl || null,
    linkLabel: body.linkLabel || null,
    bgColor: body.bgColor || "#20211f",
    textColor: body.textColor || "#f7f3ec",
    active: actif,
    priority: Number(body.priority ?? 0),
    ...(promoRuleId === undefined ? {} : { promoRuleId }),
    startsAt: debut,
    endsAt: fin,
  };
  if (body.id) {
    const [row] = await db
      .update(schema.announcementBanners)
      .set(values)
      .where(eq(schema.announcementBanners.id, Number(body.id)))
      .returning();
    return c.json(row);
  }
  const [row] = await db
    .insert(schema.announcementBanners)
    .values(values)
    .returning();
  return c.json(row);
});

/**
 * Enregistre un réglage, éventuellement dans UNE langue.
 *
 * Sans `lang`, la valeur remplace tout : c'est le comportement d'origine, et
 * celui qui convient aux réglages qui ne se traduisent pas (un plafond, un
 * interrupteur, une adresse d'image).
 *
 * Avec `lang`, la valeur est FUSIONNÉE dans le dictionnaire existant :
 * enregistrer l'allemand ne touche pas au français. Sans cette fusion, chaque
 * passage sur une langue effacerait les quatre autres — la cliente
 * traduirait en rond sans jamais comprendre pourquoi.
 *
 * Une langue enregistrée vide est RETIRÉE du dictionnaire plutôt que gardée
 * en blanc : c'est ce qui la fait retomber proprement sur le français, au
 * lieu d'afficher du vide.
 */
app.post("/admin/settings", async (c) => {
  const body = await c.req.json();
  const key = String(body.key);
  const langue = body.lang ? String(body.lang).slice(0, 5) : null;

  let valeur: unknown = body.value;
  if (langue) {
    const [existant] = await db
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, key));
    const brut = existant?.value;
    // Une valeur restée en chaîne était du français : on la garde comme tel
    // au lieu de la perdre en passant au dictionnaire.
    const dico: Record<string, unknown> =
      brut && typeof brut === "object" && !Array.isArray(brut)
        ? { ...(brut as Record<string, unknown>) }
        : brut === undefined || brut === null
          ? {}
          : { fr: brut };
    const texte = String(body.value ?? "");
    if (texte.trim()) dico[langue] = texte;
    else delete dico[langue];
    // La colonne est NOT NULL : un dictionnaire entièrement vidé retombe sur
    // un français vide, jamais sur NULL.
    valeur = Object.keys(dico).length ? dico : { fr: "" };
  }

  const [row] = await db
    .insert(schema.settings)
    .values({
      key,
      value: valeur,
      ...(body.label !== undefined ? { label: String(body.label) } : {}),
      ...(body.group !== undefined ? { group: String(body.group) } : {}),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: {
        value: valeur,
        ...(body.label !== undefined ? { label: String(body.label) } : {}),
        ...(body.group !== undefined ? { group: String(body.group) } : {}),
        updatedAt: new Date(),
      },
    })
    .returning();
  return c.json(row);
});

const port = Number(process.env.API_PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`✓ API memoryline sur http://localhost:${info.port}`);
  // Le travailleur des relances de panier, une fois l'API en écoute : un
  // passage toutes les cinq minutes, qui ne fait rien tant que la marchande
  // n'a pas allumé la relance automatique dans le back-office.
  demarrerRelancePanier();
  // Le ménage des photos relayées du téléphone à la tablette : chacune
  // disparaît au plus tard une minute après l'expiration de son code.
  demarrerMenageRelais();
  // La purge des photos de visiteurs (apps/api/src/ia.ts) : au démarrage,
  // puis toutes les heures. Sans elle, une photo envoyée pour un aperçu
  // restait sur le disque tant que personne ne cliquait au back-office.
  demarrerPurgeIa();
});

export type AppType = typeof app;
