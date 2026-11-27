/**
 * Le catalogue des personnages du ciel étoilé, ASSIS dans l'herbe, vus de
 * dos, la tête levée vers les étoiles : les ombres vectorisées depuis les
 * planches d'Alexandra (27/11, « tiens pour les svg c'est ça qu'il faut pour
 * les ombres »). La base est sur y = 0, en centimètres (un adulte assis
 * mesure environ 90 cm).
 *
 * Les personnages dessinés à la main et detailsAutour() (plaid, lanterne,
 * lunette…) ont été retirés le 27/11 au soir : plus rien ne les appelait.
 */

import type { Silhouette } from "./ciel-silhouettes.js";
import { OMBRES } from "./ciel-ombres.js";
import { OMBRES_2 } from "./ciel-ombres-2.js";

/**
 * Toutes les silhouettes assises : les ombres vectorisées depuis l'image
 * d'Alexandra (ciel-ombres.ts), sous les ids d'avant (27/11, Alexandra :
 * « tiens pour les svg c'est ça qu'il faut pour les ombres, supprime celles
 * que tu as fait tu prends ça »). Les personnages dessinés à la main sont
 * supprimés ; « montre-le-ciel », sans équivalent dans l'image, disparaît
 * (un ancien réglage qui le cite est ignoré par lireReglagesCiel).
 */
export const SILHOUETTES_ASSISES: readonly Silhouette[] = [
  ...OMBRES,
  // La 2e planche (27/11 au soir), rangée par groupes (ciel-ombres-2.ts) :
  // c'est elle que la fiche propose ; les dix d'avant restent connues pour
  // redessiner les ciels déjà créés.
  ...OMBRES_2,
];

export const SILHOUETTES_ASSISES_PAR_ID: ReadonlyMap<string, Silhouette> = new Map(SILHOUETTES_ASSISES.map((s) => [s.id, s]));
