/**
 * Numérotation des commandes : WEB-xxxx pour le site, SAL-xxxx pour le stand.
 *
 * Deux règles, et chacune a coûté une caisse en panne :
 *
 *   - Le maximum se cherche PAR PRÉFIXE, tous canaux confondus. L'index
 *     unique (order_number_uniq) porte sur le numéro seul ; un compteur qui ne
 *     relisait que les commandes de son canal ne voyait pas un WEB- porté par
 *     une vente du stand — rouverte au stand, puis passée par la caisse du
 *     site — et redonnait ce numéro-là à chaque commande suivante. Chacune
 *     butait sur l'index : « 500 » à la caisse, pour toutes les clientes,
 *     jusqu'à ce qu'on corrige la ligne à la main.
 *   - Le numéro se prend DANS la transaction qui l'écrit, sous un verrou par
 *     préfixe (pg_advisory_xact_lock, rendu au COMMIT). Lu avant, deux
 *     paniers validés à quelques centaines de millisecondes d'écart — plus le
 *     temps d'un appel à SendCloud pour un point relais — tiraient le même
 *     numéro, et le second échouait sur l'index.
 */
import { sql } from "drizzle-orm";
import { db, schema } from "./db/client.js";

/** Une transaction en cours : le verrou ne vit que jusqu'à son COMMIT. */
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type PrefixeNumero = "WEB-" | "SAL-";

/**
 * Le numéro qui suit ceux-ci : MAX du suffixe des numéros bien formés + 1,
 * sur quatre chiffres. Les DRAFT- et les numéros legacy non conformes sont
 * ignorés — robuste aux historiques importés.
 */
export function numeroSuivant(prefixe: PrefixeNumero, numeros: readonly string[]): string {
  const forme = new RegExp(`^${prefixe}(\\d+)$`);
  let max = 0;
  for (const n of numeros) {
    const m = forme.exec(n);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return prefixe + String(max + 1).padStart(4, "0");
}

/**
 * Les commandes dont le numéro porte ce préfixe, QUEL QUE SOIT LEUR CANAL :
 * c'est le périmètre de l'index unique, donc celui du compteur.
 */
export function numerosDuPrefixe(prefixe: PrefixeNumero) {
  return sql`${schema.orders.number} like ${prefixe + "%"}`;
}

/**
 * Prochain numéro du préfixe, réservé jusqu'à la fin de la transaction.
 *
 * À appeler juste avant l'UPDATE qui l'écrit : la transaction suivante attend
 * le verrou, puis relit le maximum — sa requête part après le COMMIT de la
 * première et voit donc le numéro qu'elle vient d'écrire. Tant que rien ne
 * traîne après l'UPDATE, l'attente se compte en millisecondes.
 */
export async function prochainNumeroDeCommande(
  tx: Transaction,
  prefixe: PrefixeNumero,
): Promise<string> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"numero-commande:" + prefixe}))`);
  const rows = await tx
    .select({ n: schema.orders.number })
    .from(schema.orders)
    .where(numerosDuPrefixe(prefixe));
  return numeroSuivant(prefixe, rows.map((r) => r.n));
}
