/// <reference lib="dom" />
import { For, Show, createSignal, type Accessor } from "solid-js";
import type { CharacterTypeDTO } from "@memoryline/types";
import type { ConfiguratorState, SvgCache } from "../store";
import { DraggableCharacter } from "./CharacterLayer";

/** Ratio largeur/hauteur d'affichage selon le format (portrait). */
function aspectFor(format: string): string {
  // A4 / A3 partagent le même ratio papier ~ 1:1.4142 (portrait).
  return format === "A4" || format === "A3" ? "1 / 1.4142" : "1 / 1.4142";
}

/**
 * Aperçu de l'affiche, espace de coordonnées normalisé 0..1.
 * Couches : fond -> personnages -> titre/sous-titre.
 */
export function PosterPreview(props: {
  state: ConfiguratorState;
  typeById: (id: string | number) => CharacterTypeDTO | undefined;
  cache: SvgCache;
  /** interactif (étape personnages) ou simple aperçu. */
  interactive: boolean;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onMove: (index: number, x: number, y: number) => void;
  onScale: (index: number, scale: number) => void;
}) {
  const [posterEl, setPosterEl] = createSignal<HTMLDivElement>();
  const ref: Accessor<HTMLDivElement | undefined> = posterEl;

  return (
    <div
      ref={setPosterEl}
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

      {/* Couche personnages */}
      <For each={props.state.characters}>
        {(c, i) => (
          <DraggableCharacter
            character={c}
            index={i()}
            type={props.typeById(c.typeId)}
            cache={props.cache}
            selected={props.interactive && props.selectedIndex === i()}
            baseSize={0.32}
            posterEl={ref}
            onSelect={props.interactive ? props.onSelect : () => {}}
            onMove={props.interactive ? props.onMove : () => {}}
            onScale={props.interactive ? props.onScale : () => {}}
          />
        )}
      </For>

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
