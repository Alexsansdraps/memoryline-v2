/**
 * Les chiffres de la Manuscrite sur le fichier d'impression, sans base de
 * données.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/chiffres-manuscrite.test.ts
 *
 * « another shabby » est une version d'essai : ses chiffres (et € $ & @ #)
 * sont le logo de l'éditeur, un tampon « GET THE FULL PRO VERSION —
 * ZETAFONTS.COM ». Ils s'écrivent donc dans une autre police (morceauxDeTexte,
 * packages/types/src/fonts.ts), à l'écran comme sur le papier : Caveat
 * jusqu'au 26/11, Kaushan Script depuis le 27/11.
 *
 * Margaux, 20/11 : « ça met erreur mais uniquement quand on dl le pdf », « pas
 * avec toutes les polices » ; 26/11 : « erreur chiffre "police manuscrite" en
 * ligne 3 ». Une ligne faite SEULEMENT de chiffres — « 2025 » seul en
 * ligne 3 — sortait en quatre tampons sur tout ce que dessine le serveur : le
 * PDF, et la vignette que montrent le BO, le compte de la cliente et les
 * courriels. Le module, lui, montrait bien « 2025 » : le moteur l'écrivait
 * dans la police de la ligne (contenuDeLigne, apps/api/src/pdf.ts).
 *
 * Alexandra, 27/11 : « j'aime pas les chiffres en manuscrite », « trouve une
 * autre police très proche qui fait les chiffres bien », puis « oui oui mets
 * cette police à la place de l'autre ». Caveat, plus fine, se voyait au milieu
 * du mot : les chiffres passent en Kaushan Script (ID_POLICE_DE_SECOURS).
 *
 * L'essai passe par le vrai moteur (renderPosterPng) et compare le DESSIN de
 * l'affiche : sa ligne 3 écrite en Manuscrite doit sortir au pixel près
 * comme la même ligne écrite en Kaushan Script, puisque ses chiffres SONT du
 * Kaushan Script. Peser l'encre ne suffit plus (27/11) : Kaushan Script, au
 * pinceau, en porte presque autant que les tampons. Un tampon est un disque
 * plein, bordé de lettres : rien de commun avec « 2025 » au trait (voir les
 * témoins, qui vérifient aussi que des chiffres restés en Caveat se voient).
 *
 * Il lui faut les polices des affiches, installées dans l'image de l'API
 * (Dockerfile) : ailleurs, il est sauté plutôt que faux.
 *
 * Les vignettes déjà rangées de ces lignes-là portent les chiffres de Caveat
 * (ou, avant le 26/11, les tampons) : leur version change (apercus.ts, sel
 * « secours-kaushan »), et seulement la leur — derniers essais, sans rendu.
 * Depuis le 27/11, cela vaut pour TOUTE ligne dont un morceau s'écrit en
 * police de secours, « Noël 2026 » compris. Elle suit les bouts que POSE le
 * moteur (boutsDeTexteImprimes, pdf.ts) : un emoji absent du jeu Twemoji
 * (« 🧑‍🧑‍🧒 2025 », relecture du 26/11) s'efface à l'impression, et
 * « 2025 » y reste seul.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { PosterConfig, TextBlock } from "@memoryline/types";
import { versionApercu } from "../src/apercus.js";
import { renderPosterPng, type ResolveData } from "../src/pdf.js";

/** Les deux polices sont-elles connues du moteur (fontconfig) ? */
function policesInstallees(): boolean {
  try {
    const familles = execFileSync("fc-list", [":", "family"], { encoding: "utf8" });
    return /another shabby/i.test(familles) && /\bKaushan Script\b/.test(familles);
  } catch {
    return false;
  }
}
const sansPolices = !policesInstallees() && "polices des affiches absentes (hors de l'image de l'API)";

/** Rien à charger : une affiche sans fond, sans personnage, sans signature. */
const DONNEES: ResolveData = {
  assets: new Map(),
  characters: new Map(),
  backgrounds: new Map(),
  signature: null,
};
const ENCRE = "#2F3436";

/** Les deux premières lignes, identiques d'un rendu à l'autre. */
const TETE: TextBlock[] = [
  { value: "MULHOUSE", font: "serif", color: ENCRE },
  { value: "Famille Dupont", font: "shabby", color: ENCRE },
];

/** Une affiche A4 rendue par le moteur, en niveaux de gris. */
async function rendu(lignes: TextBlock[]): Promise<Buffer> {
  const config = {
    schemaVersion: 1,
    format: "A4",
    view: "front",
    characters: [],
    texts: { lines: lignes },
  } as PosterConfig;
  const png = await renderPosterPng(config, { data: DONNEES, format: "A4" });
  return (await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true })).data;
}

/**
 * L'encre d'un rendu (texte foncé sur blanc) : la somme des assombrissements,
 * en pixels pleins — insensible à l'anticrénelage, qui déplace l'encre d'un
 * pixel à l'autre sans en changer la quantité.
 */
function encre(pixels: Buffer): number {
  let somme = 0;
  for (const v of pixels) somme += 255 - v;
  return somme / 255;
}

/** Ce qui sépare deux rendus de même taille, en pixels pleins. */
function ecart(a: Buffer, b: Buffer): number {
  assert.equal(a.length, b.length);
  let somme = 0;
  for (let i = 0; i < a.length; i++) somme += Math.abs(a[i]! - b[i]!);
  return somme / 255;
}

let sansLigne3: Promise<Buffer> | undefined;
/**
 * La ligne 3 en Manuscrite et dans la police `font` : le MÊME dessin, au
 * pixel près (moins de 2 % de l'encre de la ligne). Une ligne faite toute
 * entière de chiffres s'écrit d'un seul morceau en police de secours : le
 * moteur la pose exactement comme si la ligne était dans cette police-là.
 * Plus strict qu'une pesée d'encre : Kaushan Script, pinceau épais, pèse
 * presque autant que les tampons sur « € $ & @ # » (1,09 fois au témoin du
 * 27/11), mais ne leur ressemble en rien.
 */
async function memeDessinQuEn(ligne: Omit<TextBlock, "color" | "font">, font: string, nom: string): Promise<void> {
  sansLigne3 ??= rendu(TETE);
  const sans = encre(await sansLigne3);
  const manuscrite = await rendu([...TETE, { ...ligne, font: "shabby", color: ENCRE }]);
  const temoin = await rendu([...TETE, { ...ligne, font, color: ENCRE }]);
  const encreDeLaLigne = encre(temoin) - sans;
  assert.ok(encreDeLaLigne > 0, `la ligne « ${ligne.value} » en ${nom} n'a laissé aucune encre`);
  const part = ecart(manuscrite, temoin) / encreDeLaLigne;
  assert.ok(
    part < 0.02,
    `« ${ligne.value} » en Manuscrite s'écarte de ${(part * 100).toFixed(0)} % du dessin en ${nom} ` +
      `(encre : ${Math.round(encre(manuscrite) - sans)} contre ${Math.round(encreDeLaLigne)}) : ` +
      `ses chiffres ne sont pas écrits en ${nom} (tampons de la version d'essai, ou encore Caveat ?)`,
  );
}
const memeDessinQuEnKaushan = (ligne: Omit<TextBlock, "color" | "font">) =>
  memeDessinQuEn(ligne, "kaushan", "Kaushan Script");

/**
 * Quand la ligne est coupée par Entrée ou placée à la main, le moteur la cale
 * d'après la police de la LIGNE (hauteur de ligne, ascendante) : les mêmes
 * chiffres en Kaushan Script sortent un peu plus haut ou plus bas qu'une
 * ligne en Kaushan Script, et l'écart au pixel ne dit plus rien. On pèse
 * alors l'encre, à 2 % près : au 27/11, elle est la même au pixel plein près,
 * quand les tampons en portent 1,29 fois plus sur « 2025 » et Caveat 0,4 fois.
 */
async function memeEncreQuEnKaushan(ligne: Omit<TextBlock, "color" | "font">): Promise<void> {
  sansLigne3 ??= rendu(TETE);
  const sans = encre(await sansLigne3);
  const manuscrite = encre(await rendu([...TETE, { ...ligne, font: "shabby", color: ENCRE }])) - sans;
  const kaushan = encre(await rendu([...TETE, { ...ligne, font: "kaushan", color: ENCRE }])) - sans;
  assert.ok(kaushan > 0, `la ligne « ${ligne.value} » en Kaushan Script n'a laissé aucune encre`);
  const rapport = manuscrite / kaushan;
  assert.ok(
    Math.abs(rapport - 1) < 0.02,
    `« ${ligne.value} » en Manuscrite porte ${rapport.toFixed(2)} fois l'encre de Kaushan Script : ` +
      `ses chiffres ne sont pas écrits en Kaushan Script (tampons de la version d'essai, ou encore Caveat ?)`,
  );
}

test("« 2025 » seul en ligne 3, en Manuscrite : ses chiffres s'impriment en Kaushan Script", { skip: sansPolices }, async () => {
  await memeDessinQuEnKaushan({ value: "2025" });
});

test("« €$&@# » seuls en ligne 3, en Manuscrite : ils s'impriment en Kaushan Script", { skip: sansPolices }, async () => {
  await memeDessinQuEnKaushan({ value: "€$&@#" });
});

test("témoin : au moteur, « 2025 » en Caveat ne passe pas pour du Kaushan Script", { skip: sansPolices }, async () => {
  // Sans ce témoin, l'essai pourrait ne pas voir des chiffres restés en Caveat.
  await assert.rejects(memeDessinQuEn({ value: "2025" }, "caveat", "Caveat"));
});

test("une année seule sous une ligne coupée par Entrée s'imprime en Kaushan Script", { skip: sansPolices }, async () => {
  await memeEncreQuEnKaushan({ value: "2025\n1990" });
});

test("une ligne de chiffres déplacée à la main (affiche photo) s'imprime en Kaushan Script", { skip: sansPolices }, async () => {
  await memeEncreQuEnKaushan({ value: "2025", x: 0.5, y: 0.3 });
});

test("des chiffres seuls entre deux emojis s'impriment en Kaushan Script", { skip: sansPolices }, async () => {
  await memeDessinQuEnKaushan({ value: "🎄2025🎄" });
});

test("des chiffres après un emoji que le jeu ne dessine pas s'impriment en Kaushan Script", { skip: sansPolices }, async () => {
  // L'emoji (Unicode 15.1, absent de @twemoji/svg 15.0) s'efface à
  // l'impression : « 2025 » reste seul (relecture du 26/11).
  await memeDessinQuEnKaushan({ value: "🧑‍🧑‍🧒 2025" });
});

test("témoin : le logo de la version d'essai ne ressemble en rien à des chiffres au trait", { skip: sansPolices }, async () => {
  // Si ce témoin tombe, la police a ses vrais chiffres (licence achetée) :
  // vider CARACTERES_ABSENTS (fonts.ts), et revoir cet essai.
  const ecrire = async (famille: string) => {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="300">` +
      `<rect width="100%" height="100%" fill="#fff"/>` +
      `<text x="40" y="200" font-family="${famille}" font-size="120" fill="#000">2025</text></svg>`;
    return (await sharp(Buffer.from(svg)).greyscale().raw().toBuffer({ resolveWithObject: true })).data;
  };
  const tampons = await ecrire("another shabby");
  const chiffres = await ecrire("Kaushan Script");
  // Kaushan Script, au pinceau, pèse 0,78 fois les tampons (27/11) : c'est
  // le dessin qui les sépare, pas l'encre.
  assert.ok(
    ecart(tampons, chiffres) > 0.5 * encre(chiffres),
    `« 2025 » : écart ${Math.round(ecart(tampons, chiffres))} entre another shabby et Kaushan Script, ` +
      `pour ${Math.round(encre(chiffres))} d'encre en Kaushan Script`,
  );
});

/** La version telle qu'apercus.ts la calcule avec les seuls sels donnés (dans leur ordre). */
const avecSels = (config: unknown, ...sels: string[]) => {
  const h = createHash("sha1").update(JSON.stringify(config ?? null));
  for (const sel of sels) h.update(sel);
  return h.digest("base64url").slice(0, 10);
};
/** Toutes les versions qu'une vignette a pu porter jusqu'au 26/11 au soir. */
const versionsDAvant = (config: unknown) => [
  avecSels(config),
  avecSels(config, "chiffres-en-caveat"),
  avecSels(config, "symboles-en-caveat"),
  avecSels(config, "chiffres-en-caveat", "symboles-en-caveat"),
];
const affiche = (ligne3: TextBlock) => ({
  schemaVersion: 1,
  format: "A4",
  view: "front",
  characters: [],
  texts: { lines: [...TETE, { ...ligne3, color: ENCRE }] },
});
/** La version a changé depuis le 26/11 : aucune de celles d'avant. */
function changeDeVersion(config: unknown, message: string): void {
  const v = versionApercu(config);
  for (const avant of versionsDAvant(config)) assert.notEqual(v, avant, message);
}

test("la vignette d'une ligne avec des chiffres en Manuscrite change de version (27/11), et elle seule", () => {
  // Rangées avec des tampons, ou les chiffres de Caveat : elles se refont une fois.
  for (const ligne3 of [
    { value: "2025", font: "shabby" },
    // Sans police, la ligne 3 est en Manuscrite, au moteur comme ici.
    { value: "2025" },
    { value: "Noël\n2025", font: "shabby" },
    { value: "🎄2025🎄", font: "shabby" },
    // Emojis absents du jeu, effacés à l'impression : « 2025 » y reste seul.
    { value: "🧑‍🧑‍🧒 2025", font: "shabby" },
    { value: "2025 🫩", font: "shabby" },
    { value: "Famille Martin\n🧑‍🧑‍🧒 1990", font: "shabby" },
    // Lettres et chiffres mêlés : leurs chiffres étaient en Caveat, ils
    // passent en Kaushan Script (27/11).
    { value: "Noël 2026", font: "shabby" },
    { value: "24/12/2025", font: "shabby" },
    { value: "2025 🎄", font: "shabby" },
    { value: "🎄 2025", font: "shabby" },
    { value: "Prix 25 €", font: "shabby" },
    { value: "Mariage & fête", font: "shabby" },
  ])
    changeDeVersion(affiche(ligne3), JSON.stringify(ligne3));
  // Sans chiffre, sans symbole, ou dans une police qui a les siens : même
  // version, donc même adresse dans les courriels.
  for (const ligne3 of [
    { value: "2025", font: "serif" },
    { value: "Noël 2026", font: "caveat" },
    { value: "Été au bord de l'eau", font: "shabby" },
    { value: "Été au bord de l'eau" },
    { value: "Famille Martin\nNoël", font: "shabby" },
  ])
    assert.equal(versionApercu(affiche(ligne3)), avecSels(affiche(ligne3)), JSON.stringify(ligne3));
});

test("¢ £ ¤ ¥ ƒ ₤ dans une ligne en Manuscrite : la vignette change de version (27/11), et elle seule", () => {
  // Rangées avec un tampon, ou le symbole en Caveat : elles se refont une fois.
  for (const ligne3 of [
    { value: "Voyage à Londres £", font: "shabby" },
    { value: "Prix 25 ¥", font: "shabby" },
    { value: "Souvenir ¢ ¤ ƒ ₤", font: "shabby" },
    // Sans police, la ligne 3 est en Manuscrite, au moteur comme ici.
    { value: "Londres £" },
    { value: "Noël 2025\nLondres £", font: "shabby" },
    { value: "£", font: "shabby" },
    // « ₤ » reste en Caveat : sa vignette n'avait pas besoin de se refaire,
    // mais le sel ne regarde que « un morceau en police de secours » ; elle
    // se refait une fois de plus, sans dommage (voulu, apercus.ts).
    { value: "₤", font: "shabby" },
  ])
    changeDeVersion(affiche(ligne3), JSON.stringify(ligne3));
  // Justes avant : même version, donc même adresse dans les courriels.
  for (const ligne3 of [
    // La serif a ces symboles : rien n'a changé pour elle.
    { value: "Londres £", font: "serif" },
    { value: "Londres ₤", font: "serif" },
    { value: "Été au bord de l'eau", font: "shabby" },
  ])
    assert.equal(versionApercu(affiche(ligne3)), avecSels(affiche(ligne3)), JSON.stringify(ligne3));
  // Le titre (ligne 1, serif par défaut) avec un symbole et des chiffres : inchangé.
  const titre = {
    schemaVersion: 1,
    format: "A4",
    view: "front",
    characters: [],
    texts: { lines: [{ value: "LONDRES £ 2025", color: ENCRE }, { value: "Famille Dupont", font: "shabby", color: ENCRE }] },
  };
  assert.equal(versionApercu(titre), avecSels(titre));
});
