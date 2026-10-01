/**
 * Les lignes de texte d'une affiche.
 *
 * L'affiche portait un TITRE et un SOUS-TITRE ; elle porte désormais TROIS
 * LIGNES, sans hiérarchie imposée — « MERS-LES-BAINS », « la maison bleue »,
 * « été 2019 » se composent mieux ainsi qu'en titre et sous-titre.
 *
 * Les commandes déjà passées, elles, portent toujours un titre et un
 * sous-titre. On ne les réécrit pas : `lignesDuTexte()` sait lire les deux
 * formes et rend toujours trois lignes. C'est cette fonction, et elle seule,
 * qui doit servir à afficher ou à imprimer un texte d'affiche — sinon une
 * commande de l'an dernier sortirait vide de l'imprimante.
 */
import type { TextBlock } from "./config.js";

/** Nombre de lignes proposées au client. */
export const NB_LIGNES_AFFICHE = 3;

/** Ce que la configuration d'une affiche peut contenir comme textes. */
export interface TextesAffiche {
  /** Forme actuelle : une entrée par ligne, dans l'ordre. */
  lines?: (TextBlock | undefined)[];
  /** Forme ancienne, conservée en lecture pour les commandes déjà passées. */
  title?: TextBlock;
  subtitle?: TextBlock;
}

/**
 * Les trois lignes d'une affiche, quelle que soit la forme enregistrée.
 *
 * Renvoie toujours un tableau de trois entrées ; une ligne non remplie vaut
 * `undefined` plutôt qu'un bloc vide, pour que l'appelant puisse simplement
 * l'ignorer au rendu.
 */
export function lignesDuTexte(
  textes: TextesAffiche | null | undefined,
): (TextBlock | undefined)[] {
  const t = textes ?? {};
  const source =
    t.lines && t.lines.length ? t.lines : [t.title, t.subtitle, undefined];
  const out: (TextBlock | undefined)[] = [];
  for (let i = 0; i < NB_LIGNES_AFFICHE; i++) {
    const bloc = source[i];
    out.push(bloc && String(bloc.value ?? "").trim() ? bloc : undefined);
  }
  return out;
}

/**
 * Une ligne peut être coupée à la main (touche Entrée) : « SAINT-VALERY- » /
 * « SUR-SOMME » se lit mieux qu'un nom rapetissé pour tenir en largeur. Trois
 * morceaux au plus par ligne : au-delà, le bloc de texte descendrait dans le
 * dessin.
 */
export const MORCEAUX_PAR_LIGNE = 3;

/**
 * Les morceaux d'une ligne, dans l'ordre, sans les morceaux vides : un retour
 * à la ligne tapé en trop, au début ou à la fin, ne laisse pas de trou.
 * C'est elle que lisent l'aperçu et le PDF, pour couper au même endroit.
 */
export function sousLignes(valeur: string | null | undefined): string[] {
  return String(valeur ?? "")
    .split(/\r?\n/)
    .map((m) => m.trim())
    .filter(Boolean);
}

/**
 * Une saisie ramenée à `MORCEAUX_PAR_LIGNE` morceaux : les retours à la ligne
 * en trop deviennent des espaces, sans perdre un seul mot.
 */
export function limiterRetours(valeur: string): string {
  const morceaux = valeur.split(/\r?\n/);
  if (morceaux.length <= MORCEAUX_PAR_LIGNE) return valeur;
  return [
    ...morceaux.slice(0, MORCEAUX_PAR_LIGNE - 1),
    morceaux.slice(MORCEAUX_PAR_LIGNE - 1).join(" "),
  ].join("\n");
}

/** Les lignes réellement remplies, dans l'ordre — pratique pour le rendu. */
export function lignesRemplies(
  textes: TextesAffiche | null | undefined,
): TextBlock[] {
  return lignesDuTexte(textes).filter((b): b is TextBlock => b !== undefined);
}

/**
 * Le style d'une affiche : police, couleur et taille.
 *
 * Il se lit sur la première ligne renseignée. Le client règle ces trois
 * réglages une fois pour l'affiche entière : les proposer par ligne
 * multiplierait les combinaisons ratées sans rendre personne plus heureux.
 */
export function styleDesLignes(
  textes: TextesAffiche | null | undefined,
): TextBlock | undefined {
  return lignesRemplies(textes)[0];
}

/** Écrit les trois lignes dans la forme actuelle. */
export function textesDepuisLignes(
  lignes: (TextBlock | undefined)[],
): TextesAffiche {
  return {
    lines: Array.from({ length: NB_LIGNES_AFFICHE }, (_, i) => lignes[i]),
  };
}
