/**
 * Les chiffres de la Manuscrite sur le fichier d'impression, sans base de
 * données.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/chiffres-manuscrite.test.ts
 *
 * « another shabby » est une version d'essai : ses chiffres (et € $ & @ #)
 * sont le logo de l'éditeur, un tampon « GET THE FULL PRO VERSION —
 * ZETAFONTS.COM ». Ils s'écrivent donc en Caveat (morceauxDeTexte,
 * packages/types/src/fonts.ts), à l'écran comme sur le papier.
 *
 * Margaux, 20/11 : « ça met erreur mais uniquement quand on dl le pdf », « pas
 * avec toutes les polices » ; 26/11 : « erreur chiffre "police manuscrite" en
 * ligne 3 ». Une ligne faite SEULEMENT de chiffres — « 2025 » seul en
 * ligne 3 — sortait en quatre tampons sur tout ce que dessine le serveur : le
 * PDF, et la vignette que montrent le BO, le compte de la cliente et les
 * courriels. Le module, lui, montrait bien « 2025 » : le moteur l'écrivait
 * dans la police de la ligne (contenuDeLigne, apps/api/src/pdf.ts).
 *
 * L'essai passe par le vrai moteur (renderPosterPng) et pèse l'ENCRE de la
 * ligne 3 : écrite en Manuscrite, elle doit en porter autant que la même
 * ligne écrite en Caveat, puisque ses chiffres SONT du Caveat. Un tampon est
 * un disque plein, bordé de lettres : quatre tampons portent bien plus
 * d'encre que « 2025 » au trait (voir le témoin, dernier essai).
 *
 * Il lui faut les polices des affiches, installées dans l'image de l'API
 * (Dockerfile) : ailleurs, il est sauté plutôt que faux.
 *
 * Les vignettes déjà rangées de ces lignes-là portent les tampons : leur
 * version change (apercus.ts, lignesEnPoliceDeSecours), et seulement la
 * leur — dernier essai, sans rendu. Elle suit les bouts que POSE le moteur
 * (boutsDeTexteImprimes, pdf.ts) : un emoji absent du jeu Twemoji
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
    return /another shabby/i.test(familles) && /\bCaveat\b/.test(familles);
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

/**
 * L'encre d'une affiche A4 (texte foncé sur blanc) : la somme des
 * assombrissements, en pixels pleins — insensible à l'anticrénelage, qui
 * déplace l'encre d'un pixel à l'autre sans en changer la quantité.
 */
async function encre(lignes: TextBlock[]): Promise<number> {
  const config = {
    schemaVersion: 1,
    format: "A4",
    view: "front",
    characters: [],
    texts: { lines: lignes },
  } as PosterConfig;
  const png = await renderPosterPng(config, { data: DONNEES, format: "A4" });
  const { data } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  let somme = 0;
  for (const v of data) somme += 255 - v;
  return somme / 255;
}

/** L'encre de la ligne 3 seule : l'affiche avec, moins l'affiche sans. */
let sansLigne3: Promise<number> | undefined;
async function encreDeLaLigne3(ligne: Omit<TextBlock, "color">): Promise<number> {
  sansLigne3 ??= encre(TETE);
  return (await encre([...TETE, { ...ligne, color: ENCRE }])) - (await sansLigne3);
}

/** La même ligne en Manuscrite et en Caveat : même encre, à 10 % près. */
async function memeEncreQuEnCaveat(ligne: Omit<TextBlock, "color" | "font">): Promise<void> {
  const manuscrite = await encreDeLaLigne3({ ...ligne, font: "shabby" });
  const caveat = await encreDeLaLigne3({ ...ligne, font: "caveat" });
  assert.ok(caveat > 0, `la ligne « ${ligne.value} » en Caveat n'a laissé aucune encre`);
  const rapport = manuscrite / caveat;
  assert.ok(
    Math.abs(rapport - 1) < 0.1,
    `« ${ligne.value} » en Manuscrite porte ${rapport.toFixed(2)} fois l'encre de Caveat : ` +
      `ses chiffres ne sont pas écrits en Caveat (tampons de la version d'essai ?)`,
  );
}

test("« 2025 » seul en ligne 3, en Manuscrite : ses chiffres s'impriment en Caveat", { skip: sansPolices }, async () => {
  await memeEncreQuEnCaveat({ value: "2025" });
});

test("une année seule sous une ligne coupée par Entrée s'imprime en Caveat", { skip: sansPolices }, async () => {
  await memeEncreQuEnCaveat({ value: "2025\n1990" });
});

test("une ligne de chiffres déplacée à la main (affiche photo) s'imprime en Caveat", { skip: sansPolices }, async () => {
  await memeEncreQuEnCaveat({ value: "2025", x: 0.5, y: 0.3 });
});

test("des chiffres seuls entre deux emojis s'impriment en Caveat", { skip: sansPolices }, async () => {
  await memeEncreQuEnCaveat({ value: "🎄2025🎄" });
});

test("des chiffres après un emoji que le jeu ne dessine pas s'impriment en Caveat", { skip: sansPolices }, async () => {
  // L'emoji (Unicode 15.1, absent de @twemoji/svg 15.0) s'efface à
  // l'impression : « 2025 » reste seul (relecture du 26/11).
  await memeEncreQuEnCaveat({ value: "🧑‍🧑‍🧒 2025" });
});

test("témoin : le logo de la version d'essai pèse bien plus que des chiffres au trait", { skip: sansPolices }, async () => {
  // Si ce témoin tombe, la police a ses vrais chiffres (licence achetée) :
  // vider CARACTERES_ABSENTS (fonts.ts), et revoir cet essai.
  const ecrire = async (famille: string) => {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="300">` +
      `<rect width="100%" height="100%" fill="#fff"/>` +
      `<text x="40" y="200" font-family="${famille}" font-size="120" fill="#000">2025</text></svg>`;
    const { data } = await sharp(Buffer.from(svg)).greyscale().raw().toBuffer({ resolveWithObject: true });
    let somme = 0;
    for (const v of data) somme += 255 - v;
    return somme;
  };
  const tampons = await ecrire("another shabby");
  const chiffres = await ecrire("Caveat");
  assert.ok(
    tampons > 1.5 * chiffres,
    `« 2025 » en another shabby : ${Math.round(tampons)} ; en Caveat : ${Math.round(chiffres)}`,
  );
});

test("la vignette d'une ligne toute en Caveat change de version, et elle seule", () => {
  /** La version telle qu'apercus.ts la calcule sans aucun sel. */
  const sansSel = (config: unknown) =>
    createHash("sha1").update(JSON.stringify(config ?? null)).digest("base64url").slice(0, 10);
  const affiche = (ligne3: TextBlock) => ({
    schemaVersion: 1,
    format: "A4",
    view: "front",
    characters: [],
    texts: { lines: [...TETE, { ...ligne3, color: ENCRE }] },
  });
  // Rangées avec des tampons : elles se refont une fois.
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
  ])
    assert.notEqual(versionApercu(affiche(ligne3)), sansSel(affiche(ligne3)), JSON.stringify(ligne3));
  // Justes avant le 26/11 : même version, donc même adresse dans les courriels.
  for (const ligne3 of [
    { value: "Noël 2026", font: "shabby" },
    { value: "24/12/2025", font: "shabby" },
    { value: "2025 🎄", font: "shabby" },
    { value: "🎄 2025", font: "shabby" },
    { value: "2025", font: "serif" },
    { value: "Été au bord de l'eau", font: "shabby" },
  ])
    assert.equal(versionApercu(affiche(ligne3)), sansSel(affiche(ligne3)), JSON.stringify(ligne3));
});
