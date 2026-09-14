import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import node from "@astrojs/node";

// Le back-office est une app authentifiée avec écritures (formulaires POST)
// -> rendu serveur (SSR) via l'adaptateur Node.
// Le BO peut être servi sous un préfixe de chemin (ADMIN_BASE=/bo derrière le
// proxy, "/" sans proxy). Astro sert alors les pages sous ce préfixe mais ne
// réécrit pas les liens écrits en dur : ils passent par src/lib/url.ts.
const base = process.env.ADMIN_BASE ?? "/";

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
  base,
  output: "server",
  adapter: node({ mode: "standalone" }),
  server: { host: true, port: 4322 },
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

  // Le .env est à la racine du monorepo, pas dans apps/admin.
  vite: {
    envDir: "../../",
    plugins: [tailwindcss()],
    // Docker Desktop sous Windows ne propage PAS les événements de fichiers
    // dans le conteneur : sans scrutation active, Vite ne voit aucune
    // modification du code et sert indéfiniment son cache. On exclut data/
    // (1,5 Go d'assets) et node_modules pour que ça reste peu coûteux.
    server: {
      ...(allowedHosts.length ? { allowedHosts } : {}),
      watch: {
        usePolling: true,
        interval: 400,
        ignored: ["**/node_modules/**", "**/data/**", "**/.git/**"],
      },
    },
  },
});
