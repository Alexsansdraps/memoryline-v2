/**
 * La ville d'une affiche, lue dans son nom.
 *
 * La convention de la boutique : le nom commence par la ville en CAPITALES,
 * puis vient le sujet en minuscules — « AMIENS Cathédrale ciel bleu ».
 * Un mot appartient donc à la ville tant qu'il est entièrement en capitales,
 * ce qui attrape aussi « BAIE DE SOMME », « CÔTE D'OPALE » et
 * « SAINT-VALERY-SUR-SOMME » sans rien coder de particulier.
 *
 * Vérifié sur le catalogue : 176 affiches, 101 villes, aucune exception.
 * Une affiche qui ne suivrait pas la convention n'a simplement pas de ville,
 * et n'apparaît sous aucun filtre — jamais sous une mauvaise.
 *
 * Dans un module à part (18/11) : le filtre par lieu du catalogue (index.ts)
 * et celui des pages d'affiches choisies (cms.ts) doivent lire le lieu par la
 * MÊME règle, et cms.ts ne peut pas importer index.ts, qui démarre le serveur.
 */
export function villeDuNom(nom: string): string {
  const pris: string[] = [];
  for (const brut of String(nom ?? "").split(/\s+/)) {
    const mot = brut.replace(/[–—-]+$/, "");
    if (!/^[A-ZÀ-ÖØ-Þ0-9'’-]{2,}$/u.test(mot)) break;
    pris.push(mot);
  }
  return pris.join(" ");
}
