/// <reference lib="dom" />
import {
  createSignal,
  onMount,
  onCleanup,
  Show,
  type JSX,
} from "solid-js";
import type { PosterConfig } from "@memoryline/types";
import { browserApi, getCartId } from "../lib/api.ts";
import ConfiguratorIsland from "./ConfiguratorIsland.tsx";

/**
 * Bouton UNIQUE « Personnaliser » de la fiche produit + configurateur en
 * MODALE plein écran (popup), responsive mobile.
 *
 * - Un seul bouton (plus de doublon lien d'ancre + île).
 * - Au clic : ouverture d'une modale overlay contenant le configurateur.
 *   Fermeture par croix, Échap ou clic sur le fond.
 * - Mode ÉDITION (?edit=ITEM_ID, réouverture depuis le panier §18.3 I) :
 *   on charge la config de la ligne et on ouvre directement la modale.
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

  function lockScroll(lock: boolean) {
    document.body.style.overflow = lock ? "hidden" : "";
  }
  function openModal() {
    setOpen(true);
    lockScroll(true);
  }
  function closeModal() {
    setOpen(false);
    lockScroll(false);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape" && open()) closeModal();
  }

  onMount(async () => {
    window.addEventListener("keydown", onKey);
    // Mode édition depuis le panier (?edit=ITEM_ID).
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
        openModal();
      }
    } catch {
      /* silencieux : on retombe sur l'ajout classique */
    } finally {
      setLoadingEdit(false);
    }
  });

  onCleanup(() => {
    window.removeEventListener("keydown", onKey);
    lockScroll(false);
  });

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        disabled={loadingEdit()}
        class="mt-8 inline-block rounded-full bg-terracotta px-8 py-3 text-paper font-medium hover:bg-terracotta-deep transition-colors disabled:opacity-60"
      >
        {loadingEdit() ? "Chargement…" : "Personnaliser"}
      </button>
      <p class="mt-3 text-sm text-ink-soft">
        Choisissez le fond, le texte et vos personnages.
      </p>

      <Show when={open()}>
        <div
          class="ml-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Personnaliser l'affiche"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div class="ml-modal-panel">
            <header class="ml-modal-head">
              <h2 class="font-serif text-xl sm:text-2xl">
                {editItemId() != null
                  ? "Modifier votre affiche"
                  : "Composez votre affiche"}
              </h2>
              <button
                type="button"
                class="ml-modal-close"
                aria-label="Fermer"
                onClick={closeModal}
              >
                ✕
              </button>
            </header>
            <div class="ml-modal-body">
              <ConfiguratorIsland
                product={props.product}
                mode={editItemId() != null ? "edit" : "add"}
                initialConfig={initialConfig()}
                itemId={editItemId() ?? undefined}
                onCancel={closeModal}
              />
            </div>
          </div>
        </div>
      </Show>
    </>
  );
}
