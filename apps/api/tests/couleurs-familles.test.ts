/**
 * Les essais des familles de teinte d'une pièce, sans base de données.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/couleurs-familles.test.ts
 *
 * Depuis le 19 octobre, le client peut changer TOUTES les couleurs d'une
 * pièce (demande de la cliente), et les ombres d'une teinte suivent la couleur
 * choisie : plus de t-shirt jaune à manches vert foncé. Ces essais vérifient
 * ce qui ne se voit pas à l'écran : comment les zones se réunissent en
 * familles, l'ordre des rangées, ce que la case « C'est une ombre » du
 * back-office y change, ce qu'un clic écrit, et quand le bouton « Remettre
 * les couleurs d'origine » doit paraître — puis, depuis le 20 octobre, les
 * couleurs propres de chaque partie d'une pièce (10 au plus), la fin des
 * anciennes cases « Le client peut la changer », et ce que le message d'un
 * clic sur « C'est une ombre » doit dire (numéros d'après le geste, autres
 * couleurs déplacées, ombre d'une autre teinte). Les données sont factices, copiées des pièces
 * réelles (le t-shirt 419 de « Garçon 2 », la pièce 341, et celles du
 * catalogue qui ont réglé les seuils des ombres le 20 octobre : bonnets 393
 * et 400, casquette 401, casque 477, fauteuil 406).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COULEURS_PARTIE_LUES_MAX,
  COULEURS_PARTIE_MAX,
  avecToutesLesFamillesProposees,
  bilanDeLOmbre,
  couleurHexPropre,
  couleursChangees,
  couleursDeLaPartie,
  couleursDeLaPiece,
  couleursDesFamilles,
  couleursDuGroupePourScope,
  famillesDeLaPiece,
  famillesDuDessin,
  famillesProposees,
  groupePrincipal,
  groupesDuDessin,
  groupesProposesDeLaPiece,
  hexVersRgb,
  listesDesParties,
  nuanceSuivante,
  ombreDAutreTeinte,
  pastillesDeLaRangee,
  principaleDeLaPiece,
  refusDesCouleursDesParties,
  reglerOmbre,
  sansPastillesProposees,
  teteDuGroupe,
  versTsl,
  zoneLaPlusEtendue,
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
  // Le client a toutes les familles, quelle que soit la catégorie.
  assert.deepEqual(groupesProposesDeLaPiece(tshirt), famillesDeLaPiece(tshirt));
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

test("les anciennes cases « Le client peut la changer » ne cachent plus rien", () => {
  // Une pièce réglée jadis à la main (asset.zones_masquees) : la liste reste
  // en base, mais le client a toutes les familles, ombres comprises.
  const reglee = { ...tshirt, zonesMasquees: ["st0"] };
  assert.deepEqual(groupesProposesDeLaPiece(reglee), [
    { zone: "st0" },
    { zone: "st1", nuances: ["st2"] },
  ]);
  // Et sa couleur se dessine — à l'écran comme à l'impression — avec celle
  // que la configuration porte : plus de défaut forcé sur le corps.
  assert.deepEqual(couleursDeLaPiece({ "clothes:st0": "#BD1212" }, "clothes", reglee), {
    st0: "#BD1212",
    st1: "#004946",
    st2: "#01332F",
  });
  // Une commande passée quand le corps était masqué : le configurateur y
  // avait écrit la couleur du dessin, elle s'imprime à l'identique.
  const commande = { "clothes:st0": "#F2D08D", "clothes:st1": "#D82A2A", "clothes:st2": "#7A1010" };
  assert.deepEqual(couleursDeLaPiece(commande, "clothes", reglee), {
    st0: "#F2D08D",
    st1: "#D82A2A",
    st2: "#7A1010",
  });
});

test("« C'est une ombre » cochée : la couleur et ses ombres suivent une couleur principale", () => {
  // Les manches cochées « ombre » : aucune autre couleur verte, elles suivent
  // la plus proche en teinte — le corps, seul autre choix —, avec le liseré.
  const manches = { ...tshirt, groupesCouleurs: [{ zone: "st1", ombre: true }] };
  assert.deepEqual(famillesDeLaPiece(manches), [{ zone: "st0", nuances: ["st1", "st2"] }]);
  // 401, casquette trucker : la visière bleue (et son contour) cochée
  // « ombre » suit le filet bleu ciel, de sa teinte ; le dessous, plus
  // sombre, garde sa rangée. Les groupes tels que le back-office les
  // enregistre : un par zone, dans son ordre.
  const trucker = {
    colorZones: { st0: "#1C6AC6", st1: "#ABCAEF", st2: "#2F7BEA", st3: "#14457F" },
    partsDesZones: { st0: 0.088, st1: 0.629, st2: 0.187, st3: 0.096 },
  };
  const cochees = (...ombres: string[]) =>
    Object.keys(trucker.colorZones).map((zone) =>
      ombres.includes(zone) ? { zone, ombre: true as const } : { zone },
    );
  assert.deepEqual(famillesDeLaPiece({ ...trucker, groupesCouleurs: cochees("st2") }), [
    { zone: "st1", nuances: ["st0", "st2"] },
    { zone: "st3" },
  ]);
  // Une ombre suit une couleur PRINCIPALE, jamais une autre ombre : le
  // dessous coché aussi rejoint le filet.
  assert.deepEqual(famillesDeLaPiece({ ...trucker, groupesCouleurs: cochees("st2", "st3") }), [
    { zone: "st1", nuances: ["st0", "st2", "st3"] },
  ]);
  // La couleur la plus étendue ne peut pas être une ombre : la case cochée
  // (une donnée abîmée, le back-office la grise) ne change rien.
  assert.equal(zoneLaPlusEtendue(tshirt), "st0");
  assert.deepEqual(
    famillesDeLaPiece({ ...tshirt, groupesCouleurs: [{ zone: "st0", ombre: true }] }),
    famillesDeLaPiece(tshirt),
  );
  // Sans mesure des parts, la plus étendue est la première du back-office.
  assert.equal(zoneLaPlusEtendue({ colorZones: tshirt.colorZones }), "st0");
  // La plus étendue n'est pas toujours la principale : 477, l'arceau (st2)
  // est la plus grande zone.
  assert.equal(
    zoneLaPlusEtendue({
      colorZones: { st0: "#107CDD", st1: "#162633", st2: "#0F171C" },
      partsDesZones: { st0: 0.191, st1: 0.286, st2: 0.523 },
    }),
    "st2",
  );
});

test("la case « C'est une ombre » est une seule case : cochée ou décochée, jamais les deux", () => {
  const zones = { st0: "#F2D08D", st1: "#004946" };
  assert.deepEqual(groupesDuDessin(zones, [{ zone: "st1", ombre: true }]), [
    { zone: "st1", ombre: true },
    { zone: "st0" },
  ]);
  // Les deux à la fois (donnée abîmée) : « à part » l'emporte, il ne retire
  // de rangée à personne.
  assert.deepEqual(groupesDuDessin(zones, [{ zone: "st1", ombre: true, separee: true }]), [
    { zone: "st1", separee: true },
    { zone: "st0" },
  ]);
  // Une valeur autre que `true` ne coche rien.
  assert.deepEqual(groupesDuDessin(zones, [{ zone: "st1", ombre: "oui" }]), [
    { zone: "st1" },
    { zone: "st0" },
  ]);
});

test("reglerOmbre : la case n'écrit que ce qui contredit la lecture du dessin", () => {
  const sansReglage = groupesDuDessin(tshirt.colorZones, undefined);
  // Le t-shirt 419 (relecture du 20 octobre) : le liseré décoché devient une
  // partie, puis recoché redevient l'ombre des manches — et la pièce revient
  // SANS réglage, comme avant le premier clic. Avant, il lui restait
  // `ombre: true` pour toujours.
  const decoche = reglerOmbre(tshirt, "st2", false);
  assert.deepEqual(decoche, [{ zone: "st0" }, { zone: "st1" }, { zone: "st2", separee: true }]);
  assert.deepEqual(famillesDeLaPiece({ ...tshirt, groupesCouleurs: decoche }), [
    { zone: "st0" },
    { zone: "st1" },
    { zone: "st2", separee: true },
  ]);
  const recoche = reglerOmbre({ ...tshirt, groupesCouleurs: decoche }, "st2", true);
  assert.deepEqual(recoche, sansReglage);
  assert.deepEqual(famillesDeLaPiece({ ...tshirt, groupesCouleurs: recoche }), famillesDeLaPiece(tshirt));

  // 401, casquette trucker : la visière, une partie pour la lecture, cochée
  // « ombre » ; décochée ensuite, plus aucun drapeau.
  const trucker = {
    colorZones: { st0: "#1C6AC6", st1: "#ABCAEF", st2: "#2F7BEA", st3: "#14457F" },
    partsDesZones: { st0: 0.088, st1: 0.629, st2: 0.187, st3: 0.096 },
  };
  const visiere = reglerOmbre(trucker, "st2", true);
  assert.deepEqual(visiere, [{ zone: "st0" }, { zone: "st1" }, { zone: "st2", ombre: true }, { zone: "st3" }]);
  assert.deepEqual(famillesDeLaPiece({ ...trucker, groupesCouleurs: visiere }), [
    { zone: "st1", nuances: ["st0", "st2"] },
    { zone: "st3" },
  ]);
  assert.deepEqual(
    reglerOmbre({ ...trucker, groupesCouleurs: visiere }, "st2", false),
    groupesDuDessin(trucker.colorZones, undefined),
  );

  // La couleur la plus étendue cochée (le back-office n'en montre pas la
  // case) : rien ne s'écrit.
  assert.deepEqual(reglerOmbre(tshirt, "st0", true), sansReglage);

  // Une zone qu'une relecture a réunie à d'autres (341 : st4 avec st5) :
  // décochée, elle sort du groupe, couleur à part ; recochée, elle redevient
  // une ombre du corps, sans drapeau.
  const relue = {
    ...piece341,
    groupesCouleurs: [{ zone: "st2" }, { zone: "st0" }, { zone: "st4", nuances: ["st5"] }, { zone: "st1" }],
  };
  const sortie = reglerOmbre(relue, "st4", false);
  assert.deepEqual(sortie, [
    { zone: "st2" },
    { zone: "st0" },
    { zone: "st5" },
    { zone: "st4", separee: true },
    { zone: "st1" },
  ]);
  assert.deepEqual(famillesDeLaPiece({ ...relue, groupesCouleurs: sortie }), [
    { zone: "st2", nuances: ["st5"] },
    { zone: "st0", nuances: ["st1"] },
    { zone: "st4", separee: true },
  ]);
  const rentree = reglerOmbre({ ...relue, groupesCouleurs: sortie }, "st4", true);
  assert.ok(rentree.every((g) => !g.ombre && !g.separee), "aucun drapeau");
  assert.deepEqual(famillesDeLaPiece({ ...relue, groupesCouleurs: rentree })[0], {
    zone: "st2",
    nuances: ["st5", "st4"],
  });

  // Les noms et les listes de couleurs suivent leur groupe, intacts ; les
  // groupes reçus ne sont pas modifiés.
  const nommee = { ...tshirt, groupesCouleurs: [{ zone: "st1", nom: "Manches", couleurs: ["#000000"] }] };
  const avant = JSON.stringify(nommee);
  assert.deepEqual(reglerOmbre(nommee, "st1", true)[0], {
    zone: "st1",
    nom: "Manches",
    couleurs: ["#000000"],
    ombre: true,
  });
  assert.equal(JSON.stringify(nommee), avant);
});

/** Un clic de la boutique sur la case d'une zone : la pièce d'après, et le bilan qu'en dit le message. */
function cliquer(piece: Parameters<typeof reglerOmbre>[0], zone: string, oui: boolean) {
  const avant = famillesDeLaPiece(piece);
  const suite = { ...piece, groupesCouleurs: reglerOmbre(piece, zone, oui) };
  const apres = famillesDeLaPiece(suite);
  return { suite, apres, bilan: bilanDeLOmbre(avant, apres, zone) };
}

/** Le t-shirt 421 tel qu'il est réglé en prod : les manches vertes réunies jadis au corps beige. */
const piece421Prod = {
  colorZones: { st0: "#F2D08D", st1: "#004946", st2: "#01332F" },
  partsDesZones: { st0: 0.765, st1: 0.228, st2: 0.007 },
  groupesCouleurs: [{ zone: "st0", nuances: ["st1"] }, { zone: "st2" }],
};

test("bilanDeLOmbre : le message ne cite que les numéros d'après le geste (casquette 401)", () => {
  const trucker = {
    colorZones: { st0: "#1C6AC6", st1: "#ABCAEF", st2: "#2F7BEA", st3: "#14457F" },
    partsDesZones: { st0: 0.088, st1: 0.629, st2: 0.187, st3: 0.096 },
  };
  // La visière (st3, Partie 3) cochée : elle suit la partie 2.
  const un = cliquer(trucker, "st3", true);
  assert.deepEqual(un.bilan, { ombre: true, rangee: 2, suit: "st2", parties: [], ombres: [] });
  // L'ombre st0 décochée : une partie à part, la partie 3 — et la visière,
  // qui la suivait de plus près que la partie 2, part avec elle. Le message
  // doit le dire : la boutique n'a touché qu'une case.
  const deux = cliquer(un.suite, "st0", false);
  assert.deepEqual(famillesDeLaPiece(deux.suite).map((r) => r.zone), ["st1", "st2", "st0"]);
  assert.deepEqual(deux.bilan, {
    ombre: false,
    rangee: 3,
    parties: [],
    ombres: [{ zone: "st3", suit: "st0", rangee: 3, avant: "ombre" }],
  });
  // La partie 2 (st2) cochée : elle suit st0, qui était la partie 3 et
  // devient la partie 2. Le bilan donne le numéro d'APRÈS — avant, le
  // message disait « Partie 2 est maintenant une ombre : elle suit la
  // partie 2 ».
  const trois = cliquer(deux.suite, "st2", true);
  assert.deepEqual(trois.bilan, { ombre: true, rangee: 2, suit: "st0", parties: [], ombres: [] });
  assert.equal(trois.apres.findIndex((r) => r.zone === trois.bilan.suit) + 1, trois.bilan.rangee);
});

test("bilanDeLOmbre : un clic qui en déplace d'autres les nomme (486, 421)", () => {
  // Casquette 486 : décocher le bleu st5 libère aussi le bleu nuit st6, qui
  // ne suivait la calotte qu'à travers lui, et emmène st0 avec st5.
  const p486 = {
    colorZones: {
      st0: "#0E3B9E",
      st1: "#1F51DD",
      st2: "#6E91E0",
      st3: "#EFDE0C",
      st4: "#E01E1E",
      st5: "#0032A0",
      st6: "#00276B",
    },
    partsDesZones: { st0: 0.01, st1: 0.036, st2: 0.007, st3: 0.451, st4: 0.451, st5: 0.022, st6: 0.022 },
  };
  const decoche = cliquer(p486, "st5", false);
  assert.deepEqual(decoche.bilan, {
    ombre: false,
    rangee: 4,
    parties: [{ zone: "st6", rangee: 5 }],
    ombres: [{ zone: "st0", suit: "st5", rangee: 4, avant: "ombre" }],
  });

  // T-shirt 421 réglé comme en prod : décocher les manches fait du liseré
  // (une partie jusque-là) leur ombre ; les recocher l'emmène avec elles
  // sous le corps. Ni l'un ni l'autre ne se voyait dans le message.
  const libres = cliquer(piece421Prod, "st1", false);
  assert.deepEqual(libres.apres, [{ zone: "st0" }, { zone: "st1", nuances: ["st2"] }]);
  assert.deepEqual(libres.bilan, {
    ombre: false,
    rangee: 2,
    parties: [],
    ombres: [{ zone: "st2", suit: "st1", rangee: 2, avant: "partie" }],
  });
  const recochees = cliquer(libres.suite, "st1", true);
  assert.deepEqual(recochees.bilan, {
    ombre: true,
    rangee: 1,
    suit: "st0",
    parties: [],
    ombres: [{ zone: "st2", suit: "st0", rangee: 1, avant: "ombre" }],
  });
  // Un clic qui ne déplace que la couleur cliquée n'a rien de plus à dire.
  assert.deepEqual(cliquer(tshirt, "st2", false).bilan, {
    ombre: false,
    rangee: 3,
    parties: [],
    ombres: [],
  });
});

test("ombreDAutreTeinte : la ligne d'une ombre ne dit plus « aucune partie n'a sa teinte » à tort", () => {
  // 421 en prod : les manches vertes suivent le corps beige parce qu'un
  // ancien groupe les y réunit — alors que le liseré, juste dessous, est vert.
  assert.equal(ombreDAutreTeinte(piece421Prod, "st1"), "reglage");
  // Décochées, elles sont une partie ; le liseré les suit, de leur teinte.
  const libres = { ...piece421Prod, groupesCouleurs: reglerOmbre(piece421Prod, "st1", false) };
  assert.equal(ombreDAutreTeinte(libres, "st1"), null);
  assert.equal(ombreDAutreTeinte(libres, "st2"), null);
  // Recochées : aucune partie verte ne reste, elles suivent la plus proche —
  // et leur liseré avec elles. Là, la phrase est vraie.
  const recochees = { ...libres, groupesCouleurs: reglerOmbre(libres, "st1", true) };
  assert.equal(ombreDAutreTeinte(recochees, "st1"), "plus-proche");
  assert.equal(ombreDAutreTeinte(recochees, "st2"), "plus-proche");
  // Le cas ordinaire : une ombre de la teinte de sa partie, ou une partie.
  assert.equal(ombreDAutreTeinte(tshirt, "st2"), null);
  assert.equal(ombreDAutreTeinte(tshirt, "st0"), null);
  assert.equal(ombreDAutreTeinte(tshirt, "st9"), null);
});

test("teteDuGroupe : la zone la plus étendue d'un groupe enregistré est sa tête", () => {
  const parts = { st0: 0.153, st1: 0.008, st2: 0.043, st3: 0.713, st4: 0.084 };
  assert.equal(teteDuGroupe({ zone: "st0", nuances: ["st2", "st3", "st4"] }, parts), "st3");
  // Sans mesure, ou seule : la référence enregistrée.
  assert.equal(teteDuGroupe({ zone: "st0", nuances: ["st2", "st3"] }, null), "st0");
  assert.equal(teteDuGroupe({ zone: "st1" }, parts), "st1");
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
/*  Les couleurs propres d'une partie de pièce (20 octobre)                    */
/* -------------------------------------------------------------------------- */
/*
 * « Pas de sélecteur pour les gens » (Margaux) : sur un accessoire, le client
 * n'a que les pastilles de la boutique — la liste de la partie, sinon le
 * nuancier de la catégorie —, jamais la saisie libre. Puis « jusqu'à 10 pour
 * chaque partie d'une pièce » : toute pièce peut avoir, partie par partie, sa
 * liste ; le client n'a alors que ces pastilles.
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
  // 10 au plus pour la boutique et le client ; une liste rangée quand la
  // borne était de 40 se LIT entière, jusqu'à 40 : la relire puis la
  // renvoyer (un nom changé ailleurs sur la pièce) ne la coupe pas en base.
  assert.equal(COULEURS_PARTIE_MAX, 10);
  assert.equal(COULEURS_PARTIE_LUES_MAX, 40);
  const mille = Array.from({ length: 1000 }, (_, i) => `#${i.toString(16).padStart(6, "0")}`);
  assert.deepEqual(couleursDeLaPartie(mille), mille.slice(0, 40).map((c) => c.toUpperCase()));
  const quinze = mille.slice(0, 15).map((c) => c.toUpperCase());
  assert.deepEqual(groupesDuDessin({ st0: "#000000" }, [{ zone: "st0", couleurs: quinze }])[0]?.couleurs, quinze);
  // Le client, lui, n'en voit que les 10 premières.
  assert.deepEqual(pastillesDeLaRangee("accessory", quinze, NUANCIER_ACCESSOIRES, REPLI), {
    couleurs: quinze.slice(0, 10),
    libre: false,
  });
  assert.deepEqual(pastillesDeLaRangee("clothes", quinze, [], REPLI).couleurs.length, 10);
});

test("refusDesCouleursDesParties : l'API refuse une couleur mal écrite ou plus de 10 couleurs", () => {
  assert.equal(refusDesCouleursDesParties(undefined), null);
  assert.equal(refusDesCouleursDesParties([{ zone: "st0" }, { zone: "st1", couleurs: null }]), null);
  assert.equal(
    refusDesCouleursDesParties([{ zone: "st0", couleurs: ["#e7b033", "#000000"] }]),
    null,
    "minuscules acceptées : elles sont remises en majuscules au nettoyage",
  );
  // Les doublons ne sont pas une erreur : ils comptent pour une seule couleur.
  const dixEtDoublons = [
    ...Array.from({ length: 10 }, (_, i) => `#0000${i.toString(16).padStart(2, "0")}`),
    "#000000",
    "#000001",
  ];
  assert.equal(refusDesCouleursDesParties([{ zone: "st0", couleurs: dixEtDoublons }]), null);
  assert.match(
    refusDesCouleursDesParties([{ zone: "st0", couleurs: ["#E7B033", "#abc"] }]) ?? "",
    /« #abc » n'est pas un code couleur : écrivez-le comme #B8551D/,
  );
  assert.match(
    refusDesCouleursDesParties([{ zone: "st0", couleurs: [12] }]) ?? "",
    /n'est pas un code couleur/,
  );
  assert.match(refusDesCouleursDesParties([{ zone: "st0", couleurs: "#E7B033" }]) ?? "", /pas pu être lues/);
  const onze = Array.from({ length: 11 }, (_, i) => `#0000${i.toString(16).padStart(2, "0")}`);
  assert.match(
    refusDesCouleursDesParties([{ zone: "st0", couleurs: onze }]) ?? "",
    /10 couleurs au plus/,
  );
  // Une famille d'un dessin en pixels, de même.
  assert.match(
    refusDesCouleursDesParties([{ cle: "fam0", reference: "#000000", couleurs: onze }]) ?? "",
    /10 couleurs au plus/,
  );

  // UNE LISTE D'AVANT LA BORNE (15 couleurs, rangée quand c'était 40) : elle
  // repart telle quelle, rangée autrement ou raccourcie, sans refus — sinon
  // plus rien ne s'enregistrerait sur la pièce. Ce qui est refusé, c'est d'y
  // AJOUTER une couleur.
  const quinze = Array.from({ length: 15 }, (_, i) => `#00${i.toString(16).padStart(2, "0")}00`.toUpperCase());
  const rangees = listesDesParties(
    [{ zone: "st0", couleurs: quinze }, { zone: "st1" }],
    [{ cle: "fam0", reference: "#000000", couleurs: ["#FFFFFF"] }],
  );
  assert.deepEqual(rangees, [quinze, ["#FFFFFF"]]);
  assert.equal(refusDesCouleursDesParties([{ zone: "st0", couleurs: quinze }], rangees), null);
  assert.equal(refusDesCouleursDesParties([{ zone: "st0", couleurs: [...quinze].reverse() }], rangees), null);
  assert.equal(refusDesCouleursDesParties([{ zone: "st0", couleurs: quinze.slice(0, 12) }], rangees), null);
  // La liste a suivi sa partie ailleurs (une relecture du dessin) : passe aussi.
  assert.equal(refusDesCouleursDesParties([{ zone: "st4", couleurs: quinze }], rangees), null);
  assert.match(
    refusDesCouleursDesParties([{ zone: "st0", couleurs: [...quinze, "#ABCDEF"] }], rangees) ?? "",
    /10 couleurs au plus/,
  );
  assert.match(
    refusDesCouleursDesParties([{ zone: "st0", couleurs: [...quinze.slice(1), "#ABCDEF"] }], rangees) ?? "",
    /10 couleurs au plus/,
    "une couleur remplacée par une nouvelle, c'est un ajout",
  );
  // Une famille en pixels, de même ; et sans liste rangée, 11 restent refusées.
  assert.equal(refusDesCouleursDesParties([{ cle: "fam0", reference: "#000000", couleurs: quinze }], rangees), null);
  assert.match(refusDesCouleursDesParties([{ zone: "st0", couleurs: onze }], [["#FFFFFF"]]) ?? "", /10 couleurs au plus/);
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

test("pastillesDeLaRangee : la liste d'une partie, sans saisie libre, sur toutes les pièces", () => {
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
  // Les autres emplacements : la liste de la partie, fermée, quand elle
  // existe — même sans nuancier de catégorie, où le client avait la saisie
  // libre. Sans liste, comme avant : la catégorie fermée, sinon le repli avec
  // la saisie libre.
  for (const slot of ["clothes", "pants", "hair"]) {
    assert.deepEqual(pastillesDeLaRangee(slot, propres, NUANCIER_ACCESSOIRES, REPLI), {
      couleurs: propres,
      libre: false,
    });
    assert.deepEqual(pastillesDeLaRangee(slot, propres, [], REPLI), { couleurs: propres, libre: false });
    assert.deepEqual(pastillesDeLaRangee(slot, [], NUANCIER_ACCESSOIRES, REPLI), {
      couleurs: NUANCIER_ACCESSOIRES,
      libre: false,
    });
    assert.deepEqual(pastillesDeLaRangee(slot, undefined, [], REPLI), { couleurs: REPLI, libre: true });
  }
});

test("une pièce en pixels propose toutes ses familles ; une commande d'avant s'imprime pareil", () => {
  const couleursImage = {
    familles: [
      { cle: "fam0", reference: "#8B5B38", part: 0.7, proposee: true },
      { cle: "fam1", reference: "#FFFFFF", part: 0.3, defaut: "#EEEEEE" },
    ],
  };
  const toutes = avecToutesLesFamillesProposees(couleursImage);
  assert.deepEqual(
    famillesProposees(toutes).map((f) => f.cle),
    ["fam0", "fam1"],
  );
  // L'original n'est pas touché, et une pièce déjà toute proposée revient
  // telle quelle : l'empreinte de ses fichiers d'impression ne bouge pas.
  assert.equal(couleursImage.familles[1]!.proposee, undefined);
  assert.equal(avecToutesLesFamillesProposees(toutes), toutes);
  assert.equal(avecToutesLesFamillesProposees(null), null);
  // Une commande passée quand fam1 était décochée n'a pas de clé pour elle :
  // elle garde son défaut, comme avant.
  assert.deepEqual(couleursDesFamilles({ fam0: "#2060C0" }, toutes), {
    fam0: "#2060C0",
    fam1: "#EEEEEE",
  });
  assert.deepEqual(
    couleursDesFamilles({ fam0: "#2060C0" }, toutes),
    couleursDesFamilles({ fam0: "#2060C0" }, couleursImage),
  );
  // Une nouvelle, où le client a choisi fam1, s'imprime avec son choix.
  assert.deepEqual(couleursDesFamilles({ fam1: "#101010" }, toutes), { fam1: "#101010" });
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
