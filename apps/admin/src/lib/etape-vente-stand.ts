/**
 * « Marquer terminées » et « Remettre à imprimer », la barre de la sélection
 * de Ventes stand (26/11, Alexandra : « il faut que quand la personne créé
 * une affiche, qu'elle ne soit pas directement terminée mais qu'on doive le
 * faire soit dans la commande soit sur la liste avec case à cocher »).
 *
 * L'API fait le geste (apps/api/src/etape-vente-stand.ts, actions groupées
 * « terminer-stand » et « remettre-a-imprimer » de commandes.ts) et rend
 * combien de ventes ont changé d'étape, et celles qu'elle a IGNORÉES, chacune
 * avec son numéro et une raison courte : déjà à l'étape demandée (un double
 * clic), vente de test, annulée, commande du site… Ici, la phrase qui le dit
 * à Margaux, chaque nombre accordé : pas de « (s) ».
 *
 * Sans dépendance ni base : essayé par tests/etape-vente-stand.test.mjs.
 */

/** Les deux gestes, tels que la barre les envoie (`bulk`). */
export const GESTES_ETAPE_STAND = ["terminer-stand", "remettre-a-imprimer"] as const;
export type GesteEtapeStand = (typeof GESTES_ETAPE_STAND)[number];

/** Vrai pour « terminer-stand » et « remettre-a-imprimer ». */
export function estGesteEtapeStand(v: string): v is GesteEtapeStand {
  return (GESTES_ETAPE_STAND as readonly string[]).includes(v);
}

/** Une vente que le geste a laissée telle quelle. */
export interface VenteIgnoree {
  numero: string;
  raison: string;
}

/**
 * Le compte rendu du geste : combien de ventes ont changé d'étape, puis
 * combien ont été ignorées, chacune nommée avec sa raison :
 * « 2 ventes marquées terminées. Aucun courriel n'est parti. 1 vente
 * ignorée : SAL-0007 (vente de test). »
 */
export function compteRenduEtapeStand(
  geste: GesteEtapeStand,
  r: { count: number; ignorees?: readonly VenteIgnoree[] | null },
): string {
  const n = Math.max(0, r.count);
  const terminer = geste === "terminer-stand";
  const faites =
    n === 0
      ? terminer
        ? "Aucune vente n'a été marquée terminée."
        : "Aucune vente n'a été remise « À imprimer »."
      : terminer
        ? `${n} vente${n > 1 ? "s" : ""} marquée${n > 1 ? "s" : ""} terminée${n > 1 ? "s" : ""}. Aucun courriel n'est parti.`
        : `${n} vente${n > 1 ? "s" : ""} remise${n > 1 ? "s" : ""} « À imprimer ». Aucun courriel n'est parti.`;
  const ignorees = r.ignorees ?? [];
  if (!ignorees.length) return faites;
  const liste = ignorees.map((v) => `${v.numero} (${v.raison.trim().replace(/[\s.]+$/, "")})`).join(", ");
  return `${faites} ${ignorees.length} vente${ignorees.length > 1 ? "s" : ""} ignorée${ignorees.length > 1 ? "s" : ""} : ${liste}.`;
}
