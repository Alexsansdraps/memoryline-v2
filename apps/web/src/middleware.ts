/**
 * Les anciennes adresses mènent aux nouvelles, au lieu de finir en 404.
 *
 * Le site remplace une boutique Shopify dont les adresses sont indexées par
 * Google, imprimées sur des cartes et gardées en favori. Le jour où
 * memoryline.fr basculera ici, chacune de ces adresses répondrait « page
 * introuvable » : le référencement acquis part avec, et la cliente qui
 * revient par son favori croit la boutique fermée.
 *
 * Le fichier `public/_redirects` existait déjà, mais c'est une convention
 * Netlify : PERSONNE ne le lit ici. Il était servi en texte brut, à
 * l'adresse /_redirects, et ne redirigeait rien. Ce fichier-ci fait le
 * travail pour de bon.
 *
 * DEUX SOURCES, dans cet ordre.
 *
 *  1. Les règles de préfixe, écrites ici : elles valent pour des milliers
 *     d'adresses d'un coup et ne changent jamais.
 *  2. La table `redirect` du back-office, pour les cas particuliers — une
 *     affiche retirée qu'on renvoie vers une autre, une page renommée.
 *     Elle l'emporte sur les règles de préfixe : c'est une décision prise
 *     à la main, elle passe devant l'automatisme.
 *
 * Toutes les redirections sont des 301, « déplacé définitivement » : c'est
 * ce code qui transfère le référencement de l'ancienne adresse à la
 * nouvelle. Un 302 le garderait sur l'ancienne, qui n'existe plus.
 */
import { defineMiddleware } from "astro:middleware";
import { api } from "./lib/api.ts";
import { apiInterne } from "./lib/api-interne.ts";

/** Les préfixes Shopify, et ce qu'ils deviennent. */
const REGLES: { motif: RegExp; vers: (m: RegExpMatchArray) => string }[] = [
  // Une fiche produit : /products/vieux-moulin -> /affiches/vieux-moulin
  { motif: /^\/products\/(.+)$/, vers: (m) => `/affiches/${m[1]}` },
  // La liste des produits.
  { motif: /^\/products\/?$/, vers: () => "/affiches" },
  // Une collection Shopify devient un filtre du catalogue.
  {
    motif: /^\/collections\/(?!all\b)([^/]+)$/,
    vers: (m) => `/affiches?collection=${encodeURIComponent(m[1]!)}`,
  },
  { motif: /^\/collections\/all\/?$/, vers: () => "/affiches" },
  { motif: /^\/collections\/?$/, vers: () => "/affiches" },
  // Le panier et le compte.
  { motif: /^\/cart\/?$/, vers: () => "/panier" },
  { motif: /^\/account\/login\/?$/, vers: () => "/compte/connexion" },
  { motif: /^\/account\/register\/?$/, vers: () => "/compte/inscription" },
  { motif: /^\/account\/?$/, vers: () => "/compte" },
  // Les pages libres gardent leur préfixe ; seules quelques adresses ont
  // changé de nom en passant d'une boutique à l'autre.
  { motif: /^\/pages\/cgv\/?$/, vers: () => "/pages/conditions-de-vente" },
  {
    motif: /^\/pages\/conditions-generales-de-vente\/?$/,
    vers: () => "/pages/conditions-de-vente",
  },
  {
    motif: /^\/pages\/politique-de-confidentialite\/?$/,
    vers: () => "/pages/confidentialite",
  },
  { motif: /^\/pages\/contact\/?$/, vers: () => "/contact" },
  { motif: /^\/pages\/nous-contacter\/?$/, vers: () => "/contact" },
  // Le plan du site de Shopify.
  { motif: /^\/sitemap\.xml$/, vers: () => "/sitemap-index.xml" },
];

/**
 * Les redirections du back-office, relues toutes les cinq minutes.
 *
 * Sans ce cache, chaque page du site paierait un aller-retour à la base —
 * pour une table qui ne change qu'à la main, quelques fois par an. Cinq
 * minutes suffisent à voir arriver une redirection qu'on vient de créer.
 */
const CACHE_MS = 5 * 60 * 1000;
let cache: { a: number; table: Map<string, { vers: string; code: number }> } | null =
  null;

async function tableDesRedirections(): Promise<
  Map<string, { vers: string; code: number }>
> {
  const maintenant = Date.now();
  if (cache && maintenant - cache.a < CACHE_MS) return cache.table;
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
    if (cache) return cache.table;
  }
  cache = { a: maintenant, table };
  return table;
}

/** Une adresse comparable : sans barre finale, en minuscules. */
function normaliser(chemin: string): string {
  const c = chemin.split("?")[0]!.split("#")[0]!.toLowerCase();
  return c.length > 1 ? c.replace(/\/+$/, "") : c;
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
  const chemin = normaliser(context.url.pathname);

  // Posé AVANT les sorties anticipées : une feuille de style qui repart par
  // le raccourci ci-dessous laisserait `locals.stand` indéfini, et la page
  // qui le lit ensuite n'aurait aucun moyen de savoir que la question n'a
  // simplement pas été posée.
  context.locals.stand = false;

  // Les fichiers et les routes internes ne se redirigent pas.
  if (chemin.startsWith("/_") || /\.[a-z0-9]{2,5}$/i.test(chemin))
    if (chemin !== "/sitemap.xml") return next();

  // On sépare le préfixe de langue pour comparer la partie qui compte.
  const bout = chemin.split("/")[1] ?? "";
  const prefixe = LANGUES.includes(bout) ? `/${bout}` : "";
  const sansLangue = prefixe ? chemin.slice(prefixe.length) || "/" : chemin;

  // 1. Une décision prise à la main passe avant tout automatisme.
  const table = await tableDesRedirections();
  const precise = table.get(sansLangue);
  if (precise)
    return context.redirect(
      precise.vers.startsWith("http") ? precise.vers : prefixe + precise.vers,
      precise.code as 301 | 302,
    );

  // 2. Les règles de préfixe.
  for (const regle of REGLES) {
    const m = sansLangue.match(regle.motif);
    if (m) return context.redirect(prefixe + regle.vers(m), 301);
  }

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

  const reponse = await next();
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
