/**
 * Le tirage au hasard d'une affiche de démonstration.
 *
 * Margaux imprime d'avance des affiches personnalisées « au hasard », pour les
 * présenter sur un stand (le marché de Noël de Mulhouse en 2026, puis bien
 * d'autres) : elle choisit des affiches, un nombre d'exemplaires pour chacune
 * et une scène (couple, famille…), et chaque exemplaire reçoit ses propres
 * personnages, tenues et couleurs. Ce module tire UN exemplaire : une
 * configuration complète (PosterConfig) que le moteur d'impression rend
 * ensuite comme celle d'une commande (affiches-demo.ts).
 *
 * LA RÈGLE : UNE CONFIGURATION QUE LE MODULE DE PERSONNALISATION AURAIT PU
 * PRODUIRE. Personnages proposés pour le type de l'affiche, pièces que chacun
 * a le droit de porter, couleurs prises dans les pastilles que le client voit,
 * places de la composition automatique, textes rangés comme le module les
 * range. Une affiche montrée sur le stand doit pouvoir se commander telle
 * quelle : une tenue ou une couleur introuvable sur le site ferait vendre une
 * affiche que personne ne peut refaire.
 *
 * PUR : ni base, ni fichier, ni réseau. L'appelant lui donne la bibliothèque
 * (le JSON de GET /characters, tel quel), l'affiche, un aléa et de quoi savoir
 * si un fichier existe. Deux raisons :
 *   - une graine rejoue exactement le même tirage (alea, graineDemo) : la
 *     configuration enregistrée se réimprime à l'identique, « Refaire au
 *     hasard » change seulement d'essai, et les essais vérifient tout cela
 *     sans base (tests/affiches-demo-tirage.test.ts) ;
 *   - il ne touche à aucun fichier de l'empreinte des fichiers d'impression
 *     (LANCEMENT, fichiers-impression.ts) : le corriger ne refait aucun PDF de
 *     commande.
 *
 * LES RECOPIES. Les règles du module vivent dans packages/configurator/src/
 * store.ts, qui importe solid-js : l'API ne peut pas l'importer (elle ne
 * dépend que de @memoryline/types), et les déplacer dans @memoryline/types
 * changerait l'empreinte. Elles sont donc recopiées ici, chacune signalée,
 * avec les mêmes noms : une correction faite là-bas doit être reportée ici.
 * Tout ce que @memoryline/types exporte déjà est importé, jamais recopié.
 */
import {
  BASE_COLOR_SCOPE,
  COULEUR_TEXTE_DEFAUT,
  NUANCIERS_PAR_DEFAUT,
  POLICE_SOUSTITRE_DEFAUT,
  POLICE_TITRE_DEFAUT,
  afficheComposee,
  colorKey,
  composerPersonnages,
  compositionDeLaVue,
  couleurTexteParValeur,
  couleursDuGroupePourScope,
  couleursDuNuancier,
  groupesDuDessin,
  groupesProposesDeLaBase,
  hauteurDuDessin,
  memeCouleur,
  pastillesDeLaRangee,
  posterConfigSchema,
  principaleDeLaPiece,
  textesDepuisLignes,
  type CouleursImage,
  type EmpriseDessin,
  type GroupeCouleur,
  type NuancierBase,
  type PersonnageAComposer,
  type PosterConfig,
  type TextBlock,
} from "@memoryline/types";
// La ville lue dans le nom de l'affiche : la règle du filtre par lieu du
// catalogue, dans un module à elle et sans aucune dépendance (pur comme
// celui-ci). La recopier en ferait deux règles, l'une finirait par mentir.
import { villeDuNom } from "./ville-du-nom.js";

/* -------------------------------------------------------------------------- */
/*  Scènes et rôles                                                            */
/* -------------------------------------------------------------------------- */

/** Qui pose sur l'affiche : la « scène » tirée pour un exemplaire. */
export type SceneDemo = "couple" | "famille" | "famille_animal" | "avec_animal" | "amis" | "hasard";

/** Ce que Margaux choisit : une scène, ou « Varié », qui les fait tourner sur tout le lot. */
export type SceneChoisie = SceneDemo | "varie";

/**
 * Les scènes proposées au back-office, dans l'ordre de l'écran : « Varié »
 * d'abord, coché par défaut. C'est le « style de personnage » demandé par
 * Alexandra (20 novembre 2026) : un seul choix à faire, et des tirages
 * toujours présentables — au moins un adulte, de deux à cinq personnages.
 */
export const SCENES_DEMO: readonly { cle: SceneChoisie; libelle: string; aide: string }[] = [
  {
    cle: "varie",
    libelle: "Varié (conseillé)",
    aide: "Couples, familles, familles avec leur animal… Les exemplaires d'une même affiche montrent des scènes différentes.",
  },
  { cle: "couple", libelle: "Couple", aide: "Deux adultes." },
  { cle: "famille", libelle: "Famille", aide: "Deux adultes et un à trois enfants." },
  {
    cle: "famille_animal",
    libelle: "Famille avec animal",
    aide: "Deux adultes, un ou deux enfants et un animal.",
  },
  { cle: "avec_animal", libelle: "Avec son animal", aide: "Un ou deux adultes et un animal." },
  { cle: "amis", libelle: "Entre amis", aide: "Trois ou quatre personnes : des adultes, parfois avec un ado." },
  {
    cle: "hasard",
    libelle: "Au hasard",
    aide: "De deux à cinq personnages, toutes catégories confondues.",
  },
];

/** Le rôle d'un personnage dans une scène, lu dans le nom de sa catégorie. */
export type RoleDemo = "adulte_f" | "adulte_h" | "ado" | "enfant" | "bebe" | "animal" | "autre";

/**
 * Les rôles, dans l'ordre où le back-office montre leur correspondance avec
 * les catégories. « Autres » regroupe ce que les scènes ne savent pas placer
 * (« Fauteuil roulant », une catégorie renommée, archivée ou absente) : il
 * n'est tiré que par « Au hasard ».
 */
export const ROLES_DEMO: readonly { role: RoleDemo; libelle: string }[] = [
  { role: "adulte_f", libelle: "Femmes" },
  { role: "adulte_h", libelle: "Hommes" },
  { role: "ado", libelle: "Ados" },
  { role: "enfant", libelle: "Enfants" },
  { role: "bebe", libelle: "Bébés" },
  { role: "animal", libelle: "Animaux" },
  { role: "autre", libelle: "Autres, seulement « Au hasard »" },
];

/**
 * Le rôle d'une catégorie de personnages, d'après son NOM (sans accents, en
 * minuscules) : « Femmes » → adulte_f, « Garçons » → enfant…
 *
 * Le nom plutôt que le slug : les catégories se renomment au back-office, et
 * leurs slugs ne disent plus rien depuis la migration 0009. Un nom qui ne
 * commence par aucun des mots connus — « Fauteuil roulant », une catégorie
 * archivée (l'API envoie alors `null`) — tombe en « autre », et l'écran
 * montre la correspondance : un renommage malheureux se voit.
 */
export function roleDeCategorie(nom: string | null | undefined): RoleDemo {
  const n = String(nom ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLowerCase();
  if (n.startsWith("femme")) return "adulte_f";
  if (n.startsWith("homme")) return "adulte_h";
  if (n.startsWith("ado")) return "ado";
  if (n.startsWith("fille") || n.startsWith("garcon")) return "enfant";
  if (n.startsWith("bebe")) return "bebe";
  if (n.startsWith("anima")) return "animal";
  return "autre";
}

/** Les deux rôles d'adulte : une scène en compte toujours au moins un. */
const ADULTES: readonly RoleDemo[] = ["adulte_f", "adulte_h"];

/** Les rôles qui reçoivent une teinte de peau tirée : les humains, et eux seuls. */
const HUMAINS: readonly RoleDemo[] = ["adulte_f", "adulte_h", "ado", "enfant", "bebe"];

/** Tous les rôles : ceux que « Au hasard » peut tirer. */
const TOUS_LES_ROLES: readonly RoleDemo[] = ROLES_DEMO.map((r) => r.role);

/**
 * Les rôles d'une scène de repli : tous, sauf « autre », que seule « Au
 * hasard » tire (choix d'Alexandra pour « Fauteuil roulant », 20 novembre).
 */
const ROLES_DU_REPLI: readonly RoleDemo[] = TOUS_LES_ROLES.filter((r) => r !== "autre");

/**
 * La part de chaque sorte d'enfant dans une famille : surtout des enfants et
 * des ados, un bébé de temps en temps — et jamais deux (cf. lesEnfants).
 */
const POIDS_DES_ENFANTS: Partial<Record<RoleDemo, number>> = { enfant: 0.45, ado: 0.35, bebe: 0.2 };

/**
 * « Entre amis » : un groupe sur quatre compte un ado, jamais deux. Choisis
 * au même poids que les adultes, les ados venaient dans près d'un groupe sur
 * deux, et deux adultes avec deux ados font une famille, pas des amis
 * (relecture du 20/11).
 */
const CHANCE_D_UN_ADO_ENTRE_AMIS = 0.25;

/**
 * Les scènes où tout le monde est de la même famille : une seule teinte de
 * peau pour l'affiche (choix d'Alexandra). Entre amis, ou au hasard, chacun
 * la sienne.
 */
const SCENES_EN_FAMILLE: readonly SceneDemo[] = ["couple", "famille", "famille_animal", "avec_animal"];

/**
 * « Varié » : l'ordre dans lequel les scènes se suivent sur le lot. Les
 * familles reviennent le plus souvent, c'est ce que les clients achètent ;
 * deux rangs voisins n'ont jamais la même scène, même en bouclant, si bien
 * que deux exemplaires d'une même affiche (rangs qui se suivent) ne se
 * ressemblent pas.
 */
const ROTATION_VARIEE: readonly SceneDemo[] = [
  "famille",
  "couple",
  "famille_animal",
  "famille",
  "avec_animal",
  "couple",
  "amis",
];

const SCENES_TIREES: readonly string[] = ["couple", "famille", "famille_animal", "avec_animal", "amis", "hasard"];

function estSceneDemo(v: unknown): v is SceneDemo {
  return typeof v === "string" && SCENES_TIREES.includes(v);
}

/**
 * La scène d'un exemplaire. Une scène choisie vaut pour tout le lot ;
 * « Varié » la fait tourner, à partir d'un rang de départ que l'appelant tire
 * une fois par lot — sans quoi tous les lots commenceraient par une famille.
 */
export function sceneDuRang(choisie: SceneChoisie, rang: number, depart: number): SceneDemo {
  if (choisie !== "varie" && estSceneDemo(choisie)) return choisie;
  const n = ROTATION_VARIEE.length;
  const k = entier(rang) + entier(depart);
  return ROTATION_VARIEE[((k % n) + n) % n]!;
}

/* -------------------------------------------------------------------------- */
/*  Hasard à graine                                                            */
/* -------------------------------------------------------------------------- */

function entier(v: number): number {
  return Number.isFinite(v) ? Math.trunc(v) : 0;
}

/**
 * Un aléa à graine (mulberry32) : nombres de 0 inclus à 1 exclu, et la même
 * graine rend toujours la même suite. Math.random ne se rejoue pas : un essai
 * qui échoue une fois sur mille ne se reproduirait jamais.
 */
export function alea(graine: number): () => number {
  let a = entier(graine) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Le brassage final de MurmurHash3 : une bijection, qui disperse des entiers voisins. */
function brasser(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * La graine d'un exemplaire : son lot, son rang dans le lot, et l'essai —
 * « Refaire au hasard » passe à l'essai suivant. Deux rangs d'un même lot et
 * d'un même essai n'ont jamais la même graine (chaque étape est une
 * bijection), et des rangs voisins donnent des tirages sans rapport.
 */
export function graineDemo(lotId: number, rang: number, essai: number): number {
  let h = 0;
  for (const n of [lotId, rang, essai]) h = brasser(((h ^ entier(n)) + 0x9e3779b9) | 0);
  return h;
}

/** Un rang de 0 à n − 1, sans jamais déborder, même si l'aléa rend 1 ou n'importe quoi. */
function indice(hasard: () => number, n: number): number {
  const u = hasard();
  const i = Math.floor((Number.isFinite(u) ? u : 0) * n);
  return Math.min(n - 1, Math.max(0, i));
}

/** Un élément au hasard ; la liste ne doit pas être vide. */
function auHasard<T>(liste: readonly T[], hasard: () => number): T {
  return liste[indice(hasard, liste.length)]!;
}

/** Mélange de Fisher-Yates, sur une copie. */
function melanger<T>(liste: readonly T[], hasard: () => number): T[] {
  const out = [...liste];
  for (let i = out.length - 1; i > 0; i--) {
    const j = indice(hasard, i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Un rôle parmi `roles`, selon leurs poids (1 par défaut) ; la liste ne doit pas être vide. */
function roleAuHasard(
  roles: readonly RoleDemo[],
  hasard: () => number,
  poids?: Partial<Record<RoleDemo, number>>,
): RoleDemo {
  const total = roles.reduce((s, r) => s + (poids?.[r] ?? 1), 0);
  const tire = hasard();
  let u = (Number.isFinite(tire) ? tire : 0) * total;
  for (const r of roles) {
    u -= poids?.[r] ?? 1;
    if (u < 0) return r;
  }
  return roles[roles.length - 1]!;
}

/* -------------------------------------------------------------------------- */
/*  La bibliothèque (GET /characters), en types réduits                        */
/* -------------------------------------------------------------------------- */

/*
 * Les objets de GET /characters, réduits à ce que le tirage lit. Ce sont ceux
 * de store.ts (VariantDTO l.67, PieceCategoryDTO l.114, CharacterDTO l.129,
 * SlotVariants l.233, SlotsDTO l.248, WorkingCharacter l.280) : les recopies
 * plus bas les lisent comme le module.
 */

/** recopié de packages/configurator/src/store.ts l.51, garder identiques */
const SLOTS = ["clothes", "pants", "hair", "accessory"] as const;
type Slot = (typeof SLOTS)[number];

function estSlot(v: string): v is Slot {
  return (SLOTS as readonly string[]).includes(v);
}

/** Une pièce : vêtement, pantalon, coupe ou accessoire. */
interface VariantDTO {
  id: number | string;
  name?: string | null;
  svgUrl: string;
  colorZones: Record<string, string> | null;
  groupesCouleurs?: GroupeCouleur[] | null;
  partsDesZones?: Record<string, number> | null;
  couleursImage?: CouleursImage | null;
  position: number;
  pieceCategoryId?: number | null;
}

/** Une catégorie de pièces : elle porte le nuancier de ses pièces. */
interface PieceCategoryDTO {
  id: number;
  slug: string;
  colors: string[];
}

/** Un personnage de la bibliothèque. */
interface CharacterDTO {
  id: number | string;
  name?: string;
  /** Le NOM de sa catégorie (en français : l'appel se fait sans ?lang=), ou null. */
  category?: string | null;
  archived?: boolean;
  active?: boolean;
  baseSvgUrl: string;
  baseColorZones: Record<string, string> | null;
  baseGroupesCouleurs?: GroupeCouleur[] | null;
  baseZonesProposees?: string[] | null;
  baseCouleursImage?: CouleursImage | null;
  orientation?: string;
  facteurTaille?: number;
  decalageX?: number;
  slotVariants?: Partial<Record<Slot, number[]>> | null;
  defaultAssets?: Partial<Record<Slot, number>> | null;
  emprise?: EmpriseDessin | null;
}

interface SlotVariants {
  clothes: VariantDTO[];
  pants: VariantDTO[];
  hair: VariantDTO[];
  accessory: VariantDTO[];
}

type SlotsDTO = Record<string, SlotVariants | undefined>;

/** Les quatre nuanciers des personnages : ceux de la boutique, sinon ceux d'origine. */
type NuanciersPersonnages = Partial<Record<NuancierBase, readonly string[]>>;

/** Le personnage en cours de tirage, comme l'état de travail du module. */
interface WorkingCharacter {
  characterId: string | number;
  position: number;
  x: number;
  y: number;
  scale: number;
  placementManuel: boolean;
  assets: Partial<Record<Slot, string | number>>;
  colors: Record<string, string>;
}

interface Bibliotheque {
  characters: CharacterDTO[];
  slots: SlotsDTO;
  pieceCategories: PieceCategoryDTO[];
  nuanciersBase: NuanciersPersonnages | null;
}

function objet(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function estIdentifiant(v: unknown): v is number | string {
  return typeof v === "number" || (typeof v === "string" && v !== "");
}

/** Les pièces lisibles d'un emplacement ; une donnée abîmée est écartée, jamais fatale. */
function piecesLisibles(brut: unknown): VariantDTO[] {
  if (!Array.isArray(brut)) return [];
  return brut.filter((v): v is VariantDTO => {
    const o = objet(v);
    return !!o && estIdentifiant(o.id) && typeof o.svgUrl === "string" && typeof o.position === "number";
  });
}

/**
 * La bibliothèque lue dans le JSON de GET /characters, ou null s'il n'en a
 * pas la forme. Chaque type d'affiche reçoit ses quatre emplacements, même
 * vides : les recopies du module lisent `all[slot]` sans vérifier, comme
 * elles le font sur la réponse de l'API, qui les envoie toujours tous.
 */
function lireBibliotheque(brut: unknown): Bibliotheque | null {
  const b = objet(brut);
  if (!b || !Array.isArray(b.characters)) return null;
  const characters = b.characters.filter((c): c is CharacterDTO => {
    const o = objet(c);
    return !!o && estIdentifiant(o.id) && typeof o.baseSvgUrl === "string";
  });
  const slots: SlotsDTO = {};
  for (const [vue, tiroir] of Object.entries(objet(b.slots) ?? {})) {
    const t = objet(tiroir);
    if (!t) continue;
    slots[vue] = {
      clothes: piecesLisibles(t.clothes),
      pants: piecesLisibles(t.pants),
      hair: piecesLisibles(t.hair),
      accessory: piecesLisibles(t.accessory),
    };
  }
  const pieceCategories: PieceCategoryDTO[] = [];
  for (const brute of Array.isArray(b.pieceCategories) ? b.pieceCategories : []) {
    const o = objet(brute);
    if (!o || typeof o.id !== "number" || typeof o.slug !== "string") continue;
    const colors = Array.isArray(o.colors)
      ? o.colors.filter((x): x is string => typeof x === "string")
      : [];
    pieceCategories.push({ id: o.id, slug: o.slug, colors });
  }
  const nuanciersBase = objet(b.nuanciersBase) as NuanciersPersonnages | null;
  return { characters, slots, pieceCategories, nuanciersBase };
}

/* -------------------------------------------------------------------------- */
/*  Recopies du module de personnalisation                                     */
/* -------------------------------------------------------------------------- */

/**
 * Restreint un jeu de variantes à celles AUTORISÉES pour un perso (matching
 * par `position`, dans l'ordre du perso). Sans liste (donnée non liée), on
 * retombe sur le jeu complet ; une liste VIDE = slot sans variante (animaux).
 *
 * recopié de packages/configurator/src/store.ts l.211, garder identiques
 */
function slotsForCharacter(
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

/**
 * Jeu de variantes d'un type d'affiche, ou un jeu vide s'il n'en a aucune.
 *
 * recopié de packages/configurator/src/store.ts l.251, garder identiques
 */
function variantesDeVue(
  slots: SlotsDTO | undefined,
  vue: string | null | undefined,
): SlotVariants {
  return (
    slots?.[vue ?? "front"] ??
    slots?.["front"] ?? { clothes: [], pants: [], hair: [], accessory: [] }
  );
}

/**
 * Police de départ, ligne par ligne : celles de l'ancien titre et de l'ancien
 * sous-titre, la troisième suivant la deuxième.
 *
 * recopié de packages/configurator/src/store.ts l.345 et l.352, garder identiques
 */
const POLICES_LIGNES_DEFAUT: readonly string[] = [
  POLICE_TITRE_DEFAUT,
  POLICE_SOUSTITRE_DEFAUT,
  POLICE_SOUSTITRE_DEFAUT,
];
function policeDefautLigne(index: number): string {
  return POLICES_LIGNES_DEFAUT[index] ?? POLICE_SOUSTITRE_DEFAUT;
}

/** Une ligne de l'affiche : son texte et la police qui la dessine (store.ts l.335). */
interface LigneTexte {
  value: string;
  font: string;
}

/**
 * Ce que la composition lit d'un personnage de la bibliothèque.
 *
 * recopié de packages/configurator/src/store.ts l.449, garder identiques
 */
function aComposer(base: CharacterDTO | undefined): PersonnageAComposer {
  return {
    facteur: base?.facteurTaille,
    decalage: base?.decalageX,
    emprise: base?.emprise,
  };
}

/**
 * L'étalon de la composition : la hauteur du plus grand personnage proposé
 * pour ce type d'affiche — inactifs compris, archivés exclus. C'est à lui
 * qu'on mesure qui est « petit ». `null` si aucun dessin n'est encore mesuré.
 *
 * recopié de packages/configurator/src/store.ts l.463, garder identiques
 */
function etalonDeLaVue(
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
 * Les lignes telles qu'elles partent dans la commande : les REMPLIES, dans
 * l'ordre, et rien d'autre — sans trou, l'API refuse un trou. La police reste
 * propre à chaque ligne ; couleur et taille sont communes.
 *
 * recopié de packages/configurator/src/store.ts l.607, garder identiques
 * (l'état est réduit à ses lignes et à son style)
 */
function lignesEnregistrees(state: {
  lignes: LigneTexte[];
  textStyle: { color: string; size: number };
}): TextBlock[] {
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
 * Trouve une variante par id dans la liste d'un slot.
 *
 * recopié de packages/configurator/src/store.ts l.635, garder identiques
 */
function findVariant(
  variants: VariantDTO[] | undefined,
  variantId: string | number | undefined,
): VariantDTO | undefined {
  if (variantId === undefined || !variants) return undefined;
  return variants.find((v) => String(v.id) === String(variantId));
}

/**
 * Crée un personnage par défaut pour une base : la tenue de départ, réglée en
 * POSITIONS au back-office, traduite en identifiants de pièces, et les
 * couleurs des pièces portées sous leur clé namespacée (« clothes:st0 »).
 * Aucune couleur de la base.
 *
 * recopié de packages/configurator/src/store.ts l.650, garder identiques
 */
function defaultCharacter(
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

/**
 * Nuancier de repli d'un emplacement : celui des personnages réglé par la
 * boutique, sinon celui d'origine.
 *
 * recopié de packages/configurator/src/store.ts l.765, garder identiques
 */
function presetPaletteForSlot(
  slot: Slot | string,
  nuanciers?: NuanciersPersonnages | null,
): readonly string[] {
  const n: NuancierBase =
    slot === "hair" ? "cheveux" : slot === "pants" ? "pantalon" : "vetements";
  const regles = nuanciers?.[n];
  return regles && regles.length ? regles : NUANCIERS_PAR_DEFAUT[n];
}

/**
 * Nuancier d'une pièce : la liste propre de la rangée, sinon celui de sa
 * catégorie, sinon celui de l'emplacement (cf. pastillesDeLaRangee).
 *
 * recopié de packages/configurator/src/store.ts l.788, garder identiques
 */
function paletteForVariant(
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
 * La couleur principale d'une pièce, avec ses ombres.
 *
 * recopié de packages/configurator/src/store.ts l.815, garder identiques
 */
function rangeePrincipale(piece: VariantDTO): GroupeCouleur | undefined {
  return principaleDeLaPiece(piece);
}

/**
 * Les couleurs d'un emplacement quand on y choisit une AUTRE pièce : celles
 * du dessin de la nouvelle, et la seule couleur principale VRAIMENT choisie
 * pour la pièce quittée, quand la nouvelle la propose.
 *
 * recopié de packages/configurator/src/store.ts l.849, garder identiques
 */
function couleursAuChangementDePiece(
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
 * Le client touche une autre pièce dans la galerie : la pièce change, ses
 * couleurs arrivent avec elle et celles de la pièce quittée s'en vont. La
 * pièce déjà portée, touchée à nouveau, ne change rien.
 *
 * recopié de setAsset, packages/configurator/src/index.tsx l.459-490, garder
 * identiques (la pièce est donnée, et non son identifiant)
 */
function changerDePiece(
  c: WorkingCharacter,
  slot: Slot,
  v: VariantDTO,
  variantes: VariantDTO[],
  lib: Bibliotheque,
): void {
  if (String(c.assets[slot]) === String(v.id)) return;
  const ancienne = findVariant(variantes, c.assets[slot]);
  c.assets[slot] = v.id;
  // Calculées AVANT d'effacer : la couleur choisie pour la pièce quittée se
  // lit dans les clés qu'on va retirer.
  const couleurs = couleursAuChangementDePiece(
    slot,
    c.colors,
    ancienne,
    v,
    lib.pieceCategories,
    lib.nuanciersBase,
  );
  const prefixe = colorKey(slot, "");
  for (const cle of Object.keys(c.colors))
    if (cle.startsWith(prefixe)) delete c.colors[cle];
  Object.assign(c.colors, couleurs);
}

/* -------------------------------------------------------------------------- */
/*  L'affiche à tirer                                                          */
/* -------------------------------------------------------------------------- */

/** Une affiche personnalisable, telle que l'appelant la lit en base. */
export interface AfficheDemo {
  productId: number;
  /** Son nom (« MULHOUSE Place de la Réunion ») : la ville se lit dedans. */
  nom: string;
  /** Lignes par défaut du produit (defaultTitle, defaultSubtitle, defaultLine3). */
  titre: string | null;
  sousTitre: string | null;
  ligne3: string | null;
  /** Son type d'affiche (product.defaultView, « front » à défaut) : seuls ses personnages y vont. */
  vue: string;
  /** Le décor d'avant-plan effectif (muret, banc…) : celui du produit, sinon celui de son type. */
  avantPlan: string | null;
  /** Ses fonds, dans l'ordre du module ; `url` en chemin brut « /assets/… ». */
  fonds: { id: number; url: string; nom: string }[];
  /**
   * Vrai quand ces fonds ne lui sont pas rattachés mais retrouvés par le nom
   * de sa ville : seul le premier est alors tiré (celui que le module
   * présélectionne), les autres peuvent être ceux d'une autre affiche.
   */
  fondsParLeNom: boolean;
}

/** Les réglages du lot qui touchent au tirage. */
export interface OptionsDemo {
  format: "A4" | "A3";
  /** La scène de CET exemplaire (cf. sceneDuRang), jamais « varie ». */
  scene: SceneDemo;
  /** Noms d'exemple pour la 2e ligne, tirés au hasard ; vide : la 2e ligne de l'affiche. */
  nomsLigne2: string[];
  /** « #FFFFFF » (blanc, par défaut) ou « #2F3436 » (anthracite) ; toute autre valeur : le blanc. */
  couleurTexte: string;
}

/** Ce que la carte de l'exemplaire annonce, lisible avant même le rendu. */
export interface ResumeDemo {
  /** La scène réellement composée : celle demandée, sauf scène dégradée. */
  scene: SceneDemo;
  /**
   * La scène demandée n'a pas pu être composée telle quelle : un rôle manque
   * pour ce type d'affiche (pas d'animal de dos, par exemple). La carte le
   * dit, plutôt que de laisser croire à une famille avec animal.
   */
  degradee: boolean;
  /** Les noms des personnages, de gauche à droite dans la liste (« Femme 2 »). */
  personnages: string[];
  /** Le nom du fond tiré. */
  decor: string;
}

function rempli(v: string | null | undefined): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function vueDe(affiche: AfficheDemo): string {
  return rempli(affiche.vue) ?? "front";
}

/** Le nom d'un type d'affiche dans une phrase du back-office. */
function nomDeLaVue(vue: string): string {
  return vue === "front" ? "De face" : vue === "back" ? "De dos" : vue;
}

/**
 * Un dessin que le moteur d'impression sait dessiner : un SVG. Il lit la base
 * d'un personnage et chaque pièce comme du texte SVG (pdf.ts, readSource puis
 * sharp) ; une image PNG déposée telle quelle au back-office (« emond » et
 * « ddd », des captures d'écran, en local le 20/11) y échoue sur « unsupported
 * image format ». Les dessins en pixels qui s'impriment sont des SVG qui
 * enveloppent l'image : eux passent.
 */
function dessinImprimable(url: string | null | undefined): boolean {
  return typeof url === "string" && /\.svg(?:[?#]|$)/i.test(url);
}

/**
 * Un personnage ou une pièce d'essai, au mot « test » ou « essai » dans son
 * nom : « Femme test », une coiffure « TEST » calée pour un seul personnage
 * et liée à d'autres (relecture du 20/11). Le module les propose tant qu'ils
 * ne sont pas archivés, et une cliente verrait le défaut à l'aperçu ; une
 * affiche de démonstration, elle, part à l'imprimante sans que personne l'ait
 * regardée de près. Un mot entier seulement : « Testament » passe.
 */
function dEssai(nom: string | null | undefined): boolean {
  const n = String(nom ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  return /(?:^|[^a-z0-9])(?:test|essai)s?(?:[^a-z0-9]|$)/.test(n);
}

/**
 * Les personnages qu'une cliente peut ajouter sur ce type d'affiche :
 * proposés (non masqués), non archivés, de ce type. Contrairement au module
 * (visibleCharacters, index.tsx l.200), on ne retombe PAS sur toute la liste
 * quand aucun ne correspond : ce serait poser des personnages de face sur une
 * affiche de dos. Ni ceux dont le dessin ne s'imprime pas, ni ceux d'essai
 * (cf. dessinImprimable, dEssai) : un sous-ensemble de ce que le module
 * propose, jamais plus.
 */
function personnagesProposes(lib: Bibliotheque, vue: string): CharacterDTO[] {
  return lib.characters.filter(
    (c) =>
      !c.archived &&
      c.active !== false &&
      (c.orientation ?? "front") === vue &&
      dessinImprimable(c.baseSvgUrl) &&
      !dEssai(c.name),
  );
}

function estRoleAdulte(role: RoleDemo): boolean {
  return ADULTES.includes(role);
}

function aUnAdulte(personnages: readonly CharacterDTO[]): boolean {
  return personnages.some((c) => estRoleAdulte(roleDeCategorie(c.category)));
}

/**
 * Une affiche peut-elle être tirée ? Pour le tableau du back-office : la
 * raison s'écrit à la place du champ, en mots de la boutique. Le statut, la
 * gamme et l'IA se vérifient en base, avant (affiches-demo.ts) ; les fichiers,
 * au tirage (tirerAfficheDemo).
 */
export function tirabilite(
  affiche: AfficheDemo,
  bibliotheque: unknown,
): { tirable: boolean; raison: string | null; personnages: number } {
  const lib = lireBibliotheque(bibliotheque);
  if (!lib)
    return {
      tirable: false,
      raison: "La bibliothèque des personnages n'a pas pu être lue.",
      personnages: 0,
    };
  const vue = vueDe(affiche);
  const proposes = personnagesProposes(lib, vue);
  const personnages = proposes.length;
  if (affiche.fonds.length === 0) return { tirable: false, raison: "Aucun décor à elle.", personnages };
  if (personnages === 0)
    return {
      tirable: false,
      raison: `Aucun personnage proposé pour une affiche « ${nomDeLaVue(vue)} ».`,
      personnages,
    };
  if (!aUnAdulte(proposes))
    return {
      tirable: false,
      raison: `Aucun adulte proposé pour une affiche « ${nomDeLaVue(vue)} ».`,
      personnages,
    };
  return { tirable: true, raison: null, personnages };
}

/* -------------------------------------------------------------------------- */
/*  Les scènes                                                                 */
/* -------------------------------------------------------------------------- */

interface Candidat {
  perso: CharacterDTO;
  role: RoleDemo;
}

/** Les personnages d'une affiche, rangés par rôle et piochés SANS REMISE : jamais deux fois le même. */
interface Pioche {
  prendre(role: RoleDemo): Candidat | null;
  /** Un rôle au hasard parmi ceux qui ont encore quelqu'un (selon `poids`), puis l'un des siens. */
  prendreParmi(roles: readonly RoleDemo[], poids?: Partial<Record<RoleDemo, number>>): Candidat | null;
}

function piocheDe(candidats: readonly CharacterDTO[], hasard: () => number): Pioche {
  const restants = new Map<RoleDemo, CharacterDTO[]>();
  for (const c of candidats) {
    const role = roleDeCategorie(c.category);
    const liste = restants.get(role);
    if (liste) liste.push(c);
    else restants.set(role, [c]);
  }
  const prendre = (role: RoleDemo): Candidat | null => {
    const liste = restants.get(role);
    if (!liste || liste.length === 0) return null;
    const [perso] = liste.splice(indice(hasard, liste.length), 1);
    return perso ? { perso, role } : null;
  };
  return {
    prendre,
    prendreParmi(roles, poids) {
      const dispo = roles.filter((r) => (restants.get(r)?.length ?? 0) > 0);
      return dispo.length ? prendre(roleAuHasard(dispo, hasard, poids)) : null;
    },
  };
}

/** Ce que donne une scène : qui pose, de gauche à droite, et ce qui a été composé. */
interface Tirage {
  scene: SceneDemo;
  degradee: boolean;
  persos: Candidat[];
}

function estAdulte(c: Candidat): boolean {
  return estRoleAdulte(c.role);
}

/**
 * Le couple d'une scène : la femme à gauche, l'homme à droite. Faute de l'un
 * pour ce type d'affiche, un second adulte de l'autre catégorie — `complets`
 * le dit, et la scène est alors annoncée dégradée.
 */
function deuxAdultes(p: Pioche): { gauche: Candidat | null; droite: Candidat | null; complets: boolean } {
  const f = p.prendre("adulte_f");
  const h = p.prendre("adulte_h");
  if (f && h) return { gauche: f, droite: h, complets: true };
  const seul = f ?? h;
  return { gauche: seul, droite: seul ? p.prendreParmi(ADULTES) : null, complets: false };
}

/** Un à trois enfants : 40 %, 45 %, 15 %. */
function nombreDEnfants(hasard: () => number): number {
  const u = hasard();
  return u < 0.4 ? 1 : u < 0.85 ? 2 : 3;
}

/** Les enfants d'une famille : enfants et ados, un bébé au plus. */
function lesEnfants(p: Pioche, nombre: number): Candidat[] {
  const enfants: Candidat[] = [];
  for (let k = 0; k < nombre; k++) {
    const dejaUnBebe = enfants.some((e) => e.role === "bebe");
    const c = p.prendreParmi(
      dejaUnBebe ? ["enfant", "ado"] : ["enfant", "ado", "bebe"],
      POIDS_DES_ENFANTS,
    );
    if (!c) break;
    enfants.push(c);
  }
  return enfants;
}

/**
 * Sur une affiche de dos, tout le monde est en rangée le long du muret : les
 * adultes aux deux bouts encadrent les autres. De face, inutile — la
 * composition glisse elle-même les petits devant les grands.
 */
function adultesAuxBouts(persos: readonly Candidat[]): Candidat[] {
  const adultes = persos.filter(estAdulte);
  const premier = adultes[0];
  if (!premier) return [...persos];
  const dernier = adultes.length > 1 ? adultes[adultes.length - 1]! : null;
  const milieu = persos.filter((c) => c !== premier && c !== dernier);
  return [premier, ...milieu, ...(dernier ? [dernier] : [])];
}

/**
 * Quand la scène ne peut pas se composer du tout (un seul adulte pour ce type
 * d'affiche, par exemple) : ce qu'on a, complété jusqu'à deux personnages si
 * possible, annoncé dégradé. Jamais d'affiche refusée pour une scène.
 */
function repli(p: Pioche, deja: readonly Candidat[], rangee: boolean): Tirage {
  const persos = [...deja];
  if (!persos.some(estAdulte)) {
    const a = p.prendreParmi(ADULTES);
    if (a) persos.unshift(a);
  }
  while (persos.length < 2) {
    const c = p.prendreParmi(ROLES_DU_REPLI);
    if (!c) break;
    persos.push(c);
  }
  return { scene: "hasard", degradee: true, persos: rangee ? adultesAuxBouts(persos) : persos };
}

/**
 * Qui pose sur l'affiche, dans l'ordre de la liste — de gauche à droite.
 *
 * Un rôle absent du type d'affiche DÉGRADE la scène au lieu de la refuser :
 * une famille avec animal sans animal devient une famille, une famille sans
 * enfant un couple. `scene` dit alors ce qui a vraiment été composé.
 */
function tirerScene(scene: SceneDemo, p: Pioche, hasard: () => number, rangee: boolean): Tirage {
  switch (scene) {
    case "couple": {
      const { gauche, droite, complets } = deuxAdultes(p);
      if (gauche && droite) return { scene, degradee: !complets, persos: [gauche, droite] };
      return repli(p, gauche ? [gauche] : [], rangee);
    }
    case "famille":
    case "famille_animal": {
      const avecAnimal = scene === "famille_animal";
      const nombre = avecAnimal ? (hasard() < 0.5 ? 1 : 2) : nombreDEnfants(hasard);
      const { gauche, droite, complets } = deuxAdultes(p);
      if (!gauche) return repli(p, [], rangee);
      const enfants = lesEnfants(p, nombre);
      const animal = avecAnimal ? p.prendre("animal") : null;
      // Les parents encadrent les enfants ; l'animal au bout de la rangée.
      const persos = [gauche, ...enfants, ...(droite ? [droite] : []), ...(animal ? [animal] : [])];
      if (persos.length < 2) return repli(p, persos, rangee);
      const composee: SceneDemo =
        enfants.length > 0
          ? animal
            ? "famille_animal"
            : "famille"
          : animal
            ? "avec_animal"
            : "couple";
      return { scene: composee, degradee: !complets || composee !== scene, persos };
    }
    case "avec_animal": {
      const premier = p.prendreParmi(ADULTES);
      if (!premier) return repli(p, [], rangee);
      const animal = p.prendre("animal");
      // Un second adulte une fois sur deux, de l'autre catégorie si possible ;
      // toujours sans animal, pour rester à deux.
      const second =
        !animal || hasard() < 0.5
          ? (p.prendre(premier.role === "adulte_f" ? "adulte_h" : "adulte_f") ??
            p.prendreParmi(ADULTES))
          : null;
      const persos = [premier, ...(second ? [second] : []), ...(animal ? [animal] : [])];
      if (persos.length < 2) return repli(p, persos, rangee);
      return { scene: animal ? "avec_animal" : "couple", degradee: !animal, persos };
    }
    case "amis": {
      // Trois ou quatre personnes : des adultes d'abord, et parfois un ado à
      // la place du dernier (cf. CHANCE_D_UN_ADO_ENTRE_AMIS) — c'est ce que
      // le back-office annonce.
      const nombre = hasard() < 0.5 ? 3 : 4;
      const avecUnAdo = hasard() < CHANCE_D_UN_ADO_ENTRE_AMIS;
      const groupe: Candidat[] = [];
      while (groupe.length < nombre - (avecUnAdo ? 1 : 0)) {
        const a = p.prendreParmi(ADULTES);
        if (!a) break;
        groupe.push(a);
      }
      if (groupe.length < 2) return repli(p, groupe, rangee);
      // Un ado, un seul : celui qui était prévu, ou celui qui complète un
      // groupe à qui les adultes manquent. Faute d'ado, un adulte de plus.
      if (avecUnAdo || groupe.length < 3) {
        const c = p.prendre("ado") ?? (avecUnAdo ? p.prendreParmi(ADULTES) : null);
        if (c) groupe.push(c);
      }
      const persos = melanger(groupe, hasard);
      return persos.length >= 3
        ? { scene: "amis", degradee: false, persos }
        : { scene: "couple", degradee: true, persos };
    }
    case "hasard": {
      const nombre = 2 + indice(hasard, 4);
      const adulte = p.prendreParmi(ADULTES);
      if (!adulte) return repli(p, [], rangee);
      const groupe = [adulte];
      while (groupe.length < nombre) {
        const c = p.prendreParmi(TOUS_LES_ROLES);
        if (!c) break;
        groupe.push(c);
      }
      const melange = melanger(groupe, hasard);
      return {
        scene: "hasard",
        degradee: groupe.length < 2,
        persos: rangee ? adultesAuxBouts(melange) : melange,
      };
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Habiller un personnage                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Les chances qu'un emplacement change de pièce. Un accessoire reste rare :
 * des lunettes ou un chapeau sur une personne sur cinq, pas sur toutes.
 */
const CHANCE_DE_CHANGER: Readonly<Record<Slot, number>> = {
  clothes: 0.6,
  pants: 0.5,
  hair: 0.5,
  accessory: 0.2,
};

/**
 * Les chances que la couleur principale d'une pièce portée change. Les
 * autres familles de couleur de la pièce gardent la leur : tout tirer au
 * hasard donnerait des tenues bariolées.
 */
const CHANCE_DE_RECOLORER = 0.7;

/**
 * La peau d'un personnage dessiné en vectoriel : la première couleur proposée
 * de sa base, et les teintes que le module lui montre (CharacterEditor.tsx
 * l.843-849). `null` quand elle ne se teint pas — aucune zone de couleur
 * (« Femme 6 », dessinée peau claire), ou rien à proposer.
 *
 * Une seule règle pour deux usages : la teinte tirée (étape f d'habiller), et
 * le choix des membres d'une famille (candidatsEnFamille), qui doivent tous
 * pouvoir la recevoir.
 */
function peauDe(
  c: CharacterDTO,
  lib: Bibliotheque,
): { groupe: GroupeCouleur; palette: readonly string[] } | null {
  if (Object.keys(c.baseColorZones ?? {}).length === 0) return null;
  const groupe = groupesProposesDeLaBase(c)[0];
  if (!groupe) return null;
  const premier = groupesDuDessin(c.baseColorZones, c.baseGroupesCouleurs)[0];
  const repliPeau: NuancierBase = groupe.zone === premier?.zone ? "peau" : "vetements";
  const palette = couleursDuNuancier(groupe.nuancier, repliPeau, lib.nuanciersBase, lib.pieceCategories);
  return palette.length > 0 ? { groupe, palette } : null;
}

/**
 * Les personnages d'une scène en famille : une seule teinte de peau pour
 * l'affiche (décision d'Alexandra), donc seulement des humains dont la peau
 * se teint. Femme 6 gardait sa peau claire dessinée au milieu d'une famille
 * passée en teinte foncée (relecture du 20/11) ; elle reste tirée « Entre
 * amis » et « Au hasard », où chacun a la sienne. Les animaux ne sont pas
 * concernés. Si le filtre ne laissait plus aucun adulte, la liste entière :
 * un adulte compte plus qu'une teinte commune.
 */
function candidatsEnFamille(candidats: readonly CharacterDTO[], lib: Bibliotheque): CharacterDTO[] {
  const teintables = candidats.filter(
    (c) => !HUMAINS.includes(roleDeCategorie(c.category)) || peauDe(c, lib) !== null,
  );
  return aUnAdulte(teintables) ? teintables : [...candidats];
}

/**
 * Un personnage tel qu'une cliente l'aurait habillé : sa tenue par défaut,
 * puis des pièces et des couleurs prises parmi celles que le module lui
 * propose, rien d'autre.
 *
 * `peauCommune` : un tirage entre 0 et 1 partagé par toute l'affiche (une
 * famille a la même teinte de peau), ou null pour une teinte à lui.
 */
function habiller(
  candidat: Candidat,
  rang: number,
  vue: string,
  lib: Bibliotheque,
  hasard: () => number,
  fichierPresent: (url: string) => boolean,
  peauCommune: number | null,
): WorkingCharacter {
  const c = candidat.perso;
  // a. Les pièces qu'il a le droit de porter : celles de son type d'affiche,
  //    restreintes aux siennes (addCharacter, index.tsx l.383-391).
  const pieces = slotsForCharacter(variantesDeVue(lib.slots, c.orientation ?? vue), c);
  // b. Sa tenue par défaut, en identifiants de pièces.
  const wc = defaultCharacter(c, rang, pieces);
  // c. Les couleurs de la base FIGÉES, comme le fait le changement de
  //    personnage (changeCharacter, index.tsx l.596-599) : une couleur par
  //    défaut changée au back-office après le tirage ne change pas la
  //    réimpression d'une affiche déjà tirée.
  for (const [zone, hex] of Object.entries(c.baseColorZones ?? {}))
    wc.colors[colorKey(BASE_COLOR_SCOPE, zone)] = hex;

  // d. Les pièces. Seulement pour un personnage LIÉ à ses pièces : sans liste
  //    (slotVariants null), le module lui propose toutes celles du type
  //    d'affiche, celles des autres morphologies comprises — un t-shirt
  //    d'adulte sur un bébé. Sa tenue par défaut reste alors telle quelle.
  //    Jamais « aucun » : on ne pioche que de vraies pièces (le module
  //    l'interdit sur le haut et le pantalon, et un personnage chauve ne
  //    ferait pas une affiche d'exemple).
  //    Pas non plus pour un personnage « autre » (Fauteuil roulant, catégorie
  //    renommée ou absente) : on ne sait pas ce que montre son dessin, qui
  //    porte peut-être déjà ce qu'une pièce ajouterait — « Femme fauteuil
  //    roulant » recevait l'accessoire « Wheel Chair 1 », un second fauteuil
  //    vu de dos par-dessus le sien (relecture du 20/11). Il garde la tenue
  //    réglée au back-office, comme il garde ses couleurs (étape f).
  if (c.slotVariants && candidat.role !== "autre") {
    for (const slot of SLOTS) {
      // Une pièce que le rendu ne saurait pas dessiner (fichier manquant,
      // image qui n'est pas un SVG) ou une pièce d'essai n'est jamais
      // piochée ; portée d'office, elle est remplacée.
      const piochable = (v: VariantDTO) =>
        fichierPresent(v.svgUrl) && dessinImprimable(v.svgUrl) && !dEssai(v.name);
      const proposees = pieces[slot].filter(piochable);
      if (proposees.length === 0) continue;
      const portee = findVariant(pieces[slot], wc.assets[slot]);
      const aRemplacer = portee !== undefined && !piochable(portee);
      if (!aRemplacer && hasard() >= CHANCE_DE_CHANGER[slot]) continue;
      changerDePiece(wc, slot, auHasard(proposees, hasard), pieces[slot], lib);
    }
  }

  // e. La couleur principale de chaque pièce vectorielle portée, prise dans
  //    les pastilles que le module montre pour elle (paletteForVariant), ombres
  //    recalculées (couleursDuGroupePourScope). Pas les accessoires : leurs
  //    couleurs dessinées sont voulues, et le nuancier de leur catégorie
  //    donnerait volontiers une barbe bleue ou un fauteuil roulant rouge.
  //    Pas les dessins en pixels : leurs couleurs par défaut s'appliquent au
  //    rendu, et une couleur nouvelle y coûterait un fichier recoloré de plus.
  for (const slot of SLOTS) {
    if (slot === "accessory") continue;
    const v = findVariant(pieces[slot], wc.assets[slot]);
    if (!v?.colorZones || Object.keys(v.colorZones).length === 0) continue;
    const groupe = principaleDeLaPiece(v);
    if (!groupe) continue;
    const palette = paletteForVariant(lib.pieceCategories, v, slot, lib.nuanciersBase, groupe).couleurs;
    if (palette.length === 0 || hasard() >= CHANCE_DE_RECOLORER) continue;
    Object.assign(
      wc.colors,
      couleursDuGroupePourScope(slot, groupe, v.colorZones, auHasard(palette, hasard)),
    );
  }

  // f. La peau, pour les humains dessinés en vectoriel (cf. peauDe). Les
  //    animaux gardent leur pelage, et « autre » (on ne sait pas si c'est un
  //    humain) ses couleurs du back-office.
  const peau = HUMAINS.includes(candidat.role) ? peauDe(c, lib) : null;
  if (peau) {
    // Le même RANG dans le nuancier pour toute la famille : la même teinte
    // quand tous ont le même nuancier, une teinte voisine sinon.
    const u = peauCommune ?? hasard();
    const { groupe, palette } = peau;
    const hex = palette[Math.min(palette.length - 1, Math.max(0, Math.floor(u * palette.length)))]!;
    Object.assign(wc.colors, couleursDuGroupePourScope(BASE_COLOR_SCOPE, groupe, c.baseColorZones, hex));
  }
  // g. Rien d'autre : les familles d'un dessin en pixels (« famN ») gardent
  //    les couleurs réglées au back-office, appliquées au rendu.
  return wc;
}

/* -------------------------------------------------------------------------- */
/*  Le tirage                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Le dernier contrôle avant d'enregistrer : ce que le rendu ne pardonnerait
 * pas. Un fichier manquant fait échouer le rendu (« Source introuvable »), une
 * image qui n'est pas un SVG aussi (cf. dessinImprimable), alors qu'une pièce
 * inconnue serait sautée sans un mot, et qu'un personnage inconnu sortirait
 * en pièces sans corps : mieux vaut une raison lisible sur la carte de
 * l'exemplaire.
 */
function controler(
  config: PosterConfig,
  lib: Bibliotheque,
  vue: string,
  fichierPresent: (url: string) => boolean,
): string | null {
  if (!afficheComposee(config)) return "Le tirage n'a donné ni fond ni personnage.";
  const n = config.characters.length;
  if (n < 1 || n > 6) return `Le tirage a donné ${n} personnages : il en faut de 1 à 6.`;
  for (const ch of config.characters) {
    const c = lib.characters.find((x) => String(x.id) === String(ch.typeId));
    if (!c) return "Un personnage tiré n'est plus dans la bibliothèque.";
    if (!fichierPresent(c.baseSvgUrl))
      return `Le dessin du personnage « ${c.name ?? c.id} » manque sur le serveur.`;
    if (!dessinImprimable(c.baseSvgUrl))
      return `Le dessin du personnage « ${c.name ?? c.id} » n'est pas un SVG : il ne s'imprime pas.`;
    const toutes = variantesDeVue(lib.slots, c.orientation ?? vue);
    for (const [slot, id] of Object.entries(ch.assets)) {
      const v = estSlot(slot) ? findVariant(toutes[slot], id) : undefined;
      if (!v) return `Une pièce tirée pour « ${c.name ?? c.id} » n'est plus dans la bibliothèque.`;
      if (!fichierPresent(v.svgUrl))
        return `Le dessin de la pièce « ${v.name ?? v.id} » manque sur le serveur.`;
      // La tenue d'office d'un personnage qu'on n'habille pas (cf. habiller, d).
      if (!dessinImprimable(v.svgUrl))
        return `Le dessin de la pièce « ${v.name ?? v.id} » n'est pas un SVG : elle ne s'imprime pas.`;
    }
  }
  return null;
}

/** La 2e ligne : une phrase qui va avec qui pose sur l'affiche (20/11). */
const PHRASES_DE_SCENE: Record<SceneDemo, readonly string[]> = {
  couple: ["Escapade en amoureux", "Notre week-end à deux", "Rien que nous deux", "Nos plus beaux souvenirs", "Main dans la main", "Notre première année", "Un amour de week-end", "Toi et moi, toujours", "Nos vacances à deux", "Le jour où tout a commencé", "Notre coin de paradis", "Pour toujours", "Un dimanche à deux", "Nos petits bonheurs", "La vie à deux", "Notre voyage de noces"],
  famille: ["Week-end chill en famille", "Nos vacances en famille", "Souvenirs de famille", "La tribu en balade", "Tous ensemble", "Notre petite tribu", "Le bonheur en famille", "Dimanche en famille", "Nos plus belles vacances", "Une journée parfaite", "La famille au complet", "Nos aventures en famille", "Un été en famille", "Les vacances de nos rêves", "Notre plus beau voyage", "Ensemble, c'est tout"],
  famille_animal: ["Week-end chill en famille", "Toute la tribu au complet", "En balade avec toute la famille", "Nos vacances en famille", "La famille et son toutou", "Personne ne manque à l'appel", "Notre joyeuse tribu", "Balade du dimanche", "Toute la bande en vacances", "Le bonheur à quatre pattes", "Nos plus belles balades", "Tous ensemble, même le chien"],
  avec_animal: ["Balade avec mon meilleur ami", "Nos belles promenades", "Inséparables", "Toujours ensemble", "Mon fidèle compagnon", "Nos balades du dimanche", "Le meilleur des copains", "Un amour à quatre pattes", "Partenaires d'aventure", "Mon complice", "Nos sorties préférées", "Rien que nous deux"],
  amis: ["Entre amis", "Les copains d'abord", "Notre week-end entre amis", "La bande au complet", "Amis pour la vie", "Nos folles virées", "La team au complet", "Les meilleurs souvenirs", "Un week-end entre potes", "Nos retrouvailles", "Toujours partants", "La bande des copains"],
  hasard: ["Nos plus beaux souvenirs", "Un jour inoubliable", "Souvenir de balade", "Tous ensemble", "Une journée parfaite", "Nos petits bonheurs", "Le souvenir d'un beau jour", "Ensemble, c'est mieux", "Un moment à nous", "Nos belles rencontres"],
};

/** Les prénoms de la 3e ligne, selon qui pose : courts, pour tenir sur une ligne. */
const PRENOMS = {
  femme: ["Julie", "Camille", "Sophie", "Léa", "Emma", "Claire", "Marie", "Laura", "Anaïs", "Pauline", "Elodie", "Céline", "Manon", "Sarah", "Lucie", "Charlotte", "Mathilde", "Aurélie", "Margaux", "Elise", "Nina", "Clara", "Agathe", "Hélène"],
  homme: ["Thomas", "Nicolas", "Julien", "Antoine", "Paul", "Hugo", "Lucas", "Pierre", "Maxime", "Louis", "Mathieu", "Romain", "Vincent", "Alexandre", "Benoît", "Guillaume", "Florian", "Adrien", "Simon", "Victor", "Martin", "Yann", "Olivier", "Baptiste"],
  fille: ["Jade", "Louise", "Alice", "Lina", "Rose", "Chloé", "Inès", "Zoé", "Mila", "Anna", "Juliette", "Lola", "Léonie", "Ambre", "Iris", "Romane", "Lou", "Eva", "Margot", "Capucine"],
  garcon: ["Léo", "Gabriel", "Raphaël", "Arthur", "Jules", "Adam", "Noah", "Tom", "Sacha", "Nathan", "Ethan", "Timothée", "Paul", "Victor", "Oscar", "Lucien", "Aaron", "Marius", "Robin", "Côme"],
  bebe: ["Lou", "Noé", "Mia", "Eden", "Lya", "Timéo", "Lenny", "Alba", "Milo", "Nour", "Gaspard", "Elia"],
  animal: ["Caramel", "Pepper", "Rex", "Filou", "Moka", "Nala", "Oscar", "Simba", "Pistache", "Ruby", "Biscuit", "Choupette", "Câlin", "Gribouille", "Praline", "Snoopy", "Loulou", "Cookie", "Tigrou", "Pompon"],
} as const;

/** Le prénom d'un personnage : par son rôle, et pour un enfant ou un ado par sa catégorie (fille, garçon). */
function listeDePrenoms(c: Candidat): readonly string[] {
  const categorie = String(c.perso.category ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  switch (c.role) {
    case "adulte_f":
      return PRENOMS.femme;
    case "adulte_h":
      return PRENOMS.homme;
    case "bebe":
      return PRENOMS.bebe;
    case "animal":
      return PRENOMS.animal;
    default:
      if (categorie.includes("fille")) return PRENOMS.fille;
      if (categorie.includes("garcon")) return PRENOMS.garcon;
      if (c.role === "autre") return [...PRENOMS.femme, ...PRENOMS.homme];
      return [...PRENOMS.fille, ...PRENOMS.garcon];
  }
}

/** « Julie, Léo, Thomas & Caramel » : un prénom par personnage, jamais deux fois le même. */
function prenomsDe(persos: readonly Candidat[], hasard: () => number): string {
  const pris = new Set<string>();
  const prenoms = persos.map((c) => {
    const libres = listeDePrenoms(c).filter((p) => !pris.has(p));
    const p = libres.length ? auHasard(libres, hasard) : auHasard(listeDePrenoms(c), hasard);
    pris.add(p);
    return p;
  });
  return prenoms.length > 1
    ? `${prenoms.slice(0, -1).join(", ")} & ${prenoms[prenoms.length - 1]}`
    : (prenoms[0] ?? "");
}

/**
 * Tire UN exemplaire d'une affiche : sa configuration complète, prête pour le
 * moteur d'impression, et le résumé que sa carte affiche.
 *
 * `bibliotheque` : le JSON de GET /characters tel quel. `hasard` : un aléa à
 * graine (alea(graineDemo(lot, rang, essai))) pour pouvoir le rejouer.
 * `fichierPresent` : le fichier « /assets/… » existe-t-il sur le disque ?
 *
 * Refusé (`refus`, une phrase pour la boutique) seulement quand l'affiche ne
 * peut pas être tirée du tout, ou qu'un fichier indispensable manque. Une
 * scène impossible ne refuse rien : elle se dégrade (cf. tirerScene).
 */
export function tirerAfficheDemo(
  affiche: AfficheDemo,
  bibliotheque: unknown,
  options: OptionsDemo,
  hasard: () => number,
  fichierPresent: (url: string) => boolean,
): { config: PosterConfig; resume: ResumeDemo } | { refus: string } {
  const lib = lireBibliotheque(bibliotheque);
  if (!lib) return { refus: "La bibliothèque des personnages n'a pas pu être lue." };
  if (options.format !== "A4" && options.format !== "A3")
    return { refus: `Le format « ${String(options.format)} » n'existe pas : A4 ou A3.` };
  const vue = vueDe(affiche);

  // Ce qu'il faut pour tirer : un décor, des personnages de ce type
  // d'affiche (dessin présent sur le disque), dont au moins un adulte.
  if (affiche.fonds.length === 0) return { refus: "Aucun décor à elle." };
  const candidats = personnagesProposes(lib, vue).filter((c) => fichierPresent(c.baseSvgUrl));
  if (candidats.length === 0)
    return { refus: `Aucun personnage proposé pour une affiche « ${nomDeLaVue(vue)} ».` };
  if (!aUnAdulte(candidats))
    return { refus: `Aucun adulte proposé pour une affiche « ${nomDeLaVue(vue)} ».` };
  const fonds = affiche.fonds.filter(
    (f) => typeof f?.url === "string" && f.url !== "" && fichierPresent(f.url),
  );
  if (fonds.length === 0) return { refus: "Le fichier de son décor manque sur le serveur." };
  const avantPlan = rempli(affiche.avantPlan);
  if (avantPlan && !fichierPresent(avantPlan))
    return { refus: "Le fichier de son décor d'avant-plan (muret, banc…) manque sur le serveur." };

  // 1. La scène : qui pose, de gauche à droite. Une famille ne prend que des
  //    humains dont la peau reçoit sa teinte commune (cf. candidatsEnFamille).
  const composition = compositionDeLaVue(vue);
  const scene = estSceneDemo(options.scene) ? options.scene : sceneDuRang("varie", 0, 0);
  const pool = SCENES_EN_FAMILLE.includes(scene) ? candidatsEnFamille(candidats, lib) : candidats;
  const tirage = tirerScene(scene, piocheDe(pool, hasard), hasard, composition === "rangee");

  // 2. Le fond : l'un des siens. Retrouvés par le nom de la ville, le
  //    premier : celui que le module présélectionne (index.tsx l.233-237),
  //    les suivants pouvant être ceux d'une autre affiche de la ville.
  //    L'appelant écarte l'affiche quand plusieurs se partagent la tête de
  //    liste : rien ne dit alors lequel le module montre (affiches-demo.ts).
  const fond = affiche.fondsParLeNom ? fonds[0]! : auHasard(fonds, hasard);

  // 3. Les textes (20/11, Alexandra : « 1ere ligne on prend la ville, et 2 et
  //    3 faudrait générer du contenu random en fonction de ce qu'on
  //    sélectionne […] 2 : week end chill en famille et 3 : les prénoms des
  //    membres de la famille (animaux inclus s'il y a) ») : la ville, sinon
  //    la 1re ligne de l'affiche, sinon son nom, en capitales (charte) ; une
  //    phrase de la scène RÉELLEMENT tirée (dégradée comprise) ; les prénoms
  //    des personnages, de gauche à droite. Le texte suit chaque exemplaire :
  //    « Varié » garde donc tout son sens.
  const titre = rempli(villeDuNom(affiche.nom)) ?? rempli(affiche.titre) ?? String(affiche.nom ?? "");
  const lines = lignesEnregistrees({
    lignes: [
      { value: titre.toLocaleUpperCase("fr-FR"), font: policeDefautLigne(0) },
      { value: auHasard(PHRASES_DE_SCENE[tirage.scene], hasard), font: policeDefautLigne(1) },
      { value: prenomsDe(tirage.persos, hasard), font: policeDefautLigne(2) },
    ],
    textStyle: {
      color: couleurTexteParValeur(options.couleurTexte)?.hex ?? COULEUR_TEXTE_DEFAUT,
      size: 1,
    },
  });

  // 4. Les personnages, habillés un à un.
  const peauCommune = SCENES_EN_FAMILLE.includes(tirage.scene) ? hasard() : null;
  const habilles = tirage.persos.map((candidat, i) =>
    habiller(candidat, i, vue, lib, hasard, fichierPresent, peauCommune),
  );

  // 5. Leurs places : la composition automatique du module, avec le même
  //    étalon (placementsAffiche, store.ts l.527). Le tableau n'est PAS trié :
  //    le fichier d'impression relit x, y, échelle et plan tels quels.
  const places = composerPersonnages(
    tirage.persos.map((c) => aComposer(c.perso)),
    composition,
    etalonDeLaVue(lib.characters, vue),
  );
  // Sérialisés comme configFromState (store.ts l.560-583) : sans les
  // emplacements vides, et `position` = le plan de dessin.
  const characters = habilles.map((wc, i) => {
    const p = places[i]!;
    const assets: Record<string, string | number> = {};
    for (const slot of SLOTS) {
      const v = wc.assets[slot];
      if (v !== undefined) assets[slot] = v;
    }
    return {
      typeId: wc.characterId,
      position: p.plan,
      x: p.x,
      y: p.y,
      scale: p.scale,
      assets,
      colors: { ...wc.colors },
    };
  });

  // 6. La configuration, vérifiée par le schéma des commandes. Ni sens de la
  //    feuille (portrait, comme toutes les affiches composées), ni cadre :
  //    un cadre ne s'imprime pas.
  const lue = posterConfigSchema.safeParse({
    schemaVersion: 1,
    productId: affiche.productId,
    backgroundId: fond.id,
    // Le chemin BRUT (« /assets/… »), comme le module : c'est lui que le
    // fichier d'impression lit en premier.
    backgroundUrl: fond.url,
    ...(avantPlan ? { foregroundUrl: avantPlan } : {}),
    format: options.format,
    view: vue,
    frameId: null,
    texts: { lines },
    characters,
  });
  if (!lue.success) return { refus: "Le tirage n'a pas donné une configuration valable." };
  const raison = controler(lue.data, lib, vue, fichierPresent);
  if (raison) return { refus: raison };

  return {
    config: lue.data,
    resume: {
      scene: tirage.scene,
      degradee: tirage.degradee,
      personnages: tirage.persos.map((c) => rempli(c.perso.name) ?? `#${c.perso.id}`),
      decor: fond.nom,
    },
  };
}
