import type { APIRoute } from "astro";
import { LANGUE_DEFAUT, lien, type Langue } from "../i18n/utils.ts";
import { RAYONS_FUSIONNES } from "../lib/anciennes-adresses.ts";
import {
  GENRES,
  adresseDuRayon,
  languesDuContenu,
  planDuSite,
} from "../lib/referencement.ts";

/**
 * Le plan du site, rendu À LA DEMANDE à partir du catalogue du moment.
 *
 * Il était construit au build par @astrojs/sitemap, qui ne voyait que les
 * pages générées d'avance : en ligne, il listait trois adresses — toutes à ne
 * pas indexer — et aucune des 177 affiches. Le voici servi à /sitemap.xml,
 * l'adresse même du plan de Shopify, déjà déclarée dans la Search Console.
 *
 * Il liste ce qui mérite d'être trouvé, et rien d'autre :
 *  - l'accueil, le catalogue, les deux pages de genre et le contact, dans les
 *    cinq langues (leur texte est celui de l'interface, traduite partout) ;
 *  - chaque rayon ouvert, sous SA seule adresse — celle du menu ;
 *  - chaque fiche en vente et chaque page publiée.
 * Une fiche, un rayon ou une page n'y figurent que dans les langues où leur
 * contenu est VRAIMENT écrit : ailleurs, la page existe (en français) mais ne
 * se présente pas comme une traduction. Le panier, le compte, la commande, la
 * recherche, le stand, les filtres par lieu et les pages 2 et suivantes n'y
 * sont pas.
 *
 * Chaque adresse porte ses versions dans les autres langues (xhtml:link
 * hreflang), comme l'en-tête des pages elles-mêmes — les deux ne doivent pas
 * se contredire.
 */
export const prerender = false;

/** Une entrée du plan : un contenu, ses langues, sa date quand on la connaît. */
interface Entree {
  /** Le chemin sans préfixe de langue, requête comprise (« /affiches?genre=… »). */
  chemin: string;
  langues: Langue[];
  maj?: string;
}

function echapper(texte: string): string {
  return texte
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const GET: APIRoute = async ({ site }) => {
  const base = (site?.toString() ?? "https://memoryline.fr").replace(/\/$/, "");
  // Le serveur de test ne doit rien faire indexer, pas même son plan.
  const enTest = import.meta.env.PUBLIC_NOINDEX === "true";

  let plan;
  try {
    plan = await planDuSite();
  } catch {
    // L'API ne répond pas et aucun plan n'est en réserve : « reviens plus
    // tard », que Google comprend, plutôt qu'un plan vide qu'il croirait.
    return new Response("Plan du site momentanément indisponible.\n", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "300" },
    });
  }

  const partout = languesDuContenu(null);
  const entrees: Entree[] = [
    { chemin: "/", langues: partout },
    { chemin: "/affiches", langues: partout },
    // Une page de genre sans affiche répond 404 : elle n'a rien à faire ici.
    ...GENRES.filter((g) => plan.genres[g] > 0).map((g) => ({
      chemin: adresseDuRayon(g),
      langues: partout,
    })),
    { chemin: "/contact", langues: partout },
    // Les rayons fusionnés (frontpage, « Tout voir »…) redirigent : seule la
    // page qui les remplace figure au plan.
    ...plan.rayons
      .filter((r) => r.produits > 0 && !RAYONS_FUSIONNES[r.slug])
      .map((r) => ({
        chemin: adresseDuRayon(r.genre, r.slug),
        langues: languesDuContenu(r.langues),
      })),
    ...plan.produits.map((p) => ({
      chemin: `/affiches/${p.slug}`,
      langues: languesDuContenu(p.langues),
      maj: p.maj,
    })),
    ...plan.pages.map((p) => ({
      chemin: `/pages/${p.slug}`,
      langues: languesDuContenu(p.langues),
      maj: p.maj,
    })),
  ];

  const absolue = (langue: Langue, chemin: string) => echapper(base + lien(langue, chemin));

  const urls = entrees.flatMap((e) => {
    // Les versions se déclarent seulement quand il y en a plusieurs ; la
    // française (à la racine) fait aussi la version par défaut.
    const versions =
      e.langues.length > 1
        ? [
            ...e.langues.map(
              (l) =>
                `    <xhtml:link rel="alternate" hreflang="${l}" href="${absolue(l, e.chemin)}"/>`,
            ),
            ...(e.langues.includes(LANGUE_DEFAUT)
              ? [
                  `    <xhtml:link rel="alternate" hreflang="x-default" href="${absolue(LANGUE_DEFAUT, e.chemin)}"/>`,
                ]
              : []),
          ]
        : [];
    return e.langues.map((l) =>
      [
        "  <url>",
        `    <loc>${absolue(l, e.chemin)}</loc>`,
        ...(e.maj ? [`    <lastmod>${echapper(e.maj)}</lastmod>`] : []),
        ...versions,
        "  </url>",
      ].join("\n"),
    );
  });

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      ...(enTest ? { "X-Robots-Tag": "noindex, nofollow" } : {}),
    },
  });
};
