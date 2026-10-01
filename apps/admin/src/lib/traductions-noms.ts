/**
 * Le côté serveur du composant TraductionsNoms.astro : enregistrer les noms
 * traduits saisis, et proposer ceux qui manquent.
 */

export const LANGUES_TRADUITES = ["en", "de", "it", "es"] as const;

interface Element {
  id: number;
  name: string;
  translations?: Partial<Record<string, { name?: string }>> | null;
}

/**
 * Enregistre les cases `tr-<id>-<langue>` qui ont CHANGÉ, et seulement
 * celles-là : un formulaire de vingt cases n'envoie pas vingt écritures pour
 * une seule correction. Rend le nombre de noms modifiés.
 */
export async function enregistrerTraductionsNoms(
  form: FormData,
  elements: Element[],
  enregistrer: (id: number, lang: string, nom: string) => Promise<unknown>,
): Promise<number> {
  let modifies = 0;
  for (const e of elements) {
    for (const l of LANGUES_TRADUITES) {
      const saisi = form.get(`tr-${e.id}-${l}`);
      if (saisi === null) continue;
      const nouveau = String(saisi).trim();
      const ancien = (e.translations?.[l]?.name ?? "").trim();
      if (nouveau === ancien) continue;
      await enregistrer(e.id, l, nouveau);
      modifies++;
    }
  }
  return modifies;
}

/**
 * Propose, par la traduction automatique, les noms qui MANQUENT : un appel
 * par langue, avec tous les noms à traduire d'un coup. Rien n'est enregistré.
 * Rend id → langue → proposition.
 */
export async function proposerTraductionsNoms(
  elements: Element[],
  proposer: (lang: string, champs: Record<string, string>) => Promise<{ champs: Record<string, string> }>,
): Promise<Record<number, Partial<Record<string, string>>>> {
  const propositions: Record<number, Partial<Record<string, string>>> = {};
  for (const l of LANGUES_TRADUITES) {
    const manquants = elements.filter((e) => !e.translations?.[l]?.name?.trim());
    if (!manquants.length) continue;
    const { champs } = await proposer(
      l,
      Object.fromEntries(manquants.map((e) => [`n${e.id}`, e.name])),
    );
    for (const e of manquants) {
      const t = champs[`n${e.id}`];
      if (t) (propositions[e.id] ??= {})[l] = t;
    }
  }
  return propositions;
}
