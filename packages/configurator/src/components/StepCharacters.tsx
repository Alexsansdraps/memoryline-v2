/// <reference lib="dom" />
import { createSignal, For, Show } from "solid-js";
import type { BASE_COLOR_SCOPE } from "@memoryline/types";
import { Button } from "./ui";
import { createCaleDuBord } from "./Defilement";
import { CharacterEditor } from "./CharacterEditor";
import type { MessagesConfigurateur } from "../messages";
import type {
  CharacterDTO,
  ConfiguratorState,
  NuanciersPersonnages,
  PieceCategoryDTO,
  Slot,
  SlotVariants,
  SvgCache,
} from "../store";

/**
 * Étape 2 : gestion des personnages.
 * - liste des personnages ajoutés (Modifier / supprimer / réordonner),
 *   bouton « + Ajouter un personnage ».
 * - clic Modifier / Nouveau -> éditeur de personnage (CharacterEditor).
 */
export function StepCharacters(props: {
  state: ConfiguratorState;
  characters: CharacterDTO[];
  slots: SlotVariants;
  pieceCategories?: PieceCategoryDTO[];
  /** Les nuanciers des personnages réglés par la boutique (sinon ceux d'origine). */
  nuanciersBase?: NuanciersPersonnages;
  cache: SvgCache;
  /** Racine de l'API : elle sert les images recolorées des dessins en pixels. */
  assetBaseUrl?: string;
  characterById: (id: string | number) => CharacterDTO | undefined;
  onAdd: () => void;
  onDuplicate: (index: number) => void;
  onRemove: (index: number) => void;
  onSelect: (index: number | null) => void;
  /**
   * Ferme l'éditeur : `garder` faux pour « ‹ Retour », vrai pour « Valider ».
   * Retour sur un personnage tout juste ajouté annule son ajout.
   */
  onQuitterEditeur: (garder: boolean) => void;
  /** Déplace un personnage d'un rang à un autre dans la liste. */
  onReorder: (depuis: number, vers: number) => void;
  onSetAsset: (index: number, slot: Slot, variantId: string | number) => void;
  onClearSlot: (index: number, slot: Slot) => void;
  /** Couleurs choisies : clé namespacée -> couleur (un groupe entier d'un coup). */
  onSetColors: (index: number, couleurs: Record<string, string>) => void;
  /** Remet les couleurs du dessin sur une couche : un emplacement, ou la base. */
  onRemettreCouleurs: (index: number, scope: Slot | typeof BASE_COLOR_SCOPE) => void;
  onChangeCharacter: (index: number, base: CharacterDTO) => void;
  messages: MessagesConfigurateur;
}) {
  const m = () => props.messages;
  const editing = () => props.state.editingIndex;

  /** Le rang en cours de déplacement, ou rien quand personne ne glisse. */
  const [rangSaisi, setRangSaisi] = createSignal<number | null>(null);
  let liste: HTMLDivElement | undefined;
  /**
   * Avec beaucoup de personnages, la liste passe sous le bord de la fenêtre :
   * la cale fait tomber ce bord au milieu d'une ligne, qui se voit coupée
   * (cf. la règle de la demi-rangée, Defilement.tsx).
   */
  const { cale, brancher: brancherCale } = createCaleDuBord();

  /**
   * Prend un personnage dans la liste et le suit jusqu'au relâchement.
   *
   * Les mouvements s'écoutent sur la FENÊTRE et non sur la ligne : celle-ci est
   * recréée à chaque réordonnancement, et une ligne recréée en plein geste
   * perdrait le suivi du pointeur. Événements de pointeur plutôt que
   * glisser-déposer HTML, qui ne répond pas au doigt : le stand se tient sur
   * une tablette.
   */
  function attraper(e: PointerEvent, rang: number) {
    e.preventDefault();
    setRangSaisi(rang);
    document.body.style.userSelect = "none";

    const bouger = (ev: PointerEvent) => {
      const courant = rangSaisi();
      if (courant === null || !liste) return;
      const lignes = Array.from(
        liste.querySelectorAll<HTMLElement>("[data-rang]"),
      );
      // La ligne survolée est celle dont le milieu vient d'être dépassé : on
      // échange dès le franchissement, pour que le déplacement se voie pendant
      // le geste et non au relâchement.
      const cible = lignes.findIndex((el) => {
        const r = el.getBoundingClientRect();
        return ev.clientY >= r.top && ev.clientY <= r.bottom;
      });
      if (cible === -1 || cible === courant) return;
      props.onReorder(courant, cible);
      setRangSaisi(cible);
    };
    const lacher = () => {
      setRangSaisi(null);
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", bouger);
      window.removeEventListener("pointerup", lacher);
      window.removeEventListener("pointercancel", lacher);
    };
    window.addEventListener("pointermove", bouger);
    window.addEventListener("pointerup", lacher);
    window.addEventListener("pointercancel", lacher);
  }
  const editingChar = () => {
    const i = editing();
    return i === null ? undefined : props.state.characters[i];
  };

  return (
    <div class="ml-cfg-step">
      <Show
        when={editing() !== null && editingChar()}
        fallback={
          <div
            class="ml-cfg-choix"
            ref={brancherCale}
            style={{ "padding-top": `${cale()}px` }}
          >
            <h3 style={{ "font-weight": "700", "margin-bottom": "10px" }}>
              {m().personnages}
            </h3>

            {/* Liste des personnages ajoutés + z-order */}
            <Show when={props.state.characters.length > 0}>
              <div ref={liste} style={{ "margin-bottom": "14px" }}>
                <For each={props.state.characters}>
                  {(c, i) => {
                    const base = props.characterById(c.characterId);
                    return (
                      <div
                        data-rang={i()}
                        // Une ligne de la liste : un item que le bord bas
                        // peut couper en deux.
                        data-item
                        style={{
                          display: "flex",
                          "align-items": "center",
                          gap: "6px",
                          padding: "6px 8px",
                          border: "1px solid #e5e7eb",
                          "border-radius": "6px",
                          "margin-bottom": "6px",
                          background: "#fff",
                          // La ligne saisie s'allège : sans ce repère, on ne
                          // sait plus laquelle on tient dès qu'il y en a trois.
                          opacity: rangSaisi() === i() ? "0.55" : "1",
                          "box-shadow":
                            rangSaisi() === i()
                              ? "0 2px 8px rgba(0,0,0,.18)"
                              : "none",
                        }}
                      >
                        <span
                          role="button"
                          tabindex="0"
                          aria-label={m().reordonnerAide}
                          title={m().reordonnerAide}
                          onPointerDown={(e) => attraper(e, i())}
                          style={{
                            cursor: rangSaisi() === i() ? "grabbing" : "grab",
                            color: "#9ca3af",
                            "font-size": "15px",
                            "line-height": "1",
                            padding: "2px 4px",
                            // Sans cela, le doigt fait défiler la page au lieu
                            // de prendre la ligne.
                            "touch-action": "none",
                          }}
                        >
                          ⠿
                        </span>
                        <span style={{ flex: "1", "font-size": "13px" }}>
                          {base?.name ??
                            m().personnageN.replace("{id}", String(c.characterId))}
                        </span>
                        <Button
                          variant="secondary"
                          onClick={() => props.onSelect(i())}
                        >
                          {m().modifier}
                        </Button>
                        {/* Deux carrés décalés : le signe habituel de la
                            copie, lisible sans légende et sans emoji — les
                            emoji ne se dessinent pas pareil d'un téléphone à
                            l'autre, et celui-ci doit rester net à 15 px. */}
                        <Button
                          variant="ghost"
                          onClick={() => props.onDuplicate(i())}
                          title={m().dupliquer}
                          aria-label={m().dupliquer}
                        >
                          <svg
                            viewBox="0 0 16 16"
                            width="14"
                            height="14"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.4"
                            stroke-linejoin="round"
                            aria-hidden="true"
                          >
                            <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
                            <path d="M10.5 2.5H3a.5.5 0 0 0-.5.5v7.5" />
                          </svg>
                        </Button>
                        {/* « ✕ » seul ne dit rien au lecteur d'écran : le
                            bouton porte son nom, comme celui de la copie. */}
                        <Button
                          variant="ghost"
                          onClick={() => props.onRemove(i())}
                          title={m().retirer}
                          aria-label={m().retirer}
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
              {m().nouveauPersonnage}
            </Button>
          </div>
        }
      >
        {(char) => (
          <CharacterEditor
            messages={m()}
            character={char()}
            base={props.characterById(char().characterId)}
            characters={props.characters}
            slots={props.slots}
            pieceCategories={props.pieceCategories}
            nuanciersBase={props.nuanciersBase}
            cache={props.cache}
            assetBaseUrl={props.assetBaseUrl}
            onSetAsset={(slot, variantId) =>
              props.onSetAsset(editing()!, slot, variantId)
            }
            onClearSlot={(slot) => props.onClearSlot(editing()!, slot)}
            onSetColors={(couleurs) => props.onSetColors(editing()!, couleurs)}
            onRemettreCouleurs={(scope) =>
              props.onRemettreCouleurs(editing()!, scope)
            }
            onChangeCharacter={(base) =>
              props.onChangeCharacter(editing()!, base)
            }
            onBack={() => props.onQuitterEditeur(false)}
            onValidate={() => props.onQuitterEditeur(true)}
          />
        )}
      </Show>
    </div>
  );
}
