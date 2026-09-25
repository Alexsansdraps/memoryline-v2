/// <reference lib="dom" />
import { For, Show, type JSX } from "solid-js";
import {
  COULEURS_TEXTE_AFFICHE,
  couleurTexteParValeur,
  policesDeLaLigne,
  familleCss,
  type BackgroundDTO,
  type CouleurTexteAffiche,
} from "@memoryline/types";
import type { ConfiguratorState } from "../store";
import { Field, PastilleCouleur } from "./ui";
import type { MessagesConfigurateur } from "../messages";

/** Étape 1 : fond + les trois lignes de texte (symboles & chiffres autorisés). */
export function StepBackgroundText(props: {
  state: ConfiguratorState;
  backgrounds: BackgroundDTO[];
  assetBaseUrl: string;
  onSelectBackground: (bg: BackgroundDTO) => void;
  /** Texte d'UNE ligne, désignée par son rang (0, 1, 2). */
  onTextValue: (ligne: number, value: string) => void;
  onTextStyle: (
    patch: Partial<{ font: string; color: string; size: number }>,
  ) => void;
  /** Police d'UNE ligne : chacune choisit la sienne. */
  onTextFont: (ligne: number, font: string) => void;
  /**
   * L'encart vidéo, fourni tout fait par la boutique (cf. ConfiguratorProps).
   *
   * Le paquet ne sait rien de son contenu : il lui réserve la place en tête
   * de l'étape, un point c'est tout.
   */
  encartVideo?: () => JSX.Element;
  messages: MessagesConfigurateur;
}) {
  const m = () => props.messages;
  /**
   * Choix rapide de la police, montrée DANS la police : le client juge le
   * rendu, pas un nom. Une rangée par ligne, car chacune a la sienne.
   */
  const ChoixPolice = (p: { ligne: number }) => (
    <div class="ml-cfg-polices">
      <For each={policesDeLaLigne(p.ligne)}>
        {(police) => {
          const actif = () =>
            props.state.lignes[p.ligne]?.font === police.id;
          return (
            <button
              type="button"
              onClick={() => props.onTextFont(p.ligne, police.id)}
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

  /**
   * Couleurs proposées : les deux de la charte, plus — le cas échéant — celle
   * que porte déjà l'affiche. Une commande composée du temps du nuancier libre
   * garde SA couleur : on la montre, sélectionnée, au lieu de la réécrire dans
   * le dos du client.
   */
  const couleursProposees = (): CouleurTexteAffiche[] => {
    const actuelle = props.state.textStyle.color;
    if (couleurTexteParValeur(actuelle)) return [...COULEURS_TEXTE_AFFICHE];
    return [
      ...COULEURS_TEXTE_AFFICHE,
      { id: "actuelle", libelle: actuelle, hex: actuelle },
    ];
  };

  return (
    <div class="ml-cfg-step">
      {/* La vidéo d'explication, tout en haut : c'est la première chose qu'on
          voit en ouvrant la fenêtre, et c'est exactement ce qu'une vidéo qui
          explique la personnalisation doit être.

          Aucun `data-item` ici, et jamais : l'attribut désigne les CHOIX
          qu'on coupe de moitié au bord de l'écran pour montrer qu'on peut
          faire défiler (Defilement.tsx). Un encart marqué deviendrait
          « l'item coupé » et l'indice ne voudrait plus rien dire.

          Hauteur FIXE, garantie par l'hôte : le lecteur s'ouvre par-dessus la
          fenêtre, jamais dans le flux. Un encart qui se déplierait déplacerait
          la cale du bord pendant qu'on fait défiler, et le contenu sauterait
          sous le doigt. */}
      <Show when={props.encartVideo}>{props.encartVideo!()}</Show>

      <h3 style={{ "font-weight": "700", "margin-bottom": "10px" }}>
        {m().etapeFond}
      </h3>

      {/* Galerie de fonds : affichée UNIQUEMENT si le produit a plusieurs
          variantes de fond. Avec un seul fond (cas normal), l'affiche est fixée
          par le produit → pas de choix proposé au client. */}
      <Show when={props.backgrounds.length > 1}>
        <Field label={m().choisirFond}>
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

      {/* Les lignes de l'affiche : même champ pour toutes, aucune n'est le
          titre. Une ligne laissée vide n'est pas dessinée. */}
      <For each={props.state.lignes}>
        {(ligne, i) => (
          <Field label={m().champsLignes[i()] ?? `Ligne ${i() + 1}`}>
            <input
              type="text"
              value={ligne.value}
              placeholder={m().exemplesLignes[i()] ?? ""}
              onInput={(e) => props.onTextValue(i(), e.currentTarget.value)}
              style={inputStyle}
            />
            <ChoixPolice ligne={i()} />
          </Field>
        )}
      </For>

      {/* Couleur PARTAGÉE par les trois lignes. Deux teintes seulement : un
          nuancier libre laissait choisir un texte illisible sur le fond, et
          l'affiche ratée ne se voit qu'une fois imprimée. */}
      <div
        style={{
          "margin-top": "8px",
          "padding-top": "10px",
          "border-top": "1px solid #e5e7eb",
        }}
      >
        <Field label={m().couleurTexte}>
          <div style={{ display: "flex", gap: "10px" }}>
            <For each={couleursProposees()}>
              {(couleur) => {
                const actif = () =>
                  props.state.textStyle.color.toUpperCase() ===
                  couleur.hex.toUpperCase();
                return (
                  <PastilleCouleur
                    couleur={couleur.hex}
                    libelle={couleur.libelle}
                    actif={actif()}
                    onClick={() => props.onTextStyle({ color: couleur.hex })}
                  />
                );
              }}
            </For>
          </div>
        </Field>
      </div>
    </div>
  );
}
