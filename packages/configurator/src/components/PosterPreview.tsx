/// <reference lib="dom" />
import { For, Show } from "solid-js";
import {
  autoPlace,
  CHAR_BASE_WIDTH,
  type CharacterDTO,
  type ConfiguratorState,
  type SlotsDTO,
  type SvgCache,
} from "../store";
import { CharacterStack } from "./CharacterLayer";

/** Ratio largeur/hauteur d'affichage selon le format (portrait). */
function aspectFor(format: string): string {
  // A4 / A3 partagent le même ratio papier ~ 1:1.4142 (portrait).
  return format === "A4" || format === "A3" ? "1 / 1.4142" : "1 / 1.4142";
}

/**
 * Aperçu de l'affiche, espace de coordonnées normalisé 0..1.
 * Couches : fond -> personnages -> titre/sous-titre.
 *
 * Les personnages sont placés AUTOMATIQUEMENT (plus de drag/resize §18.2 F) :
 * centrés, côte à côte, le long du bas-milieu de l'affiche. Aucun pointer
 * event, aucune sélection visible sur l'affiche.
 */
export function PosterPreview(props: {
  state: ConfiguratorState;
  characterById: (id: string | number) => CharacterDTO | undefined;
  slots: SlotsDTO;
  cache: SvgCache;
  /** Décor d'avant-plan spécifique au produit (surcharge le muret par défaut). */
  foregroundUrl?: string;
  /** Décor d'avant-plan par défaut (le muret), affiché en vue de dos. */
  defaultForeground?: string;
}) {

  return (
    <div
      class="ml-cfg-poster"
      style={{
        position: "relative",
        width: "100%",
        "aspect-ratio": aspectFor(props.state.format),
        background: "#f3f4f6",
        overflow: "hidden",
        "border-radius": "8px",
        "box-shadow": "0 1px 4px rgba(0,0,0,.15)",
      }}
    >
      {/* Couche fond */}
      <Show when={props.state.backgroundUrl}>
        {(url) => (
          <img
            src={url()}
            alt=""
            draggable={false}
            style={{
              position: "absolute",
              inset: "0",
              width: "100%",
              height: "100%",
              "object-fit": "cover",
              "pointer-events": "none",
              "user-select": "none",
            }}
          />
        )}
      </Show>

      {/* Couche personnages — placement automatique, non interactif */}
      <For each={props.state.characters}>
        {(c, i) => {
          const place = () =>
            autoPlace(props.state.characters)[i()] ?? {
              x: 0.5,
              y: 0.74,
              scale: 0.6,
            };
          // Largeur effective = largeur de base × échelle (rangée centrée).
          const widthPct = () => CHAR_BASE_WIDTH * place().scale * 100;
          return (
            <div
              style={{
                position: "absolute",
                left: `${place().x * 100}%`,
                top: `${place().y * 100}%`,
                width: `${widthPct()}%`,
                transform: "translate(-50%, -50%)",
                "aspect-ratio": "1 / 2",
                "z-index": String(c.position + 1),
                "pointer-events": "none",
              }}
            >
              <CharacterStack
                character={c}
                base={props.characterById(c.characterId)}
                slots={
                  // Chaque perso utilise SON orientation native (dos/face),
                  // sinon la vue globale de l'affiche.
                  props.slots[
                    props.characterById(c.characterId)?.orientation ??
                      props.state.view
                  ]
                }
                cache={props.cache}
              />
            </div>
          );
        }}
      </For>

      {/* Couche décor d'avant-plan (le muret) — par-dessus les personnages pour
          l'effet « assis dessus ». UNIQUEMENT en vue de DOS. Comme l'ancien site :
          ancré en bas, pleine largeur, hauteur auto (bottom-0 w-full h-auto).
          Décor par défaut = muret ; surchargé par le foregroundUrl du produit. */}
      <Show when={props.state.view === "back" ? props.foregroundUrl ?? props.defaultForeground : undefined}>
        {(url) => (
          <img
            src={url()}
            alt=""
            draggable={false}
            style={{
              position: "absolute",
              bottom: "0",
              left: "0",
              width: "100%",
              height: "auto",
              "pointer-events": "none",
              "user-select": "none",
              "z-index": "100",
            }}
          />
        )}
      </Show>

      {/* Couche texte */}
      <div
        style={{
          position: "absolute",
          left: "0",
          right: "0",
          bottom: "6%",
          "text-align": "center",
          "pointer-events": "none",
          padding: "0 6%",
        }}
      >
        <Show when={props.state.title.value}>
          <div
            style={{
              "font-family": props.state.title.font,
              color: props.state.title.color,
              "font-weight": "700",
              "font-size": "clamp(14px, 5cqw, 40px)",
              "line-height": "1.1",
              "container-type": "inline-size",
              "word-break": "break-word",
            }}
          >
            {props.state.title.value}
          </div>
        </Show>
        <Show when={props.state.subtitle.value}>
          <div
            style={{
              "font-family": props.state.subtitle.font,
              color: props.state.subtitle.color,
              "font-size": "clamp(10px, 3cqw, 24px)",
              "margin-top": "0.3em",
              "word-break": "break-word",
            }}
          >
            {props.state.subtitle.value}
          </div>
        </Show>
      </div>
    </div>
  );
}
