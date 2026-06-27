/// <reference lib="dom" />
import { createSignal, onMount, Show, type JSX } from "solid-js";
import type { PosterConfig } from "@memoryline/types";
import { browserApi, getCartId } from "../lib/api.ts";
import ConfiguratorIsland from "./ConfiguratorIsland.tsx";

/**
 * Île de la fiche produit (affiche personnalisable).
 *
 * - Affiche un bouton « Personnaliser » ; au clic, monte le configurateur.
 * - Détecte le mode ÉDITION via l'URL (?edit=ITEM_ID) : la fiche est rouverte
 *   depuis le panier (§18.3 I). On charge alors la config de la ligne et on
 *   ouvre directement le configurateur en mode "edit" -> PUT.
 */
export interface ProductConfiguratorProps {
  product: { id: number; name: string; basePriceCents: number };
}

export default function ProductConfigurator(
  props: ProductConfiguratorProps,
): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [editItemId, setEditItemId] = createSignal<number | null>(null);
  const [initialConfig, setInitialConfig] = createSignal<
    PosterConfig | undefined
  >(undefined);
  const [loadingEdit, setLoadingEdit] = createSignal(false);

  onMount(async () => {
    const params = new URLSearchParams(window.location.search);
    const editId = params.get("edit");
    if (!editId) return;
    setLoadingEdit(true);
    try {
      const cart = await browserApi.cart(getCartId());
      const item = cart.items.find((i) => String(i.id) === editId);
      if (item) {
        setInitialConfig(item.config);
        setEditItemId(item.id);
        setOpen(true);
        document
          .getElementById("configurateur")
          ?.scrollIntoView({ behavior: "smooth" });
      }
    } catch {
      /* silencieux : on retombe sur l'ajout classique */
    } finally {
      setLoadingEdit(false);
    }
  });

  return (
    <div>
      <Show when={!open()}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={loadingEdit()}
          class="mt-8 inline-block rounded-full bg-terracotta px-8 py-3 text-paper font-medium hover:bg-terracotta-deep transition-colors disabled:opacity-60"
        >
          {loadingEdit() ? "Chargement…" : "Personnaliser"}
        </button>
        <p class="mt-3 text-sm text-ink-soft">
          Choisissez le fond, le texte et vos personnages.
        </p>
      </Show>

      <Show when={open()}>
        <div class="mt-8 rounded-2xl border border-ink/10 bg-paper-deep/40 p-4 sm:p-6">
          <h2 class="font-serif text-2xl mb-4">
            {editItemId() != null
              ? "Modifier votre affiche"
              : "Composez votre affiche"}
          </h2>
          <ConfiguratorIsland
            product={props.product}
            mode={editItemId() != null ? "edit" : "add"}
            initialConfig={initialConfig()}
            itemId={editItemId() ?? undefined}
          />
        </div>
      </Show>
    </div>
  );
}
