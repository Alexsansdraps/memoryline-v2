/**
 * Les essais des familles de teinte d'une pièce, sans base de données.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/couleurs-familles.test.ts
 *
 * Depuis le 19 octobre, le client peut changer TOUTES les couleurs d'une
 * pièce (demande de la cliente), et les ombres d'une teinte suivent la couleur
 * choisie : plus de t-shirt jaune à manches vert foncé. Ces essais vérifient
 * ce qui ne se voit pas à l'écran : comment les zones se réunissent en
 * familles, l'ordre des rangées, ce que « principale » et un réglage propre
 * en gardent, ce qu'un clic écrit, et quand le bouton « Remettre les couleurs
 * d'origine » doit paraître — puis, depuis le 20 octobre, les couleurs propres
 * de chaque partie d'un accessoire. Les données sont factices, copiées des pièces
 * réelles (le t-shirt 419 de « Garçon 2 », la pièce 341, et celles du
 * catalogue qui ont réglé les seuils des ombres le 20 octobre : bonnets 393
 * et 400, casquette 401, casque 477, fauteuil 406).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COULEURS_PARTIE_MAX,
  couleurHexPropre,
  couleursChangees,
  couleursDeLaPartie,
  couleursDeLaPiece,
  couleursDuGroupePourScope,
  famillesDeLaPiece,
  famillesDuDessin,
  groupePrincipal,
  groupesDuDessin,
  groupesProposesDeLaPiece,
  hexVersRgb,
  nuanceSuivante,
  pastillesDeLaRangee,
  principaleDeLaPiece,
  refusDesCouleursDesParties,
  sansPastillesProposees,
  versTsl,
} from "@memoryline/types";

/** Le t-shirt 419 : jaune, manches vert sombre, liseré encore plus sombre. */
const tshirt = {
  colorZones: { st0: "#F2D08D", st1: "#004946", st2: "#01332F" },
  partsDesZones: { st0: 0.836, st1: 0.156, st2: 0.008 },
};

/** La pièce 341 : surtout brune (deux ombres), un peu de blanc et de gris. */
const piece341 = {
  colorZones: {
    st0: "#FFFFFF",
    st1: "#CDD3D3",
    st2: "#BD947C",
    st4: "#936E5C",
    st5: "#875B48",
  },
  partsDesZones: { st0: 0.19, st1: 0.014, st2: 0.764, st4: 0.004, st5: 0.028 },
};

const clarte = (hex: string): number => {
  const rgb = hexVersRgb(hex)!;
  const tsl: [number, number, number] = [0, 0, 0];
  versTsl(rgb[0], rgb[1], rgb[2], tsl);
  return tsl[2];
};

test("le t-shirt 419 : deux familles, le liseré suit les manches", () => {
  assert.deepEqual(famillesDeLaPiece(tshirt), [
    { zone: "st0" },
    { zone: "st1", nuances: ["st2"] },
  ]);
  assert.deepEqual(groupesProposesDeLaPiece(tshirt, "toutes"), [
    { zone: "st0" },
    { zone: "st1", nuances: ["st2"] },
  ]);
  // Sans règle (pièce sans catégorie) : la même chose que « toutes ».
  assert.deepEqual(groupesProposesDeLaPiece(tshirt), famillesDeLaPiece(tshirt));
  assert.deepEqual(groupesProposesDeLaPiece(tshirt, "principale"), [{ zone: "st0" }]);
  assert.deepEqual(principaleDeLaPiece(tshirt), { zone: "st0" });
});

test("la pièce 341 : la famille la plus étendue d'abord, les gris réunis par clarté", () => {
  assert.deepEqual(famillesDeLaPiece(piece341), [
    { zone: "st2", nuances: ["st4", "st5"] },
    { zone: "st0", nuances: ["st1"] },
  ]);
  assert.deepEqual(principaleDeLaPiece(piece341), { zone: "st2", nuances: ["st4", "st5"] });
});

test("un groupe enregistré reste entier, et les teintes se réunissent quand même autour", () => {
  const piece = {
    colorZones: { st0: "#F2D08D", st1: "#004946", st2: "#01332F", st3: "#E7B033" },
    partsDesZones: { st0: 0.4, st1: 0.3, st2: 0.2, st3: 0.1 },
    groupesCouleurs: [{ zone: "st1", nuances: ["st2"], nom: "manches" }],
  };
  const familles = famillesDeLaPiece(piece);
  // Par part décroissante (manches 0,5, corps 0,4 + col 0,1). Le col st3, de
  // la même teinte que le corps et plus petit, le suit : un groupe enregistré
  // n'arrête plus la réunion des autres teintes.
  assert.deepEqual(familles, [
    { zone: "st1", nuances: ["st2"], nom: "manches" },
    { zone: "st0", nuances: ["st3"] },
  ]);
  const groupes = groupesDuDessin(piece.colorZones, piece.groupesCouleurs);
  assert.deepEqual(principaleDeLaPiece(piece), groupePrincipal(groupes, piece.partsDesZones));
  // Deux moitiés égales de même teinte sont deux parties ; à part égale,
  // l'ordre du back-office (tri stable).
  const egales = { ...piece, partsDesZones: { st0: 0.25, st1: 0.25, st2: 0.25, st3: 0.25 } };
  assert.deepEqual(
    famillesDeLaPiece(egales).map((g) => g.zone),
    ["st1", "st0", "st3"],
  );
});

test("relire le dessin ne coupe plus le suivi des ombres (pièce 341)", () => {
  // Ce que grouperNuances enregistre à la relecture : un bloc de deux nuances.
  const relue = {
    ...piece341,
    groupesCouleurs: [{ zone: "st2" }, { zone: "st0" }, { zone: "st4", nuances: ["st5"] }, { zone: "st1" }],
  };
  // Le bloc suit le corps, sa plus grande zone (st5, 2,8 %) en tête.
  assert.deepEqual(famillesDeLaPiece(relue), [
    { zone: "st2", nuances: ["st5", "st4"] },
    { zone: "st0", nuances: ["st1"] },
  ]);
  // 382, coupe d'Illustrator relue : grouperNuances prend st0 (le chignon,
  // 15 %) pour référence ; la chevelure (st3, 71 %) la remplace, pour que la
  // couleur choisie tombe telle quelle sur elle.
  const coupe = {
    colorZones: { st0: "#664026", st1: "#231D19", st2: "#4C311E", st3: "#7C5439", st4: "#916444" },
    partsDesZones: { st0: 0.153, st1: 0.008, st2: 0.043, st3: 0.713, st4: 0.084 },
    groupesCouleurs: [{ zone: "st0", nuances: ["st2", "st3", "st4"] }, { zone: "st1" }],
  };
  assert.deepEqual(famillesDeLaPiece(coupe), [
    { zone: "st3", nuances: ["st0", "st2", "st4"] },
    { zone: "st1" },
  ]);
});

test("une autre partie de la même teinte garde sa rangée (catalogue du 20 octobre)", () => {
  // 400, bonnet : corps brun, revers et pompon orange (0,26 plus clair, 47 %).
  const bonnet = {
    colorZones: { st0: "#F28C5F", st1: "#AA5B21" },
    partsDesZones: { st0: 0.472, st1: 0.528 },
  };
  assert.deepEqual(famillesDeLaPiece(bonnet), [{ zone: "st1" }, { zone: "st0" }]);
  // 393, bonnet bleu et son revers plus sombre : deux moitiés, deux parties.
  const bonnet393 = {
    colorZones: { st0: "#36497F", st1: "#21304F" },
    partsDesZones: { st0: 0.516, st1: 0.484 },
  };
  assert.deepEqual(famillesDeLaPiece(bonnet393), [{ zone: "st0" }, { zone: "st1" }]);
  // 401, casquette trucker : le filet bleu ciel, la visière bleue avec son
  // contour, le dessous de la visière.
  const trucker = {
    colorZones: { st0: "#1C6AC6", st1: "#ABCAEF", st2: "#2F7BEA", st3: "#14457F" },
    partsDesZones: { st0: 0.088, st1: 0.629, st2: 0.187, st3: 0.096 },
  };
  assert.deepEqual(famillesDeLaPiece(trucker), [
    { zone: "st1" },
    { zone: "st2", nuances: ["st0"] },
    { zone: "st3" },
  ]);
  // 477, casque audio : l'arceau marine et les écouteurs bleus.
  const casque = {
    colorZones: { st0: "#107CDD", st1: "#162633", st2: "#0F171C" },
    partsDesZones: { st0: 0.191, st1: 0.286, st2: 0.523 },
  };
  assert.deepEqual(famillesDeLaPiece(casque), [{ zone: "st2" }, { zone: "st1" }, { zone: "st0" }]);
});

test("un petit détail plus sombre suit sa couleur ; la référence est la zone la plus étendue", () => {
  // 407 : une couture (0,4 %) bien plus sombre que le t-shirt la suit.
  assert.deepEqual(
    famillesDeLaPiece({
      colorZones: { st0: "#F6D994", st2: "#A88A4E" },
      partsDesZones: { st0: 0.996, st2: 0.004 },
    }),
    [{ zone: "st0", nuances: ["st2"] }],
  );
  // 406, fauteuil roulant : la toile et le métal sombre d'un côté, le métal
  // clair de l'autre. La référence des gris sombres est la toile (st2, la
  // moitié du dessin), et non un gris moyen minuscule (st10) qui « touchait »
  // les deux familles.
  const fauteuil = {
    colorZones: {
      st0: "#55524E", st1: "#9A9B9B", st2: "#53544F", st3: "#5C5D5D", st4: "#9A9D9B",
      st5: "#828282", st6: "#BCBEBE", st7: "#3D3F3F", st8: "#A3A3A3", st9: "#545654",
      st10: "#6B6B6B",
    },
    partsDesZones: {
      st0: 0.004, st1: 0.004, st2: 0.496, st3: 0.155, st4: 0.054, st5: 0.003,
      st6: 0.09, st7: 0.034, st8: 0.034, st9: 0.111, st10: 0.016,
    },
  };
  const familles = famillesDeLaPiece(fauteuil);
  assert.deepEqual(familles.map((f) => f.zone), ["st2", "st6"]);
  assert.deepEqual([...familles[0]!.nuances!].sort(), ["st0", "st10", "st3", "st5", "st7", "st9"]);
  assert.deepEqual([...familles[1]!.nuances!].sort(), ["st1", "st4", "st8"]);
});

test("une couleur séparée par la boutique garde sa rangée, et ses ombres peuvent la suivre", () => {
  const piece = {
    colorZones: { st0: "#F2D08D", st1: "#004946", st2: "#01332F" },
    partsDesZones: tshirt.partsDesZones,
    groupesCouleurs: [{ zone: "st2", separee: true }],
  };
  assert.deepEqual(groupesDuDessin(piece.colorZones, piece.groupesCouleurs), [
    { zone: "st2", separee: true },
    { zone: "st0" },
    { zone: "st1" },
  ]);
  assert.deepEqual(famillesDeLaPiece(piece), [
    { zone: "st0" },
    { zone: "st1" },
    { zone: "st2", separee: true },
  ]);
  // Les manches séparées : le liseré, plus petit, les suit toujours.
  assert.deepEqual(
    famillesDeLaPiece({ ...piece, groupesCouleurs: [{ zone: "st1", separee: true }] }),
    [{ zone: "st0" }, { zone: "st1", nuances: ["st2"], separee: true }],
  );
  // Une valeur autre que `true` ne marque rien.
  assert.deepEqual(groupesDuDessin(piece.colorZones, [{ zone: "st2", separee: "oui" }]), [
    { zone: "st2" },
    { zone: "st0" },
    { zone: "st1" },
  ]);
});

test("une pièce réglée à la main : les cases décident, les ombres suivent toujours", () => {
  assert.deepEqual(groupesProposesDeLaPiece({ ...tshirt, zonesMasquees: [] }, "toutes"), [
    { zone: "st0" },
    { zone: "st1", nuances: ["st2"] },
  ]);
  // Le corps décoché : les manches gardent leur liseré.
  assert.deepEqual(groupesProposesDeLaPiece({ ...tshirt, zonesMasquees: ["st0"] }, "toutes"), [
    { zone: "st1", nuances: ["st2"] },
  ]);
  // Une zone masquée ne rejoint aucune famille : les manches décochées, le
  // liseré coché reste une rangée à lui (ce que les cases disent).
  assert.deepEqual(groupesProposesDeLaPiece({ ...tshirt, zonesMasquees: ["st1"] }, "toutes"), [
    { zone: "st0" },
    { zone: "st2" },
  ]);
  // Les cases ont le dernier mot sur la règle de la catégorie.
  assert.deepEqual(
    groupesProposesDeLaPiece({ ...tshirt, zonesMasquees: [] }, "principale"),
    [{ zone: "st0" }, { zone: "st1", nuances: ["st2"] }],
  );
});

test("sans mesure des parts, les teintes se réunissent quand même, le premier en référence", () => {
  assert.deepEqual(famillesDeLaPiece({ colorZones: tshirt.colorZones }), [
    { zone: "st0" },
    { zone: "st1", nuances: ["st2"] },
  ]);
  // Le petit liseré passe en premier dans le dessin : c'est lui la référence.
  assert.deepEqual(
    famillesDeLaPiece({ colorZones: { st0: "#01332F", st1: "#004946", st2: "#F2D08D" } }),
    [{ zone: "st0", nuances: ["st1"] }, { zone: "st2" }],
  );
  assert.deepEqual(famillesDeLaPiece({ colorZones: {} }), []);
  assert.equal(principaleDeLaPiece({ colorZones: null }), undefined);
});

test("un clic sur la famille verte écrit la référence et son ombre, plus sombre", () => {
  const verte = famillesDeLaPiece(tshirt)[1]!;
  const ecrit = couleursDuGroupePourScope("clothes", verte, tshirt.colorZones, "#D82A2A");
  assert.deepEqual(ecrit, {
    "clothes:st1": "#D82A2A",
    "clothes:st2": nuanceSuivante("#01332F", "#004946", "#D82A2A"),
  });
  assert.ok(clarte(ecrit["clothes:st2"]!) < clarte("#D82A2A"), "l'ombre reste une ombre");
  // Revenir à la couleur du dessin rend l'ombre d'origine, au chiffre près.
  assert.deepEqual(couleursDuGroupePourScope("clothes", verte, tshirt.colorZones, "#004946"), {
    "clothes:st1": "#004946",
    "clothes:st2": "#01332F",
  });
});

test("couleursChangees : le bouton paraît dès qu'une couleur n'est plus celle du dessin", () => {
  const defauts = tshirt.colorZones;
  const fraiche = { "clothes:st0": "#F2D08D", "clothes:st1": "#004946", "clothes:st2": "#01332F" };
  assert.equal(couleursChangees(fraiche, "clothes", defauts), false);
  assert.equal(couleursChangees({ ...fraiche, "clothes:st1": "#D82A2A" }, "clothes", defauts), true);
  // Une famille en pixels choisie n'a pas de défaut sous cette clé : changée.
  assert.equal(couleursChangees({ ...fraiche, "clothes:fam0": "#8B5B38" }, "clothes", defauts), true);
  // À l'écriture près.
  assert.equal(couleursChangees({ ...fraiche, "clothes:st0": "#f2d08d" }, "clothes", defauts), false);
  // Les autres couches, et les clés plates d'avant le namespacing, sont ignorées.
  assert.equal(couleursChangees({ "base:st0": "#000000", st1: "#000000" }, "clothes", defauts), false);
  assert.equal(couleursChangees({ "base:st0": "#000000" }, "base", { st0: "#E0AC7E" }), true);
  assert.equal(couleursChangees({}, "clothes", defauts), false);
  assert.equal(couleursChangees(undefined, "clothes", defauts), false);
});

/* -------------------------------------------------------------------------- */
/*  Les couleurs propres d'une partie d'accessoire (20 octobre)                */
/* -------------------------------------------------------------------------- */
/*
 * « Pas de sélecteur pour les gens » (Margaux) : sur un accessoire, le client
 * n'a que les pastilles de la boutique — la liste de la partie, sinon le
 * nuancier de la catégorie —, jamais la saisie libre.
 */

/** Le nuancier « Accessoires » de la boutique, et celui des vêtements (repli). */
const NUANCIER_ACCESSOIRES = ["#FFFFFF", "#E7B033", "#BD1212", "#0056AF", "#B8551D", "#000000"];
const REPLI = ["#FAFAFA", "#FF96BF", "#000000"];

test("couleursDeLaPartie : relues en #RRGGBB, doublons et illisibles écartés, l'ordre gardé", () => {
  assert.equal(couleurHexPropre("#b8551d"), "#B8551D");
  assert.equal(couleurHexPropre("b8551d"), "#B8551D");
  assert.equal(couleurHexPropre(" #abc "), "#AABBCC");
  assert.equal(couleurHexPropre("rouge"), null);
  assert.equal(couleurHexPropre(12), null);
  assert.deepEqual(couleursDeLaPartie(["#e7b033", "#000000", "#E7B033", "pas une couleur", 3, "#fff"]), [
    "#E7B033",
    "#000000",
    "#FFFFFF",
  ]);
  assert.deepEqual(couleursDeLaPartie(undefined), []);
  assert.deepEqual(couleursDeLaPartie("#000000"), []);
  // 40 au plus : une liste abîmée ne range pas mille pastilles.
  const mille = Array.from({ length: 1000 }, (_, i) => `#${i.toString(16).padStart(6, "0")}`);
  assert.equal(couleursDeLaPartie(mille).length, COULEURS_PARTIE_MAX);
});

test("refusDesCouleursDesParties : l'API refuse une couleur mal écrite ou plus de 40 couleurs", () => {
  assert.equal(refusDesCouleursDesParties(undefined), null);
  assert.equal(refusDesCouleursDesParties([{ zone: "st0" }, { zone: "st1", couleurs: null }]), null);
  assert.equal(
    refusDesCouleursDesParties([{ zone: "st0", couleurs: ["#e7b033", "#000000"] }]),
    null,
    "minuscules acceptées : elles sont remises en majuscules au nettoyage",
  );
  // Les doublons ne sont pas une erreur : ils comptent pour une seule couleur.
  const quaranteEtDoublons = [
    ...Array.from({ length: 40 }, (_, i) => `#0000${i.toString(16).padStart(2, "0")}`),
    "#000000",
    "#000001",
  ];
  assert.equal(refusDesCouleursDesParties([{ zone: "st0", couleurs: quaranteEtDoublons }]), null);
  assert.match(
    refusDesCouleursDesParties([{ zone: "st0", couleurs: ["#E7B033", "#abc"] }]) ?? "",
    /« #abc » n'est pas une couleur/,
  );
  assert.match(
    refusDesCouleursDesParties([{ zone: "st0", couleurs: [12] }]) ?? "",
    /n'est pas une couleur/,
  );
  assert.match(refusDesCouleursDesParties([{ zone: "st0", couleurs: "#E7B033" }]) ?? "", /pas pu être lues/);
  const quaranteEtUne = Array.from({ length: 41 }, (_, i) => `#0000${i.toString(16).padStart(2, "0")}`);
  assert.match(
    refusDesCouleursDesParties([{ zone: "st0", couleurs: quaranteEtUne }]) ?? "",
    /40 couleurs au plus/,
  );
});

test("une partie garde sa liste au nettoyage, et la rangée du client la porte", () => {
  // Une paire de lunettes : la monture a sa liste, son ombre aussi (une liste
  // d'avant, quand elle avait sa propre rangée) — seule celle de la tête vaut
  // pour le client.
  const lunettes = {
    colorZones: { st0: "#24222C", st1: "#2B2933", st2: "#9EDFBF" },
    partsDesZones: { st0: 0.6, st1: 0.1, st2: 0.3 },
    groupesCouleurs: [
      { zone: "st0", nom: "Monture", couleurs: ["#e7b033", "#000000", "#E7B033"] },
      { zone: "st1", couleurs: ["#FF0000"] },
      { zone: "st2", nom: "Verres" },
    ],
  };
  const groupes = groupesDuDessin(lunettes.colorZones, lunettes.groupesCouleurs);
  assert.deepEqual(groupes[0], { zone: "st0", nom: "Monture", couleurs: ["#E7B033", "#000000"] });
  assert.deepEqual(groupes[2], { zone: "st2", nom: "Verres" }, "sans liste, pas de champ vide");

  const rangees = famillesDeLaPiece(lunettes);
  assert.deepEqual(rangees, [
    { zone: "st0", nom: "Monture", couleurs: ["#E7B033", "#000000"], nuances: ["st1"] },
    { zone: "st2", nom: "Verres" },
  ]);
  assert.deepEqual(principaleDeLaPiece(lunettes)?.couleurs, ["#E7B033", "#000000"]);

  // Les couleurs choisies s'écrivent zone par zone, comme avant : la liste ne
  // change rien à ce qui est enregistré, ni à ce qui s'imprime.
  assert.deepEqual(couleursDuGroupePourScope("accessory", rangees[0]!, lunettes.colorZones, "#E7B033"), {
    "accessory:st0": "#E7B033",
    "accessory:st1": nuanceSuivante("#2B2933", "#24222C", "#E7B033"),
  });
  // Un panier rempli avant la liste (un rouge que la monture ne propose
  // plus) se dessine — à l'écran comme à l'impression — avec son rouge.
  assert.deepEqual(couleursDeLaPiece({ "accessory:st0": "#BD1212" }, "accessory", lunettes), {
    st0: "#BD1212",
    st1: "#2B2933",
    st2: "#9EDFBF",
  });

  // Un dessin en pixels : chaque famille garde sa liste, nettoyée de même.
  assert.deepEqual(
    famillesDuDessin({
      familles: [
        { cle: "fam0", reference: "#8B5B38", part: 0.7, proposee: true, couleurs: ["#000000", "#000000", "x"] },
        { cle: "fam1", reference: "#FFFFFF", part: 0.3 },
      ],
    }).map((f) => f.couleurs),
    [["#000000"], undefined],
  );
});

test("pastillesDeLaRangee : jamais de saisie libre sur un accessoire, les autres inchangés", () => {
  const propres = ["#E7B033", "#000000"];
  // Accessoire : la liste de la partie, sinon la catégorie, sinon le repli — fermés.
  assert.deepEqual(pastillesDeLaRangee("accessory", propres, NUANCIER_ACCESSOIRES, REPLI), {
    couleurs: propres,
    libre: false,
  });
  assert.deepEqual(pastillesDeLaRangee("accessory", [], NUANCIER_ACCESSOIRES, REPLI), {
    couleurs: NUANCIER_ACCESSOIRES,
    libre: false,
  });
  assert.deepEqual(pastillesDeLaRangee("accessory", undefined, [], REPLI), {
    couleurs: REPLI,
    libre: false,
  });
  assert.deepEqual(pastillesDeLaRangee("accessory", undefined, undefined, REPLI), {
    couleurs: REPLI,
    libre: false,
  });
  // Les autres emplacements ne lisent pas de liste de partie, et gardent la
  // saisie libre sans nuancier de catégorie, comme avant.
  for (const slot of ["clothes", "pants", "hair"]) {
    assert.deepEqual(pastillesDeLaRangee(slot, propres, NUANCIER_ACCESSOIRES, REPLI), {
      couleurs: NUANCIER_ACCESSOIRES,
      libre: false,
    });
    assert.deepEqual(pastillesDeLaRangee(slot, propres, [], REPLI), { couleurs: REPLI, libre: true });
  }
});

test("sansPastillesProposees : les listes n'entrent pas dans l'empreinte d'impression", () => {
  // Deux états d'une même casquette, avant et après une retouche de la liste
  // de la calotte au back-office : ce qui dessine la pièce est identique, donc
  // l'empreinte du fichier d'impression aussi (pas de PDF refait pour rien).
  const avant = [
    { zone: "st0", nom: "Calotte", couleurs: ["#E7B033", "#2E8B57"] },
    { zone: "st2", nuances: ["st1"], separee: true },
  ];
  const apres = [
    { zone: "st0", nom: "Calotte", couleurs: ["#E7B033"] },
    { zone: "st2", nuances: ["st1"], separee: true },
  ];
  assert.equal(
    JSON.stringify(sansPastillesProposees(avant)),
    JSON.stringify(sansPastillesProposees(apres)),
  );
  // Tout le reste du groupe y reste — nom, nuances, séparation —, dans le
  // même ordre de clés.
  assert.equal(
    JSON.stringify(sansPastillesProposees(avant)),
    JSON.stringify([
      { zone: "st0", nom: "Calotte" },
      { zone: "st2", nuances: ["st1"], separee: true },
    ]),
  );
  // Sans aucune liste, la valeur même revient : l'empreinte des fichiers
  // déjà rangés ne bouge pas. Une donnée qui n'est pas un tableau aussi.
  const sansListe = [{ zone: "st0", nom: "Calotte" }];
  assert.equal(sansPastillesProposees(sansListe), sansListe);
  assert.equal(sansPastillesProposees(null), null);
  // Et l'original n'est pas touché : l'écran du back-office le relit.
  assert.deepEqual(avant[0]!.couleurs, ["#E7B033", "#2E8B57"]);
});
