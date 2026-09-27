/**
 * Le rangement PRIVÉ : les fichiers que personne ne doit pouvoir ouvrir en
 * devinant leur nom.
 *
 * POURQUOI UN DOSSIER SŒUR DE data/assets, ET SURTOUT PAS UN DOSSIER FILS.
 * `GET /assets/:file` (index.ts) sert data/assets à plat, SANS session : il
 * suffit de connaître le nom d'un fichier pour l'obtenir. C'est voulu — ce
 * sont des visuels de catalogue, faits pour être vus. Un bordereau, lui,
 * porte l'adresse postale d'une cliente et un code-barres payé. Le ranger
 * sous data/assets, même dans un sous-dossier, le mettrait à une URL publique
 * le jour où quelqu'un ajoutera une route qui sert les sous-dossiers — ou
 * simplement par distraction. Ici, AUCUNE route ne sert ce dossier : le seul
 * chemin qui y mène passe par une session vérifiée.
 *
 * Et pas data/assets/cache non plus, pour la raison inverse : ce dossier-là
 * est exclu de la sauvegarde et purgé à soixante jours. Un bordereau déposé
 * ne se recalcule pas — il a été acheté une fois, chez un transporteur, et
 * rien dans la boutique ne saurait le refabriquer. Il lui fallait le premier
 * emplacement à la fois DURABLE et AUTHENTIFIÉ du projet : c'est celui-ci.
 *
 * Deux sous-dossiers, deux régimes de sauvegarde opposés (voir
 * scripts/sauvegarder.sh) :
 *
 *   bordereaux/  copié à chaque sauvegarde — un fichier perdu est perdu ;
 *   secrets/     JAMAIS copié — un identifiant qui dépense de l'argent n'a
 *                rien à faire dans quatorze archives, et il se régénère en
 *                deux minutes chez le prestataire.
 *
 * En développement le dossier vit dans le dépôt, où Git l'ignore ; en
 * production il est monté depuis le serveur, à côté de data/assets.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Résolu comme ASSETS_DIR l'est dans index.ts : un chemin absolu, sans dépendre du cwd. */
export const DOSSIER_PRIVE = resolve(fileURLToPath(import.meta.url), "../../../../data/prive");

/** Les PDF d'étiquettes. Durables, sauvegardés, servis par la seule route authentifiée. */
export const DOSSIER_BORDEREAUX = resolve(DOSSIER_PRIVE, "bordereaux");

/**
 * Les identifiants que la boutique rejoue chez un prestataire, posés par
 * Alexandra elle-même depuis le back-office. Jamais sauvegardés, jamais
 * journalisés, jamais renvoyés par une route.
 */
export const DOSSIER_SECRETS = resolve(DOSSIER_PRIVE, "secrets");

/**
 * Le chemin d'un fichier privé, avec le garde-fou qui va avec.
 *
 * `basename()` neutralise toute traversée (« ../ »), comme le fait déjà la
 * route des visuels. Le nom vient certes de la base aujourd'hui, mais un
 * chemin construit à la main est exactement le détail qu'une route ajoutée un
 * soir oublie de vérifier.
 */
export function cheminPrive(dossier: string, nom: string): string {
  return resolve(dossier, basename(nom));
}

/**
 * Range un fichier, de façon qu'il soit entier ou absent — jamais entre les
 * deux.
 *
 * Écrit à côté puis renommé, le patron de fichiers-impression.ts : un
 * téléchargement qui lirait le fichier pendant son écriture recevrait sinon
 * un PDF tronqué, et le rename() est la seule opération que le système de
 * fichiers garantit indivisible.
 *
 * MAIS SANS SON REPLI SILENCIEUX, et c'est toute la différence. Là-bas, un
 * disque plein n'est qu'un `console.warn` : le PDF d'impression est en
 * mémoire, il se recalculera au prochain clic. Ici, il n'y a rien à
 * recalculer — un bordereau déposé a été acheté une fois chez un
 * transporteur. Un échec d'écriture doit donc remonter, faire échouer la
 * route, et n'écrire AUCUNE ligne en base : mieux vaut un dépôt à
 * recommencer qu'une commande qui promet une étiquette introuvable.
 */
export async function ranger(dossier: string, nom: string, contenu: Buffer): Promise<string> {
  const chemin = cheminPrive(dossier, nom);
  await mkdir(dossier, { recursive: true });
  const provisoire = `${chemin}.${process.pid}.tmp`;
  await writeFile(provisoire, contenu);
  await rename(provisoire, chemin);
  return chemin;
}

/**
 * Le contenu d'un fichier privé, ou null s'il n'y en a pas.
 *
 * Null plutôt qu'une exception : une ligne de bordereau survit toujours à son
 * fichier — jamais l'inverse —, et l'écran doit pouvoir dire « le fichier
 * n'est plus là » sans tomber.
 */
export async function lire(dossier: string, nom: string): Promise<Buffer | null> {
  try {
    return await readFile(cheminPrive(dossier, nom));
  } catch {
    return null;
  }
}
