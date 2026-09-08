import { createHash } from "node:crypto";

/**
 * Recherche de points relais Mondial Relay.
 *
 * Leur service historique (« WSI4 ») est du SOAP signé : chaque appel porte
 * un condensé MD5 de ses propres paramètres, concaténés dans un ordre imposé,
 * suivis de la clé privée du compte. Le format est daté mais c'est celui
 * qu'ouvre un compte marchand standard.
 *
 * Deux identifiants sont nécessaires, à mettre dans le `.env` de la racine :
 *   MONDIAL_RELAY_ENSEIGNE : le code enseigne (8 caractères, ex. « BDTEST13 »)
 *   MONDIAL_RELAY_CLE      : la clé privée associée
 *
 * Sans eux, `estConfigure()` répond faux et le mode « point relais » est
 * masqué sur le site : mieux vaut ne pas proposer un mode dont on ne saurait
 * pas dire où livrer, que de faire saisir une adresse au hasard.
 */

const ENSEIGNE = (process.env.MONDIAL_RELAY_ENSEIGNE ?? "").trim();
const CLE = (process.env.MONDIAL_RELAY_CLE ?? "").trim();
const URL_WS = "https://api.mondialrelay.com/Web_Services.asmx";

export function estConfigure(): boolean {
  return ENSEIGNE.length > 0 && CLE.length > 0;
}

export interface PointRelais {
  id: string;
  nom: string;
  adresse: string;
  codePostal: string;
  ville: string;
  pays: string;
  /** Horaires du jour, quand le service les renvoie. */
  horaires?: string;
  latitude?: string;
  longitude?: string;
}

/** Échappe une valeur destinée à un corps XML. */
function xml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Signature MD5 attendue par WSI4 : les valeurs des paramètres concaténées
 * DANS L'ORDRE de la documentation, puis la clé privée, le tout en
 * majuscules. Un ordre différent renvoie « STAT 1 » (paramètre incorrect),
 * pas une erreur explicite — d'où le soin apporté à cette liste.
 */
function signature(valeurs: string[]): string {
  return createHash("md5")
    .update(valeurs.join("") + CLE, "latin1")
    .digest("hex")
    .toUpperCase();
}

/** Contenu d'une balise XML, ou chaîne vide. */
function balise(source: string, nom: string): string {
  const m = new RegExp(`<${nom}>([\\s\\S]*?)</${nom}>`).exec(source);
  return m ? m[1]!.trim() : "";
}

/**
 * Points relais proches d'un code postal.
 *
 * Lève si le service est injoignable ou refuse la requête : l'appelant décide
 * quoi en dire au client, plutôt que de recevoir une liste vide qui aurait
 * l'air d'un « aucun point relais par ici ».
 */
export async function rechercherPointsRelais(opts: {
  codePostal: string;
  pays?: string;
  ville?: string;
  nombre?: number;
}): Promise<PointRelais[]> {
  if (!estConfigure()) throw new Error("Mondial Relay non configuré");

  const pays = (opts.pays ?? "FR").toUpperCase().slice(0, 2);
  const cp = opts.codePostal.replace(/\s+/g, "").slice(0, 10);
  const ville = (opts.ville ?? "").slice(0, 30);
  const nombre = String(Math.min(30, Math.max(1, opts.nombre ?? 10)));
  // Ordre imposé par la documentation WSI4_PointRelais_Recherche.
  const params: Record<string, string> = {
    Enseigne: ENSEIGNE,
    Pays: pays,
    NumPointRelais: "",
    Ville: ville,
    CP: cp,
    Latitude: "",
    Longitude: "",
    Taille: "",
    Poids: "",
    Action: "",
    DelaiEnvoi: "0",
    RayonRecherche: "20",
    TypeActivite: "",
    NACE: "",
    NombreResultats: nombre,
  };
  const security = signature(Object.values(params));

  const corps = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <WSI4_PointRelais_Recherche xmlns="http://www.mondialrelay.fr/webservice/">
      ${Object.entries(params)
        .map(([k, v]) => `<${k}>${xml(v)}</${k}>`)
        .join("\n      ")}
      <Security>${security}</Security>
    </WSI4_PointRelais_Recherche>
  </soap:Body>
</soap:Envelope>`;

  const res = await fetch(URL_WS, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: "http://www.mondialrelay.fr/webservice/WSI4_PointRelais_Recherche",
    },
    body: corps,
  });
  if (!res.ok) throw new Error(`Mondial Relay HTTP ${res.status}`);
  const texte = await res.text();

  // « STAT » non nul = requête refusée. Le code est repris tel quel : c'est
  // lui qui permet de comprendre ce qui cloche côté compte marchand.
  const stat = balise(texte, "STAT");
  if (stat && stat !== "0") throw new Error(`Mondial Relay STAT ${stat}`);

  const points: PointRelais[] = [];
  for (const bloc of texte.match(/<PointRelais_Details>[\s\S]*?<\/PointRelais_Details>/g) ?? []) {
    const num = balise(bloc, "Num");
    if (!num) continue;
    const adresse = [balise(bloc, "LgAdr1"), balise(bloc, "LgAdr2"), balise(bloc, "LgAdr3"), balise(bloc, "LgAdr4")]
      .filter(Boolean)
      .join(", ");
    points.push({
      id: num,
      nom: balise(bloc, "LgAdr1") || num,
      adresse,
      codePostal: balise(bloc, "CP"),
      ville: balise(bloc, "Ville"),
      pays: balise(bloc, "Pays") || pays,
      latitude: balise(bloc, "Latitude") || undefined,
      longitude: balise(bloc, "Longitude") || undefined,
    });
  }
  return points;
}
