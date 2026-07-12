/**
 * Intégrations de paiement (canal web §11) — Stripe & PayPal.
 *
 * Volontairement SANS SDK : tout passe par l'API REST des prestataires via
 * `fetch`, et la signature du webhook Stripe est vérifiée avec `node:crypto`.
 * Aucune dépendance npm supplémentaire, et le même style pour les deux.
 *
 * Les clés sont lues dans l'environnement (voir .env.example). Si un
 * prestataire n'est pas configuré, `*Configured` vaut false et les routes le
 * signalent proprement (503) au lieu de planter.
 *
 * IMPORTANT : ce module ne connaît RIEN de la base ni des commandes — il ne
 * fait que parler aux prestataires. La logique « marquer la commande payée +
 * générer les PDF » vit dans configurator-routes.ts (markOrderPaid).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/* -------------------------------------------------------------------------- */
/*  Stripe (REST)                                                             */
/* -------------------------------------------------------------------------- */

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

/** true si la clé secrète Stripe est fournie. */
export const stripeConfigured = Boolean(STRIPE_SECRET);
/** true si le secret de webhook Stripe est fourni (sinon on ne peut pas vérifier). */
export const stripeWebhookConfigured = Boolean(STRIPE_WEBHOOK_SECRET);

/**
 * Crée un PaymentIntent Stripe pour `amountCents` (EUR). `orderId` est mis en
 * metadata pour que le webhook retrouve la commande. Renvoie l'id du PI et son
 * client_secret (à confirmer côté navigateur avec Stripe.js).
 */
export async function createStripeIntent(
  amountCents: number,
  orderId: number,
  orderNumber: string,
): Promise<{ id: string; clientSecret: string }> {
  if (!STRIPE_SECRET) throw new Error("Stripe non configuré");
  const body = new URLSearchParams();
  body.set("amount", String(amountCents));
  body.set("currency", "eur");
  body.set("automatic_payment_methods[enabled]", "true");
  body.set("metadata[orderId]", String(orderId));
  body.set("metadata[orderNumber]", orderNumber);
  const res = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET}`,
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
 * Statut serveur d'un PaymentIntent (pour confirmer un paiement SANS attendre
 * le webhook — pratique en dev, et filet de sécurité si le webhook rate).
 */
export async function getStripeIntentStatus(id: string): Promise<string> {
  if (!STRIPE_SECRET) throw new Error("Stripe non configuré");
  const res = await fetch(`https://api.stripe.com/v1/payment_intents/${id}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET}` },
  });
  if (!res.ok)
    throw new Error(`Stripe get intent HTTP ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { status: string };
  return j.status;
}

export interface StripeEvent {
  type: string;
  data: { object: Record<string, unknown> };
}

/**
 * Vérifie la signature d'un webhook Stripe (en-tête `Stripe-Signature`) sur le
 * corps BRUT, et renvoie l'événement parsé — ou null si invalide.
 * Reproduit l'algo officiel : HMAC-SHA256 de `${t}.${rawBody}` avec le secret
 * `whsec_…`, comparaison à v1 en temps constant, tolérance 5 min sur t.
 */
export function verifyStripeEvent(
  rawBody: string,
  sigHeader: string | undefined,
): StripeEvent | null {
  if (!STRIPE_WEBHOOK_SECRET || !sigHeader) return null;
  const parts: Record<string, string> = {};
  for (const kv of sigHeader.split(",")) {
    const i = kv.indexOf("=");
    if (i > 0) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return null;
  const expected = createHmac("sha256", STRIPE_WEBHOOK_SECRET)
    .update(`${t}.${rawBody}`)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(t)) > 60 * 5) return null;
  try {
    return JSON.parse(rawBody) as StripeEvent;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*  PayPal (REST)                                                             */
/* -------------------------------------------------------------------------- */

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_SECRET;
const PAYPAL_LIVE = process.env.PAYPAL_ENV === "live";
const PAYPAL_BASE = PAYPAL_LIVE
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

/** true si l'app PayPal (client id + secret) est configurée. */
export const paypalConfigured = Boolean(PAYPAL_CLIENT_ID && PAYPAL_SECRET);

/** Jeton OAuth2 client_credentials PayPal (courte durée, pas mis en cache). */
async function paypalToken(): Promise<string> {
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString(
    "base64",
  );
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
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
  amountCents: number,
  reference: string,
): Promise<string> {
  if (!paypalConfigured) throw new Error("PayPal non configuré");
  const token = await paypalToken();
  const res = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
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
  if (!res.ok)
    throw new Error(`PayPal create HTTP ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { id: string };
  return j.id;
}

/**
 * Capture une commande PayPal approuvée. Renvoie ok=true si COMPLETED.
 * Le montant réel a été fixé à la création côté serveur (non falsifiable).
 */
export async function capturePaypalOrder(
  paypalOrderId: string,
): Promise<{ ok: boolean; status: string }> {
  if (!paypalConfigured) throw new Error("PayPal non configuré");
  const token = await paypalToken();
  const res = await fetch(
    `${PAYPAL_BASE}/v2/checkout/orders/${paypalOrderId}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
  );
  if (!res.ok)
    throw new Error(`PayPal capture HTTP ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { status: string };
  return { ok: j.status === "COMPLETED", status: j.status };
}
