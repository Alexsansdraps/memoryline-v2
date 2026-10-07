/**
 * La fusion des deux moitiés de la recherche du haut : les DONNÉES (l'API) et
 * les ÉCRANS (l'index du back-office, lib/index-ecrans.ts).
 *
 * Module sans dépendance cachée : ni le glob des sources, ni le client de
 * l'API — on les lui passe (lib/recherche-bo.ts). C'est ce qui permet de
 * l'essayer avec une fausse API et le vrai index, sans session ni serveur.
 *
 * Ce qu'il tranche, et pourquoi :
 *
 *   - Chaque moitié a son VOCABULAIRE, donc ses « fautes de frappe ». Laissées
 *     seules, elles corrigeaient chacune ce que l'autre connaissait : l'API
 *     changeait « vidéo » en « vider » (l'écran Accueil et pied de page en
 *     parle), l'index changeait « montagne » en « montant » (huit affiches
 *     s'appellent ainsi), et le panneau annonçait « Résultats approchés »
 *     au-dessus de résultats trouvés tels quels. Désormais :
 *       · l'API reçoit les mots que les écrans connaissent (« connus ») et ne
 *         les corrige pas ;
 *       · l'index ne corrige pas un mot que les données ont trouvé tel quel :
 *         l'API a répondu, et ne l'a pas corrigé.
 *   - Le REPLI des écrans (corriger même un mot connu) ne part que si rien,
 *     ni données ni écrans, n'a été trouvé — l'API fait le sien de son côté.
 *   - Le groupe Écrans ne passe en tête (et ne prend donc la touche Entrée)
 *     que si son premier résultat est le NOM d'un écran qui répond mieux que
 *     les données — ou aussi bien, mais par son propre nom. « Paysage » ouvre
 *     ainsi le style IA de ce nom, et non l'écran des décors, qui n'a que le
 *     mot-clé « paysages » ; « bandeau » et « livr » ouvrent toujours l'écran.
 */
import {
  chercherDansIndex,
  motsConnusDesEcrans,
  type IndexEcrans,
  type ReponseIndex,
} from "./index-ecrans.ts";
import {
  GROUPES_API,
  ORDRE_GROUPES,
  RECHERCHE_LIMITE_MAX,
  RECHERCHE_LIMITE_PANNEAU,
  RECHERCHE_MINIMUM,
  type Correction,
  type GroupeId,
  type GroupeRecherche,
  type ReponseRecherche,
} from "@memoryline/types/recherche";

/**
 * Au-delà, on répond sans l'API. Le panneau se tape lettre par lettre : mieux
 * vaut les écrans tout de suite, et « une partie de la recherche n'a pas
 * répondu », qu'un panneau qui attend indéfiniment une base occupée.
 */
export const DELAI_API = 5000;

export interface DependancesFusion {
  /** GET /admin/recherche, avec la session de la requête entrante. */
  appelerApi: (p: {
    q: string;
    groupes?: readonly GroupeId[];
    limite: number;
    connus?: readonly string[];
  }) => Promise<ReponseRecherche>;
  /** L'index des écrans (construit une fois, gardé en mémoire). */
  index: () => IndexEcrans;
  /** Pour les essais seulement. */
  delaiApi?: number;
}

const estGroupe = (id: string): id is GroupeId => (ORDRE_GROUPES as readonly string[]).includes(id);

/** Une promesse qui abandonne au bout de `ms` millisecondes. */
async function avecDelai<T>(promesse: Promise<T>, ms: number): Promise<T> {
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  const delai = new Promise<never>((_, rejeter) => {
    minuteur = setTimeout(() => rejeter(new Error("délai dépassé")), ms);
  });
  try {
    return await Promise.race([promesse, delai]);
  } finally {
    clearTimeout(minuteur);
  }
}

/**
 * Le journal ne garde que le nom de l'erreur : un message d'erreur peut
 * embarquer la requête, donc ce qui a été tapé — le nom d'une cliente.
 */
function noter(source: string, erreur: unknown): void {
  const nom = erreur instanceof Error ? erreur.name : typeof erreur;
  console.error(`[recherche] ${source} : ${nom}`);
}

/** Ne garde que des groupes bien formés, attendus, et non vides. */
function groupesValides(groupes: unknown, permis: readonly GroupeId[]): GroupeRecherche[] {
  if (!Array.isArray(groupes)) return [];
  return groupes.filter(
    (g): g is GroupeRecherche =>
      !!g &&
      typeof g === "object" &&
      permis.includes((g as GroupeRecherche).id) &&
      Array.isArray((g as GroupeRecherche).resultats) &&
      (g as GroupeRecherche).resultats.length > 0,
  );
}

function correctionsValides(corrections: unknown): Correction[] {
  if (!Array.isArray(corrections)) return [];
  return corrections.filter(
    (c): c is Correction =>
      !!c && typeof c === "object" && typeof (c as Correction).tape === "string" && typeof (c as Correction).propose === "string",
  );
}

/**
 * `q` : la saisie déjà ramenée par trim et coupée à 200 (normaliserSaisie).
 * `limite` : déjà ramenée dans [1, 200].
 */
export async function fusionnerRecherche(
  dep: DependancesFusion,
  q: string,
  options: { groupes?: readonly GroupeId[]; limite?: number } = {},
): Promise<ReponseRecherche> {
  const limite = Math.min(RECHERCHE_LIMITE_MAX, Math.max(1, Math.trunc(options.limite ?? RECHERCHE_LIMITE_PANNEAU)));
  const filtre = options.groupes ? options.groupes.filter((g) => estGroupe(g)) : null;
  const vide: ReponseRecherche = { q, groupes: [], corrections: [], partiel: false };
  if (q.length < RECHERCHE_MINIMUM) return vide;
  if (filtre && !filtre.length) return vide;

  const veut = (id: GroupeId) => !filtre || filtre.includes(id);
  const groupesApi = GROUPES_API.filter(veut);
  const avecIndex = veut("aide") || veut("ecrans");

  let partiel = false;
  // L'index d'abord : il est en mémoire (quelques millisecondes), et il dit
  // quels mots les écrans connaissent — ceux que l'API ne doit pas corriger.
  let index: IndexEcrans | null = null;
  try {
    index = dep.index();
  } catch (erreur) {
    noter("écrans", erreur);
    partiel = true;
  }
  const connus = index ? motsConnusDesEcrans(index, q) : [];

  const [api, premiere] = await Promise.all([
    groupesApi.length
      ? avecDelai(
          dep.appelerApi({ q, groupes: filtre ? groupesApi : undefined, limite, connus }),
          dep.delaiApi ?? DELAI_API,
        ).catch((erreur: unknown) => {
          noter("api", erreur);
          partiel = true;
          return null;
        })
      : Promise.resolve(null),
    // L'appel est synchrone, mais il part dans la même vague que l'API, et
    // une erreur n'y emporte pas les données.
    avecIndex && index
      ? Promise.resolve(index)
          .then((i) => chercherDansIndex(i, q, limite))
          .catch((erreur: unknown) => {
            noter("écrans", erreur);
            partiel = true;
            return null;
          })
      : Promise.resolve(null),
  ]);

  const donnees = groupesValides(api?.groupes, groupesApi);
  const correctionsApi = correctionsValides(api?.corrections);
  let ecransEtAide: ReponseIndex | null = premiere;

  if (index && avecIndex && ecransEtAide) {
    try {
      // Les mots que l'index a corrigés alors que les données les ont
      // trouvés TELS QUELS : l'API a répondu — chaque résultat contient tous
      // les mots tapés — sans les corriger. On recherche sans les corriger.
      const corrigesParApi = new Set(correctionsApi.map((c) => c.tape));
      const tels = donnees.length
        ? ecransEtAide.corrections.map((c) => c.tape).filter((m) => !corrigesParApi.has(m))
        : [];
      if (tels.length) ecransEtAide = chercherDansIndex(index, q, limite, { connus: new Set(tels) });

      // Le repli : rien nulle part. On corrige alors même les mots que les
      // écrans connaissent (voir OptionsRequete.forcer).
      if (!donnees.length && !ecransEtAide.ecrans && !ecransEtAide.aide)
        ecransEtAide = chercherDansIndex(index, q, limite, { forcer: true });
    } catch (erreur) {
      noter("écrans", erreur);
      partiel = true;
    }
  }

  const groupes: GroupeRecherche[] = [...donnees];
  if (ecransEtAide?.aide && veut("aide")) groupes.push(ecransEtAide.aide);
  if (ecransEtAide?.ecrans && veut("ecrans")) groupes.push(ecransEtAide.ecrans);
  groupes.sort((a, b) => ORDRE_GROUPES.indexOf(a.id) - ORDRE_GROUPES.indexOf(b.id));

  // Une exception à l'ordre fixe : quand ce qu'on tape est le NOM d'un écran
  // (« bandeau », « livr », « frais de port »), c'est lui qu'on cherche, et il
  // doit être le premier que la touche Entrée ouvre — devant les affiches qui
  // contiennent le mot dans leur description. Mais pas devant une donnée qui
  // répond MIEUX : « Paysage » est le nom exact d'un style IA, l'écran des
  // décors n'a que le mot-clé « paysages ».
  const ecrans = groupes.find((g) => g.id === "ecrans");
  const premier = ecrans?.resultats[0];
  if (ecrans && premier && !premier.id.includes("§") && premier.rang <= 1) {
    let meilleurDesDonnees = 4;
    for (const g of donnees) for (const r of g.resultats) meilleurDesDonnees = Math.min(meilleurDesDonnees, r.rang);
    const mieux = premier.rang < meilleurDesDonnees;
    const aussiBienParSonNom = premier.rang === meilleurDesDonnees && !!ecransEtAide?.premierParSonNom;
    if (mieux || aussiBienParSonNom) {
      groupes.splice(groupes.indexOf(ecrans), 1);
      groupes.unshift(ecrans);
    }
  }

  const corrections: Correction[] = [];
  for (const c of [...correctionsApi, ...(ecransEtAide?.corrections ?? [])])
    if (!corrections.some((x) => x.tape === c.tape)) corrections.push(c);

  return { q, groupes, corrections, partiel: partiel || api?.partiel === true };
}
