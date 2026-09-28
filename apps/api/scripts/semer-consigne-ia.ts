/**
 * Réinscrit la consigne de style de l'IA en base quand elle y est vide.
 *
 * Le back-office lisait la route publique des réglages, qui retire les clés
 * « ia. » : il affichait donc une consigne vide et l'enregistrait vide
 * par-dessus la vraie. La génération n'en a pas souffert — `reglages()`
 * ignore une valeur vide et retombe sur la consigne d'usine — mais la
 * cliente ne pouvait ni la lire ni la modifier.
 *
 * Ce script remet la consigne d'usine dans la base pour qu'elle s'affiche.
 * Il ne touche à RIEN quand une consigne est déjà écrite : on ne réécrit pas
 * par-dessus le travail de quelqu'un.
 */
import { db, schema } from "../src/db/client.js";
import { eq } from "drizzle-orm";
import { STYLE_MEMORY_LINE, STYLE_MEMORY_LINE_VERSION } from "../src/ia-style.js";

const CLE = "ia.stylePrompt";

const [ligne] = await db
  .select({ value: schema.settings.value })
  .from(schema.settings)
  .where(eq(schema.settings.key, CLE));

const actuelle = typeof ligne?.value === "string" ? ligne.value.trim() : "";
if (actuelle) {
  console.log(
    `Rien à faire : une consigne de ${actuelle.length} caractères est déjà en base.`,
  );
  process.exit(0);
}

await db
  .insert(schema.settings)
  .values({
    key: CLE,
    value: STYLE_MEMORY_LINE,
    label: "Consigne de style envoyée au modèle",
    group: "ia",
    updatedAt: new Date(),
  })
  .onConflictDoUpdate({
    target: schema.settings.key,
    set: {
      value: STYLE_MEMORY_LINE,
      label: "Consigne de style envoyée au modèle",
      group: "ia",
      updatedAt: new Date(),
    },
  });

console.log(
  `Consigne ${STYLE_MEMORY_LINE_VERSION} réinscrite : ${STYLE_MEMORY_LINE.length} caractères.`,
);
process.exit(0);
