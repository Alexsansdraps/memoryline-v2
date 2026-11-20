/**
 * Les factures en ZIP de Ventes stand (GET /admin/factures.zip) et le nom du
 * PDF d'une facture (relecture du 20/11).
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/factures-zip.test.ts
 *
 * Un numéro de facture se donne à la première édition et ne se reprend
 * jamais. Ces essais vérifient que le ZIP n'en donne qu'aux commandes qui
 * doivent avoir une facture, qu'il cite les autres par leur NUMÉRO de
 * commande, qu'il refuse un lien venu d'une autre page, et qu'une facture
 * japonaise ou chinoise n'a plus de nom qui fasse répondre 500.
 *
 * Presque tout se passe de base : la règle, les textes, les en-têtes, et les
 * refus de la route qui tombent avant la première lecture. Le module ouvre un
 * client de base à son chargement, sans s'en servir ici. Le dernier essai
 * touche la BASE LOCALE, et elle seule : il crée ses commandes fictives
 * (« TEST-ZIP-… »), vérifie qu'aucune n'a reçu de numéro et que le compteur
 * des factures n'a pas bougé, puis les efface. Hors de la base du conteneur
 * local (`@db:5432`), il ne s'exécute pas.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import {
  dispositionDuFichier,
  messageAucuneFacture,
  mountOrderRoutes,
  nomDuFichierDeFacture,
  nomEnAscii,
  raisonSansFactureDansLeZip,
  requeteDuBackOffice,
  texteFacturesNonFaites,
  type CommandeAFacturer,
} from "../src/commandes.js";

/** Une vente du stand payée, sans facture encore : celle qui en reçoit une. */
const payee: CommandeAFacturer = {
  number: "SAL-0012",
  channel: "salon",
  status: "paid",
  tags: ["Marché de Noël"],
  legacyId: null,
  legacyName: null,
  invoiceNumber: null,
};

/* ------------------------------------------------------------------------ */
/*  Qui reçoit une facture                                                   */
/* ------------------------------------------------------------------------ */

test("une vente payée reçoit sa facture ; une commande déjà facturée garde la sienne", () => {
  assert.equal(raisonSansFactureDansLeZip(payee), null);
  assert.equal(raisonSansFactureDansLeZip({ ...payee, channel: "web", number: "WEB-1042" }), null);
  // Déjà facturée : elle ressort, même annulée depuis (son PDF le dit), même
  // pas payée, même vente de test — rien de neuf n'est numéroté.
  const facturee = { ...payee, invoiceNumber: "F2026-0007" };
  assert.equal(raisonSansFactureDansLeZip(facturee), null);
  assert.equal(raisonSansFactureDansLeZip({ ...facturee, status: "cancelled" }), null);
  assert.equal(raisonSansFactureDansLeZip({ ...facturee, status: "voided" }), null);
  assert.equal(raisonSansFactureDansLeZip({ ...facturee, status: "pending" }), null);
  assert.equal(
    raisonSansFactureDansLeZip({ ...facturee, status: "cancelled", tags: ["test"] }),
    null,
  );
});

test("annulée, voided ou vente de test sans facture : écartée", () => {
  assert.equal(raisonSansFactureDansLeZip({ ...payee, status: "cancelled" }), "annulée");
  assert.equal(raisonSansFactureDansLeZip({ ...payee, status: "voided" }), "annulée");
  assert.equal(
    raisonSansFactureDansLeZip({ ...payee, status: "cancelled", tags: ["Marché", "TEST"] }),
    "vente de test",
  );
  // Une commande du site annulée et étiquetée « test » reste une annulée.
  assert.equal(
    raisonSansFactureDansLeZip({ ...payee, channel: "web", status: "cancelled", tags: ["test"] }),
    "annulée",
  );
});

test("pas encore payée : écartée, quel que soit son statut d'attente", () => {
  for (const status of ["pending", "authorized", "inconnu"])
    assert.equal(raisonSansFactureDansLeZip({ ...payee, status }), "pas encore payée", status);
  // Une étiquette « test » posée à la main sur une vente payée n'en fait pas
  // une vente de test (ventes-de-test.ts) : elle compte, elle est facturée.
  assert.equal(raisonSansFactureDansLeZip({ ...payee, tags: ["test"] }), null);
});

test("un panier, ou une vente rouverte et pas revalidée : écarté, même s'il avait un numéro", () => {
  assert.equal(
    raisonSansFactureDansLeZip({ ...payee, channel: "web", status: "draft", number: "DRAFT-0201" }),
    "panier, pas une commande",
  );
  const rouverte = { ...payee, status: "draft" };
  assert.match(raisonSansFactureDansLeZip(rouverte) ?? "", /rouverte sur la tablette/);
  // Facturée puis rouverte : composerLaFacture refuse un panier, le ZIP aussi.
  assert.match(
    raisonSansFactureDansLeZip({ ...rouverte, invoiceNumber: "F2026-0003" }) ?? "",
    /rouverte/,
  );
});

test("une reprise de Shopify n'est jamais facturée ici, même payée ou déjà numérotée", () => {
  const reprise = {
    ...payee,
    number: "SHOP-1042",
    legacyId: 5_123_456_789,
    legacyName: "#1042",
  };
  assert.equal(
    raisonSansFactureDansLeZip(reprise),
    "reprise de Shopify (#1042), réglée et facturée là-bas",
  );
  assert.match(raisonSansFactureDansLeZip({ ...reprise, invoiceNumber: "F2026-0001" }) ?? "", /Shopify/);
  assert.match(raisonSansFactureDansLeZip({ ...reprise, legacyName: null }) ?? "", /^reprise de Shopify, /);
  // legacyId à 0 : une reprise quand même (seul « null » dit « pas une reprise »).
  assert.match(raisonSansFactureDansLeZip({ ...reprise, legacyId: 0 }) ?? "", /Shopify/);
});

/* ------------------------------------------------------------------------ */
/*  Ce que disent le fichier texte et le refus                               */
/* ------------------------------------------------------------------------ */

test("factures-non-faites.txt cite les NUMÉROS de commande et dit qu'aucun numéro n'a été donné", () => {
  const texte = texteFacturesNonFaites(
    [
      { numero: "SAL-0013", raison: "vente de test" },
      { numero: "WEB-1050", raison: "pas encore payée" },
      // Une phrase de composerLaFacture, avec son point : pas de « .. ».
      { numero: "SAL-0006", raison: "Ceci est un panier abandonné, pas une commande : il n'y a rien à facturer." },
    ],
    2,
  );
  assert.match(texte, /^Factures non faites : ce téléchargement n'a donné aucun numéro de facture à ces commandes\.\n\n/);
  assert.match(texte, /^SAL-0013 : vente de test\.$/m);
  assert.match(texte, /^WEB-1050 : pas encore payée\.$/m);
  assert.match(texte, /^SAL-0006 : Ceci est un panier abandonné, pas une commande : il n'y a rien à facturer\.$/m);
  assert.match(texte, /^2 commandes cochées n'existent plus/m);
  assert.doesNotMatch(texte, /\.\./);
  assert.doesNotMatch(texte, /commande \d+ :/, "jamais l'identifiant interne");
  assert.match(texteFacturesNonFaites([], 1), /^Une commande cochée n'existe plus/m);
});

test("le refus quand rien n'est à facturer : numéros et raisons, puis le nombre des autres", () => {
  const une = messageAucuneFacture([{ numero: "SAL-0012", raison: "vente de test" }]);
  assert.equal(
    une,
    "Aucune facture à faire parmi les commandes cochées, et aucun numéro de facture n'a été donné : SAL-0012 (vente de test).",
  );
  const deux = messageAucuneFacture([
    { numero: "SAL-0012", raison: "vente de test" },
    { numero: "SAL-0013", raison: "annulée" },
  ]);
  assert.match(deux, /: SAL-0012 \(vente de test\) et SAL-0013 \(annulée\)\.$/);

  const dix = Array.from({ length: 10 }, (_, i) => ({
    numero: `SAL-00${20 + i}`,
    raison: "annulée",
  }));
  const coupe = messageAucuneFacture(dix, 0, 6);
  assert.match(coupe, /SAL-0025 \(annulée\) et 4 autres\.$/);
  assert.doesNotMatch(coupe, /SAL-0026/);

  const avecPerdue = messageAucuneFacture([{ numero: "SAL-0012", raison: "annulée" }], 1);
  assert.match(avecPerdue, /SAL-0012 \(annulée\)\. Une commande cochée n'existe plus/);
  assert.match(messageAucuneFacture([], 3), /^3 commandes cochées n'existent plus .*Rechargez la page/);
});

/* ------------------------------------------------------------------------ */
/*  D'où vient la demande                                                    */
/* ------------------------------------------------------------------------ */

test("Sec-Fetch-Site : seul le back-office lui-même passe", () => {
  assert.equal(requeteDuBackOffice("same-origin"), true);
  // Un lien cliqué dans un logiciel de courrier, une adresse tapée.
  assert.equal(requeteDuBackOffice("none"), false);
  assert.equal(requeteDuBackOffice(" Same-Origin "), true);
  // Sans l'en-tête (outil, vieux navigateur) : la session décide, comme partout.
  assert.equal(requeteDuBackOffice(undefined), true);
  assert.equal(requeteDuBackOffice(null), true);
  assert.equal(requeteDuBackOffice("cross-site"), false);
  assert.equal(requeteDuBackOffice("same-site"), false);
  assert.equal(requeteDuBackOffice(""), false);
});

/** L'application des commandes seule, la session déjà posée (la garde d'index.ts n'y est pas). */
function application(role = "owner"): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("utilisateur", {
      sessionId: "essai",
      adminUserId: 1,
      email: "essai@example.invalid",
      role,
      standIds: [],
    });
    await next();
  });
  mountOrderRoutes(app);
  return app;
}

test("la route refuse un lien venu d'une autre page, avant de lire quoi que ce soit", async () => {
  const app = application();
  for (const origine of ["cross-site", "same-site", "none"]) {
    const res = await app.request("/admin/factures.zip?ids=1,2,3", {
      headers: { "Sec-Fetch-Site": origine },
    });
    assert.equal(res.status, 403, origine);
    const { error } = (await res.json()) as { error: string };
    assert.match(error, /depuis le back-office/);
    assert.match(error, /aucune facture n'a été faite/);
  }
  // Le bouton du back-office (même adresse), ou sans l'en-tête : la route
  // va plus loin — ici jusqu'au refus d'une sélection vide, sans base.
  for (const entetes of [{ "Sec-Fetch-Site": "same-origin" }, {}]) {
    const res = await app.request("/admin/factures.zip?ids=", { headers: entetes });
    assert.equal(res.status, 400, JSON.stringify(entetes));
    assert.deepEqual(await res.json(), { error: "Aucune commande choisie." });
  }
  // Un vendeur : refusé, quelle que soit l'origine.
  const vendeur = await application("seller").request("/admin/factures.zip?ids=1", {
    headers: { "Sec-Fetch-Site": "same-origin" },
  });
  assert.equal(vendeur.status, 403);
});

/* ------------------------------------------------------------------------ */
/*  Le nom du fichier                                                        */
/* ------------------------------------------------------------------------ */

test("le nom du PDF suit la langue du PDF : japonais et chinois en anglais, toujours en ASCII", () => {
  assert.equal(nomDuFichierDeFacture("fr", "F2026-0001", "SAL-0012"), "Facture_F2026-0001_SAL-0012.pdf");
  assert.equal(nomDuFichierDeFacture("en", "F2026-0001", "WEB-1042"), "Invoice_F2026-0001_WEB-1042.pdf");
  assert.equal(nomDuFichierDeFacture("de", "F2026-0001", "WEB-1042"), "Rechnung_F2026-0001_WEB-1042.pdf");
  assert.equal(nomDuFichierDeFacture("it", "F2026-0001", "WEB-1042"), "Fattura_F2026-0001_WEB-1042.pdf");
  assert.equal(nomDuFichierDeFacture("es", "F2026-0001", "WEB-1042"), "Factura_F2026-0001_WEB-1042.pdf");
  assert.equal(nomDuFichierDeFacture("ja", "F2026-0001", "WEB-1042"), "Invoice_F2026-0001_WEB-1042.pdf");
  assert.equal(nomDuFichierDeFacture("zh", "F2026-0001", "WEB-1042"), "Invoice_F2026-0001_WEB-1042.pdf");
  for (const langue of ["fr", "en", "de", "it", "es", "ja", "zh"] as const)
    assert.match(nomDuFichierDeFacture(langue, "F2026-0001", "SAL-0012"), /^[\x20-\x7e]+$/, langue);
  assert.equal(nomEnAscii("Facturé/2026 請求書.pdf"), "Facture_2026 ___.pdf");
  assert.equal(nomEnAscii("請求書"), "___");
  assert.equal(nomEnAscii("   "), "fichier");
});

test("Content-Disposition : un nom non ASCII ne fait plus lever d'exception (le 500 d'une facture japonaise)", () => {
  // Le défaut d'avant : le nom en kanji, tel quel dans l'en-tête.
  assert.throws(
    () => new Headers({ "Content-Disposition": 'inline; filename="請求書_F2026-0001_WEB-1042.pdf"' }),
    TypeError,
  );
  assert.equal(
    dispositionDuFichier("inline", "Facture_F2026-0001_SAL-0012.pdf"),
    'inline; filename="Facture_F2026-0001_SAL-0012.pdf"',
  );
  assert.equal(dispositionDuFichier("attachment", "factures.zip"), 'attachment; filename="factures.zip"');
  const japonais = dispositionDuFichier("inline", "請求書_F2026-0001_WEB-1042.pdf");
  assert.equal(
    japonais,
    "inline; filename=\"____F2026-0001_WEB-1042.pdf\"; filename*=UTF-8''%E8%AB%8B%E6%B1%82%E6%9B%B8_F2026-0001_WEB-1042.pdf",
  );
  // Un en-tête que le serveur accepte, et qu'une réponse peut porter.
  assert.doesNotThrow(() => new Response("x", { headers: { "Content-Disposition": japonais } }));
  // Guillemets et apostrophes ne cassent ni le nom ASCII ni sa version entière.
  const guillemets = dispositionDuFichier("attachment", `l'"essai" (1).pdf`);
  assert.equal(
    guillemets,
    "attachment; filename=\"l'_essai_ (1).pdf\"; filename*=UTF-8''l%27%22essai%22%20%281%29.pdf",
  );
  assert.doesNotThrow(() => new Headers({ "Content-Disposition": guillemets }));
});

/* ------------------------------------------------------------------------ */
/*  Contre la base locale : aucun numéro donné aux écartées                  */
/* ------------------------------------------------------------------------ */

// Le service de base s'appelle « db » en production aussi, et l'image de
// production contient les tests : NODE_ENV=production les en écarte.
const baseLocale =
  /@db:5432\//.test(process.env.DATABASE_URL ?? "") && process.env.NODE_ENV !== "production";

after(async () => {
  if (!baseLocale) return;
  const { sql } = await import("../src/db/client.js");
  await sql.end({ timeout: 5 });
});

test(
  "le ZIP ne numérote ni annulée, ni vente de test, ni attente, ni panier, ni reprise ; le compteur ne bouge pas",
  { skip: !baseLocale && "hors de la base locale du conteneur" },
  async () => {
    const { db, schema } = await import("../src/db/client.js");
    const { inArray } = await import("drizzle-orm");
    const suffixe = `${Date.now()}`;
    const commandes = await db
      .insert(schema.orders)
      .values([
        { channel: "salon" as const, number: `TEST-ZIP-ANNULEE-${suffixe}`, status: "cancelled" },
        {
          channel: "salon" as const,
          number: `TEST-ZIP-ESSAI-${suffixe}`,
          status: "cancelled",
          tags: ["test"],
        },
        { channel: "web" as const, number: `TEST-ZIP-ATTENTE-${suffixe}`, status: "pending" },
        { channel: "web" as const, number: `TEST-ZIP-PANIER-${suffixe}`, status: "draft" },
        {
          channel: "salon" as const,
          number: `TEST-ZIP-SHOP-${suffixe}`,
          status: "paid",
          legacyId: 9_000_000_000 + Number(suffixe.slice(-6)),
          legacyName: "#TEST",
        },
      ])
      .returning();
    const idsCrees = commandes.map((c) => c.id);
    const compteur = async () =>
      (await db.select().from(schema.factureCompteur))
        .map((l) => `${l.annee}:${l.dernierNumero}`)
        .sort()
        .join(",");
    const avant = await compteur();
    try {
      const app = application();
      const res = await app.request(`/admin/factures.zip?ids=${idsCrees.join(",")}`, {
        headers: { "Sec-Fetch-Site": "same-origin" },
      });
      assert.equal(res.status, 400);
      const { error } = (await res.json()) as { error: string };
      for (const c of commandes) assert.ok(error.includes(c.number), `${c.number} est cité`);
      assert.match(error, /aucun numéro de facture n'a été donné/);

      // La reprise, par la route de la fiche : composerLaFacture la refuse
      // elle-même (la garde d'index.ts n'est pas montée ici).
      const reprise = commandes[4]!;
      const fiche = await app.request(`/admin/orders/${reprise.id}/facture.pdf`);
      assert.equal(fiche.status, 409);
      assert.match(((await fiche.json()) as { error: string }).error, /reprise de Shopify/);

      const relues = await db
        .select({ numero: schema.orders.number, facture: schema.orders.invoiceNumber })
        .from(schema.orders)
        .where(inArray(schema.orders.id, idsCrees));
      for (const r of relues) assert.equal(r.facture, null, `${r.numero} n'a pas de numéro`);
      assert.equal(await compteur(), avant, "le compteur des factures n'a pas bougé");
    } finally {
      await db.delete(schema.orders).where(inArray(schema.orders.id, idsCrees));
    }
  },
);
