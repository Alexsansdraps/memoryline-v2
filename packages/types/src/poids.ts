/**
 * Poids des articles — partagé entre la boutique, l'API et le back-office.
 *
 * Le poids décide de la tranche d'affranchissement, donc de ce que la cliente
 * paie à La Poste. Il ne peut pas être calculé d'un côté pour l'affichage et
 * de l'autre pour la facturation : les deux se sépareraient un jour, et
 * l'écart se paierait en frais de port perdus.
 *
 * Trois niveaux, du plus précis au plus général :
 *   1. la VARIANTE   — un A3 pèse plus qu'un A4 ;
 *   2. le PRODUIT    — quand toutes ses variantes pèsent pareil ;
 *   3. la COLLECTION — « une affiche pèse 60 g », dit une fois pour toutes.
 *
 * On ne recopie jamais la valeur d'un niveau à l'autre : corriger le poids
 * d'une collection doit corriger d'un coup tout ce qui n'a pas été réglé à la
 * main. Un niveau vaut donc « non renseigné », pas « zéro ».
 *
 * Un produit peut appartenir à PLUSIEURS collections, qui n'annoncent pas
 * forcément le même poids. Le choix entre elles ne se fait pas ici : c'est à
 * l'appelant, qui sait lesquelles, de retenir LA PLUS LOURDE de celles qui en
 * déclarent une. Un colis sous-affranchi coûte plus cher qu'un colis surestimé,
 * et c'est l'erreur qu'on ne voit pas passer : le second se paie en centimes
 * d'avance, le premier revient en surtaxe, en retard, ou en colis refusé.
 */
import { separateurDecimal } from "./formats.js";

/** Un entier de grammes, ou rien. Les valeurs absurdes sont écartées. */
function grammes(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export interface SourcePoids {
  /** Poids porté par la variante choisie (format A4, A3…). */
  varianteGrammes?: number | null;
  /** Poids porté par le produit. */
  produitGrammes?: number | null;
  /**
   * Poids par défaut retenu parmi les collections du produit : la plus lourde
   * de celles qui en déclarent un. L'appelant l'a déjà tranché.
   */
  collectionGrammes?: number | null;
  /** Poids du cadre, quand il est vendu avec l'affiche. */
  cadreGrammes?: number | null;
}

/**
 * Poids d'UN exemplaire, cadre compris.
 *
 * Le cadre s'ajoute au lieu de remplacer : c'est un objet en plus dans le
 * colis. Un cadre bois suffit à faire changer de tranche à lui seul.
 */
export function poidsArticle(source: SourcePoids): number {
  const base =
    grammes(source.varianteGrammes) ??
    grammes(source.produitGrammes) ??
    grammes(source.collectionGrammes) ??
    0;
  return base + (grammes(source.cadreGrammes) ?? 0);
}

export interface LignePesee extends SourcePoids {
  quantite: number;
}

/** Poids total d'un panier ou d'une commande, en grammes. */
export function poidsPanier(lignes: readonly LignePesee[]): number {
  return lignes.reduce(
    (total, l) => total + poidsArticle(l) * Math.max(0, Math.round(l.quantite)),
    0,
  );
}

/**
 * « 1,25 kg » ou « 340 g » (« 1.25 kg » en anglais) — pour l'affichage,
 * jamais pour le calcul.
 */
export function formaterPoids(grammes: number, locale = "fr-FR"): string {
  if (grammes >= 1000)
    return `${(grammes / 1000)
      .toFixed(grammes % 1000 === 0 ? 0 : 2)
      .replace(".", separateurDecimal(locale))} kg`;
  return `${Math.round(grammes)} g`;
}
