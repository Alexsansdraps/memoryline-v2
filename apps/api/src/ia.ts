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
  inArray,
  isNull,
  isNotNull,
  lt,
  ne,
  not,
  notInArray,
  or,
  sql as raw,
  type SQL,
} from "drizzle-orm";
import { basename, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { db, schema } from "./db/client.js";
import { clientDeLaRequete } from "./comptes.js";
import { HORS_VENTES } from "./statuts-vente.js";
import {
  STYLE_MEMORY_LINE,
  ajouterDemandeClient,
  appliquerVariables,
} from "./ia-style.js";

/** Mêmes assets que le reste de l'API (cf. ASSETS_DIR dans index.ts). */
const ASSETS_DIR = resolve(fileURLToPath(import.meta.url), "../../../../data/assets");
/** Sous-dossier dédié : rien de ce qui vit ici n'est servi par /assets/:file. */
export const IA_DIR = resolve(ASSETS_DIR, "ia");
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
  "ia.modele": "gpt-image-2.5-sunburst",
  /**
   * 1584 x 2240 : exactement le rapport 297:420, celui de l'A3 vertical, et
   * deux multiples de 16 comme le modèle l'exige. Composer directement à ce
   * format évite de générer un carré puis de le couper, ce qui ampute la
   * scène ou oblige à inventer ce qui manque.
   */
  "ia.taille": "1584x2240",
  "ia.qualite": "high",
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
const TAILLES = new Set([
  "1584x2240",
  "1024x1024",
  "1024x1536",
  "1536x1024",
  "auto",
]);

/**
 * Le dossier des affiches de référence, qui montrent le rendu au modèle.
 *
 * Elles ne sont PAS dans les visuels de la boutique : ce sont des références
 * de style, pas des produits, et les mélanger reviendrait à les voir
 * disparaître le jour où l'une est retirée de la vente.
 *
 * Trois au maximum partent avec la photo. Au-delà, le modèle dilue le rendu et
 * l'appel grossit pour rien.
 */
const REFERENCES_DIR = resolve(process.cwd(), "references-ia");
const REFERENCES_MAX = 3;
/**
 * Cinq images par style, au plus.
 *
 * C'est le plafond demandé par la boutique. Il vaut aussi pour ce qui part au
 * modèle : au-delà, chaque image supplémentaire coûte un aller-retour de plus
 * et dilue le style au lieu de le préciser.
 */
const STYLE_IMAGES_MAX = 5;

/**
 * Les images de style à envoyer, dans l'ordre.
 *
 * L'ordre compte : la consigne parle d'IMAGE 2, IMAGE 3 et IMAGE 4. On les
 * trie donc par nom de fichier, ce qui rend l'ordre visible et modifiable
 * sans toucher au code.
 *
 * Aucune référence n'est une panne : la génération part alors avec la seule
 * consigne écrite, comme avant que ces images existent. Le back-office le dit.
 */
async function referencesDeStyle(): Promise<{ nom: string; donnees: Buffer }[]> {
  try {
    const noms = (await readdir(REFERENCES_DIR))
      .filter((n) => /\.(png|jpe?g|webp)$/i.test(n))
      .sort();
    const sortie: { nom: string; donnees: Buffer }[] = [];
    for (const nom of noms.slice(0, REFERENCES_MAX)) {
      try {
        sortie.push({ nom, donnees: await readFile(resolve(REFERENCES_DIR, nom)) });
      } catch {
        // Un fichier illisible ne doit pas emporter la génération entière.
      }
    }
    return sortie;
  } catch {
    return [];
  }
}

/**
 * Les images d'un style, lues dans data/assets.
 *
 * `null` — et non un tableau vide — quand le style n'en a aucune : l'appelant
 * doit pouvoir distinguer « ce style n'a pas d'images, prends celles du
 * dossier » de « ce style en a, et elles sont toutes illisibles ».
 *
 * `basename()` : ces chemins viennent de la base, donc du back-office, donc
 * d'un formulaire. Ils ne désigneront rien d'autre qu'un fichier de
 * data/assets — jamais un « ../../.env ».
 */
async function imagesDuStyle(
  chemins: string[] | null | undefined,
): Promise<{ nom: string; donnees: Buffer }[] | null> {
  if (!Array.isArray(chemins) || !chemins.length) return null;
  const sortie: { nom: string; donnees: Buffer }[] = [];
  for (const brut of chemins.slice(0, STYLE_IMAGES_MAX)) {
    const nom = basename(String(brut).split("?")[0] ?? "");
    if (!nom || !/\.(png|jpe?g|webp)$/i.test(nom)) continue;
    try {
      sortie.push({ nom, donnees: await readFile(resolve(ASSETS_DIR, nom)) });
    } catch {
      // Une image effacée du disque ne doit pas emporter la génération.
    }
  }
  return sortie.length ? sortie : null;
}

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

export function ipDeLaRequete(c: Context): string {
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
export function cheminDisque(relatif: string | null | undefined): string | null {
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
 * Filigrane brûlé dans les pixels de l'aperçu : un cercle fin au centre et le
 * logo de la boutique à l'intérieur, en blanc presque transparent.
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
 * Calques à composer sur l'aperçu : un cercle fin au centre, et le logo à
 * l'intérieur, en blanc presque transparent — le MÊME dessin que le filigrane
 * du configurateur (packages/configurator/src/components/Filigrane.tsx), aux
 * mêmes proportions : cercle de 60 % de la largeur, logo de 42 %.
 *
 * Il remplace une grille de logos en diagonale, doublée d'une ombre sombre,
 * qui couvrait toute l'image. La boutique la voulait plus discrète. Le cercle
 * reste AU CENTRE, là où un recadrage ne peut pas l'ôter sans emporter le
 * sujet de l'affiche.
 *
 * Le cercle est un SVG rendu par sharp, à la taille exacte de l'image : un
 * trait vectoriel reste net, là où un anneau dessiné en pixels se crénelle.
 */
async function calquesFiligrane(
  largeur: number,
  hauteur: number,
): Promise<{ input: Buffer; left: number; top: number }[]> {
  const cx = largeur / 2;
  const cy = hauteur / 2;
  const rayon = Math.round(largeur * 0.3);
  // Le trait suit la taille de l'image : 1,5 px vu sur un aperçu d'environ
  // 600 px de large, comme dans le configurateur.
  const epaisseur = Math.max(2, largeur / 300);

  const cercle = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${largeur}" height="${hauteur}">` +
      `<circle cx="${cx}" cy="${cy}" r="${rayon}" fill="none" ` +
      `stroke="#ffffff" stroke-opacity="0.5" stroke-width="${epaisseur}"/>` +
      `</svg>`,
  );

  const logoLargeur = Math.max(80, Math.round(largeur * 0.42));
  const logo = await logoAttenue(logoLargeur, 0.4, false);
  const { width: lw = logoLargeur, height: lh = Math.round(logoLargeur * 0.444) } =
    await sharp(logo).metadata();

  return [
    { input: cercle, left: 0, top: 0 },
    {
      input: logo,
      left: Math.round(cx - lw / 2),
      top: Math.round(cy - lh / 2),
    },
  ];
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

/**
 * Le fichier prêt pour l'imprimeur : A3 vertical, 300 points par pouce.
 *
 * 3508 x 4961 pixels, c'est un A3 à 300 points par pouce. La génération sort
 * en 1584 x 2240, même rapport exactement : l'agrandissement ne déforme donc
 * rien, il ajoute seulement des pixels.
 *
 * `lanczos3` est le rééchantillonnage qui garde les bords nets — sur des
 * aplats de couleur, un agrandissement mou se verrait tout de suite. Et la
 * résolution est ÉCRITE dans le fichier : sans elle, un logiciel de mise en
 * page suppose 72 points par pouce et propose d'imprimer l'affiche en A1.
 *
 * L'original généré n'est jamais remplacé : un agrandissement se refait, une
 * génération non.
 */
const IMPRESSION_A3 = { largeur: 3508, hauteur: 4961, dpi: 300 } as const;

export async function fabriquerFichierImpression(
  pleine: Buffer,
  nom: string,
): Promise<string> {
  const fichier = await sharp(pleine)
    .resize({
      width: IMPRESSION_A3.largeur,
      height: IMPRESSION_A3.hauteur,
      fit: "cover",
      kernel: "lanczos3",
    })
    .withMetadata({ density: IMPRESSION_A3.dpi })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(resolve(IA_DIR, nom), fichier);
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
  /**
   * Les affiches de référence, dans l'ordre. Elles deviennent IMAGE 2, 3 et 4
   * de la consigne ; la photo du client reste IMAGE 1.
   */
  references: { nom: string; donnees: Buffer }[] = [],
): Promise<Buffer> {
  const envoyer = async (avecOptions: boolean): Promise<Response> => {
    const form = new FormData();
    // L'ORDRE fait le sens : la photo d'abord, c'est elle qui porte la scène.
    // Une référence en premier ferait recopier son contenu, et le client
    // recevrait une affiche qui n'est pas la sienne.
    const champ = references.length ? "image[]" : "image";
    form.append(
      champ,
      new Blob([new Uint8Array(photo)], { type: "image/jpeg" }),
      nomPhoto,
    );
    for (const r of references)
      form.append(
        "image[]",
        new Blob([new Uint8Array(r.donnees)], { type: "image/png" }),
        r.nom,
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

/*
 * La photo d'un visiteur est une donnée personnelle, et c'est souvent un
 * visage : on ne la garde pas « au cas où ». La purge tourne donc TOUTE
 * SEULE, dans l'API, une fois au démarrage puis toutes les heures
 * (`demarrerPurgeIa`). Le bouton du back-office lance exactement la même
 * fonction, avec les mêmes règles : il ne fait que ne pas attendre l'heure.
 *
 * Elle efface trois sortes de restes :
 *   - les générations jamais achetées, passé le délai réglé au back-office
 *     (« ia.purgeJours ») : la photo, l'aperçu, la pleine définition et le
 *     fichier d'impression. La LIGNE reste, vidée de ses chemins : c'est ce
 *     qui permet de répondre « combien a coûté le mois de mars » un an plus
 *     tard, sans conserver le moindre visage ;
 *   - les photos envoyées qui n'ont jamais servi à une génération — le
 *     visiteur a changé d'avis, fermé la page. Aucune ligne ne les désigne :
 *     sans ce balayage, rien ne les effaçait jamais ;
 *   - les photos du relais téléphone → tablette que son propre ménage
 *     (ia-relais.ts, toutes les minutes) aurait laissées passer.
 */

/**
 * Six heures : l'âge à partir duquel une photo qui n'a servi à aucune
 * génération est effacée.
 *
 * Le chemin de la photo ne vit que dans la page ouverte (AfficheIA.tsx) : il
 * ne survit ni à un rechargement, ni au lendemain. Six heures couvrent donc
 * largement le visiteur qui hésite entre deux styles, l'onglet resté ouvert
 * pendant le déjeuner, la tablette du stand dont le client revient dans
 * l'après-midi — sans qu'aucun visage passe la nuit sur le serveur.
 *
 * C'est aussi un PLANCHER pour les générations : un délai de conservation
 * réglé à 0 jour ne doit pas effacer, au passage automatique suivant,
 * l'aperçu qu'un visiteur est en train de regarder — ni l'affiche d'un panier
 * payé dans l'heure, qui perdrait son image.
 */
const DELAI_PHOTO_INUTILISEE_MS = 6 * 60 * 60_000;

/**
 * Une heure pour les restes du relais : une photo relayée ne vit jamais plus
 * d'un quart d'heure, et le ménage du relais passe toutes les minutes. Ce
 * délai ne rattrape que ce qu'il aurait manqué — une API arrêtée pendant une
 * session, un stand supprimé entre-temps.
 */
const DELAI_RESTES_RELAIS_MS = 60 * 60_000;

/** Un passage par heure : bien en deçà de tous les délais ci-dessus. */
const PERIODE_PURGE_MS = 60 * 60_000;

/**
 * Les fichiers de data/assets/ia que la purge sait reconnaître : la photo
 * d'un visiteur (« <uuid>.jpg », /ia/photo) et ce qu'une génération en tire
 * (« <publicId>-apercu.jpg », « -pleine.png », « -impression.png »). Tout
 * autre nom n'est jamais touché ; les photos relayées ont leur propre
 * balayage (`balayerPhotosRelayees`).
 */
const FICHIER_VISITEUR =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\.jpg|-apercu\.jpg|-pleine\.png|-impression\.png)$/;

/**
 * Ce qu'une génération laisse sur le disque, que la base en garde le chemin
 * ou non. Le fichier d'impression n'est rangé dans aucune colonne, et une
 * génération tombée en échec après avoir écrit sa pleine définition n'en
 * garde pas non plus le chemin : les retrouver par leur nom est la seule
 * façon de ne pas les oublier.
 */
const FICHIERS_D_UNE_GENERATION = ["-apercu.jpg", "-pleine.png", "-impression.png"];

/** Ce qu'une purge a effacé — ou, en simulation, effacerait. */
export interface BilanPurgeIa {
  jours: number;
  simulation: boolean;
  /** Générations jamais achetées vidées de leurs fichiers. */
  lignes: number;
  /** Fichiers de ces générations : photo, aperçu, pleine définition, impression. */
  fichiers: number;
  /** Photos qui n'ont servi à aucune génération (et fichiers sans génération). */
  orphelins: number;
  /** Photos du relais téléphone → tablette restées sur le disque. */
  relais: number;
  /** L'âge, en heures, à partir duquel une photo inutilisée est effacée. */
  heuresPhotosInutilisees: number;
  /** Pourquoi la purge n'a rien fait, quand elle n'a rien fait exprès. */
  motif: string | null;
}

/** Vrai pendant une purge réelle : deux purges ne se chevauchent jamais. */
let purgeEnCours = false;

/**
 * Les commandes qui mettent leurs générations à l'abri de la purge.
 *
 * Une VENTE d'abord (statuts-vente.ts) : ni un panier, ni une commande
 * annulée ou avortée. Mais pas toute commande « en attente » : sur le site,
 * c'est le passage en caisse qui la pose, AVANT le paiement — et le client
 * qui s'en va sans payer la laisse ainsi pour toujours, rien ne la fait
 * jamais passer « annulée ». La compter comme une vente gardait sans limite
 * sa photo, son aperçu, sa pleine définition et son fichier d'impression,
 * alors que rien n'avait été payé.
 *
 * Une commande du site en attente ne protège donc que tant qu'elle a bougé
 * depuis moins que le délai de conservation (`limite`) : de quoi laisser
 * aboutir un paiement qui traîne, ou le virement annoncé à la propriétaire.
 * Passé ce délai, ses photos partent comme celles d'un panier abandonné.
 *
 * Au STAND, « en attente » reste une vente : c'est ainsi que naissaient les
 * ventes du stand avant de naître payées (salon.ts), réglées de la main à la
 * main — aucune ne passera jamais « payée ».
 */
function commandeProtectrice(limite: Date): SQL {
  const o = schema.orders;
  return and(
    notInArray(o.status, HORS_VENTES),
    or(
      ne(o.status, "pending"),
      eq(o.channel, "salon"),
      gte(o.lastActivityAt, limite),
      // Les commandes d'avant l'horloge d'inactivité : leur date de
      // création en tient lieu, comme le prévoit le schéma.
      and(isNull(o.lastActivityAt), gte(o.createdAt, limite)),
    ),
  )!;
}

/**
 * Les générations qu'aucune purge ne touche : payées, ou rattachées à une
 * commande protectrice — par leur ligne de commande, ou parce qu'une ligne
 * de commande annonce leur identifiant (`config.aiPublicId`).
 *
 * `paidAt` suffit d'ordinaire : c'est lui que pose le paiement
 * (`rattacherGenerationsAuPanier`). Mais ce rattachement « ne lève jamais » :
 * s'il échoue, la commande est payée et la génération ne le sait pas. Et les
 * ventes du stand d'avant le rattachement au stand n'ont jamais reçu de date.
 * Une purge, elle, ne se rattrape pas : dans le doute, on garde.
 *
 * Les lignes protectrices se lisent par des sous-requêtes qui ne dépendent
 * pas de la génération (IN) : Postgres les lit une fois et les range dans
 * une table de hachage. Une sous-requête liée à chaque génération
 * reparcourait toutes les lignes de commande pour chacune d'elles — un coût
 * qui grandit comme le produit des deux tables, à chaque passage horaire et
 * à chaque ouverture de la page IA du back-office.
 */
function generationProtegee(limite: Date): SQL {
  const g = schema.aiGenerations;
  const oi = schema.orderItems;
  const annonce = raw<string>`${oi.config} ->> 'aiPublicId'`;
  return or(
    isNotNull(g.paidAt),
    // « x IN (…) » vaut NULL, et non faux, quand x est NULL : sans cette
    // garde, NOT(…) vaudrait NULL aussi, et une génération sans ligne de
    // commande ne serait ni gardée ni purgée — absente des deux listes.
    and(
      isNotNull(g.orderItemId),
      inArray(
        g.orderItemId,
        db
          .select({ id: oi.id })
          .from(oi)
          .innerJoin(schema.orders, eq(oi.orderId, schema.orders.id))
          .where(commandeProtectrice(limite)),
      ),
    ),
    // Pour la même raison, la liste ne contient jamais NULL : une seule
    // ligne sans annonce rendrait NULL toute génération qu'elle ne cite pas.
    inArray(
      g.publicId,
      db
        .select({ publicId: annonce })
        .from(oi)
        .innerJoin(schema.orders, eq(oi.orderId, schema.orders.id))
        .where(and(commandeProtectrice(limite), isNotNull(annonce))),
    ),
  )!;
}

/** Une génération que la purge doit vider : ni protégée, ni trop récente. */
function generationPerimee(limite: Date): SQL {
  return and(
    lt(schema.aiGenerations.createdAt, limite),
    not(generationProtegee(limite)),
  )!;
}

/** Le nom, dans data/assets/ia, d'un fichier désigné par un chemin en base. */
function nomDansIa(relatif: string | null | undefined): string | null {
  const chemin = cheminDisque(relatif);
  if (!chemin) return null;
  const nom = basename(chemin);
  return resolve(IA_DIR, nom) === chemin ? nom : null;
}

/**
 * Efface un fichier de data/assets/ia dont on sait qu'il est là (il sort
 * d'un `readdir`). Vrai s'il est parti — ou, en simulation, s'il partirait.
 */
async function effacerDansIa(nom: string, simulation: boolean): Promise<boolean> {
  if (simulation) return true;
  try {
    await rm(resolve(IA_DIR, nom));
    return true;
  } catch (e) {
    // Effacé entre-temps (le relais, une autre purge) : rien à compter.
    if ((e as NodeJS.ErrnoException).code !== "ENOENT")
      console.error("Purge IA : suppression impossible de ia/" + nom + " :", e);
    return false;
  }
}

/**
 * La purge des photos de visiteurs : générations jamais achetées de plus de
 * `jours` jours, photos jamais utilisées, restes du relais. `simulation`
 * compte sans rien effacer.
 *
 * Le disque fait foi pour savoir ce qui existe, la base pour savoir ce qui
 * doit rester : on liste le dossier une fois, et chaque fichier est gardé
 * dès qu'une génération GARDÉE le désigne. Une photo partagée par plusieurs
 * essais reste donc tant qu'un seul d'entre eux est gardé — l'ancienne purge
 * l'effaçait avec le premier essai périmé, sous une affiche payée.
 */
export async function purgerPhotosVisiteurs(
  jours: number,
  simulation = false,
): Promise<BilanPurgeIa> {
  const bilan: BilanPurgeIa = {
    jours,
    simulation,
    lignes: 0,
    fichiers: 0,
    orphelins: 0,
    relais: 0,
    heuresPhotosInutilisees: DELAI_PHOTO_INUTILISEE_MS / 3_600_000,
    motif: null,
  };
  // Une simulation ne fait que lire : elle peut tourner à côté d'une purge.
  if (!simulation) {
    if (purgeEnCours) {
      bilan.motif = "Une purge est déjà en cours : celle-ci n'a rien fait.";
      return bilan;
    }
    purgeEnCours = true;
  }
  try {
    const maintenant = Date.now();
    const limite = new Date(
      Math.min(
        maintenant - Math.max(0, jours) * 86_400_000,
        maintenant - DELAI_PHOTO_INUTILISEE_MS,
      ),
    );
    const g = schema.aiGenerations;
    const [perimees, gardees] = await Promise.all([
      db
        .select({
          id: g.id,
          publicId: g.publicId,
          sourcePath: g.sourcePath,
          previewPath: g.previewPath,
          fullPath: g.fullPath,
        })
        .from(g)
        .where(generationPerimee(limite)),
      db
        .select({ publicId: g.publicId, sourcePath: g.sourcePath })
        .from(g)
        .where(not(generationPerimee(limite))),
    ]);

    let presents: string[];
    try {
      presents = await readdir(IA_DIR);
    } catch {
      presents = [];
    }
    const surLeDisque = new Set(presents);

    const photosGardees = new Set(gardees.map((l) => nomDansIa(l.sourcePath)));
    const photosConnues = new Set([
      ...photosGardees,
      ...perimees.map((l) => nomDansIa(l.sourcePath)),
    ]);
    const generationsConnues = new Set([
      ...gardees.map((l) => l.publicId),
      ...perimees.map((l) => l.publicId),
    ]);

    // 1. Les générations jamais achetées, passé le délai.
    for (const ligne of perimees) {
      const noms = new Set<string>();
      for (const relatif of [ligne.previewPath, ligne.fullPath]) {
        const nom = nomDansIa(relatif);
        if (nom) noms.add(nom);
      }
      const photo = nomDansIa(ligne.sourcePath);
      if (photo && !photosGardees.has(photo)) noms.add(photo);
      for (const suffixe of FICHIERS_D_UNE_GENERATION) noms.add(ligne.publicId + suffixe);
      const presentes = [...noms].filter((n) => surLeDisque.has(n));
      const aDesChemins = !!(ligne.sourcePath || ligne.previewPath || ligne.fullPath);
      // Déjà vidée par un passage précédent : rien à refaire, rien à compter.
      if (!presentes.length && !aDesChemins) continue;

      if (!simulation && aDesChemins) {
        // Revérifiée AU MOMENT D'ÉCRIRE : payée depuis la lecture, elle est
        // gardée, fichiers compris.
        const [videe] = await db
          .update(g)
          .set({ sourcePath: null, previewPath: null, fullPath: null })
          .where(and(eq(g.id, ligne.id), generationPerimee(limite)))
          .returning({ id: g.id });
        if (!videe) continue;
      }
      bilan.lignes++;
      for (const nom of presentes) {
        if (await effacerDansIa(nom, simulation)) bilan.fichiers++;
        surLeDisque.delete(nom);
      }
    }

    // 2. Les photos qui n'ont servi à aucune génération — et, par la même
    // règle, les fichiers d'une génération dont la ligne n'existe pas.
    const seuil = maintenant - DELAI_PHOTO_INUTILISEE_MS;
    for (const nom of surLeDisque) {
      const reconnu = FICHIER_VISITEUR.exec(nom);
      if (!reconnu) continue;
      const connu =
        reconnu[2] === ".jpg" ? photosConnues.has(nom) : generationsConnues.has(reconnu[1]!);
      if (connu) continue;
      try {
        if ((await stat(resolve(IA_DIR, nom))).mtimeMs >= seuil) continue;
      } catch {
        continue;
      }
      if (await effacerDansIa(nom, simulation)) bilan.orphelins++;
    }

    // 3. Les restes du relais téléphone → tablette.
    bilan.relais = await balayerPhotosRelayees(DELAI_RESTES_RELAIS_MS, simulation);
    return bilan;
  } finally {
    if (!simulation) purgeEnCours = false;
  }
}

/**
 * Le nom des photos relayées depuis un téléphone (ia-relais.ts) commence par
 * ce préfixe. C'est ce qui permet de les retrouver sans la base : elles ne
 * figurent dans aucune génération, la purge ci-dessus ne les verrait jamais.
 */
export const PREFIXE_RELAIS = "relais-";

/**
 * Efface les photos relayées plus vieilles que `ageMs`.
 *
 * Une photo relayée ne vit que le temps de sa session — un quart d'heure au
 * plus, puis la tablette a confirmé l'avoir reçue ou le code a expiré. Passé
 * ce délai, un fichier « relais-* » encore sur le disque est un reste, par
 * définition : on n'a donc pas besoin de la base pour décider de l'effacer.
 * C'est ce qui rend ce balayage sûr même quand la base et le disque ne sont
 * plus d'accord.
 */
export async function balayerPhotosRelayees(
  ageMs: number,
  simulation = false,
): Promise<number> {
  const limite = Date.now() - ageMs;
  let effacees = 0;
  let noms: string[];
  try {
    noms = await readdir(IA_DIR);
  } catch {
    return 0;
  }
  for (const nom of noms) {
    if (!nom.startsWith(PREFIXE_RELAIS) || !nom.endsWith(".jpg")) continue;
    const chemin = resolve(IA_DIR, nom);
    try {
      if ((await stat(chemin)).mtimeMs >= limite) continue;
      if (!simulation) await rm(chemin, { force: true });
      effacees++;
    } catch {
      // Effacé entre-temps par la tablette ou par le ménage : rien à faire.
    }
  }
  return effacees;
}

let minuteriePurge: ReturnType<typeof setInterval> | null = null;

/**
 * Un passage de la purge automatique, avec le délai réglé au back-office.
 *
 * Une ligne au journal à CHAQUE passage, même quand rien n'est parti : c'est
 * ce qui permet de vérifier, sur le serveur, que la purge tourne vraiment.
 * Ne lève jamais : une erreur ici emporterait la minuterie, et avec elle
 * toutes les purges suivantes.
 */
export async function passageDePurgeIa(): Promise<void> {
  try {
    const jours = (await reglages())["ia.purgeJours"];
    const b = await purgerPhotosVisiteurs(jours);
    console.log(
      `[purge ia] ${b.lignes} génération(s) non achetée(s) de plus de ${jours} j vidée(s) ` +
        `(${b.fichiers} fichier(s)), ${b.orphelins} photo(s) inutilisée(s) de plus de ` +
        `${b.heuresPhotosInutilisees} h, ${b.relais} reste(s) du relais` +
        (b.motif ? ` — ${b.motif}` : ""),
    );
  } catch (e) {
    console.error("[purge ia] passage interrompu :", e);
  }
}

/**
 * Démarre la purge automatique : un passage dès que l'API écoute — ce
 * qu'un arrêt a laissé en plan —, puis un par heure, dans le processus de
 * l'API, comme la relance des paniers (relance-panier.ts). `purgeEnCours`
 * empêche deux passages de se chevaucher, bouton du back-office compris.
 * `unref()` évite que la minuterie retienne le processus à l'arrêt.
 */
export function demarrerPurgeIa(): void {
  if (minuteriePurge) return;
  void passageDePurgeIa();
  minuteriePurge = setInterval(() => void passageDePurgeIa(), PERIODE_PURGE_MS);
  minuteriePurge.unref?.();
}

/* -------------------------------------------------------------------------- */
/*  Routes                                                                    */
/* -------------------------------------------------------------------------- */

export const PHOTO_MAX_OCTETS = 12 * 1024 * 1024;
const PHOTO_FORMATS = new Set(["jpeg", "png", "webp"]);
/** Au-delà, on paierait des pixels que le modèle n'utilise pas. */
const PHOTO_COTE_MAX = 2048;
/** La précision du client est reprise telle quelle dans la consigne : on la borne. */
const PRECISION_MAX = 400;

export type PhotoNormalisee =
  | { ok: true; donnees: Buffer; largeur: number; hauteur: number }
  | { ok: false; erreur: string };

/**
 * Remet d'aplomb une photo reçue d'un client : c'est sharp qui dit ce qu'est
 * le fichier, jamais le type annoncé par le navigateur.
 *
 * L'image est réduite à 2048 px au grand côté et RÉ-ENCODÉE en JPEG, ce qui a
 * un effet de bord voulu — les métadonnées EXIF disparaissent, dont la
 * position GPS que porte toute photo de vacances prise au téléphone. Sharp ne
 * recopie aucune métadonnée tant qu'on ne le lui demande pas.
 *
 * Partagée par l'envoi depuis la boutique (/ia/photo) et par le relais du
 * téléphone vers la tablette (ia-relais.ts) : une photo qui arrive par le
 * téléphone ne doit pas échapper au moindre de ces contrôles.
 */
export async function normaliserPhoto(brut: Buffer): Promise<PhotoNormalisee> {
  try {
    const meta = await sharp(brut).metadata();
    if (!meta.format || !PHOTO_FORMATS.has(meta.format))
      return { ok: false, erreur: "Format refusé : envoyez un JPEG, un PNG ou un WebP" };
    const donnees = await sharp(brut)
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
    const apres = await sharp(donnees).metadata();
    return { ok: true, donnees, largeur: apres.width ?? 0, hauteur: apres.height ?? 0 };
  } catch {
    return { ok: false, erreur: "Fichier illisible : ce n'est pas une image valide" };
  }
}

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
   * Le type DÉCLARÉ n'est pas cru : c'est sharp qui dit ce qu'est le fichier,
   * et la photo est réduite puis ré-encodée, métadonnées GPS comprises
   * effacées (voir `normaliserPhoto`).
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

    const photo = await normaliserPhoto(Buffer.from(await fichier.arrayBuffer()));
    if (!photo.ok) return c.json({ error: photo.erreur }, 415);

    const nom = `${randomUUID()}.jpg`;
    await writeFile(resolve(IA_DIR, nom), photo.donnees);
    return c.json({
      photo: `ia/${nom}`,
      largeur: photo.largeur,
      hauteur: photo.hauteur,
      octets: photo.donnees.byteLength,
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

    /*
     * Le style choisi par la cliente — « Couple », « Paysage ».
     *
     * Facultatif, et il doit le rester : une affiche créée avant que les
     * styles existent, ou depuis un écran qui n'en propose pas, part avec la
     * seule consigne générale de la boutique, comme avant. Un style éteint au
     * back-office est traité comme absent — on ne refuse pas la génération,
     * on retombe sur le général.
     */
    const idStyle = Number(body.promptId);
    const [style] = Number.isFinite(idStyle)
      ? await db
          .select()
          .from(schema.aiPrompts)
          .where(
            and(
              eq(schema.aiPrompts.id, idStyle),
              eq(schema.aiPrompts.active, true),
            ),
          )
      : [];

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
    // TOUJOURS l'A3 vertical. On choisissait autrefois le portrait ou le
    // paysage selon la photo ; une affiche se vend en A3 vertical, et c'est la
    // composition qui s'adapte, pas le format. La consigne dit au modèle
    // comment adapter une photo en largeur sans amputer la scène.
    const tailleChoisie = TAILLES.has(reg["ia.taille"])
      ? reg["ia.taille"]
      : DEFAUTS["ia.taille"];

    const consigne = ajouterDemandeClient(
      [
        appliquerVariables(reg["ia.stylePrompt"], {
          OUTPUT_FORMAT: "A3 vertical poster",
          CUSTOMER_REQUEST: precision,
        }),
        produit.aiStylePrompt ?? "",
        // Le style choisi vient APRÈS celui de l'affiche : de deux consignes
        // qui se contrediraient, c'est celle que la cliente a choisie qui doit
        // l'emporter, et le modèle retient mieux ce qui vient en dernier.
        style?.prompt ?? "",
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
        // Les images du style choisi ; à défaut, celles du dossier du
        // serveur, qui restent le repli des affiches sans style.
        (await imagesDuStyle(style?.images)) ?? (await referencesDeStyle()),
      );
      const nomPleine = `${publicId}-pleine.png`;
      await writeFile(resolve(IA_DIR, nomPleine), pleine);
      // Le fichier d'impression, tout de suite : le jour où la commande part
      // en fabrication, personne n'a envie de dépendre d'un agrandissement qui
      // reste à faire. L'original généré reste à côté, intact.
      await fabriquerFichierImpression(pleine, `${publicId}-impression.png`);
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
   * Lance tout de suite la purge qui passe d'elle-même toutes les heures
   * (`purgerPhotosVisiteurs`) : mêmes règles, même délai par défaut.
   * `simulation: true` compte sans rien effacer — c'est ce que le
   * back-office affiche sous « Ce qui partira ».
   */
  app.post("/admin/ia/purger", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const reg = await reglages();
    const jours = b.jours != null ? Number(b.jours) : reg["ia.purgeJours"];
    if (!Number.isFinite(jours) || jours < 0)
      return c.json({ error: "jours invalide" }, 400);
    return c.json(await purgerPhotosVisiteurs(jours, b.simulation === true));
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

  /* ----------------------------- les styles ------------------------------
   *
   * Un style = un titre montré à la cliente, une consigne qui part au modèle,
   * et jusqu'à cinq images qui font les deux : exemples à l'écran, références
   * de style à la génération.
   */

  /** Le titre dans la langue demandée ; le français en repli, jamais un blanc. */
  function titreDuStyle(
    ligne: { title: string; translations: unknown },
    langue: string,
  ): string {
    const t = ligne.translations as
      | Record<string, { title?: string } | undefined>
      | null
      | undefined;
    const traduit = t?.[langue]?.title;
    return typeof traduit === "string" && traduit.trim()
      ? traduit.trim()
      : ligne.title;
  }

  /**
   * Ce que le site a le droit de savoir d'un style.
   *
   * La consigne N'EN FAIT PAS PARTIE, et c'est délibéré : c'est la recette de
   * la boutique, ce qui distingue ses affiches de celles qu'on obtiendrait en
   * tapant la même demande ailleurs. Elle ne sort jamais de /admin.
   */
  app.get("/ia/prompts", async (c) => {
    const langue = String(c.req.query("lang") ?? "fr").slice(0, 5);
    const lignes = await db
      .select()
      .from(schema.aiPrompts)
      .where(eq(schema.aiPrompts.active, true))
      .orderBy(asc(schema.aiPrompts.position), asc(schema.aiPrompts.id));
    return c.json(
      lignes.map((l) => ({
        id: l.id,
        titre: titreDuStyle(l, langue),
        images: Array.isArray(l.images) ? l.images : [],
      })),
    );
  });

  app.get("/admin/ia/prompts", async (c) => {
    const lignes = await db
      .select()
      .from(schema.aiPrompts)
      .orderBy(asc(schema.aiPrompts.position), asc(schema.aiPrompts.id));
    return c.json(lignes);
  });

  /**
   * Ce qu'un formulaire envoie, remis d'aplomb.
   *
   * Les cinq images sont tenues ICI et non par la base : un tableau JSON ne
   * sait pas se limiter tout seul. On coupe plutôt que de refuser — une
   * sixième image glissée par erreur ne doit pas faire perdre la saisie.
   */
  function styleDepuisLeCorps(b: Record<string, unknown>) {
    const images = (Array.isArray(b.images) ? b.images : [])
      .map((v) => String(v ?? "").trim())
      .filter(Boolean)
      .slice(0, STYLE_IMAGES_MAX);
    return {
      title: String(b.title ?? "").trim().slice(0, 80),
      prompt: String(b.prompt ?? "").trim().slice(0, 8000),
      images,
      position: Number.isFinite(Number(b.position)) ? Number(b.position) : 0,
      active: b.active !== false,
      translations:
        b.translations && typeof b.translations === "object"
          ? (b.translations as Record<string, { title?: string }>)
          : null,
    };
  }

  app.post("/admin/ia/prompts", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const valeurs = styleDepuisLeCorps(b);
    if (!valeurs.title)
      return c.json({ error: "Donnez un titre à ce style." }, 400);
    const [ligne] = await db.insert(schema.aiPrompts).values(valeurs).returning();
    return c.json(ligne, 201);
  });

  app.put("/admin/ia/prompts/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "identifiant invalide" }, 400);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const valeurs = styleDepuisLeCorps(b);
    if (!valeurs.title)
      return c.json({ error: "Donnez un titre à ce style." }, 400);
    const [ligne] = await db
      .update(schema.aiPrompts)
      .set({ ...valeurs, updatedAt: new Date() })
      .where(eq(schema.aiPrompts.id, id))
      .returning();
    if (!ligne) return c.json({ error: "Style introuvable" }, 404);
    return c.json(ligne);
  });

  app.delete("/admin/ia/prompts/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "identifiant invalide" }, 400);
    // Les images restent dans data/assets : elles peuvent servir ailleurs, et
    // une suppression de style ne doit pas faire disparaître un visuel qu'une
    // fiche produit afficherait encore.
    await db.delete(schema.aiPrompts).where(eq(schema.aiPrompts.id, id));
    return c.json({ ok: true });
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
