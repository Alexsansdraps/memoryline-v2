/// <reference lib="dom" />
import { t, LANGUE_DEFAUT, type Langue } from "../i18n/utils.ts";
import {
  createResource,
  createSignal,
  createEffect,
  Show,
  For,
  type JSX,
} from "solid-js";
import {
  optionsLivraison,
  remisesPanier,
  totalPanierCents,
  type OptionLivraison,
  type RegleParier,
} from "@memoryline/types";

/**
 * Pays proposés à la livraison. Volontairement court : ceux où la boutique
 * expédie vraiment, plus « autre pays », qui tombe dans la zone de repli.
 */
const PAYS = [
  { code: "FR", nom: "France" },
  { code: "BE", nom: "Belgique" },
  { code: "CH", nom: "Suisse" },
  { code: "LU", nom: "Luxembourg" },
  { code: "DE", nom: "Allemagne" },
  { code: "ES", nom: "Espagne" },
  { code: "IT", nom: "Italie" },
  { code: "NL", nom: "Pays-Bas" },
  { code: "PT", nom: "Portugal" },
  { code: "GB", nom: "Royaume-Uni" },
  { code: "CA", nom: "Canada" },
  { code: "US", nom: "États-Unis" },
  { code: "ZZ", nom: "Autre pays" },
];
import { loadStripe } from "@stripe/stripe-js";
import type { Stripe, StripeElements } from "@stripe/stripe-js";
import {
  browserApi,
  formatPrice,
  getCartId,
  PUBLIC_API_URL,
} from "../lib/api.ts";
import { codePromoRetenu } from "./CartIsland.tsx";

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

export default function CheckoutIsland(props: { langue?: Langue }): JSX.Element {
  const tr = t(props.langue ?? LANGUE_DEFAUT);
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

  // Promos actives. Le calcul lui-même vient du moteur PARTAGÉ : plus de
  // réplique locale à maintenir en phase avec le serveur.
  const [promos] = createResource(async () => {
    try {
      const res = await fetch(`${PUBLIC_API_URL}/promos`);
      return res.ok ? ((await res.json()) as RegleParier[]) : [];
    } catch {
      return [];
    }
  });
  const lignes = () =>
    (cart()?.items ?? []).map((it) => ({
      unitPriceCents: it.unitPriceCents,
      quantity: it.quantity,
      format:
        (it.config as { format?: string } | null | undefined)?.format ?? null,
    }));
  /**
   * Code promo saisi au panier. Il est revérifié ici, puis renvoyé au serveur
   * qui refait seul le calcul : ce qui suit ne sert qu'à afficher le bon
   * montant avant de payer.
   */
  const [codePromo] = createResource(async () => {
    const code = codePromoRetenu();
    if (!code) return null;
    try {
      const regle = await browserApi.verifierCode(code);
      return { ...regle, id: 0 } as unknown as RegleParier;
    } catch {
      return null;
    }
  });
  const reglesEnJeu = (): RegleParier[] => {
    const auto = promos() ?? [];
    const c = codePromo();
    return c ? [...auto, c] : auto;
  };
  const codes = () => {
    const c = codePromo() as { code?: string } | null;
    return c?.code ? [c.code] : [];
  };

  const discount = () =>
    remisesPanier(lignes(), reglesEnJeu(), new Date(), codes()).remiseCents;

  /* --- Livraison ------------------------------------------------------- */
  const [catalogue] = createResource(async () => {
    try {
      return await browserApi.shipping();
    } catch {
      return null;
    }
  });
  const [pays, setPays] = createSignal("FR");
  const [modeChoisi, setModeChoisi] = createSignal<string | null>(null);
  const [adresse, setAdresse] = createSignal({
    line1: "",
    line2: "",
    postalCode: "",
    city: "",
    phone: "",
  });
  const [pointRelais, setPointRelais] = createSignal({ id: "", label: "" });

  /* Recherche de points relais : on interroge le transporteur avec un code
     postal, le client choisit dans la liste. Pas de champ libre — une adresse
     saisie à la main ne correspondrait à aucun point réel. */
  const [cpRecherche, setCpRecherche] = createSignal("");
  const [relais, setRelais] = createSignal<
    { id: string; nom: string; adresse: string; codePostal: string; ville: string }[]
  >([]);
  const [relaisEtat, setRelaisEtat] = createSignal<
    "repos" | "recherche" | "vide" | "erreur"
  >("repos");

  createEffect(() => {
    // Le mode change : les points trouvés pour l'autre transporteur n'ont
    // plus cours, et le point choisi encore moins.
    modeChoisi();
    setRelais([]);
    setPointRelais({ id: "", label: "" });
    setRelaisEtat("repos");
  });

  async function chercherRelais(e?: Event) {
    e?.preventDefault();
    const cp = cpRecherche().trim();
    if (!cp) return;
    setRelaisEtat("recherche");
    try {
      const liste = await browserApi.pointsRelais(
        cp,
        pays(),
        optionChoisie()?.mode.carrier ?? "mondial_relay",
      );
      setRelais(liste);
      setRelaisEtat(liste.length ? "repos" : "vide");
    } catch {
      setRelais([]);
      setRelaisEtat("erreur");
    }
  }

  /** Panier après remises : c'est lui qui décide de la franchise de port. */
  const apresRemise = () => Math.max(0, subtotal() - discount());

  const optionsPort = (): OptionLivraison[] => {
    const cat = catalogue();
    return cat ? optionsLivraison(cat, pays(), apresRemise()) : [];
  };
  const optionChoisie = () =>
    optionsPort().find((o) => o.mode.slug === modeChoisi()) ?? null;
  const fraisPort = () => optionChoisie()?.fraisCents ?? 0;

  // Premier mode disponible par défaut, et repli si le choix devient
  // impossible — changer de pays peut retirer le retrait sur place.
  createEffect(() => {
    const dispo = optionsPort();
    if (!dispo.length) return;
    if (!dispo.some((o) => o.mode.slug === modeChoisi()))
      setModeChoisi(dispo[0]!.mode.slug);
  });

  /** Ce que le mode choisi exige avant de pouvoir payer. */
  const livraisonValide = () => {
    const o = optionChoisie();
    if (!o) return false;
    if (o.mode.kind === "home") {
      const a = adresse();
      return (
        a.line1.trim().length > 0 &&
        a.postalCode.trim().length > 0 &&
        a.city.trim().length > 0
      );
    }
    if (o.mode.kind === "relay") return pointRelais().id.trim().length > 0;
    return true;
  };

  /** Montant réellement dû (= ce que débitera Stripe/PayPal). */
  const total = () =>
    totalPanierCents(lignes(), reglesEnJeu(), new Date(), codes()) + fraisPort();

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
  const formValid = () =>
    name().trim().length > 0 && emailValid() && livraisonValide();

  /* --- Stripe --------------------------------------------------------- */
  let stripe: Stripe | null = null;
  let elements: StripeElements | null = null;
  let stripeMountRef: HTMLDivElement | undefined;
  let expressMountRef: HTMLDivElement | undefined;
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

      /* Apple Pay et Google Pay, en boutons dédiés au-dessus du formulaire.
         Stripe ne les affiche que s'ils sont réellement utilisables : appareil
         compatible, portefeuille approvisionné, moyen activé dans le tableau
         de bord Stripe — et, pour Apple Pay, domaine vérifié chez Apple. Rien
         à afficher : l'élément reste vide, le formulaire de carte suffit. */
      if (expressMountRef) {
        const express = elements.create("expressCheckout");
        express.on("confirm", () => {
          void payStripe();
        });
        express.mount(expressMountRef);
      }

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
      const a = adresse();
      const relais = pointRelais();
      const order = await browserApi.createOrder(
        getCartId(),
        { name: name().trim(), email: email().trim() },
        codePromoRetenu() || undefined,
        {
          method: modeChoisi() ?? "",
          name: name().trim(),
          line1: a.line1.trim(),
          line2: a.line2.trim(),
          postalCode: a.postalCode.trim(),
          city: a.city.trim(),
          country: pays(),
          phone: a.phone.trim(),
          relayPointId: relais.id.trim(),
          relayPointLabel: relais.label.trim(),
        },
      );
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
            <span class="text-2xl">{orderNumber()}</span>
          </p>
          <a
            href="/affiches"
            class="mt-6 inline-block rounded-full bg-ink px-6 py-3 text-paper font-medium hover:bg-ink/85 transition-colors"
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
            class="mt-6 inline-block rounded-full bg-ink px-6 py-3 text-paper font-medium hover:bg-ink/85 transition-colors"
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
              <legend class="text-2xl mb-2">Vos coordonnées</legend>
              <label class="block">
                <span class="text-sm font-medium">{tr("commande.nom")}</span>
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
                <span class="text-sm font-medium">{tr("commande.email")}</span>
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

            {/* Livraison */}
            <fieldset class="space-y-4" disabled={phase() === "pay"}>
              <legend class="text-2xl mb-2">{tr("livraison.titre")}</legend>

              <label class="block">
                <span class="text-sm font-medium">{tr("livraison.pays")}</span>
                <select
                  value={pays()}
                  onChange={(e) => setPays(e.currentTarget.value)}
                  class="mt-1 w-full rounded-lg border border-ink/20 bg-paper px-4 py-3 focus:border-terracotta focus:outline-none disabled:opacity-60"
                >
                  <For each={PAYS}>
                    {(p) => <option value={p.code}>{p.nom}</option>}
                  </For>
                </select>
              </label>

              <Show
                when={optionsPort().length > 0}
                fallback={
                  <p class="text-sm text-terracotta-deep">
                    {tr("livraison.aucune")}
                  </p>
                }
              >
                <div class="space-y-2">
                  <For each={optionsPort()}>
                    {(o) => (
                      <label
                        class={`flex cursor-pointer items-start gap-3 border p-4 transition-colors ${
                          modeChoisi() === o.mode.slug
                            ? "border-ink"
                            : "border-ink/20 hover:border-ink/50"
                        }`}
                      >
                        <input
                          type="radio"
                          name="mode-livraison"
                          class="mt-1"
                          checked={modeChoisi() === o.mode.slug}
                          onChange={() => setModeChoisi(o.mode.slug)}
                        />
                        <span class="flex-1">
                          <span class="flex items-baseline justify-between gap-3">
                            <span class="font-medium">{o.mode.name}</span>
                            <span>
                              {o.offert
                                ? tr("livraison.offerte")
                                : formatPrice(o.fraisCents)}
                            </span>
                          </span>
                          <Show when={o.mode.description}>
                            <span class="mt-0.5 block text-sm text-ink-soft">
                              {o.mode.description}
                            </span>
                          </Show>
                          {/* Retrait sur place : l'emplacement change de salon
                              en salon, il vient du back-office. */}
                          <Show
                            when={
                              o.mode.kind === "pickup" && o.mode.pickupLocation
                            }
                          >
                            <span class="mt-1 block text-sm">
                              {o.mode.pickupLocation}
                            </span>
                          </Show>
                        </span>
                      </label>
                    )}
                  </For>
                </div>
              </Show>

              {/* Adresse : demandée seulement quand le mode en a besoin. */}
              <Show when={optionChoisie()?.mode.kind === "home"}>
                <div class="space-y-4">
                  <label class="block">
                    <span class="text-sm font-medium">
                      {tr("livraison.adresse")}
                    </span>
                    <input
                      type="text"
                      value={adresse().line1}
                      onInput={(e) =>
                        setAdresse({ ...adresse(), line1: e.currentTarget.value })
                      }
                      class="mt-1 w-full rounded-lg border border-ink/20 bg-paper px-4 py-3 focus:border-terracotta focus:outline-none disabled:opacity-60"
                      placeholder="12 rue des Bains"
                    />
                  </label>
                  <label class="block">
                    <span class="text-sm font-medium">
                      {tr("livraison.complement")}
                    </span>
                    <input
                      type="text"
                      value={adresse().line2}
                      onInput={(e) =>
                        setAdresse({ ...adresse(), line2: e.currentTarget.value })
                      }
                      class="mt-1 w-full rounded-lg border border-ink/20 bg-paper px-4 py-3 focus:border-terracotta focus:outline-none disabled:opacity-60"
                      placeholder="Bâtiment B, 3e étage"
                    />
                  </label>
                  <div class="grid grid-cols-[8rem_1fr] gap-4">
                    <label class="block">
                      <span class="text-sm font-medium">
                        {tr("livraison.code_postal")}
                      </span>
                      <input
                        type="text"
                        value={adresse().postalCode}
                        onInput={(e) =>
                          setAdresse({
                            ...adresse(),
                            postalCode: e.currentTarget.value,
                          })
                        }
                        class="mt-1 w-full rounded-lg border border-ink/20 bg-paper px-4 py-3 focus:border-terracotta focus:outline-none disabled:opacity-60"
                        placeholder="80350"
                      />
                    </label>
                    <label class="block">
                      <span class="text-sm font-medium">
                        {tr("livraison.ville")}
                      </span>
                      <input
                        type="text"
                        value={adresse().city}
                        onInput={(e) =>
                          setAdresse({ ...adresse(), city: e.currentTarget.value })
                        }
                        class="mt-1 w-full rounded-lg border border-ink/20 bg-paper px-4 py-3 focus:border-terracotta focus:outline-none disabled:opacity-60"
                        placeholder="Mers-les-Bains"
                      />
                    </label>
                  </div>
                  <label class="block">
                    <span class="text-sm font-medium">
                      {tr("livraison.telephone")}
                    </span>
                    <input
                      type="tel"
                      value={adresse().phone}
                      onInput={(e) =>
                        setAdresse({ ...adresse(), phone: e.currentTarget.value })
                      }
                      class="mt-1 w-full rounded-lg border border-ink/20 bg-paper px-4 py-3 focus:border-terracotta focus:outline-none disabled:opacity-60"
                      placeholder="06 12 34 56 78"
                    />
                  </label>
                </div>
              </Show>

              {/* Point relais : le client cherche autour de chez lui et choisit
                  dans la liste renvoyée par le transporteur. */}
              <Show when={optionChoisie()?.mode.kind === "relay"}>
                <div class="space-y-3">
                  <span class="block text-sm font-medium">
                    {tr("livraison.point_relais")}
                  </span>
                  <div class="flex items-stretch gap-2">
                    <input
                      type="text"
                      inputmode="numeric"
                      value={cpRecherche()}
                      onInput={(e) => setCpRecherche(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void chercherRelais();
                        }
                      }}
                      class="min-w-0 flex-1 rounded-lg border border-ink/20 bg-paper px-4 py-3 focus:border-terracotta focus:outline-none disabled:opacity-60"
                      placeholder={tr("livraison.cp_recherche")}
                    />
                    <button
                      type="button"
                      onClick={chercherRelais}
                      disabled={relaisEtat() === "recherche" || !cpRecherche().trim()}
                      class="border border-ink px-5 font-medium hover:bg-ink hover:text-paper disabled:opacity-40 transition-colors"
                    >
                      {tr("livraison.chercher")}
                    </button>
                  </div>

                  <Show when={relaisEtat() === "recherche"}>
                    <p class="text-sm text-ink-soft">
                      {tr("livraison.recherche_en_cours")}
                    </p>
                  </Show>
                  <Show when={relaisEtat() === "vide"}>
                    <p class="text-sm text-ink-soft">
                      {tr("livraison.aucun_relais")}
                    </p>
                  </Show>
                  <Show when={relaisEtat() === "erreur"}>
                    <p class="text-sm text-terracotta-deep">
                      {tr("livraison.relais_indisponible")}
                    </p>
                  </Show>

                  <Show when={relais().length > 0}>
                    <ul class="max-h-72 space-y-2 overflow-y-auto">
                      <For each={relais()}>
                        {(r) => (
                          <li>
                            <label
                              class={`flex cursor-pointer items-start gap-3 border p-3 text-sm transition-colors ${
                                pointRelais().id === r.id
                                  ? "border-ink"
                                  : "border-ink/20 hover:border-ink/50"
                              }`}
                            >
                              <input
                                type="radio"
                                name="point-relais"
                                class="mt-1"
                                checked={pointRelais().id === r.id}
                                onChange={() =>
                                  setPointRelais({
                                    id: r.id,
                                    label: `${r.nom}, ${r.adresse}, ${r.codePostal} ${r.ville}`,
                                  })
                                }
                              />
                              <span>
                                <span class="block font-medium">{r.nom}</span>
                                <span class="block text-ink-soft">
                                  {r.adresse}, {r.codePostal} {r.ville}
                                </span>
                              </span>
                            </label>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>

                  <Show when={pointRelais().id}>
                    <p class="text-sm text-sage">
                      {tr("livraison.relais_choisi")} {pointRelais().label}
                    </p>
                  </Show>
                </div>
              </Show>
            </fieldset>

            {/* Paiement */}
            <fieldset class="space-y-4">
              <legend class="text-2xl mb-2">Paiement</legend>

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
                    class="w-full rounded-full bg-terracotta px-8 py-4 text-paper font-medium hover:bg-ink/85 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting()
                      ? "Préparation…"
                      : `Continuer vers le paiement · ${formatPrice(total())}`}
                  </button>
                </Show>

                {/* Phase 2 : widget du moyen choisi */}
                <Show when={phase() === "pay"}>
                  <Show when={method() === "stripe"}>
                    {/* Apple Pay / Google Pay : Stripe n'affiche ces boutons
                        que s'ils sont utilisables ici et maintenant. Sinon la
                        zone reste vide et on passe directement à la carte. */}
                    <div ref={expressMountRef} class="mb-3 empty:hidden" />
                    <div class="rounded-lg border border-ink/15 bg-paper p-4">
                      <div ref={stripeMountRef} />
                    </div>
                    <button
                      type="button"
                      onClick={payStripe}
                      disabled={submitting()}
                      class="w-full bg-ink px-8 py-4 text-paper font-medium hover:bg-ink/85 transition-colors disabled:opacity-50"
                    >
                      {submitting() ? "…" : `${tr("commande.payer")} ${formatPrice(total())}`}
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
            <h2 class="text-xl mb-4">Récapitulatif</h2>
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
            <Show when={optionChoisie()}>
              <div class="mt-1 flex justify-between text-sm text-ink-soft">
                <span>{optionChoisie()!.mode.name}</span>
                <span>
                  {optionChoisie()!.offert
                    ? tr("livraison.offerte")
                    : formatPrice(fraisPort())}
                </span>
              </div>
            </Show>
            <div class="mt-4 flex justify-between border-t border-ink/10 pt-4">
              <span class="font-medium">{tr("panier.total")}</span>
              <span class="text-xl">{formatPrice(total())}</span>
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
