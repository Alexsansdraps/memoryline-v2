/**
 * La traduction des pages du site dans les six langues d'un coup
 * (lib/traductions-pages.ts, A-FAIRE § 2, Alexandra le 28/11 : « finis le à
 * faire » — le bouton « dans toutes les langues » de la fiche produit
 * manquait à l'éditeur de page). Sans navigateur, sans API, sans base.
 *
 * Lancés par : docker exec -w /app/apps/admin memoryline-admin node --test "tests/*.test.mjs"
 *
 * Ce que ces essais gardent :
 *   - seuls les champs VIDES dont le français existe sont proposés : une
 *     traduction écrite à la main n'est jamais remplacée ;
 *   - un long texte part en morceaux complets (jamais au milieu d'une liste),
 *     recollés dans l'ordre ; un morceau perdu, et le texte n'est pas proposé ;
 *   - une langue qui échoue n'empêche pas les autres ;
 *   - ce qui part à l'API quand on enregistre, et le recalage des traductions
 *     que le site ne montre plus qu'en partie (page Confidentialité).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  champsManquants,
  corpsDepuisBlocs,
  desalignee,
  enumerer,
  languesDesalignees,
  memeSaisie,
  messageDesPropositions,
  morceauxHtml,
  proposerLangues,
  rangerLeFrancais,
  saisieEnregistree,
  segmentsHtml,
  traductionAEnvoyer,
  traductionRecalee,
} from "../src/lib/traductions-pages.ts";

const vide = { titre: "", corps: "", seoTitle: "", seoDescription: "" };
const FR = {
  titre: "Conditions générales de vente",
  corps: "<p>Bonjour.</p>",
  seoTitle: "CGV — Memory Line",
  seoDescription: "",
};

/** Un faux service de traduction : « [en] » devant chaque texte, balises gardées. */
function fauxTraducteur({ echoue = () => null, oublie = () => false, delai = 0 } = {}) {
  const appels = [];
  let enCours = 0;
  let auPlus = 0;
  const proposer = async (langue, champs) => {
    appels.push({ langue, champs });
    enCours++;
    auPlus = Math.max(auPlus, enCours);
    try {
      await new Promise((r) => setTimeout(r, delai));
      const raison = echoue(langue, champs);
      if (raison) throw new Error(raison);
      const rendu = {};
      for (const [cle, texte] of Object.entries(champs)) {
        if (oublie(langue, cle)) continue;
        rendu[cle] = texte.replace(/>([^<]+)</g, `>[${langue}] $1<`).replace(/^([^<]+)$/, `[${langue}] $1`);
      }
      return { champs: rendu };
    } finally {
      enCours--;
    }
  };
  return { proposer, appels, auPlus: () => auPlus };
}

/* -------------------------------------------------------------------------- */
/*  Ce qui est proposé                                                         */
/* -------------------------------------------------------------------------- */

test("seuls les champs vides dont le français existe sont proposés", () => {
  assert.deepEqual(champsManquants(FR, vide), {
    titre: FR.titre,
    corps: FR.corps,
    seoTitle: FR.seoTitle,
  });
  // Écrit à la main (ou tapé), même un seul caractère : jamais remplacé.
  assert.deepEqual(
    champsManquants(FR, { ...vide, titre: "Terms of sale", corps: "<p>Hi.</p>" }),
    { seoTitle: FR.seoTitle },
  );
  // Des espaces seuls ne sont pas une traduction.
  assert.deepEqual(champsManquants(FR, { ...vide, titre: "   " }).titre, FR.titre);
  // Tout est traduit : rien à proposer.
  assert.deepEqual(
    champsManquants(FR, { titre: "a", corps: "b", seoTitle: "c", seoDescription: "" }),
    {},
  );
});

/* -------------------------------------------------------------------------- */
/*  Les morceaux d'un long texte                                               */
/* -------------------------------------------------------------------------- */

const LONG =
  "<h2>Article 1</h2><p>" + "a".repeat(30) + "</p>" +
  "<ul><li><p>" + "b".repeat(30) + "</p></li><li>" + "c".repeat(30) + "</li></ul>" +
  "<p>Fin <strong>en gras</strong><br>et <a href=\"https://x.fr\">un lien</a>.</p>" +
  "<h3>Article 2</h3><p><img src=\"/api/assets/a.png\" alt=\"Une image\"></p>";

test("les segments sont les éléments de premier niveau, entiers, au caractère près", () => {
  const s = segmentsHtml(LONG);
  assert.equal(s.join(""), LONG);
  assert.deepEqual(
    s.map((x) => x.slice(0, 4)),
    ["<h2>", "<p>a", "<ul>", "<p>F", "<h3>", "<p><"],
  );
  // La liste reste entière, avec ses paragraphes intérieurs.
  assert.ok(s[2].startsWith("<ul>") && s[2].endsWith("</ul>"));
});

test("un texte court part entier ; un long texte, en morceaux recollables", () => {
  assert.deepEqual(morceauxHtml("  <p>court</p> "), ["<p>court</p>"]);
  assert.deepEqual(morceauxHtml("   "), []);
  const m = morceauxHtml(LONG, 80);
  assert.ok(m.length > 1);
  assert.equal(m.join(""), LONG);
  // Chaque morceau est complet : autant de balises ouvertes que fermées.
  for (const x of m) {
    const ouvertes = (x.match(/<(p|ul|li|h2|h3|strong|a)\b/g) ?? []).length;
    const fermees = (x.match(/<\/(p|ul|li|h2|h3|strong|a)>/g) ?? []).length;
    assert.equal(ouvertes, fermees, x);
  }
  // Un élément plus long que la taille visée fait un morceau à lui seul.
  assert.ok(m.some((x) => x.startsWith("<ul>") && x.endsWith("</ul>")));
});

test("un HTML mal fermé ne se coupe pas", () => {
  const casse = "<p>" + "x".repeat(200) + "<p>" + "y".repeat(200);
  assert.deepEqual(morceauxHtml(casse, 50), [casse]);
});

/* -------------------------------------------------------------------------- */
/*  La proposition dans plusieurs langues                                      */
/* -------------------------------------------------------------------------- */

test("six langues : un appel par langue pour une page courte, rien d'enregistré", async () => {
  const t = fauxTraducteur();
  const langues = ["en", "de", "it", "es", "ja", "zh"];
  const r = await proposerLangues(
    langues.map((langue) => ({ langue, manque: champsManquants(FR, vide) })),
    t.proposer,
  );
  assert.equal(t.appels.length, 6);
  assert.deepEqual(Object.keys(r), langues);
  assert.deepEqual(r.ja.propositions, {
    titre: "[ja] Conditions générales de vente",
    corps: "<p>[ja] Bonjour.</p>",
    seoTitle: "[ja] CGV — Memory Line",
  });
  assert.equal(r.ja.erreur, undefined);
});

test("un long texte : morceaux traduits ensemble, recollés dans l'ordre", async () => {
  const t = fauxTraducteur({ delai: 5 });
  const r = await proposerLangues(
    [{ langue: "ja", manque: { titre: "CGV", corps: LONG } }],
    t.proposer,
    { taille: 80 },
  );
  const morceaux = morceauxHtml(LONG, 80);
  assert.equal(t.appels.length, morceaux.length);
  // Le nom part avec le premier morceau.
  assert.deepEqual(Object.keys(t.appels[0].champs), ["titre", "corps.0"]);
  assert.equal(r.ja.propositions.titre, "[ja] CGV");
  assert.equal(
    r.ja.propositions.corps,
    morceaux.map((m) => m.replace(/>([^<]+)</g, ">[ja] $1<")).join(""),
  );
  assert.equal(r.ja.erreur, undefined);
});

test("un morceau perdu : pas de texte à trous, le reste est gardé, l'erreur est dite", async () => {
  const t = fauxTraducteur({ oublie: (langue, cle) => langue === "zh" && cle === "corps.1" });
  const r = await proposerLangues(
    [
      { langue: "en", manque: { titre: "CGV", corps: LONG } },
      { langue: "zh", manque: { titre: "CGV", corps: LONG } },
    ],
    t.proposer,
    { taille: 80 },
  );
  assert.ok(r.en.propositions.corps);
  assert.equal(r.zh.propositions.corps, undefined);
  assert.equal(r.zh.propositions.titre, "[zh] CGV");
  assert.match(r.zh.erreur, /incomplète/);
});

test("une langue qui échoue n'empêche pas les autres", async () => {
  const t = fauxTraducteur({
    echoue: (langue) => (langue === "de" ? "Le service de traduction a refusé : quota" : null),
  });
  const r = await proposerLangues(
    ["en", "de"].map((langue) => ({ langue, manque: { titre: "CGV" } })),
    t.proposer,
  );
  assert.deepEqual(r.en, { propositions: { titre: "[en] CGV" } });
  assert.deepEqual(r.de, { propositions: {}, erreur: "Le service de traduction a refusé : quota" });
});

test("jamais plus d'appels simultanés que permis", async () => {
  const t = fauxTraducteur({ delai: 10 });
  await proposerLangues(
    ["en", "de", "it", "es", "ja", "zh"].map((langue) => ({ langue, manque: { titre: "a", corps: LONG } })),
    t.proposer,
    { taille: 80, simultanes: 4 },
  );
  assert.ok(t.appels.length > 6);
  assert.ok(t.auPlus() <= 4, `au plus ${t.auPlus()} appels ensemble`);
});

test("une réponse bavarde ne remplit pas un champ non demandé", async () => {
  const r = await proposerLangues([{ langue: "en", manque: { titre: "CGV" } }], async () => ({
    champs: { titre: "Terms", corps: "<p>Inventé</p>", seoTitle: "Inventé" },
  }));
  assert.deepEqual(r.en.propositions, { titre: "Terms" });
});

test("le message dit ce qui est proposé, et ce qui a échoué", () => {
  const nom = (c) => ({ en: "anglais", de: "allemand", ja: "japonais", zh: "chinois" })[c];
  assert.match(messageDesPropositions({}, nom).message, /^Rien à proposer/);
  const partiel = messageDesPropositions(
    {
      en: { propositions: { titre: "x" } },
      ja: { propositions: { titre: "y" } },
      zh: { propositions: {}, erreur: "Le service ne répond pas" },
    },
    nom,
  );
  assert.equal(partiel.erreur, false);
  assert.match(partiel.message, /^Traductions proposées en anglais et japonais, pour les champs vides/);
  assert.match(partiel.message, /Pas de proposition complète en chinois : Le service ne répond pas\./);
  assert.match(partiel.message, /Rien n'est enregistré pour l'instant/);
  const rien = messageDesPropositions(
    {
      en: { propositions: {}, erreur: "Il manque OPENAI_API_KEY." },
      de: { propositions: {}, erreur: "Il manque OPENAI_API_KEY." },
    },
    nom,
  );
  assert.deepEqual(rien, { message: "Aucune traduction proposée : Il manque OPENAI_API_KEY.", erreur: true });
  assert.equal(enumerer(["anglais", "allemand", "japonais"]), "anglais, allemand et japonais");
});

/* -------------------------------------------------------------------------- */
/*  Ce qui part quand on enregistre                                            */
/* -------------------------------------------------------------------------- */

const titre = (texte, niveau = 2) => ({ type: "titre", texte, niveau });
const texte = (html) => ({ type: "texte", html });
const grille = { type: "produits", source: "affiches", reference: "12", references: ["12"], limite: 1 };

test("le français en morceaux est réuni d'un seul tenant, les grilles après", () => {
  const r = rangerLeFrancais([texte("<p>A</p>"), titre("Prix & délais"), grille, texte("<p>B</p>")]);
  assert.equal(r.aRanger, true);
  assert.deepEqual(r.blocs, [texte("<p>A</p><h2>Prix &amp; délais</h2><p>B</p>"), grille]);
  assert.deepEqual(rangerLeFrancais(r.blocs).aRanger, false);
});

test("une langue : vide = effacée ; texte en face du texte, grilles recopiées", () => {
  const rangee = rangerLeFrancais([texte("<p>A</p>"), grille]);
  assert.equal(traductionAEnvoyer(vide, rangee), null);
  assert.deepEqual(traductionAEnvoyer({ ...vide, titre: " Terms " }, rangee), {
    title: "Terms",
    seoTitle: "",
    seoDescription: "",
  });
  assert.deepEqual(traductionAEnvoyer({ ...vide, corps: "<p>A en</p>" }, rangee).blocks, [
    texte("<p>A en</p>"),
    grille,
  ]);
  // Un texte traduit face à un français sans texte : refusé, en mots simples.
  assert.throws(
    () => traductionAEnvoyer({ ...vide, corps: "<p>x</p>" }, rangerLeFrancais([grille]), "en anglais"),
    /Le texte français de cette page est vide \(texte en anglais\)/,
  );
});

test("une saisie inchangée n'est pas renvoyée (aux espaces près)", () => {
  const enregistree = { title: "Terms", blocks: [texte("<p>Hi</p>")], seoTitle: "T" };
  const s = saisieEnregistree(enregistree);
  assert.deepEqual(s, { titre: "Terms", corps: "<p>Hi</p>", seoTitle: "T", seoDescription: "" });
  assert.ok(memeSaisie({ ...s, titre: " Terms " }, s));
  assert.ok(!memeSaisie({ ...s, seoDescription: "nouveau" }, s));
  // Le navigateur renvoie chaque « \n » d'un champ en « \r\n » : une langue
  // relue sans y toucher n'est pas « modifiée » pour autant.
  const avecLignes = saisieEnregistree({ title: "T", blocks: [texte("<p>a</p>\n<p>b</p>")] });
  assert.ok(memeSaisie({ ...avecLignes, corps: "<p>a</p>\r\n<p>b</p>" }, avecLignes));
});

test("Confidentialité : une traduction en 17 morceaux face à un français d'un seul tenant", () => {
  // La forme relevée sur la copie locale de la prod le 28/11.
  const francais = [texte("<p>Cette page explique…</p><h2>Qui</h2><p>…</p>")];
  const morceauxEn = [texte("<p><em>This page is a translation…</em></p><p>This page explains…</p>")];
  for (let i = 0; i < 8; i++) morceauxEn.push(titre(`Section ${i}`), texte(`<p>Part ${i}</p>`));
  const en = { title: "Privacy policy", blocks: morceauxEn, seoTitle: "Privacy" };
  assert.equal(morceauxEn.length, 17);
  assert.ok(desalignee(en.blocks, francais));
  assert.deepEqual(languesDesalignees(francais, { en, de: { title: "Datenschutz" } }), ["en"]);

  const recalee = traductionRecalee(en, rangerLeFrancais(francais));
  // Tout le texte, sans changer un mot, en face de l'unique bloc français ;
  // le nom repart (sinon il serait effacé), le référencement est gardé tel
  // quel par l'API (clé absente).
  assert.deepEqual(recalee, { title: "Privacy policy", blocks: [texte(corpsDepuisBlocs(morceauxEn))] });
  assert.match(recalee.blocks[0].html, /Section 7<\/h2><p>Part 7<\/p>$/);
});

test("une traduction déjà calée, ou sans texte, n'est pas renvoyée", () => {
  const rangee = rangerLeFrancais([texte("<p>A</p>"), grille]);
  assert.equal(traductionRecalee({ title: "T", blocks: [texte("<p>a</p>"), grille] }, rangee), null);
  // Les grilles ne comptent pas : elles viennent toujours du français.
  assert.equal(traductionRecalee({ title: "T", blocks: [texte("<p>a</p>")] }, rangee), null);
  assert.equal(traductionRecalee({ title: "T" }, rangee), null);
  // Face à un français sans texte, on ne touche à rien.
  assert.equal(
    traductionRecalee({ title: "T", blocks: [texte("<p>a</p>"), titre("b")] }, rangerLeFrancais([grille])),
    null,
  );
});

test("conditions de vente : français ET traductions en 29 morceaux, calés tant qu'on n'y touche pas", () => {
  const morceaux = (suffixe) => {
    const b = [texte(`<p>Intro${suffixe}</p>`)];
    for (let i = 0; i < 14; i++) b.push(titre(`Art. ${i}${suffixe}`), texte(`<p>${i}${suffixe}</p>`));
    return b;
  };
  const francais = morceaux("");
  const de = { title: "AGB", blocks: morceaux(" de") };
  assert.equal(francais.length, 29);
  assert.deepEqual(languesDesalignees(francais, { de }), []);
  // Au premier enregistrement, le français est réuni : l'allemand doit
  // suivre, sinon le site n'en montrerait plus que l'introduction.
  const rangee = rangerLeFrancais(francais);
  assert.equal(rangee.aRanger, true);
  const recalee = traductionRecalee(de, rangee);
  assert.equal(recalee.blocks.length, 1);
  assert.equal(recalee.blocks[0].html, corpsDepuisBlocs(de.blocks));
});
