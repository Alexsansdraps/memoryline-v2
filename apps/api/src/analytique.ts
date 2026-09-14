/**
 * Les statistiques de vente.
 *
 * L'écran des finances répond à « où est l'argent » : ce qui est entré, ce qui
 * est sorti, par quel moyen. Ce fichier-ci répond à une autre question, celle
 * qu'on se pose le lundi matin — « qu'est-ce qui se vend, et est-ce que ça
 * monte ? ». C'est ce que Shopify appelle ses analyses, et c'est ce qui
 * manquait.
 *
 * TROIS PARTIS PRIS, parce qu'un chiffre mal cadré est pire qu'un chiffre
 * absent :
 *
 * 1. On ne compte QUE les commandes payées et non annulées. Un panier
 *    abandonné n'est pas une vente, une commande en attente de paiement non
 *    plus. Les mélanger ferait un chiffre d'affaires qui ne correspondrait à
 *    aucun euro reçu.
 *
 * 2. Chaque chiffre est donné AVEC la période précédente de même durée. « 420 €
 *    ce mois-ci » ne veut rien dire seul ; « 420 €, contre 310 € le mois
 *    d'avant » est une information. C'est la différence entre un tableau de
 *    bord et une liste de nombres.
 *
 * 3. Les jours se découpent à l'heure de PARIS, pas à celle du serveur. Une
 *    commande passée à 23 h 30 doit compter pour ce jour-là, pas pour le
 *    lendemain — et le serveur, lui, vit en temps universel.
 *
 * Tout passe par le client SQL brut plutôt que par le constructeur de
 * requêtes : ce sont des agrégats, et les écrire en SQL les rend lisibles par
 * quelqu'un qui connaît SQL — ce qui est le cas de la personne qui devra les
 * vérifier le jour où un chiffre surprendra.
 */
import type { Hono } from "hono";
import { sql } from "./db/client.js";

/** Le fuseau qui fait foi pour découper les jours. */
const FUSEAU = "Europe/Paris";

/** Les seuls statuts qui comptent comme une vente. */
const VENDUE = sql`status = 'paid' and cancelled_at is null`;

interface Periode {
  debut: Date;
  fin: Date;
}

/**
 * La période demandée, et celle d'avant, de même durée.
 *
 * Par défaut les trente derniers jours : c'est la fenêtre qui montre à la fois
 * une tendance et le détail d'une semaine. Une période plus courte ferait du
 * bruit, une plus longue cacherait ce qui vient de changer.
 */
function periodes(depuis: string | undefined, jusqu: string | undefined) {
  const fin = jusqu ? new Date(`${jusqu}T23:59:59.999Z`) : new Date();
  const debut = depuis
    ? new Date(`${depuis}T00:00:00.000Z`)
    : new Date(fin.getTime() - 29 * 86400000);
  const duree = Math.max(1, fin.getTime() - debut.getTime());
  const avant: Periode = {
    debut: new Date(debut.getTime() - duree),
    fin: new Date(debut.getTime() - 1),
  };
  return { courante: { debut, fin } as Periode, avant };
}

/** Le total et le nombre de ventes d'une période. */
async function totaux(p: Periode) {
  const [r] = await sql`
    select
      coalesce(sum(total_cents), 0)::int as ca_cents,
      count(*)::int                      as commandes,
      count(distinct customer_id)::int   as clients
    from "public"."order"
    where ${VENDUE} and created_at between ${p.debut} and ${p.fin}`;
  const ca = Number(r?.ca_cents ?? 0);
  const n = Number(r?.commandes ?? 0);
  return {
    caCents: ca,
    commandes: n,
    clients: Number(r?.clients ?? 0),
    // Le panier moyen se calcule ici et non à l'écran : une division par zéro
    // affichée « NaN € » sur un tableau de bord fait douter de tout le reste.
    panierMoyenCents: n ? Math.round(ca / n) : 0,
  };
}

/** L'écart avec la période précédente, en pourcentage entier. */
function evolution(maintenant: number, avant: number): number | null {
  // Pas d'évolution quand il n'y avait rien : « +∞ % » ne se lit pas, et
  // « +100 % » serait faux. L'écran dira « pas de comparaison ».
  if (!avant) return null;
  return Math.round(((maintenant - avant) / avant) * 100);
}

export function mountAnalytiqueRoutes(app: Hono): void {
  app.get("/admin/analytique", async (c) => {
    const { courante, avant } = periodes(
      c.req.query("depuis"),
      c.req.query("jusqu"),
    );

    /*
     * Tout part ENSEMBLE. Ce sont huit agrégats indépendants ; les enchaîner
     * ferait huit allers-retours là où un seul suffit — c'est ce qui rendait
     * les écrans du back-office lents avant qu'on déménage la base.
     */
    const [
      maintenant,
      precedent,
      parJour,
      meilleuresVentes,
      parCanal,
      parFormat,
      clients,
      paniers,
      lieux,
    ] = await Promise.all([
      totaux(courante),
      totaux(avant),

      // La courbe. `generate_series` remplit les jours SANS vente : sans lui,
      // une semaine creuse se lirait comme une semaine absente, et la courbe
      // rapprocherait deux jours éloignés.
      sql`
        with jours as (
          select generate_series(
            date_trunc('day', ${courante.debut}::timestamptz at time zone ${FUSEAU}),
            date_trunc('day', ${courante.fin}::timestamptz at time zone ${FUSEAU}),
            interval '1 day'
          )::date as jour
        ),
        ventes as (
          select (created_at at time zone ${FUSEAU})::date as jour,
                 sum(total_cents)::int as ca_cents,
                 count(*)::int         as commandes
          from "public"."order"
          where ${VENDUE} and created_at between ${courante.debut} and ${courante.fin}
          group by 1
        )
        select to_char(j.jour, 'YYYY-MM-DD') as jour,
               coalesce(v.ca_cents, 0)  as "caCents",
               coalesce(v.commandes, 0) as commandes
        from jours j left join ventes v on v.jour = j.jour
        order by j.jour`,

      // Les meilleures ventes. Le libellé figé de la ligne fait foi : un
      // produit renommé depuis, ou supprimé, doit rester lisible dans
      // l'historique — c'est sous ce nom-là qu'il s'est vendu.
      sql`
        select coalesce(i.title, p.name, 'Affiche supprimée') as nom,
               p.slug                                         as slug,
               sum(i.quantity)::int                           as quantite,
               sum(i.quantity * i.unit_price_cents)::int      as "caCents"
        from "public"."order_item" i
        join "public"."order" o on o.id = i.order_id
        left join "public"."product" p on p.id = i.product_id
        where o.status = 'paid' and o.cancelled_at is null
          and o.created_at between ${courante.debut} and ${courante.fin}
        group by 1, 2
        order by "caCents" desc
        limit 10`,

      sql`
        select channel as canal,
               count(*)::int as commandes,
               sum(total_cents)::int as "caCents"
        from "public"."order"
        where ${VENDUE} and created_at between ${courante.debut} and ${courante.fin}
        group by 1
        order by "caCents" desc`,

      /*
       * Le format se lit d'abord sur la déclinaison vendue, et à défaut dans
       * la CONFIGURATION de l'affiche.
       *
       * Ce repli n'est pas un détail : sur les commandes existantes, aucune
       * ligne ne porte de déclinaison — le format d'une affiche composée vit
       * dans son `config`. Sans ce repli, toutes les ventes se rangeaient
       * sous « autre » et le tableau ne disait rien. Avec, on lit A4 × 8,
       * A3 × 1.
       */
      sql`
        select coalesce(v.format, i.config->>'format', 'autre') as format,
               sum(i.quantity)::int        as quantite,
               sum(i.quantity * i.unit_price_cents)::int as "caCents"
        from "public"."order_item" i
        join "public"."order" o on o.id = i.order_id
        left join "public"."variant" v on v.id = i.variant_id
        where o.status = 'paid' and o.cancelled_at is null
          and o.created_at between ${courante.debut} and ${courante.fin}
        group by 1
        order by quantite desc`,

      // Nouvelles clientes contre clientes qui reviennent. « Nouvelle » se
      // juge sur la PREMIÈRE commande payée, et non sur la date de création du
      // compte : quelqu'un qui s'inscrit en janvier et achète en mars est une
      // nouvelle cliente en mars, pas une revenante.
      sql`
        with premiere as (
          select customer_id, min(created_at) as le_jour
          from "public"."order"
          where status = 'paid' and cancelled_at is null and customer_id is not null
          group by 1
        )
        select
          count(*) filter (
            where pr.le_jour between ${courante.debut} and ${courante.fin}
          )::int as nouvelles,
          count(*) filter (
            where pr.le_jour < ${courante.debut}
          )::int as revenantes
        from "public"."order" o
        join premiere pr on pr.customer_id = o.customer_id
        where o.status = 'paid' and o.cancelled_at is null
          and o.created_at between ${courante.debut} and ${courante.fin}`,

      // Les paniers laissés en route. Un « draft » est un panier en cours ou
      // abandonné ; un « pending » attend un paiement qui n'est jamais venu.
      // Les deux racontent la même chose : quelqu'un a commencé et n'a pas
      // fini.
      sql`
        select
          count(*) filter (where status = 'draft')::int   as paniers,
          count(*) filter (where status = 'pending')::int as attente,
          coalesce(sum(total_cents) filter (where status in ('draft','pending')), 0)::int as "perduCents"
        from "public"."order"
        where cancelled_at is null
          and created_at between ${courante.debut} and ${courante.fin}`,

      // Où partent les affiches. La ville d'expédition, pas celle de
      // l'affiche : c'est la carte des clientes, pas celle du catalogue.
      sql`
        select upper(trim(shipping_city)) as ville,
               count(*)::int as commandes
        from "public"."order"
        where ${VENDUE} and created_at between ${courante.debut} and ${courante.fin}
          and shipping_city is not null and trim(shipping_city) <> ''
        group by 1
        order by commandes desc
        limit 8`,
    ]);

    const debut = paniers[0] ?? { paniers: 0, attente: 0, perduCents: 0 };
    const commences =
      Number(debut.paniers) + Number(debut.attente) + maintenant.commandes;

    return c.json({
      periode: {
        debut: courante.debut.toISOString().slice(0, 10),
        fin: courante.fin.toISOString().slice(0, 10),
        jours: Math.max(
          1,
          Math.round((courante.fin.getTime() - courante.debut.getTime()) / 86400000),
        ),
      },
      resume: {
        caCents: maintenant.caCents,
        commandes: maintenant.commandes,
        panierMoyenCents: maintenant.panierMoyenCents,
        clients: maintenant.clients,
        evolution: {
          caCents: evolution(maintenant.caCents, precedent.caCents),
          commandes: evolution(maintenant.commandes, precedent.commandes),
          panierMoyenCents: evolution(
            maintenant.panierMoyenCents,
            precedent.panierMoyenCents,
          ),
        },
        precedent: {
          caCents: precedent.caCents,
          commandes: precedent.commandes,
          panierMoyenCents: precedent.panierMoyenCents,
        },
      },
      parJour,
      meilleuresVentes,
      parCanal,
      parFormat,
      clients: {
        nouvelles: Number(clients[0]?.nouvelles ?? 0),
        revenantes: Number(clients[0]?.revenantes ?? 0),
      },
      paniers: {
        abandonnes: Number(debut.paniers),
        enAttente: Number(debut.attente),
        perduCents: Number(debut.perduCents),
        // Le taux de transformation : sur cent parcours commencés, combien
        // sont allés jusqu'au paiement. C'est le chiffre que Shopify affiche
        // en premier, et celui qui dit le plus sur la boutique.
        transformation: commences
          ? Math.round((maintenant.commandes / commences) * 100)
          : null,
      },
      lieux,
    });
  });
}
