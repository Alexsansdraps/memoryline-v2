/// <reference lib="dom" />
import {
  For,
  Show,
  createMemo,
  createSignal,
  createUniqueId,
  type JSX,
} from "solid-js";
import {
  BASE_COLOR_SCOPE,
  colorKey,
  colorsForScope,
  couleursDeLaPiece,
  scopeSvgStyles,
} from "@memoryline/types";
import {
  NONE_ASSET,
  findVariant,
  recolorForCharacter,
  withViewBox,
  paletteForVariant,
  type PieceCategoryDTO,
  SKIN_TONES,
  SLOT_THUMB_VIEWBOX,
  type CharacterDTO,
  type Slot,
  type SlotVariants,
  type SvgCache,
  type VariantDTO,
  type WorkingCharacter,
} from "../store";
import { CharacterStack } from "./CharacterLayer";
import {
  BarreActions,
  IndiceDefilement,
  createResteDessous,
} from "./Defilement";
import {
  ANNEAU_COULEUR_CHOISIE,
  Button,
  CocheCouleur,
  PastilleCouleur,
} from "./ui";
import type { MessagesConfigurateur } from "../messages";

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * SVG inline (string) prêt à être injecté : recolorié + cadré (viewBox zoomé)
 * + dimensionné pour remplir la vignette. Retourne undefined si pas encore
 * chargé.
 */
function thumbSvg(
  cache: SvgCache,
  svgUrl: string | undefined,
  colors: Record<string, string>,
  viewBox: string | undefined,
  scopeUid: string,
): string | undefined {
  if (!svgUrl) return undefined;
  const raw = cache.raw[svgUrl];
  if (raw === undefined || raw === "") return undefined;
  // Scope CSS : sans lui, le <style> global de la dernière vignette inlinée
  // écraserait les couleurs de toutes les autres (cf. scopeSvgStyles).
  let svg = scopeSvgStyles(recolorForCharacter(raw, colors), scopeUid);
  if (viewBox) svg = withViewBox(svg, viewBox);
  // dimensionne : width/height 100%, contain, centré.
  return svg.replace(/<svg\b([^>]*)>/, (_m, attrs: string) => {
    const a = (attrs as string)
      .replace(/\swidth\s*=\s*"[^"]*"/g, "")
      .replace(/\sheight\s*=\s*"[^"]*"/g, "")
      .replace(/\sstyle\s*=\s*"[^"]*"/g, "");
    return `<svg${a} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:100%">`;
  });
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
    <div
      style={{ position: "relative", display: "flex", "align-items": "center" }}
    >
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

/** Vignette cliquable (contenu) avec état sélectionné. */
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
        overflow: "hidden",
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

/** Contenu d'une vignette = SVG inline (fallback texte si pas chargé). */
function SvgThumb(props: { svg: string | undefined; label: string }) {
  return (
    <Show
      when={props.svg}
      fallback={
        <span style={{ "font-size": "10px", color: "#9ca3af" }}>
          {props.label}
        </span>
      }
    >
      {(s) => (
        <span
          // eslint-disable-next-line solid/no-innerhtml
          innerHTML={s()}
          style={{ width: "100%", height: "100%", display: "block" }}
        />
      )}
    </Show>
  );
}

/**
 * Rangée de couleurs : presets cliquables + saisie libre, par zone.
 *
 * Les pastilles sont celles de la couleur du texte (cf. PastilleCouleur) :
 * mêmes 40 px, même coche sur la couleur portée.
 */
function ColorRow(props: {
  zones: { zone: string; current: string }[];
  presets: readonly string[];
  /** Saisie hors nuancier autorisée ? Non dès qu'une catégorie a ses couleurs. */
  libre: boolean;
  onSetColor: (zone: string, hex: string) => void;
  /** Intitulé traduit, fourni par l'éditeur. */
  libelle: string;
}) {
  const memeCouleur = (a: string, b: string) =>
    a.toUpperCase() === b.toUpperCase();
  return (
    <div style={{ "margin-top": "8px" }}>
      <span
        style={{
          display: "block",
          "font-size": "11px",
          "font-weight": "700",
          color: "#6b7280",
          "letter-spacing": ".04em",
          "margin-bottom": "8px",
        }}
      >
        {props.libelle}
      </span>
      <For each={props.zones}>
        {(z) => {
          // Couleur saisie hors nuancier : c'est la pastille arc-en-ciel qui
          // porte la coche, sinon aucune couleur ne paraîtrait choisie.
          const horsNuancier = () =>
            !props.presets.some((hex) => memeCouleur(hex, z.current));
          return (
            <div
              style={{
                display: "flex",
                "align-items": "center",
                // 10 px : l'anneau de la couleur choisie déborde de 4 px, il
                // ne doit pas toucher la pastille voisine ni la rangée d'en
                // dessous.
                gap: "10px",
                "flex-wrap": "wrap",
                "margin-bottom": "10px",
              }}
            >
              <For each={props.presets}>
                {(hex) => (
                  <PastilleCouleur
                    couleur={hex}
                    libelle={hex}
                    actif={memeCouleur(z.current, hex)}
                    onClick={() => props.onSetColor(z.zone, hex)}
                  />
                )}
              </For>
              <Show when={props.libre}>
                {/* Le sélecteur du navigateur, invisible, recouvre toute la
                    pastille : un toucher n'importe où l'ouvre, et c'est lui
                    qui renvoie la couleur. Sa propre case, minuscule et
                    différente d'un navigateur à l'autre, ne se voit plus. */}
                <span
                  title="Couleur personnalisée"
                  style={{
                    position: "relative",
                    flex: "0 0 auto",
                    width: "40px",
                    height: "40px",
                    "border-radius": "9999px",
                    background:
                      "conic-gradient(#ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ef4444)",
                    "box-shadow": horsNuancier() ? ANNEAU_COULEUR_CHOISIE : "none",
                    display: "inline-flex",
                    "align-items": "center",
                    "justify-content": "center",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: "26px",
                      height: "26px",
                      "border-radius": "9999px",
                      border: "2px solid #ffffff",
                      "box-sizing": "border-box",
                      background: horsNuancier() ? z.current : "#ffffff",
                      color: "#374151",
                      "font-size": "18px",
                      "line-height": "1",
                      display: "inline-flex",
                      "align-items": "center",
                      "justify-content": "center",
                    }}
                  >
                    <Show when={horsNuancier()} fallback="+">
                      <CocheCouleur fond={z.current} />
                    </Show>
                  </span>
                  <input
                    type="color"
                    value={z.current}
                    onInput={(e) => props.onSetColor(z.zone, e.currentTarget.value)}
                    aria-label="Couleur personnalisée"
                    style={{
                      position: "absolute",
                      top: "0",
                      left: "0",
                      width: "100%",
                      height: "100%",
                      margin: "0",
                      padding: "0",
                      border: "none",
                      opacity: "0",
                      cursor: "pointer",
                    }}
                  />
                </span>
              </Show>
            </div>
          );
        }}
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
 * Gauche ~35% = prévisualisation isolée du perso composé. Droite = sections :
 * choix du personnage (galerie de bases) + nuancier peau, puis vêtements /
 * pantalon / cheveux / accessoires (galeries zoomées + nuanciers). En bas, une
 * barre collée : Retour à gauche, Valider à droite. Plus aucun placement libre.
 */
export function CharacterEditor(props: {
  character: WorkingCharacter;
  base: CharacterDTO | undefined;
  characters: CharacterDTO[];
  slots: SlotVariants;
  cache: SvgCache;
  /** Catégories de pièces et leurs nuanciers (vide = nuanciers de repli). */
  pieceCategories?: PieceCategoryDTO[];
  onSetAsset: (slot: Slot, variantId: string | number) => void;
  onClearSlot: (slot: Slot) => void;
  onSetColor: (zone: string, hex: string) => void;
  onChangeCharacter: (base: CharacterDTO) => void;
  onBack: () => void;
  onValidate: () => void;
  messages: MessagesConfigurateur;
}) {
  const m = () => props.messages;
  /** Intitulé de chaque emplacement, traduit. */
  const titreSlot = (): Record<Slot, string> => ({
    clothes: m().vetements,
    pants: m().pantalon,
    hair: m().coupes,
    accessory: m().accessoires,
  });

  // Scope CSS unique par instance d'éditeur (cf. scopeSvgStyles).
  const uid = createUniqueId();

  /* ---- Choix du personnage par catégorie -------------------------------- */
  const SANS_CAT = "Autres";

  /** Catégories présentes, dans l'ordre renvoyé par l'API (= ordre du BO). */
  const categories = createMemo<string[]>(() => {
    const vues: string[] = [];
    for (const c of props.characters) {
      const cat = c.category ?? SANS_CAT;
      if (!vues.includes(cat)) vues.push(cat);
    }
    return vues;
  });

  /** Catégorie du personnage actuellement sélectionné, sinon la première. */
  const categorieDuPerso = createMemo(() => {
    const actuel = props.characters.find(
      (c) => String(c.id) === String(props.character.characterId),
    );
    return actuel?.category ?? categories()[0] ?? SANS_CAT;
  });

  const [choisie, setChoisie] = createSignal<string | null>(null);
  /** La grille défile d'elle-même : l'indice dit quand elle cache des personnages. */
  let grillePersos: HTMLDivElement | undefined;
  const grilleResteDessous = createResteDessous(() => grillePersos);
  const categorieActive = () => choisie() ?? categorieDuPerso();
  const setCategorieActive = (cat: string) => setChoisie(cat);

  const personnagesDeLaCategorie = createMemo(() =>
    props.characters.filter(
      (c) => (c.category ?? SANS_CAT) === categorieActive(),
    ),
  );

  /**
   * Zones de couleur d'une variante (slot courant) + valeur actuelle.
   * `zone` = clé NAMESPACÉE "slot:stN" (cf. colorKey) : la couleur choisie ne
   * s'applique qu'à ce slot, pas aux autres couches qui réutilisent stN.
   * Repli sur la clé plate (anciens paniers) puis sur le défaut de la variante.
   *
   * Seules les zones PROPOSÉES au client : les petits détails décochés au
   * back-office (ruban du chapeau…) n'ont pas de rangée de pastilles, et
   * gardent leur couleur par défaut dans l'aperçu (cf. couleursDeLaPiece).
   */
  const zonesForSlot = (slot: Slot): { zone: string; current: string }[] => {
    const variant = findVariant(props.slots[slot], props.character.assets[slot]);
    if (!variant?.colorZones) return [];
    const masquees = variant.zonesMasquees ?? [];
    return Object.keys(variant.colorZones)
      .filter((zone) => !masquees.includes(zone))
      .map((zone) => ({
        zone: colorKey(slot, zone),
        current:
          props.character.colors[colorKey(slot, zone)] ??
          props.character.colors[zone] ??
          variant.colorZones?.[zone] ??
          "#000000",
      }));
  };

  /** Zones de peau de la base = ses baseColorZones. */
  const skinZones = createMemo<{ zone: string; current: string }[]>(() => {
    const base = props.base;
    if (!base?.baseColorZones) return [];
    // Heuristique : la 1ʳᵉ zone de la base = teinte de peau principale.
    const first = Object.keys(base.baseColorZones)[0];
    if (!first) return [];
    return [
      {
        zone: colorKey(BASE_COLOR_SCOPE, first),
        current:
          props.character.colors[colorKey(BASE_COLOR_SCOPE, first)] ??
          props.character.colors[first] ??
          base.baseColorZones[first] ??
          "#E0AC7E",
      },
    ];
  });

  /** Section galerie pour un slot (vêtements/pantalon/cheveux/accessoire). */
  function SlotSection(opts: { slot: Slot; allowNone: boolean }) {
    const list = (): VariantDTO[] => props.slots[opts.slot];
    const selectedId = () => props.character.assets[opts.slot];
    // « Aucun » n'est coché que sur demande EXPLICITE (NONE_ASSET) —
    // `undefined` = couche d'origine de la base conservée, rien de coché.
    const hasNone = () => selectedId() === NONE_ASSET;
    const viewBox = SLOT_THUMB_VIEWBOX[opts.slot];
    return (
      <Show when={list().length > 0}>
        <SectionTitle>{titreSlot()[opts.slot]}</SectionTitle>
        <Gallery>
          <Show when={opts.allowNone}>
            <Thumb
              selected={hasNone()}
              onClick={() => props.onClearSlot(opts.slot)}
              title={m().aucun}
            >
              <CrossedCircle />
            </Thumb>
          </Show>
          <For each={list()}>
            {(variant) => (
              <Thumb
                selected={String(selectedId()) === String(variant.id)}
                onClick={() => props.onSetAsset(opts.slot, variant.id)}
                title={variant.name ?? `#${variant.id}`}
              >
                <SvgThumb
                  svg={thumbSvg(
                    props.cache,
                    variant.svgUrl,
                    // Seules les couleurs de CE slot : les zones stN étant
                    // partagées entre couches, la map complète recolorerait
                    // aussi ces vignettes quand on change une autre couche.
                    // Les zones non proposées de CETTE pièce restent à leur
                    // défaut, comme sur le personnage.
                    couleursDeLaPiece(props.character.colors, opts.slot, variant),
                    viewBox,
                    `${uid}-${opts.slot}-${variant.id}`,
                  )}
                  label={variant.name ?? `#${variant.id}`}
                />
              </Thumb>
            )}
          </For>
        </Gallery>
        <Show when={zonesForSlot(opts.slot).length > 0}>
          {(() => {
            // Nuancier de LA pièce portée : celui de sa catégorie, sinon
            // celui de l'emplacement (et alors la saisie libre reste ouverte).
            const palette = paletteForVariant(
              props.pieceCategories,
              findVariant(props.slots[opts.slot], props.character.assets[opts.slot]),
              opts.slot,
            );
            return (
              <ColorRow
                libelle={m().choixCouleur}
                zones={zonesForSlot(opts.slot)}
                presets={palette.couleurs}
                libre={palette.libre}
                onSetColor={props.onSetColor}
              />
            );
          })()}
        </Show>
      </Show>
    );
  }

  return (
    <div class="ml-cfg-editor">
      {/* Titre seul : « Retour » a rejoint « Valider » dans la barre du bas.
          Collé en haut, il finissait sous l'aperçu du personnage, collé lui
          aussi, sur téléphone et tablette en portrait. */}
      <h3
        style={{
          "font-weight": "800",
          "letter-spacing": ".06em",
          "font-size": "15px",
          margin: "0 0 12px",
        }}
      >
        {m().personnalisation}
      </h3>

      {/* Deux colonnes — une seule sur mobile (cf. global.css) : à 375 px, la
          colonne des galeries ne faisait plus que ~200 px de large. */}
      <div
        class="ml-cfg-editeur"
        style={{
          display: "grid",
          "grid-template-columns": "minmax(120px, 35%) 1fr",
          gap: "16px",
          "align-items": "start",
        }}
      >
        {/* Colonne gauche : prévisualisation du perso composé */}
        <div class="ml-cfg-perso-col" style={{ position: "sticky", top: "0" }}>
          <div
            class="ml-cfg-perso-apercu"
            style={{
              position: "relative",
              width: "100%",
              // Même cadre que l'aperçu de l'affiche (SVG perso = viewBox 500×1000,
              // ratio 1:2) → prévisualisation 100% fidèle au rendu final.
              // La HAUTEUR est plafonnée en CSS : à ce ratio, le cadre occupait
              // deux fois la largeur de sa colonne et repoussait les galeries.
              "aspect-ratio": "1 / 2",
              background: "#f3f4f6",
              "border-radius": "10px",
              border: "1px solid #e5e7eb",
              overflow: "hidden",
            }}
          >
            <CharacterStack
              character={props.character}
              base={props.base}
              slots={props.slots}
              cache={props.cache}
            />
          </div>
        </div>

        {/* Colonne droite : sections */}
        <div style={{ "min-width": "0" }}>
          {/* Choix du personnage, PAR CATÉGORIE.
              Une galerie horizontale unique imposait de faire défiler les 62
              personnages pour atteindre le bon. On choisit d'abord la
              catégorie, puis le personnage dans une grille qui tient à
              l'écran. */}
          <SectionTitle>{m().choixPersonnage}</SectionTitle>

          <div class="ml-cfg-categories">
            <For each={categories()}>
              {(cat) => (
                <button
                  type="button"
                  onClick={() => setCategorieActive(cat)}
                  aria-pressed={categorieActive() === cat}
                  style={{
                    flex: "0 0 auto",
                    border:
                      categorieActive() === cat
                        ? "1px solid #4f46e5"
                        : "1px solid #d1d5db",
                    background: categorieActive() === cat ? "#4f46e5" : "#fff",
                    color: categorieActive() === cat ? "#fff" : "#374151",
                    "border-radius": "9999px",
                    padding: "5px 12px",
                    "font-size": "13px",
                    "font-weight": "600",
                    cursor: "pointer",
                  }}
                >
                  {cat}
                </button>
              )}
            </For>
          </div>

          {/* Enveloppe positionnée : l'indice se pose sur le bas de la
              grille, qui défile, sans défiler avec elle. */}
          <div style={{ position: "relative" }}>
            <div ref={grillePersos} class="ml-cfg-grille-persos">
              <For each={personnagesDeLaCategorie()}>
                {(base) => (
                  <Thumb
                    selected={String(props.character.characterId) === String(base.id)}
                    onClick={() => props.onChangeCharacter(base)}
                    title={base.name}
                  >
                    <SvgThumb
                      svg={thumbSvg(
                        props.cache,
                        base.baseSvgUrl,
                        String(props.character.characterId) === String(base.id)
                          ? colorsForScope(props.character.colors, BASE_COLOR_SCOPE)
                          : (base.baseColorZones ?? {}),
                        undefined,
                        `${uid}-charbase-${base.id}`,
                      )}
                      label={base.name}
                    />
                  </Thumb>
                )}
              </For>
            </div>
            <IndiceDefilement
              visible={grilleResteDessous()}
              style={{ bottom: "0" }}
            />
          </div>
          {/* Couleur de peau (zones de la base) */}
          <Show when={skinZones().length > 0}>
            <ColorRow
              libelle={m().choixCouleur}
              zones={skinZones()}
              presets={SKIN_TONES}
              libre={true}
              onSetColor={props.onSetColor}
            />
          </Show>

          <SlotSection slot="clothes" allowNone={false} />
          <SlotSection slot="pants" allowNone={false} />
          <SlotSection slot="hair" allowNone={true} />
          <SlotSection slot="accessory" allowNone={true} />
        </div>
      </div>

      {/* Retour à gauche, Valider à droite §18.2 F — côte à côte et toujours
          à portée, comme Retour / Continuer entre les étapes (retour
          cliente). Les deux ramènent à la liste : le personnage est modifié
          au fil des choix, il n'y a rien à annuler. */}
      <BarreActions>
        <Button variant="secondary" onClick={() => props.onBack()}>
          ‹ {m().retour}
        </Button>
        <Button variant="primary" onClick={() => props.onValidate()}>
          {m().validerPersonnage}
        </Button>
      </BarreActions>
    </div>
  );
}
