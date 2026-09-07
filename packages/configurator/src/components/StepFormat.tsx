/// <reference lib="dom" />
import { For } from "solid-js";
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
          <div style={{ display: "flex", gap: "10px", "flex-wrap": "wrap" }}>
            <button
              type="button"
              onClick={() => props.onSelectCadre(null)}
              style={{
                ...tile(props.state.frameId == null),
                "min-width": "110px",
                flex: "0 1 auto",
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
                    "min-width": "110px",
                    flex: "0 1 auto",
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
        </>
      )}
    </div>
  );
}
