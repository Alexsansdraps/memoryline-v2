/**
 * Intégrations de paiement (canal web §11) — Stripe & PayPal.
 *
 * Volontairement SANS SDK : tout passe par l'API REST des prestataires via
 * `fetch`, et la signature du webhook Stripe est vérifiée avec `node:crypto`.
 * Aucune dépendance npm supplémentaire, et le même style pour les deux.
 *
 * LES CLÉS ARRIVENT EN PARAMÈTRE. Elles étaient lues une fois pour toutes
 * dans le .env au chargement du module : en changer demandait de redémarrer
 * l'API, et un paiement ouvert avec les clés d'essai ne pouvait plus se
 * capturer une fois la boutique passée en réel. Elles viennent désormais de
 * la configuration effective (paiements-reglages.ts : le back-office d'abord,
 * le .env en repli), et chaque opération sur un paiement EXISTANT reçoit les
 * clés du mode où il est né (payment.mode).
 *
 * IMPORTANT : ce module ne connaît RIEN de la base ni des commandes — il ne
 * fait que parler aux prestataires. La logique « marquer la commande payée +
 * générer les PDF » vit dans configurator-routes.ts (markOrderPaid).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { masquer, type Mode, type Secret } from "./paiements-cles.js";

/** Ce qu'il faut pour parler à Stripe : la clé secrète, et son mode. */
export interface ClesStripe {
  mode: Mode;
  cleSecrete: Secret;
}

/** Ce qu'il faut pour parler à PayPal : l'application, son secret, son côté. */
export interface ClesPaypal {
  mode: Mode;
  clientId: string;
  secret: Secret;
}

/* -------------------------------------------------------------------------- */
/*  Stripe (REST)                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Crée un PaymentIntent Stripe pour `amountCents` (EUR). `orderId` est mis en
 * metadata pour que le webhook retrouve la commande. Renvoie l'id du PI et son
 * client_secret (à confirmer côté navigateur avec Stripe.js).
 */
export async function createStripeIntent(
  cles: ClesStripe,
  amountCents: number,
  orderId: number,
  orderNumber: string,
): Promise<{ id: string; clientSecret: string }> {
  const body = new URLSearchParams();
  body.set("amount", String(amountCents));
  body.set("currency", "eur");
  body.set("automatic_payment_methods[enabled]", "true");
  body.set("metadata[orderId]", String(orderId));
  body.set("metadata[orderNumber]", orderNumber);
  const res = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cles.cleSecrete.devoiler()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok)
    throw new Error(`Stripe intent HTTP ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { id: string; client_secret: string };
  return { id: j.id, clientSecret: j.client_secret };
}

/**
 * Un PaymentIntent tel que Stripe le voit (pour confirmer un paiement SANS
 * attendre le webhook — pratique en dev, et filet de sécurité si le webhook
 * rate).
 *
 * Le MONTANT ENCAISSÉ remonte avec le statut : « succeeded » dit que de
 * l'argent est arrivé, pas combien. C'est ce montant-là que la commande doit
 * valoir pour être marquée payée (markOrderPaid).
 *
 * Le client_secret remonte aussi : c'est lui qui prouve, au retour d'un moyen
 * de paiement à redirection, que le navigateur qui revient est bien celui qui
 * a payé (secretClientConcorde). Il ne repart jamais tel quel vers personne.
 */
export async function getStripeIntent(
  cles: ClesStripe,
  id: string,
): Promise<{
  status: string;
  montantCents: number;
  devise: string;
  clientSecret: string;
}> {
  const res = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${cles.cleSecrete.devoiler()}` },
  });
  if (!res.ok)
    throw new Error(`Stripe get intent HTTP ${res.status} ${await res.text()}`);
  const j = (await res.json()) as {
    status: string;
    amount_received?: number;
    currency?: string;
    client_secret?: string;
  };
  return {
    status: j.status,
    montantCents: Number(j.amount_received ?? 0),
    devise: String(j.currency ?? ""),
    clientSecret: String(j.client_secret ?? ""),
  };
}

/**
 * Le retour d'un moyen de paiement À REDIRECTION (Bancontact, iDEAL, Klarna…,
 * selon ce que la boutique active chez Stripe) : Stripe renvoie la cliente
 * sur la caisse avec ?payment_intent=…&payment_intent_client_secret=…
 * &redirect_status=…
 *
 * L'identifiant seul ne suffit pas à dire « c'est moi qui ai payé » : il
 * passe dans les journaux, les tableaux de bord, les avis. Le client_secret,
 * lui, n'a été remis qu'au navigateur de la caisse ; on le compare à celui
 * que Stripe garde, en temps constant. Vide d'un côté ou de l'autre : refusé.
 */
export function secretClientConcorde(attendu: string, recu: string): boolean {
  if (!attendu || !recu) return false;
  const a = Buffer.from(attendu);
  const b = Buffer.from(recu);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Ce que la caisse affiche au retour d'une redirection. */
export type IssueRetourStripe = "payee" | "en_cours" | "refuse";

/**
 * L'écran du retour, d'après ce que le SERVEUR sait — jamais d'après le
 * redirect_status de l'adresse, que n'importe qui peut écrire.
 *
 *  - commande payée (à l'instant, ou déjà par le webhook) : « confirmée » ;
 *  - intention « processing » (la banque n'a pas encore répondu : SEPA,
 *    certains virements), ou « succeeded » sans que la commande ait pu
 *    passer payée (un écart de montant, que le journal de la commande
 *    signale à la boutique) : « en cours de validation ». L'argent est pris
 *    ou en passe de l'être : surtout ne pas inviter à payer une seconde fois ;
 *  - tout le reste (requires_payment_method après un refus, canceled, une
 *    authentification abandonnée) : « refusé », le panier est gardé et la
 *    commande, toujours en attente, se repaie depuis la caisse.
 */
export function issueDuRetour(
  statutIntention: string,
  statutCommande: string,
): IssueRetourStripe {
  if (statutCommande === "paid") return "payee";
  if (statutIntention === "succeeded" || statutIntention === "processing")
    return "en_cours";
  return "refuse";
}

/**
 * Rend l'argent au client sur le moyen de paiement d'origine.
 *
 * `amountCents` permet le remboursement PARTIEL : sans lui Stripe rendrait
 * tout, ce qui n'est presque jamais ce qu'on veut quand une seule affiche
 * d'une commande pose problème.
 */
export async function refundStripe(
  cles: ClesStripe,
  paymentIntentId: string,
  amountCents: number,
): Promise<{ id: string; status: string }> {
  const body = new URLSearchParams();
  body.set("payment_intent", paymentIntentId);
  body.set("amount", String(amountCents));
  const res = await fetch("https://api.stripe.com/v1/refunds", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cles.cleSecrete.devoiler()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok)
    throw new Error(`Stripe refund HTTP ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { id: string; status: string };
  return { id: j.id, status: j.status };
}

export interface StripeEvent {
  type: string;
  livemode?: boolean;
  data: { object: Record<string, unknown> };
}

/**
 * Vérifie la signature d'un webhook Stripe (en-tête `Stripe-Signature`) sur le
 * corps BRUT, et renvoie l'événement parsé — ou null si invalide.
 * Reproduit l'algo officiel : HMAC-SHA256 de `${t}.${rawBody}` avec le secret
 * `whsec_…`, comparaison à v1 en temps constant, tolérance 5 min sur t.
 *
 * PLUSIEURS SECRETS : celui du mode actif, et l'autre, pour qu'un paiement
 * ouvert juste avant une bascule ne se perde pas. Chaque secret arrive avec
 * son mode, et `modeSecret` dit lequel a reconnu la signature : C'EST LUI qui
 * dit de quel côté de Stripe vient l'avis. Le `livemode` du corps n'est
 * qu'une affirmation de l'avis sur lui-même : quiconque détient le secret de
 * TEST — et ils circulent bien plus que les vrais — peut signer un corps qui
 * se dit « live ». configurator-routes.ts refuse un avis dont l'affirmation
 * contredit son secret (avisIncoherent).
 *
 * Deux secrets de modes différents qui reconnaissent la même signature (la
 * même valeur dans les deux colonnes, ce que l'écran refuse pourtant) : le
 * mode retenu est « test », le moins sûr des deux.
 *
 * PLUSIEURS SIGNATURES : quand on renouvelle le secret dans Stripe, l'en-tête
 * porte deux « v1 » pendant 24 heures. L'ancienne lecture n'en gardait que le
 * dernier, et refusait l'avis si c'était celui de l'autre secret.
 */
export function verifyStripeEvent(
  rawBody: string,
  sigHeader: string | undefined,
  secrets: readonly { mode: Mode; secret: Secret }[],
  maintenant: number = Date.now(),
): { event: StripeEvent; livemode: boolean; modeSecret: Mode } | null {
  if (!secrets.length || !sigHeader) return null;
  let t = "";
  const signatures: string[] = [];
  for (const kv of sigHeader.split(",")) {
    const i = kv.indexOf("=");
    if (i <= 0) continue;
    const cle = kv.slice(0, i).trim();
    const valeur = kv.slice(i + 1).trim();
    if (cle === "t") t = valeur;
    else if (cle === "v1" && valeur) signatures.push(valeur);
  }
  if (!t || !signatures.length) return null;
  if (Math.abs(Math.floor(maintenant / 1000) - Number(t)) > 60 * 5) return null;
  const modes = new Set<Mode>();
  for (const { mode, secret } of secrets) {
    const attendue = Buffer.from(
      createHmac("sha256", secret.devoiler()).update(`${t}.${rawBody}`).digest("hex"),
    );
    for (const v1 of signatures) {
      const recue = Buffer.from(v1);
      // Toutes les comparaisons se font, même après une réussite : le temps de
      // réponse ne dit pas quel secret a signé.
      if (recue.length === attendue.length && timingSafeEqual(recue, attendue)) modes.add(mode);
    }
  }
  if (!modes.size) return null;
  try {
    const event = JSON.parse(rawBody) as StripeEvent;
    return {
      event,
      livemode: event.livemode === true,
      modeSecret: modes.has("test") ? "test" : "live",
    };
  } catch {
    return null;
  }
}

/**
 * L'avis contredit-il le secret qui l'a signé ? Un avis signé avec le secret
 * de test qui se dit « live » (ou l'inverse) n'est pas traité : c'est un
 * faux, ou le secret du webhook collé dans la mauvaise colonne.
 */
export function avisIncoherent(v: { modeSecret: Mode; livemode: boolean }): boolean {
  return (v.modeSecret === "live") !== v.livemode;
}

/**
 * Un avis de paiement abouti, venu de l'AUTRE mode que celui où la boutique
 * encaisse, n'est traité que s'il porte sur un paiement que NOUS avons ouvert
 * dans ce mode-là, pour cette commande-là : même référence, même mode, et la
 * commande de la ligne payment est bien celle que l'avis désigne. Sans ce
 * dernier point, la référence d'un vieux paiement d'essai, recopiée dans un
 * avis avec le numéro d'une autre commande, ferait passer celle-ci « payée ».
 */
export function avisAutreModeRecevable(
  mode: Mode,
  ligne: { mode: Mode; orderId: number } | null | undefined,
  orderId: number,
): boolean {
  return Boolean(ligne && ligne.mode === mode && ligne.orderId === orderId);
}

/* -------------------------------------------------------------------------- */
/*  PayPal (REST)                                                             */
/* -------------------------------------------------------------------------- */

/** L'adresse de l'API PayPal du côté demandé : bac à sable ou compte réel. */
export function basePaypal(mode: Mode): string {
  return mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

/** Jeton OAuth2 client_credentials PayPal (courte durée, pas mis en cache). */
async function paypalToken(cles: ClesPaypal): Promise<string> {
  const auth = Buffer.from(`${cles.clientId}:${cles.secret.devoiler()}`).toString(
    "base64",
  );
  const res = await fetch(`${basePaypal(cles.mode)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok)
    throw new Error(`PayPal token HTTP ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string };
  return j.access_token;
}

/**
 * Crée une commande PayPal (intent CAPTURE) pour `amountCents` (EUR).
 * `reference` = numéro de commande interne (traçabilité). Renvoie l'id PayPal
 * (le navigateur l'approuve via les boutons PayPal, puis on capture).
 */
export async function createPaypalOrder(
  cles: ClesPaypal,
  amountCents: number,
  reference: string,
): Promise<string> {
  const token = await paypalToken(cles);
  const res = await fetch(`${basePaypal(cles.mode)}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: reference,
          amount: {
            currency_code: "EUR",
            value: (amountCents / 100).toFixed(2),
          },
        },
      ],
    }),
  });
  if (!res.ok) throw await refusPaypal(res);
  const j = (await res.json()) as { id: string };
  return j.id;
}

/**
 * Un refus de PayPal, traduit.
 *
 * PayPal range la vraie cause dans `details[].issue`, un mot en majuscules
 * anglaises, sous un message générique qui ne dit rien. Les plus fréquentes
 * ne sont pas des pannes mais des états du COMPTE, et chacune appelle un
 * geste précis : aucune ligne de code ne les répare.
 */
export class RefusPaypal extends Error {
  constructor(
    readonly issue: string,
    readonly explication: string,
    readonly brut: string,
  ) {
    super(`PayPal a refusé : ${issue || "raison inconnue"} — ${explication}`);
    this.name = "RefusPaypal";
  }
}

const RAISONS: Record<string, string> = {
  PAYEE_ACCOUNT_RESTRICTED:
    "Le compte PayPal de la boutique est restreint : PayPal lui interdit d'encaisser tant qu'une vérification n'est pas faite. Connectez-vous sur paypal.com et regardez les notifications ou le centre de résolution.",
  PAYEE_ACCOUNT_LOCKED_OR_CLOSED:
    "Le compte PayPal de la boutique est bloqué ou fermé. Rien ne peut être encaissé avant de le rouvrir avec PayPal.",
  PAYEE_ACCOUNT_INVALID:
    "Le compte destinataire déclaré n'est pas reconnu par PayPal. Vérifiez que les identifiants viennent bien du compte de la boutique.",
  CURRENCY_NOT_SUPPORTED:
    "Le compte PayPal de la boutique n'accepte pas l'euro. Ajoutez cette devise dans les réglages du compte.",
  PERMISSION_DENIED:
    "L'application PayPal n'a pas le droit de créer des paiements. Regardez les autorisations de l'application sur developer.paypal.com.",
  INVALID_RESOURCE_ID:
    "PayPal ne retrouve pas ce paiement. Il a peut-être expiré : refaites la commande.",
  INSTRUMENT_DECLINED:
    "Le moyen de paiement du client a été refusé. C'est au client de réessayer avec un autre.",
};

async function refusPaypal(res: Response): Promise<RefusPaypal> {
  const brut = await res.text();
  let issue = "";
  try {
    const j = JSON.parse(brut) as {
      name?: string;
      details?: { issue?: string }[];
    };
    issue = j.details?.[0]?.issue ?? j.name ?? "";
  } catch {
    // Une réponse qui n'est pas du JSON : on garde le texte tel quel.
  }
  const explication =
    RAISONS[issue] ??
    `PayPal a répondu ${res.status} sans raison connue de nous. Le détail est dans le journal du serveur.`;
  console.error("[paypal] refus", issue || res.status, brut.slice(0, 500));
  return new RefusPaypal(issue, explication, brut.slice(0, 1000));
}

/**
 * Capture une commande PayPal approuvée. Renvoie ok=true si COMPLETED.
 *
 * Le montant a été fixé à la création, côté serveur — mais pour le panier
 * de CE moment-là. Le montant réellement capturé remonte donc aussi : c'est
 * lui que la commande doit valoir pour être marquée payée (markOrderPaid).
 */
export async function capturePaypalOrder(
  cles: ClesPaypal,
  paypalOrderId: string,
): Promise<{
  ok: boolean;
  status: string;
  captureId: string | null;
  montantCents: number;
  devise: string;
}> {
  const token = await paypalToken(cles);
  const res = await fetch(
    `${basePaypal(cles.mode)}/v2/checkout/orders/${paypalOrderId}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
  );
  if (!res.ok) throw await refusPaypal(res);
  const j = (await res.json()) as ReponsePaypalCommande;
  return {
    ok: j.status === "COMPLETED",
    status: j.status,
    // L'identifiant de la CAPTURE, pas celui de la commande : c'est lui, et
    // lui seul, que PayPal accepte de rembourser plus tard.
    captureId: captureDe(j),
    ...montantCapture(j),
  };
}

/** La forme, réduite au nécessaire, de ce que PayPal rend sur une commande. */
interface ReponsePaypalCommande {
  status: string;
  purchase_units?: {
    payments?: {
      captures?: {
        id?: string;
        status?: string;
        amount?: { currency_code?: string; value?: string };
      }[];
    };
  }[];
}

/**
 * Ce qui a réellement été capturé : la somme des captures abouties.
 *
 * PayPal écrit les montants en texte décimal (« 19.00 ») : on repasse en
 * centimes en arrondissant, un nombre à virgule ne tombant jamais juste.
 * Deux devises différentes dans une même commande ne devraient pas exister ;
 * si c'était le cas, la devise rendue vide fait échouer la vérification.
 */
function montantCapture(j: ReponsePaypalCommande): { montantCents: number; devise: string } {
  let montantCents = 0;
  const devises = new Set<string>();
  for (const unite of j.purchase_units ?? [])
    for (const capture of unite.payments?.captures ?? []) {
      if (capture.status !== "COMPLETED" || !capture.amount) continue;
      montantCents += Math.round(Number(capture.amount.value ?? 0) * 100);
      devises.add(String(capture.amount.currency_code ?? ""));
    }
  return { montantCents, devise: devises.size === 1 ? [...devises][0]! : "" };
}

/** L'identifiant de la capture, quand il y en a une. */
function captureDe(j: ReponsePaypalCommande): string | null {
  for (const unite of j.purchase_units ?? [])
    for (const capture of unite.payments?.captures ?? [])
      if (capture.id) return capture.id;
  return null;
}

/**
 * Retrouve la capture d'une commande PayPal déjà encaissée.
 *
 * Sert aux ventes passées avant qu'on garde cet identifiant : sans lui, leur
 * premier remboursement échouerait sans qu'on comprenne pourquoi.
 */
export async function capturePaypalDeLaCommande(
  cles: ClesPaypal,
  paypalOrderId: string,
): Promise<string | null> {
  const token = await paypalToken(cles);
  const res = await fetch(`${basePaypal(cles.mode)}/v2/checkout/orders/${paypalOrderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return captureDe((await res.json()) as ReponsePaypalCommande);
}

/**
 * Rend l'argent d'une capture PayPal, en totalité ou en partie.
 *
 * PayPal ne rembourse pas une commande mais une CAPTURE : c'est la même
 * distinction que chez Stripe entre l'intention de paiement et le paiement.
 * Le montant part en euros avec deux décimales, la devise étant celle de la
 * boutique.
 */
export async function refundPaypal(
  cles: ClesPaypal,
  captureId: string,
  amountCents: number,
): Promise<{ id: string; status: string }> {
  const token = await paypalToken(cles);
  const res = await fetch(
    `${basePaypal(cles.mode)}/v2/payments/captures/${captureId}/refund`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: {
          currency_code: "EUR",
          value: (amountCents / 100).toFixed(2),
        },
      }),
    },
  );
  if (!res.ok) throw await refusPaypal(res);
  const j = (await res.json()) as { id: string; status: string };
  return { id: j.id, status: j.status };
}

/* -------------------------------------------------------------------------- */
/*  Le bouton « Vérifier » de BO › Réglages › Paiements                       */
/* -------------------------------------------------------------------------- */

/**
 * Ce que la vérification conclut, en clair. Jamais une clé : tout ce qui
 * vient d'un prestataire passe par `masquer`, et le jeton PayPal obtenu au
 * passage n'est ni gardé ni renvoyé.
 */
export interface VerdictCles {
  ok: boolean;
  message: string;
  /** Le compte reconnu (« Memory Line, acct_1H… »), quand il se lit. */
  compte: string | null;
}

interface OptionsVerification {
  /** Remplaçable dans les essais : aucun appel réseau n'y part. */
  fetch?: typeof fetch;
  delaiMs?: number;
}

/** Un appel au prestataire, borné dans le temps, qui ne lève pas. */
async function appeler(
  f: typeof fetch,
  url: string,
  init: RequestInit,
  delaiMs: number,
): Promise<{ statut: number; corps: unknown } | { statut: 0; corps: null; panne: string }> {
  try {
    const res = await f(url, { ...init, signal: AbortSignal.timeout(delaiMs) });
    const texte = await res.text();
    let corps: unknown = null;
    try {
      corps = JSON.parse(texte);
    } catch {
      corps = null;
    }
    return { statut: res.status, corps };
  } catch (e) {
    return { statut: 0, corps: null, panne: masquer(e instanceof Error ? e.message : e) };
  }
}

/** Le message d'erreur de Stripe, masqué. */
function messageStripe(corps: unknown): string {
  const m = (corps as { error?: { message?: unknown } } | null)?.error?.message;
  return m ? masquer(m) : "";
}

/** Une adresse comparable : sans « www. », sans barre finale, en minuscules. */
function adresseNormalisee(u: string): string {
  try {
    const x = new URL(u);
    return `${x.protocol}//${x.host.replace(/^www\./i, "").toLowerCase()}${x.pathname.replace(/\/+$/, "")}`;
  } catch {
    return u.trim().replace(/\/+$/, "").toLowerCase();
  }
}

/**
 * Les clés Stripe d'une colonne sont-elles bonnes ? UNIQUEMENT des lectures :
 * rien n'est créé chez Stripe, rien n'est payé.
 *
 *  1. GET /v1/balance : la clé est-elle acceptée, et de quel mode est le
 *     compte (`livemode`) ? Une clé refusée s'arrête là — un seul appel.
 *  2. GET /v1/account : à qui appartient le compte, et peut-il encaisser ?
 *  3. La clé publique : son préfixe, et si possible le même compte.
 *  4. GET /v1/webhook_endpoints : un webhook actif vise-t-il notre adresse,
 *     avec payment_intent.succeeded ? Exigé pour le réel, indicatif en essai.
 *
 * Une clé restreinte (rk_…) sans certains droits répond 403 : l'étape est
 * signalée « non lisible », jamais déclarée bonne.
 */
export async function verifierStripe(
  jeu: { mode: Mode; clePublique: string; cleSecrete: Secret; secretWebhook: Secret | null },
  opts: OptionsVerification & { adresseWebhook: string; local: boolean },
): Promise<VerdictCles> {
  const f = opts.fetch ?? fetch;
  const delai = opts.delaiMs ?? 10_000;
  const entete = { Authorization: `Bearer ${jeu.cleSecrete.devoiler()}` };
  const live = jeu.mode === "live";
  const remarques: string[] = [];
  const refus = (message: string, compte: string | null = null): VerdictCles => ({
    ok: false,
    message: [message, ...remarques].join(" "),
    compte,
  });

  const solde = await appeler(f, "https://api.stripe.com/v1/balance", { headers: entete }, delai);
  if (solde.statut === 0)
    return refus(`Stripe ne répond pas (${"panne" in solde ? solde.panne : "délai dépassé"}) : réessayez dans un instant.`);
  if (solde.statut === 401)
    return refus("Clé secrète refusée par Stripe (401 : clé inconnue ou révoquée). Recopiez-la depuis Stripe › Développeurs › Clés API.");
  if (solde.statut === 403) {
    remarques.push("Solde non lisible avec cette clé restreinte : le mode est déduit de son préfixe.");
  } else if (solde.statut !== 200) {
    return refus(`Stripe a répondu ${solde.statut}${messageStripe(solde.corps) ? ` : ${messageStripe(solde.corps)}` : ""}.`);
  } else {
    const livemode = (solde.corps as { livemode?: unknown } | null)?.livemode === true;
    if (livemode !== live)
      return refus(
        livemode
          ? "Cette clé est une clé LIVE : elle va dans la colonne « Pour de vrai »."
          : "Cette clé est une clé de TEST : elle va dans la colonne « Essai ».",
      );
  }

  // Le compte : son nom, et s'il peut déjà encaisser.
  let compte: string | null = null;
  let idCompte = "";
  const acct = await appeler(f, "https://api.stripe.com/v1/account", { headers: entete }, delai);
  if (acct.statut === 200) {
    const a = acct.corps as {
      id?: string;
      email?: string;
      charges_enabled?: boolean;
      business_profile?: { name?: string };
      settings?: { dashboard?: { display_name?: string } };
    } | null;
    idCompte = String(a?.id ?? "");
    const nom = a?.business_profile?.name || a?.settings?.dashboard?.display_name || a?.email || "";
    compte = masquer([nom, idCompte].filter(Boolean).join(", ")) || null;
    if (live && a?.charges_enabled === false)
      return refus(
        "Stripe n'autorise pas encore les paiements sur ce compte : terminez son activation dans le tableau de bord Stripe (identité, compte bancaire).",
        compte,
      );
  } else if (acct.statut === 403) {
    remarques.push("Clé acceptée, mais le compte n'est pas lisible avec une clé restreinte.");
  }

  // La clé publique : la bonne colonne, et si possible le même compte.
  if (!jeu.clePublique) {
    if (live) return refus("La clé publique (pk_live_…) manque : la carte ne pourrait pas s'afficher à la caisse.", compte);
    remarques.push("La clé publique manque : la carte ne s'affichera pas à la caisse.");
  } else if (!jeu.clePublique.startsWith(live ? "pk_live_" : "pk_test_")) {
    return refus(
      live
        ? "La clé publique n'est pas une clé live (pk_live_…) : elle ne va pas avec cette clé secrète."
        : "La clé publique n'est pas une clé de test (pk_test_…) : elle ne va pas avec cette clé secrète.",
      compte,
    );
  } else if (idCompte) {
    const court = idCompte.replace(/^acct_1?/, "");
    if (court.length >= 8 && jeu.clePublique.includes(court)) remarques.push("Clé publique du même compte ✓.");
    else
      remarques.push(
        "La clé publique n'a pas pu être rapprochée du compte : vérifiez qu'elle vient de la même page (Développeurs › Clés API).",
      );
  }

  // Le webhook : sans lui, une commande payée dont l'onglet s'est fermé
  // pendant la validation de la banque resterait « en attente ».
  if (live && !jeu.secretWebhook)
    return refus("Il manque le secret du webhook (whsec_…) de la colonne « Pour de vrai ».", compte);
  const hooks = await appeler(
    f,
    "https://api.stripe.com/v1/webhook_endpoints?limit=100",
    { headers: entete },
    delai,
  );
  if (hooks.statut === 200) {
    const cible = adresseNormalisee(opts.adresseWebhook);
    const liste = ((hooks.corps as { data?: unknown[] } | null)?.data ?? []) as {
      url?: string;
      status?: string;
      enabled_events?: string[];
    }[];
    const trouve = liste.some(
      (h) =>
        h.status !== "disabled" &&
        adresseNormalisee(String(h.url ?? "")) === cible &&
        (h.enabled_events ?? []).some((e) => e === "payment_intent.succeeded" || e === "*"),
    );
    if (trouve) remarques.push("Webhook trouvé ✓.");
    else if (live)
      return refus(
        `Aucun webhook actif de ce compte ne vise ${opts.adresseWebhook} avec l'événement payment_intent.succeeded : créez-le dans Stripe › Développeurs › Webhooks.`,
        compte,
      );
    else
      remarques.push(
        opts.local
          ? "En local, Stripe ne joint pas localhost : utilisez « stripe listen » (voir plus bas)."
          : `Aucun webhook de test ne vise ${opts.adresseWebhook} : sans lui, la commande se valide quand même au retour de la cliente.`,
      );
  } else if (hooks.statut === 403) {
    remarques.push("Liste des webhooks non lisible avec cette clé restreinte : vérifiez à la main dans Stripe que le webhook existe.");
  } else if (live) {
    return refus(`La liste des webhooks n'a pas pu être lue (réponse ${hooks.statut || "absente"}) : réessayez.`, compte);
  }

  return {
    ok: true,
    message: [
      `Clé valide${compte ? `, compte ${compte}` : ""} (${live ? "compte réel" : "mode test"}).`,
      ...remarques,
    ].join(" "),
    compte,
  };
}

/**
 * Les identifiants PayPal d'une colonne sont-ils bons ? Un jeton OAuth
 * demandé du côté de la colonne (bac à sable ou réel), rien d'autre : aucun
 * paiement n'est créé, et le jeton obtenu est jeté aussitôt.
 *
 * Refusés, on essaie l'autre côté, comme scripts/verifier-paypal.ts : la
 * confusion la plus fréquente est d'avoir les bons identifiants dans la
 * mauvaise colonne.
 */
export async function verifierPaypal(
  jeu: { mode: Mode; clientId: string; clientIdNavigateur: string; secret: Secret },
  opts: OptionsVerification = {},
): Promise<VerdictCles> {
  const f = opts.fetch ?? fetch;
  const delai = opts.delaiMs ?? 10_000;
  const auth = Buffer.from(`${jeu.clientId}:${jeu.secret.devoiler()}`).toString("base64");
  const demander = (mode: Mode) =>
    appeler(
      f,
      `${basePaypal(mode)}/v1/oauth2/token`,
      {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials",
      },
      delai,
    );
  const live = jeu.mode === "live";
  const cote = live ? "compte réel" : "bac à sable";

  const r = await demander(jeu.mode);
  if (r.statut === 0)
    return { ok: false, message: `PayPal ne répond pas (${"panne" in r ? r.panne : "délai dépassé"}) : réessayez dans un instant.`, compte: null };
  if (r.statut === 200) {
    const appId = masquer((r.corps as { app_id?: unknown } | null)?.app_id ?? "");
    if (jeu.clientIdNavigateur !== jeu.clientId)
      return {
        ok: false,
        message: `Identifiants reconnus par PayPal (${cote}), mais PUBLIC_PAYPAL_CLIENT_ID diffère de PAYPAL_CLIENT_ID dans le .env : le navigateur chargerait PayPal avec une autre application. Mettez la même valeur, ou saisissez les identifiants ici.`,
        compte: appId || null,
      };
    return {
      ok: true,
      message: `Identifiants reconnus par PayPal (${cote})${appId ? `, application ${appId}` : ""}.`,
      compte: appId || null,
    };
  }
  if (r.statut === 401 || r.statut === 400) {
    const autre: Mode = live ? "test" : "live";
    const r2 = await demander(autre);
    if (r2.statut === 200)
      return {
        ok: false,
        message: live
          ? "Ces identifiants sont ceux du bac à sable : ils vont dans la colonne « Essai »."
          : "Ces identifiants sont ceux du compte réel : ils vont dans la colonne « Pour de vrai ».",
        compte: null,
      };
    return {
      ok: false,
      message: `PayPal ne reconnaît pas ces identifiants (${r.statut}), ni d'un côté ni de l'autre : une valeur tronquée à la copie, ou un secret régénéré depuis. Reprenez-les sur developer.paypal.com › Apps & Credentials.`,
      compte: null,
    };
  }
  return { ok: false, message: `PayPal a répondu ${r.statut} : réessayez dans un instant.`, compte: null };
}
