/**
 * La recherche de la boutique en japonais et en chinois (28/11).
 *
 * Alexandra, le 28/11 : « finis le à faire sauf la partie personnages » ; dans
 * le fichier À FAIRE, « Japonais et chinois, encore à faire : la recherche
 * dans ces langues ». Les 257 fiches ont un nom japonais et chinois depuis la
 * migration 0099, et la route `/products?q=` cherchait déjà le nom traduit
 * (index.ts, `contientTraduction`). Trois choses l'empêchaient de marcher :
 *
 *   1. Les kana voisés. La saisie était décomposée (NFD) pour lui retirer ses
 *      accents, et NFD coupe aussi « ビ » en « ヒ » + « ゙ », un signe que le
 *      retrait des accents latins ne touche pas : « ビーチ » ne ressemblait
 *      plus à rien de ce que la base garde. 81 noms japonais sur 255 en
 *      contiennent (ガ, パ, ド, ブ…). index.ts recompose désormais (NFC).
 *   2. Les caractères « pleine chasse » d'un clavier japonais ou chinois
 *      (« ＰＡＲＩＳ », « ＃２ ») : ramenés à leur forme simple (NFKC), des deux
 *      côtés.
 *   3. Hiragana et katakana : « びーち » tapé sans conversion trouve « ビーチ ».
 *      Les deux côtés passent en hiragana.
 *
 * Seuls le japonais et le chinois passent par ici : le français et les quatre
 * autres langues gardent exactement la recherche d'avant.
 */

/** Les deux langues écrites en idéogrammes et en kana. */
export function ecritureAsiatique(langue: string): langue is "ja" | "zh" {
  return langue === "ja" || langue === "zh";
}

function suite(debut: number, fin: number): string {
  return String.fromCodePoint(
    ...Array.from({ length: fin - debut + 1 }, (_, i) => debut + i),
  );
}

/**
 * Les katakana ァ…ヶ (U+30A1–U+30F6) et leurs hiragana ぁ…ゖ (U+3041–U+3096),
 * dans le même ordre : 86 de chaque côté, l'écart est toujours de 0x60. C'est
 * la table que `translate()` reçoit côté base.
 */
export const KATAKANA = suite(0x30a1, 0x30f6);
export const HIRAGANA = suite(0x3041, 0x3096);

/** « ビーチ » → « びーち ». Le reste du texte ne bouge pas. */
export function replierKana(texte: string): string {
  return texte.replace(/[ァ-ヶ]/gu, (k) =>
    String.fromCodePoint(k.codePointAt(0)! - 0x60),
  );
}

/**
 * La saisie d'une visiteuse japonaise ou chinoise, prête à comparer : forme
 * simple (NFKC : « ＰＡＲＩＳ » → « PARIS », « ﾋﾞｰﾁ » → « ビーチ »), accents
 * latins retirés comme partout ailleurs, minuscules, hiragana.
 *
 * L'ordre compte : NFKC d'abord (il recompose), puis les accents latins (NFD,
 * retrait, et NFC pour recoller les kana voisés), puis les kana.
 */
export function aplatirSaisieAsiatique(saisie: string): string {
  return replierKana(
    saisie
      .normalize("NFKC")
      .normalize("NFD")
      .replace(/[̀-ͯ]/gu, "")
      .normalize("NFC")
      .toLowerCase(),
  );
}
