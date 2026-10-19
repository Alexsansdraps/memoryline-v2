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
import type { Hono } from "hono";
import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import {
  POSTER_FORMATS,
  estConfigV2,
  lireConditions,
  lireOffre,
  normaliserCode,
} from "@memoryline/types";
import { db, schema } from "./db/client.js";
import { langueDuVisiteur, texteDansLaLangue } from "./traductions.js";

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
    const percent = entierEntre(cfg.percent, 1, 100);
    if (percent === null) return { erreur: "Le pourcentage de remise doit aller de 1 à 100 %." };
    const c = communs(cfg);
    if ("erreur" in c) return c;
    return { config: { percent, conditions: c.conditions, cumulable: c.cumulable } };
  }
  if (type === "fixed") {
    const amountCents = entierEntre(cfg.amountCents, 1, 10_000_000);
    if (amountCents === null) return { erreur: "Indiquez le montant de la remise, en euros." };
    const c = communs(cfg);
    if ("erreur" in c) return c;
    return { config: { amountCents, conditions: c.conditions, cumulable: c.cumulable } };
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
    const b = await c.req.json().catch(() => ({}));
    const code = normaliserCode((b as { code?: unknown }).code);
    if (!code || code.length > 60) return c.json({ error: "code inconnu" }, 404);
    const now = new Date();
    const [regle] = await db
      .select()
      .from(schema.promoRules)
      .where(
        and(
          eq(schema.promoRules.active, true),
          isNull(schema.promoRules.archivedAt),
          sql`upper(${schema.promoRules.code}) = ${code}`,
        ),
      );
    if (
      !regle ||
      (regle.startsAt && regle.startsAt > now) ||
      (regle.endsAt && regle.endsAt < now)
    )
      return c.json({ error: "code inconnu" }, 404);
    return c.json({
      code,
      name: texteDansLaLangue(regle.translations, langue, "name", regle.name),
      type: regle.type,
      config: regle.config,
      priority: regle.priority,
    });
  });

  /** Toutes les promotions, archivées comprises (marquées par `archivedAt`). */
  app.get("/admin/promos", async (c) => {
    const rows = await db
      .select()
      .from(schema.promoRules)
      .orderBy(desc(schema.promoRules.priority), asc(schema.promoRules.id));
    return c.json(rows);
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
    if (code) {
      // Deux promotions vivantes ne peuvent pas répondre au même code : le
      // panier n'en prendrait qu'une, au hasard. Une archivée libère le sien.
      const [doublon] = await db
        .select({ id: schema.promoRules.id, name: schema.promoRules.name })
        .from(schema.promoRules)
        .where(
          and(
            sql`upper(${schema.promoRules.code}) = ${code}`,
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
              sql`upper(${schema.promoRules.code}) = ${code}`,
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
}
