/// <reference lib="dom" />
import { createResource, createSignal, Show, type JSX } from "solid-js";
import { Configurator } from "@memoryline/configurator";
import type {
  BackgroundDTO,
  CharacterTypeDTO,
  PosterConfig,
} from "@memoryline/types";
import {
  PUBLIC_API_URL,
  browserApi,
  getCartId,
} from "../lib/api.ts";

/**
 * Île SolidJS qui pilote le configurateur d'affiche.
 *
 * Deux modes :
 *  - AJOUT (mode="add")  : POST /cart/:cartId/items, puis redirige vers /panier.
 *  - ÉDITION (mode="edit"): réouverture avec initialConfig + PUT (§18.3 I), puis
 *    retour au panier.
 *
 * Le panier est identifié par un UUID persistant dans localStorage
 * ("ml_cart_id"). Tout est fait côté navigateur (client:only).
 */
export interface ConfiguratorIslandProps {
  product: { id: number; name: string; basePriceCents: number };
  /** Prix réels par format (centimes), ex. { A4: 2300, A3: 2900 }. */
  prices?: Partial<Record<string, number>>;
  /** Décor d'avant-plan du produit (muret/banc…), rendu au 1er plan. */
  foregroundUrl?: string | null;
  /** Réglages par défaut du produit (pré-remplissage). */
  defaults?: { title?: string | null; subtitle?: string | null; view?: string | null };
  /** "add" depuis la fiche produit, "edit" depuis le panier. */
  mode?: "add" | "edit";
  /** Réouverture (edit) : config de la ligne à modifier. */
  initialConfig?: PosterConfig;
  /** Réouverture (edit) : id de la ligne de panier à mettre à jour. */
  itemId?: number;
  /** Fermeture de la modale (bouton « Retour » à l'étape 1). */
  onCancel?: () => void;
}

/** Prix selon le format choisi, depuis les prix réels des variantes. */
function priceForConfig(
  config: PosterConfig,
  basePriceCents: number,
  prices?: Partial<Record<string, number>>,
): number {
  const fmt = config.format ?? "A4";
  const p = prices?.[fmt];
  return typeof p === "number" ? p : basePriceCents;
}

export default function ConfiguratorIsland(
  props: ConfiguratorIslandProps,
): JSX.Element {
  const mode = props.mode ?? "add";

  // Chargement de la bibliothèque (personnages + variantes de slots + fonds).
  const [data] = createResource(async () => {
    const [library, backgrounds] = await Promise.all([
      browserApi.characters(),
      browserApi.backgrounds(props.product.id),
    ]);
    return {
      characters: library.characters,
      slots: library.slots,
      backgrounds,
    };
  });

  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function handleSubmit(config: PosterConfig) {
    if (saving()) return;
    setSaving(true);
    setError(null);
    try {
      // Le décor d'avant-plan est un réglage produit : on l'injecte dans le
      // snapshot pour que le PDF d'impression le rende aussi.
      if (props.foregroundUrl) config = { ...config, foregroundUrl: props.foregroundUrl };
      const cartId = getCartId();
      const unitPriceCents = priceForConfig(
        config,
        props.product.basePriceCents,
        props.prices,
      );
      if (mode === "edit" && props.itemId != null) {
        await browserApi.updateCartItem(cartId, props.itemId, {
          config,
          unitPriceCents,
        });
      } else {
        await browserApi.addCartItem(cartId, {
          productId: props.product.id,
          unitPriceCents,
          quantity: 1,
          title: props.product.name,
          config,
        });
      }
      window.location.href = "/panier";
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  }

  function handleBack() {
    // Étape 1 « Retour » : en édition on revient au panier ; en ajout on
    // ferme simplement la modale (reste sur la fiche produit).
    if (mode === "edit") {
      window.location.href = "/panier";
    } else if (props.onCancel) {
      props.onCancel();
    } else {
      window.location.href = "/affiches";
    }
  }

  return (
    <div>
      <Show when={data.loading}>
        <p class="text-ink-soft">Chargement du configurateur…</p>
      </Show>

      <Show when={data.error}>
        <p class="text-terracotta-deep">
          Impossible de charger le configurateur. Vérifiez que l'API est
          démarrée ({PUBLIC_API_URL}).
        </p>
      </Show>

      <Show when={data()}>
        {(d) => (
          <>
            <Show when={error()}>
              <p class="mb-4 rounded-lg bg-terracotta/10 px-4 py-3 text-sm text-terracotta-deep">
                {error()}
              </p>
            </Show>
            <Show when={saving()}>
              <p class="mb-4 text-sm text-ink-soft">Enregistrement…</p>
            </Show>
            <Configurator
              product={{
                id: props.product.id,
                name: props.product.name,
                basePriceCents: props.product.basePriceCents,
              }}
              backgrounds={d().backgrounds}
              characters={d().characters as never}
              slots={d().slots as never}
              prices={props.prices}
              foregroundUrl={props.foregroundUrl}
              defaults={props.defaults}
              initialConfig={props.initialConfig}
              assetBaseUrl={PUBLIC_API_URL}
              onSubmit={handleSubmit}
              onBack={handleBack}
            />
          </>
        )}
      </Show>
    </div>
  );
}
