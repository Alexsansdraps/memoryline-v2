/// <reference lib="dom" />
/**
 * Ce que le panier ET la caisse ont besoin de savoir d'un produit, au-delà de
 * sa ligne : le genre de l'affiche et le visuel de la boutique — et, pour le
 * panier, son nom dans la langue de la page.
 *
 * Il vivait dans le panier seul. La caisse, qui montre les mêmes lignes juste
 * avant le paiement, n'en savait rien : une affiche prête à imprimer y passait
 * par l'aperçu en calques, qui n'avait rien à empiler — une vignette blanche.
 */
import { urlAsset, type PosterConfig } from "@memoryline/types";
import { PUBLIC_API_URL } from "./api.ts";
import { estLangue, LANGUE_DEFAUT } from "../i18n/utils.ts";

export interface FicheLigne {
  slug: string | null;
  /** Le visuel de la boutique, seul aperçu possible d'une affiche non composée. */
  image: string | null;
  /** « personnalisable » ou « prete_a_imprimer ». */
  kind: string | null;
  /**
   * Le nom de l'affiche dans la langue demandée (le français quand la
   * boutique ne l'a pas traduit). Voir nomDeLaLigne.
   */
  name: string | null;
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
 *
 * `langue` : celle des noms (?lang=, que l'API sait servir). Une promesse par
 * langue — une page n'en demande jamais qu'une, mais celle qui n'en dit rien
 * (la caisse) ne doit pas recevoir les noms d'une autre. Le paramètre est
 * `unknown` parce que la caisse passe cette fonction telle quelle à
 * createResource, qui l'appelle avec `true` : seule une langue du site
 * compte, le français sinon.
 */
const cataloguesEnCours = new Map<string, Promise<Map<number, FicheLigne>>>();
export function catalogue(demandee?: unknown): Promise<Map<number, FicheLigne>> {
  const langue = estLangue(demandee) ? demandee : LANGUE_DEFAUT;
  let enCours = cataloguesEnCours.get(langue);
  if (!enCours) {
    enCours = (async () => {
      const par = new Map<number, FicheLigne>();
      try {
        const res = await fetch(
          `${PUBLIC_API_URL}/products?limit=1000${langue !== LANGUE_DEFAUT ? `&lang=${langue}` : ""}`,
        );
        if (!res.ok) return par;
        const list = (await res.json()) as {
          id: number;
          slug: string;
          image: string | null;
          kind: string | null;
          name: string | null;
        }[];
        for (const p of list)
          par.set(p.id, {
            slug: p.slug,
            image: p.image ?? null,
            kind: p.kind ?? null,
            name: p.name ?? null,
          });
      } catch {
        /* catalogue injoignable : on retombe sur l'aperçu en calques */
      }
      return par;
    })();
    cataloguesEnCours.set(langue, enCours);
  }
  return enCours;
}

/**
 * Le nom d'une ligne, dans la langue de la page.
 *
 * La ligne garde le nom de l'affiche tel qu'il était au moment de l'ajout,
 * dans la langue de la fiche d'alors : remplie depuis la page anglaise, elle
 * restait « SAINT-VALERY-SUR-SOMME Church » sur le panier français, et une
 * affiche ajoutée en français gardait son nom français sur le panier
 * allemand. Le catalogue, lu dans la langue de la page, a le bon ; le nom
 * enregistré ne sert plus que de repli (affiche retirée de la vente,
 * catalogue injoignable).
 *
 * Le nom du catalogue est le nom complet du back-office : on lui retire,
 * comme la fiche et les vignettes ([slug].astro, VignetteAffiche.astro), la
 * fin « – Affiche personnalisée » que la ligne n'a jamais portée.
 */
export function nomDeLaLigne(
  fiches: Map<number, FicheLigne> | undefined,
  it: { productId: number | null; title?: string | null },
): string | null {
  const nom = (it.productId != null ? fiches?.get(it.productId)?.name : null)
    ?.replace(/\s*[-–]\s*Affiche.*$/i, "")
    .trim();
  return nom || (it.title ?? null);
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
