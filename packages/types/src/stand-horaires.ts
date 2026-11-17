/**
 * Le calendrier d'un stand (17/11, marché de Noël de Mulhouse) :
 *
 *   « une date de début et une date de fin ; de base un horaire (un créneau
 *   le matin, un l'après-midi) qui se recopie sur tous les jours jusqu'à la
 *   fin ; Margaux peut modifier les horaires et choisir des jours de
 *   fermeture ; et garder l'ouvert/fermé manuel, qui prend le dessus. »
 *
 * Partagé par l'API (ouverture automatique, lieu de retrait, commande) et le
 * back-office (l'écran du calendrier).
 *
 * Toutes les dates sont des jours à Paris, écrits « AAAA-MM-JJ ».
 */
import { champAParis, decalerJour, jourAParis } from "./fuseau.js";

/** Un créneau d'ouverture, « 10:00 » à « 12:30 ». */
export interface Creneau {
  de: string;
  a: string;
}

/** Ce qu'un jour a de particulier. Absent : il suit l'horaire de base. */
export interface JourStand {
  ferme?: boolean;
  matin?: Creneau | null;
  apresMidi?: Creneau | null;
}

/** L'horaire de base, et les jours qui s'en écartent. */
export interface HorairesStand {
  matin: Creneau | null;
  apresMidi: Creneau | null;
  jours?: Record<string, JourStand>;
}

/** Ce qu'il faut savoir d'un stand pour dire s'il est ouvert. */
export interface StandCalendrier {
  ouvert: boolean;
  /** « manuel » : `ouvert` décide. « calendrier » : les dates et les jours. */
  pilotage: string;
  dateDebut: string | null;
  dateFin: string | null;
  horaires: HorairesStand | null;
  archivedAt?: Date | string | null;
  /**
   * Proposé au retrait sur le site (« Activé / Désactivé »), à part de
   * l'ouverture de la tablette. Absent : activé.
   */
  actif?: boolean;
}

/** L'horaire proposé pour un stand neuf. */
export const HORAIRES_PAR_DEFAUT: HorairesStand = {
  matin: { de: "10:00", a: "12:30" },
  apresMidi: { de: "14:00", a: "19:00" },
};

/** Au-delà, ce n'est plus un salon : une faute de frappe dans l'année. */
export const DUREE_MAX_JOURS = 120;

const FORME_JOUR = /^\d{4}-\d{2}-\d{2}$/;
const FORME_HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Un jour « AAAA-MM-JJ » qui existe vraiment (pas le 31 novembre). */
export function jourValide(jour: unknown): jour is string {
  if (typeof jour !== "string" || !FORME_JOUR.test(jour)) return false;
  const d = new Date(`${jour}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === jour;
}

/** Un créneau lisible, ou null s'il est vide ; une erreur s'il est faux. */
function creneauLu(brut: unknown, nom: string): Creneau | null | string {
  if (brut == null) return null;
  const c = brut as { de?: unknown; a?: unknown };
  const de = String(c.de ?? "").trim();
  const a = String(c.a ?? "").trim();
  if (!de && !a) return null;
  if (!FORME_HEURE.test(de) || !FORME_HEURE.test(a))
    return `${nom} : écrivez les heures sous la forme 10:00.`;
  if (de >= a) return `${nom} : l'heure de fin doit venir après celle du début.`;
  return { de, a };
}

/** Les jours du stand, du premier au dernier compris. */
export function joursDuStand(debut: string | null, fin: string | null): string[] {
  if (!jourValide(debut) || !jourValide(fin) || debut > fin) return [];
  const jours: string[] = [];
  for (let j = debut; j <= fin && jours.length <= DUREE_MAX_JOURS; j = decalerJour(j, 1))
    jours.push(j);
  return jours;
}

/**
 * Lit et vérifie un calendrier envoyé par le back-office. Rend le calendrier
 * propre (les jours hors des dates du stand sont oubliés, un jour identique
 * à l'horaire de base aussi), ou une phrase qui dit ce qui ne va pas.
 */
export function horairesLus(
  brut: unknown,
  debut: string | null,
  fin: string | null,
): HorairesStand | string {
  const b = (brut ?? {}) as { matin?: unknown; apresMidi?: unknown; jours?: unknown };
  const matin = creneauLu(b.matin, "Matin");
  if (typeof matin === "string") return matin;
  const apresMidi = creneauLu(b.apresMidi, "Après-midi");
  if (typeof apresMidi === "string") return apresMidi;
  if (matin && apresMidi && matin.a > apresMidi.de)
    return "Le créneau du matin doit finir avant celui de l'après-midi.";

  const permis = new Set(joursDuStand(debut, fin));
  const jours: Record<string, JourStand> = {};
  const source = (b.jours && typeof b.jours === "object" ? b.jours : {}) as Record<string, unknown>;
  for (const [jour, valeur] of Object.entries(source)) {
    if (!permis.has(jour)) continue;
    const v = (valeur ?? {}) as { ferme?: unknown; matin?: unknown; apresMidi?: unknown };
    if (v.ferme === true) {
      jours[jour] = { ferme: true };
      continue;
    }
    const m = creneauLu(v.matin, `Matin du ${jour}`);
    if (typeof m === "string") return m;
    const am = creneauLu(v.apresMidi, `Après-midi du ${jour}`);
    if (typeof am === "string") return am;
    if (m && am && m.a > am.de)
      return `Le ${jour} : le créneau du matin doit finir avant celui de l'après-midi.`;
    // Un jour qui reprend l'horaire de base n'a rien à retenir.
    if (memeCreneau(m, matin) && memeCreneau(am, apresMidi)) continue;
    jours[jour] = { matin: m, apresMidi: am };
  }
  return Object.keys(jours).length ? { matin, apresMidi, jours } : { matin, apresMidi };
}

function memeCreneau(a: Creneau | null | undefined, b: Creneau | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.de === b.de && a.a === b.a;
}

/** Ce qu'un jour donne : fermé, ou ses créneaux (ceux de base s'il n'a rien de particulier). */
export function horairesDuJour(
  h: HorairesStand | null,
  jour: string,
): { ferme: boolean; creneaux: Creneau[] } {
  const base = h ?? HORAIRES_PAR_DEFAUT;
  const special = base.jours?.[jour];
  if (special?.ferme) return { ferme: true, creneaux: [] };
  const matin = special && "matin" in special ? special.matin : base.matin;
  const apresMidi = special && "apresMidi" in special ? special.apresMidi : base.apresMidi;
  return { ferme: false, creneaux: [matin, apresMidi].filter((c): c is Creneau => !!c) };
}

/** Le stand tient-il ce jour-là ? Dans ses dates, et pas un jour de fermeture. */
export function standOuvertLeJour(s: Pick<StandCalendrier, "dateDebut" | "dateFin" | "horaires">, jour: string): boolean {
  if (!jourValide(s.dateDebut) || !jourValide(s.dateFin)) return false;
  if (jour < s.dateDebut || jour > s.dateFin) return false;
  return !horairesDuJour(s.horaires, jour).ferme;
}

/**
 * Le stand est-il ouvert maintenant — c'est-à-dire : sa tablette prend-elle
 * des ventes ?
 *
 * En « manuel », c'est le bouton qui décide, et lui seul : fermé à la main,
 * il le reste tant qu'on ne l'a pas rouvert, quoi que disent les horaires.
 * En « calendrier », le stand est ouvert TOUTE la journée de ses jours de
 * marché : une vente à 19 h 05 ne doit pas être refusée parce que le stand
 * ferme plus tard que prévu. Les heures, elles, renseignent les clientes.
 */
export function ouvertureEffective(s: StandCalendrier, maintenant: Date): boolean {
  if (s.archivedAt) return false;
  if (s.pilotage !== "calendrier") return s.ouvert;
  return standOuvertLeJour(s, jourAParis(maintenant));
}

/**
 * Le site propose-t-il de retirer sa commande à ce stand ?
 *
 * Ouvert ou fermé n'y fait RIEN (17/11 : « il faut afficher tous les stands,
 * peu importe s'ils sont ouverts ou pas ») : ouvert/fermé dit si la tablette
 * vend. Ce qui décide, c'est l'interrupteur à part « Activé / Désactivé sur
 * le site » (`actif`), le stand non archivé, et, s'il a des dates, la fin :
 * jusqu'à la fermeture du dernier jour ouvert. Il n'y a plus de marge de
 * 3 jours (17/11 : « ça peut être préparé le jour même »).
 */
export function retraitProposable(s: StandCalendrier, maintenant: Date): boolean {
  if (s.archivedAt) return false;
  if (s.actif === false) return false;
  if (!jourValide(s.dateFin)) return true;
  // Sans heure connue, toute la journée : « 24:00 » vient après toute heure.
  const dernier = dernierMomentDeRetrait(s) ?? { jour: s.dateFin, heure: null };
  return champAParis(maintenant) < `${dernier.jour}T${dernier.heure ?? "24:00"}`;
}

/* --- Le résumé pour les clientes, dans les cinq langues ------------------ */

const LOCALES: Record<string, string> = {
  fr: "fr-FR",
  en: "en-GB",
  de: "de-DE",
  it: "it-IT",
  es: "es-ES",
};

const MOTS: Record<
  string,
  {
    periode: (debut: string, fin: string) => string;
    tousLesJours: string;
    et: string;
    ferme: string;
    avant: (date: string) => string;
    /** « à 20:00 », collé derrière la date. */
    aHeure: (heure: string) => string;
  }
> = {
  fr: {
    periode: (d, f) => `Du ${d} au ${f}.`,
    tousLesJours: "Tous les jours",
    et: "et",
    ferme: "Fermé",
    avant: (d) => `À venir chercher au plus tard le ${d}.`,
    aHeure: (h) => `à ${h}`,
  },
  en: {
    periode: (d, f) => `From ${d} to ${f}.`,
    tousLesJours: "Every day",
    et: "and",
    ferme: "Closed",
    avant: (d) => `To be collected by ${d} at the latest.`,
    aHeure: (h) => `at ${h}`,
  },
  de: {
    periode: (d, f) => `Von ${d} bis ${f}.`,
    tousLesJours: "Täglich",
    et: "und",
    ferme: "Geschlossen",
    avant: (d) => `Abholung spätestens am ${d}.`,
    aHeure: (h) => `um ${h}`,
  },
  it: {
    periode: (d, f) => `Dal ${d} al ${f}.`,
    tousLesJours: "Tutti i giorni",
    et: "e",
    ferme: "Chiuso",
    avant: (d) => `Da ritirare entro ${d}.`,
    aHeure: (h) => `alle ${h}`,
  },
  es: {
    periode: (d, f) => `Del ${d} al ${f}.`,
    tousLesJours: "Todos los días",
    et: "y",
    ferme: "Cerrado",
    avant: (d) => `Recogida a más tardar el ${d}.`,
    aHeure: (h) => `a las ${h}`,
  },
};

/**
 * Le dernier moment pour venir chercher sa commande : le dernier jour OUVERT
 * du stand, et l'heure où il ferme ce jour-là (17/11 : « ajoute l'heure de
 * fin »). Null sans dates, ou si aucun jour n'est ouvert.
 */
export function dernierMomentDeRetrait(
  s: Pick<StandCalendrier, "dateDebut" | "dateFin" | "horaires">,
): { jour: string; heure: string | null } | null {
  const jours = joursDuStand(s.dateDebut, s.dateFin);
  for (let i = jours.length - 1; i >= 0; i--) {
    const h = horairesDuJour(s.horaires, jours[i]!);
    // Un jour sans aucun créneau est fermé, même sans la case « Fermé ».
    if (h.ferme || h.creneaux.length === 0) continue;
    const fin = h.creneaux.map((c) => c.a).sort().at(-1) ?? null;
    return { jour: jours[i]!, heure: fin };
  }
  return null;
}

/** « dimanche 27 décembre à 20:00 », dans la langue voulue. */
export function dernierMomentEcrit(
  s: Pick<StandCalendrier, "dateDebut" | "dateFin" | "horaires">,
  langue = "fr",
): string | null {
  const d = dernierMomentDeRetrait(s);
  if (!d) return null;
  const m = MOTS[langue] ?? MOTS.fr!;
  return d.heure ? `${jourEcrit(d.jour, langue)} ${m.aHeure(d.heure)}` : jourEcrit(d.jour, langue);
}

/** « vendredi 20 novembre » (avec l'année si demandé), dans la langue voulue. */
export function jourEcrit(jour: string, langue = "fr", avecAnnee = false): string {
  const d = new Date(`${jour}T12:00:00Z`);
  return new Intl.DateTimeFormat(LOCALES[langue] ?? LOCALES.fr, {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(avecAnnee ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(d);
}

const majuscule = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/**
 * Les 7 prochains jours du stand (17/11), à partir d'aujourd'hui, ou du
 * premier jour s'il n'a pas commencé : leurs vraies heures, ou fermé. `suite` :
 * le stand continue après. Null sans dates, ou une fois le stand fini. La
 * caisse en fait un petit tableau, la commande et les courriels du texte.
 */
export function semaineDuStand(
  s: Pick<StandCalendrier, "dateDebut" | "dateFin" | "horaires">,
  maintenant: Date,
  nombre = 7,
): { jours: { jour: string; ferme: boolean; creneaux: Creneau[] }[]; suite: boolean } | null {
  if (!jourValide(s.dateDebut) || !jourValide(s.dateFin) || s.dateDebut > s.dateFin) return null;
  const aujourdhui = jourAParis(maintenant);
  const debut = aujourdhui > s.dateDebut ? aujourdhui : s.dateDebut;
  const restants = joursDuStand(debut, s.dateFin);
  if (!restants.length) return null;
  const base = s.horaires ?? HORAIRES_PAR_DEFAUT;
  const jours = restants.slice(0, nombre).map((jour) => {
    const h = horairesDuJour(base, jour);
    const ferme = h.ferme || h.creneaux.length === 0;
    return { jour, ferme, creneaux: ferme ? [] : h.creneaux };
  });
  return { jours, suite: restants.length > nombre };
}

function creneauxEcrits(creneaux: Creneau[], langue: string): string {
  const m = MOTS[langue] ?? MOTS.fr!;
  return creneaux.map((c) => `${c.de}–${c.a}`).join(` ${m.et} `);
}

/**
 * Le calendrier du stand dit en quelques lignes, pour la caisse, la commande
 * et les courriels :
 *
 *   Du vendredi 20 novembre au jeudi 24 décembre 2026.
 *   Tous les jours : 10:00–12:30 et 14:00–19:00.
 *   Fermé : lundi 23 novembre, lundi 30 novembre.
 *   Samedi 21 novembre : 10:00–20:00.
 *   À venir chercher au plus tard le jeudi 24 décembre.
 *
 * Avec `maintenant` (la caisse et la commande, 17/11 : « mets les horaires
 * des 7 prochains jours en vrai », « vraiment que les 7 premiers puis des
 * points de suspension ») : les 7 prochains jours du stand un par un (voir
 * `semaineDuStand`), « … » s'il continue après :
 *
 *   Du vendredi 20 novembre au jeudi 24 décembre 2026.
 *   Vendredi 20 novembre : 10:00–12:30 et 14:00–19:00.
 *   …
 *   Lundi 23 novembre : fermé.
 *   …
 *   À venir chercher au plus tard le jeudi 24 décembre à 19:00.
 *
 * Sans `maintenant` (le back-office) : le résumé complet, pour tout vérifier.
 * Vide sans dates.
 */
export function resumeHoraires(
  s: Pick<StandCalendrier, "dateDebut" | "dateFin" | "horaires">,
  langue = "fr",
  options: { maintenant?: Date } = {},
): string {
  if (!jourValide(s.dateDebut) || !jourValide(s.dateFin) || s.dateDebut > s.dateFin) return "";
  const m = MOTS[langue] ?? MOTS.fr!;
  const deuxPoints = langue === "fr" ? " : " : ": ";
  const lignes: string[] = [m.periode(jourEcrit(s.dateDebut, langue), jourEcrit(s.dateFin, langue, true))];
  const base = s.horaires ?? HORAIRES_PAR_DEFAUT;
  const creneauxDeBase = [base.matin, base.apresMidi].filter((c): c is Creneau => !!c);
  if (options.maintenant) {
    const semaine = semaineDuStand(s, options.maintenant);
    if (semaine) {
      for (const j of semaine.jours)
        lignes.push(
          `${majuscule(jourEcrit(j.jour, langue))}${deuxPoints}${j.ferme ? m.ferme.toLowerCase() : creneauxEcrits(j.creneaux, langue)}.`,
        );
      if (semaine.suite) lignes.push("…");
      lignes.push(m.avant(dernierMomentEcrit(s, langue) ?? jourEcrit(s.dateFin, langue)));
      return lignes.join("\n");
    }
  }
  if (creneauxDeBase.length)
    lignes.push(`${m.tousLesJours}${deuxPoints}${creneauxEcrits(creneauxDeBase, langue)}.`);
  const fermes: string[] = [];
  const autres: string[] = [];
  for (const jour of joursDuStand(s.dateDebut, s.dateFin)) {
    if (!base.jours?.[jour]) continue;
    const h = horairesDuJour(base, jour);
    if (h.ferme) fermes.push(jourEcrit(jour, langue));
    else
      autres.push(
        `${majuscule(jourEcrit(jour, langue))}${deuxPoints}${h.creneaux.length ? creneauxEcrits(h.creneaux, langue) : m.ferme.toLowerCase()}.`,
      );
  }
  if (fermes.length) lignes.push(`${m.ferme}${deuxPoints}${fermes.join(", ")}.`);
  lignes.push(...autres);
  lignes.push(m.avant(dernierMomentEcrit(s, langue) ?? jourEcrit(s.dateFin, langue)));
  return lignes.join("\n");
}

/** Les langues dans lesquelles le résumé s'écrit. */
export const LANGUES_RESUME = Object.keys(MOTS);
