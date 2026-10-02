/**
 * Le côté serveur du composant Traductions.astro : les textes saisis par la
 * boutique (noms, descriptions, messages…) dans les quatre autres langues du
 * site — les enregistrer, et proposer ceux qui manquent.
 *
 * Une seule mécanique pour tous les écrans (cadres, catégories, personnages,
 * collections, promotions, modes de livraison, bandeau) : une cliente qui
 * vide une case du bandeau doit obtenir exactement ce qu'elle obtient en
 * vidant celle d'un cadre — le français s'affiche de nouveau.
 *
 * Les cases s'appellent `tr-<id>-<champ>-<langue>`.
 */

/** Les langues du site autres que le français, dans l'ordre du back-office. */
export const LANGUES_TRADUITES = [
  { code: "en", nom: "Anglais" },
  { code: "de", nom: "Allemand" },
  { code: "it", nom: "Italien" },
  { code: "es", nom: "Espagnol" },
] as const;

/** Le dictionnaire d'une ligne, tel que l'API le rend : langue → champ → texte. */
export type DicoTraductions =
  | Partial<Record<string, Partial<Record<string, string | null | undefined>>>>
  | null
  | undefined;

/** Un champ traduisible d'une donnée : `name`, `description`, `message`… */
export interface ChampTraduit {
  cle: string;
  /** Ce que l'écran en dit : « Nom », « Précision (délai…) »… */
  libelle: string;
  /** Plus d'une ligne : une zone de texte plutôt qu'une ligne simple. */
  lignes?: number;
  /** Longueur maximale, la même que celle du champ français. */
  max?: number;
}

/** Une ligne à traduire : un mode de livraison, une promotion, le bandeau… */
export interface ElementTraduit {
  /**
   * Ce qui distingue la ligne dans le formulaire. Un texte quand deux tables
   * se partagent un même bloc (le bandeau et son offre ont chacun leur id 1).
   */
  id: number | string;
  /** Ce qui la désigne à l'écran : son nom français. */
  libelle: string;
  /** Les textes français, champ par champ : la référence et le repli. */
  francais: Record<string, string | null | undefined>;
  translations?: DicoTraductions;
  /** Ses propres champs, quand ils diffèrent de ceux du bloc. */
  champs?: ChampTraduit[];
}

/** Les propositions automatiques, non enregistrées : id → langue → champ → texte. */
export type Propositions = Record<string, Partial<Record<string, Record<string, string>>>>;

export const nomCase = (id: number | string, champ: string, langue: string) =>
  `tr-${id}-${champ}-${langue}`;

/** La traduction enregistrée d'un champ, telle quelle (vide si absente). */
export function traductionEnregistree(
  e: ElementTraduit,
  champ: string,
  langue: string,
): string {
  const v = e.translations?.[langue]?.[champ];
  return typeof v === "string" ? v.trim() : "";
}

/** Le français d'un champ, sans les espaces autour. */
export function francaisDe(e: ElementTraduit, champ: string): string {
  return (e.francais[champ] ?? "").trim();
}

/**
 * Le nombre de textes encore en français : ceux dont le français existe et
 * dont la traduction manque. Un français vide n'a rien à traduire — il reste
 * vide dans toutes les langues.
 */
export function compterManquants(elements: ElementTraduit[], champs: ChampTraduit[]): number {
  let n = 0;
  for (const e of elements)
    for (const c of e.champs ?? champs)
      for (const l of LANGUES_TRADUITES)
        if (francaisDe(e, c.cle) && !traductionEnregistree(e, c.cle, l.code)) n++;
  return n;
}

/** Tous les champs du bloc, ceux propres à un élément compris. */
function tousLesChamps(elements: ElementTraduit[], champs: ChampTraduit[]): ChampTraduit[] {
  const vus = new Map<string, ChampTraduit>();
  for (const c of champs) vus.set(c.cle, c);
  for (const e of elements) for (const c of e.champs ?? []) vus.set(c.cle, c);
  return [...vus.values()];
}

/**
 * Enregistre les cases qui ont CHANGÉ, et seulement elles : un tableau de
 * vingt cases n'envoie pas vingt écritures pour une seule correction.
 *
 * Un appel par ligne et par langue, avec les seuls champs modifiés — l'API
 * garde ceux qu'on ne lui envoie pas. Une case absente du formulaire (le
 * lieu de retrait d'un mode qui n'est pas un retrait, une ligne d'un autre
 * bloc) n'est pas touchée. Rend le nombre de textes écrits, et celui des
 * textes retirés (vidés : le français s'affiche de nouveau).
 */
export async function enregistrerTraductions(
  form: FormData,
  elements: ElementTraduit[],
  champs: ChampTraduit[],
  enregistrer: (id: number | string, langue: string, modifies: Record<string, string>) => Promise<unknown>,
): Promise<{ ecrites: number; retirees: number }> {
  const liste = tousLesChamps(elements, champs);
  const bilan = { ecrites: 0, retirees: 0 };
  for (const e of elements) {
    for (const l of LANGUES_TRADUITES) {
      const modifies: Record<string, string> = {};
      for (const c of liste) {
        const saisi = form.get(nomCase(e.id, c.cle, l.code));
        if (saisi === null) continue;
        const nouveau = String(saisi).trim();
        if (nouveau === traductionEnregistree(e, c.cle, l.code)) continue;
        modifies[c.cle] = nouveau;
      }
      if (!Object.keys(modifies).length) continue;
      await enregistrer(e.id, l.code, modifies);
      for (const v of Object.values(modifies)) {
        if (v) bilan.ecrites++;
        else bilan.retirees++;
      }
    }
  }
  return bilan;
}

/**
 * Propose, par la traduction automatique, les textes qui MANQUENT : les
 * cases vides du formulaire envoyé dont le français existe. Ce qui y est
 * déjà écrit — enregistré ou tout juste tapé — n'est jamais remplacé.
 *
 * Un appel par langue, avec tout ce qu'il faut y traduire d'un coup. Rien
 * n'est enregistré : la boutique relit, corrige, puis enregistre.
 */
export async function proposerTraductions(
  form: FormData,
  elements: ElementTraduit[],
  champs: ChampTraduit[],
  proposer: (langue: string, champs: Record<string, string>) => Promise<{ champs: Record<string, string> }>,
): Promise<Propositions> {
  const liste = tousLesChamps(elements, champs);
  const propositions: Propositions = {};
  for (const l of LANGUES_TRADUITES) {
    const aTraduire: Record<string, string> = {};
    for (const e of elements)
      for (const c of liste) {
        const saisi = form.get(nomCase(e.id, c.cle, l.code));
        if (saisi === null || String(saisi).trim()) continue;
        const francais = francaisDe(e, c.cle);
        if (francais) aTraduire[`${e.id}.${c.cle}`] = francais;
      }
    if (!Object.keys(aTraduire).length) continue;
    const { champs: traduits } = await proposer(l.code, aTraduire);
    for (const [cle, texte] of Object.entries(traduits)) {
      const point = cle.lastIndexOf(".");
      const id = cle.slice(0, point);
      const champ = cle.slice(point + 1);
      if (!texte?.trim() || !(cle in aTraduire)) continue;
      ((propositions[id] ??= {})[l.code] ??= {})[champ] = texte;
    }
  }
  return propositions;
}

/** Combien de propositions attendent d'être relues. */
export function compterPropositions(p: Propositions): number {
  let n = 0;
  for (const parLangue of Object.values(p))
    for (const parChamp of Object.values(parLangue)) n += Object.keys(parChamp ?? {}).length;
  return n;
}

/**
 * Le message à montrer après un clic sur « Enregistrer » ou « Proposer »,
 * le même sur tous les écrans.
 */
export function messageEnregistrement({
  ecrites,
  retirees,
}: {
  ecrites: number;
  retirees: number;
}): string {
  if (!ecrites && !retirees) return "Aucune traduction modifiée.";
  const s = (n: number) => (n > 1 ? "s" : "");
  const morceaux: string[] = [];
  if (ecrites) morceaux.push(`${ecrites} traduction${s(ecrites)} enregistrée${s(ecrites)}`);
  if (retirees)
    morceaux.push(
      `${retirees} traduction${s(retirees)} retirée${s(retirees)} : le site y affiche de nouveau le français`,
    );
  return `${morceaux.join(" ; ")}.`;
}
export function messageProposition(n: number): string {
  return n
    ? `${n} proposition${n > 1 ? "s" : ""} de traduction : relisez les cases en jaune, corrigez-les si besoin, puis cliquez « Enregistrer les traductions ». Rien n'est enregistré pour l'instant.`
    : "Rien à proposer : tout ce qui a un texte français est déjà traduit.";
}

/**
 * Le texte d'une erreur, sans le « Error: » que String(e) ajoute. Le refus
 * de la traduction automatique (« il manque OPENAI_API_KEY… ») doit se lire
 * tel que l'API l'écrit.
 */
export function texteErreur(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).replace(/^Error:\s*/, "");
}

/** Ce que l'écran doit montrer après l'une des deux actions d'un bloc. */
export interface EtatTraductions {
  message: string;
  erreur: boolean;
  propositions: Propositions;
  /** Le formulaire à réafficher tel quel, ou null quand tout est enregistré. */
  saisies: FormData | null;
}

/**
 * Les deux actions d'un bloc de traductions, traitées de la même façon sur
 * tous les écrans : enregistrer les cases modifiées, ou proposer les cases
 * vides. En cas de refus (traduction automatique non branchée, API muette),
 * la saisie reste à l'écran et le message dit pourquoi, dans les mots de
 * l'API.
 */
export async function traiterTraductions(
  quoi: "enregistrer" | "proposer",
  form: FormData,
  elements: ElementTraduit[],
  champs: ChampTraduit[],
  enregistrer: (id: number | string, langue: string, modifies: Record<string, string>) => Promise<unknown>,
  proposer: (langue: string, champs: Record<string, string>) => Promise<{ champs: Record<string, string> }>,
): Promise<EtatTraductions> {
  try {
    if (quoi === "enregistrer") {
      const bilan = await enregistrerTraductions(form, elements, champs, enregistrer);
      return {
        message: messageEnregistrement(bilan),
        erreur: false,
        propositions: {},
        saisies: null,
      };
    }
    const propositions = await proposerTraductions(form, elements, champs, proposer);
    return {
      message: messageProposition(compterPropositions(propositions)),
      erreur: false,
      propositions,
      saisies: form,
    };
  } catch (e) {
    return {
      message:
        (quoi === "enregistrer"
          ? "Les traductions n'ont pas toutes pu être enregistrées : "
          : "Aucune traduction proposée : ") + texteErreur(e),
      erreur: true,
      propositions: {},
      saisies: form,
    };
  }
}
