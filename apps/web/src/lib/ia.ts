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

/**
 * Le plus grand côté d'une photo réduite.
 *
 * La même valeur que celle du serveur : au-delà, on enverrait des pixels que
 * le modèle n'utilise pas. Un chiffre plus petit ici ferait perdre du détail
 * pour rien ; un plus grand ferait payer le trajet sans rien y gagner.
 */
const COTE_MAX = 2048;

/**
 * Réduit une photo dans le navigateur, avant tout envoi.
 *
 * Rend `null` si le navigateur n'y arrive pas — pas de canvas, format qu'il ne
 * sait pas décoder, image démesurée pour sa mémoire. L'appelant repart alors
 * sur le fichier d'origine et ses contrôles habituels : mieux vaut un envoi
 * lourd qu'un refus.
 *
 * `createImageBitmap` applique l'orientation EXIF au décodage, ce que
 * `<img>` ne garantit pas : sans cela, les photos prises à la verticale
 * arriveraient couchées.
 */
export async function reduirePhoto(fichier: File): Promise<File | null> {
  if (typeof createImageBitmap !== "function") return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(fichier, { imageOrientation: "from-image" });
  } catch {
    return null;
  }
  try {
    const facteur = Math.min(1, COTE_MAX / Math.max(bitmap.width, bitmap.height));
    const largeur = Math.max(1, Math.round(bitmap.width * facteur));
    const hauteur = Math.max(1, Math.round(bitmap.height * facteur));

    const toile = document.createElement("canvas");
    toile.width = largeur;
    toile.height = hauteur;
    const ctx = toile.getContext("2d");
    if (!ctx) return null;
    // Un fond blanc : un PNG transparent deviendrait noir en JPEG.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, largeur, hauteur);
    ctx.drawImage(bitmap, 0, 0, largeur, hauteur);

    const blob = await new Promise<Blob | null>((resoudre) =>
      toile.toBlob(resoudre, "image/jpeg", 0.85),
    );
    if (!blob || !blob.size) return null;
    // Si la « réduction » a grossi le fichier — une petite image déjà
    // compressée au maximum — on garde l'original. Sauf s'il est dans un
    // format que le serveur refuse (le HEIC d'un iPhone, que Safari sait
    // décoder) : le JPEG, même plus lourd, est alors la seule photo qui passe.
    if (
      blob.size >= fichier.size &&
      fichier.size <= POIDS_PHOTO_MAX &&
      (TYPES_PHOTO as readonly string[]).includes(fichier.type)
    )
      return null;
    return new File([blob], "photo.jpg", { type: "image/jpeg" });
  } catch {
    return null;
  } finally {
    bitmap.close?.();
  }
}

/** Vérifie la photo AVANT de la téléverser : inutile d'envoyer 30 Mo pour rien. */
export function verifierPhoto(fichier: File): EchecIA | null {
  const format = verifierFormatPhoto(fichier);
  if (format) return format;
  if (fichier.size > POIDS_PHOTO_MAX) return "trop_lourde";
  return null;
}

/**
 * Le FORMAT seul, sans le poids.
 *
 * L'écran s'en sert au moment où la personne choisit son fichier : le poids
 * n'y veut plus rien dire, puisque la photo sera réduite avant de partir. Un
 * fichier vide ou d'un type que le navigateur ne décodera pas, en revanche,
 * se refuse tout de suite plutôt qu'après une tentative de réduction.
 *
 * Un type VIDE passe : Android renvoie parfois une chaîne vide pour une photo
 * prise à l'instant, et la réduction dira bien assez tôt si c'en est une.
 */
export function verifierFormatPhoto(fichier: File): EchecIA | null {
  if (!fichier.size) return "format";
  if (fichier.type && !(TYPES_PHOTO as readonly string[]).includes(fichier.type))
    return "format";
  return null;
}

/** Envoie la photo du client. Renvoie le chemin que l'API lui a donné. */
export async function envoyerPhoto(fichier: File): Promise<string> {
  /*
   * On réduit AVANT de vérifier, et c'est tout l'intérêt : une photo de 20 Mo
   * sortie d'un téléphone récent était refusée d'emblée, alors qu'elle pèse
   * 400 Ko une fois ramenée à la taille que le modèle utilise réellement.
   *
   * Les contrôles ne portent donc que sur ce qui part vraiment. Ils restent
   * là pour le cas où la réduction n'a pas pu se faire : le fichier d'origine
   * repart alors tel quel, avec ses limites d'avant.
   */
  const reduite = await reduirePhoto(fichier);
  const aEnvoyer = reduite ?? fichier;

  const cause = verifierPhoto(aEnvoyer);
  if (cause) throw new ErreurIA(cause);

  const corps = new FormData();
  corps.append("photo", aEnvoyer, aEnvoyer.name);

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
/** Un style proposé à la cliente : son titre, ses images. Jamais sa consigne. */
export interface StyleIA {
  id: number;
  titre: string;
  images: string[];
}

/**
 * Les styles que la boutique propose.
 *
 * Un tableau vide n'est PAS une panne : c'est l'état d'une boutique qui n'en
 * a pas encore créé, et le parcours doit alors être exactement celui d'avant.
 * Une erreur réseau donne le même résultat — on ne prive personne de son
 * affiche parce qu'une liste d'ornements n'a pas pu être lue.
 */
export async function lireStyles(langue?: string): Promise<StyleIA[]> {
  try {
    const r = await fetch(
      `${PUBLIC_API_URL}/ia/prompts${langue ? `?lang=${encodeURIComponent(langue)}` : ""}`,
    );
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d) ? (d as StyleIA[]) : [];
  } catch {
    return [];
  }
}

export async function genererAffiche(entree: {
  productId: number | string;
  photo: string;
  cartId: string;
  precision?: string;
  /** Le style choisi, s'il y en a un. */
  promptId?: number | null;
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
        promptId: entree.promptId ?? undefined,
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

/* -------------------------------------------------------------------------- */
/*  Relais de photo : du téléphone du client à la tablette du stand            */
/* -------------------------------------------------------------------------- */

/**
 * Au stand, la photo est dans le téléphone du client. La tablette ouvre un
 * relais (un code court, montré en QR et en adresse), le téléphone y dépose
 * la photo, la tablette la relève. Voir apps/api/src/ia-relais.ts.
 */

/** Un relais ouvert par la tablette. */
export interface RelaisOuvert {
  /** Le code court de l'adresse : /photo/K7M2QX. */
  code: string;
  /** Le chemin de la page du téléphone, sans préfixe de langue. */
  chemin: string;
  /** Ce qui permet à la tablette, et à elle seule, de relever la photo. */
  jeton: string;
  resteSecondes: number;
}

/**
 * Pourquoi un relais n'a pas pu s'ouvrir : le code du stand refusé (fermé,
 * changé, mal tapé), trop de demandes, ou pas de réseau.
 */
export type EchecRelais = "code_stand" | "rafale" | "injoignable";

export class ErreurRelais extends Error {
  readonly code: EchecRelais;
  constructor(code: EchecRelais) {
    super(code);
    this.name = "ErreurRelais";
    this.code = code;
  }
}

/** Ouvre un relais. Le code du stand voyage dans un en-tête, comme au panier. */
export async function ouvrirRelais(codeStand: string): Promise<RelaisOuvert> {
  let reponse: Response;
  try {
    reponse = await fetch(`${PUBLIC_API_URL}/ia/relais`, {
      method: "POST",
      headers: { "X-Salon-Code": codeStand },
    });
  } catch {
    throw new ErreurRelais("injoignable");
  }
  if (reponse.status === 403) throw new ErreurRelais("code_stand");
  if (reponse.status === 429) throw new ErreurRelais("rafale");
  if (!reponse.ok) throw new ErreurRelais("injoignable");
  const d = (await reponse.json().catch(() => null)) as Partial<RelaisOuvert> | null;
  if (!d?.code || !d.jeton || !d.chemin) throw new ErreurRelais("injoignable");
  return {
    code: d.code,
    chemin: d.chemin,
    jeton: d.jeton,
    resteSecondes: Number(d.resteSecondes) || 0,
  };
}

/** Ce que la tablette trouve en passant relever le relais. */
export type ReleveRelais =
  | { etat: "attente"; resteSecondes: number | null }
  | {
      etat: "photo";
      fichier: File;
      /** Le numéro de la photo sur ce code : c'est lui qu'on confirme. */
      envoi: number;
      resteSecondes: number | null;
    }
  | { etat: "expire" };

/**
 * Passe voir si le téléphone a déposé une photo.
 *
 * La photo revient comme un fichier, exactement comme si on l'avait choisie
 * sur la tablette : l'écran la traite ensuite par le même chemin. Une erreur
 * réseau LÈVE — l'appelant réessaie au passage suivant, un wifi de marché qui
 * hoquette ne ferme pas le relais. La photo reste sur le serveur tant que
 * `confirmerReception` n'a pas été appelée : une réponse coupée en route est
 * resservie au passage suivant.
 */
export async function releverRelais(jeton: string, nomFichier: string): Promise<ReleveRelais> {
  const reponse = await fetch(`${PUBLIC_API_URL}/ia/relais`, {
    // X-Relais-Confirmation : cette page confirme la réception
    // (`confirmerReception`), le serveur garde donc la photo jusque-là.
    headers: { "X-Relais-Jeton": jeton, "X-Relais-Confirmation": "1" },
    cache: "no-store",
  });
  if (reponse.status === 404 || reponse.status === 410) return { etat: "expire" };
  const reste = Number(reponse.headers.get("X-Relais-Reste"));
  const resteSecondes = Number.isFinite(reste) && reponse.headers.has("X-Relais-Reste") ? reste : null;
  if (reponse.status === 204) return { etat: "attente", resteSecondes };
  if (!reponse.ok) throw new Error(`relais HTTP ${reponse.status}`);
  const envoi = Number(reponse.headers.get("X-Relais-Envoi"));
  // Lue en entier AVANT de répondre « photo » : une coupure au milieu du
  // transfert lève ici, et la photo attend toujours sur le serveur.
  const blob = await reponse.blob();
  return {
    etat: "photo",
    fichier: new File([blob], nomFichier, { type: "image/jpeg" }),
    envoi: Number.isInteger(envoi) && envoi > 0 ? envoi : 0,
    resteSecondes,
  };
}

/**
 * Dit au serveur que la photo n° `envoi` est arrivée entière : il l'efface.
 *
 * Renvoie `autre: true` quand le téléphone en a déposé une plus récente
 * entre-temps — la tablette doit alors repasser la chercher. Null si la
 * confirmation n'a pas pu partir, même après trois essais : la photo
 * s'efface de toute façon avec le code, le ménage du serveur y veille.
 */
export async function confirmerReception(
  jeton: string,
  envoi: number,
): Promise<{ autre: boolean } | null> {
  for (let essai = 0; essai < 3; essai++) {
    if (essai) await new Promise((r) => setTimeout(r, 1000));
    try {
      const reponse = await fetch(`${PUBLIC_API_URL}/ia/relais/recue`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Relais-Jeton": jeton },
        body: JSON.stringify({ envoi }),
      });
      // Relais fermé ou inconnu : il n'y a plus rien à confirmer.
      if (reponse.status === 404) return { autre: false };
      // Refusée pour de bon : la redemander n'y changerait rien.
      if (reponse.status >= 400 && reponse.status < 500) return null;
      if (!reponse.ok) continue;
      const d = (await reponse.json().catch(() => null)) as { autre?: unknown } | null;
      return { autre: d?.autre === true };
    } catch {
      // Un hoquet du réseau : l'essai suivant.
    }
  }
  return null;
}

/**
 * Ferme le relais : la photo qui attendrait encore est effacée du serveur, le
 * code expire. `keepalive` : la demande part même si la page se ferme.
 * Silencieuse — le ménage du serveur finit de toute façon le travail.
 */
export async function fermerRelais(jeton: string): Promise<void> {
  try {
    await fetch(`${PUBLIC_API_URL}/ia/relais`, {
      method: "DELETE",
      headers: { "X-Relais-Jeton": jeton },
      keepalive: true,
    });
  } catch {
    /* le code expirera de lui-même */
  }
}

/** Ce que le téléphone apprend de son code avant de proposer l'envoi. */
export type EtatCodeRelais = "valide" | "inconnu" | "expire" | "rafale" | "injoignable";

export async function verifierCodeRelais(code: string): Promise<EtatCodeRelais> {
  let reponse: Response;
  try {
    reponse = await fetch(`${PUBLIC_API_URL}/ia/relais/${encodeURIComponent(code)}`, {
      cache: "no-store",
    });
  } catch {
    return "injoignable";
  }
  if (reponse.ok) return "valide";
  if (reponse.status === 404) return "inconnu";
  if (reponse.status === 410) return "expire";
  if (reponse.status === 429) return "rafale";
  return "injoignable";
}

/** Pourquoi une photo n'est pas partie du téléphone. */
export type EchecEnvoiTelephone =
  | "inconnu"
  | "expire"
  | "format"
  | "trop_lourde"
  | "rafale"
  | "reseau";

export class ErreurEnvoiTelephone extends Error {
  readonly code: EchecEnvoiTelephone;
  constructor(code: EchecEnvoiTelephone) {
    super(code);
    this.name = "ErreurEnvoiTelephone";
    this.code = code;
  }
}

function causeEnvoiTelephone(statut: number): EchecEnvoiTelephone {
  if (statut === 404) return "inconnu";
  if (statut === 410) return "expire";
  if (statut === 413) return "trop_lourde";
  if (statut === 400 || statut === 415) return "format";
  if (statut === 429) return "rafale";
  return "reseau";
}

/**
 * Envoie la photo du téléphone vers la tablette.
 *
 * Réduite AVANT de partir, comme sur la boutique : une photo de 12 Mo sur le
 * réseau 4G saturé d'un marché de Noël, c'est une minute d'attente ; réduite,
 * quelques secondes. Le serveur la ré-encode de toute façon.
 *
 * XMLHttpRequest plutôt que fetch : c'est le seul qui dise où en est un
 * envoi, et une barre qui avance est ce qui retient le client de réessayer
 * pendant que sa photo monte.
 *
 * Renvoie le rang de la photo sur ce code (1 pour la première, 0 s'il n'a
 * pas pu être lu) : une fois la première reçue, la tablette n'affiche plus
 * les suivantes d'elle-même, et la page du téléphone doit le dire.
 */
export async function envoyerPhotoTelephone(
  code: string,
  fichier: File,
  progression: (etape: "preparation" | "envoi", pourcent: number) => void,
): Promise<number> {
  progression("preparation", 0);
  const aEnvoyer = (await reduirePhoto(fichier)) ?? fichier;
  const cause = verifierPhoto(aEnvoyer);
  if (cause === "format" || cause === "trop_lourde") throw new ErreurEnvoiTelephone(cause);

  progression("envoi", 0);
  const corps = new FormData();
  corps.append("photo", aEnvoyer, aEnvoyer.name);
  return new Promise<number>((resoudre, rejeter) => {
    const requete = new XMLHttpRequest();
    requete.open("POST", `${PUBLIC_API_URL}/ia/relais/${encodeURIComponent(code)}/photo`);
    requete.upload.onprogress = (e) => {
      if (e.lengthComputable) progression("envoi", Math.round((e.loaded / e.total) * 100));
    };
    requete.onload = () => {
      if (requete.status < 200 || requete.status >= 300) {
        rejeter(new ErreurEnvoiTelephone(causeEnvoiTelephone(requete.status)));
        return;
      }
      // La photo est arrivée : un rang illisible ne doit pas en faire un échec.
      let rang = 0;
      try {
        rang = Number((JSON.parse(requete.responseText) as { envois?: unknown }).envois);
      } catch {
        rang = 0;
      }
      resoudre(Number.isInteger(rang) && rang > 0 ? rang : 0);
    };
    requete.onerror = () => rejeter(new ErreurEnvoiTelephone("reseau"));
    requete.ontimeout = () => rejeter(new ErreurEnvoiTelephone("reseau"));
    // Deux minutes : large pour une photo réduite, même sur un réseau lent.
    requete.timeout = 120_000;
    requete.send(corps);
  });
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
