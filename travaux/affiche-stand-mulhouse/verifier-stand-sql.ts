/**
 * G10 sans le back-office et SANS RIEN ÉCRIRE : la condition SQL exacte des
 * listes (`enVente()`, affiches-de-stand.ts), jouée contre des stands
 * « désactivé », « archivé », « supprimé » et « terminé ».
 *
 * Aucune mise à jour, aucune transaction : la requête est une simple lecture,
 * précédée d'un `WITH "stand" AS (…)` qui MASQUE la vraie table le temps de
 * la requête (la condition cite « stand » sans schéma). La vraie ligne du
 * stand n'est jamais touchée.
 *
 * docker exec -w /app/apps/api memoryline-api npx tsx /app/travaux/affiche-stand-mulhouse/verifier-stand-sql.ts <id produit de stand> <id affiche classique>
 */
import { db, schema, sql as client } from "../../apps/api/src/db/client.js";
import { enVente } from "../../apps/api/src/affiches-de-stand.js";

const [produit, classique] = process.argv.slice(2).map(Number);
if (!Number.isInteger(produit) || !Number.isInteger(classique)) {
  console.error("usage : verifier-stand-sql.ts <id produit de stand> <id affiche classique>");
  process.exit(1);
}

const requete = db
  .select({ id: schema.products.id })
  .from(schema.products)
  // Pas de paquet nu depuis travaux/ (drizzle-orm ne s'y trouverait pas) :
  // toutes les affiches en vente, le tri se fait ensuite.
  .where(enVente())
  .toSQL();
console.log("condition jouée :", requete.sql.replace(/\s+/g, " ").slice(0, 400), "…");

// Les colonnes que la condition lit, et rien d'autre.
const colonnes = `id, actif, archived_at, date_fin`;
const scenarios: [string, string, boolean][] = [
  ["stand réel (en service)", `select ${colonnes} from public.stand`, true],
  ["stand désactivé", `select id, false as actif, archived_at, date_fin from public.stand`, false],
  ["stand archivé", `select id, actif, now() as archived_at, date_fin from public.stand`, false],
  ["stand supprimé", `select ${colonnes} from public.stand where false`, false],
  ["dernier jour passé (hier)", `select id, actif, archived_at, to_char(now() - interval '1 day', 'YYYY-MM-DD') as date_fin from public.stand`, false],
  ["dernier jour aujourd'hui", `select id, actif, archived_at, to_char(now(), 'YYYY-MM-DD') as date_fin from public.stand`, true],
  ["stand fermé (ouvert = faux)", `select ${colonnes} from public.stand`, true],
];
let ecarts = 0;
for (const [nom, cte, attendu] of scenarios) {
  const lignes = (await client.unsafe(`with "stand" as (${cte}) ${requete.sql}`, requete.params as never[])) as { id: number }[];
  const ids = lignes.map((l) => l.id);
  const vue = ids.includes(produit);
  const ok = vue === attendu && ids.includes(classique);
  if (!ok) ecarts++;
  console.log(`${ok ? "ok  " : "FAUX"} ${nom} : affiche de stand ${vue ? "proposée" : "cachée"} (attendu ${attendu ? "proposée" : "cachée"}), affiche classique ${ids.includes(classique) ? "proposée" : "CACHÉE"}`);
}
console.log(ecarts ? `${ecarts} écart(s)` : "tout est conforme");
process.exit(ecarts ? 1 : 0);
