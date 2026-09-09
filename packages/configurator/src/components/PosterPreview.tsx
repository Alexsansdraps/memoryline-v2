/// <reference lib="dom" />
import { createMemo, createSignal, onCleanup, onMount, For, Show } from "solid-js";
import {
  bornerPlacement,
  CHAR_BASE_WIDTH,
  placementsAffiche,
  policeDefautLigne,
  type CharacterDTO,
  type ConfiguratorState,
  type LigneTexte,
  type PlacementPersonnage,
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

/**
 * Pas d'un déplacement au clavier, en fraction de l'affiche.
 *
 * Une flèche déplace d'un centième d'affiche : assez pour se voir, assez fin
 * pour caler un personnage contre un autre en quelques appuis.
 */
const PAS_CLAVIER = 0.01;

/** Ratio largeur/hauteur d'affichage selon le format (portrait). */
function aspectFor(format: string): string {
  // A4 / A3 partagent le même ratio papier ~ 1:1.4142 (portrait).
  return format === "A4" || format === "A3" ? "1 / 1.4142" : "1 / 1.4142";
}

/**
 * Aperçu de l'affiche, espace de coordonnées normalisé 0..1.
 * Couches : fond -> personnages -> titre/sous-titre.
 *
 * Les personnages se rangent AUTOMATIQUEMENT : centrés, côte à côte, le long
 * du bas-milieu de l'affiche. Le client peut les déplacer à la souris ou au
 * doigt, mais seulement là où on le lui propose (`deplacable`) : le panier et
 * la commande montrent la même affiche, on n'y compose plus rien.
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
  /**
   * Autorise le client à déplacer les personnages du doigt ou à la souris.
   *
   * FAUX par défaut : partout ailleurs que dans le configurateur — panier,
   * commande — l'affiche n'est plus qu'une image de ce qui a été validé, et
   * on ne doit pas pouvoir la remanier d'un glissement involontaire.
   */
  deplacable?: boolean;
  /**
   * Le client vient de poser un personnage. La position est donnée en
   * fractions (0..1) de la zone d'affiche, déjà bornée à l'intérieur du cadre.
   */
  onDeplace?: (index: number, position: { x: number; y: number }) => void;
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

  /** Bas réel du dessin d'un personnage, pour aligner ses pieds au sol. */
  const basDuDessin = (id: string | number): number =>
    props.characterById(id)?.bottomPct ?? 1;

  /**
   * Où se pose chaque personnage : la rangée automatique, ou la place que le
   * client lui a donnée. Une seule fois pour toute l'affiche — le calcul de la
   * rangée dépend de tous les personnages, le refaire par personnage le
   * répéterait autant de fois qu'il y en a.
   */
  const placements = createMemo<PlacementPersonnage[]>(() =>
    placementsAffiche(props.state.characters, (c) =>
      basDuDessin(c.characterId),
    ),
  );

  /** Index du personnage en cours de glissement, sinon rien. */
  const [glisse, setGlisse] = createSignal<number | null>(null);

  /**
   * Zone utile de l'affiche, en pixels écran : l'INTÉRIEUR du cadre.
   *
   * La baguette est dessinée en bordure et mange sur l'affiche. Compter sur la
   * boîte extérieure poserait un personnage lâché tout en bas sous la
   * baguette, là où le client ne le reverrait jamais.
   */
  function zoneAffiche():
    | { gauche: number; haut: number; largeur: number; hauteur: number }
    | null {
    if (!bloc) return null;
    const boite = bloc.getBoundingClientRect();
    const baguette = couleurCadre() ? epaisseurCadre() : 0;
    const largeur = boite.width - 2 * baguette;
    const hauteur = boite.height - 2 * baguette;
    if (largeur <= 0 || hauteur <= 0) return null;
    return {
      gauche: boite.left + baguette,
      haut: boite.top + baguette,
      largeur,
      hauteur,
    };
  }

  /**
   * Fin du geste en cours, gardée sous la main : un aperçu démonté au beau
   * milieu d'un glissement (changement d'étape, fermeture de la modale)
   * laisserait sinon ses écouteurs sur `window` et le texte de la page
   * insélectionnable.
   */
  let finDuGeste: (() => void) | null = null;
  onCleanup(() => finDuGeste?.());

  function demarrerGlissement(
    evenement: PointerEvent,
    index: number,
    depart: PlacementPersonnage,
    bas: number,
  ) {
    if (!props.deplacable || evenement.button !== 0) return;
    const zone = zoneAffiche();
    if (!zone) return;
    evenement.preventDefault();
    finDuGeste?.();

    const departX = evenement.clientX;
    const departY = evenement.clientY;
    // Sans ça, glisser sur l'affiche surligne le titre au lieu de déplacer.
    const selectionAvant = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    setGlisse(index);

    const suivre = (e: PointerEvent) => {
      props.onDeplace?.(
        index,
        bornerPlacement(
          {
            x: depart.x + (e.clientX - departX) / zone.largeur,
            y: depart.y + (e.clientY - departY) / zone.hauteur,
          },
          depart.scale,
          bas,
        ),
      );
    };
    const terminer = () => {
      window.removeEventListener("pointermove", suivre);
      window.removeEventListener("pointerup", terminer);
      window.removeEventListener("pointercancel", terminer);
      document.body.style.userSelect = selectionAvant;
      setGlisse(null);
      finDuGeste = null;
    };

    // Sur `window`, jamais sur le personnage : chaque déplacement redessine
    // l'affiche et le moteur peut recréer l'élément sous le doigt. Une écoute
    // posée sur lui — capture du pointeur comprise — se romprait au premier
    // pixel parcouru.
    window.addEventListener("pointermove", suivre);
    window.addEventListener("pointerup", terminer);
    window.addEventListener("pointercancel", terminer);
    finDuGeste = terminer;
  }

  /** Déplacement aux flèches : le glisser-déposer sans souris ni écran tactile. */
  function deplacerAuClavier(
    evenement: KeyboardEvent,
    index: number,
    depart: PlacementPersonnage,
    bas: number,
  ) {
    if (!props.deplacable) return;
    const pas: Record<string, { dx: number; dy: number } | undefined> = {
      ArrowLeft: { dx: -PAS_CLAVIER, dy: 0 },
      ArrowRight: { dx: PAS_CLAVIER, dy: 0 },
      ArrowUp: { dx: 0, dy: -PAS_CLAVIER },
      ArrowDown: { dx: 0, dy: PAS_CLAVIER },
    };
    const vers = pas[evenement.key];
    if (!vers) return;
    evenement.preventDefault();
    props.onDeplace?.(
      index,
      bornerPlacement(
        { x: depart.x + vers.dx, y: depart.y + vers.dy },
        depart.scale,
        bas,
      ),
    );
  }

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

      {/* Couche personnages — rangée automatique, déplaçable sur demande */}
      <For each={props.state.characters}>
        {(c, i) => {
          const place = (): PlacementPersonnage =>
            placements()[i()] ?? { x: 0.5, y: 0.74, scale: 0.6 };
          // Largeur effective = largeur de base × échelle (rangée centrée).
          const widthPct = () => CHAR_BASE_WIDTH * place().scale * 100;
          // Alignement des pieds : un perso dont le contenu s'arrête à bottomPct
          // de son cadre a du vide dessous ; on DESCEND le cadre de TOUT ce vide
          // pour que le bas du contenu tombe à y + h/2 quel que soit bottomPct.
          // Hauteur du cadre en % de la HAUTEUR d'affiche : largeur × 2 (aspect
          // 1:2) ÷ 1.4142 (affiche portrait W:H = 1:√2) = widthPct × √2.
          const bp = () => basDuDessin(c.characterId);
          const dropPct = () => (1 - bp()) * widthPct() * Math.SQRT2;
          const nom = () =>
            props.characterById(c.characterId)?.name ?? "Personnage";
          return (
            <div
              onPointerDown={(e) =>
                demarrerGlissement(e, i(), place(), bp())
              }
              onKeyDown={(e) => deplacerAuClavier(e, i(), place(), bp())}
              tabindex={props.deplacable ? 0 : undefined}
              role={props.deplacable ? "button" : undefined}
              aria-label={
                props.deplacable
                  ? `${nom()} : glissez-le pour le déplacer sur l'affiche, ou utilisez les flèches`
                  : undefined
              }
              style={{
                position: "absolute",
                left: `${place().x * 100}%`,
                top: `${place().y * 100 + dropPct()}%`,
                width: `${widthPct()}%`,
                transform: "translate(-50%, -50%)",
                "aspect-ratio": "1 / 2",
                // ≥10 : les personnages passent DEVANT le muret (z=5).
                "z-index": String(10 + c.position),
                "pointer-events": props.deplacable ? "auto" : "none",
                // Le doigt doit déplacer le personnage, pas faire défiler la
                // page : sans ça le navigateur s'approprie le geste.
                "touch-action": props.deplacable ? "none" : undefined,
                "user-select": props.deplacable ? "none" : undefined,
                cursor: props.deplacable
                  ? glisse() === i()
                    ? "grabbing"
                    : "grab"
                  : undefined,
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
