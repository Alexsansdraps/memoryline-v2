import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL manquant (voir .env / .env.example)");
}

/** Client postgres-js partagé. `max:1` pour les scripts (migrate/import). */
export const sql = postgres(connectionString, { max: 10 });
export const db = drizzle(sql, { schema });
export { schema };
