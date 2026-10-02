/// <reference lib="dom" />
import { t, lien, LANGUE_DEFAUT, type Langue } from "../i18n/utils.ts";
import { createSignal, onCleanup, onMount, type JSX } from "solid-js";
import type { PosterConfig, PosterFormat } from "@memoryline/types";
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
  /** Le format coché d'emblée sur la fiche — le moins cher, en général. */
  formatInitial?: string;
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

  /*
   * Le format choisi sur la fiche.
   *
   * Même mécanique que le configurateur (ProductConfigurator) : les cases de
   * taille sont rendues par le serveur, ce bouton est un îlot monté après
   * coup, et l'événement « ml:format » est la seule chose qu'ils partagent.
   * Sans lui, la ligne partait sans format : le serveur la facturait alors
   * au prix de l'A4 et le fichier d'impression sortait en A4, même A3 coché.
   *
   * La valeur de départ vient d'une prop et non de l'événement : la fiche
   * coche sa première case dès le chargement, bien avant que l'îlot soit là
   * pour l'entendre.
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

  /**
   * Le message d'un ajout refusé.
   *
   * Ce que le site sait reconnaître se dit dans la langue de la page : l'API
   * injoignable (le navigateur lève alors une TypeError, sans réponse) et une
   * ligne que l'API refuse (« config invalide »). Le reste garde le texte de
   * l'API, qui dit au moins ce qui s'est passé.
   */
  function messageEchec(e: unknown): string {
    if (e instanceof TypeError) return tr("panier.err.ajout");
    if (String(e).includes("config invalide")) return tr("panier.err.config");
    return String(e);
  }

  async function add() {
    if (busy()) return;
    setBusy(true);
    setError(null);
    const config: PosterConfig = {
      schemaVersion: 1,
      view: props.product.defaultView || "front",
      texts: {},
      characters: [],
      // C'est ce format que le serveur lit pour le prix et pour l'impression.
      ...(formatChoisi() ? { format: formatChoisi() as PosterFormat } : {}),
    };
    try {
      await browserApi.addCartItem(getCartId(), {
        productId: props.product.id,
        unitPriceCents: props.product.basePriceCents,
        quantity: quantite(),
        title: props.product.name,
        config,
        langue: props.langue ?? LANGUE_DEFAUT,
      });
      window.location.href = lien(props.langue ?? LANGUE_DEFAUT, "/panier");
    } catch (e) {
      setError(messageEchec(e));
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
