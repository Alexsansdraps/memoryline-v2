// Parcours complet de l'affiche du stand jusqu'au panier, SANS PAYER
// (réglages du 28/11) : un motif de chaque onglet, un fond uni, un dégradé, un
// motif répété, une couleur de la palette, le texte en haut puis en bas, 1
// puis 3 personnages de dos sur le muret, « Valider l'affiche », puis la
// vignette du panier. Écrit l'aperçu du module (captures/<préfixe>-module.png)
// pour le comparer au fichier d'impression de la ligne.
//
// node parcours-panier.mjs <préfixe> <motif> <fond> <couleur> <haut|bas> <personnages> [l h] [url]
import { brancher, pause } from "./pilote.mjs";

const [
  prefixe = "reglages-panier",
  motif = "Hôtel de ville",
  fond = "Nuit d'hiver (dégradé)",
  couleur = "Or",
  place = "bas",
  personnages = "3",
  l = "1440",
  h = "900",
  url = "http://localhost:8080/affiches/mulhouse-marche-de-noel-affiche-personnalisee",
] = process.argv.slice(2);
const DOSSIER = "../captures/";
const p = await brancher();

async function etape(nom) {
  await p.bouton(nom, 0, ".ml-cfg-etapes");
  await pause(500);
}
/** Clique un bouton par son title / aria-label exact (motifs, fonds, couleurs). */
async function choisir(titre) {
  const r = await p.eval(`(() => { const b = [...document.querySelectorAll('.ml-cfg-panel button')].find(b => b.title === ${JSON.stringify(titre)} || b.getAttribute('aria-label') === ${JSON.stringify(titre)});
    if (!b) return 'INTROUVABLE'; b.scrollIntoView({ block: 'center' }); b.click(); return 'ok'; })()`);
  if (r !== "ok") throw new Error("introuvable : " + titre);
  await pause(500);
}

try {
  await p.taille(Number(l), Number(h), Number(l) < 769);
  await p.aller(url, 1500);
  await p.bouton("Personnaliser");
  await p.apercuPret();

  // Un motif de chaque onglet, capturé.
  const onglets = await p.eval(
    "[...document.querySelectorAll('.ml-cfg-categories button')].map(b => b.textContent.trim())",
  );
  console.log("onglets", JSON.stringify(onglets));
  for (const [i, o] of onglets.entries()) {
    await p.bouton(o, 0, ".ml-cfg-categories");
    await pause(400);
    const motifs = await p.eval(
      "[...document.querySelectorAll('.ml-cfg-grille-motifs button')].map(b => b.title)",
    );
    // Dans les maisons, les maisons en couleurs ; ailleurs, le premier motif.
    const choisi = motifs.find((m) => /Maisons alsaciennes/.test(m)) ?? motifs[0];
    await choisir(choisi);
    await p.apercuPret(".ml-cfg-root .ml-cfg-poster");
    await p.capture(`${DOSSIER}${prefixe}-onglet-${i + 1}.png`, ".ml-cfg-root .ml-cfg-poster", 0.6);
    console.log("onglet", o, "→", choisi, "(", motifs.length, "motifs ) ligne 1 :", await p.eval("document.querySelector('.ml-cfg-root .ml-cfg-poster [data-rang-texte]')?.textContent"));
  }

  // La composition voulue.
  await p.bouton(onglets[0], 0, ".ml-cfg-categories");
  const tous = [];
  for (const o of onglets) {
    await p.bouton(o, 0, ".ml-cfg-categories");
    await pause(250);
    tous.push(...(await p.eval("[...document.querySelectorAll('.ml-cfg-grille-motifs button')].map(b => b.title)")));
    if (tous.includes(motif)) break;
  }
  await choisir(motif);
  await choisir(fond);
  await choisir(couleur);
  await etape("2. Texte");
  await p.bouton(place === "haut" ? "En haut" : "En bas");
  await pause(300);
  // La ligne 1 en « Grand » (titres longs, demande 6) : TAILLE1=l.
  if (process.env.TAILLE1 === "l") {
    await p.bouton("Grand", 0);
    await pause(300);
  }
  await etape("3. Personnages");
  for (let n = 0; n < Number(personnages); n++) {
    await p.bouton("Ajouter un personnage");
    await pause(900);
    await p.bouton("Valider mon personnage");
    await pause(700);
  }
  await etape("4. Format");
  await p.apercuPret(".ml-cfg-root .ml-cfg-poster");
  await p.capture(`${DOSSIER}${prefixe}-module.png`, ".ml-cfg-root .ml-cfg-poster");
  // « Voir sur un mur », avec la même composition.
  await p.bouton("Voir sur un mur");
  await p.attendre("document.querySelector('.ml-mur-affiche .ml-cfg-poster')");
  await pause(2500);
  await p.capture(`${DOSSIER}${prefixe}-mur.png`, ".ml-mur-affiche", 4);
  await p.eval("[...document.querySelectorAll('[aria-labelledby=\"ml-mur-titre\"] button')].find(b => b.getAttribute('aria-label') && /ermer/.test(b.getAttribute('aria-label')))?.click(); 1");
  await pause(600);
  // Au panier, sans payer.
  await p.bouton("Valider l'affiche");
  await p.attendre("/\\/(commande|panier)/.test(location.pathname)", 30000);
  await pause(2500);
  await p.attendre("document.querySelector('.ml-cfg-poster')", 30000);
  await p.apercuPret(".ml-cfg-poster");
  await pause(1500);
  // La vignette de la ligne qu'on vient d'ajouter : la dernière.
  const n = await p.eval("document.querySelectorAll('.ml-cfg-poster').length");
  await p.eval(`(() => { const v = [...document.querySelectorAll('.ml-cfg-poster')]; v.forEach((x, i) => x.id = i === v.length - 1 ? 'derniere-vignette' : ''); v[v.length - 1].scrollIntoView({ block: 'center' }); return v.length; })()`);
  await pause(800);
  await p.capture(`${DOSSIER}${prefixe}-vignette-panier.png`, "#derniere-vignette", 3);
  await p.capture(`${DOSSIER}${prefixe}-page-commande.png`);
  console.log("vignettes au panier :", n, "page :", await p.eval("location.pathname"));
  console.log(JSON.stringify(await p.erreurs()));
} finally {
  p.fermer();
}
