/**
 * Le carnet d'adresses d'une cliente, vu par la caisse et par son compte
 * (18/11, Alexandra : « avoir par défaut son adresse en facturation et
 * pouvoir utiliser son adresse en livraison OU pas », « l'adresse par défaut
 * qu'il choisit reste l'adresse de facturation »).
 *
 * UNE adresse par défaut : celle de la facturation, proposée aussi d'abord
 * pour la livraison. Les deux drapeaux de la table (is_default_billing,
 * is_default_shipping) avancent ensemble ; la migration 0092 les a rejoints.
 * Sans drapeau du tout (carnet ancien, adresse retirée), c'est la plus
 * ancienne qui tient ce rôle, et normaliserParDefaut le lui donne.
 */
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { db, schema } from "./db/client.js";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executeur = typeof db | Transaction;

export type AdresseClient = typeof schema.customerAddresses.$inferSelect;

/** Le carnet, l'adresse par défaut en tête, puis les autres de la plus ancienne à la plus récente. */
export async function carnetDe(ex: Executeur, customerId: number): Promise<AdresseClient[]> {
  return ex
    .select()
    .from(schema.customerAddresses)
    .where(eq(schema.customerAddresses.customerId, customerId))
    .orderBy(
      desc(schema.customerAddresses.isDefaultBilling),
      desc(schema.customerAddresses.isDefaultShipping),
      asc(schema.customerAddresses.id),
    );
}

/** L'adresse par défaut (de facturation), ou null pour un carnet vide. */
export async function adresseParDefaut(
  ex: Executeur,
  customerId: number,
): Promise<AdresseClient | null> {
  const [a] = await carnetDe(ex, customerId);
  return a ?? null;
}

/**
 * Désigne l'adresse par défaut (`choisie`), ou, sans choix, s'assure qu'il
 * y en a une : la plus ancienne, si aucune ne l'est. Jamais deux.
 */
export async function normaliserParDefaut(
  ex: Executeur,
  customerId: number,
  choisie?: number,
): Promise<void> {
  if (choisie != null) {
    await ex
      .update(schema.customerAddresses)
      .set({ isDefaultBilling: false, isDefaultShipping: false })
      .where(
        and(
          eq(schema.customerAddresses.customerId, customerId),
          ne(schema.customerAddresses.id, choisie),
        ),
      );
    await ex
      .update(schema.customerAddresses)
      .set({ isDefaultBilling: true, isDefaultShipping: true })
      .where(
        and(
          eq(schema.customerAddresses.customerId, customerId),
          eq(schema.customerAddresses.id, choisie),
        ),
      );
    return;
  }
  const carnet = await carnetDe(ex, customerId);
  if (!carnet.length || carnet.some((a) => a.isDefaultBilling)) return;
  await normaliserParDefaut(ex, customerId, carnet[0]!.id);
}

/**
 * Une adresse ramenée à ce qui la distingue : rue, code postal, ville. Pas
 * le pays : le carnet l'a gardé tantôt en code (« FR »), tantôt en toutes
 * lettres (« France »).
 */
function cleAdresse(a: {
  line1?: string | null;
  postalCode?: string | null;
  city?: string | null;
}): string {
  const net = (v: string | null | undefined) =>
    String(v ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return [net(a.line1), net(a.postalCode), net(a.city)].join("|");
}

/** Deux adresses désignent-elles le même endroit (accents, casse et ponctuation ignorés) ? */
export function memeAdresse(
  a: Parameters<typeof cleAdresse>[0],
  b: Parameters<typeof cleAdresse>[0],
): boolean {
  return cleAdresse(a) === cleAdresse(b);
}
