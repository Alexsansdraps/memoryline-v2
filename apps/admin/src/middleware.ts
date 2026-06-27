import { defineMiddleware } from "astro:middleware";
import { getUser } from "./lib/auth.ts";

/**
 * Garde d'authentification : toute page du BO exige une session valide,
 * sauf /login. L'utilisateur courant est exposé via Astro.locals.user.
 */
const PUBLIC_PATHS = new Set(["/login"]);

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  // Laisse passer les assets internes d'Astro.
  if (pathname.startsWith("/_")) return next();

  const user = await getUser(context.request);
  context.locals.user = user;

  if (!user && !PUBLIC_PATHS.has(pathname)) {
    return context.redirect("/login");
  }
  // Déjà connecté et sur /login -> vers l'accueil.
  if (user && pathname === "/login") {
    return context.redirect("/");
  }
  return next();
});
