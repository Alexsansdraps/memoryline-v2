/// <reference lib="dom" />
import { For, Show, createMemo, type JSX } from "solid-js";
import type { CharacterTypeDTO, AssetDTO } from "@memoryline/types";
import {
  SLOT_ZORDER,
  findAsset,
  recolorForCharacter,
  defaultCharacterForType,
  presetPaletteForSlot,
  SKIN_TONES,
  type SvgCache,
  type WorkingCharacter,
} from "../store";
import { CharacterStack } from "./CharacterLayer";

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** data-URI d'un SVG (recolorié si des couleurs sont fournies). */
function svgDataUri(
  cache: SvgCache,
  asset: AssetDTO | undefined,
  colors: Record<string, string>,
): string | undefined {
  if (!asset) return undefined;
  const raw = cache.raw[asset.svgUrl];
  if (raw === undefined || raw === "") return undefined;
  const recolored = recolorForCharacter(raw, colors);
  return "data:image/svg+xml;utf8," + encodeURIComponent(recolored);
}

/** Zone de "peau" éditable sur le visage (1ère zone de l'asset head). */
function skinZoneOf(
  type: CharacterTypeDTO | undefined,
  character: WorkingCharacter,
): string | undefined {
  if (!type) return undefined;
  const head = findAsset(type, "head", character.assets["head"]);
  if (!head?.colorZones) return undefined;
  const keys = Object.keys(head.colorZones);
  return keys[0];
}

/* -------------------------------------------------------------------------- */
/*  Petits composants UI                                                       */
/* -------------------------------------------------------------------------- */

/** Galerie horizontale scrollable avec flèches gauche/droite. */
function Gallery(props: { children: JSX.Element }) {
  let scroller: HTMLDivElement | undefined;
  const scroll = (dir: number) => {
    scroller?.scrollBy({ left: dir * 180, behavior: "smooth" });
  };
  return (
    <div style={{ position: "relative", display: "flex", "align-items": "center" }}>
      <button
        type="button"
        aria-label="Précédent"
        onClick={() => scroll(-1)}
        style={arrowStyle()}
      >
        ‹
      </button>
      <div
        ref={scroller}
        style={{
          display: "flex",
          gap: "8px",
          "overflow-x": "auto",
          "scroll-behavior": "smooth",
          padding: "4px 2px",
          flex: "1",
        }}
      >
        {props.children}
      </div>
      <button
        type="button"
        aria-label="Suivant"
        onClick={() => scroll(1)}
        style={arrowStyle()}
      >
        ›
      </button>
    </div>
  );
}

function arrowStyle(): JSX.CSSProperties {
  return {
    flex: "0 0 auto",
    width: "26px",
    height: "26px",
    "border-radius": "9999px",
    border: "1px solid #d1d5db",
    background: "#fff",
    cursor: "pointer",
    "font-size": "18px",
    "line-height": "1",
    color: "#374151",
    margin: "0 2px",
  };
}

/** Vignette cliquable (image ou contenu) avec état sélectionné. */
function Thumb(props: {
  selected: boolean;
  onClick: () => void;
  title?: string;
  children: JSX.Element;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={props.title}
      style={{
        position: "relative",
        flex: "0 0 auto",
        width: "72px",
        height: "88px",
        border: props.selected ? "2px solid #4f46e5" : "1px solid #d1d5db",
        "border-radius": "8px",
        background: "#fff",
        cursor: "pointer",
        padding: "4px",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        "box-shadow": props.selected ? "0 0 0 2px rgba(79,70,229,.2)" : "none",
      }}
    >
      {props.children}
      <Show when={props.selected}>
        <span
          style={{
            position: "absolute",
            top: "2px",
            right: "2px",
            width: "16px",
            height: "16px",
            "border-radius": "9999px",
            background: "#4f46e5",
            color: "#fff",
            "font-size": "11px",
            "line-height": "16px",
            "text-align": "center",
          }}
        >
          ✓
        </span>
      </Show>
    </button>
  );
}

/** Icône "aucun" (cercle barré). */
function CrossedCircle() {
  return (
    <svg viewBox="0 0 24 24" width="36" height="36" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="#9ca3af"
        stroke-width="2"
      />
      <line x1="6" y1="18" x2="18" y2="6" stroke="#9ca3af" stroke-width="2" />
    </svg>
  );
}

/**
 * Rangée de couleurs : presets cliquables + input type=color (choix libre).
 * Pour chaque zone de couleur de l'asset.
 */
function ColorRow(props: {
  zones: { zone: string; current: string }[];
  presets: readonly string[];
  onSetColor: (zone: string, hex: string) => void;
}) {
  return (
    <div style={{ "margin-top": "8px" }}>
      <span
        style={{
          display: "block",
          "font-size": "11px",
          "font-weight": "700",
          color: "#6b7280",
          "letter-spacing": ".04em",
          "margin-bottom": "6px",
        }}
      >
        CHOIX DE LA COULEUR
      </span>
      <For each={props.zones}>
        {(z) => (
          <div
            style={{
              display: "flex",
              "align-items": "center",
              gap: "6px",
              "flex-wrap": "wrap",
              "margin-bottom": "6px",
            }}
          >
            <For each={props.presets}>
              {(hex) => (
                <button
                  type="button"
                  title={hex}
                  onClick={() => props.onSetColor(z.zone, hex)}
                  style={{
                    width: "22px",
                    height: "22px",
                    "border-radius": "9999px",
                    background: hex,
                    border:
                      z.current.toUpperCase() === hex.toUpperCase()
                        ? "2px solid #4f46e5"
                        : "1px solid #d1d5db",
                    cursor: "pointer",
                  }}
                />
              )}
            </For>
            <input
              type="color"
              value={z.current}
              onInput={(e) => props.onSetColor(z.zone, e.currentTarget.value)}
              title="Couleur personnalisée"
              style={{
                width: "26px",
                height: "26px",
                border: "none",
                padding: "0",
                background: "transparent",
                cursor: "pointer",
              }}
            />
          </div>
        )}
      </For>
    </div>
  );
}

function SectionTitle(props: { children: JSX.Element }) {
  return (
    <h4
      style={{
        "font-size": "14px",
        "font-weight": "700",
        color: "#111827",
        margin: "16px 0 6px",
      }}
    >
      {props.children}
    </h4>
  );
}

/* -------------------------------------------------------------------------- */
/*  Éditeur principal                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Éditeur d'un personnage (maquette client §18.2 F) : deux colonnes.
 * Gauche = prévisualisation isolée du perso. Droite = sections (type, vêtements,
 * pantalon, cheveux, accessoires), chacune = galerie de vignettes + couleurs.
 * Plus aucun placement libre. Accessoire recolorable (§18.1 D).
 */
export function CharacterEditor(props: {
  character: WorkingCharacter;
  type: CharacterTypeDTO | undefined;
  characterTypes: CharacterTypeDTO[];
  cache: SvgCache;
  onSetAsset: (slot: string, assetId: string | number) => void;
  onClearSlot: (slot: string) => void;
  onSetColor: (zone: string, hex: string) => void;
  onChangeType: (type: CharacterTypeDTO) => void;
  onBack: () => void;
  onValidate: () => void;
}) {
  /** Zones de couleur d'un slot donné + valeur courante. */
  const zonesForSlot = (
    slot: string,
  ): { zone: string; current: string }[] => {
    const asset = props.type && findAsset(props.type, slot, props.character.assets[slot]);
    if (!asset?.colorZones) return [];
    return Object.keys(asset.colorZones).map((zone) => ({
      zone,
      current:
        props.character.colors[zone] ?? asset.colorZones?.[zone] ?? "#000000",
    }));
  };

  const skinZone = createMemo(() => skinZoneOf(props.type, props.character));
  const skinCurrent = () => {
    const z = skinZone();
    return (z && props.character.colors[z]) ?? "#E0AC7E";
  };

  /** Vignette d'un asset (recolorié avec les couleurs courantes). */
  const assetThumb = (asset: AssetDTO) => {
    const uri = svgDataUri(props.cache, asset, props.character.colors);
    return (
      <Show
        when={uri}
        fallback={
          <span style={{ "font-size": "10px", color: "#9ca3af" }}>
            {asset.name ?? `#${asset.id}`}
          </span>
        }
      >
        {(u) => (
          <img
            src={u()}
            alt={asset.name ?? ""}
            draggable={false}
            style={{
              "max-width": "100%",
              "max-height": "100%",
              "object-fit": "contain",
            }}
          />
        )}
      </Show>
    );
  };

  /** Vignette représentative d'un type (CharacterStack d'un perso par défaut). */
  const typeThumb = (t: CharacterTypeDTO) => {
    const sample = defaultCharacterForType(t, 0);
    return (
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          "aspect-ratio": "1 / 1.6",
        }}
      >
        <CharacterStack character={sample} type={t} cache={props.cache} />
      </div>
    );
  };

  /** Section galerie générique pour un slot (vêtements/pantalon/cheveux/accessoire). */
  function SlotSection(opts: {
    slot: string;
    title: string;
    allowNone: boolean;
  }) {
    const list = (): AssetDTO[] => props.type?.assetsBySlot[opts.slot] ?? [];
    const selectedId = () => props.character.assets[opts.slot];
    const hasNone = () => selectedId() === undefined;
    return (
      <Show when={list().length > 0}>
        <SectionTitle>{opts.title}</SectionTitle>
        <Gallery>
          <Show when={opts.allowNone}>
            <Thumb
              selected={hasNone()}
              onClick={() => props.onClearSlot(opts.slot)}
              title="Aucun"
            >
              <CrossedCircle />
            </Thumb>
          </Show>
          <For each={list()}>
            {(asset) => (
              <Thumb
                selected={String(selectedId()) === String(asset.id)}
                onClick={() => props.onSetAsset(opts.slot, asset.id)}
                title={asset.name ?? `#${asset.id}`}
              >
                {assetThumb(asset)}
              </Thumb>
            )}
          </For>
        </Gallery>
        <Show when={zonesForSlot(opts.slot).length > 0}>
          <ColorRow
            zones={zonesForSlot(opts.slot)}
            presets={presetPaletteForSlot(opts.slot)}
            onSetColor={props.onSetColor}
          />
        </Show>
      </Show>
    );
  }

  return (
    <div class="ml-cfg-editor">
      {/* Barre Retour + titre */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "10px",
          "margin-bottom": "12px",
        }}
      >
        <button
          type="button"
          onClick={() => props.onBack()}
          style={{
            display: "inline-flex",
            "align-items": "center",
            gap: "4px",
            border: "1px solid #d1d5db",
            "border-radius": "9999px",
            background: "#fff",
            padding: "6px 12px",
            cursor: "pointer",
            "font-size": "13px",
            color: "#374151",
          }}
        >
          ‹ Retour
        </button>
        <h3
          style={{
            "font-weight": "800",
            "letter-spacing": ".06em",
            "font-size": "15px",
            margin: "0",
          }}
        >
          PERSONNALISATION
        </h3>
      </div>

      {/* Deux colonnes */}
      <div
        style={{
          display: "grid",
          "grid-template-columns": "minmax(140px, 38%) 1fr",
          gap: "16px",
          "align-items": "start",
        }}
      >
        {/* Colonne gauche : prévisualisation isolée */}
        <div>
          <span
            style={{
              display: "block",
              "font-size": "11px",
              "font-weight": "700",
              color: "#6b7280",
              "letter-spacing": ".04em",
              "margin-bottom": "6px",
            }}
          >
            PRÉVISUALISATION
          </span>
          <div
            style={{
              position: "relative",
              width: "100%",
              "aspect-ratio": "1 / 1.5",
              background: "#f3f4f6",
              "border-radius": "10px",
              border: "1px solid #e5e7eb",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: "8% 18%",
              }}
            >
              <CharacterStack
                character={props.character}
                type={props.type}
                cache={props.cache}
              />
            </div>
          </div>
        </div>

        {/* Colonne droite : sections */}
        <div style={{ "min-width": "0" }}>
          {/* Choix du personnage (type) */}
          <SectionTitle>Choix du personnage</SectionTitle>
          <Gallery>
            <For each={props.characterTypes}>
              {(t) => (
                <Thumb
                  selected={String(props.character.typeId) === String(t.id)}
                  onClick={() => props.onChangeType(t)}
                  title={t.name}
                >
                  {typeThumb(t)}
                </Thumb>
              )}
            </For>
          </Gallery>
          {/* Couleur de peau */}
          <Show when={skinZone()}>
            {(z) => (
              <ColorRow
                zones={[{ zone: z(), current: skinCurrent() }]}
                presets={SKIN_TONES}
                onSetColor={props.onSetColor}
              />
            )}
          </Show>

          <SlotSection slot="clothes" title="Vêtements" allowNone={false} />
          <SlotSection slot="pants" title="Pantalon" allowNone={false} />
          <SlotSection slot="hair" title="Coupes de cheveux" allowNone={true} />
          <SlotSection slot="accessory" title="Accessoires" allowNone={true} />
        </div>
      </div>

      {/* Valider §18.2 F */}
      <div
        style={{
          display: "flex",
          "justify-content": "flex-end",
          "margin-top": "18px",
          "border-top": "1px solid #e5e7eb",
          "padding-top": "14px",
        }}
      >
        <button
          type="button"
          onClick={() => props.onValidate()}
          style={{
            background: "#4f46e5",
            color: "#fff",
            border: "1px solid transparent",
            "border-radius": "6px",
            padding: "10px 18px",
            "font-size": "14px",
            "font-weight": "600",
            cursor: "pointer",
          }}
        >
          Valider mon personnage
        </button>
      </div>
    </div>
  );
}
