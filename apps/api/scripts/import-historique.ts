/**
 * Reprendre l'historique de l'ancienne boutique : les clientes et les commandes.
 *
 * Le catalogue est déjà repris — 177 affiches, dont 176 venues de Shopify.
 * Ce qui manque, c'est l'histoire : qui a acheté, quoi, et quand. Sans elle,
 * la nouvelle boutique s'ouvre avec zéro cliente et zéro vente, et tout ce qui
 * se calcule sur le passé (les fidèles, les inactives, le panier moyen, le
 * chiffre de l'an dernier) part de rien.
 *
 * L'import complet, lui, refait TOUT : catalogue compris, en effaçant d'abord.
 * Le lancer aujourd'hui écraserait les corrections faites depuis dans le
 * back-office. Ce script-ci ne touche qu'aux clientes et aux commandes.
 *
 * Il efface quand même ces deux tables-là avant d'écrire, parce que l'import
 * doit pouvoir se rejouer sans créer de doublons. C'est sans danger tant que
 * les commandes en base sont des essais, et c'est exactement pour cela qu'il
 * les compte et les affiche AVANT de faire quoi que ce soit : si de vraies
 * ventes sont déjà passées par la nouvelle boutique, il faut s'arrêter là et
 * reprendre l'historique autrement.
 *
 * Usage :
 *   1. Depuis l'administration Shopify, exporter Clients puis Commandes,
 *      « Toutes les fiches », au format CSV pour Excel.
 *   2. Déposer les deux fichiers tels quels, sous les noms « Customers.csv »
 *      et « Orders.csv », dans le dossier d'import.
 *   3. IMPORT_DIR=./data/exports/le-dossier pnpm --filter @memoryline/api run import:historique
 *      pour voir ce qui serait fait, puis ajouter --pour-de-bon pour l'écrire.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { db, schema, sql } from "../src/db/client.js";
import { IMPORT_DIR, readCsv, type ImportReport } from "./import/lib.js";
import { importCustomersAndOrders } from "./import/orders.js";

const POUR_DE_BON = process.argv.includes("--pour-de-bon");

function compter(fichier: string): number | null {
  const chemin = join(IMPORT_DIR, fichier);
  if (!existsSync(chemin)) return null;
  // Une lecture rapide juste pour compter : le vrai parseur passera après.
  const lignes = readCsv(fichier);
  return lignes.length;
}

async function main() {
  console.log(`▶ Reprise de l'historique depuis ${IMPORT_DIR}\n`);

  const clients = compter("Customers.csv");
  const commandes = compter("Orders.csv");

  if (clients === null || commandes === null) {
    console.error(
      "✖ Il manque un fichier. Ce script attend « Customers.csv » ET « Orders.csv »\n" +
        `  dans ${IMPORT_DIR}.\n\n` +
        "  Depuis l'administration Shopify : Clients → Exporter → Toutes les fiches,\n" +
        "  puis Commandes → Exporter → Toutes les commandes. Déposez les deux fichiers\n" +
        "  tels quels, sans les renommer ni les rouvrir dans Excel.",
    );
    process.exit(1);
  }

  if (clients === 0 || commandes === 0) {
    console.error(
      `✖ Les fichiers sont là mais vides : ${clients} cliente(s), ${commandes} ligne(s) de commande.\n` +
        "  C'est le cas des fichiers déjà présents dans le dépôt : ils n'ont jamais été remplis.\n" +
        "  Refaites l'export depuis Shopify en choisissant « Toutes les fiches ».",
    );
    process.exit(1);
  }

  const [avant] = await sql`
    select
      (select count(*)::int from "order") as commandes,
      (select count(*)::int from customer) as clients,
      (select count(*)::int from "order" where status = 'paid') as payees
  `;

  console.log("Ce qui est dans les fichiers :");
  console.log(`  • ${clients} cliente(s)`);
  console.log(`  • ${commandes} ligne(s) de commande`);
  console.log("\nCe qui est en base aujourd'hui, et qui sera REMPLACÉ :");
  console.log(`  • ${avant?.clients ?? 0} cliente(s)`);
  console.log(
    `  • ${avant?.commandes ?? 0} commande(s), dont ${avant?.payees ?? 0} payée(s)`,
  );

  if ((avant?.payees ?? 0) > 0) {
    console.log(
      "\n⚠ Des commandes PAYÉES existent déjà dans la nouvelle boutique.\n" +
        "  Si ce sont de vraies ventes, ne lancez pas ce script : il les effacerait.\n" +
        "  Si ce sont des essais, vous pouvez continuer.",
    );
  }

  if (!POUR_DE_BON) {
    console.log(
      "\nRien n'a été écrit. Relancez avec --pour-de-bon pour reprendre l'historique.",
    );
    process.exit(0);
  }

  const rapport: ImportReport = {};
  console.log("\n• Clientes et commandes…");
  await importCustomersAndOrders(rapport);

  const [apres] = await sql`
    select
      (select count(*)::int from "order") as commandes,
      (select count(*)::int from customer) as clients
  `;
  console.log("\n✓ Terminé.");
  console.log(`  • ${apres?.clients ?? 0} cliente(s) en base`);
  console.log(`  • ${apres?.commandes ?? 0} commande(s) en base`);
  console.log("\nDétail :", JSON.stringify(rapport, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error("✖ L'import a échoué. Rien n'est garanti écrit :", e);
  process.exit(1);
});
