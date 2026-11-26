import type { CleCourriel } from "./fr.js";

/**
 * Les textes des courriels en italien.
 *
 * Tutoiement, comme le site. Ton chaleureux et simple. Les mots sont ceux du
 * site (section « it » de apps/web/src/i18n/ui.ts) : « poster », « carrello »,
 * « ordine », « spedizione », « cornice », « punto di ritiro »… Une cliente qui
 * lit « carrello » sur la page puis « cestino » dans le courrier se demande si
 * c'est bien la même chose.
 *
 * Quelques choix, pour qu'on ne les « corrige » pas par mégarde :
 *
 *   - « Ciao {prenom}, » : avec le tutoiement, « Buongiorno » sonnerait
 *     guindé. Sans prénom, « Ciao a te, » — la seule formule qui tienne debout
 *     sans nom, et qui ne dise ni « caro » ni « cara ».
 *   - Les guillemets « » collés au texte, comme le site (ponct.guillemets) ;
 *     ils passent aussi dans la police de la facture, qui ignore “ ”.
 *   - Les phrases genrées du français (« passée », « la cliente ») prennent une
 *     tournure qui ne dit pas le genre : on ne le connaît pas.
 *
 * Une clé absente partirait en français (voir `tc` dans ./index.ts) : toutes
 * sont là, et les variables entre accolades ne se traduisent pas.
 */
export const it: Partial<Record<CleCourriel, string>> = {
  /* --- Commun ------------------------------------------------------------- */

  "commun.bonjour": "Ciao {prenom},",
  "commun.prenomParDefaut": "a te",
  "commun.texteLien": "{libelle}: {lien}",
  "pied.signature": "Memory Line, poster personalizzati.",
  /**
   * Imprimée SOUS la mention française, pour information : elle en donne le
   * sens sans se faire passer pour le texte légal. Une seule ligne, comme la
   * place que lui laisse le pied de la facture.
   */
  "mention.tva":
    "IVA non applicabile ai sensi dell'art. 293 B del Codice generale delle imposte francese.",

  /* --- Les articles, dans tous les courriers qui en montrent ---------------- */

  "lignes.format": "Formato {format}",
  "lignes.indisponible": "Questo poster non è più disponibile.",
  "lignes.titreParDefaut": "Poster personalizzato",
  "lignes.ajustement": "Adeguamento del prezzo",

  /* --- Confirmation de commande ------------------------------------------- */

  "confirmation.objet": "Il tuo ordine {numero} è confermato",
  "confirmation.titre": "Grazie {prenom}!",
  /** Donne « Grazie di cuore! » quand on ne connaît pas le prénom. */
  "confirmation.prenomParDefaut": "di cuore",
  "confirmation.intro":
    "Il tuo ordine {numero} è stato registrato e pagato. Stiamo preparando il tuo poster.",
  "confirmation.sousTotal": "Subtotale",
  "confirmation.reduction": "Sconto",
  "confirmation.livraison": "Spedizione",
  "confirmation.total": "Totale",
  /** « Consegna » plutôt que « Indirizzo » : l'adresse peut être un point relais. */
  "confirmation.adresseLivraison": "Consegna:",
  "confirmation.retrait": "Da ritirare presso:",
  "confirmation.question": "Una domanda? Rispondi semplicemente a questa e-mail.",
  "confirmation.texte": "Il tuo ordine {numero} è confermato. Totale: {total}.",
  "confirmation.dontCarte": "Di cui pagato con la carta regalo {code}",
  "confirmation.carteEnvoyee": "Carta regalo da {montant} inviata per e-mail a {email}.",

  "lignes.carteCadeau": "Carta regalo",
  "lignes.carteCadeauPour": "Carta regalo per {email}",
  "carteCadeau.objet": "La tua carta regalo Memory Line da {montant}",
  "carteCadeau.objetDe": "{prenom} ti regala una carta regalo Memory Line",
  "carteCadeau.bonjour": "Buongiorno,",
  "carteCadeau.intro": "Ecco la tua carta regalo Memory Line, del valore di {montant}.",
  "carteCadeau.introDe": "{prenom} ti regala una carta regalo Memory Line, del valore di {montant}.",
  "carteCadeau.mot": "Il suo messaggio:",
  "carteCadeau.code": "Il tuo codice",
  "carteCadeau.mode":
    "Inserisci questo codice al momento del pagamento del tuo ordine su memoryline.fr, nel campo “Codice promo o carta regalo”.",
  "carteCadeau.solde":
    "Utilizzabile in una o più volte: il saldo residuo resta utilizzabile con lo stesso codice.",
  "carteCadeau.garder": "Conserva questa e-mail: questo codice vale denaro, come una banconota.",
  "carteCadeau.bouton": "Scegli un poster",
  "carteCadeau.texteCode": "Il tuo codice: {code} (valore {montant}).",

  /* --- Relance de panier : le courrier d'origine ----------------------------- */

  "panier.votrePanier": "Il tuo carrello",
  "panier.indispoUne":
    "Uno di questi poster non è più disponibile: il resto del tuo carrello ti aspetta ancora.",
  "panier.indispoPlusieurs":
    "Alcuni di questi poster non sono più disponibili: il resto del tuo carrello ti aspetta ancora.",
  "panier.promo": "Il tuo codice sconto {code} è già applicato.",
  "panier.desinscriptionRaison":
    "Ricevi questo messaggio perché hai lasciato un ordine in sospeso da noi.",
  "panier.desinscriptionLien": "Non ricevere più promemoria sul carrello",
  "panier.texteIntro":
    "Hai composto un poster senza completare l'ordine. Ti aspetta:",
  "panier.textePlusDisponible": "non più disponibile",
  "panier.texteTotal": "Totale: {montant}",

  /* --- Relance de panier : les textes par défaut des trois relances --------- */

  "relance.1.objet": "Il tuo poster ti aspetta",
  "relance.1.accroche": "Ciao {prenom},",
  "relance.1.message":
    "Hai composto un poster senza completare l'ordine. È ancora lì, proprio come l'hai lasciato.",
  /** Le libellé de la page « recuperer » du site, mot pour mot. */
  "relance.1.bouton": "Riprendi il mio ordine",
  "relance.1.conclusion": "Se hai cambiato idea, ignora pure questo messaggio.",

  "relance.2.objet": "Il tuo carrello ti aspetta ancora",
  "relance.2.accroche": "Ciao {prenom},",
  "relance.2.message":
    "Un piccolo promemoria: il tuo poster è ancora nel carrello, pronto per andare in stampa. Ti manca solo confermare l'ordine.",
  "relance.2.bouton": "Riprendi il mio ordine",
  "relance.2.conclusion":
    "Una domanda sul formato o sulla cornice? Rispondi semplicemente a questo messaggio.",

  "relance.3.objet": "Ultimo promemoria per il tuo poster",
  "relance.3.accroche": "Ciao {prenom},",
  "relance.3.message":
    "È il nostro ultimo messaggio sul tuo carrello: non ti scriveremo più a riguardo. Il tuo poster ti aspetta ancora per qualche giorno.",
  "relance.3.bouton": "Completa il mio ordine",
  "relance.3.conclusion": "Se hai cambiato idea, ignora pure questo messaggio.",

  "relance.articleCite": "«{titre}»",
  "relance.articlesEt": "{debut} e {dernier}",
  "relance.articleParDefaut": "il tuo poster",

  /* --- Commande expédiée -------------------------------------------------- */

  "expediee.objet": "Il tuo ordine {numero} è in viaggio",
  "expediee.intro": "Il tuo poster è partito. Sta arrivando.",
  "expediee.introPar": "Il tuo poster è partito con {transporteur}. Sta arrivando.",
  /** Le libellé de l'espace client (« I miei ordini »), mot pour mot. */
  "expediee.bouton": "Segui il pacco",
  "expediee.numeroSuivi": "Numero di tracciamento: {numero}",
  "expediee.delai":
    "Il tracciamento potrebbe impiegare qualche giorno ad attivarsi: il corriere ha bisogno di un po' di tempo per registrare il pacco.",
  "expediee.texte": "Il tuo ordine {numero} è partito.",
  "expediee.textePar": "Il tuo ordine {numero} è partito con {transporteur}.",
  "expediee.texteSuivi": "Tracciamento: {lien}",

  /* --- Affiche prête au stand --------------------------------------------- */

  "stand.objet": "Il tuo poster è pronto",
  "stand.intro":
    "Il poster che hai ordinato è pronto. Ti ricontatteremo per la consegna, oppure lo riceverai a breve se deve esserti spedito.",
  /**
   * « in occasione di » et non « a » : le nom du salon est saisi tel quel par
   * la boutique (« Salon du livre de Nantes 2026 »), et l'italien voudrait un
   * article accordé qu'on ne peut pas deviner.
   */
  "stand.introSur":
    "Il poster che hai ordinato in occasione di {evenement} è pronto. Ti ricontatteremo per la consegna, oppure lo riceverai a breve se deve esserti spedito.",
  /** « passato / passata » dirait un genre qu'on ne connaît pas : la visite, elle, n'en a pas. */
  "stand.merci": "Ordine {numero}. Grazie per la visita al nostro stand.",
  "stand.texte": "Il poster che hai ordinato è pronto.",
  "stand.texteSur": "Il poster che hai ordinato in occasione di {evenement} è pronto.",
  "stand.texteCommande": "Ordine {numero}.",

  /* --- Ordine pronto per il ritiro ---------------------------------------- */

  "retrait.objet": "Il tuo ordine {numero} ti aspetta",
  "retrait.intro": "Il tuo ordine è pronto: puoi venire a ritirarlo.",
  "retrait.ou": "Dove ritirarlo:",
  "retrait.merci": "Ordine {numero}. A presto!",
  "retrait.texte": "Il tuo ordine {numero} è pronto: puoi venire a ritirarlo.",

  /* --- Bienvenue ---------------------------------------------------------- */

  /** « Benvenuto / Benvenuta » dirait un genre : la tournure verbale n'en dit pas. */
  "bienvenue.objet": "Ti diamo il benvenuto su Memory Line",
  "bienvenue.intro":
    "Il tuo account è stato creato. Qui trovi i tuoi ordini e il loro tracciamento, i poster che hai composto e gli indirizzi di spedizione che salvi una volta per tutte.",
  "bienvenue.bouton": "Vai al mio account",
  "bienvenue.securite":
    "Non ti chiederemo mai la tua password per e-mail. Una domanda? Rispondi semplicemente a questo messaggio.",
  "bienvenue.texte":
    "Il tuo account Memory Line è stato creato. Qui trovi i tuoi ordini e il loro tracciamento, i tuoi poster e i tuoi indirizzi di spedizione.",

  /* --- Mot de passe modifié ----------------------------------------------- */

  "mdpModifie.objet": "La password del tuo account è stata cambiata",
  "mdpModifie.parReinit":
    "La password del tuo account Memory Line è appena stata cambiata, tramite il link di reimpostazione richiesto dalla pagina di accesso. Tutte le sessioni aperte sono state chiuse: dovrai accedere di nuovo su ogni dispositivo.",
  "mdpModifie.parCompte":
    "La password del tuo account Memory Line è appena stata cambiata dal tuo account.",
  /** « Se non sei stato tu » dirait un genre : « se non l'hai fatto tu » n'en dit pas. */
  "mdpModifie.alerte":
    "Se questa modifica non l'hai fatta tu, il tuo account non è più sotto il tuo controllo. Richiedi subito una nuova password dalla pagina di accesso, poi avvisaci rispondendo a questo messaggio.",
  "mdpModifie.bouton": "Riprendi il controllo del mio account",
  "mdpModifie.avis":
    "Questo messaggio è un avviso di sicurezza. Non contiene nessuna password e non ti chiederemo mai la tua.",
  "mdpModifie.texteParReinit":
    "La password del tuo account Memory Line è appena stata cambiata, tramite il link di reimpostazione che avevi richiesto. Tutte le sessioni aperte sono state chiuse.",
  "mdpModifie.texteAlerte":
    "Se non l'hai fatto tu, richiedi subito una nuova password dalla pagina di accesso.",
  "mdpModifie.texteAlerteLien":
    "Se non l'hai fatto tu, richiedi subito una nuova password dalla pagina di accesso: {lien}",

  /* --- Réinitialisation du mot de passe ----------------------------------- */

  "reinit.objet": "Reimposta la tua password",
  "reinit.intro":
    "Hai chiesto di cambiare la password del tuo account Memory Line. Questo link è valido per un'ora e funziona una sola volta.",
  "reinit.bouton": "Scegli una nuova password",
  "reinit.ignorer":
    "Se non hai fatto tu questa richiesta, ignora questo messaggio: la tua password attuale resta valida.",
  "reinit.texteLien":
    "Per scegliere una nuova password (link valido per un'ora): {lien}",
  "reinit.texteIgnorer":
    "Se non hai fatto tu questa richiesta, ignora questo messaggio.",

  /* --- Commande remboursée ------------------------------------------------ */

  "remboursee.objet": "Rimborso del tuo ordine {numero}",
  "remboursee.objetPartiel": "Rimborso parziale del tuo ordine {numero}",
  "remboursee.intro":
    "Abbiamo registrato un rimborso di {montant} sul tuo ordine {numero}.",
  "remboursee.partiel":
    "Si tratta di un rimborso parziale: il resto del tuo ordine non è interessato.",
  "remboursee.port": "Di cui spese di spedizione: {montant}.",
  "remboursee.cumul":
    "In totale ti sono stati rimborsati {total} su questo ordine di {commande}.",
  "remboursee.delaiEnLigne":
    "L'importo torna sul metodo di pagamento usato per l'ordine. Possono servire alcuni giorni lavorativi prima di vederlo sul tuo estratto conto: sono i tempi della tua banca, non dipendono da noi.",
  "remboursee.horsLigne":
    "Questo rimborso avviene al di fuori del pagamento online. Ti ricontatteremo se ci manca qualche informazione per effettuarlo.",
  "remboursee.carte":
    "{montant} tornano sulla tua carta regalo: il saldo resta utilizzabile con lo stesso codice.",
  "remboursee.question":
    "Una domanda su questo rimborso? Rispondi semplicemente a questa e-mail.",
  "remboursee.texte":
    "È stato registrato un rimborso di {montant} sul tuo ordine {numero}.",
  "remboursee.textePartiel":
    "Si tratta di un rimborso parziale: il resto dell'ordine non è interessato.",
  "remboursee.texteDelai":
    "Possono servire alcuni giorni lavorativi prima di vederlo sul tuo estratto conto.",
  "remboursee.texteHorsLigne": "Questo rimborso avviene al di fuori del pagamento online.",

  /* --- Commande annulée --------------------------------------------------- */

  "annulee.objet": "Il tuo ordine {numero} è stato annullato",
  "annulee.intro":
    "Il tuo ordine {numero} è stato annullato. Non verrà prodotto né spedito nulla.",
  "annulee.motif": "Motivo: {motif}",
  "annulee.argent":
    "L'importo pagato ti verrà restituito. Riceverai un messaggio dedicato non appena il rimborso sarà registrato, con i dettagli e i tempi.",
  "annulee.surprise":
    "Se questo annullamento ti sorprende, rispondi a questo messaggio: riprenderemo l'ordine insieme a te.",
  "annulee.texteArgent":
    "L'importo pagato ti verrà restituito; seguirà un messaggio dedicato non appena il rimborso sarà registrato.",
  "annulee.motifSaisie": "Errore di inserimento",
  "annulee.motifRupture": "Esaurito — articolo non disponibile",
  /**
   * Ce motif n'est lu que par la personne qui l'a demandé (le courrier
   * d'annulation) : « su tua richiesta » lui parle directement, sans dire
   * « del cliente » ni « della cliente ».
   */
  "annulee.motifCliente": "Su tua richiesta",
  "annulee.motifImpaye": "Pagamento non ricevuto",

  /* --- Facture : le courrier ---------------------------------------------- */

  "facture.objet": "La tua fattura {facture} — ordine {numero}",
  "facture.intro": "Ecco la fattura del tuo ordine {numero}, in allegato.",
  "facture.numeroFacture": "Fattura n.",
  "facture.commande": "Ordine",
  "facture.montant": "Importo",
  "facture.reglee":
    "Questo ordine è stato pagato: la fattura risulta saldata, non devi fare nulla.",
  "facture.nonReglee":
    "Questo ordine non è ancora stato pagato. Ti ricontatteremo se ci manca un pagamento.",
  "facture.question":
    "Una domanda su questa fattura? Rispondi semplicemente a questa e-mail.",
  "facture.texteNumero": "Fattura n. {facture} — {montant}.",
  "facture.texteReglee": "Questo ordine è stato pagato: la fattura risulta saldata.",
  "facture.texteNonReglee": "Questo ordine non è ancora stato pagato.",

  /* --- Facture : le PDF joint --------------------------------------------- */

  "facturePdf.nomFichier": "Fattura",
  "facturePdf.titreDocument": "Fattura {facture} - Memory Line",
  "facturePdf.sujetDocument": "Ordine {numero}",
  "facturePdf.titre": "FATTURA",
  "facturePdf.numero": "N. {facture}",
  /**
   * « in data » et non « il » / « del » devant la date : l'article s'élide
   * devant 8 et 11 (« l'8 », « dell'11 »), ce qu'un modèle ne peut pas
   * savoir d'avance. « Emessa il 8 settembre » serait une faute un jour sur
   * quinze. Même tournure pour la commande et l'annulation, plus bas.
   */
  "facturePdf.emiseLe": "Emessa in data {date}",
  "facturePdf.emetteur": "EMITTENTE",
  "facturePdf.activite": "Poster personalizzati",
  "facturePdf.factureA": "INTESTATA A",
  "facturePdf.clientParDefaut": "Cliente",
  "facturePdf.commandeDu": "Ordine {numero} in data {date}",
  "facturePdf.reglee": "Ordine pagato. Fattura saldata.",
  "facturePdf.dontCarte": "Di cui {montant} pagati con carta regalo.",
  "facturePdf.nonReglee": "Ordine non ancora pagato.",
  "facturePdf.annulee": "Ordine annullato",
  "facturePdf.annuleeLe": "Ordine annullato in data {date}",
  "facturePdf.designation": "DESCRIZIONE",
  /** L'abréviation du site (« Q.tà »), en capitales ; « À » passe dans la police. */
  "facturePdf.quantite": "Q.TÀ",
  "facturePdf.prixUnitaire": "PREZZO UNIT.",
  "facturePdf.totalColonne": "TOTALE",
  "facturePdf.texteAffiche": "«{texte}»",
  "facturePdf.sousTotal": "Subtotale",
  "facturePdf.reduction": "Sconto",
  "facturePdf.livraison": "Spedizione",
  "facturePdf.totalAPayer": "TOTALE DA PAGARE",
  "facturePdf.dontRembourse": "Di cui rimborsato",
  "facturePdf.netEncaisse": "Netto incassato",
  "facturePdf.pied":
    "Memory Line, poster personalizzati. Una domanda su questa fattura? Rispondi all'e-mail con cui ti è arrivata.",
  /** « Fattura » est féminin : c'est elle qui est annulée. */
  "facturePdf.filigrane": "Annullata",
  "facturePdf.retrait": "Ritiro: {lieu}",

  "livraison.remiseStand": "Ritiro al nostro stand",

  /* --- Accusé de réception du formulaire de contact ------------------------ */

  "contact.objet": "Abbiamo ricevuto il tuo messaggio — {sujet}",
  "contact.titre": "Il tuo messaggio è arrivato",
  "contact.recu":
    "Il tuo messaggio è arrivato. Ti risponderemo entro due giorni lavorativi,\na questo stesso indirizzo.",
  "contact.rappel": "Ecco cosa ci hai scritto:",
  "contact.inutile":
    "Questa e-mail è una conferma di ricezione: non serve rispondere, ma puoi\nfarlo se hai dimenticato qualcosa.",
} satisfies Record<CleCourriel, string>;
