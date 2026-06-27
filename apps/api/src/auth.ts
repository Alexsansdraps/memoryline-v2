/**
 * Authentification back-office : sessions par cookie httpOnly.
 * Implémentation directe (scrypt natif + tokens aléatoires), sans dépendance
 * externe — l'approche recommandée aujourd'hui (Lucia v3 étant en maintenance).
 *
 * - Mot de passe : scrypt(password, salt) — stocké "scrypt:<salt>:<hash>".
 * - Session : token aléatoire (32 octets) ; on stocke son SHA-256 en base,
 *   jamais le token brut → une fuite de la table session ne donne pas les cookies.
 */
import { scrypt, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { eq, lt } from "drizzle-orm";
import { db, schema } from "./db/client.js";

const scryptAsync = promisify(scrypt);

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 jours
export const SESSION_COOKIE = "ml_admin_session";

// --- Mots de passe --------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hashHex] = parts;
  const derived = (await scryptAsync(password, salt!, 64)) as Buffer;
  const expected = Buffer.from(hashHex!, "hex");
  return (
    derived.length === expected.length && timingSafeEqual(derived, expected)
  );
}

// --- Sessions -------------------------------------------------------------

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(adminUserId: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const id = hashToken(token);
  await db.insert(schema.sessions).values({
    id,
    adminUserId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return token; // le token brut part dans le cookie ; la base ne stocke que son hash
}

export interface SessionUser {
  sessionId: string;
  adminUserId: number;
  email: string;
  role: string;
}

export async function validateSession(
  token: string | undefined,
): Promise<SessionUser | null> {
  if (!token) return null;
  const id = hashToken(token);
  const rows = await db
    .select({
      sId: schema.sessions.id,
      expiresAt: schema.sessions.expiresAt,
      adminUserId: schema.adminUsers.id,
      email: schema.adminUsers.email,
      role: schema.adminUsers.role,
    })
    .from(schema.sessions)
    .innerJoin(
      schema.adminUsers,
      eq(schema.sessions.adminUserId, schema.adminUsers.id),
    )
    .where(eq(schema.sessions.id, id));
  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, id));
    return null;
  }
  return {
    sessionId: row.sId,
    adminUserId: row.adminUserId,
    email: row.email,
    role: row.role,
  };
}

export async function deleteSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await db.delete(schema.sessions).where(eq(schema.sessions.id, hashToken(token)));
}

/** Purge des sessions expirées (à appeler au login, best effort). */
export async function purgeExpiredSessions(): Promise<void> {
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()));
}
