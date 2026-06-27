/// <reference lib="dom" />
import { For } from "solid-js";
import {
  POSTER_FORMATS,
  POSTER_VIEWS,
  type PosterFormat,
  type PosterView,
} from "@memoryline/types";
import type { ConfiguratorState } from "../store";

const VIEW_LABELS: Record<PosterView, string> = {
  front: "De face",
  back: "De dos",
};

/** Étape 3 : choix du format (A4 / A3) + vue (face / dos). */
export function StepFormat(props: {
  state: ConfiguratorState;
  prices?: Partial<Record<PosterFormat, number>>;
  onSelect: (format: PosterFormat) => void;
  onSelectView: (view: PosterView) => void;
}) {
  const fmtPrice = (cents: number) =>
    new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);
  const tile = (selected: boolean): import("solid-js").JSX.CSSProperties => ({
    flex: "1",
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
      <h3 style={{ "font-weight": "700", "margin-bottom": "10px" }}>Format</h3>
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

      <h3 style={{ "font-weight": "700", "margin-bottom": "10px" }}>
        Orientation des personnages
      </h3>
      <div style={{ display: "flex", gap: "10px" }}>
        <For each={POSTER_VIEWS}>
          {(view) => (
            <button
              type="button"
              onClick={() => props.onSelectView(view)}
              style={tile(props.state.view === view)}
            >
              {VIEW_LABELS[view]}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}
