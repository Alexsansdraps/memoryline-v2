/**
 * « Continuer avec Google » (18/11, préparé : Alexandra, « on va le faire mais
 * Margaux doit faire le truc avant »).
 *
 * EN SOMMEIL tant que l'identifiant client n'est pas posé : sans
 * GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET dans le .env du serveur (Alexandra
 * les y met elle-même, le code secret ne passe par aucune conversation),
 * configGoogle() rend null, le bouton ne s'affiche nulle part et les routes
 * renvoient à la connexion. Margaux crée cet identifiant dans Google Cloud
 * (marche à suivre : https://claude.ai/artifact/Nvgds4ofJy18vtSGZhVLZ8), avec
 * EXACTEMENT ces adresses :
 *   origine JavaScript : https://memoryline.fr
 *   URI de redirection : https://memoryline.fr/api/compte/google/retour
 *
 * Le parcours : « code d'autorisation » avec PKCE et un `state` gardé dans un
 * cookie de dix minutes (anti-falsification). Le jeton d'identité arrive
 * DIRECTEMENT de Google, en HTTPS, en échange du code et de notre code secret :
 * Google indique qu'il n'y a alors pas à revérifier sa signature. On vérifie
 * l'émetteur, le destinataire (notre identifiant), l'échéance et l'e-mail
 * VÉRIFIÉ par Google. On ne demande que « openid email profile » : le nom et
 * l'adresse e-mail, rien d'autre.
 */
import { createHash, randomBytes } from "node:crypto";

export const GOOGLE_AUTORISATION = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_JETON = "https://oauth2.googleapis.com/token";
/** Le chemin public de retour, sous le proxy (/api). Le même dans Google Cloud. */
export const CHEMIN_RETOUR_GOOGLE = "/api/compte/google/retour";

export interface ConfigGoogle {
  clientId: string;
  clientSecret: string;
  /** L'URI de redirection complète, déclarée telle quelle dans Google Cloud. */
  retour: string;
}

/** La configuration, ou null : la connexion avec Google dort. */
export function configGoogle(env: NodeJS.ProcessEnv = process.env): ConfigGoogle | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const origine = env.PUBLIC_ORIGIN?.trim().replace(/\/+$/, "");
  if (!clientId || !clientSecret || !origine || !/^https?:\/\//.test(origine)) return null;
  return { clientId, clientSecret, retour: `${origine}${CHEMIN_RETOUR_GOOGLE}` };
}

const base64url = (b: Buffer) =>
  b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Un essai de connexion : le `state`, le vérificateur PKCE et son défi. */
export function nouvelEssaiGoogle(): { etat: string; verificateur: string; defi: string } {
  const etat = base64url(randomBytes(24));
  const verificateur = base64url(randomBytes(48));
  const defi = base64url(createHash("sha256").update(verificateur).digest());
  return { etat, verificateur, defi };
}

/** L'adresse de la page de Google où la cliente choisit son compte. */
export function adresseDeGoogle(cfg: ConfigGoogle, etat: string, defi: string): string {
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.retour,
    response_type: "code",
    scope: "openid email profile",
    state: etat,
    code_challenge: defi,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${GOOGLE_AUTORISATION}?${p.toString()}`;
}

/**
 * Où revenir après la connexion : un chemin du site seulement (« /commande »,
 * « /en/compte »), jamais une autre adresse — sinon la page de connexion
 * deviendrait un tremplin vers n'importe quel site. Par défaut, le compte.
 */
export function cheminDeRetour(brut: string | null | undefined): string {
  const r = String(brut ?? "").trim();
  if (!r.startsWith("/") || r.startsWith("//") || r.includes("\\") || r.length > 300) return "/compte";
  if (/[\u0000-\u001f]/.test(r)) return "/compte";
  return r;
}

export interface ProfilGoogle {
  email: string;
  prenom: string | null;
  nom: string | null;
  nomComplet: string | null;
  /** L'identifiant Google stable de la personne (non utilisé pour l'instant). */
  sub: string;
}

/**
 * Le profil tiré d'un jeton d'identité reçu DIRECTEMENT de Google. Lance une
 * erreur si le jeton n'est pas pour nous, a expiré, ou si Google n'a pas
 * vérifié l'adresse e-mail.
 */
export function profilDuJeton(jeton: string, clientId: string, maintenant = Date.now()): ProfilGoogle {
  const parties = jeton.split(".");
  if (parties.length !== 3) throw new Error("jeton illisible");
  let charge: Record<string, unknown>;
  try {
    charge = JSON.parse(Buffer.from(parties[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new Error("jeton illisible");
  }
  const iss = String(charge.iss ?? "");
  if (iss !== "https://accounts.google.com" && iss !== "accounts.google.com")
    throw new Error("émetteur inattendu");
  const aud = charge.aud;
  if (aud !== clientId && !(Array.isArray(aud) && aud.includes(clientId)))
    throw new Error("jeton destiné à un autre site");
  if (typeof charge.exp !== "number" || charge.exp * 1000 < maintenant) throw new Error("jeton expiré");
  const email = String(charge.email ?? "").trim().toLowerCase();
  const verifie = charge.email_verified === true || charge.email_verified === "true";
  if (!email || !verifie) throw new Error("adresse e-mail non vérifiée par Google");
  const texte = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : null);
  return {
    email,
    prenom: texte(charge.given_name),
    nom: texte(charge.family_name),
    nomComplet: texte(charge.name),
    sub: String(charge.sub ?? ""),
  };
}

/** Échange le code contre le jeton d'identité, chez Google, et en tire le profil. */
export async function profilDepuisLeCode(
  cfg: ConfigGoogle,
  code: string,
  verificateur: string,
): Promise<ProfilGoogle> {
  const r = await fetch(GOOGLE_JETON, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.retour,
      grant_type: "authorization_code",
      code_verifier: verificateur,
    }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`Google a refusé le code (${r.status})`);
  const j = (await r.json()) as { id_token?: unknown };
  if (typeof j.id_token !== "string") throw new Error("Google n'a pas rendu d'identité");
  return profilDuJeton(j.id_token, cfg.clientId);
}
