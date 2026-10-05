/**
 * L'aperçu d'une ligne de commande, en image.
 *
 * L'historique du client et les courriers listaient des titres :
 * « MERS-LES-BAINS Baigneurs #2 », « CÔTE D'OPALE Plage FACE ». Trois
 * commandes plus tard, on ne sait plus laquelle était laquelle — et c'est
 * justement pour la revoir qu'on ouvre la page.
 *
 * Le rendu se fait ICI, sur le serveur, et non dans le navigateur comme
 * l'aperçu du panier. Deux raisons :
 *
 *  - un courrier ne sait pas exécuter de code : il lui faut une image, à une
 *    adresse qu'il puisse aller chercher tout seul ;
 *  - la page d'historique n'a plus à charger la bibliothèque des personnages
 *    ni à empiler des SVG pour une vignette de 80 pixels.
 *
 * C'est le MÊME moteur que le fichier d'impression (`renderPosterPng`) : ce
 * que le client revoit est ce qui part à l'atelier, et non une deuxième
 * composition qui finirait par diverger.
 *
 * L'ADRESSE PORTE UN JETON, parce qu'un courrier n'a pas de session : le
 * client de messagerie va chercher l'image sans cookie. Le jeton est un
 * HMAC de l'identifiant de ligne — impossible à deviner, stable dans le
 * temps (un courrier ouvert dans six mois montre encore l'affiche), et il ne
 * donne accès à rien d'autre qu'à cette image-là.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import sharp from "sharp";

import { db, schema } from "./db/client.js";
import { renderPosterPng } from "./pdf.js";
/*
 * Les données du rendu sont celles du FICHIER D'IMPRESSION, à la lettre.
 *
 * Cette fonction était recopiée ici, et la copie a vieilli : les zones de
 * couleur non proposées, les groupes, puis les familles d'un dessin en pixels
 * sont arrivés d'un côté sans passer de l'autre. Or l'aperçu n'a qu'une seule
 * raison d'être — montrer ce qui part à l'atelier. On lit donc la même.
 */
import { donneesDImpression, enFile } from "./fichiers-impression.js";
import type { PosterConfig } from "@memoryline/types";

const ASSETS_DIR = resolve(fileURLToPath(import.meta.url), "../../../../data/assets");
/** Les vignettes déjà calculées. Un rendu complet coûte plusieurs secondes. */
const APERCUS_DIR = resolve(ASSETS_DIR, "apercus");

/*
 * Le dossier se crée à la PREMIÈRE vignette, et non au chargement du module.
 *
 * Un `await` au niveau du module rend celui-ci asynchrone ; comme il est
 * importé par les courriers, qui sont importés par le point d'entrée, cela
 * suffisait à laisser tout le graphe d'imports à moitié initialisé — et
 * l'API entière répondait 500, y compris sur des routes qui n'ont rien à
 * voir avec les aperçus.
 */
let dossierPret: Promise<unknown> | null = null;
function prepararerDossier(): Promise<unknown> {
  dossierPret ??= mkdir(APERCUS_DIR, { recursive: true });
  return dossierPret;
}

/**
 * Largeur de la vignette.
 *
 * 600 px : net sur un écran à haute densité qui l'affiche en 300, et assez
 * léger pour partir dans un courrier sans le faire grossir. Le moteur, lui,
 * compose toujours à 300 points par pouce — c'est la réduction qui suit.
 */
const LARGEUR_APERCU = 600;

/**
 * La clé qui signe les adresses.
 *
 * `APP_SECRET` si elle existe, sinon l'URL de la base. Elle ne quitte jamais
 * le serveur : seul le HMAC voyage.
 *
 * LE REPLI SUR L'ADRESSE DE LA BASE EST UN PIÈGE, et il s'est refermé le
 * 11 septembre 2026. Cette adresse est bien secrète, mais elle BOUGE : en
 * déménageant la base de Neon vers le serveur, la clé a changé avec elle, et
 * toutes les vignettes des courriers déjà partis chez les clientes ont cessé
 * de s'afficher — sans erreur, sans trace, sans que personne puisse faire le
 * rapprochement. On garde le repli, parce qu'une boutique qui refuse de
 * démarrer faute d'une clé d'images serait pire ; mais on le signale au
 * démarrage, ce qui manquait.
 */
const CLE = process.env.APP_SECRET || process.env.DATABASE_URL || "memory-line";

if (process.env.NODE_ENV === "production" && !process.env.APP_SECRET) {
  console.warn(
    "[apercus] APP_SECRET n'est pas définie : les vignettes des courriers " +
      "sont signées avec l'adresse de la base. Le jour où celle-ci changera, " +
      "les vignettes des courriers déjà envoyés cesseront de s'afficher. " +
      "Voir APP_SECRET dans .env.example.",
  );
}

/** Le jeton d'une ligne : court, mais 80 bits, donc indevinable. */
export function jetonApercu(orderItemId: number): string {
  return createHmac("sha256", CLE)
    .update(`apercu:${orderItemId}`)
    .digest("base64url")
    .slice(0, 16);
}

/** Comparaison à durée constante : un `===` fuiterait le jeton octet par octet. */
function jetonValide(orderItemId: number, fourni: string): boolean {
  const attendu = Buffer.from(jetonApercu(orderItemId));
  const recu = Buffer.from(String(fourni ?? ""));
  return attendu.length === recu.length && timingSafeEqual(attendu, recu);
}

/**
 * L'adresse publique de l'aperçu d'une ligne.
 *
 * Relative : la page d'historique et le courrier n'ont pas la même racine, et
 * c'est l'appelant qui sait laquelle préfixer.
 */
export function cheminApercu(orderItemId: number): string {
  return `/apercus/ligne/${orderItemId}/image.jpg?j=${jetonApercu(orderItemId)}`;
}

/** Un fichier existe-t-il déjà ? */
async function existe(chemin: string): Promise<boolean> {
  try {
    return (await stat(chemin)).isFile();
  } catch {
    return false;
  }
}

/**
 * Range une vignette : écrite à côté puis renommée.
 *
 * Écrite directement, une vignette lue PENDANT l'écriture — la liste et la
 * fiche de la même commande la demandent ensemble — partait tronquée, avec un
 * en-tête qui dit au navigateur de la garder un an.
 */
async function rangerVignette(cache: string, vignette: Buffer): Promise<void> {
  const provisoire = `${cache}.${process.pid}.tmp`;
  await writeFile(provisoire, vignette);
  await rename(provisoire, cache);
}

/**
 * Les vignettes en cours de calcul : la liste des commandes, la fiche et un
 * courrier qui demandent la même en même temps n'en lancent qu'un.
 */
const vignettesEnCours = new Map<number, Promise<Buffer | null>>();

/**
 * Fabrique (ou relit) la vignette d'une ligne de commande.
 *
 * Renvoie null quand la ligne n'a rien à montrer : pas de configuration, ou
 * un rendu qui échoue. L'appelant affiche alors un cadre vide plutôt qu'une
 * image cassée.
 */
export function apercuDeLaLigne(orderItemId: number): Promise<Buffer | null> {
  let vignette = vignettesEnCours.get(orderItemId);
  if (!vignette) {
    vignette = fabriquerApercu(orderItemId).finally(() =>
      vignettesEnCours.delete(orderItemId),
    );
    vignettesEnCours.set(orderItemId, vignette);
  }
  return vignette;
}

async function fabriquerApercu(orderItemId: number): Promise<Buffer | null> {
  await prepararerDossier();
  const cache = resolve(APERCUS_DIR, `${orderItemId}.jpg`);
  if (await existe(cache)) return readFile(cache);

  const [ligne] = await db
    .select({
      config: schema.orderItems.config,
      productId: schema.orderItems.productId,
    })
    .from(schema.orderItems)
    .where(eq(schema.orderItems.id, orderItemId));
  if (!ligne) return null;

  const config = (ligne.config ?? null) as PosterConfig | null;

  /*
   * Affiche générée : son visuel n'est PAS une pile de calques, c'est l'image
   * produite par le modèle. L'aperçu filigrané existe déjà sur le disque — le
   * refabriquer coûterait un rendu complet pour un résultat identique.
   */
  if (config?.aiPublicId) {
    const [gen] = await db
      .select({ previewPath: schema.aiGenerations.previewPath })
      .from(schema.aiGenerations)
      .where(eq(schema.aiGenerations.publicId, config.aiPublicId));
    if (gen?.previewPath) {
      try {
        const brut = await readFile(resolve(ASSETS_DIR, gen.previewPath.replace(/^\/+/, "")));
        const vignette = await sharp(brut)
          .resize({ width: LARGEUR_APERCU, withoutEnlargement: true })
          .jpeg({ quality: 78, mozjpeg: true })
          .toBuffer();
        await rangerVignette(cache, vignette);
        return vignette;
      } catch {
        /* aperçu introuvable : on tente le rendu complet ci-dessous */
      }
    }
  }

  /*
   * Affiche prête à imprimer : ni fond ni personnage à empiler. C'est le
   * visuel de boutique qui la représente — le composer donnerait une page
   * vide.
   */
  const composee =
    config &&
    (Boolean(config.backgroundUrl) || (config.characters?.length ?? 0) > 0);

  if (!composee) {
    if (ligne.productId == null) return null;
    const [img] = await db
      .select({ url: schema.productImages.url })
      .from(schema.productImages)
      .where(eq(schema.productImages.productId, ligne.productId))
      .orderBy(schema.productImages.position)
      .limit(1);
    if (!img?.url) return null;
    try {
      const brut = await readFile(resolve(ASSETS_DIR, img.url.replace(/^\/+(assets\/)?/, "")));
      const vignette = await sharp(brut)
        .resize({ width: LARGEUR_APERCU, withoutEnlargement: true })
        .jpeg({ quality: 78, mozjpeg: true })
        .toBuffer();
      await rangerVignette(cache, vignette);
      return vignette;
    } catch {
      return null;
    }
  }

  try {
    /*
     * Le rendu complet passe par la file des fichiers d'impression, APRÈS
     * eux (fichiers-impression.ts). Lancées toutes ensemble à l'ouverture de
     * la liste des commandes, ces vignettes — un rendu à 300 points par
     * pouce chacune — occupaient le serveur au point qu'un PDF demandé au
     * même moment mettait plus de deux minutes à venir, quand il venait.
     */
    const vignette = await enFile("apercu", async () => {
      const pleine = await renderPosterPng(config!, {
        data: await donneesDImpression(),
        // Toujours l'A4 : la vignette ne sert qu'à reconnaître l'affiche, et le
        // rapport des deux formats est le même.
        format: "A4",
      });
      return sharp(pleine)
        .resize({ width: LARGEUR_APERCU })
        .jpeg({ quality: 78, mozjpeg: true })
        .toBuffer();
    });
    await rangerVignette(cache, vignette);
    return vignette;
  } catch (e) {
    console.error("[aperçu ligne]", orderItemId, e);
    return null;
  }
}

export function mountApercus(app: Hono) {
  /**
   * La vignette d'une ligne.
   *
   * Publique, mais l'adresse porte un jeton : un courrier va chercher l'image
   * sans session, et un identifiant de ligne seul se devinerait en comptant.
   */
  /*
   * Le « .png » vit dans son PROPRE segment, et l'identifiant n'a pas de
   * motif : un paramètre à motif suivi d'un littéral dans le même segment
   * («:id{[0-9]+}.png») est un chemin que le routeur de Hono ne sait pas
   * construire — et il ne le dit pas à l'enregistrement, il échoue à CHAQUE
   * requête, y compris sur les routes qui n'ont rien à voir. L'API entière
   * répondait 500.
   *
   * L'extension reste dans l'adresse : certaines messageries refusent de
   * charger une image dont l'adresse n'en porte pas. Et c'est du JPEG, pas
   * du PNG : une affiche est une image photographique, que le PNG faisait
   * peser 700 Ko à 1,2 Mo pour 600 pixels de large.
   */
  app.get("/apercus/ligne/:id/image.jpg", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.notFound();
    if (!jetonValide(id, c.req.query("j") ?? ""))
      return c.json({ error: "adresse invalide" }, 403);
    const image = await apercuDeLaLigne(id);
    if (!image) return c.notFound();
    return new Response(new Uint8Array(image), {
      headers: {
        "content-type": "image/jpeg",
        // Le visuel d'une commande passée ne change plus : autant que le
        // navigateur et le client de messagerie le gardent.
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  });
}
