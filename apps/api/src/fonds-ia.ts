/**
 * BO › Atelier › Créer un fond (20/11) : des photos de lieux, un nom, et le
 * modèle d'images d'OpenAI dessine les décors dans le style de la maison.
 *
 * Le besoin, mot pour mot : « Si seulement tu pouvais me faire un programme
 * où j'ai juste à mettre des photos et qu'il me génère des fonds
 * automatiquement sans que je discute pendant 2h pour faire un seule fond de
 * ville » (Margaux). Précisé ensuite par Alexandra :
 *   - plusieurs photos DIFFÉRENTES déposées d'un coup donnent chacune LEUR
 *     fond : un lot, une photo = un fond, qui se garde, se retouche et
 *     s'enregistre seul ;
 *   - le style est celui d'un style des affiches IA (« bâtiment / paysage »),
 *     dont le champ « prompt » est LU EN BASE à chaque dessin ;
 *   - chaque fond garde une petite discussion, « si jamais le résultat est
 *     pas top top » : un message repart de la version courante, avec tout le
 *     fil des demandes précédentes.
 *
 * Le parcours :
 *   1. POST /admin/fonds-ia/lots — les photos, le nom du lot (et celui de
 *      chaque photo), le style, une précision, le nombre de versions. Une
 *      ligne `fond_ia` par photo, un premier message par fond, une ligne
 *      `ai_generation` par version : c'est là que vit le coût, réservé dès
 *      le lancement. Le dessin part en ARRIÈRE-PLAN ; l'écran sonde l'état.
 *   2. POST /admin/fonds-ia/:id/messages — un message de la discussion :
 *      boutons de retouche et/ou texte libre ; ou « de zéro », depuis la photo.
 *      POST …/courante revient à une version précédente.
 *   3. POST …/enregistrer — la version gardée, agrandie, entre dans la
 *      bibliothèque (data/assets + ligne `background`), comme un décor
 *      envoyé à la main, rattachée ou non à une affiche.
 *
 * Le coût : chaque version est payée. Les fonds ont LEUR plafond du mois
 * (réglage « ia.fondPlafondMensuelCents », sinon la moitié de celui des
 * affiches), À PART de celui des affiches des clients : un lot ne coupe
 * jamais une cliente du stand (relecture du 20/11). Le plafond est relu SOUS
 * VERROU dans la transaction qui réserve le coût des versions lancées ; ce
 * coût revient à 0 si le dessin échoue ou s'interrompt. Confirmation dans la
 * page, jetons contre le double clic, et pas plus de trois appels au modèle
 * à la fois.
 *
 * LE BOUCHON. Le modèle n'est jamais appelé en essai : un faux dessinateur
 * (`dessinBouchon`) le remplace quand la variable d'environnement
 * IA_FONDS_BOUCHON=1 est posée, ou que le réglage « ia.fondBouchon » vaut
 * « 1 » — l'un et l'autre IGNORÉS en production (NODE_ENV=production). Les
 * essais automatiques passent par `remplacerDessinateur`.
 */
import type { Context, Hono } from "hono";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql as raw,
} from "drizzle-orm";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { db, schema } from "./db/client.js";
import {
  IA_DIR,
  PHOTO_MAX_OCTETS,
  depenseDuMoisCents,
  editerImages,
  iaConfiguree,
  ipDeLaRequete,
  normaliserPhoto,
  reglages,
  type ImageEnvoyee,
  type LecteurDepense,
} from "./ia.js";
import {
  CLE_PLAFOND_FONDS,
  CONSIGNE_FOND_DEFAUT,
  DECOR_HAUTEUR,
  DECOR_LARGEUR,
  EXEMPLES_MAX,
  MESSAGE_MAX,
  NOM_MAX,
  PHOTOS_MAX,
  PRECISION_MAX,
  RETOUCHES,
  TAILLE_FOND,
  VERSIONS_MAX,
  baseNomFichier,
  bornerVersions,
  centimesDuReglage,
  composerConsigneFond,
  coutEstimeCents,
  demandesDeLaLignee,
  etatDuFond,
  exemplesDemandes,
  lireExemples,
  lireMessage,
  nettoyerTexte,
  nomsDuLot,
  plafondDepasse,
  plafondDesFonds,
  resteSousLePlafond,
  styleParDefaut,
} from "./fonds-ia-consigne.js";

const ASSETS_DIR = resolve(fileURLToPath(import.meta.url), "../../../../data/assets");
/** Photos des lieux et versions dessinées : jamais servies par /assets/:file. */
const FONDS_DIR = resolve(IA_DIR, "fonds");
await mkdir(FONDS_DIR, { recursive: true });

/* -------------------------------------------------------------------------- */
/*  Réglages                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Les réglages propres aux fonds. Le modèle, la qualité et la fidélité sont
 * ceux des affiches IA (ia.ts) : un seul compte OpenAI. Le PLAFOND du mois,
 * lui, est à part (relecture du 20/11) : celui des affiches protège les
 * clients, celui-ci les fonds. Le STYLE n'en est pas : c'est un style des
 * affiches IA, choisi sur l'écran et relu en base (table ia_prompt).
 */
const DEFAUTS_FONDS = {
  /** Les règles propres aux fonds (fonds-ia-consigne.ts), pas le style. */
  "ia.fondConsigne": CONSIGNE_FOND_DEFAUT,
  "ia.fondVersions": 2,
  /**
   * ESTIMATION du coût d'une version, en centimes. Plus que les 8 c d'un
   * aperçu d'affiche : une image en portrait en haute qualité, et deux ou
   * trois images en entrée (photo, décors d'exemple) qui se paient aussi.
   */
  "ia.fondCoutParVersionCents": 25,
  /**
   * Le plafond des fonds, en centimes par mois. Absent ou vide : la moitié
   * du plafond des affiches (`plafondDesFonds`), pas une valeur fixe.
   */
  [CLE_PLAFOND_FONDS]: null,
  /** « 12, 57 » : les décors d'exemple ; vide = les deux premiers proposables. */
  "ia.fondExemples": "",
  /** « 1 » : le faux dessinateur, hors production seulement. */
  "ia.fondBouchon": "",
} as const;

type ReglagesIa = Awaited<ReturnType<typeof reglages>>;

interface ReglagesFonds {
  consigne: string;
  consigneParDefaut: boolean;
  versions: number;
  coutParVersionCents: number;
  exemples: number[];
  bouchon: boolean;
  /** Le plafond des fonds ce mois-ci, en centimes. */
  plafondCents: number;
  /** Vrai sans réglage : c'est alors la moitié du plafond des affiches. */
  plafondParDefaut: boolean;
  /** Le réglage tel qu'enregistré, null s'il n'y en a pas. */
  plafondReglageCents: number | null;
  /** Ce que vaut le plafond sans réglage : la moitié de celui des affiches. */
  plafondDefautCents: number;
  /** Le plafond des affiches des clients, pour l'expliquer à l'écran. */
  plafondAffichesCents: number;
}

async function reglagesFonds(reg?: ReglagesIa): Promise<ReglagesFonds> {
  const [rows, ia] = await Promise.all([
    db
      .select()
      .from(schema.settings)
      .where(inArray(schema.settings.key, Object.keys(DEFAUTS_FONDS))),
    reg ?? reglages(),
  ]);
  const lu = new Map(rows.map((r) => [r.key, r.value == null ? "" : String(r.value)]));
  const consigneLue = (lu.get("ia.fondConsigne") ?? "").trim();
  const plafond = plafondDesFonds(lu.get(CLE_PLAFOND_FONDS), ia["ia.plafondMensuelCents"]);
  return {
    consigne: consigneLue || CONSIGNE_FOND_DEFAUT,
    consigneParDefaut: !consigneLue,
    versions: bornerVersions(lu.get("ia.fondVersions"), DEFAUTS_FONDS["ia.fondVersions"]),
    // Vide ou illisible : le coût par défaut, jamais 0 — à 0, plus rien ne
    // compterait dans le plafond.
    coutParVersionCents: centimesDuReglage(
      lu.get("ia.fondCoutParVersionCents"),
      DEFAUTS_FONDS["ia.fondCoutParVersionCents"],
    ),
    exemples: lireExemples(lu.get("ia.fondExemples")),
    bouchon: ["1", "true", "oui"].includes((lu.get("ia.fondBouchon") ?? "").trim()),
    plafondCents: plafond.cents,
    plafondParDefaut: plafond.parDefaut,
    plafondReglageCents: plafond.reglageCents,
    plafondDefautCents: plafond.defautCents,
    plafondAffichesCents: ia["ia.plafondMensuelCents"],
  };
}

/** Les styles des affiches IA qu'on peut choisir : ceux qui ne sont pas archivés. */
async function stylesProposables() {
  return db
    .select({ id: schema.aiPrompts.id, title: schema.aiPrompts.title })
    .from(schema.aiPrompts)
    .where(isNull(schema.aiPrompts.archivedAt))
    .orderBy(asc(schema.aiPrompts.position), asc(schema.aiPrompts.id));
}

/** La consigne d'un style, lue AU MOMENT du dessin : ce que Margaux y a écrit en dernier. */
async function consigneDuStyle(styleId: number | null): Promise<string> {
  if (!styleId) return "";
  const [s] = await db
    .select({ prompt: schema.aiPrompts.prompt })
    .from(schema.aiPrompts)
    .where(eq(schema.aiPrompts.id, styleId));
  return s?.prompt ?? "";
}

/* -------------------------------------------------------------------------- */
/*  Le dessinateur : le vrai modèle, ou le bouchon                            */
/* -------------------------------------------------------------------------- */

export type Dessinateur = (
  images: ImageEnvoyee[],
  consigne: string,
  options: { modele: string; taille: string; qualite: string; fidelite: string },
) => Promise<Buffer>;

const vraiDessinateur: Dessinateur = (images, consigne, o) =>
  editerImages(images, consigne, o.modele, o.taille, o.qualite, o.fidelite);

/**
 * Le faux dessinateur des essais : la première image reçue (la photo, ou la
 * version de départ), mise au format 2:3, teintée, avec un ciel en haut, un
 * sol dégagé en bas et « ESSAI » écrit dessus. De quoi suivre tout le
 * parcours sans dépenser un centime, et sans jamais confondre avec un vrai
 * décor.
 */
let compteurBouchon = 0;
export const dessinBouchon: Dessinateur = async (images, _consigne, o) => {
  const [l = 1024, h = 1536] = o.taille.split("x").map(Number);
  const teinte = (compteurBouchon++ * 67) % 360;
  await new Promise((r) => setTimeout(r, 1500));
  const fond = await sharp(images[0]!.donnees)
    .resize({ width: l, height: h, fit: "cover" })
    .modulate({ hue: teinte, saturation: 1.3 })
    .toBuffer();
  const calque = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${l}" height="${h}">` +
      `<defs><linearGradient id="c" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#5fa8e8"/><stop offset="1" stop-color="#cfe8fb"/></linearGradient></defs>` +
      `<rect width="${l}" height="${Math.round(h * 0.3)}" fill="url(#c)"/>` +
      `<rect y="${Math.round(h * 0.7)}" width="${l}" height="${Math.round(h * 0.3)}" fill="#d9c7a3"/>` +
      `<text x="${l / 2}" y="${Math.round(h * 0.16)}" font-family="sans-serif" font-size="${Math.round(l / 9)}" ` +
      `font-weight="bold" fill="#ffffff" text-anchor="middle">ESSAI</text></svg>`,
  );
  return sharp(fond).composite([{ input: calque }]).png().toBuffer();
};

let dessinateurImpose: Dessinateur | null = null;

/** Pour les essais : impose un dessinateur (null rend la main au choix normal). */
export function remplacerDessinateur(d: Dessinateur | null): void {
  dessinateurImpose = d;
}

/**
 * Le bouchon est-il branché ? Jamais en production : un réglage oublié ne
 * doit pas remplir la bibliothèque de faux décors.
 */
export function bouchonActif(
  reglageBouchon: boolean,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.NODE_ENV === "production") return false;
  return env.IA_FONDS_BOUCHON === "1" || reglageBouchon;
}

function dessinateur(bouchon: boolean): Dessinateur {
  if (dessinateurImpose) return dessinateurImpose;
  return bouchon ? dessinBouchon : vraiDessinateur;
}

/**
 * Trois appels au modèle à la fois, pas plus : un lot de dix photos à deux
 * versions ferait vingt appels simultanés, que l'API d'OpenAI refuserait en
 * partie (limite de cadence), chacun payé ou perdu.
 */
const SIMULTANES_MAX = 3;
let actifs = 0;
const attente: (() => void)[] = [];
async function aTonTour<T>(travail: () => Promise<T>): Promise<T> {
  if (actifs >= SIMULTANES_MAX) await new Promise<void>((r) => attente.push(r));
  actifs++;
  try {
    return await travail();
  } finally {
    actifs--;
    attente.shift()?.();
  }
}

/**
 * Les versions en cours de dessin DANS CE PROCESSUS. Une ligne « en_cours »
 * qui n'y figure pas a été interrompue (l'API a redémarré) : on la dit en
 * échec au lieu de laisser l'écran attendre pour toujours — et son coût,
 * réservé au lancement, revient au plafond.
 *
 * Une version y entre AVANT que sa ligne soit écrite (`reserverVersions`) :
 * une page qui sonde au même instant ne la prend jamais pour une interrompue.
 */
const enCours = new Set<string>();

const MESSAGE_INTERROMPUE = "Interrompue : le serveur a redémarré pendant le dessin. Recommencez.";

/**
 * Passe en échec, coût rendu, toutes les versions de fonds « en_cours »
 * qu'aucun dessin de ce processus ne porte plus. Avant chaque lancement (sous
 * le verrou du plafond) et à l'ouverture de l'écran : une réservation
 * orpheline ne doit pas grignoter le plafond.
 */
async function solderLesInterrompues(
  executeur: Pick<typeof db, "select" | "update"> = db,
): Promise<void> {
  const g = schema.aiGenerations;
  // La base D'ABORD, la liste de ce processus ENSUITE, comme versionsDe
  // (relecture du 20/11) : une version réservée pendant cette lecture est
  // entrée dans `enCours` avant que sa ligne existe, et n'est donc jamais
  // prise pour une interrompue. Relever la liste avant la base, c'était
  // risquer de solder — « Interrompue », coût 0 — un dessin tout juste lancé
  // depuis un autre onglet. Une version qui s'achève entre les deux est déjà
  // « prete » quand l'UPDATE passe : il ne la touche pas.
  const lignes = await executeur
    .select({ id: g.id, publicId: g.publicId })
    .from(g)
    .where(and(isNotNull(g.fondId), eq(g.status, "en_cours")));
  const interrompues = lignes.filter((l) => !enCours.has(l.publicId)).map((l) => l.id);
  if (!interrompues.length) return;
  await executeur
    .update(g)
    .set({ status: "echec", erreur: MESSAGE_INTERROMPUE, costCents: 0 })
    .where(and(inArray(g.id, interrompues), eq(g.status, "en_cours")));
}

/** Une transaction en cours (cf. numeros-commande.ts) : un verrou pris dedans vit jusqu'au COMMIT. */
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Le verrou du plafond des fonds : relire la dépense et réserver le coût se
 * font l'un après l'autre, jamais à deux. Sans lui, deux lots envoyés coup
 * sur coup lisaient chacun la même dépense et passaient tous les deux.
 */
async function verrouillerLePlafond(tx: Transaction): Promise<void> {
  await tx.execute(raw`select pg_advisory_xact_lock(hashtext(${"plafond-fonds-ia"}))`);
}

/** Le plafond refuse : levé dans la transaction qui l'a relu, rien n'est écrit. */
class RefusDuPlafond extends Error {}

/** Le même envoi (même jeton) est déjà passé : on rend ce qu'il a fait. */
class DejaEnvoye extends Error {
  constructor(readonly messageId: number | null = null) {
    super("Envoi déjà fait");
  }
}

/* -------------------------------------------------------------------------- */
/*  Fichiers                                                                  */
/* -------------------------------------------------------------------------- */

/** Un chemin « ia/fonds/x » rangé en base → chemin disque, sans jamais en sortir. */
function cheminFonds(relatif: string | null | undefined): string | null {
  const nom = basename(String(relatif ?? ""));
  if (!nom || !/^[a-z0-9-]+\.(jpg|png)$/i.test(nom)) return null;
  return resolve(FONDS_DIR, nom);
}

const vignetteDe = (publicId: string) => `${publicId}-vignette.jpg`;

/**
 * Efface les photos d'un lot qui n'a pas abouti (refus du plafond, envoi
 * déjà fait, erreur de la base) : aucune ligne ne les désigne, et la purge des
 * photos de visiteurs ne passe pas dans ia/fonds — sans ceci, elles y
 * resteraient pour toujours.
 */
async function effacerPhotosDuLot(photos: readonly string[]): Promise<void> {
  for (const p of photos) {
    const chemin = cheminFonds(p);
    if (chemin) await rm(chemin, { force: true }).catch(() => undefined);
  }
}

/**
 * Un décor de la bibliothèque, en PNG de 900 px de large, pour servir
 * d'exemple de style. Les décors sont des SVG de 1 à 15 Mo : on demande à
 * l'API elle-même sa version légère (/assets/x?l=900), qui passe par la file
 * des conversions SVG et reste en cache sur le disque.
 */
async function imageDExemple(url: string): Promise<ImageEnvoyee | null> {
  const fichier = /^\/assets\/([^/?#]+)$/.exec(url)?.[1];
  if (!fichier) return null;
  try {
    const r = await fetch(
      `http://127.0.0.1:${process.env.API_PORT ?? 3000}/assets/${fichier}?l=900`,
      { signal: AbortSignal.timeout(120_000) },
    );
    if (!r.ok) return null;
    const donnees = await sharp(Buffer.from(await r.arrayBuffer()))
      .flatten({ background: "#ffffff" })
      .png()
      .toBuffer();
    return {
      nom: `exemple-${basename(fichier).replace(/\.[^.]+$/, "")}.png`,
      donnees,
      type: "image/png",
    };
  } catch {
    return null;
  }
}

/** Les décors proposables, du plus ancien au plus récent. */
async function decorsProposables() {
  return db
    .select({ id: schema.backgrounds.id, nom: schema.backgrounds.name, url: schema.backgrounds.url })
    .from(schema.backgrounds)
    .where(isNull(schema.backgrounds.archivedAt))
    .orderBy(asc(schema.backgrounds.id));
}

/** Les décors d'exemple retenus : ceux demandés s'ils existent, sinon les deux premiers. */
async function exemplesRetenus(demandes: number[]): Promise<number[]> {
  const decors = await decorsProposables();
  const ids = new Set(decors.map((d) => d.id));
  const gardes = demandes.filter((id) => ids.has(id)).slice(0, EXEMPLES_MAX);
  if (gardes.length) return gardes;
  return decors
    .filter((d) => /\.(svg|png|jpe?g|webp)$/i.test(d.url))
    .slice(0, EXEMPLES_MAX)
    .map((d) => d.id);
}

/* -------------------------------------------------------------------------- */
/*  Dessin                                                                    */
/* -------------------------------------------------------------------------- */

type Fond = typeof schema.fondsIa.$inferSelect;
type Message = typeof schema.fondsIaMessages.$inferSelect;

/** Une version réservée : sa ligne `ai_generation` « en_cours », et le coût qu'elle engage. */
interface VersionReservee {
  id: number;
  publicId: string;
  coutCents: number;
}

/**
 * Réserve les versions d'un message : une ligne `ai_generation` « en_cours »
 * par version, qui porte DÉJÀ son coût estimé. Relecture du 20/11 : à 0
 * jusqu'à la fin du dessin, les versions en cours ne comptaient pas dans le
 * plafond, et deux lots lancés coup sur coup le dépassaient ensemble. Le coût
 * revient à 0 si le dessin échoue ou s'interrompt.
 *
 * Dans la transaction qui vient de relire le plafond sous verrou : les lignes
 * existent AVANT la réponse, l'écran qui s'ouvre juste après les voit déjà.
 * Les identifiants entrent dans `enCours` avant l'écriture et dans
 * `o.reservees`, d'où l'appelant les retire si la transaction échoue.
 */
async function reserverVersions(
  tx: Transaction,
  fond: Fond,
  message: Message,
  o: { ip: string; bouchon: boolean; modele: string; coutParVersionCents: number; reservees: string[] },
): Promise<VersionReservee[]> {
  // Le bouchon ne coûte rien : il ne doit pas entamer le plafond.
  const cout = o.bouchon ? 0 : o.coutParVersionCents;
  const ids = Array.from({ length: message.versions }, () => randomUUID());
  for (const id of ids) {
    enCours.add(id);
    o.reservees.push(id);
  }
  const lignes = await tx
    .insert(schema.aiGenerations)
    .values(
      ids.map((publicId) => ({
        publicId,
        productId: null,
        sourcePath: null,
        prompt: null,
        model: o.bouchon ? "bouchon" : o.modele,
        size: TAILLE_FOND,
        status: "en_cours",
        ip: o.ip,
        fondId: fond.id,
        fondMessageId: message.id,
        costCents: cout,
      })),
    )
    .returning({ id: schema.aiGenerations.id, publicId: schema.aiGenerations.publicId });
  return lignes.map((l) => ({ ...l, coutCents: cout }));
}

/**
 * Dessine, en ARRIÈRE-PLAN, les versions réservées d'un message.
 *
 * Ce qui part au modèle : la version de départ du message (s'il en a une),
 * la photo du lieu, et — pour un dessin de zéro seulement — les décors
 * d'exemple ; la consigne du style relue en base, les règles des fonds, les
 * demandes de la LIGNÉE de la version de départ, et celle du message, en
 * dernier.
 */
function dessinerMessage(
  fond: Fond,
  message: Message,
  lignes: VersionReservee[],
  o: { bouchon: boolean; reg: ReglagesIa; fr: ReglagesFonds },
): void {
  const { bouchon, reg, fr } = o;
  // Un échec rend le coût réservé : l'image n'a pas été payée.
  const echouer = async (ids: number[], e: unknown) => {
    const texte = e instanceof Error ? e.message : String(e);
    console.error(`Fond IA ${fond.id} (message ${message.id}) en échec :`, texte);
    await db
      .update(schema.aiGenerations)
      .set({ status: "echec", erreur: texte.slice(0, 1000), costCents: 0 })
      .where(inArray(schema.aiGenerations.id, ids))
      .catch(() => undefined);
  };

  void (async () => {
    let images: ImageEnvoyee[];
    let consigne: string;
    try {
      images = [];
      let depuisVersion = false;
      if (message.baseVersion) {
        const [g] = await db
          .select({ fullPath: schema.aiGenerations.fullPath })
          .from(schema.aiGenerations)
          .where(eq(schema.aiGenerations.publicId, message.baseVersion));
        const chemin = cheminFonds(g?.fullPath);
        const base = chemin ? await readFile(chemin).catch(() => null) : null;
        if (!base) throw new Error("Version de départ introuvable sur le disque");
        images.push({ nom: "version-courante.png", donnees: base, type: "image/png" });
        depuisVersion = true;
      }
      let nbPhotos = 0;
      for (const p of fond.photos) {
        const chemin = cheminFonds(p);
        const donnees = chemin ? await readFile(chemin).catch(() => null) : null;
        if (donnees) {
          images.push({ nom: basename(p), donnees, type: "image/jpeg" });
          nbPhotos++;
        }
      }
      if (!nbPhotos && !depuisVersion) throw new Error("Photo du lieu introuvable sur le disque");
      // Les exemples, pour un dessin de zéro seulement : une version de
      // départ porte déjà le style, et chaque image en entrée se paie.
      let nbExemples = 0;
      if (!depuisVersion && fond.exemples.length) {
        const decors = await decorsProposables();
        for (const id of fond.exemples) {
          const d = decors.find((x) => x.id === id);
          const im = d ? await imageDExemple(d.url) : null;
          if (im) {
            images.push(im);
            nbExemples++;
          }
        }
      }
      // Le fil : les demandes de la LIGNÉE de la version de départ, pour
      // qu'une correction obtenue ne se perde pas au message suivant — et pas
      // celles d'une branche abandonnée par « Revenir à celle-ci », qui ne
      // sont pas dans l'image de départ (relecture du 20/11).
      const [fil, versionsDuFond] = await Promise.all([
        db
          .select({
            id: schema.fondsIaMessages.id,
            demande: schema.fondsIaMessages.demande,
            baseVersion: schema.fondsIaMessages.baseVersion,
          })
          .from(schema.fondsIaMessages)
          .where(eq(schema.fondsIaMessages.fondId, fond.id)),
        db
          .select({
            publicId: schema.aiGenerations.publicId,
            messageId: schema.aiGenerations.fondMessageId,
          })
          .from(schema.aiGenerations)
          .where(eq(schema.aiGenerations.fondId, fond.id)),
      ]);
      consigne = composerConsigneFond({
        style: await consigneDuStyle(fond.styleId),
        gabarit: fr.consigne,
        lieu: fond.nom,
        nbPhotos,
        nbExemples,
        depuisVersion,
        historique: demandesDeLaLignee(
          message,
          fil,
          new Map(versionsDuFond.map((v) => [v.publicId, v.messageId])),
          fond.precision,
        ),
        demande: message.demande,
      });
      await db
        .update(schema.aiGenerations)
        .set({ prompt: consigne })
        .where(inArray(schema.aiGenerations.id, lignes.map((l) => l.id)));
    } catch (e) {
      await echouer(lignes.map((l) => l.id), e);
      for (const l of lignes) enCours.delete(l.publicId);
      return;
    }

    await Promise.all(
      lignes.map((ligne) =>
        aTonTour(async () => {
          try {
            const png = await dessinateur(bouchon)(images, consigne, {
              modele: reg["ia.modele"],
              taille: TAILLE_FOND,
              qualite: reg["ia.qualite"],
              fidelite: reg["ia.fidelite"],
            });
            const nom = `${ligne.publicId}.png`;
            await writeFile(resolve(FONDS_DIR, nom), await sharp(png).png().toBuffer());
            await sharp(png)
              .resize({ width: 512 })
              .jpeg({ quality: 82 })
              .toFile(resolve(FONDS_DIR, vignetteDe(ligne.publicId)));
            await db
              .update(schema.aiGenerations)
              .set({
                status: "prete",
                fullPath: `ia/fonds/${nom}`,
                // Le coût réservé au lancement, reposé avec le statut : une
                // version prête le porte toujours, quoi qu'il soit arrivé à
                // la ligne entre-temps.
                costCents: ligne.coutCents,
              })
              .where(eq(schema.aiGenerations.id, ligne.id));
            // Comme dans une discussion : la réponse la plus récente devient
            // l'image courante, sauf si Margaux en a déjà choisi une plus
            // récente entre-temps.
            await db.execute(raw`
              update fond_ia set version_courante = ${ligne.publicId}
              where id = ${fond.id}
                and (version_courante is null
                  or coalesce((select g.fond_message_id from ai_generation g
                               where g.public_id = fond_ia.version_courante), 0) < ${message.id})`);
          } catch (e) {
            await echouer([ligne.id], e);
          } finally {
            enCours.delete(ligne.publicId);
          }
        }),
      ),
    );
  })();
}

/* -------------------------------------------------------------------------- */
/*  Lecture                                                                   */
/* -------------------------------------------------------------------------- */

/** Une phrase pour la boutique, jamais le message brut du prestataire. */
function raisonLisible(brut: string | null): string | null {
  if (!brut) return null;
  if (/interrompue|introuvable/i.test(brut)) return brut;
  if (/insufficient_quota|credit_balance|no credits/i.test(brut))
    return "Solde OpenAI épuisé : rechargez le compte, puis recommencez.";
  if (/invalid_api_key|incorrect api key|401/i.test(brut))
    return "Clé OpenAI refusée : elle doit être remplacée sur le serveur.";
  if (/safety|moderation|content_policy/i.test(brut))
    return "Le modèle a refusé l'image (filtre de contenu). Reformulez, ou essayez une autre photo.";
  return "Le dessin a échoué. Recommencez.";
}

/**
 * Les versions de ces fonds, les interrompues passées en échec au passage —
 * leur coût réservé rendu au plafond.
 */
async function versionsDe(fondIds: number[]) {
  if (!fondIds.length) return [];
  const g = schema.aiGenerations;
  const lignes = await db
    .select({
      id: g.id,
      publicId: g.publicId,
      fondId: g.fondId,
      messageId: g.fondMessageId,
      statut: g.status,
      erreur: g.erreur,
      creeLe: g.createdAt,
      costCents: g.costCents,
    })
    .from(g)
    .where(inArray(g.fondId, fondIds))
    .orderBy(asc(g.id));
  const interrompues = lignes.filter((l) => l.statut === "en_cours" && !enCours.has(l.publicId));
  if (interrompues.length) {
    await db
      .update(g)
      .set({ status: "echec", erreur: MESSAGE_INTERROMPUE, costCents: 0 })
      .where(and(inArray(g.id, interrompues.map((l) => l.id)), eq(g.status, "en_cours")));
    for (const l of interrompues) {
      l.statut = "echec";
      l.erreur = MESSAGE_INTERROMPUE;
      l.costCents = 0;
    }
  }
  return lignes.map((l) => ({
    publicId: l.publicId,
    fondId: l.fondId!,
    messageId: l.messageId,
    statut: l.statut as "en_cours" | "prete" | "echec",
    erreur: raisonLisible(l.erreur),
    creeLe: l.creeLe,
    coutCents: l.costCents,
    image: l.statut === "prete" ? `/admin/fonds-ia/images/${l.publicId}` : null,
    vignette: l.statut === "prete" ? `/admin/fonds-ia/images/${l.publicId}?taille=vignette` : null,
  }));
}

/**
 * Ce que l'écran montre de chaque fond : son état (celui de son DERNIER
 * message — c'est lui qu'on attend), sa version courante, et, si on le
 * demande, toute sa discussion.
 */
async function resumes(fonds: Fond[], avecFil = false) {
  const ids = fonds.map((f) => f.id);
  const versions = await versionsDe(ids);
  const messages = ids.length
    ? await db
        .select()
        .from(schema.fondsIaMessages)
        .where(inArray(schema.fondsIaMessages.fondId, ids))
        .orderBy(asc(schema.fondsIaMessages.id))
    : [];
  return fonds.map((f) => {
    const siens = messages.filter((m) => m.fondId === f.id);
    const dernier = siens.at(-1);
    const siennes = versions.filter((v) => v.fondId === f.id);
    const courante = siennes.find((v) => v.publicId === f.versionCourante && v.statut === "prete") ?? null;
    return {
      id: f.id,
      lot: f.lot,
      nom: f.nom,
      precision: f.precision,
      creeLe: f.creeLe,
      styleId: f.styleId,
      photo: `/admin/fonds-ia/${f.id}/photo`,
      versionCourante: courante,
      versionGardee: f.versionGardee,
      backgroundId: f.backgroundId,
      enregistreLe: f.enregistreLe,
      messages: siens.length,
      // Ce que ce fond a coûté : ses versions dessinées. Celles en cours ne
      // portent qu'un coût réservé (compté dans le plafond, pas ici).
      depenseCents: siennes
        .filter((v) => v.statut === "prete")
        .reduce((s, v) => s + (v.coutCents ?? 0), 0),
      ...etatDuFond(siennes.filter((v) => v.messageId === dernier?.id).map((v) => v.statut)),
      ...(avecFil
        ? {
            fil: siens.map((m, i) => ({
              id: m.id,
              rang: i + 1,
              creeLe: m.creeLe,
              texte: m.texte,
              depuisZero: !m.baseVersion,
              baseVersion: m.baseVersion,
              versions: siennes.filter((v) => v.messageId === m.id),
            })),
          }
        : {}),
    };
  });
}

/* -------------------------------------------------------------------------- */
/*  Routes                                                                    */
/* -------------------------------------------------------------------------- */

function refuseSiPasProprietaire(c: Context) {
  if (c.get("utilisateur")?.role !== "owner")
    return c.json({ error: "La création de fonds est réservée à la propriétaire." }, 403);
  return null;
}

const euros = (c: number) => `${(Math.max(0, c) / 100).toFixed(2).replace(".", ",")} €`;

/**
 * Peut-on lancer `images` images ? Une phrase de refus, ou null.
 *
 * Le plafond est CELUI DES FONDS, et la dépense celle des fonds, versions en
 * cours comprises (leur coût est réservé dès le lancement) : les affiches des
 * clients n'y entrent pas, et un lot ne les coupe jamais (relecture du 20/11).
 *
 * Appelée une première fois sans verrou, pour refuser avant de lire les
 * photos ; puis, avec `executeur` = la transaction, sous le verrou du
 * plafond, juste avant de réserver : c'est ce second regard qui fait foi.
 */
async function refusDeDepense(
  images: number,
  fr: ReglagesFonds,
  executeur: LecteurDepense & Pick<typeof db, "update"> = db,
): Promise<string | null> {
  if (bouchonActif(fr.bouchon)) return null;
  if (!iaConfiguree)
    return "La génération IA n'est pas configurée sur ce serveur (clé OpenAI absente).";
  // Une réservation laissée par un dessin interrompu (l'API a redémarré)
  // ne doit pas fermer le plafond : elle est rendue avant de compter.
  await solderLesInterrompues(executeur);
  const depense = await depenseDuMoisCents("fonds", executeur);
  if (!plafondDepasse(depense, images, fr.coutParVersionCents, fr.plafondCents)) return null;
  return (
    `Ce lancement (environ ${euros(coutEstimeCents(images, fr.coutParVersionCents))}) ` +
    `dépasserait le plafond des fonds de ce mois : il reste ${euros(resteSousLePlafond(depense, fr.plafondCents))} ` +
    `sur ${euros(fr.plafondCents)}. Demandez moins de photos ou de versions, ou relevez ce plafond ` +
    "dans Créer un fond › Réglages des fonds. Les affiches des clients ont leur propre plafond : " +
    "elles ne sont pas touchées."
  );
}

const jetonValide = (j: unknown) => /^[A-Za-z0-9-]{8,80}$/.test(String(j ?? ""));

async function fondDuNumero(id: string): Promise<Fond | null> {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  const [f] = await db.select().from(schema.fondsIa).where(eq(schema.fondsIa.id, n));
  return f ?? null;
}

export function mountFondsIa(app: Hono): void {
  /** De quoi remplir l'écran : réglages, styles, décors d'exemple, affiches, lots récents. */
  app.get("/admin/fonds-ia/catalogue", async (c) => {
    const refus = refuseSiPasProprietaire(c);
    if (refus) return refus;
    const fr = await reglagesFonds();
    // Une réservation laissée par un dessin interrompu ne doit pas peser sur
    // le « il reste » montré ici, ni sur la confirmation d'un lot.
    await solderLesInterrompues();
    const [decors, styles, affiches, recents, depenseFonds] = await Promise.all([
      decorsProposables(),
      stylesProposables(),
      db
        .select({ id: schema.products.id, nom: schema.products.name })
        .from(schema.products)
        .where(
          and(
            eq(schema.products.kind, "personnalisable"),
            eq(schema.products.aiEnabled, false),
            raw`${schema.products.status} <> 'archived'`,
          ),
        )
        .orderBy(asc(schema.products.name)),
      db.select().from(schema.fondsIa).orderBy(desc(schema.fondsIa.id)).limit(80),
      depenseDuMoisCents("fonds"),
    ]);
    return c.json({
      reglages: {
        consigne: fr.consigne,
        consigneParDefaut: fr.consigneParDefaut,
        consigneDefaut: CONSIGNE_FOND_DEFAUT,
        versions: fr.versions,
        coutParVersionCents: fr.coutParVersionCents,
        exemples: await exemplesRetenus(fr.exemples),
      },
      limites: {
        photos: PHOTOS_MAX,
        versions: VERSIONS_MAX,
        exemples: EXEMPLES_MAX,
        nom: NOM_MAX,
        precision: PRECISION_MAX,
        message: MESSAGE_MAX,
      },
      styles,
      styleDefaut: styleParDefaut(styles)?.id ?? null,
      retouches: RETOUCHES.map((r) => ({ cle: r.cle, libelle: r.libelle })),
      configuree: iaConfiguree,
      bouchon: bouchonActif(fr.bouchon),
      // La dépense et le plafond DES FONDS ce mois-ci (versions en cours
      // comprises : leur coût est réservé). Ceux des affiches des clients
      // sont à part, dans BO › Affiches IA.
      depenseCents: depenseFonds,
      plafondCents: fr.plafondCents,
      plafondFonds: {
        plafondCents: fr.plafondCents,
        parDefaut: fr.plafondParDefaut,
        reglageCents: fr.plafondReglageCents,
        defautCents: fr.plafondDefautCents,
        depenseCents: depenseFonds,
        resteCents: resteSousLePlafond(depenseFonds, fr.plafondCents),
        plafondAffichesCents: fr.plafondAffichesCents,
      },
      decors: decors.map((d) => ({ id: d.id, nom: d.nom ?? `Décor n° ${d.id}`, url: d.url })),
      affiches,
      fonds: await resumes(recents),
    });
  });

  /**
   * Un lot : plusieurs photos DIFFÉRENTES, chacune donne son fond.
   *
   * Multipart : « photos » (1 à 10 fichiers), « nomLot », « noms » (un par
   * photo, dans l'ordre ; vide = le nom du lot), « styleId », « precision »,
   * « versions », « exemples » (identifiants de décors ; « aucun » : pas
   * d'exemple ; absent : ceux d'office), « jeton ».
   */
  app.post("/admin/fonds-ia/lots", async (c) => {
    const refus = refuseSiPasProprietaire(c);
    if (refus) return refus;
    const annonce = Number(c.req.header("content-length") ?? 0);
    if (annonce > PHOTOS_MAX * PHOTO_MAX_OCTETS + 64 * 1024)
      return c.json({ error: `Trop lourd : ${PHOTOS_MAX} photos de 12 Mo au plus.` }, 413);
    const form = await c.req.formData().catch(() => null);
    if (!form) return c.json({ error: "Envoi illisible : réessayez." }, 400);

    const jeton = String(form.get("jeton") ?? "");
    if (!jetonValide(jeton))
      return c.json({ error: "Rechargez la page, puis renvoyez les photos." }, 400);
    // Le même envoi, renvoyé (double clic, formulaire renvoyé par le
    // navigateur) : on rend le lot déjà fait. Revenue par « Précédent », la
    // page tire un nouveau jeton (lib/fonds-bo.ts) : un nouvel envoi y est
    // un nouveau lot, confirmé comme tel.
    const [deja] = await db
      .select({ lot: schema.fondsIa.lot })
      .from(schema.fondsIa)
      .where(eq(schema.fondsIa.lot, jeton))
      .limit(1);
    if (deja) return c.json({ lot: deja.lot, deja: true });

    // Le File de l'environnement et celui de Node n'ont pas tout à fait le
    // même type : on ne garde que ce dont on se sert.
    type FichierRecu = { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> };
    const fichiers = form
      .getAll("photos")
      .filter((f) => typeof f !== "string" && f.size > 0) as unknown as FichierRecu[];
    if (!fichiers.length) return c.json({ error: "Ajoutez au moins une photo du lieu." }, 400);
    if (fichiers.length > PHOTOS_MAX)
      return c.json({ error: `${PHOTOS_MAX} photos au plus par lot : faites-en deux.` }, 400);
    const nomLot = nettoyerTexte(form.get("nomLot"), NOM_MAX);
    if (!nomLot)
      return c.json(
        { error: "Donnez un nom au lieu, par exemple « Colmar, la Petite Venise »." },
        400,
      );
    const reg = await reglages();
    const fr = await reglagesFonds(reg);
    const bouchon = bouchonActif(fr.bouchon);
    const versions = bornerVersions(form.get("versions"), fr.versions);
    const precision = nettoyerTexte(form.get("precision"), PRECISION_MAX) || null;
    // « Aucun » dans chaque liste : aucun exemple, pas ceux d'office.
    const exemplesVoulus = exemplesDemandes(form.getAll("exemples"));
    const exemples =
      exemplesVoulus === "aucun" ? [] : await exemplesRetenus(exemplesVoulus ?? []);
    const styles = await stylesProposables();
    const styleDemande = Number(form.get("styleId"));
    const style =
      styles.find((s) => s.id === styleDemande) ??
      (String(form.get("styleId") ?? "") === "aucun" ? null : styleParDefaut(styles));

    // Un premier regard sur le plafond, avant de lire les photos : un refus
    // ne coûte alors rien. Il est relu sous verrou au moment de réserver.
    const images = fichiers.length * versions;
    const pasPossible = await refusDeDepense(images, fr);
    if (pasPossible) return c.json({ error: pasPossible }, 409);

    // Les photos d'abord, toutes, EN MÉMOIRE : une photo refusée refuse le lot
    // entier, avant qu'un centime ne parte et sans rien laisser sur le disque.
    const lues: Buffer[] = [];
    for (const [i, f] of fichiers.entries()) {
      if (f.size > PHOTO_MAX_OCTETS)
        return c.json({ error: `La photo ${i + 1} (« ${f.name} ») dépasse 12 Mo.` }, 413);
      const p = await normaliserPhoto(Buffer.from(await f.arrayBuffer()));
      if (!p.ok) return c.json({ error: `Photo ${i + 1} (« ${f.name} ») : ${p.erreur}.` }, 415);
      lues.push(p.donnees);
    }
    const photos = lues.map(() => `ia/fonds/${randomUUID()}.jpg`);
    try {
      for (const [i, donnees] of lues.entries())
        await writeFile(resolve(FONDS_DIR, basename(photos[i]!)), donnees);
    } catch (e) {
      await effacerPhotosDuLot(photos);
      console.error("Créer un fond : photos du lot non enregistrées :", e);
      return c.json(
        { error: "Les photos n'ont pas pu être enregistrées. Réessayez dans un instant." },
        500,
      );
    }
    const noms = nomsDuLot(nomLot, form.getAll("noms"), photos.length);
    const creePar = c.get("utilisateur")?.email ?? null;
    const ip = ipDeLaRequete(c);

    const reservees: string[] = [];
    let crees: { fond: Fond; message: Message; lignes: VersionReservee[] }[];
    try {
      crees = await db.transaction(async (tx) => {
        await verrouillerLePlafond(tx);
        // Le même formulaire, envoyé deux fois au même instant : le second
        // attend le verrou, puis trouve le lot du premier.
        const [encore] = await tx
          .select({ id: schema.fondsIa.id })
          .from(schema.fondsIa)
          .where(eq(schema.fondsIa.lot, jeton))
          .limit(1);
        if (encore) throw new DejaEnvoye();
        // Le second regard, celui qui fait foi : sous le verrou, versions en
        // cours comprises, juste avant de réserver.
        const refusSousVerrou = await refusDeDepense(images, fr, tx);
        if (refusSousVerrou) throw new RefusDuPlafond(refusSousVerrou);

        const sortie: { fond: Fond; message: Message; lignes: VersionReservee[] }[] = [];
        for (const [i, photo] of photos.entries()) {
          const [fond] = await tx
            .insert(schema.fondsIa)
            .values({
              jeton: `${jeton}-${i + 1}`,
              lot: jeton,
              creePar,
              nom: noms[i]!,
              precision,
              photos: [photo],
              exemples,
              styleId: style?.id ?? null,
              versions,
            })
            .returning();
          // Le premier message de la discussion : le dessin de départ.
          const [message] = await tx
            .insert(schema.fondsIaMessages)
            .values({
              fondId: fond!.id,
              creePar,
              jeton: `${jeton}-${i + 1}-1`,
              texte: precision ?? "",
              demande: precision ?? "",
              baseVersion: null,
              versions,
            })
            .returning();
          const lignes = await reserverVersions(tx, fond!, message!, {
            ip,
            bouchon,
            modele: reg["ia.modele"],
            coutParVersionCents: fr.coutParVersionCents,
            reservees,
          });
          sortie.push({ fond: fond!, message: message!, lignes });
        }
        return sortie;
      });
    } catch (e) {
      // Rien n'a été écrit : ni lignes, ni réservations, ni photos à garder.
      for (const id of reservees) enCours.delete(id);
      await effacerPhotosDuLot(photos);
      if (e instanceof RefusDuPlafond) return c.json({ error: e.message }, 409);
      // Le même envoi, passé juste avant (double clic, ou course perdue sur
      // le jeton unique) : on rend son lot. Toute AUTRE erreur est une vraie
      // erreur, et se dit comme telle (relecture du 20/11 : elle répondait
      // « déjà fait » pour un lot qui n'existait pas).
      let gagnant = e instanceof DejaEnvoye;
      if (!gagnant) {
        const [lot] = await db
          .select({ id: schema.fondsIa.id })
          .from(schema.fondsIa)
          .where(eq(schema.fondsIa.lot, jeton))
          .limit(1)
          .catch(() => []);
        gagnant = !!lot;
      }
      if (gagnant) return c.json({ lot: jeton, deja: true });
      console.error("Créer un fond : le lot n'a pas pu être enregistré :", e);
      return c.json({ error: "Le lot n'a pas pu être enregistré. Réessayez dans un instant." }, 500);
    }
    for (const { fond, message, lignes } of crees)
      dessinerMessage(fond, message, lignes, { bouchon, reg, fr });
    return c.json({ lot: jeton, fonds: crees.map((x) => x.fond.id) });
  });

  /** Les fonds d'un lot et leur état : la page du lot le redemande. */
  app.get("/admin/fonds-ia/lots/:lot", async (c) => {
    const refus = refuseSiPasProprietaire(c);
    if (refus) return refus;
    const fonds = await db
      .select()
      .from(schema.fondsIa)
      .where(eq(schema.fondsIa.lot, c.req.param("lot")))
      .orderBy(asc(schema.fondsIa.id));
    if (!fonds.length) return c.json({ error: "Ce lot n'existe pas." }, 404);
    return c.json({ lot: c.req.param("lot"), fonds: await resumes(fonds) });
  });

  /** Un fond, toute sa discussion, et son décor s'il est enregistré. */
  app.get("/admin/fonds-ia/:id{[0-9]+}", async (c) => {
    const refus = refuseSiPasProprietaire(c);
    if (refus) return refus;
    const fond = await fondDuNumero(c.req.param("id"));
    if (!fond) return c.json({ error: "Ce fond n'existe pas." }, 404);
    const [lui] = await resumes([fond], true);
    const voisins = await db
      .select({ id: schema.fondsIa.id, nom: schema.fondsIa.nom })
      .from(schema.fondsIa)
      .where(eq(schema.fondsIa.lot, fond.lot))
      .orderBy(asc(schema.fondsIa.id));
    let decor: { id: number; nom: string | null; url: string; productId: number | null } | null =
      null;
    if (fond.backgroundId) {
      const [b] = await db
        .select({
          id: schema.backgrounds.id,
          nom: schema.backgrounds.name,
          url: schema.backgrounds.url,
          productId: schema.backgrounds.productId,
        })
        .from(schema.backgrounds)
        .where(eq(schema.backgrounds.id, fond.backgroundId));
      decor = b ?? null;
    }
    const [style] = fond.styleId
      ? await db
          .select({ id: schema.aiPrompts.id, title: schema.aiPrompts.title })
          .from(schema.aiPrompts)
          .where(eq(schema.aiPrompts.id, fond.styleId))
      : [];
    return c.json({ ...lui, style: style ?? null, lotFonds: voisins, decor });
  });

  /** La photo du lieu d'un fond. */
  app.get("/admin/fonds-ia/:id{[0-9]+}/photo", async (c) => {
    const refus = refuseSiPasProprietaire(c);
    if (refus) return refus;
    const fond = await fondDuNumero(c.req.param("id"));
    const chemin = cheminFonds(fond?.photos[0]);
    const buf = chemin ? await readFile(chemin).catch(() => null) : null;
    if (!buf) return c.notFound();
    return c.body(new Uint8Array(buf), 200, {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    });
  });

  /** Une version dessinée (?telecharger=1 pour l'enregistrer), ou sa vignette (?taille=vignette). */
  app.get("/admin/fonds-ia/images/:publicId", async (c) => {
    const refus = refuseSiPasProprietaire(c);
    if (refus) return refus;
    const publicId = c.req.param("publicId");
    const [g] = await db
      .select({ fullPath: schema.aiGenerations.fullPath, fondId: schema.aiGenerations.fondId })
      .from(schema.aiGenerations)
      .where(eq(schema.aiGenerations.publicId, publicId));
    if (!g?.fondId) return c.notFound();
    const vignette = c.req.query("taille") === "vignette";
    const chemin = vignette ? cheminFonds(vignetteDe(publicId)) : cheminFonds(g.fullPath);
    const buf = chemin ? await readFile(chemin).catch(() => null) : null;
    if (!buf) return c.notFound();
    return c.body(new Uint8Array(buf), 200, {
      "Content-Type": vignette ? "image/jpeg" : "image/png",
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      ...(c.req.query("telecharger") === "1"
        ? { "Content-Disposition": `attachment; filename="fond-${publicId.slice(0, 8)}.png"` }
        : {}),
    });
  });

  /**
   * Un message de la discussion d'un fond. Corps JSON : { jeton, texte?,
   * retouches?: ["angle", "ciel"…], depuisZero?, versions? }.
   *
   * Il repart de la version COURANTE (édition d'image) ; « depuisZero »
   * redessine à partir de la photo. Une version par message, sauf demande.
   */
  app.post("/admin/fonds-ia/:id{[0-9]+}/messages", async (c) => {
    const refus = refuseSiPasProprietaire(c);
    if (refus) return refus;
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const jeton = String(b.jeton ?? "");
    if (!jetonValide(jeton)) return c.json({ error: "Rechargez la page, puis recommencez." }, 400);
    const [deja] = await db
      .select({ id: schema.fondsIaMessages.id })
      .from(schema.fondsIaMessages)
      .where(eq(schema.fondsIaMessages.jeton, jeton));
    if (deja) return c.json({ messageId: deja.id, deja: true });

    const fond = await fondDuNumero(c.req.param("id"));
    if (!fond) return c.json({ error: "Ce fond n'existe plus. Rechargez la page." }, 404);
    const depuisZero = b.depuisZero === true;
    const { texte, demande } = lireMessage(
      Array.isArray(b.retouches) ? b.retouches : [],
      b.texte,
    );
    if (!depuisZero && !demande)
      return c.json({ error: "Dites ce qu'il faut changer : un bouton, ou quelques mots." }, 400);

    // On repart de la version courante — à condition qu'elle soit prête.
    let baseVersion: string | null = null;
    if (!depuisZero) {
      const [v] = fond.versionCourante
        ? await db
            .select({ publicId: schema.aiGenerations.publicId, statut: schema.aiGenerations.status })
            .from(schema.aiGenerations)
            .where(
              and(
                eq(schema.aiGenerations.publicId, fond.versionCourante),
                eq(schema.aiGenerations.fondId, fond.id),
              ),
            )
        : [];
      if (!v || v.statut !== "prete")
        return c.json(
          {
            error:
              "Aucune version prête d'où repartir : attendez la fin du dessin, ou recommencez de zéro.",
          },
          400,
        );
      baseVersion = v.publicId;
    }

    const reg = await reglages();
    const fr = await reglagesFonds(reg);
    const bouchon = bouchonActif(fr.bouchon);
    const versions = bornerVersions(b.versions, 1);
    const pasPossible = await refusDeDepense(versions, fr);
    if (pasPossible) return c.json({ error: pasPossible }, 409);

    const ip = ipDeLaRequete(c);
    const reservees: string[] = [];
    let cree: { message: Message; lignes: VersionReservee[] };
    try {
      cree = await db.transaction(async (tx) => {
        await verrouillerLePlafond(tx);
        // Le même message, envoyé deux fois au même instant : le second
        // attend le verrou, puis trouve le premier.
        const [encore] = await tx
          .select({ id: schema.fondsIaMessages.id })
          .from(schema.fondsIaMessages)
          .where(eq(schema.fondsIaMessages.jeton, jeton));
        if (encore) throw new DejaEnvoye(encore.id);
        const refusSousVerrou = await refusDeDepense(versions, fr, tx);
        if (refusSousVerrou) throw new RefusDuPlafond(refusSousVerrou);
        const [message] = await tx
          .insert(schema.fondsIaMessages)
          .values({
            fondId: fond.id,
            creePar: c.get("utilisateur")?.email ?? null,
            jeton,
            texte: depuisZero ? ["Recommencer de zéro", texte].filter(Boolean).join(" · ") : texte,
            demande,
            baseVersion,
            versions,
          })
          .returning();
        const lignes = await reserverVersions(tx, fond, message!, {
          ip,
          bouchon,
          modele: reg["ia.modele"],
          coutParVersionCents: fr.coutParVersionCents,
          reservees,
        });
        return { message: message!, lignes };
      });
    } catch (e) {
      for (const id of reservees) enCours.delete(id);
      if (e instanceof RefusDuPlafond) return c.json({ error: e.message }, 409);
      if (e instanceof DejaEnvoye && e.messageId)
        return c.json({ messageId: e.messageId, deja: true });
      const [gagnant] = await db
        .select({ id: schema.fondsIaMessages.id })
        .from(schema.fondsIaMessages)
        .where(eq(schema.fondsIaMessages.jeton, jeton))
        .catch(() => []);
      if (gagnant) return c.json({ messageId: gagnant.id, deja: true });
      console.error(`Créer un fond : le message du fond ${fond.id} n'a pas pu partir :`, e);
      return c.json({ error: "Le message n'a pas pu partir. Réessayez." }, 500);
    }
    dessinerMessage(fond, cree.message, cree.lignes, { bouchon, reg, fr });
    return c.json({ messageId: cree.message.id });
  });

  /** Revenir à une version précédente : le prochain message repartira d'elle. */
  app.post("/admin/fonds-ia/:id{[0-9]+}/courante", async (c) => {
    const refus = refuseSiPasProprietaire(c);
    if (refus) return refus;
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const fond = await fondDuNumero(c.req.param("id"));
    if (!fond) return c.json({ error: "Ce fond n'existe plus. Rechargez la page." }, 404);
    const [v] = await db
      .select({ publicId: schema.aiGenerations.publicId, statut: schema.aiGenerations.status })
      .from(schema.aiGenerations)
      .where(
        and(
          eq(schema.aiGenerations.publicId, String(b.publicId ?? "")),
          eq(schema.aiGenerations.fondId, fond.id),
        ),
      );
    if (!v || v.statut !== "prete")
      return c.json({ error: "Cette version n'est pas prête." }, 400);
    await db
      .update(schema.fondsIa)
      .set({ versionCourante: v.publicId })
      .where(eq(schema.fondsIa.id, fond.id));
    return c.json({ ok: true, versionCourante: v.publicId });
  });

  /**
   * La version gardée devient un décor de la bibliothèque : agrandie en
   * 2048 × 3072, rangée dans data/assets sous un nom sûr et unique (comme
   * /admin/uploads), puis une ligne `background` — rattachée à une affiche,
   * ou à aucune (elle remonte alors par le nom de sa ville, cf. decors.ts).
   * Corps JSON : { publicId, nom, productId? }.
   */
  app.post("/admin/fonds-ia/:id{[0-9]+}/enregistrer", async (c) => {
    const refus = refuseSiPasProprietaire(c);
    if (refus) return refus;
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const fond = await fondDuNumero(c.req.param("id"));
    if (!fond) return c.json({ error: "Ce fond n'existe plus. Rechargez la page." }, 404);
    // Déjà enregistré (double clic, page renvoyée) : on rend le décor existant.
    if (fond.backgroundId) return c.json({ backgroundId: fond.backgroundId, deja: true });

    const [v] = await db
      .select()
      .from(schema.aiGenerations)
      .where(
        and(
          eq(schema.aiGenerations.publicId, String(b.publicId ?? "")),
          eq(schema.aiGenerations.fondId, fond.id),
        ),
      );
    const chemin = v?.status === "prete" ? cheminFonds(v.fullPath) : null;
    const png = chemin ? await readFile(chemin).catch(() => null) : null;
    if (!png) return c.json({ error: "Choisissez une version prête à garder." }, 400);

    const nom = nettoyerTexte(b.nom, NOM_MAX) || fond.nom;
    let productId: number | null = null;
    if (b.productId !== undefined && b.productId !== null && String(b.productId) !== "") {
      const pid = Number(b.productId);
      const [p] = Number.isInteger(pid)
        ? await db
            .select({ id: schema.products.id, kind: schema.products.kind })
            .from(schema.products)
            .where(eq(schema.products.id, pid))
        : [];
      if (!p || p.kind !== "personnalisable")
        return c.json({ error: "Cette affiche n'existe plus, ou n'est pas personnalisable." }, 400);
      productId = p.id;
    }

    const fichier = `${baseNomFichier(nom)}-${randomBytes(4).toString("hex")}.png`;
    await writeFile(
      resolve(ASSETS_DIR, fichier),
      await sharp(png)
        .resize({ width: DECOR_LARGEUR, height: DECOR_HAUTEUR, fit: "cover", kernel: "lanczos3" })
        .png({ compressionLevel: 9 })
        .toBuffer(),
    );
    const url = `/assets/${fichier}`;
    // Le décor n'est acquis qu'au COMMIT : sans lui (double clic, erreur de
    // la base), le fichier tout juste écrit ne serait désigné par rien.
    const oublierLeFichier = () =>
      rm(resolve(ASSETS_DIR, fichier), { force: true }).catch(() => undefined);

    let enregistre: { id: number; deja: boolean };
    try {
      enregistre = await db.transaction(async (tx) => {
        // Revérifié dans la transaction, ligne verrouillée : deux clics
        // simultanés ne font qu'un décor.
        const [encore] = await tx
          .select({ backgroundId: schema.fondsIa.backgroundId })
          .from(schema.fondsIa)
          .where(eq(schema.fondsIa.id, fond.id))
          .for("update");
        if (encore?.backgroundId) return { id: encore.backgroundId, deja: true };
        // À la suite des décors de l'affiche, comme un décor ajouté à sa fiche.
        const [pos] = productId
          ? await tx
              .select({ p: raw<number>`coalesce(max(${schema.backgrounds.position}), -1)::int` })
              .from(schema.backgrounds)
              .where(eq(schema.backgrounds.productId, productId))
          : [{ p: -1 }];
        const [bg] = await tx
          .insert(schema.backgrounds)
          .values({ productId, url, name: nom, position: Number(pos?.p ?? -1) + 1 })
          .returning({ id: schema.backgrounds.id });
        await tx
          .update(schema.fondsIa)
          .set({ versionGardee: v!.publicId, backgroundId: bg!.id, enregistreLe: new Date() })
          .where(eq(schema.fondsIa.id, fond.id));
        return { id: bg!.id, deja: false };
      });
    } catch (e) {
      await oublierLeFichier();
      console.error(`Créer un fond : le fond ${fond.id} n'a pas pu être enregistré comme décor :`, e);
      return c.json({ error: "Le décor n'a pas pu être enregistré. Réessayez dans un instant." }, 500);
    }
    // Le second clic a perdu : le décor du premier est là, ce fichier-ci ne sert à rien.
    if (enregistre.deja) {
      await oublierLeFichier();
      return c.json({ backgroundId: enregistre.id, deja: true });
    }

    // Les versions légères (aperçu du configurateur, vignette), tout de
    // suite et en tâche de fond, comme pour un décor ajouté à une fiche.
    const ici = `http://127.0.0.1:${process.env.API_PORT ?? 3000}${url}`;
    void (async () => {
      for (const l of [1400, 400])
        await fetch(`${ici}?l=${l}`)
          .then((r) => r.arrayBuffer())
          .catch(() => undefined);
    })();
    return c.json({ backgroundId: enregistre.id, url, deja: false });
  });
}
