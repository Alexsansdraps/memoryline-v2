/**
 * ¢ £ ¤ ¥ ƒ ₤ en « Manuscrite » : la version d'essai d'another shabby les
 * dessine avec le tampon de l'éditeur, comme ses chiffres. Ils s'écrivent donc
 * dans une autre police (CARACTERES_ABSENTS, packages/types/src/fonts.ts), à
 * l'écran comme sur le papier. Sans base.
 *
 * 26/11 (relecture de « qualité affiches IA pas top », puis la suivante pour
 * « ¢ », au tampon décalé d'un pixel) : ils passent en Caveat.
 *
 * 27/11, Alexandra : « j'aime pas les chiffres en manuscrite », « trouve une
 * autre police très proche qui fait les chiffres bien », puis « oui oui mets
 * cette police à la place de l'autre ». La police de secours devient Kaushan
 * Script (ID_POLICE_DE_SECOURS) : ¢ £ ¤ ¥ ƒ s'y écrivent. Sauf « ₤ », que
 * Kaushan Script n'a pas : lui reste en Caveat (SECOURS_PAR_CARACTERE).
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/manuscrite-symboles.test.ts
 *
 * Les rendus passent par le moteur du PDF et demandent les polices des
 * affiches, installées dans l'image de l'API : ailleurs, ils sont sautés.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { morceauxDeTexte, policeParId, type PosterConfig } from "@memoryline/types";
import { renderPosterPng, type ResolveData } from "../src/pdf.js";

/** Ceux que Kaushan Script écrit. */
const SYMBOLES_KAUSHAN = ["¢", "£", "¤", "¥", "ƒ"];

test("¢ £ ¤ ¥ ƒ partent en Kaushan Script, ₤ en Caveat ; les lettres autour restent en Manuscrite", () => {
  const manuscrite = policeParId("shabby", "shabby");
  assert.equal(manuscrite.id, "shabby");
  for (const s of SYMBOLES_KAUSHAN) {
    const morceaux = morceauxDeTexte(`Londres ${s}25`, manuscrite);
    assert.deepEqual(
      morceaux.map((m) => [m.texte, m.police.id]),
      [
        ["Londres ", "shabby"],
        [`${s}25`, "kaushan"],
      ],
      s,
    );
  }
  // « ₤ » n'est pas dans Kaushan Script : Caveat, et les chiffres qui le
  // suivent en Kaushan Script.
  assert.deepEqual(
    morceauxDeTexte("Londres ₤25", manuscrite).map((m) => [m.texte, m.police.id]),
    [
      ["Londres ", "shabby"],
      ["₤", "caveat"],
      ["25", "kaushan"],
    ],
  );
  // Les autres polices n'en sont pas touchées.
  const serif = policeParId("serif", "serif");
  assert.equal(morceauxDeTexte("Londres £25", serif).length, 1);
  assert.equal(morceauxDeTexte("Londres ₤25", serif).length, 1);
});

function policesInstallees(): boolean {
  try {
    const familles = execFileSync("fc-list", [":", "family"], { encoding: "utf8" });
    return (
      /another shabby/i.test(familles) && /\bCaveat\b/.test(familles) && /\bKaushan Script\b/.test(familles)
    );
  } catch {
    return false;
  }
}
const sansPolices = !policesInstallees() && "polices des affiches absentes (hors de l'image de l'API)";

const DONNEES: ResolveData = {
  assets: new Map(),
  characters: new Map(),
  backgrounds: new Map(),
  signature: null,
};

const TETE = [
  { value: "LONDRES", font: "serif", color: "#2F3436" },
  { value: "Famille Dupont", font: "shabby", color: "#2F3436" },
];

/** Une affiche A4 rendue par le moteur, en niveaux de gris. */
async function rendu(lignes: { value: string; font: string; color: string }[]): Promise<Buffer> {
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

/** L'encre d'un rendu (texte foncé sur blanc), en pixels pleins. */
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
 * entière de symboles s'écrit d'un seul morceau en police de secours : le
 * moteur la pose exactement comme si la ligne était dans cette police-là.
 * Plus strict qu'une pesée d'encre : Kaushan Script, pinceau épais, pèse
 * presque autant que les tampons.
 */
async function memeDessinQuEn(valeur: string, font: string, nom: string): Promise<void> {
  sansLigne3 ??= rendu(TETE);
  const sans = encre(await sansLigne3);
  const manuscrite = await rendu([...TETE, { value: valeur, font: "shabby", color: "#2F3436" }]);
  const temoin = await rendu([...TETE, { value: valeur, font, color: "#2F3436" }]);
  const encreDeLaLigne = encre(temoin) - sans;
  assert.ok(encreDeLaLigne > 0, `« ${valeur} » en ${nom} n'a laissé aucune encre`);
  const part = ecart(manuscrite, temoin) / encreDeLaLigne;
  assert.ok(
    part < 0.02,
    `« ${valeur} » en Manuscrite s'écarte de ${(part * 100).toFixed(0)} % du dessin en ${nom} ` +
      `(encre : ${Math.round(encre(manuscrite) - sans)} contre ${Math.round(encreDeLaLigne)}) : les tampons sont revenus ?`,
  );
}

test(
  "« ¢£¤¥ƒ » seuls en ligne 3, en Manuscrite : même dessin qu'en Kaushan Script (aucun tampon)",
  { skip: sansPolices },
  async () => {
    // Sans espaces : celles-ci restent en Manuscrite, d'une autre chasse.
    await memeDessinQuEn(SYMBOLES_KAUSHAN.join(""), "kaushan", "Kaushan Script");
  },
);

test("« ₤ » seul en ligne 3, en Manuscrite : même dessin qu'en Caveat (aucun tampon)", { skip: sansPolices }, async () => {
  await memeDessinQuEn("₤", "caveat", "Caveat");
});

test("témoin : au moteur, « ¢£¤¥ƒ » en Caveat ne passe pas pour du Kaushan Script", { skip: sansPolices }, async () => {
  // Sans ce témoin, l'essai pourrait ne pas voir des symboles restés en Caveat.
  await assert.rejects(memeDessinQuEn(SYMBOLES_KAUSHAN.join(""), "caveat", "Caveat"));
});
