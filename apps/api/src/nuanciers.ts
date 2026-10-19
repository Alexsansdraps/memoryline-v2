/**
 * Les nuanciers des personnages, réglés par la boutique.
 *
 * Peau, cheveux / pelage, vêtements, pantalon : quatre listes de couleurs que
 * le configurateur avait en dur, et qu'aucun écran ne montrait. Elles se
 * rangent désormais dans le réglage `nuanciers.base`, un objet
 * { peau: [...], cheveux: [...], vetements: [...], pantalon: [...] } dans la
 * table des réglages — pas de table à part, pas de migration.
 *
 * Un nuancier absent du réglage, ou illisible, sert ses couleurs d'origine
 * (@memoryline/types, nuanciers.ts) : tant que la boutique n'a rien
 * enregistré, le module montre exactement les pastilles d'avant.
 *
 * Les routes vivent dans configurator-routes.ts, à côté de celles des
 * catégories de pièces : c'est le même écran du back-office.
 */
import { eq } from "drizzle-orm";
import {
  LIBELLES_NUANCIERS_BASE,
  NUANCIERS_PAR_DEFAUT,
  estNuancierBase,
  normaliserNuanciers,
  verifierNuancier,
  type NuanciersBase,
} from "@memoryline/types";
import { db, schema } from "./db/client.js";

/** La clé du réglage. */
export const REGLAGE_NUANCIERS = "nuanciers.base";

/** Les quatre nuanciers à servir : ceux de la boutique, sinon ceux d'origine. */
export async function lireNuanciersBase(): Promise<NuanciersBase> {
  const [ligne] = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, REGLAGE_NUANCIERS));
  return normaliserNuanciers(ligne?.value);
}

/**
 * Ce que la boutique a réglé elle-même, nuancier par nuancier — pour que
 * l'écran puisse dire « couleurs d'origine » ou « vos couleurs ».
 */
export async function nuanciersModifies(): Promise<Record<string, boolean>> {
  const [ligne] = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, REGLAGE_NUANCIERS));
  const brut =
    ligne?.value && typeof ligne.value === "object" && !Array.isArray(ligne.value)
      ? (ligne.value as Record<string, unknown>)
      : {};
  const sortie: Record<string, boolean> = {};
  for (const n of Object.keys(NUANCIERS_PAR_DEFAUT)) {
    const v = verifierNuancier(brut[n]);
    sortie[n] =
      v.ok &&
      v.couleurs.join(",") !==
        NUANCIERS_PAR_DEFAUT[n as keyof typeof NUANCIERS_PAR_DEFAUT].join(",");
  }
  return sortie;
}

/**
 * Enregistre UN nuancier, ou le remet à ses couleurs d'origine (`couleurs`
 * null). Les trois autres ne bougent pas.
 *
 * Rend la raison d'un refus, en mots de la boutique, ou les quatre nuanciers
 * tels qu'ils seront servis.
 */
export async function enregistrerNuancierBase(
  nuancier: unknown,
  couleurs: unknown,
): Promise<{ ok: true; nuanciers: NuanciersBase } | { ok: false; raison: string }> {
  if (!estNuancierBase(nuancier))
    return { ok: false, raison: "Ce nuancier n'existe pas. Rechargez la page." };
  const actuels = await lireNuanciersBase();
  if (couleurs === null) {
    // « Revenir aux couleurs d'origine » : on écrit l'origine plutôt que
    // d'effacer quoi que ce soit — la ligne de réglage reste, entière.
    actuels[nuancier] = [...NUANCIERS_PAR_DEFAUT[nuancier]];
  } else {
    const v = verifierNuancier(couleurs);
    if (!v.ok) return { ok: false, raison: `${LIBELLES_NUANCIERS_BASE[nuancier]} : ${v.raison}` };
    actuels[nuancier] = v.couleurs;
  }
  const maintenant = new Date();
  await db
    .insert(schema.settings)
    .values({
      key: REGLAGE_NUANCIERS,
      value: actuels,
      label: "Nuanciers des personnages (peau, cheveux, vêtements, pantalon)",
      group: "configurateur",
      updatedAt: maintenant,
    })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value: actuels, updatedAt: maintenant },
    });
  return { ok: true, nuanciers: actuels };
}
