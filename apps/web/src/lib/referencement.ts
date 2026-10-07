/**
 * Ce que plusieurs morceaux du site doivent dire PAREIL aux moteurs de
 * recherche : la seule adresse d'un rayon, les langues où un contenu existe
 * vraiment, et la liste de ce qui mérite d'être indexé.
 *
 * Le plan du site, la fiche, le rayon et le middleware des anciennes adresses
 * en ont tous besoin. Écrit une fois ici, aucun ne peut contredire l'autre —
 * un plan du site qui listerait une adresse que la page elle-même renvoie
 * ailleurs serait pire que pas de plan du tout.
 */
import { api, type PlanDuSite } from "./api.ts";
import { LANGUES, type Langue } from "../i18n/utils.ts";

/** Les deux genres d'affiche. Toute autre valeur de `?genre=` est ignorée. */
export const GENRES = ["personnalisable", "prete_a_imprimer"] as const;
export type Genre = (typeof GENRES)[number];

export function estGenre(v: unknown): v is Genre {
  return typeof v === "string" && (GENRES as readonly string[]).includes(v);
}

/**
 * L'adresse d'un rayon, sans préfixe de langue.
 *
 * TOUJOURS dans cet ordre — genre, puis collection : c'est la forme que le
 * menu emploie (/affiches?genre=personnalisable&collection=villes), et pour
 * un moteur « ?collection=villes&genre=… » serait une autre adresse.
 */
export function adresseDuRayon(genre: string | null | undefined, collection?: string): string {
  const p = new URLSearchParams();
  if (genre) p.set("genre", genre);
  if (collection) p.set("collection", collection);
  const requete = p.toString();
  return "/affiches" + (requete ? `?${requete}` : "");
}

/**
 * Les langues où un contenu est vraiment écrit, telles que l'API les donne.
 *
 * Absentes (une API d'avant ce champ, une page qui n'a que des libellés
 * d'interface) : toutes les langues du site, ce qui était le comportement
 * d'avant. Le français y est toujours : c'est la langue de référence.
 */
export function languesDuContenu(liste?: readonly string[] | null): Langue[] {
  if (!liste) return [...LANGUES];
  return LANGUES.filter((l) => l === "fr" || liste.includes(l));
}

/**
 * Le plan du site, gardé cinq minutes.
 *
 * Le plan du site le lit à chaque visite d'un robot, et le middleware des
 * anciennes adresses à chaque vieux lien Shopify : sans ce cache, chacun
 * paierait une lecture complète du catalogue. Cinq minutes suffisent à voir
 * arriver une affiche qu'on vient de publier.
 *
 * API muette : on garde le plan qu'on avait, même vieux, plutôt que de faire
 * tomber le plan du site ou les redirections. Sans plan du tout, l'erreur
 * remonte et c'est à l'appelant de décider (503 pour le plan du site, règle
 * fixe pour une redirection).
 */
const CACHE_MS = 5 * 60 * 1000;
let cache: { a: number; plan: PlanDuSite } | null = null;
let enCours: Promise<PlanDuSite> | null = null;

export async function planDuSite(): Promise<PlanDuSite> {
  if (cache && Date.now() - cache.a < CACHE_MS) return cache.plan;
  // Une seule lecture à la fois : vingt robots qui arrivent ensemble ne
  // déclenchent pas vingt lectures du catalogue.
  enCours ??= api
    .planDuSite()
    .then((plan) => {
      cache = { a: Date.now(), plan };
      return plan;
    })
    .finally(() => {
      enCours = null;
    });
  try {
    return await enCours;
  } catch (e) {
    if (cache) return cache.plan;
    throw e;
  }
}
