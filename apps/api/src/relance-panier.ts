/**
 * Relance des paniers abandonnés — la mécanique de Shopify, à l'identique.
 *
 * Un panier n'est PAS une table à part dans ce schéma : c'est une commande
 * `order` qui n'a pas encore été payée. Tant qu'elle est en `draft`, personne
 * ne sait à qui elle appartient ; c'est le passage au tunnel (POST /orders)
 * qui y attache un client, donc une adresse e-mail. C'est exactement la règle
 * de Shopify, qui ne classe « abandonné » qu'un CHECKOUT abandonné, jamais un
 * panier anonyme : sans adresse, il n'y a personne à relancer.
 *
 * Trois critères stricts font l'abandon (voir `paniersAbandonnes`) :
 *   1. une adresse e-mail joignable ;
 *   2. le tunnel n'a pas abouti (ni payée, ni annulée, ni remboursée) ;
 *   3. plus rien n'a bougé depuis le délai plancher (10 min par défaut).
 *
 * Deux horloges, et il ne faut jamais les confondre. Celle de L'AFFICHAGE :
 * dès le délai plancher, le panier apparaît au back-office. Celle de L'ENVOI :
 * le palier réglé par la marchande (1 h, 6 h, 10 h par défaut, 24 h). Un
 * panier peut donc être visible longtemps avant qu'un courrier ne parte.
 *
 * Et une limite qui ne se discute pas : passé QUATORZE JOURS, plus aucun
 * envoi. Shopify purge à ce terme, et un rappel qui arrive deux semaines plus
 * tard ne rend service à personne — il rappelle surtout qu'on garde des
 * traces.
 */
import { randomBytes } from "node:crypto";
import type { Hono } from "hono";
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { db, schema } from "./db/client.js";
import {
  courrierPanierAbandonne,
  envoyer,
  estConfigure as courrierConfigure,
  type LigneCourrier,
} from "./mail.js";

/* -------------------------------------------------------------------------- */
/*  Constantes de la mécanique                                                */
/* -------------------------------------------------------------------------- */

/**
 * L'adresse publique du site. Le repli sur localhost:8080 est celui de la
 * lettre d'information : un lien de courrier ne peut pas être relatif, et un
 * lien absent est pire qu'un lien de développement.
 */
const ORIGINE =
  (process.env.PUBLIC_ORIGIN ?? "").replace(/\/+$/, "") || "http://localhost:8080";

/** La page publique qui remet le panier dans le navigateur. */
const LIEN_RECUPERATION = `${ORIGINE}/panier/recuperer`;

/**
 * La page de désinscription. Elle passe par « /api » : le proxy y envoie
 * l'API, qui la sert elle-même — la boutique n'a pas à connaître ce chemin.
 */
const LIEN_DESINSCRIPTION = `${ORIGINE}/api/relance/desabonnement`;

/** Les quatre paliers d'envoi proposés par Shopify, en heures. */
export const PALIERS_ENVOI = [1, 6, 10, 24] as const;
export type PalierEnvoi = (typeof PALIERS_ENVOI)[number];

/**
 * Le délai plancher d'affichage, en minutes. Shopify n'attend jamais moins de
 * dix minutes ni plus de quinze : en deçà, on déclare abandonné un client qui
 * remplit encore son adresse.
 */
const PLANCHER_MIN = 10;
const PLANCHER_MAX = 15;

/** Quatorze jours. Au-delà, plus aucune relance, jamais. */
export const FENETRE_HEURES = 336;

/**
 * Les statuts qui ferment définitivement la question : la commande a abouti,
 * ou elle est morte. « voided » vient de l'historique importé, il compte comme
 * une annulation.
 */
const STATUTS_CLOS: string[] = ["paid", "cancelled", "refunded", "voided"];

/** Toutes les cinq minutes. Assez fin pour un palier d'une heure. */
const PERIODE_PASSAGE_MS = 5 * 60_000;

/* -------------------------------------------------------------------------- */
/*  Les réglages, tenus dans le back-office                                   */
/* -------------------------------------------------------------------------- */

/**
 * Ce que la marchande règle elle-même. Rien de tout cela ne se décide dans le
 * code : c'est sa boutique, son rythme, et sa responsabilité juridique.
 */
export interface ReglagesRelance {
  /** Le travailleur envoie-t-il tout seul ? Faux = relance manuelle seulement. */
  active: boolean;
  /** Le palier d'envoi, en heures d'inactivité. */
  palierHeures: PalierEnvoi;
  /** Le délai plancher d'affichage, en minutes (10 à 15). */
  plancherMinutes: number;
  /**
   * La base légale de l'envoi.
   *
   * « consentement » : on n'écrit qu'aux gens qui ont coché la case marketing.
   * « interet_legitime » : on écrit à qui a laissé une commande en cours, ce
   * que le RGPD autorise pour une relance liée à un achat entamé — mais le
   * lien de désinscription devient alors OBLIGATOIRE dans le courrier.
   */
  baseLegale: "consentement" | "interet_legitime";
}

const REGLAGES_DEFAUT: ReglagesRelance = {
  active: false,
  palierHeures: 10,
  plancherMinutes: 10,
  baseLegale: "consentement",
};

/**
 * Les clés dans la table `setting`. Le préfixe « relance. » les regroupe et
 * les tient hors du `/settings` public : ces réglages sont ceux de la
 * boutique, la vitrine n'a rien à en savoir.
 */
const CLES = {
  active: "relance.active",
  palier: "relance.palier_heures",
  plancher: "relance.plancher_minutes",
  baseLegale: "relance.base_legale",
} as const;

/** Le groupe sous lequel le back-office range ces réglages. */
const GROUPE = "relance";

function nombreOuDefaut(v: unknown, defaut: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : defaut;
}

/** Ramène un palier saisi n'importe comment à l'un des quatre proposés. */
function palierValide(v: unknown): PalierEnvoi {
  const n = nombreOuDefaut(v, REGLAGES_DEFAUT.palierHeures);
  return (PALIERS_ENVOI as readonly number[]).includes(n)
    ? (n as PalierEnvoi)
    : REGLAGES_DEFAUT.palierHeures;
}

/** Borne le plancher entre dix et quinze minutes. */
function plancherValide(v: unknown): number {
  const n = Math.round(nombreOuDefaut(v, REGLAGES_DEFAUT.plancherMinutes));
  return Math.min(PLANCHER_MAX, Math.max(PLANCHER_MIN, n));
}

/**
 * Les réglages tels qu'ils sont enregistrés, complétés par les valeurs par
 * défaut. Une clé absente n'est pas une panne : c'est une boutique qui n'a pas
 * encore touché à ce réglage.
 */
export async function lireReglages(): Promise<ReglagesRelance> {
  const lignes = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.group, GROUPE));
  const valeurs = new Map(lignes.map((l) => [l.key, l.value]));
  return {
    active: valeurs.get(CLES.active) === true,
    palierHeures: palierValide(valeurs.get(CLES.palier)),
    plancherMinutes: plancherValide(valeurs.get(CLES.plancher)),
    baseLegale:
      valeurs.get(CLES.baseLegale) === "interet_legitime"
        ? "interet_legitime"
        : "consentement",
  };
}

/** Enregistre les réglages, en les bornant à ce qui a un sens. */
async function ecrireReglages(brut: Record<string, unknown>): Promise<ReglagesRelance> {
  const actuels = await lireReglages();
  const suivants: ReglagesRelance = {
    active:
      brut.active === undefined ? actuels.active : Boolean(brut.active),
    palierHeures:
      brut.palierHeures === undefined
        ? actuels.palierHeures
        : palierValide(brut.palierHeures),
    plancherMinutes:
      brut.plancherMinutes === undefined
        ? actuels.plancherMinutes
        : plancherValide(brut.plancherMinutes),
    baseLegale:
      brut.baseLegale === "interet_legitime"
        ? "interet_legitime"
        : brut.baseLegale === "consentement"
          ? "consentement"
          : actuels.baseLegale,
  };

  const aEcrire: { key: string; value: unknown; label: string }[] = [
    { key: CLES.active, value: suivants.active, label: "Relance automatique" },
    { key: CLES.palier, value: suivants.palierHeures, label: "Palier d'envoi (heures)" },
    {
      key: CLES.plancher,
      value: suivants.plancherMinutes,
      label: "Délai d'affichage (minutes)",
    },
    { key: CLES.baseLegale, value: suivants.baseLegale, label: "Base légale" },
  ];
  for (const r of aEcrire) {
    await db
      .insert(schema.settings)
      .values({
        key: r.key,
        value: r.value as never,
        label: r.label,
        group: GROUPE,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: {
          value: r.value as never,
          label: r.label,
          group: GROUPE,
          updatedAt: new Date(),
        },
      });
  }
  return suivants;
}

/* -------------------------------------------------------------------------- */
/*  Le classement « abandonné » — les trois critères stricts                   */
/* -------------------------------------------------------------------------- */

/** Un panier abandonné, tel que le back-office et le travailleur le voient. */
export interface PanierAbandonne {
  id: number;
  number: string;
  clientOrderId: string | null;
  totalCents: number;
  promoCode: string | null;
  createdAt: Date;
  /** L'horloge d'inactivité : `lastActivityAt`, ou `createdAt` à défaut. */
  derniereActivite: Date;
  relanceAt: Date | null;
  recupereLe: Date | null;
  motifRenoncement: string | null;
  renoncementLe: Date | null;
  recoveryToken: string | null;
  customerId: number | null;
  nom: string | null;
  email: string;
  accepteMarketing: boolean;
}

/**
 * L'horloge d'inactivité, en SQL.
 *
 * `lastActivityAt` est nulle pour tous les paniers créés avant qu'on la tienne
 * à jour : on retombe alors sur la date de création, qui les rend simplement
 * plus vieux qu'ils ne sont — jamais plus jeunes. C'est le bon sens de l'erreur.
 */
const HORLOGE = sql<Date>`coalesce(${schema.orders.lastActivityAt}, ${schema.orders.createdAt})`;

/**
 * « ce panier ne bouge plus depuis avant telle heure », en SQL.
 *
 * La date part en TEXTE puis se fait convertir par Postgres, avec le fuseau
 * écrit dedans. Dans un fragment SQL brut, le pilote ne sait pas quelle
 * colonne on compare, donc pas comment sérialiser un objet Date : il refuse et
 * la requête tombe en erreur. L'ISO 8601 lève l'ambiguïté sans rien perdre.
 */
function immobileDepuis(seuil: Date) {
  return sql`${HORLOGE} < ${seuil.toISOString()}::timestamptz`;
}

/**
 * Les paniers abandonnés, du plus récent au plus ancien.
 *
 * Les trois critères stricts, et rien d'autre :
 *
 *   1. **Une adresse joignable.** La commande porte un client, et ce client a
 *      un e-mail. C'est le tunnel qui l'attache : un panier resté en `draft`
 *      n'en a pas, et n'apparaît donc pas — comme chez Shopify, où seul un
 *      checkout entamé peut être abandonné.
 *   2. **Le tunnel n'a pas abouti.** Ni payée, ni annulée, ni remboursée. On
 *      écarte aussi le stand : une commande y est prise en présence du client,
 *      il n'y a rien à relancer. Et une commande dont un paiement est arrivé
 *      sans pouvoir la valider — son montant ne correspondait plus au panier
 *      (markOrderPaid, configurator-routes.ts) — n'est pas abandonnée non
 *      plus : la cliente a payé, c'est à la boutique de régulariser, et lui
 *      écrire que son panier l'attend l'inviterait à payer une seconde fois.
 *   3. **Plus rien ne bouge depuis le délai plancher.**
 */
export async function paniersAbandonnes(
  plancherMinutes: number,
  limite = 200,
): Promise<PanierAbandonne[]> {
  return requetePaniers(plancherMinutes, limite, null);
}

/**
 * UN panier abandonné, désigné par son identifiant, ou `null` s'il n'en est
 * pas (ou plus) un.
 *
 * Aucun délai plancher : la relance manuelle doit pouvoir partir tout de
 * suite, puisque la liste vient précisément de montrer ce panier-là. Les trois
 * autres critères, eux, tiennent toujours.
 */
async function panierAbandonne(orderId: number): Promise<PanierAbandonne | null> {
  const [p] = await requetePaniers(0, 1, orderId);
  return p ?? null;
}

/** La requête commune aux deux, pour n'avoir qu'une définition de l'abandon. */
async function requetePaniers(
  plancherMinutes: number,
  limite: number,
  orderId: number | null,
): Promise<PanierAbandonne[]> {
  const seuil = new Date(Date.now() - plancherMinutes * 60_000);
  const lignes = await db
    .select({
      id: schema.orders.id,
      number: schema.orders.number,
      clientOrderId: schema.orders.clientOrderId,
      totalCents: schema.orders.totalCents,
      promoCode: schema.orders.promoCode,
      createdAt: schema.orders.createdAt,
      lastActivityAt: schema.orders.lastActivityAt,
      relanceAt: schema.orders.reminderSentAt,
      recupereLe: schema.orders.recoveredAt,
      motifRenoncement: schema.orders.recoveryDeclinedReason,
      renoncementLe: schema.orders.recoveryDeclinedAt,
      recoveryToken: schema.orders.recoveryToken,
      customerId: schema.orders.customerId,
      nom: schema.customers.name,
      email: schema.customers.email,
      accepteMarketing: schema.customers.acceptsMarketing,
    })
    .from(schema.orders)
    .innerJoin(schema.customers, eq(schema.orders.customerId, schema.customers.id))
    .where(
      and(
        eq(schema.orders.channel, "web"),
        notInArray(schema.orders.status, STATUTS_CLOS),
        sql`not exists (select 1 from ${schema.payments} where ${schema.payments.orderId} = ${schema.orders.id} and ${schema.payments.status} = 'montant_different')`,
        isNotNull(schema.customers.email),
        ne(schema.customers.email, ""),
        immobileDepuis(seuil),
        ...(orderId === null ? [] : [eq(schema.orders.id, orderId)]),
      ),
    )
    .orderBy(desc(HORLOGE))
    .limit(limite);

  return lignes.map((l) => ({
    ...l,
    email: l.email ?? "",
    derniereActivite: l.lastActivityAt ?? l.createdAt,
  }));
}

/** Depuis combien d'heures ce panier ne bouge plus. */
function heuresDInactivite(p: PanierAbandonne): number {
  return (Date.now() - p.derniereActivite.getTime()) / 3600_000;
}

/* -------------------------------------------------------------------------- */
/*  Les cinq gardes-fous                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Pourquoi on renonce. Un code POUR LE CODE, une phrase POUR LA BOUTIQUE :
 * décider d'après la phrase reviendrait à comparer des chaînes françaises, et
 * la première reformulation casserait silencieusement un garde-fou.
 */
type MotifRefus =
  | "fenetre"
  | "deja_relance"
  | "achat_croise"
  | "refus"
  | "pas_de_consentement"
  | "indisponible"
  | "vide";

/**
 * Les seuls motifs qu'un geste de la boutique peut passer outre : avoir déjà
 * relancé, et l'absence de consentement marketing (la marchande assume alors
 * l'envoi, un par un, ce qui n'est pas la même chose qu'un automate).
 *
 * Les autres tiennent même à la main. Relancer quelqu'un qui vient d'acheter,
 * insister auprès de qui a demandé qu'on le laisse tranquille, ou vanter une
 * affiche qu'on ne sait plus produire : aucun bouton ne doit permettre ça.
 */
const MOTIFS_FORCABLES: MotifRefus[] = ["deja_relance", "pas_de_consentement"];

/**
 * Ce que la vérification décide. Un refus porte toujours une phrase : c'est
 * elle que la boutique lit dans la liste, et elle doit se comprendre sans
 * connaître le code.
 */
type Verdict =
  | { envoyer: true; lignes: LigneCourrier[] }
  | { envoyer: false; code: MotifRefus; motif: string };

/**
 * Les vignettes des produits, en adresse absolue et publique.
 *
 * Les images sont servies par l'API sous « /assets/… », derrière le préfixe
 * « /api » du proxy. Une messagerie ne sait pas résoudre un chemin relatif :
 * sans adresse complète, le client verrait des cadres vides.
 */
export async function vignettesDesProduits(
  productIds: (number | null)[],
): Promise<Map<number, string>> {
  const ids = [...new Set(productIds.filter((v): v is number => v != null))];
  if (!ids.length) return new Map();
  const images = await db
    .select({
      productId: schema.productImages.productId,
      url: schema.productImages.url,
      position: schema.productImages.position,
    })
    .from(schema.productImages)
    .where(inArray(schema.productImages.productId, ids));
  const par = new Map<number, string>();
  // La première image de la fiche : c'est celle que la boutique montre, donc
  // celle que le client reconnaîtra.
  for (const img of images.sort((a, b) => a.position - b.position)) {
    if (par.has(img.productId)) continue;
    const url = /^https?:\/\//i.test(img.url) ? img.url : `${ORIGINE}/api${img.url}`;
    par.set(img.productId, url);
  }
  return par;
}

/**
 * Le panier tel qu'il partira dans le courrier, article par article, et ce
 * qui n'est plus disponible.
 *
 * La disponibilité se lit à deux endroits. Le PRODUIT d'abord : effacé du
 * catalogue (la ligne garde alors son titre mais plus de `productId`) ou
 * retiré de la vente, il n'y a plus rien à commander. La VARIANTE ensuite :
 * le stock du format choisi, quand il est suivi.
 *
 * La variante ne se lit pas dans `variantId`, vide sur toutes les lignes de
 * cette base — aucun chemin d'ajout au panier ne le remplit. On la retrouve
 * par le couple (produit, format), qui est justement ce qui identifie une
 * variante ici. Sans ça, le garde-fou du stock ne se serait jamais déclenché.
 */
async function composerLignes(orderId: number): Promise<{
  lignes: LigneCourrier[];
  indisponibles: number;
}> {
  const articles = await db
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, orderId));
  const cadres = await db.select().from(schema.frames);
  const ids = [...new Set(articles.map((a) => a.productId).filter((v): v is number => v != null))];
  const produits = ids.length
    ? await db.select().from(schema.products).where(inArray(schema.products.id, ids))
    : [];
  const variantes = ids.length
    ? await db.select().from(schema.variants).where(inArray(schema.variants.productId, ids))
    : [];
  const vignettes = await vignettesDesProduits(ids);

  let indisponibles = 0;
  const lignes: LigneCourrier[] = articles.map((it) => {
    const cfg = (it.config ?? {}) as Record<string, unknown>;
    const format = typeof cfg.format === "string" ? cfg.format : "A4";
    const cadre = cadres.find((f) => String(f.id) === String(cfg.frameId ?? ""));
    const produit = it.productId != null ? produits.find((p) => p.id === it.productId) : null;
    const variante =
      it.variantId != null
        ? variantes.find((v) => v.id === it.variantId)
        : variantes.find((v) => v.productId === it.productId && v.format === format);

    // Une ligne sans `productId` ne se juge pas : on ne sait pas distinguer le
    // produit effacé de celui qui n'a jamais été renseigné. On la laisse
    // passer plutôt que d'annuler un envoi sur un doute.
    const produitPerdu = it.productId != null && !produit;
    const produitRetire = produit != null && produit.status !== "active";
    const stockEpuise =
      variante != null &&
      variante.stockQty != null &&
      variante.stockQty <= 0 &&
      variante.stockPolicy === "deny";
    const indisponible = produitPerdu || produitRetire || stockEpuise;
    if (indisponible) indisponibles += 1;

    return {
      titre: it.title ?? "Affiche personnalisée",
      format,
      cadre: cadre?.name ?? null,
      quantite: it.quantity,
      unitPriceCents: it.unitPriceCents,
      imageUrl: it.productId != null ? (vignettes.get(it.productId) ?? null) : null,
      indisponible,
    };
  });
  return { lignes, indisponibles };
}

/**
 * A-t-on déjà été payé par cette personne depuis qu'elle a laissé ce panier ?
 *
 * « Finalisée » ne veut pas dire `status = 'paid'` : une commande prise au
 * STAND naît « pending » et le reste toute sa vie, la vendeuse ayant encaissé
 * de la main à la main. Elle compte donc autant qu'un paiement en ligne — la
 * personne a acheté, on ne la relance pas.
 *
 * La comparaison se fait sur l'ADRESSE, pas sur la fiche : cette base accepte
 * plusieurs fiches pour une même adresse, et se limiter au `customerId` du
 * panier laisserait passer l'achat fait depuis une autre fiche.
 */
async function achatCroise(panier: PanierAbandonne): Promise<boolean> {
  const [ligne] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.orders)
    .innerJoin(schema.customers, eq(schema.orders.customerId, schema.customers.id))
    .where(
      and(
        sql`lower(coalesce(${schema.customers.email}, '')) = ${panier.email.toLowerCase()}`,
        ne(schema.orders.id, panier.id),
        // Même précaution que pour l'horloge : la date passe en ISO 8601, que
        // Postgres convertit lui-même.
        sql`${schema.orders.createdAt} > ${panier.createdAt.toISOString()}::timestamptz`,
        or(eq(schema.orders.status, "paid"), eq(schema.orders.channel, "salon")),
      ),
    );
  return Number(ligne?.n ?? 0) > 0;
}

/** Cette adresse a-t-elle refusé qu'on lui rappelle ses paniers ? */
async function aRefuse(email: string): Promise<boolean> {
  const [ligne] = await db
    .select({ refuseLe: schema.relanceRefus.refuseLe })
    .from(schema.relanceRefus)
    .where(sql`lower(${schema.relanceRefus.email}) = ${email.toLowerCase()}`)
    .limit(1);
  return Boolean(ligne?.refuseLe);
}

/**
 * Les cinq gardes-fous, vérifiés JUSTE AVANT l'envoi et jamais avant.
 *
 * L'ordre n'est pas indifférent : on écarte d'abord ce qui interdit l'envoi
 * pour toujours (la fenêtre, l'unicité), puis ce qui dépend du monde
 * extérieur (l'achat croisé, le consentement, le stock). Les vérifications
 * coûteuses ne tournent donc que sur les paniers qui ont une chance de partir.
 */
async function verifierGardesFous(
  panier: PanierAbandonne,
  reglages: ReglagesRelance,
  /**
   * Les motifs à ne pas examiner. Sert au forçage : la propriétaire a le
   * droit de passer outre l'unicité et le consentement, et rien d'autre.
   * Comme la vérification s'arrête au premier refus, sauter un motif à
   * l'appelant reviendrait à sauter aussi tous ceux qui viennent après.
   */
  sauter: readonly MotifRefus[] = [],
): Promise<Verdict> {
  // 5. La fenêtre de quatorze jours. En premier parce qu'elle est définitive.
  if (heuresDInactivite(panier) > FENETRE_HEURES)
    return {
      envoyer: false,
      code: "fenetre",
      motif: "Panier de plus de 14 jours : plus aucune relance.",
    };

  // 2. Unicité : le drapeau, jamais une heuristique.
  if (panier.relanceAt && !sauter.includes("deja_relance"))
    return { envoyer: false, code: "deja_relance", motif: "Déjà relancé une fois." };

  // 1. Achat croisé.
  if (await achatCroise(panier))
    return {
      envoyer: false,
      code: "achat_croise",
      motif: "Cette personne a commandé depuis, avec la même adresse.",
    };

  // 3. Consentement. Le refus explicite passe avant tout : quelqu'un qui a
  // demandé qu'on le laisse tranquille ne redevient pas relançable parce que
  // la boutique a changé de base légale.
  if (await aRefuse(panier.email))
    return {
      envoyer: false,
      code: "refus",
      motif: "Cette personne a demandé à ne plus recevoir de rappel.",
    };
  if (
    reglages.baseLegale === "consentement" &&
    !panier.accepteMarketing &&
    !sauter.includes("pas_de_consentement")
  )
    return {
      envoyer: false,
      code: "pas_de_consentement",
      motif: "Pas de consentement marketing sur cette fiche client.",
    };

  // 4. Disponibilité.
  const { lignes, indisponibles } = await composerLignes(panier.id);
  if (!lignes.length)
    return { envoyer: false, code: "vide", motif: "Panier vide." };
  if (indisponibles === lignes.length)
    return {
      envoyer: false,
      code: "indisponible",
      motif:
        lignes.length > 1
          ? "Aucun des articles n'est encore disponible."
          : "L'article n'est plus disponible.",
    };

  return { envoyer: true, lignes };
}

/* -------------------------------------------------------------------------- */
/*  Le lien de récupération et le refus                                        */
/* -------------------------------------------------------------------------- */

/**
 * Le jeton de récupération de ce panier, créé au besoin.
 *
 * Vingt-quatre octets tirés au sort, soit bien davantage qu'un UUID, et
 * surtout sans la moindre structure : il ne dit ni quand il a été créé, ni de
 * quel panier il s'agit, et deux jetons voisins ne se ressemblent pas. Un
 * panier garde le sien : le régénérer casserait le lien des courriers déjà
 * partis.
 */
export async function jetonDeRecuperation(orderId: number): Promise<string> {
  const [existant] = await db
    .select({ jeton: schema.orders.recoveryToken })
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId));
  if (existant?.jeton) return existant.jeton;
  const jeton = randomBytes(24).toString("base64url");
  await db
    .update(schema.orders)
    .set({ recoveryToken: jeton })
    .where(eq(schema.orders.id, orderId));
  return jeton;
}

/** L'adresse complète du lien de récupération d'un panier. */
export function lienDeRecuperation(jeton: string): string {
  return `${LIEN_RECUPERATION}?jeton=${encodeURIComponent(jeton)}`;
}

/**
 * Le jeton de refus d'une adresse, créé au besoin.
 *
 * Il porte sur l'ADRESSE et non sur le panier : refuser depuis le rappel d'un
 * panier doit valoir pour tous les suivants. L'adresse garde son jeton d'un
 * courrier à l'autre, sinon les liens déjà partis cesseraient de fonctionner.
 */
async function jetonDeRefus(email: string): Promise<string> {
  const lignes = await db
    .insert(schema.relanceRefus)
    .values({ jeton: randomBytes(24).toString("base64url"), email })
    // Rien à changer sur conflit : la mise à jour à vide suffit à faire
    // renvoyer SA ligne par Postgres, avec le jeton déjà attribué.
    .onConflictDoUpdate({ target: schema.relanceRefus.email, set: { email } })
    .returning({ jeton: schema.relanceRefus.jeton });
  const jeton = lignes[0]?.jeton;
  if (!jeton) throw new Error("jeton de refus non créé");
  return jeton;
}

/* -------------------------------------------------------------------------- */
/*  L'envoi                                                                   */
/* -------------------------------------------------------------------------- */

/** Ce qu'un envoi a donné, pour le journal comme pour l'écran. */
export interface ResultatEnvoi {
  parti: boolean;
  motif: string | null;
}

/**
 * Relance UN panier, gardes-fous compris.
 *
 * `forcer` saute les gardes-fous qui relèvent d'un choix de la boutique
 * (l'unicité, le consentement) mais JAMAIS ceux qui protègent le client : la
 * fenêtre de quatorze jours, l'achat croisé et la disponibilité tiennent même
 * pour un envoi déclenché à la main. Relancer quelqu'un qui vient d'acheter,
 * ou lui vanter une affiche qu'on ne sait plus produire, reste une faute que
 * personne ne veut commettre depuis un bouton.
 */
export async function relancerUnPanier(
  orderId: number,
  options: { forcer?: boolean } = {},
): Promise<ResultatEnvoi> {
  const reglages = await lireReglages();
  const panier = await panierAbandonne(orderId);
  if (!panier)
    return { parti: false, motif: "Ce panier n'est plus relançable (payé, annulé, ou sans adresse e-mail)." };

  if (!courrierConfigure())
    return { parti: false, motif: "L'envoi de courriers n'est pas configuré." };

  const verdict = await verifierGardesFous(panier, reglages);
  let lignes: LigneCourrier[];
  if (verdict.envoyer) {
    lignes = verdict.lignes;
  } else if (options.forcer && MOTIFS_FORCABLES.includes(verdict.code)) {
    // On repasse les gardes en sautant les deux forçables. Sans ce second
    // passage, forcer « déjà relancé » sauterait du même coup tout ce qui
    // vient après : le refus, l'achat croisé, le panier indisponible — la
    // vérification s'arrête au premier motif, et c'était lui.
    const second = await verifierGardesFous(panier, reglages, MOTIFS_FORCABLES);
    if (!second.envoyer) {
      await noterLeRenoncement(panier.id, second.motif);
      return { parti: false, motif: second.motif };
    }
    lignes = second.lignes;
  } else {
    await noterLeRenoncement(panier.id, verdict.motif);
    return { parti: false, motif: verdict.motif };
  }

  const jeton = await jetonDeRecuperation(panier.id);
  /*
   * Le lien de désinscription. TOUJOURS, quelle que soit la base légale.
   *
   * Sous l'intérêt légitime, il rend la base défendable. Sous le
   * consentement, il est tout aussi obligatoire : un consentement se retire
   * aussi facilement qu'il se donne, et la case cochée dont il s'agit ici est
   * celle de la lettre d'information, pas le même envoi. Un lien qui arrête
   * les relances, et elles seules, ne coupe donc rien d'autre.
   *
   * Il y a une raison plus terre à terre encore. Gmail et Outlook attendent
   * l'en-tête « List-Unsubscribe » sur ce genre de courrier et s'en servent
   * pour juger l'expéditeur. Sans lui, qui ne veut plus rien recevoir n'a
   * qu'un bouton sous la main, « courrier indésirable » : quelques clics de
   * ceux-là et c'est toute l'adresse d'expédition de la boutique qui tombe.
   */
  const desinscription = `${LIEN_DESINSCRIPTION}?jeton=${encodeURIComponent(
    await jetonDeRefus(panier.email),
  )}`;

  const courrier = courrierPanierAbandonne({
    prenomClient: (panier.nom ?? "").split(" ")[0] || "vous",
    lien: lienDeRecuperation(jeton),
    lignes,
    totalCents: panier.totalCents,
    codePromo: panier.promoCode,
    lienDesinscription: desinscription,
  });
  const parti = await envoyer({ ...courrier, to: panier.email });
  if (!parti) return { parti: false, motif: "Le courrier n'a pas pu partir." };

  await db
    .update(schema.orders)
    .set({
      reminderSentAt: new Date(),
      recoveryDeclinedReason: null,
      recoveryDeclinedAt: null,
    })
    .where(eq(schema.orders.id, panier.id));
  await db.insert(schema.orderEvents).values({
    orderId: panier.id,
    kind: "event",
    message: `Relance de panier envoyée à ${panier.email}.`,
  });
  return { parti: true, motif: null };
}

/**
 * Garde la trace d'un envoi auquel on a renoncé.
 *
 * Écrit sur la commande plutôt que dans le journal : l'écran doit pouvoir
 * afficher le motif en face de chaque ligne sans aller lire un journal par
 * panier. Le journal, lui, ne reçoit que ce qui est arrivé pour de bon.
 */
async function noterLeRenoncement(orderId: number, motif: string): Promise<void> {
  await db
    .update(schema.orders)
    .set({
      recoveryDeclinedReason: motif || null,
      recoveryDeclinedAt: motif ? new Date() : null,
    })
    .where(eq(schema.orders.id, orderId));
}

/* -------------------------------------------------------------------------- */
/*  Le travailleur                                                            */
/* -------------------------------------------------------------------------- */

/** Ce qu'un passage a fait, pour le journal de l'API et l'écran. */
export interface BilanPassage {
  examines: number;
  envoyes: number;
  renonces: number;
  echecs: number;
  /**
   * Pourquoi le passage n'a rien fait, quand ce n'est pas faute de paniers.
   * « 0 panier examiné » sans explication se lit comme une panne, alors que
   * c'est le plus souvent un réglage, et un réglage voulu.
   */
  motif?: string | null;
}

/** Vrai pendant qu'un passage tourne : deux passages ne se chevauchent jamais. */
let passageEnCours = false;
let minuterie: ReturnType<typeof setInterval> | null = null;

/**
 * Un passage du travailleur : tous les paniers éligibles, un par un.
 *
 * Éligible veut dire : abandonné depuis au moins le PALIER D'ENVOI (et non le
 * délai plancher, qui ne sert qu'à l'affichage), jamais relancé, et dans la
 * fenêtre de quatorze jours. Les cinq gardes-fous décident du reste.
 *
 * Exporté, parce qu'on doit pouvoir le déclencher à la main : depuis le
 * back-office quand on n'a pas envie d'attendre, et pendant les essais.
 */
export async function passageDeRelance(): Promise<BilanPassage> {
  const bilan: BilanPassage = {
    examines: 0,
    envoyes: 0,
    renonces: 0,
    echecs: 0,
    motif: null,
  };
  if (passageEnCours) {
    bilan.motif = "Un passage est déjà en cours, celui-ci n'a rien fait.";
    return bilan;
  }
  passageEnCours = true;
  try {
    const reglages = await lireReglages();
    if (!reglages.active) {
      bilan.motif =
        "La relance automatique est éteinte : aucun courrier ne part tout seul. Le bouton « Relancer » d'une ligne, lui, fonctionne toujours.";
      return bilan;
    }
    if (!courrierConfigure()) {
      console.warn("[relance] envoi de courriers non configuré — passage sans effet");
      bilan.motif =
        "L'envoi de courriers n'est pas configuré : rien ne peut partir.";
      return bilan;
    }

    // Le palier d'envoi s'exprime en heures d'inactivité : on le convertit en
    // minutes pour réutiliser la même horloge que l'affichage.
    //
    // Les deux tris qui suivent redisent des garde-fous que `verifierGardesFous`
    // vérifie de toute façon, et c'est voulu : ils écartent d'emblée le gros du
    // troupeau — les paniers déjà relancés une fois pour toutes, et les vieux —
    // pour ne pas noter un renoncement à chaque passage sur des paniers dont le
    // sort est réglé depuis longtemps.
    const candidats = (await paniersAbandonnes(reglages.palierHeures * 60, 200)).filter(
      (p) => !p.relanceAt && heuresDInactivite(p) <= FENETRE_HEURES,
    );

    for (const panier of candidats) {
      bilan.examines += 1;
      const verdict = await verifierGardesFous(panier, reglages);
      if (!verdict.envoyer) {
        await noterLeRenoncement(panier.id, verdict.motif);
        bilan.renonces += 1;
        continue;
      }
      // `relancerUnPanier` revérifie tout avant d'écrire : entre la décision
      // ci-dessus et l'envoi, une commande a pu être payée. Deux vérifications
      // coûtent une requête ; un courrier de trop coûte un client.
      const resultat = await relancerUnPanier(panier.id);
      if (resultat.parti) bilan.envoyes += 1;
      else bilan.echecs += 1;
    }
    if (bilan.envoyes || bilan.renonces)
      console.log(
        `[relance] ${bilan.envoyes} courrier(s) parti(s), ${bilan.renonces} renoncement(s) sur ${bilan.examines} panier(s).`,
      );
    return bilan;
  } catch (e) {
    // Un travailleur qui lève emporte sa minuterie avec lui. On journalise et
    // on rend la main : le passage suivant réessaiera dans cinq minutes.
    console.error("[relance] passage interrompu", e);
    return bilan;
  } finally {
    passageEnCours = false;
  }
}

/**
 * Démarre le travailleur : un passage toutes les cinq minutes, dans le
 * processus de l'API.
 *
 * Il n'y a ici ni file d'attente ni Redis, et il n'en faut pas : une boutique
 * qui compte ses paniers par dizaines n'a pas besoin d'une infrastructure de
 * plus à surveiller. Le garde-fou tient en une variable — `passageEnCours` —
 * qui empêche deux passages de se chevaucher si l'un dure plus longtemps que
 * la période. `unref()` évite que la minuterie retienne le processus au moment
 * de l'arrêter.
 */
export function demarrerRelancePanier(): void {
  if (minuterie) return;
  minuterie = setInterval(() => {
    void passageDeRelance();
  }, PERIODE_PASSAGE_MS);
  minuterie.unref?.();
  console.log("[relance] travailleur démarré (passage toutes les 5 minutes)");
}

/* -------------------------------------------------------------------------- */
/*  Ce que l'écran reçoit                                                     */
/* -------------------------------------------------------------------------- */

type EtatPanier = "abandonne" | "relance" | "recupere" | "trop_ancien" | "renonce";

/** Une ligne de la liste du back-office. */
export interface LignePanierVue {
  id: number;
  number: string;
  totalCents: number;
  articles: number;
  nom: string | null;
  email: string;
  createdAt: string;
  derniereActivite: string;
  relanceAt: string | null;
  recupereLe: string | null;
  etat: EtatPanier;
  etatLibelle: string;
  /** Pourquoi l'envoi automatique a renoncé. Null quand il n'a pas renoncé. */
  motifRenoncement: string | null;
  /** Le lien de récupération, prêt à être copié. */
  lienRecuperation: string;
  /** Vrai tant qu'une relance peut encore partir. */
  relancable: boolean;
}

/** « il y a 3 h », « il y a 2 jours » — la durée telle qu'on la dit. */
function depuis(date: Date): string {
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000));
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.round(minutes / 60);
  if (heures < 48) return `il y a ${heures} h`;
  const jours = Math.round(heures / 24);
  return `il y a ${jours} jours`;
}

/** « le 4 mars à 14:05 ». */
function leJour(date: Date): string {
  return `le ${date.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Paris",
  })} à ${date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  })}`;
}

/**
 * L'état d'un panier, en une phrase que la boutique lit sans traduire.
 *
 * L'ordre des questions est celui de l'importance : récupéré d'abord (c'est la
 * bonne nouvelle), puis trop ancien (c'est définitif), puis relancé, puis le
 * renoncement, et enfin l'attente.
 */
function etatDuPanier(p: PanierAbandonne): {
  etat: EtatPanier;
  libelle: string;
  relancable: boolean;
} {
  if (p.recupereLe)
    return { etat: "recupere", libelle: `Récupéré ${leJour(p.recupereLe)}`, relancable: false };
  if (heuresDInactivite(p) > FENETRE_HEURES)
    return {
      etat: "trop_ancien",
      libelle: "Trop ancien, plus de relance",
      relancable: false,
    };
  if (p.relanceAt)
    return { etat: "relance", libelle: `Relancé ${leJour(p.relanceAt)}`, relancable: true };
  // Un envoi renoncé garde son âge : le motif s'écrit juste en dessous, et
  // remplacer « abandonné il y a 3 h » par « envoi renoncé » ferait perdre la
  // seule information qui dise si le panier est encore tiède.
  if (p.motifRenoncement)
    return {
      etat: "renonce",
      libelle: `Abandonné ${depuis(p.derniereActivite)}`,
      relancable: true,
    };
  return {
    etat: "abandonne",
    libelle: `Abandonné ${depuis(p.derniereActivite)}`,
    relancable: true,
  };
}

/** Les chiffres du haut de l'écran. */
export interface ChiffresRelance {
  relancables: number;
  montantEnJeu: number;
  relancesEnvoyees: number;
  paniersRecuperes: number;
  montantRecupere: number;
}

/**
 * Les chiffres, calculés sur TOUTE l'histoire de la boutique et non sur la
 * page affichée : « combien de paniers avons-nous rattrapés » n'a de sens que
 * cumulé. Seuls les deux premiers portent sur la liste du moment.
 */
async function chiffres(paniers: PanierAbandonne[]): Promise<ChiffresRelance> {
  const relancables = paniers.filter((p) => etatDuPanier(p).relancable);
  const [envoyees] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.orders)
    .where(isNotNull(schema.orders.reminderSentAt));
  const [recuperes] = await db
    .select({
      n: sql<number>`count(*)::int`,
      montant: sql<number>`coalesce(sum(${schema.orders.totalCents}), 0)::int`,
    })
    .from(schema.orders)
    .where(isNotNull(schema.orders.recoveredAt));
  return {
    relancables: relancables.length,
    montantEnJeu: relancables.reduce((s, p) => s + p.totalCents, 0),
    relancesEnvoyees: Number(envoyees?.n ?? 0),
    paniersRecuperes: Number(recuperes?.n ?? 0),
    montantRecupere: Number(recuperes?.montant ?? 0),
  };
}

/* -------------------------------------------------------------------------- */
/*  Pages publiques                                                           */
/* -------------------------------------------------------------------------- */

/** Échappe le texte inséré dans une page HTML. */
function h(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * La page publique du refus. Même sobriété que celle de la lettre
 * d'information : une page, une phrase, un bouton.
 */
function pageRefus(titre: string, corps: string): string {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${h(titre)} · Memory Line</title>
  <style>
    body { margin:0; background:#f3f3f3; color:#121212; min-height:100vh;
      display:flex; align-items:center; justify-content:center; padding:24px;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,system-ui,sans-serif; }
    main { background:#fff; max-width:520px; width:100%; padding:36px 32px; }
    h1 { font-size:22px; font-weight:400; letter-spacing:.6px; margin:0 0 16px; }
    p { font-size:15px; line-height:1.6; margin:0 0 12px; }
    .discret { color:#5b5b54; font-size:13px; }
    button { margin-top:12px; background:#121212; color:#fff; border:0;
      padding:14px 28px; font-size:15px; cursor:pointer; }
  </style>
</head>
<body><main><h1>${h(titre)}</h1>${corps}</main></body>
</html>`;
}

/* -------------------------------------------------------------------------- */
/*  Les routes                                                                */
/* -------------------------------------------------------------------------- */

export function mountRelancePanier(app: Hono): void {
  /* --- Le back-office ---------------------------------------------------- */

  /**
   * Tout l'écran des paniers abandonnés en un seul aller-retour : les
   * réglages, les chiffres, et la liste.
   *
   * Le paramètre `plancher` (en minutes) permet de regarder la liste avec un
   * autre délai que celui enregistré, sans rien changer aux réglages.
   */
  app.get("/admin/carts/abandoned", async (c) => {
    const reglages = await lireReglages();
    const demande = c.req.query("plancher");
    const plancher =
      demande === undefined ? reglages.plancherMinutes : plancherValide(demande);
    const paniers = await paniersAbandonnes(plancher);

    const compte = new Map<number, number>();
    if (paniers.length) {
      const articles = await db
        .select({
          orderId: schema.orderItems.orderId,
          quantity: schema.orderItems.quantity,
        })
        .from(schema.orderItems)
        .where(inArray(schema.orderItems.orderId, paniers.map((p) => p.id)));
      for (const a of articles)
        compte.set(a.orderId, (compte.get(a.orderId) ?? 0) + a.quantity);
    }

    // Le lien de récupération est montré tel qu'il partira. Le jeton se crée
    // ici quand il n'existe pas : la boutique doit pouvoir copier le lien et
    // le donner au téléphone, sans avoir envoyé de courrier.
    const lignes: LignePanierVue[] = [];
    for (const p of paniers) {
      const etat = etatDuPanier(p);
      lignes.push({
        id: p.id,
        number: p.number,
        totalCents: p.totalCents,
        articles: compte.get(p.id) ?? 0,
        nom: p.nom,
        email: p.email,
        createdAt: p.createdAt.toISOString(),
        derniereActivite: p.derniereActivite.toISOString(),
        relanceAt: p.relanceAt?.toISOString() ?? null,
        recupereLe: p.recupereLe?.toISOString() ?? null,
        etat: etat.etat,
        etatLibelle: etat.libelle,
        motifRenoncement: p.motifRenoncement,
        lienRecuperation: lienDeRecuperation(await jetonDeRecuperation(p.id)),
        relancable: etat.relancable,
      });
    }

    return c.json({
      reglages,
      plancher,
      paliers: PALIERS_ENVOI,
      fenetreHeures: FENETRE_HEURES,
      courrierConfigure: courrierConfigure(),
      chiffres: await chiffres(paniers),
      paniers: lignes,
    });
  });

  /** Enregistre les réglages de la relance. */
  app.post("/admin/relance/reglages", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    return c.json({ reglages: await ecrireReglages(body) });
  });

  /**
   * Relance manuelle. Reste possible même quand l'automatique est coupée :
   * c'est le geste de la boutique qui décide, pas le travailleur.
   */
  app.post("/admin/carts/:id/relancer", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isSafeInteger(id) || id <= 0)
      return c.json({ error: "panier inconnu" }, 400);
    const resultat = await relancerUnPanier(id, { forcer: true });
    if (!resultat.parti)
      return c.json({ error: resultat.motif ?? "envoi impossible" }, 400);
    return c.json({ ok: true });
  });

  /** Déclenche un passage du travailleur tout de suite. */
  app.post("/admin/relance/passage", async (c) => {
    return c.json({ bilan: await passageDeRelance() });
  });

  /* --- Le lien de récupération, public ----------------------------------- */

  /**
   * Ce que le jeton ouvre : de quoi remettre le panier dans le navigateur.
   *
   * La page qui l'appelle vit dans la boutique (apps/web) — c'est elle qui
   * écrit l'identifiant de panier et le code de réduction, puis emmène au
   * tunnel. L'API se contente de dire à quel panier ce jeton correspond.
   */
  app.get("/panier/recuperation/:jeton", async (c) => {
    const jeton = c.req.param("jeton").trim();
    if (!jeton) return c.json({ error: "jeton_inconnu" }, 404);

    const [panier] = await db
      .select({
        id: schema.orders.id,
        clientOrderId: schema.orders.clientOrderId,
        status: schema.orders.status,
        totalCents: schema.orders.totalCents,
        promoCode: schema.orders.promoCode,
        createdAt: schema.orders.createdAt,
        lastActivityAt: schema.orders.lastActivityAt,
        nom: schema.customers.name,
        email: schema.customers.email,
      })
      .from(schema.orders)
      .leftJoin(schema.customers, eq(schema.orders.customerId, schema.customers.id))
      .where(eq(schema.orders.recoveryToken, jeton))
      .limit(1);

    if (!panier) return c.json({ error: "jeton_inconnu" }, 404);
    if (panier.status === "paid") return c.json({ error: "deja_payee" }, 409);
    if (STATUTS_CLOS.includes(panier.status))
      return c.json({ error: "panier_clos" }, 409);
    // Passé quatorze jours, le lien ne sert plus : le panier n'est plus
    // relancé, et le rouvrir ferait miroiter des prix qui ont pu changer.
    const horloge = panier.lastActivityAt ?? panier.createdAt;
    if ((Date.now() - horloge.getTime()) / 3600_000 > FENETRE_HEURES)
      return c.json({ error: "trop_ancien" }, 410);
    if (!panier.clientOrderId) return c.json({ error: "jeton_inconnu" }, 404);

    const { lignes } = await composerLignes(panier.id);
    return c.json({
      cartId: panier.clientOrderId,
      promoCode: panier.promoCode,
      nom: panier.nom,
      email: panier.email,
      totalCents: panier.totalCents,
      articles: lignes.map((l) => ({
        titre: l.titre,
        format: l.format,
        quantite: l.quantite,
        unitPriceCents: l.unitPriceCents,
        imageUrl: l.imageUrl ?? null,
        indisponible: Boolean(l.indisponible),
      })),
    });
  });

  /* --- Le refus, public -------------------------------------------------- */

  /**
   * La page de refus. Publique, et elle DEMANDE avant d'agir : les messageries
   * d'entreprise ouvrent les liens des courriers reçus pour les inspecter, et
   * une page qui agirait au chargement désabonnerait des gens qui n'ont jamais
   * cliqué.
   */
  app.get("/relance/desabonnement", async (c) => {
    const jeton = (c.req.query("jeton") ?? "").trim();

    if (jeton === "essai")
      return c.html(
        pageRefus(
          "Lien d'exemple",
          `<p>Ce lien vient d'un essai : il ne retire personne d'aucune liste.</p>
           <p class="discret">Dans un vrai rappel de panier, il arrête les relances en un clic.</p>`,
        ),
      );

    const [trouve] = jeton
      ? await db
          .select()
          .from(schema.relanceRefus)
          .where(eq(schema.relanceRefus.jeton, jeton))
          .limit(1)
      : [];

    if (!trouve)
      return c.html(
        pageRefus(
          "Ce lien n'est plus valable",
          `<p>Nous ne reconnaissons pas ce lien. Il a peut-être été coupé en deux par
            votre messagerie.</p>
           <p class="discret">Écrivez-nous en répondant simplement au message : nous
            arrêterons les rappels à la main.</p>`,
        ),
        404,
      );

    if (trouve.refuseLe)
      return c.html(
        pageRefus(
          "C'est déjà fait",
          `<p>L'adresse ${h(trouve.email)} ne reçoit plus de rappel de panier.</p>
           <p class="discret">Vous n'avez rien d'autre à faire.</p>`,
        ),
      );

    return c.html(
      pageRefus(
        "Ne plus recevoir de rappel de panier",
        `<p>Vous êtes sur le point de demander que l'adresse ${h(trouve.email)} ne
          reçoive plus de rappel lorsqu'une commande reste en cours.</p>
         <form method="POST" action="${h(LIEN_DESINSCRIPTION)}?jeton=${encodeURIComponent(trouve.jeton)}">
           <input type="hidden" name="jeton" value="${h(trouve.jeton)}" />
           <button type="submit">Confirmer</button>
         </form>
         <p class="discret" style="margin-top:20px">Vos commandes, votre compte et la
          lettre d'information ne changent pas : seuls les rappels de panier s'arrêtent.</p>`,
      ),
    );
  });

  /**
   * Le refus lui-même.
   *
   * Le jeton se lit dans l'ADRESSE autant que dans le formulaire : le bouton
   * « Se désabonner » de Gmail et d'Outlook envoie un POST directement à
   * l'adresse annoncée par `List-Unsubscribe`, sans rien de notre formulaire.
   * Sans cette lecture, ce bouton-là n'aurait servi à rien.
   */
  app.post("/relance/desabonnement", async (c) => {
    const formulaire = await c.req
      .parseBody()
      .catch(() => ({}) as Record<string, unknown>);
    const jeton =
      (c.req.query("jeton") ?? "").trim() ||
      String(formulaire["jeton"] ?? "").trim().slice(0, 200);

    const [trouve] = jeton
      ? await db
          .select()
          .from(schema.relanceRefus)
          .where(eq(schema.relanceRefus.jeton, jeton))
          .limit(1)
      : [];

    if (!trouve)
      return c.html(
        pageRefus(
          "Ce lien n'est plus valable",
          `<p>Nous ne reconnaissons pas ce lien.</p>
           <p class="discret">Écrivez-nous en répondant simplement au message : nous
            arrêterons les rappels à la main.</p>`,
        ),
        404,
      );

    if (!trouve.refuseLe)
      await db
        .update(schema.relanceRefus)
        .set({ refuseLe: new Date() })
        .where(eq(schema.relanceRefus.jeton, trouve.jeton));

    return c.html(
      pageRefus(
        "C'est fait",
        `<p>L'adresse ${h(trouve.email)} ne recevra plus de rappel de panier.</p>
         <p class="discret">Votre panier reste le vôtre : vous pouvez terminer votre
          commande à tout moment depuis la boutique.</p>`,
      ),
    );
  });
}

/**
 * Marque un panier comme RÉCUPÉRÉ : il a été payé après une relance.
 *
 * Appelée au moment du passage en « payée » (configurator-routes.ts). Sans
 * relance envoyée, il n'y a rien à noter : la commande se serait faite de
 * toute façon, et compter celle-là gonflerait le seul chiffre qui doit rester
 * honnête.
 */
export async function noterLaRecuperation(orderId: number): Promise<void> {
  await db
    .update(schema.orders)
    .set({ recoveredAt: new Date() })
    .where(
      and(
        eq(schema.orders.id, orderId),
        isNotNull(schema.orders.reminderSentAt),
        isNull(schema.orders.recoveredAt),
      ),
    );
}
