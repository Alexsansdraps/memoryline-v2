/**
 * Les essais des clés de paiement saisies au back-office (src/paiements-cles.ts)
 * et des appels qui les vérifient (src/payments.ts), sans base ni réseau : le
 * réseau est remplacé par un faux `fetch`, qui ne part nulle part.
 *
 * Lancés par : docker exec -w /app/apps/api memoryline-api npx tsx --test tests/paiements-cles.test.ts
 *
 * TOUTES LES VALEURS SONT FACTICES (« …FACTICE… ») : aucune vraie clé ici.
 *
 * Les cas qui comptent le plus :
 *  - sans rien au back-office, la configuration est EXACTEMENT celle que le
 *    .env donnait avant l'écran (mode mixte compris) : pas de régression au
 *    déploiement ;
 *  - en mode réel, une clé d'essai ne sert JAMAIS à un nouveau paiement ;
 *  - rien de secret ne sort vers le navigateur, ni dans un JSON écrit par
 *    mégarde.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { inspect } from "node:util";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Secret,
  casesVides,
  chiffrer,
  cibleDeVerification,
  configPublique,
  controlerForme,
  dechiffrer,
  deriverCles,
  effetDeLaColonne,
  empreinte,
  empreintesDuJeu,
  masquer,
  matiereDuServeur,
  payeeEnEssai,
  phraseEtat,
  preconditionsBascule,
  refusChiffrementLive,
  refusCroise,
  resoudreConfig,
  type CasesBO,
  type EnvPaiement,
  type LectureBO,
} from "../src/paiements-cles.ts";
import {
  avisAutreModeRecevable,
  avisIncoherent,
  verifierPaypal,
  verifierStripe,
  verifyStripeEvent,
} from "../src/payments.ts";

const CLES = deriverCles("FACTICE-app-secret-pour-les-essais", "APP_SECRET");
const AUTRES_CLES = deriverCles("FACTICE-un-autre-secret", "APP_SECRET");

const SK_TEST = "sk_test_FACTICE_essai_claude";
const PK_TEST = "pk_test_FACTICE_essai_claude";
const SK_LIVE = "sk_live_FACTICE_essai_claude";
const PK_LIVE = "pk_live_FACTICE_essai_claude";
const WHSEC = "whsec_FACTICE_essai_claude_0123456789";
const PP_ID = "FACTICEclientidEssaiClaude000000";
const PP_SECRET = "FACTICEsecretEssaiClaude0000000";

/** Une case du back-office lue et déchiffrée. */
const lue = (valeur: string): LectureBO => ({
  etat: "ok",
  valeur,
  fin: valeur.slice(-4),
  le: new Date("2026-10-20T12:00:00Z"),
  par: "essai@example.test",
});

/* -------------------------------------------------------------------------- */
/*  Chiffrement                                                               */
/* -------------------------------------------------------------------------- */

test("chiffrer puis déchiffrer rend la valeur, et le texte stocké ne la contient pas", () => {
  const stocke = chiffrer(CLES, "stripe", "test", "cle_secrete", SK_TEST);
  assert.ok(stocke.startsWith(`v1.${CLES.marque}.`));
  assert.ok(!stocke.includes("FACTICE"));
  assert.deepEqual(dechiffrer(CLES, "stripe", "test", "cle_secrete", stocke), { etat: "ok", valeur: SK_TEST });
});

test("deux chiffrements de la même valeur diffèrent (vecteur d'initialisation neuf)", () => {
  const a = chiffrer(CLES, "paypal", "live", "secret", PP_SECRET);
  const b = chiffrer(CLES, "paypal", "live", "secret", PP_SECRET);
  assert.notEqual(a, b);
});

test("une valeur recopiée dans une autre case ne se déchiffre pas (données associées)", () => {
  const stocke = chiffrer(CLES, "stripe", "test", "cle_secrete", SK_TEST);
  assert.deepEqual(dechiffrer(CLES, "stripe", "live", "cle_secrete", stocke), { etat: "abimee" });
  assert.deepEqual(dechiffrer(CLES, "stripe", "test", "secret_webhook", stocke), { etat: "abimee" });
});

test("une autre clé du serveur : « à ressaisir », sans lever d'erreur", () => {
  const stocke = chiffrer(CLES, "stripe", "test", "cle_secrete", SK_TEST);
  assert.deepEqual(dechiffrer(AUTRES_CLES, "stripe", "test", "cle_secrete", stocke), { etat: "cle_changee" });
  assert.deepEqual(dechiffrer(null, "stripe", "test", "cle_secrete", stocke), { etat: "cle_changee" });
});

test("un texte tronqué ou abîmé : « abîmée », sans lever d'erreur", () => {
  const stocke = chiffrer(CLES, "stripe", "test", "cle_secrete", SK_TEST);
  assert.deepEqual(dechiffrer(CLES, "stripe", "test", "cle_secrete", stocke.slice(0, -3)), { etat: "abimee" });
  assert.deepEqual(dechiffrer(CLES, "stripe", "test", "cle_secrete", "n'importe quoi"), { etat: "abimee" });
  const parts = stocke.split(".");
  parts[3] = Buffer.alloc(16).toString("base64url");
  assert.deepEqual(dechiffrer(CLES, "stripe", "test", "cle_secrete", parts.join(".")), { etat: "abimee" });
});

test("la matière : APP_SECRET, sinon l'adresse de la base, jamais une constante du code", () => {
  assert.equal(matiereDuServeur({ APP_SECRET: "a", DATABASE_URL: "b" })?.source, "APP_SECRET");
  assert.equal(matiereDuServeur({ DATABASE_URL: "b" })?.source, "DATABASE_URL");
  assert.equal(matiereDuServeur({}), null);
});

test("les clés live exigent une APP_SECRET longue : ni l'adresse de la base, ni une valeur courte", () => {
  // L'adresse par défaut de docker-compose.yml, écrite dans le dépôt : n'importe qui la connaît.
  const parAdresse = deriverCles("postgres://memoryline:memoryline@db:5432/memoryline", "DATABASE_URL");
  assert.match(refusChiffrementLive(parAdresse) ?? "", /APP_SECRET/);
  assert.match(refusChiffrementLive(deriverCles("FACTICE-courte", "APP_SECRET")) ?? "", /trop courte/);
  assert.match(refusChiffrementLive(null) ?? "", /APP_SECRET/);
  assert.equal(refusChiffrementLive(deriverCles("FACTICE".repeat(6), "APP_SECRET")), null);
  assert.equal(CLES.solide, true);
});

test("l'empreinte ne dépend pas du mode, mais de la clé du serveur", () => {
  assert.equal(empreinte(CLES, "paypal", "secret", PP_SECRET), empreinte(CLES, "paypal", "secret", PP_SECRET));
  assert.notEqual(empreinte(CLES, "paypal", "secret", PP_SECRET), empreinte(AUTRES_CLES, "paypal", "secret", PP_SECRET));
  assert.equal(empreinte(CLES, "paypal", "secret", PP_SECRET).length, 16);
});

test("un Secret ne se laisse écrire ni en JSON, ni en texte, ni dans la console", () => {
  const s = new Secret(SK_LIVE);
  assert.ok(!JSON.stringify({ s }).includes("FACTICE"));
  assert.ok(!String(s).includes("FACTICE"));
  assert.ok(!`${s}`.includes("FACTICE"));
  assert.ok(!inspect({ s }).includes("FACTICE"));
  assert.equal(s.devoiler(), SK_LIVE);
});

/* -------------------------------------------------------------------------- */
/*  Forme des valeurs                                                         */
/* -------------------------------------------------------------------------- */

test("les valeurs factices de bonne forme passent, espaces de bord retirés", () => {
  assert.deepEqual(controlerForme("stripe", "test", "cle_secrete", `  ${SK_TEST}\n`), { ok: true, valeur: SK_TEST });
  assert.equal(controlerForme("stripe", "test", "cle_publique", PK_TEST).ok, true);
  assert.equal(controlerForme("stripe", "live", "cle_publique", PK_LIVE).ok, true);
  assert.equal(controlerForme("stripe", "live", "cle_secrete", "rk_live_FACTICE_restreinte").ok, true);
  assert.equal(controlerForme("stripe", "live", "secret_webhook", WHSEC).ok, true);
  assert.equal(controlerForme("paypal", "test", "client_id", PP_ID).ok, true);
  assert.equal(controlerForme("paypal", "live", "secret", PP_SECRET).ok, true);
});

/** Le message d'un refus, en vérifiant qu'il ne recopie pas la valeur. */
function refusDe(...args: Parameters<typeof controlerForme>): string {
  const r = controlerForme(...args);
  assert.equal(r.ok, false, "la valeur aurait dû être refusée");
  const message = (r as { message: string }).message;
  assert.ok(!message.includes("FACTICE"), "le message ne doit jamais contenir la valeur");
  return message;
}

test("une clé live dans la colonne d'essai, ou l'inverse, est refusée avec la bonne colonne", () => {
  assert.match(refusDe("stripe", "test", "cle_publique", PK_LIVE), /LIVE.*Production/);
  assert.match(refusDe("stripe", "live", "cle_secrete", SK_TEST), /TEST.*Essai/);
  assert.match(refusDe("stripe", "live", "cle_publique", PK_TEST), /TEST/);
  assert.match(refusDe("stripe", "test", "cle_secrete", "rk_live_FACTICE_restreinte"), /LIVE/);
});

test("une clé dans la mauvaise case est refusée, et le message dit laquelle", () => {
  assert.match(refusDe("stripe", "test", "cle_publique", SK_TEST), /SECRÈTE/);
  assert.match(refusDe("stripe", "test", "cle_secrete", PK_TEST), /PUBLIQUE/);
  assert.match(refusDe("stripe", "test", "cle_secrete", WHSEC), /webhook/);
  assert.match(refusDe("stripe", "test", "secret_webhook", SK_TEST), /whsec_/);
  assert.match(refusDe("paypal", "test", "client_id", SK_TEST), /Stripe/);
});

test("vide, espace intérieur, accent, valeur trop courte ou trop longue : refusés", () => {
  assert.match(refusDe("stripe", "test", "cle_secrete", "   "), /vide/);
  assert.match(refusDe("stripe", "test", "cle_secrete", "sk_test_FACTICE essai"), /espace/);
  assert.match(refusDe("paypal", "test", "secret", "FACTICEsecretÉssaiClaude0000000"), /caractère/);
  assert.equal(controlerForme("stripe", "test", "cle_secrete", "sk_test_abc").ok, false);
  assert.equal(controlerForme("stripe", "test", "secret_webhook", "whsec_court").ok, false);
  assert.equal(controlerForme("paypal", "test", "client_id", "FACTICEcourt").ok, false);
  assert.match(refusDe("paypal", "test", "client_id", `FACTICE${"x".repeat(600)}`), /trop longue/);
});

test("contrôles croisés : la même valeur dans les deux colonnes, le secret PayPal égal au client-id", () => {
  const e = (v: string, champ: "client_id" | "secret") => empreinte(CLES, "paypal", champ, v);
  assert.match(
    refusCroise("paypal", "live", "client_id", e(PP_ID, "client_id"), [
      { mode: "test", champ: "client_id", empreinte: e(PP_ID, "client_id") },
    ]) ?? "",
    /colonne Essai/,
  );
  assert.match(
    refusCroise("paypal", "test", "secret", e(PP_ID, "client_id"), [
      { mode: "test", champ: "client_id", empreinte: e(PP_ID, "client_id") },
    ]) ?? "",
    /identique au client-id/,
  );
  assert.equal(
    refusCroise("paypal", "test", "secret", e(PP_SECRET, "secret"), [
      { mode: "test", champ: "client_id", empreinte: e(PP_ID, "client_id") },
    ]),
    null,
  );
});

/* -------------------------------------------------------------------------- */
/*  La configuration effective                                                */
/* -------------------------------------------------------------------------- */

/**
 * Ce que /payments/config rendait AVANT l'écran, recopié de l'ancien code :
 * c'est la référence de la non-régression.
 */
function ancienneConfigPublique(env: EnvPaiement) {
  const stripePublicKey = env.PUBLIC_STRIPE_KEY ?? "";
  const paypalClientId = env.PUBLIC_PAYPAL_CLIENT_ID ?? env.PAYPAL_CLIENT_ID ?? "";
  const stripeConfigured = Boolean(env.STRIPE_SECRET_KEY);
  const paypalConfigured = Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET);
  return {
    stripe: stripeConfigured && stripePublicKey ? { publicKey: stripePublicKey } : null,
    paypal: paypalConfigured && paypalClientId ? { clientId: paypalClientId } : null,
  };
}

const ENVS: Record<string, EnvPaiement> = {
  "tout en test": {
    STRIPE_SECRET_KEY: SK_TEST,
    PUBLIC_STRIPE_KEY: PK_TEST,
    STRIPE_WEBHOOK_SECRET: WHSEC,
    PAYPAL_CLIENT_ID: PP_ID,
    PAYPAL_SECRET: PP_SECRET,
    PAYPAL_ENV: "sandbox",
  },
  "tout en réel": {
    STRIPE_SECRET_KEY: SK_LIVE,
    PUBLIC_STRIPE_KEY: PK_LIVE,
    PAYPAL_CLIENT_ID: PP_ID,
    PAYPAL_SECRET: PP_SECRET,
    PUBLIC_PAYPAL_CLIENT_ID: PP_ID,
    PAYPAL_ENV: "live",
  },
  "mixte : Stripe live, PayPal sandbox": {
    STRIPE_SECRET_KEY: SK_LIVE,
    PUBLIC_STRIPE_KEY: PK_LIVE,
    PAYPAL_CLIENT_ID: PP_ID,
    PAYPAL_SECRET: PP_SECRET,
  },
  "Stripe sans clé publique": { STRIPE_SECRET_KEY: SK_TEST },
  "PayPal au client-id navigateur vide": {
    PAYPAL_CLIENT_ID: PP_ID,
    PAYPAL_SECRET: PP_SECRET,
    PUBLIC_PAYPAL_CLIENT_ID: "",
  },
  "rien du tout": {},
};

test("sans rien au back-office, la caisse reçoit exactement ce que le .env donnait", () => {
  for (const [nom, env] of Object.entries(ENVS)) {
    const cfg = resoudreConfig(env, casesVides(), "env", null);
    assert.deepEqual(configPublique(cfg), ancienneConfigPublique(env), nom);
  }
});

test("sans rien au back-office, le mode mixte du .env est conservé", () => {
  const cfg = resoudreConfig(ENVS["mixte : Stripe live, PayPal sandbox"]!, casesVides(), "env", null);
  assert.equal(cfg.stripe?.mode, "live");
  assert.equal(cfg.paypal?.mode, "test");
  assert.equal(phraseEtat(cfg, false).ton, "mixte");
  assert.match(phraseEtat(cfg, false).texte, /choisi par les réglages du serveur/);
});

test("en mode réel avec un .env d'essai, aucun moyen de paiement ne sert", () => {
  const cfg = resoudreConfig(ENVS["tout en test"]!, casesVides(), "reel", null);
  assert.equal(cfg.stripe, null);
  assert.equal(cfg.paypal, null);
  assert.deepEqual(configPublique(cfg), { stripe: null, paypal: null });
  // Les clés d'essai restent connues pour les paiements déjà ouverts.
  assert.equal(cfg.jeux.stripe.test?.source, "env");
});

test("en mode essai avec un .env réel, rien ne sert non plus : pas de paiement réel en essai", () => {
  const cfg = resoudreConfig(ENVS["tout en réel"]!, casesVides(), "essai", null);
  assert.equal(cfg.stripe, null);
  assert.equal(cfg.paypal, null);
});

/** Des cases du back-office remplies d'un coup. */
function cases(remplir: (c: CasesBO) => void): CasesBO {
  const c = casesVides();
  remplir(c);
  return c;
}

test("le back-office passe devant le .env quand sa colonne est complète", () => {
  const PK_BO = "pk_test_FACTICE_saisie_au_bo";
  const bo = cases((c) => {
    c.stripe.test.cle_publique = lue(PK_BO);
    c.stripe.test.cle_secrete = lue("sk_test_FACTICE_saisie_au_bo");
  });
  const cfg = resoudreConfig(ENVS["tout en test"]!, bo, "env", null);
  assert.equal(cfg.stripe?.source, "bo");
  assert.deepEqual(configPublique(cfg).stripe, { publicKey: PK_BO });
  // PayPal, rien saisi : le .env continue de servir.
  assert.equal(cfg.paypal?.source, "env");
});

test("une colonne incomplète ou illisible laisse le .env servir", () => {
  const incomplete = cases((c) => {
    c.stripe.test.cle_secrete = lue(SK_TEST);
  });
  assert.equal(resoudreConfig(ENVS["tout en test"]!, incomplete, "env", null).stripe?.source, "env");
  const illisible = cases((c) => {
    c.stripe.test.cle_publique = lue(PK_TEST);
    c.stripe.test.cle_secrete = { etat: "cle_changee", fin: "aude", le: new Date(), par: null };
  });
  assert.equal(resoudreConfig(ENVS["tout en test"]!, illisible, "env", null).stripe?.source, "env");
});

test("passer en réel avec des clés live saisies : elles servent, et seules les publiques partent", () => {
  const bo = cases((c) => {
    c.stripe.live.cle_publique = lue(PK_LIVE);
    c.stripe.live.cle_secrete = lue(SK_LIVE);
    c.stripe.live.secret_webhook = lue(WHSEC);
    c.paypal.live.client_id = lue(PP_ID);
    c.paypal.live.secret = lue(PP_SECRET);
  });
  const cfg = resoudreConfig(ENVS["tout en test"]!, bo, "reel", null);
  assert.equal(cfg.stripe?.mode, "live");
  assert.equal(cfg.paypal?.mode, "live");
  const publique = JSON.stringify(configPublique(cfg));
  assert.ok(publique.includes(PK_LIVE));
  assert.ok(publique.includes(PP_ID));
  for (const secret of [SK_LIVE, SK_TEST, WHSEC, PP_SECRET]) {
    assert.ok(!publique.includes(secret), "aucun secret dans /payments/config");
    assert.ok(!JSON.stringify(cfg).includes(secret), "aucun secret dans un JSON de la configuration");
  }
  // Depuis le 9/11, les étiquettes suivent l'interrupteur : pour de vrai, elles sont payantes.
  assert.equal(phraseEtat(cfg, true).texte, "Production : Stripe live, PayPal live, étiquettes payantes.");
});

test("les secrets de webhook : tous connus, celui du mode actif d'abord", () => {
  const bo = cases((c) => {
    c.stripe.live.secret_webhook = lue("whsec_FACTICE_live_0123456789abcdef");
  });
  const enEssai = resoudreConfig(ENVS["tout en test"]!, bo, "env", null);
  assert.deepEqual(enEssai.secretsWebhook.map((s) => s.mode), ["test", "live"]);
  const enReel = resoudreConfig(ENVS["tout en test"]!, bo, "reel", null);
  assert.deepEqual(enReel.secretsWebhook.map((s) => s.mode), ["live", "test"]);
});

test("les étiquettes : l'écran d'abord, sinon SENDCLOUD_ACHATS_REELS", () => {
  assert.equal(resoudreConfig({ SENDCLOUD_ACHATS_REELS: "oui" }, casesVides(), "env", null).etiquettesReelles, true);
  assert.equal(resoudreConfig({ SENDCLOUD_ACHATS_REELS: "oui" }, casesVides(), "env", false).etiquettesReelles, false);
  assert.equal(resoudreConfig({}, casesVides(), "env", true).etiquettesSource, "bo");
  assert.equal(resoudreConfig({}, casesVides(), "env", null).etiquettesReelles, false);
});

test("la phrase de tête dit le mode, chaque prestataire et les étiquettes", () => {
  const cfg = resoudreConfig(ENVS["tout en test"]!, casesVides(), "env", null);
  assert.equal(phraseEtat(cfg, true).texte, "Mode essai : Stripe test, PayPal sandbox, étiquettes non payées.");
  const sansPaypal = resoudreConfig({ STRIPE_SECRET_KEY: SK_LIVE, PUBLIC_STRIPE_KEY: PK_LIVE }, casesVides(), "reel", true);
  assert.equal(phraseEtat(sansPaypal, true).texte, "Production : Stripe live, PayPal non branché, étiquettes payantes.");
  assert.equal(phraseEtat(resoudreConfig({}, casesVides(), "env", null), false).ton, "aucun");
});

/* -------------------------------------------------------------------------- */
/*  Le verrou de la bascule                                                   */
/* -------------------------------------------------------------------------- */

test("passer en réel : refusé sans clé live, sans vérification, après une modification, sans webhook", () => {
  const bo = cases((c) => {
    c.stripe.live.cle_publique = lue(PK_LIVE);
    c.stripe.live.cle_secrete = lue(SK_LIVE);
    c.stripe.live.secret_webhook = lue(WHSEC);
  });
  const cfg = resoudreConfig({}, bo, "env", null);
  // Le jeu qui servirait en réel : c'est lui que le verrou examine.
  const jeu = cfg.candidats.stripe.live!;
  const actuelles = empreintesDuJeu(CLES, jeu);
  const rien = { jeu: null, verification: null, empreintesActuelles: null };

  assert.equal(preconditionsBascule({ stripe: rien, paypal: rien }).possible, false);

  const nonVerifiee = preconditionsBascule({ stripe: { jeu, verification: null, empreintesActuelles: actuelles }, paypal: rien });
  assert.equal(nonVerifiee.possible, false);
  assert.match(nonVerifiee.raisons.join(" "), /jamais vérifiées/);

  const echouee = preconditionsBascule({
    stripe: { jeu, verification: { ok: false, empreintes: actuelles }, empreintesActuelles: actuelles },
    paypal: rien,
  });
  assert.match(echouee.raisons.join(" "), /a échoué/);

  const autreCle = { ...actuelles!, cle_secrete: "0000000000000000" };
  const modifiee = preconditionsBascule({
    stripe: { jeu, verification: { ok: true, empreintes: autreCle }, empreintesActuelles: actuelles },
    paypal: rien,
  });
  assert.match(modifiee.raisons.join(" "), /modifiées depuis/);

  const sansWebhook = { ...jeu, secretWebhook: null };
  const e2 = empreintesDuJeu(CLES, sansWebhook);
  assert.match(
    preconditionsBascule({ stripe: { jeu: sansWebhook, verification: { ok: true, empreintes: e2 }, empreintesActuelles: e2 }, paypal: rien })
      .raisons.join(" "),
    /webhook/,
  );

  const bon = preconditionsBascule({
    stripe: { jeu, verification: { ok: true, empreintes: actuelles }, empreintesActuelles: actuelles },
    paypal: rien,
  });
  assert.deepEqual(bon, { possible: true, raisons: [] });
});

/** Les colonnes live des deux prestataires, complètes au back-office. */
const LIVE_COMPLETES = () =>
  cases((c) => {
    c.stripe.live.cle_publique = lue(PK_LIVE);
    c.stripe.live.cle_secrete = lue(SK_LIVE);
    c.stripe.live.secret_webhook = lue(WHSEC);
    c.paypal.live.client_id = lue(PP_ID);
    c.paypal.live.secret = lue(PP_SECRET);
  });

test("le .env décide : une colonne live d'ici jamais vérifiée ne sert pas, même avec PAYPAL_ENV=live", () => {
  // PAYPAL_ENV=live, sans identifiants PayPal dans le .env : avant, la colonne
  // live saisie ici servait aussitôt à la caisse, sans vérification.
  const env: EnvPaiement = { ...ENVS["tout en réel"]!, PAYPAL_CLIENT_ID: undefined, PAYPAL_SECRET: undefined };
  const attente = resoudreConfig(env, LIVE_COMPLETES(), "env", null);
  assert.equal(attente.paypal, null, "PayPal live non vérifié : absent de la caisse");
  assert.equal(attente.liveEnAttente.paypal, true);
  assert.equal(attente.stripe?.source, "env", "Stripe : le jeu live du .env garde la main");
  assert.equal(attente.liveEnAttente.stripe, true);
  // Le verrou de la bascule, lui, examine bien la colonne d'ici.
  assert.equal(attente.candidats.paypal.live?.source, "bo");

  const verifiees = resoudreConfig(env, LIVE_COMPLETES(), "env", null, { stripe: true, paypal: true });
  assert.equal(verifiees.paypal?.source, "bo");
  assert.equal(verifiees.stripe?.source, "bo");
  assert.deepEqual(verifiees.liveEnAttente, { stripe: false, paypal: false });

  // Un .env d'essai : la colonne live ne servirait pas de toute façon, rien n'attend.
  const enEssai = resoudreConfig(ENVS["tout en test"]!, LIVE_COMPLETES(), "env", null);
  assert.deepEqual(enEssai.liveEnAttente, { stripe: false, paypal: false });
  assert.equal(enEssai.stripe?.mode, "test");
});

test("« Payée en ESSAI » : un paiement de test abouti, quand son prestataire encaisse pour de vrai", () => {
  const reel = resoudreConfig(ENVS["tout en test"]!, LIVE_COMPLETES(), "reel", null);
  const essai = resoudreConfig(ENVS["tout en test"]!, casesVides(), "env", null);
  const test_ = { provider: "stripe", status: "succeeded", mode: "test" };
  assert.equal(payeeEnEssai([test_], reel), "stripe");
  // Une ligne d'avant l'écran (sans mode) a été ouverte avec le .env, ici d'essai.
  assert.equal(payeeEnEssai([{ provider: "paypal", status: "succeeded", mode: null }], reel), "paypal");
  assert.equal(payeeEnEssai([{ ...test_, mode: "live" }], reel), null);
  assert.equal(payeeEnEssai([{ ...test_, status: "pending" }], reel), null, "seul un paiement abouti compte");
  assert.equal(payeeEnEssai([{ ...test_, provider: "manuel" }], reel), null, "un virement n'a pas de mode");
  // Tant que la boutique est en essai, rien n'est signalé : toutes le sont.
  assert.equal(payeeEnEssai([test_], essai), null);
});

test("en réel, la colonne live d'ici sert (la vérification se fait avant chaque remplacement)", () => {
  const cfg = resoudreConfig(ENVS["tout en test"]!, LIVE_COMPLETES(), "reel", null);
  assert.equal(cfg.stripe?.source, "bo");
  assert.equal(cfg.paypal?.source, "bo");
});

test("« Vérifier » : la colonne complète d'ici, sinon le .env si rien n'est saisi, jamais un mélange", () => {
  const env = ENVS["tout en test"]!;
  // Seule la clé secrète saisie ici : rien à vérifier, il manque la publique.
  const entamee = cases((c) => {
    c.stripe.test.cle_secrete = lue("sk_test_FACTICE_saisie_au_bo");
  });
  const cfgEntamee = resoudreConfig(env, entamee, "env", null);
  assert.deepEqual(cibleDeVerification(cfgEntamee, entamee, "stripe", "test"), { jeu: null, manque: ["cle_publique"] });
  assert.match(effetDeLaColonne(cfgEntamee, entamee, "stripe", "test"), /il manque la clé publique.*réglages du serveur/);
  // Rien d'obligatoire saisi ici : le .env, nommé comme tel.
  const rien = resoudreConfig(env, casesVides(), "env", null);
  assert.equal(cibleDeVerification(rien, casesVides(), "stripe", "test")?.jeu?.source, "env");
  assert.equal((cibleDeVerification(rien, casesVides(), "stripe", "test") as { source: string }).source, "env");
  // Rien nulle part : rien à vérifier.
  assert.equal(cibleDeVerification(rien, casesVides(), "stripe", "live"), null);
  // Colonne complète : celle d'ici, et la colonne dit qu'elle sert.
  const complete = cases((c) => {
    c.stripe.test.cle_publique = lue("pk_test_FACTICE_saisie_au_bo");
    c.stripe.test.cle_secrete = lue("sk_test_FACTICE_saisie_au_bo");
  });
  const cfgComplete = resoudreConfig(env, complete, "env", null);
  assert.equal(cibleDeVerification(cfgComplete, complete, "stripe", "test")?.jeu?.source, "bo");
  assert.match(effetDeLaColonne(cfgComplete, complete, "stripe", "test"), /encaisse dès maintenant/);
  // Une colonne live complète en attente le dit.
  const envLive: EnvPaiement = { PAYPAL_ENV: "live" };
  const cfgAttente = resoudreConfig(envLive, LIVE_COMPLETES(), "env", null);
  assert.match(effetDeLaColonne(cfgAttente, LIVE_COMPLETES(), "paypal", "live"), /vérification aura réussi/);
});

/* -------------------------------------------------------------------------- */
/*  Le webhook Stripe                                                         */
/* -------------------------------------------------------------------------- */

function signer(secret: string, corps: string, t: number): string {
  return createHmac("sha256", secret).update(`${t}.${corps}`).digest("hex");
}

test("webhook : plusieurs secrets, plusieurs signatures, mauvais secret, avis trop vieux", () => {
  const maintenant = Date.UTC(2026, 9, 20, 12, 0, 0);
  const t = Math.floor(maintenant / 1000);
  const corps = JSON.stringify({ type: "charge.updated", livemode: true, data: { object: {} } });
  const autre = "whsec_FACTICE_autre_secret_9876543210";

  const live = (s: string) => ({ mode: "live" as const, secret: new Secret(s) });
  const test_ = (s: string) => ({ mode: "test" as const, secret: new Secret(s) });

  const bon = verifyStripeEvent(corps, `t=${t},v1=${signer(WHSEC, corps, t)}`, [test_(autre), live(WHSEC)], maintenant);
  assert.equal(bon?.livemode, true);
  assert.equal(bon?.modeSecret, "live", "le mode est celui du secret qui a signé");
  assert.equal(bon?.event.type, "charge.updated");

  // Pendant un renouvellement, deux v1 : la bonne n'est pas forcément la dernière.
  const deux = `t=${t},v1=${signer(WHSEC, corps, t)},v1=${signer("whsec_FACTICE_ancien_secret_1234", corps, t)}`;
  assert.ok(verifyStripeEvent(corps, deux, [live(WHSEC)], maintenant));

  assert.equal(verifyStripeEvent(corps, `t=${t},v1=${signer(autre, corps, t)}`, [live(WHSEC)], maintenant), null);
  assert.equal(verifyStripeEvent(corps, `t=${t - 600},v1=${signer(WHSEC, corps, t - 600)}`, [live(WHSEC)], maintenant), null);
  assert.equal(verifyStripeEvent(corps, `t=${t},v1=${signer(WHSEC, corps, t)}`, [], maintenant), null);
  assert.equal(verifyStripeEvent(corps, undefined, [live(WHSEC)], maintenant), null);
  const essai = JSON.stringify({ type: "x", data: { object: {} } });
  assert.equal(verifyStripeEvent(essai, `t=${t},v1=${signer(WHSEC, essai, t)}`, [test_(WHSEC)], maintenant)?.livemode, false);

  // Le même secret dans les deux modes : le moins sûr, « test ».
  assert.equal(verifyStripeEvent(corps, `t=${t},v1=${signer(WHSEC, corps, t)}`, [live(WHSEC), test_(WHSEC)], maintenant)?.modeSecret, "test");
});

test("webhook : le secret de TEST ne fait jamais passer un avis « live » quand la boutique est en réel", () => {
  const maintenant = Date.now();
  const t = Math.floor(maintenant / 1000);
  const WHSEC_TEST = "whsec_FACTICE_colonne_essai_0123456789";
  const WHSEC_LIVE = "whsec_FACTICE_colonne_live_9876543210";
  const bo = cases((c) => {
    c.stripe.test.secret_webhook = lue(WHSEC_TEST);
    c.stripe.live.secret_webhook = lue(WHSEC_LIVE);
  });
  // En réel, le secret d'essai reste accepté (paiements ouverts avant la bascule)…
  const cfg = resoudreConfig({ ...ENVS["tout en test"]!, STRIPE_WEBHOOK_SECRET: undefined }, bo, "reel", null);
  assert.deepEqual(cfg.secretsWebhook.map((s) => s.mode), ["live", "test"]);

  // … mais un avis qu'il signe en se disant « live » est un faux : il ne passe pas.
  const forge = JSON.stringify({
    type: "payment_intent.succeeded",
    livemode: true,
    data: { object: { id: "pi_FACTICE_forge", amount_received: 4200, currency: "eur", metadata: { orderId: "42" } } },
  });
  const v = verifyStripeEvent(forge, `t=${t},v1=${signer(WHSEC_TEST, forge, t)}`, cfg.secretsWebhook, maintenant);
  assert.ok(v, "la signature est bien reconnue…");
  assert.equal(v!.modeSecret, "test");
  assert.equal(avisIncoherent(v!), true, "… et l'avis, incohérent, n'est pas traité");

  // Le même avis signé avec le secret live est cohérent.
  const vrai = verifyStripeEvent(forge, `t=${t},v1=${signer(WHSEC_LIVE, forge, t)}`, cfg.secretsWebhook, maintenant);
  assert.equal(vrai?.modeSecret, "live");
  assert.equal(avisIncoherent(vrai!), false);

  // Un avis de test honnête (livemode:false) est cohérent, mais n'est traité
  // en réel que pour un paiement d'essai que nous avons ouvert, pour CETTE commande.
  assert.equal(avisIncoherent({ modeSecret: "test", livemode: false }), false);
  assert.equal(avisAutreModeRecevable("test", { mode: "test", orderId: 42 }, 42), true);
  assert.equal(avisAutreModeRecevable("test", { mode: "test", orderId: 7 }, 42), false, "référence d'une autre commande");
  assert.equal(avisAutreModeRecevable("test", { mode: "live", orderId: 42 }, 42), false);
  assert.equal(avisAutreModeRecevable("test", null, 42), false, "référence inconnue");
});

/* -------------------------------------------------------------------------- */
/*  Le bouton « Vérifier », avec un faux réseau                               */
/* -------------------------------------------------------------------------- */

/** Un faux `fetch` : chaque adresse a sa réponse, et l'on compte les appels. */
function fauxReseau(reponses: Record<string, { statut: number; corps: unknown }>) {
  const appels: string[] = [];
  const f = (async (url: string | URL | Request) => {
    const u = String(url);
    appels.push(u);
    const cle = Object.keys(reponses).find((k) => u.includes(k));
    const r = cle ? reponses[cle]! : { statut: 404, corps: {} };
    return new Response(JSON.stringify(r.corps), { status: r.statut });
  }) as typeof fetch;
  return { f, appels };
}

const ADRESSE = "https://boutique.example.test/api/payments/stripe/webhook";
const jeuStripeLive = {
  mode: "live" as const,
  clePublique: "pk_live_51FACTICEcompte12345678abc",
  cleSecrete: new Secret(SK_LIVE),
  secretWebhook: new Secret(WHSEC),
};

test("Vérifier Stripe : une clé refusée s'arrête au premier appel, et le message ne la contient pas", async () => {
  const { f, appels } = fauxReseau({ "/v1/balance": { statut: 401, corps: { error: { message: "Invalid API Key provided: sk_live_****aude" } } } });
  const v = await verifierStripe(jeuStripeLive, { adresseWebhook: ADRESSE, local: false, fetch: f });
  assert.equal(v.ok, false);
  assert.match(v.message, /refusée par Stripe \(401/);
  assert.equal(appels.length, 1);
  assert.ok(!JSON.stringify(v).includes("FACTICE"));
});

test("Vérifier Stripe : une clé de test dans la colonne live est refusée", async () => {
  const { f } = fauxReseau({ "/v1/balance": { statut: 200, corps: { livemode: false } } });
  const v = await verifierStripe(jeuStripeLive, { adresseWebhook: ADRESSE, local: false, fetch: f });
  assert.equal(v.ok, false);
  assert.match(v.message, /clé de TEST/);
});

test("Vérifier Stripe : compte lu, même compte, webhook trouvé → valide", async () => {
  const { f } = fauxReseau({
    "/v1/balance": { statut: 200, corps: { livemode: true } },
    "/v1/account": {
      statut: 200,
      corps: { id: "acct_1FACTICEcompte", charges_enabled: true, business_profile: { name: "Boutique d'essai" } },
    },
    "/v1/webhook_endpoints": {
      statut: 200,
      corps: { data: [{ url: "https://www.boutique.example.test/api/payments/stripe/webhook/", status: "enabled", enabled_events: ["payment_intent.succeeded"] }] },
    },
  });
  const v = await verifierStripe(jeuStripeLive, { adresseWebhook: ADRESSE, local: false, fetch: f });
  assert.equal(v.ok, true, v.message);
  assert.match(v.message, /Boutique d'essai/);
  assert.match(v.message, /même compte/);
  assert.match(v.message, /Webhook trouvé/);
});

test("Vérifier Stripe : sans webhook vers notre adresse, la colonne live n'est pas validée", async () => {
  const { f } = fauxReseau({
    "/v1/balance": { statut: 200, corps: { livemode: true } },
    "/v1/account": { statut: 200, corps: { id: "acct_1FACTICEcompte", charges_enabled: true } },
    "/v1/webhook_endpoints": { statut: 200, corps: { data: [{ url: "https://ailleurs.example.test/hook", status: "enabled", enabled_events: ["*"] }] } },
  });
  const v = await verifierStripe(jeuStripeLive, { adresseWebhook: ADRESSE, local: false, fetch: f });
  assert.equal(v.ok, false);
  assert.match(v.message, /Aucun webhook/);
});

test("Vérifier Stripe : une clé restreinte sans certains droits se dégrade sans être déclarée bonne à tort", async () => {
  const { f } = fauxReseau({
    "/v1/balance": { statut: 403, corps: {} },
    "/v1/account": { statut: 403, corps: {} },
    "/v1/webhook_endpoints": { statut: 403, corps: {} },
  });
  const v = await verifierStripe(
    { ...jeuStripeLive, cleSecrete: new Secret("rk_live_FACTICE_restreinte") },
    { adresseWebhook: ADRESSE, local: false, fetch: f },
  );
  assert.equal(v.ok, true);
  assert.match(v.message, /restreinte/);
  const refusee = await verifierStripe(jeuStripeLive, {
    adresseWebhook: ADRESSE,
    local: false,
    fetch: fauxReseau({ "/v1/balance": { statut: 401, corps: {} } }).f,
  });
  assert.equal(refusee.ok, false);
});

test("Vérifier PayPal : reconnus, ou reconnus de l'AUTRE côté, ou refusés partout", async () => {
  const jeu = { mode: "live" as const, clientId: PP_ID, clientIdNavigateur: PP_ID, secret: new Secret(PP_SECRET) };
  const ok = await verifierPaypal(jeu, {
    fetch: fauxReseau({ "api-m.paypal.com/v1/oauth2/token": { statut: 200, corps: { access_token: "FACTICEjetonQuiNeDoitPasSortir000", app_id: "APP-FACTICE123" } } }).f,
  });
  assert.equal(ok.ok, true);
  assert.match(ok.message, /compte réel/);
  assert.ok(!JSON.stringify(ok).includes("jeton"), "le jeton obtenu n'est jamais renvoyé");

  const deLautreCote = await verifierPaypal(jeu, {
    fetch: fauxReseau({
      "api-m.paypal.com/v1/oauth2/token": { statut: 401, corps: {} },
      "api-m.sandbox.paypal.com/v1/oauth2/token": { statut: 200, corps: { access_token: "x" } },
    }).f,
  });
  assert.equal(deLautreCote.ok, false);
  assert.match(deLautreCote.message, /bac à sable.*Essai/);

  const nulle = await verifierPaypal(jeu, { fetch: fauxReseau({ "oauth2/token": { statut: 401, corps: {} } }).f });
  assert.equal(nulle.ok, false);
  assert.match(nulle.message, /ni d'un côté ni de l'autre/);

  const envDifferent = await verifierPaypal(
    { ...jeu, clientIdNavigateur: "FACTICEautreClientIdNavigateur00" },
    { fetch: fauxReseau({ "oauth2/token": { statut: 200, corps: {} } }).f },
  );
  assert.equal(envDifferent.ok, false);
  assert.match(envDifferent.message, /PUBLIC_PAYPAL_CLIENT_ID/);
});

test("masquer : une longue suite de caractères devient « … », et le tout tient en 300", () => {
  assert.equal(masquer("clé sk_live_51ABCDEFGHIJKLMNOPQRSTUVWXYZ refusée"), "clé sk_live_… refusée");
  assert.equal(masquer("x ".repeat(400)).length, 300);
  assert.equal(masquer("application APP-80W284485P519543T"), "application APP-80W284485P519543T");
});

/* -------------------------------------------------------------------------- */
/*  Aucune route générique ne lit les clés                                    */
/* -------------------------------------------------------------------------- */

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Le corps d'une route, de sa déclaration à la suivante. */
function corpsDeRoute(source: string, declaration: string): string {
  const debut = source.indexOf(declaration);
  assert.ok(debut >= 0, `route introuvable : ${declaration}`);
  const suite = source.slice(debut + declaration.length).search(/\napp\.(get|post|put|delete)\(|\n {2}app\.(get|post|put|delete)\(/);
  return source.slice(debut, suite < 0 ? undefined : debut + declaration.length + suite);
}

test("seul paiements-reglages.ts lit les tables des clés : aucune autre route ne peut les rendre", () => {
  const lecteurs = readdirSync(SRC)
    .filter((f) => f.endsWith(".ts"))
    .filter((f) => /schema\.(clesPaiement|journalPaiement)\b|\b(cle_paiement|journal_paiement)\b/.test(readFileSync(join(SRC, f), "utf8")));
  assert.deepEqual(lecteurs, ["paiements-reglages.ts"]);
});

test("la route publique des réglages ne lit que la table « setting »", () => {
  const route = corpsDeRoute(readFileSync(join(SRC, "index.ts"), "utf8"), 'app.get("/settings"');
  assert.match(route, /schema\.settings/);
  assert.doesNotMatch(route, /clesPaiement|journalPaiement|paiement|STRIPE|PAYPAL/i);
});

test("GET /payments/config ne renvoie que les clés publiques (configPublique) et le drapeau d'essai", () => {
  const route = corpsDeRoute(readFileSync(join(SRC, "configurator-routes.ts"), "utf8"), 'app.get("/payments/config"');
  assert.match(route, /configPublique\(config\)/);
  assert.match(route, /c\.json\(\{ stripe, paypal, essai \}\)/);
  assert.doesNotMatch(route, /devoiler|cleSecrete|secretWebhook|process\.env/);
});

test("le webhook prend le mode de l'avis dans son secret, et juge la cohérence AVANT de marquer la commande payée", () => {
  const route = corpsDeRoute(readFileSync(join(SRC, "configurator-routes.ts"), "utf8"), 'app.post("/payments/stripe/webhook"');
  assert.match(route, /const modeAvis: Mode = modeSecret;/);
  assert.doesNotMatch(route, /modeAvis: Mode = livemode/);
  const incoherent = route.indexOf("avisIncoherent(");
  const recevable = route.indexOf("avisAutreModeRecevable(");
  const payee = route.indexOf("markOrderPaid(");
  assert.ok(incoherent > 0 && recevable > incoherent && payee > recevable);
});
