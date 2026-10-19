/**
 * Ce qu'un compte VENDEUR a le droit de voir : les ventes des stands qu'on
 * lui a confiés, et rien d'autre.
 *
 * La règle vivait en trois exemplaires — la liste des commandes, les
 * statistiques, la fiche — et chacun la disait à sa façon : « le canal
 * salon », plus « le stand du vendeur » quand il y en avait un. Sauf que
 * personne ne lui en donnait jamais : le champ existait, rien ne le
 * remplissait. Un vendeur lisait donc les ventes de TOUS les stands, et la
 * boutique qui tient plusieurs marchés de Noël voulait justement l'inverse.
 *
 * Elle vit maintenant ici, une seule fois, et chaque route la demande :
 *
 *   - la propriétaire voit tout, aucune borne ;
 *   - un vendeur voit les ventes de stand (canal « salon ») dont le stand
 *     est dans sa liste (`admin_user.stand_ids`) ;
 *   - un vendeur SANS stand confié ne voit RIEN. Refus par défaut : un compte
 *     qu'on a oublié de rattacher ne doit pas lire les commandes de tous les
 *     marchés, adresses comprises. L'écran lui dit à qui s'adresser.
 *
 * Le fichier n'ouvre aucune connexion à la base : il ne fait que fabriquer
 * des conditions et répondre oui ou non. C'est ce qui permet de l'essayer
 * sans base (tests/vendeurs.test.ts).
 */
import { eq, inArray, sql, type SQL } from "drizzle-orm";
import * as schema from "./db/schema.js";
import type { SessionUser } from "./auth.js";

/** Le rôle qui voit tout. Le même mot que la garde de /admin/* (index.ts). */
export const ROLE_PROPRIETAIRE = "owner";

/** Ce qu'il faut savoir de la personne connectée pour la borner. */
export type Personne =
  | Pick<SessionUser, "role" | "standIds">
  | null
  | undefined;

/** Ce qu'il faut savoir d'une commande pour dire si elle est visible. */
export interface CommandeABorner {
  channel: string | null | undefined;
  standId: number | null | undefined;
}

export function estProprietaire(personne: Personne): boolean {
  return personne?.role === ROLE_PROPRIETAIRE;
}

/**
 * Les stands confiés, nettoyés : des entiers positifs, sans doublon.
 *
 * La colonne est un jsonb : une valeur posée à la main dans la base, ou une
 * chaîne glissée par un vieux script, ne doit pas ouvrir une porte par
 * accident. Tout ce qui n'est pas un numéro de stand est ignoré.
 */
export function standsDuVendeur(personne: Personne): number[] {
  const brut = (personne?.standIds ?? []) as unknown;
  if (!Array.isArray(brut)) return [];
  const vus = new Set<number>();
  for (const v of brut) {
    const n = Number(v);
    if (Number.isInteger(n) && n > 0) vus.add(n);
  }
  return [...vus];
}

/**
 * Les conditions à AJOUTER à celles d'une requête sur la table des
 * commandes, quoi que la personne ait demandé.
 *
 * Vide pour la propriétaire. Pour un vendeur sans stand, une condition
 * toujours fausse : la requête part quand même et revient vide, ce qui garde
 * un seul chemin de code — pas de « si vendeur sans stand, renvoyer [] »
 * recopié dans chaque route, qu'on oublierait dans la prochaine.
 *
 * Sans personne du tout, on refuse aussi : ces routes sont toutes derrière la
 * garde de /admin/*, qui pose toujours l'utilisateur. S'il manque, c'est
 * qu'une route a été montée ailleurs, et mieux vaut une liste vide qu'une
 * liste complète.
 */
export function bornesDuVendeur(personne: Personne): SQL[] {
  if (estProprietaire(personne)) return [];
  const stands = standsDuVendeur(personne);
  if (!personne || stands.length === 0) return [sql`false`];
  return [
    eq(schema.orders.channel, "salon"),
    inArray(schema.orders.standId, stands),
  ];
}

/**
 * La même règle, pour UNE commande déjà lue : la fiche, le fichier
 * d'impression, l'archive, le bordereau.
 *
 * Les identifiants se suivent : sans ce contrôle, il suffisait de compter de
 * un en un pour lire la fiche — adresse postale comprise — de n'importe
 * quelle cliente.
 */
export function commandeVisible(
  personne: Personne,
  commande: CommandeABorner,
): boolean {
  if (estProprietaire(personne)) return true;
  if (!personne) return false;
  if (commande.channel !== "salon") return false;
  const stand = commande.standId;
  if (typeof stand !== "number") return false;
  return standsDuVendeur(personne).includes(stand);
}
