import type { APIRoute } from "astro";
import { LANGUES, LANGUE_DEFAUT } from "../i18n/utils.ts";

/**
 * robots.txt généré (remplace le fichier statique, qui pointait en dur sur
 * memoryline.fr).
 *
 * L'environnement de test ne doit JAMAIS être indexé : il servirait le même
 * contenu que memoryline.fr, en doublon. PUBLIC_NOINDEX=true bloque tout ;
 * sinon on autorise et le sitemap pointe sur le domaine réellement buildé.
 *
 * En ligne, les pages qui n'ont rien à faire dans Google — le panier, la
 * commande, le compte, la recherche, la photo envoyée depuis un téléphone —
 * sont en « noindex ». Seules la commande et la photo sont en plus fermées
 * aux robots : aucun lien public n'y mène.
 *
 * Le panier, le compte et la recherche restent OUVERTS, alors que
 * Shopify fermait /cart et /account : chaque page du site les lie (près de
 * quatre cents liens dans le plan du site), et Google ne lit pas le
 * « noindex » d'une page qu'il n'a pas le droit d'ouvrir. Fermées, il
 * pourrait les montrer dans ses résultats comme « indexée malgré le blocage
 * par robots.txt » (AUDIT-SEO.md, IDX-3).
 *
 * Dans chaque langue, écrit en toutes lettres : un motif à joker valable
 * pour toutes les langues attraperait aussi une affiche dont l'adresse
 * contiendrait le mot « commande ».
 *
 * Le plan du site est /sitemap.xml, rendu à la demande (sitemap.xml.ts).
 */
const PRIVEES = ["/commande", "/photo/"];

export const GET: APIRoute = ({ site }) => {
  const noindex = import.meta.env.PUBLIC_NOINDEX === "true";
  const base = site?.toString().replace(/\/$/, "") ?? "https://memoryline.fr";
  const interdits = [
    "/bo/",
    ...LANGUES.flatMap((l) =>
      PRIVEES.map((p) => (l === LANGUE_DEFAUT ? p : `/${l}${p}`)),
    ),
  ];
  const body = noindex
    ? "User-agent: *\nDisallow: /\n"
    : [
        "User-agent: *",
        "Allow: /",
        ...interdits.map((p) => `Disallow: ${p}`),
        "",
        `Sitemap: ${base}/sitemap.xml`,
        "",
      ].join("\n");
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
