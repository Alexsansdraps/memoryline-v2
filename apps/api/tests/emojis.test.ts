/**
 * Les essais des emojis des lignes de texte, sans base de données.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/emojis.test.ts
 *
 * Ils vérifient ce qui décide de l'impression : qu'une ligne se découpe en
 * grappes entières (une famille liée, un drapeau, une teinte de peau restent
 * UN emoji), que « © » ou « 2026 » restent du texte, que le nom cherché dans
 * le jeu Twemoji est le bon — et que les emojis de Noël y sont tous —, et que
 * les bouts d'une ligne se posent bout à bout, la ligne centrée.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import {
  AVANCE_EMOJI,
  COTE_EMOJI,
  HAUT_EMOJI,
  boiteEmoji,
  codeEmoji,
  codesAEssayer,
  contientEmoji,
  departsDesSegments,
  estEmoji,
  largeurEmoji,
  segmentsDeLigne,
} from "@memoryline/types/emojis";

const emojis = (texte: string) =>
  segmentsDeLigne(texte)
    .filter((s) => s.type === "emoji")
    .map((s) => (s.type === "emoji" ? s.emoji : ""));

test("une ligne se découpe en texte et en emojis, dans l'ordre", () => {
  assert.deepEqual(segmentsDeLigne("Joyeux Noël 🎄❤️"), [
    { type: "texte", texte: "Joyeux Noël " },
    { type: "emoji", emoji: "🎄" },
    { type: "emoji", emoji: "❤️" },
  ]);
  assert.deepEqual(segmentsDeLigne("🇫🇷 Été ☀️🌊"), [
    { type: "emoji", emoji: "🇫🇷" },
    { type: "texte", texte: " Été " },
    { type: "emoji", emoji: "☀️" },
    { type: "emoji", emoji: "🌊" },
  ]);
});

test("une grappe liée, un drapeau, une teinte, une touche restent UN emoji", () => {
  assert.deepEqual(emojis("Famille 👨‍👩‍👧 ⭐✨"), ["👨‍👩‍👧", "⭐", "✨"]);
  assert.deepEqual(emojis("🇫🇷🇧🇪"), ["🇫🇷", "🇧🇪"]);
  assert.deepEqual(emojis("👍🏽"), ["👍🏽"]);
  assert.deepEqual(emojis("#️⃣1️⃣"), ["#️⃣", "1️⃣"]);
  assert.deepEqual(emojis("🏳️‍🌈"), ["🏳️‍🌈"]);
});

test("le texte reste du texte : accents, chiffres, ©, ™, forme texte", () => {
  for (const t of ["Été à la mer", "24/12/2025", "© Memory Line™", "↔", "MERS-LES-BAINS"])
    assert.equal(contientEmoji(t), false, t);
  // VS15 : la cliente a demandé la forme TEXTE.
  assert.equal(estEmoji("❤︎"), false);
  assert.equal(estEmoji("©"), false);
  assert.equal(estEmoji("é"), false);
});

test("les symboles nus des blocs « divers » sont des emojis", () => {
  // Sans VS16 : aucune police d'affiche ne les a, l'écran les montre en emoji.
  for (const e of ["❤", "☀", "❄", "⭐", "✨"]) assert.equal(estEmoji(e), true, e);
  assert.equal(contientEmoji("Noël ❤"), true);
});

test("le nom dans le jeu : points de code en hexadécimal, sans VS16", () => {
  assert.equal(codeEmoji("🎄"), "1f384");
  assert.equal(codeEmoji("❤️"), "2764");
  assert.equal(codeEmoji("👨‍👩‍👧"), "1f468-200d-1f469-200d-1f467");
  assert.equal(codeEmoji("🇫🇷"), "1f1eb-1f1f7");
  assert.equal(codeEmoji("#️⃣"), "23-20e3");
  assert.equal(codeEmoji("🏳️‍🌈"), "1f3f3-200d-1f308");
  // Une teinte que le jeu n'aurait pas : on retombe sur le personnage.
  assert.deepEqual(codesAEssayer("👍🏽"), ["1f44d-1f3fd", "1f44d"]);
  assert.deepEqual(codesAEssayer("🎄"), ["1f384"]);
});

test("les emojis des affiches de Noël ont tous leur image dans le jeu", () => {
  const dossier = dirname(createRequire(import.meta.url).resolve("@twemoji/svg/package.json"));
  // Même rapprochement que pdf.ts (fichiersEmojis) : sans VS16 des deux côtés.
  const jeu = new Set(
    readdirSync(dossier)
      .filter((n) => n.endsWith(".svg"))
      .map((n) => n.slice(0, -4).split("-").filter((c) => c !== "fe0f").join("-")),
  );
  const texte = "🎄❤️👨‍👩‍👧⭐✨🇫🇷☀️🌊❄️🎅🤶🎁🔔🕯️⛄☃️🦌🍼🐚👶🏽💍👩‍❤️‍👨🏳️‍🌈#️⃣";
  for (const e of emojis(texte))
    assert.ok(codesAEssayer(e).some((c) => jeu.has(c)), `${e} (${codeEmoji(e)})`);
});

test("les bouts se posent bout à bout, la ligne entière centrée", () => {
  const departs = departsDesSegments([100, 50, 30], 500);
  assert.deepEqual(departs, [410, 510, 560]);
  // Le dernier bout finit à égale distance du centre que le premier commence.
  assert.equal(500 - departs[0]!, departs[2]! + 30 - 500);
  assert.deepEqual(departsDesSegments([], 500), []);
});

test("un emoji prend son avance, espacement compris, et se pose sur la ligne de base", () => {
  assert.equal(largeurEmoji(0), AVANCE_EMOJI);
  assert.equal(largeurEmoji(0.04), AVANCE_EMOJI + 0.04);
  const b = boiteEmoji(1000, 300, 100);
  assert.equal(b.cote, COTE_EMOJI * 100);
  assert.equal(b.y, 300 - HAUT_EMOJI * 100);
  // Centrée dans son avance.
  assert.ok(Math.abs(b.x - 1000 - (AVANCE_EMOJI * 100 - b.cote) / 2) < 1e-9);
  // Le bas de l'image descend un peu sous la ligne de base, comme à l'écran.
  assert.ok(b.y + b.cote > 300 && b.y + b.cote < 300 + 0.25 * 100);
});
