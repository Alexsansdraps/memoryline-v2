/**
 * La recherche unique du back-office.
 *
 * Le back-office compte une trentaine d'écrans et chacun a sa propre barre de
 * filtres. Retrouver la commande d'une cliente qui appelle demandait donc de
 * savoir D'ABORD dans quel écran chercher : les commandes du site, les ventes
 * de stand, les cartes cadeaux. Cette route répond à la question posée dans
 * l'autre sens — « je tape ce que je sais, montre-moi ce que ça touche » — et
 * elle mélange volontairement les natures : une affiche, une commande, une
 * cliente et un écran du menu se répondent dans la même liste.
 *
 * Ce qu'elle ne fait pas, et c'est délibéré :
 *
 *   - Elle ne classe pas les catégories entre elles par pertinence. Chaque
 *     catégorie garde son bloc, dans un ordre fixe. Un classement global qui
 *     change à chaque frappe se lit mal : on cherche des yeux au même endroit.
 *   - Elle ne cherche pas dans le corps des textes (descriptions, notes). On
 *     cherche ici quelque chose dont on connaît le NOM ou le NUMÉRO ; ratisser
 *     les descriptions ramènerait des dizaines d'affiches pour deux lettres.
 *   - Elle ne sort aucun code d'accès de stand, aucune empreinte de mot de
 *     passe. Voir la garde en tête de la route.
 */
import type { Hono } from "hono";
import type { Column, SQL } from "drizzle-orm";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  notInArray,
  or,
  sql as raw,
} from "drizzle-orm";
import { db, schema } from "./db/client.js";
import { HORS_VENTES } from "./statuts-vente.js";

/* -------------------------------------------------------------------------- */
/*  Ce que la route renvoie                                                   */
/* -------------------------------------------------------------------------- */

/** La nature d'un résultat. Le panneau s'en sert pour son icône et son titre. */
export type GenreResultat =
  | "produit"
  | "commande"
  | "client"
  | "collection"
  | "stand"
  | "carte"
  | "ecran";

export interface ResultatRecherche {
  /** Identifiant technique, pour la clé de liste. Jamais affiché. */
  id: string;
  /** Ce qu'on lit en premier : le nom, le numéro, le code. */
  titre: string;
  /** Seconde ligne : statut, montant, date. Absente quand il n'y a rien à dire. */
  detail?: string;
  /** Adresse INTERNE, sans le préfixe de déploiement : le panneau l'ajoute. */
  href: string;
  /** Vignette, pour une affiche. Chemin servi par l'API (« /assets/… »). */
  image?: string | null;
}

export interface GroupeRecherche {
  genre: GenreResultat;
  titre: string;
  resultats: ResultatRecherche[];
}

/**
 * Deux caractères avant de chercher.
 *
 * En dessous, tout correspond : une seule lettre ramènerait le catalogue
 * entier et ferait travailler la base à chaque frappe pour un résultat que
 * personne ne peut lire.
 */
const MINIMUM_CARACTERES = 2;

/**
 * Cinq résultats par catégorie.
 *
 * Un panneau de recherche n'est pas une liste : il sert à reconnaître ce qu'on
 * cherchait déjà. Passé cinq lignes, on ne reconnaît plus, on parcourt — et
 * c'est le rôle des écrans, qui ont leurs filtres et leur pagination.
 */
const PAR_CATEGORIE = 5;

/* -------------------------------------------------------------------------- */
/*  Comparer sans se soucier des accents ni de la casse                       */
/* -------------------------------------------------------------------------- */

/**
 * La table de correspondance des lettres accentuées, pour `translate()`.
 *
 * L'extension `unaccent` de PostgreSQL ferait ce travail plus proprement, mais
 * elle demande un `CREATE EXTENSION` — donc les droits d'administration de la
 * base, et une migration de plus à ne pas oublier le jour d'une réinstallation.
 * `translate()` est présent partout, sans rien installer.
 *
 * Les majuscules accentuées figurent aussi dans la table alors que `lower()`
 * est appliqué avant : sur une base créée avec la locale « C », `lower('É')`
 * ne rend pas « é », et « Éléonore » cesserait de se trouver en tapant
 * « eleonore ». Les deux lignes coûtent moins que ce piège.
 */
const LETTRES_ACCENTUEES =
  "àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝŸ";
const LETTRES_PLATES =
  "aaaaaaceeeeiiiinooooouuuuyyaaaaaaceeeeiiiinooooouuuuyy";

/** Le même aplatissement, côté JavaScript, pour la liste des écrans. */
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
  return raw`translate(lower(coalesce(${colonne}, '')), ${LETTRES_ACCENTUEES}, ${LETTRES_PLATES}) like ${motif}`;
}

/**
 * « cette colonne, tirets et casse mis de côté, contient le motif ».
 *
 * Les numéros de commande et les codes de carte cadeau s'écrivent avec des
 * tirets (« WEB-0042 », « ACEF-HJKL-RUWX ») et se relisent au téléphone sans.
 * Les deux doivent trouver la même chose.
 */
function contientSansTiret(colonne: Column, motif: string): SQL {
  return raw`replace(lower(coalesce(${colonne}, '')), '-', '') like ${motif}`;
}

/* -------------------------------------------------------------------------- */
/*  Mise en forme des détails                                                 */
/* -------------------------------------------------------------------------- */

/** « 49,90 € », « 30 € ». */
function euros(cents: number): string {
  const montant = cents / 100;
  const texte =
    cents % 100 === 0 ? String(montant) : montant.toFixed(2).replace(".", ",");
  return `${texte} €`;
}

/** « 12/03/2026 » : compact, c'est une seconde ligne, pas une fiche. */
function jour(quand: Date): string {
  return quand.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Assemble les morceaux d'une seconde ligne, en sautant ceux qui manquent. */
function ligneDetail(...morceaux: (string | null | undefined)[]): string {
  return morceaux.filter((m): m is string => !!m).join(" · ");
}

/** Ce que la propriétaire lit dans la liste des affiches. */
const ETAT_AFFICHE: Record<string, string> = {
  active: "Actif",
  draft: "Désactivé",
  archived: "Archivé",
};

/* -------------------------------------------------------------------------- */
/*  Les écrans du back-office                                                 */
/* -------------------------------------------------------------------------- */

interface Ecran {
  titre: string;
  href: string;
  /**
   * Les autres mots qui doivent y mener.
   *
   * C'est la moitié de l'utilité de cette liste : personne ne tape
   * « Livraison » pour régler les frais de port, on tape « port ». Le titre
   * seul ne suffirait donc pas.
   */
  aussi?: string[];
}

/**
 * Les écrans, écrits à la main.
 *
 * Ils ne sont pas lus du menu : le menu est en Astro, dans une autre
 * application, et il ne porte ni les sous-pages sans lien (« Modifier
 * plusieurs produits ») ni les mots qu'on tape pour les atteindre. Une page
 * ajoutée demain devra être ajoutée ici ; c'est une ligne, et l'oubli ne casse
 * rien — l'écran reste accessible par le menu.
 */
const ECRANS: Ecran[] = [
  { titre: "Accueil", href: "/", aussi: ["tableau de bord", "chiffres du jour"] },
  {
    titre: "Commandes en ligne",
    href: "/commandes",
    aussi: ["ventes du site", "boutique", "expeditions"],
  },
  { titre: "Paniers abandonnés", href: "/paniers", aussi: ["relances"] },
  { titre: "Clients", href: "/clients", aussi: ["clientes", "fiches"] },
  {
    titre: "Ventes stand",
    href: "/ventes-salon",
    aussi: ["salon", "foire", "marché", "stands"],
  },
  { titre: "Produits", href: "/produits", aussi: ["affiches", "catalogue"] },
  {
    titre: "Nouvelle affiche",
    href: "/produits/nouveau",
    aussi: ["créer un produit", "ajouter une affiche"],
  },
  {
    titre: "Importer des affiches",
    href: "/produits/import",
    aussi: ["import", "fichier", "tableur"],
  },
  {
    titre: "Modifier plusieurs produits",
    href: "/produits/modifier-en-masse",
    aussi: ["prix en masse", "modification groupée"],
  },
  { titre: "Cadres", href: "/cadres", aussi: ["encadrement"] },
  { titre: "Personnages", href: "/personnages", aussi: ["silhouettes"] },
  { titre: "Nouveau personnage", href: "/personnages/nouveau" },
  { titre: "Nouvelle pièce", href: "/personnages/piece", aussi: ["pièces"] },
  {
    titre: "Correspondances",
    href: "/personnages/correspondances",
    aussi: ["équivalences des pièces"],
  },
  { titre: "Types d'affiche", href: "/types-affiche", aussi: ["modèles"] },
  {
    titre: "Affiches IA",
    href: "/ia",
    aussi: ["intelligence artificielle", "générées"],
  },
  { titre: "Collections", href: "/collections", aussi: ["rayons"] },
  { titre: "Cartes cadeaux", href: "/cartes-cadeaux", aussi: ["bons cadeaux"] },
  { titre: "Catégories de pièces", href: "/categories-pieces" },
  {
    titre: "Promotions",
    href: "/promotions",
    aussi: ["codes promo", "remises", "soldes", "réductions"],
  },
  {
    titre: "Livraison",
    href: "/livraison",
    aussi: ["frais de port", "transport", "colissimo", "point relais", "tarifs"],
  },
  { titre: "Bandeau du site", href: "/bandeau", aussi: ["annonce", "message en haut"] },
  { titre: "Contenu du site", href: "/contenu", aussi: ["textes", "accueil du site"] },
  { titre: "Pages du site", href: "/pages", aussi: ["mentions", "conditions"] },
  { titre: "Menu du site", href: "/menu", aussi: ["navigation"] },
  {
    titre: "Lettre d'information",
    href: "/lettre",
    aussi: ["abonnés", "envoi aux clients"],
  },
  {
    titre: "Courriers d'essai",
    href: "/courriers",
    aussi: ["mails", "messages automatiques", "confirmation de commande"],
  },
  {
    titre: "Finances",
    href: "/finances",
    aussi: ["chiffre d'affaires", "comptabilité", "marges", "taxes"],
  },
  { titre: "Comptes", href: "/comptes", aussi: ["vendeuses", "accès", "mot de passe"] },
];

/**
 * Les écrans qui correspondent, les mieux placés d'abord.
 *
 * Un titre qui COMMENCE par ce qui est tapé passe devant : « co » doit donner
 * « Commandes en ligne » avant « Cartes cadeaux », qui ne contient le mot
 * qu'au milieu.
 */
function ecransTrouves(saisie: string): ResultatRecherche[] {
  const cherche = aplatir(saisie);
  const trouves: { rang: number; ecran: Ecran }[] = [];
  for (const ecran of ECRANS) {
    const titre = aplatir(ecran.titre);
    const position = titre.indexOf(cherche);
    if (position === 0) trouves.push({ rang: 0, ecran });
    else if (position > 0) trouves.push({ rang: 1, ecran });
    else if ((ecran.aussi ?? []).some((mot) => aplatir(mot).includes(cherche)))
      trouves.push({ rang: 2, ecran });
  }
  return trouves
    .sort((a, b) => a.rang - b.rang || a.ecran.titre.localeCompare(b.ecran.titre, "fr"))
    .slice(0, PAR_CATEGORIE)
    .map(({ ecran }) => ({
      id: `ecran:${ecran.href}`,
      titre: ecran.titre,
      href: ecran.href,
    }));
}

/* -------------------------------------------------------------------------- */
/*  Une catégorie = une fonction                                              */
/* -------------------------------------------------------------------------- */

/** Les affiches dont le nom ou l'adresse contient ce qui est tapé. */
async function chercherAffiches(motif: string): Promise<ResultatRecherche[]> {
  const lignes = await db
    .select({
      id: schema.products.id,
      nom: schema.products.name,
      statut: schema.products.status,
      prixBase: schema.products.basePriceCents,
    })
    .from(schema.products)
    .where(
      or(
        contient(schema.products.name, motif),
        contient(schema.products.slug, motif),
      ),
    )
    // Par ordre alphabétique : on cherche une affiche dont on connaît le nom,
    // pas la dernière créée.
    .orderBy(asc(schema.products.name), asc(schema.products.id))
    .limit(PAR_CATEGORIE);
  if (!lignes.length) return [];

  const ids = lignes.map((l) => l.id);
  // Les prix et les vignettes en deux requêtes pour tout le lot : une par
  // affiche serait cinq allers-retours de plus à chaque frappe.
  const [variantes, images] = await Promise.all([
    db
      .select({
        produit: schema.variants.productId,
        prix: schema.variants.priceCents,
      })
      .from(schema.variants)
      .where(inArray(schema.variants.productId, ids)),
    db
      .select({
        produit: schema.productImages.productId,
        url: schema.productImages.url,
      })
      .from(schema.productImages)
      .where(inArray(schema.productImages.productId, ids))
      .orderBy(asc(schema.productImages.position), asc(schema.productImages.id)),
  ]);

  const fourchette = new Map<number, { min: number; max: number }>();
  for (const v of variantes) {
    const bornes = fourchette.get(v.produit);
    fourchette.set(
      v.produit,
      bornes
        ? { min: Math.min(bornes.min, v.prix), max: Math.max(bornes.max, v.prix) }
        : { min: v.prix, max: v.prix },
    );
  }
  // La première rencontrée est celle de position la plus basse : c'est l'image
  // principale, celle qui illustre déjà l'affiche en boutique.
  const vignette = new Map<number, string>();
  for (const img of images)
    if (!vignette.has(img.produit)) vignette.set(img.produit, img.url);

  return lignes.map((l) => {
    const bornes = fourchette.get(l.id);
    const prix = bornes
      ? bornes.min === bornes.max
        ? euros(bornes.min)
        : `de ${euros(bornes.min)} à ${euros(bornes.max)}`
      : l.prixBase > 0
        ? euros(l.prixBase)
        : null;
    return {
      id: `produit:${l.id}`,
      titre: l.nom,
      detail: ligneDetail(ETAT_AFFICHE[l.statut] ?? l.statut, prix),
      href: `/produits/${l.id}`,
      image: vignette.get(l.id) ?? null,
    };
  });
}

/**
 * Les commandes, par numéro d'abord.
 *
 * Le numéro passe devant le nom parce que c'est ce qu'on a sous les yeux quand
 * on cherche : il est dans le courriel de la cliente, sur le bon de livraison,
 * dans le relevé bancaire. Le nom, lui, est ce qu'on tape faute de mieux.
 *
 * Les paniers abandonnés sont écartés : ce sont des commandes au sens de la
 * base (statut « draft », numéro « DRAFT-… »), mais personne ne les cherche
 * ici, et ils noieraient les vraies commandes sous des lignes sans nom.
 */
async function chercherCommandes(
  motif: string,
  motifSansTiret: string,
): Promise<ResultatRecherche[]> {
  const surLeNumero = contientSansTiret(schema.orders.number, motifSansTiret);
  const lignes = await db
    .select({
      id: schema.orders.id,
      numero: schema.orders.number,
      canal: schema.orders.channel,
      total: schema.orders.totalCents,
      quand: schema.orders.createdAt,
      destinataire: schema.orders.shippingName,
      client: schema.customers.name,
      archivedAt: schema.orders.archivedAt,
    })
    .from(schema.orders)
    .leftJoin(schema.customers, eq(schema.orders.customerId, schema.customers.id))
    .where(
      and(
        notInArray(schema.orders.status, HORS_VENTES),
        or(
          surLeNumero,
          contient(schema.orders.shippingName, motif),
          contient(schema.customers.name, motif),
        ),
      ),
    )
    // Les cinq places du bloc vont d'abord à ce qui correspond au NUMÉRO :
    // sans ce tri, cinq homonymes récents suffiraient à cacher la commande
    // dont on vient de taper le numéro en toutes lettres.
    .orderBy(raw`(${surLeNumero}) desc`, desc(schema.orders.createdAt))
    .limit(PAR_CATEGORIE);

  return lignes.map((l) => ({
    id: `commande:${l.id}`,
    titre: l.numero,
    detail: ligneDetail(
      l.destinataire ?? l.client ?? null,
      jour(l.quand),
      l.canal === "salon" ? "Stand" : "En ligne",
      euros(l.total),
      // Une commande archivée reste trouvable par son numéro : c'est
      // justement ainsi qu'on la retrouve pour la relire ou la restaurer,
      // puisqu'elle a quitté la liste. Elle se dit, plutôt que de se cacher.
      l.archivedAt ? "Archivée" : null,
    ),
    href: `/commandes/${l.id}`,
  }));
}

/** Les clientes, par nom, adresse e-mail ou téléphone. */
async function chercherClients(motif: string): Promise<ResultatRecherche[]> {
  const lignes = await db
    .select({
      id: schema.customers.id,
      nom: schema.customers.name,
      email: schema.customers.email,
      telephone: schema.customers.phone,
    })
    .from(schema.customers)
    .where(
      or(
        contient(schema.customers.name, motif),
        contient(schema.customers.email, motif),
        contient(schema.customers.phone, motif),
      ),
    )
    .orderBy(asc(schema.customers.name), desc(schema.customers.id))
    .limit(PAR_CATEGORIE);
  if (!lignes.length) return [];

  const ids = lignes.map((l) => l.id);
  // Ce qui compte comme une vente est défini une seule fois, dans
  // statuts-vente.ts : un panier abandonné n'est pas une commande.
  const totaux = await db
    .select({
      client: schema.orders.customerId,
      commandes: raw<number>`count(*)::int`,
      cents: raw<number>`coalesce(sum(${schema.orders.totalCents}), 0)::int`,
    })
    .from(schema.orders)
    .where(
      and(
        isNotNull(schema.orders.customerId),
        inArray(schema.orders.customerId, ids),
        notInArray(schema.orders.status, HORS_VENTES),
      ),
    )
    .groupBy(schema.orders.customerId);
  const parClient = new Map(
    totaux.map((t) => [t.client, { commandes: t.commandes, cents: t.cents }]),
  );

  return lignes.map((l) => {
    const compte = parClient.get(l.id);
    return {
      id: `client:${l.id}`,
      // Une fiche sans nom existe : la commande de stand n'exige que le
      // courriel. Mieux vaut l'adresse qu'une ligne vide.
      titre: l.nom?.trim() || l.email || "Client sans nom",
      detail: ligneDetail(
        l.nom?.trim() ? l.email : null,
        compte
          ? `${compte.commandes} commande${compte.commandes > 1 ? "s" : ""} · ${euros(compte.cents)}`
          : "Aucune commande",
      ),
      href: `/clients/${l.id}`,
    };
  });
}

/** Les collections, par nom. */
async function chercherCollections(motif: string): Promise<ResultatRecherche[]> {
  const lignes = await db
    .select({
      id: schema.collections.id,
      nom: schema.collections.name,
      active: schema.collections.active,
      archivedAt: schema.collections.archivedAt,
    })
    .from(schema.collections)
    .where(
      or(
        contient(schema.collections.name, motif),
        contient(schema.collections.slug, motif),
      ),
    )
    .orderBy(asc(schema.collections.position), asc(schema.collections.name))
    .limit(PAR_CATEGORIE);
  if (!lignes.length) return [];

  const ids = lignes.map((l) => l.id);
  const comptes = await db
    .select({ collection: schema.productCollections.collectionId, n: count() })
    .from(schema.productCollections)
    .where(inArray(schema.productCollections.collectionId, ids))
    .groupBy(schema.productCollections.collectionId);
  const parCollection = new Map(comptes.map((r) => [r.collection, Number(r.n)]));

  return lignes.map((l) => {
    const combien = parCollection.get(l.id) ?? 0;
    return {
      id: `collection:${l.id}`,
      titre: l.nom,
      detail: ligneDetail(
        combien === 0
          ? "Aucune affiche"
          : `${combien} affiche${combien > 1 ? "s" : ""}`,
        // Une collection archivée reste trouvable, comme une affiche archivée :
        // on la cherche justement pour la restaurer. Elle se dit, plutôt que
        // de se cacher — sans quoi on la croirait perdue.
        l.archivedAt ? "Archivée" : l.active ? null : "Désactivée",
      ),
      href: `/collections/${l.id}`,
    };
  });
}

/**
 * Les stands, par nom.
 *
 * Le code d'accès n'est même pas LU : il n'est pas dans la projection, donc il
 * ne peut pas partir par distraction dans une réponse. Ce code permet
 * d'enregistrer des commandes déclarées payées ; il se donne de la main à la
 * main, il ne se promène pas dans un panneau de recherche.
 */
async function chercherStands(motif: string): Promise<ResultatRecherche[]> {
  const lignes = await db
    .select({
      id: schema.stands.id,
      nom: schema.stands.nom,
      ouvert: schema.stands.ouvert,
      archivedAt: schema.stands.archivedAt,
    })
    .from(schema.stands)
    .where(contient(schema.stands.nom, motif))
    // Les stands ouverts d'abord : ce sont eux dont on s'occupe.
    .orderBy(desc(schema.stands.ouvert), asc(schema.stands.nom))
    .limit(PAR_CATEGORIE);

  return lignes.map((l) => ({
    id: `stand:${l.id}`,
    titre: l.nom,
    // Un stand archivé reste trouvable : on le cherche justement pour relire
    // ce qu'il a vendu, ou pour le restaurer avant le salon de l'an prochain.
    // Il se dit, plutôt que de se cacher.
    detail: l.archivedAt ? "Archivé" : l.ouvert ? "Ouvert" : "Fermé",
    href: `/ventes-salon?stand=${l.id}`,
  }));
}

/**
 * Les cartes cadeaux, par code.
 *
 * Le code s'affiche en clair, comme dans la liste des cartes : sans lui, un
 * résultat ne dirait pas de quelle carte il parle, et la recherche ne servirait
 * plus à rien au moment précis où elle sert — un client au téléphone qui lit
 * son code. La route est réservée à la propriétaire, voir la garde en tête.
 */
async function chercherCartes(motifSansTiret: string): Promise<ResultatRecherche[]> {
  const lignes = await db
    .select({
      id: schema.giftCards.id,
      code: schema.giftCards.code,
      solde: schema.giftCards.balanceCents,
      statut: schema.giftCards.status,
      expire: schema.giftCards.expiresAt,
    })
    .from(schema.giftCards)
    .where(contientSansTiret(schema.giftCards.code, motifSansTiret))
    .orderBy(desc(schema.giftCards.createdAt), desc(schema.giftCards.id))
    .limit(PAR_CATEGORIE);

  const maintenant = new Date();
  return lignes.map((l) => ({
    id: `carte:${l.id}`,
    titre: l.code,
    detail: ligneDetail(
      `Solde ${euros(l.solde)}`,
      l.statut === "disabled"
        ? "Désactivée"
        : l.expire && l.expire < maintenant
          ? "Périmée"
          : null,
    ),
    href: `/cartes-cadeaux?carte=${l.id}`,
  }));
}

/**
 * Une catégorie qui échoue ne fait pas tomber les six autres.
 *
 * La recherche est le seul écran qui interroge SEPT parties du back-office à la
 * fois : elle a donc sept fois plus d'occasions de rencontrer une table en
 * retard de migration ou une donnée abîmée. Sans ce filet, la moindre de ces
 * pannes rendrait la barre de recherche entièrement muette, alors que six
 * catégories sur sept répondaient très bien.
 *
 * L'erreur n'est pas avalée pour autant : elle part dans le journal du serveur,
 * là où on la cherchera. C'est l'écran qui reste utilisable, pas le problème
 * qui disparaît.
 */
async function sansTomber(
  categorie: string,
  chercher: () => Promise<ResultatRecherche[]>,
): Promise<ResultatRecherche[]> {
  try {
    return await chercher();
  } catch (erreur) {
    console.error(`[recherche] ${categorie} : recherche impossible`, erreur);
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/*  La route                                                                  */
/* -------------------------------------------------------------------------- */

export function mountRecherche(app: Hono): void {
  /**
   * GET /admin/recherche?q=…
   *
   * Toutes les catégories sont interrogées EN MÊME TEMPS. La recherche se tape
   * lettre par lettre : sept requêtes à la suite additionneraient sept fois la
   * latence de la base et le panneau traînerait derrière la frappe.
   */
  app.get("/admin/recherche", async (c) => {
    // La garde de « /admin/* » (index.ts) n'ouvre au propriétaire que ce qui
    // n'est pas une lecture, et n'autorise un vendeur que sur une liste
    // d'écrans nommés — celui-ci n'en fait pas partie. On le redit ici quand
    // même : cette route lit des noms de clientes, des adresses, des montants
    // et des numéros de commande du site. Le jour où quelqu'un ajoute
    // « /admin/recherche » à cette liste sans y penser, le refus tient encore.
    if (c.get("utilisateur")?.role !== "owner")
      return c.json(
        { error: "Cette recherche est réservée au propriétaire." },
        403,
      );

    const saisie = (c.req.query("q") ?? "").trim();
    // Rien ne part avant deux caractères : la réponse a la même forme, elle est
    // simplement vide, et le panneau n'a pas de cas particulier à traiter.
    if (saisie.length < MINIMUM_CARACTERES)
      return c.json({ q: saisie, groupes: [] });

    const motif = motifDe(saisie);
    const motifSansTiret = motifDe(saisie.replace(/-/g, ""));

    const [affiches, commandes, clients, collections, stands, cartes] =
      await Promise.all([
        sansTomber("affiches", () => chercherAffiches(motif)),
        sansTomber("commandes", () => chercherCommandes(motif, motifSansTiret)),
        sansTomber("clients", () => chercherClients(motif)),
        sansTomber("collections", () => chercherCollections(motif)),
        sansTomber("stands", () => chercherStands(motif)),
        sansTomber("cartes cadeaux", () => chercherCartes(motifSansTiret)),
      ]);

    // Les données d'abord, les écrans à la fin : quand on tape un nom ou un
    // numéro, c'est l'élément qu'on veut, et il doit être le premier que la
    // touche Entrée ouvre. Quand on tape « livr », rien d'autre ne répond et
    // l'écran se retrouve premier de lui-même.
    const tous: GroupeRecherche[] = [
      { genre: "produit", titre: "Affiches", resultats: affiches },
      { genre: "commande", titre: "Commandes", resultats: commandes },
      { genre: "client", titre: "Clients", resultats: clients },
      { genre: "collection", titre: "Collections", resultats: collections },
      { genre: "stand", titre: "Stands", resultats: stands },
      { genre: "carte", titre: "Cartes cadeaux", resultats: cartes },
      { genre: "ecran", titre: "Écrans", resultats: ecransTrouves(saisie) },
    ];
    // Un groupe vide ne figure pas dans la réponse : un panneau plein de
    // titres sans rien dessous ne se lit pas.
    const groupes = tous.filter((g) => g.resultats.length > 0);

    return c.json({ q: saisie, groupes });
  });
}
