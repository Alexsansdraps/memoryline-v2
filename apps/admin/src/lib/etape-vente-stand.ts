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
 * Les raisons que l'API donne à une vente DÉJÀ à l'étape demandée
 * (raisonDejaFaite, apps/api/src/etape-vente-stand.ts), recopiées ici comme
 * les autres règles partagées avec l'API.
 */
const DEJA_A_L_ETAPE: Readonly<Record<GesteEtapeStand, string>> = {
  "terminer-stand": "déjà terminée",
  "remettre-a-imprimer": "déjà à imprimer",
};

/**
 * Le compte rendu du geste : combien de ventes ont changé d'étape, combien
 * y étaient déjà, puis les ventes ignorées pour une autre raison, chacune
 * nommée avec sa raison : « 1 vente marquée terminée. Aucun courriel n'est
 * parti. 29 ventes étaient déjà terminées. 1 vente ignorée : SAL-0028
 * (vente annulée). »
 *
 * Les ventes déjà à l'étape sont COMPTÉES, plus nommées une à une
 * (relecture finale du 26/11) : le soir, « Tout cocher » dans « Toutes »
 * puis « Marquer terminées » faisait un mur de « SAL-0053 (déjà terminée),
 * … » — 854 caractères pour 31 ventes, plus de la hauteur d'un téléphone —,
 * où se noyaient la seule vente anormale et ce qui avait vraiment été fait.
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
  const raisonCourte = (v: VenteIgnoree) => v.raison.trim().replace(/[\s.]+$/, "");
  const toutes = r.ignorees ?? [];
  const deja = toutes.filter((v) => raisonCourte(v) === DEJA_A_L_ETAPE[geste]).length;
  const ignorees = toutes.filter((v) => raisonCourte(v) !== DEJA_A_L_ETAPE[geste]);
  const phrases = [faites];
  if (deja)
    phrases.push(
      terminer
        ? `${deja} vente${deja > 1 ? "s étaient" : " était"} déjà terminée${deja > 1 ? "s" : ""}.`
        : `${deja} vente${deja > 1 ? "s étaient" : " était"} déjà « À imprimer ».`,
    );
  if (ignorees.length)
    phrases.push(
      `${ignorees.length} vente${ignorees.length > 1 ? "s" : ""} ignorée${ignorees.length > 1 ? "s" : ""} : ${ignorees
        .map((v) => `${v.numero} (${raisonCourte(v)})`)
        .join(", ")}.`,
    );
  return phrases.join(" ");
}
