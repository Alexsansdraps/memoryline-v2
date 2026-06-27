/// <reference lib="dom" />
import { createEffect, createMemo, Show, type JSX } from "solid-js";
import type {
  PosterConfig,
  PosterFormat,
  BackgroundDTO,
  CharacterTypeDTO,
} from "@memoryline/types";
import {
  STEPS,
  type Step,
  type ConfiguratorState,
  emptyState,
  stateFromConfig,
  configFromState,
  createConfiguratorStore,
  createSvgCache,
  defaultCharacterForType,
  findAsset,
  SLOT_ZORDER,
} from "./store";
import { PosterPreview } from "./components/PosterPreview";
import { StepBackgroundText } from "./components/StepBackgroundText";
import { StepCharacters } from "./components/StepCharacters";
import { StepFormat } from "./components/StepFormat";
import { Button } from "./components/ui";

/** Produit minimal injecté par l'hôte (pas d'appel réseau interne). */
export interface ConfiguratorProduct {
  id: string | number;
  name: string;
  basePriceCents: number;
}

export interface ConfiguratorProps {
  product: ConfiguratorProduct;
  backgrounds: BackgroundDTO[];
  /** Types non archivés, déjà ordonnés par category + position. */
  characterTypes: CharacterTypeDTO[];
  /** Réouverture (panier "edit" §18.3) : restaure tout l'état. */
  initialConfig?: PosterConfig;
  /** Préfixe pour fetch le texte SVG, ex "http://localhost:3100". */
  assetBaseUrl: string;
  onSubmit: (config: PosterConfig) => void;
  onBack?: () => void;
}

const STEP_LABELS: Record<Step, string> = {
  background: "Fond & texte",
  characters: "Personnages",
  format: "Format",
};

export function Configurator(props: ConfiguratorProps): JSX.Element {
  const initialState: ConfiguratorState = props.initialConfig
    ? stateFromConfig(props.initialConfig)
    : emptyState();

  const { state, mutate } = createConfiguratorStore(initialState);
  const { cache, fetchSvg } = createSvgCache(props.assetBaseUrl);

  const typeById = (id: string | number): CharacterTypeDTO | undefined =>
    props.characterTypes.find((t) => String(t.id) === String(id));

  // Prefetch des SVG nécessaires aux personnages présents.
  createEffect(() => {
    for (const c of state.characters) {
      const t = typeById(c.typeId);
      if (!t) continue;
      for (const slot of SLOT_ZORDER) {
        const asset = findAsset(t, slot, c.assets[slot]);
        if (asset) void fetchSvg(asset.svgUrl);
      }
    }
  });

  const stepIndex = createMemo(() => STEPS.indexOf(state.step));

  /* --------------------------- navigation --------------------------------- */
  function goToStep(step: Step) {
    mutate((s) => {
      s.step = step;
      s.editingIndex = null;
    });
  }
  function next() {
    const i = stepIndex();
    const target = STEPS[i + 1];
    if (target) goToStep(target);
    else submit();
  }
  function prev() {
    const i = stepIndex();
    if (i <= 0) {
      props.onBack?.();
      return;
    }
    const target = STEPS[i - 1];
    if (target) goToStep(target);
  }
  function submit() {
    props.onSubmit(configFromState(state, props.product.id));
  }

  /* --------------------------- étape 1 ------------------------------------ */
  function selectBackground(bg: BackgroundDTO) {
    const url = bg.url.startsWith("http")
      ? bg.url
      : props.assetBaseUrl.replace(/\/$/, "") + bg.url;
    mutate((s) => {
      s.backgroundId = bg.id;
      s.backgroundUrl = url;
    });
  }
  function setText(
    which: "title" | "subtitle",
    patch: Partial<{ value: string; font: string; color: string }>,
  ) {
    mutate((s) => {
      Object.assign(s[which], patch);
    });
  }

  /* --------------------------- étape 2 ------------------------------------ */
  function addType(type: CharacterTypeDTO) {
    mutate((s) => {
      const position = s.characters.length;
      s.characters.push(defaultCharacterForType(type, position));
      s.editingIndex = s.characters.length - 1;
    });
  }
  function removeCharacter(index: number) {
    mutate((s) => {
      s.characters.splice(index, 1);
      s.characters.forEach((c, i) => (c.position = i));
      if (s.editingIndex === index) s.editingIndex = null;
    });
  }
  function selectCharacter(index: number | null) {
    mutate((s) => {
      s.editingIndex = index;
    });
  }
  function setAsset(index: number, slot: string, assetId: string | number) {
    mutate((s) => {
      const c = s.characters[index];
      if (!c) return;
      c.assets[slot] = assetId;
      // Ajoute les couleurs par défaut des nouvelles zones de cet asset.
      const t = typeById(c.typeId);
      const asset = t && findAsset(t, slot, assetId);
      for (const [zone, hex] of Object.entries(asset?.colorZones ?? {})) {
        if (c.colors[zone] === undefined) c.colors[zone] = hex;
      }
    });
  }
  function setColor(index: number, zone: string, hex: string) {
    mutate((s) => {
      const c = s.characters[index];
      if (c) c.colors[zone] = hex;
    });
  }
  function swap(a: number, b: number) {
    mutate((s) => {
      const ca = s.characters[a];
      const cb = s.characters[b];
      if (!ca || !cb) return;
      const tmp = ca.position;
      ca.position = cb.position;
      cb.position = tmp;
      s.characters[a] = cb;
      s.characters[b] = ca;
    });
  }
  function bringForward(index: number) {
    if (index < state.characters.length - 1) swap(index, index + 1);
  }
  function sendBackward(index: number) {
    if (index > 0) swap(index, index - 1);
  }

  /* --------------------------- étape 3 ------------------------------------ */
  function setFormat(format: PosterFormat) {
    mutate((s) => {
      s.format = format;
    });
  }

  const isLast = () => stepIndex() === STEPS.length - 1;
  const editingActive = () =>
    state.step === "characters" && state.editingIndex !== null;

  return (
    <div
      class="ml-cfg-root"
      style={{
        display: "grid",
        "grid-template-columns": "minmax(280px, 1fr) minmax(320px, 420px)",
        gap: "20px",
        "align-items": "start",
        "font-family": "system-ui, sans-serif",
        color: "#111827",
      }}
    >
      {/* Aperçu */}
      <div style={{ position: "sticky", top: "16px" }}>
        <PosterPreview
          state={state}
          typeById={typeById}
          cache={cache}
          interactive={state.step === "characters"}
          selectedIndex={state.editingIndex}
          onSelect={selectCharacter}
          onMove={(i, x, y) =>
            mutate((s) => {
              const c = s.characters[i];
              if (c) {
                c.x = x;
                c.y = y;
              }
            })
          }
          onScale={(i, scale) =>
            mutate((s) => {
              const c = s.characters[i];
              if (c) c.scale = scale;
            })
          }
        />
      </div>

      {/* Panneau de contrôle */}
      <div
        class="ml-cfg-panel"
        style={{
          border: "1px solid #e5e7eb",
          "border-radius": "10px",
          padding: "16px",
          background: "#fafafa",
        }}
      >
        {/* Fil d'étapes */}
        <div
          style={{
            display: "flex",
            gap: "6px",
            "margin-bottom": "14px",
            "font-size": "12px",
          }}
        >
          {STEPS.map((s, i) => (
            <span
              style={{
                padding: "4px 8px",
                "border-radius": "9999px",
                background: state.step === s ? "#4f46e5" : "#e5e7eb",
                color: state.step === s ? "#fff" : "#6b7280",
                "font-weight": "600",
              }}
            >
              {i + 1}. {STEP_LABELS[s]}
            </span>
          ))}
        </div>

        <Show when={state.step === "background"}>
          <StepBackgroundText
            state={state}
            backgrounds={props.backgrounds}
            assetBaseUrl={props.assetBaseUrl}
            onSelectBackground={selectBackground}
            onText={setText}
          />
        </Show>

        <Show when={state.step === "characters"}>
          <StepCharacters
            state={state}
            characterTypes={props.characterTypes}
            cache={cache}
            typeById={typeById}
            onAddType={addType}
            onRemove={removeCharacter}
            onSelect={selectCharacter}
            onBringForward={bringForward}
            onSendBackward={sendBackward}
            onSetAsset={setAsset}
            onSetColor={setColor}
          />
        </Show>

        <Show when={state.step === "format"}>
          <StepFormat state={state} onSelect={setFormat} />
        </Show>

        {/* Navigation globale (masquée quand on édite un perso : l'éditeur a ses
            propres boutons Retour / Valider §18.2 F). */}
        <Show when={!editingActive()}>
          <div
            style={{
              display: "flex",
              "justify-content": "space-between",
              "margin-top": "18px",
              "border-top": "1px solid #e5e7eb",
              "padding-top": "14px",
            }}
          >
            <Button variant="secondary" onClick={prev}>
              Retour
            </Button>
            <Button variant="primary" onClick={next}>
              {isLast() ? "Valider l'affiche" : "Continuer"}
            </Button>
          </div>
        </Show>
      </div>
    </div>
  );
}

export default Configurator;
export type { PosterConfig } from "@memoryline/types";
