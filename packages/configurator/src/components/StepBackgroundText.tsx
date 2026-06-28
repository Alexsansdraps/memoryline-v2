/// <reference lib="dom" />
import { For, Show } from "solid-js";
import type { BackgroundDTO } from "@memoryline/types";
import type { ConfiguratorState } from "../store";
import { Field } from "./ui";

const FONTS = [
  "sans-serif",
  "serif",
  "Georgia, serif",
  "'Times New Roman', serif",
  "'Courier New', monospace",
  "cursive",
];

/** Étape 1 : fond + textes (titre + sous-titre, symboles & chiffres autorisés). */
export function StepBackgroundText(props: {
  state: ConfiguratorState;
  backgrounds: BackgroundDTO[];
  assetBaseUrl: string;
  onSelectBackground: (bg: BackgroundDTO) => void;
  onText: (
    which: "title" | "subtitle",
    patch: Partial<{ value: string; font: string; color: string }>,
  ) => void;
}) {
  const resolve = (url: string) =>
    url.startsWith("http") ? url : props.assetBaseUrl.replace(/\/$/, "") + url;

  const inputStyle = {
    width: "100%",
    padding: "8px 10px",
    "border-radius": "6px",
    border: "1px solid #d1d5db",
    "font-size": "14px",
  } as const;

  return (
    <div class="ml-cfg-step">
      <h3 style={{ "font-weight": "700", "margin-bottom": "10px" }}>
        Fond & texte
      </h3>

      {/* Galerie de fonds : affichée UNIQUEMENT si le produit a plusieurs
          variantes de fond. Avec un seul fond (cas normal), l'affiche est fixée
          par le produit → pas de choix proposé au client. */}
      <Show when={props.backgrounds.length > 1}>
        <Field label="Choisir un fond">
          <div
            style={{
              display: "grid",
              "grid-template-columns": "repeat(auto-fill, minmax(72px, 1fr))",
              gap: "8px",
            }}
          >
            <For each={props.backgrounds}>
              {(bg) => {
                const selected = () =>
                  String(props.state.backgroundId) === String(bg.id);
                return (
                  <button
                    type="button"
                    onClick={() => props.onSelectBackground(bg)}
                    title={bg.name ?? ""}
                    style={{
                      border: selected()
                        ? "2px solid #4f46e5"
                        : "1px solid #d1d5db",
                      "border-radius": "6px",
                      padding: "2px",
                      cursor: "pointer",
                      background: "#fff",
                      "aspect-ratio": "1 / 1.4142",
                      overflow: "hidden",
                    }}
                  >
                    <img
                      src={resolve(bg.url)}
                      alt={bg.name ?? ""}
                      style={{
                        width: "100%",
                        height: "100%",
                        "object-fit": "cover",
                      }}
                    />
                  </button>
                );
              }}
            </For>
          </div>
        </Field>
      </Show>

      {/* Titre */}
      <Field label="Titre (symboles et chiffres autorisés)">
        <input
          type="text"
          value={props.state.title.value}
          placeholder="Ex : Notre famille n°1 ★"
          onInput={(e) => props.onText("title", { value: e.currentTarget.value })}
          style={inputStyle}
        />
      </Field>
      <div style={{ display: "flex", gap: "12px", "margin-bottom": "8px" }}>
        <Field label="Police du titre">
          <select
            value={props.state.title.font}
            onChange={(e) => props.onText("title", { font: e.currentTarget.value })}
            style={inputStyle}
          >
            <For each={FONTS}>{(f) => <option value={f}>{f}</option>}</For>
          </select>
        </Field>
        <Field label="Couleur">
          <input
            type="color"
            value={props.state.title.color}
            onInput={(e) => props.onText("title", { color: e.currentTarget.value })}
            style={{ width: "48px", height: "38px", border: "none" }}
          />
        </Field>
      </div>

      {/* Sous-titre */}
      <Field label="Sous-titre (symboles et chiffres autorisés)">
        <input
          type="text"
          value={props.state.subtitle.value}
          placeholder="Ex : depuis 2010 — #amour"
          onInput={(e) =>
            props.onText("subtitle", { value: e.currentTarget.value })
          }
          style={inputStyle}
        />
      </Field>
      <div style={{ display: "flex", gap: "12px" }}>
        <Field label="Police du sous-titre">
          <select
            value={props.state.subtitle.font}
            onChange={(e) =>
              props.onText("subtitle", { font: e.currentTarget.value })
            }
            style={inputStyle}
          >
            <For each={FONTS}>{(f) => <option value={f}>{f}</option>}</For>
          </select>
        </Field>
        <Field label="Couleur">
          <input
            type="color"
            value={props.state.subtitle.color}
            onInput={(e) =>
              props.onText("subtitle", { color: e.currentTarget.value })
            }
            style={{ width: "48px", height: "38px", border: "none" }}
          />
        </Field>
      </div>
    </div>
  );
}
