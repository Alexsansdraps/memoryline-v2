/**
 * Points relais par SendCloud.
 *
 * La boutique n'a pas de contrat Mondial Relay en direct : elle passe par
 * SendCloud, qui revend ses étiquettes. Les identifiants marchands que demande
 * le service de Mondial Relay (`mondial-relay.ts`) n'existent donc pas, et le
 * mode « point relais » restait masqué. SendCloud expose ses propres points,
 * transporteur par transporteur : c'est ici qu'on les cherche.
 *
 * Il y a un second avantage, et il est décisif : l'identifiant d'un point chez
 * SendCloud est celui qu'il faudra lui redonner pour acheter l'étiquette. Le
 * choisir ici, c'est ne rien avoir à retraduire plus tard.
 *
 * Le service utilisé est celui des points relais
 * (servicepoints.sendcloud.sc/api/v2), le même que leur widget de sélection.
 * La clé PUBLIQUE suffit à l'interroger ; la clé secrète, si elle est posée,
 * sert à s'authentifier en Basic, comme sur le reste de leur API.
 *
 * À mettre dans le `.env` de la racine :
 *   SENDCLOUD_PUBLIC_KEY  : la clé publique (Paramètres › Intégrations › API)
 *   SENDCLOUD_SECRET_KEY  : la clé secrète associée (facultative ici)
 *
 * Sans clé publique, `estConfigure()` répond faux et rien ne change.
 */

import type { PointRelais } from "./mondial-relay.js";

const CLE_PUBLIQUE = (process.env.SENDCLOUD_PUBLIC_KEY ?? "").trim();
const CLE_SECRETE = (process.env.SENDCLOUD_SECRET_KEY ?? "").trim();
/** Remplaçable pour les essais, jamais en production. */
const BASE = (
  process.env.SENDCLOUD_SERVICEPOINTS_URL ??
  "https://servicepoints.sendcloud.sc/api/v2"
)
  .trim()
  .replace(/\/+$/, "");

/** Le préfixe de `orders.relayPointId` pour un point choisi chez SendCloud. */
export const PREFIXE_SENDCLOUD = "sendcloud:";

/**
 * Nos codes de transporteur → ceux de SendCloud, pour ses points relais comme
 * pour ses bordereaux (`sendcloud-colis.ts` lit la même table).
 *
 * Le compte SendCloud de la boutique donne accès à tout Colissimo et tout
 * Chronopost, aux tarifs négociés par SendCloud : aucun contrat à signer chez
 * La Poste. Shop2Shop n'a pas de réseau à lui chez SendCloud : ce sont les
 * points Pickup de Chronopost, qui acceptent les deux services. C'est au
 * bordereau que se fait la différence (`chronopost:shop2shop`).
 *
 * Colissimo garde son service direct (`colissimo.ts`) pour qui aurait un
 * contrat Colissimo Entreprise : SendCloud passe devant quand il est là.
 */
export const CODES_SENDCLOUD: Readonly<Record<string, string>> = {
  mondial_relay: "mondial_relay",
  colissimo: "colissimo",
  chronopost: "chronopost",
  shop2shop: "chronopost",
};

export function estConfigure(): boolean {
  return CLE_PUBLIQUE.length > 0;
}

/** SendCloud sait-il chercher les points de ce transporteur ? */
export function gerePoints(carrier: string | null | undefined): boolean {
  return estConfigure() && !!carrier && carrier in CODES_SENDCLOUD;
}

/**
 * SendCloud sait-il acheter les bordereaux de ce transporteur ? Il y faut les
 * DEUX clés : la publique suffit pour chercher des points, pas pour acheter.
 */
export function expedie(carrier: string | null | undefined): boolean {
  return estConfigure() && CLE_SECRETE.length > 0 && !!carrier && carrier in CODES_SENDCLOUD;
}

/** Les jours tels que SendCloud les numérote : 0 = lundi. */
const JOURS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

/** Un point tel que SendCloud le renvoie — seuls les champs lus ici. */
interface PointSendcloud {
  id?: number | string;
  code?: string;
  is_active?: boolean;
  /** Le code SendCloud du transporteur : « colissimo », « chronopost »… */
  carrier?: string;
  name?: string;
  street?: string;
  house_number?: string;
  postal_code?: string;
  city?: string;
  country?: string;
  latitude?: string | number;
  longitude?: string | number;
  distance?: number;
  formatted_opening_times?: Record<string, string[] | undefined>;
}

function requete(chemin: string, params: Record<string, string>): Promise<Response> {
  const p = new URLSearchParams(params);
  const entetes: Record<string, string> = { Accept: "application/json" };
  if (CLE_SECRETE)
    entetes.Authorization = `Basic ${Buffer.from(`${CLE_PUBLIQUE}:${CLE_SECRETE}`).toString("base64")}`;
  else p.set("access_token", CLE_PUBLIQUE);
  return fetch(`${BASE}${chemin}?${p.toString()}`, {
    headers: entetes,
    // Le client attend devant l'écran de paiement : mieux vaut lui dire
    // « indisponible » que le laisser devant un sablier.
    signal: AbortSignal.timeout(8000),
  });
}

/** « Lun 09:00 - 12:00, 14:00 - 19:00 » pour chaque jour ouvert. */
function horairesDe(p: PointSendcloud): string[] {
  const h = p.formatted_opening_times ?? {};
  return JOURS.flatMap((jour, i) => {
    const creneaux = (h[String(i)] ?? []).filter(Boolean);
    return creneaux.length ? [`${jour} ${creneaux.join(", ")}`] : [];
  });
}

/**
 * Un texte tel que SendCloud le recopie de Mondial Relay, remis au propre :
 * les apostrophes y arrivent doublées (« PLACE DE L''HOTEL DE VILLE »).
 */
function propre(v: string | undefined): string {
  return (v ?? "").replace(/''/g, "'").replace(/\s+/g, " ").trim();
}

function versPoint(p: PointSendcloud, paysDemande: string): PointRelais | null {
  if (p.id === undefined || p.id === null || p.is_active === false) return null;
  // Certains points (les consignes, surtout) portent « 80000 AMIENS » en guise
  // de numéro de rue : le code postal et la ville, déjà affichés à côté. On
  // ne garde le numéro que s'il en est vraiment un.
  const numero = propre(p.house_number);
  const numeroUtile =
    numero && !(p.postal_code && numero.includes(p.postal_code.trim())) ? numero : "";
  const rue = [numeroUtile, propre(p.street)].filter(Boolean).join(" ");
  return {
    id: `${PREFIXE_SENDCLOUD}${p.id}`,
    code: p.code ? String(p.code) : undefined,
    nom: propre(p.name) || String(p.code ?? p.id),
    adresse: rue,
    codePostal: propre(p.postal_code),
    ville: propre(p.city),
    pays: (p.country ?? paysDemande).toUpperCase(),
    latitude: p.latitude !== undefined ? String(p.latitude) : undefined,
    longitude: p.longitude !== undefined ? String(p.longitude) : undefined,
    distanceMetres: typeof p.distance === "number" ? Math.round(p.distance) : undefined,
    horairesSemaine: horairesDe(p),
  };
}

/**
 * Points relais proches d'un code postal, du plus proche au plus lointain.
 *
 * Lève si SendCloud est injoignable ou refuse la clé : l'appelant le dit au
 * client, plutôt que de lui montrer une liste vide qui se lirait « aucun
 * point par ici ».
 */
export async function rechercherPoints(opts: {
  carrier: string;
  codePostal: string;
  pays?: string;
  ville?: string;
  /** L'adresse exacte du client, quand il l'a choisie dans les suggestions. */
  latitude?: number;
  longitude?: number;
  nombre?: number;
}): Promise<PointRelais[]> {
  const code = CODES_SENDCLOUD[opts.carrier];
  if (!estConfigure() || !code) throw new Error("SendCloud non configuré");
  const pays = (opts.pays ?? "FR").toUpperCase().slice(0, 2);
  const cp = opts.codePostal.replace(/\s+/g, "").slice(0, 10);
  const ville = (opts.ville ?? "").trim().slice(0, 60);
  const nombre = Math.min(30, Math.max(1, opts.nombre ?? 12));
  const avecCoordonnees =
    Number.isFinite(opts.latitude) && Number.isFinite(opts.longitude);

  const chercher = async (rayon: number): Promise<PointRelais[]> => {
    const res = await requete("/service-points/", {
      country: pays,
      carrier: code,
      // Des coordonnées classent depuis la porte du client ; sans elles,
      // SendCloud géolocalise l'adresse donnée — le code postal et la ville,
      // c'est-à-dire le centre de la commune.
      //
      // JAMAIS `postal_code` ni `city` : chez SendCloud, ce sont des FILTRES,
      // pas des points de départ. Ils ne gardaient que les points situés dans
      // la commune même, et un village sans point relais (Meyrueis, en
      // Lozère) n'en trouvait aucun alors que Florac est à vingt kilomètres.
      ...(avecCoordonnees
        ? { latitude: String(opts.latitude), longitude: String(opts.longitude) }
        : { address: [cp, ville].filter(Boolean).join(" ") }),
      // Sans rayon, SendCloud renvoie mille points : il en faut une douzaine.
      radius: String(rayon),
    });
    if (!res.ok) throw new Error(`SendCloud HTTP ${res.status}`);
    const corps = (await res.json()) as unknown;
    if (!Array.isArray(corps)) throw new Error("SendCloud : réponse inattendue");
    return (corps as PointSendcloud[])
      .map((p) => versPoint(p, pays))
      .filter((p): p is PointRelais => p !== null)
      .sort((a, b) => (a.distanceMetres ?? Infinity) - (b.distanceMetres ?? Infinity))
      .slice(0, nombre);
  };

  // En ville, cinq kilomètres suffisent largement ; à la campagne, le point le
  // plus proche peut être plus loin — on élargit plutôt que de répondre
  // « aucun point par ici » à quelqu'un qui en a un à douze kilomètres.
  const proches = await chercher(avecCoordonnees ? 5000 : 15000);
  return proches.length >= 3 ? proches : chercher(30000);
}

/**
 * Ce que SendCloud dit d'un point déjà choisi.
 *
 *   « existe »             : il est connu et ouvert ;
 *   « inconnu »            : SendCloud répond, et ce point n'existe pas ou plus ;
 *   « autre_transporteur » : il existe, mais chez un autre transporteur que
 *                            celui du mode payé — un point Mondial Relay
 *                            pour un Colissimo, que personne ne livrerait ;
 *   « injoignable »        : on ne sait pas — panne réseau, clé refusée.
 *
 * La distinction compte au paiement : on refuse un point inconnu ou d'un autre
 * réseau, jamais une commande sur une simple panne de SendCloud.
 */
export async function verifierPoint(
  relayPointId: string,
  pays: string,
  /** Le transporteur du mode choisi ; sans lui, on ne vérifie que l'existence. */
  carrier?: string | null,
): Promise<"existe" | "inconnu" | "autre_transporteur" | "injoignable"> {
  const id = relayPointId.startsWith(PREFIXE_SENDCLOUD)
    ? relayPointId.slice(PREFIXE_SENDCLOUD.length)
    : "";
  if (!/^\d+$/.test(id)) return "inconnu";
  if (!estConfigure()) return "injoignable";
  try {
    const res = await requete(`/service-points/${id}/`, {
      country: pays.toUpperCase().slice(0, 2),
    });
    if (res.status === 404) return "inconnu";
    if (!res.ok) return "injoignable";
    const p = (await res.json()) as PointSendcloud;
    if (p?.is_active === false) return "inconnu";
    const attendu = carrier ? CODES_SENDCLOUD[carrier] : undefined;
    return attendu && p?.carrier && p.carrier !== attendu ? "autre_transporteur" : "existe";
  } catch {
    return "injoignable";
  }
}
