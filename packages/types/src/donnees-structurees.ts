/**
 * Les données structurées (schema.org) que le site publie pour Google, quand
 * elles se calculent à partir des réglages de la boutique : la livraison et
 * les retours d'une fiche, le fil d'Ariane et la liste d'un rayon.
 *
 * Fonctions pures, ici plutôt que dans le site : elles se testent avec le
 * reste (apps/api/tests/donnees-structurees.test.ts), et rien n'y est écrit
 * en dur qui doublerait un réglage du back-office — les tarifs viennent de
 * BO › Livraison, comme à la caisse (optionsLivraison).
 *
 * Pourquoi (AUDIT-SEO.md, DS-2 et DS-3) : sans livraison ni retours, la
 * Search Console signale chaque fiche en avertissement dans « Fiches
 * marchandes », et Google ne peut afficher ni frais de port ni conditions de
 * retour sous le résultat. Sans fil d'Ariane, un rayon ne dit pas à Google
 * où il se range.
 */
import {
  normaliserPays,
  optionsLivraison,
  passeLaDouane,
  type CatalogueLivraison,
} from "./livraison.js";

/** Une durée en jours ouvrés, de… à…. */
export interface Fourchette {
  min: number;
  max: number;
}

/**
 * Le délai de fabrication avant l'envoi : « Impression à la demande : 2 à 3
 * jours ouvrés », écrit dans la politique d'expédition de l'ancienne
 * boutique (memoryline.fr/policies/shipping-policy). Les conditions de
 * vente du nouveau site doivent dire la même chose (article 6).
 */
export const DELAI_PREPARATION: Fourchette = { min: 2, max: 3 };

/**
 * L'acheminement quand un mode ne dit pas le sien : « Délais selon
 * transporteur : 2 à 5 jours », même source.
 */
const ACHEMINEMENT_PAR_DEFAUT: Fourchette = { min: 2, max: 5 };

/**
 * Le délai écrit dans la description d'un mode (« Mondial Relay — 3 à 5
 * jours ouvrés »), ou null s'il n'y en a pas. C'est le texte que la caisse
 * montre : Google lit ainsi le même délai que la cliente.
 */
export function delaiDuMode(description: string | null | undefined): Fourchette | null {
  const m = /(\d+)\s*(?:à|a|-|–|to)\s*(\d+)\s*jours?/i.exec(description ?? "");
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

const jours = (f: Fourchette) => ({
  "@type": "QuantitativeValue",
  minValue: f.min,
  maxValue: f.max,
  unitCode: "DAY",
});

/**
 * La livraison d'une affiche au prix donné, zone par zone, au format
 * OfferShippingDetails : le mode le moins cher de la zone pour un colis de
 * ce poids, franchise de port comprise (une affiche à 23 € paie le port ;
 * une commande au-delà du seuil ne le paierait pas, mais l'offre décrit
 * l'achat de CETTE affiche seule).
 *
 * Le retrait sur place n'est pas une livraison : il n'est pas annoncé. Une
 * zone sans liste de pays (« Reste du monde ») non plus : on ne peut pas
 * nommer à Google des pays qu'elle ne cite pas.
 */
export function livraisonsStructurees(
  catalogue: CatalogueLivraison,
  prixCents: number,
  poidsGrammes = 0,
): Record<string, unknown>[] {
  const details: Record<string, unknown>[] = [];
  const zones = [...catalogue.zones].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  for (const zone of zones) {
    const tous = [...new Set((zone.countries ?? []).map(normaliserPays).filter(Boolean))];
    // Hors de l'Union européenne, pas de point relais (optionsLivraison) : la
    // Suisse, dans la zone « Europe », n'a pas le même mode le moins cher que
    // la Belgique. Un bloc par groupe de pays qui ont les mêmes modes.
    const groupes = [tous.filter((c) => !passeLaDouane(c)), tous.filter(passeLaDouane)];
    for (const pays of groupes) {
      if (!pays.length) continue;
      const options = optionsLivraison(catalogue, pays[0]!, prixCents, poidsGrammes).filter(
        (o) => o.mode.kind !== "pickup",
      );
      if (!options.length) continue;
      // À frais égaux, le premier dans l'ordre de la caisse : c'est celui que
      // le client voit en tête.
      const moinsCher = options.reduce((a, b) => (b.fraisCents < a.fraisCents ? b : a));
      details.push({
        "@type": "OfferShippingDetails",
        shippingRate: {
          "@type": "MonetaryAmount",
          value: (moinsCher.fraisCents / 100).toFixed(2),
          currency: "EUR",
        },
        shippingDestination: pays.map((c) => ({ "@type": "DefinedRegion", addressCountry: c })),
        deliveryTime: {
          "@type": "ShippingDeliveryTime",
          handlingTime: jours(DELAI_PREPARATION),
          transitTime: jours(delaiDuMode(moinsCher.mode.description) ?? ACHEMINEMENT_PAR_DEFAUT),
        },
      });
    }
  }
  return details;
}

/** Les pays où la boutique livre, tels que ses zones les citent. */
export function paysLivres(catalogue: CatalogueLivraison): string[] {
  return [
    ...new Set(catalogue.zones.flatMap((z) => (z.countries ?? []).map(normaliserPays))),
  ].filter(Boolean);
}

/**
 * Les retours, selon la nature de l'affiche — ce que disent les conditions
 * de vente (article 7) :
 * - une affiche personnalisée (ou tirée d'une photo) est exclue du droit de
 *   rétractation (article L221-28, 3° du Code de la consommation) : aucun
 *   retour ;
 * - une affiche prête à imprimer se retourne sous 14 jours, par la poste,
 *   aux frais du client.
 * Dans les deux cas, une affiche abîmée ou mal imprimée est refaite : c'est
 * la garantie, pas un retour, et schema.org n'a pas à le dire.
 */
export function politiqueDeRetour(
  nature: string,
  pays: readonly string[] = ["FR"],
): Record<string, unknown> {
  const applicableCountry = pays.length === 1 ? pays[0] : [...pays];
  if (nature === "prete_a_imprimer")
    return {
      "@type": "MerchantReturnPolicy",
      applicableCountry,
      returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
      merchantReturnDays: 14,
      returnMethod: "https://schema.org/ReturnByMail",
      returnFees: "https://schema.org/ReturnFeesCustomerResponsibility",
    };
  return {
    "@type": "MerchantReturnPolicy",
    applicableCountry,
    returnPolicyCategory: "https://schema.org/MerchantReturnNotPermitted",
  };
}

/** Une étape d'un fil d'Ariane ou d'une liste : son nom et son adresse complète. */
export interface LienStructure {
  nom: string;
  url: string;
}

/** Le fil d'Ariane (BreadcrumbList), dans l'ordre : Accueil › … › la page. */
export function filDAriane(etapes: readonly LienStructure[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: etapes.map((e, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: e.nom,
      item: e.url,
    })),
  };
}

/**
 * Une page de rayon (CollectionPage) et les affiches qu'elle montre, dans
 * l'ordre de la grille (ItemList). Seulement des adresses de fiches : Google
 * ne demande rien de plus pour une liste de résumés qui mènent chacun à sa
 * page, et en dire plus doublerait les données de chaque fiche.
 */
export function pageDeRayon(
  nom: string,
  url: string,
  fiches: readonly LienStructure[],
  premierRang = 1,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: nom,
    url,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: fiches.length,
      itemListElement: fiches.map((f, i) => ({
        "@type": "ListItem",
        position: premierRang + i,
        url: f.url,
        name: f.nom,
      })),
    },
  };
}
