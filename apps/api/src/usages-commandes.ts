/**
 * Les commandes qui se servent d'un élément de l'atelier — un fond, un
 * personnage, des pièces — et qui le retiennent donc en base.
 *
 * Une commande ne garde pas le dessin de son affiche : elle garde des
 * IDENTIFIANTS (`order_item.config`, cf. posterConfigSchema) — le fond
 * `backgroundId`, chaque personnage `characters[].typeId`, chaque pièce dans
 * `characters[].assets` (emplacement → id). Le fichier d'impression relit les
 * lignes en base à chaque génération (donneesDImpression). Effacer la ligne,
 * c'est donc rendre l'affiche impossible à réimprimer — et la base ne le sait
 * pas : ce JSON n'a pas de clé étrangère. D'où cette vérification, appelée
 * par les suppressions définitives (suppression.ts, `empeche`).
 *
 * Qui retient l'élément :
 *   - toute COMMANDE, quel que soit son âge, archivée ou annulée comprise :
 *     une réimpression, un litige, un avoir se demandent des mois plus tard ;
 *   - un PANIER (`draft`, ou `pending` : la caisse ouverte, pas encore payée,
 *     cf. panierModifiable) tant qu'il est encore en cours, c'est-à-dire
 *     modifié il y a moins de quatorze jours — la même fenêtre que les
 *     relances (FENETRE_HEURES, relance-panier.ts). Au-delà, plus personne ne
 *     le relance ni ne le paie : il ne bloque plus rien.
 *
 * Les comparaisons se font en TEXTE (`->>`), jamais par conversion en entier :
 * un identifiant peut être rangé en nombre ou en chaîne (les deux sont permis
 * par le schéma), et une valeur inattendue quelque part dans l'historique
 * ferait sinon échouer la vérification de N'IMPORTE QUEL élément (cf. la même
 * prudence pour les cadres, index.ts). Chaque accès vérifie aussi la forme
 * (`jsonb_typeof`) : une vieille ligne sans `characters`, ou avec autre chose
 * qu'un tableau, ne correspond simplement à rien.
 */
import { eq, sql, type AnyColumn, type SQL } from "drizzle-orm";
import * as schema from "./db/schema.js";
import type { db } from "./db/client.js";

/** Ce qu'on cherche dans les configurations. */
export type CibleConfig =
  | { fond: number }
  | { personnage: number }
  | { pieces: number[] };

/** Quatorze jours : passé ce délai, un panier n'est plus « en cours ». */
export const PANIER_EN_COURS_MS = 14 * 24 * 3600 * 1000;

/** Les personnages d'une configuration, en tableau même quand il n'y en a pas. */
function personnagesDe(config: SQL | AnyColumn): SQL {
  return sql`jsonb_array_elements(case when jsonb_typeof(${config} -> 'characters') = 'array' then ${config} -> 'characters' else '[]'::jsonb end)`;
}

/**
 * La condition « cette configuration se sert de la cible », à poser sur
 * `order_item.config` (ou sur toute expression jsonb : les essais en passent
 * une à la main).
 */
export function configSeSertDe(
  cible: CibleConfig,
  config: SQL | AnyColumn = schema.orderItems.config,
): SQL {
  if ("fond" in cible) return sql`(${config} ->> 'backgroundId') = ${String(cible.fond)}`;
  if ("personnage" in cible)
    return sql`exists (select 1 from ${personnagesDe(config)} as perso(p) where p ->> 'typeId' = ${String(cible.personnage)})`;
  const ids = cible.pieces.map((id) => sql`${String(id)}`);
  if (!ids.length) return sql`false`;
  // `assets` : emplacement → id de la pièce (« none » pour un emplacement
  // vidé, qui ne correspond à aucun id).
  return sql`exists (select 1 from ${personnagesDe(config)} as perso(p), jsonb_each_text(case when jsonb_typeof(p -> 'assets') = 'object' then p -> 'assets' else '{}'::jsonb end) as piece(emplacement, id) where piece.id in (${sql.join(ids, sql`, `)}))`;
}

/** Une commande (ou un panier) qui porte la cible, telle que la vérification la lit. */
export interface CommandeQuiSertDe {
  numero: string;
  statut: string;
  /** Dernière modification connue : `last_activity_at`, à défaut la création. */
  derniereActivite: Date | string | null;
}

/** Un panier, et non une commande : rien n'est encore payé (cf. panierModifiable). */
export function estUnPanier(statut: string): boolean {
  return statut === "draft" || statut === "pending";
}

/**
 * Vrai si cette ligne empêche la suppression : toujours pour une commande,
 * seulement s'il est encore en cours pour un panier. Un panier sans date
 * lisible compte comme en cours — dans le doute, on garde.
 */
export function retient(c: CommandeQuiSertDe, maintenant: Date = new Date()): boolean {
  if (!estUnPanier(c.statut)) return true;
  if (c.derniereActivite == null) return true;
  const quand = new Date(c.derniereActivite).getTime();
  if (!Number.isFinite(quand)) return true;
  return maintenant.getTime() - quand < PANIER_EN_COURS_MS;
}

/**
 * Une liste courte, pour une phrase : « WEB-1042, WEB-1051, WEB-1060 et 4
 * autres ». Les trois premiers suffisent à retrouver de quoi il s'agit.
 */
export function enBref(noms: string[]): string {
  const vus = noms.slice(0, 3).join(", ");
  const reste = noms.length - 3;
  return reste > 0 ? `${vus} et ${reste} autre${reste > 1 ? "s" : ""}` : vus;
}

/**
 * La phrase du refus, ou null si rien ne retient l'élément. `reste` finit la
 * phrase au bon genre : « Il reste archivé. » / « Elle reste archivée. ».
 */
export function raisonDesCommandes(
  lignes: CommandeQuiSertDe[],
  reste: string,
  maintenant: Date = new Date(),
): string | null {
  const commandes = new Set<string>();
  const paniers = new Set<string>();
  for (const l of lignes) {
    if (!retient(l, maintenant)) continue;
    (estUnPanier(l.statut) ? paniers : commandes).add(l.numero);
  }
  const numeros = [...commandes].sort();
  const nPaniers = paniers.size;
  const etPaniers =
    nPaniers > 0 ? ` (et ${nPaniers} panier${nPaniers > 1 ? "s" : ""} en cours)` : "";
  if (numeros.length === 1)
    return `La commande ${numeros[0]} s'en sert${etPaniers} : elle en a besoin pour se réimprimer. ${reste}`;
  if (numeros.length > 1)
    return `Des commandes s'en servent (${enBref(numeros)})${etPaniers} : elles en ont besoin pour se réimprimer. ${reste}`;
  if (nPaniers === 1)
    return `Un panier en cours s'en sert : son client doit pouvoir le payer tel quel. Il ne compte plus quatorze jours après sa dernière modification. ${reste}`;
  if (nPaniers > 1)
    return `${nPaniers} paniers en cours s'en servent : leurs clients doivent pouvoir les payer tels quels. Un panier ne compte plus quatorze jours après sa dernière modification. ${reste}`;
  return null;
}

type Lecteur = Pick<typeof db, "selectDistinct">;

/** Les commandes et paniers dont une ligne se sert de la cible. */
export async function commandesQuiSeServentDe(
  ex: Lecteur,
  cible: CibleConfig,
): Promise<CommandeQuiSertDe[]> {
  return ex
    .selectDistinct({
      numero: schema.orders.number,
      statut: schema.orders.status,
      derniereActivite: sql<string | null>`coalesce(${schema.orders.lastActivityAt}, ${schema.orders.createdAt})`,
    })
    .from(schema.orderItems)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
    .where(configSeSertDe(cible));
}

/** La vérification complète : la phrase du refus, ou null. */
export async function commandesQuiEmpechent(
  ex: Lecteur,
  cible: CibleConfig,
  reste: string,
): Promise<string | null> {
  return raisonDesCommandes(await commandesQuiSeServentDe(ex, cible), reste);
}
