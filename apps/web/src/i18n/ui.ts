/**
 * Textes de l'interface du site public, par langue.
 *
 * Le français est la langue de référence : c'est elle qui sert de repli quand
 * une clé manque ailleurs (voir `t()` dans ./utils.ts), pour qu'un oubli se
 * traduise par du français à l'écran plutôt que par une clé brute.
 *
 * Ne contient QUE les libellés de l'interface. Les contenus éditoriaux — nom et
 * description des affiches, textes de la page d'accueil réglés depuis le
 * back-office — vivent en base et ne sont pas traduits ici.
 */

export const LANGUES = ["fr", "en", "de", "it", "es"] as const;
export type Langue = (typeof LANGUES)[number];

export const LANGUE_DEFAUT: Langue = "fr";

/** Libellé de chaque langue dans sa propre langue (pour le sélecteur). */
export const NOM_LANGUE: Record<Langue, string> = {
  fr: "Français",
  en: "English",
  de: "Deutsch",
  it: "Italiano",
  es: "Español",
};

/**
 * Code complet de chaque langue : la mise en forme des prix et des dates, et
 * og:locale pour les réseaux. Les hreflang, eux, portent le code de langue
 * seul (« en ») : le texte n'a rien de régional (voir Base.astro).
 */
export const LOCALE_COMPLETE: Record<Langue, string> = {
  fr: "fr-FR",
  en: "en-GB",
  de: "de-DE",
  it: "it-IT",
  es: "es-ES",
};

export const ui = {
  fr: {
    "nav.accueil": "Memory Line — accueil",
    "nav.menu": "Menu",
    "stand.mode": "Mode stand",
    "stand.ferme": "Stand fermé : aucune vente ne peut être validée.",
    "nav.affiches": "Affiches",
    "nav.personnalisables": "Affiches personnalisables",
    "nav.tout_voir": "Tout voir",
    "nav.villes": "Villes",
    "nav.themes_paysages": "Thèmes et paysages",
    "nav.pretes": "Affiches prêtes à imprimer",
    "nav.panier": "Panier",
    "nav.creer": "Créer mon affiche",
    "nav.langue": "Langue",

    "pied.droits": "Memory Line — Affiches personnalisées",
    "pied.credit.avant": "Créé avec",
    "pied.credit.apres": "par",
    "pied.baseline": "Votre affiche prête en 2 minutes.",

    "meta.titre": "Memory Line | Affiches personnalisées de villes & paysages",
    "meta.description":
      "Affiches personnalisées de villes, paysages et thèmes. Composez la vôtre en quelques minutes, imprimée en A4 ou A3.",

    "accueil.surtitre": "Affiches personnalisées",
    "accueil.titre": "Votre ville, votre histoire, sur un mur.",
    "accueil.soustitre":
      "Choisissez un fond, personnalisez le titre, ajoutez vos personnages. Votre affiche prête en 2 minutes — imprimée en A4 ou A3.",
    "accueil.cta": "Découvrir les affiches",
    "accueil.stat.affiches": "Affiches",
    "accueil.stat.collections": "Collections",

    "catalogue.titre": "Toutes les affiches",
    "catalogue.compte": "affiches · villes, paysages & thèmes",
    "catalogue.compte_simple": "affiches",
    // Au singulier, quand le rayon n'en a qu'une (« 1 affiche », et non « 1 affiches »).
    "catalogue.compte_un": "affiche",
    "catalogue.erreur": "Impossible de charger le catalogue",
    "catalogue.vide": "Aucune affiche pour le moment.",

    /* Tri et pagination d'un rayon */
    "catalogue.ville": "Lieux",
    "catalogue.toutes_villes": "Tous les lieux",
    "catalogue.chercher_lieu": "Rechercher un lieu…",
    "catalogue.aucun_lieu": "Aucun lieu ne correspond.",
    "catalogue.tri": "Trier",
    "catalogue.tri.manuel": "Ordre de la boutique",
    "catalogue.tri.nouveautes": "Nouveautés",
    "catalogue.tri.prix_asc": "Prix croissant",
    "catalogue.tri.prix_desc": "Prix décroissant",
    "catalogue.tri.alpha": "De A à Z",
    "catalogue.trier_bouton": "Appliquer",
    "catalogue.page": "Page",
    "catalogue.page_sur": "sur",
    "catalogue.precedente": "Précédente",
    "catalogue.suivante": "Suivante",
    /* Recherche */
    "recherche.titre": "Rechercher",
    /* Le même texte dans l'en-tête et sur la page de recherche : c'est ce
       qu'on cherche ici, des affiches. « Recherche… » ne disait pas quoi, et
       « une ville ou un lieu » oubliait les affiches prêtes à imprimer. Le
       champ de l'en-tête a été élargi pour le tenir en entier. */
    "recherche.champ": "Rechercher une affiche",
    "recherche.bouton": "Rechercher",
    "recherche.invite": "Cherchez une ville, un lieu, un thème.",
    "recherche.trop_court": "Tapez au moins deux lettres.",
    "recherche.resultat": "affiche trouvée",
    "recherche.resultats": "affiches trouvées",
    "recherche.aucun": "Aucune affiche ne correspond à cette recherche.",
    "recherche.conseil":
      "Vérifiez l'orthographe, ou essayez le nom d'une ville.",
    "recherche.tout_voir": "Voir toutes les affiches",
    "recherche.instant.preciser": "{n} affiches correspondent : précisez la recherche pour voir les autres.",
    "recherche.instant.fermer": "Fermer",
    "recherche.instant.cherche": "Recherche…",
    /* Prix barré */
    "promo.ancien_prix": "Ancien prix",
    "promo.reduction": "de réduction",
    /* Pied de page */
    "pied.navigation": "La boutique",
    "pied.aide": "Aide et informations",
    "pied.instagram": "Suivez-nous sur Instagram",
    "pied.contact": "Nous contacter",
    "pied.conditions": "Conditions générales de vente",
    "pied.mentions": "Mentions légales",
    "pied.confidentialite": "Politique de confidentialité",
    "pied.cookies": "Cookies",
    /* Page introuvable */
    "404.titre": "Cette page n'existe pas",
    "404.texte":
      "L'adresse est peut-être mal recopiée, ou l'affiche a été retirée de la vente.",
    "404.affiches": "Voir toutes les affiches",
    "404.recherche": "Chercher une affiche",
    "404.accueil": "Retour à l'accueil",
    /* Page momentanément indisponible (le catalogue ne répond pas) */
    "503.titre": "Page momentanément indisponible",
    "503.texte":
      "Le site n'arrive pas à charger cette page pour l'instant. Réessayez dans une minute.",

    "genre.personnalisable": "Personnalisable",
    "genre.prete_a_imprimer": "Prête à imprimer",

    "produit.format": "Format",
    "produit.personnaliser": "Personnaliser",
    "produit.aide": "Choisissez le fond, le texte et vos personnages.",
    "produit.ajouter": "Ajouter au panier",
    // Ce que dit le bouton pendant qu'il travaille (rond qui tourne à côté).
    "produit.ajout_en_cours": "Ajout au panier…",
    "produit.retour": "Retour aux affiches",
    "panier.affiche_ia": "Affiche générée à partir de votre photo",

    "ia.titre": "Votre affiche à partir de votre photo",
    "ia.intro":
      "Envoyez une photo : nous en tirons une affiche. Regardez le résultat, relancez autant de fois que vous voulez, et gardez celle qui vous plaît.",
    "ia.depot": "Déposez votre photo ici, ou cliquez pour la choisir",
    "ia.depot_bouton": "Choisir une photo",
    "ia.depot_formats": "JPEG, PNG ou WebP",
    "ia.photo_nette": "Votre photo doit être nette et lumineuse.",
    "ia.orientation": "Sens de l'affiche",
    "ia.portrait": "Portrait (en hauteur)",
    "ia.paysage": "Paysage (en largeur)",
    "ia.orientation_relancer": "Relancez la création pour obtenir l'affiche dans ce sens.",
    "ia.creations_titre": "Vos créations ({n})",
    "ia.creations_aide":
      "Touchez une affiche pour la revoir, cochez celles à garder : elles partiront ensemble au panier.",
    "ia.creation_n": "Création {n}",
    "ia.garder": "Garder",
    "ia.ajouter_n": "Ajouter les {n} affiches au panier",
    "ia.changer_photo": "Choisir une autre photo",
    "ia.photo_titre": "Votre photo",
    "ia.style_titre": "Quel genre d'affiche ?",
    "ia.style_aide":
      "Choisissez le style qui vous plaît : votre affiche sera créée dans cet esprit.",
    "ia.style_manquant": "Choisissez d'abord un style, ci-dessus.",
    "ia.precision": "Une précision à ajouter ? (facultatif)",
    "ia.precision_exemple":
      "Par exemple : au coucher du soleil, dans des tons chauds…",
    "ia.generer": "Créer mon affiche",
    "ia.regenerer": "Générer une autre version",
    "ia.regenerer_aide": "Autant de fois que vous voulez, sans supplément.",
    "ia.recommencer": "Repartir de zéro",
    "ia.envoi": "Envoi de votre photo…",
    "ia.generation": "Création de votre affiche…",
    "ia.generation_duree":
      "Comptez une bonne trentaine de secondes. Laissez cette page ouverte.",
    "ia.apercu_vide": "Votre affiche apparaîtra ici.",
    "ia.deplacer_ligne": "Glissez pour déplacer la ligne",
    "ia.apercu_alt": "Aperçu de l'affiche générée",
    "ia.filigrane_note":
      "Le filigrane disparaît de l'affiche imprimée, après paiement.",
    "ia.err.indisponible":
      "La création d'affiches n'est pas disponible pour l'instant. Réessayez dans quelques minutes, ou écrivez-nous.",
    "ia.err.format":
      "Ce fichier n'est pas une photo reconnue. Choisissez un JPEG, un PNG ou un WebP.",
    "ia.err.trop_lourde":
      "Cette photo est trop lourde. Prenez-en une plus légère, ou réduisez-la avant de l'envoyer.",
    "ia.err.rafale":
      "Un peu trop de demandes coup sur coup. Patientez une minute, puis relancez.",
    "ia.err.plafond":
      "La création d'affiches est momentanément suspendue. Réessayez plus tard, ou écrivez-nous.",
    "ia.err.generation":
      "La création n'a pas abouti. Relancez : cela passe souvent au deuxième essai. Sinon, essayez une autre photo.",
    "ia.err.attente":
      "L'affiche met plus longtemps que prévu. Relancez la génération.",
    "ia.err.inconnu": "Quelque chose s'est mal passé. Relancez la génération.",
    /* Le relais de photo, au stand : la photo part du téléphone du client et
       arrive sur la tablette (RelaisPhoto.tsx). */
    "ia.relais.ouvrir": "Envoyer la photo depuis votre téléphone",
    "ia.relais.ouvrir_aide":
      "Votre photo est dans votre téléphone ? Scannez un code : elle arrive ici.",
    "ia.relais.code_stand_aide":
      "Pour afficher le code, saisissez d'abord le code du stand. La tablette le retient ensuite.",
    "ia.relais.preparation": "Préparation du code…",
    "ia.relais.scanner": "Scannez ce code avec l'appareil photo de votre téléphone",
    "ia.relais.ou_adresse": "ou ouvrez cette adresse :",
    "ia.relais.attente": "En attente de la photo…",
    "ia.relais.reste": "Code valable encore {minutes} min",
    "ia.relais.recue": "Photo reçue du téléphone.",
    "ia.relais.recue_aide":
      "Pas la bonne ? Touchez le bouton ci-dessous, puis envoyez-en une autre depuis la même page du téléphone.",
    "ia.relais.autre": "Recevoir une autre photo",
    "ia.relais.expire": "Ce code a expiré. Demandez-en un nouveau.",
    "ia.relais.nouveau_code": "Nouveau code",
    "ia.relais.annuler": "Annuler",
    "ia.relais.fermer": "Fermer",
    "ia.relais.reessayer": "Réessayer",
    "ia.relais.injoignable":
      "Le code n'a pas pu être créé. Vérifiez la connexion, puis réessayez.",
    "ia.relais.rafale":
      "Trop de codes demandés d'affilée. Patientez quelques minutes.",
    "ia.relais.qr": "QR code de la page d'envoi de la photo",
    "ia.relais.nom_photo": "Photo du téléphone",

    /* La page du téléphone (/photo/CODE) : le client la lit lui-même, debout
       devant le stand. */
    "photo.meta_titre": "Envoyer votre photo | Memory Line",
    "photo.titre": "Envoyez votre photo",
    "photo.intro":
      "Elle s'affichera aussitôt sur la tablette du stand, pour créer votre affiche.",
    "photo.verification": "Vérification du code…",
    "photo.choisir": "Prendre ou choisir une photo",
    "photo.preparation": "Préparation de la photo…",
    "photo.envoi": "Envoi… {pourcent} %",
    "photo.envoyee": "C'est envoyé ! Regardez la tablette.",
    /* Une fois la première photo reçue, la tablette n'écoute plus : la
       suivante attend qu'on la remette à l'écoute. */
    "photo.envoyee_autre": "C'est envoyé ! Demandez au stand de la recevoir sur la tablette.",
    "photo.autre": "Envoyer une autre photo",
    "photo.autre_aide":
      "Une autre photo ? Envoyez-la, puis demandez au stand de la recevoir sur la tablette.",
    "photo.apercu_alt": "La photo choisie",
    "photo.code_inconnu":
      "Ce code ne correspond à aucun envoi en cours. Vérifiez l'adresse affichée sur la tablette.",
    "photo.code_expire":
      "Ce code a expiré. Demandez un nouveau code sur la tablette.",
    "photo.err.rafale":
      "Trop d'envois d'affilée. Patientez quelques minutes, puis réessayez.",
    "photo.err.reseau":
      "L'envoi n'a pas abouti. Vérifiez votre connexion, puis réessayez.",


    "panier.titre": "Votre panier",
    "panier.vide": "Votre panier est vide.",
    "panier.continuer": "Continuer mes achats",
    "panier.commander": "Commander",
    "panier.total": "Total",
    "panier.quantite": "Quantité",
    "panier.modifier": "Modifier",
    "panier.supprimer": "Supprimer",
    "panier.chargement": "Chargement du panier…",
    "panier.erreur": "Impossible de charger le panier",
    "livraison.cp_recherche": "Code postal",
    "livraison.chercher": "Chercher",
    "livraison.me_localiser": "Me localiser",
    "livraison.localisation_en_cours": "Localisation…",
    "livraison.ma_position": "Autour de ma position",
    "livraison.position_refusee":
      "La localisation n'a pas été autorisée. Saisissez votre adresse ou votre code postal.",
    "livraison.position_introuvable":
      "Votre position n'a pas pu être trouvée. Saisissez votre adresse ou votre code postal.",
    "livraison.recherche_en_cours": "Recherche des points près de chez vous…",
    "livraison.aucun_relais": "Aucun point trouvé pour ce code postal.",
    "livraison.relais_indisponible": "Recherche indisponible pour le moment.",
    "livraison.relais_choisi": "Point choisi :",
    "livraison.horaires": "Horaires",
    "livraison.adresse_recherche": "Votre adresse ou code postal",
    "livraison.titre": "Livraison",
    "livraison.pays": "Pays",
    "livraison.adresse": "Adresse",
    "livraison.complement": "Complément d'adresse",
    "livraison.code_postal": "Code postal",
    "livraison.ville": "Ville",
    "livraison.telephone": "Téléphone",
    "livraison.code_postal_invalide": "Ce code postal n'a pas la forme attendue pour ce pays.",
    "livraison.telephone_invalide": "Ce numéro de téléphone ne semble pas valide.",
    "livraison.ou_nous_trouver": "Où nous trouver :",
    "livraison.stand_ouvert": "Ouvert en ce moment",
    "livraison.stand_ferme": "Fermé en ce moment",
    "livraison.stand_periode": "Du {du} au {au}",
    "livraison.jour_ferme": "Fermé",
    "livraison.aujourdhui": "Aujourd'hui",
    "livraison.a_heure": "à {heure}",
    "livraison.stand_compris": "J'ai bien compris que je dois venir chercher ma commande au stand **au plus tard le {date}, avec ma carte d'identité.**",
    "livraison.stand_identite": "Une carte d'identité vous sera demandée pour retirer votre commande.",
    "livraison.stand_compris_requis": "Cochez la case : vous viendrez chercher votre commande au stand avant sa fermeture.",
    "livraison.point_relais": "Point relais",
    "livraison.point_relais_aide":
      "Indiquez le nom et l'adresse du point relais Mondial Relay de votre choix.",
    "livraison.offerte": "Offerte",
    "livraison.aucune": "Aucune livraison disponible pour ce pays.",
    "livraison.poids_colis": "Poids du colis :",
    "livraison.aucune_pour_ce_poids":
      "Aucun mode de livraison ne couvre ce poids pour ce pays — écrivez-nous.",
    "panier.code": "Code promo",
    "panier.code_appliquer": "Appliquer",
    "panier.code_applique": "Code appliqué :",
    "panier.code_retirer": "Retirer",
    "panier.code_refuse": "Ce code n'est pas valable.",
    "accueil.tout_afficher": "Tout afficher",
    "lettre.email": "E-mail",
    "lettre.envoyer": "S'inscrire",
    "lettre.merci": "Merci ! Vous êtes inscrit·e.",
    "lettre.erreur": "Inscription impossible pour le moment.",
    "panier.produit": "Produit",
    "panier.total_ligne": "Total",
    "panier.total_estime": "Total estimé",
    "panier.taxes":
      "TVA non applicable, article 293 B du CGI. Réductions et frais d'expédition calculés à l'étape du paiement.",
    "panier.payer": "Procéder au paiement",
    "panier.format": "Format",
    "panier.cadre": "Cadre",
    "panier.sans_cadre": "Sans cadre",
    "panier.cadres_retires":
      "Les cadres ne sont pas proposés sur le site pour le moment : nous les avons retirés de votre panier, et le prix a été recalculé.",
    "panier.personnage": "personnage",
    "panier.personnages": "personnages",
    "panier.retirer_ligne": "Retirer cette affiche",
    "panier.moins": "Diminuer la quantité",
    "panier.plus": "Augmenter la quantité",
    "panier.sous_total": "Sous-total",

    "commande.titre": "Votre commande",
    "commande.stand.titre": "Ce navigateur est en mode stand",
    "commande.stand.texte": "Au stand, on ne commande pas en ligne : le client règle sur place, et son panier se valide depuis la page Panier. Pour passer une commande sur le site depuis ce navigateur, quittez le mode stand.",
    "commande.stand.quitter": "Quitter le mode stand et commander",
    "commande.stand.panier": "Revenir au panier du stand",
    "commande.nom": "Nom",
    "commande.email": "E-mail",
    "commande.payer": "Payer",
    "commande.paiement_en_cours": "Paiement en cours…",
    /* Lu par la cliente : ni fichier ni clé, seulement ce qu'elle peut
       faire. Suivi d'un lien « Nous contacter » (pied.contact). */
    "commande.paiement_indisponible":
      "Le paiement en ligne est momentanément indisponible. Votre panier est gardé : réessayez dans un instant.",
    /* Le bandeau d'annonce du haut du site, quand plusieurs messages
       défilent : ce que disent ses boutons aux lecteurs d'écran. */
    "bandeau.region": "Annonces",
    "bandeau.precedent": "Message précédent",
    "bandeau.suivant": "Message suivant",
    "bandeau.pause": "Mettre les annonces en pause",
    "bandeau.lecture": "Reprendre le défilement des annonces",
    "bandeau.position": "{n} sur {total}",
    /* La nature de la zone et de chaque message, telle que le lecteur
       d'écran l'annonce (aria-roledescription) : « carrousel », « message ». */
    "bandeau.carrousel": "carrousel",
    "bandeau.message": "message",

    /* Le stand : la dernière étape, quand le site est ouvert sur la tablette
       d'un marché. Le client lit ces textes lui-même, d'où le « vous ». */
    "stand.titre": "Vos affiches",
    "stand.ajouter": "Ajouter une autre affiche",
    "stand.code": "Code du stand",
    "stand.code_aide":
      "Saisi une fois par la vendeuse : la tablette le retient ensuite.",
    "stand.code_valider": "Valider le code",
    "stand.code_verification": "Vérification du code…",
    "stand.code_vide": "Saisissez le code du stand.",
    "stand.code_refuse":
      "Ce code ne correspond à aucun stand ouvert. Vérifiez-le, ou ouvrez le stand depuis le back-office.",
    "stand.code_perime":
      "Le code retenu par cette tablette ne correspond plus à un stand ouvert. Saisissez le code du jour.",
    "stand.code_injoignable":
      "Le stand n'a pas répondu. Vérifiez la connexion, puis réessayez.",
    "stand.nom": "Votre nom",
    "stand.email": "Votre adresse e-mail",
    "stand.nom_vide": "Indiquez votre nom.",
    "stand.email_invalide": "Cette adresse e-mail est incomplète.",
    "stand.valider_une": "Valider mon affiche",
    "stand.valider_plusieurs": "Valider mes affiches",
    "stand.envoi": "Enregistrement…",
    "stand.erreur": "La commande n'a pas pu être enregistrée. Réessayez.",
    "stand.merci":
      "Votre commande est validée, vous pouvez maintenant vous adresser au vendeur",
    "stand.revenir": "Revenir à ma commande",
    "stand.revenir_erreur": "La commande n'a pas pu être rouverte. Adressez-vous au vendeur.",
    "stand.numero": "Numéro de commande",
    "stand.suivant": "Client suivant",

    "cookies.texte":
      "Ce site garde dans votre navigateur ce qu'il faut pour votre panier et vos préférences. Aucune mesure d'audience, aucun traceur publicitaire.",
    "cookies.politique": "Voir notre politique de cookies",
    "cookies.accepter": "Accepter",
    "cookies.refuser": "Refuser",

    "cfg.titre": "Composez votre affiche",
    "cfg.fermer": "Fermer",
    "cfg.etape.fond": "Fond & texte",
    "cfg.etape.personnages": "Personnages",
    "cfg.etape.format": "Format",
    "cfg.ligne1_champ": "Ligne 1",
    "cfg.ligne2_champ": "Ligne 2",
    "cfg.ligne3_champ": "Ligne 3",
    "cfg.ligne1_exemple": "MERS-LES-BAINS",
    "cfg.ligne2_exemple": "la maison bleue",
    "cfg.ligne3_exemple": "été 2019",
    /* Le nombre d'exemplaires. Le compteur se tient aujourd'hui sur la fiche
       produit (panier.quantite / .moins / .plus) et non dans le module : ces
       trois libellés ne s'affichent donc nulle part. Ils existent quand même,
       parce que le module garde les siens, en français, tant que l'hôte ne
       lui en donne pas — le jour où il reprend son compteur, il reparlerait
       français dans les cinq langues, sans que rien ne le signale. Ses mots à
       lui : « exemplaires » et non « quantité », car on dit combien de fois
       la MÊME affiche sera imprimée. */
    "cfg.quantite": "Nombre d'exemplaires",
    "cfg.quantite_moins": "Un exemplaire de moins",
    "cfg.quantite_plus": "Un exemplaire de plus",
    "cfg.couleur_texte": "Couleur du texte",
    "cfg.fond": "Fond",
    "cfg.personnages": "Personnages",
    "cfg.nouveau_perso": "+ Ajouter un personnage",
    "cfg.modifier": "Modifier",
    "cfg.retirer": "Retirer",
    "cfg.monter": "Monter",
    "cfg.descendre": "Descendre",
    "cfg.retour": "Retour",
    "cfg.continuer": "Continuer",
    "cfg.chargement_apercu": "Chargement de l'affiche…",
    "cfg.valider_affiche": "Valider l'affiche",
    // Une affiche rouverte depuis le panier : on enregistre la ligne, on
    // n'ajoute rien (l'ajout dit « produit.ajout_en_cours »).
    "cfg.enregistrement_en_cours": "Enregistrement de votre affiche…",
    "cfg.valider_perso": "Valider mon personnage",
    "cfg.personnalisation": "PERSONNALISATION",
    "cfg.previsualisation": "PRÉVISUALISATION",
    "cfg.choix_perso": "Choix du personnage",
    "cfg.choix_couleur": "CHOIX DE LA COULEUR",
    "cfg.vetements": "Vêtements",
    "cfg.pantalon": "Pantalon",
    "cfg.coupes": "Coupes de cheveux",
    "cfg.accessoires": "Accessoires",
    "cfg.aucun": "Aucun",
    "cfg.reordonner_aide": "Glissez pour changer l'ordre des personnages",
    "cfg.dupliquer": "Dupliquer ce personnage",
    "cfg.cadre": "Cadre (option)",
    "cfg.sans_cadre": "Sans cadre",
    "cfg.chargement": "Chargement du configurateur…",
    "cfg.erreur":
      "Le configurateur n'a pas pu se charger. Rechargez la page, ou réessayez dans quelques instants.",

    /* La pilule « ▶ Tuto » de la personnalisation et sa pop-up (ProductConfigurator.tsx).
       Ces textes ne sont qu'un REPLI : la marchande peut écrire les siens au
       back-office, ils passent devant. */
    "cfg.video.titre": "Comment ça marche ?",
    "cfg.video.lancer": "Lancer la vidéo",
    "cfg.video.bulle": "Tuto",

    "nav.compte": "Compte",

    "compte.titre": "Mon compte",
    "compte.menu.commandes": "Mes commandes",
    "compte.menu.adresses": "Mes adresses",
    "compte.menu.infos": "Mes informations",
    "compte.deconnexion": "Se déconnecter",
    "compte.email": "E-mail",
    "compte.mdp": "Mot de passe",
    "compte.mdp_afficher": "Afficher",
    "compte.mdp_masquer": "Masquer",
    "compte.mdp_confirmer": "Confirmer le mot de passe",
    "compte.prenom": "Prénom",
    "compte.nom": "Nom",
    "compte.telephone": "Téléphone",
    "compte.marketing":
      "Je souhaite recevoir les nouveautés et offres Memory Line par e-mail.",
    "compte.langue_courriels": "Langue de mes e-mails",
    "compte.langue_courriels_aide":
      "Nous vous écrivons dans cette langue : confirmation de commande, expédition, facture…",
    "compte.article": "article",
    "compte.articles": "articles",
    "compte.mdp_aide": "8 caractères minimum.",

    "compte.connexion.titre": "Connexion",
    "compte.connexion.intro":
      "Connectez-vous pour suivre vos commandes et retrouver vos adresses.",
    "compte.connexion.bouton": "Se connecter",
    "compte.connexion.oubli": "Mot de passe oublié ?",
    "compte.connexion.pas_de_compte": "Vous n'avez pas encore de compte ?",
    "compte.connexion.creer": "Créer un compte",

    "compte.inscription.titre": "Créer un compte",
    "compte.inscription.intro":
      "Un compte vous permet de suivre vos commandes et de ne plus ressaisir vos adresses.",
    "compte.inscription.bouton": "Créer mon compte",
    "compte.inscription.deja": "Vous avez déjà un compte ?",

    "compte.commandes.titre": "Mes commandes",
    "compte.commandes.vide": "Vous n'avez pas encore passé de commande.",
    "compte.commandes.decouvrir": "Découvrir les affiches",
    "compte.commandes.numero": "Commande",
    "compte.commandes.voir": "Voir le détail",
    "compte.commandes.suivre": "Suivre le colis",
    "compte.commandes.retour": "Retour à mes commandes",

    "compte.commande.paiement": "Paiement",
    "compte.commande.traitement": "Traitement",
    "compte.commande.adresse": "Adresse de livraison",
    "compte.commande.articles": "Articles",
    "compte.commande.expeditions": "Expéditions",
    "compte.commande.sous_total": "Sous-total",
    "compte.commande.remise": "Remise",
    "compte.commande.port": "Livraison",
    "compte.commande.total": "Total",
    "compte.commande.rembourse": "Remboursé",
    "compte.commande.quantite": "Quantité",
    "compte.commande.introuvable": "Cette commande est introuvable.",
    "compte.commande.sans_suivi": "Aucun numéro de suivi pour le moment.",

    "compte.statut.financier.pending": "En attente de paiement",
    "compte.statut.financier.authorized": "Paiement autorisé",
    "compte.statut.financier.partially_paid": "Partiellement payée",
    "compte.statut.financier.paid": "Payée",
    "compte.statut.financier.partially_refunded": "Partiellement remboursée",
    "compte.statut.financier.refunded": "Remboursée",
    "compte.statut.financier.voided": "Annulée",

    "compte.statut.expedition.unfulfilled": "Non expédiée",
    "compte.statut.expedition.partially_fulfilled": "Partiellement expédiée",
    "compte.statut.expedition.fulfilled": "Expédiée",
    "compte.statut.expedition.delivered": "Livrée",
    "compte.statut.expedition.cancelled": "Annulée",

    "compte.adresses.titre": "Mes adresses",
    "compte.adresses.vide": "Vous n'avez pas encore enregistré d'adresse.",
    "compte.adresses.nouvelle": "Nouvelle adresse",
    "compte.adresses.modifier": "Modifier",
    "compte.adresses.supprimer": "Supprimer",
    "compte.adresses.enregistrer": "Enregistrer",
    "compte.adresses.annuler": "Annuler",
    "compte.adresses.libelle": "Nom de l'adresse (Maison, Bureau…)",
    "compte.adresses.defaut_livraison":
      "Utiliser comme adresse de livraison par défaut",
    "compte.adresses.defaut_facturation":
      "Utiliser comme adresse de facturation par défaut",
    "compte.adresses.badge_livraison": "Livraison par défaut",
    "compte.adresses.badge_facturation": "Facturation par défaut",

    "compte.infos.titre": "Mes informations",
    "compte.infos.enregistrer": "Enregistrer",
    "compte.infos.enregistre": "Vos informations ont été enregistrées.",
    "compte.infos.mdp_titre": "Changer de mot de passe",
    "compte.infos.mdp_ancien": "Mot de passe actuel",
    "compte.infos.mdp_nouveau": "Nouveau mot de passe",
    "compte.infos.mdp_confirmer": "Confirmer le nouveau mot de passe",
    "compte.infos.mdp_bouton": "Changer mon mot de passe",
    "compte.infos.mdp_change": "Votre mot de passe a été changé.",

    "compte.oubli.titre": "Mot de passe oublié",
    "compte.oubli.intro":
      "Indiquez votre adresse e-mail : nous vous enverrons un lien pour choisir un nouveau mot de passe.",
    "compte.oubli.bouton": "Envoyer le lien",
    "compte.oubli.envoye":
      "Si un compte existe pour cette adresse, un e-mail vient de partir. Pensez à regarder vos courriers indésirables.",
    "compte.oubli.retour": "Retour à la connexion",

    "compte.reinit.titre": "Nouveau mot de passe",
    "compte.reinit.intro":
      "Choisissez le nouveau mot de passe de votre compte.",
    "compte.reinit.bouton": "Enregistrer le nouveau mot de passe",
    "compte.reinit.ok":
      "Votre mot de passe a été changé. Vous pouvez vous connecter.",
    "compte.reinit.lien_incomplet":
      "Ce lien est incomplet. Demandez-en un nouveau depuis la page de connexion.",

    "compte.err.indisponible":
      "L'espace client est momentanément indisponible. Réessayez dans quelques instants.",
    "compte.err.identifiants": "E-mail ou mot de passe incorrect.",
    "compte.err.deja_inscrit":
      "Un compte existe déjà avec cette adresse e-mail.",
    "compte.err.mdp_court":
      "Le mot de passe doit contenir au moins 8 caractères.",
    "compte.err.mdp_different":
      "Les deux mots de passe saisis ne sont pas identiques.",
    "compte.err.mdp_actuel": "Le mot de passe actuel est incorrect.",
    "compte.err.jeton":
      "Ce lien de réinitialisation n'est plus valable. Demandez-en un nouveau.",
    "compte.err.champs": "Merci de remplir les champs obligatoires.",
    "compte.err.generique": "Une erreur est survenue. Réessayez.",
    // Textes sortis du code en dur (octobre 2026).
    "cfg.precedent": "Précédent",
    "cfg.suivant": "Suivant",
    // Les flèches ˄ ˅ des listes qui défilent de haut en bas (grille des
    // personnages, points relais) : infobulle et lecteur d'écran.
    "defiler.haut": "Faire défiler vers le haut",
    "defiler.bas": "Faire défiler vers le bas",
    "cfg.couleur_perso": "Couleur personnalisée",
    "cfg.remettre_couleurs": "Remettre les couleurs d'origine",
    "cfg.remettre_couleurs_de": "Remettre les couleurs d'origine : {partie}",
    "cfg.couleur_actuelle": "Couleur actuelle : {couleur}",
    "cfg.autres": "Autres",
    "cfg.personnage_n": "Personnage {id}",
    "cfg.personnage": "Personnage",
    "cfg.deplacer_aide":
      "{nom} : glissez-le pour le déplacer sur l'affiche, ou utilisez les flèches",
    "cfg.exemple_affiche": "Votre ville, votre histoire",
    "cfg.apercu_cadre": "Aperçu de l'affiche dans un {cadre}",
    "cfg.apercu_cadre_sans_nom": "Aperçu de l'affiche dans un cadre",
    "cfg.ligne_n": "Ligne {n}",
    "cfg.personnaliser_perso": "Personnaliser ce personnage",
    "cfg.police.serif": "Classique",
    "cfg.police.abril": "Affirmée",
    "cfg.police.shabby": "Manuscrite",
    "cfg.couleur.blanc": "Blanc",
    "cfg.couleur.anthracite": "Gris anthracite",
    "commande.modifier_panier": "Modifier le panier",
    "commande.merci_titre": "Merci !",
    "commande.merci_texte": "Votre paiement a bien été reçu et votre commande est confirmée.",
    "commande.numero": "Numéro de commande :",
    /* Retour d'un moyen de paiement à redirection (Bancontact, iDEAL…) : CheckoutIsland. */
    "commande.retour.verification": "Nous vérifions votre paiement auprès de votre banque…",
    "commande.retour.en_cours_titre": "Paiement en cours de validation",
    "commande.retour.en_cours_texte":
      "Votre banque n'a pas encore confirmé le paiement. Vous recevrez un e-mail dès qu'il sera validé : inutile de payer une seconde fois.",
    "commande.retour.ecart_texte":
      "Votre paiement est bien arrivé, mais son montant ne correspond pas à votre commande. La boutique revient vers vous par e-mail pour régler cela : inutile de payer une seconde fois.",
    "commande.retour.refuse":
      "Le paiement a été refusé ou n'a pas abouti. Votre panier est gardé : vérifiez votre livraison, puis réessayez avec le même moyen de paiement ou un autre.",
    "commande.retour.injoignable":
      "Nous n'avons pas pu vérifier votre paiement pour l'instant. Rechargez la page dans un instant ; si le montant a été débité, ne payez pas une seconde fois et écrivez-nous.",
    "commande.coordonnees": "Vos coordonnées",
    "commande.email_compte":
      "C'est l'adresse de votre compte. Pour en changer, passez par « Mes informations ».",
    "commande.email_invalide": "E-mail invalide.",
    "livraison.autre_pays": "Autre pays",
    "livraison.ou_retirer": "Où souhaitez-vous retirer ?",
    "livraison.carnet": "Vos adresses enregistrées",
    "livraison.autre_adresse": "Une autre adresse",
    "livraison.adresse_exemple": "12 rue des Bains",
    "livraison.complement_exemple": "Bâtiment B, 3e étage",
    "livraison.relais_numero": "(n° {code})",
    "livraison.carte": "Carte des points relais",
    "livraison.relais_plus_disponible":
      "Ce point relais n'est plus disponible. Choisissez-en un autre dans la liste.",
    "commande.essai.titre": "Boutique en mode essai : aucun paiement réel.",
    "commande.essai.carte_libelle": "Carte bancaire :",
    "commande.essai.carte":
      "4242 4242 4242 4242, une date future, trois chiffres au dos, et n'importe quel code postal.",
    "commande.essai.paypal_libelle": "PayPal :",
    "commande.essai.paypal":
      "connectez-vous avec le compte acheteur d'essai, pas le vôtre. Il se trouve sur developer.paypal.com, « Testing Tools » puis « Sandbox accounts », en {domaine}.",
    "commande.carte": "Carte bancaire",
    "commande.preparation": "Préparation…",
    "commande.continuer_paiement": "Continuer vers le paiement · {total}",
    /* Sous le bouton grisé : ce qu'il manque pour passer au paiement. */
    "commande.il_manque": "Pour continuer, il manque : {liste}.",
    "commande.manque.nom": "votre nom",
    "commande.manque.email": "une adresse e-mail valide",
    "commande.manque.mode": "un mode de livraison",
    "commande.manque.adresse": "l'adresse de livraison (rue, code postal et ville)",
    "commande.manque.relais": "un point relais",
    "commande.manque.lieu": "le lieu où retirer votre commande",
    /* Le lieu de retrait choisi a été éteint ou archivé pendant la caisse. */
    "commande.err.lieu_retrait_requis":
      "Choisissez le lieu où retirer votre commande. S'il vient de disparaître de la liste, choisissez-en un autre, ou un autre mode de livraison.",
    /* Compte › une commande à retirer : le titre du bloc qui remplace l'adresse. */
    "retrait.titre": "Lieu de retrait",
    "commande.manque.moyen": "un moyen de paiement",
    "commande.modifier_coordonnees": "← Modifier mes coordonnées",
    "commande.recapitulatif": "Récapitulatif",
    "panier.affiche_sans_titre": "Affiche personnalisée",
    "commande.qte": "Qté",
    "commande.err.panier_modifie":
      "Votre panier a changé depuis le calcul du total. Revenez à l'étape précédente pour le recalculer avant de payer.",
    "commande.err.refuse": "Paiement refusé.",
    "commande.err.non_finalise": "Paiement non finalisé. Réessayez.",
    "commande.err.carte_indisponible":
      "Le paiement par carte est indisponible pour le moment. Réessayez dans quelques instants.",
    "commande.err.paypal_indisponible":
      "PayPal n'a pas pu se charger. Réessayez, ou payez par carte.",
    "commande.err.paiement_reconfigure":
      "Les moyens de paiement de la boutique viennent de changer. Choisissez de nouveau votre moyen de paiement : rien n'a été débité.",
    "commande.err.paypal_ouverture":
      "Le paiement par PayPal n'a pas pu être ouvert. Essayez la carte bancaire, ou revenez dans quelques minutes.",
    "commande.err.compte_requis":
      "Il faut être connectée pour valider la commande. Créez votre compte ou connectez-vous, votre panier vous attend.",
    "commande.err.generique":
      "La commande n'a pas pu être préparée. Vérifiez vos informations, puis réessayez.",
    /* Une panne, pas un refus : l'API qui lève, le réseau coupé (CheckoutIsland). */
    "commande.err.technique":
      "Un problème technique nous a empêchés de valider votre commande. Rien n'a été débité et votre panier est gardé : réessayez dans un instant.",
    "commande.err.paiement":
      "Le paiement n'a pas pu être confirmé. Réessayez, ou écrivez-nous si le montant a été débité.",
    "ponct.deux_points": " : ",
    "ponct.guillemets": "« {texte} »",
    "panier.pastille": "{nombre} article(s) dans le panier",
    "panier.err.ajout": "L'affiche n'a pas pu être ajoutée au panier. Réessayez dans un instant.",
    "panier.err.config":
      "Votre affiche n'a pas pu être ajoutée au panier. Rechargez la page et réessayez.",
    "accueil.vitrine_titre": "Nos best-sellers ❤️",
    "accueil.vitrine_texte":
      "- Choisissez votre fond\n- Personnalisez votre texte\n- Choisissez vos personnages et personnalisez-les\nVotre affiche prête en 2 minutes !",
    "accueil.ia_titre": "Votre photo, en affiche",
    "accueil.ia_texte":
      "Envoyez une photo — une maison, une plage, une rue, un souvenir — et retrouvez-la illustrée dans le style Memory Line. Vous voyez le résultat avant de commander.",
    "accueil.ia_bouton": "Essayer avec ma photo",
    "accueil.lettre_titre": "Abonnez-vous à notre newsletter",
    // La description Google d'une fiche sans texte ni description SEO
    // (61 fiches) : une vraie phrase, selon la nature de l'affiche.
    "produit.meta_repli.personnalisable":
      "{nom} : affiche personnalisée à composer en ligne. Ajoutez vos personnages et votre texte en quelques minutes. Impression en A4 ou A3.",
    "produit.meta_repli.prete_a_imprimer":
      "{nom} : affiche décorative prête à imprimer, à accrocher chez soi ou à offrir. Impression en A4 ou A3.",
    "seo.fil_accueil": "Accueil",
    // Ce que Google lit dans les titres : la nature de l'affiche (fiche,
    // texte de l'image), puis au pluriel pour les rayons. C'est le mot-clé
    // que memoryline.fr porte dans chaque titre de fiche.
    "seo.nature.personnalisable": "Affiche personnalisée",
    "seo.nature.prete_a_imprimer": "Affiche prête à imprimer",
    "seo.natures.personnalisable": "Affiches personnalisées",
    "seo.natures.prete_a_imprimer": "Affiches prêtes à imprimer",
    "seo.natures.mixte": "Affiches",
    "seo.page_n": "page {n}",
    "seo.titre.catalogue": "Toutes les affiches : villes, paysages, thèmes",
    "seo.titre.personnalisable": "Affiches personnalisées à composer en ligne",
    "seo.titre.prete_a_imprimer": "Affiches décoratives prêtes à imprimer",
    "seo.description.catalogue":
      "Toutes les affiches Memory Line : affiches personnalisées de villes et de paysages, et affiches décoratives prêtes à imprimer. Impression en A4 ou A3.",
    "seo.description.personnalisable":
      "Composez votre affiche personnalisée : choisissez une ville ou un paysage, ajoutez vos personnages et votre texte. Impression en A4 ou A3.",
    "seo.description.prete_a_imprimer":
      "Affiches décoratives prêtes à imprimer : villes, régions et messages à accrocher chez soi ou à offrir. Impression en A4 ou A3.",
    "seo.description.rayon.personnalisable":
      "{rayon} : affiches personnalisées à composer en ligne. Ajoutez vos personnages et votre texte. Impression en A4 ou A3.",
    "seo.description.rayon.prete_a_imprimer":
      "{rayon} : affiches décoratives prêtes à imprimer, à accrocher chez soi ou à offrir. Impression en A4 ou A3.",
    "seo.description.rayon.mixte":
      "{rayon} : affiches Memory Line, personnalisées ou prêtes à imprimer, à accrocher chez soi ou à offrir. Impression en A4 ou A3.",
    "accueil.h1": "Affiches personnalisées de villes et de paysages",
    "produit.description_titre": "À propos de cette affiche",
    "produit.fil_ariane": "Fil d'Ariane",
    "produit.voisines.titre_rayon": "Dans la même collection",
    "produit.voisines.titre_genre": "Vous aimerez aussi",
    "produit.voisines.voir_tout": "Voir tout le rayon « {rayon} »",
    "compte.essai.titre": "Site de test.",
    "compte.essai.avant":
      "Ce compte est pré-rempli au hasard pour vous éviter la saisie. Mot de passe :",
    "compte.essai.apres":
      "— notez l'adresse e-mail si vous voulez vous reconnecter dessus. Ce bandeau et ce pré-remplissage n'existent pas en production.",
    "panier.recuperer.titre": "Votre panier vous attend",
    "panier.recuperer.intro": "Nous le remettons en place, puis nous vous emmenons à la commande.",
    "panier.recuperer.article_indisponible": "cette affiche n'est plus disponible",
    "panier.recuperer.code": "Votre code de réduction {code} est repris.",
    "panier.recuperer.bouton": "Reprendre ma commande",
    "panier.recuperer.sans_js":
      "Votre navigateur n'exécute pas JavaScript : nous ne pouvons pas remettre votre panier en place. Écrivez-nous en répondant au message que vous avez reçu, nous terminerons la commande avec vous.",
    "panier.recuperer.voir_affiches": "Voir les affiches",
    "panier.recuperer.jeton_inconnu.titre": "Ce lien n'est plus valable",
    "panier.recuperer.jeton_inconnu.texte":
      "Nous ne reconnaissons pas ce lien. Il a peut-être été coupé en deux par votre messagerie, ou votre panier a été réglé depuis un autre appareil.",
    "panier.recuperer.deja_payee.titre": "Cette commande est déjà réglée",
    "panier.recuperer.deja_payee.texte":
      "Bonne nouvelle : votre commande a bien été payée. Vous n'avez rien à reprendre, nous préparons votre affiche.",
    "panier.recuperer.panier_clos.titre": "Ce panier a été clos",
    "panier.recuperer.panier_clos.texte":
      "Cette commande a été annulée ou remboursée. Elle ne peut plus être reprise, mais rien ne vous empêche d'en composer une nouvelle.",
    "panier.recuperer.trop_ancien.titre": "Ce lien a expiré",
    "panier.recuperer.trop_ancien.texte":
      "Passé quatorze jours, nous cessons de garder un panier en attente : nos prix et nos affiches ont pu changer entre-temps. Reprenez depuis la boutique, votre affiche s'y compose en deux minutes.",
    "panier.recuperer.indisponible.titre": "Nous n'arrivons pas à ouvrir votre panier",
    "panier.recuperer.indisponible.texte":
      "Quelque chose s'est mal passé de notre côté. Réessayez dans un instant, ou écrivez-nous en répondant simplement au message que vous avez reçu.",
    "livraison.relais_requis": "Choisissez votre point relais dans la liste proposée.",
    "livraison.relais_autre_reseau":
      "Ce point relais ne correspond pas au mode de livraison choisi. Choisissez-en un dans la liste.",
    "commande.err.mode_indisponible":
      "Ce mode de livraison n'est plus disponible. Choisissez-en un autre.",
    "commande.err.adresse_incomplete":
      "Votre adresse de livraison est incomplète : vérifiez la rue, le code postal et la ville.",
    "commande.err.avant_paiement":
      "Nous n'avons pas pu vérifier votre panier avant le paiement. Rien n'a été débité : réessayez dans quelques instants.",
    "cfg.plus_bas": "Plus bas : {parties}",
    "cfg.partie.couleurs": "couleurs",
    "cfg.partie.vetements": "vêtements",
    "cfg.partie.cheveux": "cheveux",
    "cfg.partie.accessoires": "accessoires",
  },

  en: {
    "nav.accueil": "Memory Line — home",
    "nav.menu": "Menu",
    "stand.mode": "Stand mode",
    "stand.ferme": "Stand closed: no sale can be confirmed.",
    "nav.affiches": "Posters",
    "nav.personnalisables": "Customisable posters",
    "nav.tout_voir": "See all",
    "nav.villes": "Towns and cities",
    "nav.themes_paysages": "Themes and landscapes",
    "nav.pretes": "Ready-to-print posters",
    "nav.panier": "Basket",
    "nav.creer": "Create my poster",
    "nav.langue": "Language",

    "pied.droits": "Memory Line — Personalised posters",
    "pied.credit.avant": "Made with",
    "pied.credit.apres": "by",
    "pied.baseline": "Your poster ready in 2 minutes.",

    "meta.titre": "Memory Line | Personalised city & landscape posters",
    "meta.description":
      "Personalised posters of cities, landscapes and themes. Design yours in minutes, printed in A4 or A3.",

    "accueil.surtitre": "Personalised posters",
    "accueil.titre": "Your city, your story, on a wall.",
    "accueil.soustitre":
      "Pick a background, personalise the title, add your characters. Your poster ready in 2 minutes — printed in A4 or A3.",
    "accueil.cta": "Browse the posters",
    "accueil.stat.affiches": "Posters",
    "accueil.stat.collections": "Collections",

    "catalogue.titre": "All posters",
    "catalogue.compte": "posters · cities, landscapes & themes",
    "catalogue.compte_simple": "posters",
    "catalogue.compte_un": "poster",
    "catalogue.erreur": "Could not load the catalogue",
    "catalogue.vide": "No posters yet.",

    "catalogue.ville": "Places",
    "catalogue.toutes_villes": "All places",
    "catalogue.chercher_lieu": "Search for a place…",
    "catalogue.aucun_lieu": "No matching place.",
    "catalogue.tri": "Sort",
    "catalogue.tri.manuel": "Shop order",
    "catalogue.tri.nouveautes": "New in",
    "catalogue.tri.prix_asc": "Price, low to high",
    "catalogue.tri.prix_desc": "Price, high to low",
    "catalogue.tri.alpha": "A to Z",
    "catalogue.trier_bouton": "Apply",
    "catalogue.page": "Page",
    "catalogue.page_sur": "of",
    "catalogue.precedente": "Previous",
    "catalogue.suivante": "Next",
    "recherche.titre": "Search",
    "recherche.champ": "Search for a poster",
    "recherche.bouton": "Search",
    "recherche.invite": "Search for a city, a place, a theme.",
    "recherche.trop_court": "Type at least two letters.",
    "recherche.resultat": "poster found",
    "recherche.resultats": "posters found",
    "recherche.aucun": "No poster matches this search.",
    "recherche.conseil": "Check the spelling, or try the name of a city.",
    "recherche.tout_voir": "See all posters",
    "recherche.instant.preciser": "{n} posters match: refine your search to see the others.",
    "recherche.instant.fermer": "Close",
    "recherche.instant.cherche": "Searching…",
    "promo.ancien_prix": "Previous price",
    "promo.reduction": "off",
    "pied.navigation": "The shop",
    "pied.aide": "Help and information",
    "pied.instagram": "Follow us on Instagram",
    "pied.contact": "Contact us",
    "pied.conditions": "Terms and conditions of sale",
    "pied.mentions": "Legal notice",
    "pied.confidentialite": "Privacy policy",
    "pied.cookies": "Cookies",
    "404.titre": "This page does not exist",
    "404.texte":
      "The address may have been mistyped, or the poster is no longer on sale.",
    "404.affiches": "See all posters",
    "404.recherche": "Search for a poster",
    "404.accueil": "Back to the home page",
    "503.titre": "Page temporarily unavailable",
    "503.texte":
      "We can't load this page at the moment. Please try again in a minute.",

    "genre.personnalisable": "Customisable",
    "genre.prete_a_imprimer": "Ready to print",

    "produit.format": "Size",
    "produit.personnaliser": "Personalise",
    "produit.aide": "Choose the background, the text and your characters.",
    "produit.ajouter": "Add to basket",
    "produit.ajout_en_cours": "Adding to basket…",
    "produit.retour": "Back to posters",
    "panier.affiche_ia": "Poster created from your photo",

    "ia.titre": "Your poster, from your photo",
    "ia.intro":
      "Upload a photo and we turn it into a poster. Look at the result, run it again as often as you like, and keep the one you love.",
    "ia.depot": "Drop your photo here, or click to choose one",
    "ia.depot_bouton": "Choose a photo",
    "ia.depot_formats": "JPEG, PNG or WebP",
    "ia.photo_nette": "Your photo must be sharp and bright.",
    "ia.orientation": "Poster orientation",
    "ia.portrait": "Portrait (vertical)",
    "ia.paysage": "Landscape (horizontal)",
    "ia.orientation_relancer": "Create again to get the poster in this orientation.",
    "ia.creations_titre": "Your creations ({n})",
    "ia.creations_aide":
      "Tap a poster to see it again, and tick the ones you want to keep: they'll go to your basket together.",
    "ia.creation_n": "Creation {n}",
    "ia.garder": "Keep",
    "ia.ajouter_n": "Add the {n} posters to basket",
    "ia.changer_photo": "Choose another photo",
    "ia.photo_titre": "Your photo",
    "ia.style_titre": "What kind of poster?",
    "ia.style_aide":
      "Choose the style you like: your poster will be created in that spirit.",
    "ia.style_manquant": "First choose a style, above.",
    "ia.precision": "Anything to add? (optional)",
    "ia.precision_exemple": "For example: at sunset, in warm tones…",
    "ia.generer": "Create my poster",
    "ia.regenerer": "Create another version",
    "ia.regenerer_aide": "As many times as you like, at no extra cost.",
    "ia.recommencer": "Start over",
    "ia.envoi": "Uploading your photo…",
    "ia.generation": "Creating your poster…",
    "ia.generation_duree":
      "Allow a good thirty seconds. Keep this page open.",
    "ia.apercu_vide": "Your poster will appear here.",
    "ia.deplacer_ligne": "Drag to move the line",
    "ia.apercu_alt": "Preview of the generated poster",
    "ia.filigrane_note":
      "The watermark disappears from the printed poster, once paid.",
    "ia.err.indisponible":
      "Poster creation is unavailable right now. Try again in a few minutes, or write to us.",
    "ia.err.format":
      "This file isn't a photo we recognise. Choose a JPEG, a PNG or a WebP.",
    "ia.err.trop_lourde":
      "This photo is too heavy. Pick a lighter one, or resize it before uploading.",
    "ia.err.rafale":
      "That's a few too many requests in a row. Wait a minute, then try again.",
    "ia.err.plafond":
      "Poster creation is paused for the moment. Try again later, or write to us.",
    "ia.err.generation":
      "The poster couldn't be created. Try again — it often works on the second attempt. Otherwise, try another photo.",
    "ia.err.attente":
      "The poster is taking longer than expected. Start the creation again.",
    "ia.err.inconnu": "Something went wrong. Start the creation again.",
    "ia.relais.ouvrir": "Send the photo from your phone",
    "ia.relais.ouvrir_aide":
      "Is your photo on your phone? Scan a code and it arrives here.",
    "ia.relais.code_stand_aide":
      "To show the code, first enter the stand code. The tablet then remembers it.",
    "ia.relais.preparation": "Preparing the code…",
    "ia.relais.scanner": "Scan this code with your phone's camera",
    "ia.relais.ou_adresse": "or open this address:",
    "ia.relais.attente": "Waiting for the photo…",
    "ia.relais.reste": "Code valid for {minutes} more min",
    "ia.relais.recue": "Photo received from the phone.",
    "ia.relais.recue_aide":
      "Not the right one? Tap the button below, then send another one from the same page on the phone.",
    "ia.relais.autre": "Receive another photo",
    "ia.relais.expire": "This code has expired. Ask for a new one.",
    "ia.relais.nouveau_code": "New code",
    "ia.relais.annuler": "Cancel",
    "ia.relais.fermer": "Close",
    "ia.relais.reessayer": "Try again",
    "ia.relais.injoignable":
      "The code could not be created. Check the connection, then try again.",
    "ia.relais.rafale":
      "Too many codes requested in a row. Please wait a few minutes.",
    "ia.relais.qr": "QR code for the photo upload page",
    "ia.relais.nom_photo": "Photo from the phone",

    "photo.meta_titre": "Send your photo | Memory Line",
    "photo.titre": "Send your photo",
    "photo.intro":
      "It will appear straight away on the stand's tablet, to create your poster.",
    "photo.verification": "Checking the code…",
    "photo.choisir": "Take or choose a photo",
    "photo.preparation": "Preparing the photo…",
    "photo.envoi": "Sending… {pourcent}%",
    "photo.envoyee": "Sent! Look at the tablet.",
    "photo.envoyee_autre": "Sent! Ask the stand to receive it on the tablet.",
    "photo.autre": "Send another photo",
    "photo.autre_aide":
      "Another photo? Send it, then ask the stand to receive it on the tablet.",
    "photo.apercu_alt": "The chosen photo",
    "photo.code_inconnu":
      "This code doesn't match any upload in progress. Check the address shown on the tablet.",
    "photo.code_expire":
      "This code has expired. Ask for a new code on the tablet.",
    "photo.err.rafale":
      "Too many uploads in a row. Please wait a few minutes, then try again.",
    "photo.err.reseau":
      "The upload didn't go through. Check your connection, then try again.",


    "panier.titre": "Your basket",
    "panier.vide": "Your basket is empty.",
    "panier.continuer": "Continue shopping",
    "panier.commander": "Checkout",
    "panier.total": "Total",
    "panier.quantite": "Quantity",
    "panier.modifier": "Edit",
    "panier.supprimer": "Remove",
    "panier.chargement": "Loading basket…",
    "panier.erreur": "Could not load the basket",
    "livraison.cp_recherche": "Postcode",
    "livraison.chercher": "Search",
    "livraison.me_localiser": "Use my location",
    "livraison.localisation_en_cours": "Finding your location…",
    "livraison.ma_position": "Around my location",
    "livraison.position_refusee":
      "Location access wasn't allowed. Please enter your address or postcode.",
    "livraison.position_introuvable":
      "We couldn't find your location. Please enter your address or postcode.",
    "livraison.recherche_en_cours": "Looking for points near you…",
    "livraison.aucun_relais": "No point found for this postcode.",
    "livraison.relais_indisponible": "Search unavailable right now.",
    "livraison.relais_choisi": "Selected point:",
    "livraison.horaires": "Opening hours",
    "livraison.adresse_recherche": "Your address or postcode",
    "livraison.titre": "Delivery",
    "livraison.pays": "Country",
    "livraison.adresse": "Address",
    "livraison.complement": "Address line 2",
    "livraison.code_postal": "Postcode",
    "livraison.ville": "City",
    "livraison.telephone": "Phone",
    "livraison.code_postal_invalide": "This postcode doesn't look right for this country.",
    "livraison.telephone_invalide": "This phone number doesn't look valid.",
    "livraison.ou_nous_trouver": "Where to find us:",
    "livraison.stand_ouvert": "Open now",
    "livraison.stand_ferme": "Closed right now",
    "livraison.stand_periode": "From {du} to {au}",
    "livraison.jour_ferme": "Closed",
    "livraison.aujourdhui": "Today",
    "livraison.a_heure": "at {heure}",
    "livraison.stand_compris": "I understand that I must collect my order at the stand **by {date} at the latest, bringing my ID card.**",
    "livraison.stand_identite": "An ID card will be required to collect your order.",
    "livraison.stand_compris_requis": "Please tick the box: you will collect your order at the stand before it closes.",
    "livraison.point_relais": "Pickup point",
    "livraison.point_relais_aide":
      "Enter the name and address of your chosen Mondial Relay pickup point.",
    "livraison.offerte": "Free",
    "livraison.aucune": "No delivery available for this country.",
    "livraison.poids_colis": "Parcel weight:",
    "livraison.aucune_pour_ce_poids":
      "No delivery option covers this weight for this country — please get in touch.",
    "panier.code": "Promo code",
    "panier.code_appliquer": "Apply",
    "panier.code_applique": "Code applied:",
    "panier.code_retirer": "Remove",
    "panier.code_refuse": "This code is not valid.",
    "accueil.tout_afficher": "View all",
    "lettre.email": "Email",
    "lettre.envoyer": "Subscribe",
    "lettre.merci": "Thank you! You're subscribed.",
    "lettre.erreur": "Could not subscribe right now.",
    "panier.produit": "Product",
    "panier.total_ligne": "Total",
    "panier.total_estime": "Estimated total",
    "panier.taxes":
      "VAT not applicable (French small-business exemption). Discounts and shipping calculated at checkout.",
    "panier.payer": "Proceed to checkout",
    "panier.format": "Size",
    "panier.cadre": "Frame",
    "panier.sans_cadre": "No frame",
    "panier.cadres_retires":
      "Frames are not available on the website at the moment: we have removed them from your basket and updated the price.",
    "panier.personnage": "character",
    "panier.personnages": "characters",
    "panier.retirer_ligne": "Remove this poster",
    "panier.moins": "Decrease quantity",
    "panier.plus": "Increase quantity",
    "panier.sous_total": "Subtotal",

    "commande.titre": "Your order",
    "commande.stand.titre": "This browser is in stand mode",
    "commande.stand.texte": "At the stand, orders are not placed online: the customer pays on the spot, and the basket is confirmed from the Basket page. To order on the website from this browser, leave stand mode.",
    "commande.stand.quitter": "Leave stand mode and order",
    "commande.stand.panier": "Back to the stand basket",
    "commande.nom": "Name",
    "commande.email": "Email",
    "commande.payer": "Pay",
    "commande.paiement_en_cours": "Processing payment…",
    "commande.paiement_indisponible":
      "Online payment is temporarily unavailable. Your basket has been saved: please try again in a moment.",
    "bandeau.region": "Announcements",
    "bandeau.precedent": "Previous message",
    "bandeau.suivant": "Next message",
    "bandeau.pause": "Pause the announcements",
    "bandeau.lecture": "Resume the announcements",
    "bandeau.position": "{n} of {total}",
    "bandeau.carrousel": "carousel",
    "bandeau.message": "message",

    "stand.titre": "Your posters",
    "stand.ajouter": "Add another poster",
    "stand.code": "Stand code",
    "stand.code_aide":
      "Entered once by the stand staff: the tablet then remembers it.",
    "stand.code_valider": "Confirm code",
    "stand.code_verification": "Checking the code…",
    "stand.code_vide": "Enter the stand code.",
    "stand.code_refuse":
      "This code does not match any open stand. Check it, or open the stand from the back office.",
    "stand.code_perime":
      "The code saved on this tablet no longer matches an open stand. Enter today's code.",
    "stand.code_injoignable":
      "The stand did not respond. Check the connection, then try again.",
    "stand.nom": "Your name",
    "stand.email": "Your email address",
    "stand.nom_vide": "Please enter your name.",
    "stand.email_invalide": "This email address is incomplete.",
    "stand.valider_une": "Confirm my poster",
    "stand.valider_plusieurs": "Confirm my posters",
    "stand.envoi": "Saving…",
    "stand.erreur": "The order could not be saved. Please try again.",
    "stand.merci": "Your order is confirmed, you can now go to the seller",
    "stand.revenir": "Back to my order",
    "stand.revenir_erreur": "The order could not be reopened. Please ask the seller.",
    "stand.numero": "Order number",
    "stand.suivant": "Next customer",

    "cookies.texte":
      "This site keeps what your basket and preferences need in your browser. No analytics, no advertising trackers.",
    "cookies.politique": "See our cookie policy",
    "cookies.accepter": "Accept",
    "cookies.refuser": "Decline",

    "cfg.titre": "Design your poster",
    "cfg.fermer": "Close",
    "cfg.etape.fond": "Background & text",
    "cfg.etape.personnages": "Characters",
    "cfg.etape.format": "Size",
    "cfg.ligne1_champ": "Line 1",
    "cfg.ligne2_champ": "Line 2",
    "cfg.ligne3_champ": "Line 3",
    "cfg.ligne1_exemple": "MERS-LES-BAINS",
    "cfg.ligne2_exemple": "the blue house",
    "cfg.ligne3_exemple": "summer 2019",
    "cfg.quantite": "Number of copies",
    "cfg.quantite_moins": "One copy fewer",
    "cfg.quantite_plus": "One copy more",
    "cfg.couleur_texte": "Text colour",
    "cfg.fond": "Background",
    "cfg.personnages": "Characters",
    "cfg.nouveau_perso": "+ Add a character",
    "cfg.modifier": "Edit",
    "cfg.retirer": "Remove",
    "cfg.monter": "Move up",
    "cfg.descendre": "Move down",
    "cfg.retour": "Back",
    "cfg.continuer": "Continue",
    "cfg.chargement_apercu": "Loading your poster…",
    "cfg.valider_affiche": "Confirm poster",
    "cfg.enregistrement_en_cours": "Saving your poster…",
    "cfg.valider_perso": "Confirm character",
    "cfg.personnalisation": "PERSONALISATION",
    "cfg.previsualisation": "PREVIEW",
    "cfg.choix_perso": "Choose a character",
    "cfg.choix_couleur": "COLOUR",
    "cfg.vetements": "Top",
    "cfg.pantalon": "Bottoms",
    "cfg.coupes": "Hairstyles",
    "cfg.accessoires": "Accessories",
    "cfg.aucun": "None",
    "cfg.reordonner_aide": "Drag to reorder the characters",
    "cfg.dupliquer": "Duplicate this character",
    "cfg.cadre": "Frame (optional)",
    "cfg.sans_cadre": "No frame",
    "cfg.chargement": "Loading the designer…",
    "cfg.erreur":
      "The designer couldn't load. Please reload the page, or try again in a moment.",

    /* La pilule « ▶ Tuto » de la personnalisation et sa pop-up (ProductConfigurator.tsx).
       Ces textes ne sont qu'un REPLI : la marchande peut écrire les siens au
       back-office, ils passent devant. */
    "cfg.video.titre": "How does it work?",
    "cfg.video.lancer": "Play the video",
    "cfg.video.bulle": "Guide",

    "nav.compte": "Account",

    "compte.titre": "My account",
    "compte.menu.commandes": "My orders",
    "compte.menu.adresses": "My addresses",
    "compte.menu.infos": "My details",
    "compte.deconnexion": "Log out",
    "compte.email": "Email",
    "compte.mdp": "Password",
    "compte.mdp_afficher": "Show",
    "compte.mdp_masquer": "Hide",
    "compte.mdp_confirmer": "Confirm password",
    "compte.prenom": "First name",
    "compte.nom": "Last name",
    "compte.telephone": "Phone",
    "compte.marketing":
      "I'd like to receive Memory Line news and offers by email.",
    "compte.langue_courriels": "Language for my emails",
    "compte.langue_courriels_aide":
      "We'll write to you in this language: order confirmations, shipping updates, invoices…",
    "compte.article": "item",
    "compte.articles": "items",
    "compte.mdp_aide": "8 characters minimum.",

    "compte.connexion.titre": "Log in",
    "compte.connexion.intro":
      "Log in to track your orders and find your saved addresses.",
    "compte.connexion.bouton": "Log in",
    "compte.connexion.oubli": "Forgotten your password?",
    "compte.connexion.pas_de_compte": "Don't have an account yet?",
    "compte.connexion.creer": "Create an account",

    "compte.inscription.titre": "Create an account",
    "compte.inscription.intro":
      "An account lets you track your orders and save your addresses for next time.",
    "compte.inscription.bouton": "Create my account",
    "compte.inscription.deja": "Already have an account?",

    "compte.commandes.titre": "My orders",
    "compte.commandes.vide": "You haven't placed an order yet.",
    "compte.commandes.decouvrir": "Browse the posters",
    "compte.commandes.numero": "Order",
    "compte.commandes.voir": "View details",
    "compte.commandes.suivre": "Track the parcel",
    "compte.commandes.retour": "Back to my orders",

    "compte.commande.paiement": "Payment",
    "compte.commande.traitement": "Fulfilment",
    "compte.commande.adresse": "Delivery address",
    "compte.commande.articles": "Items",
    "compte.commande.expeditions": "Shipments",
    "compte.commande.sous_total": "Subtotal",
    "compte.commande.remise": "Discount",
    "compte.commande.port": "Delivery",
    "compte.commande.total": "Total",
    "compte.commande.rembourse": "Refunded",
    "compte.commande.quantite": "Quantity",
    "compte.commande.introuvable": "This order could not be found.",
    "compte.commande.sans_suivi": "No tracking number yet.",

    "compte.statut.financier.pending": "Awaiting payment",
    "compte.statut.financier.authorized": "Payment authorised",
    "compte.statut.financier.partially_paid": "Partially paid",
    "compte.statut.financier.paid": "Paid",
    "compte.statut.financier.partially_refunded": "Partially refunded",
    "compte.statut.financier.refunded": "Refunded",
    "compte.statut.financier.voided": "Cancelled",

    "compte.statut.expedition.unfulfilled": "Not shipped",
    "compte.statut.expedition.partially_fulfilled": "Partially shipped",
    "compte.statut.expedition.fulfilled": "Shipped",
    "compte.statut.expedition.delivered": "Delivered",
    "compte.statut.expedition.cancelled": "Cancelled",

    "compte.adresses.titre": "My addresses",
    "compte.adresses.vide": "You haven't saved an address yet.",
    "compte.adresses.nouvelle": "New address",
    "compte.adresses.modifier": "Edit",
    "compte.adresses.supprimer": "Delete",
    "compte.adresses.enregistrer": "Save",
    "compte.adresses.annuler": "Cancel",
    "compte.adresses.libelle": "Address name (Home, Work…)",
    "compte.adresses.defaut_livraison": "Use as my default delivery address",
    "compte.adresses.defaut_facturation": "Use as my default billing address",
    "compte.adresses.badge_livraison": "Default delivery",
    "compte.adresses.badge_facturation": "Default billing",

    "compte.infos.titre": "My details",
    "compte.infos.enregistrer": "Save",
    "compte.infos.enregistre": "Your details have been saved.",
    "compte.infos.mdp_titre": "Change password",
    "compte.infos.mdp_ancien": "Current password",
    "compte.infos.mdp_nouveau": "New password",
    "compte.infos.mdp_confirmer": "Confirm the new password",
    "compte.infos.mdp_bouton": "Change my password",
    "compte.infos.mdp_change": "Your password has been changed.",

    "compte.oubli.titre": "Forgotten password",
    "compte.oubli.intro":
      "Enter your email address: we'll send you a link to choose a new password.",
    "compte.oubli.bouton": "Send the link",
    "compte.oubli.envoye":
      "If an account exists for this address, an email has just been sent. Remember to check your spam folder.",
    "compte.oubli.retour": "Back to log in",

    "compte.reinit.titre": "New password",
    "compte.reinit.intro": "Choose the new password for your account.",
    "compte.reinit.bouton": "Save the new password",
    "compte.reinit.ok": "Your password has been changed. You can now log in.",
    "compte.reinit.lien_incomplet":
      "This link is incomplete. Request a new one from the log-in page.",

    "compte.err.indisponible":
      "The account area is temporarily unavailable. Please try again in a moment.",
    "compte.err.identifiants": "Incorrect email or password.",
    "compte.err.deja_inscrit":
      "An account already exists with this email address.",
    "compte.err.mdp_court": "The password must be at least 8 characters long.",
    "compte.err.mdp_different": "The two passwords do not match.",
    "compte.err.mdp_actuel": "The current password is incorrect.",
    "compte.err.jeton":
      "This reset link is no longer valid. Please request a new one.",
    "compte.err.champs": "Please fill in the required fields.",
    "compte.err.generique": "Something went wrong. Please try again.",
    // Textes sortis du code en dur (octobre 2026).
    "cfg.precedent": "Previous",
    "cfg.suivant": "Next",
    "defiler.haut": "Scroll up",
    "defiler.bas": "Scroll down",
    "cfg.couleur_perso": "Custom colour",
    "cfg.remettre_couleurs": "Restore the original colours",
    "cfg.remettre_couleurs_de": "Restore the original colours: {partie}",
    "cfg.couleur_actuelle": "Current colour: {couleur}",
    "cfg.autres": "Other",
    "cfg.personnage_n": "Character {id}",
    "cfg.personnage": "Character",
    "cfg.deplacer_aide": "{nom}: drag to move it on the poster, or use the arrow keys",
    "cfg.exemple_affiche": "Your city, your story",
    "cfg.apercu_cadre": "Poster preview with frame: {cadre}",
    "cfg.apercu_cadre_sans_nom": "Poster preview with a frame",
    "cfg.ligne_n": "Line {n}",
    "cfg.personnaliser_perso": "Customise this character",
    "cfg.police.serif": "Classic",
    // Pas « Bold » : en typographie anglaise, c'est une graisse, et la
    // pastille se lirait « Classic en gras » au lieu d'une autre police.
    "cfg.police.abril": "Striking",
    "cfg.police.shabby": "Handwritten",
    "cfg.couleur.blanc": "White",
    "cfg.couleur.anthracite": "Charcoal grey",
    "commande.modifier_panier": "Edit basket",
    "commande.merci_titre": "Thank you!",
    "commande.merci_texte": "Your payment has been received and your order is confirmed.",
    "commande.numero": "Order number:",
    "commande.retour.verification": "We are checking your payment with your bank…",
    "commande.retour.en_cours_titre": "Payment being validated",
    "commande.retour.en_cours_texte":
      "Your bank has not confirmed the payment yet. You will receive an email as soon as it is validated: there is no need to pay a second time.",
    "commande.retour.ecart_texte":
      "Your payment has arrived, but its amount does not match your order. The shop will get back to you by email to sort this out: there is no need to pay a second time.",
    "commande.retour.refuse":
      "The payment was declined or did not go through. Your basket has been kept: check your delivery details, then try again with the same payment method or another one.",
    "commande.retour.injoignable":
      "We could not check your payment just now. Please reload the page in a moment; if you have been charged, do not pay a second time and contact us.",
    "commande.coordonnees": "Your details",
    "commande.email_compte":
      "This is your account's email address. To change it, go to “My details”.",
    "commande.email_invalide": "Invalid email address.",
    "livraison.autre_pays": "Other country",
    "livraison.ou_retirer": "Where would you like to collect your order?",
    "livraison.carnet": "Your saved addresses",
    "livraison.autre_adresse": "Another address",
    "livraison.adresse_exemple": "12 Station Road",
    "livraison.complement_exemple": "Building B, 3rd floor",
    "livraison.relais_numero": "(No. {code})",
    "livraison.carte": "Map of pickup points",
    "livraison.relais_plus_disponible":
      "This pickup point is no longer available. Please choose another one from the list.",
    "commande.essai.titre": "Shop in test mode: no real payment is taken.",
    "commande.essai.carte_libelle": "Card:",
    "commande.essai.carte":
      "4242 4242 4242 4242, any future date, any three digits on the back and any postcode.",
    "commande.essai.paypal_libelle": "PayPal:",
    "commande.essai.paypal":
      "log in with the sandbox buyer account, not your own. You will find it on developer.paypal.com under “Testing Tools” then “Sandbox accounts”, ending in {domaine}.",
    "commande.carte": "Card",
    "commande.preparation": "Preparing…",
    "commande.continuer_paiement": "Continue to payment · {total}",
    "commande.il_manque": "To continue, we still need {liste}.",
    "commande.manque.nom": "your name",
    "commande.manque.email": "a valid email address",
    "commande.manque.mode": "a delivery method",
    "commande.manque.adresse": "your delivery address (street, postcode and town)",
    "commande.manque.relais": "a pickup point",
    "commande.manque.lieu": "the place where you will collect your order",
    "commande.err.lieu_retrait_requis":
      "Please choose where to collect your order. If it has just disappeared from the list, choose another one, or another delivery method.",
    "retrait.titre": "Collection point",
    "commande.manque.moyen": "a payment method",
    "commande.modifier_coordonnees": "← Edit my details",
    "commande.recapitulatif": "Order summary",
    "panier.affiche_sans_titre": "Personalised poster",
    "commande.qte": "Qty",
    "commande.err.panier_modifie":
      "Your basket has changed since the total was calculated. Go back to the previous step to recalculate it before paying.",
    "commande.err.refuse": "Payment declined.",
    "commande.err.non_finalise": "Payment not completed. Please try again.",
    "commande.err.carte_indisponible":
      "Card payment is unavailable right now. Please try again in a moment.",
    "commande.err.paypal_indisponible":
      "PayPal could not be loaded. Please try again, or pay by card.",
    "commande.err.paiement_reconfigure":
      "The shop's payment methods have just changed. Please choose your payment method again: nothing has been charged.",
    "commande.err.paypal_ouverture":
      "The PayPal payment could not be opened. Try paying by card, or come back in a few minutes.",
    "commande.err.compte_requis":
      "You need to be logged in to place your order. Create your account or log in — your basket is waiting for you.",
    "commande.err.generique":
      "Your order could not be prepared. Please check your details and try again.",
    "commande.err.technique":
      "A technical problem stopped us from confirming your order. Nothing has been charged and your basket has been kept: please try again in a moment.",
    "commande.err.paiement":
      "The payment could not be confirmed. Please try again, or contact us if you have been charged.",
    "ponct.deux_points": ": ",
    "ponct.guillemets": "“{texte}”",
    "panier.pastille": "Items in your basket: {nombre}",
    "panier.err.ajout":
      "The poster could not be added to your basket. Please try again in a moment.",
    "panier.err.config":
      "Your poster could not be added to the basket. Please reload the page and try again.",
    "accueil.vitrine_titre": "Our best-sellers ❤️",
    "accueil.vitrine_texte":
      "- Choose your background\n- Personalise your text\n- Choose your characters and personalise them\nYour poster ready in 2 minutes!",
    "accueil.ia_titre": "Your photo, as a poster",
    "accueil.ia_texte":
      "Send us a photo — a house, a beach, a street, a memory — and get it back illustrated in the Memory Line style. You'll see the result before you order.",
    "accueil.ia_bouton": "Try it with my photo",
    "accueil.lettre_titre": "Subscribe to our emails",
    "produit.meta_repli.personnalisable":
      "{nom}: a personalised poster to design online. Add your characters and your text in a few minutes. Printed in A4 or A3.",
    "produit.meta_repli.prete_a_imprimer":
      "{nom}: a ready-to-print decorative poster to hang at home or give as a gift. Printed in A4 or A3.",
    "seo.fil_accueil": "Home",
    "seo.nature.personnalisable": "Personalised poster",
    "seo.nature.prete_a_imprimer": "Ready-to-print poster",
    "seo.natures.personnalisable": "Personalised posters",
    "seo.natures.prete_a_imprimer": "Ready-to-print posters",
    "seo.natures.mixte": "Posters",
    "seo.page_n": "page {n}",
    "seo.titre.catalogue": "All posters: cities, landscapes, themes",
    "seo.titre.personnalisable": "Personalised posters to design online",
    "seo.titre.prete_a_imprimer": "Ready-to-print decorative posters",
    "seo.description.catalogue":
      "Every Memory Line poster: personalised city and landscape posters, and ready-to-print decorative posters. Printed in A4 or A3.",
    "seo.description.personnalisable":
      "Design your personalised poster: choose a city or a landscape, add your characters and your text. Printed in A4 or A3.",
    "seo.description.prete_a_imprimer":
      "Ready-to-print decorative posters: cities, regions and messages to hang at home or give as a gift. Printed in A4 or A3.",
    "seo.description.rayon.personnalisable":
      "{rayon}: personalised posters to design online. Add your characters and your text. Printed in A4 or A3.",
    "seo.description.rayon.prete_a_imprimer":
      "{rayon}: ready-to-print decorative posters to hang at home or give as a gift. Printed in A4 or A3.",
    "seo.description.rayon.mixte":
      "{rayon}: Memory Line posters, personalised or ready to print, to hang at home or give as a gift. Printed in A4 or A3.",
    "accueil.h1": "Personalised city and landscape posters",
    "produit.description_titre": "About this poster",
    "produit.fil_ariane": "Breadcrumb",
    "produit.voisines.titre_rayon": "From the same collection",
    "produit.voisines.titre_genre": "You may also like",
    "produit.voisines.voir_tout": "See everything in “{rayon}”",
    "compte.essai.titre": "Test site.",
    "compte.essai.avant": "This account is pre-filled at random to save you typing. Password:",
    "compte.essai.apres":
      "— note down the email address if you want to sign in with it again. This notice and the pre-filling don't exist in production.",
    "panier.recuperer.titre": "Your basket is waiting for you",
    "panier.recuperer.intro": "We're restoring it, then taking you to checkout.",
    "panier.recuperer.article_indisponible": "this poster is no longer available",
    "panier.recuperer.code": "Your discount code {code} has been reapplied.",
    "panier.recuperer.bouton": "Resume my order",
    "panier.recuperer.sans_js":
      "Your browser isn't running JavaScript, so we can't restore your basket. Write to us by replying to the email you received, and we'll complete the order with you.",
    "panier.recuperer.voir_affiches": "See the posters",
    "panier.recuperer.jeton_inconnu.titre": "This link is no longer valid",
    "panier.recuperer.jeton_inconnu.texte":
      "We don't recognise this link. Your email app may have split it in two, or your basket may have been paid for on another device.",
    "panier.recuperer.deja_payee.titre": "This order has already been paid",
    "panier.recuperer.deja_payee.texte":
      "Good news: your order has been paid. There's nothing to resume — we're preparing your poster.",
    "panier.recuperer.panier_clos.titre": "This basket has been closed",
    "panier.recuperer.panier_clos.texte":
      "This order has been cancelled or refunded. It can no longer be resumed, but you're very welcome to create a new one.",
    "panier.recuperer.trop_ancien.titre": "This link has expired",
    "panier.recuperer.trop_ancien.texte":
      "After fourteen days, we stop holding a basket: our prices and posters may have changed in the meantime. Start again from the shop — your poster only takes two minutes to create.",
    "panier.recuperer.indisponible.titre": "We can't open your basket",
    "panier.recuperer.indisponible.texte":
      "Something went wrong on our side. Please try again in a moment, or write to us by simply replying to the email you received.",
    "livraison.relais_requis": "Please choose your pickup point from the list.",
    "livraison.relais_autre_reseau":
      "This pickup point doesn't match the delivery method you chose. Please choose one from the list.",
    "commande.err.mode_indisponible":
      "This delivery method is no longer available. Please choose another one.",
    "commande.err.adresse_incomplete":
      "Your delivery address is incomplete: please check the street, postcode and town.",
    "commande.err.avant_paiement":
      "We couldn't check your basket before payment. Nothing has been charged: please try again in a moment.",
    "cfg.plus_bas": "Further down: {parties}",
    "cfg.partie.couleurs": "colours",
    "cfg.partie.vetements": "clothes",
    "cfg.partie.cheveux": "hair",
    "cfg.partie.accessoires": "accessories",
  },

  de: {
    "nav.accueil": "Memory Line — Startseite",
    "nav.menu": "Menü",
    "stand.mode": "Messestand-Modus",
    "stand.ferme": "Stand geschlossen: Es kann kein Verkauf bestätigt werden.",
    "nav.affiches": "Poster",
    "nav.personnalisables": "Personalisierbare Poster",
    "nav.tout_voir": "Alle ansehen",
    "nav.villes": "Städte",
    "nav.themes_paysages": "Themen und Landschaften",
    "nav.pretes": "Druckfertige Poster",
    "nav.panier": "Warenkorb",
    "nav.creer": "Mein Poster gestalten",
    "nav.langue": "Sprache",

    "pied.droits": "Memory Line — Personalisierte Poster",
    "pied.credit.avant": "Mit",
    "pied.credit.apres": "gemacht von",
    "pied.baseline": "Ihr Poster in 2 Minuten fertig.",

    "meta.titre": "Memory Line | Personalisierte Städte- & Landschaftsposter",
    "meta.description":
      "Personalisierte Poster von Städten, Landschaften und Themen. In wenigen Minuten gestaltet, gedruckt in A4 oder A3.",

    "accueil.surtitre": "Personalisierte Poster",
    "accueil.titre": "Ihre Stadt, Ihre Geschichte, an Ihrer Wand.",
    "accueil.soustitre":
      "Hintergrund wählen, Titel personalisieren, Figuren hinzufügen. Ihr Poster in 2 Minuten fertig — gedruckt in A4 oder A3.",
    "accueil.cta": "Poster entdecken",
    "accueil.stat.affiches": "Poster",
    "accueil.stat.collections": "Kollektionen",

    "catalogue.titre": "Alle Poster",
    "catalogue.compte": "Poster · Städte, Landschaften & Themen",
    "catalogue.compte_simple": "Poster",
    "catalogue.compte_un": "Poster",
    "catalogue.erreur": "Katalog konnte nicht geladen werden",
    "catalogue.vide": "Noch keine Poster.",

    "catalogue.ville": "Orte",
    "catalogue.toutes_villes": "Alle Orte",
    "catalogue.chercher_lieu": "Ort suchen…",
    "catalogue.aucun_lieu": "Kein passender Ort.",
    "catalogue.tri": "Sortieren",
    "catalogue.tri.manuel": "Reihenfolge des Shops",
    "catalogue.tri.nouveautes": "Neuheiten",
    "catalogue.tri.prix_asc": "Preis aufsteigend",
    "catalogue.tri.prix_desc": "Preis absteigend",
    "catalogue.tri.alpha": "Von A bis Z",
    "catalogue.trier_bouton": "Anwenden",
    "catalogue.page": "Seite",
    "catalogue.page_sur": "von",
    "catalogue.precedente": "Zurück",
    "catalogue.suivante": "Weiter",
    "recherche.titre": "Suche",
    "recherche.champ": "Poster suchen",
    "recherche.bouton": "Suchen",
    "recherche.invite": "Suchen Sie nach einer Stadt, einem Ort, einem Thema.",
    "recherche.trop_court": "Geben Sie mindestens zwei Buchstaben ein.",
    "recherche.resultat": "Poster gefunden",
    "recherche.resultats": "Poster gefunden",
    "recherche.aucun": "Kein Poster entspricht dieser Suche.",
    "recherche.conseil":
      "Prüfen Sie die Schreibweise, oder versuchen Sie den Namen einer Stadt.",
    "recherche.tout_voir": "Alle Poster ansehen",
    "recherche.instant.preciser": "{n} Poster passen: Verfeinern Sie die Suche, um die anderen zu sehen.",
    "recherche.instant.fermer": "Schließen",
    "recherche.instant.cherche": "Suche…",
    "promo.ancien_prix": "Vorheriger Preis",
    "promo.reduction": "Rabatt",
    "pied.navigation": "Der Shop",
    "pied.aide": "Hilfe und Informationen",
    "pied.instagram": "Folgen Sie uns auf Instagram",
    "pied.contact": "Kontakt",
    "pied.conditions": "Allgemeine Geschäftsbedingungen",
    "pied.mentions": "Impressum",
    "pied.confidentialite": "Datenschutzerklärung",
    "pied.cookies": "Cookies",
    "404.titre": "Diese Seite gibt es nicht",
    "404.texte":
      "Vielleicht wurde die Adresse falsch übernommen, oder das Poster wird nicht mehr verkauft.",
    "404.affiches": "Alle Poster ansehen",
    "404.recherche": "Ein Poster suchen",
    "404.accueil": "Zurück zur Startseite",
    "503.titre": "Seite vorübergehend nicht verfügbar",
    "503.texte":
      "Diese Seite lässt sich gerade nicht laden. Bitte versuchen Sie es in einer Minute erneut.",

    "genre.personnalisable": "Personalisierbar",
    "genre.prete_a_imprimer": "Druckfertig",

    "produit.format": "Format",
    "produit.personnaliser": "Personalisieren",
    "produit.aide": "Wählen Sie Hintergrund, Text und Ihre Figuren.",
    "produit.ajouter": "In den Warenkorb",
    "produit.ajout_en_cours": "Wird in den Warenkorb gelegt…",
    "produit.retour": "Zurück zu den Postern",
    "panier.affiche_ia": "Poster aus Ihrem Foto erstellt",

    "ia.titre": "Ihr Poster aus Ihrem Foto",
    "ia.intro":
      "Laden Sie ein Foto hoch – wir machen ein Poster daraus. Sehen Sie sich das Ergebnis an, starten Sie so oft neu, wie Sie möchten, und behalten Sie das Poster, das Ihnen gefällt.",
    "ia.depot": "Foto hier ablegen oder klicken, um eines auszuwählen",
    "ia.depot_bouton": "Foto auswählen",
    "ia.depot_formats": "JPEG, PNG oder WebP",
    "ia.photo_nette": "Ihr Foto muss scharf und hell sein.",
    "ia.orientation": "Ausrichtung des Posters",
    "ia.portrait": "Hochformat",
    "ia.paysage": "Querformat",
    "ia.orientation_relancer": "Erstellen Sie das Poster erneut, um es in dieser Ausrichtung zu erhalten.",
    "ia.creations_titre": "Ihre Kreationen ({n})",
    "ia.creations_aide":
      "Tippen Sie auf ein Poster, um es erneut anzusehen, und haken Sie die an, die Sie behalten möchten: Sie kommen gemeinsam in den Warenkorb.",
    "ia.creation_n": "Kreation {n}",
    "ia.garder": "Behalten",
    "ia.ajouter_n": "Die {n} Poster in den Warenkorb legen",
    "ia.changer_photo": "Anderes Foto auswählen",
    "ia.photo_titre": "Ihr Foto",
    "ia.style_titre": "Welche Art von Poster?",
    "ia.style_aide":
      "Wählen Sie den Stil, der Ihnen gefällt: Ihr Poster wird in diesem Sinne gestaltet.",
    "ia.style_manquant": "Wählen Sie zuerst oben einen Stil.",
    "ia.precision": "Möchten Sie etwas ergänzen? (optional)",
    "ia.precision_exemple":
      "Zum Beispiel: bei Sonnenuntergang, in warmen Farbtönen…",
    "ia.generer": "Mein Poster erstellen",
    "ia.regenerer": "Andere Version erstellen",
    "ia.regenerer_aide": "So oft Sie möchten, ohne Aufpreis.",
    "ia.recommencer": "Von vorn beginnen",
    "ia.envoi": "Ihr Foto wird hochgeladen…",
    "ia.generation": "Ihr Poster entsteht…",
    "ia.generation_duree":
      "Rechnen Sie mit gut dreißig Sekunden. Lassen Sie diese Seite geöffnet.",
    "ia.apercu_vide": "Hier erscheint Ihr Poster.",
    "ia.deplacer_ligne": "Ziehen, um die Zeile zu verschieben",
    "ia.apercu_alt": "Vorschau des erstellten Posters",
    "ia.filigrane_note":
      "Das Wasserzeichen verschwindet nach der Bezahlung auf dem gedruckten Poster.",
    "ia.err.indisponible":
      "Die Postererstellung ist derzeit nicht verfügbar. Versuchen Sie es in ein paar Minuten erneut oder schreiben Sie uns.",
    "ia.err.format":
      "Diese Datei ist kein erkanntes Foto. Wählen Sie eine JPEG-, PNG- oder WebP-Datei.",
    "ia.err.trop_lourde":
      "Dieses Foto ist zu groß. Nehmen Sie ein kleineres oder verkleinern Sie es vor dem Hochladen.",
    "ia.err.rafale":
      "Etwas zu viele Anfragen hintereinander. Warten Sie eine Minute und starten Sie dann erneut.",
    "ia.err.plafond":
      "Die Postererstellung ist vorübergehend ausgesetzt. Versuchen Sie es später erneut oder schreiben Sie uns.",
    "ia.err.generation":
      "Das Poster konnte nicht erstellt werden. Starten Sie erneut – beim zweiten Versuch klappt es oft. Sonst probieren Sie ein anderes Foto.",
    "ia.err.attente":
      "Das Poster dauert länger als erwartet. Starten Sie die Erstellung erneut.",
    "ia.err.inconnu":
      "Etwas ist schiefgelaufen. Starten Sie die Erstellung erneut.",
    "ia.relais.ouvrir": "Foto vom Handy senden",
    "ia.relais.ouvrir_aide":
      "Ist Ihr Foto auf Ihrem Handy? Scannen Sie einen Code – es erscheint hier.",
    "ia.relais.code_stand_aide":
      "Um den Code anzuzeigen, geben Sie zuerst den Stand-Code ein. Das Tablet merkt ihn sich danach.",
    "ia.relais.preparation": "Code wird vorbereitet…",
    "ia.relais.scanner": "Scannen Sie diesen Code mit der Kamera Ihres Handys",
    "ia.relais.ou_adresse": "oder öffnen Sie diese Adresse:",
    "ia.relais.attente": "Warten auf das Foto…",
    "ia.relais.reste": "Code noch {minutes} Min. gültig",
    "ia.relais.recue": "Foto vom Handy erhalten.",
    "ia.relais.recue_aide":
      "Nicht das richtige? Tippen Sie auf die Schaltfläche unten und senden Sie dann ein anderes von derselben Seite auf dem Handy.",
    "ia.relais.autre": "Weiteres Foto empfangen",
    "ia.relais.expire": "Dieser Code ist abgelaufen. Fordern Sie einen neuen an.",
    "ia.relais.nouveau_code": "Neuer Code",
    "ia.relais.annuler": "Abbrechen",
    "ia.relais.fermer": "Schließen",
    "ia.relais.reessayer": "Erneut versuchen",
    "ia.relais.injoignable":
      "Der Code konnte nicht erstellt werden. Prüfen Sie die Verbindung und versuchen Sie es erneut.",
    "ia.relais.rafale":
      "Zu viele Codes nacheinander angefordert. Bitte warten Sie einige Minuten.",
    "ia.relais.qr": "QR-Code der Seite zum Senden des Fotos",
    "ia.relais.nom_photo": "Foto vom Handy",

    "photo.meta_titre": "Ihr Foto senden | Memory Line",
    "photo.titre": "Senden Sie Ihr Foto",
    "photo.intro":
      "Es erscheint sofort auf dem Tablet am Stand, um Ihr Poster zu gestalten.",
    "photo.verification": "Code wird geprüft…",
    "photo.choisir": "Foto aufnehmen oder auswählen",
    "photo.preparation": "Foto wird vorbereitet…",
    "photo.envoi": "Wird gesendet… {pourcent} %",
    "photo.envoyee": "Gesendet! Schauen Sie auf das Tablet.",
    "photo.envoyee_autre": "Gesendet! Bitten Sie am Stand darum, es auf dem Tablet zu empfangen.",
    "photo.autre": "Ein anderes Foto senden",
    "photo.autre_aide":
      "Ein anderes Foto? Senden Sie es und bitten Sie dann am Stand darum, es auf dem Tablet zu empfangen.",
    "photo.apercu_alt": "Das ausgewählte Foto",
    "photo.code_inconnu":
      "Dieser Code gehört zu keiner laufenden Übertragung. Prüfen Sie die Adresse auf dem Tablet.",
    "photo.code_expire":
      "Dieser Code ist abgelaufen. Fordern Sie am Tablet einen neuen Code an.",
    "photo.err.rafale":
      "Zu viele Sendungen nacheinander. Bitte warten Sie einige Minuten und versuchen Sie es dann erneut.",
    "photo.err.reseau":
      "Das Senden ist fehlgeschlagen. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.",


    "panier.titre": "Ihr Warenkorb",
    "panier.vide": "Ihr Warenkorb ist leer.",
    "panier.continuer": "Weiter einkaufen",
    "panier.commander": "Zur Kasse",
    "panier.total": "Gesamt",
    "panier.quantite": "Menge",
    "panier.modifier": "Bearbeiten",
    "panier.supprimer": "Entfernen",
    "panier.chargement": "Warenkorb wird geladen…",
    "panier.erreur": "Warenkorb konnte nicht geladen werden",
    "livraison.cp_recherche": "PLZ",
    "livraison.chercher": "Suchen",
    "livraison.me_localiser": "Meinen Standort verwenden",
    "livraison.localisation_en_cours": "Standort wird ermittelt…",
    "livraison.ma_position": "In meiner Nähe",
    "livraison.position_refusee":
      "Der Standortzugriff wurde nicht erlaubt. Bitte geben Sie Ihre Adresse oder Postleitzahl ein.",
    "livraison.position_introuvable":
      "Ihr Standort konnte nicht ermittelt werden. Bitte geben Sie Ihre Adresse oder Postleitzahl ein.",
    "livraison.recherche_en_cours": "Suche nach Standorten in Ihrer Nähe…",
    "livraison.aucun_relais": "Kein Standort für diese PLZ gefunden.",
    "livraison.relais_indisponible": "Suche derzeit nicht verfügbar.",
    "livraison.relais_choisi": "Gewählter Standort:",
    "livraison.horaires": "Öffnungszeiten",
    "livraison.adresse_recherche": "Ihre Adresse oder Postleitzahl",
    "livraison.titre": "Versand",
    "livraison.pays": "Land",
    "livraison.adresse": "Adresse",
    "livraison.complement": "Adresszusatz",
    "livraison.code_postal": "PLZ",
    "livraison.ville": "Stadt",
    "livraison.telephone": "Telefon",
    "livraison.code_postal_invalide": "Diese Postleitzahl passt nicht zu diesem Land.",
    "livraison.telephone_invalide": "Diese Telefonnummer scheint ungültig zu sein.",
    "livraison.ou_nous_trouver": "Hier finden Sie uns:",
    "livraison.stand_ouvert": "Jetzt geöffnet",
    "livraison.stand_ferme": "Gerade geschlossen",
    "livraison.stand_periode": "Vom {du} bis {au}",
    "livraison.jour_ferme": "Geschlossen",
    "livraison.aujourdhui": "Heute",
    "livraison.a_heure": "um {heure}",
    "livraison.stand_compris": "Ich habe verstanden, dass ich meine Bestellung **spätestens am {date} mit meinem Personalausweis am Stand abholen muss.**",
    "livraison.stand_identite": "Bei der Abholung wird ein Personalausweis verlangt.",
    "livraison.stand_compris_requis": "Bitte kreuzen Sie das Kästchen an: Sie holen Ihre Bestellung vor Schließung des Stands ab.",
    "livraison.point_relais": "Paketshop",
    "livraison.point_relais_aide":
      "Geben Sie Namen und Adresse Ihres Mondial-Relay-Paketshops an.",
    "livraison.offerte": "Kostenlos",
    "livraison.aucune": "Für dieses Land ist kein Versand verfügbar.",
    "livraison.poids_colis": "Paketgewicht:",
    "livraison.aucune_pour_ce_poids":
      "Für dieses Gewicht gibt es in dieses Land keine Versandart — schreiben Sie uns.",
    "panier.code": "Rabattcode",
    "panier.code_appliquer": "Anwenden",
    "panier.code_applique": "Code angewendet:",
    "panier.code_retirer": "Entfernen",
    "panier.code_refuse": "Dieser Code ist ungültig.",
    "accueil.tout_afficher": "Alle ansehen",
    "lettre.email": "E-Mail",
    "lettre.envoyer": "Abonnieren",
    "lettre.merci": "Danke! Sie sind angemeldet.",
    "lettre.erreur": "Anmeldung derzeit nicht möglich.",
    "panier.produit": "Produkt",
    "panier.total_ligne": "Gesamt",
    "panier.total_estime": "Geschätzte Summe",
    "panier.taxes":
      "Keine Mehrwertsteuer (französische Kleinunternehmerregelung). Rabatte und Versand werden an der Kasse berechnet.",
    "panier.payer": "Zur Kasse gehen",
    "panier.format": "Format",
    "panier.cadre": "Rahmen",
    "panier.sans_cadre": "Ohne Rahmen",
    "panier.cadres_retires":
      "Rahmen sind auf der Website derzeit nicht erhältlich: Wir haben sie aus Ihrem Warenkorb entfernt und den Preis neu berechnet.",
    "panier.personnage": "Figur",
    "panier.personnages": "Figuren",
    "panier.retirer_ligne": "Dieses Poster entfernen",
    "panier.moins": "Menge verringern",
    "panier.plus": "Menge erhöhen",
    "panier.sous_total": "Zwischensumme",

    "commande.titre": "Ihre Bestellung",
    "commande.stand.titre": "Dieser Browser ist im Standmodus",
    "commande.stand.texte": "Am Stand wird nicht online bestellt: Der Kunde bezahlt vor Ort, und der Warenkorb wird auf der Warenkorbseite bestätigt. Um in diesem Browser auf der Website zu bestellen, verlassen Sie den Standmodus.",
    "commande.stand.quitter": "Standmodus verlassen und bestellen",
    "commande.stand.panier": "Zurück zum Warenkorb des Stands",
    "commande.nom": "Name",
    "commande.email": "E-Mail",
    "commande.payer": "Bezahlen",
    "commande.paiement_en_cours": "Zahlung wird verarbeitet…",
    "commande.paiement_indisponible":
      "Die Online-Zahlung ist vorübergehend nicht verfügbar. Ihr Warenkorb bleibt gespeichert: Bitte versuchen Sie es gleich noch einmal.",
    "bandeau.region": "Ankündigungen",
    "bandeau.precedent": "Vorherige Nachricht",
    "bandeau.suivant": "Nächste Nachricht",
    "bandeau.pause": "Ankündigungen anhalten",
    "bandeau.lecture": "Ankündigungen fortsetzen",
    "bandeau.position": "{n} von {total}",
    "bandeau.carrousel": "Karussell",
    "bandeau.message": "Nachricht",

    "stand.titre": "Ihre Poster",
    "stand.ajouter": "Weiteres Poster hinzufügen",
    "stand.code": "Stand-Code",
    "stand.code_aide":
      "Einmal vom Standpersonal eingegeben: Das Tablet merkt ihn sich.",
    "stand.code_valider": "Code bestätigen",
    "stand.code_verification": "Code wird geprüft…",
    "stand.code_vide": "Bitte den Stand-Code eingeben.",
    "stand.code_refuse":
      "Dieser Code gehört zu keinem geöffneten Stand. Prüfen Sie ihn oder öffnen Sie den Stand im Backoffice.",
    "stand.code_perime":
      "Der auf diesem Tablet gespeicherte Code gehört zu keinem geöffneten Stand mehr. Bitte den heutigen Code eingeben.",
    "stand.code_injoignable":
      "Der Stand antwortet nicht. Prüfen Sie die Verbindung und versuchen Sie es erneut.",
    "stand.nom": "Ihr Name",
    "stand.email": "Ihre E-Mail-Adresse",
    "stand.nom_vide": "Bitte geben Sie Ihren Namen ein.",
    "stand.email_invalide": "Diese E-Mail-Adresse ist unvollständig.",
    "stand.valider_une": "Mein Poster bestätigen",
    "stand.valider_plusieurs": "Meine Poster bestätigen",
    "stand.envoi": "Wird gespeichert…",
    "stand.erreur":
      "Die Bestellung konnte nicht gespeichert werden. Bitte erneut versuchen.",
    "stand.merci": "Ihre Bestellung ist bestätigt, Sie können sich jetzt an den Verkäufer wenden",
    "stand.revenir": "Zurück zu meiner Bestellung",
    "stand.revenir_erreur": "Die Bestellung konnte nicht wieder geöffnet werden. Bitte wenden Sie sich an den Verkäufer.",
    "stand.numero": "Bestellnummer",
    "stand.suivant": "Nächster Kunde",

    "cookies.texte":
      "Diese Website speichert in Ihrem Browser nur, was Warenkorb und Einstellungen brauchen. Keine Reichweitenmessung, keine Werbe-Tracker.",
    "cookies.politique": "Unsere Cookie-Richtlinie ansehen",
    "cookies.accepter": "Zustimmen",
    "cookies.refuser": "Ablehnen",

    "cfg.titre": "Gestalten Sie Ihr Poster",
    "cfg.fermer": "Schließen",
    "cfg.etape.fond": "Hintergrund & Text",
    "cfg.etape.personnages": "Figuren",
    "cfg.etape.format": "Format",
    "cfg.ligne1_champ": "Zeile 1",
    "cfg.ligne2_champ": "Zeile 2",
    "cfg.ligne3_champ": "Zeile 3",
    "cfg.ligne1_exemple": "MERS-LES-BAINS",
    "cfg.ligne2_exemple": "das blaue Haus",
    "cfg.ligne3_exemple": "Sommer 2019",
    "cfg.quantite": "Anzahl der Exemplare",
    "cfg.quantite_moins": "Ein Exemplar weniger",
    "cfg.quantite_plus": "Ein Exemplar mehr",
    "cfg.couleur_texte": "Textfarbe",
    "cfg.fond": "Hintergrund",
    "cfg.personnages": "Figuren",
    "cfg.nouveau_perso": "+ Figur hinzufügen",
    "cfg.modifier": "Bearbeiten",
    "cfg.retirer": "Entfernen",
    "cfg.monter": "Nach oben",
    "cfg.descendre": "Nach unten",
    "cfg.retour": "Zurück",
    "cfg.continuer": "Weiter",
    "cfg.chargement_apercu": "Poster wird geladen…",
    "cfg.valider_affiche": "Poster bestätigen",
    "cfg.enregistrement_en_cours": "Ihr Poster wird gespeichert…",
    "cfg.valider_perso": "Figur bestätigen",
    "cfg.personnalisation": "PERSONALISIERUNG",
    "cfg.previsualisation": "VORSCHAU",
    "cfg.choix_perso": "Figur wählen",
    "cfg.choix_couleur": "FARBE",
    "cfg.vetements": "Oberteil",
    "cfg.pantalon": "Hose",
    "cfg.coupes": "Frisuren",
    "cfg.accessoires": "Accessoires",
    "cfg.aucun": "Keine",
    "cfg.reordonner_aide": "Ziehen, um die Reihenfolge der Figuren zu ändern",
    "cfg.dupliquer": "Diese Figur duplizieren",
    "cfg.cadre": "Rahmen (optional)",
    "cfg.sans_cadre": "Ohne Rahmen",
    "cfg.chargement": "Konfigurator wird geladen…",
    "cfg.erreur":
      "Der Konfigurator konnte nicht geladen werden. Bitte laden Sie die Seite neu oder versuchen Sie es gleich noch einmal.",

    /* La pilule « ▶ Tuto » de la personnalisation et sa pop-up (ProductConfigurator.tsx).
       Ces textes ne sont qu'un REPLI : la marchande peut écrire les siens au
       back-office, ils passent devant. */
    "cfg.video.titre": "Wie funktioniert das?",
    "cfg.video.lancer": "Video abspielen",
    "cfg.video.bulle": "Hilfe",

    "nav.compte": "Konto",

    "compte.titre": "Mein Konto",
    "compte.menu.commandes": "Meine Bestellungen",
    "compte.menu.adresses": "Meine Adressen",
    "compte.menu.infos": "Meine Daten",
    "compte.deconnexion": "Abmelden",
    "compte.email": "E-Mail",
    "compte.mdp": "Passwort",
    "compte.mdp_afficher": "Anzeigen",
    "compte.mdp_masquer": "Verbergen",
    "compte.mdp_confirmer": "Passwort bestätigen",
    "compte.prenom": "Vorname",
    "compte.nom": "Nachname",
    "compte.telephone": "Telefon",
    "compte.marketing":
      "Ich möchte Neuigkeiten und Angebote von Memory Line per E-Mail erhalten.",
    "compte.langue_courriels": "Sprache meiner E-Mails",
    "compte.langue_courriels_aide":
      "In dieser Sprache schreiben wir Ihnen: Bestellbestätigung, Versand, Rechnung …",
    "compte.article": "Artikel",
    "compte.articles": "Artikel",
    "compte.mdp_aide": "Mindestens 8 Zeichen.",

    "compte.connexion.titre": "Anmelden",
    "compte.connexion.intro":
      "Melden Sie sich an, um Ihre Bestellungen zu verfolgen und Ihre Adressen wiederzufinden.",
    "compte.connexion.bouton": "Anmelden",
    "compte.connexion.oubli": "Passwort vergessen?",
    "compte.connexion.pas_de_compte": "Sie haben noch kein Konto?",
    "compte.connexion.creer": "Konto erstellen",

    "compte.inscription.titre": "Konto erstellen",
    "compte.inscription.intro":
      "Mit einem Konto verfolgen Sie Ihre Bestellungen und müssen Ihre Adressen nicht erneut eingeben.",
    "compte.inscription.bouton": "Mein Konto erstellen",
    "compte.inscription.deja": "Sie haben bereits ein Konto?",

    "compte.commandes.titre": "Meine Bestellungen",
    "compte.commandes.vide": "Sie haben noch keine Bestellung aufgegeben.",
    "compte.commandes.decouvrir": "Poster entdecken",
    "compte.commandes.numero": "Bestellung",
    "compte.commandes.voir": "Details ansehen",
    "compte.commandes.suivre": "Sendung verfolgen",
    "compte.commandes.retour": "Zurück zu meinen Bestellungen",

    "compte.commande.paiement": "Zahlung",
    "compte.commande.traitement": "Bearbeitung",
    "compte.commande.adresse": "Lieferadresse",
    "compte.commande.articles": "Artikel",
    "compte.commande.expeditions": "Sendungen",
    "compte.commande.sous_total": "Zwischensumme",
    "compte.commande.remise": "Rabatt",
    "compte.commande.port": "Versand",
    "compte.commande.total": "Gesamt",
    "compte.commande.rembourse": "Erstattet",
    "compte.commande.quantite": "Menge",
    "compte.commande.introuvable": "Diese Bestellung wurde nicht gefunden.",
    "compte.commande.sans_suivi": "Noch keine Sendungsnummer.",

    "compte.statut.financier.pending": "Zahlung ausstehend",
    "compte.statut.financier.authorized": "Zahlung autorisiert",
    "compte.statut.financier.partially_paid": "Teilweise bezahlt",
    "compte.statut.financier.paid": "Bezahlt",
    "compte.statut.financier.partially_refunded": "Teilweise erstattet",
    "compte.statut.financier.refunded": "Erstattet",
    "compte.statut.financier.voided": "Storniert",

    "compte.statut.expedition.unfulfilled": "Nicht versandt",
    "compte.statut.expedition.partially_fulfilled": "Teilweise versandt",
    "compte.statut.expedition.fulfilled": "Versandt",
    "compte.statut.expedition.delivered": "Zugestellt",
    "compte.statut.expedition.cancelled": "Storniert",

    "compte.adresses.titre": "Meine Adressen",
    "compte.adresses.vide": "Sie haben noch keine Adresse gespeichert.",
    "compte.adresses.nouvelle": "Neue Adresse",
    "compte.adresses.modifier": "Bearbeiten",
    "compte.adresses.supprimer": "Löschen",
    "compte.adresses.enregistrer": "Speichern",
    "compte.adresses.annuler": "Abbrechen",
    "compte.adresses.libelle": "Name der Adresse (Zuhause, Büro…)",
    "compte.adresses.defaut_livraison": "Als Standard-Lieferadresse verwenden",
    "compte.adresses.defaut_facturation":
      "Als Standard-Rechnungsadresse verwenden",
    "compte.adresses.badge_livraison": "Standard-Lieferadresse",
    "compte.adresses.badge_facturation": "Standard-Rechnungsadresse",

    "compte.infos.titre": "Meine Daten",
    "compte.infos.enregistrer": "Speichern",
    "compte.infos.enregistre": "Ihre Daten wurden gespeichert.",
    "compte.infos.mdp_titre": "Passwort ändern",
    "compte.infos.mdp_ancien": "Aktuelles Passwort",
    "compte.infos.mdp_nouveau": "Neues Passwort",
    "compte.infos.mdp_confirmer": "Neues Passwort bestätigen",
    "compte.infos.mdp_bouton": "Passwort ändern",
    "compte.infos.mdp_change": "Ihr Passwort wurde geändert.",

    "compte.oubli.titre": "Passwort vergessen",
    "compte.oubli.intro":
      "Geben Sie Ihre E-Mail-Adresse an: Wir senden Ihnen einen Link, um ein neues Passwort zu wählen.",
    "compte.oubli.bouton": "Link senden",
    "compte.oubli.envoye":
      "Falls ein Konto zu dieser Adresse besteht, ist gerade eine E-Mail unterwegs. Schauen Sie auch in den Spam-Ordner.",
    "compte.oubli.retour": "Zurück zur Anmeldung",

    "compte.reinit.titre": "Neues Passwort",
    "compte.reinit.intro": "Wählen Sie das neue Passwort für Ihr Konto.",
    "compte.reinit.bouton": "Neues Passwort speichern",
    "compte.reinit.ok":
      "Ihr Passwort wurde geändert. Sie können sich jetzt anmelden.",
    "compte.reinit.lien_incomplet":
      "Dieser Link ist unvollständig. Fordern Sie über die Anmeldeseite einen neuen an.",

    "compte.err.indisponible":
      "Der Kundenbereich ist derzeit nicht verfügbar. Bitte versuchen Sie es gleich noch einmal.",
    "compte.err.identifiants": "E-Mail-Adresse oder Passwort ist falsch.",
    "compte.err.deja_inscrit":
      "Mit dieser E-Mail-Adresse besteht bereits ein Konto.",
    "compte.err.mdp_court": "Das Passwort muss mindestens 8 Zeichen lang sein.",
    "compte.err.mdp_different": "Die beiden Passwörter stimmen nicht überein.",
    "compte.err.mdp_actuel": "Das aktuelle Passwort ist falsch.",
    "compte.err.jeton":
      "Dieser Link ist nicht mehr gültig. Bitte fordern Sie einen neuen an.",
    "compte.err.champs": "Bitte füllen Sie die Pflichtfelder aus.",
    "compte.err.generique":
      "Es ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut.",
    // Textes sortis du code en dur (octobre 2026).
    "cfg.precedent": "Zurückblättern",
    "cfg.suivant": "Weiterblättern",
    "defiler.haut": "Nach oben blättern",
    "defiler.bas": "Nach unten blättern",
    "cfg.couleur_perso": "Eigene Farbe",
    "cfg.remettre_couleurs": "Ursprüngliche Farben wiederherstellen",
    "cfg.remettre_couleurs_de": "Ursprüngliche Farben wiederherstellen: {partie}",
    "cfg.couleur_actuelle": "Aktuelle Farbe: {couleur}",
    "cfg.autres": "Sonstige",
    "cfg.personnage_n": "Figur {id}",
    "cfg.personnage": "Figur",
    "cfg.deplacer_aide":
      "{nom}: Ziehen Sie die Figur, um sie auf dem Poster zu verschieben, oder verwenden Sie die Pfeiltasten",
    "cfg.exemple_affiche": "Ihre Stadt, Ihre Geschichte",
    "cfg.apercu_cadre": "Postervorschau mit Rahmen: {cadre}",
    "cfg.apercu_cadre_sans_nom": "Postervorschau mit Rahmen",
    "cfg.ligne_n": "Zeile {n}",
    "cfg.personnaliser_perso": "Diese Figur gestalten",
    "cfg.police.serif": "Klassisch",
    // Pas « Kräftig » : c'est aussi un nom de graisse allemand (Futura
    // Kräftig), la pastille se lirait « Klassisch, en plus gras ».
    "cfg.police.abril": "Markant",
    "cfg.police.shabby": "Handschrift",
    "cfg.couleur.blanc": "Weiß",
    "cfg.couleur.anthracite": "Anthrazitgrau",
    "commande.modifier_panier": "Warenkorb bearbeiten",
    "commande.merci_titre": "Vielen Dank!",
    "commande.merci_texte": "Ihre Zahlung ist eingegangen und Ihre Bestellung ist bestätigt.",
    "commande.numero": "Bestellnummer:",
    "commande.retour.verification": "Wir prüfen Ihre Zahlung bei Ihrer Bank…",
    "commande.retour.en_cours_titre": "Zahlung wird geprüft",
    "commande.retour.en_cours_texte":
      "Ihre Bank hat die Zahlung noch nicht bestätigt. Sie erhalten eine E-Mail, sobald sie bestätigt ist: Bitte zahlen Sie nicht ein zweites Mal.",
    "commande.retour.ecart_texte":
      "Ihre Zahlung ist eingegangen, aber der Betrag stimmt nicht mit Ihrer Bestellung überein. Der Shop meldet sich per E-Mail bei Ihnen, um das zu klären: Bitte nicht ein zweites Mal bezahlen.",
    "commande.retour.refuse":
      "Die Zahlung wurde abgelehnt oder nicht abgeschlossen. Ihr Warenkorb bleibt erhalten: Prüfen Sie Ihre Lieferangaben und versuchen Sie es dann mit derselben oder einer anderen Zahlungsart erneut.",
    "commande.retour.injoignable":
      "Wir konnten Ihre Zahlung gerade nicht prüfen. Laden Sie die Seite gleich neu; falls der Betrag abgebucht wurde, zahlen Sie bitte nicht ein zweites Mal und schreiben Sie uns.",
    "commande.coordonnees": "Ihre Kontaktdaten",
    "commande.email_compte":
      "Das ist die E-Mail-Adresse Ihres Kontos. Um sie zu ändern, gehen Sie zu „Meine Daten“.",
    "commande.email_invalide": "Ungültige E-Mail-Adresse.",
    "livraison.autre_pays": "Anderes Land",
    "livraison.ou_retirer": "Wo möchten Sie Ihre Bestellung abholen?",
    "livraison.carnet": "Ihre gespeicherten Adressen",
    "livraison.autre_adresse": "Andere Adresse",
    "livraison.adresse_exemple": "Bahnhofstraße 12",
    "livraison.complement_exemple": "Gebäude B, 3. Stock",
    "livraison.relais_numero": "(Nr. {code})",
    "livraison.carte": "Karte der Paketshops",
    "livraison.relais_plus_disponible":
      "Dieser Paketshop ist nicht mehr verfügbar. Bitte wählen Sie einen anderen aus der Liste.",
    "commande.essai.titre": "Shop im Testmodus: Es wird keine echte Zahlung ausgeführt.",
    "commande.essai.carte_libelle": "Kreditkarte:",
    "commande.essai.carte":
      "4242 4242 4242 4242, ein beliebiges Datum in der Zukunft, drei beliebige Ziffern auf der Rückseite und eine beliebige Postleitzahl.",
    "commande.essai.paypal_libelle": "PayPal:",
    "commande.essai.paypal":
      "Melden Sie sich mit dem Test-Käuferkonto an, nicht mit Ihrem eigenen. Sie finden es auf developer.paypal.com unter „Testing Tools“ und dann „Sandbox accounts“, mit der Endung {domaine}.",
    "commande.carte": "Kreditkarte",
    "commande.preparation": "Wird vorbereitet…",
    "commande.continuer_paiement": "Weiter zur Zahlung · {total}",
    "commande.il_manque": "Um fortzufahren, fehlt noch: {liste}.",
    "commande.manque.nom": "Ihr Name",
    "commande.manque.email": "eine gültige E-Mail-Adresse",
    "commande.manque.mode": "eine Versandart",
    "commande.manque.adresse": "Ihre Lieferadresse (Straße, Postleitzahl und Ort)",
    "commande.manque.relais": "ein Paketshop",
    "commande.manque.lieu": "der Ort, an dem Sie Ihre Bestellung abholen",
    "commande.err.lieu_retrait_requis":
      "Bitte wählen Sie, wo Sie Ihre Bestellung abholen möchten. Ist der Ort gerade aus der Liste verschwunden, wählen Sie einen anderen oder eine andere Versandart.",
    "retrait.titre": "Abholort",
    "commande.manque.moyen": "eine Zahlungsart",
    "commande.modifier_coordonnees": "← Meine Kontaktdaten ändern",
    "commande.recapitulatif": "Zusammenfassung",
    "panier.affiche_sans_titre": "Personalisiertes Poster",
    "commande.qte": "Menge",
    "commande.err.panier_modifie":
      "Ihr Warenkorb hat sich seit der Berechnung der Gesamtsumme geändert. Gehen Sie einen Schritt zurück, um sie vor dem Bezahlen neu zu berechnen.",
    "commande.err.refuse": "Zahlung abgelehnt.",
    "commande.err.non_finalise": "Zahlung nicht abgeschlossen. Bitte versuchen Sie es erneut.",
    "commande.err.carte_indisponible":
      "Die Kartenzahlung ist im Moment nicht verfügbar. Bitte versuchen Sie es gleich noch einmal.",
    "commande.err.paypal_indisponible":
      "PayPal konnte nicht geladen werden. Bitte versuchen Sie es erneut oder zahlen Sie mit Karte.",
    "commande.err.paiement_reconfigure":
      "Die Zahlungsarten des Shops haben sich gerade geändert. Bitte wählen Sie Ihre Zahlungsart erneut: Es wurde nichts abgebucht.",
    "commande.err.paypal_ouverture":
      "Die PayPal-Zahlung konnte nicht gestartet werden. Versuchen Sie es mit Karte oder kommen Sie in ein paar Minuten wieder.",
    "commande.err.compte_requis":
      "Um die Bestellung abzuschließen, müssen Sie angemeldet sein. Erstellen Sie Ihr Konto oder melden Sie sich an – Ihr Warenkorb wartet auf Sie.",
    "commande.err.generique":
      "Ihre Bestellung konnte nicht vorbereitet werden. Bitte prüfen Sie Ihre Angaben und versuchen Sie es erneut.",
    "commande.err.technique":
      "Ein technisches Problem hat uns daran gehindert, Ihre Bestellung zu bestätigen. Es wurde nichts abgebucht und Ihr Warenkorb bleibt erhalten: Bitte versuchen Sie es gleich noch einmal.",
    "commande.err.paiement":
      "Die Zahlung konnte nicht bestätigt werden. Bitte versuchen Sie es erneut oder schreiben Sie uns, falls der Betrag abgebucht wurde.",
    "ponct.deux_points": ": ",
    "ponct.guillemets": "„{texte}“",
    "panier.pastille": "Artikel im Warenkorb: {nombre}",
    "panier.err.ajout":
      "Das Poster konnte nicht in den Warenkorb gelegt werden. Bitte versuchen Sie es gleich noch einmal.",
    "panier.err.config":
      "Ihr Poster konnte nicht in den Warenkorb gelegt werden. Bitte laden Sie die Seite neu und versuchen Sie es erneut.",
    "accueil.vitrine_titre": "Unsere Bestseller ❤️",
    "accueil.vitrine_texte":
      "- Wählen Sie Ihren Hintergrund\n- Personalisieren Sie Ihren Text\n- Wählen Sie Ihre Figuren und personalisieren Sie sie\nIhr Poster in 2 Minuten fertig!",
    "accueil.ia_titre": "Ihr Foto als Poster",
    "accueil.ia_texte":
      "Senden Sie uns ein Foto — ein Haus, einen Strand, eine Straße, eine Erinnerung — und erhalten Sie es im Memory-Line-Stil illustriert zurück. Sie sehen das Ergebnis, bevor Sie bestellen.",
    "accueil.ia_bouton": "Mit meinem Foto ausprobieren",
    "accueil.lettre_titre": "Abonnieren Sie unseren Newsletter",
    "produit.meta_repli.personnalisable":
      "{nom}: personalisiertes Poster zum Online-Gestalten. Fügen Sie in wenigen Minuten Ihre Figuren und Ihren Text hinzu. Druck in A4 oder A3.",
    "produit.meta_repli.prete_a_imprimer":
      "{nom}: druckfertiges Dekoposter für Ihr Zuhause oder als Geschenk. Druck in A4 oder A3.",
    "seo.fil_accueil": "Startseite",
    "seo.nature.personnalisable": "Personalisiertes Poster",
    "seo.nature.prete_a_imprimer": "Druckfertiges Poster",
    "seo.natures.personnalisable": "Personalisierte Poster",
    "seo.natures.prete_a_imprimer": "Druckfertige Poster",
    "seo.natures.mixte": "Poster",
    "seo.page_n": "Seite {n}",
    "seo.titre.catalogue": "Alle Poster: Städte, Landschaften, Themen",
    "seo.titre.personnalisable": "Personalisierte Poster online gestalten",
    "seo.titre.prete_a_imprimer": "Druckfertige Dekoposter",
    "seo.description.catalogue":
      "Alle Poster von Memory Line: personalisierte Städte- und Landschaftsposter und druckfertige Dekoposter. Druck in A4 oder A3.",
    "seo.description.personnalisable":
      "Gestalten Sie Ihr personalisiertes Poster: Wählen Sie eine Stadt oder Landschaft, fügen Sie Ihre Figuren und Ihren Text hinzu. Druck in A4 oder A3.",
    "seo.description.prete_a_imprimer":
      "Druckfertige Dekoposter: Städte, Regionen und Sprüche für Ihr Zuhause oder als Geschenk. Druck in A4 oder A3.",
    "seo.description.rayon.personnalisable":
      "{rayon}: personalisierte Poster zum Online-Gestalten. Fügen Sie Ihre Figuren und Ihren Text hinzu. Druck in A4 oder A3.",
    "seo.description.rayon.prete_a_imprimer":
      "{rayon}: druckfertige Dekoposter für Ihr Zuhause oder als Geschenk. Druck in A4 oder A3.",
    "seo.description.rayon.mixte":
      "{rayon}: Poster von Memory Line, personalisiert oder druckfertig, für Ihr Zuhause oder als Geschenk. Druck in A4 oder A3.",
    "accueil.h1": "Personalisierte Poster von Städten und Landschaften",
    "produit.description_titre": "Über dieses Poster",
    "produit.fil_ariane": "Brotkrümelnavigation",
    "produit.voisines.titre_rayon": "Aus derselben Kollektion",
    "produit.voisines.titre_genre": "Das könnte Ihnen auch gefallen",
    "produit.voisines.voir_tout": "Alles aus „{rayon}“ ansehen",
    "compte.essai.titre": "Testseite.",
    "compte.essai.avant":
      "Dieses Konto ist zufällig vorausgefüllt, damit Sie nichts eintippen müssen. Passwort:",
    "compte.essai.apres":
      "— notieren Sie sich die E-Mail-Adresse, wenn Sie sich später wieder damit anmelden möchten. Diesen Hinweis und das Vorausfüllen gibt es in der Produktivumgebung nicht.",
    "panier.recuperer.titre": "Ihr Warenkorb wartet auf Sie",
    "panier.recuperer.intro": "Wir stellen ihn wieder her und bringen Sie dann zur Kasse.",
    "panier.recuperer.article_indisponible": "dieses Poster ist nicht mehr erhältlich",
    "panier.recuperer.code": "Ihr Rabattcode {code} wurde übernommen.",
    "panier.recuperer.bouton": "Meine Bestellung fortsetzen",
    "panier.recuperer.sans_js":
      "Ihr Browser führt kein JavaScript aus, daher können wir Ihren Warenkorb nicht wiederherstellen. Antworten Sie einfach auf die E-Mail, die Sie erhalten haben — wir schließen die Bestellung gemeinsam mit Ihnen ab.",
    "panier.recuperer.voir_affiches": "Poster ansehen",
    "panier.recuperer.jeton_inconnu.titre": "Dieser Link ist nicht mehr gültig",
    "panier.recuperer.jeton_inconnu.texte":
      "Wir erkennen diesen Link nicht. Vielleicht hat Ihr E-Mail-Programm ihn in zwei Teile getrennt, oder Ihr Warenkorb wurde auf einem anderen Gerät bezahlt.",
    "panier.recuperer.deja_payee.titre": "Diese Bestellung ist bereits bezahlt",
    "panier.recuperer.deja_payee.texte":
      "Gute Nachricht: Ihre Bestellung wurde bezahlt. Sie müssen nichts weiter tun, wir bereiten Ihr Poster vor.",
    "panier.recuperer.panier_clos.titre": "Dieser Warenkorb wurde geschlossen",
    "panier.recuperer.panier_clos.texte":
      "Diese Bestellung wurde storniert oder zurückerstattet. Sie kann nicht mehr fortgesetzt werden, aber Sie können gerne eine neue zusammenstellen.",
    "panier.recuperer.trop_ancien.titre": "Dieser Link ist abgelaufen",
    "panier.recuperer.trop_ancien.texte":
      "Nach vierzehn Tagen halten wir einen Warenkorb nicht mehr bereit: Unsere Preise und Poster können sich inzwischen geändert haben. Beginnen Sie im Shop einfach neu — Ihr Poster ist dort in zwei Minuten gestaltet.",
    "panier.recuperer.indisponible.titre": "Wir können Ihren Warenkorb nicht öffnen",
    "panier.recuperer.indisponible.texte":
      "Bei uns ist etwas schiefgelaufen. Versuchen Sie es gleich noch einmal, oder schreiben Sie uns, indem Sie einfach auf die erhaltene E-Mail antworten.",
    "livraison.relais_requis": "Bitte wählen Sie Ihren Paketshop aus der Liste.",
    "livraison.relais_autre_reseau":
      "Dieser Paketshop passt nicht zur gewählten Versandart. Bitte wählen Sie einen aus der Liste.",
    "commande.err.mode_indisponible":
      "Diese Versandart ist nicht mehr verfügbar. Bitte wählen Sie eine andere.",
    "commande.err.adresse_incomplete":
      "Ihre Lieferadresse ist unvollständig: Bitte prüfen Sie Straße, Postleitzahl und Ort.",
    "commande.err.avant_paiement":
      "Wir konnten Ihren Warenkorb vor der Zahlung nicht prüfen. Es wurde nichts abgebucht: Bitte versuchen Sie es gleich noch einmal.",
    "cfg.plus_bas": "Weiter unten: {parties}",
    "cfg.partie.couleurs": "Farben",
    "cfg.partie.vetements": "Kleidung",
    "cfg.partie.cheveux": "Haare",
    "cfg.partie.accessoires": "Accessoires",
  },

  it: {
    "nav.accueil": "Memory Line — home",
    "nav.menu": "Menu",
    "stand.mode": "Modalità stand",
    "stand.ferme": "Stand chiuso: nessuna vendita può essere convalidata.",
    "nav.affiches": "Poster",
    "nav.personnalisables": "Poster personalizzabili",
    "nav.tout_voir": "Vedi tutto",
    "nav.villes": "Città",
    "nav.themes_paysages": "Temi e paesaggi",
    "nav.pretes": "Poster pronti da stampare",
    "nav.panier": "Carrello",
    "nav.creer": "Crea il mio poster",
    "nav.langue": "Lingua",

    "pied.droits": "Memory Line — Poster personalizzati",
    "pied.credit.avant": "Creato con",
    "pied.credit.apres": "da",
    "pied.baseline": "Il tuo poster pronto in 2 minuti.",

    "meta.titre": "Memory Line | Poster personalizzati di città e paesaggi",
    "meta.description":
      "Poster personalizzati di città, paesaggi e temi. Crea il tuo in pochi minuti, stampato in A4 o A3.",

    "accueil.surtitre": "Poster personalizzati",
    "accueil.titre": "La tua città, la tua storia, su un muro.",
    "accueil.soustitre":
      "Scegli uno sfondo, personalizza il titolo, aggiungi i tuoi personaggi. Il tuo poster pronto in 2 minuti — stampato in A4 o A3.",
    "accueil.cta": "Scopri i poster",
    "accueil.stat.affiches": "Poster",
    "accueil.stat.collections": "Collezioni",

    "catalogue.titre": "Tutti i poster",
    "catalogue.compte": "poster · città, paesaggi e temi",
    "catalogue.compte_simple": "poster",
    "catalogue.compte_un": "poster",
    "catalogue.erreur": "Impossibile caricare il catalogo",
    "catalogue.vide": "Ancora nessun poster.",

    "catalogue.ville": "Luoghi",
    "catalogue.toutes_villes": "Tutti i luoghi",
    "catalogue.chercher_lieu": "Cerca un luogo…",
    "catalogue.aucun_lieu": "Nessun luogo corrispondente.",
    "catalogue.tri": "Ordina",
    "catalogue.tri.manuel": "Ordine del negozio",
    "catalogue.tri.nouveautes": "Novità",
    "catalogue.tri.prix_asc": "Prezzo crescente",
    "catalogue.tri.prix_desc": "Prezzo decrescente",
    "catalogue.tri.alpha": "Dalla A alla Z",
    "catalogue.trier_bouton": "Applica",
    "catalogue.page": "Pagina",
    "catalogue.page_sur": "di",
    "catalogue.precedente": "Precedente",
    "catalogue.suivante": "Successiva",
    "recherche.titre": "Cerca",
    "recherche.champ": "Cerca un poster",
    "recherche.bouton": "Cerca",
    "recherche.invite": "Cerca una città, un luogo, un tema.",
    "recherche.trop_court": "Digita almeno due lettere.",
    "recherche.resultat": "poster trovato",
    "recherche.resultats": "poster trovati",
    "recherche.aucun": "Nessun poster corrisponde a questa ricerca.",
    "recherche.conseil":
      "Controlla l'ortografia, oppure prova con il nome di una città.",
    "recherche.tout_voir": "Vedi tutti i poster",
    "recherche.instant.preciser": "{n} poster corrispondono: affina la ricerca per vedere gli altri.",
    "recherche.instant.fermer": "Chiudi",
    "recherche.instant.cherche": "Ricerca…",
    "promo.ancien_prix": "Prezzo precedente",
    "promo.reduction": "di sconto",
    "pied.navigation": "Il negozio",
    "pied.aide": "Aiuto e informazioni",
    "pied.instagram": "Seguici su Instagram",
    "pied.contact": "Contattaci",
    "pied.conditions": "Condizioni generali di vendita",
    "pied.mentions": "Note legali",
    "pied.confidentialite": "Informativa sulla privacy",
    "pied.cookies": "Cookie",
    "404.titre": "Questa pagina non esiste",
    "404.texte":
      "Forse l'indirizzo è stato copiato male, oppure il poster non è più in vendita.",
    "404.affiches": "Vedi tutti i poster",
    "404.recherche": "Cerca un poster",
    "404.accueil": "Torna alla home",
    "503.titre": "Pagina momentaneamente non disponibile",
    "503.texte":
      "Il sito non riesce a caricare questa pagina al momento. Riprova tra un minuto.",

    "genre.personnalisable": "Personalizzabile",
    "genre.prete_a_imprimer": "Pronto da stampare",

    "produit.format": "Formato",
    "produit.personnaliser": "Personalizza",
    "produit.aide": "Scegli lo sfondo, il testo e i tuoi personaggi.",
    "produit.ajouter": "Aggiungi al carrello",
    "produit.ajout_en_cours": "Aggiunta al carrello…",
    "produit.retour": "Torna ai poster",
    "panier.affiche_ia": "Poster creato dalla tua foto",

    "ia.titre": "Il tuo poster, dalla tua foto",
    "ia.intro":
      "Carica una foto: ne ricaviamo un poster. Guarda il risultato, rilancia quante volte vuoi e tieni quello che ti piace.",
    "ia.depot": "Trascina qui la tua foto, oppure clicca per sceglierla",
    "ia.depot_bouton": "Scegli una foto",
    "ia.depot_formats": "JPEG, PNG o WebP",
    "ia.photo_nette": "La foto deve essere nitida e luminosa.",
    "ia.orientation": "Orientamento del poster",
    "ia.portrait": "Verticale",
    "ia.paysage": "Orizzontale",
    "ia.orientation_relancer": "Crea di nuovo il poster per averlo in questo orientamento.",
    "ia.creations_titre": "Le tue creazioni ({n})",
    "ia.creations_aide":
      "Tocca un poster per rivederlo e spunta quelli da tenere: finiranno insieme nel carrello.",
    "ia.creation_n": "Creazione {n}",
    "ia.garder": "Tieni",
    "ia.ajouter_n": "Aggiungi i {n} poster al carrello",
    "ia.changer_photo": "Scegli un'altra foto",
    "ia.photo_titre": "La tua foto",
    "ia.style_titre": "Che tipo di poster?",
    "ia.style_aide":
      "Scegli lo stile che preferisci: il tuo poster sarà creato in quello spirito.",
    "ia.style_manquant": "Scegli prima uno stile, qui sopra.",
    "ia.precision": "Vuoi aggiungere qualcosa? (facoltativo)",
    "ia.precision_exemple": "Per esempio: al tramonto, con toni caldi…",
    "ia.generer": "Crea il mio poster",
    "ia.regenerer": "Crea un'altra versione",
    "ia.regenerer_aide": "Tutte le volte che vuoi, senza costi aggiuntivi.",
    "ia.recommencer": "Ricomincia da capo",
    "ia.envoi": "Caricamento della tua foto…",
    "ia.generation": "Creazione del tuo poster…",
    "ia.generation_duree":
      "Ci vuole una trentina di secondi abbondante. Lascia aperta questa pagina.",
    "ia.apercu_vide": "Il tuo poster apparirà qui.",
    "ia.deplacer_ligne": "Trascina per spostare la riga",
    "ia.apercu_alt": "Anteprima del poster creato",
    "ia.filigrane_note":
      "La filigrana sparisce dal poster stampato, dopo il pagamento.",
    "ia.err.indisponible":
      "La creazione dei poster non è disponibile al momento. Riprova tra qualche minuto, oppure scrivici.",
    "ia.err.format":
      "Questo file non è una foto riconosciuta. Scegli un JPEG, un PNG o un WebP.",
    "ia.err.trop_lourde":
      "Questa foto è troppo pesante. Scegline una più leggera, o riducila prima di caricarla.",
    "ia.err.rafale":
      "Un po' troppe richieste una dopo l'altra. Aspetta un minuto, poi rilancia.",
    "ia.err.plafond":
      "La creazione dei poster è sospesa per il momento. Riprova più tardi, oppure scrivici.",
    "ia.err.generation":
      "La creazione non è riuscita. Rilancia: spesso funziona al secondo tentativo. Altrimenti prova un'altra foto.",
    "ia.err.attente":
      "Il poster sta impiegando più tempo del previsto. Rilancia la creazione.",
    "ia.err.inconnu": "Qualcosa è andato storto. Rilancia la creazione.",
    "ia.relais.ouvrir": "Invia la foto dal tuo telefono",
    "ia.relais.ouvrir_aide":
      "La tua foto è sul telefono? Scansiona un codice: arriva qui.",
    "ia.relais.code_stand_aide":
      "Per mostrare il codice, inserisci prima il codice dello stand. Poi il tablet lo ricorda.",
    "ia.relais.preparation": "Preparazione del codice…",
    "ia.relais.scanner": "Scansiona questo codice con la fotocamera del tuo telefono",
    "ia.relais.ou_adresse": "oppure apri questo indirizzo:",
    "ia.relais.attente": "In attesa della foto…",
    "ia.relais.reste": "Codice valido ancora {minutes} min",
    "ia.relais.recue": "Foto ricevuta dal telefono.",
    "ia.relais.recue_aide":
      "Non è quella giusta? Tocca il pulsante qui sotto, poi inviane un'altra dalla stessa pagina sul telefono.",
    "ia.relais.autre": "Ricevi un'altra foto",
    "ia.relais.expire": "Questo codice è scaduto. Chiedine uno nuovo.",
    "ia.relais.nouveau_code": "Nuovo codice",
    "ia.relais.annuler": "Annulla",
    "ia.relais.fermer": "Chiudi",
    "ia.relais.reessayer": "Riprova",
    "ia.relais.injoignable":
      "Non è stato possibile creare il codice. Controlla la connessione, poi riprova.",
    "ia.relais.rafale":
      "Troppi codici richiesti di seguito. Attendi qualche minuto.",
    "ia.relais.qr": "Codice QR della pagina di invio della foto",
    "ia.relais.nom_photo": "Foto dal telefono",

    "photo.meta_titre": "Invia la tua foto | Memory Line",
    "photo.titre": "Invia la tua foto",
    "photo.intro":
      "Apparirà subito sul tablet dello stand, per creare il tuo poster.",
    "photo.verification": "Verifica del codice…",
    "photo.choisir": "Scatta o scegli una foto",
    "photo.preparation": "Preparazione della foto…",
    "photo.envoi": "Invio… {pourcent} %",
    "photo.envoyee": "Inviata! Guarda il tablet.",
    "photo.envoyee_autre": "Inviata! Chiedi allo stand di riceverla sul tablet.",
    "photo.autre": "Invia un'altra foto",
    "photo.autre_aide":
      "Un'altra foto? Inviala, poi chiedi allo stand di riceverla sul tablet.",
    "photo.apercu_alt": "La foto scelta",
    "photo.code_inconnu":
      "Questo codice non corrisponde a nessun invio in corso. Controlla l'indirizzo mostrato sul tablet.",
    "photo.code_expire":
      "Questo codice è scaduto. Chiedi un nuovo codice sul tablet.",
    "photo.err.rafale":
      "Troppi invii di seguito. Attendi qualche minuto, poi riprova.",
    "photo.err.reseau":
      "L'invio non è riuscito. Controlla la connessione, poi riprova.",


    "panier.titre": "Il tuo carrello",
    "panier.vide": "Il tuo carrello è vuoto.",
    "panier.continuer": "Continua lo shopping",
    "panier.commander": "Ordina",
    "panier.total": "Totale",
    "panier.quantite": "Quantità",
    "panier.modifier": "Modifica",
    "panier.supprimer": "Rimuovi",
    "panier.chargement": "Caricamento del carrello…",
    "panier.erreur": "Impossibile caricare il carrello",
    "livraison.cp_recherche": "CAP",
    "livraison.chercher": "Cerca",
    "livraison.me_localiser": "Usa la mia posizione",
    "livraison.localisation_en_cours": "Ricerca della posizione…",
    "livraison.ma_position": "Vicino a me",
    "livraison.position_refusee":
      "La posizione non è stata autorizzata. Inserisci il tuo indirizzo o il CAP.",
    "livraison.position_introuvable":
      "Non siamo riusciti a trovare la tua posizione. Inserisci il tuo indirizzo o il CAP.",
    "livraison.recherche_en_cours": "Ricerca dei punti vicini…",
    "livraison.aucun_relais": "Nessun punto trovato per questo CAP.",
    "livraison.relais_indisponible": "Ricerca non disponibile al momento.",
    "livraison.relais_choisi": "Punto scelto:",
    "livraison.horaires": "Orari",
    "livraison.adresse_recherche": "Il tuo indirizzo o CAP",
    "livraison.titre": "Spedizione",
    "livraison.pays": "Paese",
    "livraison.adresse": "Indirizzo",
    "livraison.complement": "Informazioni aggiuntive",
    "livraison.code_postal": "CAP",
    "livraison.ville": "Città",
    "livraison.telephone": "Telefono",
    "livraison.code_postal_invalide": "Questo CAP non sembra corretto per questo paese.",
    "livraison.telephone_invalide": "Questo numero di telefono non sembra valido.",
    "livraison.ou_nous_trouver": "Dove trovarci:",
    "livraison.stand_ouvert": "Aperto ora",
    "livraison.stand_ferme": "Chiuso al momento",
    "livraison.stand_periode": "Dal {du} al {au}",
    "livraison.jour_ferme": "Chiuso",
    "livraison.aujourdhui": "Oggi",
    "livraison.a_heure": "alle {heure}",
    "livraison.stand_compris": "Ho capito che devo ritirare il mio ordine allo stand **entro {date}, con la mia carta d'identità.**",
    "livraison.stand_identite": "Per ritirare l'ordine sarà richiesta una carta d'identità.",
    "livraison.stand_compris_requis": "Spunta la casella: ritirerai il tuo ordine allo stand prima della chiusura.",
    "livraison.point_relais": "Punto di ritiro",
    "livraison.point_relais_aide":
      "Indica nome e indirizzo del punto di ritiro Mondial Relay scelto.",
    "livraison.offerte": "Gratuita",
    "livraison.aucune": "Nessuna spedizione disponibile per questo paese.",
    "livraison.poids_colis": "Peso del pacco:",
    "livraison.aucune_pour_ce_poids":
      "Nessuna modalità di spedizione copre questo peso per questo paese: scrivici.",
    "panier.code": "Codice sconto",
    "panier.code_appliquer": "Applica",
    "panier.code_applique": "Codice applicato:",
    "panier.code_retirer": "Rimuovi",
    "panier.code_refuse": "Questo codice non è valido.",
    "accueil.tout_afficher": "Mostra tutto",
    "lettre.email": "E-mail",
    "lettre.envoyer": "Iscriviti",
    "lettre.merci": "Grazie! Iscrizione confermata.",
    "lettre.erreur": "Iscrizione non possibile al momento.",
    "panier.produit": "Prodotto",
    "panier.total_ligne": "Totale",
    "panier.total_estime": "Totale stimato",
    "panier.taxes":
      "IVA non applicabile (regime francese di franchigia). Sconti e spedizione calcolati al momento del pagamento.",
    "panier.payer": "Procedi al pagamento",
    "panier.format": "Formato",
    "panier.cadre": "Cornice",
    "panier.sans_cadre": "Senza cornice",
    "panier.cadres_retires":
      "Al momento le cornici non sono disponibili sul sito: le abbiamo rimosse dal tuo carrello e il prezzo è stato ricalcolato.",
    "panier.personnage": "personaggio",
    "panier.personnages": "personaggi",
    "panier.retirer_ligne": "Rimuovi questo poster",
    "panier.moins": "Riduci la quantità",
    "panier.plus": "Aumenta la quantità",
    "panier.sous_total": "Subtotale",

    "commande.titre": "Il tuo ordine",
    "commande.stand.titre": "Questo browser è in modalità stand",
    "commande.stand.texte": "Allo stand non si ordina online: il cliente paga sul posto e il carrello si conferma dalla pagina Carrello. Per ordinare sul sito da questo browser, esci dalla modalità stand.",
    "commande.stand.quitter": "Esci dalla modalità stand e ordina",
    "commande.stand.panier": "Torna al carrello dello stand",
    "commande.nom": "Nome",
    "commande.email": "E-mail",
    "commande.payer": "Paga",
    "commande.paiement_en_cours": "Pagamento in corso…",
    "commande.paiement_indisponible":
      "Il pagamento online è momentaneamente non disponibile. Il tuo carrello è salvato: riprova tra un attimo.",
    "bandeau.region": "Annunci",
    "bandeau.precedent": "Messaggio precedente",
    "bandeau.suivant": "Messaggio successivo",
    "bandeau.pause": "Metti in pausa gli annunci",
    "bandeau.lecture": "Riprendi lo scorrimento degli annunci",
    "bandeau.position": "{n} di {total}",
    "bandeau.carrousel": "carosello",
    "bandeau.message": "messaggio",

    "stand.titre": "I tuoi poster",
    "stand.ajouter": "Aggiungi un altro poster",
    "stand.code": "Codice dello stand",
    "stand.code_aide":
      "Inserito una volta dal personale dello stand: il tablet poi lo ricorda.",
    "stand.code_valider": "Conferma il codice",
    "stand.code_verification": "Verifica del codice…",
    "stand.code_vide": "Inserisci il codice dello stand.",
    "stand.code_refuse":
      "Questo codice non corrisponde a nessuno stand aperto. Controllalo, oppure apri lo stand dal back-office.",
    "stand.code_perime":
      "Il codice salvato su questo tablet non corrisponde più a uno stand aperto. Inserisci il codice di oggi.",
    "stand.code_injoignable":
      "Lo stand non ha risposto. Controlla la connessione e riprova.",
    "stand.nom": "Il tuo nome",
    "stand.email": "Il tuo indirizzo e-mail",
    "stand.nom_vide": "Inserisci il tuo nome.",
    "stand.email_invalide": "Questo indirizzo e-mail è incompleto.",
    "stand.valider_une": "Conferma il mio poster",
    "stand.valider_plusieurs": "Conferma i miei poster",
    "stand.envoi": "Salvataggio…",
    "stand.erreur": "Non è stato possibile salvare l'ordine. Riprova.",
    "stand.merci": "Il tuo ordine è confermato, ora puoi rivolgerti al venditore",
    "stand.revenir": "Torna al mio ordine",
    "stand.revenir_erreur": "Non è stato possibile riaprire l'ordine. Rivolgiti al venditore.",
    "stand.numero": "Numero d'ordine",
    "stand.suivant": "Cliente successivo",

    "cookies.texte":
      "Questo sito conserva nel tuo browser solo ciò che serve al carrello e alle preferenze. Nessuna misurazione del traffico, nessun tracciante pubblicitario.",
    "cookies.politique": "Consulta la nostra politica sui cookie",
    "cookies.accepter": "Accetta",
    "cookies.refuser": "Rifiuta",

    "cfg.titre": "Componi il tuo poster",
    "cfg.fermer": "Chiudi",
    "cfg.etape.fond": "Sfondo e testo",
    "cfg.etape.personnages": "Personaggi",
    "cfg.etape.format": "Formato",
    "cfg.ligne1_champ": "Riga 1",
    "cfg.ligne2_champ": "Riga 2",
    "cfg.ligne3_champ": "Riga 3",
    "cfg.ligne1_exemple": "MERS-LES-BAINS",
    "cfg.ligne2_exemple": "la casa blu",
    "cfg.ligne3_exemple": "estate 2019",
    "cfg.quantite": "Numero di copie",
    "cfg.quantite_moins": "Una copia in meno",
    "cfg.quantite_plus": "Una copia in più",
    "cfg.couleur_texte": "Colore del testo",
    "cfg.fond": "Sfondo",
    "cfg.personnages": "Personaggi",
    "cfg.nouveau_perso": "+ Aggiungi un personaggio",
    "cfg.modifier": "Modifica",
    "cfg.retirer": "Rimuovi",
    "cfg.monter": "Sposta su",
    "cfg.descendre": "Sposta giù",
    "cfg.retour": "Indietro",
    "cfg.continuer": "Continua",
    "cfg.chargement_apercu": "Caricamento del poster…",
    "cfg.valider_affiche": "Conferma il poster",
    "cfg.enregistrement_en_cours": "Salvataggio del tuo poster…",
    "cfg.valider_perso": "Conferma il personaggio",
    "cfg.personnalisation": "PERSONALIZZAZIONE",
    "cfg.previsualisation": "ANTEPRIMA",
    "cfg.choix_perso": "Scegli un personaggio",
    "cfg.choix_couleur": "COLORE",
    "cfg.vetements": "Maglia",
    "cfg.pantalon": "Pantaloni",
    "cfg.coupes": "Acconciature",
    "cfg.accessoires": "Accessori",
    "cfg.aucun": "Nessuno",
    "cfg.reordonner_aide": "Trascina per cambiare l'ordine dei personaggi",
    "cfg.dupliquer": "Duplica questo personaggio",
    "cfg.cadre": "Cornice (opzionale)",
    "cfg.sans_cadre": "Senza cornice",
    "cfg.chargement": "Caricamento del configuratore…",
    "cfg.erreur":
      "Il configuratore non si è caricato. Ricarica la pagina, oppure riprova tra qualche istante.",

    /* La pilule « ▶ Tuto » de la personnalisation et sa pop-up (ProductConfigurator.tsx).
       Ces textes ne sont qu'un REPLI : la marchande peut écrire les siens au
       back-office, ils passent devant. */
    "cfg.video.titre": "Come funziona?",
    "cfg.video.lancer": "Guarda il video",
    "cfg.video.bulle": "Guida",

    "nav.compte": "Account",

    "compte.titre": "Il mio account",
    "compte.menu.commandes": "I miei ordini",
    "compte.menu.adresses": "I miei indirizzi",
    "compte.menu.infos": "I miei dati",
    "compte.deconnexion": "Esci",
    "compte.email": "E-mail",
    "compte.mdp": "Password",
    "compte.mdp_afficher": "Mostra",
    "compte.mdp_masquer": "Nascondi",
    "compte.mdp_confirmer": "Conferma la password",
    "compte.prenom": "Nome",
    "compte.nom": "Cognome",
    "compte.telephone": "Telefono",
    "compte.marketing":
      "Desidero ricevere per e-mail le novità e le offerte di Memory Line.",
    "compte.langue_courriels": "Lingua delle mie e-mail",
    "compte.langue_courriels_aide":
      "Ti scriviamo in questa lingua: conferma dell'ordine, spedizione, fattura…",
    "compte.article": "articolo",
    "compte.articles": "articoli",
    "compte.mdp_aide": "Almeno 8 caratteri.",

    "compte.connexion.titre": "Accedi",
    "compte.connexion.intro":
      "Accedi per seguire i tuoi ordini e ritrovare i tuoi indirizzi.",
    "compte.connexion.bouton": "Accedi",
    "compte.connexion.oubli": "Password dimenticata?",
    "compte.connexion.pas_de_compte": "Non hai ancora un account?",
    "compte.connexion.creer": "Crea un account",

    "compte.inscription.titre": "Crea un account",
    "compte.inscription.intro":
      "Con un account puoi seguire i tuoi ordini e non riscrivere ogni volta i tuoi indirizzi.",
    "compte.inscription.bouton": "Crea il mio account",
    "compte.inscription.deja": "Hai già un account?",

    "compte.commandes.titre": "I miei ordini",
    "compte.commandes.vide": "Non hai ancora effettuato ordini.",
    "compte.commandes.decouvrir": "Scopri i poster",
    "compte.commandes.numero": "Ordine",
    "compte.commandes.voir": "Vedi i dettagli",
    "compte.commandes.suivre": "Segui il pacco",
    "compte.commandes.retour": "Torna ai miei ordini",

    "compte.commande.paiement": "Pagamento",
    "compte.commande.traitement": "Evasione",
    "compte.commande.adresse": "Indirizzo di spedizione",
    "compte.commande.articles": "Articoli",
    "compte.commande.expeditions": "Spedizioni",
    "compte.commande.sous_total": "Subtotale",
    "compte.commande.remise": "Sconto",
    "compte.commande.port": "Spedizione",
    "compte.commande.total": "Totale",
    "compte.commande.rembourse": "Rimborsato",
    "compte.commande.quantite": "Quantità",
    "compte.commande.introuvable": "Questo ordine non è stato trovato.",
    "compte.commande.sans_suivi": "Nessun numero di tracciamento per ora.",

    "compte.statut.financier.pending": "In attesa di pagamento",
    "compte.statut.financier.authorized": "Pagamento autorizzato",
    "compte.statut.financier.partially_paid": "Parzialmente pagato",
    "compte.statut.financier.paid": "Pagato",
    "compte.statut.financier.partially_refunded": "Parzialmente rimborsato",
    "compte.statut.financier.refunded": "Rimborsato",
    "compte.statut.financier.voided": "Annullato",

    "compte.statut.expedition.unfulfilled": "Non spedito",
    "compte.statut.expedition.partially_fulfilled": "Parzialmente spedito",
    "compte.statut.expedition.fulfilled": "Spedito",
    "compte.statut.expedition.delivered": "Consegnato",
    "compte.statut.expedition.cancelled": "Annullato",

    "compte.adresses.titre": "I miei indirizzi",
    "compte.adresses.vide": "Non hai ancora salvato nessun indirizzo.",
    "compte.adresses.nouvelle": "Nuovo indirizzo",
    "compte.adresses.modifier": "Modifica",
    "compte.adresses.supprimer": "Elimina",
    "compte.adresses.enregistrer": "Salva",
    "compte.adresses.annuler": "Annulla",
    "compte.adresses.libelle": "Nome dell'indirizzo (Casa, Ufficio…)",
    "compte.adresses.defaut_livraison":
      "Usa come indirizzo di spedizione predefinito",
    "compte.adresses.defaut_facturation":
      "Usa come indirizzo di fatturazione predefinito",
    "compte.adresses.badge_livraison": "Spedizione predefinita",
    "compte.adresses.badge_facturation": "Fatturazione predefinita",

    "compte.infos.titre": "I miei dati",
    "compte.infos.enregistrer": "Salva",
    "compte.infos.enregistre": "I tuoi dati sono stati salvati.",
    "compte.infos.mdp_titre": "Cambia password",
    "compte.infos.mdp_ancien": "Password attuale",
    "compte.infos.mdp_nouveau": "Nuova password",
    "compte.infos.mdp_confirmer": "Conferma la nuova password",
    "compte.infos.mdp_bouton": "Cambia la mia password",
    "compte.infos.mdp_change": "La tua password è stata cambiata.",

    "compte.oubli.titre": "Password dimenticata",
    "compte.oubli.intro":
      "Indica il tuo indirizzo e-mail: ti invieremo un link per scegliere una nuova password.",
    "compte.oubli.bouton": "Invia il link",
    "compte.oubli.envoye":
      "Se esiste un account con questo indirizzo, l'e-mail è appena partita. Controlla anche la posta indesiderata.",
    "compte.oubli.retour": "Torna all'accesso",

    "compte.reinit.titre": "Nuova password",
    "compte.reinit.intro": "Scegli la nuova password del tuo account.",
    "compte.reinit.bouton": "Salva la nuova password",
    "compte.reinit.ok": "La tua password è stata cambiata. Ora puoi accedere.",
    "compte.reinit.lien_incomplet":
      "Questo link è incompleto. Richiedine uno nuovo dalla pagina di accesso.",

    "compte.err.indisponible":
      "L'area clienti non è disponibile al momento. Riprova tra qualche istante.",
    "compte.err.identifiants": "E-mail o password non corretti.",
    "compte.err.deja_inscrit":
      "Esiste già un account con questo indirizzo e-mail.",
    "compte.err.mdp_court": "La password deve contenere almeno 8 caratteri.",
    "compte.err.mdp_different": "Le due password non coincidono.",
    "compte.err.mdp_actuel": "La password attuale non è corretta.",
    "compte.err.jeton": "Questo link non è più valido. Richiedine uno nuovo.",
    "compte.err.champs": "Compila i campi obbligatori.",
    "compte.err.generique": "Si è verificato un errore. Riprova.",
    // Textes sortis du code en dur (octobre 2026).
    "cfg.precedent": "Precedente",
    "cfg.suivant": "Successivo",
    "defiler.haut": "Scorri verso l'alto",
    "defiler.bas": "Scorri verso il basso",
    "cfg.couleur_perso": "Colore personalizzato",
    "cfg.remettre_couleurs": "Ripristina i colori originali",
    "cfg.remettre_couleurs_de": "Ripristina i colori originali: {partie}",
    "cfg.couleur_actuelle": "Colore attuale: {couleur}",
    "cfg.autres": "Altri",
    "cfg.personnage_n": "Personaggio {id}",
    "cfg.personnage": "Personaggio",
    "cfg.deplacer_aide": "{nom}: trascinalo per spostarlo sul poster, oppure usa le frecce",
    "cfg.exemple_affiche": "La tua città, la tua storia",
    "cfg.apercu_cadre": "Anteprima del poster con cornice: {cadre}",
    "cfg.apercu_cadre_sans_nom": "Anteprima del poster con cornice",
    "cfg.ligne_n": "Riga {n}",
    "cfg.personnaliser_perso": "Personalizza questo personaggio",
    "cfg.police.serif": "Classico",
    "cfg.police.abril": "Deciso",
    "cfg.police.shabby": "Scritto a mano",
    "cfg.couleur.blanc": "Bianco",
    "cfg.couleur.anthracite": "Grigio antracite",
    "commande.modifier_panier": "Modifica il carrello",
    "commande.merci_titre": "Grazie!",
    "commande.merci_texte": "Abbiamo ricevuto il tuo pagamento e il tuo ordine è confermato.",
    "commande.numero": "Numero d'ordine:",
    "commande.retour.verification": "Stiamo verificando il tuo pagamento con la tua banca…",
    "commande.retour.en_cours_titre": "Pagamento in fase di convalida",
    "commande.retour.en_cours_texte":
      "La tua banca non ha ancora confermato il pagamento. Riceverai un'e-mail non appena sarà convalidato: non serve pagare una seconda volta.",
    "commande.retour.ecart_texte":
      "Il tuo pagamento è arrivato, ma l'importo non corrisponde al tuo ordine. Il negozio ti ricontatterà via e-mail per sistemare la cosa: non serve pagare una seconda volta.",
    "commande.retour.refuse":
      "Il pagamento è stato rifiutato o non è andato a buon fine. Il tuo carrello è stato conservato: controlla la consegna, poi riprova con lo stesso metodo di pagamento o con un altro.",
    "commande.retour.injoignable":
      "Non è stato possibile verificare il tuo pagamento in questo momento. Ricarica la pagina tra qualche istante; se l'importo è stato addebitato, non pagare una seconda volta e scrivici.",
    "commande.coordonnees": "I tuoi dati",
    "commande.email_compte":
      "È l'indirizzo e-mail del tuo account. Per cambiarlo, vai su «I miei dati».",
    "commande.email_invalide": "Indirizzo e-mail non valido.",
    "livraison.autre_pays": "Altro paese",
    "livraison.ou_retirer": "Dove vuoi ritirare il tuo ordine?",
    "livraison.carnet": "I tuoi indirizzi salvati",
    "livraison.autre_adresse": "Un altro indirizzo",
    "livraison.adresse_exemple": "Via Roma 12",
    "livraison.complement_exemple": "Scala B, 3° piano",
    "livraison.relais_numero": "(n. {code})",
    "livraison.carte": "Mappa dei punti di ritiro",
    "livraison.relais_plus_disponible":
      "Questo punto di ritiro non è più disponibile. Scegline un altro dall'elenco.",
    "commande.essai.titre": "Negozio in modalità di prova: nessun pagamento reale.",
    "commande.essai.carte_libelle": "Carta di credito:",
    "commande.essai.carte":
      "4242 4242 4242 4242, una data futura, tre cifre qualsiasi sul retro e un CAP qualsiasi.",
    "commande.essai.paypal_libelle": "PayPal:",
    "commande.essai.paypal":
      "accedi con l'account acquirente di prova, non con il tuo. Lo trovi su developer.paypal.com, in «Testing Tools» e poi «Sandbox accounts»: termina con {domaine}.",
    "commande.carte": "Carta di credito",
    "commande.preparation": "Preparazione in corso…",
    "commande.continuer_paiement": "Continua con il pagamento · {total}",
    "commande.il_manque": "Per continuare manca ancora: {liste}.",
    "commande.manque.nom": "il tuo nome",
    "commande.manque.email": "un indirizzo e-mail valido",
    "commande.manque.mode": "un metodo di consegna",
    "commande.manque.adresse": "l'indirizzo di consegna (via, CAP e città)",
    "commande.manque.relais": "un punto di ritiro",
    "commande.manque.lieu": "il luogo dove ritirerai l'ordine",
    "commande.err.lieu_retrait_requis":
      "Scegli dove ritirare il tuo ordine. Se il luogo è appena sparito dall'elenco, scegline un altro, oppure un altro metodo di consegna.",
    "retrait.titre": "Luogo di ritiro",
    "commande.manque.moyen": "un metodo di pagamento",
    "commande.modifier_coordonnees": "← Modifica i miei dati",
    "commande.recapitulatif": "Riepilogo",
    "panier.affiche_sans_titre": "Poster personalizzato",
    "commande.qte": "Q.tà",
    "commande.err.panier_modifie":
      "Il tuo carrello è cambiato dopo il calcolo del totale. Torna al passaggio precedente per ricalcolarlo prima di pagare.",
    "commande.err.refuse": "Pagamento rifiutato.",
    "commande.err.non_finalise": "Pagamento non completato. Riprova.",
    "commande.err.carte_indisponible":
      "Il pagamento con carta non è disponibile al momento. Riprova tra qualche istante.",
    "commande.err.paypal_indisponible":
      "Non è stato possibile caricare PayPal. Riprova, oppure paga con carta.",
    "commande.err.paiement_reconfigure":
      "I metodi di pagamento del negozio sono appena cambiati. Scegli di nuovo il metodo di pagamento: non è stato addebitato nulla.",
    "commande.err.paypal_ouverture":
      "Non è stato possibile avviare il pagamento con PayPal. Prova con la carta di credito, oppure torna tra qualche minuto.",
    "commande.err.compte_requis":
      "Devi aver effettuato l'accesso per confermare l'ordine. Crea il tuo account o accedi: il tuo carrello ti aspetta.",
    "commande.err.generique":
      "Non è stato possibile preparare l'ordine. Controlla i tuoi dati e riprova.",
    "commande.err.technique":
      "Un problema tecnico ci ha impedito di confermare il tuo ordine. Non è stato addebitato nulla e il tuo carrello è stato conservato: riprova tra qualche istante.",
    "commande.err.paiement":
      "Non è stato possibile confermare il pagamento. Riprova, oppure scrivici se l'importo è stato addebitato.",
    "ponct.deux_points": ": ",
    "ponct.guillemets": "«{texte}»",
    "panier.pastille": "Articoli nel carrello: {nombre}",
    "panier.err.ajout":
      "Non è stato possibile aggiungere il poster al carrello. Riprova tra un istante.",
    "panier.err.config":
      "Non è stato possibile aggiungere il poster al carrello. Ricarica la pagina e riprova.",
    "accueil.vitrine_titre": "I nostri best seller ❤️",
    "accueil.vitrine_texte":
      "- Scegli lo sfondo\n- Personalizza il testo\n- Scegli i tuoi personaggi e personalizzali\nIl tuo poster pronto in 2 minuti!",
    "accueil.ia_titre": "La tua foto, in un poster",
    "accueil.ia_texte":
      "Inviaci una foto — una casa, una spiaggia, una via, un ricordo — e ritrovala illustrata nello stile Memory Line. Vedrai il risultato prima di ordinare.",
    "accueil.ia_bouton": "Prova con la mia foto",
    "accueil.lettre_titre": "Iscriviti alla nostra newsletter",
    "produit.meta_repli.personnalisable":
      "{nom}: poster personalizzato da creare online. Aggiungi i tuoi personaggi e il tuo testo in pochi minuti. Stampa in A4 o A3.",
    "produit.meta_repli.prete_a_imprimer":
      "{nom}: poster decorativo pronto da stampare, da appendere a casa o da regalare. Stampa in A4 o A3.",
    "seo.fil_accueil": "Home",
    "seo.nature.personnalisable": "Poster personalizzato",
    "seo.nature.prete_a_imprimer": "Poster pronto da stampare",
    "seo.natures.personnalisable": "Poster personalizzati",
    "seo.natures.prete_a_imprimer": "Poster pronti da stampare",
    "seo.natures.mixte": "Poster",
    "seo.page_n": "pagina {n}",
    "seo.titre.catalogue": "Tutti i poster: città, paesaggi, temi",
    "seo.titre.personnalisable": "Poster personalizzati da creare online",
    "seo.titre.prete_a_imprimer": "Poster decorativi pronti da stampare",
    "seo.description.catalogue":
      "Tutti i poster Memory Line: poster personalizzati di città e paesaggi e poster decorativi pronti da stampare. Stampa in A4 o A3.",
    "seo.description.personnalisable":
      "Crea il tuo poster personalizzato: scegli una città o un paesaggio, aggiungi i tuoi personaggi e il tuo testo. Stampa in A4 o A3.",
    "seo.description.prete_a_imprimer":
      "Poster decorativi pronti da stampare: città, regioni e frasi da appendere a casa o da regalare. Stampa in A4 o A3.",
    "seo.description.rayon.personnalisable":
      "{rayon}: poster personalizzati da creare online. Aggiungi i tuoi personaggi e il tuo testo. Stampa in A4 o A3.",
    "seo.description.rayon.prete_a_imprimer":
      "{rayon}: poster decorativi pronti da stampare, da appendere a casa o da regalare. Stampa in A4 o A3.",
    "seo.description.rayon.mixte":
      "{rayon}: poster Memory Line, personalizzati o pronti da stampare, da appendere a casa o da regalare. Stampa in A4 o A3.",
    "accueil.h1": "Poster personalizzati di città e paesaggi",
    "produit.description_titre": "Informazioni su questo poster",
    "produit.fil_ariane": "Percorso di navigazione",
    "produit.voisines.titre_rayon": "Dalla stessa collezione",
    "produit.voisines.titre_genre": "Potrebbe piacerti anche",
    "produit.voisines.voir_tout": "Vedi tutta la sezione «{rayon}»",
    "compte.essai.titre": "Sito di prova.",
    "compte.essai.avant":
      "Questo account è precompilato a caso per evitarti di digitare. Password:",
    "compte.essai.apres":
      "— annota l'indirizzo email se vuoi accedere di nuovo con questo account. Questo avviso e la precompilazione non esistono in produzione.",
    "panier.recuperer.titre": "Il tuo carrello ti aspetta",
    "panier.recuperer.intro": "Lo stiamo ripristinando, poi ti portiamo a completare l'ordine.",
    "panier.recuperer.article_indisponible": "questo poster non è più disponibile",
    "panier.recuperer.code": "Il tuo codice sconto {code} è stato riapplicato.",
    "panier.recuperer.bouton": "Riprendi il mio ordine",
    "panier.recuperer.sans_js":
      "Il tuo browser non esegue JavaScript: non possiamo ripristinare il tuo carrello. Scrivici rispondendo al messaggio che hai ricevuto, completeremo l'ordine insieme a te.",
    "panier.recuperer.voir_affiches": "Vedi i poster",
    "panier.recuperer.jeton_inconnu.titre": "Questo link non è più valido",
    "panier.recuperer.jeton_inconnu.texte":
      "Non riconosciamo questo link. Forse il tuo programma di posta l'ha spezzato in due, oppure il carrello è stato pagato da un altro dispositivo.",
    "panier.recuperer.deja_payee.titre": "Questo ordine è già stato pagato",
    "panier.recuperer.deja_payee.texte":
      "Buone notizie: il tuo ordine è stato pagato. Non c'è niente da riprendere, stiamo preparando il tuo poster.",
    "panier.recuperer.panier_clos.titre": "Questo carrello è stato chiuso",
    "panier.recuperer.panier_clos.texte":
      "Questo ordine è stato annullato o rimborsato. Non può più essere ripreso, ma puoi comporne uno nuovo quando vuoi.",
    "panier.recuperer.trop_ancien.titre": "Questo link è scaduto",
    "panier.recuperer.trop_ancien.texte":
      "Dopo quattordici giorni smettiamo di conservare un carrello in sospeso: nel frattempo prezzi e poster potrebbero essere cambiati. Ricomincia dal negozio, il tuo poster si crea in due minuti.",
    "panier.recuperer.indisponible.titre": "Non riusciamo ad aprire il tuo carrello",
    "panier.recuperer.indisponible.texte":
      "Qualcosa è andato storto da parte nostra. Riprova tra un attimo, oppure scrivici rispondendo semplicemente al messaggio che hai ricevuto.",
    "livraison.relais_requis": "Scegli il tuo punto di ritiro dall'elenco.",
    "livraison.relais_autre_reseau":
      "Questo punto di ritiro non corrisponde al metodo di consegna scelto. Scegline uno dall'elenco.",
    "commande.err.mode_indisponible":
      "Questo metodo di consegna non è più disponibile. Scegline un altro.",
    "commande.err.adresse_incomplete":
      "L'indirizzo di consegna è incompleto: controlla via, CAP e città.",
    "commande.err.avant_paiement":
      "Non siamo riusciti a verificare il carrello prima del pagamento. Non è stato addebitato nulla: riprova tra qualche istante.",
    "cfg.plus_bas": "Più in basso: {parties}",
    "cfg.partie.couleurs": "colori",
    "cfg.partie.vetements": "vestiti",
    "cfg.partie.cheveux": "capelli",
    "cfg.partie.accessoires": "accessori",
  },

  es: {
    "nav.accueil": "Memory Line — inicio",
    "nav.menu": "Menú",
    "stand.mode": "Modo stand",
    "stand.ferme": "Puesto cerrado: no se puede validar ninguna venta.",
    "nav.affiches": "Láminas",
    "nav.personnalisables": "Láminas personalizables",
    "nav.tout_voir": "Ver todo",
    "nav.villes": "Ciudades",
    "nav.themes_paysages": "Temas y paisajes",
    "nav.pretes": "Láminas listas para imprimir",
    "nav.panier": "Cesta",
    "nav.creer": "Crear mi lámina",
    "nav.langue": "Idioma",

    "pied.droits": "Memory Line — Láminas personalizadas",
    "pied.credit.avant": "Hecho con",
    "pied.credit.apres": "por",
    "pied.baseline": "Tu lámina lista en 2 minutos.",

    "meta.titre": "Memory Line | Láminas personalizadas de ciudades y paisajes",
    "meta.description":
      "Láminas personalizadas de ciudades, paisajes y temas. Diseña la tuya en unos minutos, impresa en A4 o A3.",

    "accueil.surtitre": "Láminas personalizadas",
    "accueil.titre": "Tu ciudad, tu historia, en la pared.",
    "accueil.soustitre":
      "Elige un fondo, personaliza el título, añade tus personajes. Tu lámina lista en 2 minutos — impresa en A4 o A3.",
    "accueil.cta": "Descubrir las láminas",
    "accueil.stat.affiches": "Láminas",
    "accueil.stat.collections": "Colecciones",

    "catalogue.titre": "Todas las láminas",
    "catalogue.compte": "láminas · ciudades, paisajes y temas",
    "catalogue.compte_simple": "láminas",
    "catalogue.compte_un": "lámina",
    "catalogue.erreur": "No se ha podido cargar el catálogo",
    "catalogue.vide": "Todavía no hay láminas.",

    "catalogue.ville": "Lugares",
    "catalogue.toutes_villes": "Todos los lugares",
    "catalogue.chercher_lieu": "Buscar un lugar…",
    "catalogue.aucun_lieu": "Ningún lugar coincide.",
    "catalogue.tri": "Ordenar",
    "catalogue.tri.manuel": "Orden de la tienda",
    "catalogue.tri.nouveautes": "Novedades",
    "catalogue.tri.prix_asc": "Precio de menor a mayor",
    "catalogue.tri.prix_desc": "Precio de mayor a menor",
    "catalogue.tri.alpha": "De la A a la Z",
    "catalogue.trier_bouton": "Aplicar",
    "catalogue.page": "Página",
    "catalogue.page_sur": "de",
    "catalogue.precedente": "Anterior",
    "catalogue.suivante": "Siguiente",
    "recherche.titre": "Buscar",
    "recherche.champ": "Buscar una lámina",
    "recherche.bouton": "Buscar",
    "recherche.invite": "Busca una ciudad, un lugar, un tema.",
    "recherche.trop_court": "Escribe al menos dos letras.",
    "recherche.resultat": "lámina encontrada",
    "recherche.resultats": "láminas encontradas",
    "recherche.aucun": "Ninguna lámina coincide con esta búsqueda.",
    "recherche.conseil":
      "Comprueba la ortografía, o prueba con el nombre de una ciudad.",
    "recherche.tout_voir": "Ver todas las láminas",
    "recherche.instant.preciser": "{n} láminas coinciden: afina la búsqueda para ver las demás.",
    "recherche.instant.fermer": "Cerrar",
    "recherche.instant.cherche": "Buscando…",
    "promo.ancien_prix": "Precio anterior",
    "promo.reduction": "de descuento",
    "pied.navigation": "La tienda",
    "pied.aide": "Ayuda e información",
    "pied.instagram": "Síguenos en Instagram",
    "pied.contact": "Contacto",
    "pied.conditions": "Condiciones generales de venta",
    "pied.mentions": "Aviso legal",
    "pied.confidentialite": "Política de privacidad",
    "pied.cookies": "Cookies",
    "404.titre": "Esta página no existe",
    "404.texte":
      "Puede que la dirección esté mal copiada, o que la lámina ya no esté a la venta.",
    "404.affiches": "Ver todas las láminas",
    "404.recherche": "Buscar una lámina",
    "404.accueil": "Volver al inicio",
    "503.titre": "Página no disponible por el momento",
    "503.texte":
      "El sitio no consigue cargar esta página ahora mismo. Vuelve a intentarlo en un minuto.",

    "genre.personnalisable": "Personalizable",
    "genre.prete_a_imprimer": "Lista para imprimir",

    "produit.format": "Formato",
    "produit.personnaliser": "Personalizar",
    "produit.aide": "Elige el fondo, el texto y tus personajes.",
    "produit.ajouter": "Añadir a la cesta",
    "produit.ajout_en_cours": "Añadiendo a la cesta…",
    "produit.retour": "Volver a las láminas",
    "panier.affiche_ia": "Lámina creada a partir de tu foto",

    "ia.titre": "Tu lámina, a partir de tu foto",
    "ia.intro":
      "Envía una foto: la convertimos en una lámina. Mira el resultado, vuelve a lanzarlo tantas veces como quieras y quédate con la que más te guste.",
    "ia.depot": "Suelta aquí tu foto, o haz clic para elegirla",
    "ia.depot_bouton": "Elegir una foto",
    "ia.depot_formats": "JPEG, PNG o WebP",
    "ia.photo_nette": "Tu foto debe ser nítida y luminosa.",
    "ia.orientation": "Orientación del póster",
    "ia.portrait": "Vertical",
    "ia.paysage": "Horizontal",
    "ia.orientation_relancer": "Vuelve a crear el póster para obtenerlo en esta orientación.",
    "ia.creations_titre": "Tus creaciones ({n})",
    "ia.creations_aide":
      "Toca un póster para volver a verlo y marca los que quieras conservar: irán juntos a la cesta.",
    "ia.creation_n": "Creación {n}",
    "ia.garder": "Conservar",
    "ia.ajouter_n": "Añadir los {n} pósteres a la cesta",
    "ia.changer_photo": "Elegir otra foto",
    "ia.photo_titre": "Tu foto",
    "ia.style_titre": "¿Qué tipo de lámina?",
    "ia.style_aide":
      "Elige el estilo que te guste: tu lámina se creará con ese espíritu.",
    "ia.style_manquant": "Elige primero un estilo, más arriba.",
    "ia.precision": "¿Quieres añadir algo? (opcional)",
    "ia.precision_exemple": "Por ejemplo: al atardecer, en tonos cálidos…",
    "ia.generer": "Crear mi lámina",
    "ia.regenerer": "Crear otra versión",
    "ia.regenerer_aide": "Todas las veces que quieras, sin coste adicional.",
    "ia.recommencer": "Empezar de nuevo",
    "ia.envoi": "Enviando tu foto…",
    "ia.generation": "Creando tu lámina…",
    "ia.generation_duree":
      "Cuenta con unos treinta segundos largos. Deja esta página abierta.",
    "ia.apercu_vide": "Aquí aparecerá tu lámina.",
    "ia.deplacer_ligne": "Arrastra para mover la línea",
    "ia.apercu_alt": "Vista previa de la lámina creada",
    "ia.filigrane_note":
      "La marca de agua desaparece en la lámina impresa, tras el pago.",
    "ia.err.indisponible":
      "La creación de láminas no está disponible ahora mismo. Inténtalo de nuevo en unos minutos, o escríbenos.",
    "ia.err.format":
      "Este archivo no es una foto reconocida. Elige un JPEG, un PNG o un WebP.",
    "ia.err.trop_lourde":
      "Esta foto pesa demasiado. Elige una más ligera, o redúcela antes de enviarla.",
    "ia.err.rafale":
      "Demasiadas peticiones seguidas. Espera un minuto y vuelve a lanzarlo.",
    "ia.err.plafond":
      "La creación de láminas está suspendida por el momento. Inténtalo más tarde, o escríbenos.",
    "ia.err.generation":
      "La creación no ha salido. Vuelve a lanzarla: suele funcionar al segundo intento. Si no, prueba con otra foto.",
    "ia.err.attente":
      "La lámina tarda más de lo previsto. Vuelve a lanzar la creación.",
    "ia.err.inconnu": "Algo ha salido mal. Vuelve a lanzar la creación.",
    "ia.relais.ouvrir": "Enviar la foto desde tu móvil",
    "ia.relais.ouvrir_aide":
      "¿Tu foto está en el móvil? Escanea un código: llegará aquí.",
    "ia.relais.code_stand_aide":
      "Para mostrar el código, introduce primero el código del puesto. Después la tableta lo recuerda.",
    "ia.relais.preparation": "Preparando el código…",
    "ia.relais.scanner": "Escanea este código con la cámara de tu móvil",
    "ia.relais.ou_adresse": "o abre esta dirección:",
    "ia.relais.attente": "Esperando la foto…",
    "ia.relais.reste": "Código válido durante {minutes} min más",
    "ia.relais.recue": "Foto recibida del móvil.",
    "ia.relais.recue_aide":
      "¿No es la correcta? Toca el botón de abajo y envía otra desde la misma página del móvil.",
    "ia.relais.autre": "Recibir otra foto",
    "ia.relais.expire": "Este código ha caducado. Pide uno nuevo.",
    "ia.relais.nouveau_code": "Nuevo código",
    "ia.relais.annuler": "Cancelar",
    "ia.relais.fermer": "Cerrar",
    "ia.relais.reessayer": "Reintentar",
    "ia.relais.injoignable":
      "No se ha podido crear el código. Comprueba la conexión y vuelve a intentarlo.",
    "ia.relais.rafale":
      "Demasiados códigos pedidos seguidos. Espera unos minutos.",
    "ia.relais.qr": "Código QR de la página para enviar la foto",
    "ia.relais.nom_photo": "Foto del móvil",

    "photo.meta_titre": "Envía tu foto | Memory Line",
    "photo.titre": "Envía tu foto",
    "photo.intro":
      "Aparecerá enseguida en la tableta del puesto, para crear tu lámina.",
    "photo.verification": "Comprobando el código…",
    "photo.choisir": "Hacer o elegir una foto",
    "photo.preparation": "Preparando la foto…",
    "photo.envoi": "Enviando… {pourcent} %",
    "photo.envoyee": "¡Enviada! Mira la tableta.",
    "photo.envoyee_autre": "¡Enviada! Pide en el puesto que la reciban en la tableta.",
    "photo.autre": "Enviar otra foto",
    "photo.autre_aide":
      "¿Otra foto? Envíala y pide en el puesto que la reciban en la tableta.",
    "photo.apercu_alt": "La foto elegida",
    "photo.code_inconnu":
      "Este código no corresponde a ningún envío en curso. Comprueba la dirección que aparece en la tableta.",
    "photo.code_expire":
      "Este código ha caducado. Pide un código nuevo en la tableta.",
    "photo.err.rafale":
      "Demasiados envíos seguidos. Espera unos minutos y vuelve a intentarlo.",
    "photo.err.reseau":
      "El envío no se ha completado. Comprueba tu conexión y vuelve a intentarlo.",


    "panier.titre": "Tu cesta",
    "panier.vide": "Tu cesta está vacía.",
    "panier.continuer": "Seguir comprando",
    "panier.commander": "Tramitar pedido",
    "panier.total": "Total",
    "panier.quantite": "Cantidad",
    "panier.modifier": "Editar",
    "panier.supprimer": "Eliminar",
    "panier.chargement": "Cargando la cesta…",
    "panier.erreur": "No se ha podido cargar la cesta",
    "livraison.cp_recherche": "Código postal",
    "livraison.chercher": "Buscar",
    "livraison.me_localiser": "Usar mi ubicación",
    "livraison.localisation_en_cours": "Buscando tu ubicación…",
    "livraison.ma_position": "Cerca de mí",
    "livraison.position_refusee":
      "No se ha permitido la ubicación. Escribe tu dirección o tu código postal.",
    "livraison.position_introuvable":
      "No hemos podido encontrar tu ubicación. Escribe tu dirección o tu código postal.",
    "livraison.recherche_en_cours": "Buscando puntos cerca de ti…",
    "livraison.aucun_relais": "No se ha encontrado ningún punto para este código postal.",
    "livraison.relais_indisponible": "Búsqueda no disponible por ahora.",
    "livraison.relais_choisi": "Punto elegido:",
    "livraison.horaires": "Horario",
    "livraison.adresse_recherche": "Tu dirección o código postal",
    "livraison.titre": "Envío",
    "livraison.pays": "País",
    "livraison.adresse": "Dirección",
    "livraison.complement": "Información adicional",
    "livraison.code_postal": "Código postal",
    "livraison.ville": "Ciudad",
    "livraison.telephone": "Teléfono",
    "livraison.code_postal_invalide": "Este código postal no parece correcto para este país.",
    "livraison.telephone_invalide": "Este número de teléfono no parece válido.",
    "livraison.ou_nous_trouver": "Dónde encontrarnos:",
    "livraison.stand_ouvert": "Abierto ahora",
    "livraison.stand_ferme": "Cerrado ahora mismo",
    "livraison.stand_periode": "Del {du} al {au}",
    "livraison.jour_ferme": "Cerrado",
    "livraison.aujourdhui": "Hoy",
    "livraison.a_heure": "a las {heure}",
    "livraison.stand_compris": "Entiendo que debo recoger mi pedido en el puesto **a más tardar el {date}, con mi documento de identidad.**",
    "livraison.stand_identite": "Se le pedirá un documento de identidad para recoger su pedido.",
    "livraison.stand_compris_requis": "Marca la casilla: recogerás tu pedido en el puesto antes de que cierre.",
    "livraison.point_relais": "Punto de recogida",
    "livraison.point_relais_aide":
      "Indica el nombre y la dirección del punto Mondial Relay elegido.",
    "livraison.offerte": "Gratis",
    "livraison.aucune": "No hay envío disponible para este país.",
    "livraison.poids_colis": "Peso del paquete:",
    "livraison.aucune_pour_ce_poids":
      "Ningún método de envío cubre este peso para este país: escríbenos.",
    "panier.code": "Código promocional",
    "panier.code_appliquer": "Aplicar",
    "panier.code_applique": "Código aplicado:",
    "panier.code_retirer": "Quitar",
    "panier.code_refuse": "Este código no es válido.",
    "accueil.tout_afficher": "Ver todo",
    "lettre.email": "Correo electrónico",
    "lettre.envoyer": "Suscribirse",
    "lettre.merci": "¡Gracias! Ya estás suscrito.",
    "lettre.erreur": "No se ha podido completar la suscripción.",
    "panier.produit": "Producto",
    "panier.total_ligne": "Total",
    "panier.total_estime": "Total estimado",
    "panier.taxes":
      "IVA no aplicable (régimen francés de franquicia). Descuentos y envío calculados al finalizar la compra.",
    "panier.payer": "Proceder al pago",
    "panier.format": "Formato",
    "panier.cadre": "Marco",
    "panier.sans_cadre": "Sin marco",
    "panier.cadres_retires":
      "Por el momento, los marcos no están disponibles en la web: los hemos quitado de tu cesta y el precio se ha recalculado.",
    "panier.personnage": "personaje",
    "panier.personnages": "personajes",
    "panier.retirer_ligne": "Quitar este póster",
    "panier.moins": "Reducir la cantidad",
    "panier.plus": "Aumentar la cantidad",
    "panier.sous_total": "Subtotal",

    "commande.titre": "Tu pedido",
    "commande.stand.titre": "Este navegador está en modo stand",
    "commande.stand.texte": "En el stand no se pide en línea: el cliente paga en el momento y su cesta se confirma desde la página Cesta. Para hacer un pedido en la web desde este navegador, sal del modo stand.",
    "commande.stand.quitter": "Salir del modo stand y pedir",
    "commande.stand.panier": "Volver a la cesta del stand",
    "commande.nom": "Nombre",
    "commande.email": "Correo electrónico",
    "commande.payer": "Pagar",
    "commande.paiement_en_cours": "Procesando el pago…",
    "commande.paiement_indisponible":
      "El pago en línea no está disponible en este momento. Tu cesta está guardada: vuelve a intentarlo en un momento.",
    "bandeau.region": "Anuncios",
    "bandeau.precedent": "Mensaje anterior",
    "bandeau.suivant": "Mensaje siguiente",
    "bandeau.pause": "Pausar los anuncios",
    "bandeau.lecture": "Reanudar los anuncios",
    "bandeau.position": "{n} de {total}",
    "bandeau.carrousel": "carrusel",
    "bandeau.message": "mensaje",

    "stand.titre": "Tus láminas",
    "stand.ajouter": "Añadir otra lámina",
    "stand.code": "Código del puesto",
    "stand.code_aide":
      "Lo introduce una vez el personal del puesto: la tableta lo recuerda después.",
    "stand.code_valider": "Validar el código",
    "stand.code_verification": "Comprobando el código…",
    "stand.code_vide": "Introduce el código del puesto.",
    "stand.code_refuse":
      "Este código no corresponde a ningún puesto abierto. Compruébalo, o abre el puesto desde el back-office.",
    "stand.code_perime":
      "El código guardado en esta tableta ya no corresponde a un puesto abierto. Introduce el código de hoy.",
    "stand.code_injoignable":
      "El puesto no ha respondido. Comprueba la conexión y vuelve a intentarlo.",
    "stand.nom": "Tu nombre",
    "stand.email": "Tu correo electrónico",
    "stand.nom_vide": "Indica tu nombre.",
    "stand.email_invalide": "Esta dirección de correo está incompleta.",
    "stand.valider_une": "Validar mi lámina",
    "stand.valider_plusieurs": "Validar mis láminas",
    "stand.envoi": "Guardando…",
    "stand.erreur": "No se ha podido registrar el pedido. Vuelve a intentarlo.",
    "stand.merci": "Tu pedido está validado, ahora puedes dirigirte al vendedor",
    "stand.revenir": "Volver a mi pedido",
    "stand.revenir_erreur": "No se ha podido reabrir el pedido. Dirígete al vendedor.",
    "stand.numero": "Número de pedido",
    "stand.suivant": "Siguiente cliente",

    "cookies.texte":
      "Este sitio guarda en tu navegador solo lo que necesitan la cesta y tus preferencias. Sin medición de audiencia ni rastreadores publicitarios.",
    "cookies.politique": "Ver nuestra política de cookies",
    "cookies.accepter": "Aceptar",
    "cookies.refuser": "Rechazar",

    "cfg.titre": "Compón tu lámina",
    "cfg.fermer": "Cerrar",
    "cfg.etape.fond": "Fondo y texto",
    "cfg.etape.personnages": "Personajes",
    "cfg.etape.format": "Formato",
    "cfg.ligne1_champ": "Línea 1",
    "cfg.ligne2_champ": "Línea 2",
    "cfg.ligne3_champ": "Línea 3",
    "cfg.ligne1_exemple": "MERS-LES-BAINS",
    "cfg.ligne2_exemple": "la casa azul",
    "cfg.ligne3_exemple": "verano 2019",
    "cfg.quantite": "Número de ejemplares",
    "cfg.quantite_moins": "Un ejemplar menos",
    "cfg.quantite_plus": "Un ejemplar más",
    "cfg.couleur_texte": "Color del texto",
    "cfg.fond": "Fondo",
    "cfg.personnages": "Personajes",
    "cfg.nouveau_perso": "+ Añadir un personaje",
    "cfg.modifier": "Editar",
    "cfg.retirer": "Quitar",
    "cfg.monter": "Subir",
    "cfg.descendre": "Bajar",
    "cfg.retour": "Volver",
    "cfg.continuer": "Continuar",
    "cfg.chargement_apercu": "Cargando la lámina…",
    "cfg.valider_affiche": "Confirmar la lámina",
    "cfg.enregistrement_en_cours": "Guardando tu lámina…",
    "cfg.valider_perso": "Confirmar el personaje",
    "cfg.personnalisation": "PERSONALIZACIÓN",
    "cfg.previsualisation": "VISTA PREVIA",
    "cfg.choix_perso": "Elige un personaje",
    "cfg.choix_couleur": "COLOR",
    "cfg.vetements": "Camiseta",
    "cfg.pantalon": "Pantalón",
    "cfg.coupes": "Peinados",
    "cfg.accessoires": "Accesorios",
    "cfg.aucun": "Ninguno",
    "cfg.reordonner_aide": "Arrastra para cambiar el orden de los personajes",
    "cfg.dupliquer": "Duplicar este personaje",
    "cfg.cadre": "Marco (opcional)",
    "cfg.sans_cadre": "Sin marco",
    "cfg.chargement": "Cargando el configurador…",
    "cfg.erreur":
      "El configurador no se ha podido cargar. Recarga la página o vuelve a intentarlo en unos instantes.",

    /* La pilule « ▶ Tuto » de la personnalisation et sa pop-up (ProductConfigurator.tsx).
       Ces textes ne sont qu'un REPLI : la marchande peut écrire les siens au
       back-office, ils passent devant. */
    "cfg.video.titre": "¿Cómo funciona?",
    "cfg.video.lancer": "Ver el vídeo",
    "cfg.video.bulle": "Guía",

    "nav.compte": "Cuenta",

    "compte.titre": "Mi cuenta",
    "compte.menu.commandes": "Mis pedidos",
    "compte.menu.adresses": "Mis direcciones",
    "compte.menu.infos": "Mis datos",
    "compte.deconnexion": "Cerrar sesión",
    "compte.email": "Correo electrónico",
    "compte.mdp": "Contraseña",
    "compte.mdp_afficher": "Mostrar",
    "compte.mdp_masquer": "Ocultar",
    "compte.mdp_confirmer": "Confirmar la contraseña",
    "compte.prenom": "Nombre",
    "compte.nom": "Apellidos",
    "compte.telephone": "Teléfono",
    "compte.marketing":
      "Quiero recibir por correo las novedades y ofertas de Memory Line.",
    "compte.langue_courriels": "Idioma de mis correos",
    "compte.langue_courriels_aide":
      "Te escribimos en este idioma: confirmación del pedido, envío, factura…",
    "compte.article": "artículo",
    "compte.articles": "artículos",
    "compte.mdp_aide": "8 caracteres como mínimo.",

    "compte.connexion.titre": "Iniciar sesión",
    "compte.connexion.intro":
      "Inicia sesión para seguir tus pedidos y recuperar tus direcciones.",
    "compte.connexion.bouton": "Iniciar sesión",
    "compte.connexion.oubli": "¿Has olvidado tu contraseña?",
    "compte.connexion.pas_de_compte": "¿Todavía no tienes cuenta?",
    "compte.connexion.creer": "Crear una cuenta",

    "compte.inscription.titre": "Crear una cuenta",
    "compte.inscription.intro":
      "Con una cuenta puedes seguir tus pedidos y no volver a escribir tus direcciones.",
    "compte.inscription.bouton": "Crear mi cuenta",
    "compte.inscription.deja": "¿Ya tienes una cuenta?",

    "compte.commandes.titre": "Mis pedidos",
    "compte.commandes.vide": "Todavía no has realizado ningún pedido.",
    "compte.commandes.decouvrir": "Descubrir las láminas",
    "compte.commandes.numero": "Pedido",
    "compte.commandes.voir": "Ver el detalle",
    "compte.commandes.suivre": "Seguir el paquete",
    "compte.commandes.retour": "Volver a mis pedidos",

    "compte.commande.paiement": "Pago",
    "compte.commande.traitement": "Preparación",
    "compte.commande.adresse": "Dirección de envío",
    "compte.commande.articles": "Artículos",
    "compte.commande.expeditions": "Envíos",
    "compte.commande.sous_total": "Subtotal",
    "compte.commande.remise": "Descuento",
    "compte.commande.port": "Envío",
    "compte.commande.total": "Total",
    "compte.commande.rembourse": "Reembolsado",
    "compte.commande.quantite": "Cantidad",
    "compte.commande.introuvable": "No se ha encontrado este pedido.",
    "compte.commande.sans_suivi": "Todavía no hay número de seguimiento.",

    "compte.statut.financier.pending": "Pendiente de pago",
    "compte.statut.financier.authorized": "Pago autorizado",
    "compte.statut.financier.partially_paid": "Parcialmente pagado",
    "compte.statut.financier.paid": "Pagado",
    "compte.statut.financier.partially_refunded": "Parcialmente reembolsado",
    "compte.statut.financier.refunded": "Reembolsado",
    "compte.statut.financier.voided": "Anulado",

    "compte.statut.expedition.unfulfilled": "Sin enviar",
    "compte.statut.expedition.partially_fulfilled": "Parcialmente enviado",
    "compte.statut.expedition.fulfilled": "Enviado",
    "compte.statut.expedition.delivered": "Entregado",
    "compte.statut.expedition.cancelled": "Anulado",

    "compte.adresses.titre": "Mis direcciones",
    "compte.adresses.vide": "Todavía no has guardado ninguna dirección.",
    "compte.adresses.nouvelle": "Nueva dirección",
    "compte.adresses.modifier": "Editar",
    "compte.adresses.supprimer": "Eliminar",
    "compte.adresses.enregistrer": "Guardar",
    "compte.adresses.annuler": "Cancelar",
    "compte.adresses.libelle": "Nombre de la dirección (Casa, Oficina…)",
    "compte.adresses.defaut_livraison":
      "Usar como dirección de envío predeterminada",
    "compte.adresses.defaut_facturation":
      "Usar como dirección de facturación predeterminada",
    "compte.adresses.badge_livraison": "Envío predeterminado",
    "compte.adresses.badge_facturation": "Facturación predeterminada",

    "compte.infos.titre": "Mis datos",
    "compte.infos.enregistrer": "Guardar",
    "compte.infos.enregistre": "Tus datos se han guardado.",
    "compte.infos.mdp_titre": "Cambiar la contraseña",
    "compte.infos.mdp_ancien": "Contraseña actual",
    "compte.infos.mdp_nouveau": "Nueva contraseña",
    "compte.infos.mdp_confirmer": "Confirmar la nueva contraseña",
    "compte.infos.mdp_bouton": "Cambiar mi contraseña",
    "compte.infos.mdp_change": "Tu contraseña se ha cambiado.",

    "compte.oubli.titre": "Contraseña olvidada",
    "compte.oubli.intro":
      "Indica tu correo electrónico: te enviaremos un enlace para elegir una nueva contraseña.",
    "compte.oubli.bouton": "Enviar el enlace",
    "compte.oubli.envoye":
      "Si existe una cuenta con esta dirección, acabamos de enviar un correo. Revisa también el correo no deseado.",
    "compte.oubli.retour": "Volver al inicio de sesión",

    "compte.reinit.titre": "Nueva contraseña",
    "compte.reinit.intro": "Elige la nueva contraseña de tu cuenta.",
    "compte.reinit.bouton": "Guardar la nueva contraseña",
    "compte.reinit.ok":
      "Tu contraseña se ha cambiado. Ya puedes iniciar sesión.",
    "compte.reinit.lien_incomplet":
      "Este enlace está incompleto. Pide uno nuevo desde la página de inicio de sesión.",

    "compte.err.indisponible":
      "El área de cliente no está disponible por ahora. Inténtalo de nuevo en unos instantes.",
    "compte.err.identifiants": "Correo electrónico o contraseña incorrectos.",
    "compte.err.deja_inscrit":
      "Ya existe una cuenta con esta dirección de correo.",
    "compte.err.mdp_court": "La contraseña debe tener al menos 8 caracteres.",
    "compte.err.mdp_different": "Las dos contraseñas no coinciden.",
    "compte.err.mdp_actuel": "La contraseña actual no es correcta.",
    "compte.err.jeton": "Este enlace ya no es válido. Pide uno nuevo.",
    "compte.err.champs": "Rellena los campos obligatorios.",
    "compte.err.generique": "Se ha producido un error. Inténtalo de nuevo.",
    // Textes sortis du code en dur (octobre 2026).
    "cfg.precedent": "Anterior",
    "cfg.suivant": "Siguiente",
    "defiler.haut": "Desplázate hacia arriba",
    "defiler.bas": "Desplázate hacia abajo",
    "cfg.couleur_perso": "Color personalizado",
    "cfg.remettre_couleurs": "Restablecer los colores originales",
    "cfg.remettre_couleurs_de": "Restablecer los colores originales: {partie}",
    "cfg.couleur_actuelle": "Color actual: {couleur}",
    "cfg.autres": "Otros",
    "cfg.personnage_n": "Personaje {id}",
    "cfg.personnage": "Personaje",
    "cfg.deplacer_aide": "{nom}: arrástralo para moverlo por la lámina o usa las flechas",
    "cfg.exemple_affiche": "Tu ciudad, tu historia",
    "cfg.apercu_cadre": "Vista previa de la lámina con marco: {cadre}",
    "cfg.apercu_cadre_sans_nom": "Vista previa de la lámina con marco",
    "cfg.ligne_n": "Línea {n}",
    "cfg.personnaliser_perso": "Personaliza este personaje",
    "cfg.police.serif": "Clásica",
    "cfg.police.abril": "Marcada",
    "cfg.police.shabby": "Manuscrita",
    "cfg.couleur.blanc": "Blanco",
    "cfg.couleur.anthracite": "Gris antracita",
    "commande.modifier_panier": "Modificar la cesta",
    "commande.merci_titre": "¡Gracias!",
    "commande.merci_texte": "Hemos recibido tu pago y tu pedido está confirmado.",
    "commande.numero": "Número de pedido:",
    "commande.retour.verification": "Estamos comprobando tu pago con tu banco…",
    "commande.retour.en_cours_titre": "Pago en proceso de validación",
    "commande.retour.en_cours_texte":
      "Tu banco todavía no ha confirmado el pago. Recibirás un correo en cuanto se valide: no hace falta pagar una segunda vez.",
    "commande.retour.ecart_texte":
      "Tu pago ha llegado, pero su importe no coincide con tu pedido. La tienda se pondrá en contacto contigo por correo para resolverlo: no hace falta pagar una segunda vez.",
    "commande.retour.refuse":
      "El pago ha sido rechazado o no se ha completado. Tu cesta se ha guardado: revisa la entrega y vuelve a intentarlo con el mismo método de pago o con otro.",
    "commande.retour.injoignable":
      "No hemos podido comprobar tu pago en este momento. Vuelve a cargar la página dentro de un instante; si se te ha cobrado, no pagues una segunda vez y escríbenos.",
    "commande.coordonnees": "Tus datos",
    "commande.email_compte":
      "Es la dirección de correo de tu cuenta. Para cambiarla, ve a «Mis datos».",
    "commande.email_invalide": "Dirección de correo no válida.",
    "livraison.autre_pays": "Otro país",
    "livraison.ou_retirer": "¿Dónde quieres recoger tu pedido?",
    "livraison.carnet": "Tus direcciones guardadas",
    "livraison.autre_adresse": "Otra dirección",
    "livraison.adresse_exemple": "Calle Mayor 12",
    "livraison.complement_exemple": "Edificio B, 3.º piso",
    "livraison.relais_numero": "(n.º {code})",
    "livraison.carte": "Mapa de puntos de recogida",
    "livraison.relais_plus_disponible":
      "Este punto de recogida ya no está disponible. Elige otro de la lista.",
    "commande.essai.titre": "Tienda en modo de prueba: no se realiza ningún pago real.",
    "commande.essai.carte_libelle": "Tarjeta bancaria:",
    "commande.essai.carte":
      "4242 4242 4242 4242, una fecha futura, tres cifras cualesquiera del reverso y cualquier código postal.",
    "commande.essai.paypal_libelle": "PayPal:",
    "commande.essai.paypal":
      "inicia sesión con la cuenta de comprador de prueba, no con la tuya. La encontrarás en developer.paypal.com, en «Testing Tools» y luego «Sandbox accounts»: termina en {domaine}.",
    "commande.carte": "Tarjeta bancaria",
    "commande.preparation": "Preparando…",
    "commande.continuer_paiement": "Continuar con el pago · {total}",
    "commande.il_manque": "Para continuar, falta: {liste}.",
    "commande.manque.nom": "tu nombre",
    "commande.manque.email": "una dirección de correo válida",
    "commande.manque.mode": "un método de envío",
    "commande.manque.adresse": "la dirección de entrega (calle, código postal y ciudad)",
    "commande.manque.relais": "un punto de recogida",
    "commande.manque.lieu": "el lugar donde recogerás tu pedido",
    "commande.err.lieu_retrait_requis":
      "Elige dónde recoger tu pedido. Si el lugar acaba de desaparecer de la lista, elige otro, o bien otro método de envío.",
    "retrait.titre": "Lugar de recogida",
    "commande.manque.moyen": "un método de pago",
    "commande.modifier_coordonnees": "← Modificar mis datos",
    "commande.recapitulatif": "Resumen",
    "panier.affiche_sans_titre": "Lámina personalizada",
    "commande.qte": "Cant.",
    "commande.err.panier_modifie":
      "Tu cesta ha cambiado desde que se calculó el total. Vuelve al paso anterior para recalcularlo antes de pagar.",
    "commande.err.refuse": "Pago rechazado.",
    "commande.err.non_finalise": "Pago no completado. Inténtalo de nuevo.",
    "commande.err.carte_indisponible":
      "El pago con tarjeta no está disponible en este momento. Inténtalo de nuevo en unos instantes.",
    "commande.err.paypal_indisponible":
      "No se ha podido cargar PayPal. Inténtalo de nuevo o paga con tarjeta.",
    "commande.err.paiement_reconfigure":
      "Los métodos de pago de la tienda acaban de cambiar. Vuelve a elegir tu método de pago: no se ha cobrado nada.",
    "commande.err.paypal_ouverture":
      "No se ha podido abrir el pago con PayPal. Prueba con la tarjeta bancaria o vuelve dentro de unos minutos.",
    "commande.err.compte_requis":
      "Tienes que iniciar sesión para confirmar el pedido. Crea tu cuenta o inicia sesión: tu cesta te espera.",
    "commande.err.generique":
      "No se ha podido preparar tu pedido. Revisa tus datos y vuelve a intentarlo.",
    "commande.err.technique":
      "Un problema técnico nos ha impedido confirmar tu pedido. No se ha cobrado nada y tu cesta se ha guardado: vuelve a intentarlo en unos instantes.",
    "commande.err.paiement":
      "No se ha podido confirmar el pago. Inténtalo de nuevo o escríbenos si se te ha cobrado.",
    "ponct.deux_points": ": ",
    "ponct.guillemets": "«{texte}»",
    "panier.pastille": "Artículos en la cesta: {nombre}",
    "panier.err.ajout":
      "No se ha podido añadir la lámina a la cesta. Inténtalo de nuevo en un momento.",
    "panier.err.config":
      "No se ha podido añadir la lámina a la cesta. Vuelve a cargar la página e inténtalo de nuevo.",
    "accueil.vitrine_titre": "Nuestros más vendidos ❤️",
    "accueil.vitrine_texte":
      "- Elige el fondo\n- Personaliza el texto\n- Elige tus personajes y personalízalos\n¡Tu lámina lista en 2 minutos!",
    "accueil.ia_titre": "Tu foto, en lámina",
    "accueil.ia_texte":
      "Envíanos una foto — una casa, una playa, una calle, un recuerdo — y recíbela ilustrada con el estilo Memory Line. Verás el resultado antes de hacer el pedido.",
    "accueil.ia_bouton": "Probar con mi foto",
    "accueil.lettre_titre": "Suscríbete a nuestro boletín",
    "produit.meta_repli.personnalisable":
      "{nom}: lámina personalizada para crear online. Añade tus personajes y tu texto en pocos minutos. Impresión en A4 o A3.",
    "produit.meta_repli.prete_a_imprimer":
      "{nom}: lámina decorativa lista para imprimir, para colgar en casa o regalar. Impresión en A4 o A3.",
    "seo.fil_accueil": "Inicio",
    "seo.nature.personnalisable": "Lámina personalizada",
    "seo.nature.prete_a_imprimer": "Lámina lista para imprimir",
    "seo.natures.personnalisable": "Láminas personalizadas",
    "seo.natures.prete_a_imprimer": "Láminas listas para imprimir",
    "seo.natures.mixte": "Láminas",
    "seo.page_n": "página {n}",
    "seo.titre.catalogue": "Todas las láminas: ciudades, paisajes, temas",
    "seo.titre.personnalisable": "Láminas personalizadas para crear online",
    "seo.titre.prete_a_imprimer": "Láminas decorativas listas para imprimir",
    "seo.description.catalogue":
      "Todas las láminas Memory Line: láminas personalizadas de ciudades y paisajes y láminas decorativas listas para imprimir. Impresión en A4 o A3.",
    "seo.description.personnalisable":
      "Crea tu lámina personalizada: elige una ciudad o un paisaje, añade tus personajes y tu texto. Impresión en A4 o A3.",
    "seo.description.prete_a_imprimer":
      "Láminas decorativas listas para imprimir: ciudades, regiones y frases para colgar en casa o regalar. Impresión en A4 o A3.",
    "seo.description.rayon.personnalisable":
      "{rayon}: láminas personalizadas para crear online. Añade tus personajes y tu texto. Impresión en A4 o A3.",
    "seo.description.rayon.prete_a_imprimer":
      "{rayon}: láminas decorativas listas para imprimir, para colgar en casa o regalar. Impresión en A4 o A3.",
    "seo.description.rayon.mixte":
      "{rayon}: láminas Memory Line, personalizadas o listas para imprimir, para colgar en casa o regalar. Impresión en A4 o A3.",
    "accueil.h1": "Láminas personalizadas de ciudades y paisajes",
    "produit.description_titre": "Sobre esta lámina",
    "produit.fil_ariane": "Ruta de navegación",
    "produit.voisines.titre_rayon": "De la misma colección",
    "produit.voisines.titre_genre": "También te puede gustar",
    "produit.voisines.voir_tout": "Ver toda la sección «{rayon}»",
    "compte.essai.titre": "Sitio de prueba.",
    "compte.essai.avant":
      "Esta cuenta se ha rellenado al azar para ahorrarte escribir. Contraseña:",
    "compte.essai.apres":
      "— apunta la dirección de correo si quieres volver a iniciar sesión con ella. Este aviso y el relleno automático no existen en producción.",
    "panier.recuperer.titre": "Tu cesta te espera",
    "panier.recuperer.intro": "La estamos recuperando y después te llevamos a finalizar el pedido.",
    "panier.recuperer.article_indisponible": "esta lámina ya no está disponible",
    "panier.recuperer.code": "Tu código de descuento {code} se ha vuelto a aplicar.",
    "panier.recuperer.bouton": "Retomar mi pedido",
    "panier.recuperer.sans_js":
      "Tu navegador no ejecuta JavaScript: no podemos recuperar tu cesta. Escríbenos respondiendo al mensaje que has recibido y terminaremos el pedido contigo.",
    "panier.recuperer.voir_affiches": "Ver las láminas",
    "panier.recuperer.jeton_inconnu.titre": "Este enlace ya no es válido",
    "panier.recuperer.jeton_inconnu.texte":
      "No reconocemos este enlace. Puede que tu programa de correo lo haya cortado en dos, o que tu cesta se haya pagado desde otro dispositivo.",
    "panier.recuperer.deja_payee.titre": "Este pedido ya está pagado",
    "panier.recuperer.deja_payee.texte":
      "Buenas noticias: tu pedido ya está pagado. No tienes nada que retomar, estamos preparando tu lámina.",
    "panier.recuperer.panier_clos.titre": "Esta cesta se ha cerrado",
    "panier.recuperer.panier_clos.texte":
      "Este pedido se ha cancelado o reembolsado. Ya no se puede retomar, pero puedes crear uno nuevo cuando quieras.",
    "panier.recuperer.trop_ancien.titre": "Este enlace ha caducado",
    "panier.recuperer.trop_ancien.texte":
      "Pasados catorce días, dejamos de guardar una cesta pendiente: nuestros precios y láminas pueden haber cambiado entretanto. Vuelve a empezar desde la tienda: tu lámina se crea en dos minutos.",
    "panier.recuperer.indisponible.titre": "No conseguimos abrir tu cesta",
    "panier.recuperer.indisponible.texte":
      "Algo ha fallado por nuestra parte. Inténtalo de nuevo en un momento o escríbenos respondiendo simplemente al mensaje que has recibido.",
    "livraison.relais_requis": "Elige tu punto de recogida en la lista.",
    "livraison.relais_autre_reseau":
      "Este punto de recogida no corresponde al método de envío elegido. Elige uno de la lista.",
    "commande.err.mode_indisponible": "Este método de envío ya no está disponible. Elige otro.",
    "commande.err.adresse_incomplete":
      "Tu dirección de entrega está incompleta: revisa la calle, el código postal y la ciudad.",
    "commande.err.avant_paiement":
      "No hemos podido comprobar tu cesta antes del pago. No se ha cobrado nada: vuelve a intentarlo en unos instantes.",
    "cfg.plus_bas": "Más abajo: {parties}",
    "cfg.partie.couleurs": "colores",
    "cfg.partie.vetements": "ropa",
    "cfg.partie.cheveux": "pelo",
    "cfg.partie.accessoires": "accesorios",
  },
} as const;

/** Clés disponibles — dérivées du français, langue de référence. */
export type CleUi = keyof (typeof ui)["fr"];
