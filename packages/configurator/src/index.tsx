/// <reference lib="dom" />
import { createEffect, createMemo, Show, type JSX } from "solid-js";
import type {
  PosterConfig,
  PosterFormat,
  BackgroundDTO,
} from "@memoryline/types";
import { BASE_COLOR_SCOPE, colorKey } from "@memoryline/types";
import {
  STEPS,
  SLOTS,
  type Step,
  type Slot,
  type ConfiguratorState,
  type CharacterDTO,
  type SlotsDTO,
  type SlotVariants,
  emptyState,
  stateFromConfig,
  configFromState,
  createConfiguratorStore,
  createSvgCache,
  defaultCharacter,
  findVariant,
  slotsForCharacter,
  NONE_ASSET,
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
  /** Personnages (bases pré-composées) non archivés, ordonnés category+position. */
  characters: CharacterDTO[];
  /** Variantes génériques de slots, par vue (front / back). */
  slots: SlotsDTO;
  /** Prix par format en centimes (ex. { A4: 2300, A3: 2900 }). Le format
   *  sélectionné met à jour le prix affiché (demande cliente). */
  prices?: Partial<Record<PosterFormat, number>>;
  /** Décor d'avant-plan optionnel du produit (muret/banc…), rendu par-dessus
   *  les personnages (effet « assis dessus »). URL /assets/… ou absolue. */
  foregroundUrl?: string | null;
  /** Réglages par défaut du produit (pré-remplissage à l'ouverture). */
  defaults?: {
    title?: string | null;
    subtitle?: string | null;
    view?: string | null;
  };
  /** Réouverture (panier "edit" §18.3) : restaure tout l'état. */
  initialConfig?: PosterConfig;
  /** Préfixe pour fetch le texte SVG, ex "http://localhost:3100". */
  assetBaseUrl: string;
  onSubmit: (config: PosterConfig) => void;
  onBack?: () => void;
}

/** Formate un prix en centimes -> "23 €" (FR). */
function fmtPrice(cents: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
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

  // Pré-remplissage depuis les réglages par défaut du produit (titre/sous-titre/
  // position) — seulement en mode AJOUT (pas en réouverture panier).
  if (!props.initialConfig && props.defaults) {
    if (props.defaults.title) initialState.title.value = props.defaults.title;
    if (props.defaults.subtitle)
      initialState.subtitle.value = props.defaults.subtitle;
    if (props.defaults.view === "front" || props.defaults.view === "back")
      initialState.view = props.defaults.view;
  }

  // À l'ouverture, l'affiche est VIDE de personnages (retour cliente) : le
  // client part du fond seul et ajoute ce qu'il veut. Un mix aléatoire était
  // pré-ajouté auparavant « pour que l'affiche ne soit jamais vide » — il
  // imposait des personnages que le client devait d'abord retirer.

  const { state, mutate } = createConfiguratorStore(initialState);
  const { cache, fetchSvg } = createSvgCache(props.assetBaseUrl);

  const characterById = (
    id: string | number,
  ): CharacterDTO | undefined =>
    props.characters.find((c) => String(c.id) === String(id));

  /**
   * Personnages proposés à l'ajout, filtrés par l'orientation de l'AFFICHE :
   * une affiche de dos ne propose que les persos de dos (et inversement). Évite
   * qu'un perso de face apparaisse sur une affiche de dos. Si aucun perso ne
   * correspond à la vue (donnée incomplète), on retombe sur la liste complète.
   */
  const visibleCharacters = createMemo<CharacterDTO[]>(() => {
    const view = state.view;
    const matching = props.characters.filter(
      (c) => (c.orientation ?? "front") === view,
    );
    return matching.length > 0 ? matching : props.characters;
  });

  /**
   * Variantes de slot pour le personnage en cours d'édition : on suit SON
   * orientation native (dos/face), sinon la vue globale, puis on restreint
   * aux variantes AUTORISÉES pour ce perso (slotVariants — un homme ne se
   * voit pas proposer les habits de bébé). Garantit que l'éditeur montre les
   * bonnes pièces et la même chose que l'aperçu de l'affiche.
   */
  const slotVariants = (): SlotVariants => {
    const idx = state.editingIndex;
    const c = idx != null ? state.characters[idx] : undefined;
    const base = c ? characterById(c.characterId) : undefined;
    const all = props.slots[base?.orientation ?? state.view];
    return slotsForCharacter(all, base);
  };

  // Présélection du fond du produit : à l'ouverture, l'aperçu montre déjà
  // l'affiche de la fiche (1er fond renvoyé = fond de la ville du produit).
  createEffect(() => {
    if (state.backgroundUrl === undefined && props.backgrounds.length > 0) {
      selectBackground(props.backgrounds[0]!);
    }
  });

  // Prefetch des SVG nécessaires :
  //  - bases + variantes choisies des personnages présents (aperçu),
  //  - toutes les bases + toutes les variantes du slot quand on édite (galeries).
  createEffect(() => {
    const variants = slotVariants();
    // Personnages présents (base + variantes choisies) : chacun résout ses
    // variantes dans le jeu COMPLET de sa vue (comme PosterPreview), pas dans
    // le jeu filtré du perso en cours d'édition.
    for (const c of state.characters) {
      const base = characterById(c.characterId);
      if (base) void fetchSvg(base.baseSvgUrl);
      const all = props.slots[base?.orientation ?? state.view];
      for (const slot of SLOTS) {
        const v = findVariant(all[slot], c.assets[slot]);
        if (v) void fetchSvg(v.svgUrl);
      }
    }
    // En édition : toutes les bases (galerie de personnages) + toutes les
    // variantes du slot courant (galeries vêtements/pantalon/cheveux/accessoires).
    if (state.editingIndex !== null) {
      for (const base of props.characters) void fetchSvg(base.baseSvgUrl);
      for (const slot of SLOTS) {
        for (const v of variants[slot]) void fetchSvg(v.svgUrl);
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
  /** Met à jour SEULEMENT le texte d'un bloc (titre ou sous-titre). */
  function setTextValue(which: "title" | "subtitle", value: string) {
    mutate((s) => {
      s[which].value = value;
    });
  }
  /** Change la police d'UN bloc (titre ou sous-titre), indépendamment. */
  function setTextFont(which: "title" | "subtitle", font: string) {
    mutate((s) => {
      s[which].font = font;
    });
  }

  /** Met à jour le STYLE PARTAGÉ (couleur/taille) titre + sous-titre. */
  function setTextStyle(
    patch: Partial<{ font: string; color: string; size: number }>,
  ) {
    mutate((s) => {
      Object.assign(s.textStyle, patch);
    });
  }

  /* --------------------------- étape 2 ------------------------------------ */
  function addCharacter() {
    // Le perso ajouté par défaut respecte l'orientation de l'affiche.
    const base = visibleCharacters()[0] ?? props.characters[0];
    if (!base) return;
    mutate((s) => {
      const position = s.characters.length;
      s.characters.push(defaultCharacter(base, position));
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
  function setAsset(index: number, slot: Slot, variantId: string | number) {
    mutate((s) => {
      const c = s.characters[index];
      if (!c) return;
      c.assets[slot] = variantId;
      // Ajoute les couleurs par défaut des nouvelles zones de cette variante,
      // namespacées par slot (une couleur déjà choisie pour ce slot persiste).
      const v = findVariant(slotVariants()[slot], variantId);
      for (const [zone, hex] of Object.entries(v?.colorZones ?? {})) {
        const key = colorKey(slot, zone);
        if (c.colors[key] === undefined) c.colors[key] = hex;
      }
    });
  }
  /**
   * Vignette « Aucun » : masque la couche du slot, Y COMPRIS celle qui est
   * pré-composée dans le SVG de base (casquette/coupe d'origine). Re-cliquer
   * « Aucun » quand il est déjà actif rétablit la couche d'origine de la base.
   */
  function clearSlot(index: number, slot: Slot) {
    mutate((s) => {
      const c = s.characters[index];
      if (!c) return;
      if (c.assets[slot] === NONE_ASSET) delete c.assets[slot];
      else c.assets[slot] = NONE_ASSET;
    });
  }
  function setColor(index: number, zone: string, hex: string) {
    mutate((s) => {
      const c = s.characters[index];
      if (c) c.colors[zone] = hex;
    });
  }
  /** Change la base (type) d'un personnage : conserve les variantes choisies
   *  encore AUTORISÉES pour la nouvelle base (les autres sont abandonnées —
   *  la tenue intégrée de la base reprend le relais), réinitialise les
   *  couleurs sur celles de la nouvelle base. */
  function changeCharacter(index: number, base: CharacterDTO) {
    mutate((s) => {
      const c = s.characters[index];
      if (!c) return;
      c.characterId = base.id;
      const variants = slotsForCharacter(
        props.slots[base.orientation ?? state.view],
        base,
      );
      // Couleurs : base + couleurs des variantes encore sélectionnées, chacune
      // sous sa clé namespacée (base:stN / slot:stN) — les zones stN partagées
      // entre couches ne se mélangent plus.
      const colors: Record<string, string> = {};
      for (const [zone, hex] of Object.entries(base.baseColorZones ?? {})) {
        colors[colorKey(BASE_COLOR_SCOPE, zone)] = hex;
      }
      for (const slot of SLOTS) {
        const v = findVariant(variants[slot], c.assets[slot]);
        if (!v) {
          delete c.assets[slot];
          continue;
        }
        for (const [zone, hex] of Object.entries(v.colorZones ?? {})) {
          colors[colorKey(slot, zone)] = hex;
        }
      }
      c.colors = colors;
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

  /** Prix courant selon le format sélectionné (repli sur le prix de base). */
  const currentPrice = (): number => {
    const p = props.prices?.[state.format];
    return typeof p === "number" ? p : props.product.basePriceCents;
  };

  const isLast = () => stepIndex() === STEPS.length - 1;
  const editingActive = () =>
    state.step === "characters" && state.editingIndex !== null;

  return (
    <div
      class="ml-cfg-root"
      style={{
        display: "grid",
        // Pendant l'édition d'un personnage, l'aperçu de l'affiche disparaît
        // et l'éditeur prend toute la largeur (cf. plus bas).
        "grid-template-columns": editingActive()
          ? "minmax(0, 1fr)"
          : "minmax(280px, 1fr) minmax(320px, 420px)",
        gap: "20px",
        "align-items": "start",
        "font-family": "system-ui, sans-serif",
        color: "#111827",
      }}
    >
      {/* Aperçu de l'affiche — MASQUÉ pendant la composition d'un personnage :
          l'éditeur affiche déjà le personnage seul, en grand, et montrer
          l'affiche entière par-dessus surchargeait l'écran (retour cliente).
          On la retrouve dès qu'on valide ou qu'on revient à la liste. */}
      <Show when={!editingActive()}>
      <div style={{ position: "sticky", top: "16px" }}>
        <PosterPreview
          state={state}
          characterById={characterById}
          slots={props.slots}
          cache={cache}
          foregroundUrl={
            props.foregroundUrl
              ? props.foregroundUrl.startsWith("http")
                ? props.foregroundUrl
                : props.assetBaseUrl.replace(/\/$/, "") + props.foregroundUrl
              : undefined
          }
          defaultForeground={
            props.assetBaseUrl.replace(/\/$/, "") + "/assets/muret_officiel.svg"
          }
        />
      </div>
      </Show>

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
          {/* Chaque étape est cliquable à tout moment (retour cliente) : on
              n'est pas tenu d'enchaîner Continuer / Retour pour revenir au
              fond depuis le format. goToStep ferme l'éditeur de personnage
              s'il était ouvert. */}
          {STEPS.map((s, i) => (
            <button
              type="button"
              onClick={() => goToStep(s)}
              aria-current={state.step === s ? "step" : undefined}
              style={{
                padding: "4px 8px",
                border: "none",
                "border-radius": "9999px",
                background: state.step === s ? "#4f46e5" : "#e5e7eb",
                color: state.step === s ? "#fff" : "#6b7280",
                "font-weight": "600",
                "font-size": "inherit",
                "font-family": "inherit",
                cursor: state.step === s ? "default" : "pointer",
              }}
            >
              {i + 1}. {STEP_LABELS[s]}
            </button>
          ))}
        </div>

        <Show when={state.step === "background"}>
          <StepBackgroundText
            state={state}
            backgrounds={props.backgrounds}
            assetBaseUrl={props.assetBaseUrl}
            onSelectBackground={selectBackground}
            onTextValue={setTextValue}
            onTextStyle={setTextStyle}
            onTextFont={setTextFont}
          />
        </Show>

        <Show when={state.step === "characters"}>
          <StepCharacters
            state={state}
            characters={visibleCharacters()}
            slots={slotVariants()}
            cache={cache}
            characterById={characterById}
            onAdd={addCharacter}
            onRemove={removeCharacter}
            onSelect={selectCharacter}
            onBringForward={bringForward}
            onSendBackward={sendBackward}
            onSetAsset={setAsset}
            onClearSlot={clearSlot}
            onSetColor={setColor}
            onChangeCharacter={changeCharacter}
          />
        </Show>

        <Show when={state.step === "format"}>
          <StepFormat
            state={state}
            prices={props.prices}
            onSelect={setFormat}
          />
        </Show>

        {/* Navigation globale (masquée quand on édite un perso : l'éditeur a ses
            propres boutons Retour / Valider §18.2 F). */}
        <Show when={!editingActive()}>
          <div
            style={{
              display: "flex",
              "justify-content": "space-between",
              "align-items": "center",
              "margin-top": "18px",
              "border-top": "1px solid #e5e7eb",
              "padding-top": "14px",
              gap: "12px",
            }}
          >
            <Button variant="secondary" onClick={prev}>
              Retour
            </Button>
            {/* Prix mis à jour selon le format choisi (demande cliente). */}
            <div style={{ "font-weight": "700", "font-size": "18px", "white-space": "nowrap" }}>
              {fmtPrice(currentPrice())}
              <Show when={state.format === "A3"}>
                <span style={{ "font-size": "12px", color: "#6b7280", "font-weight": "500" }}>
                  {" "}(A3)
                </span>
              </Show>
            </div>
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
export type {
  CharacterDTO,
  VariantDTO,
  SlotsDTO,
  SlotVariants,
} from "./store";
