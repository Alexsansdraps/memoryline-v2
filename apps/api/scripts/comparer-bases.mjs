/**
 * Compare deux bases, table par table, et dit si elles sont identiques.
 *
 * À lancer APRÈS `deplacer-base.sh`, avant de changer `DATABASE_URL`. Une
 * copie qui s'est arrêtée au milieu ressemble à une copie réussie tant qu'on
 * n'a pas compté : la restauration crée les tables d'abord, les remplit
 * ensuite, et une erreur en cours de route laisse des tables vides.
 *
 * Les deux adresses se lisent dans des fichiers, jamais sur la ligne de
 * commande : elles contiennent le mot de passe de la base.
 *
 * Usage, depuis la racine du dépôt :
 *   node apps/api/scripts/comparer-bases.mjs nouvelle-url.txt
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";

const fichier = process.argv[2];
if (!fichier) {
  console.error("Usage : node apps/api/scripts/comparer-bases.mjs nouvelle-url.txt");
  process.exit(1);
}

const propre = (v) => String(v ?? "").trim().replace(/^"|"$/g, "");
const ancienne = propre(
  readFileSync(".env", "utf8")
    .split("\n")
    .find((l) => l.startsWith("DATABASE_URL="))
    ?.slice("DATABASE_URL=".length),
);
const nouvelle = propre(readFileSync(fichier, "utf8").split("\n")[0]);

if (!ancienne || !nouvelle) {
  console.error("Une des deux adresses est vide.");
  process.exit(1);
}

/** Le nombre de lignes de chaque table, dans l'ordre alphabétique. */
async function compter(url) {
  const sql = postgres(url, { ssl: "require" });
  try {
    const tables = await sql`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name`;
    const out = new Map();
    for (const t of tables) {
      // Le schéma est ÉCRIT : un projet Neon récent arrive avec un
      // `search_path` vide, et un nom de table seul n'y est pas résolu —
      // « relation "admin_user" does not exist » alors qu'elle existe.
      const [r] = await sql.unsafe(
        `select count(*)::int as n from "public"."${t.table_name}"`,
      );
      out.set(t.table_name, r.n);
    }
    return out;
  } finally {
    await sql.end();
  }
}

const [avant, apres] = await Promise.all([compter(ancienne), compter(nouvelle)]);

const noms = [...new Set([...avant.keys(), ...apres.keys()])].sort();
let ecarts = 0;
let lignes = 0;

console.log("%s %s %s", "TABLE".padEnd(26), "ANCIENNE".padStart(9), "NOUVELLE".padStart(9));
for (const nom of noms) {
  const a = avant.get(nom);
  const b = apres.get(nom);
  lignes += a ?? 0;
  const identique = a === b;
  if (!identique) ecarts++;
  // Seules les tables qui diffèrent, ou qui contiennent quelque chose,
  // méritent une ligne : quarante tables vides n'apprennent rien.
  if (!identique || (a ?? 0) > 0)
    console.log(
      "%s %s %s %s",
      nom.padEnd(26),
      String(a ?? "absente").padStart(9),
      String(b ?? "absente").padStart(9),
      identique ? "" : "  ← DIFFÉRENT",
    );
}

console.log();
console.log("tables comparées :", noms.length, "| lignes dans l'ancienne :", lignes);
if (ecarts) {
  console.error(`✗ ${ecarts} table(s) diffèrent. NE CHANGEZ PAS encore DATABASE_URL.`);
  process.exit(1);
}
console.log("✓ Les deux bases contiennent exactement les mêmes lignes.");
