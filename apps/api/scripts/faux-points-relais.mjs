/**
 * Un FAUX service de points relais SendCloud, pour éprouver le tunnel de
 * commande sans clé.
 *
 * Il imite `servicepoints.sendcloud.sc/api/v2` : la liste des points autour
 * d'un code postal, et un point par son identifiant. Les formes de réponse
 * suivent la documentation publique de SendCloud ; ce n'est pas la vérité —
 * le jour où la clé publique est posée, comparer une vraie réponse à celle-ci.
 *
 * Aucune dépendance, aucune clé lue : il exige seulement qu'on s'authentifie
 * (en-tête Basic ou paramètre `access_token`), sans en regarder la valeur.
 *
 * Usage, dans le conteneur de l'API :
 *   node apps/api/scripts/faux-points-relais.mjs         (port 3101)
 * puis, pour l'API :
 *   SENDCLOUD_PUBLIC_KEY=essai
 *   SENDCLOUD_SERVICEPOINTS_URL=http://localhost:3101/api/v2
 *
 * Deux codes postaux piégés : 99999 renvoie une liste vide, 99500 une panne.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.FAUX_POINTS_PORT ?? 3101);

const HORAIRES = {
  0: ["09:00 - 12:30", "14:00 - 19:00"],
  1: ["09:00 - 12:30", "14:00 - 19:00"],
  2: ["09:00 - 12:30", "14:00 - 19:00"],
  3: ["09:00 - 12:30", "14:00 - 19:00"],
  4: ["09:00 - 12:30", "14:00 - 19:00"],
  5: ["09:00 - 13:00"],
  6: [],
};

/** Trois points par code postal, fabriqués d'après lui. */
function pointsPour(cp, pays) {
  const base = Number(cp.replace(/\D/g, "").slice(0, 5) || "75001");
  const noms = ["Tabac Le Central", "Presse des Halles", "Supérette du Marché"];
  const rues = ["rue de la République", "place du Marché", "avenue Jean Jaurès"];
  return noms.map((nom, i) => ({
    id: base * 10 + i,
    code: String(base).padStart(5, "0").slice(0, 2) + String(4210 + i),
    is_active: true,
    shop_type: null,
    extra_data: {},
    name: nom,
    street: rues[i],
    house_number: String(3 + i * 7),
    postal_code: cp,
    city: "Ville d'essai",
    latitude: "49.8941",
    longitude: "2.2958",
    email: "",
    phone: "",
    homepage: "",
    carrier: "mondial_relay",
    country: pays,
    formatted_opening_times: HORAIRES,
    open_tomorrow: true,
    open_upcoming_week: true,
    distance: [420, 1180, 2650][i],
  }));
}

function repondre(res, statut, corps) {
  res.writeHead(statut, { "Content-Type": "application/json" });
  res.end(JSON.stringify(corps));
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const chemin = url.pathname.replace(/\/+$/, "");
  const authentifie =
    (req.headers.authorization ?? "").startsWith("Basic ") ||
    !!url.searchParams.get("access_token");
  console.log(`[faux-points-relais] ${req.method} ${chemin}`);
  if (!authentifie) return repondre(res, 401, { error: "clé manquante" });

  if (chemin === "/api/v2/service-points") {
    const cp = (url.searchParams.get("postal_code") ?? "").trim();
    const pays = (url.searchParams.get("country") ?? "FR").toUpperCase();
    if (cp === "99500") return repondre(res, 503, { error: "panne simulée" });
    if (cp === "99999") return repondre(res, 200, []);
    return repondre(res, 200, pointsPour(cp || "75001", pays));
  }
  const unPoint = /^\/api\/v2\/service-points\/(\d+)$/.exec(chemin);
  if (unPoint) {
    const id = Number(unPoint[1]);
    const cp = String(Math.floor(id / 10)).padStart(5, "0");
    const point = pointsPour(cp, "FR").find((p) => p.id === id);
    return point ? repondre(res, 200, point) : repondre(res, 404, { error: "introuvable" });
  }
  repondre(res, 404, { error: "chemin inconnu" });
}).listen(PORT, () => console.log(`[faux-points-relais] http://localhost:${PORT}/api/v2`));
