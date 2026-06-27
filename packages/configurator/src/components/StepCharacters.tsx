/// <reference lib="dom" />
import { For, Show, createMemo } from "solid-js";
import type { CharacterTypeDTO } from "@memoryline/types";
import type { ConfiguratorState } from "../store";
import { Button } from "./ui";
import { CharacterEditor } from "./CharacterEditor";
import type { SvgCache } from "../store";

/** Groupe les types par catégorie (déjà ordonnés par category+position en amont). */
function groupByCategory(
  types: CharacterTypeDTO[],
): { category: string; items: CharacterTypeDTO[] }[] {
  const groups: { category: string; items: CharacterTypeDTO[] }[] = [];
  for (const t of types) {
    const cat = t.category ?? "Autres";
    let g = groups.find((x) => x.category === cat);
    if (!g) {
      g = { category: cat, items: [] };
      groups.push(g);
    }
    g.items.push(t);
  }
  return groups;
}

/**
 * Étape 2 : gestion des personnages.
 * - ajout par type, liste avec z-order (avancer/reculer), suppression
 * - sélection -> édition (asset + couleurs) via CharacterEditor.
 */
export function StepCharacters(props: {
  state: ConfiguratorState;
  characterTypes: CharacterTypeDTO[];
  cache: SvgCache;
  typeById: (id: string | number) => CharacterTypeDTO | undefined;
  onAddType: (type: CharacterTypeDTO) => void;
  onRemove: (index: number) => void;
  onSelect: (index: number | null) => void;
  onBringForward: (index: number) => void;
  onSendBackward: (index: number) => void;
  onSetAsset: (index: number, slot: string, assetId: string | number) => void;
  onClearSlot: (index: number, slot: string) => void;
  onSetColor: (index: number, zone: string, hex: string) => void;
  onChangeType: (index: number, type: CharacterTypeDTO) => void;
}) {
  const groups = createMemo(() => groupByCategory(props.characterTypes));
  const editing = () => props.state.editingIndex;
  const editingChar = () => {
    const i = editing();
    return i === null ? undefined : props.state.characters[i];
  };

  return (
    <div class="ml-cfg-step">
      <Show
        when={editing() !== null && editingChar()}
        fallback={
          <div>
            <h3 style={{ "font-weight": "700", "margin-bottom": "10px" }}>
              Personnages
            </h3>

            {/* Liste des personnages placés + z-order */}
            <Show when={props.state.characters.length > 0}>
              <div style={{ "margin-bottom": "14px" }}>
                <For each={props.state.characters}>
                  {(c, i) => {
                    const t = props.typeById(c.typeId);
                    return (
                      <div
                        style={{
                          display: "flex",
                          "align-items": "center",
                          gap: "6px",
                          padding: "6px 8px",
                          border: "1px solid #e5e7eb",
                          "border-radius": "6px",
                          "margin-bottom": "6px",
                          background: "#fff",
                        }}
                      >
                        <span style={{ flex: "1", "font-size": "13px" }}>
                          {t?.name ?? `Type ${c.typeId}`}
                          <span style={{ color: "#9ca3af" }}>
                            {" "}
                            (z {c.position})
                          </span>
                        </span>
                        <Button
                          variant="ghost"
                          onClick={() => props.onSendBackward(i())}
                        >
                          ↓
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => props.onBringForward(i())}
                        >
                          ↑
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => props.onSelect(i())}
                        >
                          Éditer
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => props.onRemove(i())}
                        >
                          ✕
                        </Button>
                      </div>
                    );
                  }}
                </For>
              </div>
            </Show>

            {/* Ajout par type, groupé par catégorie */}
            <p
              style={{
                "font-size": "13px",
                "font-weight": "600",
                color: "#374151",
                "margin-bottom": "6px",
              }}
            >
              Ajouter un personnage
            </p>
            <For each={groups()}>
              {(group) => (
                <div style={{ "margin-bottom": "10px" }}>
                  <Show when={group.category !== "Autres" || groups().length > 1}>
                    <p
                      style={{
                        "font-size": "12px",
                        color: "#6b7280",
                        "margin-bottom": "4px",
                      }}
                    >
                      {group.category}
                    </p>
                  </Show>
                  <div
                    style={{ display: "flex", "flex-wrap": "wrap", gap: "6px" }}
                  >
                    <For each={group.items}>
                      {(t) => (
                        <Button
                          variant="secondary"
                          onClick={() => props.onAddType(t)}
                        >
                          + {t.name}
                        </Button>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </div>
        }
      >
        {(char) => (
          <CharacterEditor
            character={char()}
            type={props.typeById(char().typeId)}
            characterTypes={props.characterTypes}
            cache={props.cache}
            onSetAsset={(slot, assetId) =>
              props.onSetAsset(editing()!, slot, assetId)
            }
            onClearSlot={(slot) => props.onClearSlot(editing()!, slot)}
            onSetColor={(zone, hex) =>
              props.onSetColor(editing()!, zone, hex)
            }
            onChangeType={(type) => props.onChangeType(editing()!, type)}
            onBack={() => props.onSelect(null)}
            onValidate={() => props.onSelect(null)}
          />
        )}
      </Show>
    </div>
  );
}
