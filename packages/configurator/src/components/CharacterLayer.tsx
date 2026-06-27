/// <reference lib="dom" />
import { For, createMemo, type Accessor } from "solid-js";
import type { CharacterTypeDTO } from "@memoryline/types";
import {
  SLOT_ZORDER,
  findAsset,
  recolorForCharacter,
  type SvgCache,
  type WorkingCharacter,
} from "../store";

/**
 * Rend un personnage : pile d'assets recoloriés (data-URI SVG), bas -> haut.
 * Indépendant de la résolution : positionné en % par le parent.
 */
export function CharacterStack(props: {
  character: WorkingCharacter;
  type: CharacterTypeDTO | undefined;
  cache: SvgCache;
}) {
  const layers = createMemo(() => {
    const t = props.type;
    if (!t) return [] as { slot: string; href: string }[];
    const out: { slot: string; href: string }[] = [];
    for (const slot of SLOT_ZORDER) {
      const asset = findAsset(t, slot, props.character.assets[slot]);
      if (!asset) continue;
      const raw = props.cache.raw[asset.svgUrl];
      if (raw === undefined || raw === "") continue;
      const recolored = recolorForCharacter(raw, props.character.colors);
      const href = "data:image/svg+xml;utf8," + encodeURIComponent(recolored);
      out.push({ slot, href });
    }
    return out;
  });

  return (
    <div class="ml-cfg-charstack">
      <For each={layers()}>
        {(layer) => (
          <img
            class="ml-cfg-charlayer"
            src={layer.href}
            alt=""
            draggable={false}
            style={{
              position: "absolute",
              inset: "0",
              width: "100%",
              height: "100%",
              "object-fit": "contain",
              "pointer-events": "none",
              "user-select": "none",
            }}
          />
        )}
      </For>
    </div>
  );
}

/**
 * Personnage interactif sur le poster : drag (x/y) + poignée resize (scale).
 * Coordonnées normalisées 0..1 relatives à la zone du poster.
 */
export function DraggableCharacter(props: {
  character: WorkingCharacter;
  index: number;
  type: CharacterTypeDTO | undefined;
  cache: SvgCache;
  selected: boolean;
  /** taille de base du perso en fraction de la largeur du poster (à scale=1). */
  baseSize: number;
  posterEl: Accessor<HTMLDivElement | undefined>;
  onSelect: (index: number) => void;
  onMove: (index: number, x: number, y: number) => void;
  onScale: (index: number, scale: number) => void;
}) {
  const sizePct = () => props.baseSize * 100 * props.character.scale;

  function clientToNorm(clientX: number, clientY: number) {
    const el = props.posterEl();
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  }

  function startDrag(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    props.onSelect(props.index);
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const n = clientToNorm(ev.clientX, ev.clientY);
      if (n) props.onMove(props.index, n.x, n.y);
    };
    const up = (ev: PointerEvent) => {
      target.releasePointerCapture?.(ev.pointerId);
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  }

  function startResize(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    props.onSelect(props.index);
    const el = props.posterEl();
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const cx = rect.left + props.character.x * rect.width;
    const cy = rect.top + props.character.y * rect.height;
    const baseHalf = (props.baseSize * rect.width) / 2;
    const move = (ev: PointerEvent) => {
      const dist = Math.hypot(ev.clientX - cx, ev.clientY - cy);
      const scale = Math.min(4, Math.max(0.2, dist / baseHalf));
      props.onScale(props.index, Number(scale.toFixed(3)));
    };
    const up = (ev: PointerEvent) => {
      target.releasePointerCapture?.(ev.pointerId);
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  }

  return (
    <div
      class="ml-cfg-draggable"
      onPointerDown={startDrag}
      style={{
        position: "absolute",
        left: `${props.character.x * 100}%`,
        top: `${props.character.y * 100}%`,
        width: `${sizePct()}%`,
        transform: "translate(-50%, -50%)",
        "aspect-ratio": "1 / 1.6",
        "z-index": String(props.character.position + 1),
        cursor: "grab",
        outline: props.selected ? "2px dashed #6366f1" : "none",
        "outline-offset": "2px",
        "touch-action": "none",
      }}
    >
      <CharacterStack
        character={props.character}
        type={props.type}
        cache={props.cache}
      />
      {props.selected && (
        <div
          class="ml-cfg-resize"
          onPointerDown={startResize}
          title="Redimensionner"
          style={{
            position: "absolute",
            right: "-10px",
            bottom: "-10px",
            width: "20px",
            height: "20px",
            "border-radius": "9999px",
            background: "#6366f1",
            border: "2px solid white",
            cursor: "nwse-resize",
            "touch-action": "none",
            "box-shadow": "0 1px 3px rgba(0,0,0,.4)",
          }}
        />
      )}
    </div>
  );
}
