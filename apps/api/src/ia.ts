/**
 * Affiches générées par IA : la photo du client, la consigne envoyée au
 * modèle, et les deux images qui en sortent.
 *
 * DEUX fichiers, jamais un seul. L'APERÇU porte un filigrane brûlé dans les
 * pixels et c'est le seul que la boutique montre ; la PLEINE DÉFINITION vit
 * dans le même dossier mais n'est servie que par une route /admin/* ou une
 * fois le paiement vérifié. La servir par erreur reviendrait à donner
 * l'affiche — c'est le point le plus sensible de ce module.
 *
 * L'aperçu est SANS QUOTA client : la cliente a tranché en connaissance du
 * coût. Ce qui est protégé ici, c'est son porte-monnaie contre un script
 * (plafond mensuel, garde anti-rafale par IP), pas l'usage d'un vrai visiteur.
 *
 * Sans SDK, comme payments.ts : `fetch` et rien d'autre. La clé est lue dans
 * l'environnement et n'est jamais écrite, ni journalisée, ni renvoyée.
 */
import type { Hono } from "hono";
import type { Context } from "hono";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  isNull,
  isNotNull,
  lt,
  sql as raw,
  type SQL,
} from "drizzle-orm";
import { basename, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { db, schema } from "./db/client.js";
import { clientDeLaRequete } from "./comptes.js";
import {
  STYLE_MEMORY_LINE,
  ajouterDemandeClient,
  appliquerVariables,
} from "./ia-style.js";

/** Mêmes assets que le reste de l'API (cf. ASSETS_DIR dans index.ts). */
const ASSETS_DIR = resolve(fileURLToPath(import.meta.url), "../../../../data/assets");
/** Sous-dossier dédié : rien de ce qui vit ici n'est servi par /assets/:file. */
const IA_DIR = resolve(ASSETS_DIR, "ia");
await mkdir(IA_DIR, { recursive: true });

const OPENAI_KEY = process.env.OPENAI_API_KEY;
/** true si la clé OpenAI est fournie (sinon les routes répondent 503 proprement). */
export const iaConfiguree = Boolean(OPENAI_KEY);

/**
 * Point d'entrée de l'API images, surchargeable par OPENAI_BASE_URL.
 *
 * Dans l'environnement, jamais dans les réglages : cette adresse reçoit la clé
 * secrète, elle n'a rien à faire dans un formulaire du back-office. Elle sert
 * à passer par une passerelle d'entreprise — et à rejouer le parcours complet
 * contre un banc d'essai local, sans dépenser un centime.
 */
const OPENAI_BASE = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(
  /\/+$/,
  "",
);
const OPENAI_IMAGES_EDITS = `${OPENAI_BASE}/images/edits`;
/** Une génération d'image dépasse allègrement la minute : on laisse du temps. */
const OPENAI_TIMEOUT_MS = 180_000;

/* -------------------------------------------------------------------------- */
/*  Réglages                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Réglages du groupe « ia », avec leurs valeurs par défaut.
 *
 * Tout est modifiable au back-office (POST /admin/settings) sans toucher au
 * code : le modèle change tous les six mois, le style de la boutique aussi.
 * Les défauts sont volontairement prudents — modèle et qualité moyens,
 * plafond bas — parce qu'ils s'appliquent tant que personne n'a rien réglé.
 */
const DEFAUTS = {
  /** La consigne officielle, rédigée par la cliente (voir ia-style.ts). */
  "ia.stylePrompt": STYLE_MEMORY_LINE,
  "ia.modele": "gpt-image-1",
  "ia.taille": "1024x1536",
  "ia.qualite": "medium",
  /** « high » conserve les visages de la photo ; « low » coûte moins cher. */
  "ia.fidelite": "high",
  /** Plafond de dépense du mois, en centimes. 50 € = environ 600 aperçus. */
  "ia.plafondMensuelCents": 5000,
  /** ESTIMATION du coût d'un appel : sert au plafond et au suivi, pas à facturer. */
  "ia.coutParImageCents": 8,
  /** Au-delà, photos et aperçus non payés sont effacés (donnée personnelle). */
  "ia.purgeJours": 30,
  /** Garde anti-rafale par IP, par minute. Ce n'est PAS un quota client. */
  "ia.rafaleParMinute": 10,
} as const;

type CleReglage = keyof typeof DEFAUTS;
type Reglages = { [K in CleReglage]: (typeof DEFAUTS)[K] };

/** Tailles acceptées par l'API images : un réglage fantaisiste ferait 400. */
const TAILLES = new Set(["1024x1024", "1024x1536", "1536x1024", "auto"]);

/**
 * Lit les réglages « ia.* » en base, complétés par les défauts.
 *
 * Pas de cache : un aller-retour SQL ne pèse rien à côté d'un appel au modèle,
 * et la cliente doit voir l'effet d'un réglage immédiatement, pas au prochain
 * redémarrage.
 */
async function reglages(): Promise<Reglages> {
  const rows = await db.select().from(schema.settings);
  const trouves = new Map(rows.map((r) => [r.key, r.value]));
  const sortie = { ...DEFAUTS } as Record<string, unknown>;
  for (const cle of Object.keys(DEFAUTS) as CleReglage[]) {
    const v = trouves.get(cle);
    if (v === undefined || v === null || v === "") continue;
    sortie[cle] =
      typeof DEFAUTS[cle] === "number" ? Number(v) : String(v);
  }
  if (!TAILLES.has(String(sortie["ia.taille"])))
    sortie["ia.taille"] = DEFAUTS["ia.taille"];
  for (const cle of [
    "ia.plafondMensuelCents",
    "ia.coutParImageCents",
    "ia.purgeJours",
    "ia.rafaleParMinute",
  ] as const) {
    const n = Number(sortie[cle]);
    sortie[cle] = Number.isFinite(n) && n >= 0 ? n : DEFAUTS[cle];
  }
  return sortie as Reglages;
}

/* -------------------------------------------------------------------------- */
/*  Garde-fous — protègent la DÉPENSE, pas le client                          */
/* -------------------------------------------------------------------------- */

/**
 * Nombre de demandes récentes par IP, en mémoire (un seul process API, comme
 * l'anti-bruteforce du login).
 *
 * À dix par minute, un visiteur qui essaie sérieusement plusieurs styles ne
 * touchera jamais la limite ; un script en boucle, si. Ce n'est PAS un quota
 * client : personne n'est plafonné à N affiches, on refuse seulement la
 * cadence qu'aucune main humaine ne produit.
 */
const rafales = new Map<string, number[]>();

function rafaleDepassee(ip: string, parMinute: number): boolean {
  const maintenant = Date.now();
  const recentes = (rafales.get(ip) ?? []).filter((t) => maintenant - t < 60_000);
  recentes.push(maintenant);
  rafales.set(ip, recentes);
  // Le tableau ne grandit pas indéfiniment (filtré à chaque passage), mais la
  // Map, si : on la vide des IP inactives quand elle devient grosse.
  if (rafales.size > 5000) {
    for (const [k, v] of rafales)
      if (!v.some((t) => maintenant - t < 60_000)) rafales.delete(k);
  }
  return recentes.length > parMinute;
}

function ipDeLaRequete(c: Context): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "local"
  );
}

/** Premier jour du mois en cours (UTC) — borne du plafond et des statistiques. */
function debutDuMois(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1));
}

/** Dépense estimée depuis le 1er du mois, en centimes. */
async function depenseDuMoisCents(): Promise<number> {
  const [row] = await db
    .select({ total: raw<number>`coalesce(sum(${schema.aiGenerations.costCents}), 0)::int` })
    .from(schema.aiGenerations)
    .where(gte(schema.aiGenerations.createdAt, debutDuMois()));
  return Number(row?.total ?? 0);
}

/* -------------------------------------------------------------------------- */
/*  Fichiers                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Résout un chemin stocké en base (« ia/xxx.jpg ») en chemin disque.
 * Renvoie null si la valeur essaie de sortir du dossier des assets : les
 * chemins viennent de la base, mais un jour l'un d'eux viendra d'ailleurs.
 */
function cheminDisque(relatif: string | null | undefined): string | null {
  if (!relatif) return null;
  const chemin = resolve(ASSETS_DIR, relatif);
  return chemin.startsWith(IA_DIR) ? chemin : null;
}

const MIME_SORTIE: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/**
 * Filigrane brûlé dans les pixels de l'aperçu : le logo de la boutique, en
 * blanc, répété en diagonale.
 *
 * Un calque CSS se retire depuis l'inspecteur du navigateur en trois clics ;
 * une image marquée, non. Le logo est posé deux fois — une ombre sombre
 * décalée d'un rien, puis la silhouette blanche par-dessus — parce qu'un
 * filigrane blanc disparaît sur un ciel de neige et un filigrane noir sur une
 * nuit. Densité réglée pour gêner la réutilisation sans empêcher de juger
 * l'affiche.
 *
 * C'est le MÊME fichier que celui du navigateur (apps/web/public), pour que
 * l'aperçu IA et l'aperçu du configurateur portent la même marque.
 */
const LOGO_FILIGRANE = resolve(
  fileURLToPath(import.meta.url),
  "../../marque/logo-filigrane.png",
);

/** Le logo blanc ramené à une opacité donnée : on atténue son canal alpha. */
async function logoAttenue(largeur: number, opacite: number, sombre: boolean): Promise<Buffer> {
  const base = sharp(LOGO_FILIGRANE).resize({ width: largeur });
  // negate() sans toucher à l'alpha : la silhouette blanche devient noire,
  // ses bords transparents restent transparents.
  const couleur = sombre ? base.clone().negate({ alpha: false }) : base.clone();
  const rgb = await couleur.removeAlpha().toBuffer();
  const alpha = await base.clone().extractChannel("alpha").linear(opacite, 0).toBuffer();
  return sharp(rgb).joinChannel(alpha).png().toBuffer();
}

/**
 * Calques à composer sur l'aperçu : le logo en quinconce sur une grille
 * tournée de 30°. Une ligne sur deux est décalée : aligné, le filigrane
 * laisse des couloirs vides qu'un recadrage suffit à isoler.
 */
async function calquesFiligrane(
  largeur: number,
  hauteur: number,
): Promise<{ input: Buffer; left: number; top: number }[]> {
  const logoLargeur = Math.max(120, Math.round(largeur * 0.26));
  const ombre = await logoAttenue(logoLargeur, 0.16, true);
  const blanc = await logoAttenue(logoLargeur, 0.24, false);
  const { width: lw = logoLargeur, height: lh = Math.round(logoLargeur * 0.444) } =
    await sharp(blanc).metadata();

  // La grille est calculée dans un repère tourné de -30°, puis chaque point
  // est ramené dans le repère de l'image : c'est ce qui donne les diagonales.
  const angle = (-30 * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const pasX = lw * 1.6;
  const pasY = lh * 2.2;
  const diag = Math.ceil(Math.hypot(largeur, hauteur));
  const cx = largeur / 2;
  const cy = hauteur / 2;
  const calques: { input: Buffer; left: number; top: number }[] = [];
  let rang = 0;
  for (let y = -diag; y < diag; y += pasY) {
    const depart = -diag + (rang % 2) * (pasX / 2);
    for (let x = depart; x < diag; x += pasX) {
      const px = Math.round(cx + x * cos - y * sin);
      const py = Math.round(cy + x * sin + y * cos);
      // Hors image : sharp refuse un calque entièrement en dehors.
      if (px + lw < 0 || py + lh < 0 || px > largeur || py > hauteur) continue;
      calques.push({ input: ombre, left: px + 2, top: py + 2 });
      calques.push({ input: blanc, left: px, top: py });
    }
    rang++;
  }
  return calques;
}

/** Aperçu filigrané : 1024 px au plus grand côté, JPEG (léger à servir). */
export async function fabriquerApercu(pleine: Buffer, nom: string): Promise<string> {
  const reduite = await sharp(pleine)
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .toBuffer();
  const meta = await sharp(reduite).metadata();
  const marquee = await sharp(reduite)
    .composite(await calquesFiligrane(meta.width ?? 1024, meta.height ?? 1024))
    .jpeg({ quality: 82 })
    .toBuffer();
  await writeFile(resolve(IA_DIR, nom), marquee);
  return `ia/${nom}`;
}

/* -------------------------------------------------------------------------- */
/*  Appel du modèle                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Édite la photo du client avec le modèle d'images d'OpenAI et renvoie
 * l'image produite.
 *
 * ÉDITION et non génération : la photo est l'entrée, c'est elle qui porte le
 * lieu et les visages. Une génération à partir du seul texte donnerait une
 * jolie affiche qui n'aurait rien à voir avec le souvenir du client.
 */
async function editerImage(
  photo: Buffer,
  nomPhoto: string,
  consigne: string,
  modele: string,
  taille: string,
  qualite: string,
  fidelite: string,
): Promise<Buffer> {
  const envoyer = async (avecOptions: boolean): Promise<Response> => {
    const form = new FormData();
    form.append(
      "image",
      new Blob([new Uint8Array(photo)], { type: "image/jpeg" }),
      nomPhoto,
    );
    form.append("prompt", consigne);
    form.append("model", modele);
    form.append("size", taille);
    form.append("n", "1");
    if (avecOptions) {
      if (qualite) form.append("quality", qualite);
      if (fidelite) form.append("input_fidelity", fidelite);
    }
    return fetch(OPENAI_IMAGES_EDITS, {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
      body: form,
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    });
  };

  let res = await envoyer(true);
  if (!res.ok) {
    const detail = await res.text();
    // Les options fines (qualité, fidélité d'entrée) n'existent pas sur tous
    // les modèles : plutôt que de perdre la génération, on réessaie nu.
    if (res.status === 400 && /quality|input_fidelity|unknown|unsupported/i.test(detail))
      res = await envoyer(false);
    else throw new Error(`OpenAI HTTP ${res.status} ${detail.slice(0, 500)}`);
  }
  if (!res.ok)
    throw new Error(`OpenAI HTTP ${res.status} ${(await res.text()).slice(0, 500)}`);

  const json = (await res.json()) as {
    data?: { b64_json?: string; url?: string }[];
  };
  const premiere = json.data?.[0];
  if (premiere?.b64_json) return Buffer.from(premiere.b64_json, "base64");
  if (premiere?.url) {
    const img = await fetch(premiere.url, { signal: AbortSignal.timeout(60_000) });
    if (!img.ok) throw new Error(`Téléchargement image HTTP ${img.status}`);
    return Buffer.from(await img.arrayBuffer());
  }
  throw new Error("Réponse OpenAI sans image");
}

/* -------------------------------------------------------------------------- */
/*  Rattachement au paiement                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Rattache les générations d'un panier aux lignes de la commande payée et
 * pose `paidAt`. C'est cette date qui les sort de la purge : une affiche
 * achetée doit être réimprimable dans six mois.
 *
 * Ligne par ligne, du plus sûr au plus approximatif : l'identifiant que la
 * boutique a rangé dans `order_item.config.aiPublicId`, puis une liaison déjà
 * posée (POST /ia/lier), puis à défaut la génération la plus récente du même
 * produit. Ce dernier repli n'est qu'un filet : sans lui, un panier construit
 * par une version plus ancienne de la boutique perdrait son affiche.
 *
 * `config` vient du navigateur du client : on ne cherche l'identifiant qu'il
 * annonce que parmi les générations de SON panier, jamais dans toute la table.
 * Réclamer l'affiche d'un autre reviendrait sinon à la lui offrir.
 *
 * Ne lève jamais : une commande payée reste payée même si le rattachement
 * échoue. On perdrait l'image, pas l'argent.
 */
export async function rattacherGenerationsAuPanier(
  orderId: number,
  cartId: string | null,
  customerId: number | null,
): Promise<number> {
  if (!cartId) return 0;
  try {
    const generations = await db
      .select()
      .from(schema.aiGenerations)
      .where(
        and(
          eq(schema.aiGenerations.cartId, cartId),
          eq(schema.aiGenerations.status, "prete"),
          isNull(schema.aiGenerations.paidAt),
        ),
      )
      .orderBy(desc(schema.aiGenerations.createdAt));

    if (!generations.length) return 0;

    const lignes = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId))
      .orderBy(asc(schema.orderItems.id));
    const maintenant = new Date();
    const retenues = new Set<number>();
    let rattachees = 0;

    for (const ligne of lignes) {
      const annonce = (ligne.config as { aiPublicId?: unknown } | null)?.aiPublicId;
      const publicId = typeof annonce === "string" ? annonce : null;
      const candidate =
        (publicId
          ? generations.find((g) => g.publicId === publicId && !retenues.has(g.id))
          : null) ??
        generations.find((g) => g.orderItemId === ligne.id && !retenues.has(g.id)) ??
        generations.find(
          (g) =>
            g.orderItemId == null &&
            !retenues.has(g.id) &&
            ligne.productId != null &&
            g.productId === ligne.productId,
        );
      if (!candidate) continue;
      await db
        .update(schema.aiGenerations)
        .set({
          orderItemId: ligne.id,
          paidAt: maintenant,
          customerId: customerId ?? candidate.customerId,
        })
        .where(eq(schema.aiGenerations.id, candidate.id));
      retenues.add(candidate.id);
      rattachees++;
    }
    return rattachees;
  } catch (e) {
    console.error("Rattachement des générations IA échoué (commande " + orderId + ") :", e);
    return 0;
  }
}

/* -------------------------------------------------------------------------- */
/*  Purge                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Efface photos, aperçus et pleines définitions des générations NON PAYÉES de
 * plus de `jours` jours.
 *
 * La photo d'un visiteur est une donnée personnelle : on ne la garde pas « au
 * cas où ». La LIGNE, elle, reste — vidée de ses chemins : c'est ce qui permet
 * de répondre « combien a coûté le mois de mars » un an plus tard, sans
 * conserver le moindre visage.
 */
export async function purgerGenerationsIa(
  jours: number,
  simulation = false,
): Promise<{ lignes: number; fichiers: number; jours: number }> {
  const limite = new Date(Date.now() - Math.max(0, jours) * 86_400_000);
  const anciennes = await db
    .select()
    .from(schema.aiGenerations)
    .where(
      and(
        isNull(schema.aiGenerations.paidAt),
        lt(schema.aiGenerations.createdAt, limite),
      ),
    );

  let fichiers = 0;
  for (const g of anciennes) {
    for (const relatif of [g.sourcePath, g.previewPath, g.fullPath]) {
      const chemin = cheminDisque(relatif);
      if (!chemin) continue;
      if (simulation) {
        fichiers++;
        continue;
      }
      try {
        await rm(chemin, { force: true });
        fichiers++;
      } catch (e) {
        console.error("Purge IA : suppression impossible de " + relatif + " :", e);
      }
    }
    if (!simulation)
      await db
        .update(schema.aiGenerations)
        .set({ sourcePath: null, previewPath: null, fullPath: null })
        .where(eq(schema.aiGenerations.id, g.id));
  }
  return { lignes: anciennes.length, fichiers, jours };
}

/* -------------------------------------------------------------------------- */
/*  Routes                                                                    */
/* -------------------------------------------------------------------------- */

const PHOTO_MAX_OCTETS = 12 * 1024 * 1024;
const PHOTO_FORMATS = new Set(["jpeg", "png", "webp"]);
/** Au-delà, on paierait des pixels que le modèle n'utilise pas. */
const PHOTO_COTE_MAX = 2048;
/** La précision du client est reprise telle quelle dans la consigne : on la borne. */
const PRECISION_MAX = 400;

export function mountIaRoutes(app: Hono): void {
  /* ---------------------------------------------------------------------- */
  /*  Boutique                                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * Reçoit la photo du client.
   *
   * MULTIPART (`multipart/form-data`, champ « photo », alias « file ») plutôt
   * que base64 : une photo de 12 Mo pèse 16 Mo une fois encodée, et il faudrait
   * la garder entière en mémoire des deux côtés. Le navigateur, lui, sait
   * envoyer un File sans rien encoder.
   *
   * Le type DÉCLARÉ n'est pas cru : c'est sharp qui dit ce qu'est le fichier.
   * L'image est réduite à 2048 px au grand côté et ré-encodée en JPEG, ce qui
   * a un effet de bord voulu — les métadonnées EXIF disparaissent, dont la
   * position GPS que porte toute photo de vacances prise au téléphone.
   *
   * Renvoie { photo } : le chemin à repasser à /ia/generer.
   */
  app.post("/ia/photo", async (c) => {
    // PAS de garde anti-rafale ici : envoyer une photo ne dépense rien chez le
    // prestataire. Le garde protège la facture, il vit donc sur /ia/generer et
    // nulle part ailleurs — posé ici, il refusait au client de changer d'avis
    // sur sa photo, ce qui est exactement ce qu'on veut qu'il puisse faire.
    // Le poids du fichier et son format restent contrôlés, eux, juste après.

    // On refuse sur l'en-tête avant de mettre le corps en mémoire.
    const annonce = Number(c.req.header("content-length") ?? 0);
    if (annonce > PHOTO_MAX_OCTETS + 1024)
      return c.json({ error: "Photo trop lourde (12 Mo maximum)" }, 413);

    const form = await c.req.formData().catch(() => null);
    const fichier = form?.get("photo") ?? form?.get("file");
    if (!(fichier instanceof File) || !fichier.size)
      return c.json({ error: "Aucune photo reçue (champ « photo »)" }, 400);
    if (fichier.size > PHOTO_MAX_OCTETS)
      return c.json({ error: "Photo trop lourde (12 Mo maximum)" }, 413);

    const brut = Buffer.from(await fichier.arrayBuffer());
    let largeur = 0;
    let hauteur = 0;
    let normalisee: Buffer;
    try {
      const meta = await sharp(brut).metadata();
      if (!meta.format || !PHOTO_FORMATS.has(meta.format))
        return c.json({ error: "Format refusé : envoyez un JPEG, un PNG ou un WebP" }, 415);
      normalisee = await sharp(brut)
        // .rotate() applique l'orientation EXIF AVANT qu'on la jette, sinon
        // les photos prises à la verticale arriveraient couchées.
        .rotate()
        .resize({
          width: PHOTO_COTE_MAX,
          height: PHOTO_COTE_MAX,
          fit: "inside",
          withoutEnlargement: true,
        })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 90 })
        .toBuffer();
      const apres = await sharp(normalisee).metadata();
      largeur = apres.width ?? 0;
      hauteur = apres.height ?? 0;
    } catch {
      return c.json({ error: "Fichier illisible : ce n'est pas une image valide" }, 415);
    }

    const nom = `${randomUUID()}.jpg`;
    await writeFile(resolve(IA_DIR, nom), normalisee);
    return c.json({
      photo: `ia/${nom}`,
      largeur,
      hauteur,
      octets: normalisee.byteLength,
    });
  });

  /**
   * Génère l'affiche à partir de la photo envoyée.
   *
   * Corps JSON : { productId, photo, cartId, precision? }.
   *
   * La ligne `ai_generation` est écrite AVANT l'appel au modèle et mise à jour
   * après. Un échec laisse donc une ligne « echec » avec son message : sans
   * ça, une génération qui ne rend rien reste un mystère définitif.
   *
   * Ne renvoie QUE l'URL de l'aperçu filigrané.
   */
  app.post("/ia/generer", async (c) => {
    if (!iaConfiguree)
      return c.json({ error: "Génération IA non configurée" }, 503);

    const reg = await reglages();
    const ip = ipDeLaRequete(c);
    if (rafaleDepassee(ip, reg["ia.rafaleParMinute"]))
      return c.json({ error: "Trop de demandes d'affilée, réessayez dans une minute" }, 429);

    // Plafond de DÉPENSE, pas quota client : il protège le porte-monnaie de la
    // boutique d'un script qui bouclerait la nuit. Contrôlé avant l'appel ; la
    // dépense n'est donc jamais dépassée que du coût d'une image lancée en même
    // temps qu'une autre, ce qu'aucun verrou ne vaudrait la peine d'éviter.
    const depense = await depenseDuMoisCents();
    if (depense >= reg["ia.plafondMensuelCents"])
      return c.json(
        {
          error:
            "La création d'affiches par IA est momentanément suspendue. " +
            "Réessayez plus tard ou contactez-nous.",
          plafondAtteint: true,
        },
        503,
      );

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const productId = Number(body.productId);
    const cartId = body.cartId ? String(body.cartId) : null;
    const precision = String(body.precision ?? "")
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .trim()
      .slice(0, PRECISION_MAX);

    const [produit] = Number.isFinite(productId)
      ? await db.select().from(schema.products).where(eq(schema.products.id, productId))
      : [];
    if (!produit) return c.json({ error: "Affiche introuvable" }, 404);
    if (!produit.aiEnabled)
      return c.json({ error: "Cette affiche ne se crée pas à partir d'une photo" }, 400);

    // basename() : le chemin vient du client, il ne désignera rien d'autre
    // qu'un fichier de data/assets/ia.
    const nomPhoto = basename(String(body.photo ?? "").split("?")[0] ?? "");
    const cheminPhoto = nomPhoto ? resolve(IA_DIR, nomPhoto) : null;
    if (!cheminPhoto || !cheminPhoto.startsWith(IA_DIR) || extname(nomPhoto) !== ".jpg")
      return c.json({ error: "Photo invalide : renvoyez-la d'abord à /ia/photo" }, 400);
    let photo: Buffer;
    try {
      photo = await readFile(cheminPhoto);
    } catch {
      return c.json({ error: "Photo introuvable : renvoyez-la d'abord à /ia/photo" }, 404);
    }

    // La consigne officielle décrit le style ; ce que le client demande vient
    // s'ajouter À LA FIN, clairement annoncé — le modèle retient mieux ce qui
    // vient en dernier, et la consigne rappelle elle-même que la fidélité à la
    // photo passe avant toute demande particulière.
    //
    // `appliquerVariables` reste appelée : le texte est modifiable au
    // back-office, et un marqueur {{...}} qui y serait remis partirait sinon
    // tel quel au modèle, qui le lirait comme une consigne.
    // « adapté au format A3, vertical ou horizontal, cela dépendra de la photo »
    // (consigne de la boutique) : une photo de plage en largeur rendue en
    // portrait perdrait la moitié de la scène, ou serait complétée par du
    // décor inventé — ce que la consigne interdit par ailleurs.
    const dimensions = await sharp(photo).metadata();
    const paysage = (dimensions.width ?? 0) > (dimensions.height ?? 0);
    const orientation = paysage ? "horizontale" : "verticale";
    const tailleChoisie = TAILLES.has(reg["ia.taille"])
      ? paysage
        ? "1536x1024"
        : "1024x1536"
      : reg["ia.taille"];

    const consigne = ajouterDemandeClient(
      [
        appliquerVariables(reg["ia.stylePrompt"], {
          OUTPUT_FORMAT: `affiche A3, orientation ${orientation}`,
          CUSTOMER_REQUEST: precision,
        }),
        produit.aiStylePrompt ?? "",
      ]
        .map((s) => s.trim())
        .filter(Boolean)
        .join("\n\n"),
      precision,
    );

    const client = await clientDeLaRequete(c);
    const publicId = randomUUID();
    const [ligne] = await db
      .insert(schema.aiGenerations)
      .values({
        publicId,
        productId: produit.id,
        cartId,
        customerId: client?.id ?? null,
        sourcePath: `ia/${nomPhoto}`,
        prompt: consigne,
        model: reg["ia.modele"],
        size: tailleChoisie,
        status: "en_cours",
        ip,
      })
      .returning();

    try {
      const pleine = await editerImage(
        photo,
        nomPhoto,
        consigne,
        reg["ia.modele"],
        tailleChoisie,
        reg["ia.qualite"],
        reg["ia.fidelite"],
      );
      const nomPleine = `${publicId}-pleine.png`;
      await writeFile(resolve(IA_DIR, nomPleine), pleine);
      const apercu = await fabriquerApercu(pleine, `${publicId}-apercu.jpg`);

      await db
        .update(schema.aiGenerations)
        .set({
          status: "prete",
          previewPath: apercu,
          fullPath: `ia/${nomPleine}`,
          costCents: reg["ia.coutParImageCents"],
        })
        .where(eq(schema.aiGenerations.id, ligne!.id));

      // Jamais fullPath ici : l'affiche sans filigrane n'est pas encore payée.
      return c.json({ publicId, status: "prete", apercu: `/ia/apercu/${publicId}` });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await db
        .update(schema.aiGenerations)
        .set({ status: "echec", erreur: message.slice(0, 1000) })
        .where(eq(schema.aiGenerations.id, ligne!.id));
      console.error("Génération IA échouée (" + publicId + ") :", message);
      return c.json(
        { publicId, status: "echec", error: "La création de l'affiche a échoué, réessayez." },
        502,
      );
    }
  });

  /** État d'une génération — pour un aperçu qui arrive après coup. */
  app.get("/ia/generations/:publicId", async (c) => {
    const [g] = await db
      .select()
      .from(schema.aiGenerations)
      .where(eq(schema.aiGenerations.publicId, c.req.param("publicId")));
    if (!g) return c.notFound();
    return c.json({
      publicId: g.publicId,
      status: g.status,
      productId: g.productId,
      apercu: g.previewPath ? `/ia/apercu/${g.publicId}` : null,
      createdAt: g.createdAt,
    });
  });

  /**
   * Aperçu FILIGRANÉ. Publique, et c'est la seule image que la boutique voit.
   */
  app.get("/ia/apercu/:publicId", async (c) => {
    const [g] = await db
      .select()
      .from(schema.aiGenerations)
      .where(eq(schema.aiGenerations.publicId, c.req.param("publicId")));
    const chemin = cheminDisque(g?.previewPath);
    if (!chemin) return c.notFound();
    try {
      const buf = await readFile(chemin);
      return c.body(buf, 200, {
        "Content-Type": MIME_SORTIE[extname(chemin)] ?? "image/jpeg",
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      });
    } catch {
      return c.notFound();
    }
  });

  /**
   * Pleine définition côté client — UNIQUEMENT si la commande est réellement
   * payée.
   *
   * Trois conditions vérifiées en base, jamais sur la foi de la requête : la
   * génération porte une date de paiement, elle est rattachée à une ligne de
   * commande, et cette commande est au statut « paid ».
   */
  app.get("/ia/pleine/:publicId", async (c) => {
    const [g] = await db
      .select()
      .from(schema.aiGenerations)
      .where(eq(schema.aiGenerations.publicId, c.req.param("publicId")));
    if (!g || !g.paidAt || g.orderItemId == null)
      return c.json({ error: "Affiche non payée" }, 403);
    const [ligne] = await db
      .select({ statut: schema.orders.status })
      .from(schema.orderItems)
      .innerJoin(schema.orders, eq(schema.orderItems.orderId, schema.orders.id))
      .where(eq(schema.orderItems.id, g.orderItemId));
    if (ligne?.statut !== "paid") return c.json({ error: "Affiche non payée" }, 403);
    return servirPleine(c, g.fullPath);
  });

  /**
   * Lie une génération à la ligne de panier que le client a retenue.
   *
   * Facultative : une ligne dont la `config` porte déjà `aiPublicId` se
   * rattache toute seule au paiement. Elle sert quand la liaison doit exister
   * AVANT — un panier repris six semaines plus tard, un export du back-office.
   */
  app.post("/ia/lier", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const cartId = String(b.cartId ?? "");
    const orderItemId = Number(b.orderItemId);
    const publicId = String(b.publicId ?? "");
    if (!cartId || !publicId || !Number.isFinite(orderItemId))
      return c.json({ error: "cartId, orderItemId et publicId requis" }, 400);

    // La ligne doit appartenir AU panier annoncé : l'identifiant d'une ligne
    // est un entier séquentiel, il ne prouve rien à lui seul.
    const [ligne] = await db
      .select({ id: schema.orderItems.id })
      .from(schema.orderItems)
      .innerJoin(schema.orders, eq(schema.orderItems.orderId, schema.orders.id))
      .where(
        and(
          eq(schema.orderItems.id, orderItemId),
          eq(schema.orders.clientOrderId, cartId),
        ),
      );
    if (!ligne) return c.json({ error: "Ligne de panier introuvable" }, 404);

    const [maj] = await db
      .update(schema.aiGenerations)
      .set({ orderItemId: ligne.id })
      .where(
        and(
          eq(schema.aiGenerations.publicId, publicId),
          eq(schema.aiGenerations.cartId, cartId),
        ),
      )
      .returning({ publicId: schema.aiGenerations.publicId });
    if (!maj) return c.json({ error: "Génération introuvable pour ce panier" }, 404);
    return c.json({ ok: true, publicId: maj.publicId, orderItemId: ligne.id });
  });

  /* ---------------------------------------------------------------------- */
  /*  Back-office — protégé par le garde /admin/* déclaré dans index.ts      */
  /* ---------------------------------------------------------------------- */

  /** Liste filtrable : statut, produit, panier, période, payées ou non. */
  app.get("/admin/ia/generations", async (c) => {
    const q = c.req.query();
    const conditions: SQL[] = [];
    if (q.statut) conditions.push(eq(schema.aiGenerations.status, q.statut));
    if (q.productId) conditions.push(eq(schema.aiGenerations.productId, Number(q.productId)));
    if (q.cartId) conditions.push(eq(schema.aiGenerations.cartId, q.cartId));
    // Une date illisible filtrerait sur « Invalid Date » et ne rendrait rien :
    // on préfère ignorer le filtre.
    const depuis = q.depuis ? new Date(q.depuis) : null;
    const jusqua = q.jusqua ? new Date(q.jusqua) : null;
    if (depuis && !Number.isNaN(depuis.getTime()))
      conditions.push(gte(schema.aiGenerations.createdAt, depuis));
    if (jusqua && !Number.isNaN(jusqua.getTime()))
      conditions.push(lt(schema.aiGenerations.createdAt, jusqua));
    if (q.payees === "1") conditions.push(isNotNull(schema.aiGenerations.paidAt));
    if (q.payees === "0") conditions.push(isNull(schema.aiGenerations.paidAt));
    const filtre = conditions.length ? and(...conditions) : undefined;

    const limite = Math.min(200, Math.max(1, Number(q.limite ?? 50)));
    const page = Math.max(0, Number(q.page ?? 0));

    const lignes = await db
      .select({
        id: schema.aiGenerations.id,
        publicId: schema.aiGenerations.publicId,
        productId: schema.aiGenerations.productId,
        produit: schema.products.name,
        cartId: schema.aiGenerations.cartId,
        orderItemId: schema.aiGenerations.orderItemId,
        customerId: schema.aiGenerations.customerId,
        status: schema.aiGenerations.status,
        model: schema.aiGenerations.model,
        size: schema.aiGenerations.size,
        costCents: schema.aiGenerations.costCents,
        erreur: schema.aiGenerations.erreur,
        prompt: schema.aiGenerations.prompt,
        ip: schema.aiGenerations.ip,
        createdAt: schema.aiGenerations.createdAt,
        paidAt: schema.aiGenerations.paidAt,
        // Les chemins disque ne sortent pas : le BO passe par les routes.
        aApercu: raw<boolean>`${schema.aiGenerations.previewPath} is not null`,
        aPleine: raw<boolean>`${schema.aiGenerations.fullPath} is not null`,
      })
      .from(schema.aiGenerations)
      .leftJoin(schema.products, eq(schema.aiGenerations.productId, schema.products.id))
      .where(filtre)
      .orderBy(desc(schema.aiGenerations.createdAt))
      .limit(limite)
      .offset(page * limite);

    const [total] = await db
      .select({
        n: raw<number>`count(*)::int`,
        coutCents: raw<number>`coalesce(sum(${schema.aiGenerations.costCents}), 0)::int`,
      })
      .from(schema.aiGenerations)
      .where(filtre);

    return c.json({
      lignes: lignes.map((l) => ({
        ...l,
        apercu: l.aApercu ? `/ia/apercu/${l.publicId}` : null,
        pleine: l.aPleine ? `/admin/ia/full/${l.publicId}` : null,
      })),
      total: Number(total?.n ?? 0),
      coutCents: Number(total?.coutCents ?? 0),
      page,
      limite,
    });
  });

  /**
   * De quoi répondre « combien ça nous coûte » d'un coup d'œil : dépense du
   * mois face au plafond, essais, échecs.
   */
  app.get("/admin/ia/stats", async (c) => {
    const reg = await reglages();
    const debut = debutDuMois();

    const [mois] = await db
      .select({
        essais: raw<number>`count(*)::int`,
        echecs: raw<number>`count(*) filter (where ${schema.aiGenerations.status} = 'echec')::int`,
        pretes: raw<number>`count(*) filter (where ${schema.aiGenerations.status} = 'prete')::int`,
        payees: raw<number>`count(*) filter (where ${schema.aiGenerations.paidAt} is not null)::int`,
        coutCents: raw<number>`coalesce(sum(${schema.aiGenerations.costCents}), 0)::int`,
      })
      .from(schema.aiGenerations)
      .where(gte(schema.aiGenerations.createdAt, debut));

    const [tout] = await db
      .select({
        essais: raw<number>`count(*)::int`,
        coutCents: raw<number>`coalesce(sum(${schema.aiGenerations.costCents}), 0)::int`,
      })
      .from(schema.aiGenerations);

    const essais = Number(mois?.essais ?? 0);
    const echecs = Number(mois?.echecs ?? 0);
    const depenseCents = Number(mois?.coutCents ?? 0);
    const plafondCents = reg["ia.plafondMensuelCents"];

    // Pourquoi ça échoue, en une phrase utilisable.
    //
    // « 6 échecs » ne dit rien : la cliente ne peut ni le comprendre ni le
    // corriger. Les deux causes réelles — plus de crédit, clé refusée — se
    // lisent dans le message d'OpenAI, et appellent une action précise. On les
    // remonte donc telles quelles, sans jamais laisser passer le message brut
    // du prestataire dans une interface.
    const [dernierEchec] = await db
      .select({ erreur: schema.aiGenerations.erreur })
      .from(schema.aiGenerations)
      .where(eq(schema.aiGenerations.status, "echec"))
      .orderBy(desc(schema.aiGenerations.createdAt))
      .limit(1);
    const brut = String(dernierEchec?.erreur ?? "");
    const probleme = !brut
      ? null
      : /insufficient_quota|credit_balance_exhausted|no credits/i.test(brut)
        ? {
            code: "credit",
            titre: "Solde OpenAI épuisé",
            detail:
              "Le compte OpenAI n'a plus de crédit : aucune affiche ne peut " +
              "être générée. Rechargez-le dans Settings → Billing sur " +
              "platform.openai.com — la génération repart ensuite toute seule.",
          }
        : /invalid_api_key|incorrect api key|401/i.test(brut)
          ? {
              code: "cle",
              titre: "Clé OpenAI refusée",
              detail:
                "La clé n'est plus acceptée : elle a sans doute été révoquée. " +
                "Remplacez OPENAI_API_KEY dans le fichier .env du serveur.",
            }
          : {
              code: "autre",
              titre: "Dernière génération en échec",
              detail: "Le prestataire a refusé la demande. Réessayez ; si cela persiste, prévenez-nous.",
            };

    return c.json({
      // La clé elle-même ne sort jamais d'ici — seulement le fait qu'elle existe.
      configuree: iaConfiguree,
      probleme,
      modele: reg["ia.modele"],
      taille: reg["ia.taille"],
      mois: {
        debut,
        essais,
        pretes: Number(mois?.pretes ?? 0),
        echecs,
        payees: Number(mois?.payees ?? 0),
        tauxEchec: essais ? Number((echecs / essais).toFixed(3)) : 0,
        depenseCents,
      },
      plafondCents,
      resteCents: Math.max(0, plafondCents - depenseCents),
      plafondAtteint: depenseCents >= plafondCents,
      // Estimation : le coût par image est un réglage, pas une facture OpenAI.
      coutParImageCents: reg["ia.coutParImageCents"],
      purgeJours: reg["ia.purgeJours"],
      total: { essais: Number(tout?.essais ?? 0), coutCents: Number(tout?.coutCents ?? 0) },
    });
  });

  /** Image SANS filigrane — réservée au back-office (garde /admin/*). */
  app.get("/admin/ia/full/:publicId", async (c) => {
    const [g] = await db
      .select()
      .from(schema.aiGenerations)
      .where(eq(schema.aiGenerations.publicId, c.req.param("publicId")));
    if (!g) return c.notFound();
    return servirPleine(c, g.fullPath);
  });

  /**
   * Purge les photos et aperçus non payés de plus de N jours.
   * `simulation: true` compte sans rien effacer.
   */
  app.post("/admin/ia/purger", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const reg = await reglages();
    const jours = b.jours != null ? Number(b.jours) : reg["ia.purgeJours"];
    if (!Number.isFinite(jours) || jours < 0)
      return c.json({ error: "jours invalide" }, 400);
    return c.json(await purgerGenerationsIa(jours, b.simulation === true));
  });

  /** Active la création par IA sur une affiche et règle son style. */
  app.post("/admin/products/:id/ia", async (c) => {
    const id = Number(c.req.param("id"));
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const [produit] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, id));
    if (!produit) return c.notFound();

    const stylePrompt =
      b.aiStylePrompt === undefined
        ? produit.aiStylePrompt
        : String(b.aiStylePrompt ?? "").trim() || null;
    const [maj] = await db
      .update(schema.products)
      .set({
        aiEnabled:
          b.aiEnabled === undefined ? produit.aiEnabled : Boolean(b.aiEnabled),
        aiStylePrompt: stylePrompt,
        updatedAt: new Date(),
      })
      .where(eq(schema.products.id, id))
      .returning({
        id: schema.products.id,
        aiEnabled: schema.products.aiEnabled,
        aiStylePrompt: schema.products.aiStylePrompt,
      });
    return c.json(maj);
  });
}

/**
 * Sert une image sans filigrane. `no-store` : cette réponse ne doit dormir ni
 * dans le cache du proxy, ni dans celui du navigateur d'un poste partagé.
 */
async function servirPleine(c: Context, relatif: string | null) {
  const chemin = cheminDisque(relatif);
  if (!chemin) return c.notFound();
  try {
    await stat(chemin);
    const buf = await readFile(chemin);
    return c.body(buf, 200, {
      "Content-Type": MIME_SORTIE[extname(chemin)] ?? "image/png",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
  } catch {
    return c.notFound();
  }
}
