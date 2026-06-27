/// <reference lib="dom" />
import {
  createResource,
  createSignal,
  Show,
  type JSX,
} from "solid-js";
import { browserApi, formatPrice, getCartId } from "../lib/api.ts";

/**
 * Tunnel de commande (§11 — canal web).
 *
 * Collecte nom + email (tous deux requis) puis matérialise la commande via
 * POST /orders, qui renvoie le numéro de commande.
 *
 * PAIEMENT — état actuel (volontairement explicite) :
 *   - L'UI échafaude un Stripe Payment Element et des boutons PayPal.
 *   - AUCUN paiement réel n'est effectué pour l'instant : il n'existe pas
 *     encore d'endpoint de création de PaymentIntent côté API, et aucune clé
 *     Stripe publique n'est fournie (voir STRIPE_PUBLIC_KEY ci-dessous).
 *   - Le bouton « Payer » appelle directement POST /orders pour matérialiser
 *     la commande (mode DEV). À remplacer par : créer le PaymentIntent ->
 *     confirmer le paiement (Stripe.js / PayPal) -> webhook côté API qui passe
 *     la commande en "paid". TODO ci-dessous.
 *
 * Pour brancher Stripe plus tard : définir PUBLIC_STRIPE_KEY dans le .env, puis
 * charger @stripe/stripe-js avec cette clé (loadStripe) et monter le
 * PaymentElement sur un clientSecret renvoyé par un nouvel endpoint
 * POST /payments/intent.
 */

const STRIPE_PUBLIC_KEY = import.meta.env.PUBLIC_STRIPE_KEY as
  | string
  | undefined;

type Method = "stripe" | "paypal";

export default function CheckoutIsland(): JSX.Element {
  const [name, setName] = createSignal("");
  const [email, setEmail] = createSignal("");
  const [method, setMethod] = createSignal<Method>("stripe");
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [orderNumber, setOrderNumber] = createSignal<string | null>(null);

  // Récapitulatif du panier (lecture seule).
  const [cart] = createResource(async () => browserApi.cart(getCartId()));
  const total = () =>
    (cart()?.items ?? []).reduce(
      (s, it) => s + it.unitPriceCents * it.quantity,
      0,
    );

  const emailValid = () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email().trim());
  const formValid = () => name().trim().length > 0 && emailValid();

  async function pay(e: Event) {
    e.preventDefault();
    if (!formValid() || submitting()) return;
    setSubmitting(true);
    setError(null);
    try {
      // TODO(paiement réel) : avant POST /orders, créer + confirmer un
      // paiement (Stripe PaymentIntent ou PayPal Order). En DEV on matérialise
      // directement la commande.
      const res = await browserApi.createOrder(getCartId(), {
        name: name().trim(),
        email: email().trim(),
      });
      setOrderNumber(res.number);
      // Nouveau panier vide pour les prochains achats.
      localStorage.removeItem("ml_cart_id");
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Show
      when={!orderNumber()}
      fallback={
        <div class="rounded-2xl border border-sage/40 bg-sage/10 p-8 text-center">
          <h2 class="font-serif text-3xl">Merci !</h2>
          <p class="mt-3 text-ink-soft">Votre commande a bien été enregistrée.</p>
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
          <form onSubmit={pay} class="space-y-8">
            {/* Coordonnées */}
            <fieldset class="space-y-4">
              <legend class="font-serif text-2xl mb-2">Vos coordonnées</legend>
              <label class="block">
                <span class="text-sm font-medium">Nom complet</span>
                <input
                  type="text"
                  required
                  value={name()}
                  onInput={(e) => setName(e.currentTarget.value)}
                  class="mt-1 w-full rounded-lg border border-ink/20 bg-paper px-4 py-3 focus:border-terracotta focus:outline-none"
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
                  class="mt-1 w-full rounded-lg border border-ink/20 bg-paper px-4 py-3 focus:border-terracotta focus:outline-none"
                  placeholder="camille@example.com"
                />
                <Show when={email().length > 0 && !emailValid()}>
                  <span class="mt-1 block text-xs text-terracotta-deep">
                    E-mail invalide.
                  </span>
                </Show>
              </label>
            </fieldset>

            {/* Paiement (échafaudage) */}
            <fieldset class="space-y-4">
              <legend class="font-serif text-2xl mb-2">Paiement</legend>

              <div class="flex gap-3">
                <button
                  type="button"
                  onClick={() => setMethod("stripe")}
                  class={`flex-1 rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
                    method() === "stripe"
                      ? "border-terracotta bg-terracotta/10"
                      : "border-ink/20 hover:border-ink"
                  }`}
                >
                  Carte bancaire
                </button>
                <button
                  type="button"
                  onClick={() => setMethod("paypal")}
                  class={`flex-1 rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
                    method() === "paypal"
                      ? "border-terracotta bg-terracotta/10"
                      : "border-ink/20 hover:border-ink"
                  }`}
                >
                  PayPal
                </button>
              </div>

              <Show when={method() === "stripe"}>
                <div class="rounded-lg border border-dashed border-ink/20 bg-paper-deep/40 p-4">
                  {/* TODO(Stripe) : monter ici le <PaymentElement> de Stripe.js
                      sur un clientSecret renvoyé par POST /payments/intent. */}
                  <p class="text-sm text-ink-soft">
                    Zone de saisie carte (Stripe Payment Element).
                  </p>
                  <p class="mt-2 text-xs text-ink-soft">
                    {STRIPE_PUBLIC_KEY
                      ? "Clé Stripe détectée — intégration à finaliser."
                      : "Démo : aucune clé Stripe (PUBLIC_STRIPE_KEY) configurée. Le paiement réel est désactivé."}
                  </p>
                </div>
              </Show>

              <Show when={method() === "paypal"}>
                <div class="rounded-lg border border-dashed border-ink/20 bg-paper-deep/40 p-4">
                  {/* TODO(PayPal) : charger le SDK PayPal et rendre les boutons
                      (paypal.Buttons) sur un order id créé côté API. */}
                  <p class="text-sm text-ink-soft">
                    Boutons PayPal (à intégrer via le SDK PayPal).
                  </p>
                </div>
              </Show>

              <p class="text-xs text-ink-soft">
                Démo : le bouton ci-dessous valide la commande sans débit réel.
              </p>
            </fieldset>

            <Show when={error()}>
              <p class="rounded-lg bg-terracotta/10 px-4 py-3 text-sm text-terracotta-deep">
                {error()}
              </p>
            </Show>

            <button
              type="submit"
              disabled={!formValid() || submitting()}
              class="w-full rounded-full bg-terracotta px-8 py-4 text-paper font-medium hover:bg-terracotta-deep transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting()
                ? "Validation…"
                : `Payer ${formatPrice(total())}`}
            </button>
          </form>

          {/* Récapitulatif */}
          <aside class="rounded-2xl border border-ink/10 bg-paper-deep/40 p-6 lg:sticky lg:top-24">
            <h2 class="font-serif text-xl mb-4">Récapitulatif</h2>
            <ul class="space-y-3 text-sm">
              {(cart()?.items ?? []).map((it) => (
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
              ))}
            </ul>
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
