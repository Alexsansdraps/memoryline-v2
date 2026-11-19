/**
 * Les anciennes adresses mènent aux nouvelles, au lieu de finir en 404 — et
 * chaque page n'a qu'UNE adresse.
 *
 * Le site remplace une boutique Shopify dont les adresses sont indexées par
 * Google, imprimées sur des cartes et gardées en favori. Le jour où
 * memoryline.fr basculera ici, chacune de ces adresses répondrait « page
 * introuvable » : le référencement acquis part avec, et la cliente qui
 * revient par son favori croit la boutique fermée.
 *
 * DEUX SOURCES, dans cet ordre.
 *
 *  1. La table `redirect` du back-office, pour les cas particuliers — une
 *     affiche retirée qu'on renvoie vers une autre, une page renommée.
 *     C'est une décision prise à la main : elle passe devant l'automatisme.
 *  2. Les correspondances écrites dans lib/anciennes-adresses.ts : les
 *     préfixes Shopify (/products, /collections, /policies…) et, une par une,
 *     les fiches, collections et pages qui n'ont pas d'équivalent direct.
 *
 * UN SEUL SAUT. Une redirection du back-office qui vise elle-même une
 * ancienne adresse (« /products/colmar », recopiée de Shopify) est suivie ici
 * jusqu'au bout : le visiteur et Google vont droit à /affiches/colmar, au lieu
 * de deux 301 à la suite, dont Google ne transmet pas tout.
 *
 * LE SUIVI DES CAMPAGNES PASSE. Les paramètres d'une adresse Shopify
 * (`?variant=…`, `?sort_by=…`) ne veulent rien dire ici et tombent ; ceux
 * d'une campagne (utm_*, gclid, fbclid…) suivent la redirection, sans quoi un
 * QR code imprimé ou une lettre d'information perdrait sa trace en route.
 *
 * Toutes les redirections sont des 301, « déplacé définitivement » : c'est
 * ce code qui transfère le référencement de l'ancienne adresse à la
 * nouvelle. Un 302 le garderait sur l'ancienne, qui n'existe plus. Seule une
 * ligne du back-office réglée en 302 garde son 302 — y compris pour les
 * redirections qui passent par elle : le détour est temporaire pour tous.
 *
 * (Le fichier `public/_redirects`, convention Netlify que personne ne lisait
 * ici, et la page products/[...slug].astro qui doublait ces règles ont été
 * retirés : ce fichier est la seule source.)
 */
import { defineMiddleware } from "astro:middleware";
import { api } from "./lib/api.ts";
import { apiInterne } from "./lib/api-interne.ts";
import {
  adresseDisparue,
  destinationAncienne,
  imageAncienne,
  type Destination,
} from "./lib/anciennes-adresses.ts";
import { planDuSite } from "./lib/referencement.ts";
import { cheminRameneALaPageDuStand, numeroDuStand, valeurDuStand } from "@memoryline/types";

/**
 * La page de la tablette d'un stand (18/11, `stand.page_id`, BO › Ventes
 * stand), gardée cinq secondes par stand et par langue : chaque page de la
 * tablette la demande, et une page choisie au back-office doit s'appliquer
 * dans la minute. API muette : rien n'est restreint (la tablette montre tout
 * le catalogue, comme avant) plutôt qu'une tablette bloquée en plein marché.
 */
const PAGE_TABLETTE_MS = 5 * 1000;
const pagesDesTablettes = new Map<string, { a: number; page: App.Locals["pageDuStand"] }>();
/**
 * Les stands dont l'API a RÉPONDU qu'ils n'ont pas de page en ligne (19/11) :
 * leur tablette affiche l'écran « Oups ». Une API muette n'en ajoute aucun.
 */
const standsSansPage = new Set<string>();
/** Et ceux dont l'API a répondu qu'ils n'existent pas (ou plus) : une 404. */
const standsInconnus = new Set<string>();

async function pageDeLaTablette(valeur: string, langue: string): Promise<App.Locals["pageDuStand"]> {
  if (numeroDuStand(valeur) === null) return null;
  const cle = `${valeur}|${langue}`;
  const maintenant = Date.now();
  const gardee = pagesDesTablettes.get(cle);
  if (gardee && maintenant - gardee.a < PAGE_TABLETTE_MS) return gardee.page;
  let page: App.Locals["pageDuStand"] = null;
  try {
    const p = new URLSearchParams({ stand: valeur });
    if (langue !== "fr") p.set("lang", langue);
    const res = await fetch(`${apiInterne()}/stand/page-de-la-tablette?${p.toString()}`);
    if (!res.ok) return gardee?.page ?? null;
    const r = (await res.json()) as {
      page: { slug: string; titre: string } | null;
      affiches?: string[];
      /** Absent d'une API d'avant le 19/11 : le stand est alors supposé exister. */
      existe?: boolean;
    };
    standsSansPage.delete(cle);
    standsInconnus.delete(cle);
    if (!r.page?.slug) (r.existe === false ? standsInconnus : standsSansPage).add(cle);
    if (r.page?.slug)
      page = {
        slug: r.page.slug,
        titre: r.page.titre || r.page.slug,
        affiches: Array.isArray(r.affiches) ? r.affiches : [],
      };
  } catch {
    return gardee?.page ?? null;
  }
  if (pagesDesTablettes.size > 200) pagesDesTablettes.clear();
  pagesDesTablettes.set(cle, { a: maintenant, page });
  return page;
}

/**
 * Les redirections du back-office, gardées en mémoire, relues dès qu'elles
 * changent.
 *
 * Sans ce cache, chaque page du site paierait un aller-retour à la base —
 * pour une table qui ne change qu'à la main. Mais une redirection saisie dans
 * BO › Redirections doit répondre dès qu'on l'essaie : relue toutes les cinq
 * minutes seulement, elle semblait ne pas marcher, et une redirection
 * archivée continuait de s'appliquer.
 *
 * Le site demande donc à l'API la VERSION de la table, deux secondes au plus
 * après la précédente — un compteur qu'elle tient en mémoire, sans lire la
 * base (apps/api/src/redirections.ts) —, et ne relit la table que si elle a
 * changé. Les cinq minutes restent un filet : une écriture faite hors de
 * l'API (un script) finit par arriver, elle aussi.
 */
const CACHE_MS = 5 * 60 * 1000;
const VERIFICATION_MS = 2 * 1000;
/**
 * Une lecture RATÉE sans rien en réserve (l'API qui démarre après le site)
 * n'est gardée que quinze secondes : gardée cinq minutes, elle effaçait
 * toutes les redirections du back-office pendant cinq minutes après chaque
 * redémarrage.
 */
const CACHE_ECHEC_MS = 15 * 1000;
type TableRedirections = Map<string, { vers: string; code: number }>;
let cache: {
  /** Quand la table a été lue. */
  a: number;
  duree: number;
  /** Quand sa version a été vérifiée pour la dernière fois. */
  verifiee: number;
  /** null : une API qui ne donne pas de version — on s'en tient aux cinq minutes. */
  version: string | null;
  table: TableRedirections;
} | null = null;
/**
 * La vérification en cours : vingt pages demandées dans la même seconde
 * attendent la même réponse au lieu d'interroger l'API vingt fois.
 */
let enCours: Promise<TableRedirections> | null = null;

async function tableDesRedirections(): Promise<TableRedirections> {
  const maintenant = Date.now();
  if (
    cache &&
    maintenant - cache.a < cache.duree &&
    (cache.version === null || maintenant - cache.verifiee < VERIFICATION_MS)
  )
    return cache.table;
  enCours ??= rafraichir().finally(() => {
    enCours = null;
  });
  return enCours;
}

async function rafraichir(): Promise<TableRedirections> {
  const maintenant = Date.now();
  // Encore fraîche : on ne demande que sa version.
  if (cache && cache.version !== null && maintenant - cache.a < cache.duree) {
    const gardee = cache;
    try {
      const { version } = await api.versionDesRedirections();
      if (version === gardee.version) {
        gardee.verifiee = maintenant;
        return gardee.table;
      }
    } catch {
      // API muette : la table qu'on a, et pas de nouvelle question avant la
      // prochaine vérification.
      gardee.verifiee = maintenant;
      return gardee.table;
    }
  }
  const table: TableRedirections = new Map();
  let version: string | null = null;
  try {
    const lu = await api.redirects();
    version = lu.version;
    for (const r of lu.lignes)
      table.set(normaliser(r.fromPath), {
        vers: r.toPath,
        code: r.code === 302 ? 302 : 301,
      });
  } catch {
    // API muette : on garde ce qu'on avait plutôt que de perdre les
    // redirections. Mieux vaut une table un peu ancienne qu'une page
    // introuvable.
    if (cache?.table.size) {
      cache.verifiee = maintenant;
      return cache.table;
    }
    cache = { a: maintenant, duree: CACHE_ECHEC_MS, verifiee: maintenant, version: null, table };
    return table;
  }
  cache = { a: maintenant, duree: CACHE_MS, verifiee: maintenant, version, table };
  return table;
}

/** Une adresse comparable : sans barre finale, en minuscules. */
function normaliser(chemin: string): string {
  const c = chemin.split("?")[0]!.split("#")[0]!.toLowerCase();
  return c.length > 1 ? c.replace(/\/+$/, "") : c;
}

/**
 * La forme unique d'une adresse : en minuscules, sans barre finale, et sans
 * « /fr » devant — le français vit à la racine.
 *
 * Sans cela, /fr, /contact/, /en/ et /pages/Conditions-De-Vente
 * répondaient chacune comme une page à part, avec une adresse canonique qui
 * se désignait elle-même : quatre doublons de pages qui existent déjà.
 *
 * Deux exceptions. Le code d'une photo (/photo/K7M2QX), qu'un QR code écrit
 * en capitales : la page l'accepte dans les deux casses, inutile d'ajouter un
 * saut au téléphone qui le scanne. Et les caractères encodés (%C3%A9), dont
 * la casse ne change rien au sens et que les navigateurs écrivent en
 * capitales : les « corriger » ferait rebondir chaque adresse accentuée.
 */
function cheminPropre(chemin: string): string {
  let c = chemin;
  if (!/^(\/[a-z]{2})?\/photo\//i.test(c))
    c = c.replace(/%[0-9A-Fa-f]{2}|[A-Z]+/g, (m) => (m.startsWith("%") ? m : m.toLowerCase()));
  if (c.length > 1) c = c.replace(/\/+$/, "") || "/";
  if (c === "/fr") c = "/";
  else if (c.startsWith("/fr/")) c = c.slice(3);
  return c;
}

/**
 * Les paramètres qui suivent une redirection : ceux du suivi des campagnes
 * (Google Ads, Meta, Microsoft, Mailchimp, liens Google Shopping…). Tout le
 * reste tombe — ce sont des réglages de Shopify sans équivalent ici.
 */
const SUIVI =
  /^(utm_[a-z0-9_]+|gclid|gbraid|wbraid|dclid|fbclid|msclkid|ttclid|twclid|yclid|li_fat_id|mc_cid|mc_eid|srsltid|_gl)$/i;

/** La destination, augmentée des paramètres de l'adresse demandée qui doivent suivre. */
function avecSuivi(vers: string, requete: URLSearchParams, garder: string[] = []): string {
  const suite = new URLSearchParams();
  for (const [cle, valeur] of requete)
    // `stand` aussi : une redirection ne doit pas faire sortir la tablette du
    // mode stand, qui ne vit que dans l'adresse.
    if (SUIVI.test(cle) || cle === "stand" || garder.includes(cle)) suite.append(cle, valeur);
  const texte = suite.toString();
  if (!texte) return vers;
  // Avant l'ancre : « /pages/faq#livraison?utm… » perdrait le suivi dans
  // l'ancre, que le navigateur n'envoie jamais.
  const diese = vers.indexOf("#");
  const avant = diese >= 0 ? vers.slice(0, diese) : vers;
  const ancre = diese >= 0 ? vers.slice(diese) : "";
  return avant + (avant.includes("?") ? "&" : "?") + texte + ancre;
}

/**
 * Le nombre de redirections suivies au plus pour une adresse. La boucle, elle,
 * est arrêtée par les adresses déjà vues ; cette borne ne garde que d'une
 * chaîne déraisonnable. Une chaîne ne s'allonge que d'un cran à chaque
 * redirection posée DEPUIS la cible d'une autre (BO › Redirections ne
 * réécrit pas celles qui y menaient : apps/api/src/redirections-ecran.ts).
 */
const SAUTS_MAX = 10;

/**
 * Une cible enregistrée qu'on peut envoyer telle quelle dans l'en-tête
 * Location : l'adresse http(s) d'un autre site, ou un chemin qui commence par
 * UNE seule barre. « //autre-site.fr » ou « /\autre-site.fr », eux, mènent
 * le navigateur hors de la boutique : le back-office les refuse, et le site
 * ne les suit pas s'il en restait une dans la table.
 */
function cibleSure(vers: string): boolean {
  return /^https?:\/\//i.test(vers) || /^\/(?![/\\])/.test(vers);
}

/** Une cible en trois morceaux : avant la requête, la requête (sans « ? »), l'ancre (avec « # »). */
function decouper(vers: string): { base: string; requete: string; ancre: string } {
  const diese = vers.indexOf("#");
  const ancre = diese >= 0 ? vers.slice(diese) : "";
  const avant = diese >= 0 ? vers.slice(0, diese) : vers;
  const q = avant.indexOf("?");
  return q >= 0
    ? { base: avant.slice(0, q), requete: avant.slice(q + 1), ancre }
    : { base: avant, requete: "", ancre };
}

/**
 * La redirection du back-office qui prend une adresse. Une fiche Shopify
 * rangée dans une collection (/collections/villes/products/x) est, pour
 * Shopify, la même fiche que /products/x : une redirection posée sur l'une
 * vaut pour l'autre, comme la correspondance automatique (anciennes-adresses.ts).
 * Rend aussi la clé trouvée, pour reconnaître une boucle.
 */
function redirectionDe(
  table: TableRedirections,
  ici: string,
): { cle: string; vers: string; code: number } | null {
  const fiche = /^\/collections\/[^/]+\/products\/([^/]+)$/.exec(ici)?.[1];
  for (const cle of fiche ? [ici, `/products/${fiche}`] : [ici]) {
    const r = table.get(cle);
    if (r && cibleSure(r.vers)) return { cle, ...r };
  }
  return null;
}

/**
 * Où mène une adresse : la table du back-office, puis les anciennes adresses,
 * suivies jusqu'au bout. null : l'adresse est bonne telle quelle.
 *
 * Une cible qui porte une requête (« /colmar?utm_source=lettre ») ne
 * s'arrête plus là : le site compare les adresses SANS leur requête, et la
 * requête suivante aurait redirigé de nouveau — un second saut, ou une boucle
 * sans fin quand /colmar menait à l'adresse de départ. La requête écrite dans
 * une cible suit donc jusqu'à la destination finale, après la requête propre
 * de celle-ci (un rayon, « /affiches?collection=villes »).
 *
 * Une boucle (une adresse déjà vue) ne redirige pas : l'adresse demandée
 * s'affiche telle quelle, plutôt que de faire tourner le navigateur.
 */
async function destination(
  chemin: string,
): Promise<(Destination & { code: number }) | null> {
  const table = await tableDesRedirections();
  const lirePlan = () => planDuSite().catch(() => null);
  // (« as » : sans lui, TypeScript croit `trouvee` nul pour toujours et
  // refuse de lire le saut précédent dans la boucle.)
  let trouvee = null as (Destination & { code: number }) | null;
  const vues = new Set([chemin]);
  let ici = chemin;
  /** La requête et l'ancre écrites dans les cibles déjà franchies. */
  let requete = "";
  let ancre = "";
  for (let saut = 0; saut < SAUTS_MAX; saut++) {
    const precise = redirectionDe(table, ici);
    if (precise) vues.add(precise.cle);
    const etape: (Destination & { code: number }) | null = precise
      ? { vers: precise.vers, code: precise.code }
      : await destinationAncienne(ici, lirePlan).then((d) => (d ? { ...d, code: 301 } : null));
    if (!etape) break;
    const morceaux = decouper(etape.vers);
    requete = [morceaux.requete, requete].filter(Boolean).join("&");
    ancre = morceaux.ancre || ancre;
    trouvee = {
      vers: morceaux.base,
      // Temporaire dès qu'un saut l'est : une redirection posée en 302 au
      // back-office reste un 302, même quand d'autres passent par elle. Une
      // 301 vers sa destination du moment transférerait le référencement
      // vers une page qu'on compte quitter.
      code: trouvee?.code === 302 || etape.code === 302 ? 302 : 301,
      garder: [...(trouvee?.garder ?? []), ...(etape.garder ?? [])],
    };
    // Une adresse d'un autre site est une destination finale.
    if (/^https?:\/\//i.test(morceaux.base)) break;
    const suivant = normaliser(morceaux.base);
    // Retour sur une adresse déjà traversée : une boucle.
    if (vues.has(suivant)) return null;
    vues.add(suivant);
    ici = suivant;
  }
  if (!trouvee) return null;
  return { ...trouvee, vers: trouvee.vers + (requete ? `?${requete}` : "") + ancre };
}

/**
 * Le préfixe de langue d'une adresse, s'il y en a un.
 *
 * Une ancienne adresse peut arriver préfixée (/en/products/…) : on la
 * redirige alors vers la nouvelle adresse DANS LA MÊME LANGUE, sans quoi une
 * visiteuse anglaise repartirait en français.
 */
const LANGUES = ["en", "de", "it", "es", "ja", "zh"];

/**
 * La personne du back-office qui regarde la page, ou null.
 *
 * Le cookie d'administration déclenche seul la vérification : un vrai
 * visiteur ne coûte donc AUCUN appel. Et l'API muette ne fait pas tomber la
 * page — on se contente de ne pas afficher les raccourcis.
 */
async function adminDeLaRequete(
  cookies: string,
): Promise<{ email: string; role: string } | null> {
  if (!cookies.includes("ml_admin_session=")) return null;
  try {
    const res = await fetch(`${apiInterne()}/auth/me`, { headers: { cookie: cookies } });
    if (!res.ok) return null;
    return ((await res.json()) as { user: { email: string; role: string } | null })
      .user;
  } catch {
    return null;
  }
}

/** Le cookie qui retient le mode stand d'une page à l'autre. */
const COOKIE_STAND = "ml_stand";

export const onRequest = defineMiddleware(async (context, next) => {
  const brut = context.url.pathname;

  // Posé AVANT les sorties anticipées : une feuille de style qui repart par
  // le raccourci ci-dessous laisserait `locals.stand` indéfini, et la page
  // qui le lit ensuite n'aurait aucun moyen de savoir que la question n'a
  // simplement pas été posée.
  context.locals.stand = false;
  context.locals.standValeur = null;
  context.locals.pageDuStand = null;

  // Les images de memoryline.fr (/cdn/shop/files/…) mènent au même visuel
  // du nouveau site (anciennes-adresses.ts, imageAncienne). Traitées à part :
  // ce sont des fichiers, que la règle suivante laisse passer, et elles n'ont
  // ni préfixe de langue ni paramètre de campagne à garder.
  const ancienneImage = /^\/cdn\/shop\/files\/([^/]+)$/.exec(brut);
  if (ancienneImage && (context.request.method === "GET" || context.request.method === "HEAD")) {
    let nom: string | null = null;
    try {
      nom = decodeURIComponent(ancienneImage[1]!);
    } catch {
      // Un %XX mal formé : aucune image ne porte ce nom.
    }
    const vers = nom ? await imageAncienne(nom, () => planDuSite().catch(() => null)) : null;
    if (vers) return context.redirect(vers, 301);
  }

  // Les fichiers et les routes internes ne se redirigent pas — sauf les
  // anciens plans du site (sitemap-index.xml, sitemap_products_1.xml…), que
  // Google a gardés en mémoire. /sitemap.xml lui-même est servi tel quel.
  if (brut.startsWith("/_") || /\.[a-z0-9]{2,5}$/i.test(brut))
    if (!/^\/sitemap[-_][^/]*\.xml$/i.test(brut)) return next();

  const propre = cheminPropre(brut);
  const chemin = normaliser(propre);

  // On sépare le préfixe de langue pour comparer la partie qui compte.
  const bout = chemin.split("/")[1] ?? "";
  const prefixe = LANGUES.includes(bout) ? `/${bout}` : "";
  const sansLangue = prefixe ? chemin.slice(prefixe.length) || "/" : chemin;

  // 1 et 2. Le back-office, puis les anciennes adresses.
  const cible = await destination(sansLangue);
  if (cible) {
    const absolue = /^https?:\/\//i.test(cible.vers);
    // Le préfixe de langue ne s'ajoute pas devant l'accueil (« /en/ »).
    const vers = absolue ? cible.vers : prefixe && cible.vers === "/" ? prefixe : prefixe + cible.vers;
    return context.redirect(
      avecSuivi(vers, context.url.searchParams, cible.garder),
      cible.code as 301 | 302,
    );
  }

  // 2 bis. Les anciennes adresses sans équivalent (le blog de Shopify, sa
  // page d'essai) : la page d'erreur, en 410 (anciennes-adresses.ts,
  // adresseDisparue). Après la table du back-office : une redirection posée
  // là-bas reste prioritaire.
  if (await adresseDisparue(sansLangue, () => planDuSite().catch(() => null))) {
    context.locals.statutErreur = 410;
    const page = await next("/404");
    return new Response(page.body, { status: 410, statusText: "Gone", headers: page.headers });
  }

  // 3. La forme unique de l'adresse — pour une simple lecture seulement : un
  // formulaire envoyé (POST) à « /compte/connexion/ » perdrait ses champs
  // dans une redirection. La requête entière suit : c'est la même page.
  const lecture = context.request.method === "GET" || context.request.method === "HEAD";
  if (lecture && propre !== brut) return context.redirect(propre + context.url.search, 301);

  // Résolue ici, lue partout : la mise en page et les pages qui proposent un
  // raccourci d'édition partagent la même réponse.
  context.locals.admin = await adminDeLaRequete(
    context.request.headers.get("cookie") ?? "",
  );

  /*
   * Le mode stand.
   *
   * Il vit dans l'adresse — `?stand=1` — et nulle part ailleurs : la même
   * adresse sans lui est le site normal. Les liens de la tablette le gardent
   * (Base.astro), sans quoi la vendeuse verrait réapparaître les prix du site
   * en pleine vente.
   *
   * Le mode ne porte AUCUN droit : il ne fait qu'enlever des montants de
   * l'affichage. Ce qui autorise vraiment à enregistrer une vente, c'est le
   * code du stand, qui voyage dans un en-tête au moment de valider — jamais
   * dans l'adresse, où il resterait dans l'historique de la tablette.
   */
  // Le mode stand se lit dans l'ADRESSE, et seulement là (17/11 : « sur
  // memoryline.fr on ne doit plus être en mode stand ; pas de cookie »). La
  // tablette garde ?stand=1 de page en page : Base.astro l'ajoute aux liens
  // et aux formulaires, avecStand() aux changements de page des îlots.
  const demande = context.url.searchParams.get("stand");
  const stand = demande !== null && demande !== "0";
  context.locals.stand = stand;
  // Sur la tablette, aucun raccourci du back-office : ni « Back-office » dans
  // l'en-tête, ni « Modifier cette page ». Si la vendeuse s'est connectée au
  // BO depuis ce navigateur, un client qui tient la tablette ne doit pas
  // pouvoir entrer dans sa session (18/11, Alexandra).
  if (stand) context.locals.admin = null;

  /*
   * La tablette n'affiche que la page de SON stand (18/11, Alexandra : « quand
   * je vais sur memoryline.fr/?stand=1, je dois avoir que la page /mulhouse »).
   *
   * `?stand=` ne désignait aucun stand : c'était un simple « mode stand »,
   * sans cookie depuis le 17/11, et le code du stand ne vit que dans la
   * tablette (son stockage), envoyé en en-tête à la validation. Sa valeur est
   * désormais le NUMÉRO du stand (BO › Ventes stand donne
   * « /?stand=<numéro>&code=… ») ; l'ancienne adresse « ?stand=1 » désigne le
   * stand n° 1, celui de Mulhouse. La tablette se range d'elle-même sur le
   * stand de son code (lib/stand-etat.ts).
   *
   * Un stand qui a une page : l'ACCUEIL de la tablette y mène. Le reste du
   * site reste ouvert (19/11, Margaux : « sur tous les stands ils doivent
   * voir toutes les pages du site du menu ») : menu, recherche, catalogue,
   * autres pages, toujours sans prix (tablette-stand.ts). Le code éventuel
   * suit : la tablette le range en arrivant (Base.astro).
   */
  const valeurStand = stand ? valeurDuStand(demande) : null;
  context.locals.standValeur = valeurStand;
  if (valeurStand) {
    const langueTablette = prefixe ? prefixe.slice(1) : "fr";
    const page = await pageDeLaTablette(valeurStand, langueTablette);
    context.locals.pageDuStand = page;
    if (page && lecture && cheminRameneALaPageDuStand(sansLangue)) {
      const suite = new URLSearchParams({ stand: valeurStand });
      const code = context.url.searchParams.get("code");
      if (code) suite.set("code", code);
      return context.redirect(
        `${prefixe}/pages/${encodeURIComponent(page.slug)}?${suite.toString()}`,
        302,
      );
    }
    /*
     * Un stand sans page (19/11, Alexandra : « si on regarde un stand qui n'a
     * pas de page ça doit afficher genre oups y'a pas de page attitrée ») :
     * toute adresse de sa tablette mène à l'écran « Oups », en grand. Pas de
     * page choisie dans BO › Ventes stand, ou une page pas en ligne. Il faut
     * que l'API ait répondu : muette, elle laisse le catalogue, pour ne
     * jamais bloquer une vente en plein marché.
     */
    //
    // Un stand qui n'existe pas (19/11, Alexandra : « ça doit faire juste un
    // 404 et pas une redir ») : la page 404 du site, à la même adresse. Un
    // numéro inconnu ou archivé (l'API le dit), ou un mot (« ?stand=abc »)
    // qui ne désigne aucun stand ; seul « apercu » (l'aperçu depuis le BO)
    // n'en est pas un. L'écran « Oups », lui aussi, s'affiche sur place.
    const ecranOups = "/stand-sans-page";
    const cleStand = `${valeurStand}|${langueTablette}`;
    const inconnu =
      (numeroDuStand(valeurStand) === null && valeurStand !== "apercu") ||
      standsInconnus.has(cleStand);
    if (!page && lecture && (sansLangue.replace(/\/+$/, "") || "/") !== ecranOups) {
      if (inconnu) return next("/404");
      if (standsSansPage.has(cleStand)) return next(`${prefixe}${ecranOups}`);
    }
  }

  let reponse = await next();

  /*
   * 410 et 503 rendus par la page d'erreur.
   *
   * Une fiche archivée, ou une page dont l'API ne répond pas, se réécrit vers
   * 404.astro en posant le code voulu dans `locals.statutErreur`. Mais Astro
   * force 404 sur tout ce que rend la route /404, quoi que la page déclare :
   * c'est donc ici, une fois la page rendue, que le code est rétabli. Le
   * corps et les en-têtes (dont Retry-After) restent ceux de la page.
   */
  const statutErreur = context.locals.statutErreur;
  if (statutErreur && reponse.status === 404)
    reponse = new Response(reponse.body, {
      status: statutErreur,
      statusText: statutErreur === 410 ? "Gone" : "Service Unavailable",
      headers: reponse.headers,
    });

  // Une redirection rendue par une page (Astro.redirect : rayon fusionné,
  // ancienne adresse…) garde le mode stand : sans cela, la tablette en
  // sortait au premier lien qui passait par elle (« TOUT VOIR », 17/11).
  const vers = reponse.headers.get("location");
  if (stand && vers && reponse.status >= 300 && reponse.status < 400) {
    try {
      const u = new URL(vers, context.url);
      if ((vers.startsWith("/") || u.host === context.url.host) && !u.searchParams.has("stand")) {
        u.searchParams.set("stand", valeurStand ?? "1");
        const entetes = new Headers(reponse.headers);
        entetes.set("location", u.pathname + u.search + u.hash);
        reponse = new Response(reponse.body, {
          status: reponse.status,
          statusText: reponse.statusText,
          headers: entetes,
        });
      }
    } catch {
      // Une adresse illisible : la redirection part telle quelle.
    }
  }

  // L'ancien cookie du mode stand (jusqu'au 17/11) : retiré là où il traîne
  // encore, pour qu'il ne serve plus jamais à rien.
  if (context.cookies.has(COOKIE_STAND)) context.cookies.delete(COOKIE_STAND, { path: "/" });
  return reponse;
});
