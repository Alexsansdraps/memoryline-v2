/**
 * SendCloud : le transporteur vu de la boutique, et les clés qu'Alexandra pose
 * elle-même.
 *
 * DEUX CHOSES VIVENT DANS CE FICHIER, ET C'EST VOULU. Le fichier qui porte la
 * paire de clés est lu ici, écrit ici, et nulle part ailleurs ; les deux
 * routes de l'écran Livraison sont montées ici aussi, à côté du seul code qui
 * a le droit d'en connaître la valeur. Un secret qui se promène dans trois
 * fichiers finit par sortir par le quatrième.
 *
 * LE SECRET NE SORT JAMAIS. Aucune route ne le renvoie, aucune ligne de
 * journal ne le porte, aucun message d'erreur ne le recopie. L'écran n'en
 * montre que les quatre derniers caractères de la clé PUBLIQUE — la moitié
 * « identifiant » de la paire —, la date de pose et le résultat de la dernière
 * vérification.
 *
 * POURQUOI UN FICHIER PLUTÔT QUE LA BASE OU LE .env. La table `setting` part
 * en clair dans un pg_dump gardé quatorze jours, que le script de sauvegarde
 * apprend en plus à rapatrier par scp ; et le .env demande un accès SSH, donc
 * un développeur, donc une clé qui transite par un message. Ici Alexandra
 * colle ses clés dans son navigateur, l'API écrit le fichier, et personne
 * d'autre ne les voit jamais. Ce fichier n'entre dans AUCUNE sauvegarde : une
 * paire perdue se refait chez SendCloud en deux minutes, ce qui est un bien
 * meilleur mode de panne qu'une clé recopiée dans quatorze archives.
 *
 * RELECTURE À CHAUD. Tous les `estConfigure()` du dépôt lisent une constante
 * figée à l'import (mondial-relay.ts, colissimo.ts) : y poser une clé exige un
 * redémarrage de conteneur. Ici le fichier est relu dès qu'il change, donc
 * elle colle, elle clique « Vérifier le compte », le voyant s'allume — sans
 * appeler personne.
 */
import type { Hono } from "hono";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { resolve } from "node:path";
import { db, schema } from "./db/client.js";
import { DOSSIER_SECRETS } from "./stockage-prive.js";

/* -------------------------------------------------------------------------- */
/*  Où l'on appelle — et la garde qui empêche de se tromper de côté           */
/* -------------------------------------------------------------------------- */

/** L'adresse de l'API v3. La SEULE qui achète pour de vrai. */
const BASE_OFFICIELLE = "https://panel.sendcloud.sc/api/v3";

/**
 * Le banc d'essai : scripts/faux-sendcloud.ts, démarré par
 * `docker compose --profile essais up -d faux-sendcloud`.
 */
const BASE_ESSAI = "http://faux-sendcloud:3100/api/v3";

const EN_PRODUCTION = process.env.NODE_ENV === "production";

/**
 * L'adresse effectivement appelée.
 *
 * LE DÉFAUT N'EST PAS LE MÊME DES DEUX CÔTÉS, ET C'EST TOUT L'INTÉRÊT.
 * En production, sans variable, on tombe sur l'adresse officielle : c'est la
 * seule qui fabrique de vraies étiquettes, et un oubli ne doit pas débrancher
 * la boutique. Partout ailleurs, sans variable, on tombe sur le FAUX.
 *
 * Retomber sur l'adresse officielle en développement était le seul endroit du
 * module où le défaut ne protégeait pas : un conteneur qu'on a oublié de
 * recréer, un `pnpm dev` hors Docker ou un script lancé à la main envoyait la
 * clé secrète d'Alexandra au vrai service sans que personne l'ait choisi, et
 * l'écran ne le disait même pas — il masque justement la ligne « serveur
 * d'essai » quand `reel` est vrai. Le mauvais côté de ce défaut-là était
 * silencieux ; celui-ci se voit tout de suite : si le faux n'est pas lancé,
 * l'appel échoue en « SendCloud n'a pas répondu », et rien n'est sorti de la
 * machine.
 */
const BASE =
  (process.env.SENDCLOUD_BASE_URL ?? "").trim().replace(/\/+$/, "") ||
  (EN_PRODUCTION ? BASE_OFFICIELLE : BASE_ESSAI);

/*
 * LA GARDE DE PRODUCTION, PREMIÈRE MOITIÉ : ON NE DÉMARRE PAS DE TRAVERS.
 *
 * En production, une adresse autre que l'officielle voudrait dire que la
 * boutique fabrique ses étiquettes chez un serveur d'essai : Alexandra
 * imprimerait des bordereaux « SANS VALEUR » et les collerait sur de vrais
 * colis, qui ne partiraient nulle part. L'API refuse alors de démarrer — une
 * panne franche au déploiement vaut mieux qu'une boutique qui a l'air de
 * marcher. Le cas ne peut pas arriver par oubli : en production, sans la
 * variable, on tombe sur l'adresse officielle.
 */
if (EN_PRODUCTION && BASE !== BASE_OFFICIELLE) {
  throw new Error(
    `SENDCLOUD_BASE_URL vaut « ${BASE} » alors que la boutique tourne en production. ` +
      `En production, les étiquettes se fabriquent chez ${BASE_OFFICIELLE} et nulle part ailleurs : ` +
      `retirez cette variable de la configuration du serveur, puis redémarrez.`,
  );
}

/** Vrai quand les appels partent vers le vrai SendCloud. */
export function sendcloudEstReel(): boolean {
  return BASE === BASE_OFFICIELLE;
}

/* -------------------------------------------------------------------------- */
/*  Les clés                                                                  */
/* -------------------------------------------------------------------------- */

const FICHIER_CLES = resolve(DOSSIER_SECRETS, "sendcloud.json");

/** Ce que porte le fichier privé. Rien d'autre n'y est écrit. */
interface ClesSendcloud {
  clePublique: string;
  cleSecrete: string;
  /** L'adresse de la session qui les a posées, comme l'auteur d'un événement. */
  posePar: string;
  poseeAt: string;
  /** Date du dernier essai de vérification, réussi ou non. */
  verifieeAt: string | null;
  /** null = jamais vérifiées ; false = SendCloud les a refusées. */
  verificationOk: boolean | null;
  /**
   * LA RAISON SURVIT AU MESSAGE ÉPHÉMÈRE, et c'est tout l'objet de ce champ.
   *
   * Un 404 laisse `verificationOk` à null : l'écran retombe donc sur « ces
   * clés n'ont jamais été vérifiées » et, sans cette mémoire, sur son
   * impératif « Cliquez sur « Vérifier le compte » ». Le message du clic, lui,
   * venait de dire « recliquer n'y changera rien » : les deux phrases se
   * retrouvaient l'une sous l'autre dans le même écran, et au rechargement
   * suivant la seule qui survivait était la fausse.
   *
   * false = le dernier essai a échoué sur un défaut de la boutique (adresse
   * d'appel inconnue, réponse incompréhensible) : recliquer ne peut pas
   * aboutir. true = panne passagère, cadence, réseau : recliquer a un sens.
   * null = aucun essai resté sans réponse en mémoire.
   */
  verificationReessayer: boolean | null;
}

/**
 * Le cache, invalidé par l'empreinte du fichier (date de modification +
 * taille).
 *
 * Il évite de relire le disque à chaque appel sans jamais servir une valeur
 * périmée : le fichier change, l'empreinte change, la relecture a lieu. La
 * taille accompagne la date parce qu'un montage Windows ne date pas à la
 * milliseconde — deux écritures très rapprochées pourraient porter la même.
 * L'écriture d'ici vide le cache elle-même : l'empreinte ne protège que contre
 * les changements venus d'ailleurs (un fichier remplacé à la main sur le
 * serveur).
 */
let cache: { empreinte: string; cles: ClesSendcloud | null } | null = null;

/** L'empreinte du fichier, ou « absent » s'il n'y en a pas. */
async function empreinte(): Promise<string> {
  try {
    const s = await stat(FICHIER_CLES);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return "absent";
  }
}

/**
 * Les clés en place, ou null.
 *
 * Une paire incomplète vaut une absence : une clé publique sans sa clé secrète
 * n'authentifie rien, et laisser croire le contraire ferait afficher un voyant
 * vert devant un bouton qui échouera.
 */
async function lireCles(): Promise<ClesSendcloud | null> {
  const e = await empreinte();
  if (cache && cache.empreinte === e) return cache.cles;

  let cles: ClesSendcloud | null = null;
  if (e !== "absent") {
    try {
      const brut = JSON.parse(await readFile(FICHIER_CLES, "utf8")) as Partial<ClesSendcloud>;
      const clePublique = String(brut.clePublique ?? "").trim();
      const cleSecrete = String(brut.cleSecrete ?? "").trim();
      if (clePublique && cleSecrete) {
        cles = {
          clePublique,
          cleSecrete,
          posePar: String(brut.posePar ?? ""),
          poseeAt: String(brut.poseeAt ?? ""),
          verifieeAt: brut.verifieeAt ? String(brut.verifieeAt) : null,
          verificationOk: typeof brut.verificationOk === "boolean" ? brut.verificationOk : null,
          // Un fichier écrit avant ce champ n'en porte pas : « on ne sait
          // pas » se lit null, et le bandeau reprend alors son invitation à
          // vérifier — c'est le bon repli, puisque personne n'a constaté que
          // recliquer était inutile.
          verificationReessayer:
            typeof brut.verificationReessayer === "boolean" ? brut.verificationReessayer : null,
        };
      }
    } catch {
      /*
       * L'ERREUR N'EST PAS JOURNALISÉE, ET SURTOUT PAS SON MESSAGE. Depuis
       * Node 20, `JSON.parse` recopie un morceau du texte fautif dans son
       * message — c'est-à-dire, ici, un morceau du fichier de clés. On dit
       * qu'il est illisible, jamais ce qu'il contient.
       */
      console.error("[sendcloud] le fichier de clés est illisible : il sera traité comme absent");
    }
  }
  cache = { empreinte: e, cles };
  return cles;
}

/** Y a-t-il de quoi appeler SendCloud ? */
export async function sendcloudConfigure(): Promise<boolean> {
  return (await lireCles()) !== null;
}

/**
 * Écrit la paire, en 0600, entière ou pas du tout.
 *
 * Même patron que le rangement des bordereaux (écriture à côté puis rename),
 * pour la même raison : une lecture simultanée ne doit jamais tomber sur un
 * fichier à moitié écrit. Le mode 0600 est posé à la création ET redemandé
 * après coup, mais son échec ne fait pas échouer l'écriture : en
 * développement, le dossier vient d'un montage Windows qui ne connaît pas les
 * droits Unix, et refuser d'écrire là-dessus empêcherait d'essayer quoi que ce
 * soit. En production, le dossier est un vrai dossier Linux et le mode tient.
 */
async function ecrireCles(cles: ClesSendcloud): Promise<void> {
  await mkdir(DOSSIER_SECRETS, { recursive: true, mode: 0o700 });
  const provisoire = `${FICHIER_CLES}.${process.pid}.tmp`;
  await writeFile(provisoire, `${JSON.stringify(cles, null, 2)}\n`, { mode: 0o600 });
  try {
    await chmod(provisoire, 0o600);
  } catch {
    /* Montage sans droits Unix : le fichier est écrit, c'est ce qui compte. */
  }
  await rename(provisoire, FICHIER_CLES);
  // Le cache est vidé ici plutôt que laissé à l'empreinte : sur un montage
  // Windows, deux écritures de même taille dans la même seconde pourraient
  // porter la même date, et l'écran afficherait l'ancienne vérification.
  cache = null;
}

/* -------------------------------------------------------------------------- */
/*  Les appels                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Pourquoi un appel n'a pas abouti — les trois cas où RIEN n'est revenu.
 *
 * Une réponse de SendCloud, même un refus, n'est pas un échec : elle est
 * rendue telle quelle par `appelSendcloud`. C'est indispensable pour l'achat,
 * où un 409 veut dire « déjà acheté » et surtout pas « erreur ».
 */
export type GenreEchec =
  /** Aucune clé n'est posée : rien n'a été émis. */
  | "cles"
  /** Une garde a refusé l'appel avant de l'émettre. */
  | "garde"
  /** Parti, mais sans réponse : l'argent est peut-être engagé. */
  | "reseau";

export class EchecSendcloud extends Error {
  constructor(
    readonly genre: GenreEchec,
    message: string,
  ) {
    super(message);
    this.name = "EchecSendcloud";
  }
}

export interface ReponseSendcloud {
  statut: number;
  ok: boolean;
  /** Le corps décodé, ou null quand la réponse n'est pas du JSON. */
  corps: unknown;
}

interface OptionsAppel {
  methode?: "GET" | "POST";
  corps?: unknown;
  /**
   * Vrai quand l'appel ENGAGE DE L'ARGENT (achat, annulation). C'est ce
   * drapeau, et lui seul, que la garde de développement regarde.
   */
  depense?: boolean;
  delaiMs?: number;
  /**
   * Les clés à employer. Absentes, celles du fichier. Ce paramètre existe pour
   * la vérification : on éprouve la paire que la cliente vient de coller AVANT
   * de l'écrire, sinon un essai raté laisserait le compte débranché.
   */
  cles?: { clePublique: string; cleSecrete: string };
}

/** Vingt secondes : au-delà, une lecture qui n'a pas répondu ne répondra pas. */
const DELAI_PAR_DEFAUT_MS = 20_000;

/**
 * Un appel v3, authentifié en Basic.
 *
 * LA GARDE DE PRODUCTION, SECONDE MOITIÉ : ON N'ACHÈTE PAS DEPUIS UN POSTE DE
 * DÉVELOPPEMENT. En v3 il n'existe aucun brouillon et aucun bac à sable —
 * `/shipments/announce` achète, immédiatement, pour de vrai. Un essai lancé
 * par distraction avec l'adresse officielle dépenserait donc l'argent
 * d'Alexandra : la garde refuse AVANT d'émettre quoi que ce soit.
 *
 * Les lectures gratuites (vérifier des clés, demander un tarif) restent
 * permises vers l'adresse officielle, et c'est délibéré : c'est ce qui permet
 * de vérifier une paire de clés depuis n'importe quelle instance, et c'est le
 * seul appel qu'on s'autorisera le jour où il faudra comparer une réponse
 * réelle à celle du faux.
 */
export async function appelSendcloud(
  chemin: string,
  options: OptionsAppel = {},
): Promise<ReponseSendcloud> {
  if (options.depense && !EN_PRODUCTION && sendcloudEstReel()) {
    throw new EchecSendcloud(
      "garde",
      "Cette boutique n'est pas en production et parlerait au vrai SendCloud : un achat y dépenserait de l'argent pour de bon. Rien n'a été envoyé.",
    );
  }

  const cles = options.cles ?? (await lireCles());
  if (!cles) {
    throw new EchecSendcloud(
      "cles",
      "Les clés SendCloud ne sont pas posées : allez dans Livraison, collez-les, puis réessayez. Rien n'a été envoyé.",
    );
  }

  // L'en-tête Basic est fabriqué à chaque appel et n'est jamais gardé ailleurs
  // que dans cette variable locale : rien à retrouver dans un objet partagé.
  const basic = Buffer.from(`${cles.clePublique}:${cles.cleSecrete}`).toString("base64");

  let reponse: Response;
  try {
    reponse = await fetch(`${BASE}${chemin}`, {
      method: options.methode ?? "GET",
      headers: {
        Authorization: `Basic ${basic}`,
        Accept: "application/json",
        ...(options.corps === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(options.corps === undefined ? {} : { body: JSON.stringify(options.corps) }),
      signal: AbortSignal.timeout(options.delaiMs ?? DELAI_PAR_DEFAUT_MS),
    });
  } catch {
    /*
     * Le message de l'exception n'est pas recopié : il porte l'adresse
     * appelée, donc le chemin, donc — pour un achat — de quoi deviner ce qui a
     * été demandé. La phrase française suffit, et l'appelant sait déjà quoi
     * faire d'un « reseau » : ne RIEN relancer tout seul.
     */
    throw new EchecSendcloud(
      "reseau",
      "SendCloud n'a pas répondu dans le temps imparti. Rien ne sera relancé automatiquement.",
    );
  }

  const texte = await reponse.text().catch(() => "");
  let corps: unknown = null;
  try {
    corps = texte ? JSON.parse(texte) : null;
  } catch {
    // Une réponse qui n'est pas du JSON (une page d'erreur de passerelle) :
    // le statut suffit à la raconter.
  }
  if (!reponse.ok) {
    // Le seul journal autorisé, sur le précédent de payments.ts : le statut et
    // un corps tronqué. Ni l'en-tête d'authentification, ni le corps de la
    // requête — celui d'un achat porte l'adresse d'une cliente.
    console.error(`[sendcloud] refus ${reponse.status}`, texte.slice(0, 500));
  }
  return { statut: reponse.status, ok: reponse.ok, corps };
}

/* -------------------------------------------------------------------------- */
/*  Vérifier une paire de clés                                                */
/* -------------------------------------------------------------------------- */

export interface Verification {
  ok: boolean;
  /** Vrai quand SendCloud a explicitement refusé la paire (401/403). */
  refus: boolean;
  /**
   * Recliquer « Vérifier le compte » a-t-il une chance d'aboutir ?
   *
   * Vrai pour une panne passagère, un délai dépassé, une cadence trop
   * rapide. FAUX quand c'est la boutique qui interroge la mauvaise adresse :
   * là, l'écran ne doit pas inviter à recliquer, sinon il dit dans la même
   * phrase « recliquer n'y changera rien » et « revenez cliquer ».
   */
  reessayer: boolean;
  /** La phrase qu'Alexandra lira, telle quelle. */
  message: string;
}

/**
 * Est-ce que SendCloud reconnaît cette paire ?
 *
 * L'appel choisi est une LECTURE GRATUITE ET SANS EFFET : la liste des points
 * relais, bornée à un. Elle n'achète rien, ne réserve rien, ne crée rien, et
 * c'est la seule raison pour laquelle on s'autorise à la lancer sur le vrai
 * service — y compris depuis un poste de développement, où elle est le seul
 * moyen de savoir si des clés fraîchement collées valent quelque chose.
 */
export async function sendcloudVerifier(cles?: {
  clePublique: string;
  cleSecrete: string;
}): Promise<Verification> {
  try {
    const r = await appelSendcloud("/service-points?country_code=FR&limit=1", {
      ...(cles ? { cles } : {}),
    });
    if (r.ok) {
      return {
        ok: true,
        refus: false,
        reessayer: false,
        message: "SendCloud a reconnu ces clés.",
      };
    }
    if (r.statut === 401 || r.statut === 403) {
      return {
        ok: false,
        refus: true,
        reessayer: false,
        message:
          "SendCloud a refusé ces clés. Vérifiez que la clé publique et la clé secrète viennent bien de la MÊME intégration, et qu'aucun espace ne s'est glissé au début ou à la fin.",
      };
    }
    /*
     * 404 ET 405 NE SONT PAS UNE PANNE CHEZ EUX, ET IL NE FAUT SURTOUT PAS LE
     * DIRE.
     *
     * « Adresse inconnue » et « méthode non autorisée » veulent dire que
     * c'est NOTRE adresse d'appel qui est fausse — le chemin v3 que la
     * boutique interroge n'a jamais été confronté au vrai service, et c'est
     * le mode de panne le plus probable le jour où de vraies clés seront
     * collées. Répondre « incident de leur côté, réessayez dans un moment »
     * enverrait Alexandra recliquer indéfiniment sur un bouton qui ne
     * réussira jamais, en cherchant la panne chez SendCloud. Pas de
     * « réessayez » ici : c'est un défaut de la boutique, à nous signaler.
     */
    if (r.statut === 404 || r.statut === 405) {
      return {
        ok: false,
        refus: false,
        reessayer: false,
        message: `La boutique n'a pas trouvé cette adresse chez SendCloud (réponse ${r.statut}). Ce ne sont PAS vos clés qui sont en cause : SendCloud ne les a pas refusées, et elles restent enregistrées. C'est un défaut de la boutique — signalez-le-nous, recliquer n'y changera rien.`,
      };
    }
    /*
     * Trop de demandes d'affilée : là, attendre est vraiment la bonne
     * réponse, et ce n'est ni une panne ni un défaut.
     */
    if (r.statut === 429) {
      return {
        ok: false,
        refus: false,
        reessayer: true,
        message:
          "SendCloud a reçu trop de demandes d'affilée et a mis celle-ci de côté. Vos clés sont enregistrées : attendez quelques minutes, puis recliquez sur « Vérifier le compte ».",
      };
    }
    if (r.statut >= 500) {
      return {
        ok: false,
        refus: false,
        reessayer: true,
        message: `SendCloud a répondu ${r.statut} sans refuser les clés. C'est un incident de leur côté : réessayez dans un moment.`,
      };
    }
    // Tout le reste : on ne sait pas, et on le dit comme ça plutôt que
    // d'accuser quelqu'un au hasard.
    return {
      ok: false,
      refus: false,
      reessayer: false,
      message: `SendCloud a répondu ${r.statut}, ce que la boutique ne sait pas interpréter. Ce ne sont pas vos clés : SendCloud ne les a pas refusées. Signalez-nous ce numéro plutôt que de recliquer.`,
    };
  } catch (e) {
    /*
     * Parti, mais sans réponse. Le message de l'exception dit déjà que rien
     * ne sera relancé tout seul ; pour une simple lecture comme celle-ci,
     * recliquer plus tard est sans danger et c'est bien ce qu'il faut faire.
     */
    if (e instanceof EchecSendcloud) {
      return {
        ok: false,
        refus: false,
        reessayer: e.genre === "reseau",
        message:
          e.genre === "reseau"
            ? `${e.message} Cette vérification n'achète rien : réessayez dans un moment.`
            : e.message,
      };
    }
    return {
      ok: false,
      refus: false,
      reessayer: true,
      message: "SendCloud n'a pas pu être joint. Réessayez dans un moment.",
    };
  }
}

/* -------------------------------------------------------------------------- */
/*  L'expéditeur (réglage non secret)                                         */
/* -------------------------------------------------------------------------- */

/**
 * L'adresse imprimée en haut de l'étiquette, et celle où le transporteur
 * renvoie un colis refusé. Elle n'existe nulle part ailleurs dans la boutique,
 * et aucune étiquette n'est possible sans elle.
 */
export interface Expediteur {
  nom: string;
  rue: string;
  complement: string;
  codePostal: string;
  ville: string;
  pays: string;
  telephone: string;
}

const EXPEDITEUR_VIDE: Expediteur = {
  nom: "",
  rue: "",
  complement: "",
  codePostal: "",
  ville: "",
  pays: "FR",
  telephone: "",
};

const CLE_EXPEDITEUR = "expedition.expediteur";
const CLE_MODE_ESSAI = "expedition.mode_essai";
const CLE_PLAFOND = "expedition.plafond_cents";

/** La valeur d'un réglage, ou undefined s'il n'a jamais été posé. */
async function reglage(cle: string): Promise<unknown> {
  const [ligne] = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, cle));
  return ligne?.value;
}

/** L'expéditeur tel qu'il est réglé, champs manquants ramenés à du vide. */
export async function lireExpediteur(): Promise<Expediteur> {
  const brut = await reglage(CLE_EXPEDITEUR);
  if (!brut || typeof brut !== "object" || Array.isArray(brut)) return { ...EXPEDITEUR_VIDE };
  const d = brut as Record<string, unknown>;
  const texte = (v: unknown) => String(v ?? "").trim();
  return {
    nom: texte(d.nom),
    rue: texte(d.rue),
    complement: texte(d.complement),
    codePostal: texte(d.codePostal),
    ville: texte(d.ville),
    // Le code pays s'écrit en deux majuscules sur une étiquette. Normalisé à
    // la LECTURE et pas seulement à la saisie : la valeur peut aussi avoir été
    // posée par la route générale des réglages, qui ne sait rien de ce champ.
    pays: texte(d.pays).toUpperCase() || "FR",
    telephone: texte(d.telephone),
  };
}

/**
 * CE QUI MANQUE À CETTE ADRESSE, NOMMÉ COMME SUR L'ÉCRAN.
 *
 * Une liste et pas un simple oui/non, parce que les deux phrases ne se
 * réparent pas du même geste : « il manque le téléphone » se règle du premier
 * coup, « l'adresse est incomplète » envoie relire sept cases à l'aveugle. Et
 * parce que l'écran affichait « Adresse enregistrée » en vert juste au-dessus
 * de « Aucune adresse n'est renseignée » en ambre, pour une adresse à
 * laquelle il ne manquait que le téléphone.
 *
 * Le complément est le seul champ facultatif : tous les autres figurent sur
 * l'étiquette, et le téléphone est ce que le transporteur appelle quand il ne
 * trouve pas l'adresse de retour.
 */
export function champsManquantsExpediteur(e: Expediteur): string[] {
  const manque: string[] = [];
  if (!e.nom) manque.push("le nom affiché");
  if (!e.rue) manque.push("la rue et le numéro");
  if (!e.codePostal) manque.push("le code postal");
  if (!e.ville) manque.push("la ville");
  if (!e.pays) manque.push("le pays");
  if (!e.telephone) manque.push("le téléphone");
  return manque;
}

/**
 * Une étiquette est-elle seulement possible ?
 *
 * Déduit de la liste ci-dessus, et pas recalculé à côté : deux règles
 * parallèles finiraient par se contredire dans le même écran, et c'est
 * exactement ce qu'on répare.
 */
export function expediteurComplet(e: Expediteur): boolean {
  return champsManquantsExpediteur(e).length === 0;
}

/**
 * Rien du tout, ou seulement incomplète ?
 *
 * Le pays ne compte pas : il vaut « FR » par défaut, personne ne l'a saisi.
 * Sans cette distinction, l'écran annonce « aucune adresse » à quelqu'un qui
 * vient d'en enregistrer six champs sur sept, et la seule conclusion possible
 * est que l'enregistrement n'a pas marché.
 */
export function expediteurVide(e: Expediteur): boolean {
  return !(e.nom || e.rue || e.complement || e.codePostal || e.ville || e.telephone);
}

/** Le mode essai : allumé tant que personne ne l'a délibérément éteint. */
export async function modeEssai(): Promise<boolean> {
  const v = await reglage(CLE_MODE_ESSAI);
  // Réglage absent = mode essai. Le défaut protège : il vaut mieux fabriquer
  // une étiquette sans valeur que dépenser sans l'avoir demandé.
  return v === undefined || v === null ? true : v !== false;
}

/** Le prix maximum d'un bordereau, en centimes. */
export async function plafondCents(): Promise<number> {
  const v = await reglage(CLE_PLAFOND);
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2000;
}

/* -------------------------------------------------------------------------- */
/*  L'état, en français                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Les cinq états possibles du compte, nommés ICI et pas à l'écran.
 *
 * C'est le serveur qui sait ce qu'il ferait d'un clic, donc c'est lui qui
 * nomme l'état ; l'écran n'y met que des couleurs et des mots. Refaire ce
 * raisonnement dans la page ferait vivre deux vérités, et c'est toujours la
 * plus rassurante des deux qui finirait affichée.
 */
export type Voyant =
  /** Aucune clé posée. Rien ne peut être acheté, mais rien n'est cassé non plus. */
  | "absent"
  /** SendCloud a dit non à ces clés-là. */
  | "refuse"
  /** Clés en place, jamais confirmées par SendCloud. */
  | "non_verifie"
  /** Tout marche, et rien n'est facturé : lettre non affranchie. */
  | "essai"
  /** Tout marche, et chaque clic dépense. C'est CET état qu'il faut remarquer. */
  | "reel";

/** Ce que l'écran Livraison affiche. Aucune de ces valeurs n'est secrète. */
export interface EtatExpedition {
  configure: boolean;
  /** Les quatre derniers caractères de la clé PUBLIQUE, jamais de la secrète. */
  cleVisible: string | null;
  posePar: string | null;
  poseeAt: string | null;
  verifieeAt: string | null;
  verificationOk: boolean | null;
  /**
   * Recliquer « Vérifier le compte » peut-il aboutir ?
   *
   * false = le dernier essai a buté sur un défaut de la boutique ; l'écran ne
   * doit pas redemander de cliquer. null = rien à signaler de ce côté.
   */
  verificationReessayer: boolean | null;
  modeEssai: boolean;
  expediteur: Expediteur;
  expediteurComplet: boolean;
  /** Les champs obligatoires encore vides, nommés comme sur l'écran. */
  expediteurManquants: string[];
  /** Vrai quand RIEN n'a jamais été saisi — à ne pas confondre avec incomplet. */
  expediteurVide: boolean;
  plafondCents: number;
  /** Vrai quand la boutique parle au vrai SendCloud (faux : serveur d'essai). */
  reel: boolean;
  voyant: Voyant;
  /** La phrase que lira Alexandra : « si je clique maintenant, que se passe-t-il ». */
  resume: string;
}

/** Une date ISO en date française, ou null. */
function enFrancais(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("fr-FR");
}

/**
 * L'ordre des cas compte, et il n'est pas celui des courriers : là-bas c'est
 * l'état muet qu'on ne doit pas manquer, ici c'est l'état DÉPENSIER.
 */
function voyantDe(etat: {
  configure: boolean;
  verificationOk: boolean | null;
  modeEssai: boolean;
}): Voyant {
  if (!etat.configure) return "absent";
  if (etat.verificationOk === false) return "refuse";
  if (etat.verificationOk === null) return "non_verifie";
  return etat.modeEssai ? "essai" : "reel";
}

/**
 * CE QUE CES CLÉS FONT AUJOURD'HUI, ET CE QU'ELLES NE FONT PAS ENCORE.
 *
 * Le bouton « Acheter le bordereau » n'existe sur aucun écran : la fiche
 * commande ne sait, pour l'instant, que recevoir une étiquette achetée chez
 * SendCloud et déposée à la main. Sans cette phrase, Alexandra colle ses clés,
 * lit un bandeau vert qui lui annonce des étiquettes fabriquées par la
 * boutique, ouvre une commande, n'y trouve que le dépôt manuel — et conclut
 * qu'elle a mal collé ses clés. L'écran qu'elle vient de configurer serait
 * alors le seul à mentir, et c'est celui qu'elle croirait.
 *
 * Elle se retire le jour où la route d'achat existe (étapes 13 à 17).
 */
const ACHAT_PAS_ENCORE =
  "Pour l'instant, ces clés servent seulement à vérifier votre compte : l'achat du bordereau depuis la fiche commande arrive dans une prochaine mise à jour. En attendant, vous achetez vos étiquettes chez SendCloud comme aujourd'hui, et vous les déposez sur la fiche de la commande.";

/**
 * La phrase du bandeau, celle qui répond à « et si je clique ? ».
 *
 * `reessayer` porte la RAISON du dernier essai resté sans réponse. Sans elle,
 * le bandeau « jamais vérifiées » redemandait de cliquer alors que le message
 * du clic précédent venait d'expliquer que cliquer n'y changerait rien — les
 * deux phrases dans le même écran, et seule la fausse survivait au
 * rechargement.
 */
function resumeExpedition(
  voyant: Voyant,
  verifieeAt: string | null,
  reessayer: boolean | null,
): string {
  switch (voyant) {
    case "absent":
      return `Les clés SendCloud ne sont pas posées. Vous les collez vous-même dans les deux champs ci-dessous — personne d'autre n'a besoin de les voir. Tant qu'elles manquent, tout le reste de la boutique fonctionne exactement comme aujourd'hui. ${ACHAT_PAS_ENCORE}`;
    case "refuse": {
      const quand = enFrancais(verifieeAt);
      return `SendCloud a refusé ces clés${quand ? ` le ${quand}` : ""}. Tant que ce message reste, votre compte n'est pas relié : recollez la paire, ou refaites-en une chez SendCloud et collez la nouvelle. ${ACHAT_PAS_ENCORE}`;
    }
    case "non_verifie":
      /*
       * TROIS ÉTATS SOUS UN SEUL VOYANT, ET LA PHRASE EST LA SEULE À POUVOIR
       * LES DISTINGUER.
       *
       * « Jamais confirmées » ne dit pas POURQUOI, et c'est précisément ce que
       * le message du clic disait avant de s'effacer. N'écrire que deux
       * phrases pour trois raisons refaisait le défaut réparé, dans l'autre
       * sens : après un incident CHEZ EUX, le bandeau qui survivait racontait
       * que personne n'avait encore essayé — et le seul geste utile, revenir
       * cliquer plus tard, n'était plus expliqué nulle part.
       */
      // Recliquer ne peut pas aboutir : ne pas le demander. C'est le cas du
      // 404 — l'adresse que la boutique interroge est fausse, les clés n'y
      // sont pour rien, et c'est à nous de le réparer.
      if (reessayer === false)
        return `Les clés sont en place, mais SendCloud n'a jamais confirmé qu'il les accepte : le dernier essai a échoué sur un défaut de la boutique, pas sur vos clés. Recliquer n'y changera rien — signalez-le-nous. Vos clés restent enregistrées, vous n'aurez pas à les recoller. ${ACHAT_PAS_ENCORE}`;
      // Recliquer a un sens, et il faut le dire : cadence, panne passagère,
      // délai dépassé. « N'a pas abouti » couvre les trois — un 429 est bien
      // une réponse, un silence n'en est pas une.
      if (reessayer === true)
        return `Les clés sont en place, et le dernier essai n'a pas abouti chez SendCloud : ce n'est pas un refus, vos clés restent enregistrées. C'est un incident passager de leur côté — recliquez sur « Vérifier le compte » dans un moment, c'est une simple lecture, elle n'achète rien. ${ACHAT_PAS_ENCORE}`;
      return `Les clés sont en place, mais SendCloud n'a jamais confirmé qu'il les accepte. Cliquez sur « Vérifier le compte » : c'est une simple lecture, elle n'achète rien. ${ACHAT_PAS_ENCORE}`;
    case "essai":
      return `Mode essai : les bordereaux que la boutique fabriquera seront des « lettres non affranchies ». SendCloud ne vous facturera rien, et l'étiquette produite ne fera partir aucun colis — c'est fait pour tout essayer sans dépenser. ${ACHAT_PAS_ENCORE}`;
    case "reel":
      return `Mode essai éteint : le jour où la boutique achètera vos bordereaux, chaque bouton « Acheter le bordereau » dépensera pour de bon la somme écrite dessus, sur votre compte SendCloud. ${ACHAT_PAS_ENCORE}`;
  }
}

/** L'état complet, prêt à afficher. */
export async function sendcloudEtat(): Promise<EtatExpedition> {
  const cles = await lireCles();
  const expediteur = await lireExpediteur();
  const base = {
    configure: cles !== null,
    verificationOk: cles?.verificationOk ?? null,
    verifieeAt: cles?.verifieeAt ?? null,
    verificationReessayer: cles?.verificationReessayer ?? null,
    modeEssai: await modeEssai(),
  };
  const voyant = voyantDe(base);
  return {
    ...base,
    voyant,
    // Les quatre derniers caractères de la clé PUBLIQUE : de quoi reconnaître
    // la paire qu'on a collée, sans rien apprendre à qui lirait par-dessus
    // l'épaule. La clé secrète, elle, ne quitte jamais ce fichier.
    cleVisible: cles ? cles.clePublique.slice(-4) : null,
    posePar: cles?.posePar || null,
    poseeAt: cles?.poseeAt || null,
    expediteur,
    expediteurComplet: expediteurComplet(expediteur),
    expediteurManquants: champsManquantsExpediteur(expediteur),
    expediteurVide: expediteurVide(expediteur),
    plafondCents: await plafondCents(),
    reel: sendcloudEstReel(),
    resume: resumeExpedition(voyant, base.verifieeAt, base.verificationReessayer),
  };
}

/* -------------------------------------------------------------------------- */
/*  Routes                                                                    */
/* -------------------------------------------------------------------------- */

export function mountExpedition(app: Hono): void {
  /** Où en est le compte d'expédition. Rien de secret ne passe par ici. */
  app.get("/admin/expedition/etat", async (c) => c.json(await sendcloudEtat()));

  /**
   * Pose les clés — ou revérifie celles qui sont en place.
   *
   * UN CHAMP VIDE NE CHANGE RIEN. C'est la parade contre l'écrasement
   * silencieux : sans elle, un simple enregistrement de l'écran, champs
   * blancs, débrancherait le transporteur sans un mot. C'est exactement ce qui
   * est arrivé à la consigne de style de l'IA, et cette fois la panne se
   * verrait au moment d'expédier un colis.
   *
   * Envoyer les deux champs vides est donc le geste « Vérifier le compte » :
   * on garde les clés, on redemande à SendCloud ce qu'il en pense.
   *
   * ON VÉRIFIE AVANT D'ÉCRIRE, et un refus n'écrase jamais une clé en place.
   * En revanche, si SendCloud ne répond pas, les clés SONT écrites et marquées
   * « non vérifiées » : la clé secrète ne s'affiche QU'UNE FOIS chez eux, et
   * la perdre parce que leur service tousse coûterait plus cher qu'un bandeau
   * qui demande de revérifier.
   */
  app.post("/admin/expedition/cles", async (c) => {
    const corps = (await c.req.json().catch(() => null)) as {
      clePublique?: unknown;
      cleSecrete?: unknown;
    } | null;
    const saisie = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const nouvellePublique = saisie(corps?.clePublique);
    const nouvelleSecrete = saisie(corps?.cleSecrete);

    const existantes = await lireCles();
    const clePublique = nouvellePublique || existantes?.clePublique || "";
    const cleSecrete = nouvelleSecrete || existantes?.cleSecrete || "";
    if (!clePublique || !cleSecrete) {
      return c.json(
        {
          error:
            "Collez les DEUX clés de votre intégration SendCloud : la clé publique et la clé secrète. La clé secrète ne s'affiche qu'une seule fois chez eux — si vous avez fermé leur page, refaites une intégration.",
        },
        400,
      );
    }

    const verification = await sendcloudVerifier({ clePublique, cleSecrete });
    const changement = Boolean(nouvellePublique || nouvelleSecrete);

    /*
     * Un REFUS sur des clés nouvelles n'écrit rien : la paire en place (s'il y
     * en avait une) continue de fonctionner, et une paire fautive ne prend pas
     * la place d'une bonne à cause d'une faute de frappe. Sur des clés
     * inchangées, en revanche, le refus EST l'information à garder : c'est lui
     * qui allume le bandeau rouge « SendCloud a refusé ces clés ».
     */
    if (verification.refus && changement) {
      return c.json({ error: verification.message }, 400);
    }

    /*
     * « Refusées » et « pas encore vérifiées » sont DEUX états, et les
     * confondre ferait afficher un bandeau rouge « SendCloud a refusé ces
     * clés » chaque fois que leur service tousse.
     *
     * D'où ce cas particulier : quand SendCloud n'a rien répondu ET que les
     * clés n'ont pas bougé, on n'écrit RIEN. Rabaisser une vérification réussie
     * à « on ne sait pas » éteindrait un voyant vert pour une seconde de
     * réseau.
     */
    const repondu = verification.ok || verification.refus;
    if (!repondu && !changement) {
      /*
       * La VÉRIFICATION n'est pas réécrite — c'est tout l'objet du cas
       * ci-dessus —, mais la RAISON l'est : c'est elle que le bandeau
       * permanent consulte. Sans cette ligne, un « Vérifier le compte » qui
       * bute sur un 404 afficherait un message disant que recliquer est
       * inutile, au-dessus d'un bandeau continuant d'inviter à recliquer. Ce
       * champ n'est lu que dans l'état « jamais vérifiées » : il ne peut
       * éteindre aucun voyant vert.
       */
      if (existantes && existantes.verificationReessayer !== verification.reessayer)
        await ecrireCles({ ...existantes, verificationReessayer: verification.reessayer });
      return c.json({ ok: false, message: verification.message, etat: await sendcloudEtat() });
    }

    const maintenant = new Date().toISOString();
    await ecrireCles({
      clePublique,
      cleSecrete,
      posePar: changement ? (c.get("utilisateur")?.email ?? "") : (existantes?.posePar ?? ""),
      poseeAt: changement ? maintenant : (existantes?.poseeAt ?? maintenant),
      // Des clés neuves que personne n'a pu confirmer n'ont pas de date de
      // vérification : elles n'en ont jamais eu.
      verifieeAt: repondu ? maintenant : null,
      verificationOk: repondu ? verification.ok : null,
      // SendCloud a répondu : il n'y a plus d'essai en suspens à expliquer,
      // c'est `verificationOk` qui porte tout. Sinon, on garde la SEULE chose
      // qui manquait au bandeau permanent : recliquer peut-il aboutir.
      verificationReessayer: repondu ? null : verification.reessayer,
    });

    // La réponse ne porte QUE l'état : le masque de la clé publique, les
    // dates, le résultat. Aucune des deux clés n'en fait partie, pas même
    // celle qui vient d'arriver.
    return c.json({
      ok: verification.ok,
      // Inviter à recliquer SEULEMENT quand recliquer peut aboutir : sur une
      // adresse d'appel fausse, la phrase précédente vient de dire que cela
      // n'y changera rien, et les deux ne peuvent pas tenir dans le même
      // message.
      message: verification.ok
        ? changement
          ? "Clés enregistrées, et SendCloud les accepte."
          : "SendCloud accepte toujours ces clés."
        : repondu
          ? verification.message
          : verification.reessayer
            ? `${verification.message} Vos clés ont quand même été enregistrées, pour ne pas vous les faire ressaisir : revenez cliquer sur « Vérifier le compte ».`
            : `${verification.message} Vos clés ont quand même été enregistrées : vous n'aurez pas à les recoller.`,
      etat: await sendcloudEtat(),
    });
  });
}
