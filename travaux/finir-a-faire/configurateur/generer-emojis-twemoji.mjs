// Écrit packages/configurator/src/components/emojis-twemoji.ts : les noms des
// images du jeu Twemoji que le fichier d'impression sait poser (apps/api,
// paquet @twemoji/svg), tels que pdf.ts les range (fichiersEmojis : le nom du
// fichier sans « .svg », sans les « fe0f »).
//
// À relancer (Git Bash, racine du dépôt) si apps/api change de version de
// @twemoji/svg :
//   node travaux/finir-a-faire/configurateur/generer-emojis-twemoji.mjs
// puis `node travaux/finir-a-faire/configurateur/verifier-emojis-twemoji.mjs`.
//
// Chantier « configurateur » du 28/11 (Alexandra : « finis le à faire »),
// A-FAIRE § 2 : « les emojis plus récents que Twemoji 15.0 disparaissent du
// papier sans avertissement ».
import { createRequire } from "node:module";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const racine = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const requireApi = createRequire(resolve(racine, "apps/api/package.json"));
const paquet = requireApi.resolve("@twemoji/svg/package.json");
const dossier = dirname(paquet);
const version = JSON.parse(readFileSync(paquet, "utf8")).version;

// Exactement la lecture de pdf.ts (fichiersEmojis).
const codes = new Set();
for (const nom of readdirSync(dossier).sort()) {
  if (!nom.endsWith(".svg")) continue;
  codes.add(nom.slice(0, -4).split("-").filter((c) => c !== "fe0f").join("-"));
}
const liste = [...codes].sort();
const rangees = [];
for (let i = 0; i < liste.length; i += 12) rangees.push(liste.slice(i, i + 12).join(" "));

const sortie = resolve(racine, "packages/configurator/src/components/emojis-twemoji.ts");
writeFileSync(
  sortie,
  `/*
 * FICHIER GÉNÉRÉ — ne pas le modifier à la main.
 *   node travaux/finir-a-faire/configurateur/generer-emojis-twemoji.mjs
 *
 * Les emojis que le fichier d'impression sait poser : les noms des images du
 * jeu Twemoji de l'API (paquet @twemoji/svg ${version}, apps/api/package.json),
 * lus comme pdf.ts les lit (fichiersEmojis) — sans « .svg », sans les « fe0f ».
 * L'écran s'en sert pour prévenir qu'un emoji tapé ne sera pas imprimé
 * (emojis-imprimables.ts). Chargé à la demande seulement, quand une ligne
 * contient un emoji : ${liste.length} noms, une cinquantaine de Ko.
 *
 * Si l'API change de version de @twemoji/svg, ce fichier doit être régénéré :
 * sans cela, l'écran préviendrait pour des emojis que le papier sait poser,
 * ou se tairait pour d'autres qu'il ne sait plus poser.
 */

/** La version du jeu de l'API dont la liste est tirée. */
export const VERSION_TWEMOJI = "${version}";

/** Les noms des images, séparés par des blancs (cf. codesAEssayer, @memoryline/types/emojis). */
export const CODES_TWEMOJI = \`
${rangees.join("\n")}
\`;
`,
);
console.log(`${sortie} : ${liste.length} noms (@twemoji/svg ${version})`);
