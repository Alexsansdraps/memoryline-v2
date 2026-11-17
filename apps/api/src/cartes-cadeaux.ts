/**
 * Les cartes cadeaux : de l'argent déjà encaissé, qu'il reste à rendre en affiches.
 *
 * Une carte cadeau n'est PAS un code promo, et tout ce fichier découle de là.
 * Une remise fait baisser un prix le jour de l'achat, et ne coûte rien tant que
 * personne ne s'en sert. Une carte cadeau, elle, a été payée le jour où elle a
 * été vendue : la boutique tient déjà cet argent et doit encore livrer les
 * affiches en face. C'est une dette, pas une réduction.
 *
 * Trois conséquences, et elles gouvernent chaque route de ce fichier.
 *
 * D'abord, le JOURNAL fait foi. `balanceCents` n'est qu'une recopie, tenue pour
 * que la caisse n'ait pas à refaire une addition à chaque passage. On ne
 * l'incrémente donc jamais : chaque écriture ajoute un mouvement, puis RELIT le
 * solde comme la somme du journal. Un « solde = solde + x » perdu en route
 * ferait diverger les deux, et plus personne ne saurait lequel croire.
 *
 * Ensuite, une carte ne se supprime pas. L'effacer effacerait la trace d'une
 * vente encaissée ; le jour où quelqu'un se présente avec sa carte en main, il
 * ne resterait plus rien, ni pour l'honorer, ni pour la refuser. Une carte se
 * DÉSACTIVE, ce qui laisse tout en place.
 *
 * Enfin, un code de carte vaut de l'argent au porteur. Il est tiré par le
 * serveur, jamais choisi. Les routes de gestion vivent sous « /admin/* », que
 * la garde de `index.ts` réserve déjà au propriétaire : les codes y sont en
 * clair, un vendeur de stand n'y accède pas.
 *
 * Depuis le 17/11, la carte se DÉPENSE aussi en ligne, et s'y ACHÈTE. La
 * caisse vérifie un code par une seule route publique (promotions.ts,
 * « /caisse/code »), freinée, qui répond la même phrase pour tout code refusé :
 * elle ne dit jamais si un code existe. La dépense s'écrit au journal au
 * moment où la commande est payée, sous verrou (debiterCarte) : un même euro
 * ne sert jamais deux fois, même à deux commandes simultanées. Une carte
 * achetée naît au paiement de sa commande (emettreCartesDeLaCommande), avec
 * un code de seize signes, et part par e-mail à son destinataire.
 */
import type { Hono } from "hono";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, sql as raw } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PDFFont, PDFPage, RGB } from "pdf-lib";
import {
  FUSEAU_BOUTIQUE,
  codeCarteMasque,
  instantDeParis,
} from "@memoryline/types";
import { db, schema } from "./db/client.js";
import { clientDeLaRequete } from "./comptes.js";
import { courrierCarteCadeau, envoyer as envoyerMail } from "./mail.js";
import { langueDuDestinataire } from "./courriels/index.js";
import { prenomPourCourrier } from "./prenom.js";

/* -------------------------------------------------------------------------- */
/*  Le code d'une carte                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Les signes d'un code, choisis pour être DICTÉS et RETAPÉS.
 *
 * Une carte cadeau se lit au téléphone, se recopie depuis un papier imprimé,
 * parfois d'une écriture à la main. Deux familles de pièges ont été retirées.
 *
 * Celles qui se confondent à l'œil, entre elles ou avec un chiffre : I et 1,
 * O et 0, B et 8, G et 6, S et 5, Z et 2, Q et 9.
 *
 * Celles qui se confondent à l'oreille en français, parce qu'elles riment :
 * B, D, G, P, T et V se disent toutes « -é », M et N se répondent. On garde C,
 * qui se dit « sé » mais n'a plus de S en face, et on écarte les autres.
 *
 * Restent vingt et un signes. Seize tirages en font 21^16, soit des millions
 * de milliards de milliards de codes possibles : tomber sur celui d'un autre
 * client n'est pas une hypothèse à considérer. Les cartes d'avant le 17/11 en
 * ont douze ; elles restent valables, et la saisie accepte les deux formes
 * (cleDeCarte, @memoryline/types).
 */
const ALPHABET = "ACEFHJKLRUWXY23456789";

/**
 * Seize signes, présentés en quatre groupes de quatre séparés par des tirets :
 * « V7X9-KQ4M-Z8WP-3N6R ».
 */
const LONGUEUR_CODE = 16;

/**
 * Plafond d'une carte : mille euros.
 *
 * Ce n'est pas la base qui le demande, c'est la frappe. Le montant se saisit à
 * la main, et un zéro de trop transforme 100 € en 1 000 €, deux zéros en
 * 10 000 €. Le premier passe encore pour un très gros cadeau, le second
 * n'existe pas dans cette boutique : mieux vaut refuser en disant pourquoi que
 * d'inscrire au passif une dette que personne n'a voulue.
 */
const MONTANT_MAX_CENTS = 100_000;

/** Au-delà, ce n'est plus une note de gestion, c'est un courrier. */
const NOTE_MAX = 500;

/** Au-delà, le libellé d'un mouvement ne tient plus sur une ligne à l'écran. */
const LIBELLE_MAX = 140;

/** Les deux seuls états d'une carte. Il n'y a pas de troisième : effacée. */
const ETATS = ["active", "disabled"] as const;
type EtatCarte = (typeof ETATS)[number];

/**
 * Une saisie refusée, avec la phrase à montrer à la propriétaire.
 *
 * Elle traverse la transaction pour la faire retomber d'un bloc : c'est le seul
 * moyen d'abandonner une écriture commencée sans laisser la moitié du travail
 * en base.
 */
class SaisieRefusee extends Error {}

/** Tire un code neuf, présenté en groupes de quatre. */
export function nouveauCode(): string {
  let brut = "";
  for (let i = 0; i < LONGUEUR_CODE; i++)
    brut += ALPHABET[randomInt(ALPHABET.length)];
  return (brut.match(/.{1,4}/g) ?? [brut]).join("-");
}

/* -------------------------------------------------------------------------- */
/*  Lecture des saisies                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Un identifiant, ou null quand ce n'en est pas un.
 *
 * `Number()` accepte beaucoup trop : `true` désignerait la carte 1 et « 3,7 »
 * une carte à virgule qui n'existe pas. Une adresse mal formée doit être
 * refusée, pas viser une carte au hasard.
 */
function identifiant(v: unknown): number | null {
  if (typeof v !== "number" && typeof v !== "string") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Un montant en centimes, tel qu'il sort d'un formulaire.
 *
 * `Math.round(Number(""))` vaut ZÉRO, et c'est le piège de tout ce fichier :
 * une case laissée vide donnerait une carte à zéro euro, remise à un client qui
 * vient pourtant de payer. Le vide est donc refusé aussi fermement qu'une
 * saisie illisible, et on dit lequel des deux c'est.
 */
function centimes(v: unknown, quoi: string): number {
  if (v === null || v === undefined)
    throw new SaisieRefusee(`${quoi} doit être renseigné.`);
  if (typeof v !== "number" && typeof v !== "string")
    throw new SaisieRefusee(`${quoi} doit être un montant.`);
  const brut = typeof v === "string" ? v.trim() : v;
  if (brut === "") throw new SaisieRefusee(`${quoi} doit être renseigné.`);
  const n = Number(brut);
  if (!Number.isFinite(n))
    throw new SaisieRefusee(`${quoi} doit être un montant, en centimes.`);
  return Math.round(n);
}

/** Texte libre borné ; une case vidée vaut null, jamais chaîne vide. */
function texteOuNull(v: unknown, max: number): string | null {
  return (
    String(v ?? "")
      .trim()
      .slice(0, max) || null
  );
}

/**
 * Une date de fin, poussée au SOIR du jour choisi.
 *
 * « Valable jusqu'au 31 décembre » veut dire que le 31 décembre compte encore.
 * Prise à minuit, la date retirerait à la carte sa dernière journée, et le
 * client se verrait refuser la sienne le jour même où on lui avait dit qu'elle
 * marchait.
 *
 * Trois réponses possibles, et il faut vraiment les trois : une date, une case
 * vide (« sans date de fin », qui est une réponse en soi), et une saisie qui
 * n'a pas de sens.
 */
function dateDeFin(v: unknown): { valeur: Date | null } | null {
  if (v === null || v === undefined || v === "") return { valeur: null };
  if (typeof v !== "string") return null;
  const propre = v.trim();
  if (!propre) return { valeur: null };
  // Un jour seul (« 2027-12-31 ») vaut jusqu'au soir de ce jour À PARIS
  // (instantDeParis), quel que soit le fuseau de la machine. Le lire comme un
  // instant universel le ferait basculer d'un jour, et la carte perdrait sa
  // dernière journée sans que personne ne comprenne pourquoi.
  if (/^\d{4}-\d{2}-\d{2}$/.test(propre)) {
    // « 2027-02-31 » se lit sans broncher en JavaScript et donne le 3 mars.
    // Une date que le calendrier ne contient pas est refusée (null) plutôt
    // que remplacée en silence par une autre, que la propriétaire n'a pas
    // choisie.
    const quand = instantDeParis(`${propre}T23:59:59.999`);
    return quand ? { valeur: quand } : null;
  }

  const quand = new Date(propre);
  if (Number.isNaN(quand.getTime())) return null;
  return { valeur: quand };
}

/** Le type de transaction rendu par Drizzle, sans avoir à le nommer en entier. */
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Le solde d'une carte, RELU comme la somme de son journal.
 *
 * C'est la seule façon dont un solde s'obtient dans ce fichier. L'écrire
 * ailleurs — même juste « + le montant qu'on vient d'ajouter » — laisserait la
 * porte ouverte à un compteur qui ne correspond plus à ses écritures.
 */
async function soldeDuJournal(tx: Transaction, carteId: number): Promise<number> {
  const [somme] = await tx
    .select({
      total: raw<string | null>`coalesce(sum(${schema.giftCardTransactions.amountCents}), 0)`,
    })
    .from(schema.giftCardTransactions)
    .where(eq(schema.giftCardTransactions.giftCardId, carteId));
  return Number(somme?.total ?? 0);
}

/** Recopie sur la carte le solde relu de son journal (voir l'en-tête). */
async function recopierSolde(tx: Transaction, carteId: number): Promise<number> {
  const solde = await soldeDuJournal(tx, carteId);
  await tx
    .update(schema.giftCards)
    .set({ balanceCents: solde })
    .where(eq(schema.giftCards.id, carteId));
  return solde;
}

/* -------------------------------------------------------------------------- */
/*  La carte à la caisse : dépense, remboursement, vente en ligne              */
/* -------------------------------------------------------------------------- */

/** Là où passent les requêtes : la base, ou la transaction en cours. */
type Executeur = typeof db | Transaction;

/** Une carte retrouvée par la CLÉ de son code (cleDeCarte : sans tirets). */
export async function carteParCle(
  ex: Executeur,
  cle: string,
): Promise<typeof schema.giftCards.$inferSelect | null> {
  const [carte] = await ex
    .select()
    .from(schema.giftCards)
    .where(raw`replace(${schema.giftCards.code}, '-', '') = ${cle}`);
  return carte ?? null;
}

/**
 * La carte peut-elle payer à cet instant ? Active, pas échue, un solde.
 *
 * Lu sur la recopie du solde : c'est ce que montre la caisse. Le débit, lui,
 * relit le journal sous verrou (verifierCarteSousVerrou).
 */
export function carteUtilisable(
  carte: { status: string; expiresAt: Date | null; balanceCents: number },
  quand: Date = new Date(),
): boolean {
  return (
    carte.status === "active" &&
    (!carte.expiresAt || carte.expiresAt >= quand) &&
    carte.balanceCents > 0
  );
}

/** Pourquoi une carte ne peut pas payer ce qu'on lui demande. */
export type RefusCarte = "introuvable" | "desactivee" | "echue" | "solde";

/**
 * Vérifie qu'une carte peut payer `montantCents`, en la VERROUILLANT jusqu'à
 * la fin de la transaction.
 *
 * C'est ce verrou qui empêche la double dépense : deux commandes payées au
 * même instant avec la même carte passent l'une après l'autre, et la seconde
 * relit le solde que la première vient de laisser. Le débit (debiterCarte)
 * doit suivre dans la MÊME transaction.
 *
 * `quand` : l'heure à laquelle juger la date de fin — celle du passage en
 * caisse, comme pour les promotions. Une carte valable jusqu'à minuit ne doit
 * pas faire refuser un paiement ouvert à 23 h 58.
 */
export async function verifierCarteSousVerrou(
  tx: Transaction,
  carteId: number,
  montantCents: number,
  quand: Date,
): Promise<
  | { ok: true; carte: typeof schema.giftCards.$inferSelect; soldeCents: number }
  | { ok: false; raison: RefusCarte; soldeCents: number; code: string | null }
> {
  const [carte] = await tx
    .select()
    .from(schema.giftCards)
    .where(eq(schema.giftCards.id, carteId))
    .for("update");
  if (!carte) return { ok: false, raison: "introuvable", soldeCents: 0, code: null };
  const solde = await soldeDuJournal(tx, carteId);
  if (carte.status !== "active")
    return { ok: false, raison: "desactivee", soldeCents: solde, code: carte.code };
  if (carte.expiresAt && carte.expiresAt < quand)
    return { ok: false, raison: "echue", soldeCents: solde, code: carte.code };
  if (solde < montantCents)
    return { ok: false, raison: "solde", soldeCents: solde, code: carte.code };
  return { ok: true, carte, soldeCents: solde };
}

/**
 * Débite la carte pour une commande : un mouvement NÉGATIF au journal, puis le
 * solde relu. À appeler après verifierCarteSousVerrou, dans la même
 * transaction : c'est elle qui tient le verrou et a vérifié le solde.
 */
export async function debiterCarte(
  tx: Transaction,
  carteId: number,
  montantCents: number,
  commande: { id: number; number: string },
): Promise<number> {
  await tx.insert(schema.giftCardTransactions).values({
    giftCardId: carteId,
    orderId: commande.id,
    amountCents: -montantCents,
    label: `Commande ${commande.number}`,
  });
  return recopierSolde(tx, carteId);
}

/**
 * Ce que la carte a payé pour cette commande et ne lui a pas encore été rendu :
 * ses mouvements pour la commande, débits moins recrédits.
 */
async function rendableALaCarte(
  ex: Executeur,
  carteId: number,
  orderId: number,
): Promise<number> {
  const [somme] = await ex
    .select({
      total: raw<string | null>`coalesce(sum(${schema.giftCardTransactions.amountCents}), 0)`,
    })
    .from(schema.giftCardTransactions)
    .where(
      and(
        eq(schema.giftCardTransactions.giftCardId, carteId),
        eq(schema.giftCardTransactions.orderId, orderId),
      ),
    );
  return Math.max(0, -Number(somme?.total ?? 0));
}

/** Ce qui reste à rendre à la carte qui a payé cette commande (hors transaction). */
export async function resteARendreALaCarte(
  carteId: number | null,
  orderId: number,
): Promise<number> {
  if (!carteId) return 0;
  return rendableALaCarte(db, carteId, orderId);
}

/**
 * Rend à la carte ce qu'elle a payé pour une commande — un remboursement, une
 * annulation —, au plus `plafondCents` (null : tout ce qui reste). Rend le
 * montant recrédité.
 *
 * Jamais plus que ce que la carte a payé pour CETTE commande : rejouer un
 * remboursement, ou annuler une commande déjà remboursée, ne recrédite rien
 * deux fois. Une carte désactivée entre-temps est recréditée quand même : le
 * journal dit ce qui lui revient, la propriétaire décide du reste.
 */
export async function recrediterCarte(
  tx: Transaction,
  carteId: number,
  commande: { id: number; number: string },
  plafondCents: number | null,
  libelle: string,
): Promise<number> {
  const [carte] = await tx
    .select({ id: schema.giftCards.id })
    .from(schema.giftCards)
    .where(eq(schema.giftCards.id, carteId))
    .for("update");
  if (!carte) return 0;
  const rendable = await rendableALaCarte(tx, carteId, commande.id);
  const montant = Math.max(
    0,
    plafondCents === null ? rendable : Math.min(rendable, Math.max(0, plafondCents)),
  );
  if (montant <= 0) return 0;
  await tx.insert(schema.giftCardTransactions).values({
    giftCardId: carteId,
    orderId: commande.id,
    amountCents: montant,
    label: libelle.slice(0, LIBELLE_MAX),
  });
  await recopierSolde(tx, carteId);
  return montant;
}

/** Une carte qui vient de naître du paiement d'une commande. */
export interface CarteEmise {
  id: number;
  code: string;
  montantCents: number;
}

/**
 * Crée les cartes cadeaux qu'une commande vient d'ACHETER : une par ligne
 * « carte cadeau », avec un code neuf et son écriture d'ouverture au journal.
 *
 * Appelée par markOrderPaid, dans la transaction qui marque la commande payée :
 * une carte n'existe que si son achat a été encaissé, et l'inverse. L'index
 * unique sur `order_item_id` garantit qu'un paiement confirmé deux fois
 * (webhook et navigateur) ne fait jamais deux cartes.
 *
 * Le montant est celui de la ligne, que le serveur a vérifié à l'ajout au
 * panier et revérifie au paiement (valeurDesLignes) : jamais un chiffre du
 * navigateur.
 */
export async function emettreCartesDeLaCommande(
  tx: Transaction,
  commande: { id: number; number: string; customerId: number | null },
): Promise<CarteEmise[]> {
  const lignes = await tx
    .select()
    .from(schema.orderItems)
    .where(
      and(
        eq(schema.orderItems.orderId, commande.id),
        isNotNull(schema.orderItems.giftCard),
      ),
    )
    .orderBy(asc(schema.orderItems.id));
  if (!lignes.length) return [];

  const [client] = commande.customerId
    ? await tx
        .select({ email: schema.customers.email })
        .from(schema.customers)
        .where(eq(schema.customers.id, commande.customerId))
    : [];

  const emises: CarteEmise[] = [];
  for (const ligne of lignes) {
    const [deja] = await tx
      .select({ id: schema.giftCards.id })
      .from(schema.giftCards)
      .where(eq(schema.giftCards.orderItemId, ligne.id));
    if (deja) continue;
    const g = ligne.giftCard!;
    // Une ligne porte une carte : sa quantité est tenue à 1 par le serveur.
    // Si elle valait plus, la carte vaut ce qui a été payé, ni plus ni moins.
    const montant = ligne.unitPriceCents * Math.max(1, ligne.quantity);
    if (montant <= 0) continue;

    let code = "";
    for (let essai = 0; essai < 8 && !code; essai++) {
      const candidat = nouveauCode();
      const [pris] = await tx
        .select({ id: schema.giftCards.id })
        .from(schema.giftCards)
        .where(raw`replace(${schema.giftCards.code}, '-', '') = ${candidat.replace(/-/g, "")}`);
      if (!pris) code = candidat;
    }
    if (!code) throw new Error("Aucun code de carte cadeau libre après huit tirages.");

    const [carte] = await tx
      .insert(schema.giftCards)
      .values({
        code,
        initialAmountCents: montant,
        balanceCents: montant,
        status: "active",
        expiresAt: null,
        customerId: commande.customerId,
        note: `Vendue en ligne, commande ${commande.number}`,
        orderId: commande.id,
        orderItemId: ligne.id,
        recipientEmail: (g.destinataireEmail || client?.email || "").trim().toLowerCase() || null,
        recipientName: g.destinatairePrenom?.trim() || null,
        message: g.message?.trim() || null,
      })
      .returning();
    if (!carte) continue;
    await tx.insert(schema.giftCardTransactions).values({
      giftCardId: carte.id,
      orderId: commande.id,
      amountCents: montant,
      label: `Achat de la carte (commande ${commande.number})`,
    });
    await recopierSolde(tx, carte.id);
    emises.push({ id: carte.id, code, montantCents: montant });
  }
  return emises;
}

/**
 * Envoie au destinataire chaque carte de la commande qui n'est pas encore
 * partie. Après la transaction du paiement : une commande payée le reste
 * même si un courriel échoue. Ne lève jamais ; le journal de la commande dit
 * ce qui est parti, et ce qui reste à renvoyer à la main.
 */
export async function envoyerCartesDeLaCommande(orderId: number): Promise<void> {
  try {
    const cartes = await db
      .select()
      .from(schema.giftCards)
      .where(and(eq(schema.giftCards.orderId, orderId), isNull(schema.giftCards.sentAt)));
    if (!cartes.length) return;
    const [commande] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId));
    if (!commande) return;
    const [acheteuse] = commande.customerId
      ? await db
          .select()
          .from(schema.customers)
          .where(eq(schema.customers.id, commande.customerId))
      : [];
    // La langue de la COMMANDE : celle dans laquelle l'acheteuse a écrit
    // son petit mot.
    const langue = langueDuDestinataire({ commande: commande.langue, compte: acheteuse?.langue });
    for (const carte of cartes) {
      if (carte.orderItemId == null) continue;
      const destinataire = carte.recipientEmail || acheteuse?.email || null;
      if (!destinataire) continue;
      const courrier = courrierCarteCadeau({
        langue,
        prenomDestinataire: carte.recipientName,
        deLaPart: acheteuse ? prenomPourCourrier(acheteuse) || null : null,
        montantCents: carte.initialAmountCents,
        code: carte.code,
        message: carte.message,
      });
      const parti = await envoyerMail({ ...courrier, to: destinataire });
      if (parti)
        await db
          .update(schema.giftCards)
          .set({ sentAt: new Date() })
          .where(eq(schema.giftCards.id, carte.id));
      await db.insert(schema.orderEvents).values({
        orderId,
        kind: "event",
        message: parti
          ? `Carte cadeau ${codeCarteMasque(carte.code)} de ${montantEnToutesLettres(carte.initialAmountCents)} envoyée par e-mail à ${destinataire}.`
          : `Carte cadeau ${codeCarteMasque(carte.code)} NON envoyée à ${destinataire} (envoi d'e-mails non configuré ou en échec) : renvoyez le code à la main, depuis BO › Cartes cadeaux.`,
      });
    }
  } catch (e) {
    console.error("[carte cadeau] envoi impossible", e);
  }
}

/**
 * Met hors service les cartes qu'une commande a ACHETÉES — sa vente est
 * annulée ou remboursée. `lignes` : celles des lignes concernées, ou null pour
 * toutes.
 *
 * Rend ce qu'il faut en dire au journal de la commande, en particulier les
 * cartes déjà dépensées en partie : l'argent rendu à l'acheteuse a peut-être
 * déjà servi.
 */
export async function desactiverCartesVendues(
  orderId: number,
  lignes: number[] | null,
  raison: string,
): Promise<string | null> {
  const cartes = await db
    .select()
    .from(schema.giftCards)
    .where(
      and(
        eq(schema.giftCards.orderId, orderId),
        isNotNull(schema.giftCards.orderItemId),
        lignes ? inArray(schema.giftCards.orderItemId, lignes.length ? lignes : [-1]) : undefined,
      ),
    );
  const aCouper = cartes.filter((c) => c.status === "active");
  if (!aCouper.length) return null;
  await db
    .update(schema.giftCards)
    .set({ status: "disabled", disabledAt: new Date() })
    .where(inArray(schema.giftCards.id, aCouper.map((c) => c.id)));
  const entamees = aCouper.filter((c) => c.balanceCents < c.initialAmountCents);
  return (
    `${aCouper.length > 1 ? "Cartes cadeaux mises" : "Carte cadeau mise"} hors service (${raison}) : ` +
    aCouper.map((c) => codeCarteMasque(c.code)).join(", ") +
    "." +
    (entamees.length
      ? ` ATTENTION : ${entamees.map((c) => `${codeCarteMasque(c.code)} (reste ${montantEnToutesLettres(c.balanceCents)} sur ${montantEnToutesLettres(c.initialAmountCents)})`).join(", ")} avai${entamees.length > 1 ? "ent" : "t"} déjà servi.`
      : "")
  );
}

/* -------------------------------------------------------------------------- */
/*  La carte imprimable                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Format retenu : A5 en PAYSAGE, 210 × 148 mm.
 *
 * L'A6 aurait fait une carte de la taille d'une carte postale, mais cette carte
 * sort d'une imprimante de bureau, qui ne connaît que l'A4. Or l'A5 est
 * exactement la moitié d'une feuille A4 : imprimée à taille réelle, la carte se
 * détache d'un seul coup de ciseaux au milieu de la feuille, sans rien à
 * mesurer. Un A6 aurait demandé quatre coupes à l'œil, ou un cadrage que la
 * boîte de dialogue d'impression décide toute seule.
 *
 * L'A5 laisse en plus de la place au code : les imprimantes de bureau ne savent
 * pas imprimer jusqu'au bord, et sur un A6 un code assez gros pour être lu
 * serait passé sous la lame.
 */
const LARGEUR_PT = 595.28;
const HAUTEUR_PT = 419.53;

/** Marge du filet extérieur : 10 mm, soit le trait de coupe et le cadre à la fois. */
const MARGE_PT = 28.35;

/** Le dossier de marque de l'API : apps/api/marque/. */
const DOSSIER_MARQUE = resolve(fileURLToPath(import.meta.url), "../../marque");

/**
 * Tout en gris et noir, sans exception.
 *
 * Cette carte sort d'une imprimante de bureau, souvent en noir et blanc. Une
 * couleur d'accent y deviendrait un gris sale et imprévisible ; autant choisir
 * les gris nous-mêmes.
 */
const ENCRE = rgb(0.09, 0.09, 0.09);
const ENCRE_PALE = rgb(0.42, 0.42, 0.42);
const FILET = rgb(0.72, 0.72, 0.72);

/** Le montant tel qu'il se lit sur la carte : « 50 € », « 49,50 € ». */
function montantEnToutesLettres(cents: number): string {
  const euros = cents / 100;
  const texte =
    cents % 100 === 0 ? String(euros) : euros.toFixed(2).replace(".", ",");
  return `${texte} €`;
}

/** « 31 décembre 2027 ». */
function jourEnFrancais(quand: Date): string {
  // À Paris : la fin de validité est le 31 à 23 h 59 de Paris, qui serait
  // déjà le 1er dans un fuseau à l'est.
  return quand.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: FUSEAU_BOUTIQUE,
  });
}

/** Largeur d'un texte dont on aura écarté les lettres. */
function largeurEspacee(
  police: PDFFont,
  texte: string,
  taille: number,
  ecart: number,
): number {
  const brute = police.widthOfTextAtSize(texte, taille);
  return brute + Math.max(0, texte.length - 1) * ecart;
}

/**
 * Écrit un texte lettre par lettre pour pouvoir les écarter.
 *
 * pdf-lib ne sait pas espacer les caractères d'un `drawText`. Or un code se lit
 * signe par signe, pas comme un mot : serré, l'œil regroupe « RU » en « W » et
 * la personne retape autre chose que ce qui est imprimé.
 */
function ecrireEspace(
  page: PDFPage,
  texte: string,
  options: {
    police: PDFFont;
    taille: number;
    x: number;
    y: number;
    ecart: number;
    couleur: RGB;
  },
): void {
  let x = options.x;
  for (const signe of texte) {
    page.drawText(signe, {
      x,
      y: options.y,
      size: options.taille,
      font: options.police,
      color: options.couleur,
    });
    x += options.police.widthOfTextAtSize(signe, options.taille) + options.ecart;
  }
}

/** Le PDF d'une carte cadeau, prêt à imprimer et à offrir. */
async function rendreCartePdf(carte: {
  code: string;
  montantCents: number;
  expiresAt: Date | null;
}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Carte cadeau Memory Line ${carte.code}`);
  const page = doc.addPage([LARGEUR_PT, HAUTEUR_PT]);
  const gras = await doc.embedFont(StandardFonts.HelveticaBold);
  const normale = await doc.embedFont(StandardFonts.Helvetica);

  /** Abscisse pour centrer une largeur dans la page. */
  const centre = (largeur: number) => (LARGEUR_PT - largeur) / 2;

  // Le filet extérieur sert deux fois : il encadre la carte, et il dit où
  // couper la feuille A4 sur laquelle elle sera imprimée.
  page.drawRectangle({
    x: MARGE_PT,
    y: MARGE_PT,
    width: LARGEUR_PT - 2 * MARGE_PT,
    height: HAUTEUR_PT - 2 * MARGE_PT,
    borderColor: FILET,
    borderWidth: 0.8,
  });

  // Le logo, quand il est là. S'il manque, le nom de la boutique le remplace :
  // une carte sans logo reste utilisable, une erreur 500 ne l'est pas.
  const HAUTEUR_LOGO = 48;
  let basDuLogo = HAUTEUR_PT - MARGE_PT - 26 - HAUTEUR_LOGO;
  try {
    const octets = await readFile(resolve(DOSSIER_MARQUE, "logo-memory-line.png"));
    const logo = await doc.embedPng(octets);
    const largeur = (logo.width / logo.height) * HAUTEUR_LOGO;
    page.drawImage(logo, {
      x: centre(largeur),
      y: basDuLogo,
      width: largeur,
      height: HAUTEUR_LOGO,
    });
  } catch {
    const taille = 22;
    const largeur = largeurEspacee(gras, "MEMORY LINE", taille, 2.5);
    basDuLogo += 12;
    ecrireEspace(page, "MEMORY LINE", {
      police: gras,
      taille,
      x: centre(largeur),
      y: basDuLogo,
      ecart: 2.5,
      couleur: ENCRE,
    });
  }

  const TITRE = "CARTE CADEAU";
  const ECART_TITRE = 4;
  ecrireEspace(page, TITRE, {
    police: normale,
    taille: 11,
    x: centre(largeurEspacee(normale, TITRE, 11, ECART_TITRE)),
    y: 292,
    ecart: ECART_TITRE,
    couleur: ENCRE_PALE,
  });

  const montant = montantEnToutesLettres(carte.montantCents);
  const TAILLE_MONTANT = 52;
  page.drawText(montant, {
    x: centre(gras.widthOfTextAtSize(montant, TAILLE_MONTANT)),
    y: 232,
    size: TAILLE_MONTANT,
    font: gras,
    color: ENCRE,
  });

  // Le code prend la plus grande taille qui tienne dans la page. Un code plus
  // long qu'à l'ordinaire rétrécit donc au lieu de déborder dans la marge.
  const LARGEUR_UTILE = LARGEUR_PT - 2 * 74;
  let tailleCode = 34;
  let largeurCode = largeurEspacee(gras, carte.code, tailleCode, tailleCode * 0.14);
  while (largeurCode > LARGEUR_UTILE && tailleCode > 14) {
    tailleCode -= 1;
    largeurCode = largeurEspacee(gras, carte.code, tailleCode, tailleCode * 0.14);
  }

  const HAUTEUR_CADRE = 60;
  const BAS_DU_CADRE = 136;
  page.drawRectangle({
    x: centre(largeurCode + 52),
    y: BAS_DU_CADRE,
    width: largeurCode + 52,
    height: HAUTEUR_CADRE,
    borderColor: ENCRE,
    borderWidth: 1.1,
  });
  // Centrage optique : la hauteur de capitale d'Helvetica vaut environ 0,72 fois
  // le corps, et c'est elle qu'on centre, pas le corps entier.
  const hauteurCapitale = tailleCode * 0.72;
  ecrireEspace(page, carte.code, {
    police: gras,
    taille: tailleCode,
    x: centre(largeurCode),
    y: BAS_DU_CADRE + (HAUTEUR_CADRE - hauteurCapitale) / 2,
    ecart: tailleCode * 0.14,
    couleur: ENCRE,
  });

  const validite = carte.expiresAt
    ? `À utiliser avant le ${jourEnFrancais(carte.expiresAt)}`
    : "Sans date de fin";
  // La date de fin est écrite de la même encre que le mode d'emploi : c'est
  // une contrainte, pas une mention en bas de page. En gris pâle, c'est
  // précisément la ligne qu'on ne lit pas avant de se voir refuser sa carte.
  page.drawText(validite, {
    x: centre(normale.widthOfTextAtSize(validite, 10.5)),
    y: 108,
    size: 10.5,
    font: normale,
    color: ENCRE,
  });

  const MODE_D_EMPLOI =
    "Indiquez ce code au moment de payer votre commande sur memoryline.fr";
  page.drawText(MODE_D_EMPLOI, {
    x: centre(normale.widthOfTextAtSize(MODE_D_EMPLOI, 10)),
    y: 76,
    size: 10,
    font: normale,
    color: ENCRE,
  });

  const RAPPEL = "Utilisable en une ou plusieurs fois, jusqu'à épuisement du montant.";
  page.drawText(RAPPEL, {
    x: centre(normale.widthOfTextAtSize(RAPPEL, 8.5)),
    y: 60,
    size: 8.5,
    font: normale,
    color: ENCRE_PALE,
  });

  return Buffer.from(await doc.save());
}

/**
 * « carte-cadeau-50-euros-ACEF-HJKL-R234.pdf ».
 *
 * Le nom porte le montant ET le code : la propriétaire imprimera plusieurs
 * cartes de suite, et « document(3).pdf » ne dit pas laquelle mettre dans
 * quelle enveloppe.
 */
function nomFichierCarte(montantCents: number, code: string): string {
  const euros = Math.floor(montantCents / 100);
  const centimesRestants = montantCents % 100;
  const somme =
    centimesRestants === 0
      ? String(euros)
      : `${euros}-${String(centimesRestants).padStart(2, "0")}`;
  return `carte-cadeau-${somme}-euros-${code}.pdf`;
}

/* -------------------------------------------------------------------------- */
/*  Ce que le back-office reçoit                                              */
/* -------------------------------------------------------------------------- */

/** Une carte telle que la liste du back-office la montre. */
interface CarteRendue {
  id: number;
  code: string;
  initialAmountCents: number;
  balanceCents: number;
  status: string;
  expiresAt: string | null;
  customerId: number | null;
  clientNom: string | null;
  clientEmail: string | null;
  note: string | null;
  createdAt: string;
  disabledAt: string | null;
  /** Nombre de fois où la carte a payé quelque chose. */
  utilisations: number;
  /** Vendue en ligne : la commande qui l'a achetée. Null = vendue au back-office. */
  orderId: number | null;
  numeroCommande: string | null;
  /** À qui elle a été envoyée, quand elle a été vendue en ligne. */
  recipientEmail: string | null;
  recipientName: string | null;
  sentAt: string | null;
}

/* -------------------------------------------------------------------------- */
/*  Routes                                                                    */
/* -------------------------------------------------------------------------- */

export function mountCartesCadeaux(app: Hono): void {
  /**
   * Toutes les cartes, et ce que la boutique doit encore.
   *
   * Le total ne compte que les cartes encore échangeables : une carte
   * désactivée, ou dont la date de fin est passée, ne sera plus rendue en
   * affiches et a cessé d'être une dette. Les compter gonflerait un chiffre que
   * la propriétaire lit comme « ce qu'il me reste à livrer ».
   *
   * Les codes sont EN CLAIR ici. C'est voulu — sans le code, la liste ne sert à
   * rien quand un client appelle — et c'est sans risque : la garde de
   * « /admin/* », dans index.ts, n'ouvre cette route qu'au propriétaire.
   */
  app.get("/admin/gift-cards", async (c) => {
    const lignes = await db
      .select({
        carte: schema.giftCards,
        clientNom: schema.customers.name,
        clientEmail: schema.customers.email,
        numeroCommande: schema.orders.number,
      })
      .from(schema.giftCards)
      .leftJoin(
        schema.customers,
        eq(schema.giftCards.customerId, schema.customers.id),
      )
      // Vendue en ligne : la commande qui l'a achetée (« WEB-0042 »).
      .leftJoin(schema.orders, eq(schema.giftCards.orderId, schema.orders.id))
      .orderBy(desc(schema.giftCards.createdAt), desc(schema.giftCards.id));

    // Les utilisations comptées d'un coup : une requête par carte serait une
    // requête de trop dès la dizaine de cartes vendues. Seuls les mouvements
    // NÉGATIFS comptent — l'achat et les recharges ne sont pas des usages.
    const usages = await db
      .select({ giftCardId: schema.giftCardTransactions.giftCardId, n: count() })
      .from(schema.giftCardTransactions)
      .where(raw`${schema.giftCardTransactions.amountCents} < 0`)
      .groupBy(schema.giftCardTransactions.giftCardId);
    const parCarte = new Map(usages.map((u) => [u.giftCardId, Number(u.n)]));

    const maintenant = new Date();
    let totalEnCirculationCents = 0;
    let cartesEnCirculation = 0;

    const cartes: CarteRendue[] = lignes.map(({ carte, clientNom, clientEmail, numeroCommande }) => {
      const perimee = carte.expiresAt !== null && carte.expiresAt < maintenant;
      if (carte.status === "active" && !perimee && carte.balanceCents > 0) {
        totalEnCirculationCents += carte.balanceCents;
        cartesEnCirculation++;
      }
      return {
        id: carte.id,
        code: carte.code,
        initialAmountCents: carte.initialAmountCents,
        balanceCents: carte.balanceCents,
        status: carte.status,
        expiresAt: carte.expiresAt ? carte.expiresAt.toISOString() : null,
        customerId: carte.customerId,
        clientNom: clientNom ?? null,
        clientEmail: clientEmail ?? null,
        note: carte.note,
        createdAt: carte.createdAt.toISOString(),
        disabledAt: carte.disabledAt ? carte.disabledAt.toISOString() : null,
        utilisations: parCarte.get(carte.id) ?? 0,
        orderId: carte.orderId,
        numeroCommande: numeroCommande ?? null,
        recipientEmail: carte.recipientEmail,
        recipientName: carte.recipientName,
        sentAt: carte.sentAt ? carte.sentAt.toISOString() : null,
      };
    });

    return c.json({ cartes, totalEnCirculationCents, cartesEnCirculation });
  });

  /**
   * Une carte, tout son journal, et la personne à qui elle a été remise.
   *
   * Les mouvements sont rendus du plus ancien au plus récent : un journal se lit
   * dans le sens où il s'est écrit, l'achat de la carte en premier.
   */
  app.get("/admin/gift-cards/:id", async (c) => {
    const id = identifiant(c.req.param("id"));
    if (id === null) return c.notFound();

    const [ligne] = await db
      .select({
        carte: schema.giftCards,
        clientNom: schema.customers.name,
        clientEmail: schema.customers.email,
      })
      .from(schema.giftCards)
      .leftJoin(
        schema.customers,
        eq(schema.giftCards.customerId, schema.customers.id),
      )
      .where(eq(schema.giftCards.id, id));
    if (!ligne) return c.notFound();

    const mouvements = await db
      .select({
        id: schema.giftCardTransactions.id,
        amountCents: schema.giftCardTransactions.amountCents,
        label: schema.giftCardTransactions.label,
        orderId: schema.giftCardTransactions.orderId,
        numeroCommande: schema.orders.number,
        createdAt: schema.giftCardTransactions.createdAt,
      })
      .from(schema.giftCardTransactions)
      .leftJoin(
        schema.orders,
        eq(schema.giftCardTransactions.orderId, schema.orders.id),
      )
      .where(eq(schema.giftCardTransactions.giftCardId, id))
      .orderBy(
        asc(schema.giftCardTransactions.createdAt),
        asc(schema.giftCardTransactions.id),
      );

    const { carte } = ligne;
    const [vente] = carte.orderId
      ? await db
          .select({ number: schema.orders.number })
          .from(schema.orders)
          .where(eq(schema.orders.id, carte.orderId))
      : [];
    return c.json({
      carte: {
        id: carte.id,
        code: carte.code,
        initialAmountCents: carte.initialAmountCents,
        balanceCents: carte.balanceCents,
        status: carte.status,
        expiresAt: carte.expiresAt ? carte.expiresAt.toISOString() : null,
        customerId: carte.customerId,
        note: carte.note,
        createdAt: carte.createdAt.toISOString(),
        disabledAt: carte.disabledAt ? carte.disabledAt.toISOString() : null,
        orderId: carte.orderId,
        numeroCommande: vente?.number ?? null,
        recipientEmail: carte.recipientEmail,
        recipientName: carte.recipientName,
        message: carte.message,
        sentAt: carte.sentAt ? carte.sentAt.toISOString() : null,
      },
      mouvements: mouvements.map((m) => ({
        id: m.id,
        amountCents: m.amountCents,
        label: m.label,
        orderId: m.orderId,
        numeroCommande: m.numeroCommande ?? null,
        createdAt: m.createdAt.toISOString(),
      })),
      client: carte.customerId
        ? {
            id: carte.customerId,
            nom: ligne.clientNom ?? null,
            email: ligne.clientEmail ?? null,
          }
        : null,
    });
  });

  /**
   * Vend une carte : un code neuf, et l'écriture d'ouverture au journal.
   *
   * Le code est TIRÉ ICI, jamais reçu du formulaire. Le laisser choisir ouvrirait
   * deux portes d'un coup : des codes devinables (« NOEL2026 »), et la
   * possibilité de fabriquer soi-même le code d'une carte qu'on prétendrait
   * ensuite avoir reçue.
   *
   * Le montant initial entre au journal comme n'importe quel mouvement, et le
   * solde en découle. Un solde sans ligne en face serait de l'argent apparu de
   * nulle part.
   */
  app.post("/admin/gift-cards", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    let montant: number;
    try {
      montant = centimes(b.montantCents, "Le montant de la carte");
    } catch (e) {
      return c.json(
        {
          error:
            e instanceof SaisieRefusee
              ? e.message
              : "Le montant de la carte doit être renseigné.",
        },
        400,
      );
    }
    if (montant <= 0)
      return c.json(
        {
          error:
            "Le montant de la carte doit être supérieur à zéro : c'est la somme que le client vient de payer.",
        },
        400,
      );
    if (montant > MONTANT_MAX_CENTS)
      return c.json(
        {
          error:
            "Ce montant est trop élevé pour une carte cadeau. Vérifiez la saisie, il y a peut-être un zéro de trop.",
        },
        400,
      );

    const fin = dateDeFin(b.expiresAt);
    if (fin === null)
      return c.json(
        {
          error:
            "La date de fin ne se lit pas. Choisissez un jour dans le calendrier, ou laissez la case vide.",
        },
        400,
      );
    if (fin.valeur && fin.valeur.getTime() < Date.now())
      return c.json(
        {
          error:
            "Cette date de fin est déjà passée : la carte serait inutilisable dès sa création.",
        },
        400,
      );

    let customerId: number | null = null;
    if (b.customerId !== null && b.customerId !== undefined && b.customerId !== "") {
      customerId = identifiant(b.customerId);
      if (customerId === null)
        return c.json(
          { error: "Ce client ne se retrouve pas. Rechargez la page." },
          400,
        );
      const [client] = await db
        .select({ id: schema.customers.id })
        .from(schema.customers)
        .where(eq(schema.customers.id, customerId));
      if (!client)
        return c.json(
          {
            error:
              "Ce client n'existe plus. Rechargez la page, puis choisissez-le de nouveau.",
          },
          400,
        );
    }

    const note = texteOuNull(b.note, NOTE_MAX);

    try {
      const carte = await db.transaction(async (tx) => {
        // Le tirage est si large qu'une collision relèverait de l'accident ; on
        // vérifie quand même, et on retire au besoin. Sans cela, l'unicité du
        // code ressortirait en erreur de base, illisible à l'écran.
        let code = "";
        for (let essai = 0; essai < 8 && !code; essai++) {
          const candidat = nouveauCode();
          const [pris] = await tx
            .select({ id: schema.giftCards.id })
            .from(schema.giftCards)
            .where(eq(schema.giftCards.code, candidat));
          if (!pris) code = candidat;
        }
        if (!code)
          throw new SaisieRefusee(
            "La carte n'a pas pu être créée. Réessayez dans un instant.",
          );

        const [creee] = await tx
          .insert(schema.giftCards)
          .values({
            code,
            initialAmountCents: montant,
            // Recopié du journal juste après ; on part du même chiffre pour que
            // la carte ne passe jamais par un état à zéro.
            balanceCents: montant,
            status: "active",
            expiresAt: fin.valeur,
            customerId,
            note,
          })
          .returning();
        if (!creee)
          throw new SaisieRefusee(
            "La carte n'a pas pu être créée. Réessayez dans un instant.",
          );

        await tx.insert(schema.giftCardTransactions).values({
          giftCardId: creee.id,
          amountCents: montant,
          label: "Achat de la carte",
        });

        // Le journal fait foi, y compris à l'ouverture : le solde est relu de la
        // somme des lignes plutôt que recopié du formulaire.
        const solde = await soldeDuJournal(tx, creee.id);
        await tx
          .update(schema.giftCards)
          .set({ balanceCents: solde })
          .where(eq(schema.giftCards.id, creee.id));

        return { ...creee, balanceCents: solde };
      });

      return c.json(
        {
          carte: {
            id: carte.id,
            code: carte.code,
            initialAmountCents: carte.initialAmountCents,
            balanceCents: carte.balanceCents,
            status: carte.status,
            expiresAt: carte.expiresAt ? carte.expiresAt.toISOString() : null,
            customerId: carte.customerId,
            note: carte.note,
            createdAt: carte.createdAt.toISOString(),
            disabledAt: null,
          },
        },
        201,
      );
    } catch (e) {
      if (e instanceof SaisieRefusee) return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  /**
   * Change l'état, la note ou la date de fin. Une clé absente n'est pas touchée.
   *
   * Ni le montant ni le solde ne passent par ici, et c'est délibéré : ils ne se
   * règlent qu'au journal, par « /ajuster ». Une case de solde modifiable à la
   * main serait le moyen le plus simple de faire diverger le compteur et les
   * écritures qui le justifient.
   */
  app.post("/admin/gift-cards/:id", async (c) => {
    const id = identifiant(c.req.param("id"));
    if (id === null)
      return c.json({ error: "Cette carte n'existe plus. Rechargez la liste." }, 400);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    const [carte] = await db
      .select({ id: schema.giftCards.id })
      .from(schema.giftCards)
      .where(eq(schema.giftCards.id, id));
    if (!carte)
      return c.json({ error: "Cette carte n'existe plus. Rechargez la liste." }, 404);

    const champs: {
      status?: EtatCarte;
      note?: string | null;
      expiresAt?: Date | null;
      disabledAt?: Date | null;
    } = {};

    if ("status" in b) {
      const etat = String(b.status ?? "");
      if (!(ETATS as readonly string[]).includes(etat))
        return c.json(
          {
            error:
              "Dites si la carte doit être utilisable, ou mise hors service.",
          },
          400,
        );
      champs.status = etat as EtatCarte;
      // La date de mise hors service accompagne l'état : elle seule raconte
      // QUAND la carte a cessé d'être honorée. Une carte remise en service
      // repart sans cette date.
      champs.disabledAt = etat === "disabled" ? new Date() : null;
    }

    if ("note" in b) champs.note = texteOuNull(b.note, NOTE_MAX);

    if ("expiresAt" in b) {
      const fin = dateDeFin(b.expiresAt);
      if (fin === null)
        return c.json(
          {
            error:
              "La date de fin ne se lit pas. Choisissez un jour dans le calendrier, ou laissez la case vide pour une carte sans date de fin.",
          },
          400,
        );
      champs.expiresAt = fin.valeur;
    }

    // Rien à écrire : une requête vide n'est pas une erreur, elle n'a simplement
    // rien demandé.
    if (!Object.keys(champs).length) return c.json({ ok: true });

    await db.update(schema.giftCards).set(champs).where(eq(schema.giftCards.id, id));
    return c.json({ ok: true });
  });

  /**
   * Ajoute une ligne au journal, puis relit le solde de la somme des lignes.
   *
   * C'est la seule façon de faire bouger une carte depuis le back-office : une
   * recharge (montant positif), ou une correction d'erreur (négatif). Rien ne
   * s'efface jamais du journal — une écriture fautive se répare par l'écriture
   * inverse, comme dans un livre de comptes, et les deux restent visibles.
   *
   * La carte est VERROUILLÉE le temps de l'opération. Deux corrections lancées
   * en même temps liraient sinon le même solde de départ, et la seconde
   * écraserait la première : la carte afficherait alors un solde qui ne
   * correspond à aucune addition de son journal.
   */
  app.post("/admin/gift-cards/:id/ajuster", async (c) => {
    const id = identifiant(c.req.param("id"));
    if (id === null)
      return c.json({ error: "Cette carte n'existe plus. Rechargez la liste." }, 400);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    let montant: number;
    try {
      montant = centimes(b.amountCents, "Le montant");
    } catch (e) {
      return c.json(
        {
          error:
            e instanceof SaisieRefusee ? e.message : "Le montant doit être renseigné.",
        },
        400,
      );
    }
    if (montant === 0)
      return c.json(
        {
          error:
            "Indiquez ce qu'il faut ajouter ou retirer. Un montant de zéro ne changerait rien.",
        },
        400,
      );
    if (Math.abs(montant) > MONTANT_MAX_CENTS)
      return c.json(
        {
          error:
            "Ce montant est trop élevé. Vérifiez la saisie, il y a peut-être un zéro de trop.",
        },
        400,
      );

    const libelle = texteOuNull(b.label, LIBELLE_MAX);
    if (!libelle)
      return c.json(
        {
          error:
            "Dites en quelques mots pourquoi le solde change, par exemple « recharge offerte » ou « erreur de saisie ». C'est ce qui restera au journal.",
        },
        400,
      );

    try {
      const solde = await db.transaction(async (tx) => {
        const [carte] = await tx
          .select({ id: schema.giftCards.id })
          .from(schema.giftCards)
          .where(eq(schema.giftCards.id, id))
          .for("update");
        if (!carte)
          throw new SaisieRefusee("Cette carte n'existe plus. Rechargez la liste.");

        const avant = await soldeDuJournal(tx, id);
        const apres = avant + montant;
        // Un solde négatif voudrait dire que la carte doit de l'argent à la
        // boutique, ce qui n'a pas de sens : on refuse d'en retirer plus qu'il
        // n'y a, et on dit combien il reste.
        if (apres < 0)
          throw new SaisieRefusee(
            `Il ne reste que ${montantEnToutesLettres(avant)} sur cette carte : vous ne pouvez pas en retirer davantage.`,
          );
        if (apres > MONTANT_MAX_CENTS)
          throw new SaisieRefusee(
            "Le solde de la carte deviendrait trop élevé. Vérifiez la saisie.",
          );

        await tx.insert(schema.giftCardTransactions).values({
          giftCardId: id,
          amountCents: montant,
          label: libelle,
        });

        // Le solde est RELU du journal, jamais additionné dans son coin : le
        // compteur ne peut pas s'éloigner des écritures qui le justifient.
        const recalcule = await soldeDuJournal(tx, id);
        await tx
          .update(schema.giftCards)
          .set({ balanceCents: recalcule })
          .where(eq(schema.giftCards.id, id));
        return recalcule;
      });

      return c.json({ ok: true, solde });
    } catch (e) {
      if (e instanceof SaisieRefusee) return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  /**
   * Le PDF à imprimer, à glisser dans une enveloppe.
   *
   * Il porte le montant INITIAL, pas le solde du jour : c'est un objet qu'on
   * offre le jour de l'achat, et l'imprimer avec un reste de trois euros n'aurait
   * aucun sens dans une enveloppe. Le solde, lui, se lit au back-office.
   */
  app.get("/admin/gift-cards/:id/imprimer", async (c) => {
    const id = identifiant(c.req.param("id"));
    if (id === null) return c.notFound();

    const [carte] = await db
      .select()
      .from(schema.giftCards)
      .where(eq(schema.giftCards.id, id));
    if (!carte) return c.notFound();

    const pdf = await rendreCartePdf({
      code: carte.code,
      montantCents: carte.initialAmountCents,
      expiresAt: carte.expiresAt,
    });

    return c.body(new Uint8Array(pdf), 200, {
      "Content-Type": "application/pdf",
      // « inline » : la carte s'ouvre dans un onglet, prête à imprimer, sans
      // aller la repêcher dans le dossier des téléchargements.
      "Content-Disposition": `inline; filename="${nomFichierCarte(carte.initialAmountCents, carte.code)}"`,
    });
  });

  /**
   * « Mes cartes cadeaux » : les cartes que la cliente connectée a ACHETÉES
   * sur le site, liées à ses commandes payées.
   *
   * Jamais le code complet : la carte est au porteur, et son destinataire est
   * souvent quelqu'un d'autre. Le code masqué sauf son dernier groupe suffit à
   * la reconnaître. Le solde est relu au journal ; les utilisations disent
   * quand et combien, jamais qui.
   */
  app.get("/compte/cartes-cadeaux", async (c) => {
    const moi = await clientDeLaRequete(c);
    if (!moi) return c.json({ error: "Non authentifié" }, 401);
    const lignes = await db
      .select({ carte: schema.giftCards, numero: schema.orders.number })
      .from(schema.giftCards)
      .innerJoin(schema.orders, eq(schema.giftCards.orderId, schema.orders.id))
      .where(and(eq(schema.orders.customerId, moi.id), eq(schema.orders.status, "paid")))
      .orderBy(desc(schema.giftCards.createdAt), desc(schema.giftCards.id));
    const ids = lignes.map((l) => l.carte.id);
    const mouvements = ids.length
      ? await db
          .select({
            giftCardId: schema.giftCardTransactions.giftCardId,
            amountCents: schema.giftCardTransactions.amountCents,
            createdAt: schema.giftCardTransactions.createdAt,
          })
          .from(schema.giftCardTransactions)
          .where(inArray(schema.giftCardTransactions.giftCardId, ids))
          .orderBy(desc(schema.giftCardTransactions.createdAt), desc(schema.giftCardTransactions.id))
      : [];
    c.header("Cache-Control", "no-store");
    return c.json({
      cartes: lignes.map(({ carte, numero }) => {
        const siens = mouvements.filter((m) => m.giftCardId === carte.id);
        // Le journal fait foi, ici comme partout.
        const solde = siens.reduce((s, m) => s + m.amountCents, 0);
        const etat =
          carte.status !== "active"
            ? "desactivee"
            : solde <= 0
              ? "epuisee"
              : carte.expiresAt && carte.expiresAt < new Date()
                ? "echue"
                : "active";
        return {
          id: carte.id,
          masque: codeCarteMasque(carte.code),
          initialCents: carte.initialAmountCents,
          soldeCents: Math.max(0, solde),
          etat,
          destinataireEmail: carte.recipientEmail,
          destinatairePrenom: carte.recipientName,
          acheteeLe: carte.createdAt.toISOString(),
          commande: numero,
          // Les dernières dépenses : quand, combien. Pas la commande d'un
          // autre, ni qui l'a passée.
          utilisations: siens
            .filter((m) => m.amountCents < 0)
            .slice(0, 5)
            .map((m) => ({ le: m.createdAt.toISOString(), montantCents: -m.amountCents })),
        };
      }),
    });
  });

  /*
   * Il n'y a pas de route DELETE, et ce n'est pas un oubli : voir l'en-tête.
   *
   * La seule route publique qui lise un code est celle de la caisse
   * (promotions.ts, « /caisse/code ») : freinée, et muette sur l'existence
   * d'un code qu'elle refuse. La dépense s'écrit au paiement (markOrderPaid,
   * configurator-routes.ts), avec verifierCarteSousVerrou et debiterCarte ;
   * un remboursement ou une annulation la rendent (recrediterCarte,
   * commandes.ts).
   */
}
