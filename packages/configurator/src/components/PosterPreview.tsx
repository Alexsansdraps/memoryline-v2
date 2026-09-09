/// <reference lib="dom" />
import { createSignal, onCleanup, onMount, For, Show } from "solid-js";
import {
  autoPlace,
  CHAR_BASE_WIDTH,
  policeDefautLigne,
  type CharacterDTO,
  type ConfiguratorState,
  type LigneTexte,
  type SlotsDTO,
  type SvgCache,
  variantesDeVue,
} from "../store";
import { familleCss, policeParId, urlAsset } from "@memoryline/types";
import { CharacterStack } from "./CharacterLayer";
import { Filigrane } from "./Filigrane";

/**
 * Taille des lignes, en cqw (largeur du bloc de texte), par rang parmi les
 * lignes REMPLIES — et non par numéro de ligne : une ligne 1 laissée vide ne
 * doit pas condamner le reste du texte à la petite taille.
 *
 * La première domine, les suivantes se font discrètes ; les trois réunies
 * occupent moins de 15 % de la hauteur de l'affiche, loin au-dessus des
 * personnages.
 */
const TAILLES_LIGNES = [8, 5.5, 4.6];

/** Texte montré tant que le client n'a rien saisi. */
const LIGNES_EXEMPLE: LigneTexte[] = [
  { value: "Memory Line", font: policeDefautLigne(0) },
  { value: "Votre ville, votre histoire", font: policeDefautLigne(1) },
];

/**
 * Couleur de repli d'un cadre dont le back-office n'a pas fixé la teinte :
 * un bois clair, le cadre le plus vendu. Mieux vaut un cadre approximatif
 * qu'une affiche nue là où le client vient d'en choisir un.
 */
const COULEUR_CADRE_DEFAUT = "#b07d42";

/**
 * Épaisseur du cadre, en proportion de la largeur de l'aperçu.
 *
 * En proportion plutôt qu'en pixels : l'aperçu fait quatre cents pixels de
 * large sur la fiche produit et le double en plein écran, un cadre fixe y
 * paraîtrait deux fois plus fin. La valeur correspond à peu près à la
 * baguette de trois centimètres d'un cadre vendu pour un A3.
 */
const PART_CADRE = 0.045;
/** En dessous, la baguette n'est plus qu'un trait ; au-dessus, elle mange l'affiche. */
const CADRE_MIN_PX = 7;
const CADRE_MAX_PX = 34;

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
  /**
   * Filigrane « MEMORY LINE » sur l'affiche. ACTIF par défaut : tout ce qu'on
   * montre au client avant paiement en porte un. Seul un rendu destiné à
   * l'impression — qui n'existe qu'une fois la commande payée — le coupe.
   */
  filigrane?: boolean;
  /**
   * Cadre choisi, dessiné autour de l'affiche. Absent ou nul = affiche nue.
   *
   * On ne prend que ce qui se dessine : la couleur d'aperçu et le nom, pour
   * que le lecteur d'écran dise ce que l'œil voit.
   */
  cadre?: { name?: string; previewColor?: string | null } | null;
}) {
  /** La couleur du cadre, ou rien du tout s'il n'y en a pas. */
  const couleurCadre = () =>
    props.cadre ? props.cadre.previewColor || COULEUR_CADRE_DEFAUT : null;

  /**
   * Largeur réelle de l'aperçu, suivie à la trace.
   *
   * L'affiche est tantôt bridée par la largeur de la colonne, tantôt par la
   * hauteur de la modale : aucune règle CSS ne sait dire d'avance laquelle
   * gagne. On regarde donc.
   */
  const [largeurAffiche, setLargeurAffiche] = createSignal(0);
  let bloc: HTMLDivElement | undefined;
  onMount(() => {
    if (!bloc || typeof ResizeObserver === "undefined") return;
    const observateur = new ResizeObserver(() => {
      // La largeur EXTÉRIEURE : elle ne bouge pas quand la bordure change,
      // sans quoi la mesure et le cadre se poursuivraient sans fin.
      setLargeurAffiche(bloc?.getBoundingClientRect().width ?? 0);
    });
    observateur.observe(bloc);
    setLargeurAffiche(bloc.getBoundingClientRect().width);
    onCleanup(() => observateur.disconnect());
  });

  /** L'épaisseur de la baguette, en pixels, pour la largeur du moment. */
  const epaisseurCadre = () =>
    Math.round(
      Math.min(
        CADRE_MAX_PX,
        Math.max(CADRE_MIN_PX, largeurAffiche() * PART_CADRE),
      ),
    );
  /** Fond affichable : le chemin stocké est brut, on le préfixe ici. */
  const srcFond = () =>
    props.state.backgroundUrl
      ? urlAsset(props.assetBaseUrl ?? "", props.state.backgroundUrl)
      : undefined;

  return (
    <div
      ref={bloc}
      class="ml-cfg-poster"
      role={props.cadre ? "img" : undefined}
      aria-label={
        props.cadre ? `Aperçu de l'affiche dans un ${props.cadre.name ?? "cadre"}` : undefined
      }
      style={{
        position: "relative",
        width: "100%",
        "aspect-ratio": aspectFor(props.state.format),
        background: "#f3f4f6",
        overflow: "hidden",
        // Un vrai cadre n'a pas les coins arrondis, et la baguette mange sur
        // l'affiche au lieu de s'ajouter autour : c'est ce que fait une
        // bordure en « border-box », comme un passe-partout.
        "border-radius": props.cadre ? "2px" : "8px",
        ...(couleurCadre()
          ? {
              border: `${epaisseurCadre()}px solid ${couleurCadre()}`,
              // Deux traits fins : l'un creuse la feuillure côté affiche,
              // l'autre détache la baguette du fond de la page. Sans eux, un
              // cadre blanc sur fond blanc ne se voit pas.
              "box-shadow":
                "inset 0 0 0 1px rgba(0,0,0,.28), 0 0 0 1px rgba(0,0,0,.14), 0 6px 18px rgba(0,0,0,.22)",
            }
          : { "box-shadow": "0 1px 4px rgba(0,0,0,.15)" }),
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

      {/* Couche texte — EN HAUT de l'affiche (charte Memory Line). Les lignes
          remplies se suivent, chacune dans sa police, toutes dans la couleur
          commune. Si aucune n'est saisie : placeholder de marque. */}
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
          const remplies = () =>
            props.state.lignes.filter((l) => l.value.trim() !== "");
          const vide = () => remplies().length === 0;
          const aDessiner = () => (vide() ? LIGNES_EXEMPLE : remplies());
          return (
            <For each={aDessiner()}>
              {(ligne, rang) => (
                <div
                  style={{
                    "font-family": familleCss(
                      policeParId(ligne.font, policeDefautLigne(rang())),
                    ),
                    color: props.state.textStyle.color,
                    // Ce qui distingue la ligne de tête, c'est sa TAILLE. Elle
                    // n'est plus mise en capitales ni en gras : les lignes sont
                    // libres, elles s'écrivent comme le client les tape, et
                    // aucune des polices d'affiche n'a de graisse — le gras
                    // n'était qu'une imitation du navigateur, que le PDF
                    // d'impression ne sait pas reproduire.
                    "font-size": `${TAILLES_LIGNES[rang()] ?? TAILLES_LIGNES.at(-1)}cqw`,
                    "line-height": rang() === 0 ? "1.05" : "1.15",
                    "letter-spacing": rang() === 0 ? "0.04em" : "normal",
                    "margin-top": rang() === 0 ? "0" : "0.1em",
                    "word-break": "break-word",
                    opacity: vide() ? "0.5" : "1",
                  }}
                >
                  {ligne.value}
                </div>
              )}
            </For>
          );
        })()}
      </div>

      {/* Filigrane — dernière couche, au-dessus de tout le reste. */}
      <Show when={props.filigrane !== false}>
        <Filigrane />
      </Show>
    </div>
  );
}
