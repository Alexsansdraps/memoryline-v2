/**
 * Les lieux de retrait : où la cliente vient chercher sa commande quand elle
 * choisit un mode « Retrait sur place » — le chalet du marché de Noël de
 * Mulhouse, l'atelier, un salon.
 *
 * Avant, la caisse proposait les STANDS ouverts. Mais un stand est une
 * tablette qui vend, pas forcément un endroit où l'on vient chercher une
 * affiche, et la boutique ne pouvait ni renommer ce « chalet » coché sous le
 * mode, ni en ajouter un autre, ni l'enlever (réponse de Margaux). Les lieux
 * vivent maintenant à part, réglés dans BO › Livraison › Lieux de retrait :
 * un nom, une adresse, un texte libre sur plusieurs lignes (horaires, accès),
 * actif ou non, rangés à la main, traduits dans les cinq langues.
 *
 * Ils s'archivent, et un lieu archivé peut ensuite être supprimé pour de bon
 * (voir la route DELETE, plus bas). Une commande garde de toute
 * façon une COPIE de ce que la cliente a lu (`order.pickup_point`) : le lieu
 * peut être renommé ou archivé ensuite, la fiche, le bon, les courriels et
 * la facture disent toujours où elle a été attendue. Les commandes d'avant
 * ces lieux gardent leur ancien repère, « stand:<id> » dans
 * `relay_point_id`, qu'on ne réécrit pas : `lieuDeRetrait` sait le lire.
 */
import type { Hono } from "hono";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "./db/client.js";
import type { InstantaneLieuRetrait } from "./db/schema.js";
import { champTraduit } from "./traductions.js";
import {
  dernierMomentDeRetrait,
  LANGUES_RESUME,
  resumeHoraires,
  semaineDuStand,
  retraitProposable,
  type StandCalendrier,
} from "@memoryline/types";
import { supprimerPourToujours } from "./suppression.js";

export const NOM_MAX = 120;
export const ADRESSE_MAX = 300;
export const DESCRIPTION_MAX = 1000;

/** Un lieu, tel que la caisse, la fiche ou le courriel l'affichent. */
export interface LieuDeRetrait {
  nom: string;
  adresse: string | null;
  description: string | null;
  /**
   * Vrai pour une commande d'avant les lieux de retrait (« stand:<id> ») :
   * on n'en connaît que le nom du stand.
   */
  ancien: boolean;
}

/** Un texte sur plusieurs lignes, propre : fins de ligne unifiées, bords nets. */
function texteMultiligne(brut: unknown, max: number): string {
  return String(brut ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    // Trois lignes vides de suite n'apportent rien qu'un trou dans le
    // courriel : une seule suffit à séparer deux paragraphes.
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

/**
 * Le lieu où la cliente retire cette commande, dans sa langue, ou null si ce
 * n'est pas un retrait.
 *
 * L'instantané d'abord : c'est ce qu'elle a lu en commandant. À défaut, une
 * commande d'avant les lieux de retrait, prise sur le repère d'un stand
 * (« stand:<id> ») : on n'en a que le nom, gardé dans `relayPointLabel`.
 * C'est cette fonction, et elle seule, qui sait lire ces deux formes — les
 * tests « commence par stand: » dispersés dans le code passent par elle.
 */
export function lieuDeRetrait(
  order: {
    pickupPoint?: InstantaneLieuRetrait | null;
    relayPointId?: string | null;
    relayPointLabel?: string | null;
  },
  langue = "fr",
): LieuDeRetrait | null {
  const p = order.pickupPoint;
  if (p && typeof p === "object" && p.nom) {
    return {
      nom: champTraduit(p.translations, langue, "nom") ?? p.nom,
      adresse: p.adresse?.trim() || null,
      description: p.description?.trim()
        ? (champTraduit(p.translations, langue, "description") ?? p.description)
        : null,
      ancien: false,
    };
  }
  if (String(order.relayPointId ?? "").startsWith("stand:"))
    return {
      nom: order.relayPointLabel?.trim() || "Retrait sur place",
      adresse: null,
      description: null,
      ancien: true,
    };
  return null;
}

/** Une seule ligne, pour une facture ou un export : « Chalet — 1 place … ». */
export function libelleDuLieu(lieu: LieuDeRetrait): string {
  const adresse = (lieu.adresse ?? "").split("\n").map((l) => l.trim()).filter(Boolean).join(", ");
  return adresse ? `${lieu.nom} — ${adresse}` : lieu.nom;
}

/**
 * Le lieu découpé en lignes, pour un courriel : le nom, l'adresse ligne à
 * ligne, le texte ligne à ligne. Null quand ce n'est pas un retrait.
 */
export function lignesDuLieu(
  lieu: LieuDeRetrait | null,
): { nom: string; adresse: string[]; description: string[] } | null {
  if (!lieu) return null;
  const lignes = (t: string | null) =>
    (t ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  return { nom: lieu.nom, adresse: lignes(lieu.adresse), description: lignes(lieu.description) };
}

/** Ce qui sait lire la base : elle, ou une transaction. */
type Lecteur = Pick<typeof db, "select">;

/**
 * Le lieu choisi à la caisse, relu au moment d'écrire la commande : actif et
 * non archivé, sinon rien. La cliente a pu garder la page ouverte pendant
 * qu'on fermait le chalet — on refuse alors sa commande avec un message,
 * plutôt que de l'attendre à un endroit qui n'existe plus.
 */
export async function lieuPourLaCommande(
  lecteur: Lecteur,
  id: number,
): Promise<{
  id: number;
  standId: number | null;
  retirerAvant: string | null;
  instantane: InstantaneLieuRetrait;
} | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const [lieu] = await lecteur
    .select()
    .from(schema.pickupPoints)
    .where(
      and(
        eq(schema.pickupPoints.id, id),
        eq(schema.pickupPoints.active, true),
        isNull(schema.pickupPoints.archivedAt),
      ),
    );
  if (!lieu) return null;
  // Le dernier jour du stand, pour un retrait au stand : la commande le
  // garde, et la cliente doit avoir coché qu'elle viendra avant.
  const [stand] = lieu.standId
    ? await lecteur
        .select({ dateDebut: schema.stands.dateDebut, dateFin: schema.stands.dateFin, horaires: schema.stands.horaires })
        .from(schema.stands)
        .where(eq(schema.stands.id, lieu.standId))
    : [];
  const dernier = stand
    ? dernierMomentDeRetrait({ dateDebut: stand.dateDebut ?? null, dateFin: stand.dateFin ?? null, horaires: stand.horaires ?? null })
    : null;
  const retirerAvant = dernier ? (dernier.heure ? `${dernier.jour} ${dernier.heure}` : dernier.jour) : null;
  return {
    id: lieu.id,
    standId: lieu.standId ?? null,
    retirerAvant,
    instantane: {
      ...(retirerAvant ? { retirerAvant } : {}),
      nom: lieu.nom,
      adresse: lieu.adresse?.trim() || null,
      description: lieu.description?.trim() || null,
      ...(lieu.translations ? { translations: lieu.translations } : {}),
    },
  };
}

/** Les lieux proposés à la caisse, dans la langue de la visiteuse. */
export async function lieuxRetraitPublics(langue: string): Promise<
  {
    id: number;
    nom: string;
    adresse: string | null;
    description: string | null;
    /** Le stand dont c'est le lieu : il ne sort que sous « Retrait au stand ». */
    standId: number | null;
    /** Le dernier jour du stand (« AAAA-MM-JJ ») : la cliente coche qu'elle viendra avant. */
    retirerAvant: string | null;
    /** L'heure où le stand ferme ce dernier jour (« 20:00 »), pour la case à cocher. */
    retirerAvantHeure: string | null;
    /** Le stand est-il ouvert en ce moment ? Dit à la caisse (17/11). Null hors stand. */
    ouvert: boolean | null;
    /** Premier et dernier jour du stand (« AAAA-MM-JJ »). Null hors stand. */
    du: string | null;
    au: string | null;
    /** Ses 7 prochains jours, pour le petit tableau de la caisse (17/11). */
    semaine: ReturnType<typeof semaineDuStand>;
  }[]
> {
  const maintenant = new Date();
  const rangs = await db
    .select({
      l: schema.pickupPoints,
      dateDebut: schema.stands.dateDebut,
      dateFin: schema.stands.dateFin,
      horaires: schema.stands.horaires,
      standOuvert: schema.stands.ouvert,
    })
    .from(schema.pickupPoints)
    .leftJoin(schema.stands, eq(schema.stands.id, schema.pickupPoints.standId))
    .where(and(eq(schema.pickupPoints.active, true), isNull(schema.pickupPoints.archivedAt)))
    .orderBy(asc(schema.pickupPoints.position), asc(schema.pickupPoints.id));
  return rangs.map(({ l, dateDebut, dateFin, horaires, standOuvert }) => {
    // Le dernier moment pour venir : le dernier jour OUVERT, à l'heure où il ferme.
    const cal = { dateDebut: dateDebut ?? null, dateFin: dateFin ?? null, horaires: horaires ?? null };
    const dernier = l.standId != null ? dernierMomentDeRetrait(cal) : null;
    return {
    id: l.id,
    nom: champTraduit(l.translations, langue, "nom") ?? l.nom,
    adresse: l.adresse?.trim() || null,
    description: l.description?.trim()
      ? (champTraduit(l.translations, langue, "description") ?? l.description)
      : null,
    standId: l.standId ?? null,
    retirerAvant: dernier?.jour ?? null,
    retirerAvantHeure: dernier?.heure ?? null,
    ouvert: l.standId != null ? !!standOuvert : null,
    du: l.standId != null ? (dateDebut ?? null) : null,
    au: l.standId != null ? (dateFin ?? null) : null,
    semaine: l.standId != null ? semaineDuStand(cal, maintenant) : null,
    };
  });
}

/** Combien de lieux la caisse proposerait : sans aucun, le mode retrait se masque. */
export async function nombreDeLieuxActifs(): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(schema.pickupPoints)
    .where(
      and(
        eq(schema.pickupPoints.active, true),
        isNull(schema.pickupPoints.archivedAt),
        isNull(schema.pickupPoints.standId),
      ),
    );
  return Number(r?.n ?? 0);
}

/** Combien de stands ouverts la caisse propose sous « Retrait au stand ». */
export async function nombreDeLieuxDesStands(): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(schema.pickupPoints)
    .where(
      and(
        eq(schema.pickupPoints.active, true),
        isNull(schema.pickupPoints.archivedAt),
        sql`${schema.pickupPoints.standId} is not null`,
      ),
    );
  return Number(r?.n ?? 0);
}

/**
 * Le lieu de retrait d'un stand, tenu à jour à chaque changement du stand
 * (salon.ts) : son nom, son emplacement, actif tant que le stand est ouvert,
 * archivé avec lui. Créé la première fois. Rien à faire au BO : la cliente
 * voit « Retrait au stand » à la caisse dès qu'un stand ouvre (17/11).
 */
/** Ce que le calendrier d'un stand lit de sa ligne en base. */
export function calendrierDuStand(stand: typeof schema.stands.$inferSelect): StandCalendrier {
  return {
    ouvert: stand.ouvert,
    pilotage: stand.pilotage,
    dateDebut: stand.dateDebut ?? null,
    dateFin: stand.dateFin ?? null,
    horaires: stand.horaires ?? null,
    archivedAt: stand.archivedAt,
    actif: stand.actif,
  };
}

export async function synchroniserLieuDuStand(standId: number, maintenant = new Date()): Promise<void> {
  const [stand] = await db.select().from(schema.stands).where(eq(schema.stands.id, standId));
  if (!stand) return;
  const cal = calendrierDuStand(stand);
  // Les dates et les horaires, dits en clair dans chaque langue : ils
  // s'affichent sous le stand à la caisse, et la commande les garde. Les 7
  // prochains jours y sont écrits un par un (17/11) : la minute qui suit
  // minuit les fait avancer d'un jour.
  const description = resumeHoraires(cal, "fr", { maintenant }) || null;
  const translations = description
    ? Object.fromEntries(
        LANGUES_RESUME.filter((l) => l !== "fr").map((l) => [l, { description: resumeHoraires(cal, l, { maintenant }) }]),
      )
    : null;
  const voulu = {
    nom: stand.nom,
    adresse: stand.emplacement?.trim() || null,
    description,
    translations,
    active: retraitProposable(cal, maintenant),
    archived: !!stand.archivedAt,
  };
  const [lieu] = await db
    .select()
    .from(schema.pickupPoints)
    .where(eq(schema.pickupPoints.standId, standId));
  // Rien n'a changé (le cas de presque tous les passages de la minute) :
  // on n'écrit pas.
  if (
    lieu &&
    lieu.nom === voulu.nom &&
    (lieu.adresse ?? null) === voulu.adresse &&
    (lieu.description ?? null) === voulu.description &&
    JSON.stringify(lieu.translations ?? null) === JSON.stringify(voulu.translations) &&
    lieu.active === voulu.active &&
    !!lieu.archivedAt === voulu.archived
  )
    return;
  const valeurs = {
    nom: voulu.nom,
    adresse: voulu.adresse,
    description: voulu.description,
    translations: voulu.translations,
    active: voulu.active,
    archivedAt: voulu.archived ? (lieu?.archivedAt ?? maintenant) : null,
    updatedAt: maintenant,
  };
  if (lieu) await db.update(schema.pickupPoints).set(valeurs).where(eq(schema.pickupPoints.id, lieu.id));
  else await db.insert(schema.pickupPoints).values({ ...valeurs, standId, position: 0 });
}

export function mountLieuxRetrait(app: Hono): void {
  /**
   * Tous les lieux, archivés compris et marqués : l'écran les range dans sa
   * section « Lieux archivés » sans redemander la liste. Dans l'ordre de la
   * caisse.
   */
  app.get("/admin/pickup-points", async (c) => {
    // Sans les lieux des stands : ils se règlent dans Ventes stand (nom,
    // emplacement, ouverture), pas ici.
    const lignes = await db
      .select()
      .from(schema.pickupPoints)
      .where(isNull(schema.pickupPoints.standId))
      .orderBy(asc(schema.pickupPoints.position), asc(schema.pickupPoints.id));
    return c.json(lignes);
  });

  /**
   * Crée un lieu, ou le modifie (avec `id`). Un nouveau lieu se range en
   * dernier : c'est là qu'on s'attend à le trouver juste après l'avoir créé.
   */
  app.post("/admin/pickup-points", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const nom = String(b.nom ?? "").replace(/\s+/g, " ").trim();
    if (!nom)
      return c.json(
        { error: "Donnez un nom au lieu, par exemple « Chalet du marché de Noël de Mulhouse »." },
        400,
      );
    if (nom.length > NOM_MAX)
      return c.json({ error: `Le nom tient en ${NOM_MAX} caractères au plus.` }, 400);
    const adresse = texteMultiligne(b.adresse, ADRESSE_MAX + 1);
    if (adresse.length > ADRESSE_MAX)
      return c.json({ error: `L'adresse tient en ${ADRESSE_MAX} caractères au plus.` }, 400);
    const description = texteMultiligne(b.description, DESCRIPTION_MAX + 1);
    if (description.length > DESCRIPTION_MAX)
      return c.json(
        { error: `Le texte du lieu tient en ${DESCRIPTION_MAX} caractères au plus.` },
        400,
      );
    const valeurs = {
      nom,
      adresse: adresse || null,
      description: description || null,
      active: b.active !== false,
      updatedAt: new Date(),
    };
    const id = Number(b.id);
    if (Number.isInteger(id) && id > 0) {
      const [ligne] = await db
        .update(schema.pickupPoints)
        .set(valeurs)
        .where(eq(schema.pickupPoints.id, id))
        .returning();
      if (!ligne) return c.json({ error: "Ce lieu n'existe plus." }, 404);
      return c.json(ligne);
    }
    const [dernier] = await db
      .select({ max: sql<number>`coalesce(max(${schema.pickupPoints.position}), 0)::int` })
      .from(schema.pickupPoints);
    const [ligne] = await db
      .insert(schema.pickupPoints)
      .values({ ...valeurs, position: Number(dernier?.max ?? 0) + 1 })
      .returning();
    return c.json(ligne);
  });

  /**
   * Archive un lieu, ou le restaure. Archivé, il quitte la caisse et la liste
   * ordinaire ; les commandes qui l'ont choisi n'en savent rien — elles
   * gardent leur copie.
   */
  app.post("/admin/pickup-points/:id/archive", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "introuvable" }, 404);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    // Défaut : on archive. Seul un « archive: false » explicite restaure.
    const archiver = b.archive !== false;
    const [ligne] = await db
      .update(schema.pickupPoints)
      .set({ archivedAt: archiver ? new Date() : null, updatedAt: new Date() })
      .where(eq(schema.pickupPoints.id, id))
      .returning();
    if (!ligne) return c.json({ error: "Ce lieu n'existe plus." }, 404);
    return c.json({ ok: true, archive: ligne.archivedAt != null });
  });

  /**
   * Supprime DÉFINITIVEMENT un lieu archivé.
   *
   * Les commandes qui l'ont choisi n'en ont plus besoin : elles gardent la
   * COPIE de ce que la cliente a lu (`order.pickup_point`), et c'est elle, et
   * elle seule, que lisent la fiche, le bon, les courriels et la facture
   * (`lieuDeRetrait`). L'identifiant qu'elles gardent aussi
   * (`order.pickup_point_id`) n'est relu nulle part : il est détaché dans la
   * même transaction, comme la base le ferait (« set null »).
   */
  app.delete("/admin/pickup-points/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "introuvable" }, 404);
    return supprimerPourToujours(c, {
      lire: async () =>
        (await db.select().from(schema.pickupPoints).where(eq(schema.pickupPoints.id, id)))[0] ??
        null,
      estArchive: (l) => l.archivedAt != null,
      supprimer: async (l) => {
        await db.transaction(async (tx) => {
          await tx
            .update(schema.orders)
            .set({ pickupPointId: null })
            .where(eq(schema.orders.pickupPointId, l.id));
          await tx.delete(schema.pickupPoints).where(eq(schema.pickupPoints.id, l.id));
        });
      },
      utilisePar: "des commandes",
    });
  });

  /** L'ordre de la caisse, tel que l'écran l'a rangé : les identifiants dans l'ordre. */
  app.post("/admin/pickup-points/ordre", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const ids = Array.isArray(b.ids)
      ? [...new Set((b.ids as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0))]
      : [];
    if (!ids.length) return c.json({ error: "Aucun lieu à ranger." }, 400);
    await db.transaction(async (tx) => {
      for (const [i, id] of ids.entries())
        await tx
          .update(schema.pickupPoints)
          .set({ position: i + 1 })
          .where(eq(schema.pickupPoints.id, id));
    });
    return c.json({ ok: true });
  });
}
