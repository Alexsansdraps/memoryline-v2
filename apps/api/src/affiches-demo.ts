/**
 * Les affiches de démonstration : des affiches personnalisées AU HASARD, à
 * imprimer d'avance pour un marché, un salon ou une vitrine (BO › Atelier ›
 * Affiches de démonstration).
 *
 * Margaux voulait en imprimer d'avance pour présenter le marché de Noël de
 * Mulhouse, et l'outil doit resservir pour les suivants (Alexandra, 20/11).
 * Elle choisit des affiches, un nombre d'exemplaires pour chacune, une scène
 * (« Varié », « Couple », « Famille »…) et un format ; chaque exemplaire
 * reçoit ses propres personnages, tenues et couleurs, et devient un PDF en
 * haute définition.
 *
 * TROIS TEMPS, et seul le premier se fait pendant la requête :
 *
 *   1. LE TIRAGE (affiches-demo-tirage.ts, un module pur) compose pour chaque
 *      exemplaire une configuration qu'un client aurait pu faire dans le
 *      module. Il est rapide : il se fait quand le lot est créé, et chaque
 *      configuration est ENREGISTRÉE (affiche_demo.config) avant tout rendu.
 *      C'est elle qui fait foi : le PDF n'est qu'un cache, refait à
 *      l'identique après un redémarrage ou un ménage.
 *   2. LE RENDU passe par le moteur des fichiers d'impression SANS le toucher
 *      (aucun fichier de l'empreinte LANCEMENT n'est modifié : sinon tous les
 *      PDF de commandes rangés deviendraient caducs, et jusqu'à 300 seraient
 *      refaits au redémarrage, en plein marché). renderPosterPng, puis
 *      renderImagePdf pour le PDF et sharp pour la vignette : UN rendu à
 *      300 points par pouce pour deux sorties. Aucune commande, aucun panier,
 *      aucun fichier dans cache/impressions — de fausses commandes
 *      fausseraient les numéros, les ventes et les Finances, et retiendraient
 *      fonds et personnages contre la suppression.
 *   3. LE RANGEMENT dans data/assets/cache/affiches-demo/<lot>/<affiche>.pdf
 *      (et .jpg), écrit à côté puis renommé, avec sa taille et son CRC-32 en
 *      base : de quoi servir le .zip du lot en flux (archive-zip.ts). Ce
 *      dossier n'est pas public (/assets ne sert que des fichiers à plat) et
 *      la sauvegarde l'ignore : tout s'y refait depuis la base.
 *
 * UNE AFFICHE À LA FOIS, ET APRÈS LES VENTES. Le serveur a deux cœurs et
 * quatre Go pour le site, la tablette du stand et la base ; un rendu en tient
 * plusieurs centaines de Mo. Un seul ouvrier, donc, qui passe par la file
 * commune des rendus (enFile) en priorité « apercu » : les PDF des ventes du
 * stand (« preparation ») et ceux que le back-office attend (« demande »)
 * passent toujours avant l'affiche suivante, et les vignettes des commandes
 * alternent avec le lot au lieu d'attendre sa fin.
 *
 * L'ÉTAT D'UNE AFFICHE se lit sans jamais attendre le calcul : « prête » (sa
 * taille en base, et le fichier rangé de cette taille), « échec » (la raison,
 * en base), « en attente » / « en cours » (la mémoire de l'ouvrier), sinon
 * « à faire » — ce qui reste après un redémarrage ou un arrêt, et que la
 * reprise remet en file.
 */
import { statSync } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import type { Hono } from "hono";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import sharp from "sharp";
import { posterConfigSchema, type PosterConfig, type PosterFormat } from "@memoryline/types";
import { db, schema } from "./db/client.js";
import { renderImagePdf, renderPosterPng, type ResolveData } from "./pdf.js";
import {
  donneesDImpression,
  enFile,
  fichierDAssetManquant,
  raisonLisible,
} from "./fichiers-impression.js";
import { decorsParLeNom } from "./decors.js";
import { archiveZipDepuisDisque, type FichierSurDisque } from "./archive-zip.js";
import {
  ROLES_DEMO,
  SCENES_DEMO,
  alea,
  graineDemo,
  roleDeCategorie,
  sceneDuRang,
  tirabilite,
  tirerAfficheDemo,
  type AfficheDemo,
  type OptionsDemo,
  type ResumeDemo,
  type SceneChoisie,
  type SceneDemo,
} from "./affiches-demo-tirage.js";

const ASSETS_DIR = resolve(fileURLToPath(import.meta.url), "../../../../data/assets");

/**
 * Le dossier des lots : un sous-dossier par lot, effacé avec lui. Sous
 * cache/, que la sauvegarde ignore : tout s'y refait depuis la base.
 */
const DOSSIER_DEMO = resolve(ASSETS_DIR, "cache", "affiches-demo");

/** Plafonds (décision d'Alexandra, 20/11) : de quoi tenir le disque et la nuit. */
const PLAFOND_PAR_AFFICHE = 10;
const PLAFOND_PAR_LOT = 100;

/**
 * Les essais d'un même tirage. Un essai n'est refusé que si un fichier manque
 * ou si la bibliothèque a changé entre-temps : quelques essais suffisent à
 * passer outre un personnage dont le dessin a disparu du disque.
 */
const ESSAIS_PAR_TIRAGE = 8;

/** Au démarrage, seuls les lots de la semaine reprennent d'eux-mêmes. */
const JOURS_DE_REPRISE = 7;

/**
 * Au-delà, un PDF qui n'a pas servi est effacé, comme ceux des commandes : un
 * lot imprimé pour un marché ne resservira pas tel quel, et il se refait
 * depuis sa configuration le jour où l'on rouvre sa page.
 */
const JOURS_DE_GARDE = 60;

/**
 * Deux minutes après le démarrage : après la préparation des fichiers des
 * commandes (une minute, fichiers-impression.ts), et quand l'API répond déjà.
 */
const DELAI_DE_REPRISE_MS = 2 * 60_000;

/** Comme les vignettes des commandes (apercus.ts) : nette, légère. */
const LARGEUR_VIGNETTE = 600;

/** Blanc (par défaut) ou anthracite : les deux couleurs de texte du choix. */
const COULEURS_TEXTE = ["#FFFFFF", "#2F3436"] as const;
type CouleurTexte = (typeof COULEURS_TEXTE)[number];

/** Les noms d'exemple de la 2e ligne : assez pour varier, pas un annuaire. */
const NOMS_MAX = 200;
const NOM_LONGUEUR_MAX = 60;

const JOUR_MS = 24 * 3600 * 1000;

/** Ce que le back-office affiche d'une affiche du lot. */
export type EtatDemo =
  | { etat: "prete"; taille: number }
  | { etat: "en_attente"; devant: number }
  | { etat: "en_cours"; depuisMs: number }
  | { etat: "echec"; erreur: string }
  | { etat: "a_faire" };

/** La demande d'un lot, telle qu'enregistrée (lot_affiches_demo.demande). */
interface DemandeEnregistree {
  affiches: { productId: number; exemplaires: number }[];
  nomsLigne2: string[];
  couleurTexte: CouleurTexte;
  /** Où la rotation de « Varié » commence pour ce lot (cf. sceneDuRang). */
  depart: number;
}

/* -------------------------------------------------------------------------- */
/*  Les fichiers                                                              */
/* -------------------------------------------------------------------------- */

function dossierDuLot(lotId: number): string {
  return resolve(DOSSIER_DEMO, String(lotId));
}

function fichiersDeLAffiche(lotId: number, afficheId: number): { pdf: string; jpg: string } {
  const dossier = dossierDuLot(lotId);
  return {
    pdf: resolve(dossier, `${afficheId}.pdf`),
    jpg: resolve(dossier, `${afficheId}.jpg`),
  };
}

/**
 * Le PDF rangé d'une affiche, s'il est là ET entier (de la taille notée en
 * base) ; son numéro sur le disque sert au .zip (archive-zip.ts).
 *
 * En SYNCHRONE, exprès : un rendu en cours occupe les fils que Node partage
 * entre toutes ses lectures de fichiers (fichiers-impression.ts, PLACES), et
 * la page du lot pose la question toutes les deux secondes et demie. Cent
 * `stat` asynchrones y feraient la queue derrière le rendu ; synchrones, ils
 * coûtent quelques microsecondes chacun et répondent tout de suite.
 */
function pdfRange(lotId: number, afficheId: number, taille: number): { ino: number } | null {
  try {
    const s = statSync(fichiersDeLAffiche(lotId, afficheId).pdf, { throwIfNoEntry: false });
    return s?.isFile() && s.size === taille ? { ino: s.ino } : null;
  } catch {
    return null;
  }
}

/** Efface les fichiers d'une affiche ; un fichier déjà absent n'est pas une erreur. */
async function effacerLesFichiers(lotId: number, afficheId: number): Promise<void> {
  const { pdf, jpg } = fichiersDeLAffiche(lotId, afficheId);
  await Promise.all([rm(pdf, { force: true }), rm(jpg, { force: true })]);
}

/**
 * Un fichier téléchargé est un fichier qui sert : sa date est rafraîchie, et
 * le ménage (JOURS_DE_GARDE) ne l'efface pas sous les pieds de la boutique.
 * Au mieux : une date qui ne bouge pas ne gêne personne.
 */
function rafraichir(...chemins: string[]): void {
  const maintenant = new Date();
  for (const chemin of chemins) void utimes(chemin, maintenant, maintenant).catch(() => {});
}

/**
 * Le nom ASCII d'un texte, pour un nom de fichier : « MULHOUSE Place de la
 * Réunion » → « mulhouse-place-de-la-reunion ».
 *
 * En ASCII parce que le nom part tel quel dans Content-Disposition (non
 * encodé) et dans le .zip, que l'Explorateur de Windows lit sans le drapeau
 * UTF-8 : un « é » y deviendrait « Ă© ».
 */
function enAscii(texte: string): string {
  return (
    texte
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/œ/g, "oe")
      .replace(/æ/g, "ae")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/, "") || "affiche"
  );
}

/**
 * Le nom du PDF d'une affiche : « mulhouse-place-de-la-reunion_A4_famille_3.pdf ».
 * Le soulignement sépare les morceaux (« famille_animal » devient donc
 * « famille-animal ») ; le rang le rend unique dans le lot, donc dans le .zip.
 */
function nomDeFichier(titre: string, format: PosterFormat, scene: string, rang: number): string {
  return `${enAscii(titre)}_${format}_${scene.replace(/_/g, "-")}_${rang}.pdf`;
}

/* -------------------------------------------------------------------------- */
/*  Ce qu'il faut pour tirer : bibliothèque, affiches, fonds                  */
/* -------------------------------------------------------------------------- */

/**
 * La bibliothèque des personnages, EXACTEMENT celle du module : la route
 * publique GET /characters, appelée en mémoire (Hono, sans réseau). Aucune
 * route existante n'est touchée — en extraire le corps dans une fonction
 * reviendrait à modifier une route en service pendant le marché. Le seul
 * intermédiaire global de l'API est le CORS, sans effet sur un appel interne.
 *
 * Sans ?lang= : les catégories arrivent avec leur nom français, celui que
 * roleDeCategorie sait lire.
 *
 * `vuesATirer` : l'emprise d'un dessin jamais mesuré arrive `null` (la mesure
 * part alors en arrière-plan, emprise-personnages.ts). Avant de tirer pour
 * ces types d'affiche, on relit une fois, trois secondes plus tard : la
 * composition serre la rangée d'après elle, et sans elle elle se fait « à
 * l'aveugle », comme dans le module (EMPRISE_INCONNUE). Sans `vuesATirer`
 * (le catalogue), jamais d'attente.
 */
async function chargerBibliotheque(app: Hono, vuesATirer?: readonly string[]): Promise<unknown> {
  const lire = async (): Promise<unknown> => {
    const reponse = await app.request("/characters");
    if (!reponse.ok)
      throw new Error(`la bibliothèque des personnages n'a pas pu être lue (${reponse.status}).`);
    return reponse.json();
  };
  const bibliotheque = await lire();
  if (!vuesATirer?.length) return bibliotheque;
  const attendus = emprisesAAttendre(bibliotheque, vuesATirer);
  if (!attendus.length) return bibliotheque;
  for (const dessin of attendus) dejaAttendus.add(dessin);
  await new Promise((ok) => setTimeout(ok, 3000));
  return lire().catch(() => bibliotheque);
}

/**
 * Les dessins dont on a déjà attendu la mesure une fois. Une emprise peut
 * rester nulle POUR TOUJOURS : dessin absent du disque (rien à mesurer), ou
 * mesuré sans aucun point visible (le cache retient alors « pas d'emprise »,
 * emprise-personnages.ts). Attendre à chaque lot ces trois secondes
 * n'apporterait rien, et relirait toute la bibliothèque pour rien. Une fois
 * par dessin et par démarrage de l'API : un dessin nouveau, lui, est attendu.
 */
const dejaAttendus = new Set<string>();

/**
 * Les dessins de base dont l'emprise peut ENCORE arriver : personnages
 * proposés pour les types d'affiche à tirer, dessin présent sur le disque,
 * pas encore attendu.
 */
function emprisesAAttendre(bibliotheque: unknown, vues: readonly string[]): string[] {
  const persos = (bibliotheque as { characters?: unknown } | null)?.characters;
  if (!Array.isArray(persos)) return [];
  const dessins = new Set<string>();
  for (const p of persos) {
    const c = p as {
      archived?: boolean;
      active?: boolean;
      orientation?: string;
      baseSvgUrl?: unknown;
      emprise?: unknown;
    } | null;
    if (!c || c.archived || c.active === false || c.emprise != null) continue;
    if (!vues.includes(c.orientation ?? "front") || typeof c.baseSvgUrl !== "string") continue;
    if (dejaAttendus.has(c.baseSvgUrl) || !fichierPresent(c.baseSvgUrl)) continue;
    dessins.add(c.baseSvgUrl);
  }
  return [...dessins];
}

/** Une affiche du catalogue, telle que le tirage en a besoin. */
interface ProduitLu {
  id: number;
  nom: string;
  statut: string;
  genre: string;
  ia: boolean;
  titre: string | null;
  sousTitre: string | null;
  ligne3: string | null;
  /** Le slug de son type d'affiche (« front » à défaut). */
  vue: string;
  /** Le nom de ce type, pour le filtre « Type » de l'écran. */
  vueNom: string;
  /** Le décor d'avant-plan EFFECTIF (muret…), ou null. */
  avantPlan: string | null;
}

/**
 * Les affiches du catalogue (toutes, ou celles demandées), avec leur type.
 *
 * Le décor d'avant-plan suit la règle de la fiche produit (GET
 * /products/:slug) : celui du produit, sinon celui de son type d'affiche. Une
 * valeur vide n'en est pas un — le module ne l'écrit pas dans la
 * configuration, et le PDF retombe alors sur le muret d'une vue de dos.
 */
async function lireLesProduits(ids?: number[]): Promise<ProduitLu[]> {
  if (ids && !ids.length) return [];
  const lignes = await db
    .select({
      id: schema.products.id,
      nom: schema.products.name,
      statut: schema.products.status,
      genre: schema.products.kind,
      ia: schema.products.aiEnabled,
      titre: schema.products.defaultTitle,
      sousTitre: schema.products.defaultSubtitle,
      ligne3: schema.products.defaultLine3,
      vue: schema.products.defaultView,
      avantPlanProduit: schema.products.foregroundUrl,
      avantPlanVue: schema.posterViews.foregroundUrl,
      vueNom: schema.posterViews.name,
    })
    .from(schema.products)
    .leftJoin(schema.posterViews, eq(schema.posterViews.slug, schema.products.defaultView))
    .where(ids ? inArray(schema.products.id, ids) : undefined)
    .orderBy(asc(schema.products.name), asc(schema.products.id));
  return lignes.map((l) => {
    const vue = l.vue || "front";
    return {
      id: l.id,
      nom: l.nom,
      statut: l.statut,
      genre: l.genre,
      ia: l.ia,
      titre: l.titre,
      sousTitre: l.sousTitre,
      ligne3: l.ligne3,
      vue,
      vueNom: l.vueNom || (vue === "front" ? "De face" : vue === "back" ? "De dos" : vue),
      avantPlan: (l.avantPlanProduit ?? l.avantPlanVue ?? null) || null,
    };
  });
}

/**
 * Seules les affiches personnalisables EN LIGNE se tirent : ni les affiches IA
 * (la photo du client, et un appel payant), ni les prêtes à imprimer (rien à
 * tirer), ni les brouillons ou les archivées.
 */
function personnalisableEnLigne(p: ProduitLu): boolean {
  return p.statut === "active" && p.genre === "personnalisable" && !p.ia;
}

interface FondLu {
  id: number;
  url: string;
  name: string | null;
  productId: number | null;
  position: number;
}

/**
 * Les fonds que le module peut proposer : non archivés, et dont l'image est
 * bien sur le disque (même règle que GET /backgrounds). Par position, puis par
 * identifiant pour que deux positions égales gardent toujours le même ordre
 * ICI — le module, lui, ne trie que par position (cf. afficheATirer).
 */
async function lireLesFonds(): Promise<FondLu[]> {
  const fonds = await db
    .select({
      id: schema.backgrounds.id,
      url: schema.backgrounds.url,
      name: schema.backgrounds.name,
      productId: schema.backgrounds.productId,
      position: schema.backgrounds.position,
    })
    .from(schema.backgrounds)
    .where(isNull(schema.backgrounds.archivedAt))
    .orderBy(asc(schema.backgrounds.position), asc(schema.backgrounds.id));
  return fonds.filter((b) => !fichierDAssetManquant(b.url));
}

/**
 * L'affiche telle que le tirage la lit. Ses fonds suivent les deux premières
 * étapes de GET /backgrounds : ceux qui lui sont rattachés, sinon ceux que
 * le nom de sa ville retrouve (decorsParLeNom). PAS la troisième (toute la
 * bibliothèque) : une affiche sans décor à elle n'a rien à montrer sur un
 * stand. On refait le calcul plutôt que d'appeler /backgrounds en mémoire,
 * dont la réponse ne dit pas laquelle des trois étapes a répondu.
 *
 * `decorIncertain` : retrouvés par le nom, seul le premier fond est tiré —
 * celui que le module présélectionne. Mais quand plusieurs partagent la
 * première position, le module ne garantit pas lequel vient en tête (GET
 * /backgrounds ne trie que par position) : « PARIS Tour Eiffel sunset #1 »
 * montrait la place des Vosges, le module la Tour Eiffel au manège
 * (relecture du 20/11). En local, les six affiches dont les fonds viennent du
 * nom étaient dans ce cas. Plutôt qu'un décor pris au hasard des égalités,
 * l'affiche n'est pas tirée, et l'écran dit quoi faire (cf. examiner).
 */
function afficheATirer(p: ProduitLu, fonds: FondLu[]): AfficheDemo & { decorIncertain: boolean } {
  const projeter = (b: FondLu) => ({ id: b.id, url: b.url, nom: b.name ?? "" });
  const rattaches = fonds.filter((b) => b.productId === p.id);
  const trouves = rattaches.length ? [] : decorsParLeNom(p.nom, fonds);
  return {
    productId: p.id,
    nom: p.nom,
    titre: p.titre,
    sousTitre: p.sousTitre,
    ligne3: p.ligne3,
    vue: p.vue,
    avantPlan: p.avantPlan,
    fonds: (rattaches.length ? rattaches : trouves).map(projeter),
    fondsParLeNom: !rattaches.length && trouves.length > 0,
    decorIncertain: trouves.length > 1 && trouves[1]!.position === trouves[0]!.position,
  };
}

/** Ce que l'écran dit d'une affiche dont le décor n'est pas sûr (cf. afficheATirer). */
const RAISON_DECOR_INCERTAIN =
  "Plusieurs décors de sa ville, aucun rattaché à elle ; rattachez le sien sur sa fiche.";

/**
 * Une affiche peut-elle être tirée ? La règle du tirage (tirabilite), plus
 * celle du décor incertain, qui demande la base. Les trois portes — le
 * catalogue, la création d'un lot, « Refaire au hasard » — passent par ici.
 */
function examiner(
  affiche: AfficheDemo & { decorIncertain: boolean },
  bibliotheque: unknown,
): { tirable: boolean; raison: string | null; personnages: number } {
  const verdict = tirabilite(affiche, bibliotheque);
  if (verdict.tirable && affiche.decorIncertain)
    return { tirable: false, raison: RAISON_DECOR_INCERTAIN, personnages: verdict.personnages };
  return verdict;
}

/** « Ce fichier /assets/… est-il sur le disque ? », pour le tirage. */
function fichierPresent(url: string): boolean {
  return typeof url === "string" && url !== "" && !fichierDAssetManquant(url);
}

/**
 * La même question, avec une mémoire le temps d'UNE requête. Un tirage la
 * pose environ soixante-dix fois (dessins des personnages, de leurs pièces,
 * décors), et les affiches d'un lot reviennent sans cesse sur les mêmes
 * fichiers : sous Docker Desktop (Windows), où chaque question coûte
 * quelques millisecondes, cent affiches se tiraient en 18 s, pendant la
 * requête et dans sa transaction ; moins d'une seconde avec la mémoire
 * (mesuré le 20/11). Jamais d'une requête à l'autre : un fichier ajouté ou
 * effacé depuis se voit au tirage suivant.
 */
function fichierPresentMemorise(): (url: string) => boolean {
  const vus = new Map<string, boolean>();
  return (url) => {
    let present = vus.get(url);
    if (present === undefined) {
      present = fichierPresent(url);
      vus.set(url, present);
    }
    return present;
  };
}

/**
 * Une configuration écrite clés triées : la même affiche donne le même texte,
 * qu'elle sorte du tirage ou de la base. JSONB ne garde pas l'ordre des clés,
 * et deux configurations identiques s'écrivaient différemment.
 */
function canonique(valeur: unknown): string {
  return JSON.stringify(valeur, (_cle, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : v,
  );
}

/** Une raison de refus, glissée dans une phrase après « : ». */
function enMinuscule(raison: string | null | undefined): string {
  const r = (raison ?? "").trim() || "elle n'a rien à tirer au hasard.";
  return r.charAt(0).toLocaleLowerCase("fr-FR") + r.slice(1);
}

/**
 * Tire UN exemplaire, en quelques essais (cf. ESSAIS_PAR_TIRAGE). Chaque essai
 * a sa graine — le lot, le rang, le numéro d'essai —, si bien qu'un tirage se
 * rejoue à l'identique ; `eviter` (une configuration passée par canonique)
 * écarte celle qu'on a déjà : « Refaire au hasard » ne rend jamais la même
 * affiche. `present` : fichierPresentMemorise(), une par requête.
 */
function tirerUnExemplaire(
  affiche: AfficheDemo,
  bibliotheque: unknown,
  options: OptionsDemo,
  lotId: number,
  rang: number,
  premierEssai: number,
  present: (url: string) => boolean,
  eviter?: string,
): { config: PosterConfig; resume: ResumeDemo } | { refus: string } {
  let refus = "aucun tirage n'a abouti.";
  for (let k = 0; k < ESSAIS_PAR_TIRAGE; k++) {
    try {
      const tire = tirerAfficheDemo(
        affiche,
        bibliotheque,
        options,
        alea(graineDemo(lotId, rang, premierEssai + k)),
        present,
      );
      if ("refus" in tire) {
        refus = tire.refus;
        continue;
      }
      // Le tirage valide déjà sa configuration ; on garde ce que le schéma
      // en fait, comme pour une ligne de commande.
      const valide = posterConfigSchema.safeParse(tire.config);
      if (!valide.success) {
        refus = "la configuration tirée n'est pas valide.";
        continue;
      }
      if (eviter !== undefined && canonique(valide.data) === eviter) continue;
      return { config: valide.data, resume: tire.resume };
    } catch (e) {
      console.error(`[affiches démo] tirage de « ${affiche.nom} » :`, e);
      refus = "le tirage a échoué.";
    }
  }
  return { refus };
}

/* -------------------------------------------------------------------------- */
/*  L'ouvrier                                                                 */
/* -------------------------------------------------------------------------- */

interface Travail {
  afficheId: number;
  lotId: number;
  /**
   * Demandé pour CETTE affiche (« Refaire au hasard ») : il part même si le
   * lot est arrêté. La reprise d'un lot, elle, ne force rien.
   */
  force: boolean;
}

/** Ce qui attend l'ouvrier, dans l'ordre : celui du lot, affiche par affiche. */
const file: Travail[] = [];

/**
 * L'affiche que l'ouvrier a prise, dès qu'il la sort de la file. `lancee`
 * reste nulle tant que son rendu attend son tour dans la file commune (une
 * vente du stand, un PDF demandé passent avant) : c'est ce qui distingue « en
 * attente » de « en cours ».
 * `annulee` : retirée (lot arrêté ou supprimé, affiche retirée ou retirée au
 * hasard) avant que son rendu ne parte ; il ne partira pas.
 */
interface EnMain extends Travail {
  lancee: number | null;
  annulee: boolean;
}
let enMain: EnMain | null = null;
let ouvrierActif = false;

/** Range des affiches dans la file, sans doublon ; l'ouvrier part s'il dormait. */
function mettreEnFile(travaux: Travail[]): void {
  for (const t of travaux) {
    const deja = file.find((f) => f.afficheId === t.afficheId);
    if (deja) {
      // Déjà en file : une demande expresse la fait partir même lot arrêté.
      if (t.force) deja.force = true;
      continue;
    }
    // Déjà entre les mains de l'ouvrier : seule une demande expresse la
    // remet en file (son rendu en cours est celui d'une configuration
    // remplacée, qu'il jettera — cf. ranger).
    if (!t.force && enMain && !enMain.annulee && enMain.afficheId === t.afficheId) continue;
    file.push({ ...t });
  }
  lancerOuvrier();
}

/**
 * Retire de la file ce qui ne doit plus partir. L'affiche entre les mains de
 * l'ouvrier est annulée si son rendu n'a pas commencé ; commencé, il va à son
 * terme (rien ne l'interrompt), et son résultat est jeté s'il ne correspond
 * plus à rien (cf. ranger).
 */
function retirerDeLaFile(doitPartir: (t: Travail) => boolean): void {
  for (let i = file.length - 1; i >= 0; i--) if (doitPartir(file[i]!)) file.splice(i, 1);
  if (enMain && enMain.lancee === null && doitPartir(enMain)) enMain.annulee = true;
}

/**
 * L'ouvrier : une affiche, puis la suivante. Jamais deux rendus du lot à la
 * fois : chacun prend la place que la file commune garde à « ce qui peut
 * attendre » (fichiers-impression.ts, pomper), et ce qui y arrive entre deux
 * affiches — un PDF de vente du stand — passe avant la suivante.
 */
function lancerOuvrier(): void {
  if (ouvrierActif || !file.length) return;
  ouvrierActif = true;
  void (async () => {
    try {
      while (file.length) {
        const travail = file.shift()!;
        await fabriquer(travail).catch((e) =>
          console.error(`[affiches démo] affiche ${travail.afficheId} :`, e),
        );
        // Laisse respirer le fil principal avant la suivante.
        await new Promise((ok) => setImmediate(ok));
      }
    } finally {
      ouvrierActif = false;
      // Le lot fini, les données du rendu s'oublient : la prochaine affiche
      // (« Refaire au hasard » demain) relira les personnages du moment.
      donneesEnCache = null;
    }
  })();
}

/**
 * Les données du rendu (personnages, pièces, fonds, signature), lues UNE fois
 * par lot : ce sont les mêmes pour toutes ses affiches, et les relire à
 * chacune coûterait trois grosses requêtes par affiche. Dix minutes au plus,
 * pour qu'un réglage changé au back-office pendant un long lot finisse par
 * s'y voir.
 *
 * La signature de la boutique reste, comme sur les affiches vendues
 * (décision d'Alexandra) : une affiche montrée sur le stand est celle que le
 * client recevra.
 */
let donneesEnCache: { lotId: number; depuis: number; promesse: Promise<ResolveData> } | null =
  null;

function donneesDuLot(lotId: number): Promise<ResolveData> {
  if (
    !donneesEnCache ||
    donneesEnCache.lotId !== lotId ||
    Date.now() - donneesEnCache.depuis > 10 * 60_000
  ) {
    const promesse = donneesDImpression();
    const entree = { lotId, depuis: Date.now(), promesse };
    // Un échec de lecture ne reste pas en cache : l'affiche suivante relit.
    promesse.catch(() => {
      if (donneesEnCache === entree) donneesEnCache = null;
    });
    donneesEnCache = entree;
  }
  return donneesEnCache.promesse;
}

/** Le résultat d'un rendu, prêt à ranger. */
interface Rendu {
  pdf: Buffer;
  vignette: Buffer;
  dureeMs: number;
}

/**
 * Fabrique une affiche : son PDF et sa vignette, d'un seul rendu.
 *
 * Jamais d'exception qui s'échappe : un échec s'écrit sur l'affiche (sa
 * raison, dite pour la boutique), et l'ouvrier passe à la suivante.
 */
async function fabriquer(travail: Travail): Promise<void> {
  // Tenue AVANT de lire la base : sortie de la file, l'affiche n'était nulle
  // part le temps de cette lecture, et son état la disait « à faire ». Une
  // page de lot ouverte à cet instant (sa première question porte
  // ?reprendre=1) la remettait en file, et elle se fabriquait deux fois.
  const main: EnMain = { ...travail, lancee: null, annulee: false };
  enMain = main;
  let tirage: number | null = null;
  try {
    const [ligne] = await db
      .select({
        config: schema.affichesDemo.config,
        tirage: schema.affichesDemo.tirage,
        lotId: schema.affichesDemo.lotId,
        format: schema.lotsAffichesDemo.format,
        arrete: schema.lotsAffichesDemo.arrete,
      })
      .from(schema.affichesDemo)
      .innerJoin(schema.lotsAffichesDemo, eq(schema.lotsAffichesDemo.id, schema.affichesDemo.lotId))
      .where(eq(schema.affichesDemo.id, travail.afficheId));
    // Retirée du lot, lot arrêté ou affiche retirée de la file entre-temps.
    if (!ligne || (ligne.arrete && !travail.force) || main.annulee) return;
    tirage = ligne.tirage;
    const format: PosterFormat = ligne.format === "A3" ? "A3" : "A4";
    const donnees = await donneesDuLot(ligne.lotId);
    if (main.annulee) return;
    const rendu = await enFile("apercu", async (): Promise<Rendu | null> => {
      // Ce travail ne s'exécute qu'au DÉPART réel du rendu : l'affiche a pu
      // être retirée pendant qu'elle attendait son tour.
      if (main.annulee) return null;
      const lancee = Date.now();
      main.lancee = lancee;
      const png = await renderPosterPng(ligne.config, { data: donnees, format });
      // Le PNG RVB à 300 points par pouce, posé tel quel dans une page aux
      // dimensions exactes du format : c'est le PDF d'une commande.
      const pdf = await renderImagePdf(png, format);
      const vignette = await sharp(png)
        .resize({ width: LARGEUR_VIGNETTE })
        .jpeg({ quality: 78, mozjpeg: true })
        .toBuffer();
      return { pdf, vignette, dureeMs: Date.now() - lancee };
    });
    if (!rendu) return;
    await ranger(travail.afficheId, ligne.lotId, ligne.tirage, rendu);
  } catch (e) {
    console.error(`[affiches démo] affiche ${travail.afficheId} :`, e);
    // La base n'a pas répondu : rien à noter, l'affiche reste « à faire ».
    if (tirage === null) return;
    // Seulement si c'est toujours la même configuration : un échec de
    // l'ancienne ne doit pas s'afficher sur la nouvelle.
    await db
      .update(schema.affichesDemo)
      .set({ erreur: raisonLisible(e), taille: null, crc32: null })
      .where(
        and(
          eq(schema.affichesDemo.id, travail.afficheId),
          eq(schema.affichesDemo.tirage, tirage),
        ),
      )
      .catch((err) => console.error("[affiches démo] échec non noté :", err));
  } finally {
    if (enMain === main) enMain = null;
  }
}

/**
 * Range le PDF et la vignette d'une affiche, puis le dit en base.
 *
 * Écrits à côté puis renommés : un téléchargement qui lirait le fichier
 * pendant l'écriture recevrait un PDF tronqué. La base n'annonce « prête »
 * qu'une fois le fichier en place, avec sa taille et son CRC-32 — et
 * seulement pour la configuration rendue (`tirage`) : retirée du lot, lot
 * supprimé ou affiche retirée au hasard pendant le rendu, ce PDF ne
 * correspond plus à rien, et il est effacé.
 */
async function ranger(afficheId: number, lotId: number, tirage: number, rendu: Rendu): Promise<void> {
  const { pdf, jpg } = fichiersDeLAffiche(lotId, afficheId);
  await mkdir(dossierDuLot(lotId), { recursive: true });
  const suffixe = `.${process.pid}.tmp`;
  try {
    await writeFile(jpg + suffixe, rendu.vignette);
    await writeFile(pdf + suffixe, rendu.pdf);
    await rename(jpg + suffixe, jpg);
    await rename(pdf + suffixe, pdf);
  } catch (e) {
    await Promise.all([rm(jpg + suffixe, { force: true }), rm(pdf + suffixe, { force: true })]);
    throw e;
  }
  const [faite] = await db
    .update(schema.affichesDemo)
    .set({
      taille: rendu.pdf.length,
      crc32: crc32(rendu.pdf) >>> 0,
      dureeMs: rendu.dureeMs,
      erreur: null,
      faitLe: new Date(),
    })
    .where(and(eq(schema.affichesDemo.id, afficheId), eq(schema.affichesDemo.tirage, tirage)))
    .returning({ id: schema.affichesDemo.id });
  if (!faite) {
    await effacerLesFichiers(lotId, afficheId);
    // Le dossier d'un lot supprimé pendant le rendu, recréé pour l'écrire :
    // vide, il part (rmdir refuse un dossier qui a encore des fichiers).
    await rmdir(dossierDuLot(lotId)).catch(() => {});
    return;
  }
  void menage();
}

/* -------------------------------------------------------------------------- */
/*  Les états                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Ce que la mémoire de l'ouvrier sait des affiches : en cours, ou en attente
 * (et combien passeront avant). Calculé une fois par question, pour tout le
 * lot.
 *
 * `devant`, tel que la page d'un lot le lit (affiches-demo-textes.ts) : 0 pour
 * l'affiche que l'ouvrier tient sans l'avoir lancée — elle attend une place
 * dans la file commune, où les ventes du stand et les PDF demandés passent
 * d'abord (ou pour la première de la file, l'instant où l'ouvrier passe d'une
 * affiche à la suivante) ; pour les autres, le nombre d'affiches de
 * démonstration, TOUS LOTS CONFONDUS, qui partiront avant elle.
 */
function etatsEnMemoire(): Map<number, EtatDemo> {
  const etats = new Map<number, EtatDemo>();
  const tenue = enMain && !enMain.annulee ? enMain : null;
  if (tenue)
    etats.set(
      tenue.afficheId,
      tenue.lancee === null
        ? // Prise par l'ouvrier, elle attend une place dans la file commune :
          // une vente du stand ou un PDF demandé passe avant.
          { etat: "en_attente", devant: 0 }
        : { etat: "en_cours", depuisMs: Date.now() - tenue.lancee },
    );
  file.forEach((t, i) => {
    if (!etats.has(t.afficheId))
      etats.set(t.afficheId, { etat: "en_attente", devant: i + (tenue ? 1 : 0) });
  });
  return etats;
}

/**
 * Oublie en base un PDF qui n'est plus sur le disque (ménage, disque effacé
 * à la main) : l'affiche redevient « à faire », et la reprise la refait. Au
 * mieux, et seulement si rien n'a bougé entre-temps (même taille notée).
 */
function oublierLePdf(afficheId: number, taille: number): void {
  void db
    .update(schema.affichesDemo)
    .set({ taille: null, crc32: null })
    .where(and(eq(schema.affichesDemo.id, afficheId), eq(schema.affichesDemo.taille, taille)))
    .catch(() => {});
}

interface LigneDEtat {
  id: number;
  taille: number | null;
  erreur: string | null;
}

/** L'état d'une affiche, sans jamais attendre un calcul. */
function etatDe(ligne: LigneDEtat, lotId: number, memoire: Map<number, EtatDemo>): EtatDemo {
  const enCours = memoire.get(ligne.id);
  if (enCours) return enCours;
  if (ligne.taille !== null) {
    if (pdfRange(lotId, ligne.id, ligne.taille)) return { etat: "prete", taille: ligne.taille };
    oublierLePdf(ligne.id, ligne.taille);
    return { etat: "a_faire" };
  }
  if (ligne.erreur) return { etat: "echec", erreur: ligne.erreur };
  return { etat: "a_faire" };
}

/**
 * Remet en file les affiches « à faire » d'un lot : jamais faites (un
 * redémarrage pendant le lot), ou dont le PDF a disparu. Ni celles en échec
 * (« Reprendre » les relance exprès), ni celles déjà entre les mains de
 * l'ouvrier. Renvoie combien sont reparties.
 */
async function reprendreLeLot(lotId: number): Promise<number> {
  const lignes = await db
    .select({
      id: schema.affichesDemo.id,
      taille: schema.affichesDemo.taille,
      erreur: schema.affichesDemo.erreur,
    })
    .from(schema.affichesDemo)
    .where(eq(schema.affichesDemo.lotId, lotId))
    .orderBy(asc(schema.affichesDemo.rang), asc(schema.affichesDemo.id));
  const memoire = etatsEnMemoire();
  const aFaire = lignes.filter((l) => etatDe(l, lotId, memoire).etat === "a_faire");
  mettreEnFile(aFaire.map((l) => ({ afficheId: l.id, lotId, force: false })));
  return aFaire.length;
}

/** La durée moyenne d'un rendu, sur les plus récents (d'un lot, ou de tous). */
async function dureeMoyenne(format: string, lotId?: number): Promise<number | null> {
  const lignes = await db
    .select({ duree: schema.affichesDemo.dureeMs })
    .from(schema.affichesDemo)
    .innerJoin(schema.lotsAffichesDemo, eq(schema.lotsAffichesDemo.id, schema.affichesDemo.lotId))
    .where(
      and(
        eq(schema.lotsAffichesDemo.format, format),
        isNotNull(schema.affichesDemo.dureeMs),
        lotId === undefined ? undefined : eq(schema.affichesDemo.lotId, lotId),
      ),
    )
    .orderBy(desc(schema.affichesDemo.faitLe))
    .limit(30);
  if (!lignes.length) return null;
  return Math.round(lignes.reduce((s, l) => s + (l.duree ?? 0), 0) / lignes.length);
}

/* -------------------------------------------------------------------------- */
/*  Reprise au démarrage et ménage                                            */
/* -------------------------------------------------------------------------- */

/**
 * Au démarrage de l'API, les lots de la semaine reprennent là où ils en
 * étaient : la mémoire de l'ouvrier s'est perdue avec le redémarrage (une
 * mise en ligne, un serveur relancé), pas les configurations. Deux minutes
 * après, et une affiche à la fois, après tout le reste.
 */
export function demarrerAffichesDemo(): void {
  const minuterie = setTimeout(() => void reprendreAuDemarrage(), DELAI_DE_REPRISE_MS);
  minuterie.unref?.();
}

async function reprendreAuDemarrage(): Promise<void> {
  try {
    void menage();
    const depuis = new Date(Date.now() - JOURS_DE_REPRISE * JOUR_MS);
    const lots = await db
      .select({ id: schema.lotsAffichesDemo.id })
      .from(schema.lotsAffichesDemo)
      .where(
        and(
          eq(schema.lotsAffichesDemo.arrete, false),
          gte(schema.lotsAffichesDemo.creeLe, depuis),
        ),
      )
      .orderBy(asc(schema.lotsAffichesDemo.id));
    let reparties = 0;
    for (const lot of lots) reparties += await reprendreLeLot(lot.id);
    if (reparties)
      console.log(
        `[affiches démo] ${reparties} affiche${reparties > 1 ? "s" : ""} de démonstration remise${reparties > 1 ? "s" : ""} en fabrication`,
      );
  } catch (e) {
    console.error("[affiches démo] reprise interrompue :", e);
  }
}

/**
 * Le ménage, une fois par jour au plus, à l'occasion d'un rangement ou du
 * démarrage (pas de minuterie à entretenir) :
 *   - le dossier d'un lot qui n'existe plus en base part en entier ;
 *   - un PDF (et sa vignette) qui n'a pas servi depuis JOURS_DE_GARDE jours
 *     est effacé, et l'affiche redevient « à faire » : sa configuration
 *     reste, elle se refera si l'on rouvre le lot ;
 *   - un fichier provisoire de plus d'une heure (un rendu interrompu par un
 *     redémarrage) est effacé.
 * Le ménage des fichiers d'impression (fichiers-impression.ts) ne regarde pas
 * ce dossier.
 */
let dernierMenage = 0;
async function menage(): Promise<void> {
  const maintenant = Date.now();
  if (maintenant - dernierMenage < JOUR_MS) return;
  dernierMenage = maintenant;
  try {
    let dossiers: string[];
    try {
      dossiers = await readdir(DOSSIER_DEMO);
    } catch {
      return; // pas encore de dossier : rien à ranger
    }
    const lots = new Set(
      (await db.select({ id: schema.lotsAffichesDemo.id }).from(schema.lotsAffichesDemo)).map(
        (l) => l.id,
      ),
    );
    const limite = maintenant - JOURS_DE_GARDE * JOUR_MS;
    const perimes: number[] = [];
    for (const nom of dossiers) {
      if (!/^\d+$/.test(nom)) continue; // pas un dossier de lot : on n'y touche pas
      const dossier = resolve(DOSSIER_DEMO, nom);
      if (!lots.has(Number(nom))) {
        await rm(dossier, { recursive: true, force: true });
        continue;
      }
      for (const fichier of await readdir(dossier).catch(() => [] as string[])) {
        const chemin = resolve(dossier, fichier);
        const s = await stat(chemin).catch(() => null);
        if (!s?.isFile()) continue;
        const provisoire = fichier.endsWith(".tmp");
        if (s.mtimeMs >= (provisoire ? maintenant - 3600_000 : limite)) continue;
        await rm(chemin, { force: true });
        const pdf = /^(\d+)\.pdf$/.exec(fichier);
        if (pdf) perimes.push(Number(pdf[1]));
      }
    }
    if (perimes.length)
      await db
        .update(schema.affichesDemo)
        .set({ taille: null, crc32: null })
        .where(inArray(schema.affichesDemo.id, perimes));
  } catch (e) {
    console.warn("[affiches démo] ménage interrompu :", e);
  }
}

/* -------------------------------------------------------------------------- */
/*  La demande d'un lot                                                       */
/* -------------------------------------------------------------------------- */

interface DemandeLue {
  format: PosterFormat;
  scene: SceneChoisie;
  /** Par affiche, dans l'ordre du tableau ; jamais zéro exemplaire. */
  affiches: { productId: number; exemplaires: number }[];
  total: number;
  nomsLigne2: string[];
  couleurTexte: CouleurTexte;
}

/** La demande, vérifiée ; ou la phrase qui dit ce qui ne va pas. */
function lireLaDemande(brut: unknown): DemandeLue | { erreur: string } {
  const corps = (brut && typeof brut === "object" ? brut : {}) as Record<string, unknown>;

  const format = corps.format === undefined || corps.format === null ? "A4" : corps.format;
  if (format !== "A4" && format !== "A3") return { erreur: "Choisissez le format : A4 ou A3." };

  const scene = corps.scene === undefined || corps.scene === null ? "varie" : corps.scene;
  const sceneConnue = SCENES_DEMO.find((s) => s.cle === scene);
  if (!sceneConnue) return { erreur: "Choisissez les personnages parmi les scènes proposées." };

  const couleur = String(corps.couleurTexte ?? "#FFFFFF").toUpperCase();
  const couleurTexte = COULEURS_TEXTE.find((c) => c === couleur);
  if (!couleurTexte) return { erreur: "Choisissez la couleur du texte : blanc ou anthracite." };

  const parAffiche = new Map<number, number>();
  for (const a of Array.isArray(corps.affiches) ? corps.affiches : []) {
    const ligne = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
    const productId = Number(ligne.productId);
    const exemplaires = Number(ligne.exemplaires ?? 0);
    if (!Number.isInteger(productId) || productId <= 0 || productId > 2_147_483_647)
      return { erreur: "Une des affiches choisies n'existe pas : rechargez la page." };
    if (!Number.isInteger(exemplaires) || exemplaires < 0)
      return {
        erreur: `Le nombre d'exemplaires est un nombre entier, de 0 à ${PLAFOND_PAR_AFFICHE}.`,
      };
    if (exemplaires === 0) continue;
    parAffiche.set(productId, (parAffiche.get(productId) ?? 0) + exemplaires);
  }
  if ([...parAffiche.values()].some((n) => n > PLAFOND_PAR_AFFICHE))
    return { erreur: `${PLAFOND_PAR_AFFICHE} exemplaires au plus par affiche.` };
  const total = [...parAffiche.values()].reduce((s, n) => s + n, 0);
  if (total === 0)
    return { erreur: "Choisissez au moins une affiche : mettez un nombre d'exemplaires en face." };
  if (total > PLAFOND_PAR_LOT)
    return {
      erreur:
        `Un lot compte au plus ${PLAFOND_PAR_LOT} affiches ; vous en demandez ${total}. ` +
        (total <= 2 * PLAFOND_PAR_LOT ? "Faites-en deux." : "Faites-en plusieurs."),
    };

  // Les noms d'exemple : un par ligne à l'écran, une liste ici. Une seule
  // chaîne est acceptée aussi, coupée à chaque retour à la ligne.
  const brutsNoms = Array.isArray(corps.nomsLigne2)
    ? corps.nomsLigne2
    : typeof corps.nomsLigne2 === "string"
      ? corps.nomsLigne2.split(/\r?\n/)
      : [];
  const nomsLigne2 = [
    ...new Set(
      brutsNoms
        .filter((n): n is string => typeof n === "string")
        .map((n) => n.replace(/\s+/g, " ").trim().slice(0, NOM_LONGUEUR_MAX).trim())
        .filter(Boolean),
    ),
  ].slice(0, NOMS_MAX);

  return {
    format,
    scene: sceneConnue.cle,
    affiches: [...parAffiche].map(([productId, exemplaires]) => ({ productId, exemplaires })),
    total,
    nomsLigne2,
    couleurTexte,
  };
}

/** Refus d'un lot dont aucune affiche n'a pu être tirée (annule l'écriture). */
class AucuneAffiche extends Error {}

/* -------------------------------------------------------------------------- */
/*  Les routes                                                                */
/* -------------------------------------------------------------------------- */

/** Un identifiant d'URL : un entier positif qui tient dans une colonne integer. */
function identifiant(brut: string | undefined): number | null {
  const n = Number(brut);
  return Number.isInteger(n) && n > 0 && n <= 2_147_483_647 ? n : null;
}

export function mountAffichesDemo(app: Hono): void {
  /*
   * Réservé à la propriétaire. La garde de « /admin/* » (index.ts) le fait
   * déjà — ce chemin n'est dans aucune lecture permise à un vendeur — ; la
   * redire ici coûte une ligne, et la règle ne tient plus à une liste tenue
   * ailleurs.
   */
  app.use("/admin/affiches-demo/*", async (c, next) => {
    if (c.get("utilisateur")?.role !== "owner")
      return c.json(
        { error: "Les affiches de démonstration sont réservées à la propriétaire." },
        403,
      );
    await next();
  });

  /**
   * Ce que l'écran propose : les affiches personnalisables en ligne, chacune
   * avec ce qui permet (ou non) de la tirer, les scènes, la correspondance
   * des rôles avec les catégories de personnages (un renommage qui ferait
   * tomber une catégorie en « Autres » se voit), les plafonds, et la durée
   * moyenne d'un rendu pour annoncer l'attente.
   */
  app.get("/admin/affiches-demo/catalogue", async (c) => {
    const [bibliotheque, produits, fonds, images, collections, categories, a4, a3] =
      await Promise.all([
        chargerBibliotheque(app).catch(() => null),
        lireLesProduits(),
        lireLesFonds(),
        db
          .select({ productId: schema.productImages.productId, url: schema.productImages.url })
          .from(schema.productImages)
          .orderBy(
            asc(schema.productImages.productId),
            asc(schema.productImages.position),
            asc(schema.productImages.id),
          ),
        db
          .select({
            productId: schema.productCollections.productId,
            nom: schema.collections.name,
          })
          .from(schema.productCollections)
          .innerJoin(
            schema.collections,
            eq(schema.collections.id, schema.productCollections.collectionId),
          )
          .where(isNull(schema.collections.archivedAt))
          .orderBy(asc(schema.collections.position), asc(schema.collections.name)),
        db
          .select({ nom: schema.characterCategories.name })
          .from(schema.characterCategories)
          .where(isNull(schema.characterCategories.archivedAt))
          .orderBy(asc(schema.characterCategories.position), asc(schema.characterCategories.id)),
        dureeMoyenne("A4"),
        dureeMoyenne("A3"),
      ]);

    // La première image de chaque fiche, en chemin « /assets/… » : le
    // back-office la sert en vignette (?l=200).
    const imageDe = new Map<number, string>();
    for (const i of images)
      if (!imageDe.has(i.productId) && i.url.startsWith("/assets/")) imageDe.set(i.productId, i.url);
    const collectionsDe = new Map<number, string[]>();
    for (const l of collections) {
      const noms = collectionsDe.get(l.productId) ?? [];
      noms.push(l.nom);
      collectionsDe.set(l.productId, noms);
    }

    const affiches = produits.filter(personnalisableEnLigne).map((p) => {
      const affiche = afficheATirer(p, fonds);
      let verdict: { tirable: boolean; raison: string | null; personnages: number };
      try {
        verdict = examiner(affiche, bibliotheque);
      } catch (e) {
        console.error(`[affiches démo] « ${p.nom} » :`, e);
        verdict = { tirable: false, raison: "Elle n'a pas pu être examinée.", personnages: 0 };
      }
      return {
        productId: p.id,
        nom: p.nom,
        image: imageDe.get(p.id) ?? null,
        collections: collectionsDe.get(p.id) ?? [],
        vue: p.vue,
        vueNom: p.vueNom,
        // Les décors entre lesquels le tirage choisit. Retrouvés par le nom de
        // la ville, seul le premier sert (celui que le module présélectionne) ;
        // à égalité en tête, aucun ne sert, et l'écran dit combien il en a
        // trouvé, à côté de la raison (cf. examiner).
        decors:
          affiche.fondsParLeNom && !affiche.decorIncertain
            ? Math.min(1, affiche.fonds.length)
            : affiche.fonds.length,
        decorsParLeNom: affiche.fondsParLeNom,
        personnages: verdict.personnages,
        tirable: verdict.tirable,
        raison: verdict.tirable ? null : verdict.raison,
      };
    });

    return c.json({
      affiches,
      scenes: SCENES_DEMO,
      roles: ROLES_DEMO.map((r) => ({
        role: r.role,
        libelle: r.libelle,
        categories: categories.filter((k) => roleDeCategorie(k.nom) === r.role).map((k) => k.nom),
      })),
      plafonds: { parAffiche: PLAFOND_PAR_AFFICHE, parLot: PLAFOND_PAR_LOT },
      dureeMoyenneMs: { A4: a4, A3: a3 },
    });
  });

  /**
   * L'historique des lots, du plus récent au plus ancien. Les comptes viennent
   * de la base (une affiche est prête quand sa taille y est notée) : la page
   * d'un lot, elle, vérifie chaque fichier.
   */
  app.get("/admin/affiches-demo/lots", async (c) => {
    const lots = await db
      .select({
        id: schema.lotsAffichesDemo.id,
        creeLe: schema.lotsAffichesDemo.creeLe,
        format: schema.lotsAffichesDemo.format,
        scene: schema.lotsAffichesDemo.scene,
        arrete: schema.lotsAffichesDemo.arrete,
        total: sql<number>`count(${schema.affichesDemo.id})`.mapWith(Number),
        pretes: sql<number>`count(${schema.affichesDemo.id}) filter (where ${schema.affichesDemo.taille} is not null)`.mapWith(
          Number,
        ),
        echecs: sql<number>`count(${schema.affichesDemo.id}) filter (where ${schema.affichesDemo.taille} is null and ${schema.affichesDemo.erreur} is not null)`.mapWith(
          Number,
        ),
        taille: sql<number>`coalesce(sum(${schema.affichesDemo.taille}), 0)`.mapWith(Number),
      })
      .from(schema.lotsAffichesDemo)
      .leftJoin(schema.affichesDemo, eq(schema.affichesDemo.lotId, schema.lotsAffichesDemo.id))
      .groupBy(schema.lotsAffichesDemo.id)
      .orderBy(desc(schema.lotsAffichesDemo.id))
      .limit(200);
    return c.json({
      lots: lots.map((l) => ({
        id: l.id,
        creeLe: l.creeLe.toISOString(),
        format: l.format === "A3" ? "A3" : "A4",
        scene: l.scene as SceneChoisie,
        total: l.total,
        pretes: l.pretes,
        echecs: l.echecs,
        taille: l.taille,
        arrete: l.arrete,
      })),
    });
  });

  /**
   * Crée un lot : chaque exemplaire est TIRÉ ici, et sa configuration
   * enregistrée ; les rendus partent ensuite en file, un à un, sans que la
   * requête les attende.
   *
   * Une affiche qui ne peut pas être tirée (plus de décor, plus au catalogue,
   * passée en IA depuis l'ouverture de la page) est écartée et nommée dans la
   * réponse ; le lot se fait avec les autres. Aucune : rien n'est écrit, et la
   * raison est dite.
   */
  app.post("/admin/affiches-demo/lots", async (c) => {
    const demande = lireLaDemande(await c.req.json().catch(() => null));
    if ("erreur" in demande) return c.json({ error: demande.erreur }, 400);

    const ids = demande.affiches.map((a) => a.productId);
    const [produits, fonds] = await Promise.all([lireLesProduits(ids), lireLesFonds()]);
    const produitDe = new Map(produits.map((p) => [p.id, p]));
    let bibliotheque: unknown;
    try {
      // Les types d'affiche du lot : seules leurs emprises valent d'attendre.
      bibliotheque = await chargerBibliotheque(app, [...new Set(produits.map((p) => p.vue))]);
    } catch (e) {
      console.error("[affiches démo] bibliothèque :", e);
      return c.json(
        { error: "La bibliothèque des personnages n'a pas pu être lue : réessayez dans un instant." },
        503,
      );
    }

    const ecartees: { productId: number; nom: string; raison: string }[] = [];
    const aTirer: { affiche: AfficheDemo; exemplaires: number }[] = [];
    for (const { productId, exemplaires } of demande.affiches) {
      const p = produitDe.get(productId);
      if (!p) {
        ecartees.push({ productId, nom: `n° ${productId}`, raison: "Elle n'est plus au catalogue." });
        continue;
      }
      if (!personnalisableEnLigne(p)) {
        ecartees.push({
          productId,
          nom: p.nom,
          raison: "Ce n'est plus une affiche personnalisable en ligne.",
        });
        continue;
      }
      const affiche = afficheATirer(p, fonds);
      const verdict = examiner(affiche, bibliotheque);
      if (!verdict.tirable) {
        ecartees.push({ productId, nom: p.nom, raison: verdict.raison ?? "Rien à tirer au hasard." });
        continue;
      }
      aTirer.push({ affiche, exemplaires });
    }

    let lotId: number;
    let total: number;
    try {
      ({ lotId, total } = await db.transaction(async (tx) => {
        const [lot] = await tx
          .insert(schema.lotsAffichesDemo)
          .values({
            creePar: c.get("utilisateur")?.email ?? null,
            format: demande.format,
            scene: demande.scene,
            demande: {},
          })
          .returning({ id: schema.lotsAffichesDemo.id });
        const id = lot!.id;
        // Où la rotation de « Varié » commence : tiré une fois par lot (sans
        // quoi tous les lots commenceraient par la même scène), à la graine
        // du lot pour pouvoir le rejouer. Le rang 0 n'est celui d'aucune
        // affiche.
        const depart = Math.floor(alea(graineDemo(id, 0, 0))() * 1000);
        const enregistree: DemandeEnregistree = {
          affiches: demande.affiches,
          nomsLigne2: demande.nomsLigne2,
          couleurTexte: demande.couleurTexte,
          depart,
        };
        await tx
          .update(schema.lotsAffichesDemo)
          .set({ demande: enregistree })
          .where(eq(schema.lotsAffichesDemo.id, id));

        const lignes: (typeof schema.affichesDemo.$inferInsert)[] = [];
        const present = fichierPresentMemorise();
        for (const { affiche, exemplaires } of aTirer) {
          let refusees = 0;
          let refus = "";
          for (let k = 0; k < exemplaires; k++) {
            // Le rang ne compte que les affiches tirées : il reste continu
            // (1, 2, 3…), dans les noms de fichiers comme dans la rotation.
            const rang = lignes.length + 1;
            const scene = sceneDuRang(demande.scene, rang, depart);
            const tire = tirerUnExemplaire(
              affiche,
              bibliotheque,
              {
                format: demande.format,
                scene,
                nomsLigne2: demande.nomsLigne2,
                couleurTexte: demande.couleurTexte,
              },
              id,
              rang,
              0,
              present,
            );
            if ("refus" in tire) {
              refusees++;
              refus = tire.refus;
              continue;
            }
            lignes.push({
              lotId: id,
              rang,
              productId: affiche.productId,
              titre: affiche.nom,
              scene,
              tirage: 0,
              resume: tire.resume,
              config: tire.config,
              nomFichier: nomDeFichier(affiche.nom, demande.format, tire.resume.scene ?? scene, rang),
            });
          }
          if (refusees)
            ecartees.push({
              productId: affiche.productId,
              nom: affiche.nom,
              raison:
                refusees === exemplaires
                  ? refus
                  : `${refusees} exemplaire${refusees > 1 ? "s" : ""} sur ${exemplaires} n'${refusees > 1 ? "ont" : "a"} pas pu être tiré${refusees > 1 ? "s" : ""} : ${enMinuscule(refus)}`,
            });
        }
        if (!lignes.length) throw new AucuneAffiche();
        await tx.insert(schema.affichesDemo).values(lignes);
        return { lotId: id, total: lignes.length };
      }));
    } catch (e) {
      if (!(e instanceof AucuneAffiche)) throw e;
      const [seule] = ecartees;
      return c.json(
        {
          error:
            ecartees.length === 1 && seule
              ? `« ${seule.nom} » ne peut pas être tirée : ${enMinuscule(seule.raison)}`
              : `Aucune des affiches choisies ne peut être tirée : ${ecartees
                  .map((x) => `« ${x.nom} » (${enMinuscule(x.raison).replace(/\.$/, "")})`)
                  .join(" ; ")}.`,
        },
        400,
      );
    }

    // Les rendus partent maintenant, dans l'ordre du lot : les exemplaires
    // d'une même affiche se suivent, et son décor ne se calcule qu'une fois.
    const affiches = await db
      .select({ id: schema.affichesDemo.id })
      .from(schema.affichesDemo)
      .where(eq(schema.affichesDemo.lotId, lotId))
      .orderBy(asc(schema.affichesDemo.rang));
    mettreEnFile(affiches.map((a) => ({ afficheId: a.id, lotId, force: false })));

    return c.json(
      {
        id: lotId,
        total,
        ecartees: ecartees.map(({ productId, raison }) => ({ productId, raison })),
      },
      201,
    );
  });

  /** Un lot : ses affiches, avec ce qu'on sait de chacune avant même son rendu. */
  app.get("/admin/affiches-demo/lots/:id", async (c) => {
    const lotId = identifiant(c.req.param("id"));
    if (!lotId) return c.json({ error: "Ce lot n'existe pas." }, 404);
    const [lot] = await db
      .select()
      .from(schema.lotsAffichesDemo)
      .where(eq(schema.lotsAffichesDemo.id, lotId));
    if (!lot) return c.json({ error: "Ce lot n'existe plus." }, 404);
    const lignes = await db
      .select({
        id: schema.affichesDemo.id,
        rang: schema.affichesDemo.rang,
        productId: schema.affichesDemo.productId,
        titre: schema.affichesDemo.titre,
        scene: schema.affichesDemo.scene,
        resume: schema.affichesDemo.resume,
        nomFichier: schema.affichesDemo.nomFichier,
        taille: schema.affichesDemo.taille,
        erreur: schema.affichesDemo.erreur,
      })
      .from(schema.affichesDemo)
      .where(eq(schema.affichesDemo.lotId, lotId))
      .orderBy(asc(schema.affichesDemo.rang), asc(schema.affichesDemo.id));
    const memoire = etatsEnMemoire();
    return c.json(
      {
        lot: {
          id: lot.id,
          creeLe: lot.creeLe.toISOString(),
          format: lot.format === "A3" ? "A3" : "A4",
          scene: lot.scene as SceneChoisie,
          arrete: lot.arrete,
          total: lignes.length,
        },
        affiches: lignes.map((l) => ({
          id: l.id,
          rang: l.rang,
          productId: l.productId,
          titre: l.titre,
          scene: l.scene as SceneDemo,
          resume: (l.resume ?? null) as ResumeDemo | null,
          nomFichier: l.nomFichier,
          etat: etatDe(l, lotId, memoire),
        })),
      },
      200,
      { "Cache-Control": "no-store" },
    );
  });

  /**
   * Où en est chaque affiche d'un lot — sans jamais attendre un calcul : la
   * page du lot pose la question, affiche la réponse, et la repose.
   *
   * `?reprendre=1` remet d'abord en file ce qui est « à faire » (sauf lot
   * arrêté) : la page ouverte après un redémarrage relance son lot d'elle-
   * même. Un GET, et non un POST : la question se pose toutes les deux
   * secondes et demie, et toute écriture réussie de l'admin vide la mémoire
   * de la recherche du back-office (index.ts).
   */
  app.get("/admin/affiches-demo/lots/:id/etat", async (c) => {
    const lotId = identifiant(c.req.param("id"));
    if (!lotId) return c.json({ error: "Ce lot n'existe pas." }, 404);
    const [lot] = await db
      .select({
        format: schema.lotsAffichesDemo.format,
        arrete: schema.lotsAffichesDemo.arrete,
      })
      .from(schema.lotsAffichesDemo)
      .where(eq(schema.lotsAffichesDemo.id, lotId));
    if (!lot) return c.json({ error: "Ce lot n'existe plus." }, 404);
    if (c.req.query("reprendre") === "1" && !lot.arrete) await reprendreLeLot(lotId);

    const lignes = await db
      .select({
        id: schema.affichesDemo.id,
        taille: schema.affichesDemo.taille,
        erreur: schema.affichesDemo.erreur,
      })
      .from(schema.affichesDemo)
      .where(eq(schema.affichesDemo.lotId, lotId))
      .orderBy(asc(schema.affichesDemo.rang), asc(schema.affichesDemo.id));
    const memoire = etatsEnMemoire();
    const affiches: Record<string, EtatDemo> = {};
    let pretes = 0;
    let taille = 0;
    for (const l of lignes) {
      const etat = etatDe(l, lotId, memoire);
      affiches[String(l.id)] = etat;
      if (etat.etat === "prete") {
        pretes++;
        taille += etat.taille;
      }
    }
    const moyenneMs = (await dureeMoyenne(lot.format, lotId)) ?? (await dureeMoyenne(lot.format));
    return c.json(
      { affiches, pretes, total: lignes.length, taille, moyenneMs, arrete: lot.arrete },
      200,
      // L'état change d'une seconde à l'autre : aucun cache ne doit le figer.
      { "Cache-Control": "no-store" },
    );
  });

  /**
   * « Arrêter le lot » : les affiches qui attendent ne partent plus — ni
   * maintenant, ni à la reprise. Un rendu déjà lancé va à son terme (rien ne
   * l'interrompt), et son PDF est gardé.
   */
  app.post("/admin/affiches-demo/lots/:id/arreter", async (c) => {
    const lotId = identifiant(c.req.param("id"));
    if (!lotId) return c.json({ error: "Ce lot n'existe pas." }, 404);
    // D'abord la file, sans attendre la base : l'ouvrier ne doit pas prendre
    // l'affiche suivante entre-temps.
    retirerDeLaFile((t) => t.lotId === lotId);
    const [lot] = await db
      .update(schema.lotsAffichesDemo)
      .set({ arrete: true })
      .where(eq(schema.lotsAffichesDemo.id, lotId))
      .returning({ id: schema.lotsAffichesDemo.id });
    if (!lot) return c.json({ error: "Ce lot n'existe plus." }, 404);
    return c.json({ ok: true });
  });

  /**
   * « Reprendre » : le lot repart, ses échecs compris — c'est le seul moyen
   * de relancer, avec la MÊME configuration, une affiche tombée sur un manque
   * passager (mémoire, disque). « Refaire au hasard », lui, en tire une autre.
   */
  app.post("/admin/affiches-demo/lots/:id/reprendre", async (c) => {
    const lotId = identifiant(c.req.param("id"));
    if (!lotId) return c.json({ error: "Ce lot n'existe pas." }, 404);
    const [lot] = await db
      .update(schema.lotsAffichesDemo)
      .set({ arrete: false })
      .where(eq(schema.lotsAffichesDemo.id, lotId))
      .returning({ id: schema.lotsAffichesDemo.id });
    if (!lot) return c.json({ error: "Ce lot n'existe plus." }, 404);
    await db
      .update(schema.affichesDemo)
      .set({ erreur: null })
      .where(
        and(
          eq(schema.affichesDemo.lotId, lotId),
          isNull(schema.affichesDemo.taille),
          isNotNull(schema.affichesDemo.erreur),
        ),
      );
    await reprendreLeLot(lotId);
    return c.json({ ok: true });
  });

  /** Supprime un lot : ses affiches, et leurs fichiers sur le disque. */
  app.delete("/admin/affiches-demo/lots/:id", async (c) => {
    const lotId = identifiant(c.req.param("id"));
    if (!lotId) return c.json({ error: "Ce lot n'existe pas." }, 404);
    retirerDeLaFile((t) => t.lotId === lotId);
    const [lot] = await db
      .delete(schema.lotsAffichesDemo)
      .where(eq(schema.lotsAffichesDemo.id, lotId))
      .returning({ id: schema.lotsAffichesDemo.id });
    if (!lot) return c.json({ error: "Ce lot n'existe plus." }, 404);
    // Les affiches partent avec lui (on delete cascade) ; un rendu en cours
    // effacera le sien en finissant (cf. ranger).
    await rm(dossierDuLot(lotId), { recursive: true, force: true });
    return c.json({ ok: true });
  });

  /**
   * Toutes les affiches PRÊTES d'un lot, dans une archive .zip envoyée en flux
   * depuis le disque (archive-zip.ts) : jamais tout le lot en mémoire, et un
   * Content-Length exact. Un PDF par affiche, avec son nom : chacune se
   * réimprime seule, et un seul téléchargement évite que le navigateur
   * demande l'autorisation d'en enregistrer plusieurs.
   */
  app.get("/admin/affiches-demo/lots/:id/affiches.zip", async (c) => {
    const lotId = identifiant(c.req.param("id"));
    if (!lotId) return c.json({ error: "Ce lot n'existe pas." }, 404);
    const [lot] = await db
      .select({ format: schema.lotsAffichesDemo.format })
      .from(schema.lotsAffichesDemo)
      .where(eq(schema.lotsAffichesDemo.id, lotId));
    if (!lot) return c.json({ error: "Ce lot n'existe plus." }, 404);
    const lignes = await db
      .select({
        id: schema.affichesDemo.id,
        nomFichier: schema.affichesDemo.nomFichier,
        taille: schema.affichesDemo.taille,
        crc32: schema.affichesDemo.crc32,
        faitLe: schema.affichesDemo.faitLe,
      })
      .from(schema.affichesDemo)
      .where(
        and(
          eq(schema.affichesDemo.lotId, lotId),
          isNotNull(schema.affichesDemo.taille),
          isNotNull(schema.affichesDemo.crc32),
        ),
      )
      .orderBy(asc(schema.affichesDemo.rang), asc(schema.affichesDemo.id));
    const memoire = etatsEnMemoire();
    const fichiers: FichierSurDisque[] = [];
    for (const l of lignes) {
      // En train d'être refaite : son fichier va changer sous nos pieds.
      if (memoire.has(l.id) || l.taille === null || l.crc32 === null) continue;
      const range = pdfRange(lotId, l.id, l.taille);
      if (!range) continue;
      fichiers.push({
        nom: l.nomFichier,
        chemin: fichiersDeLAffiche(lotId, l.id).pdf,
        taille: l.taille,
        crc32: l.crc32,
        date: l.faitLe ?? undefined,
        ino: range.ino,
      });
    }
    if (!fichiers.length)
      return c.json(
        { error: "Aucune affiche de ce lot n'est encore prête : il n'y a rien à télécharger." },
        409,
      );
    let archive: ReturnType<typeof archiveZipDepuisDisque>;
    try {
      archive = archiveZipDepuisDisque(fichiers);
    } catch (e) {
      return c.json({ error: `L'archive ne peut pas être faite : ${raisonLisible(e)}` }, 413);
    }
    // Les vignettes avec les PDF : le ménage ne doit pas laisser une affiche
    // « prête » sans image.
    rafraichir(...fichiers.flatMap((f) => [f.chemin, f.chemin.replace(/\.pdf$/, ".jpg")]));
    const format = lot.format === "A3" ? "A3" : "A4";
    return c.body(archive.flux, 200, {
      "Content-Type": "application/zip",
      "Content-Length": String(archive.taille),
      "Content-Disposition": `attachment; filename="affiches-demo_lot-${lotId}_${format}.zip"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
  });

  /**
   * Le PDF d'une affiche, s'il est prêt — jamais d'attente du calcul dans la
   * requête : pas prêt, c'est un 409 qui le dit, et la page du lot ne propose
   * le lien qu'une fois l'affiche prête.
   *
   * « fichier.pdf » dans son PROPRE segment : un paramètre suivi d'un
   * littéral dans le même segment est un chemin que le routeur de Hono ne
   * sait pas construire (voir apercus.ts).
   */
  app.get("/admin/affiches-demo/affiches/:id/fichier.pdf", async (c) => {
    const afficheId = identifiant(c.req.param("id"));
    if (!afficheId) return c.json({ error: "Cette affiche n'existe pas." }, 404);
    const [ligne] = await db
      .select({
        lotId: schema.affichesDemo.lotId,
        nomFichier: schema.affichesDemo.nomFichier,
        taille: schema.affichesDemo.taille,
      })
      .from(schema.affichesDemo)
      .where(eq(schema.affichesDemo.id, afficheId));
    if (!ligne) return c.json({ error: "Cette affiche n'existe plus." }, 404);
    if (ligne.taille === null || etatsEnMemoire().has(afficheId))
      return c.json(
        { error: "Cette affiche n'est pas encore prête : son PDF se fabrique, ou attend son tour." },
        409,
      );
    const { pdf, jpg } = fichiersDeLAffiche(ligne.lotId, afficheId);
    let octets: Buffer<ArrayBuffer>;
    try {
      octets = await readFile(pdf);
    } catch {
      oublierLePdf(afficheId, ligne.taille);
      return c.json(
        { error: "Le PDF de cette affiche n'est plus sur le serveur : rouvrez son lot pour le refaire." },
        409,
      );
    }
    if (octets.length !== ligne.taille)
      return c.json(
        { error: "Le PDF de cette affiche est en train d'être refait : réessayez dans un instant." },
        409,
      );
    rafraichir(pdf, jpg);
    return c.body(octets, 200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${ligne.nomFichier}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
  });

  /**
   * La vignette d'une affiche prête. Privée (le cookie de la propriétaire),
   * et revalidée à chaque fois : « Refaire au hasard » la remplace sous la
   * même adresse. L'ETag porte le tirage et la taille, si bien qu'une
   * vignette inchangée ne repart pas (304).
   */
  app.get("/admin/affiches-demo/affiches/:id/apercu.jpg", async (c) => {
    const afficheId = identifiant(c.req.param("id"));
    if (!afficheId) return c.json({ error: "Cette affiche n'existe pas." }, 404);
    const [ligne] = await db
      .select({
        lotId: schema.affichesDemo.lotId,
        tirage: schema.affichesDemo.tirage,
        taille: schema.affichesDemo.taille,
      })
      .from(schema.affichesDemo)
      .where(eq(schema.affichesDemo.id, afficheId));
    if (!ligne || ligne.taille === null)
      return c.json({ error: "Cette affiche n'est pas encore prête." }, 404);
    const etiquette = `"demo-${afficheId}-${ligne.tirage}-${ligne.taille}"`;
    const enTetes = { "Cache-Control": "private, no-cache", ETag: etiquette };
    if (c.req.header("If-None-Match") === etiquette) return c.body(null, 304, enTetes);
    let octets: Buffer<ArrayBuffer>;
    try {
      octets = await readFile(fichiersDeLAffiche(ligne.lotId, afficheId).jpg);
    } catch {
      return c.json({ error: "Cette affiche n'est pas encore prête." }, 404);
    }
    return c.body(octets, 200, { ...enTetes, "Content-Type": "image/jpeg" });
  });

  /**
   * « Refaire au hasard » : une AUTRE configuration pour cette affiche, dans
   * la même scène, et son rendu repart. Elle peut se faire avant le rendu
   * (la carte montre ses personnages dès le tirage) comme après : le PDF
   * actuel est alors remplacé.
   */
  app.post("/admin/affiches-demo/affiches/:id/nouveau-tirage", async (c) => {
    const afficheId = identifiant(c.req.param("id"));
    if (!afficheId) return c.json({ error: "Cette affiche n'existe pas." }, 404);
    const [ligne] = await db
      .select({
        lotId: schema.affichesDemo.lotId,
        rang: schema.affichesDemo.rang,
        productId: schema.affichesDemo.productId,
        titre: schema.affichesDemo.titre,
        scene: schema.affichesDemo.scene,
        tirage: schema.affichesDemo.tirage,
        config: schema.affichesDemo.config,
        format: schema.lotsAffichesDemo.format,
        demande: schema.lotsAffichesDemo.demande,
      })
      .from(schema.affichesDemo)
      .innerJoin(schema.lotsAffichesDemo, eq(schema.lotsAffichesDemo.id, schema.affichesDemo.lotId))
      .where(eq(schema.affichesDemo.id, afficheId));
    if (!ligne) return c.json({ error: "Cette affiche n'existe plus : rechargez la page." }, 404);

    const [produit] = ligne.productId === null ? [] : await lireLesProduits([ligne.productId]);
    if (!produit)
      return c.json(
        { error: `« ${ligne.titre} » n'est plus au catalogue : elle ne peut pas être tirée de nouveau.` },
        409,
      );
    if (!personnalisableEnLigne(produit))
      return c.json(
        {
          error: `« ${produit.nom} » n'est plus une affiche personnalisable en ligne : elle ne peut pas être tirée de nouveau.`,
        },
        409,
      );
    let bibliotheque: unknown;
    try {
      bibliotheque = await chargerBibliotheque(app, [produit.vue]);
    } catch (e) {
      console.error("[affiches démo] bibliothèque :", e);
      return c.json(
        { error: "La bibliothèque des personnages n'a pas pu être lue : réessayez dans un instant." },
        503,
      );
    }
    const affiche = afficheATirer(produit, await lireLesFonds());
    const verdict = examiner(affiche, bibliotheque);
    if (!verdict.tirable)
      return c.json(
        { error: `« ${produit.nom} » ne peut pas être tirée : ${enMinuscule(verdict.raison)}` },
        409,
      );

    const demande = (ligne.demande ?? {}) as Partial<DemandeEnregistree>;
    const format: PosterFormat = ligne.format === "A3" ? "A3" : "A4";
    const scene = (SCENES_DEMO.some((s) => s.cle === ligne.scene) && ligne.scene !== "varie"
      ? ligne.scene
      : "hasard") as SceneDemo;
    const tire = tirerUnExemplaire(
      affiche,
      bibliotheque,
      {
        format,
        scene,
        nomsLigne2: Array.isArray(demande.nomsLigne2) ? demande.nomsLigne2 : [],
        couleurTexte: demande.couleurTexte ?? "#FFFFFF",
      },
      ligne.lotId,
      ligne.rang,
      // Chaque nouveau tirage a ses propres essais : jamais la graine d'avant.
      (ligne.tirage + 1) * ESSAIS_PAR_TIRAGE,
      fichierPresentMemorise(),
      canonique(ligne.config),
    );
    if ("refus" in tire)
      return c.json(
        { error: `« ${produit.nom} » n'a pas pu être tirée de nouveau : ${enMinuscule(tire.refus)}` },
        409,
      );

    // Le rendu de l'ancienne configuration, s'il attendait encore, ne part pas.
    retirerDeLaFile((t) => t.afficheId === afficheId);
    const [maj] = await db
      .update(schema.affichesDemo)
      .set({
        config: tire.config,
        resume: tire.resume,
        tirage: ligne.tirage + 1,
        titre: produit.nom,
        nomFichier: nomDeFichier(produit.nom, format, tire.resume.scene ?? scene, ligne.rang),
        taille: null,
        crc32: null,
        dureeMs: null,
        erreur: null,
        faitLe: null,
      })
      .where(
        and(
          eq(schema.affichesDemo.id, afficheId),
          // Deux clics à la fois : le second ne remplace pas le premier.
          eq(schema.affichesDemo.tirage, ligne.tirage),
        ),
      )
      .returning({ id: schema.affichesDemo.id });
    if (!maj)
      return c.json(
        { error: "Cette affiche vient d'être retirée au hasard, ou du lot : rechargez la page." },
        409,
      );
    await effacerLesFichiers(ligne.lotId, afficheId);
    mettreEnFile([{ afficheId, lotId: ligne.lotId, force: true }]);
    return c.json({ ok: true });
  });

  /** Retire une affiche du lot, et ses fichiers. */
  app.delete("/admin/affiches-demo/affiches/:id", async (c) => {
    const afficheId = identifiant(c.req.param("id"));
    if (!afficheId) return c.json({ error: "Cette affiche n'existe pas." }, 404);
    retirerDeLaFile((t) => t.afficheId === afficheId);
    const [retiree] = await db
      .delete(schema.affichesDemo)
      .where(eq(schema.affichesDemo.id, afficheId))
      .returning({ lotId: schema.affichesDemo.lotId });
    if (!retiree) return c.json({ error: "Cette affiche n'existe plus." }, 404);
    await effacerLesFichiers(retiree.lotId, afficheId);
    return c.json({ ok: true });
  });
}
