/**
 * Un FAUX SendCloud, en local, pour éprouver l'achat d'étiquettes sans
 * dépenser un centime.
 *
 * POURQUOI IL EXISTE. Chez SendCloud il n'y a pas de bac à sable, et l'API v3
 * n'a AUCUN brouillon : `POST /shipments/announce` achète. Développer l'achat
 * contre le vrai service, ce serait payer chaque essai — et découvrir ses
 * fautes de frappe sur la facture du mois suivant. Tout le travail se fait
 * donc ici, contre un serveur qui ne coûte rien et qu'on peut faire tomber à
 * volonté.
 *
 * POURQUOI DU VRAI HTTP PLUTÔT QU'UNE CLASSE FACTICE. Une fausse classe
 * branchée à la place du client sauterait précisément ce qui casse en vrai :
 * l'authentification Basic, les en-têtes, le décodage JSON, les codes de
 * retour, et le téléchargement d'un PDF binaire. Ici tout cela est exercé pour
 * de bon ; seul le destinataire change.
 *
 * POURQUOI IL NE DÉMARRE JAMAIS TOUT SEUL. Le service `faux-sendcloud` de
 * docker-compose.yml est sous le profil `essais` : un `docker compose up`
 * ordinaire ne le lance pas. Un faux transporteur qui tournerait en permanence
 * finirait par servir sans qu'on s'en aperçoive.
 *   docker compose --profile essais up -d faux-sendcloud
 *
 * CE QU'IL NE SAIT PAS, ET NE DOIT PAS SAVOIR. Aucune clé. Il exige un en-tête
 * `Authorization: Basic` NON VIDE et n'en regarde pas le contenu : ce qui est
 * éprouvé ici, c'est que le client authentifie bien ses appels, pas la valeur
 * d'un secret. Il ne journalise jamais d'en-tête, jamais un corps de requête —
 * celui de l'achat porte l'adresse d'une cliente. Son script npm n'a pas de
 * `--env-file` non plus, contrairement à tous les autres : il n'a rien à lire
 * dans le .env de la racine, et ce qu'on ne lit pas ne peut pas fuir.
 *
 * CE QU'IL N'EST PAS : LA VÉRITÉ. La documentation publique de SendCloud ne
 * donne pas tous les noms de champs de la v3. Les formes rendues ici sont
 * plausibles, pas certifiées. Le jour où les clés d'Alexandra existeront, le
 * PREMIER appel à faire est `POST /shipping-options` (gratuit, sans effet) sur
 * le vrai service, pour comparer sa réponse à celle-ci et corriger le client
 * si besoin. Ce fichier est un banc d'essai, jamais une référence.
 *
 * LES TROIS PANNES. `timeout`, `refus` et `401` s'arment par
 * `POST /faux/panne` (ou l'en-tête `X-Faux-Panne`, ou la variable
 * FAUX_SENDCLOUD_PANNE au démarrage) : voir la section « La télécommande ».
 *
 * Usage :
 *   docker compose --profile essais up -d faux-sendcloud
 *   puis, pour l'API : SENDCLOUD_BASE_URL=http://faux-sendcloud:3100/api/v3
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { Context } from "hono";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const PORT = Number(process.env.FAUX_SENDCLOUD_PORT ?? 3100);

/**
 * La minuterie de la panne `timeout` n'est pas éternelle.
 *
 * Le client doit abandonner bien avant (c'est tout l'objet de l'essai) ; ce
 * plafond n'existe que pour qu'une requête oubliée ne retienne pas un socket
 * jusqu'au prochain redémarrage.
 */
const PLAFOND_ATTENTE_MS = 120_000;

/* -------------------------------------------------------------------------- */
/*  Le catalogue : trois options, et une seule à zéro euro                    */
/* -------------------------------------------------------------------------- */

/**
 * Les prix montent au-delà de 2 kg, comme chez un vrai transporteur.
 *
 * Ce n'est pas de la décoration : c'est ce qui permet d'éprouver le refus
 * « le tarif a changé » sans ajouter d'interrupteur. On demande un devis à
 * 500 g, on tente l'achat à 3 kg avec le prix de la première : le devis frais
 * ne dit plus la même chose, et la route doit refuser.
 */
const SEUIL_LOURD_KG = 2;

interface OptionDeLivraison {
  code: string;
  nom: string;
  transporteur: { code: string; nom: string };
  produit: string;
  /** 'label_creation' : facturé dès l'étiquette. 'first_scan' : au dépôt. */
  facturation: "label_creation" | "first_scan";
  prixCents: number;
  prixLourdCents: number;
  contractId: number | null;
  delaiHeures: number | null;
  pointRelaisRequis: boolean;
  champsRequis: string[];
}

const OPTIONS: OptionDeLivraison[] = [
  {
    code: "mondial_relay:standard",
    nom: "Mondial Relay Point Relais",
    transporteur: { code: "mondial_relay", nom: "Mondial Relay" },
    produit: "Point Relais 0-2 kg",
    facturation: "first_scan",
    prixCents: 490,
    prixLourdCents: 690,
    contractId: 4711,
    delaiHeures: 72,
    pointRelaisRequis: true,
    champsRequis: ["to_service_point_id"],
  },
  {
    code: "colissimo:home",
    nom: "Colissimo Domicile",
    transporteur: { code: "colissimo", nom: "Colissimo" },
    produit: "Domicile sans signature",
    facturation: "label_creation",
    prixCents: 640,
    prixLourdCents: 890,
    contractId: 4712,
    delaiHeures: 48,
    pointRelaisRequis: false,
    champsRequis: [],
  },
  {
    // La « lettre non affranchie » : l'option du MODE ESSAI, celle que le
    // serveur impose tant qu'Alexandra n'a pas quitté ce mode. Elle est à zéro
    // ici comme elle l'est chez SendCloud, et c'est bien le seul point sur
    // lequel ce faux est sûr de dire vrai.
    code: "sendcloud:letter",
    nom: "Unstamped letter",
    transporteur: { code: "sendcloud", nom: "Sendcloud" },
    produit: "Lettre non affranchie (essai)",
    facturation: "label_creation",
    prixCents: 0,
    prixLourdCents: 0,
    contractId: null,
    delaiHeures: null,
    pointRelaisRequis: false,
    champsRequis: [],
  },
];

/**
 * Trois points relais, dont les `carrier_service_point_id` ressemblent au
 * « Num » natif de Mondial Relay — celui que `orders.relayPointId` porte
 * depuis le tunnel de commande. C'est cette correspondance-là que l'étape du
 * devis doit établir, et c'est elle qui doit pouvoir ÉCHOUER : demander un
 * identifiant absent de cette liste rend une liste VIDE, jamais un point
 * approchant. On ne substitue pas un point relais en silence.
 */
const POINTS_RELAIS = [
  {
    id: 12345,
    carrier_service_point_id: "063210",
    name: "Tabac Le Central",
    street: "rue Blatin",
    house_number: "12",
    postal_code: "63000",
    city: "Clermont-Ferrand",
    country: "FR",
  },
  {
    id: 12346,
    carrier_service_point_id: "063211",
    name: "Presse des Salins",
    street: "avenue Léon Blum",
    house_number: "3",
    postal_code: "63000",
    city: "Clermont-Ferrand",
    country: "FR",
  },
  {
    id: 12347,
    carrier_service_point_id: "075112",
    name: "Superette du Marche",
    street: "rue Oberkampf",
    house_number: "88",
    postal_code: "75011",
    city: "Paris",
    country: "FR",
  },
];

/* -------------------------------------------------------------------------- */
/*  Ce que le faux retient                                                    */
/* -------------------------------------------------------------------------- */

interface Envoi {
  shipmentId: string;
  reference: string | null;
  numeroCommande: string | null;
  optionCode: string;
  contractId: number | null;
  parcelId: string;
  trackingNumber: string;
  trackingUrl: string;
  transporteur: { code: string; nom: string };
  destinataire: Record<string, unknown>;
  expediteur: Record<string, unknown>;
  poidsKg: number | null;
  creeA: string;
  annuleA: string | null;
}

const envoisParId = new Map<string, Envoi>();
const envoisParReference = new Map<string, Envoi>();
const envoisParColis = new Map<string, Envoi>();

type Cible =
  | "shipping-options"
  | "service-points"
  | "announce"
  | "label"
  | "cancel"
  | "shipments-search";

/**
 * Le compteur d'appels est la PREUVE, pas le message à l'écran.
 *
 * « Le double-clic n'achète qu'une fois » ne se démontre pas en lisant une
 * page : il se démontre en constatant que le faux n'a reçu qu'un seul
 * `announce`. D'où ce compteur, lisible par GET /faux/etat.
 */
const appels: Record<Cible, number> = {
  "shipping-options": 0,
  "service-points": 0,
  announce: 0,
  label: 0,
  cancel: 0,
  "shipments-search": 0,
};

/** Les paramètres du dernier téléchargement d'étiquette, pour les vérifier. */
let dernierLabel: { parcelId: string; paperSize: string; dpi: string | null } | null =
  null;

let compteurEnvois = 0;

/* -------------------------------------------------------------------------- */
/*  La télécommande : les trois pannes, et la réponse d'annulation            */
/* -------------------------------------------------------------------------- */

type ModePanne = "aucune" | "timeout" | "refus" | "401";

interface Panne {
  mode: ModePanne;
  /** 'tout', ou le seul appel visé — « échouer APRÈS l'achat » se dit ainsi. */
  cible: Cible | "tout";
  /** Nombre d'appels encore touchés ; 0 = jusqu'à ce qu'on la désarme. */
  restant: number;
  /**
   * `timeout` sur l'achat : l'expédition est-elle créée avant le silence ?
   *
   * Vrai par défaut, parce que c'est la panne DANGEREUSE — celle où l'argent
   * est parti et où personne ne le sait. Faux reproduit l'autre cas, celui où
   * la requête n'est jamais arrivée.
   */
  enregistre: boolean;
}

let panneArmee: Panne | null = null;

/** Réponse imposée à la prochaine annulation (200 accepté, 202 différé, 409 refusé). */
let reponseAnnulation: 200 | 202 | 409 | null = null;

function lireModePanne(valeur: unknown): ModePanne | null {
  return valeur === "timeout" || valeur === "refus" || valeur === "401" || valeur === "aucune"
    ? valeur
    : null;
}

/** La panne qui vise cet appel, sans la consommer. */
function panneQuiVise(c: Context, cible: Cible): ModePanne {
  // L'en-tête ne sert qu'aux appels faits À LA MAIN sur le faux : le vrai
  // client n'en envoie évidemment aucun. C'est POST /faux/panne qui compte.
  const parEntete = lireModePanne(c.req.header("x-faux-panne"));
  if (parEntete) return parEntete;
  if (!panneArmee || panneArmee.mode === "aucune") return "aucune";
  if (panneArmee.cible !== "tout" && panneArmee.cible !== cible) return "aucune";
  return panneArmee.mode;
}

/** La même, mais elle décompte : une panne armée « une fois » ne frappe qu'une fois. */
function consommerPanne(c: Context, cible: Cible): Panne | null {
  const mode = panneQuiVise(c, cible);
  if (mode === "aucune") return null;
  const armee = panneArmee;
  if (!armee || lireModePanne(c.req.header("x-faux-panne"))) {
    // Panne demandée par l'en-tête : rien à décompter.
    return { mode, cible, restant: 0, enregistre: true };
  }
  if (armee.restant > 0) {
    armee.restant -= 1;
    if (armee.restant === 0) panneArmee = null;
  }
  return armee;
}

/**
 * Tenir la ligne sans répondre : la panne qui compte le plus.
 *
 * Un refus propre est facile à traiter ; c'est le SILENCE qui met la boutique
 * en danger, parce que l'argent est peut-être parti. Le client doit alors
 * poser la ligne en « à vérifier », n'expédier rien et n'écrire à personne.
 */
function tenirLaLigne(c: Context): Promise<Response> {
  return new Promise<Response>((resoudre) => {
    const fin = setTimeout(() => resoudre(c.body(null, 504)), PLAFOND_ATTENTE_MS);
    const signal: AbortSignal | undefined = c.req.raw.signal;
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(fin);
        resoudre(c.body(null, 504));
      },
      { once: true },
    );
  });
}

/* -------------------------------------------------------------------------- */
/*  Formes de réponse                                                         */
/* -------------------------------------------------------------------------- */

let requetes = 0;

/**
 * Le corps d'erreur, dans UNE forme et une seule.
 *
 * La v3 ne documente pas publiquement sa forme d'erreur complète. Le client ne
 * doit donc jamais dépendre d'un champ précis : le code HTTP décide, et le
 * message ne sert qu'à être recopié tel quel sous les yeux d'Alexandra.
 */
function corpsErreur(code: string, message: string): Record<string, unknown> {
  return { error: { code, message, request_id: `faux-${++requetes}` } };
}

/** « 490 » → « 4.90 » : une chaîne décimale, comme en rendent les API de prix. */
function prixDecimal(cents: number): string {
  return (cents / 100).toFixed(2);
}

function optionParCode(code: string): OptionDeLivraison | undefined {
  return OPTIONS.find((o) => o.code === code);
}

function prixDeLOption(option: OptionDeLivraison, poidsKg: number | null): number {
  return poidsKg !== null && poidsKg > SEUIL_LOURD_KG
    ? option.prixLourdCents
    : option.prixCents;
}

/** L'origine par laquelle on nous a appelés : le lien du PDF doit y revenir. */
function origine(c: Context): string {
  return new URL(c.req.url).origin;
}

/**
 * L'expédition rendue au client.
 *
 * Le lien du document est ABSOLU et pointe vers ce serveur : chez SendCloud il
 * exige la même authentification Basic que le reste, et c'est bien pour ça que
 * le back-office ne doit jamais le poser dans un <a> — il passe par un proxy
 * authentifié. Le faux reproduit ce piège plutôt que de rendre le PDF en ligne.
 */
function enveloppe(envoi: Envoi, c: Context): Record<string, unknown> {
  const base = origine(c);
  return {
    shipment_id: envoi.shipmentId,
    external_reference_id: envoi.reference,
    order_number: envoi.numeroCommande,
    created_at: envoi.creeA,
    cancelled_at: envoi.annuleA,
    status: envoi.annuleA ? "cancelled" : "announced",
    ship_with: {
      shipping_option_code: envoi.optionCode,
      contract_id: envoi.contractId,
    },
    parcels: [
      {
        id: envoi.parcelId,
        tracking_number: envoi.trackingNumber,
        tracking_url: envoi.trackingUrl,
        carrier: { code: envoi.transporteur.code, name: envoi.transporteur.nom },
        weight: envoi.poidsKg === null ? null : { value: envoi.poidsKg.toFixed(3), unit: "kg" },
        documents: [
          {
            type: "label",
            size: "a6",
            link: `${base}/api/v3/parcels/${envoi.parcelId}/documents/label?paper_size=a6`,
          },
        ],
      },
    ],
  };
}

async function lireJson(c: Context): Promise<Record<string, unknown>> {
  try {
    const valeur: unknown = await c.req.json();
    return valeur && typeof valeur === "object" ? (valeur as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function texte(valeur: unknown): string | null {
  return typeof valeur === "string" && valeur.trim() !== "" ? valeur.trim() : null;
}

function objet(valeur: unknown): Record<string, unknown> {
  return valeur && typeof valeur === "object" && !Array.isArray(valeur)
    ? (valeur as Record<string, unknown>)
    : {};
}

/**
 * Le poids, en kilos, quelle que soit la manière dont le client l'a écrit.
 *
 * La v3 attend `{ weight: { value: "0.500", unit: "kg" } }`, mais tant que ce
 * détail n'est pas confirmé sur le vrai compte, refuser un nombre simple ferait
 * chercher la faute du mauvais côté.
 */
function poidsEnKg(colis: Record<string, unknown>): number | null {
  const brut = colis.weight;
  if (typeof brut === "number") return brut;
  if (typeof brut === "string") return Number(brut) || null;
  const poids = objet(brut);
  const valeur = Number(poids.value);
  if (!Number.isFinite(valeur) || valeur <= 0) return null;
  return poids.unit === "g" ? valeur / 1000 : valeur;
}

/* -------------------------------------------------------------------------- */
/*  Le PDF : une étiquette A6 qu'on ne peut pas confondre avec une vraie      */
/* -------------------------------------------------------------------------- */

const ENCRE = rgb(0.09, 0.09, 0.09);
const ENCRE_PALE = rgb(0.45, 0.45, 0.45);

/**
 * Helvetica ne sait écrire que le répertoire WinAnsi.
 *
 * Une adresse cliente porte volontiers une apostrophe courbe ou un caractère
 * exotique ; un faux qui plante là-dessus ferait chercher la panne dans le
 * client, qui n'y serait pour rien.
 */
function lisible(valeur: string): string {
  return valeur
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

/** Les lignes d'une adresse, quelle que soit l'orthographe des champs. */
function lignesAdresse(adresse: Record<string, unknown>): string[] {
  const rue = [
    texte(adresse.address_line_1) ?? texte(adresse.address_1) ?? texte(adresse.street) ?? "",
    texte(adresse.house_number) ?? "",
  ]
    .filter((m) => m !== "")
    .join(" ");
  return [
    texte(adresse.name) ?? texte(adresse.company_name) ?? "",
    rue,
    texte(adresse.address_line_2) ?? texte(adresse.address_2) ?? "",
    [texte(adresse.postal_code) ?? "", texte(adresse.city) ?? ""].filter((m) => m !== "").join(" "),
    texte(adresse.country_code) ?? texte(adresse.country) ?? "",
  ].filter((ligne) => ligne !== "");
}

/** Des barres stables pour un même numéro : ça ressemble à un code-barres. */
function barres(numero: string): number[] {
  let graine = 7;
  for (const signe of numero) graine = (graine * 31 + signe.charCodeAt(0)) % 2147483647;
  const largeurs: number[] = [];
  for (let i = 0; i < 52; i += 1) {
    graine = (graine * 1103515245 + 12345) % 2147483647;
    largeurs.push(1 + (graine % 3));
  }
  return largeurs;
}

async function etiquettePdf(envoi: Envoi, format: "a6" | "a4"): Promise<Uint8Array> {
  // A6 = 105 × 148 mm, A4 = 210 × 297 mm, en points PostScript (72 par pouce).
  const [largeur, hauteur] = format === "a4" ? [595.28, 841.89] : [297.64, 419.53];
  const doc = await PDFDocument.create();
  doc.setTitle(`FAUX bordereau ${envoi.trackingNumber}`);
  doc.setSubject("Etiquette d'essai sans valeur, produite par le faux SendCloud local");
  const page = doc.addPage([largeur, hauteur]);
  const gras = await doc.embedFont(StandardFonts.HelveticaBold);
  const normale = await doc.embedFont(StandardFonts.Helvetica);

  const marge = 14;
  page.drawRectangle({
    x: marge,
    y: marge,
    width: largeur - 2 * marge,
    height: hauteur - 2 * marge,
    borderColor: ENCRE,
    borderWidth: 1,
  });

  // Un bandeau noir en tête : imprimée par mégarde, cette étiquette doit se
  // dénoncer d'elle-même, de loin, avant d'être collée sur un vrai colis.
  const bandeau = 26;
  page.drawRectangle({
    x: marge,
    y: hauteur - marge - bandeau,
    width: largeur - 2 * marge,
    height: bandeau,
    color: ENCRE,
  });
  const avertissement = "ESSAI - SANS VALEUR";
  page.drawText(avertissement, {
    x: (largeur - gras.widthOfTextAtSize(avertissement, 13)) / 2,
    y: hauteur - marge - bandeau + 8,
    size: 13,
    font: gras,
    color: rgb(1, 1, 1),
  });

  let y = hauteur - marge - bandeau - 26;
  page.drawText(lisible(envoi.transporteur.nom), {
    x: marge + 10,
    y,
    size: 15,
    font: gras,
    color: ENCRE,
  });
  y -= 14;
  page.drawText(lisible(envoi.optionCode), {
    x: marge + 10,
    y,
    size: 8,
    font: normale,
    color: ENCRE_PALE,
  });

  y -= 24;
  page.drawText("DESTINATAIRE", { x: marge + 10, y, size: 7, font: gras, color: ENCRE_PALE });
  y -= 13;
  for (const ligne of lignesAdresse(envoi.destinataire)) {
    page.drawText(lisible(ligne), { x: marge + 10, y, size: 10, font: normale, color: ENCRE });
    y -= 12;
  }

  y -= 12;
  page.drawText("EXPEDITEUR", { x: marge + 10, y, size: 7, font: gras, color: ENCRE_PALE });
  y -= 11;
  for (const ligne of lignesAdresse(envoi.expediteur)) {
    page.drawText(lisible(ligne), { x: marge + 10, y, size: 8, font: normale, color: ENCRE_PALE });
    y -= 10;
  }

  // Le code-barres et son numéro, en bas, là où ils sont sur une vraie étiquette.
  const basBarres = marge + 46;
  let x = marge + 12;
  const largeurs = barres(envoi.trackingNumber);
  for (const [index, epaisseur] of largeurs.entries()) {
    if (index % 2 === 0 && x + epaisseur < largeur - marge - 12) {
      page.drawRectangle({ x, y: basBarres, width: epaisseur, height: 34, color: ENCRE });
    }
    x += epaisseur + 1.6;
  }
  const numero = lisible(envoi.trackingNumber);
  page.drawText(numero, {
    x: (largeur - gras.widthOfTextAtSize(numero, 12)) / 2,
    y: basBarres - 16,
    size: 12,
    font: gras,
    color: ENCRE,
  });

  const pied = `${envoi.reference ?? "sans reference"} - faux SendCloud local`;
  page.drawText(lisible(pied), {
    x: marge + 10,
    y: marge + 8,
    size: 6.5,
    font: normale,
    color: ENCRE_PALE,
  });

  return doc.save();
}

/* -------------------------------------------------------------------------- */
/*  Les cinq appels de l'API v3                                               */
/* -------------------------------------------------------------------------- */

const v3 = new Hono();

/**
 * Le journal : une ligne par appel, jamais un en-tête, jamais un corps.
 *
 * L'en-tête porte les clés, le corps de l'achat porte l'adresse d'une cliente.
 * Même dans un faux, on ne prend pas l'habitude de les écrire.
 */
v3.use("*", async (c, next) => {
  await next();
  console.log(`[faux-sendcloud] ${c.req.method} ${new URL(c.req.url).pathname} → ${c.res.status}`);
});

/**
 * L'authentification, et les pannes qui frappent avant tout le monde.
 *
 * `401` passe DEVANT l'en-tête Basic : c'est ainsi qu'on éprouve le bandeau
 * « SendCloud a refusé ces clés » sans jamais poser de vraie clé nulle part.
 */
v3.use("*", async (c, next) => {
  const cible = cibleDe(c);
  if (cible) appels[cible] += 1;

  const mode = cible ? panneQuiVise(c, cible) : "aucune";
  if (cible && mode === "401") {
    consommerPanne(c, cible);
    return c.json(corpsErreur("unauthorized", "Invalid API credentials."), 401);
  }
  if (cible && mode === "refus") {
    consommerPanne(c, cible);
    // L'annulation se refuse en 409 : c'est le code qui veut dire « trop tard,
    // le colis est parti », et le client doit alors ne RIEN changer.
    return cible === "cancel"
      ? c.json(
          corpsErreur(
            "cancellation_refused",
            "This shipment can no longer be cancelled by the carrier.",
          ),
          409,
        )
      : c.json(
          corpsErreur(
            "shipping_option_unavailable",
            "This shipping option is not available for the destination address.",
          ),
          400,
        );
  }
  // `timeout` sur l'achat est traité par la route elle-même : elle doit pouvoir
  // créer l'expédition AVANT de se taire.
  if (cible && cible !== "announce" && mode === "timeout") {
    consommerPanne(c, cible);
    return tenirLaLigne(c);
  }

  const autorisation = c.req.header("authorization") ?? "";
  if (!/^Basic\s+\S+/i.test(autorisation)) {
    return c.json(
      corpsErreur("unauthorized", "Authentication credentials were not provided."),
      401,
    );
  }
  await next();
});

/** Quel appel de l'API v3 cette requête vise-t-elle ? */
function cibleDe(c: Context): Cible | null {
  const chemin = new URL(c.req.url).pathname.replace(/^\/api\/v3/, "");
  if (chemin.startsWith("/shipping-options")) return "shipping-options";
  if (chemin.startsWith("/service-points")) return "service-points";
  if (chemin.startsWith("/shipments/announce")) return "announce";
  if (/^\/parcels\/[^/]+\/documents\//.test(chemin)) return "label";
  if (/^\/shipments\/[^/]+\/cancel/.test(chemin)) return "cancel";
  if (chemin.startsWith("/shipments")) return "shipments-search";
  return null;
}

/**
 * Le devis. GRATUIT, et il doit le rester : rien ici n'écrit quoi que ce soit.
 *
 * Les prix ne sont rendus QUE si `calculate_quotes` vaut vrai, comme chez
 * SendCloud. Un client qui oublie ce drapeau doit s'en apercevoir ici, contre
 * le faux, et pas devant Alexandra avec un tableau d'options sans prix.
 */
v3.post("/shipping-options", async (c) => {
  const corps = await lireJson(c);
  const colis = Array.isArray(corps.parcels) ? objet(corps.parcels[0]) : {};
  const poids = poidsEnKg(colis);
  const avecPrix = corps.calculate_quotes === true;

  return c.json({
    data: OPTIONS.map((option) => ({
      code: option.code,
      name: option.nom,
      carrier: { code: option.transporteur.code, name: option.transporteur.nom },
      product: { code: option.code, name: option.produit },
      contract_id: option.contractId,
      charging_type: option.facturation,
      functionalities: {
        service_point_required: option.pointRelaisRequis,
        delivery_deadline_hours: option.delaiHeures,
      },
      requirements: { fields: option.champsRequis },
      quotes: avecPrix
        ? [
            {
              price: {
                total: {
                  // Une CHAÎNE décimale, comme le rendent les API de prix : le
                  // client doit la convertir en centimes sans passer par un
                  // flottant approximatif. Le cas gênant est ici exprès.
                  value: prixDecimal(prixDeLOption(option, poids)),
                  currency: "EUR",
                },
              },
            },
          ]
        : [],
    })),
  });
});

/**
 * Les points relais. Gratuit, sans effet : c'est aussi l'appel qui sert à
 * VÉRIFIER une paire de clés fraîchement collée.
 */
v3.get("/service-points", (c) => {
  const demandes = [
    // Avec ou sans crochets : la v3 les attend en tableau, et une paire de
    // crochets oubliée dans une chaîne de requête est une heure perdue.
    ...(c.req.queries("carrier_service_point_id[]") ?? []),
    ...(c.req.queries("carrier_service_point_id") ?? []),
  ].filter((v) => v !== "");
  const codePostal = c.req.query("postal_code");
  const limite = Number(c.req.query("limit") ?? 0);

  let points = POINTS_RELAIS;
  if (demandes.length > 0) {
    // Correspondance EXACTE, ou rien. Rendre « le point le plus proche » quand
    // l'identifiant est inconnu ferait imprimer une étiquette vers un point que
    // la cliente n'a jamais choisi.
    points = points.filter((p) => demandes.includes(p.carrier_service_point_id));
  } else if (codePostal) {
    points = points.filter((p) => p.postal_code === codePostal);
    if (points.length === 0) points = POINTS_RELAIS;
  }
  if (limite > 0) points = points.slice(0, limite);

  return c.json({
    data: points.map((p) => ({
      ...p,
      carrier: "mondial_relay",
      distance: 420,
      formatted_opening_times: { 1: ["09:00 - 19:00"] },
    })),
  });
});

/**
 * L'ACHAT. Chez SendCloud, c'est cet appel-ci qui dépense — ici, il ne fait
 * qu'inscrire une ligne dans une Map.
 *
 * LE 409 SUR UNE RÉFÉRENCE DÉJÀ VUE EST LA RAISON D'ÊTRE DE CE FICHIER. C'est
 * lui qui prouve la seconde couche d'idempotence : la requête est partie, la
 * réponse s'est perdue, on rejoue — et on retombe sur le MÊME colis au lieu
 * d'en acheter un second. Le corps du 409 porte donc l'objet existant, parce
 * qu'un 409 n'est pas une erreur : c'est « déjà acheté ».
 */
v3.post("/shipments/announce", async (c) => {
  const corps = await lireJson(c);
  const demandes = Array.isArray(corps.shipments) ? corps.shipments : null;
  if (!demandes || demandes.length === 0) {
    return c.json(
      corpsErreur(
        "invalid_request",
        'faux SendCloud : corps attendu { "shipments": [ { … } ] } (API v3).',
      ),
      400,
    );
  }
  const demande = objet(demandes[0]);
  const reference = texte(demande.external_reference_id);

  if (reference) {
    const dejaVu = envoisParReference.get(reference);
    if (dejaVu) {
      return c.json(
        {
          ...corpsErreur(
            "duplicate_external_reference_id",
            `A shipment with external_reference_id "${reference}" already exists.`,
          ),
          data: [enveloppe(dejaVu, c)],
        },
        409,
      );
    }
  }

  const minuterie = consommerPanne(c, "announce");
  if (minuterie?.mode === "timeout" && !minuterie.enregistre) {
    // La requête n'est jamais arrivée à destination : rien n'existe, rien n'est
    // dû. C'est l'autre moitié de la panne dangereuse.
    return tenirLaLigne(c);
  }

  const avecQuoi = objet(objet(demande.ship_with).properties ?? demande.ship_with);
  const optionCode =
    texte(avecQuoi.shipping_option_code) ?? texte(demande.shipping_option_code) ?? "";
  const option = optionParCode(optionCode);
  if (!option) {
    return c.json(
      corpsErreur(
        "invalid_shipping_option",
        `Unknown shipping_option_code "${optionCode || "(vide)"}".`,
      ),
      400,
    );
  }

  const colis = Array.isArray(demande.parcels) ? objet(demande.parcels[0]) : {};
  compteurEnvois += 1;
  const numero = String(compteurEnvois).padStart(6, "0");
  const envoi: Envoi = {
    shipmentId: `sc-shp-${numero}`,
    reference,
    numeroCommande: texte(demande.order_number),
    optionCode,
    contractId:
      typeof avecQuoi.contract_id === "number" ? avecQuoi.contract_id : option.contractId,
    parcelId: `sc-par-${numero}`,
    trackingNumber: `FAUX${numero}FR`,
    trackingUrl: `${origine(c)}/faux/suivi/FAUX${numero}FR`,
    transporteur: option.transporteur,
    destinataire: objet(demande.to_address),
    expediteur: objet(demande.from_address),
    poidsKg: poidsEnKg(colis),
    creeA: new Date().toISOString(),
    annuleA: null,
  };
  envoisParId.set(envoi.shipmentId, envoi);
  envoisParColis.set(envoi.parcelId, envoi);
  if (reference) envoisParReference.set(reference, envoi);

  if (minuterie?.mode === "timeout") {
    // L'expédition existe, et le client ne le saura jamais par cette requête :
    // c'est exactement l'état « à vérifier », celui où l'argent est peut-être
    // parti. On le laisse retrouvable par sa référence (GET /shipments).
    return tenirLaLigne(c);
  }

  return c.json({ data: [enveloppe(envoi, c)] }, 201);
});

/**
 * La recherche par référence. LECTURE SEULE, et elle existe pour une seule
 * raison : retrouver le colis orphelin d'un achat resté sans réponse.
 */
v3.get("/shipments", (c) => {
  const reference = c.req.query("external_reference_id");
  const trouve = reference ? envoisParReference.get(reference) : undefined;
  return c.json({ data: trouve ? [enveloppe(trouve, c)] : [] });
});

/**
 * L'étiquette en PDF. Gratuite, autant de fois qu'on veut — comme chez
 * SendCloud, où re-télécharger un document ne coûte rien et ne rachète rien.
 */
v3.get("/parcels/:parcelId/documents/label", async (c) => {
  const parcelId = c.req.param("parcelId");
  const envoi = envoisParColis.get(parcelId);
  if (!envoi) {
    return c.json(corpsErreur("not_found", `No parcel "${parcelId}".`), 404);
  }
  const demande = (c.req.query("paper_size") ?? "a6").toLowerCase();
  const format = demande.startsWith("a4") ? "a4" : "a6";
  dernierLabel = { parcelId, paperSize: demande, dpi: c.req.query("dpi") ?? null };

  const pdf = await etiquettePdf(envoi, format);
  return c.body(new Uint8Array(pdf), 200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="faux-${envoi.trackingNumber}-${format}.pdf"`,
  });
});

/**
 * L'annulation. Trois réponses possibles et PAS de délai promis : les pages
 * officielles de SendCloud se contredisent là-dessus, et le back-office
 * n'affiche que ce que cette route a réellement répondu.
 */
v3.post("/shipments/:shipmentId/cancel", (c) => {
  const envoi = envoisParId.get(c.req.param("shipmentId"));
  if (!envoi) {
    return c.json(corpsErreur("not_found", "No such shipment."), 404);
  }
  const imposee = reponseAnnulation;
  reponseAnnulation = null;

  if (imposee === 409 || (imposee === null && envoi.annuleA !== null)) {
    return c.json(
      corpsErreur("cancellation_refused", "This shipment has already been cancelled."),
      409,
    );
  }
  if (imposee === 202) {
    // « Demandée » : le transporteur n'a pas encore tranché. Le client garde la
    // ligne en « annulation demandée » et ne promet rien à Alexandra.
    return c.json({ data: { shipment_id: envoi.shipmentId, status: "cancellation_requested" } }, 202);
  }
  envoi.annuleA = new Date().toISOString();
  return c.json({ data: { shipment_id: envoi.shipmentId, status: "cancelled" } }, 200);
});

/* -------------------------------------------------------------------------- */
/*  La télécommande et la page d'accueil (jamais sous /api/v3)                */
/* -------------------------------------------------------------------------- */

const app = new Hono();

app.get("/", (c) =>
  c.text(
    "Faux SendCloud — serveur d'essai local de Memory Line.\n" +
      "Il n'appelle personne, n'achète rien et ne connaît aucune clé.\n\n" +
      "  POST /api/v3/shipping-options\n" +
      "  GET  /api/v3/service-points\n" +
      "  POST /api/v3/shipments/announce\n" +
      "  GET  /api/v3/shipments?external_reference_id=…\n" +
      "  GET  /api/v3/parcels/{id}/documents/label?paper_size=a6|a4\n" +
      "  POST /api/v3/shipments/{id}/cancel\n\n" +
      "  GET  /faux/etat            ce qu'il a reçu\n" +
      "  POST /faux/panne           { mode: timeout|refus|401|aucune, cible?, combien?, enregistre? }\n" +
      "  POST /faux/annulation      { reponse: 200|202|409 }\n" +
      "  POST /faux/reinitialiser   compteurs et expéditions remis à zéro\n",
  ),
);

/**
 * L'état : les compteurs d'abord.
 *
 * Il ne rend NI les adresses des expéditions reçues, ni rien qui vienne du
 * corps d'un achat. Même en local, l'adresse d'une cliente n'a pas à ressortir
 * par une route de confort.
 */
app.get("/faux/etat", (c) =>
  c.json({
    appels,
    envois: envoisParId.size,
    references: [...envoisParReference.keys()],
    expeditions: [...envoisParId.values()].map((e) => ({
      shipment_id: e.shipmentId,
      parcel_id: e.parcelId,
      reference: e.reference,
      option: e.optionCode,
      annulee: e.annuleA !== null,
    })),
    dernierLabel,
    panne: panneArmee,
    reponseAnnulation,
  }),
);

app.post("/faux/panne", async (c) => {
  const corps = await lireJson(c);
  const mode = lireModePanne(corps.mode);
  if (!mode) {
    return c.json(
      { erreur: 'mode attendu : "timeout", "refus", "401" ou "aucune".' },
      400,
    );
  }
  if (mode === "aucune") {
    panneArmee = null;
    return c.json({ panne: null });
  }
  const cible = corps.cible;
  const combien = Number(corps.combien ?? 1);
  panneArmee = {
    mode,
    cible:
      typeof cible === "string" && cible !== "" ? (cible as Cible | "tout") : "tout",
    restant: Number.isFinite(combien) && combien > 0 ? combien : 0,
    enregistre: corps.enregistre !== false,
  };
  return c.json({ panne: panneArmee });
});

app.post("/faux/annulation", async (c) => {
  const corps = await lireJson(c);
  const reponse = Number(corps.reponse);
  if (reponse !== 200 && reponse !== 202 && reponse !== 409) {
    return c.json({ erreur: "reponse attendue : 200, 202 ou 409." }, 400);
  }
  reponseAnnulation = reponse;
  return c.json({ reponseAnnulation });
});

/**
 * Remise à zéro : un essai commence sur une ardoise propre, sinon la référence
 * de l'essai précédent rendrait un 409 qu'on croirait dû à son propre code.
 */
app.post("/faux/reinitialiser", (c) => {
  envoisParId.clear();
  envoisParReference.clear();
  envoisParColis.clear();
  for (const cle of Object.keys(appels) as Cible[]) appels[cle] = 0;
  compteurEnvois = 0;
  dernierLabel = null;
  panneArmee = null;
  reponseAnnulation = null;
  return c.json({ remisAZero: true });
});

/** Le lien de suivi que porte l'étiquette : il doit mener quelque part. */
app.get("/faux/suivi/:numero", (c) =>
  c.text(`Faux suivi du colis ${c.req.param("numero")} — aucun colis ne circule.`),
);

// Les routes v3 sont montées DEUX FOIS : sous /api/v3, comme chez SendCloud, et
// à la racine. SENDCLOUD_BASE_URL sera écrite à la main dans un .env ; l'oubli
// du suffixe rendrait des 404 qu'on irait chercher dans le client.
app.route("/api/v3", v3);
app.route("/", v3);

const panneAuDemarrage = lireModePanne(process.env.FAUX_SENDCLOUD_PANNE);
if (panneAuDemarrage && panneAuDemarrage !== "aucune") {
  panneArmee = { mode: panneAuDemarrage, cible: "tout", restant: 0, enregistre: true };
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`✓ Faux SendCloud sur http://localhost:${info.port} (base /api/v3)`);
  console.log("  Aucun appel ne sort de cette machine, aucune étiquette n'est achetée.");
  if (panneArmee) console.log(`  Panne armée au démarrage : ${panneArmee.mode}`);
});
