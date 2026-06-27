/// <reference lib="dom" />
import { For, createMemo } from "solid-js";
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
