// La fiche de l'affiche du stand et ses nouveaux visuels (demande 5 du 28/11),
// la page de la collection et la page du stand à la tablette.
// node parcours-fiche.mjs [préfixe]
import { brancher, pause } from "./pilote.mjs";

const [prefixe = "reglages-fiche"] = process.argv.slice(2);
const DOSSIER = "../captures/";
const p = await brancher();
const IMAGES = `[...document.images].filter(i => /marche-de-noel-exemple/.test(i.currentSrc || i.src)).map(i => ({ src: (i.currentSrc || i.src).replace(/^.*\\/assets\\//, ''), ok: i.complete && i.naturalWidth > 0, l: i.naturalWidth }))`;
try {
  await p.taille(1440, 900);
  await p.aller("http://localhost:8080/affiches/mulhouse-marche-de-noel-affiche-personnalisee", 2000);
  await p.eval("Promise.race([Promise.all([...document.images].filter(i => i.loading !== 'lazy').map(i => i.complete ? 1 : new Promise(ok => { i.onload = i.onerror = ok; }))), new Promise(ok => setTimeout(ok, 6000))])");
  await pause(800);
  await p.capture(DOSSIER + prefixe + "-1440.png");
  console.log("fiche", JSON.stringify(await p.eval(IMAGES)));
  await p.aller("http://localhost:8080/affiches?collection=marche-de-noel-de-mulhouse", 2000);
  await p.eval("Promise.race([Promise.all([...document.images].filter(i => i.loading !== 'lazy').map(i => i.complete ? 1 : new Promise(ok => { i.onload = i.onerror = ok; }))), new Promise(ok => setTimeout(ok, 6000))])");
  await pause(800);
  await p.capture(DOSSIER + prefixe + "-collection.png");
  console.log("collection", JSON.stringify(await p.eval(IMAGES)));
  await p.taille(1024, 768, true);
  await p.aller("http://localhost:8080/?stand=1", 2500);
  await p.eval("Promise.race([Promise.all([...document.images].filter(i => i.loading !== 'lazy').map(i => i.complete ? 1 : new Promise(ok => { i.onload = i.onerror = ok; }))), new Promise(ok => setTimeout(ok, 6000))])");
  await pause(800);
  await p.capture(DOSSIER + prefixe + "-tablette-stand.png");
  console.log("tablette", JSON.stringify(await p.eval(IMAGES)));
  await p.taille(390, 844, true);
  await p.aller("http://localhost:8080/affiches/mulhouse-marche-de-noel-affiche-personnalisee", 2000);
  await p.eval("Promise.race([Promise.all([...document.images].filter(i => i.loading !== 'lazy').map(i => i.complete ? 1 : new Promise(ok => { i.onload = i.onerror = ok; }))), new Promise(ok => setTimeout(ok, 6000))])");
  await pause(800);
  await p.capture(DOSSIER + prefixe + "-390.png");
  console.log(JSON.stringify(await p.erreurs()));
} finally {
  p.fermer();
}
