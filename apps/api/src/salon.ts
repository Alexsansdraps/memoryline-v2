/**
 * Commandes prises au stand.
 *
 * Sur un salon, la boutique n'est pas un site : c'est une tablette posée sur
 * une table, devant quelqu'un qui a déjà son porte-monnaie à la main. D'où
 * trois différences avec la boutique en ligne, et elles ne sont pas
 * cosmétiques :
 *
 *   - AUCUN PRIX n'est montré. Le tarif du stand n'est pas celui du site (pas
 *     de frais de port, remises de salon, lots), et c'est la vendeuse qui
 *     l'annonce. Un prix affiché à l'écran la contredirait devant le client.
 *   - AUCUN PAIEMENT en ligne. L'argent se règle sur place ; la commande part
 *     en « à préparer » et la vendeuse la marque encaissée au back-office.
 *   - LE NOM ET L'ADRESSE E-MAIL suffisent à valider. On ne demande pas
 *     d'adresse postale : le client repart avec son affiche, ou vient la
 *     chercher. L'adresse e-mail, elle, sert à le prévenir quand c'est prêt —
 *     et c'est la seule occasion de la recueillir.
 *
 * L'accès passe par un code secret réglable au back-office : l'adresse du
 * stand ne doit pas permettre à un visiteur du site de commander gratuitement.
 */
import type { Hono } from "hono";
import type { Context } from "hono";
import { and, asc, count, eq, inArray, isNull, ne, sql as raw } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { db, schema } from "./db/client.js";
import { fr } from "./courriels/fr.js";
import { enregistrerFichiersDImpression } from "./configurator-routes.js";
import { rattacherGenerationsAuPanier } from "./ia.js";
import { HORS_VENTES } from "./statuts-vente.js";

/**
 * Un code d'accès : six caractères, sans ceux qui se confondent.
 *
 * Ni O ni 0, ni I ni 1 : ce code se dicte à voix haute dans le bruit d'un
 * salon, et se retape sur une tablette. Une lettre ambiguë coûte une minute
 * devant un client qui attend.
 */
export const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function nouveauCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/** Le stand désigné par ce code, s'il en existe un. */
export async function standDuCode(code: string) {
  const propre = code.trim().toUpperCase();
  if (!propre) return undefined;
  const [stand] = await db
    .select()
    .from(schema.stands)
    .where(eq(schema.stands.code, propre));
  return stand;
}

/**
 * Le code du stand accompagne-t-il la requête ?
 *
 * Comparaison simple : ce code n'est pas un mot de passe, il empêche de tomber
 * par hasard sur le stand depuis le site. Ce qui protège réellement, c'est que
 * la commande n'est pas payée et qu'elle passe sous les yeux de la vendeuse
 * avant d'être imprimée.
 */
export function codeFourni(c: Context): string {
  return String(
    c.req.query("code") ?? c.req.header("x-salon-code") ?? "",
  ).trim();
}

/** Numéro SAL-xxxx suivant, compteur séparé de celui de la boutique. */
async function prochainNumeroSalon(): Promise<string> {
  const rows = await db
    .select({ n: schema.orders.number })
    .from(schema.orders)
    .where(eq(schema.orders.channel, "salon"));
  let max = 0;
  for (const r of rows) {
    const m = /^SAL-(\d+)$/.exec(r.n);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return "SAL-" + String(max + 1).padStart(4, "0");
}

export function mountSalonRoutes(app: Hono): void {
  /**
   * Le stand est-il ouvert, et le code est-il le bon ?
   *
   * La tablette interroge cette route au chargement : elle sait alors s'il
   * faut demander le code, afficher le catalogue, ou dire que le stand est
   * fermé. On ne renvoie JAMAIS le code lui-même.
   */
  app.get("/salon/etat", async (c) => {
    const stand = await standDuCode(codeFourni(c));
    const autorise = !!stand?.ouvert;
    // « ouvert » répond à « y a-t-il un stand ouvert quelque part ». Sans lui,
    // une tablette au mauvais code ne saurait pas distinguer « je me suis
    // trompée » de « c'est fermé aujourd'hui ».
    const [ouverts] = await db
      .select({ n: count() })
      .from(schema.stands)
      .where(eq(schema.stands.ouvert, true));
    return c.json({
      ouvert: Number(ouverts?.n ?? 0) > 0,
      // Le nom du stand ne se dit qu'à qui a le code : l'écran le cache
      // justement tant que le code n'est pas bon.
      evenement: autorise ? stand!.nom : null,
      /** Vrai si la requête porte le code d'un stand ouvert. */
      autorise,
    });
  });

  /**
   * Enregistre une commande prise au stand.
   *
   * Le total est calculé et gardé en base — la boutique doit savoir ce qu'elle
   * a vendu, même si l'écran ne l'a jamais montré au client. Ce qui change,
   * c'est uniquement ce qu'on AFFICHE.
   */
  /**
   * ROUVRIR une vente tout juste validée, pour la corriger.
   *
   * Retour de la boutique : un client voit son erreur APRÈS avoir validé, et
   * la tablette, repartie sur un panier neuf, ne permettait plus d'y revenir.
   * La vente redevient un panier : son encaissement au grand livre passe en
   * « annule » (il sort des finances, qui ne comptent que les écritures
   * réussies), elle garde son numéro — la revalidation le reprend, sans trou
   * ni doublon —, et le journal de la commande raconte ce qui s'est passé.
   *
   * Garde-fous : seule la tablette qui l'a validée (même panier), au même
   * stand, dans les deux heures, et tant que l'affiche n'a été ni remise ni
   * remboursée. Au-delà, c'est une correction de back-office, pas de stand.
   */
  app.post("/salon/commandes/rouvrir", async (c) => {
    const stand = await standDuCode(codeFourni(c));
    if (!stand) return c.json({ error: "Code du stand incorrect." }, 403);
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    const cartId = String(body.cartId ?? "");
    const numero = String(body.numero ?? "");
    if (!cartId || !numero) return c.json({ error: "Commande introuvable." }, 404);

    const resultat = await db.transaction(async (tx) => {
      const [commande] = await tx
        .select()
        .from(schema.orders)
        .where(
          and(
            eq(schema.orders.clientOrderId, cartId),
            eq(schema.orders.number, numero),
            eq(schema.orders.standId, stand.id),
          ),
        )
        .for("no key update");
      if (!commande) return { erreur: "Commande introuvable.", statut: 404 as const };
      if (commande.status === "draft") return { ok: true as const };
      if (commande.status !== "paid" || commande.cancelledAt)
        return { erreur: "Cette commande ne peut plus être modifiée ici.", statut: 409 as const };

      const [remise] = await tx
        .select({ id: schema.fulfillments.id })
        .from(schema.fulfillments)
        .where(
          and(
            eq(schema.fulfillments.orderId, commande.id),
            eq(schema.fulfillments.status, "success"),
          ),
        )
        .limit(1);
      if (remise)
        return { erreur: "L'affiche a déjà été remise : corrigez la commande au back-office.", statut: 409 as const };

      const ecritures = await tx
        .select()
        .from(schema.orderTransactions)
        .where(
          and(
            eq(schema.orderTransactions.orderId, commande.id),
            eq(schema.orderTransactions.status, "success"),
          ),
        );
      if (ecritures.some((e) => e.kind === "refund"))
        return { erreur: "Cette commande a été remboursée : corrigez-la au back-office.", statut: 409 as const };
      const vente = ecritures.find((e) => e.kind === "sale" && e.gateway === "stand");
      if (vente && Date.now() - vente.createdAt.getTime() > 2 * 3600_000)
        return { erreur: "Validée il y a plus de deux heures : corrigez-la au back-office.", statut: 409 as const };

      await tx
        .update(schema.orderTransactions)
        .set({ status: "annule" })
        .where(
          and(
            eq(schema.orderTransactions.orderId, commande.id),
            eq(schema.orderTransactions.kind, "sale"),
            eq(schema.orderTransactions.gateway, "stand"),
            eq(schema.orderTransactions.status, "success"),
          ),
        );
      await tx
        .update(schema.orders)
        .set({ status: "draft", lastActivityAt: new Date() })
        .where(eq(schema.orders.id, commande.id));
      // Les noms des fichiers d'impression tombent avec la vente : le client
      // revient justement pour corriger, et un nom déjà retenu ne change plus
      // (enregistrerFichiersDImpression). Passée en A3 avec un cadre noir, la
      // vente revalidée s'imprimait encore sous « martin_A4_pas-cadre.pdf » :
      // mauvais papier, cadre oublié. La revalidation les renomme.
      await tx.delete(schema.printFiles).where(
        inArray(
          schema.printFiles.orderItemId,
          tx
            .select({ id: schema.orderItems.id })
            .from(schema.orderItems)
            .where(eq(schema.orderItems.orderId, commande.id)),
        ),
      );
      await tx.insert(schema.orderEvents).values({
        orderId: commande.id,
        kind: "event",
        message: "Commande rouverte au stand pour être corrigée (encaissement annulé).",
      });
      return { ok: true as const };
    });
    if ("erreur" in resultat) return c.json({ error: resultat.erreur }, resultat.statut);
    return c.json({ ok: true });
  });

  app.post("/salon/commandes", async (c) => {
    const stand = await standDuCode(codeFourni(c));
    if (!stand) return c.json({ error: "Code du stand incorrect." }, 403);
    if (!stand.ouvert) return c.json({ error: "Le stand est fermé." }, 403);

    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    const cartId = String(body.cartId ?? "");
    const nom = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!nom) return c.json({ error: "Le nom du client est nécessaire." }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return c.json({ error: "L'adresse e-mail ne semble pas valide." }, 400);

    const [panier] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.clientOrderId, cartId));
    if (!panier) return c.json({ error: "Panier introuvable." }, 404);
    if (panier.status !== "draft")
      return c.json({ error: "Cette commande est déjà enregistrée." }, 409);

    const lignes = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, panier.id));
    if (!lignes.length) return c.json({ error: "Aucune affiche choisie." }, 400);

    // Une fiche par personne, pas une par commande : un habitué des salons
    // reviendra, et on veut retrouver son historique.
    const [existant] = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.email, email));
    const client =
      existant ??
      (
        await db
          .insert(schema.customers)
          .values({ name: nom, email })
          .returning()
      )[0]!;
    if (existant && !existant.name)
      await db
        .update(schema.customers)
        .set({ name: nom })
        .where(eq(schema.customers.id, existant.id));

    const numero = await prochainNumeroSalon();
    const evenement = stand.nom;

    // La vente se décide sous le VERROU de la commande — le même que prennent
    // les routes du panier pour écrire une ligne (configurator-routes.ts) :
    // statut revérifié, lignes relues, total compté, commande passée payée et
    // vente inscrite, d'un bloc. Sans lui, une affiche modifiée sur la
    // tablette au même instant restait hors du total, et deux appuis sur
    // « Valider » inscrivaient deux fois la vente au grand livre.
    const vente = await db.transaction(async (tx) => {
      const [verrouille] = await tx
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, panier.id))
        .for("no key update");
      if (!verrouille || verrouille.status !== "draft") return null;
      const lignes = await tx
        .select()
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, panier.id));
      if (!lignes.length) return { lignes, commande: null };

      const total = lignes.reduce(
        (s, l) => s + l.unitPriceCents * l.quantity,
        0,
      );
      const [commande] = await tx
        .update(schema.orders)
        .set({
          channel: "salon",
          standId: stand.id,
          // Une vente rouverte puis revalidée garde SON numéro : pas de trou.
          number: /^SAL-\d+$/.test(verrouille.number) ? verrouille.number : numero,
          // Payée d'emblée : au stand, le client règle avant de partir avec
          // son affiche, ou il ne commande pas. Un état « en attente »
          // obligeait à se souvenir de cocher chaque vente du samedi, et
          // laissait les chiffres du stand à zéro tant que personne ne l'avait
          // fait.
          status: "paid",
          customerId: client.id,
          totalCents: total,
          shippingCents: 0,
          // Le texte vient du dictionnaire des courriels : c'est à lui que
          // livraisonDansLaLangue le reconnaît pour le traduire dans le
          // courriel et la facture d'une cliente étrangère.
          shippingLabel: fr["livraison.remiseStand"],
          shippingName: nom,
          // L'événement va dans la note : c'est ce qu'on cherche des mois plus
          // tard pour savoir quel salon a bien marché.
          internalNote: evenement ? `Stand : ${evenement}` : null,
          tags: evenement ? [evenement] : [],
        })
        .where(eq(schema.orders.id, panier.id))
        .returning();

      // Le grand livre reçoit l'encaissement, comme pour une vente du site :
      // c'est lui qui fait foi pour le solde d'une commande, et un
      // remboursement de stand doit pouvoir s'y adosser.
      await tx.insert(schema.orderTransactions).values({
        orderId: panier.id,
        kind: "sale",
        status: "success",
        amountCents: total,
        gateway: "stand",
        externalRef: null,
      });

      await tx.insert(schema.orderEvents).values({
        orderId: panier.id,
        kind: "event",
        message:
          `Commande prise au stand${evenement ? ` (${evenement})` : ""}, réglée sur place.`,
      });
      return { lignes, commande: commande! };
    });
    if (!vente)
      return c.json({ error: "Cette commande est déjà enregistrée." }, 409);
    const { lignes: vendues, commande } = vente;
    if (!commande) return c.json({ error: "Aucune affiche choisie." }, 400);

    // Les affiches tirées d'une photo passent du panier à la commande, comme
    // au paiement d'une vente du site (markOrderPaid) : elles reçoivent leur
    // date de paiement, et c'est elle qui les sort de la purge des photos de
    // visiteurs. Sans ce rattachement, l'affiche vendue au stand perdait son
    // image pleine définition au ménage suivant — et avec elle son fichier
    // d'impression. Ne lève jamais : la vente est faite.
    await rattacherGenerationsAuPanier(panier.id, panier.clientOrderId, client.id);

    // Les fichiers d'impression, comme pour une vente du site : nommés tout
    // de suite — deux affiches identiques de la même vente deviennent
    // « martin_A4_pas-cadre.pdf » et « martin_A4_pas-cadre-2.pdf » — et
    // préparés derrière, pour être prêts quand la vendeuse viendra imprimer.
    // Sans cette étape, le nom était recalculé à chaque téléchargement, le
    // même pour les deux.
    try {
      await enregistrerFichiersDImpression(panier.id, { preparer: true });
    } catch (e) {
      // La vente est faite et encaissée : un nom de fichier manqué se
      // rattrape au premier téléchargement.
      console.error(`[stand] fichiers d'impression non enregistrés (${numero}) :`, e);
    }

    return c.json({
      number: commande.number,
      // Le prix ne remonte PAS à la tablette : rien à l'écran ne doit pouvoir
      // contredire ce que la vendeuse annonce de vive voix.
      client: { nom, email },
      articles: vendues.reduce((s, l) => s + l.quantity, 0),
    });
  });

  /* ---------------------------------------------------------------------- */
  /*  Les stands, vus du back-office                                        */
  /* ---------------------------------------------------------------------- */

  /**
   * Tous les stands, avec ce que chacun a rapporté.
   *
   * Le code y est visible : c'est la boutiquière qui le donne à sa vendeuse.
   * Il ne sort d'ici que sous la garde du back-office.
   */
  app.get("/admin/stands", async (c) => {
    const proprietaire = c.get("utilisateur")?.role === "owner";
    const stands = await db
      .select()
      .from(schema.stands)
      .orderBy(asc(schema.stands.ouvert), asc(schema.stands.nom));

    // Les ventes, comptées d'un coup : une requête par stand serait une
    // requête de trop dès la troisième année de salons.
    const ventes = await db
      .select({
        standId: schema.orders.standId,
        commandes: count(),
        cents: raw<number>`coalesce(sum(${schema.orders.totalCents}), 0)::int`,
      })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.channel, "salon"),
          ne(schema.orders.status, "draft"),
        ),
      )
      .groupBy(schema.orders.standId);
    const parStand = new Map(
      ventes.map((v) => [
        v.standId,
        { commandes: Number(v.commandes), cents: Number(v.cents) },
      ]),
    );

    // Les ventes d'avant les stands multiples, si la migration n'a rien eu à
    // rattacher : les taire ferait un trou dans les chiffres.
    const orphelines = parStand.get(null) ?? { commandes: 0, cents: 0 };

    return c.json({
      stands: stands
        .map((s) => ({
          id: s.id,
          // Le code n'est montré qu'à la propriétaire. Il permet d'enregistrer
          // des commandes déclarées payées : le distribuer à tout vendeur,
          // pour tous les stands, revient à le laisser traîner.
          code: proprietaire ? s.code : null,
          nom: s.nom,
          ouvert: s.ouvert,
          createdAt: s.createdAt,
          closedAt: s.closedAt,
          // Les archivés viennent AVEC, marqués : l'écran les range dans sa
          // section « Stands archivés » sans redemander la liste.
          archivedAt: s.archivedAt,
          ...(parStand.get(s.id) ?? { commandes: 0, cents: 0 }),
        }))
        // Les stands ouverts d'abord : ce sont eux qu'on regarde.
        .sort((a, b) => Number(b.ouvert) - Number(a.ouvert)),
      orphelines,
    });
  });

  /** Ouvre un nouveau stand. Le code est tiré ici, jamais choisi. */
  app.post("/admin/stands", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const nom = String(b.nom ?? "").trim().slice(0, 120);
    if (!nom)
      return c.json(
        { error: "Donnez un nom au stand, par exemple « Salon du livre de Nantes 2026 »." },
        400,
      );
    // Un code déjà pris ferait pointer deux stands vers la même tablette. La
    // boucle est courte : un million de codes possibles, quelques stands.
    for (let essai = 0; essai < 12; essai++) {
      const code = nouveauCode();
      if (await standDuCode(code)) continue;
      const [stand] = await db
        .insert(schema.stands)
        .values({ code, nom, ouvert: b.ouvert === true })
        .returning();
      return c.json({ ok: true, stand });
    }
    return c.json(
      { error: "Impossible de tirer un code libre. Réessayez." },
      500,
    );
  });

  /** Renomme un stand, l'ouvre, le ferme, ou lui donne un nouveau code. */
  app.post("/admin/stands/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: "stand inconnu" }, 400);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const [stand] = await db
      .select()
      .from(schema.stands)
      .where(eq(schema.stands.id, id));
    if (!stand)
      return c.json({ error: "Ce stand n'existe plus. Rechargez la page." }, 404);

    const champs: Record<string, unknown> = {};
    if ("nom" in b) {
      const nom = String(b.nom ?? "").trim().slice(0, 120);
      if (!nom) return c.json({ error: "Le nom du stand ne peut pas être vide." }, 400);
      champs.nom = nom;
    }
    if ("ouvert" in b) {
      if (typeof b.ouvert !== "boolean")
        return c.json({ error: "Dites si le stand est ouvert ou fermé." }, 400);
      // Un stand archivé ne se rouvre pas d'ici : il est rangé, et sa tablette
      // ne doit rien accepter tant qu'il l'est. Le restaurer d'abord force à
      // le remettre dans la liste ordinaire avant d'y vendre quoi que ce soit.
      if (b.ouvert && stand.archivedAt)
        return c.json(
          {
            error:
              "Ce stand est archivé : restaurez-le avant de l'ouvrir, sinon sa tablette accepterait des commandes sur un stand rangé.",
          },
          400,
        );
      champs.ouvert = b.ouvert;
      // La date de fermeture ne se remet pas à zéro à la réouverture : on veut
      // savoir quand le stand a fermé la dernière fois.
      if (!b.ouvert) champs.closedAt = new Date();
    }
    if (b.nouveauCode === true) {
      // Changer le code coupe l'ancienne adresse : à faire APRÈS le stand, ou
      // quand le code a circulé plus loin qu'il n'aurait dû.
      for (let essai = 0; essai < 12; essai++) {
        const code = nouveauCode();
        if (await standDuCode(code)) continue;
        champs.code = code;
        break;
      }
      if (!champs.code)
        return c.json({ error: "Impossible de tirer un code libre. Réessayez." }, 500);
    }
    if (!Object.keys(champs).length) return c.json({ ok: true, stand });

    const [suivant] = await db
      .update(schema.stands)
      .set(champs)
      .where(eq(schema.stands.id, id))
      .returning();
    return c.json({ ok: true, stand: suivant });
  });

  /**
   * Archive un stand, ou le restaure.
   *
   * La suppression définitive a été RETIRÉE. Elle n'était permise que sur un
   * stand sans la moindre vente, et pour cause : `order.stand_id` se vide en
   * silence quand le stand s'en va (« set null »), et les ventes du salon
   * perdaient alors la seule chose qui disait où elles avaient été faites.
   * Un stand bien rempli, lui, n'avait donc AUCUN moyen de quitter la liste.
   *
   * Archivé, il la quitte sans rien emporter : ses ventes gardent son nom,
   * son code reste réservé — aucun nouveau stand ne peut le reprendre et
   * hériter de ses ventes — et « Restaurer » le remet tel quel.
   *
   * L'archivage FERME le stand : un stand rangé dont la tablette accepterait
   * encore des commandes serait un piège, et ces commandes-là arriveraient
   * sur un nom que plus personne ne regarde.
   */
  app.post("/admin/stands/:id/archive", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: "stand inconnu" }, 400);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    // Défaut : on archive. Seul un « archived: false » explicite restaure.
    const archiver = b.archived !== false;

    // Combien de ventes s'y rattachent : l'écran le redit ensuite, pour que la
    // propriétaire sache ce qu'elle range — rien n'est perdu, mais un salon de
    // deux cents commandes ne se met pas de côté par mégarde.
    const [vendu] = await db
      .select({ n: count() })
      .from(schema.orders)
      .where(eq(schema.orders.standId, id));

    const [ligne] = await db
      .update(schema.stands)
      .set({
        archivedAt: archiver ? new Date() : null,
        // Fermé en même temps qu'archivé. La restauration ne rouvre PAS : on
        // rouvre un stand exprès, le jour du salon, pas par un clic qui
        // voulait seulement le ressortir du rangement.
        ...(archiver ? { ouvert: false, closedAt: new Date() } : {}),
      })
      .where(eq(schema.stands.id, id))
      .returning({ archivedAt: schema.stands.archivedAt });
    if (!ligne)
      return c.json({ error: "Ce stand n'existe plus. Rechargez la page." }, 404);

    return c.json({
      ok: true,
      archived: ligne.archivedAt != null,
      commandes: Number(vendu?.n ?? 0),
    });
  });
}
