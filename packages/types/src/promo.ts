/**
 * Règles de panier — moteur PARTAGÉ.
 *
 * Le calcul vivait en trois exemplaires : l'API (montant réellement encaissé),
 * le panier et le tunnel de commande (montants affichés). Trois copies qui
 * divergent, c'est un client qui voit un prix et en paie un autre. Il n'y a
 * plus qu'une implémentation, ici, utilisée par les trois.
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
}

/** Une ligne de panier, réduite à ce dont le calcul a besoin. */
export interface LignePanier {
  unitPriceCents: number;
  quantity: number;
  /** "A4" | "A3" — sert aux règles restreintes à un format. */
  format?: string | null;
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
 * Règles actives à l'instant donné, de la plus prioritaire à la moins.
 *
 * Une règle porteuse d'un CODE est écartée tant que ce code n'a pas été
 * saisi : sans ce filtre, une promotion à code s'appliquerait à tout le monde
 * et le code ne servirait à rien.
 */
export function reglesActives<T extends RegleParier>(
  regles: readonly T[],
  maintenant: Date = new Date(),
  codes: readonly string[] = [],
): T[] {
  const saisis = new Set(codes.map(normaliserCode).filter(Boolean));
  return regles
    .filter((r) => r.active !== false)
    .filter((r) => {
      const code = normaliserCode(r.code);
      return !code || saisis.has(code);
    })
    .filter((r) => {
      const debut = date(r.startsAt);
      const fin = date(r.endsAt);
      return (!debut || debut <= maintenant) && (!fin || fin >= maintenant);
    })
    .sort((a, b) => nombre(b.priority, 0) - nombre(a.priority, 0));
}

/** Sous-total avant toute remise. */
export function sousTotalCents(lignes: readonly LignePanier[]): number {
  return lignes.reduce(
    (s, l) => s + nombre(l.unitPriceCents, 0) * Math.max(0, nombre(l.quantity, 0)),
    0,
  );
}

/** Prix unitaires dépliés (une entrée par exemplaire), filtrés par format. */
function unites(lignes: readonly LignePanier[], format?: unknown): number[] {
  const vise = typeof format === "string" && format ? format : null;
  const out: number[] = [];
  for (const l of lignes) {
    if (vise && (l.format ?? null) !== vise) continue;
    const q = Math.max(0, Math.floor(nombre(l.quantity, 0)));
    for (let i = 0; i < q; i++) out.push(nombre(l.unitPriceCents, 0));
  }
  return out.sort((a, b) => a - b);
}

/**
 * Part remisée sur les exemplaires offerts d'un « X achetées = Y ».
 *
 * Absent = 100 %, donc offert. Une règle enregistrée avant que la remise
 * partielle existe garde ainsi exactement le sens qu'elle avait.
 */
function pourcentageOffert(cfg: Record<string, unknown>): number {
  return Math.min(100, Math.max(0, nombre(cfg.percent, 100)));
}

/** « 4e », « 2e », « 1re » — le rang d'un exemplaire dans le panier. */
function rang(n: number): string {
  return n <= 1 ? "1re" : `${n}e`;
}

function euros(cents: number): string {
  const v = cents / 100;
  return (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(".", ",")) + " €";
}

/**
 * La règle, écrite en français.
 *
 * Le bandeau du site annonce une offre, le back-office la configure, le
 * panier la déduit : les trois doivent dire la même chose. Ils tiennent la
 * phrase d'ici, pour qu'aucun écran ne puisse promettre autre chose que ce
 * que le calcul fait.
 */
export function libelleRegle(regle: RegleParier): string {
  const cfg = (regle.config ?? {}) as Record<string, unknown>;
  if (regle.type === "buy_x_get_y") {
    const buyQty = Math.max(1, Math.floor(nombre(cfg.buyQty, 3)));
    const getQty = Math.max(1, Math.floor(nombre(cfg.getQty, 1)));
    const pct = pourcentageOffert(cfg);
    const format = typeof cfg.format === "string" && cfg.format ? cfg.format : null;
    const achetees = buyQty === 1 ? "1 affiche achetée" : `${buyQty} affiches achetées`;
    const cibles =
      getQty === 1
        ? `la ${rang(buyQty + 1)}`
        : `les ${rang(buyQty + 1)} à ${rang(buyQty + getQty)}`;
    const effet =
      pct >= 100
        ? getQty === 1
          ? "offerte"
          : "offertes"
        : `à -${pct} %`;
    const ou = format ? ` (format ${format} seulement)` : "";
    return `${achetees}, ${cibles} ${effet}${ou}`;
  }
  if (regle.type === "percent")
    return `-${Math.min(100, Math.max(0, nombre(cfg.percent, 0)))} % sur le panier`;
  if (regle.type === "fixed")
    return `-${euros(Math.max(0, Math.round(nombre(cfg.amountCents, 0))))} sur le panier`;
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
  const cfg = (regle.config ?? {}) as Record<string, unknown>;
  if (regle.type !== "buy_x_get_y") return 1;
  const buyQty = Math.max(1, Math.floor(nombre(cfg.buyQty, 3)));
  const getQty = Math.max(1, Math.floor(nombre(cfg.getQty, 1)));
  return buyQty + getQty;
}

/**
 * Le seuil à partir duquel la livraison est offerte, ou null.
 *
 * Quand plusieurs promotions en annoncent un, c'est le PLUS BAS qui vaut :
 * on ne fait pas payer le port à quelqu'un qui remplit l'une des conditions
 * affichées. C'est aussi ce que le bandeau laisse entendre.
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
 * `free_shipping_over` n'apparaît pas ICI : elle ne remise pas les affiches,
 * elle annule les frais de port. C'est `seuilPortOffertCents` qui la lit, et
 * le calcul de la livraison qui l'applique.
 */
export function remisesPanier(
  lignes: readonly LignePanier[],
  regles: readonly RegleParier[],
  maintenant: Date = new Date(),
  codes: readonly string[] = [],
): { remiseCents: number; detail: RemiseAppliquee[] } {
  const sousTotal = sousTotalCents(lignes);
  const detail: RemiseAppliquee[] = [];
  let remise = 0;

  for (const regle of reglesActives(regles, maintenant, codes)) {
    const cfg = (regle.config ?? {}) as Record<string, unknown>;
    const restant = sousTotal - remise;
    if (restant <= 0) break;
    let montant = 0;

    if (regle.type === "buy_x_get_y") {
      // Un LOT vaut `buyQty` exemplaires payés PLUS `getQty` remisés : c'est
      // ce que dit « 3 achetées, la 4e offerte », et c'est ce que fait
      // Shopify. Compter les lots sur `buyQty` seul offrait la troisième des
      // trois — les trois annoncées n'étaient jamais payées — et, sur
      // « 1 achetée, la 2e à -50 % », remisait le panier entier.
      const buyQty = Math.max(1, Math.floor(nombre(cfg.buyQty, 3)));
      const getQty = Math.max(1, Math.floor(nombre(cfg.getQty, 1)));
      // Sans pourcentage, l'exemplaire est offert : c'est le cas courant, et
      // c'est le sens des règles écrites avant que la remise partielle existe.
      const pct = pourcentageOffert(cfg);
      // Les MOINS CHERS d'abord : c'est ce que le client attend d'une offre,
      // et c'est ce que l'écran lui montre.
      const eligibles = unites(lignes, cfg.format);
      const offerts = Math.floor(eligibles.length / (buyQty + getQty)) * getQty;
      for (let i = 0; i < offerts && i < eligibles.length; i++) {
        montant += Math.round((eligibles[i]! * pct) / 100);
      }
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
    }
  }

  return { remiseCents: remise, detail };
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
