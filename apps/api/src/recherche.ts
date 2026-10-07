/**
 * La recherche unique du back-office.
 *
 * Le back-office compte une cinquantaine d'écrans et chacun a sa propre barre
 * de filtres. Retrouver la commande d'une cliente qui appelle demandait donc de
 * savoir D'ABORD dans quel écran chercher. Cette route répond à la question
 * posée dans l'autre sens — « je tape ce que je sais, montre-moi ce que ça
 * touche » — et elle mélange volontairement les natures : une affiche, une
 * commande, une cliente et un texte du site se répondent dans la même liste.
 *
 * Elle cherche désormais PARTOUT, corps des textes compris, à la demande
 * d'Alexandra : un bout de description, une note de commande, une ligne de
 * journal, un texte d'affiche, une traduction allemande. Chaque résultat dit
 * OÙ il a trouvé (« Description (anglais) ») et son lien mène à cet endroit
 * précis de l'écran, le passage surligné.
 *
 * Ce qui garde le panneau lisible malgré cela, c'est le CLASSEMENT, groupe par
 * groupe : exact, puis début de mot, puis contient, puis approché (une faute
 * de frappe corrigée), et à rang égal le poids du champ — un nom passe devant
 * une description. Taper « biarritz » met l'affiche BIARRITZ devant les
 * affiches qui parlent de Biarritz dans leur texte. Les groupes, eux, gardent
 * un ordre fixe : on cherche des yeux au même endroit.
 *
 * Les écrans du back-office et les rubriques de l'aide ne sont plus ici : le
 * back-office les indexe lui-même, depuis son propre code (une liste écrite à
 * la main finissait toujours en retard d'un écran).
 *
 * Ce qu'elle ne lit JAMAIS — ni pour l'afficher, ni pour comparer, car un
 * « trouvé » sur une colonne secrète suffirait à la deviner lettre à lettre :
 * le code d'accès d'un stand et les réglages « salon.* », les empreintes de
 * mot de passe, les sessions et les jetons (récupération de panier,
 * désabonnement, relais photo), la clé de demande d'un bordereau, l'adresse
 * IP et la consigne envoyée au modèle d'une génération IA. La table des
 * réglages n'est lue que par des clés énumérées.
 *
 * Le code se répartit ainsi :
 *   - @memoryline/types/recherche : aplatir, comparer, classer, extraire —
 *     partagé avec le back-office et le script d'arrivée ;
 *   - recherche-sql.ts : les briques SQL du préfiltre ;
 *   - recherche-extraction.ts : ce qu'on lit dans chaque objet et où cela mène ;
 *   - recherche-corpus.ts : le catalogue et les textes, en mémoire ;
 *   - recherche-direct.ts : commandes, paniers, clientes, cartes, en base.
 */
import type { Hono } from "hono";
import {
  GROUPES_API,
  ORDRE_GROUPES,
  RECHERCHE_JETONS_MAX,
  RECHERCHE_LIMITE_MAX,
  RECHERCHE_LIMITE_PANNEAU,
  RECHERCHE_LONGUEUR_MAX,
  RECHERCHE_MINIMUM,
  TITRES_GROUPES,
  aplatir,
  comparer,
  correctionsServies,
  preparerRequete,
  type GroupeId,
  type GroupeRecherche,
  type ReponseRecherche,
  type Requete,
} from "@memoryline/types/recherche";
import { corpusRecherche, invaliderCorpusRecherche, sansTomber, type Corpus } from "./recherche-corpus.js";
import {
  chercherCartes,
  chercherClients,
  chercherCommandes,
  chercherPaniers,
  vocabulaireDirect,
  type ResultatSource,
} from "./recherche-direct.js";
import { versResultat, type Trouvaille } from "./recherche-extraction.js";

/** Le middleware d'écriture (index.ts) l'appelle : un nom corrigé se retrouve aussitôt. */
export { invaliderCorpusRecherche };

/* -------------------------------------------------------------------------- */
/*  Les paramètres                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Les groupes demandés. `undefined` (paramètre absent) : tous. Présent : les
 * ids connus seulement — un id inconnu est ignoré, et un paramètre sans aucun
 * id valide ne demande rien du tout (la réponse est vide, pas « tout »).
 */
export function lireGroupes(brut: string | undefined): GroupeId[] | null {
  if (brut === undefined) return null;
  const demandes = brut
    .split(",")
    .map((g) => g.trim())
    .filter((g): g is GroupeId => (GROUPES_API as readonly string[]).includes(g));
  return [...new Set(demandes)];
}

/** Cinq par défaut (le panneau), deux cents au plus (la page complète d'un groupe). */
export function lireLimite(brut: string | number | undefined): number {
  const n = typeof brut === "number" ? brut : Number.parseInt(brut ?? "", 10);
  if (!Number.isFinite(n)) return RECHERCHE_LIMITE_PANNEAU;
  return Math.min(RECHERCHE_LIMITE_MAX, Math.max(1, Math.trunc(n)));
}

/**
 * Le paramètre « connus » : les mots tapés que les ÉCRANS du back-office
 * connaissent (voir OptionsRequete.connus), séparés par des virgules. Ils ne
 * servent qu'à NE PAS corriger : jamais lus en base, jamais renvoyés. On n'en
 * garde que des mots — des lettres, aplaties —, et pas plus que la saisie
 * n'en compte.
 */
export function lireConnus(brut: string | undefined): Set<string> {
  const mots = new Set<string>();
  for (const morceau of (brut ?? "").split(",")) {
    const m = aplatir(morceau.slice(0, 64));
    if (/^\p{L}{3,}$/u.test(m)) mots.add(m);
    if (mots.size >= RECHERCHE_JETONS_MAX) break;
  }
  return mots;
}

/**
 * La saisie ramenée par trim et coupée à 200, sans couper un émoji en deux.
 *
 * Les caractères de contrôle deviennent des espaces : PostgreSQL refuse le
 * caractère nul dans un paramètre (« invalid byte sequence »), et une seule
 * frappe de ce genre, collée depuis un tableur, faisait tomber toute une
 * source au lieu de ne rien trouver.
 */
function saisieBornee(saisie: string): string {
  const t = saisie.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (t.length <= RECHERCHE_LONGUEUR_MAX) return t;
  const code = t.charCodeAt(RECHERCHE_LONGUEUR_MAX - 1);
  return t.slice(0, code >= 0xd800 && code <= 0xdbff ? RECHERCHE_LONGUEUR_MAX - 1 : RECHERCHE_LONGUEUR_MAX);
}

/* -------------------------------------------------------------------------- */
/*  Le vocabulaire                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Les mots connus du corpus ET des commandes, réunis une fois, avec leur
 * nombre de textes : on ne corrige une faute que si le mot tapé n'existe
 * nulle part, et vers le mot le plus courant. Réunis à nouveau seulement
 * quand l'un des deux a été relu.
 */
type Mots = Map<string, number>;
let reunion: { corpus: Mots | null; direct: Mots; mots: Mots } | null = null;

function vocabulaireUni(corpus: Mots | null, direct: Mots): Mots {
  if (reunion && reunion.corpus === corpus && reunion.direct === direct) return reunion.mots;
  const mots = new Map(corpus ?? []);
  for (const [m, n] of direct) mots.set(m, (mots.get(m) ?? 0) + n);
  reunion = { corpus, direct, mots };
  return mots;
}

/* -------------------------------------------------------------------------- */
/*  La recherche                                                              */
/* -------------------------------------------------------------------------- */

const SOURCES_DIRECTES: [GroupeId, string, (requete: Requete) => Promise<ResultatSource>][] = [
  ["commandes", "commandes", chercherCommandes],
  ["paniers", "paniers", chercherPaniers],
  ["clients", "clients", chercherClients],
  ["cartes", "cartes cadeaux", chercherCartes],
];

export interface OptionsRecherche {
  /** null ou absent : tous les groupes de l'API. */
  groupes?: readonly GroupeId[] | null;
  /** Résultats gardés par groupe ; le total, lui, compte tout. */
  limite?: number;
  /** Les mots que les écrans du back-office connaissent : jamais corrigés ici. */
  connus?: ReadonlySet<string>;
}

type ParGroupe = Map<GroupeId, { trouvailles: Trouvaille[]; plafonne: boolean }>;

/**
 * Une passe de recherche avec une saisie préparée : le corpus en mémoire et
 * les sources en base. Toutes les sources partent EN MÊME TEMPS : la
 * recherche se tape lettre par lettre, et des requêtes à la suite
 * additionneraient leurs latences.
 */
async function passe(
  requete: Requete,
  corpus: Corpus | null,
  veut: (g: GroupeId) => boolean,
  echecs: string[],
): Promise<ParGroupe> {
  // Les sources en base partent d'abord ; le corpus, en mémoire, s'évalue
  // pendant qu'elles répondent.
  const directes = Promise.all(
    SOURCES_DIRECTES.filter(([g]) => veut(g)).map(async ([g, nom, chercher]) => ({
      groupe: g,
      resultat: await sansTomber(nom, () => chercher(requete), null, echecs),
    })),
  );

  const parGroupe: ParGroupe = new Map();
  const ajouter = (g: GroupeId, trouvailles: Trouvaille[], plafonne: boolean) => {
    const groupe = parGroupe.get(g) ?? { trouvailles: [], plafonne: false };
    groupe.trouvailles.push(...trouvailles);
    groupe.plafonne ||= plafonne;
    parGroupe.set(g, groupe);
  };
  for (const fiche of corpus?.fiches ?? []) {
    if (!veut(fiche.groupe)) continue;
    const t = versResultat(fiche, requete);
    if (t) ajouter(fiche.groupe, [t], false);
  }
  for (const { groupe, resultat } of await directes)
    if (resultat) ajouter(groupe, resultat.trouvailles, resultat.plafonne);
  return parGroupe;
}

/**
 * Chercher dans les données de la boutique, hors de toute route : c'est ce
 * que la route appelle, et ce que les essais appellent directement.
 */
export async function rechercherDansLesDonnees(
  saisie: string,
  options: OptionsRecherche = {},
): Promise<ReponseRecherche> {
  const q = saisieBornee(saisie);
  const vide: ReponseRecherche = { q, groupes: [], corrections: [], partiel: false };
  // Rien ne part avant deux caractères : la réponse a la même forme, elle est
  // simplement vide, et le panneau n'a pas de cas particulier à traiter.
  if (q.length < RECHERCHE_MINIMUM) return vide;
  const demandes = options.groupes ?? GROUPES_API;
  if (!demandes.length) return vide;
  const limite = lireLimite(options.limite);
  const veut = (g: GroupeId) => demandes.includes(g);

  const echecs: string[] = [];
  const [corpus, motsDirects] = await Promise.all([
    sansTomber("corpus", corpusRecherche, null, echecs),
    sansTomber("vocabulaire", vocabulaireDirect, new Map<string, number>(), echecs),
  ]);
  if (corpus) echecs.push(...corpus.echecs);
  const vocabulaire = vocabulaireUni(corpus?.vocabulaire ?? null, motsDirects);
  const connus = options.connus ?? new Set<string>();
  let parGroupe = await passe(preparerRequete(q, vocabulaire, { connus }), corpus, veut, echecs);

  // Le REPLI : rien du tout, alors qu'un mot de cinq lettres ou plus aurait
  // pu être corrigé s'il n'existait pas déjà, tel quel, quelque part — une
  // faute recopiée dans le nom d'un décor suffit à rendre « personalisée »
  // connu. On recommence en le corrigeant quand même. Seulement quand la
  // première passe n'a RIEN trouvé : sinon, chaque mot juste se verrait
  // flanqué de ses voisins (« plage » de « place »).
  if (![...parGroupe.values()].some((g) => g.trouvailles.length)) {
    const forcee = preparerRequete(q, vocabulaire, { connus, forcer: true });
    if (forcee.jetons.some((j) => j.connu && j.corrections.length))
      parGroupe = await passe(forcee, corpus, veut, echecs);
  }

  const groupes: GroupeRecherche[] = [];
  for (const id of ORDRE_GROUPES) {
    const g = parGroupe.get(id);
    // Un groupe vide ne figure pas dans la réponse : un panneau plein de
    // titres sans rien dessous ne se lit pas.
    if (!g?.trouvailles.length) continue;
    g.trouvailles.sort((a, b) => comparer(a.classement, b.classement));
    groupes.push({
      id,
      titre: TITRES_GROUPES[id],
      total: g.trouvailles.length,
      plafonne: g.plafonne,
      resultats: g.trouvailles.slice(0, limite).map((t) => t.resultat),
    });
  }

  // « Résultats approchés pour … » : les corrections qui ont réellement
  // servi, la plus utile pour chaque mot (voir correctionsServies).
  return {
    q,
    groupes,
    corrections: correctionsServies([...parGroupe.values()].flatMap((g) => g.trouvailles.map((t) => t.approches))),
    partiel: echecs.length > 0,
  };
}

/* -------------------------------------------------------------------------- */
/*  La route                                                                  */
/* -------------------------------------------------------------------------- */

export function mountRecherche(app: Hono): void {
  // Le corpus et le vocabulaire des commandes sont lus quelques secondes après
  // le démarrage, sans attendre la première recherche : c'est elle, sinon, qui
  // paierait la lecture complète du catalogue sur des connexions encore
  // froides. Lecture seule, et un échec ici ne coûte rien — la première
  // recherche réessaiera.
  setTimeout(() => {
    void corpusRecherche().catch(() => undefined);
    void vocabulaireDirect().catch(() => undefined);
  }, 3000).unref();

  /**
   * GET /admin/recherche?q=…[&groupes=affiches,commandes][&limite=20][&connus=mot,mot]
   */
  app.get("/admin/recherche", async (c) => {
    // La réponse contient des noms de clientes : aucun cache, ni du
    // navigateur ni d'un intermédiaire.
    c.header("Cache-Control", "no-store");
    // La garde de « /admin/* » (index.ts) n'ouvre au propriétaire que ce qui
    // n'est pas une lecture, et n'autorise un vendeur que sur une liste
    // d'écrans nommés — celui-ci n'en fait pas partie. On le redit ici quand
    // même : cette route lit des noms de clientes, des adresses, des montants
    // et des numéros de commande du site. Le jour où quelqu'un ajoute
    // « /admin/recherche » à cette liste sans y penser, le refus tient encore.
    if (c.get("utilisateur")?.role !== "owner")
      return c.json({ error: "Cette recherche est réservée au propriétaire." }, 403);

    const reponse = await rechercherDansLesDonnees(c.req.query("q") ?? "", {
      groupes: lireGroupes(c.req.query("groupes")),
      limite: lireLimite(c.req.query("limite")),
      connus: lireConnus(c.req.query("connus")),
    });
    return c.json(reponse);
  });
}
