/// <reference lib="dom" />
import { createStore, produce, type SetStoreFunction } from "solid-js/store";
import { createSignal, type Accessor, type Setter } from "solid-js";
import type {
  PosterConfig,
  Character,
  CouleursImage,
  EmpriseDessin,
  PersonnageAComposer,
  CouleursProposees,
  GroupeCouleur,
  PosterFormat,
  PosterView,
  PrixDuCadre,
  TextBlock,
} from "@memoryline/types";
import {
  ORDRE_CALQUES,
  BASE_COLOR_SCOPE,
  colorKey,
  couleursDuGroupePourScope,
  dessinAvecImage,
  memeCouleur,
  pastillesDeLaRangee,
  principaleDeLaPiece,
  parametreDesFamilles,
  recolorSvg,
  POLICE_TITRE_DEFAUT,
  POLICE_SOUSTITRE_DEFAUT,
  COULEUR_TEXTE_DEFAUT,
  NB_LIGNES_AFFICHE,
  lignesDuTexte,
  styleDesLignes,
  textesDepuisLignes,
  LARGEUR_CADRE_PERSONNAGE,
  composerPersonnages,
  compositionDeLaVue,
  hauteurDuDessin,
  NUANCIERS_PAR_DEFAUT,
  POSTER_VIEW_DEFAUT,
  type NuancierBase,
} from "@memoryline/types";
import {
  basDuTexteEnBas,
  placementDuMotif,
  placesTexteEnBas,
} from "./mise-en-page-motif";

/** Étapes du flow configurateur (§18.2 F). */
export const STEPS = ["background", "characters", "format"] as const;
/**
 * Les étapes d'une affiche À MOTIF (28/11, Alexandra : « Faut faire un 2.
 * texte ») : « 1. Motif et fond », « 2. Texte », « 3. Personnages »,
 * « 4. Format ». Le texte, sa place, ses polices, ses tailles et sa couleur
 * quittent l'étape du fond pour la leur. Toutes les autres affiches gardent
 * les trois étapes de STEPS.
 */
export const ETAPES_AFFICHE_A_MOTIF = ["background", "texte", "characters", "format"] as const;
export type Step = (typeof STEPS)[number] | (typeof ETAPES_AFFICHE_A_MOTIF)[number];

/* -------------------------------------------------------------------------- */
/*  Nouveau contrat API (GET /characters)                                      */
/* -------------------------------------------------------------------------- */

/** Slots de variantes génériques, partagés par tous les personnages humains. */
export const SLOTS = ["clothes", "pants", "hair", "accessory"] as const;
export type Slot = (typeof SLOTS)[number];

/**
 * Valeur sentinelle d'un slot : « aucun » EXPLICITE. À distinguer de
 * `undefined` (= on garde la couche pré-composée dans le SVG de base) :
 * "none" MASQUE aussi la couche de la base (perso sans casquette, sans
 * coupe…). Sérialisée telle quelle dans PosterConfig.assets, comprise par le
 * rendu front (CharacterStack) ET serveur (pdf.ts).
 */
export const NONE_ASSET = "none" as const;

/**
 * Une variante de slot (vêtement, pantalon, coupe, accessoire). SVG déjà
 * positionné dans le cadre 500×1000 — il se superpose tel quel à la base.
 */
export interface VariantDTO {
  id: number | string;
  slot: Slot | string;
  name: string | null;
  /** URL absolue ou /assets/… servie par l'API. */
  svgUrl: string;
  view: PosterView | string | null;
  /** Zones de couleur par défaut : { st0: "#hex", … } ou null. */
  colorZones: Record<string, string> | null;
  /**
   * Les anciennes cases « Le client peut la changer » de la pièce, telles
   * qu'en base. Plus lues depuis le 20 octobre 2026 : le client peut changer
   * toutes les couleurs (cf. groupesProposesDeLaPiece).
   */
  zonesMasquees?: string[] | null;
  /**
   * La part du dessin peinte par chaque zone (0 à 1), mesurée par l'API :
   * elle désigne la couleur principale. Absente : le premier groupe.
   */
  partsDesZones?: Record<string, number> | null;
  /**
   * Nuances réunies sous une seule rangée de pastilles (ombres, reflets d'un
   * dessin vectorisé), avec le nom affiché au-dessus. Absent = une rangée par
   * zone, comme avant.
   */
  groupesCouleurs?: GroupeCouleur[] | null;
  /**
   * Familles de couleurs, quand le dessin de la pièce est une image en pixels
   * et non un tracé. Absent = dessin vectoriel, ou rien de réglé au
   * back-office : la pièce s'affiche exactement comme son fichier.
   */
  couleursImage?: CouleursImage | null;
  position: number;
  /** Catégorie de la pièce (« Casquettes »…) : elle porte le nuancier. */
  pieceCategoryId?: number | null;
  /**
   * Où le dessin se trouve dans le cadre 500 × 1000, mesuré par l'API. Ne sert
   * qu'à cadrer la vignette d'une pièce dessinée dans un autre cadre (cf.
   * cadrageDeVignette). `null` tant qu'elle n'est pas mesurée.
   */
  emprise?: EmpriseDessin | null;
}

/**
 * Catégorie de pièces telle que le back-office la définit, avec les couleurs
 * proposées au client pour les pièces qu'elle contient.
 */
export interface PieceCategoryDTO {
  id: number;
  slug: string;
  name: string;
  slot: string;
  colors: string[];
  /**
   * L'ancienne règle « toutes les couleurs / seulement la principale ». Plus
   * lue depuis le 20 octobre 2026 : chaque pièce propose toutes ses familles
   * de teinte, ses ombres la suivent (cf. groupesProposesDeLaPiece).
   */
  couleursProposees?: CouleursProposees;
}

/** Un personnage = SVG de base pré-composé + ses zones de couleur par défaut. */
export interface CharacterDTO {
  id: number | string;
  slug: string;
  name: string;
  category: string | null;
  /**
   * L'identifiant de sa catégorie (BO › Personnages) : range sans confondre
   * deux catégories qui porteraient le même nom. Absent d'une API ancienne.
   */
  categoryId?: number | null;
  position: number;
  archived: boolean;
  /**
   * Proposé dans la galerie ? `false` : masqué au back-office, le client ne
   * peut plus l'ajouter, mais une affiche qui le porte déjà le montre
   * toujours. Absent (ancienne API) : proposé.
   */
  active?: boolean;
  /** SVG complet pré-composé (viewBox 0 0 500 1000). */
  baseSvgUrl: string;
  /** Zones de couleur par défaut de la base : { stN: "#hex" }. */
  baseColorZones: Record<string, string> | null;
  /** Groupes de couleurs du dessin de base (nuances réunies, noms, nuanciers). */
  baseGroupesCouleurs?: GroupeCouleur[] | null;
  /**
   * Zones de référence des groupes proposés au client. Absent = le premier
   * groupe seulement (la peau), la règle d'avant ce réglage.
   */
  baseZonesProposees?: string[] | null;
  /**
   * Familles de couleurs du dessin de base, quand celui-ci est une IMAGE EN
   * PIXELS (photo ou illustration enregistrée en SVG). C'est ce qui donne des
   * pastilles de couleur à un chien photographié. Absent = dessin vectoriel,
   * ou rien de réglé au back-office.
   */
  baseCouleursImage?: CouleursImage | null;
  /** Type d'affiche du perso (slug) : « front », « back », ou créé au BO. */
  orientation?: string;
  /** Bas réel du contenu dans le viewBox (0..1) pour aligner les pieds au sol. */
  bottomPct?: number;
  /**
   * Taille de CE personnage, en facteur de la largeur de référence. Un chat
   * n'occupe pas la place d'un adulte. Absent, il vaut 1 : c'est ce que
   * faisaient tous les personnages avant que ce réglage existe.
   */
  facteurTaille?: number;
  /**
   * Décalage de CÔTÉ réglé au back-office, en fraction de la largeur de
   * l'affiche. Absent, il vaut 0 : le personnage reste au centre de sa case.
   */
  decalageX?: number;
  /**
   * Variantes AUTORISÉES pour ce perso, par slot, dans l'ordre d'affichage.
   * Les nombres = `position` des VariantDTO (ids d'ancienne config), pas
   * leurs ids. null/absent = pas encore lié -> proposer toutes les variantes.
   */
  slotVariants?: Partial<Record<Slot, number[]>> | null;
  /**
   * Calage des pièces SUR CE PERSO, par slot : décalage en pourcents du cadre
   * et facteur de taille. Une coupe dessinée pour un adulte flotte au-dessus
   * d'un enfant ; ce réglage la remet en place, sans toucher au dessin.
   */
  /**
   * Clés : « hair » pour tout l'emplacement, « hair:3 » pour cette coupe-là.
   * Voir `calagePour` — le plus précis gagne.
   */
  slotAdjust?: Record<string, { dx: number; dy: number; scale: number }> | null;
  /**
   * Tenue portée d'emblée, en POSITIONS de pièces : { clothes: 3, hair: 7 }.
   * Les personnages dont la tenue est dessinée dans leur SVG de base n'en ont
   * pas besoin ; un personnage nu, si.
   */
  defaultAssets?: Partial<Record<Slot, number>> | null;
  /**
   * Où son dessin se trouve vraiment dans le cadre, mesuré par l'API. La
   * composition s'en sert pour serrer la rangée sur la largeur réelle des
   * dessins et pour reconnaître les petits. Absente (pas encore mesurée), la
   * composition fait sans, comme l'ancienne rangée.
   */
  emprise?: EmpriseDessin | null;
}

/**
 * Restreint un jeu de variantes à celles AUTORISÉES pour un perso (matching
 * par `position`, dans l'ordre du perso). Sans liste (donnée non liée), on
 * retombe sur le jeu complet ; une liste VIDE = slot sans variante (animaux).
 */
export function slotsForCharacter(
  all: SlotVariants,
  base: CharacterDTO | undefined,
): SlotVariants {
  const allowed = base?.slotVariants;
  if (!allowed) return all;
  const pick = (slot: Slot): VariantDTO[] => {
    const ids = allowed[slot];
    if (!ids) return [];
    return ids
      .map((pos) => all[slot].find((v) => v.position === pos))
      .filter((v): v is VariantDTO => v !== undefined);
  };
  return {
    clothes: pick("clothes"),
    pants: pick("pants"),
    hair: pick("hair"),
    accessory: pick("accessory"),
  };
}

/** Variantes par slot, pour une vue donnée. */
export interface SlotVariants {
  clothes: VariantDTO[];
  pants: VariantDTO[];
  hair: VariantDTO[];
  accessory: VariantDTO[];
}

/**
 * Bibliothèque de variantes : un jeu par TYPE d'affiche.
 *
 * Les clés sont les slugs des types (« front », « back », et ceux créés au
 * back-office) : la liste n'est pas connue à la compilation. Un type sans
 * pièce peut manquer, d'où la valeur possiblement absente — voir
 * `variantesDeVue()` qui rend alors une bibliothèque vide.
 */
export type SlotsDTO = Record<string, SlotVariants | undefined>;

/** Jeu de variantes d'un type d'affiche, ou un jeu vide s'il n'en a aucune. */
export function variantesDeVue(
  slots: SlotsDTO | undefined,
  vue: string | null | undefined,
): SlotVariants {
  return (
    slots?.[vue ?? "front"] ??
    slots?.["front"] ?? { clothes: [], pants: [], hair: [], accessory: [] }
  );
}

/* -------------------------------------------------------------------------- */
/*  État de travail                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Personnage de travail.
 * - `characterId` = type de personnage choisi (sa base + ses baseColorZones).
 * - `assets` = variantes choisies par slot (id), optionnelles : absent = la
 *   couche intégrée à la base est conservée ; NONE_ASSET ("none") = « aucun »
 *   explicite, la couche de la base est MASQUÉE (sans casquette, sans coupe…).
 * - `colors` = clé namespacée "scope:zone" -> hex (override des couleurs par
 *   défaut). Le scope = "base" (SVG de base) ou le slot ("clothes:st0"…) : les
 *   zones stN étant réutilisées d'une couche à l'autre, le namespacing évite
 *   qu'une couleur choisie pour un slot déteigne sur les autres (cf.
 *   colorsForScope). Les clés plates "stN" (anciens paniers) restent acceptées
 *   et s'appliquent à toutes les couches.
 * - x/y/scale/position = placement automatique sur l'affiche, sauf x/y quand
 *   `placementManuel` est vrai : le client a posé le personnage lui-même.
 */
export interface WorkingCharacter {
  characterId: string | number;
  position: number;
  x: number;
  y: number;
  scale: number;
  /**
   * Le client a déplacé ce personnage : x/y valent les siens, il ne suit plus
   * la rangée. Faux tant qu'il n'y a pas touché — c'est le rangement
   * automatique qui reste la règle.
   */
  placementManuel: boolean;
  /** slot -> variantId (optionnel). */
  assets: Partial<Record<Slot, string | number>>;
  /** "scope:zone" -> hex (scope = "base" | slot ; clés plates legacy tolérées). */
  colors: Record<string, string>;
}

/**
 * Cadre proposé en option, tel que l'API le renvoie.
 *
 * Deux suppléments, un par format : le montant à montrer se choisit avec
 * `prixDuCadreCents` (@memoryline/types), la fonction qui facture aussi.
 */
export interface CadreDTO extends PrixDuCadre {
  id: number | string;
  slug: string;
  name: string;
  previewColor?: string | null;
}

export interface ConfiguratorState {
  step: Step;
  backgroundId: string | number | undefined;
  backgroundUrl: string | undefined;
  format: PosterFormat;
  /** Type d'affiche (slug) : « front », « back », ou créé au back-office. */
  view: string;
  /** Cadre choisi, ou null si le client n'en veut pas. */
  frameId: string | number | null;
  /** Les lignes de l'affiche, dans l'ordre : toujours NB_LIGNES_AFFICHE entrées. */
  lignes: LigneTexte[];
  /** Style PARTAGÉ : la couleur et la taille valent pour toutes les lignes. */
  textStyle: { font: string; color: string; size: number };
  characters: WorkingCharacter[];
  /** index du personnage en cours d'édition, sinon null. */
  editingIndex: number | null;
  /**
   * Le motif choisi par le client, sur une affiche à motifs (28/11, stand de
   * Mulhouse) : un « personnage » du jeu de motifs du produit, hors de la
   * liste des personnages. Il part dans la configuration EN TÊTE de
   * `characters` (position 0), avec la place que lui donne la mise en page
   * (mise-en-page-motif.ts). Null partout ailleurs.
   */
  motif: WorkingCharacter | null;
  /**
   * Le texte en bas de l'affiche plutôt qu'en haut (affiche à motifs, 28/11) :
   * chaque ligne part alors avec sa place (x/y), et les personnages remontent
   * au-dessus d'elle. Faux partout ailleurs : le texte s'empile en haut.
   */
  texteEnBas: boolean;
}

const DEFAULT_TEXT_COLOR = COULEUR_TEXTE_DEFAUT; // blanc (charte affiches)
const DEFAULT_FONT = "sans-serif";
/** Taille de texte = facteur relatif (1 = défaut). Commun à toutes les lignes. */
const DEFAULT_TEXT_SIZE = 1;

/** Une ligne de l'affiche : son texte et la police qui la dessine. */
export interface LigneTexte {
  value: string;
  font: string;
  /** 27/11 : petit / moyen / grand, propre à la ligne ; absent = moyen. */
  taille?: "s" | "m" | "l";
  /**
   * La place ENREGISTRÉE de la ligne (son centre, en fractions de l'affiche),
   * relue d'une configuration — une ligne posée en bas sur une affiche à
   * motifs (28/11). Seul l'aperçu la lit (panier, commande) ; le module, lui,
   * recalcule les places à chaque changement.
   */
  x?: number;
  y?: number;
}

/**
 * Police de départ, ligne par ligne. Les deux premières reprennent celles de
 * l'ancien titre et de l'ancien sous-titre — la charte n'a pas changé, seul
 * le nombre de lignes — et la troisième suit la deuxième.
 */
const POLICES_LIGNES_DEFAUT: readonly string[] = [
  POLICE_TITRE_DEFAUT,
  POLICE_SOUSTITRE_DEFAUT,
  POLICE_SOUSTITRE_DEFAUT,
];

/** Police de départ d'une ligne, quel que soit son rang. */
export function policeDefautLigne(index: number): string {
  return POLICES_LIGNES_DEFAUT[index] ?? POLICE_SOUSTITRE_DEFAUT;
}

function lignesVides(): LigneTexte[] {
  return Array.from({ length: NB_LIGNES_AFFICHE }, (_, i) => ({
    value: "",
    font: policeDefautLigne(i),
  }));
}

function emptyState(): ConfiguratorState {
  return {
    step: "background",
    backgroundId: undefined,
    backgroundUrl: undefined,
    format: "A4",
    view: "front",
    frameId: null,
    lignes: lignesVides(),
    textStyle: {
      font: DEFAULT_FONT,
      color: DEFAULT_TEXT_COLOR,
      size: DEFAULT_TEXT_SIZE,
    },
    characters: [],
    editingIndex: null,
    motif: null,
    texteEnBas: false,
  };
}

/**
 * Construit l'état de travail depuis un PosterConfig (réouverture panier §18.3).
 *
 * `estMotif` (affiche à motifs, 28/11) : dit si un personnage de la
 * configuration est un MOTIF. Le premier qui l'est devient `motif` et sort de
 * la liste des personnages. Absent (panier, commande, toutes les autres
 * affiches) : la configuration se relit comme avant, le motif reste dans
 * `characters` et se dessine à sa place enregistrée. `texteEnBas` n'est
 * JAMAIS déduit ici : c'est le module qui le fait, pour un produit à motifs
 * seulement (une affiche IA à lignes posées rouvrirait sinon ses
 * personnages décalés).
 */
export function stateFromConfig(
  cfg: PosterConfig,
  estMotif?: (typeId: string | number) => boolean,
): ConfiguratorState {
  const base = emptyState();
  base.backgroundId = cfg.backgroundId;
  base.backgroundUrl = cfg.backgroundUrl;
  base.format = cfg.format ?? "A4";
  base.frameId = cfg.frameId ?? null;
  base.view = cfg.view ?? "front";
  // Une commande d'avant les trois lignes porte un titre et un sous-titre :
  // lignesDuTexte() les rend ici en lignes 1 et 2, sans qu'on ait à le savoir.
  // Une ligne posée garde sa place (x/y) : l'aperçu du panier la dessine là.
  base.lignes = lignesDuTexte(cfg.texts).map((bloc, i) => ({
    value: bloc?.value ?? "",
    font: bloc?.font ?? policeDefautLigne(i),
    ...(bloc?.taille && bloc.taille !== "m" ? { taille: bloc.taille } : {}),
    ...(typeof bloc?.x === "number" && typeof bloc?.y === "number"
      ? { x: bloc.x, y: bloc.y }
      : {}),
  }));
  // Style partagé, lu sur la première ligne remplie. Une couleur libre choisie
  // avant le passage aux deux pastilles est CONSERVÉE telle quelle : la
  // réécrire changerait une affiche que le client a validée.
  const src = styleDesLignes(cfg.texts);
  base.textStyle = {
    font: src?.font ?? DEFAULT_FONT,
    color: src?.color ?? DEFAULT_TEXT_COLOR,
    size: src?.size ?? DEFAULT_TEXT_SIZE,
  };
  const tous: WorkingCharacter[] = cfg.characters.map((c, i) => {
    const assets: Partial<Record<Slot, string | number>> = {};
    for (const slot of SLOTS) {
      const v = c.assets[slot];
      if (v !== undefined) assets[slot] = v;
    }
    return {
      characterId: c.typeId,
      position: c.position ?? i,
      x: c.x ?? 0.5,
      y: c.y ?? 0.5,
      scale: c.scale ?? 1,
      placementManuel: c.placementManuel === true,
      assets,
      colors: { ...(c.colors ?? {}) },
    };
  });
  // Affiche à motifs : le motif quitte la liste des personnages (il a son
  // propre choix, à l'étape du fond), couleurs comprises.
  const rangMotif = estMotif ? tous.findIndex((c) => estMotif(c.characterId)) : -1;
  if (rangMotif >= 0) base.motif = tous.splice(rangMotif, 1)[0] ?? null;
  base.characters = tous;
  return base;
}

/**
 * Largeur de référence d'un personnage (à scale=1) en fraction de la largeur
 * de l'affiche. La valeur vit dans le paquet partagé, avec la composition :
 * l'aperçu et le fichier d'impression dessinent tous deux avec elle.
 */
export const CHAR_BASE_WIDTH = LARGEUR_CADRE_PERSONNAGE;

/**
 * Placement d'un personnage sur l'affiche : le centre de son cadre et son
 * échelle, en fractions de la zone d'affiche, et son plan.
 */
export interface PlacementPersonnage {
  x: number;
  y: number;
  scale: number;
  /**
   * Rang dans l'ordre de dessin : 0 est dessiné en premier, donc derrière.
   * C'est lui qui part dans `position` — l'ordre que suit le fichier
   * d'impression pour empiler les personnages.
   */
  plan: number;
}

/** Ce que la composition lit d'un personnage de la bibliothèque. */
function aComposer(base: CharacterDTO | undefined): PersonnageAComposer {
  return {
    facteur: base?.facteurTaille,
    decalage: base?.decalageX,
    emprise: base?.emprise,
  };
}

/**
 * L'étalon de la composition : la hauteur du plus grand personnage proposé
 * pour ce type d'affiche. C'est à lui qu'on mesure qui est « petit » — un
 * enfant reste un enfant à côté de ses grands-parents, dessinés un peu moins
 * grands que les autres adultes. `null` si aucun dessin n'est encore mesuré.
 */
export function etalonDeLaVue(
  personnages: readonly CharacterDTO[],
  vue: string,
): number | null {
  let plusGrand: number | null = null;
  for (const p of personnages) {
    if (p.archived || (p.orientation ?? "front") !== vue) continue;
    const h = hauteurDuDessin(aComposer(p));
    if (h !== null && (plusGrand === null || h > plusGrand)) plusGrand = h;
  }
  return plusGrand;
}

/**
 * Hauteur du cadre d'un personnage en fraction de la HAUTEUR de l'affiche.
 *
 * Le cadre est deux fois plus haut que large et l'affiche est un portrait
 * 1:√2 : une largeur comptée en fraction de largeur devient une hauteur en
 * fraction de hauteur en la multipliant par √2 (2 ÷ √2).
 */
function hauteurCadre(scale: number): number {
  return CHAR_BASE_WIDTH * scale * Math.SQRT2;
}

function entre(valeur: number, mini: number, maxi: number): number {
  return Math.min(Math.max(valeur, mini), maxi);
}

/**
 * Ramène une position dans l'affiche : le dessin doit y tenir en entier.
 *
 * `bas` = part du cadre réellement occupée par le dessin (bottomPct). C'est
 * elle qui dit de combien le cadre a été descendu pour poser les pieds au sol,
 * donc où tombe vraiment le haut du dessin : sans elle, un animal, tout en bas
 * de son cadre, refuserait de descendre jusqu'au muret.
 */
export function bornerPlacement(
  position: { x: number; y: number },
  scale: number,
  bas: number,
): { x: number; y: number } {
  const largeur = CHAR_BASE_WIDTH * scale;
  const hauteur = hauteurCadre(scale);
  const descente = (1 - bas) * hauteur;
  return {
    x: entre(position.x, largeur / 2, 1 - largeur / 2),
    y: entre(position.y, hauteur / 2 - descente, 1 - hauteur / 2),
  };
}

/**
 * Placement final des personnages : la composition automatique (rangée de dos,
 * groupe de face — voir composition-personnages.ts, paquet types), sauf pour
 * ceux que le client a posés lui-même, qui gardent leur position.
 *
 * L'ÉCHELLE reste toujours celle de la composition, même après un
 * déplacement : glisser un personnage ne le redimensionne pas, et ajouter un
 * personnage continue de resserrer tout le monde — sinon le nouveau venu
 * rapetisserait seul, à côté de géants.
 *
 * Le module SEUL appelle cette fonction. Le panier, la commande et le fichier
 * d'impression relisent les places enregistrées par configFromState, sans
 * rien recomposer.
 */
export function placementsAffiche(
  state: Pick<ConfiguratorState, "characters" | "view">,
  personnage: (id: string | number) => CharacterDTO | undefined,
  /** Voir etalonDeLaVue ; absent, le plus grand de l'affiche en tient lieu. */
  etalon?: number | null,
): PlacementPersonnage[] {
  const places = composerPersonnages(
    state.characters.map((c) => aComposer(personnage(c.characterId))),
    compositionDeLaVue(state.view),
    etalon,
  );
  return state.characters.map((c, i) => {
    const auto = places[i]!;
    if (!c.placementManuel) return auto;
    // `bas` = bottomPct : sans lui on suppose un dessin qui remplit son cadre,
    // ce qui borne un peu plus court.
    const pose = bornerPlacement(
      c,
      auto.scale,
      personnage(c.characterId)?.bottomPct ?? 1,
    );
    return { ...auto, x: pose.x, y: pose.y };
  });
}

/** Les lignes réellement écrites, dans l'ordre (celles que l'on dessine et enregistre). */
function lignesRemplies(lignes: readonly LigneTexte[] | undefined): LigneTexte[] {
  return (lignes ?? []).filter((l) => l.value.trim() !== "");
}

/**
 * Le haut du DESSIN de chaque personnage, en fraction de la hauteur de
 * l'affiche, aux places `places` (celles de placementsAffiche) : le haut de
 * son cadre, descendu comme à l'affichage (bottomPct), plus le vide au-dessus
 * du dessin (emprise). C'est la ligne que ni le motif ni le texte d'une
 * affiche à motifs ne doivent franchir (28/11).
 */
export function hautsDesPersonnages(
  characters: readonly WorkingCharacter[],
  personnage: (id: string | number) => CharacterDTO | undefined,
  places: readonly PlacementPersonnage[],
): number[] {
  return places.map((p, i) => {
    const c = characters[i];
    const base = c ? personnage(c.characterId) : undefined;
    const h = hauteurCadre(p.scale);
    return p.y - h / 2 + (1 - (base?.bottomPct ?? 1)) * h + (base?.emprise?.haut ?? 0) * h;
  });
}

/**
 * La mise en page d'une affiche à motifs (28/11), voir mise-en-page-motif.ts :
 *   - `motif` : sa place (centre et échelle, lus comme ceux d'un personnage),
 *     ou null sans motif ;
 *   - `basDuTexte` : où s'arrête le texte quand il est EN BAS — au-dessus des
 *     têtes des personnages assis sur le muret, ou au bas de l'affiche sans
 *     personne.
 * `places` : celles de placementsAffiche ; `proportion` : hauteur ÷ largeur
 * du dessin du motif (1 tant qu'il n'est pas arrivé). L'aperçu du module et
 * la configuration enregistrée lisent ces mêmes nombres.
 */
export function miseEnPageDuMotif(
  state: Pick<ConfiguratorState, "motif" | "characters" | "lignes" | "texteEnBas">,
  personnage: (id: string | number) => CharacterDTO | undefined,
  places: readonly PlacementPersonnage[],
  proportion: number,
): { motif: { x: number; y: number; scale: number } | null; basDuTexte: number } {
  const hauts = hautsDesPersonnages(state.characters, personnage, places);
  return {
    motif: state.motif
      ? placementDuMotif({
          lignes: lignesRemplies(state.lignes),
          enBas: state.texteEnBas,
          hautsPersonnages: hauts,
          proportion,
          facteur: personnage(state.motif.characterId)?.facteurTaille,
        })
      : null,
    basDuTexte: basDuTexteEnBas(hauts),
  };
}

/** Sérialise l'état de travail vers un PosterConfig propre (schemaVersion 1). */
export function configFromState(
  state: ConfiguratorState,
  productId: string | number | undefined,
  personnage: (id: string | number) => CharacterDTO | undefined,
  etalon?: number | null,
  /** Affiche à motifs : hauteur ÷ largeur du dessin du motif (1 à défaut). */
  proportionMotif = 1,
): PosterConfig {
  const placement = placementsAffiche(state, personnage, etalon);
  const miseEnPage = miseEnPageDuMotif(state, personnage, placement, proportionMotif);
  // Le motif passe sous tous les personnages : il est dessiné le premier.
  const decalagePlan = state.motif ? 1 : 0;
  const characters: Character[] = state.characters.map((c, i) => {
    const p = placement[i] ?? { x: c.x, y: c.y, scale: c.scale, plan: c.position };
    // assets : slot -> variantId, sans les slots vides.
    const assets: Record<string, string | number> = {};
    for (const slot of SLOTS) {
      const v = c.assets[slot];
      if (v !== undefined) assets[slot] = v;
    }
    const perso: Character = {
      typeId: c.characterId,
      // L'ordre de DESSIN, et non le rang dans la liste : de face, les petits
      // passent devant les grands quel que soit leur rang. Le fichier
      // d'impression empile dans cet ordre ; le panier aussi. Derrière le
      // motif, s'il y en a un (il prend le rang 0).
      position: p.plan + decalagePlan,
      x: p.x,
      y: p.y,
      scale: p.scale,
      assets,
      colors: { ...c.colors },
    };
    // Le drapeau ne part QUE s'il a lieu d'être : une configuration sans lui se
    // range automatiquement à la réouverture, comme toutes les précédentes.
    if (c.placementManuel) perso.placementManuel = true;
    return perso;
  });
  // Le motif (affiche à motifs, 28/11) part EN TÊTE, comme un personnage sans
  // pièce : le panier, la caisse et le fichier d'impression le dessinent ainsi,
  // à la place que la mise en page lui a donnée.
  const motif = miseEnPage.motif;
  if (state.motif && motif)
    characters.unshift({
      typeId: state.motif.characterId,
      position: 0,
      x: motif.x,
      y: motif.y,
      scale: motif.scale,
      assets: {},
      colors: { ...state.motif.colors },
    });
  // Une affiche à motifs SANS personnage n'a pas de muret, comme toute
  // affiche de dos sans personne à y asseoir (28/11). Le panier et le fichier
  // d'impression posent le décor dès que la configuration porte un
  // « personnage » — et le motif en est un pour eux — et, sans décor écrit,
  // retombent sur le muret pour une vue de dos (pdf.ts, CartIsland) : la
  // configuration dit donc « pas de décor » (chaîne vide, que la fiche ne
  // remplace pas, ConfiguratorIsland) et une vue sans muret. La vue n'y sert
  // plus à rien d'autre : sans personnage, aucune pièce à choisir, et le
  // module rouvert reprend la vue de la fiche.
  const sansDecor = !!state.motif && state.characters.length === 0;
  return {
    schemaVersion: 1,
    productId,
    backgroundId: state.backgroundId,
    backgroundUrl: state.backgroundUrl,
    ...(sansDecor ? { foregroundUrl: "" } : {}),
    format: state.format,
    view: sansDecor ? POSTER_VIEW_DEFAUT : state.view,
    frameId: state.frameId,
    texts: { lines: lignesEnregistrees(state, miseEnPage.basDuTexte) },
    characters,
  };
}

/**
 * Les lignes telles qu'elles partent dans la commande : les REMPLIES, dans
 * l'ordre, et rien d'autre.
 *
 * Une ligne laissée vide ne laisse pas de trou dans la liste — l'API refuse un
 * trou (400), et le rendu ne lit de toute façon que la suite des lignes
 * remplies. La POLICE reste propre à chaque ligne ; couleur et taille sont
 * communes (charte : un seul coloris de texte sur l'affiche).
 */
function lignesEnregistrees(state: ConfiguratorState, basDuTexte: number): TextBlock[] {
  const ecrites = lignesRemplies(state.lignes);
  // Texte en bas (affiche à motifs, 28/11) : chaque ligne part avec sa place,
  // que pdf.ts sait déjà poser — le bloc s'arrête au-dessus des têtes des
  // personnages (`basDuTexte`, miseEnPageDuMotif). En haut, jamais de place :
  // l'empilement d'aujourd'hui, et la même empreinte pour toutes les
  // affiches d'avant.
  const places = state.texteEnBas ? placesTexteEnBas(ecrites, basDuTexte) : [];
  const remplies = ecrites.map((l, rang) => ({
    value: l.value,
    font: l.font,
    color: state.textStyle.color,
    size: state.textStyle.size,
    // 27/11 : la taille de la ligne n'est écrite que si elle n'est pas
    // « moyen » — une ligne d'avant garde ainsi la même empreinte.
    ...(l.taille && l.taille !== "m" ? { taille: l.taille } : {}),
    ...(places[rang] ? { x: places[rang]!.x, y: places[rang]!.y } : {}),
  }));
  // Passage par textesDepuisLignes() : c'est lui qui dit la forme enregistrée,
  // et il borne au passage le nombre de lignes.
  return (textesDepuisLignes(remplies).lines ?? []).filter(
    (b): b is TextBlock => b !== undefined,
  );
}

/**
 * Slots dans l'ordre d'empilement bas vers haut, par-dessus la base.
 *
 * Repris de l'ordre partagé et réduit à ce que le configurateur propose : une
 * seconde liste écrite à la main a fini par contredire celle de l'impression,
 * et l'affiche livrée ne ressemblait plus à l'aperçu validé.
 */
export const SLOT_ZORDER = ORDRE_CALQUES.filter((s): s is Slot =>
  (SLOTS as readonly string[]).includes(s),
);

/** Trouve une variante par id dans la liste d'un slot. */
export function findVariant(
  variants: VariantDTO[] | undefined,
  variantId: string | number | undefined,
): VariantDTO | undefined {
  if (variantId === undefined || !variants) return undefined;
  return variants.find((v) => String(v.id) === String(variantId));
}

/**
 * Crée un personnage par défaut pour une base. Aucune couleur de la BASE dans
 * `colors` : l'aperçu comme l'impression partent des couleurs par défaut du
 * back-office (couleursDeLaBase), sous le seul scope de la base — les recopier
 * ici figerait celles du jour dans le panier. Les couleurs de la base ne sont
 * surchargées que si le client en change explicitement.
 */
export function defaultCharacter(
  character: CharacterDTO,
  position: number,
  variants?: SlotVariants,
): WorkingCharacter {
  // Tenue de départ : le back-office la décrit en POSITIONS, l'état de travail
  // raisonne en identifiants de variante — on traduit ici, une fois.
  const assets: Partial<Record<Slot, string | number>> = {};
  const voulu = character.defaultAssets;
  if (voulu && variants) {
    for (const slot of SLOTS) {
      const pos = voulu[slot];
      if (pos == null) continue;
      const v = variants[slot]?.find((x) => x.position === pos);
      if (v) assets[slot] = v.id;
    }
  }
  // Couleurs par défaut des pièces portées, sous leur clé namespacée : sans
  // elles, la tenue s'afficherait dans les couleurs brutes du SVG.
  const colors: Record<string, string> = {};
  for (const slot of SLOTS) {
    const v = findVariant(variants?.[slot], assets[slot]);
    for (const [zone, hex] of Object.entries(v?.colorZones ?? {}))
      colors[colorKey(slot, zone)] = hex;
  }
  return {
    characterId: character.id,
    position,
    x: 0.5,
    y: 0.55,
    scale: 1,
    placementManuel: false,
    assets,
    colors,
  };
}

/* -------------------------------------------------------------------------- */
/*  Couleur d'un motif (affiche à motifs, 28/11)                               */
/* -------------------------------------------------------------------------- */

/**
 * Le trait sombre des motifs, tel que dessiné (.st0 des motif-*.svg) : la
 * couleur d'origine de leur silhouette, et celle que prennent leurs détails
 * sur une couleur claire. Le serveur connaît la même valeur
 * (apps/api/src/motifs-couleurs.ts).
 */
export const TRAIT_DES_MOTIFS = "#2B2B2B";

/** « #abc » ou « #aabbcc » → « #AABBCC » ; null si ce n'est pas une couleur. */
function hexa6(hex: string): string | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? m[1]!.replace(/./g, (c) => c + c) : m[1]!;
  return `#${h.toUpperCase()}`;
}

/** Une couleur très claire (les intérieurs crème #FFF8EC des motifs, un blanc). */
function tresClaire(hex: string): boolean {
  const h = hexa6(hex);
  return !!h && [1, 3, 5].every((i) => parseInt(h.slice(i, i + 2), 16) >= 0xe6);
}

/** Luminance relative d'une couleur (WCAG 2), de 0 (noir) à 1 (blanc). */
function luminance(hex: string): number {
  const h = hexa6(hex) ?? TRAIT_DES_MOTIFS;
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste (WCAG 2) entre deux couleurs, de 1 à 21. */
function contraste(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/**
 * Les couleurs d'un motif peint dans `couleur` (une couleur de la palette du
 * back-office, réglage « motifs.couleurs » — 28/11, Alexandra : « faut qu'on
 * puisse mettre des couleurs pour les images dans le BO »), sous le scope de
 * sa base :
 *   - la silhouette (.st0) prend la couleur ;
 *   - les intérieurs crème restent crème tant qu'ils se lisent mieux sur elle
 *     que le trait sombre d'origine ; sur une couleur claire (crème, or, bleu
 *     ciel…), ils passent au trait sombre — crème sur crème, le dessin
 *     disparaîtrait ;
 *   - les autres zones (les façades colorées des maisons) gardent leurs
 *     couleurs.
 * Sans couleur : {} — les couleurs du dessin.
 *
 * Écrites dans la configuration, ces couleurs sont celles que l'aperçu
 * montre, que le panier redessine et que le fichier d'impression relit
 * (recolorSvg) : rien n'est recalculé ailleurs.
 */
export function couleursDuMotif(
  base: Pick<CharacterDTO, "baseColorZones">,
  couleur: string | null | undefined,
): Record<string, string> {
  const c = couleur ? hexa6(couleur) : null;
  if (!c) return {};
  const out: Record<string, string> = { [colorKey(BASE_COLOR_SCOPE, "st0")]: c };
  for (const [zone, hex] of Object.entries(base.baseColorZones ?? {})) {
    if (zone === "st0" || !tresClaire(hex)) continue;
    const details = contraste(c, hex) >= contraste(c, TRAIT_DES_MOTIFS) ? hex : TRAIT_DES_MOTIFS;
    // Le crème qui reste crème n'est pas écrit : c'est déjà celui du dessin.
    if (hexa6(details) !== hexa6(hex)) out[colorKey(BASE_COLOR_SCOPE, zone)] = details;
  }
  return out;
}

/**
 * La couleur d'un motif, relue dans ses couleurs (un panier rouvert) : celle
 * de sa silhouette, en « #RRGGBB », ou celle de son dessin quand rien n'est
 * écrit. Une ancienne ligne « en blanc » (avant la palette) rend « #FFFFFF ».
 */
export function couleurDuMotif(
  colors: Record<string, string> | undefined,
  base?: Pick<CharacterDTO, "baseColorZones">,
): string {
  const ecrite = colors?.[colorKey(BASE_COLOR_SCOPE, "st0")];
  return (
    (ecrite ? hexa6(ecrite) : null) ??
    hexa6(base?.baseColorZones?.st0 ?? "") ??
    TRAIT_DES_MOTIFS
  );
}

/* -------------------------------------------------------------------------- */
/*  Cache de SVG bruts                                                         */
/* -------------------------------------------------------------------------- */

export interface SvgCache {
  raw: Record<string, string | undefined>;
  setRaw: SetStoreFunction<Record<string, string | undefined>>;
  loading: Accessor<Set<string>>;
  setLoading: Setter<Set<string>>;
}

export function createSvgCache(assetBaseUrl: string): {
  cache: SvgCache;
  /** Récupère (et met en cache) le SVG brut d'un asset. */
  fetchSvg: (svgUrl: string) => Promise<void>;
} {
  const [raw, setRaw] = createStore<Record<string, string | undefined>>({});
  const [loading, setLoading] = createSignal<Set<string>>(new Set());

  async function fetchSvg(svgUrl: string): Promise<void> {
    if (raw[svgUrl] !== undefined) return;
    if (loading().has(svgUrl)) return;
    setLoading((s) => new Set(s).add(svgUrl));
    try {
      const url = svgUrl.startsWith("http")
        ? svgUrl
        : assetBaseUrl.replace(/\/$/, "") + svgUrl;
      const res = await fetch(url);
      const text = await res.text();
      setRaw(svgUrl, text);
    } catch {
      setRaw(svgUrl, "");
    } finally {
      setLoading((s) => {
        const n = new Set(s);
        n.delete(svgUrl);
        return n;
      });
    }
  }

  return { cache: { raw, setRaw, loading, setLoading }, fetchSvg };
}

/* -------------------------------------------------------------------------- */
/*  Palettes de couleurs prédéfinies (miroir des nuanciers memoryline.fr)      */
/* -------------------------------------------------------------------------- */

/*
 * Les nuanciers des personnages vivent désormais dans @memoryline/types
 * (nuanciers.ts) : la boutique les règle au back-office, l'API les sert avec
 * la bibliothèque (`nuanciersBase`), et leurs couleurs d'origine sont celles
 * qui étaient écrites ici. Les mêmes noms restent exportés, pour ne rien
 * casser chez ceux qui les lisent.
 */

/** Les quatre nuanciers des personnages : ceux de la boutique, sinon ceux d'origine. */
export type NuanciersPersonnages = Partial<Record<NuancierBase, readonly string[]>>;

/** Teintes de peau (base / personnage), d'origine. */
export const SKIN_TONES = NUANCIERS_PAR_DEFAUT.peau;

/** Nuancier vêtements, d'origine. */
export const CLOTHES_TONES = NUANCIERS_PAR_DEFAUT.vetements;

/** Nuancier pantalon, d'origine. */
export const PANTS_TONES = NUANCIERS_PAR_DEFAUT.pantalon;

/** Nuancier cheveux, d'origine. */
export const HAIR_TONES = NUANCIERS_PAR_DEFAUT.cheveux;

/**
 * Nuancier de repli d'un emplacement — celui qui vivait en dur dans le code
 * avant que les catégories de pièces portent leurs propres couleurs. Ne sert
 * plus qu'aux pièces sans catégorie, ou dont la catégorie n'a aucune couleur.
 * Il suit le nuancier des personnages réglé par la boutique, quand on le
 * donne ; ses couleurs d'origine sinon.
 */
export function presetPaletteForSlot(
  slot: Slot | string,
  nuanciers?: NuanciersPersonnages | null,
): readonly string[] {
  const n: NuancierBase =
    slot === "hair" ? "cheveux" : slot === "pants" ? "pantalon" : "vetements";
  const regles = nuanciers?.[n];
  return regles && regles.length ? regles : NUANCIERS_PAR_DEFAUT[n];
}

/**
 * Nuancier d'une pièce : celui de sa catégorie, sinon celui de l'emplacement.
 * Pour une rangée (`rangee` donnée), la liste propre de cette partie passe
 * devant, quand la boutique en a composé une — sur toutes les pièces.
 *
 * `libre` dit si le client peut aussi saisir une couleur hors nuancier : oui
 * seulement en repli, jamais sur une partie qui a sa liste, ni sur un
 * accessoire. Une catégorie paramétrée au back-office ferme la liste — c'est
 * tout l'intérêt de la paramétrer. La règle elle-même vit dans
 * @memoryline/types (pastillesDeLaRangee), où elle s'essaie sans navigateur.
 * Le module ne lit plus `libre` depuis le 27 octobre 2026 : plus aucune
 * saisie libre côté client, seulement les pastilles (cf. ColorRow).
 */
export function paletteForVariant(
  categories: readonly PieceCategoryDTO[] | undefined,
  variant: VariantDTO | undefined,
  slot: Slot | string,
  nuanciers?: NuanciersPersonnages | null,
  /** La rangée (groupe de tête, ou famille d'un dessin en pixels) : sa liste propre. */
  rangee?: { couleurs?: readonly string[] } | null,
): { couleurs: readonly string[]; libre: boolean } {
  const cat = variant?.pieceCategoryId
    ? categories?.find((c) => c.id === variant.pieceCategoryId)
    : undefined;
  return pastillesDeLaRangee(
    slot,
    rangee?.couleurs,
    cat?.colors,
    presetPaletteForSlot(slot, nuanciers),
  );
}

/**
 * La couleur principale d'une pièce, celle qui passe d'une pièce à l'autre :
 * la première famille de teinte de la pièce — la plus étendue, avec ses
 * ombres (cf. principaleDeLaPiece) : un t-shirt passé au rose ne garde pas
 * des ombres vert foncé. Le client change toutes les couleurs de chaque pièce
 * depuis le 20 octobre 2026 : plus de règle de catégorie ni de cases propres
 * à la pièce pour en retirer.
 */
function rangeePrincipale(piece: VariantDTO): GroupeCouleur | undefined {
  return principaleDeLaPiece(piece);
}

/**
 * Les couleurs d'un emplacement quand le client y choisit une AUTRE pièce :
 * toutes les clés de l'emplacement (« clothes:st0 »), celles de la nouvelle
 * pièce et aucune autre.
 *
 * Chaque pièce arrive avec les couleurs de SON dessin. Les couleurs sont
 * rangées par zone, et une zone ne désigne pas la même partie d'un dessin à
 * l'autre — le corps d'un t-shirt ici, son col là. Quand elles passaient
 * d'une pièce à l'autre, un t-shirt vert s'affichait rose parce qu'on avait
 * regardé un rose avant lui, sans que le client ait rien choisi (retour
 * cliente : « les couleurs sont grave random »).
 *
 * Une seule couleur suit : celle que le client a VRAIMENT choisie pour la
 * couleur principale de la pièce qu'il quitte. Elle va sur la couleur
 * principale de la nouvelle, ombres comprises (cf. rangeePrincipale) — on
 * garde sa couleur de cheveux en changeant de coupe. Laissée à la couleur du
 * dessin, elle ne suit pas : rien n'a été choisi.
 *
 * Elle ne suit que si la boutique la propose aussi pour la couleur principale
 * de la nouvelle pièce, quand celle-ci a SA liste de couleurs (toutes les
 * pièces, depuis le 20 octobre 2026) — et, sur un ACCESSOIRE, même sans
 * liste : le nuancier de sa catégorie. Chaque partie a alors ses couleurs à
 * elle, et un doré choisi pour une monture de lunettes n'a pas à habiller un
 * bonnet que la boutique ne propose qu'en laine. La nouvelle pièce arrive
 * dans les couleurs de son dessin. Un vêtement sans liste propre reçoit la
 * couleur comme avant, même hors du nuancier de sa catégorie.
 *
 * Les vignettes de la galerie passent par ici elles aussi : chacune montre
 * la pièce telle qu'elle arrivera si on la touche.
 */
export function couleursAuChangementDePiece(
  slot: Slot,
  colors: Record<string, string>,
  ancienne: VariantDTO | undefined,
  nouvelle: VariantDTO,
  categories: readonly PieceCategoryDTO[] | undefined,
  /** Les nuanciers des personnages (repli d'un accessoire sans catégorie). */
  nuanciers?: NuanciersPersonnages | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [zone, hex] of Object.entries(nouvelle.colorZones ?? {}))
    out[colorKey(slot, zone)] = hex;

  const quittee = ancienne ? rangeePrincipale(ancienne) : undefined;
  const choisie = quittee ? colors[colorKey(slot, quittee.zone)] : undefined;
  const dessinee = quittee ? ancienne?.colorZones?.[quittee.zone] : undefined;
  if (!choisie || !dessinee || memeCouleur(choisie, dessinee)) return out;

  const cible = rangeePrincipale(nouvelle);
  const fermee = slot === "accessory" || (cible?.couleurs?.length ?? 0) > 0;
  const proposee =
    !fermee ||
    (cible !== undefined &&
      paletteForVariant(categories, nouvelle, slot, nuanciers, cible).couleurs.some((hex) =>
        memeCouleur(hex, choisie),
      ));
  if (cible && proposee)
    Object.assign(
      out,
      couleursDuGroupePourScope(slot, cible, nouvelle.colorZones, choisie),
    );
  return out;
}

/**
 * ViewBox zoomé pour les vignettes de slot (cadrage sur la partie).
 * Défini dans @memoryline/types et ré-exporté ici : le back-office s'en sert
 * aussi, les deux cadrages doivent rester identiques.
 */
export { SLOT_THUMB_VIEWBOX } from "@memoryline/types";

/** Recolorie un SVG brut avec les couleurs d'un perso (sous-ensemble des zones). */
export function recolorForCharacter(
  rawSvg: string,
  colors: Record<string, string>,
): string {
  if (!rawSvg) return rawSvg;
  return recolorSvg(rawSvg, colors);
}

/**
 * Le dessin d'une couche prêt à être affiché, quand ce dessin est une IMAGE EN
 * PIXELS (un chien photographié, un chat illustré) dont le client a changé les
 * couleurs.
 *
 * LA BOUTIQUE NE RECOLORE RIEN ELLE-MÊME. Elle remplace l'adresse de l'image
 * par celle d'une route de l'API qui rend la version recolorée. Cette image
 * est, aux octets près, celle que le fichier d'impression contiendra : les
 * deux lisent le même fichier rangé sur le serveur. Recolorer ici, sur un
 * canevas, aurait demandé de refaire le même calcul dans deux langages et deux
 * bibliothèques d'images — et un jour, l'imprimé n'aurait plus été l'aperçu.
 *
 * L'adresse porte les couleurs voulues : elle ne change que si une couleur
 * change, et le navigateur garde donc en cache tout ce qu'il a déjà montré.
 *
 * Sans famille à recolorer, le dessin est rendu tel quel : un personnage
 * vectoriel, ou un personnage en pixels que la boutique n'a pas réglé, ne fait
 * pas un aller-retour de plus.
 */
export function dessinPourLEcran(
  rawSvg: string,
  colors: Record<string, string>,
  couleursImage: CouleursImage | null | undefined,
  /** « /characters/58 » ou « /pieces/12 ». */
  chemin: string,
  assetBaseUrl: string | undefined,
): string {
  if (!rawSvg) return rawSvg;
  const parametre = parametreDesFamilles(colors, couleursImage);
  if (!parametre) return rawSvg;
  const base = (assetBaseUrl ?? "").replace(/\/$/, "");
  return dessinAvecImage(
    rawSvg,
    `${base}${chemin}/image-couleurs?c=${encodeURIComponent(parametre)}`,
  );
}

/**
 * Le cadrage de la vignette d'une pièce, dans le repère de SON fichier.
 *
 * SLOT_THUMB_VIEWBOX cadre une zone du cadre 500 × 1000 (la tête pour une
 * coupe, les jambes pour un pantalon) : juste pour les pièces dessinées dans
 * ce cadre. Une pièce dessinée dans un autre (les images 1024 × 1536 de
 * Femme 6, octobre 2026) recevait ces chiffres dans son propre repère, et sa
 * vignette tombait à côté du dessin : presque vide. Elle se cadre alors sur
 * son dessin, tel que l'API l'a mesuré, posé dans le cadre comme sur le
 * personnage (centré, sans déformation). Pas encore mesuré : tout le fichier.
 */
export function cadrageDeVignette(
  svg: string | undefined,
  standard: string,
  emprise: EmpriseDessin | null | undefined,
): string | undefined {
  const brut = svg ? /<svg\b[^>]*?\sviewBox\s*=\s*"([^"]*)"/.exec(svg)?.[1] : undefined;
  const v = brut?.trim().split(/[\s,]+/).map(Number);
  if (!v || v.length !== 4 || v.some((n) => !Number.isFinite(n)) || v[2]! <= 0 || v[3]! <= 0)
    return standard;
  const [vx, vy, vw, vh] = v as [number, number, number, number];
  if (vx === 0 && vy === 0 && vw === 500 && vh === 1000) return standard;
  if (!emprise) return undefined;
  const s = Math.min(500 / vw, 1000 / vh);
  const ox = (500 - vw * s) / 2;
  const oy = (1000 - vh * s) / 2;
  const gauche = emprise.gauche * 500;
  const haut = emprise.haut * 1000;
  const largeur = (emprise.droite - emprise.gauche) * 500;
  const hauteur = (emprise.bas - emprise.haut) * 1000;
  const marge = 0.08 * Math.max(largeur, hauteur);
  return [
    vx + (gauche - marge - ox) / s,
    vy + (haut - marge - oy) / s,
    (largeur + 2 * marge) / s,
    (hauteur + 2 * marge) / s,
  ]
    .map((n) => Number(n.toFixed(1)))
    .join(" ");
}

/**
 * Réécrit/injecte l'attribut viewBox sur la balise <svg> racine d'un SVG brut.
 * Sert au cadrage zoomé des vignettes de slot.
 */
export function withViewBox(rawSvg: string, viewBox: string): string {
  if (!rawSvg) return rawSvg;
  // <svg ... viewBox="..."> -> remplace
  if (/<svg[^>]*\sviewBox\s*=/.test(rawSvg)) {
    return rawSvg.replace(
      /(<svg[^>]*?\sviewBox\s*=\s*")[^"]*(")/,
      `$1${viewBox}$2`,
    );
  }
  // sinon, injecte juste après <svg
  return rawSvg.replace(/<svg\b/, `<svg viewBox="${viewBox}"`);
}

/* -------------------------------------------------------------------------- */
/*  Store principal                                                           */
/* -------------------------------------------------------------------------- */

export function createConfiguratorStore(initial: ConfiguratorState): {
  state: ConfiguratorState;
  setState: SetStoreFunction<ConfiguratorState>;
  mutate: (fn: (s: ConfiguratorState) => void) => void;
} {
  const [state, setState] = createStore<ConfiguratorState>(initial);
  const mutate = (fn: (s: ConfiguratorState) => void) => setState(produce(fn));
  return { state, setState, mutate };
}

export { emptyState };
