import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import node from "@astrojs/node";

// Le back-office est une app authentifiée avec écritures (formulaires POST)
// -> rendu serveur (SSR) via l'adaptateur Node.
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  server: { host: true, port: 4322 },
  // Le .env est à la racine du monorepo, pas dans apps/admin.
  vite: { envDir: "../../", plugins: [tailwindcss()] },
});
