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
 */
import type { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "./db/client.js";
import { PREFIXE_SENDCLOUD } from "./sendcloud-points.js";

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

/** Nos codes de transporteur → ceux de SendCloud. */
const TRANSPORTEURS_SENDCLOUD: Record<string, string> = {
  mondial_relay: "mondial_relay",
  colissimo: "colissimo",
  chronopost: "chronopost",
};

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
  quotes?: { price?: { total?: { value?: string; currency?: string } } }[];
  requirements?: { is_service_point_required?: boolean };
}

export interface MethodeProposee {
  code: string;
  nom: string;
  transporteur: string;
  /** Tarif SendCloud, en centimes ; null s'il n'en donne pas. */
  prixCents: number | null;
}

type Commande = typeof schema.orders.$inferSelect;

/** Le transporteur du mode de livraison choisi par la cliente. */
async function transporteurDeLaCommande(order: Commande): Promise<string | null> {
  if (!order.shippingMethod) return null;
  const [mode] = await db
    .select({ carrier: schema.shippingMethods.carrier })
    .from(schema.shippingMethods)
    .where(eq(schema.shippingMethods.slug, order.shippingMethod));
  return mode?.carrier ?? null;
}

const enPointRelais = (order: Commande): boolean =>
  (order.relayPointId ?? "").startsWith(PREFIXE_SENDCLOUD);

const idPointRelais = (order: Commande): string | null =>
  enPointRelais(order) ? order.relayPointId!.slice(PREFIXE_SENDCLOUD.length) : null;

const kilos = (grammes: number) => (grammes / 1000).toFixed(3);

/**
 * Les options qui conviennent à CE colis, avec leur prix : SendCloud les
 * filtre lui-même d'après le point relais, le pays et le poids ; on ne garde
 * que le transporteur choisi par la cliente. Du moins cher au plus cher.
 */
export async function methodesPour(
  order: Commande,
  poidsGrammes: number,
): Promise<MethodeProposee[]> {
  const pays = (order.shippingCountry || "FR").toUpperCase();
  const depart = await adresseExpediteur();
  const idPoint = idPointRelais(order);
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
  const notre = await transporteurDeLaCommande(order);
  const leur = notre ? TRANSPORTEURS_SENDCLOUD[notre] : undefined;
  const options = ((r.json as { data?: OptionSendcloud[] } | null)?.data ?? [])
    .filter((o) => o.code !== OPTION_ESSAI)
    .map((o) => {
      const transporteur = o.carrier?.code ?? o.code.split(":")[0] ?? "";
      const total = o.quotes?.[0]?.price?.total;
      const prix = total?.value !== undefined ? Number(total.value) : NaN;
      return {
        code: o.code,
        nom: o.name,
        transporteur,
        prixCents: Number.isFinite(prix) ? Math.round(prix * 100) : null,
        pointRequis: !!o.requirements?.is_service_point_required,
      };
    })
    .filter((o) => (leur ? o.transporteur === leur : o.transporteur !== "sendcloud"))
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
    .map(({ pointRequis: _, ...m }) => m)
    .sort(
      (a, b) =>
        (a.prixCents ?? Infinity) - (b.prixCents ?? Infinity) || qr(a) - qr(b),
    );
}

// ─── L'état d'une commande ────────────────────────────────────────────────

export type Bordereau = typeof schema.bordereaux.$inferSelect;

async function chargerCommande(orderId: number): Promise<Commande> {
  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  if (!order) throw new RefusBordereau("Commande introuvable.", 404);
  return order;
}

/** Pourquoi on ne peut PAS acheter de bordereau pour cette commande, s'il y a lieu. */
export function empechement(order: Commande): string | null {
  if (!colisConfigure())
    return "Les clés SendCloud ne sont pas dans le .env du serveur (SENDCLOUD_PUBLIC_KEY et SENDCLOUD_SECRET_KEY).";
  if (order.cancelledAt) return "La commande est annulée.";
  if (order.status !== "paid") return "La commande n'est pas payée.";
  if (order.standId) return "Commande prise au stand : rien à expédier.";
  if (!order.shippingName?.trim()) return "Il manque le nom du destinataire.";
  if (!enPointRelais(order) && !(order.shippingLine1 && order.shippingPostalCode && order.shippingCity))
    return "L'adresse de livraison est incomplète.";
  return null;
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
      "SendCloud ne retrouve plus le point relais de la cliente : il a peut-être fermé. Contactez-la pour en choisir un autre.",
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
 * L'annonce chez SendCloud, pour une ligne `bordereau` déjà écrite. Rejouable
 * sans risque : la référence externe est celle de la ligne, et SendCloud rend
 * l'envoi existant (409) au lieu d'en acheter un second.
 */
async function annoncer(b: Bordereau): Promise<Bordereau> {
  const order = await chargerCommande(b.orderId);
  const pays = (order.shippingCountry || "FR").toUpperCase();
  const [client] = order.customerId
    ? await db
        .select({ email: schema.customers.email })
        .from(schema.customers)
        .where(eq(schema.customers.id, order.customerId))
    : [];
  const email = (client?.email ?? "").trim();
  // Mondial Relay prévient la cliente de l'arrivée du colis par e-mail :
  // SendCloud le refuse sans. Mieux vaut le dire ici qu'en anglais après.
  if (!email)
    return marquerEchec(b, "Il manque l'e-mail de la cliente : le transporteur en a besoin pour la prévenir.");

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
    parcels: [{ weight: { value: kilos(b.poidsGrammes), unit: "kg" } }],
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

  const poids = Math.round(opts.poidsGrammes);
  if (!(poids >= 1 && poids <= 70_000)) throw new RefusBordereau("Poids du colis invalide.");

  const essai = modeEssai();
  const methode = (await methodesPour(order, poids)).find((m) => m.code === opts.methodeCode);
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
  return { bordereau: maj!, message };
}

// ─── Les routes du back-office ────────────────────────────────────────────
// Sous /admin/* : la protection du back-office (index.ts) s'applique avant.

function erreurHttp(e: unknown): { message: string; statut: 400 | 404 | 409 | 502 | 503 } {
  if (e instanceof RefusBordereau) return { message: e.message, statut: e.statut };
  console.error("[bordereau]", e);
  return { message: "SendCloud ne répond pas. Réessayez dans un instant.", statut: 502 };
}

export function mountBordereaux(app: Hono): void {
  /** Tout ce que le bloc « Bordereau transporteur » de la fiche doit afficher. */
  app.get("/admin/orders/:id/bordereau", async (c) => {
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
      const bloque = empechement(order);
      const vivant =
        bordereau && (bordereau.statut === "achete" || bordereau.statut === "en_cours");
      let methodes: MethodeProposee[] = [];
      let erreurMethodes: string | null = null;
      if (!bloque && !vivant) {
        try {
          methodes = await methodesPour(order, poidsGrammes);
        } catch (e) {
          erreurMethodes = erreurHttp(e).message;
        }
      }
      return c.json({
        configure: colisConfigure(),
        essai: modeEssai(),
        empechement: bloque,
        bordereau,
        poidsGrammes,
        pointRelais: order.relayPointLabel,
        methodes,
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
    try {
      return c.json(await annulerBordereau(Number(c.req.param("id"))));
    } catch (e) {
      const { message, statut } = erreurHttp(e);
      return c.json({ error: message }, statut);
    }
  });
}
