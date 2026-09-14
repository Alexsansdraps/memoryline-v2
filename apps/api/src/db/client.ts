import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL manquant (voir .env / .env.example)");
}

/**
 * Client postgres-js partagé.
 *
 * `search_path` est DEMANDÉ EXPLICITEMENT à l'ouverture de chaque connexion.
 *
 * Les tables sont nommées sans schéma (« product », pas « public.product ») :
 * c'est la façon de faire de Drizzle, et elle suppose que `public` figure
 * dans le chemin de recherche. Un projet Neon récent arrive avec un chemin
 * VIDE, et toutes les requêtes échouent alors sur « relation "product" does
 * not exist » — pour une table qui existe pourtant.
 *
 * Le régler sur la base ou sur le rôle ne suffit pas quand la connexion passe
 * par le pooler : celui-ci réinitialise les réglages de session entre deux
 * transactions. Demandé ici, il part avec chaque connexion, pooler ou non.
 */
export const sql = postgres(connectionString, {
  max: 10,
  connection: { search_path: "public" },
});
export const db = drizzle(sql, { schema });
export { schema };
