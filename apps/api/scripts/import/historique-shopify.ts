/**
 * Reprendre l'historique Shopify : lire les exports, et tout décider.
 *
 * Ce fichier ne touche jamais à la base. Il lit les CSV, puis il décide : qui
 * est quelle cliente, quel statut prend chaque commande, quel numéro elle
 * porte, à quelle affiche se rattache chaque article. L'écriture (orders.ts)
 * ne fait qu'appliquer ce plan, et l'aperçu montre exactement ce qu'elle
 * écrira. Tout s'essaie donc sur de petits fichiers fictifs
 * (tests/import-historique.test.ts).
 *
 * DEUX FORMATS.
 *
 * L'export NATIF de l'administration Shopify, d'abord :
 *   - Clients › Exporter › « Tous les clients » : customers_export.csv ;
 *   - Commandes › Exporter › « Toutes les commandes » : orders_export_1.csv,
 *     parfois suivi de orders_export_2.csv… Une ligne par article. Les champs
 *     de la commande ne sont que sur sa PREMIÈRE ligne ; « Name » (« #1001 »)
 *     est sur toutes, c'est lui qui regroupe.
 * L'export Matrixify de l'ancien import, ensuite (« Customers.csv »,
 * « Orders.csv ») : une ligne « Top Row » par commande, les articles sur les
 * lignes « Line: Type » = « Line Item ». Il ne coûte que des noms de colonnes
 * de plus, et lui seul garde la personnalisation des affiches.
 *
 * LES RÈGLES DES CLIENTES sont celles de l'import du back-office
 * (src/import-clients.ts) : l'adresse e-mail fait la cliente ; une fiche
 * existante se complète, elle ne s'écrase pas ; l'abonnement aux e-mails ne
 * s'importe que pour une fiche NOUVELLE. Une seule chose en plus :
 * l'identifiant Shopify se pose sur une fiche qui n'en a pas. Les fonctions
 * de ce fichier-là ne sont pas exportées : elles sont recopiées ici, à
 * l'identique. Si l'une change là-bas, elle doit changer ici.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import { instantDeParis, type PosterConfig } from "@memoryline/types";
import type {
  customerAddresses,
  customers,
  orderItems,
  orders,
  refunds,
} from "../../src/db/schema.js";
import { legacyPropertiesToConfig } from "./lib.js";

/* ------------------------------------------------------------------------ */
/*  Les fichiers                                                            */
/* ------------------------------------------------------------------------ */

/** Ce qu'il faut exporter de Shopify, dit à qui n'a pas encore les fichiers. */
export const CONSIGNE_EXPORT = [
  "Depuis l'administration Shopify :",
  "  • Clients › Exporter › « Tous les clients », au format CSV",
  "    → customers_export.csv (ou customers_export_1.csv) ;",
  "  • Commandes › Exporter › « Toutes les commandes », au format CSV",
  "    → orders_export_1.csv, parfois suivi de orders_export_2.csv…",
  "Déposez-les tels quels dans le dossier, sans les renommer ni les rouvrir dans Excel.",
].join("\n");

/** Un refus du dossier entier, avec la phrase à montrer. */
export class ImportImpossible extends Error {}

export interface FichiersTrouves {
  clientes: string[];
  commandes: string[];
  format: "natif" | "matrixify" | null;
}

const NATIF_CLIENTES = /^customers_export(?:_(\d+))?\.csv$/i;
const NATIF_COMMANDES = /^orders_export(?:_(\d+))?\.csv$/i;

/** « orders_export_2.csv » → 2 ; sans numéro → 0. */
function rangDuFichier(nom: string, motif: RegExp): number {
  const m = motif.exec(nom);
  return m?.[1] ? Number(m[1]) : 0;
}

/**
 * Les fichiers à lire, dans l'ordre : orders_export_2 après orders_export_1,
 * et non après orders_export_10 comme le voudrait l'ordre alphabétique.
 *
 * L'export natif d'abord. Les noms Matrixify ne servent que s'il n'y a aucun
 * fichier natif : mélanger deux exports ferait lire deux fois les mêmes ventes.
 */
export function trouverFichiers(noms: readonly string[]): FichiersTrouves {
  const trier = (motif: RegExp) =>
    noms
      .filter((n) => motif.test(n))
      .sort((a, b) => rangDuFichier(a, motif) - rangDuFichier(b, motif) || a.localeCompare(b));
  const clientes = trier(NATIF_CLIENTES);
  const commandes = trier(NATIF_COMMANDES);
  if (clientes.length || commandes.length) return { clientes, commandes, format: "natif" };
  const nomme = (nom: string) => noms.filter((n) => n.toLowerCase() === nom.toLowerCase());
  const mxClientes = nomme("Customers.csv");
  const mxCommandes = nomme("Orders.csv");
  if (mxClientes.length || mxCommandes.length)
    return { clientes: mxClientes, commandes: mxCommandes, format: "matrixify" };
  return { clientes: [], commandes: [], format: null };
}

/** Une ligne de CSV : ses cellules, rangées par en-tête normalisé. */
export type LigneCsv = Record<string, string>;

export interface TableCsv {
  fichier: string;
  /** Les en-têtes normalisés, dans l'ordre du fichier. */
  entetes: string[];
  /** `numero` : la ligne du tableur (l'en-tête est la ligne 1). */
  lignes: { numero: number; cellules: LigneCsv }[];
}

/** Un nom de colonne comparable : espaces resserrés, casse ignorée. */
export function normaliserEntete(v: string): string {
  return v.replace(/^﻿/, "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Le texte d'un fichier, quel que soit son encodage.
 *
 * Shopify écrit de l'UTF-8. Un fichier repassé par Excel peut revenir en
 * UTF-16 (avec sa marque en tête) ou en Windows-1252 : on le lit quand même
 * plutôt que de voir « Ã© » à la place de chaque « é ».
 */
export function decoder(contenu: Buffer | string): string {
  if (typeof contenu === "string") return contenu.replace(/^﻿/, "");
  if (contenu[0] === 0xff && contenu[1] === 0xfe)
    return contenu.subarray(2).toString("utf16le");
  if (contenu[0] === 0xfe && contenu[1] === 0xff) {
    const corps = contenu.subarray(2);
    const pair = Buffer.from(corps.subarray(0, corps.length - (corps.length % 2)));
    return pair.swap16().toString("utf16le");
  }
  const utf8 = contenu.toString("utf8").replace(/^﻿/, "");
  // Des caractères de remplacement : ce n'était pas de l'UTF-8.
  return utf8.includes("�") ? contenu.toString("latin1") : utf8;
}

/**
 * Le séparateur du fichier : virgule (Shopify), point-virgule (Excel en
 * français) ou tabulation. Compté sur la première ligne, hors guillemets.
 */
export function separateurDe(texte: string): "," | ";" | "\t" {
  const compte = { ",": 0, ";": 0, "\t": 0 };
  let entreGuillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i]!;
    if (c === '"') {
      entreGuillemets = !entreGuillemets;
      continue;
    }
    if (entreGuillemets) continue;
    if (c === "\n" || c === "\r") break;
    if (c === "," || c === ";" || c === "\t") compte[c] += 1;
  }
  if (compte[";"] > compte[","] && compte[";"] >= compte["\t"]) return ";";
  if (compte["\t"] > compte[","]) return "\t";
  return ",";
}

/** Lit un fichier CSV en table. Refuse en clair un fichier qui ne se lit pas. */
export function lireTable(fichier: string, contenu: Buffer | string): TableCsv {
  const texte = decoder(contenu);
  let brut: string[][];
  try {
    brut = parse(texte, {
      delimiter: separateurDe(texte),
      bom: true,
      relax_quotes: true,
      relax_column_count: true,
      skip_empty_lines: false,
    }) as string[][];
  } catch (e) {
    throw new ImportImpossible(
      `Le fichier ${fichier} ne se lit pas comme un CSV (${(e as Error).message}). Refaites l'export depuis Shopify.`,
    );
  }
  const entetes = (brut[0] ?? []).map((n) => normaliserEntete(String(n ?? "")));
  const lignes: TableCsv["lignes"] = [];
  for (let i = 1; i < brut.length; i++) {
    const valeurs = brut[i] ?? [];
    if (valeurs.every((v) => !String(v ?? "").trim())) continue;
    // Sans prototype : un en-tête « __proto__ » reste une simple colonne.
    const cellules = Object.create(null) as LigneCsv;
    entetes.forEach((nom, j) => {
      if (nom && !Object.hasOwn(cellules, nom)) cellules[nom] = String(valeurs[j] ?? "");
    });
    lignes.push({ numero: i + 1, cellules });
  }
  return { fichier, entetes, lignes };
}

export interface DossierLu {
  dossier: string;
  fichiers: FichiersTrouves;
  clientes: TableCsv[];
  commandes: TableCsv[];
}

/**
 * Lit le dossier des exports. Refuse, avec la phrase qui dit quoi exporter,
 * s'il manque les clientes ou les commandes : l'un sans l'autre ferait des
 * commandes sans abonnement connu, ou des clientes sans historique.
 */
export function lireDossier(dossier: string): DossierLu {
  let noms: string[];
  try {
    noms = readdirSync(dossier);
  } catch {
    throw new ImportImpossible(`Le dossier ${dossier} n'existe pas.\n\n${CONSIGNE_EXPORT}`);
  }
  const fichiers = trouverFichiers(noms);
  const manque: string[] = [];
  if (!fichiers.clientes.length) manque.push("l'export des clientes (customers_export.csv)");
  if (!fichiers.commandes.length) manque.push("l'export des commandes (orders_export_1.csv)");
  if (manque.length)
    throw new ImportImpossible(
      `Il manque ${manque.join(" et ")} dans ${dossier}.\n\n${CONSIGNE_EXPORT}`,
    );
  const lire = (nom: string) => lireTable(nom, readFileSync(join(dossier, nom)));
  return {
    dossier,
    fichiers,
    clientes: fichiers.clientes.map(lire),
    commandes: fichiers.commandes.map(lire),
  };
}

/* ------------------------------------------------------------------------ */
/*  Lecture des valeurs                                                     */
/* ------------------------------------------------------------------------ */

/** La première valeur non vide parmi ces colonnes. */
function brut(l: LigneCsv, noms: readonly string[]): string {
  for (const n of noms) {
    const v = l[n];
    if (v !== undefined && v.trim() !== "") return v;
  }
  return "";
}

const sansAccent = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Une valeur de cellule nettoyée (règle de import-clients.ts).
 *
 * L'apostrophe de tête est celle que Shopify pose devant un numéro (« '+33 6… »,
 * « '75011 », l'identifiant d'une cliente) pour qu'Excel n'en fasse pas un
 * nombre : elle n'appartient pas à la valeur.
 */
export function propre(v: string | undefined, max: number): string {
  return String(v ?? "")
    .trim()
    .replace(/^'/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * « oui », « yes », « abonné », « x »… (import-clients.ts). Null quand la
 * cellule est vide ou illisible : une case illisible n'abonne personne.
 */
export function ouiNon(valeur: string): boolean | null {
  const v = sansAccent(valeur).trim().toLowerCase().replace(/[_-]/g, " ");
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

/** La forme d'une adresse e-mail (import-clients.ts). */
export const EMAIL_VALIDE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Des codes périmés que le navigateur nomme encore comme les pays
 * d'aujourd'hui : « FX » s'appelle « France », « UK » « Royaume-Uni », « SU »
 * « Russie », « DD » « Allemagne »… Venant après le bon code dans l'alphabet,
 * ils le remplaçaient : « France » devenait « FX », que les transporteurs ne
 * connaissent pas. La table d'import-clients.ts a encore ce défaut.
 */
const CODES_PERIMES = new Set([
  "AN", "BU", "CS", "DD", "DY", "FX", "HV", "NH", "RH", "SU", "TP", "UK", "VD", "YD", "YU", "ZR",
]);

/** Les codes pays, depuis leur nom en français ou en anglais (import-clients.ts). */
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
        if (nom && nom !== code) carte.set(sansAccent(nom).toLowerCase(), code);
      }
    }
  return carte;
})();

/** « France », « FR » ou « fr » → « FR ». Un nom inconnu reste tel quel. */
export function codePays(valeur: string): string | null {
  const v = valeur.trim();
  if (!v) return null;
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  return CODES_DES_PAYS.get(sansAccent(v).toLowerCase()) ?? v.slice(0, 60);
}

/** Une étiquette normalisée (comptes.ts) : espaces resserrés, 40 signes. */
function etiquette(v: unknown): string {
  return String(v ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 40);
}

/** « VIP, Salon Colmar » → ["VIP", "Salon Colmar"], sans doublon de casse. */
export function etiquettesDe(valeur: string): string[] {
  const vues = new Set<string>();
  const sortie: string[] = [];
  for (const morceau of valeur.split(/[,;]/)) {
    const e = etiquette(morceau);
    if (!e || vues.has(e.toLowerCase())) continue;
    vues.add(e.toLowerCase());
    sortie.push(e);
  }
  return sortie.slice(0, 30);
}

/** Le nom complet, à partir du prénom et du nom (comptes.ts). */
export function nomComplet(
  prenom: string | null | undefined,
  nom: string | null | undefined,
  ancien?: string | null,
): string | null {
  const morceaux = [String(prenom ?? "").trim(), String(nom ?? "").trim()].filter(Boolean);
  if (morceaux.length) return morceaux.join(" ").slice(0, 160);
  return (ancien ?? "").trim() || null;
}

/**
 * Un montant en centimes : « 23.00 » → 2300. Tolère la virgule, les espaces
 * et le signe euro d'un fichier repassé par Excel. Null si vide ou illisible :
 * un montant inconnu n'est pas un montant nul.
 */
export function centimes(valeur: string | undefined): number | null {
  let v = propre(valeur, 40).replace(/[\s  €]/g, "");
  if (!v) return null;
  if (/^-?\d+,\d+$/.test(v)) v = v.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(v)) return null;
  return Math.round(Number(v) * 100);
}

/** Un entier, ou null. */
export function entier(valeur: string | undefined): number | null {
  const v = propre(valeur, 20);
  return /^-?\d+$/.test(v) ? Number(v) : null;
}

/** Un identifiant Shopify (« 5123456789012 », parfois « '5123… »), ou null. */
export function identifiant(valeur: string | undefined): number | null {
  const v = propre(valeur, 30);
  if (!/^\d{1,18}$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

const DATE_SHOPIFY =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|UTC|[+-]\d{2}:?\d{2})?$/i;
const DATE_EXCEL = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * Une date de l'export : « 2025-12-03 10:15:22 +0100 ».
 *
 * Lue à la main plutôt que par `new Date`, qui ne garantit rien sur cette
 * forme. Sans décalage horaire, l'heure est celle de Paris (instantDeParis),
 * comme celle d'un fichier repassé par Excel (« 03/12/2025 10:15 »). Null si
 * la date ne se lit pas : on ne range jamais une vente à une date inventée.
 */
export function lireDate(valeur: string | undefined): Date | null {
  const v = propre(valeur, 40);
  if (!v) return null;
  const deux = (n: string | undefined) => (n ?? "0").padStart(2, "0");
  const m = DATE_SHOPIFY.exec(v);
  if (m) {
    const jour = `${m[1]}-${m[2]}-${m[3]}`;
    const heure = m[4] ? `${m[4]}:${m[5]}:${deux(m[6])}` : "00:00:00";
    const fuseau = m[7]?.toUpperCase();
    if (!fuseau) return instantDeParis(`${jour}T${heure}`);
    const decalage =
      fuseau === "Z" || fuseau === "UTC"
        ? "Z"
        : `${fuseau.slice(0, 3)}:${fuseau.slice(-2)}`;
    const d = new Date(`${jour}T${heure}${decalage}`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const e = DATE_EXCEL.exec(v);
  if (e) {
    const jour = `${e[3]}-${deux(e[2])}-${deux(e[1])}`;
    const heure = e[4] ? `${deux(e[4])}:${e[5]}:${deux(e[6])}` : "00:00:00";
    return instantDeParis(`${jour}T${heure}`);
  }
  return null;
}

/** « Partially Refunded » → « partially_refunded ». « null » → vide. */
export function code(valeur: string | undefined): string {
  const v = propre(valeur, 60).toLowerCase().replace(/[\s-]+/g, "_");
  return v === "null" || v === "none" ? "" : v;
}

export interface Ecart {
  fichier: string;
  ligne: number;
  raison: string;
}

/* ------------------------------------------------------------------------ */
/*  Les clientes                                                            */
/* ------------------------------------------------------------------------ */

/**
 * Les colonnes reconnues, du plus précis au plus vague : celles de
 * import-clients.ts (export Shopify récent, ancien export, tableur en
 * français), plus celles de Matrixify.
 */
const COLONNES_CLIENTE = {
  email: ["email", "e-mail", "adresse e-mail", "adresse email", "adresse mail", "courriel", "mail"],
  prenom: ["first name", "prénom", "prenom", "firstname"],
  nomFamille: ["last name", "nom de famille", "lastname"],
  nomComplet: ["name", "nom complet", "nom du client", "nom de la cliente", "customer name", "full name"],
  telephone: ["phone", "téléphone", "telephone", "tél", "tel", "mobile", "portable"],
  telephoneAdresse: ["default address phone", "address: phone"],
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
  adresse1: ["default address address1", "address1", "address 1", "address: address 1", "adresse", "adresse 1", "adresse1", "rue"],
  adresse2: [
    "default address address2",
    "address2",
    "address 2",
    "address: address 2",
    "adresse 2",
    "adresse2",
    "complément d'adresse",
    "complement d'adresse",
  ],
  ville: ["default address city", "city", "address: city", "ville"],
  codePostal: ["default address zip", "zip", "address: zip", "code postal", "cp", "postal code", "zip code"],
  pays: [
    "default address country code",
    "country code",
    "address: country code",
    "code pays",
    "default address country",
    "country",
    "address: country",
    "pays",
  ],
  idShopify: ["customer id", "id client shopify", "id"],
  hautDeGroupe: ["top row"],
} as const;

export interface AdresseLue {
  line1: string;
  line2: string | null;
  postalCode: string | null;
  city: string;
  country: string | null;
  phone: string | null;
}

/** Une cliente telle que les fichiers la décrivent. */
export interface ClienteLue {
  email: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  note: string | null;
  tags: string[];
  /** Null : la colonne manque, ou la case est vide ou illisible. */
  abonnement: boolean | null;
  adresse: AdresseLue | null;
  idShopify: number | null;
  /** « clientes » : le fichier des clientes ; « commandes » : vue dans une commande seulement. */
  source: "clientes" | "commandes";
}

export interface LectureClientes {
  clientes: ClienteLue[];
  ecartees: Ecart[];
  /** Lignes de données lues, toutes tables confondues. */
  lignes: number;
}

export function lireClientes(tables: readonly TableCsv[]): LectureClientes {
  const C = COLONNES_CLIENTE;
  const clientes: ClienteLue[] = [];
  const ecartees: Ecart[] = [];
  const vues = new Map<string, string>();
  let lignes = 0;
  for (const table of tables) {
    for (const { numero, cellules } of table.lignes) {
      lignes++;
      // Matrixify : une ligne par adresse. Seule la « Top Row » décrit la
      // cliente ; les suivantes ne portent que ses autres adresses.
      if (Object.hasOwn(cellules, "top row") && ouiNon(brut(cellules, C.hautDeGroupe)) !== true)
        continue;
      const val = (noms: readonly string[], max = 200) => propre(brut(cellules, noms), max);
      const ecarter = (raison: string) =>
        ecartees.push({ fichier: table.fichier, ligne: numero, raison });

      const email = val(C.email, 254).toLowerCase();
      if (!email) {
        ecarter("pas d'adresse e-mail : rien ne permettrait de reconnaître cette cliente");
        continue;
      }
      if (!EMAIL_VALIDE.test(email)) {
        ecarter("adresse e-mail illisible");
        continue;
      }
      const premiere = vues.get(email);
      if (premiere) {
        ecarter(`même adresse que ${premiere} : une seule fiche par adresse`);
        continue;
      }
      vues.set(email, `${table.fichier} ligne ${numero}`);

      const prenom = val(C.prenom, 80);
      const famille = val(C.nomFamille, 80);
      const complet = val(C.nomComplet, 160);
      const telephone = val(C.telephone, 40) || val(C.telephoneAdresse, 40) || null;
      const line1 = val(C.adresse1, 200);
      const ville = val(C.ville, 120);
      // Une adresse n'entre au carnet que complète : une rue ET une ville.
      const adresse: AdresseLue | null =
        line1 && ville
          ? {
              line1,
              line2: val(C.adresse2, 200) || null,
              postalCode: val(C.codePostal, 20) || null,
              city: ville,
              country: codePays(val(C.pays, 60)),
              phone: val(C.telephoneAdresse, 40) || telephone,
            }
          : null;
      clientes.push({
        email,
        name: prenom || famille ? nomComplet(prenom, famille) : complet || null,
        firstName: prenom || null,
        lastName: famille || null,
        phone: telephone,
        note: val(C.note, 2000) || null,
        tags: etiquettesDe(val(C.etiquettes, 1000)),
        abonnement: ouiNon(val(C.abonnement, 40)),
        adresse,
        idShopify: identifiant(brut(cellules, C.idShopify)),
        source: "clientes",
      });
    }
  }
  return { clientes, ecartees, lignes };
}

/* ------------------------------------------------------------------------ */
/*  Les commandes                                                           */
/* ------------------------------------------------------------------------ */

/** Colonnes de l'export natif, puis leur équivalent Matrixify. */
const COLONNES_COMMANDE = {
  nom: ["name"],
  id: ["id"],
  email: ["email", "customer: email"],
  financier: ["financial status", "payment: status"],
  payeLe: ["paid at"],
  expedition: ["fulfillment status", "order fulfillment status"],
  expedieLe: ["fulfilled at", "fulfillment: created at"],
  abonnement: [
    "accepts marketing",
    "accepts email marketing",
    "customer: accepts marketing",
    "customer: accepts email marketing",
  ],
  devise: ["currency"],
  total: ["total", "price: total"],
  port: ["shipping", "price: total shipping"],
  codePromo: ["discount code"],
  modeLivraison: ["shipping method"],
  creeLe: ["created at"],
  annuleLe: ["cancelled at"],
  moyenPaiement: ["payment method", "transaction: gateway"],
  rembourse: ["refunded amount", "price: total refund"],
  etiquettes: ["tags"],
  source: ["source"],
  note: ["notes", "note"],
  telephone: ["phone", "customer: phone", "billing phone", "billing: phone"],
  facturationNom: ["billing name"],
  facturationPrenom: ["billing: first name"],
  facturationNomFamille: ["billing: last name"],
  clientePrenom: ["customer: first name"],
  clienteNomFamille: ["customer: last name"],
  clienteId: ["customer: id"],
  livraisonNom: ["shipping name"],
  livraisonPrenom: ["shipping: first name"],
  livraisonNomFamille: ["shipping: last name"],
  livraisonAdresse1: ["shipping address1", "shipping: address 1"],
  livraisonAdresse2: ["shipping address2", "shipping: address 2"],
  livraisonVille: ["shipping city", "shipping: city"],
  livraisonCodePostal: ["shipping zip", "shipping: zip"],
  livraisonPays: ["shipping country", "shipping: country code", "shipping: country"],
  livraisonTelephone: ["shipping phone", "shipping: phone"],
  hautDeGroupe: ["top row"],
  typeLigne: ["line: type"],
  articleTitre: ["lineitem name", "line: name", "line: title"],
  articleQuantite: ["lineitem quantity", "line: quantity"],
  articlePrix: ["lineitem price", "line: price"],
  articleSku: ["lineitem sku", "line: sku"],
  articleProduitId: ["line: product id"],
  articleVarianteId: ["line: variant id"],
  articleProprietes: ["line: properties"],
} as const;

export interface ArticleLu {
  titre: string;
  quantite: number;
  prixCents: number;
  sku: string | null;
  /** Matrixify seulement : l'export natif ne donne pas ces identifiants. */
  produitShopifyId: number | null;
  varianteShopifyId: number | null;
  /** « Line: Properties » de Matrixify : la personnalisation de l'affiche. */
  proprietes: string | null;
}

export interface LivraisonLue {
  nom: string | null;
  ligne1: string | null;
  ligne2: string | null;
  codePostal: string | null;
  ville: string | null;
  pays: string | null;
  telephone: string | null;
}

/** Une commande telle que l'export la décrit, toutes ses lignes réunies. */
export interface CommandeLue {
  /** « #1001 ». Null si l'export n'avait que l'identifiant. */
  nom: string | null;
  idShopify: number | null;
  /** En minuscules, et seulement si elle a la forme d'une adresse. */
  email: string | null;
  financier: string;
  expedition: string;
  creeLe: Date | null;
  payeLe: Date | null;
  expedieLe: Date | null;
  annuleLe: Date | null;
  abonnement: boolean | null;
  devise: string | null;
  totalCents: number | null;
  portCents: number;
  remboursementCents: number;
  codePromo: string | null;
  modeLivraison: string | null;
  moyenPaiement: string | null;
  source: string;
  etiquettes: string[];
  note: string | null;
  telephone: string | null;
  nomCliente: string | null;
  clienteShopifyId: number | null;
  livraison: LivraisonLue;
  articles: ArticleLu[];
  fichiers: string[];
}

export interface LectureCommandes {
  commandes: CommandeLue[];
  ecartees: Ecart[];
  /** Commandes présentes, entières, dans deux fichiers : lues une seule fois. */
  doublons: string[];
  lignes: number;
}

/**
 * La première ligne d'une commande : celle qui porte ses champs à elle.
 * Natif : le statut de paiement ou le total ; Matrixify : « Top Row ».
 */
function estTete(l: LigneCsv): boolean {
  const C = COLONNES_COMMANDE;
  return (
    !!brut(l, C.financier) ||
    !!brut(l, C.total) ||
    ouiNon(brut(l, C.hautDeGroupe)) === true
  );
}

/**
 * Lit les commandes, toutes leurs lignes réunies par numéro (« Name »).
 *
 * Plusieurs fichiers se lisent comme un seul : une commande coupée entre
 * orders_export_1 et orders_export_2 se recolle. Mais une commande présente
 * ENTIÈRE dans deux fichiers — deux exports déposés côte à côte — n'est lue
 * qu'une fois : recollée, elle aurait ses articles en double.
 */
export function lireCommandes(tables: readonly TableCsv[]): LectureCommandes {
  const C = COLONNES_COMMANDE;
  interface Groupe {
    lignes: LigneCsv[];
    aUneTete: boolean;
    fichiers: string[];
  }
  const groupes = new Map<string, Groupe>();
  const ecartees: Ecart[] = [];
  const doublons: string[] = [];
  let lignes = 0;

  for (const table of tables) {
    const portions = new Map<string, LigneCsv[]>();
    for (const { numero, cellules } of table.lignes) {
      lignes++;
      const nom = propre(brut(cellules, C.nom), 60);
      const id = propre(brut(cellules, C.id), 30);
      const cle = nom || (id ? `id:${id}` : "");
      if (!cle) {
        ecartees.push({
          fichier: table.fichier,
          ligne: numero,
          raison: "ni numéro (« Name ») ni identifiant (« Id ») : on ne sait pas à quelle commande elle appartient",
        });
        continue;
      }
      const portion = portions.get(cle);
      if (portion) portion.push(cellules);
      else portions.set(cle, [cellules]);
    }
    for (const [cle, rangees] of portions) {
      const aUneTete = rangees.some(estTete);
      const groupe = groupes.get(cle);
      if (!groupe) groupes.set(cle, { lignes: rangees, aUneTete, fichiers: [table.fichier] });
      else if (aUneTete && groupe.aUneTete) doublons.push(`${cle} (${table.fichier})`);
      else {
        groupe.lignes.push(...rangees);
        groupe.aUneTete ||= aUneTete;
        groupe.fichiers.push(table.fichier);
      }
    }
  }

  const commandes: CommandeLue[] = [];
  for (const [cle, groupe] of groupes) {
    const tete = groupe.lignes.find(estTete) ?? groupe.lignes[0]!;
    /** La valeur de la première ligne, ou à défaut la première trouvée. */
    const champ = (noms: readonly string[]) => {
      const v = brut(tete, noms);
      if (v) return v;
      for (const l of groupe.lignes) {
        const w = brut(l, noms);
        if (w) return w;
      }
      return "";
    };
    const val = (noms: readonly string[], max = 200) => propre(champ(noms), max);

    const articles: ArticleLu[] = [];
    for (const l of groupe.lignes) {
      if (Object.hasOwn(l, "line: type")) {
        if (code(brut(l, C.typeLigne)) !== "line_item") continue;
      } else if (!brut(l, C.articleTitre) && !brut(l, C.articleQuantite)) continue;
      articles.push({
        titre: propre(brut(l, C.articleTitre), 300) || "Article sans titre",
        quantite: entier(brut(l, C.articleQuantite)) ?? 1,
        prixCents: centimes(brut(l, C.articlePrix)) ?? 0,
        sku: propre(brut(l, C.articleSku), 100) || null,
        produitShopifyId: identifiant(brut(l, C.articleProduitId)),
        varianteShopifyId: identifiant(brut(l, C.articleVarianteId)),
        proprietes: brut(l, C.articleProprietes).trim() || null,
      });
    }

    const emailBrut = val(C.email, 254).toLowerCase();
    const prenomLivraison = val(C.livraisonPrenom, 80);
    const familleLivraison = val(C.livraisonNomFamille, 80);
    const nomLivraison =
      val(C.livraisonNom, 160) || nomComplet(prenomLivraison, familleLivraison) || null;
    commandes.push({
      nom: cle.startsWith("id:") ? null : cle,
      idShopify: identifiant(champ(C.id)),
      email: EMAIL_VALIDE.test(emailBrut) ? emailBrut : null,
      financier: code(champ(C.financier)),
      expedition: code(champ(C.expedition)),
      creeLe: lireDate(champ(C.creeLe)),
      payeLe: lireDate(champ(C.payeLe)),
      expedieLe: lireDate(champ(C.expedieLe)),
      annuleLe: lireDate(champ(C.annuleLe)),
      abonnement: ouiNon(val(C.abonnement, 40)),
      devise: val(C.devise, 10).toUpperCase() || null,
      totalCents: centimes(champ(C.total)),
      portCents: centimes(champ(C.port)) ?? 0,
      remboursementCents: Math.max(0, centimes(champ(C.rembourse)) ?? 0),
      codePromo: val(C.codePromo, 100) || null,
      modeLivraison: val(C.modeLivraison, 160) || null,
      moyenPaiement: val(C.moyenPaiement, 120) || null,
      source: val(C.source, 60).toLowerCase(),
      etiquettes: etiquettesDe(val(C.etiquettes, 1000)),
      note: val(C.note, 5000) || null,
      telephone: val(C.telephone, 40) || null,
      nomCliente:
        val(C.facturationNom, 160) ||
        nomComplet(val(C.facturationPrenom, 80), val(C.facturationNomFamille, 80)) ||
        nomComplet(val(C.clientePrenom, 80), val(C.clienteNomFamille, 80)) ||
        nomLivraison,
      clienteShopifyId: identifiant(champ(C.clienteId)),
      livraison: {
        nom: nomLivraison,
        ligne1: val(C.livraisonAdresse1) || null,
        ligne2: val(C.livraisonAdresse2) || null,
        codePostal: val(C.livraisonCodePostal, 20) || null,
        ville: val(C.livraisonVille, 120) || null,
        pays: codePays(val(C.livraisonPays, 60)),
        telephone: val(C.livraisonTelephone, 40) || null,
      },
      articles,
      fichiers: [...new Set(groupe.fichiers)],
    });
  }
  return { commandes, ecartees, doublons, lignes };
}

/* ------------------------------------------------------------------------ */
/*  Statut, canal et numéro d'une commande reprise                          */
/* ------------------------------------------------------------------------ */

/** Les statuts de paiement Shopify qui disent : l'argent est arrivé. */
const PAYEES = new Set(["paid", "partially_paid", "partially_refunded"]);
/** Les statuts d'expédition Shopify qui disent : le colis est parti. */
const EXPEDIEES = new Set(["fulfilled", "partial", "partially_fulfilled", "shipped"]);

export interface StatutRepris {
  /** Toujours un statut CLOS : jamais « pending », « authorized » ni « draft ». */
  status: "paid" | "cancelled" | "voided";
  /** Compte dans les ventes et le chiffre d'affaires. */
  vente: boolean;
  /** Posée avec « cancelled », jamais sans (règle de la route d'annulation). */
  cancelledAt: Date | null;
  /** Une expédition « success » couvre tous ses articles. */
  expedier: boolean;
  /** Date de traitement : non nulle pour toute vente, sinon elle serait « à traiter ». */
  fulfilledAt: Date | null;
  /** Hors ventes : rangée aux archives, hors de toutes les listes de travail. */
  archiver: boolean;
}

/**
 * Le statut que prend une commande Shopify ici.
 *
 * Les statistiques ne comptent que « paid » sans date d'annulation
 * (analytique.ts, /admin/stats/orders) ; les finances, les fiches clientes et
 * les ventes d'une affiche comptent tout ce qui n'est pas dans HORS_VENTES
 * (« draft », « cancelled », « voided »). D'où trois statuts, et trois
 * seulement :
 *
 *   - annulée dans Shopify (« Cancelled at ») → « cancelled », avec sa date ;
 *   - payée (paid, partially_paid, partially_refunded) → « paid » : une vente,
 *     comptée à sa date d'origine ;
 *   - tout le reste → « voided » : remboursée en totalité (refunded),
 *     autorisation annulée (voided), et aussi jamais payée (pending,
 *     authorized, expired). Shopify dit qu'aucun argent n'est resté : ce
 *     n'est pas une vente.
 *
 * « pending » et « authorized » ne sont JAMAIS repris tels quels : le
 * travailleur des relances (relance-panier.ts) prendrait une commande du site
 * restée « pending » pour un panier abandonné, et écrirait à la cliente ; la
 * liste « Impayées » la montrerait comme un paiement à réclamer.
 *
 * Une vente reçoit toujours une date de traitement et une expédition :
 * sinon elle compterait dans « À traiter » et dans « À expédier », même
 * quand Shopify ne la disait pas expédiée (ventes de salon remises en main
 * propre, commandes jamais marquées). Une non-vente est rangée aux archives :
 * c'est ce qui la sort de « Non traitées » sans prétendre qu'elle est partie.
 */
export function statutRepris(c: {
  financier: string;
  expedition: string;
  creeLe: Date;
  payeLe: Date | null;
  expedieLe: Date | null;
  annuleLe: Date | null;
}): StatutRepris {
  const annulee = c.annuleLe !== null;
  const vente = !annulee && PAYEES.has(c.financier);
  const expedier = vente || EXPEDIEES.has(c.expedition);
  return {
    status: annulee ? "cancelled" : vente ? "paid" : "voided",
    vente,
    cancelledAt: annulee ? c.annuleLe : null,
    expedier,
    fulfilledAt: expedier ? (c.expedieLe ?? c.payeLe ?? c.creeLe) : null,
    archiver: !vente,
  };
}

/**
 * Le canal d'une commande Shopify. « pos » (la caisse Shopify) et
 * « shopify_draft_order » (la commande saisie à la main, l'outil des salons)
 * sont des ventes de stand ; tout le reste — « web », une application, une
 * source vide — est une vente du site.
 */
export function canalRepris(source: string): "web" | "salon" {
  const s = source.trim().toLowerCase();
  return s === "pos" || s === "shopify_draft_order" ? "salon" : "web";
}

/** Le préfixe des commandes reprises. Hors des séries WEB-, SAL- et DRAFT-. */
export const PREFIXE_REPRISE = "SHOP-";

/**
 * Le numéro d'une commande reprise : « #1001 » devient « SHOP-1001 ».
 *
 * Un préfixe à part, parce que le compteur du site (numeros-commande.ts) ne
 * lit que les numéros « WEB-<chiffres> » et « SAL-<chiffres> » : « SHOP-1001 »
 * n'y entre pas, ne décale pas la séquence, et ne peut pas croiser un
 * numéro du site sur l'index unique. Dérivé du numéro Shopify, il est stable
 * d'un passage à l'autre et se reconnaît d'un coup d'œil. Pas de « # » : le
 * numéro entre dans des noms de fichiers et des adresses.
 */
export function numeroRepris(nom: string | null, idShopify: number | null): string | null {
  const corps = sansAccent(String(nom ?? "").trim().replace(/^#+/, ""))
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (corps) return PREFIXE_REPRISE + corps;
  return idShopify ? `${PREFIXE_REPRISE}ID${idShopify}` : null;
}

/* ------------------------------------------------------------------------ */
/*  Le rattachement des articles au catalogue                               */
/* ------------------------------------------------------------------------ */

export interface ProduitCatalogue {
  id: number;
  name: string;
  legacyId: number | null;
}

export interface VarianteCatalogue {
  id: number;
  productId: number;
  format: string;
  sku: string | null;
  legacyId: number | null;
}

export interface IndexCatalogue {
  parSku: Map<string, VarianteCatalogue>;
  parNom: Map<string, number>;
  variantesDe: Map<number, VarianteCatalogue[]>;
  produitParShopify: Map<number, number>;
  varianteParShopify: Map<number, VarianteCatalogue>;
}

/** Un titre comparable : sans accents, sans casse, tirets et espaces unifiés. */
export function titreComparable(s: string): string {
  return sansAccent(s)
    .toLowerCase()
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Le format nommé dans un texte : « A4 (21 x 29.7 cm) » → « A4 ». */
function formatDe(texte: string): string | null {
  const m = /\bA\s?(\d)\b/i.exec(texte);
  return m ? `A${m[1]}` : null;
}

/**
 * L'index du catalogue. Une référence (sku) ou un nom porté par DEUX fiches
 * n'est pas retenu : mieux vaut un article non rattaché qu'un article
 * rattaché à la mauvaise affiche.
 */
export function indexerCatalogue(
  produits: readonly ProduitCatalogue[],
  variantes: readonly VarianteCatalogue[],
): IndexCatalogue {
  const parSku = new Map<string, VarianteCatalogue>();
  const skuEnDouble = new Set<string>();
  const variantesDe = new Map<number, VarianteCatalogue[]>();
  const varianteParShopify = new Map<number, VarianteCatalogue>();
  for (const v of variantes) {
    const sku = (v.sku ?? "").trim().toUpperCase();
    if (sku) {
      if (parSku.has(sku)) skuEnDouble.add(sku);
      else parSku.set(sku, v);
    }
    variantesDe.set(v.productId, [...(variantesDe.get(v.productId) ?? []), v]);
    if (v.legacyId) varianteParShopify.set(v.legacyId, v);
  }
  for (const s of skuEnDouble) parSku.delete(s);

  const parNom = new Map<string, number>();
  const nomEnDouble = new Set<string>();
  const produitParShopify = new Map<number, number>();
  for (const p of produits) {
    const nom = titreComparable(p.name);
    if (nom) {
      if (parNom.has(nom)) nomEnDouble.add(nom);
      else parNom.set(nom, p.id);
    }
    if (p.legacyId) produitParShopify.set(p.legacyId, p.id);
  }
  for (const n of nomEnDouble) parNom.delete(n);
  return { parSku, parNom, variantesDe, produitParShopify, varianteParShopify };
}

export interface Rattachement {
  productId: number | null;
  variantId: number | null;
  par: "shopify" | "sku" | "titre" | null;
}

/**
 * L'affiche (et son format) d'un article Shopify.
 *
 * Dans l'ordre : les identifiants Shopify (Matrixify seulement), la référence
 * (sku), puis le titre. L'export natif nomme l'article « Titre de l'affiche -
 * Format » : le titre se compare d'abord entier, puis coupé au DERNIER
 * « - », parce que les noms d'affiches en contiennent eux-mêmes
 * (« MERS-LES-BAINS Baigneurs - Affiche personnalisée - A4 (21 x 29.7 cm) »).
 * Le format n'est retenu que s'il désigne une seule variante de l'affiche.
 */
export function rattacher(article: ArticleLu, index: IndexCatalogue): Rattachement {
  const varianteDuFormat = (productId: number, texte: string | null): number | null => {
    const variantes = index.variantesDe.get(productId) ?? [];
    const format = texte ? formatDe(texte) : null;
    if (!format) return variantes.length === 1 ? variantes[0]!.id : null;
    const memes = variantes.filter((v) => v.format.trim().toUpperCase() === format);
    return memes.length === 1 ? memes[0]!.id : null;
  };

  if (article.varianteShopifyId) {
    const v = index.varianteParShopify.get(article.varianteShopifyId);
    if (v) return { productId: v.productId, variantId: v.id, par: "shopify" };
  }
  if (article.produitShopifyId) {
    const p = index.produitParShopify.get(article.produitShopifyId);
    if (p) return { productId: p, variantId: varianteDuFormat(p, article.titre), par: "shopify" };
  }
  const sku = (article.sku ?? "").trim().toUpperCase();
  if (sku) {
    const v = index.parSku.get(sku);
    if (v) return { productId: v.productId, variantId: v.id, par: "sku" };
  }
  const titre = titreComparable(article.titre);
  const entier = index.parNom.get(titre);
  if (entier) return { productId: entier, variantId: varianteDuFormat(entier, null), par: "titre" };
  const coupure = titre.lastIndexOf(" - ");
  if (coupure > 0) {
    const produit = index.parNom.get(titre.slice(0, coupure).trim());
    if (produit)
      return {
        productId: produit,
        variantId: varianteDuFormat(produit, titre.slice(coupure + 3)),
        par: "titre",
      };
  }
  return { productId: null, variantId: null, par: null };
}

/* ------------------------------------------------------------------------ */
/*  Le plan : ce que l'écriture fera, et ce que l'aperçu en dit             */
/* ------------------------------------------------------------------------ */

/** Une fiche déjà en base, telle que l'import la confronte au fichier. */
export interface FicheExistante {
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
  legacyId: number | null;
}

/**
 * Une fiche par adresse, en minuscules (règle de import-clients.ts). Quand
 * plusieurs fiches portent la même — des visiteurs sans compte —, on garde
 * celle qui a un compte, sinon la plus récente : c'est elle que la cliente
 * retrouvera en se connectant.
 */
export function choisirFiches(fiches: readonly FicheExistante[]): Map<string, FicheExistante> {
  const carte = new Map<string, FicheExistante>();
  for (const f of fiches) {
    const cle = (f.email ?? "").trim().toLowerCase();
    if (!cle) continue;
    const deja = carte.get(cle);
    if (!deja || (f.compte && !deja.compte) || (f.compte === deja.compte && f.id > deja.id))
      carte.set(cle, { ...f, email: cle });
  }
  return carte;
}

type NouvelleCliente = typeof customers.$inferInsert;
type NouvelleAdresse = Omit<typeof customerAddresses.$inferInsert, "customerId">;

export interface PlanCliente {
  email: string;
  source: "clientes" | "commandes";
  action: "creation" | "mise-a-jour" | "inchange";
  /** La fiche existante, quand il y en a une. */
  ficheId?: number;
  creation: NouvelleCliente | null;
  maj: Partial<NouvelleCliente> | null;
  adresse: NouvelleAdresse | null;
  abonneeCreee: boolean;
  /** Le fichier la dit abonnée, la fiche ne l'est pas : on n'y touche pas. */
  abonnementNonRepris: boolean;
  identifiantPose: boolean;
}

/**
 * Ce que l'import fait d'une cliente lue, face à sa fiche éventuelle.
 *
 * Mêmes règles que `plan` dans import-clients.ts. Une fiche existante :
 * le fichier remplit ce qui est vide (nom, téléphone, note, adresse quand le
 * carnet est vide, identifiant Shopify) et ajoute ses étiquettes ; il ne
 * remplace rien, et ne touche JAMAIS à l'abonnement. Une fiche nouvelle :
 * l'abonnement du fichier, daté du jour de l'import (Shopify ne donne pas la
 * date de l'accord), et pour date de création sa première commande — sinon la
 * liste des clientes la montrerait inscrite d'aujourd'hui.
 *
 * Une adresse désabonnée de la lettre (lien « Me désabonner », noté dans
 * `lettre_jeton`) n'est jamais réabonnée, même sans fiche : le désabonnement
 * efface l'inscription, il ne reste que cette trace.
 */
export function planCliente(
  c: ClienteLue,
  fiche: FicheExistante | undefined,
  maintenant: Date,
  premiereCommande: Date | null,
  desabonnee = false,
): PlanCliente {
  const adresseDe = (nom: string | null): NouvelleAdresse | null =>
    c.adresse
      ? {
          name: nom,
          line1: c.adresse.line1,
          line2: c.adresse.line2,
          postalCode: c.adresse.postalCode,
          city: c.adresse.city,
          country: c.adresse.country,
          phone: c.adresse.phone,
          isDefaultShipping: true,
          isDefaultBilling: true,
        }
      : null;

  if (!fiche) {
    const abonnee = c.abonnement === true && !desabonnee;
    return {
      email: c.email,
      source: c.source,
      action: "creation",
      creation: {
        name: c.name,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        phone: c.phone,
        note: c.note,
        tags: c.tags.length ? c.tags : null,
        acceptsMarketing: abonnee,
        marketingOptInAt: abonnee ? maintenant : null,
        legacyId: c.idShopify,
        createdAt: premiereCommande ?? maintenant,
      },
      maj: null,
      adresse: adresseDe(c.name),
      abonneeCreee: abonnee,
      abonnementNonRepris: c.abonnement === true && desabonnee,
      identifiantPose: false,
    };
  }

  const maj: Partial<NouvelleCliente> = {};
  if (!(fiche.name ?? "").trim() && c.name) {
    maj.name = c.name;
    // Le prénom et le nom séparés ne s'écrivent qu'avec le nom complet
    // qu'ils composent : seuls, ils pourraient le contredire.
    if (c.firstName) maj.firstName = c.firstName;
    if (c.lastName) maj.lastName = c.lastName;
  }
  if (!(fiche.phone ?? "").trim() && c.phone) maj.phone = c.phone;
  if (!(fiche.note ?? "").trim() && c.note) maj.note = c.note;
  const connues = new Set(fiche.tags.map((t) => t.toLowerCase()));
  const nouvelles = c.tags.filter((t) => !connues.has(t.toLowerCase()));
  if (nouvelles.length) maj.tags = [...fiche.tags, ...nouvelles];
  const identifiantPose = fiche.legacyId === null && c.idShopify !== null;
  if (identifiantPose) maj.legacyId = c.idShopify;
  const adresse = !fiche.aUneAdresse ? adresseDe(fiche.name || c.name) : null;
  const aEcrire = Object.keys(maj).length > 0 || adresse !== null;
  return {
    email: c.email,
    source: c.source,
    action: aEcrire ? "mise-a-jour" : "inchange",
    ficheId: fiche.id,
    creation: null,
    maj: Object.keys(maj).length ? maj : null,
    adresse,
    abonneeCreee: false,
    abonnementNonRepris: c.abonnement === true && !fiche.acceptsMarketing,
    identifiantPose,
  };
}

/**
 * Les clientes qu'on ne voit que dans les commandes : un achat sans fiche
 * dans l'export des clientes. Décrites par leur commande la plus récente —
 * son nom de facturation, son téléphone, et l'accord marketing donné ce
 * jour-là. Pas d'adresse au carnet : celle de la commande reste sur la
 * commande.
 */
export function clientesDesCommandes(
  commandes: readonly CommandeLue[],
  dejaLues: ReadonlySet<string>,
): ClienteLue[] {
  const derniere = new Map<string, CommandeLue>();
  for (const c of commandes) {
    if (!c.email || dejaLues.has(c.email)) continue;
    const d = derniere.get(c.email);
    if (!d || (c.creeLe?.getTime() ?? 0) > (d.creeLe?.getTime() ?? 0)) derniere.set(c.email, c);
  }
  return [...derniere.values()].map((c) => ({
    email: c.email!,
    name: c.nomCliente,
    firstName: null,
    lastName: null,
    phone: c.telephone ?? c.livraison.telephone,
    note: null,
    tags: [],
    abonnement: c.abonnement,
    adresse: null,
    idShopify: c.clienteShopifyId,
    source: "commandes" as const,
  }));
}

type NouvelleCommande = Omit<typeof orders.$inferInsert, "customerId">;
type NouvelArticle = Omit<typeof orderItems.$inferInsert, "orderId">;
type NouveauRemboursement = Omit<typeof refunds.$inferInsert, "orderId">;

export interface PlanCommande {
  lue: CommandeLue;
  numero: string;
  statut: StatutRepris;
  /** L'adresse de la cliente, résolue en fiche au moment d'écrire. */
  emailCliente: string | null;
  /** Exactement ce qui sera écrit dans `order`, la cliente en moins. */
  valeurs: NouvelleCommande;
  articles: (NouvelArticle & { par: Rattachement["par"] })[];
  /** Une expédition « success » à cette date, couvrant tous les articles. */
  expeditionLe: Date | null;
  remboursement: NouveauRemboursement | null;
  /** La phrase du journal de la commande. */
  evenement: string;
}

export interface EtatBase {
  fiches: readonly FicheExistante[];
  /** Les commandes déjà en base, par identifiant et par numéro Shopify. */
  legacyIds: ReadonlySet<number>;
  legacyNames: ReadonlySet<string>;
  /** Les numéros « SHOP-… » déjà pris. */
  numeros: ReadonlySet<string>;
  /** Les adresses désabonnées de la lettre, en minuscules : jamais réabonnées. */
  desabonnees: ReadonlySet<string>;
  catalogue: IndexCatalogue;
}

export interface Bilan {
  clientes: {
    lignes: number;
    creees: number;
    completees: number;
    inchangees: number;
    depuisCommandes: number;
    abonneesCreees: number;
    abonnementNonRepris: number;
    identifiantsPoses: number;
    adresses: number;
    ecartees: Ecart[];
  };
  commandes: {
    lignes: number;
    lues: number;
    aCreer: number;
    dejaPresentes: number;
    ecartees: Ecart[];
    doublons: string[];
    ventes: number;
    horsVentes: number;
    web: number;
    salon: number;
    chiffreAffairesCents: number;
    premiere: Date | null;
    derniere: Date | null;
    /** Payées mais non expédiées dans Shopify : marquées traitées quand même. */
    traiteesALaReprise: string[];
    sansCliente: number;
    autresDevises: string[];
    remboursements: number;
    correspondances: { shopify: string; repris: string; nombre: number }[];
  };
  articles: {
    lignes: number;
    parShopify: number;
    parSku: number;
    parTitre: number;
    nonRattaches: number;
    quantiteNulle: number;
    personnalises: number;
    titresNonRattaches: { titre: string; nombre: number }[];
  };
}

export interface Plan {
  clientes: PlanCliente[];
  commandes: PlanCommande[];
  bilan: Bilan;
}

/** « 12,50 € ». */
export function euros(cents: number): string {
  return (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

/** « 03/12/2025 », à Paris. */
export function dateFr(d: Date): string {
  return d.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
}

/** La phrase que le journal de la commande gardera. */
function evenementDe(lue: CommandeLue, statut: StatutRepris): string {
  const faits = [
    `paiement « ${lue.financier || "inconnu"} »`,
    `expédition « ${lue.expedition || "unfulfilled"} »`,
  ];
  if (lue.annuleLe) faits.push(`annulée le ${dateFr(lue.annuleLe)}`);
  if (lue.remboursementCents > 0) faits.push(`remboursée de ${euros(lue.remboursementCents)}`);
  if (lue.moyenPaiement) faits.push(`moyen de paiement « ${lue.moyenPaiement} »`);
  const suite = statut.vente
    ? "Comptée dans les ventes à sa date d'origine."
    : "Hors ventes : rangée aux archives.";
  const traitee =
    statut.vente && !EXPEDIEES.has(lue.expedition)
      ? " Marquée traitée à la reprise : Shopify ne la disait pas expédiée."
      : "";
  return `Reprise de l'ancienne boutique Shopify (${lue.nom ?? `n° ${lue.idShopify}`}) : ${faits.join(", ")}. ${suite}${traitee} Aucun courriel, aucune facture, aucune étiquette.`;
}

/**
 * Le plan complet, à partir de ce que disent les fichiers et de ce que la
 * base contient déjà.
 *
 * Une commande déjà en base — même identifiant Shopify, même numéro
 * « #1001 », ou même numéro repris — est sautée : l'import se rejoue sans
 * doublon, et ne modifie jamais ce qu'il a déjà écrit. Une commande sans date
 * lisible ou sans total lisible est écartée plutôt que rangée au hasard.
 */
export function planifier(
  lecture: { clientes: LectureClientes; commandes: LectureCommandes },
  etat: EtatBase,
  maintenant: Date,
): Plan {
  const bilan: Bilan = {
    clientes: {
      lignes: lecture.clientes.lignes,
      creees: 0,
      completees: 0,
      inchangees: 0,
      depuisCommandes: 0,
      abonneesCreees: 0,
      abonnementNonRepris: 0,
      identifiantsPoses: 0,
      adresses: 0,
      ecartees: [...lecture.clientes.ecartees],
    },
    commandes: {
      lignes: lecture.commandes.lignes,
      lues: lecture.commandes.commandes.length,
      aCreer: 0,
      dejaPresentes: 0,
      ecartees: [...lecture.commandes.ecartees],
      doublons: [...lecture.commandes.doublons],
      ventes: 0,
      horsVentes: 0,
      web: 0,
      salon: 0,
      chiffreAffairesCents: 0,
      premiere: null,
      derniere: null,
      traiteesALaReprise: [],
      sansCliente: 0,
      autresDevises: [],
      remboursements: 0,
      correspondances: [],
    },
    articles: {
      lignes: 0,
      parShopify: 0,
      parSku: 0,
      parTitre: 0,
      nonRattaches: 0,
      quantiteNulle: 0,
      personnalises: 0,
      titresNonRattaches: [],
    },
  };

  /* -- Les commandes ------------------------------------------------------ */

  const commandes: PlanCommande[] = [];
  /** Les numéros déjà donnés par ce plan, et à quelle commande. */
  const numerosDuPlan = new Map<string, string>();
  const idsPris = new Set(etat.legacyIds);
  const nomsPris = new Set(etat.legacyNames);
  const correspondances = new Map<string, { shopify: string; repris: string; nombre: number }>();
  const titresNonRattaches = new Map<string, number>();
  const premiereCommande = new Map<string, Date>();

  for (const lue of lecture.commandes.commandes) {
    const etiquetteCommande = lue.nom ?? `n° ${lue.idShopify ?? "?"}`;
    const ecarter = (raison: string) =>
      bilan.commandes.ecartees.push({
        fichier: lue.fichiers.join(", "),
        ligne: 0,
        raison: `${etiquetteCommande} : ${raison}`,
      });

    if (lue.email && lue.creeLe) {
      const d = premiereCommande.get(lue.email);
      if (!d || lue.creeLe < d) premiereCommande.set(lue.email, lue.creeLe);
    }

    if (
      (lue.idShopify !== null && idsPris.has(lue.idShopify)) ||
      (lue.nom !== null && nomsPris.has(lue.nom))
    ) {
      bilan.commandes.dejaPresentes++;
      continue;
    }
    const numero = numeroRepris(lue.nom, lue.idShopify);
    if (!numero) {
      ecarter("ni numéro ni identifiant lisible");
      continue;
    }
    if (etat.numeros.has(numero)) {
      // Déjà écrite sous ce numéro (sans son identifiant ?) : on ne double pas.
      bilan.commandes.dejaPresentes++;
      continue;
    }
    const memeNumero = numerosDuPlan.get(numero);
    if (memeNumero) {
      ecarter(`même numéro repris (${numero}) que ${memeNumero}`);
      continue;
    }
    if (!lue.creeLe) {
      ecarter("date de commande (« Created at ») illisible");
      continue;
    }
    if (lue.totalCents === null) {
      ecarter("montant total (« Total ») illisible");
      continue;
    }
    numerosDuPlan.set(numero, etiquetteCommande);
    if (lue.idShopify !== null) idsPris.add(lue.idShopify);
    if (lue.nom !== null) nomsPris.add(lue.nom);

    const statut = statutRepris({ ...lue, creeLe: lue.creeLe });
    const canal = canalRepris(lue.source);

    const articles: PlanCommande["articles"] = [];
    for (const a of lue.articles) {
      if (a.quantite <= 0) {
        bilan.articles.quantiteNulle++;
        continue;
      }
      const r = rattacher(a, etat.catalogue);
      const config: PosterConfig | null = a.proprietes
        ? legacyPropertiesToConfig(a.proprietes)
        : null;
      if (config) bilan.articles.personnalises++;
      bilan.articles.lignes++;
      if (r.par === "shopify") bilan.articles.parShopify++;
      else if (r.par === "sku") bilan.articles.parSku++;
      else if (r.par === "titre") bilan.articles.parTitre++;
      else {
        bilan.articles.nonRattaches++;
        titresNonRattaches.set(a.titre, (titresNonRattaches.get(a.titre) ?? 0) + 1);
      }
      articles.push({
        productId: r.productId,
        variantId: r.variantId,
        config,
        title: a.titre,
        unitPriceCents: a.prixCents,
        quantity: a.quantite,
        par: r.par,
      });
    }

    // Une commande sans article ne peut pas être « traitée » (rien à
    // expédier) : elle irait dans « Non traitées ». Elle part aux archives.
    const statutFinal: StatutRepris =
      articles.length > 0
        ? statut
        : { ...statut, expedier: false, archiver: true };

    const remboursementCents =
      lue.financier === "refunded" && lue.remboursementCents === 0
        ? lue.totalCents
        : Math.min(lue.remboursementCents, lue.totalCents);
    const remboursement: NouveauRemboursement | null =
      remboursementCents > 0
        ? {
            amountCents: remboursementCents,
            shippingCents: 0,
            reason: "Remboursée dans Shopify",
            note: "Montant repris de l'export Shopify, qui ne donne ni la date ni le détail du remboursement.",
            restock: false,
            gateway: "shopify",
            author: "Reprise Shopify",
            createdAt: lue.annuleLe ?? lue.expedieLe ?? lue.payeLe ?? lue.creeLe,
          }
        : null;

    const valeurs: NouvelleCommande = {
      channel: canal,
      number: numero,
      status: statutFinal.status,
      totalCents: lue.totalCents,
      shippingCents: Math.max(0, lue.portCents),
      promoCode: lue.codePromo,
      shippingLabel: lue.modeLivraison,
      shippingName: lue.livraison.nom,
      shippingLine1: lue.livraison.ligne1,
      shippingLine2: lue.livraison.ligne2,
      shippingPostalCode: lue.livraison.codePostal,
      shippingCity: lue.livraison.ville,
      shippingCountry: lue.livraison.pays,
      shippingPhone: lue.livraison.telephone,
      // Déjà vue : aucune pastille de « nouvelle commande », jamais.
      seenAt: maintenant,
      legacyId: lue.idShopify,
      legacyName: lue.nom,
      fulfilledAt: statutFinal.fulfilledAt,
      cancelledAt: statutFinal.cancelledAt,
      cancelReason: statutFinal.status === "cancelled" ? "Annulée dans Shopify" : null,
      internalNote: lue.note,
      tags: lue.etiquettes.length ? lue.etiquettes : null,
      createdAt: lue.creeLe,
      archivedAt: statutFinal.archiver ? maintenant : null,
    };

    commandes.push({
      lue,
      numero,
      statut: statutFinal,
      emailCliente: lue.email,
      valeurs,
      articles,
      expeditionLe: statutFinal.expedier ? statutFinal.fulfilledAt : null,
      remboursement,
      evenement: evenementDe(lue, statutFinal),
    });

    const b = bilan.commandes;
    b.aCreer++;
    if (statutFinal.vente) {
      b.ventes++;
      b.chiffreAffairesCents += lue.totalCents;
    } else b.horsVentes++;
    if (canal === "web") b.web++;
    else b.salon++;
    if (!b.premiere || lue.creeLe < b.premiere) b.premiere = lue.creeLe;
    if (!b.derniere || lue.creeLe > b.derniere) b.derniere = lue.creeLe;
    if (statutFinal.vente && !EXPEDIEES.has(lue.expedition)) b.traiteesALaReprise.push(etiquetteCommande);
    if (!lue.email) b.sansCliente++;
    if (lue.devise && lue.devise !== "EUR") b.autresDevises.push(`${etiquetteCommande} (${lue.devise})`);
    if (remboursement) b.remboursements++;
    const shopify = [
      lue.financier || "(vide)",
      lue.expedition || "unfulfilled",
      ...(lue.annuleLe ? ["annulée"] : []),
    ].join(" · ");
    const repris = [
      statutFinal.vente ? "vente" : "hors ventes, aux archives",
      ...(statutFinal.expedier ? ["traitée"] : []),
    ].join(", ");
    const cle = `${shopify} → ${repris}`;
    const ligne = correspondances.get(cle) ?? { shopify, repris, nombre: 0 };
    ligne.nombre++;
    correspondances.set(cle, ligne);
  }
  bilan.commandes.correspondances = [...correspondances.values()].sort(
    (a, b) => b.nombre - a.nombre || a.shopify.localeCompare(b.shopify),
  );
  bilan.articles.titresNonRattaches = [...titresNonRattaches.entries()]
    .map(([titre, nombre]) => ({ titre, nombre }))
    .sort((a, b) => b.nombre - a.nombre || a.titre.localeCompare(b.titre));

  /* -- Les clientes ------------------------------------------------------- */

  const fiches = choisirFiches(etat.fiches);
  const duFichier = lecture.clientes.clientes;
  const emailsDuFichier = new Set(duFichier.map((c) => c.email));
  const desCommandes = clientesDesCommandes(lecture.commandes.commandes, emailsDuFichier);
  bilan.clientes.depuisCommandes = desCommandes.length;

  const clientes: PlanCliente[] = [];
  for (const c of [...duFichier, ...desCommandes]) {
    const p = planCliente(
      c,
      fiches.get(c.email),
      maintenant,
      premiereCommande.get(c.email) ?? null,
      etat.desabonnees.has(c.email),
    );
    clientes.push(p);
    const b = bilan.clientes;
    if (p.action === "creation") b.creees++;
    else if (p.action === "mise-a-jour") b.completees++;
    else b.inchangees++;
    if (p.abonneeCreee) b.abonneesCreees++;
    if (p.abonnementNonRepris) b.abonnementNonRepris++;
    if (p.identifiantPose) b.identifiantsPoses++;
    if (p.adresse) b.adresses++;
  }

  return { clientes, commandes, bilan };
}
