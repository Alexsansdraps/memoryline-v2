/// <reference lib="dom" />
import { For, Index, Show, type JSX } from "solid-js";
import {
  espaceAvantLigne,
  espacementDeLigne,
  facteurTailleLigne,
  familleCss,
  HAUT_DU_TEXTE,
  INTERLIGNE_LIGNE_POSEE,
  interligneDeLigne,
  MARGE_DU_TEXTE,
  morceauxDeTexte,
  POLICE_SOUSTITRE_DEFAUT,
  POLICE_TITRE_DEFAUT,
  policeParId,
  sousLignes,
  tailleDeLigneCqw,
  type PoliceAffiche,
} from "@memoryline/types";

/**
 * Les lignes de texte d'une affiche IA (photo ou ciel étoilé), posées sur sa
 * vignette du panier (27/11 au soir, Alexandra : « quand je suis dans le
 * panier avec un ciel étoilé, j'ai perdu le texte »).
 *
 * Les MÊMES règles que l'aperçu de la fenêtre (AfficheIA.tsx, ses deux
 * calques) et que le fichier d'impression : lignes non déplacées empilées en
 * haut, lignes posées (x, y) à leur point — sur un ciel, toutes le sont —,
 * tailles en `cqw` de la largeur du bloc, × la taille choisie sur la ligne,
 * × 1/√2 en paysage. Sans la réduction des lignes trop longues (une mesure
 * des polices que la vignette ne fait pas) : sur une ligne au ras de la
 * largeur, la vignette peut déborder d'un rien, l'impression non.
 */
export interface LigneIA {
  value: string;
  font?: string | null;
  color?: string | null;
  x?: number;
  y?: number;
  taille?: string | null;
}

function Morceaux(props: { valeur: string; police: PoliceAffiche }): JSX.Element {
  return (
    <For each={sousLignes(props.valeur)}>
      {(sousLigne) => (
        <div>
          <For each={morceauxDeTexte(sousLigne, props.police)}>
            {(m) => <span style={{ "font-family": familleCss(m.police) }}>{m.texte}</span>}
          </For>
        </div>
      )}
    </For>
  );
}

export default function TexteAfficheIA(props: { lignes: readonly LigneIA[]; paysage?: boolean }): JSX.Element {
  const remplies = () => props.lignes.filter((l) => (l.value ?? "").trim() !== "");
  const echelle = () => (props.paysage ? 1 / Math.SQRT2 : 1);
  const police = (l: LigneIA, rang: number) =>
    policeParId(l.font ?? undefined, rang === 0 ? POLICE_TITRE_DEFAUT : POLICE_SOUSTITRE_DEFAUT);
  const taille = (l: LigneIA, rang: number) =>
    `${tailleDeLigneCqw(rang) * echelle() * facteurTailleLigne(l.taille)}cqw`;
  const posee = (l: LigneIA) => typeof l.x === "number" && typeof l.y === "number";
  return (
    <Show when={remplies().length > 0}>
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "0",
          right: "0",
          top: `${HAUT_DU_TEXTE * 100}%`,
          "text-align": "center",
          "pointer-events": "none",
          padding: `0 ${MARGE_DU_TEXTE * 100}%`,
          "container-type": "inline-size",
        }}
      >
        <Index each={remplies()}>
          {(l, rang) => (
            <Show when={!posee(l())}>
              <div
                style={{
                  "font-family": familleCss(police(l(), rang)),
                  color: l().color ?? undefined,
                  "font-size": taille(l(), rang),
                  "line-height": String(interligneDeLigne(rang)),
                  "letter-spacing": `${espacementDeLigne(rang)}em`,
                  "margin-top": `${espaceAvantLigne(rang)}em`,
                  "white-space": "nowrap",
                }}
              >
                <Morceaux valeur={l().value} police={police(l(), rang)} />
              </div>
            </Show>
          )}
        </Index>
      </div>
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: "0",
          "pointer-events": "none",
          padding: `0 ${MARGE_DU_TEXTE * 100}%`,
          "container-type": "inline-size",
        }}
      >
        <Index each={remplies()}>
          {(l, rang) => (
            <Show when={posee(l())}>
              <div
                style={{
                  position: "absolute",
                  left: `${(l().x ?? 0.5) * 100}%`,
                  top: `${(l().y ?? 0.1) * 100}%`,
                  transform: "translate(-50%, -50%)",
                  "text-align": "center",
                  "white-space": "nowrap",
                  "font-family": familleCss(police(l(), rang)),
                  color: l().color ?? undefined,
                  "font-size": taille(l(), rang),
                  "line-height": String(INTERLIGNE_LIGNE_POSEE),
                  "letter-spacing": `${espacementDeLigne(rang)}em`,
                }}
              >
                <Morceaux valeur={l().value} police={police(l(), rang)} />
              </div>
            </Show>
          )}
        </Index>
      </div>
    </Show>
  );
}
