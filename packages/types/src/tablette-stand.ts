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

/** Ce que la tablette a le droit d'ouvrir : sa page, et les affiches de sa page. */
export interface PageDeLaTablette {
  /** L'adresse de la page (« mulhouse » pour /pages/mulhouse). */
  slug: string;
  /** Les adresses des affiches que la page montre. */
  affiches: readonly string[];
}

/**
 * Les adresses qui servent à VENDRE depuis la page, en plus d'elle et de ses
 * affiches : le panier de la tablette (sa dernière étape), la caisse (qui y
 * ramène au stand) et la page d'erreur.
 */
const ADRESSES_DE_LA_VENTE = ["/panier", "/commande", "/404"];

/** Un morceau d'adresse lisible : décodé, en minuscules ; null s'il ne se décode pas. */
function segment(brut: string): string | null {
  try {
    return decodeURIComponent(brut).trim().toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Une adresse du site (sans préfixe de langue ni requête) reste-t-elle
 * ouverte sur une tablette qui n'affiche que sa page ?
 *
 * Oui pour la page elle-même, la fiche d'une affiche de la page (le module
 * de personnalisation y vit), le panier et la caisse. Non pour tout le reste
 * — l'accueil, le catalogue, les rayons, la recherche, les autres pages, le
 * compte, la carte cadeau : le middleware y ramène vers la page.
 */
export function cheminPermisALaTablette(chemin: string, page: PageDeLaTablette): boolean {
  const propre = (chemin.split(/[?#]/)[0] ?? "").replace(/\/+$/, "") || "/";
  if (ADRESSES_DE_LA_VENTE.includes(propre.toLowerCase())) return true;
  const morceaux = propre.split("/").filter(Boolean);
  if (morceaux.length !== 2) return false;
  const [rubrique, brut] = morceaux as [string, string];
  const nom = segment(brut);
  if (!nom) return false;
  if (rubrique === "pages") return nom === page.slug.toLowerCase();
  if (rubrique === "affiches") return page.affiches.some((a) => a.toLowerCase() === nom);
  return false;
}
