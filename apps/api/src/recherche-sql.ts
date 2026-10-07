/**
 * Les briques SQL de la recherche du back-office.
 *
 * Elles ne servent qu'aux sources qui grandissent sans fin — commandes,
 * paniers, clientes, inscrits, cartes cadeaux. Le reste (le catalogue, les
 * textes du site) tient en mémoire et se compare en JavaScript.
 *
 * Leur règle d'or : la base fait un PRÉFILTRE, et ce préfiltre doit garder
 * AU MOINS tout ce que le JavaScript garderait. C'est le JavaScript
 * (`evaluer`, dans @memoryline/types/recherche) qui décide en dernier. Un
 * préfiltre plus large ne coûte que quelques lignes lues pour rien ; un
 * préfiltre plus étroit ferait disparaître une commande sans que rien ne le
 * signale. Dans le doute, la base garde.
 */
import type { SQL } from "drizzle-orm";
import { sql as raw } from "drizzle-orm";
import type { JetonRequete } from "@memoryline/types/recherche";

/* -------------------------------------------------------------------------- */
/*  Aplatir côté base, comme `aplatir` côté JavaScript                        */
/* -------------------------------------------------------------------------- */

/**
 * Les lettres accentuées et leur lettre plate, pour `translate()`.
 *
 * L'extension `unaccent` de PostgreSQL ferait ce travail plus proprement, mais
 * elle demande un `CREATE EXTENSION` — donc les droits d'administration de la
 * base, et une migration de plus à ne pas oublier le jour d'une réinstallation.
 * `translate()` est présent partout, sans rien installer.
 *
 * Les majuscules accentuées figurent aussi dans la table alors que `lower()`
 * est appliqué avant : sur une base créée avec la locale « C », `lower('É')`
 * ne rend pas « é », et « Éléonore » cesserait de se trouver en tapant
 * « eleonore ». La table couvre le latin courant et le latin étendu A : les
 * noms polonais, tchèques ou roumains d'une cliente ne doivent pas échapper
 * à la base alors que le JavaScript, lui, les aplatit sans y penser.
 */
const ACCENTUEES_MINUSCULES =
  "àâäáãåçéèêëíìîïñóòôöõúùûüýÿšžčřěůňťďąęćńśźżőűășțşţğāēīōūėįų" +
  // Des lettres qui ne se décomposent pas : `aplatir` les garde telles
  // quelles, en minuscule. Elles ne figurent ici que pour leur MAJUSCULE,
  // que `lower()` laisse intacte en locale « C ».
  "øłđħŧŋþ";
const PLATES_MINUSCULES =
  "aaaaaaceeeeiiiinooooouuuuyyszcreuntdaecnszzouaststgaeioueiu" + "øłđħŧŋþ";

function tableDesAccents(): { accentuees: string; plates: string } {
  let accentuees = "";
  let plates = "";
  for (let i = 0; i < ACCENTUEES_MINUSCULES.length; i++) {
    const l = ACCENTUEES_MINUSCULES[i]!;
    const p = PLATES_MINUSCULES[i]!;
    accentuees += l;
    plates += p;
    // La majuscule, quand elle est une seule lettre distincte (« ÿ » → « Ÿ »).
    const majuscule = l.toUpperCase();
    if (majuscule.length === 1 && majuscule !== l && !accentuees.includes(majuscule)) {
      accentuees += majuscule;
      plates += p;
    }
  }
  return { accentuees, plates };
}

const TABLE = tableDesAccents();

/** Repris de l'ancienne recherche : la même table, désormais étendue. */
export const LETTRES_ACCENTUEES = TABLE.accentuees;
export const LETTRES_PLATES = TABLE.plates;

/**
 * Ce que `aplatir` change en espace et que la base doit changer aussi : les
 * blancs particuliers, les tirets, les apostrophes et toute la ponctuation
 * ASCII. Sans eux, « SAINT-VALERY » resterait collé côté base et « saint »
 * n'y commencerait plus un mot.
 *
 * Les trois signes que `aplatir` garde (@, % et €) n'y figurent pas.
 */
export const SEPARATEURS =
  "\t\n\r\u000b\u000c    ​  " +
  "-–—_/\\.,;:!?()[]{}«»\"“”+*#|~…&" +
  "’‘ʼ´`'" +
  "$^=<>" +
  "·•°×÷§¶†‡‰′″‹›‐‑‒―¡¿";

const DE = LETTRES_ACCENTUEES + SEPARATEURS;
const VERS = LETTRES_PLATES + " ".repeat(SEPARATEURS.length);

/**
 * L'expression aplatie, côté base : minuscules, ligatures dédoublées,
 * accents retirés, ponctuation changée en espaces.
 *
 * `translate()` EFFACE les caractères de la première liste qui n'ont pas de
 * correspondant dans la seconde : les deux chaînes ont donc exactement la
 * même longueur, et ce n'est pas un détail.
 */
export function plat(expression: SQL): SQL {
  return raw`translate(replace(replace(replace(replace(replace(replace(lower(coalesce(${expression}, '')), 'œ', 'oe'), 'Œ', 'oe'), 'æ', 'ae'), 'Æ', 'ae'), 'ß', 'ss'), 'ẞ', 'ss'), ${DE}, ${VERS})`;
}

/* -------------------------------------------------------------------------- */
/*  Les motifs                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Un mot de la saisie, prêt pour `like`.
 *
 * `%` et `_` ont un sens pour la base : cherchés tels quels, taper « 50% »
 * ramènerait le catalogue entier. Une affiche a parfaitement le droit de
 * s'appeler « Promo 50% », et la barre oblique inversée d'être tapée par
 * erreur — les trois sont donc échappées, et chaque `like` écrit
 * `escape '\'`.
 */
export function motif(jeton: string): string {
  return jeton.replace(/[\\%_]/g, (signe) => `\\${signe}`);
}

/** Repris de l'ancienne recherche : le motif « contient » d'une saisie entière. */
export function motifDe(saisie: string): string {
  return `%${motif(saisie)}%`;
}

/** Le texte aplati contient ce mot, n'importe où. */
function contient(texte: SQL, forme: string): SQL {
  return raw`${texte} like ${`%${motif(forme)}%`} escape '\\'`;
}

/**
 * Un mot du texte aplati COMMENCE par cette forme. L'espace ajoutée devant
 * fait du début du texte un début de mot comme les autres.
 */
function commenceUnMot(texte: SQL, forme: string): SQL {
  return raw`(' ' || ${texte}) like ${`% ${motif(forme)}%`} escape '\\'`;
}

/**
 * La condition d'un mot de la saisie sur un texte déjà aplati.
 *
 * Même règle que le JavaScript : un mot de deux caractères au plus ne cherche
 * qu'en début de mot — « co » ne doit pas remonter toutes les adresses en
 * « .com » —, sauf un nombre, qui peut se trouver au milieu (« 13 » trouve
 * WEB-0113). Les variantes (le singulier) et les corrections (les fautes de
 * frappe) ne valent qu'en début de mot côté JavaScript ; la base les cherche
 * de même.
 *
 * `textes` : plusieurs expressions déjà aplaties, reliées par OU.
 */
export function conditionJeton(textes: SQL[], jeton: JetonRequete): SQL {
  const morceaux: SQL[] = [];
  const auMilieu = jeton.mot.length >= 3 || /^\d+$/.test(jeton.mot);
  for (const texte of textes) {
    morceaux.push(auMilieu ? contient(texte, jeton.mot) : commenceUnMot(texte, jeton.mot));
    for (const forme of [...jeton.variantes, ...jeton.corrections])
      morceaux.push(commenceUnMot(texte, forme));
  }
  return raw`(${raw.join(morceaux, raw` or `)})`;
}

/** Tous les mots de la saisie, chacun présent quelque part (ET entre mots). */
export function conditionRequete(textes: SQL[], tous: readonly JetonRequete[]): SQL {
  if (!tous.length) return raw`false`;
  return raw`(${raw.join(
    tous.map((j) => conditionJeton(textes, j)),
    raw` and `,
  )})`;
}

/* -------------------------------------------------------------------------- */
/*  Téléphones et numéros                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Les chiffres d'un téléphone, côté base. Doit rester l'exact reflet de
 * `chiffresTelephone` : la base choisit les candidats, le JavaScript classe.
 */
export function chiffres(expression: SQL): SQL {
  return raw`regexp_replace(regexp_replace(btrim(coalesce(${expression}, '')), ${"^(\\+33|0033)"}, '0'), ${"\\D"}, '', 'g')`;
}

/** Un nombre de un à six chiffres, et rien d'autre. */
const NOMBRE = /^\d{1,6}$/;

/** « 0013 » → « 13 » ; « 0 » reste « 0 ». */
function sansZeros(chiffres: string): string {
  return chiffres.replace(/^0+(?=\d)/, "");
}

/**
 * Le motif du numéro de commande. « WEB-0013 », « web13 », « 0013 » et « 13 »
 * désignent tous WEB-0013 : la saisie compactée est lue comme un préfixe
 * facultatif et un nombre.
 *
 * L'expression régulière n'est bâtie QUE de chiffres validés et d'un préfixe
 * pris dans une liste fermée : rien de ce qui est tapé n'y entre tel quel.
 */
export function motifNumeroCommande(compacte: string): string | null {
  const m = /^(WEB|SAL)?0*(\d{1,6})$/.exec(compacte);
  if (!m || !m[2] || !NOMBRE.test(m[2])) return null;
  const prefixe = m[1] === "WEB" || m[1] === "SAL" ? m[1] : "(WEB|SAL)";
  return `^${prefixe}-0*${sansZeros(m[2])}$`;
}

/**
 * Les motifs du numéro de FACTURE (« F2026-0001 »). Une saisie de chiffres
 * seuls se lit aussi comme un numéro de facture sans année : « 1 » trouve la
 * première facture de chaque année.
 */
export function motifsFacture(compacte: string): string[] {
  const motifs = new Set<string>();
  const m = /^F?(\d{4})?0*(\d{1,6})$/.exec(compacte);
  if (m && m[2] && NOMBRE.test(m[2])) {
    const annee = m[1] && /^\d{4}$/.test(m[1]) ? m[1] : "\\d{4}";
    motifs.add(`^F${annee}-0*${sansZeros(m[2])}$`);
  }
  // « 12345 » : la lecture gloutonne y voit l'année 1234 et la facture 5 ;
  // la facture 12345 de n'importe quelle année est au moins aussi probable.
  if (NOMBRE.test(compacte)) motifs.add(`^F\\d{4}-0*${sansZeros(compacte)}$`);
  return [...motifs];
}

/** L'ancien numéro Shopify, tel qu'il est rangé : « #1042 ». */
export function ancienNumero(compacte: string): string | null {
  const m = /^#?(\d{3,6})$/.exec(compacte);
  return m && m[1] ? `#${m[1]}` : null;
}
