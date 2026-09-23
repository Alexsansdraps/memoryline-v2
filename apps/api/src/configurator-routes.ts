/**
 * Routes du configurateur, du panier, des commandes web et des PDF.
 *
 * - Lecture publique : /characters, /backgrounds (alimentent le configurateur).
 * - Panier : /cart (création/maj de lignes éditables — §18.3).
 * - Commandes web : POST /orders (canal 'web', §11), génère le PDF (§12/§15).
 * - PDF : /print-files/:orderItemId (téléchargement à tout moment — §12).
 * - CRUD personnages/assets (BO, protégé /admin/*) : §18.1 A/D/E.
 *
 * Le wiring d'auth /admin/* est posé dans index.ts ; ici on définit les
 * handlers, montés via `mountConfiguratorRoutes(app)`.
 */
import type { Context, Hono } from "hono";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  notInArray,
  sql,
} from "drizzle-orm";
import { db, schema } from "./db/client.js";
import { cheminApercu } from "./apercus.js";
import { cadresProposesA, cadresSurLeSite, requeteDuStand } from "./cadres.js";
import { poidsDesCollections } from "./collections.js";
import {
  fichierDImpression,
  preparerFichierDImpression,
} from "./fichiers-impression.js";
import {
  resumeCommandes,
  statutExpedition,
  statutFinancier,
} from "./commandes.js";
import { clientDeLaRequete } from "./comptes.js";
import {
  envoyer as envoyerMail,
  courrierConfirmation,
  courrierNouvelleCommande,
  estConfigure as mailConfigure,
} from "./mail.js";
import { noterLaRecuperation } from "./relance-panier.js";
import {
  calageNeutre,
  calagePropre,
  famillesDuDessin,
  famillesDuParametre,
  fraisDePort,
  groupesDuDessin,
  lignesRemplies,
  poidsPanier,
  normaliserCode,
  normaliserPays,
  posterConfigSchema,
  prixDuCadreCents,
  remisesPanier,
  seuilPortOffertCents,
  sousTotalCents,
  totalPanierCents,
  type CouleursImage,
  type GroupeCouleur,
  type PosterConfig,
  type TextesAffiche,
} from "@memoryline/types";
import { imageRecoloree } from "./couleurs-image-fichier.js";
import { rattacherGenerationsAuPanier } from "./ia.js";
import {
  createPaypalOrder,
  capturePaypalOrder,
  RefusPaypal,
  createStripeIntent,
  getStripeIntent,
  paypalConfigured,
  stripeConfigured,
  verifyStripeEvent,
} from "./payments.js";

// --- Helpers -----------------------------------------------------------------

/** Slugifie un nom client pour un nom de fichier sûr mais lisible (§15.3). */
function slugifyName(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "client"
  );
}

/**
 * Prochaine numérotation de commande par canal (WEB-xxxx / SAL-xxxx).
 * On prend le MAX du suffixe numérique parmi les numéros bien formés du canal
 * (ignore les DRAFT- et numéros legacy non conformes) — robuste aux historiques.
 * Retry intégré côté appelant non nécessaire : un index unique protège déjà.
 */
async function nextOrderNumber(channel: "web" | "salon"): Promise<string> {
  const prefix = channel === "web" ? "WEB-" : "SAL-";
  const rows = await db
    .select({ n: schema.orders.number })
    .from(schema.orders)
    .where(eq(schema.orders.channel, channel));
  let max = 0;
  for (const r of rows) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(r.n);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return prefix + String(max + 1).padStart(4, "0");
}

/**
 * Nom du cadre tel qu'il doit apparaître dans le nom du fichier : « bois »,
 * « creme », « noir »… et « pas-cadre » quand l'affiche part seule.
 *
 * Le préfixe « Cadre » est retiré : le fichier s'appelle déjà d'après une
 * affiche, le répéter n'apprend rien. Le nom suit le catalogue — renommer un
 * cadre au back-office renomme les fichiers suivants, sans toucher au code.
 */
function suffixeCadre(nomCadre: string | null | undefined): string {
  const brut = String(nomCadre ?? "").trim();
  if (!brut) return "pas-cadre";
  return slugifyName(brut.replace(/^cadre\s+/i, "")) || "pas-cadre";
}

/**
 * Enregistre les fichiers d'impression d'une commande (print_file), un par
 * ligne, et — sur demande — lance leur fabrication en arrière-plan
 * (fichiers-impression.ts).
 *
 * Une commande entière d'un coup, et plus ligne par ligne : le nom d'une
 * ligne dépend de ceux de ses voisines. Deux affiches identiques de la même
 * commande s'appelaient pareil — et au stand, où rien n'était enregistré, le
 * nom était recalculé à chaque téléchargement, sans aucune numérotation.
 *
 * EXPORTÉE pour le stand (salon.ts), qui encaisse sans passer par
 * markOrderPaid. Une ligne déjà nommée garde son nom : on peut rappeler la
 * fonction sans rien renommer.
 */
export async function enregistrerFichiersDImpression(
  orderId: number,
  { preparer }: { preparer: boolean },
): Promise<void> {
  const [order] = await db
    .select({ customerId: schema.orders.customerId })
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId));
  if (!order) return;
  let customerName = "client";
  if (order.customerId != null) {
    const [cust] = await db
      .select({ name: schema.customers.name })
      .from(schema.customers)
      .where(eq(schema.customers.id, order.customerId));
    if (cust?.name) customerName = cust.name;
  }

  // Dans l'ordre des lignes : la première affiche d'une série garde le nom
  // simple, la suivante prend « -2 », d'un téléchargement à l'autre.
  const lignes = await db
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, orderId))
    .orderBy(asc(schema.orderItems.id));
  const dejaPris = lignes.length
    ? await db
        .select({
          orderItemId: schema.printFiles.orderItemId,
          filename: schema.printFiles.filename,
        })
        .from(schema.printFiles)
        .where(
          inArray(
            schema.printFiles.orderItemId,
            lignes.map((l) => l.id),
          ),
        )
    : [];
  const noms = new Set(dejaPris.map((f) => f.filename));
  const nommees = new Set(dejaPris.map((f) => f.orderItemId));
  const cadres = await db
    .select({ id: schema.frames.id, name: schema.frames.name })
    .from(schema.frames);

  for (const it of lignes) {
    const cfg = it.config as PosterConfig | null;
    if (!cfg) continue;
    if (!nommees.has(it.id)) {
      const format = (cfg.format ?? "A4") as "A4" | "A3";
      // « dupont_A3_bois.pdf » : le nom se lit d'un coup d'œil au moment
      // d'imprimer, sans avoir à rouvrir la commande pour savoir quel papier
      // charger ni quel cadre sortir.
      const cadre = cfg.frameId
        ? cadres.find((f) => f.id === Number(cfg.frameId))
        : undefined;
      const base = `${slugifyName(customerName)}_${format}_${suffixeCadre(cadre?.name)}`;
      // Deux affiches identiques dans la même commande porteraient le même
      // nom : on numérote à partir de la deuxième, jamais la première.
      let filename = `${base}.pdf`;
      for (let i = 2; noms.has(filename); i++) filename = `${base}-${i}.pdf`;
      noms.add(filename);
      try {
        // La trace du fichier, sous son nom définitif ; le PDF, lui, se range
        // dans data/assets/cache/impressions (fichiers-impression.ts).
        await db.insert(schema.printFiles).values({
          orderItemId: it.id,
          url: `/print-files/${it.id}`,
          filename,
          format,
        });
      } catch (e) {
        console.error("Fichier d'impression non enregistré (item " + it.id + ") :", e);
      }
    }
    // Le PDF lui-même se fabrique derrière : de quelques secondes à plus
    // d'une minute pour le premier rendu d'un fond, que la cliente n'a pas à
    // attendre sur l'écran de paiement. Il sera prêt quand on viendra le
    // télécharger.
    if (preparer) preparerFichierDImpression(it.id, cfg);
  }
}

// --- Tarification & paiement -------------------------------------------------

/** Une transaction ouverte par `db.transaction`. */
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Là où passent les requêtes d'un calcul : la base, ou la transaction en
 * cours.
 *
 * Un calcul fait SOUS LE VERROU d'une commande doit lire par la transaction
 * qui tient ce verrou : elle seule voit la ligne qu'elle vient d'écrire, et
 * une requête partie par `db` prendrait une seconde connexion du pool
 * pendant que la première attend — dix paniers modifiés à la fois, et plus
 * aucune connexion ne se libère.
 */
type Executeur = typeof db | Transaction;

/**
 * Relit une commande en la VERROUILLANT jusqu'à la fin de la transaction.
 *
 * C'est ce verrou qui met en file les deux côtés d'un paiement : une
 * modification du panier (ligne écrite, commande repassée en panier) et la
 * validation d'un encaissement (lignes relues, montant comparé, commande
 * marquée payée). Sans lui, une modification pouvait tomber entre la
 * vérification du montant et le passage en « payée » : une affiche passée de
 * l'A4 à l'A3 x5 était validée au prix d'un seul A4.
 *
 * « no key update » plutôt que « update » : le verrou bloque tout ce qui
 * MODIFIE la commande, mais laisse passer ce qui s'y RATTACHE — une ligne de
 * journal, un paiement —, dont la clé étrangère n'a besoin que de savoir que
 * la commande existe.
 */
async function commandeVerrouillee(
  tx: Transaction,
  condition: ReturnType<typeof eq>,
): Promise<typeof schema.orders.$inferSelect | null> {
  const [order] = await tx
    .select()
    .from(schema.orders)
    .where(condition)
    .for("no key update");
  return order ?? null;
}

/** Ligne de commande minimale pour le calcul de prix. */
type PricedItem = {
  unitPriceCents: number;
  quantity: number;
  config: unknown;
  /** Servent au poids, absents des paniers reconstitués à la volée. */
  productId?: number | null;
  variantId?: number | null;
};

/**
 * Poids total d'un panier, en grammes.
 *
 * Une seule requête par table plutôt qu'une par ligne : le tunnel de commande
 * appelle cette fonction à chaque changement d'adresse, elle doit rester
 * insensible au nombre d'articles.
 *
 * La cascade variante → produit → catégorie vit dans @memoryline/types, et le
 * cadre s'ajoute par-dessus : c'est un objet de plus dans le colis.
 */
async function poidsDuPanier(
  items: PricedItem[],
  ex: Executeur = db,
): Promise<number> {
  const produitIds = [
    ...new Set(items.map((i) => i.productId).filter((v): v is number => !!v)),
  ];
  // La variante se retrouve par le FORMAT, pas par variantId : la boutique ne
  // renseigne jamais cette colonne, c'est le serveur qui résout la variante à
  // partir de « format » — exactement comme il le fait pour le prix. Sans ça,
  // un A3 serait facturé au prix A3 mais pesé comme un A4, et les poids saisis
  // par format au back-office ne serviraient à rien.
  const formatDe = (it: PricedItem) =>
    String((it.config as { format?: unknown } | null)?.format ?? "A4");
  const cadreIds = [
    ...new Set(
      items
        .map((i) => Number((i.config as { frameId?: unknown } | null)?.frameId))
        .filter((v) => Number.isFinite(v) && v > 0),
    ),
  ];

  const [produits, variantes, cadres] = await Promise.all([
    produitIds.length
      ? ex
          .select({
            id: schema.products.id,
            weightGrams: schema.products.weightGrams,
            categoryId: schema.products.categoryId,
          })
          .from(schema.products)
          .where(inArray(schema.products.id, produitIds))
      : [],
    produitIds.length
      ? ex
          .select({
            productId: schema.variants.productId,
            format: schema.variants.format,
            weightGrams: schema.variants.weightGrams,
          })
          .from(schema.variants)
          .where(inArray(schema.variants.productId, produitIds))
      : [],
    cadreIds.length
      ? ex
          .select({
            id: schema.frames.id,
            weightGrams: schema.frames.weightGrams,
          })
          .from(schema.frames)
          .where(inArray(schema.frames.id, cadreIds))
      : [],
  ]);

  // Le poids par défaut vient des COLLECTIONS du produit, et une affiche en a
  // souvent plusieurs. Une seule requête pour tout le panier : une par produit
  // sur le chemin qui calcule les frais de port serait payée à chaque ajout.
  const rangements = produitIds.length
    ? await ex
        .select({
          productId: schema.productCollections.productId,
          defaultWeightGrams: schema.collections.defaultWeightGrams,
        })
        .from(schema.productCollections)
        .innerJoin(
          schema.collections,
          eq(schema.productCollections.collectionId, schema.collections.id),
        )
        .where(inArray(schema.productCollections.productId, produitIds))
    : [];
  const poidsParProduit = new Map<number, (number | null)[]>();
  for (const r of rangements) {
    const liste = poidsParProduit.get(r.productId) ?? [];
    liste.push(r.defaultWeightGrams);
    poidsParProduit.set(r.productId, liste);
  }

  const parProduit = new Map(produits.map((p) => [p.id, p]));
  const parVariante = new Map(
    variantes.map((v) => [`${v.productId}:${v.format}`, v]),
  );
  const parCadre = new Map(cadres.map((f) => [f.id, f]));

  return poidsPanier(
    items.map((it) => {
      const produit = it.productId ? parProduit.get(it.productId) : undefined;
      const cadreId = Number(
        (it.config as { frameId?: unknown } | null)?.frameId,
      );
      return {
        quantite: it.quantity,
        varianteGrammes:
          parVariante.get(`${it.productId}:${formatDe(it)}`)?.weightGrams ??
          null,
        produitGrammes: produit?.weightGrams ?? null,
        // La plus lourde de ses collections : un colis surestimé se paie en
        // centimes visibles, un colis sous-affranchi revient en surtaxe sans
        // que rien ne l'ait signalé.
        collectionGrammes: poidsDesCollections(
          poidsParProduit.get(it.productId ?? -1) ?? [],
        ),
        cadreGrammes: parCadre.get(cadreId)?.weightGrams ?? null,
      };
    }),
  );
}

/**
 * Prix unitaire d'une ligne, en centimes — RÉSOLU CÔTÉ SERVEUR depuis le
 * catalogue. Le navigateur envoie bien un `unitPriceCents` (il doit l'afficher),
 * mais on ne le lit JAMAIS : sinon un POST forgé fixerait librement le montant
 * encaissé. Miroir de priceForConfig() côté web : prix de la variante du format
 * demandé, à défaut le prix de base du produit.
 */
/**
 * Vérifie qu'un slug de type d'affiche existe vraiment.
 *
 * Les valeurs étaient ramenées de force à « front » ou « back » : un type
 * créé au back-office aurait été silencieusement réécrit en « de face ».
 * On accepte donc n'importe quel type existant — et rien d'autre, pour ne pas
 * rattacher un dessin à un type fantôme.
 */
function zonesPropres(brut: unknown): Record<string, string> {
  const propre: Record<string, string> = {};
  for (const [k, v] of Object.entries((brut ?? {}) as Record<string, unknown>)) {
    if (/^st\d+$/.test(k) && /^#[0-9a-fA-F]{3,8}$/.test(String(v)))
      propre[k] = String(v).toUpperCase();
  }
  return propre;
}

/**
 * Liste de zones masquées d'une pièce, nettoyée : des noms stN, sans doublon,
 * et — quand on connaît les zones du dessin — seulement celles qui existent.
 * Une zone fantôme ne masquerait rien, mais resterait en base à tromper le
 * prochain qui lira la liste.
 */
function zonesMasqueesPropres(
  brut: unknown,
  zonesDuDessin?: Record<string, string> | null,
): string[] {
  if (!Array.isArray(brut)) return [];
  const propres = new Set<string>();
  for (const z of brut) {
    const zone = String(z);
    if (!/^st\d+$/.test(zone)) continue;
    if (zonesDuDessin && !(zone in zonesDuDessin)) continue;
    propres.add(zone);
  }
  return [...propres];
}

/**
 * Groupes de couleurs d'un dessin, nettoyés contre ses zones : chaque zone
 * dans un seul groupe, noms bornés, nuanciers connus (cf. groupesDuDessin).
 * Absent ou illisible : null, c'est-à-dire « une zone par groupe », le
 * comportement d'avant les groupes.
 */
function groupesPropres(
  brut: unknown,
  zonesDuDessin: Record<string, string> | null | undefined,
): GroupeCouleur[] | null {
  if (!Array.isArray(brut)) return null;
  return groupesDuDessin(zonesDuDessin ?? {}, brut);
}

/**
 * Familles de couleurs d'un dessin en pixels, nettoyées avant d'être rangées
 * en base : couleurs relues, clés uniques, noms bornés (cf. famillesDuDessin).
 * La CARTE des teintes est gardée telle quelle — c'est le serveur qui l'écrit,
 * le back-office ne fait que la relire.
 */
function couleursImagePropres(brut: unknown): CouleursImage | null {
  if (!brut || typeof brut !== "object") return null;
  const source = brut as CouleursImage;
  const familles = famillesDuDessin(source);
  if (familles.length === 0) return null;
  return {
    familles,
    ...(typeof source.carte === "string" && source.carte.startsWith("data:image/")
      ? { carte: source.carte }
      : {}),
    ...(Array.isArray(source.carteTeintes)
      ? { carteTeintes: source.carteTeintes.map((t) => String(t)) }
      : {}),
  };
}

/**
 * Ce que la BOUTIQUE reçoit des familles d'un dessin : les familles, sans la
 * carte des teintes. La carte pèse plus d'un kilo-octet par dessin et ne sert
 * qu'aux vignettes du back-office ; la charger pour chaque visiteur, sur
 * chaque personnage de la bibliothèque, serait la plus grosse dépense de la
 * page pour rien.
 */
function famillesPourLaBoutique(brut: unknown): CouleursImage | null {
  const familles = famillesDuDessin(brut);
  return familles.length ? { familles } : null;
}

/* -------------------------------------------------------------------------- */
/*  Limite de débit des images recolorées                                      */
/* -------------------------------------------------------------------------- */

/*
 * Recolorer une image coûte cher : un tiers de seconde de calcul et trois à
 * cinq cents kilo-octets rangés sur le disque, pour CHAQUE couleur jamais vue.
 * Or le client choisit sa couleur librement — il y en a seize millions — et
 * l'adresse est publique : sans garde, une boucle de quelques lignes occupe le
 * serveur en continu. Le dossier, lui, a son propre plafond
 * (couleurs-image-fichier.ts) ; ce qui se limite ici, c'est le CALCUL.
 *
 * Les autres routes publiques coûteuses de la boutique répondent 429 au-delà
 * d'un certain rythme (contact.ts, courriers.ts, ia.ts, comptes.ts) : celle-ci
 * fait pareil.
 *
 * ON NE COMPTE QUE LE TRAVAIL RÉEL. Une image déjà rangée est relue en
 * quelques millisecondes : revenir sur une couleur déjà essayée, recharger la
 * page, revoir sa vignette dans le panier ne rapproche donc jamais un client
 * de la limite. Seules les couleurs neuves comptent.
 */

/**
 * Quatre images neuves par seconde en moyenne, par adresse d'appel.
 *
 * Ce nombre se règle sur CE QU'UN CLIENT HONNÊTE PEUT DEMANDER, et il faut
 * lui laisser de la marge : rien n'est plus fâcheux qu'une boutique qui
 * refuse son chien à quelqu'un qui joue avec le nuancier. Le sélecteur libre
 * du configurateur laisse passer au plus UNE couleur neuve par seconde
 * (REPOS_SELECTEUR_MS, CharacterEditor.tsx), soit soixante par minute : la
 * limite est donc à quatre fois ce qu'un client peut produire, de quoi tenir
 * quatre tablettes derrière la même adresse — un stand, un café, un réseau
 * d'entreprise. Les deux nombres vont ensemble.
 *
 * En face, une boucle de script ne s'arrête plus à quelques couleurs : elle
 * en demanderait des milliers par minute. Le compte la coupe net, et le
 * dossier, lui, ne dépasse de toute façon jamais son plafond.
 */
const IMAGES_MAX = 240;
const IMAGES_FENETRE_MS = 60_000;

const imagesCalculees = new Map<string, { compte: number; finFenetre: number }>();

/**
 * L'adresse d'où vient l'appel, telle qu'on peut la croire.
 *
 * Recopié de `clientIp` (apps/api/src/index.ts), où il n'est pas exporté,
 * comme `adresseAppelante` de contact.ts. Le raisonnement compte plus que le
 * code : le proxy AJOUTE son entrée à « X-Forwarded-For » sans effacer celle
 * qui arrive, donc le PREMIER élément est écrit par l'appelant et se change à
 * chaque requête — un compteur fondé dessus ne se déclencherait jamais. Le
 * DERNIER a été posé par notre propre proxy.
 *
 * Si la lecture change là-bas, celle-ci doit suivre.
 */
function adresseAppelante(c: Context): string {
  const chaine = c.req.header("x-forwarded-for");
  if (chaine) {
    const morceaux = chaine
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    const dernier = morceaux[morceaux.length - 1];
    if (dernier) return dernier;
  }
  return c.req.header("x-real-ip") || "local";
}

/** Vrai quand cette adresse a déjà fait calculer tout ce qu'elle pouvait. */
function tropDImagesCalculees(adresse: string): boolean {
  const compteur = imagesCalculees.get(adresse);
  return Boolean(
    compteur && compteur.finFenetre > Date.now() && compteur.compte >= IMAGES_MAX,
  );
}

/** Compte une image CALCULÉE de plus pour cette adresse. */
function noterImageCalculee(adresse: string): void {
  const maintenant = Date.now();
  // Ménage opportuniste : la table ne doit pas grossir indéfiniment sur un
  // serveur qui tourne des mois.
  if (imagesCalculees.size > 500)
    for (const [k, v] of imagesCalculees)
      if (v.finFenetre < maintenant) imagesCalculees.delete(k);
  const compteur = imagesCalculees.get(adresse);
  if (!compteur || compteur.finFenetre < maintenant)
    imagesCalculees.set(adresse, {
      compte: 1,
      finFenetre: maintenant + IMAGES_FENETRE_MS,
    });
  else compteur.compte += 1;
}

async function typeAfficheValide(slug: unknown): Promise<string | null> {
  const s = String(slug ?? "").trim();
  if (!s) return null;
  const [v] = await db
    .select({ slug: schema.posterViews.slug })
    .from(schema.posterViews)
    .where(eq(schema.posterViews.slug, s));
  return v?.slug ?? null;
}

async function resolveUnitPriceCents(
  productId: number | null | undefined,
  format: string | null | undefined,
  frameId?: string | number | null,
  ex: Executeur = db,
): Promise<number> {
  if (productId == null || !Number.isFinite(productId)) return 0;
  const [product] = await ex
    .select({ basePriceCents: schema.products.basePriceCents })
    .from(schema.products)
    .where(eq(schema.products.id, productId));
  if (!product) return 0;
  const [variant] = await ex
    .select({ priceCents: schema.variants.priceCents })
    .from(schema.variants)
    .where(
      and(
        eq(schema.variants.productId, productId),
        eq(schema.variants.format, format ?? "A4"),
      ),
    );
  const affiche = variant?.priceCents ?? product.basePriceCents;

  // Supplément du cadre, relu au catalogue lui aussi : le navigateur n'a
  // jamais son mot à dire sur un montant. Il dépend du format — un cadre A3
  // coûte plus qu'un cadre A4 —, et c'est la même fonction que celle du
  // configurateur qui choisit entre les deux prix.
  let cadre = 0;
  if (frameId != null && frameId !== "") {
    const [f] = await ex
      .select({
        priceA4Cents: schema.frames.priceA4Cents,
        priceA3Cents: schema.frames.priceA3Cents,
      })
      .from(schema.frames)
      .where(
        and(
          eq(schema.frames.id, Number(frameId)),
          eq(schema.frames.active, true),
        ),
      );
    cadre = f ? prixDuCadreCents(f, format ?? "A4") : 0;
  }
  return affiche + cadre;
}

/** La configuration sans son cadre — le reste de l'affiche ne bouge pas. */
function sansCadre(cfg: PosterConfig): PosterConfig {
  const { frameId: _retire, ...reste } = cfg;
  return reste;
}

/** La ligne porte-t-elle un cadre ? */
function porteUnCadre(config: unknown): boolean {
  const frameId = (config as { frameId?: unknown } | null)?.frameId;
  return frameId != null && frameId !== "";
}

/**
 * Retire le cadre de chaque ligne d'une commande qui en porte un, prix
 * recalculé. Rend le nombre de lignes touchées.
 *
 * Sert quand le site ne propose plus les cadres : un panier rempli avant que
 * la boutique ne les retire ne doit pas pouvoir en commander un. S'appelle
 * dans une transaction qui tient le verrou de la commande ; à l'appelant de
 * signaler ensuite la modification (panierModifie).
 */
async function retirerLesCadres(tx: Transaction, orderId: number): Promise<number> {
  const lignes = await tx
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, orderId));
  let retires = 0;
  for (const ligne of lignes) {
    if (!porteUnCadre(ligne.config)) continue;
    const cfg = ligne.config as PosterConfig;
    await tx
      .update(schema.orderItems)
      .set({
        config: sansCadre(cfg),
        // Recalculé comme à chaque modification d'une ligne (PUT) : le prix
        // de l'affiche seule, au catalogue du moment.
        unitPriceCents: await resolveUnitPriceCents(
          ligne.productId,
          cfg.format,
          null,
          tx,
        ),
      })
      .where(eq(schema.orderItems.id, ligne.id));
    retires++;
  }
  return retires;
}

/**
 * Le panier `cartId`, VERROUILLÉ jusqu'à la fin de la transaction
 * (commandeVerrouillee) — ou null s'il n'accepte plus de modification.
 *
 * Le statut se lit SOUS le verrou : lu avant, il pouvait être « en attente »
 * au moment du contrôle et « payée » au moment d'écrire la ligne.
 */
async function panierModifiable(tx: Transaction, cartId: string) {
  const order = await commandeVerrouillee(
    tx,
    eq(schema.orders.clientOrderId, cartId),
  );
  // Un panier devenu commande est clos. Sans cette garde, l'identifiant de
  // panier resté dans le navigateur suffisait à modifier une affiche DÉJÀ
  // PAYÉE — passer d'un A4 à un A3, au prix de l'A4 — ou à en retirer une.
  // Une commande EN ATTENTE reste modifiable, mais elle repasse alors en
  // panier, et son ancien montant ne vaut plus rien (panierModifie).
  if (!order || (order.status !== "draft" && order.status !== "pending"))
    return null;
  return order;
}

/**
 * Charge une ligne de panier EN VÉRIFIANT qu'elle appartient bien au panier
 * `cartId`. Sans ce contrôle, l'id de ligne (entier séquentiel) suffirait à
 * modifier ou supprimer la ligne du panier de quelqu'un d'autre.
 *
 * Le panier revient verrouillé avec elle (panierModifiable) : l'écriture de
 * la ligne et le retour en panier se font dans la même transaction.
 */
async function loadCartItem(tx: Transaction, cartId: string, itemId: number) {
  if (!Number.isFinite(itemId)) return null;
  const order = await panierModifiable(tx, cartId);
  if (!order) return null;
  const [item] = await tx
    .select()
    .from(schema.orderItems)
    .where(
      and(
        eq(schema.orderItems.id, itemId),
        eq(schema.orderItems.orderId, order.id),
      ),
    );
  return item ? { order, item } : null;
}

/**
 * Une ligne du panier vient d'être ajoutée, modifiée ou retirée — dans la
 * transaction `tx`, qui tient le verrou de la commande (panierModifiable).
 *
 * Remonte d'abord l'horloge d'inactivité. À faire PARTOUT où le panier ou le
 * tunnel change : c'est le cœur du troisième critère d'abandon. Sans cette
 * date, l'inactivité ne se mesure pas, et un client qui compose son affiche
 * depuis une heure serait déclaré parti.
 *
 * Et surtout : si la commande était EN ATTENTE DE PAIEMENT, elle repasse en
 * panier. Son total avait été figé au passage en caisse, et le paiement
 * ouvert à ce moment-là — carte ou PayPal — l'avait été pour ce montant. Le
 * laisser tel quel permettait de passer un A4 en A3 puis de payer le prix de
 * l'A4.
 *
 * Revenue en panier, la commande garde son numéro, sa cliente et son adresse ;
 * son total est recalculé pour ce qu'elle contient désormais. Le prochain
 * passage en caisse la remet en attente et ouvre un paiement au bon montant,
 * et aucun paiement ne peut plus s'ouvrir d'ici là (voir la route du
 * PaymentIntent). Un paiement déjà ouvert qui aboutirait quand même est
 * vérifié à l'arrivée, sous le même verrou (markOrderPaid).
 *
 * Le total reste ensuite à jour à chaque nouvelle modification : c'est lui
 * que la relance de panier abandonné annonce à la cliente. Un panier qui
 * n'est jamais passé en caisse, lui, n'a pas de total à tenir.
 *
 * `auStand` range le panier du côté où il vient d'être touché — tablette du
 * stand ou site (voir `panierDuStand` dans le schéma). Obligatoire, pour que
 * chaque appel se pose la question : un oubli rangerait des paniers du stand
 * parmi les abandons du site.
 */
async function panierModifie(
  tx: Transaction,
  order: typeof schema.orders.$inferSelect,
  auStand: boolean,
): Promise<void> {
  const maintenant = new Date();
  const rouverte = order.status === "pending";
  // Passé en caisse = une cliente rattachée : c'est le passage en caisse qui
  // la pose.
  if (!rouverte && order.customerId == null) {
    await tx
      .update(schema.orders)
      .set({ lastActivityAt: maintenant, panierDuStand: auStand })
      .where(eq(schema.orders.id, order.id));
    return;
  }

  // Le recalcul se fait dans un point de reprise : s'il échoue, la ligne
  // reste écrite et la commande repasse quand même en panier — c'est ce qui
  // protège. Le total sera de toute façon recalculé au prochain passage en
  // caisse, et une panne de calcul ne doit pas empêcher quelqu'un de modifier
  // son panier.
  let valeur: Awaited<ReturnType<typeof valeurDesLignes>> | null = null;
  try {
    valeur = await tx.transaction((sp) => valeurDesLignes(order, maintenant, sp));
  } catch (e) {
    console.error("[panier] total non recalculé après modification", e);
  }
  await tx
    .update(schema.orders)
    .set({
      status: "draft",
      lastActivityAt: maintenant,
      panierDuStand: auStand,
      ...(valeur
        ? {
            totalCents: valeur.totalCents,
            shippingCents: valeur.shippingCents,
            weightGrams: valeur.poidsGrammes,
          }
        : {}),
    })
    .where(eq(schema.orders.id, order.id));
  if (rouverte)
    await tx.insert(schema.orderEvents).values({
      orderId: order.id,
      kind: "event",
      message:
        `Panier modifié après le passage en caisse : la commande repasse en panier ` +
        `(${euros(order.totalCents)} → ${valeur ? euros(valeur.totalCents) : "total à recalculer"}). ` +
        `Un paiement ouvert pour l'ancien montant ne la validera plus, sauf si elle revient à ce montant.`,
    });
}

/**
 * Total à FACTURER en centimes, remises comprises — calculé côté SERVEUR (le
 * montant envoyé par le navigateur n'est jamais de confiance).
 *
 * Le calcul lui-même vit dans @memoryline/types : le panier et le tunnel de
 * commande utilisent EXACTEMENT la même fonction, donc le montant affiché au
 * client et le montant encaissé ne peuvent plus diverger.
 */
async function computeOrderTotalCents(
  items: PricedItem[],
  code?: string | null,
  maintenant: Date = new Date(),
  ex: Executeur = db,
): Promise<number> {
  const rules = await ex.select().from(schema.promoRules);
  const lignes = items.map((it) => ({
    unitPriceCents: it.unitPriceCents,
    quantity: it.quantity,
    format:
      (it.config as { format?: string } | null)?.format ?? null,
  }));
  // Le code passe par le moteur, qui décide seul s'il ouvre droit à une
  // remise : le navigateur peut envoyer ce qu'il veut, un code inconnu ou
  // expiré ne change rien au montant.
  return totalPanierCents(lignes, rules, maintenant, code ? [code] : []);
}

/**
 * Frais de port d'une commande, calculés côté SERVEUR.
 *
 * Le mode et le pays viennent du navigateur, le PRIX non : il est relu au
 * catalogue, et un mode indisponible dans la zone du client fait échouer la
 * commande plutôt que d'être facturé au hasard.
 */
async function computeShippingCents(
  items: PricedItem[],
  modeSlug: string,
  pays: string,
  code?: string | null,
  maintenant: Date = new Date(),
  ex: Executeur = db,
): Promise<{
  cents: number;
  label: string;
  kind: string;
  poidsGrammes: number;
} | null> {
  const [zones, modes, tarifs, regles] = await Promise.all([
    ex.select().from(schema.shippingZones),
    ex
      .select()
      .from(schema.shippingMethods)
      .where(eq(schema.shippingMethods.active, true)),
    ex.select().from(schema.shippingRates),
    ex.select().from(schema.promoRules),
  ]);
  const lignes = items.map((it) => ({
    unitPriceCents: it.unitPriceCents,
    quantity: it.quantity,
    format: (it.config as { format?: string } | null)?.format ?? null,
  }));
  // Le seuil de gratuité se compare au panier APRÈS remises : c'est ce que
  // le client voit à l'écran, et c'est le montant qu'il paie vraiment.
  const apresRemise =
    sousTotalCents(lignes) -
    remisesPanier(lignes, regles, maintenant, code ? [code] : []).remiseCents;
  // Le poids décide de la tranche d'affranchissement : un mode dont aucune
  // tranche ne couvre le colis n'est pas proposable, et la commande est
  // refusée plutôt que sous-affranchie.
  const poids = await poidsDuPanier(items, ex);
  const option = fraisDePort(
    { zones, modes, tarifs },
    modeSlug,
    pays,
    Math.max(0, apresRemise),
    poids,
    // La promotion « livraison offerte dès X € », si la boutique en a une.
    // C'est le serveur qui décide du port encaissé : l'écran l'affiche, il
    // ne le calcule pas pour lui.
    seuilPortOffertCents(regles, maintenant, code ? [code] : []),
  );
  if (!option) return null;
  return {
    cents: option.fraisCents,
    label: option.mode.name,
    kind: option.mode.kind,
    poidsGrammes: poids,
  };
}

/**
 * Ce que vaut une commande d'après ses lignes ACTUELLES : articles, remise du
 * code retenu, et port du mode choisi.
 *
 * `totalCents` est figé au passage en caisse ; les lignes, elles, pouvaient
 * encore bouger ensuite. C'est ce recalcul qui fait foi quand un paiement
 * arrive, et quand un panier modifié repasse en brouillon.
 *
 * `maintenant` fixe l'heure à laquelle se lisent les promotions : celle du
 * passage en caisse pour vérifier un paiement. Une remise qui expire à minuit
 * ne doit pas faire refuser un paiement ouvert à 23 h 58 et confirmé à
 * 0 h 01.
 *
 * `livrable` est faux quand le mode de livraison choisi ne sait plus porter
 * ce colis : le total rendu n'a alors pas de port, et ne peut rien valider.
 */
async function valeurDesLignes(
  order: typeof schema.orders.$inferSelect,
  maintenant: Date,
  ex: Executeur = db,
): Promise<{
  totalCents: number;
  shippingCents: number;
  poidsGrammes: number;
  livrable: boolean;
}> {
  const items = await ex
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, order.id));
  const articles = await computeOrderTotalCents(items, order.promoCode, maintenant, ex);
  // Une commande sans mode de livraison (reprise de l'ancienne boutique) garde
  // le port qu'elle porte : il n'y a rien pour le recalculer.
  if (!order.shippingMethod)
    return {
      totalCents: articles + order.shippingCents,
      shippingCents: order.shippingCents,
      poidsGrammes: order.weightGrams,
      livrable: true,
    };
  const port = await computeShippingCents(
    items,
    order.shippingMethod,
    order.shippingCountry || "FR",
    order.promoCode,
    maintenant,
    ex,
  );
  if (!port)
    return {
      totalCents: articles,
      shippingCents: 0,
      poidsGrammes: await poidsDuPanier(items, ex),
      livrable: false,
    };
  return {
    totalCents: articles + port.cents,
    shippingCents: port.cents,
    poidsGrammes: port.poidsGrammes,
    livrable: true,
  };
}

/** Des centimes, écrits comme sur une facture : « 19,00 € ». */
function euros(cents: number): string {
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

/** Ce qu'un prestataire dit avoir réellement encaissé. */
export interface MontantRecu {
  montantCents: number;
  /** Code ISO de la devise, dans la casse du prestataire (« eur », « EUR »). */
  devise: string;
}

/**
 * Un encaissement qui ne correspond pas à ce que vaut la commande.
 *
 * Levée par markOrderPaid : la commande n'est PAS marquée payée, l'écart est
 * écrit au journal de la commande, et la route qui l'attrape répond une
 * erreur au navigateur. Le message est celui de la cliente.
 */
export class MontantEncaisseDifferent extends Error {
  constructor(
    readonly attenduCents: number,
    readonly recuCents: number,
  ) {
    super(
      `Votre paiement de ${euros(recuCents)} a bien été reçu, mais votre panier a changé pendant le paiement ` +
        `et vaut maintenant ${euros(attenduCents)}. Votre commande n'est donc pas encore validée : ` +
        `nous revenons vers vous très vite pour régulariser. Inutile de payer une seconde fois.`,
    );
    this.name = "MontantEncaisseDifferent";
  }
}

/**
 * Vérifie qu'un paiement en ligne couvre EXACTEMENT ce que vaut la commande,
 * recalculée depuis ses lignes. Rend le montant validé, ou l'écart constaté.
 *
 * La faille qu'elle ferme : le paiement était créé pour le panier du passage
 * en caisse, et le panier restait modifiable ensuite. Passer une affiche de
 * l'A4 à l'A3, puis payer l'ancien paiement, livrait un A3 au prix d'un A4 —
 * et la commande passait « payée » sans que rien ne le signale.
 *
 * S'appelle dans la transaction de markOrderPaid, qui tient le verrou de la
 * commande : les lignes comparées sont celles qui seront payées, aucune
 * modification du panier ne peut se glisser entre les deux.
 *
 * Sur un écart, rien n'est effacé et rien n'est validé : l'argent est bien
 * arrivé chez le prestataire, il faut le rendre ou le compléter. La ligne de
 * paiement passe en « montant_different » avec la somme réellement reçue, et
 * le journal de la commande dit quoi faire — une seule fois, même si le
 * prestataire rejoue son avis.
 */
async function verifierEncaissement(
  tx: Transaction,
  order: typeof schema.orders.$inferSelect,
  provider: "stripe" | "paypal",
  externalRef: string,
  recu: MontantRecu,
): Promise<{ valide: true; montantCents: number } | { valide: false; attenduCents: number }> {
  const valeur = await valeurDesLignes(order, order.lastActivityAt ?? new Date(), tx);
  const devise = recu.devise.trim().toUpperCase();
  if (
    valeur.livrable &&
    devise === "EUR" &&
    Number.isInteger(recu.montantCents) &&
    recu.montantCents === valeur.totalCents
  )
    return { valide: true, montantCents: valeur.totalCents };

  const nomPrestataire = provider === "stripe" ? "Stripe" : "PayPal";
  console.error(
    `[paiement] ${order.number} : ${nomPrestataire} ${externalRef} a encaissé ${recu.montantCents} ${devise || "?"}, ` +
      `la commande vaut ${valeur.totalCents} EUR${valeur.livrable ? "" : " (livraison impossible)"} — NON marquée payée`,
  );

  const [paiement] = await tx
    .select({ id: schema.payments.id, status: schema.payments.status })
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.orderId, order.id),
        eq(schema.payments.externalRef, externalRef),
      ),
    );
  if (paiement?.status !== "montant_different") {
    if (paiement)
      await tx
        .update(schema.payments)
        .set({ status: "montant_different", amountCents: recu.montantCents })
        .where(eq(schema.payments.id, paiement.id));
    else
      // Un paiement que nous n'avions pas ouvert — ou plus trace : on le garde
      // quand même, c'est de l'argent reçu.
      await tx.insert(schema.payments).values({
        orderId: order.id,
        provider,
        externalRef,
        status: "montant_different",
        amountCents: recu.montantCents,
      });
    const recuEnClair =
      devise === "EUR" ? euros(recu.montantCents) : `${recu.montantCents / 100} ${devise || "(devise inconnue)"}`;
    await tx.insert(schema.orderEvents).values({
      orderId: order.id,
      kind: "event",
      message:
        `ÉCART DE PAIEMENT : ${nomPrestataire} a encaissé ${recuEnClair} (${externalRef}), ` +
        `mais la commande vaut ${euros(valeur.totalCents)} d'après ses lignes actuelles` +
        (valeur.livrable
          ? ""
          : ", sans compter le port : le mode de livraison choisi ne sait plus porter ce colis") +
        `. Le panier a sans doute été modifié pendant le paiement. La commande n'a PAS été marquée payée : ` +
        `voyez avec la cliente, puis remboursez ce paiement depuis votre compte ${nomPrestataire} ; ` +
        `elle pourra repasser commande au bon montant.`,
    });
  }
  return { valide: false, attenduCents: valeur.totalCents };
}

/** Ce paiement est-il celui qui a déjà réglé la commande (avis rejoué) ? */
async function dejaEncaisse(
  tx: Transaction,
  orderId: number,
  externalRef: string,
): Promise<boolean> {
  const [paiement] = await tx
    .select({ id: schema.payments.id })
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.orderId, orderId),
        eq(schema.payments.externalRef, externalRef),
        eq(schema.payments.status, "succeeded"),
      ),
    );
  if (paiement) return true;
  const [vente] = await tx
    .select({ id: schema.orderTransactions.id })
    .from(schema.orderTransactions)
    .where(
      and(
        eq(schema.orderTransactions.orderId, orderId),
        eq(schema.orderTransactions.kind, "sale"),
        eq(schema.orderTransactions.externalRef, externalRef),
      ),
    );
  return Boolean(vente);
}

/**
 * Un SECOND paiement aboutit sur une commande déjà payée.
 *
 * C'est la suite naturelle d'un panier modifié pendant le paiement : l'ancien
 * paiement, ouvert pour l'ancien montant, peut encore aboutir après que la
 * cliente a payé le nouveau. Ou deux onglets qui paient au même instant : le
 * verrou de markOrderPaid les fait passer l'un après l'autre, et le second
 * arrive ici. On le marquait « succeeded » en silence — deux encaissements
 * pour une affiche, sans que personne ne le voie. Il passe en « en_trop », et
 * le journal de la commande dit de le rembourser — une seule fois, même si le
 * prestataire rejoue son avis.
 */
async function signalerPaiementEnTrop(
  tx: Transaction,
  order: typeof schema.orders.$inferSelect,
  provider: "stripe" | "paypal",
  externalRef: string,
  recu: MontantRecu,
): Promise<void> {
  const nomPrestataire = provider === "stripe" ? "Stripe" : "PayPal";
  const montant = recu.montantCents;
  console.error(
    `[paiement] ${order.number} : ${nomPrestataire} ${externalRef} a encaissé ${montant} alors que la commande était déjà payée`,
  );
  const [paiement] = await tx
    .select({ id: schema.payments.id, status: schema.payments.status })
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.orderId, order.id),
        eq(schema.payments.externalRef, externalRef),
      ),
    );
  // Déjà signalé : en trop, ou déjà relevé comme écart — le journal dit déjà
  // de le rembourser.
  if (paiement?.status === "en_trop" || paiement?.status === "montant_different") return;
  if (paiement)
    await tx
      .update(schema.payments)
      .set({ status: "en_trop", amountCents: montant })
      .where(eq(schema.payments.id, paiement.id));
  else
    await tx.insert(schema.payments).values({
      orderId: order.id,
      provider,
      externalRef,
      status: "en_trop",
      amountCents: montant,
    });
  await tx.insert(schema.orderEvents).values({
    orderId: order.id,
    kind: "event",
    message:
      `PAIEMENT EN TROP : ${nomPrestataire} a encaissé ${euros(montant)} (${externalRef}) ` +
      `alors que la commande était déjà payée — sans doute un paiement ouvert avant une modification du panier, ` +
      `ou un second paiement parti au même moment. Remboursez-le depuis votre compte ${nomPrestataire}.`,
  });
}

/** Ce que la transaction de markOrderPaid a conclu. */
type ConclusionEncaissement =
  | { issue: "payee"; order: typeof schema.orders.$inferSelect }
  | { issue: "ecart"; attenduCents: number; recuCents: number }
  | { issue: "sans_suite" };

/**
 * Passe une commande de `pending` à `paid` et génère les PDF — UNE SEULE FOIS
 * (idempotent : appelé par le webhook Stripe ou la capture PayPal, qui peuvent
 * rejouer). Met aussi à jour la ligne `payment` correspondante en `succeeded`.
 * No-op si la commande est déjà payée. Renvoie true si elle vient d'être payée.
 *
 * EXPORTÉE parce qu'un encaissement n'arrive plus seulement du réseau : la
 * boutique encaisse aussi un virement ou un chèque depuis la fiche commande
 * (apps/api/src/commandes.ts). Tout ce que cette fonction fait — la date de
 * paiement, la récupération d'un panier relancé, les PDF d'impression,
 * l'écriture au grand livre, la confirmation au client — vaut exactement
 * pareil dans ce cas-là, et l'écrire une seconde fois aurait fait deux
 * encaissements qui divergent.
 *
 * `provider` accepte « manuel » pour cette raison, et pour elle seule : le
 * corps de la fonction ne le distingue de rien, il le recopie sur la ligne de
 * paiement et au grand livre — où la page Finances sait déjà l'écrire en
 * français.
 *
 * TOUT ENCAISSEMENT DIT COMBIEN IL A REÇU (`recu`).
 *  - En ligne, c'est ce que le prestataire a réellement pris. La commande
 *    n'est marquée payée que si ce montant est exactement ce qu'elle vaut,
 *    recalculée depuis ses lignes du moment ; sinon
 *    {@link MontantEncaisseDifferent} est levée et rien n'est validé (voir
 *    verifierEncaissement).
 *  - « manuel », c'est le total que la boutique déclare avoir reçu, lu sur la
 *    fiche d'une commande en attente. Si la commande est revenue en panier
 *    entre-temps (panierModifie) ou ne vaut plus ce total, rien n'est validé
 *    et la fonction rend false : la route le dit à la boutique.
 *
 * Tout se décide dans UNE transaction, sous le verrou de la commande
 * (commandeVerrouillee) : relire la commande, comparer le montant, écrire le
 * paiement, passer en « payée », inscrire la vente au grand livre. Les
 * routes du panier prennent le même verrou pour écrire une ligne : l'une
 * attend que l'autre ait fini. Le webhook Stripe et la confirmation du
 * navigateur qui arrivent au même instant passent aussi l'un après l'autre :
 * le second trouve la commande payée, et la vente ne s'écrit qu'une fois.
 *
 * Les suites — relance récupérée, affiches IA, fichiers d'impression,
 * courriers — viennent APRÈS la transaction : une commande est payée pour de
 * bon avant qu'on envoie quoi que ce soit.
 */
export async function markOrderPaid(
  orderId: number,
  provider: "stripe" | "paypal" | "manuel",
  externalRef: string,
  recu: MontantRecu,
): Promise<boolean> {
  const conclusion = await db.transaction(
    async (tx): Promise<ConclusionEncaissement> => {
      const order = await commandeVerrouillee(tx, eq(schema.orders.id, orderId));
      if (!order) return { issue: "sans_suite" };
      const cePaiement = and(
        eq(schema.payments.orderId, orderId),
        eq(schema.payments.externalRef, externalRef),
      );

      if (order.status === "paid") {
        // Payée entre la lecture de la fiche et le clic : il n'y a rien à
        // déclarer reçu (la route le dit).
        if (provider === "manuel") return { issue: "sans_suite" };
        if (await dejaEncaisse(tx, orderId, externalRef)) {
          // Le prestataire rejoue son avis : la commande est déjà faite.
          await tx
            .update(schema.payments)
            .set({ status: "succeeded" })
            .where(cePaiement);
          return { issue: "sans_suite" };
        }
        await signalerPaiementEnTrop(tx, order, provider, externalRef, recu);
        return { issue: "sans_suite" };
      }

      // Ce qui entre au grand livre : la somme vérifiée chez le prestataire,
      // ou le total déclaré reçu par la boutique.
      let montantCents: number;
      if (provider === "manuel") {
        if (order.status !== "pending" || order.totalCents !== recu.montantCents)
          return { issue: "sans_suite" };
        montantCents = order.totalCents;
      } else {
        const verdict = await verifierEncaissement(tx, order, provider, externalRef, recu);
        if (!verdict.valide)
          return {
            issue: "ecart",
            attenduCents: verdict.attenduCents,
            recuCents: recu.montantCents,
          };
        montantCents = verdict.montantCents;
      }

      // Trace le paiement (idempotent sur externalRef).
      const [avant] = await tx
        .select({ status: schema.payments.status })
        .from(schema.payments)
        .where(cePaiement);
      await tx
        .update(schema.payments)
        .set(
          provider === "manuel"
            ? { status: "succeeded" }
            : { status: "succeeded", amountCents: montantCents },
        )
        .where(cePaiement);

      await tx
        .update(schema.orders)
        .set({ status: "paid", totalCents: montantCents })
        .where(eq(schema.orders.id, orderId));

      // Le grand livre reçoit l'encaissement. C'est la seule source de vérité
      // pour le solde de la commande : le total, lui, ne bouge jamais.
      await tx.insert(schema.orderTransactions).values({
        orderId,
        kind: "sale",
        status: "success",
        amountCents: montantCents,
        gateway: provider,
        externalRef: externalRef ?? null,
      });

      // Un avis rejoué après que le panier a été remis au montant payé : le
      // journal disait de rembourser ce paiement, il doit dire que ce n'est
      // plus la peine.
      if (avant?.status === "montant_different")
        await tx.insert(schema.orderEvents).values({
          orderId,
          kind: "event",
          message:
            `Le paiement ${externalRef}, relevé plus tôt comme ÉCART DE PAIEMENT, correspond désormais ` +
            `au total de la commande (${euros(montantCents)}) : elle est marquée payée, il n'y a rien à rembourser.`,
        });

      return { issue: "payee", order };
    },
  );

  if (conclusion.issue === "ecart")
    throw new MontantEncaisseDifferent(conclusion.attenduCents, conclusion.recuCents);
  if (conclusion.issue !== "payee") return false;
  const { order } = conclusion;

  // Ce panier avait-il été relancé ? Si oui, la relance a servi à quelque
  // chose, et c'est le seul chiffre qui le dira. Ne fait rien dans le cas
  // ordinaire, où aucun courrier n'était parti.
  await noterLaRecuperation(orderId);

  // Les affiches générées par IA passent du panier à la commande : elles
  // reçoivent leur date de paiement, et c'est elle qui les sort de la purge
  // des photos de visiteurs (apps/api/src/ia.ts).
  await rattacherGenerationsAuPanier(orderId, order.clientOrderId, order.customerId);

  try {
    await enregistrerFichiersDImpression(orderId, { preparer: true });
  } catch (e) {
    console.error("Fichiers d'impression non enregistrés (commande " + orderId + ") :", e);
  }

  await previenirDuPaiement(orderId);
  return true;
}

/**
 * Courriers d'une commande qui vient d'être payée : la confirmation au
 * client, et l'avis à la boutique.
 *
 * Isolé dans sa propre fonction, et sans jamais lever : une commande payée
 * reste payée même si le courrier ne part pas. Le journal garde la trace de
 * l'envoi — ou de son échec, pour qu'on puisse le relancer à la main.
 */
async function previenirDuPaiement(orderId: number): Promise<void> {
  try {
    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId));
    if (!order) return;
    const [client] = order.customerId
      ? await db
          .select()
          .from(schema.customers)
          .where(eq(schema.customers.id, order.customerId))
      : [];
    const items = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId));
    const cadres = await db.select().from(schema.frames);

    const lignes = items.map((it) => {
      const cfg = (it.config ?? {}) as Record<string, unknown>;
      const cadre = cadres.find((f) => String(f.id) === String(cfg.frameId ?? ""));
      return {
        titre: it.title ?? "Affiche personnalisée",
        format: (cfg.format as string) ?? "A4",
        cadre: cadre?.name ?? null,
        quantite: it.quantity,
        unitPriceCents: it.unitPriceCents,
      };
    });
    const sousTotal = lignes.reduce(
      (s, l) => s + l.unitPriceCents * l.quantite,
      0,
    );
    const port = order.shippingCents ?? 0;
    // La remise se DÉDUIT de ce qui a été facturé : c'est le montant payé qui
    // fait foi, pas un recalcul qui pourrait diverger.
    const remise = Math.max(0, sousTotal + port - order.totalCents);

    if (client?.email) {
      const courrier = courrierConfirmation({
        numero: order.number,
        prenomClient: (client.name ?? "").split(" ")[0] || "et merci",
        lignes,
        sousTotalCents: sousTotal,
        remiseCents: remise,
        codePromo: order.promoCode,
        portCents: port,
        totalCents: order.totalCents,
        modeLivraison: order.shippingLabel,
        adresse: [
          order.shippingName,
          order.relayPointLabel,
          order.shippingLine1,
          order.shippingLine2,
          [order.shippingPostalCode, order.shippingCity].filter(Boolean).join(" "),
          order.shippingCountry,
        ].filter((v): v is string => Boolean(v)),
      });
      const parti = await envoyerMail({ ...courrier, to: client.email });
      await db.insert(schema.orderEvents).values({
        orderId,
        kind: "event",
        message: parti
          ? `Confirmation de commande envoyée à ${client.email}.`
          : `Confirmation NON envoyée à ${client.email} (envoi d'e-mails non configuré ou en échec).`,
      });
    }

    // Avis à la boutique : sans lui, il faut penser à ouvrir le back-office.
    const destinataire = (process.env.MAIL_BOUTIQUE ?? "").trim();
    if (destinataire) {
      const avis = courrierNouvelleCommande({
        numero: order.number,
        client: client?.name ?? "client inconnu",
        totalCents: order.totalCents,
        lignes,
      });
      await envoyerMail({ ...avis, to: destinataire });
    }
  } catch (e) {
    console.error("[mail] notification de paiement impossible", e);
  }
}

// --- Montage des routes -------------------------------------------------------

/**
 * Cette commande est-elle visible par la personne connectée ?
 *
 * Le propriétaire voit tout. Un vendeur ne voit que le stand : la liste des
 * commandes le bornait déjà, mais la fiche et le fichier d'impression ne le
 * faisaient pas, et les identifiants se suivent. Compter de un en un suffisait.
 */
function commandeVisiblePar(c: Context, canal: string | undefined): boolean {
  const user = c.get("utilisateur");
  if (!user || user.role === "owner") return true;
  return canal === "salon";
}

export function mountConfiguratorRoutes(app: Hono) {
  // === Données configurateur (public) ====================================

  /**
   * Bibliothèque du configurateur (architecture fidèle à memoryline.fr) :
   *  - `characters` : les personnages à AJOUTER (Homme/Femme/Bébé/Animal…),
   *    chacun avec son SVG complet de base (baseSvgUrl) et ses couleurs.
   *  - `slots` : les variantes interchangeables GÉNÉRIQUES, regroupées par
   *    vue (front/back) puis par slot (clothes/pants/hair/accessory).
   * Le client choisit un personnage, puis change ses vêtements/cheveux/etc.
   * en piochant dans `slots`, et recolore via les zones .stN.
   */
  app.get("/characters", async (c) => {
    const includeArchived = c.req.query("all") === "1";
    // La catégorie vient de la table character_category (jointure), mais le
    // contrat exposé au front ne change pas : `category` reste son NOM.
    // L'ordre suit la position des catégories, puis celle des personnages.
    const types = await db
      .select({
        t: schema.characterTypes,
        categoryName: schema.characterCategories.name,
        categoryPosition: schema.characterCategories.position,
      })
      .from(schema.characterTypes)
      // La jointure ignore les catégories ARCHIVÉES : un rayon rangé n'a plus
      // à paraître dans le configurateur. Ses personnages, eux, restent
      // proposés — ils arrivent simplement sans catégorie, comme ceux qui n'en
      // ont jamais eu. Filtrer sur les personnages, à l'inverse, aurait fait
      // disparaître trente dessins du site pour un simple rangement.
      .leftJoin(
        schema.characterCategories,
        and(
          eq(schema.characterTypes.categoryId, schema.characterCategories.id),
          isNull(schema.characterCategories.archivedAt),
        ),
      )
      .where(includeArchived ? undefined : isNull(schema.characterTypes.archivedAt))
      .orderBy(
        asc(schema.characterCategories.position),
        asc(schema.characterTypes.position),
      );

    // Variantes génériques (character_type_id IS NULL), partagées par tous.
    const variants = await db
      .select()
      .from(schema.assets)
      // Génériques ET non archivées : une pièce archivée disparaît du
      // configurateur, mais reste en base pour les réimpressions.
      .where(
        and(
          isNull(schema.assets.characterTypeId),
          isNull(schema.assets.archivedAt),
        ),
      )
      .orderBy(asc(schema.assets.position));
    // Un tiroir par type d'affiche, y compris ceux créés au back-office :
    // le configurateur cherche `slots[vue]`, il ne doit jamais tomber sur un
    // trou parce qu'un type est arrivé après la mise en production.
    const vues = await db
      .select({ slug: schema.posterViews.slug })
      .from(schema.posterViews);
    const slots: Record<string, Record<string, unknown[]>> = {};
    for (const v of vues) slots[v.slug] = {};
    slots["front"] ??= {};
    for (const a of variants) {
      // Une pièce sans type explicite reste rattachée au premier type,
      // « de face » — c'est ce que faisait le code d'avant.
      const view = a.view ?? "front";
      slots[view] ??= {};
      (slots[view]![a.slot] ??= []).push({
        id: a.id,
        slot: a.slot,
        name: a.name,
        svgUrl: a.svgUrl,
        view,
        colorZones: a.colorZones,
        // Zones que le client ne recolore pas (ruban, élastique…) : pas de
        // pastilles pour elles, et leur couleur par défaut à l'écran.
        zonesMasquees: a.zonesMasquees,
        // Nuances réunies sous une seule rangée de pastilles, et leurs noms.
        groupesCouleurs: a.groupesCouleurs ?? null,
        // Familles de couleurs d'un dessin en PIXELS. La carte des teintes
        // n'en fait pas partie : elle ne sert qu'au back-office, et pèse plus
        // que tout le reste de la bibliothèque réuni.
        couleursImage: famillesPourLaBoutique(a.couleursImage),
        position: a.position,
        // Catégorie de la pièce : c'est elle qui porte le nuancier proposé.
        pieceCategoryId: a.pieceCategoryId,
      });
    }

    // Catégories de pièces + leurs nuanciers : le configurateur n'a plus de
    // couleurs en dur, il lit celles-ci. Les archivées n'en sont pas : leurs
    // pièces restent proposées et reprennent le nuancier de leur emplacement,
    // exactement comme celles d'une catégorie décochée.
    const categoriesPieces = await db
      .select()
      .from(schema.pieceCategories)
      .where(
        and(
          eq(schema.pieceCategories.active, true),
          isNull(schema.pieceCategories.archivedAt),
        ),
      )
      .orderBy(asc(schema.pieceCategories.position));

    return c.json({
      pieceCategories: categoriesPieces.map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        slot: p.slot,
        colors: p.colors ?? [],
      })),
      characters: types.map(({ t, categoryName }) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        category: categoryName ?? null,
        categoryId: t.categoryId,
        position: t.position,
        archived: t.archivedAt != null,
        baseSvgUrl: t.baseSvgUrl,
        baseColorZones: t.baseColorZones,
        // Groupes de couleurs du dessin, et ceux que le client peut changer
        // (null : la première zone seulement, la règle d'avant).
        baseGroupesCouleurs: t.baseGroupesCouleurs ?? null,
        baseZonesProposees: t.baseZonesProposees ?? null,
        // Familles de couleurs, pour un personnage dessiné en pixels (photo ou
        // illustration enregistrée en SVG) : c'est ce qui lui donne enfin des
        // pastilles de couleur. Null = dessin vectoriel, ou rien de détecté.
        baseCouleursImage: famillesPourLaBoutique(t.baseCouleursImage),
        orientation: t.orientation ?? "front",
        bottomPct: t.bottomPct ?? 1,
        // Taille propre au personnage : c'est le configurateur qui l'applique
        // en composant, pour qu'elle entre dans l'échelle enregistrée.
        facteurTaille: t.facteurTaille ?? 1,
        // Sa place de côté, réglée au back-office : le configurateur l'ajoute
        // à la case que la rangée lui donne.
        decalageX: t.decalageX ?? 0,
        // Ids d'ancienne config par slot (= asset.position des génériques) :
        // le front restreint les galeries de l'éditeur à ces variantes.
        slotVariants: t.slotVariants ?? null,
        // Calage des pièces sur CE personnage (par emplacement).
        slotAdjust: t.slotAdjust ?? null,
        // Tenue portée d'emblée quand le client ajoute ce personnage.
        defaultAssets: t.defaultAssets ?? null,
      })),
      slots,
    });
  });

  /* --- Dessins en pixels recolorés ------------------------------------- */

  /*
   * L'image d'un personnage (ou d'une pièce) dessiné en PIXELS, recolorée
   * selon les couleurs choisies par le client.
   *
   * C'EST LA MÊME IMAGE QUE CELLE DU FICHIER D'IMPRESSION, au sens strict :
   * les deux lisent le même fichier rangé dans data/assets/cache. La boutique
   * ne recolore donc rien elle-même — elle ne pourrait pas garantir que le
   * papier ressemble à l'écran. Voir couleurs-image-fichier.ts.
   *
   * L'adresse porte les couleurs (« ?c=fam0:2060C0 ») : elle change dès
   * qu'une couleur change, et le navigateur garde en cache ce qu'il a déjà vu.
   * Ce sont les FAMILLES ENREGISTRÉES qui décident de ce qui est recolorable :
   * une couleur demandée pour une famille que la boutique ne propose pas est
   * ignorée ici comme partout ailleurs (couleursDesFamilles).
   */
  const servirImageRecoloree = async (
    c: Context,
    dessin: { url: string | null; couleursImage: CouleursImage | null } | undefined,
  ) => {
    if (!dessin?.url) return c.json({ error: "dessin introuvable" }, 404);

    // La limite ne se consulte qu'au moment où une couleur va vraiment être
    // CALCULÉE : une image déjà rangée continue d'être servie même au-delà —
    // elle ne coûte rien, et un client qui repasse sur ses couleurs ne doit
    // pas voir son chien disparaître.
    const adresse = adresseAppelante(c);
    const png = await imageRecoloree(
      dessin.url,
      dessin.couleursImage,
      famillesDuParametre(c.req.query("c") ?? ""),
      {
        avantCalcul: () => {
          if (tropDImagesCalculees(adresse)) return false;
          noterImageCalculee(adresse);
          return true;
        },
      },
    ).catch((e) => {
      console.error("[couleurs image] recoloration impossible :", e);
      return null;
    });
    if (png === "plafond")
      return c.json(
        { error: "Trop de couleurs demandées d'affilée. Patientez une minute." },
        429,
        { "Retry-After": String(Math.ceil(IMAGES_FENETRE_MS / 1000)) },
      );
    // Rien à recolorer (dessin vectoriel, aucune famille proposée, couleurs
    // d'origine) : on renvoie vers le dessin lui-même, tel qu'il est servi
    // aujourd'hui. La boutique n'a alors rien de particulier à faire.
    if (!png) return c.redirect(dessin.url, 302);
    return c.body(new Uint8Array(png), 200, {
      "Content-Type": "image/png",
      // Une minute : l'adresse change à chaque couleur, il n'y a donc rien à
      // craindre côté client ; seule une nouvelle détection au back-office
      // doit finir par se voir.
      "Cache-Control": "public, max-age=60",
    });
  };

  /** L'image recolorée du dessin de base d'un personnage. */
  app.get("/characters/:id/image-couleurs", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "id invalide" }, 400);
    const [t] = await db
      .select({
        url: schema.characterTypes.baseSvgUrl,
        couleursImage: schema.characterTypes.baseCouleursImage,
      })
      .from(schema.characterTypes)
      .where(eq(schema.characterTypes.id, id));
    return servirImageRecoloree(c, t);
  });

  /** L'image recolorée d'une pièce (même réglage qu'un personnage). */
  app.get("/pieces/:id/image-couleurs", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "id invalide" }, 400);
    const [a] = await db
      .select({
        url: schema.assets.svgUrl,
        couleursImage: schema.assets.couleursImage,
      })
      .from(schema.assets)
      .where(eq(schema.assets.id, id));
    return servirImageRecoloree(c, a);
  });

  /**
   * Fonds proposés dans le configurateur POUR UN PRODUIT DONNÉ.
   *
   * Exigence cliente : ouvrir le configurateur depuis la fiche "Amiens" doit
   * proposer l'affiche d'Amiens — pas toute la bibliothèque.
   *
   * Stratégie en cascade (la 1re non vide gagne) :
   *  1. fonds explicitement rattachés (`background.product_id`),
   *  2. à défaut, fonds dont le NOM correspond à la VILLE du produit
   *     (ex. produit "AMIENS Cathédrale" -> fonds dont le nom commence par
   *     "AMIENS"). Couvre les fonds non encore rattachés en base.
   *  3. en tout dernier recours seulement, la bibliothèque complète
   *     (un produit sans aucun fond identifiable garde de quoi composer).
   * Le 1er fond renvoyé est le fond "par défaut" présélectionné côté UI.
   */
  app.get("/backgrounds", async (c) => {
    const productId = c.req.query("productId");
    const project = (b: typeof schema.backgrounds.$inferSelect) => ({
      id: b.id,
      url: b.url,
      name: b.name,
      position: b.position,
    });

    // Un fond archivé ne se propose plus, par aucun des trois chemins : il a
    // quitté le catalogue des choix, tout en restant imprimable pour les
    // commandes déjà passées dessus.
    const vivant = isNull(schema.backgrounds.archivedAt);

    if (productId) {
      // 1. rattachement explicite
      const linked = await db
        .select()
        .from(schema.backgrounds)
        .where(
          and(eq(schema.backgrounds.productId, Number(productId)), vivant),
        )
        .orderBy(asc(schema.backgrounds.position));
      if (linked.length > 0) return c.json(linked.map(project));

      // 2. correspondance par ville (nom du produit)
      const [product] = await db
        .select({ name: schema.products.name })
        .from(schema.products)
        .where(eq(schema.products.id, Number(productId)));
      if (product) {
        const norm = (s: string | null) =>
          (s ?? "").toUpperCase().normalize("NFD").replace(/[^A-Z0-9]/g, "");
        // On dérive des mots-clés candidats du nom produit (avant le tiret),
        // en sautant les articles ("LE Tréport" -> "TREPORT"). On essaie chaque
        // candidat et on garde le PREMIER qui correspond à des fonds : ça gère
        // "AMIENS Cathédrale" (-> AMIENS), "LE TRÉPORT Phare" (-> TREPORT) et
        // "ITALIE Venise" (fond nommé ITALIE) sans liste de villes en dur.
        const STOP = new Set(["LE", "LA", "LES", "DU", "DE", "DES", "AFFICHE"]);
        const candidates = product.name
          .split(/[-–]/)[0]!
          .trim()
          .split(/\s+/)
          .map(norm)
          .filter((w) => w.length >= 3 && !STOP.has(w));
        if (candidates.length > 0) {
          const all = await db
            .select()
            .from(schema.backgrounds)
            .where(vivant)
            .orderBy(asc(schema.backgrounds.position));
          // `includes` plutôt que `startsWith` : le nom du fond peut être
          // préfixé par l'article ("LE_TOUQUET_..." pour le candidat "TOUQUET").
          for (const cand of candidates) {
            const cityMatch = all.filter((b) => norm(b.name).includes(cand));
            if (cityMatch.length > 0) return c.json(cityMatch.map(project));
          }
        }
      }
    }

    // 3. repli : bibliothèque complète (jamais vide)
    const rows = await db
      .select()
      .from(schema.backgrounds)
      .where(vivant)
      .orderBy(asc(schema.backgrounds.position))
      .limit(500);
    return c.json(rows.map(project));
  });

  // === Panier (lignes éditables — §18.3) ==================================
  // Panier minimal côté API : une commande 'draft' web sert de panier ; les
  // lignes portent le snapshot config et sont MODIFIABLES tant que draft.

  /** Crée/relit un panier (draft) par clientCartId, renvoie ses lignes. */
  app.get("/cart/:cartId", async (c) => {
    const cartId = c.req.param("cartId");
    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.clientOrderId, cartId));
    if (!order) return c.json({ cartId, items: [], poidsGrammes: 0 });
    const items = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, order.id));
    // Des cadres que le site ne propose plus : le panier les COMPTE sans y
    // toucher. Une lecture ne modifie rien — la pastille de l'en-tête lit ce
    // panier sur chaque page, et le retrait se ferait alors dans le dos de la
    // cliente, sans que le panier ait jamais pu le lui dire. C'est le panier
    // et la caisse qui les retirent, en le montrant (retirer-cadres).
    const modifiable = order.status === "draft" || order.status === "pending";
    const avecCadre = modifiable
      ? items.filter((it) => porteUnCadre(it.config)).length
      : 0;
    const cadresHorsSite =
      avecCadre > 0 && !(await cadresProposesA(c)) ? avecCadre : 0;
    // Le panier expose son poids : la boutique en a besoin pour n'afficher
    // que les modes de livraison qui savent porter le colis, AVANT que le
    // client ait saisi la moindre adresse.
    return c.json({
      cartId,
      orderId: order.id,
      status: order.status,
      items,
      poidsGrammes: await poidsDuPanier(items),
      cadresHorsSite,
    });
  });

  /**
   * Retire du panier les cadres que le site ne propose plus, prix recalculés.
   *
   * Appelée par le panier et la caisse quand la lecture du panier en a compté
   * (`cadresHorsSite`) : ils montrent alors à la cliente que son cadre est
   * parti, et le nouveau montant, avant qu'elle ne paie. Ne fait rien au
   * stand, qui propose toujours les cadres, ni sur un panier déjà clos.
   */
  app.post("/cart/:cartId/retirer-cadres", async (c) => {
    if (await cadresProposesA(c)) return c.json({ retires: 0 });
    const retires = await db.transaction(async (tx) => {
      const order = await panierModifiable(tx, c.req.param("cartId"));
      if (!order) return 0;
      const n = await retirerLesCadres(tx, order.id);
      // Une commande en attente de paiement repasse en panier : son total
      // comptait les cadres.
      if (n > 0) await panierModifie(tx, order, requeteDuStand(c));
      return n;
    });
    return c.json({ retires });
  });

  /** Ajoute une ligne au panier (crée le draft si besoin). */
  app.post("/cart/:cartId/items", async (c) => {
    const cartId = c.req.param("cartId");
    const body = await c.req.json();
    const parsed = posterConfigSchema.safeParse(body.config);
    if (!parsed.success)
      return c.json({ error: "config invalide", details: parsed.error.issues }, 400);

    const [existe] = await db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(eq(schema.orders.clientOrderId, cartId));
    if (!existe) {
      // Le panier naît avec son premier article. « onConflictDoNothing » :
      // deux ajouts partis au même instant d'un panier neuf ne doivent pas
      // en créer deux — l'index unique sur l'identifiant de panier garde le
      // premier, et le second y ajoute simplement sa ligne.
      await db
        .insert(schema.orders)
        .values({
          channel: "web",
          // Le numéro provisoire reprend l'identifiant de panier ENTIER :
          // tronqué à huit caractères, deux paniers commençant pareil se
          // heurtaient à l'index unique et le second ne pouvait plus être
          // créé du tout.
          number: `DRAFT-${cartId}`,
          clientOrderId: cartId,
          status: "draft",
          totalCents: 0,
          lastActivityAt: new Date(),
        })
        .onConflictDoNothing();
    }
    const productId = body.productId != null ? Number(body.productId) : null;
    // Un cadre que le site ne propose pas ne rentre pas dans le panier : la
    // ligne s'écrit sans lui, au prix de l'affiche seule. Seule une page
    // ouverte AVANT que la boutique ne retire les cadres peut encore en
    // envoyer un ; la réponse le dit (`cadreRetire`), et le site le montre.
    const cadreRetire =
      porteUnCadre(parsed.data) && !(await cadresProposesA(c));
    const config = cadreRetire ? sansCadre(parsed.data) : parsed.data;
    const unitPriceCents = await resolveUnitPriceCents(
      productId,
      config.format,
      config.frameId,
    );
    const item = await db.transaction(async (tx) => {
      // Un panier PAYÉ est clos : y ajouter une ligne reviendrait à glisser
      // un article non réglé dans une commande déjà encaissée. Le navigateur
      // qui a gardé cet identifiant doit repartir d'un panier neuf. De même
      // pour une commande annulée : seuls un panier et une commande en attente
      // de paiement acceptent encore un article (la seconde repasse alors en
      // panier, voir panierModifie).
      const order = await panierModifiable(tx, cartId);
      if (!order) return null;
      const [ligne] = await tx
        .insert(schema.orderItems)
        .values({
          orderId: order.id,
          productId,
          variantId: body.variantId ?? null,
          config,
          title: body.title ?? null,
          unitPriceCents,
          quantity: Math.max(1, Number(body.quantity ?? 1)),
        })
        .returning();
      await panierModifie(tx, order, requeteDuStand(c));
      return ligne;
    });
    if (!item) return c.json({ error: "panier_clos" }, 409);
    return c.json(cadreRetire ? { ...item, cadreRetire } : item);
  });

  /** MODIFIE une ligne existante (réouverture configurateur — §18.3 I). */
  app.put("/cart/:cartId/items/:itemId", async (c) => {
    const itemId = Number(c.req.param("itemId"));
    const body = await c.req.json();
    const parsed = posterConfigSchema.safeParse(body.config);
    if (!parsed.success)
      return c.json({ error: "config invalide", details: parsed.error.issues }, 400);
    // Même règle qu'à l'ajout : sans cadre si le site n'en propose pas. Lue
    // AVANT la transaction — une requête partie par `db` sous le verrou
    // prendrait une seconde connexion du pool (voir Executeur).
    const cadreRetire =
      porteUnCadre(parsed.data) && !(await cadresProposesA(c));
    const config = cadreRetire ? sansCadre(parsed.data) : parsed.data;
    // Contrôle du statut, écriture de la ligne et retour en panier : une
    // seule transaction, sous le verrou de la commande. Contrôlé avant et
    // écrit après, un paiement validé entre les deux laissait une commande
    // payée au prix de l'ancienne ligne.
    const item = await db.transaction(async (tx) => {
      const trouve = await loadCartItem(tx, c.req.param("cartId"), itemId);
      if (!trouve) return null;
      const unitPriceCents = await resolveUnitPriceCents(
        trouve.item.productId,
        config.format,
        config.frameId,
        tx,
      );
      const [ligne] = await tx
        .update(schema.orderItems)
        .set({
          config,
          variantId: body.variantId ?? undefined,
          unitPriceCents,
          quantity:
            body.quantity != null
              ? Math.max(1, Number(body.quantity))
              : undefined,
        })
        .where(eq(schema.orderItems.id, itemId))
        .returning();
      await panierModifie(tx, trouve.order, requeteDuStand(c));
      return ligne ?? null;
    });
    if (!item) return c.notFound();
    return c.json(cadreRetire ? { ...item, cadreRetire } : item);
  });

  /** Supprime une ligne du panier. */
  app.delete("/cart/:cartId/items/:itemId", async (c) => {
    const retiree = await db.transaction(async (tx) => {
      const trouve = await loadCartItem(
        tx,
        c.req.param("cartId"),
        Number(c.req.param("itemId")),
      );
      if (!trouve) return false;
      await tx
        .delete(schema.orderItems)
        .where(eq(schema.orderItems.id, trouve.item.id));
      // Retirer un article est aussi une activité : quelqu'un qui vide à
      // moitié son panier est là, devant l'écran, et n'a rien abandonné du
      // tout.
      await panierModifie(tx, trouve.order, requeteDuStand(c));
      return true;
    });
    if (!retiree) return c.notFound();
    return c.json({ ok: true });
  });

  // === Validation de commande web =========================================

  /**
   * Prépare une commande web à PAYER à partir du panier draft.
   *
   * Attache le client + un numéro, fige le total (promos incluses, calculé
   * SERVEUR) et passe la commande en `pending`. Le PDF et le passage en `paid`
   * ne se font QU'APRÈS encaissement (webhook Stripe / capture PayPal, via
   * markOrderPaid). Une commande n'est donc JAMAIS marquée payée sans paiement.
   *
   * Idempotent : relançable tant que non payée (met à jour client + total,
   * garde le numéro). Renvoie 409 si la commande est déjà payée.
   */
  app.post("/orders", async (c) => {
    const body = await c.req.json();
    const cartId = String(body.cartId ?? "");
    const name = String(body.customer?.name ?? "").trim();
    const email = String(body.customer?.email ?? "").trim();
    if (!name || !email)
      return c.json({ error: "nom et email requis" }, 400);

    const [draft] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.clientOrderId, cartId));
    if (!draft) return c.json({ error: "panier introuvable" }, 404);
    if (draft.status === "paid")
      return c.json({ error: "commande déjà payée" }, 409);

    const items = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, draft.id));
    if (items.length === 0) return c.json({ error: "panier vide" }, 400);

    // Une fiche client par commande : c'est ce que produisait l'INSERT
    // systématique d'avant, et un même client finissait éparpillé en autant de
    // fiches que d'achats. On rattache donc la commande au compte connecté
    // quand il y en a un, sinon à la fiche qui porte déjà cette adresse, et on
    // n'en crée une qu'en dernier recours.
    const connecte = await clientDeLaRequete(c);
    // Commander depuis le site demande un compte. Sans lui, la même personne
    // se retrouvait en autant de fiches que d'achats, sans historique ni
    // carnet d'adresses. Le contrôle est ici et pas seulement à l'écran : une
    // règle qui ne vit que dans la page se contourne en rechargeant.
    if (!connecte)
      return c.json(
        {
          error:
            "Il faut être connectée pour valider la commande. Créez votre compte ou connectez-vous, votre panier vous attend.",
          code: "compte_requis",
        },
        401,
      );
    const emailNormalise = email.toLowerCase();
    let customer = connecte
      ? (
          await db
            .select()
            .from(schema.customers)
            .where(eq(schema.customers.id, connecte.id))
        )[0]
      : (
          await db
            .select()
            .from(schema.customers)
            .where(
              sql`lower(coalesce(${schema.customers.email}, '')) = ${emailNormalise}`,
            )
            .orderBy(schema.customers.id)
        )[0];
    if (!customer) {
      [customer] = await db
        .insert(schema.customers)
        .values({ name, email: emailNormalise })
        .returning();
    } else if (!customer.name && name) {
      // Le nom manquait (fiche importée, commande passée sans) : la commande
      // du jour le fournit, autant le garder.
      [customer] = await db
        .update(schema.customers)
        .set({ name })
        .where(eq(schema.customers.id, customer.id))
        .returning();
    }
    // Garde le numéro s'il en a déjà un (retry) ; sinon en attribue un.
    const number = /^WEB-\d+$/.test(draft.number)
      ? draft.number
      : await nextOrderNumber("web");
    const code = normaliserCode(body.promoCode);

    // Livraison : mode et adresse viennent du client, le prix vient de la
    // base. Sans mode choisi, on refuse — mieux vaut une commande bloquée
    // qu'un colis sans destination.
    const liv = (body.shipping ?? {}) as Record<string, unknown>;
    const modeSlug = String(liv.method ?? "").trim();
    const pays = normaliserPays(liv.country) || "FR";
    if (!modeSlug) return c.json({ error: "mode de livraison requis" }, 400);
    const ligne1 = String(liv.line1 ?? "").trim();
    const ville = String(liv.city ?? "").trim();
    const cp = String(liv.postalCode ?? "").trim();
    // Lu avant la transaction, qui ne doit pas prendre une seconde connexion
    // pendant qu'elle tient le verrou (voir Executeur). Le cookie du stand
    // n'y change rien : c'est la caisse du SITE, le stand a la sienne.
    const cadresSite = await cadresSurLeSite();

    // Le total se calcule SOUS LE VERROU de la commande (commandeVerrouillee),
    // sur les lignes relues dans la même transaction. Une modification du
    // panier partie au même instant passe soit avant — et le total la
    // compte —, soit après — et la commande repasse en panier
    // (panierModifie). Calculé hors verrou, le total d'avant la modification
    // pouvait être figé « en attente », et un paiement ouvert pour lui.
    const resultat = await db.transaction(async (tx) => {
      const panier = await commandeVerrouillee(tx, eq(schema.orders.id, draft.id));
      if (!panier) return { erreur: "panier introuvable", statut: 404 as const };
      if (panier.status === "paid")
        return { erreur: "commande déjà payée", statut: 409 as const };
      const lignes = await tx
        .select()
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, panier.id));
      if (lignes.length === 0)
        return { erreur: "panier vide", statut: 400 as const };

      // Un cadre que le site ne propose plus ne part pas par sa caisse : c'est
      // ici que le réglage protège vraiment, quoi que le navigateur ait gardé
      // (un panier rempli avant le retrait des cadres, une ligne écrite en
      // mode stand). Les cadres sont retirés, prix recalculés, et la commande
      // est REFUSÉE cette fois-ci : la cliente doit voir le nouveau montant
      // avant de payer, pas le découvrir sur son relevé.
      if (!cadresSite && lignes.some((l) => porteUnCadre(l.config))) {
        await retirerLesCadres(tx, panier.id);
        // Faux quoi que dise le cookie : c'est la caisse du SITE (voir plus haut).
        await panierModifie(tx, panier, false);
        return {
          erreur:
            "Les cadres ne sont plus proposés sur le site : nous les avons retirés de votre panier. Vérifiez le nouveau montant, puis validez à nouveau.",
          statut: 409 as const,
          code: "cadres_retires",
        };
      }

      // Une seule heure pour tout le calcul, et c'est elle qui est gardée
      // comme dernière activité : le paiement sera vérifié avec les
      // promotions de CE moment-là (verifierEncaissement).
      const maintenant = new Date();
      const articles = await computeOrderTotalCents(lignes, code, maintenant, tx);
      const port = await computeShippingCents(lignes, modeSlug, pays, code, maintenant, tx);
      if (!port)
        return { erreur: "mode de livraison indisponible", statut: 400 as const };
      // Une livraison à domicile sans adresse n'arrive nulle part ; un point
      // relais sans point relais non plus.
      if (port.kind === "home" && (!ligne1 || !ville || !cp))
        return { erreur: "adresse de livraison incomplète", statut: 400 as const };
      if (port.kind === "relay" && !String(liv.relayPointId ?? "").trim())
        return { erreur: "point relais requis", statut: 400 as const };

      const total = articles + port.cents;
      const [order] = await tx
        .update(schema.orders)
        .set({
          // Relu sous le verrou : un autre passage en caisse du même panier a
          // pu attribuer le numéro entre-temps.
          number: /^WEB-\d+$/.test(panier.number) ? panier.number : number,
          status: "pending",
          customerId: customer!.id,
          totalCents: total,
          promoCode: code || null,
          shippingMethod: modeSlug,
          shippingLabel: port.label,
          shippingCents: port.cents,
          // Poids figé : le catalogue changera, le colis a pesé ce qu'il a pesé.
          weightGrams: port.poidsGrammes,
          shippingName: String(liv.name ?? "").trim() || name,
          shippingLine1: ligne1 || null,
          shippingLine2: String(liv.line2 ?? "").trim() || null,
          shippingPostalCode: cp || null,
          shippingCity: ville || null,
          shippingCountry: pays,
          shippingPhone: String(liv.phone ?? "").trim() || null,
          relayPointId: String(liv.relayPointId ?? "").trim() || null,
          relayPointLabel: String(liv.relayPointLabel ?? "").trim() || null,
          // Le passage au tunnel est LA dernière activité du panier : c'est à
          // partir d'ici que se compte l'inactivité qui en fera un abandon.
          lastActivityAt: maintenant,
          // Passé par la caisse du site, c'est un panier du site : s'il n'est
          // pas payé, c'est ici qu'il a été abandonné, pas au stand.
          panierDuStand: false,
        })
        .where(eq(schema.orders.id, panier.id))
        .returning();
      return { order: order!, port, total };
    });
    if ("erreur" in resultat)
      return c.json(
        {
          error: resultat.erreur,
          ...("code" in resultat ? { code: resultat.code } : {}),
        },
        resultat.statut,
      );
    const { order, port, total } = resultat;

    // L'adresse rejoint le carnet de la cliente : saisie une fois, elle
    // revient toute seule la prochaine fois. Une livraison en point relais n'a
    // pas d'adresse à elle, il n'y a rien à ranger.
    if (port.kind === "home" && ligne1 && ville && cp) {
      try {
        const connues = await db
          .select()
          .from(schema.customerAddresses)
          .where(eq(schema.customerAddresses.customerId, customer!.id));
        const meme = (a: string | null, b: string) =>
          (a ?? "").trim().toLowerCase() === b.trim().toLowerCase();
        const dejaLa = connues.some(
          (a) =>
            meme(a.line1, ligne1) &&
            meme(a.postalCode, cp) &&
            meme(a.city, ville) &&
            meme(a.country ?? "", pays),
        );
        if (!dejaLa) {
          await db.insert(schema.customerAddresses).values({
            customerId: customer!.id,
            label: null,
            name: String(liv.name ?? "").trim() || name,
            line1: ligne1,
            line2: String(liv.line2 ?? "").trim() || null,
            postalCode: cp,
            city: ville,
            country: pays,
            phone: String(liv.phone ?? "").trim() || null,
            // La première adresse enregistrée devient celle par défaut : sans
            // cela le carnet se remplit sans que rien ne soit proposé.
            isDefaultShipping: connues.length === 0,
            isDefaultBilling: false,
          });
        }
      } catch (e) {
        // Le carnet est un confort : une commande valide ne doit pas échouer
        // parce qu'on n'a pas su ranger une adresse.
        console.warn("[commande] adresse non rangée au carnet", String(e));
      }
    }

    return c.json({
      orderId: order.id,
      number: order.number,
      status: order.status,
      totalCents: total,
      shippingCents: port.cents,
      poidsGrammes: port.poidsGrammes,
    });
  });

  // === Paiement (Stripe & PayPal) =========================================

  /**
   * Config paiement exposée au NAVIGATEUR : quels moyens sont réellement
   * activés + les clés PUBLIQUES nécessaires côté client (clé publiable Stripe,
   * client-id PayPal). Évite d'avoir à câbler des PUBLIC_* dans le conteneur
   * web : l'API (qui lit le .env racine) est la source de vérité.
   * Un moyen n'est "prêt" que si SES clés serveur ET publique sont présentes.
   */
  app.get("/payments/config", (c) => {
    const stripePublicKey = process.env.PUBLIC_STRIPE_KEY ?? "";
    const paypalClientId =
      process.env.PUBLIC_PAYPAL_CLIENT_ID ?? process.env.PAYPAL_CLIENT_ID ?? "";
    // La boutique tourne-t-elle en mode ESSAI ? Une clé Stripe de test se
    // reconnaît à son préfixe, et PayPal le dit dans son réglage. Le tunnel
    // s'en sert pour rappeler quoi saisir : sans ce rappel, on cherche un
    // numéro de carte d'essai à chaque fois, et on finit par se demander si
    // c'est la boutique qui est cassée.
    const essai =
      stripePublicKey.startsWith("pk_test") ||
      (process.env.PAYPAL_ENV ?? "").trim().toLowerCase() !== "live";
    return c.json({
      stripe:
        stripeConfigured && stripePublicKey
          ? { publicKey: stripePublicKey }
          : null,
      paypal:
        paypalConfigured && paypalClientId ? { clientId: paypalClientId } : null,
      essai,
    });
  });

  /** Charge une commande à payer (existe, non déjà payée). */
  async function loadPayableOrder(orderId: number) {
    if (!Number.isFinite(orderId)) return null;
    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId));
    return order ?? null;
  }

  /**
   * Un paiement ne s'ouvre que pour une commande EN ATTENTE, c'est-à-dire
   * sortie de la caisse à l'instant, total fraîchement calculé.
   *
   * Un panier (« draft ») n'a pas de total fiable : soit il n'est jamais passé
   * en caisse, soit il a été modifié depuis (panierModifie). Ouvrir un
   * paiement pour lui, c'était encaisser un montant d'avant la modification.
   */
  const PANIER_A_REVALIDER =
    "Votre panier a changé depuis le calcul du total. Revenez à l'étape précédente pour le recalculer avant de payer.";

  /**
   * Crée un PaymentIntent Stripe pour la commande et renvoie son clientSecret
   * (le navigateur confirme le paiement avec Stripe.js). Le montant vient du
   * SERVEUR (order.totalCents), jamais du client.
   */
  app.post("/payments/stripe/intent", async (c) => {
    if (!stripeConfigured)
      return c.json({ error: "Stripe non configuré" }, 503);
    const body = await c.req.json().catch(() => ({}));
    const order = await loadPayableOrder(Number(body.orderId));
    if (!order) return c.json({ error: "commande introuvable" }, 404);
    if (order.status === "paid")
      return c.json({ error: "commande déjà payée" }, 409);
    if (order.status !== "pending")
      return c.json({ error: PANIER_A_REVALIDER, code: "panier_modifie" }, 409);
    try {
      const intent = await createStripeIntent(
        order.totalCents,
        order.id,
        order.number,
      );
      await db.insert(schema.payments).values({
        orderId: order.id,
        provider: "stripe",
        externalRef: intent.id,
        status: "pending",
        amountCents: order.totalCents,
      });
      return c.json({ clientSecret: intent.clientSecret });
    } catch (e) {
      console.error("Stripe intent:", e);
      return c.json({ error: "création du paiement impossible" }, 502);
    }
  });

  /**
   * Webhook Stripe : source de vérité de l'encaissement. Vérifie la signature
   * sur le corps BRUT, et sur `payment_intent.succeeded` passe la commande en
   * payée + génère les PDF (idempotent).
   */
  app.post("/payments/stripe/webhook", async (c) => {
    const raw = await c.req.text();
    const event = verifyStripeEvent(raw, c.req.header("stripe-signature"));
    if (!event) return c.json({ error: "signature invalide" }, 400);
    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object as {
        id: string;
        amount_received?: number;
        currency?: string;
        metadata?: { orderId?: string };
      };
      const orderId = Number(pi.metadata?.orderId);
      if (Number.isFinite(orderId)) {
        try {
          // Le montant vient de l'événement signé : c'est ce que Stripe a
          // réellement pris, pas ce que la commande croyait demander.
          await markOrderPaid(orderId, "stripe", pi.id, {
            montantCents: Number(pi.amount_received ?? 0),
            devise: String(pi.currency ?? ""),
          });
        } catch (e) {
          // Un écart est déjà écrit au journal de la commande. Répondre en
          // erreur ferait rejouer l'avis par Stripe pendant trois jours, pour
          // la même conclusion.
          if (!(e instanceof MontantEncaisseDifferent)) throw e;
        }
      }
    }
    return c.json({ received: true });
  });

  /**
   * Confirme un paiement Stripe DEPUIS LE SERVEUR (revérifie le statut du
   * PaymentIntent auprès de Stripe) et marque la commande payée si succeeded.
   * Appelé par le navigateur juste après confirmPayment : permet de finaliser
   * SANS webhook (dev) et sert de filet si le webhook n'arrive pas.
   */
  app.post("/payments/stripe/confirm", async (c) => {
    if (!stripeConfigured)
      return c.json({ error: "Stripe non configuré" }, 503);
    const body = await c.req.json().catch(() => ({}));
    const orderId = Number(body.orderId);
    const [payment] = await db
      .select()
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.orderId, orderId),
          eq(schema.payments.provider, "stripe"),
        ),
      )
      .orderBy(desc(schema.payments.id));
    if (!payment?.externalRef)
      return c.json({ error: "paiement introuvable" }, 404);
    try {
      const intent = await getStripeIntent(payment.externalRef);
      if (intent.status === "succeeded") {
        await markOrderPaid(orderId, "stripe", payment.externalRef, {
          montantCents: intent.montantCents,
          devise: intent.devise,
        });
        return c.json({ status: "paid" });
      }
      return c.json({ status: intent.status }, 202);
    } catch (e) {
      if (e instanceof MontantEncaisseDifferent)
        return c.json({ error: e.message, code: "montant_different" }, 409);
      console.error("Stripe confirm:", e);
      return c.json({ error: "vérification impossible" }, 502);
    }
  });

  /**
   * Crée une commande PayPal (montant serveur) à approuver côté navigateur.
   * Renvoie l'id PayPal. La capture (encaissement) se fait ensuite via
   * /payments/paypal/capture.
   */
  app.post("/payments/paypal/order", async (c) => {
    if (!paypalConfigured)
      return c.json({ error: "PayPal non configuré" }, 503);
    const body = await c.req.json().catch(() => ({}));
    const order = await loadPayableOrder(Number(body.orderId));
    if (!order) return c.json({ error: "commande introuvable" }, 404);
    if (order.status === "paid")
      return c.json({ error: "commande déjà payée" }, 409);
    if (order.status !== "pending")
      return c.json({ error: PANIER_A_REVALIDER, code: "panier_modifie" }, 409);
    try {
      const paypalOrderId = await createPaypalOrder(
        order.totalCents,
        order.number,
      );
      await db.insert(schema.payments).values({
        orderId: order.id,
        provider: "paypal",
        externalRef: paypalOrderId,
        status: "pending",
        amountCents: order.totalCents,
      });
      return c.json({ paypalOrderId });
    } catch (e) {
      console.error("PayPal order:", e);
      // La raison vient de PayPal et parle de la BOUTIQUE, pas du client :
      // elle part dans un champ à part, que le journal et le back-office
      // lisent. Le client, lui, garde une phrase qui le concerne.
      const refus = e instanceof RefusPaypal ? e : null;
      return c.json(
        {
          error:
            "Le paiement par PayPal n'a pas pu être ouvert. Essayez la carte bancaire, ou revenez dans quelques minutes.",
          ...(refus ? { raison: refus.explication, code: refus.issue } : {}),
        },
        502,
      );
    }
  });

  /**
   * Capture une commande PayPal approuvée. On vérifie que le `paypalOrderId`
   * appartient bien à cette commande (ligne payment), puis on capture : si
   * COMPLETED, la commande passe en payée + PDF (markOrderPaid).
   */
  app.post("/payments/paypal/capture", async (c) => {
    if (!paypalConfigured)
      return c.json({ error: "PayPal non configuré" }, 503);
    const body = await c.req.json().catch(() => ({}));
    const orderId = Number(body.orderId);
    const paypalOrderId = String(body.paypalOrderId ?? "");
    const [payment] = await db
      .select()
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.orderId, orderId),
          eq(schema.payments.externalRef, paypalOrderId),
        ),
      );
    if (!payment)
      return c.json({ error: "paiement introuvable pour cette commande" }, 404);

    // AVANT de capturer : PayPal, lui, permet de vérifier avant que l'argent
    // ne bouge. Le paiement a été ouvert pour `payment.amountCents` ; si la
    // commande ne vaut plus cela — panier modifié entre-temps —, on ne capture
    // pas, et la cliente n'est pas débitée d'un montant faux.
    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId));
    if (order?.status === "paid") {
      // Payée par CE paiement : la capture a abouti et le navigateur la
      // redemande, c'est déjà fait. Par un autre : capturer celui-ci ferait
      // payer la cliente deux fois, pour un remboursement à faire ensuite.
      if (payment.status === "succeeded") return c.json({ status: "paid" });
      return c.json({ error: "commande déjà payée" }, 409);
    }
    if (order) {
      // Lecture sans verrou : ce contrôle évite de débiter un montant faux
      // dans le cas courant. Celui qui fait foi, sous verrou, vient après la
      // capture (markOrderPaid).
      const valeur = await valeurDesLignes(order, order.lastActivityAt ?? new Date());
      if (
        order.status !== "pending" ||
        !valeur.livrable ||
        valeur.totalCents !== payment.amountCents
      )
        return c.json({ error: PANIER_A_REVALIDER, code: "panier_modifie" }, 409);
    }

    try {
      const cap = await capturePaypalOrder(paypalOrderId);
      if (!cap.ok)
        return c.json({ error: "paiement non complété", status: cap.status }, 402);
      // L'identifiant de la CAPTURE, gardé tout de suite : c'est le seul que
      // PayPal accepte de rembourser, et on ne le reverra plus dans la suite
      // de la conversation.
      if (cap.captureId)
        await db
          .update(schema.payments)
          .set({ captureRef: cap.captureId })
          .where(eq(schema.payments.id, payment.id));
      // Et APRÈS : c'est le montant réellement capturé qui décide.
      await markOrderPaid(orderId, "paypal", paypalOrderId, {
        montantCents: cap.montantCents,
        devise: cap.devise,
      });
      return c.json({ status: "paid" });
    } catch (e) {
      if (e instanceof MontantEncaisseDifferent)
        return c.json({ error: e.message, code: "montant_different" }, 409);
      console.error("PayPal capture:", e);
      return c.json({ error: "encaissement impossible" }, 502);
    }
  });

  /** Détail d'une commande + ses lignes (pour la fiche BO et les liens PDF). */
  app.get("/admin/orders/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, id));
    if (!order) return c.notFound();
    // Un vendeur ne lit que les ventes du stand. Sans cette ligne, il lui
    // suffisait de compter de un en un : les identifiants se suivent, et la
    // fiche rend tout, y compris l'adresse postale de la cliente.
    // « Introuvable » plutôt que « interdit » : répondre 403 confirmerait que
    // la commande existe.
    if (!commandeVisiblePar(c, order.channel)) return c.notFound();
    const items = await db
      .select({
        id: schema.orderItems.id,
        title: schema.orderItems.title,
        productId: schema.orderItems.productId,
        quantity: schema.orderItems.quantity,
        unitPriceCents: schema.orderItems.unitPriceCents,
        config: schema.orderItems.config,
        format: sql<string>`(${schema.orderItems.config} ->> 'format')`,
      })
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, id));
    const [customer] = order.customerId
      ? await db
          .select()
          .from(schema.customers)
          .where(eq(schema.customers.id, order.customerId))
      : [];

    // Le cadre choisi, en toutes lettres : la configuration n'en garde que
    // l'identifiant, illisible sur une fiche de préparation.
    const cadres = await db.select().from(schema.frames);
    const enrichies = items.map((it) => {
      const cfg = (it.config ?? {}) as Record<string, unknown>;
      // Les lignes réellement écrites, dans l'ordre. Passer par `lignesRemplies`
      // et jamais par `texts.title` : une commande de l'an dernier ne porte pas
      // encore de `lines`, elle sortirait vide de la fiche de préparation.
      const lignes = lignesRemplies(cfg.texts as TextesAffiche | undefined).map(
        (l) => l.value.trim(),
      );
      const cadre = cadres.find(
        (f) => String(f.id) === String(cfg.frameId ?? ""),
      );
      return {
        id: it.id,
        title: it.title,
        productId: it.productId,
        quantity: it.quantity,
        unitPriceCents: it.unitPriceCents,
        format: it.format,
        cadre: cadre?.name ?? null,
        lignesAffiche: lignes,
        // Les deux anciens champs restent servis tant que le back-office ne
        // les a pas lâchés — ils ne sont plus qu'une vue des deux premières
        // lignes, et disparaîtront avec le dernier gabarit qui les lit.
        titreAffiche: lignes[0] ?? null,
        sousTitreAffiche: lignes[1] ?? null,
        personnages: Array.isArray(cfg.characters) ? cfg.characters.length : 0,
        // L'aperçu de la ligne, rendu par le même moteur que le fichier
        // d'impression : ce qu'on regarde ici est ce qui part à l'atelier.
        // Adresse relative, signée ; le back-office la préfixe.
        apercu: cheminApercu(it.id),
      };
    });

    // Paiements enregistrés : c'est là qu'on lit ce qui a réellement été
    // encaissé, et par quel moyen.
    const paiements = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.orderId, id));

    // Combien de commandes ce client a-t-il passées ? Une fiche client
    // minimale, mais c'est la question qu'on se pose en le lisant.
    const [autres] = order.customerId
      ? await db
          .select({ n: count() })
          .from(schema.orders)
          .where(eq(schema.orders.customerId, order.customerId))
      : [];

    const journal = await db
      .select()
      .from(schema.orderEvents)
      .where(eq(schema.orderEvents.orderId, id))
      .orderBy(desc(schema.orderEvents.createdAt));

    // Expéditions, remboursements et grand livre : ce sont eux qui portent
    // les statuts affichés, jamais un champ figé sur la commande.
    const expeditions = await db
      .select()
      .from(schema.fulfillments)
      .where(eq(schema.fulfillments.orderId, id))
      .orderBy(desc(schema.fulfillments.createdAt));
    const lignesExpediees = expeditions.length
      ? await db
          .select()
          .from(schema.fulfillmentItems)
          .where(
            inArray(
              schema.fulfillmentItems.fulfillmentId,
              expeditions.map((f) => f.id),
            ),
          )
      : [];
    const remboursements = await db
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.orderId, id))
      .orderBy(desc(schema.refunds.createdAt));
    const lignesRemboursees = remboursements.length
      ? await db
          .select()
          .from(schema.refundItems)
          .where(
            inArray(
              schema.refundItems.refundId,
              remboursements.map((r) => r.id),
            ),
          )
      : [];
    const mouvements = await db
      .select()
      .from(schema.orderTransactions)
      .where(eq(schema.orderTransactions.orderId, id))
      .orderBy(desc(schema.orderTransactions.createdAt));

    const resume = (await resumeCommandes([id])).get(id)!;

    // Ce qui reste à faire, ligne par ligne : la fiche s'en sert pour
    // pré-remplir l'expédition et le remboursement sans recalculer côté BO.
    const partiParLigne = new Map<number, number>();
    for (const l of lignesExpediees) {
      const f = expeditions.find((e) => e.id === l.fulfillmentId);
      if (f?.status !== "success") continue;
      partiParLigne.set(
        l.orderItemId,
        (partiParLigne.get(l.orderItemId) ?? 0) + l.quantity,
      );
    }
    const renduParLigne = new Map<number, number>();
    for (const l of lignesRemboursees)
      renduParLigne.set(
        l.orderItemId,
        (renduParLigne.get(l.orderItemId) ?? 0) + l.quantity,
      );
    const avecRestes = enrichies.map((it) => ({
      ...it,
      expedie: partiParLigne.get(it.id) ?? 0,
      rembourse: renduParLigne.get(it.id) ?? 0,
      aExpedier: it.quantity - (partiParLigne.get(it.id) ?? 0),
      aRembourser: it.quantity - (renduParLigne.get(it.id) ?? 0),
    }));

    const portRendu = remboursements.reduce((s, r) => s + r.shippingCents, 0);

    return c.json({
      order,
      customer: customer ?? null,
      items: avecRestes,
      paiements,
      journal,
      expeditions: expeditions.map((f) => ({
        ...f,
        lignes: lignesExpediees.filter((l) => l.fulfillmentId === f.id),
      })),
      remboursements: remboursements.map((r) => ({
        ...r,
        lignes: lignesRemboursees.filter((l) => l.refundId === r.id),
      })),
      mouvements,
      statutFinancier: statutFinancier(order, resume.rembourseCents),
      statutExpedition: statutExpedition(resume.articles, resume.expedies),
      rembourseCents: resume.rembourseCents,
      portRemboursableCents: Math.max(0, order.shippingCents - portRendu),
      commandesDuClient: Number(autres?.n ?? 0),
    });
  });

  // Les paniers abandonnés et leur relance ont leur propre fichier
  // (apps/api/src/relance-panier.ts) : les trois critères d'abandon, les
  // cinq gardes-fous, le travailleur d'envoi et le lien de récupération y
  // vivent ensemble. Ce qui reste ici, c'est ce qui les alimente : l'horloge
  // d'activité du panier, et la date de récupération posée au paiement.

  /** Renvoie la confirmation d'une commande payée. */
  app.post("/admin/orders/:id/renvoyer-confirmation", async (c) => {
    const id = Number(c.req.param("id"));
    if (!mailConfigure())
      return c.json({ error: "envoi d'e-mails non configuré" }, 503);
    // Une commande de stand n'a pas de confirmation : le courrier porterait
    // le tarif du site, que le stand cache justement — c'est la vendeuse qui
    // a annoncé le prix, de vive voix.
    const [commande] = await db
      .select({ channel: schema.orders.channel })
      .from(schema.orders)
      .where(eq(schema.orders.id, id));
    if (commande?.channel === "salon")
      return c.json(
        { error: "Pas de confirmation par e-mail pour une commande prise au stand." },
        400,
      );
    await previenirDuPaiement(id);
    return c.json({ ok: true });
  });

  /** Ajoute un commentaire au journal d'une commande. */
  app.post("/admin/orders/:id/comment", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json().catch(() => ({}));
    const message = String(b.message ?? "").trim();
    if (!message) return c.json({ error: "message vide" }, 400);
    const [row] = await db
      .insert(schema.orderEvents)
      .values({
        orderId: id,
        kind: "comment",
        message: message.slice(0, 2000),
        author: String(b.author ?? "").trim() || null,
      })
      .returning();
    return c.json(row);
  });

  /** Enregistre la note interne d'une commande. */
  app.post("/admin/orders/:id/note", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json().catch(() => ({}));
    const [row] = await db
      .update(schema.orders)
      .set({ internalNote: String(b.note ?? "").trim() || null })
      .where(eq(schema.orders.id, id))
      .returning({ id: schema.orders.id, internalNote: schema.orders.internalNote });
    if (!row) return c.notFound();
    return c.json(row);
  });

  // === Téléchargement PDF (BO uniquement — §12) ============================

  /**
   * Renvoie le PDF d'une ligne de commande, régénéré à la demande depuis le
   * snapshot (idempotent). Disponible pour TOUTE commande, même ancienne.
   * C'est la cliente qui télécharge/imprime (depuis le BO ou l'app salon).
   *
   * PROTÉGÉ : l'id de ligne est un entier séquentiel — en accès libre, il
   * suffisait de l'incrémenter pour aspirer les affiches de tous les clients.
   */
  app.get("/admin/print-files/:orderItemId", async (c) => {
    const itemId = Number(c.req.param("orderItemId"));
    const [item] = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.id, itemId));
    if (!item || !item.config) return c.notFound();
    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, item.orderId));
    // Même règle que pour la fiche : l'affiche d'une cliente du site, avec son
    // nom dans le nom de fichier, n'est pas à portée d'un compte de stand.
    if (!commandeVisiblePar(c, order?.channel)) return c.notFound();
    const [customer] = order?.customerId
      ? await db
          .select()
          .from(schema.customers)
          .where(eq(schema.customers.id, order.customerId))
      : [];
    const cfg = item.config as PosterConfig;
    const fmt = (cfg.format ?? "A4") as "A4" | "A3";
    // Rangé au paiement, le fichier part aussitôt ; sinon il se fabrique ici.
    let pdf: Buffer;
    try {
      pdf = await fichierDImpression(itemId, cfg);
    } catch (e) {
      console.error(`[impression] ligne ${itemId} :`, e);
      return c.json(
        { error: `Fichier d'impression impossible à fabriquer : ${(e as Error).message}` },
        500,
      );
    }
    // Le nom retenu au moment de la commande fait foi : le fichier téléchargé
    // aujourd'hui doit s'appeler comme celui rangé le jour de l'impression,
    // même si le cadre a été renommé entre-temps.
    const nomRetenu = () =>
      db
        .select({ filename: schema.printFiles.filename })
        .from(schema.printFiles)
        .where(eq(schema.printFiles.orderItemId, itemId));
    let [fichier] = await nomRetenu();
    // Une commande payée sans nom retenu — vente du stand d'avant qu'on les
    // enregistre, commande reprise — reçoit les noms de TOUTES ses lignes
    // maintenant, dans leur ordre, numérotation comprise : recalculé ici à
    // chaque clic, le nom de deux affiches identiques était le même.
    if (!fichier && order?.status === "paid") {
      await enregistrerFichiersDImpression(item.orderId, { preparer: false });
      [fichier] = await nomRetenu();
    }
    const [cadre] = cfg.frameId
      ? await db
          .select({ name: schema.frames.name })
          .from(schema.frames)
          .where(eq(schema.frames.id, Number(cfg.frameId)))
      : [];
    const filename =
      fichier?.filename ??
      `${slugifyName(customer?.name ?? "client")}_${fmt}_${suffixeCadre(cadre?.name)}.pdf`;
    return c.body(new Uint8Array(pdf), 200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    });
  });

  // === CRUD personnages / assets (BO, protégé /admin/*) ===================

  /** Liste complète (BO) : types + assets, archivés inclus, pour la gestion. */
  app.get("/admin/characters", async (c) => {
    /*
     * Les trois listes partent ENSEMBLE : aucune n'a besoin des autres.
     *
     * La base est à 110 ms d'aller-retour (Neon, Ohio). Enchaînées, ces trois
     * requêtes coûtaient une demi-seconde d'attente pure pour un écran qui
     * n'affiche que des listes. Ensemble, elles en coûtent une seule.
     */
    const [types, assets, categories] = await Promise.all([
      db
        .select()
        .from(schema.characterTypes)
        .orderBy(
          asc(schema.characterTypes.position),
          asc(schema.characterTypes.name),
        ),
      db.select().from(schema.assets).orderBy(asc(schema.assets.position)),
      db
        .select()
        .from(schema.characterCategories)
        .orderBy(asc(schema.characterCategories.position)),
    ]);
    return c.json({ types, assets, categories });
  });

  // === Catégories de personnages (BO) =====================================

  /**
   * Catégories, avec le nombre de personnages non archivés dans chacune.
   *
   * Les catégories ARCHIVÉES viennent avec, marquées par leur `archivedAt` :
   * l'écran les range dans sa section « Catégories archivées » sans redemander
   * la liste.
   */
  app.get("/admin/categories", async (c) => {
    const rows = await db
      .select({
        id: schema.characterCategories.id,
        slug: schema.characterCategories.slug,
        name: schema.characterCategories.name,
        position: schema.characterCategories.position,
        archivedAt: schema.characterCategories.archivedAt,
        count: sql<number>`count(${schema.characterTypes.id})::int`,
      })
      .from(schema.characterCategories)
      .leftJoin(
        schema.characterTypes,
        and(
          eq(schema.characterTypes.categoryId, schema.characterCategories.id),
          isNull(schema.characterTypes.archivedAt),
        ),
      )
      .groupBy(schema.characterCategories.id)
      .orderBy(asc(schema.characterCategories.position));
    return c.json(rows);
  });

  /** Crée une catégorie, ou renomme / réordonne une catégorie existante. */
  app.post("/admin/categories", async (c) => {
    const b = await c.req.json();
    const name = String(b.name ?? "").trim();
    if (!name) return c.json({ error: "nom requis" }, 400);

    if (b.id) {
      const [row] = await db
        .update(schema.characterCategories)
        .set({
          name,
          ...(b.position != null ? { position: Number(b.position) } : {}),
        })
        .where(eq(schema.characterCategories.id, Number(b.id)))
        .returning();
      if (!row) return c.notFound();
      return c.json(row);
    }

    // Slug dérivé du nom, suffixé si déjà pris (deux catégories peuvent
    // porter des noms proches : « Bébés » et « Bebes »).
    const base =
      name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "categorie";
    const taken = new Set(
      (
        await db
          .select({ slug: schema.characterCategories.slug })
          .from(schema.characterCategories)
      ).map((r) => r.slug),
    );
    let slug = base;
    for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;

    const [{ max } = { max: -1 }] = await db
      .select({ max: sql<number>`coalesce(max(${schema.characterCategories.position}), -1)::int` })
      .from(schema.characterCategories);
    const [row] = await db
      .insert(schema.characterCategories)
      .values({ slug, name, position: (max ?? -1) + 1 })
      .returning();
    return c.json(row);
  });

  /**
   * Archive une catégorie de personnages, ou la restaure.
   *
   * La suppression définitive a été RETIRÉE. Elle passait pour anodine — les
   * personnages survivaient — mais elle emportait la COMPOSITION du rayon : la
   * clé étrangère en ON DELETE SET NULL vidait le `category_id` de chacun, et
   * une trentaine de personnages se retrouvaient en vrac dans « sans
   * catégorie ». Les recoller un à un était le seul retour en arrière.
   *
   * Archivée, la catégorie garde ses personnages : ils restent proposés dans
   * le configurateur, simplement rangés sous « sans catégorie » le temps de
   * l'archivage, et « Restaurer » rend le rayon tel qu'il était. `dedans` dit
   * combien elle en range, pour que l'écran puisse le redire.
   */
  app.post("/admin/categories/:id/archive", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.notFound();
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    // Défaut : on archive. Seul un « archived: false » explicite restaure.
    const archiver = b.archived !== false;

    const [row] = await db
      .update(schema.characterCategories)
      .set({ archivedAt: archiver ? new Date() : null })
      .where(eq(schema.characterCategories.id, id))
      .returning({ archivedAt: schema.characterCategories.archivedAt });
    if (!row) return c.notFound();

    const [compte] = await db
      .select({ n: count() })
      .from(schema.characterTypes)
      .where(
        and(
          eq(schema.characterTypes.categoryId, id),
          isNull(schema.characterTypes.archivedAt),
        ),
      );

    return c.json({
      ok: true,
      archived: row.archivedAt != null,
      dedans: Number(compte?.n ?? 0),
    });
  });

  /**
   * Affecte un LOT de personnages à une catégorie (vue liste à cocher du BO).
   * `characterIds` = la liste COMPLÈTE des personnages cochés : ceux qui n'y
   * figurent plus et appartenaient à cette catégorie en sortent.
   */
  app.post("/admin/categories/:id/characters", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json();
    const ids = Array.isArray(b.characterIds)
      ? b.characterIds.map(Number).filter(Number.isFinite)
      : [];

    const [category] = await db
      .select()
      .from(schema.characterCategories)
      .where(eq(schema.characterCategories.id, id));
    if (!category) return c.notFound();
    // On peut toujours VIDER une catégorie archivée — c'est du ménage. Y
    // cocher des personnages, non : la catégorie étant rangée, ils s'y
    // rangeraient sans que le configurateur montre le moindre rayon.
    if (ids.length && category.archivedAt)
      return c.json(
        {
          error:
            "Cette catégorie est archivée. Restaurez-la avant d'y ranger des personnages.",
        },
        400,
      );

    // Sortie : les persos actuellement dans la catégorie et plus cochés.
    const detached = await db
      .update(schema.characterTypes)
      .set({ categoryId: null })
      .where(
        ids.length
          ? and(
              eq(schema.characterTypes.categoryId, id),
              notInArray(schema.characterTypes.id, ids),
            )
          : eq(schema.characterTypes.categoryId, id),
      )
      .returning({ id: schema.characterTypes.id });

    // Entrée : tous les persos cochés rejoignent la catégorie.
    const attached = ids.length
      ? await db
          .update(schema.characterTypes)
          .set({ categoryId: id })
          .where(inArray(schema.characterTypes.id, ids))
          .returning({ id: schema.characterTypes.id })
      : [];

    return c.json({
      category: category.name,
      attached: attached.length,
      detached: detached.length,
    });
  });

  /** Crée ou met à jour un type (nom, catégorie, position, dessin). */
  app.post("/admin/characters", async (c) => {
    const b = await c.req.json();
    const values = {
      name: String(b.name ?? "Type"),
      // La catégorie est désormais une référence ; `category` (texte) n'est
      // plus écrit, il ne subsiste que le temps de la bascule.
      ...(b.categoryId !== undefined
        ? { categoryId: b.categoryId == null ? null : Number(b.categoryId) }
        : {}),
      position: Number(b.position ?? 0),
      ...(b.orientation !== undefined
        ? { orientation: (await typeAfficheValide(b.orientation)) ?? "front" }
        : {}),
      // Calage vertical (0..1) : editable depuis le BO en plus de la mesure
      // automatique, pour les persos dont les pieds tombent mal.
      ...(b.bottomPct !== undefined && Number.isFinite(Number(b.bottomPct))
        ? { bottomPct: Math.min(1, Math.max(0.05, Number(b.bottomPct))) }
        : {}),
      // Taille propre au personnage. Bornée : en dessous de 0,3 il devient
      // illisible, au-delà de 2 il déborde de l'affiche.
      ...(b.facteurTaille !== undefined && Number.isFinite(Number(b.facteurTaille))
        ? { facteurTaille: Math.min(2, Math.max(0.3, Number(b.facteurTaille))) }
        : {}),
      // Le décalage de côté. Borné à 40 % de la largeur : au-delà, un
      // personnage placé en bout de rangée sortirait de l'affiche.
      ...(b.decalageX !== undefined && Number.isFinite(Number(b.decalageX))
        ? { decalageX: Math.min(0.4, Math.max(-0.4, Number(b.decalageX))) }
        : {}),
      // Dessin et couleurs, pour créer un personnage complet d'un coup depuis
      // le back-office. Absents : on ne touche pas à ce qui existe.
      ...(b.baseSvgUrl !== undefined
        ? { baseSvgUrl: b.baseSvgUrl ? String(b.baseSvgUrl) : null }
        : {}),
      ...(b.baseColorZones !== undefined
        ? { baseColorZones: zonesPropres(b.baseColorZones) }
        : {}),
      // Groupes de couleurs lus au téléversement. Ils ne valent qu'avec les
      // zones du même dessin, envoyées avec eux : sans elles, on ne saurait
      // pas contre quoi les vérifier, et on n'y touche pas.
      ...(b.baseColorZones !== undefined && b.baseGroupesCouleurs !== undefined
        ? {
            baseGroupesCouleurs: groupesPropres(
              b.baseGroupesCouleurs,
              zonesPropres(b.baseColorZones),
            ),
          }
        : {}),
      ...(b.baseColorZones !== undefined && b.baseZonesProposees !== undefined
        ? {
            baseZonesProposees: Array.isArray(b.baseZonesProposees)
              ? zonesMasqueesPropres(b.baseZonesProposees, zonesPropres(b.baseColorZones))
              : null,
          }
        : {}),
      // Familles de couleurs, quand le dessin téléversé est une image en
      // pixels. Elles ne dépendent d'aucune zone : elles valent seules.
      ...(b.baseCouleursImage !== undefined
        ? { baseCouleursImage: couleursImagePropres(b.baseCouleursImage) }
        : {}),
    };
    if (b.id) {
      const [row] = await db
        .update(schema.characterTypes)
        .set(values)
        .where(eq(schema.characterTypes.id, Number(b.id)))
        .returning();
      return c.json(row);
    }
    // Slug : accents retirés et unicité vérifiée. Deux personnages du même
    // nom (« Ours », puis « Ours » à nouveau) butaient sinon sur l'index
    // unique, et la création échouait sans rien expliquer.
    const base =
      String(b.slug ?? b.name ?? "type")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "personnage";
    const pris = new Set(
      (
        await db
          .select({ slug: schema.characterTypes.slug })
          .from(schema.characterTypes)
      ).map((r) => r.slug),
    );
    let slug = base;
    for (let i = 2; pris.has(slug); i++) slug = `${base}-${i}`;
    const [row] = await db
      .insert(schema.characterTypes)
      .values({ ...values, slug })
      .returning();
    return c.json(row);
  });

  /** Archive (soft-delete) ou désarchive un type — §18.1 A. */
  app.post("/admin/characters/:id/archive", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json().catch(() => ({}));
    const archived = b.archived !== false; // défaut: archive
    const [row] = await db
      .update(schema.characterTypes)
      .set({ archivedAt: archived ? new Date() : null })
      .where(eq(schema.characterTypes.id, id))
      .returning();
    if (!row) return c.notFound();
    return c.json(row);
  });

  /** Réordonne des types (drag & drop) : liste d'{id, position, category?}. */
  /**
   * Déplace un LOT de personnages vers une catégorie — ou hors catégorie
   * (`categoryId: null`, le groupe « sans catégorie »).
   *
   * Distinct de POST /admin/categories/:id/characters, qui REMPLACE la
   * composition d'une catégorie : ici on ne touche qu'aux personnages cités,
   * et une route dédiée évite d'écraser au passage nom, position ou
   * orientation comme le ferait un upsert partiel.
   */
  app.post("/admin/characters/category", async (c) => {
    const b = await c.req.json();
    const ids = Array.isArray(b.ids)
      ? b.ids.map(Number).filter(Number.isFinite)
      : [];
    if (!ids.length) return c.json({ error: "aucun personnage" }, 400);
    const categoryId =
      b.categoryId == null || b.categoryId === "" ? null : Number(b.categoryId);

    if (categoryId != null) {
      const [cat] = await db
        .select({
          id: schema.characterCategories.id,
          archivedAt: schema.characterCategories.archivedAt,
        })
        .from(schema.characterCategories)
        .where(eq(schema.characterCategories.id, categoryId));
      if (!cat) return c.json({ error: "catégorie inconnue" }, 404);
      // On peut toujours en SORTIR un lot (`categoryId: null`), mais pas le
      // ranger dans un rayon rangé : le configurateur n'en montrerait rien.
      if (cat.archivedAt)
        return c.json(
          {
            error:
              "Cette catégorie est archivée. Restaurez-la avant d'y ranger des personnages.",
          },
          400,
        );
    }

    const moved = await db
      .update(schema.characterTypes)
      .set({ categoryId })
      .where(inArray(schema.characterTypes.id, ids))
      .returning({ id: schema.characterTypes.id });
    return c.json({ ok: true, moved: moved.length });
  });

  /**
   * Pièces AUTORISÉES pour un personnage, emplacement par emplacement.
   *
   * `slotVariants` stocke des POSITIONS de pièces génériques, pas des ids :
   * elles restent stables d'un ré-import à l'autre, alors que les ids
   * changent. On enregistre donc ce que le back-office coche, converti en
   * positions.
   *
   * Un emplacement absent du corps n'est pas touché. Un emplacement à liste
   * VIDE signifie « aucune pièce » — c'est différent de `slotVariants` nul,
   * qui veut dire « pas encore paramétré, on propose tout ».
   */
  app.post("/admin/characters/:id/slot-variants", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json();
    const [perso] = await db
      .select({ slotVariants: schema.characterTypes.slotVariants })
      .from(schema.characterTypes)
      .where(eq(schema.characterTypes.id, id));
    if (!perso) return c.notFound();

    const SLOTS = ["clothes", "pants", "hair", "accessory"] as const;
    const suivant: Record<string, number[]> = {
      ...((perso.slotVariants ?? {}) as Record<string, number[]>),
    };
    for (const slot of SLOTS) {
      const recu = (b as Record<string, unknown>)[slot];
      if (recu === undefined) continue;
      suivant[slot] = Array.isArray(recu)
        ? [...new Set(recu.map(Number).filter(Number.isFinite))].sort(
            (x, y) => x - y,
          )
        : [];
    }

    const [row] = await db
      .update(schema.characterTypes)
      .set({ slotVariants: suivant })
      .where(eq(schema.characterTypes.id, id))
      .returning({ slotVariants: schema.characterTypes.slotVariants });
    return c.json({ ok: true, slotVariants: row?.slotVariants ?? {} });
  });

  /**
   * Calage des pièces sur un personnage, emplacement par emplacement.
   *
   * Même principe que les pièces autorisées : un emplacement absent du corps
   * de la requête n'est pas touché, et un calage neutre est effacé plutôt que
   * stocké — inutile d'alourdir la config d'un personnage qui n'a rien à
   * rattraper.
   */
  app.post("/admin/characters/:id/slot-adjust", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json();
    const [perso] = await db
      .select({ slotAdjust: schema.characterTypes.slotAdjust })
      .from(schema.characterTypes)
      .where(eq(schema.characterTypes.id, id));
    if (!perso) return c.notFound();

    const suivant: Record<string, { dx: number; dy: number; scale: number }> = {
      ...((perso.slotAdjust ?? {}) as Record<
        string,
        { dx: number; dy: number; scale: number }
      >),
    };
    // Clés acceptées : « hair » (tout l'emplacement) ou « hair:3 » (cette
    // pièce-là). Tout le reste est ignoré : la table sert au rendu, une clé
    // inventée y resterait sans jamais s'appliquer.
    const CLE = /^(clothes|pants|hair|accessory)(:\d+)?$/;
    for (const [cle, recu] of Object.entries(b as Record<string, unknown>)) {
      if (!CLE.test(cle) || recu === undefined) continue;
      const propre = calagePropre(recu);
      if (calageNeutre(propre)) delete suivant[cle];
      else suivant[cle] = propre;
    }

    const [row] = await db
      .update(schema.characterTypes)
      .set({ slotAdjust: suivant })
      .where(eq(schema.characterTypes.id, id))
      .returning({ slotAdjust: schema.characterTypes.slotAdjust });
    return c.json({ ok: true, slotAdjust: row?.slotAdjust ?? {} });
  });

  /**
   * Tenue par défaut d'un personnage : la pièce portée d'emblée, par
   * emplacement, en POSITIONS (comme les pièces autorisées et le calage).
   *
   * Un emplacement absent du corps de la requête n'est pas touché ; `null`
   * l'efface — le personnage arrive alors sans rien à cet endroit.
   */
  app.post("/admin/characters/:id/default-assets", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json();
    const [perso] = await db
      .select({ defaultAssets: schema.characterTypes.defaultAssets })
      .from(schema.characterTypes)
      .where(eq(schema.characterTypes.id, id));
    if (!perso) return c.notFound();

    const SLOTS = ["clothes", "pants", "hair", "accessory"] as const;
    const suivant: Record<string, number> = {
      ...((perso.defaultAssets ?? {}) as Record<string, number>),
    };
    for (const slot of SLOTS) {
      const recu = (b as Record<string, unknown>)[slot];
      if (recu === undefined) continue;
      const n = Number(recu);
      if (recu === null || !Number.isFinite(n)) delete suivant[slot];
      else suivant[slot] = n;
    }

    const [row] = await db
      .update(schema.characterTypes)
      .set({ defaultAssets: suivant })
      .where(eq(schema.characterTypes.id, id))
      .returning({ defaultAssets: schema.characterTypes.defaultAssets });
    return c.json({ ok: true, defaultAssets: row?.defaultAssets ?? {} });
  });

  app.post("/admin/characters/reorder", async (c) => {
    const b = await c.req.json();
    const list: { id: number; position: number; category?: string }[] =
      b.items ?? [];
    for (const it of list) {
      await db
        .update(schema.characterTypes)
        .set({
          position: Number(it.position),
          ...(it.category !== undefined ? { category: it.category } : {}),
        })
        .where(eq(schema.characterTypes.id, Number(it.id)));
    }
    return c.json({ ok: true, count: list.length });
  });

  /**
   * Catégories de pièces, toutes, avec le nombre de pièces rangées dedans.
   *
   * Les archivées viennent AVEC, marquées par leur `archivedAt` : l'écran les
   * range dans sa section « Catégories archivées » sans redemander la liste.
   */
  app.get("/admin/piece-categories", async (c) => {
    const cats = await db
      .select()
      .from(schema.pieceCategories)
      .orderBy(asc(schema.pieceCategories.position));
    const comptes = await Promise.all(
      cats.map(async (cat) => {
        const [n] = await db
          .select({ n: count() })
          .from(schema.assets)
          .where(eq(schema.assets.pieceCategoryId, cat.id));
        return { ...cat, colors: cat.colors ?? [], pieces: Number(n?.n ?? 0) };
      }),
    );
    return c.json(comptes);
  });

  /**
   * Crée ou modifie une catégorie de pièces et son nuancier.
   *
   * Les couleurs sont normalisées en hexadécimal majuscule : le configurateur
   * compare la couleur choisie à celles proposées pour cocher la bonne
   * pastille, une casse différente lui ferait rater la comparaison.
   */
  app.post("/admin/piece-categories", async (c) => {
    const b = await c.req.json();
    const name = String(b.name ?? "").trim();
    if (!name) return c.json({ error: "nom requis" }, 400);
    const SLOTS = ["clothes", "pants", "hair", "accessory"];
    const slot = SLOTS.includes(String(b.slot)) ? String(b.slot) : "accessory";
    const colors = (Array.isArray(b.colors) ? b.colors : [])
      .map((v: unknown) => String(v).trim().toUpperCase())
      .filter((v: string) => /^#[0-9A-F]{6}$/.test(v));
    const valeurs = {
      name,
      slot,
      colors,
      active: b.active !== false,
      position: Number(b.position ?? 0),
    };
    if (b.id) {
      const [row] = await db
        .update(schema.pieceCategories)
        .set(valeurs)
        .where(eq(schema.pieceCategories.id, Number(b.id)))
        .returning();
      if (!row) return c.notFound();
      return c.json(row);
    }
    const base =
      name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "categorie";
    const pris = new Set(
      (
        await db
          .select({ slug: schema.pieceCategories.slug })
          .from(schema.pieceCategories)
      ).map((r) => r.slug),
    );
    let slug = base;
    for (let i = 2; pris.has(slug); i++) slug = `${base}-${i}`;
    const [row] = await db
      .insert(schema.pieceCategories)
      .values({ ...valeurs, slug })
      .returning();
    return c.json(row);
  });

  /**
   * Archive une catégorie de pièces, ou la restaure.
   *
   * La suppression définitive a été RETIRÉE. Elle passait pour anodine — les
   * pièces survivaient — mais elle emportait deux choses irremplaçables : le
   * RANGEMENT (la clé étrangère en ON DELETE SET NULL vidait le
   * `piece_category_id` de chaque pièce, et « Casquettes » se dispersait dans
   * les accessoires) et le NUANCIER écrit à la main, teinte par teinte, que
   * rien ne conservait ailleurs.
   *
   * Archivée, la catégorie garde tout : ses pièces restent proposées et
   * reprennent le nuancier de leur emplacement, comme celles d'une catégorie
   * décochée, et « Restaurer » rend le rayon et ses couleurs tels quels.
   * `dedans` dit combien de pièces elle range, pour que l'écran le redise.
   */
  app.post("/admin/piece-categories/:id/archive", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.notFound();
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    // Défaut : on archive. Seul un « archived: false » explicite restaure.
    const archiver = b.archived !== false;

    const [row] = await db
      .update(schema.pieceCategories)
      .set({ archivedAt: archiver ? new Date() : null })
      .where(eq(schema.pieceCategories.id, id))
      .returning({ archivedAt: schema.pieceCategories.archivedAt });
    if (!row) return c.notFound();

    const [compte] = await db
      .select({ n: count() })
      .from(schema.assets)
      .where(eq(schema.assets.pieceCategoryId, id));

    return c.json({
      ok: true,
      archived: row.archivedAt != null,
      dedans: Number(compte?.n ?? 0),
    });
  });

  /** Range un lot de pièces dans une catégorie (ou les en sort). */
  app.post("/admin/assets/category", async (c) => {
    const b = await c.req.json();
    const ids = Array.isArray(b.ids)
      ? b.ids.map(Number).filter(Number.isFinite)
      : [];
    if (!ids.length) return c.json({ error: "aucune pièce" }, 400);
    const categoryId =
      b.pieceCategoryId == null || b.pieceCategoryId === ""
        ? null
        : Number(b.pieceCategoryId);
    // On peut toujours en SORTIR des pièces (« aucune catégorie »), mais pas
    // en ranger dans un rayon rangé : la catégorie étant archivée, elles n'en
    // prendraient même pas le nuancier, et rien à l'écran ne le dirait.
    if (categoryId != null) {
      const [cat] = await db
        .select({ archivedAt: schema.pieceCategories.archivedAt })
        .from(schema.pieceCategories)
        .where(eq(schema.pieceCategories.id, categoryId));
      if (!cat) return c.json({ error: "catégorie inconnue" }, 404);
      if (cat.archivedAt)
        return c.json(
          {
            error:
              "Cette catégorie est archivée. Restaurez-la avant d'y ranger des pièces.",
          },
          400,
        );
    }
    await db
      .update(schema.assets)
      .set({ pieceCategoryId: categoryId })
      .where(inArray(schema.assets.id, ids));
    return c.json({ ok: true, count: ids.length });
  });

  /** Édite les couleurs d'un asset (accessoires inclus — §18.1 D). */
  app.post("/admin/assets/:id/colors", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json();
    const zones = b.colorZones ?? {};
    // garde-fou : clés stN + valeurs hex
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(zones)) {
      if (/^st\d+$/.test(k) && /^#[0-9a-fA-F]{3,8}$/.test(String(v)))
        clean[k] = String(v).toUpperCase();
    }
    const [row] = await db
      .update(schema.assets)
      .set({ colorZones: clean })
      .where(eq(schema.assets.id, id))
      .returning();
    if (!row) return c.notFound();
    return c.json(row);
  });

  /**
   * Zones de couleur NON proposées au client pour une pièce (« ruban du
   * chapeau »…). Enregistrées dès que la case change, séparément des
   * couleurs : décocher une zone ne doit pas enregistrer au passage une
   * couleur en cours de réglage.
   */
  app.post("/admin/assets/:id/zones-masquees", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json().catch(() => ({}));
    const [piece] = await db
      .select({ colorZones: schema.assets.colorZones })
      .from(schema.assets)
      .where(eq(schema.assets.id, id));
    if (!piece) return c.notFound();
    const [row] = await db
      .update(schema.assets)
      .set({ zonesMasquees: zonesMasqueesPropres(b.zonesMasquees, piece.colorZones) })
      .where(eq(schema.assets.id, id))
      .returning();
    if (!row) return c.notFound();
    return c.json(row);
  });

  /**
   * Les couleurs d'une pièce, telles que l'éditeur de groupes du back-office
   * les tient : couleurs par défaut, groupes (nuances, noms) et groupes non
   * proposés. Enregistrées dès qu'elles changent, d'un seul envoi : le
   * regroupement, les noms et les cases se tiennent entre eux.
   *
   * `svgUrl` n'arrive qu'après « Détecter les couleurs » d'un dessin qui
   * écrivait ses couleurs sur ses formes : la pièce pointe alors sur la
   * version normalisée, l'original reste intact à côté.
   */
  app.post("/admin/assets/:id/groupes", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json().catch(() => ({}));
    const [piece] = await db
      .select({ colorZones: schema.assets.colorZones })
      .from(schema.assets)
      .where(eq(schema.assets.id, id));
    if (!piece) return c.notFound();
    const zones =
      b.colorZones !== undefined ? zonesPropres(b.colorZones) : (piece.colorZones ?? {});
    const set: Partial<typeof schema.assets.$inferInsert> = {
      colorZones: Object.keys(zones).length ? zones : null,
      groupesCouleurs: groupesPropres(b.groupesCouleurs, zones),
      zonesMasquees: zonesMasqueesPropres(b.zonesMasquees, zones),
    };
    // Un dessin en pixels n'a pas de zone : ce sont ses familles de teintes
    // que la boutique règle, dans le même écran et le même envoi.
    if (b.couleursImage !== undefined)
      set.couleursImage = couleursImagePropres(b.couleursImage);
    if (typeof b.svgUrl === "string" && /^\/assets\/[^/]+\.svg$/i.test(b.svgUrl))
      set.svgUrl = b.svgUrl;
    const [row] = await db
      .update(schema.assets)
      .set(set)
      .where(eq(schema.assets.id, id))
      .returning();
    if (!row) return c.notFound();
    return c.json(row);
  });

  /**
   * Définit le SVG de BASE d'un personnage prédéfini + ses couleurs par défaut.
   * Permet de composer un perso depuis le BO (baseSvgUrl = un perso complet,
   * ou un assemblage exporté). baseColorZones = couleurs par défaut (peau/tenue).
   */
  app.post("/admin/characters/:id/base", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json();
    const set: Record<string, unknown> = {};
    if (b.baseSvgUrl !== undefined) set.baseSvgUrl = b.baseSvgUrl || null;
    if (b.baseColorZones !== undefined)
      set.baseColorZones = zonesPropres(b.baseColorZones);
    // Groupes et groupes proposés : vérifiés contre les zones de CE dessin —
    // celles envoyées, sinon celles déjà enregistrées.
    if (b.baseGroupesCouleurs !== undefined || b.baseZonesProposees !== undefined) {
      let zones = set.baseColorZones as Record<string, string> | undefined;
      if (!zones) {
        const [actuel] = await db
          .select({ z: schema.characterTypes.baseColorZones })
          .from(schema.characterTypes)
          .where(eq(schema.characterTypes.id, id));
        if (!actuel) return c.notFound();
        zones = actuel.z ?? {};
      }
      if (b.baseGroupesCouleurs !== undefined)
        set.baseGroupesCouleurs = groupesPropres(b.baseGroupesCouleurs, zones);
      if (b.baseZonesProposees !== undefined)
        set.baseZonesProposees = Array.isArray(b.baseZonesProposees)
          ? zonesMasqueesPropres(b.baseZonesProposees, zones)
          : null;
    }
    // Familles de couleurs d'un dessin en pixels : elles ne se vérifient pas
    // contre les zones du dessin, puisqu'il n'en a aucune.
    if (b.baseCouleursImage !== undefined)
      set.baseCouleursImage = couleursImagePropres(b.baseCouleursImage);
    const [row] = await db
      .update(schema.characterTypes)
      .set(set)
      .where(eq(schema.characterTypes.id, id))
      .returning();
    if (!row) return c.notFound();
    return c.json(row);
  });

  /** Supprime DÉFINITIVEMENT un type de personnage (et ses assets liés). */
  // La suppression définitive d'un personnage a été RETIRÉE volontairement.
  // Les PDF des commandes passées se régénèrent en relisant les personnages en
  // base : supprimer une ligne rendait donc impossible la réimpression d'une
  // commande déjà payée. On archive (POST /admin/characters/:id/archive), ce
  // qui masque du configurateur sans rien casser.

  // === Gestion des PIÈCES (assets) — bibliothèque d'éléments ================

  /** Liste des pièces (variantes génériques), groupées par slot + vue. */
  app.get("/admin/assets", async (c) => {
    const rows = await db
      .select()
      .from(schema.assets)
      .orderBy(asc(schema.assets.slot), asc(schema.assets.position));
    return c.json(rows);
  });

  /** Crée ou met à jour une pièce (vêtement, coupe, accessoire…). */
  app.post("/admin/assets", async (c) => {
    const b = await c.req.json();
    const cleanZones: Record<string, string> = {};
    for (const [k, v] of Object.entries(b.colorZones ?? {})) {
      if (/^st\d+$/.test(k) && /^#[0-9a-fA-F]{3,8}$/.test(String(v)))
        cleanZones[k] = String(v).toUpperCase();
    }
    const values = {
      slot: String(b.slot ?? "clothes"),
      name: b.name ?? null,
      svgUrl: String(b.svgUrl ?? ""),
      view: (await typeAfficheValide(b.view)) ?? "front",
      colorZones: Object.keys(cleanZones).length ? cleanZones : null,
      // Absent = on ne touche pas au réglage (une édition qui ne le connaît
      // pas ne doit pas re-proposer d'un coup toutes les zones).
      ...(b.zonesMasquees !== undefined
        ? { zonesMasquees: zonesMasqueesPropres(b.zonesMasquees, cleanZones) }
        : {}),
      // Même règle pour les groupes de couleurs lus au téléversement.
      ...(b.groupesCouleurs !== undefined
        ? { groupesCouleurs: groupesPropres(b.groupesCouleurs, cleanZones) }
        : {}),
      // Familles de couleurs, quand le dessin téléversé est une image en pixels.
      ...(b.couleursImage !== undefined
        ? { couleursImage: couleursImagePropres(b.couleursImage) }
        : {}),
      position: Number(b.position ?? 0),
      characterTypeId: b.characterTypeId ? Number(b.characterTypeId) : null,
      ...(b.pieceCategoryId !== undefined
        ? {
            pieceCategoryId:
              b.pieceCategoryId == null || b.pieceCategoryId === ""
                ? null
                : Number(b.pieceCategoryId),
          }
        : {}),
    };
    if (!values.svgUrl) return c.json({ error: "svgUrl requis" }, 400);
    if (b.id) {
      const [row] = await db
        .update(schema.assets)
        .set(values)
        .where(eq(schema.assets.id, Number(b.id)))
        .returning();
      return c.json(row);
    }
    const [row] = await db.insert(schema.assets).values(values).returning();
    return c.json(row);
  });

  /** Supprime une pièce. */
  /**
   * Archive ou restaure une pièce. La suppression définitive a été RETIRÉE :
   * une pièce effacée empêchait de régénérer le PDF des commandes qui
   * l'utilisaient. Archivée, elle disparaît du configurateur mais reste
   * lisible pour l'impression.
   */
  app.post("/admin/assets/:id/archive", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json().catch(() => ({}));
    const [row] = await db
      .update(schema.assets)
      .set({ archivedAt: b.archived === false ? null : new Date() })
      .where(eq(schema.assets.id, id))
      .returning();
    if (!row) return c.notFound();
    return c.json({ ok: true, archived: row.archivedAt != null });
  });

  // === Config CONFIGURATEUR par produit (BO) ===============================

  /**
   * Détail config configurateur d'un produit : défauts + visuels (fonds).
   *
   * Les fonds archivés viennent AVEC, marqués par leur `archivedAt` : la fiche
   * les range dans « Visuels archivés », d'où ils se restaurent.
   */
  app.get("/admin/products/:id/config", async (c) => {
    const id = Number(c.req.param("id"));
    const [product] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, id));
    if (!product) return c.notFound();
    const backgrounds = await db
      .select()
      .from(schema.backgrounds)
      .where(eq(schema.backgrounds.productId, id))
      .orderBy(asc(schema.backgrounds.position));
    return c.json({
      id: product.id,
      slug: product.slug,
      name: product.name,
      defaultTitle: product.defaultTitle,
      defaultSubtitle: product.defaultSubtitle,
      defaultLine3: product.defaultLine3,
      defaultView: product.defaultView,
      foregroundUrl: product.foregroundUrl,
      backgrounds,
    });
  });

  /** Met à jour les défauts configurateur d'un produit (les trois lignes de
   *  texte, la position, le décor d'avant-plan). */
  app.post("/admin/products/:id/config", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json();
    const set: Record<string, unknown> = {};
    // `defaultTitle` / `defaultSubtitle` sont les colonnes des lignes 1 et 2 :
    // elles gardent leur nom d'origine, rempli par 161 affiches.
    if (b.defaultTitle !== undefined) set.defaultTitle = b.defaultTitle || null;
    if (b.defaultSubtitle !== undefined)
      set.defaultSubtitle = b.defaultSubtitle || null;
    if (b.defaultLine3 !== undefined) set.defaultLine3 = b.defaultLine3 || null;
    if (b.defaultView !== undefined)
      set.defaultView = await typeAfficheValide(b.defaultView);
    if (b.foregroundUrl !== undefined)
      set.foregroundUrl = b.foregroundUrl || null;
    const [row] = await db
      .update(schema.products)
      .set(set)
      .where(eq(schema.products.id, id))
      .returning();
    if (!row) return c.notFound();
    return c.json(row);
  });

  /**
   * CRÉE une affiche de toutes pièces.
   *
   * Le catalogue venait entièrement de l'import Shopify : ajouter une affiche
   * demandait un développeur. Tout ce qu'il faut pour qu'elle vive sur le site
   * part d'ici — la fiche, ses formats, ses visuels et ses fonds — en une
   * seule requête, pour ne pas laisser un produit à moitié créé si la page se
   * ferme au mauvais moment.
   */
  app.post("/admin/products", async (c) => {
    const b = await c.req.json();
    const name = String(b.name ?? "").trim();
    if (!name) return c.json({ error: "nom requis" }, 400);

    // Slug : depuis le nom, rendu unique. Il fait l'URL publique de l'affiche
    // et ne se devine pas deux fois pareil — d'où le suffixe numéroté.
    const base =
      String(b.slug ?? name)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80) || "affiche";
    const pris = new Set(
      (await db.select({ slug: schema.products.slug }).from(schema.products)).map(
        (r) => r.slug,
      ),
    );
    let slug = base;
    for (let i = 2; pris.has(slug); i++) slug = `${base}-${i}`;

    // Formats : A4 et A3 par défaut, avec leurs dimensions réelles. Un format
    // sans prix n'est pas créé — le client ne doit pas pouvoir choisir un
    // format qui n'a pas de prix.
    const DIMENSIONS: Record<string, { w: number; h: number }> = {
      A4: { w: 210, h: 297 },
      A3: { w: 297, h: 420 },
    };
    const formats = Array.isArray(b.variants) ? b.variants : [];
    const lignes = formats
      .map((v: Record<string, unknown>) => ({
        format: String(v.format ?? "A4"),
        priceCents: Math.max(0, Math.round(Number(v.priceCents ?? 0))),
      }))
      .filter((v: { format: string; priceCents: number }) => v.priceCents > 0);
    if (lignes.length === 0)
      return c.json({ error: "au moins un format avec un prix" }, 400);

    const kind =
      b.kind === "prete_a_imprimer" ? "prete_a_imprimer" : "personnalisable";
    // Prix de référence = le moins cher : c'est celui qu'affiche la boutique
    // et celui qui sert de repli si un format perd son prix.
    const basePriceCents = Math.min(
      ...lignes.map((v: { priceCents: number }) => v.priceCents),
    );

    const [product] = await db
      .insert(schema.products)
      .values({
        slug,
        name,
        description: b.description ? String(b.description) : null,
        kind,
        basePriceCents,
        defaultTitle: b.defaultTitle ? String(b.defaultTitle) : null,
        defaultSubtitle: b.defaultSubtitle ? String(b.defaultSubtitle) : null,
        defaultLine3: b.defaultLine3 ? String(b.defaultLine3) : null,
        defaultView: await typeAfficheValide(b.defaultView),
        foregroundUrl: b.foregroundUrl ? String(b.foregroundUrl) : null,
      })
      .returning();
    if (!product) return c.json({ error: "création impossible" }, 500);

    await db.insert(schema.variants).values(
      lignes.map((v: { format: string; priceCents: number }) => ({
        productId: product.id,
        format: v.format,
        priceCents: v.priceCents,
        widthMm: DIMENSIONS[v.format]?.w ?? null,
        heightMm: DIMENSIONS[v.format]?.h ?? null,
      })),
    );

    const images: string[] = (Array.isArray(b.images) ? b.images : [])
      .map((u: unknown) => String(u ?? "").trim())
      .filter(Boolean);
    if (images.length)
      await db.insert(schema.productImages).values(
        images.map((url, i) => ({ productId: product.id, url, position: i })),
      );

    const fonds: string[] = (Array.isArray(b.backgrounds) ? b.backgrounds : [])
      .map((u: unknown) => String(u ?? "").trim())
      .filter(Boolean);
    if (fonds.length)
      await db.insert(schema.backgrounds).values(
        fonds.map((url, i) => ({
          productId: product.id,
          url,
          name: url.split("/").pop()?.replace(/\.[a-z]+$/i, "") ?? null,
          position: i,
        })),
      );

    return c.json({ ...product, variants: lignes, images, backgrounds: fonds });
  });

  /** Ajoute un visuel (fond) à un produit, par URL. */
  app.post("/admin/products/:id/backgrounds", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json();
    const url = String(b.url ?? "").trim();
    if (!url) return c.json({ error: "url requise" }, 400);
    const [maxPos] = await db
      .select({ p: schema.backgrounds.position })
      .from(schema.backgrounds)
      .where(eq(schema.backgrounds.productId, id))
      .orderBy(desc(schema.backgrounds.position))
      .limit(1);
    const [row] = await db
      .insert(schema.backgrounds)
      .values({
        productId: id,
        url,
        name: b.name ?? url.split("/").pop()?.replace(/\.[a-z]+$/i, "") ?? null,
        position: (maxPos?.p ?? -1) + 1,
      })
      .returning();
    return c.json(row);
  });

  /**
   * Archive un visuel (fond), ou le restaure.
   *
   * La suppression définitive a été RETIRÉE, pour la même raison que sur les
   * pièces : un fond effacé empêchait de régénérer le PDF des commandes qui
   * l'utilisaient, et la cliente se retrouvait avec une affiche impossible à
   * réimprimer. Archivé, il quitte les choix du configurateur et reste
   * parfaitement imprimable — `donneesDImpression()` prend tous les fonds.
   */
  app.post("/admin/backgrounds/:bgId/archive", async (c) => {
    const bgId = Number(c.req.param("bgId"));
    if (!Number.isInteger(bgId)) return c.notFound();
    const b = await c.req.json().catch(() => ({}));
    const [row] = await db
      .update(schema.backgrounds)
      // Défaut : on archive. Seul un « archived: false » explicite restaure.
      .set({ archivedAt: b.archived === false ? null : new Date() })
      .where(eq(schema.backgrounds.id, bgId))
      .returning();
    if (!row) return c.notFound();
    return c.json({ ok: true, archived: row.archivedAt != null });
  });
}
