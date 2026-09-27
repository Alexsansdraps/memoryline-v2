/**
 * Le BORDEREAU transporteur : l'étiquette A6 qui se colle SUR le colis.
 *
 * À ne pas confondre avec le BON DE LIVRAISON, le récapitulatif A4 qui voyage
 * DANS le colis. Deux documents, deux formats, deux usages.
 *
 * Ce que ce fichier apporte aujourd'hui, c'est le CONTENANT, pas l'achat.
 * Alexandra continue d'acheter son étiquette chez le transporteur ; elle la
 * dépose ici, et à partir de là le PDF reste collé à la commande pour
 * toujours : elle le réimprime sans rouvrir leur site, et le numéro de suivi
 * est déjà rempli au moment d'enregistrer l'expédition — donc la cliente reçoit
 * enfin un vrai lien de suivi au lieu d'un numéro tout nu.
 *
 * Ce dépôt garde sa valeur même le jour où l'achat direct existera : panne de
 * l'API du transporteur, étiquette achetée au guichet, transporteur non
 * couvert. On ne retire jamais la porte qui marche sans réseau.
 *
 * TROIS CHOSES QUE CE MODULE NE FAIT PAS, et c'est délibéré :
 *
 *  - il n'expédie rien. Déposer une étiquette et faire partir un colis sont
 *    deux gestes, et un seul des deux prévient la cliente ;
 *  - il n'envoie AUCUN courrier, pour la même raison ;
 *  - il ne supprime rien. « Retirer » pose une date, et le PDF reste sur le
 *    disque : c'est la preuve d'une dépense, elle ne s'efface pas.
 */
import type { Hono } from "hono";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { extname } from "node:path";
import { db, schema } from "./db/client.js";
import { COMMANDE_ANNULEE, lienDeSuivi } from "./commandes.js";
import { TRANSPORTEURS } from "./livraison-regles.js";
import { DOSSIER_BORDEREAUX, lire, ranger } from "./stockage-prive.js";

/**
 * Cinq mégaoctets : une étiquette A6 en fait quelques dizaines de kilo-octets,
 * et le multipart est analysé EN MÉMOIRE par `c.req.formData()`. Au-delà, ce
 * n'est plus une étiquette — c'est un scan de mauvaise résolution ou un
 * fichier déposé par erreur.
 */
const BORDEREAU_MAX_OCTETS = 5 * 1024 * 1024;

/** Les cinq premiers octets de tout PDF, quelle que soit sa version. */
const ENTETE_PDF = "%PDF-";

/**
 * Le nom de fichier, reconstruit de zéro — jamais celui du poste d'Alexandra.
 *
 * C'est le patron de POST /admin/uploads : un nom qui vient du client est un
 * chemin déguisé. Ici il ne sert en plus qu'à retrouver le fichier à l'œil
 * dans le dossier, le vrai lien étant la colonne `fichier` de la ligne.
 */
function assainir(suivi: string): string {
  return (
    suivi
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "suivi"
  );
}

/**
 * Le bordereau vivant d'une commande, s'il y en a un.
 *
 * « Vivant » = ni retiré, ni annulé chez le transporteur — exactement les deux
 * conditions de l'index unique partiel `bordereau_actif_uniq`. Les deux
 * doivent dire la même chose : c'est l'index qui tranche en cas de course,
 * cette lecture-ci ne sert qu'à répondre une phrase lisible au lieu d'une
 * erreur de base.
 */
async function bordereauActif(
  orderId: number,
): Promise<typeof schema.bordereaux.$inferSelect | undefined> {
  const [actif] = await db
    .select()
    .from(schema.bordereaux)
    .where(
      and(
        eq(schema.bordereaux.orderId, orderId),
        isNull(schema.bordereaux.retireAt),
        ne(schema.bordereaux.statut, "annule"),
      ),
    );
  return actif;
}

export function mountBordereaux(app: Hono): void {
  /**
   * Dépose le PDF d'une étiquette achetée ailleurs.
   *
   * Multipart, sur le patron de POST /admin/uploads : le fichier arrive avec
   * le reste du formulaire, en un seul envoi. Les contrôles vont du plus
   * général au plus précis — la commande, puis le colis, puis le fichier —,
   * pour que le refus nomme toujours la vraie raison et pas la deuxième.
   *
   * N'expédie RIEN et ne prévient personne : c'est le bouton « Enregistrer
   * l'expédition » qui fait partir le colis, et lui seul écrit à la cliente.
   */
  app.post("/admin/orders/:id/bordereau", async (c) => {
    const orderId = Number(c.req.param("id"));
    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId));
    if (!order) return c.notFound();
    // La même garde et la même phrase que l'expédition : une commande annulée
    // ne fait plus rien partir, et une étiquette déposée dessus ne servirait
    // qu'à laisser croire le contraire.
    if (order.status === "cancelled" || order.status === "voided")
      return c.json({ error: COMMANDE_ANNULEE }, 400);
    // Une vente au stand part dans les mains de la cliente : il n'y a ni
    // colis, ni transporteur, ni étiquette à coller dessus.
    if (order.channel === "salon")
      return c.json(
        {
          error:
            "Cette vente a été faite au stand : l'affiche est remise en main propre, il n'y a pas de colis à étiqueter.",
        },
        400,
      );
    if (await bordereauActif(orderId))
      return c.json(
        {
          error:
            "Un bordereau est déjà joint à cette commande : retirez d'abord celui qui est joint.",
        },
        409,
      );

    const form = await c.req.formData();
    const fichier = form.get("fichier");
    if (!(fichier instanceof File) || !fichier.size)
      return c.json(
        { error: "Aucun fichier reçu : choisissez le PDF de l'étiquette." },
        400,
      );
    /*
     * L'EXTENSION, PUIS LES OCTETS — les deux, et pas l'un ou l'autre.
     *
     * L'extension seule laisse passer un .png renommé, qui s'enverrait à
     * l'imprimante en s'affichant comme une page blanche le jour du dépôt en
     * bureau de poste. Les octets seuls laisseraient passer un PDF nommé
     * « etiquette.exe ». Le poids vient après : un .png de 30 Mo doit être
     * refusé parce que ce n'est pas un PDF, pas parce qu'il est lourd.
     */
    if (extname(fichier.name).toLowerCase() !== ".pdf")
      return c.json(
        { error: "Le bordereau doit être un fichier PDF (.pdf)." },
        415,
      );
    const debut = Buffer.from(await fichier.slice(0, 5).arrayBuffer());
    if (debut.toString("latin1") !== ENTETE_PDF)
      return c.json(
        {
          error:
            "Ce fichier porte bien « .pdf », mais son contenu n'en est pas un. Retéléchargez l'étiquette depuis le site du transporteur.",
        },
        415,
      );
    if (fichier.size > BORDEREAU_MAX_OCTETS)
      return c.json(
        {
          error: `Fichier trop lourd (${Math.round(fichier.size / 1048576)} Mo) : une étiquette pèse quelques dizaines de kilo-octets, le maximum est de ${BORDEREAU_MAX_OCTETS / 1048576} Mo.`,
        },
        413,
      );

    const code = String(form.get("transporteur") ?? "").trim();
    // Le code machine, et lui seul : le libellé se déduit, l'inverse non.
    const transporteur = TRANSPORTEURS.find((t) => t.code === code);
    if (!transporteur)
      return c.json(
        {
          error: code
            ? `Transporteur inconnu : « ${code} ».`
            : "Choisissez le transporteur qui porte ce colis.",
        },
        400,
      );
    const trackingNumber = String(form.get("trackingNumber") ?? "").trim();
    if (!trackingNumber)
      return c.json(
        {
          error:
            "Le numéro de suivi est obligatoire : c'est lui que la cliente recevra.",
        },
        400,
      );
    /*
     * Le lien collé l'emporte sur celui qu'on sait fabriquer.
     *
     * `lienDeSuivi` ne connaît que cinq transporteurs ; pour GLS, DPD, Relais
     * Colis, Colis Privé et Shop2Shop, le lien donné par le transporteur est
     * la SEULE façon d'en avoir un. Il est figé ici, au dépôt, parce que
     * c'est le moment où on l'a sous les yeux.
     */
    const trackingUrl =
      String(form.get("trackingUrl") ?? "").trim() ||
      lienDeSuivi(code, trackingNumber);
    /*
     * Le poids DÉCLARÉ, pas un poids inventé.
     *
     * Ce qui est saisi gagne ; sinon on reprend celui figé sur la commande,
     * même s'il vaut zéro. Poser ici la valeur par défaut des réglages
     * écrirait un chiffre que personne n'a déclaré, et l'écran ne pourrait
     * plus avertir qu'il manque.
     */
    const poidsSaisi = Math.max(
      0,
      Math.floor(Number(form.get("poidsGrammes")) || 0),
    );
    const contenu = Buffer.from(await fichier.arrayBuffer());
    // La garde de « /admin/* » a posé l'utilisateur : il y a toujours
    // quelqu'un derrière un dépôt, et c'est son adresse qu'on grave sur la
    // ligne — comme l'auteur d'un événement du journal.
    const auteur = c.get("utilisateur")?.email ?? "";

    /*
     * LE FICHIER ET LA LIGNE, OU NI L'UN NI L'AUTRE.
     *
     * Le nom du fichier porte l'identifiant de la ligne, qui n'existe qu'une
     * fois insérée : d'où l'ordre insertion → écriture → nom rangé sur la
     * ligne. Le tout en transaction parce qu'un disque plein doit faire
     * échouer le dépôt entier — une ligne qui promet une étiquette
     * introuvable serait pire que pas de ligne du tout, puisqu'elle bloquerait
     * en plus le dépôt suivant.
     *
     * Le seul reste possible est alors un PDF orphelin, que personne ne peut
     * ouvrir faute de ligne pour y mener. C'est le bon côté à choisir.
     */
    const pose = await db.transaction(async (tx) => {
      const [ligne] = await tx
        .insert(schema.bordereaux)
        .values({
          orderId,
          source: "depose",
          statut: "depose",
          transporteur: code,
          // Le libellé est FIGÉ ici : le transporteur d'un mode de livraison
          // se change à tout moment, et un vieux bordereau se relirait sinon
          // sous le nom d'un transporteur qui n'a jamais porté ce colis.
          transporteurNom: transporteur.nom,
          trackingNumber,
          trackingUrl,
          poidsGrammes: poidsSaisi || order.weightGrams,
          createdBy: auteur,
        })
        .returning();
      const nom = `${ligne!.id}-${assainir(trackingNumber)}.pdf`;
      await ranger(DOSSIER_BORDEREAUX, nom, contenu);
      const [avecFichier] = await tx
        .update(schema.bordereaux)
        .set({ fichier: nom, fichierOctets: contenu.length })
        .where(eq(schema.bordereaux.id, ligne!.id))
        .returning();
      await tx.insert(schema.orderEvents).values({
        orderId,
        kind: "event",
        author: auteur || null,
        message: `Bordereau ${transporteur.nom} joint, suivi ${trackingNumber}.`,
      });
      return avecFichier!;
    });

    // `fichier` est un NOM, jamais un chemin : aucune route ne sert ce
    // dossier, et le PDF ne s'obtient que par l'adresse authentifiée
    // ci-dessous. L'écran s'en sert pour savoir s'il y a quelque chose à
    // ouvrir.
    return c.json(pose);
  });

  /**
   * Les bordereaux d'une commande, le plus récent d'abord.
   *
   * Les retirés restent dans la liste : c'est ce qui permet de voir qu'une
   * étiquette a été jointe puis remplacée, et de retrouver la première.
   * L'écran, lui, ne met en avant que le vivant.
   */
  app.get("/admin/orders/:id/bordereaux", async (c) => {
    // Réservée à la propriétaire, vérifiée ICI : la garde générale laisse
    // passer les LECTURES d'un vendeur sous « /admin/orders », et un numéro de
    // suivi de commande du site n'a rien à faire sur la tablette d'un stand.
    // On répond « rien ici » plutôt que « interdit » : l'adresse ne doit même
    // pas confirmer qu'il y a quelque chose. Et SANS utilisateur posé, on
    // refuse aussi : derrière la garde de « /admin/* » le cas n'arrive pas,
    // mais ces routes se montent ailleurs (le script de vérification le fait
    // déjà), et le défaut d'un contrôle doit être le refus.
    const user = c.get("utilisateur");
    if (!user || user.role !== "owner") return c.notFound();
    const orderId = Number(c.req.param("id"));
    const lignes = await db
      .select()
      .from(schema.bordereaux)
      .where(eq(schema.bordereaux.orderId, orderId))
      .orderBy(desc(schema.bordereaux.createdAt), desc(schema.bordereaux.id));
    return c.json(lignes);
  });

  /**
   * Le PDF du bordereau, pour l'ouvrir et l'imprimer.
   *
   * Réimprimable autant de fois qu'on veut : contrairement à la facture, dont
   * la première ouverture CONSOMME un numéro, recharger cet onglet ne coûte
   * rien et n'attribue rien.
   */
  app.get("/admin/bordereaux/:id/fichier.pdf", async (c) => {
    // Le même contrôle réécrit dans la route que pour la facture, et pour la
    // même raison : un vendeur a le droit de lire « /admin/orders » et de
    // télécharger les fichiers d'impression de ses ventes de stand, or cette
    // page-ci porte l'adresse postale d'une cliente du site. `notFound()` et
    // non 403 : une adresse tapée à la main n'a pas à apprendre qu'elle existe.
    const user = c.get("utilisateur");
    if (!user || user.role !== "owner") return c.notFound();
    const id = Number(c.req.param("id"));
    const [ligne] = await db
      .select({
        fichier: schema.bordereaux.fichier,
        numero: schema.orders.number,
      })
      .from(schema.bordereaux)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.bordereaux.orderId))
      .where(eq(schema.bordereaux.id, id));
    if (!ligne) return c.notFound();
    const contenu = ligne.fichier
      ? await lire(DOSSIER_BORDEREAUX, ligne.fichier)
      : null;
    // Une ligne survit toujours à son fichier, jamais l'inverse : le dire en
    // toutes lettres vaut mieux qu'un onglet blanc.
    if (!contenu)
      return c.json(
        {
          error:
            "Le fichier de ce bordereau est introuvable sur le serveur. Retéléchargez l'étiquette chez le transporteur et déposez-la à nouveau.",
        },
        404,
      );
    // « inline » comme la facture : le PDF s'ouvre dans l'onglet, d'où il
    // s'imprime — c'est le seul geste qu'on en fait.
    return new Response(new Uint8Array(contenu), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="bordereau-${assainir(ligne.numero)}.pdf"`,
      },
    });
  });

  /**
   * Retire le bordereau joint — pour en déposer un autre.
   *
   * RIEN NE SE SUPPRIME : la ligne reste, le fichier reste sur le disque, et
   * seule une date est posée. Une étiquette a coûté de l'argent ; sa trace ne
   * dépend pas d'un clic de plus.
   */
  app.post("/admin/bordereaux/:id/retirer", async (c) => {
    const id = Number(c.req.param("id"));
    const [ligne] = await db
      .select()
      .from(schema.bordereaux)
      .where(eq(schema.bordereaux.id, id));
    if (!ligne) return c.notFound();
    // Déjà retiré : on rend la ligne telle quelle. Un double-clic ne doit ni
    // échouer ni réécrire la date — c'est le PREMIER retrait qui a eu lieu.
    if (ligne.retireAt) return c.json(ligne);

    if (ligne.fulfillmentId) {
      const [expedition] = await db
        .select()
        .from(schema.fulfillments)
        .where(eq(schema.fulfillments.id, ligne.fulfillmentId));
      // Une expédition vivante porte le suivi de CE bordereau : le retirer
      // laisserait la cliente avec un lien de suivi dont plus rien n'explique
      // l'origine. Les deux gestes existent, dans cet ordre-là.
      if (expedition && !expedition.cancelledAt)
        return c.json(
          {
            error:
              "Ce bordereau est celui d'une expédition enregistrée : annulez d'abord l'expédition.",
          },
          409,
        );
    }

    const auteur = c.get("utilisateur")?.email ?? null;
    const [retire] = await db
      .update(schema.bordereaux)
      .set({ retireAt: new Date() })
      .where(eq(schema.bordereaux.id, id))
      .returning();
    await db.insert(schema.orderEvents).values({
      orderId: ligne.orderId,
      kind: "event",
      author: auteur,
      message: `Bordereau ${ligne.transporteurNom} retiré (suivi ${ligne.trackingNumber}). Le fichier est conservé.`,
    });
    return c.json(retire!);
  });
}
