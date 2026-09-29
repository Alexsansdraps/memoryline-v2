import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";
import solid from "@astrojs/solid-js";
import node from "@astrojs/node";

// Domaine de prod (memoryline.fr) — surchargeable par SITE_URL au build.
const site = process.env.SITE_URL ?? "https://memoryline.fr";

// Les domaines que l'application accepte de servir et de se reconnaître.
//
// Vide en local : http://localhost suffit. En ligne, le domaine du site y
// entre (cf. ALLOWED_HOSTS dans docker-compose.prod.yml), sans quoi Astro se
// croit sur localhost derrière le proxy et refuse tous les formulaires.
const allowedHosts = (process.env.ALLOWED_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

/**
 * Adresses des pages rendues à la demande (boutique + fiches affiches).
 *
 * Le plan de site ne liste que les pages générées au build : depuis que ces
 * pages se rendent à la demande, elles en disparaîtraient. On les rajoute
 * explicitement, en relisant le catalogue au moment du build. API injoignable
 * = liste vide, le build passe quand même.
 */
async function pagesCatalogue() {
  const api =
    process.env.API_URL_INTERNAL ?? process.env.PUBLIC_API_URL ?? "";
  if (!api.startsWith("http")) return [];
  const langues = ["fr", "en", "de", "it", "es"];
  const prefixe = (l) => (l === "fr" ? "" : `/${l}`);
  const racine = site.replace(/\/$/, "");
  try {
    const res = await fetch(`${api}/products?limit=1000`);
    const produits = await res.json();
    return langues.flatMap((l) => [
      `${racine}${prefixe(l)}/affiches`,
      ...produits.map((p) => `${racine}${prefixe(l)}/affiches/${p.slug}`),
    ]);
  } catch {
    return [];
  }
}

export default defineConfig({
  site,
  // Routage par langue : le FRANÇAIS reste à la racine (/affiches) pour ne
  // pas casser les URLs existantes ni les redirections depuis l'ancien
  // Shopify ; les autres langues sont préfixées (/en/affiches).
  i18n: {
    defaultLocale: "fr",
    locales: ["fr", "en", "de", "it", "es"],
    routing: { prefixDefaultLocale: false },
  },
  server: { host: true, port: 4321 },
  /**
   * Le site reste STATIQUE page par page ; seules les pages qui dépendent du
   * catalogue déclarent `prerender = false` (boutique, fiche affiche, accueil).
   *
   * Sans ça, une affiche créée au back-office n'existait qu'après un nouveau
   * build : son adresse répondait 404. L'adaptateur permet de rendre ces
   * trois pages à la demande, le reste continuant d'être servi en fichiers.
   */
  adapter: node({ mode: "standalone" }),
  /*
   * Les noms de domaine que l'application accepte de se reconnaître.
   *
   * Derrière le proxy, Astro reçoit la requête en HTTP simple et ne fait
   * confiance aux en-têtes X-Forwarded-* QUE pour les domaines listés ici.
   * Sans cette liste, il se croit sur « localhost » : l'origine du
   * formulaire (https://le-domaine) ne correspond plus à celle de la page
   * telle qu'il la voit, et chaque envoi de formulaire — connexion,
   * inscription, commande — est refusé avec « Cross-site POST form
   * submissions are forbidden ». En développement, localhost est toujours
   * accepté, ce qui expliquait que tout marche sur le PC et rien en ligne.
   *
   * Même variable que les hôtes du serveur de développement (ALLOWED_HOSTS) :
   * un seul réglage, lu AU BUILD. Le changer demande de reconstruire.
   */
  security: {
    allowedDomains: allowedHosts.map((hostname) => ({ hostname })),
  },
  integrations: [
    solid(),
    sitemap({
      customPages: await pagesCatalogue(),
      i18n: {
        defaultLocale: "fr",
        locales: {
          fr: "fr-FR",
          en: "en-GB",
          de: "de-DE",
          it: "it-IT",
          es: "es-ES",
        },
      },
    }),
  ],
  vite: {
    // Le .env est à la racine du monorepo, pas dans apps/web.
    envDir: "../../",
    plugins: [tailwindcss()],
    // Docker Desktop sous Windows ne propage PAS les événements de fichiers
    // dans le conteneur : sans scrutation active, Vite ne voit aucune
    // modification du code et sert indéfiniment son cache. On exclut data/
    // (1,5 Go d'assets) et node_modules pour que ça reste peu coûteux.
    server: {
      ...(allowedHosts.length ? { allowedHosts } : {}),
      // Le navigateur appelle l'API en `/api` — images comprises. Derrière le
      // proxy (:8080) c'est Caddy qui aiguille ; ouvert en direct sur :4321,
      // personne ne le faisait, et toutes les images tombaient en 404. Le
      // serveur de dev fait donc le même aiguillage que Caddy.
      proxy: {
        "/api": {
          target: process.env.API_URL_INTERNAL ?? "http://localhost:3000",
          changeOrigin: true,
          rewrite: (chemin) => chemin.replace(/^\/api/, ""),
        },
      },
      watch: {
        usePolling: true,
        interval: 400,
        ignored: ["**/node_modules/**", "**/data/**", "**/.git/**"],
      },
    },
  },
});
