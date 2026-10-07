/**
 * Les essais de la recherche du back-office, sans base de données.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/recherche.test.ts
 *
 * Ils couvrent ce qui ne se voit pas à l'œil dans le panneau : que l'API, le
 * back-office et le script d'arrivée aplatissent EXACTEMENT de la même façon,
 * que la base garde au moins ce que le JavaScript garde, que les liens
 * survivent à n'importe quel caractère, et que chaque source mène au bon
 * endroit de son écran. Toutes les données sont factices.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aplatir,
  aplatirAvecCarte,
  chiffresTelephone,
  comparer,
  compacter,
  couperExtrait,
  decouper,
  distance,
  emplacementComplet,
  evaluer,
  intervalleOrigine,
  jetons,
  lienRecherche,
  lireCible,
  motsDe,
  passageACibler,
  preparerRequete,
  texteDeHtml,
  type ChampEvalue,
} from "@memoryline/types/recherche";
import {
  LETTRES_ACCENTUEES,
  LETTRES_PLATES,
  SEPARATEURS,
  ancienNumero,
  motif,
  motifNumeroCommande,
  motifsFacture,
} from "../src/recherche-sql.ts";
import {
  ficheCarte,
  ficheCommande,
  fichesBandeauxVisuels,
  fichesCollections,
  fichesCourrielsRelance,
  fichesLettres,
  fichesModesLivraison,
  fichesPages,
  fichesStands,
  fichesTextesDuSite,
  cibleCodeCarte,
  versResultat,
  type EnfantsCommande,
  type LigneCommande,
} from "../src/recherche-extraction.ts";

/* -------------------------------------------------------------------------- */
/*  Aplatir                                                                   */
/* -------------------------------------------------------------------------- */

test("aplatir : les exemples du contrat", () => {
  assert.equal(aplatir("L’Apéro-Œuvre_2"), "l apero oeuvre 2");
  assert.equal(aplatir("SAINT-VALERY-SUR-SOMME"), "saint valery sur somme");
  assert.equal(aplatir("AULT_Falaises_-_Affiche_personnalisee"), "ault falaises affiche personnalisee");
  assert.equal(aplatir("jean.dupont@example.com"), "jean dupont@example com");
  assert.equal(aplatir("  Promo 50% — 30€  "), "promo 50% 30€");
  assert.equal(aplatir("Straße ﬁn æon"), "strasse fin aeon");
});

test("aplatir et aplatirAvecCarte disent la même chose, carte comprise", () => {
  const corpus = [
    "",
    "   ",
    "Éléonore à l'Île-de-France",
    "Cœur ŒUVRE Æsir",
    "été (accents combinants)",
    "espace insécable et fine",
    "ligne 1\r\nligne 2\tfin",
    "émojis 🎉✨ au milieu 👩‍👩‍👧",
    "ΟΔΟΣ grec",
    "İstanbul",
    "moitié \ud800 isolée",
    "50% @maison 30€",
  ];
  for (const t of corpus) {
    const { plat, carte } = aplatirAvecCarte(t);
    assert.equal(plat, aplatir(t), t);
    assert.equal(carte.length, plat.length + 1, t);
    for (let i = 1; i < carte.length; i++) assert.ok(carte[i]! >= carte[i - 1]!, t);
    assert.equal(carte[carte.length - 1], t.length, t);
  }
});

test("aplatir : la table ASCII rapide dit ce que dirait le chemin complet", () => {
  for (let code = 0; code < 128; code++) {
    const c = String.fromCharCode(code);
    const attendu = /^[\p{L}\p{N}@%€]$/u.test(c.normalize("NFD").toLowerCase()) ? c.toLowerCase() : " ";
    assert.equal(aplatir(`a${c}b`), attendu === " " ? "a b" : `a${attendu}b`, `code ${code}`);
  }
});

test("intervalleOrigine : du texte aplati au texte d'origine", () => {
  const t = "Le Cœur de l’été";
  const { plat, carte } = aplatirAvecCarte(t);
  const p = plat.indexOf("coeur");
  const passage = intervalleOrigine(t, carte, p, p + "coeur".length);
  assert.equal(t.slice(passage.debut, passage.fin), "Cœur");
  const q = plat.indexOf("ete");
  const ete = intervalleOrigine(t, carte, q, q + 3);
  assert.equal(t.slice(ete.debut, ete.fin), "été");
  // Un accent combinant reste avec sa lettre.
  const c = "café noir";
  const r = aplatirAvecCarte(c);
  const cafe = intervalleOrigine(c, r.carte, 0, 4);
  assert.equal(c.slice(cafe.debut, cafe.fin), "café");
});

/* -------------------------------------------------------------------------- */
/*  La saisie                                                                 */
/* -------------------------------------------------------------------------- */

test("jetons : lettres isolées retirées, chiffres gardés, dédoublonnés, huit au plus", () => {
  assert.deepEqual(jetons("l'apero"), ["apero"]);
  assert.deepEqual(jetons("SAL-1"), ["sal", "1"]);
  assert.deepEqual(jetons("3 affiches achetées"), ["3", "affiches", "achetees"]);
  assert.deepEqual(jetons("50 %"), ["50"]);
  // Des lettres isolées seules ne cherchent rien (« a_b » ramenait les deux
  // tiers du catalogue).
  assert.deepEqual(jetons("a_b"), []);
  assert.deepEqual(jetons("x 1"), ["1"]);
  assert.deepEqual(jetons("Biarritz biarritz BIARRITZ"), ["biarritz"]);
  assert.equal(jetons("un deux trois quatre cinq six sept huit neuf dix").length, 8);
  assert.deepEqual(jetons("\\"), []);
});

test("compacter et chiffresTelephone", () => {
  assert.equal(compacter("web 0013"), "WEB0013");
  assert.equal(compacter("WEB-0013"), "WEB0013");
  assert.equal(compacter("#1042"), "1042");
  assert.equal(compacter("acef-hjkl.ruwx"), "ACEFHJKLRUWX");
  assert.equal(chiffresTelephone("+33 6 12 34 56 78"), "0612345678");
  assert.equal(chiffresTelephone("0033 (6) 12-34"), "061234");
  assert.equal(chiffresTelephone("06.12.34.56.78"), "0612345678");
});

test("distance : bornée, inversion de deux lettres comptée une fois", () => {
  assert.equal(distance("biarritz", "biarritz", 1), 0);
  assert.equal(distance("biaritz", "biarritz", 1), 1);
  assert.equal(distance("berjer", "berger", 1), 1);
  assert.equal(distance("ab", "ba", 1), 1);
  assert.equal(distance("kitten", "sitting", 3), 3);
  assert.equal(distance("kitten", "sitting", 2), 3);
  assert.equal(distance("court", "beaucoup plus long", 2), 3);
});

test("preparerRequete : singulier léger et corrections des seuls mots inconnus", () => {
  const vocabulaire = new Set(["biarritz", "berger", "amiens", "port", "porte", "bandeau", "fort"]);
  const bandeaux = preparerRequete("bandeaux", vocabulaire);
  assert.deepEqual(bandeaux.jetons[0]?.variantes, ["bandeau"]);
  assert.deepEqual(bandeaux.corrections, []);

  const biaritz = preparerRequete("biaritz", vocabulaire);
  assert.deepEqual(biaritz.jetons[0]?.corrections, ["biarritz"]);
  assert.deepEqual(biaritz.corrections, [{ tape: "biaritz", propose: "biarritz" }]);

  assert.deepEqual(preparerRequete("berjer", vocabulaire).corrections, [{ tape: "berjer", propose: "berger" }]);
  // « amien » commence « amiens » : il trouve déjà, on ne le corrige pas.
  assert.deepEqual(preparerRequete("amien", vocabulaire).jetons[0]?.corrections, []);
  // « port » existe : jamais « approché » vers « porte » ou « fort ».
  assert.deepEqual(preparerRequete("port", vocabulaire).jetons[0]?.corrections, []);
  // Sans vocabulaire, rien n'est corrigé.
  assert.deepEqual(preparerRequete("biaritz").corrections, []);
});

test("motsDe : quatre lettres au moins, sans chiffre, coupé à l'arobase", () => {
  assert.deepEqual(motsDe("Jean.Dupont@exemple.com A4 2026 cœur").sort(), ["coeur", "dupont", "exemple", "jean"]);
});

/* -------------------------------------------------------------------------- */
/*  Évaluer                                                                   */
/* -------------------------------------------------------------------------- */

const champs = (...t: [string, number, number?][]): ChampEvalue[] =>
  t.map(([texte, poids, minimum]) => (minimum === undefined ? { texte, poids } : { texte, poids, minimum }));

test("evaluer : tous les mots, chacun dans n'importe quel champ", () => {
  const cliente = champs(["Marie Dupont", 3], ["Nantes", 1]);
  assert.ok(evaluer(cliente, preparerRequete("dupont nantes")));
  assert.equal(evaluer(cliente, preparerRequete("dupont lyon")), null);
});

test("evaluer : exact > début de mot > contient > approché", () => {
  assert.equal(evaluer(champs(["Paysage", 3]), preparerRequete("paysage"))?.rang, 0);
  assert.equal(evaluer(champs(["Paysage marin", 3]), preparerRequete("pays"))?.rang, 1);
  assert.equal(evaluer(champs(["Grand paysage", 3]), preparerRequete("ysa"))?.rang, 2);
  const approche = evaluer(
    champs(["BIARRITZ – Affiche", 3]),
    preparerRequete("biaritz", new Set(["biarritz", "affiche"])),
  );
  assert.equal(approche?.rang, 3);
  // Le rang de l'objet est celui de son mot le moins bien trouvé.
  assert.equal(evaluer(champs(["Grand paysage marin", 3]), preparerRequete("marin ysa"))?.rang, 2);
});

test("evaluer : « co » ne remonte pas les .com, « 13 » trouve WEB-0113", () => {
  const fiche = champs(["Marie Dupont", 3], ["marie@exemple.com", 2, 3]);
  assert.equal(evaluer(fiche, preparerRequete("co")), null);
  assert.equal(evaluer(champs(["déco murale", 1]), preparerRequete("co")), null);
  assert.equal(evaluer(champs(["Colette", 3]), preparerRequete("co"))?.rang, 1);
  assert.equal(evaluer(champs(["WEB-0113", 3]), preparerRequete("13"))?.rang, 2);
  // Trois caractères suffisent pour chercher dans l'adresse ; l'arobase est
  // gardée par l'aplatissement, « exemple » y est donc « contenu ».
  assert.equal(evaluer(fiche, preparerRequete("exemple"))?.rang, 2);
  assert.equal(evaluer(fiche, preparerRequete("@exemple"))?.rang, 2);
  assert.equal(evaluer(fiche, preparerRequete("marie@exemple"))?.rang, 1);
});

test("evaluer : le singulier ne vaut que comme mot entier", () => {
  assert.ok(evaluer(champs(["Bandeau et offre", 3]), preparerRequete("bandeaux")));
  // « bois » → « boi » ne doit pas trouver « boîte ».
  assert.equal(evaluer(champs(["La boîte aux lettres", 1]), preparerRequete("bois")), null);
});

test("evaluer : le meilleur champ, le poids, les mots entiers", () => {
  const ev = evaluer(
    champs(["BIARRITZ – Affiche prête à imprimer", 3], ["Une affiche de Biarritz pour offrir", 1]),
    preparerRequete("biarritz"),
  );
  assert.equal(ev?.meilleur, 0);
  assert.equal(ev?.poids, 3);
  assert.equal(ev?.motsEntiers, 1);
});

test("evaluer : les passages partent de l'endroit où les mots sont rassemblés", () => {
  const texte =
    "Paiement de la commande, de la livraison et de tout le reste. " +
    "Plus bas : les frais de port sont offerts dès 60 €.";
  const ev = evaluer(champs([texte, 1]), preparerRequete("frais de port"));
  assert.ok(ev);
  const premier = ev.passages[0]![0]!;
  assert.equal(texte.slice(premier.debut, premier.fin), "frais");
  assert.equal(passageACibler(texte, ev.passages[0]!), "frais de port");
});

test("comparer : rang, puis poids, puis mots entiers, puis ordre", () => {
  const base = { rang: 1 as const, poids: 1, motsEntiers: 1, ordre: 5 };
  assert.ok(comparer({ ...base, rang: 0 }, base) < 0);
  assert.ok(comparer({ ...base, poids: 3 }, base) < 0);
  assert.ok(comparer({ ...base, motsEntiers: 2 }, base) < 0);
  assert.ok(comparer({ ...base, ordre: 1 }, base) < 0);
});

/* -------------------------------------------------------------------------- */
/*  Extraits, passages, morceaux                                              */
/* -------------------------------------------------------------------------- */

test("couperExtrait : une fenêtre autour du passage, recalée, sans HTML", () => {
  const avant = "mot ".repeat(40);
  const texte = `${avant}la plage\nde Biarritz au coucher du soleil ${"fin ".repeat(40)}`;
  const debut = texte.indexOf("Biarritz");
  const e = couperExtrait(texte, [{ debut, fin: debut + 8 }]);
  assert.ok(e.texte.startsWith("… "));
  assert.ok(e.texte.endsWith(" …"));
  assert.ok(!e.texte.includes("\n"));
  const p = e.passages[0]!;
  assert.equal(e.texte.slice(p.debut, p.fin), "Biarritz");
  // Un texte court reste entier.
  const court = couperExtrait("Biarritz", [{ debut: 0, fin: 8 }]);
  assert.deepEqual(court, { texte: "Biarritz", passages: [{ debut: 0, fin: 8 }] });
});

test("passageACibler : le texte réellement écrit", () => {
  const t = "SAINT-VALERY-SUR-SOMME Porte";
  assert.equal(passageACibler(t, [{ debut: 0, fin: 5 }, { debut: 6, fin: 12 }]), "SAINT-VALERY");
  const loin = `Biarritz ${"x".repeat(80)} plage`;
  assert.equal(passageACibler(loin, [{ debut: 0, fin: 8 }, { debut: loin.length - 5, fin: loin.length }]), "Biarritz");
  assert.equal(passageACibler(t, []), "");
});

test("decouper : des morceaux de texte, surlignés ou non", () => {
  assert.deepEqual(decouper("Le Cœur", [{ debut: 3, fin: 7 }]), [
    { texte: "Le ", marque: false },
    { texte: "Cœur", marque: true },
  ]);
  assert.deepEqual(decouper("<b>", []), [{ texte: "<b>", marque: false }]);
});

test("emplacementComplet", () => {
  assert.equal(
    emplacementComplet({ nature: "Affiche", titre: "BIARRITZ", ou: "Description (anglais)" }),
    "Affiche BIARRITZ › Description (anglais)",
  );
  assert.equal(emplacementComplet({ nature: "Écran", titre: "Livraison", ou: null }), "Écran Livraison");
});

/* -------------------------------------------------------------------------- */
/*  Le lien et ce qu'il transporte                                            */
/* -------------------------------------------------------------------------- */

test("lienRecherche / lireCible : aller-retour, quels que soient les caractères", () => {
  const trouver = "Saint-Valéry & co #2 + 50% = « ok » ✨";
  const lien = lienRecherche("/produits/12", { trouver, ancre: "langue-de", champ: "footer.baseline@en" }, { langue: "de" });
  assert.match(lien, /^\/produits\/12\?langue=de#trouver=[^&]+&ancre=langue-de&champ=footer\.baseline%40en$/);
  assert.ok(!lien.includes(" "));
  const hash = lien.slice(lien.indexOf("#"));
  assert.deepEqual(lireCible(hash), { trouver, ancre: "langue-de", champ: "footer.baseline@en" });
  // « + » n'est jamais une espace.
  assert.deepEqual(lireCible("#trouver=a+b"), { trouver: "a+b" });
});

test("lienRecherche : pas de fragment sans rien à transporter, trouver coupé à 200", () => {
  assert.equal(lienRecherche("/commandes/40"), "/commandes/40");
  assert.equal(lienRecherche("/commandes/40", { trouver: "  " }), "/commandes/40");
  assert.equal(lienRecherche("/cartes-cadeaux", undefined, { carte: 3 }), "/cartes-cadeaux?carte=3");
  const long = lienRecherche("/x", { trouver: "é".repeat(300) });
  assert.equal(lireCible(long.slice(long.indexOf("#")))?.trouver?.length, 200);
  // Un émoji coupé en deux ne casse pas le lien.
  assert.doesNotThrow(() => lienRecherche("/x", { trouver: `${"a".repeat(199)}🎉` }));
});

test("lireCible : les #id ordinaires gardent leur comportement, les valeurs invalides sont ignorées", () => {
  assert.equal(lireCible("#bordereau"), null);
  assert.equal(lireCible(""), null);
  assert.equal(lireCible("#trouver="), null);
  assert.deepEqual(lireCible("#trouver=%E0%A4%A&ancre=infos"), { ancre: "infos" });
  assert.deepEqual(lireCible("trouver=abc&inconnu=1&champ=note"), { trouver: "abc", champ: "note" });
});

/* -------------------------------------------------------------------------- */
/*  HTML → texte                                                              */
/* -------------------------------------------------------------------------- */

test("texteDeHtml : balises retirées, entités décodées, blocs séparés", () => {
  assert.equal(texteDeHtml("<p>Une id&eacute;e</p><p>cadeau&nbsp;!</p>"), "Une idée cadeau !");
  assert.equal(texteDeHtml("Caf&#233; &#xE9;t&eacute; &amp;lt;b&amp;gt;"), "Café été &lt;b&gt;");
  assert.equal(texteDeHtml("&lt;img src=x&gt;"), "<img src=x>");
  assert.equal(texteDeHtml('<img src=x onerror="alert(1)">Bonjour<script>alert(2)</script>'), "Bonjour");
  assert.equal(texteDeHtml("ligne<br>suivante<br/>fin"), "ligne suivante fin");
  assert.equal(texteDeHtml("&inconnue; &#0;"), "&inconnue; &#0;");
});

/* -------------------------------------------------------------------------- */
/*  La base garde au moins ce que le JavaScript garde                         */
/* -------------------------------------------------------------------------- */

test("SQL : chaque lettre accentuée de la table s'aplatit comme en JavaScript", () => {
  assert.equal(LETTRES_ACCENTUEES.length, LETTRES_PLATES.length);
  for (let i = 0; i < LETTRES_ACCENTUEES.length; i++)
    assert.equal(aplatir(LETTRES_ACCENTUEES[i]!), LETTRES_PLATES[i], LETTRES_ACCENTUEES[i]);
  for (const s of SEPARATEURS) assert.equal(aplatir(`a${s}b`), "a b", JSON.stringify(s));
});

test("SQL : motifs échappés, numéros bâtis de chiffres validés", () => {
  assert.equal(motif("50%_a\\b"), "50\\%\\_a\\\\b");
  assert.equal(motifNumeroCommande("WEB0013"), "^WEB-0*13$");
  assert.equal(motifNumeroCommande("13"), "^(WEB|SAL)-0*13$");
  assert.equal(motifNumeroCommande("SAL1"), "^SAL-0*1$");
  assert.equal(motifNumeroCommande("0013"), "^(WEB|SAL)-0*13$");
  assert.equal(motifNumeroCommande("WEB13X"), null);
  assert.equal(motifNumeroCommande("1234567"), null);
  assert.ok(motifsFacture("F20260001").includes("^F2026-0*1$"));
  assert.ok(motifsFacture("12345").includes("^F\\d{4}-0*12345$"));
  assert.deepEqual(motifsFacture("ABC"), []);
  assert.equal(ancienNumero("1042"), "#1042");
  assert.equal(ancienNumero("13"), null);
});

/* -------------------------------------------------------------------------- */
/*  Les sources, sur données factices                                         */
/* -------------------------------------------------------------------------- */

const commande = (champs: Partial<LigneCommande> = {}): LigneCommande => ({
  id: 40,
  number: "WEB-0013",
  channel: "web",
  status: "paid",
  totalCents: 2900,
  createdAt: new Date("2026-03-12T10:00:00Z"),
  archivedAt: null,
  invoiceNumber: "F2026-0001",
  legacyName: null,
  shippingName: "Cliente Factice",
  shippingLine1: "1 rue Imaginaire",
  shippingLine2: null,
  shippingPostalCode: "99999",
  shippingCity: "Villefictive",
  shippingCountry: "FR",
  relayPointLabel: null,
  internalNote: null,
  tags: ["Salon de Vannes 2026"],
  promoCode: null,
  cancelReason: null,
  clientNom: "Cliente Factice",
  clientEmail: "cliente@exemple.test",
  standNom: null,
  ...champs,
});
const sansEnfants: EnfantsCommande = { articles: [], journal: [], transporteurs: [], remboursements: [] };

test("commande : un commentaire du journal mène à la chronologie", () => {
  const fiche = ficheCommande(commande(), { ...sansEnfants, journal: ["Cliente rappelée, colis à joindre"] }, 0);
  const t = versResultat(fiche, preparerRequete("rappelée"));
  assert.equal(t?.resultat.ou, "Journal");
  assert.equal(t?.resultat.href, "/commandes/40#trouver=rappel%C3%A9e&ancre=journal");
  assert.equal(t?.resultat.nature, "Commande");
});

test("commande : un remboursement, un texte d'affiche, une étiquette, la facture", () => {
  const enfants: EnfantsCommande = {
    ...sansEnfants,
    remboursements: ["Article abîmé au transport"],
    articles: [
      { orderId: 40, title: "BIARRITZ", quantity: 1, lignes: ["Famille Factice", "en famille"], titreAffiche: null, sousTitreAffiche: null },
    ],
  };
  const fiche = ficheCommande(commande(), enfants, 0);
  const remb = versResultat(fiche, preparerRequete("abîmé"));
  assert.equal(remb?.resultat.ou, "Remboursement");
  assert.match(remb!.resultat.href, /ancre=remboursements$/);
  const ligne = versResultat(fiche, preparerRequete("en famille"));
  assert.equal(ligne?.resultat.ou, "Texte de l'affiche (ligne 2)");
  assert.equal(ligne?.resultat.rang, 0);
  assert.match(ligne!.resultat.href, /#trouver=en%20famille&ancre=articles$/);
  const etiquette = versResultat(fiche, preparerRequete("Salon de Vannes 2026"));
  assert.equal(etiquette?.resultat.href, "/commandes/40#trouver=Salon%20de%20Vannes%202026&ancre=etiquettes&champ=tags");
  // Le numéro et la facture ouvrent la fiche en haut, sans rien chercher.
  assert.equal(versResultat(fiche, preparerRequete("F2026-0001"))?.resultat.href, "/commandes/40");
  assert.equal(versResultat(fiche, preparerRequete("WEB-0013"))?.resultat.href, "/commandes/40");
  // Un rang imposé (le chemin des numéros) passe devant le texte.
  const impose = versResultat(fiche, preparerRequete("web13"), {
    rang: 0,
    libelle: "Numéro",
    cible: { chemin: "/commandes/40", trouver: false },
    titreEntier: true,
  });
  assert.equal(impose?.resultat.rang, 0);
  assert.equal(impose?.resultat.ou, "Numéro");
  assert.deepEqual(impose?.resultat.titrePassages, [{ debut: 0, fin: 8 }]);
});

test("carte cadeau : par son code (rang imposé), par sa note", () => {
  const carte = {
    id: 3,
    code: "ACEF-HJKL-RUWX",
    balanceCents: 3000,
    status: "active",
    expiresAt: null,
    note: "Offerte au salon de Vannes",
    clientNom: null,
    historique: ["Payé la commande WEB-0042"],
  };
  const fiche = ficheCarte(carte, 0);
  const parCode = versResultat(fiche, preparerRequete("ACEFHJKL"), {
    rang: 1,
    libelle: null,
    cible: cibleCodeCarte(carte),
    titreEntier: true,
  });
  assert.equal(parCode?.resultat.href, "/cartes-cadeaux?carte=3#trouver=ACEF-HJKL-RUWX&ancre=carte-3");
  assert.equal(parCode?.resultat.ou, null);
  const parNote = versResultat(fiche, preparerRequete("vannes"));
  assert.equal(parNote?.resultat.ou, "Note");
  assert.equal(parNote?.resultat.href, "/cartes-cadeaux?carte=3#trouver=Vannes&ancre=historique-carte");
  assert.equal(parNote?.resultat.detail, "Solde 30 €");
  assert.equal(versResultat(fiche, preparerRequete("WEB-0042"))?.resultat.ou, "Historique");
});

test("lettre : le contenu HTML se cherche en texte", () => {
  const [fiche] = fichesLettres([
    {
      id: 7,
      titre: "Noël 2026",
      objet: "Nos idées de Noël",
      contenuHtml: "<p>Découvrez nos <strong>affiches</strong> de fêtes&nbsp;!</p>",
      etat: "brouillon",
      envoyeeLe: null,
      archivedAt: null,
    },
  ]);
  const t = versResultat(fiche!, preparerRequete("affiches de fetes"));
  assert.equal(t?.resultat.ou, "Contenu");
  assert.equal(t?.resultat.extrait?.texte, "Découvrez nos affiches de fêtes !");
  assert.equal(t?.resultat.href, "/lettre?lettre=7#trouver=affiches%20de%20f%C3%AAtes&ancre=lettre-ouverte&champ=contenu");
});

test("page : une traduction s'ouvre dans sa langue, sur le bon champ", () => {
  const [fiche] = fichesPages([
    {
      id: 5,
      title: "Conditions générales de vente",
      slug: "conditions-de-vente",
      status: "active",
      seoTitle: null,
      seoDescription: null,
      blocks: [{ type: "texte", html: "<p>Les présentes conditions…</p>" }],
      translations: { de: { title: "Allgemeine Geschäftsbedingungen", blocks: [{ type: "titre", texte: "Widerrufsrecht", niveau: 2 }] } },
      archivedAt: null,
    },
  ]);
  const titre = versResultat(fiche!, preparerRequete("Geschäftsbedingungen"));
  assert.equal(titre?.resultat.ou, "Titre (allemand)");
  assert.equal(titre?.resultat.href, "/pages/5?langue=de#trouver=Gesch%C3%A4ftsbedingungen&ancre=traductions&champ=titre");
  const corps = versResultat(fiche!, preparerRequete("widerrufsrecht"));
  assert.equal(corps?.resultat.ou, "Contenu de la page (allemand)");
  assert.match(corps!.resultat.href, /\?langue=de#trouver=Widerrufsrecht&ancre=traductions&champ=corps$/);
  // Le contenu français se trouve dans l'éditeur du corps.
  assert.match(versResultat(fiche!, preparerRequete("présentes"))!.resultat.href, /#trouver=pr%C3%A9sentes&ancre=contenu&champ=corps$/);
});

test("collection : traduction et description française", () => {
  const [fiche] = fichesCollections([
    {
      id: 2,
      name: "Villes",
      slug: "villes",
      description: "<p>Nos plus belles villes</p>",
      translations: { de: { name: "Städte" } },
      active: true,
      archivedAt: null,
      affiches: 12,
    },
  ]);
  const de = versResultat(fiche!, preparerRequete("stadte"));
  assert.equal(de?.resultat.ou, "Nom (allemand)");
  assert.equal(de?.resultat.href, "/collections/2#trouver=St%C3%A4dte&ancre=langue-de&champ=name");
  assert.equal(de?.resultat.detail, "12 affiches");
  const fr = versResultat(fiche!, preparerRequete("belles"));
  assert.equal(fr?.resultat.href, "/collections/2#trouver=belles&ancre=langue-en");
});

test("mode de livraison : traduction vers son tableau, mode archivé vers sa ligne", () => {
  const mode = {
    id: 1,
    name: "Point relais",
    description: "Livré en 3 à 5 jours",
    notePreparation: null,
    pickupLocation: null,
    carrier: "mondial_relay",
    kind: "relay",
    active: true,
    archivedAt: null,
    translations: { it: { description: "Consegnato in 3-5 giorni" } },
  };
  const [actif, archive] = fichesModesLivraison([mode, { ...mode, id: 9, archivedAt: new Date() }]);
  const tr = versResultat(actif!, preparerRequete("consegnato"));
  assert.equal(tr?.resultat.ou, "Description (italien)");
  assert.equal(tr?.resultat.href, "/livraison#trouver=Consegnato&ancre=traductions-mode-1&champ=tr-1-description-it");
  assert.equal(versResultat(actif!, preparerRequete("mondial relay"))?.resultat.href, "/livraison#trouver=mondial_relay&ancre=mode-1&champ=carrier");
  assert.equal(versResultat(archive!, preparerRequete("consegnato"))?.resultat.href, "/livraison#trouver=Consegnato&ancre=mode-9");
});

test("courriel de relance réécrit en anglais", () => {
  const fiches = fichesCourrielsRelance([
    { key: "relance.courrier_2.en", value: { objet: "Your poster is waiting", accroche: "Hello,", message: "<p>Still thinking?</p>", bouton: "Back to my basket", conclusion: "" } },
    { key: "salon.code", value: "NE-DOIT-JAMAIS-SERVIR" },
  ]);
  assert.equal(fiches.length, 1);
  const t = versResultat(fiches[0]!, preparerRequete("poster waiting"));
  assert.equal(t?.resultat.titre, "Courriel de relance n°2");
  assert.equal(t?.resultat.ou, "Objet (anglais)");
  assert.equal(t?.resultat.href, "/paniers/courriel?relance=2&langue=en#trouver=poster%20is%20waiting&champ=objet");
});

test("textes du site : chaîne française ou dictionnaire de langues", () => {
  const fiches = fichesTextesDuSite([
    { key: "footer.baseline", value: { fr: "Votre affiche prête en 2 minutes.", en: "Your poster ready in 2 minutes." } },
    { key: "home.ia.title", value: "L'affiche à partir d'une photo" },
    { key: "salon.code", value: "NE-DOIT-JAMAIS-SERVIR" },
  ]);
  assert.deepEqual(fiches.map((f) => f.titre), [
    "Accueil — l'affiche à partir d'une photo — Titre",
    "Pied de page — Baseline",
  ]);
  const fr = versResultat(fiches[1]!, preparerRequete("affiche prete"));
  assert.equal(fr?.resultat.ou, null);
  assert.equal(fr?.resultat.href, "/contenu#trouver=affiche%20pr%C3%AAte&champ=footer.baseline%40fr");
  const en = versResultat(fiches[1]!, preparerRequete("poster ready"));
  assert.equal(en?.resultat.ou, "Version anglaise");
  assert.match(en!.resultat.href, /champ=footer\.baseline%40en$/);
});

test("bandeau visuel : nom, et traductions vers leur case", () => {
  const [fiche] = fichesBandeauxVisuels([
    { id: "bv-1", nom: "Noël", titre: "Pour Noël", texte: "", bouton: "Je découvre", alt: "", translations: { es: { titre: "Para Navidad" } }, etat: "Archivé" },
  ]);
  assert.equal(versResultat(fiche!, preparerRequete("noel"))?.resultat.href, "/bandeaux-visuels/bv-1#trouver=No%C3%ABl&ancre=bv-formulaire&champ=nom");
  const es = versResultat(fiche!, preparerRequete("navidad"));
  assert.equal(es?.resultat.ou, "Titre (espagnol)");
  assert.equal(es?.resultat.href, "/bandeaux-visuels/bv-1#trouver=Navidad&ancre=traductions-bandeau-visuel&champ=tr-bv-1-titre-es");
  assert.equal(es?.resultat.detail, "Archivé");
});

test("stand : trouvé par son nom seulement, le code n'existe pas dans la fiche", () => {
  const [fiche] = fichesStands([{ id: 1, nom: "Marché de Noël Mulhouse", ouvert: true, archivedAt: null }]);
  assert.ok(!JSON.stringify(fiche).includes("code"));
  assert.equal(versResultat(fiche!, preparerRequete("mulhouse"))?.resultat.href, "/ventes-salon?stand=1#trouver=Mulhouse&ancre=stand-1");
});
