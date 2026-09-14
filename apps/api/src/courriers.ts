/**
 * Banc d'essai des courriers de la boutique.
 *
 * Les courriers que Memory Line envoie (confirmation, expédition, remboursement,
 * relance de panier, bienvenue, avis de sécurité…) ne se voient autrement qu'en
 * attendant qu'un vrai client déclenche l'un d'eux. Ce fichier offre le
 * raccourci : afficher n'importe lequel, tel qu'il sortira, avec un jeu
 * d'exemple ou avec les données d'une vraie commande, et s'en envoyer un pour
 * de bon afin de le lire dans une boîte de réception.
 *
 * Deux principes gouvernent le tout. L'aperçu ne fait que LIRE : il rend du
 * HTML et n'envoie jamais rien. L'envoi, lui, sort de la machine dès que la
 * boîte d'essai est coupée, alors chaque réponse dit noir sur blanc où le
 * courrier est allé : dans la boîte d'essai, ou chez la personne visée.
 *
 * Aucun modèle n'est écrit ici. Tout vient de mail.ts, sans quoi l'aperçu
 * montrerait une jolie page que le client ne recevra jamais.
 */
import type { Hono } from "hono";
import { eq, or, sql } from "drizzle-orm";
import { db, schema } from "./db/client.js";
import {
  courrierAnnulee,
  courrierBienvenue,
  courrierExpediee,
  courrierFacture,
  courrierMotDePasseModifie,
  courrierPreteAuStand,
  courrierConfirmation,
  courrierNouvelleCommande,
  courrierPanierAbandonne,
  courrierReinitialisation,
  courrierRemboursee,
  envoyer,
  estConfigure,
  estEnEssai,
  type Courrier,
  type LigneCourrier,
} from "./mail.js";
// La vignette d'un produit se compose au même endroit que la relance de
// panier, seul courrier qui l'affiche : deux façons de fabriquer cette adresse
// finiraient par diverger, et l'aperçu montrerait une image que le vrai
// courrier n'a pas.
import { cheminApercu } from "./apercus.js";

/**
 * L'adresse publique du site, pour les images des courriers.
 *
 * Un courrier ne sait pas résoudre un chemin relatif : sans origine, la
 * vignette ne s'afficherait nulle part. Le repli de développement vaut mieux
 * qu'une adresse absente.
 */
const ORIGINE_PUBLIQUE =
  (process.env.PUBLIC_ORIGIN ?? "").replace(/\/+$/, "") || "http://localhost:8080";

/* -------------------------------------------------------------------------- */
/*  Réglages affichés                                                         */
/* -------------------------------------------------------------------------- */

/*
 * mail.ts garde ses réglages pour lui : il n'a besoin que de savoir s'il peut
 * envoyer. L'écran d'état, lui, doit les MONTRER. On relit donc les mêmes
 * variables plutôt que d'élargir mail.ts, dont dépendent le paiement, les
 * comptes et les relances : une signature de plus là-bas se paierait partout.
 * Toute évolution de la logique de mail.ts est à répercuter ici.
 */
const COPIE = (process.env.MAIL_BCC ?? "").trim();
const BOITE_TEST = (process.env.MAIL_TEST_URL ?? "").trim().replace(/\/+$/, "");

/**
 * La même boîte d'essai, mais telle qu'un NAVIGATEUR peut l'atteindre.
 *
 * L'API lui parle par son nom de service Docker, « http://mailpit:8025 ». Ce
 * nom n'existe qu'entre les conteneurs : donné en lien au back-office, il ne
 * mène nulle part, et c'est exactement ce qui s'est produit. Un nom d'hôte
 * sans point est forcément un service Docker, jamais un domaine : on le
 * remplace par la machine de la personne, en gardant le port.
 *
 * MAIL_TEST_PUBLIC_URL permet de dire autre chose le jour où la boîte d'essai
 * vivra ailleurs que sur le poste de travail.
 */
const BOITE_TEST_NAVIGATEUR = (() => {
  const annoncee = (process.env.MAIL_TEST_PUBLIC_URL ?? "").trim();
  if (annoncee) return annoncee.replace(/\/+$/, "");
  if (!BOITE_TEST) return "";
  try {
    const u = new URL(BOITE_TEST);
    if (!u.hostname.includes(".") && u.hostname !== "localhost") {
      u.hostname = "localhost";
      return u.toString().replace(/\/+$/, "");
    }
  } catch {
    /* adresse illisible : on la rend telle quelle, elle sera visible */
  }
  return BOITE_TEST;
})();
const EXPEDITEUR =
  (process.env.MAIL_FROM ?? "").trim() ||
  (BOITE_TEST ? "Memory Line (essai) <boutique@memoryline.test>" : "");

/** Origine publique du site, pour les liens cliquables des courriers. */
const ORIGINE = (process.env.PUBLIC_ORIGIN ?? "").replace(/\/$/, "");

/* -------------------------------------------------------------------------- */
/*  Les modèles                                                               */
/* -------------------------------------------------------------------------- */

type IdModele =
  | "confirmation"
  | "expediee"
  | "prete-au-stand"
  | "remboursee"
  | "annulee"
  | "facture"
  | "nouvelle-commande"
  | "panier-abandonne"
  | "bienvenue"
  | "mot-de-passe-modifie"
  | "reinitialisation";

interface Modele {
  id: IdModele;
  nom: string;
  /** À quel moment la boutique l'envoie, en une phrase. */
  quand: string;
  besoinCommande: boolean;
}

const MODELES: Modele[] = [
  {
    id: "confirmation",
    nom: "Confirmation de commande",
    quand: "Part vers le client dès que son paiement est encaissé.",
    besoinCommande: true,
  },
  {
    id: "expediee",
    nom: "Commande expédiée",
    quand: "Part vers le client quand vous enregistrez son colis, avec le lien de suivi.",
    besoinCommande: true,
  },
  {
    id: "prete-au-stand",
    nom: "Affiche prête (stand)",
    quand: "Prévient un client du stand que son affiche est prête. Aucun prix.",
    besoinCommande: true,
  },
  {
    id: "remboursee",
    nom: "Commande remboursée",
    quand:
      "Part vers le client quand vous enregistrez un remboursement, total ou partiel. Jamais pour une commande de stand.",
    besoinCommande: true,
  },
  {
    id: "annulee",
    nom: "Commande annulée",
    quand:
      "Part vers le client quand vous annulez sa commande depuis sa fiche. Jamais pour une commande de stand : c'est la vendeuse qui prévient.",
    besoinCommande: true,
  },
  {
    id: "facture",
    nom: "Facture",
    // L'aperçu ne montre que le message ; le PDF, lui, ne se fabrique que
    // depuis la fiche d'une commande, parce qu'il consomme un numéro de
    // facture et qu'un banc d'essai n'a pas à en dépenser.
    quand:
      "Part vers le client quand vous lui envoyez sa facture depuis sa fiche, avec le PDF joint. L'essai n'envoie que le message : la facture elle-même s'édite depuis la commande.",
    besoinCommande: true,
  },
  {
    id: "nouvelle-commande",
    nom: "Avis de nouvelle commande",
    quand: "Vous prévient qu'une commande vient d'arriver.",
    besoinCommande: true,
  },
  {
    id: "panier-abandonne",
    nom: "Relance de panier",
    quand: "Rappelle son affiche à quelqu'un qui a laissé sa commande en plan.",
    besoinCommande: false,
  },
  {
    id: "bienvenue",
    nom: "Bienvenue",
    quand: "Accueille quelqu'un qui vient de créer son compte client.",
    besoinCommande: false,
  },
  {
    id: "mot-de-passe-modifie",
    nom: "Mot de passe modifié",
    quand:
      "Avis de sécurité, dès qu'un mot de passe change : depuis le compte, ou par un lien de réinitialisation.",
    besoinCommande: false,
  },
  {
    id: "reinitialisation",
    nom: "Mot de passe oublié",
    quand: "Envoie le lien de nouveau mot de passe à un client qui l'a demandé.",
    besoinCommande: false,
  },
];

function estIdModele(v: string): v is IdModele {
  return MODELES.some((m) => m.id === v);
}

/* -------------------------------------------------------------------------- */
/*  Données d'un courrier                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Tout ce dont les modèles peuvent avoir besoin, réuni.
 *
 * `prenomClient` peut être vide : chaque modèle a sa propre formule de repli
 * en production, et l'aperçu doit montrer celle-là, pas une autre.
 */
interface DonneesCourrier {
  numero: string;
  prenomClient: string;
  nomClient: string;
  lignes: LigneCourrier[];
  sousTotalCents: number;
  remiseCents: number;
  codePromo: string | null;
  portCents: number;
  totalCents: number;
  modeLivraison: string | null;
  adresse: string[];
  /**
   * « web » ou « salon ». Le stand cache ses tarifs à l'écran : une
   * confirmation par courrier les révélerait, la boutique s'en abstient.
   */
  canal: string;
  /**
   * Le numéro de facture de la commande, s'il lui en a déjà été attribué un.
   *
   * L'aperçu ne DONNE jamais de numéro : chacun est unique et définitif, et
   * en tirer un pour regarder une maquette le retirerait de la suite pour
   * toujours. Sans numéro, on en montre un d'exemple, reconnaissable comme tel.
   */
  numeroFacture: string | null;
  /** La commande a-t-elle été réglée ? Change une phrase de la facture. */
  dejaPayee: boolean;
}

/**
 * Commande d'exemple : deux affiches, dont une encadrée, un code de réduction,
 * des frais de port et une adresse française.
 *
 * Elle est volontairement plausible plutôt que minimale : un aperçu sans
 * remise ni cadre laisse justement dans l'ombre les lignes du courrier qui
 * n'apparaissent qu'à ces conditions.
 */
function jeuExemple(): DonneesCourrier {
  const lignes: LigneCourrier[] = [
    {
      titre: "Notre famille, été 2024",
      format: "A3",
      cadre: "Cadre bois clair",
      quantite: 1,
      unitPriceCents: 4900,
    },
    {
      titre: "Léa et Tom",
      format: "A4",
      cadre: null,
      quantite: 2,
      unitPriceCents: 2900,
    },
  ];
  const sousTotalCents = lignes.reduce(
    (s, l) => s + l.unitPriceCents * l.quantite,
    0,
  );
  const remiseCents = 1070;
  const portCents = 590;
  return {
    numero: "WEB-0042",
    // La commande d'exemple vient du site : c'est le seul canal dont la
    // boutique envoie une confirmation.
    canal: "web",
    // Un numéro d'exemple, dans la forme des vrais : personne ne doit pouvoir
    // le confondre avec une facture réellement émise.
    numeroFacture: "F2026-0001",
    dejaPayee: true,
    prenomClient: "Camille",
    nomClient: "Camille Dubois",
    lignes,
    sousTotalCents,
    remiseCents,
    codePromo: "PRINTEMPS10",
    portCents,
    totalCents: sousTotalCents - remiseCents + portCents,
    modeLivraison: "Colissimo à domicile",
    adresse: [
      "Camille Dubois",
      "12 rue des Lilas",
      "Appartement 3",
      "44000 Nantes",
      "France",
    ],
  };
}

/**
 * Les données d'une vraie commande, composées EXACTEMENT comme le fait
 * l'envoi automatique du paiement (configurator-routes.ts) : mêmes libellés de
 * repli, même déduction de la remise à partir du montant encaissé. Une
 * seconde façon de calculer donnerait un aperçu qui ment.
 *
 * `null` si aucune commande ne correspond.
 */
async function donneesDeCommande(
  reference: string,
): Promise<DonneesCourrier | null> {
  const ref = reference.trim();
  if (!ref) return null;
  // Le plafond n'est pas une coquetterie : au-delà, la base refuse la
  // comparaison et la route tomberait en erreur nue là où elle promet une
  // phrase. Un numéro de vingt chiffres n'est de toute façon pas un
  // identifiant, c'est une faute de frappe.
  const brut = /^\d+$/.test(ref) ? Number(ref) : Number.NaN;
  const identifiant =
    Number.isSafeInteger(brut) && brut > 0 && brut <= 2147483647 ? brut : null;

  // Le numéro se saisit comme il se lit (« WEB-0042 »), sans se soucier de la
  // casse ; l'identifiant technique reste accepté pour les liens du back-office.
  const [commande] = await db
    .select()
    .from(schema.orders)
    .where(
      identifiant === null
        ? sql`lower(${schema.orders.number}) = lower(${ref})`
        : or(
            sql`lower(${schema.orders.number}) = lower(${ref})`,
            eq(schema.orders.id, identifiant),
          ),
    )
    .limit(1);
  if (!commande) return null;

  const [client] = commande.customerId
    ? await db
        .select()
        .from(schema.customers)
        .where(eq(schema.customers.id, commande.customerId))
    : [];
  const articles = await db
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, commande.id));
  const cadres = await db.select().from(schema.frames);

  const lignes: LigneCourrier[] = articles.map((it) => {
    const cfg = (it.config ?? {}) as Record<string, unknown>;
    const cadre = cadres.find((f) => String(f.id) === String(cfg.frameId ?? ""));
    return {
      titre: it.title ?? "Affiche personnalisée",
      format: typeof cfg.format === "string" ? cfg.format : "A4",
      cadre: cadre?.name ?? null,
      quantite: it.quantity,
      unitPriceCents: it.unitPriceCents,
      // L'aperçu réel de CETTE ligne, en adresse absolue : une messagerie
      // ne sait pas résoudre un chemin relatif, et le jeton lui permet de
      // charger l'image sans session.
      imageUrl: `${ORIGINE_PUBLIQUE}/api${cheminApercu(it.id)}`,
    };
  });
  const sousTotalCents = lignes.reduce(
    (s, l) => s + l.unitPriceCents * l.quantite,
    0,
  );
  const portCents = commande.shippingCents ?? 0;

  return {
    numero: commande.number,
    canal: commande.channel,
    // Le numéro déjà attribué, ou celui d'exemple : l'aperçu n'en tire jamais
    // un nouveau, sous peine de le retirer de la suite pour rien.
    numeroFacture: commande.invoiceNumber ?? "F2026-0001",
    dejaPayee: commande.status === "paid",
    prenomClient: (client?.name ?? "").split(" ")[0] ?? "",
    nomClient: client?.name ?? "client inconnu",
    lignes,
    sousTotalCents,
    // La remise se déduit de ce qui a été facturé : c'est le montant encaissé
    // qui fait foi, pas un recalcul qui pourrait diverger.
    remiseCents: Math.max(0, sousTotalCents + portCents - commande.totalCents),
    codePromo: commande.promoCode,
    portCents,
    totalCents: commande.totalCents,
    modeLivraison: commande.shippingLabel,
    adresse: [
      commande.shippingName,
      commande.relayPointLabel,
      commande.shippingLine1,
      commande.shippingLine2,
      [commande.shippingPostalCode, commande.shippingCity]
        .filter(Boolean)
        .join(" "),
      commande.shippingCountry,
    ].filter((v): v is string => Boolean(v)),
  };
}

/**
 * Fabrique le courrier demandé à partir de ces données.
 *
 * Les formules de repli sur le prénom reprennent celles des envois réels, une
 * par modèle : c'est le genre de détail qu'on vient justement vérifier ici.
 * Le destinataire reste vide, comme partout : c'est l'appelant qui le pose.
 */
function rendre(modele: IdModele, d: DonneesCourrier): Courrier {
  switch (modele) {
    case "confirmation":
      return courrierConfirmation({
        numero: d.numero,
        prenomClient: d.prenomClient || "et merci",
        lignes: d.lignes,
        sousTotalCents: d.sousTotalCents,
        remiseCents: d.remiseCents,
        codePromo: d.codePromo,
        portCents: d.portCents,
        totalCents: d.totalCents,
        modeLivraison: d.modeLivraison,
        adresse: d.adresse,
      });
    case "expediee":
      // Le suivi d'exemple imite un envoi Colissimo : sans numéro, l'aperçu
      // cacherait justement le bouton qu'on vient vérifier.
      return courrierExpediee({
        prenomClient: d.prenomClient || "vous",
        numero: d.numero,
        transporteur: "Colissimo",
        numeroSuivi: "6A12345678901",
        lienSuivi:
          "https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678901",
        lignes: d.lignes,
      });
    case "prete-au-stand":
      return courrierPreteAuStand({
        prenomClient: d.prenomClient || "vous",
        numero: d.numero,
        evenement: "Salon du livre de Nantes 2026",
        lignes: d.lignes,
      });
    case "remboursee": {
      // Le cas le plus complet, donc le seul qui vaille d'être relu : un
      // remboursement PARTIEL, un exemplaire rendu sur plusieurs, les frais de
      // port avec, et un premier remboursement déjà passé sur la commande.
      // Chacune de ces conditions fait apparaître une ligne du courrier qui
      // resterait autrement invisible.
      const rendu = d.lignes[0];
      const articles = rendu ? [{ ...rendu, quantite: 1 }] : [];
      const montant =
        articles.reduce((s, l) => s + l.unitPriceCents * l.quantite, 0) +
        d.portCents;
      const autre = d.lignes[d.lignes.length - 1];
      const dejaRendu = d.lignes.length > 1 && autre ? autre.unitPriceCents : 0;
      return courrierRemboursee({
        prenomClient: d.prenomClient || "vous",
        numero: d.numero,
        montantCents: montant,
        portCents: d.portCents,
        articles,
        // Plafonné au total de la commande : au-delà, l'aperçu montrerait un
        // cumul que la route des remboursements refuserait d'écrire.
        totalRembourseCents: Math.min(d.totalCents, montant + dejaRendu),
        totalCommandeCents: d.totalCents,
        viaPaiementEnLigne: true,
      });
    }
    case "annulee":
      return courrierAnnulee({
        prenomClient: d.prenomClient || "vous",
        numero: d.numero,
        // Le motif est facultatif dans le modèle : sans lui, l'aperçu cacherait
        // justement la ligne qu'on vient relire.
        motif: "Annulée à la demande de la cliente, avant impression.",
        articles: d.lignes,
        dejaPayee: true,
      });
    case "facture":
      return courrierFacture({
        prenomClient: d.prenomClient || "vous",
        numero: d.numero,
        numeroFacture: d.numeroFacture ?? "F2026-0001",
        totalCents: d.totalCents,
        dejaPayee: d.dejaPayee,
      });
    case "nouvelle-commande":
      return courrierNouvelleCommande({
        numero: d.numero,
        client: d.nomClient,
        totalCents: d.totalCents,
        lignes: d.lignes,
      });
    case "panier-abandonne":
      // L'aperçu montre le courrier le plus COMPLET : lien de récupération à
      // jeton, code de réduction repris, et lien de désinscription. Ce dernier
      // n'apparaît en vrai qu'avec la base légale de l'intérêt légitime, mais
      // c'est justement la ligne qu'on vient relire — un aperçu qui la cache
      // laisserait croire qu'elle manque.
      return courrierPanierAbandonne({
        prenomClient: d.prenomClient || "vous",
        lien: `${ORIGINE}/panier/recuperer?jeton=exemple-de-lien`,
        lignes: d.lignes,
        totalCents: d.totalCents,
        codePromo: d.codePromo,
        lienDesinscription: `${ORIGINE}/api/relance/desabonnement?jeton=essai`,
      });
    case "bienvenue":
      return courrierBienvenue({
        prenomClient: d.prenomClient || "vous",
        lien: `${ORIGINE}/compte`,
      });
    case "mot-de-passe-modifie":
      // L'aperçu montre le chemin de la RÉINITIALISATION : c'est celui qui dit
      // en plus que les sessions ouvertes sont tombées, donc celui qui a le
      // plus à relire. L'autre chemin ne change qu'une phrase.
      return courrierMotDePasseModifie({
        prenomClient: d.prenomClient || "vous",
        parReinitialisation: true,
        lien: `${ORIGINE}/compte/mot-de-passe-oublie`,
      });
    case "reinitialisation":
      // Le jeton d'un vrai lien ne vit qu'une heure et n'existe que pour la
      // personne qui l'a demandé : l'aperçu en montre la forme, pas un jeton
      // valable, qui ouvrirait un compte à qui lirait cet écran.
      return courrierReinitialisation({
        prenomClient: d.prenomClient || "vous",
        lien: `${ORIGINE}/compte/reinitialiser?jeton=exemple-de-lien`,
      });
  }
}

/* -------------------------------------------------------------------------- */
/*  Phrases d'état                                                            */
/* -------------------------------------------------------------------------- */

/** Où va un courrier envoyé maintenant. La seule ligne vraiment lue. */
function resumeDestination(): string {
  if (!estConfigure()) {
    return "Aucun envoi n'est possible pour le moment : ni boîte d'essai, ni clé d'envoi. Un courrier demandé maintenant ne partirait nulle part.";
  }
  if (estEnEssai()) {
    return `Tout arrive dans la boîte d'essai (${BOITE_TEST}). Aucun client ne reçoit quoi que ce soit tant qu'elle est en service, même si vous saisissez sa vraie adresse.`;
  }
  const copie = COPIE ? ` Une copie discrète part aussi vers ${COPIE}.` : "";
  return `Les courriers partent pour de vrai, au nom de ${EXPEDITEUR}, vers l'adresse indiquée.${copie}`;
}

/** Où le courrier qu'on vient d'envoyer est allé. */
function resumeEnvoi(destinataire: string, parti: boolean): string {
  if (!parti) {
    return estEnEssai()
      ? `Le courrier n'est pas arrivé dans la boîte d'essai : elle ne répond pas. Vérifiez qu'elle est bien démarrée, puis réessayez. Rien n'a été envoyé à ${destinataire}.`
      : `Le courrier n'a pas pu partir vers ${destinataire}. Le service d'envoi a refusé la demande : vérifiez la clé d'envoi et l'adresse d'expédition, puis réessayez.`;
  }
  if (estEnEssai()) {
    return `Le courrier a été déposé dans la boîte d'essai (${BOITE_TEST}), au nom de ${destinataire}, qui n'a rien reçu. Ouvrez la boîte pour le lire.`;
  }
  const copie = COPIE ? ` Une copie discrète est partie vers ${COPIE}.` : "";
  return `Le courrier est réellement parti vers ${destinataire}, au nom de ${EXPEDITEUR}. Cette personne l'a dans sa boîte de réception.${copie}`;
}

/** Marche à suivre quand rien n'est en place pour envoyer. */
const RIEN_POUR_ENVOYER =
  "Aucun envoi n'est possible pour le moment. Deux façons de s'en sortir : démarrer la boîte d'essai, qui garde les courriers sans les faire partir, ou renseigner la clé d'envoi de la boutique pour les envoyer pour de vrai. Ces deux réglages se posent dans la configuration du serveur (MAIL_TEST_URL et RESEND_API_KEY).";

/* -------------------------------------------------------------------------- */
/*  Débit d'envoi                                                             */
/* -------------------------------------------------------------------------- */

const ENVOIS_PAR_MINUTE = 10;
/** Horodatages des envois d'essai acceptés dans la dernière minute. */
const envoisRecents: number[] = [];

/**
 * Dix courriers par minute pour tout le back-office : un écran qui envoie se
 * rappelle vite en boucle par mégarde (double clic, page rechargée, script de
 * test), et chaque appel de trop est un courrier de trop chez un vrai client.
 *
 * Seuls les envois ACCEPTÉS sont comptés : compter aussi les refus ferait
 * qu'une page en boucle prolongerait sa propre punition indéfiniment.
 */
function cadenceDepassee(): boolean {
  const maintenant = Date.now();
  while (envoisRecents.length > 0 && maintenant - (envoisRecents[0] ?? 0) >= 60_000) {
    envoisRecents.shift();
  }
  if (envoisRecents.length >= ENVOIS_PAR_MINUTE) return true;
  envoisRecents.push(maintenant);
  return false;
}

/**
 * Contrôle sommaire d'une adresse : une arobase, puis un point, puis quelque
 * chose. On ne cherche pas à savoir si la boîte existe, seulement à arrêter
 * une saisie manifestement fausse. Rien n'est jamais corrigé au passage :
 * une adresse mal tapée est refusée et signalée, pas devinée.
 */
function adresseAcceptable(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@.]+$/.test(v);
}

/* -------------------------------------------------------------------------- */
/*  Routes                                                                    */
/* -------------------------------------------------------------------------- */

export function mountCourriers(app: Hono): void {
  /** Où en est l'envoi, et où irait un courrier expédié maintenant. */
  app.get("/admin/courriers/etat", (c) =>
    c.json({
      configure: estConfigure(),
      enEssai: estEnEssai(),
      expediteur: EXPEDITEUR || null,
      copie: COPIE || null,
      boiteTestUrl: BOITE_TEST_NAVIGATEUR || null,
      resume: resumeDestination(),
    }),
  );

  /** La liste des courriers que la boutique sait écrire. */
  app.get("/admin/courriers/modeles", (c) => c.json({ modeles: MODELES }));

  /**
   * Rend un courrier, sans rien envoyer. Avec `?commande=`, il est rempli des
   * données de cette commande ; sans, d'un jeu d'exemple.
   */
  app.get("/admin/courriers/apercu/:modele", async (c) => {
    const modele = c.req.param("modele");
    if (!estIdModele(modele)) {
      return c.json({ error: "Ce courrier n'existe pas dans la boutique." }, 400);
    }

    // Un paramètre vide, c'est un champ que personne n'a rempli : on montre
    // l'exemple, on ne va pas chercher une commande sans numéro.
    const reference = (c.req.query("commande") ?? "").trim();
    const donnees = reference ? await donneesDeCommande(reference) : null;
    if (reference && !donnees) {
      return c.json(
        {
          error: `Aucune commande ne porte le numéro « ${reference} ». Vérifiez le numéro dans la liste des commandes.`,
        },
        404,
      );
    }

    const source = donnees ? "commande" : "exemple";
    const courrier = rendre(modele, donnees ?? jeuExemple());
    return c.json({
      modele,
      sujet: courrier.subject,
      html: courrier.html,
      source,
      ...(donnees ? { commande: donnees.numero } : {}),
    });
  });

  /**
   * Envoie un courrier pour de bon, à l'adresse demandée.
   *
   * C'est la seule route du fichier qui sorte de la machine, et elle ne le
   * fait que si la boîte d'essai est coupée. La réponse le dit explicitement.
   */
  app.post("/admin/courriers/essai", async (c) => {
    const corps = (await c.req.json().catch(() => null)) as {
      modele?: unknown;
      destinataire?: unknown;
      commande?: unknown;
    } | null;

    const modele = typeof corps?.modele === "string" ? corps.modele.trim() : "";
    if (!estIdModele(modele)) {
      return c.json({ error: "Ce courrier n'existe pas dans la boutique." }, 400);
    }

    const destinataire =
      typeof corps?.destinataire === "string" ? corps.destinataire.trim() : "";
    if (!destinataire) {
      return c.json({ error: "Indiquez l'adresse qui doit recevoir ce courrier." }, 400);
    }
    if (!adresseAcceptable(destinataire)) {
      return c.json(
        {
          error: `« ${destinataire} » ne ressemble pas à une adresse e-mail. Il en faut une complète, du genre bonjour@exemple.fr.`,
        },
        400,
      );
    }

    if (!estConfigure()) return c.json({ error: RIEN_POUR_ENVOYER }, 503);

    const reference = typeof corps?.commande === "string" ? corps.commande.trim() : "";
    const donnees = reference ? await donneesDeCommande(reference) : null;
    if (reference && !donnees) {
      return c.json(
        {
          error: `Aucune commande ne porte le numéro « ${reference} ». Vérifiez le numéro dans la liste des commandes.`,
        },
        404,
      );
    }

    // Une commande prise au stand n'a pas de confirmation par courrier : le
    // message porterait le tarif du site, que la tablette du stand cache
    // justement, et c'est la vendeuse qui a annoncé le prix de vive voix. La
    // règle vit déjà dans configurator-routes.ts ; ce banc d'essai ne doit pas
    // offrir un chemin de contournement, l'adresse de la cliente étant
    // lisible à deux écrans d'ici.
    if (donnees?.canal === "salon")
      return c.json(
        {
          error: `La commande ${reference} a été prise au stand. La boutique n'envoie pas de confirmation par courrier pour ces commandes-là : elle porterait le tarif du site.`,
        },
        400,
      );

    // Le quota se compte à l'envoi, et seulement là. Compté plus haut, une
    // commande introuvable le consommait, et une page en boucle prolongeait
    // sa propre punition sans jamais avoir rien envoyé.
    if (cadenceDepassee()) {
      return c.json(
        {
          error: `Vous avez envoyé ${ENVOIS_PAR_MINUTE} courriers d'essai en moins d'une minute. Patientez un instant avant le suivant.`,
        },
        429,
      );
    }

    const courrier = rendre(modele, donnees ?? jeuExemple());
    const parti = await envoyer({ ...courrier, to: destinataire });
    return c.json({ ok: true, parti, resume: resumeEnvoi(destinataire, parti) });
  });
}
