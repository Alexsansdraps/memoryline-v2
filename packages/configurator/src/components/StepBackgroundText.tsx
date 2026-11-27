/// <reference lib="dom" />
import { For, Show } from "solid-js";
import {
  aLaLargeur,
  COULEURS_TEXTE_AFFICHE,
  couleurTexteParValeur,
  policesDeLaLigne,
  POLICES_AFFICHE,
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

/** Étape 1 : fond + les trois lignes de texte. */
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
  /** 27/11 : taille d'UNE ligne, petit / moyen / grand. */
  onTextTaille?: (ligne: number, taille: "s" | "m" | "l") => void;
  messages: MessagesConfigurateur;
}) {
  const m = () => props.messages;
  /** Nom traduit d'une police ; l'identifiant enregistré ne change pas. */
  const nomPolice = (police: PoliceAffiche) =>
    m().libellesPolices[police.id] ?? police.libelle;

  /**
   * Les polices montrées pour une ligne : celles qu'elle propose, plus — le
   * cas échéant — celle qu'elle porte déjà, comme pour la couleur plus bas.
   * Une affiche composée avant que la boutique retire une police (League
   * Spartan en ligne 1, notamment), rouverte depuis le panier, s'écrit
   * toujours dans SA police : sans cette pastille, aucune ne paraissait
   * choisie alors que l'aperçu en montrait une. Elle n'est plus proposée :
   * choisir une autre police la fait disparaître.
   *
   * Elle se nomme par sa famille (« League Spartan ») et non par son ancien
   * libellé : un nom propre se lit dans toutes les langues, et ses
   * traductions ont quitté le site avec elle.
   */
  const policesMontrees = (ligne: number): { police: PoliceAffiche; nom: string }[] => {
    const proposees = policesDeLaLigne(ligne).map((police) => ({
      police,
      nom: nomPolice(police),
    }));
    const actuelle = props.state.lignes[ligne]?.font;
    if (!actuelle || proposees.some((p) => p.police.id === actuelle)) return proposees;
    const ancienne = POLICES_AFFICHE.find((p) => p.id === actuelle);
    return ancienne ? [...proposees, { police: ancienne, nom: ancienne.famille }] : proposees;
  };
  /**
   * Choix rapide de la police, montrée DANS la police : le client juge le
   * rendu, pas un nom. Une rangée par ligne, car chacune a la sienne. Quand
   * elle ne tient pas en largeur, le site la fait passer à la ligne
   * (`.ml-cfg-polices`, global.css) : trois polices proposées au plus, une
   * de plus quand l'affiche rouverte garde une ancienne police
   * (policesMontrees), toutes en vue.
   * La zone qui défile, avec flèches et barre bien visibles (ZoneDefilante),
   * reste là pour une pastille plus large que l'écran.
   */
  const ChoixPolice = (p: { ligne: number }) => (
    <ZoneDefilante
      sens="horizontal"
      versDebut={m().precedent}
      versFin={m().suivant}
      class="ml-cfg-polices"
    >
      <For each={policesMontrees(p.ligne)}>
        {({ police, nom }) => {
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
              title={nom}
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
              {nom}
            </button>
          );
        }}
      </For>
    </ZoneDefilante>
  );
  // Les vignettes en 400 px : un fond SVG pèse jusqu'à 14 Mo, l'API en donne
  // une image de la largeur demandée (index.ts, fichierALaTaille).
  const resolve = (url: string) =>
    url.startsWith("http")
      ? url
      : (aLaLargeur(props.assetBaseUrl.replace(/\/$/, "") + url, 400) ?? url);

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
                    class="ml-choix ml-choix-dedans ml-squelette"
                    style={{
                      border: selected()
                        ? "2px solid #4f46e5"
                        : "1px solid #d1d5db",
                      "border-radius": "6px",
                      padding: "2px",
                      cursor: "pointer",
                      // Pas de fond blanc posé ici : le reflet de chargement
                      // (ml-squelette, global.css) se voit le temps que la
                      // vignette arrive.
                      "aspect-ratio": "1 / 1.4142",
                      overflow: "hidden",
                    }}
                  >
                    <img
                      src={resolve(bg.url)}
                      alt={bg.name ?? ""}
                      onLoad={(e) => e.currentTarget.parentElement?.classList.add("est-charge")}
                      onError={(e) => e.currentTarget.parentElement?.classList.add("est-charge")}
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
                nombre de morceaux, trois au plus. La phrase qui l'expliquait
                sous les champs est partie à la demande de la boutiquière :
                le geste reste, sans mode d'emploi. */}
            <textarea
              rows={Math.min(MORCEAUX_PAR_LIGNE, ligne.value.split("\n").length)}
              value={ligne.value}
              placeholder={m().exemplesLignes[i()] ?? ""}
              onInput={(e) => {
                const champ = e.currentTarget;
                const value = limiterRetours(champ.value);
                if (value !== champ.value) champ.value = value;
                props.onTextValue(i(), value);
              }}
              style={{ ...inputStyle, resize: "none", "line-height": "1.4" }}
            />
            <ChoixPolice ligne={i()} />
            {/* 27/11, Alexandra : « faudrait que ça propose 3 tailles de texte
                à chaque fois sur chaque ligne 1, 2, 3 ». Trois « A » de tailles
                croissantes ; moyen = la taille d'avant. */}
            <Show when={props.onTextTaille}>
              <div role="group" aria-label={m().tailleLigne} style={{ display: "flex", gap: "6px", "margin-top": "6px", "align-items": "flex-end" }}>
                <For each={[["s", 12], ["m", 15], ["l", 19]] as const}>
                  {([t, px], k) => {
                    const actif = () => (ligne.taille ?? "m") === t;
                    return (
                      <button
                        type="button"
                        aria-pressed={actif()}
                        aria-label={m().taillesLigne[k()]}
                        title={m().taillesLigne[k()]}
                        onClick={() => props.onTextTaille?.(i(), t)}
                        style={{
                          "font-size": `${px}px`,
                          "min-width": "32px",
                          padding: "2px 8px",
                          "border-radius": "6px",
                          border: actif() ? "2px solid currentColor" : "1px solid rgba(0,0,0,0.25)",
                          background: "transparent",
                          cursor: "pointer",
                          "font-weight": actif() ? "700" : "400",
                        }}
                      >
                        A
                      </button>
                    );
                  }}
                </For>
              </div>
            </Show>
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
