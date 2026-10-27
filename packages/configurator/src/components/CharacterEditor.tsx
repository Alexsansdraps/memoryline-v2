/// <reference lib="dom" />
import {
  For,
  Index,
  Show,
  createMemo,
  createSignal,
  createUniqueId,
  onCleanup,
  type JSX,
} from "solid-js";
import {
  BASE_COLOR_SCOPE,
  colorKey,
  couleursChangees,
  couleursDeLaBase,
  couleursDeLaPiece,
  couleursDuGroupePourScope,
  famillesProposees,
  groupesDuDessin,
  groupesProposesDeLaBase,
  groupesProposesDeLaPiece,
  scopeSvgStyles,
  type CouleursImage,
  type GroupeCouleur,
  type NuancierBase,
  couleursDuNuancier,
  type Nuancier,
} from "@memoryline/types";
import {
  NONE_ASSET,
  cadrageDeVignette,
  couleursAuChangementDePiece,
  defaultCharacter,
  dessinPourLEcran,
  findVariant,
  recolorForCharacter,
  withViewBox,
  paletteForVariant,
  type PieceCategoryDTO,
  type NuanciersPersonnages,
  SLOTS,
  SLOT_THUMB_VIEWBOX,
  type CharacterDTO,
  type Slot,
  type SlotVariants,
  type SvgCache,
  type VariantDTO,
  type WorkingCharacter,
} from "../store";
import { CharacterStack } from "./CharacterLayer";
import {
  BarreActions,
  brancherDemiRangee,
  createPartiesDessous,
  defilerJusqua,
  InviteADescendre,
  largeurDemiVignette,
  ZoneDefilante,
} from "./Defilement";
import {
  ANNEAU_COULEUR_CHOISIE,
  Button,
  CocheCouleur,
  PastilleCouleur,
} from "./ui";
import type { MessagesConfigurateur } from "../messages";

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/*
 * Le nuancier d'un groupe du dessin de BASE se choisit au back-office : la
 * peau d'un humain, le pelage d'un chat (celui des cheveux lui va), une robe
 * dessinée sur le personnage, ou le nuancier d'une catégorie de pièces. Ses
 * couleurs viennent de la boutique (`nuanciersBase`, `pieceCategories`) et
 * se lisent dans l'éditeur (cf. presetsDuNuancier) — elles ne sont plus
 * écrites ici.
 */

/**
 * SVG inline (string) prêt à être injecté : recolorié + cadré (viewBox zoomé)
 * + dimensionné pour remplir la vignette. Retourne undefined si pas encore
 * chargé.
 */
function thumbSvg(
  cache: SvgCache,
  svgUrl: string | undefined,
  colors: Record<string, string>,
  viewBox: string | undefined,
  scopeUid: string,
  /**
   * Dessin en PIXELS : de quoi aller chercher son image recolorée, pour que la
   * vignette montre la même chose que l'aperçu (cf. dessinPourLEcran).
   */
  pixels?: {
    couleursImage?: CouleursImage | null;
    /** « /characters/58 » ou « /pieces/12 ». */
    chemin: string;
    assetBaseUrl?: string;
  },
): string | undefined {
  if (!svgUrl) return undefined;
  const fichier = cache.raw[svgUrl];
  if (fichier === undefined || fichier === "") return undefined;
  const raw = pixels
    ? dessinPourLEcran(
        fichier,
        colors,
        pixels.couleursImage,
        pixels.chemin,
        pixels.assetBaseUrl,
      )
    : fichier;
  // Scope CSS : sans lui, le <style> global de la dernière vignette inlinée
  // écraserait les couleurs de toutes les autres (cf. scopeSvgStyles).
  let svg = scopeSvgStyles(recolorForCharacter(raw, colors), scopeUid);
  if (viewBox) svg = withViewBox(svg, viewBox);
  // dimensionne : width/height 100%, contain, centré.
  return svg.replace(/<svg\b([^>]*)>/, (_m, attrs: string) => {
    const a = (attrs as string)
      .replace(/\swidth\s*=\s*"[^"]*"/g, "")
      .replace(/\sheight\s*=\s*"[^"]*"/g, "")
      .replace(/\sstyle\s*=\s*"[^"]*"/g, "");
    return `<svg${a} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:100%">`;
  });
}

/* -------------------------------------------------------------------------- */
/*  Petits composants UI                                                       */
/* -------------------------------------------------------------------------- */

/* Galeries horizontales : les mesures dont dépend la règle de la demi-vignette. */
const GALERIE_ESPACE = 8; // le `gap` entre deux vignettes
const GALERIE_MARGE = 2; // la marge intérieure gauche/droite du défilement
const VIGNETTE_LARGEUR = 72;
/** En dessous, un vêtement ne se reconnaît plus : on garde la largeur normale. */
const VIGNETTE_MINI = 56;

/**
 * Galerie horizontale scrollable avec flèches gauche/droite.
 *
 * Quand elle déborde, ses vignettes sont rétrécies juste ce qu'il faut pour
 * que la dernière visible soit COUPÉE EN DEUX au bord droit : c'est ce qui
 * dit au doigt qu'il peut pousser (cf. largeurDemiVignette). La largeur passe
 * par une propriété CSS que chaque vignette lit — la grille des personnages,
 * elle, garde ses cases pleine largeur (global.css).
 *
 * Les flèches, la barre et leur comportement sont ceux de toutes les listes
 * qui défilent (ZoneDefilante) : 44 px, bien visibles, et absentes quand
 * toute la galerie tient. Les anciennes faisaient 26 px et se voyaient à
 * peine (retour cliente : « penser aux vieux »).
 */
function Gallery(props: {
  children: JSX.Element;
  /** Noms des deux flèches, traduits, pour le lecteur d'écran. */
  precedent: string;
  suivant: string;
}) {
  const brancher = (el: HTMLDivElement) => {
    const mesurer = () =>
      el.style.setProperty(
        "--ml-vignette",
        `${largeurDemiVignette(
          el.clientWidth - 2 * GALERIE_MARGE,
          el.childElementCount,
          GALERIE_ESPACE,
          VIGNETTE_MINI,
          VIGNETTE_LARGEUR,
        )}px`,
      );
    mesurer();
    // La largeur dépend de l'écran, et les pièces arrivent en asynchrone :
    // une seule mesure au montage ne suffirait pas.
    const taille =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(mesurer);
    taille?.observe(el);
    const contenu = new MutationObserver(mesurer);
    contenu.observe(el, { childList: true });
    onCleanup(() => {
      taille?.disconnect();
      contenu.disconnect();
    });
  };
  return (
    <ZoneDefilante
      sens="horizontal"
      versDebut={props.precedent}
      versFin={props.suivant}
      ref={brancher}
      style={{
        display: "flex",
        gap: `${GALERIE_ESPACE}px`,
        "overflow-x": "auto",
        padding: `4px ${GALERIE_MARGE}px`,
      }}
    >
      {props.children}
    </ZoneDefilante>
  );
}

/** Vignette cliquable (contenu) avec état sélectionné. */
function Thumb(props: {
  selected: boolean;
  onClick: () => void;
  title?: string;
  children: JSX.Element;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={props.title}
      // Un choix, donc un item que le bord bas peut couper en deux.
      data-item
      style={{
        position: "relative",
        flex: "0 0 auto",
        // La galerie qui déborde rétrécit ses vignettes pour couper la
        // dernière en deux ; ailleurs (grille des personnages), c'est la
        // largeur normale.
        width: `var(--ml-vignette, ${VIGNETTE_LARGEUR}px)`,
        height: "88px",
        border: props.selected ? "2px solid #4f46e5" : "1px solid #d1d5db",
        "border-radius": "8px",
        background: "#fff",
        cursor: "pointer",
        padding: "4px",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        "box-shadow": props.selected ? "0 0 0 2px rgba(79,70,229,.2)" : "none",
        overflow: "hidden",
      }}
    >
      {props.children}
      <Show when={props.selected}>
        <span
          style={{
            position: "absolute",
            top: "2px",
            right: "2px",
            width: "16px",
            height: "16px",
            "border-radius": "9999px",
            background: "#4f46e5",
            color: "#fff",
            "font-size": "11px",
            "line-height": "16px",
            "text-align": "center",
          }}
        >
          ✓
        </span>
      </Show>
    </button>
  );
}

/** Icône "aucun" (cercle barré). */
function CrossedCircle() {
  return (
    <svg viewBox="0 0 24 24" width="36" height="36" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="#9ca3af"
        stroke-width="2"
      />
      <line x1="6" y1="18" x2="18" y2="6" stroke="#9ca3af" stroke-width="2" />
    </svg>
  );
}

/**
 * La vignette d'un personnage habillé : les mêmes couches que l'aperçu
 * (CharacterStack), dans un cadre 1:2, agrandi sur le dessin lui-même (son
 * emprise) pour qu'il remplisse la vignette comme les autres personnages.
 */
function PersonnageHabille(props: {
  character: WorkingCharacter;
  base: CharacterDTO;
  slots: SlotVariants;
  cache: SvgCache;
  assetBaseUrl?: string;
}) {
  const cadrage = () => {
    const e = props.base.emprise;
    if (!e) return undefined;
    const largeur = e.droite - e.gauche;
    const hauteur = e.bas - e.haut;
    if (!(largeur > 0 && hauteur > 0)) return undefined;
    // La vignette est un peu plus large que la moitié de sa hauteur : 1,4
    // plutôt que 0,9 côté largeur.
    const k = Math.max(1, Math.min(0.9 / hauteur, 1.4 / largeur));
    const cx = (e.gauche + e.droite) / 2;
    const cy = (e.haut + e.bas) / 2;
    return `scale(${k.toFixed(3)}) translate(${((0.5 - cx) * 100).toFixed(2)}%, ${((0.5 - cy) * 100).toFixed(2)}%)`;
  };
  return (
    <span
      style={{
        position: "relative",
        display: "block",
        height: "100%",
        "aspect-ratio": "1 / 2",
        margin: "0 auto",
        transform: cadrage(),
        "transform-origin": "50% 50%",
      }}
    >
      <CharacterStack
        character={props.character}
        base={props.base}
        slots={props.slots}
        cache={props.cache}
        assetBaseUrl={props.assetBaseUrl}
      />
    </span>
  );
}

/** Contenu d'une vignette = SVG inline (fallback texte si pas chargé). */
function SvgThumb(props: { svg: string | undefined; label: string }) {
  return (
    <Show
      when={props.svg}
      fallback={
        <span style={{ "font-size": "10px", color: "#9ca3af" }}>
          {props.label}
        </span>
      }
    >
      {(s) => (
        <span
          // eslint-disable-next-line solid/no-innerhtml
          innerHTML={s()}
          style={{ width: "100%", height: "100%", display: "block" }}
        />
      )}
    </Show>
  );
}

/**
 * « Remettre les couleurs d'origine », sous les pastilles d'une pièce ou du
 * personnage. Un lien discret plutôt qu'un bouton plein : c'est un retour en
 * arrière, pas un choix — et il n'existe que lorsqu'une couleur a changé
 * (cf. couleursChangees), si bien qu'un clic sur une pastille suffit à
 * refaire le geste : pas de confirmation.
 *
 * Un vrai <button> : il se prend au clavier (Tab, puis Entrée ou Espace) et
 * garde le contour de focus du navigateur. Le soulignement au survol et au
 * focus dit qu'il se clique ; 6 px au-dessus et au-dessous font une cible
 * d'au moins 32 px de haut sous le doigt.
 *
 * Le bouton disparaît sous le doigt dès qu'il a servi. Au clavier, le focus
 * retomberait sur la page entière, derrière la fenêtre du module : on le rend
 * à la première pastille de la même partie, celle qu'on vient de remettre.
 */
function BoutonRemise(props: {
  libelle: string;
  /** Le même libellé, l'emplacement en plus : un lecteur d'écran distingue les boutons. */
  aria: string;
  onClick: () => void;
}) {
  const [souligne, setSouligne] = createSignal(false);
  return (
    <button
      type="button"
      aria-label={props.aria}
      title={props.aria}
      onClick={(e) => {
        const partie = e.currentTarget.closest("[data-partie]");
        props.onClick();
        // Après le rendu : les rangées se redessinent avec les couleurs du
        // dessin. Les pastilles sont les seuls boutons « aria-pressed » d'une
        // partie (les vignettes des pièces n'en portent pas).
        requestAnimationFrame(() =>
          partie?.querySelector<HTMLElement>("button[aria-pressed]")?.focus(),
        );
      }}
      onMouseEnter={() => setSouligne(true)}
      onMouseLeave={() => setSouligne(false)}
      onFocus={() => setSouligne(true)}
      onBlur={() => setSouligne(false)}
      style={{
        display: "inline-block",
        "margin-top": "2px",
        padding: "6px 0",
        border: "none",
        background: "transparent",
        color: "#4f46e5",
        "font-family": "inherit",
        "font-size": "13px",
        "line-height": "20px",
        cursor: "pointer",
        "text-decoration": souligne() ? "underline" : "none",
      }}
    >
      {props.libelle}
    </button>
  );
}

/** Une rangée de pastilles : un groupe de couleurs d'une couche. */
interface LigneCouleur {
  /** Clé namespacée de la zone de référence (« clothes:st0 »). */
  zone: string;
  /** Couleur portée par la référence. */
  current: string;
  /** Nom du groupe réglé au back-office (« robe »), s'il en a un. */
  nom?: string;
  /** Les couleurs à écrire quand le client choisit `hex` : référence et nuances. */
  couleurs: (hex: string) => Record<string, string>;
  /**
   * Les pastilles de CETTE rangée, quand elles ne sont pas celles de toute la
   * couche : chaque partie d'une pièce peut avoir sa liste, réglée au
   * back-office (cf. paletteForVariant). Absentes : celles que ColorRow reçoit.
   */
  presets?: readonly string[];
}

/** Intitulé au-dessus d'une rangée (ou d'un ensemble de rangées). */
function Intitule(props: { children: JSX.Element }) {
  return (
    <span
      style={{
        display: "block",
        "font-size": "11px",
        "font-weight": "700",
        color: "#6b7280",
        "letter-spacing": ".04em",
        "margin-bottom": "8px",
      }}
    >
      {props.children}
    </span>
  );
}

/**
 * Rangée de couleurs : les pastilles de la boutique, par groupe.
 *
 * Les pastilles sont celles de la couleur du texte (cf. PastilleCouleur) :
 * mêmes 40 px, même coche sur la couleur portée.
 *
 * Plus de saisie libre (la pastille arc-en-ciel et le sélecteur du
 * navigateur) depuis le 27 octobre 2026, à la demande de la boutique : le
 * client ne choisit que parmi les couleurs qu'elle propose.
 *
 * Sans aucun nom de groupe, un seul intitulé coiffe les rangées, comme avant
 * les groupes. Dès qu'un groupe est nommé au back-office, chaque rangée porte
 * le sien : « Robe », « Ceinture » disent au client ce qu'il colore.
 *
 * <Index> et non <For> : les lignes sont recalculées à chaque couleur choisie
 * (de nouveaux objets, cf. lignes()), et <For>, qui suit les objets, refaisait
 * alors toutes les rangées à neuf — la pastille qu'on venait de choisir au
 * clavier disparaissait sous le focus, qui retombait sur la page, derrière
 * la fenêtre du module. <Index> garde chaque rangée à sa place et n'en change
 * que les couleurs : la pastille choisie garde le focus.
 */
function ColorRow(props: {
  zones: LigneCouleur[];
  presets: readonly string[];
  onSetColor: (ligne: LigneCouleur, hex: string) => void;
  /** Intitulé traduit, fourni par l'éditeur. */
  libelle: string;
  /** « Couleur actuelle : {couleur} », traduit (pastille de tête). */
  couleurActuelle: string;
}) {
  const memeCouleur = (a: string, b: string) =>
    a.toUpperCase() === b.toUpperCase();
  const nommees = () => props.zones.some((z) => !!z.nom);
  return (
    <div style={{ "margin-top": "8px" }}>
      <Show when={!nommees()}>
        <Intitule>{props.libelle}</Intitule>
      </Show>
      <Index each={props.zones}>
        {(z, rang) => {
          // Les pastilles de la rangée : les siennes (une partie réglée au
          // back-office), sinon celles de la couche.
          const presets = () => z().presets ?? props.presets;
          // Couleur hors nuancier (celle du dessin, ou choisie avant le
          // 27 octobre avec l'ancienne saisie libre) : c'est la pastille de
          // tête qui porte la coche, sinon aucune couleur ne paraîtrait choisie.
          const horsNuancier = () =>
            !presets().some((hex) => memeCouleur(hex, z().current));
          // Plusieurs rangées sans nom (une par teinte de la pièce, depuis que
          // toutes les couleurs sont proposées) : un filet les sépare. Sur un
          // téléphone, neuf pastilles tiennent sur deux lignes, et deux
          // rangées en faisaient quatre où rien ne disait où commencent les
          // manches.
          const filet = () => !nommees() && rang > 0;
          return (
            <div
              style={{
                "border-top": filet() ? "1px solid #e5e7eb" : "none",
                "padding-top": filet() ? "10px" : "0",
              }}
            >
              <Show when={nommees()}>
                <Intitule>{z().nom ?? props.libelle}</Intitule>
              </Show>
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  // 10 px : l'anneau de la couleur choisie déborde de 4 px, il
                  // ne doit pas toucher la pastille voisine ni la rangée d'en
                  // dessous.
                  gap: "10px",
                  "flex-wrap": "wrap",
                  "margin-bottom": "10px",
                }}
              >
                {/* Nuancier FERMÉ de la catégorie : la couleur que porte la
                    partie — celle du dessin, le plus souvent — n'y est pas
                    forcément. Aucune pastille ne portait alors la coche, et
                    deux rangées sans nom se ressemblaient trait pour trait
                    (« laquelle colore les manches ? »). Chaque rangée commence
                    donc par une pastille de tête, séparée des autres par un
                    filet : la couleur que porte cette partie, maintenant.
                    Cochée quand elle n'est pas du nuancier ; sinon c'est la
                    pastille du nuancier qui l'est. Toujours là, pour que les
                    rangées restent alignées d'une couleur à l'autre. Elle ne
                    se clique pas — il n'y a rien à choisir, elle l'est déjà. */}
                <span
                  role="img"
                  aria-label={props.couleurActuelle.replace("{couleur}", z().current)}
                  title={props.couleurActuelle.replace("{couleur}", z().current)}
                  data-item
                  style={{
                    flex: "0 0 auto",
                    width: "40px",
                    height: "40px",
                    "border-radius": "9999px",
                    background: z().current,
                    border: "1px solid rgba(17, 24, 39, 0.32)",
                    "box-sizing": "border-box",
                    "box-shadow": horsNuancier() ? ANNEAU_COULEUR_CHOISIE : "none",
                    display: "inline-flex",
                    "align-items": "center",
                    "justify-content": "center",
                  }}
                >
                  <Show when={horsNuancier()}>
                    <CocheCouleur fond={z().current} />
                  </Show>
                </span>
                <span
                  aria-hidden="true"
                  style={{
                    flex: "0 0 auto",
                    width: "1px",
                    height: "28px",
                    background: "#d1d5db",
                  }}
                />
                <For each={presets()}>
                  {(hex) => (
                    <PastilleCouleur
                      couleur={hex}
                      libelle={hex}
                      actif={memeCouleur(z().current, hex)}
                      onClick={() => props.onSetColor(z(), hex)}
                    />
                  )}
                </For>
              </div>
            </div>
          );
        }}
      </Index>
    </div>
  );
}

function SectionTitle(props: {
  children: JSX.Element;
  /**
   * Titre qui ouvre une nouvelle PARTIE de l'éditeur (les réglages, après le
   * choix du personnage) : un trait au-dessus l'en sépare.
   */
  partie?: boolean;
  /**
   * Titre où l'invitation à descendre peut mener : il reçoit alors le focus
   * (cf. defilerJusqua).
   */
  arrivee?: boolean;
  ref?: (el: HTMLHeadingElement) => void;
}) {
  return (
    <h4
      ref={props.ref}
      tabindex={props.arrivee ? -1 : undefined}
      style={{
        "font-size": "14px",
        "font-weight": "700",
        color: "#111827",
        margin: "16px 0 6px",
        ...(props.partie
          ? {
              "padding-top": "14px",
              "border-top": "1px solid #e5e7eb",
            }
          : {}),
        // Le focus n'y arrive que par l'invitation, jamais par tabulation : un
        // contour autour d'un titre ressemblerait à un bouton qu'on ne peut
        // pas actionner.
        ...(props.arrivee ? { outline: "none" } : {}),
      }}
    >
      {props.children}
    </h4>
  );
}

/**
 * La partie des réglages que chaque emplacement annonce dans l'invitation à
 * descendre : le haut et le pantalon ne font qu'un, « vêtements ».
 */
const PARTIE_DU_SLOT: Record<Slot, string> = {
  clothes: "vetements",
  pants: "vetements",
  hair: "cheveux",
  accessory: "accessoires",
};

/** « couleurs, vêtements et cheveux », à la manière de la langue de la page. */
function enumeration(mots: string[], locale: string): string {
  try {
    return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(mots);
  } catch {
    // Navigateur trop ancien pour `Intl.ListFormat`, ou locale inconnue : de
    // simples virgules se lisent aussi.
    return mots.join(", ");
  }
}

/* -------------------------------------------------------------------------- */
/*  Éditeur principal                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Éditeur d'un personnage (maquette client §18.2 F) : deux colonnes.
 * Gauche ~35% = prévisualisation isolée du perso composé. Droite = sections :
 * choix du personnage (galerie de bases) + nuancier peau, puis cheveux /
 * accessoires / vêtements / pantalon (galeries zoomées + nuanciers). En bas, une
 * barre collée : Retour à gauche, Valider à droite. Plus aucun placement libre.
 */
export function CharacterEditor(props: {
  character: WorkingCharacter;
  base: CharacterDTO | undefined;
  characters: CharacterDTO[];
  slots: SlotVariants;
  /** Les pièces proposées à un personnage donné : sa tenue par défaut, dans la galerie. */
  slotsDe?: (base: CharacterDTO) => SlotVariants;
  cache: SvgCache;
  /** Racine de l'API : elle sert les images recolorées des dessins en pixels. */
  assetBaseUrl?: string;
  /** Catégories de pièces et leurs nuanciers (vide = nuanciers de repli). */
  pieceCategories?: PieceCategoryDTO[];
  /** Les nuanciers des personnages réglés par la boutique (sinon ceux d'origine). */
  nuanciersBase?: NuanciersPersonnages;
  onSetAsset: (slot: Slot, variantId: string | number) => void;
  onClearSlot: (slot: Slot) => void;
  /** Couleurs choisies : clé namespacée -> couleur (un groupe entier d'un coup). */
  onSetColors: (couleurs: Record<string, string>) => void;
  /** Remet les couleurs du dessin sur une couche : un emplacement, ou la base. */
  onRemettreCouleurs: (scope: Slot | typeof BASE_COLOR_SCOPE) => void;
  onChangeCharacter: (base: CharacterDTO) => void;
  onBack: () => void;
  onValidate: () => void;
  messages: MessagesConfigurateur;
}) {
  const m = () => props.messages;
  /**
   * Les pastilles d'un groupe du dessin de base : le nuancier choisi au
   * back-office (l'un des quatre des personnages, ou celui d'une catégorie
   * de pièces), sinon `repli` — la peau pour la première couleur d'un humain,
   * les vêtements pour les autres, le pelage pour un dessin en pixels.
   */
  const presetsDuNuancier = (nuancier: Nuancier | undefined, repli: NuancierBase) =>
    couleursDuNuancier(nuancier, repli, props.nuanciersBase, props.pieceCategories);
  /** Intitulé de chaque emplacement, traduit. */
  const titreSlot = (): Record<Slot, string> => ({
    clothes: m().vetements,
    pants: m().pantalon,
    hair: m().coupes,
    accessory: m().accessoires,
  });

  // Scope CSS unique par instance d'éditeur (cf. scopeSvgStyles).
  const uid = createUniqueId();

  /* ---- Choix du personnage par catégorie -------------------------------- */
  // Clé de regroupement, jamais montrée telle quelle : la pastille affiche
  // `m().autres`, dans la langue de la page.
  const SANS_CAT = "Autres";

  /** Catégories présentes, dans l'ordre renvoyé par l'API (= ordre du BO). */
  const categories = createMemo<string[]>(() => {
    const vues: string[] = [];
    for (const c of props.characters) {
      const cat = c.category ?? SANS_CAT;
      if (!vues.includes(cat)) vues.push(cat);
    }
    return vues;
  });

  /** Catégorie du personnage actuellement sélectionné, sinon la première. */
  const categorieDuPerso = createMemo(() => {
    const actuel = props.characters.find(
      (c) => String(c.id) === String(props.character.characterId),
    );
    return actuel?.category ?? categories()[0] ?? SANS_CAT;
  });

  const [choisie, setChoisie] = createSignal<string | null>(null);
  const categorieActive = () => choisie() ?? categorieDuPerso();
  const setCategorieActive = (cat: string) => setChoisie(cat);

  const personnagesDeLaCategorie = createMemo(() =>
    props.characters.filter(
      (c) => (c.category ?? SANS_CAT) === categorieActive(),
    ),
  );

  /**
   * Le personnage tel qu'il arrive sur l'affiche, pour sa vignette : avec sa
   * tenue par défaut. Un personnage dessiné nu (Femme 6, octobre 2026)
   * s'affichait nu dans la galerie alors qu'il arrive habillé — la boutique
   * le voulait « composé ». Le personnage en cours d'édition montre sa tenue
   * du moment. `null` : pas de tenue réglée, la vignette reste le dessin seul.
   */
  const tenueDeVignette = (
    base: CharacterDTO,
  ): { character: WorkingCharacter; slots: SlotVariants } | null => {
    if (!base.defaultAssets || Object.values(base.defaultAssets).every((p) => p == null))
      return null;
    if (String(props.character.characterId) === String(base.id))
      return { character: props.character, slots: props.slots };
    const slots = props.slotsDe?.(base);
    return slots ? { character: defaultCharacter(base, 0, slots), slots } : null;
  };

  /**
   * Une rangée de pastilles par groupe de couleurs d'une couche (scope).
   * `zone` = clé NAMESPACÉE "scope:stN" de la référence du groupe (cf.
   * colorKey) : la couleur choisie ne s'applique qu'à cette couche, pas aux
   * autres qui réutilisent stN. Repli sur la clé plate (anciens paniers) puis
   * sur le défaut du dessin.
   *
   * Choisir une couleur écrit la référence ET ses nuances (ombres, reflets),
   * recalculées depuis les couleurs par défaut du dessin : c'est ce qui est
   * enregistré, puis dessiné tel quel à l'écran comme à l'impression.
   */
  const lignes = (
    scope: string,
    groupes: GroupeCouleur[],
    defauts: Record<string, string> | null | undefined,
    repli: string,
  ): LigneCouleur[] =>
    groupes.map((g) => ({
      zone: colorKey(scope, g.zone),
      current:
        props.character.colors[colorKey(scope, g.zone)] ??
        props.character.colors[g.zone] ??
        defauts?.[g.zone] ??
        repli,
      nom: g.nom,
      couleurs: (hex) => couleursDuGroupePourScope(scope, g, defauts, hex),
    }));

  /**
   * Les rangées de la pièce portée dans un emplacement : TOUTES ses familles
   * de teinte (cf. groupesProposesDeLaPiece), la plus étendue d'abord, et les
   * ombres d'une famille — reconnues à la lecture du dessin, ou cochées
   * « C'est une ombre » au back-office — suivent la couleur choisie. Le client
   * change toutes les couleurs depuis le 20 octobre 2026 : plus de règle de
   * catégorie ni de cases de la pièce pour en retirer.
   *
   * Chaque rangée porte ses pastilles : celles que la boutique a choisies pour
   * CETTE partie, sinon le nuancier de la pièce, comme avant (cf.
   * paletteForVariant).
   */
  const zonesForSlot = (slot: Slot): LigneCouleur[] => {
    const variant = findVariant(props.slots[slot], props.character.assets[slot]);
    if (!variant) return [];
    const pastilles = (rangee: { couleurs?: readonly string[] }) =>
      paletteForVariant(props.pieceCategories, variant, slot, props.nuanciersBase, rangee);
    const groupes = variant.colorZones ? groupesProposesDeLaPiece(variant) : [];
    const rangees = variant.colorZones
      ? lignes(slot, groupes, variant.colorZones, "#000000").map((ligne, i) => {
          const p = pastilles(groupes[i]!);
          return { ...ligne, presets: p.couleurs };
        })
      : [];
    // Pièce dessinée en pixels : ses familles de couleurs, comme pour un
    // personnage (cf. baseZones). L'API les envoie toutes proposées (cf.
    // avecToutesLesFamillesProposees).
    for (const f of famillesProposees(variant.couleursImage)) {
      const cle = colorKey(slot, f.cle);
      const p = pastilles(f);
      rangees.push({
        zone: cle,
        current: props.character.colors[cle] ?? f.defaut ?? f.reference,
        nom: f.nom,
        couleurs: (hex) => ({ [cle]: hex }),
        presets: p.couleurs,
      });
    }
    return rangees;
  };

  /**
   * Groupes proposés du dessin de BASE : la peau seulement, sauf réglage du
   * back-office (pelage d'un chat, robe dessinée sur le personnage…). Chacun
   * a son nuancier : celui de la peau pour le premier, sauf choix contraire.
   *
   * Un personnage dessiné en PIXELS (un chien photographié) n'a pas de zone :
   * ses rangées viennent de ses FAMILLES de couleurs, à la suite des autres.
   * Pour le client, rien ne les distingue — une rangée de pastilles sous un
   * nom, « Pelage », « Poitrail ».
   */
  const baseZones = createMemo<
    { ligne: LigneCouleur; presets: readonly string[] }[]
  >(
    () => {
      const base = props.base;
      if (!base) return [];
      const rangees: { ligne: LigneCouleur; presets: readonly string[] }[] = [];

      if (base.baseColorZones) {
        const groupes = groupesProposesDeLaBase(base);
        const tous = lignes(BASE_COLOR_SCOPE, groupes, base.baseColorZones, "#E0AC7E");
        const premier = groupesDuDessin(base.baseColorZones, base.baseGroupesCouleurs)[0];
        tous.forEach((ligne, i) => {
          const g = groupes[i]!;
          const repli: NuancierBase = g.zone === premier?.zone ? "peau" : "vetements";
          rangees.push({ ligne, presets: presetsDuNuancier(g.nuancier, repli) });
        });
      }

      for (const f of famillesProposees(base.baseCouleursImage)) {
        const cle = colorKey(BASE_COLOR_SCOPE, f.cle);
        rangees.push({
          ligne: {
            zone: cle,
            // La couleur portée : celle du client, sinon celle que la boutique
            // a réglée par défaut, sinon la teinte du fichier.
            current:
              props.character.colors[cle] ?? f.defaut ?? f.reference,
            nom: f.nom,
            // Une famille se choisit d'un seul coup : il n'y a pas de nuance à
            // écrire à côté, ce sont les PIXELS qui suivront la couleur au
            // moment du rendu (cf. couleurs-image.ts).
            couleurs: (hex) => ({ [cle]: hex }),
          },
          // Le nuancier choisi au back-office ; faute d'indication, celui des
          // cheveux, qui va au pelage d'un animal.
          presets: presetsDuNuancier(f.nuancier, "cheveux"),
        });
      }
      return rangees;
    },
  );

  /** Le client choisit une couleur : sa référence et les nuances qui la suivent. */
  const choisirCouleur = (ligne: LigneCouleur, hex: string) =>
    props.onSetColors(ligne.couleurs(hex));

  /**
   * Les couleurs d'ORIGINE d'une couche, zone par zone : celles du dessin de
   * la pièce portée (ou du dessin de base) et, pour un dessin en pixels, la
   * couleur réglée par la boutique pour chaque famille proposée, sinon la
   * teinte du fichier. C'est à elles que couleursChangees compare la
   * configuration pour savoir si le bouton de remise doit paraître.
   */
  const defautsDesFamilles = (couleursImage: CouleursImage | null | undefined) =>
    Object.fromEntries(
      famillesProposees(couleursImage).map((f) => [f.cle, f.defaut ?? f.reference]),
    );
  const defautsDuSlot = (slot: Slot): Record<string, string> => {
    const variant = findVariant(props.slots[slot], props.character.assets[slot]);
    if (!variant) return {};
    return { ...(variant.colorZones ?? {}), ...defautsDesFamilles(variant.couleursImage) };
  };
  const defautsDeLaBase = (): Record<string, string> => {
    const base = props.base;
    if (!base) return {};
    return { ...(base.baseColorZones ?? {}), ...defautsDesFamilles(base.baseCouleursImage) };
  };
  /**
   * Une couleur de cette couche a-t-elle changé ? Lue directement par le JSX,
   * sans memo figé : `props.character.colors` est un store, l'itération de
   * ses clés est réactive — le bouton paraît au premier clic sur une pastille
   * et disparaît à la remise.
   */
  const couleursChangeesDe = (scope: Slot | typeof BASE_COLOR_SCOPE): boolean =>
    couleursChangees(
      props.character.colors,
      scope,
      scope === BASE_COLOR_SCOPE ? defautsDeLaBase() : defautsDuSlot(scope),
    );

  /**
   * Y a-t-il quelque chose à régler sur ce personnage : une couleur, une
   * galerie ? Sans rien, pas de titre des réglages — il coifferait le vide.
   */
  const aDesReglages = () =>
    baseZones().length > 0 || SLOTS.some((slot) => props.slots[slot].length > 0);

  /* ---- L'invitation à descendre jusqu'aux réglages ----------------------- */
  // Le titre des réglages, la colonne de l'aperçu : où mène l'invitation, et
  // ce qui peut cacher le haut de l'écran en y arrivant.
  let titreReglages: HTMLHeadingElement | undefined;
  let colonnePerso: HTMLDivElement | undefined;
  let racine: HTMLDivElement | undefined;
  const { brancher: brancherParties, dessous, aDefile } = createPartiesDessous();

  /** Le mot de chaque partie, traduit, tel qu'il se lit dans une phrase. */
  const motDeLaPartie = (partie: string): string | undefined =>
    ({
      couleurs: m().partieCouleurs,
      vetements: m().partieVetements,
      cheveux: m().partieCheveux,
      accessoires: m().partieAccessoires,
    })[partie];

  /** « Plus bas : couleurs, cheveux, accessoires et vêtements », ou rien. */
  const libelleInvite = (): string => {
    const mots = dessous()
      .map(motDeLaPartie)
      .filter((mot): mot is string => !!mot);
    return mots.length === 0
      ? ""
      : m().plusBas.replace("{parties}", enumeration(mots, m().locale));
  };

  /**
   * Ce que l'aperçu du personnage cache en haut de la zone qui défile.
   *
   * Sur téléphone, il devient un bandeau collé AU-DESSUS des réglages : le
   * titre visé doit s'arrêter sous lui. Sur un écran large, il est collé À
   * CÔTÉ, dans sa colonne, et ne cache rien. On le lit sur la page plutôt
   * que sur la largeur de l'écran : c'est la feuille de style de l'hôte qui
   * décide du point de bascule.
   */
  const masqueHaut = (cible: HTMLElement): number => {
    if (!colonnePerso) return 0;
    const apercu = colonnePerso.getBoundingClientRect();
    const titre = cible.getBoundingClientRect();
    const auDessus = apercu.left < titre.right && apercu.right > titre.left;
    return auDessus ? apercu.height : 0;
  };

  /**
   * Un toucher de l'invitation : on descend jusqu'à la première partie
   * cachée. Si c'est la première des réglages, on vise leur titre, juste
   * au-dessus d'elle — on arrive au début, pas au milieu ; sinon, le titre de
   * la partie (« Coupes de cheveux »).
   */
  const allerAuxReglages = () => {
    const premiere = dessous()[0];
    if (!racine || !premiere) return;
    const parties = Array.from(
      racine.querySelectorAll<HTMLElement>("[data-partie]"),
    ).filter((el) => el.getBoundingClientRect().height >= 1);
    const partie = parties.find((el) => el.dataset.partie === premiere);
    if (!partie) return;
    const cible =
      (partie === parties[0] ? titreReglages : undefined) ??
      partie.querySelector<HTMLElement>("h4") ??
      partie;
    defilerJusqua(cible, masqueHaut(cible));
  };

  /** Section galerie pour un slot (cheveux/accessoire/vêtements/pantalon). */
  function SlotSection(opts: { slot: Slot; allowNone: boolean }) {
    const list = (): VariantDTO[] => props.slots[opts.slot];
    const selectedId = () => props.character.assets[opts.slot];
    // « Aucun » n'est coché que sur demande EXPLICITE (NONE_ASSET) —
    // `undefined` = couche d'origine de la base conservée, rien de coché.
    const hasNone = () => selectedId() === NONE_ASSET;
    // La zone de l'emplacement dans le cadre 500 × 1000, ramenée au repère de
    // chaque pièce (cf. cadrageDeVignette).
    const viewBox = (variant: VariantDTO) =>
      cadrageDeVignette(
        props.cache.raw[variant.svgUrl],
        SLOT_THUMB_VIEWBOX[opts.slot],
        variant.emprise,
      );
    return (
      <Show when={list().length > 0}>
        {/* Une partie des réglages : l'invitation à descendre la nomme tant
            qu'elle reste sous le bord. */}
        <div data-partie={PARTIE_DU_SLOT[opts.slot]}>
          <SectionTitle arrivee>{titreSlot()[opts.slot]}</SectionTitle>
          <Gallery precedent={m().precedent} suivant={m().suivant}>
            <Show when={opts.allowNone}>
              <Thumb
                selected={hasNone()}
                onClick={() => props.onClearSlot(opts.slot)}
                title={m().aucun}
              >
                <CrossedCircle />
              </Thumb>
            </Show>
            <For each={list()}>
              {(variant) => (
                <Thumb
                  selected={String(selectedId()) === String(variant.id)}
                  onClick={() => props.onSetAsset(opts.slot, variant.id)}
                  title={variant.name ?? `#${variant.id}`}
                >
                  <SvgThumb
                    svg={thumbSvg(
                      props.cache,
                      variant.svgUrl,
                      // La pièce portée, dans les couleurs du client ; les
                      // autres, telles qu'elles arriveront si on les touche —
                      // dans les couleurs de leur dessin, la couleur principale
                      // choisie en plus (cf. couleursAuChangementDePiece), comme
                      // sur le personnage.
                      couleursDeLaPiece(
                        String(selectedId()) === String(variant.id)
                          ? props.character.colors
                          : couleursAuChangementDePiece(
                              opts.slot,
                              props.character.colors,
                              findVariant(list(), selectedId()),
                              variant,
                              props.pieceCategories,
                              props.nuanciersBase,
                            ),
                        opts.slot,
                        variant,
                      ),
                      viewBox(variant),
                      `${uid}-${opts.slot}-${variant.id}`,
                      {
                        couleursImage: variant.couleursImage,
                        chemin: `/pieces/${variant.id}`,
                        assetBaseUrl: props.assetBaseUrl,
                      },
                    )}
                    label={variant.name ?? `#${variant.id}`}
                  />
                </Thumb>
              )}
            </For>
          </Gallery>
          <Show when={zonesForSlot(opts.slot).length > 0}>
            {(() => {
              // Nuancier de LA pièce portée : celui de sa catégorie, sinon
              // celui de l'emplacement. Une partie qui a sa liste apporte ses
              // propres pastilles (cf. zonesForSlot).
              const palette = paletteForVariant(
                props.pieceCategories,
                findVariant(props.slots[opts.slot], props.character.assets[opts.slot]),
                opts.slot,
                props.nuanciersBase,
              );
              return (
                <>
                  <ColorRow
                    libelle={m().choixCouleur}
                    couleurActuelle={m().couleurActuelle}
                    zones={zonesForSlot(opts.slot)}
                    presets={palette.couleurs}
                    onSetColor={choisirCouleur}
                  />
                  {/* Sous les pastilles, dès qu'une couleur de la pièce n'est
                      plus celle de son dessin — y compris la couleur
                      principale reportée de la pièce d'avant, qui est un vrai
                      choix du client. */}
                  <Show when={couleursChangeesDe(opts.slot)}>
                    <BoutonRemise
                      libelle={m().remettreCouleurs}
                      aria={m().remettreCouleursDe.replace(
                        "{partie}",
                        titreSlot()[opts.slot],
                      )}
                      onClick={() => props.onRemettreCouleurs(opts.slot)}
                    />
                  </Show>
                </>
              );
            })()}
          </Show>
        </div>
      </Show>
    );
  }

  return (
    <div
      class="ml-cfg-editor"
      ref={(el) => {
        racine = el;
        brancherParties(el);
      }}
    >
      {/* Titre seul : « Retour » a rejoint « Valider » dans la barre du bas.
          Collé en haut, il finissait sous l'aperçu du personnage, collé lui
          aussi, sur téléphone et tablette en portrait. */}
      <h3
        style={{
          "font-weight": "800",
          "letter-spacing": ".06em",
          "font-size": "15px",
          margin: "0 0 12px",
        }}
      >
        {m().personnalisation}
      </h3>

      {/* Deux colonnes — une seule sur mobile (cf. global.css) : à 375 px, la
          colonne des galeries ne faisait plus que ~200 px de large. */}
      <div
        class="ml-cfg-editeur"
        style={{
          display: "grid",
          "grid-template-columns": "minmax(120px, 35%) 1fr",
          gap: "16px",
          "align-items": "start",
        }}
      >
        {/* Colonne gauche : prévisualisation du perso composé */}
        <div
          ref={colonnePerso}
          class="ml-cfg-perso-col"
          style={{ position: "sticky", top: "0" }}
        >
          <div
            class="ml-cfg-perso-apercu"
            style={{
              position: "relative",
              width: "100%",
              // Même cadre que l'aperçu de l'affiche (SVG perso = viewBox 500×1000,
              // ratio 1:2) → prévisualisation 100% fidèle au rendu final.
              // La HAUTEUR est plafonnée en CSS : à ce ratio, le cadre occupait
              // deux fois la largeur de sa colonne et repoussait les galeries.
              "aspect-ratio": "1 / 2",
              background: "#f3f4f6",
              "border-radius": "10px",
              border: "1px solid #e5e7eb",
              overflow: "hidden",
            }}
          >
            <CharacterStack
              character={props.character}
              base={props.base}
              slots={props.slots}
              cache={props.cache}
              assetBaseUrl={props.assetBaseUrl}
            />
          </div>
        </div>

        {/* Colonne droite : sections.
            Plus de cale au-dessus des choix : sur téléphone, elle ouvrait un
            blanc sous le bandeau de l'aperçu, et repoussait la grille des
            personnages jusque sous la barre du bas. La grille garde sa
            demi-rangée, qui dit qu'il y a une suite dessous. */}
        <div class="ml-cfg-choix" style={{ "min-width": "0" }}>
          {/* Choix du personnage, PAR CATÉGORIE.
              Une galerie horizontale unique imposait de faire défiler les 62
              personnages pour atteindre le bon. On choisit d'abord la
              catégorie, puis le personnage dans une grille qui tient à
              l'écran. */}
          <SectionTitle>{m().choixPersonnage}</SectionTitle>

          {/* Les catégories défilent de côté quand elles ne tiennent pas sur
              une ligne : flèches et barre bien visibles (ZoneDefilante). */}
          <ZoneDefilante
            sens="horizontal"
            versDebut={m().precedent}
            versFin={m().suivant}
            class="ml-cfg-categories"
          >
            <For each={categories()}>
              {(cat) => (
                <button
                  type="button"
                  onClick={() => setCategorieActive(cat)}
                  aria-pressed={categorieActive() === cat}
                  style={{
                    flex: "0 0 auto",
                    border:
                      categorieActive() === cat
                        ? "1px solid #4f46e5"
                        : "1px solid #d1d5db",
                    background: categorieActive() === cat ? "#4f46e5" : "#fff",
                    color: categorieActive() === cat ? "#fff" : "#374151",
                    "border-radius": "9999px",
                    padding: "5px 12px",
                    "font-size": "13px",
                    "font-weight": "600",
                    cursor: "pointer",
                  }}
                >
                  {cat === SANS_CAT ? m().autres : cat}
                </button>
              )}
            </For>
          </ZoneDefilante>

          {/* La grille défile d'elle-même : sa hauteur s'arrête au MILIEU
              d'une rangée quand elle cache des personnages — une demi-tête
              au bord dit qu'il y en a d'autres dessous (cf. Defilement). À
              droite, ˄ et ˅ en grand, et la barre entre les deux. */}
          <ZoneDefilante
            sens="vertical"
            versDebut={m().defilerHaut}
            versFin={m().defilerBas}
            ref={(el) => brancherDemiRangee(el)}
            class="ml-cfg-grille-persos"
          >
            <For each={personnagesDeLaCategorie()}>
              {(base) => (
                <Thumb
                  selected={String(props.character.characterId) === String(base.id)}
                  onClick={() => props.onChangeCharacter(base)}
                  title={base.name}
                >
                  <Show
                    when={tenueDeVignette(base)}
                    fallback={
                      <SvgThumb
                        svg={thumbSvg(
                          props.cache,
                          base.baseSvgUrl,
                          // Mêmes couleurs que sur l'affiche : les défauts du
                          // back-office, et celles du client pour le sien.
                          couleursDeLaBase(
                            String(props.character.characterId) === String(base.id)
                              ? props.character.colors
                              : undefined,
                            base,
                          ),
                          undefined,
                          `${uid}-charbase-${base.id}`,
                          {
                            couleursImage: base.baseCouleursImage,
                            chemin: `/characters/${base.id}`,
                            assetBaseUrl: props.assetBaseUrl,
                          },
                        )}
                        label={base.name}
                      />
                    }
                  >
                    {(tenue) => (
                      <PersonnageHabille
                        character={tenue().character}
                        base={base}
                        slots={tenue().slots}
                        cache={props.cache}
                        assetBaseUrl={props.assetBaseUrl}
                      />
                    )}
                  </Show>
                </Thumb>
              )}
            </For>
          </ZoneDefilante>

          {/* La seconde partie de l'éditeur : tout ce qui se règle sur le
              personnage choisi. */}
          <Show when={aDesReglages()}>
            <SectionTitle
              partie
              arrivee
              ref={(el) => {
                titreReglages = el;
              }}
            >
              {m().personnaliserPerso}
            </SectionTitle>
          </Show>
          {/* Couleurs du dessin de base : la peau, et les groupes que le
              back-office propose en plus (pelage, robe dessinée…). Une
              rangée chacun, avec son propre nuancier. Ensemble, la partie
              « couleurs » de l'invitation à descendre — vide, et donc
              ignorée, sur un personnage qui n'a pas de couleur à régler. */}
          <div data-partie="couleurs">
            {/* <Index>, comme dans ColorRow : baseZones() refait ses objets à
                chaque couleur choisie, et <For> aurait refait la rangée — et
                perdu le focus de la pastille choisie au clavier. */}
            <Index each={baseZones()}>
              {(b) => (
                <ColorRow
                  libelle={m().choixCouleur}
                  couleurActuelle={m().couleurActuelle}
                  zones={[b().ligne]}
                  presets={b().presets}
                  onSetColor={choisirCouleur}
                />
              )}
            </Index>
            {/* Remet la peau (et les autres groupes de la base) aux couleurs
                du back-office, réécrites zone par zone comme au choix du
                personnage (cf. remettreCouleurs dans Configurator) : la
                commande s'imprimera comme le client l'a vue. */}
            <Show when={baseZones().length > 0 && couleursChangeesDe(BASE_COLOR_SCOPE)}>
              <BoutonRemise
                libelle={m().remettreCouleurs}
                aria={m().remettreCouleursDe.replace("{partie}", m().personnage)}
                onClick={() => props.onRemettreCouleurs(BASE_COLOR_SCOPE)}
              />
            </Show>
          </div>

          {/* L'ordre dans lequel la boutique fait composer un personnage :
              peau, cheveux, accessoires, haut, pantalon (carte Trello du
              22/10). Il ne décide que de l'ordre des réglages à l'écran ; ce
              qui passe devant quoi sur l'affiche suit SLOT_ZORDER, que ce
              changement ne touche pas. */}
          <SlotSection slot="hair" allowNone={true} />
          <SlotSection slot="accessory" allowNone={true} />
          <SlotSection slot="clothes" allowNone={false} />
          <SlotSection slot="pants" allowNone={false} />
        </div>
      </div>

      {/* Retour à gauche, Valider à droite §18.2 F — côte à côte et toujours
          à portée, comme Retour / Continuer entre les étapes (retour
          cliente). Les deux ramènent à la liste : le personnage est modifié
          au fil des choix. Seule exception, un personnage qu'on vient
          d'ajouter : Retour annule son ajout (Configurator, quitterEditeur). */}
      {/* Pas de fondu : il recouvrirait la demi-rangée de la grille, qui sert
          d'indice. À sa place, le rond ⌄ seul, suivi de ce qui attend plus
          bas (InviteADescendre). */}
      <BarreActions
        indice={false}
        invite={
          <InviteADescendre
            libelle={libelleInvite()}
            visible={!aDefile()}
            onClick={allerAuxReglages}
          />
        }
      >
        <Button variant="secondary" onClick={() => props.onBack()}>
          ‹ {m().retour}
        </Button>
        <Button variant="primary" onClick={() => props.onValidate()}>
          {m().validerPersonnage}
        </Button>
      </BarreActions>
    </div>
  );
}
