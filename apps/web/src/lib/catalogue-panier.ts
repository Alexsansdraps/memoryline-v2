/// <reference lib="dom" />
/**
 * Ce que le panier ET la caisse ont besoin de savoir d'un produit, au-delà de
 * sa ligne : le genre de l'affiche et le visuel de la boutique.
 *
 * Il vivait dans le panier seul. La caisse, qui montre les mêmes lignes juste
 * avant le paiement, n'en savait rien : une affiche prête à imprimer y passait
 * par l'aperçu en calques, qui n'avait rien à empiler — une vignette blanche.
 */
import { urlAsset, type PosterConfig } from "@memoryline/types";
import { PUBLIC_API_URL } from "./api.ts";

export interface FicheLigne {
  slug: string | null;
  /** Le visuel de la boutique, seul aperçu possible d'une affiche non composée. */
  image: string | null;
  /** « personnalisable » ou « prete_a_imprimer ». */
  kind: string | null;
}

/** Une ligne de panier, réduite à ce que ces fonctions en lisent. */
interface LigneVue {
  productId: number | null;
  config: PosterConfig;
}

/**
 * Le catalogue, lu UNE fois par chargement de page.
 *
 * Chaque ligne du panier avait sa propre requête : cinq articles, cinq fois
 * cinq cents produits téléchargés. La promesse est mémorisée, pas son
 * résultat : deux lignes demandées en même temps partagent le même appel.
 */
let catalogueEnCours: Promise<Map<number, FicheLigne>> | null = null;
export function catalogue(): Promise<Map<number, FicheLigne>> {
  if (!catalogueEnCours)
    catalogueEnCours = (async () => {
      const par = new Map<number, FicheLigne>();
      try {
        const res = await fetch(`${PUBLIC_API_URL}/products?limit=1000`);
        if (!res.ok) return par;
        const list = (await res.json()) as {
          id: number;
          slug: string;
          image: string | null;
          kind: string | null;
        }[];
        for (const p of list)
          par.set(p.id, {
            slug: p.slug,
            image: p.image ?? null,
            kind: p.kind ?? null,
          });
      } catch {
        /* catalogue injoignable : on retombe sur l'aperçu en calques */
      }
      return par;
    })();
  return catalogueEnCours;
}

/**
 * Vrai pour une affiche vendue telle quelle.
 *
 * Le genre du produit fait foi. À défaut — catalogue injoignable, produit
 * disparu — on retombe sur ce que la ligne montre d'elle-même : ni fond ni
 * personnage, donc rien à composer.
 */
export function estPretAImprimer(
  fiches: Map<number, FicheLigne> | undefined,
  it: LigneVue,
): boolean {
  const genre = it.productId != null ? fiches?.get(it.productId)?.kind : null;
  if (genre) return genre === "prete_a_imprimer";
  return !it.config.backgroundUrl && (it.config.characters?.length ?? 0) === 0;
}

/**
 * L'image à montrer quand la ligne n'a rien de composé.
 *
 * Une affiche prête à imprimer arrive au panier sans fond ni personnage :
 * l'aperçu en calques n'aurait rien à empiler. On lui rend son visuel de
 * boutique. Une affiche composée, elle, garde sa pile, même si le catalogue
 * n'est pas joignable.
 */
export function visuelBoutique(
  fiches: Map<number, FicheLigne> | undefined,
  it: LigneVue,
): string | undefined {
  if (!estPretAImprimer(fiches, it) || it.productId == null) return undefined;
  const image = fiches?.get(it.productId)?.image;
  // Le chemin stocké est relatif à l'API : c'est elle qui sert les visuels.
  return image ? urlAsset(PUBLIC_API_URL, image) : undefined;
}
