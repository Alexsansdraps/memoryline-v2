/// <reference lib="dom" />
import { t, LANGUE_DEFAUT, type Langue } from "../i18n/utils.ts";
import {
  createSignal,
  onMount,
  onCleanup,
  Show,
  type JSX,
} from "solid-js";
import type { PosterConfig, PosterFormat } from "@memoryline/types";
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
  /**
   * Au stand : ne montrer aucun montant, du premier écran au dernier.
   *
   * Le configurateur porte déjà cette option ; elle ne faisait que ne pas
   * traverser cette fiche-ci.
   */
  sansPrix?: boolean;
  /** Faux : le site ne propose pas les cadres (cf. ConfiguratorIslandProps). */
  cadresProposes?: boolean;
  /** Langue de la page — pilote tous les libellés affichés. */
  langue?: Langue;
  product: { id: number; name: string; basePriceCents: number };
  /** Prix réels par format (centimes), ex. { A4: 2300, A3: 2900 }. */
  prices?: Partial<Record<string, number>>;
  /** Décor d'avant-plan du produit. */
  foregroundUrl?: string | null;
  /** Réglages par défaut du produit (pré-remplissage), une entrée par ligne. */
  defaults?: { lignes?: (string | null)[]; view?: string | null };
  /** Le format coché d'emblée sur la fiche — le moins cher, en général. */
  formatInitial?: string;
}

export default function ProductConfigurator(
  props: ProductConfiguratorProps,
): JSX.Element {
  const tr = t(props.langue ?? LANGUE_DEFAUT);
  const [open, setOpen] = createSignal(false);
  const [editItemId, setEditItemId] = createSignal<number | null>(null);

  /**
   * Le nombre d'exemplaires, choisi sur la fiche.
   *
   * Borné entre 1 et 20 : zéro laisserait une ligne vide dans le panier, et
   * au-delà de vingt on n'est plus dans l'achat d'une cliente mais dans une
   * commande de revente, qui se traite de vive voix.
   */
  const [quantite, setQuantite] = createSignal(1);
  const bornerQuantite = (n: number) =>
    Math.min(20, Math.max(1, Math.trunc(n) || 1));
  const [initialConfig, setInitialConfig] = createSignal<
    PosterConfig | undefined
  >(undefined);
  const [loadingEdit, setLoadingEdit] = createSignal(false);

  /*
   * Le format choisi sur la fiche.
   *
   * Les cases de taille sont rendues par le serveur, ce configurateur est un
   * îlot monté après coup : ni l'un ni l'autre ne peut appeler l'autre
   * directement. Un événement du navigateur est la seule chose qu'ils
   * partagent, et il évite d'avoir à les fondre en un seul composant pour
   * une information aussi petite qu'un nom de format.
   */
  const [formatChoisi, setFormatChoisi] = createSignal<string | undefined>(
    props.formatInitial,
  );
  onMount(() => {
    const surChoix = (e: Event) => {
      const f = (e as CustomEvent<{ format?: string }>).detail?.format;
      if (f) setFormatChoisi(f);
    };
    window.addEventListener("ml:format", surChoix);
    onCleanup(() => window.removeEventListener("ml:format", surChoix));
  });

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
      <div class="mt-8 flex flex-wrap items-center gap-4">
        {/* Le nombre d'exemplaires, AVANT de composer — au même endroit que
            sur une affiche prête à imprimer. Il était auparavant à la
            dernière étape du configurateur : pour le trouver, il fallait
            avoir composé toute son affiche.

            En modification depuis le panier, il disparaît : la ligne existe
            déjà et porte son nombre ; le changer ici en ajouterait d'autres
            au lieu de corriger celle qu'on est venu corriger. */}
        <Show when={editItemId() == null}>
          <div class="inline-flex items-center border border-ink/20">
            <button
              type="button"
              onClick={() => setQuantite((q) => bornerQuantite(q - 1))}
              disabled={quantite() <= 1}
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
              onInput={(e) =>
                setQuantite(bornerQuantite(Number(e.currentTarget.value)))
              }
              aria-label={tr("panier.quantite")}
              class="w-12 border-x border-ink/20 bg-transparent py-2.5 text-center text-sm focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setQuantite((q) => bornerQuantite(q + 1))}
              disabled={quantite() >= 20}
              aria-label={tr("panier.plus")}
              class="px-3 py-2.5 text-lg leading-none text-ink-soft transition-colors hover:text-ink disabled:opacity-40"
            >
              +
            </button>
          </div>
        </Show>

        <button
          type="button"
          onClick={openModal}
          disabled={loadingEdit()}
          class="inline-block rounded-full bg-ink px-8 py-3 text-paper font-medium hover:bg-ink/85 transition-colors disabled:opacity-60"
        >
          {loadingEdit() ? (
            <>
              <span class="ml-spinner mr-2" aria-hidden="true" />
              {tr("cfg.chargement")}
            </>
          ) : (
            tr("produit.personnaliser")
          )}
        </button>
      </div>
      <p class="mt-3 text-sm text-ink-soft">
        {tr("produit.aide")}
      </p>

      <Show when={open()}>
        <div
          class="ml-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={tr("produit.personnaliser")}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div class="ml-modal-panel">
            <header class="ml-modal-head">
              <h2 class="text-xl sm:text-2xl">
                {tr("cfg.titre")}
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
                langue={props.langue}
                product={props.product}
                prices={props.prices}
                sansPrix={props.sansPrix}
                cadresProposes={props.cadresProposes}
                quantite={quantite()}
                foregroundUrl={props.foregroundUrl}
                defaults={{
                  ...props.defaults,
                  // Le format n'est repris qu'à l'AJOUT : rouvrir une ligne du
                  // panier doit rendre le format qu'elle porte, pas celui que
                  // la fiche affiche derrière la fenêtre.
                  ...(editItemId() == null && formatChoisi()
                    ? { format: formatChoisi() as PosterFormat }
                    : {}),
                }}
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
