/**
 * Le ciel étoilé d'un soir (26/11, Alexandra : « fais le 5 aussi », puis
 * « le nouveau produit étoilé il faudrait le mettre en non visible sur le
 * site, je montrerais à margaux »).
 *
 * La cliente donne une date, une heure et une ville ; on calcule le ciel tel
 * qu'il était au-dessus d'elle à cet instant, et on en fait le FOND d'une
 * affiche : une carte du ciel ronde, des collines en bas où se tiendront ses
 * personnages (vus de dos, ils regardent le ciel), de la place en haut pour
 * ses textes.
 *
 * Ce fond est rangé exactement comme une affiche tirée d'une photo (table
 * ai_generation, aperçu filigrané, pleine définition) : tout ce qui suit —
 * textes, personnages, format, panier, paiement, fichier d'impression — est
 * celui des affiches IA, sans une ligne de plus. Coût : zéro, rien ne part
 * chez OpenAI ; modèle « ciel ».
 *
 * Calcul : temps sidéral de Greenwich (formule de l'IAU, Meeus ch. 12), angle
 * horaire, hauteur et azimut de chaque étoile, puis projection stéréographique
 * centrée sur le zénith — l'horizon fait le bord du cercle, le nord en haut,
 * l'est à GAUCHE (on regarde le ciel au-dessus de soi, pas une carte posée
 * par terre). La précession entre l'époque du catalogue (J2000) et la date est
 * négligée : moins d'un tiers de degré sur cinquante ans, invisible ici.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Context, Hono } from "hono";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db, schema } from "./db/client.js";
import { CONSTELLATIONS, ETOILES } from "./ciel-donnees.js";
import {
  LANGUES_CIEL,
  dateEcrite,
  defsDuSigne,
  dessinDuSigne,
  estUnSigne,
  petiteEtoile,
  signeDeLaDate,
  type IdSigne,
  type LangueCiel,
} from "./ciel-signes.js";
import { poserSilhouettes } from "./ciel-silhouettes.js";
import { SILHOUETTES_ASSISES, SILHOUETTES_ASSISES_PAR_ID } from "./ciel-silhouettes-assises.js";

/**
 * La vignette d'une silhouette assise seule, par id (27/11, pour les boutons du
 * site) : un <svg> complet, cadré sur elle, de la couleur demandée. null si
 * l'id est inconnu.
 */
export function svgDeLaSilhouette(id: string, couleur = "#2b2b2b"): string | null {
  const s = SILHOUETTES_ASSISES_PAR_ID.get(id);
  if (!s) return null;
  const l = s.droite - s.gauche;
  const h = -s.haut + 4;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${s.gauche - 2} ${s.haut - 2} ${l + 4} ${h}"><path fill="${couleur}" d="${s.d}"/></svg>`;
}
import { IA_DIR, MODELE_CIEL, fabriquerApercu, ipDeLaRequete } from "./ia.js";
import { clientDeLaRequete } from "./comptes.js";

/** Hauteur du centre de la carte, en fraction de l'image (le filigrane s'y cale). */
export const CENTRE_Y_CIEL = 0.55;

/** Taille du fond : un A4 à 300 points par pouce, le rapport des A (√2). */
export const LARGEUR_CIEL = 2480;
export const HAUTEUR_CIEL = 3508;

const RAD = Math.PI / 180;

/** Jour julien d'un instant. */
export function jourJulien(date: Date): number {
  return date.getTime() / 86_400_000 + 2_440_587.5;
}

/** Temps sidéral moyen de Greenwich, en degrés (0–360). */
export function tempsSideralGreenwich(date: Date): number {
  const jd = jourJulien(date);
  const t = (jd - 2_451_545) / 36_525;
  const deg =
    280.46061837 +
    360.98564736629 * (jd - 2_451_545) +
    0.000387933 * t * t -
    (t * t * t) / 38_710_000;
  return ((deg % 360) + 360) % 360;
}

/**
 * Hauteur et azimut (degrés ; azimut compté du nord vers l'est) d'un astre
 * d'ascension droite `ra` et de déclinaison `dec`, vu de `lat`/`lon` à `date`.
 */
export function horizontales(
  ra: number,
  dec: number,
  lat: number,
  lon: number,
  date: Date,
): { hauteur: number; azimut: number } {
  const h = (tempsSideralGreenwich(date) + lon - ra) * RAD;
  const d = dec * RAD;
  const p = lat * RAD;
  const sinAlt = Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(h);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const az = Math.atan2(
    -Math.sin(h) * Math.cos(d),
    Math.cos(p) * Math.sin(d) - Math.sin(p) * Math.cos(d) * Math.cos(h),
  );
  return { hauteur: alt / RAD, azimut: ((az / RAD) % 360 + 360) % 360 };
}

/**
 * Position sur la carte ronde (rayon 1 = l'horizon), ou null sous l'horizon.
 * Nord en haut, est à gauche.
 */
export function surLaCarte(hauteur: number, azimut: number): { x: number; y: number } | null {
  if (hauteur < 0) return null;
  const r = Math.tan(((90 - hauteur) / 2) * RAD); // stéréographique, 1 à l'horizon
  return { x: -r * Math.sin(azimut * RAD), y: -r * Math.cos(azimut * RAD) };
}

/**
 * Décalage (minutes) d'un fuseau IANA à un instant donné : ce qu'il faut
 * ajouter au temps universel pour lire l'heure locale.
 */
function decalageMinutes(fuseau: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: fuseau,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const v = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const local = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second"));
  return Math.round((local - instant.getTime()) / 60_000);
}

/**
 * L'instant universel d'une date et d'une heure LOCALES dans un fuseau
 * (« 2019-06-12 », « 22:30 », « Europe/Paris »). Null si quelque chose ne se
 * lit pas.
 */
export function instantLocal(date: string, heure: string, fuseau: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const h = /^(\d{2}):(\d{2})$/.exec(heure);
  if (!d || !h) return null;
  const [an, mois, jour, hh, mm] = [d[1], d[2], d[3], h[1], h[2]].map(Number) as [
    number, number, number, number, number,
  ];
  if (mois < 1 || mois > 12 || jour < 1 || jour > 31 || hh > 23 || mm > 59) return null;
  const naif = Date.UTC(an, mois - 1, jour, hh, mm);
  try {
    // Deux passes : le décalage peut changer autour de l'heure d'été.
    let t = naif - decalageMinutes(fuseau, new Date(naif)) * 60_000;
    t = naif - decalageMinutes(fuseau, new Date(t)) * 60_000;
    const instant = new Date(t);
    return Number.isNaN(instant.getTime()) ? null : instant;
  } catch {
    return null; // fuseau inconnu
  }
}

/** Échappe un texte pour le SVG. */
function enSvg(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Sous le cercle : les coordonnées, et, si la cliente l'a coché, le nom de
 * la ville au-dessus d'elles (27/11, Alexandra : « afficher la ville case à
 * cocher, faut l'afficher à un endroit sympa joliment »). La ville en
 * capitales espacées, dans la serif des titres, couleur des dorures ; les
 * coordonnées passent dessous, plus discrètes. Sans ville : comme avant.
 */
function legendeDuLieu(
  ville: string | null,
  cx: number,
  basCercle: number,
  dorures: string,
  coords: string,
): string {
  const nom = (ville ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 40);
  if (!nom)
    return `<text x="${cx}" y="${basCercle + 180}" text-anchor="middle" font-family="League Spartan, DejaVu Sans, sans-serif" font-size="44" fill="${dorures}" fill-opacity="0.85" letter-spacing="3">${coords}</text>`;
  return (
    `<text x="${cx}" y="${basCercle + 175}" text-anchor="middle" font-family="DM Serif Display, serif" font-size="76" fill="${dorures}" letter-spacing="14">${enSvg(nom.toLocaleUpperCase("fr-FR"))}</text>` +
    `<text x="${cx}" y="${basCercle + 245}" text-anchor="middle" font-family="League Spartan, DejaVu Sans, sans-serif" font-size="38" fill="${dorures}" fill-opacity="0.7" letter-spacing="3">${coords}</text>`
  );
}

/** Une coordonnée lisible : « 47,75° N · 7,34° E ». */
function coordonnees(lat: number, lon: number): string {
  const f = (v: number) => Math.abs(v).toFixed(2).replace(".", ",");
  return `${f(lat)}° ${lat >= 0 ? "N" : "S"}   ·   ${f(lon)}° ${lon >= 0 ? "E" : "O"}`;
}

/* ------------------------------------------------------------------------ *
 * Les thèmes de couleur (27/11, Alexandra : « pouvoir modifier les couleurs
 * du fond !!! créer des thèmes et margaux pourra en créer aussi (ça modifie
 * chaque couleur avec le dégradé comme il faut) »).
 *
 * Un thème, c'est TROIS couleurs choisies : le fond, les étoiles, les
 * dorures (anneau, points cardinaux, coordonnées). Tout le reste en découle,
 * toujours dans les mêmes proportions que le thème « Nuit » d'origine : le
 * dégradé du ciel (plus sombre en haut, un peu plus clair à l'horizon), le
 * dôme de la carte, les deux collines, le trait des constellations. Changer
 * le fond change donc chaque teinte « comme il faut », sans dix couleurs à
 * accorder à la main.
 *
 * Rangés dans le réglage `ciel.themes` (BO › Ciel étoilé). Absent ou vide :
 * les thèmes de base ci-dessous.
 * ------------------------------------------------------------------------ */
export interface ThemeCiel {
  id: string;
  nom: string;
  fond: string;
  etoiles: string;
  dorures: string;
  /** Proposé aux clientes ; un thème décoché reste au BO. */
  actif?: boolean;
}

export const REGLAGE_THEMES_CIEL = "ciel.themes";

export const THEMES_CIEL_DE_BASE: ThemeCiel[] = [
  { id: "nuit", nom: "Nuit", fond: "#16243d", etoiles: "#fbf7ec", dorures: "#d9c38f", actif: true },
  { id: "encre", nom: "Encre", fond: "#101114", etoiles: "#f5f2ea", dorures: "#c9b48a", actif: true },
  { id: "sapin", nom: "Sapin", fond: "#1d3a33", etoiles: "#f6f1e4", dorures: "#d6b97c", actif: true },
  { id: "bordeaux", nom: "Bordeaux", fond: "#4a1f2a", etoiles: "#fbefe6", dorures: "#e0b98a", actif: true },
  // Le thème de la nuit de Noël (27/11, Alexandra : « On y ajoute un thème rouge et or. ») :
  // rouge profond, anneau or — essayé sur le ciel du 24/12 à Mulhouse.
  { id: "noel", nom: "Noël", fond: "#7c1420", etoiles: "#fff6e5", dorures: "#e9c56b", actif: true },
  { id: "rose", nom: "Rose poudré", fond: "#9e6871", etoiles: "#fffaf5", dorures: "#fff1dc", actif: true },
  { id: "creme", nom: "Crème", fond: "#efe6d6", etoiles: "#22304a", dorures: "#a8834a", actif: true },
];

const HEX = /^#[0-9a-f]{6}$/i;

/** Une couleur #rrggbb, ou le repli. */
function couleurSure(v: unknown, repli: string): string {
  const t = String(v ?? "").trim();
  return HEX.test(t) ? t.toLowerCase() : repli;
}

/** Un thème lu au réglage, rendu sûr (couleurs valides, nom borné). */
export function themeSur(brut: unknown, rang = 0): ThemeCiel | null {
  if (!brut || typeof brut !== "object") return null;
  const b = brut as Record<string, unknown>;
  const nom = String(b.nom ?? "").trim().slice(0, 40);
  if (!nom) return null;
  const id =
    String(b.id ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 40) || `theme-${rang + 1}`;
  const base = THEMES_CIEL_DE_BASE[0]!;
  return {
    id,
    nom,
    fond: couleurSure(b.fond, base.fond),
    etoiles: couleurSure(b.etoiles, base.etoiles),
    dorures: couleurSure(b.dorures, base.dorures),
    actif: b.actif !== false,
  };
}

/** Les thèmes tels que réglés (tous), ou ceux de base. */
export function themesDuReglage(valeur: unknown): ThemeCiel[] {
  if (!Array.isArray(valeur)) return THEMES_CIEL_DE_BASE;
  const vus = new Set<string>();
  const liste: ThemeCiel[] = [];
  valeur.forEach((t, i) => {
    const th = themeSur(t, i);
    if (th && !vus.has(th.id)) {
      vus.add(th.id);
      liste.push(th);
    }
  });
  return liste.length ? liste : THEMES_CIEL_DE_BASE;
}

/** Mélange deux couleurs #rrggbb : `part` de `vers` dans `de`. */
export function melange(de: string, vers: string, part: number): string {
  const a = [1, 3, 5].map((i) => parseInt(de.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => parseInt(vers.slice(i, i + 2), 16));
  return (
    "#" +
    a
      .map((x, i) => Math.round(x + (b[i]! - x) * part))
      .map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, "0"))
      .join("")
  );
}

/** Clarté perçue (0 noir, 1 blanc). */
function clarte(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Toutes les teintes d'un thème, tirées de ses trois couleurs. Les parts de
 * noir et de blanc reproduisent le thème « Nuit » d'origine (#0b1424 en haut,
 * #16243d, #1f3050 à l'horizon…). Sur un fond clair (« Crème »), le haut
 * fonce à peine : un ciel crème qui vire au gris en haut serait sale.
 */
export function teintesDuTheme(t: Pick<ThemeCiel, "fond" | "etoiles" | "dorures">) {
  const clair = clarte(t.fond) > 0.55;
  const noir = "#000000";
  const blanc = "#ffffff";
  return {
    haut: melange(t.fond, noir, clair ? 0.06 : 0.45),
    milieu: t.fond,
    horizon: melange(t.fond, blanc, clair ? 0.25 : 0.1),
    domeCentre: melange(t.fond, blanc, clair ? 0.2 : 0.07),
    domeBord: melange(t.fond, noir, clair ? 0.04 : 0.18),
    collineLoin: melange(t.fond, noir, clair ? 0.12 : 0.3),
    collinePres: melange(t.fond, noir, clair ? 0.22 : 0.55),
    constellations: melange(t.etoiles, t.fond, 0.2),
    /** Le halo des plus brillantes : discret sur fond clair, sinon des taches. */
    halo: clair ? 0.1 : 0.35,
    etoiles: t.etoiles,
    dorures: t.dorures,
  };
}

/* ------------------------------------------------------------------------ *
 * Les styles et la mise en page (27/11, Alexandra : « peut-être choisir un
 * style de constellation (double donc couple, simple, etc) », « pas de drag
 * and drop par les clients surtout, ils vont faire n'imp ça doit être
 * simple », « pouvoir mettre le texte en haut ou en bas (donc décaler le
 * cercle) »).
 *
 * Quatre styles : le ciel de cette nuit (l'actuel), un signe dans un cercle,
 * un couple (deux cercles qui se touchent), un signe sans cercle. Et deux
 * places du texte : en haut (le dessin descend), en bas (il monte). Le style
 * et la place décident de tout : où est le dessin, où vont les trois lignes
 * (posées par la fenêtre du ciel, apps/web/src/islands/AfficheIA.tsx, qui
 * reprend les fractions `haut` et `bas` ci-dessous — si elles changent ici,
 * les changer là-bas).
 * ------------------------------------------------------------------------ */
export const STYLES_CIEL = ["nuit", "signe", "couple", "libre"] as const;
export type StyleCiel = (typeof STYLES_CIEL)[number];
export type PlaceTexte = "haut" | "bas";

/** Le texte va en haut pour le ciel de cette nuit (comme avant), en bas pour un signe. */
export const placeParDefaut = (style: StyleCiel): PlaceTexte => (style === "nuit" ? "haut" : "bas");

/**
 * Où se dessine le cercle (centre `cy` et rayon `R`, en pixels du fichier),
 * et la bande qu'occupe le dessin (`haut`, `bas`, en fraction de la hauteur) :
 * les lignes de texte se posent au-dessus de `haut` ou sous `bas`. Pour un
 * couple, `R` est le rayon de chacun des deux cercles.
 */
export function dispositionDuCiel(
  style: StyleCiel,
  texte: PlaceTexte,
  ville = false,
  personnages = false,
): { cy: number; R: number; haut: number; bas: number } {
  const W = LARGEUR_CIEL;
  const H = HAUTEUR_CIEL;
  /*
   * Texte en haut, le dessin remonte et rapetisse un peu (27/11, Alexandra :
   * « trop bas la constellation quand c'est en mode texte en haut ») : sous
   * lui, la place des personnages, sans que les coordonnées touchent une
   * tête. Le ciel de cette nuit SANS personnage garde le cercle d'avant au
   * pixel près (les ciels déjà vendus se redessinent pareil).
   */
  if (style === "nuit") {
    const remonte = texte === "haut" && personnages;
    const cy = texte === "haut" ? (remonte ? H * 0.49 : H * CENTRE_Y_CIEL) : H * 0.31;
    const R = texte === "haut" && !remonte ? W * 0.34 : W * 0.31;
    // Haut : la lettre N ; bas : les coordonnées, ou la ville et les coordonnées.
    return { cy, R, haut: (cy - R - 93) / H, bas: (cy + R + (ville ? 257 : 192)) / H };
  }
  if (style === "couple") {
    const cy = H * (texte === "haut" ? 0.46 : 0.36);
    const R = W * 0.205;
    // La date du cercle de gauche monte en arc au-dessus de lui.
    return { cy, R, haut: (cy - R * 1.14) / H, bas: (cy + R + 12) / H };
  }
  const cy = H * (texte === "haut" ? 0.48 : 0.33);
  const R = W * (texte === "haut" ? 0.32 : 0.34);
  if (style === "libre") return { cy, R, haut: (cy - R * 0.78) / H, bas: (cy + R * 0.98) / H };
  return { cy, R, haut: (cy - R - 24) / H, bas: (cy + R + 24) / H };
}

/** Ce que la cliente a réglé, une fois lu et vérifié (POST /ia/ciel). */
export interface ReglagesCiel {
  style: StyleCiel;
  texte: PlaceTexte;
  /** Un signe (signe, sans cercle), deux (couple), aucun (ciel de cette nuit). */
  signes: IdSigne[];
  /** Les dates de naissance écrites sur l'affiche, une par signe (null : pas de date). */
  dates: (string | null)[];
  /** Les ombres chinoises, de gauche à droite (ciel-silhouettes.ts). */
  silhouettes: string[];
  langue: LangueCiel;
}

/** Au plus quatre personnages sur un ciel (27/11). */
export const SILHOUETTES_MAX = 8;

/**
 * Lit les nouveaux champs de POST /ia/ciel. Rien d'envoyé : le ciel de cette
 * nuit, texte en haut, sans personnage — exactement comme avant. Un champ
 * envoyé mais faux est refusé, jamais corrigé en silence.
 */
export function lireReglagesCiel(
  b: Record<string, unknown>,
): { ok: true; reglages: ReglagesCiel } | { ok: false; error: string } {
  const style = b.style ?? "nuit";
  if (typeof style !== "string" || !(STYLES_CIEL as readonly string[]).includes(style))
    return { ok: false, error: "Style inconnu" };
  const s = style as StyleCiel;
  const texte = b.texte ?? placeParDefaut(s);
  if (texte !== "haut" && texte !== "bas") return { ok: false, error: "Place du texte inconnue" };
  const silhouettes = b.silhouettes ?? [];
  if (
    !Array.isArray(silhouettes) ||
    silhouettes.length > SILHOUETTES_MAX ||
    !silhouettes.every((id) => typeof id === "string" && /^[a-z-]+(:m)?$/.test(id))
  )
    return { ok: false, error: "Personnages invalides" };
  // Un id bien formé mais inconnu (« montre-le-ciel », retiré le 27/11 quand
  // les ombres de l'image d'Alexandra ont remplacé les dessins : « supprime
  // celles que tu as fait tu prends ça ») est ignoré, pas refusé : un ancien
  // réglage enregistré se redessine sans lui.
  const connues = (silhouettes as string[]).filter((id) => SILHOUETTES_ASSISES_PAR_ID.has(id.split(":")[0]!));
  const langue = (LANGUES_CIEL as readonly string[]).includes(String(b.langue)) ? (b.langue as LangueCiel) : "fr";
  const signes: IdSigne[] = [];
  const dates: (string | null)[] = [];
  if (s !== "nuit") {
    const nb = s === "couple" ? 2 : 1;
    const sb = b.signes === undefined ? [] : b.signes;
    const db_ = b.dates === undefined ? [] : b.dates;
    if (!Array.isArray(sb) || !Array.isArray(db_) || sb.length > nb || db_.length > nb)
      return { ok: false, error: "Signe invalide" };
    for (let i = 0; i < nb; i++) {
      const brute = db_[i];
      let date: string | null = null;
      if (brute !== undefined && brute !== null && brute !== "") {
        const m = typeof brute === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(brute) : null;
        const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
        if (!m || !d || d.getUTCDate() !== Number(m[3]) || d.getUTCMonth() !== Number(m[2]) - 1)
          return { ok: false, error: "Date invalide" };
        if (Number(m[1]) < 1900 || Number(m[1]) > 2100) return { ok: false, error: "Date hors limites (1900–2100)" };
        date = brute as string;
      }
      const choisi = sb[i];
      if (choisi !== undefined && choisi !== null && choisi !== "" && !estUnSigne(choisi))
        return { ok: false, error: "Signe inconnu" };
      const signe = estUnSigne(choisi) ? choisi : date ? signeDeLaDate(date) : null;
      if (!signe) return { ok: false, error: "Choisissez une date ou un signe" };
      signes.push(signe);
      dates.push(date);
    }
  }
  return { ok: true, reglages: { style: s, texte, signes, dates, silhouettes: connues, langue } };
}

/**
 * Les ombres chinoises posées sur la colline du premier plan, de sa couleur
 * (27/11, Alexandra : « les personnages tu mets uniquement les ombres
 * chinoises hein ! »). Un peu plus petites quand le texte est en bas : il
 * descend vers elles. Le groupe se tient à droite du milieu, d'autant plus
 * près du centre qu'il est nombreux.
 *
 * Et jamais sur un texte (27/11, relecture : « les têtes du couple passent
 * sur 2 NOVEMBRE 1990 », « les silhouettes coupent Passion • Détermination •
 * Magnétisme ») — elles rapetissent plutôt (poserSilhouettes, `plafond`) :
 * - texte en bas : leurs têtes restent sous la place gardée aux trois lignes
 *   (plafondDesSilhouettes ; la fenêtre du ciel y arrête le bloc de lignes) ;
 * - texte en haut, un signe ou un signe sans cercle : celles qui se tiennent
 *   sous la date (à défaut, sous le nom du signe) restent sous elle.
 * - texte en haut, le ciel de cette nuit ou le couple : sous les coordonnées
 *   ou les cercles, remontés pour leur laisser la place (27/11).
 */
function silhouettesDuCiel(
  ids: readonly string[],
  couleur: string,
  m: { style: StyleCiel; texte: PlaceTexte; ville?: boolean; date?: boolean },
): string {
  if (!ids.length) return "";
  // 27/11, Alexandra : « supp ça » — pas de teinte automatique, les
  // personnages gardent la couleur de la colline (une couleur réglable par
  // thème est à faire : A-FAIRE §00).
  const W = LARGEUR_CIEL;
  const H = HAUTEUR_CIEL;
  let plafond: { y: number; x0?: number; x1?: number } | undefined;
  if (m.texte === "bas") plafond = { y: plafondDesSilhouettes(m.style, m.ville) * H };
  else if (m.style === "nuit" || m.style === "couple")
    // Texte en haut (27/11, Alexandra : « trop bas la constellation quand
    // c'est en mode texte en haut ») : jamais une tête sur les coordonnées ou
    // sous les cercles ; le dessin remonté laisse la place, ce n'est qu'un garde-fou.
    plafond = { y: (dispositionDuCiel(m.style, "haut", m.ville, true).bas + 0.015) * H };
  else if (m.style === "signe" || m.style === "libre") {
    // Mêmes mesures que dessinDuSigne (ciel-signes.ts) : la date sous le nom.
    const { cy, R } = dispositionDuCiel(m.style, m.texte);
    const sans = m.style === "libre";
    const bas = m.date ? cy + (sans ? 0.94 : 0.8) * R + 0.05 * R : cy + (sans ? 0.76 : 0.6) * R + 0.09 * R;
    plafond = { y: bas, x0: W / 2 - 0.6 * R, x1: W / 2 + 0.6 * R };
  }
  return poserSilhouettes(ids, {
    couleur,
    largeur: W,
    hauteur: H,
    // Assises (27/11, Alexandra : « je les veux assis les personnages !!! qui
    // regardent bien », « et ils sont debout mdr »), nettement espacées et sans
    // accessoires autour (27/11, Alexandra : « c'est quoi ce bordel au niveau du
    // rendu ? ») : le groupe seul se lit mieux. Même taille texte en haut et en
    // bas (« les persos doivent pas changer de taille »).
    catalogue: SILHOUETTES_ASSISES_PAR_ID,
    ecart: 22,
    // Centrés au milieu (27/11, Alexandra : « les personnages doivent être
    // centrés au milieu »).
    centre: 0.5,
    ...(plafond ? { plafond } : {}),
  });
}

/**
 * Texte en bas : la place gardée aux lignes sous le dessin (3 % d'écart, puis
 * 18 % de la hauteur, de quoi poser un titre et deux lignes), et sous elle, à
 * 1,5 % près, le plus haut où monte une tête (27/11). La fenêtre du ciel
 * (apps/web/src/islands/CielEtoile.tsx, `basDuTexte`) arrête le bloc de
 * lignes à `bas + 0,03 + 0,18` quand des personnages sont posés : si l'un
 * change, changer l'autre.
 */
export function plafondDesSilhouettes(style: StyleCiel, ville = false): number {
  return dispositionDuCiel(style, "bas", ville).bas + 0.03 + 0.18 + 0.015;
}

/** Les deux collines du bas, communes à tous les styles. */
function collines(W: number, H: number) {
  return {
    loin: `M0 ${H * 0.895} C ${W * 0.18} ${H * 0.865}, ${W * 0.36} ${H * 0.885}, ${W * 0.55} ${H * 0.878} S ${W * 0.85} ${H * 0.86}, ${W} ${H * 0.875} L ${W} ${H} L 0 ${H} Z`,
    pres: `M0 ${H * 0.925} C ${W * 0.22} ${H * 0.9}, ${W * 0.45} ${H * 0.917}, ${W * 0.62} ${H * 0.912} S ${W * 0.88} ${H * 0.895}, ${W} ${H * 0.908} L ${W} ${H} L 0 ${H} Z`,
  };
}

/**
 * L'affiche d'un signe, d'un couple, ou d'un signe sans cercle (27/11) : le
 * même fond, le même dôme et le même anneau doré que le ciel de cette nuit,
 * au même thème ; dedans, la constellation du signe (ciel-signes.ts). Pas de
 * points cardinaux ni de coordonnées : ce n'est pas le ciel d'un lieu.
 */
export function svgDuSigne(
  reglages: Pick<ReglagesCiel, "style" | "texte" | "signes" | "dates" | "silhouettes" | "langue">,
  theme: Pick<ThemeCiel, "fond" | "etoiles" | "dorures"> = THEMES_CIEL_DE_BASE[0]!,
): string {
  const c = teintesDuTheme(theme);
  const W = LARGEUR_CIEL;
  const H = HAUTEUR_CIEL;
  const cx = W / 2;
  const { cy, R } = dispositionDuCiel(reglages.style, reglages.texte);
  const date = (i: number) => dateEcrite(reglages.dates[i], reglages.langue);
  const couleurs = { etoiles: c.etoiles, dorures: c.dorures };
  const dome = (x: number, r: number) => `<circle cx="${x}" cy="${cy}" r="${r}" fill="url(#dome)"/>`;
  let dessin = "";
  if (reglages.style === "couple") {
    const [a, b] = [cx - R, cx + R];
    dessin =
      dome(a, R) +
      dome(b, R) +
      dessinDuSigne({ id: reglages.signes[0]!, cx: a, cy, R, couleurs, langue: reglages.langue, date: date(0), placeDate: "arc-gauche" }) +
      dessinDuSigne({ id: reglages.signes[1]!, cx: b, cy, R, couleurs, langue: reglages.langue, date: date(1), placeDate: "arc-droite" }) +
      `<circle cx="${a}" cy="${cy}" r="${R}" fill="none" stroke="${c.dorures}" stroke-width="5"/>` +
      `<circle cx="${b}" cy="${cy}" r="${R}" fill="none" stroke="${c.dorures}" stroke-width="5"/>` +
      // Là où les deux cercles se touchent, une petite étoile : le lien.
      petiteEtoile(cx, cy, R * 0.075, c.dorures);
  } else if (reglages.style === "libre") {
    dessin = dessinDuSigne({ id: reglages.signes[0]!, cx, cy, R, couleurs, langue: reglages.langue, date: date(0), placeDate: "dedans", sansCercle: true });
  } else {
    dessin =
      dome(cx, R) +
      dessinDuSigne({ id: reglages.signes[0]!, cx, cy, R, couleurs, langue: reglages.langue, date: date(0), placeDate: "dedans" }) +
      `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${c.dorures}" stroke-width="5"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${R + 22}" fill="none" stroke="${c.dorures}" stroke-opacity="0.45" stroke-width="2"/>`;
  }
  const { loin, pres } = collines(W, H);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="nuit" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${c.haut}"/>
      <stop offset="0.75" stop-color="${c.milieu}"/>
      <stop offset="1" stop-color="${c.horizon}"/>
    </linearGradient>
    <radialGradient id="dome" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${c.domeCentre}"/>
      <stop offset="1" stop-color="${c.domeBord}"/>
    </radialGradient>
    ${defsDuSigne(c.etoiles, c.halo)}
  </defs>
  <rect width="${W}" height="${H}" fill="url(#nuit)"/>
  ${dessin}
  <path d="${loin}" fill="${c.collineLoin}"/>
  <path d="${pres}" fill="${c.collinePres}"/>${silhouettesDuCiel(reglages.silhouettes, c.collinePres, { style: reglages.style, texte: reglages.texte, date: !!reglages.dates[0] })}
</svg>`;
}

/** Le SVG du fond, à la taille du fichier. */
export function svgDuCiel(
  lat: number,
  lon: number,
  instant: Date,
  theme: Pick<ThemeCiel, "fond" | "etoiles" | "dorures"> = THEMES_CIEL_DE_BASE[0]!,
  options: { ville?: string | null; texte?: PlaceTexte; silhouettes?: readonly string[] } = {},
): string {
  const c = teintesDuTheme(theme);
  const W = LARGEUR_CIEL;
  const H = HAUTEUR_CIEL;
  const cx = W / 2;
  // Le cercle laisse le haut libre (26/11, « descends un peu le cercle on
  // doit pouvoir avoir la place pour le texte ») : les lignes de texte de
  // l'affiche s'empilent en haut, sur le premier petit tiers. Texte en bas
  // (27/11) : le cercle monte, un peu plus petit (dispositionDuCiel).
  const texte = options.texte ?? "haut";
  // Avec des personnages, texte en haut, le cercle remonte (27/11).
  const personnages = (options.silhouettes ?? []).some((id) => SILHOUETTES_ASSISES_PAR_ID.has(id.split(":")[0]!));
  const { cy, R } = dispositionDuCiel("nuit", texte, !!(options.ville ?? "").trim(), personnages);
  const px = (p: { x: number; y: number }) => `${(cx + p.x * R).toFixed(1)},${(cy + p.y * R).toFixed(1)}`;

  // Tracés des constellations : un segment n'est gardé que si ses deux
  // bouts sont au-dessus de l'horizon.
  const traits: string[] = [];
  for (const trace of CONSTELLATIONS) {
    let prec: { x: number; y: number } | null = null;
    for (let i = 0; i + 1 < trace.length; i += 2) {
      const { hauteur, azimut } = horizontales(trace[i]!, trace[i + 1]!, lat, lon, instant);
      const p = surLaCarte(hauteur, azimut);
      if (p && prec) traits.push(`M${px(prec)}L${px(p)}`);
      prec = p;
    }
  }

  const etoiles: string[] = [];
  const brillantes: string[] = [];
  for (let i = 0; i + 2 < ETOILES.length; i += 3) {
    const mag = ETOILES[i + 2]!;
    const { hauteur, azimut } = horizontales(ETOILES[i]!, ETOILES[i + 1]!, lat, lon, instant);
    const p = surLaCarte(hauteur, azimut);
    if (!p) continue;
    const r = Math.max(1.8, (6.2 - mag) * 2.5);
    const [x, y] = px(p).split(",");
    etoiles.push(`<circle cx="${x}" cy="${y}" r="${r.toFixed(1)}"/>`);
    if (mag < 1.6) brillantes.push(`<circle cx="${x}" cy="${y}" r="${(r * 3.2).toFixed(1)}"/>`);
  }

  // Collines : deux plans, le plus proche le plus sombre. Courbes fixes —
  // la même scène pour tout le monde, seul le ciel change.
  const { loin: collineLoin, pres: collinePres } = collines(W, H);

  const etiquette = (txt: string, x: number, y: number) =>
    `<text x="${x.toFixed(0)}" y="${y.toFixed(0)}" text-anchor="middle" dominant-baseline="middle">${txt}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="nuit" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${c.haut}"/>
      <stop offset="0.75" stop-color="${c.milieu}"/>
      <stop offset="1" stop-color="${c.horizon}"/>
    </linearGradient>
    <radialGradient id="dome" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${c.domeCentre}"/>
      <stop offset="1" stop-color="${c.domeBord}"/>
    </radialGradient>
    <radialGradient id="halo">
      <stop offset="0" stop-color="${c.etoiles}" stop-opacity="${c.halo}"/>
      <stop offset="1" stop-color="${c.etoiles}" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="cercle"><circle cx="${cx}" cy="${cy}" r="${R}"/></clipPath>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#nuit)"/>
  <circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#dome)"/>
  <g clip-path="url(#cercle)">
    <path d="${traits.join("")}" stroke="${c.constellations}" stroke-opacity="0.35" stroke-width="3" fill="none" stroke-linecap="round"/>
    <g fill="url(#halo)">${brillantes.join("")}</g>
    <g fill="${c.etoiles}">${etoiles.join("")}</g>
  </g>
  <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${c.dorures}" stroke-width="5"/>
  <circle cx="${cx}" cy="${cy}" r="${R + 22}" fill="none" stroke="${c.dorures}" stroke-opacity="0.45" stroke-width="2"/>
  <g font-family="League Spartan, DejaVu Sans, sans-serif" font-size="46" fill="${c.dorures}" letter-spacing="4">
    ${etiquette("N", cx, cy - R - 70)}
    ${etiquette("S", cx, cy + R + 70)}
    ${etiquette("E", cx - R - 70, cy)}
    ${etiquette("O", cx + R + 70, cy)}
  </g>
  ${legendeDuLieu(options.ville ?? null, cx, cy + R, c.dorures, coordonnees(lat, lon))}
  <path d="${collineLoin}" fill="${c.collineLoin}"/>
  <path d="${collinePres}" fill="${c.collinePres}"/>${silhouettesDuCiel(options.silhouettes ?? [], c.collinePres, { style: "nuit", texte, ville: !!(options.ville ?? "").trim() })}
</svg>`;
}

/** Le fond en PNG. */
export async function rendreCiel(
  lat: number,
  lon: number,
  instant: Date,
  theme?: Pick<ThemeCiel, "fond" | "etoiles" | "dorures">,
  options: { ville?: string | null; texte?: PlaceTexte; silhouettes?: readonly string[] } = {},
): Promise<Buffer> {
  return sharp(Buffer.from(svgDuCiel(lat, lon, instant, theme, options))).png().toBuffer();
}

/** Les thèmes réglés au BO (tous, actifs ou non). */
export async function lireThemesCiel(): Promise<ThemeCiel[]> {
  const [ligne] = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, REGLAGE_THEMES_CIEL));
  return themesDuReglage(ligne?.value);
}

/**
 * Les villes du monde (26/11, Alexandra : « j'aimerais qu'on puisse taper la
 * ville qu'on veut », puis « faut toutes les villes de google maps ») :
 * GeoNames, CC BY 4.0 — toutes les localités de France, de Suisse, de
 * Belgique et du Luxembourg (villages et lieux-dits compris), l'Allemagne,
 * l'Italie et l'Espagne dès 1 000 habitants, le reste du monde dès 5 000 ;
 * 197 000 lieux avec leur fuseau horaire. Lu au premier appel,
 * gardé en mémoire ensuite. Aucune recherche ne part chez un tiers : ce que
 * la cliente tape reste chez nous.
 */
export interface Ville {
  nom: string;
  pays: string;
  region: string;
  lat: number;
  lon: number;
  fuseau: string;
  habitants: number;
  /** Nom et autres noms, sans accents ni tirets, pour la recherche. */
  cles: string[];
}

/** « Saint-Louis », « saint louis », « SAINT LOUIS » → « saint louis ». */
export function normaliserNom(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[\s'’\-.]+/g, " ")
    .trim();
}

let villes: Ville[] | null = null;
function lesVilles(): Ville[] {
  if (villes) return villes;
  const brut = gunzipSync(readFileSync(new URL("./ciel-villes.tsv.gz", import.meta.url))).toString("utf8");
  villes = [];
  for (const ligne of brut.split("\n")) {
    if (!ligne || ligne.startsWith("#")) continue;
    const [nom, autres, pays, region, lat, lon, fuseau, habitants] = ligne.split("\t");
    if (!nom || !fuseau) continue;
    villes.push({
      nom,
      pays: pays ?? "",
      region: region ?? "",
      lat: Number(lat),
      lon: Number(lon),
      fuseau,
      habitants: Number(habitants) || 0,
      cles: [normaliserNom(nom), ...(autres ? autres.split("|") : [])],
    });
  }
  return villes;
}

/**
 * Les villes dont un nom commence par ce qui est tapé : le nom exact d'abord,
 * puis les plus peuplées — la France passe devant à taille comparable (une
 * boutique française : « Colmar » avant un homonyme lointain).
 */
export function chercherVilles(q: string, max = 8): Omit<Ville, "cles">[] {
  const n = normaliserNom(q);
  if (n.length < 2) return [];
  const trouvees: { v: Ville; exacte: boolean }[] = [];
  for (const v of lesVilles()) {
    let ok = false;
    let exacte = false;
    for (const c of v.cles) {
      if (c.startsWith(n)) {
        ok = true;
        if (c === n) exacte = true;
      }
    }
    if (ok) trouvees.push({ v, exacte });
  }
  const poids = (t: { v: Ville; exacte: boolean }) =>
    (t.exacte ? 1e12 : 0) + t.v.habitants * (t.v.pays === "FR" ? 20 : 1);
  return trouvees
    .sort((a, b) => poids(b) - poids(a))
    .slice(0, max)
    .map(({ v: { cles: _c, ...reste } }) => reste);
}

/**
 * Un compteur par minute et par adresse, à part pour chaque route (27/11).
 *
 * Alexandra, en essayant la fiche (thème « encre ») : « Trop de demandes
 * d'affilée » — « Pour ÇA il faut pas de limite ! parce que ça consomme pas
 * de token. » Il y avait 10 appels par minute, et ce compteur était PARTAGÉ
 * entre la création d'un ciel et les aperçus de thèmes du BO : ouvrir BO ›
 * Ciel étoilé : couleurs en usait déjà six. Désormais aucune limite qu'une
 * personne puisse atteindre : seulement un garde-fou contre les robots, à
 * 120 par minute, chaque route le sien. Un ciel ne coûte aucun jeton, mais
 * environ 0,3 s de processeur et près de 1 Mo de disque gardé 30 jours s'il
 * n'est pas acheté : sans rien, un script remplirait le disque.
 *
 * Rend une fonction qui compte l'appel de cette adresse et dit s'il dépasse.
 * Exportée pour les essais (tests/ciel.test.ts).
 */
export function compteurParMinute(max: number): (ip: string) => boolean {
  const appels = new Map<string, number[]>();
  return (ip: string) => {
    const maintenant = Date.now();
    const recents = (appels.get(ip) ?? []).filter((t) => maintenant - t < 60_000);
    recents.push(maintenant);
    appels.set(ip, recents);
    if (appels.size > 5000)
      for (const [k, v] of appels) if (!v.some((t) => maintenant - t < 60_000)) appels.delete(k);
    return recents.length > max;
  };
}

/** Le garde-fou de chaque route : 120 par minute et par adresse. */
export const CIELS_PAR_MINUTE = 120;
const tropDeCiels = compteurParMinute(CIELS_PAR_MINUTE);
const tropDApercusDeThemes = compteurParMinute(CIELS_PAR_MINUTE);

export function mountCielRoutes(app: Hono): void {
  /** GET /ia/ciel/villes?q=mulh → les villes proposées sous le champ. */
  app.get("/ia/ciel/villes", (c: Context) => {
    const q = String(c.req.query("q") ?? "").slice(0, 60);
    return c.json(
      { villes: chercherVilles(q) },
      200,
      { "Cache-Control": "public, max-age=86400" },
    );
  });

  /**
   * GET /ia/ciel/silhouettes → les tracés des ombres chinoises (27/11), pour
   * les vignettes de l'étape Personnages : les mêmes que ceux posés sur le ciel.
   */
  app.get("/ia/ciel/silhouettes", (c: Context) =>
    c.json(
      { silhouettes: SILHOUETTES_ASSISES.map(({ id, d, gauche, droite, haut }) => ({ id, d, gauche, droite, haut })) },
      200,
      { "Cache-Control": "public, max-age=3600" },
    ),
  );

  /**
   * GET /ia/ciel/themes → les thèmes proposés aux clientes (actifs), avec
   * les teintes de leur dégradé pour dessiner la pastille de chacun.
   */
  app.get("/ia/ciel/themes", async (c: Context) => {
    const themes = (await lireThemesCiel()).filter((t) => t.actif !== false);
    return c.json({
      themes: themes.map((t) => {
        const tt = teintesDuTheme(t);
        return { id: t.id, nom: t.nom, fond: t.fond, etoiles: t.etoiles, dorures: t.dorures, haut: tt.haut, horizon: tt.horizon };
      }),
    });
  });

  /**
   * GET /ia/ciel/apercu-theme?fond=%23…&etoiles=%23…&dorures=%23… → une
   * petite affiche (600 px) sur un ciel fixe : l'aperçu d'un thème au BO,
   * pendant qu'on choisit ses couleurs. Gardée en mémoire par couleurs.
   */
  const apercusThemes = new Map<string, Buffer>();
  app.get("/ia/ciel/apercu-theme", async (c: Context) => {
    const base = THEMES_CIEL_DE_BASE[0]!;
    const theme = themeSur(
      { nom: "apercu", fond: c.req.query("fond"), etoiles: c.req.query("etoiles"), dorures: c.req.query("dorures") },
      0,
    ) ?? base;
    const cle = `${theme.fond}${theme.etoiles}${theme.dorures}`;
    let png = apercusThemes.get(cle);
    if (!png) {
      if (tropDApercusDeThemes(ipDeLaRequete(c))) return c.json({ error: "Trop de demandes" }, 429);
      const svg = svgDuCiel(47.75, 7.34, new Date(Date.UTC(2025, 5, 14, 21, 10)), theme).replace(
        `width="${LARGEUR_CIEL}" height="${HAUTEUR_CIEL}"`,
        `width="600" height="${Math.round((600 * HAUTEUR_CIEL) / LARGEUR_CIEL)}"`,
      );
      png = await sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
      if (apercusThemes.size > 300) apercusThemes.clear();
      apercusThemes.set(cle, png);
    }
    return c.body(new Uint8Array(png), 200, {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=86400",
    });
  });

  /**
   * POST /ia/ciel { productId, cartId, date: "AAAA-MM-JJ", heure: "HH:MM",
   *                 fuseau: "Europe/Paris", lat, lon, lieu, theme,
   *                 style?, texte?, signes?, dates?, silhouettes?, langue? }
   * (les champs du 27/11 : voir lireReglagesCiel ; un signe ou un couple se
   * passe de date, d'heure et de lieu)
   * → { publicId, status: "prete", apercu } — la même réponse que /ia/generer.
   */
  app.post("/ia/ciel", async (c: Context) => {
    const ip = ipDeLaRequete(c);
    if (tropDeCiels(ip))
      return c.json({ error: "Trop de demandes d'affilée, réessayez dans une minute" }, 429);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const productId = Number(b.productId);
    // Le style, la place du texte, les signes, les personnages (27/11).
    const lus = lireReglagesCiel(b);
    if (!lus.ok) return c.json({ error: lus.error }, 400);
    const reglages = lus.reglages;
    const nuit = reglages.style === "nuit";
    // Date, heure et lieu ne servent qu'au ciel de cette nuit.
    const lat = nuit ? Number(b.lat) : 0;
    const lon = nuit ? Number(b.lon) : 0;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
      return c.json({ error: "Lieu invalide" }, 400);
    const fuseau = String(b.fuseau ?? "Europe/Paris").slice(0, 64);
    const instant = nuit ? instantLocal(String(b.date ?? ""), String(b.heure ?? ""), fuseau) : new Date();
    if (!instant) return c.json({ error: "Date ou heure invalide" }, 400);
    const an = instant.getUTCFullYear();
    if (an < 1900 || an > 2100) return c.json({ error: "Date hors limites (1900–2100)" }, 400);

    const [produit] = Number.isFinite(productId)
      ? await db.select().from(schema.products).where(eq(schema.products.id, productId))
      : [];
    if (!produit) return c.json({ error: "Affiche introuvable" }, 404);
    if (!produit.skyEnabled) return c.json({ error: "Cette affiche n'accepte pas de ciel" }, 400);

    const publicId = randomUUID();
    const lieu = String(b.lieu ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 80);
    const client = await clientDeLaRequete(c);
    // Le thème choisi parmi ceux proposés ; à défaut, le premier.
    const proposes = (await lireThemesCiel()).filter((t) => t.actif !== false);
    const theme =
      proposes.find((t) => t.id === String(b.theme ?? "")) ?? proposes[0] ?? THEMES_CIEL_DE_BASE[0]!;
    try {
      // La ville sous le cercle, si la cliente l'a demandée (27/11).
      const ville = nuit && b.afficherVille === true ? String(b.ville ?? "").slice(0, 80) : null;
      const pleine = nuit
        ? await rendreCiel(lat, lon, instant, theme, { ville, texte: reglages.texte, silhouettes: reglages.silhouettes })
        : await sharp(Buffer.from(svgDuSigne(reglages, theme))).png().toBuffer();
      const nomPleine = `${publicId}-pleine.png`;
      await writeFile(resolve(IA_DIR, nomPleine), pleine);
      // Le filigrane se cale sur le centre du dessin, où qu'il soit.
      // Remonté avec des personnages, texte en haut (27/11) : le même calcul que le dessin.
      const { cy } = dispositionDuCiel(reglages.style, reglages.texte, !!ville, reglages.silhouettes.length > 0);
      const centreY = cy / HAUTEUR_CIEL;
      // Sans anneau pour un couple ou un signe sans cercle (27/11) : il ne
      // suivrait pas le dessin.
      const anneau = reglages.style === "nuit" || reglages.style === "signe";
      const apercu = await fabriquerApercu(pleine, `${publicId}-apercu.jpg`, { x: 0.5, y: centreY }, anneau);
      await db.insert(schema.aiGenerations).values({
        publicId,
        productId: produit.id,
        cartId: b.cartId ? String(b.cartId).slice(0, 100) : null,
        customerId: client?.id ?? null,
        sourcePath: null,
        // Ce qui a servi au calcul, lisible au back-office à la place d'une consigne.
        prompt: JSON.stringify({
          ciel: true,
          ...(nuit
            ? { date: b.date, heure: b.heure, fuseau, lieu, lat, lon, utc: instant.toISOString() }
            : { style: reglages.style, signes: reglages.signes, dates: reglages.dates }),
          // Seulement s'ils changent quelque chose (27/11) : la ligne d'un
          // ciel de cette nuit sans rien reste celle d'avant.
          ...(reglages.texte !== placeParDefaut(reglages.style) ? { texte: reglages.texte } : {}),
          ...(reglages.silhouettes.length ? { silhouettes: reglages.silhouettes } : {}),
          theme: { id: theme.id, nom: theme.nom, fond: theme.fond, etoiles: theme.etoiles, dorures: theme.dorures },
        }),
        // Hors de BO › Affiches IA et du plafond (filtreDuPerimetre, ia.ts, 27/11).
        model: MODELE_CIEL,
        size: `${LARGEUR_CIEL}x${HAUTEUR_CIEL}`,
        status: "prete",
        previewPath: apercu,
        fullPath: `ia/${nomPleine}`,
        costCents: 0,
        ip,
      });
      console.log(
        nuit
          ? `[ciel] ${publicId} : ${lieu || `${lat},${lon}`} le ${instant.toISOString()}`
          : `[ciel] ${publicId} : ${reglages.style} ${reglages.signes.join(" + ")}`,
      );
      return c.json({ publicId, status: "prete", apercu: `/ia/apercu/${publicId}` });
    } catch (e) {
      console.error("Ciel étoilé : rendu impossible :", e instanceof Error ? e.message : e);
      return c.json({ error: "Le ciel n'a pas pu être dessiné, réessayez." }, 500);
    }
  });
}
