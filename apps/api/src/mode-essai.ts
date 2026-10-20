/**
 * La boutique tourne-t-elle en mode ESSAI ? Et pour quoi : les paiements, les
 * courriers, les bordereaux.
 *
 * La question se posait à trois endroits, chacun avec sa réponse. La caisse
 * jugeait « essai » dès que PayPal n'était pas réglé sur « live » — y compris
 * quand PayPal n'était pas branché du tout. Le jour de l'ouverture, avec une
 * vraie clé Stripe et sans PayPal, elle aurait donc continué d'afficher
 * l'encadré des cartes d'essai à de vraies clientes. Le back-office, lui, ne
 * savait rien : son aide expliquait comment passer une commande test sur la
 * vraie boutique.
 *
 * Une seule réponse, ici, lue dans la configuration EFFECTIVE du serveur —
 * les clés saisies dans BO › Réglages › Paiements, sinon le .env (voir
 * paiements-reglages.ts) :
 *   - paiement : un moyen BRANCHÉ en mode test. Stripe avec une clé publique
 *     « pk_test… », ou PayPal configuré hors « live ». Un moyen absent ne
 *     compte pas : il n'encaisse rien, ni pour de faux ni pour de vrai ;
 *   - courriers : la boîte d'essai (Mailpit) attrape tout (mail.ts) ;
 *   - colis : SendCloud branché, achats réels non allumés (l'interrupteur des
 *     étiquettes de l'écran Paiements, sinon SENDCLOUD_ACHATS_REELS).
 * `essai` résume : paiements ou courriers pour de faux, c'est un site de test.
 * Les colis n'y entrent pas : SendCloud reste en essai tant qu'on n'a pas
 * décidé d'acheter de vraies étiquettes, même sur la vraie boutique.
 *
 * L'état suit l'interrupteur SANS redémarrage : il se relit à chaque appel
 * (la configuration de paiement a son propre petit cache, vidé à chaque
 * modification de l'écran).
 */
import type { Hono } from "hono";
import { estEnEssai } from "./mail.js";
import { configPaiement } from "./paiements-reglages.js";
import { phraseEtat, type ConfigEffective } from "./paiements-cles.js";
import { colisConfigure } from "./sendcloud-colis.js";

export interface EtatEssai {
  /** Un moyen de paiement branché encaisse pour de faux. */
  paiement: boolean;
  /** Les courriers partent dans la boîte d'essai, pas chez les clients. */
  courriers: boolean;
  /** SendCloud est branché et fabrique des étiquettes d'essai, gratuites. */
  colis: boolean;
  /** Paiements ou courriers pour de faux : c'est un site de test. */
  essai: boolean;
}

/** Ce que la configuration dit, réduit à ce dont la décision a besoin. */
export interface ReglagesEssai {
  /** La clé publique Stripe (PUBLIC_STRIPE_KEY), vide si absente. */
  stripePublicKey: string;
  /** PAYPAL_ENV, tel qu'écrit. */
  paypalEnv: string;
}

/** Ce qui est réellement branché, et ce que les autres modules en disent. */
export interface BranchementsEssai {
  stripe: boolean;
  paypal: boolean;
  courriersEnEssai: boolean;
  colisEnEssai: boolean;
}

/**
 * La décision, sans rien lire d'autre que ses arguments : c'est elle que les
 * essais vérifient (tests/mode-essai.test.ts).
 */
export function etatEssaiDepuis(
  reglages: ReglagesEssai,
  branchements: BranchementsEssai,
): EtatEssai {
  const cle = reglages.stripePublicKey.trim();
  const stripeEnTest = branchements.stripe && cle.length > 0 && cle.startsWith("pk_test");
  const paypalEnTest =
    branchements.paypal && reglages.paypalEnv.trim().toLowerCase() !== "live";
  const paiement = stripeEnTest || paypalEnTest;
  const courriers = branchements.courriersEnEssai;
  return {
    paiement,
    courriers,
    colis: branchements.colisEnEssai,
    essai: paiement || courriers,
  };
}

/**
 * L'état de CE serveur, sur la configuration de paiement effective (lue si
 * elle n'est pas fournie). `resume` est la phrase de tête de l'écran
 * Paiements, que l'accueil du back-office reprend.
 */
export async function etatEssai(
  fournie?: ConfigEffective,
): Promise<EtatEssai & { resume: string }> {
  const config = fournie ?? (await configPaiement());
  const colis = colisConfigure();
  const etat = etatEssaiDepuis(
    {
      // Les clés du jeu ACTIF, celui que la caisse utilise : sans rien au
      // back-office, ce sont exactement celles du .env, comme avant.
      stripePublicKey: config.stripe?.clePublique ?? "",
      paypalEnv: config.paypal?.mode === "live" ? "live" : "sandbox",
    },
    {
      // « Branché » au sens de la caisse (/payments/config) : les clés du
      // serveur ET celle du navigateur. Un moyen à moitié réglé n'est pas
      // proposé à la cliente, il ne peut donc pas la tromper.
      stripe: Boolean(config.stripe),
      paypal: Boolean(config.paypal && config.paypal.clientIdNavigateur.length > 0),
      courriersEnEssai: estEnEssai(),
      colisEnEssai: colis && !config.etiquettesReelles,
    },
  );
  return { ...etat, resume: phraseEtat(config, colis).texte };
}

/**
 * GET /admin/mode-essai → EtatEssai, avec la phrase d'état (`resume`).
 *
 * Sous /admin/* : réservée à la propriétaire par la garde du back-office. Le
 * back-office s'en sert pour n'afficher l'aide des essais, et la marche à
 * suivre pour en sortir, que sur un site d'essai.
 */
export function mountModeEssai(app: Hono): void {
  app.get("/admin/mode-essai", async (c) => c.json(await etatEssai()));
}
