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
 * ligne du back-office réglée en 302 garde son 302.
 *
 * (Le fichier `public/_redirects`, convention Netlify que personne ne lisait
 * ici, et la page products/[...slug].astro qui doublait ces règles ont été
 * retirés : ce fichier est la seule source.)
 */
import { defineMiddleware } from "astro:middleware";
import { api } from "./lib/api.ts";
import { apiInterne } from "./lib/api-interne.ts";
import { destinationAncienne, type Destination } from "./lib/anciennes-adresses.ts";
import { planDuSite } from "./lib/referencement.ts";

/**
 * Les redirections du back-office, relues toutes les cinq minutes.
 *
 * Sans ce cache, chaque page du site paierait un aller-retour à la base —
 * pour une table qui ne change qu'à la main, quelques fois par an. Cinq
 * minutes suffisent à voir arriver une redirection qu'on vient de créer.
 */
const CACHE_MS = 5 * 60 * 1000;
/**
 * Une lecture RATÉE sans rien en réserve (l'API qui démarre après le site)
 * n'est gardée que quinze secondes : gardée cinq minutes, elle effaçait
 * toutes les redirections du back-office pendant cinq minutes après chaque
 * redémarrage.
 */
const CACHE_ECHEC_MS = 15 * 1000;
let cache: { a: number; duree: number; table: Map<string, { vers: string; code: number }> } | null =
  null;

async function tableDesRedirections(): Promise<
  Map<string, { vers: string; code: number }>
> {
  const maintenant = Date.now();
  if (cache && maintenant - cache.a < cache.duree) return cache.table;
  const table = new Map<string, { vers: string; code: number }>();
  try {
    for (const r of await api.redirects())
      table.set(normaliser(r.fromPath), {
        vers: r.toPath,
        code: r.code === 302 ? 302 : 301,
      });
  } catch {
    // API muette : on garde ce qu'on avait plutôt que de perdre les
    // redirections. Mieux vaut une table un peu ancienne qu'une page
    // introuvable.
    if (cache?.table.size) return cache.table;
    cache = { a: maintenant, duree: CACHE_ECHEC_MS, table };
    return table;
  }
  cache = { a: maintenant, duree: CACHE_MS, table };
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
    if (SUIVI.test(cle) || garder.includes(cle)) suite.append(cle, valeur);
  const texte = suite.toString();
  if (!texte) return vers;
  return vers + (vers.includes("?") ? "&" : "?") + texte;
}

/**
 * Où mène une adresse : la table du back-office, puis les anciennes adresses,
 * suivies jusqu'au bout (quatre sauts au plus, contre une boucle mal réglée
 * au back-office). null : l'adresse est bonne telle quelle.
 */
async function destination(
  chemin: string,
): Promise<(Destination & { code: number }) | null> {
  const table = await tableDesRedirections();
  const lirePlan = () => planDuSite().catch(() => null);
  // (« as » : sans lui, TypeScript croit `trouvee` nul pour toujours et
  // refuse de lire le saut précédent dans la boucle.)
  let trouvee = null as (Destination & { code: number }) | null;
  let ici = chemin;
  for (let saut = 0; saut < 4; saut++) {
    const precise = table.get(ici);
    const etape: (Destination & { code: number }) | null = precise
      ? { vers: precise.vers, code: precise.code }
      : await destinationAncienne(ici, lirePlan).then((d) => (d ? { ...d, code: 301 } : null));
    if (!etape) break;
    trouvee = {
      vers: etape.vers,
      // Le code du PREMIER saut : un 302 voulu au back-office reste un 302.
      code: trouvee?.code ?? etape.code,
      garder: [...(trouvee?.garder ?? []), ...(etape.garder ?? [])],
    };
    // Une adresse d'un autre site, ou qui porte déjà sa requête (un rayon),
    // est une destination finale.
    if (/^https?:\/\//i.test(etape.vers) || etape.vers.includes("?")) break;
    const suivant = normaliser(etape.vers);
    if (suivant === ici) break;
    ici = suivant;
  }
  // Une redirection qui reviendrait sur l'adresse demandée tournerait en rond.
  if (trouvee && !trouvee.vers.includes("?") && normaliser(trouvee.vers) === chemin) return null;
  return trouvee;
}

/**
 * Le préfixe de langue d'une adresse, s'il y en a un.
 *
 * Une ancienne adresse peut arriver préfixée (/en/products/…) : on la
 * redirige alors vers la nouvelle adresse DANS LA MÊME LANGUE, sans quoi une
 * visiteuse anglaise repartirait en français.
 */
const LANGUES = ["en", "de", "it", "es"];

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
   * Il s'ouvre par l'adresse — `?stand=1` — et se retient ensuite dans un
   * cookie : sans cela, la tablette perdrait le mode au premier lien cliqué,
   * et la vendeuse verrait réapparaître les prix du site en pleine vente.
   * `?stand=0` le referme, ce qui est le seul moyen de revenir au site normal
   * sur une tablette qu'on veut prêter.
   *
   * Le cookie ne porte AUCUN droit : il ne fait qu'enlever des montants de
   * l'affichage. Ce qui autorise vraiment à enregistrer une vente, c'est le
   * code du stand, qui voyage dans un en-tête au moment de valider — jamais
   * dans l'adresse, où il resterait dans l'historique de la tablette.
   */
  const demande = context.url.searchParams.get("stand");
  const cookieStand = context.cookies.get(COOKIE_STAND)?.value === "1";
  const stand = demande === null ? cookieStand : demande !== "0";
  context.locals.stand = stand;

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

  if (demande !== null) {
    if (stand)
      context.cookies.set(COOKIE_STAND, "1", {
        path: "/",
        httpOnly: false,
        sameSite: "lax",
        // Une journée de salon, pas davantage : une tablette oubliée en mode
        // stand rouvrirait la boutique sans prix des semaines plus tard.
        maxAge: 60 * 60 * 24,
      });
    else context.cookies.delete(COOKIE_STAND, { path: "/" });
  }
  return reponse;
});
