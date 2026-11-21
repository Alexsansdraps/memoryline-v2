/**
 * « Créer un fond » contre une VRAIE base (21/11) : ce qui ne se prouve pas
 * sans elle (A-FAIRE.md § 0.2, « Tests des fonds »).
 *
 *   MSYS_NO_PATHCONV=1 docker exec -e DATABASE_URL="postgres://…@db:5432/<base jetable>" \
 *     -w /app/apps/api memoryline-api npx tsx --test tests/fonds-ia-base.test.ts
 *
 * fonds-ia.test.ts et fonds-ia-plafond.test.ts vérifient sans base la
 * consigne, le fil, et l'ARITHMÉTIQUE du plafond. Restaient les requêtes et
 * le verrou :
 *   - la séparation des dépenses : une version de fond (fond_id renseigné)
 *     compte dans « fonds » et « tout », jamais dans « affiches » — sinon un
 *     lot de fonds couperait les clientes du stand ; une affiche, l'inverse ;
 *   - la réservation : le coût d'une version est écrit DÈS son lancement, et
 *     rendu (0) si le dessin échoue ;
 *   - le verrou : deux lancements simultanés, avec la place d'un seul sous le
 *     plafond, n'en laissent passer qu'UN ;
 *   - le plafond des fonds absent ou vidé au BO, LU EN BASE, vaut la moitié
 *     de celui des affiches.
 *
 * La fonction qui réserve (reserverVersions) n'est pas exportée, ni le verrou
 * ni le second regard sur le plafond : on passe par la plus proche qui l'est,
 * mountFondsIa — la vraie route POST /admin/fonds-ia/:id/messages, montée
 * sur une application d'essai, avec une propriétaire fictive. La route des
 * lots (POST /admin/fonds-ia/lots), qui RECOPIE ce verrou et cette
 * réservation, n'est pas couverte ici : à changer ensemble.
 *
 * AUCUN appel au modèle : un faux dessinateur est imposé
 * (remplacerDessinateur) avant chaque lancement. Il retient le dessin jusqu'à
 * ce que le test le libère, puis ÉCHOUE : rien n'est dessiné ni écrit, et la
 * route rend le coût réservé. La ligne « Fond IA … en échec : TEST-FONDS-BASE
 * … » dans la sortie est donc ATTENDUE. Par prudence, la clé OpenAI de ce
 * processus est remplacée par une clé FACTICE, et l'adresse du modèle par une
 * adresse injoignable, avant le premier import d'ia.ts.
 *
 * Ces tests touchent la BASE LOCALE, et elle seule. Leurs lignes portent la
 * marque « TEST-FONDS-BASE » et sont effacées à la fin, la version d'abord :
 * fond_id est « on delete set null », un fond effacé avant elle la laisserait
 * orpheline, et son coût compterait alors… dans les affiches. Hors de la base
 * du conteneur local (`@db:5432`), ils ne s'exécutent pas.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Hono } from "hono";
import type { SessionUser } from "../src/auth.js";
import type { Dessinateur } from "../src/fonds-ia.js";
import type { LecteurDepense } from "../src/ia.js";
import { CLE_PLAFOND_FONDS, TAILLE_FOND } from "../src/fonds-ia-consigne.js";

// Le service de base s'appelle « db » en production aussi, et l'image de
// production contient les tests : NODE_ENV=production les en écarte.
const baseLocale =
  /@db:5432\//.test(process.env.DATABASE_URL ?? "") && process.env.NODE_ENV !== "production";

after(async () => {
  if (!baseLocale) return;
  const { sql } = await import("../src/db/client.js");
  await sql.end({ timeout: 5 });
});

// Avant le premier import d'ia.ts, qui lit la clé à son chargement. Sans clé,
// la route refuse tout lancement (« IA non configurée ») et le plafond n'est
// jamais regardé : on en pose une, FACTICE. Et une adresse injoignable : même
// un dessin parti par erreur vers le vrai dessinateur ne quitterait pas la
// machine, et ne coûterait rien.
if (baseLocale) {
  process.env.OPENAI_API_KEY = "sk-TEST-FONDS-BASE-factice";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:9/v1";
  // Le bouchon (faux dessin GRATUIT) ne passe pas par le plafond : il
  // fausserait tout ce qu'on vérifie ici.
  delete process.env.IA_FONDS_BOUCHON;
}

const MARQUE = "TEST-FONDS-BASE";
/** Le verrou du plafond des fonds, tel que fonds-ia.ts le prend (verrouillerLePlafond). */
const CLE_DU_VERROU = "plafond-fonds-ia";

const suffixe = () => `${Date.now()}-${randomBytes(3).toString("hex")}`;

/** Les modules qui ouvrent la base : chargés seulement sur la base locale. */
async function charger() {
  const { db, sql, schema } = await import("../src/db/client.js");
  const { and, asc, eq, like, or } = await import("drizzle-orm");
  const ia = await import("../src/ia.js");
  const fonds = await import("../src/fonds-ia.js");
  return { db, sql, schema, and, asc, eq, like, or, ia, fonds };
}
type Modules = Awaited<ReturnType<typeof charger>>;

/** La propriétaire fictive : les routes des fonds lui sont réservées. */
const PROPRIETAIRE: SessionUser = {
  sessionId: "essai",
  adminUserId: 1,
  email: "test-fonds-base@example.invalid",
  role: "owner",
  standIds: [],
};

function application(mountFondsIa: (app: Hono) => void): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("utilisateur", PROPRIETAIRE);
    await next();
  });
  mountFondsIa(app);
  return app;
}

/** Ce que l'écran des fonds reçoit, réduit à ce que ces tests lisent. */
interface Catalogue {
  configuree: boolean;
  bouchon: boolean;
  reglages: { coutParVersionCents: number };
  plafondFonds: {
    plafondCents: number;
    parDefaut: boolean;
    reglageCents: number | null;
    defautCents: number;
    plafondAffichesCents: number;
  };
}

async function catalogue(app: Hono): Promise<Catalogue> {
  const res = await app.request("/admin/fonds-ia/catalogue");
  assert.equal(res.status, 200, "le catalogue de l'écran des fonds répond");
  return (await res.json()) as Catalogue;
}

/** Un message « Recommencer de zéro », une version : ce que la page envoie. */
async function lancer(app: Hono, fondId: number, jeton: string): Promise<Response> {
  return app.request(`/admin/fonds-ia/${fondId}/messages`, {
    method: "POST",
    // L'adresse de la demande devient la colonne `ip` de la version : la
    // marque y est, même sur les lignes que la route écrit elle-même.
    headers: { "Content-Type": "application/json", "X-Forwarded-For": MARQUE },
    body: JSON.stringify({ jeton, depuisZero: true, versions: 1 }),
  });
}

/**
 * Le faux dessinateur. Tant qu'il retient le dessin, la version reste
 * « en_cours », son coût réservé : c'est ce qu'on observe. Libéré, il échoue ;
 * la route passe alors la version en échec et rend le coût. Il n'écrit rien,
 * et n'appelle rien.
 */
function dessinateurRetenu() {
  let liberer!: () => void;
  const porte = new Promise<void>((r) => (liberer = r));
  let appels = 0;
  const dessinateur: Dessinateur = async () => {
    appels++;
    await porte;
    throw new Error(`${MARQUE} : dessin arrêté par le test, rien n'a été dessiné`);
  };
  return { dessinateur, liberer, appels: () => appels };
}

async function attendre(quoi: string, condition: () => Promise<boolean>, delaiMs = 15_000) {
  const limite = Date.now() + delaiMs;
  while (!(await condition())) {
    if (Date.now() > limite) assert.fail(`attendu en vain : ${quoi}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

interface FondDEssai {
  id: number;
  chemin: string;
}

/**
 * Un fond fictif, prêt à recevoir des messages : sa ligne `fond_ia`, et la
 * photo du lieu sur le disque (data/assets/ia/fonds, le dossier que lit
 * fonds-ia.ts). Le faux dessinateur ne la regarde pas ; mais sans elle, la
 * route passerait le dessin en échec aussitôt, coût rendu avant qu'on ait pu
 * le voir réservé — et avant que le second lancement relise la dépense.
 */
async function creerFond(m: Modules, titre: string): Promise<FondDEssai> {
  const s = suffixe();
  const photo = `${MARQUE.toLowerCase()}-${s}.jpg`;
  const chemin = resolve(m.ia.IA_DIR, "fonds", photo);
  await writeFile(chemin, `${MARQUE} : photo factice, jamais dessinée`);
  try {
    const [fond] = await m.db
      .insert(m.schema.fondsIa)
      .values({
        jeton: `${MARQUE}-${s}`,
        lot: `${MARQUE}-${s}`,
        creePar: PROPRIETAIRE.email,
        nom: `${MARQUE} ${titre}`,
        photos: [`ia/fonds/${photo}`],
        exemples: [],
        styleId: null,
        versions: 1,
      })
      .returning({ id: m.schema.fondsIa.id });
    assert.ok(fond);
    return { id: fond.id, chemin };
  } catch (e) {
    await rm(chemin, { force: true });
    throw e;
  }
}

/**
 * Efface un fond d'essai dans l'ordre des clés étrangères : ses versions
 * (ai_generation.fond_id), ses messages, le fond, puis sa photo. Les versions
 * D'ABORD : effacé en premier, le fond les laisserait orphelines, comptées
 * ensuite dans les affiches.
 */
async function effacerFond(m: Modules, fond: FondDEssai | null): Promise<void> {
  if (!fond) return;
  const { db, schema, eq, or } = m;
  await db
    .delete(schema.aiGenerations)
    .where(or(eq(schema.aiGenerations.fondId, fond.id), eq(schema.aiGenerations.ip, MARQUE)));
  await db.delete(schema.fondsIaMessages).where(eq(schema.fondsIaMessages.fondId, fond.id));
  await db.delete(schema.fondsIa).where(eq(schema.fondsIa.id, fond.id));
  await rm(fond.chemin, { force: true });
}

/** Les versions d'un fond, de la plus ancienne à la plus récente. */
async function versionsDuFond(m: Modules, fondId: number) {
  const g = m.schema.aiGenerations;
  return m.db
    .select({
      statut: g.status,
      cout: g.costCents,
      messageId: g.fondMessageId,
      ip: g.ip,
      erreur: g.erreur,
    })
    .from(g)
    .where(m.eq(g.fondId, fondId))
    .orderBy(m.asc(g.id));
}

/**
 * Libère le dessin retenu, attend que la route l'ait soldé (plus aucune
 * version « en_cours »), puis rend la main au dessinateur normal. Jamais
 * avant : un dessin qui n'aurait pas encore atteint le faux dessinateur
 * partirait vers le vrai — sans danger ici (clé factice, adresse injoignable),
 * mais pas proprement.
 */
async function solderLeDessin(
  m: Modules,
  retenu: ReturnType<typeof dessinateurRetenu>,
  fond: FondDEssai | null,
): Promise<void> {
  retenu.liberer();
  if (fond)
    await attendre("le dessin retenu se termine", async () =>
      (await versionsDuFond(m, fond.id)).every((v) => v.statut !== "en_cours"),
    ).catch(() => undefined);
  m.fonds.remplacerDessinateur(null);
}

interface Releve {
  affiches: number;
  fonds: number;
  tout: number;
}

async function releve(m: Modules, lecteur?: LecteurDepense): Promise<Releve> {
  return {
    affiches: await m.ia.depenseDuMoisCents("affiches", lecteur),
    fonds: await m.ia.depenseDuMoisCents("fonds", lecteur),
    tout: await m.ia.depenseDuMoisCents("tout", lecteur),
  };
}

const ecart = (avant: Releve, apres: Releve): Releve => ({
  affiches: apres.affiches - avant.affiches,
  fonds: apres.fonds - avant.fonds,
  tout: apres.tout - avant.tout,
});

/**
 * Prend le verrou du plafond des fonds DANS UNE TRANSACTION À NOUS, et le
 * garde jusqu'à `liberer()`. Les deux lancements passent leur premier regard
 * (sans verrou), puis s'arrêtent l'un et l'autre devant lui : quand on le
 * lâche, ils ont lu la même dépense, et aucun n'a encore rien réservé.
 */
function tenirLeVerrou(sql: Modules["sql"]) {
  let liberer!: () => void;
  const porte = new Promise<void>((r) => (liberer = r));
  let signaler!: () => void;
  const pris = new Promise<void>((r) => (signaler = r));
  let pid = 0;
  const fini = sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${CLE_DU_VERROU}))`;
    const [moi] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
    pid = moi?.pid ?? 0;
    signaler();
    await porte;
  });
  // Une erreur avant la prise du verrou ne doit pas laisser le test attendre.
  const tenu = Promise.race([
    pris,
    fini.then(() => {
      throw new Error("verrou rendu avant d'avoir été tenu");
    }),
  ]);
  return { tenu, fini, liberer, pid: () => pid };
}

/** Combien de connexions DIFFÉRENTES attendent le verrou que tient `pid`. */
async function attentesSurLeVerrou(sql: Modules["sql"], pid: number): Promise<number> {
  const [l] = await sql<{ n: number }[]>`
    select count(distinct attente.pid)::int as n
    from pg_locks attente
    join pg_locks tenu
      on tenu.locktype = 'advisory' and tenu.granted and tenu.pid = ${pid}::int
     and tenu.database = attente.database
     and tenu.classid = attente.classid
     and tenu.objid = attente.objid
     and tenu.objsubid = attente.objsubid
    where attente.locktype = 'advisory' and not attente.granted`;
  return l?.n ?? 0;
}

/* ------------------------------------------------------------------------ */
/*  La séparation des dépenses                                               */
/* ------------------------------------------------------------------------ */

test(
  "séparation des dépenses : une version de fond compte dans « fonds » et « tout », jamais dans « affiches » ; une affiche, l'inverse",
  { skip: !baseLocale && "hors de la base locale du conteneur" },
  async () => {
    const m = await charger();
    const { db, schema, eq, like } = m;
    const s = suffixe();
    // Des montants qu'aucune autre ligne ne fait par hasard : une confusion
    // entre les deux périmètres se lirait aussitôt.
    const COUT_FOND = 1234;
    const COUT_AFFICHE = 567;
    class Annulee extends Error {}
    // Tout se passe dans UNE transaction en lecture répétable, annulée à la
    // fin : les écarts avant / après ne voient que nos deux lignes, même si
    // un autre essai écrit dans ai_generation au même moment — et la base
    // peut contenir d'autres lignes, d'où des ÉCARTS, pas des totaux.
    try {
      await db.transaction(
        async (tx) => {
          const avant = await releve(m, tx);
          const [fond] = await tx
            .insert(schema.fondsIa)
            .values({
              jeton: `${MARQUE}-${s}`,
              lot: `${MARQUE}-${s}`,
              creePar: PROPRIETAIRE.email,
              nom: `${MARQUE} séparation`,
              photos: [],
              versions: 1,
            })
            .returning({ id: schema.fondsIa.id });
          assert.ok(fond);
          await tx.insert(schema.aiGenerations).values([
            {
              publicId: `${MARQUE}-${s}-version-de-fond`,
              fondId: fond.id,
              status: "prete",
              costCents: COUT_FOND,
              model: "essai",
              size: TAILLE_FOND,
              ip: MARQUE,
              prompt: `${MARQUE} : une version de fond`,
            },
            {
              publicId: `${MARQUE}-${s}-affiche`,
              fondId: null,
              status: "prete",
              costCents: COUT_AFFICHE,
              model: "essai",
              size: "1584x2240",
              ip: MARQUE,
              prompt: `${MARQUE} : une affiche de cliente`,
            },
          ]);
          // /ia/generer refuse une affiche sur depenseDuMoisCents("affiches") :
          // c'est elle qu'on lit, sans appeler la route (elle lancerait une
          // vraie génération).
          assert.deepEqual(ecart(avant, await releve(m, tx)), {
            affiches: COUT_AFFICHE,
            fonds: COUT_FOND,
            tout: COUT_FOND + COUT_AFFICHE,
          });
          throw new Annulee();
        },
        { isolationLevel: "repeatable read" },
      );
    } catch (e) {
      if (!(e instanceof Annulee)) throw e;
    } finally {
      // Annulée, la transaction n'a rien laissé. Le filet, quand même.
      await db
        .delete(schema.aiGenerations)
        .where(like(schema.aiGenerations.publicId, `${MARQUE}-${s}-%`));
      await db.delete(schema.fondsIa).where(eq(schema.fondsIa.lot, `${MARQUE}-${s}`));
    }
  },
);

/* ------------------------------------------------------------------------ */
/*  La réservation, par la vraie route                                       */
/* ------------------------------------------------------------------------ */

test(
  "le coût d'une version est réservé dès son lancement, compté dans les fonds seulement, et rendu si le dessin échoue",
  { skip: !baseLocale && "hors de la base locale du conteneur" },
  async (t) => {
    const m = await charger();
    const app = application(m.fonds.mountFondsIa);
    const retenu = dessinateurRetenu();
    m.fonds.remplacerDessinateur(retenu.dessinateur);
    let fond: FondDEssai | null = null;
    try {
      const cat = await catalogue(app);
      assert.equal(cat.configuree, true, "la clé factice est posée avant l'import d'ia.ts");
      if (cat.bouchon) {
        t.skip("le bouchon est branché par un réglage de cette base : rien ne se réserve");
        return;
      }
      const cout = cat.reglages.coutParVersionCents;
      if (cout <= 0) {
        t.skip("coût par version réglé à 0 sur cette base : rien à réserver");
        return;
      }
      fond = await creerFond(m, "réservation");
      const avant = await releve(m);

      const res = await lancer(app, fond.id, `${MARQUE}-${suffixe()}`);
      assert.equal(res.status, 200, await res.clone().text());
      const { messageId } = (await res.json()) as { messageId: number };

      // La réponse est là ; le dessin, lui, est retenu. La version existe
      // déjà, « en_cours », et porte DÉJÀ son coût : c'est ce qu'un second
      // lancement relira sous le verrou.
      const lancees = await versionsDuFond(m, fond.id);
      assert.equal(lancees.length, 1, "une version demandée, une ligne");
      assert.deepEqual(
        { statut: lancees[0]?.statut, cout: lancees[0]?.cout, messageId: lancees[0]?.messageId },
        { statut: "en_cours", cout, messageId },
      );
      assert.equal(lancees[0]?.ip, MARQUE);
      // Réservée, elle pèse sur le plafond des fonds — et pas d'un centime
      // sur celui des affiches des clientes.
      assert.deepEqual(ecart(avant, await releve(m)), { affiches: 0, fonds: cout, tout: cout });

      // Le dessin échoue : la version passe en échec, son coût revient à 0.
      retenu.liberer();
      await attendre("la version retenue passe en échec", async () =>
        (await versionsDuFond(m, fond!.id)).every((v) => v.statut !== "en_cours"),
      );
      assert.equal(retenu.appels(), 1, "le dessin a bien atteint le dessinateur");
      const [soldee] = await versionsDuFond(m, fond.id);
      assert.equal(soldee?.statut, "echec");
      assert.equal(soldee?.cout, 0, "un dessin raté n'est pas payé : le coût réservé est rendu");
      assert.match(soldee?.erreur ?? "", /TEST-FONDS-BASE/);
      assert.deepEqual(ecart(avant, await releve(m)), { affiches: 0, fonds: 0, tout: 0 });
    } finally {
      await solderLeDessin(m, retenu, fond);
      await effacerFond(m, fond);
    }
  },
);

/* ------------------------------------------------------------------------ */
/*  Le verrou : deux lancements au même instant                              */
/* ------------------------------------------------------------------------ */

test(
  "deux lancements simultanés, place pour un seul sous le plafond : le verrou n'en laisse passer qu'UN",
  { skip: !baseLocale && "hors de la base locale du conteneur" },
  async (t) => {
    const m = await charger();
    const { db, schema, eq } = m;
    const app = application(m.fonds.mountFondsIa);
    const retenu = dessinateurRetenu();
    m.fonds.remplacerDessinateur(retenu.dessinateur);
    let fond: FondDEssai | null = null;
    let verrou: ReturnType<typeof tenirLeVerrou> | null = null;
    // Gardées hors du try : le nettoyage les attend (relecture du 21/11).
    // Une demande encore en attente du verrou écrirait sinon sa réservation
    // APRÈS l'effacement des lignes, et laisserait une version orpheline.
    let reponses: Promise<Response[]> | null = null;
    try {
      const cat = await catalogue(app);
      assert.equal(cat.configuree, true, "la clé factice est posée avant l'import d'ia.ts");
      if (cat.bouchon) {
        t.skip("le bouchon est branché par un réglage de cette base : pas de plafond à tenir");
        return;
      }
      const cout = cat.reglages.coutParVersionCents;
      const plafond = cat.plafondFonds.plafondCents;
      const depense = await m.ia.depenseDuMoisCents("fonds");
      // Le plafond n'est pas touché : on amène la dépense juste en dessous,
      // par une version déjà « dessinée » de ce fond. Il reste alors de quoi
      // payer une version et demie : une passe, deux non. Les montants se
      // calent sur les réglages de la base, quels qu'ils soient.
      const comblement = plafond - depense - cout - Math.floor(cout / 2);
      if (cout <= 0 || comblement < 0) {
        t.skip(
          `pas la place d'une version sous le plafond des fonds de cette base ` +
            `(plafond ${plafond} c, dépense ${depense} c, version ${cout} c)`,
        );
        return;
      }
      fond = await creerFond(m, "verrou");
      await db.insert(schema.aiGenerations).values({
        publicId: `${MARQUE}-${suffixe()}-comblement`,
        fondId: fond.id,
        // « prete », pas « en_cours » : une ligne en cours qu'aucun dessin
        // de ce processus ne porte serait soldée (coût 0) au premier regard.
        status: "prete",
        costCents: comblement,
        model: "essai",
        size: TAILLE_FOND,
        ip: MARQUE,
        prompt: `${MARQUE} : comblement jusqu'au plafond`,
      });
      // Et une affiche de cliente (fond_id nul) qui coûte à elle seule tout le
      // plafond des fonds (relecture du 21/11) : la route doit compter la
      // dépense des FONDS. Si elle comptait « tout », les deux lancements
      // seraient refusés d'emblée, et le test le dirait. effacerFond l'efface
      // (même marque).
      await db.insert(schema.aiGenerations).values({
        publicId: `${MARQUE}-${suffixe()}-affiche`,
        status: "prete",
        costCents: plafond,
        model: "essai",
        size: TAILLE_FOND,
        ip: MARQUE,
        prompt: `${MARQUE} : affiche d'une cliente, hors des fonds`,
      });

      // Le verrou d'abord, à nous ; puis les deux lancements, au même instant.
      verrou = tenirLeVerrou(m.sql);
      await verrou.tenu;
      const fondId = fond.id;
      const lancements = Promise.all(
        ["a", "b"].map((x) => lancer(app, fondId, `${MARQUE}-${suffixe()}-${x}`)),
      );
      reponses = lancements;
      // Jugées plus bas : pas de rejet « non traité » pendant l'attente.
      lancements.catch(() => undefined);
      // Tous deux ont passé le premier regard (sans verrou) — sinon ils
      // auraient répondu sans l'attendre — et attendent le verrou, chacun
      // sur SA connexion : le verrou les fera passer l'un après l'autre. Que
      // la réservation soit bien écrite SOUS lui se vérifie plus bas (même
      // transaction que le message).
      await attendre("les deux lancements attendent le verrou du plafond", async () =>
        (await attentesSurLeVerrou(m.sql, verrou!.pid())) === 2,
      );
      verrou.liberer();
      await verrou.fini;

      const issues = await Promise.all(
        (await lancements).map(async (r) => ({
          statut: r.status,
          corps: (await r.json()) as { messageId?: number; error?: string },
        })),
      );
      assert.deepEqual(
        issues.map((i) => i.statut).sort(),
        [200, 409],
        `un seul passe : ${JSON.stringify(issues)}`,
      );
      const gagnant = issues.find((i) => i.statut === 200);
      const perdant = issues.find((i) => i.statut === 409);
      assert.match(perdant?.corps.error ?? "", /dépasserait le plafond des fonds/);

      // Une seule version réservée, celle du gagnant, son coût porté.
      const lancees = (await versionsDuFond(m, fond.id)).filter((v) => v.messageId !== null);
      assert.equal(lancees.length, 1, "une seule version réservée");
      assert.deepEqual(
        { statut: lancees[0]?.statut, cout: lancees[0]?.cout, messageId: lancees[0]?.messageId },
        { statut: "en_cours", cout, messageId: gagnant?.corps.messageId },
      );
      // Réservée DANS la transaction de son message, celle qui a pris le
      // verrou (relecture du 21/11) : les deux lignes prennent now() par
      // défaut, l'heure de DÉBUT de la transaction. Une réservation écrite
      // après le COMMIT, hors du verrou, aurait une autre heure — et ce test
      // le voyait mal sans cela, au gré du minutage.
      const [meme] = await m.sql<{ ok: boolean }[]>`
        select g.created_at = msg.cree_le as ok
        from ai_generation g join fond_ia_message msg on msg.id = g.fond_message_id
        where msg.id = ${gagnant?.corps.messageId ?? 0}::int`;
      assert.equal(meme?.ok, true, "réservée dans la transaction du message, sous le verrou");
      // Le refusé n'a rien écrit : ni message, ni version.
      const messages = await db
        .select({ id: schema.fondsIaMessages.id })
        .from(schema.fondsIaMessages)
        .where(eq(schema.fondsIaMessages.fondId, fond.id));
      assert.deepEqual(
        messages.map((x) => x.id),
        [gagnant?.corps.messageId],
      );
      // La dépense des fonds : une version de plus, et toujours sous le plafond.
      const apres = await m.ia.depenseDuMoisCents("fonds");
      assert.equal(apres - depense, comblement + cout);
      assert.ok(apres <= plafond, `${apres} c dépensés pour un plafond de ${plafond} c`);
    } finally {
      // Dans cet ordre : le verrou (les lancements attendent), le dessin
      // retenu (il porte la version réservée), puis les lignes.
      verrou?.liberer();
      await verrou?.fini.catch(() => undefined);
      // Plus aucune réservation ne peut arriver après le nettoyage.
      await reponses?.catch(() => undefined);
      await solderLeDessin(m, retenu, fond);
      await effacerFond(m, fond);
    }
  },
);

/* ------------------------------------------------------------------------ */
/*  Le plafond des fonds vide                                                */
/* ------------------------------------------------------------------------ */

test(
  "le plafond des fonds absent ou vidé au BO, lu en base, vaut la moitié de celui des affiches",
  { skip: !baseLocale && "hors de la base locale du conteneur" },
  async (t) => {
    const m = await charger();
    const { db, schema, and, eq, like } = m;
    const app = application(m.fonds.mountFondsIa);
    // Un réglage posé n'est pas touché : le cas « vide » ne se vérifie alors
    // pas ici (la règle seule l'est sans base, fonds-ia-plafond.test.ts).
    const [existant] = await db
      .select({ key: schema.settings.key })
      .from(schema.settings)
      .where(eq(schema.settings.key, CLE_PLAFOND_FONDS));
    if (existant) {
      t.skip(`« ${CLE_PLAFOND_FONDS} » est réglé sur cette base : on n'y touche pas`);
      return;
    }
    let pose = false;
    try {
      const affiches = (await m.ia.reglages())["ia.plafondMensuelCents"];
      const moitie = Math.round(affiches / 2);
      const verifier = async (cas: string) => {
        // Ce que lisent l'écran des fonds ET les lancements (reglagesFonds)…
        const { plafondFonds: p } = await catalogue(app);
        assert.deepEqual(
          {
            plafondCents: p.plafondCents,
            parDefaut: p.parDefaut,
            reglageCents: p.reglageCents,
            plafondAffichesCents: p.plafondAffichesCents,
          },
          { plafondCents: moitie, parDefaut: true, reglageCents: null, plafondAffichesCents: affiches },
          cas,
        );
        // … et l'écran des affiches IA (plafondDesFondsDuMois).
        const lu = await m.ia.plafondDesFondsDuMois(affiches);
        assert.deepEqual({ cents: lu.cents, parDefaut: lu.parDefaut }, { cents: moitie, parDefaut: true }, cas);
      };
      await verifier("réglage absent");
      // Vidé au BO, le champ s'enregistre en chaîne vide (fonds.astro) : la
      // ligne existe, sa valeur ne dit rien. Même effet qu'absent — c'est
      // pourquoi la poser un instant ne change rien pour personne.
      await db.insert(schema.settings).values({
        key: CLE_PLAFOND_FONDS,
        value: "",
        label: `${MARQUE} : réglage vidé le temps du test`,
      });
      pose = true;
      await verifier("réglage vidé au BO");
    } finally {
      // Remis exactement comme avant : absent.
      if (pose)
        await db
          .delete(schema.settings)
          .where(
            and(
              eq(schema.settings.key, CLE_PLAFOND_FONDS),
              like(schema.settings.label, `${MARQUE}%`),
            ),
          );
    }
  },
);
