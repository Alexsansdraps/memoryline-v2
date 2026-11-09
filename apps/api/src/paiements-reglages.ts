/**
 * Les réglages de paiement saisis au back-office (BO › Réglages › Paiements) :
 * lecture en base, cache, et les routes de l'écran.
 *
 * Pourquoi un écran : passer la boutique en réel demandait d'éditer le .env
 * du serveur (six variables, dont une qui l'emporte en silence sur une
 * autre) puis de redémarrer l'API. Une faute de frappe y laissait la boutique
 * en essai sans que rien ne le dise, ou pire, en réel avec des clés d'essai.
 * L'écran saisit les clés, les vérifie chez le prestataire sans rien payer,
 * et bascule Stripe ET PayPal d'un coup, avec une confirmation qui dit ce que
 * ça change.
 *
 * LE BACK-OFFICE PASSE DEVANT LE .env, qui reste le repli : rien de saisi,
 * interrupteur jamais touché, et tout marche exactement comme avant
 * (paiements-cles.ts, resoudreConfig).
 *
 * SANS REDÉMARRAGE : la configuration est relue à chaque usage, avec un
 * cache de 30 secondes que chaque écriture vide. L'API tourne en un seul
 * processus (docker-compose) : la modification vaut dès la requête suivante,
 * et une retouche faite à la main en base, en 30 secondes au plus.
 *
 * SÉCURITÉ, en quelques règles tenues par construction :
 *   - aucune route ne renvoie une valeur, ni même la fin d'une clé du .env ;
 *     seules les clés PUBLIQUES du jeu actif partent au navigateur, par
 *     GET /payments/config ;
 *   - les valeurs sont chiffrées en base (paiements-cles.ts), et les clés
 *     live exigent APP_SECRET (refusChiffrementLive) ;
 *   - une clé live ne sert jamais sans vérification réussie : verrou de la
 *     bascule, colonne en attente tant que le .env décide, et vérification
 *     AVANT remplacement quand la boutique encaisse pour de vrai ;
 *   - toutes les routes sont sous /admin/* (garde de session ; écritures
 *     réservées à la propriétaire) et revérifient le rôle elles-mêmes : un
 *     vendeur ne lit même pas l'état ;
 *   - chaque écriture laisse une ligne au journal : qui, quand, quelle case,
 *     sans la valeur ;
 *   - rien ne se supprime : effacer une clé, c'est l'archiver.
 *
 * Le déchiffrement se fait ICI, dans l'API, et nulle part ailleurs : le
 * back-office (processus Astro) ne voit jamais une valeur.
 */
import type { Context, Hono } from "hono";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "./db/client.js";
import {
  AVEC_ARTICLE,
  CHAMPS,
  accord,
  LIBELLES_CHAMPS,
  MODES,
  NOMS_PRESTATAIRES,
  OBLIGATOIRES,
  casesVides,
  chiffrer,
  cibleDeVerification,
  controlerForme,
  dechiffrer,
  deriverCles,
  effetDeLaColonne,
  empreinte,
  empreintesDuJeu,
  estChampDe,
  estMode,
  estPrestataire,
  etiquettesDuEnv,
  finDe,
  jeuPaypalBO,
  jeuStripeBO,
  masquer,
  matiereDuServeur,
  memesEmpreintes,
  nomDuMode,
  phraseEtat,
  preconditionsBascule,
  refusChiffrementLive,
  refusCroise,
  resoudreConfig,
  type CasesBO,
  type Champ,
  type Choix,
  type ClesDerivees,
  type ConfigEffective,
  type EmpreinteConnue,
  type JeuPaypal,
  type JeuStripe,
  type LectureBO,
  type Mode,
  type Prestataire,
  type Source,
  type VerificationConnue,
} from "./paiements-cles.js";
import { verifierPaypal, verifierStripe, type VerdictCles } from "./payments.js";
import {
  courrierModePaiement,
  courriersReelsPrets,
  envoyer as envoyerMail,
  estConfigure as courriersConfigures,
  estEnEssai as courriersEnEssai,
  noterModeBoutique,
  type ModeBoutique,
} from "./mail.js";
// Import croisé : sendcloud-colis.ts lit `etiquettesReelles` ici. Chacun ne
// s'en sert qu'à l'intérieur d'une fonction, jamais au chargement du module :
// le cycle ne se referme pas pendant l'évaluation (même cas que commandes.ts
// et configurator-routes.ts).
import { colisConfigure } from "./sendcloud-colis.js";

/* -------------------------------------------------------------------------- */
/*  Les clés du serveur                                                       */
/* -------------------------------------------------------------------------- */

let derivees: { matiere: string; cles: ClesDerivees } | null = null;

/**
 * Les clés de chiffrement de CE serveur, dérivées d'APP_SECRET (sinon de
 * l'adresse de la base), ou null : sans matière, rien ne s'enregistre.
 * Recalculées si la matière change, ce qui n'arrive qu'au redémarrage.
 */
export function clesDuServeur(): ClesDerivees | null {
  const m = matiereDuServeur(process.env);
  if (!m) return null;
  if (derivees?.matiere !== m.matiere)
    derivees = { matiere: m.matiere, cles: deriverCles(m.matiere, m.source) };
  return derivees.cles;
}

/* -------------------------------------------------------------------------- */
/*  Lecture                                                                   */
/* -------------------------------------------------------------------------- */

type LigneCle = typeof schema.clesPaiement.$inferSelect;
type LigneJournal = typeof schema.journalPaiement.$inferSelect;

/** Tout ce qu'il faut pour décider ET pour expliquer, lu d'un coup. */
interface EtatLu {
  config: ConfigEffective;
  cases: CasesBO;
  lignes: LigneCle[];
  /** La dernière ligne de chaque sujet (mode, étiquettes, vérifications). */
  derniers: LigneJournal[];
  cles: ClesDerivees | null;
}

/** Les cases du back-office, déchiffrées quand elles peuvent l'être. */
function casesDepuis(lignes: LigneCle[], cles: ClesDerivees | null): CasesBO {
  const cases = casesVides();
  for (const l of lignes) {
    if (!estPrestataire(l.prestataire) || !estMode(l.mode) || !estChampDe(l.prestataire, l.champ))
      continue;
    const d = dechiffrer(cles, l.prestataire, l.mode, l.champ, l.valeurChiffree);
    cases[l.prestataire][l.mode][l.champ] =
      d.etat === "ok"
        ? { etat: "ok", valeur: d.valeur, fin: l.fin, le: l.creeLe, par: l.creePar }
        : { etat: d.etat, fin: l.fin, le: l.creeLe, par: l.creePar };
  }
  return cases;
}

function choixDuJournal(derniers: LigneJournal[]): Choix {
  const v = derniers.find((l) => l.action === "mode")?.valeur;
  return v === "essai" || v === "reel" ? v : "env";
}

/** « oui », « non », ou null : « env » (rendu aux réglages du serveur) ou jamais touché. */
function etiquettesDuJournal(derniers: LigneJournal[]): boolean | null {
  const v = derniers.find((l) => l.action === "etiquettes")?.valeur;
  return v === "oui" ? true : v === "non" ? false : null;
}

/** La dernière vérification d'un jeu, telle que le journal la garde. */
function derniereVerification(derniers: LigneJournal[], p: Prestataire, m: Mode): LigneJournal | null {
  return derniers.find((l) => l.action === "verification" && l.prestataire === p && l.mode === m) ?? null;
}

interface DetailVerification {
  ok?: boolean;
  message?: string;
  compte?: string | null;
  source?: string;
  empreintes?: Record<string, string> | null;
}

function verificationConnue(l: LigneJournal | null): VerificationConnue | null {
  if (!l) return null;
  const d = (l.detail ?? {}) as DetailVerification;
  return { ok: d.ok === true, empreintes: d.empreintes ?? null };
}

/** Le jeu COMPLET d'une colonne du back-office, quel que soit le prestataire. */
function jeuBO(cases: CasesBO, p: Prestataire, m: Mode): JeuStripe | JeuPaypal | null {
  return p === "stripe" ? jeuStripeBO(cases.stripe[m], m) : jeuPaypalBO(cases.paypal[m], m);
}

/**
 * La colonne live d'ici a-t-elle passé sa dernière vérification, sur ces
 * valeurs-là ? C'est la condition pour qu'elle serve tant que le .env décide
 * (resoudreConfig) : une clé remplacée depuis périme la vérification.
 */
function liveVerifieDepuis(
  cases: CasesBO,
  derniers: LigneJournal[],
  cles: ClesDerivees | null,
): Record<Prestataire, boolean> {
  const verifie = (p: Prestataire): boolean => {
    const jeu = jeuBO(cases, p, "live");
    if (!jeu) return false;
    const v = verificationConnue(derniereVerification(derniers, p, "live"));
    return Boolean(v?.ok && memesEmpreintes(v.empreintes, empreintesDuJeu(cles, jeu)));
  };
  return { stripe: verifie("stripe"), paypal: verifie("paypal") };
}

/** Lit tout, SANS cache : c'est ce que les écritures et l'écran utilisent. */
async function chargerEtat(): Promise<EtatLu> {
  const cles = clesDuServeur();
  const j = schema.journalPaiement;
  const [lignes, derniers] = await Promise.all([
    db.select().from(schema.clesPaiement).where(isNull(schema.clesPaiement.archiveLe)),
    db
      .selectDistinctOn([j.action, j.prestataire, j.mode])
      .from(j)
      .where(inArray(j.action, ["mode", "etiquettes", "verification"]))
      .orderBy(j.action, j.prestataire, j.mode, desc(j.id)),
  ]);
  const cases = casesDepuis(lignes, cles);
  const config = resoudreConfig(
    process.env,
    cases,
    choixDuJournal(derniers),
    etiquettesDuJournal(derniers),
    liveVerifieDepuis(cases, derniers, cles),
  );
  return { config, cases, lignes, derniers, cles };
}

/* -------------------------------------------------------------------------- */
/*  Le cache                                                                  */
/* -------------------------------------------------------------------------- */

const DUREE_CACHE_MS = 30_000;
let cache: { config: ConfigEffective; jusqua: number } | null = null;
let enVol: Promise<ConfigEffective> | null = null;
/** Avance à chaque écriture : un chargement parti AVANT ne se met pas en cache. */
let generation = 0;
/** La dernière configuration lue, gardée pour une panne de la base. */
let derniereConnue: ConfigEffective | null = null;

/** Ce que l'interrupteur dit aux courriers (mail.ts) : « env » = jamais touché. */
function modeBoutiqueDe(choisi: ConfigEffective["choisi"]): ModeBoutique {
  return choisi === "reel" || choisi === "essai" ? choisi : null;
}

function lancerChargement(): Promise<ConfigEffective> {
  const gen = generation;
  const p: Promise<ConfigEffective> = chargerEtat()
    .then(({ config }) => {
      if (gen === generation) {
        cache = { config, jusqua: Date.now() + DUREE_CACHE_MS };
        derniereConnue = config;
      }
      // Les courriers suivent l'interrupteur (mail.ts) : ils apprennent le
      // mode à chaque lecture, et savent le relire avant chaque envoi.
      noterModeBoutique(modeBoutiqueDe(config.choisi), async () =>
        modeBoutiqueDe((await configPaiement()).choisi),
      );
      return config;
    })
    .finally(() => {
      if (enVol === p) enVol = null;
    });
  enVol = p;
  return p;
}

/**
 * La configuration de paiement EFFECTIVE : celle qui sert, à cet instant.
 *
 * Deux appels simultanés attendent le même chargement. Si la base ne répond
 * pas, on garde la dernière configuration connue, même périmée, plutôt que de
 * retomber sur le .env seul : une boutique passée en réel remontrerait sinon
 * ses clés d'essai pendant la panne. Sans configuration connue du tout (la
 * base injoignable dès le démarrage), le .env seul.
 */
export async function configPaiement(): Promise<ConfigEffective> {
  if (cache && cache.jusqua > Date.now()) return cache.config;
  try {
    return await (enVol ?? lancerChargement());
  } catch (e) {
    console.error("[paiements] réglages illisibles, on garde les derniers connus :", e instanceof Error ? e.message : e);
    return derniereConnue ?? resoudreConfig(process.env, casesVides(), "env", null);
  }
}

/**
 * À appeler après CHAQUE écriture, vérifications comprises (une vérification
 * réussie met en service une colonne live en attente) : la requête suivante
 * relit la base.
 */
export function oublierConfigPaiement(): void {
  generation += 1;
  cache = null;
  enVol = null;
}

/**
 * Le mode d'un paiement existant : celui qu'il porte, sinon celui du .env.
 * Avant cet écran, tout passait par le .env : une ligne sans mode a été
 * ouverte avec ses clés.
 */
export function modeDuPaiement(
  paiement: { mode?: string | null },
  p: Prestataire,
  config: ConfigEffective,
): Mode {
  return estMode(paiement.mode) ? paiement.mode : config.modeEnv[p];
}

// Une commande payée en ESSAI alors que la boutique encaisse pour de vrai :
// la décision est pure, elle vit avec les autres (paiements-cles.ts) ; la
// fiche, la liste et les Finances la prennent ici, avec la configuration.
export { payeeEnEssai } from "./paiements-cles.js";

/** Acheter les vraies étiquettes SendCloud ? L'écran d'abord, puis le .env. */
export async function etiquettesReelles(): Promise<boolean> {
  return (await configPaiement()).etiquettesReelles;
}

/* -------------------------------------------------------------------------- */
/*  Les avis du webhook                                                       */
/* -------------------------------------------------------------------------- */

const derniersAvis: Record<Mode, Date | null> = { test: null, live: null };
/** Le dernier avis refusé parce qu'il contredisait le secret qui l'a signé. */
let dernierAvisRefuse: { le: Date; secret: Mode; avis: Mode } | null = null;

/** Un avis Stripe vient d'être reçu et sa signature vérifiée. */
export function noterAvisStripe(mode: Mode): void {
  derniersAvis[mode] = new Date();
}

/**
 * Un avis signé avec le secret d'un mode, qui se dit de l'autre : refusé.
 * L'écran le montre, parce que la cause ordinaire n'est pas un faux mais le
 * secret du webhook collé dans la mauvaise colonne.
 */
export function noterAvisIncoherent(secret: Mode, avis: Mode): void {
  dernierAvisRefuse = { le: new Date(), secret, avis };
}

/** L'adresse du webhook à recopier dans Stripe. */
export function adresseDuWebhook(): { adresse: string; local: boolean } {
  const origine =
    (process.env.PUBLIC_ORIGIN ?? "").trim().replace(/\/+$/, "") || "http://localhost:8080";
  let local = true;
  try {
    const h = new URL(origine).hostname;
    local = h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h.endsWith(".localhost");
  } catch {
    local = true;
  }
  return { adresse: `${origine}/api/payments/stripe/webhook`, local };
}

/* -------------------------------------------------------------------------- */
/*  Vérifications                                                             */
/* -------------------------------------------------------------------------- */

/** Une vérification par jeu toutes les 5 secondes : le bouton martelé n'insiste pas. */
const derniereDemande = new Map<string, number>();
const INTERVALLE_VERIFICATION_MS = 5_000;

/** Trop tôt pour vérifier de nouveau cette colonne ? Rend la phrase, ou null (et note l'heure). */
function tropTot(p: Prestataire, m: Mode): string | null {
  const sujet = `${p}:${m}`;
  const avant = derniereDemande.get(sujet);
  if (avant && Date.now() - avant < INTERVALLE_VERIFICATION_MS)
    return "Une vérification vient d'être faite : attendez quelques secondes avant de recommencer.";
  derniereDemande.set(sujet, Date.now());
  return null;
}

/** Essaie un jeu chez son prestataire, sans rien payer ni créer. */
function essayer(jeu: JeuStripe | JeuPaypal): Promise<VerdictCles> {
  const { adresse, local } = adresseDuWebhook();
  return jeu.prestataire === "stripe"
    ? verifierStripe(jeu, { adresseWebhook: adresse, local })
    : verifierPaypal(jeu);
}

/** La ligne de journal d'une vérification : le verdict et les empreintes de ce qui a été essayé. */
function ligneDeVerification(
  jeu: JeuStripe | JeuPaypal,
  source: Source,
  verdict: VerdictCles,
  par: string | null,
  cles: ClesDerivees | null,
  le: Date,
): typeof schema.journalPaiement.$inferInsert {
  return {
    le,
    par,
    action: "verification",
    prestataire: jeu.prestataire,
    mode: jeu.mode,
    valeur: verdict.ok ? "ok" : "refus",
    detail: {
      ok: verdict.ok,
      message: masquer(verdict.message),
      compte: verdict.compte,
      source,
      empreintes: empreintesDuJeu(cles, jeu),
    },
  };
}

/** D'où viennent les clés vérifiées, en clair : le verdict le dit toujours. */
const ORIGINE: Record<Source, string> = {
  bo: "Clés saisies ici",
  env: "Clés des réglages du serveur (.env)",
};

type Verification = VerdictCles & { le: string; source: Source };
type RefusVerification = { refus: string; statut: 409 | 429 };

/**
 * Vérifie ce que le bouton « Vérifier » de la colonne désigne
 * (cibleDeVerification : la colonne complète ici, ou les clés du serveur si
 * rien n'y est saisi, jamais un mélange) et l'écrit au journal, avec les
 * empreintes de ce qui a été vérifié : remplacer une seule clé périme la
 * vérification d'elle-même.
 */
async function verifierEtJournaliser(
  p: Prestataire,
  m: Mode,
  etat: EtatLu,
  par: string | null,
): Promise<Verification | RefusVerification> {
  const cible = cibleDeVerification(etat.config, etat.cases, p, m);
  if (!cible)
    return {
      refus: `Rien à vérifier : la colonne est vide, et les réglages du serveur n'ont pas de clés ${NOMS_PRESTATAIRES[p]} ${nomDuMode(p, m)}.`,
      statut: 409,
    };
  if (!cible.jeu)
    return {
      refus: `Complétez d'abord la colonne : il manque ${cible.manque.map((c) => AVEC_ARTICLE[c]).join(" et ")}. « Vérifier » essaie les clés saisies ici, jamais un mélange avec celles du serveur.`,
      statut: 409,
    };
  const trop = tropTot(p, m);
  if (trop) return { refus: trop, statut: 429 };

  const verdict = await essayer(cible.jeu);
  const le = new Date();
  await db.insert(schema.journalPaiement).values(ligneDeVerification(cible.jeu, cible.source, verdict, par, etat.cles, le));
  // Une vérification réussie peut mettre en service une colonne live en
  // attente (resoudreConfig) : la caisse doit le voir tout de suite.
  oublierConfigPaiement();
  console.info(`[paiements] ${par ?? "?"} a vérifié ${p} ${m} (${cible.source}) : ${verdict.ok ? "ok" : "refus"}`);
  return { ...verdict, message: masquer(verdict.message), le: le.toISOString(), source: cible.source };
}

/** Peut-on passer en réel, d'après ce qui est en base À CET INSTANT ? */
function bascule(etat: EtatLu): { possible: boolean; raisons: string[] } {
  const entree = (p: Prestataire) => {
    // Le jeu qui servirait en réel : la colonne live d'ici si elle est
    // complète, sinon celui du .env, qu'il faut avoir vérifié aussi.
    const jeu = etat.config.candidats[p].live;
    return {
      jeu,
      verification: verificationConnue(derniereVerification(etat.derniers, p, "live")),
      empreintesActuelles: jeu ? empreintesDuJeu(etat.cles, jeu) : null,
    };
  };
  return preconditionsBascule({ stripe: entree("stripe"), paypal: entree("paypal") }, courriersReelsPrets());
}

/* -------------------------------------------------------------------------- */
/*  Ce que l'écran affiche                                                    */
/* -------------------------------------------------------------------------- */

/** Le jeu peut-il servir à la caisse (sa clé du navigateur est là) ? */
function utilisableALaCaisse(jeu: JeuStripe | JeuPaypal | null): boolean {
  if (!jeu) return false;
  return jeu.prestataire === "stripe" ? Boolean(jeu.clePublique) : Boolean(jeu.clientIdNavigateur);
}

/** Le .env renseigne-t-il cette case, pour ce jeu ? (jamais sa valeur) */
function caseDuEnv(jeu: JeuStripe | JeuPaypal, champ: Champ): boolean {
  if (jeu.prestataire === "stripe") {
    if (champ === "cle_publique") return Boolean(jeu.clePublique);
    if (champ === "cle_secrete") return true;
    if (champ === "secret_webhook") return Boolean(jeu.secretWebhook);
    return false;
  }
  return champ === "client_id" || champ === "secret";
}

/**
 * Ce qu'effacer cette case changerait à la caisse : « retire » (le
 * prestataire n'y est plus proposé), « serveur » (la caisse reprend aussitôt
 * les clés des réglages du serveur), ou null (rien : la case ne sert pas au
 * jeu en service). La confirmation de l'écran le dit ; « retire » exige en
 * plus une confirmation côté serveur.
 */
function apresEffacement(
  config: ConfigEffective,
  p: Prestataire,
  m: Mode,
  champ: Champ,
): "retire" | "serveur" | null {
  const actif = config[p];
  if (!actif || actif.source !== "bo" || actif.mode !== m) return null;
  if (!(OBLIGATOIRES[p] as readonly string[]).includes(champ)) return null;
  const env = config.env[p];
  return env && env.mode === m && utilisableALaCaisse(env) ? "serveur" : "retire";
}

function etatDeLaColonne(etat: EtatLu, p: Prestataire, m: Mode) {
  const { config, cases, cles, derniers } = etat;
  const env = config.env[p] && config.env[p]!.mode === m ? config.env[p]! : null;
  const casesM = cases[p][m];
  const saisies = Object.keys(casesM).length > 0;
  const champs = CHAMPS[p].map((champ) => {
    const l = casesM[champ];
    const apres = apresEffacement(config, p, m, champ);
    const base = { champ, libelle: LIBELLES_CHAMPS[champ], effacementRetire: apres === "retire", apresEffacement: apres };
    if (l)
      return l.etat === "ok"
        ? { ...base, etat: "bo" as const, le: l.le.toISOString(), par: l.par, fin: l.fin }
        : { ...base, etat: "a_ressaisir" as const, le: l.le.toISOString(), par: l.par, fin: null };
    if (env && caseDuEnv(env, champ)) return { ...base, etat: "env" as const, le: null, par: null, fin: null };
    return { ...base, etat: "vide" as const, le: null, par: null, fin: null };
  });
  const jeu = config.jeux[p][m];
  const source = config.bo[p][m]
    ? ("bo" as const)
    : env
      ? saisies
        ? ("incomplet_env" as const)
        : ("env" as const)
      : saisies
        ? ("incomplet" as const)
        : ("aucune" as const);
  const cible = cibleDeVerification(config, cases, p, m);
  const v = derniereVerification(derniers, p, m);
  const d = (v?.detail ?? {}) as DetailVerification;
  return {
    champs,
    source,
    /** Ce jeu sert-il en ce moment aux nouveaux paiements ? */
    actif: Boolean(jeu) && config[p] === jeu,
    /** Colonne live complète, que le .env mettrait en service, en attente d'une vérification réussie. */
    enAttente: m === "live" && config.liveEnAttente[p],
    verifiable: Boolean(cible?.jeu),
    /** Ce que « Vérifier » essaierait : les clés d'ici, celles du serveur, ou rien. */
    verifieQuoi: cible?.jeu ? cible.source : null,
    /** Colonne entamée ici : les cases qui manquent pour vérifier (« la clé publique »). */
    manque: cible && !cible.jeu ? cible.manque.map((c) => AVEC_ARTICLE[c]) : [],
    // Une colonne vide n'a rien à montrer : son dernier verdict portait sur
    // des clés effacées depuis, et l'afficher en rouge inquiétait pour rien.
    verification:
      v && cible
        ? {
            ok: d.ok === true,
            message: masquer(d.message ?? ""),
            compte: d.compte ?? null,
            source: d.source === "bo" || d.source === "env" ? d.source : null,
            le: v.le.toISOString(),
            par: v.par,
            aJour: Boolean(cible.jeu) && memesEmpreintes(d.empreintes, cible.jeu ? empreintesDuJeu(cles, cible.jeu) : null),
          }
        : null,
  };
}

/* -------------------------------------------------------------------------- */
/*  Routes                                                                    */
/* -------------------------------------------------------------------------- */

/** Le corps d'une requête, qu'il vienne d'un fetch (JSON) ou d'un formulaire. */
async function corps(c: Context): Promise<Record<string, unknown>> {
  const type = c.req.header("content-type") ?? "";
  if (type.includes("application/json"))
    return ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  return (await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>;
}

const confirme = (v: unknown) => v === true || v === "oui";

/** Une contrainte d'unicité refusée (deux enregistrements au même instant). */
function estConflit(e: unknown): boolean {
  const x = e as { code?: string; cause?: { code?: string } } | null;
  return x?.code === "23505" || x?.cause?.code === "23505";
}

const CONFLIT =
  "Une autre modification vient d'avoir lieu sur cette case : rechargez la page, puis recommencez.";

/** Les empreintes de tout ce qui est connu pour ce prestataire (BO et .env). */
function empreintesConnues(etat: EtatLu, cles: ClesDerivees, p: Prestataire): EmpreinteConnue[] {
  const out: EmpreinteConnue[] = [];
  for (const m of MODES)
    for (const champ of CHAMPS[p]) {
      const l = etat.cases[p][m][champ];
      if (l?.etat === "ok") out.push({ mode: m, champ, empreinte: empreinte(cles, p, champ, l.valeur) });
    }
  const env = etat.config.env[p];
  if (env?.prestataire === "stripe") {
    if (env.clePublique)
      out.push({ mode: env.mode, champ: "cle_publique", empreinte: empreinte(cles, p, "cle_publique", env.clePublique) });
    out.push({ mode: env.mode, champ: "cle_secrete", empreinte: empreinte(cles, p, "cle_secrete", env.cleSecrete.devoiler()) });
    if (env.secretWebhook)
      out.push({ mode: env.mode, champ: "secret_webhook", empreinte: empreinte(cles, p, "secret_webhook", env.secretWebhook.devoiler()) });
  } else if (env?.prestataire === "paypal") {
    out.push({ mode: env.mode, champ: "client_id", empreinte: empreinte(cles, p, "client_id", env.clientId) });
    out.push({ mode: env.mode, champ: "secret", empreinte: empreinte(cles, p, "secret", env.secret.devoiler()) });
  }
  return out;
}

interface DetailJournal {
  remplace?: boolean;
  message?: string;
}

/**
 * L'adresse qui reçoit les avis de changement de mode : celle des avis de
 * commande (MAIL_BOUTIQUE), puis celles que le formulaire de contact utilise
 * déjà. « Memory Line <a@b.fr> » devient « a@b.fr ».
 */
function adresseDesAvis(): string {
  for (const brut of [process.env.MAIL_BOUTIQUE, process.env.CONTACT_TO, process.env.MAIL_BCC, process.env.MAIL_FROM]) {
    const valeur = (brut ?? "").trim();
    if (!valeur) continue;
    const adresse = (valeur.match(/<([^>]+)>/)?.[1] ?? valeur).trim();
    if (adresse.includes("@")) return adresse;
  }
  // Essai local sans réglage : le courrier va de toute façon dans la boîte de test.
  return process.env.MAIL_TEST_URL ? "boutique@memoryline.test" : "";
}

export function mountPaiementsReglages(app: Hono): void {
  /**
   * Toutes ces routes sont sous /admin/* : la garde exige une session, et
   * réserve déjà les écritures à la propriétaire. Chacune revérifie le rôle,
   * y compris en lecture : l'état dit quels comptes sont branchés, et un
   * vendeur n'a pas à le savoir.
   */
  const proprietaire = (c: Context) => c.get("utilisateur")?.role === "owner";
  const interdit = (c: Context) =>
    c.json({ error: "Les réglages de paiement sont réservés à la propriétaire." }, 403);
  const auteur = (c: Context) => c.get("utilisateur")?.email ?? null;

  /** L'état de l'écran, SANS aucune valeur, sans même la fin d'une clé du .env. */
  app.get("/admin/paiements", async (c) => {
    if (!proprietaire(c)) return interdit(c);
    const etat = await chargerEtat();
    const { config, cles } = etat;
    const branche = colisConfigure();
    const phrase = phraseEtat(config, branche);
    const journal = await db
      .select()
      .from(schema.journalPaiement)
      .orderBy(desc(schema.journalPaiement.id))
      .limit(20);
    const verifStripeLive = derniereVerification(etat.derniers, "stripe", "live");
    const detailStripeLive = (verifStripeLive?.detail ?? {}) as DetailVerification;
    const webhook = adresseDuWebhook();
    const raisonLive = refusChiffrementLive(cles);
    c.header("Cache-Control", "no-store");
    return c.json({
      resume: phrase.texte,
      ton: phrase.ton,
      choisi: config.choisi,
      actif: {
        stripe: config.stripe ? { mode: config.stripe.mode, source: config.stripe.source } : null,
        paypal: config.paypal ? { mode: config.paypal.mode, source: config.paypal.source } : null,
      },
      chiffrement: {
        possible: Boolean(cles),
        source: cles?.source ?? null,
        // La colonne « Pour de vrai » n'est ouverte qu'avec APP_SECRET.
        live: raisonLive === null,
        raisonLive,
      },
      bascule: bascule(etat),
      stripe: { test: etatDeLaColonne(etat, "stripe", "test"), live: etatDeLaColonne(etat, "stripe", "live") },
      paypal: { test: etatDeLaColonne(etat, "paypal", "test"), live: etatDeLaColonne(etat, "paypal", "live") },
      compteStripeLive: detailStripeLive.ok ? (detailStripeLive.compte ?? null) : null,
      webhook: {
        adresse: webhook.adresse,
        local: webhook.local,
        evenement: "payment_intent.succeeded",
        derniersAvis: {
          test: derniersAvis.test?.toISOString() ?? null,
          live: derniersAvis.live?.toISOString() ?? null,
        },
        avisRefuse: dernierAvisRefuse
          ? { le: dernierAvisRefuse.le.toISOString(), secret: dernierAvisRefuse.secret, avis: dernierAvisRefuse.avis }
          : null,
      },
      // Où partent les courriers à cet instant, et s'ils pourraient partir
      // pour de vrai (l'interrupteur les y envoie avec les paiements).
      courriels: {
        voie: courriersEnEssai() ? "boite" : courriersConfigures() ? "resend" : "aucun",
        reelsPrets: courriersReelsPrets(),
      },
      etiquettes: {
        reelles: config.etiquettesReelles,
        source: config.etiquettesSource,
        configure: branche,
        // Ce que les réglages du serveur diraient, pour le lien « les laisser décider ».
        serveur: etiquettesDuEnv(process.env),
      },
      journal: journal.map((l) => {
        const d = (l.detail ?? {}) as DetailVerification & DetailJournal;
        return {
          id: l.id,
          le: l.le.toISOString(),
          par: l.par,
          action: l.action,
          prestataire: l.prestataire,
          mode: l.mode,
          champ: l.champ,
          valeur: l.valeur,
          remplace: l.action === "cle_enregistree" && d.remplace === true,
          message:
            l.action === "verification" || l.action === "cle_refusee" ? masquer(d.message ?? "") : null,
        };
      }),
    });
  });

  /**
   * Enregistre (ou remplace) une valeur. Contrôle de forme d'abord, puis les
   * contrôles croisés (même valeur dans l'autre colonne). La valeur ne
   * revient JAMAIS, ni dans la réponse, ni dans un message d'erreur.
   *
   * Quand la boutique encaisse pour de vrai, une valeur live qui changerait
   * le jeu en service est vérifiée AVANT d'être enregistrée : refusée par le
   * prestataire, elle n'est pas gardée, et l'ancienne continue de servir.
   * Sans cela, une clé de la bonne forme mais fausse (une autre application,
   * un compte non activé) servait aussitôt à la caisse.
   */
  app.post("/admin/paiements/cle", async (c) => {
    if (!proprietaire(c)) return interdit(c);
    const b = await corps(c);
    const p = b.prestataire;
    const m = b.mode;
    if (!estPrestataire(p) || !estMode(m) || !estChampDe(p, b.champ))
      return c.json({ error: "Case inconnue." }, 400);
    const champ = b.champ;
    const cles = clesDuServeur();
    if (!cles)
      return c.json(
        {
          error:
            "Impossible d'enregistrer : le serveur n'a ni APP_SECRET ni adresse de base pour chiffrer les clés. Faites poser APP_SECRET dans les réglages du serveur (.env).",
        },
        409,
      );
    if (m === "live") {
      const fermee = refusChiffrementLive(cles);
      if (fermee) return c.json({ error: fermee }, 409);
    }
    const forme = controlerForme(p, m, champ, b.valeur);
    if (!forme.ok) return c.json({ error: forme.message }, 400);
    const valeur = forme.valeur;
    const emp = empreinte(cles, p, champ, valeur);

    const etat = await chargerEtat();
    const vivante = etat.lignes.find((l) => l.prestataire === p && l.mode === m && l.champ === champ);
    if (vivante && etat.cases[p][m][champ]?.etat === "ok" && vivante.empreinte === emp)
      return c.json({ ok: true, code: "deja", message: "Cette valeur est déjà enregistrée : rien n'a changé." });
    const croise = refusCroise(
      p,
      m,
      champ,
      emp,
      empreintesConnues(etat, cles, p).filter((k) => !(k.mode === m && k.champ === champ)),
    );
    if (croise) return c.json({ error: croise }, 400);

    const par = auteur(c);

    // En réel : le jeu live tel qu'il SERAIT avec cette valeur, vérifié avant.
    let verifieAvant: { jeu: JeuStripe | JeuPaypal; verdict: VerdictCles } | null = null;
    if (m === "live" && etat.config.choisi === "reel") {
      const liveApres: Partial<Record<Champ, LectureBO>> = { ...etat.cases[p].live };
      liveApres[champ] = { etat: "ok", valeur, fin: finDe(valeur), le: new Date(), par };
      const jeuApres = p === "stripe" ? jeuStripeBO(liveApres, "live") : jeuPaypalBO(liveApres, "live");
      if (jeuApres) {
        const trop = tropTot(p, "live");
        if (trop) return c.json({ error: trop }, 429);
        const verdict = await essayer(jeuApres);
        if (!verdict.ok) {
          await db.insert(schema.journalPaiement).values({
            par,
            action: "cle_refusee",
            prestataire: p,
            mode: m,
            champ,
            detail: { message: masquer(verdict.message) },
          });
          console.info(`[paiements] ${par ?? "?"} : ${p} live ${champ} refusée à la vérification, non enregistrée`);
          return c.json(
            {
              error:
                `Rien n'a changé : la boutique encaisse pour de vrai, et avec cette valeur la colonne « Pour de vrai » ne passe pas la vérification. ${masquer(verdict.message)}` +
                (vivante ? " L'ancienne valeur reste en service." : ""),
              code: "verification_refusee",
            },
            409,
          );
        }
        verifieAvant = { jeu: jeuApres, verdict };
      }
    }

    const maintenant = new Date();
    try {
      await db.transaction(async (tx) => {
        const t = schema.clesPaiement;
        await tx
          .update(t)
          .set({ archiveLe: maintenant, archivePar: par })
          .where(and(eq(t.prestataire, p), eq(t.mode, m), eq(t.champ, champ), isNull(t.archiveLe)));
        await tx.insert(t).values({
          prestataire: p,
          mode: m,
          champ,
          valeurChiffree: chiffrer(cles, p, m, champ, valeur),
          fin: finDe(valeur),
          empreinte: emp,
          creePar: par,
        });
        await tx.insert(schema.journalPaiement).values({
          par,
          action: "cle_enregistree",
          prestataire: p,
          mode: m,
          champ,
          detail: { remplace: Boolean(vivante) },
        });
        // La vérification faite avant, au même instant que l'enregistrement :
        // le jeu en service n'est jamais, même un instant, non vérifié.
        if (verifieAvant)
          await tx
            .insert(schema.journalPaiement)
            .values(ligneDeVerification(verifieAvant.jeu, "bo", verifieAvant.verdict, par, cles, maintenant));
      });
    } catch (e) {
      if (estConflit(e)) return c.json({ error: CONFLIT }, 409);
      throw e;
    }
    oublierConfigPaiement();
    console.info(`[paiements] ${par ?? "?"} a enregistré ${p} ${m} ${champ}`);

    // Un jeu live qui devient complet est vérifié tout de suite : c'est la
    // condition pour passer en réel, et pour servir tant que le .env décide.
    let apres = await chargerEtat();
    let verification: Verification | null = verifieAvant
      ? {
          ...verifieAvant.verdict,
          message: masquer(verifieAvant.verdict.message),
          le: maintenant.toISOString(),
          source: "bo",
        }
      : null;
    if (!verification && m === "live" && apres.config.bo[p].live) {
      const r = await verifierEtJournaliser(p, "live", apres, par);
      if (!("refus" in r)) {
        verification = r;
        apres = await chargerEtat();
      }
    }
    const nom = `${NOMS_PRESTATAIRES[p]} ${nomDuMode(p, m)}`;
    const e = accord(champ);
    const effet = effetDeLaColonne(apres.config, apres.cases, p, m);
    // Le secret du webhook sert dès qu'il est lisible, colonne complète ou non.
    const webhook =
      champ === "secret_webhook" && !apres.config.bo[p][m]
        ? " Le secret du webhook, lui, sert déjà à reconnaître les avis de Stripe."
        : "";
    return c.json({
      ok: true,
      code: vivante ? "remplacee" : "enregistree",
      message: `${LIBELLES_CHAMPS[champ]} ${nom} ${vivante ? `remplacé${e}` : `enregistré${e}`} (se termine par …${finDe(valeur)}). ${effet}${webhook}`,
      verification,
    });
  });

  /** Efface une valeur, c'est-à-dire l'ARCHIVE : la ligne reste, elle ne sert plus. */
  app.post("/admin/paiements/archiver", async (c) => {
    if (!proprietaire(c)) return interdit(c);
    const b = await corps(c);
    const p = b.prestataire;
    const m = b.mode;
    if (!estPrestataire(p) || !estMode(m) || !estChampDe(p, b.champ))
      return c.json({ error: "Case inconnue." }, 400);
    const champ = b.champ;
    const etat = await chargerEtat();
    const vivante = etat.lignes.find((l) => l.prestataire === p && l.mode === m && l.champ === champ);
    if (!vivante) return c.json({ error: "Cette case est déjà vide." }, 404);
    if (apresEffacement(etat.config, p, m, champ) === "retire" && !confirme(b.confirme))
      return c.json(
        {
          error: `${NOMS_PRESTATAIRES[p]} ne sera plus proposé à la caisse : confirmez l'effacement.`,
          code: "confirmation_requise",
        },
        409,
      );
    const par = auteur(c);
    await db.transaction(async (tx) => {
      await tx
        .update(schema.clesPaiement)
        .set({ archiveLe: new Date(), archivePar: par })
        .where(and(eq(schema.clesPaiement.id, vivante.id), isNull(schema.clesPaiement.archiveLe)));
      await tx.insert(schema.journalPaiement).values({
        par,
        action: "cle_archivee",
        prestataire: p,
        mode: m,
        champ,
      });
    });
    oublierConfigPaiement();
    console.info(`[paiements] ${par ?? "?"} a effacé ${p} ${m} ${champ}`);
    const e = accord(champ);
    const apres = await chargerEtat();
    const vide = Object.keys(apres.cases[p][m]).length === 0;
    return c.json({
      ok: true,
      message:
        `${LIBELLES_CHAMPS[champ]} ${NOMS_PRESTATAIRES[p]} ${nomDuMode(p, m)} effacé${e} (archivé${e}).` +
        (vide
          ? apres.config.env[p]?.mode === m
            ? " La colonne est vide : ce sont les clés des réglages du serveur qui servent dans ce mode."
            : " La colonne est vide."
          : ` ${effetDeLaColonne(apres.config, apres.cases, p, m)}`),
    });
  });

  /**
   * Le bouton « Vérifier » : ce que la colonne désigne est essayé chez le
   * prestataire, sans rien payer ni créer. Le verdict est rendu même quand
   * il est négatif (200) : c'est une réponse, pas une panne. Il dit toujours
   * d'où viennent les clés essayées.
   */
  app.post("/admin/paiements/verifier", async (c) => {
    if (!proprietaire(c)) return interdit(c);
    const b = await corps(c);
    const p = b.prestataire;
    const m = b.mode;
    if (!estPrestataire(p) || !estMode(m)) return c.json({ error: "Colonne inconnue." }, 400);
    const etat = await chargerEtat();
    const r = await verifierEtJournaliser(p, m, etat, auteur(c));
    if ("refus" in r) return c.json({ error: r.refus }, r.statut);
    return c.json({
      ok: r.ok,
      message: `${ORIGINE[r.source]} : ${r.message}`,
      compte: r.compte,
      le: r.le,
      source: r.source,
    });
  });

  /**
   * L'interrupteur : « essai », « reel », ou « env » (rendre la main au .env).
   * Passer en réel est verrouillé côté serveur : jeux live vérifiés et à
   * jour, secret du webhook Stripe live, et la case de confirmation cochée.
   * Rendre la main au .env ne met en service aucune colonne live d'ici qui
   * n'a pas été vérifiée (resoudreConfig).
   */
  app.post("/admin/paiements/mode", async (c) => {
    if (!proprietaire(c)) return interdit(c);
    const b = await corps(c);
    const mode = b.mode;
    if (mode !== "essai" && mode !== "reel" && mode !== "env")
      return c.json({ error: "Mode inconnu." }, 400);
    const etat = await chargerEtat();
    if (mode === "reel") {
      const verrou = bascule(etat);
      if (!verrou.possible)
        return c.json(
          { error: `Passage en réel refusé. ${verrou.raisons.join(" ")}`, raisons: verrou.raisons },
          409,
        );
      if (!confirme(b.confirme))
        return c.json(
          {
            error: "Cochez « Je confirme : les clientes paieront pour de vrai. » pour passer en réel.",
            code: "confirmation_requise",
          },
          409,
        );
    }
    const par = auteur(c);
    await db.insert(schema.journalPaiement).values({
      par,
      action: "mode",
      valeur: mode,
      detail: { avant: etat.config.choisi },
    });
    oublierConfigPaiement();
    const avant = etat.config.choisi;
    console.info(`[paiements] ${par ?? "?"} a réglé la boutique sur « ${mode} » (avant : ${avant})`);
    // La boutique est prévenue de chaque vrai changement, même quand ce
    // n'est pas elle qui l'a fait. Un clic qui ne change rien ne prévient pas.
    let avis = "";
    if (mode !== avant) {
      const destinataire = adresseDesAvis();
      if (!destinataire)
        avis = "\nAucun courriel envoyé : aucune adresse de la boutique n'est réglée sur le serveur.";
      else {
        const parti = await envoyerMail({
          ...courrierModePaiement({ mode, avant, par, le: new Date() }),
          to: destinataire,
        });
        avis = parti
          ? `\nUn courriel prévient la boutique (${destinataire}).`
          : "\nLe courriel à la boutique n'a pas pu partir (envoi d'e-mails non configuré ou en échec).";
      }
    }
    return c.json({
      ok: true,
      message:
        (mode === avant
          ? "Rien n'a changé : la boutique était déjà réglée ainsi."
          : mode === "reel"
            ? "✅ C'est fait : la boutique est maintenant POUR DE VRAI. Les cartes et PayPal sont réellement débités, les courriels partent chez les clientes, et les étiquettes SendCloud sont facturées."
            : mode === "essai"
              ? "🧪 C'est fait : la boutique est en MODE ESSAI. Aucun paiement réel n'est possible, les courriels restent dans la boîte d'essai et les étiquettes SendCloud sont gratuites."
              : "C'est fait : les réglages du serveur décident de nouveau du mode de chaque prestataire.") + avis,
    });
  });

  /**
   * Acheter les vraies étiquettes SendCloud (payantes), revenir aux
   * étiquettes d'essai gratuites, ou rendre la main aux réglages du serveur
   * (SENDCLOUD_ACHATS_REELS), comme avant l'écran. Tout ce qui allume les
   * étiquettes payantes demande la case de confirmation ; éteindre, jamais :
   * revenir à la gratuité ne coûte rien.
   */
  app.post("/admin/paiements/etiquettes", async (c) => {
    if (!proprietaire(c)) return interdit(c);
    const b = await corps(c);
    const choix: "oui" | "non" | "env" =
      b.reelles === true || b.reelles === "oui" ? "oui" : b.reelles === "env" ? "env" : "non";
    const serveur = etiquettesDuEnv(process.env);
    const etat = await chargerEtat();
    // L'interrupteur réglé, les étiquettes le suivent : pas de réglage à part.
    if (etat.config.choisi !== "env")
      return c.json(
        {
          error:
            "Les étiquettes suivent l'interrupteur « La boutique encaisse » : vraies étiquettes pour de vrai, étiquettes d'essai en essai.",
        },
        409,
      );
    // Rendre la main au serveur ALLUME les étiquettes payantes quand il les
    // demande et qu'elles sont éteintes ici : même confirmation que « oui ».
    const allume = choix === "oui" || (choix === "env" && serveur && !etat.config.etiquettesReelles);
    if (allume) {
      if (!colisConfigure())
        return c.json({ error: "SendCloud n'est pas branché sur ce serveur : il n'y a pas d'étiquettes à acheter." }, 409);
      if (!confirme(b.confirme))
        return c.json(
          {
            error:
              choix === "env"
                ? "Les réglages du serveur demandent les vraies étiquettes : cochez la case de confirmation, chaque bordereau acheté sera facturé par SendCloud."
                : "Cochez la case de confirmation : chaque bordereau acheté sera facturé par SendCloud.",
            code: "confirmation_requise",
          },
          409,
        );
    }
    const par = auteur(c);
    await db.insert(schema.journalPaiement).values({
      par,
      action: "etiquettes",
      valeur: choix,
    });
    oublierConfigPaiement();
    console.info(`[paiements] ${par ?? "?"} a réglé les étiquettes SendCloud sur « ${choix} »`);
    const reelles = choix === "env" ? serveur : choix === "oui";
    return c.json({
      ok: true,
      message:
        (choix === "env" ? "Les réglages du serveur décident de nouveau. " : "") +
        (reelles
          ? "Les bordereaux achetés depuis une fiche commande seront de vraies étiquettes, facturées par SendCloud."
          : "Les bordereaux sont des étiquettes d'essai, gratuites."),
    });
  });
}
