/**
 * Ce qu'une affiche a rapporté ces derniers mois.
 *
 * Le tableau de bord dit comment va la boutique ; il ne dit pas si CETTE
 * affiche mérite qu'on en réimprime, qu'on la mette en avant, ou qu'on
 * l'archive. C'est pourtant la question qu'on se pose en ouvrant sa fiche.
 *
 * Quatre chiffres suffisent à y répondre : combien d'exemplaires sont partis,
 * combien de clients l'ont achetée, ce qu'elle a rapporté net, et par quel
 * canal. Le détail ajoute la courbe dans le temps et la part des clients
 * nouveaux, parce qu'une affiche qui ne se vend qu'aux habitués ne se
 * travaille pas comme une affiche qui en amène.
 *
 * Deux conventions, les mêmes que sur /admin/stats/orders :
 *  - une vente est une commande PAYÉE, datée de sa création ;
 *  - « net » veut dire remboursements déduits. Un remboursement est imputé à
 *    la ligne qu'il rembourse, quelle que soit sa propre date : ce qui
 *    intéresse la boutique, c'est ce que l'affiche a réellement laissé.
 */
import type { Hono } from "hono";
import { and, eq, gte, inArray } from "drizzle-orm";
import { db, schema } from "./db/client.js";

/** Bornes acceptées pour la fenêtre d'observation, en jours. */
const JOURS_MIN = 1;
const JOURS_MAX = 365;
const JOURS_DEFAUT = 90;

/** « 2026-09-09 », en heure locale du serveur : c'est la journée commerciale. */
function jourISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function mountVentesProduit(app: Hono) {
  app.get("/admin/products/:id/ventes", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "produit inconnu" }, 400);

    const jours = Math.min(
      JOURS_MAX,
      Math.max(JOURS_MIN, Number(c.req.query("jours") ?? JOURS_DEFAUT)),
    );
    const fin = new Date();
    const debut = new Date(fin.getTime() - jours * 86400000);

    // Les lignes de commande qui portent CE produit, sur des commandes payées.
    // Une jointure plutôt que deux requêtes : le filtre sur le statut et la
    // date doit s'appliquer avant de ramener quoi que ce soit.
    const lignes = await db
      .select({
        ligneId: schema.orderItems.id,
        quantite: schema.orderItems.quantity,
        prixUnitaireCents: schema.orderItems.unitPriceCents,
        commandeId: schema.orders.id,
        canal: schema.orders.channel,
        clientId: schema.orders.customerId,
        creeLe: schema.orders.createdAt,
      })
      .from(schema.orderItems)
      .innerJoin(schema.orders, eq(schema.orderItems.orderId, schema.orders.id))
      .where(
        and(
          eq(schema.orderItems.productId, id),
          eq(schema.orders.status, "paid"),
          gte(schema.orders.createdAt, debut),
        ),
      );

    // Ce qui a été rendu au client sur ces lignes-là.
    const ligneIds = lignes.map((l) => l.ligneId);
    const remboursements = ligneIds.length
      ? await db
          .select({
            ligneId: schema.refundItems.orderItemId,
            quantite: schema.refundItems.quantity,
            montantCents: schema.refundItems.amountCents,
          })
          .from(schema.refundItems)
          .where(inArray(schema.refundItems.orderItemId, ligneIds))
      : [];
    const renduParLigne = new Map<number, { quantite: number; cents: number }>();
    for (const r of remboursements) {
      const actuel = renduParLigne.get(r.ligneId) ?? { quantite: 0, cents: 0 };
      actuel.quantite += r.quantite;
      actuel.cents += r.montantCents;
      renduParLigne.set(r.ligneId, actuel);
    }

    /** Ce que la ligne a laissé, une fois les remboursements déduits. */
    const net = (l: (typeof lignes)[number]) => {
      const rendu = renduParLigne.get(l.ligneId) ?? { quantite: 0, cents: 0 };
      return {
        unites: Math.max(0, l.quantite - rendu.quantite),
        cents: Math.max(0, l.prixUnitaireCents * l.quantite - rendu.cents),
      };
    };

    let unites = 0;
    let ventesNettesCents = 0;
    const parCanal = new Map<string, { unites: number; cents: number }>();
    const parJour = new Map<string, number>();
    const acheteurs = new Set<number>();
    const commandes = new Set<number>();

    for (const l of lignes) {
      const { unites: u, cents } = net(l);
      unites += u;
      ventesNettesCents += cents;
      commandes.add(l.commandeId);
      if (l.clientId !== null) acheteurs.add(l.clientId);

      const canal = parCanal.get(l.canal) ?? { unites: 0, cents: 0 };
      canal.unites += u;
      canal.cents += cents;
      parCanal.set(l.canal, canal);

      const jour = jourISO(l.creeLe);
      parJour.set(jour, (parJour.get(jour) ?? 0) + cents);
    }

    // La courbe porte un point par jour, y compris les jours sans vente :
    // sans eux, deux ventes espacées d'un mois se toucheraient sur le dessin.
    const serie: { jour: string; cents: number }[] = [];
    for (let i = jours - 1; i >= 0; i--) {
      const j = jourISO(new Date(fin.getTime() - i * 86400000));
      serie.push({ jour: j, cents: parJour.get(j) ?? 0 });
    }

    // Nouveaux clients ou habitués : on regarde, pour chacun des acheteurs de
    // cette affiche, si sa TOUTE PREMIÈRE commande payée tombe dans la
    // fenêtre. Une affiche qui n'attire que des habitués ne se travaille pas
    // comme une affiche qui fait entrer du monde.
    let nouveaux = 0;
    let recurrents = 0;
    if (acheteurs.size) {
      const idsClients = [...acheteurs];
      const toutesLeursCommandes = await db
        .select({
          clientId: schema.orders.customerId,
          creeLe: schema.orders.createdAt,
        })
        .from(schema.orders)
        .where(
          and(
            eq(schema.orders.status, "paid"),
            inArray(schema.orders.customerId, idsClients),
          ),
        );
      const premiereFois = new Map<number, Date>();
      for (const o of toutesLeursCommandes) {
        if (o.clientId === null) continue;
        const connue = premiereFois.get(o.clientId);
        if (!connue || o.creeLe < connue) premiereFois.set(o.clientId, o.creeLe);
      }
      for (const client of idsClients) {
        const premiere = premiereFois.get(client);
        if (premiere && premiere >= debut) nouveaux++;
        else recurrents++;
      }
    }

    const [produit] = await db
      .select({ name: schema.products.name })
      .from(schema.products)
      .where(eq(schema.products.id, id));

    return c.json({
      produit: produit?.name ?? null,
      jours,
      debut: debut.toISOString(),
      fin: fin.toISOString(),
      unites,
      acheteurs: acheteurs.size,
      commandes: commandes.size,
      ventesNettesCents,
      serie,
      parCanal: [...parCanal.entries()].map(([canal, v]) => ({
        canal,
        unites: v.unites,
        cents: v.cents,
      })),
      clients: { nouveaux, recurrents },
    });
  });
}
