/// <reference lib="dom" />
import { t, LANGUE_DEFAUT, type Langue } from "../i18n/utils.ts";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { getCartId, browserApi } from "../lib/api.ts";

/**
 * Pastille du panier : le nombre d'articles, à côté du lien « Panier ».
 *
 * Le compte est relu à l'affichage de la page — y compris au retour arrière
 * depuis le cache du navigateur (`pageshow`), sinon la pastille resterait
 * périmée après un ajout suivi d'un retour.
 */
export default function CartBadge(props: {
  /** Langue de la page — pilote l'intitulé lu par les lecteurs d'écran. */
  langue?: Langue;
}) {
  const tr = t(props.langue ?? LANGUE_DEFAUT);
  const [nombre, setNombre] = createSignal(0);

  async function rafraichir() {
    try {
      const panier = await browserApi.cart(getCartId());
      setNombre(
        (panier.items ?? []).reduce(
          (total, ligne) => total + (Number(ligne.quantity) || 0),
          0,
        ),
      );
    } catch {
      // Panier injoignable : pas de pastille plutôt qu'un zéro trompeur.
      setNombre(0);
    }
  }

  onMount(() => {
    void rafraichir();
    const auRetour = () => void rafraichir();
    window.addEventListener("pageshow", auRetour);
    // « ml:panier » : un îlot de la page vient de changer de panier sans
    // recharger — la vente du stand, qui repart d'un panier neuf, ou le
    // paiement, qui vide le panier sous l'écran « Merci ».
    window.addEventListener("ml:panier", auRetour);
    onCleanup(() => {
      window.removeEventListener("pageshow", auRetour);
      window.removeEventListener("ml:panier", auRetour);
    });
  });

  return (
    <Show when={nombre() > 0}>
      <span
        class="ml-panier-pastille"
        aria-label={tr("panier.pastille").replace("{nombre}", String(nombre()))}
      >
        {nombre()}
      </span>
    </Show>
  );
}
