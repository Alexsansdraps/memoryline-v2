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

/**
 * Les NATURES de mode de livraison, écrites ici et nulle part ailleurs.
 *
 * La nature ne décrit pas le transporteur : elle dit ce qu'il faut DEMANDER
 * au client pour que le colis arrive quelque part. Une adresse, un point
 * relais, ou rien du tout. C'est la seule chose dont le tunnel de commande a
 * besoin pour savoir quels champs afficher, et le serveur pour savoir quoi
 * exiger avant d'accepter la commande.
 *
 * Il n'y a PAS de nature « lettre » : une affiche part roulée dans un tube ou
 * sous pli rigide, c'est un colis. Un affranchissement de lettre ne couvrirait
 * ni l'épaisseur, ni le cadre, ni la casse — « c'est pas possible c'est un
 * colis ». Les envois postaux passent donc tous par « à domicile ».
 */
export const NATURES_LIVRAISON = [
  {
    code: "home",
    nom: "À domicile",
    /** Ce qu'on demande au client : "adresse", "point" ou rien. */
    demande: "adresse",
    aide: "Le colis part à l'adresse du client.",
  },
  {
    code: "relay",
    nom: "Point relais",
    demande: "point",
    aide: "Le client choisit un point de retrait dans la liste du transporteur.",
  },
  {
    code: "pickup",
    nom: "Retrait sur place",
    demande: "rien",
    aide: "Le client vient chercher sa commande : rien à saisir.",
  },
] as const;

/** Les codes de nature acceptés — pour valider ce qui arrive du navigateur. */
export const CODES_NATURE = NATURES_LIVRAISON.map((n) => n.code) as readonly string[];

/** Le nom lisible d'une nature, ou le code brut si elle est inconnue. */
export function nomNature(kind: string): string {
  return NATURES_LIVRAISON.find((n) => n.code === kind)?.nom ?? kind;
}

/**
 * Ce mode demande-t-il une adresse de livraison ?
 *
 * Passe par la table plutôt que par « kind === "home" » : une nature ajoutée
 * ensuite serait sinon oubliée dans l'un des trois endroits qui posent la
 * question, et le client paierait un envoi postal sans jamais avoir donné son
 * adresse.
 */
export function demandeUneAdresse(kind: string): boolean {
  return NATURES_LIVRAISON.find((n) => n.code === kind)?.demande === "adresse";
}

/** Ce mode demande-t-il de choisir un point de retrait ? */
export function demandeUnPointRelais(kind: string): boolean {
  return NATURES_LIVRAISON.find((n) => n.code === kind)?.demande === "point";
}

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
  /** Une des natures de `NATURES_LIVRAISON` : ce qu'on demande au client. */
  kind: string;
  carrier?: string | null;
  /**
   * L'ancien « Où retirer » d'un mode « pickup ». La caisse ne l'affiche
   * plus — les lieux de retrait l'ont remplacé (`lieuxRetrait`) — et l'API
   * publique ne l'envoie plus ; le champ reste pour le back-office, qui le
   * montre en lecture seule tant qu'il porte un texte.
   */
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
   * Les lieux où retirer sa commande, pour un mode « retrait sur place » :
   * actifs, dans l'ordre réglé au back-office (Livraison › Lieux de
   * retrait), dans la langue de la caisse.
   *
   * Avant, c'étaient les stands ouverts. Mais la boutique ne pouvait ni
   * renommer ce « chalet » proposé d'office, ni en ajouter un, ni l'enlever :
   * les lieux vivent maintenant à part, avec une adresse et un texte libre.
   */
  lieuxRetrait?: LieuRetraitPublic[];
}

/** Un lieu de retrait, tel que la caisse le montre. */
export interface LieuRetraitPublic {
  id: number;
  /** « Chalet du marché de Noël de Mulhouse ». */
  nom: string;
  /** Sur plusieurs lignes ; ne se traduit pas. */
  adresse: string | null;
  /** Horaires, accès… sur plusieurs lignes, dans la langue de la caisse. */
  description: string | null;
}

/** Code pays normalisé : deux lettres majuscules, ou chaîne vide. */
export function normaliserPays(pays: unknown): string {
  const p = String(pays ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(p) ? p : "";
}

/**
 * Pays proposés à la livraison. Volontairement court : ceux où la boutique
 * expédie vraiment, plus « autre pays » (ZZ), qui tombe dans la zone de repli.
 * Leurs noms, le navigateur les connaît dans toutes les langues
 * (Intl.DisplayNames).
 *
 * Partagée par la caisse et le carnet d'adresses du compte : un carnet qui
 * laissait écrire « France » en toutes lettres donnait une adresse que la
 * caisse ne savait pas lire — pays vide, zone de repli, 19,90 € de port.
 */
export const PAYS_PROPOSES: readonly string[] = [
  "FR",
  "BE",
  "CH",
  "LU",
  "DE",
  "ES",
  "IT",
  "NL",
  "PT",
  "GB",
  "CA",
  "US",
  "ZZ",
];

/**
 * La forme du code postal de chaque pays proposé. Un pays absent d'ici (et
 * « autre pays », ZZ) se contente d'une forme lâche : 2 à 10 lettres ou
 * chiffres. Le but n'est pas de valider l'adresse — le transporteur s'en
 * charge —, mais d'arrêter la faute de frappe avant le paiement : la caisse
 * acceptait « 123 » ou « abc » (recette du 17/11), et le colis partait sans
 * pouvoir arriver.
 */
const FORMES_CODE_POSTAL: Record<string, RegExp> = {
  FR: /^\d{5}$/,
  DE: /^\d{5}$/,
  ES: /^\d{5}$/,
  IT: /^\d{5}$/,
  BE: /^\d{4}$/,
  CH: /^\d{4}$/,
  LU: /^(L-?)?\d{4}$/i,
  NL: /^\d{4} ?[A-Z]{2}$/i,
  PT: /^\d{4}-?\d{3}$/,
  GB: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i,
  CA: /^[A-Z]\d[A-Z] ?\d[A-Z]\d$/i,
  US: /^\d{5}(-\d{4})?$/,
};

/** Le code postal a-t-il la forme de ceux de ce pays ? */
export function codePostalValide(cp: unknown, pays: unknown): boolean {
  const v = String(cp ?? "").trim();
  const forme = FORMES_CODE_POSTAL[normaliserPays(pays)];
  return forme ? forme.test(v) : /^[A-Z0-9][A-Z0-9 -]{1,9}$/i.test(v);
}

/**
 * Un numéro de téléphone plausible, ou rien : il est facultatif. Chiffres,
 * espaces, points, tirets, barres, parenthèses et « + », avec 6 à 15 chiffres
 * en tout (le maximum international).
 */
export function telephoneValide(tel: unknown): boolean {
  const v = String(tel ?? "").trim();
  if (!v) return true;
  if (!/^\+?[\d\s()./-]+$/.test(v)) return false;
  const chiffres = v.replace(/\D/g, "").length;
  return chiffres >= 6 && chiffres <= 15;
}

/**
 * Le code d'un pays tel qu'une adresse l'a gardé : déjà un code (« FR »), ou
 * écrit en toutes lettres dans l'une des cinq langues du site (« France »,
 * « Belgique », « Germany »…). Ce second cas, ce sont les adresses saisies au
 * carnet avant qu'il ne propose une liste. Chaîne vide si rien ne correspond.
 */
export function codePaysSaisi(saisi: unknown): string {
  const brut = String(saisi ?? "").trim();
  const code = normaliserPays(brut);
  if (code) return code;
  const simple = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const cherche = simple(brut);
  if (!cherche) return "";
  for (const langue of ["fr", "en", "de", "it", "es"]) {
    const noms = new Intl.DisplayNames([langue], { type: "region" });
    const trouve = PAYS_PROPOSES.find(
      (c) => c !== "ZZ" && simple(noms.of(c) ?? "") === cherche,
    );
    if (trouve) return trouve;
  }
  return "";
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
