/**
 * Le bordereau transporteur tient-il ses promesses ?
 *
 * Déposer l'étiquette achetée chez le transporteur, la réimprimer, la retirer,
 * et surtout faire arriver le LIEN de suivi jusqu'à la cliente : ce script
 * repasse tout le chemin, de bout en bout, et rend son compte en français.
 *
 * POURQUOI UN SCRIPT PLUTÔT QU'UNE RELECTURE. Un dépôt n'a l'air de rien —
 * un fichier, deux champs. Mais il promet trois choses qu'aucune relecture ne
 * peut tenir dans six mois : qu'un PNG renommé « .pdf » sera refusé, que
 * « retirer » ne supprime JAMAIS le fichier, et que déposer une étiquette
 * n'expédie rien et n'écrit à personne. Chacune se casse d'une ligne ajoutée
 * un soir, et aucune ne se voit à l'écran le jour où elle se casse.
 *
 * AU NIVEAU FONCTION, ET PAS EN HTTP AVEC UN COOKIE. Les routes sont montées
 * sur une application Hono fabriquée ici, avec l'utilisateur que la garde de
 * « /admin/* » POSERAIT sur la requête. AUCUNE session n'est créée, aucun
 * compte n'est touché, rien ne se connecte. Deux conséquences, à connaître :
 *
 *   - le 401 « non authentifié » n'est pas mesuré ici : il vient de la garde
 *     d'index.ts, pas de ces routes-là ;
 *   - le 404 opposé à un vendeur est mesuré sur le CONTRÔLE DE LA ROUTE. En
 *     HTTP réel, « /admin/bordereaux/:id/fichier.pdf » n'est pas dans
 *     LECTURES_DU_VENDEUR (index.ts) : la garde générale répond 403 avant
 *     d'atteindre la route. Le contrôle réécrit dans la route reste ce qui
 *     tiendra le jour où quelqu'un élargira cette liste blanche, et c'est lui
 *     qu'on vérifie. Sur « /admin/orders/:id/bordereaux », qui EST dans la
 *     liste, le 404 vérifié ici est aussi celui que reçoit un vendeur.
 *
 * CE SCRIPT NE PARLE À AUCUN TRANSPORTEUR. Pas une requête ne sort de cette
 * machine : acheter une étiquette coûte de l'argent, et l'achat n'existe pas
 * encore de toute façon. Il ne lit, n'écrit et n'affiche aucune clé.
 *
 * SES COMMANDES D'ESSAI SONT À LUI, ET IL LES REPREND. La base de
 * développement porte les vraies commandes d'Alexandra : le script n'en touche
 * aucune. Il fabrique les siennes, préfixées « ESSAI-BORDEREAU- », et les
 * retire à la fin — même s'il échoue en route. Il balaie aussi, au démarrage,
 * ce qu'une exécution interrompue aurait laissé.
 *
 * Usage :
 *   pnpm --filter @memoryline/api run verifier:bordereaux
 */
import { Hono } from "hono";
import { and, desc, eq, inArray, like } from "drizzle-orm";
import { readFile, readdir, stat, unlink } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { db, schema } from "../src/db/client.js";
import { mountBordereaux } from "../src/bordereaux.js";
import {
  COMMANDE_ANNULEE,
  LIBELLE_EXPEDITION,
  creerExpedition,
  lienDeSuivi,
  lienDeSuiviDepuisLibelle,
  resumeCommandes,
  statutExpedition,
} from "../src/commandes.js";
import { TRANSPORTEURS } from "../src/livraison-regles.js";
import {
  DOSSIER_BORDEREAUX,
  DOSSIER_PRIVE,
  cheminPrive,
  lire,
} from "../src/stockage-prive.js";

/** Le préfixe qui distingue une commande de ce script de toutes les autres. */
const PREFIXE_ESSAI = "ESSAI-BORDEREAU-";

/** L'adresse gravée sur les lignes d'essai. Aucun compte ne porte ce nom. */
const AUTEUR_ESSAI = "verification.bordereaux@memory-line.test";

/* -------------------------------------------------------------------------- */
/*  Le compte rendu                                                           */
/* -------------------------------------------------------------------------- */

let verifiees = 0;
const fautes: string[] = [];

function section(titre: string): void {
  console.log(`\n${titre}`);
}

function verifier(quoi: string, tenu: unknown, constate?: string): boolean {
  verifiees++;
  if (tenu) {
    console.log(`  ✓ ${quoi}`);
    return true;
  }
  fautes.push(quoi + (constate ? ` (constaté : ${constate})` : ""));
  console.log(`  ✗ ${quoi}`);
  if (constate) console.log(`      constaté : ${constate}`);
  return false;
}

/** La même chose, quand ce qui compte est la valeur exacte et non un oui/non. */
function egal(quoi: string, obtenu: unknown, attendu: unknown): boolean {
  const memeChose = JSON.stringify(obtenu) === JSON.stringify(attendu);
  return verifier(
    quoi,
    memeChose,
    `${JSON.stringify(obtenu)} au lieu de ${JSON.stringify(attendu)}`,
  );
}

/* -------------------------------------------------------------------------- */
/*  Le back-office, sans le back-office                                       */
/* -------------------------------------------------------------------------- */

/**
 * Les routes du dépôt, montées comme elles le sont dans index.ts, avec
 * l'utilisateur déjà posé sur la requête.
 *
 * C'est exactement ce que fait la garde de « /admin/* » une fois la session
 * validée — sauf qu'ici il n'y a NI session, NI cookie, NI compte : rien que
 * l'objet que les routes lisent pour savoir qui demande. Ouvrir une vraie
 * session pour éprouver un contrôle de rôle reviendrait à créer un compte
 * vendeur dans la base d'Alexandra, et à le laisser derrière soi.
 */
function backOffice(role: "owner" | "seller"): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("utilisateur", {
      sessionId: "",
      adminUserId: 0,
      email: AUTEUR_ESSAI,
      role,
    });
    await next();
  });
  mountBordereaux(app);
  return app;
}

/** Le corps d'une réponse, que la route ait répondu en JSON ou non. */
async function corpsDe(rep: Response): Promise<Record<string, unknown>> {
  const texte = await rep.text();
  try {
    return JSON.parse(texte) as Record<string, unknown>;
  } catch {
    return { texte };
  }
}

interface ChampsDepot {
  contenu?: Buffer;
  nom?: string;
  transporteur?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  poidsGrammes?: number;
}

/** Poste le formulaire de dépôt, tel que l'écran l'enverra. */
async function deposer(
  app: Hono,
  orderId: number,
  champs: ChampsDepot,
): Promise<{ statut: number; corps: Record<string, unknown> }> {
  const form = new FormData();
  if (champs.contenu)
    form.set(
      "fichier",
      new File([new Uint8Array(champs.contenu)], champs.nom ?? "etiquette.pdf"),
    );
  if (champs.transporteur !== undefined)
    form.set("transporteur", champs.transporteur);
  if (champs.trackingNumber !== undefined)
    form.set("trackingNumber", champs.trackingNumber);
  if (champs.trackingUrl !== undefined) form.set("trackingUrl", champs.trackingUrl);
  if (champs.poidsGrammes !== undefined)
    form.set("poidsGrammes", String(champs.poidsGrammes));
  const rep = await app.request(`/admin/orders/${orderId}/bordereau`, {
    method: "POST",
    body: form,
  });
  return { statut: rep.status, corps: await corpsDe(rep) };
}

/* -------------------------------------------------------------------------- */
/*  Les commandes d'essai                                                     */
/* -------------------------------------------------------------------------- */

const essais: number[] = [];
let compteur = 0;

async function commandeDEssai(opts: {
  quoi: string;
  channel?: "web" | "salon";
  status?: string;
  poidsGrammes?: number;
  quantite?: number;
}): Promise<typeof schema.orders.$inferSelect> {
  const [order] = await db
    .insert(schema.orders)
    .values({
      channel: opts.channel ?? "web",
      number: `${PREFIXE_ESSAI}${Date.now().toString(36)}-${++compteur}-${opts.quoi}`,
      status: opts.status ?? "paid",
      weightGrams: opts.poidsGrammes ?? 0,
      shippingName: "Essai Vérification",
      shippingLine1: "1 rue de l'Essai",
      shippingPostalCode: "75001",
      shippingCity: "Paris",
      shippingCountry: "FR",
    })
    .returning();
  essais.push(order!.id);
  await db.insert(schema.orderItems).values({
    orderId: order!.id,
    title: "Affiche d'essai",
    quantity: opts.quantite ?? 1,
    unitPriceCents: 0,
  });
  return order!;
}

/**
 * Reprend ce que le script a créé, et rien d'autre.
 *
 * Deux filets : la liste des identifiants fabriqués pendant l'exécution, ET le
 * préfixe du numéro relu en base. Un identifiant se trompe de chiffre ; un
 * numéro de commande, non. La cascade de `order` emporte ensuite les lignes,
 * le journal, les expéditions et les bordereaux — les fichiers, eux, se
 * retirent un par un, puisque rien ne les efface jamais en production.
 */
async function reprendreLesEssais(
  ids: number[],
): Promise<{ commandes: number; fichiers: number }> {
  if (!ids.length) return { commandes: 0, fichiers: 0 };
  const lignes = await db
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .where(
      and(
        inArray(schema.orders.id, ids),
        like(schema.orders.number, `${PREFIXE_ESSAI}%`),
      ),
    );
  const aReprendre = lignes.map((l) => l.id);
  if (!aReprendre.length) return { commandes: 0, fichiers: 0 };

  const fichiers = await db
    .select({ fichier: schema.bordereaux.fichier })
    .from(schema.bordereaux)
    .where(inArray(schema.bordereaux.orderId, aReprendre));
  let retires = 0;
  for (const f of fichiers) {
    if (!f.fichier) continue;
    try {
      await unlink(cheminPrive(DOSSIER_BORDEREAUX, f.fichier));
      retires++;
    } catch {
      // Déjà parti, ou jamais écrit : il n'y a rien à reprendre.
    }
  }
  await db.delete(schema.orders).where(inArray(schema.orders.id, aReprendre));
  return { commandes: aReprendre.length, fichiers: retires };
}

/* -------------------------------------------------------------------------- */
/*  De quoi fabriquer un PDF, un faux PDF, et un PDF trop lourd               */
/* -------------------------------------------------------------------------- */

/** Une étiquette A6 plausible, fabriquée ici : rien n'est acheté nulle part. */
async function pdfDEssai(texte: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([298, 420]); // A6, le format d'une vraie étiquette
  const police = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(texte, { x: 18, y: 380, size: 9, font: police });
  return Buffer.from(await doc.save());
}

/** Les huit premiers octets d'un PNG, de quoi éprouver la lecture d'en-tête. */
const OCTETS_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Le dernier message du journal d'une commande. */
async function dernierEvenement(orderId: number): Promise<string> {
  const [e] = await db
    .select({ message: schema.orderEvents.message })
    .from(schema.orderEvents)
    .where(eq(schema.orderEvents.orderId, orderId))
    .orderBy(desc(schema.orderEvents.id));
  return e?.message ?? "";
}

async function bordereauEnBase(
  id: number,
): Promise<typeof schema.bordereaux.$inferSelect | undefined> {
  const [b] = await db
    .select()
    .from(schema.bordereaux)
    .where(eq(schema.bordereaux.id, id));
  return b;
}

/* -------------------------------------------------------------------------- */
/*  La vérification                                                           */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  console.log(
    "Vérification du bordereau transporteur — dépôt, impression, retrait, suivi.\n" +
      "Au niveau fonction : aucune session, aucun cookie, aucun appel à un transporteur.",
  );

  // Ce qu'une exécution interrompue aurait laissé derrière elle.
  const anciens = await db
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .where(like(schema.orders.number, `${PREFIXE_ESSAI}%`));
  if (anciens.length) {
    const repris = await reprendreLesEssais(anciens.map((a) => a.id));
    console.log(
      `\n(Une exécution précédente avait laissé ${repris.commandes} commande(s) d'essai : reprises.)`,
    );
  }

  const proprietaire = backOffice("owner");
  const vendeur = backOffice("seller");
  const pdf = await pdfDEssai("ESSAI - verifier:bordereaux - aucun achat");

  /* --- 1. Le dépôt ------------------------------------------------------- */

  section("1. LE DÉPÔT D'UNE ÉTIQUETTE ACHETÉE AILLEURS");

  const cdeDepot = await commandeDEssai({
    quoi: "depot",
    poidsGrammes: 1200,
    quantite: 2,
  });
  const fichiersAvant = (await readdir(DOSSIER_BORDEREAUX).catch(() => [])).length;

  const depot = await deposer(proprietaire, cdeDepot.id, {
    contenu: pdf,
    // Une majuscule et une espace dans le nom : l'extension se lit sans tenir
    // compte de la casse, et le nom du poste d'Alexandra n'est jamais réutilisé.
    nom: "Etiquette Mondial Relay.PDF",
    transporteur: "mondial_relay",
    trackingNumber: "  MR-123 456  ",
    poidsGrammes: 850,
  });
  const idBordereau = Number(depot.corps.id);

  egal("le dépôt est accepté", depot.statut, 200);
  // Tout ce qui suit s'appuie sur CE bordereau : sans lui, les cinquante
  // vérifications suivantes échoueraient en chaîne sans rien apprendre. On
  // s'arrête ici, et les commandes d'essai sont reprises comme d'habitude.
  if (!idBordereau)
    throw new Error(
      `Le dépôt a été refusé (${depot.statut}) : ${String(depot.corps.error ?? depot.corps.texte ?? "")}`,
    );
  egal("la ligne est « déposée », pas « achetée »", depot.corps.source, "depose");
  egal("son statut est « depose »", depot.corps.statut, "depose");
  egal(
    "elle garde le CODE machine du transporteur",
    depot.corps.transporteur,
    "mondial_relay",
  );
  egal(
    "et le LIBELLÉ figé le jour du dépôt",
    depot.corps.transporteurNom,
    "Mondial Relay",
  );
  egal(
    "le numéro de suivi est élagué de ses espaces",
    depot.corps.trackingNumber,
    "MR-123 456",
  );
  egal(
    "le lien de suivi est fabriqué pour Mondial Relay",
    depot.corps.trackingUrl,
    lienDeSuivi("mondial_relay", "MR-123 456"),
  );
  egal("le poids saisi est celui qui est écrit", depot.corps.poidsGrammes, 850);
  egal("l'auteur du dépôt est gravé sur la ligne", depot.corps.createdBy, AUTEUR_ESSAI);
  egal(
    "le nom du fichier est reconstruit de zéro",
    depot.corps.fichier,
    `${idBordereau}-mr-123-456.pdf`,
  );
  egal("sa taille est notée", depot.corps.fichierOctets, pdf.length);
  egal("aucune expédition ne lui est encore rattachée", depot.corps.fulfillmentId, null);

  const surDisque = await lire(DOSSIER_BORDEREAUX, String(depot.corps.fichier));
  verifier(
    "le PDF est bien sur le disque, entier",
    surDisque?.length === pdf.length,
    `${surDisque?.length ?? "absent"} octets au lieu de ${pdf.length}`,
  );
  verifier(
    "et c'est bien un PDF",
    surDisque?.subarray(0, 5).toString("latin1") === "%PDF-",
    surDisque?.subarray(0, 5).toString("latin1") ?? "absent",
  );
  egal(
    "le journal de la commande le dit, mot pour mot",
    await dernierEvenement(cdeDepot.id),
    "Bordereau Mondial Relay joint, suivi MR-123 456.",
  );

  const apresDepot = await db
    .select()
    .from(schema.fulfillments)
    .where(eq(schema.fulfillments.orderId, cdeDepot.id));
  egal("DÉPOSER N'EXPÉDIE RIEN : aucune expédition n'est née", apresDepot.length, 0);
  const [relueApresDepot] = await db
    .select({ fulfilledAt: schema.orders.fulfilledAt })
    .from(schema.orders)
    .where(eq(schema.orders.id, cdeDepot.id));
  egal(
    "la commande n'est pas passée « traitée »",
    relueApresDepot?.fulfilledAt ?? null,
    null,
  );

  /* --- 2. Les refus ------------------------------------------------------ */

  section("2. CE QUE LE DÉPÔT REFUSE, ET AVEC QUEL CODE");

  const cdeRefus = await commandeDEssai({ quoi: "refus" });
  const cdeAnnulee = await commandeDEssai({ quoi: "annulee", status: "cancelled" });
  const cdeSalon = await commandeDEssai({ quoi: "salon", channel: "salon" });

  const [plusGrand] = await db
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .orderBy(desc(schema.orders.id));
  const inexistante = (plusGrand?.id ?? 0) + 1_000_000;

  const refus: { quoi: string; statut: number; corps: Record<string, unknown> }[] = [];

  refus.push({
    quoi: "commande inexistante → 404",
    ...(await deposer(proprietaire, inexistante, {
      contenu: pdf,
      transporteur: "mondial_relay",
      trackingNumber: "MR-1",
    })),
  });
  refus.push({
    quoi: "commande annulée → 400, et la phrase de l'expédition",
    ...(await deposer(proprietaire, cdeAnnulee.id, {
      contenu: pdf,
      transporteur: "mondial_relay",
      trackingNumber: "MR-1",
    })),
  });
  refus.push({
    quoi: "vente au stand → 400 (pas de colis à étiqueter)",
    ...(await deposer(proprietaire, cdeSalon.id, {
      contenu: pdf,
      transporteur: "mondial_relay",
      trackingNumber: "MR-1",
    })),
  });
  refus.push({
    quoi: "un bordereau est déjà joint → 409",
    ...(await deposer(proprietaire, cdeDepot.id, {
      contenu: pdf,
      transporteur: "mondial_relay",
      trackingNumber: "MR-2",
    })),
  });
  refus.push({
    quoi: "aucun fichier → 400",
    ...(await deposer(proprietaire, cdeRefus.id, {
      transporteur: "mondial_relay",
      trackingNumber: "MR-1",
    })),
  });
  refus.push({
    quoi: "un vrai PDF nommé « .png » → 415 (l'extension)",
    ...(await deposer(proprietaire, cdeRefus.id, {
      contenu: pdf,
      nom: "etiquette.png",
      transporteur: "mondial_relay",
      trackingNumber: "MR-1",
    })),
  });
  refus.push({
    quoi: "un PNG renommé « .pdf » → 415 (les octets)",
    ...(await deposer(proprietaire, cdeRefus.id, {
      contenu: Buffer.concat([OCTETS_PNG, Buffer.alloc(2048, 0)]),
      nom: "etiquette.pdf",
      transporteur: "mondial_relay",
      trackingNumber: "MR-1",
    })),
  });
  refus.push({
    quoi: "un PDF de 6 Mo → 413",
    ...(await deposer(proprietaire, cdeRefus.id, {
      contenu: Buffer.concat([pdf, Buffer.alloc(6 * 1024 * 1024, 0x20)]),
      transporteur: "mondial_relay",
      trackingNumber: "MR-1",
    })),
  });
  refus.push({
    quoi: "aucun transporteur → 400",
    ...(await deposer(proprietaire, cdeRefus.id, {
      contenu: pdf,
      trackingNumber: "MR-1",
    })),
  });
  refus.push({
    quoi: "un transporteur inconnu → 400",
    ...(await deposer(proprietaire, cdeRefus.id, {
      contenu: pdf,
      // Le LIBELLÉ à la place du code : l'erreur que fera un jour un <select>
      // mal câblé, et le refus doit la nommer.
      transporteur: "Mondial Relay",
      trackingNumber: "MR-1",
    })),
  });
  refus.push({
    quoi: "un numéro de suivi vide → 400",
    ...(await deposer(proprietaire, cdeRefus.id, {
      contenu: pdf,
      transporteur: "mondial_relay",
      trackingNumber: "   ",
    })),
  });

  const codesAttendus = [404, 400, 400, 409, 400, 415, 415, 413, 400, 400, 400];
  refus.forEach((r, i) => {
    egal(r.quoi, r.statut, codesAttendus[i]);
  });
  verifier(
    "chaque refus porte une phrase française prête à afficher",
    refus.every(
      (r) => r.statut === 404 || (typeof r.corps.error === "string" && r.corps.error.length > 20),
    ),
    refus.map((r) => String(r.corps.error ?? r.corps.texte)).join(" | "),
  );
  egal(
    "la commande annulée oppose LA phrase de l'expédition",
    refus[1]!.corps.error,
    COMMANDE_ANNULEE,
  );
  verifier(
    "le transporteur inconnu est nommé dans le refus",
    String(refus[9]!.corps.error ?? "").includes("Mondial Relay"),
    String(refus[9]!.corps.error ?? ""),
  );

  const restesRefus = await db
    .select()
    .from(schema.bordereaux)
    .where(eq(schema.bordereaux.orderId, cdeRefus.id));
  egal("AUCUN refus n'a laissé de ligne en base", restesRefus.length, 0);
  const fichiersApresRefus = (await readdir(DOSSIER_BORDEREAUX)).length;
  egal(
    "ni de fichier sur le disque",
    fichiersApresRefus,
    fichiersAvant + 1, // le seul dépôt accepté, celui de la section 1
  );

  /* --- 3. Le PDF, et qui a le droit de le lire --------------------------- */

  section("3. LE PDF, ET QUI A LE DROIT DE LE LIRE");

  const repPdf = await proprietaire.request(
    `/admin/bordereaux/${idBordereau}/fichier.pdf`,
  );
  const corpsPdf = Buffer.from(await repPdf.arrayBuffer());
  egal("la propriétaire l'ouvre", repPdf.status, 200);
  egal(
    "servi en application/pdf",
    repPdf.headers.get("content-type"),
    "application/pdf",
  );
  verifier(
    "et « inline » : il s'ouvre dans l'onglet, d'où il s'imprime",
    (repPdf.headers.get("content-disposition") ?? "").startsWith("inline;"),
    repPdf.headers.get("content-disposition") ?? "aucun",
  );
  verifier(
    "le corps est le PDF déposé, octet pour octet",
    corpsPdf.length === pdf.length && corpsPdf.subarray(0, 5).toString("latin1") === "%PDF-",
    `${corpsPdf.length} octets`,
  );

  const repPdfVendeur = await vendeur.request(
    `/admin/bordereaux/${idBordereau}/fichier.pdf`,
  );
  egal(
    "un vendeur reçoit 404 — pas 403 : l'adresse ne confirme même pas qu'elle existe",
    repPdfVendeur.status,
    404,
  );
  verifier(
    "et rien qui ressemble à un PDF",
    !(await repPdfVendeur.text()).startsWith("%PDF-"),
  );

  const listeVendeur = await vendeur.request(
    `/admin/orders/${cdeDepot.id}/bordereaux`,
  );
  egal("la liste des bordereaux lui est fermée aussi", listeVendeur.status, 404);
  const listeProprietaire = await proprietaire.request(
    `/admin/orders/${cdeDepot.id}/bordereaux`,
  );
  const lignesListe = (await listeProprietaire.json()) as unknown[];
  egal("la propriétaire y voit son bordereau", lignesListe.length, 1);

  const repInconnu = await proprietaire.request(
    `/admin/bordereaux/${idBordereau + 1_000_000}/fichier.pdf`,
  );
  egal("un bordereau inexistant → 404", repInconnu.status, 404);

  /*
   * La différence entre data/prive et data/assets, mesurée.
   *
   * On refait exactement ce que fait GET /assets/:file (index.ts) : basename()
   * puis resolve() sous le dossier des visuels, qui est SERVI SANS SESSION. Le
   * fichier ne doit pas s'y trouver — c'est toute la raison d'être du dossier
   * privé, et c'est ce que la moindre erreur de chemin ferait sauter.
   */
  const dossierAssets = resolve(DOSSIER_PRIVE, "..", "assets");
  const parLaRoutePublique = resolve(
    dossierAssets,
    basename(String(depot.corps.fichier)),
  );
  const servi = await stat(parLaRoutePublique).then(
    () => true,
    () => false,
  );
  verifier(
    "le fichier n'est PAS servi par l'adresse publique des visuels",
    !servi,
    parLaRoutePublique,
  );

  /* --- 4. L'expédition qui porte le bordereau ---------------------------- */

  section("4. L'EXPÉDITION QUI PORTE LE BORDEREAU (le lien arrive à la cliente)");

  const [ligneDepot] = await db
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, cdeDepot.id));

  const expedition = await creerExpedition(cdeDepot.id, {
    items: [{ orderItemId: ligneDepot!.id, quantity: 1 }],
    bordereauId: idBordereau,
    // Ce que le formulaire raconterait à côté : le bordereau doit gagner.
    carrier: "Saisie à ignorer",
    trackingNumber: "NUMERO-A-IGNORER",
  });
  const colis = expedition.expedition!;
  verifier("l'expédition est créée", !expedition.erreur, expedition.erreur ?? "");
  egal(
    "elle porte le LIBELLÉ du transporteur, pas son code",
    colis.carrier,
    "Mondial Relay",
  );
  egal("le suivi vient du bordereau", colis.trackingNumber, "MR-123 456");
  egal(
    "le LIEN de suivi aussi — c'est lui que la cliente recevra",
    colis.trackingUrl,
    lienDeSuivi("mondial_relay", "MR-123 456"),
  );
  egal(
    "ce qui était saisi à côté est ignoré",
    [colis.carrier, colis.trackingNumber].includes("Saisie à ignorer"),
    false,
  );
  egal(
    "le bordereau sait désormais de quelle expédition il est",
    (await bordereauEnBase(idBordereau))?.fulfillmentId,
    colis.id,
  );

  const resume = (await resumeCommandes([cdeDepot.id])).get(cdeDepot.id)!;
  egal(
    "expédition partielle : la commande reste « Partiellement traitée »",
    LIBELLE_EXPEDITION[statutExpedition(resume.articles, resume.expedies)],
    "Partiellement traitée",
  );
  const [relueApresColis] = await db
    .select({ fulfilledAt: schema.orders.fulfilledAt })
    .from(schema.orders)
    .where(eq(schema.orders.id, cdeDepot.id));
  egal("et sa date de traitement reste vide", relueApresColis?.fulfilledAt ?? null, null);

  /*
   * LE VRAI GAIN, celui qui n'existait pas avant : GLS.
   *
   * `lienDeSuivi` ne connaît que cinq transporteurs. Pour les cinq autres, le
   * lien collé au dépôt est la SEULE façon d'en avoir un — sans lui, la
   * cliente reçoit un numéro tout nu qu'elle doit recopier quelque part.
   */
  const LIEN_GLS = "https://gls-group.eu/FR/fr/suivi-colis?match=ZX999888777";
  verifier(
    "la boutique ne sait pas fabriquer un lien GLS",
    lienDeSuivi("gls", "ZX999888777") === null,
    String(lienDeSuivi("gls", "ZX999888777")),
  );
  const cdeGls = await commandeDEssai({ quoi: "gls", poidsGrammes: 600 });
  const depotGls = await deposer(proprietaire, cdeGls.id, {
    contenu: pdf,
    transporteur: "gls",
    trackingNumber: "ZX999888777",
    trackingUrl: LIEN_GLS,
  });
  egal("le lien collé à la main est gardé tel quel", depotGls.corps.trackingUrl, LIEN_GLS);
  const colisGls = (await creerExpedition(cdeGls.id, {
    bordereauId: Number(depotGls.corps.id),
  })).expedition!;
  egal("et c'est CE lien que l'expédition porte", colisGls.trackingUrl, LIEN_GLS);
  egal("sous le nom du transporteur", colisGls.carrier, "GLS");

  /* La saisie à la main, elle, n'a pas bougé d'un iota. */
  const cdeMain = await commandeDEssai({ quoi: "main" });
  const colisMain = (await creerExpedition(cdeMain.id, {
    carrier: "Colissimo",
    trackingNumber: "6A12345678901",
  })).expedition!;
  egal("sans bordereau, le transporteur saisi est gardé", colisMain.carrier, "Colissimo");
  egal(
    "et le lien reste calculé comme avant",
    colisMain.trackingUrl,
    // Écrit en toutes lettres, et surtout pas redemandé à la fonction qu'on
    // est en train d'éprouver : comparer une fonction à elle-même passerait
    // aussi bien le jour où elle ne rend plus rien du tout.
    "https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678901",
  );

  /*
   * Un bordereau retiré ne fait plus partir de colis.
   *
   * Sur une commande NEUVE, et c'est indispensable : sur une commande dont
   * tout est déjà parti, c'est « Rien à expédier » qui répondrait d'abord, et
   * le cas ne prouverait rien.
   */
  const cdeRetire = await commandeDEssai({ quoi: "retire" });
  const depotRetire = await deposer(proprietaire, cdeRetire.id, {
    contenu: pdf,
    transporteur: "colissimo",
    trackingNumber: "6A99999999999",
  });
  await proprietaire.request(`/admin/bordereaux/${depotRetire.corps.id}/retirer`, {
    method: "POST",
  });
  const refusRetire = await creerExpedition(cdeRetire.id, {
    bordereauId: Number(depotRetire.corps.id),
  });
  egal(
    "expédier avec un bordereau retiré est refusé",
    refusRetire.erreur,
    "Ce bordereau n'est plus joint à cette commande. Rechargez la fiche avant d'enregistrer l'expédition.",
  );
  const colisRetire = await db
    .select()
    .from(schema.fulfillments)
    .where(eq(schema.fulfillments.orderId, cdeRetire.id));
  egal("et rien n'est parti", colisRetire.length, 0);


  /* --- 5. Shop2Shop, et les dix transporteurs ---------------------------- */

  section("5. LE LIEN DE SUIVI — AUCUN LIEN PLUTÔT QU'UN LIEN QUI MENT");

  /*
   * SHOP2SHOP EST LE PIÈGE, ET IL SE REFERMAIT SUR LES DEUX CHEMINS.
   *
   * Son libellé est « Shop2Shop (Cdiscount / Chronopost) » : reconnu au mot
   * « chronopost », il fabriquait un lien Chronopost qui ne suivra jamais ce
   * colis-là. Ce lien part dans le bouton « Suivre mon colis » du courrier
   * d'expédition, et un courrier ne se rappelle pas. C'est le seul des dix
   * transporteurs dont le libellé porte le nom d'un autre — donc le seul à
   * pouvoir tromper une reconnaissance par morceaux de texte, et la raison
   * pour laquelle il n'y en a plus.
   */
  const LIBELLE_S2S = "Shop2Shop (Cdiscount / Chronopost)";
  egal(
    "le libellé de Shop2Shop porte bien le nom d'un autre transporteur",
    TRANSPORTEURS.find((t) => t.code === "shop2shop")?.nom,
    LIBELLE_S2S,
  );
  egal(
    "par son CODE, aucun lien n'est fabriqué",
    lienDeSuivi("shop2shop", "S2S-999"),
    null,
  );
  egal(
    "par son LIBELLÉ non plus — c'est là que le piège se refermait",
    lienDeSuiviDepuisLibelle(LIBELLE_S2S, "S2S-999"),
    null,
  );

  /* Chemin 1 : le bordereau déposé, puis l'expédition qui le porte. */
  const cdeS2S = await commandeDEssai({ quoi: "shop2shop" });
  const depotS2S = await deposer(proprietaire, cdeS2S.id, {
    contenu: pdf,
    transporteur: "shop2shop",
    trackingNumber: "S2S-999",
  });
  egal("le dépôt Shop2Shop est accepté", depotS2S.statut, 200);
  egal("et il ne range AUCUN lien", depotS2S.corps.trackingUrl, null);
  const colisS2S = (
    await creerExpedition(cdeS2S.id, { bordereauId: Number(depotS2S.corps.id) })
  ).expedition!;
  egal("l'expédition porte le libellé du bordereau", colisS2S.carrier, LIBELLE_S2S);
  egal(
    "et aucun lien : elle ne redevine pas ce que le dépôt a déjà tranché",
    colisS2S.trackingUrl,
    null,
  );
  verifier(
    "aucun lien Chronopost ne part chez la cliente (chemin du bordereau)",
    !String(colisS2S.trackingUrl ?? "").includes("chronopost"),
    String(colisS2S.trackingUrl),
  );

  /* Chemin 2 : la saisie à la main, avec le libellé pris dans la liste. */
  const cdeS2SMain = await commandeDEssai({ quoi: "shop2shop-main" });
  const colisS2SMain = (
    await creerExpedition(cdeS2SMain.id, {
      carrier: LIBELLE_S2S,
      trackingNumber: "S2S-123",
    })
  ).expedition!;
  egal(
    "saisi à la main, le libellé est gardé tel quel",
    colisS2SMain.carrier,
    LIBELLE_S2S,
  );
  egal("et aucun lien n'est inventé", colisS2SMain.trackingUrl, null);
  verifier(
    "aucun lien Chronopost ne part chez la cliente (chemin de la saisie)",
    !String(colisS2SMain.trackingUrl ?? "").includes("chronopost"),
    String(colisS2SMain.trackingUrl),
  );

  /*
   * Et la porte de sortie : le champ « lien de suivi » du formulaire
   * d'expédition, qui est désormais la seule façon de donner un lien à un
   * transporteur que la boutique ne sait pas fabriquer.
   */
  const LIEN_S2S = "https://www.shop2shop.fr/suivi?id=S2S-777";
  const cdeS2SColle = await commandeDEssai({ quoi: "shop2shop-colle" });
  const colisS2SColle = (
    await creerExpedition(cdeS2SColle.id, {
      carrier: LIBELLE_S2S,
      trackingNumber: "S2S-777",
      trackingUrl: LIEN_S2S,
    })
  ).expedition!;
  egal(
    "le lien collé dans le formulaire d'expédition est gardé tel quel",
    colisS2SColle.trackingUrl,
    LIEN_S2S,
  );

  /*
   * LES NEUF AUTRES N'ONT PAS BOUGÉ — par le code ET par le libellé.
   *
   * Les adresses sont écrites en toutes lettres, et non redemandées à la
   * fonction qu'on éprouve : c'est la seule façon de voir qu'une d'elles a
   * changé. La boucle part de la liste de référence, donc un onzième
   * transporteur ajouté un jour fera échouer cette vérification tant que
   * personne n'aura dit ce que son lien doit valoir.
   */
  const NUMERO = "N1";
  const LIENS_ATTENDUS: Record<string, string | null> = {
    mondial_relay: `https://www.mondialrelay.fr/suivi-de-colis?numeroExpedition=${NUMERO}`,
    colissimo: `https://www.laposte.fr/outils/suivre-vos-envois?code=${NUMERO}`,
    chronopost: `https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=${NUMERO}`,
    relais_colis: null,
    colis_prive: null,
    dpd: null,
    gls: null,
    shop2shop: null,
    ups: `https://www.ups.com/track?tracknum=${NUMERO}`,
    dhl: `https://www.dhl.com/fr-fr/home/tracking.html?tracking-id=${NUMERO}`,
  };
  egal(
    "la liste de référence compte toujours dix transporteurs",
    TRANSPORTEURS.length,
    Object.keys(LIENS_ATTENDUS).length,
  );
  for (const t of TRANSPORTEURS) {
    const connu = Object.prototype.hasOwnProperty.call(LIENS_ATTENDUS, t.code);
    if (!verifier(`${t.nom} est prévu par cette vérification`, connu, t.code))
      continue;
    const attendu = LIENS_ATTENDUS[t.code] ?? null;
    egal(`${t.nom} — par le code « ${t.code} »`, lienDeSuivi(t.code, NUMERO), attendu);
    egal(
      `${t.nom} — par son libellé`,
      lienDeSuiviDepuisLibelle(t.nom, NUMERO),
      attendu,
    );
  }

  /*
   * Les libellés courts d'avant la liste de référence, qui dorment encore
   * dans la colonne `carrier` d'expéditions parties : les reconnaître évite
   * de faire disparaître le lien de suivi d'un colis de l'an dernier.
   */
  egal(
    "« Colissimo » tout court garde son lien",
    lienDeSuiviDepuisLibelle("Colissimo", NUMERO),
    LIENS_ATTENDUS.colissimo,
  );
  egal(
    "« DHL » tout court aussi",
    lienDeSuiviDepuisLibelle("DHL", NUMERO),
    LIENS_ATTENDUS.dhl,
  );
  egal(
    "« Remise en main propre » ne donne aucun lien",
    lienDeSuiviDepuisLibelle("Remise en main propre", NUMERO),
    null,
  );
  egal(
    "un libellé vide non plus",
    lienDeSuiviDepuisLibelle("", NUMERO),
    null,
  );
  egal(
    "et un numéro vide ne fabrique jamais d'adresse",
    lienDeSuivi("colissimo", ""),
    null,
  );

  /* --- 6. Le retrait ----------------------------------------------------- */

  section("6. LE RETRAIT — UNE DATE, ET LE FICHIER QUI RESTE");

  const refusRetrait = await proprietaire.request(
    `/admin/bordereaux/${idBordereau}/retirer`,
    { method: "POST" },
  );
  egal(
    "tant qu'une expédition le porte, le retrait est refusé (409)",
    refusRetrait.status,
    409,
  );
  const corpsRefusRetrait = await corpsDe(refusRetrait);
  verifier(
    "et le refus dit quoi faire d'abord",
    String(corpsRefusRetrait.error ?? "").includes("annulez d'abord l'expédition"),
    String(corpsRefusRetrait.error ?? ""),
  );
  egal(
    "la date de retrait n'a pas été posée pour autant",
    (await bordereauEnBase(idBordereau))?.retireAt ?? null,
    null,
  );

  // Ce que fait POST /admin/fulfillments/:id/cancel, sur NOTRE expédition d'essai.
  await db
    .update(schema.fulfillments)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(eq(schema.fulfillments.id, colis.id));

  const retrait = await proprietaire.request(
    `/admin/bordereaux/${idBordereau}/retirer`,
    { method: "POST" },
  );
  const corpsRetrait = await corpsDe(retrait);
  egal("l'expédition annulée, le retrait passe", retrait.status, 200);
  verifier("une date de retrait est posée", Boolean(corpsRetrait.retireAt));

  /*
   * ET L'ÉCRAN DOIT DIRE LA MÊME CHOSE QUE LA ROUTE.
   *
   * La ligne ci-dessus prouve que l'API accepte le retrait dès que
   * l'expédition est annulée. La fiche commande, elle, décide d'afficher le
   * bouton « Retirer » toute seule — et elle s'est déjà trompée : en
   * s'arrêtant à `bordereau.fulfillmentId`, qui n'est JAMAIS remis à null,
   * elle cachait le bouton pour toujours tout en demandant d'annuler
   * l'expédition. Aucune sortie, et plus moyen de joindre une autre
   * étiquette.
   *
   * Ce contrôle-ci est une simple lecture du texte de la page : il ne mesure
   * pas un comportement, il empêche seulement le retour silencieux d'un écran
   * qui contredit la route prouvée juste au-dessus. Le jour où l'expression
   * change, c'est ici qu'on le saura.
   */
  const pageFiche = await readFile(
    resolve(fileURLToPath(import.meta.url), "../../../admin/src/pages/commandes/[id].astro"),
    "utf8",
  );
  verifier(
    "la fiche commande tient compte d'une expédition ANNULÉE pour afficher « Retirer »",
    pageFiche.includes("?.cancelledAt") &&
      !pageFiche.includes("const bordereauServi = !!bordereau?.fulfillmentId;"),
    "apps/admin/src/pages/commandes/[id].astro : bordereauServi",
  );
  egal(
    "le nom du fichier reste sur la ligne",
    corpsRetrait.fichier,
    depot.corps.fichier,
  );
  const apresRetrait = await lire(DOSSIER_BORDEREAUX, String(depot.corps.fichier));
  verifier(
    "LE FICHIER EST TOUJOURS LÀ, entier : « retiré » n'est pas « supprimé »",
    apresRetrait?.length === pdf.length,
    `${apresRetrait?.length ?? "absent"} octets au lieu de ${pdf.length}`,
  );
  egal(
    "le journal le dit, mot pour mot",
    await dernierEvenement(cdeDepot.id),
    "Bordereau Mondial Relay retiré (suivi MR-123 456). Le fichier est conservé.",
  );

  const secondRetrait = await proprietaire.request(
    `/admin/bordereaux/${idBordereau}/retirer`,
    { method: "POST" },
  );
  egal("retirer deux fois ne fâche personne", secondRetrait.status, 200);
  egal(
    "et ne réécrit pas la date : c'est le PREMIER retrait qui a eu lieu",
    String((await corpsDe(secondRetrait)).retireAt),
    String(corpsRetrait.retireAt),
  );

  /* Le remplacement : c'est à ça que sert le retrait. */
  const remplacement = await deposer(proprietaire, cdeDepot.id, {
    contenu: pdf,
    transporteur: "colissimo",
    trackingNumber: "6A11122233344",
    // Sans poids saisi, exprès : on veut voir d'où il vient.
  });
  egal("un nouveau bordereau peut être déposé", remplacement.statut, 200);
  const [reglagePoids] = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, "expedition.poids_defaut_grammes"));
  const poidsDefaut = Number(reglagePoids?.value ?? 0);
  egal(
    `sans poids saisi, c'est celui de la commande (${cdeDepot.weightGrams} g) qui est repris`,
    remplacement.corps.poidsGrammes,
    cdeDepot.weightGrams,
  );
  verifier(
    `et surtout PAS le réglage par défaut (${poidsDefaut} g), que personne n'a déclaré`,
    remplacement.corps.poidsGrammes !== poidsDefaut,
    String(remplacement.corps.poidsGrammes),
  );
  egal(
    "le libellé de Colissimo est celui de la liste maison",
    remplacement.corps.transporteurNom,
    "Colissimo (La Poste)",
  );

  const ancien = await lire(DOSSIER_BORDEREAUX, String(depot.corps.fichier));
  const nouveau = await lire(DOSSIER_BORDEREAUX, String(remplacement.corps.fichier));
  verifier(
    "les DEUX fichiers cohabitent : on retrouve l'étiquette remplacée",
    Boolean(ancien) && Boolean(nouveau) && depot.corps.fichier !== remplacement.corps.fichier,
    `${String(depot.corps.fichier)} / ${String(remplacement.corps.fichier)}`,
  );
  const historique = await proprietaire.request(
    `/admin/orders/${cdeDepot.id}/bordereaux`,
  );
  egal(
    "et la liste garde les deux, le plus récent d'abord",
    ((await historique.json()) as { id: number }[]).map((b) => b.id),
    [Number(remplacement.corps.id), idBordereau],
  );

  /* --- 7. Ce que le module ne peut pas faire ----------------------------- */

  section("7. CE QUE LE MODULE NE PEUT PAS FAIRE, PAR CONSTRUCTION");

  /*
   * Déposer une étiquette ne doit écrire à PERSONNE : c'est « Enregistrer
   * l'expédition » qui prévient la cliente, et un courrier ne se reprend pas.
   * Le prouver par un essai ne dirait rien du jour où quelqu'un ajoutera un
   * envoi ; le prouver sur le TEXTE du module, si — c'est la méthode de
   * verifier-archivage.mjs, et elle ne vieillit pas.
   */
  const source = await readFile(
    resolve(fileURLToPath(import.meta.url), "../../src/bordereaux.ts"),
    "utf8",
  );
  const codeSeul = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  verifier(
    "le module de dépôt ne sait pas écrire à une cliente : rien n'y importe le courrier",
    !/from\s+"\.\/mail\.js"|envoyerCourrier|courrier[A-Z]/.test(codeSeul),
  );
  verifier(
    "et il ne supprime aucune ligne : « retirer » pose une date",
    !/\b(?:db|tx)\.delete\s*\(/.test(codeSeul),
  );
}

/* -------------------------------------------------------------------------- */
/*  Lancement                                                                 */
/* -------------------------------------------------------------------------- */

async function lancer(): Promise<void> {
  let interrompue = false;
  try {
    await main();
  } catch (e) {
    console.error("\n✗ La vérification s'est interrompue :", e);
    interrompue = true;
  } finally {
    // Quoi qu'il arrive — y compris en plein milieu d'un échec : la base de
    // développement repart comme elle était. Ces commandes-là ne sont pas des
    // données de boutique, elles n'ont aucune raison de survivre au script.
    const repris = await reprendreLesEssais(essais);
    console.log(
      `\n${repris.commandes} commande(s) d'essai et ${repris.fichiers} fichier(s) repris : ` +
        "la base et le dossier des bordereaux sont comme avant.",
    );
  }

  if (fautes.length) {
    console.error(
      `\n✗ ${fautes.length} vérification(s) sur ${verifiees} ont échoué :\n`,
    );
    for (const f of fautes) console.error(`  · ${f}`);
    process.exit(1);
  }
  if (interrompue) process.exit(1);

  console.log(
    `\n✓ ${verifiees} vérifications, toutes passées. Le bordereau se dépose, s'ouvre,\n` +
      "  se retire sans rien perdre, et son lien de suivi arrive jusqu'à la cliente.",
  );
  process.exit(0);
}

lancer().catch((e) => {
  console.error("✗ La vérification a échoué :", e);
  process.exit(1);
});
