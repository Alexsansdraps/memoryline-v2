/**
 * La suppression DÉFINITIVE, en plus de l'archivage.
 *
 * Jusqu'au 8/11, la règle était « rien ne se supprime, on archive ». La
 * boutique voulait pouvoir faire le ménage pour de bon (« pouvoir aussi
 * supprimer, pas seulement archiver — donc il y a l'archive et l'état
 * supprimé pour toujours, tant pis », Alexandra, 8/11). La règle devient :
 *
 *   1. on archive d'abord : c'est réversible, et c'est le seul geste offert
 *      sur un élément en service ;
 *   2. un élément ARCHIVÉ peut ensuite être supprimé définitivement, après
 *      confirmation. Un élément qui n'est pas archivé est refusé (409) : on ne
 *      fait pas disparaître d'un clic ce que le site montre encore ;
 *   3. ce qui sert encore ailleurs n'est PAS supprimé : la base le refuse
 *      (clé étrangère, code 23503) ou la route le vérifie avant (une commande
 *      qu'il faudrait réimprimer), et la réponse dit pourquoi, en clair. Il
 *      reste archivé, rien n'est perdu.
 *
 * Chaque route `DELETE /admin/…/:id` passe par `supprimerPourToujours` : les
 * trois règles vivent ici, une seule fois.
 */
import type { Context } from "hono";

/** Le code d'un refus « encore utilisé », que le back-office sait lire. */
export const CODE_ENCORE_UTILISE = "encore_utilise";
/** Le code d'un refus « pas archivé ». */
export const CODE_PAS_ARCHIVE = "pas_archive";

/** Le code PostgreSQL d'une erreur, qu'il soit sur l'erreur ou sur sa cause (Drizzle l'enveloppe). */
function codePostgres(e: unknown): string | undefined {
  const x = e as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = x?.code ?? x?.cause?.code;
  return typeof code === "string" ? code : undefined;
}

/** Vrai pour le refus d'une clé étrangère : une autre ligne pointe encore vers celle-ci. */
export function estEncoreReference(e: unknown): boolean {
  return codePostgres(e) === "23503";
}

export interface Suppression<L> {
  /** L'élément, lu en base ; null s'il n'existe pas (→ 404). */
  lire: () => Promise<L | null>;
  /** Vrai s'il est archivé — seul un élément archivé se supprime. */
  estArchive: (ligne: L) => boolean;
  /**
   * Ce qui empêche la suppression alors que la base ne le saurait pas (une
   * commande qui garde l'adresse d'un fichier, par exemple) : la phrase à
   * montrer, ou null si rien ne s'y oppose.
   */
  empeche?: (ligne: L) => Promise<string | null>;
  /** La suppression elle-même, avec ce qui part avec elle. */
  supprimer: (ligne: L) => Promise<void>;
  /** Ce qui sert encore, quand la base refuse : « des commandes », « des fiches »… */
  utilisePar?: string;
}

/**
 * Supprime définitivement un élément archivé, selon les trois règles
 * ci-dessus, et répond au back-office.
 */
export async function supprimerPourToujours<L>(
  c: Context,
  s: Suppression<L>,
): Promise<Response> {
  const ligne = await s.lire();
  if (!ligne) return c.notFound();
  if (!s.estArchive(ligne))
    return c.json(
      {
        error: "Archivez-le d'abord : seul un élément archivé peut être supprimé définitivement.",
        code: CODE_PAS_ARCHIVE,
      },
      409,
    );
  const raison = s.empeche ? await s.empeche(ligne) : null;
  if (raison) return c.json({ error: raison, code: CODE_ENCORE_UTILISE }, 409);
  try {
    await s.supprimer(ligne);
  } catch (e) {
    if (!estEncoreReference(e)) throw e;
    return c.json(
      {
        error: `Impossible de le supprimer : ${s.utilisePar ?? "d'autres éléments"} s'en servent encore. Il reste archivé.`,
        code: CODE_ENCORE_UTILISE,
      },
      409,
    );
  }
  return c.json({ ok: true, supprime: true });
}
