/**
 * Règles de panier — moteur PARTAGÉ.
 *
 * Le calcul vivait en trois exemplaires : l'API (montant réellement encaissé),
 * le panier et le tunnel de commande (montants affichés). Trois copies qui
 * divergent, c'est un client qui voit un prix et en paie un autre. Il n'y a
 * plus qu'une implémentation, ici, utilisée par les trois — et par l'écran
 * Promotions du back-office, pour son exemple.
 *
 * Les montants sont en CENTIMES, entiers : jamais de flottants sur de l'argent.
 */

/** Une règle telle que le back-office l'enregistre. */
export interface RegleParier {
  id?: number;
  name?: string;
  /**
   * Code à saisir pour que la règle s'applique. `null` ou absent = promotion
   * automatique, valable pour tout le monde.
   */
  code?: string | null;
  /** buy_x_get_y | percent | fixed | free_shipping_over */
  type: string;
  /**
   * Paramètres de la règle. Typé `unknown` : il vient d'une colonne jsonb, on
   * ne peut donc rien garantir de sa forme — chaque lecture passe par des
   * conversions défensives plus bas.
   */
  config?: unknown;
  active?: boolean | null;
  priority?: number | null;
  startsAt?: string | Date | null;
  endsAt?: string | Date | null;
  /**
   * Non nul = archivée : la règle ne s'applique plus nulle part. Les
   * commandes passées gardent leur remise, figée sur la commande.
   */
  archivedAt?: string | Date | null;
}

/** Une ligne de panier, réduite à ce dont le calcul a besoin. */
export interface LignePanier {
  unitPriceCents: number;
  quantity: number;
  /** "A4" | "A3" — sert aux règles restreintes à un format. */
  format?: string | null;
  /**
   * La part du prix unitaire due au cadre, en centimes (0 ou absent : pas de
   * cadre). Une affiche offerte « cadre non compris » est remisée de son prix
   * MOINS celui-ci : c'est l'affiche qu'on offre, pas son encadrement.
   */
  cadreCents?: number | null;
}

/** Types de règles réellement appliquées au prix. */
export const TYPES_REGLE_APPLIQUES = ["buy_x_get_y", "percent", "fixed"] as const;

function nombre(v: unknown, defaut: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : defaut;
}

function date(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Normalise un code pour la comparaison : sans espaces, en majuscules. */
export function normaliserCode(code: unknown): string {
  return String(code ?? "").trim().toUpperCase();
}

/**
 * La CLÉ d'un code, celle qui sert à le reconnaître : en majuscules, sans
 * espaces ni tirets.
 *
 * Un code se recopie d'un courriel ou d'un papier : « v7x9 kq4m z8wp 3n6r »
 * et « V7X9-KQ4M-Z8WP-3N6R » sont le même code. `normaliserCode` garde les
 * tirets, parce que c'est ainsi que la boutique l'a écrit et qu'il s'affiche ;
 * celle-ci ne sert qu'à comparer. Deux promotions dont les codes ne diffèrent
 * que par un tiret sont donc refusées au back-office (promotions.ts).
 */
export function cleDeCode(code: unknown): string {
  return String(code ?? "")
    .replace(/[\s-]+/g, "")
    .toUpperCase();
}

/**
 * La règle offre-t-elle aussi la livraison ?
 *
 * Une remise sur le panier (pourcentage ou montant) peut s'accompagner du port
 * offert : c'est ce qui fait un code « tout gratuit », affiches à 100 % et
 * livraison comprise. Absent = non : rien ne change pour les règles d'avant.
 */
export function offreLaLivraison(regle: Pick<RegleParier, "type" | "config">): boolean {
  if (regle.type !== "percent" && regle.type !== "fixed") return false;
  return ((regle.config ?? {}) as { livraisonOfferte?: unknown }).livraisonOfferte === true;
}

/**
 * Le code ne sert-il qu'UNE fois, toutes clientes confondues ?
 *
 * Absent = réutilisable : c'est ce que faisaient tous les codes avant que la
 * question se pose. Le décompte, lui, se fait au serveur, au moment où la
 * commande est payée (configurator-routes.ts) : ce drapeau ne fait que dire
 * qu'il faut compter.
 */
export function estUsageUnique(config: unknown): boolean {
  return ((config ?? {}) as { usageUnique?: unknown }).usageUnique === true;
}

/* ------------------------------------------------------------------------ */
/*  « X achetées = Y offertes » : les deux formes de réglage                */
/* ------------------------------------------------------------------------ */

/**
 * Ce que dit une règle « X achetées = Y offertes », quelle que soit la forme
 * sous laquelle elle a été enregistrée.
 *
 * Deux formes existent en base :
 *   - l'ANCIENNE, sans `version` : { buyQty, getQty, format, percent }. Un
 *     format y restreint À LA FOIS ce qui compte à l'achat et ce qui est
 *     offert, et le cadre est offert avec l'affiche (il est dans le prix
 *     unitaire). Elle se relit EXACTEMENT comme avant : une règle enregistrée
 *     hier ne change pas de sens parce que le moteur a appris autre chose ;
 *   - la NOUVELLE, `version: 2`, réglée dans l'écran Promotions comme dans
 *     Shopify : ce que la cliente achète (combien, quels formats), ce qu'elle
 *     reçoit (combien, quels formats, à quel pourcentage, cadre compris ou
 *     non, combien de fois au plus).
 */
export interface OffreLue {
  achat: { quantite: number; formats: string[] };
  offert: {
    quantite: number;
    formats: string[];
    /** 100 = offerte ; en dessous, simplement remisée. */
    pourcentage: number;
    /** Le cadre de l'affiche offerte est-il offert aussi ? */
    cadreCompris: boolean;
    /** Combien de fois l'offre joue sur un même panier ; null = sans limite. */
    maxLots: number | null;
  };
}

/** Les conditions communes : un minimum d'achat, en montant ou en affiches. */
export interface ConditionsLues {
  minCents: number | null;
  minQuantite: number | null;
}

function entier(v: unknown, defaut: number, min: number): number {
  return Math.max(min, Math.floor(nombre(v, defaut)));
}

/** Une liste de formats lue sans confiance : chaînes non vides, sans doublon. */
function formats(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((f): f is string => typeof f === "string" && f.trim() !== "").map((f) => f.trim()))];
}

/** La config est-elle de la nouvelle forme ? */
export function estConfigV2(config: unknown): boolean {
  return Number((config as { version?: unknown } | null)?.version) === 2;
}

/** La règle « X achetées = Y offertes », lue sous l'une ou l'autre forme. */
export function lireOffre(config: unknown): OffreLue {
  const cfg = (config ?? {}) as Record<string, unknown>;
  if (estConfigV2(cfg)) {
    const achat = (cfg.achat ?? {}) as Record<string, unknown>;
    const offert = (cfg.offert ?? {}) as Record<string, unknown>;
    const max = offert.maxLots;
    return {
      achat: { quantite: entier(achat.quantite, 3, 1), formats: formats(achat.formats) },
      offert: {
        quantite: entier(offert.quantite, 1, 1),
        formats: formats(offert.formats),
        pourcentage: Math.min(100, Math.max(0, nombre(offert.pourcentage, 100))),
        cadreCompris: offert.cadreCompris !== false,
        maxLots: max == null || max === "" ? null : entier(max, 1, 1),
      },
    };
  }
  // L'ancienne forme. Sans pourcentage, l'exemplaire est offert : c'est le
  // sens des règles écrites avant que la remise partielle existe.
  const format = typeof cfg.format === "string" && cfg.format ? [cfg.format] : [];
  return {
    achat: { quantite: entier(cfg.buyQty, 3, 1), formats: format },
    offert: {
      quantite: entier(cfg.getQty, 1, 1),
      formats: format,
      pourcentage: Math.min(100, Math.max(0, nombre(cfg.percent, 100))),
      cadreCompris: true,
      maxLots: null,
    },
  };
}

/** Le minimum d'achat d'une règle, s'il y en a un (toutes formes). */
export function lireConditions(config: unknown): ConditionsLues {
  const c = ((config ?? {}) as { conditions?: unknown }).conditions as
    | Record<string, unknown>
    | null
    | undefined;
  const positif = (v: unknown) => {
    if (v == null || v === "") return null;
    const n = Math.round(nombre(v, 0));
    return n > 0 ? n : null;
  };
  return { minCents: positif(c?.minCents), minQuantite: positif(c?.minQuantite) };
}

/**
 * La règle se cumule-t-elle avec les autres ? Absent = oui : c'est ce que
 * faisait le moteur avant que la question se pose. La colonne `stackable` de
 * la table n'est PAS lue : elle valait « non » partout sans que rien ne la
 * lise, et la suivre aurait changé d'un coup le prix de paniers existants.
 */
export function estCumulable(config: unknown): boolean {
  return ((config ?? {}) as { cumulable?: unknown }).cumulable !== false;
}

/**
 * Règles actives à l'instant donné, de la plus prioritaire à la moins.
 *
 * Une règle porteuse d'un CODE est écartée tant que ce code n'a pas été
 * saisi : sans ce filtre, une promotion à code s'appliquerait à tout le monde
 * et le code ne servirait à rien. Une règle ARCHIVÉE est écartée toujours :
 * l'API lit la table entière, archives comprises.
 *
 * À priorité égale, la plus ANCIENNE (le plus petit identifiant) passe
 * d'abord. Sans ce départage, l'ordre était celui où les lignes arrivaient :
 * la table sans tri côté serveur, le code saisi ajouté en dernier côté
 * navigateur. Or l'ordre change le résultat (un pourcentage se calcule sur ce
 * que les remises précédentes ont laissé, une règle non cumulable arrête les
 * suivantes) : le panier pouvait afficher 85,50 € et la caisse encaisser 85 €.
 */
export function reglesActives<T extends RegleParier>(
  regles: readonly T[],
  maintenant: Date = new Date(),
  codes: readonly string[] = [],
): T[] {
  // Comparés par leur CLÉ (cleDeCode) : ni la casse, ni les tirets, ni les
  // espaces ne doivent faire refuser un code bien recopié.
  const saisis = new Set(codes.map(cleDeCode).filter(Boolean));
  return regles
    .filter((r) => r.active !== false)
    .filter((r) => !r.archivedAt)
    .filter((r) => {
      const code = cleDeCode(r.code);
      return !code || saisis.has(code);
    })
    .filter((r) => {
      const debut = date(r.startsAt);
      const fin = date(r.endsAt);
      return (!debut || debut <= maintenant) && (!fin || fin >= maintenant);
    })
    .sort(
      (a, b) =>
        nombre(b.priority, 0) - nombre(a.priority, 0) ||
        nombre(a.id, 0) - nombre(b.id, 0),
    );
}

/** Sous-total avant toute remise. */
export function sousTotalCents(lignes: readonly LignePanier[]): number {
  return lignes.reduce(
    (s, l) => s + nombre(l.unitPriceCents, 0) * Math.max(0, nombre(l.quantity, 0)),
    0,
  );
}

/** Le nombre d'affiches du panier (exemplaires, pas lignes). */
function nombreDExemplaires(lignes: readonly LignePanier[]): number {
  return lignes.reduce((s, l) => s + Math.max(0, Math.floor(nombre(l.quantity, 0))), 0);
}

/** Un exemplaire du panier : une affiche, son prix, son cadre, son format. */
interface Exemplaire {
  prix: number;
  /** La part du prix due au cadre, bornée au prix. */
  cadre: number;
  format: string;
}

/** Les exemplaires dépliés, une entrée par affiche. */
function deplier(lignes: readonly LignePanier[]): Exemplaire[] {
  const out: Exemplaire[] = [];
  for (const l of lignes) {
    const prix = nombre(l.unitPriceCents, 0);
    const cadre = Math.min(prix, Math.max(0, Math.round(nombre(l.cadreCents, 0))));
    const q = Math.max(0, Math.floor(nombre(l.quantity, 0)));
    for (let i = 0; i < q; i++) out.push({ prix, cadre, format: l.format ?? "" });
  }
  return out;
}

/** Le format est-il dans la liste ? Une liste vide veut dire « tous ». */
function dansLesFormats(format: string, liste: readonly string[]): boolean {
  return liste.length === 0 || liste.includes(format);
}

/**
 * La remise d'un « X achetées = Y offertes » sur ces lignes.
 *
 * Un LOT, c'est `achat.quantite` affiches payées PLUS `offert.quantite`
 * affiches remisées : « 3 achetées, la 4e offerte » se lit sur un panier de
 * quatre. Les affiches offertes sont prises parmi celles des formats offerts,
 * les MOINS CHÈRES d'abord — c'est ce que la cliente attend d'une offre, et
 * c'est ce que fait Shopify. Celles qui restent doivent suffire à payer les
 * lots : on retient le plus grand nombre de lots pour lequel c'est vrai, dans
 * la limite de `maxLots`.
 *
 * Sur une règle de l'ancienne forme (mêmes formats à l'achat et à l'offre,
 * cadre compris), le résultat est exactement l'ancien calcul : un lot tous les
 * `buyQty + getQty` exemplaires du format, les moins chers offerts.
 */
function remiseOffre(lignes: readonly LignePanier[], offre: OffreLue): number {
  const exemplaires = deplier(lignes);
  const { achat, offert } = offre;
  const valeur = (e: Exemplaire) => (offert.cadreCompris ? e.prix : e.prix - e.cadre);
  const candidats = exemplaires
    .filter((e) => dansLesFormats(e.format, offert.formats))
    .sort((a, b) => valeur(a) - valeur(b));
  const achetables = exemplaires.filter((e) => dansLesFormats(e.format, achat.formats)).length;

  let lots = Math.floor(candidats.length / offert.quantite);
  if (offert.maxLots !== null) lots = Math.min(lots, offert.maxLots);
  for (; lots > 0; lots--) {
    const pris = candidats.slice(0, lots * offert.quantite);
    // Une affiche offerte ne compte pas parmi celles qui sont payées.
    const prisAchetables = pris.filter((e) => dansLesFormats(e.format, achat.formats)).length;
    if (achetables - prisAchetables >= lots * achat.quantite) {
      return pris.reduce((s, e) => s + Math.round((valeur(e) * offert.pourcentage) / 100), 0);
    }
  }
  return 0;
}

/* ------------------------------------------------------------------------ */
/*  La règle, écrite en français                                             */
/* ------------------------------------------------------------------------ */

/** « 4e », « 2e », « 1re » — le rang d'un exemplaire dans le panier. */
function rang(n: number): string {
  return n <= 1 ? "1re" : `${n}e`;
}

function euros(cents: number): string {
  const v = cents / 100;
  return (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(".", ",")) + " €";
}

/** « A4 », « A3 ou A4 » ; vide pour « tous les formats ». */
function listeFormats(liste: readonly string[]): string {
  if (liste.length <= 1) return liste[0] ?? "";
  return `${liste.slice(0, -1).join(", ")} ou ${liste[liste.length - 1]}`;
}

/** Le minimum d'achat, en fin de phrase : « , dès 50 € d'achat ». */
function phraseConditions(config: unknown): string {
  const { minCents, minQuantite } = lireConditions(config);
  const morceaux: string[] = [];
  if (minCents) morceaux.push(`dès ${euros(minCents)} d'achat`);
  if (minQuantite) morceaux.push(`dès ${minQuantite} affiche${minQuantite > 1 ? "s" : ""}`);
  return morceaux.length ? `, ${morceaux.join(" et ")}` : "";
}

/**
 * La règle, écrite en français.
 *
 * Le back-office la configure, le panier la déduit, l'écran Promotions en
 * montre l'exemple : tous doivent dire la même chose. Ils tiennent la phrase
 * d'ici, pour qu'aucun écran ne puisse promettre autre chose que ce que le
 * calcul fait.
 */
export function libelleRegle(regle: RegleParier): string {
  const cfg = (regle.config ?? {}) as Record<string, unknown>;
  if (regle.type === "buy_x_get_y") {
    const offre = lireOffre(cfg);
    const { achat, offert } = offre;
    if (!estConfigV2(cfg)) {
      // L'ancienne forme garde son ancienne phrase, mot pour mot.
      const format = achat.formats[0] ?? null;
      const achetees = achat.quantite === 1 ? "1 affiche achetée" : `${achat.quantite} affiches achetées`;
      const cibles =
        offert.quantite === 1
          ? `la ${rang(achat.quantite + 1)}`
          : `les ${rang(achat.quantite + 1)} à ${rang(achat.quantite + offert.quantite)}`;
      const effet =
        offert.pourcentage >= 100
          ? offert.quantite === 1
            ? "offerte"
            : "offertes"
          : `à -${offert.pourcentage} %`;
      const ou = format ? ` (format ${format} seulement)` : "";
      return `${achetees}, ${cibles} ${effet}${ou}`;
    }
    const achetees =
      `${achat.quantite} affiche${achat.quantite > 1 ? "s" : ""} achetée${achat.quantite > 1 ? "s" : ""}` +
      ` (${achat.formats.length ? listeFormats(achat.formats) : "tous formats"})`;
    const pluriel = offert.quantite > 1;
    const quoi = offert.formats.length
      ? `${offert.quantite} ${listeFormats(offert.formats)}`
      : `${offert.quantite} affiche${pluriel ? "s" : ""}`;
    const effet =
      offert.pourcentage >= 100
        ? pluriel
          ? "offertes"
          : "offerte"
        : `à -${offert.pourcentage} %`;
    const cadre = offert.cadreCompris ? "cadre compris" : "cadre non compris";
    const fois = offert.maxLots
      ? `, ${offert.maxLots} fois au plus par commande`
      : "";
    return `${achetees} = ${quoi} ${effet}, ${cadre}${fois}${phraseConditions(cfg)}`;
  }
  // « et livraison offerte » : un code « tout gratuit » se lit comme tel.
  const livraison = offreLaLivraison(regle) ? " et livraison offerte" : "";
  if (regle.type === "percent")
    return `-${Math.min(100, Math.max(0, nombre(cfg.percent, 0)))} % sur le panier${livraison}${phraseConditions(cfg)}`;
  if (regle.type === "fixed")
    return `-${euros(Math.max(0, Math.round(nombre(cfg.amountCents, 0))))} sur le panier${livraison}${phraseConditions(cfg)}`;
  if (regle.type === "free_shipping_over")
    return `Livraison offerte dès ${euros(Math.max(0, Math.round(nombre(cfg.thresholdCents, 0))))}`;
  return regle.type;
}

/**
 * Combien d'exemplaires il faut dans le panier pour que la règle se déclenche.
 *
 * Sert à l'écrire à l'écran : une offre qui ne se déclenche jamais parce que
 * personne n'achète autant d'affiches est une offre qui n'existe pas.
 */
export function seuilDeclenchement(regle: RegleParier): number {
  const { minQuantite } = lireConditions(regle.config);
  if (regle.type !== "buy_x_get_y") return Math.max(1, minQuantite ?? 1);
  const { achat, offert } = lireOffre(regle.config);
  return Math.max(achat.quantite + offert.quantite, minQuantite ?? 0);
}

/**
 * Le seuil à partir duquel la livraison est offerte, ou null.
 *
 * Quand plusieurs promotions en annoncent un, c'est le PLUS BAS qui vaut :
 * on ne fait pas payer le port à quelqu'un qui remplit l'une des conditions
 * affichées.
 *
 * Le montant comparé est le sous-total APRÈS remises — celui que le client
 * paie réellement pour les affiches. Comparer avant remise offrirait le port
 * sur un panier qui, une fois la promotion déduite, n'atteint plus le seuil.
 */
export function seuilPortOffertCents(
  regles: readonly RegleParier[],
  maintenant: Date = new Date(),
  codes: readonly string[] = [],
): number | null {
  let seuil: number | null = null;
  for (const regle of reglesActives(regles, maintenant, codes)) {
    if (regle.type !== "free_shipping_over") continue;
    const cfg = (regle.config ?? {}) as Record<string, unknown>;
    const v = Math.max(0, Math.round(nombre(cfg.thresholdCents, 0)));
    if (seuil === null || v < seuil) seuil = v;
  }
  return seuil;
}

/**
 * Le seuil de port offert à appliquer à CE panier : 0 quand une règle qui
 * offre la livraison joue (offreLaLivraison), sinon celui des promotions
 * « livraison offerte dès X € ».
 *
 * C'est lui que lisent la caisse et l'API au moment de chiffrer le port :
 * une seule fonction, pour que le port affiché soit le port encaissé.
 */
export function seuilPortCents(
  lignes: readonly LignePanier[],
  regles: readonly RegleParier[],
  maintenant: Date = new Date(),
  codes: readonly string[] = [],
): number | null {
  if (remisesPanier(lignes, regles, maintenant, codes).portOffert) return 0;
  return seuilPortOffertCents(regles, maintenant, codes);
}

export interface RemiseAppliquee {
  regle: string;
  montantCents: number;
}

/**
 * Remises applicables au panier, règle par règle.
 *
 * Les remises se cumulent dans l'ordre de priorité et le total est borné au
 * sous-total : une promo ne peut jamais rendre un panier négatif.
 *
 * Une règle peut refuser le cumul (`cumulable: false`) : elle ne joue alors
 * que si rien n'a encore été remisé, et quand elle joue, les suivantes ne
 * jouent plus. Une règle peut aussi demander un minimum d'achat (montant du
 * panier avant remise, ou nombre d'affiches) : en dessous, elle ne joue pas.
 *
 * `free_shipping_over` n'apparaît pas ICI : elle ne remise pas les affiches,
 * elle annule les frais de port. C'est `seuilPortOffertCents` qui la lit, et
 * le calcul de la livraison qui l'applique.
 *
 * `portOffert` : une règle qui joue offre aussi la livraison
 * (offreLaLivraison). Une règle « joue » quand elle passe tous les filtres —
 * active, code saisi, minimum atteint, cumul permis —, même s'il ne restait
 * plus rien à remiser : un panier déjà à zéro garde son port offert.
 */
export function remisesPanier(
  lignes: readonly LignePanier[],
  regles: readonly RegleParier[],
  maintenant: Date = new Date(),
  codes: readonly string[] = [],
): { remiseCents: number; detail: RemiseAppliquee[]; portOffert: boolean } {
  const sousTotal = sousTotalCents(lignes);
  const exemplaires = nombreDExemplaires(lignes);
  const detail: RemiseAppliquee[] = [];
  let remise = 0;
  let portOffert = false;

  for (const regle of reglesActives(regles, maintenant, codes)) {
    if (!(TYPES_REGLE_APPLIQUES as readonly string[]).includes(regle.type)) continue;
    const cfg = (regle.config ?? {}) as Record<string, unknown>;
    const restant = sousTotal - remise;
    const cumulable = estCumulable(cfg);
    // Une règle qui refuse le cumul n'a rien à faire après une autre.
    if (!cumulable && remise > 0) continue;
    const { minCents, minQuantite } = lireConditions(cfg);
    if ((minCents && sousTotal < minCents) || (minQuantite && exemplaires < minQuantite))
      continue;
    // La règle joue : si elle offre la livraison, c'est acquis.
    if (offreLaLivraison(regle)) portOffert = true;
    // Plus rien à remiser : les règles suivantes ne remisent rien non plus,
    // mais l'une d'elles peut encore offrir la livraison. Le résultat de la
    // remise est exactement celui d'avant, qui s'arrêtait ici.
    if (restant <= 0) continue;

    let montant = 0;
    if (regle.type === "buy_x_get_y") {
      montant = remiseOffre(lignes, lireOffre(cfg));
    } else if (regle.type === "percent") {
      const pct = Math.min(100, Math.max(0, nombre(cfg.percent, 0)));
      montant = Math.round((restant * pct) / 100);
    } else if (regle.type === "fixed") {
      montant = Math.max(0, Math.round(nombre(cfg.amountCents, 0)));
    }

    montant = Math.min(montant, restant);
    if (montant > 0) {
      remise += montant;
      detail.push({ regle: regle.name ?? regle.type, montantCents: montant });
      if (!cumulable) break;
    }
  }

  return { remiseCents: remise, detail, portOffert };
}

/** Total à payer, remises comprises. */
export function totalPanierCents(
  lignes: readonly LignePanier[],
  regles: readonly RegleParier[],
  maintenant: Date = new Date(),
  codes: readonly string[] = [],
): number {
  const sousTotal = sousTotalCents(lignes);
  const { remiseCents } = remisesPanier(lignes, regles, maintenant, codes);
  return Math.max(0, sousTotal - remiseCents);
}
