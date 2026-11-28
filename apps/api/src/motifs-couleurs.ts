/**
 * La palette des couleurs des MOTIFS (28/11, affiche éphémère du stand de
 * Mulhouse). Alexandra, devant « Couleur du motif », qui ne proposait que le
 * trait sombre et le blanc : « faut qu'on puisse mettre des couleurs pour les
 * images dans le BO, dans un premier temps mets en 10 par défaut qui
 * pourraient aller à tous, modifiable dans le BO ».
 *
 * Rangée dans le réglage `motifs.couleurs` (BO › Personnages › Couleurs des
 * motifs, apps/admin/src/pages/motifs-couleurs.astro) : une liste de
 * { id, nom, hex, actif, noms }, dans l'ordre où la cliente la voit. Absent,
 * vide ou illisible : les dix couleurs de base ci-dessous, choisies pour aller
 * avec les dix-neuf fonds de l'affiche (planches de contrôle
 * travaux/affiche-stand-mulhouse/captures/reglages-palette-fonds-*.jpg :
 * chaque couleur sur chaque fond, avec trois motifs).
 *
 * Ce module :
 *   - lit et assainit le réglage (couleursDuReglage, lireCouleursMotifs) ;
 *   - le sert à la fiche, dans la langue de la page (couleursPubliques) ;
 *   - sait CONTRÔLER la couleur d'un motif dans une ligne de panier
 *     (couleurDuMotifRefusee) : la silhouette ne prend qu'une couleur de la
 *     palette — ou celles d'avant la palette, le trait sombre du dessin et le
 *     blanc, pour les paniers déjà faits — et les détails seulement ce que le
 *     module leur donne (leur couleur, transparente, ou le trait sombre).
 *     PAS BRANCHÉ sur les routes du panier (28/11 : « touche pas aux
 *     commandes », règle d'Alexandra du 21/11) : la brancher demande son
 *     accord ; en attendant, seule la fiche limite le choix à la palette, et
 *     le prix n'en dépend pas.
 *
 * La façon dont une couleur se pose sur le dessin (les détails crème qui
 * passent au sombre sur une couleur claire) vit dans le configurateur
 * (packages/configurator/src/store.ts, couleursDuMotif) : elle est écrite
 * dans la configuration, et le fichier d'impression la relit telle quelle.
 */
import { eq, like } from "drizzle-orm";
import type { PosterConfig } from "@memoryline/types";
import { db, schema } from "./db/client.js";

export const REGLAGE_COULEURS_MOTIFS = "motifs.couleurs";

/** Le trait sombre des motifs, tel que dessiné (le même que store.ts du configurateur). */
export const TRAIT_DES_MOTIFS = "#2B2B2B";

/** Les langues du site autres que le français. */
const LANGUES = ["en", "de", "it", "es", "ja", "zh"] as const;
type LangueEtrangere = (typeof LANGUES)[number];

export interface CouleurMotif {
  /** Identifiant stable (« rouge-noel ») : jamais montré. */
  id: string;
  /** Le nom en français, montré au back-office et à la cliente française. */
  nom: string;
  /** « #RRGGBB ». */
  hex: string;
  /** Proposée à la cliente ; décochée, elle reste au back-office. */
  actif: boolean;
  /** Le nom dans les autres langues ; une langue absente lit le français. */
  noms?: Partial<Record<LangueEtrangere, string>>;
}

/**
 * Les dix couleurs de base : cinq foncées (anthracite, rouge Noël, vert
 * sapin, bleu nuit, bordeaux) qui se lisent sur les fonds clairs, cinq
 * claires (crème, or, ocre, bleu ciel, rose poudré) qui se lisent sur les
 * fonds sombres — tirées des couleurs des fonds et des façades des maisons.
 * Chacun des dix-neuf fonds en a au moins cinq qui s'y détachent.
 */
export const COULEURS_MOTIFS_DE_BASE: CouleurMotif[] = [
  {
    id: "anthracite",
    nom: "Anthracite",
    hex: "#2B2B2B",
    actif: true,
    noms: { en: "Charcoal", de: "Anthrazit", it: "Antracite", es: "Antracita", ja: "チャコール", zh: "炭灰色" },
  },
  {
    id: "creme",
    nom: "Crème",
    hex: "#F4ECDD",
    actif: true,
    noms: { en: "Cream", de: "Creme", it: "Crema", es: "Crema", ja: "クリーム", zh: "奶油色" },
  },
  {
    id: "rouge-noel",
    nom: "Rouge Noël",
    hex: "#A4161A",
    actif: true,
    noms: {
      en: "Christmas red",
      de: "Weihnachtsrot",
      it: "Rosso Natale",
      es: "Rojo Navidad",
      ja: "クリスマスレッド",
      zh: "圣诞红",
    },
  },
  {
    id: "vert-sapin",
    nom: "Vert sapin",
    hex: "#1F4D3A",
    actif: true,
    noms: { en: "Fir green", de: "Tannengrün", it: "Verde abete", es: "Verde abeto", ja: "モミの緑", zh: "冷杉绿" },
  },
  {
    id: "bleu-nuit",
    nom: "Bleu nuit",
    hex: "#1B2A4A",
    actif: true,
    noms: {
      en: "Midnight blue",
      de: "Nachtblau",
      it: "Blu notte",
      es: "Azul noche",
      ja: "ミッドナイトブルー",
      zh: "午夜蓝",
    },
  },
  {
    id: "or",
    nom: "Or",
    hex: "#D4A73B",
    actif: true,
    noms: { en: "Gold", de: "Gold", it: "Oro", es: "Oro", ja: "ゴールド", zh: "金色" },
  },
  {
    id: "bordeaux",
    nom: "Bordeaux",
    hex: "#6B1F2A",
    actif: true,
    noms: { en: "Burgundy", de: "Bordeauxrot", it: "Bordeaux", es: "Burdeos", ja: "ボルドー", zh: "酒红色" },
  },
  {
    id: "ocre",
    nom: "Ocre",
    hex: "#C27A2C",
    actif: true,
    noms: { en: "Ochre", de: "Ocker", it: "Ocra", es: "Ocre", ja: "オーカー", zh: "赭石色" },
  },
  {
    id: "bleu-ciel",
    nom: "Bleu ciel",
    hex: "#9CC3D5",
    actif: true,
    noms: { en: "Sky blue", de: "Himmelblau", it: "Azzurro", es: "Azul cielo", ja: "スカイブルー", zh: "天蓝色" },
  },
  {
    id: "rose-poudre",
    nom: "Rose poudré",
    hex: "#E3A6A0",
    actif: true,
    noms: {
      en: "Powder pink",
      de: "Puderrosa",
      it: "Rosa cipria",
      es: "Rosa empolvado",
      ja: "パウダーピンク",
      zh: "粉红色",
    },
  },
];

const HEX6 = /^#[0-9a-f]{6}$/i;

/** « #abc » ou « #aabbcc » → « #AABBCC » ; null sinon. */
export function hexa6(v: unknown): string | null {
  const t = String(v ?? "").trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(t);
  if (!m) return null;
  const h = m[1]!.length === 3 ? m[1]!.replace(/./g, (c) => c + c) : m[1]!;
  return `#${h.toUpperCase()}`;
}

/** Une couleur lue au réglage, rendue sûre ; null si elle n'a ni nom ni couleur valable. */
export function couleurSure(brut: unknown, rang = 0): CouleurMotif | null {
  if (!brut || typeof brut !== "object") return null;
  const b = brut as Record<string, unknown>;
  const nom = String(b.nom ?? "").trim().slice(0, 40);
  const hex = hexa6(b.hex);
  if (!nom || !hex || !HEX6.test(hex)) return null;
  const id =
    String(b.id ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 40) || `couleur-${rang + 1}`;
  const noms: Partial<Record<LangueEtrangere, string>> = {};
  const brutsNoms = b.noms && typeof b.noms === "object" ? (b.noms as Record<string, unknown>) : {};
  for (const l of LANGUES) {
    const n = String(brutsNoms[l] ?? "").trim().slice(0, 40);
    if (n) noms[l] = n;
  }
  return { id, nom, hex, actif: b.actif !== false, ...(Object.keys(noms).length ? { noms } : {}) };
}

/** Les couleurs telles que réglées (toutes, dans l'ordre), ou celles de base. */
export function couleursDuReglage(valeur: unknown): CouleurMotif[] {
  if (!Array.isArray(valeur)) return COULEURS_MOTIFS_DE_BASE;
  const vus = new Set<string>();
  const liste: CouleurMotif[] = [];
  valeur.forEach((v, i) => {
    const c = couleurSure(v, i);
    if (c && !vus.has(c.id)) {
      vus.add(c.id);
      liste.push(c);
    }
  });
  return liste.length ? liste : COULEURS_MOTIFS_DE_BASE;
}

/** Le réglage lu en base. */
export async function lireCouleursMotifs(): Promise<CouleurMotif[]> {
  const [ligne] = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, REGLAGE_COULEURS_MOTIFS));
  return couleursDuReglage(ligne?.value);
}

/**
 * Les couleurs proposées à la cliente : les activées, dans leur ordre, le nom
 * dans sa langue (le français à défaut). Jamais vide : si la boutique a tout
 * décoché, la première couleur reste, pour que le motif ait une couleur.
 */
export function couleursPubliques(
  liste: readonly CouleurMotif[],
  langue: string,
): { id: string; nom: string; hex: string }[] {
  const actives = liste.filter((c) => c.actif);
  const proposees = actives.length ? actives : liste.slice(0, 1);
  return proposees.map((c) => ({
    id: c.id,
    nom: (c.noms as Record<string, string | undefined> | undefined)?.[langue] || c.nom,
    hex: c.hex,
  }));
}

/* ------------------------------------------------------------------------ *
 * Le contrôle d'une ligne de panier.
 * ------------------------------------------------------------------------ */

/**
 * Les motifs connus (type d'affiche « motifs-… ») et les couleurs de leur
 * dessin, gardés une minute : ce contrôle passe à chaque ajout au panier, et
 * ne doit pas coûter une lecture de plus aux autres affiches.
 */
let motifsEnMemoire: { quand: number; zones: Map<string, Record<string, string>> } | null = null;
async function motifsConnus(): Promise<Map<string, Record<string, string>>> {
  if (motifsEnMemoire && Date.now() - motifsEnMemoire.quand < 60_000) return motifsEnMemoire.zones;
  const lignes = await db
    .select({ id: schema.characterTypes.id, zones: schema.characterTypes.baseColorZones })
    .from(schema.characterTypes)
    .where(like(schema.characterTypes.orientation, "motifs-%"));
  const zones = new Map(lignes.map((l) => [String(l.id), (l.zones ?? {}) as Record<string, string>]));
  motifsEnMemoire = { quand: Date.now(), zones };
  return zones;
}

/** Les couleurs qu'une zone de DÉTAIL peut prendre : la sienne, transparente, ou le trait sombre. */
function detailPermis(valeur: string, defaut: string | undefined): boolean {
  const v = valeur.trim().toUpperCase();
  const d = hexa6(defaut ?? "");
  if (v === TRAIT_DES_MOTIFS) return true;
  if (!d) return false;
  // Transparente : les intérieurs d'un motif « en blanc », avant la palette.
  return v === d || v === `${d}00`;
}

/**
 * La couleur d'un motif dans une ligne de panier est-elle refusée ? Le code
 * de l'erreur, ou null si la ligne passe.
 *
 * Seuls les motifs sont regardés (personnages d'un type d'affiche
 * « motifs-… ») : une ligne sans motif passe sans rien lire de plus que la
 * liste des motifs, gardée en mémoire. Une erreur de lecture laisse passer la
 * ligne (on ne bloque pas une vente sur un contrôle), et se note au journal.
 */
export async function couleurDuMotifRefusee(config: PosterConfig): Promise<string | null> {
  if (!config.characters?.length) return null;
  try {
    const motifs = await motifsConnus();
    const lesMotifs = config.characters.filter((c) => motifs.has(String(c.typeId)));
    if (!lesMotifs.length) return null;
    const palette = new Set((await lireCouleursMotifs()).map((c) => c.hex));
    for (const motif of lesMotifs) {
      const zones = motifs.get(String(motif.typeId)) ?? {};
      // Un motif ne porte aucune pièce : rien à recolorer ailleurs que sur lui.
      if (Object.keys(motif.assets ?? {}).length) return "motif_invalide";
      for (const [cle, valeur] of Object.entries(motif.colors ?? {})) {
        if (typeof valeur !== "string") return "couleur_motif";
        // « base:st0 » (et la clé plate d'avant les scopes, par prudence).
        const zone = cle.startsWith("base:") ? cle.slice(5) : cle;
        if (!/^st\d+$/.test(zone)) return "couleur_motif";
        if (zone === "st0") {
          const hex = hexa6(valeur);
          const permise =
            !!hex &&
            (palette.has(hex) || hex === TRAIT_DES_MOTIFS || hex === "#FFFFFF" || hex === hexa6(zones.st0 ?? ""));
          if (!permise) return "couleur_motif";
          continue;
        }
        if (!(zone in zones) || !detailPermis(valeur, zones[zone])) return "couleur_motif";
      }
    }
    return null;
  } catch (e) {
    console.error("[motifs-couleurs] contrôle impossible, ligne acceptée :", e);
    return null;
  }
}
