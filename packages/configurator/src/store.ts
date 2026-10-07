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
  colorKey,
  couleursDuGroupePourScope,
  dessinAvecImage,
  groupePrincipal,
  groupesProposesDeLaPiece,
  memeCouleur,
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
} from "@memoryline/types";

/** Étapes du flow configurateur (§18.2 F). */
export const STEPS = ["background", "characters", "format"] as const;
export type Step = (typeof STEPS)[number];

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
   * Zones que le client ne recolore pas (petits détails : ruban, élastique…),
   * décochées au back-office. Pas de pastilles pour elles, et elles gardent
   * leur couleur par défaut (cf. couleursDeLaPiece). Une liste, même vide,
   * est le réglage de la pièce ; `null` ou absent : la pièce suit celui de sa
   * catégorie (`PieceCategoryDTO.couleursProposees`).
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
   * Couleurs proposées pour chaque pièce sans réglage propre : toutes, ou la
   * principale seule (le ruban d'un chapeau garde alors sa couleur). Absent :
   * toutes, la règle d'avant ce réglage.
   */
  couleursProposees?: CouleursProposees;
}

/** Un personnage = SVG de base pré-composé + ses zones de couleur par défaut. */
export interface CharacterDTO {
  id: number | string;
  slug: string;
  name: string;
  category: string | null;
  position: number;
  archived: boolean;
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
}

const DEFAULT_TEXT_COLOR = COULEUR_TEXTE_DEFAUT; // blanc (charte affiches)
const DEFAULT_FONT = "sans-serif";
/** Taille de texte = facteur relatif (1 = défaut). Commun à toutes les lignes. */
const DEFAULT_TEXT_SIZE = 1;

/** Une ligne de l'affiche : son texte et la police qui la dessine. */
export interface LigneTexte {
  value: string;
  font: string;
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
  };
}

/** Construit l'état de travail depuis un PosterConfig (réouverture panier §18.3). */
export function stateFromConfig(cfg: PosterConfig): ConfiguratorState {
  const base = emptyState();
  base.backgroundId = cfg.backgroundId;
  base.backgroundUrl = cfg.backgroundUrl;
  base.format = cfg.format ?? "A4";
  base.frameId = cfg.frameId ?? null;
  base.view = cfg.view ?? "front";
  // Une commande d'avant les trois lignes porte un titre et un sous-titre :
  // lignesDuTexte() les rend ici en lignes 1 et 2, sans qu'on ait à le savoir.
  base.lignes = lignesDuTexte(cfg.texts).map((bloc, i) => ({
    value: bloc?.value ?? "",
    font: bloc?.font ?? policeDefautLigne(i),
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
  base.characters = cfg.characters.map((c, i) => {
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

/** Sérialise l'état de travail vers un PosterConfig propre (schemaVersion 1). */
export function configFromState(
  state: ConfiguratorState,
  productId: string | number | undefined,
  personnage: (id: string | number) => CharacterDTO | undefined,
  etalon?: number | null,
): PosterConfig {
  const placement = placementsAffiche(state, personnage, etalon);
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
      // d'impression empile dans cet ordre ; le panier aussi.
      position: p.plan,
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
  return {
    schemaVersion: 1,
    productId,
    backgroundId: state.backgroundId,
    backgroundUrl: state.backgroundUrl,
    format: state.format,
    view: state.view,
    frameId: state.frameId,
    texts: { lines: lignesEnregistrees(state) },
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
function lignesEnregistrees(state: ConfiguratorState): TextBlock[] {
  const remplies = state.lignes
    .filter((l) => l.value.trim() !== "")
    .map((l) => ({
      value: l.value,
      font: l.font,
      color: state.textStyle.color,
      size: state.textStyle.size,
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

function rgb(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Teintes de peau (base / personnage). */
export const SKIN_TONES = [
  rgb(255, 238, 224),
  rgb(255, 226, 192),
  rgb(246, 210, 169),
  rgb(225, 180, 128),
  rgb(184, 138, 108),
  rgb(139, 91, 56),
] as const;

/** Nuancier vêtements. */
export const CLOTHES_TONES = [
  rgb(250, 250, 250),
  rgb(255, 150, 191),
  rgb(158, 223, 191),
  rgb(200, 228, 214),
  rgb(189, 18, 18),
  rgb(0, 86, 175),
  rgb(184, 85, 29),
  rgb(0, 0, 0),
] as const;

/** Nuancier pantalon. */
export const PANTS_TONES = [
  rgb(237, 215, 198),
  rgb(184, 85, 29),
  rgb(94, 154, 191),
  rgb(22, 81, 118),
  rgb(84, 84, 84),
  rgb(0, 0, 0),
] as const;

/** Nuancier cheveux. */
export const HAIR_TONES = [
  rgb(232, 232, 232),
  rgb(241, 203, 158),
  rgb(231, 176, 51),
  rgb(184, 85, 29),
  rgb(214, 182, 149),
  rgb(191, 129, 88),
  rgb(107, 62, 30),
  rgb(84, 21, 7),
  rgb(36, 34, 44),
] as const;

/**
 * Nuancier de repli d'un emplacement — celui qui vivait en dur dans le code
 * avant que les catégories de pièces portent leurs propres couleurs. Ne sert
 * plus qu'aux pièces sans catégorie, ou dont la catégorie n'a aucune couleur.
 */
export function presetPaletteForSlot(slot: Slot | string): readonly string[] {
  if (slot === "hair") return HAIR_TONES;
  if (slot === "pants") return PANTS_TONES;
  return CLOTHES_TONES;
}

/**
 * Nuancier d'une pièce : celui de sa catégorie, sinon celui de l'emplacement.
 *
 * `libre` dit si le client peut aussi saisir une couleur hors nuancier : oui
 * seulement en repli. Une catégorie paramétrée au back-office ferme la liste —
 * c'est tout l'intérêt de la paramétrer.
 */
export function paletteForVariant(
  categories: readonly PieceCategoryDTO[] | undefined,
  variant: VariantDTO | undefined,
  slot: Slot | string,
): { couleurs: readonly string[]; libre: boolean } {
  const cat = variant?.pieceCategoryId
    ? categories?.find((c) => c.id === variant.pieceCategoryId)
    : undefined;
  if (cat && cat.colors.length > 0)
    return { couleurs: cat.colors, libre: false };
  return { couleurs: presetPaletteForSlot(slot), libre: true };
}

/**
 * Les couleurs que la catégorie d'une pièce propose au client : toutes, ou
 * la principale seule. Sans catégorie connue — aucune, archivée, décochée :
 * l'API ne l'envoie pas —, toutes, comme avant ce réglage. La pièce qui a
 * ses propres cases n'écoute pas cette règle (cf. groupesProposesDeLaPiece).
 */
export function regleDeLaPiece(
  categories: readonly PieceCategoryDTO[] | undefined,
  variant: VariantDTO | undefined,
): CouleursProposees {
  const cat = variant?.pieceCategoryId
    ? categories?.find((c) => c.id === variant.pieceCategoryId)
    : undefined;
  return cat?.couleursProposees === "principale" ? "principale" : "toutes";
}

/**
 * La couleur principale d'une pièce, celle qui passe d'une pièce à l'autre :
 * la plus étendue, avec les ombres de la même teinte (cf.
 * principaleDeLaPiece) — un t-shirt passé au rose ne garde pas des ombres
 * vert foncé. Quand la boutique a coché elle-même les couleurs de la pièce,
 * on s'en tient aux siennes : la plus étendue de celles qu'elle propose.
 */
function rangeePrincipale(
  piece: VariantDTO,
  categories: readonly PieceCategoryDTO[] | undefined,
): GroupeCouleur | undefined {
  if (!Array.isArray(piece.zonesMasquees)) return principaleDeLaPiece(piece);
  return groupePrincipal(
    groupesProposesDeLaPiece(piece, regleDeLaPiece(categories, piece)),
    piece.partsDesZones,
  );
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
 * Les vignettes de la galerie passent par ici elles aussi : chacune montre
 * la pièce telle qu'elle arrivera si on la touche.
 */
export function couleursAuChangementDePiece(
  slot: Slot,
  colors: Record<string, string>,
  ancienne: VariantDTO | undefined,
  nouvelle: VariantDTO,
  categories: readonly PieceCategoryDTO[] | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [zone, hex] of Object.entries(nouvelle.colorZones ?? {}))
    out[colorKey(slot, zone)] = hex;

  const quittee = ancienne ? rangeePrincipale(ancienne, categories) : undefined;
  const choisie = quittee ? colors[colorKey(slot, quittee.zone)] : undefined;
  const dessinee = quittee ? ancienne?.colorZones?.[quittee.zone] : undefined;
  if (!choisie || !dessinee || memeCouleur(choisie, dessinee)) return out;

  const cible = rangeePrincipale(nouvelle, categories);
  if (cible)
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
