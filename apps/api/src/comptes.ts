/**
 * Comptes clients : côté boutique (inscription, connexion, historique, carnet
 * d'adresses) et côté back-office (fiche client, segments).
 *
 * Les deux moitiés vivent dans le même fichier parce qu'elles répondent à la
 * même question — « qui est ce client, et qu'a-t-il acheté ? » — à partir des
 * mêmes agrégats. Les séparer aurait dupliqué le calcul du chiffre d'affaires
 * et des statuts, avec la certitude qu'un jour les deux ne diraient plus la
 * même chose.
 *
 * Une seule table `customer` sert au visiteur de passage et au titulaire d'un
 * compte : `passwordHash` fait la différence. C'est ce qui permet, le jour où
 * un habitué se crée enfin un compte, de lui rendre ses commandes passées au
 * lieu d'ouvrir une deuxième fiche à côté de la première.
 */
import type { Context, Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createHash, randomBytes } from "node:crypto";
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  notInArray,
  or,
  sql as raw,
} from "drizzle-orm";
import { db, schema } from "./db/client.js";
import { hashPassword, verifyPassword } from "./auth.js";
import {
  lienDeSuivi,
  resumeCommandes,
  statutExpedition,
  statutFinancier,
} from "./commandes.js";
import {
  courrierBienvenue,
  courrierMotDePasseModifie,
  courrierReinitialisation,
  envoyer,
  estConfigure,
  type Courrier,
} from "./mail.js";
import { cheminApercu } from "./apercus.js";

export const COOKIE_CLIENT = "ml_client";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 jours
const RESET_TTL_MS = 1000 * 60 * 60; // 1 heure
const MDP_MIN = 8;

/**
 * Origine publique du site, pour les liens cliquables des courriers.
 *
 * Vide en développement : un lien sans origine mène à « /compte », qui ne veut
 * rien dire dans une boîte mail. Les modèles acceptent donc `null` et se
 * passent de bouton plutôt que d'en afficher un mort.
 */
const ORIGINE = (process.env.PUBLIC_ORIGIN ?? "").replace(/\/$/, "");

/**
 * Prévient le client sans jamais faire échouer ce qui vient d'aboutir.
 *
 * Une inscription réussie reste réussie, un mot de passe changé reste changé :
 * le courrier est un service en plus, pas une condition. Une fiche sans
 * adresse et un envoi non configuré s'arrêtent ici, silencieusement — c'est le
 * cas courant en développement.
 *
 * Le compte n'a pas de chronologie où consigner l'incident, contrairement à la
 * commande : l'échec part donc au journal du serveur, seul endroit où on
 * pourra le retrouver.
 */
async function previenirLeClient(
  destinataire: string | null,
  courrier: Courrier,
): Promise<void> {
  if (!destinataire || !estConfigure()) return;
  try {
    const parti = await envoyer({ ...courrier, to: destinataire });
    if (!parti)
      console.warn(
        `[compte] courrier « ${courrier.subject} » non parti vers ${destinataire}`,
      );
  } catch (e) {
    console.error("[compte] envoi impossible", e);
  }
}

/** Le prénom tel que les courriers l'emploient, ou de quoi s'en passer. */
function prenomDe(nom: string | null): string {
  return (nom ?? "").split(" ")[0] || "vous";
}

/**
 * Empreinte comparée quand aucun compte ne porte l'adresse saisie.
 *
 * scrypt coûte le même temps qu'il aboutisse ou non : sans elle, une réponse
 * instantanée dirait « cette adresse n'existe pas » et donnerait de quoi
 * énumérer les clients.
 */
const EMPREINTE_FACTICE = `scrypt:${"0".repeat(32)}:${"0".repeat(128)}`;

/** Une commande annulée n'est pas du chiffre d'affaires ; un panier non plus. */
const HORS_VENTES = ["draft", "cancelled", "voided"];

/* -------------------------------------------------------------------------- */
/*  Sessions boutique                                                         */
/* -------------------------------------------------------------------------- */

function empreinte(jeton: string): string {
  return createHash("sha256").update(jeton).digest("hex");
}

/** Ouvre une session et renvoie le jeton brut — le seul exemplaire existant. */
export async function creerSessionClient(customerId: number): Promise<string> {
  const jeton = randomBytes(32).toString("base64url");
  await db.insert(schema.customerSessions).values({
    id: empreinte(jeton),
    customerId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return jeton; // la base n'en garde que le SHA-256 : sa fuite n'ouvre aucun compte
}

export interface ClientConnecte {
  id: number;
  name: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email: string | null;
  phone: string | null;
  acceptsMarketing: boolean;
  createdAt: Date;
}

/**
 * Le client derrière le cookie `ml_client`, ou null.
 *
 * Exporté : le tunnel de commande s'en sert pour rattacher la commande au
 * compte connecté plutôt que d'ouvrir une fiche de plus.
 */
export async function clientDeLaRequete(
  c: Context,
): Promise<ClientConnecte | null> {
  const jeton = getCookie(c, COOKIE_CLIENT);
  if (!jeton) return null;
  const id = empreinte(jeton);
  const [row] = await db
    .select({
      expiresAt: schema.customerSessions.expiresAt,
      id: schema.customers.id,
      name: schema.customers.name,
      firstName: schema.customers.firstName,
      lastName: schema.customers.lastName,
      email: schema.customers.email,
      phone: schema.customers.phone,
      acceptsMarketing: schema.customers.acceptsMarketing,
      createdAt: schema.customers.createdAt,
    })
    .from(schema.customerSessions)
    .innerJoin(
      schema.customers,
      eq(schema.customerSessions.customerId, schema.customers.id),
    )
    .where(eq(schema.customerSessions.id, id));
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await db
      .delete(schema.customerSessions)
      .where(eq(schema.customerSessions.id, id));
    return null;
  }
  const { expiresAt, ...client } = row;
  return client;
}

export async function supprimerSessionClient(
  jeton: string | undefined,
): Promise<void> {
  if (!jeton) return;
  await db
    .delete(schema.customerSessions)
    .where(eq(schema.customerSessions.id, empreinte(jeton)));
}

/** Purge best effort, au moment où l'on en ouvre une nouvelle. */
async function purgerSessionsExpirees(): Promise<void> {
  await db
    .delete(schema.customerSessions)
    .where(lt(schema.customerSessions.expiresAt, new Date()));
}

/**
 * `secure` seulement en https : posé en http (le proxy local), le cookie
 * serait refusé par le navigateur et personne ne resterait connecté.
 */
/**
 * La requête est-elle arrivée en https ?
 *
 * `x-forwarded-proto` ne suffit pas : le tunnel termine le TLS, puis le proxy
 * réécrit l'en-tête en « http » avant de nous parler. L'HÔTE, lui, traverse la
 * chaîne intact — on le compare donc à l'origine publique, qui est la seule
 * adresse en https par laquelle un vrai client arrive. En local, sur
 * http://localhost:8080, la comparaison échoue et le cookie reste utilisable.
 */
function requeteHttps(c: Context): boolean {
  const hote = (c.req.header("host") ?? "").toLowerCase();
  const publique = (process.env.PUBLIC_ORIGIN ?? "").toLowerCase();
  if (hote && publique.startsWith("https://") && publique.endsWith(hote))
    return true;
  const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  return proto === "https" || c.req.url.startsWith("https://");
}

function poserCookie(c: Context, jeton: string): void {
  const https = requeteHttps(c);
  setCookie(c, COOKIE_CLIENT, jeton, {
    httpOnly: true,
    sameSite: "Lax",
    secure: https,
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

/* -------------------------------------------------------------------------- */
/*  Petits outils                                                             */
/* -------------------------------------------------------------------------- */

/** Comparaison d'adresse insensible à la casse, comme l'index d'unicité. */
function memeEmail(email: string) {
  return raw`lower(coalesce(${schema.customers.email}, '')) = ${email}`;
}

interface FicheClient {
  id: number;
  name: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email: string | null;
  phone: string | null;
  acceptsMarketing: boolean;
  createdAt: Date;
}

/** Ce que la boutique a le droit de savoir d'un client : jamais l'empreinte. */
/**
 * Le nom complet, à partir du prénom et du nom.
 *
 * Écrit une seule fois : deux endroits qui composeraient différemment
 * finiraient par afficher deux noms pour la même personne. Quand ni l'un ni
 * l'autre n'est renseigné, on garde ce qui était déjà là — les fiches d'avant
 * n'ont qu'un nom complet, et l'effacer ferait perdre l'information.
 */
export function nomComplet(
  prenom: string | null | undefined,
  nom: string | null | undefined,
  ancien?: string | null,
): string | null {
  const morceaux = [String(prenom ?? "").trim(), String(nom ?? "").trim()].filter(
    Boolean,
  );
  if (morceaux.length) return morceaux.join(" ").slice(0, 160);
  return (ancien ?? "").trim() || null;
}

function publique(cl: FicheClient) {
  return {
    id: cl.id,
    name: cl.name,
    firstName: cl.firstName,
    lastName: cl.lastName,
    email: cl.email,
    phone: cl.phone,
    acceptsMarketing: cl.acceptsMarketing,
    createdAt: cl.createdAt,
  };
}

/** Normalise une étiquette : casse et espaces ne doivent pas faire doublon. */
function etiquette(v: unknown): string {
  return String(v ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 40);
}

/**
 * Anti-bruteforce de la connexion boutique : au-delà de MAX échecs par IP dans
 * la fenêtre, on répond 429. En mémoire, comme le login du back-office — un
 * seul process API, et pas de dépendance de plus pour ça.
 */
const ESSAIS_FENETRE_MS = 15 * 60 * 1000;
const ESSAIS_MAX = 20;
const essais = new Map<string, { n: number; finAt: number }>();

function ipAppelant(c: Context): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "local"
  );
}

function tropDEssais(ip: string): boolean {
  const cur = essais.get(ip);
  return Boolean(cur && cur.finAt > Date.now() && cur.n >= ESSAIS_MAX);
}

function noterEchec(ip: string): void {
  const now = Date.now();
  if (essais.size > 500)
    for (const [k, v] of essais) if (v.finAt < now) essais.delete(k);
  const cur = essais.get(ip);
  if (!cur || cur.finAt < now)
    essais.set(ip, { n: 1, finAt: now + ESSAIS_FENETRE_MS });
  else cur.n += 1;
}

/* -------------------------------------------------------------------------- */
/*  Agrégats client                                                           */
/* -------------------------------------------------------------------------- */

interface AgregatClient {
  commandes: number;
  caCents: number;
  derniereCommande: Date | null;
}

/**
 * Nombre de commandes, chiffre d'affaires et date de la dernière, par client.
 *
 * Une seule requête groupée pour toute la liste : une par client transformerait
 * la page en salle d'attente dès quelques centaines de fiches.
 */
async function agregatsClients(
  ids?: number[],
): Promise<Map<number, AgregatClient>> {
  const out = new Map<number, AgregatClient>();
  if (ids && !ids.length) return out;
  const conditions = [
    isNotNull(schema.orders.customerId),
    notInArray(schema.orders.status, HORS_VENTES),
  ];
  if (ids) conditions.push(inArray(schema.orders.customerId, ids));
  const rows = await db
    .select({
      customerId: schema.orders.customerId,
      n: raw<number>`count(*)::int`,
      ca: raw<number>`coalesce(sum(${schema.orders.totalCents}), 0)::int`,
      derniere: raw<Date>`max(${schema.orders.createdAt})`,
    })
    .from(schema.orders)
    .where(and(...conditions))
    .groupBy(schema.orders.customerId);
  for (const r of rows) {
    if (r.customerId == null) continue;
    out.set(r.customerId, {
      commandes: r.n,
      caCents: r.ca,
      derniereCommande: r.derniere ? new Date(r.derniere) : null,
    });
  }
  return out;
}

/**
 * D'où vient chaque client : de la boutique, ou d'un stand — et lequel.
 *
 * C'est la PREMIÈRE commande qui décide. Quelqu'un rencontré sur un salon puis
 * devenu client du site reste quelqu'un que le salon a fait connaître, et
 * c'est ce qu'on veut savoir en se demandant si un salon valait la peine.
 *
 * Calculé plutôt que recopié dans une colonne : une colonne aurait dérivé le
 * jour où l'on rattache une commande à une autre fiche, et il aurait fallu une
 * migration pour les clients déjà enregistrés.
 */
async function originesClients(
  ids?: number[],
): Promise<Map<number, { canal: string; stand: string | null }>> {
  const out = new Map<number, { canal: string; stand: string | null }>();
  if (ids && !ids.length) return out;
  const conditions = [
    isNotNull(schema.orders.customerId),
    notInArray(schema.orders.status, HORS_VENTES),
  ];
  if (ids) conditions.push(inArray(schema.orders.customerId, ids));
  // Triées de la plus ancienne à la plus récente : la dernière écrite gagne,
  // donc c'est bien la première commande qui reste.
  const rows = await db
    .select({
      customerId: schema.orders.customerId,
      channel: schema.orders.channel,
      stand: schema.stands.nom,
      creeLe: schema.orders.createdAt,
    })
    .from(schema.orders)
    .leftJoin(schema.stands, eq(schema.orders.standId, schema.stands.id))
    .where(and(...conditions))
    .orderBy(desc(schema.orders.createdAt));
  for (const r of rows) {
    if (r.customerId == null) continue;
    out.set(r.customerId, { canal: r.channel, stand: r.stand ?? null });
  }
  return out;
}

const AGREGAT_VIDE: AgregatClient = {
  commandes: 0,
  caCents: 0,
  derniereCommande: null,
};

/* -------------------------------------------------------------------------- */

export function mountCompteRoutes(app: Hono): void {
  /* ===== Boutique — compte ============================================== */

  /**
   * Création de compte.
   *
   * Une fiche NEUVE, toujours. On ne rattache jamais à l'inscription les
   * commandes passées en visiteur avec la même adresse, aussi tentant que ce
   * soit : s'inscrire ne prouve rien sur la possession de la boîte mail, et il
   * suffirait de connaître l'adresse d'un client pour lire son nom, son
   * adresse postale, son téléphone et ses montants.
   *
   * Le rattachement existe, mais il passe par une décision humaine au
   * back-office (POST /admin/customers/:id/rattacher-commandes) — ou, le jour
   * où l'envoi d'e-mails sera branché, par la vérification de l'adresse.
   */
  app.post("/compte/inscription", async (c) => {
    const b = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    const email = String(b.email ?? "")
      .trim()
      .toLowerCase();
    const mdp = String(b.password ?? "");
    const prenom = String(b.firstName ?? "").trim().slice(0, 80);
    const nomFamille = String(b.lastName ?? "").trim().slice(0, 80);
    // `name` reste accepté : les anciens formulaires et le tunnel de commande
    // l'envoient encore, et refuser une inscription pour cela serait absurde.
    const nom = nomComplet(prenom, nomFamille, String(b.name ?? "").trim());
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return c.json({ error: "Adresse e-mail invalide" }, 400);
    if (mdp.length < MDP_MIN)
      return c.json(
        { error: `Le mot de passe doit faire au moins ${MDP_MIN} caractères` },
        400,
      );

    const [dejaCompte] = await db
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(and(memeEmail(email), isNotNull(schema.customers.passwordHash)));
    if (dejaCompte)
      return c.json({ error: "Un compte existe déjà avec cette adresse" }, 409);

    const marketing = b.acceptsMarketing === true;
    const maintenant = new Date();
    const [client] = await db
      .insert(schema.customers)
      .values({
        name: nom,
        firstName: prenom || null,
        lastName: nomFamille || null,
        email,
        passwordHash: await hashPassword(mdp),
        acceptsMarketing: marketing,
        marketingOptInAt: marketing ? maintenant : null,
        lastLoginAt: maintenant,
      })
      .returning();
    if (!client) return c.json({ error: "Création impossible" }, 500);

    poserCookie(c, await creerSessionClient(client.id));
    // Après l'insertion, jamais avant : une création qui échoue ne doit pas
    // laisser derrière elle un mot de bienvenue vers un compte inexistant.
    // Une adresse ne peut porter qu'un compte (le contrôle ci-dessus, doublé
    // de l'index d'unicité) : rejouer l'inscription part en 409 et n'envoie
    // rien, le courrier ne peut donc pas arriver deux fois.
    await previenirLeClient(
      client.email,
      courrierBienvenue({
        prenomClient: prenomDe(client.name),
        lien: ORIGINE ? `${ORIGINE}/compte` : null,
      }),
    );
    return c.json({ customer: publique(client) }, 201);
  });

  /**
   * Rattache à un compte les commandes passées en visiteur avec la même
   * adresse. RÉSERVÉ AU BACK-OFFICE, et c'est le cœur de la protection : la
   * personne qui clique a identifié le client autrement (au téléphone, sur une
   * commande, en salon). Le système, lui, n'a aucun moyen de le faire tant que
   * l'adresse n'est pas vérifiée par e-mail.
   *
   * Les fiches en double sont VIDÉES puis retirées : deux fiches pour une même
   * personne finissent toujours par produire deux historiques et deux vérités.
   * C'est la seule disparition de tout le back-office, et elle ne tient que
   * parce que la fiche gardée reprend d'abord tout ce que sa jumelle portait :
   * ses commandes, ses adresses, ses cartes cadeaux, ses essais d'affiche IA,
   * ses étiquettes de classement, sa note, et les renseignements qui manquaient
   * ici (téléphone, prénom, nom, identifiant Shopify, ancienneté).
   *
   * Cette reprise se relit DEUX FOIS à chaque changement : les colonnes de
   * `customer`, et les six tables qui pointent vers elle (schema.ts). Les
   * colonnes se voient ; les tables, non — une ligne en « set null » se coupe
   * toute seule au delete, sans erreur, sans trace et sans rien à l'écran. Une
   * carte cadeau remise à cette personne a déjà perdu son destinataire de
   * cette façon. Deux tables restent en cascade, sans dommage :
   * `customer_session` et `customer_token` s'ouvrent l'une et l'autre sur un
   * `passwordHash` qu'une fiche fondue ici n'a par définition pas.
   *
   * Une seule chose n'est PAS reprise, et c'est voulu : le consentement
   * marketing. Refuser de recontacter quelqu'un est l'erreur qui se rattrape,
   * l'inverse non.
   */
  app.post("/admin/customers/:id/rattacher-commandes", async (c) => {
    const id = Number(c.req.param("id"));
    const [compte] = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, id));
    if (!compte) return c.notFound();
    if (!compte.email)
      return c.json({ error: "Cette fiche n'a pas d'adresse e-mail" }, 400);

    const fiches = await db
      .select()
      .from(schema.customers)
      .where(
        and(
          memeEmail(compte.email.toLowerCase()),
          isNull(schema.customers.passwordHash),
        ),
      );
    const aFondre = fiches.filter((f) => f.id !== id);
    const doublons = aFondre.map((f) => f.id);
    if (!doublons.length)
      return c.json({ ok: true, commandes: 0, fiches: 0 });

    const deplacees = await db
      .update(schema.orders)
      .set({ customerId: id })
      .where(inArray(schema.orders.customerId, doublons))
      .returning({ id: schema.orders.id });
    await db
      .update(schema.customerAddresses)
      .set({ customerId: id })
      .where(inArray(schema.customerAddresses.customerId, doublons));

    /*
     * Les deux liens que la base couperait d'elle-même au delete (« set null »,
     * schema.ts) : la carte cadeau remise à cette personne et ses essais
     * d'affiche IA. Les repointer AVANT, sans quoi « à qui cette carte a-t-elle
     * été remise ? » n'a plus de réponse, et rien à l'écran n'aura prévenu.
     */
    await db
      .update(schema.giftCards)
      .set({ customerId: id })
      .where(inArray(schema.giftCards.customerId, doublons));
    await db
      .update(schema.aiGenerations)
      .set({ customerId: id })
      .where(inArray(schema.aiGenerations.customerId, doublons));

    /*
     * Ce que la fiche gardée n'a pas et qu'une jumelle a : on le reprend avant
     * qu'elle ne parte. Uniquement les champs VIDES de la fiche gardée — on
     * complète, on n'écrase jamais : la fiche que la patronne a choisi de
     * garder est celle qui fait foi.
     */
    const repris: Partial<typeof schema.customers.$inferInsert> = {};
    const vide = (v: string | null | undefined) => !String(v ?? "").trim();
    for (const champ of ["name", "phone", "firstName", "lastName"] as const) {
      if (!vide(compte[champ])) continue;
      const donneur = aFondre.find((f) => !vide(f[champ]));
      if (donneur) repris[champ] = donneur[champ];
    }

    // L'identifiant Shopify : le fil qui relie la fiche à l'historique importé.
    // Il ne se retrouve pas si on le laisse partir.
    if (compte.legacyId === null) {
      const donneur = aFondre.find((f) => f.legacyId !== null);
      if (donneur) repris.legacyId = donneur.legacyId;
    }

    /*
     * La note se concatène plutôt qu'elle ne se choisit : deux notes écrites à
     * deux moments sont deux renseignements, et en jeter une serait le seul
     * endroit de cette fusion où quelque chose se perdrait pour de bon.
     */
    const notes = [compte.note, ...aFondre.map((f) => f.note)]
      .map((n) => String(n ?? "").trim())
      .filter(Boolean);
    const notesUniques = [...new Set(notes)];
    if (notesUniques.length > 1) repris.note = notesUniques.join("\n\n");
    else if (notesUniques.length === 1 && vide(compte.note))
      repris.note = notesUniques[0];

    /*
     * Les étiquettes de classement se RÉUNISSENT, comme les notes : ce n'est
     * pas un champ qui se remplace, chacune est un rangement voulu. Garder
     * « VIP » en laissant filer « salon de Vannes » serait déjà une perte.
     */
    const etiquettes = [
      ...new Set(
        [compte.tags ?? [], ...aFondre.map((f) => f.tags ?? [])]
          .flat()
          .map((t) => String(t).trim())
          .filter(Boolean),
      ),
    ];
    if (
      etiquettes.length &&
      JSON.stringify(etiquettes) !== JSON.stringify(compte.tags ?? [])
    )
      repris.tags = etiquettes;

    /*
     * « Client depuis » prend la plus ancienne des deux dates : les commandes
     * de la jumelle viennent d'arriver ici, et une fiche plus jeune que sa
     * première commande se lirait comme une erreur de la boutique.
     */
    const plusAncienne = aFondre.reduce(
      (a, f) => (f.createdAt < a ? f.createdAt : a),
      compte.createdAt,
    );
    if (plusAncienne < compte.createdAt) repris.createdAt = plusAncienne;

    if (Object.keys(repris).length)
      await db
        .update(schema.customers)
        .set(repris)
        .where(eq(schema.customers.id, id));

    await db
      .delete(schema.customers)
      .where(inArray(schema.customers.id, doublons));

    return c.json({
      ok: true,
      commandes: deplacees.length,
      fiches: doublons.length,
    });
  });

  app.post("/compte/connexion", async (c) => {
    const ip = ipAppelant(c);
    if (tropDEssais(ip))
      return c.json({ error: "Trop de tentatives, réessayez plus tard" }, 429);
    const b = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    const email = String(b.email ?? "")
      .trim()
      .toLowerCase();
    const mdp = String(b.password ?? "");

    const [compte] = await db
      .select()
      .from(schema.customers)
      .where(and(memeEmail(email), isNotNull(schema.customers.passwordHash)));
    // Même travail cryptographique dans les deux cas : le temps de réponse ne
    // doit pas trahir l'existence de l'adresse.
    const ok = await verifyPassword(
      mdp,
      compte?.passwordHash ?? EMPREINTE_FACTICE,
    );
    if (!compte || !ok) {
      noterEchec(ip);
      return c.json({ error: "Identifiants invalides" }, 401);
    }
    essais.delete(ip);

    await db
      .update(schema.customers)
      .set({ lastLoginAt: new Date() })
      .where(eq(schema.customers.id, compte.id));
    await purgerSessionsExpirees();
    poserCookie(c, await creerSessionClient(compte.id));
    return c.json({ customer: publique(compte) });
  });

  app.post("/compte/deconnexion", async (c) => {
    await supprimerSessionClient(getCookie(c, COOKIE_CLIENT));
    deleteCookie(c, COOKIE_CLIENT, { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/compte/moi", async (c) => {
    const moi = await clientDeLaRequete(c);
    if (!moi) return c.json({ error: "Non authentifié" }, 401);
    return c.json({ customer: publique(moi) });
  });

  app.post("/compte/moi", async (c) => {
    const moi = await clientDeLaRequete(c);
    if (!moi) return c.json({ error: "Non authentifié" }, 401);
    const b = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    const maj: Partial<typeof schema.customers.$inferInsert> = {};
    // Prénom et nom séparés : `name` se recompose des deux, toujours de la
    // même façon. Envoyer `name` seul reste accepté pour les formulaires qui
    // ne connaissent pas encore la distinction.
    if (b.firstName !== undefined || b.lastName !== undefined) {
      const prenom =
        b.firstName !== undefined
          ? String(b.firstName).trim().slice(0, 80)
          : (moi.firstName ?? "");
      const nomFamille =
        b.lastName !== undefined
          ? String(b.lastName).trim().slice(0, 80)
          : (moi.lastName ?? "");
      maj.firstName = prenom || null;
      maj.lastName = nomFamille || null;
      maj.name = nomComplet(prenom, nomFamille, moi.name);
    } else if (b.name !== undefined) {
      maj.name = String(b.name).trim() || null;
    }
    if (b.phone !== undefined) maj.phone = String(b.phone).trim() || null;
    if (b.acceptsMarketing !== undefined) {
      const veut = b.acceptsMarketing === true;
      maj.acceptsMarketing = veut;
      // La date du consentement est ce qu'il faudra produire en cas de
      // réclamation : elle ne se pose qu'au moment où il est donné.
      maj.marketingOptInAt = veut
        ? moi.acceptsMarketing
          ? undefined
          : new Date()
        : null;
      if (maj.marketingOptInAt === undefined) delete maj.marketingOptInAt;
    }
    const [client] = await db
      .update(schema.customers)
      .set(maj)
      .where(eq(schema.customers.id, moi.id))
      .returning();
    return c.json({ customer: publique(client!) });
  });

  app.post("/compte/mot-de-passe", async (c) => {
    const moi = await clientDeLaRequete(c);
    if (!moi) return c.json({ error: "Non authentifié" }, 401);
    const b = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    const ancien = String(b.ancien ?? "");
    const nouveau = String(b.nouveau ?? "");
    if (nouveau.length < MDP_MIN)
      return c.json(
        { error: `Le mot de passe doit faire au moins ${MDP_MIN} caractères` },
        400,
      );
    const [compte] = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, moi.id));
    if (
      !compte?.passwordHash ||
      !(await verifyPassword(ancien, compte.passwordHash))
    )
      return c.json({ error: "Mot de passe actuel incorrect" }, 400);
    await db
      .update(schema.customers)
      .set({ passwordHash: await hashPassword(nouveau) })
      .where(eq(schema.customers.id, moi.id));
    // L'avis part une fois le changement écrit, et il ne peut pas partir deux
    // fois : la requête rejouée présente un ancien mot de passe qui n'est plus
    // celui du compte, et se fait refuser quelques lignes plus haut.
    await previenirLeClient(
      compte.email,
      courrierMotDePasseModifie({
        prenomClient: prenomDe(compte.name),
        parReinitialisation: false,
        lien: ORIGINE ? `${ORIGINE}/compte/mot-de-passe-oublie` : null,
      }),
    );
    return c.json({ ok: true });
  });

  /**
   * Demande de réinitialisation.
   *
   * Réponse invariable, y compris pour une adresse inconnue : distinguer les
   * deux cas donnerait à n'importe qui la liste des clients de la boutique.
   */
  app.post("/compte/mot-de-passe-oublie", async (c) => {
    const b = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    const email = String(b.email ?? "")
      .trim()
      .toLowerCase();
    if (email) {
      const [compte] = await db
        .select()
        .from(schema.customers)
        .where(and(memeEmail(email), isNotNull(schema.customers.passwordHash)));
      if (compte?.email) {
        const jeton = randomBytes(32).toString("base64url");
        await db.insert(schema.customerTokens).values({
          id: empreinte(jeton),
          customerId: compte.id,
          kind: "reset",
          expiresAt: new Date(Date.now() + RESET_TTL_MS),
        });
        const origine = (process.env.PUBLIC_ORIGIN ?? "").replace(/\/$/, "");
        const lien = `${origine}/compte/reinitialiser?jeton=${jeton}`;
        const courrier = courrierReinitialisation({
          prenomClient: (compte.name ?? "").split(" ")[0] || "vous",
          lien,
        });
        if (estConfigure()) {
          await envoyer({ ...courrier, to: compte.email });
        } else {
          // Sans courrier configuré la fonction serait intestable : on écrit le
          // lien dans le journal du serveur, jamais dans la réponse. En
          // production l'envoi est configuré et cette branche ne sert plus.
          console.warn(
            "[compte] courrier non configuré — lien de réinitialisation :",
            lien,
          );
        }
      }
    }
    return c.json({ ok: true });
  });

  app.post("/compte/mot-de-passe-reinitialiser", async (c) => {
    const b = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    const jeton = String(b.token ?? "");
    const nouveau = String(b.nouveau ?? "");
    if (nouveau.length < MDP_MIN)
      return c.json(
        { error: `Le mot de passe doit faire au moins ${MDP_MIN} caractères` },
        400,
      );
    const [ligne] = await db
      .select()
      .from(schema.customerTokens)
      .where(
        and(
          eq(schema.customerTokens.id, empreinte(jeton)),
          eq(schema.customerTokens.kind, "reset"),
        ),
      );
    if (!ligne || ligne.usedAt || ligne.expiresAt.getTime() < Date.now())
      return c.json({ error: "Lien expiré ou déjà utilisé" }, 400);

    await db
      .update(schema.customers)
      .set({ passwordHash: await hashPassword(nouveau) })
      .where(eq(schema.customers.id, ligne.customerId));
    await db
      .update(schema.customerTokens)
      .set({ usedAt: new Date() })
      .where(eq(schema.customerTokens.id, ligne.id));
    // Réinitialiser, c'est souvent reprendre la main sur un compte perdu :
    // toutes les sessions ouvertes tombent, y compris celle de l'intrus.
    await db
      .delete(schema.customerSessions)
      .where(eq(schema.customerSessions.customerId, ligne.customerId));

    // L'avis de sécurité part après que le jeton a été marqué utilisé : rejouer
    // la requête bute sur `usedAt` et repart en 400 sans rien envoyer. C'est
    // même le seul avertissement que recevra quelqu'un dont on a détourné la
    // boîte mail, alors il compte plus ici que sur l'autre chemin.
    const [titulaire] = await db
      .select({ name: schema.customers.name, email: schema.customers.email })
      .from(schema.customers)
      .where(eq(schema.customers.id, ligne.customerId));
    await previenirLeClient(
      titulaire?.email ?? null,
      courrierMotDePasseModifie({
        prenomClient: prenomDe(titulaire?.name ?? null),
        parReinitialisation: true,
        lien: ORIGINE ? `${ORIGINE}/compte/mot-de-passe-oublie` : null,
      }),
    );
    return c.json({ ok: true });
  });

  /* ===== Boutique — commandes ========================================== */

  /**
   * Historique du client. Les paniers (`draft`) n'y figurent jamais : ce sont
   * des brouillons de la boutique, pas des achats.
   */
  app.get("/compte/commandes", async (c) => {
    const moi = await clientDeLaRequete(c);
    if (!moi) return c.json({ error: "Non authentifié" }, 401);
    const commandes = await db
      .select()
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.customerId, moi.id),
          ne(schema.orders.status, "draft"),
        ),
      )
      .orderBy(desc(schema.orders.createdAt));
    const ids = commandes.map((o) => o.id);
    const resume = await resumeCommandes(ids);
    const colis = ids.length
      ? await db
          .select()
          .from(schema.fulfillments)
          .where(
            and(
              inArray(schema.fulfillments.orderId, ids),
              eq(schema.fulfillments.status, "success"),
            ),
          )
      : [];

    return c.json(
      commandes.map((o) => {
        const s = resume.get(o.id)!;
        return {
          id: o.id,
          number: o.number,
          createdAt: o.createdAt,
          totalCents: o.totalCents,
          articles: s.articles,
          statutFinancier: statutFinancier(o, s.rembourseCents),
          statutExpedition: statutExpedition(s.articles, s.expedies),
          suivi: colis
            .filter((f) => f.orderId === o.id && f.trackingNumber)
            .map((f) => ({
              carrier: f.carrier,
              trackingNumber: f.trackingNumber,
              trackingUrl: f.trackingUrl ?? lienDeSuivi(f.carrier, f.trackingNumber),
            })),
        };
      }),
    );
  });

  /**
   * Détail d'une commande. 404 — et non 403 — quand elle appartient à
   * quelqu'un d'autre : répondre « interdit » confirmerait qu'elle existe.
   */
  app.get("/compte/commandes/:id", async (c) => {
    const moi = await clientDeLaRequete(c);
    if (!moi) return c.json({ error: "Non authentifié" }, 401);
    const id = Number(c.req.param("id"));
    const [order] = await db
      .select()
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.id, id),
          eq(schema.orders.customerId, moi.id),
          ne(schema.orders.status, "draft"),
        ),
      );
    if (!order) return c.json({ error: "Commande introuvable" }, 404);

    const lignes = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, order.id));

    /*
     * L'adresse de la vignette de chaque ligne.
     *
     * Le rendu se fait côté serveur, à la demande, et se garde ensuite : la
     * page n'a plus à charger la bibliothèque des personnages ni à empiler
     * des SVG pour une image de 80 pixels. Et c'est la même adresse qui part
     * dans les courriers, qui eux ne savent pas exécuter de code.
     */
    const items = lignes.map((l) => ({ ...l, apercu: cheminApercu(l.id) }));

    /*
     * Les cadres de CETTE commande, nommés — archivés compris.
     *
     * La configuration d'une ligne ne garde que l'identifiant du cadre. La
     * page les nommait en relisant le catalogue public `/frames`, qui ne rend
     * que ce qui est en vente : le jour où un cadre est décoché ou archivé,
     * une commande vieille de six mois se remettait à afficher « Cadre :
     * Cadre ». Le nom d'un cadre vendu fait partie de l'histoire de la
     * commande — il part donc AVEC elle, comme le nom du mode de livraison
     * figé sur `shippingLabel`, et comme le font déjà les noms des fichiers
     * d'impression côté atelier.
     *
     * « Sans cadre » s'écrit tantôt `null`, tantôt la chaîne vide : on ne
     * garde que ce qui est un vrai identifiant.
     */
    const cadreIds = [
      ...new Set(
        lignes
          .map((l) => Number((l.config as { frameId?: unknown } | null)?.frameId))
          .filter((n) => Number.isFinite(n) && n > 0),
      ),
    ];
    const cadres = cadreIds.length
      ? await db
          .select({ id: schema.frames.id, name: schema.frames.name })
          .from(schema.frames)
          .where(inArray(schema.frames.id, cadreIds))
      : [];

    const expeditions = await db
      .select()
      .from(schema.fulfillments)
      .where(
        and(
          eq(schema.fulfillments.orderId, order.id),
          eq(schema.fulfillments.status, "success"),
        ),
      )
      .orderBy(desc(schema.fulfillments.createdAt));
    const resume = (await resumeCommandes([order.id])).get(order.id)!;

    const sousTotal = items.reduce(
      (s, it) => s + it.unitPriceCents * it.quantity,
      0,
    );
    const port = order.shippingCents ?? 0;
    // La remise se DÉDUIT de ce qui a été facturé : c'est le montant payé qui
    // fait foi, pas un recalcul qui pourrait diverger du jour de la commande.
    const remise = Math.max(0, sousTotal + port - order.totalCents);

    return c.json({
      order,
      items,
      cadres,
      expeditions: expeditions.map((f) => ({
        ...f,
        trackingUrl: f.trackingUrl ?? lienDeSuivi(f.carrier, f.trackingNumber),
      })),
      montants: {
        sousTotalCents: sousTotal,
        remiseCents: remise,
        portCents: port,
        totalCents: order.totalCents,
        rembourseCents: resume.rembourseCents,
      },
      statutFinancier: statutFinancier(order, resume.rembourseCents),
      statutExpedition: statutExpedition(resume.articles, resume.expedies),
    });
  });

  /* ===== Boutique — carnet d'adresses ================================== */

  app.get("/compte/adresses", async (c) => {
    const moi = await clientDeLaRequete(c);
    if (!moi) return c.json({ error: "Non authentifié" }, 401);
    return c.json(
      await db
        .select()
        .from(schema.customerAddresses)
        .where(eq(schema.customerAddresses.customerId, moi.id))
        .orderBy(desc(schema.customerAddresses.isDefaultShipping), schema.customerAddresses.id),
    );
  });

  /** Création ou modification : `id` présent = modification de SA propre adresse. */
  app.post("/compte/adresses", async (c) => {
    const moi = await clientDeLaRequete(c);
    if (!moi) return c.json({ error: "Non authentifié" }, 401);
    const b = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    const texte = (v: unknown) => String(v ?? "").trim() || null;
    const valeurs = {
      label: texte(b.label),
      name: texte(b.name),
      line1: texte(b.line1),
      line2: texte(b.line2),
      postalCode: texte(b.postalCode),
      city: texte(b.city),
      country: texte(b.country),
      phone: texte(b.phone),
      isDefaultShipping: b.isDefaultShipping === true,
      isDefaultBilling: b.isDefaultBilling === true,
    };
    if (!valeurs.line1 || !valeurs.city || !valeurs.postalCode)
      return c.json({ error: "Adresse incomplète" }, 400);

    const id = Number(b.id ?? 0);
    let adresse: typeof schema.customerAddresses.$inferSelect | undefined;
    if (id) {
      [adresse] = await db
        .update(schema.customerAddresses)
        .set(valeurs)
        .where(
          and(
            eq(schema.customerAddresses.id, id),
            eq(schema.customerAddresses.customerId, moi.id),
          ),
        )
        .returning();
      if (!adresse) return c.json({ error: "Adresse introuvable" }, 404);
    } else {
      [adresse] = await db
        .insert(schema.customerAddresses)
        .values({ ...valeurs, customerId: moi.id })
        .returning();
    }

    // « Par défaut » n'a de sens qu'à un seul exemplaire : on retire le drapeau
    // aux autres plutôt que de laisser deux adresses se disputer le titre.
    if (valeurs.isDefaultShipping)
      await db
        .update(schema.customerAddresses)
        .set({ isDefaultShipping: false })
        .where(
          and(
            eq(schema.customerAddresses.customerId, moi.id),
            ne(schema.customerAddresses.id, adresse!.id),
          ),
        );
    if (valeurs.isDefaultBilling)
      await db
        .update(schema.customerAddresses)
        .set({ isDefaultBilling: false })
        .where(
          and(
            eq(schema.customerAddresses.customerId, moi.id),
            ne(schema.customerAddresses.id, adresse!.id),
          ),
        );

    return c.json(adresse);
  });

  app.delete("/compte/adresses/:id", async (c) => {
    const moi = await clientDeLaRequete(c);
    if (!moi) return c.json({ error: "Non authentifié" }, 401);
    const id = Number(c.req.param("id"));
    const [supprimee] = await db
      .delete(schema.customerAddresses)
      .where(
        and(
          eq(schema.customerAddresses.id, id),
          eq(schema.customerAddresses.customerId, moi.id),
        ),
      )
      .returning({ id: schema.customerAddresses.id });
    if (!supprimee) return c.json({ error: "Adresse introuvable" }, 404);
    return c.json({ ok: true });
  });

  /* ===== Back-office — clients ========================================= */

  /**
   * Liste des clients avec leurs agrégats.
   *
   * Les segments qui dépendent des commandes (inactifs, fidèles, sans
   * commande) se filtrent en mémoire, comme les statuts de la liste des
   * commandes : les exprimer en SQL rendrait la requête illisible pour un gain
   * nul à cette échelle.
   */

  /**
   * La liste des clientes, en fichier.
   *
   * Memes filtres que l'ecran : ce qu'on voit est ce qu'on exporte, sans quoi
   * on croit sortir un segment et on sort tout le monde.
   *
   * La colonne du consentement marketing n'est pas facultative : une liste
   * d'adresses sans elle est une liste qu'on ne peut pas utiliser, et on
   * finirait par ecrire a des gens qui n'ont rien demande.
   */
  app.get("/admin/customers/export.csv", async (c) => {
    if (c.get("utilisateur")?.role !== "owner")
      return c.json(
        { error: "La liste des clientes est réservée à la propriétaire." },
        403,
      );

    const q = c.req.query();
    const url = new URL(c.req.url);
    const interne = new URL(url.origin + "/admin/customers");
    if (q.q) interne.searchParams.set("q", q.q);
    if (q.segment) interne.searchParams.set("segment", q.segment);
    interne.searchParams.set("limit", "5000");
    // On repasse par la meme lecture que l'ecran : deux requetes differentes
    // finiraient par ne plus dire la meme chose, et le fichier ne
    // correspondrait plus a la liste qu'on a sous les yeux.
    const reponse = await app.fetch(
      new Request(interne, { headers: c.req.raw.headers }),
    );
    if (!reponse.ok)
      return c.json({ error: "La liste n'a pas pu être lue." }, 500);
    const lignesBrutes = (await reponse.json()) as {
      name: string | null;
      email: string | null;
      phone: string | null;
      createdAt: string;
      acceptsMarketing: boolean;
      tags: string[];
      compte: boolean;
      origine: string | null;
      origineStand: string | null;
      commandes: number;
      caCents: number;
      derniereCommande: string | null;
    }[];

    const cellule = (v: unknown): string => {
      const t = v === null || v === undefined ? "" : String(v);
      return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const jour = (iso: string | null) =>
      iso ? new Date(iso).toLocaleDateString("fr-FR") : "";

    const entetes = [
      "Nom",
      "Adresse e-mail",
      "Téléphone",
      "Accepte le marketing",
      "Compte client",
      "Vient de",
      "Stand",
      "Commandes",
      "Total dépensé",
      "Dernière commande",
      "Inscrite le",
      "Étiquettes",
    ];
    const lignes = lignesBrutes.map((r) =>
      [
        r.name ?? "",
        r.email ?? "",
        r.phone ?? "",
        r.acceptsMarketing ? "oui" : "non",
        r.compte ? "oui" : "non",
        r.origine === "salon" ? "stand" : r.origine === "web" ? "site" : "",
        r.origineStand ?? "",
        r.commandes,
        (r.caCents / 100).toFixed(2).replace(".", ","),
        jour(r.derniereCommande),
        jour(r.createdAt),
        (r.tags ?? []).join(", "),
      ]
        .map(cellule)
        .join(";"),
    );

    // BOM et point-virgule : c'est ce qu'Excel francais ouvre en colonnes sans
    // rien demander, comme les autres exports de la maison.
    const csv = "﻿" + [entetes.join(";"), ...lignes].join("\r\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="clientes.csv"',
      },
    });
  });

  app.get("/admin/customers", async (c) => {
    const q = c.req.query();
    const limit = Math.min(Number(q.limit ?? 200), 1000);
    const conditions = [];
    const cherche = (q.q ?? "").trim().toLowerCase();
    if (cherche) {
      const motif = `%${cherche}%`;
      conditions.push(
        or(
          raw`lower(coalesce(${schema.customers.name}, '')) like ${motif}`,
          raw`lower(coalesce(${schema.customers.email}, '')) like ${motif}`,
          raw`lower(coalesce(${schema.customers.phone}, '')) like ${motif}`,
        )!,
      );
    }
    const segment = (q.segment ?? "").trim();
    if (segment === "compte")
      conditions.push(isNotNull(schema.customers.passwordHash));
    if (segment === "optin")
      conditions.push(eq(schema.customers.acceptsMarketing, true));

    const rows = await db
      .select({
        id: schema.customers.id,
        name: schema.customers.name,
        email: schema.customers.email,
        phone: schema.customers.phone,
        createdAt: schema.customers.createdAt,
        acceptsMarketing: schema.customers.acceptsMarketing,
        tags: schema.customers.tags,
        compte: raw<boolean>`(${schema.customers.passwordHash} is not null)`,
      })
      .from(schema.customers)
      .where(conditions.length ? and(...conditions) : undefined);

    const agregats = await agregatsClients();
    const origines = await originesClients();
    let liste = rows.map((r) => {
      const a = agregats.get(r.id) ?? AGREGAT_VIDE;
      const o = origines.get(r.id);
      return {
        ...r,
        tags: r.tags ?? [],
        /** « web », « salon », ou null pour qui n'a jamais rien commandé. */
        origine: o?.canal ?? null,
        /** Le nom du stand, quand la première commande y a été prise. */
        origineStand: o?.stand ?? null,
        commandes: a.commandes,
        caCents: a.caCents,
        derniereCommande: a.derniereCommande
          ? a.derniereCommande.toISOString()
          : null,
      };
    });

    const ilY90Jours = Date.now() - 90 * 24 * 60 * 60 * 1000;
    if (segment === "inactifs")
      liste = liste.filter(
        (l) =>
          l.commandes > 0 &&
          l.derniereCommande !== null &&
          new Date(l.derniereCommande).getTime() < ilY90Jours,
      );
    if (segment === "fideles") liste = liste.filter((l) => l.commandes >= 2);
    if (segment === "sans-commande")
      liste = liste.filter((l) => l.commandes === 0);

    // Les plus récemment actifs d'abord : c'est ce qu'on cherche en ouvrant la
    // page. Les clients sans commande passent après, du plus récent inscrit.
    liste.sort(
      (a, b) =>
        (b.derniereCommande ? Date.parse(b.derniereCommande) : 0) -
          (a.derniereCommande ? Date.parse(a.derniereCommande) : 0) ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    );
    return c.json(liste.slice(0, limit));
  });

  app.get("/admin/customers/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const [client] = await db
      .select({
        id: schema.customers.id,
        name: schema.customers.name,
        email: schema.customers.email,
        phone: schema.customers.phone,
        createdAt: schema.customers.createdAt,
        acceptsMarketing: schema.customers.acceptsMarketing,
        marketingOptInAt: schema.customers.marketingOptInAt,
        tags: schema.customers.tags,
        note: schema.customers.note,
        lastLoginAt: schema.customers.lastLoginAt,
        legacyId: schema.customers.legacyId,
        compte: raw<boolean>`(${schema.customers.passwordHash} is not null)`,
      })
      .from(schema.customers)
      .where(eq(schema.customers.id, id));
    if (!client) return c.json({ error: "Client introuvable" }, 404);

    const adresses = await db
      .select()
      .from(schema.customerAddresses)
      .where(eq(schema.customerAddresses.customerId, id))
      .orderBy(desc(schema.customerAddresses.isDefaultShipping), schema.customerAddresses.id);

    // Le back-office voit aussi les paniers abandonnés : ils expliquent une
    // relance, et c'est justement le genre de chose qu'on veut retrouver ici.
    const commandes = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.customerId, id))
      .orderBy(desc(schema.orders.createdAt));
    const resume = await resumeCommandes(commandes.map((o) => o.id));
    const a = (await agregatsClients([id])).get(id) ?? AGREGAT_VIDE;

    return c.json({
      customer: { ...client, tags: client.tags ?? [] },
      adresses,
      commandes: commandes.map((o) => {
        const s = resume.get(o.id)!;
        return {
          id: o.id,
          number: o.number,
          createdAt: o.createdAt,
          totalCents: o.totalCents,
          articles: s.articles,
          statutFinancier: statutFinancier(o, s.rembourseCents),
          statutExpedition: statutExpedition(s.articles, s.expedies),
        };
      }),
      stats: {
        commandes: a.commandes,
        caCents: a.caCents,
        panierMoyenCents: a.commandes
          ? Math.round(a.caCents / a.commandes)
          : 0,
      },
    });
  });

  app.post("/admin/customers/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    const [avant] = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, id));
    if (!avant) return c.json({ error: "Client introuvable" }, 404);

    const maj: Partial<typeof schema.customers.$inferInsert> = {};
    // Prénom et nom séparés : `name` se recompose des deux, toujours de la
    // même façon. Envoyer `name` seul reste accepté pour les formulaires qui
    // ne connaissent pas encore la distinction.
    if (b.firstName !== undefined || b.lastName !== undefined) {
      const prenom =
        b.firstName !== undefined
          ? String(b.firstName).trim().slice(0, 80)
          : (avant.firstName ?? "");
      const nomFamille =
        b.lastName !== undefined
          ? String(b.lastName).trim().slice(0, 80)
          : (avant.lastName ?? "");
      maj.firstName = prenom || null;
      maj.lastName = nomFamille || null;
      maj.name = nomComplet(prenom, nomFamille, avant.name);
    } else if (b.name !== undefined) {
      maj.name = String(b.name).trim() || null;
    }
    if (b.phone !== undefined) maj.phone = String(b.phone).trim() || null;
    if (b.note !== undefined) maj.note = String(b.note).trim() || null;
    if (b.tags !== undefined) {
      const brutes: unknown[] = Array.isArray(b.tags) ? b.tags : [];
      // Dédoublonnage insensible à la casse, en gardant la première graphie :
      // « VIP » et « vip » sont la même étiquette, et rien ne justifierait de
      // les afficher côte à côte.
      const vues = new Set<string>();
      const propres: string[] = [];
      for (const t of brutes) {
        const e = etiquette(t);
        if (!e || vues.has(e.toLowerCase())) continue;
        vues.add(e.toLowerCase());
        propres.push(e);
      }
      maj.tags = propres;
    }
    if (b.acceptsMarketing !== undefined) {
      const veut = b.acceptsMarketing === true;
      maj.acceptsMarketing = veut;
      if (!veut) maj.marketingOptInAt = null;
      else if (!avant.acceptsMarketing) maj.marketingOptInAt = new Date();
    }
    if (b.email !== undefined) {
      const email = String(b.email).trim().toLowerCase();
      // L'index d'unicité ne couvre que les comptes : on renvoie un conflit
      // lisible plutôt que de laisser remonter une erreur Postgres brute.
      const [pris] = await db
        .select({ id: schema.customers.id })
        .from(schema.customers)
        .where(
          and(
            memeEmail(email),
            isNotNull(schema.customers.passwordHash),
            ne(schema.customers.id, id),
          ),
        );
      if (pris)
        return c.json({ error: "Un compte utilise déjà cette adresse" }, 409);
      maj.email = email || null;
    }

    const [client] = await db
      .update(schema.customers)
      .set(maj)
      .where(eq(schema.customers.id, id))
      .returning({
        id: schema.customers.id,
        name: schema.customers.name,
        email: schema.customers.email,
        phone: schema.customers.phone,
        createdAt: schema.customers.createdAt,
        acceptsMarketing: schema.customers.acceptsMarketing,
        marketingOptInAt: schema.customers.marketingOptInAt,
        tags: schema.customers.tags,
        note: schema.customers.note,
        lastLoginAt: schema.customers.lastLoginAt,
        compte: raw<boolean>`(${schema.customers.passwordHash} is not null)`,
      });
    return c.json({ ...client!, tags: client!.tags ?? [] });
  });
}
