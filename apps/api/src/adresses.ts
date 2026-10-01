/**
 * Suggestions d'adresses, pour chercher un point relais depuis chez soi.
 *
 * La source est la Base Adresse Nationale : le service public, gratuit et sans
 * clé, que tiennent l'IGN et la DINUM. Elle ne couvre que la France (Monaco et
 * l'outre-mer compris) : ailleurs, le tunnel garde la recherche par code postal.
 *
 * On l'interroge d'ici plutôt que depuis le navigateur : le client ne parle
 * qu'à la boutique, et si le service change d'adresse — il est en train de
 * passer de api-adresse.data.gouv.fr à la Géoplateforme de l'IGN —, c'est ce
 * fichier qu'on retouche, pas une page déjà ouverte chez des clients.
 */

export interface SuggestionAdresse {
  /** « 12 Rue des Trois-Cailloux 80000 Amiens » */
  label: string;
  codePostal: string;
  ville: string;
  latitude: number;
  longitude: number;
}

/** La Géoplateforme d'abord ; l'ancienne adresse en secours tant qu'elle vit. */
const SERVICES = [
  "https://data.geopf.fr/geocodage/search",
  "https://api-adresse.data.gouv.fr/search/",
];

interface ReponseBan {
  features?: {
    geometry?: { coordinates?: [number, number] };
    properties?: { label?: string; postcode?: string; city?: string };
  }[];
}

export async function suggererAdresses(saisie: string): Promise<SuggestionAdresse[]> {
  const q = saisie.replace(/\s+/g, " ").trim().slice(0, 200);
  // En dessous de trois caractères, la base répond n'importe quoi — ou rien.
  if (q.length < 3) return [];
  const params = new URLSearchParams({ q, limit: "5", autocomplete: "1" });
  for (const base of SERVICES) {
    try {
      const res = await fetch(`${base}?${params.toString()}`, {
        headers: { Accept: "application/json" },
        // Une suggestion qui arrive après que le client a fini de taper ne
        // sert plus à rien.
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;
      const corps = (await res.json()) as ReponseBan;
      return (corps.features ?? []).flatMap((f) => {
        const [longitude, latitude] = f.geometry?.coordinates ?? [];
        const p = f.properties ?? {};
        if (!p.label || !Number.isFinite(latitude) || !Number.isFinite(longitude))
          return [];
        return [
          {
            label: p.label,
            codePostal: p.postcode ?? "",
            ville: p.city ?? "",
            latitude: latitude!,
            longitude: longitude!,
          },
        ];
      });
    } catch {
      // Service suivant.
    }
  }
  throw new Error("suggestions d'adresses indisponibles");
}

/** Les mêmes services, dans l'autre sens : d'une position à une adresse. */
const SERVICES_INVERSES = [
  "https://data.geopf.fr/geocodage/reverse",
  "https://api-adresse.data.gouv.fr/reverse/",
];

/**
 * L'adresse la plus proche d'une position — celle que le client vient de
 * donner avec « Me localiser ».
 *
 * Elle sert à écrire « 80000 Amiens » dans le champ, pour qu'il voie d'où l'on
 * cherche, et à donner un code postal aux recherches qui en exigent un. La
 * position elle-même reste le point de départ : les points se classent depuis
 * sa porte. Hors de France, la base ne connaît rien : `null`, et la recherche
 * se fait sur les seules coordonnées.
 */
export async function adresseDuLieu(
  latitude: number,
  longitude: number,
): Promise<SuggestionAdresse | null> {
  const params = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    limit: "1",
  });
  for (const base of SERVICES_INVERSES) {
    try {
      const res = await fetch(`${base}?${params.toString()}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;
      const [f] = ((await res.json()) as ReponseBan).features ?? [];
      const p = f?.properties ?? {};
      if (!p.postcode) return null;
      // « 80000 Amiens » plutôt que le numéro et la rue : la position d'un
      // téléphone est approximative, et une rue fausse inquiéterait.
      return {
        label: `${p.postcode} ${p.city ?? ""}`.trim(),
        codePostal: p.postcode,
        ville: p.city ?? "",
        latitude,
        longitude,
      };
    } catch {
      // Service suivant.
    }
  }
  return null;
}
