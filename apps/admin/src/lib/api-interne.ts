/**
 * L'adresse de l'API telle que le SERVEUR la joint, lue au démarrage.
 *
 * Deux adresses coexistent : celle du navigateur (PUBLIC_API_URL, en général
 * « /api », relative, que le proxy sait router) et celle du serveur, qui
 * rend les pages et doit parler à l'API directement, sur le réseau interne
 * de Docker (http://api:3000).
 *
 * Elle se lit dans `process.env`, AU MOMENT de l'appel, et non dans
 * `import.meta.env` : Vite fige `import.meta.env` au build, et une variable
 * qui n'existe qu'au démarrage du conteneur n'y entre jamais. C'est ce qui
 * s'est passé en production : l'application retombait sur « /api », une
 * adresse relative que le serveur ne peut pas joindre, et chaque page qui
 * appelle l'API répondait 500 (« Failed to parse URL from /api/… »). En
 * développement, Astro résout `import.meta.env` à chaque requête, et le
 * défaut ne se voyait pas.
 *
 * Une adresse RELATIVE n'est jamais retenue côté serveur, quoi qu'en dise la
 * configuration : mieux vaut viser localhost et échouer clairement.
 */
export function apiInterne(): string {
  const duDemarrage =
    typeof process !== "undefined" ? process.env?.API_URL_INTERNAL : undefined;
  const candidats = [
    duDemarrage,
    import.meta.env.API_URL_INTERNAL,
    import.meta.env.PUBLIC_API_URL,
  ];
  for (const c of candidats) {
    const v = String(c ?? "").trim().replace(/\/+$/, "");
    if (/^https?:\/\//.test(v)) return v;
  }
  return "http://localhost:3000";
}
