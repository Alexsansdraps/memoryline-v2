/**
 * GET /recherche.json?q=…[&groupes=…][&limite=…] — ce que lit le panneau de
 * recherche en haut de chaque écran.
 *
 * Le panneau n'appelle que ce point d'accès, sur la même origine que la page :
 * le cookie de session part donc aussi en développement direct, et le
 * back-office ajoute à la réponse de l'API ses écrans et son aide
 * (lib/recherche-bo.ts).
 *
 * Sans session, le middleware renvoie vers /login avant d'arriver ici. Un
 * vendeur, lui, arrive bien ici (le middleware laisse passer ce point
 * d'accès) et reçoit le refus ci-dessous, en JSON, comme le contrat le
 * prévoit : cette réponse contient des noms de clientes et des montants.
 */
import type { APIRoute } from "astro";
import { lireGroupes, lireLimite, rechercher } from "../lib/recherche-bo.ts";

// La réponse dépend de la session et de ce qui vient d'être tapé : aucun
// cache, ni du navigateur ni d'un proxy, ne doit la garder.
const ENTETES = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

export const GET: APIRoute = async ({ request, locals, url }) => {
  if (locals.user?.role !== "owner")
    return new Response(
      JSON.stringify({ error: "Cette recherche est réservée au propriétaire." }),
      { status: 403, headers: ENTETES },
    );

  const reponse = await rechercher(request, url.searchParams.get("q") ?? "", {
    groupes: lireGroupes(url.searchParams.get("groupes")),
    limite: lireLimite(url.searchParams.get("limite")),
  });
  return new Response(JSON.stringify(reponse), { status: 200, headers: ENTETES });
};
