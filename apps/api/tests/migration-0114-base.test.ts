/**
 * La migration 0114 (26/11) : les ventes du stand déjà faites repassent « À
 * imprimer », comme si la nouvelle règle avait toujours existé — et rien
 * d'autre ne bouge.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/migration-0114-base.test.ts
 *
 * Alexandra : « toutes les commandes déjà faite, tu les mets pas au dernier
 * statut car elle aimerait les modifier pour qu'elles collent mieux à son
 * CA » ; « bien sur les tests et annulés restent dans leur case ».
 *
 * Le fichier SQL lui-même (drizzle/0114_ventes_stand_a_imprimer.sql) est
 * rejoué sur des ventes fictives, deux fois, dans une transaction qu'on
 * ANNULE à la fin : la base locale en ressort telle qu'elle était. Ses ventes
 * réelles, déjà passées par la migration, ne sont pas des cibles (plus de
 * remise réussie, plus de date de fin) : elles ne bougent pas non plus.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const baseLocale =
  /@db:5432\//.test(process.env.DATABASE_URL ?? "") && process.env.NODE_ENV !== "production";

after(async () => {
  if (!baseLocale) return;
  const { sql } = await import("../src/db/client.js");
  await sql.end({ timeout: 5 });
});

const MIGRATION = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../drizzle/0114_ventes_stand_a_imprimer.sql"),
  "utf8",
);

/** Ce qui annule la transaction une fois les vérifications faites. */
class Annuler extends Error {}

test(
  "0114 : les ventes du stand payées reviennent « À imprimer » ; tests, annulées, reprises, site et colis ne bougent pas ; rejouable",
  { skip: !baseLocale && "hors de la base locale du conteneur" },
  async () => {
    const { sql } = await import("../src/db/client.js");
    const s = `${Date.now()}`.slice(-6);
    try {
      await sql.begin(async (tx) => {
        /**
         * Une commande fictive, avec sa remise (ou son colis) s'il le faut.
         * Dates et JSON partent en texte : drizzle rend transparents les
         * convertisseurs de ce client pour ces types (il les fait lui-même).
         */
        const commande = async (
          v: { number: string; channel: string; status: string; tags?: string[]; legacyId?: number | null; termine?: boolean },
          remise?: { carrier?: string | null; tracking?: string | null } | null,
        ) => {
          const [o] = await tx`
            insert into "order" (channel, number, status, total_cents, tags, legacy_id, fulfilled_at)
            values (${v.channel}::order_channel, ${v.number}, ${v.status}, 2900, ${JSON.stringify(v.tags ?? [])}::jsonb, ${v.legacyId ?? null},
                    ${v.termine ? new Date().toISOString() : null})
            returning id`;
          const [l] = await tx`
            insert into order_item (order_id, title, unit_price_cents, quantity)
            values (${o!.id}, 'VIEUX MOULIN', 2900, 1) returning id`;
          if (remise) {
            const [f] = await tx`
              insert into fulfillment (order_id, status, carrier, tracking_number)
              values (${o!.id}, 'success', ${remise.carrier ?? null}, ${remise.tracking ?? null}) returning id`;
            await tx`insert into fulfillment_item (fulfillment_id, order_item_id, quantity) values (${f!.id}, ${l!.id}, 1)`;
          }
          return o!.id as number;
        };
        // Les numéros SAL- fictifs sont dans la série : la transaction
        // annulée les rend, et aucun n'est vu d'ailleurs entre-temps.
        const cibles = {
          remise: await commande({ number: `SAL-9${s}1`, channel: "salon", status: "paid", termine: true }, {}),
          dateSeule: await commande({ number: `SAL-9${s}2`, channel: "salon", status: "paid", termine: true }),
          etiquetteNote: await commande(
            { number: `SAL-9${s}3`, channel: "salon", status: "paid", tags: ["TEST : viendra chercher le 20/9"], termine: true },
            {},
          ),
          // Une « Terminée » d'avant, saisie au bloc d'expédition avec un
          // transporteur mais sans suivi : une remise, pas un colis.
          mainPropre: await commande(
            { number: `SAL-7${s}2`, channel: "salon", status: "paid", termine: true },
            { carrier: "Remise en main propre" },
          ),
        };
        const intactes = {
          test: await commande({ number: `SAL-9${s}4`, channel: "salon", status: "cancelled", tags: ["test"] }, {}),
          annulee: await commande({ number: `SAL-9${s}5`, channel: "salon", status: "cancelled" }),
          payeeEtiqueteeTest: await commande(
            { number: `SAL-9${s}6`, channel: "salon", status: "paid", tags: ["Test"], termine: true },
            {},
          ),
          reprise: await commande(
            { number: `SHOP-9${s}7`, channel: "salon", status: "paid", legacyId: 990000 + Number(s.slice(-3)), termine: true },
            {},
          ),
          site: await commande({ number: `WEB-9${s}8`, channel: "web", status: "paid", termine: true }, {}),
          colis: await commande(
            { number: `SAL-9${s}9`, channel: "salon", status: "paid", termine: true },
            { carrier: "Colissimo", tracking: "6A123" },
          ),
          dejaAImprimer: await commande({ number: `SAL-8${s}0`, channel: "salon", status: "paid" }),
          panier: await commande({ number: `SAL-8${s}1`, channel: "salon", status: "draft" }, {}),
          // Validée sous la nouvelle règle, puis marquée terminée par Margaux.
          nouvelleRegle: await commande({ number: `SAL-8${s}2`, channel: "salon", status: "paid", termine: true }, {}),
        };
        await tx`
          insert into order_event (order_id, kind, message)
          values (${intactes.nouvelleRegle}, 'event',
            'Commande prise au stand (Essai), réglée sur place : à imprimer, puis à marquer terminée au back-office.')`;
        const tous = [...Object.values(cibles), ...Object.values(intactes)];
        const etat = async () => {
          const lignes = await tx`
            select o.id,
              (o.fulfilled_at is not null) as termine,
              (select count(*)::int from fulfillment f where f.order_id = o.id and f.status = 'success') as remises,
              (select count(*)::int from order_event e where e.order_id = o.id) as journal
            from "order" o where o.id in ${tx(tous)}`;
          return new Map(lignes.map((l) => [l.id as number, { termine: l.termine, remises: l.remises, journal: l.journal }]));
        };
        const avant = await etat();

        await tx.unsafe(MIGRATION);
        const apres = await etat();
        for (const [nom, id] of Object.entries(cibles))
          assert.deepEqual(apres.get(id), { termine: false, remises: 0, journal: 1 }, `${nom} : rendue « À imprimer », une ligne au journal`);
        for (const [nom, id] of Object.entries(intactes))
          assert.deepEqual(apres.get(id), avant.get(id), `${nom} : intacte`);
        // La remise annulée l'est comme à la réouverture : la ligne reste, datée.
        const [remise] = await tx`
          select status, cancelled_at from fulfillment where order_id = ${cibles.remise}`;
        assert.equal(remise!.status, "cancelled");
        assert.ok(remise!.cancelled_at);
        const [ligne] = await tx`select message from order_event where order_id = ${cibles.remise}`;
        assert.match(ligne!.message, /^Vente remise « À imprimer » le 26\/11/);

        // Rejouée, elle ne touche plus rien.
        await tx.unsafe(MIGRATION);
        assert.deepEqual(await etat(), apres);

        // Pas même une vente qu'elle a rendue et que Margaux a marquée
        // terminée depuis : la ligne du journal la met hors d'atteinte.
        const [f] = await tx`
          insert into fulfillment (order_id, status) values (${cibles.remise}, 'success') returning id`;
        await tx`update "order" set fulfilled_at = ${new Date().toISOString()} where id = ${cibles.remise}`;
        const marquee = await etat();
        assert.deepEqual(marquee.get(cibles.remise), { termine: true, remises: 1, journal: 1 });
        await tx.unsafe(MIGRATION);
        assert.deepEqual(await etat(), marquee, "rejouée après coup : rien ne bouge");
        assert.ok(f);
        throw new Annuler();
      });
    } catch (e) {
      if (!(e instanceof Annuler)) throw e;
    }
  },
);
