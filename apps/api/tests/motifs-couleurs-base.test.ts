/**
 * Le contrôle de la couleur d'un motif dans une ligne de panier (28/11,
 * motifs-couleurs.ts, couleurDuMotifRefusee) — sur la base LOCALE, en
 * lecture seule : rien n'est écrit.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/motifs-couleurs-base.test.ts
 *
 * Ce que le serveur accepte pour un motif : une couleur de la palette du
 * back-office, ou celles d'avant la palette (le trait du dessin, le blanc)
 * pour les paniers déjà faits ; ses détails seulement crème, transparents
 * (l'ancien « en blanc ») ou sombres. Une ligne sans motif passe sans rien
 * regarder.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import type { PosterConfig } from "@memoryline/types";

const baseLocale =
  /@db18?:5432\//.test(process.env.DATABASE_URL ?? "") && process.env.NODE_ENV !== "production";

after(async () => {
  if (!baseLocale) return;
  const { sql } = await import("../src/db/client.js");
  await sql.end({ timeout: 5 });
});

/** Une ligne de panier : le motif (s'il y en a un) en tête, puis un personnage. */
function ligne(motif: { typeId: number; colors: Record<string, string>; assets?: Record<string, string> } | null): PosterConfig {
  return {
    schemaVersion: 1,
    view: "back",
    texts: { lines: [{ value: "HÔTEL DE VILLE" }] },
    characters: [
      ...(motif ? [{ typeId: motif.typeId, position: 0, x: 0.5, y: 0.45, scale: 3.6, assets: motif.assets ?? {}, colors: motif.colors }] : []),
      { typeId: 6, position: 1, x: 0.5, y: 0.816, scale: 0.7, assets: {}, colors: { "base:st0": "#123456" } },
    ],
  } as PosterConfig;
}

test(
  "couleur d'un motif : la palette et les couleurs d'avant passent, le reste est refusé",
  { skip: !baseLocale && "hors de la base locale du conteneur" },
  async () => {
    const { couleurDuMotifRefusee } = await import("../src/motifs-couleurs.js");
    const { db, schema } = await import("../src/db/client.js");
    const { eq } = await import("drizzle-orm");
    const [hotel] = await db
      .select({ id: schema.characterTypes.id })
      .from(schema.characterTypes)
      .where(eq(schema.characterTypes.slug, "motif-hotel-de-ville"));
    const [maisons] = await db
      .select({ id: schema.characterTypes.id })
      .from(schema.characterTypes)
      .where(eq(schema.characterTypes.slug, "motif-maisons-alsaciennes"));
    assert.ok(hotel && maisons, "les motifs de 0121 sont en base");

    // Sans motif : rien à regarder (le personnage a pourtant une couleur libre).
    assert.equal(await couleurDuMotifRefusee(ligne(null)), null);
    // Les couleurs du dessin, sans rien d'écrit.
    assert.equal(await couleurDuMotifRefusee(ligne({ typeId: hotel.id, colors: {} })), null);
    // Une couleur de la palette, foncée : les détails crème ne s'écrivent pas.
    assert.equal(await couleurDuMotifRefusee(ligne({ typeId: hotel.id, colors: { "base:st0": "#A4161A" } })), null);
    // Une couleur claire : les détails passent au trait sombre.
    assert.equal(
      await couleurDuMotifRefusee(ligne({ typeId: hotel.id, colors: { "base:st0": "#F4ECDD", "base:st1": "#2B2B2B" } })),
      null,
    );
    // Le « blanc » d'avant la palette, intérieurs transparents (paniers déjà faits).
    assert.equal(
      await couleurDuMotifRefusee(ligne({ typeId: hotel.id, colors: { "base:st0": "#FFFFFF", "base:st1": "#FFF8EC00" } })),
      null,
    );
    // Les façades des maisons gardent leurs couleurs.
    assert.equal(
      await couleurDuMotifRefusee(ligne({ typeId: maisons.id, colors: { "base:st0": "#9CC3D5", "base:st4": "#2B2B2B" } })),
      null,
    );
    // Refusés : une couleur hors palette, un détail recoloré, une façade
    // repeinte, une zone inventée, une pièce sur un motif.
    assert.equal(await couleurDuMotifRefusee(ligne({ typeId: hotel.id, colors: { "base:st0": "#FF00FF" } })), "couleur_motif");
    assert.equal(
      await couleurDuMotifRefusee(ligne({ typeId: hotel.id, colors: { "base:st0": "#A4161A", "base:st1": "#00FF00" } })),
      "couleur_motif",
    );
    assert.equal(
      await couleurDuMotifRefusee(ligne({ typeId: maisons.id, colors: { "base:st1": "#000000" } })),
      "couleur_motif",
    );
    assert.equal(await couleurDuMotifRefusee(ligne({ typeId: hotel.id, colors: { "base:st9": "#2B2B2B" } })), "couleur_motif");
    assert.equal(await couleurDuMotifRefusee(ligne({ typeId: hotel.id, colors: { "clothes:st0": "#2B2B2B" } })), "couleur_motif");
    assert.equal(
      await couleurDuMotifRefusee(ligne({ typeId: hotel.id, colors: {}, assets: { hair: "3" } })),
      "motif_invalide",
    );
  },
);
