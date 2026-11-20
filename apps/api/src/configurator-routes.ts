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
  type AnyColumn,
  desc,
  eq,
  inArray,
  isNotNull,
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
  donneesDImpression,
  etatDuFichierDImpression,
  fichierDAssetManquant,
  fichierDImpression,
  preparerFichierDImpression,
  raisonLisible,
  type EtatImpression,
} from "./fichiers-impression.js";
import { archiveZip } from "./archive-zip.js";
import { supprimerPourToujours } from "./suppression.js";
import { commandesQuiEmpechent, enBref } from "./usages-commandes.js";
import { decorsParLeNom } from "./decors.js";
import { empriseDuPersonnage, preparerLesEmprises } from "./emprise-personnages.js";
import {
  avecBordereauReel,
  etapeDeLaCommande,
  resumeCommandes,
  statutExpedition,
  statutFinancier,
} from "./commandes.js";
import { clientDeLaRequete } from "./comptes.js";
import { carnetDe, memeAdresse } from "./adresses-client.js";
import {
  envoyer as envoyerMail,
  courrierConfirmation,
  courrierNouvelleCommande,
  estConfigure as mailConfigure,
} from "./mail.js";
import { noterLaRecuperation } from "./relance-panier.js";
import {
  langueDuVisiteur,
  livraisonDansLaLangue,
  nomTraduit,
  texteDansLaLangue,
} from "./traductions.js";
import {
  langueDuDestinataire,
  langueLue,
  tc,
  type Langue,
} from "./courriels/index.js";
import {
  PREFIXE_SENDCLOUD,
  gerePoints as sendcloudGerePoints,
  verifierPoint as verifierPointSendcloud,
} from "./sendcloud-points.js";
import {
  MODE_RETRAIT_STAND,
  codePostalValide,
  telephoneValide,
  CODES_NATURE,
  calageNeutre,
  calagePropre,
  couleursProposees,
  demandeUnPointRelais,
  demandeUneAdresse,
  avecToutesLesFamillesProposees,
  famillesDuDessin,
  famillesDuParametre,
  fraisDePort,
  groupesDuDessin,
  lignesRemplies,
  listesDesParties,
  refusDesCouleursDesParties,
  poidsPanier,
  normaliserCode,
  normaliserPays,
  PREFIXE_NUANCIER_CATEGORIE,
  posterConfigSchema,
  prixDuCadreCents,
  remisesPanier,
  seuilPortCents,
  sousTotalCents,
  totalPanierCents,
  type CouleursImage,
  type GroupeCouleur,
  type PosterConfig,
  type TextesAffiche,
  reglesActives,
  type RegleParier,
  CARTE_MESSAGE_MAX,
  CARTE_PRENOM_MAX,
  cleDeCarte,
  cleDeCode,
  codeCarteMasque,
  estLigneCarte,
  estUsageUnique,
  montantCarteValide,
  partCarteCadeau,
  validableSansPaiement,
  type LigneCarteCadeau,
} from "@memoryline/types";
import {
  carteParCle,
  carteUtilisable,
  debiterCarte,
  emettreCartesDeLaCommande,
  envoyerCartesDeLaCommande,
  verifierCarteSousVerrou,
  type CarteEmise,
} from "./cartes-cadeaux.js";
import {
  CODE_DEJA_UTILISE,
  CODE_NON_VALABLE,
  promotionDuCode,
  tropDEssaisDeCode,
  utilisationsDuCode,
} from "./promotions.js";
import { imageRecoloree } from "./couleurs-image-fichier.js";
import {
  enregistrerNuancierBase,
  lireNuanciersBase,
  nuanciersModifies,
} from "./nuanciers.js";
import { mesurerLaPiece, partsPourLaBoutique } from "./couleur-principale.js";
import { partsDesZones } from "./couleurs-dessins.js";
import { rattacherGenerationsAuPanier } from "./ia.js";
import {
  createPaypalOrder,
  capturePaypalOrder,
  RefusPaypal,
  createStripeIntent,
  getStripeIntent,
  verifyStripeEvent,
  avisIncoherent,
  avisAutreModeRecevable,
  issueDuRetour,
  secretClientConcorde,
} from "./payments.js";
import { etatEssai } from "./mode-essai.js";
import { prochainNumeroDeCommande } from "./numeros-commande.js";
// Les clés qui servent : celles du back-office (BO › Réglages › Paiements),
// sinon celles du .env. Relues à chaque requête, avec un petit cache que
// chaque modification vide : changer de clé ne demande plus de redémarrer.
import {
  configPaiement,
  modeDuPaiement,
  noterAvisIncoherent,
  noterAvisStripe,
  payeeEnEssai,
} from "./paiements-reglages.js";
import {
  configPublique,
  nomDuMode,
  type ConfigEffective,
  type Mode,
} from "./paiements-cles.js";
import { commandeVisible, type CommandeABorner } from "./vendeurs.js";
import { lieuDeRetrait, lieuPourLaCommande, lignesDuLieu } from "./lieux-retrait.js";
import { libererAdresse } from "./redirections.js";
import { prenomPourCourrier } from "./prenom.js";

// --- Helpers -----------------------------------------------------------------

/**
 * Un fond qu'on vient d'ajouter : ses images légères (aperçu du configurateur
 * en 1400 px, vignette en 400 px) sont calculées tout de suite, en tâche de
 * fond, pour que la première cliente n'attende pas la conversion d'un SVG de
 * 10 Mo (17/11). La route /assets les fabrique une à la fois (index.ts,
 * unSvgALaFois) ; une erreur ici ne change rien : elles se feront à la
 * première visite.
 */
function preparerVersionsLegeres(url: string): void {
  const fichier = url.match(/\/assets\/([^/?#]+)$/)?.[1];
  if (!fichier) return;
  const ici = `http://127.0.0.1:${process.env.API_PORT ?? 3000}/assets/${fichier}`;
  void (async () => {
    for (const l of [1400, 400]) await fetch(`${ici}?l=${l}`).then((r) => r.arrayBuffer()).catch(() => undefined);
  })();
}

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

/**
 * Le nom de fichier de chaque ligne, pour le téléchargement d'une affiche
 * comme pour l'archive de toute la commande.
 *
 * Le nom retenu au moment de la commande fait foi : le fichier téléchargé
 * aujourd'hui doit s'appeler comme celui rangé le jour de l'impression, même
 * si le cadre a été renommé entre-temps.
 */
async function nomsDesFichiersDImpression(
  order: { id: number; status: string; customerId: number | null },
  lignes: { id: number; config: unknown }[],
): Promise<Map<number, string>> {
  const ids = lignes.map((l) => l.id);
  const retenus = () =>
    db
      .select({
        orderItemId: schema.printFiles.orderItemId,
        filename: schema.printFiles.filename,
      })
      .from(schema.printFiles)
      .where(inArray(schema.printFiles.orderItemId, ids));
  let noms = await retenus();
  // Une commande payée sans nom retenu — vente du stand d'avant qu'on les
  // enregistre, commande reprise — reçoit les noms de TOUTES ses lignes
  // maintenant, dans leur ordre, numérotation comprise : recalculé ici à
  // chaque clic, le nom de deux affiches identiques était le même.
  if (order.status === "paid" && new Set(noms.map((n) => n.orderItemId)).size < ids.length) {
    await enregistrerFichiersDImpression(order.id, { preparer: false });
    noms = await retenus();
  }
  const parLigne = new Map(noms.map((n) => [n.orderItemId, n.filename]));
  const sansNom = lignes.filter((l) => !parLigne.has(l.id));
  if (sansNom.length) {
    const [client] = order.customerId
      ? await db
          .select({ name: schema.customers.name })
          .from(schema.customers)
          .where(eq(schema.customers.id, order.customerId))
      : [];
    const cadres = await db
      .select({ id: schema.frames.id, name: schema.frames.name })
      .from(schema.frames);
    for (const l of sansNom) {
      const cfg = (l.config ?? {}) as PosterConfig;
      const cadre = cfg.frameId
        ? cadres.find((f) => f.id === Number(cfg.frameId))
        : undefined;
      parLigne.set(
        l.id,
        `${slugifyName(client?.name ?? "client")}_${cfg.format ?? "A4"}_${suffixeCadre(cadre?.name)}.pdf`,
      );
    }
  }
  return parLigne;
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
  /**
   * La part du prix unitaire due au cadre (order_item.frame_cents). Null pour
   * les lignes d'avant : lignesDuMoteur la retrouve au catalogue.
   */
  frameCents?: number | null;
  /** Non nul : une carte cadeau achetée, pas une affiche (order_item.gift_card). */
  giftCard?: LigneCarteCadeau | null;
};

/**
 * Les affiches d'un panier, sans ses cartes cadeaux.
 *
 * Une carte cadeau n'a ni poids, ni port, ni remise : les promotions ne la
 * comptent pas (« 3 achetées = 1 A4 offerte ») et ne la remisent pas, et le
 * port ne porte que sur les affiches. Toutes les lectures du moteur de
 * remises et de la livraison passent donc par ce tri.
 */
function affichesSeules<T extends { giftCard?: unknown }>(items: readonly T[]): T[] {
  return items.filter((it) => !estLigneCarte(it));
}

/** Les cartes cadeaux d'un panier. */
function cartesSeules<T extends { giftCard?: unknown }>(items: readonly T[]): T[] {
  return items.filter((it) => estLigneCarte(it));
}

/**
 * Une ligne « carte cadeau » qui ne tient plus : montant hors des bornes,
 * quantité autre que 1, prix qui ne retombe pas sur le montant. Elle ne peut
 * venir que d'une écriture faite ailleurs que par l'ajout au panier : on
 * refuse d'encaisser plutôt que de vendre une carte au mauvais prix.
 */
export class LigneCarteInvalide extends Error {
  constructor() {
    super(
      "Une carte cadeau de votre panier n'a pas un montant valable (de 10 à 300 €). Retirez-la, puis ajoutez-la de nouveau.",
    );
    this.name = "LigneCarteInvalide";
  }
}

/** Le montant des cartes cadeaux du panier, chaque ligne revérifiée. */
function montantDesCartes(items: readonly PricedItem[]): number {
  let total = 0;
  for (const it of cartesSeules(items)) {
    const montant = it.giftCard?.montantCents;
    if (
      !montantCarteValide(montant) ||
      it.unitPriceCents !== montant ||
      it.quantity !== 1
    )
      throw new LigneCarteInvalide();
    total += montant;
  }
  return total;
}

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
  tous: PricedItem[],
  ex: Executeur = db,
): Promise<number> {
  // Une carte cadeau part par e-mail : elle ne pèse rien dans le colis.
  const items = affichesSeules(tous);
  if (!items.length) return 0;
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
 * Les couleurs proposées pour chaque partie d'une pièce, vérifiées avant
 * d'être enregistrées : codes « #RRGGBB », 10 au plus par partie (cf.
 * refusDesCouleursDesParties ; les doublons se retirent au nettoyage). Rend
 * la raison du refus, ou null. Les groupes d'un dessin vectoriel et les
 * familles d'un dessin en pixels portent ces listes de la même façon.
 *
 * Un refus plutôt qu'un nettoyage silencieux : une couleur mal écrite qui
 * disparaîtrait ferait croire à la boutique qu'elle est proposée.
 *
 * `rangee` : la pièce telle qu'elle est en base (null pour une pièce neuve).
 * Une liste rangée quand la borne était de 40 passe tant qu'on n'y ajoute
 * rien : sans quoi la boutique ne pourrait plus rien régler sur la pièce
 * — le back-office renvoie toutes ses parties à chaque geste.
 */
function refusDesCouleursPropres(
  b: { groupesCouleurs?: unknown; couleursImage?: unknown },
  rangee: { groupesCouleurs?: unknown; couleursImage?: unknown } | null = null,
): string | null {
  const familles = (x: unknown) =>
    x && typeof x === "object" ? (x as { familles?: unknown }).familles : undefined;
  const anciennes = rangee
    ? listesDesParties(rangee.groupesCouleurs, familles(rangee.couleursImage))
    : [];
  return (
    refusDesCouleursDesParties(b.groupesCouleurs, anciennes) ??
    refusDesCouleursDesParties(familles(b.couleursImage), anciennes)
  );
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
  return (await resolvePrixLigne(productId, format, frameId, ex)).unitPriceCents;
}

/**
 * Le prix unitaire d'une ligne ET la part qu'y tient le cadre.
 *
 * La part du cadre est gardée sur la ligne (order_item.frame_cents) : une
 * promotion peut offrir une affiche « cadre non compris », et il faut alors
 * savoir ce que vaut l'affiche seule. Le prix unitaire, lui, mêle les deux.
 */
async function resolvePrixLigne(
  productId: number | null | undefined,
  format: string | null | undefined,
  frameId?: string | number | null,
  ex: Executeur = db,
): Promise<{ unitPriceCents: number; frameCents: number }> {
  if (productId == null || !Number.isFinite(productId))
    return { unitPriceCents: 0, frameCents: 0 };
  const [product] = await ex
    .select({ basePriceCents: schema.products.basePriceCents })
    .from(schema.products)
    .where(eq(schema.products.id, productId));
  if (!product) return { unitPriceCents: 0, frameCents: 0 };
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
      // Un cadre archivé ne se vend plus : il ne porte plus de prix ici, tout
      // comme un cadre décoché. Ailleurs — fiches de commandes passées, noms
      // des fichiers d'impression — il continue de se lire par son nom.
      .where(
        and(
          eq(schema.frames.id, Number(frameId)),
          eq(schema.frames.active, true),
          isNull(schema.frames.archivedAt),
        ),
      );
    cadre = f ? prixDuCadreCents(f, format ?? "A4") : 0;
  }
  return { unitPriceCents: affiche + cadre, frameCents: cadre };
}

/**
 * Ce que le moteur de remises lit d'une ligne : son prix, sa quantité, son
 * format, et la part de son cadre.
 *
 * Une ligne écrite avant que la part du cadre soit gardée (frame_cents nul)
 * la retrouve au catalogue d'aujourd'hui, BORNÉE à son prix unitaire : une
 * remise ne peut pas déduire plus de cadre que la ligne n'en a payé. Une
 * commande déjà passée n'en change pas pour autant — ses montants sont figés.
 */
async function lignesDuMoteur(
  items: PricedItem[],
  ex: Executeur = db,
): Promise<{ unitPriceCents: number; quantity: number; format: string | null; cadreCents: number }[]> {
  const cadreDe = (it: PricedItem) => Number((it.config as { frameId?: unknown } | null)?.frameId);
  const aRetrouver = [
    ...new Set(
      items
        .filter((it) => it.frameCents == null)
        .map(cadreDe)
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ];
  const cadres = aRetrouver.length
    ? await ex
        .select({
          id: schema.frames.id,
          priceA4Cents: schema.frames.priceA4Cents,
          priceA3Cents: schema.frames.priceA3Cents,
        })
        .from(schema.frames)
        .where(inArray(schema.frames.id, aRetrouver))
    : [];
  return items.map((it) => {
    const format = (it.config as { format?: string } | null)?.format ?? null;
    let cadreCents = it.frameCents ?? 0;
    if (it.frameCents == null) {
      const f = cadres.find((x) => x.id === cadreDe(it));
      cadreCents = f ? prixDuCadreCents(f, format ?? "A4") : 0;
    }
    return {
      unitPriceCents: it.unitPriceCents,
      quantity: it.quantity,
      format,
      cadreCents: Math.min(Math.max(0, cadreCents), Math.max(0, it.unitPriceCents)),
    };
  });
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
        // Plus de cadre, plus de part de cadre dans le prix.
        frameCents: 0,
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
 * La langue de la page qui envoie ce panier, ou null.
 *
 * Seules les cinq langues du site passent, et un appel qui n'en dit rien ne
 * change rien. La tablette du stand n'en donne jamais : une vente du stand
 * reste en français, même si la tablette a ouvert une page traduite.
 */
function langueDeLaPage(c: Context, brut: unknown): Langue | null {
  return requeteDuStand(c) ? null : langueLue(brut);
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
 *
 * `langue` est celle de la page qui vient de remplir le panier (voir
 * `langueDeLaPage`) : c'est elle que gardera la commande, et dans laquelle on
 * écrira à quelqu'un dont on ne sait rien d'autre. Null ne change rien — un
 * retrait d'article, le stand, un ancien navigateur qui ne la dit pas.
 */
async function panierModifie(
  tx: Transaction,
  order: typeof schema.orders.$inferSelect,
  auStand: boolean,
  langue: Langue | null = null,
): Promise<void> {
  const maintenant = new Date();
  const rouverte = order.status === "pending";
  const saLangue = langue ? { langue } : {};
  // Passé en caisse = une cliente rattachée : c'est le passage en caisse qui
  // la pose.
  if (!rouverte && order.customerId == null) {
    await tx
      .update(schema.orders)
      .set({ lastActivityAt: maintenant, panierDuStand: auStand, ...saLangue })
      .where(eq(schema.orders.id, order.id));
    return;
  }

  // Le recalcul se fait dans un point de reprise : s'il échoue, la ligne
  // reste écrite et la commande repasse quand même en panier — c'est ce qui
  // protège. Le total sera de toute façon recalculé au prochain passage en
  // caisse, et une panne de calcul ne doit pas empêcher quelqu'un de modifier
  // son panier.
  //
  // Les promotions figées au passage en caisse ne valent plus : le panier a
  // changé, il se compte avec les règles du moment, et le prochain passage en
  // caisse figera les siennes.
  let valeur: Awaited<ReturnType<typeof valeurDesLignes>> | null = null;
  try {
    valeur = await tx.transaction((sp) =>
      valeurDesLignes({ ...order, promotions: null }, maintenant, sp),
    );
  } catch (e) {
    console.error("[panier] total non recalculé après modification", e);
  }
  await tx
    .update(schema.orders)
    .set({
      status: "draft",
      lastActivityAt: maintenant,
      panierDuStand: auStand,
      promotions: null,
      // La carte cadeau retenue au passage en caisse payait une part de
      // l'ANCIEN total : le prochain passage en caisse la recalcule. Rien
      // n'avait été débité — le débit n'a lieu qu'au paiement.
      giftCardId: null,
      giftCardCents: 0,
      ...saLangue,
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
  regles: RegleParier[] | null = null,
): Promise<number> {
  return (await calculerArticles(items, code, maintenant, ex, regles)).totalCents;
}

/** Les promotions d'une commande, telles qu'elles étaient au passage en caisse. */
type PromotionsFigees = NonNullable<(typeof schema.orders.$inferSelect)["promotions"]>;

/**
 * Le total des articles, remises comprises, et de quoi figer les promotions
 * sur la commande : les règles en jeu à cet instant (code compris) et la
 * remise accordée par chacune.
 *
 * `regles` : les règles à appliquer à la place de celles de la table — celles
 * figées au passage en caisse, pour vérifier un paiement. La boutique peut
 * modifier ou archiver une promotion entre la caisse et le paiement ; la
 * commande garde ce qu'on lui a annoncé. Absentes, la table fait foi.
 */
async function calculerArticles(
  items: PricedItem[],
  code: string | null | undefined,
  maintenant: Date,
  ex: Executeur = db,
  regles: RegleParier[] | null = null,
): Promise<{ totalCents: number; figees: PromotionsFigees; cartesCents: number }> {
  const rules: RegleParier[] = regles ?? (await ex.select().from(schema.promoRules));
  // Les cartes cadeaux achetées s'ajoutent à leur montant, sans remise : le
  // moteur ne voit que les affiches. Leur montant est revérifié ici, à chaque
  // calcul — au passage en caisse comme au paiement.
  const cartesCents = montantDesCartes(items);
  const lignes = await lignesDuMoteur(affichesSeules(items), ex);
  const codes = code ? [code] : [];
  // Le code passe par le moteur, qui décide seul s'il ouvre droit à une
  // remise : le navigateur peut envoyer ce qu'il veut, un code inconnu ou
  // expiré ne change rien au montant.
  const { detail } = remisesPanier(lignes, rules, maintenant, codes);
  // Les règles en jeu : de quoi refaire le même calcul plus tard, quoi que
  // devienne la table. Sans leurs traductions, qui ne servent qu'à l'écran.
  const enJeu = reglesActives(rules, maintenant, codes).map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code ?? null,
    type: r.type,
    config: r.config,
    active: true,
    priority: r.priority ?? 0,
    startsAt: r.startsAt ?? null,
    endsAt: r.endsAt ?? null,
  }));
  return {
    totalCents: totalPanierCents(lignes, rules, maintenant, codes) + cartesCents,
    figees: { regles: enJeu, detail, codes },
    cartesCents,
  };
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
  /** Les règles figées au passage en caisse, à la place de la table. */
  reglesFigees: RegleParier[] | null = null,
): Promise<{
  cents: number;
  label: string;
  /** La description du mode, telle que la cliente la lit avant de payer. */
  description: string | null;
  kind: string;
  carrier: string | null;
  poidsGrammes: number;
} | null> {
  const [zones, modes, tarifs, reglesDeLaTable] = await Promise.all([
    ex.select().from(schema.shippingZones),
    // Archivés écartés, mode comme tranches : ce calcul décide de ce qu'on
    // FACTURE. Un mode rangé ne doit pas pouvoir être choisi au passage en
    // caisse, ni une tranche retirée continuer d'y poser son prix.
    ex
      .select()
      .from(schema.shippingMethods)
      .where(
        and(
          eq(schema.shippingMethods.active, true),
          isNull(schema.shippingMethods.archivedAt),
        ),
      ),
    ex
      .select()
      .from(schema.shippingRates)
      .where(isNull(schema.shippingRates.archivedAt)),
    reglesFigees ? Promise.resolve(null) : ex.select().from(schema.promoRules),
  ]);
  const regles: RegleParier[] = reglesFigees ?? reglesDeLaTable ?? [];
  // Le port ne porte que sur les AFFICHES : une carte cadeau part par
  // e-mail, et ne compte ni dans le seuil de gratuité ni dans le poids.
  const lignes = await lignesDuMoteur(affichesSeules(items), ex);
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
    // La promotion « livraison offerte dès X € », ou un code qui offre la
    // livraison (seuil 0) : C'est le serveur qui décide du port encaissé,
    // avec la même fonction que l'écran.
    seuilPortCents(lignes, regles, maintenant, code ? [code] : []),
  );
  if (!option) return null;
  return {
    cents: option.fraisCents,
    label: option.mode.name,
    description: option.mode.description?.trim() || null,
    kind: option.mode.kind,
    carrier: option.mode.carrier ?? null,
    poidsGrammes: poids,
  };
}

/** Le « port » d'une commande sans affiche : rien à livrer, rien à peser. */
const SANS_LIVRAISON = {
  cents: 0,
  label: "",
  description: null,
  kind: "aucune",
  carrier: null,
  poidsGrammes: 0,
} satisfies NonNullable<Awaited<ReturnType<typeof computeShippingCents>>>;

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
 *
 * Les promotions sont celles FIGÉES sur la commande au passage en caisse
 * (order.promotions), quand elle en a : modifier ou archiver une promotion
 * entre la caisse et le paiement ne fait plus refuser une commande honnête.
 * Une commande d'avant, sans promotions figées, se compte avec la table.
 * Un panier modifié depuis la caisse perd les siennes (panierModifie).
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
  const figees = order.promotions?.regles ?? null;
  const articles = await computeOrderTotalCents(items, order.promoCode, maintenant, ex, figees);
  // Des cartes cadeaux seules : rien à livrer, donc pas de port, quel que
  // soit le mode resté sur la commande d'un passage en caisse précédent.
  if (affichesSeules(items).length === 0)
    return { totalCents: articles, shippingCents: 0, poidsGrammes: 0, livrable: true };
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
    figees,
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
    /**
     * Une autre raison que le panier : la carte cadeau ou le code à usage
     * unique ne tiennent plus au moment du paiement (obstacleAuPaiement).
     */
    message?: string,
  ) {
    super(
      message ??
        `Votre paiement de ${euros(recuCents)} a bien été reçu, mais votre panier a changé pendant le paiement ` +
          `et vaut maintenant ${euros(attenduCents)}. Votre commande n'est donc pas encore validée : ` +
          `nous revenons vers vous très vite pour régulariser. Inutile de payer une seconde fois.`,
    );
    this.name = "MontantEncaisseDifferent";
  }
}

/**
 * Une commande qu'on ne peut pas valider SANS paiement (POST /payments/gratuit)
 * ou sans encaissement à la main : rien n'a été reçu, rien n'est à rendre.
 * `code` dit pourquoi, la caisse le traduit.
 */
export class ValidationRefusee extends Error {
  constructor(
    readonly code: "montant_non_nul" | "carte_solde" | "code_deja_utilise" | "panier_modifie",
    message: string,
  ) {
    super(message);
    this.name = "ValidationRefusee";
  }
}

/** Ce qui peut encore empêcher une commande d'être payée, au dernier moment. */
interface ObstacleAuPaiement {
  code: "carte_solde" | "code_deja_utilise";
  /** La phrase pour la cliente. */
  pourLaCliente: string;
  /** La phrase pour le journal de la commande. */
  pourLeJournal: string;
}

/**
 * Les deux contrôles qui ne se font qu'au PAIEMENT, sous verrou, dans la
 * transaction de markOrderPaid : la carte cadeau peut-elle encore payer sa
 * part, et le code à usage unique est-il encore libre ?
 *
 * Les deux prennent un verrou (la carte, la promotion) qui dure jusqu'à la fin
 * de la transaction. Deux commandes payées au même instant avec la même carte,
 * ou le même code à usage unique, passent donc l'une après l'autre : la
 * seconde voit le solde, ou l'usage, que la première vient d'écrire.
 */
async function obstacleAuPaiement(
  tx: Transaction,
  order: typeof schema.orders.$inferSelect,
): Promise<ObstacleAuPaiement | null> {
  const quand = order.lastActivityAt ?? new Date();

  // Le code à usage unique : la règle figée au passage en caisse dit s'il
  // l'est ; la promotion vivante porte le verrou.
  const code = order.promoCode ? cleDeCode(order.promoCode) : "";
  if (code) {
    const figee = (order.promotions?.regles ?? []).find((r) => cleDeCode(r.code) === code);
    const [vivante] = await tx
      .select({ id: schema.promoRules.id, config: schema.promoRules.config })
      .from(schema.promoRules)
      .where(sql`upper(regexp_replace(coalesce(${schema.promoRules.code}, ''), '[[:space:]-]', '', 'g')) = ${code}`)
      .orderBy(asc(schema.promoRules.id))
      .limit(1)
      .for("update");
    const unique = estUsageUnique(figee?.config ?? vivante?.config);
    if (unique && (await utilisationsDuCode(tx, order.promoCode!, order.id)) > 0)
      return {
        code: "code_deja_utilise",
        pourLaCliente:
          `Le code ${order.promoCode} ne servait qu'une fois, et une autre commande vient de l'utiliser.`,
        pourLeJournal: `le code à usage unique ${order.promoCode} a été utilisé par une autre commande payée entre-temps`,
      };
  }

  // La carte cadeau : son solde, relu au journal sous verrou, doit couvrir la
  // part retenue au passage en caisse.
  if (order.giftCardId && order.giftCardCents > 0) {
    const verdict = await verifierCarteSousVerrou(tx, order.giftCardId, order.giftCardCents, quand);
    if (!verdict.ok) {
      const masque = verdict.code ? codeCarteMasque(verdict.code) : "";
      return {
        code: "carte_solde",
        pourLaCliente:
          verdict.raison === "solde"
            ? `Le solde de votre carte cadeau ${masque} ne couvre plus les ${euros(order.giftCardCents)} prévus : il reste ${euros(Math.max(0, verdict.soldeCents))}.`
            : `Votre carte cadeau ${masque} ne peut plus être utilisée.`,
        pourLeJournal:
          verdict.raison === "solde"
            ? `le solde de la carte cadeau ${masque} (${euros(Math.max(0, verdict.soldeCents))}) ne couvre plus les ${euros(order.giftCardCents)} retenus au passage en caisse`
            : `la carte cadeau ${masque} n'est plus utilisable (${verdict.raison === "echue" ? "date de fin passée" : verdict.raison === "desactivee" ? "mise hors service" : "introuvable"})`,
      };
    }
  }
  return null;
}

/**
 * De l'argent est arrivé chez le prestataire, mais la commande ne peut pas
 * être validée (obstacleAuPaiement). Comme pour un écart de montant : la
 * ligne de paiement passe en « montant_different » avec la somme reçue, et le
 * journal dit quoi faire — une seule fois.
 */
async function noterPaiementBloque(
  tx: Transaction,
  order: typeof schema.orders.$inferSelect,
  provider: "stripe" | "paypal",
  externalRef: string,
  recu: MontantRecu,
  obstacle: ObstacleAuPaiement,
): Promise<void> {
  const nomPrestataire = provider === "stripe" ? "Stripe" : "PayPal";
  console.error(
    `[paiement] ${order.number} : ${nomPrestataire} ${externalRef} a encaissé ${recu.montantCents}, mais ${obstacle.pourLeJournal} — NON marquée payée`,
  );
  const [paiement] = await tx
    .select({ id: schema.payments.id, status: schema.payments.status })
    .from(schema.payments)
    .where(and(eq(schema.payments.orderId, order.id), eq(schema.payments.externalRef, externalRef)));
  if (paiement?.status === "montant_different") return;
  if (paiement)
    await tx
      .update(schema.payments)
      .set({ status: "montant_different", amountCents: recu.montantCents })
      .where(eq(schema.payments.id, paiement.id));
  else
    await tx.insert(schema.payments).values({
      orderId: order.id,
      provider,
      externalRef,
      status: "montant_different",
      amountCents: recu.montantCents,
    });
  await tx.insert(schema.orderEvents).values({
    orderId: order.id,
    kind: "event",
    message:
      `PAIEMENT À RÉGULARISER : ${nomPrestataire} a encaissé ${euros(recu.montantCents)} (${externalRef}), ` +
      `mais ${obstacle.pourLeJournal}. La commande n'a PAS été marquée payée : voyez avec le client, ` +
      `puis remboursez ce paiement depuis votre compte ${nomPrestataire} ; il pourra repasser commande.`,
  });
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
): Promise<
  | { valide: true; montantCents: number; totalCents: number }
  | { valide: false; attenduCents: number }
> {
  const valeur = await valeurDesLignes(order, order.lastActivityAt ?? new Date(), tx);
  const devise = recu.devise.trim().toUpperCase();
  // Le prestataire n'encaisse que ce que la carte cadeau ne paie pas : la
  // part de la carte (giftCardCents) est réglée par son journal, au même
  // moment (markOrderPaid).
  const attendu = valeur.totalCents - Math.max(0, order.giftCardCents);
  if (
    valeur.livrable &&
    devise === "EUR" &&
    Number.isInteger(recu.montantCents) &&
    attendu > 0 &&
    recu.montantCents === attendu
  )
    return { valide: true, montantCents: attendu, totalCents: valeur.totalCents };

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
        (order.giftCardCents > 0
          ? `, dont ${euros(order.giftCardCents)} réglés par carte cadeau : ${euros(Math.max(0, attendu))} étaient attendus du prestataire`
          : "") +
        (valeur.livrable
          ? ""
          : ", sans compter le port : le mode de livraison choisi ne sait plus porter ce colis") +
        `. Le panier a sans doute été modifié pendant le paiement. La commande n'a PAS été marquée payée : ` +
        `voyez avec le client, puis remboursez ce paiement depuis votre compte ${nomPrestataire} ; ` +
        `il pourra repasser commande au bon montant.`,
    });
  }
  return { valide: false, attenduCents: Math.max(0, attendu) };
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
  | { issue: "payee"; order: typeof schema.orders.$inferSelect; cartes: CarteEmise[] }
  | { issue: "ecart"; attenduCents: number; recuCents: number; message?: string }
  | { issue: "refus"; code: ValidationRefusee["code"]; message: string }
  | { issue: "sans_suite" };

/**
 * Le moyen par lequel une commande est réglée :
 *  - « stripe », « paypal » : un prestataire en ligne, qui dit ce qu'il a pris ;
 *  - « manuel » : un virement, un chèque, des espèces, déclarés au back-office ;
 *  - « aucun » : RIEN à encaisser — une remise à 100 % et la livraison
 *    offerte, ou une carte cadeau qui couvre tout (POST /payments/gratuit).
 */
export type MoyenDEncaissement = "stripe" | "paypal" | "manuel" | "aucun";

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
 *
 * CARTE CADEAU ET CODE À USAGE UNIQUE (17/11). Le total de la commande reste
 * ce qu'elle vaut ; le prestataire n'en prend que ce que la carte cadeau ne
 * paie pas (`giftCardCents`). Dans la même transaction, sous verrou
 * (obstacleAuPaiement) : la carte doit encore pouvoir payer sa part, et un
 * code à usage unique ne doit pas avoir servi à une autre commande payée.
 * Alors seulement la carte est DÉBITÉE dans son journal, et le grand livre
 * reçoit une vente par moyen — le prestataire, la carte, ou « gratuit » pour
 * une commande à 0 €. Si un contrôle échoue : avec « aucun » ou « manuel »,
 * rien n'a été reçu, {@link ValidationRefusee} est levée ; avec un
 * prestataire, l'argent est arrivé, le paiement est noté à régulariser et
 * {@link MontantEncaisseDifferent} est levée avec la raison.
 *
 * Les cartes cadeaux que la commande ACHÈTE naissent aussi dans cette
 * transaction (emettreCartesDeLaCommande), et partent par e-mail après.
 */
export async function markOrderPaid(
  orderId: number,
  provider: MoyenDEncaissement,
  externalRef: string,
  recu: MontantRecu,
): Promise<boolean> {
  const conclusion = await db.transaction(
    async (tx): Promise<ConclusionEncaissement> => {
      const order = await commandeVerrouillee(tx, eq(schema.orders.id, orderId));
      if (!order) return { issue: "sans_suite" };
      // Une commande annulée ne repasse jamais « payée » : son intention Stripe
      // reste « succeeded » après le remboursement, et rejouer le retour de la
      // banque, /payments/stripe/confirm ou un avis du prestataire la
      // remettait en commande à expédier.
      if (order.status === "cancelled" || order.cancelledAt) {
        console.warn(
          `[paiement] ${provider} ${externalRef} reçu sur la commande annulée ${order.number} : ignoré`,
        );
        return { issue: "sans_suite" };
      }
      const cePaiement = and(
        eq(schema.payments.orderId, orderId),
        eq(schema.payments.externalRef, externalRef),
      );

      if (order.status === "paid") {
        // Payée entre la lecture de la fiche et le clic : il n'y a rien à
        // déclarer reçu (la route le dit). Une commande gratuite déjà
        // validée ne se valide pas une seconde fois.
        if (provider === "manuel" || provider === "aucun") return { issue: "sans_suite" };
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

      // La part de la carte cadeau, retenue au passage en caisse.
      const carteCents = order.giftCardId ? Math.max(0, order.giftCardCents) : 0;
      // Ce que vaut la commande, et ce que le prestataire a pris.
      let totalCents: number;
      let recuCents: number;
      if (provider === "manuel") {
        if (order.status !== "pending" || order.totalCents - carteCents !== recu.montantCents)
          return { issue: "sans_suite" };
        totalCents = order.totalCents;
        recuCents = recu.montantCents;
      } else if (provider === "aucun") {
        if (order.status !== "pending")
          return {
            issue: "refus",
            code: "panier_modifie",
            message: "Votre panier a changé depuis le calcul du total. Revenez à l'étape précédente.",
          };
        // Tout est recalculé ici, sous le verrou : articles, code et dates de
        // la promotion (figées au passage en caisse), livraison, carte. Rien
        // ne se valide sans paiement si ce n'est pas EXACTEMENT 0 €.
        const valeur = await valeurDesLignes(order, order.lastActivityAt ?? new Date(), tx);
        if (
          !validableSansPaiement({
            livrable: valeur.livrable,
            totalCents: valeur.totalCents,
            totalCommandeCents: order.totalCents,
            carteCents,
          })
        )
          return {
            issue: "refus",
            code: "montant_non_nul",
            message: "Cette commande n'est pas gratuite : elle se règle par carte ou par PayPal.",
          };
        totalCents = valeur.totalCents;
        recuCents = 0;
      } else {
        const verdict = await verifierEncaissement(tx, order, provider, externalRef, recu);
        if (!verdict.valide)
          return {
            issue: "ecart",
            attenduCents: verdict.attenduCents,
            recuCents: recu.montantCents,
          };
        totalCents = verdict.totalCents;
        recuCents = verdict.montantCents;
      }

      // Les contrôles du dernier moment, sous verrou : la carte cadeau, le
      // code à usage unique.
      const obstacle = await obstacleAuPaiement(tx, order);
      if (obstacle) {
        if (provider === "aucun" || provider === "manuel")
          return { issue: "refus", code: obstacle.code, message: obstacle.pourLaCliente };
        await noterPaiementBloque(tx, order, provider, externalRef, recu, obstacle);
        return {
          issue: "ecart",
          attenduCents: Math.max(0, totalCents - carteCents),
          recuCents: recu.montantCents,
          message:
            `Votre paiement de ${euros(recu.montantCents)} a bien été reçu, mais ${obstacle.pourLaCliente} ` +
            `Votre commande n'est donc pas encore validée : nous revenons vers vous très vite pour régulariser. ` +
            `Inutile de payer une seconde fois.`,
        };
      }

      // La carte cadeau paie sa part : un mouvement négatif à SON journal,
      // sur le solde vérifié sous verrou juste au-dessus.
      if (carteCents > 0 && order.giftCardId)
        await debiterCarte(tx, order.giftCardId, carteCents, order);

      // Trace le paiement (idempotent sur externalRef). Sans prestataire, il
      // n'y a pas de ligne de paiement : rien n'a été encaissé nulle part.
      const [avant] =
        provider === "aucun"
          ? []
          : await tx
              .select({ status: schema.payments.status })
              .from(schema.payments)
              .where(cePaiement);
      if (provider !== "aucun")
        await tx
          .update(schema.payments)
          .set(
            provider === "manuel"
              ? { status: "succeeded" }
              : { status: "succeeded", amountCents: recuCents },
          )
          .where(cePaiement);

      // Rien à expédier (des cartes cadeaux seules, parties par e-mail) : la
      // commande est traitée dès qu'elle est payée.
      const lignes = await tx
        .select({ giftCard: schema.orderItems.giftCard })
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, orderId));
      const rienAExpedier = lignes.length > 0 && affichesSeules(lignes).length === 0;
      await tx
        .update(schema.orders)
        .set({
          status: "paid",
          totalCents,
          ...(rienAExpedier ? { fulfilledAt: new Date() } : {}),
        })
        .where(eq(schema.orders.id, orderId));

      // Le grand livre reçoit l'encaissement, une ligne par moyen. C'est la
      // seule source de vérité pour le solde de la commande : la somme des
      // ventes retombe sur le total (finances.ts).
      if (provider !== "aucun")
        await tx.insert(schema.orderTransactions).values({
          orderId,
          kind: "sale",
          status: "success",
          amountCents: recuCents,
          gateway: provider,
          externalRef: externalRef ?? null,
        });
      if (carteCents > 0)
        await tx.insert(schema.orderTransactions).values({
          orderId,
          kind: "sale",
          status: "success",
          amountCents: carteCents,
          gateway: "carte_cadeau",
          externalRef: `carte-${order.giftCardId}`,
          message: "Réglé par carte cadeau",
        });
      // Une commande à 0 € a son écriture, de zéro : la page Finances sait
      // ainsi qu'elle a été validée exprès, et ne la prend pas pour une
      // vente dont l'argent manque.
      if (totalCents === 0)
        await tx.insert(schema.orderTransactions).values({
          orderId,
          kind: "sale",
          status: "success",
          amountCents: 0,
          gateway: "gratuit",
          externalRef: externalRef ?? null,
          message: "Commande gratuite, validée sans paiement",
        });
      if (provider === "aucun")
        await tx.insert(schema.orderEvents).values({
          orderId,
          kind: "event",
          message:
            carteCents > 0
              ? `Commande réglée en entier par carte cadeau (${euros(carteCents)}) : validée sans paiement en ligne.`
              : `Commande à 0 € (${order.promoCode ? `code ${order.promoCode}` : "remise"}) : validée sans paiement.`,
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
            `au total de la commande (${euros(recuCents)}) : elle est marquée payée, il n'y a rien à rembourser.`,
        });

      // Les cartes cadeaux achetées naissent maintenant, avec la commande
      // payée : ni avant, ni deux fois.
      const cartes = await emettreCartesDeLaCommande(tx, order);

      return { issue: "payee", order, cartes };
    },
  );

  if (conclusion.issue === "ecart")
    throw new MontantEncaisseDifferent(
      conclusion.attenduCents,
      conclusion.recuCents,
      conclusion.message,
    );
  if (conclusion.issue === "refus") throw new ValidationRefusee(conclusion.code, conclusion.message);
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

  // Les cartes cadeaux achetées partent chez leur destinataire, puis la
  // confirmation chez l'acheteuse, qui les mentionne.
  if (conclusion.cartes.length) await envoyerCartesDeLaCommande(orderId);
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
    // Une vente du stand encaissée au BO (17/11) : ni confirmation aux tarifs
    // du site (le stand les cache), ni avis à la boutique, qui était là.
    if (order.channel === "salon") return;
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
    // La confirmation part dans la langue du client : son compte d'abord,
    // puis la page d'où il a commandé.
    const langue = langueDuDestinataire({
      compte: client?.langue,
      commande: order.langue,
    });

    const lignesDans = (l: Langue) =>
      items.map((it) => {
        // Une carte cadeau : ni format ni cadre, et son destinataire.
        if (it.giftCard)
          return {
            titre: it.giftCard.destinataireEmail
              ? tc(l)("lignes.carteCadeauPour", { email: it.giftCard.destinataireEmail })
              : tc(l)("lignes.carteCadeau"),
            format: null,
            cadre: null,
            quantite: it.quantity,
            unitPriceCents: it.unitPriceCents,
          };
        const cfg = (it.config ?? {}) as Record<string, unknown>;
        const cadre = cadres.find((f) => String(f.id) === String(cfg.frameId ?? ""));
        return {
          titre: it.title ?? tc(l)("lignes.titreParDefaut"),
          format: (cfg.format as string) ?? "A4",
          // Le nom du cadre est sa couleur : la boutique le traduit, comme
          // sur la fiche du produit.
          cadre: cadre ? (nomTraduit(cadre.translations, l) ?? cadre.name) : null,
          quantite: it.quantity,
          unitPriceCents: it.unitPriceCents,
        };
      });
    const lignes = lignesDans(langue);
    const sousTotal = lignes.reduce(
      (s, l) => s + l.unitPriceCents * l.quantite,
      0,
    );
    const port = order.shippingCents ?? 0;
    // La remise se DÉDUIT de ce qui a été facturé : c'est le montant payé qui
    // fait foi, pas un recalcul qui pourrait diverger. La part d'une carte
    // cadeau n'en est pas une : le total reste celui de la commande.
    const remise = Math.max(0, sousTotal + port - order.totalCents);
    // La carte qui a payé une part, code masqué ; les cartes achetées.
    const [cartePayante] = order.giftCardId
      ? await db
          .select({ code: schema.giftCards.code })
          .from(schema.giftCards)
          .where(eq(schema.giftCards.id, order.giftCardId))
      : [];
    const cartesAchetees = await db
      .select({
        montantCents: schema.giftCards.initialAmountCents,
        email: schema.giftCards.recipientEmail,
      })
      .from(schema.giftCards)
      .where(eq(schema.giftCards.orderId, orderId));
    // Rien à livrer : ni mode, ni adresse dans le courrier.
    const sansLivraison = !order.shippingMethod && items.every((it) => it.giftCard);

    if (client?.email) {
      const courrier = courrierConfirmation({
        langue,
        numero: order.number,
        prenomClient:
          prenomPourCourrier(client) || tc(langue)("confirmation.prenomParDefaut"),
        lignes,
        sousTotalCents: sousTotal,
        remiseCents: remise,
        codePromo: order.promoCode,
        portCents: port,
        totalCents: order.totalCents,
        carteCadeauCents: order.giftCardId ? order.giftCardCents : 0,
        carteCadeauMasque: cartePayante ? codeCarteMasque(cartePayante.code) : null,
        cartesEnvoyees: cartesAchetees
          .filter((c): c is { montantCents: number; email: string } => Boolean(c.email))
          .map((c) => ({ montantCents: c.montantCents, email: c.email })),
        // La commande garde le nom français du mode ; la cliente lit celui de
        // sa langue, quand la boutique l'a traduit.
        modeLivraison: sansLivraison ? null : (await livraisonDansLaLangue(order, langue)).nom,
        // Un retrait sur place n'a pas d'adresse de livraison : le courrier
        // dit à la place OÙ venir — le nom du lieu, son adresse et son texte,
        // tels que la cliente les a lus en commandant (lieux-retrait.ts).
        adresse: sansLivraison || lieuDeRetrait(order, langue)
          ? null
          : [
              order.shippingName,
              order.relayPointLabel,
              order.shippingLine1,
              order.shippingLine2,
              [order.shippingPostalCode, order.shippingCity].filter(Boolean).join(" "),
              order.shippingCountry,
            ].filter((v): v is string => Boolean(v)),
        retrait: lignesDuLieu(lieuDeRetrait(order, langue)),
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
      // Celui-ci est lu par la boutique : en français, quelle que soit la
      // langue de la cliente.
      const avis = courrierNouvelleCommande({
        numero: order.number,
        client: client?.name ?? "client inconnu",
        totalCents: order.totalCents,
        lignes: langue === "fr" ? lignes : lignesDans("fr"),
        // Un retrait : le lieu choisi, pour savoir où préparer l'affiche.
        retrait: lignesDuLieu(lieuDeRetrait(order, "fr")),
      });
      await envoyerMail({ ...avis, to: destinataire });
    }
  } catch (e) {
    console.error("[mail] notification de paiement impossible", e);
  }
}

/**
 * Un paiement ouvert avec les clés d'ESSAI vient d'aboutir, alors que la
 * boutique encaisse désormais pour de vrai.
 *
 * C'est la suite d'une bascule (BO › Réglages › Paiements) pendant qu'une
 * cliente était à la caisse : la commande passe « payée », comme tout
 * paiement abouti, mais aucun argent n'est arrivé. Sans ce mot au journal de
 * la commande, elle partirait à l'atelier puis chez la cliente comme une
 * vente. Rien n'est bloqué : c'est peut-être une commande d'essai voulue.
 */
async function signalerPayeeEnEssai(
  orderId: number,
  prestataire: "stripe" | "paypal",
  modePaiement: Mode,
  config: ConfigEffective,
): Promise<void> {
  if (modePaiement !== "test" || config.modeVoulu[prestataire] !== "live") return;
  const nom = prestataire === "stripe" ? "Stripe" : "PayPal";
  console.warn(`[paiement] commande ${orderId} payée en ESSAI (${nom} ${nomDuMode(prestataire, "test")}) alors que la boutique est en réel`);
  await db.insert(schema.orderEvents).values({
    orderId,
    kind: "event",
    message:
      `Payée en ESSAI (${nom} ${nomDuMode(prestataire, "test")}) : aucun argent reçu. ` +
      `Ce paiement a été ouvert avec les clés d'essai, juste avant le passage de la boutique en réel. ` +
      `Ne pas expédier sans vérifier.`,
  });
}

// --- Montage des routes -------------------------------------------------------

/**
 * Cette commande est-elle visible par la personne connectée ?
 *
 * Le propriétaire voit tout. Un vendeur ne voit que les ventes des stands qui
 * lui sont confiés, et rien s'il n'en a aucun (vendeurs.ts) : la liste des
 * commandes le bornait déjà, mais la fiche et le fichier d'impression ne le
 * faisaient pas, et les identifiants se suivent. Compter de un en un suffisait.
 */
function commandeVisiblePar(
  c: Context,
  commande: CommandeABorner | undefined,
): boolean {
  if (!commande) return false;
  return commandeVisible(c.get("utilisateur"), commande);
}

export function mountConfiguratorRoutes(app: Hono) {
  // === Données configurateur (public) ====================================

  // L'emprise des dessins des personnages se mesure d'avance, quelques
  // secondes après le démarrage pour ne pas le ralentir : la première visite
  // après une mise en ligne trouve ainsi la composition complète (voir
  // emprise-personnages.ts). Les mesures déjà rangées ne se refont pas.
  setTimeout(() => {
    Promise.all([
      db
        .select({ url: schema.characterTypes.baseSvgUrl })
        .from(schema.characterTypes)
        .where(isNull(schema.characterTypes.archivedAt)),
      // Les pièces aussi : leur emprise cadre la vignette de celles qui ne
      // sont pas dessinées dans le cadre 500 × 1000 (cf. cadrageDeVignette).
      db
        .select({ url: schema.assets.svgUrl })
        .from(schema.assets)
        .where(and(isNull(schema.assets.characterTypeId), isNull(schema.assets.archivedAt))),
    ])
      .then(([persos, pieces]) =>
        preparerLesEmprises([...persos, ...pieces].map((l) => l.url)),
      )
      .catch(() => {
        // Sans base au démarrage, les mesures se feront à la première visite.
      });
  }, 5000).unref?.();

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
    const langue = langueDuVisiteur(c);
    const includeArchived = c.req.query("all") === "1";
    // La catégorie vient de la table character_category (jointure), mais le
    // contrat exposé au front ne change pas : `category` reste son NOM.
    // L'ordre suit la position des catégories, puis celle des personnages.
    const types = await db
      .select({
        t: schema.characterTypes,
        categoryName: schema.characterCategories.name,
        categoryTranslations: schema.characterCategories.translations,
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
    // Où chaque dessin se trouve vraiment dans son cadre : la composition de
    // l'affiche s'en sert pour serrer la rangée et reconnaître les petits.
    // Déjà mesurée, elle se lit en mémoire ; sinon `null`, et elle se mesure
    // en arrière-plan pour la visite suivante (emprise-personnages.ts).
    const emprises = await Promise.all(
      types.map(({ t }) => empriseDuPersonnage(t.baseSvgUrl)),
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
      // L'identifiant départage deux numéros égaux (il n'en reste plus depuis
      // 0072) : la tenue par défaut, lue par numéro, retombe toujours sur la
      // même pièce.
      .orderBy(asc(schema.assets.position), asc(schema.assets.id));
    // Un tiroir par type d'affiche, y compris ceux créés au back-office :
    // le configurateur cherche `slots[vue]`, il ne doit jamais tomber sur un
    // trou parce qu'un type est arrivé après la mise en production.
    const vues = await db
      .select({ slug: schema.posterViews.slug })
      .from(schema.posterViews);
    // Et un tiroir COMPLET : les quatre emplacements, même vides. Un type
    // tout juste créé n'a encore aucune pièce ; son tiroir `{}` faisait lire
    // `clothes` sur rien au configurateur, et « + Ajouter un personnage » ne
    // faisait plus rien, sans un mot (essayé le 6/10 avec un type « Mariés »).
    const tiroirVide = (): Record<string, unknown[]> => ({
      clothes: [],
      pants: [],
      hair: [],
      accessory: [],
    });
    const slots: Record<string, Record<string, unknown[]>> = {};
    for (const v of vues) slots[v.slug] = tiroirVide();
    slots["front"] ??= tiroirVide();
    // Où chaque pièce se trouve dans le cadre : de quoi cadrer la vignette de
    // celles dessinées dans un autre cadre. Même mesure, même cache que les
    // personnages.
    const empriseDesPieces = await Promise.all(
      variants.map((a) => empriseDuPersonnage(a.svgUrl)),
    );
    for (const [i, a] of variants.entries()) {
      // Une pièce sans type explicite reste rattachée au premier type,
      // « de face » — c'est ce que faisait le code d'avant.
      const view = a.view ?? "front";
      slots[view] ??= tiroirVide();
      (slots[view]![a.slot] ??= []).push({
        id: a.id,
        slot: a.slot,
        name: a.name,
        svgUrl: a.svgUrl,
        view,
        colorZones: a.colorZones,
        // Les anciennes cases « Le client peut la changer » : envoyées telles
        // qu'en base, le module ne les lit plus (le client change toutes les
        // couleurs, cf. groupesProposesDeLaPiece).
        zonesMasquees: a.zonesMasquees,
        // La part du dessin peinte par chaque zone : elle désigne la couleur
        // principale et range les familles de teinte (les ombres).
        partsDesZones: partsPourLaBoutique(a),
        // Nuances réunies sous une seule rangée de pastilles, et leurs noms.
        groupesCouleurs: a.groupesCouleurs ?? null,
        // Familles de couleurs d'un dessin en PIXELS. La carte des teintes
        // n'en fait pas partie : elle ne sert qu'au back-office, et pèse plus
        // que tout le reste de la bibliothèque réuni.
        // Une pièce les propose toutes au client (cf.
        // avecToutesLesFamillesProposees).
        couleursImage: avecToutesLesFamillesProposees(famillesPourLaBoutique(a.couleursImage)),
        position: a.position,
        // Catégorie de la pièce : c'est elle qui porte le nuancier proposé.
        pieceCategoryId: a.pieceCategoryId,
        emprise: empriseDesPieces[i] ?? null,
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

    // Les quatre nuanciers des personnages (peau, cheveux, vêtements,
    // pantalon), tels que la boutique les a réglés — leurs couleurs d'origine
    // tant qu'elle n'y a pas touché (cf. nuanciers.ts).
    const nuanciersBase = await lireNuanciersBase();

    return c.json({
      pieceCategories: categoriesPieces.map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        slot: p.slot,
        colors: p.colors ?? [],
        // L'ancienne règle « toutes / principale » : envoyée telle qu'en
        // base, le module ne la lit plus — chaque pièce propose toutes ses
        // couleurs (cf. groupesProposesDeLaPiece).
        couleursProposees: couleursProposees(p.couleursProposees),
      })),
      nuanciersBase,
      characters: types.map(({ t, categoryName, categoryTranslations }, i) => ({
        id: t.id,
        slug: t.slug,
        // Le nom du personnage dans la langue du visiteur, le français à
        // défaut : la liste « vos personnages » et les bulles des vignettes
        // l'affichent. Les commandes, elles, ne citent que son identifiant.
        name: texteDansLaLangue(t.translations, langue, "name", t.name),
        // Le nom de l'onglet dans la langue du visiteur (?lang=), le
        // français à défaut : il ne sert qu'à regrouper, jamais d'identifiant.
        category: categoryName
          ? (nomTraduit(categoryTranslations, langue) ?? categoryName)
          : null,
        categoryId: t.categoryId,
        position: t.position,
        archived: t.archivedAt != null,
        // Masqué au BO : le module ne le propose plus, mais il vient quand
        // même, pour qu'une affiche qui le porte déjà s'affiche toujours.
        active: t.active,
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
        // L'emprise réelle de son dessin, en fractions du cadre (voir plus haut).
        emprise: emprises[i] ?? null,
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
    // Une pièce propose toutes ses familles au client, cochées ou non au
    // back-office (cf. avecToutesLesFamillesProposees) : la même règle que
    // le module et l'impression, pour que l'image suive son choix.
    return servirImageRecoloree(
      c,
      a && { ...a, couleursImage: avecToutesLesFamillesProposees(a.couleursImage) },
    );
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
    // Un fond dont l'image manque sur le disque ne se propose pas non plus :
    // sa vignette sortait cassée et l'affiche se composait sur du vide. Le
    // back-office le signale (Décors des affiches) pour qu'on le remplace.
    const presents = <T extends { url: string }>(fonds: T[]) =>
      fonds.filter((b) => !fichierDAssetManquant(b.url));

    if (productId) {
      // 1. rattachement explicite
      const linked = presents(
        await db
          .select()
          .from(schema.backgrounds)
          .where(
            and(eq(schema.backgrounds.productId, Number(productId)), vivant),
          )
          .orderBy(asc(schema.backgrounds.position)),
      );
      if (linked.length > 0) return c.json(linked.map(project));

      // 2. correspondance par ville (nom du produit)
      const [product] = await db
        .select({ name: schema.products.name })
        .from(schema.products)
        .where(eq(schema.products.id, Number(productId)));
      if (product) {
        // La règle est écrite une fois, dans decors.ts : l'écran « Décors des
        // affiches » du back-office l'applique aussi, pour dire ce que le
        // module proposera. Elle gère « AMIENS Cathédrale » (→ AMIENS), « LE
        // TRÉPORT Phare » (→ TREPORT) et « ITALIE Venise » sans liste de
        // villes en dur.
        const all = presents(
          await db
            .select()
            .from(schema.backgrounds)
            .where(vivant)
            .orderBy(asc(schema.backgrounds.position)),
        );
        const cityMatch = decorsParLeNom(product.name, all);
        if (cityMatch.length > 0) return c.json(cityMatch.map(project));
      }
    }

    // 3. repli : bibliothèque complète (jamais vide)
    const rows = presents(
      await db
        .select()
        .from(schema.backgrounds)
        .where(vivant)
        .orderBy(asc(schema.backgrounds.position))
        .limit(500),
    );
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
    // Dans l'ordre où les affiches ont été ajoutées : sans ORDER BY, la base
    // rendait en dernier la ligne qu'on venait de modifier, et le panier
    // changeait d'ordre à chaque « + » (recette du 17/11).
    const items = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, order.id))
      .orderBy(asc(schema.orderItems.id));
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
    // Chaque ligne dit la part de son prix due au cadre (`cadreCents`) : le
    // panier et la caisse calculent les remises avec le même moteur que le
    // serveur, et une affiche offerte « cadre non compris » ne se déduit pas
    // sans elle. Une seule source, lignesDuMoteur, pour les lignes d'avant.
    const pourLeMoteur = await lignesDuMoteur(items);
    // Le panier expose son poids : la boutique en a besoin pour n'afficher
    // que les modes de livraison qui savent porter le colis, AVANT que le
    // client ait saisi la moindre adresse.
    return c.json({
      cartId,
      orderId: order.id,
      status: order.status,
      items: items.map((it, i) => ({ ...it, cadreCents: pourLeMoteur[i]?.cadreCents ?? 0 })),
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

  /**
   * Ajoute une CARTE CADEAU au panier : un montant libre, 5 € au moins, en
   * euros ronds, sans plafond annoncé (18/11).
   *
   * Le montant est vérifié ici (montantCarteValide) et devient le prix de la
   * ligne : le navigateur n'a pas d'autre mot à dire. Il se change ensuite
   * dans le récapitulatif, revérifié de même (changerLeMontantDUneCarte) ;
   * rien d'autre ne bouge. Quantité 1 : chaque carte a son destinataire,
   * saisi à la caisse.
   *
   * Pas au stand : la carte part par e-mail après un paiement en ligne, le
   * stand encaisse de la main à la main.
   */
  async function ajouterUneCarte(
    c: Context,
    cartId: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const brut = (body.carteCadeau ?? {}) as { montantCents?: unknown };
    const montant = Number(brut.montantCents);
    if (!montantCarteValide(montant))
      return c.json(
        {
          error: "Le montant d'une carte cadeau est de 5 € au moins, en euros ronds.",
          code: "montant_carte",
        },
        400,
      );
    if (requeteDuStand(c))
      return c.json(
        { error: "La carte cadeau s'achète sur le site, pas au stand.", code: "carte_au_stand" },
        409,
      );
    const langue = langueDeLaPage(c, body.langue);
    await naitreLePanier(cartId, langue);
    const ligne = await db.transaction(async (tx) => {
      const order = await panierModifiable(tx, cartId);
      if (!order) return null;
      const [ecrite] = await tx
        .insert(schema.orderItems)
        .values({
          orderId: order.id,
          productId: null,
          variantId: null,
          // Ni configuration, ni format, ni cadre : rien à imprimer.
          config: null,
          title: "Carte cadeau",
          unitPriceCents: montant,
          frameCents: 0,
          quantity: 1,
          giftCard: {
            montantCents: montant,
            destinataireEmail: null,
            destinatairePrenom: null,
            message: null,
          },
        })
        .returning();
      await panierModifie(tx, order, false, langue);
      return ecrite ?? null;
    });
    if (!ligne) return c.json({ error: "panier_clos" }, 409);
    return c.json({ ...ligne, cadreCents: 0 });
  }

  /**
   * Change le MONTANT d'une carte cadeau du panier (18/11, Alexandra : « on
   * peut changer ici le montant », dans le récapitulatif de la caisse).
   *
   * Revérifié comme à l'ajout (montantCarteValide). Le prix de la ligne et le
   * montant de la carte suivent ensemble ; le destinataire déjà saisi reste.
   * Sous le verrou du panier, comme toute modification de ligne : un panier
   * payé ou clos ne bouge plus (panierModifiable).
   */
  async function changerLeMontantDUneCarte(
    c: Context,
    cartId: string,
    itemId: number,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const brut = (body.carteCadeau ?? {}) as { montantCents?: unknown };
    const montant = Number(brut.montantCents);
    if (!montantCarteValide(montant))
      return c.json(
        {
          error: "Le montant d'une carte cadeau est de 5 € au moins, en euros ronds.",
          code: "montant_carte",
        },
        400,
      );
    const ligne = await db.transaction(async (tx) => {
      const trouve = await loadCartItem(tx, cartId, itemId);
      if (!trouve) return null;
      if (!trouve.item.giftCard) return "pas_une_carte" as const;
      const [ecrite] = await tx
        .update(schema.orderItems)
        .set({
          unitPriceCents: montant,
          giftCard: { ...trouve.item.giftCard, montantCents: montant },
        })
        .where(eq(schema.orderItems.id, itemId))
        .returning();
      await panierModifie(tx, trouve.order, false, langueDeLaPage(c, body.langue));
      return ecrite ?? null;
    });
    if (!ligne) return c.notFound();
    if (ligne === "pas_une_carte")
      return c.json(
        { error: "Cette ligne n'est pas une carte cadeau.", code: "pas_une_carte" },
        400,
      );
    return c.json({ ...ligne, cadreCents: 0 });
  }

  /**
   * Le panier naît avec son premier article. « onConflictDoNothing » : deux
   * ajouts partis au même instant d'un panier neuf ne doivent pas en créer
   * deux — l'index unique sur l'identifiant de panier garde le premier, et le
   * second y ajoute simplement sa ligne.
   */
  async function naitreLePanier(cartId: string, langue: Langue | null): Promise<void> {
    const [existe] = await db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(eq(schema.orders.clientOrderId, cartId));
    if (existe) return;
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
        langue,
      })
      .onConflictDoNothing();
  }

  /** Ajoute une ligne au panier (crée le draft si besoin). */
  app.post("/cart/:cartId/items", async (c) => {
    const cartId = c.req.param("cartId");
    const body = await c.req.json();
    // Une carte cadeau : un montant, et rien d'autre (ajouterUneCarte).
    if (body && typeof body === "object" && (body as Record<string, unknown>).carteCadeau != null)
      return ajouterUneCarte(c, cartId, body as Record<string, unknown>);
    const parsed = posterConfigSchema.safeParse(body.config);
    if (!parsed.success)
      return c.json({ error: "config invalide", details: parsed.error.issues }, 400);

    // La langue de la page : le panier la garde dès sa naissance, pour qu'un
    // visiteur qui ne passe jamais en caisse puisse quand même être relancé
    // dans sa langue s'il laisse un jour son adresse.
    const langue = langueDeLaPage(c, body.langue);
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
          langue,
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
    const { unitPriceCents, frameCents } = await resolvePrixLigne(
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
          frameCents,
          quantity: Math.max(1, Number(body.quantity ?? 1)),
        })
        .returning();
      await panierModifie(tx, order, requeteDuStand(c), langue);
      return ligne;
    });
    if (!item) return c.json({ error: "panier_clos" }, 409);
    const avecCadre = { ...item, cadreCents: item.frameCents ?? 0 };
    return c.json(cadreRetire ? { ...avecCadre, cadreRetire } : avecCadre);
  });

  /** MODIFIE une ligne existante (réouverture configurateur — §18.3 I). */
  app.put("/cart/:cartId/items/:itemId", async (c) => {
    const itemId = Number(c.req.param("itemId"));
    const body = await c.req.json();
    // Le montant d'une carte cadeau, et rien d'autre (changerLeMontantDUneCarte).
    if (body && typeof body === "object" && (body as Record<string, unknown>).carteCadeau != null)
      return changerLeMontantDUneCarte(
        c,
        c.req.param("cartId"),
        itemId,
        body as Record<string, unknown>,
      );
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
      // Une carte cadeau ne prend pas de composition d'affiche : seul son
      // montant change, par sa propre demande (carteCadeau, plus haut).
      if (trouve.item.giftCard) return "carte" as const;
      const { unitPriceCents, frameCents } = await resolvePrixLigne(
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
          frameCents,
          quantity:
            body.quantity != null
              ? Math.max(1, Number(body.quantity))
              : undefined,
        })
        .where(eq(schema.orderItems.id, itemId))
        .returning();
      await panierModifie(
        tx,
        trouve.order,
        requeteDuStand(c),
        langueDeLaPage(c, body.langue),
      );
      return ligne ?? null;
    });
    if (!item) return c.notFound();
    if (item === "carte")
      return c.json(
        {
          error: "Une carte cadeau n'a pas de composition : seul son montant se change.",
          code: "carte_non_modifiable",
        },
        409,
      );
    const avecCadre = { ...item, cadreCents: item.frameCents ?? 0 };
    return c.json(cadreRetire ? { ...avecCadre, cadreRetire } : avecCadre);
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
    // Une commande ANNULÉE est close aussi (recette du 17/11 : revalider la
    // caisse la repassait « en attente de paiement », remboursée comprise).
    if (draft.status !== "draft" && draft.status !== "pending")
      return c.json({ error: "panier_clos", code: "panier_clos" }, 409);

    const items = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, draft.id));
    if (items.length === 0) return c.json({ error: "panier vide", code: "panier_vide" }, 400);

    // Une fiche client par commande : c'est ce que produisait l'INSERT
    // systématique d'avant, et un même client finissait éparpillé en autant de
    // fiches que d'achats. On rattache donc la commande au compte connecté
    // quand il y en a un, sinon à la fiche qui porte déjà cette adresse, et on
    // n'en crée une qu'en dernier recours.
    // Commander SANS COMPTE, en invitée (18/11, Alexandra) : la commande va
    // à la fiche qui porte déjà cette adresse e-mail, ou à une fiche créée
    // pour elle — jamais une fiche par achat. Une invitée ne lit ni n'écrit
    // aucun carnet d'adresses (plus bas) : l'e-mail tapé peut être celui
    // d'une autre, et son carnet ne la regarde pas.
    const connecte = await clientDeLaRequete(c);
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
    // Le numéro, lui, ne se prend que dans la transaction, juste avant
    // l'UPDATE qui l'écrit (prochainNumeroDeCommande) : lu ici, deux paniers
    // validés au même moment tiraient le même WEB-.
    //
    // Le code promo : retrouvé par sa CLÉ (casse, tirets et espaces
    // ignorés), et gardé tel que la boutique l'a écrit. Un code qui ne répond
    // plus — éteint, archivé, hors de ses dates depuis qu'il a été vérifié à
    // la caisse — est refusé en clair plutôt qu'ignoré : la cliente doit voir
    // son total changer avant de payer. Un code à usage unique déjà servi
    // aussi ; le décompte qui fait foi se refait au paiement, sous verrou.
    const saisieCode = normaliserCode(body.promoCode);
    const regleDuCode = saisieCode ? await promotionDuCode(db, saisieCode) : null;
    if (saisieCode && !regleDuCode)
      return c.json({ error: CODE_NON_VALABLE, code: "code_invalide" }, 409);
    if (
      regleDuCode &&
      estUsageUnique(regleDuCode.config) &&
      (await utilisationsDuCode(db, regleDuCode.code ?? "")) > 0
    )
      return c.json({ error: CODE_DEJA_UTILISE, code: "code_deja_utilise" }, 409);
    const code = regleDuCode ? normaliserCode(regleDuCode.code) : "";

    // La carte cadeau saisie à la caisse : retrouvée par la clé de son code,
    // et refusée d'une seule phrase si elle ne peut pas payer (désactivée,
    // échue, vide, inconnue). Chaque essai compte dans le frein de la caisse.
    const saisieCarte = String(body.carteCadeau ?? "").trim().slice(0, 80);
    let carteRetenue: typeof schema.giftCards.$inferSelect | null = null;
    if (saisieCarte) {
      if (tropDEssaisDeCode(c))
        return c.json(
          { error: "Trop d'essais. Réessayez dans quelques minutes.", code: "trop_d_essais" },
          429,
        );
      const cle = cleDeCarte(saisieCarte);
      carteRetenue = cle ? await carteParCle(db, cle) : null;
      if (!carteRetenue || !carteUtilisable(carteRetenue))
        return c.json({ error: CODE_NON_VALABLE, code: "carte_invalide" }, 409);
    }
    // Pas `langueDeLaPage` : c'est la caisse du SITE, quoi que dise le cookie
    // du stand (voir plus bas), et sa page parle la langue qu'elle annonce.
    const langueCaisse = langueLue(body.langue);

    // Livraison : mode et adresse viennent du client, le prix vient de la
    // base. Sans mode choisi, on refuse — mieux vaut une commande bloquée
    // qu'un colis sans destination. Des cartes cadeaux seules n'ont rien à
    // livrer : ni mode, ni adresse.
    const liv = (body.shipping ?? {}) as Record<string, unknown>;
    const modeSlug = String(liv.method ?? "").trim();
    const pays = normaliserPays(liv.country) || "FR";
    if (!modeSlug && affichesSeules(items).length > 0)
      return c.json({ error: "mode de livraison requis", code: "mode_indisponible" }, 400);
    const ligne1 = String(liv.line1 ?? "").trim();
    const ville = String(liv.city ?? "").trim();
    const cp = String(liv.postalCode ?? "").trim();
    // Le lieu de retrait choisi, pour un mode « retrait sur place » : relu
    // plus bas, dans la transaction (actif, pas archivé).
    const idLieu = Number(liv.pickupPointId);
    // Lu avant la transaction, qui ne doit pas prendre une seconde connexion
    // pendant qu'elle tient le verrou (voir Executeur). Le cookie du stand
    // n'y change rien : c'est la caisse du SITE, le stand a la sienne.
    const cadresSite = await cadresSurLeSite();

    // Un point relais choisi chez SendCloud est redemandé à SendCloud, avant
    // la transaction pour la même raison : le navigateur peut avoir gardé un
    // point fermé depuis, ou envoyer n'importe quoi. Un point INCONNU est
    // refusé ; une panne de SendCloud ne bloque pas la commande, le point a
    // été choisi dans leur liste quelques minutes plus tôt.
    const idRelais = String(liv.relayPointId ?? "").trim();
    if (idRelais.startsWith(PREFIXE_SENDCLOUD)) {
      // Le point doit aussi être du réseau du mode payé : un point Mondial
      // Relay envoyé avec un mode Colissimo serait un colis que personne ne
      // sait livrer. Le mode n'est relu sous verrou que plus bas ; ici, il
      // ne sert qu'à nommer le réseau attendu.
      const [modeVise] = await db
        .select({ carrier: schema.shippingMethods.carrier })
        .from(schema.shippingMethods)
        .where(eq(schema.shippingMethods.slug, modeSlug));
      const etat = await verifierPointSendcloud(idRelais, pays, modeVise?.carrier);
      if (etat === "inconnu")
        return c.json(
          {
            error:
              "Ce point relais n'est plus disponible. Choisissez-en un autre dans la liste.",
            code: "point_relais_inconnu",
          },
          400,
        );
      if (etat === "autre_transporteur")
        return c.json(
          {
            error:
              "Ce point relais ne correspond pas au mode de livraison choisi. Choisissez-en un dans la liste.",
            code: "point_relais_transporteur",
          },
          400,
        );
    }

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
      if (panier.status !== "draft" && panier.status !== "pending")
        return { erreur: "panier_clos", statut: 409 as const, code: "panier_clos" };
      const lignes = await tx
        .select()
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, panier.id));
      if (lignes.length === 0)
        return { erreur: "panier vide", statut: 400 as const, code: "panier_vide" };

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
      // Des affiches à livrer ? Sinon (cartes cadeaux seules), ni mode, ni
      // adresse, ni port : les cartes partent par e-mail.
      const avecAffiches = affichesSeules(lignes).length > 0;
      // Les promotions en jeu sont FIGÉES avec la commande (`promotions`) :
      // c'est avec elles que le paiement sera vérifié, quoi que la boutique
      // modifie entre-temps, et c'est leur remise que lira la page Finances.
      let calcul: Awaited<ReturnType<typeof calculerArticles>>;
      try {
        calcul = await calculerArticles(lignes, code, maintenant, tx);
      } catch (e) {
        if (e instanceof LigneCarteInvalide)
          return { erreur: e.message, statut: 409 as const, code: "carte_ligne_invalide" };
        throw e;
      }
      const articles = calcul.totalCents;
      const port = avecAffiches
        ? await computeShippingCents(lignes, modeSlug, pays, code, maintenant, tx)
        : SANS_LIVRAISON;
      if (!port)
        return { erreur: "mode de livraison indisponible", statut: 400 as const, code: "mode_indisponible" };
      // Une nature que la liste ne connaît plus ne dit pas quoi demander au
      // client : ni adresse, ni point relais. On refuse la commande plutôt que
      // de l'accepter sans savoir où livrer — c'est ce qui arriverait à un
      // vieux mode restauré des archives, dont la nature a disparu depuis.
      if (avecAffiches && !CODES_NATURE.includes(port.kind))
        return { erreur: "mode de livraison indisponible", statut: 400 as const, code: "mode_indisponible" };
      // Une livraison à domicile sans adresse n'arrive nulle part ; un point
      // relais sans point relais non plus.
      // Un code postal à la forme de son pays (codePostalValide) : « 123 » ou
      // « abc » passaient, et le colis partait sans pouvoir arriver.
      if (
        demandeUneAdresse(port.kind) &&
        (!ligne1 || !ville || !cp || !codePostalValide(cp, pays))
      )
        return { erreur: "adresse de livraison incomplète", statut: 400 as const, code: "adresse_incomplete" };
      if (demandeUneAdresse(port.kind) && !telephoneValide(liv.phone))
        return { erreur: "numéro de téléphone invalide", statut: 400 as const, code: "telephone_invalide" };
      if (demandeUnPointRelais(port.kind) && !idRelais)
        return { erreur: "point relais requis", statut: 400 as const, code: "point_relais_requis" };
      // Quand SendCloud cherche les points de ce transporteur, le point doit
      // venir de sa liste : c'est son identifiant qui servira à l'étiquette.
      if (
        demandeUnPointRelais(port.kind) &&
        sendcloudGerePoints(port.carrier) &&
        !idRelais.startsWith(PREFIXE_SENDCLOUD)
      )
        return {
          erreur: "Choisissez votre point relais dans la liste proposée.",
          statut: 400 as const,
          code: "point_relais_requis",
        };

      // Un retrait sur place se fait QUELQUE PART : le lieu choisi est relu
      // ici, actif et non archivé. La cliente a pu garder la caisse ouverte
      // pendant qu'on fermait le chalet ; on refuse alors, avec un message,
      // plutôt que de l'attendre à un endroit qui n'existe plus. Ce que la
      // commande garde, c'est une COPIE du lieu tel qu'elle l'a lu.
      const lieuLu =
        port.kind === "pickup" ? await lieuPourLaCommande(tx, idLieu) : null;
      // Le lieu d'un stand ne se choisit que sous « Retrait au stand », et
      // ce mode-là n'accepte que les lieux des stands (17/11) : sans cela,
      // une adresse modifiée à la main prendrait un retrait gratuit ailleurs.
      const lieu =
        lieuLu && (lieuLu.standId != null) === (modeSlug === MODE_RETRAIT_STAND)
          ? lieuLu
          : null;
      if (port.kind === "pickup" && !lieu)
        return {
          erreur: "Choisissez le lieu où retirer votre commande.",
          statut: 400 as const,
          code: "lieu_retrait_requis",
        };
      // Retrait au stand : la cliente coche qu'elle viendra avant le dernier
      // jour du stand (17/11). Le serveur le vérifie aussi : la case ne vit
      // pas que dans la page.
      const retraitCompris = liv.retraitCompris === true;
      if (lieu?.standId != null && lieu.retirerAvant && !retraitCompris)
        return {
          erreur: "Cochez que vous viendrez chercher votre commande au stand avant sa fermeture.",
          statut: 400 as const,
          code: "retrait_stand_compris",
        };

      const total = articles + port.cents;

      // La carte cadeau paie jusqu'au total, sans dépasser son solde, et
      // jamais les cartes cadeaux que la commande achète. Rien n'est débité
      // ici : la part est RETENUE, et la carte ne paie qu'au paiement de la
      // commande (markOrderPaid), où son solde est relu sous verrou.
      const carteCents = carteRetenue
        ? partCarteCadeau(total, calcul.cartesCents, carteRetenue.balanceCents)
        : 0;
      if (carteRetenue && carteCents === 0 && calcul.cartesCents > 0)
        return {
          erreur:
            "Une carte cadeau ne peut pas payer une autre carte cadeau : retirez-la, ou ajoutez des affiches à votre panier.",
          statut: 409 as const,
          code: "carte_sur_carte",
        };

      // Le destinataire de chaque carte cadeau achetée : son e-mail (celle de
      // l'acheteuse à défaut), son prénom et le petit mot, facultatifs.
      const saisies = new Map<number, Record<string, unknown>>();
      for (const d of Array.isArray(body.cartesCadeaux) ? body.cartesCadeaux : [])
        if (d && typeof d === "object")
          saisies.set(Number((d as { itemId?: unknown }).itemId), d as Record<string, unknown>);
      for (const l of cartesSeules(lignes)) {
        const d = saisies.get(l.id);
        const emailDest =
          String(d?.email ?? "").trim().toLowerCase() || (customer!.email ?? emailNormalise).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailDest) || emailDest.length > 200)
          return {
            erreur: "L'adresse e-mail du destinataire d'une carte cadeau n'est pas valable.",
            statut: 400 as const,
            code: "carte_email",
          };
        await tx
          .update(schema.orderItems)
          .set({
            giftCard: {
              montantCents: l.giftCard!.montantCents,
              destinataireEmail: emailDest,
              destinatairePrenom: String(d?.prenom ?? "").trim().slice(0, CARTE_PRENOM_MAX) || null,
              message: String(d?.message ?? "").trim().slice(0, CARTE_MESSAGE_MAX) || null,
            },
          })
          .where(eq(schema.orderItems.id, l.id));
      }

      // Garde le numéro s'il en a déjà un (retry) — relu sous le verrou : un
      // autre passage en caisse du même panier a pu l'attribuer entre-temps.
      // Sinon en prend un, en dernier : le verrou du compteur ne dure que
      // l'UPDATE.
      const number = /^WEB-\d+$/.test(panier.number)
        ? panier.number
        : await prochainNumeroDeCommande(tx, "WEB-");
      // Une vente du stand rouverte (« Revenir à ma commande ») revient au
      // navigateur de la tablette ; sortie du mode stand, elle peut passer
      // par cette caisse. Elle devient alors une commande du SITE, comme le
      // stand fait d'un panier du site une vente à lui en la validant : elle
      // sera payée en ligne, livrée, et ne compte plus dans les chiffres ni
      // chez les vendeurs du stand. Restée « salon » avec son WEB-, elle
      // était invisible du compteur du site, qui redonnait ce numéro-là à
      // chaque commande suivante : 500 à la caisse, pour tout le monde.
      if (panier.channel !== "web")
        await tx.insert(schema.orderEvents).values({
          orderId: panier.id,
          kind: "event",
          message:
            number === panier.number
              ? `Vente du stand passée par la caisse du site : elle devient une commande du site (${number}).`
              : `Vente du stand (${panier.number}) passée par la caisse du site : elle devient la commande ${number}.`,
        });
      // La validation au stand avait posé la note « Stand : <événement> » et
      // l'étiquette de l'événement (salon.ts) : devenue une commande du site,
      // la vente ne doit plus se ranger avec ce marché dans les recherches et
      // les filtres. Une note écrite à la main, elle, reste.
      const evenementDuStand =
        panier.channel !== "web" && panier.internalNote?.startsWith("Stand : ")
          ? panier.internalNote.slice("Stand : ".length)
          : null;

      // La FACTURATION (18/11) : l'adresse par défaut du carnet de la
      // cliente, lue ici et pas dans la page. L'adresse de livraison du jour
      // entre au carnet quand elle le demande (« Garder cette adresse dans
      // mon compte »), ou d'office si le carnet est vide : elle devient alors
      // son adresse par défaut, donc celle de la facture. Jamais en double.
      // Une INVITÉE (sans session) n'a pas de carnet ici : la fiche trouvée
      // par son e-mail peut être celle d'une autre personne. Sa facturation
      // est l'adresse de livraison qu'elle vient de saisir, rien d'autre.
      const carnet = connecte ? await carnetDe(tx, customer!.id) : [];
      const saisie = {
        name: String(liv.name ?? "").trim() || name || null,
        line1: ligne1,
        line2: String(liv.line2 ?? "").trim() || null,
        postalCode: cp,
        city: ville,
        country: pays,
        phone: String(liv.phone ?? "").trim() || null,
      };
      let facturation: { name: string | null; line1: string | null; line2: string | null; postalCode: string | null; city: string | null; country: string | null } | null =
        connecte
          ? (carnet[0] ?? null)
          : avecAffiches && !lieu && ligne1 && cp && ville
            ? saisie
            : null;
      if (
        connecte &&
        avecAffiches &&
        !lieu &&
        ligne1 &&
        cp &&
        ville &&
        (liv.enregistrer === true || carnet.length === 0) &&
        !carnet.some((a) => memeAdresse(a, saisie))
      ) {
        const premiere = carnet.length === 0;
        const [ajoutee] = await tx
          .insert(schema.customerAddresses)
          .values({
            customerId: customer!.id,
            ...saisie,
            isDefaultBilling: premiere,
            isDefaultShipping: premiere,
          })
          .returning();
        if (premiere) facturation = ajoutee ?? null;
      }

      const [order] = await tx
        .update(schema.orders)
        .set({
          number,
          // La date de la commande : `createdAt: maintenant`, plus bas, posée
          // à CHAQUE passage en caisse (un nouvel essai du même panier garde
          // son numéro, mais prend l'heure de ce dernier passage).
          channel: "web",
          standId: null,
          ...(evenementDuStand !== null
            ? {
                internalNote: null,
                tags: (panier.tags ?? []).filter((t) => t !== evenementDuStand),
              }
            : {}),
          status: "pending",
          customerId: customer!.id,
          totalCents: total,
          promoCode: code || null,
          promotions: calcul.figees,
          // La carte cadeau retenue, et la part qu'elle paiera : le
          // prestataire n'encaissera que le reste.
          giftCardId: carteCents > 0 ? carteRetenue!.id : null,
          giftCardCents: carteCents,
          // Des cartes cadeaux seules : ni mode, ni adresse, ni point relais.
          shippingMethod: avecAffiches ? modeSlug : null,
          shippingLabel: avecAffiches ? port.label : null,
          shippingDescription: avecAffiches ? port.description : null,
          shippingCents: port.cents,
          // Poids figé : le catalogue changera, le colis a pesé ce qu'il a pesé.
          weightGrams: port.poidsGrammes,
          shippingName: avecAffiches ? String(liv.name ?? "").trim() || name : null,
          shippingLine1: avecAffiches ? ligne1 || null : null,
          shippingLine2: avecAffiches ? String(liv.line2 ?? "").trim() || null : null,
          shippingPostalCode: avecAffiches ? cp || null : null,
          shippingCity: avecAffiches ? ville || null : null,
          shippingCountry: avecAffiches ? pays : null,
          shippingPhone: avecAffiches ? String(liv.phone ?? "").trim() || null : null,
          // L'adresse de facturation, figée comme celle de livraison (vide
          // sans carnet : la facture reprend alors la livraison).
          billingName: facturation ? facturation.name || customer!.name || name || null : null,
          billingLine1: facturation?.line1 ?? null,
          billingLine2: facturation?.line2 ?? null,
          billingPostalCode: facturation?.postalCode ?? null,
          billingCity: facturation?.city ?? null,
          billingCountry: facturation
            ? normaliserPays(facturation.country) || facturation.country || null
            : null,
          // Un point relais pour un mode « relais ». Pour un retrait, plus
          // rien ici : le repère « stand:<id> » d'avant est remplacé par le
          // lieu choisi, juste dessous.
          relayPointId: lieu || !avecAffiches ? null : String(liv.relayPointId ?? "").trim() || null,
          relayPointLabel: lieu || !avecAffiches ? null : String(liv.relayPointLabel ?? "").trim() || null,
          pickupPointId: lieu?.id ?? null,
          pickupPoint: lieu
            ? {
                ...lieu.instantane,
                ...(lieu.standId != null && lieu.retirerAvant ? { retraitCompris } : {}),
              }
            : null,
          // Le passage au tunnel est LA dernière activité du panier : c'est à
          // partir d'ici que se compte l'inactivité qui en fera un abandon.
          lastActivityAt: maintenant,
          // Et c'est ICI que naît la commande. La ligne existait depuis le
          // premier article mis au panier — parfois des jours plus tôt — et
          // gardait cette date : une commande payée le 29 s'affichait au 21,
          // se rangeait au 21 dans la liste, les filtres et les statistiques.
          // Les paniers abandonnés, eux, se comptent sur `lastActivityAt`.
          createdAt: maintenant,
          // Passé par la caisse du site, c'est un panier du site : s'il n'est
          // pas payé, c'est ici qu'il a été abandonné, pas au stand.
          panierDuStand: false,
          // La langue de la page de caisse, quand elle la dit. Celle du
          // compte n'y est pour rien et n'en est pas changée : c'est elle qui
          // passera d'abord au moment d'écrire (langueDuDestinataire).
          ...(langueCaisse ? { langue: langueCaisse } : {}),
        })
        .where(eq(schema.orders.id, panier.id))
        .returning();
      return { order: order!, port, total, carteCents };
    });
    if ("erreur" in resultat)
      return c.json(
        {
          error: resultat.erreur,
          ...("code" in resultat ? { code: resultat.code } : {}),
        },
        resultat.statut,
      );
    const { order, port, total, carteCents } = resultat;

    // Le carnet se remplit DANS la transaction, plus haut (18/11) : la case
    // « Garder cette adresse dans mon compte », ou d'office si le carnet est
    // vide, et jamais pour une invitée. Le rangement systématique d'avant,
    // ici, est retiré : il ignorait la case, et rangeait l'adresse d'une
    // invitée dans le carnet de la fiche qui porte son e-mail.

    return c.json({
      orderId: order.id,
      number: order.number,
      status: order.status,
      totalCents: total,
      shippingCents: port.cents,
      poidsGrammes: port.poidsGrammes,
      // La part de la carte cadeau, et ce qui reste à payer : calculés ICI.
      // À 0 €, la caisse remplace le paiement par « Valider ma commande »
      // (POST /payments/gratuit), qui recalcule tout avant de valider.
      giftCardCents: carteCents,
      aPayerCents: Math.max(0, total - carteCents),
    });
  });

  // === Paiement (Stripe & PayPal) =========================================

  /**
   * Config paiement exposée au NAVIGATEUR : quels moyens sont réellement
   * activés + les clés PUBLIQUES nécessaires côté client (clé publiable Stripe,
   * client-id PayPal). Évite d'avoir à câbler des PUBLIC_* dans le conteneur
   * web : l'API est la source de vérité — les clés saisies dans BO ›
   * Réglages › Paiements, sinon celles du .env.
   * Un moyen n'est "prêt" que si SES clés serveur ET publique sont présentes.
   *
   * RIEN D'AUTRE que ces clés publiques ne part d'ici (configPublique), et la
   * réponse n'est gardée par aucun cache : après une bascule, la caisse
   * suivante doit lire la nouvelle clé.
   */
  app.get("/payments/config", async (c) => {
    const config = await configPaiement();
    // La boutique tourne-t-elle en mode ESSAI ? Le tunnel s'en sert pour
    // rappeler quoi saisir : sans ce rappel, on cherche un numéro de carte
    // d'essai à chaque fois, et on finit par se demander si c'est la boutique
    // qui est cassée. La décision vit dans mode-essai.ts : seul un moyen
    // BRANCHÉ compte. L'ancienne règle prenait PayPal absent pour du test, et
    // la vraie boutique, Stripe réel sans PayPal, aurait montré les cartes
    // d'essai à ses clientes.
    const essai = (await etatEssai(config)).paiement;
    const { stripe, paypal } = configPublique(config);
    c.header("Cache-Control", "no-store");
    return c.json({ stripe, paypal, essai });
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
   * Ce que le prestataire doit encaisser : le total, moins la part de la
   * carte cadeau — calculé ici, jamais lu du navigateur.
   *
   * Avant d'ouvrir un paiement, la carte et un code à usage unique sont
   * revérifiés, sans verrou : mieux vaut le dire AVANT que la carte bancaire
   * soit débitée. Le contrôle qui fait foi, sous verrou, a lieu au paiement
   * (markOrderPaid). Une commande qui ne demande rien se valide ailleurs
   * (POST /payments/gratuit).
   */
  async function montantAEncaisser(
    order: typeof schema.orders.$inferSelect,
  ): Promise<{ montantCents: number } | { refus: { error: string; code: string } }> {
    const carteCents = order.giftCardId ? Math.max(0, order.giftCardCents) : 0;
    const montant = order.totalCents - carteCents;
    if (montant <= 0)
      return {
        refus: {
          error: "Cette commande ne demande aucun paiement : validez-la.",
          code: "rien_a_payer",
        },
      };
    if (order.giftCardId && carteCents > 0) {
      const [carte] = await db
        .select()
        .from(schema.giftCards)
        .where(eq(schema.giftCards.id, order.giftCardId));
      if (
        !carte ||
        !carteUtilisable(carte, order.lastActivityAt ?? new Date()) ||
        carte.balanceCents < carteCents
      )
        return {
          refus: {
            error:
              "Le solde de votre carte cadeau a changé. Revenez à l'étape précédente pour recalculer votre total.",
            code: "carte_solde",
          },
        };
    }
    if (order.promoCode) {
      const cle = cleDeCode(order.promoCode);
      const figee = (order.promotions?.regles ?? []).find((r) => cleDeCode(r.code) === cle);
      if (
        estUsageUnique(figee?.config) &&
        (await utilisationsDuCode(db, order.promoCode, order.id)) > 0
      )
        return { refus: { error: CODE_DEJA_UTILISE, code: "code_deja_utilise" } };
    }
    return { montantCents: montant };
  }

  /**
   * Crée un PaymentIntent Stripe pour la commande et renvoie son clientSecret
   * (le navigateur confirme le paiement avec Stripe.js). Le montant vient du
   * SERVEUR (order.totalCents), jamais du client.
   *
   * La clé PUBLIQUE repart avec : c'est avec elle, et non avec celle lue au
   * chargement de la caisse, que le navigateur charge Stripe.js. Une bascule
   * entre l'essai et le réel pendant que la cliente remplissait ses
   * coordonnées ne peut donc plus marier une clé publique d'un mode à une
   * intention de l'autre — le paiement échouait sans explication.
   */
  app.post("/payments/stripe/intent", async (c) => {
    const config = await configPaiement();
    const jeu = config.stripe;
    if (!jeu)
      return c.json({ error: "Stripe non configuré" }, 503);
    const body = await c.req.json().catch(() => ({}));
    const order = await loadPayableOrder(Number(body.orderId));
    if (!order) return c.json({ error: "commande introuvable" }, 404);
    if (order.status === "paid")
      return c.json({ error: "commande déjà payée" }, 409);
    if (order.status !== "pending")
      return c.json({ error: PANIER_A_REVALIDER, code: "panier_modifie" }, 409);
    const aPayer = await montantAEncaisser(order);
    if ("refus" in aPayer) return c.json(aPayer.refus, 409);
    try {
      const intent = await createStripeIntent(
        jeu,
        aPayer.montantCents,
        order.id,
        order.number,
      );
      await db.insert(schema.payments).values({
        orderId: order.id,
        provider: "stripe",
        externalRef: intent.id,
        status: "pending",
        amountCents: aPayer.montantCents,
        // Le mode de CES clés : c'est avec elles que ce paiement se
        // confirmera et se remboursera, même après une bascule.
        mode: jeu.mode,
      });
      return c.json({ clientSecret: intent.clientSecret, publicKey: jeu.clePublique });
    } catch (e) {
      console.error("Stripe intent:", e);
      return c.json({ error: "création du paiement impossible" }, 502);
    }
  });

  /**
   * Webhook Stripe : source de vérité de l'encaissement. Vérifie la signature
   * sur le corps BRUT, et sur `payment_intent.succeeded` passe la commande en
   * payée + génère les PDF (idempotent).
   *
   * DEUX MODES, UNE RÈGLE. La signature est vérifiée avec tous les secrets
   * connus (celui du mode actif, et l'autre) : un paiement ouvert juste avant
   * une bascule ne se perd pas. Le MODE DE L'AVIS est celui du secret qui l'a
   * signé, jamais ce que l'avis dit de lui-même : le `livemode` du corps est
   * écrit par qui signe, et le secret de test suffisait à signer un avis
   * « live ». Un avis qui se contredit est refusé (400, voir plus bas).
   *
   * Un avis de l'AUTRE mode que le mode actif n'est traité que s'il porte sur
   * un paiement que NOUS avons ouvert dans ce mode-là, pour cette commande-là
   * (ligne payment de même référence, de même mode et de même commande). Sans
   * cette règle, une intention de test créée à la main avec un numéro de
   * commande en metadata ferait passer une vraie commande « payée » — et les
   * clés de test circulent bien plus facilement que les vraies.
   */
  app.post("/payments/stripe/webhook", async (c) => {
    const raw = await c.req.text();
    const config = await configPaiement();
    const verifie = verifyStripeEvent(
      raw,
      c.req.header("stripe-signature"),
      config.secretsWebhook,
    );
    if (!verifie) return c.json({ error: "signature invalide" }, 400);
    const { event, modeSecret } = verifie;
    if (avisIncoherent(verifie)) {
      // Un faux, ou le secret du webhook live collé dans la colonne Essai
      // (ou l'inverse). 400 plutôt que 200 : Stripe rejoue l'avis pendant
      // trois jours et signale l'échec dans son tableau de bord. Une fois le
      // secret remis dans la bonne colonne, l'avis rejoué passe ; un faux,
      // lui, ne passera jamais. L'écran Paiements affiche le dernier refus.
      noterAvisIncoherent(modeSecret, verifie.livemode ? "live" : "test");
      console.warn(
        `[webhook] avis Stripe refusé : signé avec un secret ${modeSecret}, il se dit ${verifie.livemode ? "live" : "test"} (type ${String(event.type).slice(0, 60)})`,
      );
      return c.json({ error: "avis incohérent avec son secret" }, 400);
    }
    const modeAvis: Mode = modeSecret;
    noterAvisStripe(modeAvis);
    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object as {
        id: string;
        amount_received?: number;
        currency?: string;
        metadata?: { orderId?: string };
      };
      const orderId = Number(pi.metadata?.orderId);
      if (modeAvis !== config.modeVoulu.stripe) {
        const [ligne] = await db
          .select({ mode: schema.payments.mode, orderId: schema.payments.orderId })
          .from(schema.payments)
          .where(
            and(
              eq(schema.payments.provider, "stripe"),
              eq(schema.payments.externalRef, String(pi.id ?? "")),
            ),
          );
        const lue = ligne ? { mode: modeDuPaiement(ligne, "stripe", config), orderId: ligne.orderId } : null;
        if (!avisAutreModeRecevable(modeAvis, lue, orderId)) {
          console.warn(
            `[webhook] avis Stripe ${modeAvis} ignoré : la boutique encaisse en ${config.modeVoulu.stripe}, et aucun paiement de ce mode ne porte la référence ${String(pi.id ?? "?").slice(0, 40)} pour la commande ${String(pi.metadata?.orderId ?? "?").slice(0, 20)}`,
          );
          return c.json({ received: true });
        }
      }
      if (Number.isFinite(orderId)) {
        try {
          // Le montant vient de l'événement signé : c'est ce que Stripe a
          // réellement pris, pas ce que la commande croyait demander.
          const payee = await markOrderPaid(orderId, "stripe", pi.id, {
            montantCents: Number(pi.amount_received ?? 0),
            devise: String(pi.currency ?? ""),
          });
          if (payee) await signalerPayeeEnEssai(orderId, "stripe", modeAvis, config);
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
    const config = await configPaiement();
    if (!config.jeux.stripe.test && !config.jeux.stripe.live)
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
    // Les clés du mode où CE paiement est né, pas celles du moment : Stripe
    // ne connaît une intention que dans son mode.
    const mode = modeDuPaiement(payment, "stripe", config);
    const jeu = config.jeux.stripe[mode];
    if (!jeu) return c.json({ error: "Stripe non configuré" }, 503);
    try {
      const intent = await getStripeIntent(jeu, payment.externalRef);
      if (intent.status === "succeeded") {
        await encaisserIntentionStripe(orderId, payment.externalRef, intent, mode, config);
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
   * Une intention Stripe « succeeded », relue chez Stripe : la commande passe
   * payée. Le seul chemin des deux confirmations venues du navigateur — juste
   * après confirmPayment, et au retour d'une redirection —, et le même
   * markOrderPaid que le webhook : la commande est verrouillée, le premier
   * arrivé la paie, les suivants n'y trouvent plus rien à faire (pas de
   * second courrier, pas de seconde ligne au grand livre).
   * MontantEncaisseDifferent remonte à l'appelant.
   */
  async function encaisserIntentionStripe(
    orderId: number,
    ref: string,
    intent: { montantCents: number; devise: string },
    mode: Mode,
    config: ConfigEffective,
  ): Promise<void> {
    const payee = await markOrderPaid(orderId, "stripe", ref, {
      montantCents: intent.montantCents,
      devise: intent.devise,
    });
    if (payee) await signalerPayeeEnEssai(orderId, "stripe", mode, config);
  }

  /**
   * Retour d'un moyen de paiement À REDIRECTION (Bancontact, iDEAL, Klarna…).
   *
   * La caisse confirme avec redirect: "if_required" : la carte se règle sur
   * place, mais ces moyens-là quittent le site pour la banque, et Stripe
   * renvoie la cliente sur la caisse avec ?payment_intent=…
   * &payment_intent_client_secret=…&redirect_status=…. Sans cette route, elle
   * retombait sur un formulaire de caisse rempli de son panier déjà réglé, et
   * la commande ne passait payée que si le webhook arrivait — jamais en essai,
   * où il n'est pas exigé.
   *
   * Le navigateur ne dit que QUEL paiement ; ce qu'il en est, c'est Stripe qui
   * le dit (getStripeIntent, avec les clés du mode où ce paiement est né), et
   * redirect_status n'est pas lu ici. Le client_secret prouve que c'est bien
   * le navigateur de la caisse qui revient (secretClientConcorde) : sans lui,
   * l'identifiant d'une intention suffirait à lire le numéro d'une commande.
   * Un secret qui ne concorde pas répond comme un paiement inconnu.
   *
   * Rend l'écran à afficher (issueDuRetour) et le numéro de commande. Rejouer
   * ce retour (un rechargement, le webhook arrivé avant) ne fait rien de plus.
   */
  app.post("/payments/stripe/retour", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const ref = String(body.paymentIntent ?? "");
    const secretClient = String(body.clientSecret ?? "");
    if (!/^pi_[A-Za-z0-9]{1,200}$/.test(ref) || !secretClient)
      return c.json({ error: "retour de paiement illisible" }, 400);
    const config = await configPaiement();
    const [payment] = await db
      .select()
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.provider, "stripe"),
          eq(schema.payments.externalRef, ref),
        ),
      );
    if (!payment) return c.json({ error: "paiement introuvable" }, 404);
    const mode = modeDuPaiement(payment, "stripe", config);
    const jeu = config.jeux.stripe[mode];
    if (!jeu) return c.json({ error: "Stripe non configuré" }, 503);
    const lireCommande = async () => {
      const [o] = await db
        .select({ number: schema.orders.number, status: schema.orders.status })
        .from(schema.orders)
        .where(eq(schema.orders.id, payment.orderId));
      return o ?? null;
    };
    try {
      const intent = await getStripeIntent(jeu, ref);
      if (!secretClientConcorde(intent.clientSecret, secretClient))
        return c.json({ error: "paiement introuvable" }, 404);
      let ecart = false;
      if (intent.status === "succeeded") {
        try {
          await encaisserIntentionStripe(payment.orderId, ref, intent, mode, config);
        } catch (e) {
          // L'écart est au journal de la commande, la boutique le voit : la
          // cliente, elle, lit que la boutique revient vers elle (issueDuRetour).
          if (!(e instanceof MontantEncaisseDifferent)) throw e;
          ecart = true;
        }
      }
      const commande = await lireCommande();
      if (!commande) return c.json({ error: "commande introuvable" }, 404);
      return c.json({
        issue: issueDuRetour(intent.status, commande.status, ecart),
        number: commande.number,
      });
    } catch (e) {
      console.error("Stripe retour:", e);
      return c.json({ error: "vérification impossible" }, 502);
    }
  });

  /**
   * Crée une commande PayPal (montant serveur) à approuver côté navigateur.
   * Renvoie l'id PayPal. La capture (encaissement) se fait ensuite via
   * /payments/paypal/capture.
   */
  app.post("/payments/paypal/order", async (c) => {
    const config = await configPaiement();
    const jeu = config.paypal;
    if (!jeu)
      return c.json({ error: "PayPal non configuré" }, 503);
    const body = await c.req.json().catch(() => ({}));
    // Le client-id avec lequel le navigateur a chargé les boutons PayPal. Si
    // la boutique a basculé entre l'essai et le réel depuis, la fenêtre
    // PayPal parlerait à un autre côté que le serveur, et le paiement
    // échouerait sur un refus incompréhensible : on le dit tout de suite, et
    // la caisse relit sa configuration. Absent (une caisse d'avant ce
    // contrôle, encore en cache), on ne refuse pas.
    const charge = typeof body.clientId === "string" ? body.clientId : null;
    if (charge !== null && charge !== jeu.clientIdNavigateur)
      return c.json(
        {
          error:
            "Les moyens de paiement de la boutique viennent de changer. Choisissez de nouveau votre moyen de paiement.",
          code: "paiement_reconfigure",
        },
        409,
      );
    const order = await loadPayableOrder(Number(body.orderId));
    if (!order) return c.json({ error: "commande introuvable" }, 404);
    if (order.status === "paid")
      return c.json({ error: "commande déjà payée" }, 409);
    if (order.status !== "pending")
      return c.json({ error: PANIER_A_REVALIDER, code: "panier_modifie" }, 409);
    const aPayer = await montantAEncaisser(order);
    if ("refus" in aPayer) return c.json(aPayer.refus, 409);
    try {
      const paypalOrderId = await createPaypalOrder(
        jeu,
        aPayer.montantCents,
        order.number,
      );
      await db.insert(schema.payments).values({
        orderId: order.id,
        provider: "paypal",
        externalRef: paypalOrderId,
        status: "pending",
        amountCents: aPayer.montantCents,
        // La capture se fera avec les clés de ce mode-là (voir plus bas).
        mode: jeu.mode,
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
    const config = await configPaiement();
    if (!config.jeux.paypal.test && !config.jeux.paypal.live)
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
      // Le prestataire n'encaisse que ce que la carte cadeau ne paie pas.
      const carteCents = order.giftCardId ? Math.max(0, order.giftCardCents) : 0;
      if (
        order.status !== "pending" ||
        !valeur.livrable ||
        valeur.totalCents - carteCents !== payment.amountCents
      )
        return c.json({ error: PANIER_A_REVALIDER, code: "panier_modifie" }, 409);
      // La carte et le code à usage unique, revérifiés AVANT que l'argent
      // bouge : PayPal le permet, autant s'en servir.
      const aPayer = await montantAEncaisser(order);
      if ("refus" in aPayer) return c.json(aPayer.refus, 409);
    }

    // Les clés du mode où CE paiement a été ouvert : une commande PayPal du
    // bac à sable ne se capture pas avec les identifiants du compte réel.
    const mode = modeDuPaiement(payment, "paypal", config);
    const jeu = config.jeux.paypal[mode];
    if (!jeu) return c.json({ error: "PayPal non configuré" }, 503);

    try {
      const cap = await capturePaypalOrder(jeu, paypalOrderId);
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
      const payee = await markOrderPaid(orderId, "paypal", paypalOrderId, {
        montantCents: cap.montantCents,
        devise: cap.devise,
      });
      if (payee) await signalerPayeeEnEssai(orderId, "paypal", mode, config);
      return c.json({ status: "paid" });
    } catch (e) {
      if (e instanceof MontantEncaisseDifferent)
        return c.json({ error: e.message, code: "montant_different" }, 409);
      console.error("PayPal capture:", e);
      return c.json({ error: "encaissement impossible" }, 502);
    }
  });

  /**
   * Valide une commande qui ne demande AUCUN paiement : une remise à 100 % et
   * la livraison offerte, ou une carte cadeau qui couvre tout.
   *
   * La caisse affiche « Valider ma commande » à la place du paiement quand le
   * reste à payer, calculé par le serveur au passage en caisse, vaut 0. Ici,
   * tout est RECALCULÉ sous le verrou de la commande (markOrderPaid, moyen
   * « aucun ») : articles, code et dates de la promotion, livraison, carte
   * cadeau et son solde, code à usage unique. Le moindre centime à payer, et
   * rien n'est validé.
   *
   * Réservée à la cliente de la commande, connectée : sans paiement, la
   * session est la seule preuve que c'est bien elle qui valide.
   *
   * Idempotente : une commande déjà payée ne se valide pas une seconde fois.
   * La route répond qu'elle l'est, avec son numéro, et c'est tout.
   */
  app.post("/payments/gratuit", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const connecte = await clientDeLaRequete(c);
    const order = await loadPayableOrder(Number((body as { orderId?: unknown }).orderId));
    // Connectée : la commande doit être la sienne. Invitée (18/11) : son
    // PANIER en est la preuve — l'identifiant tiré au hasard que seul son
    // navigateur connaît, et que la commande garde (clientOrderId).
    const panier = String((body as { cartId?: unknown }).cartId ?? "").trim();
    const sienne = connecte
      ? order?.customerId === connecte.id
      : panier.length >= 16 && order?.clientOrderId === panier;
    if (!order || !sienne) return c.json({ error: "commande introuvable" }, 404);
    if (order.status === "paid") return c.json({ status: "paid", number: order.number });
    if (order.status !== "pending")
      return c.json({ error: PANIER_A_REVALIDER, code: "panier_modifie" }, 409);
    try {
      await markOrderPaid(
        order.id,
        "aucun",
        `${order.giftCardId && order.giftCardCents > 0 ? "carte" : "gratuit"}-${order.id}`,
        { montantCents: 0, devise: "EUR" },
      );
    } catch (e) {
      if (e instanceof ValidationRefusee)
        return c.json({ error: e.message, code: e.code }, 409);
      if (e instanceof LigneCarteInvalide)
        return c.json({ error: e.message, code: "carte_ligne_invalide" }, 409);
      throw e;
    }
    const [apres] = await db
      .select({ status: schema.orders.status, number: schema.orders.number })
      .from(schema.orders)
      .where(eq(schema.orders.id, order.id));
    return c.json({ status: apres?.status ?? "pending", number: apres?.number ?? order.number });
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
    if (!commandeVisiblePar(c, order)) return c.notFound();
    const items = await db
      .select({
        id: schema.orderItems.id,
        title: schema.orderItems.title,
        productId: schema.orderItems.productId,
        quantity: schema.orderItems.quantity,
        unitPriceCents: schema.orderItems.unitPriceCents,
        config: schema.orderItems.config,
        format: sql<string>`(${schema.orderItems.config} ->> 'format')`,
        giftCard: schema.orderItems.giftCard,
      })
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, id))
      // Dans l'ordre où elles ont été ajoutées, comme les vignettes et les
      // boutons « 1 », « 2 » de la liste, et comme la numérotation des
      // fichiers (« -2 ») : sans ordre, la base les rendait au hasard, et
      // l'« affiche 1 » de la fiche n'était pas toujours celle de la liste.
      .orderBy(asc(schema.orderItems.id));
    const [customer] = order.customerId
      ? await db
          .select()
          .from(schema.customers)
          .where(eq(schema.customers.id, order.customerId))
      : [];

    // Le cadre choisi, en toutes lettres : la configuration n'en garde que
    // l'identifiant, illisible sur une fiche de préparation.
    const cadres = await db.select().from(schema.frames);
    // Les cartes cadeaux que cette commande a achetées, nées à son paiement.
    const cartesEmises = items.some((it) => it.giftCard)
      ? await db
          .select({
            id: schema.giftCards.id,
            code: schema.giftCards.code,
            orderItemId: schema.giftCards.orderItemId,
            sentAt: schema.giftCards.sentAt,
          })
          .from(schema.giftCards)
          .where(eq(schema.giftCards.orderId, id))
      : [];
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
        // Une carte cadeau achetée : son montant, son destinataire et la carte
        // née au paiement (code masqué : le code complet se lit dans BO ›
        // Cartes cadeaux). Null pour une affiche.
        carteCadeau: it.giftCard
          ? {
              ...it.giftCard,
              carte: (() => {
                const emise = cartesEmises.find((ce) => ce.orderItemId === it.id);
                return emise
                  ? { id: emise.id, masque: codeCarteMasque(emise.code), envoyeeLe: emise.sentAt }
                  : null;
              })(),
            }
          : null,
        // Le sens de la feuille, pour qui imprime : absent = portrait.
        orientation: cfg.orientation === "paysage" ? "paysage" : null,
        cadre: cadre?.name ?? null,
        // La couleur d'aperçu du cadre : la fiche en borde la grande vignette
        // de l'affiche, comme le panier du site. Lue en direct, comme le nom —
        // un cadre s'archive, il ne disparaît pas.
        cadreCouleur: cadre?.previewColor ?? null,
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
        // Une carte cadeau n'a rien de composé : pas d'aperçu.
        apercu: it.config ? cheminApercu(it.id, it.config) : undefined,
      };
    });

    // Paiements enregistrés : c'est là qu'on lit ce qui a réellement été
    // encaissé, et par quel moyen.
    const paiements = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.orderId, id));
    // Payée avec les clés d'ESSAI alors que la boutique encaisse pour de
    // vrai : aucun argent n'est arrivé, et rien d'autre sur la fiche ne le
    // distinguerait d'une vraie vente (payment.mode n'était lu nulle part).
    const essai = payeeEnEssai(paiements, await configPaiement());

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
      // Une carte cadeau part par e-mail : rien à expédier.
      aExpedier: it.carteCadeau ? 0 : it.quantity - (partiParLigne.get(it.id) ?? 0),
      aRembourser: it.quantity - (renduParLigne.get(it.id) ?? 0),
    }));

    const portRendu = remboursements.reduce((s, r) => s + r.shippingCents, 0);

    return c.json({
      order,
      // Où la cliente vient chercher sa commande, en clair : le lieu figé à
      // la caisse, ou l'ancien repère « stand:… » des commandes d'avant. La
      // fiche et le bon n'ont pas à connaître ces deux formes.
      lieuRetrait: lieuDeRetrait(order),
      // La carte cadeau qui paie une part de la commande (giftCardCents), code
      // masqué : la fiche l'écrit sous le total.
      carteCadeauPayante: order.giftCardId
        ? await (async () => {
            const [carte] = await db
              .select({ id: schema.giftCards.id, code: schema.giftCards.code })
              .from(schema.giftCards)
              .where(eq(schema.giftCards.id, order.giftCardId!));
            return carte ? { id: carte.id, masque: codeCarteMasque(carte.code) } : null;
          })()
        : null,
      customer: customer ?? null,
      items: avecRestes,
      paiements,
      payeeEnEssai: essai,
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
      // L'étape de traitement (17/11) : le seul statut que montre la fiche.
      // Rien pour une reprise de Shopify, traitée là-bas.
      traitement:
        order.legacyId != null
          ? null
          : await (async () => {
              const bordereauReel = (await avecBordereauReel([order.id])).has(order.id);
              return { ...etapeDeLaCommande(order, resume, bordereauReel), bordereauReel };
            })(),
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
   * Où en sont les fichiers d'impression de quelques lignes, SANS attendre
   * aucun calcul : `?lignes=12,13` → `{ lignes: { 12: { etat: "pret", … } } }`.
   *
   * C'est par elle que le back-office (fiche et liste des commandes) sait
   * quoi afficher : « prêt », « en préparation… », « échec : la raison ».
   * Avant, il n'y avait que le lien de téléchargement, et la boutique cliquait
   * dans le noir : un onglet blanc pendant que le fichier se fabriquait, une
   * ligne de code en guise d'erreur, ou rien du tout.
   *
   * `preparer=1` lance la fabrication des fichiers absents, `reessayer=1`
   * relance aussi ceux qui ont échoué (voir etatDuFichierDImpression).
   *
   * Déclarée AVANT « /admin/print-files/:orderItemId » : Hono retient la
   * première route qui correspond, et « etat » y passerait pour un numéro de
   * ligne.
   */
  app.get("/admin/print-files/etat", async (c) => {
    const ids = [
      ...new Set(
        (c.req.query("lignes") ?? "")
          .split(",")
          .map(Number)
          .filter((n) => Number.isInteger(n) && n > 0),
      ),
    ].slice(0, 300);
    const preparer = c.req.query("preparer") === "1";
    const reessayer = c.req.query("reessayer") === "1";
    const lignes: Record<number, EtatImpression> = {};
    const items = ids.length
      ? await db
          .select({
            id: schema.orderItems.id,
            orderId: schema.orderItems.orderId,
            config: schema.orderItems.config,
          })
          .from(schema.orderItems)
          .where(inArray(schema.orderItems.id, ids))
      : [];
    if (items.length) {
      const commandes = await db
        .select({
          id: schema.orders.id,
          channel: schema.orders.channel,
          standId: schema.orders.standId,
        })
        .from(schema.orders)
        .where(inArray(schema.orders.id, [...new Set(items.map((i) => i.orderId))]));
      const commandeDe = new Map(commandes.map((o) => [o.id, o]));
      // Une fois pour toutes les lignes : ce sont les mêmes personnages et
      // les mêmes fonds pour toute la liste.
      const donnees = await donneesDImpression();
      for (const it of items) {
        // Même règle que le téléchargement : une ligne qu'on ne peut pas
        // télécharger n'a pas d'état à montrer.
        if (!it.config || !commandeVisiblePar(c, commandeDe.get(it.orderId))) continue;
        lignes[it.id] = await etatDuFichierDImpression(it.id, it.config as PosterConfig, {
          preparer,
          reessayer,
          donnees,
        });
      }
    }
    // L'état change d'une seconde à l'autre : aucun cache ne doit le figer.
    return c.json({ lignes }, 200, { "Cache-Control": "no-store" });
  });

  /**
   * Renvoie le PDF d'une ligne de commande, régénéré à la demande depuis le
   * snapshot (idempotent). Disponible pour TOUTE commande, même ancienne.
   * C'est la cliente qui télécharge/imprime (depuis le BO ou l'app salon).
   *
   * Le back-office ne fait pointer son lien ici qu'une fois le fichier prêt
   * (voir /admin/print-files/etat) : il part alors aussitôt. Appelé avant,
   * il attend la fabrication, en tête de file.
   *
   * PROTÉGÉ : l'id de ligne est un entier séquentiel — en accès libre, il
   * suffisait de l'incrémenter pour aspirer les affiches de tous les clients.
   */
  app.get("/admin/print-files/:orderItemId", async (c) => {
    const itemId = Number(c.req.param("orderItemId"));
    if (!Number.isInteger(itemId) || itemId <= 0) return c.notFound();
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
    if (!order || !commandeVisiblePar(c, order)) return c.notFound();
    const cfg = item.config as PosterConfig;
    // Rangé au paiement, le fichier part aussitôt ; sinon il se fabrique ici.
    let pdf: Buffer;
    try {
      pdf = await fichierDImpression(itemId, cfg);
    } catch (e) {
      console.error(`[impression] ligne ${itemId} :`, e);
      return c.json(
        { error: `Fichier d'impression impossible à fabriquer : ${raisonLisible(e)}` },
        500,
      );
    }
    const noms = await nomsDesFichiersDImpression(order, [item]);
    return c.body(new Uint8Array(pdf), 200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${noms.get(itemId)}"`,
    });
  });

  /**
   * Tous les fichiers d'impression d'une commande, dans une seule archive
   * .zip : le « Tout télécharger » de la liste et de la fiche, pour ne pas
   * cliquer affiche par affiche. Chaque PDF y garde son nom (voir
   * archive-zip.ts).
   *
   * Comme pour une ligne seule, le back-office ne propose le lien qu'une fois
   * tous les fichiers prêts ; appelé avant, il attend ceux qui manquent. Une
   * affiche qui ne peut pas s'imprimer fait refuser l'archive entière, en
   * disant laquelle : une archive incomplète passerait pour la commande.
   */
  app.get("/admin/orders/:id/impression.zip", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.notFound();
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
    if (!order || !commandeVisiblePar(c, order)) return c.notFound();
    const lignes = (
      await db
        .select({
          id: schema.orderItems.id,
          title: schema.orderItems.title,
          config: schema.orderItems.config,
        })
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, id))
        .orderBy(asc(schema.orderItems.id))
    ).filter((l) => l.config);
    if (!lignes.length)
      return c.json({ error: "Cette commande n'a aucune affiche à imprimer." }, 404);
    const noms = await nomsDesFichiersDImpression(order, lignes);
    const fichiers: { nom: string; contenu: Uint8Array }[] = [];
    for (const [i, l] of lignes.entries()) {
      try {
        fichiers.push({
          nom: noms.get(l.id) ?? `affiche-${i + 1}.pdf`,
          contenu: await fichierDImpression(l.id, l.config as PosterConfig),
        });
      } catch (e) {
        console.error(`[impression] ligne ${l.id} :`, e);
        return c.json(
          {
            error: `Affiche ${i + 1} (${l.title ?? "affiche personnalisée"}) : fichier d'impression impossible à fabriquer : ${raisonLisible(e)}`,
          },
          500,
        );
      }
    }
    const [client] = order.customerId
      ? await db
          .select({ name: schema.customers.name })
          .from(schema.customers)
          .where(eq(schema.customers.id, order.customerId))
      : [];
    const nom = `${slugifyName(client?.name ?? "client")}_${slugifyName(order.number)}.zip`;
    // Envoyée morceau par morceau : les PDF ne sont pas recopiés dans un
    // second tampon de plusieurs dizaines de Mo.
    const morceaux = archiveZip(fichiers);
    const taille = morceaux.reduce((n, m) => n + m.length, 0);
    const flux = new ReadableStream<Uint8Array>({
      pull(controleur) {
        const morceau = morceaux.shift();
        if (morceau) controleur.enqueue(morceau);
        else controleur.close();
      },
    });
    return c.body(flux, 200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${nom}"`,
      "Content-Length": String(taille),
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
        translations: schema.characterCategories.translations,
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
   * Supprime DÉFINITIVEMENT une catégorie de personnages archivée (règles :
   * suppression.ts).
   *
   * Refusée tant qu'elle range un personnage EN SERVICE : la clé étrangère
   * (ON DELETE SET NULL) le sortirait de son rayon sans un mot — la perte même
   * qui avait fait retirer l'ancienne suppression. On les range ailleurs
   * d'abord, en le voyant, depuis leur carte. Un personnage ARCHIVÉ qu'elle
   * range encore ne retient rien : il passe « sans catégorie », et s'il est
   * restauré un jour, on lui en choisira une.
   *
   * Aucune commande ne cite une catégorie (seulement des personnages) : rien
   * d'autre à vérifier. La condition « archivée » est répétée dans la
   * requête : restaurée depuis un autre onglet entre-temps, elle reste.
   */
  app.delete("/admin/categories/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.notFound();
    return supprimerPourToujours(c, {
      lire: async () =>
        (
          await db
            .select()
            .from(schema.characterCategories)
            .where(eq(schema.characterCategories.id, id))
        )[0] ?? null,
      estArchive: (cat) => cat.archivedAt != null,
      empeche: async () => {
        const dedans = await db
          .select({ name: schema.characterTypes.name })
          .from(schema.characterTypes)
          .where(
            and(
              eq(schema.characterTypes.categoryId, id),
              isNull(schema.characterTypes.archivedAt),
            ),
          )
          .orderBy(asc(schema.characterTypes.position), asc(schema.characterTypes.name));
        if (!dedans.length) return null;
        const n = dedans.length;
        return `Elle range encore ${n} personnage${n > 1 ? "s" : ""} en service (${enBref(dedans.map((t) => `« ${t.name} »`))}) : choisissez-${n > 1 ? "leur" : "lui"} une autre catégorie — ou « sans catégorie » — sur ${n > 1 ? "leur carte" : "sa carte"}, puis recommencez. Elle reste archivée.`;
      },
      supprimer: async () => {
        await db
          .delete(schema.characterCategories)
          .where(
            and(
              eq(schema.characterCategories.id, id),
              isNotNull(schema.characterCategories.archivedAt),
            ),
          );
      },
      utilisePar: "des personnages",
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

  /**
   * Supprime DÉFINITIVEMENT un personnage archivé (règles : suppression.ts).
   *
   * L'ancienne suppression avait été retirée parce qu'elle rendait
   * impossibles les réimpressions : le fichier d'impression relit le
   * personnage en base (donneesDImpression). D'où le refus tant qu'une
   * commande — ou un panier en cours — le porte, ou porte l'une de SES pièces
   * (les pièces propres à ce personnage, `asset.character_type_id`), cf.
   * usages-commandes.ts.
   *
   * Ce qui part avec lui, dans la même requête : ses réglages, qui sont dans
   * sa ligne (pièces autorisées, calage, tenue par défaut, couleurs), et ses
   * pièces propres, par la clé étrangère (ON DELETE CASCADE). Les pièces
   * GÉNÉRIQUES ne lui appartiennent pas et restent. Ses dessins restent sur le
   * disque : seule la ligne part.
   */
  app.delete("/admin/characters/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.notFound();
    return supprimerPourToujours(c, {
      lire: async () =>
        (
          await db
            .select({
              id: schema.characterTypes.id,
              archivedAt: schema.characterTypes.archivedAt,
            })
            .from(schema.characterTypes)
            .where(eq(schema.characterTypes.id, id))
        )[0] ?? null,
      estArchive: (t) => t.archivedAt != null,
      empeche: async () => {
        const reste = "Il reste archivé.";
        const porte = await commandesQuiEmpechent(db, { personnage: id }, reste);
        if (porte) return porte;
        const siennes = await db
          .select({ id: schema.assets.id })
          .from(schema.assets)
          .where(eq(schema.assets.characterTypeId, id));
        return commandesQuiEmpechent(
          db,
          { pieces: siennes.map((p) => p.id) },
          reste,
        );
      },
      supprimer: async () => {
        // Une seule requête : la base emporte ses pièces propres avec lui
        // (cascade), dans la même transaction implicite.
        await db
          .delete(schema.characterTypes)
          .where(
            and(
              eq(schema.characterTypes.id, id),
              isNotNull(schema.characterTypes.archivedAt),
            ),
          );
      },
    });
  });

  /**
   * Montre ou masque un personnage sur le site (bouton « Visible » /
   * « Masqué » du BO). Rien d'autre ne bouge : ni ses réglages, ni sa place,
   * ni les affiches qui le portent déjà.
   */
  app.post("/admin/characters/:id/visible", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json().catch(() => ({}));
    if (typeof b.active !== "boolean")
      return c.json({ error: "Dites si le personnage est visible (active: true ou false)." }, 400);
    const [row] = await db
      .update(schema.characterTypes)
      .set({ active: b.active })
      .where(eq(schema.characterTypes.id, id))
      .returning({ id: schema.characterTypes.id, active: schema.characterTypes.active });
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
      // Absent = inchangé : un écran qui ne connaît pas encore ce réglage ne
      // doit pas le ramener à « toutes » en enregistrant le reste.
      ...(b.couleursProposees !== undefined
        ? { couleursProposees: couleursProposees(b.couleursProposees) }
        : {}),
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

  /**
   * Supprime DÉFINITIVEMENT une catégorie de pièces archivée (règles :
   * suppression.ts). Son nuancier part avec elle : il est dans sa ligne.
   *
   * Deux choses la retiennent, qui ne se voient pas sur elle :
   *   - des pièces EN SERVICE qu'elle range encore. La clé étrangère (ON
   *     DELETE SET NULL) les sortirait de leur rayon sans un mot — la perte
   *     qui avait fait retirer l'ancienne suppression. On les range ailleurs
   *     d'abord, depuis l'écran Pièces. Une pièce ARCHIVÉE, elle, ne retient
   *     rien : elle passe « sans catégorie ».
   *   - des couleurs de personnages ou de pièces en service qui prennent SON
   *     nuancier (« categorie:robes », réglé sur leur fiche). Archivée, la
   *     catégorie les fait déjà retomber sur le nuancier par défaut ; mais
   *     supprimée, son adresse redeviendrait libre, et la première catégorie
   *     créée sous le même nom prêterait ses couleurs à leur insu.
   *
   * Aucune commande ne cite une catégorie de pièces : ses couleurs choisies
   * sont recopiées dans la configuration.
   */
  app.delete("/admin/piece-categories/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.notFound();
    return supprimerPourToujours(c, {
      lire: async () =>
        (
          await db
            .select()
            .from(schema.pieceCategories)
            .where(eq(schema.pieceCategories.id, id))
        )[0] ?? null,
      estArchive: (cat) => cat.archivedAt != null,
      empeche: async (cat) => {
        const dedans = await db
          .select({ id: schema.assets.id, name: schema.assets.name })
          .from(schema.assets)
          .where(
            and(
              eq(schema.assets.pieceCategoryId, id),
              isNull(schema.assets.archivedAt),
            ),
          )
          .orderBy(asc(schema.assets.slot), asc(schema.assets.position));
        if (dedans.length) {
          const n = dedans.length;
          return `Elle range encore ${n} pièce${n > 1 ? "s" : ""} en service (${enBref(dedans.map((p) => `« ${p.name || `pièce ${p.id}`} »`))}) : rangez-${n > 1 ? "les" : "la"} dans une autre catégorie, dans l'écran Pièces, puis recommencez. Elle reste archivée.`;
        }
        const nuancier = `${PREFIXE_NUANCIER_CATEGORIE}${cat.slug}`;
        // Où qu'il soit rangé dans les couleurs (groupes du dessin, familles
        // d'une image en pixels), un réglage de nuancier s'écrit
        // `"nuancier": "categorie:…"` : on le cherche à toute profondeur.
        const prend = (colonne: AnyColumn) =>
          sql<boolean>`coalesce(jsonb_path_exists(${colonne}, '$.**.nuancier ? (@ == $n)', jsonb_build_object('n', ${nuancier}::text)), false)`;
        const [persos, pieces] = await Promise.all([
          db
            .select({ name: schema.characterTypes.name })
            .from(schema.characterTypes)
            .where(
              and(
                isNull(schema.characterTypes.archivedAt),
                sql`(${prend(schema.characterTypes.baseGroupesCouleurs)} or ${prend(schema.characterTypes.baseCouleursImage)})`,
              ),
            ),
          db
            .select({ id: schema.assets.id, name: schema.assets.name })
            .from(schema.assets)
            .where(
              and(
                isNull(schema.assets.archivedAt),
                sql`(${prend(schema.assets.groupesCouleurs)} or ${prend(schema.assets.couleursImage)})`,
              ),
            ),
        ]);
        const noms = [
          ...persos.map((t) => `« ${t.name} »`),
          ...pieces.map((p) => `« ${p.name || `pièce ${p.id}`} »`),
        ];
        if (!noms.length) return null;
        return `Son nuancier est choisi pour des couleurs sur ${noms.length > 1 ? "les fiches" : "la fiche"} de ${enBref(noms)} : choisissez-y un autre nuancier, puis recommencez. Elle reste archivée.`;
      },
      supprimer: async () => {
        await db
          .delete(schema.pieceCategories)
          .where(
            and(
              eq(schema.pieceCategories.id, id),
              isNotNull(schema.pieceCategories.archivedAt),
            ),
          );
      },
      utilisePar: "des pièces",
    });
  });

  /**
   * Les nuanciers des personnages : peau, cheveux / pelage, vêtements,
   * pantalon — et, pour chacun, s'il a été réglé par la boutique ou s'il
   * garde ses couleurs d'origine.
   */
  app.get("/admin/nuanciers-base", async (c) => {
    const [nuanciers, modifies] = await Promise.all([
      lireNuanciersBase(),
      nuanciersModifies(),
    ]);
    return c.json({ nuanciers, modifies });
  });

  /**
   * Enregistre UN nuancier des personnages, dans l'ordre reçu : c'est
   * l'ordre que la cliente verra. `couleurs: null` le remet à ses couleurs
   * d'origine. De 1 à 24 couleurs « #RRGGBB », sans doublon (cf. nuanciers.ts).
   */
  app.post("/admin/nuanciers-base", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const r = await enregistrerNuancierBase(
      b.nuancier,
      b.couleurs === null ? null : b.couleurs,
    );
    if (!r.ok) return c.json({ error: r.raison }, 400);
    return c.json({ ok: true, nuanciers: r.nuanciers });
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
    // D'autres zones, peut-être : la couleur principale se remesure.
    void mesurerLaPiece(id);
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
      .set({
        // `null` : la pièce rend la main à sa catégorie.
        zonesMasquees:
          b.zonesMasquees === null
            ? null
            : zonesMasqueesPropres(b.zonesMasquees, piece.colorZones),
      })
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
      .select({
        colorZones: schema.assets.colorZones,
        groupesCouleurs: schema.assets.groupesCouleurs,
        couleursImage: schema.assets.couleursImage,
      })
      .from(schema.assets)
      .where(eq(schema.assets.id, id));
    // Les couleurs proposées pour chaque partie de la pièce : refusées en
    // bloc si l'une est mal écrite ou si l'on en ajoute au-delà de 10,
    // plutôt qu'enregistrées en partie. Les listes déjà rangées servent de
    // point de comparaison (cf. refusDesCouleursPropres).
    const refus = refusDesCouleursPropres(b, piece ?? null);
    if (refus) return c.json({ error: refus }, 400);
    if (!piece) return c.notFound();
    const zones =
      b.colorZones !== undefined ? zonesPropres(b.colorZones) : (piece.colorZones ?? {});
    const set: Partial<typeof schema.assets.$inferInsert> = {
      colorZones: Object.keys(zones).length ? zones : null,
      groupesCouleurs: groupesPropres(b.groupesCouleurs, zones),
    };
    // Les anciennes cases « Le client peut la changer » (plus lues, cf.
    // groupesProposesDeLaPiece). Le back-office ne les envoie plus : absentes,
    // on n'y touche pas, et une liste déjà en base reste telle quelle.
    if (b.zonesMasquees === null) set.zonesMasquees = null;
    else if (b.zonesMasquees !== undefined)
      set.zonesMasquees = zonesMasqueesPropres(b.zonesMasquees, zones);
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
    // « Détecter les couleurs » change le dessin et ses zones : la couleur
    // principale se remesure (rien n'est refait si le dessin n'a pas changé).
    void mesurerLaPiece(id);
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
    // Les parts des zones telles que le configurateur les reçoit : le
    // back-office désigne la même couleur principale que lui.
    return c.json(rows.map((r) => ({ ...r, partsDesZones: partsPourLaBoutique(r) })));
  });

  /**
   * La part du dessin que peint chaque zone, pour un dessin qui n'est pas
   * encore une pièce (Nouvelle pièce) ou dont la mesure n'est pas encore
   * rangée : ?url=/assets/x.svg&zones=st0,st1,st2. Lecture seule — rien
   * n'est écrit, ni en base ni sur le disque.
   *
   * Sans elle, « Nouvelle pièce » rangeait les parties et les ombres à la
   * seule clarté, puis la page Pièces autrement une fois la pièce créée et
   * mesurée (casquette 401 : la « couleur principale (la plus grande
   * surface) » ne peignait que 9 % du dessin), et un nom donné à la création
   * tombait sur une couleur devenue l'ombre d'une autre. C'est la MÊME mesure
   * que celle de l'enregistrement (couleur-principale.ts, partsDesZones) :
   * l'écran de création dit donc ce que la page Pièces dira.
   *
   * `parts: null` si le dessin ne se lit pas ; le back-office le dit alors.
   */
  app.get("/admin/assets/parts", async (c) => {
    const url = String(c.req.query("url") ?? "").trim();
    const zones: Record<string, string> = {};
    for (const z of String(c.req.query("zones") ?? "").split(","))
      if (/^st\d+$/.test(z.trim())) zones[z.trim()] = "#000000";
    // Une seule couleur (ou aucune) : rien à départager.
    if (!url || Object.keys(zones).length < 2) return c.json({ parts: null });
    // Seuls les noms des zones comptent pour la mesure : chacune est repeinte
    // d'un témoin, sa couleur du dessin n'y sert pas (cf. pixelsParZone).
    const parts = await partsDesZones(url, zones).catch(() => null);
    return c.json({ parts });
  });

  /** Crée ou met à jour une pièce (vêtement, coupe, accessoire…). */
  app.post("/admin/assets", async (c) => {
    const b = await c.req.json();
    // Même vérification que l'enregistrement des groupes, plus haut : une
    // pièce créée avec ses couleurs déjà réglées passe par ici. Modifiée
    // (`b.id`), ses listes déjà rangées comptent comme là-haut.
    const [rangee] = b.id
      ? await db
          .select({
            groupesCouleurs: schema.assets.groupesCouleurs,
            couleursImage: schema.assets.couleursImage,
          })
          .from(schema.assets)
          .where(eq(schema.assets.id, Number(b.id)))
      : [];
    const refus = refusDesCouleursPropres(b, rangee ?? null);
    if (refus) return c.json({ error: refus }, 400);
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
      // pas ne doit pas re-proposer d'un coup toutes les zones). `null` = la
      // pièce suit sa catégorie : c'est ce que reçoit une pièce créée sans
      // qu'on ait touché à ses cases.
      ...(b.zonesMasquees === null
        ? { zonesMasquees: null }
        : b.zonesMasquees !== undefined
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

    // Le numéro (`position`) est ce qui DÉSIGNE la pièce dans son
    // emplacement : les pièces autorisées d'un personnage, son calage
    // (« hair:2 ») et sa tenue par défaut s'enregistrent sous lui. Deux pièces
    // au même numéro se calaient donc ensemble — c'est arrivé en prod, la
    // création proposait 0 d'office (migration 0072). Une pièce générique
    // garde donc un numéro à elle.
    const voulu =
      b.position === undefined || b.position === null || b.position === ""
        ? null
        : Number(b.position);
    let position: number | undefined =
      voulu !== null && Number.isInteger(voulu) && voulu >= 0 ? voulu : undefined;
    if (values.characterTypeId === null) {
      const memeEmplacement = and(
        isNull(schema.assets.characterTypeId),
        eq(schema.assets.slot, values.slot),
        sql`coalesce(${schema.assets.view}, 'front') = ${values.view}`,
      );
      if (position !== undefined) {
        const [prise] = await db
          .select({ id: schema.assets.id, name: schema.assets.name })
          .from(schema.assets)
          .where(and(memeEmplacement, eq(schema.assets.position, position)));
        if (prise && prise.id !== Number(b.id)) {
          // Créée : elle prend le premier numéro libre, sans rien demander.
          // Modifiée : on refuse, renuméroter en silence décalerait ses calages.
          if (b.id)
            return c.json(
              {
                error: `Le numéro ${position} est déjà celui de la pièce « ${prise.name ?? prise.id} ».`,
              },
              400,
            );
          position = undefined;
        }
      }
      if (position === undefined && !b.id) {
        const [dernier] = await db
          .select({ plusHaut: sql<number | null>`max(${schema.assets.position})` })
          .from(schema.assets)
          .where(memeEmplacement);
        position = Number(dernier?.plusHaut ?? 0) + 1;
      }
    }
    // Une modification sans numéro ne touche pas au sien : elle le remettait
    // à 0.
    const ligne = position !== undefined ? { ...values, position } : values;

    if (b.id) {
      const [row] = await db
        .update(schema.assets)
        .set(ligne)
        .where(eq(schema.assets.id, Number(b.id)))
        .returning();
      // Un autre dessin, peut-être : la couleur principale se remesure.
      if (row) void mesurerLaPiece(row.id);
      return c.json(row);
    }
    const [row] = await db
      .insert(schema.assets)
      .values({ ...values, position: position ?? 0 })
      .returning();
    // Une pièce neuve : sa couleur principale se mesure tout de suite, en
    // arrière-plan.
    if (row) void mesurerLaPiece(row.id);
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

  /**
   * Les personnages qui désignent une pièce GÉNÉRIQUE par son numéro : ceux de
   * son type d'affiche (une pièce « de dos » ne s'offre qu'aux personnages de
   * dos — c'est la règle du configurateur, variantesDeVue). Pièces autorisées,
   * calage (« hair:3 ») et tenue par défaut la citent ainsi, et non par son id.
   *
   * Vide pour une pièce propre à un personnage, et quand une AUTRE pièce
   * générique porte le même numéro au même endroit (un doublon d'avant 0072) :
   * ces réglages la désignent alors aussi, ils ne sont pas à elle seule.
   */
  async function personnagesQuiDesignent(
    ex: typeof db | Transaction,
    p: { id: number; characterTypeId: number | null; slot: string; view: string | null; position: number },
  ) {
    if (p.characterTypeId != null) return [];
    const vue = p.view ?? "front";
    const [jumelle] = await ex
      .select({ id: schema.assets.id })
      .from(schema.assets)
      .where(
        and(
          isNull(schema.assets.characterTypeId),
          eq(schema.assets.slot, p.slot),
          sql`coalesce(${schema.assets.view}, 'front') = ${vue}`,
          eq(schema.assets.position, p.position),
          sql`${schema.assets.id} <> ${p.id}`,
        ),
      )
      .limit(1);
    if (jumelle) return [];
    return ex
      .select({
        id: schema.characterTypes.id,
        name: schema.characterTypes.name,
        archivedAt: schema.characterTypes.archivedAt,
        slotVariants: schema.characterTypes.slotVariants,
        slotAdjust: schema.characterTypes.slotAdjust,
        defaultAssets: schema.characterTypes.defaultAssets,
      })
      .from(schema.characterTypes)
      .where(eq(schema.characterTypes.orientation, vue))
      .orderBy(asc(schema.characterTypes.position), asc(schema.characterTypes.name));
  }

  /**
   * Supprime DÉFINITIVEMENT une pièce archivée (règles : suppression.ts).
   *
   * L'ancienne suppression avait été retirée parce qu'une pièce effacée
   * empêchait de régénérer le PDF des commandes qui la portaient. D'où le
   * refus tant qu'une commande — ou un panier en cours — la porte
   * (usages-commandes.ts), et tant qu'elle est la TENUE PAR DÉFAUT d'un
   * personnage en service : c'est lui qui dépend d'elle, on lui en choisit une
   * autre sur sa fiche d'abord.
   *
   * Ce qui part avec elle, dans la même transaction : les réglages qui ne
   * valent que pour elle chez les personnages — sa place dans leurs pièces
   * autorisées, son calage (« hair:3 ») et, chez un personnage archivé, la
   * tenue par défaut. Sans ce ménage, son numéro, redevenu libre, serait
   * repris par la prochaine pièce créée à cet endroit, qui hériterait en
   * silence de cases cochées et d'un calage qui n'étaient pas pour elle. Son
   * dessin reste sur le disque : seule la ligne part.
   */
  app.delete("/admin/assets/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.notFound();
    const reste = "Elle reste archivée.";
    return supprimerPourToujours(c, {
      lire: async () =>
        (
          await db
            .select({
              id: schema.assets.id,
              characterTypeId: schema.assets.characterTypeId,
              slot: schema.assets.slot,
              view: schema.assets.view,
              position: schema.assets.position,
              archivedAt: schema.assets.archivedAt,
            })
            .from(schema.assets)
            .where(eq(schema.assets.id, id))
        )[0] ?? null,
      estArchive: (p) => p.archivedAt != null,
      empeche: async (p) => {
        const porte = await commandesQuiEmpechent(db, { pieces: [p.id] }, reste);
        if (porte) return porte;
        const habilles = (await personnagesQuiDesignent(db, p)).filter(
          (t) =>
            t.archivedAt == null &&
            t.defaultAssets?.[p.slot] != null &&
            Number(t.defaultAssets[p.slot]) === p.position,
        );
        if (!habilles.length) return null;
        const n = habilles.length;
        return `C'est la tenue par défaut ${n > 1 ? "des personnages" : "du personnage"} ${enBref(habilles.map((t) => `« ${t.name} »`))} : choisissez-${n > 1 ? "leur" : "lui"} une autre pièce sur ${n > 1 ? "leur fiche" : "sa fiche"}, puis recommencez. ${reste}`;
      },
      supprimer: async (p) => {
        await db.transaction(async (tx) => {
          const partie = await tx
            .delete(schema.assets)
            .where(and(eq(schema.assets.id, p.id), isNotNull(schema.assets.archivedAt)))
            .returning({ id: schema.assets.id });
          // Restaurée entre-temps depuis un autre onglet : rien ne bouge.
          if (!partie.length) return;
          const cle = `${p.slot}:${p.position}`;
          for (const t of await personnagesQuiDesignent(tx, p)) {
            const set: Partial<typeof schema.characterTypes.$inferInsert> = {};
            const autorisees = (t.slotVariants ?? {}) as Record<string, number[] | undefined>;
            const liste = autorisees[p.slot];
            if (Array.isArray(liste) && liste.some((n) => Number(n) === p.position))
              set.slotVariants = {
                ...autorisees,
                [p.slot]: liste.filter((n) => Number(n) !== p.position),
              };
            if (t.slotAdjust && cle in t.slotAdjust) {
              const { [cle]: _, ...calage } = t.slotAdjust;
              set.slotAdjust = calage;
            }
            if (t.defaultAssets && Number(t.defaultAssets[p.slot]) === p.position) {
              const { [p.slot]: _, ...tenue } = t.defaultAssets;
              set.defaultAssets = tenue;
            }
            if (Object.keys(set).length)
              await tx
                .update(schema.characterTypes)
                .set(set)
                .where(eq(schema.characterTypes.id, t.id));
          }
        });
      },
    });
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
        // Désactivée dès sa création quand on le demande (20/11, fiche créée
        // depuis une image de BO › Affiches IA) : elle n'a encore ni nom
        // définitif ni visuel d'exemple, et ne doit pas paraître en boutique,
        // même le temps d'un second appel. Sinon, en ligne comme avant.
        ...(b.status === "draft" ? { status: "draft" } : {}),
      })
      .returning();
    if (!product) return c.json({ error: "création impossible" }, 500);
    // L'adresse était libre parmi les affiches, mais une redirection posée
    // quand une autre affiche l'a quittée peut encore en partir : la
    // nouvelle fiche serait introuvable (redirections.ts, libererAdresse).
    await libererAdresse(db, slug);

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

    for (const f of fonds) preparerVersionsLegeres(f);
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
    preparerVersionsLegeres(url);
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

  /**
   * Supprime DÉFINITIVEMENT un visuel (fond) archivé (règles : suppression.ts).
   *
   * Refusé tant qu'une commande — ou un panier en cours — est composée sur ce
   * fond (`backgroundId`, cf. usages-commandes.ts) : son fichier d'impression
   * relit le fond en base, et l'affiche ne se réimprimerait plus. Rien d'autre
   * ne le cite. Le fichier de l'image reste sur le disque : seule la ligne
   * part.
   */
  app.delete("/admin/backgrounds/:bgId", async (c) => {
    const bgId = Number(c.req.param("bgId"));
    if (!Number.isInteger(bgId) || bgId <= 0) return c.notFound();
    return supprimerPourToujours(c, {
      lire: async () =>
        (
          await db
            .select({ id: schema.backgrounds.id, archivedAt: schema.backgrounds.archivedAt })
            .from(schema.backgrounds)
            .where(eq(schema.backgrounds.id, bgId))
        )[0] ?? null,
      estArchive: (f) => f.archivedAt != null,
      empeche: () => commandesQuiEmpechent(db, { fond: bgId }, "Il reste archivé."),
      supprimer: async () => {
        await db
          .delete(schema.backgrounds)
          .where(and(eq(schema.backgrounds.id, bgId), isNotNull(schema.backgrounds.archivedAt)));
      },
    });
  });
}
