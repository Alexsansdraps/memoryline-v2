/**
 * Crée (ou met à jour le mot de passe d') un compte admin.
 * Usage :
 *   pnpm --filter @memoryline/api run create-admin -- <email> <motdepasse>
 * À défaut d'arguments, utilise ADMIN_EMAIL / ADMIN_PASSWORD de l'env.
 */
import { eq } from "drizzle-orm";
import { sql, db, schema } from "../src/db/client.js";
import { hashPassword } from "../src/auth.js";

async function main() {
  const email = (process.argv[2] ?? process.env.ADMIN_EMAIL ?? "").toLowerCase();
  const password = process.argv[3] ?? process.env.ADMIN_PASSWORD ?? "";
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
      .set({ passwordHash })
      .where(eq(schema.adminUsers.id, existing[0].id));
    console.log(`✓ Mot de passe mis à jour pour ${email}`);
  } else {
    await db
      .insert(schema.adminUsers)
      .values({ email, passwordHash, role: "owner" });
    console.log(`✓ Compte admin créé : ${email}`);
  }
  await sql.end();
}

main().catch(async (e) => {
  console.error("✗", e);
  await sql.end();
  process.exit(1);
});
