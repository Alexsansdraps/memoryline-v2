/// <reference lib="dom" />
import type { JSX } from "solid-js";

/**
 * La vignette d'une carte cadeau, au panier et à la caisse : l'image de la
 * carte (18/11, Alexandra : « mets la photo de la carte plutôt »), la même
 * que dans les rayons (public/carte-cadeau/vignette-*.webp). Mêmes
 * proportions que les affiches (1:√2), pour que la liste garde sa ligne. Le
 * montant se lit au bout de la ligne, et se change sous son nom.
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
    <img
      src="/carte-cadeau/vignette-400.webp"
      alt=""
      title={`${props.libelle} · ${props.montant}`}
      width="400"
      height="549"
      class="ml-image-attente w-full rounded border border-ink/10 object-cover"
      style={{ "aspect-ratio": "1 / 1.4142" }}
    />
  );
}
