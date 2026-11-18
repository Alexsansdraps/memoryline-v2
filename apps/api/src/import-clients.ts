/**
 * Importer un fichier de clientes : un export Shopify, une liste tenue dans
 * un tableur, ou le fichier que l'écran « Clients » exporte lui-même.
 *
 * Même grammaire que l'import des affiches (import-produits.ts), et pour la
 * même raison : on dépose le fichier, on REGARDE ce qui se passerait, et
 * seulement ensuite on décide. Sans « appliquer », rien n'est écrit.
 *
 * TROIS RÈGLES, dans cet ordre.
 *
 * 1. L'ADRESSE E-MAIL FAIT LA CLIENTE. Une adresse déjà connue complète la
 *    fiche existante au lieu d'en ouvrir une seconde ; une adresse répétée
 *    dans le fichier n'est lue qu'une fois. Une ligne SANS adresse est
 *    écartée : rien ne permettrait de la reconnaître au prochain import, et
 *    chaque réimport la dupliquerait.
 *
 * 2. UNE FICHE EXISTANTE SE COMPLÈTE, ELLE NE S'ÉCRASE PAS. Le fichier remplit
 *    ce qui est vide (nom, téléphone, note, adresse quand le carnet est vide)
 *    et ajoute ses étiquettes ; il ne remplace jamais ce que la boutique sait
 *    déjà. Un vieil export n'a pas à défaire un numéro corrigé hier.
 *
 * 3. L'ABONNEMENT AUX E-MAILS NE S'IMPORTE QUE POUR UNE CLIENTE NOUVELLE. Une
 *    fiche existante garde le sien, dans un sens comme dans l'autre : un
 *    fichier ancien qui dit « abonnée » réabonnerait quelqu'un qui s'est
 *    désabonné depuis — ce que la loi interdit, et ce que la cliente ne
 *    pardonnerait pas. L'aperçu le dit sur la ligne concernée.
 */
import type { Hono } from "hono";
import { eq, isNotNull, sql as raw } from "drizzle-orm";
import { db, schema } from "./db/client.js";
import { lireCsv, normaliserEntete } from "./import-produits.js";
import { etiquette, nomComplet, nomDuPays } from "./comptes.js";

/**
 * Bornes du fichier accepté. Elles ne protègent pas d'une malveillance — seule
 * la propriétaire entre ici — mais d'un fichier envoyé par erreur : mieux vaut
 * une phrase lisible tout de suite qu'un serveur qui mouline.
 */
const CARACTERES_MAX = 3_000_000;
const LIGNES_MAX = 5_000;

/** Un refus du fichier entier, avec la phrase à montrer. */
class FichierRefuse extends Error {}

/* ------------------------------------------------------------------------ */
/*  Les colonnes reconnues                                                  */
/* ------------------------------------------------------------------------ */

type Champ =
  | "email"
  | "prenom"
  | "nomFamille"
  | "nomComplet"
  | "nom"
  | "telephone"
  | "telephoneAdresse"
  | "abonnement"
  | "etiquettes"
  | "note"
  | "adresse1"
  | "adresse2"
  | "ville"
  | "codePostal"
  | "pays"
  | "idShopify";

/**
 * Les noms de colonnes reconnus, par champ, du plus précis au plus vague : la
 * première colonne trouvée gagne.
 *
 * L'export Shopify (anglais, « Default Address City »), l'ancien export
 * Shopify (« City »), un tableur écrit à la main en français (« Ville »), et
 * l'export de l'écran « Clients » se lisent tous. Comparés sans majuscules ni
 * espaces doublés (`normaliserEntete`).
 */
const COLONNES: Record<Champ, string[]> = {
  email: ["email", "e-mail", "adresse e-mail", "adresse email", "adresse mail", "courriel", "mail"],
  prenom: ["first name", "prénom", "prenom", "firstname"],
  nomFamille: ["last name", "nom de famille", "lastname"],
  nomComplet: ["name", "nom complet", "nom du client", "nom de la cliente", "nom du/de la client(e)", "customer name", "full name", "client", "cliente"],
  // « Nom » seul est ambigu : nom de famille à côté d'un « Prénom », nom
  // complet sinon — c'est le cas de l'export de l'écran « Clients ».
  nom: ["nom"],
  telephone: ["phone", "téléphone", "telephone", "tél", "tel", "mobile", "portable"],
  telephoneAdresse: ["default address phone"],
  abonnement: [
    "accepts email marketing",
    "abonnement aux e-mails",
    "abonnement aux emails",
    "accepts marketing",
    "accepte le marketing",
    "abonnée",
    "abonné",
    "abonne",
    "newsletter",
    "email marketing",
  ],
  etiquettes: ["tags", "étiquettes", "etiquettes"],
  note: ["note", "notes"],
  adresse1: ["default address address1", "address1", "address 1", "adresse", "adresse 1", "adresse1", "rue"],
  adresse2: [
    "default address address2",
    "address2",
    "address 2",
    "adresse 2",
    "adresse2",
    "complément d'adresse",
    "complement d'adresse",
    "complément",
  ],
  ville: ["default address city", "city", "ville"],
  codePostal: ["default address zip", "zip", "code postal", "cp", "postal code", "zip code"],
  pays: ["default address country code", "country code", "code pays", "default address country", "country", "pays"],
  idShopify: ["customer id", "id client shopify"],
};

/** Le nom lisible d'un champ, pour dire à l'écran ce qui a été reconnu. */
const NOM_DU_CHAMP: Record<Champ, string> = {
  email: "e-mail",
  prenom: "prénom",
  nomFamille: "nom de famille",
  nomComplet: "nom",
  nom: "nom",
  telephone: "téléphone",
  telephoneAdresse: "téléphone de l'adresse",
  abonnement: "abonnement aux e-mails",
  etiquettes: "étiquettes",
  note: "note",
  adresse1: "adresse",
  adresse2: "complément d'adresse",
  ville: "ville",
  codePostal: "code postal",
  pays: "pays",
  idShopify: "identifiant Shopify",
};

/* ------------------------------------------------------------------------ */
/*  Lecture des valeurs                                                     */
/* ------------------------------------------------------------------------ */

const sansAccent = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Une valeur de cellule nettoyée.
 *
 * L'apostrophe de tête est celle qu'Excel et Shopify posent devant un numéro
 * (« '+33 6… ») pour qu'il ne devienne pas une formule : elle n'appartient pas
 * au numéro.
 */
function propre(v: string | undefined, max: number): string {
  return String(v ?? "")
    .replace(/^'/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * « oui », « yes », « abonné », « x »… Null quand la cellule est vide ou
 * qu'on ne sait pas la lire : une case illisible n'abonne personne.
 */
function ouiNon(brut: string): boolean | null {
  const v = sansAccent(brut).trim().toLowerCase().replace(/[_-]/g, " ");
  if (!v) return null;
  if (
    ["yes", "y", "oui", "o", "true", "vrai", "1", "x", "abonne", "abonnee", "subscribed", "opt in", "optin"].includes(v)
  )
    return true;
  if (
    [
      "no",
      "n",
      "non",
      "false",
      "faux",
      "0",
      "non abonne",
      "non abonnee",
      "unsubscribed",
      "not subscribed",
      // « En attente » chez Shopify : la confirmation par e-mail n'est jamais
      // venue. Ce n'est pas un accord.
      "pending",
      "invalid",
    ].includes(v)
  )
    return false;
  return null;
}

/** La forme d'une adresse e-mail : de quoi refuser une colonne décalée. */
const EMAIL_VALIDE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Les codes pays, depuis leur nom en français ou en anglais : « France »,
 * « Belgique », « Germany ». Le site enregistre des codes (« FR ») ; un nom
 * gardé tel quel n'irait plus dans un bordereau d'expédition.
 */
/**
 * Les codes périmés ou réservés qu'Intl nomme encore comme un pays d'aujourd'hui
 * (17/11) : « FX » s'appelle « France », « UK » « Royaume-Uni », « SU »
 * « Russie »… Venant après le bon code dans l'alphabet, ils l'écrasaient :
 * « France » donnait « FX », que rien n'expédie.
 */
const CODES_PERIMES = new Set([
  "AN", "BU", "CS", "DD", "DY", "FX", "HV", "NH", "RH", "SU", "TP", "UK", "VD", "YD", "YU", "ZR",
]);

const CODES_DES_PAYS: Map<string, string> = (() => {
  const carte = new Map<string, string>();
  const noms = [
    new Intl.DisplayNames(["fr"], { type: "region" }),
    new Intl.DisplayNames(["en"], { type: "region" }),
  ];
  const lettres = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const a of lettres)
    for (const b of lettres) {
      const code = a + b;
      if (CODES_PERIMES.has(code)) continue;
      for (const n of noms) {
        let nom: string | undefined;
        try {
          nom = n.of(code);
        } catch {
          nom = undefined;
        }
        // Un code inconnu revient tel quel : ce n'est pas un nom de pays.
        if (nom && nom !== code) carte.set(sansAccent(nom).toLowerCase(), code);
      }
    }
  return carte;
})();

function codePays(brut: string): string | null {
  const v = brut.trim();
  if (!v) return null;
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  return CODES_DES_PAYS.get(sansAccent(v).toLowerCase()) ?? v.slice(0, 60);
}

/** Une liste d'étiquettes « VIP, Salon Colmar », sans doublon de casse. */
function etiquettesDe(brut: string): string[] {
  const vues = new Set<string>();
  const sortie: string[] = [];
  for (const morceau of brut.split(/[,;]/)) {
    const e = etiquette(morceau);
    if (!e || vues.has(e.toLowerCase())) continue;
    vues.add(e.toLowerCase());
    sortie.push(e);
  }
  return sortie.slice(0, 30);
}

/* ------------------------------------------------------------------------ */
/*  Ce que dit chaque ligne, et ce qu'on en fait                            */
/* ------------------------------------------------------------------------ */

interface ClienteLue {
  ligne: number;
  email: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  note: string | null;
  tags: string[];
  /** Null : la colonne manque, ou la case est vide ou illisible. */
  abonnement: boolean | null;
  /** La case était remplie mais illisible : l'aperçu le signale. */
  abonnementIllisible: string | null;
  adresse: {
    line1: string;
    line2: string | null;
    postalCode: string | null;
    city: string;
    country: string | null;
    phone: string | null;
  } | null;
  /** Une adresse commencée mais incomplète : dite, et laissée de côté. */
  adresseIncomplete: boolean;
  idShopify: number | null;
}

/** Ce que l'aperçu montre d'une ligne, et ce que le compte rendu en dit. */
export interface LigneImportClient {
  ligne: number;
  email: string;
  nom: string;
  action: "creation" | "mise-a-jour" | "inchange" | "refus";
  raison?: string;
  changements: string[];
  /** L'abonnement aux e-mails APRÈS import : ce que la fiche dira. */
  abonne: boolean | null;
  emplacement: string | null;
  /** La fiche concernée : existante, ou créée une fois l'import appliqué. */
  clientId?: number;
}

/** Une fiche déjà en base, telle que l'import la confronte au fichier. */
interface FicheExistante {
  id: number;
  email: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  note: string | null;
  tags: string[];
  acceptsMarketing: boolean;
  compte: boolean;
  aUneAdresse: boolean;
}

/**
 * Les fiches existantes, par adresse e-mail en minuscules.
 *
 * Plusieurs fiches peuvent porter la même adresse — des visiteurs sans compte,
 * dans l'historique. On complète alors celle qui a un compte, sinon la plus
 * récente : c'est elle que la cliente retrouvera en se connectant.
 */
async function fichesParEmail(
  executant: Pick<typeof db, "select">,
): Promise<Map<string, FicheExistante>> {
  const fiches = await executant
    .select({
      id: schema.customers.id,
      email: schema.customers.email,
      name: schema.customers.name,
      firstName: schema.customers.firstName,
      lastName: schema.customers.lastName,
      phone: schema.customers.phone,
      note: schema.customers.note,
      tags: schema.customers.tags,
      acceptsMarketing: schema.customers.acceptsMarketing,
      compte: raw<boolean>`(${schema.customers.passwordHash} is not null)`,
      // Écrit en toutes lettres, table comprise : dans une sous-requête, une
      // colonne « id » sans son nom de table serait celle de l'adresse.
      aUneAdresse: raw<boolean>`exists (select 1 from "customer_address" a where a.customer_id = "customer"."id")`,
    })
    .from(schema.customers)
    .where(isNotNull(schema.customers.email));
  const carte = new Map<string, FicheExistante>();
  for (const f of fiches) {
    const cle = (f.email ?? "").trim().toLowerCase();
    if (!cle) continue;
    const deja = carte.get(cle);
    const meilleure =
      !deja ||
      (f.compte && !deja.compte) ||
      (f.compte === deja.compte && f.id > deja.id);
    if (meilleure)
      carte.set(cle, {
        ...f,
        email: cle,
        tags: f.tags ?? [],
        compte: !!f.compte,
        aUneAdresse: !!f.aUneAdresse,
      });
  }
  return carte;
}

/** « Lille, France » : ce que l'écran affiche dans la colonne Emplacement. */
function emplacementDe(ville: string | null, pays: string | null): string | null {
  const morceaux = [ville, nomDuPays(pays)].filter((v): v is string => !!v);
  return morceaux.length ? morceaux.join(", ") : null;
}

/**
 * Ce que l'import ferait d'une cliente lue, face à sa fiche éventuelle.
 *
 * Rend aussi les champs à écrire, pour que l'aperçu et l'écriture ne puissent
 * pas se contredire : l'un affiche exactement ce que l'autre écrira.
 */
function plan(c: ClienteLue, fiche: FicheExistante | undefined) {
  const changements: string[] = [];
  if (!fiche) {
    if (c.name) changements.push(`nom : ${c.name}`);
    if (c.phone) changements.push(`téléphone : ${c.phone}`);
    if (c.tags.length) changements.push(`étiquettes : ${c.tags.join(", ")}`);
    if (c.adresse)
      changements.push(
        `adresse : ${[c.adresse.line1, c.adresse.postalCode, c.adresse.city].filter(Boolean).join(" ")}`,
      );
    changements.push(c.abonnement ? "abonné aux e-mails" : "non abonné aux e-mails");
    return {
      action: "creation" as const,
      changements,
      maj: null,
      ajouterAdresse: !!c.adresse,
      abonne: c.abonnement === true,
    };
  }

  const maj: Partial<typeof schema.customers.$inferInsert> = {};
  if (!(fiche.name ?? "").trim() && c.name) {
    maj.name = c.name;
    // Le prénom et le nom séparés ne s'écrivent qu'avec le nom complet qu'ils
    // composent : posés seuls sous un nom existant, ils pourraient le
    // contredire (« J. Dupont » d'un côté, « Jean » de l'autre).
    if (c.firstName) maj.firstName = c.firstName;
    if (c.lastName) maj.lastName = c.lastName;
    changements.push(`nom ajouté : ${c.name}`);
  }
  if (!(fiche.phone ?? "").trim() && c.phone) {
    maj.phone = c.phone;
    changements.push(`téléphone ajouté : ${c.phone}`);
  }
  if (!(fiche.note ?? "").trim() && c.note) {
    maj.note = c.note;
    changements.push("note ajoutée");
  }
  const connues = new Set(fiche.tags.map((t) => t.toLowerCase()));
  const nouvelles = c.tags.filter((t) => !connues.has(t.toLowerCase()));
  if (nouvelles.length) {
    maj.tags = [...fiche.tags, ...nouvelles];
    changements.push(`étiquette${nouvelles.length > 1 ? "s" : ""} ajoutée${nouvelles.length > 1 ? "s" : ""} : ${nouvelles.join(", ")}`);
  }
  const ajouterAdresse = !!c.adresse && !fiche.aUneAdresse;
  if (ajouterAdresse && c.adresse)
    changements.push(
      `adresse ajoutée : ${[c.adresse.line1, c.adresse.postalCode, c.adresse.city].filter(Boolean).join(" ")}`,
    );
  // Rien d'écrit sur l'abonnement d'une fiche existante (règle 3) — mais le
  // dire quand le fichier pensait autrement, pour qu'on ne le croie pas fait.
  if (c.abonnement === true && !fiche.acceptsMarketing)
    changements.push(
      "abonnement non repris : une fiche existante ne s'abonne pas par un fichier (cochez la case sur sa fiche si elle l'a demandé)",
    );
  const aEcrire = Object.keys(maj).length > 0 || ajouterAdresse;
  return {
    action: aEcrire ? ("mise-a-jour" as const) : ("inchange" as const),
    changements,
    maj: Object.keys(maj).length ? maj : null,
    ajouterAdresse,
    abonne: fiche.acceptsMarketing,
  };
}

/* ------------------------------------------------------------------------ */
/*  La route                                                                */
/* ------------------------------------------------------------------------ */

export function mountImportClients(app: Hono): void {
  /**
   * Lit un fichier de clientes, dit ce qu'il ferait, et ne l'écrit que si on
   * le lui demande (`appliquer: true`). Le corps porte le contenu du fichier
   * (« csv ») : c'est le navigateur qui le lit, pas le serveur.
   */
  app.post("/admin/customers/import", async (c) => {
    const corps = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const appliquer = corps.appliquer === true;
    try {
      if (typeof corps.csv !== "string" || !corps.csv.trim())
        throw new FichierRefuse(
          "Aucun fichier n'a été reçu. Choisissez un fichier, ou collez son contenu.",
        );
      if (corps.csv.length > CARACTERES_MAX)
        throw new FichierRefuse(
          `Ce fichier est trop gros pour un seul import. Coupez-le en fichiers d'environ ${LIGNES_MAX} lignes.`,
        );

      const brut = lireCsv(corps.csv);
      const entete = brut[0] ?? [];
      // Le rang de chaque champ reconnu : la première colonne qui porte l'un
      // de ses noms, dans l'ordre de préférence de COLONNES.
      const rangs = entete.map((n) => normaliserEntete(n));
      const rang = {} as Record<Champ, number>;
      for (const champ of Object.keys(COLONNES) as Champ[]) {
        for (const nom of COLONNES[champ]) {
          const i = rangs.indexOf(nom);
          if (i !== -1) {
            rang[champ] = i;
            break;
          }
        }
      }
      if (rang.email === undefined)
        throw new FichierRefuse(
          "Ce fichier n'a pas de colonne d'adresses e-mail. La première ligne doit porter les noms des colonnes, dont une « E-mail » (ou « Email », comme dans un export Shopify).",
        );
      const lignesDeDonnees = brut.length - 1;
      if (lignesDeDonnees > LIGNES_MAX)
        throw new FichierRefuse(
          `Ce fichier compte ${lignesDeDonnees} lignes, c'est trop pour un seul import. Coupez-le en fichiers de ${LIGNES_MAX} lignes au plus.`,
        );

      // « Nom » à côté d'un « Prénom » est un nom de famille ; seul, c'est le
      // nom complet (l'export de l'écran « Clients » n'a que lui).
      const nomEstFamille = rang.prenom !== undefined;

      const reconnues = (Object.keys(rang) as Champ[])
        .filter((ch) => ch !== "nom" || rang.nomComplet === undefined)
        .map((ch) => `${entete[rang[ch]]?.trim()} (${ch === "nom" && nomEstFamille ? "nom de famille" : NOM_DU_CHAMP[ch]})`);
      const indices = new Set(Object.values(rang));
      const ignorees = entete
        .map((n, i) => ({ n: n.trim(), i }))
        .filter((x) => x.n && !indices.has(x.i))
        .map((x) => x.n);

      /* -- Chaque ligne, lue pour elle-même --------------------------------- */

      const apercu: LigneImportClient[] = [];
      const lues: { lue: ClienteLue; index: number }[] = [];
      /** La première ligne de chaque adresse : les suivantes la répètent. */
      const vues = new Map<string, number>();

      for (let i = 1; i < brut.length; i++) {
        const cells = brut[i] ?? [];
        if (cells.every((v) => !v.trim())) continue;
        const ligne = i + 1; // la ligne du tableur : l'en-tête est la ligne 1
        const val = (ch: Champ, max = 200) =>
          rang[ch] === undefined ? "" : propre(cells[rang[ch]], max);

        const email = val("email", 254).toLowerCase();
        const prenom = val("prenom", 80);
        const famille = val("nomFamille", 80) || (nomEstFamille ? val("nom", 80) : "");
        const complet =
          val("nomComplet", 160) || (!nomEstFamille ? val("nom", 160) : "");
        const name = prenom || famille ? nomComplet(prenom, famille) : complet || null;
        const nomLisible = name ?? "";

        const refuser = (raison: string) =>
          apercu.push({
            ligne,
            email,
            nom: nomLisible,
            action: "refus",
            raison,
            changements: [],
            abonne: null,
            emplacement: null,
          });
        if (!email) {
          refuser(
            "pas d'adresse e-mail : rien ne permettrait de reconnaître ce client au prochain import",
          );
          continue;
        }
        if (!EMAIL_VALIDE.test(email)) {
          refuser(`« ${email} » n'est pas une adresse e-mail`);
          continue;
        }
        const premiere = vues.get(email);
        if (premiere !== undefined) {
          refuser(`même adresse que la ligne ${premiere} : une seule fiche par adresse`);
          continue;
        }
        vues.set(email, ligne);

        const abonnementBrut = val("abonnement", 40);
        const abonnement = ouiNon(abonnementBrut);
        const telephone = val("telephone", 40) || val("telephoneAdresse", 40) || null;
        const ville = val("ville", 120) || null;
        const pays = codePays(val("pays", 60));
        const line1 = val("adresse1", 200);
        const codePostal = val("codePostal", 20) || null;
        // Une adresse n'entre au carnet que complète : une rue ET une ville.
        // Le carnet est celui que la cliente lit dans son compte, et une
        // adresse à moitié écrite y serait une adresse fausse.
        const adresse =
          line1 && ville
            ? {
                line1,
                line2: val("adresse2", 200) || null,
                postalCode: codePostal,
                city: ville,
                country: pays,
                phone: val("telephoneAdresse", 40) || telephone,
              }
            : null;
        const idBrut = val("idShopify", 30);
        const idShopify = /^\d{1,18}$/.test(idBrut) ? Number(idBrut) : null;

        lues.push({
          index: apercu.length,
          lue: {
            ligne,
            email,
            name,
            firstName: prenom || null,
            lastName: famille || null,
            phone: telephone,
            note: val("note", 2000) || null,
            tags: etiquettesDe(val("etiquettes", 1000)),
            abonnement,
            abonnementIllisible: abonnementBrut && abonnement === null ? abonnementBrut : null,
            adresse,
            adresseIncomplete: !adresse && !!(line1 || codePostal || ville),
            idShopify: idShopify !== null && Number.isSafeInteger(idShopify) ? idShopify : null,
          },
        });
        // Une place réservée dans l'aperçu, remplie une fois la base lue :
        // l'ordre de l'aperçu reste celui du fichier.
        apercu.push({
          ligne,
          email,
          nom: nomLisible,
          action: "inchange",
          changements: [],
          abonne: null,
          emplacement: null,
        });
      }

      /* -- Confrontation aux fiches, et écriture ------------------------- */

      const confronter = async (executant: Pick<typeof db, "select">) => {
        const fiches = await fichesParEmail(executant);
        return lues.map(({ lue, index }) => {
          const fiche = fiches.get(lue.email);
          const p = plan(lue, fiche);
          const sortie = apercu[index]!;
          sortie.action = p.action;
          sortie.changements = [...p.changements];
          if (lue.abonnementIllisible && !fiche)
            sortie.changements.push(
              `« ${lue.abonnementIllisible} » n'est pas compris comme un accord : importé non abonné`,
            );
          // Seulement quand l'adresse aurait servi : une fiche qui a déjà la
          // sienne ne la prend pas du fichier, incomplète ou non.
          if (lue.adresseIncomplete && !fiche?.aUneAdresse)
            sortie.changements.push(
              "adresse incomplète (il faut au moins une rue et une ville) : non reprise",
            );
          // La ville et le pays de l'adresse qui entre au carnet — ce que la
          // colonne « Emplacement » de la liste montrera ensuite.
          sortie.emplacement =
            p.ajouterAdresse && lue.adresse
              ? emplacementDe(lue.adresse.city, lue.adresse.country)
              : null;
          sortie.abonne = p.abonne;
          if (fiche) sortie.clientId = fiche.id;
          if (!sortie.nom && fiche?.name) sortie.nom = fiche.name;
          return { lue, fiche, plan: p, sortie };
        });
      };

      if (!appliquer) {
        await confronter(db);
      } else {
        // Tout ou rien : une erreur au milieu annule tout, et le fichier se
        // relance tel quel — les fiches déjà passées seraient reconnues.
        await db.transaction(async (tx) => {
          const travaux = await confronter(tx);
          const maintenant = new Date();
          for (const { lue, fiche, plan: p, sortie } of travaux) {
            let id = fiche?.id;
            if (!fiche) {
              const [creee] = await tx
                .insert(schema.customers)
                .values({
                  name: lue.name,
                  firstName: lue.firstName,
                  lastName: lue.lastName,
                  email: lue.email,
                  phone: lue.phone,
                  note: lue.note,
                  tags: lue.tags.length ? lue.tags : null,
                  acceptsMarketing: lue.abonnement === true,
                  // La date de l'accord n'est pas dans le fichier : c'est
                  // celle de l'import qui est retenue, et l'écran d'import le
                  // dit avant qu'on valide.
                  marketingOptInAt: lue.abonnement === true ? maintenant : null,
                  legacyId: lue.idShopify,
                })
                .returning({ id: schema.customers.id });
              id = creee!.id;
            } else if (p.maj) {
              await tx
                .update(schema.customers)
                .set(p.maj)
                .where(eq(schema.customers.id, fiche.id));
            }
            if (p.ajouterAdresse && lue.adresse && id !== undefined)
              await tx.insert(schema.customerAddresses).values({
                customerId: id,
                name: lue.name,
                line1: lue.adresse.line1,
                line2: lue.adresse.line2,
                postalCode: lue.adresse.postalCode,
                city: lue.adresse.city,
                country: lue.adresse.country,
                phone: lue.adresse.phone,
                isDefaultShipping: true,
                isDefaultBilling: true,
              });
            sortie.clientId = id;
          }
        });
      }

      const compte = { creation: 0, "mise-a-jour": 0, inchange: 0, refus: 0 };
      for (const l of apercu) compte[l.action] += 1;
      return c.json({
        applique: appliquer,
        lignes: apercu.length,
        compte,
        colonnesReconnues: reconnues,
        colonnesIgnorees: ignorees,
        apercu,
      });
    } catch (erreur) {
      if (erreur instanceof FichierRefuse)
        return c.json({ error: erreur.message }, 400);
      // La transaction a tout annulé : les fiches sont intactes.
      console.error("[import clients] import impossible", erreur);
      return c.json(
        {
          error:
            "Ce fichier n'a pas pu être importé. Rien n'a été enregistré : vérifiez les noms de colonnes, puis réessayez.",
        },
        400,
      );
    }
  });
}
