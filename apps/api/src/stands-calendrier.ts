/**
 * Les stands qui suivent leur calendrier (17/11).
 *
 * `stand.ouvert` reste LA réponse à « la tablette prend-elle des ventes ? » :
 * tout le code qui la lisait déjà (salon.ts, les statistiques, la bande
 * « Stand fermé ») continue de la lire. Pour un stand piloté par son
 * calendrier, c'est ici qu'elle est tenue à jour, à chaque modification du
 * stand et toutes les minutes : le premier jour du marché, le stand s'ouvre
 * tout seul ; un jour de fermeture, il se ferme ; après le dernier jour, il
 * reste fermé.
 *
 * Un stand en « manuel » n'est jamais touché ici : fermé à la main, il le
 * reste tant qu'on ne l'a pas rouvert, quoi que disent les horaires.
 *
 * Le lieu de retrait du stand (« Retrait au stand » à la caisse du site) est
 * resynchronisé au passage : il dépend de la date du jour.
 */
import { eq, isNull } from "drizzle-orm";
import { champAParis, horairesDuJour, jourAParis, ouvertureEffective, type StandCalendrier } from "@memoryline/types";
import { db, schema } from "./db/client.js";
import { calendrierDuStand, synchroniserLieuDuStand } from "./lieux-retrait.js";

/**
 * Une heure de marge après la fermeture du calendrier (27/11 au soir,
 * Alexandra, à 21 h 58 : « le marché de Noël de Mulhouse, il est ouvert selon
 * calendrier, alors que selon calendrier, il est censé fermer à 21 h » ; choix
 * retenu : « Fermer + 1 h de marge »).
 */
export const MARGE_APRES_FERMETURE_MIN = 60;

/** « 21:00 » + 60 min → « 22:00 » ; plafonné à « 24:00 » (minuit). */
function apresMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const t = Math.min(24 * 60, h * 60 + m + minutes);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/**
 * La tablette d'un stand « calendrier » prend-elle des ventes maintenant ?
 * Les jours de marché (ouvertureEffective, packages/types), de l'heure
 * d'ouverture du premier créneau jusqu'à 1 h après la fin du dernier, à
 * l'heure de Paris. Un jour sans heure connue reste ouvert toute la journée,
 * comme avant. La règle vit ICI et non dans packages/types : y toucher
 * changerait l'empreinte des fichiers d'impression, qui se referaient tous.
 */
export function ouvertAuxHeures(cal: StandCalendrier, maintenant: Date): boolean {
  if (!ouvertureEffective(cal, maintenant)) return false;
  if (cal.pilotage !== "calendrier") return true;
  const { creneaux } = horairesDuJour(cal.horaires, jourAParis(maintenant));
  if (!creneaux.length) return true;
  const debut = creneaux.map((c) => c.de).sort()[0]!;
  const fin = creneaux.map((c) => c.a).sort()[creneaux.length - 1]!;
  const heure = champAParis(maintenant).slice(11, 16);
  return heure >= debut && heure < apresMinutes(fin, MARGE_APRES_FERMETURE_MIN);
}

/** Remet l'ouverture d'un stand d'accord avec son calendrier, et son lieu de retrait. */
export async function appliquerCalendrier(standId: number, maintenant = new Date()): Promise<void> {
  const [stand] = await db.select().from(schema.stands).where(eq(schema.stands.id, standId));
  if (!stand) return;
  if (stand.pilotage === "calendrier" && !stand.archivedAt) {
    const ouvert = ouvertAuxHeures(calendrierDuStand(stand), maintenant);
    if (ouvert !== stand.ouvert)
      await db
        .update(schema.stands)
        .set(ouvert ? { ouvert } : { ouvert, closedAt: maintenant })
        .where(eq(schema.stands.id, standId));
  }
  await synchroniserLieuDuStand(standId);
}

/** Un passage sur tous les stands en service. */
export async function tenirLesStandsAJour(): Promise<void> {
  const stands = await db
    .select({ id: schema.stands.id })
    .from(schema.stands)
    .where(isNull(schema.stands.archivedAt));
  for (const s of stands) {
    try {
      await appliquerCalendrier(s.id);
    } catch (e) {
      console.warn("[stands] calendrier non appliqué", s.id, String(e));
    }
  }
}

let minuterie: ReturnType<typeof setInterval> | null = null;

/** Au démarrage de l'API, puis toutes les minutes. */
export function demarrerCalendrierDesStands(): void {
  if (minuterie) return;
  void tenirLesStandsAJour();
  minuterie = setInterval(() => void tenirLesStandsAJour(), 60_000);
  minuterie.unref?.();
}
