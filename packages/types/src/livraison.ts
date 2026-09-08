/**
 * Frais de port — calcul PARTAGÉ.
 *
 * Comme pour les remises, une seule implémentation : celle-ci sert au tunnel
 * de commande (montant affiché) et à l'API (montant encaissé). Deux copies
 * finiraient par diverger, et le client verrait un prix pour en payer un
 * autre.
 *
 * Les montants sont en CENTIMES, entiers.
 */

/** Zone de livraison : un groupe de pays aux mêmes tarifs. */
export interface ZoneLivraison {
  id: number;
  slug: string;
  name: string;
  /** Codes pays ISO. Liste VIDE = zone par défaut, celle qui ramasse le reste. */
  countries?: string[] | null;
  position?: number;
}

/** Mode de livraison proposé au client. */
export interface ModeLivraison {
  id: number;
  slug: string;
  name: string;
  description?: string | null;
  /** relay = point relais · home = adresse · pickup = retrait sur place. */
  kind: string;
  carrier?: string | null;
  /** Où retirer, pour un mode « pickup » — la boutique est itinérante. */
  pickupLocation?: string | null;
  active?: boolean;
  position?: number;
}

/** Tarif d'un mode dans une zone. */
export interface TarifLivraison {
  methodId: number;
  zoneId: number;
  priceCents: number;
  /** Montant à partir duquel c'est offert. Null = jamais. */
  freeFromCents?: number | null;
  active?: boolean;
}

/** Ce que l'API expose au site : de quoi calculer sans rien redemander. */
export interface CatalogueLivraison {
  zones: ZoneLivraison[];
  modes: ModeLivraison[];
  tarifs: TarifLivraison[];
}

/** Code pays normalisé : deux lettres majuscules, ou chaîne vide. */
export function normaliserPays(pays: unknown): string {
  const p = String(pays ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(p) ? p : "";
}

/**
 * Zone d'un pays.
 *
 * Une zone qui cite le pays gagne ; à défaut, la zone « par défaut » (liste
 * de pays vide) le prend en charge. Sans cette zone de repli, un client d'un
 * pays oublié à la saisie ne pourrait pas commander du tout.
 */
export function zonePourPays(
  zones: readonly ZoneLivraison[],
  pays: string,
): ZoneLivraison | undefined {
  const code = normaliserPays(pays);
  const triees = [...zones].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  if (code) {
    const citee = triees.find((z) =>
      (z.countries ?? []).some((c) => normaliserPays(c) === code),
    );
    if (citee) return citee;
  }
  return triees.find((z) => (z.countries ?? []).length === 0);
}

export interface OptionLivraison {
  mode: ModeLivraison;
  tarif: TarifLivraison;
  /** Ce que le client paiera vraiment, franchise de port déduite. */
  fraisCents: number;
  /** Vrai si la franchise s'applique — utile pour l'écrire à l'écran. */
  offert: boolean;
}

/**
 * Modes réellement proposables pour un pays et un montant de panier donnés.
 *
 * `sousTotalCents` est le panier APRÈS remises : c'est lui qu'on compare au
 * seuil de gratuité. Comparer avant reviendrait à offrir le port grâce à des
 * articles que la promotion vient d'offrir.
 */
export function optionsLivraison(
  catalogue: CatalogueLivraison,
  pays: string,
  sousTotalCents: number,
): OptionLivraison[] {
  const zone = zonePourPays(catalogue.zones, pays);
  if (!zone) return [];
  return catalogue.modes
    .filter((m) => m.active !== false)
    .map((mode) => {
      const tarif = catalogue.tarifs.find(
        (t) => t.methodId === mode.id && t.zoneId === zone.id,
      );
      if (!tarif || tarif.active === false) return null;
      const seuil = tarif.freeFromCents;
      const offert =
        typeof seuil === "number" && seuil >= 0 && sousTotalCents >= seuil;
      return {
        mode,
        tarif,
        fraisCents: offert ? 0 : Math.max(0, tarif.priceCents),
        offert,
      };
    })
    .filter((o): o is OptionLivraison => o !== null)
    .sort((a, b) => (a.mode.position ?? 0) - (b.mode.position ?? 0));
}

/**
 * Frais de port d'un choix précis. Renvoie `null` si le mode n'est pas
 * proposable là où le client se fait livrer — le serveur refuse alors la
 * commande plutôt que de facturer un port au hasard.
 */
export function fraisDePort(
  catalogue: CatalogueLivraison,
  modeSlug: string,
  pays: string,
  sousTotalCents: number,
): OptionLivraison | null {
  return (
    optionsLivraison(catalogue, pays, sousTotalCents).find(
      (o) => o.mode.slug === modeSlug,
    ) ?? null
  );
}
