/**
 * La règle qui décide si un mode de livraison sort sur le site — et, quand il
 * ne sort pas, tout ce qui lui manque pour sortir.
 *
 * Elle a sa place à elle, hors des routes, pour deux raisons. Le SITE s'en
 * sert pour filtrer, le BACK-OFFICE pour expliquer : deux versions de cette
 * règle finiraient par afficher « proposé » sur un mode que personne ne voit,
 * et on chercherait l'erreur ailleurs pendant une heure. Et parce qu'une
 * règle qu'on peut lire et essayer seule est une règle qu'on peut vérifier,
 * ce qu'un fichier de routes de trois mille lignes n'offre pas.
 */
import { estConfigure as mondialRelayConfigure } from "./mondial-relay.js";
import { estConfigure as colissimoConfigure } from "./colissimo.js";

/**
 * Les transporteurs connus, et ce qu'il faut pour qu'ils fonctionnent.
 *
 * Écrit ICI et nulle part ailleurs : le back-office lit cette liste plutôt
 * que d'en tenir une copie, qui finirait par annoncer un transporteur que
 * l'API ne sait pas interroger.
 *
 * `integre` dit si le code sait chercher les points de ce réseau. Les autres
 * peuvent être préparés dès maintenant — la cliente crée le mode, fixe ses
 * tarifs — mais restent masqués du site tant que l'intégration n'est pas
 * écrite : laisser choisir un point relais qu'on ne saurait pas transmettre
 * au transporteur reviendrait à vendre une livraison impossible.
 *
 * `integre` ne concerne QUE la recherche de points : un transporteur qui
 * livre à domicile n'a rien à chercher, et le sien peut rester à faux sans
 * rien bloquer.
 */
export const TRANSPORTEURS = [
  {
    code: "mondial_relay",
    nom: "Mondial Relay",
    integre: true,
    variables: ["MONDIAL_RELAY_ENSEIGNE", "MONDIAL_RELAY_CLE"],
  },
  {
    code: "colissimo",
    nom: "Colissimo (La Poste)",
    integre: true,
    variables: ["COLISSIMO_CONTRAT", "COLISSIMO_MOTDEPASSE"],
  },
  // La Poste hors Colissimo : la lettre suivie s'affranchit au guichet ou en
  // ligne, sans compte à brancher. Rien à intégrer, donc rien à masquer — un
  // mode « lettre suivie » n'a jamais besoin de chercher un point de retrait.
  { code: "la_poste", nom: "La Poste (lettre suivie)", integre: false, variables: [] },
  { code: "chronopost", nom: "Chronopost / Pickup", integre: false, variables: [] },
  { code: "relais_colis", nom: "Relais Colis", integre: false, variables: [] },
  { code: "dpd", nom: "DPD Relais", integre: false, variables: [] },
  { code: "ups", nom: "UPS Access Point", integre: false, variables: [] },
  { code: "gls", nom: "GLS ParcelShop", integre: false, variables: [] },
  { code: "shop2shop", nom: "Shop2Shop (Chronopost)", integre: false, variables: [] },
] as const;

/** Un transporteur sait-il chercher ses points ? */
export function transporteurConfigure(carrier: string | null | undefined): boolean {
  if (carrier === "colissimo") return colissimoConfigure();
  if (carrier === "mondial_relay") return mondialRelayConfigure();
  // Transporteur inconnu, ou connu mais pas encore intégré : on ne prétend
  // pas savoir chercher ses points.
  return false;
}

/** Ce qu'une grille tarifaire dit d'un mode, une fois les tranches comptées. */
export interface CouvertureTarifaire {
  /** Zones où le mode a au moins une tranche vivante, active ou non. */
  zonesTarifees: number;
  /** Zones où au moins une de ces tranches facture vraiment. */
  zonesActives: number;
}

/** La couverture d'un mode qui n'a aucune tranche du tout. */
export const SANS_TARIF: CouvertureTarifaire = {
  zonesTarifees: 0,
  zonesActives: 0,
};

/** Le mode tel que la règle a besoin de le connaître. */
export interface ModeAExaminer {
  kind: string;
  carrier: string | null;
  active: boolean;
  pickupLocation: string | null;
  archivedAt: Date | null;
}

/**
 * TOUT ce qui empêche ce mode de sortir sur le site — liste vide quand il en
 * sort.
 *
 * Elle rend une LISTE et non un seul motif : un mode préparé d'avance cumule
 * les manques — décoché, sans prix, sans compte transporteur. N'en montrer
 * qu'un obligeait à revenir trois fois pour découvrir le suivant, alors que
 * la question d'Alexandra est « qu'est-ce qu'il me reste à faire ».
 */
export function raisonsMasquage(
  m: ModeAExaminer,
  standsOuverts: number,
  couverture: CouvertureTarifaire,
): string[] {
  // L'archivage passe AVANT tout le reste, et SEUL : un mode rangé ne sort
  // pas, et annoncer un compte Mondial Relay manquant sur un mode qu'on
  // n'offre plus enverrait chercher une panne là où il n'y en a pas.
  if (m.archivedAt) return ["Archivé : il ne sort plus du rangement."];

  const raisons: string[] = [];
  if (!m.active) raisons.push("Décoché : vous ne le proposez pas.");

  // Le prix avant le reste : c'est le manque le plus fréquent, et le seul
  // qu'Alexandra puisse lever seule, tout de suite, dans les grilles plus bas.
  if (couverture.zonesTarifees === 0)
    raisons.push(
      "Prix non défini : aucune tranche dans aucune zone. Remplissez sa grille plus bas — un mode sans prix afficherait 0 € de port.",
    );
  else if (couverture.zonesActives === 0)
    raisons.push(
      "Aucune zone active : ses tranches existent mais sont toutes retirées. Réactivez-en une dans les grilles plus bas.",
    );

  if (m.kind === "relay") {
    const t = TRANSPORTEURS.find((x) => x.code === m.carrier);
    if (!t)
      raisons.push(
        `Transporteur « ${m.carrier ?? "non renseigné"} » inconnu : la recherche de points relais est impossible.`,
      );
    else if (!t.integre)
      raisons.push(
        `L'intégration ${t.nom} n'est pas encore écrite : le client ne pourrait pas choisir son point.`,
      );
    else if (!transporteurConfigure(m.carrier))
      raisons.push(
        `Il manque le compte ${t.nom} : ajoutez ${t.variables.join(" et ")} dans le fichier .env, puis redémarrez l'API.`,
      );
  }
  if (m.kind === "pickup" && standsOuverts === 0 && !m.pickupLocation?.trim())
    raisons.push(
      "Aucun stand ouvert et aucun lieu de retrait renseigné : personne ne pourrait remettre la commande.",
    );
  return raisons;
}

/**
 * Combien de zones chaque mode dessert, d'après les tranches VIVANTES.
 *
 * Les tranches archivées ne facturent plus rien : les compter ferait dire
 * « ce mode a un prix » à un mode dont toute la grille a été rangée.
 */
export function couverturesParMode(
  tarifs: readonly {
    methodId: number;
    zoneId: number;
    active: boolean;
    archivedAt: Date | null;
  }[],
): Map<number, CouvertureTarifaire> {
  const tarifees = new Map<number, Set<number>>();
  const actives = new Map<number, Set<number>>();
  const noter = (carte: Map<number, Set<number>>, mode: number, zone: number) => {
    const s = carte.get(mode) ?? new Set<number>();
    s.add(zone);
    carte.set(mode, s);
  };
  for (const t of tarifs) {
    if (t.archivedAt) continue;
    noter(tarifees, t.methodId, t.zoneId);
    if (t.active) noter(actives, t.methodId, t.zoneId);
  }
  const couvertures = new Map<number, CouvertureTarifaire>();
  for (const mode of new Set([...tarifees.keys(), ...actives.keys()]))
    couvertures.set(mode, {
      zonesTarifees: tarifees.get(mode)?.size ?? 0,
      zonesActives: actives.get(mode)?.size ?? 0,
    });
  return couvertures;
}
