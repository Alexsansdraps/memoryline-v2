import type { APIRoute } from "astro";

/**
 * robots.txt généré (remplace le fichier statique, qui pointait en dur sur
 * memoryline.fr).
 *
 * L'environnement de test ne doit JAMAIS être indexé : il servirait le même
 * contenu que memoryline.fr, en doublon. PUBLIC_NOINDEX=true bloque tout ;
 * sinon on autorise et le sitemap pointe sur le domaine réellement buildé.
 */
export const GET: APIRoute = ({ site }) => {
  const noindex = import.meta.env.PUBLIC_NOINDEX === "true";
  const base = site?.toString().replace(/\/$/, "") ?? "https://memoryline.fr";
  const body = noindex
    ? "User-agent: *\nDisallow: /\n"
    : `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap-index.xml\n`;
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
