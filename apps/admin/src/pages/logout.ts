import type { APIRoute } from "astro";
import { logout } from "../lib/auth.ts";

export const POST: APIRoute = async ({ request, redirect }) => {
  const setCookie = await logout(request);
  const res = redirect("/login");
  if (setCookie) res.headers.append("set-cookie", setCookie);
  return res;
};
