/// <reference lib="dom" />
import { For, Show } from "solid-js";
import {
  COULEURS_TEXTE_AFFICHE,
  couleurTexteParValeur,
  policesDeLaLigne,
  familleCss,
  limiterRetours,
  MORCEAUX_PAR_LIGNE,
  type BackgroundDTO,
  type CouleurTexteAffiche,
  type PoliceAffiche,
} from "@memoryline/types";
import type { ConfiguratorState } from "../store";
import { Field, PastilleCouleur } from "./ui";
import { ZoneDefilante } from "./Defilement";
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
  messages: MessagesConfigurateur;
}) {
  const m = () => props.messages;
  /** Nom traduit d'une police ; l'identifiant enregistré ne change pas. */
  const nomPolice = (police: PoliceAffiche) =>
    m().libellesPolices[police.id] ?? police.libelle;
  /**
   * Choix rapide de la police, montrée DANS la police : le client juge le
   * rendu, pas un nom. Une rangée par ligne, car chacune a la sienne. Quand
   * elle ne tient pas en largeur, elle défile avec flèches et barre bien
   * visibles (ZoneDefilante).
   */
  const ChoixPolice = (p: { ligne: number }) => (
    <ZoneDefilante
      sens="horizontal"
      versDebut={m().precedent}
      versFin={m().suivant}
      class="ml-cfg-polices"
    >
      <For each={policesDeLaLigne(p.ligne)}>
        {(police) => {
          const actif = () =>
            props.state.lignes[p.ligne]?.font === police.id;
          return (
            <button
              type="button"
              onClick={() => props.onTextFont(p.ligne, police.id)}
              aria-pressed={actif()}
              // Marques du choix fait posées par le site (`ml-choix`) ; le
              // style en ligne reste le repli du module seul.
              class="ml-choix"
              title={nomPolice(police)}
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
              {nomPolice(police)}
            </button>
          );
        }}
      </For>
    </ZoneDefilante>
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
                    // L'état, lisible par un lecteur d'écran, et les marques
                    // du choix fait posées par le site (`ml-choix`). La case
                    // rogne son image : la coche se loge dans son coin.
                    aria-pressed={selected()}
                    class="ml-choix ml-choix-dedans"
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
          <Field
            label={
              m().champsLignes[i()] ?? m().ligneN.replace("{n}", String(i() + 1))
            }
          >
            {/* Une zone de texte, pour que la touche Entrée coupe la ligne
                (« SAINT-VALERY- » / « SUR-SOMME ») ; elle grandit avec le
                nombre de morceaux, trois au plus. */}
            <textarea
              rows={Math.min(MORCEAUX_PAR_LIGNE, ligne.value.split("\n").length)}
              value={ligne.value}
              placeholder={m().exemplesLignes[i()] ?? ""}
              aria-describedby="ml-aide-retour-ligne"
              onInput={(e) => {
                const champ = e.currentTarget;
                const value = limiterRetours(champ.value);
                if (value !== champ.value) champ.value = value;
                props.onTextValue(i(), value);
              }}
              style={{ ...inputStyle, resize: "none", "line-height": "1.4" }}
            />
            <ChoixPolice ligne={i()} />
          </Field>
        )}
      </For>
      <p
        id="ml-aide-retour-ligne"
        style={{ margin: "-4px 0 0", "font-size": "12px", color: "#6b7280" }}
      >
        {m().aideRetourLigne}
      </p>

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
                    // Traduit par l'identifiant ; la couleur d'une ancienne
                    // commande, hors charte, garde sa valeur pour nom.
                    libelle={
                      m().libellesCouleursTexte[couleur.id] ?? couleur.libelle
                    }
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
