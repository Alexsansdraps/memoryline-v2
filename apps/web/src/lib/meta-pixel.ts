/**
 * Le pixel Meta (28/11, demande de Margaux : « peux-tu installer le pixel Meta
 * sur memoryline.fr ? […] Le pixel doit se déclencher seulement après
 * acceptation des cookies (bandeau RGPD) »).
 *
 * Le code de base vit dans l'en-tête de chaque page (layouts/Base.astro) : il
 * ne crée `window.fbq` qu'une fois « Accepter » cliqué dans le bandeau cookies
 * (CookieBanner.astro, choix gardé dans localStorage « ml_cookie_consent »,
 * évènement « ml:consent »), seulement sur memoryline.fr (ni en local ni sur
 * une copie) et jamais à la tablette d'un stand (les ventes du stand ne sont
 * pas des achats en ligne, et c'est la tablette de Margaux).
 *
 * Ici, les évènements : sans accord ou sans `fbq` (tablette, local), ils ne
 * font RIEN — ni envoi, ni écriture dans le navigateur. Ils ne lèvent jamais
 * d'erreur et n'attendent rien : le panier et la caisse ne doivent pas pouvoir
 * tomber à cause d'une mesure (« touche pas aux commandes »).
 *
 * Rien de personnel ne part : des montants, des nombres d'articles, le numéro
 * d'affiche du catalogue. Jamais l'identifiant du panier : il vaut une clé (le
 * panier se lit et se modifie avec lui seul, sans compte).
 */

type Fbq = (...args: unknown[]) => void;

/** Le choix du bandeau cookies (CookieBanner.astro). */
const CLE_ACCORD = "ml_cookie_consent";

/**
 * La fonction `fbq` de Meta — seulement si la cliente a ACCEPTÉ les cookies,
 * et hors tablette d'un stand. L'accord est relu à chaque mesure : `fbq` seule
 * ne prouve rien (une autre balise pourrait la poser), et un « Refuser » coupe
 * aussitôt.
 */
function fbq(): Fbq | null {
  try {
    if (localStorage.getItem(CLE_ACCORD) !== "accept") return null;
    if (document.documentElement.getAttribute("data-stand") === "1") return null;
    const f = (window as unknown as { fbq?: Fbq }).fbq;
    return typeof f === "function" ? f : null;
  } catch {
    return null;
  }
}

/** Un évènement standard de Meta, avec un identifiant pour le dédoublonner. */
function suivre(f: Fbq, evenement: string, donnees: Record<string, unknown>, eventID?: string): void {
  try {
    if (eventID) f("track", evenement, donnees, { eventID });
    else f("track", evenement, donnees);
  } catch {
    /* une mesure ne casse jamais rien */
  }
}

const euros = (cents: number) => Math.round(cents) / 100;

/**
 * Ajout au panier (affiche, affiche IA, ciel, carte cadeau) : le montant de la
 * ligne que le SERVEUR a enregistrée (son prix et sa quantité), à défaut celui
 * envoyé.
 */
export function suivreAjoutPanier(envoye: Record<string, unknown>, recu: unknown): void {
  try {
    const f = fbq();
    if (!f) return;
    const r = (recu ?? {}) as { id?: unknown; unitPriceCents?: unknown; quantity?: unknown };
    const carte = (envoye.carteCadeau ?? null) as { montantCents?: unknown } | null;
    const prix = Number(r.unitPriceCents ?? envoye.unitPriceCents ?? carte?.montantCents ?? 0);
    const quantite = Number(r.quantity ?? envoye.quantity ?? 1) || 1;
    if (!Number.isFinite(prix) || prix <= 0) return;
    suivre(
      f,
      "AddToCart",
      {
        value: euros(prix * quantite),
        currency: "EUR",
        content_type: "product",
        ...(envoye.productId != null ? { content_ids: [String(envoye.productId)] } : {}),
        num_items: quantite,
      },
      r.id != null ? `ajout-${String(r.id)}` : undefined,
    );
  } catch {
    /* rien */
  }
}

/**
 * Début de paiement : la caisse ouverte sur un panier non vide, une fois par
 * panier et par onglet. L'identifiant du panier ne sert qu'à s'en souvenir
 * DANS l'onglet ; il ne part pas chez Meta.
 */
export function suivreDebutPaiement(cartId: string, montantCents: number, nbArticles: number): void {
  try {
    const f = fbq();
    if (!f || !cartId || !(montantCents > 0)) return;
    const cle = `ml_meta_caisse_${cartId}`;
    try {
      if (sessionStorage.getItem(cle)) return;
      sessionStorage.setItem(cle, "1");
    } catch {
      /* stockage refusé : on mesure quand même */
    }
    suivre(f, "InitiateCheckout", { value: euros(montantCents), currency: "EUR", num_items: nbArticles });
  } catch {
    /* rien */
  }
}

/** Les totaux des commandes créées dans CETTE page (numéro → centimes). */
const totaux = new Map<string, number>();

/**
 * La commande créée à la caisse : son numéro et son total, gardés pour
 * l'achat — en mémoire, et dans l'onglet (avec l'accord seulement) pour un
 * paiement à redirection (Bancontact, iDEAL…), qui revient sur une page neuve
 * qui ne connaît plus que le numéro.
 */
export function retenirCommande(numero: string, totalCents: number): void {
  try {
    totaux.set(numero, totalCents);
    if (!fbq()) return;
    sessionStorage.setItem(`ml_meta_commande_${numero}`, String(totalCents));
  } catch {
    /* sans stockage, l'achat se mesure seulement sans redirection */
  }
}

/** L'achat, sur l'écran « Merci », avec le montant réel de la commande ; une seule fois par commande. */
export function suivreAchat(numero: string | null | undefined): void {
  try {
    if (!numero) return;
    const f = fbq();
    if (!f) return;
    let total = totaux.get(numero);
    if (total == null) {
      try {
        const lu = sessionStorage.getItem(`ml_meta_commande_${numero}`);
        if (lu != null) total = Number(lu);
      } catch {
        /* rien */
      }
    }
    if (total == null || !Number.isFinite(total)) return;
    const cle = `ml_meta_achat_${numero}`;
    try {
      if (localStorage.getItem(cle)) return;
      localStorage.setItem(cle, "1");
      sessionStorage.removeItem(`ml_meta_commande_${numero}`);
    } catch {
      /* rien */
    }
    suivre(f, "Purchase", { value: euros(total), currency: "EUR" }, `achat-${numero}`);
  } catch {
    /* rien */
  }
}
