/**
 * Le SOURCE de chaque écran du back-office, pour l'index de la recherche
 * (lib/index-ecrans.ts).
 *
 * Pourquoi lire les fichiers eux-mêmes, et de cette façon :
 *   - une liste d'écrans écrite à la main prend du retard — c'est exactement
 *     ce qui faisait répondre « bandeau » par le seul « Bandeau et offre » ;
 *   - le menu seul ne voit ni les sections, ni les champs, ni l'aide, ni les
 *     écrans hors du menu ;
 *   - lire les pages RENDUES demanderait une session ;
 *   - un générateur de fichier JSON au moment du build s'oublie, et le
 *     compilateur d'Astro n'est pas résoluble d'ici (ce serait une dépendance
 *     de plus) ;
 *   - `import.meta.glob(…, { query: "?raw" })`, lui, est résolu par Vite : au
 *     build, les sources entrent dans le serveur construit (dist/server, et
 *     jamais dans ce qui part au navigateur) ; en développement, une page
 *     ajoutée ou modifiée y apparaît sans redémarrer.
 *
 * C'est le SEUL fichier qui contient ce glob, et il n'est importé QUE par
 * lib/recherche-bo.ts, donc seulement côté serveur. Ne jamais l'importer
 * depuis un <script> : 1,4 Mo de source, commentaires compris, partiraient au
 * navigateur.
 *
 * La connexion, la page de résultats et les bons de livraison ne sont pas des
 * écrans qu'on cherche : ils sont écartés dès le glob.
 */
export const SOURCES_ECRANS = import.meta.glob<string>(
  [
    "/src/pages/**/*.astro",
    "/src/components/*.astro",
    "!/src/pages/login.astro",
    "!/src/pages/recherche.astro",
    "!/src/pages/commandes/bons.astro",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;
