/**
 * Des personnages et un muret sur l'affiche « à partir de votre photo »
 * (20/11, Alexandra : « faut pouvoir ajouter personnages et murets si les
 * gens veulent pour les images à partir de leurs photos ! »). Sur le site et
 * sur la tablette du stand.
 *
 * Le navigateur compose : le module de personnalisation pose les personnages
 * sur l'aperçu, AfficheIA garde les textes et envoie la ligne au panier. Le
 * serveur ne prend pas cette ligne sur parole : c'est elle qui part à
 * l'atelier (renderPosterPng, pdf.ts), et le moteur va LIRE les adresses
 * qu'elle porte — un décor d'avant-plan désigné par la page ferait lire au
 * serveur le fichier qu'elle veut, jusqu'à la pleine définition sans
 * filigrane d'une autre affiche. Ce module dit ce qui passe.
 *
 * Il ne regarde QUE les lignes IA qui portent au moins un personnage. Une
 * affiche IA sans personnage, et toute affiche du catalogue, passent comme
 * avant, sans une lecture de plus : la tablette du stand vend ces affiches,
 * leur parcours ne doit pas bouger d'un octet.
 *
 * Trois refus, chacun traduit en phrase par le site (AfficheIA) :
 *  - « ia_indisponible » : la génération n'existe pas, n'est pas prête, ses
 *    images ont été purgées — ou la base n'a pas pu être lue ;
 *  - « ia_autre_affiche » : la génération a été faite pour une autre affiche ;
 *  - « ia_personnages_paysage » : des personnages sur une affiche en paysage,
 *    que ni l'aperçu ni le PDF ne savent placer — la taille et la hauteur des
 *    personnages y sont calculées pour une feuille en hauteur (pdf.ts).
 *
 * Le reste se corrige sans refuser : un décor que la boutique n'a pas réglé
 * est retiré, le fond et le cadre aussi.
 *
 * Pas dans @memoryline/types : ce paquet entre dans l'empreinte des fichiers
 * d'impression (LANCEMENT, fichiers-impression.ts), et y toucher ferait
 * refaire toutes les impressions en cours.
 */
import { and, eq, inArray } from "drizzle-orm";
import { POSTER_VIEW_DEFAUT, type PosterConfig } from "@memoryline/types";
import { db, schema } from "./db/client.js";

/** Les refus, tels que le site les reçoit : 400 { error: <code> }. */
export type CodeRefusIA = "ia_indisponible" | "ia_autre_affiche" | "ia_personnages_paysage";

/**
 * Là où le contrôle lit : la base. Un paramètre plutôt qu'un import figé,
 * comme `ex = db` ailleurs : les tests y branchent une base factice, ou une
 * base qui ne répond pas.
 */
export type Lecteur = Pick<typeof db, "select">;

export type VerdictLigneIA =
  | {
      ok: true;
      config: PosterConfig;
      /** Ce qui mérite une ligne au journal, sans rien refuser. */
      remarques?: string[];
    }
  | { ok: false; code: CodeRefusIA };

/**
 * Le muret de toujours. Il reste permis quoi que dise la base : c'est celui
 * que le moteur pose de lui-même sur une affiche de dos qui n'en nomme aucun
 * (pdf.ts), et celui que le site prend quand le type « de dos » n'en a plus.
 */
export const MURET_OFFICIEL = "/assets/muret_officiel.svg";

/**
 * La taille de TOUTE génération demandée en paysage : TAILLE_PAYSAGE, dans
 * ia.ts (un test vérifie que c'est la même). Le menu « Taille de l'image » du
 * back-office ne la propose pas pour les affiches en portrait.
 *
 * Les tailles que ce menu propose — « 1536 × 1024 — paysage » comprise —
 * servent aux affiches demandées EN PORTRAIT : la ligne part sans
 * orientation, la feuille reste en hauteur, l'image y est recadrée au fichier
 * d'impression comme dans le module, et les personnages s'y placent comme sur
 * toute affiche en portrait. Elles ne sont donc pas refusées : le site, qui
 * ne connaît que le sens demandé, propose bien les personnages sur ces
 * affiches-là.
 */
export const TAILLE_GENERATION_PAYSAGE = "2240x1584";

/**
 * Toutes les tailles d'une génération demandée en paysage : 2240 × 1584, et
 * depuis le 26/11 3424 × 2416 (TAILLE_PAYSAGE_MAX, ia.ts), quand la taille
 * maximale est réglée — « faut que les affiches IA aient la même taille que
 * les autres affiches » (Alexandra). « 1536 × 1024 » n'en est toujours pas :
 * c'est une taille du menu, pour une affiche demandée EN PORTRAIT. (Depuis
 * la relecture du 26/11, c'est aussi celle d'une demande en paysage avec
 * gpt-image-1.5 ou 1-mini, qui ne font pas 2240 × 1584 : la génération ne
 * se dit alors pas couchée, et c'est l'orientation de la ligne qui refuse
 * les personnages.)
 */
export const TAILLES_GENERATION_PAYSAGE: ReadonlySet<string> = new Set([
  TAILLE_GENERATION_PAYSAGE,
  "3424x2416",
]);

/**
 * Une valeur venue du navigateur, rendue sûre pour une ligne de journal : un
 * retour à la ligne y écrirait une fausse ligne, une adresse de dix mille
 * caractères noierait les autres.
 */
function pourLeJournal(valeur: string, max = 80): string {
  return valeur.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, max);
}

/** Ce que le contrôle lit d'une génération (table ai_generation). */
export interface GenerationLue {
  publicId: string;
  productId: number | null;
  cartId: string | null;
  status: string;
  previewPath: string | null;
  fullPath: string | null;
  size: string | null;
  paidAt: Date | null;
}

/** Tout ce que la règle doit savoir, lu en base par controlerLigneIA. */
export interface ContexteLigneIA {
  /** Le panier qui reçoit la ligne. */
  cartId: string;
  /**
   * Le produit de la ligne : celui de la requête à l'ajout, celui de la ligne
   * enregistrée à la modification. Jamais celui de la configuration.
   */
  productId: number | null;
  /** La génération que la ligne annonce (aiPublicId) ; null si introuvable. */
  generation: GenerationLue | null;
  /**
   * Le statut du panier d'où vient la génération quand ce n'est pas celui-ci
   * (null : panier jamais né, ou sans objet). Pour le journal seulement.
   */
  statutPanierOrigine: string | null;
  /** Les décors d'avant-plan réglés par la boutique, et le muret officiel. */
  decorsAutorises: ReadonlySet<string>;
  /** Les types d'affiche qui existent (slugs de poster_view). */
  vues: ReadonlySet<string>;
}

/**
 * Une ligne IA qui porte au moins un personnage : la seule que ce module
 * contrôle. Un `aiPublicId` vide ne fait pas une affiche IA — ni pour le
 * fichier d'impression (configAImprimer), ni pour le panier du site.
 */
export function ligneIAAvecPersonnages(config: unknown): boolean {
  const c = config as { aiPublicId?: unknown; characters?: unknown } | null;
  return (
    typeof c?.aiPublicId === "string" &&
    c.aiPublicId !== "" &&
    Array.isArray(c.characters) &&
    c.characters.length > 0
  );
}

/**
 * La ligne telle qu'elle peut entrer au panier, ou la raison du refus.
 * Fonction pure : tout ce qu'elle lit est dans `ctx`.
 *
 * Une ligne qui n'est pas « IA avec personnages » revient TELLE QUELLE (le
 * même objet) : ce contrôle n'existe pas pour elle.
 */
export function ligneIAControlee(config: PosterConfig, ctx: ContexteLigneIA): VerdictLigneIA {
  if (!ligneIAAvecPersonnages(config)) return { ok: true, config };
  const gen = ctx.generation;

  // 1. Une génération prête, dont les deux images sont encore là. Aperçu et
  //    pleine définition s'écrivent ensemble (/ia/generer) et se purgent
  //    ensemble (30 jours) : sans pleine définition, le PDF refuserait de se
  //    faire (configAImprimer) ; sans aperçu, les personnages seraient posés
  //    sur du vide, au panier comme dans les courriels. Les versions d'un
  //    fond de la boutique (Créer un fond) n'ont pas d'aperçu : elles ne
  //    passent pas non plus pour l'affiche d'un client.
  if (!gen || gen.status !== "prete" || !gen.previewPath || !gen.fullPath)
    return { ok: false, code: "ia_indisponible" };

  // 2. Faite pour CETTE affiche : la consigne de style vient du produit, et le
  //    prix de la ligne aussi. Une génération dont le produit a été effacé
  //    (product_id remis à nul) n'en dit plus rien : on ne refuse pas sur ce
  //    qu'on ne sait pas.
  if (gen.productId != null && gen.productId !== ctx.productId)
    return { ok: false, code: "ia_autre_affiche" };

  // 6. En hauteur seulement (Q6, 20/11). Le sens se lit sur la ligne, et sur
  //    la génération : une génération demandée en paysage n'a pas sa place
  //    sur une feuille en hauteur, quoi que la ligne en dise.
  if (config.orientation === "paysage" || TAILLES_GENERATION_PAYSAGE.has(gen.size ?? ""))
    return { ok: false, code: "ia_personnages_paysage" };

  const remarques: string[] = [];

  // 3. Une génération d'un AUTRE panier : JOURNAL SEULEMENT (20/11). C'est le
  //    cas légitime du nouvel essai « panier_clos » (ajouterAuPanier,
  //    api-navigateur.ts) : le panier d'origine a été payé ou clos pendant
  //    que la page restait ouverte, et la ligne repart dans un panier neuf.
  //    Le refus attendra d'avoir vu ce que le journal en dit.
  if (gen.cartId !== ctx.cartId)
    remarques.push(
      `génération d'un autre panier (` +
        (gen.cartId
          ? `${pourLeJournal(gen.cartId)}, ${ctx.statutPanierOrigine ?? "jamais né"}`
          : "sans panier") +
        `, ${gen.paidAt ? "déjà vendue" : "jamais vendue"}) : acceptée, journal seulement`,
    );

  // 4. Le fond d'une affiche IA est SA génération : l'impression la relit par
  //    aiPublicId (configAImprimer), la vignette des courriels aussi
  //    (apercus.ts). Un fond, un identifiant de fond ou un cadre venus de la
  //    page ne servent donc à rien — sauf le cadre, à faire payer un cadre
  //    que l'affiche IA ne propose pas, et le fond, à faire lire au serveur
  //    une adresse choisie par la page. AfficheIA n'en envoie aucun : rien de
  //    légitime ne se perd ici.
  const {
    backgroundUrl,
    backgroundId,
    frameId,
    foregroundUrl,
    productId: _produitAnnonce,
    aiApercuUrl: _apercuAnnonce,
    ...reste
  } = config;
  const retires = [
    backgroundUrl !== undefined ? "fond" : null,
    backgroundId !== undefined ? "identifiant de fond" : null,
    frameId != null && frameId !== "" ? "cadre" : null,
  ].filter(Boolean);
  if (retires.length) remarques.push(`retiré(s) : ${retires.join(", ")}`);

  // 6 (suite). Le type d'affiche : celui de la ligne s'il existe, sinon le
  //    type par défaut, comme une ligne qui n'en dit rien.
  const vue = ctx.vues.has(config.view) ? config.view : POSTER_VIEW_DEFAUT;

  //    Le décor : seulement sur l'affiche de dos (« Assis sur le muret », Q3),
  //    et seulement l'un de ceux que la boutique a réglés (Q2). Sinon il est
  //    retiré sans refus : de dos, le moteur repose alors le muret officiel
  //    (pdf.ts) ; de face (« Debout, de face »), il n'y a pas de muret.
  const decor =
    foregroundUrl !== undefined && vue === "back" && ctx.decorsAutorises.has(foregroundUrl)
      ? foregroundUrl
      : undefined;
  if (foregroundUrl !== undefined && decor === undefined)
    remarques.push(
      vue === "back"
        ? `décor non autorisé retiré (${pourLeJournal(foregroundUrl, 120)})`
        : `décor retiré : aucun sur une affiche « ${pourLeJournal(vue)} »`,
    );

  // 7. Les textes ne sont pas touchés : leurs x/y sont la place que le client
  //    leur a donnée, et le PDF les pose au même endroit.
  const propre: PosterConfig = {
    ...reste,
    // 4 (suite). Le produit de la LIGNE, pas celui que la configuration
    //    annonce ; l'aperçu, celui de la génération, à l'adresse que l'API
    //    lui donne (/ia/generer) — c'est celle que le panier affiche.
    ...(ctx.productId != null && Number.isFinite(ctx.productId)
      ? { productId: ctx.productId }
      : {}),
    view: vue,
    ...(decor !== undefined ? { foregroundUrl: decor } : {}),
    aiApercuUrl: `/ia/apercu/${gen.publicId}`,
  };
  return remarques.length ? { ok: true, config: propre, remarques } : { ok: true, config: propre };
}

/**
 * Lit en base ce que la règle demande, puis l'applique (ligneIAControlee).
 *
 * Ne lève JAMAIS : une base qui ne répond pas refuse la seule ligne avec
 * personnages (« ia_indisponible ») et le dit au journal. Les autres lignes,
 * elles, n'arrivent même pas ici.
 */
export async function controlerLigneIA(
  cartId: string,
  productId: number | null,
  config: PosterConfig,
  lecteur: Lecteur = db,
): Promise<VerdictLigneIA> {
  if (!ligneIAAvecPersonnages(config)) return { ok: true, config };
  const publicId = config.aiPublicId!;
  try {
    // Colonnes nommées une à une, comme ia-reutiliser.ts : la table reçoit
    // des colonnes en ce moment, un select() complet échouerait sur une base
    // qui n'a pas encore reçu sa migration.
    const [gen] = await lecteur
      .select({
        publicId: schema.aiGenerations.publicId,
        productId: schema.aiGenerations.productId,
        cartId: schema.aiGenerations.cartId,
        status: schema.aiGenerations.status,
        previewPath: schema.aiGenerations.previewPath,
        fullPath: schema.aiGenerations.fullPath,
        size: schema.aiGenerations.size,
        paidAt: schema.aiGenerations.paidAt,
      })
      .from(schema.aiGenerations)
      .where(eq(schema.aiGenerations.publicId, publicId));

    const idProduit = productId != null && Number.isFinite(productId) ? productId : null;
    const [vues, produit, origine] = await Promise.all([
      lecteur
        .select({ slug: schema.posterViews.slug, foregroundUrl: schema.posterViews.foregroundUrl })
        .from(schema.posterViews),
      idProduit !== null
        ? lecteur
            .select({ foregroundUrl: schema.products.foregroundUrl })
            .from(schema.products)
            .where(eq(schema.products.id, idProduit))
        : Promise.resolve([] as { foregroundUrl: string | null }[]),
      gen?.cartId && gen.cartId !== cartId
        ? lecteur
            .select({ status: schema.orders.status })
            .from(schema.orders)
            .where(eq(schema.orders.clientOrderId, gen.cartId))
        : Promise.resolve([] as { status: string }[]),
    ]);

    // Les décors permis : ceux des types d'affiche (le muret du type « de
    // dos », Q2), celui du produit, et le muret officiel. Des valeurs réglées
    // par la boutique, comparées telles quelles : le site recopie celle que
    // GET /views lui donne.
    const decorsAutorises = new Set<string>([MURET_OFFICIEL]);
    for (const v of vues) if (v.foregroundUrl) decorsAutorises.add(v.foregroundUrl);
    if (produit[0]?.foregroundUrl) decorsAutorises.add(produit[0].foregroundUrl);

    const verdict = ligneIAControlee(config, {
      cartId,
      productId,
      generation: gen ?? null,
      statutPanierOrigine: origine[0]?.status ?? null,
      decorsAutorises,
      vues: new Set(vues.map((v) => v.slug)),
    });
    if (verdict.ok && verdict.remarques?.length)
      console.warn(
        `[ia-composition] ligne avec personnages ${pourLeJournal(publicId)} ` +
          `(panier ${pourLeJournal(cartId)}) : ${verdict.remarques.join(" ; ")}`,
      );
    return verdict;
  } catch (e) {
    console.error(
      `[ia-composition] lecture impossible, ligne avec personnages refusée ` +
        `(${pourLeJournal(publicId)}, panier ${pourLeJournal(cartId)}) :`,
      e,
    );
    return { ok: false, code: "ia_indisponible" };
  }
}

/** Les statuts d'un panier qui accepte encore une modification (panierModifiable). */
const STATUTS_MODIFIABLES = ["draft", "pending"];

/**
 * Le même contrôle pour une ligne MODIFIÉE (PUT /cart/:cartId/items/:itemId),
 * avec le produit de la ligne ENREGISTRÉE — jamais celui que la requête
 * annonce.
 *
 * Lu AVANT la transaction de la route, sans verrou : sous le verrou, une
 * lecture par `db` prendrait une seconde connexion du pool (voir Executeur,
 * configurator-routes.ts), et une lecture qui échouerait ferait échouer la
 * transaction entière. Le produit d'une ligne ne change jamais (aucune route
 * ne le réécrit) : lu ici ou sous le verrou, c'est le même.
 *
 * null : pas de telle ligne dans un panier encore modifiable — la route
 * répond 404, comme sa transaction l'aurait fait. Une carte cadeau n'est pas
 * contrôlée : la transaction la refuse elle-même (409), sans rien écrire.
 */
export async function controlerLigneIAModifiee(
  cartId: string,
  itemId: number,
  config: PosterConfig,
  lecteur: Lecteur = db,
): Promise<VerdictLigneIA | null> {
  if (!ligneIAAvecPersonnages(config)) return { ok: true, config };
  if (!Number.isFinite(itemId)) return null;
  let ligne: { productId: number | null; giftCard: unknown } | undefined;
  try {
    [ligne] = await lecteur
      .select({ productId: schema.orderItems.productId, giftCard: schema.orderItems.giftCard })
      .from(schema.orderItems)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
      .where(
        and(
          eq(schema.orderItems.id, itemId),
          eq(schema.orders.clientOrderId, cartId),
          inArray(schema.orders.status, STATUTS_MODIFIABLES),
        ),
      );
  } catch (e) {
    console.error(
      `[ia-composition] lecture impossible, ligne ${itemId} avec personnages refusée ` +
        `(panier ${pourLeJournal(cartId)}) :`,
      e,
    );
    return { ok: false, code: "ia_indisponible" };
  }
  if (!ligne) return null;
  if (ligne.giftCard) return { ok: true, config };
  return controlerLigneIA(cartId, ligne.productId, config, lecteur);
}
