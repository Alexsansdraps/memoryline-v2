/**
 * La recherche du haut, telle que le back-office la sert (SERVEUR seulement).
 *
 * Deux moitiés, interrogées EN MÊME TEMPS :
 *   - l'API cherche dans les DONNÉES : affiches, commandes, clientes, textes
 *     du site… (GET /admin/recherche) ;
 *   - le back-office cherche dans ses propres ÉCRANS et dans sa page d'aide,
 *     dont il lit le source (lib/index-ecrans.ts). L'API ne le peut pas : son
 *     image ne contient pas les sources du back-office.
 *
 * Le panneau du haut (/recherche.json) et la page complète (/recherche)
 * passent tous deux par rechercher() : une seule fusion, un seul ordre.
 *
 * Ce module importe le glob des sources (lib/sources-ecrans.ts) : il ne doit
 * jamais être importé par un <script> qui part au navigateur.
 */
import { adminApi } from "./api.ts";
import { MENU } from "./menu.ts";
import { SYNONYMES } from "./synonymes-ecrans.ts";
import { SOURCES_ECRANS } from "./sources-ecrans.ts";
import { chercherDansIndex, construireIndex, type IndexEcrans } from "./index-ecrans.ts";
import {
  GROUPES_API,
  ORDRE_GROUPES,
  RECHERCHE_LIMITE_MAX,
  RECHERCHE_LIMITE_PANNEAU,
  RECHERCHE_LONGUEUR_MAX,
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
const DELAI_API = 5000;

let index: IndexEcrans | null = null;

/**
 * L'index des écrans, calculé à la première recherche puis gardé en mémoire
 * (environ une demi-seconde, une fois). En développement, Vite recharge ce
 * module dès qu'un .astro change : l'index se refait tout seul.
 */
export function indexEcrans(): IndexEcrans {
  if (!index) index = construireIndex(SOURCES_ECRANS, MENU, SYNONYMES);
  return index;
}

/** La saisie ramenée par trim, coupée à 200 caractères sans couper un émoji. */
export function normaliserSaisie(saisie: string): string {
  let q = saisie.trim();
  if (q.length > RECHERCHE_LONGUEUR_MAX) {
    const code = q.charCodeAt(RECHERCHE_LONGUEUR_MAX - 1);
    q = q.slice(0, code >= 0xd800 && code <= 0xdbff ? RECHERCHE_LONGUEUR_MAX - 1 : RECHERCHE_LONGUEUR_MAX);
  }
  return q.trim();
}

/** Le paramètre « limite » : un entier ramené dans [1, 200], 5 à défaut. */
export function lireLimite(valeur: string | number | null | undefined, defaut = RECHERCHE_LIMITE_PANNEAU): number {
  const n = typeof valeur === "number" ? valeur : valeur ? Number.parseInt(valeur, 10) : Number.NaN;
  if (!Number.isFinite(n)) return defaut;
  return Math.min(RECHERCHE_LIMITE_MAX, Math.max(1, Math.trunc(n)));
}

const estGroupe = (id: string): id is GroupeId => (ORDRE_GROUPES as readonly string[]).includes(id);

/**
 * Le paramètre « groupes » (« affiches,ecrans »). Absent : undefined, tout est
 * cherché. Présent sans aucun id connu : une liste vide, rien n'est cherché —
 * un filtre mal écrit ne doit pas se changer en « tout ».
 */
export function lireGroupes(valeur: string | null | undefined): GroupeId[] | undefined {
  if (valeur === null || valeur === undefined) return undefined;
  return [...new Set(valeur.split(",").map((v) => v.trim()).filter(estGroupe))];
}

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

export async function rechercher(
  request: Request,
  saisie: string,
  options: { groupes?: GroupeId[]; limite?: number } = {},
): Promise<ReponseRecherche> {
  const q = normaliserSaisie(saisie);
  const limite = lireLimite(options.limite ?? null);
  const filtre = options.groupes ? options.groupes.filter((g) => estGroupe(g)) : null;
  const vide: ReponseRecherche = { q, groupes: [], corrections: [], partiel: false };
  if (q.length < RECHERCHE_MINIMUM) return vide;
  if (filtre && !filtre.length) return vide;

  const veut = (id: GroupeId) => !filtre || filtre.includes(id);
  const groupesApi = GROUPES_API.filter(veut);
  const avecIndex = veut("aide") || veut("ecrans");

  let partiel = false;
  const [api, bo] = await Promise.all([
    groupesApi.length
      ? avecDelai(
          adminApi(request).recherche({ q, groupes: filtre ? groupesApi : undefined, limite }),
          DELAI_API,
        ).catch((erreur: unknown) => {
          noter("api", erreur);
          partiel = true;
          return null;
        })
      : Promise.resolve(null),
    // L'index est en mémoire : l'appel est synchrone, mais il part dans la
    // même vague que l'API, et une erreur n'y emporte pas les données.
    avecIndex
      ? Promise.resolve()
          .then(() => chercherDansIndex(indexEcrans(), q, limite))
          .catch((erreur: unknown) => {
            noter("écrans", erreur);
            partiel = true;
            return null;
          })
      : Promise.resolve(null),
  ]);

  const groupes: GroupeRecherche[] = groupesValides(api?.groupes, groupesApi);
  if (bo?.aide && veut("aide")) groupes.push(bo.aide);
  if (bo?.ecrans && veut("ecrans")) groupes.push(bo.ecrans);
  groupes.sort((a, b) => ORDRE_GROUPES.indexOf(a.id) - ORDRE_GROUPES.indexOf(b.id));

  // Une exception à l'ordre fixe : quand ce qu'on tape est le NOM d'un écran
  // (« bandeau », « livr », « frais de port »), c'est lui qu'on cherche, et il
  // doit être le premier que la touche Entrée ouvre — devant les affiches qui
  // contiennent le mot dans leur description.
  const ecrans = groupes.find((g) => g.id === "ecrans");
  const premier = ecrans?.resultats[0];
  if (ecrans && premier && !premier.id.includes("§") && premier.rang <= 1) {
    groupes.splice(groupes.indexOf(ecrans), 1);
    groupes.unshift(ecrans);
  }

  const corrections: Correction[] = [];
  for (const c of [...(Array.isArray(api?.corrections) ? api.corrections : []), ...(bo?.corrections ?? [])])
    if (c && typeof c.tape === "string" && !corrections.some((x) => x.tape === c.tape)) corrections.push(c);

  return { q, groupes, corrections, partiel: partiel || api?.partiel === true };
}
