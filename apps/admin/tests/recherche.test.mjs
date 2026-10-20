/**
 * Les essais de la recherche des écrans (lib/extraire-textes.ts et
 * lib/index-ecrans.ts), sans navigateur ni base, sans dépendance.
 *
 * Lancés par : docker exec -w /app/apps/admin memoryline-admin node --test "tests/*.test.mjs"
 * (le motif, et non le dossier : Node 24 prend « tests/ » pour un fichier).
 * (Node retire seul les types des fichiers .ts importés.)
 *
 * Ils lisent les VRAIES pages du back-office, en lecture seule, avec la même
 * liste que le glob de lib/sources-ecrans.ts : c'est ce qui garantit que
 * « bandeau » trouve bien les deux écrans de bandeaux le jour où l'on
 * renomme une section, et qu'un mot-clé ne reste pas accroché à une page
 * disparue. Rien n'est écrit sur le disque : la page « ajoutée » est factice,
 * en mémoire.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  composantsImportes,
  extraireTextes,
  rubriquesAide,
  titreAdmin,
} from "../src/lib/extraire-textes.ts";
import { chercherDansIndex, construireIndex, motsConnusDesEcrans } from "../src/lib/index-ecrans.ts";
import { fusionnerRecherche } from "../src/lib/fusion-recherche.ts";
import { MENU } from "../src/lib/menu.ts";
import { SYNONYMES } from "../src/lib/synonymes-ecrans.ts";

const ADMIN = join(dirname(fileURLToPath(import.meta.url)), "..");

/* -------------------------------------------------------------------------- */
/*  Les sources, comme le glob les donne                                      */
/* -------------------------------------------------------------------------- */

const MOTIFS_ATTENDUS = [
  "/src/pages/**/*.astro",
  "/src/components/*.astro",
  "!/src/pages/login.astro",
  "!/src/pages/recherche.astro",
  "!/src/pages/commandes/bons.astro",
  "!/src/pages/personnages/piece.astro",
];

function fichiers(dossier, recursif) {
  const sortie = [];
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) {
      if (recursif) sortie.push(...fichiers(chemin, true));
    } else if (nom.endsWith(".astro")) sortie.push(chemin);
  }
  return sortie;
}

/** Les sources indexées, clé « /src/pages/… » comme celles d'import.meta.glob. */
function lireSources() {
  const exclues = new Set(MOTIFS_ATTENDUS.filter((m) => m.startsWith("!")).map((m) => m.slice(1)));
  const sources = {};
  for (const f of [...fichiers(join(ADMIN, "src/pages"), true), ...fichiers(join(ADMIN, "src/components"), false)]) {
    const cle = f.slice(ADMIN.length).replace(/\\/g, "/");
    if (!exclues.has(cle)) sources[cle] = readFileSync(f, "utf8");
  }
  return sources;
}

const SOURCES = lireSources();
const INDEX = construireIndex(SOURCES, MENU, SYNONYMES);

const chercher = (saisie, limite = 20) => chercherDansIndex(INDEX, saisie, limite);
const ids = (groupe) => (groupe?.resultats ?? []).map((r) => r.id);
const premier = (saisie) => chercher(saisie).ecrans?.resultats[0];

/* -------------------------------------------------------------------------- */
/*  Le glob et les mots-clés                                                  */
/* -------------------------------------------------------------------------- */

test("les essais lisent les mêmes fichiers que le glob de sources-ecrans.ts", () => {
  const glob = readFileSync(join(ADMIN, "src/lib/sources-ecrans.ts"), "utf8");
  const motifs = [...glob.matchAll(/"(!?\/src\/[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(motifs, MOTIFS_ATTENDUS);
});

test("chaque route des mots-clés existe (un mot-clé orphelin se voit)", () => {
  const routes = new Set(INDEX.ecrans.map((e) => e.route));
  for (const route of Object.keys(SYNONYMES)) assert.ok(routes.has(route), `mot-clé sans écran : ${route}`);
});

test("chaque entrée du menu est un écran de l'index, sous son libellé", () => {
  for (const groupe of MENU)
    for (const entree of groupe.entrees)
      for (const e of [entree, ...(entree.children ?? [])]) {
        const ecran = INDEX.ecrans.find((x) => x.route === e.href);
        assert.ok(ecran, `écran absent : ${e.href}`);
        assert.equal(ecran.titre, e.label);
        assert.equal(ecran.dansLeMenu, true);
      }
});

test("l'aide garde une seule ligne d'écran ; ses rubriques sont lues dans le source", () => {
  const aide = INDEX.ecrans.find((e) => e.route === "/aide");
  assert.ok(aide);
  assert.equal(aide.sections.length, 0);
  const idsRubriques = INDEX.aide.map((r) => r.id);
  for (const id of ["commande-test", "bordereau", "bandeaux-visuels", "traductions", "statistiques"])
    assert.ok(idsRubriques.includes(id), `rubrique absente : ${id}`);
});

/* -------------------------------------------------------------------------- */
/*  Ce que la recherche des écrans doit trouver                               */
/* -------------------------------------------------------------------------- */

test("« bandeau » : Bandeau et offre puis Bandeaux visuels, et la rubrique d'aide des bandeaux", () => {
  const r = chercher("bandeau");
  assert.deepEqual(ids(r.ecrans).slice(0, 2), ["ecran:/bandeau", "ecran:/bandeaux-visuels"]);
  assert.ok(r.ecrans.resultats[0].rang <= 1);
  assert.ok(ids(r.aide).includes("aide:bandeaux-visuels"));
  // Le titre trouvé mène à la rubrique par son ancre ordinaire.
  assert.equal(r.aide.resultats.find((x) => x.id === "aide:bandeaux-visuels").href, "/aide#bandeaux-visuels");
});

test("« bandeaux » : Bandeaux visuels d'abord, Bandeau et offre aussi (le singulier)", () => {
  const r = chercher("bandeaux");
  assert.equal(ids(r.ecrans)[0], "ecran:/bandeaux-visuels");
  assert.ok(ids(r.ecrans).includes("ecran:/bandeau"));
});

test("« bandeau visuel » et « Bandeaux visuels » : Bandeaux visuels en tête", () => {
  for (const q of ["bandeau visuel", "Bandeaux visuels"]) assert.equal(premier(q)?.id, "ecran:/bandeaux-visuels", q);
});

test("les écrans qui ne répondaient pas avant", () => {
  const attendus = {
    statistiques: "/statistiques",
    decors: "/decors",
    archives: "/archives",
    aide: "/aide",
    styles: "/ia/styles",
    "accueil et pied de page": "/contenu",
    "pieces par personnage": "/personnages/correspondances",
    "categories de produits": "/categories-produits",
    // La bibliothèque des pièces et sa création, sorties de Personnages.
    pieces: "/pieces",
    "nouvelle piece": "/pieces/nouvelle",
  };
  for (const [q, route] of Object.entries(attendus)) {
    const p = premier(q);
    assert.equal(p?.id, `ecran:${route}`, q);
    assert.equal(p.href, route, q);
    assert.ok(p.rang <= 1, q);
  }
});

test("« chapeau », « robe »… mènent aux Pièces, tant qu'elles s'appellent « Accessories 1 »", () => {
  for (const q of ["chapeau", "casquette", "lunettes", "t-shirt", "robe"]) {
    const p = premier(q);
    assert.equal(p?.id, "ecran:/pieces", q);
    assert.equal(p.href, "/pieces", q);
  }
});

test("« frais de port » met Livraison en tête, par son mot-clé, au rang exact", () => {
  const p = premier("frais de port");
  assert.equal(p.id, "ecran:/livraison");
  assert.equal(p.rang, 0);
  assert.equal(p.ou, "mot-clé « frais de port »");
});

test("« paypal » et « stripe » mettent Finances en tête", () => {
  for (const q of ["paypal", "stripe"]) assert.equal(premier(q)?.id, "ecran:/finances", q);
});

test("« titre google » et « seo » : la fiche produit, ouverte depuis la liste", () => {
  for (const q of ["titre google", "seo"]) {
    const r = chercher(q).ecrans.resultats.find((x) => x.id.startsWith("ecran:/produits/[id]"));
    assert.ok(r, q);
    assert.equal(r.href, "/produits", q);
    assert.equal(r.detail, "Fiche : s'ouvre depuis la liste", q);
    assert.match(r.titre, /\(fiche\)$/);
  }
});

test("une faute de frappe sur un nom d'écran est corrigée, et annoncée", () => {
  const r = chercher("statistques");
  assert.equal(r.ecrans.resultats[0].id, "ecran:/statistiques");
  assert.equal(r.ecrans.resultats[0].rang, 3);
  assert.deepEqual(r.corrections, [{ tape: "statistques", propose: "statistiques" }]);
  // Un mot trouvé tel quel n'annonce aucune correction.
  assert.deepEqual(chercher("bandeau").corrections, []);
});

test("une section mène à l'écran, avec le passage dans le fragment (jamais dans la query)", () => {
  const r = chercher("bandeau couleur").ecrans.resultats[0];
  assert.equal(r.id.startsWith("ecran:/bandeau§"), true);
  assert.match(r.href, /^\/bandeau#trouver=Couleur/);
  assert.equal(r.href.includes("?"), false);
});

test("au plus trois lignes par écran, et le total compte les lignes retenues", () => {
  const r = chercher("archives", 200);
  const parEcran = new Map();
  for (const x of r.ecrans.resultats) {
    const route = x.id.replace(/^ecran:/, "").replace(/§.*$/, "");
    parEcran.set(route, (parEcran.get(route) ?? 0) + 1);
  }
  for (const [route, n] of parEcran) assert.ok(n <= 3, route);
  assert.equal(r.ecrans.total, r.ecrans.resultats.length);
  assert.equal(chercher("archives", 2).ecrans.resultats.length, 2);
});

test("une saisie sans mot utile ne répond rien, sans erreur", () => {
  for (const q of ["", " ", "…", "%%"]) {
    const r = chercher(q);
    assert.equal(r.ecrans, null, JSON.stringify(q));
    assert.equal(r.aide, null, JSON.stringify(q));
  }
  assert.doesNotThrow(() => chercher("co"));
  assert.doesNotThrow(() => chercher("a_b \\ 50%"));
});

test("une page ajoutée demain est trouvable sans rien écrire (page factice, en mémoire)", () => {
  const sources = {
    ...SOURCES,
    "/src/pages/zz-essai.astro": [
      "---",
      'import Admin from "../layouts/Admin.astro";',
      "---",
      '<Admin title="Écran d\'essai">',
      '  <section id="reglages-zephyr">',
      '    <h2 class="font-semibold">Réglages du zéphyr</h2>',
      "    <p>Un vent doux venu de l'ouest.</p>",
      "  </section>",
      "</Admin>",
    ].join("\r\n"),
  };
  const index = construireIndex(sources, MENU, SYNONYMES);
  const ecran = index.ecrans.find((e) => e.route === "/zz-essai");
  assert.ok(ecran);
  assert.equal(ecran.titre, "Écran d'essai");
  assert.equal(ecran.dansLeMenu, false);

  const section = chercherDansIndex(index, "zephyr", 5).ecrans.resultats[0];
  assert.equal(section.titre, "Écran d'essai");
  assert.equal(section.ou, "Réglages du zéphyr");
  assert.equal(section.detail, "Hors du menu");
  assert.equal(section.href, "/zz-essai#trouver=z%C3%A9phyr&ancre=reglages-zephyr");

  const nom = chercherDansIndex(index, "ecran d essai", 5).ecrans.resultats[0];
  assert.equal(nom.id, "ecran:/zz-essai");
  assert.equal(nom.rang, 0);
});

/* -------------------------------------------------------------------------- */
/*  Corrections de la relecture du 7 octobre                                  */
/* -------------------------------------------------------------------------- */

const hrefs = (r) => [...(r.ecrans?.resultats ?? []), ...(r.aide?.resultats ?? [])].map((x) => x.href);

test("les exemples des champs (placeholder) ne font plus répondre d'écran", () => {
  for (const q of ["Dupont", "salon du livre", "le crotoy", "mers les bains", "nantes"]) {
    const r = chercher(q);
    assert.equal(r.ecrans, null, `${q} : ${hrefs(r).join(" ")}`);
  }
});

test("un lien d'écran ne transporte jamais un mot vide ; un texte non affiché mène à son ancre", () => {
  for (const q of ["code du stand", "mot de passe", "retirer de la liste"])
    for (const h of hrefs(chercher(q))) assert.ok(!/trouver=(du|de|la|dans)(&|$)/.test(h), `${q} → ${h}`);
  // « Retirer de la liste » est l'infobulle d'un bouton : rien à surligner.
  assert.ok(hrefs(chercher("retirer de la liste")).includes("/lettre#ancre=inscrits"));
  // « gras » n'était que le filigrane de l'éditeur d'une lettre.
  assert.ok(!hrefs(chercher("gras")).some((h) => h.startsWith("/lettre#")));
});

test("« mot de passe » : l'expression telle quelle passe devant les mots éparpillés", () => {
  const lignes = chercher("mot de passe").ecrans.resultats.map((x) => x.id);
  const comptes = lignes.findIndex((id) => id.startsWith("ecran:/comptes§"));
  const styles = lignes.findIndex((id) => id.startsWith("ecran:/ia/styles"));
  assert.ok(comptes >= 0 && (styles < 0 || comptes < styles), lignes.join(" "));
  // La section qui suit « Styles archivés » ne s'appelle plus ainsi.
  for (const x of chercher("mot de passe").ecrans.resultats)
    if (x.id.startsWith("ecran:/ia/styles§")) assert.notEqual(x.ou, "Styles archivés");
});

test("des textes d'écran écrits en données (note:) sont trouvables", () => {
  assert.equal(premier("Hors frais de port, et avant les remises")?.id.replace(/§.*$/, ""), "ecran:/finances");
});

test("connus : un mot que les données ont trouvé n'est pas corrigé ici ; premierParSonNom", () => {
  // L'index seul, qui ne connaît pas les affiches, corrige « montagne »…
  assert.deepEqual(chercher("montagne").corrections.map((c) => c.tape), ["montagne"]);
  const sans = chercherDansIndex(INDEX, "montagne", 20, { connus: new Set(["montagne"]) });
  assert.deepEqual(sans.corrections, []);
  assert.equal(sans.ecrans, null);
  assert.ok(motsConnusDesEcrans(INDEX, "vidéo tuto").includes("video"));
  assert.equal(chercher("bandeau").premierParSonNom, true);
  assert.equal(chercher("frais de port").premierParSonNom, false);
});

/* La fusion, avec une fausse API et le vrai index. */

const res = (id, rang) => ({ id, nature: "X", titre: id, titrePassages: [], ou: null, detail: null, extrait: null, href: "/x", image: null, rang });
const groupe = (id, resultats) => ({ id, titre: id, total: resultats.length, plafonne: false, resultats });
function fausseApi(reponse, journal = []) {
  return {
    appelerApi: async (p) => {
      journal.push(p);
      if (reponse instanceof Error) throw reponse;
      return { q: p.q, groupes: [], corrections: [], partiel: false, ...reponse };
    },
    index: () => INDEX,
  };
}

test("fusion : Écrans en tête seulement s'il répond mieux que les données, ou aussi bien par son nom", async () => {
  const paysage = await fusionnerRecherche(fausseApi({ groupes: [groupe("reglages", [res("style-ia:2", 0)])] }), "Paysage");
  assert.equal(paysage.groupes[0].id, "reglages");
  const bandeau = await fusionnerRecherche(fausseApi({ groupes: [groupe("boutique", [res("bandeau-visuel:x", 1)])] }), "bandeau");
  assert.equal(bandeau.groupes[0].id, "ecrans");
  const frais = await fusionnerRecherche(fausseApi({ groupes: [groupe("boutique", [res("page:5", 1)])] }), "frais de port");
  assert.equal(frais.groupes[0].id, "ecrans");
});

test("fusion : aucune moitié ne corrige ce que l'autre a trouvé tel quel", async () => {
  // « montagne » : huit affiches pour l'API, « montant » pour l'index seul.
  const journal = [];
  const r = await fusionnerRecherche(
    fausseApi({ groupes: [groupe("affiches", [res("produit:69", 1)])] }, journal),
    "montagne",
  );
  assert.deepEqual(r.corrections, []);
  assert.ok(!(r.groupes.find((g) => g.id === "ecrans")?.resultats ?? []).some((x) => x.rang === 3));
  // « vidéo » : les écrans la connaissent, l'API reçoit le mot pour ne pas le corriger.
  const j2 = [];
  await fusionnerRecherche(fausseApi({}, j2), "vidéo");
  assert.ok(j2[0].connus.includes("video"), JSON.stringify(j2[0]));
});

test("fusion : l'API en panne laisse les écrans, et le dit", async () => {
  const r = await fusionnerRecherche(fausseApi(new Error("panne")), "bandeau");
  assert.equal(r.partiel, true);
  assert.equal(r.groupes[0].id, "ecrans");
});

test("fusion : le repli corrige un mot connu quand rien n'a été trouvé", async () => {
  const sources = {
    "/src/pages/zz-a.astro": `<Admin title="Écran A"><section id="a"><h2>Affiche personnalisée</h2><p>Le modèle de base.</p></section></Admin>`,
    "/src/pages/zz-b.astro": `<Admin title="Écran B"><p>Le fichier_personalisee_1 a été importé.</p></Admin>`,
  };
  const index = construireIndex(sources, [], {});
  const dep = { appelerApi: async (p) => ({ q: p.q, groupes: [], corrections: [], partiel: false }), index: () => index };
  const r = await fusionnerRecherche(dep, "affiche personalisée");
  assert.ok(r.groupes.find((g) => g.id === "ecrans"), JSON.stringify(r));
  assert.deepEqual(r.corrections, [{ tape: "personalisee", propose: "personnalisee" }]);
});

/* -------------------------------------------------------------------------- */
/*  L'extracteur                                                              */
/* -------------------------------------------------------------------------- */

const textes = (source) => extraireTextes(source).map((m) => `${m.genre}:${m.texte}`);

test("extracteur : fichier en CRLF, commentaires et scripts ignorés", () => {
  const source = [
    "---",
    "const x = 1;",
    "---",
    "<Admin title=\"Essai\">",
    "  {/* Un commentaire qui parle de zéphyr */}",
    "  <!-- un autre commentaire -->",
    "  <h2>Le titre</h2>",
    "  <p>Une phrase",
    "     sur deux lignes.</p>",
    "  <script>const secret = 'ne pas lire';</script>",
    "  <style>.x { color: red }</style>",
    "</Admin>",
  ].join("\r\n");
  const t = textes(source);
  assert.deepEqual(t, ["section:Le titre", "aide:Une phrase sur deux lignes."]);
  assert.ok(extraireTextes(source).every((m) => !m.texte.includes("\r")));
});

test("extracteur : balisage imbriqué dans du code, chaînes de prose, pas de code", () => {
  const source = `<div>
    {ok && (
      <p class="mt-3 text-sm">Texte imbriqué dans une condition.</p>
    )}
    {etat ? "Enregistré." : "Rien n'a changé"}
    <p class={erreur ? "mt-3 rounded border-bo-border sm:grid-cols-2" : "hidden"}>{muettes.length} pièces muettes</p>
    {liste.map((x) => <li>{x.nom}</li>)}
  </div>`;
  const t = textes(source);
  assert.ok(t.includes("aide:Texte imbriqué dans une condition."), t.join(" | "));
  assert.ok(t.includes("aide:Enregistré."), t.join(" | "));
  assert.ok(t.includes("aide:Rien n'a changé"), t.join(" | "));
  assert.ok(t.includes("aide:pièces muettes"), t.join(" | "));
  for (const x of t) {
    assert.ok(!x.includes("muettes.length"), x);
    assert.ok(!/mt-3|rounded|grid-cols/.test(x), x);
    assert.ok(!/=>|\.map\(/.test(x), x);
  }
});

test("extracteur : les balises en ligne ne coupent pas la phrase", () => {
  const t = textes(`<p>Pour un message en texte seul, c'est l'écran <a href="/bandeau">Bandeau et offre</a>, <strong>pas</strong> celui-ci.</p>`);
  assert.deepEqual(t, ["aide:Pour un message en texte seul, c'est l'écran Bandeau et offre, pas celui-ci."]);
});

test("extracteur : genres, libellés d'attributs, ancres statiques seulement", () => {
  const source = `<section id="reglages">
    <h3>Réglages</h3>
    <label><span>Nom du style</span><input name="title" placeholder="Par exemple : Paysage" /></label>
    <button type="button" title="Monter d'un cran">↑</button>
    <div id={\`ligne-\${x.id}\`}><p>Dans une ligne dynamique.</p></div>
    <textarea name="note" placeholder="Une note interne" aria-label="La note de la commande">valeur à ne pas lire</textarea>
    <EditeurTexte nom="corps" etiquette="Corps du texte" invite="Écrivez ici." />
  </section>`;
  const morceaux = extraireTextes(source);
  const par = Object.fromEntries(morceaux.map((m) => [m.texte, m]));
  assert.equal(par["Réglages"].genre, "section");
  assert.equal(par["Réglages"].ancre, "reglages");
  assert.equal(par["Nom du style"].genre, "libelle");
  assert.equal(par["Nom du style"].section, "Réglages");
  assert.equal(par["Nom du style"].origine, undefined);
  // Une infobulle, un texte pour lecteur d'écran : cherchables, mais marqués
  // « attribut » — ils ne s'affichent pas, le lien ne les cherchera pas.
  assert.equal(par["Monter d'un cran"].genre, "libelle");
  assert.equal(par["Monter d'un cran"].origine, "attribut");
  assert.equal(par["La note de la commande"].origine, "attribut");
  assert.equal(par["Dans une ligne dynamique."].ancre, "reglages");
  assert.equal(par["Corps du texte"].genre, "libelle");
  // Les exemples (placeholder) et le filigrane d'un éditeur (invite) ne sont
  // pas le contenu de l'écran : « Dupont » ne doit pas faire répondre l'écran
  // des commandes.
  assert.equal(par["Par exemple : Paysage"], undefined);
  assert.equal(par["Une note interne"], undefined);
  assert.equal(par["Écrivez ici."], undefined);
  assert.equal(par["valeur à ne pas lire"], undefined);
});

test("extracteur : la section se ferme avec son conteneur, un titre à plusieurs chaînes ne nomme rien", () => {
  const source = `<div>
  <section class="mb-8">
    <h2>Styles archivés</h2>
    <p>Retirés du site.</p>
  </section>
  <form id="form-style">
    <label><span>Consigne envoyée au modèle</span><textarea name="prompt"></textarea></label>
  </form>
  <section id="lettre-ouverte">
    <header><h2>{creation ? "Nouvelle lettre" : modifiable ? "Modifier la lettre" : "Lettre envoyée"}</h2></header>
    <p>Le contenu de la lettre.</p>
  </section>
  <section id="bordereau">
    <header><h3>Bordereau</h3></header>
    <p>Choisissez le transporteur.</p>
  </section>
</div>`;
  const par = Object.fromEntries(extraireTextes(source).map((m) => [m.texte, m]));
  assert.equal(par["Retirés du site."].section, "Styles archivés");
  assert.equal(par["Consigne envoyée au modèle"].section, null);
  // Les trois titres possibles restent cherchables, aucun ne nomme la section.
  for (const t of ["Nouvelle lettre", "Modifier la lettre", "Lettre envoyée"]) assert.equal(par[t]?.genre, "libelle", t);
  assert.equal(par["Le contenu de la lettre."].section, null);
  // Un titre emballé seul dans un <header> nomme bien ce qui suit.
  assert.equal(par["Choisissez le transporteur."].section, "Bordereau");
});

test("extracteur : textes de l'entête (SECTIONS), concaténations et ${}", () => {
  const source = `---
const SECTIONS = [
  {
    titre: "Pied de page",
    champs: [
      { key: "footer.baseline", label: "Baseline", aide: "La phrase sous le logo, " + "en bas de chaque page." },
      { key: "x", label: \`Libellé \${nom} calculé\` },
    ],
  },
];
---
<Admin title={creation ? "Nouveau bandeau visuel" : \`Bandeau visuel : \${nom}\`}>
</Admin>`;
  const t = textes(source);
  assert.ok(t.includes("section:Pied de page"), t.join(" | "));
  assert.ok(t.includes("libelle:Baseline"), t.join(" | "));
  assert.ok(t.includes("aide:La phrase sous le logo, en bas de chaque page."), t.join(" | "));
  assert.ok(t.includes("libelle:Libellé … calculé"), t.join(" | "));
  // note:, nom:, detail: — seulement quand c'est de la prose : « nom:
  // "description" » est un nom de champ, pas un texte de l'écran.
  const autres = textes(`---
const PERIODES = [{ nom: "Par mois", cle: "mois" }, { nom: "description" }];
const CA = { note: "Hors frais de port, et avant les remises.", detail: "À la main (virement, chèque, espèces)" };
---
<p>x</p>`);
  assert.ok(autres.includes("libelle:Par mois"), autres.join(" | "));
  assert.ok(autres.includes("aide:Hors frais de port, et avant les remises."), autres.join(" | "));
  assert.ok(autres.includes("aide:À la main (virement, chèque, espèces)"), autres.join(" | "));
  assert.ok(!autres.some((x) => x.endsWith(":description")), autres.join(" | "));
  assert.equal(extraireTextes(source).find((m) => m.texte === "Baseline").section, "Pied de page");
  assert.equal(titreAdmin(source), "Bandeau visuel");
  assert.equal(titreAdmin(`<Admin title="Livraison">x</Admin>`), "Livraison");
  assert.equal(titreAdmin(`<Admin title={nom}>x</Admin>`), null);
});

test("extracteur : composants importés et rubriques d'aide", () => {
  const page = `---
import Admin from "../layouts/Admin.astro";
import OrderTable from "../components/OrderTable.astro";
import EditeurTexte from "../../components/EditeurTexte.astro";
---
<Admin title="x"></Admin>`;
  assert.deepEqual(composantsImportes(page), ["OrderTable", "EditeurTexte"]);

  const aide = `<Admin title="Aide">
  <details id="premiere" class="group">
    <summary class="px-4">Comment faire la première chose ?</summary>
    <div><p>On clique <a href="/x">ici</a>.</p><details><summary>Détail</summary><p>Imbriqué.</p></details></div>
  </details>
  <details><summary>Sans id</summary><p>Pas une rubrique.</p></details>
</Admin>`;
  const rubriques = rubriquesAide(aide);
  assert.equal(rubriques.length, 1);
  assert.equal(rubriques[0].id, "premiere");
  assert.equal(rubriques[0].titre, "Comment faire la première chose ?");
  assert.deepEqual(rubriques[0].morceaux.map((m) => m.texte), ["On clique ici.", "Détail", "Imbriqué."]);
});

test("extracteur : aucun morceau de code dans les vraies pages", () => {
  const code = /\.length|\.map\(|=>|\bconst\b|\breturn\b|\w+\.\w+\(|\w\?\.|\bundefined\b|className|===|!==|&&|\|\|/;
  for (const [cle, source] of Object.entries(SOURCES))
    for (const m of extraireTextes(source)) assert.ok(!code.test(m.texte), `${cle} : ${m.texte}`);
});

/* -------------------------------------------------------------------------- */
/*  Cartes Trello du 8 octobre (lot C : relance, bandeau, promotions, essai)  */
/* -------------------------------------------------------------------------- */

test("D3 : « mail » et « modifier le mail » mènent au Courriel de relance (3 premiers)", () => {
  for (const q of ["mail", "modifier le mail"]) {
    const trois = ids(chercher(q).ecrans).slice(0, 3);
    assert.ok(trois.includes("ecran:/paniers/courriel"), `${q} : ${trois.join(" ")}`);
  }
  // L'écran a son entrée de menu, sous les paniers abandonnés.
  assert.equal(INDEX.ecrans.find((e) => e.route === "/paniers/courriel")?.dansLeMenu, true);
});

test("D10 : « annonces » et « messages qui défilent » mènent au Bandeau d'annonce ; « offre » aux Promotions", () => {
  for (const q of ["annonces", "messages qui defilent"]) assert.equal(premier(q)?.id, "ecran:/bandeau", q);
  assert.equal(premier("affiche offerte")?.id.replace(/§.*$/, ""), "ecran:/promotions");
});

test("D12 : hors essai, l'aide des tests et la sortie de la boîte d'essai ne sont pas proposées", async () => {
  const { retirerCeQuiNeVautQuEnEssai, HORS_ESSAI } = await import("../src/lib/mode-essai.ts");
  const r = (id, ou = null) => ({ id, nature: "X", titre: id, titrePassages: [], ou, detail: null, extrait: null, href: "/x", image: null, rang: 1 });
  const reponse = {
    q: "essai",
    corrections: [],
    partiel: false,
    groupes: [
      { id: "ecrans", titre: "Écrans", total: 3, plafonne: false, resultats: [
        r("ecran:/courriers§3", "Le jour où les courriers devront vraiment partir"),
        r("ecran:/courriers§1", "Les courriers"),
        r("ecran:/paniers"),
      ] },
      { id: "aide", titre: "Aide", total: 2, plafonne: false, resultats: [r("aide:commande-test"), r("aide:courriers-essai")] },
    ],
  };
  const hors = retirerCeQuiNeVautQuEnEssai(reponse, HORS_ESSAI);
  assert.deepEqual(hors.groupes.map((g) => g.id), ["ecrans"]);
  assert.deepEqual(ids(hors.groupes[0]), ["ecran:/courriers§1", "ecran:/paniers"]);
  assert.equal(hors.groupes[0].total, 2);
  // En essai (paiements et courriers), tout reste.
  const enEssai = retirerCeQuiNeVautQuEnEssai(reponse, { paiement: true, courriers: true, colis: true, essai: true });
  assert.deepEqual(enEssai, reponse);
  // Le source garde les deux rubriques : la recherche les connaît, et les écarte hors essai.
  for (const id of ["commande-test", "courriers-essai"]) assert.ok(INDEX.aide.some((x) => x.id === id), id);
});

/* -------------------------------------------------------------------------- */
/*  Cartes Trello du 8 octobre (lot B : vendeurs, retrait, factures)          */
/* -------------------------------------------------------------------------- */

const ecranDe = (q) => premier(q)?.id.replace(/§.*$/, "");

test("D8 : « siret » et « adresse de la boutique » mènent à l'écran Factures", () => {
  for (const q of ["siret", "adresse de la boutique"]) assert.equal(ecranDe(q), "ecran:/facturation", q);
  assert.equal(INDEX.ecrans.find((e) => e.route === "/facturation")?.dansLeMenu, true);
});

test("D7 : « chalet » et « lieu de retrait » mènent aux Lieux de retrait", () => {
  for (const q of ["chalet", "lieu de retrait"]) assert.equal(ecranDe(q), "ecran:/livraison/lieux", q);
  assert.equal(INDEX.ecrans.find((e) => e.route === "/livraison/lieux")?.dansLeMenu, true);
});

test("D6 : « rattacher un stand » mène à Comptes ; les rubriques d'aide du lot existent", () => {
  assert.equal(ecranDe("rattacher un stand"), "ecran:/comptes");
  for (const id of ["vendeurs-stands", "lieux-retrait", "factures-mentions"])
    assert.ok(INDEX.aide.some((x) => x.id === id), id);
});

/* -------------------------------------------------------------------------- */
/*  Cartes Trello du 8 octobre (lot A : catalogue et couleurs)                */
/* -------------------------------------------------------------------------- */

/** Les trois premiers écrans trouvés, sans leur section. */
const troisPremiers = (q) =>
  (chercher(q).ecrans?.resultats ?? []).slice(0, 3).map((r) => r.id.replace(/§.*$/, ""));

test("D1 : « nuancier » et « ordre des couleurs » mènent à Catégories de pièces", () => {
  for (const q of ["nuancier", "ordre des couleurs"])
    assert.ok(troisPremiers(q).includes("ecran:/categories-pieces"), q);
});

test("D2 : « ordre des affiches » et « trier les affiches » mènent à Ordre d'affichage", () => {
  for (const q of ["ordre des affiches", "trier les affiches", "ordre d'apparition"])
    assert.ok(troisPremiers(q).includes("ecran:/produits/ordre"), q);
});

test("D4 : « appliquer à tout » et « modifier en masse » mènent à la modification groupée", () => {
  for (const q of ["appliquer à tout", "modifier en masse"])
    assert.ok(troisPremiers(q).includes("ecran:/produits/modifier-en-masse"), q);
});

/* -------------------------------------------------------------------------- */
/*  BO › Redirections (les notes de mise en ligne y envoient)                 */
/* -------------------------------------------------------------------------- */

test("« redirection », « 301 », « ancienne adresse » mènent à l'écran Redirections, et à sa rubrique d'aide", () => {
  for (const q of ["redirection", "redirections", "301", "ancienne adresse", "redirections d'url", "lien cassé"])
    assert.equal(ecranDe(q), "ecran:/redirections", q);
  assert.equal(INDEX.ecrans.find((e) => e.route === "/redirections")?.dansLeMenu, true);
  assert.ok(INDEX.aide.some((x) => x.id === "redirections-shopify"));
  assert.ok(ids(chercher("redirection").aide).includes("aide:redirections-shopify"));
});

/* -------------------------------------------------------------------------- */
/*  BO › Réglages › Paiements (clés Stripe et PayPal, passage en réel)        */
/* -------------------------------------------------------------------------- */

test("« paiements », « clés stripe », « passer en réel » mènent à l'écran Paiements", () => {
  // Le serveur de dev ne relit pas le glob pour une page AJOUTÉE après son
  // démarrage : ces essais, eux, lisent le disque, et disent que l'index
  // d'un build neuf (la prod) la trouve.
  for (const q of ["paiements", "clés stripe", "passer en réel"])
    assert.equal(premier(q)?.id, "ecran:/paiements", q);
  assert.equal(INDEX.ecrans.find((e) => e.route === "/paiements")?.dansLeMenu, true);
  // Seuls, « stripe » et « paypal » mènent toujours à l'argent (les Finances).
  for (const q of ["paypal", "stripe"]) assert.equal(premier(q)?.id, "ecran:/finances", q);
});
