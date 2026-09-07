import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import node from "@astrojs/node";

// Le back-office est une app authentifiée avec écritures (formulaires POST)
// -> rendu serveur (SSR) via l'adaptateur Node.
// Le BO peut être servi sous un préfixe de chemin (ADMIN_BASE=/bo derrière le
// proxy, "/" sans proxy). Astro sert alors les pages sous ce préfixe mais ne
// réécrit pas les liens écrits en dur : ils passent par src/lib/url.ts.
const base = process.env.ADMIN_BASE ?? "/";

export default defineConfig({
  base,
  output: "server",
  adapter: node({ mode: "standalone" }),
  server: { host: true, port: 4322 },
  // Le .env est à la racine du monorepo, pas dans apps/admin.
  vite: { envDir: "../../", plugins: [tailwindcss()] },
});
