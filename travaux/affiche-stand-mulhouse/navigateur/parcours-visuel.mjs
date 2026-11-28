// Compose un visuel de la fiche (demande 5 du 28/11) DANS le vrai
// configurateur, jusqu'au panier (sans payer) : la ligne de panier ainsi
// créée est ensuite rendue par le moteur d'impression (rendu-impression.ts).
// node parcours-visuel.mjs <préfixe> '<json>' — json : { motif, fond,
//   couleur, place: "haut"|"bas", couleurTexte?, lignes?: [l1, l2, l3],
//   tailles?: ["s"|"m"|"l", …], personnages?: [[catégorie, nom], …] }
import { brancher, pause } from "./pilote.mjs";

const [prefixe, brut] = process.argv.slice(2);
const v = JSON.parse(brut);
const DOSSIER = "../captures/";
const p = await brancher();

async function etape(nom) {
  await p.bouton(nom, 0, ".ml-cfg-etapes");
  await pause(500);
}
async function choisir(titre, dans = ".ml-cfg-panel") {
  const r = await p.eval(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(dans + " button")})].find(b => b.title === ${JSON.stringify(titre)} || b.getAttribute('aria-label') === ${JSON.stringify(titre)});
    if (!b) return 'INTROUVABLE'; b.scrollIntoView({ block: 'center' }); b.click(); return 'ok'; })()`);
  if (r !== "ok") throw new Error("introuvable : " + titre);
  await pause(500);
}

try {
  await p.taille(1440, 900);
  await p.aller("http://localhost:8080/affiches/mulhouse-marche-de-noel-affiche-personnalisee", 1500);
  await p.bouton("Personnaliser");
  await p.apercuPret();
  // Le motif : on parcourt les onglets jusqu'à le trouver.
  const onglets = await p.eval("[...document.querySelectorAll('.ml-cfg-categories button')].map(b => b.textContent.trim())");
  for (const o of onglets) {
    await p.bouton(o, 0, ".ml-cfg-categories");
    await pause(250);
    const ici = await p.eval("[...document.querySelectorAll('.ml-cfg-grille-motifs button')].map(b => b.title)");
    if (ici.includes(v.motif)) break;
  }
  await choisir(v.motif);
  await choisir(v.fond);
  await choisir(v.couleur);
  await etape("2. Texte");
  await p.bouton(v.place === "bas" ? "En bas" : "En haut");
  await pause(300);
  for (const [i, t] of (v.lignes ?? []).entries()) if (t != null) await p.saisir(i, t);
  for (const [i, t] of (v.tailles ?? []).entries()) {
    const nom = { s: "Petit", m: "Moyen", l: "Grand" }[t];
    if (nom) await p.bouton(nom, i);
  }
  if (v.couleurTexte) await choisir(v.couleurTexte);
  await etape("3. Personnages");
  for (const [categorie, nom] of v.personnages ?? []) {
    await p.bouton("Ajouter un personnage");
    await pause(1200);
    await p.bouton(categorie, 0, ".ml-cfg-root");
    await pause(500);
    await choisir(nom, ".ml-cfg-root");
    await pause(800);
    await p.bouton("Valider mon personnage");
    await pause(900);
  }
  await etape("4. Format");
  await p.apercuPret(".ml-cfg-root .ml-cfg-poster");
  await p.capture(`${DOSSIER}${prefixe}-module.png`, ".ml-cfg-root .ml-cfg-poster");
  await p.bouton("Valider l'affiche");
  await p.attendre("/\\/(commande|panier)/.test(location.pathname)", 30000);
  await pause(2000);
  console.log("au panier", await p.eval("location.pathname"), JSON.stringify(await p.erreurs()));
} finally {
  p.fermer();
}
