/**
 * Le verrou des scripts qui VIDENT des tables.
 *
 * Quelques scripts d'import repartent d'une table vide : ils effacent le
 * catalogue, ou l'historique des commandes, ou les pièces des personnages,
 * avant de réinsérer ce que contient un export. C'est voulu — un import doit
 * pouvoir se rejouer — mais ils lisent `DATABASE_URL` sans jamais regarder
 * QUELLE base ils ont devant eux.
 *
 * Une variable d'environnement mal placée, un terminal ouvert sur le serveur,
 * et `pnpm import` efface le catalogue ET les commandes de la boutique, sans
 * archivage et sans retour. C'est le seul endroit du projet où une frappe
 * malheureuse détruit des ventes : la règle « rien ne se supprime » s'arrête
 * ici, et ce fichier est le garde-fou qui manquait.
 *
 * Le script annonce donc ce qu'il s'apprête à vider, sur quelle base, et
 * attend qu'on écrive le NOM DE LA BASE à la main. Sans terminal (tâche
 * planifiée, conteneur), la même confirmation se donne par la variable
 * `CONFIRMER_BASE`. Rien à retenir : le message affiche la phrase exacte.
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

/** Ce qu'on sait dire d'une adresse de base, sans jamais montrer son mot de passe. */
function baseVisee(): { hote: string; nom: string; adresse: string } {
  const brut = process.env.DATABASE_URL ?? "";
  if (!brut) return { hote: "(inconnue)", nom: "(inconnue)", adresse: "(aucune DATABASE_URL)" };
  try {
    const u = new URL(brut);
    const nom = decodeURIComponent(u.pathname.replace(/^\//, "")) || "(sans nom)";
    const hote = u.port ? `${u.hostname}:${u.port}` : u.hostname;
    return { hote, nom, adresse: `${hote}/${nom}` };
  } catch {
    // Adresse illisible : on ne devine pas, on montre ce qu'on a sans secret.
    return { hote: "(illisible)", nom: "(illisible)", adresse: "(DATABASE_URL illisible)" };
  }
}

/**
 * Demande confirmation avant de vider des tables. Sort du programme si la
 * réponse ne correspond pas — un script qui détruit ne continue jamais « au
 * cas où ».
 *
 * @param script  le nom que la boutiquière lit dans son terminal
 * @param efface  ce qui va être vidé, en français, table par table
 */
export async function confirmerAvantDeVider(
  script: string,
  efface: readonly string[],
): Promise<void> {
  const { nom, adresse } = baseVisee();

  console.log("");
  console.log(`⚠ ${script} va VIDER des tables avant de réimporter :`);
  for (const quoi of efface) console.log(`   • ${quoi}`);
  console.log("");
  console.log(`   Base visée : ${adresse}`);
  console.log("   Ces données ne partent PAS aux archives : elles sont perdues.");
  console.log("");

  const attendu = nom;
  const donnee = (process.env.CONFIRMER_BASE ?? "").trim();
  if (donnee) {
    if (donnee === attendu) return;
    console.error(
      `✗ CONFIRMER_BASE vaut « ${donnee} », mais la base visée s'appelle « ${attendu} ». Rien n'a été touché.`,
    );
    process.exit(1);
  }

  if (!stdin.isTTY) {
    console.error(
      `✗ Pas de terminal pour confirmer. Relancez avec CONFIRMER_BASE="${attendu}" si c'est bien la base à vider. Rien n'a été touché.`,
    );
    process.exit(1);
  }

  const lecture = createInterface({ input: stdin, output: stdout });
  const reponse = (
    await lecture.question(`Écrivez le nom de la base pour continuer (${attendu}) : `)
  ).trim();
  lecture.close();
  if (reponse !== attendu) {
    console.error("✗ Ce n'est pas le nom de la base. Rien n'a été touché.");
    process.exit(1);
  }
}
