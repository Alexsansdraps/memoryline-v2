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
import { ouvertureEffective } from "@memoryline/types";
import { db, schema } from "./db/client.js";
import { calendrierDuStand, synchroniserLieuDuStand } from "./lieux-retrait.js";

/** Remet l'ouverture d'un stand d'accord avec son calendrier, et son lieu de retrait. */
export async function appliquerCalendrier(standId: number, maintenant = new Date()): Promise<void> {
  const [stand] = await db.select().from(schema.stands).where(eq(schema.stands.id, standId));
  if (!stand) return;
  if (stand.pilotage === "calendrier" && !stand.archivedAt) {
    const ouvert = ouvertureEffective(calendrierDuStand(stand), maintenant);
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
