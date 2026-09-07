import { defineMiddleware } from "astro:middleware";
import { getUser } from "./lib/auth.ts";
import { url, relPath } from "./lib/url.ts";

/**
 * Garde d'authentification : toute page du BO exige une session valide,
 * sauf /login. L'utilisateur courant est exposé via Astro.locals.user.
 */
const PUBLIC_PATHS = new Set(["/login"]);

/**
 * Écrans de configuration : réservés au propriétaire. Un compte « seller »
 * qui saisirait l'URL directement verrait sinon une interface d'édition dont
 * chaque bouton échouerait en 403 côté API — mieux vaut le renvoyer d'emblée.
 */
const OWNER_PATHS = ["/produits", "/personnages", "/promotions", "/bandeau", "/contenu"];

export const onRequest = defineMiddleware(async (context, next) => {
  // Chemin logique : le préfixe de déploiement (/bo) est retiré pour que les
  // comparaisons ci-dessous restent écrites en routes, pas en URLs.
  const pathname = relPath(context.url.pathname);

  // Laisse passer les assets internes d'Astro.
  if (pathname.startsWith("/_")) return next();

  const user = await getUser(context.request);
  context.locals.user = user;

  if (!user && !PUBLIC_PATHS.has(pathname)) {
    return context.redirect(url("/login"));
  }
  // Déjà connecté et sur /login -> vers l'accueil.
  if (user && pathname === "/login") {
    return context.redirect(url("/"));
  }
  // Écran de configuration demandé par un compte sans les droits.
  if (
    user &&
    user.role !== "owner" &&
    OWNER_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))
  ) {
    return context.redirect(url("/"));
  }
  return next();
});
