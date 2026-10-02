/**
 * Le côté serveur du composant TraductionsNoms.astro : enregistrer les noms
 * traduits saisis, et proposer ceux qui manquent.
 *
 * Un nom n'est qu'un cas particulier des textes traduits (lib/traductions.ts),
 * celui d'un champ unique `name` : ces fonctions ne font que l'y ramener.
 */
import {
  enregistrerTraductions,
  proposerTraductions,
  traiterTraductions,
  type ChampTraduit,
  type ElementTraduit,
  type EtatTraductions,
  type Propositions,
} from "./traductions.ts";

export { LANGUES_TRADUITES } from "./traductions.ts";

/** Ce qu'un écran de liste sait d'un élément à nommer. */
export interface ElementNom {
  id: number;
  name: string;
  translations?: Partial<Record<string, { name?: string }>> | null;
}

export const CHAMP_NOM: ChampTraduit = { cle: "name", libelle: "Nom", max: 120 };

/** Les éléments d'une liste, dans la forme du composant général. */
export function elementsNoms(elements: ElementNom[]): ElementTraduit[] {
  return elements.map((e) => ({
    id: e.id,
    libelle: e.name,
    francais: { name: e.name },
    translations: e.translations,
  }));
}

/**
 * Enregistre les noms qui ont CHANGÉ, et seulement ceux-là : un formulaire de
 * vingt cases n'envoie pas vingt écritures pour une seule correction. Rend le
 * nombre de noms modifiés.
 */
export async function enregistrerTraductionsNoms(
  form: FormData,
  elements: ElementNom[],
  enregistrer: (id: number, lang: string, nom: string) => Promise<unknown>,
): Promise<number> {
  const { ecrites, retirees } = await enregistrerTraductions(
    form,
    elementsNoms(elements),
    [CHAMP_NOM],
    (id, lang, modifies) => enregistrer(Number(id), lang, modifies.name ?? ""),
  );
  return ecrites + retirees;
}

/**
 * Propose, par la traduction automatique, les noms qui MANQUENT dans le
 * formulaire envoyé — ce qui y est déjà écrit n'est jamais remplacé. Un appel
 * par langue. Rien n'est enregistré.
 */
export async function proposerTraductionsNoms(
  form: FormData,
  elements: ElementNom[],
  proposer: (lang: string, champs: Record<string, string>) => Promise<{ champs: Record<string, string> }>,
): Promise<Propositions> {
  return proposerTraductions(form, elementsNoms(elements), [CHAMP_NOM], proposer);
}

/**
 * Les deux actions du bloc des noms (voir traiterTraductions) : l'écran n'a
 * plus qu'à montrer le message, les propositions et la saisie rendus.
 */
export function traiterTraductionsNoms(
  quoi: "enregistrer" | "proposer",
  form: FormData,
  elements: ElementNom[],
  enregistrer: (id: number, lang: string, nom: string) => Promise<unknown>,
  proposer: (lang: string, champs: Record<string, string>) => Promise<{ champs: Record<string, string> }>,
): Promise<EtatTraductions> {
  return traiterTraductions(
    quoi,
    form,
    elementsNoms(elements),
    [CHAMP_NOM],
    (id, lang, modifies) => enregistrer(Number(id), lang, modifies.name ?? ""),
    proposer,
  );
}
