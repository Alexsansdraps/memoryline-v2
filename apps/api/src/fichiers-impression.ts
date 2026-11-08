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
 *
 * LE BACK-OFFICE NE DOIT JAMAIS ATTENDRE À L'AVEUGLE. « La plupart du temps
 * on ne peut pas télécharger le PDF », disait la boutique : le lien ouvrait un
 * onglet blanc, et le fichier se fabriquait PENDANT ce temps, dans la requête.
 * Sur le serveur de test (deux cœurs, quatre Go), le premier rendu d'un fond
 * prend 45 s en A4 et deux minutes en A3 ; et il se faisait en même temps que
 * les vignettes de la liste des commandes, rendues elles aussi à 300 points
 * par pouce, toutes à la fois. Mesuré sur deux cœurs : six vignettes et un
 * PDF lancés ensemble, et le PDF arrivait au bout de 159 s, l'API montée à
 * 2,4 Go — de quoi la faire tuer par le système, et l'onglet finissait sur
 * une erreur ou sur rien. Désormais :
 *
 *   - tout rendu lourd passe par UNE file (plus bas), avec une place gardée
 *     pour ce que le back-office attend : une vignette ne passe plus jamais
 *     devant un fichier d'impression ;
 *   - le back-office demande d'abord où en est le fichier
 *     (etatDuFichierDImpression) et le dit — « en préparation », « prêt »,
 *     « échec : la raison » —, au lieu d'ouvrir un onglet qui attend ;
 *   - au démarrage de l'API, les fichiers des commandes à expédier sont
 *     refaits d'avance quand une mise à jour du rendu les a rendus caducs
 *     (demarrerPreparationDesImpressions).
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { and, asc, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import sharp from "sharp";
import {
  afficheComposee,
  avecToutesLesFamillesProposees,
  lignesRemplies,
  sansPastillesProposees,
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
 * L'empreinte du CODE qui dessine les affiches.
 *
 * Elle changeait à chaque lancement de l'API (`Date.now()`) : un correctif du
 * rendu ne pouvait pas être oublié, mais chaque redémarrage — chaque mise en
 * ligne, chaque reboot du serveur — jetait TOUS les fichiers déjà prêts, et le
 * premier « Télécharger » de chaque affiche reprenait jusqu'à une minute.
 *
 * Elle porte désormais le CONTENU des fichiers qui dessinent : le moteur
 * (pdf.ts), ce module, la recoloration, et les règles communes du paquet
 * types (empilement, formats, polices, couleurs…). Un correctif du rendu
 * change l'un d'eux, donc l'empreinte, donc les fichiers sont refaits ; une
 * mise en ligne qui ne touche pas au rendu les garde. Si un fichier ne se lit
 * pas, on retombe sur l'ancienne règle, prudente.
 *
 * Les fichiers ainsi devenus caducs ne sont plus refaits au premier clic :
 * ceux des commandes à expédier se refont d'avance au démarrage (voir
 * demarrerPreparationDesImpressions, en bas).
 */
const LANCEMENT = (() => {
  try {
    const ici = fileURLToPath(new URL(".", import.meta.url));
    const types = resolve(ici, "../../../packages/types/src");
    const fichiers = [
      resolve(ici, "pdf.ts"),
      resolve(ici, "fichiers-impression.ts"),
      resolve(ici, "couleurs-image-fichier.ts"),
      ...readdirSync(types)
        .filter((n) => n.endsWith(".ts"))
        .sort()
        .map((n) => resolve(types, n)),
    ];
    const h = createHash("sha1");
    for (const f of fichiers) h.update(readFileSync(f));
    return `code-${h.digest("hex").slice(0, 16)}`;
  } catch {
    return String(Date.now());
  }
})();

/**
 * Les couleurs d'un dessin en pixels sans les pastilles proposées de ses
 * familles (cf. sansPastillesProposees). Sans liste nulle part, la valeur
 * est rendue telle quelle : l'empreinte des fichiers déjà rangés ne bouge pas.
 */
function couleursImageSansPastilles<T>(couleursImage: T): T {
  if (!couleursImage || typeof couleursImage !== "object") return couleursImage;
  const familles = (couleursImage as { familles?: unknown }).familles;
  const sans = sansPastillesProposees(familles);
  return sans === familles ? couleursImage : { ...couleursImage, familles: sans };
}

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
      // Ni les anciennes cases « Le client peut la changer »
      // (`zones_masquees`), ni les groupes de couleurs, ni la case « C'est une
      // ombre » : depuis le 20 octobre 2026, une pièce s'imprime zone par
      // zone, avec les couleurs que porte la configuration, sans rien forcer
      // (cf. couleursDeLaPiece). Ils n'entrent donc plus dans l'empreinte :
      // cocher une ombre au back-office ne refait pas le PDF de toutes les
      // commandes qui portent la pièce, pour une affiche identique. Les
      // pastilles proposées au client n'y entraient déjà pas.
      // Familles de couleurs d'une pièce dessinée en pixels : une famille
      // renommée, rattachée ou recolorée change ce qui s'imprime, donc
      // l'empreinte — et le fichier est refait plutôt que resservi. Toutes
      // sont proposées au client, comme dans le module (cf.
      // avecToutesLesFamillesProposees) ; leurs pastilles proposées, elles,
      // ne changent rien au papier (cf. sansPastillesProposees).
      couleursImage: avecToutesLesFamillesProposees(couleursImageSansPastilles(a.couleursImage)),
      position: a.position,
    });
  // Personnages (SVG de base pré-composé) pour le rendu PDF du nouveau modèle.
  const charMap = new Map<string, any>();
  for (const t of types)
    charMap.set(String(t.id), {
      id: t.id,
      baseSvgUrl: t.baseSvgUrl,
      baseColorZones: t.baseColorZones,
      // Familles de couleurs d'un personnage dessiné en pixels. Elles entrent
      // dans l'empreinte comme le reste : relire les couleurs du dessin au
      // back-office refait le fichier d'impression.
      baseCouleursImage: t.baseCouleursImage,
      bottomPct: t.bottomPct ?? 1,
      // Calage des pièces : sans lui, le PDF poserait les coupes et les
      // vêtements ailleurs que l'aperçu validé par le client.
      slotAdjust: t.slotAdjust ?? null,
    });
  const bgMap = new Map<string, any>();
  for (const b of backgrounds)
    bgMap.set(String(b.id), { id: b.id, url: b.url });
  return {
    assets: assetMap,
    characters: charMap,
    backgrounds: bgMap,
    signature: await signatureDesCreations(),
  };
}

/**
 * Le logo de la boutique, EN NOIR : la signature tant qu'aucune autre n'est
 * envoyée.
 *
 * Noir et non bleu, à la demande de la boutique (7 octobre 2026). C'est le
 * logo bleu de la boutique (logo-memory-line.png, à côté), repeint en noir
 * avec la même transparence : mêmes lettres, mêmes bords adoucis. Le bleu
 * reste celui des courriers, des factures et des cartes cadeaux. Une image
 * envoyée au back-office, elle, s'imprime telle quelle, dans ses couleurs.
 */
const LOGO_PAR_DEFAUT = resolve(fileURLToPath(import.meta.url), "../../marque/logo-memory-line-noir.png");

/**
 * La signature posée en bas à droite de chaque création, d'après « Contenu
 * du site › Signature des créations ». Allumée par défaut, avec le logo de la
 * boutique : c'est ce que demande la boutique (« sur chaque création »), et
 * une signature oubliée ne se voit qu'une fois l'affiche livrée.
 *
 * SUR LE FICHIER D'IMPRESSION SEULEMENT : la boutique ne la veut pas sur
 * l'aperçu du module, ni sur aucun aperçu montré au client (panier, caisse,
 * courriers, historique — voir apercus.ts). Elle se découvre sur le papier.
 *
 * Les nombres sont bornés : une largeur de 80 % recouvrirait l'affiche, une
 * opacité de 0 la rendrait inutile sans que personne ne comprenne pourquoi.
 */
async function signatureDesCreations(): Promise<ResolveData["signature"]> {
  const cles = [
    "signature.visible",
    "signature.image",
    "signature.largeur",
    "signature.marge",
    "signature.opacite",
  ];
  const lignes = await db
    .select({ key: schema.settings.key, value: schema.settings.value })
    .from(schema.settings)
    .where(inArray(schema.settings.key, cles));
  const lire = (cle: string) => {
    const v = lignes.find((l) => l.key === cle)?.value;
    return v === undefined || v === null ? "" : String(v).trim();
  };
  if (["off", "non", "no", "false", "0"].includes(lire("signature.visible").toLowerCase()))
    return null;
  const nombre = (cle: string, defaut: number, min: number, max: number) => {
    const n = Number(lire(cle).replace(",", "."));
    return Number.isFinite(n) && lire(cle) !== "" ? Math.min(max, Math.max(min, n)) : defaut;
  };
  const choisie = lire("signature.image");
  const chemin = (choisie && cheminDansLesAssets(choisie)) || LOGO_PAR_DEFAUT;
  let image: Buffer;
  try {
    image = await readFile(chemin);
  } catch {
    console.warn("[impression] signature introuvable :", chemin);
    return null;
  }
  // 7 % du petit côté, et non plus 12 : la boutique la trouvait « toujours
  // trop grosse », et sa photo de référence (22/10) la montre à 5 ou 6 % de
  // la largeur de l'affiche. Le logo par défaut n'occupe que les trois quarts
  // de son image (marges transparentes) : 7 donne un dessin de 5,2 %. Ce
  // n'est que le défaut : une valeur enregistrée au BO passe devant.
  const largeur = nombre("signature.largeur", 7, 2, 25) / 100;
  const marge = nombre("signature.marge", 3, 0, 10) / 100;
  const opacite = nombre("signature.opacite", 100, 20, 100) / 100;
  return {
    image,
    largeur,
    marge,
    opacite,
    // L'image par son contenu, pas son nom : un logo remplacé sous le même
    // nom refait quand même les fichiers.
    empreinte: `${createHash("sha1").update(image).digest("hex").slice(0, 12)}-${largeur}-${marge}-${opacite}`,
  };
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
  // La signature est imprimée sur l'affiche : la changer (image, taille,
  // marge) ou l'éteindre refait le fichier.
  h.update(data.signature?.empreinte ?? "sans-signature");
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
  chemin: string;
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
 * Vrai quand l'adresse désigne un fichier de data/assets qui n'y est PAS.
 *
 * Deux fonds importés de Shopify pointaient vers une image jamais rapatriée :
 * leur vignette s'affichait cassée dans le module, et le client qui la
 * choisissait composait sur du vide. Une adresse d'un autre site n'est pas
 * vérifiable d'ici : elle n'est pas déclarée manquante.
 */
export function fichierDAssetManquant(url: string): boolean {
  const chemin = cheminDansLesAssets(url);
  return chemin !== null && !existsSync(chemin);
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

  return { url: meilleur!.url, chemin: meilleur!.chemin };
}

/**
 * L'empreinte du CONTENU des visuels déjà lus, par fichier, taille et date.
 *
 * Le back-office demande l'état des fichiers de toute la liste des commandes
 * à chaque visite : relire chaque fois en entier le visuel d'origine de
 * chaque affiche prête à imprimer — souvent plus de dix Mo — ferait attendre
 * la liste pour rien. Un visuel remplacé change de taille ou de date, donc
 * de clé : il est relu, et le fichier d'impression refait.
 */
const contenusLus = new Map<string, string>();

async function empreinteDuContenu(chemin: string): Promise<string> {
  const s = await stat(chemin);
  const cle = `${chemin}|${s.size}|${s.mtimeMs}`;
  let empreinte = contenusLus.get(cle);
  if (!empreinte) {
    empreinte = createHash("sha1").update(await readFile(chemin)).digest("hex");
    if (contenusLus.size > 500) contenusLus.clear();
    contenusLus.set(cle, empreinte);
  }
  return empreinte;
}

/** L'empreinte d'un visuel prêt à imprimer : son contenu, pas seulement son nom. */
async function empreinteVisuel(visuel: Visuel, format: PosterFormat): Promise<string> {
  return createHash("sha1")
    .update(LANCEMENT)
    .update("prete_a_imprimer")
    .update(format)
    .update(visuel.url)
    .update(await empreinteDuContenu(visuel.chemin))
    .digest("hex")
    .slice(0, 20);
}

/* -------------------------------------------------------------------------- */
/*  La file des rendus                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Qui attend un rendu, du plus pressé au moins pressé :
 *
 *   - « demande » : la boutique, devant le back-office, attend CE fichier ;
 *   - « preparation » : un fichier fait d'avance — au paiement, à la vente
 *     du stand, au démarrage de l'API — que personne n'attend encore ;
 *   - « apercu » : une vignette (liste des commandes, courriers, compte
 *     client). Voir apercus.ts.
 */
export type Priorite = "demande" | "preparation" | "apercu";
const RANG: Record<Priorite, number> = { demande: 0, preparation: 1, apercu: 2 };

interface Tache {
  priorite: Priorite;
  /** L'ordre d'arrivée : à priorité égale, premier venu, premier servi. */
  numero: number;
  creee: number;
  /** Le départ du rendu ; null tant qu'il attend son tour. */
  lancee: number | null;
  executer: () => Promise<void>;
}

/**
 * Deux rendus au plus en même temps, dont UN SEUL pour ce qui peut attendre.
 *
 * Un rendu tient plusieurs centaines de Mo (900 Mo mesurés pour le premier A3
 * d'un fond), et le serveur n'en a que quatre Go pour tout faire tourner. Il
 * occupe aussi, tant qu'il dure, l'un des quatre fils que Node partage entre
 * TOUTES ses lectures de fichiers : quatre rendus lancés ensemble, et même un
 * PDF déjà prêt ne pouvait plus être lu (une lecture de 2 Ko attendait 5 s).
 *
 * Une seule file aurait suffi à la mémoire, mais un fichier demandé au
 * back-office y aurait attendu la fin d'un rendu de fond — deux minutes pour
 * le premier A3 d'un fond. La seconde place lui est donc gardée : ce que la
 * boutique attend démarre tout de suite, le reste passe un par un.
 */
const PLACES = 2;
const attente: Tache[] = [];
let enCours = 0;
let enCoursPourPlusTard = 0;
let numeroSuivant = 0;

function avant(a: Tache, b: Tache): boolean {
  return RANG[a.priorite] < RANG[b.priorite] || (a.priorite === b.priorite && a.numero < b.numero);
}

function pomper(): void {
  while (enCours < PLACES && attente.length) {
    const seulementLesDemandes = enCoursPourPlusTard >= 1;
    let choisie = -1;
    attente.forEach((t, i) => {
      if (seulementLesDemandes && t.priorite !== "demande") return;
      if (choisie < 0 || avant(t, attente[choisie]!)) choisie = i;
    });
    if (choisie < 0) return;
    const [tache] = attente.splice(choisie, 1);
    // La priorité au DÉPART décide de la place prise : une tâche remontée en
    // « demande » pendant qu'elle tourne ne libère rien de plus.
    const pourPlusTard = tache!.priorite !== "demande";
    enCours++;
    if (pourPlusTard) enCoursPourPlusTard++;
    tache!.lancee = Date.now();
    void tache!.executer().finally(() => {
      enCours--;
      if (pourPlusTard) enCoursPourPlusTard--;
      pomper();
    });
  }
}

/** Range un travail dans la file ; il partira à son tour (voir pomper). */
function mettreEnFile<T>(
  priorite: Priorite,
  travail: () => Promise<T>,
): { tache: Tache; promesse: Promise<T> } {
  let resoudre!: (v: T) => void;
  let rejeter!: (e: unknown) => void;
  const promesse = new Promise<T>((ok, ko) => {
    resoudre = ok;
    rejeter = ko;
  });
  const tache: Tache = {
    priorite,
    numero: numeroSuivant++,
    creee: Date.now(),
    lancee: null,
    // Jamais d'exception qui s'échappe : la file doit toujours repartir.
    executer: () =>
      Promise.resolve()
        .then(travail)
        .then(resoudre, rejeter),
  };
  attente.push(tache);
  return { tache, promesse };
}

/**
 * Un rendu lourd, à son tour. Pour les vignettes (apercus.ts) : elles passent
 * par la même file que les fichiers d'impression, mais toujours après eux.
 */
export function enFile<T>(priorite: Priorite, travail: () => Promise<T>): Promise<T> {
  const { promesse } = mettreEnFile(priorite, travail);
  pomper();
  return promesse;
}

/** Une tâche qui attend encore passe devant quand quelqu'un l'attend. */
function remonter(tache: Tache, priorite: Priorite): void {
  if (tache.lancee !== null || RANG[priorite] >= RANG[tache.priorite]) return;
  tache.priorite = priorite;
  pomper();
}

/* -------------------------------------------------------------------------- */
/*  Fichiers d'impression                                                     */
/* -------------------------------------------------------------------------- */

/** Où se range le fichier d'une ligne, et comment le fabriquer. */
interface Plan {
  chemin: string;
  fabriquer: () => Promise<Buffer>;
}

/** Les fabrications en cours ou en attente : une seule par fichier. */
const fabrications = new Map<string, { tache: Tache; promesse: Promise<Buffer> }>();

/**
 * Le dernier échec de chaque fichier, gardé jusqu'au prochain essai.
 *
 * C'est lui que le back-office affiche, raison comprise, avec un bouton
 * « Réessayer ». Sans lui, un rendu qui échoue à chaque fois serait relancé à
 * chaque coup d'œil sur la commande — deux minutes de calcul pour rien.
 */
const echecs = new Map<string, { erreur: string; quand: number }>();

/**
 * Le message d'une erreur, dit pour la boutique.
 *
 * Les refus écrits dans ce module (image trop petite, ligne vide…) disent
 * déjà quoi faire. Ceux du moteur parlent de chemins de fichiers : on les
 * traduit, sans perdre le nom de ce qui manque.
 */
export function raisonLisible(e: unknown): string {
  const brut = e instanceof Error ? e.message : String(e);
  const manque = /^Source introuvable: (\S+)/.exec(brut);
  if (manque)
    return (
      `un fichier de l'affiche manque sur le serveur (« ${basename(manque[1]!)} » : ` +
      `un fond, un personnage ou une pièce). Remettez-le au back-office, puis réessayez.`
    );
  if (/ENOSPC/.test(brut))
    return "le disque du serveur est plein : le fichier ne peut pas y être rangé.";
  if (/ENOMEM|out of memory/i.test(brut))
    return "le serveur a manqué de mémoire pendant le calcul. Réessayez dans quelques minutes.";
  return brut;
}

/**
 * Le plan d'impression d'une ligne : où son fichier se range — l'empreinte de
 * ce qui la dessine — et comment le fabriquer.
 *
 * Lève une erreur, dite pour la boutique, quand la ligne ne peut pas
 * s'imprimer (visuel trop petit, image générée disparue, ligne vide…) : ces
 * refus-là ne dépendent pas du calcul, et se savent sans le lancer.
 */
async function planDImpression(
  orderItemId: number,
  config: PosterConfig,
  donnees?: ResolveData,
): Promise<Plan> {
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
  const composee = afficheComposee(config);

  let cle: string;
  let fabriquer: () => Promise<Buffer>;
  if (produit?.genre === "prete_a_imprimer" && !composee) {
    const visuel = await visuelDImpression(produit, format);
    cle = await empreinteVisuel(visuel, format);
    // Lu au moment de fabriquer, pas avant : un plan qui attend son tour
    // dans la file ne garde pas dix Mo d'image en mémoire.
    fabriquer = async () => renderImagePdf(await readFile(visuel.chemin), format);
  } else {
    const [data, aImprimer] = await Promise.all([
      donnees ?? donneesDImpression(),
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
  return { chemin: resolve(DOSSIER_IMPRESSIONS, `${orderItemId}-${cle}.pdf`), fabriquer };
}

/**
 * Lance (ou rejoint) la fabrication d'un fichier. Une fabrication déjà en
 * file pour ce fichier est rejointe — et remonte si l'on est plus pressé
 * qu'elle — au lieu d'en lancer une seconde à côté.
 */
function fabriquerEnFile(
  orderItemId: number,
  plan: Plan,
  priorite: Priorite,
): Promise<Buffer> {
  const deja = fabrications.get(plan.chemin);
  if (deja) {
    remonter(deja.tache, priorite);
    return deja.promesse;
  }
  const { tache, promesse } = mettreEnFile(priorite, async () => {
    try {
      const pdf = await plan.fabriquer();
      if (await ranger(orderItemId, plan.chemin, pdf)) echecs.delete(plan.chemin);
      else
        // Le PDF part quand même à qui l'attend ; mais sans fichier rangé, le
        // back-office ne le verrait jamais « prêt » — il le dit.
        echecs.set(plan.chemin, {
          erreur:
            "le fichier a été calculé mais n'a pas pu être rangé sur le disque du serveur (plein ?). " +
            "Il faudra le recalculer à chaque téléchargement.",
          quand: Date.now(),
        });
      return pdf;
    } catch (e) {
      echecs.set(plan.chemin, { erreur: raisonLisible(e), quand: Date.now() });
      throw e;
    }
  });
  const suivie = promesse.finally(() => fabrications.delete(plan.chemin));
  // Une préparation que personne n'attend ne doit pas faire tomber l'API en
  // échouant : l'échec est gardé ci-dessus, et le back-office le dira.
  suivie.catch(() => {});
  fabrications.set(plan.chemin, { tache, promesse: suivie });
  pomper();
  return suivie;
}

/**
 * Le PDF d'impression d'une ligne : le fichier rangé s'il existe, sinon
 * fabriqué — en tête de file : quelqu'un l'attend —, rangé et rendu.
 */
export async function fichierDImpression(
  orderItemId: number,
  config: PosterConfig,
): Promise<Buffer> {
  const plan = await planDImpression(orderItemId, config);
  try {
    const pdf = await readFile(plan.chemin);
    const maintenant = new Date();
    await utimes(plan.chemin, maintenant, maintenant).catch(() => {});
    return pdf;
  } catch {
    // Pas encore fabriqué.
  }
  return fabriquerEnFile(orderItemId, plan, "demande");
}

/**
 * Lance la fabrication sans l'attendre — au paiement, pour que le fichier soit
 * prêt quand on viendra le chercher. Une erreur est journalisée, pas levée :
 * le back-office la dira, et le téléchargement retentera.
 */
export function preparerFichierDImpression(orderItemId: number, config: PosterConfig): void {
  void (async () => {
    const plan = await planDImpression(orderItemId, config);
    if (await existe(plan.chemin)) return;
    await fabriquerEnFile(orderItemId, plan, "preparation");
  })().catch((e) => console.error(`[impression] ligne ${orderItemId} non préparée :`, e));
}

/** Ce que le back-office affiche d'un fichier d'impression. */
export type EtatImpression =
  | { etat: "pret"; taille: number }
  | {
      etat: "en_preparation";
      /** Vrai quand le calcul tourne ; faux quand il attend son tour. */
      lancee: boolean;
      /** Combien de rendus passeront avant lui. */
      devant: number;
      /** Depuis combien de millisecondes il tourne (ou attend). */
      depuis: number;
    }
  | { etat: "echec"; erreur: string }
  | { etat: "a_preparer" };

function enPreparation(tache: Tache): EtatImpression {
  return {
    etat: "en_preparation",
    lancee: tache.lancee !== null,
    devant: tache.lancee !== null ? 0 : attente.filter((t) => avant(t, tache)).length,
    depuis: Date.now() - (tache.lancee ?? tache.creee),
  };
}

/**
 * Où en est le fichier d'impression d'une ligne — sans jamais attendre le
 * calcul : le back-office pose la question, affiche la réponse, et repose la
 * question tant que le fichier se prépare.
 *
 * `preparer` lance la fabrication d'un fichier absent (la boutique regarde la
 * commande : elle va l'imprimer) ; `reessayer` relance même après un échec.
 * Sans l'un ni l'autre, rien ne se calcule : la liste des commandes montre
 * des dizaines de lignes, et les recalculer toutes à chaque visite occuperait
 * le serveur pour des affiches parties depuis longtemps.
 */
export async function etatDuFichierDImpression(
  orderItemId: number,
  config: PosterConfig,
  options: { preparer?: boolean; reessayer?: boolean; donnees?: ResolveData } = {},
): Promise<EtatImpression> {
  let plan: Plan;
  try {
    plan = await planDImpression(orderItemId, config, options.donnees);
  } catch (e) {
    return { etat: "echec", erreur: raisonLisible(e) };
  }
  const enFabrication = fabrications.get(plan.chemin);
  if (enFabrication) {
    if (options.preparer || options.reessayer) remonter(enFabrication.tache, "demande");
    return enPreparation(enFabrication.tache);
  }
  try {
    const s = await stat(plan.chemin);
    if (s.isFile()) return { etat: "pret", taille: s.size };
  } catch {
    // Pas encore fabriqué.
  }
  if (options.reessayer) echecs.delete(plan.chemin);
  const echec = echecs.get(plan.chemin);
  if (echec) return { etat: "echec", erreur: echec.erreur };
  if (!options.preparer && !options.reessayer) return { etat: "a_preparer" };
  void fabriquerEnFile(orderItemId, plan, "demande");
  const lancee = fabrications.get(plan.chemin);
  return lancee ? enPreparation(lancee.tache) : { etat: "a_preparer" };
}

/**
 * Au démarrage de l'API, refait d'avance les fichiers des commandes à
 * expédier qui ne sont plus à jour.
 *
 * Une mise en ligne qui touche au rendu change l'empreinte de TOUS les
 * fichiers (voir LANCEMENT) : sans cette préparation, chacun se refaisait au
 * premier clic de la boutique — c'est-à-dire, sur le serveur de test, pendant
 * qu'elle attendait. Seules les commandes payées, ni expédiées, ni annulées,
 * ni archivées, des soixante derniers jours : les autres ne s'impriment plus,
 * et se recalculeront le jour d'une réimpression.
 *
 * Une minute après le démarrage, pour laisser l'API répondre d'abord ; un
 * fichier à la fois, après tout ce que la boutique demande.
 */
export function demarrerPreparationDesImpressions(): void {
  const minuterie = setTimeout(() => void preparerLesCommandesAExpedier(), 60_000);
  minuterie.unref?.();
}

async function preparerLesCommandesAExpedier(): Promise<void> {
  try {
    const depuis = new Date(Date.now() - JOURS_DE_GARDE * 24 * 3600 * 1000);
    const lignes = await db
      .select({ id: schema.orderItems.id, config: schema.orderItems.config })
      .from(schema.orderItems)
      .innerJoin(schema.orders, eq(schema.orderItems.orderId, schema.orders.id))
      .where(
        and(
          eq(schema.orders.status, "paid"),
          isNull(schema.orders.fulfilledAt),
          isNull(schema.orders.archivedAt),
          gte(schema.orders.createdAt, depuis),
        ),
      )
      .orderBy(desc(schema.orders.createdAt), asc(schema.orderItems.id))
      .limit(300);
    if (!lignes.length) return;
    const donnees = await donneesDImpression();
    let lancees = 0;
    for (const ligne of lignes) {
      if (!ligne.config) continue;
      try {
        const plan = await planDImpression(ligne.id, ligne.config as PosterConfig, donnees);
        if (fabrications.has(plan.chemin) || (await existe(plan.chemin))) continue;
        void fabriquerEnFile(ligne.id, plan, "preparation");
        lancees++;
      } catch (e) {
        // Un refus (visuel trop petit, fichier manquant…) : le back-office le
        // dira quand on ouvrira la commande.
        console.warn(`[impression] ligne ${ligne.id} : ${raisonLisible(e)}`);
      }
    }
    if (lancees)
      console.log(
        `[impression] ${lancees} fichier(s) d'impression de commandes à expédier préparé(s) d'avance`,
      );
  } catch (e) {
    console.error("[impression] préparation d'avance interrompue :", e);
  }
}

/** Un fichier existe-t-il déjà ? */
async function existe(chemin: string): Promise<boolean> {
  try {
    return (await stat(chemin)).isFile();
  } catch {
    return false;
  }
}

/** Range le PDF ; faux s'il n'a pas pu l'être. */
async function ranger(orderItemId: number, chemin: string, pdf: Buffer): Promise<boolean> {
  let range = true;
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
    range = await existe(chemin);
  }
  void menageDuCache();
  return range;
}

/**
 * Efface ce qui n'a pas servi depuis {@link JOURS_DE_GARDE} jours : fichiers
 * d'impression, fonds rasterisés (pdf.ts) et images recolorées des dessins en
 * pixels (couleurs-image-fichier.ts). Une fois par jour au plus, à l'occasion
 * d'un rangement — pas de minuterie à entretenir.
 */
let dernierMenage = 0;
async function menageDuCache(): Promise<void> {
  const maintenant = Date.now();
  if (maintenant - dernierMenage < 24 * 3600 * 1000) return;
  dernierMenage = maintenant;
  const limite = maintenant - JOURS_DE_GARDE * 24 * 3600 * 1000;
  for (const dossier of [
    DOSSIER_IMPRESSIONS,
    resolve(DOSSIER_CACHE, "fonds"),
    // Une couleur essayée puis abandonnée par un client laisse une image
    // derrière elle : sans ménage, le disque se remplirait de pelages bleus
    // que plus personne ne regardera.
    resolve(DOSSIER_CACHE, "images-couleurs"),
  ]) {
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
