/**
 * Les périodes des chiffres (Aujourd'hui, 7, 30, 90 derniers jours), et la
 * liste des commandes qui les suit.
 *
 * 26/11, Alexandra, sur Ventes stand : « si je mets aujourd'hui ça doit me
 * sortir les commandes de aujourd'hui », « pareil avec 7 jours, 30 etc ».
 * Jusque-là, le bouton ne changeait que les chiffres : la liste dessous
 * restait sur toutes les dates, et « Aujourd'hui · 1 commande » surmontait
 * les ventes de la semaine.
 *
 * Plus tôt le même jour : « ces boutons doivent si ils sont cliqués, vider
 * "du" et "au" ». Les champs « Du » et « Au » restent donc VIDES : la
 * période est portée par le bouton (`jours` dans l'adresse), et une ligne
 * au-dessus de la liste dit quels jours elle montre, avec de quoi revenir à
 * toutes les dates. Des dates tapées dans « Du » ou « Au » l'emportent : la
 * liste prend celles-là, les chiffres gardent leur période.
 *
 * Seule une période CHOISIE filtre la liste. Sans `jours` dans l'adresse —
 * l'arrivée sur la page —, les chiffres montrent leurs 30 jours habituels
 * mais la liste garde toutes les dates : sinon une commande à préparer, ou
 * une vente « À imprimer », de plus de 30 jours disparaîtrait de la vue
 * d'arrivée sans que rien ne le dise.
 *
 * Mêmes jours que les chiffres (/admin/stats/orders) : des jours de
 * CALENDRIER à Paris, celui d'aujourd'hui compris (derniersJoursAParis).
 * L'API lit « Du » et « Au » de minuit au soir, heure de Paris.
 */
import { derniersJoursAParis } from "@memoryline/types/fuseau";

export const PERIODES = [
  { jours: 1, label: "Aujourd'hui", compare: "hier" },
  { jours: 7, label: "7 derniers jours", compare: "aux 7 jours précédents" },
  { jours: 30, label: "30 derniers jours", compare: "aux 30 jours précédents" },
  { jours: 90, label: "90 derniers jours", compare: "aux 90 jours précédents" },
] as const;

/** La période des chiffres quand l'adresse n'en dit rien : 30 jours. */
export const PERIODE_PAR_DEFAUT = PERIODES[2];

export interface PeriodeDeLaListe {
  jours: number;
  /** Premier jour, à Paris : « 2026-11-20 ». */
  from: string;
  /** Dernier jour, aujourd'hui à Paris : « 2026-11-26 ». */
  to: string;
  /** « Commandes d'aujourd'hui (26 novembre) », « Commandes des 7 derniers jours (du 20 au 26 novembre) ». */
  texte: string;
}

/** « 26 novembre », « 1er décembre », ou « 26 novembre 2026 » quand il faut l'année. */
function jourEnClair(jour: string, avecAnnee: boolean): string {
  return new Date(`${jour}T12:00:00Z`)
    .toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      ...(avecAnnee ? { year: "numeric" } : {}),
      timeZone: "UTC",
    })
    .replace(/^1 /, "1er ");
}

/**
 * Les jours que la liste doit montrer, ou null : aucune période choisie, une
 * période inconnue, ou des dates tapées dans « Du » / « Au » (elles
 * l'emportent).
 */
export function periodeDeLaListe(
  params: URLSearchParams,
  maintenant: Date,
): PeriodeDeLaListe | null {
  if (params.get("from") || params.get("to")) return null;
  const demande = params.get("jours");
  if (demande === null || demande.trim() === "") return null;
  const periode = PERIODES.find((p) => p.jours === Number(demande));
  if (!periode) return null;
  const jours = derniersJoursAParis(maintenant, periode.jours);
  const from = jours[0]!;
  const to = jours[jours.length - 1]!;
  const autreAnnee = from.slice(0, 4) !== to.slice(0, 4);
  // « du 20 au 26 novembre » dans un même mois ; sinon chaque jour a son mois.
  const memeMois = from.slice(0, 7) === to.slice(0, 7);
  const debut = memeMois ? jourEnClair(from, false).split(" ")[0]! : jourEnClair(from, autreAnnee);
  const texte =
    periode.jours === 1
      ? `Commandes d'aujourd'hui (${jourEnClair(to, false)})`
      : `Commandes des ${periode.jours} derniers jours (du ${debut} au ${jourEnClair(to, autreAnnee)})`;
  return { jours: periode.jours, from, to, texte };
}
