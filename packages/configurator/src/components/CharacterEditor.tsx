/// <reference lib="dom" />
import { For, Show, createMemo } from "solid-js";
import type { CharacterTypeDTO, AssetDTO } from "@memoryline/types";
import {
  SLOT_ZORDER,
  findAsset,
  type SvgCache,
  type WorkingCharacter,
} from "../store";
import { Button, Field } from "./ui";

const SLOT_LABELS: Record<string, string> = {
  clothes: "Vêtements",
  pants: "Pantalon",
  shoes: "Chaussures",
  hair: "Cheveux",
  head: "Visage",
  accessory: "Accessoire",
};

/**
 * Éditeur d'un personnage : choix d'asset par slot + recoloration par zone
 * (accessoire inclus, §18.1 D). Boutons Retour / Valider (§18.2 F).
 */
export function CharacterEditor(props: {
  character: WorkingCharacter;
  type: CharacterTypeDTO | undefined;
  cache: SvgCache;
  onSetAsset: (slot: string, assetId: string | number) => void;
  onSetColor: (zone: string, hex: string) => void;
  onBack: () => void;
  onValidate: () => void;
}) {
  /** Zones de couleur agrégées sur tous les assets choisis (accessoire compris). */
  const zones = createMemo<Record<string, string>>(() => {
    const t = props.type;
    const out: Record<string, string> = {};
    if (!t) return out;
    for (const slot of SLOT_ZORDER) {
      const asset = findAsset(t, slot, props.character.assets[slot]);
      if (!asset) continue;
      for (const zone of Object.keys(asset.colorZones ?? {})) {
        out[zone] =
          props.character.colors[zone] ?? asset.colorZones?.[zone] ?? "#000000";
      }
    }
    return out;
  });

  return (
    <div class="ml-cfg-editor">
      <h3 style={{ "font-weight": "700", "margin-bottom": "10px" }}>
        Personnaliser le personnage
      </h3>

      {/* Choix d'asset par slot */}
      <For each={SLOT_ZORDER}>
        {(slot) => {
          const list = (): AssetDTO[] => props.type?.assetsBySlot[slot] ?? [];
          return (
            <Show when={list().length > 0}>
              <Field label={SLOT_LABELS[slot] ?? slot}>
                <div
                  style={{
                    display: "flex",
                    gap: "6px",
                    "flex-wrap": "wrap",
                  }}
                >
                  <For each={list()}>
                    {(asset) => {
                      const selected = () =>
                        String(props.character.assets[slot]) ===
                        String(asset.id);
                      return (
                        <button
                          type="button"
                          onClick={() => props.onSetAsset(slot, asset.id)}
                          title={asset.name ?? ""}
                          style={{
                            border: selected()
                              ? "2px solid #4f46e5"
                              : "1px solid #d1d5db",
                            "border-radius": "6px",
                            padding: "4px 8px",
                            background: "#fff",
                            cursor: "pointer",
                            "font-size": "12px",
                          }}
                        >
                          {asset.name ?? `#${asset.id}`}
                        </button>
                      );
                    }}
                  </For>
                </div>
              </Field>
            </Show>
          );
        }}
      </For>

      {/* Recoloration par zone */}
      <Show when={Object.keys(zones()).length > 0}>
        <div style={{ "margin-top": "12px" }}>
          <span
            style={{
              display: "block",
              "font-size": "13px",
              "font-weight": "600",
              color: "#374151",
              "margin-bottom": "6px",
            }}
          >
            Couleurs
          </span>
          <div
            style={{
              display: "grid",
              "grid-template-columns": "repeat(auto-fill, minmax(120px, 1fr))",
              gap: "8px",
            }}
          >
            <For each={Object.entries(zones())}>
              {([zone, hex]) => (
                <label
                  style={{
                    display: "flex",
                    "align-items": "center",
                    gap: "6px",
                    "font-size": "12px",
                  }}
                >
                  <input
                    type="color"
                    value={hex}
                    onInput={(e) =>
                      props.onSetColor(zone, e.currentTarget.value)
                    }
                    style={{
                      width: "32px",
                      height: "32px",
                      border: "none",
                      padding: "0",
                    }}
                  />
                  <span>{zone}</span>
                </label>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* Navigation §18.2 F */}
      <div
        style={{
          display: "flex",
          "justify-content": "space-between",
          gap: "8px",
          "margin-top": "18px",
        }}
      >
        <Button variant="secondary" onClick={() => props.onBack()}>
          Retour
        </Button>
        <Button variant="primary" onClick={() => props.onValidate()}>
          Valider mon personnage
        </Button>
      </div>
    </div>
  );
}
