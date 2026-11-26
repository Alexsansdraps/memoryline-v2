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
import { IA_DIR, fabriquerApercu, ipDeLaRequete } from "./ia.js";
import { clientDeLaRequete } from "./comptes.js";

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

/** Une coordonnée lisible : « 47,75° N · 7,34° E ». */
function coordonnees(lat: number, lon: number): string {
  const f = (v: number) => Math.abs(v).toFixed(2).replace(".", ",");
  return `${f(lat)}° ${lat >= 0 ? "N" : "S"}   ·   ${f(lon)}° ${lon >= 0 ? "E" : "O"}`;
}

/** Le SVG du fond, à la taille du fichier. */
export function svgDuCiel(lat: number, lon: number, instant: Date): string {
  const W = LARGEUR_CIEL;
  const H = HAUTEUR_CIEL;
  const cx = W / 2;
  // Le cercle laisse le haut libre (26/11, « descends un peu le cercle on
  // doit pouvoir avoir la place pour le texte ») : les lignes de texte de
  // l'affiche s'empilent en haut, sur le premier petit tiers.
  const cy = H * 0.55;
  const R = W * 0.34;
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
  const collineLoin = `M0 ${H * 0.895} C ${W * 0.18} ${H * 0.865}, ${W * 0.36} ${H * 0.885}, ${W * 0.55} ${H * 0.878} S ${W * 0.85} ${H * 0.86}, ${W} ${H * 0.875} L ${W} ${H} L 0 ${H} Z`;
  const collinePres = `M0 ${H * 0.925} C ${W * 0.22} ${H * 0.9}, ${W * 0.45} ${H * 0.917}, ${W * 0.62} ${H * 0.912} S ${W * 0.88} ${H * 0.895}, ${W} ${H * 0.908} L ${W} ${H} L 0 ${H} Z`;

  const etiquette = (txt: string, x: number, y: number) =>
    `<text x="${x.toFixed(0)}" y="${y.toFixed(0)}" text-anchor="middle" dominant-baseline="middle">${txt}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="nuit" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0b1424"/>
      <stop offset="0.75" stop-color="#16243d"/>
      <stop offset="1" stop-color="#1f3050"/>
    </linearGradient>
    <radialGradient id="dome" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#1c2c4a"/>
      <stop offset="1" stop-color="#121e35"/>
    </radialGradient>
    <radialGradient id="halo">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="cercle"><circle cx="${cx}" cy="${cy}" r="${R}"/></clipPath>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#nuit)"/>
  <circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#dome)"/>
  <g clip-path="url(#cercle)">
    <path d="${traits.join("")}" stroke="#cdd8ec" stroke-opacity="0.35" stroke-width="3" fill="none" stroke-linecap="round"/>
    <g fill="url(#halo)">${brillantes.join("")}</g>
    <g fill="#fbf7ec">${etoiles.join("")}</g>
  </g>
  <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#d9c38f" stroke-width="5"/>
  <circle cx="${cx}" cy="${cy}" r="${R + 22}" fill="none" stroke="#d9c38f" stroke-opacity="0.45" stroke-width="2"/>
  <g font-family="League Spartan, DejaVu Sans, sans-serif" font-size="46" fill="#d9c38f" letter-spacing="4">
    ${etiquette("N", cx, cy - R - 70)}
    ${etiquette("S", cx, cy + R + 70)}
    ${etiquette("E", cx - R - 70, cy)}
    ${etiquette("O", cx + R + 70, cy)}
  </g>
  <text x="${cx}" y="${cy + R + 180}" text-anchor="middle" font-family="League Spartan, DejaVu Sans, sans-serif" font-size="44" fill="#d9c38f" fill-opacity="0.85" letter-spacing="3">${coordonnees(lat, lon)}</text>
  <path d="${collineLoin}" fill="#101a2c"/>
  <path d="${collinePres}" fill="#0a111e"/>
</svg>`;
}

/** Le fond en PNG. */
export async function rendreCiel(lat: number, lon: number, instant: Date): Promise<Buffer> {
  return sharp(Buffer.from(svgDuCiel(lat, lon, instant))).png().toBuffer();
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

/** Cadence : un ciel se calcule en une seconde, pas besoin de plus de 10 par minute. */
const appels = new Map<string, number[]>();
function tropDAppels(ip: string): boolean {
  const maintenant = Date.now();
  const recents = (appels.get(ip) ?? []).filter((t) => maintenant - t < 60_000);
  recents.push(maintenant);
  appels.set(ip, recents);
  if (appels.size > 5000)
    for (const [k, v] of appels) if (!v.some((t) => maintenant - t < 60_000)) appels.delete(k);
  return recents.length > 10;
}

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
   * POST /ia/ciel { productId, cartId, date: "AAAA-MM-JJ", heure: "HH:MM",
   *                 fuseau: "Europe/Paris", lat, lon, lieu }
   * → { publicId, status: "prete", apercu } — la même réponse que /ia/generer.
   */
  app.post("/ia/ciel", async (c: Context) => {
    const ip = ipDeLaRequete(c);
    if (tropDAppels(ip))
      return c.json({ error: "Trop de demandes d'affilée, réessayez dans une minute" }, 429);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const productId = Number(b.productId);
    const lat = Number(b.lat);
    const lon = Number(b.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
      return c.json({ error: "Lieu invalide" }, 400);
    const fuseau = String(b.fuseau ?? "Europe/Paris").slice(0, 64);
    const instant = instantLocal(String(b.date ?? ""), String(b.heure ?? ""), fuseau);
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
    try {
      const pleine = await rendreCiel(lat, lon, instant);
      const nomPleine = `${publicId}-pleine.png`;
      await writeFile(resolve(IA_DIR, nomPleine), pleine);
      const apercu = await fabriquerApercu(pleine, `${publicId}-apercu.jpg`);
      await db.insert(schema.aiGenerations).values({
        publicId,
        productId: produit.id,
        cartId: b.cartId ? String(b.cartId).slice(0, 100) : null,
        customerId: client?.id ?? null,
        sourcePath: null,
        // Ce qui a servi au calcul, lisible au back-office à la place d'une consigne.
        prompt: JSON.stringify({
          ciel: true,
          date: b.date,
          heure: b.heure,
          fuseau,
          lieu,
          lat,
          lon,
          utc: instant.toISOString(),
        }),
        model: "ciel",
        size: `${LARGEUR_CIEL}x${HAUTEUR_CIEL}`,
        status: "prete",
        previewPath: apercu,
        fullPath: `ia/${nomPleine}`,
        costCents: 0,
        ip,
      });
      console.log(`[ciel] ${publicId} : ${lieu || `${lat},${lon}`} le ${instant.toISOString()}`);
      return c.json({ publicId, status: "prete", apercu: `/ia/apercu/${publicId}` });
    } catch (e) {
      console.error("Ciel étoilé : rendu impossible :", e instanceof Error ? e.message : e);
      return c.json({ error: "Le ciel n'a pas pu être dessiné, réessayez." }, 500);
    }
  });
}
