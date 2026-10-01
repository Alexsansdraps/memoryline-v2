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
  createCaleDuBord,
  InviteADescendre,
  largeurDemiVignette,
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
 */
function Gallery(props: {
  children: JSX.Element;
  /** Noms des deux flèches, traduits, pour le lecteur d'écran. */
  precedent: string;
  suivant: string;
}) {
  let scroller: HTMLDivElement | undefined;
  const scroll = (dir: number) => {
    scroller?.scrollBy({ left: dir * 180, behavior: "smooth" });
  };
  const brancher = (el: HTMLDivElement) => {
    scroller = el;
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
    <div
      style={{ position: "relative", display: "flex", "align-items": "center" }}
    >
      <button
        type="button"
        aria-label={props.precedent}
        onClick={() => scroll(-1)}
        style={arrowStyle()}
      >
        ‹
      </button>
      <div
        ref={brancher}
        style={{
          display: "flex",
          gap: `${GALERIE_ESPACE}px`,
          "overflow-x": "auto",
          "scroll-behavior": "smooth",
          padding: `4px ${GALERIE_MARGE}px`,
          flex: "1",
        }}
      >
        {props.children}
      </div>
      <button
        type="button"
        aria-label={props.suivant}
        onClick={() => scroll(1)}
        style={arrowStyle()}
      >
        ›
      </button>
    </div>
  );
}

function arrowStyle(): JSX.CSSProperties {
  return {
    flex: "0 0 auto",
    width: "26px",
    height: "26px",
    "border-radius": "9999px",
    border: "1px solid #d1d5db",
    background: "#fff",
    cursor: "pointer",
    "font-size": "18px",
    "line-height": "1",
    color: "#374151",
    margin: "0 2px",
  };
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
}) {
  const memeCouleur = (a: string, b: string) =>
    a.toUpperCase() === b.toUpperCase();
  const nommees = () => props.zones.some((z) => !!z.nom);
  return (
    <div style={{ "margin-top": "8px" }}>
      <Show when={!nommees()}>
        <Intitule>{props.libelle}</Intitule>
      </Show>
      <For each={props.zones}>
        {(z) => {
          // Couleur saisie hors nuancier : c'est la pastille arc-en-ciel qui
          // porte la coche, sinon aucune couleur ne paraîtrait choisie.
          const horsNuancier = () =>
            !props.presets.some((hex) => memeCouleur(hex, z.current));
          return (
            <div>
              <Show when={nommees()}>
                <Intitule>{z.nom ?? props.libelle}</Intitule>
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
   * focus quand l'invitation à descendre y mène (cf. InviteADescendre).
   */
  ref?: (el: HTMLHeadingElement) => void;
  partie?: boolean;
}) {
  return (
    <h4
      ref={props.ref}
      tabindex={props.partie ? -1 : undefined}
      style={{
        "font-size": "14px",
        "font-weight": "700",
        color: "#111827",
        margin: "16px 0 6px",
        ...(props.partie
          ? {
              "padding-top": "14px",
              "border-top": "1px solid #e5e7eb",
              // Le focus n'y arrive que par l'invitation, jamais par
              // tabulation : un contour autour d'un titre ressemblerait à un
              // bouton qu'on ne peut pas actionner.
              outline: "none",
            }
          : {}),
      }}
    >
      {props.children}
    </h4>
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
  /**
   * La cale qui fait tomber le bord bas de la fenêtre au milieu d'un item —
   * une vignette de vêtement, une pastille de couleur — au lieu d'une marge,
   * où la page avait l'air finie.
   */
  const { cale, brancher: brancherCale } = createCaleDuBord();
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
   * client : les petits détails décochés au back-office (ruban du chapeau…)
   * n'ont pas de rangée de pastilles, et gardent leur couleur par défaut dans
   * l'aperçu (cf. couleursDeLaPiece).
   */
  const zonesForSlot = (slot: Slot): LigneCouleur[] => {
    const variant = findVariant(props.slots[slot], props.character.assets[slot]);
    if (!variant) return [];
    const rangees = variant.colorZones
      ? lignes(slot, groupesProposesDeLaPiece(variant), variant.colorZones, "#000000")
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
  const baseZones = createMemo<{ ligne: LigneCouleur; presets: readonly string[] }[]>(
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
          const nuancier = g.nuancier ?? (g.zone === premier?.zone ? "peau" : "vetements");
          rangees.push({ ligne, presets: NUANCIERS[nuancier] });
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
          // Le nuancier des cheveux va au pelage d'un animal : c'est celui que
          // la boutique choisit au back-office, faute d'autre indication.
          presets: NUANCIERS[f.nuancier ?? "cheveux"],
        });
      }
      return rangees;
    },
  );

  /** Le client choisit une couleur : sa référence et les nuances qui la suivent. */
  const choisirCouleur = (ligne: LigneCouleur, hex: string) =>
    props.onSetColors(ligne.couleurs(hex));

  /* ---- Les réglages, et l'invitation à y descendre ----------------------- */
  /**
   * Y a-t-il quelque chose à régler sur ce personnage : une couleur, une
   * galerie ? Sans rien, ni titre ni invitation — elle mènerait au vide.
   */
  const aDesReglages = () =>
    baseZones().length > 0 || SLOTS.some((slot) => props.slots[slot].length > 0);

  /** Le titre des réglages : là où mène l'invitation à descendre. */
  const [titreReglages, setTitreReglages] = createSignal<HTMLElement>();
  let colonnePerso: HTMLDivElement | undefined;

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
        <SectionTitle>{titreSlot()[opts.slot]}</SectionTitle>
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
    <div class="ml-cfg-editor">
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
            La cale se pose ICI, au-dessus de tous les choix : ce qui suit
            descend d'un bloc, et le bord bas de la fenêtre retombe au milieu
            d'un item. Sur téléphone, elle est juste sous le bandeau collant
            de l'aperçu et disparaît dessous au premier geste. */}
        <div
          class="ml-cfg-choix"
          ref={brancherCale}
          style={{ "min-width": "0", "padding-top": `${cale()}px` }}
        >
          {/* Choix du personnage, PAR CATÉGORIE.
              Une galerie horizontale unique imposait de faire défiler les 62
              personnages pour atteindre le bon. On choisit d'abord la
              catégorie, puis le personnage dans une grille qui tient à
              l'écran. */}
          <SectionTitle>{m().choixPersonnage}</SectionTitle>

          <div class="ml-cfg-categories">
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
          </div>

          {/* La grille défile d'elle-même : sa hauteur s'arrête au MILIEU
              d'une rangée quand elle cache des personnages — une demi-tête
              au bord dit qu'il y en a d'autres dessous (cf. Defilement). */}
          <div
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
          </div>

          {/* La seconde partie de l'éditeur : tout ce qui se règle sur le
              personnage choisi. Son titre reprend mot pour mot l'invitation
              de la barre du bas — on arrive là où elle promettait de mener. */}
          <Show when={aDesReglages()}>
            <SectionTitle ref={setTitreReglages} partie>
              {m().personnaliserPerso}
            </SectionTitle>
          </Show>
          {/* Couleurs du dessin de base : la peau, et les groupes que le
              back-office propose en plus (pelage, robe dessinée…). Une
              rangée chacun, avec son propre nuancier. */}
          <For each={baseZones()}>
            {(b) => (
              <ColorRow
                libelle={m().choixCouleur}
                couleurPerso={m().couleurPerso}
                zones={[b.ligne]}
                presets={b.presets}
                libre={true}
                onSetColor={choisirCouleur}
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
      {/* Sans fondu : le bord bas tombe maintenant au milieu d'un item, et
          le fondu recouvrirait précisément la moitié qui sert d'indice.
          L'invitation, elle, se lit : tant que les réglages sont sous le
          bord, elle dit en toutes lettres qu'ils sont là, et y mène. Elle
          sautille de nouveau à chaque personnage choisi dans la grille. */}
      <BarreActions
        indice={false}
        invite={
          <Show when={aDesReglages()}>
            <InviteADescendre
              cible={titreReglages()}
              libelle={m().personnaliserPerso}
              masqueHaut={masqueHaut}
              relance={() => props.character.characterId}
            />
          </Show>
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
