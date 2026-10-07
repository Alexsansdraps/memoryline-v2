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
 * sont déjà en « noindex » ; on épargne en plus aux robots de les parcourir,
 * comme le faisait le robots.txt de Shopify (/cart, /checkout, /account).
 * Dans chaque langue, écrit en toutes lettres : un motif à joker valable
 * pour toutes les langues attraperait aussi une affiche dont l'adresse
 * contiendrait le mot « panier ».
 *
 * Le plan du site est /sitemap.xml, rendu à la demande (sitemap.xml.ts).
 */
const PRIVEES = ["/panier", "/commande", "/compte", "/recherche", "/photo/"];

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
