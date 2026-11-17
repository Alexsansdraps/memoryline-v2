/**
 * Où les cadres sont proposés : sur le site, au stand, ou aux deux.
 *
 * La boutique ne sait pas encore expédier un cadre. Elle doit donc pouvoir les
 * retirer du SITE sans les retirer du STAND, où le client repart avec son
 * affiche sous le bras. Le réglage « Proposer les cadres sur le site » se
 * règle en tête de la page Cadres du back-office ; le prix des cadres, lui,
 * vit dans @memoryline/types (prixDuCadreCents).
 *
 * Ce que ce réglage protège se décide à la CAISSE DU SITE (POST /orders dans
 * configurator-routes.ts) : une commande web n'y part jamais avec un cadre
 * quand le site n'en propose pas, quoi que dise le navigateur. Le reste — la
 * ligne de panier écrite sans son cadre, le panier nettoyé à l'ouverture —
 * sert à ce que la cliente le voie AVANT de payer, et pas à la caisse.
 */
import type { Context } from "hono";
import { eq } from "drizzle-orm";
import {
  REGLAGE_CADRES_SITE,
  cadresProposesSurLeSite,
} from "@memoryline/types";
import { db, schema } from "./db/client.js";


/**
 * Cette requête vient-elle d'une tablette en mode stand ?
 *
 * Même réserve que plus bas : c'est un repère, pas un droit. Il sert à garder
 * son cadre à une ligne de panier, et à ranger le panier parmi ceux du stand
 * dans les statistiques (configurator-routes.ts, `panierModifie`).
 */
export function requeteDuStand(c: Context): boolean {
  // L'en-tête « X-Stand: 1 », envoyé par la page quand son ADRESSE porte
  // ?stand=1 (apps/web/src/lib/api-navigateur.ts, enteteStand). Plus de
  // cookie depuis le 17/11 : le mode stand ne survit pas à l'adresse.
  return c.req.header("x-stand") === "1";
}

/** Le site propose-t-il les cadres ? Lu à chaque fois : un seul SELECT. */
export async function cadresSurLeSite(): Promise<boolean> {
  const [reglage] = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, REGLAGE_CADRES_SITE));
  return cadresProposesSurLeSite(reglage?.value);
}

/**
 * Les cadres sont-ils proposés à CETTE requête ?
 *
 * Oui au stand, toujours ; sur le site, selon le réglage.
 *
 * Le cookie du stand ne donne AUCUN droit : n'importe qui peut l'obtenir en
 * ajoutant « ?stand=1 » à l'adresse. Il ne fait que garder son cadre à une
 * ligne de panier. La commande qui partirait ensuite par la caisse du site
 * perd ce cadre là-bas, et celle qui part par le stand demande le code du
 * stand (salon.ts).
 */
export async function cadresProposesA(c: Context): Promise<boolean> {
  if (requeteDuStand(c)) return true;
  return cadresSurLeSite();
}
