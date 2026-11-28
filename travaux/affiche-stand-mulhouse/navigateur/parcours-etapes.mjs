// Les quatre étapes de la fenêtre plein écran, capturées à une taille donnée
// (demandes 1 et 2 du 28/11). node parcours-etapes.mjs <l> <h> <préfixe> [mobile] [url]
import { brancher, pause } from "./pilote.mjs";

const [l = "1440", h = "900", prefixe = "reglages-etapes", mobile = "", url] = process.argv.slice(2);
const DOSSIER = "../captures/";
const p = await brancher();

const CONTROLE = `(() => {
  const corps = document.querySelector('.ml-modal-body');
  const croix = document.querySelector('.ml-modal-close').getBoundingClientRect();
  const etapes = [...document.querySelectorAll('.ml-cfg-etape')].map(b => ({ t: b.textContent.trim(), coupe: b.firstElementChild.scrollWidth > b.firstElementChild.clientWidth + 1 }));
  // Ce qui dépasse à droite de la fenêtre (rien ne doit défiler de côté).
  const larges = [...document.querySelectorAll('.ml-modal-panel *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed'; }).slice(0, 5).map(e => e.className || e.tagName);
  return { croixVisible: croix.top >= 0 && croix.right <= innerWidth, defileX: corps.scrollWidth > corps.clientWidth + 1, pageX: document.documentElement.scrollWidth > innerWidth + 1, etapes, larges };
})()`;

try {
  await p.taille(Number(l), Number(h), mobile === "mobile");
  await p.aller(url || "http://localhost:8080/affiches/mulhouse-marche-de-noel-affiche-personnalisee", 1500);
  await p.bouton("Personnaliser");
  await p.apercuPret();
  for (const [n, nom] of [[1, "1. Motif et fond"], [2, "2. Texte"], [3, "3. Personnages"], [4, "4. Format"]]) {
    await p.bouton(nom, 0, ".ml-cfg-etapes");
    await pause(700);
    await p.eval("document.querySelector('.ml-modal-body').scrollTop = 0; 1");
    await pause(300);
    await p.capture(DOSSIER + prefixe + "-" + n + ".png");
    console.log(nom, JSON.stringify(await p.eval(CONTROLE)));
  }
  // L'étape 3 avec un personnage, et l'éditeur ouvert.
  await p.bouton("3. Personnages", 0, ".ml-cfg-etapes");
  await pause(500);
  await p.bouton("Ajouter un personnage");
  await pause(1500);
  await p.capture(DOSSIER + prefixe + "-3-editeur.png");
  console.log("éditeur", JSON.stringify(await p.eval(CONTROLE)));
  await p.bouton("Valider mon personnage");
  await pause(1200);
  await p.eval("document.querySelector('.ml-modal-body').scrollTop = 0; 1");
  await p.capture(DOSSIER + prefixe + "-3-un-perso.png");
  console.log(JSON.stringify(await p.erreurs()));
} finally {
  p.fermer();
}
