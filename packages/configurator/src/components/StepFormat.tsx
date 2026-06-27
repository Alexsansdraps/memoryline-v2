/// <reference lib="dom" />
import { For } from "solid-js";
import { POSTER_FORMATS, type PosterFormat } from "@memoryline/types";
import type { ConfiguratorState } from "../store";

/** Étape 3 : choix du format (A4 / A3). */
export function StepFormat(props: {
  state: ConfiguratorState;
  onSelect: (format: PosterFormat) => void;
}) {
  return (
    <div class="ml-cfg-step">
      <h3 style={{ "font-weight": "700", "margin-bottom": "10px" }}>Format</h3>
      <div style={{ display: "flex", gap: "10px" }}>
        <For each={POSTER_FORMATS}>
          {(fmt) => {
            const selected = () => props.state.format === fmt;
            return (
              <button
                type="button"
                onClick={() => props.onSelect(fmt)}
                style={{
                  flex: "1",
                  padding: "16px",
                  border: selected()
                    ? "2px solid #4f46e5"
                    : "1px solid #d1d5db",
                  "border-radius": "8px",
                  background: selected() ? "#eef2ff" : "#fff",
                  cursor: "pointer",
                  "font-size": "16px",
                  "font-weight": "700",
                }}
              >
                {fmt}
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
}
