import { defineMiddleware } from "astro:middleware";
import { getUser } from "./lib/auth.ts";
import { url, relPath } from "./lib/url.ts";

/**
 * Garde d'authentification : toute page du BO exige une session valide,
 * sauf /login. L'utilisateur courant est exposé via Astro.locals.user.
 */
const PUBLIC_PATHS = new Set(["/login"]);

/**
 * Les seuls écrans qu'un VENDEUR peut ouvrir.
 *
 * On énumère ce qui est permis, pas ce qui est interdit, exactement comme la
 * garde de l'API : un écran ajouté demain ne doit pas s'ouvrir tout seul à qui
 * ne l'a pas demandé. Un vendeur tient une table un samedi après-midi ; il n'a
 * à voir ni le chiffre du site, ni les fiches clients, ni les marges.
 *
 * L'API refuse de toute façon le reste. Ce filtre-ci évite seulement à
 * quelqu'un de tomber sur un écran vide et un message qu'il ne comprend pas.
 */
const ECRANS_DU_VENDEUR = ["/ventes-salon", "/logout"];

/**
 * Les points d'accès qui refusent EUX-MÊMES, en JSON, ce qui n'est pas pour
 * le vendeur : la recherche du haut attend une réponse 403 lisible (contrat de
 * la recherche), pas la page de son stand derrière une redirection. Rien n'y
 * est servi à un vendeur : recherche.json.ts vérifie le rôle avant tout.
 */
const REFUSENT_EUX_MEMES = new Set(["/recherche.json"]);

/**
 * L'index des écrans de la recherche (lib/recherche-bo.ts) se construit juste
 * après la première page servie, sans la retarder : c'est une demi-seconde de
 * calcul, que la première recherche n'a ainsi plus à payer.
 */
let indexDemande = false;
function prechargerLaRecherche(): void {
  if (indexDemande) return;
  indexDemande = true;
  setTimeout(() => {
    import("./lib/recherche-bo.ts")
      .then((m) => m.prechargerIndexEcrans())
      .catch(() => undefined);
  }, 1000);
}

export const onRequest = defineMiddleware(async (context, next) => {
  // Chemin logique : le préfixe de déploiement (/bo) est retiré pour que les
  // comparaisons ci-dessous restent écrites en routes, pas en URLs.
  const pathname = relPath(context.url.pathname);

  // Laisse passer les assets internes d'Astro.
  if (pathname.startsWith("/_")) return next();

  const user = await getUser(context.request);
  context.locals.user = user;
  if (user?.role === "owner") prechargerLaRecherche();

  if (!user && !PUBLIC_PATHS.has(pathname)) {
    return context.redirect(url("/login"));
  }
  // Déjà connecté et sur /login : chacun chez soi. Le vendeur n'a rien à
  // faire sur le tableau de bord, qui mêle les ventes du site aux siennes.
  if (user && pathname === "/login") {
    return context.redirect(
      url(user.role === "owner" ? "/" : "/ventes-salon"),
    );
  }
  // Un écran qui n'est pas sur la liste du vendeur le renvoie à son stand.
  if (
    user &&
    user.role !== "owner" &&
    !REFUSENT_EUX_MEMES.has(pathname) &&
    !ECRANS_DU_VENDEUR.some(
      (p) => pathname === p || pathname.startsWith(p + "/"),
    )
  ) {
    return context.redirect(url("/ventes-salon"));
  }
  return next();
});
