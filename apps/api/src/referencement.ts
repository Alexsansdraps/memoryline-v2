/**
 * Ce que le référencement doit savoir du catalogue, et que le site ne peut pas
 * deviner seul.
 *
 * DANS QUELLES LANGUES UN CONTENU EXISTE VRAIMENT.
 *
 * Partout ailleurs, le français est la référence ET le repli (traductions.ts) :
 * une fiche non traduite s'affiche en français sous /en, et c'est très bien pour
 * la visiteuse, qui voit au moins l'affiche. Mais le site, lui, ne savait pas
 * qu'il servait du français : il déclarait chaque fiche à Google en cinq
 * langues, hreflang et plan du site compris. Cela faisait sept cents pages
 * « anglaises », « allemandes »… écrites en français — des doublons, annoncés
 * comme des traductions.
 *
 * Les fonctions ci-dessous disent, pour une fiche, un rayon ou une page, la
 * liste des langues où son contenu est RÉELLEMENT écrit. Le français y est
 * toujours ; une autre langue n'y entre que lorsque tout ce qui se lit sur la
 * page a sa traduction. Une moitié de traduction (le nom, mais pas le texte)
 * ne compte pas : la page serait à moitié en français, et c'est précisément ce
 * qu'on ne veut plus présenter comme une traduction.
 *
 * LE GENRE D'UN RAYON.
 *
 * Le menu mène à « Villes » par /affiches?genre=personnalisable&collection=villes,
 * alors que l'ancienne adresse Shopify et le rayon nu y menaient par
 * /affiches?collection=villes : deux adresses, une seule grille. Le site ne
 * garde que la forme du menu, et pour l'écrire il doit savoir à quel genre
 * appartient une collection — ce que seules ses affiches disent.
 */
import type { BlocPage } from "./db/schema.js";
import { LANGUES_ETRANGERES } from "./traductions.js";

/** Le dictionnaire de traductions d'une ligne : langue → champ → valeur. */
type Traductions = Partial<Record<string, Partial<Record<string, unknown>>>> | null | undefined;

/**
 * Le texte qu'on lit vraiment, balises et espaces insécables retirés.
 *
 * Cinquante-huit descriptions importées de Shopify valent « <p><img></p> » :
 * du HTML, mais pas un mot. Une telle description compte pour vide — sinon la
 * fiche ne serait jamais « traduite », faute de pouvoir traduire un texte
 * qui n'existe pas.
 */
function texteLu(v: unknown): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .trim();
}

function ecrit(v: unknown): boolean {
  return texteLu(v) !== "";
}

/**
 * Les langues d'un contenu fait d'un nom et d'une description (fiche, rayon).
 *
 * Une langue étrangère y entre quand son nom est traduit ET sa description —
 * sauf si la description française est vide : il n'y a alors rien d'autre à
 * traduire que le nom.
 */
function languesNomDescription(
  descriptionFrancaise: string | null | undefined,
  traductions: Traductions,
  champNom: string,
): string[] {
  const aDecrire = ecrit(descriptionFrancaise);
  return [
    "fr",
    ...LANGUES_ETRANGERES.filter((l) => {
      const t = traductions?.[l];
      return ecrit(t?.[champNom]) && (!aDecrire || ecrit(t?.description));
    }),
  ];
}

/** Les langues où une fiche affiche est vraiment écrite (le français toujours). */
export function languesDuProduit(p: {
  description: string | null;
  translations: Traductions;
}): string[] {
  return languesNomDescription(p.description, p.translations, "name");
}

/** Les langues où un rayon (une collection) est vraiment écrit. */
export function languesDeLaCollection(c: {
  description: string | null;
  translations: Traductions;
}): string[] {
  return languesNomDescription(c.description, c.translations, "name");
}

/**
 * Les langues où une page libre est vraiment écrite.
 *
 * Le titre, et chaque bloc qui porte du texte : intertitre, paragraphe,
 * bouton, légende d'image. La forme vient du français (cms.ts, fusionnerBlocs) :
 * un bloc traduit compte s'il est à la même place et du même genre. Une rangée
 * de produits n'a rien à traduire, une image sans légende non plus.
 */
export function languesDeLaPage(p: {
  blocks: BlocPage[] | null;
  translations: Traductions;
}): string[] {
  const blocs = p.blocks ?? [];
  return [
    "fr",
    ...LANGUES_ETRANGERES.filter((l) => {
      const t = p.translations?.[l] as
        | { title?: unknown; blocks?: unknown }
        | undefined;
      if (!ecrit(t?.title)) return false;
      const traduits = Array.isArray(t?.blocks) ? (t.blocks as BlocPage[]) : [];
      return blocs.every((f, i) => {
        const tr = traduits[i] as Record<string, unknown> | undefined;
        const memeGenre = !!tr && tr.type === f.type;
        if (f.type === "titre" || f.type === "bouton")
          return !ecrit(f.texte) || (memeGenre && ecrit(tr.texte));
        if (f.type === "texte") return !ecrit(f.html) || (memeGenre && ecrit(tr.html));
        if (f.type === "image")
          return !ecrit(f.legende) || (memeGenre && ecrit(tr.legende));
        return true;
      });
    }),
  ];
}

/**
 * Le genre d'un rayon : celui de TOUTES ses affiches en vente, ou null quand
 * il en mêle des deux sortes (« Accessoires » : 24 à composer, 1 prête à
 * imprimer). Un rayon d'un seul genre n'a qu'une adresse, celle du menu, qui
 * porte ce genre ; un rayon mêlé garde l'adresse sans genre.
 */
export function genreDuRayon(
  personnalisables: number,
  pretes: number,
): "personnalisable" | "prete_a_imprimer" | null {
  if (personnalisables > 0 && pretes === 0) return "personnalisable";
  if (pretes > 0 && personnalisables === 0) return "prete_a_imprimer";
  return null;
}
