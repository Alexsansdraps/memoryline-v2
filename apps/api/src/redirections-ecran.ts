/**
 * BO › Redirections : celles qu'on saisit à la main, et l'import de celles que
 * l'ancienne boutique Shopify avait posées.
 *
 * Le jour de la bascule, chaque adresse de memoryline.fr que Google connaît
 * doit mener quelque part. Le site s'en charge déjà pour les formes connues de
 * Shopify (apps/web/src/lib/anciennes-adresses.ts : /products/…,
 * /collections/…, /policies/…). Restent les redirections que la boutique avait
 * posées elle-même dans Shopify (Contenu › Menus › Redirections d'URL :
 * strasbourg → colmar, par exemple) et les cas particuliers. Elles vivent dans
 * la table `redirect`, que cet écran remplit et que le site lit AVANT ses
 * correspondances automatiques (apps/web/src/middleware.ts).
 *
 * Les règles sont dans des fonctions PURES, que les essais vérifient sans base
 * (tests/redirections-ecran.test.ts) :
 *
 *   - une ancienne adresse est un CHEMIN du site, sous la forme où le site le
 *     compare : sans domaine, sans langue, sans requête, en minuscules, sans
 *     barre finale. Une adresse complète collée depuis le navigateur y est
 *     ramenée ;
 *   - une nouvelle adresse est un chemin du site, ou l'adresse http(s) d'un
 *     autre site. Jamais « javascript: », « data: » ni rien d'autre qu'une
 *     page : la cible part telle quelle dans l'en-tête Location du site ;
 *   - pas de boucle : ni A → A, ni A → B quand B mène déjà à A, requête ou
 *     pas (le site compare les adresses sans leur requête) ;
 *   - UN SEUL SAUT : une cible elle-même redirigée est remplacée par sa
 *     destination finale, sa requête (un suivi de campagne) mise au bout ;
 *   - une cible Shopify (/products/…) est suivie SOUS SA FORME SHOPIFY avant
 *     d'être réécrite en /affiches/… : Shopify a pu la rediriger elle-même
 *     (un changement de handle pose /products/ancien → /products/nouveau), et
 *     c'est sous cette forme que la liste et le fichier la connaissent ;
 *   - les redirections qui menaient DÉJÀ à l'ancienne adresse ne sont pas
 *     réécrites : le site suit la chaîne et n'envoie qu'une 301
 *     (apps/web/src/middleware.ts). Les réécrire était définitif : archiver
 *     la nouvelle, ou la poser en 302 pour quelques jours, ne les rendait
 *     plus à leur cible d'origine. L'écran dit seulement lesquelles passent
 *     désormais par elle ;
 *   - une seule redirection vivante par ancienne adresse (l'index unique
 *     redirect_from_uniq le garantit, l'écran le dit avant) ;
 *   - rediriger une page qui existe (une affiche en vente, une page publiée,
 *     le panier, ou l'ancienne adresse Shopify d'une affiche en vente, où le
 *     site mène de lui-même) détourne tous ceux qui y arrivent, puisque le
 *     site applique la table avant d'afficher quoi que ce soit : l'écran le
 *     dit et demande de confirmer. L'import, lui, les refuse : on ne confirme
 *     pas cent lignes d'un coup.
 *
 * Rien ne se supprime : une redirection s'archive, et se restaure.
 *
 * La table ne garde ni la date de création ni l'auteur d'une redirection
 * (pas de colonne pour cela). Celles que pose un changement d'adresse
 * d'affiche se reconnaissent à leur forme, /affiches/… → /affiches/… :
 * c'est exactement ce qu'écrit `poserRedirection`.
 */
import type { Hono } from "hono";
import { and, desc, eq, inArray, isNull, sql as raw } from "drizzle-orm";
import { db, schema } from "./db/client.js";
import { lireCsv } from "./import-produits.js";
import { cheminAffiche, normaliserChemin, type RedirectionActive } from "./redirections.js";
import { LANGUES_ETRANGERES } from "./traductions.js";

export const ANCIENNE_MAX = 500;
export const NOUVELLE_MAX = 1000;
/** Un export Shopify fait quelques centaines de lignes ; dix fois plus, c'est une erreur de fichier. */
export const IMPORT_LIGNES_MAX = 5000;
export const IMPORT_CARACTERES_MAX = 1_000_000;

/** Les préfixes de langue du site : c'est lui qui les ajoute devant la cible. */
const LANGUES: readonly string[] = ["fr", ...LANGUES_ETRANGERES];

/** Une adresse lue, ou la raison de son refus, en français, prête pour l'écran. */
export type LectureAncienne =
  | { ok: true; chemin: string; notes: string[] }
  | { ok: false; raison: string };

export type LectureNouvelle =
  | { ok: true; cible: string; externe: boolean; notes: string[] }
  | { ok: false; raison: string };

/** Une redirection en vigueur, telle que les plans la lisent : celle du plan d'un changement d'adresse. */
export type RedirectionVivante = RedirectionActive;

const refus = (raison: string): { ok: false; raison: string } => ({ ok: false, raison });

/**
 * Une adresse telle qu'on la lit : « /café » plutôt que « /caf%c3%a9 ».
 * L'adresse enregistrée reste encodée (c'est ainsi que le navigateur la
 * demande) ; seuls les messages la montrent en clair. decodeURI laisse
 * encodés « / », « ? » et « # » écrits en %2F, %3F, %23 : ils ne
 * changeraient pas de sens à la lecture.
 */
export function montrer(adresse: string): string {
  try {
    return decodeURI(adresse);
  } catch {
    return adresse;
  }
}

/**
 * Les fiches Shopify, sous leurs deux formes : /products/<handle> et
 * /collections/<collection>/products/<handle>. Pour Shopify, c'est la même
 * fiche, et le site les traite pareil (apps/web/src/lib/anciennes-adresses.ts).
 */
const FICHE_SHOPIFY = /^\/(?:collections\/[^/]+\/)?products\/([^/]+)$/;
const FICHE_DANS_COLLECTION = /^\/collections\/[^/]+\/products\/([^/]+)$/;

function ficheShopify(chemin: string): string | null {
  return FICHE_SHOPIFY.exec(chemin)?.[1] ?? null;
}

/**
 * Où le site mène DE LUI-MÊME une adresse Shopify qu'aucune redirection ne
 * prend : la fiche du même nom, ou le catalogue (anciennes-adresses.ts).
 */
function adresseDuNouveauSite(chemin: string): string | null {
  if (chemin === "/products") return "/affiches";
  const h = ficheShopify(chemin);
  return h ? cheminAffiche(h) : null;
}

/**
 * Les anciennes adresses que le site consulte dans la table pour un chemin,
 * dans son ordre : le chemin lui-même, puis, pour une fiche rangée dans une
 * collection, la fiche seule. Une redirection posée sur /products/x vaut
 * ainsi pour /collections/villes/products/x (middleware.ts, même règle).
 */
function clesConsultees(cle: string): string[] {
  const h = FICHE_DANS_COLLECTION.exec(cle)?.[1];
  return h ? [cle, `/products/${h}`] : [cle];
}

/**
 * Les noms sous lesquels la boutique répond. Une adresse complète qui en porte
 * un est ramenée à son chemin ; une cible sur un autre nom part telle quelle.
 * PUBLIC_ORIGIN ajoute celui du serveur (localhost en essai, le tunnel).
 */
export function hotesDeLaBoutique(): string[] {
  const hotes = new Set(["memoryline.fr", "www.memoryline.fr"]);
  try {
    const origine = (process.env.PUBLIC_ORIGIN ?? "").trim();
    if (origine) hotes.add(new URL(origine).hostname.toLowerCase());
  } catch {
    // Adresse mal écrite : les deux noms de la boutique suffisent.
  }
  return [...hotes];
}

/** Un espace ou un caractère invisible : deux adresses collées sur une ligne, le plus souvent. */
const ESPACE_OU_CONTROLE = /[\s\u0000-\u001f\u007f]/;
/** « https: », « javascript: »… en tête de saisie. */
const SCHEMA = /^([a-z][a-z0-9+.-]*):/i;
/** « autre-site.fr/page » collé sans https:// devant. */
const DOMAINE_EN_TETE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i;
/** Le dernier morceau d'un chemin de fichier : le site ne redirige pas les fichiers. */
const FICHIER = /\.[a-z0-9]{2,5}$/i;
/** Les anciens plans du site, seuls fichiers que le site redirige (middleware.ts). */
const PLAN_DU_SITE = /^\/sitemap[-_][^/]*\.xml$/i;

/**
 * Les caractères écrits comme un navigateur les envoie : « é » devient
 * « %C3%A9 », un « %41 » déjà écrit reste tel quel. Sans cela, « /café »
 * saisi au clavier ne correspondrait jamais à l'adresse demandée, qui arrive
 * toujours encodée. null : un « % » qui n'est suivi d'aucun code.
 */
function encoder(morceau: string): string | null {
  if (/%(?![0-9a-f]{2})/i.test(morceau)) return null;
  try {
    return morceau.replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@/%?#]/gu, (c) => encodeURIComponent(c));
  } catch {
    return null;
  }
}

/**
 * Le préfixe de langue retiré : le site cherche l'adresse SANS lui, puis le
 * remet devant la cible (une visiteuse anglaise reste en anglais). Une
 * redirection vaut donc pour les cinq langues à la fois.
 */
function sansLangue(chemin: string, notes: string[]): string {
  const langue = /^\/([a-z]{2})(?=\/|$)/.exec(chemin)?.[1];
  if (!langue || !LANGUES.includes(langue)) return chemin;
  notes.push(
    `Le préfixe de langue « /${langue} » est retiré : la redirection vaut pour toutes les langues du site.`,
  );
  return chemin.slice(langue.length + 1) || "/";
}

/**
 * Le début d'une saisie qui n'est pas une adresse complète : le nom de la
 * boutique collé sans https://, ou un chemin sans sa barre de tête. Rend
 * null pour le nom d'un autre site.
 */
function cheminSansSchema(s: string, hotes: readonly string[]): string | null {
  if (s.startsWith("/")) return s;
  const bas = s.toLowerCase();
  const hote = hotes.find((h) => bas === h || bas.startsWith(`${h}/`) || bas.startsWith(`${h}?`));
  if (hote) return s.slice(hote.length) || "/";
  if (DOMAINE_EN_TETE.test(s)) return null;
  return `/${s}`;
}

/**
 * L'ancienne adresse, sous la forme où le site la cherche dans la table.
 *
 * `hotes` : les noms de la boutique (hotesDeLaBoutique) ; s'y ajoutent les
 * adresses en .myshopify.com, celles de l'ancienne boutique, dont le chemin
 * est le même.
 */
export function lireAncienneAdresse(saisie: unknown, hotes: readonly string[]): LectureAncienne {
  let s = String(saisie ?? "").trim();
  const notes: string[] = [];
  if (!s) return refus("Indiquez l'ancienne adresse, par exemple /products/vieux-moulin.");
  if (s.length > ANCIENNE_MAX * 2)
    return refus(`L'ancienne adresse tient en ${ANCIENNE_MAX} caractères au plus.`);
  if (ESPACE_OU_CONTROLE.test(s))
    return refus("Une adresse ne contient pas d'espace. Vérifiez qu'il n'y en a pas deux à la suite.");

  const protocole = SCHEMA.exec(s)?.[1]?.toLowerCase();
  if (protocole) {
    if (protocole !== "http" && protocole !== "https")
      return refus("L'ancienne adresse est une page du site : un chemin qui commence par « / », comme /products/vieux-moulin.");
    let u: URL;
    try {
      u = new URL(s);
    } catch {
      return refus("Cette adresse est mal écrite. Copiez-la depuis la barre d'adresse du navigateur.");
    }
    const hote = u.hostname.toLowerCase();
    if (!hotes.includes(hote) && !hote.endsWith(".myshopify.com"))
      return refus(`« ${hote} » n'est pas l'adresse de la boutique : l'ancienne adresse est une page de memoryline.fr.`);
    s = u.pathname + u.search;
    notes.push("Adresse complète ramenée à son chemin.");
  } else {
    const chemin = cheminSansSchema(s, hotes);
    if (chemin === null)
      return refus("Cette adresse n'est pas celle de la boutique : l'ancienne adresse est une page de memoryline.fr.");
    s = chemin;
  }
  // Contrôlé APRÈS la lecture du domaine : dans « https://memoryline.fr//x »
  // ou « memoryline.fr//x », la barre doublée survit au retrait du nom.
  if (s.startsWith("//"))
    return refus("Écrivez l'ancienne adresse avec un seul « / » au début : /products/vieux-moulin.");

  // Le site compare les adresses sans leur requête : « ?variant=… » ne
  // ferait jamais correspondre la ligne.
  const coupure = s.search(/[?#]/);
  if (coupure >= 0) {
    if (s[coupure] === "?" && s.length > coupure + 1)
      notes.push("La partie après « ? » est ignorée : le site reconnaît l'adresse sans elle.");
    s = s.slice(0, coupure);
  }
  const encodee = encoder(s);
  if (encodee === null) return refus("Cette adresse contient un « % » qui n'est suivi d'aucun code.");
  // Minuscules et sans barre finale : la règle du site (normaliserChemin).
  const chemin = sansLangue(normaliserChemin(encodee), notes);

  if (chemin === "/")
    return refus("L'accueil du site ne se redirige pas : toutes les visites partiraient ailleurs.");
  if (/^\/(_|api(\/|$)|bo(\/|$))/.test(chemin))
    return refus("Cette adresse est celle d'un service du site, pas d'une page : elle ne se redirige pas.");
  if (FICHIER.test(chemin) && !PLAN_DU_SITE.test(chemin))
    return refus(
      chemin.startsWith("/cdn/")
        ? "Les images de l'ancienne boutique (/cdn/…) mènent déjà d'elles-mêmes au même visuel du nouveau site."
        : "Le site ne redirige que des pages, pas des fichiers (.jpg, .pdf…).",
    );
  if (chemin.length > ANCIENNE_MAX)
    return refus(`L'ancienne adresse tient en ${ANCIENNE_MAX} caractères au plus.`);
  return { ok: true, chemin, notes };
}

/**
 * La nouvelle adresse : un chemin du site, ou l'adresse complète d'un autre
 * site.
 *
 * Un chemin du site s'écrit comme le site le sert, en minuscules et sans
 * barre finale : sinon le site ajouterait un second saut pour le remettre
 * d'aplomb. Une fiche Shopify (/products/…) GARDE ICI SA FORME : Shopify a pu
 * la rediriger elle-même, et c'est sous cette forme que la chaîne se cherche.
 * Sa réécriture en /affiches/… vient au bout, dans destinationFinale.
 */
export function lireNouvelleAdresse(saisie: unknown, hotes: readonly string[]): LectureNouvelle {
  let s = String(saisie ?? "").trim();
  const notes: string[] = [];
  if (!s)
    return refus(
      "Indiquez la nouvelle adresse : un chemin du site (/affiches/vieux-moulin) ou l'adresse complète d'un autre site (https://…).",
    );
  if (s.length > NOUVELLE_MAX)
    return refus(`La nouvelle adresse tient en ${NOUVELLE_MAX} caractères au plus.`);
  if (ESPACE_OU_CONTROLE.test(s))
    return refus("Une adresse ne contient pas d'espace. Vérifiez qu'il n'y en a pas deux à la suite.");

  const protocole = SCHEMA.exec(s)?.[1]?.toLowerCase();
  if (protocole) {
    // La cible part telle quelle dans l'en-tête Location : « javascript: »
    // ou « data: » n'ont rien à y faire, quel que soit l'usage prévu.
    if (protocole !== "http" && protocole !== "https")
      return refus(
        `Une adresse en « ${protocole}: » n'est pas une page. Seules les adresses en https:// (ou http://) sont acceptées.`,
      );
    let u: URL;
    try {
      u = new URL(s);
    } catch {
      return refus("Cette adresse est mal écrite. Copiez-la depuis la barre d'adresse du navigateur.");
    }
    if (u.username || u.password)
      return refus("Une adresse qui contient un identifiant ou un mot de passe n'est pas acceptée.");
    const hote = u.hostname.toLowerCase();
    if (!hotes.includes(hote)) {
      if (u.href.length > NOUVELLE_MAX)
        return refus(`La nouvelle adresse tient en ${NOUVELLE_MAX} caractères au plus.`);
      return { ok: true, cible: u.href, externe: true, notes };
    }
    s = u.pathname + u.search + u.hash;
    notes.push("Adresse de la boutique ramenée à son chemin.");
  } else {
    const chemin = cheminSansSchema(s, hotes);
    if (chemin === null)
      return refus("Pour un autre site, écrivez l'adresse complète, avec https:// devant.");
    s = chemin;
  }
  // Contrôlé APRÈS la lecture du domaine. « //autre-site.fr/x » part tel
  // quel dans l'en-tête Location, et le navigateur le lit comme une adresse
  // d'un autre site : « https://memoryline.fr//autre-site.fr/x », ramenée à
  // son chemin, ferait quitter la boutique. Une simple faute de frappe
  // (« memoryline.fr//pages/a-propos ») enverrait vers un site nommé « pages ».
  if (s.startsWith("//"))
    return refus(
      "Écrivez l'adresse complète d'un autre site avec https:// devant, ou un chemin du site qui commence par un seul « / ».",
    );

  const coupure = s.search(/[?#]/);
  let chemin = coupure >= 0 ? s.slice(0, coupure) : s;
  let suite = coupure >= 0 ? s.slice(coupure) : "";
  const cheminEncode = encoder(chemin);
  const suiteEncodee = encoder(suite);
  if (cheminEncode === null || suiteEncodee === null)
    return refus("Cette adresse contient un « % » qui n'est suivi d'aucun code.");
  chemin = cheminEncode;
  suite = suiteEncodee;
  // Minuscules, comme le site sert ses pages (middleware.ts, cheminPropre) :
  // le code d'une photo et les caractères encodés gardent leur casse.
  if (!/^\/photo\//i.test(chemin))
    chemin = chemin.replace(/%[0-9A-Fa-f]{2}|[A-Z]+/g, (m) => (m.startsWith("%") ? m : m.toLowerCase()));
  if (chemin.length > 1) chemin = chemin.replace(/\/+$/, "") || "/";
  chemin = sansLangue(chemin, notes);

  // Les paramètres d'une fiche Shopify (« ?variant=… ») ne veulent plus rien
  // dire ici. La fiche elle-même reste sous sa forme Shopify (voir plus haut).
  if ((FICHE_SHOPIFY.test(chemin) || chemin === "/products") && suite) {
    notes.push(`La partie « ${montrer(suite)} » de l'adresse Shopify est retirée : elle ne veut rien dire sur le nouveau site.`);
    suite = "";
  }

  const cible = chemin + suite;
  if (cible.length > NOUVELLE_MAX)
    return refus(`La nouvelle adresse tient en ${NOUVELLE_MAX} caractères au plus.`);
  return { ok: true, cible, externe: false, notes };
}

/** Une adresse d'un autre site. */
export function estExterne(cible: string): boolean {
  return /^https?:\/\//i.test(cible);
}

/** La clé sous laquelle une cible du site se compare aux anciennes adresses, ou null pour un autre site. */
function cleDeCible(cible: string): string | null {
  return estExterne(cible) ? null : normaliserChemin(cible);
}

/** Une redirection connue, par son ancienne adresse comparable. */
type Table = Map<string, { id: number | null; ligne?: number; toPath: string }>;

function tableDe(vivantes: readonly RedirectionVivante[]): Table {
  return new Map(vivantes.map((r) => [normaliserChemin(r.fromPath), { id: r.id, toPath: r.toPath }]));
}

/** Une adresse en trois morceaux : avant la requête, la requête (sans « ? »), l'ancre (avec « # »). */
function decouper(adresse: string): { base: string; requete: string; ancre: string } {
  const diese = adresse.indexOf("#");
  const ancre = diese >= 0 ? adresse.slice(diese) : "";
  const avant = diese >= 0 ? adresse.slice(0, diese) : adresse;
  const q = avant.indexOf("?");
  return q >= 0
    ? { base: avant.slice(0, q), requete: avant.slice(q + 1), ancre }
    : { base: avant, requete: "", ancre };
}

/** Une adresse Shopify réécrite en route, comme le site le fait de lui-même. */
export interface Reecriture {
  avant: string;
  apres: string;
}

export type Finale =
  | { ok: true; cible: string; etapes: string[]; reecrite: Reecriture | null }
  | {
      ok: false;
      /** La redirection par laquelle on revient, ou null pour un A → A. */
      par: string | null;
      /** L'adresse sur laquelle on revient : `depuis`, ou une redirection déjà empruntée. */
      retour: string;
      /** La ligne du fichier de `par`, à l'import. */
      ligne?: number;
      reecrite: Reecriture | null;
    };

/**
 * Où mène vraiment une cible, telle que le site la suivrait : la table
 * jusqu'au bout, et les adresses Shopify qu'aucune redirection ne prend
 * réécrites comme le site le fait de lui-même (/products/x → /affiches/x).
 *
 * C'est dans cet ordre-là qu'une cible Shopify doit se lire. Réécrite AVANT,
 * « /products/ancien » devenait « /affiches/ancien », que la table ne
 * connaît pas : la redirection /products/ancien → /products/nouveau de
 * Shopify n'était plus suivie, et le visiteur finissait sur une page
 * introuvable.
 *
 * La requête de la cible n'arrête pas le parcours : le site compare les
 * adresses SANS leur requête, « /colmar?utm_source=x » lui est « /colmar ».
 * S'arrêter là laissait passer une boucle (/strasbourg → /colmar?utm…,
 * quand /colmar mène déjà à /strasbourg) et un second saut. La requête suit
 * donc jusqu'à la destination finale, après la requête propre de celle-ci
 * (un rayon, « /affiches?collection=villes »). On ne s'arrête que sur un
 * autre site, ou sur une adresse qu'aucune redirection ne prend.
 *
 * Revenir sur `depuis`, ou sur une redirection déjà empruntée, c'est une
 * boucle : refusée, avec l'adresse par laquelle on revient.
 *
 * Une cible qui désigne LA MÊME FICHE Shopify que l'ancienne adresse
 * (« /products/thann » → « /products/thann », ou la même sous sa
 * collection) ne tourne pas en rond : elle veut dire « la fiche du nouveau
 * site », et c'est là qu'elle mène.
 */
export function destinationFinale(cible: string, depuis: string, table: Table): Finale {
  const vues = new Set([depuis]);
  const etapes: string[] = [];
  const morceaux = decouper(cible);
  let ici = morceaux.base;
  let requete = morceaux.requete;
  let ancre = morceaux.ancre;
  let reecrite: Reecriture | null = null;
  const fiche = ficheShopify(depuis);
  if (fiche && !estExterne(ici) && ficheShopify(normaliserChemin(ici)) === fiche) {
    reecrite = { avant: normaliserChemin(ici), apres: cheminAffiche(fiche) };
    ici = reecrite.apres;
  }
  for (let i = 0; i < 50 && !estExterne(ici); i++) {
    const cle = normaliserChemin(ici);
    let suivante: string | null = null;
    for (const k of clesConsultees(cle)) {
      if (vues.has(k)) {
        const par = etapes.length ? etapes[etapes.length - 1]! : null;
        return { ok: false, par, retour: k, ligne: par ? table.get(par)?.ligne : undefined, reecrite };
      }
      const r = table.get(k);
      if (r) {
        vues.add(k);
        etapes.push(k);
        suivante = r.toPath;
        break;
      }
    }
    if (suivante !== null) {
      const m = decouper(suivante);
      ici = m.base;
      requete = [m.requete, requete].filter(Boolean).join("&");
      ancre = m.ancre || ancre;
      continue;
    }
    const auto = adresseDuNouveauSite(cle);
    if (!auto) break;
    reecrite ??= { avant: cle, apres: auto };
    vues.add(cle);
    ici = auto;
  }
  return { ok: true, cible: ici + (requete ? `?${requete}` : "") + ancre, etapes, reecrite };
}

/** Pourquoi une cible tourne en rond, en une phrase pour l'écran. */
function raisonDeBoucle(f: Extract<Finale, { ok: false }>, de: string): string {
  if (f.par && f.retour !== de)
    return `« ${montrer(f.par)} » et « ${montrer(f.retour)} » se renvoient déjà l'une à l'autre dans la liste : archivez d'abord l'une des deux.`;
  if (f.par)
    return `« ${montrer(f.par)} » mène déjà à « ${montrer(de)} » : les deux adresses se renverraient l'une à l'autre. Archivez d'abord celle-là, ou choisissez une autre nouvelle adresse.`;
  if (f.reecrite)
    return `« ${montrer(f.reecrite.avant)} » mène d'elle-même à « ${montrer(f.reecrite.apres)} » sur le nouveau site, c'est-à-dire à l'ancienne adresse : la redirection tournerait en rond.`;
  return "La nouvelle adresse est l'ancienne : la redirection tournerait en rond.";
}

/** Ce que l'écran dit d'une cible suivie : la chaîne raccourcie, l'adresse Shopify réécrite. */
function notesDeFinale(f: Extract<Finale, { ok: true }>, ligneDuRelais?: number): string[] {
  const notes: string[] = [];
  if (f.etapes.length)
    notes.push(
      `« ${montrer(f.etapes[0]!)} » est elle-même redirigée${ligneDuRelais ? ` (ligne ${ligneDuRelais})` : ""} : la redirection mène directement à « ${montrer(f.cible)} », en un seul saut.`,
    );
  if (f.reecrite)
    notes.push(
      `Adresse Shopify « ${montrer(f.reecrite.avant)} » lue comme le site la lit : « ${montrer(f.reecrite.apres)} ».`,
    );
  return notes;
}

/**
 * Les redirections de `vivantes` qui passent, sur le site, par l'une des
 * anciennes adresses de `par` : leur sort en dépend. Rangées par l'adresse
 * qu'elles traversent en premier.
 */
function passantPar(
  vivantes: readonly RedirectionVivante[],
  table: Table,
  par: ReadonlySet<string>,
): Map<string, string[]> {
  const sortie = new Map<string, string[]>();
  for (const r of vivantes) {
    const de = normaliserChemin(r.fromPath);
    if (par.has(de)) continue;
    const f = destinationFinale(r.toPath, de, table);
    if (!f.ok) continue;
    const e = f.etapes.find((x) => par.has(x));
    if (e) sortie.set(e, [...(sortie.get(e) ?? []), r.fromPath]);
  }
  return sortie;
}

/** « « /a » », « « /a » et « /b » », « « /a », « /b », « /c » et 2 autres ». */
function enumerer(adresses: readonly string[]): string {
  const noms = adresses.slice(0, 3).map((a) => `« ${montrer(a)} »`);
  const reste = adresses.length - noms.length;
  if (reste > 0) return `${noms.join(", ")} et ${reste} autre${reste > 1 ? "s" : ""}`;
  return noms.length > 1 ? `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}` : (noms[0] ?? "");
}

/**
 * Les redirections qui menaient déjà à `de` : le site les conduit
 * désormais jusqu'à `finale`, sans qu'on les réécrive. Le dire, et dire ce
 * qu'archiver changerait : c'est ce qui rend la saisie réversible.
 */
function phrasePassent(passent: readonly string[], de: string, finale: string, code?: number): string {
  const plus = passent.length > 1;
  return (
    `${enumerer(passent)} ${plus ? "mènent" : "mène"} à « ${montrer(de)} » : le site ${plus ? "les" : "la"} conduit ` +
    `maintenant jusqu'à « ${montrer(finale)} », en un seul saut${code === 302 ? ", en 302 (temporaire) comme celle-ci" : ""}. ` +
    `${plus ? "Elles ne sont pas modifiées" : "Elle n'est pas modifiée"} : archiver cette redirection-ci ${plus ? "les" : "la"} ` +
    `rendrait à « ${montrer(de)} ».`
  );
}

/** Ce qu'il faut écrire pour une redirection saisie à la main. */
export interface PlanSaisie {
  fromPath: string;
  toPath: string;
  /** Ce que l'écran dit en plus : cible remplacée par sa destination finale, etc. */
  notes: string[];
}

/**
 * Le plan d'une redirection saisie, modifiée ou restaurée, sans rien écrire.
 *
 * `de` et `cible` sortent de lireAncienneAdresse et lireNouvelleAdresse.
 * `soi` : la redirection qu'on modifie ou qu'on restaure, écartée des
 * vivantes (elle ne se fait pas doublon à elle-même). `pour` choisit la
 * phrase d'un doublon ; `code`, celle des redirections qui passent par elle.
 */
export function planDeSaisie(
  de: string,
  cible: string,
  vivantes: readonly RedirectionVivante[],
  options: { soi?: number; pour?: "ajout" | "modification" | "restauration"; code?: number } = {},
): { ok: true; plan: PlanSaisie } | { ok: false; raison: string; existante?: RedirectionVivante } {
  const autres = vivantes.filter((r) => r.id !== options.soi);
  const table = tableDe(autres);
  const doublon = autres.find((r) => normaliserChemin(r.fromPath) === de);
  if (doublon)
    return {
      ok: false,
      raison:
        options.pour === "restauration"
          ? `« ${montrer(de)} » est déjà redirigée vers « ${montrer(doublon.toPath)} » par une autre redirection : archivez-la d'abord, ou gardez celle-là.`
          : `« ${montrer(de)} » est déjà redirigée vers « ${montrer(doublon.toPath)} ». Modifiez cette redirection-là plutôt que d'en ajouter une seconde.`,
      existante: doublon,
    };
  const finale = destinationFinale(cible, de, table);
  if (!finale.ok) return { ok: false, raison: raisonDeBoucle(finale, de) };
  const notes = notesDeFinale(finale);
  const avecElle: Table = new Map(table).set(de, { id: options.soi ?? null, toPath: finale.cible });
  const passent = passantPar(autres, avecElle, new Set([de])).get(de) ?? [];
  if (passent.length) notes.push(phrasePassent(passent, de, finale.cible, options.code));
  return { ok: true, plan: { fromPath: de, toPath: finale.cible, notes } };
}

/* -------------------------------------------------------------------------- */
/*  L'import : le fichier de Shopify, deux colonnes, ou un collage            */
/* -------------------------------------------------------------------------- */

/** Une ligne du fichier : ses deux adresses, telles qu'écrites. */
export interface LigneFichier {
  ligne: number;
  ancienne: string;
  nouvelle: string;
}

/** Un nom de colonne comparable : minuscules, sans accent ni ponctuation. */
function nomDeColonne(brut: string): string {
  return brut
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** « Redirect from » de Shopify, et ce qu'on écrit soi-même dans un tableur. */
const COLONNES_ANCIENNE = ["redirect from", "ancienne", "ancienne adresse", "anciennes adresses", "de", "depuis", "from", "source", "old"];
const COLONNES_NOUVELLE = ["redirect to", "nouvelle", "nouvelle adresse", "nouvelles adresses", "vers", "to", "cible", "destination", "target", "new"];

/**
 * Les lignes d'un fichier de redirections.
 *
 * Trois formes, essayées dans cet ordre :
 *   1. le fichier Redirects.csv de Shopify (colonnes « Redirect from »,
 *      « Redirect to »), ou tout tableau dont la première ligne nomme ses
 *      colonnes « ancienne » et « nouvelle » ;
 *   2. un tableau de deux colonnes sans en-tête (virgule, point-virgule ou
 *      tabulation : un copier-coller de tableur arrive en tabulations) ;
 *   3. un collage, une redirection par ligne : « ancienne nouvelle », séparées
 *      par des espaces ou une flèche (→, ->).
 *
 * Le lecteur des guillemets est celui de l'import des affiches (lireCsv) :
 * un second lecteur finirait par ne pas lire pareil.
 */
export function lireFichierRedirections(texte: string): {
  lignes: LigneFichier[];
  /** Les lignes illisibles, avec leur raison. */
  illisibles: { ligne: number; brut: string; raison: string }[];
  /** Les colonnes reconnues dans l'en-tête, ou null sans en-tête. */
  entete: { ancienne: string; nouvelle: string } | null;
} {
  const sansMarque = texte.charCodeAt(0) === 0xfeff ? texte.slice(1) : texte;
  const premiere = sansMarque.split(/\r\n?|\n/).find((l) => l.trim()) ?? "";
  const rangees: string[][] = premiere.includes("\t")
    ? sansMarque.split(/\r\n?|\n/).map((l) => l.split("\t"))
    : lireCsv(sansMarque);

  const lignes: LigneFichier[] = [];
  const illisibles: { ligne: number; brut: string; raison: string }[] = [];
  let entete: { ancienne: string; nouvelle: string } | null = null;
  let colA = 0;
  let colN = 1;
  let debut = 0;

  // L'en-tête, s'il y en a un : la première ligne non vide. Un nom de colonne
  // est un mot, jamais une adresse : « /de,/vers » est une redirection.
  const iEntete = rangees.findIndex((r) => r.some((c) => c.trim()));
  if (iEntete >= 0) {
    const noms = rangees[iEntete]!.map((c) => (c.includes("/") ? "" : nomDeColonne(c)));
    const a = noms.findIndex((n) => COLONNES_ANCIENNE.includes(n));
    const n = noms.findIndex((x) => COLONNES_NOUVELLE.includes(x));
    if (a >= 0 && n >= 0 && a !== n) {
      colA = a;
      colN = n;
      debut = iEntete + 1;
      entete = { ancienne: rangees[iEntete]![a]!.trim(), nouvelle: rangees[iEntete]![n]!.trim() };
    }
  }

  for (let i = debut; i < rangees.length; i++) {
    const champs = rangees[i]!.map((c) => c.trim());
    if (!champs.some(Boolean)) continue;
    const numero = i + 1;
    let ancienne = champs[colA] ?? "";
    let nouvelle = champs[colN] ?? "";
    // Une seule case remplie : un collage « ancienne nouvelle » sur la ligne.
    if (!entete && champs.filter(Boolean).length === 1) {
      const morceaux = champs.find(Boolean)!.split(/\s*(?:→|->|=>)\s*|\s+/).filter(Boolean);
      if (morceaux.length === 2) [ancienne, nouvelle] = morceaux as [string, string];
      else {
        illisibles.push({
          ligne: numero,
          brut: champs.find(Boolean)!,
          raison: "Deux adresses attendues sur la ligne : l'ancienne, puis la nouvelle.",
        });
        continue;
      }
    }
    lignes.push({ ligne: numero, ancienne, nouvelle });
  }
  return { lignes, illisibles, entete };
}

export type ActionImport = "creation" | "deja-la" | "refus";

/** Une ligne de l'aperçu : ce qui lui arriverait, et pourquoi. */
export interface LigneApercu {
  ligne: number;
  ancienne: string;
  nouvelle: string;
  /** Les adresses telles qu'elles seraient écrites, quand la ligne se lit. */
  fromPath: string | null;
  toPath: string | null;
  action: ActionImport;
  raison: string | null;
  notes: string[];
}

export interface PlanImport {
  apercu: LigneApercu[];
  creer: { fromPath: string; toPath: string }[];
  compte: Record<ActionImport, number>;
}

/** Les anciennes adresses lisibles du fichier : celles dont il faut savoir si une page y vit. */
export function anciennesDuFichier(lignes: readonly LigneFichier[], hotes: readonly string[]): string[] {
  const sortie = new Set<string>();
  for (const l of lignes) {
    const a = lireAncienneAdresse(l.ancienne, hotes);
    if (a.ok) sortie.add(a.chemin);
  }
  return [...sortie];
}

/**
 * Le plan d'un import, sans rien écrire.
 *
 * `pagesVivantes` : les anciennes adresses du fichier où une page existe
 * aujourd'hui, avec ce qu'elle est (« l'affiche « Colmar », en vente »).
 *
 * Les chaînes se résolvent à travers la liste ET le fichier : « A → B » et
 * « B → C » dans le même fichier donnent A → C, y compris sous leur forme
 * Shopify (/products/alias → /products/ancien → /products/nouveau, la trace
 * d'un handle changé deux fois). Une ligne qui tournerait en rond est
 * refusée, et les autres sont résolues à nouveau sans elle.
 *
 * Les redirections de la liste qui menaient à une ancienne adresse du
 * fichier ne sont pas réécrites (voir l'en-tête) : la ligne dit seulement
 * que le site les y conduira.
 */
export function planDImport(
  lu: { lignes: LigneFichier[]; illisibles: { ligne: number; brut: string; raison: string }[] },
  vivantes: readonly RedirectionVivante[],
  pagesVivantes: ReadonlyMap<string, string>,
  hotes: readonly string[],
): PlanImport {
  const apercu: LigneApercu[] = [];
  for (const l of lu.illisibles)
    apercu.push({ ligne: l.ligne, ancienne: l.brut, nouvelle: "", fromPath: null, toPath: null, action: "refus", raison: l.raison, notes: [] });

  const table = tableDe(vivantes);
  const premiereLigne = new Map<string, number>();
  /** Les lignes qui ont déjà une redirection vivante, à trancher une fois les chaînes connues. */
  const dejaDansLaListe: { l: LigneApercu; existante: { toPath: string } }[] = [];

  for (const l of lu.lignes) {
    const a = lireAncienneAdresse(l.ancienne, hotes);
    const n = lireNouvelleAdresse(l.nouvelle, hotes);
    const ligne: LigneApercu = {
      ligne: l.ligne,
      ancienne: l.ancienne,
      nouvelle: l.nouvelle,
      fromPath: a.ok ? a.chemin : null,
      toPath: n.ok ? n.cible : null,
      action: "creation",
      raison: null,
      notes: [...(a.ok ? a.notes : []), ...(n.ok ? n.notes : [])],
    };
    apercu.push(ligne);
    const refuser = (raison: string) => {
      ligne.action = "refus";
      ligne.raison = raison;
    };
    if (!a.ok) {
      refuser(`Ancienne adresse : ${a.raison}`);
      continue;
    }
    if (!n.ok) {
      refuser(`Nouvelle adresse : ${n.raison}`);
      continue;
    }
    const de = a.chemin;
    const deja = premiereLigne.get(de);
    if (deja !== undefined) {
      refuser(`Cette ancienne adresse est déjà à la ligne ${deja} du fichier.`);
      continue;
    }
    premiereLigne.set(de, l.ligne);
    // A → A, sans rien d'autre : la table vide suffit à le voir.
    const seule = destinationFinale(n.cible, de, new Map());
    if (!seule.ok) {
      refuser(raisonDeBoucle(seule, de));
      continue;
    }
    const page = pagesVivantes.get(de);
    if (page) {
      refuser(
        `C'est ${page} : la rediriger enverrait ailleurs tous ceux qui y arrivent, Google compris. Si c'est bien voulu, ajoutez-la à la main avec « Ajouter une redirection », qui demande confirmation.`,
      );
      continue;
    }
    const existante = table.get(de);
    if (existante) dejaDansLaListe.push({ l: ligne, existante });
  }

  // Les chaînes, résolues à travers la liste et les lignes retenues, jusqu'à
  // ce qu'aucune ligne ne tombe plus : retirer une boucle peut en défaire une
  // autre, jamais en créer une.
  const enAttente = () =>
    apercu.filter((x) => x.action === "creation" && !dejaDansLaListe.some((d) => d.l === x));
  const finales = new Map<LigneApercu, Extract<Finale, { ok: true }>>();
  for (let tour = 0; tour < 20; tour++) {
    const combinee: Table = new Map(table);
    for (const x of enAttente()) combinee.set(x.fromPath!, { id: null, ligne: x.ligne, toPath: x.toPath! });
    let tombees = 0;
    finales.clear();
    for (const x of enAttente()) {
      const f = destinationFinale(x.toPath!, x.fromPath!, combinee);
      if (f.ok) {
        finales.set(x, f);
        continue;
      }
      x.action = "refus";
      x.raison = f.ligne ? `Elle tournerait en rond avec la ligne ${f.ligne} du fichier.` : raisonDeBoucle(f, x.fromPath!);
      tombees += 1;
    }
    if (!tombees) break;
  }

  // Les lignes déjà dans la liste : la même destination, rien à faire ; une
  // autre, on ne choisit pas à la place de la boutique.
  const combinee: Table = new Map(table);
  for (const [x, f] of finales) combinee.set(x.fromPath!, { id: null, ligne: x.ligne, toPath: f.cible });
  for (const { l, existante } of dejaDansLaListe) {
    const sansElle: Table = new Map(combinee);
    sansElle.delete(l.fromPath!);
    const voulue = destinationFinale(l.toPath!, l.fromPath!, sansElle);
    const actuelle = destinationFinale(existante.toPath, l.fromPath!, sansElle);
    const meme =
      voulue.ok && actuelle.ok && (cleDeCible(voulue.cible) ?? voulue.cible) === (cleDeCible(actuelle.cible) ?? actuelle.cible);
    if (meme) {
      l.action = "deja-la";
      l.raison = "Déjà dans la liste, vers la même page.";
    } else {
      l.action = "refus";
      l.raison = `Déjà redirigée vers « ${montrer(existante.toPath)} » dans la liste. Si la cible de Shopify est la bonne, modifiez celle de la liste.`;
    }
  }

  const creer: { fromPath: string; toPath: string }[] = [];
  for (const [x, f] of finales) {
    x.notes.push(...notesDeFinale(f, f.etapes.length ? combinee.get(f.etapes[0]!)?.ligne : undefined));
    x.toPath = f.cible;
    creer.push({ fromPath: x.fromPath!, toPath: f.cible });
  }
  // Celles de la liste qui mènent à une ancienne adresse du fichier : c'est
  // dit sur la ligne qu'elles traversent.
  const parAncienne = new Map([...finales.keys()].map((x) => [x.fromPath!, x]));
  for (const [cle, passent] of passantPar(vivantes, combinee, new Set(parAncienne.keys()))) {
    const x = parAncienne.get(cle)!;
    x.notes.push(phrasePassent(passent, cle, x.toPath!));
  }

  apercu.sort((a, b) => a.ligne - b.ligne);
  const compte: Record<ActionImport, number> = { creation: 0, "deja-la": 0, refus: 0 };
  for (const x of apercu) compte[x.action] += 1;
  return { apercu, creer, compte };
}

/* -------------------------------------------------------------------------- */
/*  Ce que la base sait des adresses                                          */
/* -------------------------------------------------------------------------- */

/** Ce qui sait lire la base : elle, ou une transaction. */
type Lecteur = Pick<typeof db, "select">;

/**
 * Les pages fixes du site (apps/web/src/pages) : les rediriger les rendrait
 * inaccessibles. L'accueil, lui, est refusé d'office (lireAncienneAdresse).
 */
const PAGES_DU_SITE: Record<string, string> = {
  "/affiches": "l'adresse de la page « Toutes les affiches »",
  "/panier": "l'adresse du panier",
  "/commande": "l'adresse de la caisse",
  "/contact": "l'adresse de la page de contact",
  "/recherche": "l'adresse de la recherche du site",
  "/compte": "l'adresse de l'espace client",
  "/salon": "l'adresse de la page du salon",
  "/stand": "l'adresse de la page du stand",
  // Le site y mène de lui-même, vers « Toutes les affiches » (anciennes-adresses.ts).
  "/products": "l'ancienne adresse Shopify du catalogue (le site y mène de lui-même à « Toutes les affiches »)",
};

/**
 * Les affiches que désignent des anciennes adresses, par identifiant : sous
 * leur adresse du site (/affiches/<h>) ou sous l'une de leurs adresses
 * Shopify (/products/<h>, /collections/<x>/products/<h>). Fonction pure : la
 * correspondance est celle du site (anciennes-adresses.ts, `fiche`).
 */
export function affichesDesAdresses(chemins: readonly string[]): Map<string, { chemin: string; shopify: boolean }[]> {
  const sortie = new Map<string, { chemin: string; shopify: boolean }[]>();
  const ajouter = (h: string, chemin: string, shopify: boolean) =>
    sortie.set(h, [...(sortie.get(h) ?? []), { chemin, shopify }]);
  for (const c of chemins) {
    const a = /^\/affiches\/([^/]+)$/.exec(c)?.[1];
    if (a) ajouter(a, c, false);
    const h = ficheShopify(c);
    if (h) ajouter(h, c, true);
  }
  return sortie;
}

/**
 * Les adresses, parmi `chemins`, où une page existe aujourd'hui, et ce
 * qu'elle est, en une phrase (« l'adresse de l'affiche « Colmar », en
 * vente »). Une affiche archivée ou en brouillon n'en est pas une : sa page
 * ne s'affiche pas, la rediriger ne cache rien.
 *
 * L'ancienne adresse Shopify d'une affiche en vente (/products/<h>, ou sous
 * une collection) en est une aussi : le site y mène de lui-même vers
 * /affiches/<h>, et c'est l'adresse que Google connaît pour elle. La
 * rediriger détournerait l'ancien lien d'une affiche toujours en vente. Le
 * cas n'a rien de rare : Shopify ignore une redirection tant qu'une fiche
 * vit à l'ancienne adresse, son export peut donc en contenir de périmées.
 */
export async function pagesQuiExistent(lecteur: Lecteur, chemins: readonly string[]): Promise<Map<string, string>> {
  const sortie = new Map<string, string>();
  const affiches = affichesDesAdresses(chemins);
  const pages = new Map<string, string>();
  for (const c of chemins) {
    const fixe = PAGES_DU_SITE[c] ?? (/^\/(compte|photo|panier)\//.test(c) ? "l'adresse d'une page du site" : null);
    if (fixe) sortie.set(c, fixe);
    const p = /^\/pages\/([^/]+)$/.exec(c)?.[1];
    if (p) pages.set(p, c);
  }
  if (affiches.size) {
    const lignes = await lecteur
      .select({ slug: schema.products.slug, name: schema.products.name })
      .from(schema.products)
      .where(and(inArray(raw`lower(${schema.products.slug})`, [...affiches.keys()]), eq(schema.products.status, "active")));
    for (const l of lignes)
      for (const { chemin, shopify } of affiches.get(l.slug.toLowerCase()) ?? [])
        sortie.set(
          chemin,
          shopify
            ? `l'ancienne adresse Shopify de l'affiche « ${l.name} », toujours en vente (le site y mène de lui-même à sa fiche)`
            : `l'adresse de l'affiche « ${l.name} », en vente`,
        );
  }
  if (pages.size) {
    const lignes = await lecteur
      .select({ slug: schema.pages.slug, title: schema.pages.title, affichage: schema.pages.affichage })
      .from(schema.pages)
      .where(and(inArray(raw`lower(${schema.pages.slug})`, [...pages.keys()]), eq(schema.pages.status, "active")));
    for (const l of lignes) {
      // Une page du stand seulement n'existe pas sur le site.
      if (l.affichage === "stand") continue;
      const c = pages.get(l.slug.toLowerCase());
      if (c) sortie.set(c, `l'adresse de la page « ${l.title} », publiée`);
    }
  }
  return sortie;
}

/** Ce que l'écran dit de la page où mène une redirection. */
export interface EtatCible {
  /** « Affiche « Colmar » », « Page « Contact » », « Autre site ». */
  libelle: string | null;
  /** Ce qui cloche : aucune affiche à cette adresse, brouillon… */
  alerte: string | null;
}

/**
 * Où mènent les redirections de la liste : le nom de l'affiche ou de la page,
 * et ce qui cloche. Une cible introuvable n'est pas refusée — l'affiche peut
 * arriver demain —, mais la liste le dit.
 */
export async function etatsDesCibles(lecteur: Lecteur, cibles: readonly string[]): Promise<Map<string, EtatCible>> {
  const sortie = new Map<string, EtatCible>();
  const affiches = new Map<string, string[]>();
  const pages = new Map<string, string[]>();
  const ajouter = (m: Map<string, string[]>, cle: string, cible: string) => m.set(cle, [...(m.get(cle) ?? []), cible]);
  for (const c of cibles) {
    if (estExterne(c)) {
      sortie.set(c, { libelle: "Autre site", alerte: null });
      continue;
    }
    const chemin = normaliserChemin(c);
    const a = /^\/affiches\/([^/]+)$/.exec(chemin)?.[1];
    if (a) {
      ajouter(affiches, a, c);
      sortie.set(c, { libelle: null, alerte: "Aucune affiche à cette adresse : la page serait introuvable." });
    }
    const p = /^\/pages\/([^/]+)$/.exec(chemin)?.[1];
    if (p) {
      ajouter(pages, p, c);
      sortie.set(c, { libelle: null, alerte: "Aucune page à cette adresse : la page serait introuvable." });
    }
  }
  if (affiches.size) {
    const lignes = await lecteur
      .select({ slug: schema.products.slug, name: schema.products.name, status: schema.products.status })
      .from(schema.products)
      .where(inArray(raw`lower(${schema.products.slug})`, [...affiches.keys()]));
    for (const l of lignes)
      for (const c of affiches.get(l.slug.toLowerCase()) ?? [])
        sortie.set(c, {
          libelle: `Affiche « ${l.name} »`,
          alerte:
            l.status === "active"
              ? null
              : l.status === "archived"
                ? "Cette affiche est archivée : sa page répond « n'existe plus »."
                : "Cette affiche est en brouillon : sa page n'est pas encore en ligne.",
        });
  }
  if (pages.size) {
    const lignes = await lecteur
      .select({ slug: schema.pages.slug, title: schema.pages.title, status: schema.pages.status, affichage: schema.pages.affichage })
      .from(schema.pages)
      .where(inArray(raw`lower(${schema.pages.slug})`, [...pages.keys()]));
    for (const l of lignes)
      for (const c of pages.get(l.slug.toLowerCase()) ?? [])
        sortie.set(c, {
          libelle: `Page « ${l.title} »`,
          alerte:
            l.status !== "active"
              ? "Cette page est en brouillon : elle n'est pas encore en ligne."
              : l.affichage === "stand"
                ? "Cette page ne s'affiche que sur le stand, pas sur le site."
                : null,
        });
  }
  return sortie;
}

/** Une redirection telle que l'écran la montre. */
export interface RedirectionBo {
  id: number;
  fromPath: string;
  toPath: string;
  code: number;
  archivedAt: string | null;
  /** Forme /affiches/… → /affiches/… : celle que pose un changement d'adresse d'affiche. */
  affiche: boolean;
  externe: boolean;
  /** Où mène la page visée au bout de la chaîne, ou de l'adresse Shopify réécrite (sinon null). */
  cible: EtatCible | null;
  /**
   * Où le site la conduit vraiment, quand sa nouvelle adresse est elle-même
   * redirigée (elle ne se réécrit pas : voir l'en-tête). null sinon.
   */
  finale: string | null;
  /** Les anciennes adresses dont la redirection passe par celle-ci : archivée, elles mèneront de nouveau à elle. */
  relais: string[];
}

const FORME_AFFICHE = /^\/affiches\/[^/?#]+$/;

function versBo(
  r: { id: number; fromPath: string; toPath: string; code: number; archivedAt: Date | null },
  etat: EtatCible | null = null,
  finale: string | null = null,
  relais: string[] = [],
): RedirectionBo {
  return {
    id: r.id,
    fromPath: r.fromPath,
    toPath: r.toPath,
    code: r.code,
    archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
    affiche: FORME_AFFICHE.test(r.fromPath) && FORME_AFFICHE.test(r.toPath),
    externe: estExterne(r.toPath),
    cible: etat,
    finale,
    relais,
  };
}

async function lireVivantes(lecteur: Lecteur): Promise<RedirectionVivante[]> {
  return lecteur
    .select({ id: schema.redirects.id, fromPath: schema.redirects.fromPath, toPath: schema.redirects.toPath })
    .from(schema.redirects)
    .where(isNull(schema.redirects.archivedAt));
}

/** Le code voulu : 301 (définitive) sauf demande expresse d'une 302 (temporaire). */
function codeVoulu(brut: unknown): 301 | 302 | null {
  if (brut === undefined || brut === null || brut === "") return 301;
  const n = Number(brut);
  return n === 301 || n === 302 ? n : null;
}

/** Deux écritures arrivées ensemble sur la même ancienne adresse : l'index unique a tranché. */
function estUnDoublon(e: unknown): boolean {
  const code = (x: unknown) => (x && typeof x === "object" ? (x as { code?: unknown }).code : undefined);
  return code(e) === "23505" || code((e as { cause?: unknown } | null)?.cause) === "23505";
}

const DOUBLON =
  "Une redirection vient d'être posée sur cette ancienne adresse, depuis un autre écran. Rechargez la page.";

export function mountRedirections(app: Hono): void {
  /**
   * Toutes les redirections : les vivantes, avec où mène chacune, et les
   * archivées. Les plus récentes d'abord — l'identifiant croît avec le temps,
   * c'est le seul ordre que la table garde.
   */
  app.get("/admin/redirections", async (c) => {
    const lignes = await db
      .select({
        id: schema.redirects.id,
        fromPath: schema.redirects.fromPath,
        toPath: schema.redirects.toPath,
        code: schema.redirects.code,
        archivedAt: schema.redirects.archivedAt,
      })
      .from(schema.redirects)
      .orderBy(desc(schema.redirects.id));
    const vivantes = lignes.filter((l) => !l.archivedAt);
    // Où le site conduit chacune (une cible redirigée à son tour, une
    // adresse Shopify d'avant l'écran), et celles qui passent par elle.
    const table = tableDe(vivantes);
    const finales = new Map<number, Finale>();
    const relais = new Map<string, string[]>();
    for (const l of vivantes) {
      const f = destinationFinale(l.toPath, normaliserChemin(l.fromPath), table);
      finales.set(l.id, f);
      if (f.ok) for (const e of f.etapes) relais.set(e, [...(relais.get(e) ?? []), l.fromPath]);
    }
    const ouMene = (l: { id: number; toPath: string }) => {
      const f = finales.get(l.id);
      return f?.ok ? f.cible : l.toPath;
    };
    const etats = await etatsDesCibles(db, vivantes.map(ouMene));
    return c.json({
      vivantes: vivantes.map((l) => {
        const f = finales.get(l.id)!;
        // Une boucle ne s'écrit plus d'ici, mais une table remplie autrement
        // (un script, une version d'avant) peut en garder une : le site ne
        // l'applique pas, la liste le dit.
        const etat: EtatCible | null = f.ok
          ? (etats.get(ouMene(l)) ?? null)
          : { libelle: null, alerte: "Elle tourne en rond avec une autre redirection : le site ne l'applique pas. Archivez l'une des deux." };
        return versBo(l, etat, f.ok && f.cible !== l.toPath ? f.cible : null, relais.get(normaliserChemin(l.fromPath)) ?? []);
      }),
      archivees: lignes.filter((l) => l.archivedAt).map((l) => versBo(l)),
    });
  });

  /**
   * L'import, avec aperçu. Sans `appliquer`, rien n'est écrit : on rend ce
   * qui se passerait, ligne par ligne. Avec, le plan est recalculé dans la
   * transaction qui l'écrit : la liste a pu changer depuis l'aperçu.
   *
   * Déclarée AVANT « /admin/redirections/:id », qui prendrait « import » pour
   * un identifiant.
   */
  app.post("/admin/redirections/import", async (c) => {
    const corps = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const appliquer = corps.appliquer === true;
    const texte = typeof corps.texte === "string" ? corps.texte : "";
    if (!texte.trim())
      return c.json({ error: "Aucun fichier n'a été reçu. Choisissez le fichier, ou collez son contenu." }, 400);
    if (texte.length > IMPORT_CARACTERES_MAX)
      return c.json({ error: "Ce fichier est trop gros pour un seul import. Coupez-le en plusieurs fichiers." }, 400);
    const lu = lireFichierRedirections(texte);
    const total = lu.lignes.length + lu.illisibles.length;
    if (!total)
      return c.json({ error: "Aucune redirection n'a été trouvée dans ce fichier. Il faut deux colonnes : l'ancienne adresse, puis la nouvelle." }, 400);
    if (total > IMPORT_LIGNES_MAX)
      return c.json({ error: `Ce fichier compte ${total} lignes : c'est trop pour un seul import. Coupez-le en fichiers de ${IMPORT_LIGNES_MAX} lignes au plus.` }, 400);

    const hotes = hotesDeLaBoutique();
    const calculer = async (lecteur: Lecteur) =>
      planDImport(lu, await lireVivantes(lecteur), await pagesQuiExistent(lecteur, anciennesDuFichier(lu.lignes, hotes)), hotes);
    // Chaque ligne à créer dit où elle mène : une affiche introuvable doit se
    // voir AVANT « Appliquer », pas dans la liste une fois écrite.
    const reponse = async (plan: PlanImport, applique: boolean) => {
      const etats = await etatsDesCibles(db, plan.creer.map((r) => r.toPath));
      return {
        applique,
        lignes: total,
        entete: lu.entete,
        apercu: plan.apercu.map((l) => ({
          ...l,
          cible: l.action === "creation" && l.toPath ? (etats.get(l.toPath) ?? null) : null,
        })),
        compte: plan.compte,
      };
    };

    if (!appliquer) return c.json(await reponse(await calculer(db), false));
    try {
      const plan = await db.transaction(async (tx) => {
        const plan = await calculer(tx);
        if (plan.creer.length)
          await tx.insert(schema.redirects).values(plan.creer.map((r) => ({ ...r, code: 301 })));
        return plan;
      });
      return c.json(await reponse(plan, true));
    } catch (e) {
      if (estUnDoublon(e))
        return c.json({ error: "Une redirection a été posée entre-temps sur l'une de ces adresses. Relancez l'aperçu." }, 409);
      throw e;
    }
  });

  /**
   * Ajoute une redirection. Sur une page qui existe, rien n'est écrit tant que
   * `confirmer` n'est pas vrai : la réponse dit ce qui deviendrait
   * inaccessible (`aConfirmer`), l'écran le montre et repose la question.
   */
  app.post("/admin/redirections", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const hotes = hotesDeLaBoutique();
    const a = lireAncienneAdresse(b.fromPath, hotes);
    if (!a.ok) return c.json({ error: a.raison }, 400);
    const n = lireNouvelleAdresse(b.toPath, hotes);
    if (!n.ok) return c.json({ error: n.raison }, 400);
    const code = codeVoulu(b.code);
    if (!code) return c.json({ error: "Le code est 301 (définitive) ou 302 (temporaire)." }, 400);

    const p = planDeSaisie(a.chemin, n.cible, await lireVivantes(db), { pour: "ajout", code });
    if (!p.ok) return c.json({ error: p.raison, existante: p.existante?.id ?? null }, 409);
    const notes = [...a.notes, ...n.notes, ...p.plan.notes];
    const page = (await pagesQuiExistent(db, [a.chemin])).get(a.chemin);
    if (page && b.confirmer !== true)
      return c.json({
        ok: false,
        aConfirmer: `« ${montrer(a.chemin)} » est ${page}. Le site appliquera la redirection avant d'afficher quoi que ce soit : tant qu'elle sera en vigueur, tous ceux qui arrivent à cette adresse, Google compris, iront à « ${montrer(p.plan.toPath)} ».`,
        fromPath: a.chemin,
        toPath: p.plan.toPath,
        notes,
      });
    try {
      const [ligne] = await db
        .insert(schema.redirects)
        .values({ fromPath: p.plan.fromPath, toPath: p.plan.toPath, code })
        .returning();
      const etat = (await etatsDesCibles(db, [ligne!.toPath])).get(ligne!.toPath) ?? null;
      return c.json({ ok: true, redirection: versBo(ligne!, etat), notes });
    } catch (e) {
      if (estUnDoublon(e)) return c.json({ error: DOUBLON }, 409);
      throw e;
    }
  });

  /**
   * Archive une redirection, ou la restaure. Restaurer repasse par les mêmes
   * contrôles qu'un ajout : la liste a pu changer depuis (une autre
   * redirection posée sur la même adresse, une affiche revenue à son ancien
   * nom), et sa cible peut être devenue elle-même une redirection.
   */
  app.post("/admin/redirections/:id/archive", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "introuvable" }, 404);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    // Défaut : on archive. Seul un « archive: false » explicite restaure.
    const archiver = b.archive !== false;
    const [ligne] = await db.select().from(schema.redirects).where(eq(schema.redirects.id, id));
    if (!ligne) return c.json({ error: "Cette redirection n'existe plus." }, 404);

    const de = normaliserChemin(ligne.fromPath);
    if (archiver) {
      // Celles qui passaient par elle retrouvent leur propre cible : le dire,
      // c'est ce que l'archivage change pour elles.
      const vivantes = await lireVivantes(db);
      const passent = ligne.archivedAt
        ? []
        : (passantPar(vivantes.filter((r) => r.id !== id), tableDe(vivantes), new Set([de])).get(de) ?? []);
      const [faite] = await db
        .update(schema.redirects)
        .set({ archivedAt: ligne.archivedAt ?? new Date() })
        .where(eq(schema.redirects.id, id))
        .returning();
      const plus = passent.length > 1;
      return c.json({
        ok: true,
        archive: true,
        redirection: versBo(faite!),
        notes: passent.length
          ? [`${enumerer(passent)} ${plus ? "mènent" : "mène"} de nouveau à « ${montrer(de)} », et non plus à « ${montrer(ligne.toPath)} ».`]
          : [],
      });
    }
    if (!ligne.archivedAt) return c.json({ ok: true, archive: false, redirection: versBo(ligne), notes: [] });

    const hotes = hotesDeLaBoutique();
    const n = lireNouvelleAdresse(ligne.toPath, hotes);
    if (!n.ok) return c.json({ error: n.raison }, 400);
    const p = planDeSaisie(de, n.cible, await lireVivantes(db), { soi: id, pour: "restauration", code: ligne.code });
    if (!p.ok) return c.json({ error: p.raison }, 409);
    const page = (await pagesQuiExistent(db, [de])).get(de);
    if (page && b.confirmer !== true)
      return c.json({
        ok: false,
        aConfirmer: `« ${montrer(de)} » est aujourd'hui ${page}. Restaurée, la redirection enverrait tous ceux qui y arrivent, Google compris, vers « ${montrer(p.plan.toPath)} ».`,
        fromPath: de,
        toPath: p.plan.toPath,
        notes: [...n.notes, ...p.plan.notes],
      });
    try {
      const [faite] = await db
        .update(schema.redirects)
        .set({ archivedAt: null, fromPath: p.plan.fromPath, toPath: p.plan.toPath })
        .where(eq(schema.redirects.id, id))
        .returning();
      return c.json({
        ok: true,
        archive: false,
        redirection: versBo(faite!),
        notes: [...n.notes, ...p.plan.notes],
      });
    } catch (e) {
      if (estUnDoublon(e)) return c.json({ error: DOUBLON }, 409);
      throw e;
    }
  });

  /**
   * Change la cible (et le code) d'une redirection vivante. L'ancienne adresse
   * ne change pas : en changer, c'est une autre redirection — on archive
   * celle-ci et on en ajoute une.
   */
  app.post("/admin/redirections/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "introuvable" }, 404);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const [ligne] = await db.select().from(schema.redirects).where(eq(schema.redirects.id, id));
    if (!ligne) return c.json({ error: "Cette redirection n'existe plus." }, 404);
    if (ligne.archivedAt)
      return c.json({ error: "Cette redirection est archivée : restaurez-la d'abord." }, 409);
    const n = lireNouvelleAdresse(b.toPath, hotesDeLaBoutique());
    if (!n.ok) return c.json({ error: n.raison }, 400);
    const code = codeVoulu(b.code ?? ligne.code);
    if (!code) return c.json({ error: "Le code est 301 (définitive) ou 302 (temporaire)." }, 400);
    const de = normaliserChemin(ligne.fromPath);
    const p = planDeSaisie(de, n.cible, await lireVivantes(db), { soi: id, pour: "modification", code });
    if (!p.ok) return c.json({ error: p.raison }, 409);
    const [faite] = await db
      .update(schema.redirects)
      .set({ toPath: p.plan.toPath, code })
      .where(eq(schema.redirects.id, id))
      .returning();
    const etat = (await etatsDesCibles(db, [faite!.toPath])).get(faite!.toPath) ?? null;
    return c.json({
      ok: true,
      redirection: versBo(faite!, etat),
      notes: [...n.notes, ...p.plan.notes],
    });
  });
}
