/**
 * Relance des paniers abandonnés — la mécanique de Shopify, à l'identique.
 *
 * Un panier n'est PAS une table à part dans ce schéma : c'est une commande
 * `order` qui n'a pas encore été payée. Tant qu'elle est en `draft`, personne
 * ne sait à qui elle appartient ; c'est le passage au tunnel (POST /orders)
 * qui y attache un client, donc une adresse e-mail. C'est exactement la règle
 * de Shopify, qui ne classe « abandonné » qu'un CHECKOUT abandonné, jamais un
 * panier anonyme : sans adresse, il n'y a personne à relancer.
 *
 * Trois critères stricts font l'abandon (voir `paniersAbandonnes`) :
 *   1. une adresse e-mail joignable ;
 *   2. le tunnel n'a pas abouti (ni payée, ni annulée, ni remboursée) ;
 *   3. plus rien n'a bougé depuis le délai plancher (10 min par défaut).
 *
 * Deux horloges, et il ne faut jamais les confondre. Celle de L'AFFICHAGE :
 * dès le délai plancher, le panier apparaît au back-office. Celle de L'ENVOI :
 * le programme réglé par la marchande — une 1re relance (10 h par défaut),
 * puis, si elle le veut, une 2e et une 3e, chacune à son délai, et au besoin
 * dans une plage horaire. Un panier peut donc être visible longtemps avant
 * qu'un courrier ne parte.
 *
 * Les mots du courrier se réécrivent au back-office (voir `TextesRelance`
 * dans mail.ts), dans chacune des cinq langues : chaque cliente reçoit le
 * texte de SA langue. Tant qu'on n'y a pas touché, la 1re relance part avec
 * le courrier d'origine, à l'identique.
 *
 * Et une limite qui ne se discute pas : passé QUATORZE JOURS, plus aucun
 * envoi. Shopify purge à ce terme, et un rappel qui arrive deux semaines plus
 * tard ne rend service à personne — il rappelle surtout qu'on garde des
 * traces.
 */
import { randomBytes } from "node:crypto";
import type { Hono } from "hono";
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  like,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { db, schema } from "./db/client.js";
import { apercuDeLaLigne, apercuDejaPret, cheminApercu } from "./apercus.js";
import {
  adressePublique,
  courrierPanierAbandonne,
  envoyer,
  estConfigure as courrierConfigure,
  memesTextesRelance,
  normaliserTextesRelance,
  TEXTES_RELANCE_DEFAUT,
  textesRelanceParDefaut,
  VARIABLES_RELANCE,
  type EtapeRelance,
  type LigneCourrier,
  type TextesRelance,
} from "./mail.js";
import {
  langueDuDestinataire,
  langueLue,
  LANGUES_COURRIEL,
  tc,
  type Langue,
} from "./courriels/index.js";
import {
  EchecTraduction,
  nomTraduit,
  proposerTraduction,
  traductionDisponible,
  type LangueEtrangere,
} from "./traductions.js";

/* -------------------------------------------------------------------------- */
/*  Constantes de la mécanique                                                */
/* -------------------------------------------------------------------------- */

/**
 * L'adresse publique du site. Le repli sur localhost:8080 est celui de la
 * lettre d'information : un lien de courrier ne peut pas être relatif, et un
 * lien absent est pire qu'un lien de développement.
 */
const ORIGINE =
  (process.env.PUBLIC_ORIGIN ?? "").replace(/\/+$/, "") || "http://localhost:8080";

/** La page publique qui remet le panier dans le navigateur. */
const LIEN_RECUPERATION = `${ORIGINE}/panier/recuperer`;

/**
 * La page de désinscription. Elle passe par « /api » : le proxy y envoie
 * l'API, qui la sert elle-même — la boutique n'a pas à connaître ce chemin.
 */
const LIEN_DESINSCRIPTION = `${ORIGINE}/api/relance/desabonnement`;

/**
 * Les délais proposés pour la 1re relance, en heures d'inactivité. Les quatre
 * de Shopify (1, 6, 10, 24 h), et quelques intermédiaires : la boutique
 * programme seule son rythme, elle n'a pas à se plier à celui d'un autre.
 */
export const PALIERS_ENVOI = [1, 2, 3, 6, 10, 12, 24, 48] as const;
export type PalierEnvoi = (typeof PALIERS_ENVOI)[number];

/**
 * Les délais proposés pour la 2e et la 3e relance, en heures APRÈS L'ABANDON
 * — la même horloge que la 1re, pour qu'une seule phrase suffise à les
 * expliquer toutes. De un jour à treize : la fenêtre de quatorze jours ferme
 * de toute façon la porte au-delà.
 */
export const PALIERS_SUIVANTS = [24, 48, 72, 96, 120, 168, 240, 312] as const;

/** Trois relances au plus pour un même panier. Au-delà, c'est du harcèlement. */
export const ETAPES: readonly EtapeRelance[] = [1, 2, 3];

/**
 * Le délai plancher d'affichage, en minutes. Shopify n'attend jamais moins de
 * dix minutes ni plus de quinze : en deçà, on déclare abandonné un client qui
 * remplit encore son adresse.
 */
const PLANCHER_MIN = 10;
const PLANCHER_MAX = 15;

/** Quatorze jours. Au-delà, plus aucune relance, jamais. */
export const FENETRE_HEURES = 336;

/**
 * Les statuts qui ferment définitivement la question : la commande a abouti,
 * ou elle est morte. « voided » vient de l'historique importé, il compte comme
 * une annulation.
 */
const STATUTS_CLOS: string[] = ["paid", "cancelled", "refunded", "voided"];

/** Toutes les cinq minutes. Assez fin pour un palier d'une heure. */
const PERIODE_PASSAGE_MS = 5 * 60_000;

/**
 * Le délai en deçà duquel une relance manuelle ne repart pas : de quoi
 * absorber un double clic ou une page rechargée, pas de quoi gêner une
 * boutique qui veut vraiment relancer.
 */
const ANTI_DOUBLON_MS = 10 * 60_000;

/* -------------------------------------------------------------------------- */
/*  Les réglages, tenus dans le back-office                                   */
/* -------------------------------------------------------------------------- */

/**
 * Ce que la marchande règle elle-même. Rien de tout cela ne se décide dans le
 * code : c'est sa boutique, son rythme, et sa responsabilité juridique.
 */
export interface ReglagesRelance {
  /** Le travailleur envoie-t-il tout seul ? Faux = relance manuelle seulement. */
  active: boolean;
  /** Le palier d'envoi, en heures d'inactivité. */
  palierHeures: PalierEnvoi;
  /** Le délai plancher d'affichage, en minutes (10 à 15). */
  plancherMinutes: number;
  /**
   * La base légale de l'envoi.
   *
   * « consentement » : on n'écrit qu'aux gens qui ont coché la case marketing.
   * « interet_legitime » : on écrit à qui a laissé une commande en cours, ce
   * que le RGPD autorise pour une relance liée à un achat entamé — mais le
   * lien de désinscription devient alors OBLIGATOIRE dans le courrier.
   */
  baseLegale: "consentement" | "interet_legitime";
  /**
   * La 2e relance, en heures après l'abandon. Null : il n'y en a pas — c'est
   * le réglage d'origine, une seule relance.
   */
  relance2Heures: number | null;
  /** La 3e, de même. Elle suppose une 2e, et vient forcément après elle. */
  relance3Heures: number | null;
  /**
   * La plage horaire des envois automatiques, heure de Paris : on n'écrit
   * qu'entre `debut` heures et `fin` heures. Null : à toute heure, comme
   * avant que ce réglage n'existe.
   *
   * Une relance qui tombe la nuit attend le matin ; le bouton « Relancer »,
   * lui, n'attend pas — c'est la boutique qui choisit son moment.
   */
  plage: { debut: number; fin: number } | null;
}

const REGLAGES_DEFAUT: ReglagesRelance = {
  active: false,
  palierHeures: 10,
  plancherMinutes: 10,
  baseLegale: "consentement",
  relance2Heures: null,
  relance3Heures: null,
  plage: null,
};

/**
 * Les clés dans la table `setting`. Le préfixe « relance. » les regroupe et
 * les tient hors du `/settings` public : ces réglages sont ceux de la
 * boutique, la vitrine n'a rien à en savoir.
 */
const CLES = {
  active: "relance.active",
  palier: "relance.palier_heures",
  plancher: "relance.plancher_minutes",
  baseLegale: "relance.base_legale",
  relance2: "relance.relance2_heures",
  relance3: "relance.relance3_heures",
  plage: "relance.plage_horaire",
} as const;

/**
 * La clé des textes réécrits d'une relance, dans une langue. ABSENTE tant que
 * la boutique n'y a pas touché : c'est cette absence, et rien d'autre, qui
 * garantit le courrier d'origine. « Revenir au texte d'origine » efface donc
 * la clé.
 *
 * Le français garde la clé d'avant les langues, « relance.courrier_1 » : les
 * textes déjà réécrits par la boutique restent les siens, sans rien migrer.
 * Les autres langues ont la leur, « relance.courrier_1.en »…
 */
function cleTextes(etape: EtapeRelance, langue: Langue = "fr"): string {
  return langue === "fr" ? `relance.courrier_${etape}` : `relance.courrier_${etape}.${langue}`;
}

/** Le début commun de toutes ces clés, pour les lire d'un coup. */
const PREFIXE_TEXTES = "relance.courrier_";

/** Le nom d'une langue dans une phrase du back-office : « en anglais ». */
export const LANGUE_EN_FRANCAIS: Record<Langue, string> = {
  fr: "français",
  en: "anglais",
  de: "allemand",
  it: "italien",
  es: "espagnol",
};

/**
 * La langue des textes demandée par l'écran. Absente : le français, comme
 * avant les langues. Inconnue : null, et la route refuse — un texte anglais
 * rangé par erreur sous la clé française partirait chez toutes les clientes
 * francophones.
 */
export function langueDemandee(v: unknown): Langue | null {
  if (v === undefined || v === null || v === "") return "fr";
  return langueLue(v);
}

export const LANGUE_INCONNUE =
  "Cette langue n'existe pas sur le site : français, anglais, allemand, italien ou espagnol.";

/** Le groupe sous lequel le back-office range ces réglages. */
const GROUPE = "relance";

/**
 * Un réglage refusé, avec la phrase à montrer. Distinct d'une panne : la
 * route le rend en 400, et l'écran l'affiche tel quel.
 */
export class ReglageRefuse extends Error {}

function nombreOuDefaut(v: unknown, defaut: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : defaut;
}

/** Ramène un palier saisi n'importe comment à l'un de ceux proposés. */
function palierValide(v: unknown): PalierEnvoi {
  const n = nombreOuDefaut(v, REGLAGES_DEFAUT.palierHeures);
  return (PALIERS_ENVOI as readonly number[]).includes(n)
    ? (n as PalierEnvoi)
    : REGLAGES_DEFAUT.palierHeures;
}

/** Borne le plancher entre dix et quinze minutes. */
function plancherValide(v: unknown): number {
  const n = Math.round(nombreOuDefaut(v, REGLAGES_DEFAUT.plancherMinutes));
  return Math.min(PLANCHER_MAX, Math.max(PLANCHER_MIN, n));
}

/**
 * Le délai d'une relance suivante, ou null pour « pas de relance ». Une
 * valeur hors de la liste se lit comme « pas de relance » : mieux vaut un
 * courrier de moins qu'un courrier à une heure que personne n'a choisie.
 */
function suivanteValide(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === 0 || v === "0") return null;
  const n = Number(v);
  return (PALIERS_SUIVANTS as readonly number[]).includes(n) ? n : null;
}

/** Une plage horaire lisible, ou null. Début avant fin, dans la journée. */
function plageValide(v: unknown): { debut: number; fin: number } | null {
  if (!v || typeof v !== "object") return null;
  const { debut, fin } = v as Record<string, unknown>;
  const d = Number(debut);
  const f = Number(fin);
  if (!Number.isInteger(d) || !Number.isInteger(f)) return null;
  if (d < 0 || d > 23 || f < 1 || f > 24 || d >= f) return null;
  return { debut: d, fin: f };
}

/**
 * Les réglages tels qu'ils sont enregistrés, complétés par les valeurs par
 * défaut. Une clé absente n'est pas une panne : c'est une boutique qui n'a pas
 * encore touché à ce réglage.
 */
export async function lireReglages(): Promise<ReglagesRelance> {
  const lignes = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.group, GROUPE));
  const valeurs = new Map(lignes.map((l) => [l.key, l.value]));
  const relance2Heures = suivanteValide(valeurs.get(CLES.relance2));
  const relance3 = suivanteValide(valeurs.get(CLES.relance3));
  return {
    active: valeurs.get(CLES.active) === true,
    palierHeures: palierValide(valeurs.get(CLES.palier)),
    plancherMinutes: plancherValide(valeurs.get(CLES.plancher)),
    baseLegale:
      valeurs.get(CLES.baseLegale) === "interet_legitime"
        ? "interet_legitime"
        : "consentement",
    relance2Heures,
    // Une 3e sans 2e ne se lit pas : l'écriture le refuse, et la lecture ne
    // fait pas confiance à une base qu'on aurait modifiée à la main.
    relance3Heures:
      relance2Heures !== null && relance3 !== null && relance3 > relance2Heures
        ? relance3
        : null,
    plage: plageValide(valeurs.get(CLES.plage)),
  };
}

/** Écrit une ligne de réglage, créée au besoin. */
async function ecrireUnReglage(key: string, value: unknown, label: string): Promise<void> {
  await db
    .insert(schema.settings)
    .values({
      key,
      value: value as never,
      label,
      group: GROUPE,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: {
        value: value as never,
        label,
        group: GROUPE,
        updatedAt: new Date(),
      },
    });
}

/**
 * Enregistre les réglages, en les bornant à ce qui a un sens.
 *
 * Le rythme des relances, lui, ne se borne pas en silence : une 2e relance
 * programmée AVANT la 1re ne peut pas être « corrigée » sans deviner ce que
 * la boutique voulait. On refuse, avec la phrase qui dit quoi changer.
 */
async function ecrireReglages(brut: Record<string, unknown>): Promise<ReglagesRelance> {
  const actuels = await lireReglages();
  const suivants: ReglagesRelance = {
    active:
      brut.active === undefined ? actuels.active : Boolean(brut.active),
    palierHeures:
      brut.palierHeures === undefined
        ? actuels.palierHeures
        : palierValide(brut.palierHeures),
    plancherMinutes:
      brut.plancherMinutes === undefined
        ? actuels.plancherMinutes
        : plancherValide(brut.plancherMinutes),
    baseLegale:
      brut.baseLegale === "interet_legitime"
        ? "interet_legitime"
        : brut.baseLegale === "consentement"
          ? "consentement"
          : actuels.baseLegale,
    relance2Heures:
      brut.relance2Heures === undefined
        ? actuels.relance2Heures
        : suivanteValide(brut.relance2Heures),
    relance3Heures:
      brut.relance3Heures === undefined
        ? actuels.relance3Heures
        : suivanteValide(brut.relance3Heures),
    plage: brut.plage === undefined ? actuels.plage : plageValide(brut.plage),
  };

  if (suivants.relance3Heures !== null && suivants.relance2Heures === null)
    throw new ReglageRefuse(
      "La 3e relance suppose une 2e : programmez d'abord la 2e, ou retirez la 3e.",
    );
  if (suivants.relance2Heures !== null && suivants.relance2Heures <= suivants.palierHeures)
    throw new ReglageRefuse(
      `La 2e relance doit partir après la 1re : ${duree(suivants.relance2Heures)} après l'abandon, c'est avant (ou en même temps que) la 1re, prévue ${duree(suivants.palierHeures)} après.`,
    );
  if (
    suivants.relance3Heures !== null &&
    suivants.relance2Heures !== null &&
    suivants.relance3Heures <= suivants.relance2Heures
  )
    throw new ReglageRefuse(
      `La 3e relance doit partir après la 2e : choisissez un délai de plus de ${duree(suivants.relance2Heures)}.`,
    );
  if (brut.plage !== undefined && brut.plage !== null && suivants.plage === null)
    throw new ReglageRefuse(
      "La plage d'envoi doit commencer avant de finir : par exemple de 9 h à 20 h.",
    );

  await ecrireUnReglage(CLES.active, suivants.active, "Relance automatique");
  await ecrireUnReglage(CLES.palier, suivants.palierHeures, "1re relance (heures après l'abandon)");
  await ecrireUnReglage(CLES.plancher, suivants.plancherMinutes, "Délai d'affichage (minutes)");
  await ecrireUnReglage(CLES.baseLegale, suivants.baseLegale, "Base légale");
  await ecrireUnReglage(CLES.relance2, suivants.relance2Heures ?? 0, "2e relance (heures après l'abandon, 0 = aucune)");
  await ecrireUnReglage(CLES.relance3, suivants.relance3Heures ?? 0, "3e relance (heures après l'abandon, 0 = aucune)");
  // `false` et non `null` : la colonne refuse le vide, et « pas de plage » est
  // une réponse, pas une absence de réponse.
  await ecrireUnReglage(CLES.plage, suivants.plage ?? false, "Plage d'envoi (heure de Paris)");
  return suivants;
}

/** « 10 h », « 2 jours » — un délai tel qu'on le dit. */
export function duree(heures: number): string {
  if (heures < 24 || heures % 24 !== 0) return `${heures} h`;
  const jours = heures / 24;
  return jours === 1 ? "1 jour" : `${jours} jours`;
}

/**
 * Les délais de toutes les relances programmées, dans l'ordre, en heures
 * après l'abandon : [10], [10, 48], [10, 48, 120]…
 */
export function delaisDesRelances(r: ReglagesRelance): number[] {
  const delais: number[] = [r.palierHeures];
  if (r.relance2Heures !== null) {
    delais.push(r.relance2Heures);
    if (r.relance3Heures !== null) delais.push(r.relance3Heures);
  }
  return delais;
}

/* -------------------------------------------------------------------------- */
/*  La plage horaire                                                          */
/* -------------------------------------------------------------------------- */

/**
 * L'heure qu'il est à Paris à cet instant, de 0 à 23.
 *
 * On lit la PIÈCE « heure » du formatage, pas la chaîne entière : en
 * français, une heure seule s'écrit « 08 h », que `Number` ne sait pas lire.
 * La première version s'y était trompée et retombait en silence sur l'heure
 * universelle — deux heures d'écart l'été, une l'hiver.
 */
const HEURE_DE_PARIS = new Intl.DateTimeFormat("fr-FR", {
  hour: "numeric",
  hourCycle: "h23",
  timeZone: "Europe/Paris",
});
function heureDeParis(date: Date): number {
  const piece = HEURE_DE_PARIS.formatToParts(date).find((p) => p.type === "hour");
  const h = Number(piece?.value);
  return Number.isInteger(h) ? h % 24 : date.getUTCHours();
}

/** Cet instant tombe-t-il dans la plage d'envoi ? Sans plage, toujours. */
export function dansLaPlage(r: ReglagesRelance, date: Date): boolean {
  if (!r.plage) return true;
  const h = heureDeParis(date);
  return h >= r.plage.debut && h < r.plage.fin;
}

/**
 * Le premier instant, à partir de `date`, où un envoi est permis.
 *
 * On avance d'heure pleine en heure pleine : le décalage de Paris sur l'heure
 * universelle se compte en heures entières, été comme hiver, donc une heure
 * pleine en UTC en est une à Paris. Deux jours de recherche suffisent
 * largement à une plage d'au moins une heure par jour.
 */
function prochaineOuverture(r: ReglagesRelance, date: Date): Date {
  if (dansLaPlage(r, date)) return date;
  const t = new Date(date);
  t.setUTCMinutes(0, 0, 0);
  for (let i = 0; i < 48; i++) {
    t.setTime(t.getTime() + 3600_000);
    if (dansLaPlage(r, t)) return new Date(t);
  }
  return date;
}

/* -------------------------------------------------------------------------- */
/*  Les textes des courriers                                                  */
/* -------------------------------------------------------------------------- */

/** « 1re », « 2e », « 3e ». */
export function ordinal(etape: number): string {
  return etape === 1 ? "1re" : `${etape}e`;
}

/** Lit une étape venue d'une adresse ou d'un formulaire. */
export function etapeLue(v: unknown): EtapeRelance | null {
  const n = Number(v);
  return n === 1 || n === 2 || n === 3 ? n : null;
}

/**
 * Les textes que la boutique a réécrits pour cette relance dans cette langue,
 * ou null si elle n'y a pas touché. Une valeur illisible en base vaut « pas
 * touché » : mieux vaut le courrier d'origine qu'un courrier cassé.
 */
async function textesEnregistres(
  etape: EtapeRelance,
  langue: Langue = "fr",
): Promise<TextesRelance | null> {
  const [ligne] = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, cleTextes(etape, langue)))
    .limit(1);
  if (!ligne) return null;
  const n = normaliserTextesRelance(ligne.value);
  return n.ok ? n.textes : null;
}

/**
 * Pour chaque relance, les langues dans lesquelles la boutique a écrit son
 * propre texte. Une seule lecture pour les quinze clés possibles : les écrans
 * qui le montrent (les onglets de langue, le programme des relances) le
 * demandent d'un coup.
 */
async function languesPersonnalisees(): Promise<Record<EtapeRelance, Langue[]>> {
  const lignes = await db
    .select({ key: schema.settings.key, value: schema.settings.value })
    .from(schema.settings)
    // « _ » est un joker de LIKE : échappé, il ne vaut que lui-même.
    .where(like(schema.settings.key, `${PREFIXE_TEXTES.replace("_", "\\_")}%`));
  const lisibles = new Set(
    lignes.filter((l) => normaliserTextesRelance(l.value).ok).map((l) => l.key),
  );
  const parEtape = (etape: EtapeRelance) =>
    LANGUES_COURRIEL.filter((langue) => lisibles.has(cleTextes(etape, langue)));
  return { 1: parEtape(1), 2: parEtape(2), 3: parEtape(3) };
}

/** Les textes d'origine d'une relance dans une langue. */
function textesDOrigine(etape: EtapeRelance, langue: Langue): TextesRelance {
  return langue === "fr" ? TEXTES_RELANCE_DEFAUT[etape] : textesRelanceParDefaut(langue)[etape];
}

/**
 * Les textes avec lesquels part la relance de cette étape, dans la langue de
 * la cliente.
 *
 * Chaque langue a les siens : le texte que la boutique a écrit dans CETTE
 * langue s'il existe, sinon le texte d'origine de cette langue. Jamais le
 * texte d'une autre langue — le français réécrit ne part pas chez une cliente
 * anglaise : un courrier dont les phrases seraient en français et les boutons
 * en anglais ne servirait personne.
 *
 * Null pour une 1re relance que la boutique n'a pas réécrite dans cette
 * langue : c'est le signal qui fait partir le courrier d'origine, à l'octet
 * près (voir `courrierPanierAbandonne`). Les 2e et 3e n'ont pas d'« avant » à
 * préserver : elles partent avec leurs textes par défaut.
 *
 * Lu à CHAQUE envoi, jamais gardé en mémoire : un texte corrigé au
 * back-office vaut pour le courrier suivant, sans redémarrer quoi que ce soit.
 */
export async function textesDeLaRelance(
  etape: EtapeRelance,
  langue: Langue = "fr",
): Promise<TextesRelance | null> {
  const propres = await textesEnregistres(etape, langue);
  if (propres) return propres;
  return etape === 1 ? null : textesDOrigine(etape, langue);
}

/**
 * Enregistre les textes d'une relance dans une langue.
 *
 * Des textes identiques à ceux d'origine de CETTE langue EFFACENT la clé au
 * lieu de l'écrire : la boutique qui enregistre sans rien changer doit garder
 * le courrier d'origine, et non une copie qui lui ressemble.
 */
async function enregistrerTextes(
  etape: EtapeRelance,
  brut: unknown,
  langue: Langue = "fr",
): Promise<{ textes: TextesRelance; personnalise: boolean }> {
  const n = normaliserTextesRelance(brut);
  if (!n.ok) throw new ReglageRefuse(n.erreur);
  const origine = textesDOrigine(etape, langue);
  if (memesTextesRelance(n.textes, origine)) {
    await revenirAuTexteDOrigine(etape, langue);
    return { textes: origine, personnalise: false };
  }
  await ecrireUnReglage(
    cleTextes(etape, langue),
    n.textes,
    `Courrier de la ${ordinal(etape)} relance (${LANGUE_EN_FRANCAIS[langue]})`,
  );
  return { textes: n.textes, personnalise: true };
}

/**
 * « Revenir au texte d'origine », dans une langue : sa clé disparaît, et avec
 * elle ses textes. Les autres langues gardent les leurs.
 */
async function revenirAuTexteDOrigine(etape: EtapeRelance, langue: Langue = "fr"): Promise<void> {
  await db.delete(schema.settings).where(eq(schema.settings.key, cleTextes(etape, langue)));
}

/* --- La traduction proposée ------------------------------------------------- */

/**
 * Ce que le traducteur doit savoir de CE texte, en plus des règles générales
 * de `proposerTraduction`. Les variables d'abord : une « {prenom} » traduite
 * en « {nome} » serait refusée à l'enregistrement — ou, pire, partirait entre
 * ses accolades. Puis le ton de chaque langue, celui du site : l'italien et
 * l'espagnol y tutoient, l'allemand y vouvoie, l'anglais est britannique.
 */
const PRECISIONS_TRADUCTION_RELANCE = `This is the e-mail that reminds a customer of the basket she left on the website without ordering (abandoned basket reminder).
Keys: "objet" is the e-mail subject, "accroche" the greeting line at the top, "message" the text above the basket, "bouton" the label of the button that reopens the basket (60 characters at most), "conclusion" the small text under the button.
- Words between curly braces ({prenom}, {articles}, {montant}, {lien}) are variables filled in when the e-mail is sent: copy each of them exactly, untranslated, braces included, and never add a new one.
- Keep the **double asterisks** around the words they surround (they mark bold), and keep line breaks and blank lines where they are.
- "objet", "accroche" and "bouton" stay on a single line.`;

const TON_TRADUCTION_RELANCE: Record<LangueEtrangere, string> = {
  en: '- Write British English, as the website does: "basket" (never "cart"), "colour", "personalise".',
  de: '- Address the customer with the polite "Sie", as the website does.',
  it: '- Address the customer informally with "tu", as the website does (never "Lei").',
  es: '- Address the customer informally with "tú", as the website does (never "usted").',
};

/** Les {variables} d'un texte, dans l'ordre, pour comparer deux versions. */
function variablesDe(texte: string): string {
  return [...texte.matchAll(/\{([^{}\n]{1,30})\}/g)]
    .map((m) => m[1]!)
    .sort()
    .join(",");
}

/**
 * Propose la traduction des textes FRANÇAIS d'une relance — ceux qui partent
 * aujourd'hui aux clientes francophones, réécrits ou d'origine — dans une
 * autre langue. RIEN n'est enregistré : l'écran pose la proposition dans les
 * champs, la boutique la relit, puis l'enregistre elle-même.
 *
 * La proposition est vérifiée avant d'être rendue : une variable perdue ou
 * inventée en route, un champ resté vide, sont dits dans un avertissement —
 * la boutique les verra avant que l'enregistrement ne les refuse.
 */
async function proposerTraductionRelance(
  etape: EtapeRelance,
  langue: LangueEtrangere,
): Promise<{ textes: Partial<TextesRelance>; avertissement: string | null }> {
  const francais = (await textesEnregistres(etape, "fr")) ?? TEXTES_RELANCE_DEFAUT[etape];
  const champs: Record<string, string> = { ...francais };
  const traduits = await proposerTraduction(
    champs,
    langue,
    `${PRECISIONS_TRADUCTION_RELANCE}\n${TON_TRADUCTION_RELANCE[langue]}`,
  );

  const textes: Partial<TextesRelance> = {};
  const soucis: string[] = [];
  for (const champ of Object.keys(francais) as (keyof TextesRelance)[]) {
    const source = francais[champ];
    const propose = traduits[champ]?.trim() ?? "";
    if (!source.trim()) {
      // Vide en français, vide dans la traduction : rien à proposer de plus.
      textes[champ] = "";
      continue;
    }
    if (!propose) {
      soucis.push(`${NOMS_CHAMPS[champ]} n'a pas été traduit`);
      continue;
    }
    textes[champ] = propose;
    if (variablesDe(propose) !== variablesDe(source))
      soucis.push(`${NOMS_CHAMPS[champ]} n'a plus les mêmes variables qu'en français`);
  }
  return {
    textes,
    avertissement: soucis.length
      ? `À vérifier : ${soucis.join(" ; ")}. Les variables s'écrivent comme en français, entre accolades : ${VARIABLES_RELANCE.map((v) => `{${v.nom}}`).join(", ")}.`
      : null,
  };
}

/** Les champs, tels que l'écran les nomme. */
const NOMS_CHAMPS: Record<keyof TextesRelance, string> = {
  objet: "l'objet",
  accroche: "l'accroche",
  message: "le message",
  bouton: "le libellé du bouton",
  conclusion: "le mot de la fin",
};

/* -------------------------------------------------------------------------- */
/*  Le classement « abandonné » — les trois critères stricts                   */
/* -------------------------------------------------------------------------- */

/** Un panier abandonné, tel que le back-office et le travailleur le voient. */
export interface PanierAbandonne {
  id: number;
  number: string;
  clientOrderId: string | null;
  totalCents: number;
  promoCode: string | null;
  createdAt: Date;
  /** L'horloge d'inactivité : `lastActivityAt`, ou `createdAt` à défaut. */
  derniereActivite: Date;
  relanceAt: Date | null;
  /** Le compteur tel qu'il est en base, pour la réservation de l'envoi. */
  relancesEnregistrees: number;
  recupereLe: Date | null;
  motifRenoncement: string | null;
  renoncementLe: Date | null;
  recoveryToken: string | null;
  customerId: number | null;
  nom: string | null;
  email: string;
  accepteMarketing: boolean;
  /** La langue choisie sur le compte, et celle de la page du panier. */
  langueCompte: string | null;
  langueCommande: string | null;
}

/** La langue dans laquelle écrire à la personne qui a laissé ce panier. */
function langueDuPanier(p: PanierAbandonne): Langue {
  return langueDuDestinataire({ compte: p.langueCompte, commande: p.langueCommande });
}

/**
 * L'horloge d'inactivité, en SQL.
 *
 * `lastActivityAt` est nulle pour tous les paniers créés avant qu'on la tienne
 * à jour : on retombe alors sur la date de création, qui les rend simplement
 * plus vieux qu'ils ne sont — jamais plus jeunes. C'est le bon sens de l'erreur.
 */
const HORLOGE = sql<Date>`coalesce(${schema.orders.lastActivityAt}, ${schema.orders.createdAt})`;

/**
 * « ce panier ne bouge plus depuis avant telle heure », en SQL.
 *
 * La date part en TEXTE puis se fait convertir par Postgres, avec le fuseau
 * écrit dedans. Dans un fragment SQL brut, le pilote ne sait pas quelle
 * colonne on compare, donc pas comment sérialiser un objet Date : il refuse et
 * la requête tombe en erreur. L'ISO 8601 lève l'ambiguïté sans rien perdre.
 */
function immobileDepuis(seuil: Date) {
  return sql`${HORLOGE} < ${seuil.toISOString()}::timestamptz`;
}

/**
 * Les paniers abandonnés, du plus récent au plus ancien.
 *
 * Les trois critères stricts, et rien d'autre :
 *
 *   1. **Une adresse joignable.** La commande porte un client, et ce client a
 *      un e-mail. C'est le tunnel qui l'attache : un panier resté en `draft`
 *      n'en a pas, et n'apparaît donc pas — comme chez Shopify, où seul un
 *      checkout entamé peut être abandonné.
 *   2. **Le tunnel n'a pas abouti.** Ni payée, ni annulée, ni remboursée. On
 *      écarte aussi le stand : une commande y est prise en présence du client,
 *      il n'y a rien à relancer. Et une commande dont un paiement est arrivé
 *      sans pouvoir la valider — son montant ne correspondait plus au panier
 *      (markOrderPaid, configurator-routes.ts) — n'est pas abandonnée non
 *      plus : la cliente a payé, c'est à la boutique de régulariser, et lui
 *      écrire que son panier l'attend l'inviterait à payer une seconde fois.
 *   3. **Plus rien ne bouge depuis le délai plancher.**
 */
export async function paniersAbandonnes(
  plancherMinutes: number,
  limite = 200,
): Promise<PanierAbandonne[]> {
  return requetePaniers(plancherMinutes, limite, null);
}

/**
 * UN panier abandonné, désigné par son identifiant, ou `null` s'il n'en est
 * pas (ou plus) un.
 *
 * Aucun délai plancher : la relance manuelle doit pouvoir partir tout de
 * suite, puisque la liste vient précisément de montrer ce panier-là. Les trois
 * autres critères, eux, tiennent toujours.
 */
async function panierAbandonne(orderId: number): Promise<PanierAbandonne | null> {
  const [p] = await requetePaniers(0, 1, orderId);
  return p ?? null;
}

/** La requête commune aux deux, pour n'avoir qu'une définition de l'abandon. */
async function requetePaniers(
  plancherMinutes: number,
  limite: number,
  orderId: number | null,
): Promise<PanierAbandonne[]> {
  const seuil = new Date(Date.now() - plancherMinutes * 60_000);
  const lignes = await db
    .select({
      id: schema.orders.id,
      number: schema.orders.number,
      clientOrderId: schema.orders.clientOrderId,
      totalCents: schema.orders.totalCents,
      promoCode: schema.orders.promoCode,
      createdAt: schema.orders.createdAt,
      lastActivityAt: schema.orders.lastActivityAt,
      relanceAt: schema.orders.reminderSentAt,
      relancesEnregistrees: schema.orders.reminderCount,
      recupereLe: schema.orders.recoveredAt,
      motifRenoncement: schema.orders.recoveryDeclinedReason,
      renoncementLe: schema.orders.recoveryDeclinedAt,
      recoveryToken: schema.orders.recoveryToken,
      customerId: schema.orders.customerId,
      nom: schema.customers.name,
      email: schema.customers.email,
      accepteMarketing: schema.customers.acceptsMarketing,
      langueCompte: schema.customers.langue,
      langueCommande: schema.orders.langue,
    })
    .from(schema.orders)
    .innerJoin(schema.customers, eq(schema.orders.customerId, schema.customers.id))
    .where(
      and(
        eq(schema.orders.channel, "web"),
        notInArray(schema.orders.status, STATUTS_CLOS),
        // Un panier ARCHIVÉ n'est plus un panier à relancer : la boutique l'a
        // rangé, et lui écrire « vous avez oublié quelque chose » serait le
        // contraire de ce qu'elle vient de demander. Il quitte donc aussi la
        // liste des paniers abandonnés, comme il quitte celle des commandes.
        isNull(schema.orders.archivedAt),
        sql`not exists (select 1 from ${schema.payments} where ${schema.payments.orderId} = ${schema.orders.id} and ${schema.payments.status} = 'montant_different')`,
        isNotNull(schema.customers.email),
        ne(schema.customers.email, ""),
        immobileDepuis(seuil),
        ...(orderId === null ? [] : [eq(schema.orders.id, orderId)]),
      ),
    )
    .orderBy(desc(HORLOGE))
    .limit(limite);

  return lignes.map((l) => ({
    ...l,
    email: l.email ?? "",
    derniereActivite: l.lastActivityAt ?? l.createdAt,
  }));
}

/** Depuis combien d'heures ce panier ne bouge plus. */
function heuresDInactivite(p: PanierAbandonne): number {
  return (Date.now() - p.derniereActivite.getTime()) / 3600_000;
}

/**
 * Combien de relances sont parties pour ce panier.
 *
 * Le compteur, sauf pour les paniers relancés avant qu'il n'existe : ils y
 * portent 0 avec une date d'envoi, et cette date dit à elle seule qu'une
 * relance est partie. Lire « 0 » les ferait relancer une seconde fois sous le
 * nom de la première.
 */
function nombreDeRelances(p: PanierAbandonne): number {
  return Math.max(p.relancesEnregistrees, p.relanceAt ? 1 : 0);
}

/**
 * La prochaine relance AUTOMATIQUE de ce panier : laquelle, et à partir de
 * quand elle peut partir. Null quand toutes les relances programmées sont
 * parties, ou quand la suivante tomberait après les quatorze jours.
 *
 * Deux conditions, et la plus tardive l'emporte :
 *   - le délai de cette relance, compté depuis l'abandon ;
 *   - l'ÉCART prévu depuis la relance précédente. Sans lui, une boutique qui
 *     allume la relance sur un panier vieux de trois jours enverrait la 1re
 *     puis la 2e à cinq minutes d'intervalle, toutes deux « en retard ».
 *
 * Ni la plage horaire ni les gardes-fous n'entrent ici : c'est le calendrier,
 * pas la décision.
 */
function prochaineRelance(
  p: PanierAbandonne,
  r: ReglagesRelance,
): { etape: EtapeRelance; des: Date } | null {
  const delais = delaisDesRelances(r);
  const n = nombreDeRelances(p);
  const delai = delais[n];
  if (delai === undefined) return null;
  let des = p.derniereActivite.getTime() + delai * 3600_000;
  const precedent = delais[n - 1];
  if (n > 0 && p.relanceAt && precedent !== undefined)
    des = Math.max(des, p.relanceAt.getTime() + (delai - precedent) * 3600_000);
  if (des > p.derniereActivite.getTime() + FENETRE_HEURES * 3600_000) return null;
  return { etape: (n + 1) as EtapeRelance, des: new Date(des) };
}

/* -------------------------------------------------------------------------- */
/*  Les cinq gardes-fous                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Pourquoi on renonce. Un code POUR LE CODE, une phrase POUR LA BOUTIQUE :
 * décider d'après la phrase reviendrait à comparer des chaînes françaises, et
 * la première reformulation casserait silencieusement un garde-fou.
 */
type MotifRefus =
  | "fenetre"
  | "deja_relance"
  | "achat_croise"
  | "refus"
  | "pas_de_consentement"
  | "indisponible"
  | "vide";

/**
 * Les seuls motifs qu'un geste de la boutique peut passer outre : avoir déjà
 * relancé, et l'absence de consentement marketing (la marchande assume alors
 * l'envoi, un par un, ce qui n'est pas la même chose qu'un automate).
 *
 * Les autres tiennent même à la main. Relancer quelqu'un qui vient d'acheter,
 * insister auprès de qui a demandé qu'on le laisse tranquille, ou vanter une
 * affiche qu'on ne sait plus produire : aucun bouton ne doit permettre ça.
 */
const MOTIFS_FORCABLES: MotifRefus[] = ["deja_relance", "pas_de_consentement"];

/**
 * Ce que la vérification décide. Un refus porte toujours une phrase : c'est
 * elle que la boutique lit dans la liste, et elle doit se comprendre sans
 * connaître le code.
 */
type Verdict =
  | { envoyer: true; lignes: LigneCourrier[]; apercus: ApercuDeLigne[] }
  | { envoyer: false; code: MotifRefus; motif: string };

/**
 * L'aperçu d'une ligne du courrier : la ligne de commande dont on fabrique
 * l'image, et le visuel de la fiche à montrer si cette image ne peut pas se
 * faire. Dans l'ordre des lignes, une par ligne.
 */
interface ApercuDeLigne {
  orderItemId: number;
  /** La configuration de la ligne : elle fait la version de son aperçu. */
  config: unknown;
  repli: string | null;
}

/**
 * Les vignettes des produits, en adresse absolue et publique.
 *
 * Les images sont servies par l'API sous « /assets/… », derrière le préfixe
 * « /api » du proxy. Une messagerie ne sait pas résoudre un chemin relatif :
 * sans adresse complète, le client verrait des cadres vides.
 */
export async function vignettesDesProduits(
  productIds: (number | null)[],
): Promise<Map<number, string>> {
  const ids = [...new Set(productIds.filter((v): v is number => v != null))];
  if (!ids.length) return new Map();
  const images = await db
    .select({
      productId: schema.productImages.productId,
      url: schema.productImages.url,
      position: schema.productImages.position,
    })
    .from(schema.productImages)
    .where(inArray(schema.productImages.productId, ids));
  const par = new Map<number, string>();
  // La première image de la fiche : c'est celle que la boutique montre, donc
  // celle que le client reconnaîtra.
  for (const img of images.sort((a, b) => a.position - b.position)) {
    if (par.has(img.productId)) continue;
    const url = /^https?:\/\//i.test(img.url) ? img.url : `${ORIGINE}/api${img.url}`;
    par.set(img.productId, url);
  }
  return par;
}

/**
 * Le panier tel qu'il partira dans le courrier, article par article, et ce
 * qui n'est plus disponible.
 *
 * La disponibilité se lit à deux endroits. Le PRODUIT d'abord : effacé du
 * catalogue (la ligne garde alors son titre mais plus de `productId`) ou
 * retiré de la vente, il n'y a plus rien à commander. La VARIANTE ensuite :
 * le stock du format choisi, quand il est suivi.
 *
 * La variante ne se lit pas dans `variantId`, vide sur toutes les lignes de
 * cette base — aucun chemin d'ajout au panier ne le remplit. On la retrouve
 * par le couple (produit, format), qui est justement ce qui identifie une
 * variante ici. Sans ça, le garde-fou du stock ne se serait jamais déclenché.
 */
async function composerLignes(
  orderId: number,
  /** La langue du courrier : le nom des cadres et le titre de repli la suivent. */
  langue: Langue = "fr",
): Promise<{
  lignes: LigneCourrier[];
  indisponibles: number;
  apercus: ApercuDeLigne[];
}> {
  const articles = await db
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, orderId));
  const cadres = await db.select().from(schema.frames);
  const ids = [...new Set(articles.map((a) => a.productId).filter((v): v is number => v != null))];
  const produits = ids.length
    ? await db.select().from(schema.products).where(inArray(schema.products.id, ids))
    : [];
  const variantes = ids.length
    ? await db.select().from(schema.variants).where(inArray(schema.variants.productId, ids))
    : [];
  const vignettes = await vignettesDesProduits(ids);

  // Sans adresse publique du site, pas d'image plutôt qu'une image cassée
  // (adressePublique, mail.ts) : « localhost » ne s'ouvre chez personne.
  const origine = adressePublique();
  let indisponibles = 0;
  const lignes: LigneCourrier[] = articles.map((it) => {
    const cfg = (it.config ?? {}) as Record<string, unknown>;
    const format = typeof cfg.format === "string" ? cfg.format : "A4";
    const cadre = cadres.find((f) => String(f.id) === String(cfg.frameId ?? ""));
    const produit = it.productId != null ? produits.find((p) => p.id === it.productId) : null;
    const variante =
      it.variantId != null
        ? variantes.find((v) => v.id === it.variantId)
        : variantes.find((v) => v.productId === it.productId && v.format === format);

    // Une ligne sans `productId` ne se juge pas : on ne sait pas distinguer le
    // produit effacé de celui qui n'a jamais été renseigné. On la laisse
    // passer plutôt que d'annuler un envoi sur un doute.
    const produitPerdu = it.productId != null && !produit;
    const produitRetire = produit != null && produit.status !== "active";
    const stockEpuise =
      variante != null &&
      variante.stockQty != null &&
      variante.stockQty <= 0 &&
      variante.stockPolicy === "deny";
    const indisponible = produitPerdu || produitRetire || stockEpuise;
    if (indisponible) indisponibles += 1;

    return {
      titre: it.title ?? tc(langue)("lignes.titreParDefaut"),
      format,
      cadre: cadre ? (nomTraduit(cadre.translations, langue) ?? cadre.name) : null,
      quantite: it.quantity,
      unitPriceCents: it.unitPriceCents,
      // L'aperçu RÉEL de la ligne — l'affiche telle que la cliente l'a
      // composée, son texte et ses personnages —, et non le visuel de la
      // fiche, qui montrait la boutique (carte Trello « Panier abandonné »,
      // retour de Margaux du 22/10). C'est l'image de son compte et du banc
      // des courriers (courriers.ts), rendue par le moteur des fichiers
      // d'impression (apercus.ts). Adresse absolue, et signée : la messagerie
      // la charge sans session.
      imageUrl: origine ? `${origine}/api${cheminApercu(it.id, it.config)}` : null,
      // Une affiche en paysage a une vignette deux fois moins haute.
      paysage: cfg.orientation === "paysage",
      indisponible,
    };
  });
  const apercus = articles.map((it) => ({
    orderItemId: it.id,
    config: it.config,
    repli: it.productId != null ? (vignettes.get(it.productId) ?? null) : null,
  }));
  return { lignes, indisponibles, apercus };
}

/**
 * Le temps qu'on laisse aux aperçus d'un panier avant de le relancer. Un
 * rendu complet prend quelques secondes par affiche ; au-delà, le courrier
 * part quand même (voir `prechaufferApercus`).
 */
const ATTENTE_APERCUS_MS = 30_000;

/** Le motif d'un panier qui a cessé d'être relançable. */
const PLUS_RELANCABLE = "Ce panier n'est plus relançable (payé, annulé, ou sans adresse e-mail).";

/**
 * La durée d'un passage automatique, au plus. Chaque relance peut attendre
 * ses aperçus : passé ce temps, le passage rend la main, et le suivant (cinq
 * minutes plus tard) reprend les paniers restants.
 */
const DUREE_MAX_PASSAGE_MS = 2 * 60_000;

/**
 * Fabrique l'aperçu de chaque affiche d'un panier, et dit où en est chacun :
 * `true` prêt, `false` impossible, `null` encore en cours au bout du délai.
 *
 * Certaines messageries vont chercher les images dès la réception (Apple
 * Mail, entre autres) : l'aperçu doit donc être prêt avant que le courrier
 * parte, et non fabriqué à la première ouverture. Passé le délai, on envoie
 * quand même : le rendu continue, et l'image sera là quand la cliente ouvrira.
 *
 * Chaque ligne a son propre état, noté dès qu'il est connu : un aperçu
 * impossible reçoit le visuel de la fiche (avecLesReplis) même si une autre
 * affiche du panier, plus longue à composer, dépasse le délai.
 *
 * On le fait AVANT les garde-fous (verifierGardesFous), et non entre eux et
 * l'envoi : ce qu'ils vérifient — une commande payée entre-temps, un refus,
 * un achat ailleurs — doit l'être juste avant le courrier, pas trente
 * secondes plus tôt.
 */
async function prechaufferApercus(orderId: number): Promise<Map<number, boolean | null>> {
  const lignes = await db
    .select({ id: schema.orderItems.id })
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, orderId));
  const etats = new Map<number, boolean | null>(lignes.map((l) => [l.id, null]));
  const travaux = lignes.map((l) =>
    apercuDeLaLigne(l.id).then(
      (image) => void etats.set(l.id, image !== null),
      () => void etats.set(l.id, false),
    ),
  );
  let delai: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(travaux),
    new Promise<void>((fin) => {
      delai = setTimeout(fin, ATTENTE_APERCUS_MS);
    }),
  ]);
  clearTimeout(delai);
  return new Map(etats);
}

/**
 * Les lignes du courrier, le visuel de la fiche à la place de chaque aperçu
 * impossible. Un aperçu encore en cours garde son adresse : il sera prêt
 * avant l'ouverture.
 */
function avecLesReplis(
  lignes: LigneCourrier[],
  apercus: ApercuDeLigne[],
  etats: Map<number, boolean | null>,
): LigneCourrier[] {
  return lignes.map((l, i) => {
    const a = apercus[i];
    // Une ligne sans adresse d'image (pas d'adresse publique du site) n'en
    // reçoit pas non plus de repli : il pointerait vers « localhost ».
    return a && l.imageUrl && etats.get(a.orderItemId) === false
      ? { ...l, imageUrl: a.repli }
      : l;
  });
}

/**
 * A-t-on déjà été payé par cette personne depuis qu'elle a laissé ce panier ?
 *
 * « Finalisée » ne veut pas dire `status = 'paid'` : une commande prise au
 * STAND naît « pending » et le reste toute sa vie, la vendeuse ayant encaissé
 * de la main à la main. Elle compte donc autant qu'un paiement en ligne — la
 * personne a acheté, on ne la relance pas.
 *
 * La comparaison se fait sur l'ADRESSE, pas sur la fiche : cette base accepte
 * plusieurs fiches pour une même adresse, et se limiter au `customerId` du
 * panier laisserait passer l'achat fait depuis une autre fiche.
 */
async function achatCroise(panier: PanierAbandonne): Promise<boolean> {
  const [ligne] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.orders)
    .innerJoin(schema.customers, eq(schema.orders.customerId, schema.customers.id))
    .where(
      and(
        sql`lower(coalesce(${schema.customers.email}, '')) = ${panier.email.toLowerCase()}`,
        ne(schema.orders.id, panier.id),
        // Même précaution que pour l'horloge : la date passe en ISO 8601, que
        // Postgres convertit lui-même.
        sql`${schema.orders.createdAt} > ${panier.createdAt.toISOString()}::timestamptz`,
        or(eq(schema.orders.status, "paid"), eq(schema.orders.channel, "salon")),
      ),
    );
  return Number(ligne?.n ?? 0) > 0;
}

/** Cette adresse a-t-elle refusé qu'on lui rappelle ses paniers ? */
async function aRefuse(email: string): Promise<boolean> {
  // On cherche UN REFUS, pas une ligne : la même adresse peut en avoir deux
  // (écrite avec et sans majuscule, l'unicité de la colonne ne voit pas la
  // casse), et « la première venue » pouvait être celle sans refus — la
  // relance repartait alors chez quelqu'un qui avait dit non.
  const [ligne] = await db
    .select({ refuseLe: schema.relanceRefus.refuseLe })
    .from(schema.relanceRefus)
    .where(
      and(
        sql`lower(${schema.relanceRefus.email}) = ${email.toLowerCase()}`,
        isNotNull(schema.relanceRefus.refuseLe),
      ),
    )
    .limit(1);
  return Boolean(ligne?.refuseLe);
}

/**
 * Les cinq gardes-fous, vérifiés JUSTE AVANT l'envoi et jamais avant.
 *
 * L'ordre n'est pas indifférent : on écarte d'abord ce qui interdit l'envoi
 * pour toujours (la fenêtre, l'unicité), puis ce qui dépend du monde
 * extérieur (l'achat croisé, le consentement, le stock). Les vérifications
 * coûteuses ne tournent donc que sur les paniers qui ont une chance de partir.
 */
async function verifierGardesFous(
  panier: PanierAbandonne,
  reglages: ReglagesRelance,
  /**
   * Les motifs à ne pas examiner. Sert au forçage : la propriétaire a le
   * droit de passer outre l'unicité et le consentement, et rien d'autre.
   * Comme la vérification s'arrête au premier refus, sauter un motif à
   * l'appelant reviendrait à sauter aussi tous ceux qui viennent après.
   */
  sauter: readonly MotifRefus[] = [],
): Promise<Verdict> {
  // 5. La fenêtre de quatorze jours. En premier parce qu'elle est définitive.
  if (heuresDInactivite(panier) > FENETRE_HEURES)
    return {
      envoyer: false,
      code: "fenetre",
      motif: "Panier de plus de 14 jours : plus aucune relance.",
    };

  // 2. Unicité : le compteur, jamais une heuristique. Chaque relance
  // programmée part une fois ; quand elles sont toutes parties, plus rien ne
  // part tout seul.
  const envoyees = nombreDeRelances(panier);
  if (envoyees >= delaisDesRelances(reglages).length && !sauter.includes("deja_relance"))
    return {
      envoyer: false,
      code: "deja_relance",
      motif:
        envoyees > 1
          ? `Déjà relancé ${envoyees} fois : toutes les relances prévues sont parties.`
          : "Déjà relancé une fois.",
    };

  // 1. Achat croisé.
  if (await achatCroise(panier))
    return {
      envoyer: false,
      code: "achat_croise",
      motif: "Cette personne a commandé depuis, avec la même adresse.",
    };

  // 3. Consentement. Le refus explicite passe avant tout : quelqu'un qui a
  // demandé qu'on le laisse tranquille ne redevient pas relançable parce que
  // la boutique a changé de base légale.
  if (await aRefuse(panier.email))
    return {
      envoyer: false,
      code: "refus",
      motif: "Cette personne a demandé à ne plus recevoir de rappel.",
    };
  if (
    reglages.baseLegale === "consentement" &&
    !panier.accepteMarketing &&
    !sauter.includes("pas_de_consentement")
  )
    return {
      envoyer: false,
      code: "pas_de_consentement",
      motif: "Pas de consentement marketing sur cette fiche client.",
    };

  // 4. Disponibilité.
  const { lignes, indisponibles, apercus } = await composerLignes(
    panier.id,
    langueDuPanier(panier),
  );
  if (!lignes.length)
    return { envoyer: false, code: "vide", motif: "Panier vide." };
  if (indisponibles === lignes.length)
    return {
      envoyer: false,
      code: "indisponible",
      motif:
        lignes.length > 1
          ? "Aucun des articles n'est encore disponible."
          : "L'article n'est plus disponible.",
    };

  return { envoyer: true, lignes, apercus };
}

/* -------------------------------------------------------------------------- */
/*  Le lien de récupération et le refus                                        */
/* -------------------------------------------------------------------------- */

/**
 * Le jeton de récupération de ce panier, créé au besoin.
 *
 * Vingt-quatre octets tirés au sort, soit bien davantage qu'un UUID, et
 * surtout sans la moindre structure : il ne dit ni quand il a été créé, ni de
 * quel panier il s'agit, et deux jetons voisins ne se ressemblent pas. Un
 * panier garde le sien : le régénérer casserait le lien des courriers déjà
 * partis.
 */
export async function jetonDeRecuperation(orderId: number): Promise<string> {
  const [existant] = await db
    .select({ jeton: schema.orders.recoveryToken })
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId));
  if (existant?.jeton) return existant.jeton;
  const jeton = randomBytes(24).toString("base64url");
  await db
    .update(schema.orders)
    .set({ recoveryToken: jeton })
    .where(eq(schema.orders.id, orderId));
  return jeton;
}

/**
 * L'adresse complète du lien de récupération d'un panier.
 *
 * La page vit HORS du préfixe de langue (apps/web/src/pages/panier/
 * recuperer.astro) : sa langue se dit en « ?lang= », qu'elle lit. Le français
 * n'en a pas besoin, et son lien reste celui d'avant.
 */
export function lienDeRecuperation(jeton: string, langue: Langue = "fr"): string {
  return `${LIEN_RECUPERATION}?jeton=${encodeURIComponent(jeton)}${
    langue === "fr" ? "" : `&lang=${langue}`
  }`;
}

/**
 * Le jeton de refus d'une adresse, créé au besoin.
 *
 * Il porte sur l'ADRESSE et non sur le panier : refuser depuis le rappel d'un
 * panier doit valoir pour tous les suivants. L'adresse garde son jeton d'un
 * courrier à l'autre, sinon les liens déjà partis cesseraient de fonctionner.
 */
async function jetonDeRefus(email: string): Promise<string> {
  const lignes = await db
    .insert(schema.relanceRefus)
    .values({ jeton: randomBytes(24).toString("base64url"), email })
    // Rien à changer sur conflit : la mise à jour à vide suffit à faire
    // renvoyer SA ligne par Postgres, avec le jeton déjà attribué.
    .onConflictDoUpdate({ target: schema.relanceRefus.email, set: { email } })
    .returning({ jeton: schema.relanceRefus.jeton });
  const jeton = lignes[0]?.jeton;
  if (!jeton) throw new Error("jeton de refus non créé");
  return jeton;
}

/* -------------------------------------------------------------------------- */
/*  L'envoi                                                                   */
/* -------------------------------------------------------------------------- */

/** Ce qu'un envoi a donné, pour le journal comme pour l'écran. */
export interface ResultatEnvoi {
  parti: boolean;
  motif: string | null;
}

/**
 * Relance UN panier, gardes-fous compris.
 *
 * `forcer` saute les gardes-fous qui relèvent d'un choix de la boutique
 * (l'unicité, le consentement) mais JAMAIS ceux qui protègent le client : la
 * fenêtre de quatorze jours, l'achat croisé et la disponibilité tiennent même
 * pour un envoi déclenché à la main. Relancer quelqu'un qui vient d'acheter,
 * ou lui vanter une affiche qu'on ne sait plus produire, reste une faute que
 * personne ne veut commettre depuis un bouton.
 */
export async function relancerUnPanier(
  orderId: number,
  options: {
    forcer?: boolean;
    /**
     * La relance que le travailleur croit envoyer. Si une autre est partie
     * entre-temps (un clic sur « Relancer » pendant le passage), celle-ci
     * n'a plus lieu d'être : on s'arrête, sans rien noter.
     */
    etape?: EtapeRelance;
  } = {},
): Promise<ResultatEnvoi> {
  const reglages = await lireReglages();
  let panier = await panierAbandonne(orderId);
  if (!panier)
    return { parti: false, motif: PLUS_RELANCABLE };

  if (!courrierConfigure())
    return { parti: false, motif: "L'envoi de courriers n'est pas configuré." };

  const dejaParties = nombreDeRelances(panier);
  if (options.etape !== undefined && dejaParties >= options.etape)
    return { parti: false, motif: `La ${ordinal(options.etape)} relance est déjà partie.` };
  // Le bouton « Relancer » passe outre l'unicité, c'est son rôle. Pas le
  // double clic, ni la page rechargée qui renvoie le formulaire : une relance
  // partie il y a quelques minutes ne repart pas, quoi qu'on presse.
  if (
    options.forcer &&
    panier.relanceAt &&
    Date.now() - panier.relanceAt.getTime() < ANTI_DOUBLON_MS
  )
    return {
      parti: false,
      motif: "Une relance est partie vers cette adresse il y a moins de dix minutes : celle-ci n'est pas partie, pour ne pas écrire deux fois.",
    };
  // Le texte suit le rang de l'envoi : la 2e relance dit « toujours », la 3e
  // dit « dernier ». Un « Relancer à nouveau » au-delà de la 3e reprend le
  // texte de la 3e plutôt que d'en inventer un.
  const etape: EtapeRelance = options.etape ?? (Math.min(dejaParties + 1, 3) as EtapeRelance);

  // Un refus certain se dit tout de suite, sans fabriquer d'aperçus pour un
  // courrier qui ne partira pas — et sans faire attendre trente secondes la
  // boutique qui a cliqué « Relancer ». Le bouton saute les motifs qu'il a le
  // droit de forcer ; ils sont revus, en détail, plus bas.
  const avantLesApercus = await verifierGardesFous(
    panier,
    reglages,
    options.forcer ? MOTIFS_FORCABLES : [],
  );
  if (!avantLesApercus.envoyer) {
    await noterLeRenoncement(panier.id, avantLesApercus.motif);
    return { parti: false, motif: avantLesApercus.motif };
  }

  // Les aperçus, puis les garde-fous À NOUVEAU, sur le panier RELU : pendant
  // l'attente (trente secondes au plus), la cliente a pu payer, ou la boutique
  // archiver le panier. Sans adresse publique, le courrier n'a pas d'image :
  // rien à fabriquer.
  const etatsApercus = adressePublique()
    ? await prechaufferApercus(panier.id)
    : new Map<number, boolean | null>();
  panier = await panierAbandonne(orderId);
  if (!panier) return { parti: false, motif: PLUS_RELANCABLE };
  const verdict = await verifierGardesFous(panier, reglages);
  let lignes: LigneCourrier[];
  let apercus: ApercuDeLigne[];
  if (verdict.envoyer) {
    lignes = verdict.lignes;
    apercus = verdict.apercus;
  } else if (options.forcer && MOTIFS_FORCABLES.includes(verdict.code)) {
    // On repasse les gardes en sautant les deux forçables. Sans ce second
    // passage, forcer « déjà relancé » sauterait du même coup tout ce qui
    // vient après : le refus, l'achat croisé, le panier indisponible — la
    // vérification s'arrête au premier motif, et c'était lui.
    const second = await verifierGardesFous(panier, reglages, MOTIFS_FORCABLES);
    if (!second.envoyer) {
      await noterLeRenoncement(panier.id, second.motif);
      return { parti: false, motif: second.motif };
    }
    lignes = second.lignes;
    apercus = second.apercus;
  } else {
    await noterLeRenoncement(panier.id, verdict.motif);
    return { parti: false, motif: verdict.motif };
  }

  const jeton = await jetonDeRecuperation(panier.id);
  /*
   * Le lien de désinscription. TOUJOURS, quelle que soit la base légale.
   *
   * Sous l'intérêt légitime, il rend la base défendable. Sous le
   * consentement, il est tout aussi obligatoire : un consentement se retire
   * aussi facilement qu'il se donne, et la case cochée dont il s'agit ici est
   * celle de la lettre d'information, pas le même envoi. Un lien qui arrête
   * les relances, et elles seules, ne coupe donc rien d'autre.
   *
   * Il y a une raison plus terre à terre encore. Gmail et Outlook attendent
   * l'en-tête « List-Unsubscribe » sur ce genre de courrier et s'en servent
   * pour juger l'expéditeur. Sans lui, qui ne veut plus rien recevoir n'a
   * qu'un bouton sous la main, « courrier indésirable » : quelques clics de
   * ceux-là et c'est toute l'adresse d'expédition de la boutique qui tombe.
   */
  const langue = langueDuPanier(panier);
  // Dans la langue du courrier : la page qui s'ouvre doit parler comme lui.
  const desinscription = lienDeDesinscription(await jetonDeRefus(panier.email), langue);

  const courrier = courrierPanierAbandonne({
    langue,
    prenomClient: (panier.nom ?? "").split(" ")[0] || tc(langue)("commun.prenomParDefaut"),
    lien: lienDeRecuperation(jeton, langue),
    lignes: avecLesReplis(lignes, apercus, etatsApercus),
    totalCents: panier.totalCents,
    codePromo: panier.promoCode,
    lienDesinscription: desinscription,
    textes: await textesDeLaRelance(etape, langue),
  });

  /*
   * La réservation, juste avant l'envoi : le compteur ne passe à la valeur
   * suivante que s'il vaut encore ce qu'on a lu. Deux envois simultanés du
   * même panier — le travailleur et un clic, ou deux clics — ne peuvent donc
   * pas partir tous les deux : le second trouve le compteur déjà avancé et
   * s'arrête. Le verrou du travailleur ne protège que contre lui-même.
   *
   * La date d'envoi se pose DANS LA MÊME écriture, et pas après l'envoi : un
   * second clic qui arrive pendant que le serveur de courrier répond lirait
   * sinon le compteur déjà avancé, mais aucune date — l'anti-doublon des dix
   * minutes ne verrait rien, et la réservation suivante lui serait accordée.
   * Deux clics rapprochés envoyaient ainsi deux courriers (vérifié).
   */
  const [reserve] = await db
    .update(schema.orders)
    .set({ reminderCount: dejaParties + 1, reminderSentAt: new Date() })
    .where(
      and(
        eq(schema.orders.id, panier.id),
        eq(schema.orders.reminderCount, panier.relancesEnregistrees),
      ),
    )
    .returning({ id: schema.orders.id });
  if (!reserve)
    return {
      parti: false,
      motif: "Une autre relance de ce panier vient de partir : celle-ci est retenue, pour ne pas écrire deux fois.",
    };

  const parti = await envoyer({ ...courrier, to: panier.email });
  if (!parti) {
    // Rien n'est parti : le compteur et la date reprennent leur valeur, et la
    // relance pourra être retentée au passage suivant.
    await db
      .update(schema.orders)
      .set({ reminderCount: panier.relancesEnregistrees, reminderSentAt: panier.relanceAt })
      .where(
        and(
          eq(schema.orders.id, panier.id),
          eq(schema.orders.reminderCount, dejaParties + 1),
        ),
      );
    return { parti: false, motif: "Le courrier n'a pas pu partir." };
  }

  await db
    .update(schema.orders)
    .set({
      reminderSentAt: new Date(),
      recoveryDeclinedReason: null,
      recoveryDeclinedAt: null,
    })
    .where(eq(schema.orders.id, panier.id));
  await db.insert(schema.orderEvents).values({
    orderId: panier.id,
    kind: "event",
    message:
      dejaParties === 0
        ? `Relance de panier envoyée à ${panier.email}.`
        : `${ordinal(dejaParties + 1)} relance de panier envoyée à ${panier.email}.`,
  });
  return { parti: true, motif: null };
}

/**
 * Garde la trace d'un envoi auquel on a renoncé.
 *
 * Écrit sur la commande plutôt que dans le journal : l'écran doit pouvoir
 * afficher le motif en face de chaque ligne sans aller lire un journal par
 * panier. Le journal, lui, ne reçoit que ce qui est arrivé pour de bon.
 */
async function noterLeRenoncement(orderId: number, motif: string): Promise<void> {
  await db
    .update(schema.orders)
    .set({
      recoveryDeclinedReason: motif || null,
      recoveryDeclinedAt: motif ? new Date() : null,
    })
    .where(eq(schema.orders.id, orderId));
}

/* -------------------------------------------------------------------------- */
/*  Le travailleur                                                            */
/* -------------------------------------------------------------------------- */

/** Ce qu'un passage a fait, pour le journal de l'API et l'écran. */
export interface BilanPassage {
  examines: number;
  envoyes: number;
  renonces: number;
  echecs: number;
  /**
   * Pourquoi le passage n'a rien fait, quand ce n'est pas faute de paniers.
   * « 0 panier examiné » sans explication se lit comme une panne, alors que
   * c'est le plus souvent un réglage, et un réglage voulu.
   */
  motif?: string | null;
}

/** Vrai pendant qu'un passage tourne : deux passages ne se chevauchent jamais. */
let passageEnCours = false;
let minuterie: ReturnType<typeof setInterval> | null = null;

/**
 * Un passage du travailleur : tous les paniers éligibles, un par un.
 *
 * Éligible veut dire : abandonné depuis au moins le PALIER D'ENVOI (et non le
 * délai plancher, qui ne sert qu'à l'affichage), jamais relancé, et dans la
 * fenêtre de quatorze jours. Les cinq gardes-fous décident du reste.
 *
 * Exporté, parce qu'on doit pouvoir le déclencher à la main : depuis le
 * back-office quand on n'a pas envie d'attendre, et pendant les essais.
 */
export async function passageDeRelance(): Promise<BilanPassage> {
  const bilan: BilanPassage = {
    examines: 0,
    envoyes: 0,
    renonces: 0,
    echecs: 0,
    motif: null,
  };
  if (passageEnCours) {
    bilan.motif = "Un passage est déjà en cours, celui-ci n'a rien fait.";
    return bilan;
  }
  passageEnCours = true;
  try {
    // Les réglages se relisent à CHAQUE passage : une relance éteinte, un
    // délai changé ou une plage resserrée au back-office valent dès le
    // passage suivant, sans redémarrer l'API.
    const reglages = await lireReglages();
    if (!reglages.active) {
      bilan.motif =
        "La relance automatique est éteinte : aucun courrier ne part tout seul. Le bouton « Relancer » d'une ligne, lui, fonctionne toujours.";
      return bilan;
    }
    if (!courrierConfigure()) {
      console.warn("[relance] envoi de courriers non configuré — passage sans effet");
      bilan.motif =
        "L'envoi de courriers n'est pas configuré : rien ne peut partir.";
      return bilan;
    }
    const maintenant = new Date();
    if (reglages.plage && !dansLaPlage(reglages, maintenant)) {
      bilan.motif = `Hors de la plage d'envoi (de ${reglages.plage.debut} h à ${reglages.plage.fin} h, heure de Paris) : les relances dues partiront à ${reglages.plage.debut} h.`;
      return bilan;
    }

    // Le délai de la 1re relance s'exprime en heures d'inactivité : on le
    // convertit en minutes pour réutiliser la même horloge que l'affichage.
    // Aucun panier ne peut devoir une relance avant ce délai-là, puisque les
    // suivantes viennent forcément après.
    //
    // Les deux tris qui suivent redisent des garde-fous que `verifierGardesFous`
    // vérifie de toute façon, et c'est voulu : ils écartent d'emblée le gros du
    // troupeau — les paniers dont toutes les relances sont parties, ceux dont
    // la suivante n'est pas encore due, et les vieux — pour ne pas noter un
    // renoncement à chaque passage sur des paniers dont le sort est réglé.
    const candidats = (await paniersAbandonnes(reglages.palierHeures * 60, 200))
      .filter((p) => heuresDInactivite(p) <= FENETRE_HEURES)
      .map((p) => ({ panier: p, prochaine: prochaineRelance(p, reglages) }))
      .filter(
        (c): c is { panier: PanierAbandonne; prochaine: { etape: EtapeRelance; des: Date } } =>
          c.prochaine !== null && c.prochaine.des.getTime() <= maintenant.getTime(),
      );

    const debutPassage = Date.now();
    for (const { panier, prochaine } of candidats) {
      // Chaque relance attend ses aperçus : un passage peut durer. La plage
      // d'envoi se revérifie avant chaque panier, et le passage s'écourte
      // au-delà de DUREE_MAX_PASSAGE_MS — le suivant reprend les restants.
      if (reglages.plage && !dansLaPlage(reglages, new Date())) {
        bilan.motif =
          "La plage d'envoi s'est refermée pendant le passage : les relances restantes partiront à sa prochaine ouverture.";
        break;
      }
      if (Date.now() - debutPassage > DUREE_MAX_PASSAGE_MS) {
        bilan.motif = "Passage écourté : les relances restantes partiront au passage suivant.";
        break;
      }
      bilan.examines += 1;
      const verdict = await verifierGardesFous(panier, reglages);
      if (!verdict.envoyer) {
        await noterLeRenoncement(panier.id, verdict.motif);
        bilan.renonces += 1;
        continue;
      }
      // `relancerUnPanier` revérifie tout avant d'écrire : entre la décision
      // ci-dessus et l'envoi, une commande a pu être payée. Deux vérifications
      // coûtent une requête ; un courrier de trop coûte un client.
      const resultat = await relancerUnPanier(panier.id, { etape: prochaine.etape });
      if (resultat.parti) bilan.envoyes += 1;
      else bilan.echecs += 1;
    }
    if (bilan.envoyes || bilan.renonces)
      console.log(
        `[relance] ${bilan.envoyes} courrier(s) parti(s), ${bilan.renonces} renoncement(s) sur ${bilan.examines} panier(s).`,
      );
    return bilan;
  } catch (e) {
    // Un travailleur qui lève emporte sa minuterie avec lui. On journalise et
    // on rend la main : le passage suivant réessaiera dans cinq minutes.
    console.error("[relance] passage interrompu", e);
    return bilan;
  } finally {
    passageEnCours = false;
  }
}

/**
 * Démarre le travailleur : un passage toutes les cinq minutes, dans le
 * processus de l'API.
 *
 * Il n'y a ici ni file d'attente ni Redis, et il n'en faut pas : une boutique
 * qui compte ses paniers par dizaines n'a pas besoin d'une infrastructure de
 * plus à surveiller. Le garde-fou tient en une variable — `passageEnCours` —
 * qui empêche deux passages de se chevaucher si l'un dure plus longtemps que
 * la période. `unref()` évite que la minuterie retienne le processus au moment
 * de l'arrêter.
 */
export function demarrerRelancePanier(): void {
  if (minuterie) return;
  minuterie = setInterval(() => {
    void passageDeRelance();
  }, PERIODE_PASSAGE_MS);
  minuterie.unref?.();
  console.log("[relance] travailleur démarré (passage toutes les 5 minutes)");
}

/* -------------------------------------------------------------------------- */
/*  Ce que l'écran reçoit                                                     */
/* -------------------------------------------------------------------------- */

type EtatPanier = "abandonne" | "relance" | "recupere" | "trop_ancien" | "renonce";

/** Une ligne de la liste du back-office. */
export interface LignePanierVue {
  id: number;
  number: string;
  totalCents: number;
  articles: number;
  nom: string | null;
  email: string;
  createdAt: string;
  derniereActivite: string;
  relanceAt: string | null;
  recupereLe: string | null;
  etat: EtatPanier;
  etatLibelle: string;
  /** Pourquoi l'envoi automatique a renoncé. Null quand il n'a pas renoncé. */
  motifRenoncement: string | null;
  /** Le lien de récupération, prêt à être copié. */
  lienRecuperation: string;
  /** Vrai tant qu'une relance peut encore partir. */
  relancable: boolean;
  /** Combien de relances sont parties pour ce panier. */
  nombreRelances: number;
  /**
   * La prochaine relance automatique, en une phrase : « 2e relance prévue le
   * 3 octobre à 09:00 ». Null quand il n'y en aura pas — relance éteinte,
   * toutes parties, ou envoi déjà écarté par un garde-fou.
   */
  prochaineRelance: string | null;
}

/**
 * La prochaine relance d'un panier, telle que l'écran l'annonce.
 *
 * C'est une PRÉVISION, et elle le dit : les gardes-fous ne se jugent qu'au
 * moment de l'envoi (la cliente peut acheter d'ici là). On ne l'annonce
 * d'ailleurs pas quand on sait déjà qu'elle ne partira pas — envoi déjà
 * écarté, ou cliente sans consentement sous la base du consentement. La
 * plage horaire, elle, est prise en compte : une relance due à 23 h est
 * annoncée pour le matin.
 */
function prochaineRelanceVue(
  p: PanierAbandonne,
  r: ReglagesRelance,
  etat: EtatPanier,
): string | null {
  if (!r.active) return null;
  if (etat !== "abandonne" && etat !== "relance") return null;
  if (p.motifRenoncement) return null;
  if (r.baseLegale === "consentement" && !p.accepteMarketing) return null;
  const prochaine = prochaineRelance(p, r);
  if (!prochaine) return null;
  const maintenant = Date.now();
  const quand = prochaineOuverture(r, new Date(Math.max(prochaine.des.getTime(), maintenant)));
  // Le travailleur passe toutes les cinq minutes : une relance déjà due
  // partira au prochain passage, et le dire vaut mieux qu'une heure passée.
  if (quand.getTime() <= maintenant + PERIODE_PASSAGE_MS)
    return `${ordinal(prochaine.etape)} relance : au prochain passage, d'ici cinq minutes`;
  return `${ordinal(prochaine.etape)} relance prévue ${leJour(quand)}`;
}

/** « il y a 3 h », « il y a 2 jours » — la durée telle qu'on la dit. */
function depuis(date: Date): string {
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000));
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.round(minutes / 60);
  if (heures < 48) return `il y a ${heures} h`;
  const jours = Math.round(heures / 24);
  return `il y a ${jours} jours`;
}

/** « le 4 mars à 14:05 ». */
function leJour(date: Date): string {
  return `le ${date.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Paris",
  })} à ${date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  })}`;
}

/**
 * L'état d'un panier, en une phrase que la boutique lit sans traduire.
 *
 * L'ordre des questions est celui de l'importance : récupéré d'abord (c'est la
 * bonne nouvelle), puis trop ancien (c'est définitif), puis relancé, puis le
 * renoncement, et enfin l'attente.
 */
function etatDuPanier(p: PanierAbandonne): {
  etat: EtatPanier;
  libelle: string;
  relancable: boolean;
} {
  if (p.recupereLe)
    return { etat: "recupere", libelle: `Récupéré ${leJour(p.recupereLe)}`, relancable: false };
  if (heuresDInactivite(p) > FENETRE_HEURES)
    return {
      etat: "trop_ancien",
      libelle: "Trop ancien, plus de relance",
      relancable: false,
    };
  if (p.relanceAt) {
    const n = nombreDeRelances(p);
    return {
      etat: "relance",
      libelle:
        n > 1
          ? `Relancé ${n} fois, la dernière ${leJour(p.relanceAt)}`
          : `Relancé ${leJour(p.relanceAt)}`,
      relancable: true,
    };
  }
  // Un envoi renoncé garde son âge : le motif s'écrit juste en dessous, et
  // remplacer « abandonné il y a 3 h » par « envoi renoncé » ferait perdre la
  // seule information qui dise si le panier est encore tiède.
  if (p.motifRenoncement)
    return {
      etat: "renonce",
      libelle: `Abandonné ${depuis(p.derniereActivite)}`,
      relancable: true,
    };
  return {
    etat: "abandonne",
    libelle: `Abandonné ${depuis(p.derniereActivite)}`,
    relancable: true,
  };
}

/** Les chiffres du haut de l'écran. */
export interface ChiffresRelance {
  relancables: number;
  montantEnJeu: number;
  relancesEnvoyees: number;
  paniersRecuperes: number;
  montantRecupere: number;
}

/**
 * Les chiffres, calculés sur TOUTE l'histoire de la boutique et non sur la
 * page affichée : « combien de paniers avons-nous rattrapés » n'a de sens que
 * cumulé. Seuls les deux premiers portent sur la liste du moment.
 */
async function chiffres(paniers: PanierAbandonne[]): Promise<ChiffresRelance> {
  const relancables = paniers.filter((p) => etatDuPanier(p).relancable);
  // Des COURRIERS, pas des paniers : depuis qu'un panier peut être relancé
  // deux ou trois fois, compter les paniers relancés sous-estimait ce chiffre.
  // `greatest(…, 1)` pour les paniers relancés avant le compteur (0 et une
  // date), comme `nombreDeRelances`.
  const [envoyees] = await db
    .select({
      n: sql<number>`coalesce(sum(greatest(${schema.orders.reminderCount}, 1)), 0)::int`,
    })
    .from(schema.orders)
    .where(isNotNull(schema.orders.reminderSentAt));
  const [recuperes] = await db
    .select({
      n: sql<number>`count(*)::int`,
      montant: sql<number>`coalesce(sum(${schema.orders.totalCents}), 0)::int`,
    })
    .from(schema.orders)
    .where(isNotNull(schema.orders.recoveredAt));
  return {
    relancables: relancables.length,
    montantEnJeu: relancables.reduce((s, p) => s + p.totalCents, 0),
    relancesEnvoyees: Number(envoyees?.n ?? 0),
    paniersRecuperes: Number(recuperes?.n ?? 0),
    montantRecupere: Number(recuperes?.montant ?? 0),
  };
}

/* -------------------------------------------------------------------------- */
/*  Pages publiques                                                           */
/* -------------------------------------------------------------------------- */

/** Échappe le texte inséré dans une page HTML. */
function h(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * La page publique du refus. Même sobriété que celle de la lettre
 * d'information : une page, une phrase, un bouton.
 */
function pageRefus(titre: string, corps: string, langue: Langue = "fr"): string {
  return `<!doctype html>
<html lang="${langue}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${h(titre)} · Memory Line</title>
  <style>
    body { margin:0; background:#f3f3f3; color:#121212; min-height:100vh;
      display:flex; align-items:center; justify-content:center; padding:24px;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,system-ui,sans-serif; }
    main { background:#fff; max-width:520px; width:100%; padding:36px 32px; }
    h1 { font-size:22px; font-weight:400; letter-spacing:.6px; margin:0 0 16px; }
    p { font-size:15px; line-height:1.6; margin:0 0 12px; }
    .discret { color:#5b5b54; font-size:13px; }
    button { margin-top:12px; background:#121212; color:#fff; border:0;
      padding:14px 28px; font-size:15px; cursor:pointer; }
  </style>
</head>
<body><main><h1>${h(titre)}</h1>${corps}</main></body>
</html>`;
}

/* -------------------------------------------------------------------------- */
/*  Les routes                                                                */
/* -------------------------------------------------------------------------- */

export function mountRelancePanier(app: Hono): void {
  /* --- Le back-office ---------------------------------------------------- */

  /**
   * Tout l'écran des paniers abandonnés en un seul aller-retour : les
   * réglages, les chiffres, et la liste.
   *
   * Le paramètre `plancher` (en minutes) permet de regarder la liste avec un
   * autre délai que celui enregistré, sans rien changer aux réglages.
   */
  app.get("/admin/carts/abandoned", async (c) => {
    const reglages = await lireReglages();
    const demande = c.req.query("plancher");
    const plancher =
      demande === undefined ? reglages.plancherMinutes : plancherValide(demande);
    const paniers = await paniersAbandonnes(plancher);
    const personnalisees = await languesPersonnalisees();

    const compte = new Map<number, number>();
    if (paniers.length) {
      const articles = await db
        .select({
          orderId: schema.orderItems.orderId,
          quantity: schema.orderItems.quantity,
        })
        .from(schema.orderItems)
        .where(inArray(schema.orderItems.orderId, paniers.map((p) => p.id)));
      for (const a of articles)
        compte.set(a.orderId, (compte.get(a.orderId) ?? 0) + a.quantity);
    }

    // Les adresses qui ont demandé à ne plus être relancées, en une requête
    // pour toute la liste : l'écran n'annonce pas une relance qu'on sait déjà
    // ne pas devoir envoyer.
    const refus = new Set<string>();
    if (paniers.length) {
      const lignesRefus = await db
        .select({ email: schema.relanceRefus.email })
        .from(schema.relanceRefus)
        .where(
          and(
            isNotNull(schema.relanceRefus.refuseLe),
            inArray(
              sql`lower(${schema.relanceRefus.email})`,
              [...new Set(paniers.map((p) => p.email.toLowerCase()))],
            ),
          ),
        );
      for (const l of lignesRefus) refus.add(l.email.toLowerCase());
    }

    // Le lien de récupération est montré tel qu'il partira. Le jeton se crée
    // ici quand il n'existe pas : la boutique doit pouvoir copier le lien et
    // le donner au téléphone, sans avoir envoyé de courrier.
    const lignes: LignePanierVue[] = [];
    for (const p of paniers) {
      const etat = etatDuPanier(p);
      lignes.push({
        id: p.id,
        number: p.number,
        totalCents: p.totalCents,
        articles: compte.get(p.id) ?? 0,
        nom: p.nom,
        email: p.email,
        createdAt: p.createdAt.toISOString(),
        derniereActivite: p.derniereActivite.toISOString(),
        relanceAt: p.relanceAt?.toISOString() ?? null,
        recupereLe: p.recupereLe?.toISOString() ?? null,
        etat: etat.etat,
        etatLibelle: etat.libelle,
        motifRenoncement: p.motifRenoncement,
        // Le même lien que celui du courrier : la page s'ouvre dans la langue
        // de la personne à qui la boutique le donne.
        lienRecuperation: lienDeRecuperation(
          await jetonDeRecuperation(p.id),
          langueDuPanier(p),
        ),
        relancable: etat.relancable,
        nombreRelances: nombreDeRelances(p),
        // Un panier vidé, ou une adresse qui a refusé les rappels : les
        // gardes-fous l'écarteront à coup sûr, l'écran ne promet donc rien.
        prochaineRelance:
          (compte.get(p.id) ?? 0) === 0 || refus.has(p.email.toLowerCase())
            ? null
            : prochaineRelanceVue(p, reglages, etat.etat),
      });
    }

    return c.json({
      reglages,
      plancher,
      paliers: PALIERS_ENVOI,
      paliersSuivants: PALIERS_SUIVANTS,
      fenetreHeures: FENETRE_HEURES,
      courrierConfigure: courrierConfigure(),
      chiffres: await chiffres(paniers),
      paniers: lignes,
      // Pour chaque relance : ses textes ont-ils été réécrits, et dans quelles
      // langues ? L'écran le dit à côté du lien « Modifier le courriel ».
      courriels: ETAPES.map((etape) => ({
        etape,
        personnalise: personnalisees[etape].length > 0,
        langues: personnalisees[etape],
      })),
    });
  });

  /** Enregistre les réglages de la relance. */
  app.post("/admin/relance/reglages", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      return c.json({ reglages: await ecrireReglages(body) });
    } catch (e) {
      if (e instanceof ReglageRefuse) return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  /* --- Les textes des courriels ------------------------------------------ */

  /**
   * Les textes des trois relances dans une langue (« ?langue=en », le
   * français à défaut) : ceux qui partiront, ceux d'origine, et les variables
   * qu'on peut y glisser. Dans une autre langue, les textes français de
   * chaque relance viennent avec, en regard : c'est d'eux qu'on traduit. Et,
   * pour les onglets, les langues où chaque relance a déjà son texte.
   */
  app.get("/admin/relance/courriels", async (c) => {
    const langue = langueDemandee(c.req.query("langue"));
    if (!langue) return c.json({ error: LANGUE_INCONNUE }, 400);
    const reglages = await lireReglages();
    const delais = delaisDesRelances(reglages);
    const personnalisees = await languesPersonnalisees();
    const etapes = [];
    for (const etape of ETAPES) {
      const propres = await textesEnregistres(etape, langue);
      const origine = textesDOrigine(etape, langue);
      const delai = delais[etape - 1];
      etapes.push({
        etape,
        nom: `${ordinal(etape)} relance`,
        textes: propres ?? origine,
        origine,
        personnalise: propres !== null,
        langues: personnalisees[etape],
        francais:
          langue === "fr"
            ? null
            : ((await textesEnregistres(etape, "fr")) ?? TEXTES_RELANCE_DEFAUT[etape]),
        // Programmée ou non : un courriel qu'on soigne mais qui ne partira
        // jamais tout seul doit le dire, sinon on attend un envoi qui ne
        // viendra pas.
        programmee: delai !== undefined,
        quand: delai !== undefined ? `${duree(delai)} après l'abandon` : null,
      });
    }
    return c.json({
      langue,
      etapes,
      variables: VARIABLES_RELANCE,
      active: reglages.active,
      // L'écran le sait AVANT qu'on clique : un bouton « Proposer la
      // traduction » qui échoue à chaque fois ne dirait rien d'utile.
      traductionDisponible: traductionDisponible(),
    });
  });

  /** Enregistre les textes d'une relance, dans une langue. */
  app.put("/admin/relance/courriels/:etape", async (c) => {
    const etape = etapeLue(c.req.param("etape"));
    if (!etape) return c.json({ error: "Cette relance n'existe pas." }, 400);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const langue = langueDemandee(body.langue ?? c.req.query("langue"));
    if (!langue) return c.json({ error: LANGUE_INCONNUE }, 400);
    try {
      return c.json(await enregistrerTextes(etape, body.textes ?? body, langue));
    } catch (e) {
      if (e instanceof ReglageRefuse) return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  /** « Revenir au texte d'origine », dans une langue. */
  app.delete("/admin/relance/courriels/:etape", async (c) => {
    const etape = etapeLue(c.req.param("etape"));
    if (!etape) return c.json({ error: "Cette relance n'existe pas." }, 400);
    const langue = langueDemandee(c.req.query("langue"));
    if (!langue) return c.json({ error: LANGUE_INCONNUE }, 400);
    await revenirAuTexteDOrigine(etape, langue);
    return c.json({ textes: textesDOrigine(etape, langue), personnalise: false });
  });

  /**
   * « Proposer la traduction » : les textes français de cette relance,
   * traduits dans la langue demandée. N'ENREGISTRE RIEN — l'écran pose la
   * proposition dans les champs, et c'est la boutique qui enregistre.
   */
  app.post("/admin/relance/courriels/:etape/traduction", async (c) => {
    const etape = etapeLue(c.req.param("etape"));
    if (!etape) return c.json({ error: "Cette relance n'existe pas." }, 400);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const langue = langueDemandee(body.langue);
    if (!langue || langue === "fr")
      return c.json({ error: "Choisissez la langue dans laquelle traduire le texte français." }, 400);
    if (!traductionDisponible())
      return c.json(
        {
          error:
            "La traduction automatique est indisponible sur ce serveur (il manque la clé OpenAI). Vous pouvez écrire la traduction vous-même.",
        },
        503,
      );
    try {
      return c.json(await proposerTraductionRelance(etape, langue));
    } catch (e) {
      if (e instanceof EchecTraduction) return c.json({ error: e.message }, 502);
      console.error("[relance] traduction", e);
      return c.json({ error: "La traduction a échoué. Réessayez dans un instant." }, 502);
    }
  });

  /**
   * Relance manuelle. Reste possible même quand l'automatique est coupée :
   * c'est le geste de la boutique qui décide, pas le travailleur.
   */
  app.post("/admin/carts/:id/relancer", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isSafeInteger(id) || id <= 0)
      return c.json({ error: "panier inconnu" }, 400);
    const resultat = await relancerUnPanier(id, { forcer: true });
    if (!resultat.parti)
      return c.json({ error: resultat.motif ?? "envoi impossible" }, 400);
    return c.json({ ok: true });
  });

  /** Déclenche un passage du travailleur tout de suite. */
  app.post("/admin/relance/passage", async (c) => {
    return c.json({ bilan: await passageDeRelance() });
  });

  /* --- Le lien de récupération, public ----------------------------------- */

  /**
   * Ce que le jeton ouvre : de quoi remettre le panier dans le navigateur.
   *
   * La page qui l'appelle vit dans la boutique (apps/web) — c'est elle qui
   * écrit l'identifiant de panier et le code de réduction, puis emmène au
   * tunnel. L'API se contente de dire à quel panier ce jeton correspond.
   */
  app.get("/panier/recuperation/:jeton", async (c) => {
    const jeton = c.req.param("jeton").trim();
    if (!jeton) return c.json({ error: "jeton_inconnu" }, 404);

    const [panier] = await db
      .select({
        id: schema.orders.id,
        clientOrderId: schema.orders.clientOrderId,
        status: schema.orders.status,
        totalCents: schema.orders.totalCents,
        promoCode: schema.orders.promoCode,
        createdAt: schema.orders.createdAt,
        lastActivityAt: schema.orders.lastActivityAt,
        nom: schema.customers.name,
        email: schema.customers.email,
      })
      .from(schema.orders)
      .leftJoin(schema.customers, eq(schema.orders.customerId, schema.customers.id))
      .where(eq(schema.orders.recoveryToken, jeton))
      .limit(1);

    if (!panier) return c.json({ error: "jeton_inconnu" }, 404);
    if (panier.status === "paid") return c.json({ error: "deja_payee" }, 409);
    if (STATUTS_CLOS.includes(panier.status))
      return c.json({ error: "panier_clos" }, 409);
    // Passé quatorze jours, le lien ne sert plus : le panier n'est plus
    // relancé, et le rouvrir ferait miroiter des prix qui ont pu changer.
    const horloge = panier.lastActivityAt ?? panier.createdAt;
    if ((Date.now() - horloge.getTime()) / 3600_000 > FENETRE_HEURES)
      return c.json({ error: "trop_ancien" }, 410);
    if (!panier.clientOrderId) return c.json({ error: "jeton_inconnu" }, 404);

    const { lignes, apercus } = await composerLignes(panier.id);
    // L'aperçu s'il est déjà fabriqué — la relance l'a fait avant de partir —,
    // sinon le visuel de la fiche : une visite de cette page publique ne doit
    // pas lancer un rendu complet par affiche, ni montrer une image cassée.
    const prets = await Promise.all(
      apercus.map((a) => apercuDejaPret(a.orderItemId, a.config)),
    );
    return c.json({
      cartId: panier.clientOrderId,
      promoCode: panier.promoCode,
      nom: panier.nom,
      email: panier.email,
      totalCents: panier.totalCents,
      articles: lignes.map((l, i) => ({
        titre: l.titre,
        format: l.format,
        quantite: l.quantite,
        unitPriceCents: l.unitPriceCents,
        imageUrl: (prets[i] && l.imageUrl) || apercus[i]?.repli || null,
        indisponible: Boolean(l.indisponible),
      })),
    });
  });

  /* --- Le refus, public -------------------------------------------------- */

  /**
   * La page de refus. Publique, et elle DEMANDE avant d'agir : les messageries
   * d'entreprise ouvrent les liens des courriers reçus pour les inspecter, et
   * une page qui agirait au chargement désabonnerait des gens qui n'ont jamais
   * cliqué.
   */
  app.get("/relance/desabonnement", async (c) => {
    const jeton = (c.req.query("jeton") ?? "").trim();
    // La langue du courrier d'où vient le clic (voir `lienDeDesinscription`).
    const langue = langueLue(c.req.query("lang")) ?? "fr";
    const t = TEXTES_REFUS[langue];

    if (jeton === "essai")
      return c.html(pageRefus(t.exemple.titre, t.exemple.corps, langue));

    const [trouve] = jeton
      ? await db
          .select()
          .from(schema.relanceRefus)
          .where(eq(schema.relanceRefus.jeton, jeton))
          .limit(1)
      : [];

    if (!trouve) return c.html(pageRefus(t.inconnu.titre, t.inconnu.corps, langue), 404);

    if (trouve.refuseLe)
      return c.html(pageRefus(t.deja.titre, t.deja.corps(h(trouve.email)), langue));

    // Le formulaire repart avec la langue : la page qui confirme le refus doit
    // parler comme celle qui l'a demandé.
    return c.html(
      pageRefus(
        t.demande.titre,
        `${t.demande.avant(h(trouve.email))}
         <form method="POST" action="${h(lienDeDesinscription(trouve.jeton, langue))}">
           <input type="hidden" name="jeton" value="${h(trouve.jeton)}" />
           <button type="submit">${t.demande.bouton}</button>
         </form>
         ${t.demande.apres}`,
        langue,
      ),
    );
  });

  /**
   * Le refus lui-même.
   *
   * Le jeton se lit dans l'ADRESSE autant que dans le formulaire : le bouton
   * « Se désabonner » de Gmail et d'Outlook envoie un POST directement à
   * l'adresse annoncée par `List-Unsubscribe`, sans rien de notre formulaire.
   * Sans cette lecture, ce bouton-là n'aurait servi à rien.
   */
  app.post("/relance/desabonnement", async (c) => {
    const formulaire = await c.req
      .parseBody()
      .catch(() => ({}) as Record<string, unknown>);
    const jeton =
      (c.req.query("jeton") ?? "").trim() ||
      String(formulaire["jeton"] ?? "").trim().slice(0, 200);
    const langue = langueLue(c.req.query("lang")) ?? "fr";
    const t = TEXTES_REFUS[langue];

    const [trouve] = jeton
      ? await db
          .select()
          .from(schema.relanceRefus)
          .where(eq(schema.relanceRefus.jeton, jeton))
          .limit(1)
      : [];

    if (!trouve)
      return c.html(pageRefus(t.inconnuEnvoi.titre, t.inconnuEnvoi.corps, langue), 404);

    if (!trouve.refuseLe)
      await db
        .update(schema.relanceRefus)
        .set({ refuseLe: new Date() })
        .where(eq(schema.relanceRefus.jeton, trouve.jeton));

    return c.html(pageRefus(t.fait.titre, t.fait.corps(h(trouve.email)), langue));
  });
}

/**
 * L'adresse de la page de refus des relances, dans la langue du courrier.
 *
 * Comme le lien de récupération, la page vit hors de tout préfixe de langue :
 * sa langue se dit en « &lang= ». Le français n'en a pas besoin, et son lien
 * reste celui d'avant. Sert au courrier (et à son en-tête List-Unsubscribe)
 * comme au formulaire de la page elle-même.
 */
function lienDeDesinscription(jeton: string, langue: Langue = "fr"): string {
  return `${LIEN_DESINSCRIPTION}?jeton=${encodeURIComponent(jeton)}${
    langue === "fr" ? "" : `&lang=${langue}`
  }`;
}

/** Ce que dit la page de refus, dans chaque état. Les adresses arrivent échappées. */
interface TextesRefus {
  exemple: { titre: string; corps: string };
  /** Lien inconnu, à l'ouverture de la page. */
  inconnu: { titre: string; corps: string };
  /** Lien inconnu, à l'envoi du formulaire (ou par le bouton de la messagerie). */
  inconnuEnvoi: { titre: string; corps: string };
  deja: { titre: string; corps: (email: string) => string };
  demande: { titre: string; avant: (email: string) => string; bouton: string; apres: string };
  fait: { titre: string; corps: (email: string) => string };
}

/**
 * La page de refus dans les cinq langues.
 *
 * C'est le lien qu'exige le RGPD au pied de chaque relance : une cliente qui
 * vient de lire son rappel en allemand doit comprendre, en allemand, ce que
 * fait le bouton qu'on lui demande d'appuyer. Les textes vivent ici et non
 * dans le dictionnaire des courriels parce que c'est une PAGE, servie par
 * l'API : ils n'ont rien à faire dans les modèles de mail.ts.
 *
 * Le français est celui d'avant, à la lettre (retours à la ligne compris) :
 * la page d'un lien français ne change pas d'un octet. Mêmes tons que les
 * courriels : « Sie » en allemand, tutoiement en italien et en espagnol,
 * anglais britannique.
 */
const TEXTES_REFUS: Record<Langue, TextesRefus> = {
  fr: {
    exemple: {
      titre: "Lien d'exemple",
      corps: `<p>Ce lien vient d'un essai : il ne retire personne d'aucune liste.</p>
           <p class="discret">Dans un vrai rappel de panier, il arrête les relances en un clic.</p>`,
    },
    inconnu: {
      titre: "Ce lien n'est plus valable",
      corps: `<p>Nous ne reconnaissons pas ce lien. Il a peut-être été coupé en deux par
            votre messagerie.</p>
           <p class="discret">Écrivez-nous en répondant simplement au message : nous
            arrêterons les rappels à la main.</p>`,
    },
    inconnuEnvoi: {
      titre: "Ce lien n'est plus valable",
      corps: `<p>Nous ne reconnaissons pas ce lien.</p>
           <p class="discret">Écrivez-nous en répondant simplement au message : nous
            arrêterons les rappels à la main.</p>`,
    },
    deja: {
      titre: "C'est déjà fait",
      corps: (email) => `<p>L'adresse ${email} ne reçoit plus de rappel de panier.</p>
           <p class="discret">Vous n'avez rien d'autre à faire.</p>`,
    },
    demande: {
      titre: "Ne plus recevoir de rappel de panier",
      avant: (email) => `<p>Vous êtes sur le point de demander que l'adresse ${email} ne
          reçoive plus de rappel lorsqu'une commande reste en cours.</p>`,
      bouton: "Confirmer",
      apres: `<p class="discret" style="margin-top:20px">Vos commandes, votre compte et la
          lettre d'information ne changent pas : seuls les rappels de panier s'arrêtent.</p>`,
    },
    fait: {
      titre: "C'est fait",
      corps: (email) => `<p>L'adresse ${email} ne recevra plus de rappel de panier.</p>
         <p class="discret">Votre panier reste le vôtre : vous pouvez terminer votre
          commande à tout moment depuis la boutique.</p>`,
    },
  },
  en: {
    exemple: {
      titre: "Example link",
      corps: `<p>This link comes from a test email: it doesn't remove anyone from any list.</p>
           <p class="discret">In a real basket reminder, it stops the reminders in one click.</p>`,
    },
    inconnu: {
      titre: "This link is no longer valid",
      corps: `<p>We don't recognise this link. Your email program may have split it in two.</p>
           <p class="discret">Just reply to our email and we'll stop the reminders ourselves.</p>`,
    },
    inconnuEnvoi: {
      titre: "This link is no longer valid",
      corps: `<p>We don't recognise this link.</p>
           <p class="discret">Just reply to our email and we'll stop the reminders ourselves.</p>`,
    },
    deja: {
      titre: "Already done",
      corps: (email) => `<p>The address ${email} no longer receives basket reminders.</p>
           <p class="discret">There's nothing else you need to do.</p>`,
    },
    demande: {
      titre: "Stop receiving basket reminders",
      avant: (email) => `<p>You're about to ask us to stop sending reminders to ${email} when an order is left unfinished.</p>`,
      bouton: "Confirm",
      apres: `<p class="discret" style="margin-top:20px">Your orders, your account and the newsletter stay as they are: only the basket reminders stop.</p>`,
    },
    fait: {
      titre: "Done",
      corps: (email) => `<p>The address ${email} will no longer receive basket reminders.</p>
         <p class="discret">Your basket is still yours: you can complete your order at any time from the shop.</p>`,
    },
  },
  de: {
    exemple: {
      titre: "Beispiel-Link",
      corps: `<p>Dieser Link stammt aus einer Test-E-Mail: Er trägt niemanden aus einer Liste aus.</p>
           <p class="discret">In einer echten Warenkorb-Erinnerung stoppt er die Erinnerungen mit einem Klick.</p>`,
    },
    inconnu: {
      titre: "Dieser Link ist nicht mehr gültig",
      corps: `<p>Wir erkennen diesen Link nicht. Vielleicht hat Ihr E-Mail-Programm ihn in zwei Teile getrennt.</p>
           <p class="discret">Antworten Sie einfach auf unsere E-Mail: Dann stoppen wir die Erinnerungen von Hand.</p>`,
    },
    inconnuEnvoi: {
      titre: "Dieser Link ist nicht mehr gültig",
      corps: `<p>Wir erkennen diesen Link nicht.</p>
           <p class="discret">Antworten Sie einfach auf unsere E-Mail: Dann stoppen wir die Erinnerungen von Hand.</p>`,
    },
    deja: {
      titre: "Bereits erledigt",
      corps: (email) => `<p>Die Adresse ${email} erhält keine Warenkorb-Erinnerungen mehr.</p>
           <p class="discret">Sie müssen nichts weiter tun.</p>`,
    },
    demande: {
      titre: "Warenkorb-Erinnerungen abbestellen",
      avant: (email) => `<p>Sie möchten, dass die Adresse ${email} keine Erinnerungen mehr erhält, wenn eine Bestellung nicht abgeschlossen wurde.</p>`,
      bouton: "Bestätigen",
      apres: `<p class="discret" style="margin-top:20px">Ihre Bestellungen, Ihr Konto und der Newsletter bleiben unverändert: Nur die Warenkorb-Erinnerungen werden eingestellt.</p>`,
    },
    fait: {
      titre: "Erledigt",
      corps: (email) => `<p>Die Adresse ${email} erhält künftig keine Warenkorb-Erinnerungen mehr.</p>
         <p class="discret">Ihr Warenkorb bleibt erhalten: Sie können Ihre Bestellung jederzeit im Shop abschließen.</p>`,
    },
  },
  it: {
    exemple: {
      titre: "Link di esempio",
      corps: `<p>Questo link viene da un'e-mail di prova: non toglie nessuno da nessuna lista.</p>
           <p class="discret">In un vero promemoria sul carrello, interrompe i promemoria con un clic.</p>`,
    },
    inconnu: {
      titre: "Questo link non è più valido",
      corps: `<p>Non riconosciamo questo link. Forse il tuo programma di posta l'ha spezzato in due.</p>
           <p class="discret">Rispondi semplicemente alla nostra e-mail: interromperemo i promemoria a mano.</p>`,
    },
    inconnuEnvoi: {
      titre: "Questo link non è più valido",
      corps: `<p>Non riconosciamo questo link.</p>
           <p class="discret">Rispondi semplicemente alla nostra e-mail: interromperemo i promemoria a mano.</p>`,
    },
    deja: {
      titre: "Già fatto",
      corps: (email) => `<p>L'indirizzo ${email} non riceve più promemoria sul carrello.</p>
           <p class="discret">Non devi fare nient'altro.</p>`,
    },
    demande: {
      titre: "Non ricevere più promemoria sul carrello",
      avant: (email) => `<p>Stai per chiedere che l'indirizzo ${email} non riceva più promemoria quando un ordine resta in sospeso.</p>`,
      bouton: "Conferma",
      apres: `<p class="discret" style="margin-top:20px">I tuoi ordini, il tuo account e la newsletter non cambiano: si fermano solo i promemoria sul carrello.</p>`,
    },
    fait: {
      titre: "Fatto",
      corps: (email) => `<p>L'indirizzo ${email} non riceverà più promemoria sul carrello.</p>
         <p class="discret">Il tuo carrello resta tuo: puoi completare l'ordine in qualsiasi momento dal negozio.</p>`,
    },
  },
  es: {
    exemple: {
      titre: "Enlace de ejemplo",
      corps: `<p>Este enlace viene de un correo de prueba: no quita a nadie de ninguna lista.</p>
           <p class="discret">En un recordatorio de cesta real, detiene los recordatorios con un clic.</p>`,
    },
    inconnu: {
      titre: "Este enlace ya no es válido",
      corps: `<p>No reconocemos este enlace. Puede que tu programa de correo lo haya cortado en dos.</p>
           <p class="discret">Responde a nuestro correo y detendremos los recordatorios a mano.</p>`,
    },
    inconnuEnvoi: {
      titre: "Este enlace ya no es válido",
      corps: `<p>No reconocemos este enlace.</p>
           <p class="discret">Responde a nuestro correo y detendremos los recordatorios a mano.</p>`,
    },
    deja: {
      titre: "Ya está hecho",
      corps: (email) => `<p>La dirección ${email} ya no recibe recordatorios de la cesta.</p>
           <p class="discret">No tienes que hacer nada más.</p>`,
    },
    demande: {
      titre: "Dejar de recibir recordatorios de la cesta",
      avant: (email) => `<p>Vas a pedir que la dirección ${email} deje de recibir recordatorios cuando un pedido se quede a medias.</p>`,
      bouton: "Confirmar",
      apres: `<p class="discret" style="margin-top:20px">Tus pedidos, tu cuenta y el boletín no cambian: solo se detienen los recordatorios de la cesta.</p>`,
    },
    fait: {
      titre: "Hecho",
      corps: (email) => `<p>La dirección ${email} ya no recibirá recordatorios de la cesta.</p>
         <p class="discret">Tu cesta sigue siendo tuya: puedes terminar tu pedido cuando quieras desde la tienda.</p>`,
    },
  },
};

/**
 * Marque un panier comme RÉCUPÉRÉ : il a été payé après une relance.
 *
 * Appelée au moment du passage en « payée » (configurator-routes.ts). Sans
 * relance envoyée, il n'y a rien à noter : la commande se serait faite de
 * toute façon, et compter celle-là gonflerait le seul chiffre qui doit rester
 * honnête.
 */
export async function noterLaRecuperation(orderId: number): Promise<void> {
  await db
    .update(schema.orders)
    .set({ recoveredAt: new Date() })
    .where(
      and(
        eq(schema.orders.id, orderId),
        isNotNull(schema.orders.reminderSentAt),
        isNull(schema.orders.recoveredAt),
      ),
    );
}
