/// <reference lib="dom" />
import {
  For,
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
  couleursDeLaBase,
  couleursDeLaPiece,
  couleursDuGroupePourScope,
  estCleFamille,
  famillesProposees,
  groupesDuDessin,
  groupesProposesDeLaBase,
  groupesProposesDeLaPiece,
  scopeSvgStyles,
  type CouleursImage,
  type GroupeCouleur,
  type NuancierBase,
} from "@memoryline/types";
import {
  NONE_ASSET,
  dessinPourLEcran,
  findVariant,
  recolorForCharacter,
  withViewBox,
  paletteForVariant,
  regleDeLaPiece,
  type PieceCategoryDTO,
  CLOTHES_TONES,
  HAIR_TONES,
  PANTS_TONES,
  SKIN_TONES,
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
  createPartieALEcran,
  createToutTient,
  defilerJusqua,
  largeurDemiVignette,
  moinsDAnimations,
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

/**
 * Nuancier d'un groupe du dessin de BASE, tel que choisi au back-office : la
 * peau d'un humain, le pelage d'un chat (celui des cheveux lui va), une robe
 * dessinée sur le personnage…
 */
const NUANCIERS: Record<NuancierBase, readonly string[]> = {
  peau: SKIN_TONES,
  cheveux: HAIR_TONES,
  vetements: CLOTHES_TONES,
  pantalon: PANTS_TONES,
};

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
}

/** Intitulé au-dessus d'une rangée (ou d'un ensemble de rangées). */
function Intitule(props: {
  children: JSX.Element;
  /** Partie du sommaire qui mène ici (cf. SectionTitle). */
  ancre?: string;
}) {
  return (
    <span
      data-partie={props.ancre}
      tabindex={props.ancre === undefined ? undefined : -1}
      style={{
        display: "block",
        "font-size": "11px",
        "font-weight": "700",
        color: "#6b7280",
        "letter-spacing": ".04em",
        "margin-bottom": "8px",
        // Même règle que pour les titres : le focus n'y arrive que par le
        // sommaire, et un contour en ferait un faux bouton.
        ...(props.ancre === undefined ? {} : { outline: "none" }),
      }}
    >
      {props.children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Saisie libre sur un dessin en pixels                                       */
/* -------------------------------------------------------------------------- */

/**
 * Repos minimal entre deux couleurs envoyées depuis le SÉLECTEUR LIBRE, sur
 * une rangée de dessin en pixels.
 *
 * Le sélecteur du navigateur émet « input » en continu tant que le doigt
 * glisse — des dizaines de couleurs par seconde. Sur un dessin vectoriel,
 * c'est sans conséquence : tout se recolore dans la page. Sur un dessin en
 * PIXELS, chaque couleur est une image que le serveur calcule et range
 * (couleurs-image-fichier.ts) : un seul glissement lui en demanderait des
 * centaines, et, au stand, autant de fois trois cents kilo-octets à faire
 * descendre sur la tablette.
 *
 * On garde donc la PREMIÈRE couleur du glissement — le client voit tout de
 * suite que l'animal suit son doigt — et la DERNIÈRE, celle qu'il a vraiment
 * choisie, en laissant passer une couleur par seconde entre les deux. Les
 * pastilles du nuancier, elles, ne sont jamais retardées : un clic reste un
 * clic, et les rangées d'un dessin vectoriel ne passent pas par ici.
 *
 * UNE SECONDE, ET PAS MOINS, POUR DEUX RAISONS.
 *
 * D'abord parce qu'aller plus vite ne montre rien de plus : le serveur met
 * près d'un tiers de seconde à calculer chaque image, et il y a trois à cinq
 * cents kilo-octets à faire descendre derrière — sur le réseau d'un stand,
 * demander quatre couleurs par seconde ne fait que les mettre en file.
 * Ensuite et surtout parce que la route qui les sert compte les couleurs
 * neuves par adresse et refuse au-delà (IMAGES_MAX, configurator-routes.ts) :
 * à quatre couleurs par seconde, un client qui s'amusait quarante secondes
 * avec le sélecteur se faisait refuser — et voyait son animal disparaître.
 * MESURÉ. À une par seconde, il reste très loin sous la limite, même à
 * plusieurs derrière la même adresse. Ces deux nombres vont ensemble : en
 * changer un sans regarder l'autre remet ce piège en place.
 */
const REPOS_SELECTEUR_MS = 1000;

/**
 * Où en est le glissement de chaque rangée.
 *
 * Au niveau du module, et non dans la rangée : changer une couleur reconstruit
 * la rangée (ses lignes sont recalculées à chaque passage), une variable
 * locale repartirait donc de zéro à chaque couleur et ne retiendrait jamais
 * rien. Une entrée par rangée déjà touchée, c'est quelques dizaines d'octets.
 */
const glissements = new Map<
  string,
  { dernier: number; couleur: string; minuterie?: ReturnType<typeof setTimeout> }
>();

/** La rangée s'adresse-t-elle aux pixels d'un dessin (« base:fam0 ») ? */
function rangeeEnPixels(zone: string): boolean {
  return estCleFamille(zone.split(":").pop() ?? "");
}

/**
 * Laisse passer la couleur tout de suite, ou la met en attente — cf.
 * {@link REPOS_SELECTEUR_MS}. La dernière couleur d'un glissement finit
 * toujours par passer : c'est elle que le client garde.
 */
function couleurEspacee(
  zone: string,
  hex: string,
  envoyer: (hex: string) => void,
): void {
  const maintenant = Date.now();
  const etat = glissements.get(zone) ?? { dernier: 0, couleur: hex };
  etat.couleur = hex;
  glissements.set(zone, etat);
  const attente = REPOS_SELECTEUR_MS - (maintenant - etat.dernier);
  if (attente <= 0) {
    etat.dernier = maintenant;
    envoyer(hex);
    return;
  }
  if (etat.minuterie) return; // une couleur attend déjà : elle prendra celle-ci
  etat.minuterie = setTimeout(() => {
    etat.minuterie = undefined;
    etat.dernier = Date.now();
    envoyer(etat.couleur);
  }, attente);
}

/**
 * Rangée de couleurs : presets cliquables + saisie libre, par groupe.
 *
 * Les pastilles sont celles de la couleur du texte (cf. PastilleCouleur) :
 * mêmes 40 px, même coche sur la couleur portée.
 *
 * Sans aucun nom de groupe, un seul intitulé coiffe les rangées, comme avant
 * les groupes. Dès qu'un groupe est nommé au back-office, chaque rangée porte
 * le sien : « Robe », « Ceinture » disent au client ce qu'il colore.
 */
function ColorRow(props: {
  zones: LigneCouleur[];
  presets: readonly string[];
  /** Saisie hors nuancier autorisée ? Non dès qu'une catégorie a ses couleurs. */
  libre: boolean;
  onSetColor: (ligne: LigneCouleur, hex: string) => void;
  /** Intitulé traduit, fourni par l'éditeur. */
  libelle: string;
  /** Nom traduit de la pastille de saisie libre. */
  couleurPerso: string;
  /**
   * Partie du sommaire qui mène à cette rangée : son intitulé — le premier,
   * s'il y en a plusieurs — en devient l'arrivée.
   */
  ancre?: string;
}) {
  const memeCouleur = (a: string, b: string) =>
    a.toUpperCase() === b.toUpperCase();
  const nommees = () => props.zones.some((z) => !!z.nom);
  return (
    <div style={{ "margin-top": "8px" }}>
      <Show when={!nommees()}>
        <Intitule ancre={props.ancre}>{props.libelle}</Intitule>
      </Show>
      <For each={props.zones}>
        {(z, i) => {
          // Couleur saisie hors nuancier : c'est la pastille arc-en-ciel qui
          // porte la coche, sinon aucune couleur ne paraîtrait choisie.
          const horsNuancier = () =>
            !props.presets.some((hex) => memeCouleur(hex, z.current));
          return (
            <div>
              <Show when={nommees()}>
                <Intitule ancre={i() === 0 ? props.ancre : undefined}>
                  {z.nom ?? props.libelle}
                </Intitule>
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
                <For each={props.presets}>
                  {(hex) => (
                    <PastilleCouleur
                      couleur={hex}
                      libelle={hex}
                      actif={memeCouleur(z.current, hex)}
                      onClick={() => props.onSetColor(z, hex)}
                    />
                  )}
                </For>
                <Show when={props.libre}>
                  {/* Le sélecteur du navigateur, invisible, recouvre toute la
                      pastille : un toucher n'importe où l'ouvre, et c'est lui
                      qui renvoie la couleur. Sa propre case, minuscule et
                      différente d'un navigateur à l'autre, ne se voit plus. */}
                  <span
                    title={props.couleurPerso}
                    data-item
                    style={{
                      position: "relative",
                      flex: "0 0 auto",
                      width: "40px",
                      height: "40px",
                      "border-radius": "9999px",
                      background:
                        "conic-gradient(#ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ef4444)",
                      "box-shadow": horsNuancier() ? ANNEAU_COULEUR_CHOISIE : "none",
                      display: "inline-flex",
                      "align-items": "center",
                      "justify-content": "center",
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: "26px",
                        height: "26px",
                        "border-radius": "9999px",
                        border: "2px solid #ffffff",
                        "box-sizing": "border-box",
                        background: horsNuancier() ? z.current : "#ffffff",
                        color: "#374151",
                        "font-size": "18px",
                        "line-height": "1",
                        display: "inline-flex",
                        "align-items": "center",
                        "justify-content": "center",
                      }}
                    >
                      <Show when={horsNuancier()} fallback="+">
                        <CocheCouleur fond={z.current} />
                      </Show>
                    </span>
                    <input
                      type="color"
                      value={z.current}
                      onInput={(e) => {
                        const hex = e.currentTarget.value;
                        // Un dessin en pixels se recolore sur le serveur : on
                        // espace les couleurs d'un glissement (cf.
                        // couleurEspacee). Tout le reste passe sans délai.
                        if (rangeeEnPixels(z.zone))
                          couleurEspacee(z.zone, hex, (c) => props.onSetColor(z, c));
                        else props.onSetColor(z, hex);
                      }}
                      aria-label={props.couleurPerso}
                      style={{
                        position: "absolute",
                        top: "0",
                        left: "0",
                        width: "100%",
                        height: "100%",
                        margin: "0",
                        padding: "0",
                        border: "none",
                        opacity: "0",
                        cursor: "pointer",
                      }}
                    />
                  </span>
                </Show>
              </div>
            </div>
          );
        }}
      </For>
    </div>
  );
}

function SectionTitle(props: {
  children: JSX.Element;
  /**
   * Titre qui ouvre une nouvelle PARTIE de l'éditeur (les réglages, après le
   * choix du personnage) : un trait au-dessus l'en sépare, et il reçoit le
   * focus quand le sommaire des réglages y mène (cf. SommaireReglages).
   */
  ref?: (el: HTMLHeadingElement) => void;
  partie?: boolean;
  /**
   * Partie du sommaire dont ce titre est l'arrivée (« clothes ») : le
   * sommaire le retrouve par là, et y pose le focus.
   */
  ancre?: string;
}) {
  const arrivee = () => props.partie || props.ancre !== undefined;
  return (
    <h4
      ref={props.ref}
      data-partie={props.ancre}
      tabindex={arrivee() ? -1 : undefined}
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
        // Le focus n'y arrive que par le sommaire, jamais par tabulation : un
        // contour autour d'un titre ressemblerait à un bouton qu'on ne peut
        // pas actionner.
        ...(arrivee() ? { outline: "none" } : {}),
      }}
    >
      {props.children}
    </h4>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sommaire des réglages                                                      */
/* -------------------------------------------------------------------------- */

/** Une partie des réglages d'un personnage, telle que le sommaire la nomme. */
interface PartieReglage {
  /** « base:0 » pour une rangée du dessin de base, sinon l'emplacement. */
  cle: string;
  libelle: string;
  /** La couleur portée, pour la pastille ; rien quand la partie n'en a pas. */
  couleur: () => string | undefined;
}

/**
 * « Personnaliser : Peau · Vêtements · Pantalon · Cheveux · Accessoires » —
 * le sommaire des réglages, posé à côté de l'aperçu du personnage.
 *
 * Ni la demi-vignette au ras du bord, ni la bulle « Personnaliser ce
 * personnage » au-dessus de la barre n'ont suffi : on ne voyait toujours pas
 * qu'on pouvait descendre pour habiller son personnage (retour cliente). Ce
 * sommaire dit, dès l'arrivée, CE QUI se règle, sous des noms qu'on
 * reconnaît, et mène à chaque partie d'un toucher.
 *
 * Sur téléphone et tablette, l'aperçu est un bandeau collé en haut : le
 * sommaire prend le blanc à sa droite (global.css) et reste donc toujours à
 * l'écran, jusqu'en bas des réglages. Sur un écran large, il se range sous
 * l'aperçu, dans sa colonne collée elle aussi.
 *
 * - Une pastille par partie RÉELLEMENT proposée pour ce personnage : un
 *   animal sans vêtements n'en a pas pour les vêtements, et sans rien à
 *   régler, il n'y a pas de sommaire du tout.
 * - Chaque pastille porte la couleur actuelle de sa partie : on la retrouve
 *   sur le personnage d'à côté.
 * - La pastille de la partie à l'écran s'allume pendant qu'on fait défiler,
 *   comme dans le sommaire d'une longue page (cf. createPartieALEcran).
 * - Un vrai bouton : Tab y mène, Entrée fait descendre et pose le focus sur
 *   le titre de la partie. La partie allumée est annoncée au lecteur d'écran
 *   (`aria-current`), pas seulement montrée en couleur.
 */
function SommaireReglages(props: {
  parties: PartieReglage[];
  /** Rang de la partie à l'écran, ou `null` avant la première. */
  active: number | null;
  /** Titre court, traduit (« Personnaliser : »). */
  titre: string;
  onAller: (rang: number) => void;
}) {
  const idTitre = createUniqueId();
  // Les changements d'état restent instantanés quand l'appareil demande
  // moins d'animations.
  const transition = moinsDAnimations()
    ? "none"
    : "background-color 0.15s ease-out, border-color 0.15s ease-out, color 0.15s ease-out, box-shadow 0.15s ease-out";
  return (
    <nav
      class="ml-cfg-sommaire"
      aria-labelledby={idTitre}
      style={{
        // Valeurs d'écran large : sous l'aperçu, centré comme lui. Le bandeau
        // du téléphone les remplace (global.css).
        "margin-top": "12px",
        "min-width": "0",
        "text-align": "center",
      }}
    >
      <p
        id={idTitre}
        style={{
          margin: "0 0 6px",
          "font-size": "13px",
          "font-weight": "700",
          "line-height": "1.3",
          color: "#111827",
        }}
      >
        {props.titre}
      </p>
      {/* `role="list"` : Safari ne dit plus que c'est une liste dès qu'on
          retire ses puces, et le nombre de parties est une information. */}
      <ul
        class="ml-cfg-sommaire-liste"
        role="list"
        style={{
          display: "flex",
          "flex-wrap": "wrap",
          "justify-content": "center",
          gap: "6px",
          margin: "0",
          padding: "0",
          "list-style": "none",
        }}
      >
        <For each={props.parties}>
          {(partie, rang) => {
            const ici = () => props.active === rang();
            return (
              <li style={{ display: "flex", "max-width": "100%" }}>
                <button
                  type="button"
                  class="ml-cfg-sommaire-pastille"
                  aria-current={ici() ? "true" : undefined}
                  onClick={() => props.onAller(rang())}
                  style={{
                    display: "inline-flex",
                    "align-items": "center",
                    gap: "6px",
                    "max-width": "100%",
                    "min-height": "32px",
                    "box-sizing": "border-box",
                    padding: "5px 12px",
                    // La partie à l'écran : un cadre plus épais en plus de la
                    // teinte, pour qu'elle se distingue aussi sans les
                    // couleurs. Le second pixel est une ombre intérieure :
                    // rien ne bouge autour.
                    border: `1px solid ${ici() ? "#4f46e5" : "#d1d5db"}`,
                    "box-shadow": ici() ? "inset 0 0 0 1px #4f46e5" : "none",
                    background: ici() ? "#eef2ff" : "#ffffff",
                    color: ici() ? "#3730a3" : "#374151",
                    "border-radius": "9999px",
                    "font-family": "inherit",
                    "font-size": "13px",
                    "font-weight": "600",
                    "line-height": "1.2",
                    "text-align": "left",
                    cursor: "pointer",
                    transition,
                  }}
                >
                  <Show when={partie.couleur()}>
                    {(couleur) => (
                      <span
                        aria-hidden="true"
                        style={{
                          flex: "0 0 auto",
                          width: "12px",
                          height: "12px",
                          "border-radius": "9999px",
                          background: couleur(),
                          // Le contour des pastilles de couleur : une partie
                          // blanche se détache quand même du bouton blanc.
                          border: "1px solid rgba(17, 24, 39, 0.32)",
                          "box-sizing": "border-box",
                        }}
                      />
                    )}
                  </Show>
                  {partie.libelle}
                </button>
              </li>
            );
          }}
        </For>
      </ul>
    </nav>
  );
}

/* -------------------------------------------------------------------------- */
/*  Éditeur principal                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Éditeur d'un personnage (maquette client §18.2 F) : deux colonnes.
 * Gauche ~35% = prévisualisation isolée du perso composé. Droite = sections :
 * choix du personnage (galerie de bases) + nuancier peau, puis vêtements /
 * pantalon / cheveux / accessoires (galeries zoomées + nuanciers). En bas, une
 * barre collée : Retour à gauche, Valider à droite. Plus aucun placement libre.
 */
export function CharacterEditor(props: {
  character: WorkingCharacter;
  base: CharacterDTO | undefined;
  characters: CharacterDTO[];
  slots: SlotVariants;
  cache: SvgCache;
  /** Racine de l'API : elle sert les images recolorées des dessins en pixels. */
  assetBaseUrl?: string;
  /** Catégories de pièces et leurs nuanciers (vide = nuanciers de repli). */
  pieceCategories?: PieceCategoryDTO[];
  onSetAsset: (slot: Slot, variantId: string | number) => void;
  onClearSlot: (slot: Slot) => void;
  /** Couleurs choisies : clé namespacée -> couleur (un groupe entier d'un coup). */
  onSetColors: (couleurs: Record<string, string>) => void;
  onChangeCharacter: (base: CharacterDTO) => void;
  onBack: () => void;
  onValidate: () => void;
  messages: MessagesConfigurateur;
}) {
  const m = () => props.messages;
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
   * Groupes de la pièce portée dans un emplacement. Seuls ceux PROPOSÉS au
   * client : les petits détails (ruban du chapeau…) n'ont pas de rangée de
   * pastilles. Les cases de la pièce décident, sinon la règle de sa
   * catégorie — « seulement la couleur principale » ne garde que la plus
   * étendue (cf. groupesProposesDeLaPiece). Un détail ainsi retiré garde la
   * couleur que le configurateur a écrite en choisissant la pièce : son
   * défaut (cf. setAsset).
   */
  const zonesForSlot = (slot: Slot): LigneCouleur[] => {
    const variant = findVariant(props.slots[slot], props.character.assets[slot]);
    if (!variant) return [];
    const rangees = variant.colorZones
      ? lignes(
          slot,
          groupesProposesDeLaPiece(variant, regleDeLaPiece(props.pieceCategories, variant)),
          variant.colorZones,
          "#000000",
        )
      : [];
    // Pièce dessinée en pixels : ses familles de couleurs, comme pour un
    // personnage (cf. baseZones).
    for (const f of famillesProposees(variant.couleursImage)) {
      const cle = colorKey(slot, f.cle);
      rangees.push({
        zone: cle,
        current: props.character.colors[cle] ?? f.defaut ?? f.reference,
        nom: f.nom,
        couleurs: (hex) => ({ [cle]: hex }),
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
    { ligne: LigneCouleur; presets: readonly string[]; nuancier: NuancierBase }[]
  >(
    () => {
      const base = props.base;
      if (!base) return [];
      const rangees: {
        ligne: LigneCouleur;
        presets: readonly string[];
        /** Le nuancier proposé : « peau » nomme la pastille du sommaire. */
        nuancier: NuancierBase;
      }[] = [];

      if (base.baseColorZones) {
        const groupes = groupesProposesDeLaBase(base);
        const tous = lignes(BASE_COLOR_SCOPE, groupes, base.baseColorZones, "#E0AC7E");
        const premier = groupesDuDessin(base.baseColorZones, base.baseGroupesCouleurs)[0];
        tous.forEach((ligne, i) => {
          const g = groupes[i]!;
          const nuancier = g.nuancier ?? (g.zone === premier?.zone ? "peau" : "vetements");
          rangees.push({ ligne, presets: NUANCIERS[nuancier], nuancier });
        });
      }

      for (const f of famillesProposees(base.baseCouleursImage)) {
        const cle = colorKey(BASE_COLOR_SCOPE, f.cle);
        const nuancier = f.nuancier ?? "cheveux";
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
          // Le nuancier des cheveux va au pelage d'un animal : c'est celui que
          // la boutique choisit au back-office, faute d'autre indication.
          presets: NUANCIERS[nuancier],
          nuancier,
        });
      }
      return rangees;
    },
  );

  /** Le client choisit une couleur : sa référence et les nuances qui la suivent. */
  const choisirCouleur = (ligne: LigneCouleur, hex: string) =>
    props.onSetColors(ligne.couleurs(hex));

  /* ---- Les réglages, et leur sommaire ------------------------------------ */
  /**
   * Les parties à régler sur ce personnage, dans l'ordre de la page : les
   * couleurs de son dessin, puis chaque galerie qu'il a.
   *
   * Une rangée du dessin porte le nom que lui donne le back-office (« Robe »,
   * « Pelage »), comme au-dessus de ses pastilles. Sans nom, la peau se dit
   * « Peau » : c'est elle que propose le nuancier de la peau, celui qu'un
   * personnage reçoit d'office — mais seulement chez un personnage qu'on
   * habille. Sans aucune galerie, c'est un animal, le plus souvent, que le
   * back-office n'a pas encore réglé : sa rangée est un pelage, « Peau »
   * mentirait, et elle se dit « Couleur ».
   *
   * Une galerie reprend son titre mot pour mot — on reconnaît en arrivant
   * l'endroit promis —, sauf les « Coupes de cheveux », qui deviennent
   * « Cheveux » : à 320 px de large, le nom entier prenait une rangée à lui
   * seul, et les pastilles débordaient de l'aperçu.
   *
   * Changer une couleur ne change pas les parties : la liste reste la même
   * (`equals`), les pastilles restent en place et seule leur couleur suit.
   */
  const parties = createMemo<PartieReglage[]>(
    () => {
      const habille = SLOTS.some((slot) => props.slots[slot].length > 0);
      const liste: PartieReglage[] = baseZones().map((b, i) => ({
        cle: `base:${i}`,
        libelle:
          b.ligne.nom ??
          (b.nuancier === "peau" && habille
            ? m().sommairePeau
            : m().sommaireCouleur),
        couleur: () => baseZones()[i]?.ligne.current,
      }));
      for (const slot of SLOTS) {
        if (props.slots[slot].length === 0) continue;
        liste.push({
          cle: slot,
          libelle: slot === "hair" ? m().sommaireCheveux : titreSlot()[slot],
          // La première rangée de la pièce portée ; aucune pour « Aucun » ou
          // la couche d'origine du dessin, qui n'ont pas de pastilles.
          couleur: () => zonesForSlot(slot)[0]?.current,
        });
      }
      // Deux rangées sans nom ne font pas deux pastilles identiques.
      const vus = new Map<string, number>();
      for (const p of liste) {
        const n = (vus.get(p.libelle) ?? 0) + 1;
        vus.set(p.libelle, n);
        if (n > 1) p.libelle = `${p.libelle} ${n}`;
      }
      return liste;
    },
    [],
    {
      equals: (a, b) =>
        a.length === b.length &&
        a.every((p, i) => p.cle === b[i]?.cle && p.libelle === b[i]?.libelle),
    },
  );

  /**
   * Y a-t-il quelque chose à régler sur ce personnage : une couleur, une
   * galerie ? Sans rien, ni titre ni sommaire — il mènerait au vide.
   */
  const aDesReglages = () => parties().length > 0;

  /** Le titre des réglages : là où mène la première pastille du sommaire. */
  const [titreReglages, setTitreReglages] = createSignal<HTMLElement>();
  let colonnePerso: HTMLDivElement | undefined;
  let colonneChoix: HTMLDivElement | undefined;
  let racine: HTMLDivElement | undefined;

  /**
   * Ce que l'aperçu du personnage cache en haut de la zone qui défile.
   *
   * Sur téléphone, il devient un bandeau collé AU-DESSUS des réglages : le
   * titre visé doit s'arrêter sous lui. Sur un écran large, il est collé À
   * CÔTÉ, dans sa colonne, et ne cache rien. On le lit sur la page plutôt
   * que sur la largeur de l'écran : c'est la feuille de style de l'hôte qui
   * décide du point de bascule.
   */
  const masqueHaut = (): number => {
    const titre = titreReglages();
    if (!colonnePerso || !titre) return 0;
    const apercu = colonnePerso.getBoundingClientRect();
    const reglages = titre.getBoundingClientRect();
    const auDessus = apercu.left < reglages.right && apercu.right > reglages.left;
    return auDessus ? apercu.height : 0;
  };

  /**
   * Le titre où mène chaque pastille. La première mène au titre des réglages
   * lui-même, juste au-dessus de sa rangée : on arrive au début de la partie,
   * pas au milieu ; les suivantes, à leur propre titre (`data-partie`).
   */
  const ancres = (): (HTMLElement | undefined)[] =>
    parties().map((p, rang) =>
      rang === 0
        ? titreReglages()
        : (colonneChoix?.querySelector<HTMLElement>(`[data-partie="${p.cle}"]`) ??
          undefined),
    );

  /**
   * La partie à l'écran. On lit sous le bandeau de l'aperçu sur téléphone ;
   * sur un écran large, depuis le haut de la colonne de l'aperçu, qui colle
   * au haut de la fenêtre dès qu'on défile. On lit jusqu'à la barre du bas.
   */
  const suivi = createPartieALEcran({
    ancres,
    hautLecture: () => {
      if (!colonnePerso) return 0;
      const apercu = colonnePerso.getBoundingClientRect();
      return masqueHaut() > 0 ? apercu.bottom : apercu.top;
    },
    basLecture: () =>
      racine?.querySelector(".ml-cfg-pied")?.getBoundingClientRect().top ??
      window.innerHeight,
  });

  /**
   * Tout tient-il à l'écran ? Alors le sommaire n'apporte rien : sur un
   * grand écran, tous les réglages se voient déjà à côté de l'aperçu.
   */
  const { toutTient, brancher: brancherToutTient } = createToutTient();
  const sommaireVisible = () => aDesReglages() && !toutTient();

  /**
   * Un toucher du sommaire : on descend jusqu'à la partie, focus compris, et
   * sa pastille reste allumée pendant le voyage.
   */
  const allerA = (rang: number) => {
    const cible = ancres()[rang];
    if (cible) suivi.designer(rang, defilerJusqua(cible, masqueHaut()));
  };

  /** Section galerie pour un slot (vêtements/pantalon/cheveux/accessoire). */
  function SlotSection(opts: { slot: Slot; allowNone: boolean }) {
    const list = (): VariantDTO[] => props.slots[opts.slot];
    const selectedId = () => props.character.assets[opts.slot];
    // « Aucun » n'est coché que sur demande EXPLICITE (NONE_ASSET) —
    // `undefined` = couche d'origine de la base conservée, rien de coché.
    const hasNone = () => selectedId() === NONE_ASSET;
    const viewBox = SLOT_THUMB_VIEWBOX[opts.slot];
    return (
      <Show when={list().length > 0}>
        <SectionTitle ancre={opts.slot}>{titreSlot()[opts.slot]}</SectionTitle>
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
                    // Seules les couleurs de CE slot : les zones stN étant
                    // partagées entre couches, la map complète recolorerait
                    // aussi ces vignettes quand on change une autre couche.
                    // Les zones non proposées de CETTE pièce restent à leur
                    // défaut, comme sur le personnage.
                    couleursDeLaPiece(props.character.colors, opts.slot, variant),
                    viewBox,
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
            // celui de l'emplacement (et alors la saisie libre reste ouverte).
            const palette = paletteForVariant(
              props.pieceCategories,
              findVariant(props.slots[opts.slot], props.character.assets[opts.slot]),
              opts.slot,
            );
            return (
              <ColorRow
                libelle={m().choixCouleur}
                couleurPerso={m().couleurPerso}
                zones={zonesForSlot(opts.slot)}
                presets={palette.couleurs}
                libre={palette.libre}
                onSetColor={choisirCouleur}
              />
            );
          })()}
        </Show>
      </Show>
    );
  }

  return (
    <div ref={racine} class="ml-cfg-editor">
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
          {/* À droite de l'aperçu sur téléphone et tablette, dessous sur un
              écran large : collé avec lui, il reste à l'écran jusqu'en bas
              des réglages. */}
          <Show when={sommaireVisible()}>
            <SommaireReglages
              parties={parties()}
              active={suivi.active()}
              titre={m().sommaireTitre}
              onAller={allerA}
            />
          </Show>
        </div>

        {/* Colonne droite : sections.
            Plus de cale au-dessus des choix : sur téléphone, elle ouvrait un
            blanc sous le bandeau de l'aperçu, et repoussait la grille des
            personnages jusque sous la barre du bas. C'est le sommaire qui dit
            maintenant que les réglages attendent dessous, et la grille garde
            sa demi-rangée. */}
        <div
          class="ml-cfg-choix"
          ref={(el) => {
            colonneChoix = el;
            brancherToutTient(el);
          }}
          style={{ "min-width": "0" }}
        >
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
                </Thumb>
              )}
            </For>
          </ZoneDefilante>

          {/* La seconde partie de l'éditeur : tout ce qui se règle sur le
              personnage choisi. La première pastille du sommaire mène à ce
              titre, les suivantes à celui de leur partie. */}
          <Show when={aDesReglages()}>
            <SectionTitle ref={setTitreReglages} partie>
              {m().personnaliserPerso}
            </SectionTitle>
          </Show>
          {/* Couleurs du dessin de base : la peau, et les groupes que le
              back-office propose en plus (pelage, robe dessinée…). Une
              rangée chacun, avec son propre nuancier. La première est juste
              sous le titre des réglages, où mène déjà sa pastille ; les
              suivantes sont l'arrivée de la leur. */}
          <For each={baseZones()}>
            {(b, i) => (
              <ColorRow
                libelle={m().choixCouleur}
                couleurPerso={m().couleurPerso}
                zones={[b.ligne]}
                presets={b.presets}
                libre={true}
                onSetColor={choisirCouleur}
                ancre={i() === 0 ? undefined : `base:${i()}`}
              />
            )}
          </For>

          <SlotSection slot="clothes" allowNone={false} />
          <SlotSection slot="pants" allowNone={false} />
          <SlotSection slot="hair" allowNone={true} />
          <SlotSection slot="accessory" allowNone={true} />
        </div>
      </div>

      {/* Retour à gauche, Valider à droite §18.2 F — côte à côte et toujours
          à portée, comme Retour / Continuer entre les étapes (retour
          cliente). Les deux ramènent à la liste : le personnage est modifié
          au fil des choix, il n'y a rien à annuler. */}
      {/* Sans fondu : il recouvrirait la demi-rangée de la grille, qui sert
          d'indice. Plus de bulle « Personnaliser ce personnage » au-dessus de
          la barre non plus : le sommaire, à côté de l'aperçu, dit la même
          chose en mieux (cf. Defilement.tsx). */}
      <BarreActions indice={false}>
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
