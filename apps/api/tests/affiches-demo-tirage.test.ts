/**
 * Le tirage des affiches de démonstration, sans base de données.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/affiches-demo-tirage.test.ts
 *
 * Une affiche tirée au hasard doit être une affiche que le module de
 * personnalisation aurait pu produire : sinon Margaux montrerait sur son
 * stand une affiche que personne ne peut commander. Ces essais le vérifient
 * sur une petite bibliothèque factice, de la forme exacte de GET /characters,
 * en tirant des centaines d'exemplaires : personnages de la vue, pièces
 * autorisées, couleurs des pastilles proposées, places de la composition
 * automatique, textes rangés comme le module les range. Les attentes sont
 * recalculées ici depuis les données, et non avec le code essayé.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  afficheComposee,
  composerPersonnages,
  compositionDeLaVue,
  couleursDuGroupePourScope,
  hauteurDuDessin,
  pastillesDeLaRangee,
  policesDeLaLigne,
  posterConfigSchema,
  principaleDeLaPiece,
  type GroupeCouleur,
  type PosterConfig,
} from "@memoryline/types";
import {
  ROLES_DEMO,
  SCENES_DEMO,
  alea,
  graineDemo,
  roleDeCategorie,
  sceneDuRang,
  tirabilite,
  tirerAfficheDemo,
  type AfficheDemo,
  type OptionsDemo,
  type ResumeDemo,
  type SceneDemo,
} from "../src/affiches-demo-tirage.js";

/* -------------------------------------------------------------------------- */
/*  Bibliothèque factice (forme de GET /characters)                            */
/* -------------------------------------------------------------------------- */

type Zones = Record<string, string>;

interface Piece {
  id: number;
  slot: string;
  name: string;
  svgUrl: string;
  view: string;
  colorZones: Zones | null;
  zonesMasquees: null;
  partsDesZones: Record<string, number> | null;
  groupesCouleurs: GroupeCouleur[] | null;
  couleursImage: null;
  position: number;
  pieceCategoryId: number | null;
  emprise: null;
}

function piece(
  id: number,
  slot: string,
  view: string,
  position: number,
  colorZones: Zones | null,
  extra: Partial<Piece> = {},
): Piece {
  return {
    id,
    slot,
    name: `Pièce ${id}`,
    svgUrl: `/assets/piece-${id}.svg`,
    view,
    colorZones,
    zonesMasquees: null,
    partsDesZones: null,
    groupesCouleurs: null,
    couleursImage: null,
    position,
    pieceCategoryId: { clothes: 1, pants: 2, hair: 3, accessory: 4 }[slot] ?? null,
    emprise: null,
    ...extra,
  };
}

const EMPRISE_ADULTE = { gauche: 0.2, droite: 0.8, haut: 0.03, bas: 0.97 };
const EMPRISE_ENFANT = { gauche: 0.3, droite: 0.7, haut: 0.25, bas: 0.97 };
const EMPRISE_BEBE = { gauche: 0.35, droite: 0.65, haut: 0.7, bas: 0.97 };
const EMPRISE_ANIMAL = { gauche: 0.3, droite: 0.75, haut: 0.75, bas: 0.97 };

interface Perso {
  id: number;
  slug: string;
  name: string;
  category: string | null;
  categoryId: number | null;
  position: number;
  archived: boolean;
  active: boolean;
  baseSvgUrl: string;
  baseColorZones: Zones | null;
  baseGroupesCouleurs: GroupeCouleur[] | null;
  baseZonesProposees: string[] | null;
  baseCouleursImage: unknown;
  orientation: string;
  bottomPct: number;
  facteurTaille: number;
  decalageX: number;
  slotVariants: Partial<Record<"clothes" | "pants" | "hair" | "accessory", number[]>> | null;
  slotAdjust: null;
  defaultAssets: Partial<Record<"clothes" | "pants" | "hair" | "accessory", number>> | null;
  emprise: { gauche: number; droite: number; haut: number; bas: number } | null;
}

const SANS_PIECE = { clothes: [], pants: [], hair: [], accessory: [] };

function perso(id: number, name: string, category: string | null, orientation: string, extra: Partial<Perso> = {}): Perso {
  return {
    id,
    slug: `perso-${id}`,
    name,
    category,
    categoryId: null,
    position: id,
    archived: false,
    active: true,
    baseSvgUrl: `/assets/perso-${id}.svg`,
    baseColorZones: { st0: "#E1B480", st1: "#3B2A20" },
    baseGroupesCouleurs: null,
    baseZonesProposees: null,
    baseCouleursImage: null,
    orientation,
    bottomPct: 0.97,
    facteurTaille: 1,
    decalageX: 0,
    slotVariants: { clothes: [1, 2], pants: [1], hair: [1, 2], accessory: [1] },
    slotAdjust: null,
    defaultAssets: null,
    emprise: EMPRISE_ADULTE,
    ...extra,
  };
}

const NUANCIERS = {
  peau: ["#FFEEE0", "#F6D2A9", "#E1B480", "#8B5B38"],
  cheveux: ["#E8E8E8", "#24222C"],
  vetements: ["#FAFAFA", "#000000"],
  pantalon: ["#545454", "#EDD7C6"],
};

const CATEGORIES = [
  { id: 1, slug: "vetements", name: "Vêtements", slot: "clothes", colors: ["#FFFFFF", "#BD1212", "#0056AF", "#000000"], couleursProposees: "toutes" },
  { id: 2, slug: "pantalons", name: "Pantalons", slot: "pants", colors: ["#EDD7C6", "#165176", "#545454"], couleursProposees: "toutes" },
  { id: 3, slug: "coupes", name: "Coupes", slot: "hair", colors: ["#E8E8E8", "#E7B033", "#6B3E1E", "#24222C"], couleursProposees: "toutes" },
  { id: 4, slug: "accessoires", name: "Accessoires", slot: "accessory", colors: ["#FFFFFF", "#BD1212"], couleursProposees: "toutes" },
];

const SLOTS_FACE = {
  clothes: [
    // Un t-shirt dont l'ombre (st1) est réunie à sa couleur principale (st0).
    piece(101, "clothes", "front", 1, { st0: "#3366CC", st1: "#24478F", st2: "#FFFFFF" }, {
      groupesCouleurs: [{ zone: "st0", nuances: ["st1"] }, { zone: "st2" }],
      partsDesZones: { st0: 0.6, st1: 0.2, st2: 0.2 },
    }),
    piece(102, "clothes", "front", 2, { st0: "#2E8B57", st3: "#F0E68C" }, { partsDesZones: { st0: 0.7, st3: 0.3 } }),
    // Une robe dont la partie principale a SA liste de couleurs.
    piece(103, "clothes", "front", 3, { st0: "#C71585" }, {
      groupesCouleurs: [{ zone: "st0", couleurs: ["#C71585", "#FFC0CB", "#800080"] }],
    }),
    // Son dessin manque sur le disque : jamais tirée.
    piece(104, "clothes", "front", 4, { st0: "#FFFFFF" }, { svgUrl: "/assets/manquant-chemise.svg" }),
  ],
  pants: [
    piece(111, "pants", "front", 1, { st0: "#165176", st1: "#0E3550" }),
    piece(112, "pants", "front", 2, { st0: "#545454" }),
    // Sans catégorie : le nuancier « pantalon » des personnages.
    piece(113, "pants", "front", 3, { st0: "#EDD7C6" }, { pieceCategoryId: null }),
  ],
  hair: [
    piece(121, "hair", "front", 1, { st0: "#6B3E1E" }),
    piece(122, "hair", "front", 2, { st0: "#24222C", st1: "#3A3845" }),
    piece(123, "hair", "front", 3, { st0: "#E7B033" }),
  ],
  accessory: [piece(131, "accessory", "front", 1, { st0: "#2B2218" })],
};

const SLOTS_DOS = {
  clothes: [
    piece(201, "clothes", "back", 1, { st0: "#AA3333" }),
    piece(202, "clothes", "back", 2, { st0: "#3333AA", st1: "#FFFFFF" }),
  ],
  pants: [piece(211, "pants", "back", 1, { st0: "#165176" })],
  hair: [piece(221, "hair", "back", 1, { st0: "#6B3E1E" }), piece(222, "hair", "back", 2, { st0: "#E7B033" })],
  accessory: [],
};

const PERSONNAGES: Perso[] = [
  // --- De face
  perso(1, "Femme 1", "Femmes", "front", {
    slotVariants: { clothes: [1, 2, 3, 4], pants: [1, 3], hair: [1, 2, 3], accessory: [1] },
    defaultAssets: { clothes: 1 },
  }),
  // Une peau avec son ombre : la nuance suit la teinte tirée.
  perso(2, "Femme 2", "Femmes", "front", {
    baseColorZones: { st0: "#F6D2A9", st1: "#D9B48C", st2: "#222222" },
    baseGroupesCouleurs: [{ zone: "st0", nuances: ["st1"] }],
    slotVariants: { clothes: [2], pants: [2], hair: [2, 3], accessory: [] },
  }),
  // Non lié à ses pièces : sa tenue par défaut, et rien d'autre.
  perso(3, "Homme 1", "Hommes", "front", { slotVariants: null, defaultAssets: { clothes: 2, pants: 1 } }),
  // Deux groupes de base proposés : seule la peau (le premier) est tirée.
  perso(4, "Homme 2", "Hommes", "front", {
    baseColorZones: { st0: "#8B5B38", st2: "#556B2F" },
    baseGroupesCouleurs: [{ zone: "st0", nuancier: "peau" }, { zone: "st2", nuancier: "vetements" }],
    baseZonesProposees: ["st0", "st2"],
    slotVariants: { clothes: [1, 3], pants: [1, 2], hair: [1], accessory: [1] },
  }),
  // Haute de 0,83 : « petite » à côté de l'étalon (le personnage masqué,
  // 1,089), « grande » si l'étalon l'oubliait (0,94) — sa place le dit.
  perso(5, "Ado fille 1", "Ados", "front", {
    baseColorZones: { st0: "#FFEEE0" },
    slotVariants: { clothes: [1], pants: [1], hair: [1], accessory: [] },
    emprise: { gauche: 0.22, droite: 0.78, haut: 0.14, bas: 0.97 },
  }),
  perso(6, "Fille 1", "Filles", "front", {
    emprise: null,
    slotVariants: { clothes: [3], pants: [], hair: [3], accessory: [] },
  }),
  perso(7, "Garçon 1", "Garçons", "front", { emprise: EMPRISE_ENFANT }),
  perso(8, "Bébé fille", "Bébés", "front", { emprise: EMPRISE_BEBE, slotVariants: { clothes: [2], pants: [], hair: [], accessory: [] } }),
  perso(9, "Chien 1", "Animaux", "front", {
    baseColorZones: { st0: "#8B5B38", st1: "#222222" },
    slotVariants: SANS_PIECE,
    emprise: EMPRISE_ANIMAL,
    facteurTaille: 0.9,
  }),
  // Un animal dessiné en pixels : aucune couleur à tirer.
  perso(10, "Chat photo", "Animaux", "front", {
    baseColorZones: null,
    baseCouleursImage: { familles: [{ cle: "fam0", reference: "#AA7744", part: 1, proposee: true }] },
    slotVariants: SANS_PIECE,
    emprise: EMPRISE_ANIMAL,
  }),
  perso(11, "Femme fauteuil roulant", "Fauteuil roulant", "front", {
    slotVariants: { clothes: [1], pants: [], hair: [1], accessory: [] },
    emprise: EMPRISE_ENFANT,
  }),
  // Masqué au back-office, mais le plus grand : il compte dans l'étalon.
  perso(12, "Homme masqué", "Hommes", "front", {
    active: false,
    facteurTaille: 1.1,
    emprise: { gauche: 0.2, droite: 0.8, haut: 0.0, bas: 0.99 },
  }),
  // Archivé (l'API ne l'envoie qu'avec ?all=1) : ni tiré, ni dans l'étalon.
  perso(13, "Femme archivée", "Femmes", "front", { archived: true, facteurTaille: 1.5 }),
  perso(14, "Femme sans fichier", "Femmes", "front", { baseSvgUrl: "/assets/manquant-femme.svg" }),
  // Catégorie archivée : l'API envoie `category: null`.
  perso(15, "Sans catégorie", null, "front"),
  // --- De dos : aucun animal
  perso(21, "Femme dos", "Femmes", "back", { slotVariants: { clothes: [1, 2], pants: [1], hair: [1, 2], accessory: [] } }),
  perso(22, "Homme dos", "Hommes", "back", { slotVariants: { clothes: [1, 2], pants: [1], hair: [1], accessory: [] } }),
  perso(23, "Fille dos", "Filles", "back", { emprise: EMPRISE_ENFANT, slotVariants: { clothes: [2], pants: [1], hair: [2], accessory: [] } }),
  perso(24, "Bébé dos", "Bébés", "back", { emprise: EMPRISE_BEBE, slotVariants: { clothes: [], pants: [], hair: [], accessory: [] } }),
];

const BIBLIOTHEQUE = {
  pieceCategories: CATEGORIES,
  nuanciersBase: NUANCIERS,
  characters: PERSONNAGES,
  slots: {
    front: SLOTS_FACE,
    back: SLOTS_DOS,
    // Un type créé au back-office, sans personnage.
    maries: { clothes: [], pants: [], hair: [], accessory: [] },
  },
};

const present = (url: string) => !url.includes("manquant");

const FACE: AfficheDemo = {
  productId: 12,
  nom: "MULHOUSE Place de la Réunion",
  titre: null,
  sousTitre: "Famille Muller",
  ligne3: "Noël 2026",
  vue: "front",
  avantPlan: "/assets/banc.svg",
  fonds: [
    { id: 45, url: "/assets/mulhouse-1.svg", nom: "Mulhouse 1" },
    { id: 46, url: "/assets/mulhouse-2.svg", nom: "Mulhouse 2" },
  ],
  fondsParLeNom: false,
};

const DOS: AfficheDemo = {
  ...FACE,
  productId: 13,
  nom: "COLMAR Petite Venise",
  titre: "Colmar",
  sousTitre: null,
  ligne3: null,
  vue: "back",
  avantPlan: "/assets/muret_officiel.svg",
  fonds: [{ id: 47, url: "/assets/colmar.svg", nom: "Colmar" }],
};

function options(scene: SceneDemo, extra: Partial<OptionsDemo> = {}): OptionsDemo {
  return { format: "A4", scene, nomsLigne2: [], couleurTexte: "#FFFFFF", ...extra };
}

const SCENES: readonly SceneDemo[] = ["couple", "famille", "famille_animal", "avec_animal", "amis", "hasard"];

interface Tire {
  config: PosterConfig;
  resume: ResumeDemo;
}

function tirer(affiche: AfficheDemo, opts: OptionsDemo, graine: number, bib: unknown = BIBLIOTHEQUE): Tire {
  const r = tirerAfficheDemo(affiche, bib, opts, alea(graine), present);
  if ("refus" in r) assert.fail(`tirage refusé : ${r.refus}`);
  return r;
}

/** Des centaines de tirages, toutes scènes, de face et de dos. */
const TIRAGES: { affiche: AfficheDemo; scene: SceneDemo; tire: Tire }[] = [];
for (const affiche of [FACE, DOS])
  for (const scene of SCENES)
    for (let rang = 0; rang < 60; rang++)
      TIRAGES.push({ affiche, scene, tire: tirer(affiche, options(scene), graineDemo(7, rang, SCENES.indexOf(scene))) });

const parId = new Map(PERSONNAGES.map((p) => [String(p.id), p]));
function personnageDe(typeId: string | number): Perso {
  const p = parId.get(String(typeId));
  assert.ok(p, `personnage inconnu ${typeId}`);
  return p;
}

function piecesDeLaVue(vue: string): Record<string, Piece[]> {
  return vue === "back" ? SLOTS_DOS : SLOTS_FACE;
}

/** Les identifiants que le module propose à ce personnage dans cet emplacement. */
function idsPermis(p: Perso, slot: "clothes" | "pants" | "hair" | "accessory"): Set<string> {
  const tiroir = piecesDeLaVue(p.orientation)[slot] ?? [];
  if (!p.slotVariants) return new Set(tiroir.map((v) => String(v.id)));
  return new Set(
    (p.slotVariants[slot] ?? [])
      .map((pos) => tiroir.find((v) => v.position === pos))
      .filter((v): v is Piece => v !== undefined)
      .map((v) => String(v.id)),
  );
}

function pieceDe(vue: string, slot: string, id: string | number): Piece {
  const v = (piecesDeLaVue(vue)[slot] ?? []).find((x) => String(x.id) === String(id));
  assert.ok(v, `pièce inconnue ${slot} ${id}`);
  return v;
}

const HUMAINS = new Set(["Femmes", "Hommes", "Ados", "Filles", "Garçons", "Bébés"]);

/* -------------------------------------------------------------------------- */
/*  Rôles, scènes, graines                                                     */
/* -------------------------------------------------------------------------- */

test("le rôle se lit dans le nom de la catégorie, sans accents ni capitales", () => {
  assert.equal(roleDeCategorie("Femmes"), "adulte_f");
  assert.equal(roleDeCategorie("Femmes âgées"), "adulte_f");
  assert.equal(roleDeCategorie("Hommes"), "adulte_h");
  assert.equal(roleDeCategorie("Ados"), "ado");
  assert.equal(roleDeCategorie("Filles"), "enfant");
  assert.equal(roleDeCategorie("Garçons"), "enfant");
  assert.equal(roleDeCategorie("  BÉBÉS "), "bebe");
  assert.equal(roleDeCategorie("Animaux"), "animal");
  for (const autre of ["Fauteuil roulant", "Mariés", "", null, undefined])
    assert.equal(roleDeCategorie(autre), "autre", String(autre));
});

test("les scènes et les rôles du back-office : « Varié » d'abord, chaque rôle une fois", () => {
  assert.equal(SCENES_DEMO[0]!.cle, "varie");
  assert.deepEqual(
    SCENES_DEMO.map((s) => s.cle),
    ["varie", "couple", "famille", "famille_animal", "avec_animal", "amis", "hasard"],
  );
  for (const s of SCENES_DEMO) assert.ok(s.libelle && s.aide, s.cle);
  assert.deepEqual(
    ROLES_DEMO.map((r) => r.role),
    ["adulte_f", "adulte_h", "ado", "enfant", "bebe", "animal", "autre"],
  );
});

test("« Varié » fait tourner les scènes : deux rangs voisins n'ont jamais la même", () => {
  assert.equal(sceneDuRang("couple", 5, 3), "couple");
  assert.equal(sceneDuRang("hasard", 0, 0), "hasard");
  const vues = new Set<SceneDemo>();
  for (const depart of [0, 1, 4, 6, 123])
    for (let rang = 0; rang < 30; rang++) {
      const ici = sceneDuRang("varie", rang, depart);
      vues.add(ici);
      assert.notEqual(ici, sceneDuRang("varie", rang + 1, depart), `rang ${rang}, départ ${depart}`);
    }
  for (const s of ["famille", "couple", "famille_animal", "avec_animal", "amis"] as const) assert.ok(vues.has(s), s);
  // Une valeur abîmée ne casse rien.
  assert.ok(SCENES.includes(sceneDuRang("varie", Number.NaN, Number.POSITIVE_INFINITY)));
});

test("1. même graine, même affiche ; autre graine, autre affiche", () => {
  for (const scene of SCENES) {
    const a = tirer(FACE, options(scene), graineDemo(3, 4, 0));
    const b = tirer(FACE, options(scene), graineDemo(3, 4, 0));
    assert.deepEqual(a, b, scene);
  }
  const graines = new Set<number>();
  for (let lot = 1; lot <= 5; lot++)
    for (let rang = 0; rang < 40; rang++)
      for (let essai = 0; essai < 3; essai++) graines.add(graineDemo(lot, rang, essai));
  assert.equal(graines.size, 5 * 40 * 3, "deux exemplaires ont la même graine");
  const configs = new Set<string>();
  for (let rang = 0; rang < 30; rang++)
    configs.add(JSON.stringify(tirer(FACE, options("famille"), graineDemo(3, rang, 0)).config));
  assert.ok(configs.size >= 28, `${configs.size} affiches différentes sur 30`);
  // « Refaire au hasard » : l'essai suivant donne une autre affiche.
  assert.notDeepEqual(
    tirer(FACE, options("famille"), graineDemo(3, 4, 0)).config,
    tirer(FACE, options("famille"), graineDemo(3, 4, 1)).config,
  );
  const u = alea(42);
  for (let i = 0; i < 1000; i++) {
    const x = u();
    assert.ok(x >= 0 && x < 1, String(x));
  }
});

/* -------------------------------------------------------------------------- */
/*  Personnages, pièces, couleurs                                              */
/* -------------------------------------------------------------------------- */

test("2. seulement des personnages de la vue, proposés, non archivés, dessin présent", () => {
  for (const { affiche, tire } of TIRAGES) {
    const ids = tire.config.characters.map((c) => String(c.typeId));
    assert.equal(new Set(ids).size, ids.length, "le même personnage deux fois");
    for (const c of tire.config.characters) {
      const p = personnageDe(c.typeId);
      assert.equal(p.orientation, affiche.vue, p.name);
      assert.ok(p.active && !p.archived, p.name);
      assert.ok(present(p.baseSvgUrl), p.name);
    }
    assert.ok(tire.config.characters.some((c) => ["Femmes", "Hommes"].includes(personnageDe(c.typeId).category ?? "")), "aucun adulte");
  }
  // Un type d'affiche sans personnage : refusé, avec sa raison.
  const vide = { ...FACE, vue: "maries" };
  const r = tirerAfficheDemo(vide, BIBLIOTHEQUE, options("couple"), alea(1), present);
  assert.ok("refus" in r && /Aucun personnage proposé pour une affiche « maries »/.test(r.refus));
  // De dos, sans aucun adulte : refusé aussi.
  const sansAdulte = { ...BIBLIOTHEQUE, characters: PERSONNAGES.filter((p) => p.orientation === "back" && !["Femmes", "Hommes"].includes(p.category ?? "")) };
  const r2 = tirerAfficheDemo(DOS, sansAdulte, options("famille"), alea(1), present);
  assert.ok("refus" in r2 && /Aucun adulte proposé pour une affiche « De dos »/.test(r2.refus));
});

test("« Fauteuil roulant » et les catégories inconnues ne viennent que par « Au hasard »", () => {
  let auHasard = 0;
  for (const { scene, tire } of TIRAGES) {
    const autres = tire.config.characters.filter((c) => [11, 15].includes(Number(c.typeId))).length;
    if (scene === "hasard") auHasard += autres;
    else assert.equal(autres, 0, `${scene} : un personnage « autre »`);
  }
  assert.ok(auHasard > 0, "« Au hasard » ne les tire jamais");
});

test("3. pièces : celles du personnage (identifiants, pas positions), tenue par défaut seule s'il n'est pas lié, jamais « aucun »", () => {
  let changees = 0;
  for (const { tire } of TIRAGES)
    for (const c of tire.config.characters) {
      const p = personnageDe(c.typeId);
      for (const [slot, id] of Object.entries(c.assets)) {
        assert.notEqual(id, "none", `${p.name} ${slot}`);
        assert.ok(["clothes", "pants", "hair", "accessory"].includes(slot), slot);
        assert.ok(idsPermis(p, slot as "clothes").has(String(id)), `${p.name} : ${slot} ${id} non proposé`);
        assert.notEqual(Number(id), 104, "une pièce dont le dessin manque");
      }
      if (!p.slotVariants) {
        // Homme 1 : clothes position 2 → 102, pants position 1 → 111.
        assert.deepEqual(c.assets, { clothes: 102, pants: 111 }, p.name);
      }
      if (p.id === 1 && c.assets.clothes !== 101) changees++;
    }
  assert.ok(changees > 0, "la tenue par défaut ne change jamais");
});

test("une pièce portée d'office dont le dessin manque est remplacée par une pièce présente", () => {
  const bib = {
    ...BIBLIOTHEQUE,
    characters: [
      perso(1, "Femme 1", "Femmes", "front", { slotVariants: { clothes: [1, 4], pants: [], hair: [], accessory: [] }, defaultAssets: { clothes: 4 } }),
      perso(3, "Homme 1", "Hommes", "front", { slotVariants: SANS_PIECE }),
    ],
  };
  for (let rang = 0; rang < 30; rang++) {
    const { config } = tirer(FACE, options("couple"), graineDemo(9, rang, 0), bib);
    const femme = config.characters.find((c) => Number(c.typeId) === 1)!;
    assert.equal(femme.assets.clothes, 101);
  }
  // Sans pièce de rechange (personnage non lié) : refus lisible, pas de rendu raté.
  const bib2 = {
    ...BIBLIOTHEQUE,
    characters: [
      perso(1, "Femme 1", "Femmes", "front", { slotVariants: null, defaultAssets: { clothes: 4 } }),
      perso(3, "Homme 1", "Hommes", "front", { slotVariants: SANS_PIECE }),
    ],
  };
  const r = tirerAfficheDemo(FACE, bib2, options("couple"), alea(1), present);
  assert.ok("refus" in r && /Le dessin de la pièce « Pièce 104 » manque/.test(r.refus), JSON.stringify(r));
});

test("4. couleurs : clés « scope:zone » en #RRGGBB, prises dans les pastilles proposées, ombres recalculées", () => {
  let recolorees = 0;
  let ombresSuivies = 0;
  for (const { affiche, tire } of TIRAGES)
    for (const c of tire.config.characters) {
      const p = personnageDe(c.typeId);
      const colors = c.colors ?? {};
      for (const [cle, hex] of Object.entries(colors)) {
        assert.match(cle, /^(base|clothes|pants|hair|accessory):st\d+$/, `${p.name} ${cle}`);
        assert.match(hex, /^#[0-9A-Fa-f]{6}$/, `${p.name} ${cle}=${hex}`);
      }
      // Les couleurs de la base sont toutes là (figées) ; seule la peau d'un
      // humain peut avoir changé.
      for (const [zone, defaut] of Object.entries(p.baseColorZones ?? {})) {
        const cle = `base:${zone}`;
        assert.ok(cle in colors, `${p.name} : ${cle} manque`);
        const peau = HUMAINS.has(p.category ?? "") ? (p.baseGroupesCouleurs?.[0]?.zone ?? "st0") : null;
        const nuancesDeLaPeau = peau ? (p.baseGroupesCouleurs?.[0]?.nuances ?? []) : [];
        if (zone === peau) assert.ok(NUANCIERS.peau.includes(colors[cle]!), `${p.name} : peau ${colors[cle]}`);
        else if (!nuancesDeLaPeau.includes(zone)) assert.equal(colors[cle], defaut, `${p.name} : ${cle}`);
      }
      // Femme 2 : l'ombre de la peau suit la teinte tirée.
      if (p.id === 2) {
        const g = p.baseGroupesCouleurs![0]!;
        assert.equal(colors["base:st1"], couleursDuGroupePourScope("base", g, p.baseColorZones, colors["base:st0"]!)["base:st1"]);
      }
      for (const slot of ["clothes", "pants", "hair", "accessory"] as const) {
        const cles = Object.keys(colors).filter((k) => k.startsWith(`${slot}:`));
        const id = c.assets[slot];
        if (id === undefined) {
          assert.equal(cles.length, 0, `${p.name} : couleurs d'une pièce retirée (${cles})`);
          continue;
        }
        const v = pieceDe(affiche.vue, slot, id);
        const zones = v.colorZones ?? {};
        // Aucune clé d'une autre pièce, et toutes celles de la pièce portée.
        assert.deepEqual(new Set(cles), new Set(Object.keys(zones).map((z) => `${slot}:${z}`)), `${p.name} ${slot}`);
        const g = principaleDeLaPiece(v)!;
        const choisie = colors[`${slot}:${g.zone}`]!;
        const tete = new Set([g.zone, ...(g.nuances ?? [])]);
        for (const [zone, defaut] of Object.entries(zones))
          if (!tete.has(zone)) assert.equal(colors[`${slot}:${zone}`], defaut, `${p.name} ${slot}:${zone} bariolé`);
        if (choisie === zones[g.zone]) continue;
        // Recolorée : jamais un accessoire, toujours une pastille proposée, ombres comprises.
        assert.notEqual(slot, "accessory", `${p.name} : accessoire recoloré`);
        recolorees++;
        const cat = CATEGORIES.find((k) => k.id === v.pieceCategoryId);
        const repli = slot === "hair" ? NUANCIERS.cheveux : slot === "pants" ? NUANCIERS.pantalon : NUANCIERS.vetements;
        const palette = pastillesDeLaRangee(slot, g.couleurs, cat?.colors, repli).couleurs;
        assert.ok(palette.includes(choisie), `${p.name} ${slot} : ${choisie} hors de ${palette}`);
        const attendues = couleursDuGroupePourScope(slot, g, zones, choisie);
        for (const [cle, hex] of Object.entries(attendues)) assert.equal(colors[cle], hex, `${p.name} ${cle}`);
        if ((g.nuances ?? []).length) ombresSuivies++;
      }
    }
  assert.ok(recolorees > 50, `seulement ${recolorees} pièces recolorées`);
  assert.ok(ombresSuivies > 5, `seulement ${ombresSuivies} ombres suivies`);
});

test("4 bis. la robe à liste propre ne prend que ses couleurs ; la pièce sans catégorie, le nuancier de l'emplacement", () => {
  const robe: string[] = [];
  const pantalon: string[] = [];
  for (const { tire } of TIRAGES)
    for (const c of tire.config.characters) {
      if (c.assets.clothes === 103) robe.push(c.colors!["clothes:st0"]!);
      if (c.assets.pants === 113) pantalon.push(c.colors!["pants:st0"]!);
    }
  assert.ok(robe.length > 0 && pantalon.length > 0);
  for (const hex of robe) assert.ok(["#C71585", "#FFC0CB", "#800080"].includes(hex), hex);
  for (const hex of pantalon) assert.ok(NUANCIERS.pantalon.includes(hex), hex);
});

test("4 ter. une famille a la même peau ; entre amis ou au hasard, chacun la sienne", () => {
  let melanges = 0;
  for (const { tire } of TIRAGES) {
    const peaux = new Set(
      tire.config.characters
        .filter((c) => HUMAINS.has(personnageDe(c.typeId).category ?? ""))
        .map((c) => c.colors!["base:st0"]),
    );
    if (["couple", "famille", "famille_animal", "avec_animal"].includes(tire.resume.scene))
      assert.ok(peaux.size <= 1, `${tire.resume.scene} : ${[...peaux]}`);
    else if (peaux.size > 1) melanges++;
  }
  assert.ok(melanges > 0, "entre amis, tout le monde a la même peau");
});

test("les animaux et les dessins en pixels gardent leurs couleurs", () => {
  for (const { tire } of TIRAGES)
    for (const c of tire.config.characters) {
      const p = personnageDe(c.typeId);
      if (p.category !== "Animaux") continue;
      const attendu = Object.fromEntries(Object.entries(p.baseColorZones ?? {}).map(([z, h]) => [`base:${z}`, h]));
      assert.deepEqual(c.colors, attendu, p.name);
      assert.deepEqual(c.assets, {}, p.name);
    }
});

/* -------------------------------------------------------------------------- */
/*  Composition, textes, configuration                                         */
/* -------------------------------------------------------------------------- */

/** L'étalon recalculé : le plus grand dessin de la vue, inactifs compris, archivés exclus. */
function etalon(vue: string): number | null {
  const h = PERSONNAGES.filter((p) => !p.archived && p.orientation === vue)
    .map((p) => hauteurDuDessin({ facteur: p.facteurTaille, decalage: p.decalageX, emprise: p.emprise }))
    .filter((x): x is number => x !== null);
  return h.length ? Math.max(...h) : null;
}

test("5. places : celles de la composition automatique, dans l'ordre de la liste", () => {
  assert.ok(Math.abs(etalon("front")! - 0.99 * 1.1) < 1e-9, "l'étalon compte le personnage masqué");
  const bornes: Record<SceneDemo, [number, number]> = {
    couple: [2, 2],
    famille: [3, 5],
    famille_animal: [4, 5],
    avec_animal: [2, 3],
    amis: [3, 4],
    hasard: [2, 5],
  };
  for (const { affiche, scene, tire } of TIRAGES) {
    const persos = tire.config.characters.map((c) => personnageDe(c.typeId));
    const places = composerPersonnages(
      persos.map((p) => ({ facteur: p.facteurTaille, decalage: p.decalageX, emprise: p.emprise })),
      compositionDeLaVue(affiche.vue),
      etalon(affiche.vue),
    );
    tire.config.characters.forEach((c, i) => {
      assert.equal(c.x, places[i]!.x);
      assert.equal(c.y, places[i]!.y);
      assert.equal(c.scale, places[i]!.scale);
      assert.equal(c.position, places[i]!.plan);
    });
    const n = tire.config.characters.length;
    assert.ok(n >= 1 && n <= 6);
    if (affiche.vue === "front") {
      const [mini, maxi] = bornes[scene];
      assert.ok(n >= mini && n <= maxi, `${scene} : ${n} personnages`);
    }
    // Les familles : la femme à gauche, l'homme après les enfants.
    if (scene === "famille" && !tire.resume.degradee) {
      assert.equal(persos[0]!.category, "Femmes");
      assert.equal(persos[persos.length - 1]!.category, "Hommes");
    }
    if (scene === "famille_animal" && affiche.vue === "front") {
      assert.equal(persos[0]!.category, "Femmes");
      assert.equal(persos[persos.length - 2]!.category, "Hommes");
      assert.equal(persos[persos.length - 1]!.category, "Animaux");
    }
    // De dos, au hasard : des adultes aux deux bouts de la rangée.
    if (scene === "hasard" && affiche.vue === "back")
      assert.ok(["Femmes", "Hommes"].includes(persos[0]!.category ?? ""), "un enfant au bout de la rangée");
    // Le résumé suit la liste.
    assert.deepEqual(tire.resume.personnages, persos.map((p) => p.name));
  }
});

test("6. textes : la ville en capitales, une phrase de la scène, les prénoms de gauche à droite (20/11)", () => {
  // La 1re ligne : la ville, en capitales — même si l'affiche a sa propre 1re ligne.
  const face = tirer(FACE, options("couple"), 1);
  const lf = face.config.texts.lines!;
  assert.equal(lf[0]!.value, "MULHOUSE");
  assert.equal(lf.length, 3);
  // La 3e ligne : un prénom par personnage, « A & B » pour un couple.
  assert.equal(lf[2]!.value.split(/, | & /).length, face.config.characters.length);
  // Ni ville dans le nom : la 1re ligne de l'affiche, sinon le nom entier.
  const sansVille = tirer({ ...FACE, nom: "Affiche d'été", titre: null }, options("couple"), 1).config.texts.lines!;
  assert.equal(sansVille[0]!.value, "AFFICHE D'ÉTÉ");
  // Chaque graine son texte : sur 30 exemplaires, des phrases et des prénoms variés.
  const phrases = new Set<string>();
  const prenoms = new Set<string>();
  for (let rang = 0; rang < 30; rang++) {
    const t = tirer(FACE, options("famille"), graineDemo(2, rang, 0));
    const l = t.config.texts.lines!;
    phrases.add(l[1]!.value);
    prenoms.add(l[2]!.value);
    assert.equal(l[2]!.value.split(/, | & /).length, t.config.characters.length, l[2]!.value);
    assert.equal(new Set(l[2]!.value.split(/, | & /)).size, t.config.characters.length, "prénom en double");
  }
  assert.ok(phrases.size >= 8, `phrases : ${phrases.size}`);
  assert.ok(prenoms.size >= 25, `prénoms : ${prenoms.size}`);
  for (const { tire } of TIRAGES) {
    const lignes = tire.config.texts.lines!;
    assert.ok(lignes.length >= 1 && lignes.length <= 3);
    lignes.forEach((l, i) => {
      assert.ok(l.value.trim() !== "", "ligne vide");
      assert.ok(policesDeLaLigne(i).some((p) => p.id === l.font), `ligne ${i + 1} : ${l.font}`);
      assert.equal(l.color, "#FFFFFF");
      assert.equal(l.size, 1);
    });
    assert.equal(lignes[0]!.value, lignes[0]!.value.toLocaleUpperCase("fr-FR"));
  }
  // La couleur du texte : l'anthracite si demandé, le blanc pour toute autre valeur.
  const anthracite = tirer(FACE, options("couple", { couleurTexte: "#2f3436" }), 1).config.texts.lines!;
  assert.ok(anthracite.every((l) => l.color === "#2F3436"));
  const inconnue = tirer(FACE, options("couple", { couleurTexte: "#FF00FF" }), 1).config.texts.lines!;
  assert.ok(inconnue.every((l) => l.color === "#FFFFFF"));
});

test("7. la configuration passe le schéma des commandes ; fond brut, décor d'avant-plan, sans cadre", () => {
  for (const { affiche, tire } of TIRAGES) {
    const { config } = tire;
    assert.deepEqual(posterConfigSchema.parse(config), config);
    assert.ok(afficheComposee(config));
    assert.equal(config.schemaVersion, 1);
    assert.equal(config.productId, affiche.productId);
    assert.equal(config.view, affiche.vue);
    assert.equal(config.format, "A4");
    assert.equal(config.frameId, null);
    assert.equal(config.orientation, undefined);
    assert.equal(config.foregroundUrl, affiche.avantPlan);
    const fond = affiche.fonds.find((f) => f.id === config.backgroundId);
    assert.ok(fond, "fond étranger à l'affiche");
    assert.equal(config.backgroundUrl, fond.url);
    assert.match(config.backgroundUrl!, /^\/assets\//);
    assert.equal(tire.resume.decor, fond.nom);
  }
  // A3, sans décor d'avant-plan : pas de clé foregroundUrl.
  const a3 = tirer({ ...FACE, avantPlan: null }, options("couple", { format: "A3" }), 1).config;
  assert.equal(a3.format, "A3");
  assert.ok(!("foregroundUrl" in a3));
  // Les deux fonds sortent ; retrouvés par le nom de la ville, seul le premier.
  const fonds = new Set<unknown>();
  const parLeNom = new Set<unknown>();
  for (let rang = 0; rang < 40; rang++) {
    fonds.add(tirer(FACE, options("couple"), graineDemo(5, rang, 0)).config.backgroundId);
    parLeNom.add(tirer({ ...FACE, fondsParLeNom: true }, options("couple"), graineDemo(5, rang, 0)).config.backgroundId);
  }
  assert.deepEqual([...fonds].sort(), [45, 46]);
  assert.deepEqual([...parLeNom], [45]);
});

test("8. une scène dégradée est annoncée", () => {
  // De dos, aucun animal : la famille avec animal devient une famille, « Avec son animal » un couple.
  for (let rang = 0; rang < 30; rang++) {
    const fa = tirer(DOS, options("famille_animal"), graineDemo(8, rang, 0)).resume;
    assert.equal(fa.scene, "famille");
    assert.equal(fa.degradee, true);
    const aa = tirer(DOS, options("avec_animal"), graineDemo(8, rang, 0)).resume;
    assert.equal(aa.scene, "couple");
    assert.equal(aa.degradee, true);
  }
  // De face, tout y est : rien de dégradé.
  for (const { affiche, tire, scene } of TIRAGES)
    if (affiche.vue === "front") {
      assert.equal(tire.resume.degradee, false, scene);
      assert.equal(tire.resume.scene, scene);
    }
  // Un seul adulte pour ce type d'affiche : un couple impossible, mais pas de refus.
  const seul = { ...BIBLIOTHEQUE, characters: PERSONNAGES.filter((p) => [21, 23].includes(p.id)) };
  const r = tirer(DOS, options("couple"), 1, seul).resume;
  assert.equal(r.degradee, true);
  assert.deepEqual(r.personnages, ["Femme dos", "Fille dos"]);
});

/* -------------------------------------------------------------------------- */
/*  Tirabilité et refus                                                        */
/* -------------------------------------------------------------------------- */

test("tirabilité : la raison en mots de la boutique", () => {
  assert.deepEqual(tirabilite(FACE, BIBLIOTHEQUE), { tirable: true, raison: null, personnages: 13 });
  assert.deepEqual(tirabilite(DOS, BIBLIOTHEQUE), { tirable: true, raison: null, personnages: 4 });
  assert.deepEqual(tirabilite({ ...FACE, fonds: [] }, BIBLIOTHEQUE), {
    tirable: false,
    raison: "Aucun décor à elle.",
    personnages: 13,
  });
  const sansDos = { ...BIBLIOTHEQUE, characters: PERSONNAGES.filter((p) => p.orientation === "front") };
  assert.deepEqual(tirabilite(DOS, sansDos), {
    tirable: false,
    raison: "Aucun personnage proposé pour une affiche « De dos ».",
    personnages: 0,
  });
  assert.equal(tirabilite(FACE, null).tirable, false);
  assert.equal(tirabilite(FACE, { characters: "?" }).tirable, false);
});

test("refus : décor absent ou manquant sur le disque, bibliothèque illisible, format inconnu", () => {
  const refus = (affiche: AfficheDemo, bib: unknown = BIBLIOTHEQUE, opts = options("couple")) => {
    const r = tirerAfficheDemo(affiche, bib, opts, alea(1), present);
    assert.ok("refus" in r, JSON.stringify(r).slice(0, 200));
    return r.refus;
  };
  assert.equal(refus({ ...FACE, fonds: [] }), "Aucun décor à elle.");
  assert.match(refus({ ...FACE, fonds: [{ id: 1, url: "/assets/manquant.svg", nom: "X" }] }), /décor manque/);
  assert.match(refus({ ...FACE, avantPlan: "/assets/manquant-banc.svg" }), /avant-plan/);
  assert.match(refus(FACE, { slots: {} }), /bibliothèque/);
  assert.match(refus(FACE, BIBLIOTHEQUE, options("couple", { format: "A5" as "A4" })), /A4 ou A3/);
  // Un fond manquant parmi d'autres est seulement écarté.
  const unSurDeux = { ...FACE, fonds: [{ id: 1, url: "/assets/manquant.svg", nom: "X" }, ...FACE.fonds] };
  for (let rang = 0; rang < 20; rang++)
    assert.notEqual(tirer(unSurDeux, options("couple"), graineDemo(4, rang, 0)).config.backgroundId, 1);
});

/* -------------------------------------------------------------------------- */
/*  Relecture du 20/11 : ce que le rendu ou l'œil ne pardonneraient pas        */
/* -------------------------------------------------------------------------- */

test("ni personnage ni pièce d'essai, ni dessin qui n'est pas un SVG", () => {
  const slots = {
    ...BIBLIOTHEQUE.slots,
    front: {
      ...SLOTS_FACE,
      // Une coiffure d'essai, liée à Femme 1 et portée d'office par Femme 2.
      hair: [...SLOTS_FACE.hair, piece(124, "hair", "front", 4, { st0: "#111111" }, { name: "TEST" })],
      // Une image PNG déposée telle quelle : le moteur ne sait pas la dessiner.
      clothes: [
        ...SLOTS_FACE.clothes,
        piece(105, "clothes", "front", 5, { st0: "#123456" }, { svgUrl: "/assets/capture.png" }),
      ],
    },
  };
  const bib = {
    ...BIBLIOTHEQUE,
    slots,
    characters: [
      ...PERSONNAGES.map((p) =>
        p.id === 1
          ? { ...p, slotVariants: { clothes: [1, 2, 3, 5], pants: [1, 3], hair: [1, 2, 3, 4], accessory: [1] } }
          : p.id === 2
            ? { ...p, slotVariants: { clothes: [2], pants: [2], hair: [2, 3, 4], accessory: [] }, defaultAssets: { hair: 4 } }
            : p,
      ),
      perso(30, "Femme test", "Femmes", "front"),
      perso(31, "Homme essai 2", "Hommes", "front"),
      perso(32, "Fauteuil capture", "Fauteuil roulant", "front", { baseSvgUrl: "/assets/capture-d-ecran.PNG" }),
      // Un mot qui CONTIENT « test » n'est pas un nom d'essai.
      perso(33, "Femme Testard", "Femmes", "front"),
    ],
  };
  // Le tableau du back-office ne les compte pas : 13 de face, plus « Femme Testard ».
  assert.equal(tirabilite(FACE, bib).personnages, 14);
  let testard = 0;
  for (const scene of SCENES)
    for (let rang = 0; rang < 80; rang++) {
      const { config } = tirer(FACE, options(scene), graineDemo(11, rang, SCENES.indexOf(scene)), bib);
      for (const c of config.characters) {
        assert.ok(![30, 31, 32].includes(Number(c.typeId)), `${scene} : personnage ${c.typeId} tiré`);
        if (Number(c.typeId) === 33) testard++;
        assert.notEqual(Number(c.assets.hair), 124, `${scene} : coiffure d'essai sur ${c.typeId}`);
        assert.notEqual(Number(c.assets.clothes), 105, `${scene} : pièce PNG sur ${c.typeId}`);
      }
    }
  assert.ok(testard > 0, "« Femme Testard » n'est jamais tirée");
  // Seule une image SVG passe le dernier contrôle : la base d'un personnage
  // qui n'est pas lié à ses pièces ne se remplace pas, le tirage la refuse.
  const sansListe = {
    ...bib,
    characters: [
      perso(1, "Femme 1", "Femmes", "front", { slotVariants: null, defaultAssets: { clothes: 5 } }),
      perso(3, "Homme 1", "Hommes", "front", { slotVariants: SANS_PIECE }),
    ],
  };
  const r = tirerAfficheDemo(FACE, sansListe, options("couple"), alea(1), present);
  assert.ok("refus" in r && /n'est pas un SVG/.test(r.refus), JSON.stringify(r).slice(0, 200));
});

test("« Au hasard », un personnage « autre » garde la tenue du back-office", () => {
  // « Femme fauteuil roulant » : un accessoire lié (un second fauteuil, dans
  // les données du 20/11) qu'elle ne doit jamais recevoir.
  const bib = {
    ...BIBLIOTHEQUE,
    characters: PERSONNAGES.map((p) =>
      p.id === 11
        ? { ...p, slotVariants: { clothes: [1, 2], pants: [], hair: [1, 2, 3], accessory: [1] }, defaultAssets: { clothes: 1 } }
        : p,
    ),
  };
  let vues = 0;
  for (let rang = 0; rang < 300; rang++) {
    const { config } = tirer(FACE, options("hasard"), graineDemo(12, rang, 0), bib);
    for (const c of config.characters) {
      if (Number(c.typeId) === 11) {
        vues++;
        assert.deepEqual(c.assets, { clothes: 101 });
      }
      // « Sans catégorie », sans tenue réglée : rien.
      if (Number(c.typeId) === 15) assert.deepEqual(c.assets, {});
    }
  }
  assert.ok(vues > 0, "« Au hasard » ne la tire jamais");
});

test("une famille ne prend que des humains dont la peau se teint ; entre amis, si", () => {
  // Une femme de dos dessinée sans zone de couleur, comme « Femme 6 » : sa
  // peau ne suivrait pas la teinte commune de la famille.
  const bib = {
    ...BIBLIOTHEQUE,
    characters: [...PERSONNAGES, perso(25, "Femme sans zone", "Femmes", "back", { baseColorZones: null })],
  };
  const vue = { famille: 0, autres: 0 };
  for (const scene of SCENES)
    for (let rang = 0; rang < 120; rang++) {
      const { config, resume } = tirer(DOS, options(scene), graineDemo(13, rang, SCENES.indexOf(scene)), bib);
      const avec = config.characters.some((c) => Number(c.typeId) === 25);
      if (["couple", "famille", "famille_animal", "avec_animal"].includes(scene)) {
        assert.ok(!avec, `${scene} (${resume.scene}) : la femme sans zone de couleur`);
        const peaux = new Set(
          config.characters
            .filter((c) => HUMAINS.has(personnageDe(c.typeId).category ?? ""))
            .map((c) => c.colors?.["base:st0"]),
        );
        assert.ok(peaux.size <= 1, `${scene} : ${[...peaux]}`);
        vue.famille++;
      } else if (avec) vue.autres++;
    }
  assert.ok(vue.famille > 0 && vue.autres > 0, JSON.stringify(vue));
  // Sans autre adulte, la famille la prend quand même : un adulte compte plus
  // qu'une teinte commune.
  const seule = { ...BIBLIOTHEQUE, characters: [perso(25, "Femme sans zone", "Femmes", "back", { baseColorZones: null }), PERSONNAGES.find((p) => p.id === 23)!] };
  const { config } = tirer(DOS, options("famille"), 1, seule);
  assert.ok(config.characters.some((c) => Number(c.typeId) === 25));
});

test("« Entre amis » : trois ou quatre personnes, au moins deux adultes, un ado au plus", () => {
  let avecUnAdo = 0;
  const n = 400;
  for (let rang = 0; rang < n; rang++) {
    const { config, resume } = tirer(FACE, options("amis"), graineDemo(14, rang, 0));
    const roles = config.characters.map((c) => personnageDe(c.typeId).category);
    assert.equal(resume.scene, "amis");
    assert.ok(roles.length === 3 || roles.length === 4, `${roles.length} personnes`);
    assert.ok(roles.filter((r) => r === "Femmes" || r === "Hommes").length >= 2, String(roles));
    const ados = roles.filter((r) => r === "Ados").length;
    assert.ok(ados <= 1, `${ados} ados`);
    assert.ok(roles.every((r) => ["Femmes", "Hommes", "Ados"].includes(r ?? "")), String(roles));
    if (ados) avecUnAdo++;
  }
  // « parfois » : environ un groupe sur quatre (0,25), jamais la moitié.
  assert.ok(avecUnAdo > n * 0.1 && avecUnAdo < n * 0.4, `${avecUnAdo} groupes avec un ado sur ${n}`);
  assert.match(SCENES_DEMO.find((s) => s.cle === "amis")!.aide, /parfois avec un ado/);
});
