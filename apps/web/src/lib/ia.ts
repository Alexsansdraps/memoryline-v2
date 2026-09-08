/// <reference lib="dom" />
import { PUBLIC_API_URL } from "./api.ts";

/**
 * Affiches générées par IA — appels effectués DEPUIS LE NAVIGATEUR.
 *
 * Le client envoie une photo, l'API la donne à OpenAI et renvoie un aperçu
 * FILIGRANÉ. Aucun quota n'est appliqué ici : c'est un choix assumé de la
 * cliente, le client recommence autant qu'il veut. Les garde-fous (dépense
 * mensuelle, anti-rafale par IP) vivent côté serveur, et se traduisent pour
 * nous par un code d'échec à afficher poliment.
 */

/** Types d'image acceptés. Aligné sur ce qu'un téléphone produit. */
export const TYPES_PHOTO = ["image/jpeg", "image/png", "image/webp"] as const;

/** Poids maximal d'une photo, en octets (10 Mo). */
export const POIDS_PHOTO_MAX = 10 * 1024 * 1024;

/**
 * Cause d'échec, réduite à ce que le client peut comprendre ET corriger.
 *
 * Jamais le message brut du fournisseur : il est en anglais, il change sans
 * prévenir, et il peut décrire l'intérieur de notre service.
 */
export type EchecIA =
  | "indisponible"
  | "format"
  | "trop_lourde"
  | "rafale"
  | "plafond"
  | "generation"
  | "attente"
  | "inconnu";

export class ErreurIA extends Error {
  readonly code: EchecIA;
  constructor(code: EchecIA) {
    super(code);
    this.name = "ErreurIA";
    this.code = code;
  }
}

/** Une génération, telle que l'API la décrit. */
export interface GenerationIA {
  publicId: string;
  apercuUrl: string;
  status: "en_cours" | "prete" | "echec" | string;
}

/** Réponse brute de /ia/generer — l'aperçu se nomme « apercu » ou « apercuUrl ». */
interface GenerationBrute {
  publicId?: string;
  apercuUrl?: string;
  apercu?: string;
  status?: string;
}

/**
 * Traduit un code HTTP en cause d'échec.
 *
 * 404 vaut « indisponible » et pas « introuvable » : la fiche produit annonce
 * les affiches IA, une route absente doit donc dire au client que le service
 * n'est pas là — pas lui laisser une page cassée.
 */
function causeDuStatut(statut: number): EchecIA {
  if (statut === 404) return "indisponible";
  if (statut === 413) return "trop_lourde";
  if (statut === 415 || statut === 422) return "format";
  if (statut === 429) return "rafale";
  if (statut === 402 || statut === 403) return "plafond";
  // 502/503/504 : le service ne répond pas du tout (redémarrage, coupure).
  // Dire « la création a échoué » enverrait le client relancer dans le vide.
  if (statut === 502 || statut === 503 || statut === 504) return "indisponible";
  if (statut >= 500) return "generation";
  return "inconnu";
}

/** Vérifie la photo AVANT de la téléverser : inutile d'envoyer 30 Mo pour rien. */
export function verifierPhoto(fichier: File): EchecIA | null {
  if (!(TYPES_PHOTO as readonly string[]).includes(fichier.type))
    return "format";
  if (fichier.size > POIDS_PHOTO_MAX) return "trop_lourde";
  return null;
}

/** Envoie la photo du client. Renvoie le chemin que l'API lui a donné. */
export async function envoyerPhoto(fichier: File): Promise<string> {
  const cause = verifierPhoto(fichier);
  if (cause) throw new ErreurIA(cause);

  const corps = new FormData();
  corps.append("photo", fichier, fichier.name);

  let reponse: Response;
  try {
    reponse = await fetch(`${PUBLIC_API_URL}/ia/photo`, {
      method: "POST",
      body: corps,
    });
  } catch {
    // API injoignable : même effet visible qu'une route absente.
    throw new ErreurIA("indisponible");
  }
  if (!reponse.ok) throw new ErreurIA(causeDuStatut(reponse.status));

  // Le chemin de la photo se lit sous « chemin » ou sous « photo » : les deux
  // noms circulent, et une réponse valide ne doit pas tomber sur un message
  // d'erreur pour un mot près.
  const data = (await reponse.json().catch(() => null)) as {
    chemin?: string;
    photo?: string;
  } | null;
  const chemin = data?.chemin ?? data?.photo;
  if (!chemin) throw new ErreurIA("inconnu");
  return chemin;
}

/** Lance une génération. `precision` est la consigne libre du client. */
export async function genererAffiche(entree: {
  productId: number | string;
  photo: string;
  cartId: string;
  precision?: string;
}): Promise<GenerationIA> {
  let reponse: Response;
  try {
    reponse = await fetch(`${PUBLIC_API_URL}/ia/generer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: entree.productId,
        photo: entree.photo,
        cartId: entree.cartId,
        precision: entree.precision?.trim() || undefined,
      }),
    });
  } catch {
    throw new ErreurIA("indisponible");
  }
  if (!reponse.ok) throw new ErreurIA(causeDuStatut(reponse.status));

  const data = (await reponse
    .json()
    .catch(() => null)) as GenerationBrute | null;
  if (!data?.publicId) throw new ErreurIA("inconnu");
  if (data.status === "echec") throw new ErreurIA("generation");
  return {
    publicId: data.publicId,
    // À défaut d'adresse renvoyée, celle du contrat : elle se déduit du
    // publicId, qui suffit à retrouver l'aperçu.
    apercuUrl: data.apercuUrl || data.apercu || urlApercu(data.publicId),
    status: data.status ?? "prete",
  };
}

/** Adresse de l'aperçu filigrané d'une génération. */
export function urlApercu(publicId: string): string {
  return `${PUBLIC_API_URL}/ia/apercu/${publicId}`;
}

/** Rend absolue une adresse d'aperçu renvoyée par l'API (souvent relative). */
export function apercuAbsolu(url: string): string {
  return /^https?:\/\//.test(url) ? url : `${PUBLIC_API_URL}${url}`;
}

/**
 * Attend qu'un aperçu devienne chargeable.
 *
 * Le contrat n'expose pas d'état de génération : le seul signal disponible est
 * l'image elle-même, qui répond en erreur tant qu'elle n'est pas écrite. On
 * réessaie donc, avec un paramètre changeant pour ne pas se faire servir
 * l'échec mis en cache.
 */
export function attendreApercu(
  url: string,
  options: { delaiMs?: number; limiteMs?: number } = {},
): Promise<string> {
  const delai = options.delaiMs ?? 2500;
  const limite = options.limiteMs ?? 150_000;
  const depart = Date.now();

  return new Promise((resoudre, rejeter) => {
    let annule = false;
    const essayer = () => {
      if (annule) return;
      const image = new Image();
      const candidate = `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
      image.onload = () => resoudre(candidate);
      image.onerror = () => {
        if (Date.now() - depart > limite) {
          annule = true;
          rejeter(new ErreurIA("attente"));
          return;
        }
        setTimeout(essayer, delai);
      };
      image.src = candidate;
    };
    essayer();
  });
}
