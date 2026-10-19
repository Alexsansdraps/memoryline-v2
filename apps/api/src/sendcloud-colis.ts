/**
 * Bordereaux transporteur achetés chez SendCloud, depuis la fiche commande.
 *
 * API v3 de SendCloud (panel.sendcloud.sc/api/v3), avec les clés du `.env`
 * (SENDCLOUD_PUBLIC_KEY / SENDCLOUD_SECRET_KEY). La v2 refuse de créer des
 * colis pour ce compte (« Creating parcels via API v2 is not available for
 * this account ») ; elle ne sert plus ici qu'à LIRE l'adresse d'expédition.
 *
 * Annoncer un envoi (`/shipments/announce`), c'est l'ACHETER : SendCloud
 * débite l'étiquette à sa création, il n'y a pas de brouillon gratuit. D'où
 * trois garde-fous, tenus par construction et non par vigilance :
 *
 *   1. Rien n'achète tout seul. Seul le bouton de la fiche commande appelle
 *      `acheterBordereau`, avec le prix écrit dessus et une confirmation. Un
 *      simple affichage de la fiche n'achète JAMAIS, pas même pour terminer
 *      un achat interrompu : il faut cliquer « Terminer l'achat ».
 *   2. Un double-clic, un F5 ou une panne ne peuvent pas acheter deux fois :
 *      la ligne `bordereau` naît AVANT l'appel, avec la clé de la demande ; la
 *      base refuse un second bordereau vivant par commande ; et SendCloud
 *      reçoit une référence externe unique — une seconde annonce avec la même
 *      référence lui fait rendre l'envoi existant (409), pas en acheter un autre.
 *   3. MODE ESSAI PAR DÉFAUT. Tant que le `.env` ne dit pas
 *      SENDCLOUD_ACHATS_REELS=oui, l'envoi part en « sendcloud:letter » (lettre
 *      non affranchie), que SendCloud fabrique sans la facturer. Tout le
 *      parcours s'éprouve pour de vrai — étiquette, PDF, annulation — sans
 *      dépenser un centime.
 *
 * L'étiquette n'est jamais stockée ici : elle porte l'adresse d'une cliente,
 * et SendCloud la redonne à la demande.
 *
 * TOUTE commande payée qui a quelque chose à expédier peut avoir son
 * bordereau, quel que soit le mode choisi : un retrait sur place qu'on finit
 * par envoyer, une vente du stand qui doit voyager, un transporteur que
 * SendCloud n'expédie pas (DPD, GLS…), une commande ancienne sans mode relié.
 * Ce qui manque (une adresse, un nom, un e-mail) se dit en clair et se
 * corrige depuis la fiche ; seules une commande annulée, un panier ou une
 * commande non payée restent fermés, parce qu'on n'expédie pas ce qui n'est
 * pas vendu.
 */
import type { Context, Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "./db/client.js";
import { CODES_SENDCLOUD, PREFIXE_SENDCLOUD } from "./sendcloud-points.js";
import { TRANSPORTEURS } from "./livraison-regles.js";
import { commandeVisible } from "./vendeurs.js";
import { lieuDeRetrait } from "./lieux-retrait.js";

const CLE_PUBLIQUE = (process.env.SENDCLOUD_PUBLIC_KEY ?? "").trim();
const CLE_SECRETE = (process.env.SENDCLOUD_SECRET_KEY ?? "").trim();
const PANEL = (process.env.SENDCLOUD_PANEL_URL ?? "https://panel.sendcloud.sc")
  .trim()
  .replace(/\/+$/, "");
const V3 = `${PANEL}/api/v3`;

/** La lettre non affranchie de SendCloud : gratuite, pour les essais. */
const OPTION_ESSAI = "sendcloud:letter";

export function colisConfigure(): boolean {
  return CLE_PUBLIQUE.length > 0 && CLE_SECRETE.length > 0;
}

/** Vrai tant que les achats réels n'ont pas été allumés, délibérément. */
export function modeEssai(): boolean {
  return (process.env.SENDCLOUD_ACHATS_REELS ?? "").trim().toLowerCase() !== "oui";
}

export class RefusBordereau extends Error {
  constructor(
    message: string,
    readonly statut: 400 | 404 | 409 | 502 | 503 = 400,
  ) {
    super(message);
  }
}

// ─── Appels HTTP ──────────────────────────────────────────────────────────

function entetes(): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${CLE_PUBLIQUE}:${CLE_SECRETE}`).toString("base64")}`,
    Accept: "application/json",
  };
}

/**
 * Le refus de SendCloud en clair : « /to_address/email : This field is
 * required. » — le champ fautif d'abord, c'est lui qu'il faut corriger. Jamais
 * une clé : toute longue suite de caractères est masquée.
 */
function messageSendcloud(corps: unknown, statut: number): string {
  const c = corps as {
    errors?: { detail?: string; source?: { pointer?: string } }[];
    error?: { message?: string };
    message?: string;
  } | null;
  const lignes =
    c?.errors?.map((e) =>
      [e.source?.pointer, e.detail].filter(Boolean).join(" : "),
    ) ?? [];
  const brut =
    lignes.filter(Boolean).join(" ; ") ||
    c?.error?.message ||
    c?.message ||
    `réponse HTTP ${statut}`;
  return brut.replace(/[A-Za-z0-9_-]{30,}/g, "…").slice(0, 400);
}

async function appel(
  methode: "GET" | "POST",
  url: string,
  corps?: unknown,
): Promise<{ ok: boolean; statut: number; json: unknown }> {
  const res = await fetch(url, {
    method: methode,
    headers: { ...entetes(), ...(corps ? { "Content-Type": "application/json" } : {}) },
    body: corps ? JSON.stringify(corps) : undefined,
    // L'achat se fait chez le transporteur, en direct : quelques secondes.
    signal: AbortSignal.timeout(45_000),
  });
  const texte = await res.text();
  let json: unknown = null;
  try {
    json = texte ? JSON.parse(texte) : null;
  } catch {
    json = { message: texte.slice(0, 200) };
  }
  return { ok: res.ok, statut: res.status, json };
}

// ─── L'expéditeur ─────────────────────────────────────────────────────────

let expediteur: { id: number; codePostal: string; pays: string } | null = null;

/** L'adresse d'expédition réglée dans SendCloud (la première, celle par défaut). */
async function adresseExpediteur(): Promise<{ id: number; codePostal: string; pays: string }> {
  if (expediteur) return expediteur;
  const r = await appel("GET", `${PANEL}/api/v2/user/addresses/sender`);
  const liste =
    (r.json as {
      sender_addresses?: { id: number; postal_code?: string; country?: string }[];
    } | null)?.sender_addresses ?? [];
  const a = liste[0];
  if (!r.ok || !a)
    throw new RefusBordereau(
      "Aucune adresse d'expédition dans SendCloud : ajoutez-la dans Paramètres › Adresses d'expédition.",
      503,
    );
  expediteur = { id: a.id, codePostal: a.postal_code ?? "", pays: (a.country ?? "FR").toUpperCase() };
  return expediteur;
}

// ─── Les options d'envoi ──────────────────────────────────────────────────

interface OptionSendcloud {
  code: string;
  name: string;
  carrier?: { code?: string; name?: string };
  /** Ce que fait le service, tel que SendCloud le décrit — seuls les champs lus ici. */
  functionalities?: {
    signature?: boolean;
    form_factor?: string;
    /** Heure limite de livraison, « 1300 » pour 13 h. */
    delivery_before?: string | null;
  };
  quotes?: { price?: { total?: { value?: string; currency?: string } } }[];
  requirements?: { is_service_point_required?: boolean };
}

export interface MethodeProposee {
  code: string;
  nom: string;
  transporteur: string;
  /** Tarif SendCloud, en centimes ; null s'il n'en donne pas. */
  prixCents: number | null;
  /**
   * Le service donne-t-il au moins ce que la cliente a payé ? Faux pour un
   * envoi sans signature quand elle l'a payée avec, pour un Shop2Shop quand
   * elle a payé un Chrono Relais, pour un supplément samedi qu'elle n'a pas
   * demandé, pour un autre transporteur que le sien…
   */
  conforme: boolean;
  /**
   * Ce qui l'éloigne du mode payé, en clair (« autre transporteur que
   * Colissimo ; sans la signature payée »), pour que la fiche le dise à côté
   * du prix. Null quand il n'y a rien à redire.
   */
  ecart: string | null;
  /**
   * Du transporteur que la cliente a payé ? Ce sont eux que la fiche montre
   * d'abord ; les autres attendent derrière « Voir tous les services ».
   */
  duTransporteurPaye: boolean;
}

type Commande = typeof schema.orders.$inferSelect;

interface ModePaye {
  carrier: string | null;
  /** « relay », « home » ou « pickup » (voir NATURES_LIVRAISON). */
  kind: string;
  name: string;
  description: string | null;
}

/** Le mode de livraison choisi par la cliente, tel qu'il est AUJOURD'HUI. */
async function modeDeLaCommande(order: Commande): Promise<ModePaye | null> {
  if (!order.shippingMethod) return null;
  const [mode] = await db
    .select({
      carrier: schema.shippingMethods.carrier,
      kind: schema.shippingMethods.kind,
      name: schema.shippingMethods.name,
      description: schema.shippingMethods.description,
    })
    .from(schema.shippingMethods)
    .where(eq(schema.shippingMethods.slug, order.shippingMethod));
  return mode ?? null;
}

/** Le nom d'un de nos transporteurs, tel que l'écrit la page Livraison. */
function nomTransporteur(code: string | null | undefined): string | null {
  if (!code) return null;
  return TRANSPORTEURS.find((t) => t.code === code)?.nom ?? code;
}

/**
 * Ce que la commande dit de l'envoi, avant toute question à SendCloud. La
 * fiche s'en sert pour expliquer — « la cliente avait choisi le retrait sur
 * place », « SendCloud n'expédie pas DPD » — au lieu d'un refus muet.
 */
export interface Situation {
  /**
   * Où ira le colis : au point relais choisi chez SendCloud, ou à l'adresse
   * de la commande. Un retrait sur place, une vente du stand ou un point
   * choisi ailleurs que chez SendCloud (Mondial Relay en direct) n'ont rien
   * qu'une étiquette SendCloud sache viser : c'est alors l'adresse, à saisir
   * s'il n'y en a pas.
   */
  destination: "point_relais" | "adresse";
  /**
   * Ce que la cliente a payé :
   *   « transporteur »   un envoi par un transporteur que SendCloud expédie ;
   *   « hors_sendcloud » un envoi par un transporteur qu'il n'expédie pas ;
   *   « retrait »        le retrait sur place : aucun envoi payé ;
   *   « stand »          une vente du stand, remise en main propre ;
   *   « inconnu »        aucun mode relié à un transporteur (commande ancienne).
   */
  envoiPaye: "transporteur" | "hors_sendcloud" | "retrait" | "stand" | "inconnu";
  /** Le nom du transporteur payé (« Colissimo (La Poste) »), s'il y en a un. */
  transporteurPaye: string | null;
  /** Son code chez SendCloud, quand SendCloud l'expédie. */
  transporteurSendcloud: string | null;
}

interface Contexte {
  mode: ModePaye | null;
  situation: Situation;
}

async function contexteDe(order: Commande): Promise<Contexte> {
  const mode = await modeDeLaCommande(order);
  const carrier = mode?.carrier ?? null;
  const code = carrier ? (CODES_SENDCLOUD[carrier] ?? null) : null;
  // L'ordre compte : une vente du stand n'a jamais de mode, et un retrait sur
  // place n'a pas de transporteur — mais c'est ce qu'ils SONT qu'il faut dire.
  const envoiPaye: Situation["envoiPaye"] =
    order.channel === "salon" || order.standId
      ? "stand"
      : mode?.kind === "pickup" || lieuDeRetrait(order)
        ? "retrait"
        : code
          ? "transporteur"
          : carrier
            ? "hors_sendcloud"
            : "inconnu";
  return {
    mode,
    situation: {
      destination: enPointRelais(order) ? "point_relais" : "adresse",
      envoiPaye,
      transporteurPaye: nomTransporteur(carrier),
      transporteurSendcloud: envoiPaye === "transporteur" ? code : null,
    },
  };
}

/** Le pays du destinataire, en code à deux lettres ; la France sans précision. */
const paysDe = (order: Commande): string =>
  (order.shippingCountry || "FR").trim().toUpperCase();

/**
 * Ce que la cliente a payé, lu dans les mots qu'elle a lus avant de payer :
 * le nom du mode et sa description (« livré le lendemain avant 13 h »), tels
 * que la commande les a figés. La description actuelle du mode ne sert que de
 * repli, pour les commandes passées avant qu'on la fige.
 *
 * Il n'y a pas de champ « service » à régler à part : le mode DIT déjà ce
 * qu'il promet. Un mode qui promet une signature, un samedi ou une heure se
 * voit donc proposer en premier le service qui tient cette promesse. Seules
 * les tournures qui PROMETTENT comptent : « sauf samedi », « du lundi au
 * samedi » ou « ne passe pas dans la boîte aux lettres » ne promettent rien.
 */
interface Exigences {
  signature: boolean;
  samedi: boolean;
  boiteAuxLettres: boolean;
  /** Livré avant cette heure (1300 pour 13 h), ou null s'il n'en promet pas. */
  avant: number | null;
  shop2shop: boolean;
  /** Payé en point relais : un envoi à domicile n'est pas ce qu'elle a choisi. */
  pointRelais: boolean;
}

/**
 * Rien de promis : un retrait sur place, une vente du stand, une commande
 * sans mode. Leurs mots ne décrivent pas un envoi — « retrait samedi de 9 h à
 * 13 h » n'est pas une livraison du samedi avant 13 h —, on ne les lit donc
 * pas. Les services raisonnables passent quand même devant : pas de
 * supplément samedi, pas de boîte aux lettres où un tube n'entre pas.
 */
const SANS_EXIGENCE: Exigences = {
  signature: false,
  samedi: false,
  boiteAuxLettres: false,
  avant: null,
  shop2shop: false,
  pointRelais: false,
};

function exigencesDu(mode: ModePaye | null, order: Commande): Exigences {
  const texte = [
    order.shippingLabel ?? mode?.name,
    order.shippingDescription ?? mode?.description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const heure = /(?:avant|chrono)\s*(10|13|18)\b|\b(10|13|18)\s*h\b/.exec(texte);
  return {
    signature: /signature/.test(texte) && !/sans\s+signature/.test(texte),
    samedi:
      /samedi|saturday/.test(texte) &&
      !/(?:sauf|hors|pas|au)\s+(?:le\s+)?samedi/.test(texte),
    boiteAuxLettres:
      /bo[iî]te aux lettres|mailbox/.test(texte) &&
      !/\b(?:pas|ne|hors)\b[^.,;()]*bo[iî]te aux lettres/.test(texte),
    avant: heure ? Number(heure[1] ?? heure[2]) * 100 : null,
    shop2shop: mode?.carrier === "shop2shop" || /shop2shop/.test(texte),
    pointRelais: mode?.kind === "relay",
  };
}

/**
 * Le service tient-il la promesse ? Null s'il la tient, sinon ce qui manque,
 * en clair, pour la fiche. Un service qui en donne PLUS reste conforme quand
 * c'est sans risque pour la cliente : une signature qu'elle n'a pas demandée
 * (vers l'Allemagne, SendCloud n'a Colissimo qu'avec), un Chrono 10 pour un
 * « avant 13 h ». Mais pas un supplément samedi, ni la boîte aux lettres, où
 * un tube d'affiche n'entre pas.
 */
function ecartAvec(o: OptionSendcloud, e: Exigences): string | null {
  const f = o.functionalities ?? {};
  if (e.signature && f.signature !== true) return "sans la signature payée";
  // Par le code, pas par `weekend_delivery` : les consignes Mondial Relay
  // ouvrent le samedi sans que ce soit une option payée.
  const samedi = /saturday/.test(o.code);
  if (samedi && !e.samedi) return "supplément samedi, que la cliente n'a pas payé";
  if (!samedi && e.samedi) return "sans la livraison du samedi payée";
  const boite = f.form_factor === "mailbox";
  if (boite && !e.boiteAuxLettres) return "en boîte aux lettres : un tube d'affiche n'y entre pas";
  if (!boite && e.boiteAuxLettres) return "pas en boîte aux lettres, contrairement au mode payé";
  if (e.avant !== null) {
    const avant = Number(f.delivery_before);
    if (!Number.isFinite(avant) || avant > e.avant)
      return `pas de livraison garantie avant ${e.avant / 100} h, contrairement au mode payé`;
  }
  // Shop2Shop et Chrono Relais partagent les mêmes points Pickup ; seul le
  // service les distingue (« chronopost:2shopeurope » hors de France).
  const shop2shop = /2shop/.test(o.code);
  if (shop2shop && !e.shop2shop) return "Shop2Shop, un autre service que celui payé";
  if (!shop2shop && e.shop2shop) return "pas le Shop2Shop payé";
  // La seule différence que le filtre de la destination laisse passer : une
  // commande payée en point relais qu'on envoie finalement à une adresse.
  if (e.pointRelais && !o.requirements?.is_service_point_required)
    return "à domicile, alors que la cliente a payé un point relais";
  return null;
}

const enPointRelais = (order: Commande): boolean =>
  (order.relayPointId ?? "").startsWith(PREFIXE_SENDCLOUD);

const idPointRelais = (order: Commande): string | null =>
  enPointRelais(order) ? order.relayPointId!.slice(PREFIXE_SENDCLOUD.length) : null;

const kilos = (grammes: number) => (grammes / 1000).toFixed(3);

/**
 * TOUTES les options qui conviennent à CE colis, avec leur prix, quel que
 * soit le transporteur : SendCloud les filtre lui-même d'après le point
 * relais (un point Mondial Relay n'accepte que Mondial Relay), le pays et le
 * poids. La fiche n'en montre d'abord que celles du transporteur payé
 * (`duTransporteurPaye`) ; « Voir tous les services » montre le reste, pour
 * le jour où ce transporteur ne convient pas — ou n'existe pas chez SendCloud.
 *
 * Rangées dans l'ordre où on doit les lire : celles qui tiennent la promesse
 * du mode payé, puis les services raisonnables (pas de supplément samedi
 * non payé, pas de boîte aux lettres), le transporteur payé avant les
 * autres, et du moins cher au plus cher. La première est cochée d'office.
 */
export async function methodesPour(
  order: Commande,
  poidsGrammes: number,
  contexte?: Contexte,
): Promise<MethodeProposee[]> {
  const { mode, situation } = contexte ?? (await contexteDe(order));
  const pays = paysDe(order);
  const depart = await adresseExpediteur();
  const idPoint = situation.destination === "point_relais" ? idPointRelais(order) : null;
  const r = await appel("POST", `${V3}/shipping-options`, {
    from_address: { country_code: depart.pays, postal_code: depart.codePostal },
    to_address: {
      country_code: pays,
      ...(order.shippingPostalCode ? { postal_code: order.shippingPostalCode } : {}),
    },
    ...(idPoint ? { to_service_point: { id: idPoint } } : {}),
    parcels: [{ weight: { value: kilos(poidsGrammes), unit: "kg" } }],
    // Sans lui, SendCloud rend les options SANS leur prix.
    calculate_quotes: true,
  });
  if (!r.ok)
    throw new RefusBordereau(
      `SendCloud ne donne pas ses options d'envoi : ${messageSendcloud(r.json, r.statut)}`,
      502,
    );
  const leur = situation.transporteurSendcloud;
  // Un envoi payé : sa promesse se lit dans ses mots. Rien de payé (retrait,
  // stand, commande sans mode) : aucune promesse à tenir.
  const exigences =
    situation.envoiPaye === "transporteur" || situation.envoiPaye === "hors_sendcloud"
      ? exigencesDu(mode, order)
      : SANS_EXIGENCE;
  // Un transporteur que SendCloud n'expédie pas (DPD, GLS…) : aucune option
  // n'est la sienne, et chacune doit le dire.
  const autreQue =
    situation.envoiPaye === "transporteur" || situation.envoiPaye === "hors_sendcloud"
      ? `autre transporteur que ${situation.transporteurPaye ?? "celui payé"}`
      : null;
  const options = ((r.json as { data?: OptionSendcloud[] } | null)?.data ?? [])
    .filter((o) => o.code !== OPTION_ESSAI)
    .map((o) => {
      const transporteur = o.carrier?.code ?? o.code.split(":")[0] ?? "";
      const total = o.quotes?.[0]?.price?.total;
      const prix = total?.value !== undefined ? Number(total.value) : NaN;
      const sien = leur !== null && transporteur === leur;
      const ecartService = ecartAvec(o, exigences);
      return {
        code: o.code,
        nom: o.name,
        transporteur,
        prixCents: Number.isFinite(prix) ? Math.round(prix * 100) : null,
        conforme: sien && ecartService === null,
        ecart: [sien ? null : autreQue, ecartService].filter(Boolean).join(" ; ") || null,
        duTransporteurPaye: sien,
        // Pour le rang seulement : un point relais envoyé à domicile a TOUS
        // ses services « à domicile », ce qui ne doit pas noyer la boîte aux
        // lettres ou le samedi parmi les autres.
        raisonnable: ecartAvec(o, { ...exigences, pointRelais: false }) === null,
        pointRequis: !!o.requirements?.is_service_point_required,
      };
    })
    // « sendcloud » n'est pas un transporteur : c'est la lettre d'essai.
    .filter((o) => o.transporteur !== "sendcloud")
    // Livraison en point relais : seulement les options qui y vont. À
    // domicile : seulement celles qui n'en demandent pas.
    .filter((o) => (idPoint ? o.pointRequis : !o.pointRequis))
    // Sans tarif, pas de prix à écrire sur le bouton : on ne propose pas
    // d'acheter à l'aveugle (ce sont les options « International » que
    // SendCloud liste aussi pour un envoi en France).
    .filter((o) => o.prixCents !== null);
  // À prix égal, l'étiquette imprimée d'abord : les variantes « QR » (dépôt
  // sans étiquette, code à montrer au guichet) sont un autre usage.
  const qr = (m: { code: string }) => (/_qr|labelless/.test(m.code) ? 1 : 0);
  return options
    .sort(
      (a, b) =>
        Number(b.conforme) - Number(a.conforme) ||
        Number(b.raisonnable) - Number(a.raisonnable) ||
        Number(b.duTransporteurPaye) - Number(a.duTransporteurPaye) ||
        (a.prixCents ?? Infinity) - (b.prixCents ?? Infinity) ||
        qr(a) - qr(b),
    )
    .map(({ pointRequis: _p, raisonnable: _r, ...m }) => m);
}

// ─── L'état d'une commande ────────────────────────────────────────────────

export type Bordereau = typeof schema.bordereaux.$inferSelect;

async function chargerCommande(orderId: number): Promise<Commande> {
  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  if (!order) throw new RefusBordereau("Commande introuvable.", 404);
  return order;
}

/**
 * Pourquoi on ne peut PAS acheter de bordereau pour cette commande, et
 * qu'aucune saisie sur la fiche n'y changera rien. Chaque phrase dit aussi
 * quoi faire : un refus qui ne le dit pas fait chercher la panne ailleurs.
 *
 * Ce qui se corrige depuis la fiche (une adresse, un nom, un e-mail) n'est
 * pas ici mais dans `manquesDe` : ce n'est pas un refus, c'est une étape.
 */
export function empechement(order: Commande): string | null {
  if (!colisConfigure())
    return "Les clés SendCloud ne sont pas dans le .env du serveur (SENDCLOUD_PUBLIC_KEY et SENDCLOUD_SECRET_KEY) : demandez à la personne qui s'occupe du site de les poser.";
  if (order.status === "draft")
    return "C'est un panier, pas une commande : il n'y a rien à expédier tant qu'il n'est pas payé.";
  if (order.cancelledAt || order.status === "cancelled" || order.status === "voided")
    return "La commande est annulée : elle ne peut plus rien expédier, et aucun bordereau ne s'achète pour elle. Si l'annulation était une erreur, il faut repasser une commande.";
  if (order.status !== "paid")
    return "La commande n'est pas payée : on n'expédie pas ce qui n'est pas réglé. Si l'argent est arrivé hors du site (virement, chèque), encaissez-la dans le bloc du paiement : le bordereau se débloquera aussitôt.";
  return null;
}

/** Ce qui manque à l'étiquette, et où le corriger sur la fiche. */
export interface Manque {
  /** « destinataire » : le bloc du bordereau le saisit ; « email » : la fiche cliente. */
  champ: "destinataire" | "email";
  message: string;
}

/** « la rue, le code postal et la ville » */
const enumerer = (mots: string[]): string =>
  mots.length > 1 ? `${mots.slice(0, -1).join(", ")} et ${mots[mots.length - 1]}` : (mots[0] ?? "");

/** L'adresse e-mail de la cliente : le transporteur la prévient par là. */
async function emailDe(order: Commande): Promise<string> {
  if (!order.customerId) return "";
  const [client] = await db
    .select({ email: schema.customers.email })
    .from(schema.customers)
    .where(eq(schema.customers.id, order.customerId));
  return (client?.email ?? "").trim();
}

/**
 * Ce qu'il faut encore à l'étiquette, dans l'ordre où on le corrige. Vide :
 * on peut acheter.
 *
 * Une commande sans adresse n'est pas une commande « à ne pas expédier » :
 * c'est un retrait sur place qu'on finit par envoyer, une vente du stand qui
 * doit voyager, un point relais choisi ailleurs que chez SendCloud. Chacune
 * le dit avec ses mots, et la fiche ouvre le formulaire de l'adresse.
 */
export async function manquesDe(order: Commande, situation: Situation): Promise<Manque[]> {
  const manques: Manque[] = [];
  const destinataire = (message: string) => manques.push({ champ: "destinataire", message });
  if (!order.shippingName?.trim()) destinataire("Il manque le nom du destinataire.");

  if (situation.destination === "adresse") {
    const rue = order.shippingLine1?.trim();
    const cp = order.shippingPostalCode?.trim();
    const ville = order.shippingCity?.trim();
    if (!rue && !cp && !ville) {
      const point = order.relayPointId ?? "";
      destinataire(
        situation.envoiPaye === "stand"
          ? "Commande prise au stand : elle n'a pas d'adresse de livraison. Si elle doit voyager, saisissez celle du destinataire."
          : situation.envoiPaye === "retrait"
            ? "La cliente avait choisi le retrait sur place : saisissez l'adresse où lui envoyer le colis."
            : point && !lieuDeRetrait(order)
              ? `Le point relais choisi (${order.relayPointLabel ?? point}) ne vient pas de SendCloud : une étiquette SendCloud ne sait pas le viser. Saisissez l'adresse où envoyer le colis, ou créez l'envoi chez le transporteur.`
              : "La commande n'a pas d'adresse de livraison : saisissez celle du destinataire.",
      );
    } else {
      const absents = [!rue && "la rue", !cp && "le code postal", !ville && "la ville"].filter(
        (m): m is string => !!m,
      );
      if (absents.length)
        destinataire(`L'adresse de livraison est incomplète : il manque ${enumerer(absents)}.`);
    }
    const pays = paysDe(order);
    if (pays === "ZZ")
      destinataire(
        "Le pays n'est pas précisé (« autre pays », au moment de la commande) : indiquez le vrai pays du destinataire.",
      );
    else if (!/^[A-Z]{2}$/.test(pays))
      destinataire(
        `Le pays « ${order.shippingCountry} » doit s'écrire avec son code à deux lettres (FR, BE, CH…).`,
      );
  }

  // Le transporteur prévient la cliente de l'arrivée du colis par e-mail :
  // SendCloud refuse l'envoi sans. Mieux vaut le dire ici qu'en anglais après.
  if (!order.customerId)
    manques.push({
      champ: "email",
      message:
        "Aucune cliente n'est rattachée à cette commande, donc aucune adresse e-mail : le transporteur en a besoin pour la prévenir. Créez cet envoi directement dans SendCloud.",
    });
  else if (!(await emailDe(order)))
    manques.push({
      champ: "email",
      message:
        "La fiche de la cliente n'a pas d'adresse e-mail : le transporteur en a besoin pour la prévenir. Ajoutez-la sur sa fiche, puis revenez ici.",
    });
  return manques;
}

/** Le bordereau vivant (en cours ou acheté), sinon le dernier en date. */
export async function bordereauDe(orderId: number): Promise<Bordereau | null> {
  const liste = await db
    .select()
    .from(schema.bordereaux)
    .where(eq(schema.bordereaux.orderId, orderId));
  if (liste.length === 0) return null;
  const vivant = liste.find((b) => b.statut === "en_cours" || b.statut === "achete");
  return vivant ?? liste.sort((a, b) => b.id - a.id)[0]!;
}

// ─── L'achat ──────────────────────────────────────────────────────────────

/** « 12 rue du Port » → numéro « 12 », rue « rue du Port ». */
function separerNumero(ligne: string): { numero: string; rue: string } {
  const m = /^\s*(\d+\s?(?:bis|ter|quater|[a-d])?)[\s,]+(.+)$/i.exec(ligne);
  return m ? { numero: m[1]!.trim(), rue: m[2]!.trim() } : { numero: "", rue: ligne.trim() };
}

/** L'adresse du point relais : la cliente n'en a pas donné d'autre. */
async function adresseDuPoint(
  idPoint: string,
  pays: string,
): Promise<{ rue: string; numero: string; codePostal: string; ville: string }> {
  const res = await fetch(
    `https://servicepoints.sendcloud.sc/api/v2/service-points/${idPoint}/?country=${pays}`,
    { headers: entetes(), signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok)
    throw new RefusBordereau(
      "SendCloud ne retrouve plus le point relais de la cliente : il a peut-être fermé. Contactez-la ; si elle préfère être livrée chez elle, « Envoyer à une adresse plutôt qu'au point relais » dans le bloc du bordereau.",
      409,
    );
  const p = (await res.json()) as {
    street?: string;
    house_number?: string;
    postal_code?: string;
    city?: string;
  };
  const numero = (p.house_number ?? "").trim();
  return {
    rue: (p.street ?? "").replace(/''/g, "'").trim(),
    // Les consignes portent « 80000 AMIENS » en guise de numéro.
    numero: p.postal_code && numero.includes(p.postal_code) ? "" : numero,
    codePostal: (p.postal_code ?? "").trim(),
    ville: (p.city ?? "").trim(),
  };
}

interface EnvoiSendcloud {
  id?: string;
  parcels?: { id?: number; tracking_number?: string; tracking_url?: string }[];
}

const referenceExterne = (b: Bordereau) => `memoryline-bordereau-${b.id}`;

async function marquerAchete(b: Bordereau, envoi: EnvoiSendcloud): Promise<Bordereau> {
  const colis = envoi.parcels?.[0] ?? {};
  const [maj] = await db
    .update(schema.bordereaux)
    .set({
      statut: "achete",
      shipmentId: envoi.id ?? null,
      parcelId: colis.id ?? null,
      trackingNumber: colis.tracking_number || null,
      trackingUrl: colis.tracking_url || null,
      erreur: null,
      acheteAt: new Date(),
    })
    .where(eq(schema.bordereaux.id, b.id))
    .returning();
  // Dans la chronologie, comme toute action sur la commande : c'est là qu'on
  // cherche, des semaines plus tard, qui a acheté quelle étiquette et quand.
  await db.insert(schema.orderEvents).values({
    orderId: b.orderId,
    kind: "event",
    author: b.auteur,
    message: b.essai
      ? `Bordereau d'essai fabriqué : ${b.methodeNom}.`
      : `Bordereau acheté chez SendCloud : ${b.methodeNom}` +
        (b.prixAnnonceCents !== null
          ? `, ${(b.prixAnnonceCents / 100).toFixed(2).replace(".", ",")} €`
          : "") +
        (maj!.trackingNumber ? `, suivi ${maj!.trackingNumber}` : "") +
        ".",
  });
  return maj!;
}

async function marquerEchec(b: Bordereau, erreur: string): Promise<Bordereau> {
  const [maj] = await db
    .update(schema.bordereaux)
    .set({ statut: "echec", erreur })
    .where(eq(schema.bordereaux.id, b.id))
    .returning();
  return maj!;
}

/**
 * Les pays où un colis parti de France ne passe pas la douane : l'Union
 * européenne, plus Monaco (en union douanière avec la France). L'Outre-mer a
 * ses propres codes pays (GP, MQ, RE…) et n'y figure donc pas : un colis pour
 * la Guadeloupe passe la douane, SendCloud le confirme.
 */
const TERRITOIRE_DOUANIER_UE: ReadonlySet<string> = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR",
  "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI",
  "SK", "MC",
]);

/**
 * Le contenu du colis, pour la déclaration en douane : une ligne par article
 * commandé. Le poids réel de chaque affiche n'est pas connu, seul celui du
 * colis l'est : il se répartit à parts égales entre les exemplaires.
 *
 * La valeur déclarée est celle que la cliente a PAYÉE : les remises (« la 4e
 * offerte », -20 %) se déduisent du panier entier, pas ligne par ligne, et
 * déclarer le prix catalogue lui ferait payer TVA et droits sur une somme
 * qu'elle n'a pas versée. Comme pour le courrier de confirmation, la remise
 * se déduit de ce qui a été facturé, et se répartit au prorata des lignes.
 *
 * 4911.91 est la position douanière des images et affiches imprimées.
 */
async function articlesEnDouane(order: Commande, poidsGrammes: number) {
  const lignes = await db
    .select({
      titre: schema.orderItems.title,
      prixCents: schema.orderItems.unitPriceCents,
      quantite: schema.orderItems.quantity,
    })
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, order.id));
  const exemplaires = lignes.reduce((n, l) => n + Math.max(1, l.quantite), 0) || 1;
  const parExemplaire = Math.max(1, Math.floor(poidsGrammes / exemplaires));
  const sousTotal = lignes.reduce((s, l) => s + l.prixCents * Math.max(1, l.quantite), 0);
  const paye = Math.min(
    sousTotal,
    Math.max(0, order.totalCents - (order.shippingCents ?? 0)),
  );
  const facteur = sousTotal > 0 ? paye / sousTotal : 1;
  return lignes.map((l) => ({
    description: (l.titre?.trim() || "Affiche imprimée").slice(0, 100),
    quantity: Math.max(1, l.quantite),
    weight: { value: Number(kilos(parExemplaire)), unit: "kg" },
    // Jamais zéro : une marchandise déclarée sans valeur est refusée.
    price: {
      value: (Math.max(1, Math.round(l.prixCents * facteur)) / 100).toFixed(2),
      currency: "EUR",
    },
    hs_code: "491191",
    origin_country: "FR",
  }));
}

/**
 * L'annonce chez SendCloud, pour une ligne `bordereau` déjà écrite. Rejouable
 * sans risque : la référence externe est celle de la ligne, et SendCloud rend
 * l'envoi existant (409) au lieu d'en acheter un second.
 */
async function annoncer(b: Bordereau): Promise<Bordereau> {
  const order = await chargerCommande(b.orderId);
  const pays = paysDe(order);
  const email = await emailDe(order);
  // Vérifié avant l'achat (`manquesDe`) ; redit ici pour « Terminer l'achat »,
  // qui rejoue une annonce sans repasser par là.
  if (!email)
    return marquerEchec(
      b,
      "Il manque l'e-mail de la cliente : le transporteur en a besoin pour la prévenir. Ajoutez-le sur sa fiche.",
    );

  const idPoint = idPointRelais(order);
  const adresse = idPoint
    ? await adresseDuPoint(idPoint, pays)
    : (() => {
        const { numero, rue } = separerNumero(order.shippingLine1 ?? "");
        return {
          rue,
          numero,
          codePostal: order.shippingPostalCode ?? "",
          ville: order.shippingCity ?? "",
        };
      })();
  const depart = await adresseExpediteur();
  const douane = !b.essai && !TERRITOIRE_DOUANIER_UE.has(pays);
  const articles = douane ? await articlesEnDouane(order, b.poidsGrammes) : [];

  const r = await appel("POST", `${V3}/shipments/announce`, {
    to_address: {
      name: order.shippingName,
      address_line_1: adresse.rue,
      ...(adresse.numero ? { house_number: adresse.numero } : {}),
      ...(!idPoint && order.shippingLine2 ? { address_line_2: order.shippingLine2 } : {}),
      postal_code: adresse.codePostal,
      city: adresse.ville,
      country_code: pays,
      email,
      ...(order.shippingPhone ? { phone_number: order.shippingPhone } : {}),
    },
    from_address: { sender_address_id: depart.id },
    // La lettre d'essai ne va pas en point relais ; la vraie, si.
    ...(idPoint && !b.essai ? { to_service_point: { id: idPoint } } : {}),
    ship_with: {
      type: "shipping_option_code",
      properties: { shipping_option_code: b.essai ? OPTION_ESSAI : b.methodeCode },
    },
    parcels: [
      {
        weight: { value: kilos(b.poidsGrammes), unit: "kg" },
        ...(douane ? { parcel_items: articles } : {}),
      },
    ],
    // Vente à une particulière, facturée sous le numéro de la commande.
    ...(douane
      ? { customs_information: { invoice_number: order.number, export_reason: "commercial_goods" } }
      : {}),
    order_number: order.number,
    external_reference_id: referenceExterne(b),
    total_order_price: { currency: "EUR", value: (order.totalCents / 100).toFixed(2) },
  });
  const envoi = (r.json as { data?: EnvoiSendcloud } | null)?.data;
  // 409 avec l'envoi : il existait déjà (rejeu d'une annonce dont la
  // réponse s'était perdue). C'est un succès, pas un second achat.
  if ((r.ok || r.statut === 409) && envoi?.parcels?.length) return marquerAchete(b, envoi);
  return marquerEchec(b, messageSendcloud(r.json, r.statut));
}

export async function acheterBordereau(opts: {
  orderId: number;
  methodeCode: string;
  poidsGrammes: number;
  prixAnnonceCents: number | null;
  cleDemande: string;
  auteur?: string;
}): Promise<Bordereau> {
  const cle = opts.cleDemande.trim();
  if (!/^[A-Za-z0-9-]{8,80}$/.test(cle))
    throw new RefusBordereau("Demande invalide : rechargez la page.");

  // Cette demande a-t-elle déjà été faite ? (double-clic, F5, retour arrière)
  const [deja] = await db
    .select()
    .from(schema.bordereaux)
    .where(eq(schema.bordereaux.cleDemande, cle));
  if (deja) return deja;

  const order = await chargerCommande(opts.orderId);
  const bloque = empechement(order);
  if (bloque) throw new RefusBordereau(bloque, 409);
  const contexte = await contexteDe(order);
  const manques = await manquesDe(order, contexte.situation);
  if (manques.length) throw new RefusBordereau(manques.map((m) => m.message).join(" "), 409);

  const poids = Math.round(opts.poidsGrammes);
  if (!(poids >= 1 && poids <= 70_000)) throw new RefusBordereau("Poids du colis invalide.");

  const essai = modeEssai();
  // Contre la liste COMPLÈTE : un service d'un autre transporteur, choisi
  // derrière « Voir tous les services », s'achète comme les autres.
  const methode = (await methodesPour(order, poids, contexte)).find(
    (m) => m.code === opts.methodeCode,
  );
  if (!methode)
    throw new RefusBordereau(
      "Cette option d'envoi ne convient plus à ce colis (poids ou point relais). Rechargez la page.",
      409,
    );
  // Le prix du bouton est celui qu'on paie : s'il a bougé entre l'affichage
  // et le clic, on n'achète pas en silence.
  if (!essai && methode.prixCents !== opts.prixAnnonceCents)
    throw new RefusBordereau(
      "Le tarif de SendCloud a changé depuis l'affichage de la page. Rechargez-la pour voir le nouveau prix.",
      409,
    );

  // La ligne AVANT l'appel : c'est elle qui empêche un second achat.
  let b: Bordereau;
  try {
    [b] = (await db
      .insert(schema.bordereaux)
      .values({
        orderId: order.id,
        cleDemande: cle,
        statut: "en_cours",
        essai,
        methodeCode: methode.code,
        methodeNom: essai ? `${methode.nom} — ESSAI (lettre non affranchie, gratuite)` : methode.nom,
        transporteur: methode.transporteur,
        poidsGrammes: poids,
        prixAnnonceCents: essai ? 0 : methode.prixCents,
        auteur: opts.auteur ?? null,
      })
      .returning()) as [Bordereau];
  } catch {
    throw new RefusBordereau(
      "Un bordereau est déjà en cours ou acheté pour cette commande. Annulez-le avant d'en acheter un autre.",
      409,
    );
  }

  try {
    return await annoncer(b);
  } catch (e) {
    if (e instanceof RefusBordereau) {
      await marquerEchec(b, e.message);
      throw e;
    }
    // Réponse perdue (délai, réseau) : l'achat a peut-être eu lieu. La
    // ligne reste « en cours », ce qui bloque tout autre achat, et la fiche
    // propose « Terminer l'achat » — qui rejoue l'annonce sans risque.
    console.error("[bordereau] réponse perdue", e);
    return b;
  }
}

/**
 * « Terminer l'achat » d'un bordereau resté en cours : rejoue l'annonce avec
 * la MÊME référence. S'il avait été fabriqué, SendCloud le rend ; sinon, il
 * le fabrique maintenant — c'était l'achat demandé.
 */
export async function terminerBordereau(orderId: number): Promise<Bordereau> {
  const b = await bordereauDe(orderId);
  if (!b || b.statut !== "en_cours") throw new RefusBordereau("Aucun achat en cours.", 404);
  try {
    return await annoncer(b);
  } catch (e) {
    if (e instanceof RefusBordereau) throw e;
    throw new RefusBordereau("SendCloud ne répond toujours pas. Réessayez dans un instant.", 502);
  }
}

// ─── L'étiquette et l'annulation ──────────────────────────────────────────

/** Le PDF de l'étiquette : 10×15 pour une imprimante d'étiquettes, ou A4. */
export async function etiquettePdf(b: Bordereau, format: "a6" | "a4"): Promise<ArrayBuffer> {
  if (b.statut !== "achete" || !b.parcelId)
    throw new RefusBordereau("Pas d'étiquette : le bordereau n'est pas acheté.", 404);
  const res = await fetch(
    `${V3}/parcels/${b.parcelId}/documents/label?paper_size=${format === "a4" ? "A4" : "A6"}`,
    {
      headers: { ...entetes(), Accept: "application/pdf" },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok)
    throw new RefusBordereau(
      `SendCloud ne donne pas l'étiquette (réponse ${res.status}). Réessayez dans un instant.`,
      502,
    );
  return res.arrayBuffer();
}

/**
 * Annule l'envoi chez SendCloud (possible pendant 42 jours, tant qu'il n'est
 * pas livré). Le remboursement de l'étiquette dépend du transporteur :
 * SendCloud le dit dans sa réponse, recopiée telle quelle.
 */
export async function annulerBordereau(
  orderId: number,
  auteur?: string,
): Promise<{ bordereau: Bordereau; message: string }> {
  const [b] = await db
    .select()
    .from(schema.bordereaux)
    .where(
      and(
        eq(schema.bordereaux.orderId, orderId),
        inArray(schema.bordereaux.statut, ["achete", "en_cours"]),
      ),
    );
  if (!b) throw new RefusBordereau("Aucun bordereau à annuler.", 404);
  if (b.statut === "en_cours")
    throw new RefusBordereau(
      "Un achat est en cours : cliquez d'abord « Terminer l'achat » pour savoir s'il a eu lieu.",
      409,
    );
  let message = "Bordereau annulé.";
  if (b.shipmentId) {
    const r = await appel("POST", `${V3}/shipments/${encodeURIComponent(b.shipmentId)}/cancel`);
    const corps = r.json as { message?: string; data?: { message?: string } } | null;
    const dit = corps?.data?.message ?? corps?.message;
    if (!r.ok && r.statut !== 404)
      throw new RefusBordereau(`SendCloud refuse l'annulation : ${messageSendcloud(r.json, r.statut)}`, 502);
    // SendCloud répond en anglais ; ses deux réponses d'accord se traduisent.
    if (r.statut === 202 || /queued/i.test(dit ?? ""))
      message =
        "Annulation demandée à SendCloud : elle est en cours de traitement chez le transporteur. L'étiquette ne doit plus être utilisée.";
    else if (r.ok) message = "Bordereau annulé chez SendCloud : l'étiquette n'est plus valable.";
    else if (dit) message = `SendCloud : ${dit}`;
  }
  const [maj] = await db
    .update(schema.bordereaux)
    .set({ statut: "annule", annuleAt: new Date() })
    .where(eq(schema.bordereaux.id, b.id))
    .returning();
  await db.insert(schema.orderEvents).values({
    orderId,
    kind: "event",
    author: auteur?.trim() || null,
    message:
      `Bordereau${b.essai ? " d'essai" : ""}${b.trackingNumber ? ` ${b.trackingNumber}` : ""} annulé. ` +
      message,
  });
  return { bordereau: maj!, message };
}

// ─── Les routes du back-office ────────────────────────────────────────────
// Sous /admin/* : la protection du back-office (index.ts) s'applique avant.

function erreurHttp(e: unknown): { message: string; statut: 400 | 404 | 409 | 502 | 503 } {
  if (e instanceof RefusBordereau) return { message: e.message, statut: e.statut };
  console.error("[bordereau]", e);
  return { message: "SendCloud ne répond pas. Réessayez dans un instant.", statut: 502 };
}

/**
 * La commande est-elle à portée de la personne connectée ?
 *
 * La garde du serveur laisse passer les LECTURES d'un vendeur sous
 * « /admin/orders », pour ses ventes de stand. Le bordereau en est une, mais
 * il porte le nom, l'adresse et le téléphone de la destinataire : sans ce
 * contrôle, un compte de stand lisait l'étiquette de n'importe quelle
 * commande du site en comptant les identifiants de un en un.
 *
 * « Introuvable » plutôt que « interdit », comme la fiche : un 403 dirait que
 * la commande existe.
 */
async function aPortee(c: Context, orderId: number): Promise<boolean> {
  if (!Number.isInteger(orderId) || orderId <= 0) return false;
  const [order] = await db
    .select({ channel: schema.orders.channel, standId: schema.orders.standId })
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId));
  return !!order && commandeVisible(c.get("utilisateur"), order);
}

export function mountBordereaux(app: Hono): void {
  /**
   * Tout ce que le bloc « Bordereau transporteur » de la fiche doit afficher.
   *
   * `?tous=1` : les services de TOUS les transporteurs, pas seulement ceux du
   * transporteur payé. Une seule question à SendCloud dans les deux cas — il
   * les donne tous —, la liste courte n'est qu'un tri de la longue.
   */
  app.get("/admin/orders/:id/bordereau", async (c) => {
    if (!(await aPortee(c, Number(c.req.param("id")))))
      return c.json({ error: "Commande introuvable." }, 404);
    try {
      const order = await chargerCommande(Number(c.req.param("id")));
      const bordereau = await bordereauDe(order.id);
      // Le poids : celui du catalogue, figé à la commande — l'emballage en
      // plus se corrige dans le champ, avant d'acheter.
      const poidsDemande = Number(c.req.query("poids"));
      const poidsGrammes =
        Number.isFinite(poidsDemande) && poidsDemande > 0
          ? Math.round(poidsDemande)
          : Math.max(order.weightGrams || 0, 100);
      const tous = c.req.query("tous") === "1";
      const bloque = empechement(order);
      const contexte = await contexteDe(order);
      const vivant =
        bordereau && (bordereau.statut === "achete" || bordereau.statut === "en_cours");
      const manques = bloque || vivant ? [] : await manquesDe(order, contexte.situation);
      let methodes: MethodeProposee[] = [];
      let autresServices = 0;
      let erreurMethodes: string | null = null;
      // Pas de question à SendCloud tant qu'il manque l'adresse : ses prix
      // dépendent du pays et du code postal qu'on n'a pas encore.
      if (!bloque && !vivant && manques.length === 0) {
        try {
          const toutes = await methodesPour(order, poidsGrammes, contexte);
          // La liste courte : le transporteur payé, quand SendCloud l'expédie.
          // Sans lui (retrait, stand, DPD…), il n'y a rien à raccourcir.
          const courtes = contexte.situation.transporteurSendcloud
            ? toutes.filter((m) => m.duTransporteurPaye)
            : toutes;
          methodes = tous ? toutes : courtes;
          autresServices = toutes.length - courtes.length;
        } catch (e) {
          erreurMethodes = erreurHttp(e).message;
        }
      }
      return c.json({
        configure: colisConfigure(),
        essai: modeEssai(),
        empechement: bloque,
        manques,
        situation: contexte.situation,
        bordereau,
        poidsGrammes,
        pointRelais: order.relayPointLabel,
        tous,
        methodes,
        autresServices,
        erreurMethodes,
      });
    } catch (e) {
      const { message, statut } = erreurHttp(e);
      return c.json({ error: message }, statut);
    }
  });

  app.post("/admin/orders/:id/bordereau", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      const bordereau = await acheterBordereau({
        orderId: Number(c.req.param("id")),
        methodeCode: String(b.methodeCode ?? ""),
        poidsGrammes: Number(b.poidsGrammes),
        prixAnnonceCents:
          b.prixAnnonceCents === null || b.prixAnnonceCents === undefined || b.prixAnnonceCents === ""
            ? null
            : Number(b.prixAnnonceCents),
        cleDemande: String(b.cleDemande ?? ""),
        auteur: typeof b.auteur === "string" ? b.auteur : undefined,
      });
      return c.json(bordereau);
    } catch (e) {
      const { message, statut } = erreurHttp(e);
      return c.json({ error: message }, statut);
    }
  });

  app.post("/admin/orders/:id/bordereau/terminer", async (c) => {
    try {
      return c.json(await terminerBordereau(Number(c.req.param("id"))));
    } catch (e) {
      const { message, statut } = erreurHttp(e);
      return c.json({ error: message }, statut);
    }
  });

  app.get("/admin/orders/:id/bordereau/etiquette.pdf", async (c) => {
    if (!(await aPortee(c, Number(c.req.param("id")))))
      return c.json({ error: "Commande introuvable." }, 404);
    try {
      const b = await bordereauDe(Number(c.req.param("id")));
      if (!b) return c.json({ error: "Aucun bordereau." }, 404);
      const format = c.req.query("format") === "a4" ? "a4" : "a6";
      const pdf = await etiquettePdf(b, format);
      return new Response(pdf, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="bordereau-${b.trackingNumber ?? b.id}-${format}.pdf"`,
          // Une adresse de cliente : jamais gardée par un cache intermédiaire.
          "Cache-Control": "private, no-store",
        },
      });
    } catch (e) {
      const { message, statut } = erreurHttp(e);
      return c.json({ error: message }, statut);
    }
  });

  app.post("/admin/orders/:id/bordereau/annuler", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      return c.json(
        await annulerBordereau(
          Number(c.req.param("id")),
          typeof b.auteur === "string" ? b.auteur : undefined,
        ),
      );
    } catch (e) {
      const { message, statut } = erreurHttp(e);
      return c.json({ error: message }, statut);
    }
  });
}
