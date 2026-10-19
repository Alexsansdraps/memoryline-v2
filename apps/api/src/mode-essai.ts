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
 * Une seule réponse, ici, lue dans la configuration du serveur (jamais dans
 * un fichier) :
 *   - paiement : un moyen BRANCHÉ en mode test. Stripe avec une clé publique
 *     « pk_test… », ou PayPal configuré hors « live ». Un moyen absent ne
 *     compte pas : il n'encaisse rien, ni pour de faux ni pour de vrai ;
 *   - courriers : la boîte d'essai (Mailpit) attrape tout (mail.ts) ;
 *   - colis : SendCloud branché, achats réels non allumés (sendcloud-colis.ts).
 * `essai` résume : paiements ou courriers pour de faux, c'est un site de test.
 * Les colis n'y entrent pas : SendCloud reste en essai tant qu'on n'a pas
 * décidé d'acheter de vraies étiquettes, même sur la vraie boutique.
 */
import type { Hono } from "hono";
import { estEnEssai } from "./mail.js";
import { paypalConfigured, stripeConfigured } from "./payments.js";
import { colisConfigure, modeEssai } from "./sendcloud-colis.js";

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

/** L'état de CE serveur, relu à chaque appel (rien n'est mis en cache ici). */
export function etatEssai(): EtatEssai {
  const paypalClientId =
    process.env.PUBLIC_PAYPAL_CLIENT_ID ?? process.env.PAYPAL_CLIENT_ID ?? "";
  return etatEssaiDepuis(
    {
      stripePublicKey: process.env.PUBLIC_STRIPE_KEY ?? "",
      paypalEnv: process.env.PAYPAL_ENV ?? "",
    },
    {
      // « Branché » au sens de la caisse (/payments/config) : les clés du
      // serveur ET celle du navigateur. Un moyen à moitié réglé n'est pas
      // proposé à la cliente, il ne peut donc pas la tromper.
      stripe: stripeConfigured,
      paypal: paypalConfigured && paypalClientId.length > 0,
      courriersEnEssai: estEnEssai(),
      colisEnEssai: colisConfigure() && modeEssai(),
    },
  );
}

/**
 * GET /admin/mode-essai → EtatEssai.
 *
 * Sous /admin/* : réservée à la propriétaire par la garde du back-office. Le
 * back-office s'en sert pour n'afficher l'aide des essais, et la marche à
 * suivre pour en sortir, que sur un site d'essai.
 */
export function mountModeEssai(app: Hono): void {
  app.get("/admin/mode-essai", (c) => c.json(etatEssai()));
}
