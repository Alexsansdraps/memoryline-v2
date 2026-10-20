/**
 * La redirection 301 posée quand l'adresse d'une affiche change.
 *
 * L'adresse d'une affiche (/affiches/<identifiant>) est indexée par Google,
 * partagée par message, imprimée sur un QR code. La changer sans rien poser
 * derrière, c'est une page introuvable pour tous ceux qui la tenaient — et le
 * référencement acquis qui part avec. Jusqu'ici, ni la fiche ni la
 * modification groupée ne posaient quoi que ce soit : renommer cinquante
 * identifiants d'un coup aurait cassé cinquante liens en silence.
 *
 * Trois règles, toutes dans `planDesRedirections`, une fonction PURE que les
 * essais vérifient sans base (tests/redirections.test.ts) :
 *
 *   1. l'ancienne adresse mène à la nouvelle, en 301 — le code qui transfère
 *      le référencement ;
 *   2. UN SEUL SAUT : une redirection qui visait l'ancienne adresse vise
 *      désormais la nouvelle (A → B puis B → C donne A → C et B → C). Google
 *      ne transmet pas tout d'un saut à l'autre ;
 *   3. une redirection qui partirait de la NOUVELLE adresse est retirée :
 *      elle détournerait la fiche bien vivante qui vient de la reprendre
 *      (une affiche revenue à son ancien nom, par exemple). C'est aussi ce
 *      qui empêche toute boucle.
 *
 * Rien ne se supprime (« rien ne disparaît entièrement, ça sera de
 * l'archivage ») : une redirection remplacée ou retirée est ARCHIVÉE. Elle
 * ne s'applique plus (GET /redirects l'écarte), mais l'on sait toujours d'où
 * venait un lien, et quand il a cessé de servir. L'unicité de `from_path` ne
 * porte que sur les redirections vivantes : c'est ce qui permet de reposer
 * une redirection depuis une adresse dont l'ancienne a été archivée.
 *
 * Les chemins sont ceux du site SANS préfixe de langue, en minuscules et sans
 * barre finale : c'est ainsi que le site les compare (apps/web/src/middleware.ts),
 * et c'est lui qui ajoute la langue de la visiteuse.
 */
import { eq, inArray, sql as raw } from "drizzle-orm";
import { db, schema } from "./db/client.js";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Une redirection en vigueur, telle que le plan la lit. */
export interface RedirectionActive {
  id: number;
  fromPath: string;
  toPath: string;
}

/** Ce qu'il faut écrire pour qu'un changement d'adresse ne casse aucun lien. */
export interface PlanRedirections {
  /** Redirections qui cessent de s'appliquer (archivées, pas effacées). */
  archiver: number[];
  /** Redirections qui visaient l'ancienne adresse : elles visent la nouvelle. */
  repointer: { id: number; toPath: string }[];
  /** La redirection à poser, ou null quand l'adresse ne change pas. */
  poser: { fromPath: string; toPath: string; code: 301 } | null;
}

/** L'adresse publique d'une affiche, sans la langue. */
export function cheminAffiche(slug: string): string {
  return `/affiches/${slug}`;
}

/**
 * Un chemin comparable : sans requête ni ancre, en minuscules, sans barre
 * finale. La même règle que le site (middleware.ts, `normaliser`).
 */
export function normaliserChemin(chemin: string): string {
  const c = String(chemin ?? "").split("?")[0]!.split("#")[0]!.toLowerCase();
  return c.length > 1 ? c.replace(/\/+$/, "") || "/" : c;
}

/**
 * Le plan, sans rien écrire.
 *
 * `existantes` : les redirections EN VIGUEUR (non archivées). Celles qui ne
 * touchent ni l'ancienne ni la nouvelle adresse ne sont pas concernées.
 */
export function planDesRedirections(
  ancienSlug: string,
  nouveauSlug: string,
  existantes: readonly RedirectionActive[],
): PlanRedirections {
  const de = cheminAffiche(ancienSlug);
  const vers = cheminAffiche(nouveauSlug);
  const deN = normaliserChemin(de);
  const versN = normaliserChemin(vers);
  if (deN === versN) return { archiver: [], repointer: [], poser: null };

  const archiver: number[] = [];
  const repointer: { id: number; toPath: string }[] = [];
  for (const r of existantes) {
    const depuis = normaliserChemin(r.fromPath);
    // Partant de la nouvelle adresse : elle détournerait la fiche vivante.
    // Partant de l'ancienne : celle qu'on pose la remplace.
    if (depuis === versN || depuis === deN) {
      archiver.push(r.id);
      continue;
    }
    // Visant l'ancienne adresse : un seul saut, vers la nouvelle. Une
    // requête qu'elle portait (un suivi de campagne) la suit.
    if (normaliserChemin(r.toPath) === deN) {
      const i = r.toPath.search(/[?#]/);
      repointer.push({ id: r.id, toPath: vers + (i >= 0 ? r.toPath.slice(i) : "") });
    }
  }
  return { archiver, repointer, poser: { fromPath: de, toPath: vers, code: 301 } };
}

/**
 * Pose la redirection d'un changement d'adresse, dans la transaction de ce
 * changement : l'affiche renommée et le lien qui la suit s'écrivent ensemble,
 * ou pas du tout.
 *
 * Rend le plan appliqué, pour que l'écran puisse dire ce qui a été posé.
 */
export async function poserRedirection(
  tx: Transaction,
  ancienSlug: string,
  nouveauSlug: string,
): Promise<PlanRedirections> {
  const deN = normaliserChemin(cheminAffiche(ancienSlug));
  const versN = normaliserChemin(cheminAffiche(nouveauSlug));
  if (deN === versN) return { archiver: [], repointer: [], poser: null };

  // Seules les redirections vivantes qui touchent l'une des deux adresses :
  // la table entière n'a pas à traverser chaque ligne d'une modification
  // groupée. Le tri fin (barre finale, casse, requête) est celui du plan.
  const candidates = await tx
    .select({
      id: schema.redirects.id,
      fromPath: schema.redirects.fromPath,
      toPath: schema.redirects.toPath,
    })
    .from(schema.redirects)
    .where(
      raw`${schema.redirects.archivedAt} is null and (
        lower(${schema.redirects.fromPath}) like ${`${deN}%`}
        or lower(${schema.redirects.fromPath}) like ${`${versN}%`}
        or lower(${schema.redirects.toPath}) like ${`${deN}%`}
      )`,
    );

  const plan = planDesRedirections(ancienSlug, nouveauSlug, candidates);
  if (plan.archiver.length)
    await tx
      .update(schema.redirects)
      .set({ archivedAt: new Date() })
      .where(inArray(schema.redirects.id, plan.archiver));
  for (const r of plan.repointer)
    await tx
      .update(schema.redirects)
      .set({ toPath: r.toPath })
      .where(eq(schema.redirects.id, r.id));
  if (plan.poser) await tx.insert(schema.redirects).values(plan.poser);
  return plan;
}

/**
 * Les redirections à retirer quand une affiche NAÎT à une adresse : celles
 * qui en partent. Fonction pure, comme le plan.
 *
 * C'est la règle 3 du plan, pour une création : renommer « colmar » en
 * « colmar-cathedrale » pose colmar → colmar-cathedrale, et l'adresse
 * « colmar » redevient libre dans la table des affiches. Une affiche créée,
 * dupliquée ou importée sous ce nom la reprend… mais le site applique la
 * redirection AVANT d'afficher la page (apps/web/src/middleware.ts) : la
 * nouvelle affiche serait introuvable, renvoyée en silence vers l'autre. La
 * fiche vivante l'emporte toujours sur un lien ancien.
 */
export function redirectionsALiberer(
  slug: string,
  existantes: readonly RedirectionActive[],
): number[] {
  const ici = normaliserChemin(cheminAffiche(slug));
  return existantes
    .filter((r) => normaliserChemin(r.fromPath) === ici)
    .map((r) => r.id);
}

/** Ce qui sait lire et modifier la table : la base, ou une transaction. */
type Ecrivain = Pick<typeof db, "select" | "update">;

/**
 * Archive (sans rien effacer) les redirections vivantes qui partent de
 * l'adresse d'une affiche qui vient de naître. À appeler juste après
 * l'insertion, dans sa transaction quand il y en a une : création au BO,
 * duplication, import.
 */
export async function libererAdresse(
  ecrivain: Ecrivain,
  slug: string,
): Promise<number[]> {
  const ici = normaliserChemin(cheminAffiche(slug));
  const candidates = await ecrivain
    .select({
      id: schema.redirects.id,
      fromPath: schema.redirects.fromPath,
      toPath: schema.redirects.toPath,
    })
    .from(schema.redirects)
    .where(
      raw`${schema.redirects.archivedAt} is null and lower(${schema.redirects.fromPath}) like ${`${ici}%`}`,
    );
  const ids = redirectionsALiberer(slug, candidates);
  if (ids.length)
    await ecrivain
      .update(schema.redirects)
      .set({ archivedAt: new Date() })
      .where(inArray(schema.redirects.id, ids));
  return ids;
}

/**
 * La version de la table, pour que le site voie tout de suite ce qui change.
 *
 * Le site garde les redirections en mémoire (apps/web/src/middleware.ts) :
 * sans cela, chaque page paierait une lecture de la table. Mais une
 * redirection saisie au back-office doit s'appliquer dès qu'on l'essaie, et
 * pas cinq minutes plus tard, quand on a déjà conclu qu'elle ne marchait pas.
 * Le site demande donc cette version — un compteur en mémoire, sans base —
 * deux secondes au plus après la précédente, et ne relit la table que
 * lorsqu'elle a changé.
 *
 * Elle change à chaque écriture réussie du back-office (index.ts, juste après
 * la garde), et pas seulement depuis BO › Redirections : la fiche d'une
 * affiche, la modification groupée, la duplication et l'import posent ou
 * archivent aussi des redirections. Énumérer ces routes laisserait passer la
 * prochaine ; relire quelques centaines de lignes après un enregistrement ne
 * coûte rien. L'heure du démarrage en fait partie : une API relancée repart
 * d'une version que le site n'a jamais vue.
 */
const DEMARRAGE = Date.now().toString(36);
let ecritures = 0;

export function versionDesRedirections(): string {
  return `${DEMARRAGE}.${ecritures}`;
}

/** Une écriture du back-office a peut-être touché la table : le site la relira. */
export function redirectionsPeutEtreChangees(): void {
  ecritures += 1;
}
