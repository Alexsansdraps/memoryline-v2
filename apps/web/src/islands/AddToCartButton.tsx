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
  /**
   * Le nombre d'exemplaires.
   *
   * Borné entre 1 et 20 : zéro laisserait une ligne fantôme dans le panier,
   * et au-delà de vingt on n'est plus dans l'achat d'une cliente mais dans
   * une commande de revente, qui se traite de vive voix.
   */
  const [quantite, setQuantite] = createSignal(1);
  const borner = (n: number) => Math.min(20, Math.max(1, Math.trunc(n) || 1));

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
        quantity: quantite(),
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
      <div class="mt-8 flex flex-wrap items-center gap-4">
        {/* Le nombre d'exemplaires. Deux boutons plutôt qu'un champ seul :
            sur un téléphone, ajuster de 1 à 3 se fait au pouce, sans ouvrir
            le clavier. Le champ reste saisissable pour qui en veut douze. */}
        <div class="inline-flex items-center border border-ink/20">
          <button
            type="button"
            onClick={() => setQuantite((q) => borner(q - 1))}
            disabled={busy() || quantite() <= 1}
            aria-label={tr("panier.moins")}
            class="px-3 py-2.5 text-lg leading-none text-ink-soft transition-colors hover:text-ink disabled:opacity-40"
          >
            −
          </button>
          <input
            type="number"
            min="1"
            max="20"
            value={quantite()}
            onInput={(e) => setQuantite(borner(Number(e.currentTarget.value)))}
            disabled={busy()}
            aria-label={tr("panier.quantite")}
            class="w-12 border-x border-ink/20 bg-transparent py-2.5 text-center text-sm focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setQuantite((q) => borner(q + 1))}
            disabled={busy() || quantite() >= 20}
            aria-label={tr("panier.plus")}
            class="px-3 py-2.5 text-lg leading-none text-ink-soft transition-colors hover:text-ink disabled:opacity-40"
          >
            +
          </button>
        </div>
        <button
          type="button"
          onClick={add}
          disabled={busy()}
          class="inline-block rounded-full bg-ink px-8 py-3 text-paper font-medium hover:bg-ink/85 transition-colors disabled:opacity-60"
        >
          {busy() ? "…" : tr("produit.ajouter")}
        </button>
      </div>
      {error() && (
        <p class="mt-3 text-sm text-terracotta-deep">{error()}</p>
      )}
    </div>
  );
}
