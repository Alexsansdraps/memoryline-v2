/**
 * L'encart vidéo du configurateur — partagé entre la boutique, le back-office
 * et l'API.
 *
 * Deux règles vivent ici, et chacune doit se lire pareil partout.
 *
 * 1. CINQ CLÉS PLATES, JAMAIS UN OBJET. `valeurDansLaLangue` (côté API) prend
 *    tout objet non-tableau pour un dictionnaire de langues : un réglage
 *    `{url, actif, poster}` rangé dans une seule clé renverrait « » au site,
 *    sans le moindre message d'erreur. On suit donc le patron de
 *    `cadres.site` — une clé, une valeur, cinq fois.
 *
 * 2. ON NE LIT QUE CE QU'ON SAIT LIRE. Une adresse non reconnue ne devient
 *    jamais une iframe au hasard : elle rend `null`, l'encart retombe sur son
 *    visuel d'attente et le back-office le dit. Mieux vaut une fente honnête
 *    qu'un lecteur à moitié cassé dans la fenêtre d'une cliente.
 *
 * Aucun préfixe privé : les clés commencent par « configurateur. » et surtout
 * pas par « ia. », que la route publique des réglages retire — la boutique ne
 * verrait alors jamais le réglage.
 */

/** L'encart vidéo est-il montré aux clientes ? Chaîne « on » / « off ». */
export const REGLAGE_VIDEO_VISIBLE = "configurateur.video.visible";
/** L'adresse de la vidéo : lien collé, ou « /assets/… » écrit par l'envoi. */
export const REGLAGE_VIDEO_URL = "configurateur.video.url";
/** L'image de façade montrée AVANT le clic. Facultative. */
export const REGLAGE_VIDEO_POSTER = "configurateur.video.poster";
/** Le titre de l'encart, traduisible. Vide = le texte d'usine. */
export const REGLAGE_VIDEO_TITRE = "configurateur.video.titre";
/** Le texte de l'encart, traduisible. Vide = le texte d'usine. */
export const REGLAGE_VIDEO_TEXTE = "configurateur.video.texte";

/**
 * Le réglage lu en base dit-il que l'encart est montré ?
 *
 * Absent, vide, ou n'importe quoi d'autre : OUI. C'est la règle de tous les
 * interrupteurs de l'écran « Contenu du site », et elle donne gratuitement ce
 * qu'Alexandra a demandé — l'encart, visuel d'attente compris, est là par
 * défaut, et un seul clic l'éteint. Seul un « non » explicite le cache.
 */
export function encartVideoAffiche(valeur: unknown): boolean {
  if (valeur === false || valeur === 0) return false;
  if (typeof valeur === "string")
    return !["false", "0", "off", "non", "no"].includes(
      valeur.trim().toLowerCase(),
    );
  return true;
}

/** Ce qu'on sait lire : un hébergeur encadré, ou un fichier à nous. */
export type SourceVideo =
  | { genre: "youtube"; id: string; embed: string }
  | { genre: "vimeo"; id: string; embed: string }
  | { genre: "fichier"; src: string }
  | null;

/** Les extensions de fichier vidéo qu'une adresse DISTANTE peut porter. */
const EXTENSIONS_VIDEO = [".mp4", ".webm", ".m4v", ".mov"];

/** L'identifiant d'une vidéo YouTube : onze caractères, et pas d'autres. */
const ID_YOUTUBE = /^[\w-]{11}$/;

/**
 * La clé de partage d'une vidéo Vimeo « non répertoriée » : de l'hexadécimal,
 * une dizaine de signes. On la valide avant de la recopier dans l'adresse du
 * lecteur — tout le reste du chemin est jeté.
 */
const HASH_VIMEO = /^[0-9a-f]{6,16}$/;

/**
 * Ce qu'on sait lire d'une adresse, et rien d'autre.
 *
 * Fonction PURE : ni DOM ni fetch. Elle sert au rendu serveur de la fiche
 * produit, dans l'île du navigateur, et dans le frontmatter du back-office
 * pour dire à Alexandra si son lien a été compris.
 *
 * Les deux hôtes sont encadrés — `youtube-nocookie.com` pour l'un, `dnt=1`
 * pour l'autre : le clic de la cliente autorise à LIRE une vidéo, pas à être
 * suivie.
 */
export function sourceVideo(brut: unknown): SourceVideo {
  if (typeof brut !== "string") return null;
  const adresse = brut.trim();
  if (!adresse) return null;

  // Un fichier de chez nous, servi par l'API : rien à analyser, c'est notre
  // origine et notre table MIME.
  if (adresse.startsWith("/assets/")) return { genre: "fichier", src: adresse };

  let u: URL;
  try {
    u = new URL(adresse);
  } catch {
    // Ni « /assets/… » ni une adresse absolue : on ne sait pas ce que c'est.
    return null;
  }
  // Un embed servi en http serait bloqué comme contenu mixte en production :
  // autant le refuser ici, où l'on peut encore le dire.
  if (u.protocol !== "https:") return null;

  const hote = u.hostname.toLowerCase();

  if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(hote)) {
    const segments = u.pathname.split("/").filter(Boolean);
    const id =
      u.searchParams.get("v") ??
      (segments[0] === "embed" || segments[0] === "shorts"
        ? (segments[1] ?? "")
        : "");
    if (!ID_YOUTUBE.test(id)) return null;
    return {
      genre: "youtube",
      id,
      embed: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1`,
    };
  }
  if (hote === "youtu.be") {
    const id = u.pathname.split("/").filter(Boolean)[0] ?? "";
    if (!ID_YOUTUBE.test(id)) return null;
    return {
      genre: "youtube",
      id,
      embed: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1`,
    };
  }

  if (hote === "vimeo.com" || hote === "player.vimeo.com") {
    // « /video/123456 » comme « /123456 » : on prend le premier nombre entier
    // du chemin, c'est toujours lui l'identifiant.
    const segments = u.pathname.split("/").filter(Boolean);
    const rang = segments.findIndex((s) => /^\d+$/.test(s));
    const id = rang < 0 ? "" : (segments[rang] ?? "");
    if (!id) return null;
    /*
     * LA CLÉ DE PARTAGE D'UNE VIDÉO « NON RÉPERTORIÉE ».
     *
     * On ne publie pas en clair une vidéo d'explication sur Vimeo : on la met
     * en « non répertoriée » et on colle le lien du bouton Partager. Vimeo le
     * donne sous deux formes, et TOUTES DEUX portent une clé :
     *   https://vimeo.com/76979871/3f1c2a9b8d      (dans le chemin)
     *   https://player.vimeo.com/video/76979871?h=3f1c2a9b8d
     *
     * Depuis 2021 le lecteur REFUSE de lire une vidéo non répertoriée sans sa
     * clé : il affiche « Private video ». La jeter ici donnerait le pire des
     * résultats — « Lien Vimeo reconnu. » au back-office, et un cadre en
     * erreur dans la fenêtre de la cliente. On la garde donc, validée, et on
     * la recopie dans l'adresse du lecteur.
     *
     * Le lien d'une vidéo publique, lui, n'en porte aucune : rien ne change.
     */
    const cle = segments[rang + 1] ?? u.searchParams.get("h") ?? "";
    const hash = HASH_VIMEO.test(cle) ? cle : "";
    return {
      genre: "vimeo",
      id,
      embed: `https://player.vimeo.com/video/${id}?autoplay=1&dnt=1${
        hash ? `&h=${hash}` : ""
      }`,
    };
  }

  // Un fichier hébergé ailleurs : c'est l'extension du CHEMIN qui décide, la
  // query n'en fait pas partie (un lien signé porte souvent une signature).
  const chemin = u.pathname.toLowerCase();
  if (EXTENSIONS_VIDEO.some((e) => chemin.endsWith(e)))
    return { genre: "fichier", src: adresse };

  return null;
}
