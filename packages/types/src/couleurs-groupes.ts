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

/** Nuanciers qu'un groupe du dessin de BASE d'un personnage peut proposer. */
export const NUANCIERS_BASE = ["peau", "cheveux", "vetements", "pantalon"] as const;
export type NuancierBase = (typeof NUANCIERS_BASE)[number];

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
  nuancier?: NuancierBase;
}

/** Longueur maximale d'un nom de groupe : il tient sur une ligne de l'éditeur. */
export const NOM_GROUPE_MAX = 40;

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
      const nuancier = (NUANCIERS_BASE as readonly unknown[]).includes(g.nuancier)
        ? (g.nuancier as NuancierBase)
        : undefined;
      out.push({
        zone,
        ...(nuances.length ? { nuances } : {}),
        ...(nom ? { nom } : {}),
        ...(nuancier ? { nuancier } : {}),
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

/** Ce qu'il faut savoir d'une pièce pour ses couleurs. */
export interface DessinDePiece {
  colorZones?: Record<string, string> | null;
  /**
   * Le réglage PROPRE à la pièce : les zones de référence des groupes que le
   * client ne peut pas changer (cases « Proposée au client » du back-office).
   * Une liste, même vide, a le dernier mot sur la catégorie ; `null` (ou
   * absent) : la pièce suit le réglage de sa catégorie.
   */
  zonesMasquees?: readonly string[] | null;
  groupesCouleurs?: unknown;
  /**
   * La part du dessin que peint chaque zone (0 à 1), mesurée par l'API sur un
   * rendu de la pièce : c'est elle qui désigne la couleur principale. Absente
   * (pas encore mesurée), la principale est le premier groupe.
   */
  partsDesZones?: Readonly<Record<string, number>> | null;
}

/* -------------------------------------------------------------------------- */
/*  Couleurs proposées : la règle de la catégorie                              */
/* -------------------------------------------------------------------------- */

/**
 * Ce qu'une catégorie de pièces propose au client, pour chacune de ses
 * pièces qui n'a pas son propre réglage :
 *   - « toutes » : une rangée de pastilles par couleur de la pièce — la seule
 *     règle avant ce réglage ;
 *   - « principale » : la couleur principale seulement, ombres comprises
 *     (cf. principaleDeLaPiece). Les détails — ruban d'un chapeau, verres
 *     d'une paire de lunettes — gardent la couleur du dessin. C'est la règle
 *     par défaut depuis la migration 0066 : la cliente l'a demandée pour
 *     toutes les pièces des personnages.
 *
 * La cliente masquait le ruban pièce par pièce ; un seul réglage par
 * catégorie suffit désormais. Une pièce qui a ses propres cases garde le
 * dernier mot : un vêtement à deux couleurs principales reste à deux.
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
 * La boutique a-t-elle RÉUNI elle-même des couleurs de la pièce (« Rattacher
 * à… » au back-office) ? Des groupes d'une seule zone ne réunissent rien : le
 * back-office en enregistre dès qu'on touche une case, sans rien vouloir dire
 * sur les ombres.
 */
function regroupeeParLaBoutique(piece: DessinDePiece): boolean {
  return (
    Array.isArray(piece.groupesCouleurs) &&
    piece.groupesCouleurs.some(
      (g) =>
        !!g &&
        typeof g === "object" &&
        Array.isArray((g as { nuances?: unknown }).nuances) &&
        ((g as { nuances: unknown[] }).nuances.length ?? 0) > 0,
    )
  );
}

/**
 * La couleur principale d'une pièce, AVEC SES OMBRES : ce que le client
 * recolore quand la catégorie ne propose que la principale.
 *
 * Les dessins d'Illustrator rangent l'ombre de la calotte d'un chapeau dans
 * une zone à part, que personne n'a réunie à la calotte. Proposer la calotte
 * seule laissait l'ombre à sa couleur d'origine : un chapeau passé au bleu
 * gardait une ombre paille. Les zones de la même famille de teinte que la
 * principale deviennent donc ses nuances, et la suivent ; un détail d'une
 * autre teinte (le ruban) garde la sienne.
 *
 * La principale est celle de la FAMILLE la plus étendue, et non de la zone la
 * plus étendue : une calotte peinte en deux tons l'emporte sur un ruban qui
 * serait, seul, plus grand que chacun d'eux.
 *
 * Quand la boutique a réuni elle-même les couleurs, son regroupement fait foi
 * et rien n'est deviné (cf. groupePrincipal).
 */
export function principaleDeLaPiece(piece: DessinDePiece): GroupeCouleur | undefined {
  const groupes = groupesDuDessin(piece.colorZones, piece.groupesCouleurs);
  const parts = piece.partsDesZones;
  if (!parts || regroupeeParLaBoutique(piece)) return groupePrincipal(groupes, parts);
  const couleur = (g: GroupeCouleur) => piece.colorZones?.[g.zone] ?? "";
  const partDe = (g: GroupeCouleur) =>
    zonesDuGroupe(g).reduce((s, z) => {
      const p = parts[z];
      return s + (typeof p === "number" && Number.isFinite(p) ? p : 0);
    }, 0);
  const familleDe = (g: GroupeCouleur) =>
    groupes.filter((h) => h === g || memeFamilleDeTeinte(couleur(h), couleur(g)));

  let principal: GroupeCouleur | undefined;
  let meilleure = -1;
  let meilleurePropre = -1;
  for (const g of groupes) {
    const famille = familleDe(g).reduce((s, h) => s + partDe(h), 0);
    const propre = partDe(g);
    // La famille la plus étendue ; dans la famille, la zone la plus étendue
    // devient la référence. À égalité stricte, le premier groupe.
    if (famille > meilleure || (famille === meilleure && propre > meilleurePropre)) {
      meilleure = famille;
      meilleurePropre = propre;
      principal = g;
    }
  }
  if (!principal) return undefined;
  const ref = principal;
  const suivantes = familleDe(ref)
    .filter((h) => h !== ref)
    .flatMap(zonesDuGroupe);
  return suivantes.length
    ? { ...ref, nuances: [...(ref.nuances ?? []), ...suivantes] }
    : ref;
}

/**
 * Les groupes d'une pièce que le client peut recolorer, dans l'ordre.
 *
 * - Réglage propre à la pièce (`zonesMasquees` est une liste) : tous les
 *   groupes sauf ceux qu'il masque. Il a toujours le dernier mot.
 * - Sinon, la règle de sa catégorie : la couleur principale seule (ombres
 *   comprises, cf. principaleDeLaPiece), ou toutes. Sans catégorie (ou
 *   catégorie archivée, décochée), toutes.
 */
export function groupesProposesDeLaPiece(
  piece: DessinDePiece,
  regle?: CouleursProposees | null,
): GroupeCouleur[] {
  const groupes = groupesDuDessin(piece.colorZones, piece.groupesCouleurs);
  if (Array.isArray(piece.zonesMasquees)) {
    const masquees = piece.zonesMasquees;
    return groupes.filter((g) => !masquees.includes(g.zone));
  }
  if (regle === "principale") {
    const principal = principaleDeLaPiece(piece);
    return principal ? [principal] : [];
  }
  return groupes;
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
 * {@link colorsForScope}), sauf sur les groupes que la boutique ne propose
 * pas au client (`zonesMasquees`, réglées au back-office).
 *
 * Un groupe masqué reprend TOUJOURS les couleurs par défaut de la pièce —
 * référence et nuances —, même si la configuration en porte d'autres : un
 * panier rempli avant que le groupe soit décoché garde sa couleur en mémoire,
 * et le client n'aurait plus aucun moyen de la changer.
 *
 * SEULES LES CASES DE LA PIÈCE forcent ainsi le défaut. Un groupe que sa
 * CATÉGORIE ne propose pas (« seulement la couleur principale ») se dessine
 * avec la couleur enregistrée : le configurateur écrit toutes les couleurs du
 * dessin quand on choisit la pièce (couleursAuChangementDePiece), et une
 * commande passée avant ce réglage s'imprime exactement comme avant.
 *
 * Sans couleur par défaut connue pour une zone, on retire simplement la
 * surcharge : le dessin garde la couleur écrite dans son fichier.
 */
export function couleursDeLaPiece(
  colors: Record<string, string> | undefined | null,
  slot: string,
  piece: DessinDePiece,
): Record<string, string> {
  const out = { ...(piece.colorZones ?? {}), ...colorsForScope(colors, slot) };
  // Garde-fou : une donnée mal formée ne doit jamais empêcher de dessiner.
  const masquees = new Set(
    Array.isArray(piece.zonesMasquees) ? piece.zonesMasquees : [],
  );
  for (const g of groupesDuDessin(piece.colorZones, piece.groupesCouleurs))
    if (masquees.has(g.zone)) for (const z of zonesDuGroupe(g)) masquees.add(z);
  for (const zone of masquees) {
    const defaut = piece.colorZones?.[zone];
    if (defaut) out[zone] = defaut;
    else delete out[zone];
  }
  return out;
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
