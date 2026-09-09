/**
 * Créer ou corriger des dizaines de fiches produit d'un coup, à partir d'un
 * fichier.
 *
 * La boutique reçoit ses affiches par fournées : quarante visuels d'une même
 * série arrivent ensemble, avec leurs noms, leurs deux formats, leurs prix et
 * leur rangement. Les saisir fiche par fiche, c'est une demi-journée de clics
 * et la certitude d'en oublier une ; les coller dans un tableur et déposer le
 * fichier ici, c'est une minute.
 *
 * Trois précautions gouvernent ce fichier, et chacune répare une façon connue
 * de perdre un catalogue.
 *
 * D'abord, RIEN n'est écrit tant qu'on ne l'a pas demandé deux fois. L'appel
 * sans « appliquer » relit le fichier entier, le confronte au catalogue et rend
 * la liste de ce qui serait créé, mis à jour, laissé tel quel ou écarté, avec
 * la raison. On regarde, puis on décide. Un import de quarante affiches ne se
 * lance pas à l'aveugle.
 *
 * Ensuite, un import AJOUTE et CORRIGE, il n'enlève jamais. Un format absent du
 * fichier reste en vente, une collection reste attachée, une image reste en
 * place, et un champ laissé vide dans le tableur ne vient pas effacer ce que la
 * fiche disait de mieux. Le fichier apporte ce qu'il sait ; il ne fait pas
 * autorité sur ce qu'il ignore.
 *
 * Enfin, tout tient dans une seule transaction. Un catalogue à moitié importé
 * — vingt affiches passées, vingt restées en arrière, et personne pour savoir
 * lesquelles — serait bien pire que pas d'import du tout.
 *
 * Le fichier attendu est l'export d'une boutique Shopify : une ligne par
 * format, donc deux lignes par affiche, l'adresse (« Handle ») répétée d'une
 * ligne à l'autre. Les colonnes qui ne mènent nulle part dans ce schéma sont
 * lues puis laissées de côté : la catégorie Google, l'obligation d'expédier et
 * la TVA n'ont pas de case ici, et inventer une colonne pour les loger serait
 * du rangement pour rien.
 */
import type { Hono } from "hono";
import { asc, eq, inArray } from "drizzle-orm";
import { POSTER_FORMATS } from "@memoryline/types";
import { db, schema } from "./db/client.js";

/** Les seuls états qu'un produit peut prendre. */
const STATUTS = ["active", "draft", "archived"] as const;
type StatutProduit = (typeof STATUTS)[number];

/**
 * Bornes du fichier accepté.
 *
 * Elles ne protègent pas d'une malveillance — seule la propriétaire entre ici
 * — mais d'un fichier envoyé par erreur : un export de toute la boutique, ou
 * une image renommée en .csv. Mieux vaut une phrase lisible tout de suite
 * qu'un serveur qui mouline dix minutes avant de rendre les armes.
 */
const CARACTERES_MAX = 4_000_000;
const LIGNES_MAX = 5_000;
const PRODUITS_MAX = 1_000;

/** Au-delà, ce n'est plus un nom de collection, c'est un paragraphe. */
const NOM_COLLECTION_MAX = 80;

/** Une affiche rangée dans vingt collections ne serait plus rangée du tout. */
const COLLECTIONS_PAR_PRODUIT_MAX = 20;

/**
 * Borne haute des montants, en centimes : un million d'euros.
 *
 * Rien à voir avec la boutique, tout à voir avec la base : un entier Postgres
 * s'arrête à 2 147 483 647, et un zéro de trop collé à un prix ferait échouer
 * l'import entier sur une erreur que personne ne saurait lire.
 */
const MONTANT_MAX_CENTS = 100_000_000;

/**
 * Un fichier que l'on refuse en bloc, avec la phrase à montrer.
 *
 * Réservé à ce qui rend l'import impossible : un fichier vide, illisible, ou
 * dont il manque une colonne indispensable. Une affiche fautive, elle, ne fait
 * pas tomber les autres : elle ressort seule dans l'aperçu, nommée et
 * expliquée.
 */
class FichierRefuse extends Error {}

/* ------------------------------------------------------------------------ */
/*  Lecture du fichier                                                      */
/* ------------------------------------------------------------------------ */

/**
 * Découpe un fichier CSV en lignes de champs.
 *
 * Découper sur la virgule ne marcherait pas une seule seconde sur ce
 * fichier-ci : la description de chaque affiche tient sur deux paragraphes et
 * la liste des étiquettes est elle-même une liste de mots séparés par des
 * virgules. Les deux vivent entre guillemets, avec des retours à la ligne et
 * des guillemets doublés à l'intérieur, et seul un vrai lecteur les rend
 * intacts.
 *
 * Le fichier peut aussi commencer par une marque d'ordre d'octets — trois
 * octets invisibles qu'Excel écrit en tête de ses exports. Laissée en place,
 * elle se collerait au nom de la première colonne, et « Handle » deviendrait
 * introuvable.
 */
export function lireCsv(texte: string): string[][] {
  const sansMarque = texte.charCodeAt(0) === 0xfeff ? texte.slice(1) : texte;
  const lignes: string[][] = [];
  let champs: string[] = [];
  let champ = "";
  let entreGuillemets = false;
  let i = 0;

  while (i < sansMarque.length) {
    const c = sansMarque[i];

    if (entreGuillemets) {
      if (c === '"') {
        // Deux guillemets collés, c'est un guillemet dans le texte ; un seul,
        // c'est la fin du champ.
        if (sansMarque[i + 1] === '"') {
          champ += '"';
          i += 2;
          continue;
        }
        entreGuillemets = false;
        i += 1;
        continue;
      }
      // Les retours à la ligne d'un champ cité sont ramenés à une forme unique,
      // sans quoi la même description reviendrait tantôt avec, tantôt sans le
      // retour chariot d'Excel, et se croirait modifiée à chaque import.
      if (c === "\r") {
        if (sansMarque[i + 1] === "\n") i += 1;
        champ += "\n";
        i += 1;
        continue;
      }
      champ += c;
      i += 1;
      continue;
    }

    // Un guillemet n'ouvre un champ cité qu'en tête de champ : ailleurs, c'est
    // un guillemet ordinaire, comme dans « affiche 30" ».
    if (c === '"' && champ === "") {
      entreGuillemets = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      champs.push(champ);
      champ = "";
      i += 1;
      continue;
    }
    if (c === "\r" || c === "\n") {
      if (c === "\r" && sansMarque[i + 1] === "\n") i += 1;
      champs.push(champ);
      lignes.push(champs);
      champs = [];
      champ = "";
      i += 1;
      continue;
    }
    champ += c;
    i += 1;
  }

  // La dernière ligne n'est suivie d'aucun retour quand le fichier s'arrête
  // net ; sans ce rattrapage, la dernière affiche du fichier serait perdue.
  if (champ !== "" || champs.length) {
    champs.push(champ);
    lignes.push(champs);
  }
  return lignes;
}

/** Un nom de colonne comparable : espaces resserrés, casse ignorée. */
function normaliserEntete(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, " ");
}

/* ------------------------------------------------------------------------ */
/*  Lecture des valeurs                                                     */
/* ------------------------------------------------------------------------ */

/**
 * L'adresse d'une affiche : ce qui l'identifie d'un import à l'autre.
 *
 * C'est le « Handle » du fichier, comparé à l'adresse web du produit. Les deux
 * s'écrivent déjà de la même façon dans un export Shopify, et le nettoyage
 * ci-dessous ne sert qu'aux fichiers écrits à la main : accents retirés,
 * majuscules abaissées, espaces changés en traits d'union. C'est cette
 * comparaison qui évite de recréer quarante affiches déjà en ligne.
 */
function adresseProduit(valeur: string): string {
  return valeur
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

/** Adresse d'une collection, lisible et stable. */
function adresseCollection(nom: string): string {
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

/** Texte libre borné ; un champ vide vaut null, jamais chaîne vide. */
function texteOuNull(v: string, max: number): string | null {
  return v.trim().slice(0, max) || null;
}

/** Un montant en centimes, écrit en toutes lettres pour l'aperçu. */
function euros(cents: number): string {
  const entier = Math.floor(Math.abs(cents) / 100);
  const centiemes = Math.abs(cents) % 100;
  const signe = cents < 0 ? "-" : "";
  return centiemes === 0
    ? `${signe}${entier} €`
    : `${signe}${entier},${String(centiemes).padStart(2, "0")} €`;
}

/**
 * Un prix écrit en euros, rendu en centimes.
 *
 * Le point le plus délicat de tout ce fichier. `Math.round(Number(""))` vaut
 * ZÉRO : lire une case de prix sans distinguer « vide » de « zéro » ferait
 * entrer une affiche gratuite dans le catalogue, et la boutique la vendrait
 * ainsi jusqu'à ce que quelqu'un s'en aperçoive. Une case vide, une lettre
 * égarée, un moins : tout cela est refusé et expliqué, jamais corrigé en
 * douce.
 *
 * Renvoie null quand la valeur n'est pas un prix ; l'appelant sait mieux que
 * cette fonction quelle phrase montrer.
 */
function centimesDepuisEuros(brut: string): number | null {
  const texte = brut
    .replace(/[\s ]/g, "")
    .replace(/€|eur/gi, "")
    .replace(",", ".");
  if (!texte) return null;
  if (!/^\d+(\.\d+)?$/.test(texte)) return null;
  const montant = Number(texte);
  if (!Number.isFinite(montant)) return null;
  const cents = Math.round(montant * 100);
  if (cents < 0 || cents > MONTANT_MAX_CENTS) return null;
  return cents;
}

/**
 * Un oui ou un non écrit dans une case.
 *
 * Les tableurs en connaissent une bonne dizaine d'orthographes selon la langue
 * de la machine qui a produit l'export. Renvoie null quand la case ne dit ni
 * l'un ni l'autre : c'est à l'appelant de décider si le silence est grave.
 */
function ouiOuNon(brut: string): boolean | null {
  const mot = brut.trim().toLowerCase();
  if (!mot) return null;
  if (["true", "1", "oui", "vrai", "yes", "y", "o"].includes(mot)) return true;
  if (["false", "0", "non", "faux", "no", "n"].includes(mot)) return false;
  return null;
}

/**
 * Le format vendu, tiré de la case « Option1 Value ».
 *
 * Le fichier y écrit « A4 (21 x 29.7 cm) » : le format est le premier mot, le
 * reste n'est qu'un rappel des dimensions à l'usage du client.
 */
function formatDepuisOption(brut: string): string {
  const premier = brut.trim().split(/\s+/)[0] ?? "";
  return premier.replace(/[^\p{L}\p{N}]+$/u, "").slice(0, 40);
}

/** Le format tel que la boutique l'écrit, ou null si elle ne le vend pas. */
function formatConnu(format: string): string | null {
  return (
    (POSTER_FORMATS as readonly string[]).find(
      (f) => f.toLowerCase() === format.toLowerCase(),
    ) ?? null
  );
}

/** L'état d'une fiche, dit comme la propriétaire le dirait. */
function etatEnFrancais(statut: string): string {
  if (statut === "draft") return "brouillon";
  if (statut === "archived") return "archivée";
  return "en ligne";
}

/**
 * Les étiquettes d'une ligne, qui deviendront des collections.
 *
 * Une liste de noms séparés par des virgules, dédoublonnée sans tenir compte
 * de la casse : « Villes » et « villes » désignent le même rayon, et en créer
 * deux donnerait deux pages de boutique à moitié remplies chacune.
 */
function etiquettes(brut: string): string[] {
  const propres = new Map<string, string>();
  for (const morceau of brut.split(",")) {
    const nom = morceau.trim().replace(/\s+/g, " ").slice(0, NOM_COLLECTION_MAX);
    if (nom && !propres.has(nom.toLowerCase())) propres.set(nom.toLowerCase(), nom);
  }
  return [...propres.values()].slice(0, COLLECTIONS_PAR_PRODUIT_MAX);
}

/* ------------------------------------------------------------------------ */
/*  Ce que le fichier raconte                                               */
/* ------------------------------------------------------------------------ */

/** Un format lu dans le fichier, prêt à être comparé au catalogue. */
interface FormatLu {
  format: string;
  prixCents: number;
  sku: string | null;
}

/** Une affiche telle que le fichier la décrit, toutes ses lignes réunies. */
interface ProduitLu {
  /** Le « Handle » tel qu'il est écrit, pour que la propriétaire s'y retrouve. */
  handle: string;
  /** L'adresse comparée au catalogue : c'est elle qui identifie l'affiche. */
  adresse: string;
  /** Ligne du tableur où l'affiche apparaît pour la première fois. */
  ligne: number;
  nom: string;
  description: string | null;
  vendeur: string | null;
  typeProduit: string | null;
  titreGoogle: string | null;
  descriptionGoogle: string | null;
  /** Null quand le fichier ne se prononce pas : on ne touche alors à rien. */
  statut: StatutProduit | null;
  collections: string[];
  formats: FormatLu[];
  /** La phrase qui écarte l'affiche, quand quelque chose ne se lit pas. */
  refus: string | null;
}

/** Une ligne du fichier, ses champs rangés par nom de colonne. */
type LigneNommee = (colonne: string) => string;

/**
 * Rassemble les lignes du fichier en affiches.
 *
 * Deux conventions coexistent dans les exports, et il faut les servir toutes
 * les deux. Certains répètent tous les champs de l'affiche sur chacune de ses
 * lignes ; d'autres ne les écrivent que sur la première et laissent les
 * suivantes vides. D'où la règle retenue : pour chaque champ, la première
 * valeur NON VIDE rencontrée l'emporte. Une case vide sur une ligne de suite
 * ne peut donc jamais effacer ce que la première ligne a dit.
 */
export function rassemblerProduits(
  lignes: LigneNommee[],
  numeros: number[],
): ProduitLu[] {
  const parAdresse = new Map<string, ProduitLu>();
  // Les formats déjà vus, affiche par affiche : deux « A4 » sur la même
  // affiche, et la boutique proposerait deux fois le même choix à deux prix.
  const formatsVus = new Map<string, Set<string>>();

  for (const [rang, lire] of lignes.entries()) {
    const numero = numeros[rang] ?? rang + 2;
    const handle = lire("handle").trim();
    const adresse = adresseProduit(handle);
    if (!adresse) continue;

    let produit = parAdresse.get(adresse);
    if (!produit) {
      produit = {
        handle: handle.slice(0, 200),
        adresse,
        ligne: numero,
        nom: "",
        description: null,
        vendeur: null,
        typeProduit: null,
        titreGoogle: null,
        descriptionGoogle: null,
        statut: null,
        collections: [],
        formats: [],
        refus: null,
      };
      parAdresse.set(adresse, produit);
      formatsVus.set(adresse, new Set());
    }

    /* -- Les champs de l'affiche : la première valeur écrite gagne -------- */

    if (!produit.nom) produit.nom = lire("title").trim().slice(0, 200);
    if (produit.description === null)
      produit.description = texteOuNull(lire("body (html)"), 20_000);
    if (produit.vendeur === null)
      produit.vendeur = texteOuNull(lire("vendor"), 120);
    if (produit.typeProduit === null)
      produit.typeProduit = texteOuNull(lire("type"), 120);
    if (produit.titreGoogle === null)
      produit.titreGoogle = texteOuNull(lire("seo title"), 200);
    if (produit.descriptionGoogle === null)
      produit.descriptionGoogle = texteOuNull(lire("seo description"), 400);
    if (!produit.collections.length)
      produit.collections = etiquettes(lire("tags"));

    if (produit.statut === null && !produit.refus) {
      const brut = lire("status").trim().toLowerCase();
      if (brut) {
        if ((STATUTS as readonly string[]).includes(brut)) {
          produit.statut = brut as StatutProduit;
        } else {
          produit.refus = `La colonne « Status » indique « ${brut.slice(0, 40)} » à la ligne ${numero}. Écrivez « active » pour mettre en ligne, « draft » pour garder en brouillon, ou « archived » pour archiver.`;
        }
      }
    }

    // « Published » à non veut dire brouillon, quoi que dise « Status », sauf
    // pour une affiche archivée : archivée est déjà plus fort que brouillon.
    if (!produit.refus) {
      const brutPublie = lire("published").trim();
      if (brutPublie) {
        const publie = ouiOuNon(brutPublie);
        if (publie === null) {
          produit.refus = `La colonne « Published » indique « ${brutPublie.slice(0, 40)} » à la ligne ${numero}, qui ne veut dire ni oui ni non. Écrivez TRUE ou FALSE.`;
        } else if (!publie && produit.statut !== "archived") {
          produit.statut = "draft";
        }
      }
    }

    /* -- Le format porté par CETTE ligne ---------------------------------- */

    const brutFormat = lire("option1 value").trim();
    const brutPrix = lire("variant price").trim();
    const brutSku = lire("variant sku").trim();

    // Une ligne qui ne dit rien d'un format n'en décrit pas : dans un export
    // Shopify, c'est une ligne de suite qui ne porte qu'une image ou un champ
    // que ce schéma n'a pas. Elle a déjà donné ce qu'elle savait de l'affiche.
    if (!brutFormat && !brutPrix && !brutSku) continue;
    if (produit.refus) continue;

    if (!brutFormat) {
      produit.refus = `La ligne ${numero} indique un prix mais aucun format. Écrivez le format dans la colonne « Option1 Value », par exemple « A4 (21 x 29.7 cm) ».`;
      continue;
    }

    const format = formatDepuisOption(brutFormat);
    const connu = format ? formatConnu(format) : null;
    if (!connu) {
      produit.refus = `La boutique ne sait pas vendre le format « ${brutFormat.slice(0, 40)} » demandé à la ligne ${numero}. Les formats possibles sont ${POSTER_FORMATS.join(" et ")}.`;
      continue;
    }

    const dejaVus = formatsVus.get(adresse);
    if (dejaVus?.has(connu)) {
      produit.refus = `Le format ${connu} est indiqué deux fois pour cette affiche, jusqu'à la ligne ${numero}. Une affiche ne peut proposer qu'une seule fois le même format.`;
      continue;
    }

    if (!brutPrix) {
      produit.refus = `Le prix du format ${connu} n'est pas rempli à la ligne ${numero}. Une affiche sans prix ne peut pas être mise en vente.`;
      continue;
    }
    const prixCents = centimesDepuisEuros(brutPrix);
    if (prixCents === null) {
      produit.refus = `Le prix « ${brutPrix.slice(0, 40)} » du format ${connu}, ligne ${numero}, ne se lit pas comme un montant en euros. Écrivez par exemple 29 ou 29,50.`;
      continue;
    }

    dejaVus?.add(connu);
    produit.formats.push({
      format: connu,
      prixCents,
      sku: texteOuNull(brutSku, 60),
    });
  }

  // Ce qui ne se voit qu'une fois toutes les lignes lues.
  for (const produit of parAdresse.values()) {
    if (produit.refus) continue;
    if (!produit.nom) {
      produit.refus = `Cette affiche n'a pas de nom (colonne « Title », ligne ${produit.ligne}).`;
      continue;
    }
    if (!produit.formats.length)
      produit.refus = `Aucun format n'est indiqué pour cette affiche (ligne ${produit.ligne}). Il en faut au moins un, avec son prix.`;
  }

  return [...parAdresse.values()];
}

/* ------------------------------------------------------------------------ */
/*  Ce que l'import répond                                                  */
/* ------------------------------------------------------------------------ */

/** Ce qu'un import ferait, ou vient de faire, sur une fiche. */
interface LigneImport {
  handle: string;
  nom: string;
  action: "creation" | "mise-a-jour" | "inchange" | "refus";
  raison?: string;
  changements: string[];
  collections: string[];
  formats: { format: string; prixCents: number; sku: string | null }[];
  produitId?: number;
  sansImage?: boolean;
}

export function mountImportProduits(app: Hono): void {
  /* ---------------------------------------------------------------------- */
  /*  L'import lui-même                                                     */
  /* ---------------------------------------------------------------------- */

  /**
   * Lit un fichier d'affiches, dit ce qu'il ferait, et ne l'écrit que si on
   * le lui demande.
   *
   * Sans « appliquer », la réponse est un aperçu : la même liste, les mêmes
   * phrases, mais pas une ligne écrite en base. C'est le mode par défaut, et
   * c'est volontaire — on veut pouvoir se tromper de fichier.
   */
  app.post("/admin/products/import", async (c) => {
    const corps = (await c.req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const appliquer = corps.appliquer === true;

    try {
      /* -- Le fichier est-il seulement lisible ? ------------------------- */

      if (typeof corps.csv !== "string")
        throw new FichierRefuse(
          "Aucun fichier n'a été reçu. Choisissez un fichier, ou collez son contenu.",
        );
      if (!corps.csv.trim())
        throw new FichierRefuse("Ce fichier est vide.");
      if (corps.csv.length > CARACTERES_MAX)
        throw new FichierRefuse(
          `Ce fichier est trop gros pour être importé d'un seul coup. Coupez-le en plusieurs fichiers d'environ ${LIGNES_MAX} lignes.`,
        );

      const brut = lireCsv(corps.csv);
      const entete = brut[0];
      if (!entete || entete.length < 2)
        throw new FichierRefuse(
          "Ce fichier ne ressemble pas à un export de produits. La première ligne doit porter les noms des colonnes : Handle, Title, Option1 Value, Variant Price…",
        );

      const colonnes = new Map<string, number>();
      for (const [rang, nom] of entete.entries()) {
        const propre = normaliserEntete(nom);
        // La première colonne d'un nom donné gagne : un export qui répète une
        // colonne ne doit pas faire lire la copie vide plutôt que l'originale.
        if (propre && !colonnes.has(propre)) colonnes.set(propre, rang);
      }
      // « Body html » sans les parenthèses se rencontre sur les fichiers
      // retapés à la main ; c'est la même colonne.
      const rangBody = colonnes.get("body (html)") ?? colonnes.get("body html");
      if (rangBody !== undefined) colonnes.set("body (html)", rangBody);

      const manquantes = ["handle", "title", "option1 value", "variant price"]
        .filter((nom) => !colonnes.has(nom))
        .map((nom) =>
          nom === "handle"
            ? "Handle"
            : nom === "title"
              ? "Title"
              : nom === "option1 value"
                ? "Option1 Value"
                : "Variant Price",
        );
      if (manquantes.length)
        throw new FichierRefuse(
          `Il manque ${manquantes.length > 1 ? "les colonnes" : "la colonne"} ${manquantes.map((n) => `« ${n} »`).join(", ")} dans ce fichier. Sans ${manquantes.length > 1 ? "elles" : "elle"}, les affiches ne peuvent pas être reconnues.`,
        );

      /* -- Les lignes de données ----------------------------------------- */

      const lignesNommees: LigneNommee[] = [];
      const numeros: number[] = [];
      for (const [rang, champs] of brut.slice(1).entries()) {
        // Une ligne entièrement vide n'est pas une affiche : les tableurs en
        // sèment volontiers en fin de fichier.
        if (!champs.some((v) => v.trim() !== "")) continue;
        // Le numéro montré est celui du TABLEUR : l'en-tête est la ligne 1,
        // la première affiche la ligne 2. C'est ce que la propriétaire voit à
        // l'écran quand elle rouvre son fichier pour le corriger.
        numeros.push(rang + 2);
        lignesNommees.push((colonne) => {
          const index = colonnes.get(colonne);
          return index === undefined ? "" : (champs[index] ?? "");
        });
      }

      if (!lignesNommees.length)
        throw new FichierRefuse(
          "Ce fichier ne contient que ses noms de colonnes, aucune affiche.",
        );
      if (lignesNommees.length > LIGNES_MAX)
        throw new FichierRefuse(
          `Ce fichier contient ${lignesNommees.length} lignes, c'est trop pour un seul import. Coupez-le en fichiers d'environ ${LIGNES_MAX} lignes.`,
        );

      const produitsLus = rassemblerProduits(lignesNommees, numeros);
      if (produitsLus.length > PRODUITS_MAX)
        throw new FichierRefuse(
          `Ce fichier décrit ${produitsLus.length} affiches, c'est trop pour un seul import. Coupez-le en plusieurs fichiers.`,
        );

      /* -- Confrontation au catalogue, et écriture ------------------------ */

      // Tout se passe dans UNE transaction, y compris l'aperçu. Le catalogue
      // lu est alors exactement celui sur lequel on écrit : sans cela, une
      // collection créée entre la lecture et l'écriture ferait apparaître un
      // doublon que l'aperçu n'avait pas annoncé.
      const resultat = await db.transaction(async (tx) => {
        const adresses = produitsLus.map((p) => p.adresse);

        const dejaLa = adresses.length
          ? await tx
              .select({
                id: schema.products.id,
                slug: schema.products.slug,
                name: schema.products.name,
                description: schema.products.description,
                status: schema.products.status,
                vendor: schema.products.vendor,
                productType: schema.products.productType,
                seoTitle: schema.products.seoTitle,
                seoDescription: schema.products.seoDescription,
              })
              .from(schema.products)
              .where(inArray(schema.products.slug, adresses))
          : [];
        const produitParAdresse = new Map(dejaLa.map((p) => [p.slug, p]));
        const identifiants = dejaLa.map((p) => p.id);

        const variantesExistantes = identifiants.length
          ? await tx
              .select({
                id: schema.variants.id,
                productId: schema.variants.productId,
                format: schema.variants.format,
                priceCents: schema.variants.priceCents,
                sku: schema.variants.sku,
              })
              .from(schema.variants)
              .where(inArray(schema.variants.productId, identifiants))
          : [];
        const variantesParProduit = new Map<
          number,
          (typeof variantesExistantes)[number][]
        >();
        for (const v of variantesExistantes) {
          const liste = variantesParProduit.get(v.productId);
          if (liste) liste.push(v);
          else variantesParProduit.set(v.productId, [v]);
        }

        const imagesExistantes = identifiants.length
          ? await tx
              .select({ productId: schema.productImages.productId })
              .from(schema.productImages)
              .where(inArray(schema.productImages.productId, identifiants))
          : [];
        const imagesParProduit = new Map<number, number>();
        for (const i of imagesExistantes)
          imagesParProduit.set(
            i.productId,
            (imagesParProduit.get(i.productId) ?? 0) + 1,
          );

        const liensExistants = identifiants.length
          ? await tx
              .select({
                productId: schema.productCollections.productId,
                collectionId: schema.productCollections.collectionId,
                position: schema.productCollections.position,
              })
              .from(schema.productCollections)
              .where(inArray(schema.productCollections.productId, identifiants))
          : [];
        const liensParProduit = new Map<number, Set<number>>();
        const dernierRangParProduit = new Map<number, number>();
        for (const l of liensExistants) {
          const dejaLiees = liensParProduit.get(l.productId);
          if (dejaLiees) dejaLiees.add(l.collectionId);
          else liensParProduit.set(l.productId, new Set([l.collectionId]));
          dernierRangParProduit.set(
            l.productId,
            Math.max(dernierRangParProduit.get(l.productId) ?? -1, l.position),
          );
        }

        /* -- Les collections nommées par les étiquettes ------------------- */

        const collectionsBase = await tx
          .select({
            id: schema.collections.id,
            name: schema.collections.name,
            slug: schema.collections.slug,
          })
          .from(schema.collections);
        // Deux façons de reconnaître une collection déjà là : son nom, et son
        // adresse. La seconde rattrape les accents et la ponctuation, pour ne
        // pas créer « Noël » à côté de « Noel ».
        const collectionParNom = new Map<string, number>();
        const collectionParAdresse = new Map<string, number>();
        const adressesPrises = new Set<string>();
        for (const col of collectionsBase) {
          collectionParNom.set(col.name.trim().toLowerCase(), col.id);
          collectionParAdresse.set(col.slug, col.id);
          adressesPrises.add(col.slug);
        }
        const trouverCollection = (nom: string): number | undefined =>
          collectionParNom.get(nom.trim().toLowerCase()) ??
          collectionParAdresse.get(adresseCollection(nom));

        // Les noms cités par le fichier, dans l'ordre où ils apparaissent :
        // l'aperçu doit pouvoir les annoncer avant que rien n'existe.
        const nomsCites: string[] = [];
        const nomsVus = new Set<string>();
        for (const p of produitsLus) {
          if (p.refus) continue;
          for (const nom of p.collections) {
            const cle = nom.toLowerCase();
            if (nomsVus.has(cle)) continue;
            nomsVus.add(cle);
            nomsCites.push(nom);
          }
        }
        const aCreer = nomsCites.filter(
          (nom) => trouverCollection(nom) === undefined,
        );
        const collectionsCreees: string[] = [];

        if (appliquer) {
          for (const nom of aCreer) {
            // Adresse unique : deux « Villes » se distinguent par un suffixe
            // plutôt que de faire échouer tout l'import sur une contrainte.
            const base = adresseCollection(nom);
            let adresse = base;
            for (let i = 2; adressesPrises.has(adresse); i += 1)
              adresse = `${base}-${i}`;
            const [creee] = await tx
              .insert(schema.collections)
              .values({ name: nom, slug: adresse })
              .returning({ id: schema.collections.id });
            if (!creee)
              throw new FichierRefuse(
                `La collection « ${nom} » n'a pas pu être créée. Rien n'a été importé, réessayez.`,
              );
            adressesPrises.add(adresse);
            collectionParNom.set(nom.trim().toLowerCase(), creee.id);
            collectionParAdresse.set(adresse, creee.id);
            collectionsCreees.push(nom);
          }
        } else {
          collectionsCreees.push(...aCreer);
        }
        const aCreerEnMinuscules = new Set(aCreer.map((n) => n.toLowerCase()));

        /* -- Affiche par affiche ------------------------------------------ */

        const apercu: LigneImport[] = [];

        for (const lu of produitsLus) {
          if (lu.refus) {
            apercu.push({
              handle: lu.handle,
              nom: lu.nom || lu.handle,
              action: "refus",
              raison: lu.refus,
              changements: [],
              collections: lu.collections,
              formats: lu.formats,
            });
            continue;
          }

          const existant = produitParAdresse.get(lu.adresse);
          const changements: string[] = [];

          /* -- Ce que le fichier changerait sur une affiche déjà là ------- */

          if (existant) {
            if (lu.nom && lu.nom !== existant.name)
              changements.push(
                `nom : « ${existant.name} » vers « ${lu.nom} »`,
              );
            if (lu.description !== null && lu.description !== existant.description)
              changements.push("description réécrite");
            if (lu.vendeur !== null && lu.vendeur !== existant.vendor)
              changements.push(
                `fournisseur : ${existant.vendor ? `« ${existant.vendor} » vers ` : ""}« ${lu.vendeur} »`,
              );
            if (lu.typeProduit !== null && lu.typeProduit !== existant.productType)
              changements.push(
                `type de produit : ${existant.productType ? `« ${existant.productType} » vers ` : ""}« ${lu.typeProduit} »`,
              );
            if (lu.statut !== null && lu.statut !== existant.status)
              changements.push(
                `état : ${etatEnFrancais(existant.status)} vers ${etatEnFrancais(lu.statut)}`,
              );
            if (lu.titreGoogle !== null && lu.titreGoogle !== existant.seoTitle)
              changements.push("titre pour Google réécrit");
            if (
              lu.descriptionGoogle !== null &&
              lu.descriptionGoogle !== existant.seoDescription
            )
              changements.push("description pour Google réécrite");

            const variantes = variantesParProduit.get(existant.id) ?? [];
            for (const format of lu.formats) {
              const ancienne = variantes.find(
                (v) => v.format.toLowerCase() === format.format.toLowerCase(),
              );
              if (!ancienne) {
                changements.push(
                  `nouveau format ${format.format} à ${euros(format.prixCents)}`,
                );
                continue;
              }
              if (ancienne.priceCents !== format.prixCents)
                changements.push(
                  `prix ${format.format} : ${euros(ancienne.priceCents)} vers ${euros(format.prixCents)}`,
                );
              if (format.sku !== null && format.sku !== ancienne.sku)
                changements.push(
                  `référence ${format.format} : ${ancienne.sku ? `« ${ancienne.sku} » vers ` : ""}« ${format.sku} »`,
                );
            }

            const dejaLiees = liensParProduit.get(existant.id) ?? new Set();
            for (const nom of lu.collections) {
              const collectionId = trouverCollection(nom);
              const nouvelle = aCreerEnMinuscules.has(nom.toLowerCase());
              if (!nouvelle && collectionId !== undefined && dejaLiees.has(collectionId))
                continue;
              changements.push(
                nouvelle
                  ? `rangée dans « ${nom} », une collection qui sera créée`
                  : `rangée dans « ${nom} »`,
              );
            }
          }

          const action: LigneImport["action"] = !existant
            ? "creation"
            : changements.length
              ? "mise-a-jour"
              : "inchange";

          const ligne: LigneImport = {
            handle: lu.handle,
            nom: lu.nom,
            action,
            changements,
            collections: lu.collections,
            formats: lu.formats,
            sansImage: existant ? !imagesParProduit.get(existant.id) : true,
          };

          /* -- L'écriture, quand elle est demandée ------------------------ */

          if (appliquer) {
            const produitId = existant
              ? existant.id
              : await creerProduit(tx, lu);
            ligne.produitId = produitId;

            if (existant && action === "mise-a-jour") {
              // Seuls les champs que le fichier renseigne sont réécrits : une
              // case laissée vide dans le tableur veut dire « je n'en parle
              // pas », jamais « efface ce qu'il y avait ».
              const champs: Record<string, unknown> = { updatedAt: new Date() };
              if (lu.nom) champs.name = lu.nom;
              if (lu.description !== null) champs.description = lu.description;
              if (lu.vendeur !== null) champs.vendor = lu.vendeur;
              if (lu.typeProduit !== null) champs.productType = lu.typeProduit;
              if (lu.statut !== null) champs.status = lu.statut;
              if (lu.titreGoogle !== null) champs.seoTitle = lu.titreGoogle;
              if (lu.descriptionGoogle !== null)
                champs.seoDescription = lu.descriptionGoogle;
              await tx
                .update(schema.products)
                .set(champs)
                .where(eq(schema.products.id, produitId));
            }

            if (existant) {
              // Les formats absents du fichier restent en vente : le fichier
              // apporte ce qu'il sait, il ne prétend pas tout dire.
              const variantes = variantesParProduit.get(produitId) ?? [];
              for (const format of lu.formats) {
                const ancienne = variantes.find(
                  (v) => v.format.toLowerCase() === format.format.toLowerCase(),
                );
                if (!ancienne) {
                  await tx.insert(schema.variants).values({
                    productId: produitId,
                    format: format.format,
                    priceCents: format.prixCents,
                    sku: format.sku,
                  });
                  continue;
                }
                const champsVariante: Record<string, unknown> = {
                  priceCents: format.prixCents,
                };
                if (format.sku !== null) champsVariante.sku = format.sku;
                await tx
                  .update(schema.variants)
                  .set(champsVariante)
                  .where(eq(schema.variants.id, ancienne.id));
              }
            }

            // Le prix « à partir de » suit le plus bas des formats, comme
            // partout ailleurs dans la boutique.
            const restantes = await tx
              .select({ priceCents: schema.variants.priceCents })
              .from(schema.variants)
              .where(eq(schema.variants.productId, produitId));
            if (restantes.length)
              await tx
                .update(schema.products)
                .set({
                  basePriceCents: Math.min(
                    ...restantes.map((v) => v.priceCents),
                  ),
                  updatedAt: new Date(),
                })
                .where(eq(schema.products.id, produitId));

            // Le rangement s'ajoute, il ne se remplace pas : une collection
            // posée à la main sur cette affiche n'a pas à sauter parce qu'un
            // fichier ne la citait pas.
            const dejaLiees = liensParProduit.get(produitId) ?? new Set<number>();
            let rang = (dernierRangParProduit.get(produitId) ?? -1) + 1;
            for (const nom of lu.collections) {
              const collectionId = trouverCollection(nom);
              if (collectionId === undefined || dejaLiees.has(collectionId))
                continue;
              await tx.insert(schema.productCollections).values({
                productId: produitId,
                collectionId,
                position: rang,
              });
              dejaLiees.add(collectionId);
              rang += 1;
            }
            liensParProduit.set(produitId, dejaLiees);
            dernierRangParProduit.set(produitId, rang - 1);
          }

          apercu.push(ligne);
        }

        return {
          applique: appliquer,
          lignes: lignesNommees.length,
          produits: produitsLus.length,
          collectionsCreees,
          apercu,
          // Chaque affiche écartée ressort aussi ligne à ligne : c'est cette
          // liste que la propriétaire relit, son fichier ouvert à côté.
          erreurs: produitsLus
            .filter((p) => p.refus)
            .map((p) => ({ ligne: p.ligne, message: p.refus ?? "" })),
        };
      });

      return c.json(resultat);
    } catch (erreur) {
      if (erreur instanceof FichierRefuse)
        return c.json({ error: erreur.message }, 400);
      // La base peut refuser au dernier moment ce que la relecture ne pouvait
      // pas voir, par exemple une adresse prise entre-temps. La transaction a
      // tout annulé : le catalogue est intact, il n'y a qu'à recommencer.
      console.error("[import produits] import impossible", erreur);
      return c.json(
        {
          error:
            "Ce fichier n'a pas pu être importé. Rien n'a été enregistré : vérifiez les noms de colonnes, puis réessayez.",
        },
        400,
      );
    }
  });

  /* ---------------------------------------------------------------------- */
  /*  Le visuel d'une affiche                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Ajoute une image à la fin de celles d'une affiche.
   *
   * Écrite pour l'écran d'import, où l'on dépose quarante visuels à la suite
   * sans jamais ouvrir une fiche. D'où la forme : une image, une affiche, un
   * appel, et surtout rien d'autre de touché. Les images déjà en place gardent
   * leur ordre et leur texte, et la première reste la première — c'est elle
   * qui s'affiche en boutique, et la voir changer parce qu'on a ajouté une
   * vue de dos serait la dernière des surprises.
   */
  app.post("/admin/products/:id/image", async (c) => {
    const id = Number(c.req.param("id"));
    const corps = (await c.req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (!Number.isInteger(id) || id <= 0)
      return c.json(
        { error: "Cette affiche n'existe plus. Rechargez la page." },
        400,
      );

    const url = String(corps.url ?? "").trim();
    if (!url)
      return c.json(
        { error: "Aucune image à ajouter : son adresse est vide." },
        400,
      );
    // Deux formes acceptées : un fichier de la boutique (« /assets/… ») ou une
    // adresse web complète. Le reste est refusé, y compris
    // « //ailleurs.com/x.jpg » qui ressemble à une adresse interne mais
    // désigne un autre site.
    const interne = url.startsWith("/") && !url.startsWith("//");
    const distante = /^https?:\/\//i.test(url);
    if (!interne && !distante)
      return c.json(
        {
          error: `L'adresse « ${url.slice(0, 60)} » n'est pas une adresse d'image valable. Elle doit commencer par « / », « http:// » ou « https:// ».`,
        },
        400,
      );

    const alt = String(corps.alt ?? "").trim().slice(0, 200) || null;

    try {
      const images = await db.transaction(async (tx) => {
        const [produit] = await tx
          .select({ id: schema.products.id })
          .from(schema.products)
          .where(eq(schema.products.id, id));
        if (!produit) return null;

        const existantes = await tx
          .select({
            id: schema.productImages.id,
            position: schema.productImages.position,
          })
          .from(schema.productImages)
          .where(eq(schema.productImages.productId, id))
          .orderBy(asc(schema.productImages.position));

        // « À la fin » se calcule sur les positions réelles, pas sur le nombre
        // d'images : une liste réordonnée à la main peut très bien compter
        // trois images numérotées 0, 5 et 9.
        const dernierRang = existantes.reduce(
          (max, i) => Math.max(max, i.position),
          -1,
        );
        await tx.insert(schema.productImages).values({
          productId: id,
          url: url.slice(0, 500),
          alt,
          position: dernierRang + 1,
        });
        return existantes.length + 1;
      });

      if (images === null)
        return c.json(
          { error: "Cette affiche n'existe plus. Rechargez la page." },
          404,
        );
      return c.json({ ok: true, images });
    } catch (erreur) {
      console.error("[import produits] image non ajoutée", erreur);
      return c.json(
        {
          error:
            "Cette image n'a pas pu être ajoutée à l'affiche. Réessayez dans un instant.",
        },
        400,
      );
    }
  });
}

/**
 * Crée une affiche que le catalogue ne connaissait pas, et ses formats.
 *
 * Sortie de la boucle principale pour la garder lisible : l'écriture d'une
 * création n'a rien à voir avec celle d'une mise à jour, qui ne touche que les
 * champs renseignés.
 */
async function creerProduit(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  lu: ProduitLu,
): Promise<number> {
  const [cree] = await tx
    .insert(schema.products)
    .values({
      slug: lu.adresse,
      name: lu.nom,
      description: lu.description,
      status: lu.statut ?? "active",
      vendor: lu.vendeur,
      productType: lu.typeProduit,
      seoTitle: lu.titreGoogle,
      seoDescription: lu.descriptionGoogle,
      basePriceCents: Math.min(...lu.formats.map((f) => f.prixCents)),
      updatedAt: new Date(),
    })
    .returning({ id: schema.products.id });
  if (!cree)
    throw new FichierRefuse(
      `L'affiche « ${lu.nom} » n'a pas pu être créée. Rien n'a été importé, réessayez.`,
    );

  for (const format of lu.formats)
    await tx.insert(schema.variants).values({
      productId: cree.id,
      format: format.format,
      priceCents: format.prixCents,
      sku: format.sku,
    });

  return cree.id;
}
