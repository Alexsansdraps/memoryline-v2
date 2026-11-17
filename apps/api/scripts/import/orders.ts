/**
 * Reprendre l'historique Shopify dans la base : les clientes et les
 * commandes, sans jamais rien effacer.
 *
 * Toutes les décisions sont prises dans historique-shopify.ts. Ce fichier-ci
 * lit l'état de la base, demande le plan, et l'écrit d'un seul tenant.
 *
 * Ce qu'il ne fait JAMAIS :
 *   - supprimer quoi que ce soit, ni modifier une commande du site ou ses
 *     paiements : il n'écrit que des lignes neuves, et ses seules mises à
 *     jour remplissent des cases VIDES de fiches clientes ;
 *   - envoyer un courriel, numéroter une facture, acheter une étiquette ou
 *     bouger un stock : il écrit en base directement, sans passer par aucune
 *     route ni aucune fonction qui le ferait.
 *
 * Il se rejoue sans doublon : une commande déjà en base (même identifiant
 * Shopify, même « #1001 », même numéro repris) est sautée.
 */
import { eq, isNotNull, like, or, sql as raw } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db, schema } from "../../src/db/client.js";
import { bump, type ImportReport } from "./lib.js";
import {
  CONSIGNE_EXPORT,
  ImportImpossible,
  PREFIXE_REPRISE,
  indexerCatalogue,
  lireClientes,
  lireCommandes,
  lireDossier,
  planifier,
  type DossierLu,
  type EtatBase,
  type Plan,
} from "./historique-shopify.js";

type Lecteur = Pick<typeof db, "select">;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Ce que la base sait déjà : les fiches clientes (par adresse), les
 * commandes déjà reprises, et le catalogue pour rattacher les articles.
 */
export async function lireEtat(lecteur: Lecteur): Promise<EtatBase> {
  const fiches = await lecteur
    .select({
      id: schema.customers.id,
      email: schema.customers.email,
      name: schema.customers.name,
      firstName: schema.customers.firstName,
      lastName: schema.customers.lastName,
      phone: schema.customers.phone,
      note: schema.customers.note,
      tags: schema.customers.tags,
      acceptsMarketing: schema.customers.acceptsMarketing,
      legacyId: schema.customers.legacyId,
      compte: raw<boolean>`(${schema.customers.passwordHash} is not null)`,
      // Écrit en toutes lettres, table comprise : dans une sous-requête, une
      // colonne « id » sans son nom de table serait celle de l'adresse.
      aUneAdresse: raw<boolean>`exists (select 1 from "customer_address" a where a.customer_id = "customer"."id")`,
    })
    .from(schema.customers)
    .where(isNotNull(schema.customers.email));

  const reprises = await lecteur
    .select({
      legacyId: schema.orders.legacyId,
      legacyName: schema.orders.legacyName,
      number: schema.orders.number,
    })
    .from(schema.orders)
    .where(
      or(
        isNotNull(schema.orders.legacyId),
        isNotNull(schema.orders.legacyName),
        like(schema.orders.number, `${PREFIXE_REPRISE}%`),
      ),
    );

  // Les désabonnements de la lettre : la seule trace d'une personne partie
  // par le lien « Me désabonner » quand elle n'a pas de fiche.
  const desabonnees = await lecteur
    .select({ email: raw<string>`lower(trim(${schema.lettreJetons.email}))` })
    .from(schema.lettreJetons)
    .where(isNotNull(schema.lettreJetons.desabonneLe));

  const produits = await lecteur
    .select({
      id: schema.products.id,
      name: schema.products.name,
      legacyId: schema.products.legacyId,
    })
    .from(schema.products);
  const variantes = await lecteur
    .select({
      id: schema.variants.id,
      productId: schema.variants.productId,
      format: schema.variants.format,
      sku: schema.variants.sku,
      legacyId: schema.variants.legacyId,
    })
    .from(schema.variants);

  return {
    fiches: fiches.map((f) => ({
      ...f,
      email: (f.email ?? "").trim().toLowerCase(),
      tags: f.tags ?? [],
      compte: !!f.compte,
      aUneAdresse: !!f.aUneAdresse,
    })),
    legacyIds: new Set(reprises.flatMap((r) => (r.legacyId !== null ? [r.legacyId] : []))),
    legacyNames: new Set(reprises.flatMap((r) => (r.legacyName ? [r.legacyName] : []))),
    numeros: new Set(
      reprises.map((r) => r.number).filter((n) => n.startsWith(PREFIXE_REPRISE)),
    ),
    desabonnees: new Set(desabonnees.map((d) => d.email)),
    catalogue: indexerCatalogue(produits, variantes),
  };
}

/** Ce qui a réellement été écrit, table par table. */
export interface Ecriture {
  clientesCreees: number;
  clientesCompletees: number;
  adresses: number;
  commandes: number;
  articles: number;
  expeditions: number;
  remboursements: number;
  evenements: number;
}

/** Des paquets : une insertion de mille lignes d'un coup dépasserait les limites de Postgres. */
function paquets<T>(liste: readonly T[], taille: number): T[][] {
  const sortie: T[][] = [];
  for (let i = 0; i < liste.length; i += taille) sortie.push(liste.slice(i, i + taille));
  return sortie;
}

/**
 * Remplit une case seulement si elle est vide AU MOMENT D'ÉCRIRE : même si
 * la fiche avait bougé depuis la lecture, rien de ce qu'elle porte n'est
 * remplacé.
 */
function siVide(colonne: AnyPgColumn, valeur: string) {
  return raw`coalesce(nullif(trim(${colonne}), ''), ${valeur})`;
}

async function ecrire(tx: Transaction, plan: Plan): Promise<Ecriture> {
  const e: Ecriture = {
    clientesCreees: 0,
    clientesCompletees: 0,
    adresses: 0,
    commandes: 0,
    articles: 0,
    expeditions: 0,
    remboursements: 0,
    evenements: 0,
  };

  /* -- Les clientes ------------------------------------------------------- */

  const idParEmail = new Map<string, number>();
  for (const p of plan.clientes) if (p.ficheId !== undefined) idParEmail.set(p.email, p.ficheId);

  const nouvelles = plan.clientes.flatMap((p) => (p.creation ? [p.creation] : []));
  for (const paquet of paquets(nouvelles, 200)) {
    const creees = await tx
      .insert(schema.customers)
      .values(paquet)
      .returning({ id: schema.customers.id, email: schema.customers.email });
    for (const c of creees) if (c.email) idParEmail.set(c.email, c.id);
    e.clientesCreees += creees.length;
  }

  for (const p of plan.clientes) {
    if (!p.maj || p.ficheId === undefined) continue;
    const m = p.maj;
    const c = schema.customers;
    await tx
      .update(c)
      .set({
        ...(m.name ? { name: siVide(c.name, m.name) } : {}),
        ...(m.firstName ? { firstName: siVide(c.firstName, m.firstName) } : {}),
        ...(m.lastName ? { lastName: siVide(c.lastName, m.lastName) } : {}),
        ...(m.phone ? { phone: siVide(c.phone, m.phone) } : {}),
        ...(m.note ? { note: siVide(c.note, m.note) } : {}),
        ...(m.tags ? { tags: m.tags } : {}),
        ...(typeof m.legacyId === "number"
          ? { legacyId: raw`coalesce(${c.legacyId}, ${m.legacyId})` }
          : {}),
      })
      .where(eq(c.id, p.ficheId));
    e.clientesCompletees++;
  }

  const adresses = plan.clientes.flatMap((p) => {
    const id = idParEmail.get(p.email);
    return p.adresse && id !== undefined ? [{ ...p.adresse, customerId: id }] : [];
  });
  for (const paquet of paquets(adresses, 300)) {
    await tx.insert(schema.customerAddresses).values(paquet);
    e.adresses += paquet.length;
  }

  /* -- Les commandes ------------------------------------------------------ */

  const idParNumero = new Map<string, number>();
  for (const paquet of paquets(plan.commandes, 200)) {
    const lignes = await tx
      .insert(schema.orders)
      .values(
        paquet.map((c) => ({
          ...c.valeurs,
          customerId: c.emailCliente ? (idParEmail.get(c.emailCliente) ?? null) : null,
        })),
      )
      .returning({ id: schema.orders.id, number: schema.orders.number });
    for (const l of lignes) idParNumero.set(l.number, l.id);
    e.commandes += lignes.length;
  }
  const idDe = (numero: string): number => {
    const id = idParNumero.get(numero);
    if (id === undefined) throw new Error(`Commande ${numero} non écrite : la reprise s'arrête.`);
    return id;
  };

  const articles = plan.commandes.flatMap((c) =>
    c.articles.map((a) => ({
      orderId: idDe(c.numero),
      productId: a.productId,
      variantId: a.variantId,
      config: a.config,
      title: a.title,
      unitPriceCents: a.unitPriceCents,
      quantity: a.quantity,
    })),
  );
  const lignesDe = new Map<number, { id: number; quantity: number }[]>();
  for (const paquet of paquets(articles, 500)) {
    const lignes = await tx.insert(schema.orderItems).values(paquet).returning({
      id: schema.orderItems.id,
      orderId: schema.orderItems.orderId,
      quantity: schema.orderItems.quantity,
    });
    for (const l of lignes)
      lignesDe.set(l.orderId, [...(lignesDe.get(l.orderId) ?? []), { id: l.id, quantity: l.quantity }]);
    e.articles += lignes.length;
  }

  // L'expédition qui fait d'une vente une commande « traitée » : sans elle,
  // elle resterait dans « À expédier » et « Non traitées ».
  const aExpedier = plan.commandes.flatMap((c) =>
    c.expeditionLe ? [{ orderId: idDe(c.numero), status: "success", createdAt: c.expeditionLe }] : [],
  );
  for (const paquet of paquets(aExpedier, 300)) {
    const parties = await tx
      .insert(schema.fulfillments)
      .values(paquet)
      .returning({ id: schema.fulfillments.id, orderId: schema.fulfillments.orderId });
    const contenu = parties.flatMap((f) =>
      (lignesDe.get(f.orderId) ?? []).map((l) => ({
        fulfillmentId: f.id,
        orderItemId: l.id,
        quantity: l.quantity,
      })),
    );
    for (const morceau of paquets(contenu, 500))
      await tx.insert(schema.fulfillmentItems).values(morceau);
    e.expeditions += parties.length;
  }

  const remboursements = plan.commandes.flatMap((c) =>
    c.remboursement ? [{ ...c.remboursement, orderId: idDe(c.numero) }] : [],
  );
  for (const paquet of paquets(remboursements, 300)) {
    await tx.insert(schema.refunds).values(paquet);
    e.remboursements += paquet.length;
  }

  const evenements = plan.commandes.map((c) => ({
    orderId: idDe(c.numero),
    kind: "event",
    message: c.evenement,
    author: "Reprise Shopify",
  }));
  for (const paquet of paquets(evenements, 300)) {
    await tx.insert(schema.orderEvents).values(paquet);
    e.evenements += paquet.length;
  }

  return e;
}

export interface OptionsReprise {
  /** Le dossier des exports Shopify. */
  dossier: string;
  /** Faux : l'aperçu seul, rien n'est écrit. */
  pourDeBon: boolean;
  maintenant?: Date;
}

export interface Reprise {
  lu: DossierLu;
  plan: Plan;
  /** Null pour un aperçu. */
  ecriture: Ecriture | null;
}

/**
 * Lit les exports, confronte à la base, et n'écrit que si on le demande.
 *
 * L'écriture tient dans UNE transaction : une erreur au milieu annule tout,
 * et le même dossier se relance tel quel. Un verrou la réserve à un seul
 * passage à la fois ; le plan est recalculé sous ce verrou, à partir de la
 * base telle qu'elle est à cet instant.
 */
export async function reprendreHistorique(options: OptionsReprise): Promise<Reprise> {
  const maintenant = options.maintenant ?? new Date();
  const lu = lireDossier(options.dossier);
  const lecture = {
    clientes: lireClientes(lu.clientes),
    commandes: lireCommandes(lu.commandes),
  };
  // Un export sans une seule ligne, c'est presque toujours un export filtré
  // (« Clients actuels », une page de commandes) : on ne reprend pas à moitié.
  const vides = [
    ...(lecture.clientes.lignes ? [] : ["l'export des clientes"]),
    ...(lecture.commandes.lignes ? [] : ["l'export des commandes"]),
  ];
  if (vides.length)
    throw new ImportImpossible(
      `Les fichiers sont là, mais ${vides.join(" et ")} ne contien${vides.length > 1 ? "nent" : "t"} aucune ligne.\n` +
        "Refaites l'export en choisissant « Tous les clients » et « Toutes les commandes ».\n\n" +
        CONSIGNE_EXPORT,
    );
  if (!options.pourDeBon) {
    const plan = planifier(lecture, await lireEtat(db), maintenant);
    return { lu, plan, ecriture: null };
  }
  return db.transaction(async (tx) => {
    await tx.execute(raw`select pg_advisory_xact_lock(hashtext('reprise-historique-shopify'))`);
    const plan = planifier(lecture, await lireEtat(tx), maintenant);
    const ecriture = await ecrire(tx, plan);
    return { lu, plan, ecriture };
  });
}

/**
 * La reprise, telle que l'import complet (index.ts) la compte dans son
 * rapport. Elle écrit directement : l'import complet n'a pas d'aperçu.
 */
export async function importCustomersAndOrders(report: ImportReport, dossier: string) {
  const { plan, ecriture } = await reprendreHistorique({ dossier, pourDeBon: true });
  bump(report, "customer", "created", ecriture?.clientesCreees ?? 0);
  bump(report, "customer", "skipped", plan.bilan.clientes.ecartees.length);
  bump(report, "order", "created", ecriture?.commandes ?? 0);
  bump(
    report,
    "order",
    "skipped",
    plan.bilan.commandes.dejaPresentes + plan.bilan.commandes.ecartees.length,
  );
  bump(report, "order_item", "created", ecriture?.articles ?? 0);
}
