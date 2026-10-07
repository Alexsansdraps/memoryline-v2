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
 * Chaque moitié a son vocabulaire, et donc ses fautes de frappe. La fusion
 * (fusionnerRecherche) veille à ce qu'aucune ne « corrige » un mot que
 * l'autre a trouvé tel quel.
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
import { construireIndex, type IndexEcrans } from "./index-ecrans.ts";
import { fusionnerRecherche } from "./fusion-recherche.ts";
import {
  ORDRE_GROUPES,
  RECHERCHE_LIMITE_MAX,
  RECHERCHE_LIMITE_PANNEAU,
  RECHERCHE_LONGUEUR_MAX,
  type GroupeId,
  type ReponseRecherche,
} from "@memoryline/types/recherche";

let index: IndexEcrans | null = null;

/**
 * L'index des écrans, calculé une fois puis gardé en mémoire (environ une
 * demi-seconde). Le middleware le fait construire juste après la première
 * page servie (prechargerIndexEcrans) : ce n'est donc pas la première
 * recherche qui le paie. En développement, Vite recharge ce module dès qu'un
 * .astro change : l'index se refait tout seul.
 */
export function indexEcrans(): IndexEcrans {
  if (!index) index = construireIndex(SOURCES_ECRANS, MENU, SYNONYMES);
  return index;
}

/** Construit l'index sans rien attendre ; une erreur ici sera revue à la première recherche. */
export function prechargerIndexEcrans(): void {
  try {
    indexEcrans();
  } catch {
    /* la première recherche réessaiera, et le dira (« partiel ») */
  }
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

export async function rechercher(
  request: Request,
  saisie: string,
  options: { groupes?: GroupeId[]; limite?: number } = {},
): Promise<ReponseRecherche> {
  const api = adminApi(request);
  return fusionnerRecherche(
    {
      appelerApi: (p) => api.recherche(p),
      index: () => indexEcrans(),
    },
    normaliserSaisie(saisie),
    {
      groupes: options.groupes,
      limite: lireLimite(options.limite ?? null),
    },
  );
}
