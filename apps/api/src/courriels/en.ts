import type { CleCourriel } from "./fr.js";

/**
 * Les textes des courriels en anglais.
 *
 * Anglais britannique, comme le site : « basket », « colour », « personalise »,
 * « postcode ». Ton chaleureux et simple. Les mots sont ceux du site (section
 * `en` de apps/web/src/i18n/ui.ts) : « Size » pour le format, « Delivery » pour
 * le port, « Resume my order » pour le bouton de reprise… Une cliente qui lit
 * « Size A3 » sur la page et « Format A3 » dans le courrier se demanderait si
 * c'est la même chose.
 *
 * Les clés, leur texte français et leur contexte sont dans ./fr.ts ; les
 * variables entre accolades ne se traduisent pas. Une clé absente partirait en
 * français (voir `tc` dans ./index.ts) : le `satisfies` du bas fait de cet
 * oubli une erreur de compilation plutôt qu'une phrase française glissée dans
 * un courrier anglais.
 */
export const en: Partial<Record<CleCourriel, string>> = {
  /* --- Commun ------------------------------------------------------------- */

  "commun.bonjour": "Hello {prenom},",
  /** « Hello there, » : la forme anglaise naturelle quand on n'a pas de prénom. */
  "commun.prenomParDefaut": "there",
  "commun.texteLien": "{libelle}: {lien}",
  "pied.signature": "Memory Line, personalised posters.",
  /**
   * Imprimée SOUS la mention française, pour information : elle dit ce que
   * signifie la mention, sans se donner pour le texte légal. Les mêmes mots
   * que le panier du site (« French small-business exemption »).
   */
  "mention.tva":
    "VAT not applicable: French small-business exemption, article 293 B of the French General Tax Code.",

  /* --- Les articles, dans tous les courriers qui en montrent ---------------- */

  /** « Size », comme le sélecteur de la fiche produit et du panier. */
  "lignes.format": "Size {format}",
  "lignes.indisponible": "This poster is no longer available.",
  "lignes.titreParDefaut": "Personalised poster",

  /* --- Confirmation de commande ------------------------------------------- */

  "confirmation.objet": "Your order {numero} is confirmed",
  /**
   * Sans virgule devant le prénom, à dessein : c'est ce qui permet au repli
   * de donner « Thank you so much! » quand on ne connaît pas le prénom.
   */
  "confirmation.titre": "Thank you {prenom}!",
  "confirmation.prenomParDefaut": "so much",
  "confirmation.intro":
    "Your order {numero} has been placed and paid for. We're now getting your poster ready.",
  "confirmation.sousTotal": "Subtotal",
  "confirmation.reduction": "Discount",
  "confirmation.livraison": "Delivery",
  "confirmation.total": "Total",
  "confirmation.adresseLivraison": "Delivery address:",
  "confirmation.question": "Any questions? Just reply to this email.",
  "confirmation.texte": "Your order {numero} is confirmed. Total: {total}.",

  /* --- Relance de panier : le courrier d'origine ----------------------------- */

  "panier.votrePanier": "Your basket",
  "panier.indispoUne":
    "One of these posters is no longer available, but the rest of your basket is still waiting for you.",
  "panier.indispoPlusieurs":
    "Some of these posters are no longer available, but the rest of your basket is still waiting for you.",
  "panier.promo": "Your discount code {code} has already been applied.",
  "panier.desinscriptionRaison":
    "You're receiving this email because you left an unfinished order with us.",
  "panier.desinscriptionLien": "Stop receiving basket reminders",
  "panier.texteIntro":
    "You designed a poster but didn't finish your order. It's waiting for you:",
  "panier.textePlusDisponible": "no longer available",
  "panier.texteTotal": "Total: {montant}",

  /* --- Relance de panier : les textes par défaut des trois relances --------- */

  "relance.1.objet": "Your poster is waiting for you",
  "relance.1.accroche": "Hello {prenom},",
  "relance.1.message":
    "You designed a poster but didn't finish your order. It's still here, just as you left it.",
  /** Le bouton de la page de reprise du site dit la même chose. */
  "relance.1.bouton": "Resume my order",
  "relance.1.conclusion": "If you've changed your mind, simply ignore this email.",

  "relance.2.objet": "Your basket is still waiting for you",
  "relance.2.accroche": "Hello {prenom},",
  "relance.2.message":
    "Just a quick reminder: your poster is still in your basket, ready to go to print. All you need to do now is place your order.",
  "relance.2.bouton": "Resume my order",
  "relance.2.conclusion":
    "A question about the size or the frame? Just reply to this email.",

  /**
   * « One last reminder » plutôt que « Final reminder » : en anglais, ce
   * dernier est la formule des relances d'impayés.
   */
  "relance.3.objet": "One last reminder about your poster",
  "relance.3.accroche": "Hello {prenom},",
  "relance.3.message":
    "This is our last email about your basket, and we won't write to you about it again. Your poster will still be waiting for you for a few more days.",
  "relance.3.bouton": "Complete my order",
  "relance.3.conclusion": "If you've changed your mind, simply ignore this email.",

  /** Les guillemets anglais, comme `ponct.guillemets` sur le site. */
  "relance.articleCite": "“{titre}”",
  /** Pas de virgule d'Oxford : l'usage britannique courant. */
  "relance.articlesEt": "{debut} and {dernier}",
  "relance.articleParDefaut": "your poster",

  /* --- Commande expédiée -------------------------------------------------- */

  "expediee.objet": "Your order {numero} is on its way",
  /** « Dispatched » : le mot britannique d'un colis qui quitte l'atelier. */
  "expediee.intro": "Your poster has been dispatched and is on its way to you.",
  "expediee.introPar":
    "Your poster has been dispatched with {transporteur} and is on its way to you.",
  "expediee.bouton": "Track my parcel",
  "expediee.numeroSuivi": "Tracking number: {numero}",
  "expediee.delai":
    "It may take a few days for the tracking to start updating: the carrier needs a little time to register the parcel.",
  "expediee.texte": "Your order {numero} has been dispatched.",
  "expediee.textePar": "Your order {numero} has been dispatched with {transporteur}.",
  "expediee.texteSuivi": "Tracking: {lien}",

  /* --- Affiche prête au stand --------------------------------------------- */

  "stand.objet": "Your poster is ready",
  "stand.intro":
    "The poster you ordered is ready. We'll be in touch to hand it over, or you'll receive it shortly if it needs to be posted to you.",
  "stand.introSur":
    "The poster you ordered at {evenement} is ready. We'll be in touch to hand it over, or you'll receive it shortly if it needs to be posted to you.",
  /** L'anglais n'accorde pas : la formule est neutre d'elle-même. */
  "stand.merci": "Order {numero}. Thank you for coming to see us.",
  "stand.texte": "The poster you ordered is ready.",
  "stand.texteSur": "The poster you ordered at {evenement} is ready.",
  "stand.texteCommande": "Order {numero}.",

  /* --- Bienvenue ---------------------------------------------------------- */

  "bienvenue.objet": "Welcome to Memory Line",
  "bienvenue.intro":
    "Your account has been created. In it you'll find your orders and their tracking, the posters you've designed, and the delivery addresses you only need to save once.",
  /** « Open my account » se lirait comme l'ouverture d'un compte bancaire. */
  "bienvenue.bouton": "Go to my account",
  "bienvenue.securite":
    "We'll never ask for your password by email. Any questions? Just reply to this message.",
  "bienvenue.texte":
    "Your Memory Line account has been created. In it you'll find your orders and their tracking, your posters and your delivery addresses.",

  /* --- Mot de passe modifié ----------------------------------------------- */

  "mdpModifie.objet": "Your account password has been changed",
  "mdpModifie.parReinit":
    "The password for your Memory Line account has just been changed, using the reset link requested from the log-in page. All open sessions have been closed, so you'll need to log in again on each of your devices.",
  "mdpModifie.parCompte":
    "The password for your Memory Line account has just been changed from within your account.",
  "mdpModifie.alerte":
    "If you didn't make this change, someone else may have taken control of your account. Request a new password straight away from the log-in page, then let us know by replying to this email.",
  "mdpModifie.bouton": "Take back control of my account",
  "mdpModifie.avis":
    "This is a security notice. It contains no password, and we'll never ask you for yours.",
  "mdpModifie.texteParReinit":
    "The password for your Memory Line account has just been changed, using the reset link you requested. All open sessions have been closed.",
  "mdpModifie.texteAlerte":
    "If this wasn't you, request a new password straight away from the log-in page.",
  "mdpModifie.texteAlerteLien":
    "If this wasn't you, request a new password straight away from the log-in page: {lien}",

  /* --- Réinitialisation du mot de passe ----------------------------------- */

  "reinit.objet": "Reset your password",
  "reinit.intro":
    "You asked to change the password for your Memory Line account. This link is valid for one hour and can only be used once.",
  "reinit.bouton": "Choose a new password",
  "reinit.ignorer":
    "If you didn't ask for this, simply ignore this email: your current password remains valid.",
  "reinit.texteLien": "To choose a new password (link valid for one hour): {lien}",
  "reinit.texteIgnorer": "If you didn't ask for this, simply ignore this email.",

  /* --- Commande remboursée ------------------------------------------------ */

  "remboursee.objet": "Refund for your order {numero}",
  "remboursee.objetPartiel": "Partial refund for your order {numero}",
  "remboursee.intro": "We've issued a refund of {montant} for your order {numero}.",
  "remboursee.partiel":
    "This is a partial refund: the rest of your order is not affected.",
  "remboursee.port": "This includes {montant} for delivery.",
  /** « €60.00 of this €102.20 order » : le montant de la commande la qualifie. */
  "remboursee.cumul":
    "In total, {total} of this {commande} order has now been refunded to you.",
  "remboursee.delaiEnLigne":
    "The money is going back to the payment method used for the order. Please allow a few working days for it to appear on your statement: that timing is down to your bank, not to us.",
  "remboursee.horsLigne":
    "This refund is not being made through online payment. We'll be in touch if we need any further details to send it to you.",
  "remboursee.question": "Any questions about this refund? Just reply to this email.",
  "remboursee.texte": "A refund of {montant} has been issued for your order {numero}.",
  "remboursee.textePartiel":
    "This is a partial refund: the rest of the order is not affected.",
  "remboursee.texteDelai":
    "Please allow a few working days for it to appear on your statement.",
  "remboursee.texteHorsLigne": "This refund is not being made through online payment.",

  /* --- Commande annulée --------------------------------------------------- */

  "annulee.objet": "Your order {numero} has been cancelled",
  "annulee.intro":
    "Your order {numero} has been cancelled. Nothing will be made or dispatched.",
  "annulee.motif": "Reason: {motif}",
  "annulee.argent":
    "The amount you paid is being refunded to you. You'll receive a separate email as soon as the refund has been processed, with the details and how long it will take.",
  "annulee.surprise":
    "If this cancellation comes as a surprise, just reply to this email and we'll go over the order with you.",
  "annulee.texteArgent":
    "The amount you paid is being refunded to you; a separate email will follow as soon as the refund has been processed.",
  "annulee.motifSaisie": "Input error",
  "annulee.motifRupture": "Out of stock — item unavailable",
  /** Neutre, comme l'anglais le veut ; il sert aussi sur la facture. */
  "annulee.motifCliente": "Customer request",
  "annulee.motifImpaye": "Payment not received",

  /* --- Facture : le courrier ---------------------------------------------- */

  "facture.objet": "Your invoice {facture} — order {numero}",
  "facture.intro": "Here's the invoice for your order {numero}, attached to this email.",
  "facture.numeroFacture": "Invoice no.",
  "facture.commande": "Order",
  "facture.montant": "Amount",
  "facture.reglee":
    "This order has been paid: the invoice is settled and there's nothing more for you to do.",
  "facture.nonReglee":
    "This order hasn't been paid yet. We'll be in touch if we're missing a payment.",
  "facture.question": "Any questions about this invoice? Just reply to this email.",
  "facture.texteNumero": "Invoice no. {facture} — {montant}.",
  "facture.texteReglee": "This order has been paid: the invoice is settled.",
  "facture.texteNonReglee": "This order hasn't been paid yet.",

  /* --- Facture : le PDF joint --------------------------------------------- */

  "facturePdf.nomFichier": "Invoice",
  "facturePdf.titreDocument": "Invoice {facture} - Memory Line",
  "facturePdf.sujetDocument": "Order {numero}",
  "facturePdf.titre": "INVOICE",
  "facturePdf.numero": "No. {facture}",
  "facturePdf.emiseLe": "Issued on {date}",
  /** « FROM » / « BILLED TO » : la paire des factures anglaises. */
  "facturePdf.emetteur": "FROM",
  "facturePdf.activite": "Personalised posters",
  "facturePdf.factureA": "BILLED TO",
  "facturePdf.clientParDefaut": "Customer",
  "facturePdf.commandeDu": "Order {numero} placed on {date}",
  "facturePdf.reglee": "Order paid. Invoice settled.",
  "facturePdf.nonReglee": "Order not yet paid.",
  "facturePdf.annulee": "Order cancelled",
  "facturePdf.annuleeLe": "Order cancelled on {date}",
  "facturePdf.designation": "DESCRIPTION",
  "facturePdf.quantite": "QTY",
  "facturePdf.prixUnitaire": "UNIT PRICE",
  "facturePdf.totalColonne": "TOTAL",
  /**
   * Les guillemets anglais : la facture les ramène à « " » (pourPolicePdf,
   * dans pdf.ts), ce qui reste juste en anglais.
   */
  "facturePdf.texteAffiche": "“{texte}”",
  "facturePdf.sousTotal": "Subtotal",
  "facturePdf.reduction": "Discount",
  "facturePdf.livraison": "Delivery",
  "facturePdf.totalAPayer": "TOTAL DUE",
  /** Suivi d'un montant négatif : « Refunded  - €20.00 ». */
  "facturePdf.dontRembourse": "Refunded",
  "facturePdf.netEncaisse": "Net received",
  "facturePdf.pied":
    "Memory Line, personalised posters. Any questions about this invoice? Just reply to the email it came with.",
  "facturePdf.filigrane": "Cancelled",

  /* --- Accusé de réception du formulaire de contact ------------------------ */

  "contact.objet": "We've received your message — {sujet}",
  "contact.titre": "Your message has reached us",
  "contact.recu":
    "Thank you for writing to us. We'll reply within two working days,\nto this same email address.",
  "contact.rappel": "Here's what you wrote to us:",
  "contact.inutile":
    "This email simply confirms that we've received your message: there's no need to reply, but you\ncan if you forgot to mention something.",
} satisfies Record<CleCourriel, string>;
