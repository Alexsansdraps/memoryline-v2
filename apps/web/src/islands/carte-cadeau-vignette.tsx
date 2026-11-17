/// <reference lib="dom" />
import type { JSX } from "solid-js";

/**
 * La vignette d'une carte cadeau, au panier et à la caisse : à la place de
 * l'aperçu d'une affiche, une carte qui porte son montant. Mêmes proportions
 * que les affiches (1:√2), pour que la liste garde sa ligne.
 *
 * Pas un îlot : un morceau d'îlot, importé par CartIsland et CheckoutIsland.
 */
export default function VignetteCarteCadeau(props: {
  /** Le montant déjà écrit dans la langue de la page : « 50,00 € ». */
  montant: string;
  /** « Carte cadeau », dans la langue de la page. */
  libelle: string;
}): JSX.Element {
  return (
    <div
      class="flex w-full flex-col items-center justify-center gap-1 rounded border border-ink/15 bg-paper-deep px-1 text-center"
      style={{ "aspect-ratio": "1 / 1.4142" }}
      aria-hidden="true"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" class="text-terracotta">
        <rect x="3" y="8" width="18" height="13" rx="1" />
        <path d="M3 12h18M12 8v13M12 8c-1.5-3-5-4-5-1.5S10 8 12 8zm0 0c1.5-3 5-4 5-1.5S14 8 12 8z" />
      </svg>
      <span class="text-[0.6rem] uppercase leading-tight tracking-[0.12em] text-ink-soft">{props.libelle}</span>
      <span class="text-sm font-medium leading-none">{props.montant}</span>
    </div>
  );
}
