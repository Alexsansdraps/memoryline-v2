/// <reference lib="dom" />
import type { CleUi, Langue } from "../i18n/utils.ts";
import { createSignal, onCleanup, onMount, type JSX } from "solid-js";
import type { PosterConfig, PosterFormat } from "@memoryline/types";
import { ajouterAuPanier, getCartId, versLePanier } from "../lib/api-navigateur.ts";
import { messageAjoutRefuse } from "../lib/ajout-panier.ts";

/**
 * Bouton « Ajouter au panier » pour une affiche prête à imprimer (sans
 * personnalisation). Envoie une config minimale et redirige vers /panier.
 *
 * Il n'importe ni le dictionnaire des langues ni api.ts : ses mots arrivent
 * traduits par la page (`libelles`), et l'ajout passe par le module léger
 * du navigateur. Avant, la fiche téléchargeait près de 200 Ko de
 * JavaScript avant que ce bouton devienne cliquable (AUDIT-SEO.md, VIT-2).
 */
export const LIBELLES_AJOUT = [
  "panier.moins",
  "panier.plus",
  "panier.quantite",
  "produit.ajout_en_cours",
  "produit.ajouter",
  "panier.err.config",
  "panier.err.ajout",
] as const satisfies readonly CleUi[];

export interface AddToCartButtonProps {
  /** Langue de la page : celle de la ligne ajoutée au panier. */
  langue?: Langue;
  /** Les mots du bouton, traduits par la page (libelles(langue, LIBELLES_AJOUT)). */
  libelles: Record<(typeof LIBELLES_AJOUT)[number], string>;
  /** La page de commande dans la langue de la page : le panier du site (17/11). */
  adresseCommande: string;
  /** Le panier de la tablette du stand, dans la langue de la page. */
  adressePanier: string;
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
  const tr = (cle: CleUi): string =>
    (props.libelles as Record<string, string>)[cle] ?? String(cle);
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
      await ajouterAuPanier(getCartId(), {
        productId: props.product.id,
        unitPriceCents: props.product.basePriceCents,
        quantity: quantite(),
        title: props.product.name,
        config,
        langue: props.langue ?? "fr",
      });
      window.location.href = versLePanier(props.adresseCommande, props.adressePanier);
    } catch (e) {
      // Dans la langue de la page, jamais le texte brut de l'API.
      setError(messageAjoutRefuse(e, tr));
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
        {/* Pendant l'ajout, le bouton reste noir (global.css lit
            `aria-busy`) et dit ce qu'il fait, un rond qui tourne à côté. Il
            n'affichait qu'un « … » grisé : on le prenait pour une panne et on
            touchait une deuxième fois. */}
        <button
          type="button"
          onClick={add}
          disabled={busy()}
          aria-busy={busy()}
          class="inline-block rounded-full bg-ink px-8 py-3 text-paper font-medium hover:bg-ink/85 transition-colors disabled:opacity-60"
        >
          {busy() ? (
            <>
              <span class="ml-spinner ml-spinner-clair mr-2" aria-hidden="true" />
              {tr("produit.ajout_en_cours")}
            </>
          ) : (
            tr("produit.ajouter")
          )}
        </button>
      </div>
      {error() && (
        <p class="mt-3 text-sm text-terracotta-deep">{error()}</p>
      )}
    </div>
  );
}
