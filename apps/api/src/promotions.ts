/**
 * Les promotions : celles que lisent le panier et la caisse, et l'écran du
 * back-office qui les règle.
 *
 * Les routes vivaient dans index.ts, et l'écran ne savait que créer et
 * allumer : pas de modification, pas de dates, pas d'archivage. La seule
 * règle réglable en détail l'était depuis le bandeau, qui l'allumait et
 * l'éteignait avec son message. Le bandeau n'y touche plus (bandeau.ts) : les
 * offres se règlent ICI, comme dans Shopify — ce qui compte à l'achat, ce qui
 * est offert, le cadre compris ou non, les dates, le minimum d'achat, le cumul.
 *
 * Le calcul, lui, n'est pas ici : il vit dans @memoryline/types (promo.ts),
 * partagé avec le panier et la caisse. Ce module ne fait que lire, vérifier et
 * enregistrer des règles.
 *
 * Une commande déjà passée ne bouge pas quand une règle change : sa remise est
 * déduite de montants figés, et les règles en jeu au moment de la caisse sont
 * gardées sur la commande (order.promotions, voir configurator-routes.ts).
 */
import type { Context, Hono } from "hono";
import { and, asc, desc, eq, isNull, ne, notInArray, sql } from "drizzle-orm";
import {
  POSTER_FORMATS,
  cleDeCarte,
  cleDeCode,
  codeCarteMasque,
  estConfigV2,
  estUsageUnique,
  lireConditions,
  lireOffre,
  normaliserCode,
} from "@memoryline/types";
import { db, schema } from "./db/client.js";
import { langueDuVisiteur, texteDansLaLangue } from "./traductions.js";
import { HORS_VENTES } from "./statuts-vente.js";
import { supprimerPourToujours } from "./suppression.js";
import { carteParCle, carteUtilisable } from "./cartes-cadeaux.js";
import { adresseAppelante } from "./contact.js";
import { frein } from "./ia-relais.js";

/** Une transaction ouverte par `db.transaction`. */
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Le code d'une commande, ramené à sa CLÉ en SQL : majuscules, sans espaces
 * ni tirets — exactement cleDeCode (@memoryline/types).
 */
const cleSqlDuCodeCommande = sql`upper(regexp_replace(coalesce(${schema.orders.promoCode}, ''), '[[:space:]-]', '', 'g'))`;
const cleSqlDuCodePromo = sql`upper(regexp_replace(coalesce(${schema.promoRules.code}, ''), '[[:space:]-]', '', 'g'))`;

/**
 * Les commandes qui ont VRAIMENT utilisé un code : payées, et pas remboursées
 * en entier. Une commande annulée n'est plus « payée » ; une commande
 * remboursée de tout ce qu'elle a coûté rend son code aussi. C'est ce qui
 * libère un code à usage unique (estUsageUnique).
 */
const utiliseVraiment = sql`${schema.orders.status} = 'paid' and not (${schema.orders.totalCents} > 0 and coalesce((select sum(r.amount_cents) from "refund" r where r.order_id = ${schema.orders.id}), 0) >= ${schema.orders.totalCents})`;

/**
 * Combien de commandes ont utilisé ce code (voir `utiliseVraiment`), en dehors
 * de la commande `sauf`.
 *
 * Lu SOUS LE VERROU de la promotion au moment du paiement (markOrderPaid) :
 * deux commandes payées au même instant avec un code à usage unique passent
 * l'une après l'autre, et la seconde voit la première.
 */
export async function utilisationsDuCode(
  ex: typeof db | Transaction,
  code: string,
  sauf: number | null = null,
): Promise<number> {
  const cle = cleDeCode(code);
  if (!cle) return 0;
  const [r] = await ex
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.orders)
    .where(
      and(
        sql`${cleSqlDuCodeCommande} = ${cle}`,
        utiliseVraiment,
        sauf != null ? ne(schema.orders.id, sauf) : undefined,
      ),
    );
  return Number(r?.n ?? 0);
}

/**
 * La promotion vivante qui répond à ce code (active, non archivée, dans ses
 * dates), comparée par sa CLÉ : casse, espaces et tirets ignorés.
 */
export async function promotionDuCode(
  ex: typeof db | Transaction,
  saisie: unknown,
  maintenant: Date = new Date(),
): Promise<typeof schema.promoRules.$inferSelect | null> {
  const cle = cleDeCode(saisie);
  if (!cle || cle.length > 60) return null;
  const regles = await ex
    .select()
    .from(schema.promoRules)
    .where(
      and(
        eq(schema.promoRules.active, true),
        isNull(schema.promoRules.archivedAt),
        sql`${cleSqlDuCodePromo} = ${cle}`,
      ),
    )
    .orderBy(asc(schema.promoRules.id));
  return (
    regles.find(
      (r) =>
        (!r.startsAt || r.startsAt <= maintenant) && (!r.endsAt || r.endsAt >= maintenant),
    ) ?? null
  );
}

/**
 * Les essais de code à la caisse, par adresse : trente toutes les dix
 * minutes. Large pour une personne qui se trompe en recopiant sa carte,
 * étroit pour un script qui voudrait deviner des codes — vingt et un signes
 * à la puissance douze, trente essais à la fois.
 */
const essaisDeCode = frein(30, 10 * 60_000);

/**
 * Compte un essai de code pour l'adresse qui appelle. Vrai quand elle en a
 * déjà fait trop : la route répond alors 429, sans rien vérifier.
 */
export function tropDEssaisDeCode(c: Context): boolean {
  return essaisDeCode(adresseAppelante(c));
}

/** Le seul refus que la caisse donne pour un code : il ne dit jamais pourquoi. */
export const CODE_NON_VALABLE = "Ce code n'est pas valable.";
export const CODE_DEJA_UTILISE = "Ce code a déjà été utilisé.";

/** Les types de règles que l'écran sait régler. */
export const TYPES_PROMOTION = ["buy_x_get_y", "percent", "fixed", "free_shipping_over"] as const;

/** Une date reçue du formulaire, ou null ; `undefined` si elle est illisible. */
function dateLue(v: unknown): Date | null | undefined {
  if (v == null || v === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Un entier dans [min, max], ou null s'il n'en est pas un. */
function entierEntre(v: unknown, min: number, max: number): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** Les formats envoyés, s'ils sont tous connus ; [] = tous les formats. */
function formatsLus(v: unknown): string[] | null {
  if (v == null) return [];
  if (!Array.isArray(v)) return null;
  const connus = POSTER_FORMATS as readonly string[];
  const lus = [...new Set(v.map((f) => String(f).trim()).filter(Boolean))];
  if (lus.some((f) => !connus.includes(f))) return null;
  // Tous les formats cochés, c'est « tous les formats » : la règle restera
  // juste le jour où la boutique en ajoutera un.
  return lus.length === connus.length ? [] : lus;
}

/**
 * Le minimum d'achat et le cumul, communs aux remises. Rend l'erreur à
 * afficher, ou ce qu'il faut ranger dans la config.
 */
function communs(
  brut: Record<string, unknown>,
): { erreur: string } | { conditions: { minCents: number | null; minQuantite: number | null }; cumulable: boolean } {
  const c = (brut.conditions ?? {}) as Record<string, unknown>;
  const minCents = c.minCents == null || c.minCents === "" ? null : entierEntre(c.minCents, 0, 10_000_000);
  if (c.minCents != null && c.minCents !== "" && minCents === null)
    return { erreur: "Le montant minimum d'achat doit être un montant positif." };
  const minQuantite =
    c.minQuantite == null || c.minQuantite === "" ? null : entierEntre(c.minQuantite, 0, 999);
  if (c.minQuantite != null && c.minQuantite !== "" && minQuantite === null)
    return { erreur: "Le nombre minimum d'affiches doit être un nombre entier positif." };
  return {
    conditions: { minCents: minCents || null, minQuantite: minQuantite || null },
    cumulable: brut.cumulable !== false,
  };
}

/**
 * Les deux options d'une remise sur le panier (pourcentage ou montant) :
 * offrir aussi la livraison, et ne servir qu'une fois. Absentes = non, comme
 * pour toutes les règles d'avant.
 */
function optionsRemise(brut: Record<string, unknown>): {
  livraisonOfferte: boolean;
  usageUnique: boolean;
} {
  return {
    livraisonOfferte: brut.livraisonOfferte === true,
    usageUnique: brut.usageUnique === true,
  };
}

/**
 * La config d'une règle, vérifiée et remise en forme. Une règle « X achetées =
 * Y offertes » s'enregistre toujours sous la NOUVELLE forme (version 2) ; une
 * ancienne forme reçue y est traduite sans changer de sens (mêmes formats à
 * l'achat et à l'offre, cadre compris).
 */
export function configPromotion(
  type: string,
  brut: unknown,
): { erreur: string } | { config: Record<string, unknown> } {
  const cfg = (brut ?? {}) as Record<string, unknown>;
  if (type === "buy_x_get_y") {
    if (!estConfigV2(cfg)) {
      // Une ancienne forme : relue par le moteur, réécrite à l'identique.
      const o = lireOffre(cfg);
      return {
        config: {
          version: 2,
          achat: o.achat,
          offert: o.offert,
          conditions: lireConditions(cfg),
          cumulable: cfg.cumulable !== false,
        },
      };
    }
    const achat = (cfg.achat ?? {}) as Record<string, unknown>;
    const offert = (cfg.offert ?? {}) as Record<string, unknown>;
    const quantiteAchat = entierEntre(achat.quantite, 1, 99);
    if (quantiteAchat === null)
      return { erreur: "Le nombre d'affiches à acheter doit être un nombre entier, de 1 à 99." };
    const formatsAchat = formatsLus(achat.formats);
    if (formatsAchat === null) return { erreur: "Un format d'achat est inconnu." };
    const quantiteOfferte = entierEntre(offert.quantite, 1, 99);
    if (quantiteOfferte === null)
      return { erreur: "Le nombre d'affiches offertes doit être un nombre entier, de 1 à 99." };
    const formatsOfferts = formatsLus(offert.formats);
    if (formatsOfferts === null) return { erreur: "Un format offert est inconnu." };
    const pourcentage = entierEntre(offert.pourcentage, 1, 100);
    if (pourcentage === null)
      return { erreur: "La remise sur les affiches offertes doit aller de 1 à 100 % (100 = offertes)." };
    const maxLots =
      offert.maxLots == null || offert.maxLots === "" ? null : entierEntre(offert.maxLots, 1, 99);
    if (offert.maxLots != null && offert.maxLots !== "" && maxLots === null)
      return { erreur: "Le nombre de fois où l'offre joue doit être un nombre entier, de 1 à 99 (vide = sans limite)." };
    const c = communs(cfg);
    if ("erreur" in c) return c;
    return {
      config: {
        version: 2,
        achat: { quantite: quantiteAchat, formats: formatsAchat },
        offert: {
          quantite: quantiteOfferte,
          formats: formatsOfferts,
          pourcentage,
          cadreCompris: offert.cadreCompris !== false,
          maxLots,
        },
        conditions: c.conditions,
        cumulable: c.cumulable,
      },
    };
  }
  if (type === "percent") {
    // Jusqu'à 100 % : avec « livraison offerte », c'est un code « tout
    // gratuit », et la commande se valide sans paiement (POST /payments/gratuit).
    const percent = entierEntre(cfg.percent, 1, 100);
    if (percent === null) return { erreur: "Le pourcentage de remise doit aller de 1 à 100 %." };
    const c = communs(cfg);
    if ("erreur" in c) return c;
    return {
      config: { percent, ...optionsRemise(cfg), conditions: c.conditions, cumulable: c.cumulable },
    };
  }
  if (type === "fixed") {
    const amountCents = entierEntre(cfg.amountCents, 1, 10_000_000);
    if (amountCents === null) return { erreur: "Indiquez le montant de la remise, en euros." };
    const c = communs(cfg);
    if ("erreur" in c) return c;
    return {
      config: { amountCents, ...optionsRemise(cfg), conditions: c.conditions, cumulable: c.cumulable },
    };
  }
  if (type === "free_shipping_over") {
    const thresholdCents = entierEntre(cfg.thresholdCents, 0, 10_000_000);
    if (thresholdCents === null)
      return { erreur: "Indiquez à partir de quel montant la livraison est offerte." };
    return { config: { thresholdCents } };
  }
  return { erreur: "Ce type de promotion n'existe pas." };
}

export function mountPromotions(app: Hono): void {
  /**
   * Les promotions automatiques en cours, pour le panier et la caisse.
   *
   * Le nom — celui qui s'écrit sur la ligne de remise — dans la langue du
   * visiteur (?lang=), le français à défaut. Le dictionnaire ne sort pas. Une
   * promotion archivée n'en fait plus partie.
   */
  app.get("/promos", async (c) => {
    const langue = langueDuVisiteur(c);
    const now = new Date();
    const rows = await db
      .select()
      .from(schema.promoRules)
      .where(and(eq(schema.promoRules.active, true), isNull(schema.promoRules.archivedAt)))
      .orderBy(desc(schema.promoRules.priority));
    const active = rows.filter(
      (r) =>
        !r.code &&
        (!r.startsAt || r.startsAt <= now) &&
        (!r.endsAt || r.endsAt >= now),
    );
    return c.json(
      active.map(({ translations, ...r }) => ({
        ...r,
        name: texteDansLaLangue(translations, langue, "name", r.name),
      })),
    );
  });

  /**
   * Vérifie un code promo saisi au panier.
   *
   * Réponse volontairement avare : la règle qui s'applique, rien de plus. On ne
   * dit jamais qu'un code existe mais est expiré, désactivé ou archivé — ce
   * serait aider à deviner les autres.
   *
   * Le nom de la règle dans la langue du visiteur (?lang= dans l'adresse, comme
   * pour les lectures), le français à défaut.
   */
  app.post("/promos/verifier", async (c) => {
    const langue = langueDuVisiteur(c);
    if (tropDEssaisDeCode(c))
      return c.json({ error: "Trop d'essais. Réessayez dans quelques minutes.", code: "trop_d_essais" }, 429);
    const b = await c.req.json().catch(() => ({}));
    const regle = await promotionDuCode(db, (b as { code?: unknown }).code);
    if (!regle) return c.json({ error: "code inconnu" }, 404);
    if (estUsageUnique(regle.config) && (await utilisationsDuCode(db, regle.code ?? "")) > 0)
      return c.json({ error: CODE_DEJA_UTILISE, code: "code_deja_utilise" }, 409);
    return c.json({
      // L'identifiant départage deux règles de même priorité (reglesActives) :
      // sans lui, le navigateur ne rangerait pas le code comme le serveur, et
      // le panier n'afficherait pas le montant encaissé.
      id: regle.id,
      // Le code tel que la boutique l'a écrit : c'est lui que garde la commande.
      code: normaliserCode(regle.code),
      name: texteDansLaLangue(regle.translations, langue, "name", regle.name),
      type: regle.type,
      config: regle.config,
      priority: regle.priority,
    });
  });

  /**
   * Le champ « Code promo ou carte cadeau » de la caisse.
   *
   * Un seul champ, deux sortes de codes. Une promotion à code d'abord — c'est
   * la boutique qui choisit ses codes, une carte a un code tiré au hasard —,
   * puis une carte cadeau. Comparés par leur clé : ni la casse, ni les tirets,
   * ni les espaces ne comptent.
   *
   * Ce que la route ne dit JAMAIS : qu'un code existe mais ne vaut plus rien
   * (carte désactivée, échue, vide ; promotion éteinte, archivée, hors de ses
   * dates). Une seule phrase pour tout refus, « Ce code n'est pas valable. »,
   * et un frein par adresse : sans eux, la route se laisserait interroger
   * jusqu'à trouver le code d'une autre. Seule exception, voulue par la
   * boutique : un code à usage unique déjà servi le dit.
   *
   * Une carte rend son code masqué et son solde : la personne qui l'a tapée a
   * la carte en main, le solde est à elle. La part qu'elle paiera se calcule à
   * la caisse, et le serveur la recalcule au passage en caisse (POST /orders).
   */
  app.post("/caisse/code", async (c) => {
    const langue = langueDuVisiteur(c);
    if (tropDEssaisDeCode(c))
      return c.json(
        { error: "Trop d'essais. Réessayez dans quelques minutes.", code: "trop_d_essais" },
        429,
      );
    const b = ((await c.req.json().catch(() => ({}))) ?? {}) as { code?: unknown };
    const saisie = String(b.code ?? "").slice(0, 80);
    const maintenant = new Date();

    const regle = await promotionDuCode(db, saisie, maintenant);
    if (regle) {
      if (estUsageUnique(regle.config) && (await utilisationsDuCode(db, regle.code ?? "")) > 0)
        return c.json({ error: CODE_DEJA_UTILISE, code: "code_deja_utilise" }, 409);
      return c.json({
        type: "promo",
        regle: {
          id: regle.id,
          code: normaliserCode(regle.code),
          name: texteDansLaLangue(regle.translations, langue, "name", regle.name),
          type: regle.type,
          config: regle.config,
          priority: regle.priority,
        },
      });
    }

    const cle = cleDeCarte(saisie);
    if (cle) {
      const carte = await carteParCle(db, cle);
      if (carte && carteUtilisable(carte, maintenant))
        return c.json({
          type: "carte",
          carte: {
            // Le code tel qu'il est écrit sur la carte : c'est lui que la
            // caisse renverra au passage en caisse.
            code: carte.code,
            masque: codeCarteMasque(carte.code),
            soldeCents: carte.balanceCents,
          },
        });
    }
    return c.json({ error: CODE_NON_VALABLE, code: "code_invalide" }, 404);
  });

  /**
   * Toutes les promotions, archivées comprises (marquées par `archivedAt`).
   *
   * Chacune dit combien de commandes payées ont utilisé son code
   * (`utilisations`, voir utiliseVraiment) : c'est ce chiffre qui ferme un
   * code à usage unique, et la boutique doit pouvoir le lire.
   */
  app.get("/admin/promos", async (c) => {
    const [rows, usages] = await Promise.all([
      db
        .select()
        .from(schema.promoRules)
        .orderBy(desc(schema.promoRules.priority), asc(schema.promoRules.id)),
      db
        .select({ cle: sql<string>`${cleSqlDuCodeCommande}`, n: sql<number>`count(*)::int` })
        .from(schema.orders)
        .where(and(sql`coalesce(${schema.orders.promoCode}, '') <> ''`, utiliseVraiment))
        .groupBy(sql`1`),
    ]);
    const parCle = new Map(usages.map((u) => [u.cle, Number(u.n)]));
    return c.json(
      rows.map((r) => ({
        ...r,
        utilisations: r.code ? (parCle.get(cleDeCode(r.code)) ?? 0) : null,
      })),
    );
  });

  /**
   * Crée une promotion, ou la modifie (avec `id`).
   *
   * Tout est vérifié ici, et refusé en clair : un réglage qui ne veut rien
   * dire ne doit pas pouvoir rogner les commandes en silence. La colonne
   * `stackable` n'est pas écrite : le cumul se règle dans la config, voir
   * estCumulable (promo.ts).
   */
  app.post("/admin/promos", async (c) => {
    const b = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    const id = b.id == null || b.id === "" ? null : Number(b.id);
    if (id !== null && (!Number.isInteger(id) || id <= 0))
      return c.json({ error: "Promotion introuvable." }, 404);

    const name = String(b.name ?? "").trim();
    if (!name || name.length > 120)
      return c.json({ error: "Donnez un nom à la promotion (120 caractères au plus) : c'est lui qui s'écrit sur la ligne de remise du panier." }, 400);
    const type = String(b.type ?? "");
    if (!(TYPES_PROMOTION as readonly string[]).includes(type))
      return c.json({ error: "Ce type de promotion n'existe pas." }, 400);
    const lu = configPromotion(type, b.config);
    if ("erreur" in lu) return c.json({ error: lu.erreur }, 400);

    const code = normaliserCode(b.code) || null;
    if (code && !/^[A-Z0-9_-]{2,60}$/.test(code))
      return c.json({ error: "Le code ne peut contenir que des lettres sans accent, des chiffres, « - » et « _ » (2 à 60 signes)." }, 400);
    // Sans code, une promotion est automatique : elle ne peut pas être « à
    // usage unique », il n'y aurait rien à compter.
    if (!code && lu.config.usageUnique === true) lu.config.usageUnique = false;
    if (code) {
      // Deux promotions vivantes ne peuvent pas répondre au même code : le
      // panier n'en prendrait qu'une, au hasard. Une archivée libère le sien.
      // Comparés par leur CLÉ (cleDeCode) : la caisse ne voit pas la
      // différence entre « NOEL-26 » et « NOEL26 », la boutique non plus.
      const [doublon] = await db
        .select({ id: schema.promoRules.id, name: schema.promoRules.name })
        .from(schema.promoRules)
        .where(
          and(
            sql`${cleSqlDuCodePromo} = ${cleDeCode(code)}`,
            isNull(schema.promoRules.archivedAt),
            id !== null ? ne(schema.promoRules.id, id) : undefined,
          ),
        );
      if (doublon)
        return c.json({ error: `Le code ${code} est déjà celui de « ${doublon.name} ».` }, 409);
    }

    const debut = dateLue(b.startsAt);
    const fin = dateLue(b.endsAt);
    if (debut === undefined || fin === undefined)
      return c.json({ error: "Une date est illisible." }, 400);
    if (debut && fin && fin <= debut)
      return c.json({ error: "La fin de la promotion doit venir après son début." }, 400);

    const priority = Number(b.priority ?? 0);
    const valeurs = {
      name,
      type,
      config: lu.config,
      code,
      active: b.active !== false,
      priority: Number.isInteger(priority) ? Math.max(-999, Math.min(999, priority)) : 0,
      startsAt: debut,
      endsAt: fin,
      updatedAt: new Date(),
    };
    if (id !== null) {
      const [row] = await db
        .update(schema.promoRules)
        .set(valeurs)
        .where(eq(schema.promoRules.id, id))
        .returning();
      if (!row) return c.json({ error: "Promotion introuvable." }, 404);
      return c.json(row);
    }
    const [row] = await db.insert(schema.promoRules).values(valeurs).returning();
    return c.json(row);
  });

  /** Allume ou éteint une promotion. */
  app.post("/admin/promos/:id/toggle", async (c) => {
    const id = Number(c.req.param("id"));
    const [cur] = await db
      .select({ active: schema.promoRules.active })
      .from(schema.promoRules)
      .where(eq(schema.promoRules.id, id));
    if (!cur) return c.notFound();
    const [row] = await db
      .update(schema.promoRules)
      .set({ active: !cur.active, updatedAt: new Date() })
      .where(eq(schema.promoRules.id, id))
      .returning();
    return c.json(row);
  });

  /**
   * Archive une promotion, ou la restaure ({ archive: false }).
   *
   * Rien ne s'efface : les commandes passées citent son nom et sa remise. Une
   * promotion restaurée revient ÉTEINTE, à rallumer à la main : la ramener
   * allumée remiserait d'un coup des paniers sans que personne l'ait voulu.
   */
  app.post("/admin/promos/:id/archive", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.notFound();
    const b = ((await c.req.json().catch(() => ({}))) ?? {}) as { archive?: unknown };
    const archiver = b.archive !== false;
    if (!archiver) {
      // Son code a pu être repris pendant qu'elle était rangée : deux
      // promotions vivantes sur le même code, le panier n'en prendrait qu'une.
      const [elle] = await db
        .select({ code: schema.promoRules.code })
        .from(schema.promoRules)
        .where(eq(schema.promoRules.id, id));
      if (!elle) return c.notFound();
      const code = normaliserCode(elle.code);
      if (code) {
        const [autre] = await db
          .select({ name: schema.promoRules.name })
          .from(schema.promoRules)
          .where(
            and(
              sql`${cleSqlDuCodePromo} = ${cleDeCode(code)}`,
              isNull(schema.promoRules.archivedAt),
              ne(schema.promoRules.id, id),
            ),
          );
        if (autre)
          return c.json(
            { error: `Le code ${code} est aujourd'hui celui de « ${autre.name} » : changez l'un des deux codes avant de la restaurer.` },
            409,
          );
      }
    }
    const [row] = await db
      .update(schema.promoRules)
      .set(
        archiver
          ? { archivedAt: new Date(), updatedAt: new Date() }
          : { archivedAt: null, active: false, updatedAt: new Date() },
      )
      .where(eq(schema.promoRules.id, id))
      .returning();
    if (!row) return c.notFound();
    return c.json({ ok: true, archived: row.archivedAt != null });
  });

  /**
   * Supprime DÉFINITIVEMENT une promotion archivée.
   *
   * Les commandes passées depuis le figeage des promotions n'en ont plus
   * besoin : elles en gardent une COPIE (order.promotions — nom, règle,
   * remise), qui ne bouge pas quand la table change. La caisse et le
   * contrôle de l'encaissement ignorent déjà une promotion archivée : la
   * supprimer n'y change rien.
   *
   * Reste un lecteur qui la relit : la page Finances, pour les ventes
   * d'AVANT ce figeage. Elle se demande si une promotion AUTOMATIQUE tournait
   * le jour de la vente — archivage ignoré, exprès — pour ne pas prendre une
   * remise pour une anomalie. Une promotion automatique dont la période
   * couvre une de ces ventes reste donc archivée. Une promotion à CODE n'y
   * entre pas (finances.ts ne compte que les automatiques) : elle peut partir.
   *
   * Le bandeau gardait parfois l'identifiant de la promotion qu'il annonçait
   * (`announcement_banner.promo_rule_id`, historique, plus lu) : il est
   * détaché dans la même transaction, comme la base le ferait (« set null »).
   */
  app.delete("/admin/promos/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.notFound();
    return supprimerPourToujours(c, {
      lire: async () =>
        (await db.select().from(schema.promoRules).where(eq(schema.promoRules.id, id)))[0] ??
        null,
      estArchive: (r) => r.archivedAt != null,
      empeche: async (r) => {
        if (normaliserCode(r.code)) return null;
        // Une promotion ÉTEINTE n'est lue par personne : la page Finances ne
        // juge les ventes qu'avec les promotions allumées (finances.ts,
        // reglesActives). Sans cette ligne, une promotion créée par erreur et
        // jamais allumée ne se supprimait pas.
        if (r.active === false) return null;
        const [n] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.orders)
          .where(
            and(
              isNull(schema.orders.promotions),
              // Une vente avec un code se justifie par son code (finances.ts).
              sql`coalesce(${schema.orders.promoCode}, '') = ''`,
              notInArray(schema.orders.status, HORS_VENTES),
              // En TEXTE ISO, converti par Postgres : une Date passée telle
              // quelle dans un sql`` n'est pas mise en forme (client partagé
              // avec Drizzle, voir analytique.ts) et la requête tombait sur
              // une erreur de type — la suppression d'une promotion datée
              // échouait avant même de répondre.
              r.startsAt
                ? sql`${schema.orders.createdAt} >= ${r.startsAt.toISOString()}::timestamptz`
                : undefined,
              r.endsAt
                ? sql`${schema.orders.createdAt} <= ${r.endsAt.toISOString()}::timestamptz`
                : undefined,
            ),
          );
        const ventes = Number(n?.n ?? 0);
        return ventes > 0
          ? `« ${r.name} » sert encore à la page Finances : ${ventes} vente(s) d'avant le figeage des promotions se jugent avec elle, et ses remises y passeraient pour des anomalies. Elle reste archivée.`
          : null;
      },
      supprimer: async (r) => {
        await db.transaction(async (tx) => {
          await tx
            .update(schema.announcementBanners)
            .set({ promoRuleId: null })
            .where(eq(schema.announcementBanners.promoRuleId, r.id));
          await tx.delete(schema.promoRules).where(eq(schema.promoRules.id, r.id));
        });
      },
      utilisePar: "d'autres éléments",
    });
  });
}
