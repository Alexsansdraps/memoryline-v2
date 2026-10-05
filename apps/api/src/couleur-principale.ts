/**
 * La couleur PRINCIPALE des pièces : la part du dessin que peint chaque zone.
 *
 * Une catégorie de pièces peut ne proposer au client que la couleur
 * principale de chaque pièce — la calotte d'un chapeau, pas son ruban
 * (cf. couleurs-groupes.ts, groupesProposesDeLaPiece). « Principale » veut
 * dire la plus ÉTENDUE : dans les dessins d'Illustrator, la première zone est
 * trop souvent un détail (les chaussures sous un pantalon, le contour d'une
 * casquette), et la désigner proposerait au client de colorer ce détail-là.
 *
 * La mesure se fait sur un petit rendu du dessin (couleurs-dessins.ts), une
 * fois par dessin, et se range avec la pièce (`asset.parts_des_zones`) : le
 * configurateur et le back-office la lisent sans rien recalculer, et disent
 * donc la même chose.
 *
 * UNE MESURE PORTE SA SIGNATURE — l'adresse du dessin et les noms de ses
 * zones. Un dessin remplacé (« Détecter les couleurs », nouveau fichier)
 * rend l'ancienne mesure caduque : elle est ignorée tout de suite, et refaite
 * en arrière-plan. Faute de mesure, la principale est le premier groupe.
 *
 * L'impression n'en dépend pas : la règle ne décide que des pastilles
 * proposées, jamais des couleurs dessinées.
 */
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "./db/client.js";
import { partsDesZones } from "./couleurs-dessins.js";

/** Ce qui est rangé en base : la mesure et le dessin pour lequel elle vaut. */
export interface MesureDesZones {
  signature: string;
  parts: Record<string, number>;
}

/** Ce qu'il faut savoir d'une pièce pour la mesurer. */
interface PieceAMesurer {
  id: number;
  svgUrl: string;
  colorZones: Record<string, string> | null;
  partsDesZones?: MesureDesZones | null;
}

/** Le dessin pour lequel une mesure vaut : son adresse et ses zones. */
export function signatureDuDessin(
  svgUrl: string,
  zones: Record<string, string> | null | undefined,
): string {
  return `${svgUrl}|${Object.keys(zones ?? {}).sort().join(",")}`;
}

/**
 * Les parts à envoyer au configurateur et au back-office : celles de la
 * mesure si elle vaut pour le dessin actuel de la pièce, sinon rien (la
 * principale retombe alors sur le premier groupe, le temps de la mesure).
 */
export function partsPourLaBoutique(piece: {
  svgUrl: string;
  colorZones: Record<string, string> | null;
  partsDesZones?: MesureDesZones | null;
}): Record<string, number> | null {
  const mesure = piece.partsDesZones;
  if (!mesure || typeof mesure !== "object") return null;
  if (mesure.signature !== signatureDuDessin(piece.svgUrl, piece.colorZones)) return null;
  return mesure.parts ?? null;
}

/** Les pièces en cours de mesure : deux demandes pour la même n'en font qu'une. */
const enCours = new Set<number>();

/**
 * Mesure une pièce si sa mesure manque ou ne vaut plus pour son dessin.
 *
 * Appelée après chaque enregistrement qui peut changer le dessin ou ses
 * zones, sans l'attendre : une erreur de rendu ne doit jamais faire échouer
 * l'enregistrement — la pièce garde alors le premier groupe pour principale.
 */
export async function mesurerLaPiece(id: number): Promise<void> {
  if (enCours.has(id)) return;
  enCours.add(id);
  try {
    const [piece] = await db
      .select({
        id: schema.assets.id,
        svgUrl: schema.assets.svgUrl,
        colorZones: schema.assets.colorZones,
        partsDesZones: schema.assets.partsDesZones,
      })
      .from(schema.assets)
      .where(eq(schema.assets.id, id));
    if (piece) await mesurerSiBesoin(piece);
  } catch (e) {
    console.warn(`[couleur principale] pièce ${id} : ${String(e)}`);
  } finally {
    enCours.delete(id);
  }
}

async function mesurerSiBesoin(piece: PieceAMesurer): Promise<boolean> {
  const zones = piece.colorZones ?? {};
  // Une seule zone, ou aucune (dessin en pixels) : rien à départager.
  if (Object.keys(zones).length < 2) return false;
  const signature = signatureDuDessin(piece.svgUrl, zones);
  if (piece.partsDesZones?.signature === signature) return false;
  const parts = await partsDesZones(piece.svgUrl, zones);
  if (!parts) return false;
  await db
    .update(schema.assets)
    .set({ partsDesZones: { signature, parts } })
    .where(eq(schema.assets.id, piece.id));
  return true;
}

/**
 * Au démarrage de l'API, les pièces jamais mesurées — ou dont le dessin a
 * changé sans passer par le back-office — le sont, une à une, en
 * arrière-plan. Quelques dizaines de millisecondes par pièce : la première
 * mise en ligne mesure toute la bibliothèque en quelques secondes, les
 * suivantes ne refont que ce qui a changé.
 */
export function demarrerMesureDesPieces(): void {
  const minuterie = setTimeout(() => void mesurerToutes(), 5_000);
  minuterie.unref?.();
}

async function mesurerToutes(): Promise<void> {
  try {
    const pieces = await db
      .select({
        id: schema.assets.id,
        svgUrl: schema.assets.svgUrl,
        colorZones: schema.assets.colorZones,
        partsDesZones: schema.assets.partsDesZones,
      })
      .from(schema.assets)
      .where(and(isNull(schema.assets.archivedAt), isNotNull(schema.assets.colorZones)));
    let mesurees = 0;
    for (const piece of pieces) {
      if (enCours.has(piece.id)) continue;
      enCours.add(piece.id);
      try {
        if (await mesurerSiBesoin(piece)) mesurees++;
      } catch (e) {
        console.warn(`[couleur principale] pièce ${piece.id} : ${String(e)}`);
      } finally {
        enCours.delete(piece.id);
      }
    }
    if (mesurees)
      console.log(`[couleur principale] ${mesurees} pièce(s) mesurée(s)`);
  } catch (e) {
    console.warn(`[couleur principale] mesure impossible : ${String(e)}`);
  }
}
