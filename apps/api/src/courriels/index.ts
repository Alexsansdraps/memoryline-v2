/**
 * Les courriels dans la langue du client.
 *
 * Tout ce qui décide en quelle langue part un courrier, et comment il s'y
 * écrit, vit ici et nulle part ailleurs : la langue retenue pour un
 * destinataire, les textes, les montants, les dates et les liens vers le site.
 * Deux endroits qui en décideraient chacun à sa façon finiraient par envoyer à
 * la même cliente une confirmation en anglais et une facture en français.
 */
import { FUSEAU_BOUTIQUE } from "@memoryline/types";
import { fr, type CleCourriel } from "./fr.js";
import { en } from "./en.js";
import { de } from "./de.js";
import { it } from "./it.js";
import { es } from "./es.js";

export type { CleCourriel };

/** Les langues du site, et donc des courriels. Le français d'abord. */
export const LANGUES_COURRIEL = ["fr", "en", "de", "it", "es"] as const;
export type Langue = (typeof LANGUES_COURRIEL)[number];

const DICTIONNAIRES: Record<Langue, Partial<Record<CleCourriel, string>>> = {
  fr,
  en,
  de,
  it,
  es,
};

/**
 * La locale de chaque langue, pour les montants et les dates. Les mêmes que
 * celles du site (LOCALE_COMPLETE, apps/web/src/i18n/ui.ts) : un prix écrit
 * « €49.00 » sur la page et « 49,00 € » dans le courrier ferait douter de l'un
 * des deux.
 */
export const LOCALE_COURRIEL: Record<Langue, string> = {
  fr: "fr-FR",
  en: "en-GB",
  de: "de-DE",
  it: "it-IT",
  es: "es-ES",
};

/** Vrai si la valeur est une des cinq langues. */
export function estLangue(v: unknown): v is Langue {
  return typeof v === "string" && (LANGUES_COURRIEL as readonly string[]).includes(v);
}

/**
 * Une langue reçue du site, d'un formulaire ou de la base, ou null.
 *
 * Seules les cinq langues passent : une valeur inconnue n'est pas « presque du
 * français », c'est une valeur qu'on n'écrit pas — l'appelant garde alors ce
 * qu'il avait, et le français reste le repli de dernier recours.
 */
export function langueLue(v: unknown): Langue | null {
  const l = String(v ?? "").trim().toLowerCase();
  return estLangue(l) ? l : null;
}

/**
 * La langue dans laquelle écrire à un client. LA règle, écrite une fois :
 *
 *   1. la langue de son COMPTE — celle qu'il a choisie lui-même, à
 *      l'inscription puis dans « Mes informations » ;
 *   2. sinon celle de la COMMANDE ou du panier (la page où il l'a remplie), ou
 *      celle de la page d'où part sa demande ;
 *   3. sinon le français.
 *
 * Le compte passe en premier parce que c'est un choix, et la page un simple
 * constat : une cliente qui a dit « mes e-mails en allemand » ne doit pas
 * recevoir une facture en anglais parce qu'elle a commandé un jour depuis la
 * page anglaise.
 */
export function langueDuDestinataire(o: {
  compte?: string | null;
  commande?: string | null;
}): Langue {
  return langueLue(o.compte) ?? langueLue(o.commande) ?? "fr";
}

/**
 * Remplit les {variables} d'un texte, en un seul passage : une valeur qui
 * contiendrait elle-même « {prenom} » (un titre d'affiche, un nom) ne doit pas
 * être remplacée à son tour. Une variable que l'appelant ne fournit pas reste
 * telle quelle — c'est le cas voulu des textes de relance, que le courrier
 * remplit plus tard avec ses propres variables.
 */
export function remplir(
  texte: string,
  valeurs?: Record<string, string | number>,
): string {
  if (!valeurs) return texte;
  return texte.replace(/\{([a-zA-Z_]+)\}/g, (tel, nom: string) =>
    Object.prototype.hasOwnProperty.call(valeurs, nom) ? String(valeurs[nom]) : tel,
  );
}

/**
 * Le traducteur des courriels d'une langue : `tc("de")("facture.objet", {…})`.
 *
 * Une clé absente de la langue demandée retombe sur le français : tant qu'une
 * phrase n'est pas traduite, elle part en français, jamais vide ni sous forme
 * de clé.
 */
export function tc(
  langue: Langue | null | undefined,
): (cle: CleCourriel, valeurs?: Record<string, string | number>) => string {
  const dico = DICTIONNAIRES[langue ?? "fr"] ?? fr;
  return (cle, valeurs) => remplir(dico[cle] ?? fr[cle], valeurs);
}

/**
 * Le texte d'une clé dans CETTE langue seulement, sans repli sur le français,
 * ou null s'il n'est pas traduit.
 *
 * Sert aux textes qui s'AJOUTENT au français plutôt que de le remplacer — la
 * traduction de la mention de TVA, imprimée sous la mention française. Avec le
 * repli ordinaire, une langue pas encore traduite imprimerait la même phrase
 * française deux fois.
 */
export function traductionPropre(langue: Langue, cle: CleCourriel): string | null {
  if (langue === "fr") return null;
  const texte = DICTIONNAIRES[langue][cle]?.trim();
  return texte ? texte : null;
}

/**
 * La mention de TVA, telle qu'elle s'imprime : en français TOUJOURS — c'est
 * une mention légale française, sa traduction n'a pas valeur d'original —,
 * puis, dans une autre langue, sa traduction pour que la cliente comprenne ce
 * qu'elle lit. Le courrier et la facture l'écrivent tous deux ainsi.
 */
export function mentionTva(langue: Langue | null | undefined): {
  francaise: string;
  traduction: string | null;
} {
  return {
    francaise: fr["mention.tva"],
    traduction: traductionPropre(langue ?? "fr", "mention.tva"),
  };
}

/**
 * Un montant en centimes, écrit à la manière de la langue.
 *
 * Le français garde SA forme, « 23,00 € », celle de tous les courriers et
 * factures d'avant : `Intl` y glisserait une espace insécable fine devant
 * l'euro, et le courrier français changerait d'un octet sans raison. Les
 * autres langues prennent celle de leur locale : « €23.00 » en anglais.
 */
export function prixDans(langue: Langue | null | undefined, cents: number): string {
  if (!langue || langue === "fr")
    return (cents / 100).toFixed(2).replace(".", ",") + " €";
  return new Intl.NumberFormat(LOCALE_COURRIEL[langue], {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

/**
 * « 10 septembre 2026 », « 10 September 2026 », « 10. September 2026 »…
 *
 * Le jour de PARIS, dit explicitement : c'est lui qui est imprimé sur la
 * facture (date d'émission, date de commande) et écrit dans les courriers. Une
 * commande passée le 31 à 0 h 30 est du 31, quelle que soit l'horloge de la
 * machine qui fabrique le PDF, et quelle que soit la langue de la cliente.
 */
export function dateLongue(langue: Langue | null | undefined, quand: Date): string {
  return quand.toLocaleDateString(LOCALE_COURRIEL[langue ?? "fr"], {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: FUSEAU_BOUTIQUE,
  });
}

/** « 10/09/2026 », « 10.9.2026 »… la date courte de la locale, à Paris. */
export function dateCourte(langue: Langue | null | undefined, quand: Date): string {
  return quand.toLocaleDateString(LOCALE_COURRIEL[langue ?? "fr"], {
    timeZone: FUSEAU_BOUTIQUE,
  });
}

/**
 * Le chemin d'une page du site dans une langue : « /compte » en français,
 * « /en/compte » en anglais. Le même découpage que `lien()` côté site
 * (apps/web/src/i18n/utils.ts) : le français reste à la racine, les autres
 * langues sont préfixées.
 *
 * Ne sert qu'aux pages rangées sous [...lang] : celles qui vivent hors du
 * préfixe, comme /panier/recuperer, prennent leur langue en « ?lang= ».
 */
export function cheminSite(langue: Langue | null | undefined, chemin: string): string {
  const c = chemin.startsWith("/") ? chemin : `/${chemin}`;
  if (!langue || langue === "fr") return c;
  return c === "/" ? `/${langue}` : `/${langue}${c}`;
}
