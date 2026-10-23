/**
 * Seed de configuration initiale : promo "3 achetées = 1 A4 offerte", un
 * message du bandeau d'annonce, et quelques réglages éditables. Idempotent :
 * rien de ce qui existe déjà n'est réécrit.
 * Usage : pnpm --filter @memoryline/api run seed-config
 */
import { eq } from "drizzle-orm";
import { sql, db, schema } from "../src/db/client.js";

async function main() {
  // --- Promo "3 achetées = 1 A4 offerte" (l'offre du moment) -------------
  // La forme réglable de l'écran Promotions : trois affiches de n'importe
  // quelle taille, une A4 offerte, son cadre non compris — l'offre telle que
  // Margaux l'a décrite. Une base qui a déjà cette promotion la garde telle
  // quelle : c'est à la boutique de la régler, pas au seed.
  const existing = await db
    .select({ id: schema.promoRules.id })
    .from(schema.promoRules)
    .where(eq(schema.promoRules.name, "3 achetées = 1 A4 offerte"));

  let promoId: number;
  if (existing[0]) {
    promoId = existing[0].id;
  } else {
    const [row] = await db
      .insert(schema.promoRules)
      .values({
        name: "3 achetées = 1 A4 offerte",
        type: "buy_x_get_y",
        config: {
          version: 2,
          achat: { quantite: 3, formats: [] },
          offert: {
            quantite: 1,
            formats: ["A4"],
            pourcentage: 100,
            cadreCompris: false,
            maxLots: null,
          },
          conditions: { minCents: null, minQuantite: null },
          cumulable: true,
        },
        code: null, // automatique, déduite au panier
        active: true,
        priority: 10,
      })
      .returning({ id: schema.promoRules.id });
    promoId = row!.id;
  }

  // --- Un premier message du bandeau d'annonce ---------------------------
  // Un simple texte avec son bouton : le bandeau n'est plus lié aux
  // promotions (bandeau.ts), il ne fait que l'annoncer.
  const banners = await db.select().from(schema.announcementBanners);
  if (banners.length === 0) {
    await db.insert(schema.announcementBanners).values({
      message: "✨ 3 AFFICHES ACHETÉES = 1 AFFICHE A4 OFFERTE (déduite au panier) ✨",
      linkUrl: "/affiches",
      linkLabel: "J'en profite",
      bgColor: "#20211f",
      textColor: "#f7f3ec",
      active: true,
      position: 1,
    });
  }

  // --- Réglages éditables (contenu home, etc.) ---------------------------
  const defaults: {
    key: string;
    value: unknown;
    label: string;
    group: string;
  }[] = [
    {
      key: "home.hero.title",
      value: "Votre ville, votre histoire, sur un mur.",
      label: "Titre principal (home)",
      group: "home",
    },
    {
      key: "home.hero.subtitle",
      value:
        "Choisissez un fond, personnalisez le titre, ajoutez vos personnages. Votre affiche prête en 2 minutes — imprimée en A4 ou A3.",
      label: "Sous-titre (home)",
      group: "home",
    },
    {
      key: "footer.baseline",
      value: "Votre affiche prête en 2 minutes.",
      label: "Baseline (pied de page)",
      group: "footer",
    },
    {
      // Le compte de la boutique (migration 0071) : lien du pied de page et
      // « sameAs » des données structurées de l'accueil.
      key: "footer.instagram",
      value: "https://www.instagram.com/memoryline.fr/",
      label: "Compte Instagram (pied de page)",
      group: "footer",
    },
  ];
  for (const d of defaults) {
    await db
      .insert(schema.settings)
      .values({ key: d.key, value: d.value, label: d.label, group: d.group })
      .onConflictDoNothing({ target: schema.settings.key });
  }

  console.log("✓ Config seedée (promo, bandeau, réglages).", { promoId });
  await sql.end();
}

main().catch(async (e) => {
  console.error("✗ Seed échoué :", e);
  await sql.end();
  process.exit(1);
});
