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
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import type { PosterConfig } from "@memoryline/types";
import { db, schema } from "./db/client.js";
import { renderPosterPdf, type ResolveData } from "./pdf.js";

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
  const format = config.format ?? "A4";
  const [data, aImprimer] = await Promise.all([
    donneesDImpression(),
    configAImprimer(config),
  ]);
  const chemin = resolve(
    DOSSIER_IMPRESSIONS,
    `${orderItemId}-${empreinte(aImprimer, data)}.pdf`,
  );

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
      const pdf = await renderPosterPdf(aImprimer, { data, format });
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
