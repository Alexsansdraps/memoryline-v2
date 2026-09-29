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
 * Et une lecture au choix : le SITE, les STANDS, ou TOUT. Une vente de marché
 * de Noël et une vente en ligne ne se jugent pas pareil — le panier moyen
 * d'un samedi de stand n'a rien à voir avec celui d'un mardi sur le site — et
 * les additionner sans pouvoir les séparer cachait l'un derrière l'autre.
 * Chaque chiffre suit ce choix ; ceux qui n'ont pas de sens au stand (paniers
 * abandonnés, transformation) n'y sont pas calculés du tout.
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

/** Ce qu'on regarde : les ventes du site, celles des stands, ou toutes. */
type Canal = "site" | "stands" | "tout";

/** Le canal demandé (?canal=site). Inconnu ou absent : tout, comme avant le choix. */
function canalDemande(v: string | undefined): Canal {
  return v === "site" || v === "stands" ? v : "tout";
}

/**
 * La condition qui garde les commandes du canal choisi.
 *
 * Le canal d'une commande (`web` ou `salon`) est posé à la vente et ne bouge
 * plus : c'est lui qui fait foi pour une commande payée. La colonne se passe
 * en paramètre parce que certaines requêtes lisent la commande sous un alias.
 */
function duCanal(canal: Canal, colonne = sql`channel`) {
  if (canal === "site") return sql`${colonne} = 'web'`;
  if (canal === "stands") return sql`${colonne} = 'salon'`;
  return sql`true`;
}

interface Periode {
  debut: Date;
  fin: Date;
}

/**
 * Une borne de période telle qu'elle part dans une requête : en TEXTE ISO 8601,
 * converti par Postgres (`::timestamptz`), jamais en objet Date.
 *
 * Le client SQL est partagé avec Drizzle, qui remplace la mise en forme des
 * dates par un passe-plat — lui les écrit déjà en texte. Une Date passée telle
 * quelle ici n'était donc plus convertie, et chaque requête tombait sur une
 * erreur de type avant même de partir : l'écran des statistiques ne pouvait
 * rien afficher. Même précaution que dans relance-panier.ts.
 */
function enTexte(d: Date): string {
  return d.toISOString();
}

/**
 * La période demandée, et celle d'avant, de même durée.
 *
 * Par défaut les trente derniers jours : c'est la fenêtre qui montre à la fois
 * une tendance et le détail d'une semaine. Une période plus courte ferait du
 * bruit, une plus longue cacherait ce qui vient de changer.
 */
function periodes(depuis: string | undefined, jusqu: string | undefined) {
  const fin = jusqu ? new Date(`${jusqu}T23:59:59.999`) : new Date();
  const debut = depuis
    ? new Date(`${depuis}T00:00:00.000`)
    : new Date(fin.getTime() - 29 * 86400000);
  const duree = Math.max(1, fin.getTime() - debut.getTime());
  const avant: Periode = {
    debut: new Date(debut.getTime() - duree),
    fin: new Date(debut.getTime() - 1),
  };
  return { courante: { debut, fin } as Periode, avant };
}

/** Le total et le nombre de ventes d'une période, pour un canal. */
async function totaux(p: Periode, canal: Canal) {
  const [r] = await sql`
    select
      coalesce(sum(total_cents), 0)::int as ca_cents,
      count(*)::int                      as commandes,
      count(distinct customer_id)::int   as clients
    from "public"."order"
    where ${VENDUE} and ${duCanal(canal)}
      and created_at between ${enTexte(p.debut)}::timestamptz
                         and ${enTexte(p.fin)}::timestamptz`;
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
    /** Les bornes de la période, prêtes pour les requêtes (voir `enTexte`). */
    const du = enTexte(courante.debut);
    const au = enTexte(courante.fin);
    const canal = canalDemande(c.req.query("canal"));
    /** Le canal appliqué aux requêtes qui lisent la commande sous l'alias « o ». */
    const canalO = duCanal(canal, sql`o.channel`);
    /** Ce qu'une requête sans objet renvoie : rien, sans aller-retour. */
    const aucuneLigne = Promise.resolve([] as Record<string, unknown>[]);

    /*
     * Tout part ENSEMBLE. Ce sont une dizaine d'agrégats indépendants ; les
     * enchaîner ferait autant d'allers-retours là où un seul suffit — c'est ce
     * qui rendait les écrans du back-office lents avant qu'on déménage la base.
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
      parStand,
    ] = await Promise.all([
      totaux(courante, canal),
      totaux(avant, canal),

      // La courbe. `generate_series` remplit les jours SANS vente : sans lui,
      // une semaine creuse se lirait comme une semaine absente, et la courbe
      // rapprocherait deux jours éloignés.
      sql`
        with jours as (
          select generate_series(
            date_trunc('day', ${du}::timestamptz at time zone ${FUSEAU}),
            date_trunc('day', ${au}::timestamptz at time zone ${FUSEAU}),
            interval '1 day'
          )::date as jour
        ),
        ventes as (
          select (created_at at time zone ${FUSEAU})::date as jour,
                 sum(total_cents)::int as ca_cents,
                 count(*)::int         as commandes
          from "public"."order"
          where ${VENDUE} and ${duCanal(canal)}
            and created_at between ${du}::timestamptz and ${au}::timestamptz
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
        where o.status = 'paid' and o.cancelled_at is null and ${canalO}
          and o.created_at between ${du}::timestamptz and ${au}::timestamptz
        group by 1, 2
        order by "caCents" desc
        limit 10`,

      sql`
        select channel as canal,
               count(*)::int as commandes,
               sum(total_cents)::int as "caCents"
        from "public"."order"
        where ${VENDUE} and ${duCanal(canal)}
          and created_at between ${du}::timestamptz and ${au}::timestamptz
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
        where o.status = 'paid' and o.cancelled_at is null and ${canalO}
          and o.created_at between ${du}::timestamptz and ${au}::timestamptz
        group by 1
        order by quantite desc`,

      /*
       * Nouvelles clientes contre clientes qui reviennent. « Nouvelle » se
       * juge sur la PREMIÈRE commande payée, et non sur la date de création du
       * compte : quelqu'un qui s'inscrit en janvier et achète en mars est une
       * nouvelle cliente en mars, pas une revenante.
       *
       * Cette première commande se cherche sur TOUS les canaux, quel que soit
       * le choix : une cliente du site qui vient acheter au stand n'est pas
       * une inconnue, c'est une fidèle — et c'est précisément ce que la
       * boutique veut savoir de ses stands. Seules les ventes de la période
       * suivent le canal choisi.
       *
       * On compte des PERSONNES, et non des commandes : deux commandes d'une
       * même nouvelle cliente ne font pas deux nouvelles clientes. Les deux
       * nombres s'additionnent ainsi en « clientes servies ».
       */
      sql`
        with premiere as (
          select customer_id, min(created_at) as le_jour
          from "public"."order"
          where status = 'paid' and cancelled_at is null and customer_id is not null
          group by 1
        )
        select
          count(distinct o.customer_id) filter (
            where pr.le_jour between ${du}::timestamptz and ${au}::timestamptz
          )::int as nouvelles,
          count(distinct o.customer_id) filter (
            where pr.le_jour < ${du}::timestamptz
          )::int as revenantes
        from "public"."order" o
        join premiere pr on pr.customer_id = o.customer_id
        where o.status = 'paid' and o.cancelled_at is null and ${canalO}
          and o.created_at between ${du}::timestamptz and ${au}::timestamptz`,

      /*
       * Les paniers laissés en route — ceux du SITE, quel que soit le choix,
       * et aucun sous « Stands ».
       *
       * Un « draft » est un panier en cours ou abandonné ; un « pending »
       * attend un paiement qui n'est jamais venu. Les deux racontent la même
       * chose : quelqu'un a commencé et n'a pas fini.
       *
       * Au stand, cela n'a pas de sens : la vente se règle sur place, devant
       * la vendeuse, et un client qui repart sans commander n'a rien
       * « abandonné » qu'on puisse relancer. Or son panier naît sur le canal
       * « web », comme tous les paniers : c'est `panier_du_stand` qui l'écarte
       * ici. Une commande en attente, elle, est toujours passée par la caisse
       * du site.
       *
       * Les ventes payées du site sont comptées dans la même lecture : la
       * transformation se calcule entre paniers du site et ventes du site,
       * sans quoi les ventes du stand la gonfleraient sous « Tout ».
       */
      canal === "stands"
        ? aucuneLigne
        : sql`
            select
              count(*) filter (where status = 'draft')::int   as paniers,
              count(*) filter (where status = 'pending')::int as attente,
              count(*) filter (where status = 'paid')::int    as payees,
              coalesce(sum(total_cents) filter (where status in ('draft','pending')), 0)::int as "perduCents"
            from "public"."order"
            where channel = 'web' and cancelled_at is null
              and not (status = 'draft' and panier_du_stand)
              and created_at between ${du}::timestamptz and ${au}::timestamptz`,

      // Où partent les affiches. La ville d'expédition, pas celle de
      // l'affiche : c'est la carte des clientes, pas celle du catalogue. Une
      // vente de stand est remise en main propre et n'a pas de ville : sous
      // « Stands », c'est le tableau par stand qui prend la place.
      canal === "stands"
        ? aucuneLigne
        : sql`
            select upper(trim(shipping_city)) as ville,
                   count(*)::int as commandes
            from "public"."order"
            where ${VENDUE} and ${duCanal(canal)}
              and created_at between ${du}::timestamptz and ${au}::timestamptz
              and shipping_city is not null and trim(shipping_city) <> ''
            group by 1
            order by commandes desc
            limit 8`,

      // Stand par stand : lequel a bien marché. Une vente d'avant les stands
      // multiples n'a pas de stand rattaché ; elle reste comptée, sous un nom
      // qui le dit, plutôt que de disparaître du total.
      canal === "stands"
        ? sql`
            select coalesce(s.nom, 'Stand non précisé') as stand,
                   count(*)::int                         as commandes,
                   sum(o.total_cents)::int               as "caCents"
            from "public"."order" o
            left join "public"."stand" s on s.id = o.stand_id
            where o.status = 'paid' and o.cancelled_at is null and ${canalO}
              and o.created_at between ${du}::timestamptz and ${au}::timestamptz
            group by s.id, s.nom
            order by "caCents" desc`
        : aucuneLigne,
    ]);

    return c.json({
      canal,
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
      // Null sous « Stands » : l'écran le dit, plutôt que d'afficher des zéros
      // qui laisseraient croire que chaque client du stand a acheté.
      paniers: canal === "stands" ? null : paniersDuSite(paniers[0]),
      lieux,
      parStand,
    });
  });
}

/** Les paniers du site, et la transformation qu'ils donnent. */
function paniersDuSite(ligne: Record<string, unknown> | undefined) {
  const abandonnes = Number(ligne?.paniers ?? 0);
  const enAttente = Number(ligne?.attente ?? 0);
  const payees = Number(ligne?.payees ?? 0);
  const commences = abandonnes + enAttente + payees;
  return {
    abandonnes,
    enAttente,
    perduCents: Number(ligne?.perduCents ?? 0),
    // Le taux de transformation : sur cent parcours commencés sur le site,
    // combien sont allés jusqu'au paiement. C'est le chiffre que Shopify
    // affiche en premier, et celui qui dit le plus sur la boutique.
    transformation: commences ? Math.round((payees / commences) * 100) : null,
  };
}
