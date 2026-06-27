/// <reference lib="dom" />
import { For, Show } from "solid-js";
import { Button } from "./ui";
import { CharacterEditor } from "./CharacterEditor";
import type {
  CharacterDTO,
  ConfiguratorState,
  Slot,
  SlotVariants,
  SvgCache,
} from "../store";

/**
 * Étape 2 : gestion des personnages.
 * - liste des personnages ajoutés (Modifier / supprimer / réordonner),
 *   bouton « + Nouveau personnage ».
 * - clic Modifier / Nouveau -> éditeur de personnage (CharacterEditor).
 */
export function StepCharacters(props: {
  state: ConfiguratorState;
  characters: CharacterDTO[];
  slots: SlotVariants;
  cache: SvgCache;
  characterById: (id: string | number) => CharacterDTO | undefined;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onSelect: (index: number | null) => void;
  onBringForward: (index: number) => void;
  onSendBackward: (index: number) => void;
  onSetAsset: (index: number, slot: Slot, variantId: string | number) => void;
  onClearSlot: (index: number, slot: Slot) => void;
  onSetColor: (index: number, zone: string, hex: string) => void;
  onChangeCharacter: (index: number, base: CharacterDTO) => void;
}) {
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

            {/* Liste des personnages ajoutés + z-order */}
            <Show when={props.state.characters.length > 0}>
              <div style={{ "margin-bottom": "14px" }}>
                <For each={props.state.characters}>
                  {(c, i) => {
                    const base = props.characterById(c.characterId);
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
                          {base?.name ?? `Personnage ${c.characterId}`}
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
                          Modifier
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

            <Button variant="primary" onClick={() => props.onAdd()}>
              + Nouveau personnage
            </Button>
          </div>
        }
      >
        {(char) => (
          <CharacterEditor
            character={char()}
            base={props.characterById(char().characterId)}
            characters={props.characters}
            slots={props.slots}
            cache={props.cache}
            onSetAsset={(slot, variantId) =>
              props.onSetAsset(editing()!, slot, variantId)
            }
            onClearSlot={(slot) => props.onClearSlot(editing()!, slot)}
            onSetColor={(zone, hex) => props.onSetColor(editing()!, zone, hex)}
            onChangeCharacter={(base) =>
              props.onChangeCharacter(editing()!, base)
            }
            onBack={() => props.onSelect(null)}
            onValidate={() => props.onSelect(null)}
          />
        )}
      </Show>
    </div>
  );
}
