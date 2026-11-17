/**
 * Les textes des courriels envoyés AUX CLIENTS, en français — la langue de
 * référence.
 *
 * C'est la seule source de ces phrases : mail.ts, contact.ts et la facture
 * (pdf.ts) les lisent ici, et une clé qui manque dans une autre langue retombe
 * sur celle-ci (voir `tc` dans ./index.ts). Un oubli de traduction part donc
 * en français, jamais sous la forme d'une clé technique.
 *
 * Trois règles d'écriture, que les traductions suivent aussi :
 *
 *   - Les variables s'écrivent entre accolades, {prenom}, {numero}… Elles sont
 *     remplacées au moment de l'envoi et ne se traduisent PAS. Les textes des
 *     relances (« relance.1.… ») portent les variables de la relance, que la
 *     boutique connaît aussi dans ses propres textes : {prenom}, {articles},
 *     {montant}, {lien}.
 *   - Du texte seulement, jamais de HTML : le gras, les liens et les boutons
 *     sont posés par le code autour des phrases.
 *   - Un retour à la ligne (\n) dans une phrase n'est qu'une mise en page du
 *     code HTML du courrier, qui le lit comme une espace. Il est facultatif.
 *
 * Les textes d'ici doivent rester ceux des courriers d'avant le dictionnaire,
 * À LA LETTRE : un courrier français ne doit pas changer d'un octet parce que
 * ses phrases ont déménagé.
 *
 * Les courriers envoyés à la BOUTIQUE (nouvelle commande, message reçu par le
 * formulaire de contact) ne sont pas ici : ils sont lus par la boutique, en
 * français, et restent écrits dans leur fichier.
 */
export const fr = {
  /* --- Commun ------------------------------------------------------------- */

  /** La grande ligne du haut de la plupart des courriers. */
  "commun.bonjour": "Bonjour {prenom},",
  /** Le prénom quand on ne le connaît pas, dans « Bonjour {prenom}, ». */
  "commun.prenomParDefaut": "vous",
  /** La version texte d'un bouton : son libellé, puis l'adresse. */
  "commun.texteLien": "{libelle} : {lien}",
  /** Le pied de chaque courrier, au-dessus de la mention de TVA. */
  "pied.signature": "Memory Line, affiches personnalisées.",
  /**
   * La mention légale. Elle s'imprime TOUJOURS en français, sur le courrier
   * comme sur la facture ; dans une autre langue, sa traduction s'ajoute
   * dessous, pour information.
   */
  "mention.tva": "TVA non applicable, article 293 B du CGI.",

  /* --- Les articles, dans tous les courriers qui en montrent ---------------- */

  "lignes.format": "Format {format}",
  "lignes.indisponible": "Cette affiche n'est plus disponible.",
  /** Le titre d'une ligne de commande qui n'en a pas. */
  "lignes.titreParDefaut": "Affiche personnalisée",

  /* --- Confirmation de commande ------------------------------------------- */

  "confirmation.objet": "Votre commande {numero} est confirmée",
  "confirmation.titre": "Merci {prenom} !",
  /** Le prénom quand on ne le connaît pas, dans « Merci {prenom} ! ». */
  "confirmation.prenomParDefaut": "et merci",
  "confirmation.intro":
    "Votre commande {numero} est bien enregistrée et payée. Nous préparons votre affiche.",
  "confirmation.sousTotal": "Sous-total",
  "confirmation.reduction": "Réduction",
  "confirmation.livraison": "Livraison",
  "confirmation.total": "Total",
  "confirmation.adresseLivraison": "Livraison :",
  /**
   * Au-dessus du lieu de retrait choisi (nom, adresse, texte du lieu), à la
   * place de l'adresse de livraison : la cliente vient chercher sa commande.
   */
  "confirmation.retrait": "À retirer :",
  "confirmation.question": "Une question ? Répondez simplement à cet e-mail.",
  "confirmation.texte": "Votre commande {numero} est confirmée. Total : {total}.",
  /** Sous le total : la part payée par une carte cadeau, code masqué. */
  "confirmation.dontCarte": "Dont réglé avec la carte cadeau {code}",
  /** Une carte cadeau achetée dans la commande, envoyée à son destinataire. */
  "confirmation.carteEnvoyee": "Carte cadeau de {montant} envoyée par e-mail à {email}.",

  /* --- La carte cadeau, envoyée à son destinataire --------------------------- */

  /** Le titre d'une ligne de commande « carte cadeau ». */
  "lignes.carteCadeau": "Carte cadeau",
  "lignes.carteCadeauPour": "Carte cadeau pour {email}",
  "carteCadeau.objet": "Votre carte cadeau Memory Line de {montant}",
  "carteCadeau.objetDe": "{prenom} vous offre une carte cadeau Memory Line",
  /** Le titre quand on ne connaît pas le prénom du destinataire. */
  "carteCadeau.bonjour": "Bonjour,",
  "carteCadeau.intro": "Voici votre carte cadeau Memory Line, d'une valeur de {montant}.",
  "carteCadeau.introDe": "{prenom} vous offre une carte cadeau Memory Line, d'une valeur de {montant}.",
  "carteCadeau.mot": "Son petit mot :",
  "carteCadeau.code": "Votre code",
  "carteCadeau.mode":
    "Indiquez ce code au moment de payer votre commande sur memoryline.fr, dans le champ « Code promo ou carte cadeau ».",
  "carteCadeau.solde":
    "Utilisable en une ou plusieurs fois : le solde restant reste utilisable avec le même code.",
  "carteCadeau.garder": "Gardez cet e-mail : ce code vaut de l'argent, comme un billet.",
  "carteCadeau.bouton": "Choisir une affiche",
  "carteCadeau.texteCode": "Votre code : {code} (valeur {montant}).",

  /* --- Relance de panier : le courrier d'origine ----------------------------- */

  "panier.votrePanier": "Votre panier",
  "panier.indispoUne":
    "Une de ces affiches n'est plus disponible : le reste de votre panier vous attend toujours.",
  "panier.indispoPlusieurs":
    "Certaines de ces affiches ne sont plus disponibles : le reste de votre panier vous attend toujours.",
  "panier.promo": "Votre code de réduction {code} est déjà appliqué.",
  "panier.desinscriptionRaison":
    "Vous recevez ce message parce que vous avez laissé une commande en cours chez nous.",
  "panier.desinscriptionLien": "Ne plus recevoir de rappel de panier",
  "panier.texteIntro":
    "Vous avez composé une affiche sans finir votre commande. Elle vous attend :",
  "panier.textePlusDisponible": "plus disponible",
  "panier.texteTotal": "Total : {montant}",

  /* --- Relance de panier : les textes par défaut des trois relances --------- */

  "relance.1.objet": "Votre affiche vous attend",
  "relance.1.accroche": "Bonjour {prenom},",
  "relance.1.message":
    "Vous avez composé une affiche sans finir votre commande. Elle est toujours là, telle que vous l'avez laissée.",
  "relance.1.bouton": "Reprendre ma commande",
  "relance.1.conclusion": "Si vous avez changé d'avis, ignorez simplement ce message.",

  "relance.2.objet": "Votre panier vous attend toujours",
  "relance.2.accroche": "Bonjour {prenom},",
  "relance.2.message":
    "Petit rappel : votre affiche est toujours dans votre panier, prête à partir à l'impression. Il ne vous reste qu'à valider votre commande.",
  "relance.2.bouton": "Reprendre ma commande",
  "relance.2.conclusion":
    "Une question sur le format ou le cadre ? Répondez simplement à ce message.",

  "relance.3.objet": "Dernier rappel pour votre affiche",
  "relance.3.accroche": "Bonjour {prenom},",
  "relance.3.message":
    "C'est notre dernier message au sujet de votre panier : nous ne vous écrirons plus à son propos. Votre affiche vous attend encore quelques jours.",
  "relance.3.bouton": "Terminer ma commande",
  "relance.3.conclusion": "Si vous avez changé d'avis, ignorez simplement ce message.",

  /** Ce que devient la variable {articles} : un titre cité… */
  "relance.articleCite": "« {titre} »",
  /** … plusieurs titres : « A », « B » et « C ». */
  "relance.articlesEt": "{debut} et {dernier}",
  /** … ou rien de connu. */
  "relance.articleParDefaut": "votre affiche",

  /* --- Commande expédiée -------------------------------------------------- */

  "expediee.objet": "Votre commande {numero} est en route",
  "expediee.intro": "Votre affiche est partie. Elle arrive.",
  "expediee.introPar": "Votre affiche est partie par {transporteur}. Elle arrive.",
  "expediee.bouton": "Suivre mon colis",
  "expediee.numeroSuivi": "Numéro de suivi : {numero}",
  "expediee.delai":
    "Comptez quelques jours avant que le suivi ne s'anime : le transporteur met un moment à enregistrer le colis.",
  "expediee.texte": "Votre commande {numero} est partie.",
  "expediee.textePar": "Votre commande {numero} est partie par {transporteur}.",
  "expediee.texteSuivi": "Suivi : {lien}",

  /* --- Affiche prête au stand --------------------------------------------- */

  "stand.objet": "Votre affiche est prête",
  "stand.intro":
    "Votre affiche commandée est prête. Nous vous recontactons pour la remise, ou vous la recevez sous peu si elle doit voyager.",
  "stand.introSur":
    "Votre affiche commandée sur {evenement} est prête. Nous vous recontactons pour la remise, ou vous la recevez sous peu si elle doit voyager.",
  "stand.merci": "Commande {numero}. Merci d'être passée nous voir.",
  "stand.texte": "Votre affiche commandée est prête.",
  "stand.texteSur": "Votre affiche commandée sur {evenement} est prête.",
  "stand.texteCommande": "Commande {numero}.",

  /* --- Commande prête à retirer ------------------------------------------- */

  /*
   * Une commande « Retrait sur place » traitée : elle attend la cliente au
   * lieu qu'elle a choisi. Avant, elle recevait « Votre commande est en
   * route », ce qui l'aurait fait guetter le facteur. Aucun prix : elle a
   * déjà sa confirmation, ce courrier-ci ne dit que où et quoi.
   */
  "retrait.objet": "Votre commande {numero} vous attend",
  "retrait.intro": "Votre commande est prête : vous pouvez venir la chercher.",
  "retrait.ou": "Où la retirer :",
  "retrait.merci": "Commande {numero}. À très bientôt !",
  "retrait.texte": "Votre commande {numero} est prête : vous pouvez venir la chercher.",

  /* --- Bienvenue ---------------------------------------------------------- */

  "bienvenue.objet": "Bienvenue chez Memory Line",
  "bienvenue.intro":
    "Votre compte est créé. Vous y retrouvez vos commandes et leur suivi, les affiches que vous avez composées, et les adresses de livraison que vous enregistrez une fois pour toutes.",
  "bienvenue.bouton": "Ouvrir mon compte",
  "bienvenue.securite":
    "Nous ne vous demanderons jamais votre mot de passe par e-mail. Une question ? Répondez simplement à ce message.",
  "bienvenue.texte":
    "Votre compte Memory Line est créé. Vous y retrouvez vos commandes et leur suivi, vos affiches et vos adresses de livraison.",

  /* --- Mot de passe modifié ----------------------------------------------- */

  "mdpModifie.objet": "Le mot de passe de votre compte a été modifié",
  "mdpModifie.parReinit":
    "Le mot de passe de votre compte Memory Line vient d'être changé, à partir du lien de réinitialisation demandé depuis la page de connexion. Toutes les sessions ouvertes ont été fermées : il faut vous reconnecter sur chaque appareil.",
  "mdpModifie.parCompte":
    "Le mot de passe de votre compte Memory Line vient d'être changé depuis votre compte.",
  "mdpModifie.alerte":
    "Si vous n'êtes pas à l'origine de ce changement, votre compte vous échappe. Demandez tout de suite un nouveau mot de passe depuis la page de connexion, puis prévenez-nous en répondant à ce message.",
  "mdpModifie.bouton": "Reprendre la main sur mon compte",
  "mdpModifie.avis":
    "Ce message est un avis de sécurité. Il ne contient aucun mot de passe, et nous ne vous demanderons jamais le vôtre.",
  "mdpModifie.texteParReinit":
    "Le mot de passe de votre compte Memory Line vient d'être changé, à partir du lien de réinitialisation que vous aviez demandé. Toutes les sessions ouvertes ont été fermées.",
  "mdpModifie.texteAlerte":
    "Si ce n'est pas vous, demandez tout de suite un nouveau mot de passe depuis la page de connexion.",
  "mdpModifie.texteAlerteLien":
    "Si ce n'est pas vous, demandez tout de suite un nouveau mot de passe depuis la page de connexion : {lien}",

  /* --- Réinitialisation du mot de passe ----------------------------------- */

  "reinit.objet": "Réinitialiser votre mot de passe",
  "reinit.intro":
    "Vous avez demandé à changer le mot de passe de votre compte Memory Line. Ce lien est valable une heure et ne servira qu'une fois.",
  "reinit.bouton": "Choisir un nouveau mot de passe",
  "reinit.ignorer":
    "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe actuel reste valable.",
  "reinit.texteLien":
    "Pour choisir un nouveau mot de passe (lien valable une heure) : {lien}",
  "reinit.texteIgnorer":
    "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.",

  /* --- Commande remboursée ------------------------------------------------ */

  "remboursee.objet": "Remboursement de votre commande {numero}",
  "remboursee.objetPartiel": "Remboursement partiel de votre commande {numero}",
  "remboursee.intro":
    "Nous avons enregistré un remboursement de {montant} sur votre commande {numero}.",
  "remboursee.partiel":
    "Il s'agit d'un remboursement partiel : le reste de votre commande n'est pas concerné.",
  "remboursee.port": "Dont frais de port : {montant}.",
  "remboursee.cumul":
    "Au total, {total} vous ont été rendus sur cette commande de {commande}.",
  "remboursee.delaiEnLigne":
    "Le montant repart vers le moyen de paiement utilisé pour la commande. Comptez quelques jours ouvrés avant de le voir sur votre relevé : ce délai est celui de votre banque, il ne dépend pas de nous.",
  "remboursee.horsLigne":
    "Ce remboursement se fait en dehors du paiement en ligne. Nous revenons vers vous si une information nous manque pour vous le verser.",
  /** La part rendue sur la carte cadeau qui avait payé la commande. */
  "remboursee.carte":
    "{montant} reviennent sur votre carte cadeau : son solde reste utilisable avec le même code.",
  "remboursee.question":
    "Une question sur ce remboursement ? Répondez simplement à cet e-mail.",
  "remboursee.texte":
    "Un remboursement de {montant} a été enregistré sur votre commande {numero}.",
  "remboursee.textePartiel":
    "Il s'agit d'un remboursement partiel : le reste de la commande n'est pas concerné.",
  "remboursee.texteDelai":
    "Comptez quelques jours ouvrés avant de le voir sur votre relevé.",
  "remboursee.texteHorsLigne": "Ce remboursement se fait en dehors du paiement en ligne.",

  /* --- Commande annulée --------------------------------------------------- */

  "annulee.objet": "Votre commande {numero} est annulée",
  "annulee.intro":
    "Votre commande {numero} est annulée. Rien ne sera fabriqué ni expédié.",
  "annulee.motif": "Motif : {motif}",
  "annulee.argent":
    "Le montant réglé vous est rendu. Vous recevrez un message dédié dès que le remboursement est enregistré, avec le détail et le délai.",
  "annulee.surprise":
    "Si cette annulation vous surprend, répondez à ce message : nous reprendrons la commande avec vous.",
  "annulee.texteArgent":
    "Le montant réglé vous est rendu ; un message dédié suivra dès que le remboursement est enregistré.",
  /** Les motifs que la boutique choisit dans une liste, au back-office. */
  "annulee.motifSaisie": "Erreur de saisie",
  "annulee.motifRupture": "Rupture — article indisponible",
  "annulee.motifCliente": "Demande de la cliente",
  "annulee.motifImpaye": "Paiement non reçu",

  /* --- Facture : le courrier ---------------------------------------------- */

  "facture.objet": "Votre facture {facture} — commande {numero}",
  "facture.intro": "Voici la facture de votre commande {numero}, en pièce jointe.",
  "facture.numeroFacture": "Facture n°",
  "facture.commande": "Commande",
  "facture.montant": "Montant",
  "facture.reglee":
    "Cette commande est réglée : la facture est acquittée, vous n'avez rien à faire.",
  "facture.nonReglee":
    "Cette commande n'est pas encore réglée. Nous revenons vers vous si un règlement nous manque.",
  "facture.question":
    "Une question sur cette facture ? Répondez simplement à cet e-mail.",
  "facture.texteNumero": "Facture n° {facture} — {montant}.",
  "facture.texteReglee": "Cette commande est réglée : la facture est acquittée.",
  "facture.texteNonReglee": "Cette commande n'est pas encore réglée.",

  /* --- Facture : le PDF joint --------------------------------------------- */

  /** Le début du nom du fichier joint : « Facture_F2026-0001_WEB-0042.pdf ». */
  "facturePdf.nomFichier": "Facture",
  /** Les propriétés du document, que montre la visionneuse de PDF. */
  "facturePdf.titreDocument": "Facture {facture} - Memory Line",
  "facturePdf.sujetDocument": "Commande {numero}",
  "facturePdf.titre": "FACTURE",
  "facturePdf.numero": "N° {facture}",
  "facturePdf.emiseLe": "Émise le {date}",
  "facturePdf.emetteur": "ÉMETTEUR",
  "facturePdf.activite": "Affiches personnalisées",
  "facturePdf.factureA": "FACTURÉ À",
  /** Le destinataire de la facture quand on n'a pas son nom. */
  "facturePdf.clientParDefaut": "Client",
  "facturePdf.commandeDu": "Commande {numero} du {date}",
  "facturePdf.reglee": "Commande réglée. Facture acquittée.",
  "facturePdf.nonReglee": "Commande non réglée à ce jour.",
  /** Suivie, s'il y en a un, du motif de l'annulation, puis d'un point. */
  "facturePdf.annulee": "Commande annulée",
  "facturePdf.annuleeLe": "Commande annulée le {date}",
  "facturePdf.designation": "DÉSIGNATION",
  "facturePdf.quantite": "QTÉ",
  "facturePdf.prixUnitaire": "PRIX UNIT.",
  "facturePdf.totalColonne": "TOTAL",
  /** Le texte imprimé sur l'affiche, cité sous le titre de la ligne. */
  "facturePdf.texteAffiche": "« {texte} »",
  "facturePdf.sousTotal": "Sous-total",
  "facturePdf.reduction": "Réduction",
  "facturePdf.livraison": "Livraison",
  "facturePdf.totalAPayer": "TOTAL À PAYER",
  "facturePdf.dontRembourse": "Dont remboursé",
  "facturePdf.netEncaisse": "Net encaissé",
  "facturePdf.pied":
    "Memory Line, affiches personnalisées. Une question sur cette facture ? Répondez au courrier qui vous l'a apportée.",
  /** Écrit en grand, en travers de la facture d'une commande annulée. */
  "facturePdf.filigrane": "Annulée",
  /** Sous la commande, pour un retrait sur place : « Retrait : Chalet — 1 place… ». */
  "facturePdf.retrait": "Retrait : {lieu}",

  /**
   * Le « mode de livraison » d'une vente du stand, qui n'en a pas : la
   * cliente repart avec son affiche, ou revient la chercher. Écrit tel quel
   * sur la commande par salon.ts — c'est ce texte français qui reste celui du
   * back-office —, et traduit dans le courriel et la facture d'une cliente
   * étrangère (livraisonDansLaLangue, traductions.ts).
   */
  "livraison.remiseStand": "Remise sur le stand",

  /* --- Accusé de réception du formulaire de contact ------------------------ */

  "contact.objet": "Nous avons bien reçu votre message — {sujet}",
  "contact.titre": "Votre message est bien arrivé",
  "contact.recu":
    "Votre message est bien arrivé. Nous vous répondons sous deux jours ouvrés,\nà cette même adresse.",
  "contact.rappel": "Voici ce que vous nous avez écrit :",
  "contact.inutile":
    "Ce courrier est un accusé de réception : inutile d'y répondre, mais vous\npouvez le faire si vous avez oublié quelque chose.",
} as const;

/** Le nom d'un texte des courriels. */
export type CleCourriel = keyof typeof fr;
