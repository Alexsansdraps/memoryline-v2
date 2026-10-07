/// <reference lib="dom" />
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { getCartId, lirePanier } from "../lib/api-navigateur.ts";

/**
 * Pastille du panier : le nombre d'articles, à côté du lien « Panier ».
 *
 * Le compte est relu à l'affichage de la page — y compris au retour arrière
 * depuis le cache du navigateur (`pageshow`), sinon la pastille resterait
 * périmée après un ajout suivi d'un retour.
 *
 * Elle est sur TOUTES les pages : elle doit peser le moins possible. Son
 * libellé arrive donc tout traduit, en propriété (Base.astro), au lieu
 * d'être cherché dans le dictionnaire des cinq langues ; et elle lit le
 * panier par api-navigateur.ts plutôt que par api.ts. Les deux tiraient
 * avec eux 209 Ko de JavaScript (53 Ko compressés) que la page entière
 * n'utilisait pas.
 */
export default function CartBadge(props: {
  /**
   * Ce que lisent les lecteurs d'écran, dans la langue de la page, avec
   * « {nombre} » à la place du nombre d'articles (clé « panier.pastille »).
   */
  libelle: string;
}) {
  const [nombre, setNombre] = createSignal(0);

  async function rafraichir() {
    try {
      // Un panier tout juste payé revient vide (null) : il est oublié, et le
      // suivant repart de zéro (api-navigateur.ts, lirePanier).
      const panier = await lirePanier<{
        status?: string | null;
        items?: { quantity?: number | string | null }[];
      }>(getCartId());
      setNombre(
        (panier?.items ?? []).reduce(
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
        aria-label={props.libelle.replace("{nombre}", String(nombre()))}
      >
        {nombre()}
      </span>
    </Show>
  );
}
