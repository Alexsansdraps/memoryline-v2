/// <reference lib="dom" />
import { For, createMemo, createUniqueId } from "solid-js";
import {
  appliquerCalage,
  calagePour,
  BASE_COLOR_SCOPE,
  colorsForScope,
  empilerPersonnage,
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
 * Fait remplir le conteneur (width/height 100%, display block) à la balise
 * <svg> racine. Toutes les couches d'un humain partagent le cadre 500×1000 :
 * empilées alignées, elles composent le personnage (cf. RENDU-SPEC.md).
 *
 * L'ALIGNEMENT EST CELUI DU FICHIER, et c'est une correction. Cette fonction
 * forçait `xMidYMax` — le dessin collé au BAS de son cadre. Pour un dessin au
 * format du cadre (1:2), l'ancrage ne change rien : il remplit tout. Mais cinq
 * personnages ne le sont pas — les chiens, dessinés en 2:3 — et eux se
 * posaient 12,5 % plus bas que partout ailleurs :
 *
 *   - l'écran de calage du back-office les centre dans leur cadre ;
 *   - le fichier d'impression aussi, parce que le SVG le demande lui-même
 *     (`xMidYMid meet`) et que sharp le respecte ;
 *   - seule la boutique les collait en bas.
 *
 * Résultat : un chien calé au pixel près au back-office descendait sur la
 * boutique, et la cliente le voyait plus bas que là où il serait IMPRIMÉ —
 * près de deux centimètres sur une affiche A3. En respectant l'alignement du
 * fichier, les trois rendus disent enfin la même chose.
 *
 * Les chiens n'ont aucune couche de vêtement à aligner (variantes vides) : ce
 * que l'ancrage forcé protégeait n'existe pas pour eux.
 */
function fillSvg(rawSvg: string): string {
  if (!rawSvg) return rawSvg;
  let out = rawSvg.replace(/<svg\b([^>]*)>/, (_m, attrs: string) => {
    let a = attrs;
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
 * Rend un personnage composé : sa base et les pièces choisies, toutes au même
 * cadre 500×1000, recoloriées avec les couleurs du perso, dans l'ordre corps →
 * pantalon → haut → cheveux → accessoires. La base est découpée en tranches
 * intercalées entre les pièces (cf. empilerPersonnage) : un t-shirt choisi
 * passe SOUS les cheveux d'origine. Positionné en % par le parent.
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

    const slots = props.slots;
    const choisie = (slot: (typeof SLOT_ZORDER)[number]) =>
      findVariant(slots?.[slot] ?? [], props.character.assets[slot]);
    // Les emplacements qui portent une pièce choisie, et ceux mis à « aucun »
    // (sans casquette, sans coupe) : leur groupe d'origine disparaît de la
    // base, et seules les premières prennent sa place.
    const pieces = SLOT_ZORDER.filter((slot) => choisie(slot) !== undefined);
    const retires = SLOT_ZORDER.filter(
      (slot) => props.character.assets[slot] === NONE_ASSET,
    );

    const base = props.base;
    const brute = base ? props.cache.raw[base.baseSvgUrl] : undefined;
    // Base pas encore chargée (ou illisible) : les pièces seules, dans l'ordre.
    const etages = brute
      ? empilerPersonnage(brute, pieces, retires)
      : pieces.map((piece) => ({ piece }));

    etages.forEach((etage, i) => {
      if ("base" in etage) {
        out.push({
          key: `base:${i}`,
          svg: fillSvg(
            scopeSvgStyles(
              recolorForCharacter(
                etage.base,
                colorsForScope(colors, BASE_COLOR_SCOPE),
              ),
              // Une portée par tranche : chacune porte son propre <style>.
              `${uid}-base-${i}`,
            ),
          ),
        });
        return;
      }
      const slot = etage.piece as (typeof SLOT_ZORDER)[number];
      const variant = choisie(slot);
      if (!variant) return;
      const raw = props.cache.raw[variant.svgUrl];
      if (raw === undefined || raw === "") return;
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
    });
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
