/**
 * Quand une saisie est assez longue pour lancer la recherche du site.
 *
 * Deux caractères, partout — la règle du back-office : en dessous, tout
 * correspond, et une lettre ramènerait le catalogue entier sous le titre
 * « résultats ».
 *
 * Exception en japonais et en chinois (28/11, Alexandra : « finis le à faire
 * sauf la partie personnages » ; À FAIRE : « Japonais et chinois : la
 * recherche dans ces langues ») : un idéogramme seul est déjà un mot entier
 * des noms d'affiches — « 港 » (port), « 城 » (château), « 塔 » (tour),
 * « 凧 » (cerf-volant). Un kana seul ou une lettre latine seule restent trop
 * courts. Le script de la page de recherche (recherche.astro) applique la
 * même règle, recopiée.
 */
export const MINIMUM_RECHERCHE = 2;

/**
 * Un idéogramme chinois ou japonais du plan de base (extension A, bloc
 * principal, compatibilité). Ceux des plans supplémentaires comptent déjà
 * pour deux en JavaScript, et passent la règle des deux caractères.
 */
const IDEOGRAMME = /^[㐀-䶿一-鿿豈-﫿]$/;

/** Le japonais et le chinois s'écrivent en idéogrammes. */
export function langueAIdeogrammes(langue: string): boolean {
  return langue === "ja" || langue === "zh";
}

export function assezLongPourChercher(saisie: string, langue: string): boolean {
  const s = saisie.trim();
  if (s.length >= MINIMUM_RECHERCHE) return true;
  return langueAIdeogrammes(langue) && IDEOGRAMME.test(s);
}
