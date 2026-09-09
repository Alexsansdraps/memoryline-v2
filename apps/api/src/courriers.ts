/**
 * Banc d'essai des courriers de la boutique.
 *
 * Les quatre courriers que Memory Line envoie (confirmation, avis de nouvelle
 * commande, relance de panier, réinitialisation de mot de passe) ne se voient
 * aujourd'hui qu'en attendant qu'un vrai client déclenche l'un d'eux. Ce
 * fichier offre le raccourci : afficher n'importe lequel des quatre, tel qu'il
 * sortira, avec un jeu d'exemple ou avec les données d'une vraie commande, et
 * s'en envoyer un pour de bon afin de le lire dans une boîte de réception.
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
  courrierExpediee,
  courrierPreteAuStand,
  courrierConfirmation,
  courrierNouvelleCommande,
  courrierPanierAbandonne,
  courrierReinitialisation,
  envoyer,
  estConfigure,
  estEnEssai,
  type Courrier,
  type LigneCourrier,
} from "./mail.js";

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
const EXPEDITEUR =
  (process.env.MAIL_FROM ?? "").trim() ||
  (BOITE_TEST ? "Memory Line (essai) <boutique@memoryline.test>" : "");

/** Origine publique du site, pour les liens cliquables des courriers. */
const ORIGINE = (process.env.PUBLIC_ORIGIN ?? "").replace(/\/$/, "");

/* -------------------------------------------------------------------------- */
/*  Les quatre modèles                                                        */
/* -------------------------------------------------------------------------- */

type IdModele =
  | "confirmation"
  | "expediee"
  | "prete-au-stand"
  | "nouvelle-commande"
  | "panier-abandonne"
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
 * Tout ce dont les quatre modèles peuvent avoir besoin, réuni.
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
    case "nouvelle-commande":
      return courrierNouvelleCommande({
        numero: d.numero,
        client: d.nomClient,
        totalCents: d.totalCents,
        lignes: d.lignes,
      });
    case "panier-abandonne":
      return courrierPanierAbandonne({
        prenomClient: d.prenomClient || "vous",
        lien: `${ORIGINE}/panier`,
        lignes: d.lignes,
        totalCents: d.totalCents,
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
      boiteTestUrl: BOITE_TEST || null,
      resume: resumeDestination(),
    }),
  );

  /** La liste des quatre courriers que la boutique sait écrire. */
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
