/**
 * Les affiches restées « en_cours » quand l'API s'arrête (relecture finale
 * du 26/11) : une mise en ligne ou un redémarrage coupe une création en
 * cours, et rien ne soldait sa ligne — « En fabrication… » pour toujours
 * dans la galerie du BO, 0 c au plafond. Au démarrage, l'API les passe en
 * échec, au coût attendu (solderLesAffichesInterrompues, ia.ts).
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/ia-affiches-interrompues-base.test.ts
 *
 * Touche la BASE LOCALE, et elle seule (`@db:5432`, hors production) : ses
 * lignes fictives sont datées du 31 décembre 2019 et du 1er janvier 2020, et
 * la date de démarrage passée à la fonction aussi — aucune ligne réelle, même d'un autre essai
 * en cours, n'est donc touchée. Elles sont effacées à la fin. Aucun appel à
 * OpenAI (clé factice, adresse injoignable), aucun courriel.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";

const baseLocale =
  /@db:5432\//.test(process.env.DATABASE_URL ?? "") && process.env.NODE_ENV !== "production";

// Avant d'importer ia.ts, qui les lit à l'import : rien ne doit partir chez OpenAI.
process.env.OPENAI_API_KEY = "cle-factice-des-essais";
process.env.OPENAI_BASE_URL = "http://127.0.0.1:9/v1";

after(async () => {
  if (!baseLocale) return;
  const { sql } = await import("../src/db/client.js");
  await sql.end({ timeout: 5 });
});

test(
  "au démarrage, une affiche « en_cours » d'avant passe en échec au coût attendu ; le reste ne bouge pas",
  { skip: !baseLocale && "hors de la base locale du conteneur" },
  async () => {
    const { db, schema } = await import("../src/db/client.js");
    const { eq, like } = await import("drizzle-orm");
    const { coutDeLImage, reglages, solderLesAffichesInterrompues } = await import("../src/ia.js");
    const g = schema.aiGenerations;
    const prefixe = `essai-interrompue-${Date.now()}`;
    const ligne = async (nom: string, v: { status: string; model: string; size: string; createdAt: Date }) => {
      const [l] = await db
        .insert(g)
        .values({ publicId: `${prefixe}-${nom}`, ...v, costCents: 0 })
        .returning({ id: g.id });
      return l!.id;
    };
    const lire = async (id: number) => {
      const [l] = await db.select().from(g).where(eq(g.id, id));
      return { status: l!.status, costCents: l!.costCents, erreur: l!.erreur };
    };
    const le = new Date("2020-01-01T11:00:00Z");
    const demarrage = new Date("2020-01-01T12:00:00Z");
    try {
      const coupee = await ligne("coupee", { status: "en_cours", model: "gpt-image-2", size: "1584x2240", createdAt: le });
      const auto = await ligne("auto", { status: "en_cours", model: "gpt-image-2.5-sunburst", size: "auto", createdAt: le });
      // Lancée APRÈS le démarrage : celle du processus, en cours.
      const enCours = await ligne("en-cours", {
        status: "en_cours",
        model: "gpt-image-2",
        size: "1584x2240",
        createdAt: new Date("2020-01-01T12:00:01Z"),
      });
      const prete = await ligne("prete", { status: "prete", model: "gpt-image-2", size: "1584x2240", createdAt: le });
      // Plus de deux heures avant le démarrage : pas coupée par lui, elle
      // n'est pas réécrite après coup.
      const ancienne = await ligne("ancienne", {
        status: "en_cours",
        model: "gpt-image-2",
        size: "1584x2240",
        createdAt: new Date("2019-12-31T10:00:00Z"),
      });

      assert.equal(await solderLesAffichesInterrompues(demarrage), 2);
      const reg = await reglages();
      const attendu = (model: string, size: string) =>
        coutDeLImage(model, null, { taille: size, qualite: reg["ia.qualite"] || null }, reg["ia.coutParImageCents"]);
      const a = await lire(coupee);
      assert.equal(a.status, "echec");
      assert.match(String(a.erreur), /^Interrompue : l'API a redémarré pendant la création/);
      assert.equal(a.costCents, attendu("gpt-image-2", "1584x2240"));
      assert.ok(a.costCents >= 8, `${a.costCents} c`);
      const b = await lire(auto);
      assert.equal(b.status, "echec");
      assert.equal(b.costCents, attendu("gpt-image-2.5-sunburst", "auto"));
      assert.deepEqual(await lire(enCours), { status: "en_cours", costCents: 0, erreur: null });
      assert.deepEqual(await lire(prete), { status: "prete", costCents: 0, erreur: null });
      assert.deepEqual(await lire(ancienne), { status: "en_cours", costCents: 0, erreur: null });
      // Le démarrage suivant n'a plus rien à solder parmi elles.
      assert.equal(await solderLesAffichesInterrompues(demarrage), 0);
    } finally {
      await db.delete(g).where(like(g.publicId, `${prefixe}-%`));
    }
  },
);
