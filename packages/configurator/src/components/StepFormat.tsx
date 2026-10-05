/// <reference lib="dom" />
import { For, Show, createSignal, onCleanup } from "solid-js";
import {
  dimensionsFormat,
  POSTER_FORMATS,
  prixDuCadreCents,
  type PosterFormat,
} from "@memoryline/types";
import type { CadreDTO, ConfiguratorState } from "../store";
import type { MessagesConfigurateur } from "../messages";
import { ZoneDefilante } from "./Defilement";

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
  /** Stand de salon : les choix restent, les montants disparaissent. */
  sansPrix?: boolean;
  onSelect: (format: PosterFormat) => void;
  /** Cadres proposés en option (vide = aucun cadre configuré). */
  cadres?: CadreDTO[];
  onSelectCadre: (frameId: string | number | null) => void;
  messages: MessagesConfigurateur;
}) {
  const m = () => props.messages;
  /** Locale d'affichage des montants et des dimensions. */
  const locale = () => m().locale;

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

  // Le rail des cadres défile horizontalement : ses flèches et sa barre sont
  // celles de toutes les listes (ZoneDefilante). Elles remplacent le dégradé
  // de bord d'avant, qui recouvrait justement la moitié de vignette servant
  // d'indice, et ne se voyait guère sur le fond blanc.
  const [rail, setRail] = createSignal<HTMLDivElement>();
  const mesurer = () => {
    const el = rail();
    if (!el) return;
    setLargeur(
      largeurPourApercu(el.clientWidth, (props.cadres?.length ?? 0) + 1),
    );
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
    new Intl.NumberFormat(locale(), {
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
              // L'état, lisible par un lecteur d'écran, et les marques du
              // choix fait posées par le site (`ml-choix`) ; le style en
              // ligne reste le repli du module seul.
              aria-pressed={props.state.format === fmt}
              class="ml-choix"
              style={tile(props.state.format === fmt)}
            >
              <div>{fmt}</div>
              {/* La question qu'on se pose devant un mur vide n'est pas
                  « A4 ou A3 » mais « est-ce que ça rentre ». */}
              <div style={{ "font-size": "12px", color: "#6b7280", "margin-top": "2px" }}>
                {dimensionsFormat(fmt, locale())}
              </div>
              {!props.sansPrix && typeof props.prices?.[fmt] === "number" && (
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
          <ZoneDefilante
            sens="horizontal"
            versDebut={m().precedent}
            versFin={m().suivant}
            ref={brancherRail}
            onScroll={mesurer}
            class="ml-cfg-rail"
            style={{
              display: "flex",
              gap: "10px",
              "flex-wrap": "nowrap",
              "overflow-x": "auto",
              "scroll-snap-type": "x proximity",
              "padding-bottom": "4px",
            }}
          >
            <button
              type="button"
              onClick={() => props.onSelectCadre(null)}
              aria-pressed={props.state.frameId == null}
              class="ml-choix"
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
                  aria-pressed={String(props.state.frameId) === String(cadre.id)}
                  class="ml-choix"
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
                  <Show when={!props.sansPrix}>
                    <div
                      style={{
                        "font-size": "13px",
                        "font-weight": "600",
                        color: "#4f46e5",
                        "margin-top": "2px",
                      }}
                    >
                      {/* Le supplément du format COCHÉ au-dessus : passer
                          de l'A4 à l'A3 change le prix du cadre sous les
                          yeux, pas seulement celui de l'affiche. */}
                      + {fmtPrice(prixDuCadreCents(cadre, props.state.format))}
                    </div>
                  </Show>
                </button>
              )}
            </For>
          </ZoneDefilante>
        </>
      )}
    </div>
  );
}
