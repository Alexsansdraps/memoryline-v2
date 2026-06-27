/**
 * Auth côté back-office (SSR Astro).
 *
 * Le cookie de session est émis par l'API mais doit circuler via l'origine du
 * BO. On relaie donc : le BO lit le cookie de session de SA requête entrante,
 * le transmet à l'API (`Cookie:` header) pour valider, et propage le
 * Set-Cookie de l'API vers le navigateur lors du login/logout.
 */
const API_URL =
  import.meta.env.API_URL_INTERNAL ??
  import.meta.env.PUBLIC_API_URL ??
  "http://localhost:3000";

export const SESSION_COOKIE = "ml_admin_session";

export interface AdminUser {
  email: string;
  role: string;
}

/** Valide la session courante en relayant le cookie entrant vers l'API. */
export async function getUser(request: Request): Promise<AdminUser | null> {
  const cookie = request.headers.get("cookie") ?? "";
  try {
    const res = await fetch(`${API_URL}/auth/me`, {
      headers: { cookie },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { user: AdminUser | null };
    return data.user;
  } catch {
    return null;
  }
}

/** Tente le login ; renvoie le header Set-Cookie de l'API à propager. */
export async function login(
  email: string,
  password: string,
): Promise<{ ok: boolean; setCookie: string | null; error?: string }> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, setCookie: null, error: body.error ?? "Échec" };
  }
  return { ok: true, setCookie: res.headers.get("set-cookie") };
}

export async function logout(request: Request): Promise<string | null> {
  const cookie = request.headers.get("cookie") ?? "";
  const res = await fetch(`${API_URL}/auth/logout`, {
    method: "POST",
    headers: { cookie },
  });
  return res.headers.get("set-cookie");
}
