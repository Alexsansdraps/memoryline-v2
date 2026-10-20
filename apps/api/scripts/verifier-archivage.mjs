/**
 * Garde-fou : « rien ne se supprime entièrement ça n'existe pas, ça sera de
 * l'archivage, partout » (Alexandra).
 *
 * À lancer avec `pnpm --filter @memoryline/api verifier:archivage`. Il relit
 * tout apps/api/src, relève chaque `db.delete(...)` / `tx.delete(...)`, et
 * ÉCHOUE si l'un d'eux ne figure pas, nommément, dans la liste ci-dessous.
 * Il échoue aussi quand une ligne de la liste ne correspond plus à rien : une
 * autorisation périmée est un mensonge qui dort.
 *
 * Pourquoi un script et pas une relecture : la suppression ne revient jamais
 * par la grande porte. Elle revient dans un coin d'une route ajoutée un soir,
 * et six mois plus tard une catégorie pleine s'efface en silence. Ici, elle
 * doit être ÉCRITE et JUSTIFIÉE avant de passer.
 *
 * Ce que le script ne voit pas : les fichiers effacés sur le disque (`unlink`,
 * cache d'images, fichiers d'impression) et le `on delete cascade` de la base.
 * Le premier relève de l'exception « fichiers de cache », le second se lit
 * dans apps/api/src/db/schema.ts.
 *
 * Il ne reconnaît non plus que deux receveurs : `db` et `tx`. C'est exact
 * aujourd'hui — les transactions s'écrivent toutes `transaction(async (tx) =>`
 * —, mais c'est une CONVENTION : renommer ce paramètre rendrait la suppression
 * invisible ici. Si un jour elle s'appelle autrement, l'ajouter au motif de
 * `suppressionsDe` fait partie du changement.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(RACINE, "src");

/**
 * Les trois exceptions convenues avec Alexandra, dans ses mots — plus un
 * quatrième cas, qui n'en est PAS une : là, rien de ce qu'elle manipule ne
 * disparaît, il n'y a donc rien à archiver. Chaque autorisation dit laquelle
 * la couvre, et pourquoi.
 */
const MOTIFS = {
  "photos-visiteurs":
    "Exception 1 — les photos de visiteurs de l'affiche IA et leur purge automatique : ce sont des visages, une affaire de loi et de vie privée (commit 4e5fbef).",
  cache:
    "Exception 2 — les fichiers de cache, refabriqués à partir des originaux (data/assets/cache).",
  "client-et-technique":
    "Exception 3 — ce qu'un client fait sur ses propres données, et les lignes techniques (sessions de connexion).",
  "rien-ne-disparait":
    "Pas une exception : la chose qu'Alexandra manipule reste entière, seule une liaison ou une ligne de formulaire est réécrite. Il n'y a rien à archiver.",
};

/**
 * Les suppressions autorisées, une ligne par (fichier, table).
 *
 * `combien` est le nombre d'appels attendus : en ajouter un de plus dans le
 * même fichier, sur la même table, fait échouer le script. C'est voulu — une
 * seconde suppression n'a pas les mêmes raisons que la première.
 */
const AUTORISEES = [
  /* --- Exception 3 : lignes techniques ---------------------------------- */
  {
    fichier: "src/auth.ts",
    table: "schema.sessions",
    combien: 4,
    motif: "client-et-technique",
    raison:
      "Sessions du back-office : déconnexion, session expirée, balayage des périmées. Une session n'est pas un souvenir, c'est une porte ouverte — on la referme.",
  },
  {
    fichier: "src/index.ts",
    table: "schema.sessions",
    combien: 3,
    motif: "client-et-technique",
    raison:
      "Les mêmes portes, refermées quand un mot de passe change et quand un compte est archivé. Le compte, lui, reste : l'historique des commandes cite son nom.",
  },
  {
    fichier: "src/comptes.ts",
    table: "schema.customerSessions",
    combien: 4,
    motif: "client-et-technique",
    raison:
      "Sessions de connexion des clients : déconnexion, mot de passe changé, sessions périmées.",
  },
  {
    fichier: "src/salon.ts",
    table: "schema.printFiles",
    combien: 1,
    motif: "client-et-technique",
    raison:
      "Rouvrir une vente au stand efface les NOMS de ses fichiers d'impression : une ligne print_file ne garde qu'un nom et une adresse, le PDF se refait à la demande depuis la commande, qui reste entière. Le nom doit changer quand le client corrige son format ou son cadre, sinon l'imprimeur reçoit « martin_A4_pas-cadre.pdf » pour une A3 encadrée. Autorisé par Alexandra le 20/10/2026 (rien à archiver : ce n'est pas un souvenir).",
  },

  {
    fichier: "src/relance-panier.ts",
    table: "schema.settings",
    combien: 1,
    motif: "client-et-technique",
    raison:
      "« Revenir au texte d'origine » : la marchande retire SA surcharge d'un courrier de relance dans une langue, et le texte d'usine — écrit dans le code, jamais perdu — reprend la main. Ce qui part n'est pas un contenu de la boutique, c'est une réécriture qu'elle annule elle-même ; l'archiver reviendrait à garder un texte qu'elle vient justement de renier.",
  },

  /* --- Exception 3 : le client sur ses propres données ------------------- */
  {
    fichier: "src/comptes.ts",
    table: "schema.customerAddresses",
    combien: 1,
    motif: "client-et-technique",
    raison:
      "Le client efface UNE DE SES adresses depuis son compte. C'est son carnet d'adresses, pas le contenu de la boutique.",
  },
  {
    fichier: "src/configurator-routes.ts",
    table: "schema.orderItems",
    combien: 1,
    motif: "client-et-technique",
    raison:
      "Le client retire une ligne de SON panier (DELETE /cart/:cartId/items/:itemId). Un panier n'est pas une commande : rien n'est encore vendu.",
  },
  {
    fichier: "src/lettre.ts",
    table: "schema.newsletterSubscribers",
    combien: 1,
    motif: "client-et-technique",
    raison:
      "La personne se désinscrit elle-même, par le lien de la lettre. Son adresse est à elle.",
  },
  {
    fichier: "src/index.ts",
    table: "schema.newsletterSubscribers",
    combien: 1,
    motif: "client-et-technique",
    raison:
      "Le back-office retire une adresse de la liste, à la demande de la personne. Garder « au cas où » l'adresse de quelqu'un qui demande à partir est précisément ce qu'il ne faut pas faire ; elle pourra se réinscrire depuis le site.",
  },

  /* --- Exception 1 : les photos de visiteurs ---------------------------- */
  {
    fichier: "src/ia-relais.ts",
    table: "schema.aiPhotoRelays",
    combien: 1,
    motif: "photos-visiteurs",
    raison:
      "Le relais téléphone → tablette : le code et la photo du visiteur, effacés passé le délai. C'est l'effacement automatique convenu.",
  },

  /* --- Rien ne disparaît : liaisons et lignes de formulaire ------------- */
  {
    fichier: "src/collections.ts",
    table: "schema.productCollections",
    combien: 1,
    motif: "rien-ne-disparait",
    raison:
      "Sortir une affiche d'une collection. L'affiche reste au catalogue, la collection reste : seul le rattachement est réécrit, et l'y remettre est un clic. Archiver une collection, elle, garde ce rattachement intact.",
  },
  {
    fichier: "src/produits-masse.ts",
    table: "schema.productCollections",
    combien: 1,
    motif: "rien-ne-disparait",
    raison: "Le même geste, sur un lot d'affiches cochées.",
  },
  {
    fichier: "src/fiche-produit.ts",
    table: "schema.productCollections",
    combien: 1,
    motif: "rien-ne-disparait",
    raison:
      "La fiche d'une affiche réécrit la liste de ses collections en entier à l'enregistrement.",
  },
  {
    fichier: "src/fiche-produit.ts",
    table: "schema.productImages",
    combien: 1,
    motif: "rien-ne-disparait",
    raison:
      "La fiche réécrit sa galerie en entier (l'ordre y choisit l'image principale). Le fichier image, lui, reste sur le disque et se rajoute d'un clic — le texte alternatif écrit pour les lecteurs d'écran, en revanche, part avec la ligne et serait à réécrire.",
  },
  {
    fichier: "src/fiche-produit.ts",
    table: "schema.variants",
    combien: 1,
    motif: "rien-ne-disparait",
    raison:
      "Retirer un format jamais vendu de la grille des prix. Un format qui figure dans une commande est REFUSÉ par la route elle-même, avec le message qui dit quoi faire à la place : les commandes passées continuent de s'imprimer.",
  },
  {
    fichier: "src/commandes.ts",
    table: "schema.payments",
    combien: 1,
    motif: "rien-ne-disparait",
    raison:
      "Annulation d'une ligne de paiement posée quelques millisecondes plus tôt dans la même requête, quand l'encaissement n'a finalement pas été validé. La laisser « en attente » ferait croire à un règlement en cours.",
  },
  {
    fichier: "src/comptes.ts",
    table: "schema.customers",
    combien: 1,
    motif: "rien-ne-disparait",
    raison:
      "Fusion des fiches client en double (même adresse e-mail, aucune n'ayant de mot de passe). La fiche gardée reprend d'abord TOUT ce que sa jumelle portait — commandes, adresses, cartes cadeaux, essais d'affiche IA, étiquettes, note, ancienneté, identifiant Shopify et champs manquants —, y compris les liens que la base couperait d'elle-même en « set null » : ce qui part est alors une fiche vide de la même personne. Sessions et jetons de mot de passe partent en cascade, et ne peuvent pas exister sur une fiche sans mot de passe. Seul le consentement marketing n'est pas repris — on ne réactive pas un consentement en fusionnant.",
  },
];

/* -------------------------------------------------------------------------- */

/** Tous les .ts sous src/, chemins relatifs à apps/api. */
function fichiersSources(dossier) {
  const trouves = [];
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) trouves.push(...fichiersSources(chemin));
    else if (nom.endsWith(".ts")) trouves.push(chemin);
  }
  return trouves;
}

/**
 * Le code sans ses commentaires.
 *
 * Sans ce nettoyage, un commentaire qui EXPLIQUE pourquoi `db.delete` a
 * disparu serait compté comme une suppression — et ces commentaires-là, on en
 * a écrit partout en convertissant à l'archivage.
 */
function sansCommentaires(texte) {
  return texte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Relève les suppressions d'un fichier, table par table.
 *
 * Le `\s*` autour du point est indispensable : la moitié des appels s'écrivent
 * `await db` puis `.delete(...)` à la ligne suivante, et un motif sur une
 * seule ligne les aurait tous manqués — c'est-à-dire tous laissés passer.
 */
function suppressionsDe(code) {
  // `const relais = schema.aiPhotoRelays;` — sans cette résolution, la table
  // s'appellerait « relais » et aucune ligne de la liste ne lui répondrait.
  const alias = new Map();
  for (const m of code.matchAll(
    /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(schema\.[A-Za-z_$][\w$]*)\s*;/g,
  ))
    alias.set(m[1], m[2]);

  const compte = new Map();
  for (const m of code.matchAll(
    /\b(?:db|tx)\s*\.\s*delete\s*\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g,
  )) {
    const table = alias.get(m[1]) ?? m[1];
    compte.set(table, (compte.get(table) ?? 0) + 1);
  }
  return compte;
}

const releve = new Map(); // "fichier|table" -> nombre
for (const chemin of fichiersSources(SRC)) {
  const fichier = relative(RACINE, chemin).split("\\").join("/");
  const code = sansCommentaires(readFileSync(chemin, "utf8"));
  for (const [table, n] of suppressionsDe(code))
    releve.set(`${fichier}|${table}`, n);
}

const attendues = new Map(
  AUTORISEES.map((a) => [`${a.fichier}|${a.table}`, a]),
);

const fautes = [];
for (const [cle, n] of releve) {
  const [fichier, table] = cle.split("|");
  const permise = attendues.get(cle);
  if (!permise) {
    fautes.push(
      `SUPPRESSION NON AUTORISÉE — ${fichier} efface ${table} (${n} fois).\n` +
        `  Chez Alexandra, une suppression est un ARCHIVAGE : la chose quitte la boutique et les\n` +
        `  listes ordinaires, reste visible dans « Archives » et se restaure. Suivez le modèle de\n` +
        `  character_type.archived_at (voir apps/api/src/collections.ts).\n` +
        `  Si cette suppression relève vraiment d'une des exceptions convenues, ajoutez-la à\n` +
        `  AUTORISEES, dans ce fichier, avec sa raison écrite.`,
    );
  } else if (permise.combien !== n) {
    fautes.push(
      `COMPTE CHANGÉ — ${fichier} efface ${table} ${n} fois, ${permise.combien} étaient autorisées.\n` +
        `  Autorisé pour : ${permise.raison}\n` +
        `  Une suppression de plus n'a pas les mêmes raisons que les précédentes : justifiez-la,\n` +
        `  ou archivez plutôt que d'effacer.`,
    );
  }
}
for (const [cle, a] of attendues) {
  if (releve.has(cle)) continue;
  const [fichier, table] = cle.split("|");
  fautes.push(
    `AUTORISATION PÉRIMÉE — ${fichier} n'efface plus ${table}.\n` +
      `  Bonne nouvelle : retirez cette ligne de AUTORISEES, dans ce fichier. Une autorisation qui\n` +
      `  ne correspond plus à rien finit par couvrir autre chose.`,
  );
}

/* --- Ce que le script a trouvé, en clair ---------------------------------- */

console.log("Suppressions réelles dans apps/api/src, et ce qui les autorise :\n");
for (const [motif, texte] of Object.entries(MOTIFS)) {
  const lignes = AUTORISEES.filter((a) => a.motif === motif);
  // Un motif sans ligne s'affiche quand même. C'est le cas des fichiers de
  // cache, qui n'effacent aucune ligne de base : les sauter donnait un rapport
  // à deux exceptions là où l'écran « Archives » en annonce trois, et l'une des
  // trois devenait invisible ici sans que rien ne dise pourquoi.
  console.log(`  ${texte}`);
  if (!lignes.length)
    console.log(
      "    · aucune suppression de ligne en base sous ce motif (voir l'en-tête de ce fichier).",
    );
  for (const a of lignes)
    console.log(
      `    · ${a.fichier} → ${a.table} (${a.combien}) : ${a.raison}`,
    );
  console.log("");
}

if (fautes.length) {
  console.error(`✗ ${fautes.length} problème(s) :\n`);
  for (const f of fautes) console.error(f + "\n");
  process.exit(1);
}

const total = [...releve.values()].reduce((n, v) => n + v, 0);
console.log(
  `✓ ${total} suppression(s), toutes justifiées. Tout le reste s'archive.`,
);
