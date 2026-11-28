// Réouverture d'une ligne de panier (« Modifier ») de l'affiche du stand
// (28/11) : même motif, même fond, même place du texte, ligne 1 gardée ; une
// ligne sans personnage rouverte propose bien des personnages DE DOS, et le
// muret revient dès qu'on en ajoute un. Ne valide rien : la ligne ne change pas.
// node parcours-reouverture.mjs <id de la ligne> <préfixe>
import { brancher, pause } from "./pilote.mjs";

const [id, prefixe = "reglages-reouverture"] = process.argv.slice(2);
const DOSSIER = "../captures/";
const p = await brancher();
try {
  await p.taille(1440, 900);
  await p.aller(`http://localhost:8080/affiches/mulhouse-marche-de-noel-affiche-personnalisee?edit=${id}`, 2500);
  await p.attendre("document.querySelector('.ml-cfg-root .ml-cfg-poster')", 30000);
  await p.apercuPret(".ml-cfg-root .ml-cfg-poster");
  await p.capture(`${DOSSIER}${prefixe}-1.png`);
  const etat = await p.eval(`(() => ({
    motif: document.querySelector('.ml-cfg-grille-motifs button[aria-pressed="true"]')?.title,
    fond: [...document.querySelectorAll('.ml-cfg-panel button[aria-pressed="true"]')].map(b => b.title).filter(Boolean),
    couleur: [...document.querySelectorAll('.ml-cfg-couleurs-motif button[aria-pressed="true"]')].map(b => b.getAttribute('aria-label')),
    ligne1: document.querySelector('.ml-cfg-root .ml-cfg-poster [data-rang-texte]')?.textContent,
  }))()`);
  console.log("rouverte", JSON.stringify(etat));
  await p.bouton("2. Texte", 0, ".ml-cfg-etapes");
  await pause(500);
  console.log(
    "place du texte",
    await p.eval("[...document.querySelectorAll('.ml-cfg-panel button[aria-pressed=\"true\"]')].map(b => b.textContent.trim()).filter(t => /En (haut|bas)/.test(t))"),
  );
  await p.bouton("3. Personnages", 0, ".ml-cfg-etapes");
  await pause(500);
  await p.bouton("Ajouter un personnage");
  await pause(1500);
  const vues = await p.eval(
    "[...document.querySelectorAll('.ml-cfg-root img, .ml-cfg-root [data-item]')].length",
  );
  await p.capture(`${DOSSIER}${prefixe}-2-ajout.png`);
  await p.bouton("Valider mon personnage");
  await pause(1200);
  await p.apercuPret(".ml-cfg-root .ml-cfg-poster");
  await p.capture(`${DOSSIER}${prefixe}-3-avec-perso.png`, ".ml-cfg-root .ml-cfg-poster");
  console.log("éléments de la galerie", vues, JSON.stringify(await p.erreurs()));
} finally {
  p.fermer();
}
