/// <reference lib="dom" />
import { For, createMemo, createUniqueId } from "solid-js";
import {
  appliquerCalage,
  calagePour,
  BASE_COLOR_SCOPE,
  colorsForScope,
  hideSlotGroups,
  scopeSvgStyles,
} from "@memoryline/types";
import {
  NONE_ASSET,
  SLOT_ZORDER,
  findVariant,
  recolorForCharacter,
  type CharacterDTO,
  type SlotVariants,
  type SvgCache,
  type WorkingCharacter,
} from "../store";

/**
 * Force `preserveAspectRatio="xMidYMax meet"` (centré + ancré EN BAS) et fait
 * remplir le conteneur (width/height 100%, display block) sur la balise <svg>
 * racine. Toutes les couches partagent le cadre 500×1000 : empilées alignées,
 * elles composent le personnage (cf. RENDU-SPEC.md).
 */
function fillSvg(rawSvg: string): string {
  if (!rawSvg) return rawSvg;
  let out = rawSvg.replace(/<svg\b([^>]*)>/, (_m, attrs: string) => {
    let a = attrs;
    // preserveAspectRatio = bas-centré
    a = /\spreserveAspectRatio\s*=/.test(a)
      ? a.replace(
          /(\spreserveAspectRatio\s*=\s*")[^"]*(")/,
          `$1xMidYMax meet$2`,
        )
      : `${a} preserveAspectRatio="xMidYMax meet"`;
    // width/height/style = 100% (le viewBox d'origine est conservé)
    a = a
      .replace(/\swidth\s*=\s*"[^"]*"/g, "")
      .replace(/\sheight\s*=\s*"[^"]*"/g, "")
      .replace(/\sstyle\s*=\s*"[^"]*"/g, "");
    a = `${a} width="100%" height="100%" style="display:block;position:absolute;inset:0"`;
    return `<svg${a}>`;
  });
  return out;
}

/**
 * Rend un personnage composé : la base pré-composée + chaque variante choisie
 * empilée par-dessus (bottoms -> clothes -> hair -> accessory), toutes au même
 * cadre 500×1000, recoloriées avec les couleurs du perso. Positionné en % par
 * le parent (indépendant de la résolution).
 */
export function CharacterStack(props: {
  character: WorkingCharacter;
  base: CharacterDTO | undefined;
  slots: SlotVariants | undefined;
  cache: SvgCache;
}) {
  // Scope CSS unique par instance : les <style> des SVG inlinés sont globaux
  // au document, sans scoping la dernière couche écrase les couleurs des
  // autres (cf. scopeSvgStyles).
  const uid = createUniqueId();

  /** SVG inline (string) de chaque couche, recolorié + ancré bas. */
  const layers = createMemo(() => {
    const out: { key: string; svg: string }[] = [];
    // Couleurs namespacées par couche (base:stN / clothes:stN…) : chaque
    // couche ne reçoit QUE les siennes, sinon les zones stN partagées entre
    // base et slots se recolorent mutuellement (cf. colorsForScope).
    const colors = props.character.colors;

    // Slots dont la couche de la base pré-composée doit être masquée : ceux
    // remplacés par une variante choisie (sinon la tenue d'origine reste
    // visible sous la variante — doublons) ET ceux explicitement mis à
    // « aucun » (NONE_ASSET : perso sans casquette / sans coupe).
    const replacedSlots = SLOT_ZORDER.filter(
      (slot) =>
        props.character.assets[slot] === NONE_ASSET ||
        findVariant(props.slots?.[slot] ?? [], props.character.assets[slot]) !==
          undefined,
    );

    // Couche de base (SVG pré-composé complet).
    const base = props.base;
    if (base) {
      const raw = props.cache.raw[base.baseSvgUrl];
      if (raw !== undefined && raw !== "") {
        out.push({
          key: "base",
          svg: fillSvg(
            scopeSvgStyles(
              hideSlotGroups(
                recolorForCharacter(raw, colorsForScope(colors, BASE_COLOR_SCOPE)),
                replacedSlots,
              ),
              `${uid}-base`,
            ),
          ),
        });
      }
    }

    // Couches de variantes choisies (par-dessus la base).
    const slots = props.slots;
    if (slots) {
      for (const slot of SLOT_ZORDER) {
        const variant = findVariant(slots[slot], props.character.assets[slot]);
        if (!variant) continue;
        const raw = props.cache.raw[variant.svgUrl];
        if (raw === undefined || raw === "") continue;
        out.push({
          key: `${slot}:${variant.id}`,
          svg: fillSvg(
            scopeSvgStyles(
              // Calage de la pièce sur ce personnage : même fonction que
              // pour l'impression, l'aperçu ne peut donc pas mentir.
              appliquerCalage(
                recolorForCharacter(raw, colorsForScope(colors, slot)),
                calagePour(props.base?.slotAdjust, slot, variant.position),
              ),
              `${uid}-${slot}-${variant.id}`,
            ),
          ),
        });
      }
    }
    return out;
  });

  return (
    <div class="ml-cfg-charstack">
      <For each={layers()}>
        {(layer) => (
          <div
            class="ml-cfg-charlayer"
            // eslint-disable-next-line solid/no-innerhtml
            innerHTML={layer.svg}
            style={{
              position: "absolute",
              inset: "0",
              width: "100%",
              height: "100%",
              "pointer-events": "none",
              "user-select": "none",
            }}
          />
        )}
      </For>
    </div>
  );
}
