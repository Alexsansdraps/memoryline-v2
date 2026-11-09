/**
 * Les clés de paiement : leur forme, leur chiffrement, et la décision de
 * savoir lesquelles servent — sans base ni réseau.
 *
 * Tout ce qui se DÉCIDE vit ici, en fonctions pures, pour s'essayer seul
 * (tests/paiements-cles.test.ts). La lecture de la base, le cache et les
 * routes du back-office sont dans paiements-reglages.ts ; les appels aux
 * prestataires dans payments.ts.
 *
 * LA RÈGLE QUI COMPTE LE PLUS : en mode réel, aucune clé de test ni de bac à
 * sable ne sert jamais à un NOUVEAU paiement. Une boutique qui encaisserait
 * pour de faux en expédiant pour de vrai perdrait de l'argent sans que rien
 * ne le signale : un prestataire sans clés live disparaît donc de la caisse,
 * plutôt que de retomber sur ses clés d'essai.
 *
 * LE .env RESTE UN REPLI. Tant que rien n'est saisi au back-office et que
 * l'interrupteur n'a pas été touché, `resoudreConfig` rend exactement ce que
 * le .env donnait avant cet écran — mode mixte compris (Stripe live et
 * PayPal sandbox, par exemple), puisque c'était possible.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { inspect } from "node:util";

/* -------------------------------------------------------------------------- */
/*  Les cases                                                                 */
/* -------------------------------------------------------------------------- */

export type Prestataire = "stripe" | "paypal";
/** « test » : essai (Stripe) ou bac à sable (PayPal). « live » : pour de vrai. */
export type Mode = "test" | "live";
export type Champ = "cle_publique" | "cle_secrete" | "secret_webhook" | "client_id" | "secret";
/** Ce que l'interrupteur dit : essai, réel, ou « le .env décide » (jamais touché). */
export type Choix = "essai" | "reel" | "env";

export const PRESTATAIRES: readonly Prestataire[] = ["stripe", "paypal"];
export const MODES: readonly Mode[] = ["test", "live"];

/** Les cases de chaque prestataire, dans l'ordre de l'écran. */
export const CHAMPS: Record<Prestataire, readonly Champ[]> = {
  stripe: ["cle_publique", "cle_secrete", "secret_webhook"],
  paypal: ["client_id", "secret"],
};

/**
 * Ce qu'il faut pour qu'un jeu serve à la caisse. Le secret du webhook n'y
 * est pas : sans lui, la carte marche encore (la confirmation du navigateur
 * suffit), il n'est exigé que pour passer en réel (preconditionsBascule).
 */
export const OBLIGATOIRES: Record<Prestataire, readonly Champ[]> = {
  stripe: ["cle_publique", "cle_secrete"],
  paypal: ["client_id", "secret"],
};

export const LIBELLES_CHAMPS: Record<Champ, string> = {
  cle_publique: "Clé publique",
  cle_secrete: "Clé secrète",
  secret_webhook: "Secret du webhook",
  client_id: "Client-id",
  secret: "Secret",
};

/** « e » pour accorder un participe avec la case : une clé enregistréE, un secret enregistré. */
export function accord(c: Champ): string {
  return c === "cle_publique" || c === "cle_secrete" ? "e" : "";
}

export const NOMS_PRESTATAIRES: Record<Prestataire, string> = {
  stripe: "Stripe",
  paypal: "PayPal",
};

/** « test » / « live » chez Stripe, « sandbox » / « live » chez PayPal. */
export function nomDuMode(p: Prestataire, m: Mode): string {
  return m === "live" ? "live" : p === "stripe" ? "test" : "sandbox";
}

export function estPrestataire(v: unknown): v is Prestataire {
  return v === "stripe" || v === "paypal";
}
export function estMode(v: unknown): v is Mode {
  return v === "test" || v === "live";
}
export function estChampDe(p: Prestataire, v: unknown): v is Champ {
  return typeof v === "string" && (CHAMPS[p] as readonly string[]).includes(v);
}

/* -------------------------------------------------------------------------- */
/*  Un secret qui ne se laisse pas écrire par erreur                          */
/* -------------------------------------------------------------------------- */

/**
 * Une valeur secrète en mémoire.
 *
 * La valeur vit dans un champ PRIVÉ : un `c.json(config)` ou un
 * `console.log(config)` écrit un jour par mégarde rend « [secret] », pas la
 * clé. Seul `devoiler()`, appelé là où un prestataire la réclame (un en-tête
 * Authorization), la rend en clair. Pas même la fin : celle d'une clé du
 * .env ne doit jamais sortir.
 */
export class Secret {
  readonly #v: string;
  constructor(valeur: string) {
    this.#v = valeur;
  }
  /** La valeur, pour l'en-tête d'un appel au prestataire, et rien d'autre. */
  devoiler(): string {
    return this.#v;
  }
  /** Vrai si la valeur est la même, sans la sortir de l'enveloppe. */
  egale(autre: Secret | string | null | undefined): boolean {
    if (!autre) return false;
    return this.#v === (typeof autre === "string" ? autre : autre.devoiler());
  }
  toString(): string {
    return "[secret]";
  }
  toJSON(): string {
    return "[secret]";
  }
  [inspect.custom](): string {
    return "[secret]";
  }
}

/* -------------------------------------------------------------------------- */
/*  Chiffrement                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Les clés dérivées du secret du serveur.
 *
 * `marque` identifie la clé de chiffrement sans la révéler : elle part avec
 * chaque valeur chiffrée. Le jour où APP_SECRET change (ou où la base
 * déménage sans APP_SECRET), la marque ne correspond plus, et l'écran dit
 * « à ressaisir » au lieu de planter sur un déchiffrement impossible.
 */
export interface ClesDerivees {
  chiffrement: Buffer;
  empreinte: Buffer;
  marque: string;
  source: "APP_SECRET" | "DATABASE_URL";
  /**
   * Assez solide pour chiffrer des clés LIVE : APP_SECRET, d'au moins
   * LONGUEUR_MINIMALE_APP_SECRET caractères (voir refusChiffrementLive).
   */
  solide: boolean;
}

/**
 * La longueur minimale d'APP_SECRET pour ouvrir la colonne « Pour de vrai ».
 * `openssl rand -hex 32`, que MISE-EN-PROD.md conseille, en donne 64 : 32
 * ne refuse qu'une valeur choisie à la main, du genre « memoryline2026 »,
 * qu'une sauvegarde volée permettrait de deviner (la marque de chaque ligne
 * dit quand on est tombé juste).
 */
export const LONGUEUR_MINIMALE_APP_SECRET = 32;

/**
 * La matière dont on dérive les clés : APP_SECRET, sinon l'adresse de la base
 * — le même repli que les vignettes des courriers (apercus.ts), et le même
 * piège, que l'écran signale en ambre.
 *
 * Le repli constant « memory-line » d'apercus.ts est EXCLU ici, exprès : une
 * clé écrite dans le code n'est pas une clé, quiconque lit le dépôt la
 * connaît. Sans aucune des deux, on refuse d'enregistrer (le .env reste
 * utilisable).
 *
 * L'adresse de la base ne vaut guère mieux, et elle ne sert donc qu'à la
 * colonne d'essai : docker-compose.yml en donne une par défaut, écrite dans
 * le dépôt, et une sauvegarde volée n'est alors protégée que par le mot de
 * passe de la base. Les clés LIVE exigent APP_SECRET (refusChiffrementLive).
 */
export function matiereDuServeur(env: {
  APP_SECRET?: string;
  DATABASE_URL?: string;
}): { matiere: string; source: ClesDerivees["source"] } | null {
  if (env.APP_SECRET) return { matiere: env.APP_SECRET, source: "APP_SECRET" };
  if (env.DATABASE_URL) return { matiere: env.DATABASE_URL, source: "DATABASE_URL" };
  return null;
}

const SEL = Buffer.from("memoryline:cles-paiement:v1", "utf8");

/** HKDF-SHA256 : trois clés indépendantes tirées d'une même matière. */
export function deriverCles(matiere: string, source: ClesDerivees["source"]): ClesDerivees {
  const tirer = (info: string) =>
    Buffer.from(hkdfSync("sha256", Buffer.from(matiere, "utf8"), SEL, info, 32));
  return {
    chiffrement: tirer("chiffrement"),
    empreinte: tirer("empreinte"),
    marque: tirer("marque").toString("hex").slice(0, 8),
    source,
    solide: source === "APP_SECRET" && matiere.length >= LONGUEUR_MINIMALE_APP_SECRET,
  };
}

/**
 * Peut-on enregistrer une clé LIVE avec ces clés du serveur ? null si oui,
 * sinon la phrase qui dit quoi faire. La colonne d'essai, elle, reste
 * ouverte avec l'adresse de la base : une clé de test volée ne fait payer
 * personne.
 */
export function refusChiffrementLive(cles: ClesDerivees | null): string | null {
  if (cles?.solide) return null;
  if (cles?.source === "APP_SECRET")
    return `La colonne « Pour de vrai » reste fermée : APP_SECRET est trop courte (moins de ${LONGUEUR_MINIMALE_APP_SECRET} caractères) pour protéger des clés live. Faites-en poser une longue dans les réglages du serveur (openssl rand -hex 32), puis redémarrer l'API.`;
  return "La colonne « Pour de vrai » reste fermée : les réglages du serveur n'ont pas d'APP_SECRET. Sans elle, les clés live seraient chiffrées avec l'adresse de la base, qu'une sauvegarde volée suffit à retrouver. Faites poser APP_SECRET (openssl rand -hex 32) dans le .env du serveur, puis redémarrer l'API.";
}

/**
 * Les données associées du chiffrement : la case elle-même. Une valeur
 * chiffrée recopiée d'une case à une autre directement en base (le secret de
 * test glissé dans la case live) ne se déchiffre plus.
 */
function aad(p: Prestataire, m: Mode, c: Champ): Buffer {
  return Buffer.from(`${p}:${m}:${c}`, "utf8");
}

/** « v1.<marque>.<iv>.<tag>.<texte chiffré> », en base64url. */
export function chiffrer(
  cles: ClesDerivees,
  p: Prestataire,
  m: Mode,
  c: Champ,
  valeur: string,
): string {
  const iv = randomBytes(12);
  const chiffreur = createCipheriv("aes-256-gcm", cles.chiffrement, iv, { authTagLength: 16 });
  chiffreur.setAAD(aad(p, m, c));
  const texte = Buffer.concat([chiffreur.update(valeur, "utf8"), chiffreur.final()]);
  const tag = chiffreur.getAuthTag();
  return ["v1", cles.marque, iv.toString("base64url"), tag.toString("base64url"), texte.toString("base64url")].join(".");
}

export type Dechiffrement =
  | { etat: "ok"; valeur: string }
  /** La clé du serveur a changé depuis l'enregistrement : à ressaisir. */
  | { etat: "cle_changee" }
  /** Le texte a été abîmé, tronqué ou déplacé : à ressaisir aussi. */
  | { etat: "abimee" };

/**
 * Déchiffre une valeur. Ne lève JAMAIS : une valeur illisible devient un état
 * que l'écran affiche, et la caisse retombe sur le .env (ou sur rien en mode
 * réel) au lieu de planter.
 */
export function dechiffrer(
  cles: ClesDerivees | null,
  p: Prestataire,
  m: Mode,
  c: Champ,
  stocke: string,
): Dechiffrement {
  try {
    const parts = String(stocke).split(".");
    if (parts.length !== 5 || parts[0] !== "v1") return { etat: "abimee" };
    if (!cles || parts[1] !== cles.marque) return { etat: "cle_changee" };
    const iv = Buffer.from(parts[2]!, "base64url");
    const tag = Buffer.from(parts[3]!, "base64url");
    const texte = Buffer.from(parts[4]!, "base64url");
    if (iv.length !== 12 || tag.length !== 16) return { etat: "abimee" };
    const dechiffreur = createDecipheriv("aes-256-gcm", cles.chiffrement, iv, { authTagLength: 16 });
    dechiffreur.setAAD(aad(p, m, c));
    dechiffreur.setAuthTag(tag);
    const clair = Buffer.concat([dechiffreur.update(texte), dechiffreur.final()]).toString("utf8");
    return { etat: "ok", valeur: clair };
  } catch {
    return { etat: "abimee" };
  }
}

/**
 * L'empreinte d'une valeur : HMAC-SHA256 avec une clé dérivée à part,
 * tronqué à 16 caractères hexadécimaux.
 *
 * Le MODE n'y entre pas, exprès : c'est elle qui reconnaît la même valeur
 * collée dans les deux colonnes (« c'est la même valeur que la clé
 * d'essai »). Elle sert aussi à dater une vérification : tant que les
 * empreintes du jeu sont celles du journal, la vérification tient.
 */
export function empreinte(cles: ClesDerivees, p: Prestataire, c: Champ, valeur: string): string {
  return createHmac("sha256", cles.empreinte).update(`${p}:${c}:${valeur}`).digest("hex").slice(0, 16);
}

/** Les 4 derniers caractères : « se termine par …4f2a ». */
export function finDe(valeur: string): string {
  return valeur.slice(-4);
}

/* -------------------------------------------------------------------------- */
/*  La forme d'une valeur                                                     */
/* -------------------------------------------------------------------------- */

export type Controle = { ok: true; valeur: string } | { ok: false; message: string };

const refus = (message: string): Controle => ({ ok: false, message });

/**
 * La forme d'une valeur, avant de l'enregistrer.
 *
 * Les erreurs les plus fréquentes ne sont pas des fautes de frappe : c'est la
 * bonne clé dans la mauvaise case — la clé live dans la colonne d'essai, la
 * secrète à la place de la publique. Chacune a sa phrase, qui dit où la
 * valeur doit aller. Le message ne contient JAMAIS la valeur.
 */
export function controlerForme(p: Prestataire, m: Mode, c: Champ, brut: unknown): Controle {
  const v = String(brut ?? "").trim();
  if (!v) return refus("La case est vide : collez la valeur, puis enregistrez.");
  if (/\s/.test(v))
    return refus("La valeur contient un espace ou un retour à la ligne : recopiez-la d'un seul tenant.");
  if (v.length > 500) return refus("La valeur est trop longue (500 caractères au plus) : ce n'est pas une clé.");
  if (/[^\x21-\x7e]/.test(v))
    return refus("La valeur contient un caractère inattendu (accent, guillemet typographique…) : recopiez-la depuis le site du prestataire.");

  const colonne = m === "live" ? "Pour de vrai" : "Essai";
  const autreColonne = m === "live" ? "Essai" : "Pour de vrai";

  if (p === "stripe") {
    const estPublique = /^pk_/.test(v);
    const estSecrete = /^(sk|rk)_/.test(v);
    const estWebhook = /^whsec_/.test(v);
    const modeDe = (x: string): Mode | null =>
      /^(pk|sk|rk)_live_/.test(x) ? "live" : /^(pk|sk|rk)_test_/.test(x) ? "test" : null;
    const mauvaiseColonne = (prefixe: string) =>
      modeDe(v) === "live"
        ? refus(`C'est une clé LIVE (${prefixe}_live_…) : elle va dans la colonne « ${autreColonne} », pas « ${colonne} ».`)
        : refus(`C'est une clé de TEST (${prefixe}_test_…) : elle va dans la colonne « ${autreColonne} », pas « ${colonne} ».`);

    if (c === "cle_publique") {
      if (estSecrete)
        return refus("C'est une clé SECRÈTE : elle va dans la case « Clé secrète ». La clé publique commence par pk_.");
      if (estWebhook) return refus("C'est le secret du webhook : il va dans la case « Secret du webhook ».");
      if (!estPublique)
        return refus(`Une clé publique Stripe commence par pk_${m}_ (vous la trouvez dans Stripe › Développeurs › Clés API).`);
      if (modeDe(v) !== m) return modeDe(v) ? mauvaiseColonne("pk") : refus(`Une clé publique Stripe de cette colonne commence par pk_${m}_.`);
      if (!new RegExp(`^pk_${m}_[A-Za-z0-9_]{10,}$`).test(v))
        return refus("Cette clé publique est incomplète ou abîmée : recopiez-la en entier depuis Stripe.");
      return { ok: true, valeur: v };
    }
    if (c === "cle_secrete") {
      if (estPublique)
        return refus("C'est la clé PUBLIQUE : elle va dans la case « Clé publique ». La clé secrète commence par sk_ (ou rk_ pour une clé restreinte).");
      if (estWebhook) return refus("C'est le secret du webhook : il va dans la case « Secret du webhook ».");
      if (!estSecrete)
        return refus(`Une clé secrète Stripe commence par sk_${m}_ (ou rk_${m}_ pour une clé restreinte).`);
      const prefixe = v.slice(0, 2);
      if (modeDe(v) !== m) return modeDe(v) ? mauvaiseColonne(prefixe) : refus(`Une clé secrète Stripe de cette colonne commence par sk_${m}_ (ou rk_${m}_).`);
      if (!new RegExp(`^(sk|rk)_${m}_[A-Za-z0-9_]{10,}$`).test(v))
        return refus("Cette clé secrète est incomplète ou abîmée : recopiez-la en entier depuis Stripe.");
      return { ok: true, valeur: v };
    }
    if (c === "secret_webhook") {
      if (estPublique || estSecrete)
        return refus("C'est une clé d'API, pas le secret du webhook. Celui-ci commence par whsec_ : il s'affiche dans Stripe › Développeurs › Webhooks, sur la page du webhook.");
      if (!/^whsec_[A-Za-z0-9+/=_-]{16,}$/.test(v))
        return refus("Le secret du webhook commence par whsec_ (Stripe › Développeurs › Webhooks › votre webhook › « Secret de signature »).");
      return { ok: true, valeur: v };
    }
    return refus("Cette case n'existe pas pour Stripe.");
  }

  // PayPal : ni préfixe ni marque de mode. C'est la vérification en ligne
  // (le bouton « Vérifier ») qui dira de quel côté sont ces identifiants.
  if (c !== "client_id" && c !== "secret") return refus("Cette case n'existe pas pour PayPal.");
  if (/^(pk|sk|rk)_(test|live)_|^whsec_/.test(v))
    return refus("C'est une clé Stripe : elle va dans le bloc Stripe, plus haut.");
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(v))
    return refus(
      c === "client_id"
        ? "Un client-id PayPal compte de 20 à 128 lettres, chiffres, tirets ou soulignés (developer.paypal.com › Apps & Credentials)."
        : "Un secret PayPal compte de 20 à 128 lettres, chiffres, tirets ou soulignés (developer.paypal.com › Apps & Credentials, « Show » sous Secret).",
    );
  return { ok: true, valeur: v };
}

/** Une valeur déjà connue, réduite à son empreinte, pour les contrôles croisés. */
export interface EmpreinteConnue {
  mode: Mode;
  champ: Champ;
  empreinte: string;
}

/**
 * Les contrôles qui demandent de connaître les AUTRES cases : la même valeur
 * dans les deux colonnes (on a collé deux fois la clé d'essai), ou le secret
 * PayPal identique au client-id (collé deux fois le même). Seules les
 * empreintes circulent : aucune valeur n'est comparée en clair.
 */
export function refusCroise(
  p: Prestataire,
  m: Mode,
  c: Champ,
  nouvelle: string,
  connues: readonly EmpreinteConnue[],
): string | null {
  const autre: Mode = m === "live" ? "test" : "live";
  if (connues.some((k) => k.mode === autre && k.champ === c && k.empreinte === nouvelle))
    return m === "live"
      ? "C'est la même valeur que celle de la colonne Essai : la colonne « Pour de vrai » attend les identifiants LIVE, qui sont différents."
      : "C'est la même valeur que celle de la colonne « Pour de vrai » : la colonne Essai attend les identifiants de test (sandbox), qui sont différents.";
  if (p === "paypal") {
    const vis = c === "secret" ? "client_id" : c === "client_id" ? "secret" : null;
    if (vis && connues.some((k) => k.mode === m && k.champ === vis && k.empreinte === nouvelle))
      return c === "secret"
        ? "Ce secret est identique au client-id : vous avez sans doute collé deux fois le même. Le secret s'affiche avec « Show » sous le client-id."
        : "Ce client-id est identique au secret : vous avez sans doute collé deux fois le même.";
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Les jeux de clés et la configuration effective                            */
/* -------------------------------------------------------------------------- */

/** D'où vient un jeu : saisi au back-office, ou lu dans le .env du serveur. */
export type Source = "bo" | "env";

export interface JeuStripe {
  prestataire: "stripe";
  mode: Mode;
  source: Source;
  /** Publique par nature : elle part au navigateur. Vide si le .env l'a oubliée. */
  clePublique: string;
  cleSecrete: Secret;
  secretWebhook: Secret | null;
}

export interface JeuPaypal {
  prestataire: "paypal";
  mode: Mode;
  source: Source;
  /** Celui que le SERVEUR présente à PayPal, avec le secret. */
  clientId: string;
  /** Celui que le NAVIGATEUR charge (PUBLIC_PAYPAL_CLIENT_ID dans le .env). */
  clientIdNavigateur: string;
  secret: Secret;
}

/** Une case lue au back-office, déchiffrée ou non. */
export type LectureBO =
  | { etat: "ok"; valeur: string; fin: string; le: Date; par: string | null }
  | { etat: "cle_changee" | "abimee"; fin: string; le: Date; par: string | null };

/** Les cases du back-office, par prestataire et par mode. */
export type CasesBO = Record<Prestataire, Record<Mode, Partial<Record<Champ, LectureBO>>>>;

export function casesVides(): CasesBO {
  return { stripe: { test: {}, live: {} }, paypal: { test: {}, live: {} } };
}

/** Ce que le .env dit des paiements, et rien d'autre. */
export interface EnvPaiement {
  STRIPE_SECRET_KEY?: string;
  PUBLIC_STRIPE_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_SECRET?: string;
  PUBLIC_PAYPAL_CLIENT_ID?: string;
  PAYPAL_ENV?: string;
  SENDCLOUD_ACHATS_REELS?: string;
}

export interface SecretWebhook {
  mode: Mode;
  source: Source;
  secret: Secret;
}

export interface ConfigEffective {
  choisi: Choix;
  /** Le mode que le .env donne à chaque prestataire (repli des paiements anciens). */
  modeEnv: Record<Prestataire, Mode>;
  /** Le mode des NOUVEAUX paiements, prestataire par prestataire. */
  modeVoulu: Record<Prestataire, Mode>;
  /** Le jeu qui sert aux nouveaux paiements, ou null : absent de la caisse. */
  stripe: JeuStripe | null;
  paypal: JeuPaypal | null;
  /**
   * Le jeu de CHAQUE mode, actif ou non : un paiement ouvert avant une
   * bascule se confirme, se capture et se rembourse avec les clés de son
   * mode à lui (payment.mode), pas avec celles du moment.
   */
  jeux: { stripe: Record<Mode, JeuStripe | null>; paypal: Record<Mode, JeuPaypal | null> };
  /**
   * Le jeu qui servirait dans chaque mode si l'interrupteur le choisissait :
   * celui du back-office s'il est complet, sinon celui du .env de ce mode.
   * C'est lui que le verrou de la bascule examine. Il ne diffère de `jeux`
   * que pour une colonne live saisie ici et pas encore vérifiée, tant que le
   * .env décide (voir resoudreConfig).
   */
  candidats: { stripe: Record<Mode, JeuStripe | null>; paypal: Record<Mode, JeuPaypal | null> };
  /**
   * Une colonne live complète, saisie ici, que le .env mettrait en service
   * (son prestataire y est en live), mais qui attend une vérification réussie.
   */
  liveEnAttente: Record<Prestataire, boolean>;
  /** Les jeux du .env, tels quels (null s'il ne dit rien). */
  env: { stripe: JeuStripe | null; paypal: JeuPaypal | null };
  /** Les jeux COMPLETS du back-office. */
  bo: { stripe: Record<Mode, JeuStripe | null>; paypal: Record<Mode, JeuPaypal | null> };
  /**
   * Tous les secrets de webhook connus, celui du mode actif en premier, CHACUN
   * AVEC SON MODE : un avis signé avec l'autre pendant une bascule reste
   * lisible, pour ne pas perdre un paiement en cours. Le mode d'un avis est
   * celui du secret qui l'a signé, jamais ce que l'avis dit de lui-même
   * (payments.ts, jugerAvisStripe).
   */
  secretsWebhook: SecretWebhook[];
  /** Acheter les vraies étiquettes SendCloud (payantes). */
  etiquettesReelles: boolean;
  /**
   * Qui en décide : « mode » (elles suivent l'interrupteur « La boutique
   * encaisse », dès qu'il a été réglé), sinon leur propre réglage d'avant
   * (« bo ») ou le .env (« env »).
   */
  etiquettesSource: Source | "mode";
}

/** Le mode d'une clé secrète Stripe : live si sk_live_ ou rk_live_. */
export function modeDeLaCleStripe(cle: string): Mode {
  return /^(sk|rk)_live_/.test(cle.trim()) ? "live" : "test";
}

/** Le mode de PayPal selon le .env : « live », écrit tel quel ou presque. */
export function modeDePaypalEnv(env: string | undefined): Mode {
  return (env ?? "").trim().toLowerCase() === "live" ? "live" : "test";
}

/**
 * Les jeux du .env, comme les lisait le code d'avant cet écran.
 *
 * Les valeurs sont prises TELLES QUELLES (sans retirer d'espaces) : c'est ce
 * que payments.ts envoyait aux prestataires, et rien ne doit changer pour une
 * boutique qui n'a rien saisi au back-office. Le `??` de PUBLIC_PAYPAL_CLIENT_ID
 * est celui d'avant : une variable présente mais vide laisse PayPal hors de la
 * caisse, comme avant.
 */
export function jeuxDuEnv(env: EnvPaiement): { stripe: JeuStripe | null; paypal: JeuPaypal | null } {
  const sk = env.STRIPE_SECRET_KEY;
  const stripe: JeuStripe | null = sk
    ? {
        prestataire: "stripe",
        mode: modeDeLaCleStripe(sk),
        source: "env",
        clePublique: env.PUBLIC_STRIPE_KEY ?? "",
        cleSecrete: new Secret(sk),
        secretWebhook: env.STRIPE_WEBHOOK_SECRET ? new Secret(env.STRIPE_WEBHOOK_SECRET) : null,
      }
    : null;
  const id = env.PAYPAL_CLIENT_ID;
  const secret = env.PAYPAL_SECRET;
  const paypal: JeuPaypal | null =
    id && secret
      ? {
          prestataire: "paypal",
          mode: modeDePaypalEnv(env.PAYPAL_ENV),
          source: "env",
          clientId: id,
          clientIdNavigateur: env.PUBLIC_PAYPAL_CLIENT_ID ?? id ?? "",
          secret: new Secret(secret),
        }
      : null;
  return { stripe, paypal };
}

/** La valeur lisible d'une case, ou null (vide, illisible). */
function lisible(l: LectureBO | undefined): string | null {
  return l && l.etat === "ok" ? l.valeur : null;
}

/** Le jeu Stripe COMPLET d'une colonne du back-office, ou null. */
export function jeuStripeBO(cases: Partial<Record<Champ, LectureBO>>, mode: Mode): JeuStripe | null {
  const pk = lisible(cases.cle_publique);
  const sk = lisible(cases.cle_secrete);
  if (!pk || !sk) return null;
  const wh = lisible(cases.secret_webhook);
  return {
    prestataire: "stripe",
    mode,
    source: "bo",
    clePublique: pk,
    cleSecrete: new Secret(sk),
    secretWebhook: wh ? new Secret(wh) : null,
  };
}

/** Le jeu PayPal COMPLET d'une colonne du back-office, ou null. */
export function jeuPaypalBO(cases: Partial<Record<Champ, LectureBO>>, mode: Mode): JeuPaypal | null {
  const id = lisible(cases.client_id);
  const secret = lisible(cases.secret);
  if (!id || !secret) return null;
  return {
    prestataire: "paypal",
    mode,
    source: "bo",
    clientId: id,
    clientIdNavigateur: id,
    secret: new Secret(secret),
  };
}

/**
 * LA décision : quelles clés servent, pour quoi.
 *
 * 1. Le mode voulu : « reel » → live, « essai » → test, et tant qu'on n'a
 *    jamais touché l'interrupteur (ou qu'on a rendu la main au .env), le mode
 *    que le .env donne à chaque prestataire.
 * 2. Le jeu d'un mode : celui du back-office s'il est complet, sinon celui du
 *    .env s'il est de ce mode, sinon rien.
 * 3. Le jeu actif est celui du mode voulu. En mode réel, aucun repli sur une
 *    clé d'essai : un prestataire sans clés live disparaît de la caisse.
 *
 * UNE CLÉ LIVE NE SERT JAMAIS SANS AVOIR ÉTÉ VÉRIFIÉE. Le verrou de la
 * bascule le garantit pour « pour de vrai » ; tant que le .env décide, il ne
 * jouait pas : PAYPAL_ENV=live suffisait à mettre en service une colonne
 * PayPal live saisie ici et jamais vérifiée. Dans ce cas, la colonne live du
 * back-office ne sert donc qu'une fois sa dernière vérification réussie et à
 * jour (`liveVerifie`, calculé par l'appelant sur les empreintes) ; d'ici là,
 * le jeu live du .env sert, comme avant l'écran. En mode réel, c'est
 * l'enregistrement qui vérifie AVANT de remplacer (paiements-reglages.ts).
 *
 * `etiquettes` : la dernière décision prise à l'écran, ou null (le .env
 * décide, SENDCLOUD_ACHATS_REELS=oui). Elle ne compte plus dès que
 * l'interrupteur a été réglé (Alexandra, 9 novembre 2026 : « les étiquettes
 * suivent le mode ») : pour de vrai, de vraies étiquettes ; en essai, des
 * étiquettes d'essai. Seul « env » (jamais touché) garde l'ancienne règle.
 */
export function resoudreConfig(
  env: EnvPaiement,
  cases: CasesBO,
  choisi: Choix,
  etiquettes: boolean | null,
  liveVerifie: Record<Prestataire, boolean> = { stripe: false, paypal: false },
): ConfigEffective {
  const duEnv = jeuxDuEnv(env);
  const modeEnv: Record<Prestataire, Mode> = {
    stripe: duEnv.stripe?.mode ?? "test",
    paypal: duEnv.paypal?.mode ?? modeDePaypalEnv(env.PAYPAL_ENV),
  };
  const modeVoulu: Record<Prestataire, Mode> =
    choisi === "reel"
      ? { stripe: "live", paypal: "live" }
      : choisi === "essai"
        ? { stripe: "test", paypal: "test" }
        : modeEnv;

  const bo = {
    stripe: { test: jeuStripeBO(cases.stripe.test, "test"), live: jeuStripeBO(cases.stripe.live, "live") },
    paypal: { test: jeuPaypalBO(cases.paypal.test, "test"), live: jeuPaypalBO(cases.paypal.live, "live") },
  };
  const envStripe = (m: Mode) => (duEnv.stripe?.mode === m ? duEnv.stripe : null);
  const envPaypal = (m: Mode) => (duEnv.paypal?.mode === m ? duEnv.paypal : null);
  const candidats = {
    stripe: { test: bo.stripe.test ?? envStripe("test"), live: bo.stripe.live ?? envStripe("live") },
    paypal: { test: bo.paypal.test ?? envPaypal("test"), live: bo.paypal.live ?? envPaypal("live") },
  };
  // Le .env décide, et la colonne live d'ici n'a pas été vérifiée : elle
  // attend, et le jeu live du .env (s'il existe) garde la main.
  const attend = (p: Prestataire) => choisi === "env" && Boolean(bo[p].live) && !liveVerifie[p];
  const jeux = {
    stripe: { test: candidats.stripe.test, live: attend("stripe") ? envStripe("live") : candidats.stripe.live },
    paypal: { test: candidats.paypal.test, live: attend("paypal") ? envPaypal("live") : candidats.paypal.live },
  };

  // Tous les secrets de webhook lisibles, même ceux d'une colonne incomplète :
  // un avis signé n'a besoin que du secret pour être reconnu.
  const secretsWebhook: SecretWebhook[] = [];
  for (const m of MODES) {
    const wh = lisible(cases.stripe[m].secret_webhook);
    if (wh) secretsWebhook.push({ mode: m, source: "bo", secret: new Secret(wh) });
  }
  if (env.STRIPE_WEBHOOK_SECRET)
    secretsWebhook.push({ mode: modeEnv.stripe, source: "env", secret: new Secret(env.STRIPE_WEBHOOK_SECRET) });
  secretsWebhook.sort((a, b) => Number(b.mode === modeVoulu.stripe) - Number(a.mode === modeVoulu.stripe));

  return {
    choisi,
    modeEnv,
    modeVoulu,
    stripe: jeux.stripe[modeVoulu.stripe],
    paypal: jeux.paypal[modeVoulu.paypal],
    jeux,
    candidats,
    liveEnAttente: {
      stripe: attend("stripe") && modeVoulu.stripe === "live",
      paypal: attend("paypal") && modeVoulu.paypal === "live",
    },
    env: duEnv,
    bo,
    secretsWebhook,
    etiquettesReelles:
      choisi === "reel" ? true : choisi === "essai" ? false : (etiquettes ?? etiquettesDuEnv(env)),
    etiquettesSource: choisi !== "env" ? "mode" : etiquettes === null ? "env" : "bo",
  };
}

/**
 * Une commande payée avec les clés d'ESSAI alors que son prestataire encaisse
 * désormais pour de vrai ? Rend ce prestataire, ou null. C'est ce que la
 * fiche, la liste des commandes et les Finances signalent : une telle vente
 * n'a rapporté aucun argent, et rien d'autre ne la distingue d'une vraie.
 * Tant que la boutique est en essai, toutes le sont : rien n'est signalé.
 *
 * Une ligne sans mode date d'avant l'écran : elle a été ouverte avec les clés
 * du .env, donc dans le mode du .env (même règle que modeDuPaiement).
 */
export function payeeEnEssai(
  paiements: readonly { provider: string; status: string | null; mode?: string | null }[],
  config: Pick<ConfigEffective, "modeVoulu" | "modeEnv">,
): Prestataire | null {
  for (const p of paiements) {
    const prestataire = p.provider;
    if (p.status !== "succeeded" || !estPrestataire(prestataire)) continue;
    const mode = estMode(p.mode) ? p.mode : config.modeEnv[prestataire];
    if (config.modeVoulu[prestataire] === "live" && mode === "test") return prestataire;
  }
  return null;
}

/** Ce que le .env dit des étiquettes : SENDCLOUD_ACHATS_REELS=oui, écrit tel quel ou presque. */
export function etiquettesDuEnv(env: Pick<EnvPaiement, "SENDCLOUD_ACHATS_REELS">): boolean {
  return (env.SENDCLOUD_ACHATS_REELS ?? "").trim().toLowerCase() === "oui";
}

/**
 * Ce que la caisse reçoit : les clés PUBLIQUES du jeu actif, et rien d'autre.
 * La forme est celle de toujours (GET /payments/config) ; `essai` est ajouté
 * par la route.
 */
export function configPublique(cfg: ConfigEffective): {
  stripe: { publicKey: string } | null;
  paypal: { clientId: string } | null;
} {
  return {
    stripe: cfg.stripe && cfg.stripe.clePublique ? { publicKey: cfg.stripe.clePublique } : null,
    paypal:
      cfg.paypal && cfg.paypal.clientIdNavigateur ? { clientId: cfg.paypal.clientIdNavigateur } : null,
  };
}

/** Une case avec son article, pour écrire « il manque la clé publique ». */
export const AVEC_ARTICLE: Record<Champ, string> = {
  cle_publique: "la clé publique",
  cle_secrete: "la clé secrète",
  secret_webhook: "le secret du webhook",
  client_id: "le client-id",
  secret: "le secret",
};

/** Les cases obligatoires d'une colonne qui ne se lisent pas (vides ou à ressaisir). */
export function casesManquantes(cases: CasesBO, p: Prestataire, m: Mode): Champ[] {
  return OBLIGATOIRES[p].filter((c) => lisible(cases[p][m][c]) === null);
}

/** Ce que le bouton « Vérifier » d'une colonne essaierait. */
export type CibleVerification =
  /** Un jeu entier : saisi ici (« bo »), ou celui des réglages du serveur (« env »). */
  | { jeu: JeuStripe | JeuPaypal; source: Source }
  /** Colonne entamée ici mais incomplète : rien à vérifier, il manque ces cases. */
  | { jeu: null; manque: Champ[] }
  /** Rien ici, rien dans les réglages du serveur pour ce mode. */
  | null;

/**
 * Le jeu que « Vérifier » essaie : JAMAIS un mélange.
 *
 * Avant, une colonne entamée (la clé secrète saisie ici, pas encore la
 * publique) faisait vérifier en silence les clés du .env : on remplaçait une
 * clé, on lisait « Clé valide », et l'on croyait la sienne bonne. Désormais :
 * la colonne complète ici, ou, si rien d'obligatoire n'y est saisi, le jeu des
 * réglages du serveur pour ce mode, nommé comme tel. Une colonne entamée
 * n'a rien à vérifier tant qu'il lui manque une case.
 */
export function cibleDeVerification(
  cfg: Pick<ConfigEffective, "bo" | "env">,
  cases: CasesBO,
  p: Prestataire,
  m: Mode,
): CibleVerification {
  const bo = cfg.bo[p][m];
  if (bo) return { jeu: bo, source: "bo" };
  if (OBLIGATOIRES[p].some((c) => cases[p][m][c])) return { jeu: null, manque: casesManquantes(cases, p, m) };
  const env = cfg.env[p];
  return env && env.mode === m ? { jeu: env, source: "env" } : null;
}

/**
 * Ce que la colonne fait maintenant, en une phrase, après un enregistrement
 * ou un effacement : le message de succès disait « enregistrée » quand la
 * clé ne servait encore à rien, faute de sa voisine.
 */
export function effetDeLaColonne(cfg: ConfigEffective, cases: CasesBO, p: Prestataire, m: Mode): string {
  const jeu = cfg.bo[p][m];
  if (!jeu) {
    const manque = casesManquantes(cases, p, m).map((c) => AVEC_ARTICLE[c]);
    const relais =
      cfg.env[p]?.mode === m
        ? "ce sont les clés des réglages du serveur qui servent dans ce mode"
        : "rien ne sert dans ce mode";
    return `La colonne ne sert pas encore : il manque ${manque.join(" et ")}. D'ici là, ${relais}.`;
  }
  if (cfg[p] === jeu) return `La colonne est complète : ${NOMS_PRESTATAIRES[p]} ${nomDuMode(p, m)} encaisse dès maintenant avec ces clés.`;
  if (m === "live" && cfg.liveEnAttente[p])
    return "La colonne est complète. Ces clés live serviront dès qu'une vérification aura réussi (bouton « Vérifier »).";
  return m === "live"
    ? "La colonne est complète. Elle servira quand la boutique passera « pour de vrai »."
    : "La colonne est complète. Elle servira quand la boutique sera en essai.";
}

/* -------------------------------------------------------------------------- */
/*  Les empreintes d'un jeu, et la bascule                                    */
/* -------------------------------------------------------------------------- */

/** Les empreintes des valeurs d'un jeu : ce qu'une vérification a vu. */
export function empreintesDuJeu(cles: ClesDerivees | null, jeu: JeuStripe | JeuPaypal): Record<string, string> | null {
  if (!cles) return null;
  if (jeu.prestataire === "stripe") {
    const e: Record<string, string> = {
      cle_publique: empreinte(cles, "stripe", "cle_publique", jeu.clePublique),
      cle_secrete: empreinte(cles, "stripe", "cle_secrete", jeu.cleSecrete.devoiler()),
    };
    if (jeu.secretWebhook)
      e.secret_webhook = empreinte(cles, "stripe", "secret_webhook", jeu.secretWebhook.devoiler());
    return e;
  }
  return {
    client_id: empreinte(cles, "paypal", "client_id", jeu.clientId),
    client_id_navigateur: empreinte(cles, "paypal", "client_id", jeu.clientIdNavigateur),
    secret: empreinte(cles, "paypal", "secret", jeu.secret.devoiler()),
  };
}

/** Deux jeux d'empreintes sont-ils les mêmes ? (ordre des clés indifférent) */
export function memesEmpreintes(
  a: Record<string, string> | null | undefined,
  b: Record<string, string> | null | undefined,
): boolean {
  if (!a || !b) return false;
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}

/** La dernière vérification d'un jeu, telle que le journal la garde. */
export interface VerificationConnue {
  ok: boolean;
  empreintes: Record<string, string> | null;
}

export interface EntreeBascule {
  jeu: JeuStripe | JeuPaypal | null;
  verification: VerificationConnue | null;
  empreintesActuelles: Record<string, string> | null;
}

/**
 * Peut-on passer « pour de vrai » ? Recalculé sans cache, côté serveur, au
 * moment du clic. Les raisons sont écrites pour la propriétaire : chacune dit
 * le geste qui la lève.
 *
 *  - au moins un jeu live, utilisable à la caisse ;
 *  - chaque jeu live présent vérifié, et pas modifié depuis (empreintes) ;
 *  - pour Stripe, le secret du webhook live : sans lui, une cliente qui
 *    ferme l'onglet pendant la validation 3-D Secure laisserait une commande
 *    débitée mais « en attente », que rien ne viendrait rattraper.
 */
export function preconditionsBascule(
  entrees: Record<Prestataire, EntreeBascule>,
  /**
   * Les courriers peuvent-ils partir pour de vrai (Resend : RESEND_API_KEY et
   * MAIL_FROM) ? L'interrupteur les fait partir en même temps que les
   * paiements : une cliente qui paie doit recevoir sa confirmation.
   */
  courriersPrets = true,
): {
  possible: boolean;
  raisons: string[];
} {
  const raisons: string[] = [];
  if (!courriersPrets)
    raisons.push(
      "Les courriels ne peuvent pas partir pour de vrai : il manque RESEND_API_KEY ou MAIL_FROM dans les réglages du serveur (le .env), avec un domaine validé chez Resend.",
    );
  const presents = PRESTATAIRES.filter((p) => entrees[p].jeu);
  if (presents.length === 0)
    return {
      possible: false,
      raisons: [
        ...raisons,
        "Aucune clé live : saisissez les clés de la colonne « Pour de vrai » de Stripe ou de PayPal, puis cliquez « Vérifier ».",
      ],
    };
  for (const p of presents) {
    const { jeu, verification, empreintesActuelles } = entrees[p];
    const nom = NOMS_PRESTATAIRES[p];
    if (jeu!.prestataire === "stripe") {
      if (!jeu!.clePublique)
        raisons.push("La clé publique Stripe live manque : la carte ne pourrait pas s'afficher à la caisse.");
      if (!jeu!.secretWebhook) raisons.push("Il manque le secret du webhook Stripe live (whsec_…).");
    } else if (!jeu!.clientIdNavigateur) {
      raisons.push("Le client-id PayPal live du navigateur manque : le bouton PayPal ne pourrait pas s'afficher.");
    }
    if (!verification)
      raisons.push(`Clés ${nom} live jamais vérifiées : cliquez « Vérifier » dans la colonne « Pour de vrai ».`);
    else if (!memesEmpreintes(verification.empreintes, empreintesActuelles))
      raisons.push(`Clés ${nom} live modifiées depuis la dernière vérification : cliquez « Vérifier ».`);
    else if (!verification.ok)
      raisons.push(`La dernière vérification des clés ${nom} live a échoué : corrigez-les, puis cliquez « Vérifier ».`);
  }
  return { possible: raisons.length === 0, raisons };
}

/* -------------------------------------------------------------------------- */
/*  La phrase de tête                                                         */
/* -------------------------------------------------------------------------- */

export type Ton = "essai" | "reel" | "mixte" | "aucun";

/**
 * L'état en une phrase, pour la tête de l'écran Paiements et l'accueil du
 * back-office : « Mode essai : Stripe test, PayPal sandbox, étiquettes non
 * payées. »
 */
export function phraseEtat(
  cfg: Pick<ConfigEffective, "stripe" | "paypal" | "etiquettesReelles" | "choisi">,
  colisBranche: boolean,
): { texte: string; ton: Ton } {
  const parties = [
    cfg.stripe ? `Stripe ${nomDuMode("stripe", cfg.stripe.mode)}` : "Stripe non branché",
    cfg.paypal ? `PayPal ${nomDuMode("paypal", cfg.paypal.mode)}` : "PayPal non branché",
    !colisBranche
      ? "SendCloud non branché"
      : cfg.etiquettesReelles
        ? "étiquettes payantes"
        : "étiquettes non payées",
  ].join(", ");
  const modes = [cfg.stripe?.mode, cfg.paypal?.mode].filter((m): m is Mode => Boolean(m));
  const ton: Ton =
    modes.length === 0
      ? "aucun"
      : modes.every((m) => m === "test")
        ? "essai"
        : modes.every((m) => m === "live")
          ? "reel"
          : "mixte";
  const tete =
    ton === "essai"
      ? "Mode essai"
      : ton === "reel"
        ? "Pour de vrai"
        : ton === "mixte"
          ? `Attention, mode mixte${cfg.choisi === "env" ? " (choisi par les réglages du serveur)" : ""}`
          : "Aucun moyen de paiement branché";
  return { texte: `${tete} : ${parties}.`, ton };
}

/* -------------------------------------------------------------------------- */
/*  Ce qui revient d'un prestataire                                           */
/* -------------------------------------------------------------------------- */

/**
 * Un texte venu d'un prestataire, rendu sûr à afficher : toute longue suite de
 * lettres et de chiffres (une clé, un jeton) devient « … », et le tout tient
 * en 300 caractères.
 */
export function masquer(texte: unknown): string {
  return String(texte ?? "")
    .replace(/[A-Za-z0-9]{20,}/g, "…")
    .slice(0, 300);
}
