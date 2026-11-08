/**
 * Le bandeau d'annonce, en haut du site : une LISTE de messages qui défilent.
 *
 * « Le bandeau ne doit pas du tout être lié aux promos… Le bandeau c'est juste
 * un texte et un bouton. Et il faut pouvoir en mettre plusieurs qui
 * défilent. » (Margaux). Il était une seule ligne, qui enregistrait avec elle
 * la promotion qu'elle annonçait — l'allumait, l'éteignait, en changeait les
 * dates. Ce n'est plus le cas : ce module n'écrit JAMAIS dans les promotions,
 * qui se règlent dans leur écran (promotions.ts). La colonne `promo_rule_id`
 * reste en base, avec ce qu'elle contient, mais n'est plus lue.
 *
 * Un message : un texte, un bouton facultatif (texte ET adresse, ou rien),
 * actif ou non, une période facultative, une place dans le défilement. Les
 * réglages communs (couleurs, durée d'affichage de chaque message) vivent
 * dans le réglage `bandeau.reglages` ; tant qu'il n'a pas été enregistré, ce
 * sont les couleurs du premier message et six secondes — le site ne change
 * pas d'allure avant que la boutique le décide.
 *
 * Un message s'archive, et se restaure. Archivé, il peut ensuite être
 * supprimé définitivement (suppression.ts) : rien d'autre ne pointe vers lui,
 * ses traductions vivent dans sa ligne et partent avec elle.
 *
 * Les traductions du message et du texte du bouton passent par la route
 * commune /admin/banner/:id/translations (traductions.ts).
 */
import type { Hono } from "hono";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { normaliserLienSaisi } from "@memoryline/types/bandeaux-visuels";
import { db, schema } from "./db/client.js";
import { supprimerPourToujours } from "./suppression.js";
import { langueDuVisiteur, texteDansLaLangue } from "./traductions.js";

/** La clé du réglage commun dans la table `setting`. */
export const REGLAGE_BANDEAU = "bandeau.reglages";

/** Ce qui vaut pour tout le bandeau. */
export interface ReglagesBandeau {
  /** Couleur de fond, #RRGGBB. */
  fond: string;
  /** Couleur du texte, #RRGGBB. */
  texte: string;
  /** Combien de secondes chaque message reste affiché, de 4 à 15. */
  dureeSecondes: number;
}

const FOND_DEFAUT = "#20211f";
const TEXTE_DEFAUT = "#f7f3ec";
const DUREE_DEFAUT = 6;
export const DUREE_MIN = 4;
export const DUREE_MAX = 15;
const MESSAGE_MAX = 200;
const BOUTON_MAX = 60;
const ADRESSE_MAX = 500;

const estCouleur = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);

type LigneBandeau = typeof schema.announcementBanners.$inferSelect;

/** Les messages non archivés, dans l'ordre du défilement. */
async function messagesRanges(): Promise<LigneBandeau[]> {
  return db
    .select()
    .from(schema.announcementBanners)
    .where(isNull(schema.announcementBanners.archivedAt))
    .orderBy(asc(schema.announcementBanners.position), asc(schema.announcementBanners.id));
}

/**
 * Les réglages communs. Absents : les couleurs du premier message (celles que
 * le site montre aujourd'hui) et six secondes.
 */
async function lireReglages(premier?: LigneBandeau | null): Promise<{
  reglages: ReglagesBandeau;
  enregistres: boolean;
}> {
  const [ligne] = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, REGLAGE_BANDEAU));
  const v = (ligne?.value ?? null) as Partial<ReglagesBandeau> | null;
  const duree = Number(v?.dureeSecondes);
  return {
    enregistres: Boolean(ligne),
    reglages: {
      fond: estCouleur(v?.fond) ? v!.fond! : estCouleur(premier?.bgColor) ? premier!.bgColor! : FOND_DEFAUT,
      texte: estCouleur(v?.texte)
        ? v!.texte!
        : estCouleur(premier?.textColor)
          ? premier!.textColor!
          : TEXTE_DEFAUT,
      dureeSecondes:
        Number.isInteger(duree) && duree >= DUREE_MIN && duree <= DUREE_MAX ? duree : DUREE_DEFAUT,
    },
  };
}

/** Un message est-il à l'écran à cet instant ? */
function enLigne(b: LigneBandeau, maintenant: Date): boolean {
  return (
    b.active &&
    !b.archivedAt &&
    (!b.startsAt || b.startsAt <= maintenant) &&
    (!b.endsAt || b.endsAt >= maintenant)
  );
}

/** Une date reçue, ou null ; `undefined` si elle est illisible. */
function dateLue(v: unknown): Date | null | undefined {
  if (v == null || v === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Le message envoyé par le back-office, vérifié. Le bouton va par deux : un
 * texte sans adresse ne mène nulle part, une adresse sans texte ne se voit
 * pas.
 */
export function messageRecu(b: Record<string, unknown>):
  | { erreur: string }
  | {
      valeurs: {
        message: string;
        linkUrl: string | null;
        linkLabel: string | null;
        active: boolean;
        startsAt: Date | null;
        endsAt: Date | null;
      };
    } {
  const message = String(b.message ?? "").replace(/\s+/g, " ").trim();
  if (!message) return { erreur: "Écrivez le texte du message." };
  if (message.length > MESSAGE_MAX)
    return { erreur: `Le message est trop long : ${MESSAGE_MAX} caractères au plus, pour tenir sur un téléphone.` };
  const linkLabel = String(b.linkLabel ?? "").trim();
  const linkUrl = normaliserLienSaisi(String(b.linkUrl ?? ""));
  if (Boolean(linkLabel) !== Boolean(linkUrl))
    return {
      erreur: linkLabel
        ? "Le bouton a un texte mais pas d'adresse : indiquez la page où il mène, ou videz son texte."
        : "Le bouton a une adresse mais pas de texte : écrivez ce qu'il affiche, ou videz son adresse.",
    };
  if (linkLabel.length > BOUTON_MAX)
    return { erreur: `Le texte du bouton est trop long : ${BOUTON_MAX} caractères au plus.` };
  if (linkUrl.length > ADRESSE_MAX) return { erreur: "L'adresse du bouton est trop longue." };
  if (linkUrl && !/^(https?:\/\/|\/|mailto:|tel:)/i.test(linkUrl))
    return { erreur: "L'adresse du bouton doit être une page du site (« /affiches ») ou une adresse complète (« https://… »)." };
  const startsAt = dateLue(b.startsAt);
  const endsAt = dateLue(b.endsAt);
  if (startsAt === undefined || endsAt === undefined) return { erreur: "Une date est illisible." };
  if (startsAt && endsAt && endsAt <= startsAt)
    return { erreur: "La fin de l'affichage doit venir après son début." };
  return {
    valeurs: {
      message,
      linkUrl: linkUrl || null,
      linkLabel: linkLabel || null,
      active: b.active !== false,
      startsAt,
      endsAt,
    },
  };
}

export function mountBandeau(app: Hono): void {
  /**
   * Le bandeau tel que le site l'affiche : les réglages communs, et les
   * messages en ligne à cet instant (actifs, non archivés, dans leurs dates),
   * dans l'ordre du défilement, traduits dans la langue du visiteur (?lang=),
   * le français à défaut, champ par champ.
   */
  app.get("/banners", async (c) => {
    const langue = langueDuVisiteur(c);
    const maintenant = new Date();
    const tous = await messagesRanges();
    const { reglages } = await lireReglages(tous[0] ?? null);
    const messages = tous
      .filter((b) => enLigne(b, maintenant))
      .map((b) => ({
        id: b.id,
        message: texteDansLaLangue(b.translations, langue, "message", b.message),
        linkUrl: b.linkUrl,
        linkLabel: texteDansLaLangue(b.translations, langue, "linkLabel", b.linkLabel),
      }));
    return c.json({ reglages, messages });
  });

  /**
   * L'ancienne forme, gardée pour ce qui la lirait encore : le PREMIER
   * message en ligne, avec les couleurs du bandeau, ou null.
   */
  app.get("/banner", async (c) => {
    const langue = langueDuVisiteur(c);
    const maintenant = new Date();
    const tous = await messagesRanges();
    const { reglages } = await lireReglages(tous[0] ?? null);
    const premier = tous.find((b) => enLigne(b, maintenant));
    if (!premier) return c.json(null);
    const { translations, ...bandeau } = premier;
    return c.json({
      ...bandeau,
      bgColor: reglages.fond,
      textColor: reglages.texte,
      message: texteDansLaLangue(translations, langue, "message", bandeau.message),
      linkLabel: texteDansLaLangue(translations, langue, "linkLabel", bandeau.linkLabel),
    });
  });

  /**
   * Tout le bandeau pour le back-office : réglages (et s'ils ont été
   * enregistrés), messages rangés, puis messages archivés, marqués.
   */
  app.get("/admin/banners", async (c) => {
    const vivants = await messagesRanges();
    const archives = await db
      .select()
      .from(schema.announcementBanners)
      .where(isNotNull(schema.announcementBanners.archivedAt))
      .orderBy(asc(schema.announcementBanners.archivedAt));
    const { reglages, enregistres } = await lireReglages(vivants[0] ?? null);
    return c.json({ reglages, reglagesEnregistres: enregistres, messages: [...vivants, ...archives] });
  });

  /**
   * Crée un message (sans `id`, placé en fin de défilement) ou le modifie.
   * N'écrit que le message : ni sa place, ni ses traductions, ni aucune
   * promotion.
   */
  app.post("/admin/banners", async (c) => {
    const b = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    const lu = messageRecu(b);
    if ("erreur" in lu) return c.json({ error: lu.erreur }, 400);
    const id = b.id == null || b.id === "" ? null : Number(b.id);
    if (id !== null) {
      if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Message introuvable." }, 404);
      const [row] = await db
        .update(schema.announcementBanners)
        .set(lu.valeurs)
        .where(eq(schema.announcementBanners.id, id))
        .returning();
      if (!row) return c.json({ error: "Message introuvable." }, 404);
      return c.json(row);
    }
    const [dernier] = await db
      .select({ max: sql<number>`coalesce(max(${schema.announcementBanners.position}), 0)` })
      .from(schema.announcementBanners)
      .where(isNull(schema.announcementBanners.archivedAt));
    const [row] = await db
      .insert(schema.announcementBanners)
      .values({ ...lu.valeurs, position: Number(dernier?.max ?? 0) + 1 })
      .returning();
    return c.json(row);
  });

  /** Allume ou éteint un message, sans rien changer d'autre. */
  app.post("/admin/banners/:id/toggle", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.notFound();
    const [row] = await db
      .update(schema.announcementBanners)
      .set({ active: sql`not ${schema.announcementBanners.active}` })
      .where(eq(schema.announcementBanners.id, id))
      .returning();
    if (!row) return c.notFound();
    return c.json(row);
  });

  /**
   * Archive un message, ou le restaure ({ archive: false }). Restauré, il
   * revient en fin de défilement, éteint : à rallumer quand il doit reparaître.
   */
  app.post("/admin/banners/:id/archive", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.notFound();
    const b = ((await c.req.json().catch(() => ({}))) ?? {}) as { archive?: unknown };
    const archiver = b.archive !== false;
    let valeurs: Partial<LigneBandeau>;
    if (archiver) valeurs = { archivedAt: new Date() };
    else {
      const [dernier] = await db
        .select({ max: sql<number>`coalesce(max(${schema.announcementBanners.position}), 0)` })
        .from(schema.announcementBanners)
        .where(isNull(schema.announcementBanners.archivedAt));
      valeurs = { archivedAt: null, active: false, position: Number(dernier?.max ?? 0) + 1 };
    }
    const [row] = await db
      .update(schema.announcementBanners)
      .set(valeurs)
      .where(eq(schema.announcementBanners.id, id))
      .returning();
    if (!row) return c.notFound();
    return c.json({ ok: true, archived: row.archivedAt != null });
  });

  /**
   * Supprime définitivement un message ARCHIVÉ (règles : suppression.ts).
   * Aucune table ne pointe vers un message, et ses traductions sont dans sa
   * ligne : rien d'autre ne part avec lui. La condition « archivé » est
   * répétée dans la requête : restauré depuis un autre onglet entre la
   * lecture et l'effacement, il n'est pas touché.
   */
  app.delete("/admin/banners/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.notFound();
    return supprimerPourToujours(c, {
      lire: async () =>
        (await db.select().from(schema.announcementBanners).where(eq(schema.announcementBanners.id, id)))[0] ??
        null,
      estArchive: (m) => m.archivedAt != null,
      supprimer: async () => {
        await db
          .delete(schema.announcementBanners)
          .where(and(eq(schema.announcementBanners.id, id), isNotNull(schema.announcementBanners.archivedAt)));
      },
    });
  });

  /**
   * L'ordre du défilement : { ids } dans l'ordre voulu, tous les messages non
   * archivés et eux seuls. Une liste incomplète est refusée : elle laisserait
   * des messages à des places qui ne veulent plus rien dire.
   */
  app.post("/admin/banners/ordre", async (c) => {
    const b = ((await c.req.json().catch(() => ({}))) ?? {}) as { ids?: unknown };
    const ids = Array.isArray(b.ids) ? b.ids.map(Number) : [];
    if (!ids.length || ids.some((x) => !Number.isInteger(x) || x <= 0) || new Set(ids).size !== ids.length)
      return c.json({ error: "Ordre illisible. Rechargez la page." }, 400);
    const vivants = await db
      .select({ id: schema.announcementBanners.id })
      .from(schema.announcementBanners)
      .where(isNull(schema.announcementBanners.archivedAt));
    const attendus = new Set(vivants.map((v) => v.id));
    if (ids.length !== attendus.size || ids.some((x) => !attendus.has(x)))
      return c.json({ error: "La liste a changé entre-temps : rechargez la page, puis rangez à nouveau." }, 409);
    await db.transaction(async (tx) => {
      for (const [i, id] of ids.entries())
        await tx
          .update(schema.announcementBanners)
          .set({ position: i + 1 })
          .where(
            and(
              eq(schema.announcementBanners.id, id),
              inArray(schema.announcementBanners.id, [...attendus]),
            ),
          );
    });
    return c.json({ ok: true });
  });

  /** Les réglages communs : couleurs de fond et de texte, durée par message. */
  app.post("/admin/banners/reglages", async (c) => {
    const b = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    const fond = String(b.fond ?? "").trim();
    const texte = String(b.texte ?? "").trim();
    const duree = Number(b.dureeSecondes);
    if (!estCouleur(fond) || !estCouleur(texte))
      return c.json({ error: "Choisissez les deux couleurs dans le nuancier." }, 400);
    if (!Number.isInteger(duree) || duree < DUREE_MIN || duree > DUREE_MAX)
      return c.json({ error: `Chaque message reste affiché de ${DUREE_MIN} à ${DUREE_MAX} secondes.` }, 400);
    const valeur: ReglagesBandeau = { fond: fond.toLowerCase(), texte: texte.toLowerCase(), dureeSecondes: duree };
    await db
      .insert(schema.settings)
      .values({
        key: REGLAGE_BANDEAU,
        value: valeur,
        label: "Bandeau d'annonce : couleurs et défilement",
        group: "bandeau",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value: valeur, updatedAt: new Date() },
      });
    return c.json({ reglages: valeur });
  });
}
