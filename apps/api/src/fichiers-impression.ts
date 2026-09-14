/**
 * Le fichier d'impression d'une ligne de commande : fabriqué une fois, rangé,
 * rendu aussitôt.
 *
 * AVANT, il était fabriqué pour rien, deux fois :
 *
 *   - au paiement, le PDF entier était calculé… puis jeté : seul son NOM
 *     était gardé. Et la cliente attendait la fin de ce calcul, écran de
 *     paiement figé, avant d'apprendre que sa commande était passée ;
 *   - au téléchargement, il était recalculé depuis zéro, à chaque clic.
 *
 * MAINTENANT, le paiement répond tout de suite ; le fichier se prépare
 * derrière, et se range dans data/assets/cache/impressions/. Le bouton
 * « Télécharger » le rend tel quel. S'il n'y est pas — commande d'avant,
 * ménage passé par là —, il est fabriqué et rangé à ce moment-là.
 *
 * UN FICHIER RANGÉ NE MENT PAS. Son nom porte l'empreinte de tout ce qui le
 * dessine : la personnalisation, les personnages et leurs pièces, leur
 * calage, le fond — et le lancement de l'API qui l'a calculé. Un calage repris
 * au back-office, une mise à jour qui corrige le rendu, et l'empreinte change :
 * le fichier est refait au lieu d'être resservi.
 *
 * UNE AFFICHE PRÊTE À IMPRIMER ne se compose pas : elle n'a ni fond, ni
 * personnage, ni texte, et le moteur des affiches composées en tirait une
 * page blanche. Son fichier d'impression est son visuel, pris dans les images
 * de sa fiche (voir visuelDImpression) — et son empreinte porte le contenu de
 * cette image : un visuel remplacé refait le fichier.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { asc, eq } from "drizzle-orm";
import sharp from "sharp";
import {
  lignesRemplies,
  type PosterConfig,
  type PosterFormat,
  type TextesAffiche,
} from "@memoryline/types";
import { db, schema } from "./db/client.js";
import {
  FORMAT_PX,
  renderImagePdf,
  renderPosterPdf,
  type ResolveData,
} from "./pdf.js";

const ASSETS_DIR = resolve(fileURLToPath(import.meta.url), "../../../../data/assets");

/**
 * Ce qu'on peut effacer sans rien perdre : tout s'y recalcule. La sauvegarde
 * l'ignore (scripts/sauvegarder.sh). Pas servi au public : /assets ne sert
 * que les fichiers posés à plat dans data/assets.
 */
const DOSSIER_CACHE = resolve(ASSETS_DIR, "cache");
const DOSSIER_IMPRESSIONS = resolve(DOSSIER_CACHE, "impressions");

/**
 * Au-delà, un fichier qui n'a pas servi est effacé : une affiche s'imprime
 * dans la semaine, et une réimpression tardive se recalcule. Sans ménage, le
 * disque du serveur se remplirait d'une dizaine de Mo par affiche vendue.
 */
const JOURS_DE_GARDE = 60;

/**
 * Change à chaque lancement de l'API. Un correctif du rendu arrive toujours
 * par une mise à jour, donc par un lancement : aucun fichier calculé par
 * l'ancien code ne peut être resservi, sans que personne ait à y penser.
 */
const LANCEMENT = String(Date.now());

/** Charge les données nécessaires au rendu PDF d'un snapshot. */
export async function donneesDImpression(): Promise<ResolveData> {
  const [assets, backgrounds, types] = await Promise.all([
    db.select().from(schema.assets),
    db.select().from(schema.backgrounds),
    db.select().from(schema.characterTypes),
  ]);
  const assetMap = new Map<string, any>();
  for (const a of assets)
    assetMap.set(String(a.id), {
      id: a.id,
      slot: a.slot,
      svgUrl: a.svgUrl,
      colorZones: a.colorZones,
      position: a.position,
    });
  // Personnages (SVG de base pré-composé) pour le rendu PDF du nouveau modèle.
  const charMap = new Map<string, any>();
  for (const t of types)
    charMap.set(String(t.id), {
      id: t.id,
      baseSvgUrl: t.baseSvgUrl,
      baseColorZones: t.baseColorZones,
      bottomPct: t.bottomPct ?? 1,
      // Calage des pièces : sans lui, le PDF poserait les coupes et les
      // vêtements ailleurs que l'aperçu validé par le client.
      slotAdjust: t.slotAdjust ?? null,
    });
  const bgMap = new Map<string, any>();
  for (const b of backgrounds)
    bgMap.set(String(b.id), { id: b.id, url: b.url });
  return { assets: assetMap, characters: charMap, backgrounds: bgMap };
}

/**
 * L'affiche telle qu'elle s'imprime.
 *
 * Affiche générée par IA : le visuel N'EST PAS la pile de calques habituelle
 * (elle n'a ni fond, ni personnages), c'est l'image produite par le modèle.
 * On la donne au moteur comme fond, et les lignes de texte se composent
 * par-dessus comme sur n'importe quelle affiche.
 *
 * Cette substitution n'était faite qu'au paiement, dans le fichier jeté : le
 * bouton « Télécharger », lui, rendait une page BLANCHE portant les textes.
 */
async function configAImprimer(config: PosterConfig): Promise<PosterConfig> {
  if (!config.aiPublicId) return config;
  const [gen] = await db
    .select({ fullPath: schema.aiGenerations.fullPath })
    .from(schema.aiGenerations)
    .where(eq(schema.aiGenerations.publicId, config.aiPublicId));
  if (!gen?.fullPath)
    // Mieux vaut une erreur bruyante qu'un A4 blanc glissé dans un colis.
    throw new Error(
      `Affiche IA ${config.aiPublicId} : image pleine définition introuvable`,
    );
  return { ...config, backgroundUrl: gen.fullPath };
}

/** L'empreinte de tout ce qui dessine cette affiche (voir en tête). */
function empreinte(config: PosterConfig, data: ResolveData): string {
  const h = createHash("sha1");
  h.update(LANCEMENT);
  h.update(JSON.stringify(config));
  for (const perso of config.characters ?? []) {
    h.update(JSON.stringify(data.characters?.get(String(perso.typeId)) ?? null));
    for (const id of Object.values(perso.assets ?? {}))
      h.update(JSON.stringify(data.assets.get(String(id)) ?? null));
  }
  if (config.backgroundId != null)
    h.update(JSON.stringify(data.backgrounds?.get(String(config.backgroundId)) ?? null));
  return h.digest("hex").slice(0, 20);
}

/**
 * La configuration dessine-t-elle quoi que ce soit ?
 *
 * Une ligne sans fond, sans personnage et sans texte sortait en page blanche,
 * sans un mot. C'est ce qui arrive à une affiche prête à imprimer dont le
 * produit a été supprimé du catalogue : il ne reste rien pour retrouver son
 * visuel.
 */
function dessineQuelqueChose(config: PosterConfig): boolean {
  return (
    Boolean(config.backgroundUrl) ||
    (config.backgroundId != null && config.backgroundId !== "") ||
    (config.characters?.length ?? 0) > 0 ||
    lignesRemplies(config.texts as TextesAffiche | undefined).length > 0
  );
}

/* -------------------------------------------------------------------------- */
/*  Affiches prêtes à imprimer                                                */
/* -------------------------------------------------------------------------- */

/**
 * La définition en dessous de laquelle on refuse d'imprimer.
 *
 * 150 points par pouce : le plancher habituel d'une affiche regardée à un
 * mètre. En dessous, l'image est floue sur le papier.
 *
 * Ce refus protège surtout d'une erreur précise : les images des fiches
 * importées de l'ancienne boutique sont des MISES EN SCÈNE — l'affiche dans
 * un cadre, devant une plante —, en 1020 × 1400 pixels. Imprimée, une telle
 * image donnerait la photo d'un cadre, et c'est justement leur petite taille
 * qui les trahit. Le visuel d'origine, ajouté aux images de la fiche, est
 * bien plus grand : il est alors choisi de lui-même.
 */
const PPP_MINIMUM = 150;

/**
 * L'écart toléré avec les proportions d'une feuille A (hauteur = largeur ×
 * √2). Au-delà — une vue carrée, un visuel en largeur —, l'image n'est pas le
 * visuel de l'affiche mais une autre photo de la fiche : on ne l'imprime pas.
 * Dix pour cent laissent passer un visuel en 2:3 ou en 3:4, posé en entier
 * avec un peu de blanc sur les côtés.
 */
const ECART_PROPORTIONS_MAX = 0.1;

interface Visuel {
  url: string;
  image: Buffer;
}

/** Le chemin d'une image de fiche dans data/assets, ou null s'il n'y est pas. */
function cheminDansLesAssets(url: string): string | null {
  // Une adresse d'un autre site n'est pas un fichier d'ici : on ne va rien
  // télécharger au moment d'imprimer.
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null;
  const relatif = (url.split("?")[0] ?? "").replace(/^\/+(assets\/)?/, "");
  if (!relatif) return null;
  const chemin = resolve(ASSETS_DIR, relatif);
  // Un « ../ » glissé dans l'adresse ne doit mener nulle part ailleurs.
  return chemin.startsWith(ASSETS_DIR + sep) ? chemin : null;
}

/**
 * Le visuel à imprimer d'une affiche prête à imprimer.
 *
 * Il n'existe pas de champ « fichier d'impression » sur un produit : ce sont
 * les images de sa fiche. On y prend le fichier ORIGINAL (jamais les
 * réductions servies au site, data/assets/tailles) le plus grand parmi celles
 * qui ont les proportions d'une affiche en hauteur. La première image de la
 * fiche peut donc rester une mise en scène : le visuel d'origine, plus grand,
 * est choisi pour l'impression sans rien changer à ce que montre la boutique.
 *
 * Lève une erreur qui dit quoi faire quand rien n'est imprimable : mieux vaut
 * un refus clair qu'une page blanche — ou la photo d'un cadre — glissée dans
 * un colis.
 */
async function visuelDImpression(
  produit: { id: number; nom: string },
  format: PosterFormat,
): Promise<Visuel> {
  const images = await db
    .select({ url: schema.productImages.url })
    .from(schema.productImages)
    .where(eq(schema.productImages.productId, produit.id))
    .orderBy(asc(schema.productImages.position), asc(schema.productImages.id));
  if (!images.length)
    throw new Error(
      `« ${produit.nom} » n'a aucune image. Ajoutez son visuel d'impression dans les images de sa fiche.`,
    );

  const lues: { url: string; chemin: string; largeur: number; hauteur: number; vectoriel: boolean }[] = [];
  for (const { url } of images) {
    const chemin = cheminDansLesAssets(url);
    if (!chemin) continue;
    try {
      // L'en-tête suffit : on ne lit l'image entière que pour celle retenue.
      const m = await sharp(chemin).metadata();
      if (!m.width || !m.height) continue;
      // Orientation 5 à 8 : l'image est enregistrée couchée, et redressée à
      // l'affichage comme à l'impression.
      const couchee = (m.orientation ?? 1) >= 5;
      lues.push({
        url,
        chemin,
        largeur: couchee ? m.height : m.width,
        hauteur: couchee ? m.width : m.height,
        vectoriel: m.format === "svg",
      });
    } catch {
      // fichier absent ou illisible : on regarde les autres
    }
  }
  if (!lues.length)
    throw new Error(
      `les images de « ${produit.nom} » sont introuvables sur le serveur (${images.map((i) => i.url).join(", ")}). Remettez son visuel d'impression dans les images de sa fiche.`,
    );

  const enHauteur = lues.filter(
    (v) => Math.abs(v.hauteur / v.largeur / Math.SQRT2 - 1) <= ECART_PROPORTIONS_MAX,
  );
  if (!enHauteur.length)
    throw new Error(
      `aucune image de « ${produit.nom} » n'a les proportions d'une affiche A4/A3 en hauteur. Ajoutez son visuel d'impression, en portrait, dans les images de sa fiche.`,
    );

  const [meilleur] = enHauteur.sort(
    (a, b) =>
      Number(b.vectoriel) - Number(a.vectoriel) ||
      b.largeur * b.hauteur - a.largeur * a.hauteur,
  );
  const { width: W, height: H } = FORMAT_PX[format];
  const ppp = Math.floor(300 * Math.min(meilleur!.largeur / W, meilleur!.hauteur / H));
  // Un dessin vectoriel se rasterise à la taille de la feuille : il n'a pas
  // de définition à vérifier.
  if (!meilleur!.vectoriel && ppp < PPP_MINIMUM)
    throw new Error(
      `la plus grande image de « ${produit.nom} » ne fait que ${meilleur!.largeur} × ${meilleur!.hauteur} pixels : ` +
        `imprimée en ${format}, elle serait floue (${ppp} points par pouce, il en faut au moins ${PPP_MINIMUM}). ` +
        `C'est souvent la photo de mise en scène de la fiche. Ajoutez le visuel d'origine en haute définition ` +
        `(au moins ${Math.ceil((W * PPP_MINIMUM) / 300)} × ${Math.ceil((H * PPP_MINIMUM) / 300)} pixels) dans les images de sa fiche : ` +
        `le fichier d'impression le prendra de lui-même.`,
    );

  return { url: meilleur!.url, image: await readFile(meilleur!.chemin) };
}

/** L'empreinte d'un visuel prêt à imprimer : son contenu, pas seulement son nom. */
function empreinteVisuel(visuel: Visuel, format: PosterFormat): string {
  return createHash("sha1")
    .update(LANCEMENT)
    .update("prete_a_imprimer")
    .update(format)
    .update(visuel.url)
    .update(visuel.image)
    .digest("hex")
    .slice(0, 20);
}

/**
 * Une affiche à la fois.
 *
 * Un rendu A3 tient plusieurs centaines de Mo de pixels en mémoire, et le
 * serveur n'en a que quatre Go pour tout faire tourner. Une commande de cinq
 * affiches, lancées ensemble, pourrait le mettre à genoux ; les unes après
 * les autres, elles passent.
 */
let fileDAttente: Promise<unknown> = Promise.resolve();
function aLaSuite<T>(travail: () => Promise<T>): Promise<T> {
  const suite = fileDAttente.then(travail, travail);
  fileDAttente = suite.catch(() => undefined);
  return suite;
}

/** Les fichiers en cours de fabrication : un téléchargement attend celui du paiement. */
const enCours = new Map<string, Promise<Buffer>>();

/**
 * Le PDF d'impression d'une ligne : le fichier rangé s'il existe, sinon
 * fabriqué, rangé et rendu.
 */
export async function fichierDImpression(
  orderItemId: number,
  config: PosterConfig,
): Promise<Buffer> {
  const format: PosterFormat = config.format ?? "A4";

  // Le genre se lit sur le PRODUIT de la ligne, pas dans la configuration :
  // celle d'une affiche prête à imprimer ne dit rien d'elle (ni fond, ni
  // personnage). Les ventes du stand passent par le même panier, donc par la
  // même colonne.
  const [produit] = await db
    .select({
      id: schema.products.id,
      nom: schema.products.name,
      genre: schema.products.kind,
    })
    .from(schema.orderItems)
    .innerJoin(schema.products, eq(schema.orderItems.productId, schema.products.id))
    .where(eq(schema.orderItems.id, orderItemId));

  // Une ligne qui porte sa propre composition (fond, personnages, image
  // générée) s'imprime comme telle, quel que soit le genre du produit : une
  // affiche du catalogue peut aussi s'ouvrir à l'IA.
  const composee =
    Boolean(config.aiPublicId || config.backgroundUrl) ||
    (config.backgroundId != null && config.backgroundId !== "") ||
    (config.characters?.length ?? 0) > 0;

  let cle: string;
  let fabriquer: () => Promise<Buffer>;
  if (produit?.genre === "prete_a_imprimer" && !composee) {
    const visuel = await visuelDImpression(produit, format);
    cle = empreinteVisuel(visuel, format);
    fabriquer = () => renderImagePdf(visuel.image, format);
  } else {
    const [data, aImprimer] = await Promise.all([
      donneesDImpression(),
      configAImprimer(config),
    ]);
    if (!dessineQuelqueChose(aImprimer))
      throw new Error(
        "cette ligne n'a rien à imprimer : ni fond, ni personnage, ni texte. " +
          "Si c'était une affiche prête à imprimer, son produit n'est plus au catalogue, et son visuel avec lui.",
      );
    cle = empreinte(aImprimer, data);
    fabriquer = () => renderPosterPdf(aImprimer, { data, format });
  }
  const chemin = resolve(DOSSIER_IMPRESSIONS, `${orderItemId}-${cle}.pdf`);

  try {
    const pdf = await readFile(chemin);
    const maintenant = new Date();
    await utimes(chemin, maintenant, maintenant).catch(() => {});
    return pdf;
  } catch {
    // Pas encore fabriqué.
  }

  let travail = enCours.get(chemin);
  if (!travail) {
    travail = aLaSuite(async () => {
      const pdf = await fabriquer();
      await ranger(orderItemId, chemin, pdf);
      return pdf;
    }).finally(() => enCours.delete(chemin));
    enCours.set(chemin, travail);
  }
  return travail;
}

/**
 * Lance la fabrication sans l'attendre — au paiement, pour que le fichier soit
 * prêt quand on viendra le chercher. Une erreur est journalisée, pas levée :
 * le téléchargement retentera, et dira ce qui ne va pas.
 */
export function preparerFichierDImpression(orderItemId: number, config: PosterConfig): void {
  fichierDImpression(orderItemId, config).catch((e) =>
    console.error(`[impression] ligne ${orderItemId} non préparée :`, e),
  );
}

async function ranger(orderItemId: number, chemin: string, pdf: Buffer): Promise<void> {
  try {
    await mkdir(DOSSIER_IMPRESSIONS, { recursive: true });
    // Écrit à côté puis renommé : un téléchargement qui lirait le fichier
    // pendant l'écriture recevrait un PDF tronqué.
    const provisoire = `${chemin}.${process.pid}.tmp`;
    await writeFile(provisoire, pdf);
    await rename(provisoire, chemin);
    // Les versions précédentes de la même ligne ne resserviront plus.
    const prefixe = `${orderItemId}-`;
    for (const nom of await readdir(DOSSIER_IMPRESSIONS))
      if (nom.startsWith(prefixe) && resolve(DOSSIER_IMPRESSIONS, nom) !== chemin)
        await rm(resolve(DOSSIER_IMPRESSIONS, nom), { force: true });
  } catch (e) {
    // Un disque plein ne doit pas empêcher d'imprimer : le PDF est là, en
    // mémoire, simplement pas rangé pour la prochaine fois.
    console.warn("[impression] PDF non rangé :", String(e));
  }
  void menageDuCache();
}

/**
 * Efface ce qui n'a pas servi depuis {@link JOURS_DE_GARDE} jours : fichiers
 * d'impression et fonds rasterisés (pdf.ts). Une fois par jour au plus, à
 * l'occasion d'un rangement — pas de minuterie à entretenir.
 */
let dernierMenage = 0;
async function menageDuCache(): Promise<void> {
  const maintenant = Date.now();
  if (maintenant - dernierMenage < 24 * 3600 * 1000) return;
  dernierMenage = maintenant;
  const limite = maintenant - JOURS_DE_GARDE * 24 * 3600 * 1000;
  for (const dossier of [DOSSIER_IMPRESSIONS, resolve(DOSSIER_CACHE, "fonds")]) {
    let noms: string[];
    try {
      noms = await readdir(dossier);
    } catch {
      continue;
    }
    for (const nom of noms) {
      const chemin = resolve(dossier, nom);
      try {
        if ((await stat(chemin)).mtimeMs < limite) await rm(chemin, { force: true });
      } catch {
        // disparu entre-temps : rien à faire
      }
    }
  }
}
