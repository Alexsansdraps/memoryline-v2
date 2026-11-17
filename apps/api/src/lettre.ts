/**
 * La lettre d'information : l'écrire, savoir qui la recevra, et l'envoyer.
 *
 * La boutique savait recueillir des adresses et rien d'autre. Ce fichier
 * apporte ce qui manquait entre les deux : une lettre qui se rédige, une liste
 * de destinataires qui se compte AVANT de partir, un envoi qui se déroule par
 * petits paquets, et le lien de désabonnement sans lequel rien ne devrait
 * partir.
 *
 * Trois convictions le gouvernent, dans cet ordre.
 *
 * 1. Personne ne reçoit deux fois la même lettre. Une ligne par destinataire
 *    et par lettre, avec un index unique (voir `lettreEnvois` dans le schéma) :
 *    c'est la base de données qui refuse le doublon, pas une précaution du
 *    code. Deux courriers identiques le même jour et l'adresse d'expédition
 *    de la boutique est grillée pour des mois.
 * 2. Un envoi qui traîne ne bloque personne. Chaque appel prend un paquet,
 *    l'envoie, rend la main et dit ce qu'il reste ; l'écran rappelle. Un envoi
 *    coupé en route se reprend là où il s'est arrêté, sans réécrire à ceux qui
 *    ont déjà reçu.
 * 3. On n'écrit qu'à ceux qui l'ont demandé : les inscrits à la lettre, et les
 *    clients qui ont explicitement accepté d'être contactés. Personne d'autre,
 *    jamais, et le lien de désabonnement fonctionne sans être connecté.
 *
 * Les modèles de courrier de la boutique vivent dans mail.ts. Celui de la
 * lettre est écrit ICI : mail.ts porte les six courriers de la vente, dont
 * dépendent le paiement et l'expédition, et la lettre d'information n'a rien
 * à y faire. Seul l'envoi lui est emprunté.
 */
import type { Hono } from "hono";
import { and, asc, desc, eq, inArray, isNotNull, sql as sqlOp } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db, schema } from "./db/client.js";
import { supprimerPourToujours } from "./suppression.js";
import { envoyer, estConfigure, estEnEssai } from "./mail.js";

/* -------------------------------------------------------------------------- */
/*  Réglages                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Combien de courriers part par appel.
 *
 * Assez pour que l'envoi avance vite, assez peu pour que la requête réponde
 * en quelques secondes : au-delà, le navigateur, le proxy ou l'hébergeur
 * coupent la connexion en plein envoi, et on ne sait plus ce qui est parti.
 */
const PAQUET = 25;

/**
 * Au-delà de ce délai, un destinataire encore « en cours » est un envoi
 * abandonné, pas un envoi qui travaille.
 *
 * Les deux se ressemblent en base et ne veulent pas dire la même chose. Tant
 * que le délai n'est pas écoulé, un autre paquet est probablement en train de
 * s'en occuper : le compter comme un échec ferait annoncer « 29 courriers ne
 * sont pas partis » pendant qu'ils partent. Passé ce délai, plus personne ne
 * s'en occupe : c'est un échec, et il ne doit pas empêcher la lettre de se
 * terminer. On ne le réessaie pas pour autant, faute de savoir si le courrier
 * était parti au moment de la coupure.
 */
const DELAI_ABANDON = "5 minutes";

/**
 * Où mène le lien de désabonnement, vu du courrier d'un destinataire.
 *
 * Le préfixe « /api » n'est pas un détail : le point d'entrée public est le
 * proxy (cf. Caddyfile), qui envoie « /api/* » vers cette API. Sans lui, le
 * lien tomberait sur le site public, qui n'a pas cette page.
 */
const ORIGINE_PUBLIQUE =
  (process.env.PUBLIC_ORIGIN ?? "").replace(/\/+$/, "") || "http://localhost:8080";
const LIEN_DESABONNEMENT = `${ORIGINE_PUBLIQUE}/api/lettre/desabonnement`;

/** Ce qu'on répond quand aucun moyen d'envoi n'est configuré. */
const RIEN_POUR_ENVOYER =
  "L'envoi de courrier n'est pas configuré : rien ne peut partir pour le moment. " +
  "Prévenez la personne qui s'occupe du site, il manque le service d'envoi.";

/* -------------------------------------------------------------------------- */
/*  États                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * L'état d'une lettre.
 *
 * « en_cours » sépare le brouillon de la lettre partie pendant que les paquets
 * s'enchaînent. Sans lui, une lettre à moitié envoyée resterait un brouillon,
 * donc modifiable et supprimable au milieu de son propre envoi.
 */
type EtatLettre = "brouillon" | "en_cours" | "envoyee";

/** L'état d'un destinataire pour UNE lettre. */
type ResultatEnvoi = "en_attente" | "en_cours" | "reussi" | "echec";

/** Ce qu'on inscrit en face d'un destinataire une fois le courrier remis. */
function resultatDe(parti: boolean): ResultatEnvoi {
  return parti ? "reussi" : "echec";
}

const LIBELLE_ETAT: Record<EtatLettre, string> = {
  brouillon: "Brouillon",
  en_cours: "Envoi en cours",
  envoyee: "Envoyée",
};

function estEtatLettre(v: string): v is EtatLettre {
  return v === "brouillon" || v === "en_cours" || v === "envoyee";
}

/** L'état lu en base, ramené aux trois valeurs connues. */
function etatDe(brut: string): EtatLettre {
  return estEtatLettre(brut) ? brut : "brouillon";
}

/* -------------------------------------------------------------------------- */
/*  Petits outils                                                             */
/* -------------------------------------------------------------------------- */

/** Échappe le texte inséré dans du HTML. */
function h(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Un identifiant de l'adresse, ou rien.
 *
 * `Number("")` vaut zéro, et zéro est un identifiant qui a l'air valable :
 * une adresse mal formée irait chercher — ou supprimer — la ligne « 0 ». On
 * exige donc des chiffres, et rien d'autre.
 */
function identifiant(brut: string | undefined): number | null {
  const v = (brut ?? "").trim();
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Une adresse e-mail plausible, normalisée pour la comparaison. */
function adresseNormalisee(brut: unknown): string | null {
  const v = String(brut ?? "").trim().toLowerCase();
  if (!v || v.length > 200) return null;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : null;
}

/** Le texte d'un champ du formulaire, borné, sans espaces inutiles. */
function texte(brut: unknown, maximum: number): string {
  return String(brut ?? "").trim().slice(0, maximum);
}

/**
 * Le contenu écrit dans le back-office, débarrassé de ce qui n'a rien à faire
 * dans un courrier.
 *
 * L'éditeur du back-office fait déjà ce tri dans le navigateur, mais il le
 * fait pour l'affichage : ce qui arrive ici a pu passer par un autre chemin,
 * et un courrier ne se relit pas une fois parti. On retire donc ce qui
 * s'exécute (scripts, gestionnaires d'événements, liens « javascript: ») et
 * ce que les messageries mettent de toute façon à la poubelle.
 */
function nettoyerContenu(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*\/?\s*(script|style|iframe|object|embed)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "")
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, "$1=$2#$2")
    .trim();
}

/**
 * La version texte du courrier.
 *
 * Elle n'est pas décorative : une messagerie qui n'affiche que le texte
 * montrerait sinon une page blanche, et un courrier sans version texte est un
 * signal de courrier indésirable pour à peu près tous les filtres.
 */
function versTexte(html: string): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "- ")
    .replace(/<\s*\/\s*(p|li|ul|ol|div|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* -------------------------------------------------------------------------- */
/*  Le courrier lui-même                                                      */
/* -------------------------------------------------------------------------- */

/**
 * La lettre telle qu'elle arrive dans une boîte aux lettres.
 *
 * Mise en page en tableau et styles écrits sur chaque balise : les messageries
 * ne savent toujours pas faire autrement, et une feuille de style externe est
 * ignorée par la plupart d'entre elles.
 */
function rendreLettre(
  objet: string,
  contenuHtml: string,
  lienDesabonnement: string,
): { subject: string; html: string; text: string } {
  const contenu = nettoyerContenu(contenuHtml);
  const html = `<!doctype html>
<html lang="fr"><body style="margin:0;background:#f3f3f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#121212">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f3f3;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff">
        <tr><td style="padding:28px 32px 8px">
          <div style="font-size:20px;letter-spacing:.6px">Memory Line</div>
        </td></tr>
        <tr><td style="padding:0 32px 8px">
          <h1 style="font-size:22px;font-weight:400;letter-spacing:.6px;margin:12px 0">${h(objet)}</h1>
        </td></tr>
        <tr><td style="padding:0 32px 32px;font-size:15px;line-height:1.6">${contenu}</td></tr>
        <tr><td style="padding:16px 32px;background:#f3f3f3;font-size:12px;color:#5b5b54">
          Vous recevez cette newsletter parce que vous vous êtes inscrit sur memoryline.fr
          ou que vous avez accepté d'être tenu au courant lors d'une commande.<br />
          <a href="${h(lienDesabonnement)}" style="color:#5b5b54">Me désabonner de la newsletter</a><br /><br />
          Memory Line, affiches personnalisées.<br />
          TVA non applicable, article 293 B du CGI.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return {
    subject: objet,
    html,
    text:
      `${objet}\n\n${versTexte(contenu)}\n\n` +
      `-- \nVous recevez cette newsletter parce que vous vous êtes inscrit sur memoryline.fr.\n` +
      `Pour vous désabonner : ${lienDesabonnement}\n\nMemory Line`,
  };
}

/* -------------------------------------------------------------------------- */
/*  Les destinataires                                                         */
/* -------------------------------------------------------------------------- */

interface CompteDestinataires {
  total: number;
  inscrits: number;
  clients: number;
  /** Adresses présentes dans les deux listes, comptées une seule fois. */
  communs: number;
}

/**
 * Toutes les adresses à qui la boutique a le droit d'écrire.
 *
 * Deux gisements, et deux seulement : ceux qui se sont inscrits au formulaire
 * de la lettre, et les clients qui ont coché « tenez-moi au courant ». Un
 * client qui a simplement commandé n'en fait PAS partie : avoir acheté n'est
 * pas avoir accepté d'être démarché.
 *
 * Le tri alphabétique n'est pas cosmétique : l'ordre doit être le même d'un
 * paquet à l'autre pour qu'un envoi repris reste prévisible.
 */
async function listeDestinataires(): Promise<string[]> {
  const inscrits = await db
    .select({ email: schema.newsletterSubscribers.email })
    .from(schema.newsletterSubscribers);
  const clients = await db
    .select({ email: schema.customers.email })
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.acceptsMarketing, true),
        isNotNull(schema.customers.email),
      ),
    );

  // Un même client peut s'être inscrit ET avoir coché la case : sans ce
  // dédoublonnage, il recevrait deux fois le même courrier.
  const adresses = new Set<string>();
  for (const l of [...inscrits, ...clients]) {
    const adresse = adresseNormalisee(l.email);
    if (adresse) adresses.add(adresse);
  }
  return [...adresses].sort((a, b) => a.localeCompare(b, "fr"));
}

/** Le même décompte, détaillé, pour l'annoncer avant l'envoi. */
async function compterDestinataires(): Promise<CompteDestinataires> {
  const inscrits = await db
    .select({ email: schema.newsletterSubscribers.email })
    .from(schema.newsletterSubscribers);
  const clients = await db
    .select({ email: schema.customers.email })
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.acceptsMarketing, true),
        isNotNull(schema.customers.email),
      ),
    );

  const desInscrits = new Set<string>();
  for (const l of inscrits) {
    const adresse = adresseNormalisee(l.email);
    if (adresse) desInscrits.add(adresse);
  }
  const desClients = new Set<string>();
  for (const l of clients) {
    const adresse = adresseNormalisee(l.email);
    if (adresse) desClients.add(adresse);
  }
  let communs = 0;
  for (const adresse of desClients) if (desInscrits.has(adresse)) communs += 1;

  return {
    total: desInscrits.size + desClients.size - communs,
    inscrits: desInscrits.size,
    clients: desClients.size,
    communs,
  };
}

/* -------------------------------------------------------------------------- */
/*  Le désabonnement                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Le jeton de désabonnement d'une adresse, créé au besoin.
 *
 * Tiré au sort sur 24 octets : impossible à deviner, donc impossible de
 * désabonner quelqu'un d'autre. Il ne dit rien de la personne et n'ouvre
 * aucune session : il ne sait faire qu'une chose, sortir de la liste.
 *
 * La même adresse garde son jeton d'une lettre à l'autre. En changer casserait
 * le lien des lettres déjà parties, qui restent dans les boîtes pendant des
 * mois et dont c'est parfois la seule façon de se désinscrire.
 */
async function jetonPour(email: string): Promise<string> {
  const lignes = await db
    .insert(schema.lettreJetons)
    .values({ jeton: randomBytes(24).toString("base64url"), email })
    // L'adresse existe déjà : on la réécrit à l'identique, uniquement pour que
    // Postgres nous rende SA ligne, avec le jeton déjà attribué.
    .onConflictDoUpdate({ target: schema.lettreJetons.email, set: { email } })
    .returning({ jeton: schema.lettreJetons.jeton });
  const jeton = lignes[0]?.jeton;
  if (!jeton) throw new Error("jeton de désabonnement non créé");
  return jeton;
}

/**
 * Sort une adresse des deux listes.
 *
 * Les deux, sans exception : ne retirer que l'inscription laisserait la case
 * « accepte d'être contacté » de la fiche client cochée, et la personne
 * recevrait la lettre suivante malgré son désabonnement.
 */
async function desabonner(email: string): Promise<void> {
  await db
    .delete(schema.newsletterSubscribers)
    .where(eq(schema.newsletterSubscribers.email, email));
  await db
    .update(schema.customers)
    .set({ acceptsMarketing: false, marketingOptInAt: null })
    .where(sqlOp`lower(${schema.customers.email}) = ${email}`);
}

/** Page publique du désabonnement. Sobre, lisible, sans rien à comprendre. */
function pageDesabonnement(titre: string, corps: string): string {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${h(titre)} · Memory Line</title>
  <style>
    body { margin:0; background:#f3f3f3; color:#121212; min-height:100vh;
      display:flex; align-items:center; justify-content:center; padding:24px;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,system-ui,sans-serif; }
    main { background:#fff; max-width:520px; width:100%; padding:36px 32px; }
    h1 { font-size:22px; font-weight:400; letter-spacing:.6px; margin:0 0 16px; }
    p { font-size:15px; line-height:1.6; margin:0 0 12px; }
    .discret { color:#5b5b54; font-size:13px; }
    button { margin-top:12px; background:#121212; color:#fff; border:0;
      padding:14px 28px; font-size:15px; cursor:pointer; }
  </style>
</head>
<body><main><h1>${h(titre)}</h1>${corps}</main></body>
</html>`;
}

/* -------------------------------------------------------------------------- */
/*  Ce que l'écran reçoit                                                     */
/* -------------------------------------------------------------------------- */

interface LettreVue {
  id: number;
  titre: string;
  objet: string;
  contenuHtml: string;
  etat: EtatLettre;
  etatLibelle: string;
  /** Vrai tant que la lettre peut être modifiée. */
  modifiable: boolean;
  envoyeeLe: string | null;
  destinatairesPrevus: number;
  envoisReussis: number;
  echecs: number;
  restants: number;
  createdAt: string;
  /**
   * Non nul = archivée : elle quitte la liste ordinaire pour la section
   * « Lettres archivées », d'où elle se restaure. Rien n'est effacé.
   */
  archivedAt: string | null;
}

type LigneLettre = typeof schema.lettres.$inferSelect;

interface ComptesEnvoi {
  /** Destinataires que personne n'a encore pris. */
  enAttente: number;
  /** Destinataires qu'un paquet est en train de servir, à l'instant. */
  enCours: number;
  reussis: number;
  /** Refus du service d'envoi, et envois abandonnés depuis trop longtemps. */
  echecs: number;
}

/** Où en est l'envoi d'une lettre, destinataire par destinataire. */
async function comptesEnvoi(lettreId: number): Promise<ComptesEnvoi> {
  const abandonAvant = sqlOp.raw(`now() - interval '${DELAI_ABANDON}'`);
  const lignes = await db
    .select({
      enAttente: sqlOp<number>`count(*) filter (where ${schema.lettreEnvois.resultat} = 'en_attente')::int`,
      enCours: sqlOp<number>`count(*) filter (where ${schema.lettreEnvois.resultat} = 'en_cours' and ${schema.lettreEnvois.envoyeLe} > ${abandonAvant})::int`,
      reussis: sqlOp<number>`count(*) filter (where ${schema.lettreEnvois.resultat} = 'reussi')::int`,
      echecs: sqlOp<number>`count(*) filter (where ${schema.lettreEnvois.resultat} = 'echec' or (${schema.lettreEnvois.resultat} = 'en_cours' and ${schema.lettreEnvois.envoyeLe} <= ${abandonAvant}))::int`,
    })
    .from(schema.lettreEnvois)
    .where(eq(schema.lettreEnvois.lettreId, lettreId));

  return (
    lignes[0] ?? { enAttente: 0, enCours: 0, reussis: 0, echecs: 0 }
  );
}

async function vueDeLaLettre(ligne: LigneLettre): Promise<LettreVue> {
  const etat = etatDe(ligne.etat);
  const comptes = await comptesEnvoi(ligne.id);
  return {
    id: ligne.id,
    titre: ligne.titre,
    objet: ligne.objet,
    contenuHtml: ligne.contenuHtml,
    etat,
    etatLibelle: LIBELLE_ETAT[etat],
    modifiable: etat === "brouillon",
    envoyeeLe: ligne.envoyeeLe ? ligne.envoyeeLe.toISOString() : null,
    destinatairesPrevus: ligne.destinatairesPrevus,
    envoisReussis: comptes.reussis,
    echecs: comptes.echecs,
    restants: comptes.enAttente + comptes.enCours,
    createdAt: ligne.createdAt.toISOString(),
    archivedAt: ligne.archivedAt ? ligne.archivedAt.toISOString() : null,
  };
}

/** Une lettre par son identifiant, ou rien. */
async function lireLettre(id: number): Promise<LigneLettre | null> {
  const lignes = await db
    .select()
    .from(schema.lettres)
    .where(eq(schema.lettres.id, id))
    .limit(1);
  return lignes[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/*  Routes                                                                    */
/* -------------------------------------------------------------------------- */

export function mountLettre(app: Hono): void {
  /* --- Réglages et destinataires ---------------------------------------- */

  /**
   * L'envoi est-il possible, et où atterrissent les courriers.
   *
   * Déclarée AVANT « /admin/lettres/:id » : Hono essaie les routes dans
   * l'ordre où elles sont posées, et « :id » avalerait « etat ».
   */
  app.get("/admin/lettres/etat", (c) =>
    c.json({
      configure: estConfigure(),
      enEssai: estEnEssai(),
      taillePaquet: PAQUET,
    }),
  );

  /** Combien de personnes recevraient une lettre envoyée maintenant. */
  app.get("/admin/lettres/destinataires", async (c) =>
    c.json(await compterDestinataires()),
  );

  /* --- La liste et la rédaction ----------------------------------------- */

  app.get("/admin/lettres", async (c) => {
    const lignes = await db
      .select()
      .from(schema.lettres)
      .orderBy(desc(schema.lettres.createdAt));
    const lettres: LettreVue[] = [];
    for (const ligne of lignes) lettres.push(await vueDeLaLettre(ligne));
    return c.json({ lettres });
  });

  app.post("/admin/lettres", async (c) => {
    const corps = (await c.req.json().catch(() => null)) as {
      titre?: unknown;
      objet?: unknown;
      contenuHtml?: unknown;
    } | null;

    const titre = texte(corps?.titre, 200);
    const objet = texte(corps?.objet, 200);
    if (!titre) return c.json({ error: "Donnez un titre à cette lettre." }, 400);
    if (!objet)
      return c.json(
        { error: "Indiquez l'objet du courrier : c'est ce que vos lecteurs verront." },
        400,
      );

    const lignes = await db
      .insert(schema.lettres)
      .values({
        titre,
        objet,
        contenuHtml: nettoyerContenu(texte(corps?.contenuHtml, 200_000)),
      })
      .returning();
    const creee = lignes[0];
    if (!creee) return c.json({ error: "La lettre n'a pas pu être créée." }, 500);
    return c.json(await vueDeLaLettre(creee));
  });

  app.get("/admin/lettres/:id", async (c) => {
    const id = identifiant(c.req.param("id"));
    if (!id) return c.json({ error: "Cette lettre n'existe pas." }, 404);
    const ligne = await lireLettre(id);
    if (!ligne) return c.json({ error: "Cette lettre n'existe pas." }, 404);
    return c.json(await vueDeLaLettre(ligne));
  });

  /** Modifier une lettre. Refusé dès qu'elle est partie, ou en train de partir. */
  app.put("/admin/lettres/:id", async (c) => {
    const id = identifiant(c.req.param("id"));
    if (!id) return c.json({ error: "Cette lettre n'existe pas." }, 404);
    const ligne = await lireLettre(id);
    if (!ligne) return c.json({ error: "Cette lettre n'existe pas." }, 404);

    const etat = etatDe(ligne.etat);
    if (etat !== "brouillon")
      return c.json(
        {
          error:
            etat === "envoyee"
              ? "Cette lettre est déjà partie : elle ne se modifie plus. Créez-en une nouvelle."
              : "L'envoi de cette lettre est en cours : elle ne peut plus être modifiée.",
        },
        409,
      );

    const corps = (await c.req.json().catch(() => null)) as {
      titre?: unknown;
      objet?: unknown;
      contenuHtml?: unknown;
    } | null;

    const titre = texte(corps?.titre, 200);
    const objet = texte(corps?.objet, 200);
    if (!titre) return c.json({ error: "Donnez un titre à cette lettre." }, 400);
    if (!objet)
      return c.json(
        { error: "Indiquez l'objet du courrier : c'est ce que vos lecteurs verront." },
        400,
      );

    const lignes = await db
      .update(schema.lettres)
      .set({
        titre,
        objet,
        contenuHtml: nettoyerContenu(texte(corps?.contenuHtml, 200_000)),
        updatedAt: new Date(),
      })
      .where(eq(schema.lettres.id, id))
      .returning();
    const modifiee = lignes[0];
    if (!modifiee) return c.json({ error: "Cette lettre n'existe pas." }, 404);
    return c.json(await vueDeLaLettre(modifiee));
  });

  /**
   * Archive une lettre, ou la restaure.
   *
   * La suppression directe a été RETIRÉE. Une lettre PARTIE ne s'effaçait
   * déjà pas, et c'était la bonne règle : ses `lettre_envoi` disent qui l'a
   * reçue, et cette liste est la seule chose qui empêche d'écrire deux fois à
   * la même personne. Mais le brouillon, lui, était bel et bien détruit — et
   * un brouillon, c'est un texte écrit, relu, mis en forme. (Un brouillon
   * ARCHIVÉ peut désormais être supprimé définitivement : route DELETE
   * ci-dessous.)
   *
   * L'archivage range les deux. La lettre quitte la liste ordinaire, garde
   * son contenu et ses destinataires, et « Restaurer » la remet telle quelle.
   *
   * Seul un envoi EN COURS est refusé : la boucle d'envoi tourne encore, par
   * paquets, et ranger sa lettre en plein milieu ferait disparaître de
   * l'écran ce qui est en train de partir, sans rien arrêter.
   */
  app.post("/admin/lettres/:id/archive", async (c) => {
    const id = identifiant(c.req.param("id"));
    if (!id) return c.json({ error: "Cette lettre n'existe pas." }, 404);
    const ligne = await lireLettre(id);
    if (!ligne) return c.json({ error: "Cette lettre n'existe pas." }, 404);
    const corps = (await c.req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    // Défaut : on archive. Seul un « archived: false » explicite restaure.
    const archiver = corps.archived !== false;

    if (archiver && etatDe(ligne.etat) === "en_cours")
      return c.json(
        {
          error:
            "Cette lettre est en train de partir : attendez la fin de l'envoi pour l'archiver.",
        },
        409,
      );

    const lignes = await db
      .update(schema.lettres)
      .set({ archivedAt: archiver ? new Date() : null, updatedAt: new Date() })
      .where(eq(schema.lettres.id, id))
      .returning();
    const touchee = lignes[0];
    if (!touchee) return c.json({ error: "Cette lettre n'existe pas." }, 404);
    return c.json({ ok: true, archived: touchee.archivedAt != null });
  });

  /**
   * Supprime définitivement une lettre ARCHIVÉE (règles : suppression.ts) —
   * mais seulement un BROUILLON qui n'est jamais parti.
   *
   * Une lettre envoyée, même archivée, reste : c'est la trace d'un envoi. Ses
   * `lettre_envoi` disent qui l'a reçue, quand, et si le courrier est passé ;
   * c'est ce qu'on relit quand quelqu'un demande pourquoi il a reçu ce
   * message, ou s'il l'a vraiment reçu. La clé étrangère est en cascade : la
   * base effacerait cette trace sans rien dire, d'où la vérification ici. Un
   * envoi d'essai n'écrit rien dans `lettre_envoi` : un brouillon essayé
   * reste un brouillon, et se supprime.
   *
   * La requête répète les conditions (archivée, brouillon) : rien ne passe
   * entre la vérification et l'effacement, qui tient en une instruction.
   */
  app.delete("/admin/lettres/:id", async (c) => {
    const id = identifiant(c.req.param("id"));
    if (!id) return c.json({ error: "Cette lettre n'existe pas." }, 404);
    return supprimerPourToujours(c, {
      lire: () => lireLettre(id),
      estArchive: (l) => l.archivedAt != null,
      empeche: async (l) => {
        const [envois] = await db
          .select({ n: sqlOp<number>`count(*)::int` })
          .from(schema.lettreEnvois)
          .where(eq(schema.lettreEnvois.lettreId, id));
        if (etatDe(l.etat) === "brouillon" && !envois?.n) return null;
        const quand = l.envoyeeLe
          ? ` le ${l.envoyeeLe.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" })}`
          : "";
        return (
          `« ${l.titre} » ${etatDe(l.etat) === "envoyee" ? `est partie${quand}` : "a commencé à partir"} : ` +
          "elle reste archivée, comme trace de ce qui a été envoyé et à qui. " +
          "Seul un brouillon jamais envoyé peut être supprimé définitivement."
        );
      },
      supprimer: async () => {
        await db
          .delete(schema.lettres)
          .where(
            and(
              eq(schema.lettres.id, id),
              isNotNull(schema.lettres.archivedAt),
              eq(schema.lettres.etat, "brouillon"),
              sqlOp`not exists (select 1 from ${schema.lettreEnvois} where ${schema.lettreEnvois.lettreId} = ${id})`,
            ),
          );
      },
    });
  });

  /** La lettre telle qu'elle arrivera, sans rien envoyer. */
  app.get("/admin/lettres/:id/apercu", async (c) => {
    const id = identifiant(c.req.param("id"));
    if (!id) return c.json({ error: "Cette lettre n'existe pas." }, 404);
    const ligne = await lireLettre(id);
    if (!ligne) return c.json({ error: "Cette lettre n'existe pas." }, 404);

    // Aucun jeton n'est créé pour un aperçu : le lien montré est celui d'un
    // essai, qui ne désabonne personne.
    const courrier = rendreLettre(
      ligne.objet,
      ligne.contenuHtml,
      `${LIEN_DESABONNEMENT}?jeton=essai`,
    );
    return c.json({ sujet: courrier.subject, html: courrier.html });
  });

  /* --- L'envoi d'essai --------------------------------------------------- */

  /**
   * S'envoyer la lettre à soi, pour la relire dans une vraie boîte.
   *
   * Rien n'est écrit dans les tables d'envoi : un essai ne doit pas empêcher
   * la vraie lettre de partir ensuite vers cette même adresse, ni gonfler les
   * compteurs de l'envoi réel.
   */
  app.post("/admin/lettres/:id/essai", async (c) => {
    const id = identifiant(c.req.param("id"));
    if (!id) return c.json({ error: "Cette lettre n'existe pas." }, 404);
    const ligne = await lireLettre(id);
    if (!ligne) return c.json({ error: "Cette lettre n'existe pas." }, 404);

    const corps = (await c.req.json().catch(() => null)) as {
      destinataire?: unknown;
    } | null;
    const brut = texte(corps?.destinataire, 200);
    if (!brut)
      return c.json({ error: "Indiquez l'adresse qui doit recevoir l'essai." }, 400);
    const destinataire = adresseNormalisee(brut);
    if (!destinataire)
      return c.json(
        {
          error: `« ${brut} » ne ressemble pas à une adresse e-mail. Il en faut une complète, du genre bonjour@exemple.fr.`,
        },
        400,
      );

    if (!ligne.contenuHtml.trim())
      return c.json({ error: "Cette lettre est vide : écrivez-la d'abord." }, 400);
    if (!estConfigure()) return c.json({ error: RIEN_POUR_ENVOYER }, 503);

    const courrier = rendreLettre(
      ligne.objet,
      ligne.contenuHtml,
      `${LIEN_DESABONNEMENT}?jeton=essai`,
    );
    const parti = await envoyer({
      to: destinataire,
      // Le mot « Essai » dans l'objet évite de confondre, dans sa propre
      // boîte, la répétition et la vraie lettre partie chez les lecteurs.
      subject: `[Essai] ${courrier.subject}`,
      html: courrier.html,
      text: courrier.text,
    });

    if (!parti)
      return c.json(
        {
          error:
            "L'essai n'a pas pu partir. Réessayez dans un instant ; si cela recommence, prévenez la personne qui s'occupe du site.",
        },
        502,
      );

    return c.json({
      ok: true,
      resume: estEnEssai()
        ? `Essai déposé dans la boîte de test pour ${destinataire}. Rien n'est sorti d'ici.`
        : `Essai envoyé à ${destinataire}.`,
    });
  });

  /* --- L'envoi réel, par paquets ---------------------------------------- */

  /**
   * Envoie UN paquet, puis rend la main.
   *
   * Le premier appel fige la liste : chaque destinataire reçoit sa ligne « en
   * attente ». Les appels suivants prennent les lignes restantes par paquets.
   * L'écran rappelle cette route jusqu'à ce qu'elle réponde « terminé ».
   *
   * Figer la liste au départ plutôt que la recalculer à chaque paquet, c'est
   * ce qui fait que le nombre annoncé avant l'envoi est celui qui part
   * vraiment : une inscription arrivée entre deux paquets ne s'invite pas dans
   * une lettre déjà commencée, elle recevra la suivante.
   */
  app.post("/admin/lettres/:id/envoi", async (c) => {
    const id = identifiant(c.req.param("id"));
    if (!id) return c.json({ error: "Cette lettre n'existe pas." }, 404);
    const ligne = await lireLettre(id);
    if (!ligne) return c.json({ error: "Cette lettre n'existe pas." }, 404);

    const etat = etatDe(ligne.etat);
    if (etat === "envoyee") {
      const comptes = await comptesEnvoi(id);
      return c.json({
        termine: true,
        total: ligne.destinatairesPrevus,
        reussis: comptes.reussis,
        echecs: comptes.echecs,
        restants: 0,
        etat: "envoyee",
        resume: "Cette lettre est déjà partie. Elle ne repart pas une seconde fois.",
      });
    }

    // Une lettre rangée ne part pas. Elle ne s'affiche plus dans la liste
    // ordinaire : la voir partir depuis un onglet resté ouvert serait un envoi
    // que personne n'a vu venir, et un courrier ne se rattrape pas.
    if (ligne.archivedAt)
      return c.json(
        {
          error:
            "Cette lettre est archivée : restaurez-la avant de l'envoyer.",
        },
        409,
      );
    if (!ligne.objet.trim())
      return c.json({ error: "Indiquez l'objet du courrier avant d'envoyer." }, 400);
    if (!ligne.contenuHtml.trim())
      return c.json({ error: "Cette lettre est vide : écrivez-la d'abord." }, 400);
    if (!estConfigure()) return c.json({ error: RIEN_POUR_ENVOYER }, 503);

    // Premier paquet : on pose la liste, une ligne par destinataire. Le doublon
    // est refusé par l'index unique, jamais par une vérification du code.
    if (etat === "brouillon") {
      const destinataires = await listeDestinataires();
      if (destinataires.length === 0)
        return c.json(
          {
            error:
              "Personne ne recevrait cette lettre pour le moment : aucune adresse inscrite, aucun client n'ayant accepté d'être contacté.",
          },
          400,
        );

      await db
        .insert(schema.lettreEnvois)
        .values(destinataires.map((email) => ({ lettreId: id, email })))
        .onConflictDoNothing();

      await db
        .update(schema.lettres)
        .set({
          etat: "en_cours",
          destinatairesPrevus: destinataires.length,
          updatedAt: new Date(),
        })
        .where(eq(schema.lettres.id, id));
    }

    /*
     * Prendre le paquet AVANT d'envoyer quoi que ce soit.
     *
     * Cette mise à jour est ce qui réserve les lignes : PostgreSQL revérifie
     * « en_attente » après avoir posé son verrou, si bien que deux envois
     * lancés en même temps ne peuvent pas se voir attribuer la même adresse.
     * Réserver d'abord et envoyer ensuite fait qu'un incident laisse au pire
     * un courrier non parti — jamais un courrier parti deux fois.
     */
    const paquet = await db
      .update(schema.lettreEnvois)
      .set({ resultat: "en_cours", envoyeLe: new Date() })
      .where(
        and(
          eq(schema.lettreEnvois.resultat, "en_attente"),
          inArray(
            schema.lettreEnvois.id,
            db
              .select({ id: schema.lettreEnvois.id })
              .from(schema.lettreEnvois)
              .where(
                and(
                  eq(schema.lettreEnvois.lettreId, id),
                  eq(schema.lettreEnvois.resultat, "en_attente"),
                ),
              )
              .orderBy(asc(schema.lettreEnvois.id))
              .limit(PAQUET),
          ),
        ),
      )
      .returning({ id: schema.lettreEnvois.id, email: schema.lettreEnvois.email });

    let partis = 0;
    for (const destinataire of paquet) {
      const jeton = await jetonPour(destinataire.email);
      const lien = `${LIEN_DESABONNEMENT}?jeton=${encodeURIComponent(jeton)}`;
      const courrier = rendreLettre(ligne.objet, ligne.contenuHtml, lien);
      const parti = await envoyer({
        to: destinataire.email,
        subject: courrier.subject,
        html: courrier.html,
        text: courrier.text,
        // Le bouton « Se désabonner » que Gmail, Outlook et Apple Mail
        // affichent à côté de l'expéditeur (17/11). « One-Click » : la
        // messagerie envoie un POST à ce lien, sans page à confirmer
        // (RFC 8058) ; la route le reconnaît au jeton de l'adresse.
        entetes: {
          "List-Unsubscribe": `<${lien}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
      if (parti) partis += 1;
      await db
        .update(schema.lettreEnvois)
        .set({ resultat: resultatDe(parti), envoyeLe: new Date() })
        .where(eq(schema.lettreEnvois.id, destinataire.id));
    }

    const comptes = await comptesEnvoi(id);
    // Terminé veut dire : plus personne en attente, ET plus personne en train
    // d'être servi. Sans la seconde condition, deux envois lancés en même
    // temps — un double clic, deux onglets — se déclareraient finis chacun de
    // leur côté et enregistreraient un décompte pris au milieu du travail de
    // l'autre : « 1 courrier parti, 29 en échec » sur une lettre bel et bien
    // partie à trente personnes.
    const termine = comptes.enAttente === 0 && comptes.enCours === 0;

    if (termine) {
      await db
        .update(schema.lettres)
        .set({
          etat: "envoyee",
          envoyeeLe: new Date(),
          envoisReussis: comptes.reussis,
          updatedAt: new Date(),
        })
        .where(eq(schema.lettres.id, id));
    }

    const restants = comptes.enAttente + comptes.enCours;
    const total = restants + comptes.reussis + comptes.echecs;
    const faits = comptes.reussis + comptes.echecs;
    return c.json({
      termine,
      total,
      reussis: comptes.reussis,
      echecs: comptes.echecs,
      restants,
      partisCeTour: partis,
      etat: termine ? "envoyee" : "en_cours",
      resume: termine
        ? `Lettre envoyée. ${comptes.reussis} courrier${comptes.reussis > 1 ? "s sont partis" : " est parti"}` +
          (comptes.echecs > 0
            ? `, ${comptes.echecs} n'${comptes.echecs > 1 ? "ont" : "a"} pas pu partir.`
            : ".")
        : comptes.enAttente === 0
          ? `Un envoi est déjà en cours pour cette lettre. ${faits} courrier${faits > 1 ? "s" : ""} sur ${total}, patientez quelques instants.`
          : `${faits} courrier${faits > 1 ? "s" : ""} sur ${total}. Il en reste ${restants}.`,
    });
  });

  /* --- Le désabonnement, public ----------------------------------------- */

  /**
   * La page de désabonnement. Publique : personne n'a de compte ici, et
   * exiger une connexion pour sortir d'une liste reviendrait à ne pas laisser
   * sortir du tout.
   *
   * Elle DEMANDE avant d'agir, au lieu de désabonner au chargement. Les
   * messageries d'entreprise ouvrent les liens des courriers reçus pour les
   * inspecter : une page qui agit toute seule désabonnerait des gens qui n'ont
   * jamais cliqué, et ils ne le sauraient jamais.
   */
  app.get("/lettre/desabonnement", async (c) => {
    const jeton = (c.req.query("jeton") ?? "").trim();

    if (jeton === "essai")
      return c.html(
        pageDesabonnement(
          "Lien d'exemple",
          `<p>Ce lien vient d'un essai : il ne désabonne personne.</p>
           <p class="discret">Dans la vraie lettre, ce lien retire l'adresse de la liste en un clic.</p>`,
        ),
      );

    const lignes = jeton
      ? await db
          .select()
          .from(schema.lettreJetons)
          .where(eq(schema.lettreJetons.jeton, jeton))
          .limit(1)
      : [];
    const trouve = lignes[0];

    if (!trouve)
      return c.html(
        pageDesabonnement(
          "Ce lien n'est plus valable",
          `<p>Nous ne reconnaissons pas ce lien de désabonnement. Il a peut-être été
            coupé en deux par votre messagerie.</p>
           <p class="discret">Écrivez-nous en répondant simplement à la lettre : nous
            retirerons votre adresse à la main.</p>`,
        ),
        404,
      );

    if (trouve.desabonneLe)
      return c.html(
        pageDesabonnement(
          "Vous êtes déjà désabonné",
          `<p>L'adresse ${h(trouve.email)} ne reçoit plus notre newsletter.</p>
           <p class="discret">Vous n'avez rien d'autre à faire.</p>`,
        ),
      );

    return c.html(
      pageDesabonnement(
        "Ne plus recevoir la newsletter",
        `<p>Vous êtes sur le point de retirer l'adresse ${h(trouve.email)} de notre
          newsletter.</p>
         <form method="POST" action="${h(LIEN_DESABONNEMENT)}">
           <input type="hidden" name="jeton" value="${h(jeton)}" />
           <button type="submit">Confirmer mon désabonnement</button>
         </form>
         <p class="discret" style="margin-top:20px">Vos commandes et votre compte ne
          changent pas : seuls les courriers d'information s'arrêtent.</p>`,
      ),
    );
  });

  /** Le désabonnement lui-même, une fois la personne d'accord. */
  app.post("/lettre/desabonnement", async (c) => {
    const formulaire = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    // Le jeton vient du formulaire de la page, ou de l'adresse quand c'est la
    // messagerie qui désabonne d'un clic (« List-Unsubscribe-Post »).
    const jeton = texte(formulaire["jeton"], 200) || texte(c.req.query("jeton"), 200);

    const lignes = jeton
      ? await db
          .select()
          .from(schema.lettreJetons)
          .where(eq(schema.lettreJetons.jeton, jeton))
          .limit(1)
      : [];
    const trouve = lignes[0];

    if (!trouve)
      return c.html(
        pageDesabonnement(
          "Ce lien n'est plus valable",
          `<p>Nous ne reconnaissons pas ce lien de désabonnement.</p>
           <p class="discret">Écrivez-nous en répondant simplement à la lettre : nous
            retirerons votre adresse à la main.</p>`,
        ),
        404,
      );

    await desabonner(trouve.email);
    // La date reste comme trace du désabonnement, et permet d'accueillir un
    // second clic sur le même lien sans faire croire à une erreur.
    await db
      .update(schema.lettreJetons)
      .set({ desabonneLe: new Date() })
      .where(eq(schema.lettreJetons.jeton, trouve.jeton));

    return c.html(
      pageDesabonnement(
        "C'est fait",
        `<p>L'adresse ${h(trouve.email)} ne recevra plus notre newsletter.</p>
         <p class="discret">Merci d'avoir suivi Memory Line jusqu'ici. Vous pouvez vous
          réinscrire à tout moment depuis le bas de notre site.</p>`,
      ),
    );
  });
}
