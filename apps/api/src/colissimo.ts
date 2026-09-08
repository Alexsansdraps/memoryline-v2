/**
 * Points de retrait Colissimo (« Points de Retrait », API de La Poste).
 *
 * Contrairement à Mondial Relay, le service est en REST/JSON et s'authentifie
 * avec le numéro de contrat et son mot de passe, envoyés dans le corps de la
 * requête. Documentation :
 * https://www.applications.colissimo.entreprise.laposte.fr/doc-colissimo/redoc-pdr/fr
 *
 * Deux identifiants, à mettre dans le `.env` de la racine :
 *   COLISSIMO_CONTRAT   : numéro de contrat (« accountNumber », 6 chiffres)
 *   COLISSIMO_MOTDEPASSE : mot de passe associé
 *
 * Sans eux, `estConfigure()` répond faux et le mode « point retrait
 * Colissimo » est masqué sur le site — on ne propose pas un mode dont on ne
 * saurait pas dire où livrer.
 */

const CONTRAT = (process.env.COLISSIMO_CONTRAT ?? "").trim();
const MOTDEPASSE = (process.env.COLISSIMO_MOTDEPASSE ?? "").trim();
const URL_PDR =
  "https://ws.colissimo.fr/pointretrait-ws-cxf/rest/v2/findRDVPointRetraitAcheminement";

export function estConfigure(): boolean {
  return CONTRAT.length > 0 && MOTDEPASSE.length > 0;
}

export interface PointRetrait {
  id: string;
  nom: string;
  adresse: string;
  codePostal: string;
  ville: string;
  pays: string;
  horaires?: string;
}

/**
 * Date d'expédition demandée par l'API, au format jj/mm/aaaa.
 *
 * Le service refuse une date passée : on demande le lendemain, qui convient
 * pour une boutique qui prépare ses colis dans la journée.
 */
function dateExpedition(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const jj = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${jj}/${mm}/${d.getFullYear()}`;
}

/** Rassemble les lignes d'adresse renvoyées, sans trous ni virgules en double. */
function adresseComplete(p: Record<string, unknown>): string {
  return [p.adresse1, p.adresse2, p.adresse3]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

/**
 * Points de retrait autour d'un code postal.
 *
 * Lève si le service est injoignable ou refuse la requête : l'appelant décide
 * quoi en dire, plutôt que de recevoir une liste vide qui se lirait « aucun
 * point par ici ».
 */
export async function rechercherPointsRetrait(opts: {
  codePostal: string;
  pays?: string;
  ville?: string;
  poidsGrammes?: number;
}): Promise<PointRetrait[]> {
  if (!estConfigure()) throw new Error("Colissimo non configuré");

  const corps = {
    accountNumber: CONTRAT,
    password: MOTDEPASSE,
    address: "",
    zipCode: opts.codePostal.replace(/\s+/g, ""),
    city: opts.ville ?? "",
    countryCode: (opts.pays ?? "FR").toUpperCase().slice(0, 2),
    // Poids en grammes : une affiche roulée ou à plat reste légère, mais le
    // service en a besoin pour écarter les points qui ne prennent pas les
    // colis lourds.
    weight: String(opts.poidsGrammes ?? 500),
    shippingDate: dateExpedition(),
    // « filterRelay » à 1 : uniquement les points ouverts aux particuliers.
    filterRelay: "1",
    optionInter: "0",
  };

  const res = await fetch(URL_PDR, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(corps),
  });
  if (!res.ok) throw new Error(`Colissimo HTTP ${res.status}`);
  const data = (await res.json()) as {
    errorCode?: number;
    errorMessage?: string;
    listePointRetraitAcheminement?: Record<string, unknown>[];
  };
  // Le service répond 200 même quand il refuse : c'est `errorCode` qui parle.
  if (data.errorCode && data.errorCode !== 0)
    throw new Error(`Colissimo erreur ${data.errorCode} ${data.errorMessage ?? ""}`);

  return (data.listePointRetraitAcheminement ?? [])
    .map((p) => ({
      id: String(p.identifiant ?? "").trim(),
      nom: String(p.nom ?? "").trim(),
      adresse: adresseComplete(p),
      codePostal: String(p.codePostal ?? "").trim(),
      ville: String(p.localite ?? "").trim(),
      pays: String(p.codePays ?? opts.pays ?? "FR").trim(),
    }))
    .filter((p) => p.id.length > 0);
}
