/**
 * Réutiliser une image de BO › Affiches IA (20/11).
 *
 * Alexandra : « dans le BO, l'endroit où on a les images générées par
 * chatgpt, on pourrait voir pour les réutiliser donc possibilité de créer une
 * fiche produit avec l'image […] ou créer une affiche ». Puis, sur la nature
 * de ces images : « non c juste les affiches sans texte sans personnages ».
 * Ce sont donc des FONDS — des décors nus —, et c'est ainsi qu'on les
 * réutilise :
 *
 *  - « Créer une fiche produit » : l'image devient le décor d'une affiche
 *    PERSONNALISABLE, créée désactivée. Cette route-ci ne fait que recopier
 *    l'image parmi les décors (data/assets, servie par /assets/:file comme
 *    les autres) ; la fiche, elle, se crée par le chemin ordinaire du
 *    back-office (POST /admin/products), celui de « Nouvelle affiche ».
 *  - « Créer une affiche » : le module de personnalisation complet du site,
 *    ouvert dans une fenêtre du back-office (page /atelier-affiche du site),
 *    avec l'image en fond. Sans panier ni commande : la configuration validée
 *    arrive ici, et repart en PDF d'impression — le même moteur, les mêmes
 *    données que le fichier d'une commande (fichiers-impression.ts).
 *
 * Réservé à la propriétaire, comme tout /admin/* qui n'est pas une lecture
 * du vendeur (garde de index.ts).
 */
import { copyFile, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { posterConfigSchema, type PosterConfig, type PosterFormat } from "@memoryline/types";
import { db, schema } from "./db/client.js";
import { cheminDisque } from "./ia.js";
import { renderPosterPdf } from "./pdf.js";
import { donneesDImpression, enFile, raisonLisible } from "./fichiers-impression.js";

/** Mêmes assets que le reste de l'API (cf. ASSETS_DIR dans index.ts). */
const ASSETS_DIR = resolve(fileURLToPath(import.meta.url), "../../../../data/assets");

/**
 * Les prix d'une affiche personnalisable quand le catalogue n'en dit rien :
 * ceux de presque toutes les affiches au 20/11 (162 sur 162).
 */
const PRIX_DE_REPLI = [
  { format: "A4", priceCents: 2300 },
  { format: "A3", priceCents: 2900 },
];

/** La génération et le chemin disque de sa pleine définition, s'il existe encore. */
async function pleineDefinition(
  publicId: string,
): Promise<{ chemin: string; relatif: string } | null> {
  // Colonnes nommées une à une : la table reçoit des colonnes en ce moment
  // (« Créer un fond »), un select() complet échouerait sur une base qui n'a
  // pas encore reçu la migration.
  const [g] = await db
    .select({ fullPath: schema.aiGenerations.fullPath })
    .from(schema.aiGenerations)
    .where(eq(schema.aiGenerations.publicId, publicId));
  const chemin = cheminDisque(g?.fullPath);
  if (!g?.fullPath || !chemin) return null;
  try {
    await stat(chemin);
  } catch {
    // Purgée entre-temps : l'écran ne propose plus rien pour elle.
    return null;
  }
  return { chemin, relatif: g.fullPath };
}

/**
 * Les prix les plus courants des affiches personnalisables en ligne, format
 * par format. Une fiche créée depuis une image part au prix de toutes les
 * autres ; Margaux le change sur la fiche si celle-ci vaut autre chose.
 */
async function prixHabituels(): Promise<{ format: string; priceCents: number }[]> {
  const lignes = await db
    .select({
      format: schema.variants.format,
      priceCents: schema.variants.priceCents,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.variants)
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(
      and(
        eq(schema.products.kind, "personnalisable"),
        eq(schema.products.status, "active"),
      ),
    )
    .groupBy(schema.variants.format, schema.variants.priceCents);
  const meilleur = new Map<string, { priceCents: number; n: number }>();
  for (const l of lignes) {
    if (!l.format || !(l.priceCents > 0)) continue;
    const deja = meilleur.get(l.format);
    if (!deja || l.n > deja.n) meilleur.set(l.format, { priceCents: l.priceCents, n: l.n });
  }
  const prix = PRIX_DE_REPLI.map((p) => ({
    format: p.format,
    priceCents: meilleur.get(p.format)?.priceCents ?? p.priceCents,
  }));
  return prix;
}

/**
 * La configuration à imprimer : celle du module, dont le FOND est imposé
 * ici. Ce que le navigateur envoie comme fond (adresse, identifiant) est
 * écarté : le PDF ne peut porter que l'image de cette génération, jamais un
 * fichier désigné par la page.
 *
 * L'avant-plan aussi (relecture du 20/11) : `foregroundUrl` est une ADRESSE
 * que le moteur du PDF va lire — un fichier de data/assets, voire une page
 * du réseau. L'atelier n'en envoie jamais (l'image n'est pas une fiche, elle
 * n'a pas de muret) ; une page qui en enverrait un ferait lire au serveur ce
 * qu'elle veut. La vue de dos garde son muret officiel, posé par le moteur.
 */
export function configDeLAtelier(config: PosterConfig, relatif: string): PosterConfig {
  const {
    backgroundId: _id,
    aiPublicId: _ia,
    aiApercuUrl: _apercu,
    foregroundUrl: _avantPlan,
    // Le cadre ne s'imprime pas (il s'ajoute au colis), et l'image n'est pas
    // un produit : ni l'un ni l'autre n'a de sens ici.
    frameId: _cadre,
    productId: _produit,
    ...reste
  } = config;
  return { ...reste, backgroundUrl: relatif };
}

export function mountIaReutiliser(app: Hono): void {
  /**
   * Recopie l'image parmi les décors, et dit à quels prix créer la fiche.
   *
   * Une COPIE, et non un lien vers data/assets/ia : ce dossier-là n'est pas
   * servi au public, et la purge des photos de visiteurs y passe. Le décor
   * d'une affiche en vente doit vivre aussi longtemps qu'elle, et se
   * réimprimer des années plus tard.
   */
  app.post("/admin/ia/:publicId/decor", async (c) => {
    const source = await pleineDefinition(c.req.param("publicId"));
    if (!source)
      return c.json(
        { error: "L'image en pleine définition n'est plus sur le serveur (purgée)." },
        404,
      );
    const ext = extname(source.chemin).toLowerCase() || ".png";
    const nom = `decor-ia-${c.req.param("publicId").replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase()}-${randomBytes(3).toString("hex")}${ext}`;
    await copyFile(source.chemin, resolve(ASSETS_DIR, nom));
    return c.json({ url: `/assets/${nom}`, variants: await prixHabituels() });
  });

  /**
   * Le PDF d'impression d'une affiche composée dans le module, sur cette
   * image. Rien n'est enregistré : ni commande, ni ligne, ni fichier — le
   * PDF part au navigateur et c'est tout. Il passe dans la file des
   * fabrications avec la priorité d'une demande au back-office, pour ne pas
   * doubler les fichiers des commandes.
   */
  app.post("/admin/ia/:publicId/affiche.pdf", async (c) => {
    const source = await pleineDefinition(c.req.param("publicId"));
    if (!source)
      return c.json(
        { error: "L'image en pleine définition n'est plus sur le serveur (purgée)." },
        404,
      );
    const b = await c.req.json().catch(() => null);
    const lue = posterConfigSchema.safeParse(b?.config);
    if (!lue.success) return c.json({ error: "Affiche illisible." }, 400);
    const format: PosterFormat = lue.data.format === "A3" ? "A3" : "A4";
    const config = configDeLAtelier({ ...lue.data, format }, source.relatif);
    try {
      const data = await donneesDImpression();
      const pdf = await enFile("demande", () => renderPosterPdf(config, { data, format }));
      return c.body(new Uint8Array(pdf), 200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="affiche-${format}.pdf"`,
        "Cache-Control": "private, no-store",
      });
    } catch (e) {
      console.error("[atelier affiche IA]", e);
      return c.json({ error: raisonLisible(e) }, 500);
    }
  });
}
