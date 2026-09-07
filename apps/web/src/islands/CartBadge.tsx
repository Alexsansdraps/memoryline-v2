/// <reference lib="dom" />
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { getCartId, browserApi } from "../lib/api.ts";

/**
 * Pastille du panier : le nombre d'articles, à côté du lien « Panier ».
 *
 * Le compte est relu à l'affichage de la page — y compris au retour arrière
 * depuis le cache du navigateur (`pageshow`), sinon la pastille resterait
 * périmée après un ajout suivi d'un retour.
 */
export default function CartBadge() {
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
    onCleanup(() => window.removeEventListener("pageshow", auRetour));
  });

  return (
    <Show when={nombre() > 0}>
      <span
        class="ml-panier-pastille"
        aria-label={`${nombre()} article(s) dans le panier`}
      >
        {nombre()}
      </span>
    </Show>
  );
}
