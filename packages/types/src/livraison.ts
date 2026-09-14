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

/**
 * Tarif d'un mode dans une zone, pour une tranche de poids.
 *
 * Un même mode peut avoir plusieurs tarifs dans la même zone : « de 0 à 2 kg,
 * 5 € ; de 2 à 5 kg, 8 € ». Le cas simple — un seul tarif de 0 à l'infini —
 * reste le défaut, personne n'est obligé de découper quoi que ce soit.
 */
export interface TarifLivraison {
  methodId: number;
  zoneId: number;
  priceCents: number;
  /** Montant à partir duquel c'est offert. Null = jamais. */
  freeFromCents?: number | null;
  /** Borne basse de la tranche, en grammes (incluse). */
  minWeightGrams?: number | null;
  /** Borne haute, en grammes (exclue). Null = pas de limite. */
  maxWeightGrams?: number | null;
  active?: boolean;
}

/** Le tarif couvre-t-il ce poids ? */
function couvreLePoids(t: TarifLivraison, poidsGrammes: number): boolean {
  const min = t.minWeightGrams ?? 0;
  const max = t.maxWeightGrams;
  return poidsGrammes >= min && (max === null || max === undefined || poidsGrammes < max);
}

/** Ce que l'API expose au site : de quoi calculer sans rien redemander. */
export interface CatalogueLivraison {
  zones: ZoneLivraison[];
  modes: ModeLivraison[];
  tarifs: TarifLivraison[];
  /**
   * Les stands OUVERTS, pour un mode « retrait sur place ».
   *
   * Sans eux, « retrait à convenir » ne disait rien de concret : le client
   * validait sans savoir où ni quand, et il fallait lui écrire ensuite. Le
   * code du stand n'y figure jamais — c'est lui qui ouvre la caisse.
   */
  stands?: StandOuvert[];
}

/** Un stand ouvert, tel que le tunnel de commande le montre. */
export interface StandOuvert {
  id: number;
  nom: string;
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
  poidsGrammes = 0,
  /**
   * Le seuil d'une promotion « livraison offerte dès X € », s'il y en a une.
   *
   * Il s'ajoute à la franchise propre à chaque grille tarifaire, sans la
   * remplacer : le port est offert dès que l'UN des deux est atteint. Une
   * franchise négociée avec un transporteur n'a pas à disparaître parce
   * qu'une promotion passe, et l'inverse non plus.
   *
   * Cf. `seuilPortOffertCents` dans promo.ts, qui le lit dans les règles.
   */
  seuilPromotionCents: number | null = null,
): OptionLivraison[] {
  const zone = zonePourPays(catalogue.zones, pays);
  if (!zone) return [];
  return catalogue.modes
    .filter((m) => m.active !== false)
    .map((mode) => {
      // Aucune tranche ne couvre le poids = le mode ne SAIT PAS transporter ce
      // colis. On le retire au lieu de retomber sur un tarif au hasard : mieux
      // vaut proposer moins de modes qu'un affranchissement faux.
      const tarif = catalogue.tarifs
        .filter((t) => t.methodId === mode.id && t.zoneId === zone.id)
        .filter((t) => couvreLePoids(t, poidsGrammes))
        .sort((a, b) => (a.minWeightGrams ?? 0) - (b.minWeightGrams ?? 0))
        .at(-1);
      if (!tarif || tarif.active === false) return null;
      const atteint = (s: number | null | undefined) =>
        typeof s === "number" && s >= 0 && sousTotalCents >= s;
      const offert =
        atteint(tarif.freeFromCents) || atteint(seuilPromotionCents);
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
  poidsGrammes = 0,
  seuilPromotionCents: number | null = null,
): OptionLivraison | null {
  return (
    optionsLivraison(
      catalogue,
      pays,
      sousTotalCents,
      poidsGrammes,
      seuilPromotionCents,
    ).find((o) => o.mode.slug === modeSlug) ?? null
  );
}
