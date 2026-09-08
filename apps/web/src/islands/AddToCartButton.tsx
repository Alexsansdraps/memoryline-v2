/// <reference lib="dom" />
import { t, LANGUE_DEFAUT, type Langue } from "../i18n/utils.ts";
import { createSignal, type JSX } from "solid-js";
import type { PosterConfig } from "@memoryline/types";
import { browserApi, getCartId } from "../lib/api.ts";

/**
 * Bouton « Ajouter au panier » pour une affiche prête à imprimer (sans
 * personnalisation). Envoie une config minimale et redirige vers /panier.
 */
export interface AddToCartButtonProps {
  /** Langue de la page — pilote tous les libellés affichés. */
  langue?: Langue;
  product: {
    id: number;
    name: string;
    basePriceCents: number;
    /** Type d'affiche du produit — repli sur « de face » s'il n'en a pas. */
    defaultView?: string | null;
  };
}

export default function AddToCartButton(
  props: AddToCartButtonProps,
): JSX.Element {
  const tr = t(props.langue ?? LANGUE_DEFAUT);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function add() {
    if (busy()) return;
    setBusy(true);
    setError(null);
    const config: PosterConfig = {
      schemaVersion: 1,
      view: props.product.defaultView || "front",
      texts: {},
      characters: [],
    };
    try {
      await browserApi.addCartItem(getCartId(), {
        productId: props.product.id,
        unitPriceCents: props.product.basePriceCents,
        quantity: 1,
        title: props.product.name,
        config,
      });
      window.location.href = "/panier";
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={add}
        disabled={busy()}
        class="mt-8 inline-block rounded-full bg-ink px-8 py-3 text-paper font-medium hover:bg-ink/85 transition-colors disabled:opacity-60"
      >
        {busy() ? "…" : tr("produit.ajouter")}
      </button>
      {error() && (
        <p class="mt-3 text-sm text-terracotta-deep">{error()}</p>
      )}
    </div>
  );
}
