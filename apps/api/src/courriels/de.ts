import type { CleCourriel } from "./fr.js";

/**
 * Les textes des courriels en allemand.
 *
 * Vouvoiement (« Sie »), comme le site. Ton chaleureux et simple. Les clés,
 * leur texte français et leur contexte sont dans ./fr.ts ; les variables entre
 * accolades ne se traduisent pas. Une clé qui manquerait ici partirait en
 * français (voir `tc` dans ./index.ts) : toutes y sont, à dessein.
 *
 * Les mots sont ceux du site (apps/web/src/i18n/ui.ts, section « de ») :
 * Poster, Warenkorb, Figur, Paketshop, Versand, Rabatt, Zwischensumme,
 * Sendungsnummer, Erstattung, storniert. Une cliente qui lit « Warenkorb » sur
 * la page et « Einkaufswagen » dans le courrier se demande si c'est la même
 * boutique.
 *
 * Quelques choix qui ne sont pas des calques du français :
 *
 *   - « Hallo {prenom}, » : la salutation des boutiques allemandes qui
 *     vouvoient tout en appelant par le prénom. Sans prénom, « liebe Kundin,
 *     lieber Kunde » prend sa place : un « Hallo Sie, » sonnerait comme une
 *     interpellation dans la rue, et la formule double évite de deviner le
 *     genre. Elle se lit aussi en tête de phrase, si la boutique écrit
 *     « {prenom}, … » dans ses propres relances.
 *   - « Vielen Dank, {prenom}! » garde la virgule que l'allemand exige devant
 *     une apostrophe ; d'où, là encore, « liebe Kundin, lieber Kunde » plutôt
 *     qu'un « Danke schön » qui ne tiendrait que sans virgule.
 *   - Sur la facture PDF, le texte de l'affiche se cite entre »chevrons«, la
 *     forme allemande des livres : la police du PDF ne connaît pas „ et
 *     l'effacerait, alors que » et « sont dans son alphabet.
 *   - « Netto » se lit « hors taxes » sur une facture allemande : le « net
 *     encaissé » devient donc « Endbetrag nach Erstattung ».
 *   - Le nom d'un salon arrive sans article (« Salon du livre de Nantes
 *     2026 ») : « bei {evenement} » se passe d'article, là où « auf der » ou
 *     « auf dem » obligerait à deviner un genre.
 *   - La mention de TVA reprend le tour de la mention allemande des petites
 *     entreprises (« Gemäß § 19 UStG wird keine Umsatzsteuer berechnet »),
 *     avec le mot du site, Mehrwertsteuer, et l'article français.
 */
export const de: Partial<Record<CleCourriel, string>> = {
  /* --- Commun ------------------------------------------------------------- */

  "commun.bonjour": "Hallo {prenom},",
  "commun.prenomParDefaut": "liebe Kundin, lieber Kunde",
  "commun.texteLien": "{libelle}: {lien}",
  "pied.signature": "Memory Line, personalisierte Poster.",
  "mention.tva":
    "Gemäß Art. 293 B des französischen Steuergesetzbuchs (CGI) wird keine Mehrwertsteuer berechnet.",

  /* --- Les articles, dans tous les courriers qui en montrent ---------------- */

  "lignes.format": "Format {format}",
  "lignes.indisponible": "Dieses Poster ist nicht mehr erhältlich.",
  "lignes.titreParDefaut": "Personalisiertes Poster",

  /* --- Confirmation de commande ------------------------------------------- */

  "confirmation.objet": "Ihre Bestellung {numero} ist bestätigt",
  "confirmation.titre": "Vielen Dank, {prenom}!",
  "confirmation.prenomParDefaut": "liebe Kundin, lieber Kunde",
  "confirmation.intro":
    "Ihre Bestellung {numero} ist eingegangen und bezahlt. Wir bereiten jetzt Ihr Poster vor.",
  "confirmation.sousTotal": "Zwischensumme",
  "confirmation.reduction": "Rabatt",
  "confirmation.livraison": "Versand",
  "confirmation.total": "Gesamt",
  "confirmation.adresseLivraison": "Lieferadresse:",
  "confirmation.question": "Haben Sie eine Frage? Antworten Sie einfach auf diese E-Mail.",
  "confirmation.texte": "Ihre Bestellung {numero} ist bestätigt. Gesamtbetrag: {total}.",

  /* --- Relance de panier : le courrier d'origine ----------------------------- */

  "panier.votrePanier": "Ihr Warenkorb",
  "panier.indispoUne":
    "Eines dieser Poster ist nicht mehr erhältlich, der Rest Ihres Warenkorbs wartet aber weiterhin auf Sie.",
  "panier.indispoPlusieurs":
    "Einige dieser Poster sind nicht mehr erhältlich, der Rest Ihres Warenkorbs wartet aber weiterhin auf Sie.",
  "panier.promo": "Ihr Rabattcode {code} ist bereits angewendet.",
  "panier.desinscriptionRaison":
    "Sie erhalten diese E-Mail, weil Sie bei uns eine Bestellung begonnen, aber nicht abgeschlossen haben.",
  "panier.desinscriptionLien": "Warenkorb-Erinnerungen abbestellen",
  "panier.texteIntro":
    "Sie haben ein Poster gestaltet, Ihre Bestellung aber nicht abgeschlossen. Es wartet auf Sie:",
  "panier.textePlusDisponible": "nicht mehr erhältlich",
  "panier.texteTotal": "Gesamtbetrag: {montant}",

  /* --- Relance de panier : les textes par défaut des trois relances --------- */

  "relance.1.objet": "Ihr Poster wartet auf Sie",
  "relance.1.accroche": "Hallo {prenom},",
  "relance.1.message":
    "Sie haben ein Poster gestaltet, Ihre Bestellung aber nicht abgeschlossen. Es ist noch da, genau so, wie Sie es zurückgelassen haben.",
  "relance.1.bouton": "Meine Bestellung fortsetzen",
  "relance.1.conclusion":
    "Falls Sie es sich anders überlegt haben, ignorieren Sie diese E-Mail einfach.",

  "relance.2.objet": "Ihr Warenkorb wartet noch auf Sie",
  "relance.2.accroche": "Hallo {prenom},",
  "relance.2.message":
    "Eine kleine Erinnerung: Ihr Poster liegt noch in Ihrem Warenkorb, bereit für den Druck. Sie müssen nur noch Ihre Bestellung abschließen.",
  "relance.2.bouton": "Meine Bestellung fortsetzen",
  "relance.2.conclusion":
    "Haben Sie eine Frage zu Format oder Rahmen? Antworten Sie einfach auf diese E-Mail.",

  "relance.3.objet": "Letzte Erinnerung an Ihr Poster",
  "relance.3.accroche": "Hallo {prenom},",
  "relance.3.message":
    "Dies ist unsere letzte Nachricht zu Ihrem Warenkorb: Danach schreiben wir Ihnen nicht mehr dazu. Ihr Poster wartet noch ein paar Tage auf Sie.",
  "relance.3.bouton": "Meine Bestellung abschließen",
  "relance.3.conclusion":
    "Falls Sie es sich anders überlegt haben, ignorieren Sie diese E-Mail einfach.",

  "relance.articleCite": "„{titre}“",
  "relance.articlesEt": "{debut} und {dernier}",
  /* Neutre, donc le même au nominatif et à l'accusatif : il tient dans la
     plupart des phrases où la boutique glisse {articles}. */
  "relance.articleParDefaut": "Ihr Poster",

  /* --- Commande expédiée -------------------------------------------------- */

  "expediee.objet": "Ihre Bestellung {numero} ist unterwegs",
  "expediee.intro": "Ihr Poster wurde verschickt. Bald ist es bei Ihnen.",
  "expediee.introPar": "Ihr Poster wurde mit {transporteur} verschickt. Bald ist es bei Ihnen.",
  "expediee.bouton": "Sendung verfolgen",
  "expediee.numeroSuivi": "Sendungsnummer: {numero}",
  "expediee.delai":
    "Es kann ein paar Tage dauern, bis die Sendungsverfolgung anläuft: Der Paketdienst braucht eine Weile, um das Paket zu erfassen.",
  "expediee.texte": "Ihre Bestellung {numero} wurde verschickt.",
  "expediee.textePar": "Ihre Bestellung {numero} wurde mit {transporteur} verschickt.",
  "expediee.texteSuivi": "Sendungsverfolgung: {lien}",

  /* --- Affiche prête au stand --------------------------------------------- */

  "stand.objet": "Ihr Poster ist fertig",
  "stand.intro":
    "Das von Ihnen bestellte Poster ist fertig. Wir melden uns bei Ihnen wegen der Übergabe, oder Sie erhalten es in Kürze, falls es verschickt werden muss.",
  "stand.introSur":
    "Das Poster, das Sie bei {evenement} bestellt haben, ist fertig. Wir melden uns bei Ihnen wegen der Übergabe, oder Sie erhalten es in Kürze, falls es verschickt werden muss.",
  /* Le français dit « passée » ; l'allemand a une tournure qui ne dit rien du
     genre, sans détour. */
  "stand.merci": "Bestellung {numero}. Schön, dass Sie bei uns vorbeigeschaut haben.",
  "stand.texte": "Das von Ihnen bestellte Poster ist fertig.",
  "stand.texteSur": "Das Poster, das Sie bei {evenement} bestellt haben, ist fertig.",
  "stand.texteCommande": "Bestellung {numero}.",

  /* --- Bienvenue ---------------------------------------------------------- */

  "bienvenue.objet": "Willkommen bei Memory Line",
  "bienvenue.intro":
    "Ihr Konto ist eingerichtet. Dort finden Sie Ihre Bestellungen samt Sendungsverfolgung, die Poster, die Sie gestaltet haben, und Ihre Lieferadressen, die Sie nur einmal speichern müssen.",
  "bienvenue.bouton": "Zu meinem Konto",
  "bienvenue.securite":
    "Wir werden Sie niemals per E-Mail nach Ihrem Passwort fragen. Haben Sie eine Frage? Antworten Sie einfach auf diese E-Mail.",
  "bienvenue.texte":
    "Ihr Konto bei Memory Line ist eingerichtet. Dort finden Sie Ihre Bestellungen samt Sendungsverfolgung, Ihre Poster und Ihre Lieferadressen.",

  /* --- Mot de passe modifié ----------------------------------------------- */

  "mdpModifie.objet": "Das Passwort Ihres Kontos wurde geändert",
  "mdpModifie.parReinit":
    "Das Passwort Ihres Kontos bei Memory Line wurde soeben über den Link zum Zurücksetzen geändert, der auf der Anmeldeseite angefordert wurde. Alle offenen Sitzungen wurden beendet: Bitte melden Sie sich auf jedem Gerät neu an.",
  "mdpModifie.parCompte":
    "Das Passwort Ihres Kontos bei Memory Line wurde soeben in Ihrem Kundenbereich geändert.",
  "mdpModifie.alerte":
    "Wenn Sie diese Änderung nicht selbst vorgenommen haben, hat womöglich jemand anderes Zugriff auf Ihr Konto. Fordern Sie sofort über die Anmeldeseite ein neues Passwort an und geben Sie uns dann Bescheid, indem Sie auf diese E-Mail antworten.",
  "mdpModifie.bouton": "Mein Konto wieder sichern",
  "mdpModifie.avis":
    "Diese E-Mail ist ein Sicherheitshinweis. Sie enthält kein Passwort, und wir werden Sie niemals nach Ihrem fragen.",
  "mdpModifie.texteParReinit":
    "Das Passwort Ihres Kontos bei Memory Line wurde soeben über den Link zum Zurücksetzen geändert, den Sie angefordert hatten. Alle offenen Sitzungen wurden beendet.",
  "mdpModifie.texteAlerte":
    "Falls Sie das nicht waren, fordern Sie sofort über die Anmeldeseite ein neues Passwort an.",
  "mdpModifie.texteAlerteLien":
    "Falls Sie das nicht waren, fordern Sie sofort über die Anmeldeseite ein neues Passwort an: {lien}",

  /* --- Réinitialisation du mot de passe ----------------------------------- */

  "reinit.objet": "Ihr Passwort zurücksetzen",
  "reinit.intro":
    "Sie möchten das Passwort Ihres Kontos bei Memory Line ändern. Dieser Link ist eine Stunde lang gültig und kann nur einmal verwendet werden.",
  "reinit.bouton": "Neues Passwort wählen",
  "reinit.ignorer":
    "Falls Sie das nicht angefordert haben, ignorieren Sie diese E-Mail: Ihr aktuelles Passwort bleibt gültig.",
  "reinit.texteLien":
    "Hier können Sie ein neues Passwort wählen (Link eine Stunde lang gültig): {lien}",
  "reinit.texteIgnorer":
    "Falls Sie das nicht angefordert haben, ignorieren Sie diese E-Mail.",

  /* --- Commande remboursée ------------------------------------------------ */

  "remboursee.objet": "Erstattung für Ihre Bestellung {numero}",
  "remboursee.objetPartiel": "Teilerstattung für Ihre Bestellung {numero}",
  "remboursee.intro":
    "Wir haben für Ihre Bestellung {numero} eine Erstattung von {montant} veranlasst.",
  "remboursee.partiel":
    "Es handelt sich um eine Teilerstattung: Der Rest Ihrer Bestellung ist davon nicht betroffen.",
  "remboursee.port": "Davon Versandkosten: {montant}.",
  "remboursee.cumul":
    "Für diese Bestellung über {commande} wurden Ihnen insgesamt {total} erstattet.",
  "remboursee.delaiEnLigne":
    "Der Betrag wird auf die Zahlungsart zurückgebucht, mit der Sie bestellt haben. Rechnen Sie mit einigen Werktagen, bis er auf Ihrem Kontoauszug erscheint: Diese Frist hängt von Ihrer Bank ab, nicht von uns.",
  "remboursee.horsLigne":
    "Diese Erstattung erfolgt außerhalb der Online-Zahlung. Wir melden uns bei Ihnen, falls uns noch Angaben fehlen, um Ihnen den Betrag auszuzahlen.",
  "remboursee.question":
    "Haben Sie eine Frage zu dieser Erstattung? Antworten Sie einfach auf diese E-Mail.",
  "remboursee.texte":
    "Für Ihre Bestellung {numero} wurde eine Erstattung von {montant} veranlasst.",
  "remboursee.textePartiel":
    "Es handelt sich um eine Teilerstattung: Der Rest der Bestellung ist davon nicht betroffen.",
  "remboursee.texteDelai":
    "Rechnen Sie mit einigen Werktagen, bis der Betrag auf Ihrem Kontoauszug erscheint.",
  "remboursee.texteHorsLigne": "Diese Erstattung erfolgt außerhalb der Online-Zahlung.",

  /* --- Commande annulée --------------------------------------------------- */

  "annulee.objet": "Ihre Bestellung {numero} wurde storniert",
  "annulee.intro":
    "Ihre Bestellung {numero} wurde storniert. Es wird nichts hergestellt und nichts verschickt.",
  "annulee.motif": "Grund: {motif}",
  "annulee.argent":
    "Den bezahlten Betrag erhalten Sie zurück. Sobald die Erstattung veranlasst ist, bekommen Sie eine eigene E-Mail mit allen Einzelheiten und der voraussichtlichen Dauer.",
  "annulee.surprise":
    "Sollte Sie diese Stornierung überraschen, antworten Sie einfach auf diese E-Mail: Wir gehen die Bestellung gemeinsam mit Ihnen noch einmal durch.",
  "annulee.texteArgent":
    "Den bezahlten Betrag erhalten Sie zurück; sobald die Erstattung veranlasst ist, folgt eine eigene E-Mail.",
  "annulee.motifSaisie": "Eingabefehler",
  "annulee.motifRupture": "Ausverkauft — Artikel nicht verfügbar",
  /* « Demande de la cliente » : le composé allemand est neutre de lui-même. */
  "annulee.motifCliente": "Kundenwunsch",
  "annulee.motifImpaye": "Zahlung nicht eingegangen",

  /* --- Facture : le courrier ---------------------------------------------- */

  "facture.objet": "Ihre Rechnung {facture} — Bestellung {numero}",
  "facture.intro": "Im Anhang finden Sie die Rechnung zu Ihrer Bestellung {numero}.",
  "facture.numeroFacture": "Rechnungsnummer",
  "facture.commande": "Bestellung",
  "facture.montant": "Betrag",
  "facture.reglee":
    "Diese Bestellung ist bezahlt: Die Rechnung ist beglichen, Sie müssen nichts weiter tun.",
  "facture.nonReglee":
    "Diese Bestellung ist noch nicht bezahlt. Wir melden uns bei Ihnen, falls noch eine Zahlung aussteht.",
  "facture.question":
    "Haben Sie eine Frage zu dieser Rechnung? Antworten Sie einfach auf diese E-Mail.",
  "facture.texteNumero": "Rechnung Nr. {facture} — {montant}.",
  "facture.texteReglee": "Diese Bestellung ist bezahlt: Die Rechnung ist beglichen.",
  "facture.texteNonReglee": "Diese Bestellung ist noch nicht bezahlt.",

  /* --- Facture : le PDF joint --------------------------------------------- */

  "facturePdf.nomFichier": "Rechnung",
  "facturePdf.titreDocument": "Rechnung {facture} - Memory Line",
  "facturePdf.sujetDocument": "Bestellung {numero}",
  "facturePdf.titre": "RECHNUNG",
  "facturePdf.numero": "Nr. {facture}",
  "facturePdf.emiseLe": "Rechnungsdatum: {date}",
  "facturePdf.emetteur": "RECHNUNGSSTELLER",
  "facturePdf.activite": "Personalisierte Poster",
  "facturePdf.factureA": "RECHNUNGSEMPFÄNGER",
  "facturePdf.clientParDefaut": "Kunde",
  "facturePdf.commandeDu": "Bestellung {numero} vom {date}",
  "facturePdf.reglee": "Bestellung bezahlt. Rechnung beglichen.",
  "facturePdf.nonReglee": "Bestellung bislang nicht bezahlt.",
  "facturePdf.annulee": "Bestellung storniert",
  /* « am {date} » avant le participe : l'ordre allemand. Le code ajoute
     ensuite « — motif. », qui suit aussi bien ici. */
  "facturePdf.annuleeLe": "Bestellung am {date} storniert",
  "facturePdf.designation": "BEZEICHNUNG",
  "facturePdf.quantite": "MENGE",
  "facturePdf.prixUnitaire": "EINZELPREIS",
  "facturePdf.totalColonne": "GESAMT",
  "facturePdf.texteAffiche": "»{texte}«",
  "facturePdf.sousTotal": "Zwischensumme",
  "facturePdf.reduction": "Rabatt",
  "facturePdf.livraison": "Versand",
  "facturePdf.totalAPayer": "GESAMTBETRAG",
  "facturePdf.dontRembourse": "Davon erstattet",
  "facturePdf.netEncaisse": "Endbetrag nach Erstattung",
  /* Une ligne A4 en corps 8 : à peu près la longueur du français. */
  "facturePdf.pied":
    "Memory Line, personalisierte Poster. Fragen zur Rechnung? Antworten Sie einfach auf die E-Mail, mit der sie kam.",
  "facturePdf.filigrane": "Storniert",

  /* --- Accusé de réception du formulaire de contact ------------------------ */

  "contact.objet": "Wir haben Ihre Nachricht erhalten — {sujet}",
  "contact.titre": "Ihre Nachricht ist angekommen",
  "contact.recu":
    "Vielen Dank, Ihre Nachricht ist gut bei uns angekommen. Wir antworten Ihnen innerhalb von zwei Werktagen\nan diese E-Mail-Adresse.",
  "contact.rappel": "Das haben Sie uns geschrieben:",
  "contact.inutile":
    "Diese E-Mail ist eine Empfangsbestätigung: Sie müssen nicht darauf antworten, können es aber gern tun,\nfalls Sie etwas vergessen haben.",
} satisfies Record<CleCourriel, string>;
