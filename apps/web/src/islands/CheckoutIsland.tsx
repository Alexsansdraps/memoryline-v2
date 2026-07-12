/// <reference lib="dom" />
import {
  createResource,
  createSignal,
  createEffect,
  Show,
  For,
  type JSX,
} from "solid-js";
import { loadStripe } from "@stripe/stripe-js";
import type { Stripe, StripeElements } from "@stripe/stripe-js";
import {
  browserApi,
  formatPrice,
  getCartId,
  PUBLIC_API_URL,
} from "../lib/api.ts";

/**
 * Tunnel de commande (§11 — canal web), en DEUX phases :
 *  1. Coordonnées (nom + email) + choix du moyen de paiement.
 *  2. Paiement : on crée la commande (statut `pending`, montant serveur),
 *     puis on monte le widget du moyen choisi :
 *       - Stripe : Payment Element (Stripe.js) sur un clientSecret.
 *       - PayPal : boutons du SDK PayPal (create order -> approve -> capture).
 *
 * La commande n'est marquée « payée » (et les PDF générés) qu'APRÈS
 * encaissement, côté serveur (webhook / confirm Stripe, capture PayPal).
 *
 * Les moyens réellement actifs + leurs clés PUBLIQUES viennent de
 * GET /payments/config (l'API lit le .env). Si aucun n'est configuré, on le
 * signale clairement au lieu de laisser un bouton mort.
 */

type Method = "stripe" | "paypal";

/* --- SDK PayPal (chargé dynamiquement, non typé) ------------------------- */
interface PayPalButtonsConfig {
  createOrder: () => Promise<string>;
  onApprove: (data: { orderID: string }) => Promise<void>;
  onError?: (err: unknown) => void;
  onCancel?: () => void;
}
interface PayPalNamespace {
  Buttons: (cfg: PayPalButtonsConfig) => {
    render: (target: HTMLElement) => Promise<void>;
  };
}
declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

let paypalSdk: Promise<PayPalNamespace> | null = null;
function loadPaypalSdk(clientId: string): Promise<PayPalNamespace> {
  if (window.paypal) return Promise.resolve(window.paypal);
  if (paypalSdk) return paypalSdk;
  paypalSdk = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(
      clientId,
    )}&currency=EUR`;
    s.onload = () =>
      window.paypal
        ? resolve(window.paypal)
        : reject(new Error("SDK PayPal indisponible"));
    s.onerror = () => reject(new Error("Chargement du SDK PayPal échoué"));
    document.head.appendChild(s);
  });
  return paypalSdk;
}

export default function CheckoutIsland(): JSX.Element {
  const [name, setName] = createSignal("");
  const [email, setEmail] = createSignal("");
  const [method, setMethod] = createSignal<Method | null>(null);
  const [phase, setPhase] = createSignal<"details" | "pay">("details");
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [orderNumber, setOrderNumber] = createSignal<string | null>(null);
  const [orderId, setOrderId] = createSignal<number | null>(null);

  // Config paiement (moyens actifs + clés publiques).
  const [config] = createResource(async () => browserApi.paymentsConfig());
  // Récapitulatif du panier (lecture seule).
  const [cart] = createResource(async () => browserApi.cart(getCartId()));
  const subtotal = () =>
    (cart()?.items ?? []).reduce(
      (s, it) => s + it.unitPriceCents * it.quantity,
      0,
    );

  // Promos actives — répliquées à l'identique du serveur (computeOrderTotalCents)
  // et du panier, pour que le montant AFFICHÉ = le montant FACTURÉ.
  const [promos] = createResource(async () => {
    try {
      const res = await fetch(`${PUBLIC_API_URL}/promos`);
      return res.ok
        ? ((await res.json()) as {
            type: string;
            config?: { buyQty?: number; getQty?: number };
          }[])
        : [];
    } catch {
      return [];
    }
  });
  const discount = () => {
    const units: number[] = [];
    for (const it of cart()?.items ?? [])
      for (let k = 0; k < it.quantity; k++) units.push(it.unitPriceCents);
    units.sort((a, b) => a - b);
    let amount = 0;
    for (const p of promos() ?? []) {
      if (p.type !== "buy_x_get_y") continue;
      const buyQty = p.config?.buyQty ?? 3;
      const getQty = p.config?.getQty ?? 1;
      const freeCount = Math.floor(units.length / buyQty) * getQty;
      for (let i = 0; i < freeCount && i < units.length; i++) amount += units[i]!;
    }
    return amount;
  };
  /** Montant réellement dû (= ce que débitera Stripe/PayPal). */
  const total = () => Math.max(0, subtotal() - discount());

  const methods = (): Method[] => {
    const c = config();
    const list: Method[] = [];
    if (c?.stripe) list.push("stripe");
    if (c?.paypal) list.push("paypal");
    return list;
  };
  // Sélection par défaut = 1er moyen disponible.
  createEffect(() => {
    if (method() === null && methods().length > 0) setMethod(methods()[0]!);
  });

  const emailValid = () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email().trim());
  const formValid = () => name().trim().length > 0 && emailValid();

  /* --- Stripe --------------------------------------------------------- */
  let stripe: Stripe | null = null;
  let elements: StripeElements | null = null;
  let stripeMountRef: HTMLDivElement | undefined;
  const [stripeClientSecret, setStripeClientSecret] = createSignal<
    string | null
  >(null);

  // Monte le Payment Element dès qu'on est en phase paiement + Stripe prêt.
  createEffect(() => {
    if (
      phase() === "pay" &&
      method() === "stripe" &&
      stripe &&
      stripeClientSecret() &&
      stripeMountRef &&
      !elements
    ) {
      elements = stripe.elements({
        clientSecret: stripeClientSecret()!,
        appearance: { theme: "stripe" },
      });
      elements.create("payment").mount(stripeMountRef);
    }
  });

  /* --- PayPal --------------------------------------------------------- */
  let paypalMountRef: HTMLDivElement | undefined;
  let paypalRendered = false;

  createEffect(() => {
    const cfg = config()?.paypal;
    if (
      phase() === "pay" &&
      method() === "paypal" &&
      cfg &&
      paypalMountRef &&
      !paypalRendered
    ) {
      paypalRendered = true;
      loadPaypalSdk(cfg.clientId)
        .then((pp) =>
          pp
            .Buttons({
              createOrder: async () => {
                const oid = orderId();
                if (oid == null) throw new Error("Commande manquante");
                const { paypalOrderId } = await browserApi.paypalOrder(oid);
                return paypalOrderId;
              },
              onApprove: async (data) => {
                const oid = orderId();
                if (oid == null) return;
                try {
                  await browserApi.paypalCapture(oid, data.orderID);
                  finishSuccess();
                } catch (e) {
                  setError(String(e));
                }
              },
              onError: (e) => setError(String(e)),
            })
            .render(paypalMountRef!),
        )
        .catch((e) => {
          paypalRendered = false;
          setError(String(e));
        });
    }
  });

  /* --- Flux --------------------------------------------------------------- */

  function finishSuccess() {
    localStorage.removeItem("ml_cart_id");
    setPhase("details");
    // orderNumber déjà en mémoire -> l'écran « Merci » s'affiche via <Show>.
    setSubmitting(false);
    // Marque la commande comme finalisée pour l'affichage.
    setPaid(true);
  }
  const [paid, setPaid] = createSignal(false);

  /** Phase 1 -> 2 : crée la commande (pending) puis prépare le moyen choisi. */
  async function goToPay(e: Event) {
    e.preventDefault();
    if (!formValid() || !method() || submitting()) return;
    setSubmitting(true);
    setError(null);
    try {
      const order = await browserApi.createOrder(getCartId(), {
        name: name().trim(),
        email: email().trim(),
      });
      setOrderId(order.orderId);
      setOrderNumber(order.number);

      if (method() === "stripe") {
        const cfg = config()?.stripe;
        if (!cfg) throw new Error("Stripe non disponible");
        stripe = await loadStripe(cfg.publicKey);
        if (!stripe) throw new Error("Stripe indisponible");
        const { clientSecret } = await browserApi.stripeIntent(order.orderId);
        setStripeClientSecret(clientSecret);
      }
      // PayPal : les boutons se rendent via l'effet une fois en phase "pay".
      setPhase("pay");
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  /** Retour à la saisie : on démonte les widgets pour repartir propre. */
  function backToDetails() {
    elements = null;
    setStripeClientSecret(null);
    paypalRendered = false;
    if (paypalMountRef) paypalMountRef.innerHTML = "";
    setPhase("details");
    setError(null);
  }

  /** Confirmation Stripe (carte). */
  async function payStripe() {
    if (!stripe || !elements || submitting()) return;
    setSubmitting(true);
    setError(null);
    try {
      const { error: stripeErr, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
        confirmParams: { return_url: `${window.location.origin}/commande` },
      });
      if (stripeErr) {
        setError(stripeErr.message ?? "Paiement refusé.");
        return;
      }
      if (paymentIntent && paymentIntent.status === "succeeded") {
        const oid = orderId();
        if (oid != null) await browserApi.stripeConfirm(oid);
        finishSuccess();
      } else {
        setError("Paiement non finalisé. Réessayez.");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Show
      when={!paid()}
      fallback={
        <div class="rounded-2xl border border-sage/40 bg-sage/10 p-8 text-center">
          <h2 class="font-serif text-3xl">Merci !</h2>
          <p class="mt-3 text-ink-soft">
            Votre paiement a bien été reçu et votre commande est confirmée.
          </p>
          <p class="mt-4 text-lg">
            Numéro de commande :{" "}
            <span class="font-serif text-2xl">{orderNumber()}</span>
          </p>
          <a
            href="/affiches"
            class="mt-6 inline-block rounded-full bg-terracotta px-6 py-3 text-paper font-medium hover:bg-terracotta-deep transition-colors"
          >
            Retour aux affiches
          </a>
        </div>
      }
    >
      <Show when={cart() && cart()!.items.length === 0}>
        <div class="rounded-2xl border border-ink/10 bg-paper-deep/40 p-8 text-center">
          <p class="text-ink-soft">Votre panier est vide.</p>
          <a
            href="/affiches"
            class="mt-6 inline-block rounded-full bg-terracotta px-6 py-3 text-paper font-medium hover:bg-terracotta-deep transition-colors"
          >
            Découvrir les affiches
          </a>
        </div>
      </Show>

      <Show when={cart() && cart()!.items.length > 0}>
        <div class="grid lg:grid-cols-[1fr_320px] gap-8 items-start">
          <div class="space-y-8">
            {/* Coordonnées */}
            <fieldset class="space-y-4" disabled={phase() === "pay"}>
              <legend class="font-serif text-2xl mb-2">Vos coordonnées</legend>
              <label class="block">
                <span class="text-sm font-medium">Nom complet</span>
                <input
                  type="text"
                  required
                  value={name()}
                  onInput={(e) => setName(e.currentTarget.value)}
                  class="mt-1 w-full rounded-lg border border-ink/20 bg-paper px-4 py-3 focus:border-terracotta focus:outline-none disabled:opacity-60"
                  placeholder="Camille Durand"
                />
              </label>
              <label class="block">
                <span class="text-sm font-medium">E-mail</span>
                <input
                  type="email"
                  required
                  value={email()}
                  onInput={(e) => setEmail(e.currentTarget.value)}
                  class="mt-1 w-full rounded-lg border border-ink/20 bg-paper px-4 py-3 focus:border-terracotta focus:outline-none disabled:opacity-60"
                  placeholder="camille@example.com"
                />
                <Show when={email().length > 0 && !emailValid()}>
                  <span class="mt-1 block text-xs text-terracotta-deep">
                    E-mail invalide.
                  </span>
                </Show>
              </label>
            </fieldset>

            {/* Paiement */}
            <fieldset class="space-y-4">
              <legend class="font-serif text-2xl mb-2">Paiement</legend>

              {/* Aucun moyen configuré */}
              <Show when={config() && methods().length === 0}>
                <div class="rounded-lg border border-dashed border-terracotta/40 bg-terracotta/5 p-4 text-sm text-ink-soft">
                  Le paiement en ligne n'est pas encore activé. Ajoutez vos clés
                  Stripe et/ou PayPal dans le fichier <code>.env</code> pour
                  l'activer.
                </div>
              </Show>

              <Show when={methods().length > 0}>
                {/* Onglets moyens de paiement */}
                <div class="flex gap-3">
                  <For each={methods()}>
                    {(m) => (
                      <button
                        type="button"
                        disabled={phase() === "pay"}
                        onClick={() => setMethod(m)}
                        class={`flex-1 rounded-lg border px-4 py-3 text-sm font-medium transition-colors disabled:opacity-60 ${
                          method() === m
                            ? "border-terracotta bg-terracotta/10"
                            : "border-ink/20 hover:border-ink"
                        }`}
                      >
                        {m === "stripe" ? "Carte bancaire" : "PayPal"}
                      </button>
                    )}
                  </For>
                </div>

                {/* Phase 1 : bouton continuer */}
                <Show when={phase() === "details"}>
                  <button
                    type="button"
                    onClick={goToPay}
                    disabled={!formValid() || !method() || submitting()}
                    class="w-full rounded-full bg-terracotta px-8 py-4 text-paper font-medium hover:bg-terracotta-deep transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting()
                      ? "Préparation…"
                      : `Continuer vers le paiement · ${formatPrice(total())}`}
                  </button>
                </Show>

                {/* Phase 2 : widget du moyen choisi */}
                <Show when={phase() === "pay"}>
                  <Show when={method() === "stripe"}>
                    <div class="rounded-lg border border-ink/15 bg-paper p-4">
                      <div ref={stripeMountRef} />
                    </div>
                    <button
                      type="button"
                      onClick={payStripe}
                      disabled={submitting()}
                      class="w-full rounded-full bg-terracotta px-8 py-4 text-paper font-medium hover:bg-terracotta-deep transition-colors disabled:opacity-50"
                    >
                      {submitting() ? "Paiement…" : `Payer ${formatPrice(total())}`}
                    </button>
                  </Show>

                  <Show when={method() === "paypal"}>
                    <div
                      ref={paypalMountRef}
                      class="rounded-lg border border-ink/15 bg-paper p-4 min-h-[52px]"
                    />
                  </Show>

                  <button
                    type="button"
                    onClick={backToDetails}
                    class="text-sm text-ink-soft hover:text-terracotta"
                  >
                    ← Modifier mes coordonnées
                  </button>
                </Show>
              </Show>

              <Show when={error()}>
                <p class="rounded-lg bg-terracotta/10 px-4 py-3 text-sm text-terracotta-deep">
                  {error()}
                </p>
              </Show>
            </fieldset>
          </div>

          {/* Récapitulatif */}
          <aside class="rounded-2xl border border-ink/10 bg-paper-deep/40 p-6 lg:sticky lg:top-24">
            <h2 class="font-serif text-xl mb-4">Récapitulatif</h2>
            <ul class="space-y-3 text-sm">
              <For each={cart()?.items ?? []}>
                {(it) => (
                  <li class="flex justify-between gap-3">
                    <span class="min-w-0">
                      <span class="block truncate">
                        {it.title ?? "Affiche personnalisée"}
                      </span>
                      <span class="text-ink-soft">
                        {it.config.format ?? "A4"} · Qté {it.quantity}
                      </span>
                    </span>
                    <span class="shrink-0">
                      {formatPrice(it.unitPriceCents * it.quantity)}
                    </span>
                  </li>
                )}
              </For>
            </ul>
            <Show when={discount() > 0}>
              <div class="mt-4 flex justify-between text-sm text-ink-soft">
                <span>Sous-total</span>
                <span>{formatPrice(subtotal())}</span>
              </div>
              <div class="mt-1 flex justify-between text-sm text-sage">
                <span>✨ Remise</span>
                <span>− {formatPrice(discount())}</span>
              </div>
            </Show>
            <div class="mt-4 flex justify-between border-t border-ink/10 pt-4">
              <span class="font-medium">Total</span>
              <span class="font-serif text-xl">{formatPrice(total())}</span>
            </div>
            <a
              href="/panier"
              class="mt-4 block text-center text-sm text-ink-soft hover:text-terracotta"
            >
              Modifier le panier
            </a>
          </aside>
        </div>
      </Show>
    </Show>
  );
}
