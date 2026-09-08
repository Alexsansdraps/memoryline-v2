/// <reference lib="dom" />
import { For, Show, createSignal, onCleanup } from "solid-js";
import { POSTER_FORMATS, type PosterFormat } from "@memoryline/types";
import type { CadreDTO, ConfiguratorState } from "../store";
import type { MessagesConfigurateur } from "../messages";

/**
 * Étape 3 : choix du format (A4 / A3).
 *
 * L'orientation (de face / de dos) n'est PAS choisie ici : elle est une
 * propriété du PRODUIT (sa scène — muret de dos, etc.) et des personnages
 * proposés. Un ancien sélecteur « Orientation des personnages » changeait la
 * vue de l'affiche sans réorienter les persos déjà posés (SVG face ≠ SVG dos),
 * ce qui affichait des persos de dos sur une affiche de face — retiré.
 */
export function StepFormat(props: {
  state: ConfiguratorState;
  prices?: Partial<Record<PosterFormat, number>>;
  onSelect: (format: PosterFormat) => void;
  /** Cadres proposés en option (vide = aucun cadre configuré). */
  cadres?: CadreDTO[];
  onSelectCadre: (frameId: string | number | null) => void;
  messages: MessagesConfigurateur;
}) {
  const m = () => props.messages;

  // Rail des cadres : largeurs de vignette.
  const ESPACE = 10; // même valeur que le `gap` du rail
  const VIGNETTE_MAX = 140;
  const VIGNETTE_MIN = 110; // en dessous, « Cadre blanc + 15 € » ne tient plus
  const VIGNETTE_PLANCHER = 96; // toléré si c'est le seul moyen de couper net

  /**
   * Largeur d'une vignette pour que le rail se termine AU MILIEU d'une
   * vignette quand il déborde.
   *
   * Sans ça, la dernière vignette visible peut être coupée à 5 % : on ne voit
   * pas qu'il reste des cadres à droite. On cherche donc la largeur qui laisse
   * « k vignettes entières + une moitié » dans la largeur disponible.
   */
  function largeurPourApercu(dispo: number, nb: number): number {
    if (dispo <= 0 || nb <= 0) return VIGNETTE_MAX;
    // Tout tient ? largeur naturelle, pas de défilement.
    const naturel = Math.min(VIGNETTE_MAX, (dispo - (nb - 1) * ESPACE) / nb);
    if (naturel >= VIGNETTE_MIN) return naturel;
    // `l` décroît quand `k` grandit : le premier `k` acceptable donne la
    // vignette la plus large possible.
    let repli = 0;
    for (let k = 1; k < nb; k++) {
      const l = (dispo - k * ESPACE) / (k + 0.5);
      if (l > VIGNETTE_MAX) continue;
      if (l >= VIGNETTE_MIN) return l;
      if (!repli && l >= VIGNETTE_PLANCHER) repli = l;
    }
    return (
      repli ||
      Math.max(VIGNETTE_MIN, Math.min(VIGNETTE_MAX, (dispo - ESPACE) / 2.5))
    );
  }

  const [largeur, setLargeur] = createSignal(VIGNETTE_MAX);
  const largeurVignette = (): import("solid-js").JSX.CSSProperties => ({
    // Les trois propriétés séparément : la forme raccourcie `flex: 0 0 …`
    // avec une fonction de calcul n'est pas appliquée partout.
    "flex-grow": "0",
    "flex-shrink": "0",
    "flex-basis": `${largeur()}px`,
    "scroll-snap-align": "start",
  });

  // Le rail des cadres défile horizontalement. On surveille s'il déborde
  // pour n'afficher le dégradé de bord que dans ce cas : un dégradé permanent
  // ferait croire à un contenu caché alors que tout est visible.
  const [rail, setRail] = createSignal<HTMLDivElement>();
  const [deborde, setDeborde] = createSignal(false);
  const mesurer = () => {
    const el = rail();
    if (!el) return;
    setLargeur(
      largeurPourApercu(el.clientWidth, (props.cadres?.length ?? 0) + 1),
    );
    // Reste-t-il quelque chose à droite ? Arrivé au bout, le dégradé
    // disparaît : sinon il laisserait croire qu'il y a encore des cadres.
    setDeborde(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
  };
  const brancherRail = (el: HTMLDivElement) => {
    setRail(el);
    mesurer();
    // Les cadres arrivent en asynchrone et la largeur dépend de l'écran :
    // une seule mesure au montage ne suffirait pas.
    const ro = new ResizeObserver(mesurer);
    ro.observe(el);
    for (const enfant of Array.from(el.children)) ro.observe(enfant);
    onCleanup(() => ro.disconnect());
  };
  const fmtPrice = (cents: number) =>
    new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);
  const tile = (selected: boolean): import("solid-js").JSX.CSSProperties => ({
    flex: "1",
    // Le rembourrage compte DANS la largeur : sans ça, une vignette de rail
    // large de 118 px en occupe 150 à l'écran et le calcul du débord est faux.
    "box-sizing": "border-box",
    padding: "16px",
    border: selected ? "2px solid #4f46e5" : "1px solid #d1d5db",
    "border-radius": "8px",
    background: selected ? "#eef2ff" : "#fff",
    cursor: "pointer",
    "font-size": "16px",
    "font-weight": "700",
  });

  return (
    <div class="ml-cfg-step">
      <h3 style={{ "font-weight": "700", "margin-bottom": "10px" }}>
        {m().etapeFormat}
      </h3>
      <div style={{ display: "flex", gap: "10px", "margin-bottom": "18px" }}>
        <For each={POSTER_FORMATS}>
          {(fmt) => (
            <button
              type="button"
              onClick={() => props.onSelect(fmt)}
              style={tile(props.state.format === fmt)}
            >
              <div>{fmt}</div>
              {typeof props.prices?.[fmt] === "number" && (
                <div style={{ "font-size": "14px", "font-weight": "600", color: "#4f46e5", "margin-top": "4px" }}>
                  {fmtPrice(props.prices[fmt]!)}
                </div>
              )}
            </button>
          )}
        </For>
      </div>

      {/* Cadre en option : « sans cadre » d'abord, puis les cadres actifs
          avec leur supplément. Le prix affiché est indicatif — c'est le
          serveur qui refait le calcul au moment de facturer. */}
      {(props.cadres?.length ?? 0) > 0 && (
        <>
          <h3 style={{ "font-weight": "700", "margin-bottom": "10px" }}>
            {m().cadre}
          </h3>
          <div style={{ position: "relative" }}>
            <div
              ref={brancherRail}
              onScroll={mesurer}
              class="ml-cfg-rail"
              style={{
                display: "flex",
                gap: "10px",
                "flex-wrap": "nowrap",
                "overflow-x": "auto",
                "scroll-snap-type": "x proximity",
                // Un peu d'air à droite pour que la dernière vignette ne colle
                // pas au dégradé.
                "padding-bottom": "4px",
              }}
            >
            <button
              type="button"
              onClick={() => props.onSelectCadre(null)}
              style={{
                ...tile(props.state.frameId == null),
                ...largeurVignette(),
                "font-size": "14px",
              }}
            >
              {m().sansCadre}
            </button>
            <For each={props.cadres}>
              {(cadre) => (
                <button
                  type="button"
                  onClick={() => props.onSelectCadre(cadre.id)}
                  style={{
                    ...tile(String(props.state.frameId) === String(cadre.id)),
                    ...largeurVignette(),
                    "font-size": "14px",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      display: "block",
                      height: "22px",
                      "border-radius": "4px",
                      border: "3px solid " + (cadre.previewColor ?? "#b07d42"),
                      background: "#fff",
                      "margin-bottom": "6px",
                    }}
                  />
                  <div>{cadre.name}</div>
                  <div
                    style={{
                      "font-size": "13px",
                      "font-weight": "600",
                      color: "#4f46e5",
                      "margin-top": "2px",
                    }}
                  >
                    + {fmtPrice(cadre.priceCents)}
                  </div>
                </button>
              )}
            </For>
            </div>
            {/* Voile de bord : signale qu'il reste des cadres à droite. */}
            <Show when={deborde()}>
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  top: "0",
                  right: "0",
                  bottom: "4px",
                  width: "28px",
                  "pointer-events": "none",
                  background:
                    "linear-gradient(to right, rgba(255,255,255,0), #fff)",
                }}
              />
            </Show>
          </div>
        </>
      )}
    </div>
  );
}
