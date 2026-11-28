/**
 * Les affiches rattachées à un stand (28/11, affiche éphémère du marché de
 * Noël de Mulhouse).
 *
 * Alexandra, le 27/11 : « vraiment ça doit être rattaché au stand et le
 * produit doit disparaître quand le stand sera clôturé donc désactivé ». Une
 * affiche dont `product.stand_id` est rempli n'est donc proposée — fiche,
 * rayons, recherche, page du stand, tablette, plan du site — que tant que ce
 * stand est EN SERVICE : activé, non archivé, et son dernier jour (à Paris)
 * pas encore passé. Elle disparaît ensuite d'elle-même, sans que personne ait
 * à toucher au produit.
 *
 * Ce qui ne la fait PAS disparaître : un stand simplement fermé pour la nuit
 * (ouvert / fermé, les horaires) — il reste en service. Et un panier qui la
 * contient déjà n'est pas touché : seule l'offre disparaît (« touche pas aux
 * commandes »).
 *
 * La fin se compte au JOUR, comme la liste « Stands en cours » de l'accueil
 * du back-office (salon.ts) : l'affiche part à minuit après le dernier jour.
 * Un stand introuvable (supprimé) cache l'affiche : la règle échoue fermée.
 *
 * UNE SEULE RÈGLE, ICI. Les listes et la fiche l'appliquent par `enVente()`,
 * le back-office la montre par `etatDuStand()` : les deux disent la même chose.
 */
import { and, eq, sql, type SQL } from "drizzle-orm";
import { jourAParis, jourValide } from "@memoryline/types";
import { db, schema } from "./db/client.js";

/**
 * Vrai pour une affiche sans stand, ou dont le stand est en service (activé,
 * non archivé, dernier jour à Paris pas encore passé). Ouvert ou fermé n'y
 * fait rien ; un dernier jour illisible ne borne rien (comme etatDuStand).
 */
export function standEnService(maintenant: Date = new Date()): SQL {
  const jour = jourAParis(maintenant);
  return sql`(${schema.products.standId} is null or exists (select 1 from ${schema.stands} s
    where s.id = ${schema.products.standId} and s.actif = true and s.archived_at is null
    and (s.date_fin is null or s.date_fin !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or s.date_fin >= ${jour})))`;
}

/**
 * Ce que le site propose : une affiche « active », et son stand en service
 * s'il en a un. Remplace `status = 'active'` partout où une affiche est listée.
 */
export function enVente(maintenant?: Date): SQL {
  return and(eq(schema.products.status, "active"), standEnService(maintenant))!;
}

/**
 * Cette affiche est-elle proposée côté stand (sans regarder son statut) ?
 * Sert à la fiche (GET /products/:slug) et au script de vérification.
 */
export async function standDuProduitEnService(id: number, maintenant?: Date): Promise<boolean> {
  const [ligne] = await db
    .select({ id: schema.products.id })
    .from(schema.products)
    .where(and(eq(schema.products.id, id), standEnService(maintenant)));
  return !!ligne;
}

export type EtatStand = "en-service" | "desactive" | "archive" | "termine";

/** La même règle, pour l'affichage du back-office (fiche produit). */
export function etatDuStand(
  s: { actif: boolean; archivedAt: Date | string | null; dateFin: string | null },
  maintenant: Date = new Date(),
): EtatStand {
  if (s.archivedAt) return "archive";
  if (!s.actif) return "desactive";
  if (jourValide(s.dateFin) && s.dateFin < jourAParis(maintenant)) return "termine";
  return "en-service";
}
