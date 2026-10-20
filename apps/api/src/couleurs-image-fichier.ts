/**
 * Les pixels des dessins en pixels : les lire, les ranger en familles de
 * couleurs, et les recolorer.
 *
 * La règle de recoloration, elle, ne vit PAS ici : elle est dans
 * @memoryline/types (couleurs-image.ts), partagée mot pour mot par la boutique
 * et par le fichier d'impression. Ici, on ouvre le fichier, on décode l'image,
 * on la réencode, et on range le résultat.
 *
 * POURQUOI LE SERVEUR CALCULE CE QUE LA BOUTIQUE AFFICHE. Le navigateur
 * saurait recolorer ces pixels lui-même, sur un canevas. Mais l'affiche part
 * ensuite à l'imprimante, calculée ici : deux calculs, deux bibliothèques
 * d'images, deux arrondis — et un jour, un pelage imprimé qui ne serait plus
 * celui montré au client. Le serveur calcule donc UNE image, la range, et la
 * sert aux deux : la boutique la charge par son adresse, le moteur
 * d'impression lit le même fichier. Ils ne peuvent pas diverger, puisque ce
 * sont les mêmes octets.
 *
 * Les images recolorées se rangent dans data/assets/cache/images-couleurs :
 * tout s'y recalcule, la sauvegarde l'ignore, et le ménage du cache
 * (fichiers-impression.ts) les efface au bout de deux mois sans usage.
 *
 * ET LE DOSSIER NE DÉPASSE JAMAIS SON PLAFOND (voir {@link OCTETS_MAX}) : les
 * couleurs sont au choix du client, il y en a seize millions, et chacune
 * laisse une image de quelques centaines de kilo-octets derrière elle.
 */
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  baliseImageDuDessin,
  couleursDesFamilles,
  cleFamille,
  dessinAvecImage,
  famillesDuDessin,
  hexVersRgb,
  planDeRecoloration,
  recolorerPixels,
  rgbVersHex,
  sansPastillesProposees,
  teintesDeLaFamille,
  versTsl,
  FAMILLES_MAX,
  PART_FAMILLE_MIN,
  type CouleursImage,
  type FamilleCouleur,
  type MotifSansCouleur,
} from "@memoryline/types";

const ASSETS_DIR = resolve(fileURLToPath(import.meta.url), "../../../../data/assets");
const DOSSIER_IMAGES = resolve(ASSETS_DIR, "cache", "images-couleurs");

/* -------------------------------------------------------------------------- */
/*  Trouver l'image dans le dessin                                             */
/* -------------------------------------------------------------------------- */

/**
 * L'image que le dessin montre, décodée. Le REPÉRAGE de la balise vit dans
 * @memoryline/types : la boutique la cherche exactement de la même façon.
 */
export function imageDuDessin(svg: string): Buffer | null {
  const balise = baliseImageDuDessin(svg);
  if (!balise) return null;
  return Buffer.from(balise.href.slice(balise.href.indexOf(",") + 1), "base64");
}

/* -------------------------------------------------------------------------- */
/*  Détection des familles                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Largeur du rendu d'analyse.
 *
 * On ne range pas les couleurs d'après le fichier embarqué, mais d'après le
 * dessin TEL QU'IL S'AFFICHE : c'est la seule façon de savoir ce qui est
 * visible. Le fond du fichier embarqué, lui, est un rectangle uni caché par le
 * masque — l'analyser inventerait une famille « blanc » occupant la moitié du
 * dessin, et la boutique proposerait au client de recolorer du vide.
 *
 * 400 pixels de large suffisent : on cherche des familles de teintes, pas du
 * détail, et cela tient l'analyse sous la demi-seconde.
 */
const LARGEUR_ANALYSE = 400;

/**
 * Budget de la SECONDE lecture, en pixels rendus.
 *
 * 400 pixels de large suffisent à un pelage, mais pas à un DESSIN AU TRAIT :
 * réduit à 400, un trait de 6 pixels dans une image de 3 000 n'en pèse plus
 * que 0,8 — pas un seul pixel n'y reste pleinement opaque, et la lecture
 * concluait « image entièrement transparente » d'un fichier franchement noir.
 * Quand la première passe ne trouve rien, on relit donc le dessin à SA taille.
 *
 * Le budget se compte en pixels et non en largeur, pour que le rendu reste
 * borné quelle que soit la forme du dessin : une affiche très haute serait
 * énorme à 2 000 pixels de large. Quatre millions de pixels, c'est seize
 * méga-octets de pixels bruts — et, mesuré, 2 000 pixels de large pour un
 * dessin carré, de quoi rattraper un trait de 2 pixels dans un export de
 * 3 000. Le surcoût (environ un tiers de seconde) n'est payé que dans la
 * branche qui, sans lui, REFUSERAIT le dessin.
 */
const PIXELS_ANALYSE_FINE = 4_000_000;

/** Largeur de la carte des teintes montrée au back-office. */
const LARGEUR_CARTE = 130;

/** Pas de quantification du cube des couleurs pour l'histogramme de départ. */
const PAS_HISTOGRAMME = 16;

/**
 * Écart minimal entre deux teintes de départ (distance RGB au carré).
 *
 * En dessous, les deux sont la même teinte vue à deux endroits : les séparer
 * donnerait deux pastilles pour un seul pelage.
 */
const ECART_TEINTES = 70 * 70;

/** Teintes brutes examinées avant regroupement en familles. */
const TEINTES_MAX = 8;

/**
 * Écart de teinte (en degrés) en dessous duquel deux couleurs franches sont LA
 * MÊME couleur, vue à l'ombre et à la lumière.
 *
 * Le fauve clair et le fauve sombre d'un berger allemand sont le même pelage :
 * les proposer séparément donnerait deux pastilles, et n'en changer qu'une
 * ferait un chien fauve taché.
 */
const ECART_TEINTE_FAMILLE = 25;

/**
 * À partir de quand une couleur est assez FRANCHE pour que sa teinte veuille
 * dire quelque chose : écart entre canaux, et clarté loin des extrêmes.
 *
 * Ces seuils sont nettement plus exigeants que ceux du calcul des nuances
 * (couleurVive), et ils doivent l'être : le poitrail blanc d'un saint-bernard
 * (#F1E8DB) tire assez sur le chaud pour afficher la teinte du pelage. Réuni à
 * lui, il changerait de couleur avec la robe du chien — un saint-bernard bleu
 * à poitrail bleu. Un blanc cassé, un gris, un presque-noir font donc toujours
 * famille à part ; la boutique les réunit d'un geste si elle le veut.
 */
const CHROMA_FAMILLE = 0.18;
const CLARTE_FAMILLE_MIN = 0.12;
const CLARTE_FAMILLE_MAX = 0.88;

/** Une teinte du dessin : sa couleur moyenne et sa part des pixels visibles. */
interface Teinte {
  rgb: [number, number, number];
  part: number;
}

/** Le rendu du dessin tel qu'il s'affiche, en pixels bruts. */
async function rendu(
  svg: string,
  largeur: number,
): Promise<{ data: Buffer; width: number; height: number; channels: number }> {
  const { data, info } = await sharp(Buffer.from(svg), { density: 72, unlimited: true })
    .resize({ width: largeur, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/**
 * Le même dessin relu EN GRAND, ou `null` quand il n'y a rien à y gagner.
 *
 * Sert uniquement de session de rattrapage : on n'y vient qu'après une
 * première lecture restée vide (cf. {@link PIXELS_ANALYSE_FINE}). Un dessin
 * qui a déjà rendu des teintes ne repasse jamais par ici — les sept animaux
 * photographiés et les dessins qui marchent aujourd'hui gardent donc, au pixel
 * près, les familles qu'ils donnent actuellement.
 */
async function renduFin(
  svg: string,
  premier: { width: number; height: number },
): Promise<Awaited<ReturnType<typeof rendu>> | null> {
  // Moins large que demandé : le fichier est plus petit que 400 pixels, il a
  // donc DÉJÀ été lu à sa taille. Le relire ne montrerait pas un pixel de plus.
  if (premier.width < LARGEUR_ANALYSE) return null;
  const largeur = Math.round(
    Math.sqrt((PIXELS_ANALYSE_FINE * premier.width) / premier.height),
  );
  if (largeur <= premier.width) return null;
  try {
    return await rendu(svg, largeur);
  } catch {
    // Le grand rendu échoue là où le petit passait (mémoire) : on s'en tient
    // à ce que la première lecture a dit.
    return null;
  }
}

/**
 * Les teintes du dessin, de la plus étendue à la plus petite.
 *
 * On part d'un histogramme grossier du cube des couleurs, on en tire des
 * teintes de départ bien écartées, puis on recentre chacune sur les pixels
 * qu'elle attire (trois tours suffisent à se stabiliser).
 *
 * Seuls les pixels PLEINEMENT opaques comptent. Les bords lissés d'un
 * détourage sont à moitié transparents et mélangent le dessin au vide : les
 * prendre créerait des teintes qui n'existent nulle part dans l'image, et,
 * sur un dessin cerné de noir, une famille « noir » couvrant tout le contour.
 */
function teintesDuRendu(
  data: Buffer,
  canaux: number,
): { teintes: Teinte[]; visibles: number } {
  const bacs = new Map<number, { n: number; r: number; g: number; b: number }>();
  let visibles = 0;
  for (let i = 0; i < data.length; i += canaux) {
    if (data[i + 3]! < 250) continue;
    visibles++;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const cle =
      ((r / PAS_HISTOGRAMME) | 0) * 1024 +
      ((g / PAS_HISTOGRAMME) | 0) * 32 +
      ((b / PAS_HISTOGRAMME) | 0);
    const e = bacs.get(cle);
    if (e) {
      e.n++;
      e.r += r;
      e.g += g;
      e.b += b;
    } else bacs.set(cle, { n: 1, r, g, b });
  }
  if (visibles === 0) return { teintes: [], visibles: 0 };

  const tries = [...bacs.values()].sort((a, b) => b.n - a.n);
  const distance2 = (
    a: [number, number, number],
    b: [number, number, number],
  ): number => {
    const dr = a[0] - b[0];
    const dg = a[1] - b[1];
    const db = a[2] - b[2];
    return dr * dr + dg * dg + db * db;
  };

  let centres: [number, number, number][] = [];
  for (const e of tries) {
    const c: [number, number, number] = [e.r / e.n, e.g / e.n, e.b / e.n];
    if (centres.some((x) => distance2(x, c) < ECART_TEINTES)) continue;
    centres.push(c);
    if (centres.length >= TEINTES_MAX) break;
  }

  let parts: number[] = [];
  for (let tour = 0; tour < 3; tour++) {
    const cumul = centres.map(() => ({ n: 0, r: 0, g: 0, b: 0 }));
    for (const e of tries) {
      const c: [number, number, number] = [e.r / e.n, e.g / e.n, e.b / e.n];
      let proche = 0;
      let d = Infinity;
      centres.forEach((x, i) => {
        const v = distance2(x, c);
        if (v < d) {
          d = v;
          proche = i;
        }
      });
      const a = cumul[proche]!;
      a.n += e.n;
      a.r += e.r;
      a.g += e.g;
      a.b += e.b;
    }
    centres = cumul.map((a, i) =>
      a.n ? ([a.r / a.n, a.g / a.n, a.b / a.n] as [number, number, number]) : centres[i]!,
    );
    parts = cumul.map((a) => a.n / visibles);
  }

  return {
    teintes: centres
      .map((rgb, i) => ({
        rgb: [Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2])] as [
          number,
          number,
          number,
        ],
        part: parts[i] ?? 0,
      }))
      .filter((t) => t.part >= PART_FAMILLE_MIN)
      .sort((a, b) => b.part - a.part),
    visibles,
  };
}

/**
 * La teinte d'une couleur, en degrés — ou `null` quand cette couleur est trop
 * terne, trop claire ou trop sombre pour que sa teinte veuille dire quoi que
 * ce soit (cf. {@link CHROMA_FAMILLE}).
 */
function teinteEnDegres(rgb: [number, number, number]): number | null {
  const chroma = (Math.max(...rgb) - Math.min(...rgb)) / 255;
  if (chroma < CHROMA_FAMILLE) return null;
  const tsl: [number, number, number] = [0, 0, 0];
  versTsl(rgb[0], rgb[1], rgb[2], tsl);
  if (tsl[2] < CLARTE_FAMILLE_MIN || tsl[2] > CLARTE_FAMILLE_MAX) return null;
  return tsl[0];
}

/**
 * Les teintes réunies en familles : deux couleurs vives de même teinte sont le
 * même pelage à l'ombre et à la lumière (cf. {@link ECART_TEINTE_FAMILLE}).
 *
 * La référence d'une famille est sa teinte la plus ÉTENDUE : c'est la couleur
 * que le client choisit, et celle dont toutes les autres gardent l'écart.
 * La boutique peut ensuite réunir ou séparer ce qu'elle veut au back-office —
 * ce regroupement n'est qu'un point de départ raisonnable.
 */
function famillesDesTeintes(teintes: Teinte[]): FamilleCouleur[] {
  const familles: { teintes: Teinte[]; degres: number | null }[] = [];
  for (const t of teintes) {
    const degres = teinteEnDegres(t.rgb);
    const proche =
      degres === null
        ? undefined
        : familles.find(
            (f) =>
              f.degres !== null &&
              Math.abs(((degres - f.degres + 540) % 360) - 180) <= ECART_TEINTE_FAMILLE,
          );
    if (proche) proche.teintes.push(t);
    else familles.push({ teintes: [t], degres });
  }
  return familles
    .map((f) => ({
      teintes: [...f.teintes].sort((a, b) => b.part - a.part),
      part: f.teintes.reduce((s, t) => s + t.part, 0),
    }))
    .sort((a, b) => b.part - a.part)
    .slice(0, FAMILLES_MAX)
    .map((f, i) => {
      const [reference, ...autres] = f.teintes as [Teinte, ...Teinte[]];
      return {
        cle: cleFamille(i),
        reference: rgbVersHex(...reference.rgb),
        ...(autres.length
          ? { teintes: autres.map((t) => rgbVersHex(...t.rgb)) }
          : {}),
        part: f.part,
      };
    });
}

/**
 * La carte des teintes : une vignette minuscule où le niveau de gris de chaque
 * pixel dit à quelle teinte il appartient, et la transparence ce qui est hors
 * dessin. Le back-office s'en sert pour montrer OÙ est une famille.
 *
 * Les niveaux sont largement espacés : le navigateur relit la vignette sur un
 * canevas, et un arrondi de quelques unités ne doit pas faire changer une
 * teinte de famille.
 */
const NIVEAU_PAS = 25;
const NIVEAU_BASE = 20;

/** Le niveau de gris qui code la teinte de rang `i` dans la carte. */
export function niveauDeTeinte(i: number): number {
  return NIVEAU_BASE + i * NIVEAU_PAS;
}

async function carteDesTeintes(
  data: Buffer,
  width: number,
  height: number,
  canaux: number,
  teintes: [number, number, number][],
): Promise<string> {
  const W = Math.max(1, Math.min(LARGEUR_CARTE, width));
  const H = Math.max(1, Math.round((height * W) / width));
  // Deux canaux : le niveau de gris (la teinte) et l'opacité (le dessin).
  const carte = Buffer.alloc(W * H * 2);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(height - 1, Math.floor((y * height) / H));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(width - 1, Math.floor((x * width) / W));
      const i = (sy * width + sx) * canaux;
      const o = (y * W + x) * 2;
      if (data[i + 3]! < 250) continue; // hors dessin : transparent
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      let proche = 0;
      let d = Infinity;
      teintes.forEach((t, k) => {
        const dr = r - t[0];
        const dg = g - t[1];
        const db = b - t[2];
        const v = dr * dr + dg * dg + db * db;
        if (v < d) {
          d = v;
          proche = k;
        }
      });
      carte[o] = niveauDeTeinte(proche);
      carte[o + 1] = 255;
    }
  }
  const png = await sharp(carte, { raw: { width: W, height: H, channels: 2 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

/** Ce qu'a donné la lecture d'un dessin en pixels, et pourquoi si rien. */
export interface LectureCouleursImage {
  couleurs: CouleursImage | null;
  /** Renseigné seulement quand `couleurs` est null. */
  motif?: MotifSansCouleur;
}

/**
 * Lit les couleurs d'un dessin en pixels EN DISANT POURQUOI quand elle
 * n'obtient rien.
 *
 * Quatre échecs très différents se ressemblaient ici : un fichier qui n'est
 * pas une image, un rendu qui échoue, un dessin AU TRAIT dont la lecture ne
 * sait rien tirer, et une image réellement vide. Tous rendaient `null`, et le
 * back-office, faute de mieux, accusait le fichier d'être illisible. Chacun
 * porte maintenant son motif, et le back-office en fait une phrase juste.
 */
export async function lireCouleursImage(svg: string): Promise<LectureCouleursImage> {
  if (!baliseImageDuDessin(svg)) return { couleurs: null, motif: "format-non-traite" };
  let rendus: Awaited<ReturnType<typeof rendu>>;
  try {
    rendus = await rendu(svg, LARGEUR_ANALYSE);
  } catch {
    // Le dessin porte bien une image, mais elle n'a pas pu être décodée :
    // fichier tronqué, encodage exotique, mémoire insuffisante.
    return { couleurs: null, motif: "echec-lecture" };
  }
  let { teintes } = teintesDuRendu(rendus.data, rendus.channels);
  if (teintes.length === 0) {
    // Rendu sans erreur, et pas un seul pixel visible à 400 pixels de large.
    // ON N'EN CONCLUT ENCORE RIEN : un DESSIN AU TRAIT est franchement opaque
    // et disparaît quand même à cette taille-là (cf. PIXELS_ANALYSE_FINE).
    // Cette branche ne recevait autrefois que les sept animaux photographiés,
    // qui sont des aplats ; elle reçoit maintenant tous les fichiers téléversés,
    // cadres et traits d'encre compris. On relit donc le dessin en grand
    // AVANT de décider quoi que ce soit — le plus souvent, il n'y avait aucun
    // problème à annoncer.
    const fin = await renduFin(svg, rendus);
    const teintesFines = fin ? teintesDuRendu(fin.data, fin.channels).teintes : [];
    if (fin && teintesFines.length > 0) {
      rendus = fin;
      teintes = teintesFines;
    } else {
      // Vraiment rien, même à sa taille. TROIS CAUSES QUI N'ONT RIEN À VOIR
      // se ressemblent ici : une image réellement vide, une image ABÎMÉE dont
      // le rasteriseur n'a rien tiré sans se plaindre, et un dessin au trait
      // bon mais sans le moindre aplat. Un PNG coupé garde un en-tête valide —
      // `metadata()` y croit, et le rendu rend du vide en silence : mesuré, un
      // fichier tronqué s'annonçait « entièrement transparent », ce qui est
      // faux et envoie refaire l'export au lieu de renvoyer le fichier.
      //
      // Seul un VRAI décodage tranche, et il dit les deux choses à la fois :
      // qu'il échoue désigne le fichier abîmé, et son canal alpha dit si le
      // fichier est VIDE (maximum 0) ou opaque (255, ou pas de canal alpha du
      // tout). Sans ce test, un dessin au trait parfaitement bon s'entendait
      // dire qu'il était « entièrement transparent » : c'était faux, et c'est
      // le seul reproche que le fichier ne méritait pas.
      //
      // Il coûte quelques centièmes de seconde et n'est payé que dans ce
      // cas-là, qui est rare.
      const octets = imageDuDessin(svg);
      let alphaMax: number | undefined;
      if (octets)
        try {
          alphaMax = (await sharp(octets).stats()).channels[3]?.max;
        } catch {
          return { couleurs: null, motif: "echec-lecture" };
        }
      return { couleurs: null, motif: alphaMax === 0 ? "image-vide" : "traits-trop-fins" };
    }
  }
  const familles = famillesDesTeintes(teintes);
  // La carte doit ranger les pixels EXACTEMENT comme la recoloration le fera :
  // mêmes teintes, dans le même ordre que `planDeRecoloration` les met à plat.
  const carteTeintes = familles.flatMap((f) => teintesDeLaFamille(f));
  let carte: string | undefined;
  try {
    carte = await carteDesTeintes(
      rendus.data,
      rendus.width,
      rendus.height,
      rendus.channels,
      carteTeintes.map((hex) => hexVersRgb(hex) ?? [0, 0, 0]),
    );
  } catch {
    // Vignette impossible : les familles restent utilisables sans elle.
  }
  return { couleurs: { familles, ...(carte ? { carte, carteTeintes } : {}) } };
}

/* -------------------------------------------------------------------------- */
/*  Recoloration                                                               */
/* -------------------------------------------------------------------------- */

/** Le chemin d'un dessin dans data/assets, ou null s'il en sort. */
export function cheminDuDessin(url: string): string | null {
  const nom = basename((url.split("?")[0] ?? "").trim());
  if (!nom) return null;
  const chemin = resolve(ASSETS_DIR, nom);
  // Une adresse bricolée ne doit pas pouvoir faire lire un fichier quelconque.
  return chemin.startsWith(resolve(ASSETS_DIR)) ? chemin : null;
}

/**
 * L'empreinte d'une image recolorée : le dessin (son nom, sa taille et sa date),
 * ses familles et les couleurs voulues. Un dessin remplacé sur le disque, une
 * famille rattachée à une autre, une couleur changée : l'empreinte change, et
 * l'image est refaite au lieu d'être resservie. Les pastilles proposées au
 * client pour une famille d'accessoire n'y entrent pas : elles ne changent
 * pas un pixel de l'image (cf. sansPastillesProposees).
 */
async function empreinte(
  chemin: string,
  couleursImage: unknown,
  voulues: Record<string, string>,
): Promise<string> {
  const s = await stat(chemin);
  return createHash("sha1")
    .update(basename(chemin))
    .update(String(s.size))
    .update(String(s.mtimeMs))
    .update(JSON.stringify(sansPastillesProposees(famillesDuDessin(couleursImage))))
    .update(JSON.stringify(voulues))
    .digest("hex")
    .slice(0, 24);
}

/* -------------------------------------------------------------------------- */
/*  Plafond du dossier                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Ce que le dossier des images recolorées peut peser, au total.
 *
 * LE CLIENT CHOISIT SA COULEUR LIBREMENT, et il y en a seize millions : on ne
 * peut donc pas prévoir combien d'images ce dossier contiendra un jour. Chaque
 * couleur jamais vue en range une de trois à cinq cents kilo-octets — un
 * script qui appellerait l'adresse en boucle remplirait le disque du serveur
 * en quelques heures, et sur le VPS c'est aussi le disque de la base de
 * données. Le ménage de fichiers-impression.ts ne passe qu'une fois par jour
 * et garde deux mois : il ne freine rien à cette vitesse-là.
 *
 * Deux cents mégaoctets, c'est environ cinq cents couleurs déjà vues gardées
 * sous la main — largement de quoi servir instantanément tout ce qu'une
 * journée de boutique et de stand essaie vraiment. Au-delà, les plus
 * anciennement servies s'effacent : les perdre ne coûte qu'un recalcul.
 */
const OCTETS_MAX = 200 * 1024 * 1024;

/**
 * Où redescendre quand le plafond est atteint : on efface un peu plus que le
 * strict nécessaire, sinon chaque image suivante relancerait un ménage.
 */
const OCTETS_APRES_MENAGE = Math.round(OCTETS_MAX * 0.8);

/**
 * Poids du dossier, tenu en mémoire — `null` tant qu'on ne l'a pas mesuré.
 * Le compter à chaque rangement éviterait de parcourir le dossier pour rien :
 * on ne le relit qu'en arrivant au plafond.
 */
let octetsRanges: number | null = null;

/**
 * Ce qui s'est rangé PENDANT le ménage, et `null` quand aucun ne tourne — ce
 * qui en fait aussi le drapeau « ménage en cours », pour que dix rangements
 * simultanés n'en déclenchent qu'un.
 *
 * Le ménage mesure le dossier en le parcourant, fichier par fichier : sur le
 * disque, cela prend du temps, et les images rangées entretemps lui échappent.
 * Sans ce compteur-là, la mesure finale les effacerait de la comptabilité, le
 * total retenu passerait sous la vérité à chaque ménage, et le dossier
 * s'installerait durablement au-dessus de son plafond. Mesuré : 212 Mo au lieu
 * de 200.
 */
let ecritsPendantLeMenage: number | null = null;

/**
 * Efface les images les moins récemment SERVIES jusqu'à repasser sous le
 * plafond. La date de chaque fichier est celle de son dernier usage —
 * {@link imageRecoloree} la rafraîchit à chaque lecture —, c'est donc bien la
 * couleur dont plus personne ne veut qui s'en va la première.
 */
async function faireDeLaPlace(): Promise<void> {
  // Posé AVANT la première attente : à partir d'ici, les rangements se
  // comptent à part (cf. ecritsPendantLeMenage).
  ecritsPendantLeMenage = 0;
  try {
    const fichiers: { chemin: string; octets: number; vuLe: number }[] = [];
    let total = 0;
    for (const nom of await readdir(DOSSIER_IMAGES)) {
      const chemin = resolve(DOSSIER_IMAGES, nom);
      try {
        const s = await stat(chemin);
        if (!s.isFile()) continue;
        fichiers.push({ chemin, octets: s.size, vuLe: s.mtimeMs });
        total += s.size;
      } catch {
        // disparu entre-temps : rien à compter
      }
    }
    if (total > OCTETS_MAX) {
      fichiers.sort((a, b) => a.vuLe - b.vuLe);
      for (const f of fichiers) {
        if (total <= OCTETS_APRES_MENAGE) break;
        try {
          await rm(f.chemin, { force: true });
          total -= f.octets;
        } catch {
          // occupé ou déjà parti : on passe au suivant
        }
      }
      console.warn(
        `[couleurs image] plafond atteint : dossier ramené à ${Math.round(total / 1e6)} Mo`,
      );
    }
    octetsRanges = total + ecritsPendantLeMenage;
  } catch {
    // Dossier illisible : on remesurera au prochain rangement.
    octetsRanges = null;
  } finally {
    ecritsPendantLeMenage = null;
  }
}

/**
 * Compte une image de plus et déclenche le ménage s'il le faut. Le ménage ne
 * bloque PAS la réponse en cours : l'image est déjà calculée, la faire
 * attendre un parcours de dossier ne servirait personne.
 */
function surveillerLePoids(octets: number): void {
  if (ecritsPendantLeMenage !== null) {
    // Un ménage parcourt le dossier : il ne verra pas cette image-ci, c'est
    // lui qui l'ajoutera au total en terminant.
    ecritsPendantLeMenage += octets;
    return;
  }
  if (octetsRanges !== null) {
    octetsRanges += octets;
    if (octetsRanges <= OCTETS_MAX) return;
  }
  // Le ménage ne remonte jamais d'erreur (tout est rattrapé à l'intérieur),
  // mais personne n'attend cette promesse : un rejet resté seul arrêterait
  // net le serveur. On la referme donc ici.
  void faireDeLaPlace().catch((e) => {
    ecritsPendantLeMenage = null;
    console.warn("[couleurs image] ménage du plafond impossible :", String(e));
  });
}

/* -------------------------------------------------------------------------- */

/** Les images en cours de calcul : deux demandes identiques n'en font qu'une. */
const enCours = new Map<string, Promise<Buffer>>();

/**
 * L'image d'un dessin, recolorée selon les couleurs choisies — le fichier
 * rangé s'il existe, sinon calculé, rangé, rendu.
 *
 * `avantCalcul` est le feu vert demandé JUSTE AVANT de lancer un vrai calcul —
 * et seulement alors : une image déjà rangée, ou déjà en train d'être calculée
 * pour quelqu'un d'autre, ne coûte rien et ne le consulte pas. Refusé, rien
 * n'est calculé et la réponse est `"plafond"`.
 *
 * C'est ainsi que la route publique tient sa limite de débit, et c'est pour
 * cela que le feu vert se demande ici plutôt qu'avant l'appel : entre la
 * question et le lancement du calcul il n'y a aucune attente, donc mille
 * demandes arrivées en même temps ne peuvent pas passer ensemble avant que le
 * compteur ait bougé.
 *
 * Rend `null` quand il n'y a rien à recolorer : pas d'image dans le dessin,
 * pas de famille, ou aucune couleur qui change. L'appelant sert alors le
 * dessin d'origine, sans rien calculer ni ranger.
 */
export async function imageRecoloree(
  url: string,
  couleursImage: unknown,
  couleurs: Record<string, string> | undefined | null,
  options?: { avantCalcul?: () => boolean },
): Promise<Buffer | "plafond" | null> {
  const chemin = cheminDuDessin(url);
  if (!chemin) return null;
  const plan = planDeRecoloration(couleursImage, couleurs);
  if (!plan) return null;

  const voulues = couleursDesFamilles(couleurs, couleursImage);
  let cle: string;
  try {
    cle = await empreinte(chemin, couleursImage, voulues);
  } catch {
    return null; // dessin introuvable
  }
  const range = resolve(DOSSIER_IMAGES, `${cle}.png`);
  try {
    const png = await readFile(range);
    // La date de dernier usage : c'est elle qui protège du ménage du cache, et
    // c'est elle qui décide de l'ordre d'effacement sous le plafond.
    const maintenant = new Date();
    await utimes(range, maintenant, maintenant).catch(() => {});
    return png;
  } catch {
    // Pas encore calculée.
  }

  let travail = enCours.get(range);
  if (!travail) {
    // Le seul endroit qui coûte vraiment quelque chose : c'est ici, et nulle
    // part ailleurs, qu'on demande le feu vert.
    if (options?.avantCalcul && !options.avantCalcul()) return "plafond";
    travail = (async () => {
      const svg = (await readFile(chemin)).toString("utf8");
      const image = imageDuDessin(svg);
      if (!image) throw new Error(`${basename(chemin)} : aucune image à recolorer`);
      // Huit bits par canal, en sRGB : une image enregistrée en seize bits
      // (ou en CMJN) rendrait des octets que la recoloration lirait de
      // travers, un pixel sur deux.
      const { data, info } = await sharp(image)
        .toColourspace("srgb")
        .raw({ depth: "uchar" })
        .toBuffer({ resolveWithObject: true });
      recolorerPixels(data, info.channels, plan);
      const png = await sharp(data, {
        raw: { width: info.width, height: info.height, channels: info.channels },
      })
        .png({ compressionLevel: 9 })
        .toBuffer();
      await ranger(range, png);
      return png;
    })().finally(() => enCours.delete(range));
    enCours.set(range, travail);
  }
  return travail;
}

async function ranger(chemin: string, png: Buffer): Promise<void> {
  try {
    await mkdir(DOSSIER_IMAGES, { recursive: true });
    // Écrit à côté puis renommé : une lecture pendant l'écriture recevrait
    // une image tronquée.
    const provisoire = `${chemin}.${process.pid}.tmp`;
    await writeFile(provisoire, png);
    await rename(provisoire, chemin);
    // Rangée pour de bon : elle compte dans le plafond du dossier.
    surveillerLePoids(png.byteLength);
  } catch (e) {
    // Un disque plein ne doit pas empêcher d'afficher : l'image est là, en
    // mémoire, simplement pas rangée pour la prochaine fois.
    console.warn("[couleurs image] image non rangée :", String(e));
  }
}

/**
 * Le dessin recoloré, prêt à être rasterisé côté serveur (aperçus, fichier
 * d'impression) : le MÊME fichier que la boutique affiche, glissé dans le SVG.
 *
 * Rend le dessin inchangé quand il n'y a rien à recolorer.
 */
export async function dessinRecolore(
  svg: string,
  url: string,
  couleursImage: unknown,
  couleurs: Record<string, string> | undefined | null,
): Promise<string> {
  if (!baliseImageDuDessin(svg)) return svg;
  // Aucun feu vert à demander : la limite de débit garde la route PUBLIQUE,
  // elle n'a rien à faire ici. Un fichier d'impression ou un aperçu de
  // commande doit toujours pouvoir se calculer, quel que soit le trafic.
  const png = await imageRecoloree(url, couleursImage, couleurs);
  if (png === "plafond")
    throw new Error("recoloration refusée alors qu'aucune limite n'était demandée");
  // L'image voyage ici en « data: », et non par son adresse : le moteur
  // d'impression rasterise le SVG sans réseau. Ce sont les mêmes octets que
  // ceux servis à la boutique — le même fichier du cache.
  return png ? dessinAvecImage(svg, `data:image/png;base64,${png.toString("base64")}`) : svg;
}
