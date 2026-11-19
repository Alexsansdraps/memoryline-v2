/**
 * La tablette d'un stand n'affiche que la page de son stand (18/11).
 *
 * Alexandra : « quand je vais ici https://memoryline.fr/?stand=1 je dois
 * avoir que la page /mulhouse. Il faut qu'un stand ait une page attribuée et
 * une seule ! » — et cela pour chaque stand. La page se choisit dans BO ›
 * Ventes stand (`stand.page_id`).
 *
 * Le mode stand vit dans l'adresse (`?stand=…`, middleware du site) : sa
 * valeur est le NUMÉRO du stand. L'ancienne adresse de la tablette portait
 * `?stand=1`, et le stand n° 1 est justement celui du marché de Noël de
 * Mulhouse : rien à refaire sur les tablettes déjà réglées. Le numéro n'ouvre
 * aucun droit (le mode stand ne fait que cacher des montants) ; c'est le code,
 * gardé dans la tablette, qui permet de valider une vente.
 *
 * Partagé entre le site (middleware) et l'API (tests), sans dépendance.
 */

/**
 * La valeur de `?stand=` à recopier dans les liens de la tablette : chiffres,
 * lettres et tirets, 20 au plus. Toute autre chose vaut « 1 », l'ancienne
 * valeur : le mode stand reste, sans désigner d'autre stand que le premier.
 */
export function valeurDuStand(brut: string | null | undefined): string {
  const v = String(brut ?? "").trim();
  return /^[A-Za-z0-9-]{1,20}$/.test(v) ? v : "1";
}

/** Le numéro du stand que désigne `?stand=`, ou null (« oui », « apercu »…). */
export function numeroDuStand(brut: string | null | undefined): number | null {
  const v = String(brut ?? "").trim();
  if (!/^[1-9][0-9]{0,8}$/.test(v)) return null;
  return Number(v);
}

/**
 * La page de la tablette : son adresse, et les affiches qu'elle montre.
 */
export interface PageDeLaTablette {
  /** L'adresse de la page (« mulhouse » pour /pages/mulhouse). */
  slug: string;
  /** Les adresses des affiches que la page montre. */
  affiches: readonly string[];
}

/**
 * L'adresse mène-t-elle à la page du stand plutôt qu'à elle-même ?
 *
 * 19/11, Margaux (par Alexandra) : « sur tous les stands ils doivent voir
 * toutes les pages du site du menu ». La tablette n'est plus enfermée dans la
 * page de son stand : le menu, la recherche, le catalogue, les autres pages
 * restent ouverts, toujours sans prix. Seul l'ACCUEIL (« / ») mène à la page
 * du stand : c'est là que la tablette arrive en ouvrant son lien, et là que
 * ramène le logo.
 */
export function cheminRameneALaPageDuStand(chemin: string): boolean {
  const propre = (chemin.split(/[?#]/)[0] ?? "").replace(/\/+$/, "") || "/";
  return propre === "/";
}
