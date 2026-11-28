/// <reference lib="dom" />
/**
 * Les emojis d'une ligne de texte tels que le PAPIER les traite, à l'écran.
 *
 * Chantier du 28/11 (Alexandra : « finis le à faire »), deux défauts de la
 * recette du 16-17/11 (A-FAIRE § 2) :
 *
 * 1. « Les emojis plus récents que Twemoji 15.0 disparaissent du papier sans
 *    avertissement. » Le fichier d'impression pose chaque emoji en IMAGE, tirée
 *    du jeu Twemoji de l'API (apps/api/src/pdf.ts, imageEmoji / emojiDuJeu) ; un
 *    emoji que le jeu ne connaît pas est sauté, sans un mot, alors que l'écran
 *    de la cliente le dessine très bien. {@link emojisNonImprimes} applique la
 *    MÊME règle : les emojis de la ligne découpés comme à l'impression
 *    (segmentsDeLigne), cherchés sous les mêmes noms (codesAEssayer) dans la
 *    même liste d'images (emojis-twemoji.ts, tirée du paquet de l'API). Rien
 *    n'est modifié : ni le texte enregistré, ni l'impression ; l'écran prévient.
 *
 * 2. « ♥ ☀ ❄ sont en noir à l'écran, en couleur sur le papier. » Ces symboles
 *    anciens s'écrivent en TEXTE par défaut (Unicode : « Emoji_Presentation »
 *    non) : le navigateur les dessine d'une seule couleur, celle du texte. Le
 *    papier, lui, les traite en emojis (estEmoji : tout pictogramme à partir de
 *    U+2600) et pose leur image en couleur. {@link enFormeEmoji} ajoute, POUR
 *    L'ÉCRAN SEULEMENT, le sélecteur qui demande la forme emoji (VS16, U+FE0F) :
 *    le navigateur prend alors sa police emoji, en couleur, comme pour 🎄, et à
 *    la même largeur que celle que le papier compte (AVANCE_EMOJI). Les 176
 *    symboles concernés ont tous leur image dans le jeu de l'API (vérifié le
 *    28/11 : travaux/finir-a-faire/configurateur).
 *
 * Le découpage en grappes (@memoryline/types/emojis) crée un `Intl.Segmenter`
 * dès son chargement, que les navigateurs anciens n'ont pas : il n'est chargé
 * qu'à la demande, avec la liste des images, quand une ligne contient un
 * pictogramme. S'il manque, l'écran se tait, comme avant : jamais d'erreur.
 */

/** Un pictogramme, un drapeau ou une touche : le premier tri de contientEmoji. */
const PEUT_ETRE_EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}⃣]/u;

/** La ligne mérite-t-elle qu'on charge la règle ? (Le cas rare : on teste vite.) */
export function peutContenirEmoji(texte: string): boolean {
  return PEUT_ETRE_EMOJI.test(texte);
}

/** Les emojis d'un texte que l'impression ne posera pas, sans doublon, dans l'ordre. */
export type RegleEmojis = (texte: string) => string[];

let regle: Promise<RegleEmojis | null> | undefined;

/**
 * La règle de l'impression, chargée une fois pour toutes (deux petits
 * modules à part, environ 60 Ko). `null` si elle n'a pas pu se charger.
 */
export function regleDesEmojis(): Promise<RegleEmojis | null> {
  regle ??= Promise.all([import("@memoryline/types/emojis"), import("./emojis-twemoji")])
    .then(([emojis, jeu]): RegleEmojis => {
      const noms = new Set(jeu.CODES_TWEMOJI.split(/\s+/).filter(Boolean));
      return (texte) => {
        const absents: string[] = [];
        for (const s of emojis.segmentsDeLigne(texte)) {
          if (s.type !== "emoji" || absents.includes(s.emoji)) continue;
          // pdf.ts, emojiDuJeu : un des noms à essayer suffit.
          if (!emojis.codesAEssayer(s.emoji).some((c) => noms.has(c))) absents.push(s.emoji);
        }
        return absents;
      };
    })
    .catch(() => null);
  return regle;
}

/** Les symboles qu'Unicode écrit en texte par défaut et que le papier pose en emoji. */
const PICTOGRAMME = /\p{Extended_Pictographic}/u;
const A_UNE_FORME_EMOJI = /\p{Emoji}/u;
const EN_COULEUR_PAR_DEFAUT = /\p{Emoji_Presentation}/u;
/**
 * Ce qui, juste après le symbole, en fait déjà autre chose : une forme
 * demandée (VS15 texte, VS16 emoji), une liaison (famille, métier…), une
 * touche, une teinte de peau. Dans ces cas, on n'ajoute rien.
 */
const DEJA_PRECISE = /[︎️‍⃣\u{1F3FB}-\u{1F3FF}]/u;
const LIAISON = "‍";
const FORME_EMOJI = "️";

/**
 * Le texte tel que l'écran doit le dessiner : chaque symbole écrit en texte
 * par défaut (♥ ☀ ❄ ❤ ✈ ☺…), seul — ni forme demandée, ni liaison, ni teinte —,
 * reçoit la forme emoji (VS16). Exactement les symboles qu'estEmoji (paquet
 * types) range parmi les emojis par sa dernière règle (à partir de U+2600),
 * ceux qui ont une forme emoji. Rien d'autre ne change : un texte sans eux
 * revient tel quel, à la lettre près.
 */
export function enFormeEmoji(texte: string): string {
  if (!PICTOGRAMME.test(texte)) return texte;
  const signes = Array.from(texte);
  let sortie = "";
  let change = false;
  for (let i = 0; i < signes.length; i++) {
    const signe = signes[i]!;
    sortie += signe;
    if ((signe.codePointAt(0) ?? 0) < 0x2600) continue;
    if (!PICTOGRAMME.test(signe) || !A_UNE_FORME_EMOJI.test(signe) || EN_COULEUR_PAR_DEFAUT.test(signe))
      continue;
    const suivant = signes[i + 1];
    if (signes[i - 1] === LIAISON || (suivant !== undefined && DEJA_PRECISE.test(suivant))) continue;
    sortie += FORME_EMOJI;
    change = true;
  }
  return change ? sortie : texte;
}
