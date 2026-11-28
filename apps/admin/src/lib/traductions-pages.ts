/**
 * La traduction des PAGES du site (BO › Pages › une page) : proposer les
 * champs manquants dans une langue ou dans les six d'un coup, et préparer ce
 * qui part à l'API quand on enregistre.
 *
 * Le bouton « dans toutes les langues » (A-FAIRE § 2, Alexandra le 28/11 :
 * « finis le à faire ») : l'éditeur de page ne proposait la traduction que
 * langue par langue, quand la fiche produit et les écrans de traduction
 * communs savent déjà le faire dans les six. Même règle qu'eux :
 *   - seuls les champs VIDES dont le français existe sont proposés : une
 *     traduction déjà écrite, enregistrée ou tout juste tapée, n'est jamais
 *     remplacée par la machine (pour en refaire une, on vide son champ) ;
 *   - rien n'est enregistré : la boutique relit, corrige, puis enregistre.
 *
 * Une page n'est pas une fiche produit : les conditions de vente font près de
 * dix mille caractères. Envoyé d'un bloc, un tel texte dépasse en japonais la
 * minute que l'API accorde au service de traduction, et la proposition
 * tombait en « Le service de traduction ne répond pas ». Le texte part donc
 * en MORCEAUX coupés entre deux paragraphes (jamais au milieu d'une liste),
 * traduits en même temps puis recollés dans l'ordre ; un morceau qui manque,
 * et le texte n'est pas proposé du tout — un texte à trous passerait pour
 * entier.
 *
 * Fonctions pures (sauf l'appel de traduction, passé en paramètre) : les
 * essais de tests/traductions-pages.test.mjs les vérifient sans API.
 */
import type { BlocPage } from "./api.ts";
import { texteErreur } from "./traductions.ts";

/** Les quatre champs d'une langue, tels que l'écran les montre. */
export interface SaisieLangue {
  titre: string;
  corps: string;
  seoTitle: string;
  seoDescription: string;
}

export const CHAMPS_DE_LANGUE = ["titre", "corps", "seoTitle", "seoDescription"] as const;

/** Les champs courts, qui partent avec le premier morceau du texte. */
const CHAMPS_COURTS = ["titre", "seoTitle", "seoDescription"] as const;

/** Une langue telle que l'API la garde (PageCms › translations). */
export interface TraductionEnregistree {
  title?: string;
  blocks?: BlocPage[];
  seoTitle?: string;
  seoDescription?: string;
}

/**
 * Ce que /admin/traduire accepte par champ (apps/api/src/traductions.ts) :
 * au-delà, il couperait le texte sans le dire.
 */
export const LIMITE_TRADUCTION = 20_000;

/**
 * La taille visée d'un morceau envoyé d'un coup : traduit en japonais, il
 * tient largement dans la minute accordée au service.
 */
export const TAILLE_MORCEAU = 4_000;

/**
 * Au plus autant d'appels de traduction en même temps : six langues d'une
 * page courte partent ensemble ; les conditions de vente dans les six
 * langues (dix-huit morceaux) en trois vagues, sans assaillir le service.
 */
export const APPELS_SIMULTANES = 8;

/* -------------------------------------------------------------------------- */
/*  Les blocs de la page                                                       */
/* -------------------------------------------------------------------------- */

export function echapper(t: string): string {
  return String(t ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Replie une pile de blocs en un seul texte.
 *
 * C'est la charnière entre l'ancien découpage et le nouvel éditeur. Un titre
 * de niveau 2 devient un `<h2>`, de niveau 3 un `<h3>` — exactement les deux
 * balises que l'éditeur sait écrire et que la page publique sait dessiner,
 * avec la même allure qu'avant.
 *
 * Le texte d'un bloc passe TEL QUEL : il a déjà été nettoyé par l'éditeur au
 * moment où il a été écrit, et le renettoyer ici ne ferait que risquer d'en
 * perdre un morceau. Un titre, lui, est du texte brut et doit être échappé —
 * un « Conditions & tarifs » écrit dans un ancien bloc titre casserait le HTML
 * s'il y entrait sans précaution.
 *
 * (Déplacée ici depuis pages/[id].astro le 28/11, sans changement : les
 * traductions s'en servent aussi.)
 */
export function corpsDepuisBlocs(blocs: BlocPage[] | null | undefined): string {
  if (!Array.isArray(blocs)) return "";
  const morceaux: string[] = [];
  for (const b of blocs) {
    if (b.type === "titre") {
      const balise = b.niveau === 3 ? "h3" : "h2";
      const texte = echapper(String(b.texte ?? "")).trim();
      if (texte) morceaux.push(`<${balise}>${texte}</${balise}>`);
    } else if (b.type === "texte") {
      const html = String(b.html ?? "").trim();
      if (html) morceaux.push(html);
    } else if (b.type === "image") {
      const src = echapper(String(b.url ?? "")).trim();
      if (src)
        morceaux.push(
          `<p><img src="${src}" alt="${echapper(String(b.alt ?? ""))}"></p>`,
        );
      const legende = String(b.legende ?? "").trim();
      if (legende) morceaux.push(`<p><em>${echapper(legende)}</em></p>`);
    } else if (b.type === "bouton") {
      const href = echapper(String(b.href ?? "")).trim();
      const texte = echapper(String(b.texte ?? "")).trim();
      if (href) morceaux.push(`<p><a href="${href}">${texte}</a></p>`);
    }
    // « produits » : une grille calculée à l'affichage, qui ne se raconte pas
    // en texte. L'éditeur la laisse de côté ET le dit (`grillePerdue`).
  }
  return morceaux.join("");
}

/** Le corps tel qu'il part en base : un bloc de texte, ou rien. */
export function blocsDepuisCorps(corps: string): BlocPage[] {
  const html = corps.trim();
  return html ? [{ type: "texte", html } as BlocPage] : [];
}

/** Le français tel qu'il sera en base après un envoi : le patron des traductions. */
export interface FrancaisRange {
  /** Ses blocs : le texte d'un seul tenant, puis les grilles d'affiches. */
  blocs: BlocPage[];
  /** Son texte seul, sans les grilles : vide quand la page n'en a pas. */
  texte: BlocPage[];
  /** Vrai quand le français, encore en plusieurs morceaux, est réuni par cet envoi. */
  aRanger: boolean;
}

/**
 * Le français de la page, rangé comme l'éditeur l'enregistre : un seul bloc
 * de texte, puis les grilles d'affiches (« produits »), qui ne se replient
 * pas en texte et restent après lui (18/11).
 */
export function rangerLeFrancais(blocsFrancais: BlocPage[] | null | undefined): FrancaisRange {
  const blocs = Array.isArray(blocsFrancais) ? blocsFrancais : [];
  const grilles = blocs.filter((b) => b.type === "produits");
  const texteFrancais = blocs.filter((b) => b.type !== "produits");
  const texte =
    texteFrancais.length > 1 || (texteFrancais.length === 1 && texteFrancais[0]!.type !== "texte")
      ? blocsDepuisCorps(corpsDepuisBlocs(texteFrancais))
      : texteFrancais;
  const range = [...texte, ...grilles];
  return { blocs: range, texte, aRanger: JSON.stringify(range) !== JSON.stringify(blocs) };
}

/** Ce qui part à l'API pour une langue (voir lireTraductionsPage, cms.ts). */
export interface TraductionEnvoyee {
  title: string;
  blocks?: BlocPage[];
  seoTitle?: string;
  seoDescription?: string;
}

/** Le texte traduit posé en face du texte français, les grilles recopiées. */
function blocsTraduits(rangee: FrancaisRange, corps: string): BlocPage[] {
  return rangee.blocs.map((b) =>
    b.type === "produits" ? b : ({ type: "texte", html: corps } as BlocPage),
  );
}

/**
 * La traduction d'une langue telle qu'elle part, ou `null` quand plus rien
 * n'y est écrit : c'est ainsi qu'on efface une traduction devenue fausse (le
 * site repasse au français).
 *
 * Le référencement compte : une langue dont seuls le titre et la description
 * Google sont remplis existe bel et bien. Il part toujours : vide, il retire
 * le référencement traduit, et la page retombe sur son nom traduit.
 *
 * Le texte ne part QUE s'il est écrit : envoyé vide, une liste de zéro bloc
 * serait refusée face au bloc du français, alors que traduire le nom seul
 * est permis.
 */
export function traductionAEnvoyer(
  s: SaisieLangue,
  rangee: FrancaisRange,
  /** « en anglais » : nomme la langue dans un refus, quand plusieurs partent ensemble. */
  laquelle = "",
): TraductionEnvoyee | null {
  const titre = s.titre.trim();
  const corps = s.corps.trim();
  const seoTitle = s.seoTitle.trim();
  const seoDescription = s.seoDescription.trim();
  if (!titre && !corps && !seoTitle && !seoDescription) return null;
  // Un texte traduit se cale sur le texte français : face à une page
  // française vide, il n'aurait rien en face de quoi s'afficher, et le
  // serveur le refuserait en parlant de blocs. On le dit dans ses mots.
  if (corps && !rangee.texte.length)
    throw new Error(
      `Le texte français de cette page est vide${laquelle ? ` (texte ${laquelle})` : ""} : ` +
        "écrivez-le et enregistrez-le d'abord, la traduction s'affiche à sa place. " +
        "Le nom traduit, lui, peut s'enregistrer seul.",
    );
  const t: TraductionEnvoyee = { title: titre, seoTitle, seoDescription };
  if (corps) t.blocks = blocsTraduits(rangee, corps);
  return t;
}

/**
 * Vrai quand une traduction ne suit plus le découpage du texte français.
 *
 * Le site recolle les blocs RANG PAR RANG (fusionnerBlocs, cms.ts) : une
 * traduction en dix-sept morceaux face à un français réuni en un seul n'en
 * montre que le premier, et le reste de la page disparaît dans cette langue.
 * C'est arrivé à la page Confidentialité (copie locale de la prod, 28/11) :
 * son français a été réenregistré d'un seul tenant le 22/11, ses traductions
 * sont restées en morceaux, et /en/pages/confidentialite ne montre plus que
 * l'introduction. Les grilles d'affiches ne comptent pas : elles viennent
 * toujours du français.
 */
export function desalignee(traduits: BlocPage[], francais: BlocPage[]): boolean {
  const n = Math.max(traduits.length, francais.length);
  for (let i = 0; i < n; i++) {
    const f = francais[i];
    const t = traduits[i];
    const texteF = !!f && f.type !== "produits";
    const texteT = !!t && t.type !== "produits";
    if (!texteF && !texteT) continue;
    if (!f || !t || f.type !== t.type) return true;
  }
  return false;
}

/**
 * Une traduction enregistrée, recalée sur le français tel qu'il part : tout
 * son texte replié d'un seul tenant en face du texte français, sans changer
 * un mot. `null` quand il n'y a rien à renvoyer : déjà calée, sans texte, ou
 * face à un français sans texte (on n'y touche pas).
 *
 * Le référencement n'est pas renvoyé : une clé absente garde ce qui est
 * enregistré (cms.ts). Le nom, lui, doit repartir, sans quoi il serait
 * effacé.
 */
export function traductionRecalee(
  avant: TraductionEnregistree | null | undefined,
  rangee: FrancaisRange,
): TraductionEnvoyee | null {
  if (!avant?.blocks?.length || !rangee.texte.length) return null;
  if (!desalignee(avant.blocks, rangee.blocs)) return null;
  const corps = corpsDepuisBlocs(avant.blocks).trim();
  if (!corps) return null;
  return { title: avant.title ?? "", blocks: blocsTraduits(rangee, corps) };
}

/**
 * Les langues dont le site ne montre plus qu'une partie du texte, faute de
 * suivre le découpage du français ENREGISTRÉ (voir `desalignee`).
 */
export function languesDesalignees(
  blocsFrancais: BlocPage[] | null | undefined,
  traductions: Record<string, TraductionEnregistree | undefined> | null | undefined,
): string[] {
  const francais = Array.isArray(blocsFrancais) ? blocsFrancais : [];
  return Object.entries(traductions ?? {})
    .filter(
      ([, t]) =>
        !!t?.blocks?.length &&
        desalignee(t.blocks, francais) &&
        !!corpsDepuisBlocs(t.blocks).trim(),
    )
    .map(([langue]) => langue);
}

/** Ce que l'écran montre d'une langue enregistrée : ses quatre champs. */
export function saisieEnregistree(t: TraductionEnregistree | null | undefined): SaisieLangue {
  return {
    titre: t?.title ?? "",
    corps: corpsDepuisBlocs(t?.blocks),
    seoTitle: t?.seoTitle ?? "",
    seoDescription: t?.seoDescription ?? "",
  };
}

/**
 * Les fins de ligne d'un texte reçu d'un formulaire, ramenées à « \n » : le
 * navigateur envoie chaque « \n » d'un champ (même caché) en « \r\n », et
 * les textes enregistrés en contiennent (les pages légales). Sans cela, une
 * langue relue sans y toucher passerait pour modifiée.
 */
export function finsDeLigne(t: string): string {
  return t.replace(/\r\n?/g, "\n");
}

/** Vrai quand rien n'a changé entre deux saisies (aux espaces et fins de ligne près). */
export function memeSaisie(a: SaisieLangue, b: SaisieLangue): boolean {
  return CHAMPS_DE_LANGUE.every((c) => finsDeLigne(a[c]).trim() === finsDeLigne(b[c]).trim());
}

/* -------------------------------------------------------------------------- */
/*  La proposition automatique                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Les champs à proposer : ceux qui sont vides dans la saisie et dont le
 * français existe. Ce qui est écrit, enregistré ou tapé, n'est pas touché.
 */
export function champsManquants(francais: SaisieLangue, saisie: SaisieLangue): Partial<SaisieLangue> {
  const manque: Partial<SaisieLangue> = {};
  for (const cle of CHAMPS_DE_LANGUE) {
    if (saisie[cle].trim() || !francais[cle].trim()) continue;
    manque[cle] = francais[cle];
  }
  return manque;
}

/** Les balises sans fermeture : elles ne changent pas la profondeur. */
const BALISES_VIDES = new Set(["br", "img", "hr", "wbr", "input", "source", "col", "area", "embed", "track"]);

/**
 * Le HTML coupé entre ses éléments de premier niveau (paragraphes, titres,
 * listes entières) : chaque segment est complet, et les segments mis bout à
 * bout redonnent le texte au caractère près. Un HTML mal fermé ne se coupe
 * pas : il reste d'un seul tenant.
 */
export function segmentsHtml(html: string): string[] {
  const segments: string[] = [];
  const balise = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g;
  let profondeur = 0;
  let debut = 0;
  for (let m = balise.exec(html); m; m = balise.exec(html)) {
    const nom = m[2]!.toLowerCase();
    if (BALISES_VIDES.has(nom) || m[0].endsWith("/>")) continue;
    if (!m[1]) {
      profondeur++;
      continue;
    }
    profondeur = Math.max(0, profondeur - 1);
    if (profondeur === 0) {
      const fin = m.index + m[0].length;
      segments.push(html.slice(debut, fin));
      debut = fin;
    }
  }
  if (debut < html.length) segments.push(html.slice(debut));
  return segments;
}

/**
 * Le texte d'une page en morceaux d'environ `taille` caractères, coupés
 * entre deux éléments de premier niveau. Un texte court reste entier ; un
 * élément plus long que `taille` fait un morceau à lui seul.
 */
export function morceauxHtml(html: string, taille = TAILLE_MORCEAU): string[] {
  const texte = html.trim();
  if (!texte) return [];
  if (texte.length <= taille) return [texte];
  const morceaux: string[] = [];
  let courant = "";
  for (const s of segmentsHtml(texte)) {
    if (courant.trim() && s.trim() && courant.length + s.length > taille) {
      morceaux.push(courant);
      courant = s;
    } else courant += s;
  }
  if (courant.trim()) morceaux.push(courant);
  else if (courant && morceaux.length) morceaux[morceaux.length - 1] += courant;
  return morceaux;
}

/** L'appel de traduction : /admin/traduire, une langue et ses champs. */
export type Proposer = (
  langue: string,
  champs: Record<string, string>,
) => Promise<{ champs: Record<string, string> }>;

export interface DemandeLangue {
  langue: string;
  /** Les champs à traduire, en français (voir `champsManquants`). */
  manque: Partial<SaisieLangue>;
}

export interface ResultatLangue {
  /** Les champs traduits, à relire : rien n'est enregistré. */
  propositions: Partial<SaisieLangue>;
  /** Pourquoi tout ou partie n'a pas été proposé, dans les mots de l'API. */
  erreur?: string;
  /** Un seul paragraphe dépasse ce que la traduction accepte : le texte n'est pas proposé. */
  tropLong?: boolean;
}

/** Lance des tâches, au plus `max` à la fois, et rend chaque issue à sa place. */
async function enParallele<T>(
  taches: (() => Promise<T>)[],
  max: number,
): Promise<PromiseSettledResult<T>[]> {
  const issues: PromiseSettledResult<T>[] = new Array(taches.length);
  let suivante = 0;
  async function ouvrier(): Promise<void> {
    while (suivante < taches.length) {
      const i = suivante++;
      try {
        issues[i] = { status: "fulfilled", value: await taches[i]!() };
      } catch (raison) {
        issues[i] = { status: "rejected", reason: raison };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(max, taches.length)) }, ouvrier));
  return issues;
}

/**
 * Propose les champs manquants de chaque langue demandée.
 *
 * Par langue : un premier appel avec les champs courts et le premier
 * morceau du texte, puis un appel par morceau suivant. Tous les appels de
 * toutes les langues partent en même temps (au plus `simultanes`), les
 * premiers morceaux d'abord, pour que chaque langue avance.
 *
 * Une langue qui échoue n'empêche pas les autres ; ce qui est revenu d'elle
 * est gardé (son nom, son référencement), sauf un texte incomplet, qui n'est
 * jamais proposé. Recliquer « Proposer » ne redemande alors que le reste,
 * puisque seuls les champs vides partent.
 */
export async function proposerLangues(
  demandes: DemandeLangue[],
  proposer: Proposer,
  reglages: { taille?: number; simultanes?: number } = {},
): Promise<Record<string, ResultatLangue>> {
  const taille = reglages.taille ?? TAILLE_MORCEAU;
  const simultanes = reglages.simultanes ?? APPELS_SIMULTANES;

  interface Plan {
    demande: DemandeLangue;
    courts: string[];
    morceaux: number;
    tropLong: boolean;
    appels: Record<string, string>[];
  }
  const plans: Plan[] = demandes.map((d) => {
    const premier: Record<string, string> = {};
    const courts: string[] = [];
    for (const cle of CHAMPS_COURTS) {
      const fr = d.manque[cle];
      if (fr?.trim()) {
        premier[cle] = fr;
        courts.push(cle);
      }
    }
    let morceaux = d.manque.corps?.trim() ? morceauxHtml(d.manque.corps, taille) : [];
    const tropLong = morceaux.some((m) => m.length > LIMITE_TRADUCTION);
    if (tropLong) morceaux = [];
    const appels: Record<string, string>[] = [];
    if (morceaux.length === 1) premier.corps = morceaux[0]!;
    else morceaux.forEach((m, i) => {
      if (i === 0) premier[`corps.${i}`] = m;
      else appels.push({ [`corps.${i}`]: m });
    });
    if (Object.keys(premier).length) appels.unshift(premier);
    return { demande: d, courts, morceaux: morceaux.length, tropLong, appels };
  });

  // Les premiers appels de chaque langue d'abord, puis les deuxièmes…
  const taches: { plan: Plan; champs: Record<string, string> }[] = [];
  const plusLong = Math.max(0, ...plans.map((p) => p.appels.length));
  for (let rang = 0; rang < plusLong; rang++)
    for (const plan of plans) {
      const champs = plan.appels[rang];
      if (champs) taches.push({ plan, champs });
    }

  const issues = await enParallele(
    taches.map((t) => () => proposer(t.plan.demande.langue, t.champs)),
    simultanes,
  );

  const recus = new Map<Plan, Record<string, string>>();
  const erreurs = new Map<Plan, string>();
  taches.forEach((t, i) => {
    const issue = issues[i]!;
    if (issue.status === "fulfilled") {
      const recu = recus.get(t.plan) ?? {};
      // Seules les clés demandées dans CET appel : une réponse bavarde ne
      // remplit jamais un champ que personne n'a demandé.
      for (const cle of Object.keys(t.champs)) {
        const v = issue.value?.champs?.[cle];
        if (typeof v === "string" && v.trim()) recu[cle] = v.trim();
      }
      recus.set(t.plan, recu);
    } else if (!erreurs.has(t.plan)) erreurs.set(t.plan, texteErreur(issue.reason));
  });

  const resultats: Record<string, ResultatLangue> = {};
  for (const plan of plans) {
    const recu = recus.get(plan) ?? {};
    const propositions: Partial<SaisieLangue> = {};
    for (const cle of plan.courts) {
      const v = recu[cle];
      if (v) propositions[cle as (typeof CHAMPS_COURTS)[number]] = v;
    }
    if (plan.morceaux === 1 && recu.corps) propositions.corps = recu.corps;
    else if (plan.morceaux > 1) {
      const parts = Array.from({ length: plan.morceaux }, (_, i) => recu[`corps.${i}`] ?? "");
      if (parts.every(Boolean)) propositions.corps = parts.join("");
    }
    let erreur = erreurs.get(plan);
    if (!erreur && plan.morceaux > 0 && propositions.corps === undefined)
      erreur = "La traduction du texte est revenue incomplète. Réessayez.";
    if (!erreur && !Object.keys(propositions).length && plan.appels.length)
      erreur = "La traduction automatique n'a rien renvoyé. Réessayez.";
    resultats[plan.demande.langue] = {
      propositions,
      ...(erreur ? { erreur } : {}),
      ...(plan.tropLong ? { tropLong: true } : {}),
    };
  }
  return resultats;
}

/** « anglais », « anglais et allemand », « anglais, allemand et japonais ». */
export function enumerer(noms: string[]): string {
  if (noms.length <= 1) return noms.join("");
  return `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}`;
}

export const AVERTISSEMENT_TROP_LONG =
  "Un paragraphe du texte est trop long pour la traduction automatique : coupez-le en deux, ou traduisez-le à la main.";

/**
 * Le message d'une proposition dans les six langues : ce qui est proposé, ce
 * qui a échoué et pourquoi. `erreur` : rien n'a pu être proposé.
 */
export function messageDesPropositions(
  resultats: Record<string, ResultatLangue>,
  nom: (code: string) => string,
): { message: string; erreur: boolean } {
  const langues = Object.keys(resultats);
  if (!langues.length)
    return {
      message:
        "Rien à proposer : dans les six langues, les champs dont le français existe sont déjà remplis.",
      erreur: false,
    };
  const proposees = langues.filter((l) => Object.keys(resultats[l]!.propositions).length);
  const echecs = langues.filter((l) => resultats[l]!.erreur);
  const tropLong = langues.some((l) => resultats[l]!.tropLong);
  const raisons = [...new Set(echecs.map((l) => resultats[l]!.erreur!))];
  /** « : la raison. » quand elle est la même partout, sinon langue par langue. */
  const pourquoi =
    raisons.length === 1
      ? ` : ${finDePhrase(raisons[0]!)}`
      : ` (${echecs.map((l) => `en ${nom(l)} : ${resultats[l]!.erreur!.replace(/[.\s]+$/, "")}`).join(" ; ")}).`;
  const avertissement = tropLong ? ` ${AVERTISSEMENT_TROP_LONG}` : "";

  if (!proposees.length)
    return {
      message: echecs.length
        ? `Aucune traduction proposée${pourquoi}${avertissement}`
        : `Rien à proposer.${avertissement}`,
      erreur: echecs.length > 0,
    };

  let message =
    `Traductions proposées en ${enumerer(proposees.map(nom))}, pour les champs vides : ` +
    "relisez-les (encadrés jaunes), corrigez si besoin, puis cliquez « Enregistrer les traductions ». " +
    "Rien n'est enregistré pour l'instant.";
  if (echecs.length)
    message +=
      ` Pas de proposition complète en ${enumerer(echecs.map(nom))}${pourquoi}` +
      " Cliquez de nouveau « Proposer les traductions manquantes » pour compléter.";
  return { message: message + avertissement, erreur: false };
}

/** Une raison venue de l'API, terminée par un point. */
function finDePhrase(t: string): string {
  const propre = t.trim();
  return /[.!?…]$/.test(propre) ? propre : `${propre}.`;
}
