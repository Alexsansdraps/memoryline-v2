/**
 * Groupes de couleurs d'un dessin (personnage ou pièce).
 *
 * Un dessin vectorisé par une IA, ou exporté de Canva, ne range pas ses
 * couleurs en quelques zones propres comme un fichier Illustrator : le pelage
 * d'un chat y arrive en six ou sept nuances presque identiques (ombres,
 * reflets). Proposer une rangée de pastilles par nuance noierait le client, et
 * n'en recolorer qu'une donnerait un chat roux taché de gris.
 *
 * Un GROUPE réunit ces nuances sous une seule couleur au choix du client :
 *   - la zone de RÉFÉRENCE (`zone`) est celle dont le client choisit la
 *     couleur — la teinte principale du groupe ;
 *   - les NUANCES la suivent en gardant leur écart de clarté avec elle : une
 *     ombre reste une ombre, un reflet un reflet (cf. {@link nuanceSuivante}).
 *
 * Les zones restent les classes `.stN` du SVG : le groupe n'est qu'une
 * étiquette posée dessus. Le moteur de recoloration (recolorSvg) et le fichier
 * d'impression ne changent donc pas — ils reçoivent, comme avant, une couleur
 * par zone.
 *
 * LES NUANCES SONT CALCULÉES AU MOMENT DU CHOIX, PAS AU RENDU. Le
 * configurateur écrit dans la configuration la couleur de la référence ET
 * celle de chaque nuance ; l'aperçu et l'impression ne font qu'appliquer ces
 * couleurs. Deux raisons :
 *   - l'écran et le papier ne peuvent pas diverger, puisqu'ils ne calculent
 *     rien ;
 *   - une configuration enregistrée avant qu'un dessin soit groupé (panier,
 *     commande payée) garde exactement ses couleurs : aucune nuance ne se met
 *     à « suivre » une couleur choisie à une époque où elle ne la suivait pas.
 *
 * Ce module ne dépend de rien d'autre que de svg-color : le back-office
 * l'importe tel quel dans le navigateur (export « @memoryline/types/couleurs »).
 */
import { BASE_COLOR_SCOPE, colorKey, colorsForScope } from "./svg-color.js";

/** Les quatre nuanciers des personnages (réglés au back-office, cf. nuanciers.ts). */
export const NUANCIERS_BASE = ["peau", "cheveux", "vetements", "pantalon"] as const;
export type NuancierBase = (typeof NUANCIERS_BASE)[number];

/**
 * Le nuancier proposé pour une couleur du dessin de BASE d'un personnage :
 * l'un des quatre nuanciers des personnages, ou celui d'une CATÉGORIE DE
 * PIÈCES, désignée par son identifiant (« categorie:robes »).
 *
 * Le second cas est venu d'un animal : « je voulais mettre le nuancier de
 * peau au berger allemand » ; et pourquoi pas, demain, celui des « Pelages »
 * créé comme une catégorie. Une catégorie archivée, décochée ou vidée depuis
 * ne casse rien : le configurateur retombe sur le nuancier du groupe.
 */
export type Nuancier = NuancierBase | `categorie:${string}`;

/** Le préfixe d'un nuancier de catégorie de pièces. */
export const PREFIXE_NUANCIER_CATEGORIE = "categorie:";

/** Vrai pour l'un des quatre nuanciers des personnages. */
export function estNuancierBase(v: unknown): v is NuancierBase {
  return (NUANCIERS_BASE as readonly unknown[]).includes(v);
}

/**
 * Vrai pour un nuancier qu'on sait lire. Toute autre valeur est écartée au
 * nettoyage, sans bruit : une donnée abîmée ne doit jamais empêcher de
 * dessiner, elle fait simplement retomber sur le nuancier par défaut.
 */
export function estNuancier(v: unknown): v is Nuancier {
  return (
    estNuancierBase(v) ||
    (typeof v === "string" &&
      /^categorie:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v) &&
      v.length <= 80)
  );
}

/** Un groupe de couleurs, tel qu'il est rangé en base. */
export interface GroupeCouleur {
  /** Zone de référence : celle dont le client choisit la couleur (« st0 »). */
  zone: string;
  /** Les autres nuances du groupe (ombres, reflets) : elles suivent la référence. */
  nuances?: string[];
  /** Nom montré au client au-dessus des pastilles (« robe », « pelage »). */
  nom?: string;
  /**
   * Nuancier proposé, pour les groupes du dessin de BASE d'un personnage. Les
   * pièces, elles, prennent celui de leur catégorie.
   */
  nuancier?: Nuancier;
  /**
   * Pièce : la boutique a DÉCOCHÉ « C'est une ombre » sur cette couleur. Le
   * site la prenait pour l'ombre d'une autre, c'était une partie à elle — la
   * visière d'une casquette, le revers d'un bonnet : elle garde sa propre
   * rangée de pastilles, et ne suit plus rien (cf. famillesDeLaPiece).
   * Écrite jadis par le bouton « Séparer », qui faisait la même chose.
   */
  separee?: true;
  /**
   * Pièce : la boutique a COCHÉ « C'est une ombre » sur cette couleur. La
   * lecture du dessin y voyait une partie à elle ; c'est l'ombre (ou le
   * reflet) d'une autre couleur : elle n'a pas de rangée à elle, elle suit la
   * couleur principale de sa teinte — à défaut, la plus proche en teinte —,
   * avec ses propres ombres (cf. famillesDeLaPiece). Jamais en même temps que
   * `separee` : c'est la même case, cochée ou décochée.
   *
   * Sans l'une ni l'autre, c'est la lecture du dessin qui décide. Dès que la
   * boutique touche la case, son choix passe devant — écrit seulement s'il
   * contredit la lecture : remettre la case comme elle était l'efface (cf.
   * reglerOmbre).
   */
  ombre?: true;
  /**
   * Les couleurs que la boutique propose pour CETTE partie d'une pièce, dans
   * l'ordre où le client les voit. « C'est moi qui dois les changer, en
   * ajouter et en supprimer si je veux. Pas de sélecteur pour les gens »
   * (Margaux, 20 octobre 2026), d'abord pour les accessoires : le nuancier de
   * la catégorie, partagé par toutes les parties de toutes les pièces, ne
   * laissait pas proposer du doré pour une monture de lunettes sans le
   * proposer aussi pour un bonnet. Puis, le même jour, pour TOUTES les pièces
   * (« elle veut définir x couleurs, jusqu'à 10 pour chaque partie d'une
   * pièce ») : vêtements, pantalons, coupes et accessoires.
   *
   * Absente : la partie propose le nuancier de sa catégorie, comme avant
   * (cf. pastillesDeLaRangee). Présente : le client n'a QUE ces pastilles,
   * sans saisie libre. Portée par la TÊTE d'une rangée du client — sa couleur
   * de référence — : une ombre suit sa couleur et n'a pas de pastilles à
   * elle, sa liste éventuelle ne sert pas.
   *
   * Seules les pastilles en dépendent : les couleurs choisies s'écrivent zone
   * par zone dans la configuration, comme avant, et un panier ou une commande
   * qui porte une couleur sortie de la liste se dessine et s'imprime avec elle.
   */
  couleurs?: string[];
}

/** Longueur maximale d'un nom de groupe : il tient sur une ligne de l'éditeur. */
export const NOM_GROUPE_MAX = 40;

/* -------------------------------------------------------------------------- */
/*  Les couleurs propres d'une partie de pièce                                 */
/* -------------------------------------------------------------------------- */

/** L'emplacement des accessoires, tel qu'il est rangé en base. */
export const EMPLACEMENT_ACCESSOIRE = "accessory";

/**
 * Au plus 10 couleurs par partie, pour toutes les pièces : « possibilité
 * d'en ajouter jusqu'à 10 pour chaque partie d'une pièce » (20 octobre 2026).
 * Dix pastilles tiennent sur deux lignes d'un téléphone. C'est ce que la
 * boutique peut AJOUTER (back-office, API) et ce que le client VOIT (cf.
 * pastillesDeLaRangee).
 */
export const COULEURS_PARTIE_MAX = 10;

/**
 * La borne d'avant, 40 : une liste rangée quand elle valait (les « Pastilles
 * du client » des accessoires, en ligne le 20 octobre 2026) peut dépasser 10.
 * Elle se LIT entière, jusqu'à 40 (cf. couleursDeLaPartie) : le back-office,
 * qui renvoie toutes les parties à chaque réglage — un nom, une case —, la
 * couperait sinon à 10 en base sans un mot, au premier geste sur la pièce.
 * Le client n'en voit que les 10 premières ; le back-office dit combien en
 * retirer, et l'API n'en refuse que l'AJOUT (cf. refusDesCouleursDesParties).
 */
export const COULEURS_PARTIE_LUES_MAX = 40;

/** « #b8551d », « b8551d » ou « #abc » -> « #B8551D » ; null si ce n'est pas une couleur. */
export function couleurHexPropre(brut: unknown): string | null {
  if (typeof brut !== "string") return null;
  let h = brut.trim().toUpperCase();
  if (!h.startsWith("#")) h = `#${h}`;
  if (/^#[0-9A-F]{3}$/.test(h))
    h = `#${h
      .slice(1)
      .split("")
      .map((x) => x + x)
      .join("")}`;
  return /^#[0-9A-F]{6}$/.test(h) ? h : null;
}

/**
 * La liste propre d'une partie telle qu'elle se LIT et se RANGE (rendu,
 * back-office, nettoyage de l'API) : couleurs relues en « #RRGGBB »,
 * illisibles et doublons écartés, l'ordre gardé, 40 au plus
 * (COULEURS_PARTIE_LUES_MAX : une liste d'avant la borne de 10 ne perd rien).
 * Le client, lui, n'en voit que 10 (cf. pastillesDeLaRangee). Jamais
 * d'erreur : une donnée abîmée retombe sur moins de pastilles, au pire sur le
 * nuancier de la catégorie — jamais sur un module qui ne s'affiche plus.
 */
export function couleursDeLaPartie(brut: unknown): string[] {
  if (!Array.isArray(brut)) return [];
  const out: string[] = [];
  for (const v of brut) {
    const c = couleurHexPropre(v);
    if (c && !out.includes(c)) out.push(c);
    if (out.length >= COULEURS_PARTIE_LUES_MAX) break;
  }
  return out;
}

/**
 * Les listes propres déjà rangées d'une pièce, toutes parties confondues :
 * `sources`, les groupes d'un dessin vectoriel et les familles d'un dessin en
 * pixels, tels qu'ils sont en base. Ce que l'API compare à un envoi pour
 * savoir si une liste de plus de 10 couleurs est ANCIENNE (cf.
 * refusDesCouleursDesParties).
 */
export function listesDesParties(...sources: unknown[]): string[][] {
  const out: string[][] = [];
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const el of source) {
      if (!el || typeof el !== "object") continue;
      const couleurs = couleursDeLaPartie((el as Record<string, unknown>).couleurs);
      if (couleurs.length) out.push(couleurs);
    }
  }
  return out;
}

/**
 * Les listes propres des parties, vérifiées avant d'être ENREGISTRÉES (API) :
 * chaque couleur au format « #RRGGBB », 10 au plus par partie. Les doublons,
 * eux, se retirent sans bruit au nettoyage (couleursDeLaPartie) : la même
 * couleur deux fois ne fait qu'une pastille.
 *
 * Plus stricte que la lecture, exprès : une couleur mal écrite qui
 * disparaîtrait en silence ferait croire à la boutique qu'elle est proposée.
 * Rend la raison du refus, en mots de la boutique, ou null si tout va bien.
 * `elements` : les groupes d'un dessin vectoriel, ou les familles d'un dessin
 * en pixels — les deux portent `couleurs` de la même façon.
 *
 * UNE LISTE D'AVANT LA BORNE DE 10 PASSE, tant qu'on n'y AJOUTE rien.
 * `anciennes` : les listes déjà rangées de la pièce (cf. listesDesParties).
 * Une liste de plus de 10 couleurs qui n'en contient aucune de nouvelle — la
 * même, rangée autrement, ou raccourcie — est acceptée : le back-office
 * renvoie toutes les parties à chaque réglage, et refuser la pièce entière
 * pour une liste qu'on n'a pas touchée empêcherait de renommer quoi que ce
 * soit. C'est l'ajout, au-delà de 10, qui est refusé.
 */
export function refusDesCouleursDesParties(
  elements: unknown,
  anciennes: readonly (readonly string[])[] = [],
): string | null {
  if (!Array.isArray(elements)) return null;
  for (const el of elements) {
    if (!el || typeof el !== "object") continue;
    const brut = (el as Record<string, unknown>).couleurs;
    if (brut === undefined || brut === null) continue;
    if (!Array.isArray(brut))
      return "Les couleurs d'une partie n'ont pas pu être lues. Rechargez la page.";
    const vues = new Set<string>();
    for (const v of brut) {
      const c = typeof v === "string" ? v.trim().toUpperCase() : "";
      if (!/^#[0-9A-F]{6}$/.test(c))
        return `« ${String(v)} » n'est pas un code couleur : écrivez-le comme #B8551D.`;
      vues.add(c);
    }
    const ancienne =
      vues.size <= COULEURS_PARTIE_LUES_MAX &&
      anciennes.some((a) => [...vues].every((c) => a.includes(c)));
    if (vues.size > COULEURS_PARTIE_MAX && !ancienne)
      return `Une partie propose ${COULEURS_PARTIE_MAX} couleurs au plus : retirez-en avant d'en ajouter une autre.`;
  }
  return null;
}

/**
 * Les groupes (ou les familles en pixels) d'une pièce SANS leurs listes de
 * pastilles : ce qui dessine la pièce, et rien de plus.
 *
 * Pour les empreintes des fichiers rangés (fichier d'impression, image
 * recolorée) : les pastilles proposées au client ne changent rien à ce qui
 * s'imprime, et les y laisser faisait refaire, à chaque retouche d'une liste
 * au back-office, le PDF de toutes les commandes qui portent la pièce — un
 * rendu à 300 points par pouce par commande, pour une affiche identique.
 *
 * Un élément sans liste est rendu TEL QUEL (même objet, mêmes clés dans le
 * même ordre) : les empreintes des fichiers déjà rangés ne bougent pas. Sans
 * aucune liste, c'est le tableau même qui revient ; ce qui n'est pas un
 * tableau (null, une donnée abîmée) aussi.
 */
export function sansPastillesProposees<T>(elements: T): T {
  if (!Array.isArray(elements)) return elements;
  const aUneListe = (el: unknown): el is Record<string, unknown> =>
    !!el && typeof el === "object" && "couleurs" in el;
  // Aucune liste : la valeur même, pour que l'appelant sache que rien n'a changé.
  if (!elements.some(aUneListe)) return elements;
  return elements.map((el: unknown) => {
    if (!aUneListe(el)) return el;
    const copie = { ...el };
    delete copie.couleurs;
    return copie;
  }) as T;
}

/**
 * Les pastilles d'une rangée de pièce dans le module, et si le client peut
 * aussi y saisir une couleur hors liste (la pastille arc-en-ciel).
 *
 *   - La partie a SA liste (cf. GroupeCouleur.couleurs), quelle que soit la
 *     pièce : le client n'a que ces pastilles, sans saisie libre. C'est la
 *     boutique qui a choisi, une à une, ce qu'elle propose.
 *   - Sinon, le nuancier de la catégorie, fermé ; sans lui, le nuancier de
 *     repli de l'emplacement, avec la saisie libre — sauf sur un ACCESSOIRE,
 *     qui n'en a jamais : « pas de sélecteur pour les gens ». Même un
 *     accessoire sans catégorie n'ouvre pas la saisie libre.
 *
 * `repli` : le nuancier de l'emplacement (celui des vêtements des personnages
 * pour un accessoire, tel que la boutique l'a réglé).
 *
 * Une liste propre rangée avant la borne de 10 (cf. COULEURS_PARTIE_LUES_MAX)
 * ne montre que ses 10 premières pastilles : le back-office dit à la boutique
 * combien en retirer.
 */
export function pastillesDeLaRangee(
  slot: string,
  propres: readonly string[] | null | undefined,
  categorie: readonly string[] | null | undefined,
  repli: readonly string[],
): { couleurs: readonly string[]; libre: boolean } {
  const accessoire = slot === EMPLACEMENT_ACCESSOIRE;
  if (propres && propres.length > 0)
    return {
      couleurs: propres.length > COULEURS_PARTIE_MAX ? propres.slice(0, COULEURS_PARTIE_MAX) : propres,
      libre: false,
    };
  if (categorie && categorie.length > 0) return { couleurs: categorie, libre: false };
  return { couleurs: repli, libre: !accessoire };
}

/** Toutes les zones d'un groupe, la référence d'abord. */
export function zonesDuGroupe(groupe: GroupeCouleur): string[] {
  return [groupe.zone, ...(groupe.nuances ?? [])];
}

/**
 * Les groupes d'un dessin, propres et complets.
 *
 * - Sans groupes enregistrés (dessins d'avant ce réglage), chaque zone forme
 *   son propre groupe, dans l'ordre de `zones` : exactement le comportement
 *   d'avant, une rangée de pastilles par zone.
 * - Une zone n'appartient qu'à un groupe ; une zone disparue du dessin sort de
 *   son groupe (si c'était la référence, la première nuance restante prend sa
 *   place) ; une zone que les groupes ne citent pas forme un groupe à elle.
 *
 * Utilisée au rendu comme à l'enregistrement : une donnée abîmée ne doit
 * jamais empêcher de dessiner.
 */
export function groupesDuDessin(
  zones: Record<string, string> | null | undefined,
  groupes: unknown,
): GroupeCouleur[] {
  const existantes = zones ?? {};
  const prises = new Set<string>();
  const out: GroupeCouleur[] = [];
  const libre = (z: unknown): z is string =>
    typeof z === "string" && z in existantes && !prises.has(z);

  if (Array.isArray(groupes)) {
    for (const brut of groupes) {
      if (!brut || typeof brut !== "object") continue;
      const g = brut as Record<string, unknown>;
      const membres: string[] = [];
      for (const z of [g.zone, ...(Array.isArray(g.nuances) ? g.nuances : [])]) {
        if (!libre(z) || membres.includes(z)) continue;
        membres.push(z);
      }
      if (membres.length === 0) continue;
      for (const z of membres) prises.add(z);
      const [zone, ...nuances] = membres as [string, ...string[]];
      const nom =
        typeof g.nom === "string" ? g.nom.trim().slice(0, NOM_GROUPE_MAX) : "";
      const nuancier = estNuancier(g.nuancier) ? g.nuancier : undefined;
      const couleurs = couleursDeLaPartie(g.couleurs);
      out.push({
        zone,
        ...(nuances.length ? { nuances } : {}),
        ...(nom ? { nom } : {}),
        ...(nuancier ? { nuancier } : {}),
        // La case « C'est une ombre », décochée ou cochée : jamais les deux.
        // Une donnée qui porterait les deux garde « à part », le réglage le
        // plus ancien — celui qui ne retire de rangée à personne.
        ...(g.separee === true
          ? { separee: true as const }
          : g.ombre === true
            ? { ombre: true as const }
            : {}),
        ...(couleurs.length ? { couleurs } : {}),
      });
    }
  }
  for (const z of Object.keys(existantes)) if (!prises.has(z)) out.push({ zone: z });
  return out;
}

/* -------------------------------------------------------------------------- */
/*  Arithmétique des couleurs                                                  */
/* -------------------------------------------------------------------------- */

/** "#abc" | "#AABBCC" -> [r, g, b] (0..255), ou null si ce n'est pas une couleur. */
export function hexVersRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** [r, g, b] -> "#RRGGBB" (les valeurs sont arrondies et bornées). */
export function rgbVersHex(r: number, g: number, b: number): string {
  const x = (n: number) =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, "0");
  return `#${x(r)}${x(g)}${x(b)}`.toUpperCase();
}

/** Deux écritures de la même couleur (« #abc » et « #AABBCC ») ? */
export function memeCouleur(a: string, b: string): boolean {
  const x = hexVersRgb(a);
  const y = hexVersRgb(b);
  return !!x && !!y && x[0] === y[0] && x[1] === y[1] && x[2] === y[2];
}

/**
 * RGB -> TSL, SANS RIEN ALLOUER : la teinte (en degrés), la saturation et la
 * clarté (0..1) sont écrites dans `sortie`.
 *
 * Cette version sans allocation existe pour les dessins en PIXELS
 * (couleurs-image.ts) : elle y est appelée une fois par pixel, soit trois
 * millions de fois pour un chien. Rendre un tableau à chaque appel, c'est
 * trois millions de tableaux jetés aussitôt — le calcul en double de durée.
 */
export function versTsl(
  r: number,
  g: number,
  b: number,
  sortie: [number, number, number],
): void {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) {
    sortie[0] = 0;
    sortie[1] = 0;
    sortie[2] = l;
    return;
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  sortie[0] = h * 60;
  sortie[1] = s;
  sortie[2] = l;
}

/** TSL -> RGB (0..255, non arrondi), sans rien allouer non plus. */
export function versRgb(
  h: number,
  s: number,
  l: number,
  sortie: [number, number, number],
): void {
  if (s === 0) {
    sortie[0] = l * 255;
    sortie[1] = l * 255;
    sortie[2] = l * 255;
    return;
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const canal = (t: number) => {
    let u = t;
    if (u < 0) u += 1;
    if (u > 1) u -= 1;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  const hn = (((h % 360) + 360) % 360) / 360;
  sortie[0] = canal(hn + 1 / 3) * 255;
  sortie[1] = canal(hn) * 255;
  sortie[2] = canal(hn - 1 / 3) * 255;
}

const borne01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * « Vraiment colorée » : l'écart entre canaux, et non la saturation TSL.
 *
 * Un blanc cassé paraît saturé en TSL ; s'en servir pour reporter un décalage
 * de teinte virerait un pull bleu au violet.
 */
export function couleurVive(r: number, g: number, b: number): boolean {
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255 >= 0.08;
}

/**
 * Ce qu'il faut savoir d'un couple (couleur d'origine -> couleur choisie)
 * pour faire suivre toutes ses nuances : calculé UNE fois, appliqué ensuite à
 * chaque nuance (dessin vectoriel) ou à chaque pixel (dessin en pixels).
 */
export interface RelationNuance {
  /** Teinte, saturation et clarté de la couleur de RÉFÉRENCE. */
  hr: number;
  sr: number;
  lr: number;
  /** Teinte, saturation et clarté de la couleur CHOISIE. */
  hc: number;
  sc: number;
  lc: number;
  /** La référence est-elle vraiment colorée (cf. {@link couleurVive}) ? */
  refVive: boolean;
}

/** La relation entre une couleur de référence et la couleur choisie (RGB 0..255). */
export function relationDeNuance(
  reference: readonly [number, number, number],
  choisie: readonly [number, number, number],
): RelationNuance {
  const tr: [number, number, number] = [0, 0, 0];
  const tc: [number, number, number] = [0, 0, 0];
  versTsl(reference[0], reference[1], reference[2], tr);
  versTsl(choisie[0], choisie[1], choisie[2], tc);
  return {
    hr: tr[0],
    sr: tr[1],
    lr: tr[2],
    hc: tc[0],
    sc: tc[1],
    lc: tc[2],
    refVive: couleurVive(reference[0], reference[1], reference[2]),
  };
}

/**
 * La couleur que prend UNE nuance (ou un pixel) sous une relation donnée.
 * Le cœur de {@link nuanceSuivante} — voir son commentaire pour la règle.
 * Écrit dans `sortie` (0..255, non arrondi) pour ne rien allouer.
 */
export function nuanceSuivanteRgb(
  r: number,
  g: number,
  b: number,
  rel: RelationNuance,
  sortie: [number, number, number],
): void {
  const t: [number, number, number] = tampon;
  versTsl(r, g, b, t);
  const hn = t[0];
  const sn = t[1];
  const ln = t[2];

  let l: number;
  if (ln <= rel.lr) l = rel.lr > 0 ? rel.lc * (ln / rel.lr) : rel.lc;
  else l = rel.lr < 1 ? 1 - (1 - rel.lc) * ((1 - ln) / (1 - rel.lr)) : rel.lc;

  const s =
    rel.refVive && rel.sr > 0
      ? borne01(rel.sc * Math.min(2.5, Math.max(0.4, sn / rel.sr)))
      : rel.sc;

  let h = rel.hc;
  if (rel.refVive && couleurVive(r, g, b) && rel.sc >= 0.05)
    h = rel.hc + (((hn - rel.hr + 540) % 360) - 180);

  versRgb(h, s, borne01(l), sortie);
}

/** Tampon de travail de {@link nuanceSuivanteRgb} : un seul pour tout le module. */
const tampon: [number, number, number] = [0, 0, 0];

/**
 * La couleur que prend une nuance quand la référence de son groupe passe de
 * `reference` à `choisie`.
 *
 * On garde la RELATION de la nuance à sa référence, pas son écart brut :
 *   - clarté : une ombre garde la même proportion de noir (une ombre à 75 %
 *     de la clarté de la référence reste à 75 % de la nouvelle couleur), un
 *     reflet la même proportion de blanc. Ni l'une ni l'autre ne sature
 *     jamais : sur un pelage passé au blanc, l'ombre reste un gris clair ;
 *     passé au noir, le reflet reste un gris sombre ;
 *   - saturation : la même proportion, sauf quand la référence est un gris,
 *     un blanc cassé ou un quasi-noir (sa saturation ne dit alors rien) — la
 *     nuance prend celle choisie ;
 *   - teinte : le même petit décalage, si les deux couleurs d'origine sont
 *     vraiment colorées ; sinon, la teinte choisie. « Vraiment colorée » se
 *     juge sur l'écart entre canaux, pas sur la saturation TSL : un blanc
 *     cassé y paraît saturé, et son « décalage de teinte » virerait un pull
 *     bleu au violet.
 *
 * Choisir la couleur d'origine de la référence rend la nuance d'origine, au
 * chiffre près : revenir à la couleur par défaut ne laisse aucune trace.
 *
 * LE CALCUL LUI-MÊME VIT DANS {@link nuanceSuivanteRgb}, et c'est important :
 * un dessin en PIXELS (photo ou illustration enregistrée en SVG) recolore ses
 * pixels par la même fonction, un pixel valant une nuance. Les deux sortes de
 * dessins ne peuvent donc pas se mettre à ombrer différemment.
 */
export function nuanceSuivante(
  nuance: string,
  reference: string,
  choisie: string,
): string {
  const n = hexVersRgb(nuance);
  const r = hexVersRgb(reference);
  const c = hexVersRgb(choisie);
  if (!n) return nuance;
  if (!r || !c || memeCouleur(reference, choisie)) return rgbVersHex(...n);
  const out: [number, number, number] = [0, 0, 0];
  nuanceSuivanteRgb(n[0], n[1], n[2], relationDeNuance(r, c), out);
  return rgbVersHex(out[0], out[1], out[2]);
}

/**
 * Les couleurs d'un groupe quand sa référence prend la couleur `hex` : la
 * référence elle-même, et chaque nuance recalculée depuis les couleurs PAR
 * DÉFAUT du dessin (cf. {@link nuanceSuivante}). Clés = zones (« st3 »).
 *
 * Une nuance sans couleur par défaut connue est laissée de côté : on ne sait
 * pas d'où elle part.
 */
export function couleursDuGroupe(
  groupe: GroupeCouleur,
  defauts: Record<string, string> | null | undefined,
  hex: string,
): Record<string, string> {
  const out: Record<string, string> = { [groupe.zone]: hex };
  const reference = defauts?.[groupe.zone];
  for (const z of groupe.nuances ?? []) {
    const d = defauts?.[z];
    if (!d) continue;
    out[z] = reference ? nuanceSuivante(d, reference, hex) : d;
  }
  return out;
}

/**
 * Pareil, sous les clés namespacées d'un personnage (« clothes:st3 »,
 * « base:st0 ») : c'est ce que le configurateur écrit dans la configuration
 * quand le client choisit la couleur d'un groupe.
 */
export function couleursDuGroupePourScope(
  scope: string,
  groupe: GroupeCouleur,
  defauts: Record<string, string> | null | undefined,
  hex: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [z, c] of Object.entries(couleursDuGroupe(groupe, defauts, hex)))
    out[colorKey(scope, z)] = c;
  return out;
}

/* -------------------------------------------------------------------------- */
/*  Groupes proposés au client                                                 */
/* -------------------------------------------------------------------------- */

/** Ce qu'il faut savoir du dessin de base d'un personnage pour ses couleurs. */
export interface DessinDeBase {
  baseColorZones?: Record<string, string> | null;
  baseGroupesCouleurs?: unknown;
  /**
   * Zones de référence des groupes proposés au client. Absent (null) : le
   * premier groupe seulement — la peau, pour un personnage humain. C'était la
   * règle avant ce réglage, elle le reste pour tout personnage qui n'a pas été
   * touché.
   */
  baseZonesProposees?: readonly string[] | null;
}

/** Les groupes du dessin de base que le client peut recolorer, dans l'ordre. */
export function groupesProposesDeLaBase(base: DessinDeBase): GroupeCouleur[] {
  const groupes = groupesDuDessin(base.baseColorZones, base.baseGroupesCouleurs);
  const proposees = base.baseZonesProposees;
  if (!Array.isArray(proposees)) return groupes.slice(0, 1);
  return groupes.filter((g) => proposees.includes(g.zone));
}

/**
 * Ce qu'il faut savoir d'une pièce pour ses couleurs.
 *
 * PLUS DE ZONES MASQUÉES. La colonne `asset.zones_masquees` (les anciennes
 * cases « Le client peut la changer ») reste en base, intacte, mais plus rien
 * ne la lit : « le client peut changer toutes les couleurs en fait »
 * (20 octobre 2026), et la case a quitté le back-office — il n'y aurait plus
 * eu d'écran pour défaire un ancien réglage qui cacherait une couleur.
 */
export interface DessinDePiece {
  colorZones?: Record<string, string> | null;
  groupesCouleurs?: unknown;
  /**
   * La part du dessin que peint chaque zone (0 à 1), mesurée par l'API sur un
   * rendu de la pièce : c'est elle qui désigne la couleur principale et range
   * les familles de teinte. Absente (pas encore mesurée), la principale est le
   * premier groupe, avec les ombres de sa teinte.
   */
  partsDesZones?: Readonly<Record<string, number>> | null;
}

/* -------------------------------------------------------------------------- */
/*  Couleurs proposées : l'ancienne règle de la catégorie                      */
/* -------------------------------------------------------------------------- */

/**
 * Ce qu'une catégorie de pièces proposait au client : « toutes » ses
 * couleurs, ou la « principale » seule (les détails — le ruban d'un chapeau —
 * gardaient alors la couleur du dessin).
 *
 * PLUS LUE DEPUIS LE 20 OCTOBRE 2026. « Le client peut changer toutes les
 * couleurs en fait » : chaque pièce propose toutes ses familles de teinte
 * (cf. groupesProposesDeLaPiece), quelle que soit sa catégorie, et le menu a
 * quitté Catégories de pièces. La colonne `piece_category.couleurs_proposees`
 * reste en base, telle quelle (toutes les catégories y sont sur « toutes »
 * depuis la migration 0068) ; l'API la lit et la renvoie encore, rien ne
 * s'en sert pour dessiner.
 */
export const COULEURS_PROPOSEES = ["toutes", "principale"] as const;
export type CouleursProposees = (typeof COULEURS_PROPOSEES)[number];

/** Une valeur venue de la base ou d'un formulaire, ramenée à une règle connue. */
export function couleursProposees(brut: unknown): CouleursProposees {
  return brut === "principale" ? "principale" : "toutes";
}

/**
 * La couleur PRINCIPALE d'un dessin : le groupe qui en couvre la plus grande
 * part, nuances comprises — la calotte d'un chapeau plutôt que son ruban.
 *
 * La surface plutôt que le rang : dans les dessins d'Illustrator, la zone
 * « st0 » est souvent un petit détail (les chaussures d'un pantalon, le
 * contour d'une casquette). À part égale, ou faute de mesure, le premier
 * groupe : celui que le back-office montre en premier.
 */
export function groupePrincipal(
  groupes: readonly GroupeCouleur[],
  parts?: Readonly<Record<string, number>> | null,
): GroupeCouleur | undefined {
  let principal = groupes[0];
  if (!parts) return principal;
  let meilleure = -1;
  for (const g of groupes) {
    const part = zonesDuGroupe(g).reduce((s, z) => {
      const p = parts[z];
      return s + (typeof p === "number" && Number.isFinite(p) ? p : 0);
    }, 0);
    // Strictement plus grand : à égalité, le premier reste principal.
    if (part > meilleure) {
      meilleure = part;
      principal = g;
    }
  }
  return principal;
}

/**
 * Deux couleurs de la même FAMILLE — une ombre et sa couleur, un reflet ?
 *
 * Même teinte à 12° près pour deux couleurs franches ; pour deux gris (ou
 * blancs, ou noirs), une clarté voisine. Mesuré sur les chapeaux de la
 * boutique : une ombre s'écarte de sa couleur de 2 à 7°, un ruban orange d'un
 * chapeau brun de 15 à 16°.
 */
export function memeFamilleDeTeinte(a: string, b: string): boolean {
  const x = hexVersRgb(a);
  const y = hexVersRgb(b);
  if (!x || !y) return false;
  const vx = couleurVive(x[0], x[1], x[2]);
  const vy = couleurVive(y[0], y[1], y[2]);
  if (vx !== vy) return false;
  const tx: [number, number, number] = [0, 0, 0];
  const ty: [number, number, number] = [0, 0, 0];
  versTsl(x[0], x[1], x[2], tx);
  versTsl(y[0], y[1], y[2], ty);
  if (!vx) return Math.abs(tx[2] - ty[2]) <= 0.35;
  const ecart = Math.abs(tx[0] - ty[0]) % 360;
  return Math.min(ecart, 360 - ecart) <= 12;
}

/**
 * Les seuils qui disent si une zone est l'OMBRE d'une couleur de sa famille
 * de teinte, ou une autre PARTIE de la même teinte (cf. famillesDeLaPiece).
 * Réglés le 20 octobre 2026 sur les pièces du catalogue, vignette par
 * vignette : la teinte seule réunissait la calotte bleu ciel d'une casquette
 * trucker et sa visière bleue, le corps brun d'un bonnet et son revers
 * orange, un jean et ses baskets bleu pâle — le client ne pouvait plus
 * changer l'un sans l'autre.
 *
 * ECART_CLARTE_OMBRE : une ombre, ou un reflet, reste à moins de 0,22 de
 * clarté (TSL) d'une couleur de sa famille. Les teintes qui doivent suivre
 * vont jusqu'à 0,21 (les poignets plus sombres de la veste 341) ; les
 * parties à part commencent à 0,25 (la visière sous le filet, 401), 0,26 (le
 * revers du bonnet, 400).
 *
 * PART_MAX_OMBRE : une ombre couvre moins des deux tiers de sa couleur. Deux
 * moitiés de même teinte (le bonnet 393 et son revers, 52 % et 48 % du
 * dessin ; la calotte et le bord d'un chapeau de paille) sont deux parties.
 *
 * PART_DETAIL : un détail PLUS SOMBRE qui couvre moins de 5 % de sa couleur —
 * une couture, un liseré, les œillets d'une sangle — la suit, quelle que
 * soit sa clarté : une rangée de pastilles pour un trait que l'œil distingue
 * à peine encombrerait le module, et laissé à sa couleur, il trancherait.
 *
 * Aucun seuil ne lit un dessin comme un œil : la boutique corrige au
 * back-office, d'une case « C'est une ombre » sur chaque couleur, ce que la
 * lecture a mal vu — une partie prise pour une ombre (case décochée, cf.
 * GroupeCouleur.separee), une ombre prise pour une partie (case cochée, cf.
 * GroupeCouleur.ombre).
 */
export const ECART_CLARTE_OMBRE = 0.22;
export const PART_MAX_OMBRE = 2 / 3;
export const PART_DETAIL = 0.05;

/** La clarté TSL d'une couleur (0 à 1) ; 0 si ce n'est pas une couleur. */
function clarteDe(hex: string): number {
  const rgb = hexVersRgb(hex);
  if (!rgb) return 0;
  const t: [number, number, number] = [0, 0, 0];
  versTsl(rgb[0], rgb[1], rgb[2], t);
  return t[2];
}

/**
 * L'écart de TEINTE entre deux couleurs, pour une couleur que la boutique a
 * cochée « C'est une ombre » sans qu'aucune couleur de sa teinte ne soit là
 * pour qu'elle la suive : elle suit alors la plus proche en teinte.
 *
 * Deux couleurs franches : l'angle entre leurs teintes (0 à 180°). Deux gris
 * (ou blancs, ou noirs), dont la teinte ne veut rien dire : leur écart de
 * clarté, sur la même échelle. Un gris et une couleur franche : en dernier
 * recours, après toutes les autres.
 */
function ecartDeTeinte(a: string, b: string): number {
  const x = hexVersRgb(a);
  const y = hexVersRgb(b);
  if (!x || !y) return Infinity;
  const tx: [number, number, number] = [0, 0, 0];
  const ty: [number, number, number] = [0, 0, 0];
  versTsl(x[0], x[1], x[2], tx);
  versTsl(y[0], y[1], y[2], ty);
  const clarte = Math.abs(tx[2] - ty[2]) * 180;
  const vx = couleurVive(x[0], x[1], x[2]);
  const vy = couleurVive(y[0], y[1], y[2]);
  if (vx && vy) {
    const angle = Math.abs(tx[0] - ty[0]) % 360;
    return Math.min(angle, 360 - angle);
  }
  return vx === vy ? clarte : 180 + clarte;
}

/**
 * La zone de TÊTE d'un groupe : celle dont le client choisit la couleur, les
 * autres la suivent.
 *
 * Un groupe enregistré a pour référence sa zone de plus petit numéro (cf.
 * grouperNuances) : sur un dessin d'Illustrator relu, ce peut être un chignon
 * plutôt que la chevelure. Sa zone la plus étendue la remplace : la couleur
 * choisie tombe telle quelle sur la plus grande partie, les autres en sont
 * les nuances. Les couleurs s'écrivent zone par zone : aucune clé enregistrée
 * n'en dépend. Sans mesure des parts, la référence enregistrée.
 *
 * Exportée pour le back-office : la case « C'est une ombre » d'une zone de
 * tête vaut pour tout son groupe.
 */
export function teteDuGroupe(
  groupe: GroupeCouleur,
  parts?: Readonly<Record<string, number>> | null,
): string {
  if (!parts || !groupe.nuances?.length) return groupe.zone;
  const partZone = (z: string) => {
    const p = parts[z];
    return typeof p === "number" && Number.isFinite(p) ? p : 0;
  };
  return zonesDuGroupe(groupe).reduce(
    (m, z) => (partZone(z) > partZone(m) ? z : m),
    groupe.zone,
  );
}

/**
 * La couleur la plus ÉTENDUE d'une pièce (la tête de son plus grand groupe) :
 * elle commence toujours une rangée du client, même cochée « C'est une
 * ombre » — il faut bien une couleur à suivre. Le back-office grise sa case.
 *
 * Ce n'est pas toujours la couleur PRINCIPALE (la tête de la première
 * rangée) : une famille de deux tons peut l'emporter, à eux deux, sur une
 * couleur seule plus grande que chacun d'eux.
 */
export function zoneLaPlusEtendue(piece: DessinDePiece): string | undefined {
  const groupe = groupePrincipal(
    groupesDuDessin(piece.colorZones, piece.groupesCouleurs),
    piece.partsDesZones,
  );
  return groupe ? teteDuGroupe(groupe, piece.partsDesZones) : undefined;
}

/**
 * Les FAMILLES DE TEINTE d'une pièce, la plus étendue d'abord : ce que le
 * client recolore, une rangée de pastilles par famille.
 *
 * Les dessins d'Illustrator rangent l'ombre de la calotte d'un chapeau dans
 * une zone à part, que personne n'a réunie à la calotte. Proposer une rangée
 * par zone laissait l'ombre à sa couleur d'origine : un chapeau passé au bleu
 * gardait une ombre paille, un t-shirt passé au jaune gardait des manches
 * vert foncé (note de la cliente du 6 octobre). Les OMBRES d'une couleur —
 * même famille de teinte (cf. memeFamilleDeTeinte), clarté voisine, surface
 * moindre (cf. ECART_CLARTE_OMBRE) — forment donc UN groupe avec elle : la
 * plus étendue en est la référence, les autres deviennent ses nuances et la
 * suivent. Une autre partie de la même teinte (la visière d'une casquette,
 * le revers d'un bonnet) et un détail d'une autre teinte (le ruban, les
 * manches vertes) ont leur propre rangée, avec leurs propres ombres.
 *
 * Comment : les groupes sont pris du plus étendu au plus petit (à part
 * égale, ou sans mesure, dans l'ordre du back-office). Chacun rejoint la
 * famille déjà formée dont il est une ombre — la plus proche en clarté s'il
 * y en a plusieurs —, sinon il en commence une, dont il est la référence :
 * la référence d'une famille est donc toujours sa zone la plus étendue. La
 * teinte se juge avec la référence, sans dériver de proche en proche ; la
 * clarté, avec n'importe quelle couleur de la famille, pour qu'une ombre
 * d'ombre (le dessous d'une visière) suive aussi.
 *
 * L'ordre des rangées : la famille la plus étendue d'abord (et non la zone
 * la plus étendue : une calotte peinte en deux tons l'emporte sur un ruban
 * qui serait, seul, plus grand que chacun d'eux) ; à égalité, l'ordre du
 * back-office.
 *
 * Sans mesure des parts (pièce pas encore mesurée : l'API mesure au
 * démarrage), seule la clarté décide, et la référence de chaque famille est
 * son premier groupe dans l'ordre du back-office.
 *
 * Les groupes ENREGISTRÉS ne se défont jamais : des nuances réunies à la
 * lecture du dessin, ou jadis par la boutique, restent ensemble, et le bloc
 * rejoint une famille (ou en commence une) comme une seule couleur — la
 * sienne est celle de sa référence. Avant, un seul groupe enregistré avec
 * des nuances arrêtait toute réunion sur la pièce : relire un dessin, que
 * l'aide conseillait justement, coupait le suivi des ombres.
 *
 * LA CASE « C'EST UNE OMBRE » DU BACK-OFFICE PASSE DEVANT LA LECTURE :
 *   - décochée (`separee`) : la couleur ne rejoint aucune famille, elle a sa
 *     rangée ; d'autres peuvent la rejoindre, comme ses propres ombres ;
 *   - cochée (`ombre`) : la famille qu'elle aurait commencée — elle et ses
 *     propres ombres — rejoint la famille de sa teinte la plus proche en
 *     clarté, à défaut celle de la teinte la plus proche (cf. ecartDeTeinte).
 *     La visière cochée d'une casquette emmène le dessous de la visière.
 *     Cela se décide une fois toutes les familles formées : une ombre suit
 *     une couleur PRINCIPALE, jamais une autre ombre. La couleur la plus
 *     étendue (cf. zoneLaPlusEtendue) n'est jamais une ombre.
 */
export function famillesDeLaPiece(piece: DessinDePiece): GroupeCouleur[] {
  return famillesParmi(groupesDuDessin(piece.colorZones, piece.groupesCouleurs), piece);
}

/** Les familles de teinte formées avec les groupes d'un dessin (cf. famillesDeLaPiece). */
function famillesParmi(groupes: GroupeCouleur[], piece: DessinDePiece): GroupeCouleur[] {
  const parts = piece.partsDesZones;
  const partDe = (g: GroupeCouleur) =>
    parts
      ? zonesDuGroupe(g).reduce((s, z) => {
          const p = parts[z];
          return s + (typeof p === "number" && Number.isFinite(p) ? p : 0);
        }, 0)
      : 0;
  const couleur = (z: string) => piece.colorZones?.[z] ?? "";
  // Chaque groupe enregistré prend pour référence sa zone de tête, la plus
  // étendue (cf. teteDuGroupe).
  const referencee = (g: GroupeCouleur): GroupeCouleur => {
    const tete = teteDuGroupe(g, parts);
    return tete === g.zone
      ? g
      : { ...g, zone: tete, nuances: zonesDuGroupe(g).filter((z) => z !== tete) };
  };

  // Du plus étendu au plus petit ; tri stable : à part égale, l'ordre du
  // back-office.
  const ordre = groupes
    .map(referencee)
    .map((g, rang) => ({ g, rang, part: partDe(g), clarte: clarteDe(couleur(g.zone)) }))
    .sort((a, b) => b.part - a.part || a.rang - b.rang);
  type Membre = (typeof ordre)[number];
  interface Famille {
    ref: Membre;
    part: number;
    /** Les clartés de toutes ses zones : une ombre se juge sur la plus proche. */
    clartes: number[];
    /** Les groupes qui la suivent, avec leur rang au back-office. */
    suivantes: Membre[];
  }
  const familles: Famille[] = [];
  for (const x of ordre) {
    let choisie: Famille | undefined;
    let ecartChoisi = Infinity;
    if (!x.g.separee) {
      for (const f of familles) {
        if (!memeFamilleDeTeinte(couleur(x.g.zone), couleur(f.ref.g.zone))) continue;
        const ecart = Math.min(...f.clartes.map((c) => Math.abs(x.clarte - c)));
        // Sans mesure (ou référence invisible au rendu), la clarté seule.
        const rapport = parts && f.ref.part > 0 ? x.part / f.ref.part : null;
        const ombre =
          ecart <= ECART_CLARTE_OMBRE && (rapport === null || rapport <= PART_MAX_OMBRE);
        const detail =
          rapport !== null && rapport <= PART_DETAIL && x.clarte < f.ref.clarte;
        if ((ombre || detail) && ecart < ecartChoisi) {
          choisie = f;
          ecartChoisi = ecart;
        }
      }
    }
    const clartes = zonesDuGroupe(x.g).map((z) => clarteDe(couleur(z)));
    if (choisie) {
      choisie.part += x.part;
      choisie.clartes.push(...clartes);
      choisie.suivantes.push(x);
    } else {
      familles.push({ ref: x, part: x.part, clartes, suivantes: [] });
    }
  }

  // Les couleurs cochées « C'est une ombre » par la boutique, qui avaient
  // commencé une famille : elles la versent, avec leurs propres ombres, dans
  // celle qu'elles suivront. Jamais la plus étendue (ordre[0]) : il faut une
  // couleur à suivre, et c'est elle.
  const premiere = ordre[0];
  const voulues = familles.filter((f) => f.ref.g.ombre && f.ref !== premiere);
  const cibles = familles.filter((f) => !voulues.includes(f));
  for (const f of voulues) {
    const teinte = couleur(f.ref.g.zone);
    // La famille de sa teinte la plus proche en clarté, comme une ombre que
    // la lecture aurait reconnue ; sans couleur de sa teinte, la plus proche
    // en teinte (la boutique le lit sous sa ligne).
    let cible: Famille | undefined;
    let meilleur = Infinity;
    for (const t of cibles) {
      if (!memeFamilleDeTeinte(teinte, couleur(t.ref.g.zone))) continue;
      const ecart = Math.min(...t.clartes.map((c) => Math.abs(f.ref.clarte - c)));
      if (ecart < meilleur) {
        cible = t;
        meilleur = ecart;
      }
    }
    if (!cible)
      for (const t of cibles) {
        const ecart = ecartDeTeinte(teinte, couleur(t.ref.g.zone));
        if (ecart < meilleur) {
          cible = t;
          meilleur = ecart;
        }
      }
    // `cibles` n'est jamais vide (la plus étendue y est) : ce repli ne sert
    // qu'à une couleur illisible.
    cible ??= cibles[0]!;
    cible.part += f.part;
    cible.clartes.push(...f.clartes);
    cible.suivantes.push(f.ref, ...f.suivantes);
  }

  return cibles
    .sort((a, b) => b.part - a.part || a.ref.rang - b.ref.rang)
    .map(({ ref, suivantes }) => {
      // La rangée reprend le groupe de tête tel quel — son nom, sa liste
      // propre de couleurs — : c'est la ligne du back-office que la boutique
      // règle. Celles des ombres ne servent pas. Une case « ombre » restée
      // sur la plus étendue ne dit rien de la rangée : elle n'y paraît pas.
      let tete = ref.g;
      if (tete.ombre) {
        tete = { ...tete };
        delete tete.ombre;
      }
      // Les nuances dans l'ordre du back-office, comme ses lignes.
      const zones = suivantes
        .sort((a, b) => a.rang - b.rang)
        .flatMap((s) => zonesDuGroupe(s.g));
      return zones.length ? { ...tete, nuances: [...(tete.nuances ?? []), ...zones] } : tete;
    });
}

/**
 * La couleur principale d'une pièce, AVEC SES OMBRES : sa première rangée de
 * pastilles, et la couleur qui passe d'une pièce à l'autre (cf.
 * couleursAuChangementDePiece, dans le configurateur).
 *
 * C'est la première des familles de la pièce (cf. famillesDeLaPiece) : la
 * famille la plus étendue, sa zone la plus étendue en référence, ses ombres
 * en nuances.
 */
export function principaleDeLaPiece(piece: DessinDePiece): GroupeCouleur | undefined {
  return famillesDeLaPiece(piece)[0];
}

/**
 * Les rangées de pastilles d'une pièce dans le module, dans l'ordre : TOUTES
 * ses familles de teinte, chacune avec ses ombres (cf. famillesDeLaPiece).
 *
 * « Le client peut changer toutes les couleurs en fait » (19 et 20 octobre
 * 2026). Il n'y a plus d'exception : ni la règle de la catégorie (« seulement
 * la couleur principale », cf. COULEURS_PROPOSEES), ni les anciennes cases
 * « Le client peut la changer » d'une pièce (`asset.zones_masquees`, gardée
 * en base mais plus lue) ne retirent de rangée. Ce que la boutique règle
 * encore, c'est QUELLE couleur est une ombre (« C'est une ombre ») et, pour
 * chaque rangée, les pastilles proposées (GroupeCouleur.couleurs).
 */
export function groupesProposesDeLaPiece(piece: DessinDePiece): GroupeCouleur[] {
  return famillesDeLaPiece(piece);
}

/**
 * La case « C'est une ombre » d'une couleur de pièce, cochée (`ombre`) ou
 * décochée, au back-office : les groupes de la pièce après ce geste.
 *
 * LE CHOIX DE LA BOUTIQUE N'EST ÉCRIT QUE S'IL CONTREDIT LA LECTURE DU
 * DESSIN. La case revient-elle à ce que la lecture donnerait sans réglage sur
 * ce groupe ? Le drapeau s'efface, au lieu d'en écrire l'inverse. Avant,
 * décocher puis recocher laissait pour toujours `ombre: true` sur une couleur
 * que la lecture voyait déjà comme une ombre : l'écran et le site étaient les
 * mêmes, mais la pièce gardait un réglage « à la main » que rien ne
 * permettait d'effacer, et qu'une relecture du dessin reprenait.
 *
 *   - Une couleur en tête de son groupe (la plupart : une zone seule) : la
 *     case vaut pour tout son groupe — `ombre` cochée, `separee` décochée —,
 *     seulement si la lecture dit le contraire.
 *   - Décochée sur une zone qu'une relecture a réunie à d'autres dans un même
 *     groupe enregistré : elle en sort, groupe à elle, juste après — avec
 *     `separee` seulement si la lecture la remettrait sinon dans une famille.
 *   - La couleur la plus étendue n'est jamais une ombre (cf.
 *     famillesDeLaPiece) : la cocher ne change rien, et rien ne s'écrit.
 *
 * Pure, sans navigateur : le back-office l'appelle, les essais la vérifient.
 */
export function reglerOmbre(
  piece: DessinDePiece,
  zone: string,
  ombre: boolean,
): GroupeCouleur[] {
  // Des copies : l'appelant garde ses groupes tels quels.
  const groupes = groupesDuDessin(piece.colorZones, piece.groupesCouleurs).map((g) => ({
    ...g,
    ...(g.nuances ? { nuances: [...g.nuances] } : {}),
  }));
  const i = groupes.findIndex((g) => zonesDuGroupe(g).includes(zone));
  const g = groupes[i];
  if (!g) return groupes;
  /** Cette zone suit-elle une autre couleur, avec ces groupes-là ? */
  const suit = () => {
    const rangee = famillesDeLaPiece({ ...piece, groupesCouleurs: groupes }).find((r) =>
      zonesDuGroupe(r).includes(zone),
    );
    return !!rangee && rangee.zone !== zone;
  };

  if (ombre || teteDuGroupe(g, piece.partsDesZones) === zone) {
    delete g.ombre;
    delete g.separee;
    if (suit() === ombre) return groupes;
    if (ombre) g.ombre = true;
    else g.separee = true;
    // Sans effet (la plus étendue cochée) : rien à écrire.
    if (suit() !== ombre) {
      delete g.ombre;
      delete g.separee;
    }
    return groupes;
  }

  const reste = zonesDuGroupe(g).filter((m) => m !== zone);
  g.zone = reste[0]!;
  if (reste.length > 1) g.nuances = reste.slice(1);
  else delete g.nuances;
  const seule: GroupeCouleur = { zone };
  groupes.splice(i + 1, 0, seule);
  if (suit()) seule.separee = true;
  return groupes;
}

/** Ce qu'un clic sur « C'est une ombre » a changé, rangées du client à l'appui (cf. bilanDeLOmbre). */
export interface BilanDeLOmbre {
  /** Après le geste, la couleur cliquée est-elle une ombre (elle suit une partie) ? */
  ombre: boolean;
  /** Le numéro, APRÈS le geste, de la rangée où elle se trouve (1 : la principale). */
  rangee: number;
  /** Si c'est une ombre : la tête de la rangée qu'elle suit. */
  suit?: string;
  /** Les AUTRES couleurs devenues des parties à part, avec leur numéro d'après. */
  parties: { zone: string; rangee: number }[];
  /**
   * Les AUTRES couleurs qui suivent maintenant une autre partie qu'avant :
   * parties devenues ombres (`avant: "partie"`), ou ombres passées d'une
   * partie à l'autre (`avant: "ombre"`).
   */
  ombres: { zone: string; suit: string; rangee: number; avant: "partie" | "ombre" }[];
}

/**
 * Le bilan d'un clic sur la case « C'est une ombre », d'après les rangées du
 * client avant et après (famillesDeLaPiece) : ce que le message du
 * back-office doit dire.
 *
 * TOUS LES NUMÉROS SONT CEUX D'APRÈS LE GESTE, ceux que la boutique lit à
 * l'écran quand le message paraît. Les rangées venant d'être refaites, le
 * message mêlait les deux : « Partie 2 est maintenant une ombre : elle suit
 * la partie 2 » — la ligne cliquée sous son numéro d'avant, la partie suivie
 * sous son numéro d'après (casquette 401).
 *
 * UN CLIC PEUT EN DÉPLACER D'AUTRES. Une ombre se juge sur la couleur la plus
 * proche de sa famille (une ombre d'ombre, cf. famillesDeLaPiece) : décocher
 * une ombre peut libérer celle qui ne suivait la partie qu'à travers elle
 * (casquette 486 : décocher le bleu st5 fait aussi du bleu nuit st6 une
 * partie), et cocher une partie emmène ses propres ombres (t-shirt 421 : le
 * liseré suit les manches cochées). L'écran se redessine, mais la boutique
 * n'a touché qu'une case : le message doit nommer les autres.
 */
export function bilanDeLOmbre(
  avant: readonly GroupeCouleur[],
  apres: readonly GroupeCouleur[],
  zone: string,
): BilanDeLOmbre {
  const ou = (rangees: readonly GroupeCouleur[], z: string) => {
    const i = rangees.findIndex((r) => zonesDuGroupe(r).includes(z));
    return i < 0 ? null : { i, tete: rangees[i]!.zone };
  };
  const sienne = ou(apres, zone);
  const bilan: BilanDeLOmbre = {
    ombre: !!sienne && sienne.tete !== zone,
    rangee: sienne ? sienne.i + 1 : 0,
    ...(sienne && sienne.tete !== zone ? { suit: sienne.tete } : {}),
    parties: [],
    ombres: [],
  };
  // Les autres couleurs dans l'ordre des rangées d'après, comme l'écran.
  for (const z of apres.flatMap(zonesDuGroupe)) {
    if (z === zone) continue;
    const a = ou(avant, z);
    const b = ou(apres, z);
    if (!a || !b) continue;
    const etaitPartie = a.tete === z;
    const estPartie = b.tete === z;
    if (estPartie && !etaitPartie) bilan.parties.push({ zone: z, rangee: b.i + 1 });
    else if (!estPartie && (etaitPartie || a.tete !== b.tete))
      bilan.ombres.push({
        zone: z,
        suit: b.tete,
        rangee: b.i + 1,
        avant: etaitPartie ? "partie" : "ombre",
      });
  }
  return bilan;
}

/**
 * Pourquoi une ombre suit une partie d'une AUTRE teinte que la sienne — ce
 * que sa ligne en dit au back-office. `null` : elle a la teinte de sa partie
 * (le cas ordinaire), ce n'est pas une ombre, ou rien de sûr à dire.
 *
 *   - « reglage » : un groupe enregistré la réunit à d'autres couleurs, dont
 *     elle n'est pas la tête ; c'est lui qui l'emmène, quelle que soit sa
 *     teinte. Le t-shirt 421 en prod : ses manches vertes, réunies jadis au
 *     corps beige, alors qu'une partie verte (le liseré) existe juste dessous.
 *   - « plus-proche » : cochée « C'est une ombre » sans qu'aucune partie ait
 *     sa teinte, elle suit la plus proche (cf. famillesDeLaPiece).
 *
 * Avant, l'écran disait « Aucune partie n'a sa teinte » dès que l'ombre
 * n'avait pas celle de SA partie, sans regarder les autres : c'était faux sur
 * la 421, et la boutique ne pouvait pas savoir qu'il suffisait de décocher.
 */
export function ombreDAutreTeinte(
  piece: DessinDePiece,
  zone: string,
): "reglage" | "plus-proche" | null {
  const couleur = (z: string) => piece.colorZones?.[z] ?? "";
  const rangees = famillesDeLaPiece(piece);
  const rangee = rangees.find((r) => zonesDuGroupe(r).includes(zone));
  if (!rangee || rangee.zone === zone) return null;
  if (memeFamilleDeTeinte(couleur(zone), couleur(rangee.zone))) return null;
  const sien = groupesDuDessin(piece.colorZones, piece.groupesCouleurs).find((g) =>
    zonesDuGroupe(g).includes(zone),
  );
  if (sien && zonesDuGroupe(sien).length > 1 && teteDuGroupe(sien, piece.partsDesZones) !== zone)
    return "reglage";
  return rangees.some((r) => memeFamilleDeTeinte(couleur(zone), couleur(r.zone)))
    ? null
    : "plus-proche";
}

/* -------------------------------------------------------------------------- */
/*  Couleurs à dessiner                                                        */
/* -------------------------------------------------------------------------- */

/*
 * Les deux fonctions qui suivent disent, zone par zone, de quelle couleur
 * dessiner une couche. L'aperçu de la boutique ET le fichier d'impression
 * passent par elles : ils ne peuvent pas se contredire.
 */

/**
 * Les couleurs à appliquer à UNE pièce portée : ses couleurs par défaut,
 * surchargées par celles du personnage pour son emplacement (cf.
 * {@link colorsForScope}). Zone par zone, telles que la configuration les
 * porte.
 *
 * Plus aucune zone n'est forcée à sa couleur par défaut. Jusqu'au 20 octobre
 * 2026, les groupes décochés au back-office (`asset.zones_masquees`, « Le
 * client peut la changer ») la reprenaient d'office ; le client peut
 * désormais changer toutes les couleurs, il fallait que l'aperçu et le papier
 * montrent son choix. Une commande passée avant ne bouge pas : le
 * configurateur écrit toutes les couleurs du dessin en choisissant la pièce
 * (couleursAuChangementDePiece), et une zone que le client ne pouvait pas
 * changer y porte donc la couleur du dessin du jour de la commande — celle
 * que le défaut forcé redonnait, tant que la boutique n'a pas changé ce
 * défaut depuis (et s'il a changé, c'est l'ancienne, que le client a vue).
 */
export function couleursDeLaPiece(
  colors: Record<string, string> | undefined | null,
  slot: string,
  piece: DessinDePiece,
): Record<string, string> {
  return { ...(piece.colorZones ?? {}), ...colorsForScope(colors, slot) };
}

/**
 * Les couleurs du dessin de BASE d'un personnage : les couleurs par défaut
 * réglées au back-office, surchargées par celles de la configuration.
 *
 * L'impression appliquait déjà ces couleurs par défaut, l'aperçu non : une
 * couleur changée au back-office (une robe passée du bleu au vert) partait
 * à l'imprimante sans que la boutique l'ait jamais montrée.
 *
 * Les groupes NON proposés ne sont pas forcés à leur défaut, contrairement à
 * ceux d'une pièce : jusqu'ici seule la première zone d'un personnage était
 * proposée, et les paniers ont enregistré les autres — une copie des défauts
 * du jour. Les forcer changerait des affiches déjà commandées dès qu'une
 * couleur par défaut a bougé depuis. Le client, lui, ne peut pas les changer :
 * elles restent celles de la boutique.
 */
export function couleursDeLaBase(
  colors: Record<string, string> | undefined | null,
  base: DessinDeBase | null | undefined,
): Record<string, string> {
  return {
    ...(base?.baseColorZones ?? {}),
    ...colorsForScope(colors, BASE_COLOR_SCOPE),
  };
}

/* -------------------------------------------------------------------------- */
/*  Remettre les couleurs d'origine                                            */
/* -------------------------------------------------------------------------- */

/**
 * Le client a-t-il changé une couleur de cette couche (`scope` : un
 * emplacement, ou le dessin de base) ? C'est ce qui fait paraître, dans
 * l'éditeur de personnage, le bouton « Remettre les couleurs d'origine » —
 * absent tant que rien n'a changé.
 *
 * `defauts` dit, zone par zone (« st3 », ou la clé d'une famille en pixels),
 * la couleur d'origine du dessin. Chaque clé de la configuration qui
 * appartient à la couche est comparée à la sienne, à l'écriture près
 * (« #f2d08d » vaut « #F2D08D ») ; une clé sans défaut connu — famille en
 * pixels choisie, zone disparue d'un vieux panier — compte comme changée :
 * on ne peut pas dire qu'elle est d'origine.
 *
 * Les conséquences voulues : une pièce qu'on vient de choisir porte les
 * couleurs de son dessin, pas de bouton ; une couleur principale reportée de
 * la pièce d'avant est un vrai choix du client, bouton ; une ombre qui a
 * suivi une couleur choisie a changé avec elle, bouton. Les clés plates
 * d'avant le namespacing (sans « : ») sont ignorées, comme partout.
 *
 * Vit ici, et non dans le configurateur : pure, sans Solid, elle s'essaie
 * telle quelle (tests/couleurs-familles.test.ts).
 */
export function couleursChangees(
  colors: Record<string, string> | undefined | null,
  scope: string,
  defauts: Record<string, string> | undefined | null,
): boolean {
  const prefixe = colorKey(scope, "");
  for (const [cle, hex] of Object.entries(colors ?? {})) {
    if (!cle.startsWith(prefixe)) continue;
    const defaut = defauts?.[cle.slice(prefixe.length)];
    if (!defaut || !memeCouleur(hex, defaut)) return true;
  }
  return false;
}
