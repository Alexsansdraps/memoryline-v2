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
 * composition qui finirait par diverger. Une seule chose manque, exprès : la
 * signature de la boutique, réservée au papier (voir plus bas).
 *
 * L'ADRESSE PORTE UN JETON, parce qu'un courrier n'a pas de session : le
 * client de messagerie va chercher l'image sans cookie. Le jeton est un
 * HMAC de l'identifiant de ligne — impossible à deviner, stable dans le
 * temps (un courrier ouvert dans six mois montre encore l'affiche), et il ne
 * donne accès à rien d'autre qu'à cette image-là.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import sharp from "sharp";

import { db, schema } from "./db/client.js";
import { boutsDeTexteImprimes, renderPosterPng } from "./pdf.js";
/*
 * Les données du rendu sont celles du FICHIER D'IMPRESSION, à la lettre.
 *
 * Cette fonction était recopiée ici, et la copie a vieilli : les zones de
 * couleur non proposées, les groupes, puis les familles d'un dessin en pixels
 * sont arrivés d'un côté sans passer de l'autre. Or l'aperçu n'a qu'une seule
 * raison d'être — montrer ce qui part à l'atelier. On lit donc la même.
 */
import { donneesDImpression, enFile } from "./fichiers-impression.js";
import {
  lignesRemplies,
  morceauxDeTexte,
  policeParId,
  POLICE_SOUSTITRE_DEFAUT,
  POLICE_TITRE_DEFAUT,
  sousLignes,
  type PosterConfig,
  type TextesAffiche,
} from "@memoryline/types";

/** Le nombre de personnages d'une configuration lue en base, quelle qu'elle soit. */
function nombreDePersonnages(config: unknown): number {
  const personnages = (config as { characters?: unknown } | null)?.characters;
  return Array.isArray(personnages) ? personnages.length : 0;
}

/**
 * Une affiche IA COMPOSÉE : elle porte du texte (20/11, Alexandra : « le texte
 * ne s'affiche pas sur ma photo personnalisée »), ou des personnages et leur
 * muret (20/11 : « faut pouvoir ajouter personnages et murets si les gens
 * veulent pour les images à partir de leurs photos ! »). Son aperçu ne peut
 * pas être l'image du modèle telle quelle : le reste se pose par-dessus, au
 * fichier d'impression comme sur le site.
 */
export function iaComposee(config: unknown): boolean {
  const c = config as Partial<PosterConfig> | null;
  return (
    !!c?.aiPublicId &&
    (lignesRemplies(c.texts as TextesAffiche | undefined).length > 0 ||
      nombreDePersonnages(c) > 0)
  );
}

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
 * La version de l'aperçu d'une ligne : une empreinte de sa configuration.
 *
 * Une ligne de PANIER se retouche sur place, sous le même identifiant (PUT
 * /cart/:cartId/items/:itemId) — c'est même ce que la relance de panier
 * invite à faire. Rangé et adressé par son seul identifiant, l'aperçu restait
 * celui d'avant la retouche : la relance suivante, la fiche de la commande,
 * l'historique du compte et les courriels montraient « Léa » quand l'atelier
 * imprimait « Léa & Tom », et l'adresse, servie « immutable » pour un an,
 * gardait l'ancienne image chez les messageries. La version entre donc dans
 * le nom du fichier ET dans l'adresse : une autre configuration, une autre
 * image, une autre adresse.
 */
export function versionApercu(config: unknown): string {
  const h = createHash("sha1").update(JSON.stringify(config ?? null));
  // Les vignettes d'affiches IA avec texte rangées avant le 20/11 n'avaient
  // pas leur texte : elles changent d'adresse, donc se refont. Celles qui
  // portent des personnages (20/11) prennent le MÊME sel : une vignette
  // « texte seul » garde ainsi l'adresse déjà partie dans les courriels.
  if (iaComposee(config)) h.update("ia-avec-texte");
  // Celles d'une ligne écrite tout entière dans une autre police que la
  // sienne (« 2025 » seul en Manuscrite) portaient, rangées avant le 26/11,
  // les tampons de la version d'essai (voir ligneEnPoliceDeSecours) : elles
  // changent d'adresse, donc se refont. Les autres gardent la leur.
  if (lignesEnPoliceDeSecours(config).length) h.update("chiffres-en-caveat");
  // Celles d'une ligne où ¢ £ ¤ ¥ ƒ ₤ s'écrivent en Caveat AU MILIEU d'autres
  // lettres (« Voyage à Londres £ » en Manuscrite) portaient, rangées avant
  // le 26/11 à 14 h 31, un tampon à la place du symbole : la police d'essai
  // ne l'écrivait pas, et il n'est passé en Caveat qu'à cette mise en ligne
  // (fonts.ts). Le sel ci-dessus ne voit que les lignes TOUT ENTIÈRES en
  // Caveat : la vignette gardait son adresse et son tampon pendant que le
  // PDF, refait, montrait le symbole (relecture finale du 26/11). Elles
  // changent d'adresse, donc se refont ; les autres gardent la leur.
  if (lignesAvecSymbolesEnSecours(config).length) h.update("symboles-en-caveat");
  // Les chiffres et symboles de la Manuscrite passent de Caveat à Kaushan
  // Script le 27/11 (fonts.ts, « j'aime pas les chiffres en manuscrite ») :
  // toute vignette d'une ligne dont UN morceau s'écrit en police de secours
  // (« 2 décembre 2026 ») change d'adresse, donc se refait. Les autres
  // gardent la leur.
  if (lignesAvecUnMorceauDeSecours(config).length) h.update("secours-kaushan");
  return h.digest("base64url").slice(0, 10);
}

/** Les lignes dont au moins un bout s'écrit dans une autre police que la sienne. */
function lignesAvecUnMorceauDeSecours(config: unknown): { rang: number; texte: string }[] {
  return lignesDontUnBout(config, (morceaux, police) =>
    morceaux.some((m) => m.police.famille !== police.famille),
  );
}

/**
 * Les lignes de l'affiche — ou un morceau coupé par Entrée, ou un bout entre
 * deux emojis — écrites TOUT ENTIÈRES dans une autre police que la leur :
 * « 2025 » seul en Manuscrite, que morceauxDeTexte écrit en Caveat. Leur
 * rang parmi les lignes remplies (0 : la première) et leur texte ; vide si
 * aucune.
 *
 * Jusqu'au 26/11, le moteur les imprimait dans la police de la ligne, et la
 * version d'essai d'another shabby y posait son logo à la place de chaque
 * chiffre (contenuDeLigne, pdf.ts ; Margaux : « erreur chiffre "police
 * manuscrite" en ligne 3 »). Le fichier d'impression se refait de lui-même
 * (son empreinte porte pdf.ts) ; la vignette, rangée par sa seule
 * configuration, non : d'où ce sel. Même police par défaut que le moteur :
 * la serif en tête, la manuscrite ensuite (POLICE_LIGNE_DEFAUT, pdf.ts).
 *
 * Les bouts sont ceux que POSE le moteur (boutsDeTexteImprimes, pdf.ts), pas
 * ceux de la saisie : un emoji que le jeu ne dessine pas (« 🧑‍🧑‍🧒 2025 »,
 * relecture du 26/11) s'efface à l'impression, et « 2025 » y reste seul.
 * Exportée aussi pour retrouver les affiches déjà vendues avec les tampons.
 */
export function lignesEnPoliceDeSecours(config: unknown): { rang: number; texte: string }[] {
  return lignesDontUnBout(
    config,
    (morceaux, police) => morceaux.length === 1 && morceaux[0]!.police.famille !== police.famille,
  );
}

/** Les six symboles que la police d'essai n'écrit qu'en tampon, passés en Caveat le 26/11 (fonts.ts). */
const SYMBOLES_PASSES_EN_CAVEAT = /[¢£¤¥ƒ₤]/;

/**
 * Les lignes de l'affiche où l'un de ces six symboles s'imprime dans une
 * autre police que la sienne, seul ou au milieu d'autres lettres
 * (« Voyage à Londres £ » en Manuscrite) : jusqu'au 26/11 à 14 h 31, le
 * moteur les écrivait dans la police de la ligne, et la version d'essai
 * d'another shabby y posait son tampon. Même lecture que
 * `lignesEnPoliceDeSecours` (relecture finale du 26/11). Exportée aussi pour
 * retrouver les affiches déjà vendues avec ce tampon.
 */
export function lignesAvecSymbolesEnSecours(config: unknown): { rang: number; texte: string }[] {
  return lignesDontUnBout(config, (morceaux, police) =>
    morceaux.some((m) => m.police.famille !== police.famille && SYMBOLES_PASSES_EN_CAVEAT.test(m.texte)),
  );
}

/**
 * Les lignes remplies dont un bout, tel que le pose le moteur, répond à
 * `critere` : ses morceaux (morceauxDeTexte) et la police de la ligne — la
 * même par défaut que le moteur. Vide pour une configuration abîmée, qui
 * garde ainsi sa version d'avant.
 */
function lignesDontUnBout(
  config: unknown,
  critere: (morceaux: ReturnType<typeof morceauxDeTexte>, police: ReturnType<typeof policeParId>) => boolean,
): { rang: number; texte: string }[] {
  try {
    const textes = (config as Partial<PosterConfig> | null)?.texts as TextesAffiche | undefined;
    return lignesRemplies(textes).flatMap((ligne, rang) => {
      const police = policeParId(ligne.font, rang === 0 ? POLICE_TITRE_DEFAUT : POLICE_SOUSTITRE_DEFAUT);
      const touchee = sousLignes(ligne.value).some((sousLigne) =>
        boutsDeTexteImprimes(sousLigne).some((bout) => critere(morceauxDeTexte(bout, police), police)),
      );
      return touchee ? [{ rang, texte: ligne.value }] : [];
    });
  } catch {
    // Une configuration abîmée garde sa version d'avant.
    return [];
  }
}

/**
 * L'adresse publique de l'aperçu d'une ligne, pour SA configuration.
 *
 * Relative : la page d'historique et le courrier n'ont pas la même racine, et
 * c'est l'appelant qui sait laquelle préfixer. Le jeton ne signe que
 * l'identifiant ; `v` ne sert qu'à changer d'adresse quand l'affiche change
 * (voir versionApercu) — la route rend toujours la configuration du moment.
 */
export function cheminApercu(orderItemId: number, config: unknown): string {
  return `/apercus/ligne/${orderItemId}/image.jpg?j=${jetonApercu(orderItemId)}&v=${versionApercu(config)}`;
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
  // « 1234-<version>.jpg » : les autres versions de la ligne 1234 partent.
  const m = /(\d+)-([A-Za-z0-9_-]+)\.jpg$/.exec(cache);
  if (m) void oublierLesAutresVersions(Number(m[1]), m[2]!);
}

/** Le fichier de la vignette d'une ligne, pour une version de son affiche. */
function fichierApercu(orderItemId: number, version: string): string {
  return resolve(APERCUS_DIR, `${orderItemId}-${version}.jpg`);
}

/**
 * Les statuts d'une ligne encore MODIFIABLE : le panier, et la commande
 * passée en caisse mais pas payée, qui redevient un panier à la moindre
 * retouche (panierModifie).
 */
const STATUTS_MODIFIABLES = ["draft", "pending"];

/**
 * L'aperçu de cette configuration est-il déjà fabriqué ? Ne fabrique rien :
 * sert aux pages qui préfèrent une autre image à un rendu à la demande.
 */
export function apercuDejaPret(orderItemId: number, config: unknown): Promise<boolean> {
  return existe(fichierApercu(orderItemId, versionApercu(config)));
}

/**
 * Les autres versions de la vignette d'une ligne, devenues inutiles une fois
 * la nouvelle rangée. Au mieux : un fichier qu'on n'arrive pas à effacer ne
 * gêne personne.
 */
async function oublierLesAutresVersions(orderItemId: number, garder: string): Promise<void> {
  try {
    const prefixe = `${orderItemId}-`;
    const ancien = `${orderItemId}.jpg`;
    const garde = `${orderItemId}-${garder}.jpg`;
    for (const nom of await readdir(APERCUS_DIR)) {
      if (nom === garde) continue;
      if (nom !== ancien && !(nom.startsWith(prefixe) && nom.endsWith(".jpg"))) continue;
      await unlink(resolve(APERCUS_DIR, nom)).catch(() => {});
    }
  } catch {
    /* dossier illisible : rien à nettoyer */
  }
}

/**
 * Les vignettes en cours de calcul : la liste des commandes, la fiche et un
 * courrier qui demandent la même en même temps n'en lancent qu'un. Une par
 * VERSION : une retouche pendant un rendu en lance un autre, pour la
 * nouvelle affiche.
 */
const vignettesEnCours = new Map<string, Promise<Buffer | null>>();

/** Ce qu'il faut savoir d'une ligne pour fabriquer sa vignette. */
interface LigneAApercevoir {
  config: unknown;
  productId: number | null;
  statut: string | null;
  /** La dernière retouche du panier (panierModifie la tient à jour). */
  activite: Date | null;
}

/**
 * Fabrique (ou relit) la vignette d'une ligne de commande, pour sa
 * configuration du moment.
 *
 * Renvoie null quand la ligne n'a rien à montrer : pas de configuration, ou
 * un rendu qui échoue. L'appelant affiche alors un cadre vide plutôt qu'une
 * image cassée.
 */
export async function apercuDeLaLigne(orderItemId: number): Promise<Buffer | null> {
  return (await apercuVersionne(orderItemId))?.image ?? null;
}

/** La vignette d'une ligne, avec la version qu'elle montre. */
async function apercuVersionne(
  orderItemId: number,
): Promise<{ image: Buffer | null; version: string } | null> {
  const [ligne] = await db
    .select({
      config: schema.orderItems.config,
      productId: schema.orderItems.productId,
      statut: schema.orders.status,
      activite: schema.orders.lastActivityAt,
    })
    .from(schema.orderItems)
    .leftJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
    .where(eq(schema.orderItems.id, orderItemId));
  if (!ligne) return null;
  const version = versionApercu(ligne.config);
  const cle = `${orderItemId}-${version}`;
  let vignette = vignettesEnCours.get(cle);
  if (!vignette) {
    vignette = fabriquerApercu(orderItemId, ligne, version).finally(() =>
      vignettesEnCours.delete(cle),
    );
    vignettesEnCours.set(cle, vignette);
  }
  return { image: await vignette, version };
}

async function fabriquerApercu(
  orderItemId: number,
  ligne: LigneAApercevoir,
  version: string,
): Promise<Buffer | null> {
  await prepararerDossier();
  const cache = fichierApercu(orderItemId, version);
  if (await existe(cache)) return readFile(cache);

  /*
   * Les vignettes rangées avant les versions (« 1234.jpg ») : une commande
   * FIGÉE garde la sienne, renommée à sa version — sa configuration ne
   * bougera plus, et on ne refait pas un rendu complet par commande passée.
   * Celle d'une ligne encore modifiable a pu être faite avant une retouche :
   * elle est refaite.
   */
  const ancien = resolve(APERCUS_DIR, `${orderItemId}.jpg`);
  // Et seulement s'il a été fait APRÈS la dernière retouche : fait quand la
  // commande attendait encore son paiement, puis retouchée, il montrerait
  // l'affiche d'avant sous l'adresse de la bonne.
  const fait = await stat(ancien).catch(() => null);
  if (
    !STATUTS_MODIFIABLES.includes(ligne.statut ?? "") &&
    fait?.isFile() &&
    (!ligne.activite || fait.mtime >= ligne.activite)
  ) {
    try {
      await rename(ancien, cache);
      return await readFile(cache);
    } catch {
      // Renommée entre-temps par une autre demande : on relit, sinon on refait.
      if (await existe(cache)) return readFile(cache);
    }
  }

  let config = (ligne.config ?? null) as PosterConfig | null;
  /** Vrai : la ligne se montre par l'image de sa fiche, sans rien composer. */
  let imageDeLaFiche = false;

  /*
   * Affiche générée : son visuel n'est PAS une pile de calques, c'est l'image
   * produite par le modèle. Sans texte, l'aperçu filigrané existe déjà sur le
   * disque — le refabriquer coûterait un rendu complet pour un résultat
   * identique. AVEC du texte ou des personnages (20/11), l'image du modèle
   * devient le fond et le reste se compose par-dessus — muret et personnages
   * compris —, comme au fichier d'impression (configAImprimer,
   * fichiers-impression.ts) : on regarde ce qui part à l'atelier. Le fond
   * reste l'aperçu FILIGRANÉ, pas la pleine définition : la vignette d'un
   * panier pas encore payé ne doit pas livrer l'affiche.
   */
  if (config?.aiPublicId) {
    const [gen] = await db
      .select({ previewPath: schema.aiGenerations.previewPath })
      .from(schema.aiGenerations)
      .where(eq(schema.aiGenerations.publicId, config.aiPublicId));
    if (gen?.previewPath && iaComposee(config)) {
      config = { ...config, backgroundUrl: gen.previewPath };
    } else if (!gen?.previewPath && nombreDePersonnages(config) > 0) {
      // Aperçu purgé (ou génération introuvable) : composer poserait le muret
      // et les personnages sur une page blanche. La ligne se montre alors par
      // l'image de sa fiche, comme une affiche IA sans personnage dont
      // l'aperçu a disparu.
      imageDeLaFiche = true;
    } else if (gen?.previewPath) {
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
    !imageDeLaFiche &&
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
        // Tout du fichier d'impression, SAUF la signature : la boutique la
        // veut sur le papier seulement, et le client ne l'a vue sur aucun
        // aperçu avant de payer. La lui montrer ici, dans un courrier ou son
        // historique, ferait apparaître après coup un logo qu'il n'a jamais
        // validé. Les vignettes déjà rangées sur le disque, celles des
        // commandes d'avant ce choix, gardent la leur (bleue) : on ne refait
        // pas un rendu complet par commande pour un logo de quelques pixels.
        data: { ...(await donneesDImpression()), signature: null },
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
    const apercu = await apercuVersionne(id);
    if (!apercu?.image) return c.notFound();
    // L'adresse change avec l'affiche (versionApercu) : à adresse égale,
    // image égale, autant que le navigateur et la messagerie la gardent.
    // Sauf une adresse d'une version DÉPASSÉE (un vieux courrier, une page
    // ouverte avant une retouche) : elle reçoit l'image du moment, qui n'est
    // pas la sienne, et ne doit donc pas la garder — sinon, la retouche
    // défaite, la même adresse resservirait l'image intermédiaire pendant un
    // an. Une adresse sans version (d'avant les versions) reste gardée.
    const demandee = c.req.query("v");
    const perimee = demandee !== undefined && demandee !== apercu.version;
    return new Response(new Uint8Array(apercu.image), {
      headers: {
        "content-type": "image/jpeg",
        "cache-control": perimee ? "no-cache" : "public, max-age=31536000, immutable",
      },
    });
  });
}
