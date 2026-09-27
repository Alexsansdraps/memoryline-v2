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
 * serveur, jamais choisi, et aucune route publique ne dit si un code existe ni
 * ce qu'il vaut : ce serait offrir de quoi deviner les codes des autres, un
 * essai après l'autre. Tout ce fichier vit sous « /admin/* », que la garde de
 * `index.ts` réserve déjà au propriétaire : les codes y sont en clair, un
 * vendeur de stand n'y accède pas.
 */
import type { Hono } from "hono";
import { asc, count, desc, eq, sql as raw } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PDFFont, PDFPage, RGB } from "pdf-lib";
import { finDuJour, FUSEAU_BOUTIQUE } from "@memoryline/types";
import { db, schema } from "./db/client.js";

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
 * Restent vingt et un signes. Douze tirages en font 21^12, soit sept millions
 * de milliards de codes possibles : tomber sur celui d'un autre client n'est
 * pas une hypothèse à considérer.
 */
const ALPHABET = "ACEFHJKLRUWXY23456789";

/** Douze signes, présentés en trois groupes de quatre séparés par des tirets. */
const LONGUEUR_CODE = 12;

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

/** Tire un code neuf, présenté en trois groupes de quatre. */
function nouveauCode(): string {
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
  // Un jour seul (« 2027-12-31 ») est poussé au soir du jour choisi, À L'HEURE
  // DE PARIS — et le fuseau est nommé, il n'est plus pris au serveur. Une carte
  // « valable jusqu'au 31 décembre » expirait sinon à 0 h 59 le 1er janvier
  // pour la cliente : elle marchait encore une heure après son terme, ou
  // cessait une heure trop tôt selon le réglage du conteneur.
  //
  // `finDuJour` refuse aussi les dates que le calendrier ne contient pas :
  // « 2027-02-31 » se lit sans broncher en JavaScript et donne le 3 mars,
  // c'est-à-dire une date que la propriétaire n'a pas choisie.
  if (/^\d{4}-\d{2}-\d{2}$/.test(propre)) {
    const quand = finDuJour(propre);
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

/**
 * « 31 décembre 2027 ».
 *
 * Le fuseau est nommé : cette date-là s'imprime sur la carte offerte, et la
 * cliente la lira le jour où elle voudra s'en servir. La carte expire au soir
 * de ce jour à Paris (voir `dateDeFin`) ; l'écrire dans un autre fuseau la
 * ferait paraître valable un jour de plus ou un jour de moins.
 */
function jourEnFrancais(quand: Date): string {
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
      })
      .from(schema.giftCards)
      .leftJoin(
        schema.customers,
        eq(schema.giftCards.customerId, schema.customers.id),
      )
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

    const cartes: CarteRendue[] = lignes.map(({ carte, clientNom, clientEmail }) => {
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

  /*
   * Il n'y a pas de route DELETE, et ce n'est pas un oubli : voir l'en-tête.
   * Il n'y a pas non plus de route publique — une adresse qui répondrait « ce
   * code existe » se laisserait interroger jusqu'à en trouver un.
   *
   * Reste à écrire, et volontairement laissé de côté ici parce que cela touche
   * au montant encaissé : la DÉPENSE d'une carte au moment de payer. Elle a sa
   * place dans le tunnel de commande, et tout ce dont elle a besoin est déjà là :
   * un mouvement NÉGATIF au journal, avec `orderId` et un libellé du genre
   * « payé la commande WEB-0042 », puis le solde relu de la somme du journal —
   * exactement ce que fait « /ajuster », verrou compris. La part réglée par la
   * carte se recopie sur `orders.giftCardCents`, et le prestataire de paiement
   * n'encaisse que la différence.
   */
}
