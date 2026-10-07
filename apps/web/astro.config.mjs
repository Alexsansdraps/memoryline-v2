import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import solid from "@astrojs/solid-js";
import node from "@astrojs/node";

// Domaine de prod (memoryline.fr) — surchargeable par SITE_URL au build. Il
// fait l'adresse canonique, les hreflang, og:url et le plan du site : sur le
// serveur de test, il vaut le domaine de test (cf. PUBLIC_ORIGIN).
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
  /*
   * Plus d'intégration « sitemap » : elle ne voyait que les pages générées au
   * build — trois, toutes à ne pas indexer — et interrogeait l'API pendant
   * `docker compose build`, où l'API n'est pas joignable. Le plan du site est
   * désormais rendu à la demande par src/pages/sitemap.xml.ts, à partir du
   * catalogue du moment.
   */
  integrations: [solid()],
  vite: {
    // Le .env est à la racine du monorepo, pas dans apps/web.
    envDir: "../../",
    plugins: [tailwindcss()],
    // Modules chargés à la demande (import() au clic) : Vite ne les découvre
    // qu'au moment où la page les réclame, refait alors son pré-chargement
    // et répond 504 à la page déjà ouverte. La carte des points relais se
    // masquait sans rien dire (Leaflet) et la page de commande ne se montait
    // plus (Stripe). Nommés ici, ils sont prêts dès le démarrage. Sans effet
    // sur le site en ligne, qui est construit d'avance.
    optimizeDeps: {
      include: ["leaflet", "@stripe/stripe-js"],
    },
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
