// Mise en page de l'affiche du stand (demande 3 du 28/11) : texte en haut
// puis en bas, avec 0, 1, 3 et beaucoup de personnages de dos sur le muret.
// Capture l'aperçu à chaque étape, et relève les boîtes du texte, du motif et
// des têtes pour vérifier qu'ils ne se chevauchent pas.
// node parcours-mise-en-page.mjs [préfixe] [nombre maxi] [motif]
import { brancher, pause } from "./pilote.mjs";

const [prefixe = "reglages-mep", maxi = "12", motif = ""] = process.argv.slice(2);
const DOSSIER = "../captures/";
const p = await brancher();

/** Les boîtes (fractions de l'affiche) : lignes de texte, dessin du motif, têtes. */
const RELEVE = `(() => {
  const a = document.querySelector('.ml-cfg-root .ml-cfg-poster');
  const b = a.getBoundingClientRect();
  const f = (r) => ({ haut: +((r.top - b.top) / b.height).toFixed(3), bas: +((r.bottom - b.top) / b.height).toFixed(3), gauche: +((r.left - b.left) / b.width).toFixed(3), droite: +((r.right - b.left) / b.width).toFixed(3) });
  const lignes = [...a.querySelectorAll('[data-rang-texte]')].filter(l => l.offsetParent !== null).map(l => { const r = document.createRange(); r.selectNodeContents(l); return f(r.getBoundingClientRect()); });
  // Le dessin du motif : le SVG de sa pile (le cadre 1:2 est plus grand que lui).
  const pileMotif = [...a.querySelectorAll('div[aria-hidden="true"]')].find(d => d.style.zIndex === '9');
  let motif = null;
  if (pileMotif) { const s = pileMotif.querySelector('svg'); if (s) { const bb = s.getBBox ? null : null; motif = f(s.getBoundingClientRect()); } }
  const persos = [...a.querySelectorAll('.ml-cfg-charstack')].filter(c => !pileMotif || !pileMotif.contains(c)).map(c => f(c.getBoundingClientRect()));
  return { lignes, motif, persos: persos.length };
})()`;

async function etape(nom) {
  await p.bouton(nom, 0, ".ml-cfg-etapes");
  await pause(500);
}
async function textePlace(bas) {
  await etape("2. Texte");
  await p.bouton(bas ? "En bas" : "En haut");
  await pause(400);
}
async function capture(nom) {
  await p.apercuPret(".ml-cfg-root .ml-cfg-poster");
  await p.capture(DOSSIER + prefixe + "-" + nom + ".png", ".ml-cfg-root .ml-cfg-poster");
  console.log(nom, JSON.stringify(await p.eval(RELEVE)));
}
async function ajouterPersonnage() {
  await etape("3. Personnages");
  await p.bouton("Ajouter un personnage");
  await pause(900);
  await p.bouton("Valider mon personnage");
  await pause(700);
}

try {
  await p.taille(1440, 900);
  await p.aller("http://localhost:8080/affiches/mulhouse-marche-de-noel-affiche-personnalisee", 1500);
  await p.bouton("Personnaliser");
  await p.apercuPret();
  if (motif) {
    await p.bouton(motif);
    await pause(800);
  }
  await textePlace(false);
  await capture("0-haut");
  await textePlace(true);
  await capture("0-bas");
  await ajouterPersonnage();
  await textePlace(false);
  await capture("1-haut");
  await textePlace(true);
  await capture("1-bas");
  await ajouterPersonnage();
  await ajouterPersonnage();
  await textePlace(false);
  await capture("3-haut");
  await textePlace(true);
  await capture("3-bas");
  for (let n = 4; n <= Number(maxi); n++) await ajouterPersonnage();
  await textePlace(false);
  await capture(maxi + "-haut");
  await textePlace(true);
  await capture(maxi + "-bas");
  console.log(JSON.stringify(await p.erreurs()));
} finally {
  p.fermer();
}
