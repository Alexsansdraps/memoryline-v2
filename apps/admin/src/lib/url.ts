/**
 * Liens internes du back-office.
 *
 * Le BO est servi sous un préfixe de chemin (`/bo` derrière le proxy, `/` sans
 * proxy) : Astro sert bien les pages sous ce préfixe, mais il ne réécrit PAS
 * les liens écrits en dur dans les templates. Tout lien interne passe donc par
 * `url()`, et toute comparaison de chemin par `relPath()`.
 */

/** Base de déploiement, sans slash final : "" ou "/bo". */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Lien interne, préfixé par la base de déploiement. */
export function url(path: string): string {
  return `${BASE}${path}`;
}

/** Chemin courant débarrassé de la base — comparable aux routes logiques. */
export function relPath(pathname: string): string {
  if (!BASE) return pathname;
  const p = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname;
  return p || "/";
}
