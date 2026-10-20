/**
 * Couleurs d'un dessin en PIXELS (personnage ou pièce).
 *
 * Sept des animaux téléversés au back-office ne sont pas des dessins
 * vectoriels : ce sont des photos ou des illustrations enregistrées en SVG —
 * une image en pixels posée dans une balise `<image>`, sans le moindre tracé.
 * Les groupes de couleurs (couleurs-groupes.ts) n'ont aucune prise dessus :
 * il n'y a pas de zone `.stN` à recolorer, et le client ne pouvait rien
 * changer à la robe d'un berger allemand.
 *
 * UNE FAMILLE remplace ici le groupe. Un dessin en pixels n'a pas six
 * couleurs, il en a des milliers : celles d'un pelage noir se rangent toutes
 * autour d'un même noir, celles du poil fauve autour d'un même fauve. Une
 * famille, c'est cette teinte de RÉFÉRENCE et tout ce qui gravite autour.
 *
 * RECOLORER, C'EST DÉPLACER UNE FAMILLE SANS TOUCHER À SON MODELÉ. Chaque
 * pixel garde sa relation à la référence de sa famille — une ombre reste une
 * ombre, un reflet un reflet —, et c'est exactement la règle des nuances d'un
 * dessin vectoriel : {@link nuanceSuivanteRgb}, la MÊME fonction. Le pelage
 * change de couleur, le poil garde son détail. La transparence n'est jamais
 * touchée : seules les trois composantes de couleur sont réécrites.
 *
 * CE QUI EST ENREGISTRÉ. Le client choisit une couleur par famille, rangée
 * dans la configuration sous une clé « fam0 », « fam1 » — à côté des zones
 * « st0 » des dessins vectoriels, dans la même map `colors` du personnage.
 * Un panier ou une commande porte donc ces choix comme les autres, et le
 * fichier d'impression les relit tels quels.
 *
 * Ce module ne calcule que des COULEURS : ni lecture de fichier, ni décodage
 * d'image. Le serveur (apps/api/src/couleurs-image-fichier.ts) s'occupe des
 * pixels ; le back-office importe ce module tel quel dans le navigateur.
 */
import {
  hexVersRgb,
  memeCouleur,
  nuanceSuivanteRgb,
  relationDeNuance,
  rgbVersHex,
  NOM_GROUPE_MAX,
  couleursDeLaPartie,
  estNuancier,
  type Nuancier,
  type RelationNuance,
} from "./couleurs-groupes.js";

/**
 * Une famille de couleurs d'un dessin en pixels.
 *
 * `teintes` retient les autres teintes réunies à la référence : le fauve clair
 * et le fauve sombre d'un berger allemand sont le MÊME pelage, et la boutique
 * les rattache d'un geste au back-office. Toutes suivent alors la couleur
 * choisie pour la référence, chacune gardant son écart.
 */
export interface FamilleCouleur {
  /**
   * Clé de la famille dans la configuration du client (« fam0 »).
   *
   * Elle ne change JAMAIS une fois posée, même si la boutique relit les
   * couleurs du dessin : c'est elle que portent les paniers et les commandes.
   */
  cle: string;
  /** Teinte de référence : celle dont le client choisit la couleur. */
  reference: string;
  /** Teintes rattachées à la référence. Elles la suivent, écart gardé. */
  teintes?: string[];
  /** Part des pixels VISIBLES du dessin, entre 0 et 1 (pour le back-office). */
  part: number;
  /** Nom montré au client au-dessus des pastilles (« pelage », « collier »). */
  nom?: string;
  /** Proposée au client ? Rien ne l'est tant que la boutique n'a rien coché. */
  proposee?: boolean;
  /**
   * Couleur appliquée d'office, même sans choix du client : le dessin s'affiche
   * dans cette couleur-là. Absente = la teinte du fichier, telle quelle.
   */
  defaut?: string;
  /**
   * Nuancier proposé au client, comme pour un groupe du dessin de base : un
   * des quatre nuanciers des personnages, ou celui d'une catégorie de pièces.
   */
  nuancier?: Nuancier;
  /**
   * Accessoire dessiné en pixels : les couleurs proposées pour cette famille,
   * comme pour une partie d'un dessin vectoriel (cf. GroupeCouleur.couleurs).
   * Absente : le nuancier de la catégorie.
   */
  couleurs?: string[];
}

/**
 * Les couleurs d'un dessin en pixels, telles qu'elles sont rangées en base
 * (une colonne jsonb par personnage et par pièce).
 */
export interface CouleursImage {
  /** Les familles, de la plus étendue à la plus petite. */
  familles: FamilleCouleur[];
  /**
   * Carte des teintes : une vignette minuscule du dessin où le niveau de gris
   * de chaque pixel donne l'indice de sa teinte dans {@link carteTeintes}, et
   * la transparence dit ce qui est hors dessin. Enregistrée en « data: » .
   *
   * Elle sert au SEUL back-office, pour montrer OÙ se trouve une famille dans
   * le dessin. Une vignette par famille serait fausse dès que la boutique en
   * rattache une à une autre ; la carte, elle, reste juste — c'est le navigateur
   * qui colorie, à partir des familles du moment.
   */
  carte?: string;
  /** Les teintes de la carte, dans l'ordre de leurs niveaux de gris. */
  carteTeintes?: string[];
}

/** Préfixe des clés de famille dans la configuration d'un personnage. */
export const PREFIXE_FAMILLE = "fam";

/** La clé d'une famille d'après son rang (« fam0 »). */
export function cleFamille(rang: number): string {
  return `${PREFIXE_FAMILLE}${rang}`;
}

/**
 * Est-ce une clé de famille ? Sert à séparer, dans une map de couleurs, ce qui
 * s'adresse aux pixels (« fam0 ») de ce qui s'adresse aux zones d'un dessin
 * vectoriel (« st0 »).
 */
export function estCleFamille(cle: string): boolean {
  return new RegExp(`^${PREFIXE_FAMILLE}\\d+$`).test(cle);
}

/** Au-delà, la rangée de pastilles du configurateur devient illisible. */
export const FAMILLES_MAX = 6;

/**
 * En dessous, la famille ne vaut pas d'être proposée : un liseré d'un pour
 * cent du dessin donne une pastille qui ne change rien de visible.
 */
export const PART_FAMILLE_MIN = 0.01;

/** Une couleur écrite « #abc » ou « #AABBCC », normalisée, ou null. */
function couleurPropre(brut: unknown): string | null {
  if (typeof brut !== "string") return null;
  const rgb = hexVersRgb(brut);
  return rgb ? rgbVersHex(rgb[0], rgb[1], rgb[2]) : null;
}

/**
 * Les familles d'un dessin, propres et complètes — l'équivalent de
 * `groupesDuDessin` pour les dessins en pixels.
 *
 * Une donnée abîmée ne doit JAMAIS empêcher de dessiner : une famille sans
 * référence lisible est écartée, une teinte citée deux fois ne l'est qu'une,
 * et une clé en double est renumérotée. Sans rien d'enregistré, la liste est
 * vide : le dessin s'affiche exactement comme son fichier.
 */
export function famillesDuDessin(brut: unknown): FamilleCouleur[] {
  const source = Array.isArray(brut)
    ? brut
    : brut && typeof brut === "object" && Array.isArray((brut as CouleursImage).familles)
      ? (brut as CouleursImage).familles
      : [];
  const out: FamilleCouleur[] = [];
  const clesPrises = new Set<string>();
  const teintesPrises = new Set<string>();
  for (const el of source) {
    if (!el || typeof el !== "object") continue;
    const f = el as Record<string, unknown>;
    const reference = couleurPropre(f.reference);
    if (!reference || teintesPrises.has(reference)) continue;
    teintesPrises.add(reference);
    const teintes: string[] = [];
    if (Array.isArray(f.teintes))
      for (const t of f.teintes) {
        const c = couleurPropre(t);
        if (!c || teintesPrises.has(c)) continue;
        teintesPrises.add(c);
        teintes.push(c);
      }
    // Une clé illisible ou déjà prise est remplacée par le premier rang libre :
    // deux familles sous la même clé recevraient la même couleur du client.
    let cle = typeof f.cle === "string" && estCleFamille(f.cle) ? f.cle : "";
    if (!cle || clesPrises.has(cle)) {
      let i = 0;
      while (clesPrises.has(cleFamille(i))) i++;
      cle = cleFamille(i);
    }
    clesPrises.add(cle);
    const part = Number(f.part);
    const nom = typeof f.nom === "string" ? f.nom.trim().slice(0, NOM_GROUPE_MAX) : "";
    const defaut = couleurPropre(f.defaut);
    const nuancier = estNuancier(f.nuancier) ? f.nuancier : undefined;
    const couleurs = couleursDeLaPartie(f.couleurs);
    out.push({
      cle,
      reference,
      ...(teintes.length ? { teintes } : {}),
      part: Number.isFinite(part) ? Math.min(1, Math.max(0, part)) : 0,
      ...(nom ? { nom } : {}),
      ...(f.proposee === true ? { proposee: true } : {}),
      ...(defaut ? { defaut } : {}),
      ...(nuancier ? { nuancier } : {}),
      ...(couleurs.length ? { couleurs } : {}),
    });
  }
  return out;
}

/** Les familles d'un dessin que le client peut recolorer, dans l'ordre. */
export function famillesProposees(brut: unknown): FamilleCouleur[] {
  return famillesDuDessin(brut).filter((f) => f.proposee === true);
}

/** Toutes les teintes d'une famille, la référence d'abord. */
export function teintesDeLaFamille(f: FamilleCouleur): string[] {
  return [f.reference, ...(f.teintes ?? [])];
}

/** La part du dessin qu'occupe une famille, en pourcentage arrondi. */
export function partEnPourcent(f: FamilleCouleur): number {
  return Math.round(f.part * 100);
}

/**
 * Les couleurs à appliquer aux familles d'un dessin : le défaut réglé au
 * back-office, surchargé par le choix du client.
 *
 * Une famille NON proposée reprend toujours son défaut, même si la
 * configuration porte autre chose. Contrairement aux groupes d'un dessin de
 * base, cette règle-là ne risque rien : les familles n'existent que depuis ce
 * réglage, aucun panier n'a jamais pu enregistrer la couleur d'une famille
 * que la boutique ne proposait pas.
 *
 * Clés = clés de famille (« fam0 »), valeurs = couleur voulue.
 */
export function couleursDesFamilles(
  couleurs: Record<string, string> | undefined | null,
  brut: unknown,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of famillesDuDessin(brut)) {
    const choisie = f.proposee === true ? couleurPropre(couleurs?.[f.cle]) : null;
    const voulue = choisie ?? f.defaut ?? null;
    // Rien de choisi, pas de défaut : la teinte du fichier, telle quelle.
    if (voulue && !memeCouleur(voulue, f.reference)) out[f.cle] = voulue;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*  L'image dans le dessin                                                     */
/* -------------------------------------------------------------------------- */

/** Une balise `<image>` repérée dans un dessin. */
export interface BaliseImage {
  /** Où elle commence dans le texte du SVG, et la balise entière. */
  index: number;
  balise: string;
  /** Le contenu de son attribut href. */
  href: string;
}

/**
 * La balise de l'image que le dessin MONTRE, s'il en a une.
 *
 * Ces fichiers sortent d'un convertisseur « PNG vers SVG » et contiennent
 * DEUX images : la vraie, et une copie en niveaux de gris rangée dans
 * `<defs>`, qui sert de masque de transparence. Toucher au masque effacerait
 * le détourage — le chien arriverait dans un rectangle blanc. On ne retient
 * donc que les images VRAIMENT dessinées, c'est-à-dire hors de `<defs>` ; et,
 * s'il y en a plusieurs, la plus lourde, qui est le dessin.
 *
 * LE SERVEUR ET LA BOUTIQUE APPELLENT CETTE MÊME FONCTION : s'ils ne
 * désignaient pas la même image, le serveur recolorerait l'une et la boutique
 * afficherait l'autre.
 */
export function baliseImageDuDessin(svg: string): BaliseImage | null {
  const zonesDefs: [number, number][] = [];
  const reDefs = /<defs\b[\s\S]*?<\/defs>/gi;
  let d: RegExpExecArray | null;
  while ((d = reDefs.exec(svg)) !== null)
    zonesDefs.push([d.index, d.index + d[0].length]);

  const re = /<image\b[^>]*\/?>/gi;
  const candidats: BaliseImage[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) {
    const debut = m.index;
    if (zonesDefs.some(([a, b]) => debut >= a && debut < b)) continue;
    const href = /(?:xlink:)?href\s*=\s*"([^"]*)"/i.exec(m[0])?.[1] ?? "";
    if (!/^data:image\/[a-z+]+;base64,/i.test(href)) continue;
    candidats.push({ index: debut, balise: m[0], href });
  }
  if (candidats.length === 0) return null;
  return candidats.sort((a, b) => b.href.length - a.href.length)[0]!;
}

/** Le dessin est-il une image en pixels, et non un vrai dessin vectoriel ? */
export function estUnDessinEnPixels(svg: string): boolean {
  return baliseImageDuDessin(svg) !== null;
}

/**
 * Le dessin, son image remplacée par une AUTRE ADRESSE (l'image recolorée que
 * le serveur sert). Tout le reste du fichier est laissé intact : le masque de
 * transparence, le cadrage, les transformations. Le dessin reste donc un SVG
 * ordinaire, que la suite empile et cale comme n'importe quel autre.
 *
 * Rend le dessin inchangé s'il n'a pas d'image à remplacer.
 */
export function dessinAvecImage(svg: string, adresse: string): string {
  const image = baliseImageDuDessin(svg);
  if (!image) return svg;
  const balise = image.balise.replace(
    /((?:xlink:)?href\s*=\s*")[^"]*"/i,
    `$1${adresse.replace(/"/g, "&quot;")}"`,
  );
  return svg.slice(0, image.index) + balise + svg.slice(image.index + image.balise.length);
}

/* -------------------------------------------------------------------------- */
/*  Adresse du dessin recoloré                                                 */
/* -------------------------------------------------------------------------- */

/*
 * La boutique n'affiche pas un dessin recoloré par ses soins : elle demande au
 * serveur l'image recolorée, à une adresse qui dit les couleurs voulues. Les
 * couleurs voyagent donc en clair dans cette adresse, sous la forme
 * « fam0:2060C0,fam1:FFFFFF ».
 *
 * Deux raisons de passer par le serveur plutôt que de recolorer au navigateur :
 *   - l'image affichée est alors, aux octets près, celle que le moteur
 *     d'impression glissera dans le PDF — l'écran ne peut pas mentir ;
 *   - l'adresse ne change que si une couleur change, donc le navigateur garde
 *     en cache ce qu'il a déjà vu, et revenir à une couleur déjà essayée est
 *     instantané.
 */

/**
 * Les couleurs voulues, telles qu'elles s'écrivent dans l'adresse du dessin
 * recoloré. Chaîne vide = rien à recolorer, la boutique sert le dessin
 * d'origine sans rien demander au serveur.
 */
export function parametreDesFamilles(
  couleurs: Record<string, string> | undefined | null,
  brut: unknown,
): string {
  return Object.entries(couleursDesFamilles(couleurs, brut))
    .map(([cle, hex]) => `${cle}:${hex.replace("#", "")}`)
    .join(",");
}

/** L'inverse : relit le paramètre d'adresse en couleurs par famille. */
export function famillesDuParametre(parametre: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const morceau of parametre.split(",")) {
    const [cle, hex] = morceau.split(":");
    if (!cle || !hex || !estCleFamille(cle)) continue;
    const couleur = couleurPropre(`#${hex}`);
    if (couleur) out[cle] = couleur;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*  Recoloration des pixels                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Ce qu'il faut pour recolorer un dessin : la liste de TOUTES ses teintes
 * (celles des familles recolorées comme des autres) et, pour chacune, la
 * transformation à appliquer — ou rien, quand sa famille garde sa couleur.
 *
 * Toutes les teintes y figurent, et c'est indispensable : un pixel va à la
 * teinte la plus proche, et retirer de la liste les teintes qui ne bougent pas
 * enverrait les pixels du pelage fauve dans la famille du pelage noir.
 */
export interface PlanDeRecoloration {
  /** Les teintes, à plat : trois nombres (r, g, b) par teinte. */
  teintes: Int32Array;
  /** Transformation de chaque teinte, ou null si sa famille ne bouge pas. */
  transformations: (RelationNuance | null)[];
}

/**
 * Le plan de recoloration d'un dessin, ou `null` quand il n'y a rien à faire
 * (aucune famille, ou aucune couleur changée) : l'appelant sert alors le
 * fichier d'origine, sans rien calculer.
 */
export function planDeRecoloration(
  brut: unknown,
  couleurs: Record<string, string> | undefined | null,
): PlanDeRecoloration | null {
  const familles = famillesDuDessin(brut);
  if (familles.length === 0) return null;
  const voulues = couleursDesFamilles(couleurs, brut);
  if (Object.keys(voulues).length === 0) return null;

  const plat: number[] = [];
  const transformations: (RelationNuance | null)[] = [];
  for (const f of familles) {
    const cible = voulues[f.cle] ? hexVersRgb(voulues[f.cle]!) : null;
    const reference = hexVersRgb(f.reference);
    for (const teinte of teintesDeLaFamille(f)) {
      const rgb = hexVersRgb(teinte);
      if (!rgb) continue;
      plat.push(rgb[0], rgb[1], rgb[2]);
      // La relation se calcule depuis la RÉFÉRENCE de la famille, pas depuis
      // la teinte : c'est ce qui fait qu'un fauve sombre rattaché au fauve
      // clair reste plus sombre que lui après recoloration.
      transformations.push(cible && reference ? relationDeNuance(reference, cible) : null);
    }
  }
  if (plat.length === 0) return null;
  return { teintes: Int32Array.from(plat), transformations };
}

/** Un octet, borné et arrondi. */
function octet(v: number): number {
  return v <= 0 ? 0 : v >= 255 ? 255 : (v + 0.5) | 0;
}

/**
 * Recolore les pixels d'une image, SUR PLACE.
 *
 * `pixels` est l'image brute, `canaux` valant 3 (RVB) ou 4 (RVB + opacité).
 * Chaque pixel rejoint la teinte dont il est le plus proche, puis suit la
 * transformation de sa famille (cf. {@link nuanceSuivanteRgb}). L'opacité
 * n'est JAMAIS touchée : le détourage du dessin reste intact au pixel près.
 *
 * Les pixels transparents sont recolorés comme les autres, et c'est voulu :
 * ils ne se voient pas, et les épargner coûterait un test par pixel pour rien.
 *
 * ON CALCULE UNE FOIS PAR COULEUR, PAS UNE FOIS PAR PIXEL. Une illustration
 * de trois millions de pixels n'a que quelques centaines à quelques dizaines
 * de milliers de couleurs DISTINCTES : le même noir revient des millions de
 * fois. Le résultat de chaque couleur est donc retenu au passage. C'est ce
 * qui fait tenir la recoloration d'un chien en un dixième de seconde au lieu
 * d'une seconde et demie — le client change de couleur sans attendre.
 */
export function recolorerPixels(
  pixels: Uint8Array | Uint8ClampedArray,
  canaux: number,
  plan: PlanDeRecoloration,
): void {
  const { teintes, transformations } = plan;
  const nb = transformations.length;
  const sortie: [number, number, number] = [0, 0, 0];
  /** Couleur d'origine (r<<16 | g<<8 | b) -> couleur recolorée, même codage. */
  const deja = new Map<number, number>();
  for (let i = 0; i < pixels.length; i += canaux) {
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;
    const cle = (r << 16) | (g << 8) | b;
    let neuf = deja.get(cle);
    if (neuf === undefined) {
      let proche = 0;
      let distance = Infinity;
      for (let k = 0; k < nb; k++) {
        const dr = r - teintes[k * 3]!;
        const dg = g - teintes[k * 3 + 1]!;
        const db = b - teintes[k * 3 + 2]!;
        const d = dr * dr + dg * dg + db * db;
        if (d < distance) {
          distance = d;
          proche = k;
        }
      }
      const rel = transformations[proche];
      if (rel) {
        nuanceSuivanteRgb(r, g, b, rel, sortie);
        neuf = (octet(sortie[0]) << 16) | (octet(sortie[1]) << 8) | octet(sortie[2]);
      } else neuf = cle; // famille laissée telle quelle
      deja.set(cle, neuf);
    }
    if (neuf === cle) continue;
    pixels[i] = (neuf >> 16) & 255;
    pixels[i + 1] = (neuf >> 8) & 255;
    pixels[i + 2] = neuf & 255;
  }
}

/**
 * La famille à laquelle appartient une teinte de la carte, ou -1.
 * Le back-office s'en sert pour colorier la carte des teintes famille par
 * famille (cf. {@link CouleursImage.carte}).
 */
export function familleDeLaTeinte(familles: FamilleCouleur[], teinte: string): number {
  return familles.findIndex((f) =>
    teintesDeLaFamille(f).some((t) => memeCouleur(t, teinte)),
  );
}

/* -------------------------------------------------------------------------- */
/*  Quand un dessin ne rend aucune couleur                                     */
/* -------------------------------------------------------------------------- */

/**
 * Pourquoi la lecture des couleurs d'un dessin n'a rien donné.
 *
 * CINQ SITUATIONS QUI N'ONT RIEN À VOIR, et qui ne tenaient jusqu'ici qu'en
 * une seule phrase : « image illisible ou entièrement transparente ». Elle
 * était FAUSSE dans la plupart des cas — un export PNG de Canva parfaitement
 * bon s'entendait dire qu'il était abîmé, alors que c'était notre lecture qui
 * s'arrêtait au format. La boutique en concluait que ses fichiers étaient
 * mauvais et les refaisait dix fois.
 *
 * On ne met donc en cause le fichier QUE lorsque le fichier est en cause, et
 * chaque motif dit ce qu'il y a à faire ensuite.
 */
export type MotifSansCouleur =
  /** Format dont on ne sait pas encore lire les pixels. Le fichier est bon. */
  | "format-non-traite"
  /**
   * Fichier bon et lu, mais RÉELLEMENT sans un pixel opaque : il n'y a rien
   * dedans. Ne se dit plus que prouvé, le canal alpha du fichier à l'appui —
   * c'est le seul reproche qu'un dessin au trait ne méritait pas.
   */
  | "image-vide"
  /**
   * Fichier bon et franchement opaque, mais dessiné AU TRAIT : la lecture
   * cherche des APLATS de couleur et n'en trouve aucun. Le fichier n'y est
   * pour rien, et on ne lui demande pas de recommencer son export.
   */
  | "traits-trop-fins"
  /** Fichier bon, mais trop grand pour être lu sans mettre le serveur à genoux. */
  | "image-trop-grande"
  /** Fichier qui n'a pas pu être ouvert : incomplet, tronqué ou abîmé. */
  | "echec-lecture";

/**
 * Ce qu'on dit à la boutique, et ce qu'elle doit faire ensuite.
 *
 * LE TEXTE VIT ICI, et non dans les écrans, parce que plusieurs écrans le
 * montrent : la création d'un personnage, celle d'une pièce, et le bouton
 * « Détecter les couleurs » d'une fiche existante. Écrit à chaque endroit, il
 * a déjà divergé une fois.
 *
 * `precision` ajoute le détail que seul l'appelant connaît : l'extension du
 * fichier, ou ses dimensions.
 */
export function phraseSansCouleur(
  motif: MotifSansCouleur,
  precision?: string,
): string {
  const detail = precision ? ` (${precision})` : "";
  switch (motif) {
    case "format-non-traite":
      return (
        `Ce format${detail} n'est pas encore lu : ses couleurs ne peuvent pas ` +
        `être proposées au client. Le dessin est bon et s'enregistre tel quel. ` +
        `Pour pouvoir le recolorer, réexportez-le en PNG ou en SVG, puis relisez ` +
        `ses couleurs.`
      );
    case "image-vide":
      return (
        `Cette image n'a aucun pixel visible${detail} : elle est entièrement ` +
        `transparente. Le dessin s'enregistre tel quel, mais il n'y a aucune ` +
        `couleur à proposer. Vérifiez l'export — un fond transparent ne suffit ` +
        `pas, il faut que le dessin lui-même soit dedans —, puis relisez ses ` +
        `couleurs.`
      );
    case "traits-trop-fins":
      return (
        `Ce dessin est bon${detail} et s'enregistre tel quel : ses traits ` +
        `sont seulement trop fins pour que leurs couleurs soient lues. ` +
        `La lecture cherche des aplats — des zones de couleur assez larges ` +
        `pour être proposées au client — et n'en a trouvé aucun. Épaississez ` +
        `les traits, ou remplissez les zones de couleur, puis relisez ses ` +
        `couleurs.`
      );
    case "image-trop-grande":
      return (
        `Cette image est trop grande${detail} pour que ses couleurs soient lues. ` +
        `Le dessin est bon et s'enregistre tel quel. Réexportez-le en plus ` +
        `petit — 4 000 pixels de côté suffisent largement pour l'impression —, ` +
        `puis relisez ses couleurs.`
      );
    case "echec-lecture":
      return (
        `Ce fichier n'a pas pu être ouvert${detail} : il est sans doute ` +
        `incomplet ou abîmé. Le dessin s'enregistre tel quel. Réexportez-le ` +
        `depuis l'outil qui l'a produit, puis relisez ses couleurs.`
      );
  }
}
