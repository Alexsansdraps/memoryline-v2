import { apiInterne } from "./api-interne.ts";
import type { PosterConfig } from "@memoryline/types";
import { ui } from "../i18n/ui.ts";
import {
  LOCALE_COMPLETE,
  lien,
  type CleUi,
  type Langue,
} from "../i18n/utils.ts";

/**
 * Client de l'espace client, appelé DEPUIS LE RENDU SSR des pages /compte.
 *
 * Trois points ne vont pas de soi :
 *
 * 1. C'est le SERVEUR Astro qui parle à l'API (réseau interne Docker), pas le
 *    navigateur. Le cookie de session `ml_client` vit dans le navigateur du
 *    visiteur : il faut donc le RECOPIER à la main dans l'en-tête `Cookie` de
 *    l'appel sortant, sinon l'API voit une requête anonyme et répond 401.
 *
 * 2. Inversement, quand l'API répond un `Set-Cookie` (connexion, inscription,
 *    déconnexion), c'est la réponse d'Astro au navigateur qui doit le porter.
 *    On recopie donc chaque `set-cookie` dans `Astro.response.headers` — c'est
 *    ainsi, et seulement ainsi, que la connexion pose le cookie.
 *
 * 3. `Astro.redirect()` fabrique une réponse NEUVE qui ne garde que `Location`
 *    (cf. astro/dist/core/render-context.js) : le `Set-Cookie` tout juste
 *    relayé y serait perdu et le visiteur arriverait déconnecté sur /compte
 *    juste après s'être connecté. Toute redirection passe donc par
 *    `rediriger()`, qui recopie les en-têtes déjà posés.
 */

/**
 * URL de base de l'API — la MÊME logique que lib/api.ts : côté serveur on
 * parle au réseau interne Docker (`http://api:3000`), jamais à `/api` qui
 * n'est joignable que depuis le navigateur.
 */
const API_URL =
  apiInterne();

/** Ce que le client a besoin de connaître de l'objet `Astro` d'une page. */
export interface ContexteAstro {
  request: Request;
  response: { headers: Headers };
  url: URL;
}

export interface Client {
  id: number;
  email: string;
  /** Le nom complet, composé du prénom et du nom par l'API. */
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  acceptsMarketing: boolean;
  /**
   * La langue de ses e-mails, CHOISIE par le client ; null tant qu'il ne l'a
   * jamais choisie (comptes d'avant ce réglage). Absente sur une API d'une
   * version antérieure.
   */
  langue?: Langue | null;
  createdAt?: string | null;
}

export interface Adresse {
  id: number;
  label: string | null;
  name: string | null;
  line1: string | null;
  line2: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  isDefaultShipping: boolean;
  isDefaultBilling: boolean;
}

export interface Suivi {
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
}

export interface CommandeResume {
  id: number;
  number: string;
  createdAt: string;
  totalCents: number;
  articles: number;
  statutFinancier: string;
  statutExpedition: string;
  suivi: Suivi[];
}

export interface LigneCommande {
  id: number;
  title: string | null;
  quantity: number;
  unitPriceCents: number;
  config?: PosterConfig | null;
  /**
   * L'adresse de la vignette, servie par l'API et rendue côté serveur.
   *
   * Absente sur une API d'une version antérieure : la page affiche alors la
   * ligne sans image plutôt que de refuser de s'ouvrir.
   */
  apercu?: string | null;
}

export interface Expedition {
  id?: number;
  carrier?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  shippedAt?: string | null;
}

export interface Montants {
  sousTotalCents: number;
  remiseCents: number;
  portCents: number;
  totalCents: number;
  rembourseCents: number;
}

/** La commande telle qu'elle est en base — seules les colonnes affichées. */
export interface Commande {
  id: number;
  number: string;
  createdAt: string;
  shippingName: string | null;
  shippingLine1: string | null;
  shippingLine2: string | null;
  shippingPostalCode: string | null;
  shippingCity: string | null;
  shippingCountry: string | null;
  relayPointLabel: string | null;
}

export interface CommandeDetail {
  order: Commande;
  items: LigneCommande[];
  /**
   * Les cadres vendus sur CETTE commande, nommés — y compris ceux qui ont
   * depuis quitté le catalogue. Ils arrivent avec la commande justement pour
   * ça : le catalogue public, lui, ne rend que ce qui est encore en vente.
   *
   * Absente sur une API d'une version antérieure : la ligne retombe alors sur
   * son libellé générique plutôt que la page refuse de s'ouvrir.
   */
  cadres?: Cadre[];
  /**
   * Le mode de livraison tel que la cliente le lit : dans la langue demandée
   * quand la boutique l'a traduit, le nom français figé sur la commande sinon
   * (même règle que ses courriels et sa facture). `order`, lui, reste en
   * français. Absent sur une API d'une version antérieure.
   */
  livraison?: { nom: string | null; description: string | null };
  /**
   * Pour un retrait sur place : le lieu où venir chercher la commande, tel
   * que la cliente l'a choisi à la caisse (nom et texte dans sa langue quand
   * la boutique les a traduits). Null sinon ; absent sur une API d'une
   * version antérieure. La page l'affiche à la place de l'adresse.
   */
  lieuRetrait?: {
    nom: string;
    adresse: string | null;
    description: string | null;
  } | null;
  expeditions: Expedition[];
  montants: Montants;
  statutFinancier: string;
  statutExpedition: string;
}

/** Un cadre vendu sur une commande — sert à nommer l'option de la ligne. */
export interface Cadre {
  id: number;
  name: string;
}

export interface Reponse<T> {
  ok: boolean;
  statut: number;
  donnees: T | null;
  /** Vrai quand l'API n'a pas répondu du tout (conteneur éteint, réseau). */
  injoignable: boolean;
  /** Clé de message prête à traduire ; nulle quand tout s'est bien passé. */
  erreur: CleUi | null;
}

type Methode = "GET" | "POST" | "DELETE";

/**
 * Les `Set-Cookie` d'une réponse — il peut y en avoir plusieurs, et
 * `headers.get()` les collerait en une seule chaîne illisible pour le
 * navigateur. `getSetCookie()` existe depuis Node 18.15 ; le repli couvre les
 * runtimes plus anciens.
 */
function setCookies(res: Response): string[] {
  const entetes = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof entetes.getSetCookie === "function") return entetes.getSetCookie();
  const brut = res.headers.get("set-cookie");
  return brut ? [brut] : [];
}

/**
 * Message à afficher pour un code HTTP. Le visiteur ne doit jamais lire un
 * numéro : il lit une phrase qui lui dit quoi faire.
 *
 * 404 vaut « indisponible » : nos routes existent, un 404 signifie que l'API
 * n'expose pas (encore) l'espace client. Les pages qui attendent un vrai 404
 * métier — le détail d'une commande — le traitent avant de lire ce message.
 */
function messageHttp(statut: number): CleUi {
  if (statut === 401) return "compte.err.identifiants";
  if (statut === 409) return "compte.err.deja_inscrit";
  if (statut === 404 || statut >= 500) return "compte.err.indisponible";
  return "compte.err.generique";
}

async function appel<T>(
  astro: ContexteAstro,
  chemin: string,
  options: { methode?: Methode; corps?: unknown } = {},
): Promise<Reponse<T>> {
  const entetes = new Headers();
  const cookie = astro.request.headers.get("cookie");
  if (cookie) entetes.set("cookie", cookie);
  // L'API décide du drapeau `Secure` du cookie d'après le protocole ; vue
  // d'elle notre appel interne est toujours en clair. On lui repasse donc
  // celui du visiteur, tel que le proxy nous l'a annoncé.
  entetes.set(
    "x-forwarded-proto",
    astro.request.headers.get("x-forwarded-proto") ??
      astro.url.protocol.replace(":", ""),
  );
  if (options.corps !== undefined) entetes.set("content-type", "application/json");

  let res: Response;
  try {
    res = await fetch(`${API_URL}${chemin}`, {
      method: options.methode ?? "GET",
      headers: entetes,
      body:
        options.corps === undefined ? undefined : JSON.stringify(options.corps),
    });
  } catch {
    return {
      ok: false,
      statut: 0,
      donnees: null,
      injoignable: true,
      erreur: "compte.err.indisponible",
    };
  }

  for (const valeur of setCookies(res))
    astro.response.headers.append("set-cookie", valeur);

  let donnees: T | null = null;
  try {
    donnees = (await res.json()) as T;
  } catch {
    // Corps vide ou non JSON (404 texte de Hono) : ce n'est pas une erreur en
    // soi, le code HTTP suffit à décider quoi afficher.
  }

  return {
    ok: res.ok,
    statut: res.status,
    donnees: res.ok ? donnees : null,
    injoignable: false,
    erreur: res.ok ? null : messageHttp(res.status),
  };
}

/**
 * Le client contenu dans une réponse.
 *
 * Le contrat annonce `{customer}` ; on accepte aussi l'objet nu, pour qu'un
 * désaccord sur l'enveloppe ne vide pas d'un coup toutes les pages du compte.
 */
function clientDepuis(donnees: unknown): Client | null {
  if (!donnees || typeof donnees !== "object") return null;
  const enveloppe = donnees as Record<string, unknown>;
  const brut = (enveloppe.customer as Record<string, unknown>) ?? enveloppe;
  return typeof brut?.email === "string" ? (brut as unknown as Client) : null;
}

async function appelClient(
  astro: ContexteAstro,
  chemin: string,
  options: { methode?: Methode; corps?: unknown } = {},
): Promise<Reponse<Client>> {
  const r = await appel<unknown>(astro, chemin, options);
  return { ...r, donnees: r.ok ? clientDepuis(r.donnees) : null };
}

/* --- Session --------------------------------------------------------------- */

/**
 * Découpe un nom complet en prénom + nom, faute de mieux.
 *
 * Le dernier mot fait le nom, le reste le prénom. C'est faux pour
 * « Jean-Pierre de la Tour », et c'est assumé : cela ne sert qu'aux fiches
 * qui n'ont QU'un nom complet — celles d'avant que le compte porte les deux
 * séparément, et les adresses du carnet. Le résultat est toujours affiché
 * dans un champ modifiable, jamais écrit en base sans que quelqu'un l'ait vu.
 *
 * Un compte qui connaît déjà ses deux valeurs ne passe jamais par ici.
 */
export function decouperNom(complet: string | null | undefined): {
  prenom: string;
  nom: string;
} {
  const mots = String(complet ?? "").trim().split(/\s+/).filter(Boolean);
  if (mots.length === 0) return { prenom: "", nom: "" };
  if (mots.length === 1) return { prenom: "", nom: mots[0]! };
  return { prenom: mots.slice(0, -1).join(" "), nom: mots[mots.length - 1]! };
}

export const moi = (astro: ContexteAstro) => appelClient(astro, "/compte/moi");

export const connexion = (
  astro: ContexteAstro,
  corps: { email: string; password: string },
) => appelClient(astro, "/compte/connexion", { methode: "POST", corps });

export const inscription = (
  astro: ContexteAstro,
  corps: {
    email: string;
    password: string;
    /** Prénom et nom séparés ; l'API en compose le nom complet. */
    firstName?: string;
    lastName?: string;
    name?: string;
    acceptsMarketing?: boolean;
    /** La langue de ses e-mails : celle de la page, sauf choix contraire. */
    langue?: Langue;
  },
) => appelClient(astro, "/compte/inscription", { methode: "POST", corps });

export const deconnexion = (astro: ContexteAstro) =>
  appel<{ ok: boolean }>(astro, "/compte/deconnexion", { methode: "POST" });

export const majInfos = (
  astro: ContexteAstro,
  corps: {
    firstName?: string;
    lastName?: string;
    name?: string;
    phone?: string;
    acceptsMarketing?: boolean;
    langue?: Langue;
  },
) => appelClient(astro, "/compte/moi", { methode: "POST", corps });

/**
 * `langue` : celle de la page, pour l'avis de sécurité d'un compte qui n'a
 * pas encore choisi la sienne. Celle du compte, quand elle existe, l'emporte.
 */
export const changerMotDePasse = (
  astro: ContexteAstro,
  corps: { ancien: string; nouveau: string; langue?: Langue },
) =>
  appel<{ ok: boolean }>(astro, "/compte/mot-de-passe", {
    methode: "POST",
    corps,
  });

/**
 * `langue` : celle de la page. Le courrier part pourtant dans la langue du
 * compte quand le client l'a choisie — c'est l'API qui tranche.
 */
export const motDePasseOublie = (
  astro: ContexteAstro,
  email: string,
  langue?: Langue,
) =>
  appel<{ ok: boolean }>(astro, "/compte/mot-de-passe-oublie", {
    methode: "POST",
    corps: { email, ...(langue ? { langue } : {}) },
  });

/** `langue` : celle de la page, même rôle que pour `changerMotDePasse`. */
export const reinitialiserMotDePasse = (
  astro: ContexteAstro,
  corps: { token: string; nouveau: string; langue?: Langue },
) =>
  appel<{ ok: boolean }>(astro, "/compte/mot-de-passe-reinitialiser", {
    methode: "POST",
    corps,
  });

/* --- Commandes et adresses ------------------------------------------------- */

export const commandes = (astro: ContexteAstro) =>
  appel<CommandeResume[]>(astro, "/compte/commandes");

/**
 * Le détail d'une commande. `langue` : celle de la page — le nom des cadres
 * et du mode de livraison s'y lisent (repli français). Rien n'est demandé
 * pour le français : la réponse y est celle d'avant.
 */
export const commande = (astro: ContexteAstro, id: string, langue?: Langue) =>
  appel<CommandeDetail>(
    astro,
    `/compte/commandes/${encodeURIComponent(id)}${langue && langue !== "fr" ? `?lang=${langue}` : ""}`,
  );

export const adresses = (astro: ContexteAstro) =>
  appel<Adresse[]>(astro, "/compte/adresses");

export const enregistrerAdresse = (
  astro: ContexteAstro,
  corps: Partial<Adresse>,
) => appel<Adresse>(astro, "/compte/adresses", { methode: "POST", corps });

export const supprimerAdresse = (astro: ContexteAstro, id: number | string) =>
  appel<{ ok: boolean }>(astro, `/compte/adresses/${encodeURIComponent(id)}`, {
    methode: "DELETE",
  });

/* --- Redirections et session ----------------------------------------------- */

/**
 * Redirection qui CONSERVE les en-têtes déjà posés sur `Astro.response` —
 * notamment le `Set-Cookie` de session relayé par l'appel qui précède.
 *
 * 303 par défaut : après le POST d'un formulaire, il force le navigateur à
 * repasser en GET, ce qui évite le renvoi du formulaire au rafraîchissement.
 */
/**
 * Le chemin de retour demandé, s'il est sûr.
 *
 * Uniquement un chemin interne : « /commande » oui, « //ailleurs.fr » et
 * « https://ailleurs.fr » non. Sans ce contrôle, un lien pourrait faire
 * atterrir la cliente sur un autre site juste après sa connexion, au moment
 * précis où elle croit être chez nous.
 */
export function retourSur(brut: string | null | undefined): string | null {
  const v = (brut ?? "").trim();
  if (!v.startsWith("/") || v.startsWith("//")) return null;
  return v.slice(0, 300);
}

export function rediriger(
  astro: ContexteAstro,
  cible: string,
  statut = 303,
): Response {
  const entetes = new Headers(astro.response.headers);
  entetes.set("Location", cible);
  return new Response(null, { status: statut, headers: entetes });
}

export type Session =
  | { etat: "connecte"; client: Client }
  | { etat: "anonyme"; redirection: Response }
  | { etat: "indisponible"; erreur: CleUi };

/**
 * État du visiteur devant une page protégée. Trois issues, et pas deux :
 * l'API muette ne doit PAS renvoyer vers la connexion, car cette page-là
 * échouerait pareillement — le visiteur ferait des allers-retours sans jamais
 * lire ce qui se passe. On lui affiche l'explication à la place.
 */
export async function exigerSession(
  astro: ContexteAstro,
  langue: Langue,
): Promise<Session> {
  const r = await moi(astro);
  if (r.ok && r.donnees) return { etat: "connecte", client: r.donnees };
  if (r.statut === 401)
    return {
      etat: "anonyme",
      redirection: rediriger(astro, lien(langue, "/compte/connexion"), 302),
    };
  return { etat: "indisponible", erreur: r.erreur ?? "compte.err.indisponible" };
}

/* --- Mise en forme --------------------------------------------------------- */

/**
 * Libellé lisible d'un statut renvoyé par l'API.
 *
 * L'API expose des codes (« paye », « partiellement_expedie ») et ses propres
 * libellés sont en français : la boutique étant traduite en cinq langues, elle
 * les retraduit. Un code inconnu s'affiche tel quel — un mot brut vaut mieux
 * qu'une case vide.
 */
export function libelleStatut(
  tr: (cle: CleUi) => string,
  genre: "financier" | "expedition",
  valeur: string | null | undefined,
): string {
  if (!valeur) return "—";
  // NFD détache les accents, que le filtre suivant emporte avec les espaces et
  // la ponctuation : « Partiellement remboursé » retombe donc sur la même clé
  // que le code « partiellement_rembourse ».
  const normalise = valeur
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const cle = `compte.statut.${genre}.${normalise}`;
  return cle in ui.fr ? tr(cle as CleUi) : valeur;
}

/** Date lisible dans la langue de la page. */
export function formatDate(
  iso: string | null | undefined,
  langue: Langue,
): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat(LOCALE_COMPLETE[langue], {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(d);
}

/**
 * Lignes de l'adresse de livraison, prêtes à empiler.
 *
 * Les champs vides sont retirés plutôt que rendus : une commande livrée en
 * point relais n'a pas de complément d'adresse, et une ligne blanche au
 * milieu d'une adresse se lit comme une erreur d'affichage.
 */
export function adresseLivraison(order: Commande): string[] {
  const codeEtVille = [order.shippingPostalCode, order.shippingCity]
    .filter(Boolean)
    .join(" ");
  return [
    order.shippingName,
    order.shippingLine1,
    order.shippingLine2,
    codeEtVille,
    order.shippingCountry,
    order.relayPointLabel,
  ]
    .map((ligne) => ligne?.trim() ?? "")
    .filter(Boolean);
}
