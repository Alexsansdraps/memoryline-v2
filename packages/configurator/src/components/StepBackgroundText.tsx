/// <reference lib="dom" />
import { For, Show } from "solid-js";
import {
  POLICES_AFFICHE,
  familleCss,
  type BackgroundDTO,
} from "@memoryline/types";
import type { ConfiguratorState } from "../store";
import { Field } from "./ui";

/** Étape 1 : fond + textes (titre + sous-titre, symboles & chiffres autorisés). */
export function StepBackgroundText(props: {
  state: ConfiguratorState;
  backgrounds: BackgroundDTO[];
  assetBaseUrl: string;
  onSelectBackground: (bg: BackgroundDTO) => void;
  onTextValue: (which: "title" | "subtitle", value: string) => void;
  onTextStyle: (
    patch: Partial<{ font: string; color: string; size: number }>,
  ) => void;
  /** Change la police d'un seul bloc (titre ou sous-titre). */
  onTextFont: (which: "title" | "subtitle", font: string) => void;
}) {
  /**
   * Choix rapide de la police, montrée DANS la police : le client juge le
   * rendu, pas un nom. Une rangée par bloc, car titre et sous-titre se
   * choisissent séparément.
   */
  const ChoixPolice = (p: { which: "title" | "subtitle" }) => (
    <div class="ml-cfg-polices">
      <For each={POLICES_AFFICHE}>
        {(police) => {
          const actif = () => props.state[p.which].font === police.id;
          return (
            <button
              type="button"
              onClick={() => props.onTextFont(p.which, police.id)}
              aria-pressed={actif()}
              title={police.libelle}
              style={{
                flex: "0 0 auto",
                border: actif() ? "2px solid #4f46e5" : "1px solid #d1d5db",
                background: "#fff",
                color: "#1f2937",
                "border-radius": "8px",
                padding: "4px 12px",
                cursor: "pointer",
                "font-family": familleCss(police),
                "font-size": "19px",
                "line-height": "1.5",
                "white-space": "nowrap",
              }}
            >
              {police.libelle}
            </button>
          );
        }}
      </For>
    </div>
  );
  const resolve = (url: string) =>
    url.startsWith("http") ? url : props.assetBaseUrl.replace(/\/$/, "") + url;

  const inputStyle = {
    width: "100%",
    padding: "8px 10px",
    "border-radius": "6px",
    border: "1px solid #d1d5db",
    "font-size": "14px",
  } as const;

  return (
    <div class="ml-cfg-step">
      <h3 style={{ "font-weight": "700", "margin-bottom": "10px" }}>
        Fond & texte
      </h3>

      {/* Galerie de fonds : affichée UNIQUEMENT si le produit a plusieurs
          variantes de fond. Avec un seul fond (cas normal), l'affiche est fixée
          par le produit → pas de choix proposé au client. */}
      <Show when={props.backgrounds.length > 1}>
        <Field label="Choisir un fond">
          <div
            style={{
              display: "grid",
              "grid-template-columns": "repeat(auto-fill, minmax(72px, 1fr))",
              gap: "8px",
            }}
          >
            <For each={props.backgrounds}>
              {(bg) => {
                const selected = () =>
                  String(props.state.backgroundId) === String(bg.id);
                return (
                  <button
                    type="button"
                    onClick={() => props.onSelectBackground(bg)}
                    title={bg.name ?? ""}
                    style={{
                      border: selected()
                        ? "2px solid #4f46e5"
                        : "1px solid #d1d5db",
                      "border-radius": "6px",
                      padding: "2px",
                      cursor: "pointer",
                      background: "#fff",
                      "aspect-ratio": "1 / 1.4142",
                      overflow: "hidden",
                    }}
                  >
                    <img
                      src={resolve(bg.url)}
                      alt={bg.name ?? ""}
                      style={{
                        width: "100%",
                        height: "100%",
                        "object-fit": "cover",
                      }}
                    />
                  </button>
                );
              }}
            </For>
          </div>
        </Field>
      </Show>

      {/* Textes : seul le contenu diffère entre titre et sous-titre. */}
      <Field label="Titre (symboles et chiffres autorisés)">
        <input
          type="text"
          value={props.state.title.value}
          placeholder="Memory Line"
          onInput={(e) => props.onTextValue("title", e.currentTarget.value)}
          style={inputStyle}
        />
        <ChoixPolice which="title" />
      </Field>
      <Field label="Sous-titre (symboles et chiffres autorisés)">
        <input
          type="text"
          value={props.state.subtitle.value}
          placeholder="Votre ville, votre histoire"
          onInput={(e) => props.onTextValue("subtitle", e.currentTarget.value)}
          style={inputStyle}
        />
        <ChoixPolice which="subtitle" />
      </Field>

      {/* Style PARTAGÉ par le titre ET le sous-titre (police + couleur).
          Pas de réglage de taille : la taille est fixe (titre en gros, sous-titre
          plus petit), comme la charte des affiches. */}
      <div
        style={{
          "margin-top": "8px",
          "padding-top": "10px",
          "border-top": "1px solid #e5e7eb",
        }}
      >
        <Field label="Couleur du texte (titre & sous-titre)">
          <input
            type="color"
            value={props.state.textStyle.color}
            onInput={(e) => props.onTextStyle({ color: e.currentTarget.value })}
            style={{ width: "48px", height: "38px", border: "none" }}
          />
        </Field>
      </div>
    </div>
  );
}
