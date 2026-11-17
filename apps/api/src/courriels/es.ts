import type { CleCourriel } from "./fr.js";

/**
 * Les textes des courriels en espagnol (d'Espagne).
 *
 * Tutoiement, comme le site. Ton chaleureux et simple, et les mots du site
 * (apps/web/src/i18n/ui.ts, section « es ») : « lámina » pour l'affiche,
 * « cesta » pour le panier, « pedido », « envío », « código de descuento »,
 * « punto de recogida » — une cliente qui lit « póster » dans le courrier et
 * « lámina » sur la page se demanderait si c'est la même chose.
 *
 * Les clés, leur texte français et leur contexte sont dans ./fr.ts ; les
 * variables entre accolades ne se traduisent pas. Une clé oubliée ici partirait
 * en français (voir `tc` dans ./index.ts) : elles y sont donc toutes.
 *
 * Quelques choix qui ne vont pas de soi :
 *   - « ¡Hola, {prenom}! » plutôt que « Hola, {prenom}: » : la formule sert de
 *     grand titre, où les deux-points de la lettre espagnole se lisent mal.
 *     Sans prénom, « ¡Hola, qué tal! » : l'espagnol n'a pas d'équivalent au
 *     « Bonjour vous, » français, et la virgule du modèle interdit le simple
 *     « ¡Hola! ».
 *   - Les guillemets sont ceux du site, « «…» » sans espace (ponct.guillemets).
 *   - Une commande annulée est « cancelado », comme sur la page de reprise du
 *     panier ; la facture annulée, elle, est « anulada », le mot des factures
 *     en Espagne.
 *   - Le salon du stand s'écrit entre parenthèses, « en nuestro puesto
 *     ({evenement}) » : son nom est saisi par la boutique, sans article, et
 *     « en Salón del Libro… » serait boiteux.
 *   - Les textes du PDF ne passent pas à la ligne (pdf.ts les écrit d'un
 *     trait) : ceux du pied et de la mention de TVA restent de la longueur du
 *     français.
 */
export const es: Partial<Record<CleCourriel, string>> = {
  /* --- Commun ------------------------------------------------------------- */

  "commun.bonjour": "¡Hola, {prenom}!",
  "commun.prenomParDefaut": "qué tal",
  "commun.texteLien": "{libelle}: {lien}",
  "pied.signature": "Memory Line, láminas personalizadas.",
  // Pour information seulement : la mention qui fait foi reste la française,
  // imprimée au-dessus. Reprend les mots du panier du site (panier.taxes).
  "mention.tva":
    "IVA no aplicable: régimen francés de franquicia, art. 293 B del Código General de Impuestos.",

  /* --- Les articles, dans tous les courriers qui en montrent ---------------- */

  "lignes.format": "Formato {format}",
  "lignes.indisponible": "Esta lámina ya no está disponible.",
  "lignes.titreParDefaut": "Lámina personalizada",

  /* --- Confirmation de commande ------------------------------------------- */

  "confirmation.objet": "Tu pedido {numero} está confirmado",
  "confirmation.titre": "¡Gracias, {prenom}!",
  // « ¡Gracias, de verdad! » : se lit tout seul, sans prénom.
  "confirmation.prenomParDefaut": "de verdad",
  "confirmation.intro":
    "Tu pedido {numero} está registrado y pagado. Ya estamos preparando tu lámina.",
  "confirmation.sousTotal": "Subtotal",
  "confirmation.reduction": "Descuento",
  "confirmation.livraison": "Envío",
  "confirmation.total": "Total",
  "confirmation.adresseLivraison": "Dirección de envío:",
  "confirmation.retrait": "Recogida en:",
  "confirmation.question": "¿Tienes alguna pregunta? Solo tienes que responder a este correo.",
  "confirmation.texte": "Tu pedido {numero} está confirmado. Total: {total}.",
  "confirmation.dontCarte": "De lo cual pagado con la tarjeta regalo {code}",
  "confirmation.carteEnvoyee": "Tarjeta regalo de {montant} enviada por e-mail a {email}.",

  "lignes.carteCadeau": "Tarjeta regalo",
  "lignes.carteCadeauPour": "Tarjeta regalo para {email}",
  "carteCadeau.objet": "Tu tarjeta regalo Memory Line de {montant}",
  "carteCadeau.objetDe": "{prenom} te regala una tarjeta regalo Memory Line",
  "carteCadeau.bonjour": "Hola:",
  "carteCadeau.intro": "Aquí tienes tu tarjeta regalo Memory Line, por un valor de {montant}.",
  "carteCadeau.introDe": "{prenom} te regala una tarjeta regalo Memory Line, por un valor de {montant}.",
  "carteCadeau.mot": "Su mensaje:",
  "carteCadeau.code": "Tu código",
  "carteCadeau.mode":
    "Introduce este código al pagar tu pedido en memoryline.fr, en el campo «Código promocional o tarjeta regalo».",
  "carteCadeau.solde":
    "Utilizable en una o varias veces: el saldo restante sigue disponible con el mismo código.",
  "carteCadeau.garder": "Guarda este e-mail: este código vale dinero, como un billete.",
  "carteCadeau.bouton": "Elegir una lámina",
  "carteCadeau.texteCode": "Tu código: {code} (valor {montant}).",

  /* --- Relance de panier : le courrier d'origine ----------------------------- */

  "panier.votrePanier": "Tu cesta",
  "panier.indispoUne":
    "Una de estas láminas ya no está disponible: el resto de tu cesta te sigue esperando.",
  "panier.indispoPlusieurs":
    "Algunas de estas láminas ya no están disponibles: el resto de tu cesta te sigue esperando.",
  "panier.promo": "Tu código de descuento {code} ya está aplicado.",
  "panier.desinscriptionRaison":
    "Recibes este mensaje porque has dejado un pedido a medias en nuestra tienda.",
  "panier.desinscriptionLien": "Dejar de recibir recordatorios de la cesta",
  "panier.texteIntro":
    "Has creado una lámina pero no has terminado tu pedido. Te está esperando:",
  "panier.textePlusDisponible": "ya no está disponible",
  "panier.texteTotal": "Total: {montant}",

  /* --- Relance de panier : les textes par défaut des trois relances --------- */

  "relance.1.objet": "Tu lámina te espera",
  "relance.1.accroche": "¡Hola, {prenom}!",
  "relance.1.message":
    "Has creado una lámina pero no has terminado tu pedido. Sigue ahí, tal y como la dejaste.",
  // Le libellé du bouton de la page de reprise du panier (panier.recuperer.bouton).
  "relance.1.bouton": "Retomar mi pedido",
  "relance.1.conclusion": "Si has cambiado de idea, no hagas caso de este mensaje.",

  "relance.2.objet": "Tu cesta sigue esperándote",
  "relance.2.accroche": "¡Hola, {prenom}!",
  "relance.2.message":
    "Un pequeño recordatorio: tu lámina sigue en la cesta, lista para pasar a impresión. Solo te queda confirmar tu pedido.",
  "relance.2.bouton": "Retomar mi pedido",
  "relance.2.conclusion":
    "¿Alguna duda sobre el formato o el marco? Solo tienes que responder a este mensaje.",

  "relance.3.objet": "Último recordatorio sobre tu lámina",
  "relance.3.accroche": "¡Hola, {prenom}!",
  "relance.3.message":
    "Es nuestro último mensaje sobre tu cesta: no volveremos a escribirte por este tema. Tu lámina te seguirá esperando unos días más.",
  "relance.3.bouton": "Finalizar mi pedido",
  "relance.3.conclusion": "Si has cambiado de idea, no hagas caso de este mensaje.",

  "relance.articleCite": "«{titre}»",
  // « y » et non « e » : le mot suivant commence toujours par un guillemet.
  "relance.articlesEt": "{debut} y {dernier}",
  "relance.articleParDefaut": "tu lámina",

  /* --- Commande expédiée -------------------------------------------------- */

  "expediee.objet": "Tu pedido {numero} está en camino",
  "expediee.intro": "Tu lámina ya ha salido. Llegará muy pronto.",
  "expediee.introPar": "Tu lámina ya ha salido con {transporteur}. Llegará muy pronto.",
  "expediee.bouton": "Seguir mi paquete",
  "expediee.numeroSuivi": "Número de seguimiento: {numero}",
  "expediee.delai":
    "El seguimiento puede tardar unos días en actualizarse: el transportista necesita un tiempo para registrar el paquete.",
  "expediee.texte": "Tu pedido {numero} ya ha salido.",
  "expediee.textePar": "Tu pedido {numero} ya ha salido con {transporteur}.",
  "expediee.texteSuivi": "Seguimiento: {lien}",

  /* --- Affiche prête au stand --------------------------------------------- */

  "stand.objet": "Tu lámina está lista",
  "stand.intro":
    "La lámina que has encargado ya está lista. Nos pondremos en contacto contigo para la entrega o, si tiene que viajar, la recibirás en breve.",
  "stand.introSur":
    "La lámina que encargaste en nuestro puesto ({evenement}) ya está lista. Nos pondremos en contacto contigo para la entrega o, si tiene que viajar, la recibirás en breve.",
  // « pasarte » ne dit ni « passé » ni « passée » : la phrase vaut pour tous.
  "stand.merci": "Pedido {numero}. ¡Gracias por pasarte a vernos!",
  "stand.texte": "La lámina que has encargado ya está lista.",
  "stand.texteSur": "La lámina que encargaste en nuestro puesto ({evenement}) ya está lista.",
  "stand.texteCommande": "Pedido {numero}.",

  /* --- Pedido listo para recoger ------------------------------------------ */

  "retrait.objet": "Tu pedido {numero} te espera",
  "retrait.intro": "Tu pedido está listo: puedes venir a recogerlo.",
  "retrait.ou": "Dónde recogerlo:",
  "retrait.merci": "Pedido {numero}. ¡Hasta pronto!",
  "retrait.texte": "Tu pedido {numero} está listo: puedes venir a recogerlo.",

  /* --- Bienvenue ---------------------------------------------------------- */

  // « Te damos la bienvenida » plutôt que « Bienvenido/a » : sans genre.
  "bienvenue.objet": "Te damos la bienvenida a Memory Line",
  "bienvenue.intro":
    "Tu cuenta ya está creada. En ella encontrarás tus pedidos y su seguimiento, las láminas que has creado y las direcciones de envío que guardes, para no tener que escribirlas otra vez.",
  "bienvenue.bouton": "Ir a mi cuenta",
  "bienvenue.securite":
    "Nunca te pediremos tu contraseña por correo. ¿Tienes alguna pregunta? Solo tienes que responder a este mensaje.",
  "bienvenue.texte":
    "Tu cuenta de Memory Line ya está creada. En ella encontrarás tus pedidos y su seguimiento, tus láminas y tus direcciones de envío.",

  /* --- Mot de passe modifié ----------------------------------------------- */

  "mdpModifie.objet": "Se ha cambiado la contraseña de tu cuenta",
  "mdpModifie.parReinit":
    "La contraseña de tu cuenta de Memory Line se acaba de cambiar mediante el enlace de restablecimiento solicitado desde la página de inicio de sesión. Hemos cerrado todas las sesiones abiertas: tendrás que volver a iniciar sesión en cada dispositivo.",
  "mdpModifie.parCompte":
    "La contraseña de tu cuenta de Memory Line se acaba de cambiar desde tu área de cliente.",
  "mdpModifie.alerte":
    "Si no has hecho tú este cambio, has perdido el control de tu cuenta. Pide de inmediato una nueva contraseña desde la página de inicio de sesión y después avísanos respondiendo a este mensaje.",
  "mdpModifie.bouton": "Recuperar el control de mi cuenta",
  "mdpModifie.avis":
    "Este mensaje es un aviso de seguridad. No contiene ninguna contraseña, y nunca te pediremos la tuya.",
  "mdpModifie.texteParReinit":
    "La contraseña de tu cuenta de Memory Line se acaba de cambiar mediante el enlace de restablecimiento que habías solicitado. Hemos cerrado todas las sesiones abiertas.",
  "mdpModifie.texteAlerte":
    "Si no has sido tú, pide de inmediato una nueva contraseña desde la página de inicio de sesión.",
  "mdpModifie.texteAlerteLien":
    "Si no has sido tú, pide de inmediato una nueva contraseña desde la página de inicio de sesión: {lien}",

  /* --- Réinitialisation du mot de passe ----------------------------------- */

  "reinit.objet": "Restablece tu contraseña",
  "reinit.intro":
    "Has pedido cambiar la contraseña de tu cuenta de Memory Line. Este enlace es válido durante una hora y solo se puede usar una vez.",
  "reinit.bouton": "Elegir una nueva contraseña",
  "reinit.ignorer":
    "Si no has hecho tú esta solicitud, ignora este mensaje: tu contraseña actual sigue siendo válida.",
  "reinit.texteLien":
    "Para elegir una nueva contraseña (enlace válido durante una hora): {lien}",
  "reinit.texteIgnorer": "Si no has hecho tú esta solicitud, ignora este mensaje.",

  /* --- Commande remboursée ------------------------------------------------ */

  "remboursee.objet": "Reembolso de tu pedido {numero}",
  "remboursee.objetPartiel": "Reembolso parcial de tu pedido {numero}",
  "remboursee.intro": "Hemos registrado un reembolso de {montant} en tu pedido {numero}.",
  "remboursee.partiel":
    "Se trata de un reembolso parcial: el resto de tu pedido no se ve afectado.",
  "remboursee.port": "Gastos de envío incluidos: {montant}.",
  "remboursee.cumul": "En total, te hemos devuelto {total} de este pedido de {commande}.",
  "remboursee.delaiEnLigne":
    "El importe se devuelve al método de pago que usaste en el pedido. Cuenta con unos días laborables hasta verlo en tu extracto: ese plazo depende de tu banco, no de nosotros.",
  "remboursee.horsLigne":
    "Este reembolso se hace al margen del pago en línea. Te escribiremos si nos falta algún dato para hacértelo llegar.",
  "remboursee.carte":
    "{montant} vuelven a tu tarjeta regalo: su saldo sigue disponible con el mismo código.",
  "remboursee.question":
    "¿Alguna pregunta sobre este reembolso? Solo tienes que responder a este correo.",
  "remboursee.texte": "Se ha registrado un reembolso de {montant} en tu pedido {numero}.",
  "remboursee.textePartiel":
    "Se trata de un reembolso parcial: el resto del pedido no se ve afectado.",
  "remboursee.texteDelai": "Cuenta con unos días laborables hasta verlo en tu extracto.",
  "remboursee.texteHorsLigne": "Este reembolso se hace al margen del pago en línea.",

  /* --- Commande annulée --------------------------------------------------- */

  "annulee.objet": "Tu pedido {numero} se ha cancelado",
  "annulee.intro":
    "Tu pedido {numero} se ha cancelado. No se fabricará ni se enviará nada.",
  "annulee.motif": "Motivo: {motif}",
  "annulee.argent":
    "Te devolvemos el importe pagado. Recibirás un mensaje aparte en cuanto se registre el reembolso, con el detalle y el plazo.",
  "annulee.surprise":
    "Si esta cancelación te sorprende, responde a este mensaje y retomaremos el pedido contigo.",
  "annulee.texteArgent":
    "Te devolvemos el importe pagado; recibirás un mensaje aparte en cuanto se registre el reembolso.",
  "annulee.motifSaisie": "Error al registrar el pedido",
  "annulee.motifRupture": "Agotado — artículo no disponible",
  // Le motif n'est lu que par la cliente elle-même, dans son courrier : « tu
  // petición » évite le genre que porterait « del cliente » / « de la clienta ».
  "annulee.motifCliente": "A petición tuya",
  "annulee.motifImpaye": "Pago no recibido",

  /* --- Facture : le courrier ---------------------------------------------- */

  "facture.objet": "Tu factura {facture} — pedido {numero}",
  "facture.intro": "Te adjuntamos la factura de tu pedido {numero}.",
  "facture.numeroFacture": "Factura n.º",
  "facture.commande": "Pedido",
  "facture.montant": "Importe",
  "facture.reglee":
    "Este pedido está pagado: la factura está saldada y no tienes que hacer nada.",
  "facture.nonReglee":
    "Este pedido todavía no está pagado. Te escribiremos si nos falta algún pago.",
  "facture.question":
    "¿Alguna pregunta sobre esta factura? Solo tienes que responder a este correo.",
  "facture.texteNumero": "Factura n.º {facture} — {montant}.",
  "facture.texteReglee": "Este pedido está pagado: la factura está saldada.",
  "facture.texteNonReglee": "Este pedido todavía no está pagado.",

  /* --- Facture : le PDF joint --------------------------------------------- */

  "facturePdf.nomFichier": "Factura",
  "facturePdf.titreDocument": "Factura {facture} - Memory Line",
  "facturePdf.sujetDocument": "Pedido {numero}",
  "facturePdf.titre": "FACTURA",
  "facturePdf.numero": "N.º {facture}",
  "facturePdf.emiseLe": "Emitida el {date}",
  "facturePdf.emetteur": "EMISOR",
  "facturePdf.activite": "Láminas personalizadas",
  "facturePdf.factureA": "FACTURADO A",
  "facturePdf.clientParDefaut": "Cliente",
  "facturePdf.commandeDu": "Pedido {numero} del {date}",
  "facturePdf.reglee": "Pedido pagado. Factura saldada.",
  "facturePdf.nonReglee": "Pedido pendiente de pago a día de hoy.",
  "facturePdf.annulee": "Pedido cancelado",
  "facturePdf.annuleeLe": "Pedido cancelado el {date}",
  // « Concepto » et « Importe » : les intitulés d'une facture espagnole.
  "facturePdf.designation": "CONCEPTO",
  "facturePdf.quantite": "CANT.",
  "facturePdf.prixUnitaire": "PRECIO UNIT.",
  "facturePdf.totalColonne": "IMPORTE",
  "facturePdf.texteAffiche": "«{texte}»",
  "facturePdf.sousTotal": "Subtotal",
  "facturePdf.reduction": "Descuento",
  "facturePdf.livraison": "Envío",
  "facturePdf.totalAPayer": "TOTAL A PAGAR",
  "facturePdf.dontRembourse": "Reembolsado",
  "facturePdf.netEncaisse": "Neto cobrado",
  "facturePdf.pied":
    "Memory Line, láminas personalizadas. ¿Alguna pregunta sobre esta factura? Responde al correo con el que te llegó.",
  "facturePdf.filigrane": "Anulada",
  "facturePdf.retrait": "Recogida: {lieu}",

  "livraison.remiseStand": "Entrega en nuestro stand",

  /* --- Accusé de réception du formulaire de contact ------------------------ */

  "contact.objet": "Hemos recibido tu mensaje — {sujet}",
  "contact.titre": "Tu mensaje nos ha llegado",
  "contact.recu":
    "Tu mensaje nos ha llegado sin problema. Te responderemos en un plazo de dos días laborables,\na esta misma dirección.",
  "contact.rappel": "Esto es lo que nos has escrito:",
  "contact.inutile":
    "Este correo es un acuse de recibo: no hace falta que respondas, aunque\npuedes hacerlo si se te ha olvidado algo.",
} satisfies Record<CleCourriel, string>;
