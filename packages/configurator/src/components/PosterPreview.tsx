/// <reference lib="dom" />
import { For, Show } from "solid-js";
import {
  autoPlace,
  CHAR_BASE_WIDTH,
  type CharacterDTO,
  type ConfiguratorState,
  type SlotsDTO,
  type SvgCache,
  variantesDeVue,
} from "../store";
import {
  familleCss,
  policeParId,
  POLICE_TITRE_DEFAUT,
  POLICE_SOUSTITRE_DEFAUT,
  urlAsset,
} from "@memoryline/types";
import { CharacterStack } from "./CharacterLayer";

/** Ratio largeur/hauteur d'affichage selon le format (portrait). */
function aspectFor(format: string): string {
  // A4 / A3 partagent le même ratio papier ~ 1:1.4142 (portrait).
  return format === "A4" || format === "A3" ? "1 / 1.4142" : "1 / 1.4142";
}

/**
 * Aperçu de l'affiche, espace de coordonnées normalisé 0..1.
 * Couches : fond -> personnages -> titre/sous-titre.
 *
 * Les personnages sont placés AUTOMATIQUEMENT (plus de drag/resize §18.2 F) :
 * centrés, côte à côte, le long du bas-milieu de l'affiche. Aucun pointer
 * event, aucune sélection visible sur l'affiche.
 */
export function PosterPreview(props: {
  state: ConfiguratorState;
  characterById: (id: string | number) => CharacterDTO | undefined;
  slots: SlotsDTO;
  cache: SvgCache;
  /**
   * Décor d'avant-plan (muret, banc…), posé devant le fond et derrière les
   * personnages. Déjà résolu par l'appelant : décor du produit, sinon décor
   * de son type d'affiche. Absent = pas de décor.
   */
  foregroundUrl?: string;
  /** Préfixe des assets, ajouté à l'affichage seulement. */
  assetBaseUrl?: string;
}) {
  /** Fond affichable : le chemin stocké est brut, on le préfixe ici. */
  const srcFond = () =>
    props.state.backgroundUrl
      ? urlAsset(props.assetBaseUrl ?? "", props.state.backgroundUrl)
      : undefined;

  return (
    <div
      class="ml-cfg-poster"
      style={{
        position: "relative",
        width: "100%",
        "aspect-ratio": aspectFor(props.state.format),
        background: "#f3f4f6",
        overflow: "hidden",
        "border-radius": "8px",
        "box-shadow": "0 1px 4px rgba(0,0,0,.15)",
      }}
    >
      {/* Couche fond */}
      <Show when={srcFond()}>
        {(url) => (
          <img
            src={url()}
            alt=""
            draggable={false}
            style={{
              position: "absolute",
              inset: "0",
              width: "100%",
              height: "100%",
              "object-fit": "cover",
              "pointer-events": "none",
              "user-select": "none",
            }}
          />
        )}
      </Show>

      {/* Couche personnages — placement automatique, non interactif */}
      <For each={props.state.characters}>
        {(c, i) => {
          const place = () =>
            autoPlace(props.state.characters)[i()] ?? {
              x: 0.5,
              y: 0.74,
              scale: 0.6,
            };
          // Largeur effective = largeur de base × échelle (rangée centrée).
          const widthPct = () => CHAR_BASE_WIDTH * place().scale * 100;
          // Alignement des pieds : un perso dont le contenu s'arrête à bottomPct
          // de son cadre a du vide dessous ; on DESCEND le cadre de TOUT ce vide
          // pour que le bas du contenu tombe à y + h/2 quel que soit bottomPct.
          // Hauteur du cadre en % de la HAUTEUR d'affiche : largeur × 2 (aspect
          // 1:2) ÷ 1.4142 (affiche portrait W:H = 1:√2) = widthPct × √2.
          const bp = () =>
            props.characterById(c.characterId)?.bottomPct ?? 1;
          const dropPct = () => (1 - bp()) * widthPct() * Math.SQRT2;
          return (
            <div
              style={{
                position: "absolute",
                left: `${place().x * 100}%`,
                top: `${place().y * 100 + dropPct()}%`,
                width: `${widthPct()}%`,
                transform: "translate(-50%, -50%)",
                "aspect-ratio": "1 / 2",
                // ≥10 : les personnages passent DEVANT le muret (z=5).
                "z-index": String(10 + c.position),
                "pointer-events": "none",
              }}
            >
              <CharacterStack
                character={c}
                base={props.characterById(c.characterId)}
                slots={
                  // Chaque perso utilise SON orientation native (dos/face,
                  // ou tout type créé au back-office), sinon la vue globale
                  // de l'affiche.
                  variantesDeVue(
                    props.slots,
                    props.characterById(c.characterId)?.orientation ??
                      props.state.view,
                  )
                }
                cache={props.cache}
              />
            </div>
          );
        }}
      </For>

      {/* Couche décor — DERRIÈRE les personnages (les persos passent devant),
          mais devant le fond. Affichée dès que le type d'affiche en a un et
          qu'il y a au moins un personnage : sans personne à asseoir, le banc
          n'a pas de raison d'être et masquerait le bas du visuel. Ancré en
          bas, pleine largeur, hauteur auto. */}
      <Show
        when={
          props.state.characters.length > 0 ? props.foregroundUrl : undefined
        }
      >
        {(url) => (
          <img
            src={url()}
            alt=""
            draggable={false}
            style={{
              position: "absolute",
              bottom: "0",
              left: "0",
              width: "100%",
              height: "auto",
              "pointer-events": "none",
              "user-select": "none",
              "z-index": "5",
            }}
          />
        )}
      </Show>

      {/* Couche texte — EN HAUT de l'affiche (charte Memory Line). Titre + sous-
          titre partagent police + couleur ; tailles FIXES (titre gros, sous-titre
          plus petit). Si les deux sont vides : placeholder de marque. */}
      <div
        style={{
          position: "absolute",
          left: "0",
          right: "0",
          top: "5%",
          "text-align": "center",
          "pointer-events": "none",
          padding: "0 6%",
          "container-type": "inline-size",
          "z-index": "200",
        }}
      >
        {(() => {
          const st = props.state.textStyle;
          const empty =
            !props.state.title.value && !props.state.subtitle.value;
          const titleText = empty ? "Memory Line" : props.state.title.value;
          const subText = empty
            ? "Votre ville, votre histoire"
            : props.state.subtitle.value;
          return (
            <>
              <Show when={titleText}>
                <div
                  style={{
                    // Police FIXE du titre (charte) ; seule la couleur varie.
                    "font-family": familleCss(
                      policeParId(props.state.title.font, POLICE_TITRE_DEFAUT),
                    ),
                    color: st.color,
                    "font-weight": "700",
                    "font-size": "8cqw",
                    "line-height": "1.05",
                    "letter-spacing": "0.04em",
                    "text-transform": "uppercase",
                    "word-break": "break-word",
                    opacity: empty ? "0.5" : "1",
                  }}
                >
                  {titleText}
                </div>
              </Show>
              <Show when={subText}>
                <div
                  style={{
                    // Police FIXE du sous-titre (script manuscrit, charte).
                    "font-family": familleCss(
                      policeParId(
                        props.state.subtitle.font,
                        POLICE_SOUSTITRE_DEFAUT,
                      ),
                    ),
                    color: st.color,
                    "font-size": "5.5cqw",
                    "margin-top": "0.1em",
                    "word-break": "break-word",
                    opacity: empty ? "0.5" : "1",
                  }}
                >
                  {subText}
                </div>
              </Show>
            </>
          );
        })()}
      </div>
    </div>
  );
}
