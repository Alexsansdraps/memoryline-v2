/**
 * Les sources de la recherche qui grandissent sans fin : commandes, paniers
 * abandonnés, clientes, inscrits à la lettre, cartes cadeaux.
 *
 * Elles ne tiennent pas en mémoire comme le catalogue : on les cherche en
 * base, en deux temps.
 *
 *   1. Un PRÉFILTRE SQL choisit au plus 200 candidats par source. Il est
 *      volontairement large (voir recherche-sql.ts) : tout ce que le
 *      JavaScript garderait, il le garde.
 *   2. Les détails des candidats sont lus par lots, puis évalués en
 *      JavaScript, exactement comme le corpus : même aplatissement, mêmes
 *      rangs, mêmes extraits.
 *
 * À côté du texte, des CHEMINS À PART répondent à ce que le texte ne sait pas
 * lire : un numéro de commande tapé sans tiret (« web13 »), une facture, un
 * téléphone tapé avec ses espaces, un code de carte, une référence de suivi
 * ou de paiement. Ils imposent leur rang (exact, le plus souvent) et ne se
 * mélangent jamais au « contient » du texte : une référence de paiement n'a
 * rien à faire au milieu d'une recherche de mot.
 */
import { asc, eq, inArray, sql as raw } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  chiffresTelephone,
  compacter,
  evaluer,
  motsDe,
  type JetonRequete,
  type Requete,
} from "@memoryline/types/recherche";
import { db, schema } from "./db/client.js";
import { HORS_VENTES } from "./statuts-vente.js";
import { LIBELLE_FINANCIER, statutFinancier } from "./commandes.js";
import {
  ancienNumero,
  chiffres,
  conditionRequete,
  motif,
  motifNumeroCommande,
  motifsFacture,
  pertinence,
  plat,
} from "./recherche-sql.js";
import {
  NATURES_DES_SOURCES,
  cibleCodeCarte,
  ficheCarte,
  ficheClient,
  ficheCommande,
  ficheInscrit,
  fichePanier,
  versResultat,
  type AdresseClient,
  type ArticleCommande,
  type EnfantsCommande,
  type LivraisonClient,
  type Impose,
  type LigneCommande,
  type Trouvaille,
} from "./recherche-extraction.js";

/** Au plus 200 candidats par source : au-delà, le panneau dit « 200+ ». */
export const PLAFOND_CANDIDATS = 200;

export interface ResultatSource {
  trouvailles: Trouvaille[];
  /** La source a atteint son plafond : il y en a peut-être d'autres. */
  plafonne: boolean;
}

async function lignes<T>(requete: SQL): Promise<T[]> {
  return (await db.execute(requete)) as unknown as T[];
}

/** Garde, pour un même objet, le chemin à part qui le classe le mieux. */
function retenir(imposes: Map<number, Impose>, id: number, impose: Impose): void {
  const deja = imposes.get(id);
  if (!deja || impose.rang < deja.rang) imposes.set(id, impose);
}

function plafonner<T>(liste: T[]): { liste: T[]; plafonne: boolean } {
  return {
    liste: liste.slice(0, PLAFOND_CANDIDATS),
    plafonne: liste.length > PLAFOND_CANDIDATS,
  };
}

/**
 * Les chiffres d'un téléphone tapé, ou null si la saisie n'en est pas un :
 * quatre chiffres au moins, et rien d'autre que des chiffres, des espaces,
 * . - ( ) et +.
 */
function telephoneSaisi(saisie: string): string | null {
  if (!/^[\d\s.\-()+]+$/.test(saisie)) return null;
  const c = chiffresTelephone(saisie);
  return c.length >= 4 ? c : null;
}

/**
 * Les mots de la saisie qui peuvent tomber dans le champ NEUTRE des fiches
 * d'une source — ce qu'elles SONT (« cliente » dans « cliente mulhouse ») :
 * la base, qui ne voit pas ce champ, ne doit pas les exiger (voir
 * conditionRequete). Jugé par `evaluer` lui-même, sur le texte des natures :
 * exactement la règle du JavaScript, préfixes, singulier et fautes compris.
 */
function facultatifs(requete: Requete, natures: string): Set<JetonRequete> {
  const champ = [{ texte: natures, poids: 1 }];
  const sortie = new Set<JetonRequete>();
  for (const j of requete.jetons)
    if (evaluer(champ, { ...requete, plat: "", jetons: [j] })) sortie.add(j);
  return sortie;
}

/**
 * La saisie sans le mot qui dit ce qu'on cherche, pour les chemins des
 * numéros : « commande WEB-0013 », « facture F2026-0001 », « panier
 * WEB-0010 » se lisent comme le numéro seul.
 */
function sansMotDeNature(saisie: string): string {
  return saisie
    .trim()
    // Le mot doit être SUIVI d'une espace ou de deux-points : « Noël » ne
    // perd pas son « no ».
    .replace(
      /^(?:(?:la|le|ma|une?)\s+)?(?:(?:commandes?|ventes?(?:\s+de\s+stand)?|factures?|paniers?|cartes?(?:\s+cadeaux?)?|num[ée]ro|no\.?)(?:\s*:\s*|\s+)|n°\s*)/i,
      "",
    )
    .trim();
}

/* -------------------------------------------------------------------------- */
/*  Les documents du préfiltre                                                */
/* -------------------------------------------------------------------------- */

/*
 * Chaque candidat est réduit à UN texte aplati, ses champs mis bout à bout
 * avec une espace entre eux. C'est équivalent à chercher champ par champ —
 * un mot ne contient pas d'espace, il ne peut donc pas enjamber deux champs,
 * et le début d'un champ reste un début de mot — et c'est bien plus rapide :
 * le texte est aplati une fois par ligne, au lieu d'une fois par champ et par
 * mot tapé.
 *
 * Les colonnes JSON ne se lisent que par leurs chemins connus : les
 * étiquettes (un tableau de chaînes) et les textes d'une affiche
 * (texts.lines[*].value, texts.title.value, texts.subtitle.value). Jamais
 * `config::text`, qui ferait trouver les couleurs et les polices.
 */

/** Les titres des lignes et les textes écrits sur les affiches d'une commande. */
const TEXTES_DES_AFFICHES = raw`(select string_agg(concat_ws(' ', oi.title,
    (select string_agg(v #>> '{}', ' ') from jsonb_path_query(oi.config, '$.texts.lines[*].value') v),
    oi.config #>> '{texts,title,value}',
    oi.config #>> '{texts,subtitle,value}'), ' ')
  from order_item oi where oi.order_id = o.id)`;

function etiquettes(colonne: SQL): SQL {
  return raw`(select string_agg(t, ' ') from jsonb_array_elements_text(case when jsonb_typeof(${colonne}) = 'array' then ${colonne} else '[]'::jsonb end) t)`;
}

/*
 * Ce que la fiche d'une commande cherche sans que ce soit une colonne : le
 * statut, la date et le montant, écrits comme la liste les écrit. La base
 * doit en garder AU MOINS autant que le JavaScript (ficheCommande) : le
 * statut d'une commande payée porte donc aussi ceux d'un remboursement, que
 * seuls les mouvements départagent, et le montant ses deux écritures.
 */

/** Le statut, en mots (LIBELLE_FINANCIER, commandes.ts). */
const STATUT_COMMANDE = raw`(case o.status
  when 'cancelled' then 'annulée' when 'voided' then 'annulée' when 'draft' then 'panier'
  when 'paid' then 'payée remboursée en partie' when 'authorized' then 'autorisée'
  else 'en attente' end)`;

const MOIS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

/** « 06/10/2026 6 octobre 2026 », à l'heure de Paris, comme dateCherchable. */
const DATE_COMMANDE = raw`(to_char(o.created_at at time zone 'Europe/Paris', 'DD/MM/YYYY')
  || ' ' || extract(day from o.created_at at time zone 'Europe/Paris')::int
  || ' ' || (${`{${MOIS.join(",")}}`}::text[])[extract(month from o.created_at at time zone 'Europe/Paris')::int]
  || ' ' || extract(year from o.created_at at time zone 'Europe/Paris')::int)`;

/** « 49 90 » pour 49,90 € : les euros, puis les centimes. */
const MONTANT_COMMANDE = raw`((o.total_cents / 100)::text || ' ' || lpad((abs(o.total_cents) % 100)::text, 2, '0'))`;

/** Le transporteur du mode choisi (« colissimo »), lu par le slug que la commande a figé. */
const TRANSPORTEUR_DU_MODE = raw`(select sm.carrier from shipping_method sm where sm.slug = o.shipping_method limit 1)`;

const DOC_COMMANDE = raw`concat_ws(' ',
  o.number, o.invoice_number, o.legacy_name,
  o.shipping_name, o.shipping_line1, o.shipping_line2, o.shipping_postal_code,
  o.shipping_city, o.shipping_country, o.relay_point_label,
  o.shipping_label, o.shipping_description, ${TRANSPORTEUR_DU_MODE},
  o.internal_note, o.promo_code, o.cancel_reason,
  ${STATUT_COMMANDE}, ${DATE_COMMANDE}, ${MONTANT_COMMANDE},
  ${etiquettes(raw`o.tags`)},
  c.name, c.email, s.nom,
  ${TEXTES_DES_AFFICHES},
  (select string_agg(concat_ws(' ', e.message, e.author), ' ') from order_event e where e.order_id = o.id),
  (select string_agg(f.carrier, ' ') from fulfillment f where f.order_id = o.id),
  (select string_agg(b.methode_nom, ' ') from bordereau b where b.order_id = o.id),
  (select string_agg(concat_ws(' ', r.reason, r.note), ' ') from refund r where r.order_id = o.id))`;

/**
 * Un panier : son numéro seulement s'il en a un vrai (« WEB-0010 ») — un
 * « DRAFT- » et son uuid plein de chiffres répondrait à n'importe quel nombre.
 */
const DOC_PANIER = raw`concat_ws(' ',
  case when o.number not like 'DRAFT-%' then o.number end,
  c.name, c.email, o.shipping_name, o.shipping_city, o.shipping_postal_code,
  o.internal_note, ${TEXTES_DES_AFFICHES})`;

/**
 * Les paniers qu'on cherche : ceux qui disent À QUI ils sont — une cliente,
 * un nom de livraison ou une note. Un brouillon naît à chaque visite du
 * configurateur et n'est jamais purgé : sans cette borne, chaque frappe
 * aplatirait des milliers de paniers anonymes, que l'écran des paniers
 * abandonnés ne montre de toute façon pas (il exige une cliente joignable).
 */
const PANIERS_CHERCHES = raw`o.status = 'draft' and (o.customer_id is not null
  or o.shipping_name is not null or o.internal_note is not null)`;

/**
 * Les candidats d'après le texte, commandes ou paniers. `materialized` :
 * le document est calculé UNE fois par ligne, puis comparé à chaque mot.
 * Le stand n'est joint que pour son nom ; son code n'est jamais lu.
 */
async function candidatsCommandes(
  requete: Requete,
  paniers: boolean,
): Promise<{ ids: number[]; plafonne: boolean }> {
  if (!requete.jetons.length) return { ids: [], plafonne: false };
  const natures = facultatifs(requete, paniers ? NATURES_DES_SOURCES.paniers : NATURES_DES_SOURCES.commandes);
  const trouves = await lignes<{ id: number }>(raw`
    with docs as materialized (
      select o.id, o.created_at, ${plat(paniers ? DOC_PANIER : DOC_COMMANDE)} as doc
      from "order" o
      left join customer c on c.id = o.customer_id
      left join stand s on s.id = o.stand_id
      where ${paniers ? PANIERS_CHERCHES : raw`o.status <> 'draft'`}
    )
    select id from docs
    where ${conditionRequete([raw`doc`], requete.jetons, natures)}
    order by ${pertinence(raw`doc`, requete.plat)}, created_at desc, id desc
    limit ${PLAFOND_CANDIDATS + 1}`);
  const { liste, plafonne } = plafonner(trouves);
  return { ids: liste.map((l) => l.id), plafonne };
}

/* -------------------------------------------------------------------------- */
/*  Les chemins à part des commandes                                          */
/* -------------------------------------------------------------------------- */

/**
 * Les trois numéros d'une commande, en une requête :
 *   - le numéro (« WEB-0013 », « web13 », « 0013 », « 13 »), comparé en nombre ;
 *   - la facture (« F2026-0001 », « f2026 1 ») ;
 *   - l'ancien numéro Shopify (« #1042 »).
 * Les expressions régulières ne sont bâties que de chiffres validés
 * (recherche-sql.ts) : rien de ce qui est tapé n'y entre tel quel.
 */
async function parNumeros(compacte: string): Promise<
  { id: number; numero: boolean; facture: string | null; ancien: string | null }[]
> {
  const numero = motifNumeroCommande(compacte);
  const factures = motifsFacture(compacte);
  const ancien = ancienNumero(compacte);
  const conditions: SQL[] = [];
  const surNumero = numero ? raw`o.number ~ ${numero}` : raw`false`;
  const surFacture = factures.length
    ? raw`(o.invoice_number is not null and (${raw.join(
        factures.map((m) => raw`o.invoice_number ~ ${m}`),
        raw` or `,
      )}))`
    : raw`false`;
  const surAncien = ancien ? raw`o.legacy_name = ${ancien}` : raw`false`;
  if (numero) conditions.push(surNumero);
  if (factures.length) conditions.push(surFacture);
  if (ancien) conditions.push(surAncien);
  if (!conditions.length) return [];
  return lignes(raw`select o.id,
      (${surNumero}) as numero,
      case when ${surFacture} then o.invoice_number end as facture,
      case when ${surAncien} then o.legacy_name end as ancien
    from "order" o
    where o.status <> 'draft' and (${raw.join(conditions, raw` or `)})
    order by o.created_at desc limit ${PLAFOND_CANDIDATS}`);
}

/**
 * Les numéros d'un PANIER : un vrai numéro (« WEB-0010 », que l'écran des
 * paniers affiche, lu comme celui d'une commande), ou un numéro provisoire
 * collé depuis cet écran (« DRAFT-1a2b3c4d-… », quatre signes au moins après
 * le tiret). Sans la borne des paniers cherchés : un numéro collé désigne un
 * panier précis, quel qu'il soit.
 */
async function parNumerosPanier(
  compacte: string,
  saisie: string,
): Promise<{ id: number; number: string }[]> {
  const numero = motifNumeroCommande(compacte);
  const provisoire = /^draft-[0-9a-f-]{4,}$/i.test(saisie) ? saisie.toLowerCase() : null;
  if (!numero && !provisoire) return [];
  return lignes(raw`select o.id, o.number from "order" o
    where o.status = 'draft' and (${numero ? raw`o.number ~ ${numero}` : raw`false`}
      or ${provisoire ? raw`lower(o.number) like ${`${motif(provisoire)}%`} escape '\\'` : raw`false`})
    order by o.created_at desc limit ${PLAFOND_CANDIDATS}`);
}

async function parTelephoneCommande(
  chiffresTapes: string | null,
): Promise<{ id: number; telephone: string }[]> {
  if (!chiffresTapes) return [];
  return lignes(raw`select o.id, o.shipping_phone as telephone from "order" o
    where o.status <> 'draft'
      and ${chiffres(raw`o.shipping_phone`)} like ${`%${motif(chiffresTapes)}%`} escape '\\'
    order by o.created_at desc limit ${PLAFOND_CANDIDATS}`);
}

type GenreReference = "suivi" | "paiement" | "remboursement";

/**
 * Les références de suivi, de paiement et de remboursement : un seul mot
 * de six caractères au moins, trouvé par égalité ou par son DÉBUT. Jamais
 * au milieu : une référence de transaction est une suite de caractères sans
 * sens, et « contient » y trouverait n'importe quoi.
 */
async function parReference(
  saisie: string,
): Promise<{ id: number; ref: string; genre: GenreReference }[]> {
  const mot = saisie.trim();
  if (mot.length < 6 || /\s/.test(mot)) return [];
  return lignes(raw`select x.order_id as id, x.ref, x.genre from (
      select f.order_id, f.tracking_number as ref, 'suivi' as genre from fulfillment f
      union all select b.order_id, b.tracking_number, 'suivi' from bordereau b
      union all select p.order_id, p.external_ref, 'paiement' from payment p
      union all select p.order_id, p.capture_ref, 'paiement' from payment p
      union all select t.order_id, t.external_ref, 'paiement' from order_transaction t
      union all select r.order_id, r.external_ref, 'remboursement' from refund r
    ) x
    join "order" o on o.id = x.order_id
    where o.status <> 'draft' and x.ref is not null
      and lower(x.ref) like ${`${motif(mot.toLowerCase())}%`} escape '\\'
    limit ${PLAFOND_CANDIDATS}`);
}

const REFERENCES: Record<GenreReference, { libelle: string; ancre: string }> = {
  suivi: { libelle: "N° de suivi", ancre: "bordereau" },
  paiement: { libelle: "Référence de paiement", ancre: "mouvements" },
  remboursement: { libelle: "Remboursement", ancre: "remboursements" },
};

/* -------------------------------------------------------------------------- */
/*  Les détails, par lots                                                     */
/* -------------------------------------------------------------------------- */

/** Un tableau JSON, ou un tableau vide si la base a rendu autre chose. */
function tableau<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/**
 * Les commandes candidates et tout ce que leurs tables filles disent d'elles,
 * en UNE requête : les filles arrivent agrégées en JSON. Six requêtes en
 * parallèle se disputaient les dix connexions du pool avec les autres sources
 * de la même recherche ; une seule ne fait la queue derrière personne.
 *
 * Les sous-requêtes citent la ligne mère par son nom COMPLET, « "order"."id »,
 * et jamais par `${o.id}` : sur une requête à une seule table, Drizzle écrit
 * la colonne sans sa table (« "id" »), et la sous-requête la comprend alors
 * comme son propre id — les fiches clientes arrivaient ainsi sans carnet ni
 * commandes, sans la moindre erreur pour le signaler.
 */
async function detailsCommandes(
  ids: number[],
  paniers: boolean,
): Promise<{ commandes: LigneCommande[]; enfants: Map<number, EnfantsCommande> }> {
  const enfants = new Map<number, EnfantsCommande>();
  if (!ids.length) return { commandes: [], enfants };
  const o = schema.orders;
  // Un panier n'a ni journal, ni colis, ni remboursement à lire.
  const filles = (requete: SQL): SQL => (paniers ? raw`'[]'::json` : requete);
  const lignesLues = await db
    .select({
      id: o.id,
      number: o.number,
      channel: o.channel,
      status: o.status,
      totalCents: o.totalCents,
      createdAt: o.createdAt,
      archivedAt: o.archivedAt,
      invoiceNumber: o.invoiceNumber,
      legacyName: o.legacyName,
      shippingName: o.shippingName,
      shippingLine1: o.shippingLine1,
      shippingLine2: o.shippingLine2,
      shippingPostalCode: o.shippingPostalCode,
      shippingCity: o.shippingCity,
      shippingCountry: o.shippingCountry,
      relayPointLabel: o.relayPointLabel,
      internalNote: o.internalNote,
      tags: o.tags,
      promoCode: o.promoCode,
      cancelReason: o.cancelReason,
      shippingLabel: o.shippingLabel,
      shippingDescription: o.shippingDescription,
      transporteurDuMode: raw<string | null>`(select sm.carrier from shipping_method sm
        where sm.slug = "order"."shipping_method" limit 1)`,
      clientNom: schema.customers.name,
      clientEmail: schema.customers.email,
      // Le NOM du stand ; son code n'est pas dans la projection.
      standNom: schema.stands.nom,
      // Ce qui a été remboursé, pour écrire le statut comme la liste.
      rembourseCents: raw<number>`${paniers ? raw`0` : raw`(select coalesce(sum(r.amount_cents), 0)::int
        from refund r where r.order_id = "order"."id")`}`,
      auteurs: raw<unknown>`${filles(raw`coalesce((select json_agg(distinct e.author)
        from order_event e where e.order_id = "order"."id" and e.author is not null), '[]'::json)`)}`,
      // Les textes d'une affiche, par leurs seuls chemins connus.
      articles: raw<unknown>`coalesce((select json_agg(json_build_object(
          'title', oi.title,
          'quantity', oi.quantity,
          'lignes', jsonb_path_query_array(oi.config, '$.texts.lines[*].value'),
          'titreAffiche', oi.config #>> '{texts,title,value}',
          'sousTitreAffiche', oi.config #>> '{texts,subtitle,value}') order by oi.id)
        from order_item oi where oi.order_id = "order"."id"), '[]'::json)`,
      journal: raw<unknown>`${filles(raw`coalesce((select json_agg(e.message order by e.created_at, e.id)
        from order_event e where e.order_id = "order"."id"), '[]'::json)`)}`,
      transporteurs: raw<unknown>`${filles(raw`coalesce((select json_agg(x.t) from (
          select f.carrier as t from fulfillment f where f.order_id = "order"."id"
          union all select b.methode_nom from bordereau b where b.order_id = "order"."id") x
        where x.t is not null), '[]'::json)`)}`,
      remboursements: raw<unknown>`${filles(raw`coalesce((select json_agg(x.t) from (
          select r.reason as t from refund r where r.order_id = "order"."id"
          union all select r.note from refund r where r.order_id = "order"."id") x
        where x.t is not null), '[]'::json)`)}`,
    })
    .from(o)
    .leftJoin(schema.customers, eq(schema.customers.id, o.customerId))
    .leftJoin(schema.stands, eq(schema.stands.id, o.standId))
    .where(inArray(o.id, ids));

  const commandes: LigneCommande[] = [];
  const textes = (v: unknown): string[] =>
    tableau<unknown>(v).filter((m): m is string => typeof m === "string");
  for (const { articles, journal, transporteurs, remboursements, auteurs, rembourseCents, ...commande } of lignesLues) {
    commandes.push({
      ...commande,
      // Le statut comme la liste l'écrit (« Payée », « Remboursée en
      // partie »…) : déduit, jamais stocké (commandes.ts).
      statutLibelle: LIBELLE_FINANCIER[statutFinancier(commande, Number(rembourseCents) || 0)],
    });
    enfants.set(commande.id, {
      articles: tableau<Omit<ArticleCommande, "orderId">>(articles).map((a) => ({
        ...a,
        orderId: commande.id,
      })),
      journal: textes(journal),
      transporteurs: textes(transporteurs),
      remboursements: textes(remboursements),
      auteurs: textes(auteurs),
    });
  }
  // Les plus récentes d'abord, comme la liste des commandes.
  commandes.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id);
  return { commandes, enfants };
}

/* -------------------------------------------------------------------------- */
/*  Commandes et ventes de stand                                              */
/* -------------------------------------------------------------------------- */

/**
 * Les commandes du site et les ventes de stand, annulées comprises (on
 * cherche aussi pour comprendre une annulation). Les paniers sont à part.
 */
export async function chercherCommandes(requete: Requete): Promise<ResultatSource> {
  const compacte = compacter(sansMotDeNature(requete.saisie));
  const tel = telephoneSaisi(requete.saisie);
  const [texte, numeros, telephones, references] = await Promise.all([
    candidatsCommandes(requete, false),
    parNumeros(compacte),
    parTelephoneCommande(tel),
    parReference(requete.saisie),
  ]);

  const imposes = new Map<number, Impose>();
  const chemin = (id: number) => `/commandes/${id}`;
  for (const n of numeros) {
    if (n.numero)
      retenir(imposes, n.id, {
        rang: 0,
        libelle: "Numéro",
        cible: { chemin: chemin(n.id), trouver: false },
        titreEntier: true,
      });
    else if (n.facture)
      retenir(imposes, n.id, {
        rang: 0,
        libelle: "Facture",
        texte: n.facture,
        cible: { chemin: chemin(n.id), trouver: false },
      });
    else if (n.ancien)
      retenir(imposes, n.id, {
        rang: 0,
        libelle: "Ancien n° Shopify",
        texte: n.ancien,
        cible: { chemin: chemin(n.id), trouver: false },
      });
  }
  for (const t of telephones)
    retenir(imposes, t.id, {
      rang: tel && chiffresTelephone(t.telephone).startsWith(tel) ? 1 : 2,
      libelle: "Téléphone de livraison",
      texte: t.telephone,
      cible: { chemin: chemin(t.id), ancre: "adresse-livraison" },
      poids: 2,
    });
  for (const r of references) {
    const genre = REFERENCES[r.genre];
    retenir(imposes, r.id, {
      rang: r.ref.toLowerCase() === requete.saisie.trim().toLowerCase() ? 0 : 1,
      libelle: genre.libelle,
      texte: r.ref,
      cible: { chemin: chemin(r.id), ancre: genre.ancre },
      poids: 2,
    });
  }

  const ids = [...new Set([...texte.ids, ...imposes.keys()])];
  const { commandes, enfants } = await detailsCommandes(ids, false);
  const vides: EnfantsCommande = { articles: [], journal: [], transporteurs: [], remboursements: [] };
  const trouvailles: Trouvaille[] = [];
  commandes.forEach((c, ordre) => {
    const t = versResultat(ficheCommande(c, enfants.get(c.id) ?? vides, ordre), requete, imposes.get(c.id));
    if (t) trouvailles.push(t);
  });
  return { trouvailles, plafonne: texte.plafonne };
}

/**
 * Les paniers abandonnés : par le texte, et par leur numéro quand l'écran
 * des paniers en affiche un (« WEB-0010 », ou le « DRAFT-… » collé en entier).
 */
export async function chercherPaniers(requete: Requete): Promise<ResultatSource> {
  const saisie = sansMotDeNature(requete.saisie);
  const [texte, numeros] = await Promise.all([
    candidatsCommandes(requete, true),
    parNumerosPanier(compacter(saisie), saisie),
  ]);
  const imposes = new Map<number, Impose>();
  for (const n of numeros)
    retenir(imposes, n.id, {
      rang: 0,
      libelle: "Numéro",
      texte: n.number,
      cible: { chemin: `/commandes/${n.id}`, trouver: false },
    });
  const ids = [...new Set([...texte.ids, ...imposes.keys()])];
  const { commandes, enfants } = await detailsCommandes(ids, true);
  const trouvailles: Trouvaille[] = [];
  commandes.forEach((c, ordre) => {
    const t = versResultat(fichePanier(c, enfants.get(c.id)?.articles ?? [], ordre), requete, imposes.get(c.id));
    if (t) trouvailles.push(t);
  });
  return { trouvailles, plafonne: texte.plafonne };
}

/* -------------------------------------------------------------------------- */
/*  Clientes et inscrits                                                      */
/* -------------------------------------------------------------------------- */

const DOC_CLIENT = raw`concat_ws(' ',
  c.name, c.first_name, c.last_name, c.email, c.note,
  ${etiquettes(raw`c.tags`)},
  (select string_agg(concat_ws(' ', a.label, a.name, a.line1, a.line2, a.postal_code, a.city, a.country), ' ')
     from customer_address a where a.customer_id = c.id),
  (select string_agg(concat_ws(' ', o.shipping_city, o.shipping_postal_code), ' ')
     from "order" o where o.customer_id = c.id and o.status <> 'draft'))`;

export async function chercherClients(requete: Requete): Promise<ResultatSource> {
  const tel = telephoneSaisi(requete.saisie);
  const [texte, telephones, inscrits] = await Promise.all([
    requete.jetons.length
      ? lignes<{ id: number }>(raw`
          with docs as materialized (
            select c.id, c.name, ${plat(DOC_CLIENT)} as doc from customer c
          )
          select id from docs
          where ${conditionRequete([raw`doc`], requete.jetons, facultatifs(requete, NATURES_DES_SOURCES.clients))}
          order by ${pertinence(raw`doc`, requete.plat)}, name asc nulls last, id desc
          limit ${PLAFOND_CANDIDATS + 1}`)
      : Promise.resolve([] as { id: number }[]),
    tel
      ? lignes<{ id: number; telephone: string; carnet: boolean }>(raw`
          select c.id, c.phone as telephone, false as carnet from customer c
            where ${chiffres(raw`c.phone`)} like ${`%${motif(tel)}%`} escape '\\'
          union all
          select a.customer_id, a.phone, true from customer_address a
            where ${chiffres(raw`a.phone`)} like ${`%${motif(tel)}%`} escape '\\'
          limit ${PLAFOND_CANDIDATS}`)
      : Promise.resolve([] as { id: number; telephone: string; carnet: boolean }[]),
    requete.jetons.length
      ? db
          .select({ id: schema.newsletterSubscribers.id, email: schema.newsletterSubscribers.email })
          .from(schema.newsletterSubscribers)
          .where(
            conditionRequete(
              [plat(raw`${schema.newsletterSubscribers.email}`)],
              requete.jetons,
              facultatifs(requete, NATURES_DES_SOURCES.inscrits),
            ),
          )
          .orderBy(
            pertinence(plat(raw`${schema.newsletterSubscribers.email}`), requete.plat),
            asc(schema.newsletterSubscribers.email),
          )
          .limit(PLAFOND_CANDIDATS + 1)
      : Promise.resolve([] as { id: number; email: string }[]),
  ]);

  const imposes = new Map<number, Impose>();
  for (const t of telephones)
    retenir(imposes, t.id, {
      rang: tel && chiffresTelephone(t.telephone).startsWith(tel) ? 1 : 2,
      libelle: t.carnet ? "Carnet d'adresses" : "Téléphone",
      texte: t.telephone,
      cible: t.carnet
        ? { chemin: `/clients/${t.id}`, ancre: "carnet-adresses" }
        : { chemin: `/clients/${t.id}`, ancre: "coordonnees", champ: "phone" },
      poids: 2,
    });

  const candidats = plafonner(texte);
  const ids = [...new Set([...candidats.liste.map((l) => l.id), ...imposes.keys()])];
  const trouvailles: Trouvaille[] = [];
  if (ids.length) {
    const c = schema.customers;
    // Une requête : la fiche, son carnet, les villes de ses commandes et ses
    // totaux arrivent ensemble (voir detailsCommandes pour le pourquoi).
    const clients = await db
      .select({
        id: c.id,
        name: c.name,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        note: c.note,
        tags: c.tags,
        adresses: raw<unknown>`coalesce((select json_agg(json_build_object(
            'label', a.label, 'name', a.name, 'line1', a.line1, 'line2', a.line2,
            'postalCode', a.postal_code, 'city', a.city, 'country', a.country) order by a.id)
          from customer_address a where a.customer_id = "customer"."id"), '[]'::json)`,
        livraisons: raw<unknown>`coalesce((select json_agg(json_build_object(
            'orderId', o.id, 'number', o.number,
            'shippingCity', o.shipping_city, 'shippingPostalCode', o.shipping_postal_code)
            order by o.created_at desc, o.id desc)
          from "order" o where o.customer_id = "customer"."id" and o.status <> 'draft'), '[]'::json)`,
        // Ce qui compte comme une vente est défini une seule fois, dans
        // statuts-vente.ts : un panier abandonné n'est pas une commande.
        commandes: raw<number>`(select count(*)::int from "order" o
          where o.customer_id = "customer"."id" and not (o.status = any(${`{${HORS_VENTES.join(",")}}`}::text[])))`,
        totalCents: raw<number>`(select coalesce(sum(o.total_cents), 0)::int from "order" o
          where o.customer_id = "customer"."id" and not (o.status = any(${`{${HORS_VENTES.join(",")}}`}::text[])))`,
      })
      .from(c)
      .where(inArray(c.id, ids));
    const tries = [...clients].sort(
      (a, b) =>
        (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? "", "fr", {
          sensitivity: "base",
        }) || b.id - a.id,
    );
    tries.forEach(({ adresses, livraisons, ...client }, ordre) => {
      const fiche = ficheClient(
        client,
        tableau<Omit<AdresseClient, "customerId">>(adresses).map((a) => ({
          ...a,
          customerId: client.id,
        })),
        tableau<Omit<LivraisonClient, "customerId">>(livraisons).map((l) => ({
          ...l,
          customerId: client.id,
        })),
        ordre,
      );
      const t = versResultat(fiche, requete, imposes.get(client.id));
      if (t) trouvailles.push(t);
    });
  }

  const listeInscrits = plafonner(inscrits);
  listeInscrits.liste.forEach((i, ordre) => {
    const t = versResultat(ficheInscrit(i, ordre), requete);
    if (t) trouvailles.push(t);
  });
  return { trouvailles, plafonne: candidats.plafonne || listeInscrits.plafonne };
}

/* -------------------------------------------------------------------------- */
/*  Cartes cadeaux                                                            */
/* -------------------------------------------------------------------------- */

const DOC_CARTE = raw`concat_ws(' ', g.code, g.note, c.name,
  (select string_agg(t.label, ' ') from gift_card_transaction t where t.gift_card_id = g.id))`;

/**
 * Les cartes cadeaux : par leur code d'abord, tapé avec ou sans tirets
 * (« ACEF-HJKL » se lit « ACEFHJKL » au téléphone), puis par le texte — la
 * note, l'historique, le nom de la cliente.
 */
export async function chercherCartes(requete: Requete): Promise<ResultatSource> {
  const compacte = compacter(sansMotDeNature(requete.saisie));
  // Deux caractères : seulement en début de code. Au milieu, il en faut
  // trois — deux lettres se trouvent dans presque n'importe quel code.
  const motifCode =
    compacte.length >= 3
      ? `%${motif(compacte)}%`
      : compacte.length === 2
        ? `${motif(compacte)}%`
        : null;
  const [texte, codes] = await Promise.all([
    requete.jetons.length
      ? lignes<{ id: number }>(raw`
          with docs as materialized (
            select g.id, g.created_at, ${plat(DOC_CARTE)} as doc
            from gift_card g left join customer c on c.id = g.customer_id
          )
          select id from docs
          where ${conditionRequete([raw`doc`], requete.jetons, facultatifs(requete, NATURES_DES_SOURCES.cartes))}
          order by ${pertinence(raw`doc`, requete.plat)}, created_at desc, id desc
          limit ${PLAFOND_CANDIDATS + 1}`)
      : Promise.resolve([] as { id: number }[]),
    motifCode
      ? lignes<{ id: number; code: string }>(raw`select g.id, g.code from gift_card g
          where replace(upper(g.code), '-', '') like ${motifCode} escape '\\'
          order by g.created_at desc limit ${PLAFOND_CANDIDATS}`)
      : Promise.resolve([] as { id: number; code: string }[]),
  ]);

  const imposes = new Map<number, Impose>();
  for (const c of codes)
    retenir(imposes, c.id, {
      rang: c.code.toUpperCase().replace(/-/g, "").startsWith(compacte) ? 1 : 2,
      libelle: null,
      cible: cibleCodeCarte(c),
      titreEntier: true,
      poids: 2,
    });

  const candidats = plafonner(texte);
  const ids = [...new Set([...candidats.liste.map((l) => l.id), ...imposes.keys()])];
  if (!ids.length) return { trouvailles: [], plafonne: false };
  const g = schema.giftCards;
  const cartes = await db
    .select({
      id: g.id,
      code: g.code,
      balanceCents: g.balanceCents,
      status: g.status,
      expiresAt: g.expiresAt,
      note: g.note,
      createdAt: g.createdAt,
      clientNom: schema.customers.name,
      historique: raw<unknown>`coalesce((select json_agg(t.label order by t.created_at, t.id)
        from gift_card_transaction t where t.gift_card_id = "gift_card"."id" and t.label is not null), '[]'::json)`,
    })
    .from(g)
    .leftJoin(schema.customers, eq(schema.customers.id, g.customerId))
    .where(inArray(g.id, ids));
  const maintenant = new Date();
  const trouvailles: Trouvaille[] = [];
  cartes
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id)
    .forEach(({ historique, ...carte }, ordre) => {
      const fiche = ficheCarte(
        {
          ...carte,
          historique: tableau<unknown>(historique).filter((h): h is string => typeof h === "string"),
        },
        ordre,
        maintenant,
      );
      const t = versResultat(fiche, requete, imposes.get(carte.id));
      if (t) trouvailles.push(t);
    });
  return { trouvailles, plafonne: candidats.plafonne };
}

/* -------------------------------------------------------------------------- */
/*  Le vocabulaire des sources directes                                       */
/* -------------------------------------------------------------------------- */

/** Cinq minutes, comme le corpus : une nouvelle cliente se corrige vite. */
const DUREE_VOCABULAIRE = 5 * 60 * 1000;
let vocabulaire: { mots: Map<string, number>; le: number } | null = null;
let lectureVocabulaire: Promise<Map<string, number>> | null = null;

/**
 * Les mots connus des commandes et des clientes : noms, villes, titres
 * d'articles, notes et journaux, avec le nombre de textes où chacun figure.
 * Sans eux, un nom de famille tapé juste — mais absent du catalogue —
 * passerait pour une faute de frappe, et la recherche proposerait « Dupond »
 * à qui cherche « Dupont ».
 */
export function vocabulaireDirect(): Promise<Map<string, number>> {
  if (vocabulaire && Date.now() - vocabulaire.le < DUREE_VOCABULAIRE)
    return Promise.resolve(vocabulaire.mots);
  if (lectureVocabulaire) return lectureVocabulaire;
  lectureVocabulaire = lignes<{ v: string }>(raw`
      select distinct v from (
        select name as v from customer
        union all select first_name from customer
        union all select last_name from customer
        union all select email from customer
        union all select note from customer
        union all select shipping_name from "order"
        union all select shipping_city from "order"
        union all select shipping_line1 from "order"
        union all select relay_point_label from "order"
        union all select internal_note from "order"
        union all select shipping_label from "order"
        union all select city from customer_address
        union all select title from order_item
        union all select message from order_event
        union all select note from gift_card
      ) x
      where v is not null`)
    .then((valeurs) => {
      const mots = new Map<string, number>();
      // Les statuts et les mois que les fiches des commandes cherchent
      // (ficheCommande) : « annulée » ou « octobre » ne sont pas des fautes.
      const fixes = [...Object.values(LIBELLE_FINANCIER), ...MOIS].map((v) => ({ v }));
      for (const { v } of [...valeurs, ...fixes])
        for (const m of motsDe(v)) mots.set(m, (mots.get(m) ?? 0) + 1);
      vocabulaire = { mots, le: Date.now() };
      return mots;
    })
    .finally(() => {
      lectureVocabulaire = null;
    });
  return lectureVocabulaire;
}
