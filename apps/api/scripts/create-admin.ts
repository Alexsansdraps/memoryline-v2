/**
 * Crée (ou met à jour le mot de passe d') un compte admin.
 * Usage (arguments SANS `--`, que pnpm transmettrait au script) :
 *   pnpm --filter @memoryline/api run create-admin <email> <motdepasse> [role]
 * À défaut d'arguments : ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_ROLE.
 *
 * Rôles : « owner » (tous droits) ou « seller » (lecture seule : commandes,
 * catalogue, PDF d'impression — aucune modification possible).
 */
import { eq } from "drizzle-orm";
import { sql, db, schema } from "../src/db/client.js";
import { hashPassword } from "../src/auth.js";

async function main() {
  const email = (process.argv[2] ?? process.env.ADMIN_EMAIL ?? "").toLowerCase();
  const password = process.argv[3] ?? process.env.ADMIN_PASSWORD ?? "";
  const role = (process.argv[4] ?? process.env.ADMIN_ROLE ?? "owner").toLowerCase();
  if (role !== "owner" && role !== "seller") {
    console.error(`Rôle inconnu : ${role} (attendu « owner » ou « seller »)`);
    process.exit(1);
  }
  if (!email || !password) {
    console.error(
      "Usage: create-admin -- <email> <motdepasse>  (ou ADMIN_EMAIL/ADMIN_PASSWORD)",
    );
    process.exit(1);
  }
  const passwordHash = await hashPassword(password);
  const existing = await db
    .select({ id: schema.adminUsers.id })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.email, email));

  if (existing[0]) {
    await db
      .update(schema.adminUsers)
      .set({ passwordHash, role })
      .where(eq(schema.adminUsers.id, existing[0].id));
    console.log(`✓ Mot de passe mis à jour pour ${email} (rôle ${role})`);
  } else {
    await db.insert(schema.adminUsers).values({ email, passwordHash, role });
    console.log(`✓ Compte créé : ${email} (rôle ${role})`);
  }
  await sql.end();
}

main().catch(async (e) => {
  console.error("✗", e);
  await sql.end();
  process.exit(1);
});
