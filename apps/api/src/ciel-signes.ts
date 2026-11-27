/**
 * Les signes du zodiaque sur l'affiche du ciel étoilé (27/11, Alexandra :
 * « fais sur cette même page produit la possibilité de mettre la
 * constellation d'un signe astro ou de deux (pour un couple) », puis, devant
 * des affiches modèles : « j'aimerais trop en faire un comme ça aussi, dans le
 * principe les dates avec constellation, noms, et une phrase », « faut pas
 * faire trop compliqué non plus et pas identique, c'est des idées ! »).
 *
 * Un signe se dessine en « médaillon » : la constellation EN GRAND, ses
 * étoiles à cinq branches (taille selon leur éclat), ses tracés en pointillés
 * couleur des dorures, un semis léger d'étoiles de fond et quelques petites
 * étoiles à quatre branches et petits ronds épars — fixes, les mêmes pour
 * tout le monde —, le nom du signe écrit à la main (Great Vibes, une police
 * déjà servie par l'API pour l'impression) et la date en petites capitales.
 *
 * Les tracés viennent du catalogue du ciel (ciel-donnees.ts, d3-celestial) :
 * il ne garde pas le sigle de chaque tracé, mais son ORDRE est celui de
 * d3-celestial (sigles IAU par ordre alphabétique). Les rangs ci-dessous ont
 * été relevés un à un, et un essai (tests/ciel.test.ts) vérifie que chaque
 * signe tombe bien dans sa région du ciel : si le catalogue est régénéré, il
 * le dira.
 */
import { CONSTELLATIONS, ETOILES } from "./ciel-donnees.js";

export const IDS_SIGNES = ["Ari", "Tau", "Gem", "Cnc", "Leo", "Vir", "Lib", "Sco", "Sgr", "Cap", "Aqr", "Psc"] as const;
export type IdSigne = (typeof IDS_SIGNES)[number];

/** Les langues du site (apps/web/src/i18n/ui.ts). */
export const LANGUES_CIEL = ["fr", "en", "de", "it", "es", "ja", "zh"] as const;
export type LangueCiel = (typeof LANGUES_CIEL)[number];

interface Signe {
  /** Rangs des tracés dans CONSTELLATIONS. */
  traces: readonly number[];
  /** Région du ciel où il doit tomber (ascension droite et déclinaison du centre, en degrés) : l'essai la vérifie. */
  region: readonly [number, number];
  /** Premier jour du signe, « MM-JJ » (dates habituelles du zodiaque tropical). */
  debut: string;
  /**
   * Le nom ÉCRIT SUR L'AFFICHE. En japonais et en chinois, le nom latin :
   * aucune police du serveur ne sait écrire ces écritures-là (fc-list du
   * conteneur), et un nom en carrés vides serait pire.
   */
  noms: Record<"fr" | "en" | "de" | "it" | "es" | "latin", string>;
}

export const SIGNES: Readonly<Record<IdSigne, Signe>> = {
  Ari: { traces: [14], region: [33, 23], debut: "03-21", noms: { fr: "Bélier", en: "Aries", de: "Widder", it: "Ariete", es: "Aries", latin: "Aries" } },
  Tau: { traces: [129, 130, 131], region: [65, 16], debut: "04-20", noms: { fr: "Taureau", en: "Taurus", de: "Stier", it: "Toro", es: "Tauro", latin: "Taurus" } },
  Gem: { traces: [61, 62], region: [105, 23], debut: "05-21", noms: { fr: "Gémeaux", en: "Gemini", de: "Zwillinge", it: "Gemelli", es: "Géminis", latin: "Gemini" } },
  Cnc: { traces: [21, 22], region: [130, 18], debut: "06-21", noms: { fr: "Cancer", en: "Cancer", de: "Krebs", it: "Cancro", es: "Cáncer", latin: "Cancer" } },
  Leo: { traces: [76, 77], region: [158, 18], debut: "07-23", noms: { fr: "Lion", en: "Leo", de: "Löwe", it: "Leone", es: "Leo", latin: "Leo" } },
  Vir: { traces: [145, 146, 147], region: [198, -1], debut: "08-23", noms: { fr: "Vierge", en: "Virgo", de: "Jungfrau", it: "Vergine", es: "Virgo", latin: "Virgo" } },
  Lib: { traces: [81, 82], region: [229, -19], debut: "09-23", noms: { fr: "Balance", en: "Libra", de: "Waage", it: "Bilancia", es: "Libra", latin: "Libra" } },
  Sco: { traces: [122, 123], region: [252, -32], debut: "10-23", noms: { fr: "Scorpion", en: "Scorpio", de: "Skorpion", it: "Scorpione", es: "Escorpio", latin: "Scorpius" } },
  Sgr: { traces: [118, 119, 120, 121], region: [285, -28], debut: "11-22", noms: { fr: "Sagittaire", en: "Sagittarius", de: "Schütze", it: "Sagittario", es: "Sagitario", latin: "Sagittarius" } },
  Cap: { traces: [28], region: [314, -18], debut: "12-22", noms: { fr: "Capricorne", en: "Capricorn", de: "Steinbock", it: "Capricorno", es: "Capricornio", latin: "Capricornus" } },
  Aqr: { traces: [7, 8, 9, 10, 11], region: [333, -8], debut: "01-20", noms: { fr: "Verseau", en: "Aquarius", de: "Wassermann", it: "Acquario", es: "Acuario", latin: "Aquarius" } },
  Psc: { traces: [109, 110], region: [5, 10], debut: "02-19", noms: { fr: "Poissons", en: "Pisces", de: "Fische", it: "Pesci", es: "Piscis", latin: "Pisces" } },
};

export const estUnSigne = (v: unknown): v is IdSigne => typeof v === "string" && (IDS_SIGNES as readonly string[]).includes(v);

/** Le signe d'une date « AAAA-MM-JJ » (dates habituelles), ou null. */
export function signeDeLaDate(date: string): IdSigne | null {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const mmjj = `${m[1]}-${m[2]}`;
  // Le dernier signe dont le début est passé ; avant le 20 janvier, le Capricorne.
  let trouve: IdSigne = "Cap";
  let meilleur = "";
  for (const id of IDS_SIGNES) {
    const d = SIGNES[id].debut;
    if (d <= mmjj && d > meilleur) {
      meilleur = d;
      trouve = id;
    }
  }
  return trouve;
}

/** Le nom écrit sur l'affiche, dans la langue de la page. */
export function nomDuSigne(id: IdSigne, langue: LangueCiel): string {
  const n = SIGNES[id].noms;
  return langue === "ja" || langue === "zh" ? n.latin : n[langue];
}

const LOCALES: Record<LangueCiel, string> = { fr: "fr-FR", en: "en-GB", de: "de-DE", it: "it-IT", es: "es-ES", ja: "ja-JP", zh: "zh-CN" };

/**
 * « 5 SEPTEMBRE 2019 » dans la langue de la page ; en japonais et en chinois,
 * « 2019 . 09 . 05 » (les mois s'y écrivent en idéogrammes, que le serveur ne
 * sait pas dessiner). Null pour une date absente ou illisible.
 */
export function dateEcrite(date: string | null | undefined, langue: LangueCiel): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? "");
  if (!m) return null;
  if (langue === "ja" || langue === "zh") return `${m[1]} . ${m[2]} . ${m[3]}`;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(LOCALES[langue], { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(d)
    .toLocaleUpperCase(LOCALES[langue]);
}

/* ------------------------------------------------------------------ */
/* Géométrie                                                            */
/* ------------------------------------------------------------------ */

const RAD = Math.PI / 180;
type Pt = { x: number; y: number };

/** Un générateur pseudo-aléatoire fixe (mulberry32) : le même décor à chaque dessin. */
function hasard(graine: string): () => number {
  let a = 0;
  for (const ch of graine) a = (Math.imul(a, 31) + ch.charCodeAt(0)) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * La constellation projetée sur un plan (gnomonique, centrée sur elle), l'est
 * à gauche comme quand on lève les yeux, en unités arbitraires : ses tracés
 * et ses étoiles (avec leur magnitude, prise au catalogue).
 */
function constellation(id: IdSigne): { traits: Pt[][]; etoiles: (Pt & { mag: number })[] } {
  const brut = SIGNES[id].traces.map((r) => CONSTELLATIONS[r] ?? []);
  const ra0Brut = brut[0]?.[0] ?? 0;
  const deroule = (ra: number) => ra0Brut + ((((ra - ra0Brut) % 360) + 540) % 360) - 180;
  const pts: [number, number][][] = brut.map((t) => {
    const out: [number, number][] = [];
    for (let i = 0; i + 1 < t.length; i += 2) out.push([deroule(t[i]!), t[i + 1]!]);
    return out;
  });
  const tous = pts.flat();
  const ra0 = (Math.min(...tous.map((p) => p[0])) + Math.max(...tous.map((p) => p[0]))) / 2;
  const de0 = (Math.min(...tous.map((p) => p[1])) + Math.max(...tous.map((p) => p[1]))) / 2;
  const proj = (ra: number, de: number): Pt => {
    const d = de * RAD;
    const d0 = de0 * RAD;
    const h = (ra - ra0) * RAD;
    const c = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(h);
    return {
      x: -(Math.cos(d) * Math.sin(h)) / c,
      y: -(Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(h)) / c,
    };
  };
  const traits = pts.map((t) => t.map(([ra, de]) => proj(ra, de)));
  // Une étoile par sommet (les tracés se rejoignent sur les mêmes étoiles),
  // avec la magnitude de l'étoile du catalogue la plus proche.
  const etoiles: (Pt & { mag: number })[] = [];
  const vus: [number, number][] = [];
  for (const [ra, de] of tous) {
    if (vus.some(([a, b]) => Math.abs(a - ra) < 0.05 && Math.abs(b - de) < 0.05)) continue;
    vus.push([ra, de]);
    let mag = 4.5;
    let mieux = 0.35;
    for (let i = 0; i + 2 < ETOILES.length; i += 3) {
      const dd = Math.abs(ETOILES[i + 1]! - de);
      if (dd > mieux) continue;
      const dr = Math.abs(((((ETOILES[i]! - ra) % 360) + 540) % 360) - 180) * Math.cos(de * RAD);
      const dist = Math.hypot(dr, dd);
      if (dist < mieux) {
        mieux = dist;
        mag = ETOILES[i + 2]!;
      }
    }
    etoiles.push({ ...proj(ra, de), mag });
  }
  return { traits, etoiles };
}

/** Une étoile à cinq branches, pointe en haut. */
function etoileCinq(x: number, y: number, r: number): string {
  let d = "";
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    d += `${i ? "L" : "M"}${(x + rr * Math.cos(a)).toFixed(1)} ${(y + rr * Math.sin(a)).toFixed(1)}`;
  }
  return `${d}Z`;
}

/** Une étoile à quatre branches, aux flancs creusés. */
function etoileQuatre(x: number, y: number, r: number): string {
  const k = r * 0.16;
  const f = (n: number) => n.toFixed(1);
  return `M${f(x)} ${f(y - r)}Q${f(x + k)} ${f(y - k)} ${f(x + r)} ${f(y)}Q${f(x + k)} ${f(y + k)} ${f(x)} ${f(y + r)}Q${f(x - k)} ${f(y + k)} ${f(x - r)} ${f(y)}Q${f(x - k)} ${f(y - k)} ${f(x)} ${f(y - r)}Z`;
}

function distanceAuSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const echappe = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Les couleurs dont le médaillon a besoin (teintesDuTheme, ciel.ts). */
export interface CouleursSigne {
  etoiles: string;
  dorures: string;
}

export interface Medaillon {
  id: IdSigne;
  cx: number;
  cy: number;
  /** Rayon du cercle (ou, sans cercle, de la place qu'il occuperait). */
  R: number;
  couleurs: CouleursSigne;
  langue: LangueCiel;
  /** Date écrite (déjà mise en forme), ou null. */
  date: string | null;
  /** Où écrire la date : en bas, dans le cercle ; ou en arc le long du bord extérieur (couple). */
  placeDate: "dedans" | "arc-gauche" | "arc-droite";
  /** Sans cercle : la constellation prend plus de place, le décor s'étale. */
  sansCercle?: boolean;
}

/**
 * Le dessin d'un signe dans son cercle (le dôme et l'anneau sont dessinés
 * par ciel.ts) : décor, constellation, nom, date.
 */
export function dessinDuSigne(m: Medaillon): string {
  const { cx, cy, R } = m;
  const { traits, etoiles } = constellation(m.id);
  // La constellation tient dans une boîte au-dessus du nom, à son échelle.
  const tous = traits.flat();
  const minX = Math.min(...tous.map((p) => p.x));
  const maxX = Math.max(...tous.map((p) => p.x));
  const minY = Math.min(...tous.map((p) => p.y));
  const maxY = Math.max(...tous.map((p) => p.y));
  const demiL = (m.sansCercle ? 0.82 : 0.6) * R;
  const demiH = (m.sansCercle ? 0.56 : 0.47) * R;
  const centreY = cy - (m.sansCercle ? 0.12 : 0.13) * R;
  const ech = Math.min((2 * demiL) / (maxX - minX || 1), (2 * demiH) / (maxY - minY || 1));
  const mx = (minX + maxX) / 2;
  const my = (minY + maxY) / 2;
  const ecran = (p: Pt): Pt => ({ x: cx + (p.x - mx) * ech, y: centreY + (p.y - my) * ech });
  const segs: [Pt, Pt][] = [];
  for (const t of traits) for (let i = 0; i + 1 < t.length; i++) segs.push([ecran(t[i]!), ecran(t[i + 1]!)]);
  const astres = etoiles.map((e) => ({ ...ecran(e), mag: e.mag }));
  const rayon = (mag: number) => R * Math.max(0.011, Math.min(0.04, 0.014 + 0.0062 * (4.5 - mag)));

  // Le nom et la date, sous la constellation.
  const yNom = cy + (m.sansCercle ? 0.76 : 0.6) * R;
  const tailleNom = (m.sansCercle ? 0.22 : 0.2) * R;
  const yDate = cy + (m.sansCercle ? 0.94 : 0.8) * R;
  const tailleDate = 0.066 * R;

  // Le semis de fond et le décor : fixes pour un signe, loin des tracés et
  // des inscriptions, dans le cercle (ou dans sa place, sans cercle).
  const alea = hasard(`${m.id}-${Math.round(R)}`);
  const libre = (p: Pt, marge: number) => {
    if (segs.some(([a, b]) => distanceAuSegment(p, a, b) < marge)) return false;
    if (astres.some((a) => Math.hypot(a.x - p.x, a.y - p.y) < marge * 1.4)) return false;
    if (Math.abs(p.y - (yNom - tailleNom * 0.3)) < tailleNom * 0.75 && Math.abs(p.x - cx) < R * 0.55) return false;
    if (m.date && m.placeDate === "dedans" && Math.abs(p.y - yDate) < tailleDate * 1.6 && Math.abs(p.x - cx) < R * 0.55)
      return false;
    return true;
  };
  const auHasard = (bord: number): Pt => {
    if (m.sansCercle) return { x: cx + (alea() * 2 - 1) * R * 1.08, y: cy + (alea() * 2 - 1) * R * 0.98 };
    const a = alea() * Math.PI * 2;
    const r = Math.sqrt(alea()) * R * bord;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  };
  const semis: string[] = [];
  for (let n = 0, essais = 0; n < 120 && essais < 2000; essais++) {
    const p = auHasard(0.96);
    if (!libre(p, R * 0.025)) continue;
    n++;
    semis.push(
      `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(R * (0.0025 + alea() * 0.0035)).toFixed(1)}" fill-opacity="${(0.3 + alea() * 0.45).toFixed(2)}"/>`,
    );
  }
  const decor: string[] = [];
  for (let n = 0, essais = 0; n < 7 && essais < 3000; essais++) {
    const p = auHasard(0.86);
    if (!libre(p, R * 0.09)) continue;
    n++;
    decor.push(`<path d="${etoileQuatre(p.x, p.y, R * (0.018 + alea() * 0.022))}"/>`);
  }
  const ronds: string[] = [];
  for (let n = 0, essais = 0; n < 6 && essais < 3000; essais++) {
    const p = auHasard(0.86);
    if (!libre(p, R * 0.08)) continue;
    n++;
    ronds.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(R * (0.008 + alea() * 0.008)).toFixed(1)}"/>`);
  }

  // Les tracés en pointillés, écartés des étoiles qu'ils relient.
  const tirets = segs
    .map(([a, b]) => {
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      const ra = rayon(astres.find((s) => Math.hypot(s.x - a.x, s.y - a.y) < 1)?.mag ?? 4.5) * 1.5;
      const rb = rayon(astres.find((s) => Math.hypot(s.x - b.x, s.y - b.y) < 1)?.mag ?? 4.5) * 1.5;
      if (l <= ra + rb) return "";
      const ux = (b.x - a.x) / l;
      const uy = (b.y - a.y) / l;
      return `M${(a.x + ux * ra).toFixed(1)} ${(a.y + uy * ra).toFixed(1)}L${(b.x - ux * rb).toFixed(1)} ${(b.y - uy * rb).toFixed(1)}`;
    })
    .join("");
  const brillantes = astres
    .filter((a) => a.mag < 2.2)
    .map((a) => `<circle cx="${a.x.toFixed(1)}" cy="${a.y.toFixed(1)}" r="${(rayon(a.mag) * 3).toFixed(1)}"/>`)
    .join("");
  const formes = astres.map((a) => `<path d="${etoileCinq(a.x, a.y, rayon(a.mag))}"/>`).join("");

  const c = m.couleurs;
  const nom = echappe(nomDuSigne(m.id, m.langue));
  let date = "";
  if (m.date && m.placeDate === "dedans")
    date = `<text x="${cx}" y="${yDate.toFixed(1)}" text-anchor="middle" font-family="DM Serif Display, serif" font-size="${tailleDate.toFixed(1)}" letter-spacing="${(tailleDate * 0.18).toFixed(1)}" fill="${c.dorures}">${echappe(m.date)}</text>`;
  else if (m.date) date = dateEnArc(m.date, cx, cy, R, m.placeDate === "arc-gauche" ? 222 : 22, c.dorures);

  return `<g>
    <g fill="${c.etoiles}">${semis.join("")}</g>
    <g fill="${c.etoiles}" fill-opacity="0.75">${decor.join("")}</g>
    <g fill="none" stroke="${c.etoiles}" stroke-opacity="0.6" stroke-width="${(R * 0.0045).toFixed(1)}">${ronds.join("")}</g>
    <path d="${tirets}" fill="none" stroke="${c.dorures}" stroke-width="${Math.max(3, R * 0.0055).toFixed(1)}" stroke-dasharray="${(R * 0.02).toFixed(1)} ${(R * 0.016).toFixed(1)}" stroke-linecap="round"/>
    <g fill="url(#halo-signe)">${brillantes}</g>
    <g fill="${c.etoiles}">${formes}</g>
    <text x="${cx}" y="${yNom.toFixed(1)}" text-anchor="middle" font-family="Great Vibes, Parisienne, cursive" font-size="${tailleNom.toFixed(1)}" fill="${c.dorures}">${nom}</text>
    ${date}
  </g>`;
}

/** Largeur approchée d'une capitale de DM Serif Display, en em. */
function chasse(ch: string): number {
  if (ch === " ") return 0.26;
  if (/[0-9]/.test(ch)) return 0.55;
  if (/[.,]/.test(ch)) return 0.25;
  if (/[IJ]/.test(ch)) return 0.36;
  if (/[MWÆŒ]/.test(ch)) return 0.88;
  return 0.66;
}

/**
 * La date écrite le long du bord extérieur d'un cercle, lettre à lettre
 * (librsvg ne sait pas suivre un <textPath>) : centrée sur l'angle `centre`
 * (degrés, 0 à droite, sens des aiguilles d'une montre), pieds des lettres
 * vers le cercle, lue dans le sens des aiguilles d'une montre.
 */
function dateEnArc(texte: string, cx: number, cy: number, R: number, centre: number, couleur: string): string {
  const taille = R * 0.085;
  const espace = taille * 0.16;
  const rayon = R + taille * 0.75;
  const largeurs = [...texte].map((ch) => chasse(ch) * taille + espace);
  const total = largeurs.reduce((s, x) => s + x, 0) - espace;
  let a = centre * RAD - total / rayon / 2;
  const lettres: string[] = [];
  for (const [i, ch] of [...texte].entries()) {
    const w = largeurs[i]!;
    const milieu = a + (w - espace) / 2 / rayon;
    const x = cx + rayon * Math.cos(milieu);
    const y = cy + rayon * Math.sin(milieu);
    if (ch !== " ")
      lettres.push(
        `<text transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(milieu / RAD + 90).toFixed(2)})" text-anchor="middle">${echappe(ch)}</text>`,
      );
    a += w / rayon;
  }
  return `<g font-family="DM Serif Display, serif" font-size="${taille.toFixed(1)}" fill="${couleur}">${lettres.join("")}</g>`;
}

/** Le dégradé du halo des étoiles brillantes d'un signe (à mettre dans <defs>). */
export function defsDuSigne(etoiles: string, halo: number): string {
  return `<radialGradient id="halo-signe">
      <stop offset="0" stop-color="${etoiles}" stop-opacity="${(halo * 0.8).toFixed(2)}"/>
      <stop offset="1" stop-color="${etoiles}" stop-opacity="0"/>
    </radialGradient>`;
}

/** Une petite étoile à quatre branches (le lien entre les deux cercles d'un couple). */
export function petiteEtoile(x: number, y: number, r: number, couleur: string): string {
  return `<path d="${etoileQuatre(x, y, r)}" fill="${couleur}"/>`;
}

/** Pour les essais : les tracés d'un signe, et leur centre en ascension droite / déclinaison. */
export function centreDesTraces(id: IdSigne): { ra: number; de: number } {
  const brut = SIGNES[id].traces.map((r) => CONSTELLATIONS[r] ?? []);
  const ras: number[] = [];
  const des: number[] = [];
  const ref = brut[0]?.[0] ?? 0;
  for (const t of brut)
    for (let i = 0; i + 1 < t.length; i += 2) {
      ras.push(ref + ((((t[i]! - ref) % 360) + 540) % 360) - 180);
      des.push(t[i + 1]!);
    }
  const ra = (Math.min(...ras) + Math.max(...ras)) / 2;
  return { ra: ((ra % 360) + 360) % 360, de: (Math.min(...des) + Math.max(...des)) / 2 };
}
