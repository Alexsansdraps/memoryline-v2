/// <reference lib="dom" />
import {
  createResource,
  createSignal,
  For,
  Show,
  type JSX,
} from "solid-js";
import {
  remisesPanier,
  totalPanierCents,
  type PosterConfig,
  type RegleParier,
} from "@memoryline/types";
import {
  PUBLIC_API_URL,
  browserApi,
  formatPrice,
  getCartId,
  type OrderItem,
} from "../lib/api.ts";

/**
 * Panier (§18.3). Lit ml_cart_id (localStorage), liste les lignes avec une
 * vignette d'aperçu, le prix et la quantité. Chaque ligne :
 *  - « Modifier » -> renvoie sur la fiche produit ?edit=ITEM_ID, qui rouvre le
 *    configurateur avec la config et fait un PUT (§18.3 I).
 *  - « Supprimer » -> DELETE.
 * Affiche le total et un bouton « Commander » vers /commande.
 */

/** Règle de promo renvoyée par l'API /promos. */
interface PromoRule {
  id: number;
  name: string;
  type: string;
  config: unknown;
}

/** Vignette : on affiche le fond de l'affiche (URL stockée dans la config). */
function thumbnailUrl(config: PosterConfig): string | null {
  if (config.backgroundUrl) {
    return /^https?:\/\//.test(config.backgroundUrl)
      ? config.backgroundUrl
      : `${PUBLIC_API_URL}${config.backgroundUrl}`;
  }
  return null;
}

/** Slug du produit pour reconstruire le lien « Modifier ». */
async function slugForProduct(
  productId: number | null,
): Promise<string | null> {
  if (productId == null) return null;
  try {
    const res = await fetch(`${PUBLIC_API_URL}/products?limit=500`);
    if (!res.ok) return null;
    const list = (await res.json()) as { id: number; slug: string }[];
    return list.find((p) => p.id === productId)?.slug ?? null;
  } catch {
    return null;
  }
}

export default function CartIsland(): JSX.Element {
  const [busy, setBusy] = createSignal<number | null>(null);

  const [cart, { refetch }] = createResource(async () => {
    const cartId = getCartId();
    const data = await browserApi.cart(cartId);
    // On résout les slugs en parallèle pour les liens « Modifier ».
    const slugs = new Map<number, string | null>();
    await Promise.all(
      [...new Set(data.items.map((i) => i.productId))].map(async (pid) => {
        if (pid != null) slugs.set(pid, await slugForProduct(pid));
      }),
    );
    return { items: data.items, slugs };
  });

  // Promos actives (ex. « 3 achetées = 1 A4 offerte »).
  const [promos] = createResource(async () => {
    try {
      const res = await fetch(`${PUBLIC_API_URL}/promos`);
      return res.ok ? ((await res.json()) as PromoRule[]) : [];
    } catch {
      return [];
    }
  });

  /** Sous-total (somme des lignes, sans remise). */
  const subtotal = () =>
    (cart()?.items ?? []).reduce(
      (s, it) => s + it.unitPriceCents * it.quantity,
      0,
    );

  /** Lignes réduites à ce dont le moteur de remises a besoin. */
  const lignes = () =>
    (cart()?.items ?? []).map((it) => ({
      unitPriceCents: it.unitPriceCents,
      quantity: it.quantity,
      format: it.config.format ?? null,
    }));

  /**
   * Remises — calculées par le moteur PARTAGÉ (@memoryline/types), le même que
   * l'API utilise pour le montant réellement encaissé. Ce qui est affiché ici
   * ne peut donc plus diverger de ce qui sera débité.
   */
  const discount = (): { amount: number; label: string } => {
    const { remiseCents, detail } = remisesPanier(lignes(), promos() ?? []);
    return {
      amount: remiseCents,
      label: detail.map((d) => d.regle).join(" · "),
    };
  };

  const total = () => totalPanierCents(lignes(), promos() ?? []);

  function editHref(it: OrderItem): string | null {
    const slug = it.productId != null ? cart()?.slugs.get(it.productId) : null;
    return slug ? `/affiches/${slug}?edit=${it.id}` : null;
  }

  async function remove(it: OrderItem) {
    setBusy(it.id);
    try {
      await browserApi.deleteCartItem(getCartId(), it.id);
      await refetch();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <Show when={cart.loading}>
        <p class="text-ink-soft">Chargement du panier…</p>
      </Show>

      <Show when={cart.error}>
        <p class="text-terracotta-deep">
          Impossible de charger le panier (API {PUBLIC_API_URL}).
        </p>
      </Show>

      <Show when={cart() && cart()!.items.length === 0}>
        <div class="rounded-2xl border border-ink/10 bg-paper-deep/40 p-10 text-center">
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
        <ul class="space-y-4">
          <For each={cart()!.items}>
            {(it) => {
              const thumb = thumbnailUrl(it.config);
              const href = editHref(it);
              const charCount = it.config.characters?.length ?? 0;
              return (
                <li class="flex flex-col sm:flex-row gap-4 rounded-2xl border border-ink/10 bg-paper p-4">
                  <div class="w-full sm:w-28 shrink-0">
                    <div class="aspect-[3/4] rounded-lg bg-paper-deep border border-ink/10 overflow-hidden flex items-center justify-center">
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={it.title ?? "Affiche"}
                          class="h-full w-full object-cover"
                        />
                      ) : (
                        <span class="font-serif text-sm text-ink-soft px-2 text-center">
                          {it.title ?? "Affiche"}
                        </span>
                      )}
                    </div>
                  </div>

                  <div class="flex-1 min-w-0">
                    <h2 class="font-serif text-xl">
                      {it.title ?? "Affiche personnalisée"}
                    </h2>
                    <p class="mt-1 text-sm text-ink-soft">
                      Format {it.config.format ?? "A4"}
                      {charCount > 0
                        ? ` · ${charCount} personnage${charCount > 1 ? "s" : ""}`
                        : ""}
                      {it.config.texts?.title?.value
                        ? ` · « ${it.config.texts.title.value} »`
                        : ""}
                    </p>
                    <p class="mt-2">{formatPrice(it.unitPriceCents)}</p>

                    <div class="mt-3 flex flex-wrap gap-3 text-sm">
                      <Show when={href}>
                        <a
                          href={href!}
                          class="rounded-full border border-ink/20 px-4 py-2 font-medium hover:border-ink transition-colors"
                        >
                          Modifier
                        </a>
                      </Show>
                      <button
                        type="button"
                        onClick={() => remove(it)}
                        disabled={busy() === it.id}
                        class="rounded-full border border-terracotta/40 px-4 py-2 font-medium text-terracotta-deep hover:bg-terracotta/10 transition-colors disabled:opacity-60"
                      >
                        {busy() === it.id ? "Suppression…" : "Supprimer"}
                      </button>
                    </div>
                  </div>

                  <div class="shrink-0 text-right">
                    <p class="text-sm text-ink-soft">Qté {it.quantity}</p>
                    <p class="mt-1 font-medium">
                      {formatPrice(it.unitPriceCents * it.quantity)}
                    </p>
                  </div>
                </li>
              );
            }}
          </For>
        </ul>

        <div class="mt-8 border-t border-ink/10 pt-6">
          <Show when={discount().amount > 0}>
            <div class="flex items-center justify-between text-sm text-ink-soft mb-2">
              <span>Sous-total</span>
              <span>{formatPrice(subtotal())}</span>
            </div>
            <div class="flex items-center justify-between text-sm text-sage mb-3">
              <span>✨ {discount().label}</span>
              <span>− {formatPrice(discount().amount)}</span>
            </div>
          </Show>
          <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <p class="text-lg">
              Total{" "}
              <span class="font-serif text-2xl">{formatPrice(total())}</span>
            </p>
            <a
              href="/commande"
              class="rounded-full bg-terracotta px-8 py-3 text-paper font-medium text-center hover:bg-terracotta-deep transition-colors"
            >
              Commander
            </a>
          </div>
        </div>
      </Show>
    </div>
  );
}
