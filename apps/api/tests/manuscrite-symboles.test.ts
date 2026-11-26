/**
 * ¢ £ ¤ ¥ ƒ ₤ en « Manuscrite » (26/11, relecture de « qualité affiches IA
 * pas top », puis la suivante pour « ¢ », au tampon décalé d'un pixel) : la
 * version d'essai d'another shabby les dessine avec le tampon de l'éditeur,
 * comme ses chiffres ; Caveat a les six. Ils s'écrivent donc en Caveat
 * (CARACTERES_ABSENTS, packages/types/src/fonts.ts), à l'écran comme sur le
 * papier. Sans base.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/manuscrite-symboles.test.ts
 *
 * Le rendu (dernier essai) passe par le moteur du PDF et demande les polices
 * des affiches, installées dans l'image de l'API : ailleurs, il est sauté.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { morceauxDeTexte, policeParId, type PosterConfig } from "@memoryline/types";
import { renderPosterPng, type ResolveData } from "../src/pdf.js";

const SYMBOLES = ["¢", "£", "¤", "¥", "ƒ", "₤"];

test("chacun des six symboles part en Caveat ; les lettres autour restent en Manuscrite", () => {
  const manuscrite = policeParId("shabby", "shabby");
  assert.equal(manuscrite.id, "shabby");
  for (const s of SYMBOLES) {
    const morceaux = morceauxDeTexte(`Londres ${s}25`, manuscrite);
    assert.deepEqual(
      morceaux.map((m) => [m.texte, m.police.id]),
      [
        ["Londres ", "shabby"],
        [`${s}25`, "caveat"],
      ],
      s,
    );
  }
  // Les autres polices n'en sont pas touchées.
  const serif = policeParId("serif", "serif");
  assert.equal(morceauxDeTexte("Londres £25", serif).length, 1);
});

function policesInstallees(): boolean {
  try {
    const familles = execFileSync("fc-list", [":", "family"], { encoding: "utf8" });
    return /another shabby/i.test(familles) && /\bCaveat\b/.test(familles);
  } catch {
    return false;
  }
}

test(
  "« ¢ £ ¤ ¥ ƒ ₤ » seuls en ligne 3, en Manuscrite : même encre qu'en Caveat (aucun tampon)",
  { skip: !policesInstallees() && "polices des affiches absentes (hors de l'image de l'API)" },
  async () => {
    const DONNEES: ResolveData = {
      assets: new Map(),
      characters: new Map(),
      backgrounds: new Map(),
      signature: null,
    };
    const encre = async (font: string) => {
      const config = {
        schemaVersion: 1,
        format: "A4",
        view: "front",
        characters: [],
        texts: {
          lines: [
            { value: "LONDRES", font: "serif", color: "#2F3436" },
            { value: "Famille Dupont", font: "shabby", color: "#2F3436" },
            { value: SYMBOLES.join(" "), font, color: "#2F3436" },
          ],
        },
      } as PosterConfig;
      const png = await renderPosterPng(config, { data: DONNEES, format: "A4" });
      const { data } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
      let somme = 0;
      for (const v of data) somme += 255 - v;
      return somme / 255;
    };
    const manuscrite = await encre("shabby");
    const caveat = await encre("caveat");
    assert.ok(
      Math.abs(manuscrite / caveat - 1) < 0.02,
      `en Manuscrite ${Math.round(manuscrite)}, en Caveat ${Math.round(caveat)} : les tampons sont revenus ?`,
    );
  },
);
