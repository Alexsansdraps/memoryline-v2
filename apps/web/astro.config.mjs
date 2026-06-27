import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";
import solid from "@astrojs/solid-js";

// Domaine de prod (memoryline.fr) — surchargeable par SITE_URL au build.
const site = process.env.SITE_URL ?? "https://memoryline.fr";

export default defineConfig({
  site,
  server: { host: true, port: 4321 },
  integrations: [
    solid(),
    sitemap({
      i18n: { defaultLocale: "fr", locales: { fr: "fr-FR" } },
    }),
  ],
  vite: {
    // Le .env est à la racine du monorepo, pas dans apps/web.
    envDir: "../../",
    plugins: [tailwindcss()],
  },
});
